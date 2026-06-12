const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CORE_GROUP,
  SUGGEST_BLUEPRINT_GROUP,
  buildCoreAutomataContracts,
  createAutomataContractRegistryService,
  sanitizeSuggestedContract,
} = require('../cortex/orchestration/automata_contract_registry_service');

function run() {
  const core = buildCoreAutomataContracts();
  assert.strictEqual(core.length, 25);
  assert.strictEqual(new Set(core.map((contract) => contract.id)).size, 25);
  assert.strictEqual(core.every((contract) => contract.group === CORE_GROUP), true);
  assert.strictEqual(core.every((contract) => contract.approval === 'approved'), true);
  assert.strictEqual(core.find((contract) => contract.id === 'automata.literal_color_replacement').status, 'active');
  assert.strictEqual(core.find((contract) => contract.id === 'automata.exploratory_conversation').status, 'active');
  assert.strictEqual(core.find((contract) => contract.id === 'automata.semantic_color_edit').status, 'planned');

  const sanitized = sanitizeSuggestedContract(
    {
      title: 'Trocar cards por tabela',
      capability: 'edit_project',
      observedMessage: 'em vez desses cards, quero uma tabela',
      triggerExamples: ['troque os cards por tabela'],
      proposedContract: { target: 'repeated_cards', replacement: 'table' },
      code: 'fs.writeFileSync("x", "y")',
      commands: ['rm -rf .'],
    },
    { provider: 'openai', now: () => '2026-05-20T12:00:00.000Z' }
  );
  assert.strictEqual(sanitized.group, SUGGEST_BLUEPRINT_GROUP);
  assert.strictEqual(sanitized.status, 'suggested_blueprint');
  assert.strictEqual(sanitized.safety.dataOnly, true);
  assert.strictEqual(sanitized.safety.executable, false);
  assert.strictEqual(sanitized.safety.canRunCommands, false);
  assert.deepStrictEqual(sanitized.blockedFields, ['code', 'commands']);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(sanitized, 'code'), false);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-automata-contracts-'));
  try {
    const service = createAutomataContractRegistryService({
      fs,
      path,
      storageRoot: tempRoot,
      now: () => '2026-05-20T12:00:00.000Z',
    });
    assert.deepStrictEqual(service.summarizeRegistry(), {
      schemaVersion: 'automata-contract-registry-v1',
      name: 'Automata Contracts',
      total: 25,
      core: 25,
      active: 2,
      planned: 23,
      suggested: 0,
      capabilities: [
        'edit_project',
        'create_or_edit_project',
        'create_project',
        'conversation',
        'tool_action',
        'diagnose_project',
      ],
    });

    const suggestion = service.suggestContract({
      title: 'Transformar cards em tabela',
      capability: 'edit_project',
      observedMessage: 'quero trocar estes cards por uma tabela comparativa',
      proposedContract: {
        target: 'card_grid',
        output: 'comparison_table',
      },
      resolverPath: '../dangerous.js',
    });
    assert.strictEqual(suggestion.ok, true);
    assert.strictEqual(suggestion.contract.group, SUGGEST_BLUEPRINT_GROUP);
    assert.deepStrictEqual(suggestion.contract.blockedFields, ['resolverPath']);

    const loaded = service.loadSuggestedContracts();
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].id, 'suggested.transformar_cards_em_tabela');
    assert.strictEqual(loaded[0].safety.executable, false);

    const registry = service.listContracts();
    assert.strictEqual(registry.length, 26);
    assert.strictEqual(service.getContractById('automata.footer').name, 'Footer Contract');
    assert.strictEqual(service.getContractById('suggested.transformar_cards_em_tabela').status, 'suggested_blueprint');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('automata-contract-registry-service.test.js: ok');
}

run();
