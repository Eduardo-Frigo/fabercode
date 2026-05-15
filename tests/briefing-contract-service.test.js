const assert = require('assert');

const {
  evaluateBriefingAdherence,
  formatBriefingContractForPrompt,
  inferBriefingContract,
} = require('../cortex/orchestration/briefing_contract_service');

function run() {
  const directLegal = inferBriefingContract({
    userMessage: 'Criar site em Next.js, React e Tailwind para um advogado trabalhista',
    contextText: 'conversa antiga sobre dentista e Clínica Sorriso',
  });
  assert.strictEqual(directLegal.domain, 'legal');
  assert.strictEqual(directLegal.stack, 'next-tailwind');
  assert.strictEqual(directLegal.brandFallback, 'Escritório Faber Advocacia');

  const contextualLamp = inferBriefingContract({
    userMessage: 'faz com placeholders',
    contextText: 'Pedido consolidado: criar site institucional em LAMP para veterinário',
  });
  assert.strictEqual(contextualLamp.domain, 'veterinary');
  assert.strictEqual(contextualLamp.stack, 'lamp');

  const conflict = evaluateBriefingAdherence({
    contract: directLegal,
    text: 'Clínica Sorriso oferece clareamento, implante e consulta odontológica.',
  });
  assert.strictEqual(conflict.enabled, true);
  assert.strictEqual(conflict.passesMinimum, false);
  assert.strictEqual(conflict.severity, 'critical');
  assert.ok(conflict.negativeHits.includes('clinica sorriso'));

  const legalOk = evaluateBriefingAdherence({
    contract: directLegal,
    text: 'Escritório de advocacia com consultoria jurídica, contratos e direito trabalhista.',
  });
  assert.strictEqual(legalOk.passesMinimum, true);

  const guidance = formatBriefingContractForPrompt(directLegal);
  assert.ok(guidance.includes('next-tailwind'));
  assert.ok(guidance.includes('advocacia'));

  console.log('briefing-contract-service.test.js: ok');
}

run();
