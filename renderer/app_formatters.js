(function () {
  function buildDiagnosticsContextHint(report) {
    if (!report || typeof report !== 'object') return null;
    const issues = Array.isArray(report.issues) ? report.issues : [];
    if (!issues.length) return null;
    return {
      summary: report.summary || null,
      issues: issues.slice(0, 8).map((issue) => ({
        file: issue.file || 'arquivo_desconhecido',
        severity: issue.severity || 'warning',
        detail: issue.detail || '',
        hint: issue.hint || '',
        source: issue.source || '',
      })),
    };
  }

  function buildJobContextForPersona(job) {
    if (!job) return null;
    const request = job.request && typeof job.request === 'object' ? job.request : {};
    return {
      status: job.status || null,
      phase: job.phase || null,
      lastError: job.lastError || null,
      lastUserMessage: request.userMessage || null,
      retryable: job.retryState ? job.retryState.retryable !== false : null,
      failedAt: job.updatedAt || job.completedAt || null,
    };
  }

  function isManualRetryMessage(text = '') {
    const normalized = String(text || '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return /^(tente novamente|tenta novamente|tentar novamente|retente|retentar|continue|continua|de novo|tente de novo|repita|pode tentar novamente)$/.test(normalized);
  }

  function buildExecutionOutcomeAssistantMessage(result, action, qualityReport) {
    const isOk = Boolean(result && result.ok);
    const blockedByValidation = Boolean(result && result.blockedByPostExecutionValidation);
    const blockedByEffect = Boolean(result && result.blockedByExecutionEffect);
    const modifiedFiles = Array.isArray(result && result.modifiedFiles) ? result.modifiedFiles : [];
    const summary = qualityReport && qualityReport.summary ? qualityReport.summary : {};
    const errors = Math.max(0, Number(summary.errors || 0));
    const totals = result && result.executionReport && result.executionReport.totals ? result.executionReport.totals : {};
    const add = Math.max(0, Number(totals.add || 0));
    const del = Math.max(0, Number(totals.del || 0));
    const totalDelta = add + del;
    const effectOk = !blockedByEffect && (modifiedFiles.length > 0 || totalDelta > 0 || !blockedByValidation);

    if (isOk && effectOk && errors === 0) {
      return modifiedFiles.length
        ? `Concluído: apliquei a alteração e validei o projeto.`
        : `Concluído: validei a tarefa e não precisei alterar arquivos.`;
    }

    if (blockedByValidation || errors > 0) {
      return 'Parei antes de concluir: a validação real encontrou um problema e o projeto foi preservado.';
    }

    if (blockedByEffect) {
      return 'Parei antes de concluir: a mudança proposta não alterou o projeto de forma útil.';
    }

    return isOk
      ? 'Concluído.'
      : 'Parei antes de concluir: preciso corrigir a causa mostrada no progresso da execução.';
  }

  function shouldSuppressInterimAssistantPlanMessage(plan) {
    const response = String((plan && plan.response) || '').trim();
    if (/^\s*[{`]/.test(response) && /"decision"\s*:/i.test(response)) return true;
    if (plan && plan.action) return true;
  
    const reason = String((plan && plan.meta && plan.meta.reason) || '').toLowerCase();
    if (!reason) return false;
    if (reason.startsWith('cortex_briefing_error')) return true;
    if (reason.startsWith('cortex_validation_score:')) return true;
    if (reason === 'cortex_validation_unmet' || reason.startsWith('cortex_validation_unmet')) return true;
    if (reason === 'paused_memory_pressure') return true;
    if (reason.includes('retry')) return true;
    return false;
  }

  function parseProviderHttpStatusFromReason(reason) {
    const text = String(reason || '');
    const match = text.match(/http\s*(\d{3})/i);
    return match ? Number(match[1]) : null;
  }

  function buildTerminalJobMessage(job) {
    if (!job) return null;
    if (job.status === 'completed') {
      const completedEvent = Array.isArray(job.events)
        ? job.events.find((event) => event && event.type === 'job.completed')
        : null;
      if (completedEvent && completedEvent.payload && completedEvent.payload.noFileChanges) {
        return null;
      }
      return 'Processamento concluído com sucesso.';
    }
  
    if (job.status === 'cancelled') {
      return null;
    }
  
    if (job.status === 'failed') {
      const reason = String(job.lastError || '');
      const httpStatus = parseProviderHttpStatusFromReason(reason);
  
      if (httpStatus === 429 || /quota|billing|insufficient_quota|rate limit/i.test(reason)) {
        if (/sambanova/i.test(reason)) {
          return 'Falha final: limite/rate limit da API SambaNova atingido. Aguarde, reduza cadência ou troque de provedor.';
        }
        if (/openai/i.test(reason)) {
          return 'Falha final: limite/rate limit da API OpenAI atingido. Aguarde, reduza cadência ou troque de provedor.';
        }
        if (/gemini/i.test(reason)) {
          return 'Falha final: limite da API Gemini atingido (quota/rate limit). Ajuste a cota/chave ou troque de provedor.';
        }
        return 'Falha final: limite de API atingido (quota/rate limit). Ajuste a cota/chave ou troque de provedor.';
      }
  
      if (/executor.*(json|plano)|plano JSON válido|json válido/i.test(reason)) {
        return 'Não consegui transformar a resposta da IA em uma alteração segura de arquivos. Mantive o projeto intacto; você pode tentar novamente e eu vou usar o contexto desta falha.';
      }
  
      if (reason.startsWith('cortex_briefing_error')) {
        return 'Falha final no briefing da Persona. O job foi encerrado sem repetição automática.';
      }
  
      return 'Não consegui concluir esta execução. Mantive o projeto protegido para uma nova correção orientada pelo diagnóstico.';
    }
  
    return null;
  }

  function formatDiffPreviewForChat(action) {
    if (!action || !action.diffPreview) return '';
    const lines = action.diffPreview.split('\n');
    const maxLines = 40;
    const visible = lines.slice(0, maxLines);
    const hasTruncation = lines.length > maxLines;
    return [
      'Pré-visualização do patch proposto:',
      visible.join('\n'),
      hasTruncation ? '... (prévia truncada)' : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  function formatAiRuntimeMessage(status) {
    if (!status || !status.ok) {
      return 'IA: não foi possível validar o runtime nesta tentativa.';
    }
  
    const provider = String(status.provider || 'rwkv');
    if (provider === 'mock') {
      return 'Modo Mock Local selecionado. O fluxo roda com respostas determinísticas e não consome API.';
    }
  
    if (provider === 'gemini') {
      if (status.ready) {
        return 'Modo Gemini API selecionado para briefing (chave configurada, conexão ainda será validada no uso).';
      }
      return 'Modo Gemini API selecionado, mas a chave GEMINI_API_KEY ainda não está configurada.';
    }
  
    if (provider === 'openai') {
      if (status.ready) {
        return 'Modo OpenAI API selecionado para briefing (chave e modelo configurados, conexão ainda será validada no uso).';
      }
      if (status.reason === 'openai_model_missing') {
        return 'Modo OpenAI API selecionado, mas o modelo OpenAI ainda não está configurado.';
      }
      return 'Modo OpenAI API selecionado, mas a chave OPENAI_API_KEY ainda não está configurada.';
    }
  
    if (provider === 'sambanova') {
      if (status.ready) {
        return 'Modo SambaNova API selecionado para briefing (chave configurada, conexão ainda será validada no uso).';
      }
      return 'Modo SambaNova API selecionado, mas a chave SAMBANOVA_API_KEY ainda não está configurada.';
    }
  
    if (provider.startsWith('custom:')) {
      const name =
        status && status.customProvider && status.customProvider.providerName
          ? String(status.customProvider.providerName)
          : 'API custom';
      if (status.ready) {
        return `Modo ${name} selecionado para briefing (perfil custom configurado, conexão ainda será validada no uso).`;
      }
      if (status.reason === 'custom_api_key_missing') return `Modo ${name} selecionado, mas falta API key no perfil.`;
      if (status.reason === 'custom_api_model_missing') return `Modo ${name} selecionado, mas falta modelo no perfil.`;
      if (status.reason === 'custom_api_endpoint_missing') return `Modo ${name} selecionado, mas falta endpoint/website válido no perfil.`;
      return `Modo ${name} selecionado, mas o perfil custom ainda não está pronto.`;
    }
  
    if (status.ready) {
      return 'Modo RWKV local selecionado e com arquivos mínimos encontrados.';
    }
  
    if (status.reason === 'rwkv_model_missing') {
      return 'Modo RWKV local selecionado, mas o arquivo do modelo não foi encontrado.';
    }
    if (status.reason === 'rwkv_tokenizer_missing') {
      return 'Modo RWKV local selecionado, mas o tokenizer não foi encontrado.';
    }
  
    return 'Modo RWKV local selecionado, porém ainda não pronto nesta tentativa.';
  }

  function formatMempalaceRuntimeMessage(status) {
    if (!status || !status.ok) {
      return 'MemPalace: não foi possível validar o runtime nesta tentativa.';
    }
  
    if (!status.available) {
      if (status.reason === 'repo_not_found') {
        return 'MemPalace: repositório não encontrado no workspace. A memória avançada ficará em modo inativo até configurar o caminho.';
      }
      if (status.reason === 'dependency_missing') {
        return `MemPalace detectado, porém falta dependência Python (${status.dependency}).`;
      }
      return 'MemPalace detectado, mas indisponível no momento.';
    }
  
    return `MemPalace ativo (${status.version || 'versão local'}). Wing atual: ${
      status.wing || 'global'
    }.`;
  }
  window.FaberAppFormatters = {
    buildDiagnosticsContextHint,
    buildExecutionOutcomeAssistantMessage,
    buildJobContextForPersona,
    buildTerminalJobMessage,
    formatAiRuntimeMessage,
    formatDiffPreviewForChat,
    formatMempalaceRuntimeMessage,
    isManualRetryMessage,
    parseProviderHttpStatusFromReason,
    shouldSuppressInterimAssistantPlanMessage,
  };
})();
