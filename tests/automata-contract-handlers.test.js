const assert = require('assert');

const { registerAutomataContractHandlers } = require('../main/ipc/automata_contract_handlers');

function createLedgerStub() {
  const calls = [];
  return {
    calls,
    listEntries: (payload) => {
      calls.push({ method: 'listEntries', payload });
      return { ok: true, entries: [] };
    },
    summarizeLedger: (payload) => {
      calls.push({ method: 'summarizeLedger', payload });
      return { ok: true, total: 0, actionable: 0 };
    },
    suggestContract: (contract, options) => {
      calls.push({ method: 'suggestContract', contract, options });
      return {
        ok: true,
        entry: {
          id: 'ledger-1',
          contractId: 'suggested.test',
          projectId: options.project.projectId,
        },
      };
    },
    stageContract: (id, payload) => {
      calls.push({ method: 'stageContract', id, payload });
      return { ok: true, entry: { id, contractId: 'suggested.test', projectId: 'project-1', status: 'staged' } };
    },
    markTrialRunning: (id, payload) => {
      calls.push({ method: 'markTrialRunning', id, payload });
      return { ok: true, entry: { id, contractId: 'suggested.test', status: 'trial_running' } };
    },
    markTrialResult: (id, payload) => {
      calls.push({ method: 'markTrialResult', id, payload });
      return { ok: true, entry: { id, contractId: 'suggested.test', status: payload.passed ? 'trial_passed' : 'trial_failed' } };
    },
    promoteContract: (id, payload) => {
      calls.push({ method: 'promoteContract', id, payload });
      return { ok: true, entry: { id, contractId: 'suggested.test', projectId: 'project-1', status: 'local_active' } };
    },
    rejectContract: (id, payload) => {
      calls.push({ method: 'rejectContract', id, payload });
      return { ok: true, entry: { id, contractId: 'suggested.test', projectId: 'project-1', status: 'rejected' } };
    },
  };
}

async function run() {
  const handlers = {};
  const audits = [];
  const ledgerService = createLedgerStub();

  registerAutomataContractHandlers({
    appendAuditEvent: (type, payload) => audits.push({ type, payload }),
    ledgerService,
    normalizeAuthorizedProjectInfo: (projectInfo) => ({
      ok: true,
      projectInfo: {
        id: projectInfo.id,
        rootPath: projectInfo.rootPath,
      },
    }),
    registerIpcHandler: (channel, handler) => {
      handlers[channel] = handler;
    },
  });

  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'automata:contracts:list',
    'automata:contracts:promote',
    'automata:contracts:reject',
    'automata:contracts:stage',
    'automata:contracts:suggest',
    'automata:contracts:summary',
    'automata:contracts:trial',
  ]);

  await handlers['automata:contracts:list'](null, {
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    status: 'staged',
  });
  assert.deepStrictEqual(ledgerService.calls.pop(), {
    method: 'listEntries',
    payload: {
      projectId: 'project-1',
      rootPath: '/tmp/project',
      status: 'staged',
      includeRejected: undefined,
    },
  });

  const suggested = await handlers['automata:contracts:suggest'](null, {
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    contract: { title: 'Contrato novo' },
  });
  assert.strictEqual(suggested.ok, true);
  assert.strictEqual(audits[audits.length - 1].type, 'automata_contract.suggested');
  assert.strictEqual(ledgerService.calls.pop().method, 'suggestContract');

  await handlers['automata:contracts:stage'](null, { id: 'ledger-1', note: 'ok' });
  assert.strictEqual(audits[audits.length - 1].type, 'automata_contract.staged');

  await handlers['automata:contracts:trial'](null, { id: 'ledger-1', running: true });
  assert.strictEqual(ledgerService.calls.pop().method, 'markTrialRunning');

  await handlers['automata:contracts:trial'](null, { id: 'ledger-1', passed: true });
  assert.strictEqual(ledgerService.calls.pop().method, 'markTrialResult');

  await handlers['automata:contracts:promote'](null, { id: 'ledger-1' });
  assert.strictEqual(audits[audits.length - 1].type, 'automata_contract.promoted');

  await handlers['automata:contracts:reject'](null, { id: 'ledger-1' });
  assert.strictEqual(audits[audits.length - 1].type, 'automata_contract.rejected');

  console.log('automata-contract-handlers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
