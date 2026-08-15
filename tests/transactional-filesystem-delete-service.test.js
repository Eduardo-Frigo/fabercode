'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  TRANSACTIONAL_FILESYSTEM_DELETE_SERVICE_VERSION,
  TransactionalFilesystemDeleteService,
  createDefaultDeleteDurabilityAdapter,
  createTransactionalFilesystemDeleteService,
} = require('../main/services/transactional_filesystem_delete_service');
const {
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  createAnchoredFilesystemMutationProbe,
} = require('../main/capabilities/anchored_filesystem_mutation_backend_contract');
const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');

const digest = (character) => `sha256:${character.repeat(64)}`;
const testJournalKeysByRoot = new Map();

const testJournalAuthenticator = Object.freeze({
  version: 'transactional-delete.hmac-sha256.v1',
  seal(rootPath, value) {
    const key = path.resolve(rootPath);
    let secret = testJournalKeysByRoot.get(key);
    if (!secret) {
      secret = crypto.randomBytes(32);
      testJournalKeysByRoot.set(key, secret);
    }
    return `hmac-sha256:${crypto
      .createHmac('sha256', secret)
      .update(canonicalSha256Digest(value), 'utf8')
      .digest('hex')}`;
  },
  verify(rootPath, value, authenticationTag) {
    if (typeof authenticationTag !== 'string'
      || !/^hmac-sha256:[a-f0-9]{64}$/.test(authenticationTag)) return false;
    const expected = this.seal(rootPath, value);
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(authenticationTag, 'utf8')
    );
  },
});

function projectBinding(rootPath, overrides = {}) {
  const realRootPath = fs.realpathSync(rootPath);
  return {
    projectId: 'project-a',
    canonicalRootPath: realRootPath,
    realRootPath,
    sessionId: 'session-a',
    jobId: 'job-a',
    kernelId: 'kernel-a',
    submissionDigest: digest('a'),
    ...overrides,
  };
}

function lstatExists(entryPath) {
  try {
    fs.lstatSync(entryPath);
    return true;
  } catch {
    return false;
  }
}

function createTestMutationBackend(fsImpl = fs) {
  const probe = createAnchoredFilesystemMutationProbe({
    backendId: 'test-anchored-backend',
    state: 'enforced',
    guarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
    reasonCode: 'ENFORCED',
  });
  return Object.freeze({
    probe() { return probe; },
    prepare(input) {
      const targets = input.targets.map((target) => ({ ...target }));
      const identities = targets.map((target) => {
        const targetPath = path.join(input.rootPath, ...target.relativePath.split('/'));
        const payloadPath = path.join(input.payloadPath, target.payloadName);
        const stat = lstatExists(targetPath)
          ? fsImpl.lstatSync(targetPath)
          : fsImpl.lstatSync(payloadPath);
        return { dev: stat.dev, ino: stat.ino };
      });
      let closed = false;
      function verify() {
        if (closed) return { verified: false };
        const verified = targets.every((target, index) => {
          try {
            const targetPath = path.join(input.rootPath, ...target.relativePath.split('/'));
            const stat = fsImpl.lstatSync(targetPath);
            return stat.dev === identities[index].dev && stat.ino === identities[index].ino;
          } catch {
            const payloadPath = path.join(input.payloadPath, target.payloadName);
            try {
              const stat = fsImpl.lstatSync(payloadPath);
              return stat.dev === identities[index].dev && stat.ino === identities[index].ino;
            } catch {
              return false;
            }
          }
        });
        return { verified };
      }
      return Object.freeze({
        schemaVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
        verify,
        moveToQuarantine() {
          if (!verify().verified) {
            const error = new Error('anchored identity changed');
            error.code = 'ANCHORED_TARGET_INVALIDATED';
            throw error;
          }
          const moved = [];
          for (const target of targets) {
            const sourcePath = path.join(input.rootPath, ...target.relativePath.split('/'));
            const payloadPath = path.join(input.payloadPath, target.payloadName);
            fsImpl.renameSync(sourcePath, payloadPath);
            moved.push(target.payloadName);
          }
          return { moved };
        },
        restoreFromQuarantine() {
          const restored = [];
          for (let index = targets.length - 1; index >= 0; index -= 1) {
            const target = targets[index];
            const sourcePath = path.join(input.payloadPath, target.payloadName);
            const targetPath = path.join(input.rootPath, ...target.relativePath.split('/'));
            if (lstatExists(sourcePath) && lstatExists(targetPath)) {
              const error = new Error('rollback collision');
              error.code = 'ROLLBACK_COLLISION';
              throw error;
            }
            if (lstatExists(sourcePath)) {
              fsImpl.renameSync(sourcePath, targetPath);
              restored.push(target.payloadName);
            }
          }
          return { restored };
        },
        purgeQuarantine() {
          fsImpl.rmSync(input.transactionPath, { recursive: true, force: false });
          if (lstatExists(input.headPath)) fsImpl.unlinkSync(input.headPath);
          if (lstatExists(input.anchorPath)) {
            fsImpl.rmSync(input.anchorPath, { recursive: true, force: false });
          }
          return { purged: true };
        },
        close() {
          closed = true;
          return { closed: true };
        },
      });
    },
  });
}

function createWrappedTestMutationBackend({ fsImpl = fs, wrapSession }) {
  const base = createTestMutationBackend(fsImpl);
  return Object.freeze({
    probe() { return base.probe(); },
    prepare(input) { return wrapSession(base.prepare(input), input); },
  });
}

function sessionWithOverrides(session, overrides = {}) {
  return Object.freeze({
    schemaVersion: session.schemaVersion,
    verify: overrides.verify || session.verify,
    moveToQuarantine: overrides.moveToQuarantine || session.moveToQuarantine,
    restoreFromQuarantine:
      overrides.restoreFromQuarantine || session.restoreFromQuarantine,
    purgeQuarantine: overrides.purgeQuarantine || session.purgeQuarantine,
    close: overrides.close || session.close,
  });
}

function createHarness(rootPath, overrides = {}) {
  const {
    bindingOverrides = {},
    ...serviceOverrides
  } = overrides;
  let transactionSerial = 0;
  let lifecycleAuthorized = true;
  let rootAuthorized = true;
  const binding = projectBinding(rootPath, bindingOverrides);
  const service = createTransactionalFilesystemDeleteService({
    authorizeLifecycle(candidate) {
      return lifecycleAuthorized
        ? { authorized: true, binding: candidate }
        : { authorized: false };
    },
    authorizeRoot(candidate) {
      return rootAuthorized
        ? {
          authorized: true,
          projectId: candidate.projectId,
          canonicalRootPath: candidate.canonicalRootPath,
          realRootPath: candidate.realRootPath,
        }
        : { authorized: false };
    },
    authorizeEffectFrontier(candidate) {
      return lifecycleAuthorized && rootAuthorized
        ? { authorized: true, binding: candidate }
        : { authorized: false };
    },
    now: (() => {
      let value = 1_000;
      return () => value += 1;
    })(),
    transactionIdFactory() {
      transactionSerial += 1;
      return `transaction-id-${String(transactionSerial).padStart(4, '0')}`;
    },
    journalAuthenticator: testJournalAuthenticator,
    mutationBackend: createTestMutationBackend(serviceOverrides.fs || fs),
    ...serviceOverrides,
  });
  return {
    binding,
    service,
    setLifecycleAuthorized(value) { lifecycleAuthorized = value; },
    setRootAuthorized(value) { rootAuthorized = value; },
  };
}

function prepare(harness, paths) {
  return harness.service.prepare({
    binding: harness.binding,
    paths,
    pathStyle: 'posix',
    caseSensitive: true,
  });
}

function commit(prepared, consumeDecision = () => ({ authorized: true })) {
  return prepared.commit({
    decisionRequestDigest: digest('b'),
    consumeDecision,
  });
}

function withProject(callback) {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-delete-service-'));
  try {
    return callback(rootPath);
  } finally {
    testJournalKeysByRoot.delete(path.resolve(rootPath));
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
}

function entryExists(entryPath) {
  try {
    fs.lstatSync(entryPath);
    return true;
  } catch {
    return false;
  }
}

assert.strictEqual(
  TRANSACTIONAL_FILESYSTEM_DELETE_SERVICE_VERSION,
  'transactional-filesystem-delete-service.v1'
);
assert.throws(() => createTransactionalFilesystemDeleteService(), /unsupported fields/);
assert.throws(() => createTransactionalFilesystemDeleteService({
  authorizeLifecycle() {},
  authorizeRoot() {},
  unknown: true,
}), /unsupported/);
assert.throws(() => createTransactionalFilesystemDeleteService({
  authorizeLifecycle: (candidate) => ({ authorized: true, binding: candidate }),
  authorizeRoot: (candidate) => ({ authorized: true, binding: candidate }),
  authorizeEffectFrontier: (candidate) => ({ authorized: true, binding: candidate }),
  mutationBackend: createTestMutationBackend(),
}), (error) => error.code === 'JOURNAL_AUTHENTICATOR_REQUIRED');

withProject((rootPath) => {
  fs.mkdirSync(path.join(rootPath, 'src'));
  fs.writeFileSync(path.join(rootPath, 'src', 'old.txt'), 'old-text');
  const binary = Buffer.from([0, 255, 1, 254, 2, 253]);
  fs.writeFileSync(path.join(rootPath, 'binary.dat'), binary);
  const externalPath = path.join(path.dirname(rootPath), `${path.basename(rootPath)}-external.txt`);
  fs.writeFileSync(externalPath, 'external-safe');
  fs.symlinkSync(externalPath, path.join(rootPath, 'external-link'));

  try {
    const harness = createHarness(rootPath);
    const prepared = prepare(harness, ['src/old.txt', 'binary.dat', 'external-link']);
    assert.strictEqual(
      fs.existsSync(path.join(rootPath, '.faber', 'transaction-journal.key')),
      false,
      'journal authentication material must never be stored inside the project'
    );
    const inspected = prepared.inspect();
    assert.strictEqual(inspected.state, 'PREPARED');
    assert.strictEqual(inspected.retention, 'until_job_terminal');
    assert.strictEqual(inspected.plan.impact.files, 3);
    assert.strictEqual(inspected.plan.impact.directories, 0);
    assert.strictEqual(prepared.verify().checkpointVerified, true);

    let decisionFacts;
    const result = commit(prepared, (facts) => {
      decisionFacts = facts;
      return { authorized: true };
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.state, 'COMMITTED');
    assert.strictEqual(result.freshApprovalRequired, false);
    assert.strictEqual(decisionFacts.effect, 'filesystem_delete');
    assert.strictEqual(decisionFacts.requestDigest, digest('b'));
    assert.strictEqual(decisionFacts.checkpointVerified, true);
    assert.strictEqual(decisionFacts.exactPathsVerified, true);
    assert.strictEqual(decisionFacts.protectedPathsRejected, true);
    assert.strictEqual(fs.existsSync(path.join(rootPath, 'src', 'old.txt')), false);
    assert.strictEqual(fs.existsSync(path.join(rootPath, 'binary.dat')), false);
    assert.strictEqual(entryExists(path.join(rootPath, 'external-link')), false);
    assert.strictEqual(fs.readFileSync(externalPath, 'utf8'), 'external-safe');
    assert.strictEqual(harness.service.diagnostics().committed, 1);
    assert.strictEqual(
      fs.readdirSync(path.join(rootPath, '.faber', 'transactions')).length,
      1,
      'committed quarantine must be retained until the job terminates'
    );

    const terminal = harness.service.finalizeJob({
      binding: harness.binding,
      outcome: 'failed',
    });
    assert.deepStrictEqual(terminal, {
      ok: true,
      purged: 0,
      rolledBack: 1,
      recoveryRequired: 0,
    });
    assert.strictEqual(fs.readFileSync(path.join(rootPath, 'src', 'old.txt'), 'utf8'), 'old-text');
    assert.deepStrictEqual(fs.readFileSync(path.join(rootPath, 'binary.dat')), binary);
    assert.strictEqual(fs.lstatSync(path.join(rootPath, 'external-link')).isSymbolicLink(), true);
    assert.strictEqual(fs.readlinkSync(path.join(rootPath, 'external-link')), externalPath);
    assert.strictEqual(fs.readFileSync(externalPath, 'utf8'), 'external-safe');
    assert.deepStrictEqual(fs.readdirSync(path.join(rootPath, '.faber', 'transactions')), []);
  } finally {
    fs.rmSync(externalPath, { force: true });
  }
});

withProject((rootPath) => {
  fs.mkdirSync(path.join(rootPath, 'tree', 'sub', 'empty'), { recursive: true });
  fs.writeFileSync(path.join(rootPath, 'tree', 'sub', 'data.bin'), Buffer.from([9, 8, 7]));
  fs.chmodSync(path.join(rootPath, 'tree', 'sub', 'data.bin'), 0o640);
  const originalMtime = new Date('2025-01-02T03:04:05.000Z');
  fs.utimesSync(path.join(rootPath, 'tree', 'sub', 'data.bin'), originalMtime, originalMtime);
  const harness = createHarness(rootPath);
  const prepared = prepare(harness, ['tree']);
  assert.deepStrictEqual(prepared.inspect().plan.impact, {
    schemaVersion: 'transactional-delete.impact.v1',
    contractVersion: 'transactional-delete.v1',
    files: 1,
    bytes: 3,
    directories: 3,
  });
  assert.strictEqual(commit(prepared).state, 'COMMITTED');
  const terminal = harness.service.finalizeJob({ binding: harness.binding, outcome: 'success' });
  assert.strictEqual(terminal.ok, true);
  assert.strictEqual(terminal.purged, 1);
  assert.strictEqual(fs.existsSync(path.join(rootPath, 'tree')), false);
  assert.deepStrictEqual(fs.readdirSync(path.join(rootPath, '.faber', 'transactions')), []);
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'keep.txt'), 'keep');
  const harness = createHarness(rootPath);
  const prepared = prepare(harness, ['keep.txt']);
  let calls = 0;
  const denied = commit(prepared, () => {
    calls += 1;
    return { authorized: false };
  });
  assert.strictEqual(calls, 1);
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.status, 'denied');
  assert.strictEqual(denied.errorCode, 'DECISION_DENIED');
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'keep.txt'), 'utf8'), 'keep');
  assert.deepStrictEqual(fs.readdirSync(path.join(rootPath, '.faber', 'transactions')), []);
  assert.strictEqual(commit(prepared).ok, false, 'a denied prepared handle cannot be replayed');
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, '.env'), 'secret');
  const harness = createHarness(rootPath);
  assert.throws(() => prepare(harness, ['.env']), /protected/i);
  assert.throws(() => prepare(harness, ['../outside']), /traversal|exact|relative/i);
  assert.strictEqual(fs.readFileSync(path.join(rootPath, '.env'), 'utf8'), 'secret');
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'old.txt'), 'old');
  const harness = createHarness(rootPath);
  const prepared = prepare(harness, ['old.txt']);
  fs.writeFileSync(path.join(rootPath, 'old.txt'), 'changed');
  assert.throws(() => prepared.verify(), /changed/i);
  const failed = commit(prepared);
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.freshApprovalRequired, false);
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'old.txt'), 'utf8'), 'changed');
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'old.txt'), 'old');
  const harness = createHarness(rootPath);
  harness.setLifecycleAuthorized(false);
  assert.throws(() => prepare(harness, ['old.txt']), /LIFECYCLE|authorization/i);
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'old.txt'), 'utf8'), 'old');
});

withProject((rootPath) => {
  const harness = createHarness(rootPath);
  assert(new TransactionalFilesystemDeleteService({
    authorizeLifecycle: (candidate) => ({ authorized: true, binding: candidate }),
    authorizeRoot: (candidate) => ({
      authorized: true,
      projectId: candidate.projectId,
      canonicalRootPath: candidate.canonicalRootPath,
      realRootPath: candidate.realRootPath,
    }),
    authorizeEffectFrontier: (candidate) => ({ authorized: true, binding: candidate }),
  }));
  assert.strictEqual(harness.service.recoverProject({ binding: harness.binding }).ok, true);
  const diagnosticsJson = JSON.stringify(harness.service.diagnostics());
  for (const forbidden of [rootPath, 'job-a', 'project-a', 'sha256:', 'transaction-id']) {
    assert.strictEqual(diagnosticsJson.includes(forbidden), false);
  }
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'restart.txt'), 'restart-safe');
  const first = createHarness(rootPath);
  assert.strictEqual(commit(prepare(first, ['restart.txt'])).state, 'COMMITTED');
  const second = createHarness(rootPath);
  const recovered = second.service.recoverProject({ binding: second.binding });
  assert.deepStrictEqual(recovered, {
    ok: true,
    recovered: 0,
    retainedCommitted: 1,
    retainedUnknown: 0,
  });
  assert.strictEqual(fs.existsSync(path.join(rootPath, 'restart.txt')), false);
  const terminal = second.service.finalizeJob({
    binding: second.binding,
    outcome: 'runtime_interrupted',
  });
  assert.strictEqual(terminal.ok, true);
  assert.strictEqual(terminal.rolledBack, 1);
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'restart.txt'), 'utf8'), 'restart-safe');
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'job-a.txt'), 'job-a-safe');
  fs.writeFileSync(path.join(rootPath, 'job-b.txt'), 'job-b-safe');
  const bindingA = {
    jobId: 'job-restart-a',
    sessionId: 'session-restart-a',
    kernelId: 'kernel-restart-a',
    submissionDigest: digest('a'),
  };
  const bindingB = {
    jobId: 'job-restart-b',
    sessionId: 'session-restart-b',
    kernelId: 'kernel-restart-b',
    submissionDigest: digest('b'),
  };
  const firstA = createHarness(rootPath, {
    bindingOverrides: bindingA,
    transactionIdFactory: () => 'transaction-restart-job-a',
  });
  const firstB = createHarness(rootPath, {
    bindingOverrides: bindingB,
    transactionIdFactory: () => 'transaction-restart-job-b',
  });
  assert.strictEqual(commit(prepare(firstA, ['job-a.txt'])).state, 'COMMITTED');
  assert.strictEqual(commit(prepare(firstB, ['job-b.txt'])).state, 'COMMITTED');

  const restartedA = createHarness(rootPath, { bindingOverrides: bindingA });
  assert.deepStrictEqual(restartedA.service.recoverProject({ binding: restartedA.binding }), {
    ok: true,
    recovered: 0,
    retainedCommitted: 1,
    retainedUnknown: 0,
  });
  assert.deepStrictEqual(restartedA.service.rollbackJob({ binding: restartedA.binding }), {
    ok: true,
    purged: 0,
    rolledBack: 1,
    recoveryRequired: 0,
  });
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'job-a.txt'), 'utf8'), 'job-a-safe');
  assert.strictEqual(fs.existsSync(path.join(rootPath, 'job-b.txt')), false);

  const restartedB = createHarness(rootPath, { bindingOverrides: bindingB });
  assert.deepStrictEqual(restartedB.service.recoverProject({ binding: restartedB.binding }), {
    ok: true,
    recovered: 0,
    retainedCommitted: 1,
    retainedUnknown: 0,
  });
  assert.deepStrictEqual(restartedB.service.rollbackJob({ binding: restartedB.binding }), {
    ok: true,
    purged: 0,
    rolledBack: 1,
    recoveryRequired: 0,
  });
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'job-b.txt'), 'utf8'), 'job-b-safe');
  assert.deepStrictEqual(fs.readdirSync(path.join(rootPath, '.faber', 'transactions')), []);
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'foreign.txt'), 'foreign-safe');
  const owner = createHarness(rootPath, {
    bindingOverrides: {
      jobId: 'job-foreign-owner',
      sessionId: 'session-foreign-owner',
      kernelId: 'kernel-foreign-owner',
      submissionDigest: digest('c'),
    },
    transactionIdFactory: () => 'transaction-foreign-owner',
  });
  assert.strictEqual(commit(prepare(owner, ['foreign.txt'])).state, 'COMMITTED');

  let mutationSessionPreparations = 0;
  const baseBackend = createTestMutationBackend();
  const observingBackend = Object.freeze({
    probe: baseBackend.probe,
    prepare(input) {
      mutationSessionPreparations += 1;
      return baseBackend.prepare(input);
    },
  });
  const observer = createHarness(rootPath, {
    bindingOverrides: {
      jobId: 'job-foreign-observer',
      sessionId: 'session-foreign-observer',
      kernelId: 'kernel-foreign-observer',
      submissionDigest: digest('d'),
    },
    mutationBackend: observingBackend,
  });
  assert.deepStrictEqual(observer.service.recoverProject({ binding: observer.binding }), {
    ok: true,
    recovered: 0,
    retainedCommitted: 0,
    retainedUnknown: 0,
  });
  assert.strictEqual(mutationSessionPreparations, 0);
  assert.strictEqual(fs.existsSync(path.join(rootPath, 'foreign.txt')), false);
  assert.strictEqual(
    fs.readdirSync(path.join(rootPath, '.faber', 'transactions')).length,
    1
  );
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'foreign-tampered.txt'), 'foreign-tampered-safe');
  const owner = createHarness(rootPath, {
    bindingOverrides: {
      jobId: 'job-tampered-owner',
      sessionId: 'session-tampered-owner',
      kernelId: 'kernel-tampered-owner',
      submissionDigest: digest('e'),
    },
    transactionIdFactory: () => 'transaction-tampered-owner',
  });
  assert.strictEqual(commit(prepare(owner, ['foreign-tampered.txt'])).state, 'COMMITTED');
  const manifestPath = path.join(
    rootPath,
    '.faber',
    'transactions',
    'transaction-tampered-owner',
    'manifest.json'
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const finalTagCharacter = manifest.authenticationTag.at(-1);
  manifest.authenticationTag = `${manifest.authenticationTag.slice(0, -1)}${
    finalTagCharacter === '0' ? '1' : '0'
  }`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

  const observer = createHarness(rootPath, {
    bindingOverrides: {
      jobId: 'job-tampered-observer',
      sessionId: 'session-tampered-observer',
      kernelId: 'kernel-tampered-observer',
      submissionDigest: digest('f'),
    },
  });
  assert.deepStrictEqual(observer.service.recoverProject({ binding: observer.binding }), {
    ok: false,
    recovered: 0,
    retainedCommitted: 0,
    retainedUnknown: 1,
  });
  assert.strictEqual(fs.existsSync(path.join(rootPath, 'foreign-tampered.txt')), false);
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'partial-a.txt'), 'partial-a');
  fs.writeFileSync(path.join(rootPath, 'partial-b.txt'), 'partial-b');
  let injectPartialRestore = true;
  const mutationBackend = createWrappedTestMutationBackend({
    wrapSession(session, input) {
      return sessionWithOverrides(session, {
        restoreFromQuarantine(frontier) {
          if (!injectPartialRestore) return session.restoreFromQuarantine(frontier);
          injectPartialRestore = false;
          const target = input.targets[input.targets.length - 1];
          fs.renameSync(
            path.join(input.payloadPath, target.payloadName),
            path.join(input.rootPath, ...target.relativePath.split('/'))
          );
          return { restored: [target.payloadName] };
        },
      });
    },
  });
  const harness = createHarness(rootPath, { mutationBackend });
  assert.strictEqual(
    commit(prepare(harness, ['partial-a.txt', 'partial-b.txt'])).state,
    'COMMITTED'
  );
  const firstTerminal = harness.service.finalizeJob({
    binding: harness.binding,
    outcome: 'failed',
  });
  assert.deepStrictEqual(firstTerminal, {
    ok: false,
    purged: 0,
    rolledBack: 0,
    recoveryRequired: 1,
  });
  assert.strictEqual(fs.existsSync(path.join(rootPath, 'partial-a.txt')), false);
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'partial-b.txt'), 'utf8'), 'partial-b');
  assert.strictEqual(
    fs.readdirSync(path.join(rootPath, '.faber', 'transactions')).length,
    1,
    'an incomplete restore must retain its checkpoint'
  );

  const recovered = harness.service.recoverProject({ binding: harness.binding });
  assert.deepStrictEqual(recovered, {
    ok: true,
    recovered: 1,
    retainedCommitted: 0,
    retainedUnknown: 0,
  });
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'partial-a.txt'), 'utf8'), 'partial-a');
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'partial-b.txt'), 'utf8'), 'partial-b');
  assert.deepStrictEqual(fs.readdirSync(path.join(rootPath, '.faber', 'transactions')), []);
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'retry-purge.txt'), 'purge-on-success');
  let leaveCheckpointBehind = true;
  const mutationBackend = createWrappedTestMutationBackend({
    wrapSession(session) {
      return sessionWithOverrides(session, {
        purgeQuarantine(frontier) {
          if (leaveCheckpointBehind) {
            leaveCheckpointBehind = false;
            return { purged: true };
          }
          return session.purgeQuarantine(frontier);
        },
      });
    },
  });
  const harness = createHarness(rootPath, { mutationBackend });
  assert.strictEqual(commit(prepare(harness, ['retry-purge.txt'])).state, 'COMMITTED');
  const interruptedPurge = harness.service.finalizeJob({
    binding: harness.binding,
    outcome: 'success',
  });
  assert.deepStrictEqual(interruptedPurge, {
    ok: false,
    purged: 0,
    rolledBack: 0,
    recoveryRequired: 1,
  });
  assert.strictEqual(
    fs.readdirSync(path.join(rootPath, '.faber', 'transactions')).length,
    1,
    'purged:true is insufficient while checkpoint artifacts remain'
  );
  const resumedPurge = harness.service.finalizeJob({
    binding: harness.binding,
    outcome: 'success',
  });
  assert.deepStrictEqual(resumedPurge, {
    ok: true,
    purged: 1,
    rolledBack: 0,
    recoveryRequired: 0,
  });
  assert.deepStrictEqual(fs.readdirSync(path.join(rootPath, '.faber', 'transactions')), []);
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'precommit-recovery.txt'), 'restore-on-success');
  let rejectFirstRestore = true;
  const mutationBackend = createWrappedTestMutationBackend({
    wrapSession(session) {
      return sessionWithOverrides(session, {
        restoreFromQuarantine(frontier) {
          if (rejectFirstRestore) {
            rejectFirstRestore = false;
            throw new Error('simulated precommit recovery requirement');
          }
          return session.restoreFromQuarantine(frontier);
        },
      });
    },
  });
  const harness = createHarness(rootPath, { mutationBackend });
  assert.strictEqual(commit(prepare(harness, ['precommit-recovery.txt'])).state, 'COMMITTED');
  assert.strictEqual(harness.service.finalizeJob({
    binding: harness.binding,
    outcome: 'failed',
  }).ok, false);
  const successfulTerminalRetry = harness.service.finalizeJob({
    binding: harness.binding,
    outcome: 'success',
  });
  assert.deepStrictEqual(successfulTerminalRetry, {
    ok: true,
    purged: 0,
    rolledBack: 1,
    recoveryRequired: 0,
  });
  assert.strictEqual(
    fs.readFileSync(path.join(rootPath, 'precommit-recovery.txt'), 'utf8'),
    'restore-on-success',
    'a precommit recovery state must never change direction to permanent purge'
  );
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'disk-purging.txt'), 'disk-purging');
  const baseDurability = createDefaultDeleteDurabilityAdapter({ fs, path });
  let rejectRecoveryRecord = false;
  const durability = {
    writeJsonAtomic(filePath, value) {
      const lastRecord = value && Array.isArray(value.records) ? value.records.at(-1) : null;
      if (rejectRecoveryRecord
        && filePath.includes(`${path.sep}journal-generations${path.sep}`)
        && lastRecord
        && lastRecord.stateRecord.state === 'RECOVERY_POST_COMMIT') {
        rejectRecoveryRecord = false;
        throw new Error('simulated crash before recovery anchor');
      }
      return baseDurability.writeJsonAtomic(filePath, value);
    },
    readJson: baseDurability.readJson,
    syncDirectory: baseDurability.syncDirectory,
  };
  let rejectFirstPurge = true;
  const failingBackend = createWrappedTestMutationBackend({
    wrapSession(session) {
      return sessionWithOverrides(session, {
        purgeQuarantine(frontier) {
          if (rejectFirstPurge) {
            rejectFirstPurge = false;
            throw new Error('simulated purge interruption');
          }
          return session.purgeQuarantine(frontier);
        },
      });
    },
  });
  const first = createHarness(rootPath, { durability, mutationBackend: failingBackend });
  assert.strictEqual(commit(prepare(first, ['disk-purging.txt'])).state, 'COMMITTED');
  rejectRecoveryRecord = true;
  assert.strictEqual(first.service.finalizeJob({
    binding: first.binding,
    outcome: 'success',
  }).ok, false);

  const restarted = createHarness(rootPath);
  const resumed = restarted.service.finalizeJob({
    binding: restarted.binding,
    outcome: 'success',
  });
  assert.deepStrictEqual(resumed, {
    ok: true,
    purged: 1,
    rolledBack: 0,
    recoveryRequired: 0,
  });
  assert.deepStrictEqual(fs.readdirSync(path.join(rootPath, '.faber', 'transactions')), []);
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'load-close.txt'), 'close-on-load-failure');
  const first = createHarness(rootPath);
  assert.strictEqual(commit(prepare(first, ['load-close.txt'])).state, 'COMMITTED');
  const transactionsPath = path.join(rootPath, '.faber', 'transactions');
  const transactionId = fs.readdirSync(transactionsPath)[0];
  fs.writeFileSync(
    path.join(transactionsPath, transactionId, 'payload', 'unexpected'),
    'tampered'
  );
  let closeCalls = 0;
  const mutationBackend = createWrappedTestMutationBackend({
    wrapSession(session) {
      return sessionWithOverrides(session, {
        close() {
          closeCalls += 1;
          return session.close();
        },
      });
    },
  });
  const restarted = createHarness(rootPath, { mutationBackend });
  const recovery = restarted.service.recoverProject({ binding: restarted.binding });
  assert.strictEqual(recovery.ok, false);
  assert.strictEqual(recovery.retainedUnknown, 1);
  assert.strictEqual(closeCalls, 1, 'a failed discovery load must close its mutation session');
  assert.strictEqual(fs.readdirSync(transactionsPath).length, 1);
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'partial-purge.txt'), 'partial-purge');
  let interruptAfterCheckpointRemoval = true;
  const mutationBackend = createWrappedTestMutationBackend({
    wrapSession(session, input) {
      return sessionWithOverrides(session, {
        purgeQuarantine(frontier) {
          if (interruptAfterCheckpointRemoval) {
            interruptAfterCheckpointRemoval = false;
            fs.rmSync(input.transactionPath, { recursive: true, force: false });
            throw new Error('interrupted after irreversible checkpoint removal');
          }
          return session.purgeQuarantine(frontier);
        },
      });
    },
  });
  const harness = createHarness(rootPath, { mutationBackend });
  assert.strictEqual(commit(prepare(harness, ['partial-purge.txt'])).state, 'COMMITTED');
  assert.strictEqual(harness.service.finalizeJob({
    binding: harness.binding,
    outcome: 'success',
  }).ok, false);
  const resumed = harness.service.finalizeJob({
    binding: harness.binding,
    outcome: 'success',
  });
  assert.deepStrictEqual(resumed, {
    ok: true,
    purged: 1,
    rolledBack: 0,
    recoveryRequired: 0,
  });
  assert.deepStrictEqual(
    fs.readdirSync(path.join(rootPath, '.faber', 'transaction-heads')),
    [],
    'an interrupted purge must finish removing authenticated metadata'
  );
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'foreign-orphan.txt'), 'foreign-orphan');
  const ownerBinding = {
    jobId: 'job-orphan-owner',
    sessionId: 'session-orphan-owner',
    kernelId: 'kernel-orphan-owner',
    submissionDigest: digest('1'),
  };
  let interruptAfterTransactionRemoval = true;
  const interruptedBackend = createWrappedTestMutationBackend({
    wrapSession(session, input) {
      return sessionWithOverrides(session, {
        purgeQuarantine(frontier) {
          if (interruptAfterTransactionRemoval) {
            interruptAfterTransactionRemoval = false;
            fs.rmSync(input.transactionPath, { recursive: true, force: false });
            throw new Error('crash after transaction removal and before head cleanup');
          }
          return session.purgeQuarantine(frontier);
        },
      });
    },
  });
  const firstOwner = createHarness(rootPath, {
    bindingOverrides: ownerBinding,
    mutationBackend: interruptedBackend,
    transactionIdFactory: () => 'transaction-foreign-orphan-owner',
  });
  assert.strictEqual(commit(prepare(firstOwner, ['foreign-orphan.txt'])).state, 'COMMITTED');
  assert.deepStrictEqual(firstOwner.service.finalizeJob({
    binding: firstOwner.binding,
    outcome: 'success',
  }), {
    ok: false,
    purged: 0,
    rolledBack: 0,
    recoveryRequired: 1,
  });

  const transactionsPath = path.join(rootPath, '.faber', 'transactions');
  const headsPath = path.join(rootPath, '.faber', 'transaction-heads');
  const transactionId = 'transaction-foreign-orphan-owner';
  const headPath = path.join(headsPath, `${transactionId}.json`);
  const anchorPath = path.join(headsPath, transactionId);
  assert.deepStrictEqual(fs.readdirSync(transactionsPath), []);
  assert.strictEqual(lstatExists(headPath), true);
  assert.strictEqual(lstatExists(anchorPath), true);

  const observer = createHarness(rootPath, {
    bindingOverrides: {
      jobId: 'job-orphan-observer',
      sessionId: 'session-orphan-observer',
      kernelId: 'kernel-orphan-observer',
      submissionDigest: digest('2'),
    },
  });
  assert.deepStrictEqual(observer.service.recoverProject({ binding: observer.binding }), {
    ok: true,
    recovered: 0,
    retainedCommitted: 0,
    retainedUnknown: 0,
  });
  assert.strictEqual(lstatExists(headPath), true, 'a foreign authenticated head must be retained');
  assert.strictEqual(
    lstatExists(anchorPath),
    true,
    'a foreign authenticated anchor chain must be retained'
  );

  const restartedOwner = createHarness(rootPath, { bindingOverrides: ownerBinding });
  assert.deepStrictEqual(restartedOwner.service.recoverProject({
    binding: restartedOwner.binding,
  }), {
    ok: true,
    recovered: 1,
    retainedCommitted: 0,
    retainedUnknown: 0,
  });
  assert.strictEqual(lstatExists(headPath), false);
  assert.strictEqual(lstatExists(anchorPath), false);
});

for (const orphanCorruption of ['tampered-anchor', 'unreadable-head']) {
  withProject((rootPath) => {
    const targetName = `${orphanCorruption}.txt`;
    const transactionId = `transaction-orphan-${orphanCorruption}`;
    fs.writeFileSync(path.join(rootPath, targetName), orphanCorruption);
    const interruptedBackend = createWrappedTestMutationBackend({
      wrapSession(session, input) {
        return sessionWithOverrides(session, {
          purgeQuarantine() {
            fs.rmSync(input.transactionPath, { recursive: true, force: false });
            throw new Error('crash after transaction removal and before metadata cleanup');
          },
        });
      },
    });
    const owner = createHarness(rootPath, {
      bindingOverrides: {
        jobId: `job-owner-${orphanCorruption}`,
        sessionId: `session-owner-${orphanCorruption}`,
        kernelId: `kernel-owner-${orphanCorruption}`,
        submissionDigest: digest('3'),
      },
      mutationBackend: interruptedBackend,
      transactionIdFactory: () => transactionId,
    });
    assert.strictEqual(commit(prepare(owner, [targetName])).state, 'COMMITTED');
    assert.strictEqual(owner.service.finalizeJob({
      binding: owner.binding,
      outcome: 'success',
    }).ok, false);

    const headsPath = path.join(rootPath, '.faber', 'transaction-heads');
    const headPath = path.join(headsPath, `${transactionId}.json`);
    const anchorPath = path.join(headsPath, transactionId);
    if (orphanCorruption === 'tampered-anchor') {
      const oldestAnchorPath = path.join(anchorPath, fs.readdirSync(anchorPath).sort()[0]);
      const oldestAnchor = JSON.parse(fs.readFileSync(oldestAnchorPath, 'utf8'));
      oldestAnchor.manifestDigest = digest('4');
      fs.writeFileSync(oldestAnchorPath, `${JSON.stringify(oldestAnchor)}\n`, 'utf8');
    } else {
      fs.writeFileSync(headPath, '{', 'utf8');
    }

    const observer = createHarness(rootPath, {
      bindingOverrides: {
        jobId: `job-observer-${orphanCorruption}`,
        sessionId: `session-observer-${orphanCorruption}`,
        kernelId: `kernel-observer-${orphanCorruption}`,
        submissionDigest: digest('5'),
      },
    });
    assert.deepStrictEqual(observer.service.recoverProject({ binding: observer.binding }), {
      ok: false,
      recovered: 0,
      retainedCommitted: 0,
      retainedUnknown: 1,
    });
    assert.strictEqual(lstatExists(headPath), true);
    assert.strictEqual(lstatExists(anchorPath), true);
  });
}

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'invalid-session.txt'), 'invalid-session');
  let closeCalls = 0;
  const probe = createAnchoredFilesystemMutationProbe({
    backendId: 'invalid-session-test-backend',
    state: 'enforced',
    guarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
    reasonCode: 'ENFORCED',
  });
  const malformedBackend = Object.freeze({
    probe() { return probe; },
    prepare() {
      return {
        schemaVersion: 'malformed-session.v1',
        close() {
          closeCalls += 1;
          return { closed: true };
        },
      };
    },
  });
  const harness = createHarness(rootPath, { mutationBackend: malformedBackend });
  assert.throws(
    () => prepare(harness, ['invalid-session.txt']),
    (error) => error.code === 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE'
  );
  assert.strictEqual(closeCalls, 1, 'a malformed prepared session must be closed best-effort');
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'invalid-session.txt'), 'utf8'), 'invalid-session');
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'a.txt'), 'a');
  fs.writeFileSync(path.join(rootPath, 'b.txt'), 'b');
  const first = createHarness(rootPath);
  prepare(first, ['a.txt']);
  prepare(first, ['b.txt']);
  const transactionsPath = path.join(rootPath, '.faber', 'transactions');
  const ids = fs.readdirSync(transactionsPath).sort();
  assert.strictEqual(ids.length, 2);
  const generationsA = path.join(transactionsPath, ids[0], 'journal-generations');
  const generationsB = path.join(transactionsPath, ids[1], 'journal-generations');
  const latestA = fs.readdirSync(generationsA).sort().at(-1);
  const latestB = fs.readdirSync(generationsB).sort().at(-1);
  const journalAPath = path.join(generationsA, latestA);
  const journalBPath = path.join(generationsB, latestB);
  const journalA = fs.readFileSync(journalAPath);
  const journalB = fs.readFileSync(journalBPath);
  fs.writeFileSync(journalAPath, journalB);
  fs.writeFileSync(journalBPath, journalA);
  const second = createHarness(rootPath);
  const result = second.service.recoverProject({ binding: second.binding });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.retainedUnknown, 2);
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'a.txt'), 'utf8'), 'a');
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'b.txt'), 'utf8'), 'b');
  assert.strictEqual(fs.readdirSync(transactionsPath).length, 2, 'swapped WALs must be retained');
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'crash.txt'), 'recover-after-crash');
  const first = createHarness(rootPath);
  const prepared = prepare(first, ['crash.txt']);
  const transactionsPath = path.join(rootPath, '.faber', 'transactions');
  const transactionId = fs.readdirSync(transactionsPath)[0];
  const transactionPath = path.join(transactionsPath, transactionId);
  const journalPath = path.join(transactionPath, 'journal.json');
  const headPath = path.join(rootPath, '.faber', 'transaction-heads', `${transactionId}.json`);
  const anchorPath = path.join(rootPath, '.faber', 'transaction-heads', transactionId);
  let applyingJournal;
  let applyingHead;
  let applyingAnchors;
  assert.strictEqual(commit(prepared, () => {
    applyingJournal = fs.readFileSync(journalPath);
    applyingHead = fs.readFileSync(headPath);
    applyingAnchors = new Map(fs.readdirSync(anchorPath).map((name) => [
      name,
      fs.readFileSync(path.join(anchorPath, name)),
    ]));
    return { authorized: true };
  }).ok, true);
  fs.writeFileSync(journalPath, applyingJournal);
  fs.writeFileSync(headPath, applyingHead);
  for (const name of fs.readdirSync(anchorPath)) fs.unlinkSync(path.join(anchorPath, name));
  for (const [name, bytes] of applyingAnchors) fs.writeFileSync(path.join(anchorPath, name), bytes);

  const second = createHarness(rootPath);
  const result = second.service.recoverProject({ binding: second.binding });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.recovered, 1);
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'crash.txt'), 'utf8'), 'recover-after-crash');
  assert.deepStrictEqual(fs.readdirSync(transactionsPath), []);
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'replay.txt'), 'anti-replay');
  const first = createHarness(rootPath);
  const prepared = prepare(first, ['replay.txt']);
  const transactionsPath = path.join(rootPath, '.faber', 'transactions');
  const transactionId = fs.readdirSync(transactionsPath)[0];
  const transactionPath = path.join(transactionsPath, transactionId);
  const anchorPath = path.join(rootPath, '.faber', 'transaction-heads', transactionId);
  let oldAnchorNames;
  assert.strictEqual(commit(prepared, () => {
    oldAnchorNames = fs.readdirSync(anchorPath).sort();
    return { authorized: true };
  }).ok, true);
  const currentAnchorNames = fs.readdirSync(anchorPath).sort();
  const committedAnchor = currentAnchorNames.find((name) => !oldAnchorNames.includes(name));
  assert(committedAnchor);
  fs.unlinkSync(path.join(anchorPath, committedAnchor));
  const second = createHarness(rootPath);
  const result = second.service.recoverProject({ binding: second.binding });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.retainedUnknown, 1);
  assert.strictEqual(fs.existsSync(path.join(rootPath, 'replay.txt')), false);
  assert.strictEqual(fs.readdirSync(transactionsPath).length, 1);
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'truncated.txt'), 'truncated-safe');
  const first = createHarness(rootPath);
  assert.strictEqual(commit(prepare(first, ['truncated.txt'])).ok, true);
  const transactionsPath = path.join(rootPath, '.faber', 'transactions');
  const transactionId = fs.readdirSync(transactionsPath)[0];
  const generationsPath = path.join(transactionsPath, transactionId, 'journal-generations');
  const latestGeneration = fs.readdirSync(generationsPath).sort().at(-1);
  fs.writeFileSync(path.join(generationsPath, latestGeneration), '{');
  const second = createHarness(rootPath);
  const result = second.service.recoverProject({ binding: second.binding });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.retainedUnknown, 1);
  assert.strictEqual(fs.existsSync(path.join(rootPath, 'truncated.txt')), false);
  assert.strictEqual(fs.readdirSync(transactionsPath).length, 1);
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'collision.txt'), 'checkpoint-original');
  const harness = createHarness(rootPath);
  assert.strictEqual(commit(prepare(harness, ['collision.txt'])).ok, true);
  fs.writeFileSync(path.join(rootPath, 'collision.txt'), 'recreated-do-not-overwrite');
  const terminal = harness.service.finalizeJob({
    binding: harness.binding,
    outcome: 'failed',
  });
  assert.strictEqual(terminal.ok, false);
  assert.strictEqual(terminal.recoveryRequired, 1);
  assert.strictEqual(
    fs.readFileSync(path.join(rootPath, 'collision.txt'), 'utf8'),
    'recreated-do-not-overwrite'
  );
  assert.strictEqual(
    fs.readdirSync(path.join(rootPath, '.faber', 'transactions')).length,
    1,
    'collision must retain the checkpoint for manual recovery'
  );
});

for (let failingRename = 1; failingRename <= 3; failingRename += 1) {
  withProject((rootPath) => {
    for (const name of ['one.txt', 'two.txt', 'three.txt']) {
      fs.writeFileSync(path.join(rootPath, name), name);
    }
    let renameCalls = 0;
    let armed = false;
    const injectedFs = new Proxy(fs, {
      get(target, property) {
        if (property !== 'renameSync') return Reflect.get(target, property);
        return (...args) => {
          const destination = String(args[1]);
          const isDeleteEffect = armed
            && destination.includes(`${path.sep}.faber${path.sep}transactions${path.sep}`)
            && destination.includes(`${path.sep}payload${path.sep}`);
          if (isDeleteEffect) renameCalls += 1;
          if (isDeleteEffect && renameCalls === failingRename) {
            const error = new Error('injected rename failure');
            error.code = failingRename === 1 ? 'EXDEV' : 'EACCES';
            throw error;
          }
          return target.renameSync(...args);
        };
      },
    });
    const harness = createHarness(rootPath, { fs: injectedFs });
    const prepared = prepare(harness, ['one.txt', 'two.txt', 'three.txt']);
    armed = true;
    const result = commit(prepared);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.freshApprovalRequired, true);
    for (const name of ['one.txt', 'two.txt', 'three.txt']) {
      assert.strictEqual(fs.readFileSync(path.join(rootPath, name), 'utf8'), name);
    }
    assert.deepStrictEqual(fs.readdirSync(path.join(rootPath, '.faber', 'transactions')), []);
  });
}

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'promise.txt'), 'promise-safe');
  const harness = createHarness(rootPath);
  const result = commit(prepare(harness, ['promise.txt']), () => Promise.resolve({ authorized: true }));
  assert.strictEqual(result.status, 'denied');
  assert.strictEqual(result.freshApprovalRequired, false);
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'promise.txt'), 'utf8'), 'promise-safe');
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'journal-failure.txt'), 'journal-safe');
  const base = createDefaultDeleteDurabilityAdapter({ fs, path });
  let writes = 0;
  let armed = false;
  const durability = {
    writeJsonAtomic(filePath, value) {
      writes += 1;
      if (armed
        && filePath.includes(`${path.sep}journal-generations${path.sep}`)
        && value.moved
        && value.moved.length === 1) {
        armed = false;
        const error = new Error('disk full');
        error.code = 'ENOSPC';
        throw error;
      }
      return base.writeJsonAtomic(filePath, value);
    },
    readJson: base.readJson,
    syncDirectory: base.syncDirectory,
  };
  const harness = createHarness(rootPath, { durability });
  const prepared = prepare(harness, ['journal-failure.txt']);
  armed = true;
  const result = commit(prepared);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.freshApprovalRequired, true);
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'journal-failure.txt'), 'utf8'), 'journal-safe');
});

withProject((rootPath) => {
  const originalPath = path.join(rootPath, 'hardlink-original.bin');
  const selectedPath = path.join(rootPath, 'hardlink-selected.bin');
  fs.writeFileSync(originalPath, Buffer.from([5, 4, 3, 2, 1]));
  fs.linkSync(originalPath, selectedPath);
  const originalInode = fs.lstatSync(originalPath).ino;
  const harness = createHarness(rootPath);
  assert.strictEqual(commit(prepare(harness, ['hardlink-selected.bin'])).ok, true);
  assert.strictEqual(fs.lstatSync(originalPath).ino, originalInode);
  harness.service.rollbackJob({ binding: harness.binding, reason: 'failed' });
  assert.strictEqual(fs.lstatSync(selectedPath).ino, originalInode);
  assert.strictEqual(fs.lstatSync(originalPath).ino, fs.lstatSync(selectedPath).ino);

  assert.throws(
    () => prepare(harness, ['hardlink-original.bin', 'hardlink-selected.bin']),
    /same physical|alias/i
  );
});

withProject((rootPath) => {
  const externalPath = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-delete-external-dir-'));
  try {
    fs.writeFileSync(path.join(externalPath, 'external.txt'), 'never-delete');
    fs.symlinkSync(externalPath, path.join(rootPath, 'linked-dir'));
    const harness = createHarness(rootPath);
    assert.throws(
      () => prepare(harness, ['linked-dir/external.txt']),
      /symlink ancestor/i
    );
    assert.strictEqual(fs.readFileSync(path.join(externalPath, 'external.txt'), 'utf8'), 'never-delete');
  } finally {
    fs.rmSync(externalPath, { recursive: true, force: true });
  }
});

withProject((rootPath) => {
  const externalPath = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-delete-swap-dir-'));
  try {
    fs.mkdirSync(path.join(rootPath, 'safe-dir'));
    fs.writeFileSync(path.join(rootPath, 'safe-dir', 'victim.txt'), 'project');
    fs.writeFileSync(path.join(externalPath, 'victim.txt'), 'external');
    let lifecycleCalls = 0;
    let swapped = false;
    const baseBinding = projectBinding(rootPath);
    const harness = createHarness(rootPath, {
      authorizeLifecycle(candidate) {
        lifecycleCalls += 1;
        if (!swapped && lifecycleCalls === 4) {
          fs.renameSync(path.join(rootPath, 'safe-dir'), path.join(rootPath, 'safe-dir-original'));
          fs.symlinkSync(externalPath, path.join(rootPath, 'safe-dir'));
          swapped = true;
        }
        return { authorized: true, binding: candidate };
      },
      authorizeRoot(candidate) {
        return {
          authorized: true,
          projectId: candidate.projectId,
          canonicalRootPath: candidate.canonicalRootPath,
          realRootPath: candidate.realRootPath,
        };
      },
    });
    assert.deepStrictEqual(harness.binding, baseBinding);
    const result = commit(prepare(harness, ['safe-dir/victim.txt']));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.freshApprovalRequired, false);
    assert.strictEqual(fs.readFileSync(path.join(externalPath, 'victim.txt'), 'utf8'), 'external');
    assert.strictEqual(
      fs.readFileSync(path.join(rootPath, 'safe-dir-original', 'victim.txt'), 'utf8'),
      'project'
    );
  } finally {
    fs.rmSync(externalPath, { recursive: true, force: true });
  }
});

withProject((rootPath) => {
  fs.mkdirSync(path.join(rootPath, 'too-many'));
  for (let index = 0; index < 33; index += 1) {
    fs.writeFileSync(path.join(rootPath, 'too-many', `${index}.txt`), String(index));
  }
  const harness = createHarness(rootPath);
  assert.throws(() => prepare(harness, ['too-many']), /hard caps|between 1 and/i);
  assert.strictEqual(fs.readdirSync(path.join(rootPath, 'too-many')).length, 33);
});

withProject((rootPath) => {
  fs.mkdirSync(path.join(rootPath, 'tree'));
  fs.mkdirSync(path.join(rootPath, 'tree', 'nested'));
  fs.writeFileSync(path.join(rootPath, 'tree', 'nested', 'leaf.txt'), 'leaf');
  const baseBackend = createTestMutationBackend();
  let checkpointEntries = null;
  const capturingBackend = Object.freeze({
    probe() { return baseBackend.probe(); },
    prepare(input) {
      checkpointEntries = input.checkpointEntries;
      return baseBackend.prepare(input);
    },
  });
  const harness = createHarness(rootPath, { mutationBackend: capturingBackend });
  const prepared = prepare(harness, ['tree']);
  assert.deepStrictEqual(
    checkpointEntries.map((entry) => entry.relativePath),
    ['tree', 'tree/nested', 'tree/nested/leaf.txt']
  );
  assert(Object.isFrozen(checkpointEntries));
  assert(checkpointEntries.every(Object.isFrozen));
  assert.strictEqual(prepared.abort({ reason: 'test_complete' }).ok, true);
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'unsupported.txt'), 'no-effect');
  const binding = projectBinding(rootPath);
  const unsupported = createTransactionalFilesystemDeleteService({
    authorizeLifecycle: (candidate) => ({ authorized: true, binding: candidate }),
    authorizeRoot: (candidate) => ({
      authorized: true,
      projectId: candidate.projectId,
      canonicalRootPath: candidate.canonicalRootPath,
      realRootPath: candidate.realRootPath,
    }),
    authorizeEffectFrontier: (candidate) => ({ authorized: true, binding: candidate }),
  });
  assert.throws(() => unsupported.prepare({
    binding,
    paths: ['unsupported.txt'],
    pathStyle: 'posix',
    caseSensitive: true,
  }), (error) => error.code === 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE');
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'unsupported.txt'), 'utf8'), 'no-effect');
  assert.strictEqual(fs.existsSync(path.join(rootPath, '.faber')), false);
});

withProject((rootPath) => {
  fs.mkdirSync(path.join(rootPath, 'safe'));
  fs.writeFileSync(path.join(rootPath, 'safe', 'victim.txt'), 'project-victim');
  const externalPath = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-delete-consume-swap-'));
  try {
    fs.writeFileSync(path.join(externalPath, 'victim.txt'), 'external-victim');
    const harness = createHarness(rootPath);
    const prepared = prepare(harness, ['safe/victim.txt']);
    const result = commit(prepared, () => {
      fs.renameSync(path.join(rootPath, 'safe'), path.join(rootPath, 'safe-original'));
      fs.symlinkSync(externalPath, path.join(rootPath, 'safe'));
      return { authorized: true };
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.freshApprovalRequired, true);
    assert.strictEqual(fs.readFileSync(path.join(externalPath, 'victim.txt'), 'utf8'), 'external-victim');
    assert.strictEqual(
      fs.readFileSync(path.join(rootPath, 'safe-original', 'victim.txt'), 'utf8'),
      'project-victim'
    );
  } finally {
    fs.rmSync(externalPath, { recursive: true, force: true });
  }
});

withProject((rootPath) => {
  fs.writeFileSync(path.join(rootPath, 'frontier.txt'), 'frontier-safe');
  let consumed = 0;
  const harness = createHarness(rootPath, {
    authorizeEffectFrontier() {
      return { authorized: false };
    },
  });
  const result = commit(prepare(harness, ['frontier.txt']), () => {
    consumed += 1;
    return { authorized: true };
  });
  assert.strictEqual(consumed, 1);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.freshApprovalRequired, true);
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'frontier.txt'), 'utf8'), 'frontier-safe');
});

withProject((rootPath) => {
  fs.mkdirSync(path.join(rootPath, 'bounded'));
  for (let index = 0; index < 100; index += 1) {
    fs.writeFileSync(path.join(rootPath, 'bounded', `${String(index).padStart(3, '0')}.txt`), 'x');
  }
  let targetReads = 0;
  const countingFs = new Proxy(fs, {
    get(target, property) {
      if (property !== 'openSync') return Reflect.get(target, property);
      return (...args) => {
        if (String(args[0]).includes(`${path.sep}bounded${path.sep}`)) targetReads += 1;
        return target.openSync(...args);
      };
    },
  });
  const harness = createHarness(rootPath, { fs: countingFs });
  assert.throws(() => prepare(harness, ['bounded']), /hard caps/i);
  assert.strictEqual(targetReads, 32, 'the 33rd file must be rejected before it is read');
});

withProject((rootPath) => {
  const largePath = path.join(rootPath, 'large.bin');
  fs.writeFileSync(largePath, Buffer.alloc(1));
  fs.truncateSync(largePath, (16 * 1024 * 1024) + 1);
  let targetReads = 0;
  const countingFs = new Proxy(fs, {
    get(target, property) {
      if (property !== 'openSync') return Reflect.get(target, property);
      return (...args) => {
        if (String(args[0]) === largePath) targetReads += 1;
        return target.openSync(...args);
      };
    },
  });
  const harness = createHarness(rootPath, { fs: countingFs });
  assert.throws(() => prepare(harness, ['large.bin']), /hard caps/i);
  assert.strictEqual(targetReads, 0, 'oversized files must be denied before reading bytes');
});

for (const crashPoint of ['generation', 'anchor', 'journal-cache', 'head-cache']) {
  withProject((rootPath) => {
    fs.writeFileSync(path.join(rootPath, `crash-${crashPoint}.txt`), crashPoint);
    const base = createDefaultDeleteDurabilityAdapter({ fs, path });
    let armed = false;
    let injected = false;
    const durability = {
      writeJsonAtomic(filePath, value) {
        const isMovedGeneration = filePath.includes(`${path.sep}journal-generations${path.sep}`)
          && value.moved
          && value.moved.length === 1;
        const isMovedAnchor = filePath.includes(`${path.sep}transaction-heads${path.sep}transaction-id-`)
          && value.latestState === 'APPLYING'
          && value.revision >= 4;
        const isJournalCache = filePath.endsWith(`${path.sep}journal.json`)
          && value.moved
          && value.moved.length === 1;
        const isHeadCache = filePath.includes(`${path.sep}transaction-heads${path.sep}`)
          && filePath.endsWith('.json')
          && !filePath.includes(`${path.sep}transaction-id-`)
          && value.latestState === 'APPLYING';
        const shouldFail = armed && !injected && (
          (crashPoint === 'generation' && isMovedGeneration)
          || (crashPoint === 'anchor' && isMovedAnchor)
          || (crashPoint === 'journal-cache' && isJournalCache)
          || (crashPoint === 'head-cache' && isHeadCache)
        );
        if (shouldFail) {
          injected = true;
          const error = new Error(`crash at ${crashPoint}`);
          error.code = 'ENOSPC';
          throw error;
        }
        return base.writeJsonAtomic(filePath, value);
      },
      readJson: base.readJson,
      syncDirectory: base.syncDirectory,
    };
    const harness = createHarness(rootPath, { durability });
    const prepared = prepare(harness, [`crash-${crashPoint}.txt`]);
    armed = true;
    const result = commit(prepared);
    if (crashPoint === 'journal-cache' || crashPoint === 'head-cache') {
      assert.strictEqual(result.ok, true, `${crashPoint} is a replaceable cache failure`);
      return;
    }
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.freshApprovalRequired, true);
    const restarted = createHarness(rootPath);
    const recovery = restarted.service.recoverProject({ binding: restarted.binding });
    assert.strictEqual(recovery.ok, true, crashPoint);
    assert.strictEqual(
      fs.readFileSync(path.join(rootPath, `crash-${crashPoint}.txt`), 'utf8'),
      crashPoint
    );
  });
}

console.log('transactional filesystem delete service tests passed');
