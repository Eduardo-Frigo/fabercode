'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');
const {
  AGENTIC_DELETE_RECOVERY_SERVICE_VERSION,
  RECOVERY_ERROR_CODES,
  createAgenticDeleteRecoveryService,
} = require('../main/services/agentic_delete_recovery_service');
const {
  createTransactionalFilesystemDeleteService,
} = require('../main/services/transactional_filesystem_delete_service');
const {
  createAnchoredMutationTestBackend,
} = require('./support/anchored_mutation_test_backend');

const digest = (character) => `sha256:${character.repeat(64)}`;
const journalSecret = Buffer.alloc(32, 0x4d);
const STRICT_REJECTION_PROBE_FLAG = '--strict-rejection-probe';

const journalAuthenticator = Object.freeze({
  seal(_rootPath, value) {
    return `hmac-sha256:${crypto
      .createHmac('sha256', journalSecret)
      .update(canonicalSha256Digest(value), 'utf8')
      .digest('hex')}`;
  },
  verify(rootPath, value, tag) {
    if (typeof tag !== 'string') return false;
    const expected = this.seal(rootPath, value);
    return expected.length === tag.length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(tag));
  },
});

function exists(entryPath) {
  try { fs.lstatSync(entryPath); return true; } catch { return false; }
}

function physicalIdentity(rootPath) {
  const target = fs.statSync(rootPath);
  const entry = fs.lstatSync(rootPath);
  return {
    device: String(target.dev),
    inode: String(target.ino),
    entryDevice: String(entry.dev),
    entryInode: String(entry.ino),
    entryType: entry.isSymbolicLink() ? 'symlink' : 'directory',
  };
}

function createTestMutationBackend() {
  return createAnchoredMutationTestBackend({
    backendId: 'recovery-test-anchored-backend',
  });
}

function bindingFor(rootPath, jobId = 'job-recovery-a', character = 'a') {
  const realRootPath = fs.realpathSync(rootPath);
  return Object.freeze({
    projectId: `project-${character}`,
    canonicalRootPath: realRootPath,
    realRootPath,
    sessionId: `session_${character.repeat(32)}`,
    jobId,
    kernelId: `kernel-${character}`,
    submissionDigest: digest(character),
  });
}

function terminalJob(binding, { status = 'failed', phase = 'runtime_interrupted' } = {}) {
  return {
    id: binding.jobId,
    projectId: binding.projectId,
    rootPath: binding.canonicalRootPath,
    status,
    phase,
    authorityContextStatus: 'bound',
    authorityContext: {
      schemaVersion: 'assistant-job-authority.v1',
      projectId: binding.projectId,
      canonicalRootPath: binding.canonicalRootPath,
      realRootPath: binding.realRootPath,
      sessionId: binding.sessionId,
      kernelId: binding.kernelId,
      submissionDigest: binding.submissionDigest,
      actionDigest: digest('f'),
    },
  };
}

function allowProject(binding, identity = physicalIdentity(binding.realRootPath)) {
  return {
    ok: true,
    authorized: true,
    projectId: binding.projectId,
    rootPath: binding.canonicalRootPath,
    canonicalRootPath: binding.canonicalRootPath,
    realRootPath: binding.realRootPath,
    physicalRootIdentity: identity,
  };
}

function createTransactionalRuntimeFactory(mutationBackend, captures = []) {
  return (authority) => {
    captures.push(authority);
    const runtime = createTransactionalFilesystemDeleteService({
      authorizeLifecycle: authority.authorizeLifecycle,
      authorizeRoot: authority.authorizeRoot,
      authorizeEffectFrontier: authority.authorizeEffectFrontier,
      journalAuthenticator,
      mutationBackend,
    });
    return Object.freeze({
      recoverProject: runtime.recoverProject,
      rollbackJob: runtime.rollbackJob,
      finalizeJob: runtime.finalizeJob,
    });
  };
}

function createRecoveryHarness({
  binding,
  job = terminalJob(binding),
  getAuthorizedJobById = null,
  authorizeProjectBinding = null,
  createTransactionalRuntime = null,
  maxTrackedJobs,
} = {}) {
  const mutationBackend = createTestMutationBackend();
  const capturedAuthorities = [];
  const options = {
    getAuthorizedJobById: getAuthorizedJobById || ((jobId) => (
      jobId === binding.jobId ? { ok: true, job } : { ok: false }
    )),
    authorizeProjectBinding: authorizeProjectBinding || ((projectId, rootPath) => (
      projectId === binding.projectId && rootPath === binding.canonicalRootPath
        ? allowProject(binding)
        : { ok: false, authorized: false }
    )),
    createTransactionalRuntime:
      createTransactionalRuntime || createTransactionalRuntimeFactory(
        mutationBackend,
        capturedAuthorities
      ),
  };
  if (maxTrackedJobs !== undefined) options.maxTrackedJobs = maxTrackedJobs;
  return {
    mutationBackend,
    capturedAuthorities,
    service: createAgenticDeleteRecoveryService(options),
  };
}

function createCommittedCheckpoint(rootPath, binding, mutationBackend, relativePath, contents) {
  const targetPath = path.join(rootPath, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents);
  const service = createTransactionalFilesystemDeleteService({
    authorizeLifecycle: (candidate) => ({ authorized: true, binding: candidate }),
    authorizeRoot: (candidate) => ({
      authorized: true,
      projectId: candidate.projectId,
      canonicalRootPath: candidate.canonicalRootPath,
      realRootPath: candidate.realRootPath,
    }),
    authorizeEffectFrontier: (candidate) => ({ authorized: true, binding: candidate }),
    journalAuthenticator,
    mutationBackend,
    transactionIdFactory: () => `transaction-${binding.jobId.replace(/[^A-Za-z0-9_-]/g, '-')}`,
  });
  const prepared = service.prepare({
    binding,
    paths: [relativePath],
    pathStyle: 'posix',
    caseSensitive: true,
  });
  const committed = prepared.commit({
    decisionRequestDigest: digest('e'),
    consumeDecision: () => ({ authorized: true }),
  });
  assert.strictEqual(committed.state, 'COMMITTED');
  assert.strictEqual(exists(targetPath), false);
  return service;
}

function withProject(run) {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-recovery-service-'));
  try {
    run(rootPath);
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
}

function runStrictDependencyRejectionProbe() {
  withProject((rootPath) => {
    let caseSerial = 0;
    const nextBinding = () => {
      caseSerial += 1;
      return bindingFor(
        rootPath,
        `job-recovery-strict-promise-${caseSerial}`,
        String.fromCharCode(96 + caseSerial)
      );
    };
    const rejected = (label) => Promise.reject(new Error(label));

    {
      const binding = bindingFor(rootPath, 'job-recovery-strict-input', 'f');
      const service = createRecoveryHarness({ binding }).service;
      let thenReads = 0;
      const input = rejected('recovery input rejected');
      Object.defineProperty(input, 'then', {
        configurable: true,
        get() {
          thenReads += 1;
          throw new Error('native Promise input then getter must not run');
        },
      });
      assert.strictEqual(
        service.recoverJob(input).errorCode,
        RECOVERY_ERROR_CODES.INVALID_REQUEST
      );
      assert.strictEqual(thenReads, 0);
    }

    {
      const binding = nextBinding();
      let thenReads = 0;
      const service = createRecoveryHarness({
        binding,
        getAuthorizedJobById() {
          const promise = rejected('persisted job rejected');
          Object.defineProperty(promise, 'then', {
            configurable: true,
            get() {
              thenReads += 1;
              throw new Error('native Promise then getter must not run');
            },
          });
          return promise;
        },
      }).service;
      assert.strictEqual(
        service.recoverJob({ jobId: binding.jobId }).errorCode,
        RECOVERY_ERROR_CODES.JOB_NOT_FOUND
      );
      assert.strictEqual(thenReads, 0);
    }

    {
      const binding = nextBinding();
      const service = createRecoveryHarness({
        binding,
        authorizeProjectBinding: () => rejected('project authorization rejected'),
      }).service;
      assert.strictEqual(
        service.recoverJob({ jobId: binding.jobId }).errorCode,
        RECOVERY_ERROR_CODES.PROJECT_UNAVAILABLE
      );
    }

    {
      const binding = nextBinding();
      const service = createRecoveryHarness({
        binding,
        createTransactionalRuntime: () => rejected('runtime factory rejected'),
      }).service;
      assert.strictEqual(
        service.recoverJob({ jobId: binding.jobId }).errorCode,
        RECOVERY_ERROR_CODES.RUNTIME_INVALID
      );
    }

    {
      const binding = nextBinding();
      const service = createRecoveryHarness({
        binding,
        createTransactionalRuntime: () => Object.freeze({
          recoverProject: () => rejected('recoverProject rejected'),
          rollbackJob() { throw new Error('must not reach rollback'); },
          finalizeJob() { throw new Error('must not reach finalize'); },
        }),
      }).service;
      assert.strictEqual(
        service.recoverJob({ jobId: binding.jobId }).errorCode,
        RECOVERY_ERROR_CODES.RECOVERY_UNKNOWN
      );
    }

    {
      const binding = nextBinding();
      const service = createRecoveryHarness({
        binding,
        createTransactionalRuntime: () => Object.freeze({
          recoverProject: () => ({
            ok: true,
            recovered: 0,
            retainedCommitted: 1,
            retainedUnknown: 0,
          }),
          rollbackJob: () => rejected('rollbackJob rejected'),
          finalizeJob() { throw new Error('must not reach finalize'); },
        }),
      }).service;
      assert.strictEqual(
        service.recoverJob({ jobId: binding.jobId }).errorCode,
        RECOVERY_ERROR_CODES.RECOVERY_FAILED
      );
    }

    {
      const binding = nextBinding();
      const service = createRecoveryHarness({
        binding,
        job: terminalJob(binding, { status: 'completed', phase: 'done' }),
        createTransactionalRuntime: () => Object.freeze({
          recoverProject: () => ({
            ok: true,
            recovered: 0,
            retainedCommitted: 1,
            retainedUnknown: 0,
          }),
          rollbackJob() { throw new Error('must not reach rollback'); },
          finalizeJob: () => rejected('finalizeJob rejected'),
        }),
      }).service;
      assert.strictEqual(
        service.recoverJob({ jobId: binding.jobId }).errorCode,
        RECOVERY_ERROR_CODES.RECOVERY_FAILED
      );
    }

    let hostileThenReads = 0;
    const hostileThenable = Object.create(null);
    Object.defineProperty(hostileThenable, 'then', {
      enumerable: true,
      get() {
        hostileThenReads += 1;
        throw new Error('hostile thenable must not execute');
      },
    });
    const thenableBinding = nextBinding();
    const thenableService = createRecoveryHarness({
      binding: thenableBinding,
      getAuthorizedJobById: () => hostileThenable,
    }).service;
    assert.strictEqual(
      thenableService.recoverJob({ jobId: thenableBinding.jobId }).errorCode,
      RECOVERY_ERROR_CODES.JOB_NOT_FOUND
    );
    assert.strictEqual(hostileThenReads, 0);

    let hostileProxyGets = 0;
    const hostileProxy = new Proxy({}, {
      get() {
        hostileProxyGets += 1;
        throw new Error('hostile proxy getter must not execute');
      },
    });
    const proxyBinding = nextBinding();
    const proxyService = createRecoveryHarness({
      binding: proxyBinding,
      authorizeProjectBinding: () => hostileProxy,
    }).service;
    assert.strictEqual(
      proxyService.recoverJob({ jobId: proxyBinding.jobId }).ok,
      false
    );
    assert.strictEqual(hostileProxyGets, 0);
  });
}

if (process.argv[2] === STRICT_REJECTION_PROBE_FLAG) {
  runStrictDependencyRejectionProbe();
  setImmediate(() => process.stdout.write('strict rejection probe passed\n'));
} else {

assert.strictEqual(
  AGENTIC_DELETE_RECOVERY_SERVICE_VERSION,
  'agentic-delete-recovery-service.v1'
);
assert.throws(() => createAgenticDeleteRecoveryService(), /options/);
assert.throws(() => createAgenticDeleteRecoveryService({
  getAuthorizedJobById() {},
  authorizeProjectBinding() {},
  createTransactionalRuntime() {},
  unsupported: true,
}), /options/);

// P1 commits, crashes, and P2 reconstructs only the persisted terminal binding before rollback.
withProject((rootPath) => {
  const binding = bindingFor(rootPath);
  const mutationBackend = createTestMutationBackend();
  createCommittedCheckpoint(rootPath, binding, mutationBackend, 'src/restart.txt', 'restart-safe');
  const targetPath = path.join(rootPath, 'src/restart.txt');
  const capturedAuthorities = [];
  let runtimeCreations = 0;
  const service = createAgenticDeleteRecoveryService({
    getAuthorizedJobById: () => ({ ok: true, job: terminalJob(binding) }),
    authorizeProjectBinding: () => allowProject(binding),
    createTransactionalRuntime(authority) {
      runtimeCreations += 1;
      return createTransactionalRuntimeFactory(mutationBackend, capturedAuthorities)(authority);
    },
  });
  const recovered = service.recoverJob({ jobId: binding.jobId });
  assert.deepStrictEqual(recovered, {
    schemaVersion: 'agentic-delete-recovery-result.v1',
    ok: true,
    status: 'completed',
    disposition: 'rollback',
    errorCode: null,
    idempotent: false,
  });
  assert.strictEqual(fs.readFileSync(targetPath, 'utf8'), 'restart-safe');
  assert.deepStrictEqual(fs.readdirSync(path.join(rootPath, '.faber', 'transactions')), []);
  assert.strictEqual(runtimeCreations, 1);
  assert.deepStrictEqual(service.recoverJob({ jobId: binding.jobId }), {
    ...recovered,
    idempotent: true,
  });
  assert.strictEqual(runtimeCreations, 1, 'replay must not rebuild or re-enter the runtime');
  assert.deepStrictEqual(capturedAuthorities[0].authorizeLifecycle(binding), { authorized: false });

  const publicJson = `${JSON.stringify(recovered)}${JSON.stringify(service.diagnostics())}`.toLowerCase();
  for (const forbidden of [rootPath.toLowerCase(), binding.jobId, 'sha256:', 'binding', 'digest', 'path']) {
    assert.strictEqual(publicJson.includes(forbidden), false, `public recovery data leaked ${forbidden}`);
  }
});

// A successfully completed persisted job retains COMMITTED on discovery, then purges it.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-purge', 'b');
  const mutationBackend = createTestMutationBackend();
  createCommittedCheckpoint(rootPath, binding, mutationBackend, 'obsolete.txt', 'remove-me');
  const service = createAgenticDeleteRecoveryService({
    getAuthorizedJobById: () => ({
      ok: true,
      job: terminalJob(binding, { status: 'completed', phase: 'done' }),
    }),
    authorizeProjectBinding: () => allowProject(binding),
    createTransactionalRuntime: createTransactionalRuntimeFactory(mutationBackend),
  });
  const result = service.recoverJob({ jobId: binding.jobId });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.disposition, 'purge');
  assert.strictEqual(exists(path.join(rootPath, 'obsolete.txt')), false);
  assert.deepStrictEqual(fs.readdirSync(path.join(rootPath, '.faber', 'transactions')), []);
});

// Persisted authority is data-only, action-bound, terminal, and exactly tied to top-level identity.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-tamper', 'c');
  const cases = [
    { ...terminalJob(binding), projectId: 'project-forged' },
    {
      ...terminalJob(binding),
      authorityContext: { ...terminalJob(binding).authorityContext, actionDigest: null },
    },
    { ...terminalJob(binding), authorityContextStatus: 'legacy_missing' },
    terminalJob(binding, { status: 'running', phase: 'execute_pending' }),
    terminalJob(binding, { status: 'completed', phase: 'awaiting_user_input' }),
    terminalJob(binding, { status: 'cancelled', phase: 'failed' }),
    terminalJob(binding, { status: 'failed', phase: 'created' }),
    terminalJob(binding, { status: 'failed', phase: 'running' }),
    terminalJob(binding, { status: 'failed', phase: 'completed' }),
    terminalJob(binding, { status: 'failed', phase: 'execute_pending' }),
  ];
  for (const job of cases) {
    let projectCalls = 0;
    let runtimeCalls = 0;
    const service = createAgenticDeleteRecoveryService({
      getAuthorizedJobById: () => ({ ok: true, job }),
      authorizeProjectBinding() { projectCalls += 1; return allowProject(binding); },
      createTransactionalRuntime() { runtimeCalls += 1; return {}; },
    });
    const deniedResult = service.recoverJob({ jobId: binding.jobId });
    assert.strictEqual(deniedResult.ok, false);
    assert.strictEqual(projectCalls, 0);
    assert.strictEqual(runtimeCalls, 0);
  }

  const accessorContext = { ...terminalJob(binding).authorityContext };
  Object.defineProperty(accessorContext, 'actionDigest', {
    enumerable: true,
    get() { throw new Error('must not execute'); },
  });
  const accessorHarness = createRecoveryHarness({
    binding,
    job: { ...terminalJob(binding), authorityContext: accessorContext },
  });
  assert.strictEqual(accessorHarness.service.recoverJob({ jobId: binding.jobId }).ok, false);
  assert.strictEqual(accessorHarness.capturedAuthorities.length, 0);
});

// Project deletion, contradictory authorization, and physical-root swaps all stop before recovery.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-root', 'd');
  for (const authorization of [
    { ok: true, authorized: false },
    { ok: false, authorized: true },
    { ...allowProject(binding), realRootPath: `${binding.realRootPath}-replaced` },
  ]) {
    let runtimeCalls = 0;
    const harness = createRecoveryHarness({
      binding,
      authorizeProjectBinding: () => authorization,
      createTransactionalRuntime() { runtimeCalls += 1; return {}; },
    });
    const result = harness.service.recoverJob({ jobId: binding.jobId });
    assert.strictEqual(result.errorCode, RECOVERY_ERROR_CODES.PROJECT_UNAVAILABLE);
    assert.strictEqual(runtimeCalls, 0);
  }

  let authorizationCalls = 0;
  let recoverCalls = 0;
  const initialIdentity = physicalIdentity(rootPath);
  const changedIdentity = { ...initialIdentity, inode: `${initialIdentity.inode}-changed` };
  const swapped = createRecoveryHarness({
    binding,
    authorizeProjectBinding() {
      authorizationCalls += 1;
      return allowProject(binding, authorizationCalls === 1 ? initialIdentity : changedIdentity);
    },
    createTransactionalRuntime: () => Object.freeze({
      recoverProject() { recoverCalls += 1; return {}; },
      rollbackJob() { return {}; },
      finalizeJob() { return {}; },
    }),
  });
  assert.strictEqual(
    swapped.service.recoverJob({ jobId: binding.jobId }).errorCode,
    RECOVERY_ERROR_CODES.AUTHORITY_INVALID
  );
  assert.strictEqual(recoverCalls, 0);
});

// Factory/root callbacks cannot change persisted status, context, or action digest after snapshot.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-snapshot-fence', 'e');
  let currentJob = terminalJob(binding);
  let recoverCalls = 0;
  const factoryMutation = createAgenticDeleteRecoveryService({
    getAuthorizedJobById: () => ({ ok: true, job: currentJob }),
    authorizeProjectBinding: () => allowProject(binding),
    createTransactionalRuntime() {
      currentJob = { ...currentJob, status: 'running', phase: 'execute_pending' };
      return Object.freeze({
        recoverProject() { recoverCalls += 1; return {}; },
        rollbackJob() { return {}; },
        finalizeJob() { return {}; },
      });
    },
  });
  assert.strictEqual(
    factoryMutation.recoverJob({ jobId: binding.jobId }).errorCode,
    RECOVERY_ERROR_CODES.AUTHORITY_INVALID
  );
  assert.strictEqual(recoverCalls, 0);

  currentJob = terminalJob(binding);
  let authorizationCalls = 0;
  const rootMutation = createAgenticDeleteRecoveryService({
    getAuthorizedJobById: () => ({ ok: true, job: currentJob }),
    authorizeProjectBinding() {
      authorizationCalls += 1;
      if (authorizationCalls === 1) {
        currentJob = {
          ...currentJob,
          authorityContext: {
            ...currentJob.authorityContext,
            actionDigest: digest('d'),
          },
        };
      }
      return allowProject(binding);
    },
    createTransactionalRuntime() { throw new Error('must not create runtime'); },
  });
  assert.strictEqual(
    rootMutation.recoverJob({ jobId: binding.jobId }).errorCode,
    RECOVERY_ERROR_CODES.AUTHORITY_INVALID
  );
});

// Unknown/tampered WAL and runtime DTO extensions fail closed before terminal disposition.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-wal', 'e');
  for (const recoveryResult of [
    { ok: true, recovered: 0, retainedCommitted: 0, retainedUnknown: 1 },
    {
      ok: true,
      recovered: 0,
      retainedCommitted: 1,
      retainedUnknown: 0,
      injected: binding.realRootPath,
    },
    Promise.resolve({ ok: true, recovered: 0, retainedCommitted: 1, retainedUnknown: 0 }),
  ]) {
    let terminalCalls = 0;
    const harness = createRecoveryHarness({
      binding,
      createTransactionalRuntime: () => Object.freeze({
        recoverProject() { return recoveryResult; },
        rollbackJob() {
          terminalCalls += 1;
          return { ok: true, purged: 0, rolledBack: 1, recoveryRequired: 0 };
        },
        finalizeJob() {
          terminalCalls += 1;
          return { ok: true, purged: 1, rolledBack: 0, recoveryRequired: 0 };
        },
      }),
    });
    const result = harness.service.recoverJob({ jobId: binding.jobId });
    assert.strictEqual(result.errorCode, RECOVERY_ERROR_CODES.RECOVERY_UNKNOWN);
    assert.strictEqual(terminalCalls, 0);
    assert.strictEqual(JSON.stringify(result).includes(binding.realRootPath), false);
  }
});

// Failed/cancelled terminal jobs use rollback; extended or async terminal replies are rejected.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-failed', 'f');
  for (const [status, phase] of [['failed', 'execute_failed'], ['cancelled', 'cancelled']]) {
    let rollbackReason = null;
    const harness = createRecoveryHarness({
      binding,
      job: terminalJob(binding, { status, phase }),
      createTransactionalRuntime: () => Object.freeze({
        recoverProject: () => ({
          ok: true,
          recovered: 0,
          retainedCommitted: 1,
          retainedUnknown: 0,
        }),
        rollbackJob(input) {
          rollbackReason = input.reason;
          return { ok: true, purged: 0, rolledBack: 1, recoveryRequired: 0 };
        },
        finalizeJob() { throw new Error('wrong terminal disposition'); },
      }),
    });
    const result = harness.service.recoverJob({ jobId: binding.jobId });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.disposition, 'rollback');
    assert.strictEqual(rollbackReason, `startup_${status}`);
  }

  const extendedTerminal = createRecoveryHarness({
    binding,
    createTransactionalRuntime: () => Object.freeze({
      recoverProject: () => ({
        ok: true,
        recovered: 0,
        retainedCommitted: 1,
        retainedUnknown: 0,
      }),
      rollbackJob: () => ({
        ok: true,
        purged: 0,
        rolledBack: 1,
        recoveryRequired: 0,
        hidden: digest('a'),
      }),
      finalizeJob() {},
    }),
  });
  assert.strictEqual(
    extendedTerminal.service.recoverJob({ jobId: binding.jobId }).errorCode,
    RECOVERY_ERROR_CODES.RECOVERY_FAILED
  );
});

// Terminal disposition and counts must agree exactly with the discovered checkpoint set.
withProject((rootPath) => {
  const rollbackBinding = bindingFor(rootPath, 'job-recovery-wrong-rollback', 'a');
  const wrongRollback = createRecoveryHarness({
    binding: rollbackBinding,
    createTransactionalRuntime: () => Object.freeze({
      recoverProject: () => ({
        ok: true,
        recovered: 0,
        retainedCommitted: 7,
        retainedUnknown: 0,
      }),
      rollbackJob: () => ({
        ok: true,
        purged: 7,
        rolledBack: 0,
        recoveryRequired: 0,
      }),
      finalizeJob() { throw new Error('wrong disposition'); },
    }),
  });
  assert.strictEqual(
    wrongRollback.service.recoverJob({ jobId: rollbackBinding.jobId }).errorCode,
    RECOVERY_ERROR_CODES.RECOVERY_FAILED
  );

  const purgeBinding = bindingFor(rootPath, 'job-recovery-wrong-purge', 'b');
  const wrongPurge = createRecoveryHarness({
    binding: purgeBinding,
    job: terminalJob(purgeBinding, { status: 'completed', phase: 'done' }),
    createTransactionalRuntime: () => Object.freeze({
      recoverProject: () => ({
        ok: true,
        recovered: 0,
        retainedCommitted: 3,
        retainedUnknown: 0,
      }),
      rollbackJob() { throw new Error('wrong disposition'); },
      finalizeJob: () => ({
        ok: true,
        purged: 0,
        rolledBack: 3,
        recoveryRequired: 0,
      }),
    }),
  });
  assert.strictEqual(
    wrongPurge.service.recoverJob({ jobId: purgeBinding.jobId }).errorCode,
    RECOVERY_ERROR_CODES.RECOVERY_FAILED
  );
});

// Reentrancy poisons the outer attempt; neither path reaches terminal mutation.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-reentrant', 'a');
  let service;
  let nested;
  let terminalCalls = 0;
  service = createAgenticDeleteRecoveryService({
    getAuthorizedJobById: () => ({ ok: true, job: terminalJob(binding) }),
    authorizeProjectBinding: () => allowProject(binding),
    createTransactionalRuntime: () => Object.freeze({
      recoverProject() {
        nested = service.recoverJob({ jobId: binding.jobId });
        return { ok: true, recovered: 0, retainedCommitted: 1, retainedUnknown: 0 };
      },
      rollbackJob() {
        terminalCalls += 1;
        return { ok: true, purged: 0, rolledBack: 1, recoveryRequired: 0 };
      },
      finalizeJob() { terminalCalls += 1; return {}; },
    }),
  });
  const outer = service.recoverJob({ jobId: binding.jobId });
  assert.strictEqual(nested.errorCode, RECOVERY_ERROR_CODES.RECOVERY_BUSY);
  assert.strictEqual(outer.errorCode, RECOVERY_ERROR_CODES.RECOVERY_UNKNOWN);
  assert.strictEqual(terminalCalls, 0);
  assert.strictEqual(service.diagnostics().reentrantAttempts, 1);
});

// A hostile terminal DTO cannot re-enter during shape inspection and still seal success.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-terminal-proxy', 'c');
  let service;
  let nested;
  let reentered = false;
  service = createAgenticDeleteRecoveryService({
    getAuthorizedJobById: () => ({ ok: true, job: terminalJob(binding) }),
    authorizeProjectBinding: () => allowProject(binding),
    createTransactionalRuntime: () => Object.freeze({
      recoverProject: () => ({
        ok: true,
        recovered: 0,
        retainedCommitted: 1,
        retainedUnknown: 0,
      }),
      rollbackJob: () => new Proxy({
        ok: true,
        purged: 0,
        rolledBack: 1,
        recoveryRequired: 0,
      }, {
        getPrototypeOf(target) {
          if (!reentered) {
            reentered = true;
            nested = service.recoverJob({ jobId: binding.jobId });
          }
          return Object.getPrototypeOf(target);
        },
      }),
      finalizeJob() { throw new Error('wrong disposition'); },
    }),
  });
  const outer = service.recoverJob({ jobId: binding.jobId });
  assert.strictEqual(nested.errorCode, RECOVERY_ERROR_CODES.RECOVERY_BUSY);
  assert.strictEqual(outer.status, 'failed');
  assert.strictEqual(outer.errorCode, RECOVERY_ERROR_CODES.RECOVERY_BUSY);
});

// Once a recovery callback may have mutated disk, a stale persisted fence is ambiguous, not denied.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-post-effect-fence', 'd');
  let currentJob = terminalJob(binding);
  const postRecovery = createRecoveryHarness({
    binding,
    getAuthorizedJobById: () => ({ ok: true, job: currentJob }),
    createTransactionalRuntime: () => Object.freeze({
      recoverProject() {
        currentJob = { ...currentJob, status: 'completed', phase: 'done' };
        return { ok: true, recovered: 1, retainedCommitted: 1, retainedUnknown: 0 };
      },
      rollbackJob() { throw new Error('must not continue after a stale recovery'); },
      finalizeJob() { throw new Error('must not continue after a stale recovery'); },
    }),
  });
  const postRecoveryResult = postRecovery.service.recoverJob({ jobId: binding.jobId });
  assert.strictEqual(postRecoveryResult.status, 'failed');
  assert.strictEqual(postRecoveryResult.errorCode, RECOVERY_ERROR_CODES.RECOVERY_UNKNOWN);

  currentJob = terminalJob(binding);
  const postTerminal = createRecoveryHarness({
    binding,
    getAuthorizedJobById: () => ({ ok: true, job: currentJob }),
    createTransactionalRuntime: () => Object.freeze({
      recoverProject: () => ({
        ok: true,
        recovered: 0,
        retainedCommitted: 1,
        retainedUnknown: 0,
      }),
      rollbackJob() {
        currentJob = { ...currentJob, status: 'completed', phase: 'done' };
        return { ok: true, purged: 0, rolledBack: 1, recoveryRequired: 0 };
      },
      finalizeJob() { throw new Error('wrong disposition'); },
    }),
  });
  const postTerminalResult = postTerminal.service.recoverJob({ jobId: binding.jobId });
  assert.strictEqual(postTerminalResult.status, 'failed');
  assert.strictEqual(postTerminalResult.errorCode, RECOVERY_ERROR_CODES.RECOVERY_UNKNOWN);
});

// Tracking is bounded without evicting a sealed replay record.
withProject((rootPath) => {
  const firstBinding = bindingFor(rootPath, 'job-recovery-capacity-a', 'a');
  const secondBinding = bindingFor(rootPath, 'job-recovery-capacity-b', 'b');
  const jobs = new Map([
    [firstBinding.jobId, terminalJob(firstBinding)],
    [secondBinding.jobId, terminalJob(secondBinding)],
  ]);
  const service = createAgenticDeleteRecoveryService({
    maxTrackedJobs: 1,
    getAuthorizedJobById: (jobId) => ({ ok: true, job: jobs.get(jobId) }),
    authorizeProjectBinding(projectId) {
      const binding = projectId === firstBinding.projectId ? firstBinding : secondBinding;
      return allowProject(binding);
    },
    createTransactionalRuntime: () => Object.freeze({
      recoverProject: () => ({
        ok: true,
        recovered: 0,
        retainedCommitted: 0,
        retainedUnknown: 0,
      }),
      rollbackJob: () => ({ ok: true, purged: 0, rolledBack: 0, recoveryRequired: 0 }),
      finalizeJob: () => ({ ok: true, purged: 0, rolledBack: 0, recoveryRequired: 0 }),
    }),
  });
  assert.strictEqual(service.recoverJob({ jobId: firstBinding.jobId }).ok, true);
  assert.strictEqual(
    service.recoverJob({ jobId: secondBinding.jobId }).errorCode,
    RECOVERY_ERROR_CODES.CAPACITY_EXCEEDED
  );
  assert.strictEqual(service.recoverJob({ jobId: firstBinding.jobId }).idempotent, true);
  assert.strictEqual(service.diagnostics().trackedJobs, 1);
});

// Recovery authority covers a full valid agentic run while remaining bounded.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-authority-budget', 'f');
  let authorityUses = 0;
  const service = createAgenticDeleteRecoveryService({
    getAuthorizedJobById: () => ({ ok: true, job: terminalJob(binding) }),
    authorizeProjectBinding: () => allowProject(binding),
    createTransactionalRuntime: (authority) => Object.freeze({
      recoverProject() {
        for (let index = 0; index < 200; index += 1) {
          const decision = index % 2 === 0
            ? authority.authorizeLifecycle(binding)
            : authority.authorizeEffectFrontier(binding);
          assert.strictEqual(decision.authorized, true);
          authorityUses += 1;
        }
        return { ok: true, recovered: 100, retainedCommitted: 0, retainedUnknown: 0 };
      },
      rollbackJob: () => ({ ok: true, purged: 0, rolledBack: 0, recoveryRequired: 0 }),
      finalizeJob: () => ({ ok: true, purged: 0, rolledBack: 0, recoveryRequired: 0 }),
    }),
  });
  assert.strictEqual(service.recoverJob({ jobId: binding.jobId }).ok, true);
  assert.strictEqual(authorityUses, 200);
  assert.strictEqual(service.diagnostics().maxAuthorityUses, 512);
});

// Throws and Promise-like dependency results are never treated as authority or completion.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-dependency-failure', 'c');
  const cases = [
    {
      overrides: { getAuthorizedJobById: () => Promise.resolve({ ok: true }) },
      errorCode: RECOVERY_ERROR_CODES.JOB_NOT_FOUND,
    },
    {
      overrides: {
        getAuthorizedJobById: () => ({
          ok: true,
          job: terminalJob(binding),
          then() {},
        }),
      },
      errorCode: RECOVERY_ERROR_CODES.JOB_NOT_FOUND,
    },
    {
      overrides: { authorizeProjectBinding: () => Promise.resolve(allowProject(binding)) },
      errorCode: RECOVERY_ERROR_CODES.PROJECT_UNAVAILABLE,
    },
    {
      overrides: {
        authorizeProjectBinding: () => ({ ...allowProject(binding), then() {} }),
      },
      errorCode: RECOVERY_ERROR_CODES.PROJECT_UNAVAILABLE,
    },
    {
      overrides: { createTransactionalRuntime: () => Promise.resolve({}) },
      errorCode: RECOVERY_ERROR_CODES.RUNTIME_INVALID,
    },
    {
      overrides: {
        createTransactionalRuntime: () => Object.freeze({
          then() {},
          recoverProject() {},
          rollbackJob() {},
          finalizeJob() {},
        }),
      },
      errorCode: RECOVERY_ERROR_CODES.RUNTIME_INVALID,
    },
    {
      overrides: {
        createTransactionalRuntime: () => Object.assign(
          Object.create({ then() {} }),
          {
            recoverProject() {},
            rollbackJob() {},
            finalizeJob() {},
          }
        ),
      },
      errorCode: RECOVERY_ERROR_CODES.RUNTIME_INVALID,
    },
    {
      overrides: {
        createTransactionalRuntime: () => Object.freeze({
          recoverProject() { throw new Error('recovery failed'); },
          rollbackJob() { return {}; },
          finalizeJob() { return {}; },
        }),
      },
      errorCode: RECOVERY_ERROR_CODES.RECOVERY_UNKNOWN,
    },
    {
      overrides: {
        createTransactionalRuntime: () => Object.freeze({
          recoverProject: () => ({
            ok: true,
            recovered: 0,
            retainedCommitted: 1,
            retainedUnknown: 0,
          }),
          rollbackJob: () => Promise.resolve({
            ok: true,
            purged: 0,
            rolledBack: 1,
            recoveryRequired: 0,
          }),
          finalizeJob() { return {}; },
        }),
      },
      errorCode: RECOVERY_ERROR_CODES.RECOVERY_FAILED,
    },
  ];
  for (const { overrides, errorCode } of cases) {
    const harness = createRecoveryHarness({ binding, ...overrides });
    const result = harness.service.recoverJob({ jobId: binding.jobId });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorCode, errorCode);
  }
});

// Telemetry may return a rejected native Promise without affecting recovery or the process.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'job-recovery-async-audit', 'e');
  let auditCalls = 0;
  const service = createAgenticDeleteRecoveryService({
    getAuthorizedJobById: () => ({ ok: true, job: terminalJob(binding) }),
    authorizeProjectBinding: () => allowProject(binding),
    createTransactionalRuntime: () => Object.freeze({
      recoverProject: () => ({
        ok: true,
        recovered: 0,
        retainedCommitted: 0,
        retainedUnknown: 0,
      }),
      rollbackJob: () => ({ ok: true, purged: 0, rolledBack: 0, recoveryRequired: 0 }),
      finalizeJob: () => ({ ok: true, purged: 0, rolledBack: 0, recoveryRequired: 0 }),
    }),
    audit() {
      auditCalls += 1;
      return Promise.reject(new Error('telemetry unavailable'));
    },
  });
  assert.strictEqual(service.recoverJob({ jobId: binding.jobId }).ok, true);
  assert.strictEqual(auditCalls, 1);
});

// Audit stays behind the active recovery barrier and cannot start another effectful job.
withProject((rootPath) => {
  const outerBinding = bindingFor(rootPath, 'job-recovery-audit-outer', 'a');
  const nestedBinding = bindingFor(rootPath, 'job-recovery-audit-nested', 'b');
  const jobs = new Map([
    [outerBinding.jobId, terminalJob(outerBinding)],
    [nestedBinding.jobId, terminalJob(nestedBinding)],
  ]);
  let service;
  let nestedResult;
  let runtimeCreations = 0;
  let recoveryEffects = 0;
  let terminalEffects = 0;
  service = createAgenticDeleteRecoveryService({
    getAuthorizedJobById: (jobId) => ({ ok: true, job: jobs.get(jobId) }),
    authorizeProjectBinding(projectId) {
      return allowProject(
        projectId === outerBinding.projectId ? outerBinding : nestedBinding
      );
    },
    createTransactionalRuntime: () => {
      runtimeCreations += 1;
      return Object.freeze({
        recoverProject() {
          recoveryEffects += 1;
          return { ok: true, recovered: 0, retainedCommitted: 0, retainedUnknown: 0 };
        },
        rollbackJob() {
          terminalEffects += 1;
          return { ok: true, purged: 0, rolledBack: 0, recoveryRequired: 0 };
        },
        finalizeJob() { throw new Error('wrong terminal disposition'); },
      });
    },
    audit() {
      nestedResult = service.recoverJob({ jobId: nestedBinding.jobId });
    },
  });

  const outerResult = service.recoverJob({ jobId: outerBinding.jobId });
  assert.deepStrictEqual(outerResult, {
    schemaVersion: 'agentic-delete-recovery-result.v1',
    ok: true,
    status: 'completed',
    disposition: 'rollback',
    errorCode: null,
    idempotent: false,
  });
  assert.strictEqual(nestedResult.errorCode, RECOVERY_ERROR_CODES.RECOVERY_BUSY);
  assert.strictEqual(runtimeCreations, 1);
  assert.strictEqual(recoveryEffects, 1);
  assert.strictEqual(terminalEffects, 1);
  assert.strictEqual(service.diagnostics().active, false);
  assert.strictEqual(service.diagnostics().reentrantAttempts, 1);
});

const strictRejectionProbe = childProcess.spawnSync(
  process.execPath,
  ['--unhandled-rejections=strict', __filename, STRICT_REJECTION_PROBE_FLAG],
  { encoding: 'utf8', timeout: 15_000 }
);
assert.strictEqual(
  strictRejectionProbe.status,
  0,
  `strict rejection probe failed:\n${strictRejectionProbe.stderr || strictRejectionProbe.stdout}`
);
assert.match(strictRejectionProbe.stdout, /strict rejection probe passed/);

console.log('agentic delete recovery service tests passed');
}
