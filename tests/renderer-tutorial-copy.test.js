const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'tutorial_copy.js'),
  'utf8'
);
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'tutorial_copy.js' });

const copy = sandbox.window.FaberTutorialCopy;
assert.ok(copy, 'tutorial copy module should be registered');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(copy.SUPPORTED_LOCALES)),
  ['pt-BR', 'en-US', 'es-ES']
);

function flattenShape(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenShape(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .flatMap((key) => flattenShape(value[key], prefix ? `${prefix}.${key}` : key));
  }
  return [`${prefix}:${typeof value}`];
}

const referenceShape = flattenShape(copy.COPY['pt-BR']);
for (const locale of copy.SUPPORTED_LOCALES) {
  assert.deepStrictEqual(
    flattenShape(copy.COPY[locale]),
    referenceShape,
    `${locale} tutorial copy should have the same structure as pt-BR`
  );
  assert.strictEqual(copy.normalizeLocale(locale), locale);
  assert.ok(copy.value(locale, 'documents.architecture.content').length > 200);
  assert.ok(copy.value(locale, 'documents.components.content').length > 200);
  assert.ok(copy.value(locale, 'documents.contentLinks.content').length > 200);
  assert.strictEqual(copy.value(locale, 'render.milestones').length, 3);
  assert.strictEqual(copy.value(locale, 'steps.git.checklist').length, 5);
}

assert.strictEqual(copy.normalizeLocale('en'), 'en-US');
assert.strictEqual(copy.normalizeLocale('es-MX'), 'es-ES');
assert.strictEqual(copy.normalizeLocale('unknown'), 'pt-BR');
assert.match(copy.translate('pt-BR', 'documents.personalizedWelcome.content', { name: 'Júlia' }), /Olá, Júlia/);
assert.match(copy.translate('en-US', 'documents.personalizedWelcome.content', { name: 'Júlia' }), /Hello, Júlia/);
assert.match(copy.translate('es-ES', 'documents.personalizedWelcome.content', { name: 'Júlia' }), /Hola, Júlia/);
assert.strictEqual(
  copy.translate('es-ES', 'development.fallbackCommit', { number: 2 }),
  'feat: completar etapa 2'
);

const englishTool = copy.value('en-US', 'rightTools')[0];
const spanishTool = copy.value('es-ES', 'rightTools')[0];
assert.match(
  copy.translatePhrase('en-US', `Passe o mouse sobre ${englishTool.label}: esta ferramenta ${englishTool.description}.`),
  /^Hover over Files:/
);
assert.match(
  copy.translatePhrase('es-ES', `Passe o mouse sobre ${spanishTool.label}: esta ferramenta ${spanishTool.description}.`),
  /^Pasa el cursor sobre Archivos:/
);
assert.match(
  copy.translatePhrase('en-US', 'Abra Novos Arquivos para revisar o lote "Foundation".'),
  /Open New Files/
);
assert.match(
  copy.translatePhrase('es-ES', 'Mapa pronto para desenvolvimento: saudação para Júlia, Design System, arquitetura Next.js com Tailwind, componentes, regras, conteúdo e links placeholders. Agora o tutorial abrirá a apresentação do painel direito.'),
  /saludo para Júlia/
);
assert.match(
  copy.translatePhrase('en-US', 'Agora o tutorial vai escrever "Tutorial sample API" no campo Serviço para refletir a escolha feita acima.'),
  /^The tutorial will now enter/
);
assert.match(
  copy.translatePhrase('es-ES', 'Agora o tutorial vai escrever "API de ejemplo del tutorial" no campo Serviço para refletir a escolha feita acima.'),
  /^Ahora el tutorial escribirá/
);

console.log('renderer-tutorial-copy.test.js: ok');
