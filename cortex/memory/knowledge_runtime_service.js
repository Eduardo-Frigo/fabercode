function createKnowledgeRuntimeService(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    buildRagPlannerContext,
    getCortexLearning,
    getMempalaceRuntimeStatus,
    getRagRuntimeStatus,
    searchMempalaceContext,
    syncCortexMemory,
  } = dependencies;

  function summarizeCortexLearning(learning) {
    const source = learning && typeof learning === 'object' ? learning : {};
    const persona = Array.isArray(source.persona) ? source.persona : Array.isArray(source.ia2) ? source.ia2 : [];
    const executor = Array.isArray(source.executor) ? source.executor : Array.isArray(source.ia1) ? source.ia1 : [];
    const events = Array.isArray(source.events) ? source.events : [];
    const documents = events.filter((event) => event && event.type === 'cortex.attachment_learned');
    const topics = new Set(events.map((event) => String(event && event.topic ? event.topic : 'geral').trim()).filter(Boolean));

    return {
      rulesCount: persona.length + executor.length,
      personaRulesCount: persona.length,
      executorRulesCount: executor.length,
      eventsCount: events.length,
      documentsCount: documents.length,
      topicsCount: topics.size,
      updatedAt: source.updatedAt || null,
    };
  }

  function normalizeChannelStatus(status = {}, fallback = {}) {
    const source = status && typeof status === 'object' ? status : {};
    const available = source.available !== undefined ? Boolean(source.available) : Boolean(source.ok);
    const ready =
      source.ready !== undefined
        ? Boolean(source.ready)
        : source.searchable !== undefined
          ? Boolean(source.searchable)
          : Boolean(source.ok && available);
    return {
      ok: source.ok !== undefined ? Boolean(source.ok) : true,
      available,
      ready,
      reason: source.reason || fallback.reason || null,
      message: source.message || source.hint || fallback.message || null,
      provider: source.provider || fallback.provider || null,
      endpoint: source.endpoint || null,
    };
  }

  async function getKnowledgeRuntimeStatus(input = {}) {
    const projectId = input.projectId || null;
    const projectInfo = input.projectInfo && typeof input.projectInfo === 'object' ? input.projectInfo : null;
    const learningResult =
      projectId && typeof getCortexLearning === 'function'
        ? getCortexLearning(projectId)
        : { ok: false, reason: 'missing_project_id', learning: null };
    const learning = learningResult && learningResult.ok ? learningResult.learning : null;

    const cortex = {
      ok: true,
      available: true,
      ready: true,
      reason: learning ? 'learning_loaded' : 'empty_learning',
      projectScoped: Boolean(projectId),
      ...summarizeCortexLearning(learning),
    };

    let mempalace = { ok: false, available: false, ready: false, reason: 'not_configured' };
    if (typeof getMempalaceRuntimeStatus === 'function' && projectInfo) {
      try {
        mempalace = await getMempalaceRuntimeStatus(projectInfo);
      } catch (error) {
        mempalace = { ok: false, available: false, ready: false, reason: 'mempalace_exception', message: error.message };
      }
    }

    let rag = { ok: false, available: false, ready: false, reason: 'not_configured' };
    if (typeof getRagRuntimeStatus === 'function') {
      try {
        rag = await getRagRuntimeStatus();
      } catch (error) {
        rag = { ok: false, available: false, ready: false, reason: 'rag_exception', message: error.message };
      }
    }

    const normalizedMempalace = normalizeChannelStatus(mempalace, { provider: 'mempalace' });
    const normalizedRag = normalizeChannelStatus(rag, { provider: 'rag' });
    const memoryBackendsReady = Boolean(normalizedMempalace.ready || normalizedRag.ready);

    return {
      ok: true,
      ready: cortex.ready,
      mode: memoryBackendsReady ? 'integrated' : 'local_only',
      projectId,
      projectRoot: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      cortex,
      mempalace: normalizedMempalace,
      rag: normalizedRag,
      warnings: [
        normalizedMempalace.ready ? null : `MemPalace: ${normalizedMempalace.reason || 'indisponível'}`,
        normalizedRag.ready ? null : `RAG: ${normalizedRag.reason || 'indisponível'}`,
      ].filter(Boolean),
    };
  }

  function buildSyncMessage(syncResult = {}) {
    const mempalace = normalizeChannelStatus(syncResult.mempalace, { provider: 'mempalace' });
    const rag = normalizeChannelStatus(syncResult.rag, { provider: 'rag' });
    const mempalaceText = mempalace.ready ? 'MemPalace recebeu a memória' : `MemPalace pendente (${mempalace.reason || 'indisponível'})`;
    const ragText = rag.ready ? 'RAG indexou a referência' : `RAG pendente (${rag.reason || 'indisponível'})`;
    return `Memória registrada no Cortex. ${mempalaceText}; ${ragText}.`;
  }

  async function syncKnowledgeFromCortex(input = {}) {
    if (typeof syncCortexMemory !== 'function') {
      return {
        ok: false,
        reason: 'sync_not_configured',
        message: 'Sincronização Cortex/MemPalace/RAG não configurada.',
      };
    }

    const result = await syncCortexMemory(input);
    const status = await getKnowledgeRuntimeStatus({
      projectId: input.projectId || null,
      projectInfo: input.projectInfo || null,
    });

    appendAuditEvent('knowledge.runtime_sync', {
      projectId: input.projectId || null,
      topic: result && result.entry ? result.entry.topic : input.topic || 'geral',
      mode: status.mode,
      mempalace: status.mempalace,
      rag: status.rag,
    });

    return {
      ...result,
      status,
      message: buildSyncMessage(result),
    };
  }

  async function searchKnowledge(input = {}) {
    const projectInfo = input.projectInfo && typeof input.projectInfo === 'object' ? input.projectInfo : null;
    const query = String(input.query || '').trim();
    if (!query) {
      return { ok: false, reason: 'empty_query', message: 'Informe uma busca para consultar a memória.' };
    }

    const result = {
      ok: true,
      query,
      mempalace: { ok: false, reason: 'not_configured' },
      rag: { ok: false, reason: 'not_configured' },
    };

    if (projectInfo && typeof searchMempalaceContext === 'function') {
      try {
        result.mempalace = await searchMempalaceContext(query, projectInfo, input.nResults || 4);
      } catch (error) {
        result.mempalace = { ok: false, reason: 'mempalace_exception', message: error.message };
      }
    }

    if (projectInfo && typeof buildRagPlannerContext === 'function') {
      try {
        result.rag = await buildRagPlannerContext(projectInfo, query, [], input.runtimeSettings || null);
      } catch (error) {
        result.rag = { ok: false, reason: 'rag_exception', message: error.message };
      }
    }

    result.hasResults = Boolean(
      (result.mempalace && result.mempalace.ok && result.mempalace.text) ||
        (result.rag && result.rag.ok && result.rag.contextText)
    );
    return result;
  }

  return {
    buildSyncMessage,
    getKnowledgeRuntimeStatus,
    searchKnowledge,
    summarizeCortexLearning,
    syncKnowledgeFromCortex,
  };
}

module.exports = {
  createKnowledgeRuntimeService,
};
