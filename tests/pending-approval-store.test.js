'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  APPROVAL_REASONS,
  createPendingApprovalStore,
} = require('../main/capabilities/pending_approval_store');

function createClock(initial = 5_000) {
  let current = initial;
  return {
    now: () => current,
    advance: (milliseconds) => { current += milliseconds; },
  };
}

function request(rootPath, overrides = {}) {
  return {
    requestDigest: 'sha256:request-a',
    projectId: 'project-a',
    rootPath,
    sessionId: 'session-a',
    jobId: 'job-a',
    selector: {
      capabilityId: 'process.execute',
      effects: ['execute'],
      resourceDigest: 'sha256:command-a',
    },
    ...overrides,
  };
}

function createRootAuthorizer(projectRoots) {
  return ({ projectId, rootPath }) => {
    const registeredRoot = projectRoots.get(projectId);
    if (!registeredRoot) return { authorized: false };
    const canonicalRootPath = path.resolve(registeredRoot);
    const requestedRootPath = path.resolve(rootPath);
    const realRootPath = fs.realpathSync.native(canonicalRootPath);
    let requestedRealPath = '';
    try {
      requestedRealPath = fs.realpathSync.native(requestedRootPath);
    } catch {
      return { authorized: false };
    }
    if (requestedRootPath !== canonicalRootPath && requestedRealPath !== realRootPath) {
      return { authorized: false };
    }
    return {
      authorized: true,
      projectId,
      canonicalRootPath,
      realRootPath,
    };
  };
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-pending-approvals-'));
  const projectA = path.join(tempRoot, 'project-a');
  const projectB = path.join(tempRoot, 'project-b');
  fs.mkdirSync(projectA);
  fs.mkdirSync(projectB);

  try {
    const clock = createClock();
    let sequence = 0;
    const projectRoots = new Map([
      ['project-a', projectA],
      ['project-b', projectB],
    ]);
    const authorizeRoot = createRootAuthorizer(projectRoots);
    assert.throws(() => createPendingApprovalStore(), /authorizeRoot/);
    const store = createPendingApprovalStore({
      now: clock.now,
      idFactory: () => `approval-${++sequence}`,
      authorizeRoot,
      defaultTtlMs: 100,
      maxTtlMs: 1_000,
    });

    const created = store.create(request(projectA));
    assert.strictEqual(created.ok, true);
    assert.strictEqual(created.reason, APPROVAL_REASONS.CREATED);
    assert.strictEqual(created.approval.approvalId, 'approval-1');
    assert.strictEqual(created.approval.status, 'pending');
    assert(Object.isFrozen(created.approval));
    assert(Object.isFrozen(created.approval.selector));
    assert.strictEqual(created.approval.realRootPath, fs.realpathSync.native(projectA));

    const digestMismatch = store.resolve({
      approvalId: 'approval-1',
      requestDigest: 'sha256:request-tampered',
      decision: 'allow',
    });
    assert.strictEqual(digestMismatch.resolved, false);
    assert.strictEqual(digestMismatch.reason, APPROVAL_REASONS.DIGEST_MISMATCH);
    assert.strictEqual(store.get('approval-1').status, 'pending');

    projectRoots.delete('project-a');
    const rootAuthorizationRevoked = store.resolve({
      approvalId: 'approval-1',
      requestDigest: 'sha256:request-a',
      projectId: 'project-a',
      rootPath: projectA,
      sessionId: 'session-a',
      jobId: 'job-a',
      decision: 'allow',
    });
    assert.strictEqual(rootAuthorizationRevoked.reason, APPROVAL_REASONS.CONTEXT_MISMATCH);
    assert.strictEqual(store.get('approval-1').status, 'pending');
    projectRoots.set('project-a', projectA);

    const missingContext = store.resolve({
      approvalId: 'approval-1',
      requestDigest: 'sha256:request-a',
      decision: 'allow',
    });
    assert.strictEqual(missingContext.resolved, false);
    assert.strictEqual(missingContext.reason, APPROVAL_REASONS.CONTEXT_MISMATCH);
    assert.strictEqual(store.get('approval-1').status, 'pending');

    const contextMismatch = store.resolve({
      approvalId: 'approval-1',
      requestDigest: 'sha256:request-a',
      projectId: 'project-b',
      rootPath: projectB,
      sessionId: 'session-a',
      jobId: 'job-a',
      decision: 'allow',
    });
    assert.strictEqual(contextMismatch.reason, APPROVAL_REASONS.CONTEXT_MISMATCH);
    assert.strictEqual(store.get('approval-1').status, 'pending');

    const sessionMismatch = store.resolve({
      approvalId: 'approval-1',
      requestDigest: 'sha256:request-a',
      projectId: 'project-a',
      rootPath: projectA,
      sessionId: 'session-b',
      jobId: 'job-a',
      decision: 'allow',
    });
    assert.strictEqual(sessionMismatch.reason, APPROVAL_REASONS.CONTEXT_MISMATCH);
    assert.strictEqual(store.get('approval-1').status, 'pending');

    const resolved = store.resolve({
      approvalId: 'approval-1',
      requestDigest: 'sha256:request-a',
      projectId: 'project-a',
      rootPath: projectA,
      sessionId: 'session-a',
      jobId: 'job-a',
      decision: 'allow',
    });
    assert.strictEqual(resolved.ok, true);
    assert.strictEqual(resolved.resolved, true);
    assert.strictEqual(resolved.decision, 'allow');
    assert.strictEqual(resolved.approval.resolvedAt, 5_000);

    const replay = store.resolve({
      approvalId: 'approval-1',
      requestDigest: 'sha256:request-a',
      decision: 'deny',
    });
    assert.strictEqual(replay.resolved, false);
    assert.strictEqual(replay.reason, APPROVAL_REASONS.REPLAYED);
    assert.strictEqual(store.get('approval-1').decision, 'allow');

    const expiring = store.create(request(projectA, {
      requestDigest: 'sha256:request-expiring',
      ttlMs: 50,
    }));
    clock.advance(50);
    const expired = store.resolve({
      approvalId: expiring.approval.approvalId,
      requestDigest: 'sha256:request-expiring',
      decision: 'allow',
    });
    assert.strictEqual(expired.resolved, false);
    assert.strictEqual(expired.reason, APPROVAL_REASONS.EXPIRED);
    assert.strictEqual(store.get(expiring.approval.approvalId).status, 'expired');

    const cancelled = store.create(request(projectA, {
      requestDigest: 'sha256:request-cancelled',
      jobId: undefined,
    }));
    assert.strictEqual(store.cancel(cancelled.approval.approvalId).cancelled, true);
    assert.strictEqual(store.resolve({
      approvalId: cancelled.approval.approvalId,
      requestDigest: 'sha256:request-cancelled',
      decision: true,
    }).reason, APPROVAL_REASONS.CANCELLED);

    const withoutJob = store.create(request(projectA, {
      requestDigest: 'sha256:request-without-job',
      jobId: undefined,
    }));
    const withoutJobResult = store.resolve({
      approvalId: withoutJob.approval.approvalId,
      requestDigest: 'sha256:request-without-job',
      projectId: 'project-a',
      rootPath: projectA,
      sessionId: 'session-a',
      decision: 'deny',
    });
    assert.strictEqual(withoutJobResult.resolved, true);
    assert.strictEqual(withoutJobResult.authorized, false);

    assert.throws(() => store.create(request(projectA, { ttlMs: 0 })), /ttlMs/);
    assert.throws(() => store.create(request(projectA, { ttlMs: 1_001 })), /ttlMs/);
    assert.throws(() => store.create(request(path.join(tempRoot, 'missing'))), /authorized project root/);
    const dangerousMetadata = JSON.parse('{"__proto__":{"polluted":true}}');
    assert.throws(() => store.create(request(projectA, {
      requestDigest: 'sha256:request-dangerous',
      metadata: dangerousMetadata,
    })), /Unsafe object key/);
    assert.strictEqual({}.polluted, undefined);
    assert.throws(() => store.create(request(projectA, {
      requestDigest: 'sha256:request-constructor',
      selector: { constructor: 'collision' },
    })), /Unsafe object key/);
    assert.throws(() => store.create(request(projectA, {
      requestDigest: 'sha256:request-invalid-metadata',
      metadata: ['not', 'an', 'object'],
    })), /metadata must be a plain object/);
    assert.throws(() => store.create(request(projectA, {
      requestDigest: 'sha256:request-sparse',
      selector: { values: new Array(1) },
    })), /Arrays must be dense/);
    assert.throws(() => store.create(request(projectA, {
      requestDigest: 'sha256:request-negative-zero',
      metadata: { offset: -0 },
    })), /negative zero/);
    assert.throws(() => store.create(request(projectA, {
      requestDigest: 'sha256:request-undefined',
      selector: { capability: 'x', discarded: undefined },
    })), /undefined/);
    const symbolSelector = { capability: 'x' };
    symbolSelector[Symbol('hidden-scope')] = 'outside';
    assert.throws(() => store.create(request(projectA, {
      requestDigest: 'sha256:request-symbol',
      selector: symbolSelector,
    })), /symbol keys/);

    let winSequence = 0;
    const winStore = createPendingApprovalStore({
      platform: 'win32',
      idFactory: () => `win-approval-${++winSequence}`,
      authorizeRoot: ({ projectId, rootPath }) => ({
        authorized: true,
        projectId,
        canonicalRootPath: rootPath,
        realRootPath: rootPath,
      }),
    });
    for (const unsafeRoot of [
      String.raw`\project`,
      String.raw`\\?\C:\project`,
      String.raw`\??\C:\project`,
      String.raw`\\??\C:\project`,
      String.raw`\\server\sha?re`,
    ]) {
      assert.throws(() => winStore.create(request(unsafeRoot, {
        requestDigest: `sha256:unsafe-win-${winSequence}`,
      })), /absolute canonical and real root paths/);
    }
    assert.strictEqual(winStore.create(request(String.raw`C:\project`, {
      requestDigest: 'sha256:valid-win',
    })).approval.realRootPath, String.raw`C:\project`);
    assert.strictEqual(store.list({ projectId: 'project-a' }).length, 4);
    assert.strictEqual(store.clear().cleared, 4);

    const stressClock = createClock(20_000);
    let stressSequence = 0;
    const stressStore = createPendingApprovalStore({
      now: stressClock.now,
      idFactory: () => `stress-approval-${++stressSequence}`,
      authorizeRoot,
      defaultTtlMs: 10,
      maxTtlMs: 100,
      maxRecords: 100,
    });
    for (let index = 0; index < 100; index += 1) {
      stressStore.create(request(projectA, {
        requestDigest: `sha256:stress-request-${index}`,
        metadata: { index },
      }));
    }
    assert.strictEqual(stressStore.list().length, 100);
    assert.throws(() => stressStore.create(request(projectA, {
      requestDigest: 'sha256:stress-over-capacity',
    })), /capacity exceeded/);
    stressClock.advance(10);
    stressStore.create(request(projectA, {
      requestDigest: 'sha256:stress-after-purge',
    }));
    assert.strictEqual(stressStore.list().length, 1);
    assert.strictEqual(stressStore.purgeExpired().purged, 0);

    let terminalSequence = 0;
    const terminalStore = createPendingApprovalStore({
      now: () => 30_000,
      idFactory: () => `terminal-approval-${++terminalSequence}`,
      authorizeRoot,
      defaultTtlMs: 100,
      maxTtlMs: 100,
      maxRecords: 2,
    });
    const terminalResolved = terminalStore.create(request(projectA, {
      requestDigest: 'sha256:terminal-resolved',
    }));
    terminalStore.resolve({
      approvalId: terminalResolved.approval.approvalId,
      requestDigest: 'sha256:terminal-resolved',
      projectId: 'project-a',
      rootPath: projectA,
      sessionId: 'session-a',
      jobId: 'job-a',
      decision: 'deny',
    });
    const terminalCancelled = terminalStore.create(request(projectA, {
      requestDigest: 'sha256:terminal-cancelled',
    }));
    terminalStore.cancel(terminalCancelled.approval.approvalId);
    terminalStore.create(request(projectA, {
      requestDigest: 'sha256:terminal-after-purge',
    }));
    assert.strictEqual(terminalStore.list().length, 1);
    assert.strictEqual(terminalStore.purgeTerminal().purged, 0);

    console.log('pending-approval-store.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
