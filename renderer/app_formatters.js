(function () {
  function uiText(key, fallback, variables = {}) {
    const translated = typeof window.t === 'function' ? window.t(key, fallback) : fallback;
    return String(translated || fallback || key).replace(/\{(\w+)\}/g, (_match, name) =>
      Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : `{${name}}`
    );
  }

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
    const isAgentic = Boolean(result && result.agentic);
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
    const resultProcessValidation = result && result.processValidation && typeof result.processValidation === 'object'
      ? result.processValidation
      : null;
    const qualityProcessValidation = qualityReport && qualityReport.processValidation && typeof qualityReport.processValidation === 'object'
      ? qualityReport.processValidation
      : null;
    const validationPending = Boolean(
      result && result.validationPending === true
    ) || Boolean(
      resultProcessValidation && resultProcessValidation.status === 'pending'
    ) || Boolean(
      qualityProcessValidation && qualityProcessValidation.status === 'pending'
    );

    if (isOk && validationPending && effectOk && errors === 0) {
      return modifiedFiles.length
        ? uiText(
            'executionValidationPendingApplied',
            'Concluído: apliquei a alteração. Lint, testes, build e preview não foram executados; a validação ficou pendente até existir um sandbox portátil.'
          )
        : uiText(
            'executionValidationPendingNoChanges',
            'Concluído sem alterar arquivos. Lint, testes, build e preview não foram executados; a validação ficou pendente até existir um sandbox portátil.'
          );
    }

    if (isAgentic) {
      if (isOk) {
        return String((result && result.message) || '').trim() || (modifiedFiles.length
          ? uiText('executionApplied', 'Concluído: apliquei a alteração no projeto.')
          : uiText('executionCompleted', 'Concluído.'));
      }
      return String((result && result.message) || '').trim() || uiText(
        'executionNeedsCorrection',
        'Parei antes de concluir: preciso corrigir a causa mostrada no progresso da execução.'
      );
    }

    if (isOk && effectOk && errors === 0) {
      return modifiedFiles.length
        ? uiText('executionValidated', 'Concluído: apliquei a alteração e validei o projeto.')
        : uiText('executionNoChanges', 'Concluído: validei a tarefa e não precisei alterar arquivos.');
    }

    if (blockedByValidation || errors > 0) {
      return modifiedFiles.length > 0 
        ? uiText(
            'executionWithWarnings',
            'Concluído com observações: apliquei a alteração, mas a validação detectou pontos de atenção.'
          )
        : uiText(
            'executionValidationBlocked',
            'Parei antes de concluir: a validação real encontrou um problema e o projeto foi preservado.'
          );
    }

    if (blockedByEffect) {
      return uiText('executionNoEffect', 'A alteração já estava aplicada ou não resultou em mudança.');
    }

    return isOk
      ? uiText('executionCompleted', 'Concluído.')
      : uiText(
          'executionNeedsCorrection',
          'Parei antes de concluir: preciso corrigir a causa mostrada no progresso da execução.'
        );
  }

  function shouldSuppressInterimAssistantPlanMessage(plan) {
    const response = String((plan && plan.response) || '').trim();
    if (/^\s*[{`]/.test(response) && /"decision"\s*:/i.test(response)) return true;
    if (plan && plan.action && !(plan.meta && plan.meta.autoExecute)) return true;
  
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
      return null;
    }
  
    if (job.status === 'cancelled') {
      return null;
    }
  
    if (job.status === 'failed') {
      const reason = String(job.lastError || '');
      const httpStatus = parseProviderHttpStatusFromReason(reason);
  
      if (httpStatus === 429 || /quota|billing|insufficient_quota|rate limit/i.test(reason)) {
        if (/sambanova/i.test(reason)) {
          return uiText(
            'apiQuotaSambaNova',
            'Falha final: limite/rate limit da API SambaNova atingido. Aguarde, reduza a cadência ou troque de provedor.'
          );
        }
        if (/openai/i.test(reason)) {
          return uiText(
            'apiQuotaOpenAI',
            'Falha final: limite/rate limit da API OpenAI atingido. Aguarde, reduza a cadência ou troque de provedor.'
          );
        }
        if (/gemini/i.test(reason)) {
          return uiText(
            'apiQuotaGemini',
            'Falha final: limite da API Gemini atingido (quota/rate limit). Ajuste a cota ou a chave, ou troque de provedor.'
          );
        }
        return uiText(
          'apiQuotaGeneric',
          'Falha final: limite de API atingido (quota/rate limit). Ajuste a cota ou a chave, ou troque de provedor.'
        );
      }
  
      if (/executor.*(json|plano)|plano JSON válido|json válido/i.test(reason)) {
        return uiText(
          'unsafeAiResponse',
          'Não consegui transformar a resposta da IA em uma alteração segura de arquivos. Mantive o projeto intacto; tente novamente para que eu use o contexto desta falha.'
        );
      }
  
      if (reason.startsWith('cortex_briefing_error')) {
        return uiText(
          'personaBriefingFailed',
          'Falha final no briefing da Persona. O job foi encerrado sem repetição automática.'
        );
      }
  
      return uiText(
        'executionFailedProtected',
        'Não consegui concluir esta execução. Mantive o projeto protegido para uma nova correção orientada pelo diagnóstico.'
      );
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
      uiText('patchPreview', 'Pré-visualização do patch proposto:'),
      visible.join('\n'),
      hasTruncation ? uiText('previewTruncated', '... (prévia truncada)') : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  function formatAiRuntimeMessage(status) {
    if (!status || !status.ok) {
      return uiText('aiRuntimeUnavailable', 'IA: não foi possível validar o runtime nesta tentativa.');
    }
  
    const provider = String(status.provider || 'rwkv');
    if (provider === 'mock') {
      return uiText(
        'mockRuntimeReady',
        'Modo Mock Local selecionado. O fluxo roda com respostas determinísticas e não consome API.'
      );
    }
  
    if (provider === 'gemini') {
      if (status.ready) {
        return uiText(
          'geminiRuntimeReady',
          'Modo Gemini API selecionado para briefing (chave configurada; a conexão será validada no uso).'
        );
      }
      return uiText(
        'geminiKeyMissing',
        'Modo Gemini API selecionado, mas a chave GEMINI_API_KEY ainda não está configurada.'
      );
    }
  
    if (provider === 'openai') {
      if (status.ready) {
        return uiText(
          'openAiRuntimeReady',
          'Modo OpenAI API selecionado para briefing (chave e modelo configurados; a conexão será validada no uso).'
        );
      }
      if (status.reason === 'openai_model_missing') {
        return uiText(
          'openAiModelMissing',
          'Modo OpenAI API selecionado, mas o modelo OpenAI ainda não está configurado.'
        );
      }
      return uiText(
        'openAiKeyMissing',
        'Modo OpenAI API selecionado, mas a chave OPENAI_API_KEY ainda não está configurada.'
      );
    }
  
    if (provider === 'sambanova') {
      if (status.ready) {
        return uiText(
          'sambaNovaRuntimeReady',
          'Modo SambaNova API selecionado para briefing (chave configurada; a conexão será validada no uso).'
        );
      }
      return uiText(
        'sambaNovaKeyMissing',
        'Modo SambaNova API selecionado, mas a chave SAMBANOVA_API_KEY ainda não está configurada.'
      );
    }
  
    if (provider.startsWith('custom:')) {
      const name =
        status && status.customProvider && status.customProvider.providerName
          ? String(status.customProvider.providerName)
          : 'API custom';
      if (status.ready) {
        return uiText(
          'customRuntimeReady',
          'Modo {name} selecionado para briefing (perfil customizado configurado; a conexão será validada no uso).',
          { name }
        );
      }
      if (status.reason === 'custom_api_key_missing') {
        return uiText('customKeyMissing', 'Modo {name} selecionado, mas falta a API key no perfil.', { name });
      }
      if (status.reason === 'custom_api_model_missing') {
        return uiText('customModelMissing', 'Modo {name} selecionado, mas falta o modelo no perfil.', { name });
      }
      if (status.reason === 'custom_api_endpoint_missing') {
        return uiText(
          'customEndpointMissing',
          'Modo {name} selecionado, mas falta um endpoint/site válido no perfil.',
          { name }
        );
      }
      return uiText(
        'customRuntimeNotReady',
        'Modo {name} selecionado, mas o perfil customizado ainda não está pronto.',
        { name }
      );
    }
  
    if (status.ready) {
      return uiText('rwkvRuntimeReady', 'Modo RWKV local selecionado e com os arquivos mínimos encontrados.');
    }
  
    if (status.reason === 'rwkv_model_missing') {
      return uiText('rwkvModelMissing', 'Modo RWKV local selecionado, mas o arquivo do modelo não foi encontrado.');
    }
    if (status.reason === 'rwkv_tokenizer_missing') {
      return uiText('rwkvTokenizerMissing', 'Modo RWKV local selecionado, mas o tokenizer não foi encontrado.');
    }
  
    return uiText(
      'rwkvRuntimeNotReady',
      'Modo RWKV local selecionado, porém ainda não está pronto nesta tentativa.'
    );
  }

  function formatMempalaceRuntimeMessage(status) {
    if (!status || !status.ok) {
      return uiText(
        'mempalaceRuntimeUnavailable',
        'MemPalace: não foi possível validar o runtime nesta tentativa.'
      );
    }
  
    if (!status.available) {
      if (status.reason === 'repo_not_found') {
        return uiText(
          'mempalaceRepositoryMissing',
          'MemPalace: repositório não encontrado no workspace. A memória avançada ficará inativa até o caminho ser configurado.'
        );
      }
      if (status.reason === 'dependency_missing') {
        return uiText(
          'mempalaceDependencyMissing',
          'MemPalace detectado, porém falta a dependência Python ({dependency}).',
          { dependency: status.dependency }
        );
      }
      return uiText('mempalaceRuntimeNotReady', 'MemPalace detectado, mas está indisponível no momento.');
    }
  
    return uiText(
      'mempalaceRuntimeActive',
      'MemPalace ativo ({version}). Wing atual: {wing}.',
      {
        version: status.version || uiText('localVersion', 'versão local'),
        wing: status.wing || uiText('globalScope', 'global'),
      }
    );
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
