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
assert.ok(completed.finalSummaryLines.some((line) => /Resultado: execução concluída/.test(line)));
assert.ok(Array.isArray(completed.finalDetailLines));

const completedWithoutExecution = model.buildJobProgressPresentation({
  status: 'completed',
  phase: 'done',
  events: [{ type: 'job.completed', payload: { reason: 'conversation_only', noFileChanges: true } }],
});
assert.strictEqual(completedWithoutExecution.title, 'Resposta concluída');
assert.strictEqual(completedWithoutExecution.statusLabel, 'Sem execução');
assert.strictEqual(completedWithoutExecution.tone, 'info');
assert.strictEqual(completedWithoutExecution.transientStatus, 'Resposta concluída sem alterar arquivos.');
assert.ok(
  completedWithoutExecution.finalSummaryLines.some((line) => /Resultado: análise concluída sem execução/.test(line))
);
assert.ok(
  completedWithoutExecution.detailText.includes('Concluí esta rodada como resposta contextual, sem alterar arquivos.')
);

console.log('renderer-ux-state-model.test.js: ok');
