'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  assertPortableIsolationHelperHandshakeResponse,
  assertPortableIsolationHelperShutdownReceipt,
  createPortableIsolationHelperHandshakeRequest,
  createPortableIsolationHelperSessionController,
} = require('../main/capabilities/portable_isolation_helper_protocol');
const {
  PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
} = require('../main/services/execution_isolation_provider_factory');
const {
  PORTABLE_EXECUTION_WORKSPACE_BACKEND_ID,
} = require('../main/services/portable_isolation_helper_execution_workspace_backend');
const {
  PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_ID,
} = require('../main/services/portable_isolation_helper_project_root_authority_backend');
const {
  PORTABLE_PROCESS_SUPERVISOR_BACKEND_ID,
} = require('../main/services/portable_isolation_helper_process_supervisor_backend');
const {
  PORTABLE_ISOLATION_HELPER_PHYSICAL_RUNTIME_VERSION,
  PortableIsolationHelperPhysicalRuntimeError,
  createPortableIsolationHelperPhysicalRuntime,
} = require('../main/services/portable_isolation_helper_physical_runtime');

const digest = (character) => `sha256:${character.repeat(64)}`;

function runtimeBinding(overrides = {}) {
  return Object.freeze({
    helperId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-runtime-1',
    bundleIdentityDigest: digest('b'),
    platform: Object.freeze({
      os: process.platform,
      architecture: process.arch,
      signatureVerification: 'platform_verified',
    }),
    ...overrides,
  });
}

async function expectCode(action, code) {
  await assert.rejects(
    Promise.resolve().then(action),
    (error) => error instanceof PortableIsolationHelperPhysicalRuntimeError
      && error.code === code
      && error.message === code
  );
}

(async () => {
  let hostileTrapCount = 0;
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      hostileTrapCount += 1;
      throw new Error('must not run');
    },
    ownKeys() {
      hostileTrapCount += 1;
      throw new Error('must not run');
    },
  });
  assert.throws(
    () => createPortableIsolationHelperPhysicalRuntime(hostile),
    (error) => error instanceof PortableIsolationHelperPhysicalRuntimeError
      && error.code === 'PHYSICAL_RUNTIME_OPTIONS_INVALID'
  );
  assert.strictEqual(hostileTrapCount, 0);
  assert.throws(
    () => createPortableIsolationHelperPhysicalRuntime({
      runtimeBinding: runtimeBinding(),
      injectedBackend: {},
    }),
    (error) => error instanceof PortableIsolationHelperPhysicalRuntimeError
      && error.code === 'PHYSICAL_RUNTIME_OPTIONS_INVALID'
  );
  assert.throws(
    () => createPortableIsolationHelperPhysicalRuntime({
      runtimeBinding: runtimeBinding({ bundleIdentityDigest: digest('z') }),
    }),
    (error) => error instanceof PortableIsolationHelperPhysicalRuntimeError
      && error.code === 'PHYSICAL_RUNTIME_BINDING_INVALID'
  );
  assert.throws(
    () => createPortableIsolationHelperPhysicalRuntime({
      runtimeBinding: runtimeBinding({ os: 'linux' }),
    }),
    (error) => error instanceof PortableIsolationHelperPhysicalRuntimeError
      && error.code === 'PHYSICAL_RUNTIME_BINDING_INVALID'
  );

  const runtime = createPortableIsolationHelperPhysicalRuntime({
    runtimeBinding: runtimeBinding(),
  });
  assert.ok(Object.isFrozen(runtime));
  assert.deepStrictEqual(Reflect.ownKeys(runtime), [
    'version',
    'activate',
    'accept',
    'quarantine',
    'dispose',
    'diagnostics',
  ]);
  assert.strictEqual(
    runtime.version,
    PORTABLE_ISOLATION_HELPER_PHYSICAL_RUNTIME_VERSION
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_PHYSICAL_RUNTIME_VERSION,
    'portable-isolation-helper-physical-runtime.v1'
  );

  let activation;
  try {
    activation = await runtime.activate();
  } catch (error) {
    assert.ok(error instanceof PortableIsolationHelperPhysicalRuntimeError);
    assert.strictEqual(error.code, 'PHYSICAL_RUNTIME_UNAVAILABLE');
    const disposed = assertPortableIsolationHelperShutdownReceipt(
      await runtime.dispose({ reasonCode: 'APPLICATION_SHUTDOWN' })
    );
    assert.strictEqual(disposed.orphaned, 0);
    assert.strictEqual(runtime.diagnostics().state, 'closed');
    console.log('portable isolation helper physical runtime unavailable-path tests passed');
    return;
  }

  assert.ok(Object.isFrozen(activation));
  assert.deepStrictEqual(activation, {
    version: 'portable-isolation-helper-physical-runtime-activation.v1',
    active: true,
    executionWorkspaceBackendId: PORTABLE_EXECUTION_WORKSPACE_BACKEND_ID,
    projectRootAuthorityBackendId: PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_ID,
    processSupervisorBackendId: PORTABLE_PROCESS_SUPERVISOR_BACKEND_ID,
  });
  assert.strictEqual(await runtime.activate(), activation);

  const handshakeRequest = createPortableIsolationHelperHandshakeRequest({
    requestId: 'physical-runtime-handshake-1',
    clientId: 'faber-main-runtime',
    clientNonce: 'a'.repeat(64),
    expectedBundleIdentityDigest: digest('b'),
    providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
    attestationVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  });
  const handshakeResponse = await runtime.accept(handshakeRequest);
  assertPortableIsolationHelperHandshakeResponse(
    handshakeResponse,
    handshakeRequest
  );
  assert.strictEqual(
    handshakeResponse.payload.executionWorkspaceBackendId,
    PORTABLE_EXECUTION_WORKSPACE_BACKEND_ID
  );
  assert.strictEqual(
    handshakeResponse.payload.projectRootAuthorityBackendId,
    PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_ID
  );
  assert.strictEqual(
    handshakeResponse.payload.processSupervisorBackendId,
    PORTABLE_PROCESS_SUPERVISOR_BACKEND_ID
  );
  const controller = createPortableIsolationHelperSessionController({
    handshakeRequest,
    handshakeResponse,
  });
  const shutdownRequest = controller.request({
    requestId: 'physical-runtime-shutdown-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE,
    payload: { reasonCode: 'APPLICATION_SHUTDOWN' },
  });
  const shutdownResponse = await runtime.accept(shutdownRequest);
  controller.accept(shutdownResponse);
  const shutdown = assertPortableIsolationHelperShutdownReceipt(
    shutdownResponse.payload
  );
  assert.strictEqual(shutdown.activeWorkspaces, 0);
  assert.strictEqual(shutdown.activeRootLeases, 0);
  assert.strictEqual(shutdown.activeProcesses, 0);
  assert.strictEqual(shutdown.orphaned, 0);
  assert.deepStrictEqual(
    await runtime.dispose({ reasonCode: 'APPLICATION_SHUTDOWN' }),
    shutdownResponse.payload
  );
  assert.strictEqual(runtime.diagnostics().state, 'closed');

  const source = fs.readFileSync(path.join(
    __dirname,
    '../main/services/portable_isolation_helper_physical_runtime.js'
  ), 'utf8');
  assert.match(source, /createPortableExecutionWorkspaceBackend/);
  assert.match(source, /createPortableProjectRootAuthorityBackend/);
  assert.match(source, /createPortableProcessSupervisorBackend/);
  assert.match(source, /createPortableIsolationHelperBackendDispatcher/);
  assert.match(source, /createPortableIsolationHelperRuntimeSession/);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|child_process|fs|net|tls|http|https|worker_threads|module)['"]\)|process\.env|\b__dirname\b|\bimport\s*\(|(?:backend|provider|helper|executable)Path/
  );
  console.log('portable isolation helper physical runtime tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
