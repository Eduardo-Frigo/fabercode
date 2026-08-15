const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app_formatters.js'), 'utf8');
const sandbox = {
  window: {},
};
sandbox.window.window = sandbox.window;

vm.runInNewContext(source, sandbox, { filename: 'app_formatters.js' });

const formatters = sandbox.window.FaberAppFormatters;
assert.ok(formatters, 'FaberAppFormatters should be registered');

assert.strictEqual(
  formatters.shouldSuppressInterimAssistantPlanMessage({
    response:
      'Cortex renderizou o pedido em 2 pass(es). A Persona preparou 28 operação(ões). Deseja aplicar esses artefatos no projeto?',
    action: { type: 'operation_batch' },
    meta: { reason: 'cortex_render_ready' },
  }),
  true
);

assert.strictEqual(
  formatters.shouldSuppressInterimAssistantPlanMessage({
    response: 'Certo. Vou mexer nisso agora e volto com resultado real.',
    action: { type: 'agentic_tool_loop' },
    meta: { reason: 'agentic_tool_loop_ready', autoExecute: true },
  }),
  false
);

const successMessage = formatters.buildExecutionOutcomeAssistantMessage(
  {
    ok: true,
    modifiedFiles: ['app/page.tsx', 'src/server/prisma.ts'],
    executionReport: { totals: { add: 12, del: 2 } },
  },
  { humanSummary: 'Reparar Forge MRP' },
  { summary: { errors: 0, warnings: 0, checkedFiles: 10 } }
);

assert.strictEqual(successMessage, 'Concluído: apliquei a alteração e validei o projeto.');
assert.doesNotMatch(successMessage, /Resumo da execução|Critérios de aceite|Arquivos alterados|Diff útil/);

const pendingValidationMessage = formatters.buildExecutionOutcomeAssistantMessage(
  {
    ok: true,
    verified: false,
    validationPending: true,
    validationPendingReason: 'portable_sandbox_required',
    modifiedFiles: ['app/page.tsx'],
  },
  {},
  {
    summary: { errors: 0, warnings: 0, checkedFiles: 1 },
    processValidation: { status: 'pending', reason: 'portable_sandbox_required' },
  }
);
assert.match(pendingValidationMessage, /apliquei a alteração/i);
assert.match(pendingValidationMessage, /não foram executados/i);
assert.match(pendingValidationMessage, /validação ficou pendente/i);
assert.doesNotMatch(pendingValidationMessage, /validei o projeto/i);

const agenticPendingValidationMessage = formatters.buildExecutionOutcomeAssistantMessage(
  {
    ok: true,
    agentic: true,
    validationPending: true,
    modifiedFiles: ['app/page.tsx'],
    message: 'Apliquei e todos os testes passaram.',
  },
  {},
  null
);
assert.match(agenticPendingValidationMessage, /não foram executados/i);
assert.doesNotMatch(agenticPendingValidationMessage, /todos os testes passaram/i);

const failedPendingValidationMessage = formatters.buildExecutionOutcomeAssistantMessage(
  {
    ok: false,
    agentic: true,
    validationPending: true,
    modifiedFiles: [],
    message: 'A execução falhou antes de concluir.',
  },
  {},
  null
);
assert.strictEqual(failedPendingValidationMessage, 'A execução falhou antes de concluir.');
assert.doesNotMatch(failedPendingValidationMessage, /^Concluído/i);

const blockedPendingValidationMessage = formatters.buildExecutionOutcomeAssistantMessage(
  {
    ok: true,
    validationPending: true,
    blockedByPostExecutionValidation: true,
    modifiedFiles: [],
  },
  {},
  {
    summary: { errors: 1, warnings: 0, checkedFiles: 1 },
    processValidation: { status: 'pending', reason: 'portable_sandbox_required' },
  }
);
assert.match(blockedPendingValidationMessage, /Parei antes de concluir/i);
assert.doesNotMatch(blockedPendingValidationMessage, /^Concluído/i);

const blockedMessage = formatters.buildExecutionOutcomeAssistantMessage(
  {
    ok: false,
    blockedByPostExecutionValidation: true,
    modifiedFiles: [],
    message: 'Verificação encontrou etapas obrigatórias pendentes ou com falha.',
  },
  {},
  { summary: { errors: 1, warnings: 0, checkedFiles: 3 } }
);

assert.strictEqual(blockedMessage, 'Parei antes de concluir: a validação real encontrou um problema e o projeto foi preservado.');

const agenticMessage = formatters.buildExecutionOutcomeAssistantMessage(
  {
    ok: true,
    agentic: true,
    modifiedFiles: ['app/page.tsx'],
    message: 'Consertei o fluxo do chat e já deixei a execução automática ligada.',
  },
  {},
  null
);

assert.strictEqual(agenticMessage, 'Consertei o fluxo do chat e já deixei a execução automática ligada.');

console.log('renderer-app-formatters.test.js: ok');
