const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ux_state_model.js'), 'utf8');
const sandbox = {
  Date,
  window: {},
};
sandbox.window.window = sandbox.window;

vm.runInNewContext(source, sandbox, { filename: 'ux_state_model.js' });

const model = sandbox.window.FaberUxStateModel;
assert.ok(model, 'FaberUxStateModel should be registered');

assert.strictEqual(model.normalizeUxTone('danger'), 'danger');
assert.strictEqual(model.normalizeUxTone('unknown'), 'neutral');
assert.strictEqual(model.inferUxToneFromText('Falha ao validar preview'), 'danger');
assert.strictEqual(model.inferUxToneFromText('Preparando plano GitHub'), 'working');
assert.strictEqual(model.inferUxToneFromText('Processamento concluído com sucesso.'), 'success');
assert.strictEqual(model.inferUxToneFromText('Aguardando confirmação'), 'warning');

const status = model.buildStatusPresentation('Validando resultado da correção.');
assert.deepStrictEqual(
  {
    label: status.label,
    tone: status.tone,
    busy: status.busy,
  },
  {
    label: 'Validando resultado da correção.',
    tone: 'working',
    busy: true,
  }
);

const baseTime = Date.parse('2026-05-23T12:00:00.000Z');
const running = model.buildJobProgressPresentation(
  {
    status: 'running',
    phase: 'cortex_validation',
    progress: { pct: 61.4 },
    attemptsByPhase: { cortex_validation: 2 },
    events: [
      {
        type: 'job.phase_changed',
        createdAt: '2026-05-23T11:59:59.000Z',
        payload: { phase: 'cortex_validation', progressPct: 61 },
      },
    ],
  },
  { now: baseTime }
);
assert.strictEqual(running.title, 'Trabalhando no projeto');
assert.strictEqual(running.tone, 'working');
assert.strictEqual(running.busy, true);
assert.strictEqual(running.progressPct, 61);
assert.match(running.statusText, /Em andamento \| Validação \| 61%/);
assert.match(running.detailText, /Validação: 2 tentativa/);
assert.ok(running.phaseSteps.some((step) => step.phase === 'cortex_validation' && step.state === 'active'));
assert.ok(running.activityLines.some((line) => /Validação/.test(line)));

const contextFrameJob = model.buildJobProgressPresentation({
  status: 'running',
  phase: 'persona_plan',
  checkpoints: {
    route_context_frame: {
      data: {
        dominantSource: 'conversation_brief',
        allowedSources: ['current_message', 'conversation_brief'],
        activeMemory: {
          available: true,
          allowedForBriefing: false,
          suppressed: true,
          suppressionReason: 'request_references_conversation_brief_not_memory_store',
        },
        guard: { ok: true, blocking: false, reason: '' },
      },
    },
  },
  events: [
    {
      type: 'job.context_frame',
      createdAt: '2026-05-23T11:59:58.000Z',
      payload: {
        dominantSource: 'conversation_brief',
        activeMemorySuppressed: true,
      },
    },
  ],
});
assert.match(contextFrameJob.detailText, /Contexto dominante: briefing da conversa/);
assert.match(contextFrameJob.detailText, /Memória ativa: suprimida/);
assert.match(contextFrameJob.detailText, /Contexto dominante - briefing da conversa/);

const deterministicPatchJob = model.buildJobProgressPresentation({
  status: 'running',
  phase: 'awaiting_user_confirmation',
  checkpoints: {
    deterministic_patch: {
      data: {
        reason: 'deterministic_patch_ready',
        files: ['app/page.tsx'],
        safePatchEvidence: {
          schemaVersion: 'deterministic-edit-patch-evidence-v1',
          status: 'approved',
          generator: 'micro_color_literal_replace_patch',
          operationsCount: 1,
          classification: {
            supported: true,
            kind: 'literal_color_replacement_micro_patch',
            reason: 'Pedido contém troca literal de cor.',
          },
          validation: {
            ok: true,
            score: 100,
            minScore: 72,
            summary: 'Patch determinístico liberado com 1 operação.',
          },
          microContract: {
            schemaVersion: 'micro-edit-color-replacement-v1',
            type: 'literal_color_replacement',
          },
          changedFiles: [{ path: 'app/page.tsx', delta: 2, changedSpanRatio: 0.02 }],
        },
      },
    },
  },
  events: [
    {
      type: 'job.deterministic_patch_evidence',
      createdAt: '2026-05-23T11:59:58.000Z',
      payload: {
        status: 'approved',
        kind: 'literal_color_replacement_micro_patch',
        validationOk: true,
        score: 100,
        minScore: 72,
        operationsCount: 1,
        changedFilesCount: 1,
        microContractType: 'literal_color_replacement',
      },
    },
  ],
});
assert.match(deterministicPatchJob.detailText, /Patch determinístico: aprovado/);
assert.match(deterministicPatchJob.detailText, /contrato: literal_color_replacement_micro_patch/);
assert.match(deterministicPatchJob.detailText, /Validação do patch: Patch determinístico liberado/);
assert.match(deterministicPatchJob.detailText, /Microcontrato: literal_color_replacement/);
assert.match(deterministicPatchJob.detailText, /Patch determinístico - status aprovado/);

const retry = model.buildJobProgressPresentation(
  {
    status: 'retry_pending',
    phase: 'persona_plan',
    retryState: { nextRetryAt: new Date(baseTime + 4200).toISOString() },
    events: [],
  },
  { now: baseTime }
);
assert.strictEqual(retry.tone, 'warning');
assert.strictEqual(retry.busy, true);
assert.match(retry.statusText, /próxima tentativa em 5s/);
assert.strictEqual(retry.transientStatus, 'Aguardando janela de retentativa.');

const failed = model.buildJobProgressPresentation({
  status: 'failed',
  phase: 'failed',
  lastError: 'cortex_validation_score: mínimo não atingido',
  events: [{ type: 'job.failed', payload: { reason: 'execute_error:stacktrace' } }],
});
assert.strictEqual(failed.tone, 'danger');
assert.strictEqual(failed.busy, false);
assert.match(failed.detailText, /Motivo técnico/);
assert.match(failed.detailText, /stacktrace/);

const executeFailedTerminal = model.buildJobProgressPresentation({
  status: 'failed',
  phase: 'execute_failed',
  progress: { pct: 100 },
  lastError: 'Sem alterações de arquivos requeridas ao finalizar.',
  attemptsByPhase: { execute_pending: 2 },
  checkpoints: {
    last_plan: {
      data: {
        responsePreview: 'Entendi. Vou trabalhar nisso agora e te volto com resultado real.',
      },
    },
  },
  events: [
    {
      type: 'job.phase_changed',
      payload: { phase: 'execute_failed', progressPct: 100 },
    },
    {
      type: 'job.failed',
      payload: { reason: 'Sem alterações de arquivos requeridas ao finalizar.' },
    },
  ],
});
assert.strictEqual(executeFailedTerminal.statusText, '100%');
assert.strictEqual(executeFailedTerminal.phaseLabel, 'Falha na execução');
assert.strictEqual(
  executeFailedTerminal.phaseSteps.some((step) => step.label === 'execute_failed'),
  false
);
assert.strictEqual(executeFailedTerminal.finalSummaryLines.length, 1);
assert.match(executeFailedTerminal.finalSummaryLines[0], /Sem alterações de arquivos requeridas/i);
assert.doesNotMatch(
  executeFailedTerminal.finalSummaryLines.join('\n'),
  /Entendi\. Vou trabalhar|Próxima ação|Motivo técnico/i
);

const cancelledTerminal = model.buildJobProgressPresentation({
  status: 'cancelled',
  phase: 'cancelled',
  progress: { pct: 100 },
  events: [{ type: 'job.cancelled', payload: { reason: 'cancelled_by_user' } }],
});
assert.strictEqual(cancelledTerminal.statusText, '100%');
const cancelledEvidenceCopy = cancelledTerminal.finalDetailLines.join('\n');
assert.match(cancelledEvidenceCopy, /Execução cancelada/i);
assert.doesNotMatch(
  cancelledEvidenceCopy,
  /job\.cancelled|cancelled_by_user/i
);

const cancellingRun = model.buildJobProgressPresentation({
  status: 'running',
  phase: 'cancelling',
  progress: { pct: 77 },
  events: [{ type: 'job.cancellation_requested', payload: { reason: 'cancelled_by_user' } }],
});
assert.strictEqual(cancellingRun.title, 'Encerrando execução');
assert.strictEqual(cancellingRun.phaseLabel, 'Encerrando execução');
assert.strictEqual(cancellingRun.statusLabel, 'Parando');
assert.strictEqual(cancellingRun.busy, true);
assert.strictEqual(cancellingRun.tone, 'warning');

const cortexValidationFailed = model.buildJobProgressPresentation({
  status: 'failed',
  phase: 'cortex_validation_retry_exhausted',
  lastError: 'cortex_validation_score:81',
  checkpoints: {
    last_plan: {
      data: {
        responsePreview:
          'O Cortex concluiu os passes, mas a validação técnica final não liberou a aplicação. O job ficou preservado para reparo orientado pelo checkpoint.',
      },
    },
    cortex_runtime: {
      data: {
        workGraph: {
          validationResults: [
            {
              score: 81,
              minScore: 90,
              checks: {
                operations: true,
                files: true,
                operationContentValidity: false,
                artifactCss: false,
                artifactMinimum: false,
              },
              invalidOperationContents: [
                { path: 'app/page.tsx', reason: 'missing_code_tokens' },
                { path: 'package.json', reason: 'invalid_json' },
              ],
              artifactQuality: {
                score: 58,
                minScore: 70,
                passesMinimum: false,
              },
            },
          ],
        },
      },
    },
  },
  events: [{ type: 'job.failed', payload: { reason: 'cortex_validation_score:81' } }],
});
assert.match(cortexValidationFailed.detailText, /Parei esta rodada: Validação Cortex bloqueou a execução: score 81%/);
assert.match(cortexValidationFailed.detailText, /Validação técnica: 81% \/ mínimo 90%/);
assert.match(cortexValidationFailed.detailText, /Conteúdo inválido detectado em: app\/page\.tsx, package\.json/);
assert.match(cortexValidationFailed.detailText, /Qualidade\/aderência do artefato: 58% \/ mínimo 70%/);
assert.doesNotMatch(cortexValidationFailed.detailText, /Motivo técnico: 81\b/);

const completed = model.buildJobProgressPresentation({
  status: 'completed',
  phase: 'done',
  events: [{ type: 'job.completed' }],
});
assert.strictEqual(completed.tone, 'success');
assert.strictEqual(completed.busy, false);
assert.strictEqual(completed.progressPct, 100);
assert.strictEqual(completed.statusText, '100%');
assert.strictEqual(completed.finalSummaryLines.some((line) => /Resultado:|Caminho:/.test(line)), false);
assert.ok(Array.isArray(completed.finalDetailLines));

const completedWithRetry = model.buildJobProgressPresentation({
  status: 'completed',
  phase: 'done',
  attemptsByPhase: { execute_pending: 2 },
  events: [{ type: 'job.completed' }],
});
assert.strictEqual(
  completedWithRetry.finalSummaryLines.some((line) => /Resultado:|Caminho:|Retentativas:|tentativas/i.test(line)),
  false
);

const executePendingWithoutProcesses = model.buildJobProgressPresentation({
  status: 'running',
  phase: 'execute_pending',
  events: [],
});
assert.match(executePendingWithoutProcesses.detailText, /Harness está executando a ação autorizada/i);
assert.doesNotMatch(executePendingWithoutProcesses.detailText, /lint|testes|build|preview/i);

const executeValidationWithoutProcesses = model.buildJobProgressPresentation({
  status: 'running',
  phase: 'execute_validation',
  events: [],
});
assert.match(executeValidationWithoutProcesses.detailText, /Harness está validando os recibos da execução/i);
assert.doesNotMatch(executeValidationWithoutProcesses.detailText, /lint|testes|build|preview/i);

const completedWithProcessValidationPending = model.buildJobProgressPresentation({
  status: 'completed',
  phase: 'done',
  checkpoints: {
    execute_result: {
      data: {
        validationPending: true,
        validationPendingReason: 'portable_sandbox_required',
      },
    },
  },
  events: [{
    type: 'job.completed',
    payload: {
      validationPending: true,
      validationPendingReason: 'portable_sandbox_required',
    },
  }],
});
assert.match(
  completedWithProcessValidationPending.detailText,
  /validação técnica solicitada permanece pendente/i
);
assert.doesNotMatch(completedWithProcessValidationPending.detailText, /lint|testes|build|preview/i);
assert.doesNotMatch(completedWithProcessValidationPending.detailText, /validação real passou/i);
assert.ok(
  completedWithProcessValidationPending.finalSummaryLines.some((line) => /validações.*pendentes/i.test(line))
);
assert.match(
  completedWithProcessValidationPending.transientStatus,
  /validação técnica solicitada permanece pendente/i
);
assert.doesNotMatch(completedWithProcessValidationPending.transientStatus, /lint|testes|build|preview/i);
assert.strictEqual(completedWithProcessValidationPending.tone, 'warning');
assert.strictEqual(
  completedWithProcessValidationPending.title,
  'Alterações aplicadas; validação pendente'
);
assert.strictEqual(
  completedWithProcessValidationPending.statusLabel,
  'Validação pendente'
);

const completedWithNamedPendingValidation = model.buildJobProgressPresentation({
  status: 'completed',
  phase: 'done',
  checkpoints: {
    execute_result: {
      data: {
        validationPending: true,
        validationPendingChecks: ['tests'],
      },
    },
  },
  events: [{
    type: 'job.completed',
    payload: {
      validationPending: true,
      validationPendingChecks: ['tests'],
    },
  }],
});
assert.match(completedWithNamedPendingValidation.detailText, /testes permanecem pendentes/i);
assert.match(completedWithNamedPendingValidation.transientStatus, /testes permanecem pendentes/i);
assert.doesNotMatch(completedWithNamedPendingValidation.detailText, /lint|build|preview/i);

const blockedByMissingEvidence = model.buildJobProgressPresentation({
  status: 'blocked',
  phase: 'execute_blocked',
  lastError: 'O processo governado solicitado não estava disponível.',
  checkpoints: {
    agentic_terminal_evidence: {
      data: {
        version: 'agentic-terminal-evidence.v1',
        outcome: 'blocked',
        grounded: false,
      },
    },
  },
  events: [{ type: 'job.blocked', payload: { phase: 'execute_blocked' } }],
});
assert.strictEqual(blockedByMissingEvidence.tone, 'warning');
assert.strictEqual(blockedByMissingEvidence.title, 'Execução bloqueada');
assert.strictEqual(blockedByMissingEvidence.statusLabel, 'Bloqueado');
assert.strictEqual(blockedByMissingEvidence.busy, false);
assert.match(blockedByMissingEvidence.transientStatus, /não foi possível comprovar/i);

const groundedProcessFailure = model.buildJobProgressPresentation({
  status: 'failed',
  phase: 'execute_failed',
  progress: { pct: 100 },
  lastError: 'agentic_execute_failed',
  checkpoints: {
    agentic_terminal_evidence: {
      data: {
        version: 'agentic-terminal-evidence.v1',
        outcome: 'failed',
        grounded: true,
        failed: {
          process: ['tests', 'build'],
          tools: ['run_command'],
        },
      },
    },
    execute_result: {
      data: {
        ok: false,
        validationVerified: false,
        validationPending: false,
        validationPendingReason: null,
        validationPendingChecks: [],
      },
    },
  },
  events: [{
    type: 'job.failed',
    payload: { reason: 'agentic_execute_failed', phase: 'execute_failed' },
  }],
});
const groundedFailureCopy = [
  groundedProcessFailure.transientStatus,
  groundedProcessFailure.detailText,
  ...groundedProcessFailure.finalSummaryLines,
].join('\n');
assert.strictEqual(groundedProcessFailure.tone, 'danger');
assert.strictEqual(groundedProcessFailure.title, 'Não consegui concluir essa execução');
assert.strictEqual(groundedProcessFailure.statusLabel, 'Falha');
assert.match(groundedProcessFailure.detailText, /Verificações com falha comprovada: testes e build\./i);
assert.match(
  groundedProcessFailure.finalSummaryLines.join('\n'),
  /Verificações com falha comprovada: testes e build\./i
);
assert.match(groundedFailureCopy, /Verificações com falha comprovada: testes e build\./i);
assert.doesNotMatch(
  groundedFailureCopy,
  /\bpendente(?:s)?\b|permanecem pendentes|validação pendente/i
);
assert.doesNotMatch(
  groundedFailureCopy,
  /validação real passou|processamento concluído com sucesso/i
);

const completedWithCheckpointOnlyPending = model.buildJobProgressPresentation({
  status: 'completed',
  phase: 'done',
  checkpoints: {
    execute_result: {
      data: {
        processValidation: { status: 'pending', reason: 'portable_sandbox_required' },
      },
    },
  },
  events: [{ type: 'job.completed', payload: {} }],
});
assert.doesNotMatch(completedWithCheckpointOnlyPending.detailText, /validação real passou/i);
assert.match(completedWithCheckpointOnlyPending.transientStatus, /validação técnica solicitada permanece pendente/i);
assert.doesNotMatch(completedWithCheckpointOnlyPending.transientStatus, /lint|testes|build|preview/i);

const completedWithoutExecution = model.buildJobProgressPresentation({
  status: 'completed',
  phase: 'done',
  events: [{ type: 'job.completed', payload: { reason: 'conversation_only', noFileChanges: true } }],
});
assert.strictEqual(completedWithoutExecution.title, 'Resposta concluída');
assert.strictEqual(completedWithoutExecution.statusLabel, 'Sem execução');
assert.strictEqual(completedWithoutExecution.tone, 'info');
assert.strictEqual(completedWithoutExecution.transientStatus, 'Resposta concluída sem alterar arquivos.');
assert.strictEqual(
  completedWithoutExecution.finalSummaryLines.some((line) => /Resultado:|Caminho:/.test(line)),
  false
);
assert.ok(
  completedWithoutExecution.detailText.includes('Concluí esta rodada como resposta contextual, sem alterar arquivos.')
);

console.log('renderer-ux-state-model.test.js: ok');
