'use strict';

const assert = require('assert');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  EXECUTION_WORKSPACE_STATES,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceLease,
  createExecutionWorkspaceProbeResult,
} = require('../main/capabilities/execution_workspace_contract');
const {
  createExecutionWorkspaceRegistry,
} = require('../main/capabilities/execution_workspace_registry');
const {
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  PROJECT_ROOT_READER_VERSION,
  createProjectRootAuthorityCloseReceipt,
  createProjectRootAuthorityProbeResult,
} = require('../main/capabilities/project_root_authority_contract');
const {
  createProjectRootAuthorityRegistry,
} = require('../main/capabilities/project_root_authority_registry');
const {
  classifyCanaryEditAction,
} = require('../main/agent_runtime/canary_edit_action_classifier');
const {
  evaluateCanaryEditAdmission,
} = require('../main/agent_runtime/canary_edit_admission_policy');
const {
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
} = require('../main/agent_runtime/canary_edit_runner');
const {
  CANARY_ROLLOUT_STAGES,
  createCanaryRolloutSelector,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  assertCanaryStagingDiscardReceipt,
  assertCanaryStagingSession,
} = require('../main/agent_runtime/canary_staging_contract');
const {
  CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
} = require('../main/agent_runtime/canary_transactional_staging_executor');
const {
  HARNESS_OPERATIONS,
  createExecuteRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
  CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS,
  CANARY_WORKSPACE_SESSION_PORT_ADAPTER_VERSION,
  createCanaryWorkspaceSessionPortAdapter,
} = require('../main/services/canary_workspace_session_port_adapter');

const digest = (character) => `sha256:${character.repeat(64)}`;

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      assertDeepFrozen(descriptor.value, seen);
    }
  }
}

function makeFixture({
  asyncExecuteAuthorization = false,
  denyExecute = false,
  invalidRootClose = false,
  invalidWorkspaceDiscard = false,
  mutableAction = false,
  snapshotMode = 'valid',
  workspaceUnavailable = false,
} = {}) {
  const events = [];
  const binding = createCapabilityDelegationBinding({
    projectId: 'project-canary-port-a',
    canonicalRootPath: '/workspace/project-canary-port-a',
    realRootPath: '/private/workspace/project-canary-port-a',
    sessionId: 'session-canary-port-a',
    jobId: 'job-canary-port-a',
    kernelId: 'codex-app-server-canary',
    submissionDigest: digest('a'),
  });
  const executionContext = {
    jobId: binding.jobId,
    requestedMode: 'delegate_task',
    signal: Object.freeze({ aborted: false }),
  };
  Object.defineProperty(executionContext, 'authorityBinding', {
    configurable: false,
    enumerable: false,
    value: binding,
    writable: false,
  });
  Object.freeze(executionContext);
  const projectInfo = deepFreeze({
    id: binding.projectId,
    projectId: binding.projectId,
    rootPath: binding.canonicalRootPath,
  });
  const actionData = {
    type: 'apply_file_patch',
    targetFile: 'src/app.js',
    previousContentHash: digest('b'),
    nextContent: 'module.exports = true;\n',
  };
  const action = mutableAction ? actionData : deepFreeze(actionData);
  const request = createExecuteRequest(action, projectInfo, {
    requestId: 'canary-workspace-port-a',
    executionContext,
  });
  const checkpoint = Object.freeze({
    checkpointDigest: digest('c'),
    checkpointVerified: true,
    projectId: binding.projectId,
    canonicalRootPath: binding.canonicalRootPath,
    jobId: binding.jobId,
  });
  const rootMutation = Object.freeze({
    canonicalRootPath: binding.canonicalRootPath,
    ownerJobId: binding.jobId,
    activeOtherMutatingJobs: 0,
  });
  const classification = classifyCanaryEditAction(action);
  const rolloutDecision = createCanaryRolloutSelector({
    cohortSeed: 'canary-workspace-port-tests-v1',
  }).select({
    killSwitch: false,
    configuredMode: 'canary',
    projectId: binding.projectId,
    projectPin: null,
    allowlisted: true,
    internal: true,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
  });
  const admissionDecision = evaluateCanaryEditAdmission({
    runtimeMode: 'canary',
    projectAuthorization: Object.freeze({ authorized: true, binding }),
    editProfile: classification.editProfile,
    checkpoint,
    rootMutation,
  });
  const grant = Object.freeze({
    schemaVersion: CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
    requestId: request.requestId,
    actionClassification: classification,
    rolloutDecision,
    admissionDecision,
  });
  const actionDigest = digest('f');
  const sourceRootIdentityDigest = digest('d');
  const sourceSnapshot = Object.freeze({
    checkpointDigest: checkpoint.checkpointDigest,
    sourceRootIdentityDigest,
    sourceStateDigest: digest('1'),
    branchHeadDigest: digest('2'),
    gitIndexDigest: digest('3'),
    userDirtyDigest: digest('4'),
  });

  const authorityService = Object.freeze({
    authorizeExecute(input) {
      events.push('authorize_execute');
      assert.deepStrictEqual(input, { binding, action });
      if (asyncExecuteAuthorization) {
        return Promise.reject(new Error('authority must remain synchronous'));
      }
      if (denyExecute) {
        return Object.freeze({ authorized: false, reason: 'lifecycle_inactive' });
      }
      return Object.freeze({
        authorized: true,
        reason: 'authorized',
        binding,
        actionDigest,
      });
    },
    authorizeProjectRootLease(input) {
      events.push('authorize_root');
      assert.deepStrictEqual(input, binding);
      return Object.freeze({
        authorized: true,
        reason: 'authorized',
        binding,
        physicalRootIdentityDigest: sourceRootIdentityDigest,
      });
    },
  });

  const rootBackend = Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    id: 'canary-port-root-backend',
    probe() {
      events.push('root_probe');
      return createProjectRootAuthorityProbeResult({
        state: PROJECT_ROOT_AUTHORITY_STATES.ENFORCED,
        guarantees: PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
      });
    },
    acquire(rootRequest) {
      events.push('root_acquire');
      let closed = false;
      const reader = Object.freeze({
        version: PROJECT_ROOT_READER_VERSION,
        inspectEntry({ relativePath }) {
          assert.strictEqual(closed, false);
          events.push(`root_inspect:${relativePath}`);
          return Object.freeze({
            found: true,
            kind: 'file',
            bytes: 7,
            mode: 0o644,
            mtimeMs: 1,
            contentDigest: digest('8'),
            linkTarget: null,
            entryIdentityDigest: digest('9'),
          });
        },
        list() {
          return Object.freeze({ entries: Object.freeze([]), truncated: false });
        },
        readFile() {
          return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
        },
      });
      return Object.freeze({
        version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
        leaseId: rootRequest.leaseId,
        jobId: rootRequest.binding.jobId,
        projectId: rootRequest.binding.projectId,
        purpose: rootRequest.purpose,
        physicalRootIdentityDigest: rootRequest.expectedPhysicalRootIdentityDigest,
        authorityDigest: rootRequest.authorityDigest,
        reader,
        close() {
          events.push('root_close');
          closed = true;
          return invalidRootClose
            ? Object.freeze({ closed: true })
            : createProjectRootAuthorityCloseReceipt({
              request: rootRequest,
              closed: true,
            });
        },
      });
    },
    dispose() {
      return Object.freeze({ ok: true, disposed: true });
    },
  });
  let rootSerial = 0;
  const projectRootAuthorityRegistry = createProjectRootAuthorityRegistry({
    backend: rootBackend,
    leaseIdFactory: () => `canary-root-lease-${rootSerial += 1}`,
  });

  const workspaceBackend = Object.freeze({
    version: EXECUTION_WORKSPACE_BACKEND_VERSION,
    id: 'canary-port-workspace-backend',
    probe() {
      events.push('workspace_probe');
      return createExecutionWorkspaceProbeResult({
        state: EXECUTION_WORKSPACE_STATES.ENFORCED,
        guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
      });
    },
    acquire(workspaceRequest) {
      events.push('workspace_acquire');
      return createExecutionWorkspaceLease({
        request: workspaceRequest,
        workspaceRootPath: '/workspace/.faber-canary/job-canary-port-a',
        workspaceRealRootPath: '/private/workspace/.faber-canary/job-canary-port-a',
        workspaceRootIdentityDigest: digest('e'),
      });
    },
    discard(workspaceDiscardRequest) {
      events.push('workspace_discard');
      return invalidWorkspaceDiscard
        ? Object.freeze({ discarded: true })
        : createExecutionWorkspaceDiscardReceipt({
          request: workspaceDiscardRequest,
          discarded: true,
        });
    },
    dispose() {
      return Object.freeze({ ok: true, disposed: true });
    },
  });
  let workspaceSerial = 0;
  const executionWorkspaceRegistry = workspaceUnavailable
    ? createExecutionWorkspaceRegistry()
    : createExecutionWorkspaceRegistry({
      backend: workspaceBackend,
      leaseIdFactory: () => `canary-workspace-lease-${workspaceSerial += 1}`,
    });

  const validSnapshot = Object.freeze({ checkpoint, sourceSnapshot, rootMutation });
  const inspect = snapshotMode === 'sync'
    ? function inspectSynchronously() {
      events.push('snapshot');
      return validSnapshot;
    }
    : async function inspectSnapshot(input) {
      events.push('snapshot');
      await input.rootLease.reader.inspectEntry({ relativePath: 'package.json' });
      if (snapshotMode === 'reject') throw new Error('snapshot rejected');
      if (snapshotMode === 'invalid') {
        return Object.freeze({
          checkpoint: Object.freeze({ ...checkpoint, checkpointDigest: digest('0') }),
          sourceSnapshot,
          rootMutation,
        });
      }
      return validSnapshot;
    };
  const sourceSnapshotProvider = Object.freeze({
    version: CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
    inspect,
    diagnostics() {
      return Object.freeze({
        version: CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
        rootReadMode: 'pinned_authority_reader',
        checkpointMode: 'verified',
        mutationObservation: 'exclusive_job',
      });
    },
  });

  const port = createCanaryWorkspaceSessionPortAdapter({
    authorityService,
    projectRootAuthorityRegistry,
    executionWorkspaceRegistry,
    sourceSnapshotProvider,
    promotionIdFactory(input) {
      events.push('promotion_id');
      assert.strictEqual(input.requestId, request.requestId);
      assert.strictEqual(input.jobId, binding.jobId);
      assert.strictEqual(input.actionDigest, actionDigest);
      return 'promotion-canary-workspace-a';
    },
  });

  return {
    action,
    binding,
    checkpoint,
    events,
    executionContext,
    executionWorkspaceRegistry,
    grant,
    port,
    projectInfo,
    projectRootAuthorityRegistry,
    request,
    rootMutation,
    sourceSnapshot,
  };
}

async function main() {
  const fixture = makeFixture();
  assert.deepStrictEqual(Reflect.ownKeys(fixture.port), [
    'version',
    'open',
    'discard',
    'diagnostics',
  ]);
  assert.strictEqual(fixture.port.version, CANARY_WORKSPACE_SESSION_PORT_ADAPTER_VERSION);
  assert.strictEqual(Object.isFrozen(fixture.port), true);
  assert.deepStrictEqual(fixture.port.diagnostics(), {
    version: CANARY_WORKSPACE_SESSION_PORT_ADAPTER_VERSION,
    workspaceIsolation: 'per_job_staging',
    sourceMutation: 'forbidden',
    discardMode: 'verified',
  });

  const opened = await fixture.port.open(fixture.request, fixture.grant);
  assert.strictEqual(opened.schemaVersion, CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION);
  assert.strictEqual(opened.ok, true);
  assert.strictEqual(opened.actionDigest, digest('f'));
  assert.strictEqual(opened.promotionId, 'promotion-canary-workspace-a');
  assert.strictEqual(opened.sourceSnapshot.sourceRootIdentityDigest, digest('d'));
  assert.strictEqual(opened.session.workspaceRootIdentityDigest, digest('e'));
  assert.strictEqual(opened.workspaceRequest.leaseId, opened.session.stagingId);
  assertCanaryStagingSession(opened.session, {
    requestId: fixture.request.requestId,
    checkpoint: opened.checkpoint,
    workspaceRequest: opened.workspaceRequest,
  });
  assertDeepFrozen(opened);
  assert.deepStrictEqual(fixture.events, [
    'authorize_execute',
    'authorize_root',
    'promotion_id',
    'root_probe',
    'root_acquire',
    'workspace_probe',
    'workspace_acquire',
    'snapshot',
    'root_inspect:package.json',
  ]);
  assert.strictEqual(fixture.projectRootAuthorityRegistry.diagnostics().active, 1);
  assert.strictEqual(fixture.executionWorkspaceRegistry.diagnostics().active, 1);

  assert.strictEqual(
    await fixture.port.open(fixture.request, fixture.grant),
    opened,
    'an exact duplicate open must reuse its authenticated outcome'
  );
  assert.strictEqual(fixture.events.filter((entry) => entry === 'root_acquire').length, 1);
  assert.strictEqual(fixture.events.filter((entry) => entry === 'workspace_acquire').length, 1);

  const mismatchedRequest = createExecuteRequest(
    fixture.action,
    fixture.projectInfo,
    {
      requestId: 'canary-workspace-port-mismatch',
      executionContext: fixture.executionContext,
    }
  );
  const mismatchedGrant = Object.freeze({
    ...fixture.grant,
    requestId: mismatchedRequest.requestId,
  });
  await assert.rejects(
    fixture.port.open(mismatchedRequest, mismatchedGrant),
    (error) => error.code
      === CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.SESSION_MISMATCH
  );
  await assert.rejects(
    fixture.port.discard(Object.freeze({
      ...opened.session,
      requestId: 'forged-request',
    })),
    (error) => error.code
      === CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.SESSION_MISMATCH
  );
  assert.strictEqual(fixture.executionWorkspaceRegistry.diagnostics().active, 1);

  const discarded = await fixture.port.discard(opened.session);
  assertCanaryStagingDiscardReceipt(discarded.receipt, {
    session: opened.session,
    workspaceDiscardRequest: discarded.workspaceDiscardRequest,
  });
  assert.strictEqual(discarded.receipt.clean, true);
  assert.strictEqual(discarded.receipt.disposition, 'discarded');
  assertDeepFrozen(discarded);
  assert.deepStrictEqual(fixture.events.slice(-2), [
    'workspace_discard',
    'root_close',
  ]);
  assert.strictEqual(fixture.projectRootAuthorityRegistry.diagnostics().active, 0);
  assert.strictEqual(fixture.executionWorkspaceRegistry.diagnostics().discarded, 1);
  assert.strictEqual(await fixture.port.discard(opened.session), discarded);
  await assert.rejects(
    fixture.port.open(fixture.request, fixture.grant),
    (error) => error.code
      === CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.SESSION_MISMATCH
  );

  const nativeSignalFixture = makeFixture();
  const nativeExecutionContext = {
    jobId: nativeSignalFixture.binding.jobId,
    requestedMode: 'delegate_task',
    signal: new AbortController().signal,
  };
  Object.defineProperty(nativeExecutionContext, 'authorityBinding', {
    configurable: false,
    enumerable: false,
    value: nativeSignalFixture.binding,
    writable: false,
  });
  Object.freeze(nativeExecutionContext);
  const nativeSignalRequest = createExecuteRequest(
    nativeSignalFixture.action,
    nativeSignalFixture.projectInfo,
    {
      requestId: nativeSignalFixture.request.requestId,
      executionContext: nativeExecutionContext,
    }
  );
  const nativeSignalOpened = await nativeSignalFixture.port.open(
    nativeSignalRequest,
    nativeSignalFixture.grant
  );
  assert.strictEqual(nativeSignalOpened.ok, true);
  await nativeSignalFixture.port.discard(nativeSignalOpened.session);

  const mutableActionFixture = makeFixture({ mutableAction: true });
  assert.strictEqual(Object.isFrozen(mutableActionFixture.action), false);
  const mutableActionOpened = await mutableActionFixture.port.open(
    mutableActionFixture.request,
    mutableActionFixture.grant
  );
  assert.strictEqual(mutableActionOpened.ok, true);
  assert.strictEqual(Object.isFrozen(mutableActionFixture.action), true);
  await mutableActionFixture.port.discard(mutableActionOpened.session);

  const denied = makeFixture({ denyExecute: true });
  await assert.rejects(
    denied.port.open(denied.request, denied.grant),
    (error) => error.code
      === CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.AUTHORITY_DENIED
  );
  assert.deepStrictEqual(denied.events, ['authorize_execute']);
  assert.strictEqual(denied.projectRootAuthorityRegistry.diagnostics().active, 0);

  const asyncAuthority = makeFixture({ asyncExecuteAuthorization: true });
  await assert.rejects(
    asyncAuthority.port.open(asyncAuthority.request, asyncAuthority.grant),
    (error) => error.code
      === CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.AUTHORITY_DENIED
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(asyncAuthority.events, ['authorize_execute']);

  const unavailable = makeFixture({ workspaceUnavailable: true });
  await assert.rejects(
    unavailable.port.open(unavailable.request, unavailable.grant),
    (error) => error.code
      === CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.WORKSPACE_UNAVAILABLE
  );
  assert.deepStrictEqual(unavailable.events.slice(-2), ['root_acquire', 'root_close']);
  assert.strictEqual(unavailable.projectRootAuthorityRegistry.diagnostics().active, 0);

  for (const snapshotMode of ['invalid', 'reject', 'sync']) {
    const invalidSnapshot = makeFixture({ snapshotMode });
    await assert.rejects(
      invalidSnapshot.port.open(invalidSnapshot.request, invalidSnapshot.grant),
      (error) => error.code
        === CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.SNAPSHOT_INVALID
    );
    assert.deepStrictEqual(invalidSnapshot.events.slice(-2), [
      'workspace_discard',
      'root_close',
    ]);
    assert.strictEqual(invalidSnapshot.executionWorkspaceRegistry.diagnostics().discarded, 1);
    assert.strictEqual(invalidSnapshot.projectRootAuthorityRegistry.diagnostics().active, 0);
  }

  const failedOpenCleanup = makeFixture({
    snapshotMode: 'invalid',
    invalidWorkspaceDiscard: true,
  });
  await assert.rejects(
    failedOpenCleanup.port.open(
      failedOpenCleanup.request,
      failedOpenCleanup.grant
    ),
    (error) => error.code
      === CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.CLEANUP_FAILED
  );
  assert.strictEqual(failedOpenCleanup.executionWorkspaceRegistry.diagnostics().quarantined, 1);
  assert.ok(failedOpenCleanup.events.includes('root_close'));
  await assert.rejects(
    failedOpenCleanup.port.open(
      failedOpenCleanup.request,
      failedOpenCleanup.grant
    ),
    (error) => error.code
      === CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.QUARANTINED
  );

  const failedDiscardCleanup = makeFixture({ invalidRootClose: true });
  const cleanupOpened = await failedDiscardCleanup.port.open(
    failedDiscardCleanup.request,
    failedDiscardCleanup.grant
  );
  await assert.rejects(
    failedDiscardCleanup.port.discard(cleanupOpened.session),
    (error) => error.code
      === CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.CLEANUP_FAILED
  );
  assert.strictEqual(failedDiscardCleanup.executionWorkspaceRegistry.diagnostics().discarded, 1);
  assert.strictEqual(failedDiscardCleanup.projectRootAuthorityRegistry.diagnostics().quarantined, 1);

  let authorityGetterReads = 0;
  const hostileAuthority = {};
  Object.defineProperty(hostileAuthority, 'authorizeExecute', {
    enumerable: true,
    get() {
      authorityGetterReads += 1;
      throw new Error('must not execute');
    },
  });
  Object.defineProperty(hostileAuthority, 'authorizeProjectRootLease', {
    enumerable: true,
    value() {},
  });
  Object.freeze(hostileAuthority);
  assert.throws(
    () => createCanaryWorkspaceSessionPortAdapter({
      authorityService: hostileAuthority,
      projectRootAuthorityRegistry: fixture.projectRootAuthorityRegistry,
      executionWorkspaceRegistry: fixture.executionWorkspaceRegistry,
      sourceSnapshotProvider: Object.freeze({
        version: CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
        inspect: async () => ({}),
        diagnostics: () => Object.freeze({
          version: CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
          rootReadMode: 'pinned_authority_reader',
          checkpointMode: 'verified',
          mutationObservation: 'exclusive_job',
        }),
      }),
      promotionIdFactory: () => 'promotion-hostile',
    }),
    /authorityService|options/i
  );
  assert.strictEqual(authorityGetterReads, 0);

  const hostileRequestFixture = makeFixture();
  let actionGetterReads = 0;
  const hostileRequest = {};
  for (const [key, value] of Object.entries(hostileRequestFixture.request)) {
    if (key !== 'action') hostileRequest[key] = value;
  }
  Object.defineProperty(hostileRequest, 'action', {
    enumerable: true,
    get() {
      actionGetterReads += 1;
      throw new Error('must not execute');
    },
  });
  Object.freeze(hostileRequest);
  await assert.rejects(
    hostileRequestFixture.port.open(hostileRequest, hostileRequestFixture.grant),
    (error) => error.code
      === CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.INVALID_INPUT
  );
  assert.strictEqual(actionGetterReads, 0);

  assert.strictEqual(HARNESS_OPERATIONS.EXECUTE, 'execute');
  assert.strictEqual(CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION, 'canary-source-snapshot-provider.v1');
  assert.strictEqual(
    CANARY_WORKSPACE_SESSION_PORT_ADAPTER_VERSION,
    'canary-workspace-session-port-adapter.v1'
  );
  console.log('canary-workspace-session-port-adapter.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
