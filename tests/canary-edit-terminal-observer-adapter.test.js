'use strict';

const assert = require('assert');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  HARNESS_OPERATIONS,
  createExecuteRequest,
  createHarnessResult,
} = require('../main/agent_runtime/harness_contracts');
const {
  CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS,
  CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_VERSION,
  createCanaryEditTerminalObserverAdapter,
} = require('../main/services/canary_edit_terminal_observer_adapter');

const AUTHORITATIVE_KERNEL_ID = 'legacy';
const CANARY_KERNEL_ID = 'codex-app-server-canary';
const RUNNER_VERSION = 'canary-edit-runner.v1';

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

function createRequest({
  jobId = 'canary-terminal-job-1',
  projectId = 'canary-terminal-project-1',
  requestId = 'canary-terminal-request-1',
  includeAuthority = true,
} = {}) {
  const rootPath = '/workspace/canary-terminal-project';
  const executionContext = { jobId };
  if (includeAuthority) {
    const binding = createCapabilityDelegationBinding({
      projectId,
      canonicalRootPath: rootPath,
      realRootPath: rootPath,
      sessionId: 'canary-terminal-session-1',
      jobId,
      kernelId: CANARY_KERNEL_ID,
      submissionDigest: `sha256:${'a'.repeat(64)}`,
    });
    Object.defineProperty(executionContext, 'authorityBinding', {
      configurable: false,
      enumerable: false,
      value: binding,
      writable: false,
    });
  }
  Object.freeze(executionContext);
  return createExecuteRequest(
    deepFreeze({
      type: 'apply_file_patch',
      targetFile: 'src/app.js',
      previousContentHash: `sha256:${'b'.repeat(64)}`,
      nextContent: 'module.exports = true;\n',
    }),
    deepFreeze({ id: projectId, projectId, rootPath }),
    { requestId, executionContext }
  );
}

function canaryResult(request, output = null) {
  const resolvedOutput = output || deepFreeze({
    status: 'completed',
    mutationScope: 'staging',
    changedPaths: ['src/app.js'],
    writeSetDigest: `sha256:${'c'.repeat(64)}`,
  });
  return createHarnessResult({
    requestId: request.requestId,
    operation: HARNESS_OPERATIONS.EXECUTE,
    kernelId: CANARY_KERNEL_ID,
    output: resolvedOutput,
    diagnostics: null,
  });
}

function legacyResult(request) {
  return createHarnessResult({
    requestId: request.requestId,
    operation: HARNESS_OPERATIONS.EXECUTE,
    kernelId: AUTHORITATIVE_KERNEL_ID,
    output: deepFreeze({ ok: true, engine: 'legacy' }),
    diagnostics: null,
  });
}

function createRunner(executeFactory) {
  const calls = [];
  const runner = Object.freeze({
    version: RUNNER_VERSION,
    execute(request) {
      calls.push(request);
      return executeFactory(request);
    },
    diagnostics() {
      return Object.freeze({
        version: RUNNER_VERSION,
        authoritativeKernelId: AUTHORITATIVE_KERNEL_ID,
        canaryKernelId: CANARY_KERNEL_ID,
        requests: calls.length,
      });
    },
  });
  return { calls, runner };
}

function createAdapter(runner, {
  onCanaryCompleted = () => Object.freeze({ ok: true }),
  onCanaryFailed = () => Object.freeze({ ok: true }),
} = {}) {
  return createCanaryEditTerminalObserverAdapter({
    runner,
    onCanaryCompleted,
    onCanaryFailed,
  });
}

async function testCanaryCompletionIsPersistedFromExactSafeOutcome() {
  const request = createRequest();
  const result = canaryResult(request);
  const fake = createRunner(() => Promise.resolve(result));
  const completed = [];
  const failed = [];
  const adapter = createAdapter(fake.runner, {
    onCanaryCompleted(observation) {
      completed.push(observation);
      return Object.freeze({ ok: true });
    },
    onCanaryFailed(observation) {
      failed.push(observation);
      return Object.freeze({ ok: true });
    },
  });

  assert.strictEqual(
    CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_VERSION,
    'canary-edit-terminal-observer-adapter.v1'
  );
  assert.deepStrictEqual(Reflect.ownKeys(adapter), [
    'version',
    'canaryEditRunner',
    'diagnostics',
  ]);
  assert.deepStrictEqual(Reflect.ownKeys(adapter.canaryEditRunner), [
    'version',
    'execute',
    'diagnostics',
  ]);
  assert.strictEqual(Object.isFrozen(adapter), true);
  assert.strictEqual(Object.isFrozen(adapter.canaryEditRunner), true);
  assert.strictEqual(adapter.canaryEditRunner.version, RUNNER_VERSION);

  const observedResult = await adapter.canaryEditRunner.execute(request);
  assert.strictEqual(observedResult, result);
  assert.deepStrictEqual(fake.calls, [request]);
  assert.strictEqual(completed.length, 1);
  assert.deepStrictEqual(completed[0], {
    jobId: 'canary-terminal-job-1',
    projectId: 'canary-terminal-project-1',
    requestId: 'canary-terminal-request-1',
    changedPaths: ['src/app.js'],
    writeSetDigest: `sha256:${'c'.repeat(64)}`,
  });
  assertDeepFrozen(completed[0]);
  assert.strictEqual(failed.length, 0);
  assert.deepStrictEqual(adapter.diagnostics(), {
    version: CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_VERSION,
    runnerVersion: RUNNER_VERSION,
    authoritativeKernelId: AUTHORITATIVE_KERNEL_ID,
    canaryKernelId: CANARY_KERNEL_ID,
    requests: 1,
    canaryCompletions: 1,
    canaryFailures: 0,
    legacyFallbacks: 0,
    observationFailures: 0,
    lastObservationFailureCode: null,
  });
  assertDeepFrozen(adapter.diagnostics());
}

async function testAuthoritativeFallbackNeverDuplicatesLegacyTerminalization() {
  const request = createRequest({ requestId: 'canary-terminal-fallback-1' });
  const result = legacyResult(request);
  const fake = createRunner(() => Promise.resolve(result));
  let terminalCalls = 0;
  const adapter = createAdapter(fake.runner, {
    onCanaryCompleted() {
      terminalCalls += 1;
    },
    onCanaryFailed() {
      terminalCalls += 1;
    },
  });

  assert.strictEqual(await adapter.canaryEditRunner.execute(request), result);
  assert.strictEqual(terminalCalls, 0);
  const diagnostics = adapter.diagnostics();
  assert.strictEqual(diagnostics.legacyFallbacks, 1);
  assert.strictEqual(diagnostics.canaryCompletions, 0);
  assert.strictEqual(diagnostics.canaryFailures, 0);
}

async function testRunnerFailureUsesOnlySanitizedBoundIdentity() {
  const request = createRequest({ requestId: 'canary-terminal-rejection-1' });
  const privateFailure = new Error(
    'private failure at /workspace/canary-terminal-project/src/app.js'
  );
  privateFailure.code = 'CANARY_EDIT_RUNNER_CANARY_EXECUTION_FAILED';
  const fake = createRunner(() => Promise.reject(privateFailure));
  const failed = [];
  const adapter = createAdapter(fake.runner, {
    onCanaryFailed(observation) {
      failed.push(observation);
      return Object.freeze({ ok: true });
    },
  });

  await assert.rejects(
    adapter.canaryEditRunner.execute(request),
    (error) => error === privateFailure
  );
  assert.deepStrictEqual(failed, [deepFreeze({
    jobId: 'canary-terminal-job-1',
    projectId: 'canary-terminal-project-1',
    requestId: 'canary-terminal-rejection-1',
    reason: 'CANARY_EDIT_RUNNER_CANARY_EXECUTION_FAILED',
  })]);
  assert.doesNotMatch(JSON.stringify(failed), /private failure|workspace/);
  assert.strictEqual(adapter.diagnostics().canaryFailures, 1);

  const unboundRequest = createRequest({
    requestId: 'canary-terminal-unbound-1',
    includeAuthority: false,
  });
  await assert.rejects(
    adapter.canaryEditRunner.execute(unboundRequest),
    (error) => error === privateFailure
  );
  assert.strictEqual(failed.length, 1);
}

async function testObserverFailureCannotRewritePromotedCanarySuccess() {
  const request = createRequest({ requestId: 'canary-terminal-callback-1' });
  const result = canaryResult(request);
  const fake = createRunner(() => Promise.resolve(result));
  const adapter = createAdapter(fake.runner, {
    onCanaryCompleted() {
      throw new Error('private persistence failure');
    },
  });

  assert.strictEqual(await adapter.canaryEditRunner.execute(request), result);
  assert.strictEqual(adapter.diagnostics().canaryCompletions, 1);
  assert.strictEqual(adapter.diagnostics().observationFailures, 1);
  assert.strictEqual(
    adapter.diagnostics().lastObservationFailureCode,
    CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS.COMPLETION_CALLBACK_FAILED
  );
  assert.doesNotMatch(
    JSON.stringify(adapter.diagnostics()),
    /private persistence failure/
  );
}

async function testMalformedCanaryOutcomeFailsClosedAndMarksTheBoundJob() {
  const request = createRequest({ requestId: 'canary-terminal-malformed-1' });
  const malformed = canaryResult(request, deepFreeze({
    status: 'completed',
    mutationScope: 'source',
    changedPaths: ['/private/project/src/app.js'],
    writeSetDigest: `sha256:${'d'.repeat(64)}`,
  }));
  const fake = createRunner(() => Promise.resolve(malformed));
  const failed = [];
  const adapter = createAdapter(fake.runner, {
    onCanaryFailed(observation) {
      failed.push(observation);
      return Object.freeze({ ok: true });
    },
  });

  await assert.rejects(
    adapter.canaryEditRunner.execute(request),
    (error) => error && error.code
      === CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS.INVALID_RESULT
  );
  assert.strictEqual(failed.length, 1);
  assert.strictEqual(
    failed[0].reason,
    CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS.INVALID_RESULT
  );
  assert.doesNotMatch(JSON.stringify(failed), /\/private\/project/);
}

function testInvalidAndHostileDependenciesAreRejectedWithoutGetters() {
  assert.throws(
    () => createCanaryEditTerminalObserverAdapter({}),
    /terminal observer options/i
  );
  const request = createRequest();
  const fake = createRunner(() => Promise.resolve(canaryResult(request)));
  assert.throws(
    () => createCanaryEditTerminalObserverAdapter({
      runner: fake.runner,
      onCanaryCompleted() {},
      onCanaryFailed() {},
      unexpected: true,
    }),
    /terminal observer options/i
  );
  let traps = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'runner', {
    enumerable: true,
    get() {
      traps += 1;
      throw new Error('must not execute');
    },
  });
  assert.throws(
    () => createCanaryEditTerminalObserverAdapter(hostile),
    /terminal observer options/i
  );
  assert.strictEqual(traps, 0);
}

async function main() {
  await testCanaryCompletionIsPersistedFromExactSafeOutcome();
  await testAuthoritativeFallbackNeverDuplicatesLegacyTerminalization();
  await testRunnerFailureUsesOnlySanitizedBoundIdentity();
  await testObserverFailureCannotRewritePromotedCanarySuccess();
  await testMalformedCanaryOutcomeFailsClosedAndMarksTheBoundJob();
  testInvalidAndHostileDependenciesAreRejectedWithoutGetters();
  console.log('canary-edit-terminal-observer-adapter.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
