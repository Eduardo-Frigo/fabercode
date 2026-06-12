(function () {
  function createJobProgressController(options = {}) {
    const updateStatus = typeof options.updateStatus === 'function' ? options.updateStatus : () => {};
    const onVisibilityChange = typeof options.onVisibilityChange === 'function' ? options.onVisibilityChange : () => {};

    const elements = {
      root: document.getElementById('job-progress'),
      title: document.getElementById('job-progress-title'),
      status: document.getElementById('job-progress-status'),
      detail: document.getElementById('job-progress-detail'),
    };
    const uxStateModel = window.FaberUxStateModel || null;

    function buildTransientStatus(job) {
      if (uxStateModel && typeof uxStateModel.buildJobProgressPresentation === 'function') {
        const presentation = uxStateModel.buildJobProgressPresentation(job);
        return presentation ? presentation.transientStatus : '';
      }
      if (!job || !job.status) return '';
      if (job.status === 'completed') return 'Processamento concluído com sucesso.';
      if (job.status === 'failed') return 'Não consegui concluir esta rodada.';
      if (job.status === 'cancelled') return 'Ação cancelada. Nenhum arquivo foi alterado.';
      if (job.status === 'retry_pending') {
        const reason = String(job.lastError || '').toLowerCase();
        if (/429|rate.?limit|quota/.test(reason)) return 'Aguardando janela de API para nova tentativa...';
        return 'Aguardando janela de retentativa...';
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

    function compactReason(reason) {
      if (uxStateModel && typeof uxStateModel.compactUxReason === 'function') {
        return uxStateModel.compactUxReason(reason);
      }
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
      const normalized = text
        .replace(/^cortex_[a-z0-9_]+:?/i, '')
        .replace(/^persona_[a-z0-9_]+:?/i, '')
        .replace(/^execute_[a-z0-9_]+:?/i, '');
      return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
    }

    function formatTime(iso) {
      if (uxStateModel && typeof uxStateModel.formatUxTime === 'function') {
        return uxStateModel.formatUxTime(iso);
      }
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleTimeString('pt-BR');
      } catch {
        return '';
      }
    }

    function mapPhaseLabel(phase) {
      if (uxStateModel && typeof uxStateModel.mapJobPhaseLabel === 'function') {
        return uxStateModel.mapJobPhaseLabel(phase);
      }
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

    function buildTechnicalTimeline(job) {
      const events = Array.isArray(job && job.events) ? job.events.slice(0, 10) : [];
      if (!events.length) return [];

      return events.map((event) => {
        const type = String((event && event.type) || 'job.event');
        const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
        const ts = formatTime(event && event.createdAt);

        if (type === 'job.phase_changed') {
          const phase = mapPhaseLabel(String(payload.phase || ''));
          const attempt = Number.isFinite(Number(payload.attempt)) ? `tentativa ${Number(payload.attempt)}` : null;
          const progressPct = Number.isFinite(Number(payload.progressPct)) ? `${Number(payload.progressPct)}%` : null;
          const autoRepairAttempt = Number.isFinite(Number(payload.autoRepairAttempt))
            ? `reparo ${Number(payload.autoRepairAttempt)}`
            : null;
          const detail = [attempt, progressPct, autoRepairAttempt].filter(Boolean).join(' · ');
          return `${ts} ${phase}${detail ? ` — ${detail}` : ''}`.trim();
        }

        if (type === 'job.retry_pending') {
          const phase = mapPhaseLabel(String(payload.phase || ''));
          const retryable = payload.retryable === false ? 'sem nova retentativa' : 'retentativa ativa';
          const reason = compactReason(payload.reason);
          return `${ts} Retentativa (${phase}) — ${retryable}${reason ? ` · ${reason}` : ''}`.trim();
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
          return `${ts} Plano de auto-reparo pronto${file ? ` — ${file}` : ''}`.trim();
        }

        if (type === 'job.auto_repair_plan_failed') {
          const reason = compactReason(payload.reason);
          return `${ts} Falha ao montar plano de auto-reparo${reason ? ` — ${reason}` : ''}`.trim();
        }

        if (type === 'job.execute_pass_started') {
          const pass = Number.isFinite(Number(payload.executionPass)) ? Number(payload.executionPass) : null;
          const total = Number.isFinite(Number(payload.totalPlannedPasses)) ? Number(payload.totalPlannedPasses) : null;
          const file = payload.targetFile ? `arquivo ${payload.targetFile}` : null;
          return `${ts} Execução de patch${pass ? ` ${pass}/${total || '?'}` : ''}${file ? ` — ${file}` : ''}`.trim();
        }

        if (type === 'job.execute_pass_finished') {
          const files = Number.isFinite(Number(payload.modifiedFilesCount))
            ? `${Number(payload.modifiedFilesCount)} arquivo(s)`
            : null;
          return `${ts} Patch aplicado${files ? ` — ${files}` : ''}`.trim();
        }

        if (type === 'job.execute_validation_blocked') {
          const errors = Number.isFinite(Number(payload.errors)) ? Number(payload.errors) : null;
          const warnings = Number.isFinite(Number(payload.warnings)) ? Number(payload.warnings) : null;
          const reason = compactReason(payload.reason);
          const counts = errors === null && warnings === null ? null : `erros ${errors || 0} · avisos ${warnings || 0}`;
          return `${ts} Validação bloqueou conclusão${counts ? ` — ${counts}` : ''}${reason ? ` · ${reason}` : ''}`.trim();
        }

        if (type === 'job.execute_effect_blocked') {
          const taskType = payload.taskType ? `tarefa ${payload.taskType}` : null;
          const modifiedFilesCount = Number.isFinite(Number(payload.modifiedFilesCount))
            ? `${Number(payload.modifiedFilesCount)} arquivo(s)`
            : null;
          const totalDelta = Number.isFinite(Number(payload.totalDelta)) ? `delta ${Number(payload.totalDelta)}` : null;
          const reason = compactReason(payload.reason);
          const detail = [taskType, modifiedFilesCount, totalDelta].filter(Boolean).join(' · ');
          return `${ts} Execução sem efeito útil${detail ? ` — ${detail}` : ''}${reason ? ` · ${reason}` : ''}`.trim();
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
          const reason = compactReason(payload.reason);
          return `${ts} Falha final${reason ? ` — ${reason}` : ''}`.trim();
        }
        if (type === 'job.checkpoint_saved') {
          const key = payload.key ? `checkpoint ${payload.key}` : 'checkpoint salvo';
          return `${ts} ${key}`.trim();
        }
        if (type === 'job.created') return `${ts} Job iniciado`.trim();

        return `${ts} ${type}`.trim();
      });
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

    function isVisible() {
      return Boolean(elements.root && !elements.root.classList.contains('hidden'));
    }

    function hide() {
      if (elements.root) elements.root.classList.add('hidden');
      if (elements.detail) elements.detail.textContent = '';
      onVisibilityChange();
    }

    function ensureMeter() {
      if (!elements.root) return null;
      let meter = elements.root.querySelector('.job-progress-meter');
      if (meter) return meter;

      meter = document.createElement('div');
      meter.className = 'job-progress-meter';
      meter.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('div');
      bar.className = 'job-progress-meter__bar';
      meter.appendChild(bar);

      if (elements.detail && elements.detail.parentNode === elements.root) {
        elements.root.insertBefore(meter, elements.detail);
      } else {
        elements.root.appendChild(meter);
      }
      return meter;
    }

    function applyProgressMeter(presentation) {
      const meter = ensureMeter();
      if (!meter || !presentation) return;
      const bar = meter.querySelector('.job-progress-meter__bar');
      const progressPct = presentation.progressPct;
      const indeterminate = progressPct === null && presentation.busy;
      meter.classList.toggle('hidden', progressPct === null && !presentation.busy);
      meter.dataset.indeterminate = indeterminate ? '1' : '0';
      if (bar) bar.style.width = indeterminate ? '42%' : `${progressPct === null ? 0 : progressPct}%`;
    }

    function activityIconSvg(kind) {
      if (kind === 'edit') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 16-.7 3.7L8 19l9.9-9.9a2.1 2.1 0 0 0-3-3L5 16Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }
      if (kind === 'search') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 20-4-4M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      }
      if (kind === 'check') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9.3 17 19 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    }

    function inferActivityKind(line = '') {
      const text = String(line || '').toLowerCase();
      if (/patch|execu|edit|arquivo|alter/.test(text)) return 'edit';
      if (/contexto|intake|briefing|planej|analis/.test(text)) return 'search';
      if (/conclu|valid/.test(text)) return 'check';
      return 'work';
    }

    function compactActivityLine(line = '') {
      return String(line || '')
        .replace(/^\d{1,2}:\d{2}:\d{2}\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function createSectionLabel(text) {
      const label = document.createElement('div');
      label.className = 'job-progress-section-label';
      label.textContent = text;
      return label;
    }

    function renderPhaseSteps(phaseSteps) {
      const steps = Array.isArray(phaseSteps) ? phaseSteps : [];
      if (!steps.length) return null;
      const wrap = document.createElement('div');
      wrap.className = 'job-progress-phases';
      steps.forEach((step) => {
        const item = document.createElement('div');
        item.className = 'job-progress-phase';
        item.dataset.state = step.state || 'pending';

        const dot = document.createElement('span');
        dot.className = 'job-progress-phase__dot';

        const text = document.createElement('span');
        text.className = 'job-progress-phase__text';
        text.textContent = step.label || mapPhaseLabel(step.phase);

        const attempt = Number.isFinite(Number(step.attempt)) && Number(step.attempt) > 1
          ? `${Number(step.attempt)}x`
          : '';
        if (attempt) {
          const badge = document.createElement('span');
          badge.className = 'job-progress-phase__attempt';
          badge.textContent = attempt;
          item.append(dot, text, badge);
        } else {
          item.append(dot, text);
        }
        wrap.appendChild(item);
      });
      return wrap;
    }

    function renderLiveActivity(lines, presentation) {
      const visibleLines = (Array.isArray(lines) ? lines : [])
        .map(compactActivityLine)
        .filter(Boolean)
        .slice(0, 6);
      if (!visibleLines.length) visibleLines.push('Trabalhando no projeto');

      const feed = document.createElement('div');
      feed.className = 'job-progress-activity';
      const busy = presentation ? presentation.busy : true;
      visibleLines.forEach((line, index) => {
        const row = document.createElement('div');
        row.className = 'job-progress-activity__row';
        if (busy && index === 0) row.classList.add('is-active');

        const icon = document.createElement('span');
        icon.className = 'job-progress-activity__icon';
        icon.innerHTML = activityIconSvg(inferActivityKind(line));

        const text = document.createElement('span');
        text.className = 'job-progress-activity__text';
        text.textContent = line;

        row.append(icon, text);
        feed.appendChild(row);
      });
      return feed;
    }

    function renderFinalSummary(presentation) {
      const wrap = document.createElement('div');
      wrap.className = 'job-progress-final';

      const summaryLines = Array.isArray(presentation && presentation.finalSummaryLines)
        ? presentation.finalSummaryLines.filter(Boolean)
        : [];
      const summary = document.createElement('div');
      summary.className = 'job-progress-final__summary';
      (summaryLines.length ? summaryLines : ['Resultado registrado.']).forEach((line) => {
        const row = document.createElement('div');
        row.textContent = line;
        summary.appendChild(row);
      });
      wrap.appendChild(summary);

      const detailLines = Array.isArray(presentation && presentation.finalDetailLines)
        ? presentation.finalDetailLines.map(compactActivityLine).filter(Boolean)
        : [];
      if (detailLines.length) {
        const details = document.createElement('details');
        details.className = 'job-progress-final__details';
        const summaryNode = document.createElement('summary');
        summaryNode.textContent = 'Ver caminho da execução';
        const list = document.createElement('div');
        list.className = 'job-progress-final__timeline';
        detailLines.forEach((line) => {
          const row = document.createElement('div');
          row.textContent = line;
          list.appendChild(row);
        });
        details.append(summaryNode, list);
        wrap.appendChild(details);
      }
      return wrap;
    }

    function renderActivityDetail(lines, presentation) {
      if (!elements.detail) return;
      elements.detail.innerHTML = '';
      const phaseSteps = presentation && Array.isArray(presentation.phaseSteps) ? presentation.phaseSteps : [];
      const phaseStrip = renderPhaseSteps(phaseSteps);
      if (phaseStrip) {
        elements.detail.append(createSectionLabel('Fases'), phaseStrip);
      }
      if (presentation && presentation.busy === false) {
        elements.detail.appendChild(renderFinalSummary(presentation));
        return;
      }
      const activityLines = presentation && Array.isArray(presentation.activityLines)
        ? presentation.activityLines
        : lines;
      elements.detail.append(createSectionLabel('Agora'), renderLiveActivity(activityLines, presentation));
    }

    function render(job) {
      if (!job) {
        hide();
        return;
      }

      const presentation = uxStateModel && typeof uxStateModel.buildJobProgressPresentation === 'function'
        ? uxStateModel.buildJobProgressPresentation(job)
        : null;
      const transientStatus = presentation ? presentation.transientStatus : buildTransientStatus(job);
      if (transientStatus) updateStatus(transientStatus);

      if (elements.root) {
        elements.root.classList.remove('hidden');
        if (presentation) {
          elements.root.dataset.uxTone = presentation.tone;
          elements.root.setAttribute('aria-busy', presentation.busy ? 'true' : 'false');
        }
      }
      onVisibilityChange();

      const titleByStatus =
        job.status === 'failed'
          ? 'Não consegui concluir essa execução'
          : job.status === 'completed'
            ? 'Execução concluída'
            : job.status === 'retry_pending'
              ? 'Vou tentar novamente em instantes'
              : 'Trabalhando no projeto';
      if (elements.title) elements.title.textContent = presentation ? presentation.title : titleByStatus;

      const phaseLabel = mapPhaseLabel(job.phase);
      const statusLabel =
        job.status === 'completed'
          ? 'Concluído'
          : job.status === 'failed'
            ? 'Falha'
            : job.status === 'cancelled'
              ? 'Cancelado'
              : job.status === 'retry_pending'
                ? 'Aguardando retentativa'
                : 'Em andamento';

      const progressPct =
        job && job.progress && Number.isFinite(Number(job.progress.pct))
          ? Math.max(0, Math.min(100, Math.round(Number(job.progress.pct))))
          : null;

      let statusText = progressPct === null ? `${statusLabel} | ${phaseLabel}` : `${statusLabel} | ${phaseLabel} | ${progressPct}%`;
      if (job.status === 'retry_pending' && job.retryState && job.retryState.nextRetryAt) {
        const nextMs = new Date(job.retryState.nextRetryAt).getTime();
        if (Number.isFinite(nextMs)) {
          const remainingMs = Math.max(0, nextMs - Date.now());
          const seconds = Math.ceil(remainingMs / 1000);
          if (seconds > 0) {
            statusText += ` | próxima tentativa em ${seconds}s`;
          } else {
            statusText += ' | retomando agora';
          }
        }
      }
      if (elements.status) elements.status.textContent = presentation ? presentation.statusText : statusText;
      if (presentation) applyProgressMeter(presentation);

      const lines = [];
      if (job.attemptsByPhase && typeof job.attemptsByPhase === 'object') {
        const phaseAttempts = Object.entries(job.attemptsByPhase)
          .slice(0, 4)
          .map(([phase, n]) => `${mapPhaseLabel(phase)}: ${n} tentativa(s)`);
        if (phaseAttempts.length) lines.push(phaseAttempts.join(' · '));
      }

      lines.push(...buildContextFrameDiagnosticLines(job));
      lines.push(...buildDeterministicPatchDiagnosticLines(job));
      lines.push(...buildTechnicalTimeline(job));

      if (job.lastError) {
        lines.push(`Motivo técnico: ${compactReason(job.lastError)}`);
        if (/rate.?limit|429|quota|retry-after/i.test(String(job.lastError || ''))) {
          lines.push('Observação: limite temporário de API detectado, aguardando janela de retentativa.');
        }
      }

      if (elements.detail) {
        const detailText = presentation ? presentation.detailText : (lines.filter(Boolean).join('\n') || 'Processando...');
        renderActivityDetail(String(detailText || '').split('\n'), presentation);
        elements.detail.classList.toggle(
          'is-live',
          presentation ? presentation.busy : !['completed', 'failed', 'cancelled'].includes(String(job.status || '').toLowerCase())
        );
      }
    }

    return {
      hide,
      isVisible,
      render,
    };
  }

  window.FaberJobProgress = {
    createJobProgressController,
  };
})();
