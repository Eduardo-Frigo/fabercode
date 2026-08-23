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
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');
const {
  SANDBOX_COMMAND_KINDS,
  createSandboxExecutionRequest,
} = require('../main/capabilities/sandbox_backend_contract');
const {
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  PROCESS_SUPERVISOR_STATES,
  createProcessSupervisorDisposeReceipt,
  createProcessSupervisorExecReceipt,
  createProcessSupervisorProbeResult,
  createProcessSupervisorStopReceipt,
} = require('../main/capabilities/process_supervisor_contract');
const {
  EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
} = require('../main/runtime/execution_isolation_runtime_config');
const {
  EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION,
  PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
  createExecutionIsolationProviderSelection,
} = require('../main/services/execution_isolation_provider_factory');
const {
  EXECUTION_ISOLATION_RUNTIME_SERVICES_DISPOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION,
  createExecutionIsolationRuntimeServices,
} = require('../main/services/execution_isolation_runtime_services');

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

function attestation({ buildId, workspaceBackend, rootBackend, processBackend, overrides = {} }) {
  const core = {
    providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
    buildId,
    schemaVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
    workspaceBackendVersion: EXECUTION_WORKSPACE_BACKEND_VERSION,
    projectRootAuthorityBackendVersion: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    processSupervisorBackendVersion: PROCESS_SUPERVISOR_BACKEND_VERSION,
    workspaceBackendId: workspaceBackend.id,
    projectRootAuthorityBackendId: rootBackend.id,
    processSupervisorBackendId: processBackend.id,
    sharedPhysicalRootAuthority: true,
    sourceIdentityCompareAndSwap: true,
    handleRelativeProjectAccess: true,
    privateWorkspaceMaterialization: true,
    rollbackByDiscard: true,
    workspaceBoundProcessExecution: true,
    networkDefaultDeny: true,
    processTreeTermination: true,
    zeroOrphanProcessDisposal: true,
  };
  return Object.freeze({
    schemaVersion: core.schemaVersion,
    workspaceBackendVersion: core.workspaceBackendVersion,
    projectRootAuthorityBackendVersion: core.projectRootAuthorityBackendVersion,
    processSupervisorBackendVersion: core.processSupervisorBackendVersion,
    workspaceBackendId: core.workspaceBackendId,
    projectRootAuthorityBackendId: core.projectRootAuthorityBackendId,
    processSupervisorBackendId: core.processSupervisorBackendId,
    sharedPhysicalRootAuthority: core.sharedPhysicalRootAuthority,
    sourceIdentityCompareAndSwap: core.sourceIdentityCompareAndSwap,
    handleRelativeProjectAccess: core.handleRelativeProjectAccess,
    privateWorkspaceMaterialization: core.privateWorkspaceMaterialization,
    rollbackByDiscard: core.rollbackByDiscard,
    workspaceBoundProcessExecution: core.workspaceBoundProcessExecution,
    networkDefaultDeny: core.networkDefaultDeny,
    processTreeTermination: core.processTreeTermination,
    zeroOrphanProcessDisposal: core.zeroOrphanProcessDisposal,
    attestationDigest: canonicalSha256Digest(core),
    ...overrides,
  });
}

function providerHarness({
  buildId = 'portable-isolation-build-1',
  workspaceBackendOverride = null,
  rootBackendOverride = null,
  processBackendOverride = null,
  attestationOverrides = {},
  providerOverrides = {},
  disposeImpl = null,
  processDisposeImpl = null,
} = {}) {
  const state = {
    lifecycleEvents: [],
    workspaceProbes: 0,
    rootProbes: 0,
    processProbes: 0,
    processExecs: 0,
    processStops: 0,
    processExecutions: new Map(),
    lastProcessRequest: null,
    workspaceAcquires: 0,
    workspaceDiscards: 0,
    rootAcquires: 0,
    workspaceBackendDisposals: 0,
    rootBackendDisposals: 0,
    processBackendDisposals: 0,
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
  const processProbe = createProcessSupervisorProbeResult({
    state: PROCESS_SUPERVISOR_STATES.ENFORCED,
    guarantees: PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
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
      state.lifecycleEvents.push('workspace:discard');
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
    async acquire(request) {
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
        async close() {
          state.lifecycleEvents.push('root:close');
          return createProjectRootAuthorityCloseReceipt({ request, closed: true });
        },
      });
    },
    dispose() {
      state.rootBackendDisposals += 1;
      return Object.freeze({ ok: true, disposed: true });
    },
  });
  const processBackend = processBackendOverride || Object.freeze({
    version: PROCESS_SUPERVISOR_BACKEND_VERSION,
    id: 'portable-process-supervisor',
    probe() {
      state.processProbes += 1;
      return processProbe;
    },
    exec(request) {
      state.processExecs += 1;
      state.lastProcessRequest = request;
      state.lifecycleEvents.push('process:exec');
      const snapshot = Object.freeze({
        status: 'running',
        revision: 1,
        exitCode: null,
        signal: null,
        timedOut: false,
        stopped: false,
        availableFromCursor: 0,
        outputCursor: 0,
      });
      state.processExecutions.set(request.executionId, snapshot);
      return createProcessSupervisorExecReceipt({ request, ...snapshot });
    },
    read() { throw new Error('process read is outside the provider factory test'); },
    wait() { throw new Error('process wait is outside the provider factory test'); },
    stop(request) {
      state.processStops += 1;
      state.lifecycleEvents.push('process:stop');
      const current = state.processExecutions.get(request.executionId);
      const snapshot = Object.freeze({
        ...current,
        status: 'stopped',
        revision: current.revision + 1,
        signal: 'SIGTERM',
        stopped: true,
      });
      state.processExecutions.set(request.executionId, snapshot);
      return createProcessSupervisorStopReceipt({
        request,
        ...snapshot,
        treeTerminated: true,
        idempotent: false,
      });
    },
    dispose() {
      state.processBackendDisposals += 1;
      state.lifecycleEvents.push('process:dispose');
      return processDisposeImpl
        ? processDisposeImpl()
        : createProcessSupervisorDisposeReceipt({ orphaned: 0 });
    },
  });
  const provider = Object.freeze({
    providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
    buildId,
    executionWorkspaceBackend: workspaceBackend,
    projectRootAuthorityBackend: rootBackend,
    processSupervisorBackend: processBackend,
    isolationAttestation: attestation({
      buildId,
      workspaceBackend,
      rootBackend,
      processBackend,
      overrides: attestationOverrides,
    }),
    dispose() {
      state.providerDisposals += 1;
      state.lifecycleEvents.push('provider:dispose');
      return disposeImpl ? disposeImpl() : Object.freeze({ ok: true, disposed: true });
    },
    ...providerOverrides,
  });
  return { provider, state, workspaceBackend, rootBackend, processBackend };
}

function assertExactSelection(selection) {
  assert.deepStrictEqual(Reflect.ownKeys(selection), [
    'version',
    'executionWorkspaceBackend',
    'projectRootAuthorityBackend',
    'processSupervisorBackend',
    'diagnostics',
    'dispose',
  ]);
  assert.strictEqual(selection.version, EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION);
  assert.strictEqual(Object.isFrozen(selection), true);
  assert.strictEqual(Object.isFrozen(selection.executionWorkspaceBackend), true);
  assert.strictEqual(Object.isFrozen(selection.projectRootAuthorityBackend), true);
  assert.strictEqual(Object.isFrozen(selection.processSupervisorBackend), true);
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
  const defaultSelection = createExecutionIsolationProviderSelection();
  assertUnsupported(defaultSelection, 'RUNTIME_DISABLED');
  assert.strictEqual(
    (await defaultSelection.processSupervisorBackend.probe()).state,
    PROCESS_SUPERVISOR_STATES.UNAVAILABLE
  );
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
  assert.strictEqual(validHarness.state.processProbes, 1);
  assert.strictEqual(selection.executionWorkspaceBackend.probe().state, 'enforced');
  assert.strictEqual(selection.projectRootAuthorityBackend.probe().state, 'enforced');
  assert.strictEqual(selection.processSupervisorBackend.probe().state, 'enforced');
  assert.strictEqual(validHarness.state.workspaceProbes, 1, 'attested probe must be cached');
  assert.strictEqual(validHarness.state.rootProbes, 1, 'attested probe must be cached');
  assert.strictEqual(validHarness.state.processProbes, 1, 'attested probe must be cached');

  const workspaceAcquireRequest = workspaceRequest();
  const workspaceLease = selection.executionWorkspaceBackend.acquire(workspaceAcquireRequest);
  const discardRequest = createExecutionWorkspaceDiscardRequest({
    request: workspaceAcquireRequest,
    lease: workspaceLease,
  });
  assert.strictEqual(selection.executionWorkspaceBackend.discard(discardRequest).discarded, true);
  const acquiredRoot = await selection.projectRootAuthorityBackend.acquire(rootRequest());
  assert.strictEqual(acquiredRoot.reader.version, PROJECT_ROOT_READER_VERSION);
  assert.strictEqual((await acquiredRoot.close()).closed, true);
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
  await assert.rejects(
    selection.projectRootAuthorityBackend.acquire(rootRequest()),
    (error) => error && error.code === 'PROJECT_ROOT_AUTHORITY_UNAVAILABLE'
  );

  assert.deepStrictEqual(selection.executionWorkspaceBackend.dispose(), {
    ok: true,
    disposed: true,
  });
  assert.strictEqual(validHarness.state.providerDisposals, 0);
  assert.strictEqual(selection.executionWorkspaceBackend.probe().state, 'unavailable');
  assert.strictEqual(selection.processSupervisorBackend.probe().state, 'enforced');
  assert.deepStrictEqual(await selection.processSupervisorBackend.dispose(), {
    ok: true,
    disposed: true,
    orphaned: 0,
  });
  assert.strictEqual(validHarness.state.processBackendDisposals, 1);
  assert.strictEqual(validHarness.state.providerDisposals, 1);
  assert.strictEqual(
    (await selection.processSupervisorBackend.probe()).state,
    PROCESS_SUPERVISOR_STATES.UNAVAILABLE
  );
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
  await forceSelection.dispose();
  await forceSelection.dispose();
  assert.strictEqual(forceHarness.state.providerDisposals, 1);
  assert.strictEqual(forceHarness.state.processBackendDisposals, 1);
  assert.strictEqual(forceSelection.executionWorkspaceBackend.probe().state, 'unavailable');
  assert.strictEqual(forceSelection.projectRootAuthorityBackend.probe().state, 'unavailable');
  assert.strictEqual((await forceSelection.processSupervisorBackend.probe()).state, 'unavailable');
  assert.throws(() => forceSelection.executionWorkspaceBackend.discard({}), /unavailable/i);
  await assert.rejects(
    forceSelection.projectRootAuthorityBackend.acquire({}),
    /unavailable/i
  );
  await assert.rejects(
    forceSelection.processSupervisorBackend.exec(Object.freeze({})),
    (error) => error && error.code === 'PROCESS_SUPERVISOR_UNAVAILABLE'
  );

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
  assert.strictEqual(reverseHarness.state.providerDisposals, 0);
  await reverseSelection.processSupervisorBackend.dispose();
  assert.strictEqual(reverseHarness.state.providerDisposals, 1);

  let resolveAsyncProcessDispose;
  const asyncDisposeHarness = providerHarness({
    processDisposeImpl: () => new Promise((resolve) => {
      resolveAsyncProcessDispose = resolve;
    }),
  });
  const asyncDisposeSelection = createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => asyncDisposeHarness.provider,
  });
  const firstAsyncDispose = asyncDisposeSelection.dispose();
  const secondAsyncDispose = asyncDisposeSelection.dispose();
  assert.strictEqual(firstAsyncDispose, secondAsyncDispose);
  assert.strictEqual(asyncDisposeHarness.state.processBackendDisposals, 1);
  assert.strictEqual(asyncDisposeHarness.state.providerDisposals, 0);
  assert.strictEqual(asyncDisposeSelection.executionWorkspaceBackend.probe().state, 'unavailable');
  assert.strictEqual(asyncDisposeSelection.projectRootAuthorityBackend.probe().state, 'unavailable');
  await assert.rejects(
    asyncDisposeSelection.processSupervisorBackend.exec(Object.freeze({})),
    (error) => error && error.code === 'PROCESS_SUPERVISOR_UNAVAILABLE'
  );
  resolveAsyncProcessDispose(createProcessSupervisorDisposeReceipt({ orphaned: 0 }));
  assert.deepStrictEqual(await firstAsyncDispose, { ok: true, disposed: true });
  assert.strictEqual(asyncDisposeHarness.state.providerDisposals, 1);

  const processFirstHarness = providerHarness();
  const processFirstSelection = createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => processFirstHarness.provider,
  });
  await processFirstSelection.processSupervisorBackend.dispose();
  assert.strictEqual(processFirstHarness.state.providerDisposals, 0);
  processFirstSelection.executionWorkspaceBackend.dispose();
  assert.strictEqual(processFirstHarness.state.providerDisposals, 0);
  processFirstSelection.projectRootAuthorityBackend.dispose();
  assert.strictEqual(processFirstHarness.state.providerDisposals, 1);

  const invalidDisposeHarness = providerHarness({
    processDisposeImpl: () => Object.freeze({ ok: true, disposed: true, orphaned: 1 }),
  });
  const invalidDisposeSelection = createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => invalidDisposeHarness.provider,
  });
  assert.deepStrictEqual(await invalidDisposeSelection.dispose(), {
    ok: false,
    disposed: true,
  });
  assert.deepStrictEqual(await invalidDisposeSelection.dispose(), {
    ok: false,
    disposed: true,
  });
  assert.strictEqual(invalidDisposeHarness.state.processBackendDisposals, 1);
  assert.strictEqual(invalidDisposeHarness.state.providerDisposals, 1);

  const rejectedDisposeHarness = providerHarness({
    processDisposeImpl: () => Promise.reject(new Error('/private/provider disposal rejected')),
  });
  const rejectedDisposeSelection = createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => rejectedDisposeHarness.provider,
  });
  assert.deepStrictEqual(await rejectedDisposeSelection.dispose(), {
    ok: false,
    disposed: true,
  });
  assert.strictEqual(rejectedDisposeHarness.state.processBackendDisposals, 1);
  assert.strictEqual(rejectedDisposeHarness.state.providerDisposals, 1);

  let reentrantSelection;
  const reentrantHarness = providerHarness({
    processDisposeImpl() {
      reentrantSelection.processSupervisorBackend.dispose();
      return createProcessSupervisorDisposeReceipt({ orphaned: 0 });
    },
  });
  reentrantSelection = createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => reentrantHarness.provider,
  });
  assert.deepStrictEqual(await reentrantSelection.dispose(), {
    ok: false,
    disposed: true,
  });
  assert.strictEqual(reentrantHarness.state.processBackendDisposals, 1);
  assert.strictEqual(reentrantHarness.state.providerDisposals, 1);

  let forceReentrantSelection;
  const forceReentrantHarness = providerHarness({
    processDisposeImpl() {
      forceReentrantSelection.dispose();
      return createProcessSupervisorDisposeReceipt({ orphaned: 0 });
    },
  });
  forceReentrantSelection = createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => forceReentrantHarness.provider,
  });
  assert.deepStrictEqual(await forceReentrantSelection.dispose(), {
    ok: false,
    disposed: true,
  });
  assert.deepStrictEqual(await forceReentrantSelection.dispose(), {
    ok: false,
    disposed: true,
  });
  assert.strictEqual(forceReentrantHarness.state.processBackendDisposals, 1);
  assert.strictEqual(forceReentrantHarness.state.providerDisposals, 1);

  // The selected facades must compose with all three ownership services while
  // retaining one provider lifecycle. Root/workspace disposal cannot tear down
  // a still-active process supervisor consumer.
  const registryHarness = providerHarness();
  const registrySelection = createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => registryHarness.provider,
  });
  const runtimeServices = createExecutionIsolationRuntimeServices({
    selection: registrySelection,
  });
  assert.strictEqual(Object.isFrozen(runtimeServices), true);
  assert.strictEqual(runtimeServices.version, EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION);
  assert.deepStrictEqual(Reflect.ownKeys(runtimeServices), [
    'version',
    'executionWorkspaceRegistry',
    'projectRootAuthorityRegistry',
    'processSupervisor',
    'jobSessionService',
    'diagnostics',
    'dispose',
  ]);
  assert.strictEqual(runtimeServices.diagnostics().state, 'ready');
  const registrySessionOpen = await runtimeServices.jobSessionService.open({
    binding: binding(),
    sourceRootIdentityDigest: digest('b'),
  });
  assert.strictEqual(
    registrySessionOpen.ok,
    true,
    JSON.stringify(registrySessionOpen)
  );
  assert.strictEqual(registryHarness.state.workspaceProbes, 1);
  assert.strictEqual(registryHarness.state.rootProbes, 1);
  assert.strictEqual(registryHarness.state.processProbes, 1);
  assert.strictEqual(runtimeServices.diagnostics().jobSessions.active, 1);
  const registryExecution = await registrySessionOpen.session.exec(Object.freeze({
    sandboxRequest: createSandboxExecutionRequest({
      executionId: 'registry-execution-a',
      requestId: 'registry-request-a',
      grantId: 'registry-grant-a',
      rootPath: binding().canonicalRootPath,
      realRootPath: binding().realRootPath,
      command: {
        kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
        executable: 'node',
        args: ['--version'],
      },
      timeoutMs: 10_000,
    }),
  }));
  assert.strictEqual(registryExecution.ok, true);
  assert.strictEqual(registryHarness.state.processExecs, 1);
  assert.strictEqual(
    registryHarness.state.lastProcessRequest.sandboxRequest.rootPath,
    '/workspace/faber-jobs/job-a'
  );
  assert.strictEqual(
    registryHarness.state.lastProcessRequest.sandboxRequest.realRootPath,
    '/private/workspace/faber-jobs/job-a'
  );

  const runtimeDisposeReceipt = await runtimeServices.dispose();
  assert.deepStrictEqual(runtimeDisposeReceipt, {
    version: EXECUTION_ISOLATION_RUNTIME_SERVICES_DISPOSE_RECEIPT_VERSION,
    disposed: true,
    zeroOrphanShutdownConfirmed: true,
    jobSessionsDisposed: true,
    processSupervisorDisposed: true,
    executionWorkspaceDisposed: true,
    projectRootAuthorityDisposed: true,
    selectionDisposed: true,
  });
  assert.strictEqual(await runtimeServices.dispose(), runtimeDisposeReceipt);
  assert.deepStrictEqual(registryHarness.state.lifecycleEvents, [
    'process:exec',
    'process:stop',
    'workspace:discard',
    'root:close',
    'process:dispose',
    'provider:dispose',
  ]);
  assert.strictEqual(runtimeServices.diagnostics().state, 'disposed');
  assert.strictEqual(registryHarness.state.providerDisposals, 1);
  assert.strictEqual(registryHarness.state.processBackendDisposals, 1);
  assert.strictEqual(registryHarness.state.processStops, 1);
  await registrySelection.dispose();
  assert.strictEqual(registryHarness.state.providerDisposals, 1);
  assert.strictEqual(registryHarness.state.workspaceBackendDisposals, 0);
  assert.strictEqual(registryHarness.state.rootBackendDisposals, 0);

  const blockedRuntimeServices = createExecutionIsolationRuntimeServices({
    selection: createExecutionIsolationProviderSelection(),
  });
  assert.strictEqual(blockedRuntimeServices.diagnostics().state, 'blocked');
  assert.strictEqual(
    (await blockedRuntimeServices.processSupervisor.probe()).state,
    PROCESS_SUPERVISOR_STATES.UNAVAILABLE
  );
  assert.strictEqual(
    (await blockedRuntimeServices.dispose()).zeroOrphanShutdownConfirmed,
    true
  );

  const uncleanRuntimeHarness = providerHarness({
    processDisposeImpl: () => Object.freeze({
      ok: true,
      disposed: true,
      orphaned: 1,
    }),
  });
  const uncleanRuntimeServices = createExecutionIsolationRuntimeServices({
    selection: createExecutionIsolationProviderSelection({
      config: config(),
      providerFactory: () => uncleanRuntimeHarness.provider,
    }),
  });
  const uncleanRuntimeReceipt = await uncleanRuntimeServices.dispose();
  assert.strictEqual(uncleanRuntimeReceipt.zeroOrphanShutdownConfirmed, false);
  assert.strictEqual(uncleanRuntimeReceipt.processSupervisorDisposed, false);
  assert.strictEqual(uncleanRuntimeReceipt.executionWorkspaceDisposed, true);
  assert.strictEqual(uncleanRuntimeReceipt.projectRootAuthorityDisposed, true);
  assert.strictEqual(uncleanRuntimeReceipt.selectionDisposed, false);
  assert.strictEqual(uncleanRuntimeHarness.state.providerDisposals, 1);

  assert.throws(
    () => createExecutionIsolationRuntimeServices({}),
    /selection/i
  );
  assert.throws(
    () => createExecutionIsolationRuntimeServices({
      selection: createExecutionIsolationProviderSelection(),
      ambientAuthority: true,
    }),
    /options/i
  );

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

  const missingProcessHarness = providerHarness();
  const missingProcessProvider = Object.freeze({
    ...missingProcessHarness.provider,
    processSupervisorBackend: undefined,
  });
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => missingProcessProvider,
  }), 'PROVIDER_REJECTED');
  assert.strictEqual(missingProcessHarness.state.workspaceProbes, 0);
  assert.strictEqual(missingProcessHarness.state.rootProbes, 0);
  assert.strictEqual(missingProcessHarness.state.processProbes, 0);
  assert.strictEqual(missingProcessHarness.state.providerDisposals, 1);

  const extraProcessBase = providerHarness().processBackend;
  const extraProcessBackend = Object.freeze({
    ...extraProcessBase,
    ambientAuthority: true,
  });
  const extraProcessHarness = providerHarness({
    processBackendOverride: extraProcessBackend,
  });
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => extraProcessHarness.provider,
  }), 'PROVIDER_REJECTED');
  assert.strictEqual(extraProcessHarness.state.workspaceProbes, 0);
  assert.strictEqual(extraProcessHarness.state.rootProbes, 0);
  assert.strictEqual(extraProcessHarness.state.processProbes, 0);
  assert.strictEqual(extraProcessHarness.state.providerDisposals, 1);

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
  assert.strictEqual(resolvedHarness.state.processProbes, 0);

  const invalidHarnesses = [
    providerHarness({ providerOverrides: { providerVersion: 'portable-execution-isolation-provider.v0' } }),
    providerHarness({ providerOverrides: { buildId: '/tmp/provider.node' } }),
    providerHarness({ providerOverrides: { extra: true } }),
    providerHarness({ attestationOverrides: { sharedPhysicalRootAuthority: false } }),
    providerHarness({ attestationOverrides: { zeroOrphanProcessDisposal: false } }),
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
    assert.strictEqual(harness.state.processProbes, 0);
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

  const unavailableProcessBase = providerHarness().processBackend;
  const unavailableProcess = Object.freeze({
    ...unavailableProcessBase,
    probe() {
      return createProcessSupervisorProbeResult({
        state: PROCESS_SUPERVISOR_STATES.UNAVAILABLE,
        guarantees: [],
        reasonCode: 'PORTABLE_PROVIDER_NOT_READY',
      });
    },
  });
  const unavailableProcessHarness = providerHarness({
    processBackendOverride: unavailableProcess,
  });
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => unavailableProcessHarness.provider,
  }), 'BACKENDS_NOT_ENFORCED');
  assert.strictEqual(unavailableProcessHarness.state.providerDisposals, 1);

  const asyncProcessBase = providerHarness().processBackend;
  const asyncProcess = Object.freeze({
    ...asyncProcessBase,
    probe() {
      return Promise.resolve(createProcessSupervisorProbeResult({
        state: PROCESS_SUPERVISOR_STATES.ENFORCED,
        guarantees: PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
      }));
    },
  });
  const asyncProcessHarness = providerHarness({ processBackendOverride: asyncProcess });
  assertUnsupported(createExecutionIsolationProviderSelection({
    config: config(),
    providerFactory: () => asyncProcessHarness.provider,
  }), 'BACKENDS_NOT_ENFORCED');
  assert.strictEqual(asyncProcessHarness.state.providerDisposals, 1);

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
