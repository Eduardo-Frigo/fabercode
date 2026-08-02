const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createNode() {
  return {
    attributes: {},
    textContent: '',
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

const selectors = [
  '#btn-tab-chat',
  '#btn-tab-map',
  '.zoom-slider-container > span:first-child',
  '#btn-map-zoom-reset',
  '#workspace-collapse-left',
  '#workspace-restore-left',
  '#workspace-collapse-right',
  '#workspace-restore-right',
  '#btn-map-tool-select',
  '#btn-map-tool-hand',
  '#btn-map-tool-add-group',
  '#btn-map-tool-add-card',
  '#btn-map-tool-add-image',
  '#btn-map-tool-add-decision',
  '#btn-project-files',
  '#btn-map-ai',
  '#btn-project-git',
  '#btn-project-terminal',
  '#btn-project-milestones',
  '#btn-project-deploy',
  '#btn-project-files span',
  '#btn-map-ai span',
  '#btn-project-git span',
  '#btn-project-terminal span',
  '#btn-project-milestones span',
  '#btn-project-deploy span',
];
const nodes = new Map(selectors.map((selector) => [selector, createNode()]));
const document = {
  querySelector(selector) {
    return nodes.get(selector) || null;
  },
  querySelectorAll() {
    return [];
  },
};

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'i18n.js'), 'utf8');
const sandbox = { document, window: {} };
vm.runInNewContext(source, sandbox, { filename: 'i18n.js' });

const api = sandbox.window.FaberI18n;
assert.ok(api, 'i18n module should be registered');

const referenceKeys = Object.keys(api.UI_TRANSLATIONS['pt-BR']).sort();
for (const locale of ['en-US', 'es-ES']) {
  assert.deepStrictEqual(
    Object.keys(api.UI_TRANSLATIONS[locale]).sort(),
    referenceKeys,
    `${locale} should translate every interface key`,
  );
}

let locale = 'en-US';
const controller = api.createI18nController({ getLocale: () => locale });
controller.applyStaticTranslations();
assert.strictEqual(nodes.get('#btn-tab-map').textContent, 'Application Map');
assert.strictEqual(nodes.get('#btn-map-tool-hand').attributes.title, 'Pan map');
assert.strictEqual(nodes.get('#btn-project-files').attributes['aria-label'], 'Project files');
assert.strictEqual(nodes.get('#btn-project-deploy').attributes.title, 'Run project locally');

locale = 'es-ES';
controller.applyStaticTranslations();
assert.strictEqual(nodes.get('#btn-tab-map').textContent, 'Mapa de la aplicación');
assert.strictEqual(nodes.get('#workspace-collapse-right').attributes.title, 'Contraer panel derecho');
assert.strictEqual(nodes.get('#btn-map-tool-add-image').attributes['aria-label'], 'Subir imagen');
assert.strictEqual(nodes.get('#btn-project-milestones span').textContent, 'Hitos');

console.log('renderer-i18n.test.js: ok');
