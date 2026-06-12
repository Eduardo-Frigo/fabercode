(function () {
  const UX_TONES = ['neutral', 'info', 'working', 'success', 'warning', 'danger'];

  function normalizeUxTone(value) {
    const tone = String(value || '').trim().toLowerCase();
    return UX_TONES.includes(tone) ? tone : 'neutral';
  }

  function normalizeText(value) {
    return String(value || '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function inferUxToneFromText(value) {
    const text = normalizeText(value);
    if (!text) return 'neutral';
    if (/\b(falha|falhou|erro|bloquead|indisponivel|desconectad|nao consegui|obrigatorio|interrompid)\b/.test(text)) {
      return 'danger';
    }
    if (/\b(aguardando|retentativa|limite|quota|pendencia|preciso|manual|cancelad|atencao)\b/.test(text)) {
      return 'warning';
    }
    if (/\b(concluid|concluiu|sucesso|pronto|ativa|ativo|publicad|salvo|passou|liberado)\b/.test(text)) {
      return 'success';
    }
    if (/\b(conversando|analisando|processando|executando|validando|trabalhando|preparando|planejando|corrigindo|carregando|retomando)\b/.test(text)) {
      return 'working';
    }
    return 'info';
  }

  function isBusyText(value, tone) {
    const text = normalizeText(value);
    return normalizeUxTone(tone) === 'working' ||
      /\b(conversando|analisando|processando|executando|validando|trabalhando|preparando|planejando|corrigindo|carregando|retomando)\b/.test(text);
  }

  function buildStatusPresentation(text, options = {}) {
    const label = String(text || '').trim() || 'Aguardando';
    const explicitTone = options.tone ? normalizeUxTone(options.tone) : '';
    const tone = explicitTone || inferUxToneFromText(label);
    const busy = typeof options.busy === 'boolean' ? options.busy : isBusyText(label, tone);
    return {
      label,
      tone,
      busy,
      ariaLabel: busy ? `${label}. Em andamento.` : label,
    };
  }

  function mapJobPhaseLabel(phase) {
    const labels = {
      created: 'Fila criada',
      cortex_intake: 'Intake Cortex',
      cortex_briefing: 'Briefing da Persona',
      cortex_render_pass: 'Render do Executor',
      cortex_validation: 'Validação',
      execute_validation: 'Validação técnica',
      persona_plan: 'Planejamento da Persona',
      awaiting_user_confirmation: 'Aguardando confirmação',
      execute_pending: 'Execução do Executor',
      paused_memory_pressure: 'Pausado por memória',
      persona_done: 'Planejamento concluído',
      cortex_briefing_retry_exhausted: 'Briefing esgotado',
      cortex_validation_retry_exhausted: 'Validação esgotada',
      persona_retry_exhausted: 'Retentativas esgotadas',
      runtime_interrupted: 'Execução interrompida',
      cancelled: 'Cancelado',
      done: 'Concluído',
      failed: 'Falhou',
    };
    return labels[phase] || phase || 'Processando';
  }

  const JOB_PHASE_ORDER = [
    'created',
    'persona_plan',
    'cortex_intake',
    'cortex_briefing',
    'cortex_render_pass',
    'cortex_validation',
    'awaiting_user_confirmation',
    'execute_pending',
    'execute_validation',
    'done',
  ];

  function normalizeJobEvents(job) {
    return Array.isArray(job && job.events) ? job.events.filter(Boolean) : [];
  }

  function buildJobPhaseSteps(job) {
    if (!job) return [];
    const attempts = job.attemptsByPhase && typeof job.attemptsByPhase === 'object' ? job.attemptsByPhase : {};
    const currentPhase = String(job.phase || 'created');
    const terminalStatus = ['completed', 'failed', 'cancelled'].includes(String(job.status || '').toLowerCase());
    const busy = !terminalStatus;
    const phases = new Set();

    JOB_PHASE_ORDER.forEach((phase) => {
      if (attempts[phase] || phase === currentPhase) phases.add(phase);
    });
    normalizeJobEvents(job).forEach((event) => {
      const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
      const phase = String(payload.phase || '');
      if (phase) phases.add(phase);
    });
    if (!phases.size) phases.add(currentPhase);

    const currentIndex = JOB_PHASE_ORDER.includes(currentPhase)
      ? JOB_PHASE_ORDER.indexOf(currentPhase)
      : JOB_PHASE_ORDER.length;

    return Array.from(phases)
      .sort((a, b) => {
        const ai = JOB_PHASE_ORDER.includes(a) ? JOB_PHASE_ORDER.indexOf(a) : JOB_PHASE_ORDER.length;
        const bi = JOB_PHASE_ORDER.includes(b) ? JOB_PHASE_ORDER.indexOf(b) : JOB_PHASE_ORDER.length;
        return ai - bi || a.localeCompare(b);
      })
      .map((phase) => {
        const phaseIndex = JOB_PHASE_ORDER.includes(phase) ? JOB_PHASE_ORDER.indexOf(phase) : JOB_PHASE_ORDER.length;
        const attempt = Number.isFinite(Number(attempts[phase])) ? Number(attempts[phase]) : 0;
        let state = 'pending';
        if (String(job.status || '').toLowerCase() === 'cancelled' && phase === currentPhase) {
          state = 'cancelled';
        } else if (String(job.status || '').toLowerCase() === 'failed' && phase === currentPhase) {
          state = 'failed';
        } else if (String(job.status || '').toLowerCase() === 'retry_pending' && phase === currentPhase) {
          state = 'retry';
        } else if (busy && phase === currentPhase) {
          state = 'active';
        } else if (attempt > 0 || phaseIndex < currentIndex || String(job.status || '').toLowerCase() === 'completed') {
          state = 'done';
        }

        return {
          phase,
          label: mapJobPhaseLabel(phase),
          attempt,
          state,
        };
      });
  }

  function mapContextSourceLabel(source) {
    const labels = {
      current_message: 'mensagem atual',
      conversation_brief: 'briefing da conversa',
      active_memory: 'memória ativa',
      current_message_or_conversation: 'mensagem atual/conversa',
      unknown: 'indefinido',
    };
    return labels[source] || source || labels.unknown;
  }

  function mapPatchEvidenceStatusLabel(status) {
    const labels = {
      approved: 'aprovado',
      blocked: 'bloqueado',
      unknown: 'indefinido',
    };
    return labels[status] || status || labels.unknown;
  }

  function compactUxReason(reason) {
    const text = String(reason || '').trim();
    if (!text) return '';
    const cortexScoreMatch = text.match(/^cortex_validation_score:(\d+)\b/i);
    if (cortexScoreMatch) {
      return `Validação Cortex bloqueou a execução: score ${cortexScoreMatch[1]}%`;
    }
    if (/^cortex_validation_unmet\b/i.test(text)) {
      return 'Validação Cortex bloqueou a execução porque ainda há critérios obrigatórios sem evidência';
    }
    if (/^cortex_patchfirst_guardrail\b/i.test(text)) {
      return 'Guardrail patch-first bloqueou uma tentativa de recriar o projeto durante edição incremental';
    }
    if (/^cortex_briefing_error\b/i.test(text)) {
      return 'Falha ao consolidar o briefing técnico do Cortex';
    }
    const normalized = text
      .replace(/^cortex_[a-z0-9_]+:?/i, '')
      .replace(/^persona_[a-z0-9_]+:?/i, '')
      .replace(/^execute_[a-z0-9_]+:?/i, '');
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
  }

  function formatUxTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('pt-BR');
    } catch {
      return '';
    }
  }

  function clampProgressPct(job) {
    const raw = job && job.progress && Number.isFinite(Number(job.progress.pct))
      ? Number(job.progress.pct)
      : null;
    if (raw === null) {
      return job && job.status === 'completed' ? 100 : null;
    }
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  function inferJobTone(job) {
    const status = String(job && job.status ? job.status : '').toLowerCase();
    if (status === 'completed') return 'success';
    if (status === 'failed') return 'danger';
    if (status === 'cancelled' || status === 'retry_pending') return 'warning';
    return 'working';
  }

  function buildTransientJobStatus(job) {
    if (!job || !job.status) return '';
    if (job.status === 'completed') return 'Processamento concluído com sucesso.';
    if (job.status === 'failed') return 'Não consegui concluir esta rodada.';
    if (job.status === 'cancelled') return 'Ação cancelada. Nenhum arquivo foi alterado.';
    if (job.status === 'retry_pending') {
      const reason = normalizeText(job.lastError || '');
      if (/429|rate.?limit|quota/.test(reason)) return 'Aguardando janela de API para nova tentativa.';
      return 'Aguardando janela de retentativa.';
    }

    const phase = String(job.phase || '').toLowerCase();
    if (phase === 'created') return 'A Persona autorizou iniciar a análise técnica.';
    if (phase === 'persona_plan' || phase === 'cortex_briefing' || phase === 'cortex_intake') {
      return 'Analisando contexto e código do projeto.';
    }
    if (phase === 'awaiting_user_confirmation') return 'Encontrei a raiz do problema e preparei a correção.';
    if (phase === 'execute_pending' || phase === 'cortex_render_pass') return 'Aplicando alterações no projeto.';
    if (phase === 'cortex_validation' || phase === 'execute_validation') return 'Validando resultado da correção.';
    if (phase === 'paused_memory_pressure') return 'Pausado por pressão de memória, aguardando retomada.';
    return 'Trabalhando no projeto.';
  }

  function buildJobTitle(job) {
    if (!job) return 'Processando';
    if (job.status === 'failed') return 'Não consegui concluir essa execução';
    if (job.status === 'completed') return 'Execução concluída';
    if (job.status === 'retry_pending') return 'Vou tentar novamente em instantes';
    if (job.status === 'cancelled') return 'Execução cancelada';
    return 'Trabalhando no projeto';
  }

  function buildJobStatusLabel(job) {
    if (!job) return 'Aguardando';
    if (job.status === 'completed') return 'Concluído';
    if (job.status === 'failed') return 'Falha';
    if (job.status === 'cancelled') return 'Cancelado';
    if (job.status === 'retry_pending') return 'Aguardando retentativa';
    return 'Em andamento';
  }

  function buildRetryCountdown(job, now = Date.now()) {
    if (!job || job.status !== 'retry_pending' || !job.retryState || !job.retryState.nextRetryAt) return '';
    const nextMs = new Date(job.retryState.nextRetryAt).getTime();
    if (!Number.isFinite(nextMs)) return '';
    const seconds = Math.ceil(Math.max(0, nextMs - now) / 1000);
    return seconds > 0 ? `próxima tentativa em ${seconds}s` : 'retomando agora';
  }

  function buildTechnicalTimeline(job, options = {}) {
    const limit = Math.max(1, Math.min(80, Number(options.limit || 8)));
    const newestFirst = options.newestFirst !== false;
    const sourceEvents = normalizeJobEvents(job);
    const events = (newestFirst ? sourceEvents : sourceEvents.slice().reverse()).slice(0, limit);
    if (!events.length) return [];

    return events.map((event) => {
      const type = String((event && event.type) || 'job.event');
      const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
      const ts = formatUxTime(event && event.createdAt);

      if (type === 'job.phase_changed') {
        const phase = mapJobPhaseLabel(String(payload.phase || ''));
        const attempt = Number.isFinite(Number(payload.attempt)) ? `tentativa ${Number(payload.attempt)}` : null;
        const progressPct = Number.isFinite(Number(payload.progressPct)) ? `${Number(payload.progressPct)}%` : null;
        const autoRepairAttempt = Number.isFinite(Number(payload.autoRepairAttempt))
          ? `reparo ${Number(payload.autoRepairAttempt)}`
          : null;
        const detail = [attempt, progressPct, autoRepairAttempt].filter(Boolean).join(' · ');
        return `${ts} ${phase}${detail ? ` - ${detail}` : ''}`.trim();
      }

      if (type === 'job.retry_pending') {
        const phase = mapJobPhaseLabel(String(payload.phase || ''));
        const retryable = payload.retryable === false ? 'sem nova retentativa' : 'retentativa ativa';
        const reason = compactUxReason(payload.reason);
        return `${ts} Retentativa (${phase}) - ${retryable}${reason ? ` · ${reason}` : ''}`.trim();
      }

      if (type === 'job.auto_repair_planning') {
        const attempt = Number.isFinite(Number(payload.autoRepairAttempt))
          ? Number(payload.autoRepairAttempt)
          : null;
        const maxPass = Number.isFinite(Number(payload.maxAutoRepairPasses))
          ? Number(payload.maxAutoRepairPasses)
          : null;
        return `${ts} Planejando auto-reparo${attempt ? ` ${attempt}/${maxPass || '?'}` : ''}`.trim();
      }

      if (type === 'job.auto_repair_plan_ready') {
        const file = payload.targetFile ? `arquivo ${payload.targetFile}` : null;
        return `${ts} Plano de auto-reparo pronto${file ? ` - ${file}` : ''}`.trim();
      }

      if (type === 'job.auto_repair_plan_failed') {
        const reason = compactUxReason(payload.reason);
        return `${ts} Falha ao montar plano de auto-reparo${reason ? ` - ${reason}` : ''}`.trim();
      }

      if (type === 'job.execute_pass_started') {
        const pass = Number.isFinite(Number(payload.executionPass)) ? Number(payload.executionPass) : null;
        const total = Number.isFinite(Number(payload.totalPlannedPasses)) ? Number(payload.totalPlannedPasses) : null;
        const file = payload.targetFile ? `arquivo ${payload.targetFile}` : null;
        return `${ts} Execução de patch${pass ? ` ${pass}/${total || '?'}` : ''}${file ? ` - ${file}` : ''}`.trim();
      }

      if (type === 'job.execute_pass_finished') {
        const files = Number.isFinite(Number(payload.modifiedFilesCount))
          ? `${Number(payload.modifiedFilesCount)} arquivo(s)`
          : null;
        return `${ts} Patch aplicado${files ? ` - ${files}` : ''}`.trim();
      }

      if (type === 'job.execute_validation_blocked') {
        const errors = Number.isFinite(Number(payload.errors)) ? Number(payload.errors) : null;
        const warnings = Number.isFinite(Number(payload.warnings)) ? Number(payload.warnings) : null;
        const reason = compactUxReason(payload.reason);
        const counts = errors === null && warnings === null ? null : `erros ${errors || 0} · avisos ${warnings || 0}`;
        return `${ts} Validação bloqueou conclusão${counts ? ` - ${counts}` : ''}${reason ? ` · ${reason}` : ''}`.trim();
      }

      if (type === 'job.execute_effect_blocked') {
        const taskType = payload.taskType ? `tarefa ${payload.taskType}` : null;
        const modifiedFilesCount = Number.isFinite(Number(payload.modifiedFilesCount))
          ? `${Number(payload.modifiedFilesCount)} arquivo(s)`
          : null;
        const totalDelta = Number.isFinite(Number(payload.totalDelta)) ? `delta ${Number(payload.totalDelta)}` : null;
        const reason = compactUxReason(payload.reason);
        const detail = [taskType, modifiedFilesCount, totalDelta].filter(Boolean).join(' · ');
        return `${ts} Execução sem efeito útil${detail ? ` - ${detail}` : ''}${reason ? ` · ${reason}` : ''}`.trim();
      }

      if (type === 'job.context_frame') {
        const dominantSource = mapContextSourceLabel(payload.dominantSource);
        const memoryStatus = payload.activeMemoryAllowed
          ? 'memória ativa permitida'
          : payload.activeMemorySuppressed
            ? 'memória ativa suprimida'
            : '';
        const guard = payload.guardReason ? `guarda: ${payload.guardReason}` : '';
        return `${ts} Contexto dominante - ${[dominantSource, memoryStatus, guard].filter(Boolean).join(' · ')}`.trim();
      }

      if (type === 'job.deterministic_patch_evidence') {
        const status = payload.status ? `status ${mapPatchEvidenceStatusLabel(payload.status)}` : '';
        const kind = payload.kind ? `contrato ${payload.kind}` : '';
        const operations = Number.isFinite(Number(payload.operationsCount))
          ? `${Number(payload.operationsCount)} operação(ões)`
          : '';
        const files = Number.isFinite(Number(payload.changedFilesCount))
          ? `${Number(payload.changedFilesCount)} arquivo(s)`
          : '';
        return `${ts} Patch determinístico - ${[status, kind, operations, files].filter(Boolean).join(' · ')}`.trim();
      }

      if (type === 'job.completed') return `${ts} Processamento concluído`.trim();
      if (type === 'job.failed') {
        const reason = compactUxReason(payload.reason);
        return `${ts} Falha final${reason ? ` - ${reason}` : ''}`.trim();
      }
      if (type === 'job.checkpoint_saved') {
        const key = payload.key ? `checkpoint ${payload.key}` : 'checkpoint salvo';
        return `${ts} ${key}`.trim();
      }
      if (type === 'job.created') return `${ts} Job iniciado`.trim();

      return `${ts} ${type}`.trim();
    });
  }

  function buildFinalSummaryLines(job, phaseSteps = []) {
    if (!job || !['completed', 'failed', 'cancelled'].includes(String(job.status || '').toLowerCase())) return [];
    const status = String(job.status || '').toLowerCase();
    const result =
      status === 'completed'
        ? 'Resultado: execução concluída.'
        : status === 'cancelled'
          ? 'Resultado: execução cancelada.'
          : 'Resultado: execução não concluída.';
    const walkedPhases = phaseSteps
      .filter((step) => step && step.state !== 'pending')
      .map((step) => step.label)
      .filter(Boolean);
    const attempts = phaseSteps
      .filter((step) => step && Number(step.attempt || 0) > 1)
      .map((step) => `${step.label}: ${step.attempt} tentativas`);
    const lines = [result];
    if (walkedPhases.length) lines.push(`Caminho: ${walkedPhases.join(' > ')}.`);
    if (attempts.length) lines.push(`Retentativas: ${attempts.join(' | ')}.`);
    lines.push(...buildJobNarrativeLines(job, { includePhaseLine: false, includeNextAction: true }));
    if (job.lastError) lines.push(`Motivo técnico: ${formatUxSentence(compactUxReason(job.lastError))}`);
    return lines;
  }

  function formatUxSentence(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return /[.!?]$/.test(text) ? text : `${text}.`;
  }

  function clipUxLine(value, limit = 220) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
  }

  function readJobCheckpointData(job, key) {
    const checkpoints = job && job.checkpoints && typeof job.checkpoints === 'object' ? job.checkpoints : {};
    const checkpoint = checkpoints[key] && typeof checkpoints[key] === 'object' ? checkpoints[key] : null;
    if (!checkpoint) return null;
    return checkpoint.data && typeof checkpoint.data === 'object' ? checkpoint.data : checkpoint;
  }

  function readLatestCortexValidation(job) {
    const runtime = readJobCheckpointData(job, 'cortex_runtime');
    const workGraph = runtime && runtime.workGraph && typeof runtime.workGraph === 'object' ? runtime.workGraph : null;
    const results = workGraph && Array.isArray(workGraph.validationResults) ? workGraph.validationResults : [];
    for (let i = results.length - 1; i >= 0; i -= 1) {
      if (results[i] && typeof results[i] === 'object') return results[i];
    }
    return null;
  }

  function summarizeFailedChecks(checks) {
    if (!checks || typeof checks !== 'object') return '';
    const labels = {
      operations: 'nenhuma operação aplicável',
      files: 'arquivos base ausentes',
      runnableEntry: 'entrada executável ausente',
      patchFirst: 'patch-first não respeitado',
      operationContentValidity: 'conteúdo inválido em arquivo crítico',
      cssImportOrder: 'ordem de import CSS inválida',
      artifactMinimum: 'qualidade/aderência abaixo do mínimo',
      artifactStack: 'stack solicitada não preservada',
      artifactCss: 'CSS visual insuficiente',
      artifactResponsive: 'responsividade insuficiente',
      artifactSpecificity: 'conteúdo pouco específico',
      artifactNoGeneric: 'placeholders genéricos',
    };
    const failed = Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([key]) => labels[key] || key)
      .slice(0, 5);
    return failed.length ? failed.join(', ') : '';
  }

  function summarizeInvalidOperationContents(invalidOperationContents) {
    if (!Array.isArray(invalidOperationContents) || !invalidOperationContents.length) return '';
    const files = invalidOperationContents
      .map((entry) => entry && entry.path ? String(entry.path) : '')
      .filter(Boolean)
      .slice(0, 4);
    const suffix = invalidOperationContents.length > files.length ? ` +${invalidOperationContents.length - files.length}` : '';
    return files.length ? `${files.join(', ')}${suffix}` : '';
  }

  function buildJobNarrativeLines(job, options = {}) {
    if (!job) return [];
    const includePhaseLine = options.includePhaseLine !== false;
    const includeNextAction = options.includeNextAction !== false;
    const phase = String(job.phase || '').toLowerCase();
    const status = String(job.status || '').toLowerCase();
    const lines = [];
    const validation = readLatestCortexValidation(job);

    if (includePhaseLine) {
      if (phase === 'persona_plan' || phase === 'cortex_intake' || phase === 'cortex_briefing') {
        lines.push('Estou lendo o briefing, o grafo do projeto e os arquivos relacionados antes de editar.');
      } else if (phase === 'cortex_render_pass') {
        lines.push('Estou transformando o plano em operações de arquivo verificáveis.');
      } else if (phase === 'cortex_validation') {
        lines.push('Estou validando o patch antes de permitir execução ou promoção para o projeto real.');
      } else if (phase === 'awaiting_user_confirmation') {
        lines.push('Preparei uma correção validada pelo Cortex e aguardo confirmação antes de tocar nos arquivos.');
      } else if (phase === 'execute_pending') {
        lines.push('Estou executando em área protegida e só devo promover se os comandos reais passarem.');
      } else if (phase === 'execute_validation') {
        lines.push('Estou rodando build, testes, smoke visual e coletando evidência do resultado.');
      } else if (status === 'completed') {
        lines.push('Concluí esta rodada porque a validação real passou.');
      }
    }

    if (status === 'failed') {
      const reason = compactUxReason(job.lastError);
      if (reason) {
        lines.push(`Parei esta rodada: ${formatUxSentence(reason)}`);
      } else {
        lines.push('Parei esta rodada sem promover como concluída.');
      }
    }

    if (validation && status === 'failed') {
      const score = Number.isFinite(Number(validation.score)) ? Number(validation.score) : null;
      const minScore = Number.isFinite(Number(validation.minScore)) ? Number(validation.minScore) : null;
      if (score !== null) {
        lines.push(`Validação técnica: ${score}%${minScore !== null ? ` / mínimo ${minScore}%` : ''}.`);
      }
      const failedChecks = summarizeFailedChecks(validation.checks);
      if (failedChecks) {
        lines.push(`Bloqueios encontrados: ${failedChecks}.`);
      }
      const invalidFiles = summarizeInvalidOperationContents(validation.invalidOperationContents);
      if (invalidFiles) {
        lines.push(`Conteúdo inválido detectado em: ${invalidFiles}.`);
      }
      const artifactQuality = validation.artifactQuality && typeof validation.artifactQuality === 'object'
        ? validation.artifactQuality
        : null;
      if (artifactQuality && Number.isFinite(Number(artifactQuality.score))) {
        lines.push(
          `Qualidade/aderência do artefato: ${Number(artifactQuality.score)}%` +
          `${Number.isFinite(Number(artifactQuality.minScore)) ? ` / mínimo ${Number(artifactQuality.minScore)}%` : ''}.`
        );
      }
    }

    const lastPlan = readJobCheckpointData(job, 'last_plan');
    if (status === 'failed' && lastPlan && lastPlan.responsePreview) {
      const preview = clipUxLine(lastPlan.responsePreview, 240);
      if (preview) lines.push(`Diagnóstico do Executor: ${preview}`);
    }

    if (status === 'failed' && includeNextAction) {
      lines.push('Próxima ação: corrigir a causa apontada acima e repetir o ciclo de teste antes de marcar como concluído.');
    }

    return lines.filter(Boolean);
  }

  function readJobContextFrameEvidence(job) {
    const checkpoints = job && job.checkpoints && typeof job.checkpoints === 'object' ? job.checkpoints : {};
    const checkpoint = checkpoints.route_context_frame && typeof checkpoints.route_context_frame === 'object'
      ? checkpoints.route_context_frame
      : null;
    const data = checkpoint && checkpoint.data && typeof checkpoint.data === 'object' ? checkpoint.data : null;
    if (data) return data;
    const contextEvent = Array.isArray(job && job.events)
      ? job.events.find((event) => event && event.type === 'job.context_frame')
      : null;
    return contextEvent && contextEvent.payload && typeof contextEvent.payload === 'object'
      ? contextEvent.payload
      : null;
  }

  function buildContextFrameDiagnosticLines(job) {
    const evidence = readJobContextFrameEvidence(job);
    if (!evidence) return [];
    const dominantSource = mapContextSourceLabel(evidence.dominantSource);
    const allowedSources = Array.isArray(evidence.allowedSources)
      ? evidence.allowedSources.map(mapContextSourceLabel).filter(Boolean)
      : [];
    const lines = [
      `Contexto dominante: ${dominantSource}${allowedSources.length ? ` | fontes permitidas: ${allowedSources.join(', ')}` : ''}`,
    ];
    const activeMemory = evidence.activeMemory && typeof evidence.activeMemory === 'object'
      ? evidence.activeMemory
      : {};
    if (activeMemory.allowedForBriefing || activeMemory.allowedForRouting) {
      lines.push('Memória ativa: permitida para este job.');
    } else if (activeMemory.suppressed) {
      lines.push(`Memória ativa: suprimida${activeMemory.suppressionReason ? ` (${activeMemory.suppressionReason})` : ''}.`);
    } else if (activeMemory.available) {
      lines.push('Memória ativa: disponível, mas sem autorização para briefing.');
    }
    if (evidence.guard && evidence.guard.blocking) {
      lines.push(`Guarda de contexto: bloqueado (${evidence.guard.reason || 'context_frame_guard'}).`);
    }
    return lines;
  }

  function readDeterministicPatchEvidence(job) {
    const checkpoints = job && job.checkpoints && typeof job.checkpoints === 'object' ? job.checkpoints : {};
    const checkpoint = checkpoints.deterministic_patch && typeof checkpoints.deterministic_patch === 'object'
      ? checkpoints.deterministic_patch
      : null;
    const data = checkpoint && checkpoint.data && typeof checkpoint.data === 'object' ? checkpoint.data : checkpoint;
    if (data && data.safePatchEvidence && typeof data.safePatchEvidence === 'object') {
      return data.safePatchEvidence;
    }
    const patchEvent = Array.isArray(job && job.events)
      ? job.events.find((event) => event && event.type === 'job.deterministic_patch_evidence')
      : null;
    return patchEvent && patchEvent.payload && typeof patchEvent.payload === 'object'
      ? patchEvent.payload
      : null;
  }

  function buildDeterministicPatchDiagnosticLines(job) {
    const evidence = readDeterministicPatchEvidence(job);
    if (!evidence) return [];
    const classification = evidence.classification && typeof evidence.classification === 'object'
      ? evidence.classification
      : {};
    const validation = evidence.validation && typeof evidence.validation === 'object'
      ? evidence.validation
      : {};
    const status = mapPatchEvidenceStatusLabel(evidence.status);
    const kind = classification.kind || evidence.kind || '';
    const operationsCount = Number.isFinite(Number(evidence.operationsCount))
      ? Number(evidence.operationsCount)
      : null;
    const changedFilesCount = Array.isArray(evidence.changedFiles)
      ? evidence.changedFiles.length
      : Number.isFinite(Number(evidence.changedFilesCount))
        ? Number(evidence.changedFilesCount)
        : null;
    const parts = [
      `Patch determinístico: ${status}`,
      kind ? `contrato: ${kind}` : '',
      operationsCount !== null ? `${operationsCount} operação(ões)` : '',
      changedFilesCount !== null ? `${changedFilesCount} arquivo(s)` : '',
    ].filter(Boolean);
    const lines = [parts.join(' | ')];
    const validationOk = typeof validation.ok === 'boolean' ? validation.ok : evidence.validationOk;
    const score = Number.isFinite(Number(validation.score))
      ? Number(validation.score)
      : Number.isFinite(Number(evidence.score))
        ? Number(evidence.score)
        : null;
    const minScore = Number.isFinite(Number(validation.minScore))
      ? Number(validation.minScore)
      : Number.isFinite(Number(evidence.minScore))
        ? Number(evidence.minScore)
        : null;
    if (validation.summary) {
      lines.push(`Validação do patch: ${validation.summary}`);
    } else if (typeof validationOk === 'boolean' && score !== null) {
      lines.push(`Validação do patch: ${validationOk ? 'PASSOU' : 'FALHOU'} (${score}%${minScore !== null ? ` / mínimo ${minScore}%` : ''}).`);
    }
    const microContractType =
      evidence.microContract && typeof evidence.microContract === 'object'
        ? evidence.microContract.type
        : evidence.microContractType;
    if (microContractType) {
      lines.push(`Microcontrato: ${microContractType}.`);
    }
    return lines;
  }

  function buildJobProgressPresentation(job, options = {}) {
    if (!job) return null;
    const phaseLabel = mapJobPhaseLabel(job.phase);
    const statusLabel = buildJobStatusLabel(job);
    const progressPct = clampProgressPct(job);
    const retryCountdown = buildRetryCountdown(job, Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now());
    const phaseSteps = buildJobPhaseSteps(job);
    const statusParts = [statusLabel, phaseLabel];
    if (progressPct !== null) statusParts.push(`${progressPct}%`);
    if (retryCountdown) statusParts.push(retryCountdown);

    const detailLines = [];
    if (job.attemptsByPhase && typeof job.attemptsByPhase === 'object') {
      const phaseAttempts = Object.entries(job.attemptsByPhase)
        .slice(0, 4)
        .map(([phase, n]) => `${mapJobPhaseLabel(phase)}: ${n} tentativa(s)`);
      if (phaseAttempts.length) detailLines.push(phaseAttempts.join(' · '));
    }

    detailLines.push(...buildJobNarrativeLines(job, { includePhaseLine: true, includeNextAction: true }));
    detailLines.push(...buildContextFrameDiagnosticLines(job));
    detailLines.push(...buildDeterministicPatchDiagnosticLines(job));
    const recentTimeline = buildTechnicalTimeline(job, { limit: 10, newestFirst: true });
    const fullTimeline = buildTechnicalTimeline(job, { limit: 48, newestFirst: false });
    detailLines.push(...recentTimeline);

    if (job.lastError) {
      detailLines.push(`Motivo técnico: ${formatUxSentence(compactUxReason(job.lastError))}`);
      if (/rate.?limit|429|quota|retry-after/i.test(String(job.lastError || ''))) {
        detailLines.push('Observação: limite temporário de API detectado, aguardando janela de retentativa.');
      }
    }

    const tone = inferJobTone(job);
    const busy = !['completed', 'failed', 'cancelled'].includes(String(job.status || '').toLowerCase());
    const finalSummaryLines = buildFinalSummaryLines(job, phaseSteps);
    return {
      title: buildJobTitle(job),
      phaseLabel,
      statusLabel,
      statusText: statusParts.join(' | '),
      detailText: detailLines.filter(Boolean).join('\n') || 'Processando...',
      activityLines: recentTimeline,
      finalDetailLines: fullTimeline,
      finalSummaryLines,
      phaseSteps,
      progressPct,
      tone,
      busy,
      transientStatus: buildTransientJobStatus(job),
    };
  }

  window.FaberUxStateModel = {
    buildJobProgressPresentation,
    buildStatusPresentation,
    buildJobPhaseSteps,
    compactUxReason,
    formatUxTime,
    inferUxToneFromText,
    buildJobNarrativeLines,
    mapJobPhaseLabel,
    normalizeUxTone,
  };
})();
