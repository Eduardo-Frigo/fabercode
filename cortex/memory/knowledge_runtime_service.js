const {
  buildMemoryProvenanceReport,
  normalizeMemoryProvenanceCitations,
} = require('./memory_provenance_service');

function createKnowledgeRuntimeService(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    appendMemoryEvidence = null,
    buildRagPlannerContext,
    forgetMempalaceMemory,
    forgetRagMemory,
    getCortexLearning,
    getEmbeddingRuntimeStatus,
    getMempalaceRuntimeStatus,
    getRagRuntimeStatus,
    listCortexMemories,
    manageCortexMemory,
    reindexMempalaceProject,
    reindexRagProject,
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
    const embedding = typeof getEmbeddingRuntimeStatus === 'function'
      ? normalizeChannelStatus(getEmbeddingRuntimeStatus(), { provider: 'embedding' })
      : { ok: true, available: true, ready: true, reason: 'local_embedding_ready', provider: 'local' };
    const memoryBackendsReady = Boolean(normalizedMempalace.ready || normalizedRag.ready);

    return {
      ok: true,
      ready: cortex.ready,
      mode: memoryBackendsReady ? 'integrated' : 'local_only',
      projectId,
      projectRoot: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      cortex,
      embedding,
      mempalace: normalizedMempalace,
      rag: normalizedRag,
      warnings: [
        embedding.ready ? null : `Embedding: ${embedding.reason || 'indisponível'}`,
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
    if (typeof appendMemoryEvidence === 'function') {
      appendMemoryEvidence({
        action: 'sync_cortex_memory',
        ok: Boolean(result && result.ok),
        status: result && result.ok ? 'succeeded' : 'failed',
        projectInfo: input.projectInfo || null,
        projectId: input.projectId || null,
        jobId: input.jobId || null,
        query: input.userMessage || '',
        lifecycle: {
          topic: result && result.entry ? result.entry.topic : input.topic || 'geral',
          entryId: result && result.entry ? result.entry.id : null,
          mempalace: result && result.mempalace ? result.mempalace : null,
          rag: result && result.rag ? result.rag : null,
          status,
        },
        message: buildSyncMessage(result),
      });
    }

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
    const citations = normalizeMemoryProvenanceCitations([
      ...(result.mempalace && Array.isArray(result.mempalace.refs) ? result.mempalace.refs : []),
      ...(result.mempalace && result.mempalace.text ? [{
        source: 'mempalace',
        sourceType: 'mempalace',
        sourceId: result.mempalace.wing || result.mempalace.drawerId || 'mempalace-search',
        title: 'MemPalace busca',
        reason: result.mempalace.retrievalReason || 'matched_mempalace_query',
        preview: result.mempalace.text,
      }] : []),
      ...(result.rag && Array.isArray(result.rag.refs) ? result.rag.refs : []),
      ...(result.rag && result.rag.contextText ? [{
        source: 'rag',
        sourceType: 'rag',
        sourceId: result.rag.provider || 'rag-search',
        title: result.rag.provider ? `RAG ${result.rag.provider}` : 'RAG',
        reason: result.rag.retrievalReason || 'matched_rag_query',
        preview: result.rag.contextText,
      }] : []),
    ], {
      query,
      timestamp: new Date().toISOString(),
    });
    result.provenance = buildMemoryProvenanceReport({
      query,
      citations,
      sourceStatus: {
        mempalace: result.mempalace && (result.mempalace.reason || (result.mempalace.ok ? 'ok' : 'unknown')),
        rag: result.rag && (result.rag.reason || (result.rag.ok ? 'ok' : 'unknown')),
      },
      decision: {
        routeContextText: '',
        briefingContextText:
          (result.mempalace && result.mempalace.text) ||
          (result.rag && result.rag.contextText) ||
          '',
      },
    });
    if (typeof appendMemoryEvidence === 'function') {
      appendMemoryEvidence({
        action: 'search_memory',
        ok: result.ok,
        status: result.hasResults ? 'succeeded' : 'empty',
        projectInfo,
        query,
        provenance: result.provenance,
        message: result.hasResults ? 'Busca de memória retornou contexto.' : 'Busca de memória sem resultados.',
      });
    }
    return result;
  }

  async function runMemoryLifecycleOperation(input = {}) {
    const action = String(input.action || 'status').trim().toLowerCase();
    const projectInfo = input.projectInfo && typeof input.projectInfo === 'object' ? input.projectInfo : null;
    const projectId = input.projectId || null;
    const lifecycle = {
      action,
      projectId,
      topic: input.topic || 'geral',
      memoryId: input.memoryId || null,
      steps: [],
    };

    if (action === 'list') {
      if (typeof listCortexMemories !== 'function') {
        return {
          ok: false,
          action,
          reason: 'memory_list_not_configured',
          message: 'Listagem de memórias do Cortex não configurada.',
          lifecycle,
        };
      }
      const listed = listCortexMemories({
        projectId,
        topic: input.topic || '',
        includeExpired: input.includeExpired !== false,
        limit: input.limit || 80,
      });
      lifecycle.steps.push({ id: 'list_cortex_memories', ok: Boolean(listed && listed.ok), total: listed && listed.total ? listed.total : 0 });
      const result = {
        ok: Boolean(listed && listed.ok),
        action,
        memories: listed && Array.isArray(listed.memories) ? listed.memories : [],
        total: listed && Number.isFinite(Number(listed.total)) ? Number(listed.total) : 0,
        lifecycle,
        message: listed && listed.ok ? 'Memórias do Cortex carregadas.' : listed.message || 'Falha ao carregar memórias.',
      };
      if (typeof appendMemoryEvidence === 'function') {
        appendMemoryEvidence({
          action: 'lifecycle_list',
          ok: result.ok,
          status: result.ok ? 'succeeded' : 'failed',
          projectInfo,
          projectId,
          lifecycle,
          message: result.message,
        });
      }
      return result;
    }

    if (action === 'status' || action === 'validate') {
      const status = await getKnowledgeRuntimeStatus({ projectId, projectInfo });
      lifecycle.steps.push({ id: 'runtime_status', ok: Boolean(status && status.ok), mode: status.mode || '' });
      const result = {
        ok: true,
        action,
        status,
        lifecycle,
        message: action === 'validate' ? 'Runtime de memória validado.' : 'Status de memória carregado.',
      };
      if (typeof appendMemoryEvidence === 'function') {
        appendMemoryEvidence({
          action: `lifecycle_${action}`,
          ok: true,
          status: 'succeeded',
          projectInfo,
          projectId,
          lifecycle,
          message: result.message,
        });
      }
      return result;
    }

    if (action === 'sync') {
      const sync = await syncKnowledgeFromCortex(input);
      lifecycle.steps.push({
        id: 'sync_cortex_memory',
        ok: Boolean(sync && sync.ok),
        mempalace: sync && sync.mempalace ? sync.mempalace.reason || (sync.mempalace.ok ? 'ok' : 'unknown') : 'unknown',
        rag: sync && sync.rag ? sync.rag.reason || (sync.rag.ok ? 'ok' : 'unknown') : 'unknown',
      });
      return {
        ok: Boolean(sync && sync.ok),
        action,
        sync,
        lifecycle,
        message: sync && sync.message ? sync.message : 'Sincronização de memória executada.',
      };
    }

    if (action === 'reindex') {
      let mempalace = { ok: false, reason: 'mempalace_reindex_not_configured' };
      let rag = { ok: false, reason: 'rag_reindex_not_configured' };
      if (projectInfo && typeof reindexMempalaceProject === 'function') {
        try {
          mempalace = await reindexMempalaceProject(projectInfo);
        } catch (error) {
          mempalace = { ok: false, reason: 'mempalace_reindex_exception', message: error.message };
        }
      }
      if (projectInfo && typeof reindexRagProject === 'function') {
        try {
          rag = await reindexRagProject(projectInfo, input);
        } catch (error) {
          rag = { ok: false, reason: 'rag_reindex_exception', message: error.message };
        }
      }
      lifecycle.steps.push({ ...mempalace, id: 'reindex_mempalace' });
      lifecycle.steps.push({ ...rag, id: 'reindex_rag' });
      const ok = Boolean((mempalace && mempalace.ok) || (rag && rag.ok));
      const result = {
        ok,
        action,
        mempalace,
        rag,
        lifecycle,
        message: ok
          ? 'Reindexação solicitada para os backends disponíveis.'
          : 'Nenhum backend de reindexação está configurado para este projeto.',
      };
      if (typeof appendMemoryEvidence === 'function') {
        appendMemoryEvidence({
          action: 'lifecycle_reindex',
          ok,
          status: ok ? 'succeeded' : 'pending',
          projectInfo,
          projectId,
          lifecycle,
          message: result.message,
        });
      }
      return result;
    }

    if (['edit', 'promote', 'expire', 'delete'].includes(action)) {
      if (typeof manageCortexMemory !== 'function') {
        return {
          ok: false,
          action,
          reason: 'memory_management_not_configured',
          message: 'Gestão local de memórias não configurada.',
          lifecycle,
        };
      }

      const managed = manageCortexMemory(input);
      lifecycle.steps.push({
        id: `manage_cortex_memory_${action}`,
        ok: Boolean(managed && managed.ok),
        status: managed && managed.memory ? managed.memory.status : null,
      });
      if (!managed || !managed.ok) {
        return {
          ok: false,
          action,
          reason: managed && managed.reason ? managed.reason : 'memory_management_failed',
          message: managed && managed.message ? managed.message : 'Falha ao atualizar memória local.',
          lifecycle,
        };
      }

      let sync = null;
      let mempalace = { ok: false, reason: 'not_required' };
      let rag = { ok: false, reason: 'not_required' };
      const memory = managed.memory || {};
      if (action === 'edit' || action === 'promote') {
        sync = await syncKnowledgeFromCortex({
          projectId,
          projectInfo,
          topic: memory.topic || input.topic || 'geral',
          userMessage: memory.text || input.text || '',
          memoryId: memory.memoryId || memory.id || input.memoryId,
          status: memory.status || 'active',
          promoted: Boolean(memory.promoted),
          scope: memory.scope || 'project',
          expiresAt: memory.expiresAt || null,
          validity: memory.validity || null,
          updatedAt: memory.updatedAt || null,
          lifecycleAction: action,
        });
        lifecycle.steps.push({
          id: `sync_${action}_memory`,
          ok: Boolean(sync && sync.ok),
          mempalace: sync && sync.mempalace ? sync.mempalace.reason || (sync.mempalace.ok ? 'ok' : 'unknown') : 'unknown',
          rag: sync && sync.rag ? sync.rag.reason || (sync.rag.ok ? 'ok' : 'unknown') : 'unknown',
        });
      }
      if (action === 'expire' || action === 'delete') {
        if (typeof forgetMempalaceMemory === 'function') {
          try {
            mempalace = await forgetMempalaceMemory({
              ...input,
              projectInfo,
              projectId,
              memoryId: input.memoryId,
              action,
              reason: action === 'expire' ? 'memory_expired_by_user' : 'memory_deleted_by_user',
            });
          } catch (error) {
            mempalace = { ok: false, reason: 'mempalace_forget_exception', message: error.message };
          }
        } else {
          mempalace = { ok: false, reason: 'mempalace_forget_not_configured' };
        }
        if (typeof forgetRagMemory === 'function') {
          try {
            rag = await forgetRagMemory({
              ...input,
              projectInfo,
              projectId,
              memoryId: input.memoryId,
              topic: memory.topic || input.topic || null,
              action,
              reason: action === 'expire' ? 'memory_expired_by_user' : 'memory_deleted_by_user',
            });
          } catch (error) {
            rag = { ok: false, reason: 'rag_forget_exception', message: error.message };
          }
        } else {
          rag = { ok: false, reason: 'rag_forget_not_configured' };
        }
        lifecycle.steps.push({ ...mempalace, id: `${action}_mempalace_memory` });
        lifecycle.steps.push({ ...rag, id: `${action}_rag_memory` });
      }

      const ok = Boolean(managed.ok);
      const result = {
        ok,
        action,
        memory,
        learning: managed.learning || null,
        sync,
        mempalace,
        rag,
        lifecycle,
        message:
          action === 'edit'
            ? 'Memória editada e sincronização solicitada.'
            : action === 'promote'
              ? 'Memória promovida e sincronização solicitada.'
              : action === 'expire'
                ? 'Memória expirada localmente e remoção externa solicitada.'
                : 'Memória apagada localmente e remoção externa solicitada.',
      };
      if (typeof appendMemoryEvidence === 'function') {
        appendMemoryEvidence({
          action: `lifecycle_${action}`,
          ok,
          status: ok ? 'succeeded' : 'failed',
          projectInfo,
          projectId,
          lifecycle,
          message: result.message,
        });
      }
      return result;
    }

    if (action === 'forget') {
      let mempalace = { ok: false, reason: 'mempalace_forget_not_configured' };
      let rag = { ok: false, reason: 'rag_forget_not_configured' };
      if (typeof forgetMempalaceMemory === 'function') {
        try {
          mempalace = await forgetMempalaceMemory(input);
        } catch (error) {
          mempalace = { ok: false, reason: 'mempalace_forget_exception', message: error.message };
        }
      }
      if (typeof forgetRagMemory === 'function') {
        try {
          rag = await forgetRagMemory(input);
        } catch (error) {
          rag = { ok: false, reason: 'rag_forget_exception', message: error.message };
        }
      }
      lifecycle.steps.push({ ...mempalace, id: 'forget_mempalace' });
      lifecycle.steps.push({ ...rag, id: 'forget_rag' });
      const ok = Boolean((mempalace && mempalace.ok) || (rag && rag.ok));
      const result = {
        ok,
        action,
        mempalace,
        rag,
        lifecycle,
        message: ok
          ? 'Memória removida dos backends disponíveis.'
          : 'Esquecimento ainda não configurado para MemPalace/RAG.',
      };
      if (typeof appendMemoryEvidence === 'function') {
        appendMemoryEvidence({
          action: 'lifecycle_forget',
          ok,
          status: ok ? 'succeeded' : 'pending',
          projectInfo,
          projectId,
          lifecycle,
          message: result.message,
        });
      }
      return result;
    }

    return {
      ok: false,
      action,
      reason: 'memory_lifecycle_action_unsupported',
      message: `Ação de ciclo de memória não suportada: ${action}`,
      lifecycle,
    };
  }

  return {
    buildSyncMessage,
    getKnowledgeRuntimeStatus,
    runMemoryLifecycleOperation,
    searchKnowledge,
    summarizeCortexLearning,
    syncKnowledgeFromCortex,
  };
}

module.exports = {
  createKnowledgeRuntimeService,
};
