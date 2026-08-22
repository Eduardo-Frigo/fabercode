'use strict';

const assert = require('assert');

const {
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  EXECUTION_WORKSPACE_STATES,
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceDiscardRequest,
  createExecutionWorkspaceLease,
  createExecutionWorkspaceProbeResult,
} = require('../main/capabilities/execution_workspace_contract');
const {
  createExecutionWorkspaceRegistry,
} = require('../main/capabilities/execution_workspace_registry');
const {
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_READER_VERSION,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootAuthorityCloseReceipt,
  createProjectRootAuthorityProbeResult,
} = require('../main/capabilities/project_root_authority_contract');
const {
  createProjectRootAuthorityRegistry,
} = require('../main/capabilities/project_root_authority_registry');
const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');
const {
  EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
} = require('../main/runtime/execution_isolation_runtime_config');
const {
  EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION,
  PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
  createExecutionIsolationProviderSelection,
} = require('../main/services/execution_isolation_provider_factory');

const digest = (character) => `sha256:${character.repeat(64)}`;

function config(mode = 'enabled', killSwitch = false) {
  return Object.freeze({
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode,
    killSwitch,
  });
}

function binding() {
  return {
    projectId: 'project-a',
    canonicalRootPath: '/workspace/source-a',
    realRootPath: '/private/workspace/source-a',
    sessionId: 'session-a',
    jobId: 'job-a',
    kernelId: 'legacy',
    submissionDigest: digest('a'),
  };
}

function workspaceRequest() {
  return createExecutionWorkspaceAcquireRequest({
    leaseId: 'workspace-lease-a',
    binding: binding(),
    sourceRootIdentityDigest: digest('b'),
  });
}

function rootRequest() {
  return createProjectRootAuthorityAcquireRequest({
    leaseId: 'root-lease-a',
    binding: binding(),
    expectedPhysicalRootIdentityDigest: digest('b'),
    purpose: 'execution',
  });
}

function createReader() {
  return Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    list() { return Object.freeze({ entries: Object.freeze([]), truncated: false }); },
    readFile() {
      return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
    },
    inspectEntry() {
      return Object.freeze({
        found: false,
        kind: null,
        bytes: null,
        mode: null,
        mtimeMs: null,
        contentDigest: null,
        linkTarget: null,
        entryIdentityDigest: null,
      });
    },
  });
}

function attestation({ buildId, workspaceBackend, rootBackend, overrides = {} }) {
  const core = {
    providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
    buildId,
    schemaVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
    workspaceBackendVersion: EXECUTION_WORKSPACE_BACKEND_VERSION,
    projectRootAuthorityBackendVersion: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    workspaceBackendId: workspaceBackend.id,
    projectRootAuthorityBackendId: rootBackend.id,
    sharedPhysicalRootAuthority: true,
    sourceIdentityCompareAndSwap: true,
    handleRelativeProjectAccess: true,
    privateWorkspaceMaterialization: true,
    rollbackByDiscard: true,
  };
  return Object.freeze({
    schemaVersion: core.schemaVersion,
    workspaceBackendVersion: core.workspaceBackendVersion,
    projectRootAuthorityBackendVersion: core.projectRootAuthorityBackendVersion,
    workspaceBackendId: core.workspaceBackendId,
    projectRootAuthorityBackendId: core.projectRootAuthorityBackendId,
    sharedPhysicalRootAuthority: core.sharedPhysicalRootAuthority,
    sourceIdentityCompareAndSwap: core.sourceIdentityCompareAndSwap,
    handleRelativeProjectAccess: core.handleRelativeProjectAccess,
    privateWorkspaceMaterialization: core.privateWorkspaceMaterialization,
    rollbackByDiscard: core.rollbackByDiscard,
    attestationDigest: canonicalSha256Digest(core),
    ...overrides,
  });
}

function providerHarness({
  buildId = 'portable-isolation-build-1',
  workspaceBackendOverride = null,
  rootBackendOverride = null,
  attestationOverrides = {},
  providerOverrides = {},
  disposeImpl = null,
} = {}) {
  const state = {
    workspaceProbes: 0,
    rootProbes: 0,
    workspaceAcquires: 0,
    workspaceDiscards: 0,
    rootAcquires: 0,
    workspaceBackendDisposals: 0,
    rootBackendDisposals: 0,
    providerDisposals: 0,
  };
  const workspaceProbe = createExecutionWorkspaceProbeResult({
    state: EXECUTION_WORKSPACE_STATES.ENFORCED,
    guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  });
  const rootProbe = createProjectRootAuthorityProbeResult({
    state: PROJECT_ROOT_AUTHORITY_STATES.ENFORCED,
    guarantees: PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  });
  const workspaceBackend = workspaceBackendOverride || Object.freeze({
    version: EXECUTION_WORKSPACE_BACKEND_VERSION,
    id: 'portable-private-workspace',
    probe() {
      state.workspaceProbes += 1;
      return workspaceProbe;
    },
    acquire(request) {
      state.workspaceAcquires += 1;
      return createExecutionWorkspaceLease({
        request,
        workspaceRootPath: '/workspace/faber-jobs/job-a',
        workspaceRealRootPath: '/private/workspace/faber-jobs/job-a',
        workspaceRootIdentityDigest: digest('c'),
      });
    },
    discard(request) {
      state.workspaceDiscards += 1;
      return createExecutionWorkspaceDiscardReceipt({ request, discarded: true });
    },
    dispose() {
      state.workspaceBackendDisposals += 1;
      return Object.freeze({ ok: true, disposed: true });
    },
  });
  const rootBackend = rootBackendOverride || Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    id: 'portable-project-root-authority',
    probe() {
      state.rootProbes += 1;
      return rootProbe;
    },
    acquire(request) {
      state.rootAcquires += 1;
      return Object.freeze({
        version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
        leaseId: request.leaseId,
        jobId: request.binding.jobId,
        projectId: request.binding.projectId,
        purpose: request.purpose,
        physicalRootIdentityDigest: request.expectedPhysicalRootIdentityDigest,
        authorityDigest: request.authorityDigest,
        reader: createReader(),
        close() {
          return createProjectRootAuthorityCloseReceipt({ request, closed: true });
        },
      });
    },
    dispose() {
      state.rootBackendDisposals += 1;
      return Object.freeze({ ok: true, disposed: true });
    },
  });
  const provider = Object.freeze({
    providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
    buildId,
    executionWorkspaceBackend: workspaceBackend,
    projectRootAuthorityBackend: rootBackend,
    isolationAttestation: attestation({
      buildId,
      workspaceBackend,
      rootBackend,
      overrides: attestationOverrides,
    }),
    dispose() {
      state.providerDisposals += 1;
      return disposeImpl ? disposeImpl() : Object.freeze({ ok: true, disposed: true });
    },
    ...providerOverrides,
  });
  return { provider, state, workspaceBackend, rootBackend };
}

function assertExactSelection(selection) {
  assert.deepStrictEqual(Reflect.ownKeys(selection), [
    'version',
    'executionWorkspaceBackend',
    'projectRootAuthorityBackend',
    'diagnostics',
    'dispose',
  ]);
  assert.strictEqual(selection.version, EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION);
  assert.strictEqual(Object.isFrozen(selection), true);
  assert.strictEqual(Object.isFrozen(selection.executionWorkspaceBackend), true);
  assert.strictEqual(Object.isFrozen(selection.projectRootAuthorityBackend), true);
  assert.strictEqual(Object.isFrozen(selection.diagnostics), true);
  assert.deepStrictEqual(Reflect.ownKeys(selection.diagnostics), [
    'status', 'reasonCode', 'mode', 'killSwitch',
  ]);
}

function assertUnsupported(selection, reasonCode) {
  assertExactSelection(selection);
  assert.strictEqual(selection.diagnostics.status, 'unsupported');
  assert.strictEqual(selection.diagnostics.reasonCode, reasonCode);
  assert.strictEqual(
    selection.executionWorkspaceBackend.probe().state,
    EXECUTION_WORKSPACE_STATES.UNAVAILABLE
  );
  assert.strictEqual(
    selection.projectRootAuthorityBackend.probe().state,
    PROJECT_ROOT_AUTHORITY_STATES.UNAVAILABLE
  );
}

async function main() {
  let factoryCalls = 0;
  for (const [runtimeConfig, reasonCode] of [
    [config('disabled', false), 'RUNTIME_DISABLED'],
    [config('enabled', true), 'RUNTIME_KILL_SWITCH_ACTIVE'],
  ]) {
    const selection = createExecutionIsolationProviderSelection({
      config: runtimeConfig,
      providerFactory() {
        factoryCalls += 1;
        throw new Error('inactive runtime must not load provider');
      },
    });
    assertUnsupported(selection, reasonCode);
    selection.dispose();
    selection.dispose();
  }
  assert.strictEqual(factoryCalls, 0);
  assertUnsupported(createExecutionIsolationProviderSelection(), 'RUNTIME_DISABLED');
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: undefined,
  }), 'PROVIDER_UNAVAILABLE');

  let invalidConfigFactoryCalls = 0;
  for (const invalidConfig of [
    { ...config(), version: 'execution-isolation-runtime-config.v0' },
    { ...config(), mode: 'canary' },
    { ...config(), killSwitch: 'false' },
    { ...config(), providerPath: '/tmp/provider.node' },
    Promise.resolve(config()),
  ]) {
    assertUnsupported(createExecutionIsolationProviderSelection({
      config: invalidConfig,
      providerFactory() {
        invalidConfigFactoryCalls += 1;
        return providerHarness().provider;
      },
    }), 'FACTORY_OPTIONS_INVALID');
  }
  assert.strictEqual(invalidConfigFactoryCalls, 0);
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: Promise.resolve(() => providerHarness().provider),
  }), 'FACTORY_OPTIONS_INVALID');

  const validHarness = providerHarness({
    disposeImpl: () => Promise.reject(new Error('async provider disposal absorbed')),
  });
  const selection = createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory() {
      factoryCalls += 1;
      return validHarness.provider;
    },
  });
  assertExactSelection(selection);
  assert.deepStrictEqual(selection.diagnostics, {
    status: 'enforced',
    reasonCode: 'ENFORCED',
    mode: 'enabled',
    killSwitch: false,
  });
  assert.strictEqual(factoryCalls, 1);
  assert.strictEqual(validHarness.state.workspaceProbes, 1);
  assert.strictEqual(validHarness.state.rootProbes, 1);
  assert.strictEqual(selection.executionWorkspaceBackend.probe().state, 'enforced');
  assert.strictEqual(selection.projectRootAuthorityBackend.probe().state, 'enforced');
  assert.strictEqual(validHarness.state.workspaceProbes, 1, 'attested probe must be cached');
  assert.strictEqual(validHarness.state.rootProbes, 1, 'attested probe must be cached');

  const workspaceAcquireRequest = workspaceRequest();
  const workspaceLease = selection.executionWorkspaceBackend.acquire(workspaceAcquireRequest);
  const discardRequest = createExecutionWorkspaceDiscardRequest({
    request: workspaceAcquireRequest,
    lease: workspaceLease,
  });
  assert.strictEqual(selection.executionWorkspaceBackend.discard(discardRequest).discarded, true);
  const acquiredRoot = selection.projectRootAuthorityBackend.acquire(rootRequest());
  assert.strictEqual(acquiredRoot.reader.version, PROJECT_ROOT_READER_VERSION);
  assert.strictEqual(acquiredRoot.close().closed, true);
  assert.strictEqual(validHarness.state.workspaceAcquires, 1);
  assert.strictEqual(validHarness.state.workspaceDiscards, 1);
  assert.strictEqual(validHarness.state.rootAcquires, 1);

  assert.deepStrictEqual(selection.projectRootAuthorityBackend.dispose(), {
    ok: true,
    disposed: true,
  });
  assert.strictEqual(selection.projectRootAuthorityBackend.probe().state, 'unavailable');
  assert.strictEqual(selection.executionWorkspaceBackend.probe().state, 'enforced');
  assert.strictEqual(validHarness.state.providerDisposals, 0);
  assert.throws(
    () => selection.projectRootAuthorityBackend.acquire(rootRequest()),
    (error) => error && error.code === 'PROJECT_ROOT_AUTHORITY_UNAVAILABLE'
  );

  assert.deepStrictEqual(selection.executionWorkspaceBackend.dispose(), {
    ok: true,
    disposed: true,
  });
  assert.strictEqual(validHarness.state.providerDisposals, 1);
  assert.strictEqual(selection.executionWorkspaceBackend.probe().state, 'unavailable');
  assert.throws(
    () => selection.executionWorkspaceBackend.acquire(workspaceRequest()),
    (error) => error && error.code === 'WORKSPACE_UNAVAILABLE'
  );
  selection.dispose();
  selection.dispose();
  assert.strictEqual(validHarness.state.providerDisposals, 1);
  assert.strictEqual(validHarness.state.workspaceBackendDisposals, 0);
  assert.strictEqual(validHarness.state.rootBackendDisposals, 0);

  const forceHarness = providerHarness();
  const forceSelection = createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => forceHarness.provider,
  });
  forceSelection.dispose();
  forceSelection.dispose();
  assert.strictEqual(forceHarness.state.providerDisposals, 1);
  assert.strictEqual(forceSelection.executionWorkspaceBackend.probe().state, 'unavailable');
  assert.strictEqual(forceSelection.projectRootAuthorityBackend.probe().state, 'unavailable');
  assert.throws(() => forceSelection.executionWorkspaceBackend.discard({}), /unavailable/i);
  assert.throws(() => forceSelection.projectRootAuthorityBackend.acquire({}), /unavailable/i);

  const reverseHarness = providerHarness();
  const reverseSelection = createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => reverseHarness.provider,
  });
  reverseSelection.executionWorkspaceBackend.dispose();
  assert.strictEqual(reverseHarness.state.providerDisposals, 0);
  assert.strictEqual(reverseSelection.executionWorkspaceBackend.probe().state, 'unavailable');
  assert.strictEqual(reverseSelection.projectRootAuthorityBackend.probe().state, 'enforced');
  reverseSelection.projectRootAuthorityBackend.dispose();
  assert.strictEqual(reverseHarness.state.providerDisposals, 1);

  // The selected facades must compose with both ownership registries while
  // retaining one provider lifecycle. Root disposal alone cannot tear down a
  // still-active workspace consumer.
  const registryHarness = providerHarness();
  const registrySelection = createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => registryHarness.provider,
  });
  const rootRegistry = createProjectRootAuthorityRegistry({
    backend: registrySelection.projectRootAuthorityBackend,
    leaseIdFactory: () => 'registry-root-lease-a',
  });
  const workspaceRegistry = createExecutionWorkspaceRegistry({
    backend: registrySelection.executionWorkspaceBackend,
    leaseIdFactory: () => 'registry-workspace-lease-a',
  });
  const registryRootAcquire = rootRegistry.acquire({
    binding: binding(),
    expectedPhysicalRootIdentityDigest: digest('b'),
    purpose: 'execution',
  });
  assert.strictEqual(registryRootAcquire.ok, true);
  const registryWorkspaceAcquire = await workspaceRegistry.acquire({
    binding: binding(),
    sourceRootIdentityDigest: digest('b'),
  });
  assert.strictEqual(registryWorkspaceAcquire.ok, true);
  assert.strictEqual(registryHarness.state.workspaceProbes, 1);
  assert.strictEqual(registryHarness.state.rootProbes, 1);

  assert.strictEqual(rootRegistry.release({
    binding: binding(),
    leaseId: registryRootAcquire.lease.leaseId,
  }).ok, true);
  assert.strictEqual(rootRegistry.dispose().ok, true);
  assert.strictEqual(registryHarness.state.providerDisposals, 0);
  assert.strictEqual((await workspaceRegistry.rollback({
    binding: binding(),
    leaseId: registryWorkspaceAcquire.lease.leaseId,
  })).ok, true);
  assert.strictEqual((await workspaceRegistry.dispose()).ok, true);
  assert.strictEqual(registryHarness.state.providerDisposals, 1);
  registrySelection.dispose();
  assert.strictEqual(registryHarness.state.providerDisposals, 1);
  assert.strictEqual(registryHarness.state.workspaceBackendDisposals, 0);
  assert.strictEqual(registryHarness.state.rootBackendDisposals, 0);

  const missingWorkspaceHarness = providerHarness();
  const missingWorkspaceProvider = Object.freeze({
    ...missingWorkspaceHarness.provider,
    executionWorkspaceBackend: undefined,
  });
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => missingWorkspaceProvider,
  }), 'PROVIDER_REJECTED');
  assert.strictEqual(missingWorkspaceHarness.state.providerDisposals, 1);

  const rejectedProvider = Promise.reject(new Error('async provider rejected'));
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => rejectedProvider,
  }), 'PROVIDER_REJECTED');
  const resolvedHarness = providerHarness();
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => Promise.resolve(resolvedHarness.provider),
  }), 'PROVIDER_REJECTED');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(resolvedHarness.state.providerDisposals, 1);
  assert.strictEqual(resolvedHarness.state.workspaceProbes, 0);
  assert.strictEqual(resolvedHarness.state.rootProbes, 0);

  const invalidHarnesses = [
    providerHarness({ providerOverrides: { providerVersion: 'portable-execution-isolation-provider.v0' } }),
    providerHarness({ providerOverrides: { buildId: '/tmp/provider.node' } }),
    providerHarness({ providerOverrides: { extra: true } }),
    providerHarness({ attestationOverrides: { sharedPhysicalRootAuthority: false } }),
    providerHarness({ attestationOverrides: { attestationDigest: digest('f') } }),
    providerHarness({ attestationOverrides: { extra: true } }),
  ];
  for (const harness of invalidHarnesses) {
    const invalid = createExecutionIsolationProviderSelection({
      config: config(),
      providerFactory: () => harness.provider,
    });
    assertUnsupported(invalid, 'PROVIDER_REJECTED');
    assert.strictEqual(harness.state.workspaceProbes, 0);
    assert.strictEqual(harness.state.rootProbes, 0);
    assert.strictEqual(harness.state.providerDisposals, 1);
    invalid.dispose();
    assert.strictEqual(harness.state.providerDisposals, 1);
  }

  const unavailableWorkspace = Object.freeze({
    ...providerHarness().workspaceBackend,
    probe() {
      return createExecutionWorkspaceProbeResult({
        state: EXECUTION_WORKSPACE_STATES.UNAVAILABLE,
        guarantees: [],
        reasonCode: 'PORTABLE_PROVIDER_NOT_READY',
      });
    },
  });
  const unavailableHarness = providerHarness({ workspaceBackendOverride: unavailableWorkspace });
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => unavailableHarness.provider,
  }), 'BACKENDS_NOT_ENFORCED');
  assert.strictEqual(unavailableHarness.state.providerDisposals, 1);

  const asyncProbeBase = providerHarness().workspaceBackend;
  const asyncProbeWorkspace = Object.freeze({
    ...asyncProbeBase,
    probe() {
      return Promise.resolve(createExecutionWorkspaceProbeResult({
        state: EXECUTION_WORKSPACE_STATES.ENFORCED,
        guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
      }));
    },
  });
  const asyncProbeHarness = providerHarness({ workspaceBackendOverride: asyncProbeWorkspace });
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => asyncProbeHarness.provider,
  }), 'BACKENDS_NOT_ENFORCED');
  assert.strictEqual(asyncProbeHarness.state.providerDisposals, 1);

  const unavailableRootBase = providerHarness().rootBackend;
  const unavailableRoot = Object.freeze({
    ...unavailableRootBase,
    probe() {
      return createProjectRootAuthorityProbeResult({
        state: PROJECT_ROOT_AUTHORITY_STATES.UNAVAILABLE,
        guarantees: [],
        reasonCode: 'PORTABLE_PROVIDER_NOT_READY',
      });
    },
  });
  const unavailableRootHarness = providerHarness({ rootBackendOverride: unavailableRoot });
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => unavailableRootHarness.provider,
  }), 'BACKENDS_NOT_ENFORCED');
  assert.strictEqual(unavailableRootHarness.state.providerDisposals, 1);

  const rejectedProbeBase = providerHarness().workspaceBackend;
  const rejectedProbeWorkspace = Object.freeze({
    ...rejectedProbeBase,
    probe() {
      throw Promise.reject(new Error('provider probe rejected'));
    },
  });
  const rejectedProbeHarness = providerHarness({
    workspaceBackendOverride: rejectedProbeWorkspace,
  });
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => rejectedProbeHarness.provider,
  }), 'BACKENDS_NOT_ENFORCED');
  assert.strictEqual(rejectedProbeHarness.state.providerDisposals, 1);

  let thenGetterCalls = 0;
  const hostileProvider = { ...providerHarness().provider };
  Object.defineProperty(hostileProvider, 'then', {
    enumerable: true,
    get() {
      thenGetterCalls += 1;
      throw new Error('then getter must not run');
    },
  });
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => hostileProvider,
  }), 'PROVIDER_REJECTED');
  assert.strictEqual(thenGetterCalls, 0);

  const proxiedHarness = providerHarness();
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => new Proxy(proxiedHarness.provider, {}),
  }), 'PROVIDER_REJECTED');
  assert.strictEqual(proxiedHarness.state.providerDisposals, 0);

  let proxiedFactoryCalls = 0;
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: new Proxy(() => {
      proxiedFactoryCalls += 1;
      return providerHarness().provider;
    }, {}),
  }), 'FACTORY_OPTIONS_INVALID');
  assert.strictEqual(proxiedFactoryCalls, 0);

  let buildGetterCalls = 0;
  const accessorHarness = providerHarness();
  const accessorProvider = { ...accessorHarness.provider };
  Object.defineProperty(accessorProvider, 'buildId', {
    enumerable: true,
    get() {
      buildGetterCalls += 1;
      return 'portable-isolation-build-1';
    },
  });
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => accessorProvider,
  }), 'PROVIDER_REJECTED');
  assert.strictEqual(buildGetterCalls, 0);
  assert.strictEqual(accessorHarness.state.providerDisposals, 1);

  const diagnosticsText = JSON.stringify([
    createExecutionIsolationProviderSelection().diagnostics,
    createExecutionIsolationProviderSelection({ config: config() }).diagnostics,
  ]);
  assert.strictEqual(diagnosticsText.includes('/tmp/'), false);
  assert.strictEqual(diagnosticsText.includes('provider.node'), false);

  await new Promise((resolve) => setImmediate(resolve));
  console.log('execution isolation provider factory tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
