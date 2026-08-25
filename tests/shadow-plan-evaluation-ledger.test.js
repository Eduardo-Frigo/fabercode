'use strict';

const assert = require('assert');

const {
  SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION,
  SHADOW_PLAN_SEMANTIC_VERDICTS,
} = require('../main/agent_runtime/shadow_plan_semantic_comparator');
const {
  SHADOW_PLAN_RUBRIC,
  SHADOW_PLAN_RUBRIC_VERSION,
} = require('../main/agent_runtime/shadow_plan_evidence_evaluator');
const {
  SHADOW_PLAN_EVALUATION_GATE_REASONS,
  SHADOW_PLAN_EVALUATION_GATE_STATUSES,
  SHADOW_PLAN_EVALUATION_LEDGER_REASONS,
  SHADOW_PLAN_EVALUATION_LEDGER_SNAPSHOT_SCHEMA_VERSION,
  SHADOW_PLAN_EVALUATION_LEDGER_VERSION,
  SHADOW_PLAN_EVALUATION_REPORT_SINK_VERSION,
  createShadowPlanEvaluationLedger,
} = require('../main/agent_runtime/shadow_plan_evaluation_ledger');

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function weightedScore(scores) {
  const total = SHADOW_PLAN_RUBRIC.reduce(
    (sum, criterion, index) => sum + criterion.weightBasisPoints * scores[index],
    0
  );
  return Math.round(total / 10000);
}

function createReport(index, {
  authoritativeFunctional = 10000,
  shadowFunctional = 10000,
  parity = true,
  shadowWorkspaceWrites = 0,
  shadowUnrelatedFilesChanged = 0,
} = {}) {
  const authoritativeScores = [authoritativeFunctional, 10000, 10000, 10000, 10000];
  const shadowScores = [shadowFunctional, parity ? 10000 : 0, 10000, 10000, 10000];
  const authoritativeScore = weightedScore(authoritativeScores);
  const shadowScore = weightedScore(shadowScores);
  const delta = shadowScore - authoritativeScore;
  const safetyPassed = shadowWorkspaceWrites === 0
    && shadowUnrelatedFilesChanged === 0;
  const actualParity = safetyPassed && delta >= -300;
  let verdict = SHADOW_PLAN_SEMANTIC_VERDICTS.EQUIVALENT;
  if (!safetyPassed) verdict = SHADOW_PLAN_SEMANTIC_VERDICTS.SAFETY_VIOLATION;
  else if (delta > 300) verdict = SHADOW_PLAN_SEMANTIC_VERDICTS.SHADOW_BETTER;
  else if (delta < -300) verdict = SHADOW_PLAN_SEMANTIC_VERDICTS.AUTHORITATIVE_BETTER;

  return deepFreeze({
    schemaVersion: SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION,
    requestId: `shadow-ledger-request-${index}`,
    operation: 'plan',
    rubricVersion: SHADOW_PLAN_RUBRIC_VERSION,
    eligible: true,
    verdict,
    parity: actualParity,
    toleranceBasisPoints: 300,
    kernels: {
      authoritative: 'legacy',
      shadow: 'codex-app-server-shadow',
    },
    scores: {
      authoritativeBasisPoints: authoritativeScore,
      shadowBasisPoints: shadowScore,
      deltaBasisPoints: delta,
    },
    safety: {
      authoritativeWorkspaceWrites: 0,
      authoritativeUnrelatedFilesChanged: 0,
      shadowWorkspaceWrites,
      shadowUnrelatedFilesChanged,
      passed: safetyPassed,
    },
    criteria: SHADOW_PLAN_RUBRIC.map((criterion, criterionIndex) => ({
      id: criterion.id,
      weightBasisPoints: criterion.weightBasisPoints,
      authoritativeScoreBasisPoints: authoritativeScores[criterionIndex],
      shadowScoreBasisPoints: shadowScores[criterionIndex],
      deltaBasisPoints:
        shadowScores[criterionIndex] - authoritativeScores[criterionIndex],
    })),
  });
}

function recordRange(ledger, count, optionsForIndex = () => ({})) {
  for (let index = 1; index <= count; index += 1) {
    assert.strictEqual(
      ledger.reportSink.record(createReport(index, optionsForIndex(index))),
      undefined
    );
  }
}

function assertGate(snapshot, status, reasons) {
  assert.strictEqual(snapshot.gate.status, status);
  assert.deepStrictEqual(snapshot.gate.reasons, reasons);
}

function testInsufficientSampleThenPassingGate() {
  const ledger = createShadowPlanEvaluationLedger();
  assert.deepStrictEqual(Reflect.ownKeys(ledger.reportSink), ['version', 'record']);
  assertDeepFrozen(ledger.reportSink);
  recordRange(ledger, 9);
  let snapshot = ledger.snapshot();
  assertGate(snapshot, SHADOW_PLAN_EVALUATION_GATE_STATUSES.INSUFFICIENT_DATA, [
    SHADOW_PLAN_EVALUATION_GATE_REASONS.INSUFFICIENT_SAMPLE,
  ]);
  assert.strictEqual(snapshot.totals.eligibleCases, 9);
  const priorDigest = snapshot.headDigest;

  ledger.reportSink.record(createReport(10, { parity: false }));
  snapshot = ledger.snapshot();
  assert.deepStrictEqual(snapshot, {
    schemaVersion: SHADOW_PLAN_EVALUATION_LEDGER_SNAPSHOT_SCHEMA_VERSION,
    ledgerVersion: SHADOW_PLAN_EVALUATION_LEDGER_VERSION,
    rubricVersion: SHADOW_PLAN_RUBRIC_VERSION,
    thresholds: {
      minimumEligibleCases: 10,
      requiredParityRateBasisPoints: 9000,
      maximumFunctionalRegressionBasisPoints: 300,
    },
    totals: {
      eligibleCases: 10,
      parityPasses: 9,
      parityRateBasisPoints: 9000,
      authoritativeFunctionalSuccesses: 10,
      shadowFunctionalSuccesses: 10,
      authoritativeFunctionalSuccessRateBasisPoints: 10000,
      shadowFunctionalSuccessRateBasisPoints: 10000,
      functionalSuccessDeltaBasisPoints: 0,
      safetyViolations: 0,
    },
    gate: {
      status: SHADOW_PLAN_EVALUATION_GATE_STATUSES.PASS,
      reasons: [],
    },
    headDigest: snapshot.headDigest,
  });
  assert.match(snapshot.headDigest, /^sha256:[a-f0-9]{64}$/);
  assert.notStrictEqual(snapshot.headDigest, priorDigest);
  assertDeepFrozen(snapshot);
  assert.deepStrictEqual(ledger.diagnostics(), {
    version: SHADOW_PLAN_EVALUATION_LEDGER_VERSION,
    reportSinkVersion: SHADOW_PLAN_EVALUATION_REPORT_SINK_VERSION,
    acceptedReports: 10,
    rejections: 0,
    duplicateReports: 0,
    lastFailureCode: null,
  });
}

function testParityFunctionalAndSafetyFailures() {
  const parityLedger = createShadowPlanEvaluationLedger();
  recordRange(parityLedger, 10, (index) => ({ parity: index <= 8 }));
  assertGate(parityLedger.snapshot(), SHADOW_PLAN_EVALUATION_GATE_STATUSES.FAIL, [
    SHADOW_PLAN_EVALUATION_GATE_REASONS.PARITY_BELOW_THRESHOLD,
  ]);

  const functionalLedger = createShadowPlanEvaluationLedger();
  recordRange(functionalLedger, 10, (index) => (
    index === 10 ? { shadowFunctional: 0 } : {}
  ));
  const functionalSnapshot = functionalLedger.snapshot();
  assert.strictEqual(functionalSnapshot.totals.parityRateBasisPoints, 9000);
  assert.strictEqual(
    functionalSnapshot.totals.functionalSuccessDeltaBasisPoints,
    -1000
  );
  assertGate(functionalSnapshot, SHADOW_PLAN_EVALUATION_GATE_STATUSES.FAIL, [
    SHADOW_PLAN_EVALUATION_GATE_REASONS.FUNCTIONAL_REGRESSION,
  ]);

  const safetyLedger = createShadowPlanEvaluationLedger();
  recordRange(safetyLedger, 10, (index) => (
    index === 10 ? { shadowWorkspaceWrites: 1 } : {}
  ));
  const safetySnapshot = safetyLedger.snapshot();
  assert.strictEqual(safetySnapshot.totals.parityRateBasisPoints, 9000);
  assert.strictEqual(safetySnapshot.totals.safetyViolations, 1);
  assertGate(safetySnapshot, SHADOW_PLAN_EVALUATION_GATE_STATUSES.FAIL, [
    SHADOW_PLAN_EVALUATION_GATE_REASONS.SAFETY_VIOLATION,
  ]);
}

function testDuplicateAndInvalidReportsDoNotChangeState() {
  const ledger = createShadowPlanEvaluationLedger({ minimumEligibleCases: 1 });
  const report = createReport(1);
  ledger.reportSink.record(report);
  const beforeDuplicate = ledger.snapshot();
  assert.throws(
    () => ledger.reportSink.record(report),
    (error) => error
      && error.code === SHADOW_PLAN_EVALUATION_LEDGER_REASONS.DUPLICATE_REPORT
  );
  assert.deepStrictEqual(ledger.snapshot(), beforeDuplicate);

  const invalid = deepFreeze({ ...createReport(2), rubricVersion: 'other.v1' });
  assert.throws(
    () => ledger.reportSink.record(invalid),
    (error) => error
      && error.code === SHADOW_PLAN_EVALUATION_LEDGER_REASONS.INVALID_REPORT
  );
  assert.deepStrictEqual(ledger.snapshot(), beforeDuplicate);
  assert.deepStrictEqual(ledger.diagnostics(), {
    version: SHADOW_PLAN_EVALUATION_LEDGER_VERSION,
    reportSinkVersion: SHADOW_PLAN_EVALUATION_REPORT_SINK_VERSION,
    acceptedReports: 1,
    rejections: 2,
    duplicateReports: 1,
    lastFailureCode: SHADOW_PLAN_EVALUATION_LEDGER_REASONS.INVALID_REPORT,
  });
}

function run() {
  assert.strictEqual(
    SHADOW_PLAN_EVALUATION_LEDGER_VERSION,
    'shadow-plan-evaluation-ledger.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_EVALUATION_LEDGER_SNAPSHOT_SCHEMA_VERSION,
    'shadow-plan-evaluation-ledger-snapshot.v1'
  );
  assertDeepFrozen(SHADOW_PLAN_EVALUATION_GATE_REASONS);
  assertDeepFrozen(SHADOW_PLAN_EVALUATION_GATE_STATUSES);
  assertDeepFrozen(SHADOW_PLAN_EVALUATION_LEDGER_REASONS);
  assert.throws(
    () => createShadowPlanEvaluationLedger({ minimumEligibleCases: 0 }),
    /minimumEligibleCases/
  );

  testInsufficientSampleThenPassingGate();
  testParityFunctionalAndSafetyFailures();
  testDuplicateAndInvalidReportsDoNotChangeState();
  console.log('shadow plan evaluation ledger tests passed');
}

run();
