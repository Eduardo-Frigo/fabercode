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

    function buildTransientStatus(job) {
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
      const text = String(reason || '').trim();
      if (!text) return '';
      const normalized = text
        .replace(/^cortex_[a-z0-9_]+:?/i, '')
        .replace(/^persona_[a-z0-9_]+:?/i, '')
        .replace(/^execute_[a-z0-9_]+:?/i, '');
      return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
    }

    function formatTime(iso) {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleTimeString('pt-BR');
      } catch {
        return '';
      }
    }

    function mapPhaseLabel(phase) {
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
        cancelled: 'Cancelado',
        done: 'Concluído',
        failed: 'Falhou',
      };
      return labels[phase] || phase || 'Processando';
    }

    function buildTechnicalTimeline(job) {
      const events = Array.isArray(job && job.events) ? job.events.slice(0, 8) : [];
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

    function isVisible() {
      return Boolean(elements.root && !elements.root.classList.contains('hidden'));
    }

    function hide() {
      if (elements.root) elements.root.classList.add('hidden');
      if (elements.detail) elements.detail.textContent = '';
      onVisibilityChange();
    }

    function render(job) {
      if (!job) {
        hide();
        return;
      }

      const transientStatus = buildTransientStatus(job);
      if (transientStatus) updateStatus(transientStatus);

      if (elements.root) elements.root.classList.remove('hidden');
      onVisibilityChange();

      const titleByStatus =
        job.status === 'failed'
          ? 'Não consegui concluir essa execução'
          : job.status === 'completed'
            ? 'Execução concluída'
            : job.status === 'retry_pending'
              ? 'Vou tentar novamente em instantes'
              : 'Trabalhando no projeto';
      if (elements.title) elements.title.textContent = titleByStatus;

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
      if (elements.status) elements.status.textContent = statusText;

      const lines = [];
      if (job.attemptsByPhase && typeof job.attemptsByPhase === 'object') {
        const phaseAttempts = Object.entries(job.attemptsByPhase)
          .slice(0, 4)
          .map(([phase, n]) => `${mapPhaseLabel(phase)}: ${n} tentativa(s)`);
        if (phaseAttempts.length) lines.push(phaseAttempts.join(' · '));
      }

      lines.push(...buildTechnicalTimeline(job));

      if (job.lastError) {
        lines.push(`Motivo técnico: ${job.lastError}`);
        if (/rate.?limit|429|quota|retry-after/i.test(String(job.lastError || ''))) {
          lines.push('Observação: limite temporário de API detectado, aguardando janela de retentativa.');
        }
      }

      if (elements.detail) {
        elements.detail.textContent = lines.filter(Boolean).join('\n') || 'Processando...';
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
