const CORTEX_MEMORY_MANAGEMENT_SCHEMA_VERSION = 'cortex-memory-management-v1';

function normalizeTopic(topic = '') {
  const normalized = String(topic || 'geral')
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

function clipText(value = '', max = 5000) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function hashText(value = '') {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeEventText(event = {}) {
  if (!event || typeof event !== 'object') return '';
  return clipText(event.text || event.summary || event.content || event.fileName || '', 9000);
}

function buildEventMemoryId(event = {}, index = 0) {
  const explicit = String(event.memoryId || event.id || '').trim();
  if (explicit) return explicit;
  return `legacy-memory-${index + 1}-${hashText(`${event.type || ''}:${event.topic || ''}:${normalizeEventText(event).slice(0, 180)}`)}`;
}

function isExpired(event = {}, now = new Date().toISOString()) {
  const expiresAt = event.expiresAt || (event.validity && event.validity.expiresAt) || null;
  if (!expiresAt) return false;
  const expiresMs = Date.parse(expiresAt);
  const nowMs = Date.parse(now);
  return Number.isFinite(expiresMs) && Number.isFinite(nowMs) && expiresMs <= nowMs;
}

function eventToMemoryRecord(event = {}, index = 0, projectId = '', now = new Date().toISOString()) {
  const id = buildEventMemoryId(event, index);
  const expired = isExpired(event, now);
  const deleted = Boolean(event.deletedAt || event.status === 'deleted');
  const promoted = Boolean(event.promoted || event.status === 'promoted');
  const text = normalizeEventText(event);
  const status = deleted
    ? 'deleted'
    : expired || event.status === 'expired'
      ? 'expired'
      : promoted
        ? 'promoted'
        : event.status || 'active';

  return {
    schemaVersion: CORTEX_MEMORY_MANAGEMENT_SCHEMA_VERSION,
    id,
    memoryId: id,
    projectId,
    index,
    type: event.type || 'cortex.memory',
    title: event.title || event.fileName || (event.type === 'cortex.user_input' ? 'Entrada do usuário' : 'Memória Cortex'),
    topic: normalizeTopic(event.topic),
    text,
    summary: event.summary || event.text || '',
    source: event.source || 'cortex',
    scope: event.scope || 'project',
    status,
    promoted,
    suppressed: Boolean(deleted || expired || event.suppressed),
    createdAt: event.createdAt || null,
    updatedAt: event.updatedAt || null,
    promotedAt: event.promotedAt || null,
    expiresAt: event.expiresAt || (event.validity && event.validity.expiresAt) || null,
    expiredAt: event.expiredAt || null,
    deletedAt: event.deletedAt || null,
    validity: event.validity || null,
    backendRefs: event.backendRefs || null,
  };
}

function normalizeLearning(raw = {}) {
  return {
    persona: Array.isArray(raw.persona) ? raw.persona : Array.isArray(raw.ia2) ? raw.ia2 : [],
    executor: Array.isArray(raw.executor) ? raw.executor : Array.isArray(raw.ia1) ? raw.ia1 : [],
    events: Array.isArray(raw.events) ? raw.events : [],
    topics: Array.isArray(raw.topics) ? raw.topics : [],
    updatedAt: raw.updatedAt || null,
  };
}

function createCortexMemoryManagementService(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    readOrchestrationState,
    writeOrchestrationState,
    now = () => new Date().toISOString(),
  } = dependencies;

  function requireDependency(name, value) {
    if (typeof value !== 'function') throw new Error(`Cortex memory management dependency missing: ${name}`);
  }

  function readProjectLearning(projectId) {
    requireDependency('readOrchestrationState', readOrchestrationState);
    const state = readOrchestrationState();
    const learning = normalizeLearning(
      state.cortexLearningByProject && state.cortexLearningByProject[projectId]
        ? state.cortexLearningByProject[projectId]
        : {}
    );
    return { state, learning };
  }

  function writeProjectLearning(state, projectId, learning) {
    requireDependency('writeOrchestrationState', writeOrchestrationState);
    writeOrchestrationState({
      ...state,
      cortexLearningByProject: {
        ...(state.cortexLearningByProject || {}),
        [projectId]: {
          ...learning,
          updatedAt: now(),
        },
      },
    });
  }

  function listCortexMemories(input = {}) {
    const projectId = input.projectId || null;
    if (!projectId) return { ok: false, reason: 'missing_project_id', message: 'projectId é obrigatório.' };
    const { learning } = readProjectLearning(projectId);
    const topic = input.topic ? normalizeTopic(input.topic) : '';
    const includeExpired = input.includeExpired !== false;
    const records = learning.events
      .map((event, index) => eventToMemoryRecord(event, index, projectId, now()))
      .filter((record) => record.text || record.title)
      .filter((record) => (topic ? record.topic === topic : true))
      .filter((record) => includeExpired || record.status !== 'expired')
      .filter((record) => record.status !== 'deleted')
      .sort((a, b) => {
        const left = Date.parse(a.updatedAt || a.createdAt || '') || 0;
        const right = Date.parse(b.updatedAt || b.createdAt || '') || 0;
        return right - left;
      });

    return {
      ok: true,
      schemaVersion: CORTEX_MEMORY_MANAGEMENT_SCHEMA_VERSION,
      projectId,
      memories: records.slice(0, Math.max(1, Math.min(120, Number(input.limit || 80)))),
      total: records.length,
    };
  }

  function findEventIndex(events = [], memoryId = '') {
    return events.findIndex((event, index) => buildEventMemoryId(event, index) === memoryId);
  }

  function patchEventByAction(event = {}, action = '', patch = {}) {
    const timestamp = now();
    const next = {
      ...event,
      id: event.id || event.memoryId || patch.memoryId || null,
      memoryId: event.memoryId || event.id || patch.memoryId || null,
      updatedAt: timestamp,
    };
    if (patch.topic) next.topic = normalizeTopic(patch.topic);
    if (patch.scope) next.scope = String(patch.scope || 'project').trim() || 'project';
    if (patch.expiresAt !== undefined) next.expiresAt = patch.expiresAt || null;
    if (patch.validity && typeof patch.validity === 'object') next.validity = patch.validity;

    if (action === 'edit') {
      const text = clipText(patch.text || patch.summary || '', 9000);
      if (text) {
        if (next.type === 'cortex.attachment_learned') next.summary = text;
        else next.text = text;
      }
      if (patch.title) next.title = clipText(patch.title, 160);
      next.status = patch.status || (next.promoted ? 'promoted' : 'active');
      next.editedAt = timestamp;
      next.suppressed = false;
    }

    if (action === 'promote') {
      next.promoted = true;
      next.status = 'promoted';
      next.promotedAt = timestamp;
      next.scope = patch.scope || next.scope || 'project';
      next.suppressed = false;
    }

    if (action === 'expire') {
      next.status = 'expired';
      next.expiresAt = patch.expiresAt || timestamp;
      next.expiredAt = timestamp;
      next.suppressed = true;
    }

    return next;
  }

  function manageCortexMemory(input = {}) {
    const action = String(input.action || '').trim().toLowerCase();
    const projectId = input.projectId || null;
    const memoryId = String(input.memoryId || '').trim();
    if (!projectId) return { ok: false, reason: 'missing_project_id', message: 'projectId é obrigatório.' };
    if (!memoryId) return { ok: false, reason: 'missing_memory_id', message: 'memoryId é obrigatório.' };
    if (!['edit', 'promote', 'expire', 'delete'].includes(action)) {
      return { ok: false, reason: 'unsupported_memory_action', message: `Ação não suportada: ${action}` };
    }

    const { state, learning } = readProjectLearning(projectId);
    const index = findEventIndex(learning.events, memoryId);
    if (index < 0) return { ok: false, reason: 'memory_not_found', message: 'Memória não encontrada.' };

    const events = learning.events.slice();
    const previous = events[index];
    let nextMemory = null;
    if (action === 'delete') {
      nextMemory = eventToMemoryRecord(previous, index, projectId, now());
      events.splice(index, 1);
    } else {
      events[index] = patchEventByAction(previous, action, {
        ...input,
        memoryId,
      });
      nextMemory = eventToMemoryRecord(events[index], index, projectId, now());
    }

    writeProjectLearning(state, projectId, {
      ...learning,
      events,
    });

    appendAuditEvent('cortex.memory_lifecycle', {
      projectId,
      memoryId,
      action,
      topic: nextMemory ? nextMemory.topic : null,
      status: nextMemory ? nextMemory.status : action,
    });

    return {
      ok: true,
      schemaVersion: CORTEX_MEMORY_MANAGEMENT_SCHEMA_VERSION,
      action,
      projectId,
      memoryId,
      memory: nextMemory,
      learning: normalizeLearning({
        ...learning,
        events,
        updatedAt: now(),
      }),
    };
  }

  return {
    eventToMemoryRecord,
    listCortexMemories,
    manageCortexMemory,
  };
}

module.exports = {
  CORTEX_MEMORY_MANAGEMENT_SCHEMA_VERSION,
  buildEventMemoryId,
  createCortexMemoryManagementService,
  eventToMemoryRecord,
};
