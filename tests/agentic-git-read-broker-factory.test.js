'use strict';

const assert = require('assert');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  SANDBOX_A1_REQUIRED_FEATURES,
  SANDBOX_BACKEND_SCHEMA_VERSION,
  SANDBOX_BACKEND_SECURITY_MODEL,
  createSandboxProbeResult,
} = require('../main/capabilities/sandbox_backend_contract');
const {
  createSandboxBackendRegistry,
} = require('../main/capabilities/sandbox_backend_registry');
const {
  AGENTIC_GIT_READ_BROKER_FACTORY_VERSION,
  AGENTIC_GIT_READ_DESCRIPTOR_VERSION,
  AGENTIC_GIT_READ_ROUTE_VERSION,
  createAgenticGitReadBrokerFactory,
} = require('../main/services/agentic_git_read_broker_factory');

const binding = createCapabilityDelegationBinding({
  projectId: 'project-a',
  canonicalRootPath: '/projects/a',
  realRootPath: '/private/projects/a',
  sessionId: 'session-a',
  jobId: 'job-a',
  kernelId: 'kernel-a',
  submissionDigest: `sha256:${'a'.repeat(64)}`,
});

const STATUS_TEXT = [
  '## main...origin/main [ahead 2, behind 1]',
  'M  src/app.js',
  ' M README.md',
  '?? notes.txt',
  '?? conteúdo/ação.js',
  'UU conflict.txt',
  '',
].join('\n');

function frozenSnapshot({
  executionId,
  status,
  revision,
  outputCursor,
  exitCode = status === 'succeeded' ? 0 : null,
  signal = null,
  timedOut = false,
  stopped = false,
}) {
  return Object.freeze({
    executionId,
    status,
    revision,
    exitCode,
    signal,
    timedOut,
    stopped,
    availableFromCursor: 0,
    outputCursor,
  });
}

function createHarness() {
  const state = {
    active: true,
    backendExecutions: 0,
    executorCalls: [],
    readCalls: [],
    waitCalls: [],
    stopCalls: [],
    lifecycleChecks: 0,
    rootChecks: 0,
    effectChecks: 0,
    audits: [],
    requestIds: 0,
    stdout: STATUS_TEXT,
    oversized: false,
    revokeAfterStart: false,
  };
  const selectionOnlyBackend = Object.freeze({
    schemaVersion: SANDBOX_BACKEND_SCHEMA_VERSION,
    securityModel: SANDBOX_BACKEND_SECURITY_MODEL,
    id: 'selection-proof-only',
    probe() {
      return createSandboxProbeResult({
        state: 'enforced',
        features: SANDBOX_A1_REQUIRED_FEATURES,
      });
    },
    async execute() {
      state.backendExecutions += 1;
      return Object.freeze({ status: 'bypassed' });
    },
    async terminate() {
      return Object.freeze({ ok: true });
    },
  });
  const sandboxRegistry = createSandboxBackendRegistry({
    backends: [selectionOnlyBackend],
  });
  const sandboxExecutor = Object.freeze({
    execute(sandboxRequest, executionContext) {
      state.executorCalls.push(Object.freeze({ sandboxRequest, executionContext }));
      if (state.revokeAfterStart) state.active = false;
      return Promise.resolve(Object.freeze({
        version: 'process-supervisor-exec-receipt.v1',
        ...frozenSnapshot({
          executionId: sandboxRequest.executionId,
          status: 'running',
          revision: 1,
          outputCursor: 0,
        }),
      }));
    },
    wait(input) {
      state.waitCalls.push(input);
      const outputCursor = state.oversized
        ? (256 * 1024) + 1
        : Buffer.byteLength(state.stdout, 'utf8');
      return Promise.resolve(Object.freeze({
        version: 'process-supervisor-wait-result.v1',
        ...frozenSnapshot({
          executionId: input.executionId,
          status: 'succeeded',
          revision: input.afterRevision + 1,
          outputCursor,
        }),
        changed: true,
      }));
    },
    read(input) {
      state.readCalls.push(input);
      const bytes = Buffer.byteLength(state.stdout, 'utf8');
      return Promise.resolve(Object.freeze({
        version: 'process-supervisor-read-result.v1',
        ...frozenSnapshot({
          executionId: input.executionId,
          status: 'succeeded',
          revision: 2,
          outputCursor: bytes,
        }),
        cursor: input.cursor,
        nextCursor: bytes,
        truncated: false,
        chunks: Object.freeze([Object.freeze({
          startCursor: 0,
          endCursor: bytes,
          stream: 'stdout',
          text: state.stdout,
        })]),
        eof: true,
      }));
    },
    stop(input) {
      state.stopCalls.push(input);
      return Promise.resolve(Object.freeze({
        version: 'process-supervisor-stop-receipt.v1',
        ...frozenSnapshot({
          executionId: input.executionId,
          status: 'stopped',
          revision: input.expectedRevision + 1,
          outputCursor: 0,
          signal: 'SIGTERM',
          stopped: true,
        }),
        treeTerminated: true,
        idempotent: false,
      }));
    },
  });
  const factory = createAgenticGitReadBrokerFactory({
    authorizeLifecycle(candidate) {
      state.lifecycleChecks += 1;
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    authorizeRoot(input) {
      state.rootChecks += 1;
      return state.active
        ? Object.freeze({
          ok: true,
          authorized: true,
          projectId: input.projectId,
          rootPath: input.rootPath,
          canonicalRootPath: input.rootPath,
          realRootPath: binding.realRootPath,
        })
        : Object.freeze({ authorized: false });
    },
    authorizeEffectFrontier(candidate) {
      state.effectChecks += 1;
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    sandboxRegistry,
    requestIdFactory() {
      state.requestIds += 1;
      return `agentic-git-status-${state.requestIds}`;
    },
    audit(event) {
      state.audits.push(event);
    },
  });
  return { factory, sandboxExecutor, state };
}

(async () => {
  const harness = createHarness();
  assert.strictEqual(Object.isFrozen(harness.factory), true);
  assert.strictEqual(
    harness.factory.diagnostics().version,
    AGENTIC_GIT_READ_BROKER_FACTORY_VERSION
  );

  const route = harness.factory.createRoute(Object.freeze({
    binding,
    sandboxExecutor: harness.sandboxExecutor,
  }));
  assert.strictEqual(Object.isFrozen(route), true);
  assert.deepStrictEqual(Reflect.ownKeys(route), [
    'version',
    'readStatus',
    'diagnostics',
  ]);
  assert.strictEqual(route.version, AGENTIC_GIT_READ_ROUTE_VERSION);
  assert.strictEqual(JSON.stringify(route).includes('/projects/a'), false);
  assert.strictEqual(JSON.stringify(route).includes('submissionDigest'), false);

  const result = await route.readStatus();
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.decision, 'allow');
  assert.strictEqual(result.capability, 'git');
  assert.strictEqual(result.action, 'status');
  assert.strictEqual(result.output.ok, true);
  assert.strictEqual(result.output.format, 'git-status-porcelain-v1');
  assert.strictEqual(result.output.branch, 'main...origin/main [ahead 2, behind 1]');
  assert.strictEqual(result.output.clean, false);
  assert.deepStrictEqual(result.output.counts, {
    staged: 1,
    unstaged: 1,
    untracked: 2,
    conflicted: 1,
  });
  assert.deepStrictEqual(result.output.entries, [
    { status: 'M ', path: 'src/app.js' },
    { status: ' M', path: 'README.md' },
    { status: '??', path: 'notes.txt' },
    { status: '??', path: 'conteúdo/ação.js' },
    { status: 'UU', path: 'conflict.txt' },
  ]);
  assert.strictEqual(Object.isFrozen(result.output), true);
  assert.strictEqual(Object.isFrozen(result.output.entries), true);
  assert.strictEqual(Object.isFrozen(result.output.entries[0]), true);
  assert.strictEqual(JSON.stringify(result).includes('/projects/a'), false);
  assert.strictEqual(JSON.stringify(result).includes('/private/projects/a'), false);
  assert.strictEqual(JSON.stringify(result).includes('sandbox-exec:'), false);
  assert.strictEqual(JSON.stringify(result).includes('submissionDigest'), false);

  assert.strictEqual(harness.state.backendExecutions, 0);
  assert.strictEqual(harness.state.executorCalls.length, 1);
  assert.strictEqual(harness.state.waitCalls.length, 1);
  assert.strictEqual(harness.state.readCalls.length, 1);
  assert.strictEqual(harness.state.stopCalls.length, 0);
  assert(harness.state.lifecycleChecks >= 4);
  assert(harness.state.rootChecks >= 4);
  assert(harness.state.effectChecks >= 3);
  assert(harness.state.audits.some((event) => event.event === 'capability_execution_started'));
  assert(harness.state.audits.some((event) => event.event === 'capability_execution_completed'));

  const [{ sandboxRequest, executionContext }] = harness.state.executorCalls;
  assert.strictEqual(sandboxRequest.requestId, 'agentic-git-status-1');
  assert.strictEqual(sandboxRequest.rootPath, binding.canonicalRootPath);
  assert.strictEqual(sandboxRequest.realRootPath, binding.realRootPath);
  assert.deepStrictEqual(sandboxRequest.command, {
    kind: 'executable',
    executable: 'git',
    args: [
      '--no-optional-locks',
      '--no-pager',
      '-c',
      'core.quotepath=false',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      '-c',
      'submodule.recurse=false',
      'status',
      '--porcelain=v1',
      '--branch',
      '--untracked-files=all',
      '--ignore-submodules=all',
    ],
  });
  assert.deepStrictEqual(sandboxRequest.env, {});
  assert.strictEqual(sandboxRequest.networkMode, 'disabled');
  assert.deepStrictEqual(executionContext.effects, [
    'filesystem_read',
    'process_execute',
  ]);
  assert.deepStrictEqual(harness.state.waitCalls[0], {
    executionId: sandboxRequest.executionId,
    afterRevision: 1,
    timeoutMs: 30_000,
  });
  assert.deepStrictEqual(harness.state.readCalls[0], {
    executionId: sandboxRequest.executionId,
    cursor: 0,
    maxBytes: Buffer.byteLength(STATUS_TEXT, 'utf8'),
  });

  assert.deepStrictEqual(route.diagnostics(), Object.freeze({
    version: AGENTIC_GIT_READ_ROUTE_VERSION,
    capability: 'git',
    action: 'status',
    requests: 1,
    completed: 1,
    failed: 0,
    networkMode: 'disabled',
    commandPolicy: 'fixed_read_only',
    authorityBoundary: 'job_binding',
  }));
  assert.deepStrictEqual(harness.factory.diagnostics(), Object.freeze({
    version: AGENTIC_GIT_READ_BROKER_FACTORY_VERSION,
    descriptorVersion: AGENTIC_GIT_READ_DESCRIPTOR_VERSION,
    routesCreated: 1,
    totalRequests: 1,
    capability: 'git',
    action: 'status',
    networkDefault: 'disabled',
    commandPolicy: 'fixed_read_only',
    authorityBoundary: 'main_process_only',
  }));

  await assert.rejects(route.readStatus({ unexpected: true }), TypeError);
  assert.strictEqual(harness.state.executorCalls.length, 1);

  harness.state.oversized = true;
  const oversizedRoute = harness.factory.createRoute(Object.freeze({
    binding,
    sandboxExecutor: harness.sandboxExecutor,
  }));
  const oversized = await oversizedRoute.readStatus();
  assert.strictEqual(oversized.status, 'completed');
  assert.strictEqual(oversized.output.ok, false);
  assert.strictEqual(oversized.output.code, 'GIT_STATUS_OUTPUT_TOO_LARGE');
  assert.strictEqual(harness.state.readCalls.length, 1);
  assert.strictEqual(oversizedRoute.diagnostics().failed, 1);

  harness.state.oversized = false;
  harness.state.revokeAfterStart = true;
  const revokedDuringExecutionRoute = harness.factory.createRoute(Object.freeze({
    binding,
    sandboxExecutor: harness.sandboxExecutor,
  }));
  const revokedDuringExecution = await revokedDuringExecutionRoute.readStatus();
  assert.strictEqual(revokedDuringExecution.status, 'completed');
  assert.strictEqual(revokedDuringExecution.output.ok, false);
  assert.strictEqual(revokedDuringExecution.output.code, 'GIT_STATUS_AUTHORITY_DENIED');
  assert.strictEqual(harness.state.waitCalls.length, 2);

  const denied = await revokedDuringExecutionRoute.readStatus();
  assert.strictEqual(denied.status, 'denied');
  assert.strictEqual(harness.state.executorCalls.length, 3);

  assert.throws(
    () => harness.factory.createRoute({
      binding,
      sandboxExecutor: Object.freeze({ execute() {} }),
    }),
    TypeError
  );

  console.log('agentic-git-read-broker-factory.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
