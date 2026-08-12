'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  GRANT_REASONS,
  GRANT_SCOPES,
  createCapabilityGrantStore,
} = require('../main/capabilities/capability_grant_store');

function createClock(initial = 1_000) {
  let current = initial;
  return {
    now: () => current,
    advance: (milliseconds) => { current += milliseconds; },
  };
}

function selector(overrides = {}) {
  return {
    capabilityId: 'filesystem.write',
    effects: ['write'],
    resourceDigest: 'sha256:project-file-a',
    ...overrides,
  };
}

function query(rootPath, overrides = {}) {
  return {
    projectId: 'project-a',
    rootPath,
    sessionId: 'session-a',
    jobId: 'job-a',
    requestDigest: 'sha256:request-a',
    selector: selector(),
    ...overrides,
  };
}

function createRootAuthorizer(projectRoots) {
  return ({ projectId, rootPath }) => {
    const registeredRoot = projectRoots.get(projectId);
    if (!registeredRoot) return { authorized: false };
    const requested = path.resolve(rootPath);
    const canonical = path.resolve(registeredRoot);
    const realRootPath = fs.realpathSync.native(canonical);
    let requestedRealPath = '';
    try {
      requestedRealPath = fs.realpathSync.native(requested);
    } catch {
      return { authorized: false };
    }
    if (requested !== canonical && requestedRealPath !== realRootPath) return { authorized: false };
    return {
      authorized: true,
      projectId,
      canonicalRootPath: canonical,
      realRootPath,
    };
  };
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-capability-grants-'));
  const projectA = path.join(tempRoot, 'project-a');
  const projectB = path.join(tempRoot, 'project-b');
  const aliasA = path.join(tempRoot, 'project-a-alias');
  fs.mkdirSync(projectA);
  fs.mkdirSync(projectB);
  fs.symlinkSync(projectA, aliasA, 'dir');

  try {
    const clock = createClock();
    let sequence = 0;
    const projectRoots = new Map([
      ['project-a', aliasA],
      ['project-b', projectB],
    ]);
    const authorizeRoot = createRootAuthorizer(projectRoots);
    assert.throws(() => createCapabilityGrantStore(), /authorizeRoot/);
    const store = createCapabilityGrantStore({
      now: clock.now,
      idFactory: () => `grant-${++sequence}`,
      authorizeRoot,
      defaultTtlMs: 100,
      maxTtlMs: 1_000,
    });

    const once = store.createGrant({
      ...query(aliasA),
      scope: GRANT_SCOPES.ONCE,
    });
    assert.strictEqual(once.grantId, 'grant-1');
    assert.strictEqual(once.rootPath, path.resolve(aliasA));
    assert.strictEqual(once.realRootPath, fs.realpathSync.native(projectA));
    assert(Object.isFrozen(once));
    assert(Object.isFrozen(once.selector));

    const firstInspection = store.inspect(query(projectA, {
      selector: {
        resourceDigest: 'sha256:project-file-a',
        effects: ['write'],
        capabilityId: 'filesystem.write',
      },
    }));
    assert.strictEqual(firstInspection.authorized, true, firstInspection.reason);
    assert.strictEqual(firstInspection.reason, GRANT_REASONS.AUTHORIZED);
    assert.strictEqual(firstInspection.grant.consumedAt, null);
    assert.strictEqual(store.authorize(query(projectA)).grant.consumedAt, null);

    const firstUse = store.consume({
      ...query(projectA),
      grantId: firstInspection.grant.grantId,
    });
    assert.strictEqual(firstUse.authorized, true);
    assert.strictEqual(firstUse.grant.consumedAt, 1_000);

    const replay = store.authorize({ ...query(projectA), grantId: once.grantId });
    assert.strictEqual(replay.authorized, false);
    assert.strictEqual(replay.reason, GRANT_REASONS.CONSUMED);

    const digestBound = store.createGrant({
      ...query(projectA),
      requestDigest: 'sha256:request-bound',
      scope: GRANT_SCOPES.ONCE,
    });
    const digestMismatch = store.authorize({
      ...query(projectA),
      grantId: digestBound.grantId,
      requestDigest: 'sha256:request-tampered',
    });
    assert.strictEqual(digestMismatch.authorized, false);
    assert.strictEqual(digestMismatch.reason, GRANT_REASONS.DIGEST_MISMATCH);
    assert.strictEqual(store.get(digestBound.grantId).consumedAt, null);
    assert.strictEqual(store.consume({
      ...query(projectA),
      grantId: digestBound.grantId,
      requestDigest: 'sha256:request-bound',
    }).authorized, true);

    const jobGrant = store.issue({
      ...query(projectA),
      scope: GRANT_SCOPES.JOB,
    });
    assert.strictEqual(store.authorize(query(projectA)).authorized, true);
    assert.strictEqual(store.authorize(query(projectA)).authorized, true);
    assert.strictEqual(store.authorize({
      ...query(projectA, { jobId: 'job-b' }),
      grantId: jobGrant.grantId,
    }).reason, GRANT_REASONS.CONTEXT_MISMATCH);
    assert.strictEqual(store.authorize(query(projectA, { sessionId: 'session-b' })).reason, GRANT_REASONS.NOT_FOUND);
    assert.strictEqual(store.authorize(query(projectB)).reason, GRANT_REASONS.CONTEXT_MISMATCH);
    assert.strictEqual(store.authorize(query(projectA, { projectId: 'project-b' })).reason, GRANT_REASONS.CONTEXT_MISMATCH);
    assert.strictEqual(store.authorize(query(projectA, {
      selector: selector({ resourceDigest: 'sha256:project-file-b' }),
    })).reason, GRANT_REASONS.NOT_FOUND);

    assert.strictEqual(store.revoke(jobGrant.grantId, { reason: 'job_finished' }).revoked, true);
    assert.strictEqual(store.authorize({ ...query(projectA), grantId: jobGrant.grantId }).reason, GRANT_REASONS.REVOKED);

    const sessionGrant = store.createGrant({
      ...query(projectA),
      scope: GRANT_SCOPES.SESSION,
    });
    assert.strictEqual(store.authorize(query(projectA, { jobId: 'job-b' })).authorized, true);
    assert.strictEqual(store.authorize(query(projectA, { sessionId: 'session-b' })).authorized, false);
    assert.strictEqual(store.revokeWhere({ sessionId: 'session-a' }, { reason: 'session_closed' }).revoked, 1);
    assert.strictEqual(store.get(sessionGrant.grantId).revocationReason, 'session_closed');

    const revokedBetweenPhases = store.createGrant({
      ...query(projectA),
      requestDigest: 'sha256:request-revoked-between-phases',
      scope: GRANT_SCOPES.ONCE,
    });
    const betweenPhasesQuery = {
      ...query(projectA),
      grantId: revokedBetweenPhases.grantId,
      requestDigest: 'sha256:request-revoked-between-phases',
    };
    assert.strictEqual(store.inspect(betweenPhasesQuery).authorized, true);
    store.revoke(revokedBetweenPhases.grantId, { reason: 'approval_retracted' });
    assert.strictEqual(store.consume(betweenPhasesQuery).reason, GRANT_REASONS.REVOKED);

    const rootRevokedBetweenPhases = store.createGrant({
      ...query(projectA),
      requestDigest: 'sha256:request-root-revoked',
      scope: GRANT_SCOPES.ONCE,
    });
    const rootRevokedQuery = {
      ...query(projectA),
      grantId: rootRevokedBetweenPhases.grantId,
      requestDigest: 'sha256:request-root-revoked',
    };
    assert.strictEqual(store.inspect(rootRevokedQuery).authorized, true);
    projectRoots.delete('project-a');
    assert.strictEqual(store.consume(rootRevokedQuery).reason, GRANT_REASONS.CONTEXT_MISMATCH);
    projectRoots.set('project-a', aliasA);

    const durableRevokedBetweenPhases = store.createGrant({
      ...query(projectA),
      scope: GRANT_SCOPES.JOB,
    });
    const durableQuery = {
      ...query(projectA),
      grantId: durableRevokedBetweenPhases.grantId,
    };
    assert.strictEqual(store.inspect(durableQuery).authorized, true);
    store.revoke(durableRevokedBetweenPhases.grantId, { reason: 'job_cancelled' });
    assert.strictEqual(store.consume(durableQuery).reason, GRANT_REASONS.REVOKED);

    const projectGrant = store.createGrant({
      ...query(projectA),
      sessionId: undefined,
      jobId: undefined,
      scope: GRANT_SCOPES.PROJECT,
    });
    assert.strictEqual(store.authorize(query(projectA, {
      sessionId: 'session-b',
      jobId: 'job-b',
    })).authorized, true);
    assert.strictEqual(store.authorize(query(projectB, {
      sessionId: 'session-b',
      jobId: 'job-b',
    })).authorized, false);

    clock.advance(100);
    const expired = store.consume({
      ...query(projectA, { sessionId: 'session-b', jobId: 'job-b' }),
      grantId: projectGrant.grantId,
    });
    assert.strictEqual(expired.authorized, false);
    assert.strictEqual(expired.reason, GRANT_REASONS.EXPIRED);

    assert.throws(() => store.createGrant({
      ...query(projectA),
      ttlMs: 0,
    }), /ttlMs/);
    assert.throws(() => store.createGrant({
      ...query(projectA),
      ttlMs: 1_001,
    }), /ttlMs/);
    assert.throws(() => store.createGrant({
      ...query(projectA),
      jobId: undefined,
      scope: GRANT_SCOPES.JOB,
    }), /jobId/);
    assert.throws(() => store.createGrant({
      ...query(projectA),
      sessionId: undefined,
      scope: GRANT_SCOPES.SESSION,
    }), /sessionId/);
    assert.throws(() => store.createGrant({
      ...query(path.join(tempRoot, 'missing-project')),
    }), /authorized project root/);

    const dangerousSelector = JSON.parse('{"capabilityId":"filesystem.write","effects":["write"],"resourceDigest":"sha256:x","__proto__":{"polluted":true}}');
    assert.throws(() => store.createGrant({
      ...query(projectA),
      selector: dangerousSelector,
    }), /Unsafe object key/);
    assert.strictEqual({}.polluted, undefined);
    assert.throws(() => store.createGrant({
      ...query(projectA),
      metadata: { constructor: 'collision' },
    }), /Unsafe object key/);
    assert.throws(() => store.createGrant({
      ...query(projectA),
      metadata: 'not-an-object',
    }), /metadata must be a plain object/);
    assert.throws(() => store.createGrant({
      ...query(projectA),
      selector: selector({ effects: new Array(1) }),
    }), /Arrays must be dense/);
    assert.throws(() => store.createGrant({
      ...query(projectA),
      metadata: { offset: -0 },
    }), /negative zero/);
    assert.throws(() => store.createGrant({
      ...query(projectA),
      selector: selector({ discarded: undefined }),
    }), /undefined/);
    const symbolSelector = selector();
    symbolSelector[Symbol('hidden-scope')] = 'outside';
    assert.throws(() => store.createGrant({
      ...query(projectA),
      selector: symbolSelector,
    }), /symbol keys/);
    const nonEnumerableSelector = selector();
    Object.defineProperty(nonEnumerableSelector, 'hiddenScope', {
      enumerable: false,
      value: 'outside',
    });
    assert.throws(() => store.createGrant({
      ...query(projectA),
      selector: nonEnumerableSelector,
    }), /enumerable data properties/);

    let winSequence = 0;
    const winStore = createCapabilityGrantStore({
      platform: 'win32',
      idFactory: () => `win-grant-${++winSequence}`,
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
      assert.throws(() => winStore.createGrant({
        ...query(unsafeRoot),
        scope: GRANT_SCOPES.ONCE,
      }), /absolute canonical and real root paths/);
    }
    assert.strictEqual(winStore.createGrant({
      ...query(String.raw`C:\project`),
      scope: GRANT_SCOPES.ONCE,
    }).realRootPath, String.raw`C:\project`);

    const failClosed = store.authorize(query(path.join(tempRoot, 'missing-project')));
    assert.strictEqual(failClosed.authorized, false);
    assert.strictEqual(failClosed.reason, GRANT_REASONS.CONTEXT_MISMATCH);

    assert.strictEqual(store.list({ projectId: 'project-a' }).length, 8);
    assert.strictEqual(store.clear().cleared, 8);
    assert.strictEqual(store.get(projectGrant.grantId), null);

    const stressClock = createClock(10_000);
    let stressSequence = 0;
    const stressStore = createCapabilityGrantStore({
      now: stressClock.now,
      idFactory: () => `stress-grant-${++stressSequence}`,
      authorizeRoot,
      defaultTtlMs: 10,
      maxTtlMs: 100,
      maxRecords: 100,
    });
    for (let index = 0; index < 100; index += 1) {
      stressStore.createGrant({
        ...query(projectA),
        scope: GRANT_SCOPES.SESSION,
        metadata: { index },
      });
    }
    assert.strictEqual(stressStore.list().length, 100);
    assert.throws(() => stressStore.createGrant({
      ...query(projectA),
      scope: GRANT_SCOPES.SESSION,
    }), /capacity exceeded/);
    stressClock.advance(10);
    stressStore.createGrant({
      ...query(projectA),
      scope: GRANT_SCOPES.SESSION,
    });
    assert.strictEqual(stressStore.list().length, 1);
    assert.strictEqual(stressStore.purgeExpired().purged, 0);

    let terminalSequence = 0;
    const terminalStore = createCapabilityGrantStore({
      now: () => 30_000,
      idFactory: () => `terminal-grant-${++terminalSequence}`,
      authorizeRoot,
      defaultTtlMs: 100,
      maxTtlMs: 100,
      maxRecords: 2,
    });
    const terminalOnce = terminalStore.createGrant({
      ...query(projectA),
      scope: GRANT_SCOPES.ONCE,
    });
    terminalStore.consume({ ...query(projectA), grantId: terminalOnce.grantId });
    const terminalJob = terminalStore.createGrant({
      ...query(projectA),
      scope: GRANT_SCOPES.JOB,
    });
    terminalStore.revoke(terminalJob.grantId, { reason: 'job_closed' });
    terminalStore.createGrant({
      ...query(projectA),
      scope: GRANT_SCOPES.SESSION,
    });
    assert.strictEqual(terminalStore.list().length, 1);
    assert.strictEqual(terminalStore.purgeTerminal().purged, 0);

    console.log('capability-grant-store.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
