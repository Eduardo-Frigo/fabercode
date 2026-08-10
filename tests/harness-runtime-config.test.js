'use strict';

const assert = require('assert');

const {
  HARNESS_RUNTIME_CONFIG_VERSION,
  HARNESS_RUNTIME_MODES,
  createHarnessRuntimeConfig,
} = require('../main/agent_runtime/harness_runtime_config');

assert.deepStrictEqual(HARNESS_RUNTIME_MODES, ['legacy', 'shadow', 'canary', 'on']);

const defaultConfig = createHarnessRuntimeConfig({ env: {} });
assert.deepStrictEqual(defaultConfig, {
  schemaVersion: HARNESS_RUNTIME_CONFIG_VERSION,
  requestedMode: 'legacy',
  configuredMode: 'legacy',
  killSwitch: false,
  configuredPrimaryKernel: 'legacy',
  configuredShadowKernel: null,
  diagnostics: {
    source: 'default',
    requestedValue: null,
    requestedMode: 'legacy',
    configuredMode: 'legacy',
    killSwitch: false,
    fallbackReason: 'default',
    warnings: [],
  },
});
assert.strictEqual(Object.isFrozen(defaultConfig), true);
assert.strictEqual(Object.isFrozen(defaultConfig.diagnostics), true);
assert.strictEqual(Object.isFrozen(defaultConfig.diagnostics.warnings), true);

const shadowConfig = createHarnessRuntimeConfig({
  env: { FABER_HARNESS_V2_MODE: ' SHADOW ' },
});
assert.strictEqual(shadowConfig.requestedMode, 'shadow');
assert.strictEqual(shadowConfig.configuredMode, 'shadow');
assert.strictEqual(shadowConfig.configuredPrimaryKernel, 'legacy');
assert.strictEqual(shadowConfig.configuredShadowKernel, 'v2');
assert.strictEqual(shadowConfig.diagnostics.source, 'env');
assert.strictEqual(shadowConfig.diagnostics.fallbackReason, null);

for (const mode of ['canary', 'on']) {
  const config = createHarnessRuntimeConfig({ env: { FABER_HARNESS_V2_MODE: mode } });
  assert.strictEqual(config.configuredMode, mode);
  assert.strictEqual(config.configuredPrimaryKernel, 'v2');
  assert.strictEqual(config.configuredShadowKernel, null);
}

const killedConfig = createHarnessRuntimeConfig({
  env: {
    FABER_HARNESS_V2_MODE: 'on',
    FABER_HARNESS_V2_KILL_SWITCH: 'true',
    OPENAI_API_KEY: 'must-not-appear-in-diagnostics',
  },
});
assert.strictEqual(killedConfig.requestedMode, 'on');
assert.strictEqual(killedConfig.configuredMode, 'legacy');
assert.strictEqual(killedConfig.killSwitch, true);
assert.strictEqual(killedConfig.configuredPrimaryKernel, 'legacy');
assert.strictEqual(killedConfig.configuredShadowKernel, null);
assert.strictEqual(killedConfig.diagnostics.fallbackReason, 'kill_switch');
assert.strictEqual(JSON.stringify(killedConfig).includes('must-not-appear-in-diagnostics'), false);

const invalidMode = createHarnessRuntimeConfig({
  env: { FABER_HARNESS_V2_MODE: 'experimental' },
});
assert.strictEqual(invalidMode.requestedMode, 'legacy');
assert.strictEqual(invalidMode.configuredMode, 'legacy');
assert.strictEqual(invalidMode.diagnostics.fallbackReason, 'invalid_mode');
assert.strictEqual(invalidMode.diagnostics.requestedValue, null);
assert.strictEqual(JSON.stringify(invalidMode).includes('experimental'), false);
assert.strictEqual(invalidMode.diagnostics.warnings.length, 1);

const invalidKillSwitch = createHarnessRuntimeConfig({
  env: {
    FABER_HARNESS_V2_MODE: 'on',
    FABER_HARNESS_V2_KILL_SWITCH: 'probably',
  },
});
assert.strictEqual(invalidKillSwitch.killSwitch, true);
assert.strictEqual(invalidKillSwitch.configuredMode, 'legacy');
assert.strictEqual(invalidKillSwitch.diagnostics.warnings.length, 1);

for (const falseValue of ['0', 'false', 'no', 'off', '']) {
  const config = createHarnessRuntimeConfig({
    env: {
      FABER_HARNESS_V2_MODE: 'shadow',
      FABER_HARNESS_V2_KILL_SWITCH: falseValue,
    },
  });
  assert.strictEqual(config.killSwitch, false);
  assert.strictEqual(config.configuredMode, 'shadow');
}

console.log('harness runtime config tests passed');
