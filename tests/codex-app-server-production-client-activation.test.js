'use strict';

const assert = require('assert');

const {
  CODEX_APP_SERVER_PINNED_CLI_VERSION,
  CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
} = require('../main/agent_runtime/codex_app_server_shadow_protocol');
const {
  createHarnessRuntimeConfig,
} = require('../main/agent_runtime/harness_runtime_config');
const {
  CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS,
  CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES,
  CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_VERSION,
  CODEX_APP_SERVER_PRODUCTION_CLIENT_SELECTION_SCHEMA_VERSION,
  createCodexAppServerProductionClientActivation,
} = require('../main/services/codex_app_server_production_client_activation');
const {
  createCodexAppServerRuntimeConfig,
} = require('../main/runtime/codex_app_server_runtime_config');

function runtimeConfig(mode = 'shadow') {
  return createHarnessRuntimeConfig({
    env: mode === 'legacy' ? {} : { FABER_HARNESS_V2_MODE: mode },
  });
}

function adapterConfig({ enabled = true } = {}) {
  return createCodexAppServerRuntimeConfig({
    env: enabled ? {
      FABER_APP_SERVER_ADAPTER: 'true',
      FABER_CODEX_COMMAND: '/opt/faber/bin/codex',
    } : {},
  });
}

function createClientFactory({
  startFailure = null,
  startReceipt = null,
  statusAfterStart = 'ready',
  isolationComplete = true,
  closeReceipt = null,
} = {}) {
  const calls = {
    close: 0,
    factory: 0,
    isolationProfile: 0,
    options: null,
    start: 0,
    status: 0,
  };
  let state = 'idle';
  const client = Object.freeze({
    close() {
      calls.close += 1;
      state = 'closed';
      return Promise.resolve(closeReceipt || Object.freeze({
        ok: true,
        closed: true,
        processTerminated: true,
        forced: false,
        exited: true,
      }));
    },
    isolationProfile() {
      calls.isolationProfile += 1;
      return Object.freeze({
        version: CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
        complete: isolationComplete,
        disabledMcpServerNames: Object.freeze([]),
      });
    },
    request() {
      return Promise.reject(new Error('unused test request'));
    },
    start() {
      calls.start += 1;
      if (startFailure) return Promise.reject(startFailure);
      state = statusAfterStart;
      return Promise.resolve(startReceipt || Object.freeze({
        ok: true,
        clientVersion: '0.1.3',
        codexCliVersion: CODEX_APP_SERVER_PINNED_CLI_VERSION,
        initializeResult: Object.freeze({ agent: 'test' }),
      }));
    },
    status() {
      calls.status += 1;
      return Object.freeze({
        state,
        verifiedCliVersion: state === 'ready'
          ? CODEX_APP_SERVER_PINNED_CLI_VERSION : null,
      });
    },
    subscribe() {
      return Object.freeze(() => {});
    },
  });
  function factory(options) {
    calls.factory += 1;
    calls.options = options;
    return client;
  }
  return { calls, client, factory };
}

function createActivation({
  mode = 'shadow',
  adapterEnabled = true,
  factoryFixture = createClientFactory(),
} = {}) {
  const activation = createCodexAppServerProductionClientActivation({
    runtimeConfig: runtimeConfig(mode),
    adapterConfig: adapterConfig({ enabled: adapterEnabled }),
    cwd: '/var/faber/runtime',
    clientVersion: '0.1.3',
    environment: Object.freeze({ FABER_CODEX_TEST: '1' }),
    clientFactory: factoryFixture.factory,
  });
  return { activation, factoryFixture };
}

async function testReadyClientIsVerifiedBeforeSelection() {
  for (const mode of ['shadow', 'canary', 'on']) {
    const fixture = createActivation({ mode });
    assert.strictEqual(fixture.activation.version,
      CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_VERSION);
    assert.deepStrictEqual(Reflect.ownKeys(fixture.activation), [
      'version',
      'start',
      'diagnostics',
    ]);
    assert.strictEqual(Object.isFrozen(fixture.activation), true);
    const firstStart = fixture.activation.start();
    const secondStart = fixture.activation.start();
    assert.strictEqual(firstStart, secondStart);
    const selection = await firstStart;
    assert.deepStrictEqual(selection, {
      schemaVersion: CODEX_APP_SERVER_PRODUCTION_CLIENT_SELECTION_SCHEMA_VERSION,
      ready: true,
      reason: CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS.READY,
      client: fixture.factoryFixture.client,
      cleanupConfirmed: null,
    });
    assert.strictEqual(Object.isFrozen(selection), true);
    assert.strictEqual(fixture.factoryFixture.calls.factory, 1);
    assert.strictEqual(fixture.factoryFixture.calls.start, 1);
    assert.strictEqual(fixture.factoryFixture.calls.close, 0);
    assert.deepStrictEqual(fixture.factoryFixture.calls.options, {
      codexCommand: '/opt/faber/bin/codex',
      cwd: '/var/faber/runtime',
      clientVersion: '0.1.3',
      environment: { FABER_CODEX_TEST: '1' },
    });
    assert.strictEqual(Object.isFrozen(fixture.factoryFixture.calls.options), true);
    assert.strictEqual(
      Object.isFrozen(fixture.factoryFixture.calls.options.environment),
      true
    );
    assert.deepStrictEqual(fixture.activation.diagnostics(), {
      version: CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_VERSION,
      state: CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES.READY,
      reason: CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS.READY,
      configuredMode: mode,
      adapterRequested: true,
      adapterEnabled: true,
      adapterReason: 'ready',
      clientState: 'ready',
      cleanupConfirmed: null,
      pinnedCliVersion: CODEX_APP_SERVER_PINNED_CLI_VERSION,
    });
    assert.strictEqual(
      JSON.stringify(fixture.activation.diagnostics()).includes('/opt/faber'),
      false
    );
  }
}

async function testInactiveModesNeverConstructAClient() {
  for (const input of [
    { mode: 'legacy', adapterEnabled: true },
    { mode: 'shadow', adapterEnabled: false },
  ]) {
    const fixture = createActivation(input);
    const selection = await fixture.activation.start();
    assert.strictEqual(selection.ready, false);
    assert.strictEqual(selection.client, null);
    assert.strictEqual(selection.cleanupConfirmed, null);
    assert.strictEqual(fixture.factoryFixture.calls.factory, 0);
    assert.strictEqual(
      fixture.activation.diagnostics().state,
      CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES.DISABLED
    );
  }
}

async function testFailedOrIncompleteStartClosesTheClient() {
  const cases = [
    createClientFactory({ startFailure: new Error('private token and command') }),
    createClientFactory({ statusAfterStart: 'idle' }),
    createClientFactory({ isolationComplete: false }),
    createClientFactory({
      startReceipt: Object.freeze({
        ok: true,
        clientVersion: '0.1.3',
        codexCliVersion: '0.150.0',
        initializeResult: Object.freeze({}),
      }),
    }),
  ];
  for (const factoryFixture of cases) {
    const fixture = createActivation({ factoryFixture });
    const selection = await fixture.activation.start();
    assert.strictEqual(selection.ready, false);
    assert.strictEqual(selection.client, null);
    assert.strictEqual(selection.cleanupConfirmed, true);
    assert.strictEqual(factoryFixture.calls.close, 1);
    assert.strictEqual(
      fixture.activation.diagnostics().state,
      CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES.BLOCKED
    );
    assert.strictEqual(
      JSON.stringify(selection).includes('private token'),
      false
    );
  }
}

async function testInvalidAndHostilePortsFailClosed() {
  assert.throws(
    () => createCodexAppServerProductionClientActivation({}),
    /production client activation options/i
  );
  assert.throws(
    () => createCodexAppServerProductionClientActivation({
      runtimeConfig: runtimeConfig(),
      adapterConfig: adapterConfig(),
      cwd: '/var/faber/runtime',
      clientVersion: '0.1.3',
      environment: Object.freeze({}),
      async clientFactory() {
        return {};
      },
    }),
    /clientFactory|synchronous/i
  );

  let traps = 0;
  const hostileClient = new Proxy({}, {
    get() {
      traps += 1;
      throw new Error('must not execute');
    },
    ownKeys() {
      traps += 1;
      throw new Error('must not execute');
    },
  });
  const fixture = createActivation({
    factoryFixture: {
      calls: { factory: 0 },
      factory() {
        this.calls.factory += 1;
        return hostileClient;
      },
    },
  });
  const selection = await fixture.activation.start();
  assert.strictEqual(selection.ready, false);
  assert.strictEqual(selection.client, null);
  assert.strictEqual(traps, 0);
}

async function main() {
  assert.strictEqual(
    CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_VERSION,
    'codex-app-server-production-client-activation.v1'
  );
  assert.strictEqual(
    CODEX_APP_SERVER_PRODUCTION_CLIENT_SELECTION_SCHEMA_VERSION,
    'codex-app-server-production-client-selection.v1'
  );
  assert.strictEqual(Object.isFrozen(
    CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS
  ), true);
  assert.strictEqual(Object.isFrozen(
    CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES
  ), true);
  await testReadyClientIsVerifiedBeforeSelection();
  await testInactiveModesNeverConstructAClient();
  await testFailedOrIncompleteStartClosesTheClient();
  await testInvalidAndHostilePortsFailClosed();
  console.log('codex-app-server-production-client-activation.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
