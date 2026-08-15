'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');

const {
  AGENTIC_DELETE_STARTUP_RECOVERY_SERVICE_VERSION,
  MAX_STARTUP_RECOVERY_CANDIDATES,
  createAgenticDeleteStartupRecoveryService,
} = require('../main/services/agentic_delete_startup_recovery_service');

const SAFE_REASON = 'runtime_restarted_before_job_completed';

function jobId(index) {
  return `job-startup-recovery-${String(index).padStart(5, '0')}`;
}

function interruptedResult(jobIds = []) {
  return Object.freeze({
    ok: true,
    recovered: jobIds.length,
    jobIds: Object.freeze([...jobIds]),
  });
}

function candidateResult(jobIds = []) {
  return Object.freeze({
    ok: true,
    jobIds: Object.freeze([...jobIds]),
  });
}

function recoveredResult(ok = true) {
  return Object.freeze({
    schemaVersion: 'agentic-delete-recovery-result.v1',
    ok,
    status: ok ? 'completed' : 'failed',
    disposition: ok ? 'rollback' : null,
    errorCode: ok ? null : 'RECOVERY_FAILED',
    idempotent: false,
  });
}

function expectedCounters(overrides = {}) {
  return {
    ok: true,
    interruptedJobs: 0,
    listedCandidates: 0,
    uniqueCandidates: 0,
    attemptedRecoveries: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    deferredCandidates: 0,
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  const audits = [];
  const service = createAgenticDeleteStartupRecoveryService({
    recoverInterruptedJobs: overrides.recoverInterruptedJobs || ((reason) => {
      calls.push(['persist', reason]);
      return interruptedResult();
    }),
    listAuthorizedJobRecoveryCandidates:
      overrides.listAuthorizedJobRecoveryCandidates || (() => {
        calls.push(['list']);
        return candidateResult();
      }),
    recoverJob: overrides.recoverJob || ((input) => {
      calls.push(['recover', input.jobId]);
      return recoveredResult(true);
    }),
    audit: Object.hasOwn(overrides, 'audit')
      ? overrides.audit
      : ((event) => audits.push(event)),
  });
  return { audits, calls, service };
}

async function runTests() {
  assert.strictEqual(
    AGENTIC_DELETE_STARTUP_RECOVERY_SERVICE_VERSION,
    'agentic-delete-startup-recovery-service.v1'
  );
  assert.strictEqual(Number.isSafeInteger(MAX_STARTUP_RECOVERY_CANDIDATES), true);
  assert.strictEqual(MAX_STARTUP_RECOVERY_CANDIDATES > 0, true);

  assert.throws(() => createAgenticDeleteStartupRecoveryService(), /options/i);
  assert.throws(() => createAgenticDeleteStartupRecoveryService({
    recoverInterruptedJobs() {},
    listAuthorizedJobRecoveryCandidates() {},
    recoverJob() {},
    unsupported: true,
  }), /options/i);
  for (const missing of [
    'recoverInterruptedJobs',
    'listAuthorizedJobRecoveryCandidates',
    'recoverJob',
  ]) {
    const options = {
      recoverInterruptedJobs() {},
      listAuthorizedJobRecoveryCandidates() {},
      recoverJob() {},
    };
    delete options[missing];
    assert.throws(() => createAgenticDeleteStartupRecoveryService(options), new RegExp(missing));
  }
  assert.throws(() => createAgenticDeleteStartupRecoveryService({
    recoverInterruptedJobs() {},
    listAuthorizedJobRecoveryCandidates() {},
    recoverJob() {},
    audit: true,
  }), /audit/i);

  // Persist interrupted state first, then enumerate every durable candidate,
  // deduplicate in stable order, and recover one job at a time.
  {
    const first = jobId(1);
    const second = jobId(2);
    const third = jobId(3);
    const calls = [];
    const audits = [];
    const service = createAgenticDeleteStartupRecoveryService({
      recoverInterruptedJobs(reason) {
        calls.push(['persist', reason]);
        return interruptedResult([first, second]);
      },
      listAuthorizedJobRecoveryCandidates() {
        calls.push(['list']);
        return candidateResult([first, second, first, third]);
      },
      recoverJob(input) {
        assert.strictEqual(Object.isFrozen(input), true);
        assert.deepStrictEqual(Object.keys(input), ['jobId']);
        calls.push(['recover', input.jobId]);
        return recoveredResult(true);
      },
      audit(event) {
        assert.strictEqual(Object.isFrozen(event), true);
        calls.push(['audit']);
        audits.push(event);
      },
    });
    assert.strictEqual(Object.isFrozen(service), true);
    assert.strictEqual(Object.isFrozen(service.recoverAtStartup), true);
    assert.deepStrictEqual(Object.keys(service), ['recoverAtStartup']);

    const result = service.recoverAtStartup({ reason: SAFE_REASON });
    assert.strictEqual(Object.isFrozen(result), true);
    assert.deepStrictEqual(result, expectedCounters({
      interruptedJobs: 2,
      listedCandidates: 4,
      uniqueCandidates: 3,
      attemptedRecoveries: 3,
      successfulRecoveries: 3,
    }));
    assert.deepStrictEqual(calls, [
      ['persist', SAFE_REASON],
      ['list'],
      ['recover', first],
      ['recover', second],
      ['recover', third],
      ['audit'],
    ]);
    assert.deepStrictEqual(audits, [result]);
    assert.deepStrictEqual(Object.keys(result).sort(), [
      'attemptedRecoveries',
      'deferredCandidates',
      'failedRecoveries',
      'interruptedJobs',
      'listedCandidates',
      'ok',
      'successfulRecoveries',
      'uniqueCandidates',
    ]);
    const publicJson = JSON.stringify(result);
    for (const secret of [first, second, third, 'sha256:', '/private/project']) {
      assert.strictEqual(publicJson.includes(secret), false);
    }
  }

  // Newly interrupted IDs remain recovery candidates even if the subsequent
  // durable enumeration observes an empty snapshot. Enumeration counts still
  // describe only the list callback, while uniqueCandidates describes the union.
  {
    const ids = [jobId(4), jobId(5)];
    const attempted = [];
    const service = createAgenticDeleteStartupRecoveryService({
      recoverInterruptedJobs: () => interruptedResult(ids),
      listAuthorizedJobRecoveryCandidates: () => candidateResult(),
      recoverJob({ jobId: current }) {
        attempted.push(current);
        return recoveredResult(true);
      },
    });
    assert.deepStrictEqual(
      service.recoverAtStartup({ reason: SAFE_REASON }),
      expectedCounters({
        interruptedJobs: 2,
        listedCandidates: 0,
        uniqueCandidates: 2,
        attemptedRecoveries: 2,
        successfulRecoveries: 2,
      })
    );
    assert.deepStrictEqual(attempted, ids);
  }

  // A failed, throwing, asynchronous, or malformed individual recovery is
  // counted and cannot prevent later candidates from being attempted.
  {
    const ids = [jobId(10), jobId(11), jobId(12), jobId(13), jobId(14), jobId(15)];
    const attempted = [];
    const service = createAgenticDeleteStartupRecoveryService({
      recoverInterruptedJobs: () => interruptedResult(),
      listAuthorizedJobRecoveryCandidates: () => candidateResult(ids),
      recoverJob({ jobId: current }) {
        attempted.push(current);
        if (current === ids[0]) return recoveredResult(true);
        if (current === ids[1]) return recoveredResult(false);
        if (current === ids[2]) throw new Error('injected recovery failure');
        if (current === ids[3]) return Promise.resolve(recoveredResult(true));
        if (current === ids[4]) {
          return Object.freeze({ ok: true, nested: { unsafe: () => true } });
        }
        return Object.freeze({ ok: true });
      },
    });
    const result = service.recoverAtStartup({ reason: SAFE_REASON });
    assert.deepStrictEqual(attempted, ids);
    assert.deepStrictEqual(result, expectedCounters({
      ok: false,
      listedCandidates: 6,
      uniqueCandidates: 6,
      attemptedRecoveries: 6,
      successfulRecoveries: 1,
      failedRecoveries: 5,
    }));
  }

  // Input is an exact, data-only synchronous request.
  {
    const harness = createHarness();
    for (const input of [
      {},
      { reason: '' },
      { reason: '../unsafe' },
      { reason: SAFE_REASON, extra: true },
      Promise.resolve({ reason: SAFE_REASON }),
      Object.assign(Object.create({}), { reason: SAFE_REASON }),
    ]) {
      assert.deepStrictEqual(
        harness.service.recoverAtStartup(input),
        expectedCounters({ ok: false })
      );
    }
    const accessorInput = {};
    Object.defineProperty(accessorInput, 'reason', {
      enumerable: true,
      get() { throw new Error('must not invoke input getter'); },
    });
    assert.deepStrictEqual(
      harness.service.recoverAtStartup(accessorInput),
      expectedCounters({ ok: false })
    );
    assert.deepStrictEqual(harness.calls, []);
  }

  // A rejected native Promise supplied as the request is invalid synchronous
  // input, but its rejection must be adopted before any structural inspection.
  // Promise.prototype.then is used intrinsically so a hostile thenable getter
  // remains inert.
  {
    let hostileThenReads = 0;
    const hostileThenable = { reason: SAFE_REASON };
    Object.defineProperty(hostileThenable, 'then', {
      enumerable: true,
      get() {
        hostileThenReads += 1;
        throw new Error('must not read a host-provided then property');
      },
    });
    const harness = createHarness();
    assert.deepStrictEqual(
      harness.service.recoverAtStartup(hostileThenable),
      expectedCounters({ ok: false })
    );
    assert.strictEqual(hostileThenReads, 0);
    assert.deepStrictEqual(harness.calls, []);

    const servicePath = require.resolve(
      '../main/services/agentic_delete_startup_recovery_service'
    );
    const strictProbe = spawnSync(process.execPath, [
      '--unhandled-rejections=strict',
      '-e',
      `
        const { createAgenticDeleteStartupRecoveryService } = require(${JSON.stringify(servicePath)});
        const service = createAgenticDeleteStartupRecoveryService({
          recoverInterruptedJobs() { throw new Error('must not persist invalid input'); },
          listAuthorizedJobRecoveryCandidates() { throw new Error('must not list invalid input'); },
          recoverJob() { throw new Error('must not recover invalid input'); },
        });
        const result = service.recoverAtStartup(Promise.reject(new Error('rejected startup input')));
        if (result.ok !== false
          || result.interruptedJobs !== 0
          || result.attemptedRecoveries !== 0
          || result.failedRecoveries !== 0) {
          throw new Error('startup rejection did not fail closed');
        }
        setImmediate(() => process.stdout.write('rejection absorbed'));
      `,
    ], { encoding: 'utf8' });
    assert.strictEqual(
      strictProbe.status,
      0,
      `strict child failed:\n${strictProbe.stderr}`
    );
    assert.strictEqual(strictProbe.stdout, 'rejection absorbed');
  }

  // Persistence is authoritative. Anything other than its exact synchronous
  // DTO stops before candidate enumeration.
  {
    const invalidPersistenceResults = [
      () => { throw new Error('storage unavailable'); },
      () => Promise.resolve(interruptedResult()),
      () => ({ ok: false }),
      () => ({ ok: true, recovered: 1, jobIds: [] }),
      () => ({ ok: true, recovered: 0, jobIds: [], extra: true }),
      () => ({ ok: true, recovered: 1, jobIds: ['invalid id'] }),
    ];
    for (const recoverInterruptedJobs of invalidPersistenceResults) {
      let listCalls = 0;
      let recoverCalls = 0;
      const service = createAgenticDeleteStartupRecoveryService({
        recoverInterruptedJobs,
        listAuthorizedJobRecoveryCandidates() {
          listCalls += 1;
          return candidateResult();
        },
        recoverJob() {
          recoverCalls += 1;
          return recoveredResult(true);
        },
      });
      assert.deepStrictEqual(
        service.recoverAtStartup({ reason: SAFE_REASON }),
        expectedCounters({ ok: false })
      );
      assert.strictEqual(listCalls, 0);
      assert.strictEqual(recoverCalls, 0);
    }
  }

  // Candidate enumeration is also an exact synchronous boundary. A malformed
  // list never delegates even its apparently valid prefix.
  {
    const sparse = [jobId(20), jobId(21)];
    delete sparse[1];
    const accessor = [];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get() { throw new Error('must not invoke candidate getter'); },
    });
    accessor.length = 1;
    const invalidCandidateResults = [
      () => { throw new Error('list unavailable'); },
      () => Promise.resolve(candidateResult()),
      () => ({ ok: false }),
      () => ({ ok: true, jobIds: [jobId(22)], extra: true }),
      () => ({ ok: true, jobIds: ['invalid id'] }),
      () => ({ ok: true, jobIds: sparse }),
      () => ({ ok: true, jobIds: accessor }),
    ];
    for (const listAuthorizedJobRecoveryCandidates of invalidCandidateResults) {
      let recoverCalls = 0;
      const service = createAgenticDeleteStartupRecoveryService({
        recoverInterruptedJobs: () => interruptedResult(),
        listAuthorizedJobRecoveryCandidates,
        recoverJob() {
          recoverCalls += 1;
          return recoveredResult(true);
        },
      });
      assert.deepStrictEqual(
        service.recoverAtStartup({ reason: SAFE_REASON }),
        expectedCounters({ ok: false })
      );
      assert.strictEqual(recoverCalls, 0);
    }
  }

  // Deduplication happens before the bounded processing window. Overflow is
  // visible as a counter and prevents a success claim without hiding progress.
  {
    const uniqueIds = Array.from(
      { length: MAX_STARTUP_RECOVERY_CANDIDATES + 1 },
      (_, index) => jobId(1_000 + index)
    );
    const listed = [uniqueIds[0], ...uniqueIds];
    const attempted = [];
    const service = createAgenticDeleteStartupRecoveryService({
      recoverInterruptedJobs: () => interruptedResult(),
      listAuthorizedJobRecoveryCandidates: () => candidateResult(listed),
      recoverJob({ jobId: current }) {
        attempted.push(current);
        return recoveredResult(true);
      },
    });
    assert.deepStrictEqual(
      service.recoverAtStartup({ reason: SAFE_REASON }),
      expectedCounters({
        ok: false,
        listedCandidates: listed.length,
        uniqueCandidates: uniqueIds.length,
        attemptedRecoveries: MAX_STARTUP_RECOVERY_CANDIDATES,
        successfulRecoveries: MAX_STARTUP_RECOVERY_CANDIDATES,
        deferredCandidates: 1,
      })
    );
    assert.deepStrictEqual(attempted, uniqueIds.slice(0, MAX_STARTUP_RECOVERY_CANDIDATES));
  }

  // Reentry at a dependency boundary invalidates the outer snapshot. No later
  // dependency is allowed to run under the interfered startup pass.
  {
    let service;
    let nested;
    let listCalls = 0;
    service = createAgenticDeleteStartupRecoveryService({
      recoverInterruptedJobs() {
        nested = service.recoverAtStartup({ reason: SAFE_REASON });
        return interruptedResult();
      },
      listAuthorizedJobRecoveryCandidates() {
        listCalls += 1;
        return candidateResult();
      },
      recoverJob: () => recoveredResult(true),
    });
    const outer = service.recoverAtStartup({ reason: SAFE_REASON });
    assert.deepStrictEqual(nested, expectedCounters({ ok: false }));
    assert.deepStrictEqual(outer, expectedCounters({ ok: false }));
    assert.strictEqual(listCalls, 0);
  }

  // Reentry after a recovery may have touched disk stops additional effects;
  // the attempted candidate fails and the remaining candidate is deferred.
  {
    const ids = [jobId(30), jobId(31)];
    let service;
    let nested;
    const attempted = [];
    service = createAgenticDeleteStartupRecoveryService({
      recoverInterruptedJobs: () => interruptedResult(),
      listAuthorizedJobRecoveryCandidates: () => candidateResult(ids),
      recoverJob({ jobId: current }) {
        attempted.push(current);
        if (!nested) nested = service.recoverAtStartup({ reason: SAFE_REASON });
        return recoveredResult(true);
      },
    });
    const outer = service.recoverAtStartup({ reason: SAFE_REASON });
    assert.deepStrictEqual(nested, expectedCounters({ ok: false }));
    assert.deepStrictEqual(outer, expectedCounters({
      ok: false,
      listedCandidates: 2,
      uniqueCandidates: 2,
      attemptedRecoveries: 1,
      failedRecoveries: 1,
      deferredCandidates: 1,
    }));
    assert.deepStrictEqual(attempted, [ids[0]]);
  }

  // Telemetry receives only the frozen counter DTO. Throws, hostile thenables,
  // rejected native Promises, and audit reentry never alter recovery.
  {
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
      for (const audit of [
        () => { throw new Error('audit unavailable'); },
        () => ({ get then() { throw new Error('must not inspect audit thenable'); } }),
        () => Promise.reject(new Error('ignored audit rejection')),
      ]) {
        const harness = createHarness({ audit });
        assert.deepStrictEqual(
          harness.service.recoverAtStartup({ reason: SAFE_REASON }),
          expectedCounters()
        );
      }
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepStrictEqual(unhandled, []);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }

    let service;
    let nested;
    let auditCalls = 0;
    service = createAgenticDeleteStartupRecoveryService({
      recoverInterruptedJobs: () => interruptedResult(),
      listAuthorizedJobRecoveryCandidates: () => candidateResult(),
      recoverJob: () => recoveredResult(true),
      audit(event) {
        auditCalls += 1;
        assert.deepStrictEqual(Object.keys(event), Object.keys(expectedCounters()));
        nested = service.recoverAtStartup({ reason: SAFE_REASON });
      },
    });
    assert.deepStrictEqual(service.recoverAtStartup({ reason: SAFE_REASON }), expectedCounters());
    assert.deepStrictEqual(nested, expectedCounters({ ok: false }));
    assert.strictEqual(auditCalls, 1);
  }

  console.log('agentic delete startup recovery service tests passed');
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
