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

  const defaultDomain = inferBriefingContract({
    userMessage: 'Criar site institucional sobre baleias jubarte e conservação do oceano',
  });
  assert.strictEqual(defaultDomain.domain, 'humpback-whales');
  assert.strictEqual(defaultDomain.domainLabel, 'baleias jubarte');
  assert.strictEqual(defaultDomain.brandFallback, 'Jubarte Azul');

  const leatherGoods = inferBriefingContract({
    userMessage: 'Criar landing em Next.js para vender bolsas, pastas e artefatos de couro artesanal',
  });
  assert.strictEqual(leatherGoods.domain, 'leather-goods');
  assert.strictEqual(leatherGoods.domainLabel, 'artefatos de couro');
  assert.strictEqual(leatherGoods.brandFallback, 'Atelier Couro Faber');

  const greenhouse = inferBriefingContract({
    userMessage: [
      'Criar landing page em Next.js para venda de estufas agrícolas, viveiros e cultivo protegido.',
      'Usar React e Tailwind.',
      'Preciso de hero em vídeo, verde profundo, orçamento e modelos de estufas.',
    ].join(' '),
    contextText: 'conversa antiga sobre dentista, Clínica Sorriso e clareamento',
  });
  assert.strictEqual(greenhouse.domain, 'greenhouses');
  assert.strictEqual(greenhouse.domainLabel, 'estufas agrícolas');
  assert.strictEqual(greenhouse.stack, 'next-tailwind');
  assert.strictEqual(greenhouse.brandFallback, 'Estufas Protegidas');

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

  const leatherOk = evaluateBriefingAdherence({
    contract: leatherGoods,
    text: 'Atelier de couro com bolsas, pastas, produção artesanal e acabamento feito à mão.',
  });
  assert.strictEqual(leatherOk.passesMinimum, true);

  const greenhouseConflict = evaluateBriefingAdherence({
    contract: greenhouse,
    text: 'Clínica Sorriso com consultório odontológico e imagem de modern real estate interior.',
  });
  assert.strictEqual(greenhouseConflict.passesMinimum, false);
  assert.strictEqual(greenhouseConflict.severity, 'critical');
  assert.ok(greenhouseConflict.negativeHits.includes('clinica sorriso'));

  const greenhouseOk = evaluateBriefingAdherence({
    contract: greenhouse,
    text: 'Estufas agrícolas para cultivo protegido, viveiros, irrigação e produtores rurais.',
  });
  assert.strictEqual(greenhouseOk.passesMinimum, true);

  const guidance = formatBriefingContractForPrompt(directLegal);
  assert.ok(guidance.includes('next-tailwind'));
  assert.ok(guidance.includes('advocacia'));
  assert.ok(formatBriefingContractForPrompt(greenhouse).includes('estufas agrícolas'));

  console.log('briefing-contract-service.test.js: ok');
}

run();
