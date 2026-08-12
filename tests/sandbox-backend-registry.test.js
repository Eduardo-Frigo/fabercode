'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  SANDBOX_BACKEND_SCHEMA_VERSION,
  SANDBOX_BACKEND_SECURITY_MODEL,
  SANDBOX_BACKEND_STATES,
  SANDBOX_FEATURES,
  SandboxUnavailableError,
  createSandboxProbeResult,
} = require('../main/capabilities/sandbox_backend_contract');
const {
  SANDBOX_SELECTION_SCHEMA_VERSION,
  createSandboxBackendRegistry,
} = require('../main/capabilities/sandbox_backend_registry');

const ALL_FEATURES = Object.values(SANDBOX_FEATURES);

function createBackend({ id, platform, state = SANDBOX_BACKEND_STATES.ENFORCED, features = ALL_FEATURES }) {
  return Object.freeze({
    schemaVersion: SANDBOX_BACKEND_SCHEMA_VERSION,
    securityModel: SANDBOX_BACKEND_SECURITY_MODEL,
    id,
    async probe(context) {
      if (context.runtime.platform !== platform) {
        return createSandboxProbeResult({
          state: SANDBOX_BACKEND_STATES.UNAVAILABLE,
          reason: `${id} is not supported by this runtime.`,
        });
      }
      return createSandboxProbeResult({
        state,
        features,
        reason: state === SANDBOX_BACKEND_STATES.DEGRADED ? `${id} is degraded.` : null,
      });
    },
    async execute(request) {
      return { ok: true, backendId: id, request };
    },
    async terminate() {
      return { ok: true };
    },
  });
}

async function run() {
  const darwin = createBackend({ id: 'seatbelt', platform: 'darwin' });
  const linux = createBackend({ id: 'landlock', platform: 'linux' });
  const win32 = createBackend({ id: 'app-container', platform: 'win32' });
  const backends = [darwin, linux, win32];
  const registry = createSandboxBackendRegistry({ backends, runtime: { platform: 'darwin' } });

  assert.deepStrictEqual(registry.list().map(({ id }) => id), [
    'seatbelt',
    'landlock',
    'app-container',
  ]);

  for (const [platform, expectedBackend] of [
    ['darwin', 'seatbelt'],
    ['linux', 'landlock'],
    ['win32', 'app-container'],
  ]) {
    const platformRegistry = createSandboxBackendRegistry({ backends, runtime: { platform } });
    const selection = await platformRegistry.select({
      requiredFeatures: [
        SANDBOX_FEATURES.FILESYSTEM_SCOPE,
        SANDBOX_FEATURES.PROCESS_EXECUTE,
      ],
    });
    assert.strictEqual(selection.schemaVersion, SANDBOX_SELECTION_SCHEMA_VERSION);
    assert.strictEqual(selection.matched, true);
    assert.strictEqual(selection.backend.id, expectedBackend);
    assert.strictEqual(selection.probe.state, SANDBOX_BACKEND_STATES.ENFORCED);
  }

  let brokerProbeContext = null;
  const brokerContextBackend = Object.freeze({
    schemaVersion: SANDBOX_BACKEND_SCHEMA_VERSION,
    securityModel: SANDBOX_BACKEND_SECURITY_MODEL,
    id: 'broker-context-probe',
    async probe(context) {
      brokerProbeContext = context;
      return createSandboxProbeResult({
        state: SANDBOX_BACKEND_STATES.ENFORCED,
        features: ALL_FEATURES,
      });
    },
    async execute(request) { return { ok: true, request }; },
    async terminate() { return { ok: true }; },
  });
  const brokerContextRegistry = createSandboxBackendRegistry({
    backends: [brokerContextBackend],
    runtime: { platform: 'darwin', sandboxExecutable: '/usr/bin/sandbox-exec' },
  });
  await brokerContextRegistry.select({
    requiredFeatures: [SANDBOX_FEATURES.PROCESS_EXECUTE],
    projectSession: { sessionId: 'session-1', realRootPath: '/project' },
    execution: { requestId: 'request-1', capability: 'terminal', action: 'run' },
  });
  assert.strictEqual(brokerProbeContext.runtime.platform, 'darwin');
  assert.strictEqual(brokerProbeContext.projectSession.sessionId, 'session-1');
  assert.strictEqual(brokerProbeContext.execution.requestId, 'request-1');
  assert.strictEqual(Object.isFrozen(brokerProbeContext.runtime), true);

  const missingFeature = createBackend({
    id: 'linux-no-network-isolation',
    platform: 'linux',
    features: [SANDBOX_FEATURES.FILESYSTEM_SCOPE, SANDBOX_FEATURES.PROCESS_EXECUTE],
  });
  const capable = createBackend({ id: 'portable-capable', platform: 'linux' });
  const capabilityRegistry = createSandboxBackendRegistry({
    backends: [missingFeature, capable],
    runtime: { platform: 'linux' },
  });
  const capabilitySelection = await capabilityRegistry.select({
    requiredFeatures: [SANDBOX_FEATURES.NETWORK_ISOLATION],
  });
  assert.strictEqual(capabilitySelection.backend.id, 'portable-capable');
  assert.strictEqual(capabilitySelection.attempts[0].featureMatch, false);

  const degradedBackend = createBackend({
    id: 'degraded-linux',
    platform: 'linux',
    state: SANDBOX_BACKEND_STATES.DEGRADED,
  });
  const degradedRegistry = createSandboxBackendRegistry({
    backends: [degradedBackend],
    runtime: { platform: 'linux' },
  });
  const failClosedSelection = await degradedRegistry.select({
    requiredFeatures: [SANDBOX_FEATURES.PROCESS_EXECUTE],
  });
  assert.strictEqual(failClosedSelection.matched, false);
  assert.strictEqual(failClosedSelection.backend.id, 'unsupported');
  await assert.rejects(
    failClosedSelection.backend.execute({}),
    (error) => error instanceof SandboxUnavailableError
  );

  const absentRegistry = createSandboxBackendRegistry({ runtime: { platform: 'freebsd' } });
  const absentSelection = await absentRegistry.select({
    requiredFeatures: [SANDBOX_FEATURES.PROCESS_EXECUTE],
  });
  assert.strictEqual(absentSelection.matched, false);
  assert.strictEqual(absentSelection.probe.state, SANDBOX_BACKEND_STATES.UNAVAILABLE);
  await assert.rejects(absentSelection.backend.execute({}), /sandbox backend/i);

  const invalidProbeBackend = Object.freeze({
    schemaVersion: SANDBOX_BACKEND_SCHEMA_VERSION,
    securityModel: SANDBOX_BACKEND_SECURITY_MODEL,
    id: 'invalid-probe',
    async probe() { return { state: 'enforced', features: ALL_FEATURES }; },
    async execute() { throw new Error('must not execute'); },
    async terminate() { return { ok: false }; },
  });
  const invalidProbeRegistry = createSandboxBackendRegistry({
    backends: [invalidProbeBackend],
    runtime: { platform: 'darwin' },
  });
  const invalidProbeSelection = await invalidProbeRegistry.select({
    requiredFeatures: [],
  });
  assert.strictEqual(invalidProbeSelection.matched, false);
  assert.match(invalidProbeSelection.attempts[0].reason, /probe result/);

  assert.throws(() => createSandboxBackendRegistry({ backends: [darwin, darwin] }), /Duplicate/);
  await assert.rejects(
    registry.select({ requiredFeatures: ['unknown'] }),
    /required sandbox feature/
  );
  await assert.rejects(
    registry.select({ runtime: { platform: 'win32' }, requiredFeatures: [] }),
    /injected by the registry/
  );

  const registrySource = fs.readFileSync(
    path.join(__dirname, '..', 'main', 'capabilities', 'sandbox_backend_registry.js'),
    'utf8'
  );
  assert.strictEqual(registrySource.includes('process.platform'), false);
  assert.strictEqual(registrySource.includes("require('child_process')"), false);
  assert.strictEqual(/\bspawn\s*\(/.test(registrySource), false);

  console.log('sandbox backend registry tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
