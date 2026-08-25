'use strict';

const assert = require('assert');

const {
  CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS,
  CODEX_APP_SERVER_RUNTIME_CONFIG_VERSION,
  createCodexAppServerRuntimeConfig,
} = require('../main/runtime/codex_app_server_runtime_config');

const READY_CONFIG = Object.freeze({
  version: CODEX_APP_SERVER_RUNTIME_CONFIG_VERSION,
  requested: true,
  enabled: true,
  commandPath: '/opt/faber/bin/codex',
  reason: CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.READY,
});

async function main() {
  assert.deepStrictEqual(createCodexAppServerRuntimeConfig({ env: {} }), {
    version: CODEX_APP_SERVER_RUNTIME_CONFIG_VERSION,
    requested: false,
    enabled: false,
    commandPath: null,
    reason: CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.DEFAULT_DISABLED,
  });
  assert.deepStrictEqual(createCodexAppServerRuntimeConfig({
    env: {
      FABER_APP_SERVER_ADAPTER: ' ON ',
      FABER_CODEX_COMMAND: '/opt/faber/bin/codex',
    },
  }), READY_CONFIG);

  for (const enabled of [true, '1', 'true', 'yes', 'on']) {
    assert.deepStrictEqual(createCodexAppServerRuntimeConfig({
      env: {
        FABER_APP_SERVER_ADAPTER: enabled,
        FABER_CODEX_COMMAND: '/opt/faber/bin/codex',
      },
    }), READY_CONFIG);
  }
  for (const disabled of [false, '0', 'false', 'no', 'off', '']) {
    const config = createCodexAppServerRuntimeConfig({
      env: {
        FABER_APP_SERVER_ADAPTER: disabled,
        FABER_CODEX_COMMAND: '/private/path/must-not-leak',
      },
    });
    assert.strictEqual(config.requested, false);
    assert.strictEqual(config.enabled, false);
    assert.strictEqual(config.commandPath, null);
    assert.strictEqual(
      config.reason,
      CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.EXPLICIT_DISABLED
    );
    assert.strictEqual(JSON.stringify(config).includes('private/path'), false);
  }

  for (const commandPath of [
    undefined,
    '',
    'codex',
    '/',
    `/opt/faber/co\0dex`,
  ]) {
    const env = { FABER_APP_SERVER_ADAPTER: 'true' };
    if (commandPath !== undefined) env.FABER_CODEX_COMMAND = commandPath;
    const config = createCodexAppServerRuntimeConfig({ env });
    assert.strictEqual(config.requested, true);
    assert.strictEqual(config.enabled, false);
    assert.strictEqual(config.commandPath, null);
    assert.strictEqual(
      config.reason,
      CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.COMMAND_UNAVAILABLE
    );
  }

  assert.deepStrictEqual(createCodexAppServerRuntimeConfig({
    env: {
      FABER_APP_SERVER_ADAPTER: 'perhaps',
      FABER_CODEX_COMMAND: '/opt/faber/bin/codex',
    },
  }), {
    version: CODEX_APP_SERVER_RUNTIME_CONFIG_VERSION,
    requested: false,
    enabled: false,
    commandPath: null,
    reason: CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.INVALID_FLAG,
  });

  const ready = createCodexAppServerRuntimeConfig({
    env: {
      FABER_APP_SERVER_ADAPTER: 'true',
      FABER_CODEX_COMMAND: '/opt/faber/bin/codex',
    },
  });
  assert.strictEqual(Object.isFrozen(ready), true);
  assert.strictEqual(Object.isFrozen(CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS), true);
  assert.deepStrictEqual(Reflect.ownKeys(ready), [
    'version',
    'requested',
    'enabled',
    'commandPath',
    'reason',
  ]);

  let optionGetterCalls = 0;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'env', {
    enumerable: true,
    get() {
      optionGetterCalls += 1;
      throw new Error('must not execute');
    },
  });
  assert.strictEqual(
    createCodexAppServerRuntimeConfig(accessorOptions).enabled,
    false
  );
  assert.strictEqual(optionGetterCalls, 0);

  let envGetterCalls = 0;
  const accessorEnv = {};
  Object.defineProperty(accessorEnv, 'FABER_APP_SERVER_ADAPTER', {
    enumerable: true,
    get() {
      envGetterCalls += 1;
      throw new Error('must not execute');
    },
  });
  assert.strictEqual(
    createCodexAppServerRuntimeConfig({ env: accessorEnv }).enabled,
    false
  );
  assert.strictEqual(envGetterCalls, 0);

  let proxyTraps = 0;
  const hostile = new Proxy({}, {
    get() {
      proxyTraps += 1;
      throw new Error('must not execute');
    },
    ownKeys() {
      proxyTraps += 1;
      throw new Error('must not execute');
    },
  });
  assert.strictEqual(createCodexAppServerRuntimeConfig(hostile).enabled, false);
  assert.strictEqual(
    createCodexAppServerRuntimeConfig({ env: hostile }).enabled,
    false
  );
  assert.strictEqual(proxyTraps, 0);

  const rejected = Promise.reject(new Error('async config denied'));
  assert.strictEqual(createCodexAppServerRuntimeConfig(rejected).enabled, false);
  assert.strictEqual(createCodexAppServerRuntimeConfig({ env: rejected }).enabled, false);
  await new Promise((resolve) => setImmediate(resolve));
  console.log('codex-app-server-runtime-config.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
