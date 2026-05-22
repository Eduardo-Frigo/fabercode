const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  LEDGER_STATUSES,
  createAutomataContractLedgerService,
} = require('../cortex/orchestration/automata_contract_ledger_service');

function createClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-05-20T12:00:${String(tick).padStart(2, '0')}.000Z`;
  };
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-automata-ledger-'));
  try {
    const service = createAutomataContractLedgerService({
      fs,
      path,
      storageRoot: tempRoot,
      now: createClock(),
    });

    const suggestion = service.suggestContract(
      {
        title: 'Trocar cards por carrossel',
        capability: 'edit_project',
        observedMessage: 'transforma esses cards em um carrossel',
        reason: 'O pedido exige uma regra local nova para converter uma grade em carrossel.',
        proposedContract: {
          intent: 'replace_component_pattern',
          from: 'card_grid',
          to: 'carousel',
        },
        commands: ['npm install swiper'],
      },
      {
        project: {
          projectId: 'project-1',
          rootPath: '/tmp/project',
        },
      }
    );

    assert.strictEqual(suggestion.ok, true);
    assert.strictEqual(suggestion.entry.status, LEDGER_STATUSES.SUGGEST_BLUEPRINT);
    assert.strictEqual(suggestion.entry.projectId, 'project-1');
    assert.strictEqual(suggestion.entry.contract.safety.dataOnly, true);
    assert.strictEqual(suggestion.entry.contract.safety.canRunCommands, false);
    assert.deepStrictEqual(suggestion.entry.contract.blockedFields, ['commands']);

    const duplicateSuggestion = service.suggestContract(
      {
        title: 'Trocar cards por carrossel',
        capability: 'edit_project',
        observedMessage: 'transforma esses cards em um carrossel',
        reason: 'O pedido exige uma regra local nova para converter uma grade em carrossel.',
        proposedContract: {
          intent: 'replace_component_pattern',
          from: 'card_grid',
          to: 'carousel',
        },
      },
      {
        project: {
          projectId: 'project-1',
          rootPath: '/tmp/project',
        },
      }
    );
    assert.strictEqual(duplicateSuggestion.ok, true);
    assert.strictEqual(duplicateSuggestion.deduped, true);
    assert.strictEqual(duplicateSuggestion.entry.id, suggestion.entry.id);
    assert.strictEqual(service.listEntries({ includeRejected: true }).entries.length, 1);

    const legacyLedger = service.readLedger();
    legacyLedger.entries = [
      {
        ...legacyLedger.entries[0],
        id: 'legacy-duplicate-entry',
        updatedAt: '2026-05-20T11:59:00.000Z',
      },
      ...legacyLedger.entries,
    ];
    service.writeLedger(legacyLedger);
    assert.strictEqual(service.readLedger().entries.length, 2);
    assert.strictEqual(service.listEntries({ includeRejected: true }).entries.length, 1);

    const invalid = service.promoteContract(suggestion.entry.id);
    assert.strictEqual(invalid.ok, false);
    assert.strictEqual(invalid.reason, 'invalid_status_transition');
    assert.strictEqual(invalid.from, LEDGER_STATUSES.SUGGEST_BLUEPRINT);
    assert.strictEqual(invalid.to, LEDGER_STATUSES.LOCAL_ACTIVE);

    const staged = service.stageContract(suggestion.entry.id, { note: 'usuario aprovou teste' });
    assert.strictEqual(staged.ok, true);
    assert.strictEqual(staged.entry.status, LEDGER_STATUSES.STAGED);
    assert.strictEqual(staged.entry.events[0].type, 'contract.committed_to_stage');

    const running = service.markTrialRunning(staged.entry.id);
    assert.strictEqual(running.ok, true);
    assert.strictEqual(running.entry.status, LEDGER_STATUSES.TRIAL_RUNNING);
    assert.ok(running.entry.trial.startedAt);

    const passed = service.markTrialResult(running.entry.id, {
      passed: true,
      note: 'funcionou no smoke test',
    });
    assert.strictEqual(passed.ok, true);
    assert.strictEqual(passed.entry.status, LEDGER_STATUSES.TRIAL_PASSED);
    assert.strictEqual(passed.entry.trial.passed, true);

    const promoted = service.promoteContract(passed.entry.id);
    assert.strictEqual(promoted.ok, true);
    assert.strictEqual(promoted.entry.status, LEDGER_STATUSES.LOCAL_ACTIVE);
    assert.strictEqual(promoted.entry.events[0].type, 'contract.promoted_local_active');

    const entries = service.listEntries({ projectId: 'project-1' });
    assert.strictEqual(entries.ok, true);
    assert.strictEqual(entries.entries.length, 1);
    assert.strictEqual(entries.entries[0].status, LEDGER_STATUSES.LOCAL_ACTIVE);

    const rootOnlySuggestion = service.suggestContract(
      {
        title: 'Contrato com identidade parcial',
        capability: 'create_project',
        observedMessage: 'gerar blueprint local',
      },
      {
        project: {
          projectId: '',
          rootPath: '/tmp/project-root-only',
        },
      }
    );
    const rootOnlyStaged = service.stageContract(rootOnlySuggestion.entry.id);
    assert.strictEqual(rootOnlyStaged.ok, true);
    const rootFallbackEntries = service.listEntries({
      projectId: 'project-id-from-ui',
      rootPath: '/tmp/project-root-only',
      includeRejected: false,
    });
    assert.strictEqual(rootFallbackEntries.entries.length, 1);
    assert.strictEqual(rootFallbackEntries.entries[0].status, LEDGER_STATUSES.STAGED);

    const summary = service.summarizeLedger();
    assert.strictEqual(summary.ok, true);
    assert.strictEqual(summary.name, 'Automata Contract Ledger');
    assert.strictEqual(summary.total, 2);
    assert.strictEqual(summary.counts[LEDGER_STATUSES.LOCAL_ACTIVE], 1);
    assert.strictEqual(summary.counts[LEDGER_STATUSES.STAGED], 1);
    assert.strictEqual(summary.actionable, 1);

    const second = service.suggestContract({
      title: 'Contrato recusado',
      capability: 'edit_project',
      observedMessage: 'pedido experimental',
    });
    const rejected = service.rejectContract(second.entry.id);
    assert.strictEqual(rejected.ok, true);
    assert.strictEqual(rejected.entry.status, LEDGER_STATUSES.REJECTED);
    assert.strictEqual(service.listEntries({ includeRejected: false }).entries.length, 2);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('automata-contract-ledger-service.test.js: ok');
}

run();
