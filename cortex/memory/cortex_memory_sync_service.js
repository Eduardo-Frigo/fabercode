function createCortexMemorySyncService(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    clipText = (value, max = 4000) => String(value || '').slice(0, max),
    indexCortexMemoryInRag,
    persistCortexMemoryToMempalace,
  } = dependencies;

  function normalizeTopic(topic) {
    const normalized = String(topic || 'geral').trim().toLowerCase();
    return normalized || 'geral';
  }

  function buildCortexMemoryEntry(input = {}) {
    const projectInfo = input.projectInfo && typeof input.projectInfo === 'object' ? input.projectInfo : {};
    const topic = normalizeTopic(input.topic);
    const createdAt = new Date().toISOString();
    const documents = Array.isArray(input.attachmentLearning)
      ? input.attachmentLearning.map((entry) => ({
          name: entry.name || 'documento',
          path: entry.path || '',
          summary: clipText(entry.summary || '', 1200),
        }))
      : [];

    const lines = [
      `topic:${topic}`,
      input.userMessage ? `user_message:${clipText(input.userMessage, 2400)}` : null,
      documents.length
        ? `documents:\n${documents.map((doc) => `- ${doc.name}: ${clipText(doc.summary, 700)}`).join('\n')}`
        : null,
    ].filter(Boolean);

    return {
      id: `cortex-memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'cortex_memory',
      topic,
      projectId: input.projectId || null,
      projectName: projectInfo.rootPath ? String(projectInfo.rootPath).split(/[\\/]/).filter(Boolean).pop() : null,
      rootPath: projectInfo.rootPath || null,
      userMessage: clipText(input.userMessage || '', 5000),
      documents,
      content: clipText(lines.join('\n\n'), 9000),
      createdAt,
    };
  }

  function summarizeSyncResult(result) {
    if (!result || typeof result !== 'object') return { ok: false, reason: 'empty_result' };
    return {
      ok: Boolean(result.ok),
      reason: result.reason || null,
      available: result.available !== undefined ? Boolean(result.available) : null,
      provider: result.provider || null,
      id: result.id || result.documentId || result.drawerId || null,
    };
  }

  async function syncCortexMemory(input = {}) {
    const entry = buildCortexMemoryEntry(input);
    const result = {
      ok: true,
      entry,
      mempalace: { ok: false, reason: 'not_configured' },
      rag: { ok: false, reason: 'not_configured' },
    };

    if (typeof persistCortexMemoryToMempalace === 'function') {
      try {
        result.mempalace = await persistCortexMemoryToMempalace(input.projectInfo, entry);
      } catch (error) {
        result.mempalace = { ok: false, reason: 'mempalace_exception', message: error.message };
      }
    }

    if (typeof indexCortexMemoryInRag === 'function') {
      try {
        result.rag = await indexCortexMemoryInRag(input.projectInfo, entry);
      } catch (error) {
        result.rag = { ok: false, reason: 'rag_exception', message: error.message };
      }
    }

    appendAuditEvent('cortex.memory_sync', {
      projectId: input.projectId || null,
      topic: entry.topic,
      documents: entry.documents.map((doc) => doc.name),
      mempalace: summarizeSyncResult(result.mempalace),
      rag: summarizeSyncResult(result.rag),
    });

    return result;
  }

  return {
    buildCortexMemoryEntry,
    syncCortexMemory,
  };
}

module.exports = {
  createCortexMemorySyncService,
};
