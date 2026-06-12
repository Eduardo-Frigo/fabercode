const assert = require('assert');

const {
  HEROICONS_SOURCE_URL,
  buildBlueprintIconSet,
  getIconDefinition,
  renderInlineSvgIcon,
  resolveBlueprintIconNames,
} = require('../cortex/orchestration/blueprint_icon_registry');

function run() {
  assert.strictEqual(HEROICONS_SOURCE_URL, 'https://heroicons.com/');
  assert.deepStrictEqual(resolveBlueprintIconNames({ contract: { domain: 'legal' } }), [
    'scale',
    'documentText',
    'shieldCheck',
  ]);
  assert.deepStrictEqual(resolveBlueprintIconNames({ contract: { domain: 'real-estate' } }), [
    'homeModern',
    'mapPin',
    'buildingOffice',
  ]);
  assert.deepStrictEqual(resolveBlueprintIconNames({ contract: { domain: 'humpback-whales' } }), [
    'waves',
    'compass',
    'globeAlt',
  ]);
  assert.deepStrictEqual(resolveBlueprintIconNames({ contract: { domain: 'leather-goods' } }), [
    'briefcase',
    'sparkles',
    'shieldCheck',
  ]);
  assert.deepStrictEqual(resolveBlueprintIconNames({ contract: { domain: 'chocolate' } }), [
    'sparkles',
    'gift',
    'heartPulse',
  ]);
  assert.deepStrictEqual(resolveBlueprintIconNames({ contract: { domain: 'aquarium' } }), [
    'waves',
    'mapPin',
    'compass',
  ]);
  assert.deepStrictEqual(resolveBlueprintIconNames({ contract: { domain: 'greenhouses' } }), [
    'leaf',
    'shieldCheck',
    'droplet',
  ]);

  const legalIcons = buildBlueprintIconSet({ contract: { domain: 'legal' } });
  assert.strictEqual(legalIcons.length, 3);
  assert.strictEqual(legalIcons[0].name, 'scale');
  assert.ok(legalIcons[0].path.includes('M12'));
  assert.strictEqual(getIconDefinition('missing').label, 'Sparkles');

  const svg = renderInlineSvgIcon('scale');
  assert.ok(svg.includes('class="service-icon"'));
  assert.ok(svg.includes('viewBox="0 0 24 24"'));
  assert.ok(svg.includes('<path d="'));

  console.log('blueprint-icon-registry.test.js: ok');
}

run();
