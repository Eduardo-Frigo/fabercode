'use strict';

const assert = require('assert');

const {
  EXECUTION_WORKSPACE_ACQUIRE_REQUEST_VERSION,
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  EXECUTION_WORKSPACE_DISCARD_RECEIPT_VERSION,
  EXECUTION_WORKSPACE_DISCARD_REQUEST_VERSION,
  EXECUTION_WORKSPACE_GUARANTEES,
  EXECUTION_WORKSPACE_LEASE_VERSION,
  EXECUTION_WORKSPACE_PROBE_VERSION,
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  EXECUTION_WORKSPACE_STATES,
  ExecutionWorkspaceUnavailableError,
  assertExecutionWorkspaceBackend,
  assertExecutionWorkspaceDiscardReceipt,
  assertExecutionWorkspaceLease,
  assertExecutionWorkspaceProbeResult,
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceDiscardRequest,
  createExecutionWorkspaceLease,
  createExecutionWorkspaceProbeResult,
  createUnsupportedExecutionWorkspaceBackend,
} = require('../main/capabilities/execution_workspace_contract');

const digest = (character) => `sha256:${character.repeat(64)}`;

function binding(overrides = {}) {
  return {
    projectId: 'project-a',
    canonicalRootPath: '/workspace/source-a',
    realRootPath: '/private/workspace/source-a',
    sessionId: 'session-a',
    jobId: 'job-a',
    kernelId: 'legacy',
    submissionDigest: digest('a'),
    ...overrides,
  };
}

function acquireRequest(overrides = {}) {
  return createExecutionWorkspaceAcquireRequest({
    leaseId: 'workspace-lease-a',
    binding: binding(),
    sourceRootIdentityDigest: digest('b'),
    ...overrides,
  });
}

assert.strictEqual(EXECUTION_WORKSPACE_BACKEND_VERSION, 'execution-workspace-backend.v1');
assert.strictEqual(EXECUTION_WORKSPACE_PROBE_VERSION, 'execution-workspace-probe.v1');
assert.strictEqual(EXECUTION_WORKSPACE_ACQUIRE_REQUEST_VERSION, 'execution-workspace-acquire-request.v1');
assert.strictEqual(EXECUTION_WORKSPACE_LEASE_VERSION, 'execution-workspace-lease.v1');
assert.strictEqual(EXECUTION_WORKSPACE_DISCARD_REQUEST_VERSION, 'execution-workspace-discard-request.v1');
assert.strictEqual(EXECUTION_WORKSPACE_DISCARD_RECEIPT_VERSION, 'execution-workspace-discard-receipt.v1');
assert.deepStrictEqual(EXECUTION_WORKSPACE_REQUIRED_GUARANTEES, [
  EXECUTION_WORKSPACE_GUARANTEES.EXCLUSIVE_SOURCE_BINDING,
  EXECUTION_WORKSPACE_GUARANTEES.PRIVATE_WORKSPACE_ROOT,
  EXECUTION_WORKSPACE_GUARANTEES.SOURCE_ROOT_NOT_MUTATED,
  EXECUTION_WORKSPACE_GUARANTEES.ROLLBACK_BY_DISCARD,
  EXECUTION_WORKSPACE_GUARANTEES.PHYSICAL_SOURCE_IDENTITY,
  EXECUTION_WORKSPACE_GUARANTEES.PHYSICAL_WORKSPACE_IDENTITY,
]);

const request = acquireRequest();
assert.deepStrictEqual(Reflect.ownKeys(request), [
  'version',
  'leaseId',
  'binding',
  'sourceRootIdentityDigest',
  'workspaceAuthorityDigest',
]);
assert.strictEqual(request.version, EXECUTION_WORKSPACE_ACQUIRE_REQUEST_VERSION);
assert.strictEqual(request.binding.jobId, 'job-a');
assert.match(request.workspaceAuthorityDigest, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(Object.isFrozen(request), true);
assert.strictEqual(Object.isFrozen(request.binding), true);
assert.deepStrictEqual(acquireRequest().workspaceAuthorityDigest, request.workspaceAuthorityDigest);
assert.notStrictEqual(
  acquireRequest({ leaseId: 'workspace-lease-b' }).workspaceAuthorityDigest,
  request.workspaceAuthorityDigest
);

const enforcedProbe = createExecutionWorkspaceProbeResult({
  state: EXECUTION_WORKSPACE_STATES.ENFORCED,
  guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
});
assert.deepStrictEqual(Reflect.ownKeys(enforcedProbe), ['version', 'state', 'guarantees', 'reasonCode']);
assert.strictEqual(enforcedProbe.version, EXECUTION_WORKSPACE_PROBE_VERSION);
assert.strictEqual(enforcedProbe.state, 'enforced');
assert.strictEqual(enforcedProbe.reasonCode, null);
assert.strictEqual(Object.isFrozen(enforcedProbe.guarantees), true);
assert.throws(() => createExecutionWorkspaceProbeResult({
  state: EXECUTION_WORKSPACE_STATES.UNAVAILABLE,
  guarantees: [],
}), /reasonCode/);
assert.throws(() => createExecutionWorkspaceProbeResult({
  state: EXECUTION_WORKSPACE_STATES.ENFORCED,
  guarantees: ['invented'],
}), /guarantee/);
assert.throws(() => createExecutionWorkspaceProbeResult({
  state: EXECUTION_WORKSPACE_STATES.ENFORCED,
  guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES.slice(0, -1),
}), /required guarantee/);
assert.throws(() => createExecutionWorkspaceProbeResult({
  state: EXECUTION_WORKSPACE_STATES.ENFORCED,
  guarantees: [
    ...EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
    EXECUTION_WORKSPACE_REQUIRED_GUARANTEES[0],
  ],
}), /duplicate guarantee/);
const mutableProbe = {
  ...enforcedProbe,
  guarantees: [...enforcedProbe.guarantees],
};
const normalizedMutableProbe = assertExecutionWorkspaceProbeResult(mutableProbe);
assert.notStrictEqual(normalizedMutableProbe, mutableProbe);
assert.strictEqual(Object.isFrozen(normalizedMutableProbe), true);
mutableProbe.state = EXECUTION_WORKSPACE_STATES.UNAVAILABLE;
assert.strictEqual(normalizedMutableProbe.state, EXECUTION_WORKSPACE_STATES.ENFORCED);

const lease = createExecutionWorkspaceLease({
  request,
  workspaceRootPath: '/workspace/faber-jobs/job-a',
  workspaceRealRootPath: '/private/workspace/faber-jobs/job-a',
  workspaceRootIdentityDigest: digest('c'),
});
assert.deepStrictEqual(Reflect.ownKeys(lease), [
  'version',
  'leaseId',
  'jobId',
  'sourceRootIdentityDigest',
  'workspaceAuthorityDigest',
  'workspaceRootIdentityDigest',
  'workspaceRootPath',
  'workspaceRealRootPath',
]);
assert.deepStrictEqual(assertExecutionWorkspaceLease(lease, request), lease);
assert.strictEqual(Object.isFrozen(lease), true);

for (const invalidLease of [
  { workspaceRootIdentityDigest: request.sourceRootIdentityDigest },
  { workspaceRootPath: request.binding.canonicalRootPath },
  { workspaceRootPath: `${request.binding.canonicalRootPath}/nested` },
  { workspaceRootPath: '/workspace' },
  { workspaceRootPath: `${request.binding.realRootPath}/nested` },
  { workspaceRealRootPath: request.binding.realRootPath },
  { workspaceRealRootPath: `${request.binding.realRootPath}/nested` },
  { workspaceRealRootPath: '/private/workspace' },
  { workspaceRealRootPath: `${request.binding.canonicalRootPath}/nested` },
  { workspaceRootPath: 'C:\\faber\\job-a' },
  { workspaceRootPath: `/${'w'.repeat(5000)}` },
  { leaseId: 'workspace-lease-forged' },
  { jobId: 'job-forged' },
  { workspaceAuthorityDigest: digest('d') },
  { extra: true },
]) {
  assert.throws(() => createExecutionWorkspaceLease({
    request,
    workspaceRootPath: '/workspace/faber-jobs/job-a',
    workspaceRealRootPath: '/private/workspace/faber-jobs/job-a',
    workspaceRootIdentityDigest: digest('c'),
    ...invalidLease,
  }), /workspace lease/i);
}
const mutableLease = { ...lease };
const normalizedMutableLease = assertExecutionWorkspaceLease(mutableLease, request);
assert.notStrictEqual(normalizedMutableLease, mutableLease);
assert.strictEqual(Object.isFrozen(normalizedMutableLease), true);
mutableLease.workspaceRootPath = '/workspace/forged-after-validation';
assert.strictEqual(normalizedMutableLease.workspaceRootPath, '/workspace/faber-jobs/job-a');

const windowsRequest = createExecutionWorkspaceAcquireRequest({
  leaseId: 'workspace-lease-windows',
  binding: binding({
    canonicalRootPath: 'C:\\Source\\Project',
    realRootPath: 'C:\\Real\\Project',
    jobId: 'job-windows',
  }),
  sourceRootIdentityDigest: digest('d'),
});
assert.throws(() => createExecutionWorkspaceLease({
  request: windowsRequest,
  workspaceRootPath: 'c:\\source\\project\\nested',
  workspaceRealRootPath: 'C:\\Other\\Workspace',
  workspaceRootIdentityDigest: digest('e'),
}), /workspace lease/i);

const discardRequest = createExecutionWorkspaceDiscardRequest({ request, lease });
assert.deepStrictEqual(Reflect.ownKeys(discardRequest), [
  'version',
  'leaseId',
  'jobId',
  'sourceRootIdentityDigest',
  'workspaceAuthorityDigest',
  'workspaceRootIdentityDigest',
]);
const discardReceipt = createExecutionWorkspaceDiscardReceipt({
  request: discardRequest,
  discarded: true,
});
assert.deepStrictEqual(Reflect.ownKeys(discardReceipt), [
  'version',
  'leaseId',
  'workspaceAuthorityDigest',
  'workspaceRootIdentityDigest',
  'discarded',
]);
assert.strictEqual(discardReceipt.discarded, true);
const mutableReceipt = { ...discardReceipt };
const normalizedMutableReceipt = assertExecutionWorkspaceDiscardReceipt(mutableReceipt, discardRequest);
assert.notStrictEqual(normalizedMutableReceipt, mutableReceipt);
assert.strictEqual(Object.isFrozen(normalizedMutableReceipt), true);
mutableReceipt.discarded = false;
assert.strictEqual(normalizedMutableReceipt.discarded, true);
assert.throws(() => createExecutionWorkspaceDiscardReceipt({
  request: discardRequest,
  discarded: false,
}), /discard receipt/i);

const backend = Object.freeze({
  version: EXECUTION_WORKSPACE_BACKEND_VERSION,
  id: 'mock-workspace-backend',
  probe() { return enforcedProbe; },
  acquire() { return lease; },
  discard() { return discardReceipt; },
  dispose() { return undefined; },
});
const normalizedBackend = assertExecutionWorkspaceBackend(backend);
assert.notStrictEqual(normalizedBackend, backend);
assert.deepStrictEqual(normalizedBackend, backend);
assert.strictEqual(Object.isFrozen(normalizedBackend), true);
assert.throws(() => assertExecutionWorkspaceBackend({ ...backend, extra: true }), /backend/);
assert.throws(() => assertExecutionWorkspaceBackend(new Proxy(backend, {})), /backend/);

const hostileAccessor = {};
Object.defineProperty(hostileAccessor, 'binding', {
  enumerable: true,
  get() { throw new Error('must not execute'); },
});
assert.throws(() => createExecutionWorkspaceAcquireRequest(hostileAccessor), /data|request/i);
assert.throws(() => createExecutionWorkspaceAcquireRequest({
  leaseId: 'workspace-lease-symbol',
  binding: binding(),
  sourceRootIdentityDigest: digest('b'),
  [Symbol('secret')]: true,
}), /data|request/i);
assert.throws(() => createExecutionWorkspaceAcquireRequest(new Proxy({
  leaseId: 'workspace-lease-proxy',
  binding: binding(),
  sourceRootIdentityDigest: digest('b'),
}, {})), /data|request/i);

async function main() {
  const overDepthInput = {};
  let overDepthCursor = overDepthInput;
  for (let depth = 0; depth < 70; depth += 1) {
    overDepthCursor.next = {};
    overDepthCursor = overDepthCursor.next;
  }
  overDepthCursor.first = Promise.reject(new Error('deep first must be absorbed'));
  overDepthCursor.second = Promise.reject(new Error('deep second must be absorbed'));
  assert.throws(
    () => createExecutionWorkspaceAcquireRequest(overDepthInput),
    /data|request/i
  );
  await new Promise((resolve) => setImmediate(resolve));

  const unsupported = createUnsupportedExecutionWorkspaceBackend({
    id: 'unsupported-workspace-test',
    reasonCode: 'WORKSPACE_PROVIDER_UNAVAILABLE',
  });
  const normalizedUnsupported = assertExecutionWorkspaceBackend(unsupported);
  assert.notStrictEqual(normalizedUnsupported, unsupported);
  assert.deepStrictEqual(normalizedUnsupported, unsupported);
  assert.strictEqual(Object.isFrozen(normalizedUnsupported), true);
  assert.strictEqual(unsupported.probe().state, EXECUTION_WORKSPACE_STATES.UNAVAILABLE);
  const rejectedInput = Promise.reject(new Error('must be absorbed'));
  assert.throws(
    () => unsupported.acquire(rejectedInput),
    (error) => error instanceof ExecutionWorkspaceUnavailableError
      && error.code === 'WORKSPACE_UNAVAILABLE'
  );
  const nestedRejected = Promise.reject(new Error('nested must be absorbed'));
  assert.throws(
    () => unsupported.discard({ nestedRejected }),
    (error) => error instanceof ExecutionWorkspaceUnavailableError
  );
  await new Promise((resolve) => setImmediate(resolve));
  const rejectedOptions = Promise.reject(new Error('options must be absorbed'));
  assert.throws(
    () => createUnsupportedExecutionWorkspaceBackend(rejectedOptions),
    /configuration|options|data/i
  );
  let unsupportedGetterCalls = 0;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'id', {
    enumerable: true,
    get() {
      unsupportedGetterCalls += 1;
      return 'forged';
    },
  });
  assert.throws(() => createUnsupportedExecutionWorkspaceBackend(accessorOptions), /configuration|options|data/i);
  assert.strictEqual(unsupportedGetterCalls, 0);
  assert.throws(
    () => createUnsupportedExecutionWorkspaceBackend(new Proxy({}, {})),
    /configuration|options|data/i
  );
  const poisonedMethod = function poisonedMethod() {};
  poisonedMethod.hidden = Promise.reject(new Error('method property must be absorbed'));
  assert.throws(() => assertExecutionWorkspaceBackend(Object.freeze({
    version: EXECUTION_WORKSPACE_BACKEND_VERSION,
    id: 'poisoned-method-backend',
    probe: poisonedMethod,
    acquire() {},
    discard() {},
    dispose() {},
  })), /backend/);
  const nestedPoisonedMethod = function nestedPoisonedMethod() {};
  Object.defineProperty(nestedPoisonedMethod, 'hidden', {
    value: { nested: Promise.reject(new Error('nested method property must be absorbed')) },
  });
  assert.throws(() => assertExecutionWorkspaceBackend(Object.freeze({
    version: EXECUTION_WORKSPACE_BACKEND_VERSION,
    id: 'nested-poisoned-method-backend',
    probe: nestedPoisonedMethod,
    acquire() {},
    discard() {},
    dispose() {},
  })), /backend/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(unsupported.dispose(), { ok: true, disposed: true });
  console.log('execution workspace contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
