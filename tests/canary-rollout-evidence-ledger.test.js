'use strict';

const assert = require('assert');

const {
  CANARY_ROLLOUT_ADVANCEMENT_DECISION_SCHEMA_VERSION,
  CANARY_ROLLOUT_ADVANCEMENT_REASONS,
  CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS,
  CANARY_ROLLOUT_EVIDENCE_LEDGER_VERSION,
  CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
  CANARY_ROLLOUT_EVIDENCE_SINK_VERSION,
  CANARY_ROLLOUT_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
  CANARY_ROLLOUT_GATE_REASONS,
  CANARY_ROLLOUT_GATE_STATUSES,
  createCanaryRolloutEvidenceLedger,
} = require('../main/agent_runtime/canary_rollout_evidence_ledger');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../main/agent_runtime/canary_rollout_selector');

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach((child) => assertDeepFrozen(child, seen));
}

function evidence(index, overrides = {}) {
  return Object.freeze({
    schemaVersion: CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
    jobId: `canary-gate-job-${index}`,
    projectId: `canary-gate-project-${index}`,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    route: 'canary',
    eligible: true,
    terminal: true,
    succeeded: true,
    manualRollback: false,
    corrupted: false,
    dataLossIncident: false,
    securityIncident: false,
    duplicateExternalEffect: false,
    ...overrides,
  });
}

function evidenceJournal(initialEvidence = [], { appendFailure = null } = {}) {
  const calls = { append: 0, load: 0 };
  const persisted = [...initialEvidence];
  const journal = Object.freeze({
    version: 'canary-rollout-evidence-journal.v1',
    load() {
      calls.load += 1;
      return Object.freeze({
        schemaVersion: 'canary-rollout-evidence-journal-snapshot.v1',
        evidence: Object.freeze([...persisted]),
      });
    },
    append(value) {
      calls.append += 1;
      if (appendFailure && appendFailure.active) {
        throw new Error('private persistence failure');
      }
      persisted.push(value);
      return undefined;
    },
    diagnostics() {
      return Object.freeze({ records: persisted.length });
    },
  });
  return { calls, journal, persisted };
}

function recordPopulation(ledger, {
  prefix,
  route,
  count,
  successes,
  rolloutStage = CANARY_ROLLOUT_STAGES.INTERNAL,
  overridesForIndex = () => ({}),
}) {
  for (let index = 0; index < count; index += 1) {
    ledger.evidenceSink.record(evidence(`${prefix}-${index}`, {
      route,
      rolloutStage,
      succeeded: index < successes,
      ...overridesForIndex(index),
    }));
  }
}

function createPopulatedLedger({
  canaryJobs,
  canarySuccesses,
  baselineJobs,
  baselineSuccesses,
  canaryOverridesForIndex = () => ({}),
  rolloutStage = CANARY_ROLLOUT_STAGES.INTERNAL,
}) {
  const ledger = createCanaryRolloutEvidenceLedger({
    minimumCanaryJobs: canaryJobs,
    minimumBaselineJobs: baselineJobs,
  });
  recordPopulation(ledger, {
    prefix: 'baseline',
    route: 'baseline',
    count: baselineJobs,
    successes: baselineSuccesses,
    rolloutStage,
  });
  recordPopulation(ledger, {
    prefix: 'canary',
    route: 'canary',
    count: canaryJobs,
    successes: canarySuccesses,
    rolloutStage,
    overridesForIndex: canaryOverridesForIndex,
  });
  return ledger;
}

function testPassingGateAndStageIsolation() {
  const ledger = createCanaryRolloutEvidenceLedger({
    minimumCanaryJobs: 100,
    minimumBaselineJobs: 100,
  });
  assert.deepStrictEqual(Reflect.ownKeys(ledger), [
    'version',
    'evidenceSink',
    'snapshot',
    'advancement',
    'diagnostics',
  ]);
  assert.deepStrictEqual(Reflect.ownKeys(ledger.evidenceSink), [
    'version',
    'record',
  ]);
  assertDeepFrozen(ledger.evidenceSink);

  recordPopulation(ledger, {
    prefix: 'baseline-pass',
    route: 'baseline',
    count: 100,
    successes: 98,
  });
  recordPopulation(ledger, {
    prefix: 'canary-pass',
    route: 'canary',
    count: 100,
    successes: 95,
    overridesForIndex(index) {
      return index === 95 ? { manualRollback: true } : {};
    },
  });

  const snapshot = ledger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL);
  assert.strictEqual(
    snapshot.schemaVersion,
    CANARY_ROLLOUT_EVIDENCE_SNAPSHOT_SCHEMA_VERSION
  );
  assert.strictEqual(snapshot.ledgerVersion, CANARY_ROLLOUT_EVIDENCE_LEDGER_VERSION);
  assert.strictEqual(snapshot.rolloutStage, CANARY_ROLLOUT_STAGES.INTERNAL);
  assert.deepStrictEqual(snapshot.thresholds, {
    minimumCanaryJobs: 100,
    minimumBaselineJobs: 100,
    manualRollbackMustBeBelowBasisPoints: 200,
    corruptedJobMustBeBelowBasisPoints: 50,
    maximumSuccessRegressionBasisPoints: 300,
  });
  assert.deepStrictEqual(snapshot.totals, {
    baselineJobs: 100,
    baselineSuccesses: 98,
    baselineSuccessRateBasisPoints: 9800,
    canaryJobs: 100,
    canarySuccesses: 95,
    canarySuccessRateBasisPoints: 9500,
    successDeltaBasisPoints: -300,
    manualRollbacks: 1,
    manualRollbackRateBasisPoints: 100,
    corruptedJobs: 0,
    corruptedJobRateBasisPoints: 0,
    dataLossIncidents: 0,
    securityIncidents: 0,
    duplicateExternalEffects: 0,
  });
  assert.deepStrictEqual(snapshot.gate, {
    status: CANARY_ROLLOUT_GATE_STATUSES.PASS,
    reasons: [],
  });
  assert.match(snapshot.headDigest, /^sha256:[a-f0-9]{64}$/);
  assertDeepFrozen(snapshot);

  const advancement = ledger.advancement(CANARY_ROLLOUT_STAGES.INTERNAL);
  assert.deepStrictEqual(advancement, {
    schemaVersion: CANARY_ROLLOUT_ADVANCEMENT_DECISION_SCHEMA_VERSION,
    fromStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    toStage: CANARY_ROLLOUT_STAGES.PERCENT_1,
    allowed: true,
    reason: CANARY_ROLLOUT_ADVANCEMENT_REASONS.GATE_PASSED,
    gateStatus: CANARY_ROLLOUT_GATE_STATUSES.PASS,
  });
  assertDeepFrozen(advancement);

  const nextStage = ledger.snapshot(CANARY_ROLLOUT_STAGES.PERCENT_1);
  assert.strictEqual(nextStage.totals.canaryJobs, 0);
  assert.strictEqual(nextStage.totals.baselineJobs, 0);
  assert.strictEqual(nextStage.headDigest, null);
  assert.deepStrictEqual(nextStage.gate, {
    status: CANARY_ROLLOUT_GATE_STATUSES.INSUFFICIENT_DATA,
    reasons: [
      CANARY_ROLLOUT_GATE_REASONS.INSUFFICIENT_CANARY_SAMPLE,
      CANARY_ROLLOUT_GATE_REASONS.INSUFFICIENT_BASELINE_SAMPLE,
    ],
  });
  assert.strictEqual(
    ledger.advancement(CANARY_ROLLOUT_STAGES.PERCENT_1).reason,
    CANARY_ROLLOUT_ADVANCEMENT_REASONS.GATE_INSUFFICIENT_DATA
  );
  assert.deepStrictEqual(ledger.advancement(CANARY_ROLLOUT_STAGES.PERCENT_50), {
    schemaVersion: CANARY_ROLLOUT_ADVANCEMENT_DECISION_SCHEMA_VERSION,
    fromStage: CANARY_ROLLOUT_STAGES.PERCENT_50,
    toStage: null,
    allowed: false,
    reason: CANARY_ROLLOUT_ADVANCEMENT_REASONS.TERMINAL_STAGE,
    gateStatus: CANARY_ROLLOUT_GATE_STATUSES.INSUFFICIENT_DATA,
  });
}

function testStrictRateAndBaselineThresholds() {
  const manualRollbackLedger = createPopulatedLedger({
    canaryJobs: 100,
    canarySuccesses: 98,
    baselineJobs: 100,
    baselineSuccesses: 100,
    canaryOverridesForIndex(index) {
      return index >= 98 ? { manualRollback: true } : {};
    },
  });
  assert.deepStrictEqual(
    manualRollbackLedger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL).gate,
    {
      status: CANARY_ROLLOUT_GATE_STATUSES.BLOCKED,
      reasons: [CANARY_ROLLOUT_GATE_REASONS.MANUAL_ROLLBACK_RATE],
    }
  );

  const corruptedLedger = createPopulatedLedger({
    canaryJobs: 200,
    canarySuccesses: 199,
    baselineJobs: 200,
    baselineSuccesses: 200,
    canaryOverridesForIndex(index) {
      return index === 199 ? { corrupted: true } : {};
    },
  });
  assert.deepStrictEqual(
    corruptedLedger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL).gate,
    {
      status: CANARY_ROLLOUT_GATE_STATUSES.BLOCKED,
      reasons: [CANARY_ROLLOUT_GATE_REASONS.CORRUPTED_JOB_RATE],
    }
  );

  const successLedger = createPopulatedLedger({
    canaryJobs: 100,
    canarySuccesses: 96,
    baselineJobs: 100,
    baselineSuccesses: 100,
  });
  assert.deepStrictEqual(
    successLedger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL).gate,
    {
      status: CANARY_ROLLOUT_GATE_STATUSES.BLOCKED,
      reasons: [CANARY_ROLLOUT_GATE_REASONS.SUCCESS_BELOW_BASELINE],
    }
  );
  assert.deepStrictEqual(
    successLedger.advancement(CANARY_ROLLOUT_STAGES.INTERNAL),
    {
      schemaVersion: CANARY_ROLLOUT_ADVANCEMENT_DECISION_SCHEMA_VERSION,
      fromStage: CANARY_ROLLOUT_STAGES.INTERNAL,
      toStage: CANARY_ROLLOUT_STAGES.PERCENT_1,
      allowed: false,
      reason: CANARY_ROLLOUT_ADVANCEMENT_REASONS.GATE_BLOCKED,
      gateStatus: CANARY_ROLLOUT_GATE_STATUSES.BLOCKED,
    }
  );
}

function testZeroToleranceSignalsBlockBeforeMinimumSample() {
  const ledger = createCanaryRolloutEvidenceLedger({
    minimumCanaryJobs: 100,
    minimumBaselineJobs: 100,
  });
  ledger.evidenceSink.record(evidence('baseline-safety', {
    route: 'baseline',
  }));
  ledger.evidenceSink.record(evidence('canary-safety', {
    succeeded: false,
    dataLossIncident: true,
    securityIncident: true,
    duplicateExternalEffect: true,
  }));
  const snapshot = ledger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL);
  assert.deepStrictEqual(snapshot.gate, {
    status: CANARY_ROLLOUT_GATE_STATUSES.BLOCKED,
    reasons: [
      CANARY_ROLLOUT_GATE_REASONS.DATA_LOSS_INCIDENT,
      CANARY_ROLLOUT_GATE_REASONS.SECURITY_INCIDENT,
      CANARY_ROLLOUT_GATE_REASONS.DUPLICATE_EXTERNAL_EFFECT,
    ],
  });
}

function testDuplicateAndInvalidEvidenceFailClosed() {
  const ledger = createCanaryRolloutEvidenceLedger({
    minimumCanaryJobs: 1,
    minimumBaselineJobs: 1,
  });
  const accepted = evidence('accepted');
  ledger.evidenceSink.record(accepted);
  const before = ledger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL);
  assert.throws(
    () => ledger.evidenceSink.record(accepted),
    (error) => error.code
      === CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.DUPLICATE_EVIDENCE
  );
  assert.deepStrictEqual(
    ledger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL),
    before
  );
  assert.throws(
    () => ledger.evidenceSink.record(evidence('accepted', {
      rolloutStage: CANARY_ROLLOUT_STAGES.PERCENT_1,
    })),
    (error) => error.code
      === CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.DUPLICATE_EVIDENCE
  );

  let getterCalls = 0;
  const accessor = { ...evidence('accessor') };
  Object.defineProperty(accessor, 'jobId', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'must-not-run';
    },
  });
  for (const invalid of [
    evidence('wrong-version', { schemaVersion: 'future-version' }),
    evidence('wrong-stage', { rolloutStage: '100_percent' }),
    evidence('not-eligible', { eligible: false }),
    evidence('not-terminal', { terminal: false }),
    evidence('baseline-signal', {
      route: 'baseline',
      succeeded: false,
      manualRollback: true,
    }),
    evidence('inconsistent-success', {
      succeeded: true,
      corrupted: true,
    }),
    Object.freeze({ ...evidence('extra'), extra: true }),
    accessor,
    new Proxy(evidence('proxy'), {}),
  ]) {
    assert.throws(
      () => ledger.evidenceSink.record(invalid),
      (error) => error.code
        === CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.INVALID_EVIDENCE
    );
  }
  assert.strictEqual(getterCalls, 0);
  assert.deepStrictEqual(
    ledger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL),
    before
  );
  assert.deepStrictEqual(ledger.diagnostics(), {
    version: CANARY_ROLLOUT_EVIDENCE_LEDGER_VERSION,
    evidenceSinkVersion: CANARY_ROLLOUT_EVIDENCE_SINK_VERSION,
    journalVersion: null,
    recoveredEvidence: 0,
    acceptedEvidence: 1,
    acceptedByStage: {
      internal: 1,
      '1_percent': 0,
      '5_percent': 0,
      '25_percent': 0,
      '50_percent': 0,
    },
    rejections: 11,
    duplicateEvidence: 2,
    lastFailureCode: CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.INVALID_EVIDENCE,
  });
  assertDeepFrozen(ledger.diagnostics());

  for (const invalidStage of [null, '100_percent', new String('internal')]) {
    assert.throws(() => ledger.snapshot(invalidStage), /rolloutStage/);
    assert.throws(() => ledger.advancement(invalidStage), /rolloutStage/);
  }
  assert.throws(
    () => createCanaryRolloutEvidenceLedger({ minimumCanaryJobs: 0 }),
    /minimumCanaryJobs/
  );
  assert.throws(
    () => createCanaryRolloutEvidenceLedger({ unexpected: true }),
    /options/
  );
}

function testJournalHydrationAndPersistBeforeVisibility() {
  const recoveredBaseline = evidence('recovered-baseline', {
    route: 'baseline',
  });
  const recoveredCanary = evidence('recovered-canary');
  const fixture = evidenceJournal([recoveredBaseline, recoveredCanary]);
  const ledger = createCanaryRolloutEvidenceLedger({
    minimumCanaryJobs: 1,
    minimumBaselineJobs: 1,
    evidenceJournal: fixture.journal,
  });
  assert.strictEqual(fixture.calls.load, 1);
  assert.strictEqual(fixture.calls.append, 0);
  assert.deepStrictEqual(
    ledger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL).totals,
    {
      baselineJobs: 1,
      baselineSuccesses: 1,
      baselineSuccessRateBasisPoints: 10_000,
      canaryJobs: 1,
      canarySuccesses: 1,
      canarySuccessRateBasisPoints: 10_000,
      successDeltaBasisPoints: 0,
      manualRollbacks: 0,
      manualRollbackRateBasisPoints: 0,
      corruptedJobs: 0,
      corruptedJobRateBasisPoints: 0,
      dataLossIncidents: 0,
      securityIncidents: 0,
      duplicateExternalEffects: 0,
    }
  );
  assert.strictEqual(ledger.diagnostics().recoveredEvidence, 2);
  assert.strictEqual(
    ledger.diagnostics().journalVersion,
    'canary-rollout-evidence-journal.v1'
  );

  const next = evidence('persisted-before-visible');
  ledger.evidenceSink.record(next);
  assert.strictEqual(fixture.calls.append, 1);
  assert.deepStrictEqual(fixture.persisted, [
    recoveredBaseline,
    recoveredCanary,
    next,
  ]);
  assert.strictEqual(
    ledger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL).totals.canaryJobs,
    2
  );

  const restarted = createCanaryRolloutEvidenceLedger({
    minimumCanaryJobs: 1,
    minimumBaselineJobs: 1,
    evidenceJournal: fixture.journal,
  });
  assert.strictEqual(
    restarted.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL).totals.canaryJobs,
    2
  );
}

function testJournalFailureLeavesLedgerRetryable() {
  const appendFailure = { active: true };
  const fixture = evidenceJournal([], { appendFailure });
  const ledger = createCanaryRolloutEvidenceLedger({
    minimumCanaryJobs: 1,
    minimumBaselineJobs: 1,
    evidenceJournal: fixture.journal,
  });
  const next = evidence('retry-after-persistence-failure');
  const before = ledger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL);
  assert.throws(
    () => ledger.evidenceSink.record(next),
    (error) => error.code
      === CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.PERSISTENCE_FAILED
  );
  assert.deepStrictEqual(
    ledger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL),
    before
  );
  appendFailure.active = false;
  assert.strictEqual(ledger.evidenceSink.record(next), undefined);
  assert.strictEqual(
    ledger.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL).totals.canaryJobs,
    1
  );
}

function run() {
  assert.strictEqual(
    CANARY_ROLLOUT_EVIDENCE_LEDGER_VERSION,
    'canary-rollout-evidence-ledger.v1'
  );
  assert.strictEqual(
    CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
    'canary-rollout-evidence.v1'
  );
  assert.strictEqual(
    CANARY_ROLLOUT_EVIDENCE_SINK_VERSION,
    'canary-rollout-evidence-sink.v1'
  );
  assert.deepStrictEqual(CANARY_ROLLOUT_GATE_STATUSES, {
    BLOCKED: 'blocked',
    INSUFFICIENT_DATA: 'insufficient_data',
    PASS: 'pass',
  });
  testPassingGateAndStageIsolation();
  testStrictRateAndBaselineThresholds();
  testZeroToleranceSignalsBlockBeforeMinimumSample();
  testDuplicateAndInvalidEvidenceFailClosed();
  testJournalHydrationAndPersistBeforeVisibility();
  testJournalFailureLeavesLedgerRetryable();
  console.log('canary rollout evidence ledger tests passed');
}

run();
