const { createJobStateStore } = require('./state_store_jobs');

const WINDOWS_DIRECTORY_SYNC_UNSUPPORTED_CODES = new Set([
  'EINVAL',
  'EISDIR',
  'EACCES',
  'ENOTSUP',
  'EPERM',
]);
const MAX_JOBS_TEMP_OPEN_ATTEMPTS = 32;
let jobsAtomicWriteSerial = 0;

function createOrchestrationStateStore(dependencies = {}) {
  const {
    CORTEX_BRIEFING_MAX_RETRIES = 8,
    CORTEX_VALIDATION_MAX_RETRIES = 8,
    CORTEX_VALIDATION_STALL_LIMIT = 2,
    JOB_PROGRESS_MIN_DELTA = 1,
    JOB_RETRY_NO_PROGRESS_MS = 1800000,
    JOB_RETRY_SAME_FINGERPRINT_LIMIT = 3,
    JOB_RETRY_SAME_REASON_LIMIT = 6,
    JOB_RETRY_STAGNATION_LIMIT = 12,
    JOB_SOFT_TIMEOUT_MS = 3600000,
    MAX_AUDIT_EVENTS = 300,
    MAX_CONVERSATION_MESSAGES = 200,
    MAX_CORTEX_LEARNING_EVENTS = 80,
    MAX_JOB_EVENTS = 120,
    MAX_JOBS_STORED = 180,
    computeRetryBackoffMs,
    fs,
    getUserDataPath,
    isNonRetriableProviderReason,
    onJobTerminal,
    path,
    randomUUID,
    runtimePlatform = process.platform,
  } = dependencies;
  let jobsStorageHealth = 'unknown';

  function requireDependency(name, value) {
    if (!value) throw new Error(`Orchestration state dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('computeRetryBackoffMs', computeRetryBackoffMs);
    requireDependency('fs', fs);
    requireDependency('getUserDataPath', getUserDataPath);
    requireDependency('isNonRetriableProviderReason', isNonRetriableProviderReason);
    requireDependency('path', path);
  }

  function ensureStoreDirectory() {
    assertReady();
    const storeDir = getUserDataPath();

    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }

    return storeDir;
  }

  function ensureStoreFile(fileName, initialState) {
    const storeDir = ensureStoreDirectory();
    const storePath = path.join(storeDir, fileName);

    if (!fs.existsSync(storePath)) {
      fs.writeFileSync(storePath, JSON.stringify(initialState, null, 2), 'utf8');
    }

    return storePath;
  }

  function ensureOrchestrationStore() {
    return ensureStoreFile('orchestration.json', {
      conversationsByProject: {},
      messagesByConversation: {},
      cortexLearningByProject: {},
      auditTrail: [],
    });
  }

  function readOrchestrationState() {
    const storePath = ensureOrchestrationStore();
    try {
      const raw = fs.readFileSync(storePath, 'utf8');
      const parsed = JSON.parse(raw);
      const conversationsByProject =
        parsed && parsed.conversationsByProject && typeof parsed.conversationsByProject === 'object'
          ? parsed.conversationsByProject
          : {};
      const messagesByConversation =
        parsed && parsed.messagesByConversation && typeof parsed.messagesByConversation === 'object'
          ? parsed.messagesByConversation
          : {};
      const cortexLearningByProject =
        parsed && parsed.cortexLearningByProject && typeof parsed.cortexLearningByProject === 'object'
          ? parsed.cortexLearningByProject
          : {};
      const auditTrail = parsed && Array.isArray(parsed.auditTrail) ? parsed.auditTrail : [];
      return { conversationsByProject, messagesByConversation, cortexLearningByProject, auditTrail };
    } catch {
      return {
        conversationsByProject: {},
        messagesByConversation: {},
        cortexLearningByProject: {},
        auditTrail: [],
      };
    }
  }

  function writeOrchestrationState(nextState) {
    const storePath = ensureOrchestrationStore();
    fs.writeFileSync(storePath, JSON.stringify(nextState, null, 2), 'utf8');
  }

  function tolerateKnownWindowsFilesystemLimitation(error) {
    return Boolean(
      runtimePlatform === 'win32' &&
        error &&
        WINDOWS_DIRECTORY_SYNC_UNSUPPORTED_CODES.has(error.code)
    );
  }

  function syncJobsDirectory(storeDir) {
    let descriptor;
    try {
      const flags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0);
      descriptor = fs.openSync(storeDir, flags);
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (!tolerateKnownWindowsFilesystemLimitation(error)) throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  function openJobsTemporaryFile(storePath) {
    const storeDir = path.dirname(storePath);
    const baseName = path.basename(storePath);
    const flags =
      fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW || 0);

    for (let attempt = 0; attempt < MAX_JOBS_TEMP_OPEN_ATTEMPTS; attempt += 1) {
      jobsAtomicWriteSerial += 1;
      const temporaryPath = path.join(
        storeDir,
        `.${baseName}.${process.pid}.${jobsAtomicWriteSerial}.tmp`
      );
      try {
        return {
          descriptor: fs.openSync(temporaryPath, flags, 0o600),
          temporaryPath,
        };
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
      }
    }

    const error = new Error('Não foi possível criar o arquivo temporário de jobs.');
    error.code = 'jobs_temp_unavailable';
    throw error;
  }

  function setPrivateJobsFileMode(descriptor) {
    if (typeof fs.fchmodSync !== 'function') return;
    try {
      fs.fchmodSync(descriptor, 0o600);
    } catch (error) {
      if (!tolerateKnownWindowsFilesystemLimitation(error)) throw error;
    }
  }

  function isPlainJobsRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function isStrictJobsState(value) {
    if (!isPlainJobsRecord(value)) return false;
    let keys;
    try {
      keys = Reflect.ownKeys(value).sort();
    } catch {
      return false;
    }
    if (
      keys.length !== 2 ||
      keys[0] !== 'jobOrder' ||
      keys[1] !== 'jobsById'
    ) {
      return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const jobsDescriptor = descriptors.jobsById;
    const orderDescriptor = descriptors.jobOrder;
    if (
      !jobsDescriptor ||
      !orderDescriptor ||
      jobsDescriptor.enumerable !== true ||
      orderDescriptor.enumerable !== true ||
      !Object.prototype.hasOwnProperty.call(jobsDescriptor, 'value') ||
      !Object.prototype.hasOwnProperty.call(orderDescriptor, 'value') ||
      !isPlainJobsRecord(jobsDescriptor.value) ||
      !Array.isArray(orderDescriptor.value) ||
      orderDescriptor.value.some((jobId) => typeof jobId !== 'string')
    ) {
      return false;
    }
    return Object.values(jobsDescriptor.value).every(
      (job) => isPlainJobsRecord(job)
    );
  }

  function parseStrictJobsState(raw) {
    const parsed = JSON.parse(raw);
    if (!isStrictJobsState(parsed)) {
      throw new TypeError('Formato persistido de jobs inválido.');
    }
    return parsed;
  }

  function createJobsStorageUnhealthyError() {
    const error = new Error('Persistência de jobs indisponível até uma leitura válida.');
    error.code = 'jobs_storage_unhealthy';
    return error;
  }

  function assertJobsStorageHealthyForWrite(storePath) {
    if (jobsStorageHealth === 'unhealthy') {
      throw createJobsStorageUnhealthyError();
    }
    if (!fs.existsSync(storePath)) return;
    try {
      parseStrictJobsState(fs.readFileSync(storePath, 'utf8'));
      jobsStorageHealth = 'healthy';
    } catch {
      jobsStorageHealth = 'unhealthy';
      throw createJobsStorageUnhealthyError();
    }
  }

  function writeJobsFileAtomically(storePath, nextState) {
    if (!isStrictJobsState(nextState)) {
      const error = new TypeError('Estado de jobs inválido para persistência.');
      error.code = 'jobs_state_invalid';
      throw error;
    }
    const serialized = JSON.stringify(nextState, null, 2);
    if (typeof serialized !== 'string') {
      throw new TypeError('Estado de jobs inválido para persistência.');
    }
    const bytes = Buffer.from(`${serialized}\n`, 'utf8');
    const { descriptor: openedDescriptor, temporaryPath } = openJobsTemporaryFile(storePath);
    let descriptor = openedDescriptor;
    let renamed = false;

    try {
      setPrivateJobsFileMode(descriptor);
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, storePath);
      renamed = true;
      syncJobsDirectory(path.dirname(storePath));
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {}
      }
      if (!renamed) {
        try {
          fs.unlinkSync(temporaryPath);
        } catch {}
      }
      throw error;
    }
  }

  function ensureJobsStore() {
    const storeDir = ensureStoreDirectory();
    const storePath = path.join(storeDir, 'jobs.json');
    if (!fs.existsSync(storePath)) {
      writeJobsFileAtomically(storePath, {
        jobsById: {},
        jobOrder: [],
      });
      jobsStorageHealth = 'healthy';
    }
    return storePath;
  }

  function readJobsState() {
    const storePath = ensureJobsStore();
    try {
      const raw = fs.readFileSync(storePath, 'utf8');
      const parsed = parseStrictJobsState(raw);
      jobsStorageHealth = 'healthy';
      return parsed;
    } catch {
      jobsStorageHealth = 'unhealthy';
      return { jobsById: {}, jobOrder: [] };
    }
  }

  function writeJobsState(nextState) {
    const storeDir = ensureStoreDirectory();
    const storePath = path.join(storeDir, 'jobs.json');
    assertJobsStorageHealthyForWrite(storePath);
    writeJobsFileAtomically(storePath, nextState);
    jobsStorageHealth = 'healthy';
  }

  function appendAuditEvent(type, payload = {}) {
    const current = readOrchestrationState();
    const event = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      createdAt: new Date().toISOString(),
    };

    const auditTrail = [event, ...current.auditTrail].slice(0, MAX_AUDIT_EVENTS);
    writeOrchestrationState({
      ...current,
      auditTrail,
    });

    return event;
  }

  const jobStateStore = createJobStateStore({
    CORTEX_BRIEFING_MAX_RETRIES,
    CORTEX_VALIDATION_MAX_RETRIES,
    CORTEX_VALIDATION_STALL_LIMIT,
    JOB_PROGRESS_MIN_DELTA,
    JOB_RETRY_NO_PROGRESS_MS,
    JOB_RETRY_SAME_FINGERPRINT_LIMIT,
    JOB_RETRY_SAME_REASON_LIMIT,
    JOB_RETRY_STAGNATION_LIMIT,
    JOB_SOFT_TIMEOUT_MS,
    MAX_JOB_EVENTS,
    MAX_JOBS_STORED,
    appendAuditEvent,
    computeRetryBackoffMs,
    isNonRetriableProviderReason,
    isJobsStorageHealthy: () => jobsStorageHealth === 'healthy',
    onJobTerminal,
    randomUUID,
    readJobsState,
    writeJobsState,
  });

  const {
    appendJobEvent,
    bindJobActionDigest,
    createAuthorizedAssistantJob,
    createAssistantJob,
    getAuthorizedJobById,
    getJobById,
    isJobCancelled,
    listAuthorizedJobRecoveryCandidates,
    listJobs,
    markJobAwaitingUserInput,
    markJobCancelled,
    markJobCanaryRolledBack,
    markJobCompleted,
    markJobFailed,
    markJobPausedForMemory,
    markJobPhase,
    markJobRetryPending,
    recoverInterruptedJobs,
    setJobCheckpoint,
  } = jobStateStore;

  function addConversationEntry(projectId, title, meta = {}) {
    if (!projectId) {
      return { ok: false, message: 'projectId é obrigatório.' };
    }

    const normalizedTitle =
      String(title || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 52) || 'Conversa sem título';

    const current = readOrchestrationState();
    const bucket = Array.isArray(current.conversationsByProject[projectId])
      ? current.conversationsByProject[projectId]
      : [];

    const conversation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: normalizedTitle,
      createdAt: new Date().toISOString(),
      source: meta.source || 'user',
    };

    const nextConversationsByProject = {
      ...current.conversationsByProject,
      [projectId]: [conversation, ...bucket].slice(0, 120),
    };

    writeOrchestrationState({
      ...current,
      conversationsByProject: nextConversationsByProject,
    });

    appendAuditEvent('conversation.added', {
      projectId,
      conversationId: conversation.id,
      source: conversation.source,
    });

    return {
      ok: true,
      conversation,
      conversations: nextConversationsByProject[projectId],
    };
  }

  function renameConversationEntry(projectId, conversationId, nextTitle) {
    if (!projectId) return { ok: false, message: 'projectId é obrigatório.' };
    if (!conversationId) return { ok: false, message: 'conversationId é obrigatório.' };

    const normalizedTitle =
      String(nextTitle || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 52) || '';
    if (!normalizedTitle) return { ok: false, message: 'Título inválido.' };

    const current = readOrchestrationState();
    const bucket = Array.isArray(current.conversationsByProject[projectId])
      ? current.conversationsByProject[projectId]
      : [];

    const idx = bucket.findIndex((conv) => conv && conv.id === conversationId);
    if (idx < 0) return { ok: false, message: 'Conversa não encontrada.' };

    const nextBucket = bucket.slice();
    const previous = nextBucket[idx] || {};
    nextBucket[idx] = {
      ...previous,
      title: normalizedTitle,
      updatedAt: new Date().toISOString(),
    };

    const nextConversationsByProject = {
      ...current.conversationsByProject,
      [projectId]: nextBucket,
    };

    writeOrchestrationState({
      ...current,
      conversationsByProject: nextConversationsByProject,
    });

    appendAuditEvent('conversation.renamed', {
      projectId,
      conversationId,
      title: normalizedTitle,
    });

    return {
      ok: true,
      conversation: nextBucket[idx],
      conversations: nextBucket,
    };
  }

  function deleteConversationEntry(projectId, conversationId) {
    if (!projectId) return { ok: false, message: 'projectId é obrigatório.' };
    if (!conversationId) return { ok: false, message: 'conversationId é obrigatório.' };

    const current = readOrchestrationState();
    const bucket = Array.isArray(current.conversationsByProject[projectId])
      ? current.conversationsByProject[projectId]
      : [];

    const idx = bucket.findIndex((conv) => conv && conv.id === conversationId);
    if (idx < 0) return { ok: false, message: 'Conversa não encontrada.' };

    const nextBucket = bucket.filter((conv) => conv && conv.id !== conversationId);

    const nextConversationsByProject = {
      ...current.conversationsByProject,
      [projectId]: nextBucket,
    };

    const nextMessagesByConversation = { ...current.messagesByConversation };
    delete nextMessagesByConversation[conversationId];

    writeOrchestrationState({
      ...current,
      conversationsByProject: nextConversationsByProject,
      messagesByConversation: nextMessagesByConversation,
    });

    appendAuditEvent('conversation.deleted', {
      projectId,
      conversationId,
    });

    return {
      ok: true,
      conversations: nextBucket,
    };
  }

  function listConversationMessages(conversationId, limit = MAX_CONVERSATION_MESSAGES) {
    if (!conversationId) {
      return { ok: false, message: 'conversationId é obrigatório.' };
    }
    const current = readOrchestrationState();
    const bucket = Array.isArray(current.messagesByConversation[conversationId])
      ? current.messagesByConversation[conversationId]
      : [];
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(MAX_CONVERSATION_MESSAGES, Number(limit)))
      : MAX_CONVERSATION_MESSAGES;
    return {
      ok: true,
      conversationId,
      messages: bucket.slice(-safeLimit),
    };
  }

  function addConversationMessage(projectId, conversationId, role, text, meta = {}) {
    if (!projectId) return { ok: false, message: 'projectId é obrigatório.' };
    if (!conversationId) return { ok: false, message: 'conversationId é obrigatório.' };
    if (!role || !['user', 'assistant'].includes(role)) {
      return { ok: false, message: 'role inválido.' };
    }

    const normalizedText = String(text || '').trim();
    if (!normalizedText) return { ok: false, message: 'Mensagem vazia.' };

    const current = readOrchestrationState();
    const bucket = Array.isArray(current.messagesByConversation[conversationId])
      ? current.messagesByConversation[conversationId]
      : [];
    const lastMessage = bucket.length ? bucket[bucket.length - 1] : null;

    if (
      lastMessage &&
      lastMessage.role === role &&
      String(lastMessage.text || '') === normalizedText
    ) {
      return { ok: true, message: lastMessage, deduplicated: true };
    }

    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text: normalizedText.slice(0, 12000),
      createdAt: new Date().toISOString(),
      mode: meta.mode || 'default',
    };

    const nextBucket = [...bucket, message].slice(-MAX_CONVERSATION_MESSAGES);
    writeOrchestrationState({
      ...current,
      messagesByConversation: {
        ...current.messagesByConversation,
        [conversationId]: nextBucket,
      },
    });

    return { ok: true, message };
  }

  function removeProjectConversationHistory(projectId) {
    const current = readOrchestrationState();
    const projectConversations = Array.isArray(current.conversationsByProject[projectId])
      ? current.conversationsByProject[projectId]
      : [];
    if (!current.conversationsByProject[projectId] && !current.cortexLearningByProject[projectId]) return;

    const nextConversationsByProject = { ...current.conversationsByProject };
    delete nextConversationsByProject[projectId];

    const nextMessagesByConversation = { ...current.messagesByConversation };
    projectConversations.forEach((conv) => {
      if (conv && conv.id) delete nextMessagesByConversation[conv.id];
    });

    const nextCortexLearningByProject = { ...current.cortexLearningByProject };
    delete nextCortexLearningByProject[projectId];

    writeOrchestrationState({
      ...current,
      conversationsByProject: nextConversationsByProject,
      messagesByConversation: nextMessagesByConversation,
      cortexLearningByProject: nextCortexLearningByProject,
    });
  }

  function getCortexLearning(projectId) {
    if (!projectId) return { ok: false, message: 'projectId é obrigatório.' };
    const current = readOrchestrationState();
    const raw = current.cortexLearningByProject[projectId] || {};
    const data = {
      persona: Array.isArray(raw.persona) ? raw.persona : Array.isArray(raw.ia2) ? raw.ia2 : [],
      executor: Array.isArray(raw.executor) ? raw.executor : Array.isArray(raw.ia1) ? raw.ia1 : [],
      events: Array.isArray(raw.events) ? raw.events : [],
      topics: Array.isArray(raw.topics) ? raw.topics : [],
      updatedAt: raw.updatedAt || null,
    };
    return { ok: true, projectId, learning: data };
  }

  function normalizeCortexTopicId(rawValue) {
    const normalized = String(rawValue || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 72);
    return normalized || 'geral';
  }

  function normalizeCortexTopicLabel(rawValue) {
    return String(rawValue || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  }

  function mergeCortexTopics(existingTopics, incomingTopics) {
    const byId = new Map();
    [...(existingTopics || []), ...(incomingTopics || [])].forEach((topic) => {
      const id = normalizeCortexTopicId(topic && (topic.id || topic.label));
      const label = normalizeCortexTopicLabel(topic && topic.label);
      if (!id || !label) return;
      byId.set(id, {
        id,
        label,
        updatedAt: topic.updatedAt || topic.createdAt || new Date().toISOString(),
      });
    });
    return Array.from(byId.values()).slice(-80);
  }

  function normalizeCortexLearningEvent(event) {
    const source = event && typeof event === 'object' ? event : {};
    const createdAt = source.createdAt || new Date().toISOString();
    const id =
      source.id ||
      source.memoryId ||
      `cortex-memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      ...source,
      id,
      memoryId: source.memoryId || id,
      topic: normalizeCortexTopicId(source.topic || 'geral'),
      status: source.status || 'active',
      createdAt,
    };
  }

  function upsertCortexLearning(projectId, entry) {
    if (!projectId) return { ok: false, message: 'projectId é obrigatório.' };
    const current = readOrchestrationState();
    const previousRaw = current.cortexLearningByProject[projectId] || {};
    const previous = {
      persona: Array.isArray(previousRaw.persona) ? previousRaw.persona : Array.isArray(previousRaw.ia2) ? previousRaw.ia2 : [],
      executor: Array.isArray(previousRaw.executor) ? previousRaw.executor : Array.isArray(previousRaw.ia1) ? previousRaw.ia1 : [],
      events: Array.isArray(previousRaw.events) ? previousRaw.events : [],
      topics: Array.isArray(previousRaw.topics) ? previousRaw.topics : [],
      updatedAt: previousRaw.updatedAt || null,
    };

    const incomingPersona = [
      ...(Array.isArray(entry.persona) ? entry.persona : []),
      ...(Array.isArray(entry.ia2) ? entry.ia2 : []),
    ];
    const incomingExecutor = [
      ...(Array.isArray(entry.executor) ? entry.executor : []),
      ...(Array.isArray(entry.ia1) ? entry.ia1 : []),
    ];

    const next = {
      persona: [...(previous.persona || []), ...incomingPersona].slice(-40),
      executor: [...(previous.executor || []), ...incomingExecutor].slice(-40),
      events: [
        ...(previous.events || []),
        ...(Array.isArray(entry.events) ? entry.events.map(normalizeCortexLearningEvent) : []),
      ].slice(-MAX_CORTEX_LEARNING_EVENTS),
      topics: mergeCortexTopics(previous.topics, Array.isArray(entry.topics) ? entry.topics : []),
      updatedAt: new Date().toISOString(),
    };

    writeOrchestrationState({
      ...current,
      cortexLearningByProject: {
        ...current.cortexLearningByProject,
        [projectId]: next,
      },
    });

    return { ok: true, projectId, learning: next };
  }

  function upsertCortexTopic(projectId, topic) {
    if (!projectId) return { ok: false, message: 'projectId é obrigatório.' };
    const label = normalizeCortexTopicLabel(topic && topic.label);
    if (!label) return { ok: false, message: 'label é obrigatório.' };

    const id = normalizeCortexTopicId((topic && topic.id) || label);
    const current = readOrchestrationState();
    const previousRaw = current.cortexLearningByProject[projectId] || {};
    const previous = {
      persona: Array.isArray(previousRaw.persona) ? previousRaw.persona : Array.isArray(previousRaw.ia2) ? previousRaw.ia2 : [],
      executor: Array.isArray(previousRaw.executor) ? previousRaw.executor : Array.isArray(previousRaw.ia1) ? previousRaw.ia1 : [],
      events: Array.isArray(previousRaw.events) ? previousRaw.events : [],
      topics: Array.isArray(previousRaw.topics) ? previousRaw.topics : [],
      updatedAt: previousRaw.updatedAt || null,
    };
    const next = {
      ...previous,
      topics: mergeCortexTopics(previous.topics, [{ id, label, updatedAt: new Date().toISOString() }]),
      updatedAt: new Date().toISOString(),
    };

    writeOrchestrationState({
      ...current,
      cortexLearningByProject: {
        ...current.cortexLearningByProject,
        [projectId]: next,
      },
    });

    return { ok: true, projectId, learning: next, topic: { id, label } };
  }

  function renameCortexTopic(projectId, topicId, label) {
    const normalizedTopicId = normalizeCortexTopicId(topicId);
    return upsertCortexTopic(projectId, { id: normalizedTopicId, label });
  }

  return {
    addConversationEntry,
    addConversationMessage,
    appendAuditEvent,
    appendJobEvent,
    bindJobActionDigest,
    createAuthorizedAssistantJob,
    createAssistantJob,
    getCortexLearning,
    getAuthorizedJobById,
    getJobById,
    isJobCancelled,
    listConversationMessages,
    listAuthorizedJobRecoveryCandidates,
    listJobs,
    markJobAwaitingUserInput,
    markJobCancelled,
    markJobCanaryRolledBack,
    markJobCompleted,
    markJobFailed,
    markJobPausedForMemory,
    markJobPhase,
    markJobRetryPending,
    readJobsState,
    readOrchestrationState,
    recoverInterruptedJobs,
    removeProjectConversationHistory,
    renameConversationEntry,
    deleteConversationEntry,
    renameCortexTopic,
    setJobCheckpoint,
    upsertCortexLearning,
    upsertCortexTopic,
    writeJobsState,
    writeOrchestrationState,
  };
}

module.exports = {
  createOrchestrationStateStore,
};
