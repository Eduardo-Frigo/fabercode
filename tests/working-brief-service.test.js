const assert = require('assert');

const { buildWorkingBrief } = require('../cortex/orchestration/working_brief_service');

function createProjectInfo(overrides = {}) {
  return {
    rootPath: '/tmp/faber-working-brief',
    files: [],
    totalFiles: 0,
    ...overrides,
  };
}

function run() {
  const legal = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Quero criar um site em next.js, com react e tailwind.',
      'O site é para um advogado, quero ele com cor azul e branco.',
      'Use uma tipografia do Google e placeholders.',
    ].join(' '),
  });

  assert.strictEqual(legal.schemaVersion, 'working-brief-v1');
  assert.strictEqual(legal.intent.action, 'create_project');
  assert.strictEqual(legal.product.domain, 'legal');
  assert.strictEqual(legal.product.stack, 'next-tailwind');
  assert.strictEqual(legal.style.palette.primary, '#3240a8');
  assert.strictEqual(legal.style.palette.background, '#ffffff');
  assert.strictEqual(legal.style.typography.provider, 'google');
  assert.strictEqual(legal.mediaIntent[0].provider, 'pexels');
  assert.strictEqual(legal.mediaIntent[0].orientation, 'landscape');
  assert.strictEqual(legal.mediaIntent[0].color, '#3240a8');
  assert.ok(legal.mediaIntent[0].query.includes('law office'));
  assert.ok(legal.iconIntent.some((icon) => icon.semanticName === 'scale'));

  const leatherGoods = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Quero uma landing page em next.js para uma empresa que vende artefatos de couro, como bolsas e pastas.',
      'A marca usa vermelho marsala e um offwhite quase amarelo alaranjado.',
      'O visual deve parecer europeu, artesanal e falar sobre qualidade e longevidade do couro.',
    ].join(' '),
  });
  assert.strictEqual(leatherGoods.intent.action, 'create_project');
  assert.strictEqual(leatherGoods.product.domain, 'leather-goods');
  assert.strictEqual(leatherGoods.product.domainLabel, 'artefatos de couro');
  assert.strictEqual(leatherGoods.product.brandFallback, 'Atelier Couro Faber');
  assert.strictEqual(leatherGoods.style.palette.primary, '#8f3447');
  assert.strictEqual(leatherGoods.style.palette.background, '#fcf7e3');
  assert.ok(leatherGoods.mediaIntent[0].query.includes('leather bags'));
  assert.ok(leatherGoods.iconIntent.some((icon) => icon.semanticName === 'briefcase'));

  const greenhouses = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Criar landing page em Next.js para estufas agrícolas, viveiros e cultivo protegido.',
      'Quero hero video full width, verde profundo, off-white, formulário de orçamento e WhatsApp.',
    ].join(' '),
  });
  assert.strictEqual(greenhouses.intent.action, 'create_project');
  assert.strictEqual(greenhouses.product.domain, 'greenhouses');
  assert.strictEqual(greenhouses.product.domainLabel, 'estufas agrícolas');
  assert.strictEqual(greenhouses.product.brandFallback, 'Estufas Protegidas');
  assert.strictEqual(greenhouses.style.palette.primary, '#1f5a3d');
  assert.strictEqual(greenhouses.style.palette.background, '#fcf7e3');
  assert.strictEqual(greenhouses.mediaIntent[0].mediaType, 'video');
  assert.ok(greenhouses.mediaIntent[0].query.includes('greenhouse farming'));
  assert.ok(greenhouses.iconIntent.some((icon) => icon.semanticName === 'leaf'));
  assert.ok(greenhouses.iconIntent.some((icon) => icon.semanticName === 'droplet'));

  const autonomous = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'faz qualquer coisa ai, pode sugerir tudo e usar placeholders',
  });

  assert.strictEqual(autonomous.intent.action, 'create_project');
  assert.strictEqual(autonomous.intent.autonomy, 'high');
  assert.strictEqual(autonomous.intent.askBeforePlanning, false);
  assert.strictEqual(autonomous.intent.contentMode, 'ai_placeholder');
  assert.strictEqual(autonomous.product.domain, 'humpback-whales');
  assert.strictEqual(autonomous.product.domainLabel, 'baleias jubarte');
  assert.strictEqual(autonomous.product.stack, 'next-tailwind');
  assert.strictEqual(autonomous.product.defaultedDomain, true);
  assert.ok(autonomous.executionPrompt.includes('baleias jubarte'));
  assert.ok(autonomous.executionPrompt.includes('Stack sugerida: next-tailwind.'));
  assert.ok(autonomous.mediaIntent[0].query.includes('humpback whale'));

  const existingProject = buildWorkingBrief({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      totalFiles: 3,
    }),
    userMessage: 'troque a cor principal para azul',
  });

  assert.strictEqual(existingProject.project.state, 'existing_project');
  assert.strictEqual(existingProject.intent.action, 'edit_project');
  assert.strictEqual(existingProject.intent.scope, 'existing_project');

  console.log('working-brief-service.test.js: ok');
}

run();
