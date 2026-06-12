const ACTIVE_MEMORY_SCHEMA_VERSION = 'active-memory-v1';

const {
  ACTIVE_MEMORY_DEFAULT_TTL_MS,
  buildActiveMemoryCitation,
  buildActiveMemoryScope,
  buildActiveMemoryValidity,
  normalizeActiveMemoryCitations,
  validateActiveMemoryForRequest,
} = require('./active_memory_governance_service');
const {
  buildMemoryProvenanceReport,
  normalizeMemoryProvenanceCitations,
  rankMemoryCandidates,
  rankMemoryCandidatesWithProvider,
} = require('./memory_provenance_service');

function compactActiveMemoryText(value = '', max = 1200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function compactActiveMemoryBlock(value = '', max = 1800) {
  const text = String(value || '').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function normalizeActiveMemoryText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackIntentTerms(value = '') {
  return Array.from(
    new Set(
      normalizeActiveMemoryText(value)
        .replace(/[^a-z0-9\s_-]/g, ' ')
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 4)
    )
  ).slice(0, 20);
}

function resolveProjectName(projectInfo = null) {
  const rootPath = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
  if (!rootPath) return '';
  return rootPath.split(/[\\/]/).filter(Boolean).pop() || rootPath;
}

function isActiveMemoryContinuationMessage(value = '') {
  const normalized = normalizeActiveMemoryText(value);
  if (!normalized) return false;
  if (/^(sim|s|ok|certo|isso|pode|pode seguir|segue|continue|continua|prossiga|vamos|faz|faca|faça|gera|gerar|retente|tente novamente)$/.test(normalized)) {
    return true;
  }
  return /\b(memoria|contexto|como combinamos|como conversamos|do jeito que falamos|o que falamos|segue com isso|pode usar isso|usa isso)\b/.test(
    normalized
  );
}

function readLearningEntries(learning = {}, keys = [], sourceType = 'cortex_learning') {
  const source = learning && typeof learning === 'object' ? learning : {};
  const entries = [];
  keys.forEach((key) => {
    const bucket = Array.isArray(source[key]) ? source[key] : [];
    bucket.forEach((entry, index) => {
      let text = '';
      if (typeof entry === 'string') {
        text = entry;
      } else if (entry && typeof entry === 'object') {
        text = entry.summary || entry.text || entry.content || entry.label || JSON.stringify(entry);
      }
      const compact = compactActiveMemoryText(text, 900);
      if (!compact) return;
      entries.push({
        text: compact,
        source: `cortex_learning.${key}`,
        sourceType,
        sourceId: `${key}:${index + 1}`,
        citation: buildActiveMemoryCitation({
          source: `cortex_learning.${key}`,
          sourceType,
          sourceId: `${key}:${index + 1}`,
          title: `${key}[${index + 1}]`,
          reason: sourceType === 'user_memory' ? 'matched_user_preference' : 'matched_project_rule',
          preview: compact,
        }),
      });
    });
  });
  return entries;
}

function readLearningEventEntries(learning = {}) {
  const events = learning && Array.isArray(learning.events) ? learning.events : [];
  return events
    .map((event, index) => {
      if (!event || typeof event !== 'object') return '';
      const expiresAt = event.expiresAt || (event.validity && event.validity.expiresAt) || null;
      const expiredAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
      if (event.deletedAt || event.status === 'deleted') return null;
      if (event.status === 'expired') return null;
      if (Number.isFinite(expiredAtMs) && expiredAtMs <= Date.now()) return null;
      const topic = event.topic ? `topic:${event.topic}` : '';
      const type = event.type ? `type:${event.type}` : '';
      const text = event.summary || event.text || event.fileName || '';
      const compact = compactActiveMemoryText([type, topic, text].filter(Boolean).join(' '), 900);
      if (!compact) return null;
      return {
        text: compact,
        source: 'cortex_learning.events',
        sourceType: event.promoted || event.status === 'promoted' ? 'project_memory_promoted' : 'project_memory_event',
        sourceId: event.memoryId || event.id || `event:${index + 1}`,
        promoted: Boolean(event.promoted || event.status === 'promoted'),
        expiresAt,
        citation: buildActiveMemoryCitation({
          source: 'cortex_learning.events',
          sourceType: event.promoted || event.status === 'promoted' ? 'project_memory_promoted' : 'project_memory_event',
          sourceId: event.memoryId || event.id || `event:${index + 1}`,
          title: event.topic ? `event:${event.topic}` : `event:${index + 1}`,
          reason: event.promoted || event.status === 'promoted' ? 'matched_promoted_project_memory' : 'matched_project_event',
          preview: compact,
          expiresAt,
        }),
      };
    })
    .filter(Boolean);
}

function readMemoryItemText(item = '') {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') return item.text || item.summary || item.content || '';
  return '';
}

function scoreMemoryItem(item = '', intentTerms = [], recency = 0) {
  const normalized = normalizeActiveMemoryText(readMemoryItemText(item));
  let score = Math.max(0, Number(recency) || 0) * 0.025;
  intentTerms.forEach((term) => {
    if (term && normalized.includes(normalizeActiveMemoryText(term))) score += 2;
  });
  if (/\b(regra|prefer|sempre|nunca|usar|manter|evitar|decisao|arquitetura|deploy|design|contrato)\b/.test(normalized)) {
    score += 1.25;
  }
  return score;
}

function selectMemoryItems(entries = [], intentTerms = [], limit = 6) {
  const query = Array.isArray(intentTerms) ? intentTerms.join(' ') : String(intentTerms || '');
  const ranked = rankMemoryCandidates(entries, query, {
    limit: Math.max(1, Number(limit) || 6),
    minConfidence: query ? 0.04 : 0,
  });
  const fallbackRank = entries
    .map((entry, index) => ({
      ...(entry && typeof entry === 'object' ? entry : { text: String(entry || '') }),
      text: compactActiveMemoryText(readMemoryItemText(entry), 900),
      score: scoreMemoryItem(entry, intentTerms, index + 1),
      recency: index + 1,
    }))
    .filter((entry) => entry.text)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.recency - a.recency;
    });
  const rankedByConfidence = (ranked.used || []).map((entry, index) => ({
    ...entry,
    recency: index + 1,
  }));
  return (rankedByConfidence.length ? rankedByConfidence : fallbackRank)
    .slice(0, Math.max(1, Number(limit) || 6));
}

async function selectMemoryItemsAsync(entries = [], intentTerms = [], limit = 6, embeddingProvider = null) {
  if (!embeddingProvider || typeof embeddingProvider.embedMany !== 'function') {
    return selectMemoryItems(entries, intentTerms, limit);
  }
  const query = Array.isArray(intentTerms) ? intentTerms.join(' ') : String(intentTerms || '');
  const ranked = await rankMemoryCandidatesWithProvider(entries, query, {
    embeddingProvider,
    limit: Math.max(1, Number(limit) || 6),
    minConfidence: query ? 0.04 : 0,
  });
  const rankedByConfidence = (ranked.used || []).map((entry, index) => ({
    ...entry,
    recency: index + 1,
  }));
  return rankedByConfidence.length
    ? rankedByConfidence.slice(0, Math.max(1, Number(limit) || 6))
    : selectMemoryItems(entries, intentTerms, limit);
}

function formatMemoryItems(label = '', items = [], maxChars = 1200) {
  if (!Array.isArray(items) || !items.length) return '';
  const lines = items.map((item) => {
    const citation = item && item.citation && item.citation.title ? `[${item.citation.title}] ` : '';
    return `- ${citation}${compactActiveMemoryText(item.text || item, 320)}`;
  });
  return compactActiveMemoryBlock(`${label}:\n${lines.join('\n')}`, maxChars);
}

function formatConversationTail(conversationMessages = [], maxChars = 1100) {
  if (!Array.isArray(conversationMessages) || !conversationMessages.length) return '';
  const lines = conversationMessages
    .slice(-8)
    .map((message) => {
      const role = message && message.role === 'assistant' ? 'assistant' : 'user';
      const text = compactActiveMemoryText(
        message && (message.text || message.content || message.message) ? message.text || message.content || message.message : '',
        280
      );
      return text ? `${role}: ${text}` : '';
    })
    .filter(Boolean);
  return compactActiveMemoryBlock(lines.join('\n'), maxChars);
}

function summarizeAttachments(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) return [];
  return attachments.slice(0, 8).map((attachment) => ({
    name: attachment && attachment.name ? String(attachment.name) : 'anexo',
    type: attachment && attachment.type ? String(attachment.type) : '',
  }));
}

function readExternalRefs(source = {}) {
  if (!source || typeof source !== 'object') return [];
  if (Array.isArray(source.refs)) return source.refs;
  if (Array.isArray(source.citations)) return source.citations;
  return [];
}

function buildExternalCitation(sourceName = '', source = {}, fallback = {}) {
  if (!source || typeof source !== 'object') return null;
  const preview = source.contextText || source.text || source.message || fallback.preview || '';
  if (!preview && !source.ok) return null;
  return buildActiveMemoryCitation({
    source: sourceName,
    sourceType: fallback.sourceType || sourceName,
    sourceId: source.wing || source.provider || source.endpoint || fallback.sourceId || sourceName,
    title: fallback.title || source.wing || source.provider || sourceName,
    reason: source.retrievalReason || fallback.reason || 'retrieved_for_current_request',
    preview,
  });
}

function collectActiveMemoryCitations({
  userItems = [],
  projectItems = [],
  cortex = null,
  mempalace = null,
  mempalaceCore = null,
  rag = null,
} = {}) {
  const citations = [
    ...userItems.map((item) => item && item.citation).filter(Boolean),
    ...projectItems.map((item) => item && item.citation).filter(Boolean),
  ];
  if (cortex && cortex.available && cortex.contextText) {
    citations.push(buildActiveMemoryCitation({
      source: 'cortex_prompt_context',
      sourceType: 'project_memory',
      sourceId: 'cortex_prompt_context',
      title: 'Cortex selecionado',
      reason: 'selected_cortex_prompt_context',
      preview: cortex.contextText,
    }));
  }
  readExternalRefs(mempalace).forEach((ref, index) => {
    citations.push(buildActiveMemoryCitation({
      ...ref,
      source: ref.source || 'mempalace',
      sourceType: ref.sourceType || 'mempalace',
      sourceId: ref.sourceId || ref.id || `mempalace:${index + 1}`,
      reason: ref.reason || mempalace.retrievalReason || 'matched_mempalace_query',
    }));
  });
  const mempalaceFallback = buildExternalCitation('mempalace', mempalace, {
    sourceType: 'mempalace',
    title: 'MemPalace busca',
    reason: 'matched_mempalace_query',
  });
  if (mempalaceFallback) citations.push(mempalaceFallback);
  if (mempalaceCore && mempalaceCore.ok) {
    citations.push(buildActiveMemoryCitation({
      source: 'mempalace_core',
      sourceType: 'mempalace_core',
      sourceId: mempalaceCore.wing || 'mempalace_core',
      title: 'MemPalace core',
      reason: 'matched_mempalace_graph_context',
      preview: JSON.stringify({
        layers: mempalaceCore.layers ? Object.keys(mempalaceCore.layers) : [],
        kgFacts: mempalaceCore.kg && Array.isArray(mempalaceCore.kg.facts) ? mempalaceCore.kg.facts.length : 0,
      }),
    }));
  }
  readExternalRefs(rag).forEach((ref, index) => {
    citations.push(buildActiveMemoryCitation({
      ...ref,
      source: ref.source || 'rag',
      sourceType: ref.sourceType || 'rag',
      sourceId: ref.sourceId || ref.documentId || ref.id || `rag:${index + 1}`,
      reason: ref.reason || rag.retrievalReason || 'matched_rag_query',
    }));
  });
  const ragFallback = buildExternalCitation('rag', rag, {
    sourceType: 'rag',
    title: rag && rag.provider ? `RAG ${rag.provider}` : 'RAG',
    reason: 'matched_rag_query',
  });
  if (ragFallback) citations.push(ragFallback);
  return normalizeActiveMemoryCitations(citations);
}

function safeResult(result, fallback = {}) {
  if (!result || result.status === 'rejected') {
    const reason = result && result.reason && result.reason.message ? result.reason.message : 'unavailable';
    return { ok: false, available: false, reason, ...fallback };
  }
  return result.value || fallback;
}

function buildActiveMemoryGuardrails() {
  return [
    'A mensagem atual e a fonte de verdade para escopo, dominio e acao.',
    'Memoria de usuario ajusta preferencias, tom e decisoes recorrentes; ela nao cria novo escopo sozinha.',
    'Memoria de projeto preserva arquitetura, arquivos e decisoes tecnicas do projeto aberto.',
    'MemPalace/RAG/Cortex so entram quando forem relevantes ao pedido atual; ignore memoria antiga conflitante.',
  ];
}

function buildDecisionContexts({ current = {}, user = {}, project = {}, maxChars = 3600 } = {}) {
  const guardrails = buildActiveMemoryGuardrails();
  const citationLines = Array.isArray(current.citations)
    ? current.citations.slice(0, 10).map((citation) => `- ${citation.title}: ${citation.reason}`)
    : [];
  const citationBlock = citationLines.length ? `Citacoes recuperadas:\n${citationLines.join('\n')}` : '';
  const currentBlock = [
    'Mensagem atual:',
    compactActiveMemoryText(current.message || '', 900) || '[vazia]',
    current.conversationText ? `Historico recente:\n${current.conversationText}` : '',
  ].filter(Boolean).join('\n');
  const userBlock = user.contextText || 'Memoria de usuario: sem entradas acionaveis.';
  const projectBlock = project.contextText || 'Memoria de projeto: sem entradas acionaveis.';
  const guardrailBlock = `Politica de uso da memoria:\n${guardrails.map((line) => `- ${line}`).join('\n')}`;
  const base = [
    'Memoria ativa separada por fonte.',
    currentBlock,
    userBlock,
    projectBlock,
    citationBlock,
    guardrailBlock,
  ].join('\n\n');
  const clipped = compactActiveMemoryBlock(base, maxChars);
  const routeContextText = current.continuationIntent
    ? compactActiveMemoryBlock([
        currentBlock,
        user.contextText || '',
        project.routeContextText || project.contextText || '',
        citationBlock,
        guardrailBlock,
      ].filter(Boolean).join('\n\n'), Math.min(maxChars, 2600))
    : '';

  return {
    guardrails,
    routeContextText,
    briefingContextText: clipped,
    editContextText: compactActiveMemoryBlock([
      clipped,
      project.projectFilesText ? `Trechos de arquivos atuais:\n${project.projectFilesText}` : '',
    ].filter(Boolean).join('\n\n'), maxChars + 1800),
  };
}

function summarizeActiveMemory(activeMemory = null) {
  if (!activeMemory || typeof activeMemory !== 'object') {
    return {
      schemaVersion: ACTIVE_MEMORY_SCHEMA_VERSION,
      ok: false,
      reason: 'missing_active_memory',
    };
  }
  const project = activeMemory.project || {};
  const user = activeMemory.user || {};
  const current = activeMemory.current || {};
  return {
    schemaVersion: activeMemory.schemaVersion || ACTIVE_MEMORY_SCHEMA_VERSION,
    ok: Boolean(activeMemory.ok),
    stage: activeMemory.stage || '',
    projectId: activeMemory.projectId || null,
    scope: activeMemory.scope || null,
    validity: activeMemory.validity
      ? {
          expiresAt: activeMemory.validity.expiresAt || null,
          expired: Boolean(activeMemory.validity.expired),
          ttlMs: Number(activeMemory.validity.ttlMs || 0),
        }
      : null,
    citationsCount: Array.isArray(activeMemory.citations) ? activeMemory.citations.length : 0,
    retrievalReason: activeMemory.retrieval && activeMemory.retrieval.reason ? activeMemory.retrieval.reason : '',
    provenance: activeMemory.provenance
      ? {
          schemaVersion: activeMemory.provenance.schemaVersion || '',
          usedCount: Array.isArray(activeMemory.provenance.used) ? activeMemory.provenance.used.length : 0,
          blockedCount: Array.isArray(activeMemory.provenance.blocked) ? activeMemory.provenance.blocked.length : 0,
          confidence: activeMemory.provenance.confidence || null,
        }
      : null,
    continuationIntent: Boolean(current.continuationIntent),
    user: {
      available: Boolean(user.available),
      selectedCount: Number(user.selectedCount || 0),
    },
    project: {
      available: Boolean(project.available),
      selectedCount: Number(project.selectedCount || 0),
      hasProjectFiles: Boolean(project.projectFilesText),
      cortex: project.cortex && project.cortex.available ? 'available' : project.cortex ? project.cortex.reason || 'unavailable' : 'unset',
      mempalace: project.mempalace && project.mempalace.ok ? 'ok' : project.mempalace ? project.mempalace.reason || 'unavailable' : 'unset',
      rag: project.rag && project.rag.ok ? 'ok' : project.rag ? project.rag.reason || 'unavailable' : 'unset',
    },
  };
}

function createActiveMemoryService(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    buildCortexPromptContext = () => ({ available: false, reason: 'not_configured', contextText: '' }),
    buildMempalaceCortexCore = null,
    buildMempalacePlannerContext = null,
    buildProjectEvolutionContext = () => '',
    buildRagPlannerContext = null,
    clipText = compactActiveMemoryBlock,
    extractIntentTerms = fallbackIntentTerms,
    formatMempalaceCoreForPrompt = () => '',
    getCortexLearning = () => ({ ok: false, learning: null }),
    getRuntimeProfileSettings = () => ({ memoryContextChars: 1600 }),
    appendMemoryEvidence = null,
    embeddingProvider = null,
    now = () => new Date().toISOString(),
  } = dependencies;

  async function buildActiveMemoryContext({
    projectInfo = null,
    projectId = null,
    userMessage = '',
    attachments = [],
    contextHint = null,
    conversationMessages = [],
    userId = '',
    conversationId = '',
    jobId = '',
    runtimeSettings = null,
    stage = 'runtime',
  } = {}) {
    const settings = runtimeSettings || getRuntimeProfileSettings() || {};
    const resolvedProjectId = projectId || (projectInfo && projectInfo.id ? projectInfo.id : null);
    const scope = buildActiveMemoryScope({
      projectInfo,
      projectId: resolvedProjectId,
      userId,
      conversationId:
        conversationId ||
        (contextHint && contextHint.conversationId ? contextHint.conversationId : ''),
      jobId:
        jobId ||
        (contextHint && contextHint.jobId ? contextHint.jobId : ''),
      stage,
    });
    if (
      contextHint &&
      contextHint.activeMemory &&
      contextHint.activeMemory.schemaVersion === ACTIVE_MEMORY_SCHEMA_VERSION
    ) {
      const hintValidation = validateActiveMemoryForRequest(contextHint.activeMemory, scope, { now });
      if (hintValidation.ok) return contextHint.activeMemory;
      appendAuditEvent('cortex.active_memory_context_hint_ignored', {
        stage,
        reason: hintValidation.reason,
        mismatch: hintValidation.mismatch || null,
        scope,
      });
    }

    const memoryContextChars = Math.max(900, Math.min(5200, Number(settings.memoryContextChars || 1800)));
    const intentTerms = typeof extractIntentTerms === 'function'
      ? extractIntentTerms(userMessage || '')
      : fallbackIntentTerms(userMessage || '');
    const continuationIntent = isActiveMemoryContinuationMessage(userMessage);
    const conversationText = formatConversationTail(conversationMessages, 1200);
    const learningResult = resolvedProjectId ? getCortexLearning(resolvedProjectId) : { ok: false, learning: null };
    const learning = learningResult && learningResult.ok ? learningResult.learning || {} : {};

    const userEntries = readLearningEntries(learning, ['persona', 'ia2'], 'user_memory');
    const projectEntries = [
      ...readLearningEntries(learning, ['executor', 'ia1'], 'project_memory'),
      ...readLearningEventEntries(learning),
    ];
    const userItems = await selectMemoryItemsAsync(userEntries, intentTerms, settings.profile === 'rapido' ? 4 : 6, embeddingProvider);
    const projectItems = await selectMemoryItemsAsync(projectEntries, intentTerms, settings.profile === 'rapido' ? 5 : 8, embeddingProvider);

    let projectFilesText = '';
    if (projectInfo && projectInfo.rootPath) {
      try {
        projectFilesText = buildProjectEvolutionContext(projectInfo, userMessage, {
          maxFiles: Math.max(4, Math.min(10, Number(settings.engineSampleFilesLimit || settings.brainSampleFilesLimit || 8))),
          maxCharsPerFile: 850,
          totalMaxChars: 4300,
        });
      } catch {
        projectFilesText = '';
      }
    }

    const projectExternalPromises = [
      projectInfo && typeof buildMempalacePlannerContext === 'function'
        ? buildMempalacePlannerContext(projectInfo, userMessage)
        : Promise.resolve({ ok: false, available: false, reason: 'missing_project_or_mempalace' }),
      projectInfo && typeof buildMempalaceCortexCore === 'function'
        ? buildMempalaceCortexCore(projectInfo, userMessage, settings)
        : Promise.resolve({ ok: false, available: false, reason: 'missing_project_or_mempalace_core' }),
      projectInfo && typeof buildRagPlannerContext === 'function'
        ? buildRagPlannerContext(projectInfo, userMessage, attachments, settings)
        : Promise.resolve({ ok: false, available: false, reason: 'missing_project_or_rag' }),
    ];
    const [mempalaceResult, mempalaceCoreResult, ragResult] = await Promise.allSettled(projectExternalPromises);
    const mempalace = safeResult(mempalaceResult, { ok: false, available: false, reason: 'mempalace_unavailable' });
    const mempalaceCore = safeResult(mempalaceCoreResult, { ok: false, available: false, reason: 'mempalace_core_unavailable' });
    const rag = safeResult(ragResult, { ok: false, available: false, reason: 'rag_unavailable' });
    const cortex = buildCortexPromptContext(resolvedProjectId, userMessage, settings);

    const userContextText = formatMemoryItems('Memoria de usuario', userItems, Math.floor(memoryContextChars * 0.75));
    const projectContextParts = [
      projectInfo
        ? `Resumo do projeto: ${JSON.stringify({
            name: resolveProjectName(projectInfo),
            stacks: projectInfo.stacks || [],
            totalFiles: projectInfo.totalFiles || 0,
          })}`
        : '',
      formatMemoryItems('Memoria de projeto/Cortex', projectItems, Math.floor(memoryContextChars * 0.85)),
      cortex && cortex.available && cortex.contextText
        ? `Cortex selecionado:\n${clipText(cortex.contextText, Math.floor(memoryContextChars * 0.55))}`
        : '',
      mempalace && mempalace.contextText
        ? `MemPalace busca:\n${clipText(mempalace.contextText, Math.floor(memoryContextChars * 0.55))}`
        : '',
      mempalaceCore && mempalaceCore.ok
        ? `MemPalace core:\n${formatMempalaceCoreForPrompt(mempalaceCore, Math.floor(memoryContextChars * 0.65))}`
        : '',
      rag && rag.contextText
        ? `RAG (${rag.provider || 'r2r'}):\n${clipText(rag.contextText, Math.floor(memoryContextChars * 0.65))}`
        : '',
    ].filter(Boolean);

    const projectContextText = compactActiveMemoryBlock(projectContextParts.join('\n\n'), memoryContextChars * 2);
    const rawCitations = collectActiveMemoryCitations({
      userItems,
      projectItems,
      cortex,
      mempalace,
      mempalaceCore,
      rag,
    });
    const generatedAt = now();
    const validity = buildActiveMemoryValidity({
      generatedAt,
      now: generatedAt,
      ttlMs: settings.activeMemoryTtlMs || settings.memoryTtlMs || ACTIVE_MEMORY_DEFAULT_TTL_MS,
    });
    const citations = normalizeMemoryProvenanceCitations(rawCitations, {
      query: userMessage,
      scope,
      validity,
      timestamp: generatedAt,
    });
    const retrieval = {
      reason: continuationIntent
        ? 'current_message_requested_memory_continuation'
        : 'memory_context_built_for_guarded_runtime',
      query: String(userMessage || ''),
      intentTerms: Array.isArray(intentTerms) ? intentTerms.slice(0, 20) : fallbackIntentTerms(userMessage),
      scope,
      validity,
      sources: {
        user: userItems.length ? 'selected_by_intent_terms_and_preferences' : 'no_user_memory_selected',
        project: projectItems.length ? 'selected_by_intent_terms_and_project_rules' : 'no_project_memory_selected',
        cortex: cortex && cortex.available ? 'cortex_prompt_context_available' : cortex && cortex.reason ? cortex.reason : 'cortex_unavailable',
        mempalace: mempalace && mempalace.ok ? mempalace.retrievalReason || 'mempalace_query_match' : mempalace && mempalace.reason ? mempalace.reason : 'mempalace_unavailable',
        mempalaceCore: mempalaceCore && mempalaceCore.ok ? 'mempalace_core_graph_match' : mempalaceCore && mempalaceCore.reason ? mempalaceCore.reason : 'mempalace_core_unavailable',
        rag: rag && rag.ok ? rag.retrievalReason || 'rag_query_match' : rag && rag.reason ? rag.reason : 'rag_unavailable',
      },
      citationsCount: citations.length,
    };
    const current = {
      message: String(userMessage || ''),
      normalizedMessage: normalizeActiveMemoryText(userMessage),
      continuationIntent,
      intentTerms: Array.isArray(intentTerms) ? intentTerms.slice(0, 20) : fallbackIntentTerms(userMessage),
      conversationText,
      attachments: summarizeAttachments(attachments),
      citations,
      contextHint: {
        originalUserMessage: contextHint && contextHint.originalUserMessage ? String(contextHint.originalUserMessage) : '',
        routeExecutionMessage: contextHint && contextHint.routeExecutionMessage ? String(contextHint.routeExecutionMessage) : '',
        lastScaffoldPrompt: contextHint && contextHint.lastScaffoldPrompt ? String(contextHint.lastScaffoldPrompt) : '',
      },
    };
    const user = {
      available: Boolean(userItems.length),
      source: 'cortex_learning.persona',
      selectedCount: userItems.length,
      items: userItems,
      contextText: userContextText,
      citations: normalizeActiveMemoryCitations(userItems.map((item) => item.citation).filter(Boolean)),
    };
    const project = {
      available: Boolean(projectContextText || projectFilesText),
      source: 'project_cortex_mempalace_rag',
      selectedCount: projectItems.length,
      summary: {
        projectId: resolvedProjectId,
        rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
        name: resolveProjectName(projectInfo),
        stacks: projectInfo && Array.isArray(projectInfo.stacks) ? projectInfo.stacks : [],
        totalFiles: projectInfo && Number.isFinite(Number(projectInfo.totalFiles)) ? Number(projectInfo.totalFiles) : 0,
      },
      items: projectItems,
      contextText: projectContextText,
      routeContextText: compactActiveMemoryBlock(projectContextText, 1600),
      projectFilesText: compactActiveMemoryBlock(projectFilesText, 4300),
      citations: normalizeActiveMemoryCitations([
        ...projectItems.map((item) => item.citation).filter(Boolean),
        ...citations.filter((citation) => citation.sourceType !== 'user_memory'),
      ]),
      cortex,
      mempalace,
      mempalaceCore,
      rag,
    };
    const decision = buildDecisionContexts({ current, user, project, maxChars: memoryContextChars * 2 });
    const provenance = buildMemoryProvenanceReport({
      query: userMessage,
      scope,
      validity,
      citations,
      candidateBuckets: {
        user: userItems.length,
        project: projectItems.length,
      },
      sourceStatus: retrieval.sources,
      decision,
      timestamp: generatedAt,
    });
    const activeMemory = {
      schemaVersion: ACTIVE_MEMORY_SCHEMA_VERSION,
      ok: true,
      stage,
      projectId: resolvedProjectId,
      generatedAt,
      scope,
      validity,
      retrieval,
      citations,
      current,
      user,
      project,
      decision,
      provenance,
    };

    appendAuditEvent('cortex.active_memory_built', summarizeActiveMemory(activeMemory));
    if (typeof appendMemoryEvidence === 'function') {
      appendMemoryEvidence({
        action: 'build_active_memory',
        ok: true,
        status: 'succeeded',
        projectInfo,
        projectId: resolvedProjectId,
        jobId,
        query: userMessage,
        decision,
        provenance,
        message: 'Memória ativa construída com provenance auditável.',
      });
    }
    return activeMemory;
  }

  return {
    buildActiveMemoryContext,
    summarizeActiveMemory,
  };
}

module.exports = {
  ACTIVE_MEMORY_SCHEMA_VERSION,
  buildActiveMemoryGuardrails,
  compactActiveMemoryBlock,
  compactActiveMemoryText,
  createActiveMemoryService,
  isActiveMemoryContinuationMessage,
  normalizeActiveMemoryText,
  selectMemoryItemsAsync,
  summarizeActiveMemory,
};
