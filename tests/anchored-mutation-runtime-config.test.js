'use strict';

const assert = require('assert');

const {
  ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
  createAnchoredMutationRuntimeConfig,
} = require('../main/runtime/anchored_mutation_runtime_config');

function ownKeys(value) {
  return Reflect.ownKeys(value);
}

async function main() {
  const defaultConfig = createAnchoredMutationRuntimeConfig({ env: {} });
  assert.deepStrictEqual(defaultConfig, {
    version: ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
    mode: 'disabled',
    killSwitch: true,
  });
  assert.deepStrictEqual(ownKeys(defaultConfig), ['version', 'mode', 'killSwitch']);
  assert.strictEqual(Object.isFrozen(defaultConfig), true);

  assert.deepStrictEqual(
    createAnchoredMutationRuntimeConfig({
      env: {
        FABER_ANCHORED_MUTATION_MODE: ' ENABLED ',
        FABER_ANCHORED_MUTATION_KILL_SWITCH: ' off ',
      },
    }),
    {
      version: ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
      mode: 'enabled',
      killSwitch: false,
    }
  );

  const previousHostMode = process.env.FABER_ANCHORED_MUTATION_MODE;
  const previousHostKillSwitch = process.env.FABER_ANCHORED_MUTATION_KILL_SWITCH;
  try {
    process.env.FABER_ANCHORED_MUTATION_MODE = 'enabled';
    process.env.FABER_ANCHORED_MUTATION_KILL_SWITCH = 'off';
    assert.deepStrictEqual(createAnchoredMutationRuntimeConfig(), {
      version: ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
      mode: 'enabled',
      killSwitch: false,
    });
  } finally {
    if (previousHostMode === undefined) delete process.env.FABER_ANCHORED_MUTATION_MODE;
    else process.env.FABER_ANCHORED_MUTATION_MODE = previousHostMode;
    if (previousHostKillSwitch === undefined) {
      delete process.env.FABER_ANCHORED_MUTATION_KILL_SWITCH;
    } else {
      process.env.FABER_ANCHORED_MUTATION_KILL_SWITCH = previousHostKillSwitch;
    }
  }

  assert.deepStrictEqual(
    createAnchoredMutationRuntimeConfig({
      env: {
        FABER_ANCHORED_MUTATION_MODE: 'disabled',
        FABER_ANCHORED_MUTATION_KILL_SWITCH: false,
      },
    }),
    {
      version: ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
      mode: 'disabled',
      killSwitch: false,
    }
  );

  for (const trueValue of [true, '1', 'true', 'yes', 'on']) {
    const config = createAnchoredMutationRuntimeConfig({
      env: {
        FABER_ANCHORED_MUTATION_MODE: 'enabled',
        FABER_ANCHORED_MUTATION_KILL_SWITCH: trueValue,
      },
    });
    assert.strictEqual(config.mode, 'enabled');
    assert.strictEqual(config.killSwitch, true);
  }

  for (const falseValue of [false, '0', 'false', 'no', 'off']) {
    const config = createAnchoredMutationRuntimeConfig({
      env: {
        FABER_ANCHORED_MUTATION_MODE: 'enabled',
        FABER_ANCHORED_MUTATION_KILL_SWITCH: falseValue,
      },
    });
    assert.strictEqual(config.mode, 'enabled');
    assert.strictEqual(config.killSwitch, false);
  }

  for (const env of [
    { FABER_ANCHORED_MUTATION_MODE: 'experimental', FABER_ANCHORED_MUTATION_KILL_SWITCH: 'off' },
    { FABER_ANCHORED_MUTATION_MODE: 'enabled' },
    { FABER_ANCHORED_MUTATION_MODE: 'enabled', FABER_ANCHORED_MUTATION_KILL_SWITCH: 'perhaps' },
  ]) {
    assert.deepStrictEqual(createAnchoredMutationRuntimeConfig({ env }), {
      version: ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
      mode: env.FABER_ANCHORED_MUTATION_MODE === 'enabled' ? 'enabled' : 'disabled',
      killSwitch: true,
    });
  }

  const ignoredAddonPath = createAnchoredMutationRuntimeConfig({
    env: {
      FABER_ANCHORED_MUTATION_MODE: 'enabled',
      FABER_ANCHORED_MUTATION_KILL_SWITCH: 'off',
      FABER_ANCHORED_MUTATION_PROVIDER_PATH: '/tmp/untrusted-provider.node',
      FABER_ANCHORED_MUTATION_ADDON_PATH: '/tmp/untrusted-addon.node',
    },
  });
  assert.deepStrictEqual(ignoredAddonPath, {
    version: ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
    mode: 'enabled',
    killSwitch: false,
  });
  assert.strictEqual(JSON.stringify(ignoredAddonPath).includes('/tmp/'), false);

  // Options are exact data. An extra loader/path option invalidates the whole
  // request instead of creating an ambient native-code loading surface.
  assert.deepStrictEqual(
    createAnchoredMutationRuntimeConfig({ env: {}, addonPath: '/tmp/provider.node' }),
    defaultConfig
  );

  let getterCalls = 0;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'env', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return {
        FABER_ANCHORED_MUTATION_MODE: 'enabled',
        FABER_ANCHORED_MUTATION_KILL_SWITCH: 'off',
      };
    },
  });
  assert.deepStrictEqual(createAnchoredMutationRuntimeConfig(accessorOptions), defaultConfig);
  assert.strictEqual(getterCalls, 0);

  let thenGetterCalls = 0;
  const hostileEnv = {
    FABER_ANCHORED_MUTATION_MODE: 'enabled',
    FABER_ANCHORED_MUTATION_KILL_SWITCH: 'off',
  };
  Object.defineProperty(hostileEnv, 'then', {
    enumerable: true,
    get() {
      thenGetterCalls += 1;
      throw new Error('then getter must not run');
    },
  });
  assert.deepStrictEqual(createAnchoredMutationRuntimeConfig({ env: hostileEnv }), defaultConfig);
  assert.strictEqual(thenGetterCalls, 0);

  let coercionCalls = 0;
  const hostileKillSwitch = Object.freeze({
    toString() {
      coercionCalls += 1;
      throw new Error('environment values must not be coerced');
    },
  });
  assert.deepStrictEqual(createAnchoredMutationRuntimeConfig({ env: {
    FABER_ANCHORED_MUTATION_MODE: 'enabled',
    FABER_ANCHORED_MUTATION_KILL_SWITCH: hostileKillSwitch,
  } }), {
    version: ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
    mode: 'enabled',
    killSwitch: true,
  });
  assert.strictEqual(coercionCalls, 0);

  const rejected = Promise.reject(new Error('async config denied'));
  assert.deepStrictEqual(createAnchoredMutationRuntimeConfig(rejected), defaultConfig);
  assert.deepStrictEqual(
    createAnchoredMutationRuntimeConfig({ env: {
      FABER_ANCHORED_MUTATION_MODE: rejected,
      FABER_ANCHORED_MUTATION_KILL_SWITCH: 'off',
    } }),
    defaultConfig
  );
  await new Promise((resolve) => setImmediate(resolve));

  const throwingProxy = new Proxy({}, {
    ownKeys() { throw new Error('not inspectable'); },
  });
  assert.deepStrictEqual(createAnchoredMutationRuntimeConfig(throwingProxy), defaultConfig);
  assert.deepStrictEqual(createAnchoredMutationRuntimeConfig(new Proxy({
    env: {
      FABER_ANCHORED_MUTATION_MODE: 'enabled',
      FABER_ANCHORED_MUTATION_KILL_SWITCH: 'off',
    },
  }, {})), defaultConfig);
  assert.deepStrictEqual(createAnchoredMutationRuntimeConfig({ env: new Proxy({
    FABER_ANCHORED_MUTATION_MODE: 'enabled',
    FABER_ANCHORED_MUTATION_KILL_SWITCH: 'off',
  }, {}) }), defaultConfig);

  console.log('anchored mutation runtime config tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
