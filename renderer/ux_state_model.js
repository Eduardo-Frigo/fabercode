(function () {
  const UX_TONES = ['neutral', 'info', 'working', 'success', 'warning', 'danger'];
  const UX_COPY = {
    'en-US': {
      waiting: 'Waiting',
      inProgress: 'In progress',
      phaseCreated: 'Queue created',
      phaseIntake: 'Understanding request',
      phaseBriefing: 'Reading context',
      phaseRender: 'Preparing changes',
      phaseValidation: 'Validation',
      phaseTechnicalValidation: 'Technical validation',
      phasePlanning: 'Planning',
      phaseAwaitingYou: 'Waiting for you',
      phaseAwaitingConfirmation: 'Waiting for confirmation',
      phaseExecuting: 'Running',
      phaseMemoryPaused: 'Paused due to memory pressure',
      phasePlanningDone: 'Planning complete',
      phaseBriefingExhausted: 'Briefing attempts exhausted',
      phaseValidationExhausted: 'Validation attempts exhausted',
      phaseRetriesExhausted: 'Retries exhausted',
      phaseInterrupted: 'Run interrupted',
      cancelled: 'Cancelled',
      completed: 'Completed',
      failed: 'Failed',
      processing: 'Processing',
      sourceCurrentMessage: 'current message',
      sourceConversationBrief: 'conversation brief',
      sourceActiveMemory: 'active memory',
      sourceCurrentOrConversation: 'current message/conversation',
      undefined: 'undefined',
      approved: 'approved',
      blocked: 'blocked',
      reasonCortexScore: 'Cortex validation blocked the run: score {score}%',
      reasonCortexUnmet: 'Cortex validation blocked the run because required criteria still lack evidence',
      reasonPatchFirst: 'The patch-first guardrail blocked an attempt to recreate the project during incremental editing',
      reasonBriefing: 'Could not consolidate the Cortex technical brief',
      reasonNoFiles: 'The run ended without creating or changing project files',
      responseNoChanges: 'Response completed without changing files.',
      processingSuccess: 'Processing completed successfully.',
      processingObservations: 'Processing completed with notes.',
      cannotCompleteRound: 'I could not complete this round.',
      cancelledNoChanges: 'Task cancelled. No new operations will be started.',
      waitingApi: 'Waiting for the API window before trying again.',
      waitingRetry: 'Waiting for the retry window.',
      personaAuthorized: 'The Persona authorized the technical analysis.',
      analyzingProject: 'Analyzing project context and code.',
      correctionPrepared: 'I found the root cause and prepared the fix.',
      applyingChanges: 'Applying changes to the project.',
      validatingCorrection: 'Validating the fix.',
      memoryPressure: 'Paused due to memory pressure, waiting to resume.',
      workingProject: 'Working on the project.',
      executionWithNotes: 'Run completed with notes',
      cannotCompleteExecution: 'I could not complete this run',
      responseCompleted: 'Response completed',
      executionCompleted: 'Run completed',
      retrySoon: 'I will try again shortly',
      executionCancelled: 'Run cancelled',
      noExecution: 'No run',
      completedWithCaveats: 'Completed (with caveats)',
      failure: 'Failure',
      waitingRetryLabel: 'Waiting to retry',
      underway: 'In progress',
      retryIn: 'next attempt in {seconds}s',
      resumingNow: 'resuming now',
      attempt: 'attempt {value}',
      repair: 'repair {value}',
      noFurtherRetry: 'no further retry',
      retryActive: 'retry active',
      retry: 'Retry ({phase})',
      planningRepair: 'Planning auto-repair',
      repairPlanReady: 'Auto-repair plan ready',
      repairPlanFailed: 'Could not build the auto-repair plan',
      file: 'file {value}',
      patchExecution: 'Patch run',
      files: '{value} file(s)',
      patchApplied: 'Patch applied',
      errorsWarnings: 'errors {errors} · warnings {warnings}',
      validationBlocked: 'Validation blocked completion',
      task: 'task {value}',
      delta: 'delta {value}',
      noUsefulEffect: 'Run had no useful effect',
      activeMemoryAllowed: 'active memory allowed',
      activeMemorySuppressed: 'active memory suppressed',
      guard: 'guard: {value}',
      dominantContext: 'Dominant context',
      status: 'status {value}',
      contract: 'contract {value}',
      operations: '{value} operation(s)',
      deterministicPatch: 'Deterministic patch',
      responseWithoutRun: 'Response completed without a run',
      processingCompleted: 'Processing completed',
      finalFailure: 'Final failure',
      jobStarted: 'Job started',
      resultAnalysis: 'Result: analysis completed without a run.',
      resultExecution: 'Result: run completed.',
      resultCancelled: 'Result: run cancelled.',
      resultIncomplete: 'Result: run not completed.',
      path: 'Path: {value}.',
      retries: 'Retries: {value}.',
      technicalReason: 'Technical reason: {value}',
      attempts: '{label}: {value} attempt(s)',
      someFiles: 'some',
      rateLimitNote: 'Note: temporary API limit detected; waiting for the retry window.',
      processingEllipsis: 'Processing...',
      checkOperations: 'no applicable operation',
      checkFiles: 'base files missing',
      checkRunnable: 'executable entry missing',
      checkPatchFirst: 'patch-first was not respected',
      checkContent: 'invalid content in a critical file',
      checkCssOrder: 'invalid CSS import order',
      checkArtifactMinimum: 'quality/alignment below minimum',
      checkArtifactStack: 'requested stack not preserved',
      checkArtifactCss: 'insufficient visual CSS',
      checkArtifactResponsive: 'insufficient responsiveness',
      checkArtifactSpecificity: 'content is not specific enough',
      checkArtifactGeneric: 'generic placeholders',
      narrativeReading: 'I am reading the request and project before touching any files.',
      narrativeNeedAnswer: 'I need your response to continue without guessing.',
      narrativePreparing: 'I am preparing changes in real files.',
      narrativeValidatingPatch: 'I am validating the patch before allowing it to run or be promoted to the real project.',
      narrativeAwaitingConfirmation: 'I prepared a Cortex-validated fix and am waiting for confirmation before touching the files.',
      narrativeProtectedRun: 'I am running in a protected area and will only promote the changes if the real commands pass.',
      narrativeValidationRun: 'I am running the build, tests, and visual smoke test and collecting evidence.',
      narrativeContextOnly: 'I completed this round as a contextual response without changing files.',
      narrativeValidationPassed: 'I completed this round because the real validation passed.',
      narrativePartial: 'I changed {count} file(s), but found items that need attention during validation.',
      narrativeStopped: 'I stopped this round: {reason}',
      narrativeStoppedNoPromote: 'I stopped this round without marking it complete.',
      technicalValidation: 'Technical validation: {score}%{minimum}.',
      minimum: ' / minimum {value}%',
      blockersFound: 'Blocks found: {value}.',
      invalidContent: 'Invalid content found in: {value}.',
      artifactQuality: 'Artifact quality/alignment: {score}%{minimum}.',
      executorDiagnosis: 'Executor diagnosis: {value}',
      nextAction: 'Next action: fix the cause above and repeat the test cycle before marking the work complete.',
      dominantContextSources: 'Dominant context: {source}{allowed}',
      allowedSources: ' | allowed sources: {value}',
      memoryAllowedJob: 'Active memory: allowed for this job.',
      memorySuppressedJob: 'Active memory: suppressed{reason}.',
      memoryAvailableJob: 'Active memory: available, but not authorized for the brief.',
      contextGuardBlocked: 'Context guard: blocked ({reason}).',
      deterministicPatchStatus: 'Deterministic patch: {status}',
      contractLabel: 'contract: {value}',
      patchValidationSummary: 'Patch validation: {value}',
      patchValidationScore: 'Patch validation: {result} ({score}%{minimum}).',
      passedUpper: 'PASSED',
      failedUpper: 'FAILED',
      microcontract: 'Microcontract: {value}.',
    },
    'es-ES': {
      waiting: 'En espera',
      inProgress: 'En curso',
      phaseCreated: 'Cola creada',
      phaseIntake: 'Interpretando la solicitud',
      phaseBriefing: 'Leyendo el contexto',
      phaseRender: 'Preparando cambios',
      phaseValidation: 'Validación',
      phaseTechnicalValidation: 'Validación técnica',
      phasePlanning: 'Planificación',
      phaseAwaitingYou: 'Esperando tu respuesta',
      phaseAwaitingConfirmation: 'Esperando confirmación',
      phaseExecuting: 'Ejecutando',
      phaseMemoryPaused: 'Pausado por presión de memoria',
      phasePlanningDone: 'Planificación concluida',
      phaseBriefingExhausted: 'Intentos de briefing agotados',
      phaseValidationExhausted: 'Intentos de validación agotados',
      phaseRetriesExhausted: 'Reintentos agotados',
      phaseInterrupted: 'Ejecución interrumpida',
      cancelled: 'Cancelado',
      completed: 'Completado',
      failed: 'Falló',
      processing: 'Procesando',
      sourceCurrentMessage: 'mensaje actual',
      sourceConversationBrief: 'briefing de la conversación',
      sourceActiveMemory: 'memoria activa',
      sourceCurrentOrConversation: 'mensaje actual/conversación',
      undefined: 'indefinido',
      approved: 'aprobado',
      blocked: 'bloqueado',
      reasonCortexScore: 'La validación de Cortex bloqueó la ejecución: puntuación {score}%',
      reasonCortexUnmet: 'La validación de Cortex bloqueó la ejecución porque aún faltan evidencias para criterios obligatorios',
      reasonPatchFirst: 'La protección patch-first bloqueó un intento de recrear el proyecto durante la edición incremental',
      reasonBriefing: 'No se pudo consolidar el briefing técnico de Cortex',
      reasonNoFiles: 'La ejecución terminó sin crear ni modificar archivos del proyecto',
      responseNoChanges: 'Respuesta completada sin modificar archivos.',
      processingSuccess: 'Procesamiento completado correctamente.',
      processingObservations: 'Procesamiento completado con observaciones.',
      cannotCompleteRound: 'No pude completar esta ronda.',
      cancelledNoChanges: 'Acción cancelada. No se modificaron archivos.',
      waitingApi: 'Esperando la ventana de la API para volver a intentarlo.',
      waitingRetry: 'Esperando la ventana de reintento.',
      personaAuthorized: 'La Persona autorizó iniciar el análisis técnico.',
      analyzingProject: 'Analizando el contexto y el código del proyecto.',
      correctionPrepared: 'Encontré la causa raíz y preparé la corrección.',
      applyingChanges: 'Aplicando cambios al proyecto.',
      validatingCorrection: 'Validando el resultado de la corrección.',
      memoryPressure: 'Pausado por presión de memoria, esperando reanudación.',
      workingProject: 'Trabajando en el proyecto.',
      executionWithNotes: 'Ejecución completada con observaciones',
      cannotCompleteExecution: 'No pude completar esta ejecución',
      responseCompleted: 'Respuesta completada',
      executionCompleted: 'Ejecución completada',
      retrySoon: 'Volveré a intentarlo en breve',
      executionCancelled: 'Ejecución cancelada',
      noExecution: 'Sin ejecución',
      completedWithCaveats: 'Completado (con salvedades)',
      failure: 'Fallo',
      waitingRetryLabel: 'Esperando reintento',
      underway: 'En curso',
      retryIn: 'próximo intento en {seconds}s',
      resumingNow: 'reanudando ahora',
      attempt: 'intento {value}',
      repair: 'reparación {value}',
      noFurtherRetry: 'sin nuevo reintento',
      retryActive: 'reintento activo',
      retry: 'Reintento ({phase})',
      planningRepair: 'Planificando reparación automática',
      repairPlanReady: 'Plan de reparación automática listo',
      repairPlanFailed: 'No se pudo crear el plan de reparación automática',
      file: 'archivo {value}',
      patchExecution: 'Ejecución del parche',
      files: '{value} archivo(s)',
      patchApplied: 'Parche aplicado',
      errorsWarnings: 'errores {errors} · avisos {warnings}',
      validationBlocked: 'La validación bloqueó la finalización',
      task: 'tarea {value}',
      delta: 'delta {value}',
      noUsefulEffect: 'La ejecución no tuvo un efecto útil',
      activeMemoryAllowed: 'memoria activa permitida',
      activeMemorySuppressed: 'memoria activa suprimida',
      guard: 'protección: {value}',
      dominantContext: 'Contexto dominante',
      status: 'estado {value}',
      contract: 'contrato {value}',
      operations: '{value} operación(es)',
      deterministicPatch: 'Parche determinista',
      responseWithoutRun: 'Respuesta completada sin ejecución',
      processingCompleted: 'Procesamiento completado',
      finalFailure: 'Fallo final',
      jobStarted: 'Trabajo iniciado',
      resultAnalysis: 'Resultado: análisis completado sin ejecución.',
      resultExecution: 'Resultado: ejecución completada.',
      resultCancelled: 'Resultado: ejecución cancelada.',
      resultIncomplete: 'Resultado: ejecución no completada.',
      path: 'Recorrido: {value}.',
      retries: 'Reintentos: {value}.',
      technicalReason: 'Motivo técnico: {value}',
      attempts: '{label}: {value} intento(s)',
      someFiles: 'algunos',
      rateLimitNote: 'Observación: se detectó un límite temporal de la API; esperando la ventana de reintento.',
      processingEllipsis: 'Procesando...',
      checkOperations: 'ninguna operación aplicable',
      checkFiles: 'faltan archivos base',
      checkRunnable: 'falta una entrada ejecutable',
      checkPatchFirst: 'no se respetó patch-first',
      checkContent: 'contenido inválido en un archivo crítico',
      checkCssOrder: 'orden de importación CSS inválido',
      checkArtifactMinimum: 'calidad/alineación por debajo del mínimo',
      checkArtifactStack: 'no se conservó el stack solicitado',
      checkArtifactCss: 'CSS visual insuficiente',
      checkArtifactResponsive: 'adaptabilidad insuficiente',
      checkArtifactSpecificity: 'contenido poco específico',
      checkArtifactGeneric: 'placeholders genéricos',
      narrativeReading: 'Estoy leyendo la solicitud y el proyecto antes de modificar archivos.',
      narrativeNeedAnswer: 'Necesito tu respuesta para continuar sin adivinar.',
      narrativePreparing: 'Estoy preparando cambios en archivos reales.',
      narrativeValidatingPatch: 'Estoy validando el parche antes de permitir su ejecución o promoción al proyecto real.',
      narrativeAwaitingConfirmation: 'Preparé una corrección validada por Cortex y espero tu confirmación antes de modificar los archivos.',
      narrativeProtectedRun: 'Estoy ejecutando en un área protegida y solo promoveré los cambios si los comandos reales pasan.',
      narrativeValidationRun: 'Estoy ejecutando build, pruebas y smoke visual y recopilando evidencias.',
      narrativeContextOnly: 'Completé esta ronda como respuesta contextual, sin modificar archivos.',
      narrativeValidationPassed: 'Completé esta ronda porque la validación real pasó.',
      narrativePartial: 'Modifiqué {count} archivo(s), pero detecté puntos de atención en la validación.',
      narrativeStopped: 'Detuve esta ronda: {reason}',
      narrativeStoppedNoPromote: 'Detuve esta ronda sin marcarla como completada.',
      technicalValidation: 'Validación técnica: {score}%{minimum}.',
      minimum: ' / mínimo {value}%',
      blockersFound: 'Bloqueos encontrados: {value}.',
      invalidContent: 'Contenido inválido detectado en: {value}.',
      artifactQuality: 'Calidad/alineación del artefacto: {score}%{minimum}.',
      executorDiagnosis: 'Diagnóstico del Executor: {value}',
      nextAction: 'Próxima acción: corregir la causa indicada y repetir el ciclo de pruebas antes de marcarlo como completado.',
      dominantContextSources: 'Contexto dominante: {source}{allowed}',
      allowedSources: ' | fuentes permitidas: {value}',
      memoryAllowedJob: 'Memoria activa: permitida para este trabajo.',
      memorySuppressedJob: 'Memoria activa: suprimida{reason}.',
      memoryAvailableJob: 'Memoria activa: disponible, pero sin autorización para el briefing.',
      contextGuardBlocked: 'Protección de contexto: bloqueada ({reason}).',
      deterministicPatchStatus: 'Parche determinista: {status}',
      contractLabel: 'contrato: {value}',
      patchValidationSummary: 'Validación del parche: {value}',
      patchValidationScore: 'Validación del parche: {result} ({score}%{minimum}).',
      passedUpper: 'PASÓ',
      failedUpper: 'FALLÓ',
      microcontract: 'Microcontrato: {value}.',
    },
  };

  function uxLocale() {
    if (typeof document === 'undefined' || !document.documentElement) return 'pt-BR';
    return document.documentElement.lang || 'pt-BR';
  }

  function uxText(key, fallback, params = {}) {
    const locale = uxLocale();
    const table = UX_COPY[locale] || UX_COPY[locale.split('-')[0]] || {};
    const template = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;
    return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    ));
  }

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
    const label = String(text || '').trim() || uxText('waiting', 'Aguardando');
    const explicitTone = options.tone ? normalizeUxTone(options.tone) : '';
    const tone = explicitTone || inferUxToneFromText(label);
    const busy = typeof options.busy === 'boolean' ? options.busy : isBusyText(label, tone);
    return {
      label,
      tone,
      busy,
      ariaLabel: busy ? `${label}. ${uxText('inProgress', 'Em andamento')}.` : label,
    };
  }

  function mapJobPhaseLabel(phase) {
    const labels = {
      created: uxText('phaseCreated', 'Fila criada'),
      cortex_intake: uxText('phaseIntake', 'Entendendo pedido'),
      cortex_briefing: uxText('phaseBriefing', 'Lendo contexto'),
      cortex_render_pass: uxText('phaseRender', 'Preparando mudança'),
      cortex_validation: uxText('phaseValidation', 'Validação'),
      execute_validation: uxText('phaseTechnicalValidation', 'Validação técnica'),
      persona_plan: uxText('phasePlanning', 'Planejamento'),
      awaiting_user_input: uxText('phaseAwaitingYou', 'Aguardando você'),
      awaiting_user_confirmation: uxText('phaseAwaitingConfirmation', 'Aguardando confirmação'),
      execute_pending: uxText('phaseExecuting', 'Executando'),
      paused_memory_pressure: uxText('phaseMemoryPaused', 'Pausado por memória'),
      persona_done: uxText('phasePlanningDone', 'Planejamento concluído'),
      cortex_briefing_retry_exhausted: uxText('phaseBriefingExhausted', 'Briefing esgotado'),
      cortex_validation_retry_exhausted: uxText('phaseValidationExhausted', 'Validação esgotada'),
      persona_retry_exhausted: uxText('phaseRetriesExhausted', 'Retentativas esgotadas'),
      runtime_interrupted: uxText('phaseInterrupted', 'Execução interrompida'),
      cancelled: uxText('cancelled', 'Cancelado'),
      done: uxText('completed', 'Concluído'),
      failed: uxText('failed', 'Falhou'),
    };
    return labels[phase] || phase || uxText('processing', 'Processando');
  }

  const JOB_PHASE_ORDER = [
    'created',
    'persona_plan',
    'cortex_intake',
    'cortex_briefing',
    'awaiting_user_input',
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

  function readLatestJobEventPayload(job, type) {
    const events = normalizeJobEvents(job);
    const match = events.find((event) => String((event && event.type) || '') === type);
    const payload = match && match.payload && typeof match.payload === 'object' ? match.payload : null;
    return payload || null;
  }

  function isCompletedWithoutExecution(job) {
    if (!job || String(job.status || '').toLowerCase() !== 'completed') return false;
    const payload = readLatestJobEventPayload(job, 'job.completed');
    if (!payload) return false;
    const reason = normalizeText(payload.reason || '');
    return payload.noFileChanges === true || reason === 'conversation_only' || reason === 'edit_needs_target';
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
      current_message: uxText('sourceCurrentMessage', 'mensagem atual'),
      conversation_brief: uxText('sourceConversationBrief', 'briefing da conversa'),
      active_memory: uxText('sourceActiveMemory', 'memória ativa'),
      current_message_or_conversation: uxText('sourceCurrentOrConversation', 'mensagem atual/conversa'),
      unknown: uxText('undefined', 'indefinido'),
    };
    return labels[source] || source || labels.unknown;
  }

  function mapPatchEvidenceStatusLabel(status) {
    const labels = {
      approved: uxText('approved', 'aprovado'),
      blocked: uxText('blocked', 'bloqueado'),
      unknown: uxText('undefined', 'indefinido'),
    };
    return labels[status] || status || labels.unknown;
  }

  function compactUxReason(reason) {
    const text = String(reason || '').trim();
    if (!text) return '';
    const cortexScoreMatch = text.match(/^cortex_validation_score:(\d+)\b/i);
    if (cortexScoreMatch) {
      return uxText('reasonCortexScore', 'Validação Cortex bloqueou a execução: score {score}%', { score: cortexScoreMatch[1] });
    }
    if (/^cortex_validation_unmet\b/i.test(text)) {
      return uxText('reasonCortexUnmet', 'Validação Cortex bloqueou a execução porque ainda há critérios obrigatórios sem evidência');
    }
    if (/^cortex_patchfirst_guardrail\b/i.test(text)) {
      return uxText('reasonPatchFirst', 'Guardrail patch-first bloqueou uma tentativa de recriar o projeto durante edição incremental');
    }
    if (/^cortex_briefing_error\b/i.test(text)) {
      return uxText('reasonBriefing', 'Falha ao consolidar o briefing técnico do Cortex');
    }
    if (/^agentic_no_file_changes\b/i.test(text)) {
      return uxText('reasonNoFiles', 'A execução terminou sem criar ou alterar arquivos no projeto');
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
      return new Date(iso).toLocaleTimeString(uxLocale());
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

  function isPartialSuccess(job) {
    if (!job || String(job.status || '').toLowerCase() !== 'failed') return false;
    // se falhou mas existem modifiedFiles > 0, é sucesso parcial
    const payload = readLatestJobEventPayload(job, 'job.execute_validation_blocked');
    if (payload && payload.modifiedFilesCount > 0) return true;
    
    // Fallback: procuramos event execute_pass_finished
    const passFinished = readLatestJobEventPayload(job, 'job.execute_pass_finished');
    if (passFinished && passFinished.modifiedFilesCount > 0) return true;

    return false;
  }

  function inferJobTone(job) {
    const status = String(job && job.status ? job.status : '').toLowerCase();
    if (status === 'completed' && isCompletedWithoutExecution(job)) return 'info';
    if (status === 'completed') return 'success';
    if (isPartialSuccess(job)) return 'partial_success';
    if (status === 'failed') return 'danger';
    if (status === 'cancelled' || status === 'retry_pending') return 'warning';
    return 'working';
  }

  function buildTransientJobStatus(job) {
    if (!job || !job.status) return '';
    if (job.status === 'completed') {
      return isCompletedWithoutExecution(job)
        ? uxText('responseNoChanges', 'Resposta concluída sem alterar arquivos.')
        : uxText('processingSuccess', 'Processamento concluído com sucesso.');
    }
    if (job.status === 'failed') {
      return isPartialSuccess(job)
        ? uxText('processingObservations', 'Processamento concluído com observações.')
        : uxText('cannotCompleteRound', 'Não consegui concluir esta rodada.');
    }
    if (job.status === 'cancelled') return uxText('cancelledNoChanges', 'Tarefa cancelada. Nenhuma nova operação será iniciada.');
    if (job.status === 'retry_pending') {
      const reason = normalizeText(job.lastError || '');
      if (/429|rate.?limit|quota/.test(reason)) return uxText('waitingApi', 'Aguardando janela de API para nova tentativa.');
      return uxText('waitingRetry', 'Aguardando janela de retentativa.');
    }

    const phase = String(job.phase || '').toLowerCase();
    if (phase === 'created') return uxText('personaAuthorized', 'A Persona autorizou iniciar a análise técnica.');
    if (phase === 'persona_plan' || phase === 'cortex_briefing' || phase === 'cortex_intake') {
      return uxText('analyzingProject', 'Analisando contexto e código do projeto.');
    }
    if (phase === 'awaiting_user_confirmation') return uxText('correctionPrepared', 'Encontrei a raiz do problema e preparei a correção.');
    if (phase === 'execute_pending' || phase === 'cortex_render_pass') return uxText('applyingChanges', 'Aplicando alterações no projeto.');
    if (phase === 'cortex_validation' || phase === 'execute_validation') return uxText('validatingCorrection', 'Validando resultado da correção.');
    if (phase === 'paused_memory_pressure') return uxText('memoryPressure', 'Pausado por pressão de memória, aguardando retomada.');
    return uxText('workingProject', 'Trabalhando no projeto.');
  }

  function buildJobTitle(job) {
    if (!job) return uxText('processing', 'Processando');
    if (job.status === 'failed') {
      return isPartialSuccess(job)
        ? uxText('executionWithNotes', 'Execução concluída com observações')
        : uxText('cannotCompleteExecution', 'Não consegui concluir essa execução');
    }
    if (job.status === 'completed') {
      return isCompletedWithoutExecution(job)
        ? uxText('responseCompleted', 'Resposta concluída')
        : uxText('executionCompleted', 'Execução concluída');
    }
    if (job.status === 'retry_pending') return uxText('retrySoon', 'Vou tentar novamente em instantes');
    if (job.status === 'cancelled') return uxText('executionCancelled', 'Execução cancelada');
    return uxText('workingProject', 'Trabalhando no projeto');
  }

  function buildJobStatusLabel(job) {
    if (!job) return uxText('waiting', 'Aguardando');
    if (job.status === 'completed') {
      return isCompletedWithoutExecution(job)
        ? uxText('noExecution', 'Sem execução')
        : uxText('completed', 'Concluído');
    }
    if (job.status === 'failed') {
      return isPartialSuccess(job)
        ? uxText('completedWithCaveats', 'Concluído (com ressalvas)')
        : uxText('failure', 'Falha');
    }
    if (job.status === 'cancelled') return uxText('cancelled', 'Cancelado');
    if (job.status === 'retry_pending') return uxText('waitingRetryLabel', 'Aguardando retentativa');
    return uxText('underway', 'Em andamento');
  }

  function buildRetryCountdown(job, now = Date.now()) {
    if (!job || job.status !== 'retry_pending' || !job.retryState || !job.retryState.nextRetryAt) return '';
    const nextMs = new Date(job.retryState.nextRetryAt).getTime();
    if (!Number.isFinite(nextMs)) return '';
    const seconds = Math.ceil(Math.max(0, nextMs - now) / 1000);
    return seconds > 0
      ? uxText('retryIn', 'próxima tentativa em {seconds}s', { seconds })
      : uxText('resumingNow', 'retomando agora');
  }

  function buildTechnicalTimeline(job, options = {}) {
    const limit = Math.max(1, Math.min(80, Number(options.limit || 8)));
    const newestFirst = options.newestFirst !== false;
    const sourceEvents = normalizeJobEvents(job).filter((event) => {
      const type = String((event && event.type) || '');
      return type !== 'job.checkpoint_saved';
    });
    const events = (newestFirst ? sourceEvents : sourceEvents.slice().reverse()).slice(0, limit);
    if (!events.length) return [];

    return events.map((event) => {
      const type = String((event && event.type) || 'job.event');
      const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
      const ts = formatUxTime(event && event.createdAt);

      if (type === 'job.phase_changed') {
        const phase = mapJobPhaseLabel(String(payload.phase || ''));
        const attempt = Number.isFinite(Number(payload.attempt))
          ? uxText('attempt', 'tentativa {value}', { value: Number(payload.attempt) })
          : null;
        const progressPct = Number.isFinite(Number(payload.progressPct)) ? `${Number(payload.progressPct)}%` : null;
        const autoRepairAttempt = Number.isFinite(Number(payload.autoRepairAttempt))
          ? uxText('repair', 'reparo {value}', { value: Number(payload.autoRepairAttempt) })
          : null;
        const detail = [attempt, progressPct, autoRepairAttempt].filter(Boolean).join(' · ');
        return `${ts} ${phase}${detail ? ` - ${detail}` : ''}`.trim();
      }

      if (type === 'job.retry_pending') {
        const phase = mapJobPhaseLabel(String(payload.phase || ''));
        const retryable = payload.retryable === false
          ? uxText('noFurtherRetry', 'sem nova retentativa')
          : uxText('retryActive', 'retentativa ativa');
        const reason = compactUxReason(payload.reason);
        return `${ts} ${uxText('retry', 'Retentativa ({phase})', { phase })} - ${retryable}${reason ? ` · ${reason}` : ''}`.trim();
      }

      if (type === 'job.auto_repair_planning') {
        const attempt = Number.isFinite(Number(payload.autoRepairAttempt))
          ? Number(payload.autoRepairAttempt)
          : null;
        const maxPass = Number.isFinite(Number(payload.maxAutoRepairPasses))
          ? Number(payload.maxAutoRepairPasses)
          : null;
        return `${ts} ${uxText('planningRepair', 'Planejando auto-reparo')}${attempt ? ` ${attempt}/${maxPass || '?'}` : ''}`.trim();
      }

      if (type === 'job.auto_repair_plan_ready') {
        const file = payload.targetFile ? uxText('file', 'arquivo {value}', { value: payload.targetFile }) : null;
        return `${ts} ${uxText('repairPlanReady', 'Plano de auto-reparo pronto')}${file ? ` - ${file}` : ''}`.trim();
      }

      if (type === 'job.auto_repair_plan_failed') {
        const reason = compactUxReason(payload.reason);
        return `${ts} ${uxText('repairPlanFailed', 'Falha ao montar plano de auto-reparo')}${reason ? ` - ${reason}` : ''}`.trim();
      }

      if (type === 'job.execute_pass_started') {
        const pass = Number.isFinite(Number(payload.executionPass)) ? Number(payload.executionPass) : null;
        const total = Number.isFinite(Number(payload.totalPlannedPasses)) ? Number(payload.totalPlannedPasses) : null;
        const file = payload.targetFile ? uxText('file', 'arquivo {value}', { value: payload.targetFile }) : null;
        return `${ts} ${uxText('patchExecution', 'Execução de patch')}${pass ? ` ${pass}/${total || '?'}` : ''}${file ? ` - ${file}` : ''}`.trim();
      }

      if (type === 'job.execute_pass_finished') {
        const files = Number.isFinite(Number(payload.modifiedFilesCount))
          ? uxText('files', '{value} arquivo(s)', { value: Number(payload.modifiedFilesCount) })
          : null;
        return `${ts} ${uxText('patchApplied', 'Patch aplicado')}${files ? ` - ${files}` : ''}`.trim();
      }

      if (type === 'job.execute_validation_blocked') {
        const errors = Number.isFinite(Number(payload.errors)) ? Number(payload.errors) : null;
        const warnings = Number.isFinite(Number(payload.warnings)) ? Number(payload.warnings) : null;
        const reason = compactUxReason(payload.reason);
        const counts = errors === null && warnings === null
          ? null
          : uxText('errorsWarnings', 'erros {errors} · avisos {warnings}', { errors: errors || 0, warnings: warnings || 0 });
        return `${ts} ${uxText('validationBlocked', 'Validação bloqueou conclusão')}${counts ? ` - ${counts}` : ''}${reason ? ` · ${reason}` : ''}`.trim();
      }

      if (type === 'job.execute_effect_blocked') {
        const taskType = payload.taskType ? uxText('task', 'tarefa {value}', { value: payload.taskType }) : null;
        const modifiedFilesCount = Number.isFinite(Number(payload.modifiedFilesCount))
          ? uxText('files', '{value} arquivo(s)', { value: Number(payload.modifiedFilesCount) })
          : null;
        const totalDelta = Number.isFinite(Number(payload.totalDelta))
          ? uxText('delta', 'delta {value}', { value: Number(payload.totalDelta) })
          : null;
        const reason = compactUxReason(payload.reason);
        const detail = [taskType, modifiedFilesCount, totalDelta].filter(Boolean).join(' · ');
        return `${ts} ${uxText('noUsefulEffect', 'Execução sem efeito útil')}${detail ? ` - ${detail}` : ''}${reason ? ` · ${reason}` : ''}`.trim();
      }

      if (type === 'job.context_frame') {
        const dominantSource = mapContextSourceLabel(payload.dominantSource);
        const memoryStatus = payload.activeMemoryAllowed
          ? uxText('activeMemoryAllowed', 'memória ativa permitida')
          : payload.activeMemorySuppressed
            ? uxText('activeMemorySuppressed', 'memória ativa suprimida')
            : '';
        const guard = payload.guardReason ? uxText('guard', 'guarda: {value}', { value: payload.guardReason }) : '';
        return `${ts} ${uxText('dominantContext', 'Contexto dominante')} - ${[dominantSource, memoryStatus, guard].filter(Boolean).join(' · ')}`.trim();
      }

      if (type === 'job.deterministic_patch_evidence') {
        const status = payload.status ? uxText('status', 'status {value}', { value: mapPatchEvidenceStatusLabel(payload.status) }) : '';
        const kind = payload.kind ? uxText('contract', 'contrato {value}', { value: payload.kind }) : '';
        const operations = Number.isFinite(Number(payload.operationsCount))
          ? uxText('operations', '{value} operação(ões)', { value: Number(payload.operationsCount) })
          : '';
        const files = Number.isFinite(Number(payload.changedFilesCount))
          ? uxText('files', '{value} arquivo(s)', { value: Number(payload.changedFilesCount) })
          : '';
        return `${ts} ${uxText('deterministicPatch', 'Patch determinístico')} - ${[status, kind, operations, files].filter(Boolean).join(' · ')}`.trim();
      }

      if (type === 'job.completed') {
        return `${ts} ${payload.noFileChanges
          ? uxText('responseWithoutRun', 'Resposta concluída sem execução')
          : uxText('processingCompleted', 'Processamento concluído')}`.trim();
      }
      if (type === 'job.failed') {
        const reason = compactUxReason(payload.reason);
        return `${ts} ${uxText('finalFailure', 'Falha final')}${reason ? ` - ${reason}` : ''}`.trim();
      }
      if (type === 'job.created') return `${ts} ${uxText('jobStarted', 'Job iniciado')}`.trim();

      return `${ts} ${type}`.trim();
    });
  }

  function buildFinalSummaryLines(job, phaseSteps = []) {
    if (!job || !['completed', 'failed', 'cancelled'].includes(String(job.status || '').toLowerCase())) return [];
    const status = String(job.status || '').toLowerCase();
    const completedWithoutExecution = isCompletedWithoutExecution(job);
    const result =
      status === 'completed'
        ? completedWithoutExecution
          ? uxText('resultAnalysis', 'Resultado: análise concluída sem execução.')
          : uxText('resultExecution', 'Resultado: execução concluída.')
        : status === 'cancelled'
          ? uxText('resultCancelled', 'Resultado: execução cancelada.')
          : uxText('resultIncomplete', 'Resultado: execução não concluída.');
    const walkedPhases = phaseSteps
      .filter((step) => step && step.state !== 'pending')
      .map((step) => step.label)
      .filter(Boolean);
    const attempts = phaseSteps
      .filter((step) => step && Number(step.attempt || 0) > 1)
      .map((step) => uxText('attempts', '{label}: {value} tentativa(s)', {
        label: step.label,
        value: step.attempt,
      }));
    const lines = [result];
    if (walkedPhases.length) {
      lines.push(uxText('path', 'Caminho: {value}.', { value: walkedPhases.join(' > ') }));
    }
    if (attempts.length) {
      lines.push(uxText('retries', 'Retentativas: {value}.', { value: attempts.join(' | ') }));
    }
    lines.push(...buildJobNarrativeLines(job, { includePhaseLine: false, includeNextAction: true }));
    if (job.lastError) {
      lines.push(uxText('technicalReason', 'Motivo técnico: {value}', {
        value: formatUxSentence(compactUxReason(job.lastError)),
      }));
    }
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
      operations: uxText('checkOperations', 'nenhuma operação aplicável'),
      files: uxText('checkFiles', 'arquivos base ausentes'),
      runnableEntry: uxText('checkRunnable', 'entrada executável ausente'),
      patchFirst: uxText('checkPatchFirst', 'patch-first não respeitado'),
      operationContentValidity: uxText('checkContent', 'conteúdo inválido em arquivo crítico'),
      cssImportOrder: uxText('checkCssOrder', 'ordem de import CSS inválida'),
      artifactMinimum: uxText('checkArtifactMinimum', 'qualidade/aderência abaixo do mínimo'),
      artifactStack: uxText('checkArtifactStack', 'stack solicitada não preservada'),
      artifactCss: uxText('checkArtifactCss', 'CSS visual insuficiente'),
      artifactResponsive: uxText('checkArtifactResponsive', 'responsividade insuficiente'),
      artifactSpecificity: uxText('checkArtifactSpecificity', 'conteúdo pouco específico'),
      artifactNoGeneric: uxText('checkArtifactGeneric', 'placeholders genéricos'),
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
        lines.push(uxText('narrativeReading', 'Estou lendo o pedido e o projeto antes de tocar nos arquivos.'));
      } else if (phase === 'awaiting_user_input') {
        lines.push(uxText('narrativeNeedAnswer', 'Preciso de uma resposta sua para continuar sem adivinhar.'));
      } else if (phase === 'cortex_render_pass') {
        lines.push(uxText('narrativePreparing', 'Estou preparando a mudança em arquivos reais.'));
      } else if (phase === 'cortex_validation') {
        lines.push(uxText(
          'narrativeValidatingPatch',
          'Estou validando o patch antes de permitir execução ou promoção para o projeto real.'
        ));
      } else if (phase === 'awaiting_user_confirmation') {
        lines.push(uxText(
          'narrativeAwaitingConfirmation',
          'Preparei uma correção validada pelo Cortex e aguardo confirmação antes de tocar nos arquivos.'
        ));
      } else if (phase === 'execute_pending') {
        lines.push(uxText(
          'narrativeProtectedRun',
          'Estou executando em área protegida e só devo promover se os comandos reais passarem.'
        ));
      } else if (phase === 'execute_validation') {
        lines.push(uxText(
          'narrativeValidationRun',
          'Estou rodando build, testes, smoke visual e coletando evidência do resultado.'
        ));
      } else if (status === 'completed') {
        lines.push(
          isCompletedWithoutExecution(job)
            ? uxText('narrativeContextOnly', 'Concluí esta rodada como resposta contextual, sem alterar arquivos.')
            : uxText('narrativeValidationPassed', 'Concluí esta rodada porque a validação real passou.')
        );
      }
    }

    if (status === 'failed') {
      if (isPartialSuccess(job)) {
        const payload = readLatestJobEventPayload(job, 'job.execute_validation_blocked') || readLatestJobEventPayload(job, 'job.execute_pass_finished');
        const count = payload && payload.modifiedFilesCount
          ? payload.modifiedFilesCount
          : uxText('someFiles', 'alguns');
        lines.push(uxText(
          'narrativePartial',
          'Concluí a alteração de {count} arquivo(s), mas detectei pontos de atenção na validação.',
          { count }
        ));
      } else {
        const reason = compactUxReason(job.lastError);
        if (reason) {
          lines.push(formatUxSentence(uxText('narrativeStopped', 'Parei esta rodada: {reason}', { reason })));
        } else {
          lines.push(uxText('narrativeStoppedNoPromote', 'Parei esta rodada sem promover como concluída.'));
        }
      }
    }

    if (validation && status === 'failed') {
      const score = Number.isFinite(Number(validation.score)) ? Number(validation.score) : null;
      const minScore = Number.isFinite(Number(validation.minScore)) ? Number(validation.minScore) : null;
      if (score !== null) {
        const minimum = minScore !== null
          ? uxText('minimum', ' / mínimo {value}%', { value: minScore })
          : '';
        lines.push(uxText('technicalValidation', 'Validação técnica: {score}%{minimum}.', { score, minimum }));
      }
      const failedChecks = summarizeFailedChecks(validation.checks);
      if (failedChecks) {
        lines.push(uxText('blockersFound', 'Bloqueios encontrados: {value}.', { value: failedChecks }));
      }
      const invalidFiles = summarizeInvalidOperationContents(validation.invalidOperationContents);
      if (invalidFiles) {
        lines.push(uxText('invalidContent', 'Conteúdo inválido detectado em: {value}.', { value: invalidFiles }));
      }
      const artifactQuality = validation.artifactQuality && typeof validation.artifactQuality === 'object'
        ? validation.artifactQuality
        : null;
      if (artifactQuality && Number.isFinite(Number(artifactQuality.score))) {
        const minimum = Number.isFinite(Number(artifactQuality.minScore))
          ? uxText('minimum', ' / mínimo {value}%', { value: Number(artifactQuality.minScore) })
          : '';
        lines.push(uxText(
          'artifactQuality',
          'Qualidade/aderência do artefato: {score}%{minimum}.',
          { score: Number(artifactQuality.score), minimum }
        ));
      }
    }

    const lastPlan = readJobCheckpointData(job, 'last_plan');
    if (status === 'failed' && lastPlan && lastPlan.responsePreview) {
      const preview = clipUxLine(lastPlan.responsePreview, 240);
      if (preview) {
        lines.push(uxText('executorDiagnosis', 'Diagnóstico do Executor: {value}', { value: preview }));
      }
    }

    if (status === 'failed' && includeNextAction) {
      lines.push(uxText(
        'nextAction',
        'Próxima ação: corrigir a causa apontada acima e repetir o ciclo de teste antes de marcar como concluído.'
      ));
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
      uxText('dominantContextSources', 'Contexto dominante: {source}{allowed}', {
        source: dominantSource,
        allowed: allowedSources.length
          ? uxText('allowedSources', ' | fontes permitidas: {value}', { value: allowedSources.join(', ') })
          : '',
      }),
    ];
    const activeMemory = evidence.activeMemory && typeof evidence.activeMemory === 'object'
      ? evidence.activeMemory
      : {};
    if (activeMemory.allowedForBriefing || activeMemory.allowedForRouting) {
      lines.push(uxText('memoryAllowedJob', 'Memória ativa: permitida para este job.'));
    } else if (activeMemory.suppressed) {
      lines.push(uxText('memorySuppressedJob', 'Memória ativa: suprimida{reason}.', {
        reason: activeMemory.suppressionReason ? ` (${activeMemory.suppressionReason})` : '',
      }));
    } else if (activeMemory.available) {
      lines.push(uxText('memoryAvailableJob', 'Memória ativa: disponível, mas sem autorização para briefing.'));
    }
    if (evidence.guard && evidence.guard.blocking) {
      lines.push(uxText('contextGuardBlocked', 'Guarda de contexto: bloqueado ({reason}).', {
        reason: evidence.guard.reason || 'context_frame_guard',
      }));
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
      uxText('deterministicPatchStatus', 'Patch determinístico: {status}', { status }),
      kind ? uxText('contractLabel', 'contrato: {value}', { value: kind }) : '',
      operationsCount !== null
        ? uxText('operations', '{value} operação(ões)', { value: operationsCount })
        : '',
      changedFilesCount !== null
        ? uxText('files', '{value} arquivo(s)', { value: changedFilesCount })
        : '',
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
      lines.push(uxText('patchValidationSummary', 'Validação do patch: {value}', { value: validation.summary }));
    } else if (typeof validationOk === 'boolean' && score !== null) {
      const result = validationOk
        ? uxText('passedUpper', 'PASSOU')
        : uxText('failedUpper', 'FALHOU');
      const minimum = minScore !== null
        ? uxText('minimum', ' / mínimo {value}%', { value: minScore })
        : '';
      lines.push(uxText(
        'patchValidationScore',
        'Validação do patch: {result} ({score}%{minimum}).',
        { result, score, minimum }
      ));
    }
    const microContractType =
      evidence.microContract && typeof evidence.microContract === 'object'
        ? evidence.microContract.type
        : evidence.microContractType;
    if (microContractType) {
      lines.push(uxText('microcontract', 'Microcontrato: {value}.', { value: microContractType }));
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
        .map(([phase, n]) => uxText('attempts', '{label}: {value} tentativa(s)', {
          label: mapJobPhaseLabel(phase),
          value: n,
        }));
      if (phaseAttempts.length) detailLines.push(phaseAttempts.join(' · '));
    }

    detailLines.push(...buildJobNarrativeLines(job, { includePhaseLine: true, includeNextAction: true }));
    detailLines.push(...buildContextFrameDiagnosticLines(job));
    detailLines.push(...buildDeterministicPatchDiagnosticLines(job));
    const recentTimeline = buildTechnicalTimeline(job, { limit: 10, newestFirst: true });
    const fullTimeline = buildTechnicalTimeline(job, { limit: 48, newestFirst: false });
    detailLines.push(...recentTimeline);

    if (job.lastError) {
      detailLines.push(uxText('technicalReason', 'Motivo técnico: {value}', {
        value: formatUxSentence(compactUxReason(job.lastError)),
      }));
      if (/rate.?limit|429|quota|retry-after/i.test(String(job.lastError || ''))) {
        detailLines.push(uxText(
          'rateLimitNote',
          'Observação: limite temporário de API detectado, aguardando janela de retentativa.'
        ));
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
      detailText: detailLines.filter(Boolean).join('\n') || uxText('processingEllipsis', 'Processando...'),
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
