'use strict';

const assert = require('assert');

const {
  createHarnessResult,
  createPlanRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION,
  createShadowPlanSemanticComparator,
} = require('../main/agent_runtime/shadow_plan_semantic_comparator');
const {
  SHADOW_PLAN_EVIDENCE_EVALUATOR_REASONS,
  SHADOW_PLAN_EVIDENCE_EVALUATOR_VERSION,
  SHADOW_PLAN_EVIDENCE_GRADE_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_KINDS,
  SHADOW_PLAN_RUBRIC,
  SHADOW_PLAN_RUBRIC_VERSION,
  createShadowPlanEvidenceEvaluator,
} = require('../main/agent_runtime/shadow_plan_evidence_evaluator');

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

function createRequest(requestId = 'shadow-evidence-request-1') {
  return deepFreeze(createPlanRequest({
    projectInfo: {
      id: 'project-shadow-evidence',
      projectId: 'project-shadow-evidence',
      rootPath: '/workspace/shadow-evidence',
    },
    userMessage: 'Implemente os critérios de aceite e verifique o resultado.',
  }, { requestId }));
}

function createResult(request, kernelId, response) {
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

function evidence(kind, suffix) {
  return deepFreeze({
    kind,
    locator: `eval://shadow-plan/${suffix}`,
    digest: `sha256:${suffix.charCodeAt(0).toString(16).padStart(2, '0').repeat(32)}`,
  });
}

const CRITERION_EVIDENCE = Object.freeze({
  functional_success: SHADOW_PLAN_EVIDENCE_KINDS.FUNCTIONAL_TEST,
  acceptance_coverage: SHADOW_PLAN_EVIDENCE_KINDS.ACCEPTANCE_CHECK,
  verification_quality: SHADOW_PLAN_EVIDENCE_KINDS.VERIFICATION_CHECK,
  scope_precision: SHADOW_PLAN_EVIDENCE_KINDS.SCOPE_AUDIT,
  regression_avoidance: SHADOW_PLAN_EVIDENCE_KINDS.REGRESSION_TEST,
});

function createGrade(input, scores = [10000, 9000, 8000, 10000, 9000]) {
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_EVIDENCE_GRADE_SCHEMA_VERSION,
    requestId: input.request.requestId,
    kernelId: input.result.kernelId,
    rubricVersion: SHADOW_PLAN_RUBRIC_VERSION,
    criteria: SHADOW_PLAN_RUBRIC.map((criterion, index) => ({
      id: criterion.id,
      scoreBasisPoints: scores[index],
      evidence: [evidence(CRITERION_EVIDENCE[criterion.id], `${index + 1}`)],
    })),
    safety: {
      workspaceWrites: 0,
      unrelatedFilesChanged: 0,
      evidence: [
        evidence(SHADOW_PLAN_EVIDENCE_KINDS.WORKSPACE_AUDIT, 'a'),
        evidence(SHADOW_PLAN_EVIDENCE_KINDS.SCOPE_AUDIT, 'b'),
      ],
    },
  });
}

function createGrader(gradeFactory = createGrade) {
  const calls = [];
  const grader = Object.freeze({
    version: 'test-shadow-plan-grader.v1',
    grade(input) {
      calls.push(input);
      return Promise.resolve(gradeFactory(input));
    },
  });
  return { calls, grader };
}

function evaluatorInput({ request, result, role = 'shadow' }) {
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION,
    role,
    request,
    result,
  });
}

function assertReason(error, reason) {
  return error && error.code === reason;
}

async function testCanonicalEvidenceBecomesSemanticEvaluation() {
  const request = createRequest();
  const result = createResult(
    request,
    'codex-app-server-shadow',
    'Plano privado que não pode aparecer no recibo.'
  );
  const fake = createGrader();
  const evaluator = createShadowPlanEvidenceEvaluator({ grader: fake.grader });
  const evaluation = await evaluator.evaluate(evaluatorInput({ request, result }));

  assert.deepStrictEqual(evaluation, {
    schemaVersion: 'shadow-plan-semantic-evaluation.v1',
    requestId: request.requestId,
    kernelId: 'codex-app-server-shadow',
    eligible: true,
    rubricVersion: SHADOW_PLAN_RUBRIC_VERSION,
    criteria: [
      { id: 'functional_success', weightBasisPoints: 3000, scoreBasisPoints: 10000 },
      { id: 'acceptance_coverage', weightBasisPoints: 2500, scoreBasisPoints: 9000 },
      { id: 'verification_quality', weightBasisPoints: 2000, scoreBasisPoints: 8000 },
      { id: 'scope_precision', weightBasisPoints: 1500, scoreBasisPoints: 10000 },
      { id: 'regression_avoidance', weightBasisPoints: 1000, scoreBasisPoints: 9000 },
    ],
    safety: {
      workspaceWrites: 0,
      unrelatedFilesChanged: 0,
    },
  });
  assertDeepFrozen(evaluation);
  assertDeepFrozen(fake.calls[0]);
  assert.doesNotMatch(JSON.stringify(evaluation), /Plano privado/);
  assert.deepStrictEqual(evaluator.diagnostics(), {
    version: SHADOW_PLAN_EVIDENCE_EVALUATOR_VERSION,
    graderVersion: 'test-shadow-plan-grader.v1',
    rubricVersion: SHADOW_PLAN_RUBRIC_VERSION,
    evaluations: 1,
    rejections: 0,
    lastFailureCode: null,
  });
}

async function testEvaluatorIntegratesWithSemanticComparator() {
  const request = createRequest('shadow-evidence-integration-1');
  const authoritativeResult = createResult(request, 'legacy', 'Texto legado diferente.');
  const shadowResult = createResult(
    request,
    'codex-app-server-shadow',
    'Outro texto, avaliado somente pelo resultado observável.'
  );
  const fake = createGrader((input) => createGrade(
    input,
    input.role === 'authoritative'
      ? [10000, 8000, 8000, 9000, 9000]
      : [10000, 8500, 8500, 9000, 9000]
  ));
  const evaluator = createShadowPlanEvidenceEvaluator({ grader: fake.grader });
  const comparator = createShadowPlanSemanticComparator({ evaluator });
  const report = await comparator.compare({
    request,
    authoritativeResult,
    shadowResult,
  });

  assert.strictEqual(report.rubricVersion, SHADOW_PLAN_RUBRIC_VERSION);
  assert.strictEqual(report.parity, true);
  assert.strictEqual(report.criteria[0].id, 'functional_success');
  assert.strictEqual(fake.calls.length, 2);
  assert.deepStrictEqual(fake.calls.map((call) => call.role), [
    'authoritative',
    'shadow',
  ]);
  assert.doesNotMatch(
    JSON.stringify(report),
    /Texto legado diferente|Outro texto/
  );
}

async function testInvalidEvidenceAndFunctionalScoreFailClosed() {
  const request = createRequest('shadow-evidence-invalid-1');
  const result = createResult(request, 'legacy', 'private');
  const cases = [
    (input) => {
      const grade = createGrade(input);
      return deepFreeze({
        ...grade,
        criteria: grade.criteria.map((criterion, index) => (
          index === 0
            ? { ...criterion, evidence: [evidence(
              SHADOW_PLAN_EVIDENCE_KINDS.ACCEPTANCE_CHECK,
              'c'
            )] }
            : criterion
        )),
      });
    },
    (input) => createGrade(input, [9999, 9000, 8000, 10000, 9000]),
    (input) => {
      const grade = createGrade(input);
      return deepFreeze({
        ...grade,
        criteria: [...grade.criteria].reverse(),
      });
    },
  ];

  for (const gradeFactory of cases) {
    const fake = createGrader(gradeFactory);
    const evaluator = createShadowPlanEvidenceEvaluator({ grader: fake.grader });
    await assert.rejects(
      evaluator.evaluate(evaluatorInput({ request, result, role: 'authoritative' })),
      (error) => assertReason(
        error,
        SHADOW_PLAN_EVIDENCE_EVALUATOR_REASONS.INVALID_GRADE
      )
    );
  }
}

async function testGraderFailureIsSanitized() {
  const request = createRequest('shadow-evidence-failure-1');
  const result = createResult(request, 'legacy', 'private');
  const privateFailure = new Error('private grader output and provider details');
  privateFailure.code = 'PRIVATE_GRADER_FAILURE';
  const grader = Object.freeze({
    version: 'failing-shadow-plan-grader.v1',
    grade() {
      return Promise.reject(privateFailure);
    },
  });
  const evaluator = createShadowPlanEvidenceEvaluator({ grader });
  let rejection = null;
  try {
    await evaluator.evaluate(evaluatorInput({
      request,
      result,
      role: 'authoritative',
    }));
  } catch (error) {
    rejection = error;
  }
  assert(rejection);
  assert.strictEqual(
    rejection.code,
    SHADOW_PLAN_EVIDENCE_EVALUATOR_REASONS.GRADER_FAILED
  );
  assert.strictEqual(rejection.causeCode, 'PRIVATE_GRADER_FAILURE');
  assert.doesNotMatch(rejection.message, /private grader|provider details/i);
  assert.strictEqual(evaluator.diagnostics().rejections, 1);
}

async function run() {
  assert.strictEqual(
    SHADOW_PLAN_EVIDENCE_EVALUATOR_VERSION,
    'shadow-plan-evidence-evaluator.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_EVIDENCE_GRADE_SCHEMA_VERSION,
    'shadow-plan-evidence-grade.v1'
  );
  assert.strictEqual(SHADOW_PLAN_RUBRIC_VERSION, 'shadow-plan-rubric.v1');
  assertDeepFrozen(SHADOW_PLAN_RUBRIC);
  assertDeepFrozen(SHADOW_PLAN_EVIDENCE_KINDS);
  assertDeepFrozen(SHADOW_PLAN_EVIDENCE_EVALUATOR_REASONS);
  assert.throws(() => createShadowPlanEvidenceEvaluator(), /grader/i);

  await testCanonicalEvidenceBecomesSemanticEvaluation();
  await testEvaluatorIntegratesWithSemanticComparator();
  await testInvalidEvidenceAndFunctionalScoreFailClosed();
  await testGraderFailureIsSanitized();
  console.log('shadow plan evidence evaluator tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
