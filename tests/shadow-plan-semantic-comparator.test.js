'use strict';

const assert = require('assert');

const {
  createPlanRequest,
  createHarnessResult,
} = require('../main/agent_runtime/harness_contracts');
const {
  SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION,
  SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS,
  SHADOW_PLAN_SEMANTIC_COMPARATOR_VERSION,
  SHADOW_PLAN_SEMANTIC_EVALUATION_SCHEMA_VERSION,
  SHADOW_PLAN_SEMANTIC_VERDICTS,
  createShadowPlanSemanticComparator,
} = require('../main/agent_runtime/shadow_plan_semantic_comparator');

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

function createRequest(requestId = 'shadow-comparison-request-1') {
  return deepFreeze(createPlanRequest({
    projectInfo: {
      id: 'project-shadow-comparison',
      projectId: 'project-shadow-comparison',
      rootPath: '/workspace/shadow-comparison',
    },
    userMessage: 'Refatore o fluxo preservando os critérios de aceite.',
  }, { requestId }));
}

function createResult({ request, kernelId, response }) {
  return deepFreeze(createHarnessResult({
    requestId: request.requestId,
    operation: request.operation,
    kernelId,
    output: {
      ok: true,
      response,
      action: null,
      meta: { planner: kernelId },
    },
    diagnostics: { id: kernelId },
  }));
}

const CRITERIA = Object.freeze([
  Object.freeze({ id: 'acceptance_coverage', weightBasisPoints: 4000 }),
  Object.freeze({ id: 'implementation_safety', weightBasisPoints: 2500 }),
  Object.freeze({ id: 'verification_quality', weightBasisPoints: 2000 }),
  Object.freeze({ id: 'scope_precision', weightBasisPoints: 1500 }),
]);

function createEvaluation({
  requestId = 'shadow-comparison-request-1',
  kernelId,
  rubricVersion = 'plan-rubric.v1',
  scores,
  workspaceWrites = 0,
  unrelatedFilesChanged = 0,
}) {
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_SEMANTIC_EVALUATION_SCHEMA_VERSION,
    requestId,
    kernelId,
    eligible: true,
    rubricVersion,
    criteria: CRITERIA.map((criterion, index) => ({
      id: criterion.id,
      weightBasisPoints: criterion.weightBasisPoints,
      scoreBasisPoints: scores[index],
    })),
    safety: {
      workspaceWrites,
      unrelatedFilesChanged,
    },
  });
}

function createEvaluator({ authoritative, shadow, rejection = null }) {
  const calls = [];
  const evaluator = Object.freeze({
    version: 'test-semantic-evaluator.v1',
    evaluate(input) {
      calls.push(input);
      if (rejection) return Promise.reject(rejection);
      return Promise.resolve(
        input.role === 'authoritative' ? authoritative : shadow
      );
    },
  });
  return { calls, evaluator };
}

function createComparisonFixture(overrides = {}) {
  const request = createRequest(overrides.requestId);
  const authoritativeResult = createResult({
    request,
    kernelId: 'legacy',
    response: 'Confirme para eu preparar a alteração com segurança.',
  });
  const shadowResult = createResult({
    request,
    kernelId: 'codex-app-server-shadow',
    response: '1. Mapear contratos.\n2. Refatorar incrementalmente.\n3. Verificar os critérios.',
  });
  const authoritative = createEvaluation({
    requestId: request.requestId,
    kernelId: authoritativeResult.kernelId,
    scores: [8000, 7000, 6000, 9000],
    ...(overrides.authoritative || {}),
  });
  const shadow = createEvaluation({
    requestId: request.requestId,
    kernelId: shadowResult.kernelId,
    scores: [8200, 7200, 6500, 8800],
    ...(overrides.shadow || {}),
  });
  const fake = createEvaluator({ authoritative, shadow });
  const comparator = createShadowPlanSemanticComparator({
    evaluator: fake.evaluator,
    toleranceBasisPoints: 300,
  });
  return {
    authoritativeResult,
    comparator,
    fake,
    request,
    shadowResult,
  };
}

function assertReason(error, reason) {
  return error && error.code === reason;
}

async function testDifferentTextCanBeSemanticallyEquivalent() {
  const fixture = createComparisonFixture();
  const report = await fixture.comparator.compare({
    request: fixture.request,
    authoritativeResult: fixture.authoritativeResult,
    shadowResult: fixture.shadowResult,
  });

  assert.deepStrictEqual(report, {
    schemaVersion: SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION,
    requestId: fixture.request.requestId,
    operation: 'plan',
    rubricVersion: 'plan-rubric.v1',
    eligible: true,
    verdict: SHADOW_PLAN_SEMANTIC_VERDICTS.EQUIVALENT,
    parity: true,
    toleranceBasisPoints: 300,
    kernels: {
      authoritative: 'legacy',
      shadow: 'codex-app-server-shadow',
    },
    scores: {
      authoritativeBasisPoints: 7500,
      shadowBasisPoints: 7700,
      deltaBasisPoints: 200,
    },
    safety: {
      authoritativeWorkspaceWrites: 0,
      authoritativeUnrelatedFilesChanged: 0,
      shadowWorkspaceWrites: 0,
      shadowUnrelatedFilesChanged: 0,
      passed: true,
    },
    criteria: [
      {
        id: 'acceptance_coverage',
        weightBasisPoints: 4000,
        authoritativeScoreBasisPoints: 8000,
        shadowScoreBasisPoints: 8200,
        deltaBasisPoints: 200,
      },
      {
        id: 'implementation_safety',
        weightBasisPoints: 2500,
        authoritativeScoreBasisPoints: 7000,
        shadowScoreBasisPoints: 7200,
        deltaBasisPoints: 200,
      },
      {
        id: 'verification_quality',
        weightBasisPoints: 2000,
        authoritativeScoreBasisPoints: 6000,
        shadowScoreBasisPoints: 6500,
        deltaBasisPoints: 500,
      },
      {
        id: 'scope_precision',
        weightBasisPoints: 1500,
        authoritativeScoreBasisPoints: 9000,
        shadowScoreBasisPoints: 8800,
        deltaBasisPoints: -200,
      },
    ],
  });
  assertDeepFrozen(report);
  assert.doesNotMatch(
    JSON.stringify(report),
    /Confirme para eu preparar|Mapear contratos|Refatorar incrementalmente/
  );
  assert.strictEqual(fixture.fake.calls.length, 2);
  assert.deepStrictEqual(
    fixture.fake.calls.map((call) => call.role),
    ['authoritative', 'shadow']
  );
  assert.notStrictEqual(
    fixture.fake.calls[0].result.output.response,
    fixture.fake.calls[1].result.output.response
  );
  assertDeepFrozen(fixture.fake.calls[0]);
  assertDeepFrozen(fixture.fake.calls[1]);
  assert.deepStrictEqual(fixture.comparator.diagnostics(), {
    version: SHADOW_PLAN_SEMANTIC_COMPARATOR_VERSION,
    evaluatorVersion: 'test-semantic-evaluator.v1',
    toleranceBasisPoints: 300,
    comparisons: 1,
    parityPasses: 1,
    safetyViolations: 0,
    rejections: 0,
    lastVerdict: SHADOW_PLAN_SEMANTIC_VERDICTS.EQUIVALENT,
    lastFailureCode: null,
  });
}

async function testShadowSafetyViolationAlwaysFailsParity() {
  const fixture = createComparisonFixture({
    shadow: {
      scores: [10000, 10000, 10000, 10000],
      workspaceWrites: 1,
      unrelatedFilesChanged: 1,
    },
  });
  const report = await fixture.comparator.compare({
    request: fixture.request,
    authoritativeResult: fixture.authoritativeResult,
    shadowResult: fixture.shadowResult,
  });
  assert.strictEqual(
    report.verdict,
    SHADOW_PLAN_SEMANTIC_VERDICTS.SAFETY_VIOLATION
  );
  assert.strictEqual(report.parity, false);
  assert.strictEqual(report.safety.passed, false);
  assert.strictEqual(report.safety.shadowWorkspaceWrites, 1);
  assert.strictEqual(report.safety.shadowUnrelatedFilesChanged, 1);
  assert.strictEqual(fixture.comparator.diagnostics().safetyViolations, 1);
}

async function testMismatchedRubricsFailClosed() {
  const fixture = createComparisonFixture({
    shadow: { rubricVersion: 'different-rubric.v1' },
  });
  await assert.rejects(
    fixture.comparator.compare({
      request: fixture.request,
      authoritativeResult: fixture.authoritativeResult,
      shadowResult: fixture.shadowResult,
    }),
    (error) => assertReason(
      error,
      SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS.EVALUATION_MISMATCH
    )
  );
  assert.strictEqual(fixture.comparator.diagnostics().rejections, 1);
}

async function testEvaluatorFailureIsSanitized() {
  const fixture = createComparisonFixture();
  const privateFailure = new Error('private plan and provider details');
  privateFailure.code = 'PRIVATE_EVALUATOR_FAILURE';
  const fake = createEvaluator({
    authoritative: null,
    shadow: null,
    rejection: privateFailure,
  });
  const comparator = createShadowPlanSemanticComparator({ evaluator: fake.evaluator });
  let rejection = null;
  try {
    await comparator.compare({
      request: fixture.request,
      authoritativeResult: fixture.authoritativeResult,
      shadowResult: fixture.shadowResult,
    });
  } catch (error) {
    rejection = error;
  }
  assert(rejection);
  assert.strictEqual(
    rejection.code,
    SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS.EVALUATOR_FAILED
  );
  assert.doesNotMatch(rejection.message, /private plan|provider details/i);
  assert.strictEqual(rejection.causeCode, 'PRIVATE_EVALUATOR_FAILURE');
}

async function run() {
  assert.strictEqual(
    SHADOW_PLAN_SEMANTIC_COMPARATOR_VERSION,
    'shadow-plan-semantic-comparator.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_SEMANTIC_EVALUATION_SCHEMA_VERSION,
    'shadow-plan-semantic-evaluation.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION,
    'shadow-plan-semantic-comparison.v1'
  );
  assertDeepFrozen(SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS);
  assertDeepFrozen(SHADOW_PLAN_SEMANTIC_VERDICTS);
  assert.throws(() => createShadowPlanSemanticComparator(), /evaluator/i);

  await testDifferentTextCanBeSemanticallyEquivalent();
  await testShadowSafetyViolationAlwaysFailsParity();
  await testMismatchedRubricsFailClosed();
  await testEvaluatorFailureIsSanitized();
  console.log('shadow plan semantic comparator tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
