'use strict';

const assert = require('assert');

const {
  EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
  createExecutionIsolationRuntimeConfig,
} = require('../main/runtime/execution_isolation_runtime_config');

const DEFAULT_CONFIG = Object.freeze({
  version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
  mode: 'disabled',
  killSwitch: true,
});

async function main() {
  const defaultConfig = createExecutionIsolationRuntimeConfig({ env: {} });
  assert.deepStrictEqual(defaultConfig, DEFAULT_CONFIG);
  assert.deepStrictEqual(Reflect.ownKeys(defaultConfig), ['version', 'mode', 'killSwitch']);
  assert.strictEqual(Object.isFrozen(defaultConfig), true);

  const enabledConfig = {
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode: 'enabled',
    killSwitch: false,
  };
  for (const harnessMode of ['canary', 'on']) {
    assert.deepStrictEqual(createExecutionIsolationRuntimeConfig({
      env: {
        FABER_HARNESS_V2_MODE: harnessMode,
        FABER_HARNESS_V2_KILL_SWITCH: '0',
      },
    }), enabledConfig, `${harnessMode} must arm portable isolation`);
    assert.deepStrictEqual(createExecutionIsolationRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: harnessMode },
    }), enabledConfig, `${harnessMode} must inherit the Harness kill-switch default`);
  }

  for (const harnessEnv of [
    { FABER_HARNESS_V2_MODE: 'legacy' },
    { FABER_HARNESS_V2_MODE: 'shadow' },
    {
      FABER_HARNESS_V2_MODE: 'canary',
      FABER_HARNESS_V2_KILL_SWITCH: '1',
    },
    {
      FABER_HARNESS_V2_MODE: 'canary',
      FABER_HARNESS_V2_KILL_SWITCH: 'invalid',
    },
  ]) {
    assert.deepStrictEqual(
      createExecutionIsolationRuntimeConfig({ env: harnessEnv }),
      DEFAULT_CONFIG,
      'inactive or fail-closed Harness settings must not arm portable isolation'
    );
  }

  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig({
    env: {
      FABER_HARNESS_V2_MODE: 'canary',
      FABER_HARNESS_V2_KILL_SWITCH: '0',
      FABER_EXECUTION_ISOLATION_MODE: 'disabled',
      FABER_EXECUTION_ISOLATION_KILL_SWITCH: 'off',
    },
  }), {
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode: 'disabled',
    killSwitch: false,
  }, 'explicit isolation settings must override Harness-derived activation');

  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig({
    env: {
      FABER_EXECUTION_ISOLATION_MODE: ' ENABLED ',
      FABER_EXECUTION_ISOLATION_KILL_SWITCH: ' off ',
    },
  }), {
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode: 'enabled',
    killSwitch: false,
  });

  const previousMode = process.env.FABER_EXECUTION_ISOLATION_MODE;
  const previousKillSwitch = process.env.FABER_EXECUTION_ISOLATION_KILL_SWITCH;
  try {
    process.env.FABER_EXECUTION_ISOLATION_MODE = 'enabled';
    process.env.FABER_EXECUTION_ISOLATION_KILL_SWITCH = 'off';
    assert.deepStrictEqual(createExecutionIsolationRuntimeConfig(), {
      version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
      mode: 'enabled',
      killSwitch: false,
    });
  } finally {
    if (previousMode === undefined) delete process.env.FABER_EXECUTION_ISOLATION_MODE;
    else process.env.FABER_EXECUTION_ISOLATION_MODE = previousMode;
    if (previousKillSwitch === undefined) {
      delete process.env.FABER_EXECUTION_ISOLATION_KILL_SWITCH;
    } else {
      process.env.FABER_EXECUTION_ISOLATION_KILL_SWITCH = previousKillSwitch;
    }
  }

  for (const trueValue of [true, '1', 'true', 'yes', 'on']) {
    assert.strictEqual(createExecutionIsolationRuntimeConfig({
      env: {
        FABER_EXECUTION_ISOLATION_MODE: 'enabled',
        FABER_EXECUTION_ISOLATION_KILL_SWITCH: trueValue,
      },
    }).killSwitch, true);
  }
  for (const falseValue of [false, '0', 'false', 'no', 'off']) {
    assert.strictEqual(createExecutionIsolationRuntimeConfig({
      env: {
        FABER_EXECUTION_ISOLATION_MODE: 'enabled',
        FABER_EXECUTION_ISOLATION_KILL_SWITCH: falseValue,
      },
    }).killSwitch, false);
  }

  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig({
    env: {
      FABER_EXECUTION_ISOLATION_MODE: 'experimental',
      FABER_EXECUTION_ISOLATION_KILL_SWITCH: 'off',
    },
  }), DEFAULT_CONFIG);
  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig({
    env: { FABER_EXECUTION_ISOLATION_MODE: 'enabled' },
  }), {
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode: 'enabled',
    killSwitch: true,
  });
  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig({
    env: {
      FABER_EXECUTION_ISOLATION_MODE: 'enabled',
      FABER_EXECUTION_ISOLATION_KILL_SWITCH: 'perhaps',
    },
  }), {
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode: 'enabled',
    killSwitch: true,
  });

  const ignoredPaths = createExecutionIsolationRuntimeConfig({
    env: {
      FABER_EXECUTION_ISOLATION_MODE: 'enabled',
      FABER_EXECUTION_ISOLATION_KILL_SWITCH: 'off',
      FABER_EXECUTION_ISOLATION_PROVIDER_PATH: '/tmp/untrusted-provider.node',
      FABER_EXECUTION_ISOLATION_ADDON_PATH: '/tmp/untrusted-addon.node',
    },
  });
  assert.deepStrictEqual(ignoredPaths, {
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode: 'enabled',
    killSwitch: false,
  });
  assert.strictEqual(JSON.stringify(ignoredPaths).includes('/tmp/'), false);
  assert.deepStrictEqual(
    createExecutionIsolationRuntimeConfig({ env: {}, providerPath: '/tmp/provider.node' }),
    DEFAULT_CONFIG
  );

  let getterCalls = 0;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'env', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return {};
    },
  });
  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig(accessorOptions), DEFAULT_CONFIG);
  assert.strictEqual(getterCalls, 0);

  let thenGetterCalls = 0;
  const hostileEnv = {
    FABER_EXECUTION_ISOLATION_MODE: 'enabled',
    FABER_EXECUTION_ISOLATION_KILL_SWITCH: 'off',
  };
  Object.defineProperty(hostileEnv, 'then', {
    enumerable: true,
    get() {
      thenGetterCalls += 1;
      throw new Error('then getter must not run');
    },
  });
  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig({ env: hostileEnv }), DEFAULT_CONFIG);
  assert.strictEqual(thenGetterCalls, 0);

  let coercionCalls = 0;
  const hostileKillSwitch = Object.freeze({
    toString() {
      coercionCalls += 1;
      throw new Error('must not coerce environment authority');
    },
  });
  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig({ env: {
    FABER_EXECUTION_ISOLATION_MODE: 'enabled',
    FABER_EXECUTION_ISOLATION_KILL_SWITCH: hostileKillSwitch,
  } }), {
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode: 'enabled',
    killSwitch: true,
  });
  assert.strictEqual(coercionCalls, 0);

  const rejected = Promise.reject(new Error('async configuration denied'));
  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig(rejected), DEFAULT_CONFIG);
  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig({ env: {
    FABER_EXECUTION_ISOLATION_MODE: rejected,
    FABER_EXECUTION_ISOLATION_KILL_SWITCH: 'off',
  } }), DEFAULT_CONFIG);

  const throwingProxy = new Proxy({}, { ownKeys() { throw new Error('not inspectable'); } });
  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig(throwingProxy), DEFAULT_CONFIG);
  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig(new Proxy({ env: {} }, {})), DEFAULT_CONFIG);
  assert.deepStrictEqual(createExecutionIsolationRuntimeConfig({ env: new Proxy({}, {}) }), DEFAULT_CONFIG);

  await new Promise((resolve) => setImmediate(resolve));
  console.log('execution isolation runtime config tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
