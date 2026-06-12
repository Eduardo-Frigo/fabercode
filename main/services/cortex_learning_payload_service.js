function createCortexLearningPayloadService(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    clipText = (value) => String(value || ''),
    extractAttachmentText = async () => '',
    path,
    syncKnowledgeFromCortex = async () => ({ ok: false, reason: 'sync_not_configured' }),
    upsertCortexLearning,
    now = () => new Date().toISOString(),
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Cortex learning payload dependency missing: ${name}`);
  }

  async function processCortexLearningPayload({ projectId, userMessage, attachments = [], projectInfo, topic = 'geral' }) {
    requireDependency('path', path);
    requireDependency('upsertCortexLearning', upsertCortexLearning);
    if (!projectId) {
      return { ok: false, message: 'Projeto inválido para modo Cortex.' };
    }

    const normalizedTopic = String(topic || 'geral').trim().toLowerCase() || 'geral';
    const personaLearned = [];
    const executorLearned = [];
    const events = [];
    const attachmentLearning = [];

    const normalizedUserMessage = clipText(userMessage || '', 5000);
    if (normalizedUserMessage) {
      personaLearned.push(`Entendimento do usuário: ${normalizedUserMessage}`);
      executorLearned.push('Recebeu novos requisitos funcionais em linguagem natural, prontos para virar tarefas executáveis.');
      events.push({
        type: 'cortex.user_input',
        text: normalizedUserMessage,
        topic: normalizedTopic,
        createdAt: now(),
      });
    }

    for (const attachment of attachments) {
      const filePath = attachment.path || '';
      const fileName = attachment.name || path.basename(filePath || 'arquivo');
      const extractedText = await extractAttachmentText(filePath);
      const learnedSnippet = extractedText
        ? clipText(extractedText, 700)
        : 'Não foi possível extrair texto automaticamente. Arquivo registrado para consulta manual.';

      attachmentLearning.push({
        name: fileName,
        path: filePath,
        summary: learnedSnippet,
      });
    }

    if (attachmentLearning.length) {
      attachmentLearning.forEach((entry) => {
        personaLearned.push(`Documento "${entry.name}": ${entry.summary}`);
        executorLearned.push(
          `Requisito técnico absorvido de "${entry.name}" e convertido em instruções operacionais quando necessário.`
        );
        events.push({
          type: 'cortex.attachment_learned',
          fileName: entry.name,
          summary: entry.summary,
          topic: normalizedTopic,
          createdAt: now(),
        });
      });
    }

    const upsert = upsertCortexLearning(projectId, {
      persona: personaLearned,
      executor: executorLearned,
      events,
    });
    if (!upsert.ok) return upsert;

    const syncResult = await syncKnowledgeFromCortex({
      projectId,
      projectInfo,
      topic: normalizedTopic,
      userMessage: normalizedUserMessage,
      attachments,
      attachmentLearning,
      learning: upsert.learning,
    });

    appendAuditEvent('cortex.learning_updated', {
      projectId,
      rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      attachments: attachments.map((attachment) => ({ name: attachment.name, type: attachment.type || null })),
      topic: normalizedTopic,
      userMessageSize: normalizedUserMessage.length,
      sync: {
        mempalace: syncResult && syncResult.mempalace ? syncResult.mempalace.reason || (syncResult.mempalace.ok ? 'ok' : 'unknown') : 'unknown',
        rag: syncResult && syncResult.rag ? syncResult.rag.reason || (syncResult.rag.ok ? 'ok' : 'unknown') : 'unknown',
      },
    });

    return {
      ok: true,
      message:
        syncResult && syncResult.message
          ? syncResult.message
          : 'Memória registrada. A Persona recebeu o contexto e o Executor recebeu regras para próximas tarefas.',
      learning: upsert.learning,
      sync: syncResult,
      knowledgeStatus: syncResult && syncResult.status ? syncResult.status : null,
    };
  }

  return {
    processCortexLearningPayload,
  };
}

module.exports = {
  createCortexLearningPayloadService,
};
