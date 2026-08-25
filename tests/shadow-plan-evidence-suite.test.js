'use strict';

const assert = require('assert');

const {
  createHarnessResult,
  createPlanRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  createShadowPlanEvidenceCorpusGrader,
} = require('../main/agent_runtime/shadow_plan_evidence_corpus');
const {
  SHADOW_PLAN_EVIDENCE_KINDS,
  SHADOW_PLAN_RUBRIC,
  SHADOW_PLAN_RUBRIC_VERSION,
  createShadowPlanEvidenceEvaluator,
} = require('../main/agent_runtime/shadow_plan_evidence_evaluator');
const {
  SHADOW_PLAN_EVIDENCE_CHECK_RECEIPT_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_SUITE_GRADER_VERSION,
  SHADOW_PLAN_EVIDENCE_SUITE_REASONS,
  SHADOW_PLAN_EVIDENCE_SUITE_VERSION,
  SHADOW_PLAN_SAFETY_AUDIT_RECEIPT_SCHEMA_VERSION,
  createShadowPlanEvidenceSuite,
} = require('../main/agent_runtime/shadow_plan_evidence_suite');
const {
  SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION,
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

function createRequest(requestId = 'shadow-evidence-suite-request-1') {
  return deepFreeze(createPlanRequest({
    projectInfo: {
      id: 'project-shadow-evidence-suite',
      projectId: 'project-shadow-evidence-suite',
      rootPath: '/workspace/shadow-evidence-suite',
    },
    userMessage: 'Conteúdo privado do pedido que não pode vazar.',
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

function evaluatorInput({ request, result, role = 'shadow' }) {
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION,
    role,
    request,
    result,
  });
}

const EVIDENCE_KIND_BY_CRITERION = Object.freeze({
  functional_success: SHADOW_PLAN_EVIDENCE_KINDS.FUNCTIONAL_TEST,
  acceptance_coverage: SHADOW_PLAN_EVIDENCE_KINDS.ACCEPTANCE_CHECK,
  verification_quality: SHADOW_PLAN_EVIDENCE_KINDS.VERIFICATION_CHECK,
  scope_precision: SHADOW_PLAN_EVIDENCE_KINDS.SCOPE_AUDIT,
  regression_avoidance: SHADOW_PLAN_EVIDENCE_KINDS.REGRESSION_TEST,
});

const CHECK_SPECS = Object.freeze([
  Object.freeze({
    id: 'functional-test',
    criterionId: 'functional_success',
    weightBasisPoints: 10000,
    passed: true,
  }),
  Object.freeze({
    id: 'acceptance-required',
    criterionId: 'acceptance_coverage',
    weightBasisPoints: 6000,
    passed: true,
  }),
  Object.freeze({
    id: 'acceptance-secondary',
    criterionId: 'acceptance_coverage',
    weightBasisPoints: 4000,
    passed: false,
  }),
  Object.freeze({
    id: 'verification-check',
    criterionId: 'verification_quality',
    weightBasisPoints: 10000,
    passed: true,
  }),
  Object.freeze({
    id: 'scope-audit',
    criterionId: 'scope_precision',
    weightBasisPoints: 10000,
    passed: true,
  }),
  Object.freeze({
    id: 'regression-test',
    criterionId: 'regression_avoidance',
    weightBasisPoints: 10000,
    passed: true,
  }),
]);

function evidence(kind, suffix, digestCharacter) {
  return deepFreeze({
    kind,
    locator: `eval://phase-4-suite/${suffix}`,
    digest: `sha256:${digestCharacter.repeat(64)}`,
  });
}

function checkReceipt(spec, index, overrides = {}) {
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_EVIDENCE_CHECK_RECEIPT_SCHEMA_VERSION,
    checkId: spec.id,
    passed: spec.passed,
    evidence: [evidence(
      EVIDENCE_KIND_BY_CRITERION[spec.criterionId],
      spec.id,
      String(index + 1)
    )],
    ...overrides,
  });
}

function safetyReceipt(overrides = {}) {
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_SAFETY_AUDIT_RECEIPT_SCHEMA_VERSION,
    workspaceWrites: 0,
    unrelatedFilesChanged: 0,
    evidence: [
      evidence(
        SHADOW_PLAN_EVIDENCE_KINDS.WORKSPACE_AUDIT,
        'workspace-audit',
        'a'
      ),
      evidence(
        SHADOW_PLAN_EVIDENCE_KINDS.SCOPE_AUDIT,
        'scope-safety-audit',
        'b'
      ),
    ],
    ...overrides,
  });
}

function createChecks(runFactory, transformSpec = (spec) => spec) {
  return Object.freeze(CHECK_SPECS.map((originalSpec, index) => {
    const spec = transformSpec(originalSpec, index);
    return Object.freeze({
      version: 'phase-4-observable-check.v1',
      id: spec.id,
      criterionId: spec.criterionId,
      weightBasisPoints: spec.weightBasisPoints,
      timeoutMs: 30,
      run(input) {
        return runFactory
          ? runFactory(spec, index, input)
          : Promise.resolve(checkReceipt(spec, index));
      },
    });
  }));
}

function createSafetyAudit(runFactory) {
  return Object.freeze({
    version: 'phase-4-safety-audit.v1',
    timeoutMs: 30,
    run(input) {
      return runFactory
        ? runFactory(input)
        : Promise.resolve(safetyReceipt());
    },
  });
}

function createSuite({ checks, safetyAudit, workspaceMode = 'read_only' } = {}) {
  return createShadowPlanEvidenceSuite({
    suiteId: 'phase-4-observable-evidence.v1',
    workspaceMode,
    checks: checks || createChecks(),
    safetyAudit: safetyAudit || createSafetyAudit(),
  });
}

function assertReason(error, reason) {
  return error && error.code === reason;
}

async function testChecksRunSequentiallyAndGradeObservableEvidence() {
  const request = createRequest();
  const result = createResult(
    request,
    'codex-app-server-shadow',
    'Plano privado produzido pelo App Server.'
  );
  const input = evaluatorInput({ request, result });
  const events = [];
  let activeCheck = null;
  const checks = createChecks(async (spec, index, receivedInput) => {
    assert.strictEqual(receivedInput, input);
    assert.strictEqual(activeCheck, null);
    activeCheck = spec.id;
    events.push(`check:${spec.id}`);
    await Promise.resolve();
    activeCheck = null;
    return checkReceipt(spec, index);
  });
  const safetyAudit = createSafetyAudit(async (receivedInput) => {
    assert.strictEqual(receivedInput, input);
    assert.strictEqual(activeCheck, null);
    events.push('safety');
    return safetyReceipt();
  });
  const suite = createSuite({ checks, safetyAudit });

  assert.deepStrictEqual(Reflect.ownKeys(suite), [
    'version',
    'suiteId',
    'workspaceMode',
    'grader',
    'observe',
    'diagnostics',
  ]);
  assert.deepStrictEqual(Reflect.ownKeys(suite.grader), ['version', 'grade']);
  assert.strictEqual(suite.grader.version, SHADOW_PLAN_EVIDENCE_SUITE_GRADER_VERSION);
  assertDeepFrozen(suite.grader);

  const evaluator = createShadowPlanEvidenceEvaluator({ grader: suite.grader });
  const evaluation = await evaluator.evaluate(input);
  assert.deepStrictEqual(
    evaluation.criteria.map((criterion) => criterion.scoreBasisPoints),
    [10000, 6000, 10000, 10000, 10000]
  );
  assert.deepStrictEqual(events, [
    ...CHECK_SPECS.map((spec) => `check:${spec.id}`),
    'safety',
  ]);
  assert.strictEqual(evaluation.rubricVersion, SHADOW_PLAN_RUBRIC_VERSION);
  assertDeepFrozen(evaluation);
  assert.deepStrictEqual(suite.diagnostics(), {
    version: SHADOW_PLAN_EVIDENCE_SUITE_VERSION,
    graderVersion: SHADOW_PLAN_EVIDENCE_SUITE_GRADER_VERSION,
    suiteId: 'phase-4-observable-evidence.v1',
    workspaceMode: 'read_only',
    checks: 6,
    attempts: 1,
    evaluations: 1,
    records: 0,
    rejections: 0,
    timeouts: 0,
    safetyAudits: 1,
    lastFailureCode: null,
  });
  assert.doesNotMatch(
    JSON.stringify(suite.diagnostics()),
    /Conteúdo privado|Plano privado/
  );
}

async function testObservedRunsCreateDigestBoundCorpusRecords() {
  const request = createRequest('shadow-evidence-suite-corpus-1');
  const authoritativeResult = createResult(
    request,
    'legacy',
    'Plano autoritativo privado.'
  );
  const shadowResult = createResult(
    request,
    'codex-app-server-shadow',
    'Plano shadow privado e diferente.'
  );
  const suite = createSuite();
  const authoritativeRecord = await suite.observe({
    caseId: 'phase-4-observed-case-1',
    input: evaluatorInput({
      request,
      result: authoritativeResult,
      role: 'authoritative',
    }),
  });
  const shadowRecord = await suite.observe({
    caseId: 'phase-4-observed-case-1',
    input: evaluatorInput({ request, result: shadowResult }),
  });

  assertDeepFrozen(authoritativeRecord);
  assertDeepFrozen(shadowRecord);
  assert.deepStrictEqual(
    shadowRecord.grade.criteria.map((criterion) => criterion.scoreBasisPoints),
    [10000, 6000, 10000, 10000, 10000]
  );
  assert.match(shadowRecord.requestDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(shadowRecord.resultDigest, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(
    JSON.stringify([authoritativeRecord, shadowRecord]),
    /Plano autoritativo privado|Plano shadow privado/
  );

  const corpus = createShadowPlanEvidenceCorpusGrader({
    corpusId: 'phase-4-observed-corpus.v1',
    records: Object.freeze([authoritativeRecord, shadowRecord]),
  });
  const evaluator = createShadowPlanEvidenceEvaluator({ grader: corpus.grader });
  const comparator = createShadowPlanSemanticComparator({ evaluator });
  const report = await comparator.compare({
    request,
    authoritativeResult,
    shadowResult,
  });
  assert.strictEqual(report.parity, true);
  assert.strictEqual(suite.diagnostics().evaluations, 2);
  assert.strictEqual(suite.diagnostics().records, 2);
}

async function testSafetyViolationsRemainObservedEvidence() {
  const request = createRequest('shadow-evidence-suite-safety-1');
  const result = createResult(request, 'codex-app-server-shadow', 'private');
  const suite = createSuite({
    workspaceMode: 'disposable_copy',
    safetyAudit: createSafetyAudit(() => Promise.resolve(safetyReceipt({
      workspaceWrites: 1,
      unrelatedFilesChanged: 2,
    }))),
  });
  const record = await suite.observe({
    caseId: 'phase-4-safety-violation-1',
    input: evaluatorInput({ request, result }),
  });
  assert.deepStrictEqual(record.grade.safety.workspaceWrites, 1);
  assert.deepStrictEqual(record.grade.safety.unrelatedFilesChanged, 2);
  assert.strictEqual(suite.diagnostics().rejections, 0);
}

async function testCheckFailuresStillRunSafetyAndStaySanitized() {
  const request = createRequest('shadow-evidence-suite-failure-1');
  const result = createResult(
    request,
    'codex-app-server-shadow',
    'segredo do resultado'
  );
  const input = evaluatorInput({ request, result });
  let safetyCalls = 0;
  const timeoutSuite = createSuite({
    checks: createChecks((spec, index) => (
      index === 0
        ? new Promise(() => {})
        : Promise.resolve(checkReceipt(spec, index))
    )),
    safetyAudit: createSafetyAudit(() => {
      safetyCalls += 1;
      return Promise.resolve(safetyReceipt());
    }),
  });
  await assert.rejects(
    timeoutSuite.grader.grade(input),
    (error) => assertReason(
      error,
      SHADOW_PLAN_EVIDENCE_SUITE_REASONS.CHECK_TIMEOUT
    )
  );
  assert.strictEqual(safetyCalls, 1);
  assert.strictEqual(timeoutSuite.diagnostics().timeouts, 1);
  assert.strictEqual(timeoutSuite.diagnostics().safetyAudits, 1);
  assert.strictEqual(timeoutSuite.diagnostics().rejections, 1);
  assert.doesNotMatch(
    JSON.stringify(timeoutSuite.diagnostics()),
    /segredo do resultado/
  );

  const privateFailure = new Proxy(
    new Error('private provider and test output'),
    {
      get(target, key, receiver) {
        if (key === 'code') throw new Error('private accessor output');
        return Reflect.get(target, key, receiver);
      },
    }
  );
  const rejectionSuite = createSuite({
    checks: createChecks((spec, index) => (
      index === 0
        ? Promise.reject(privateFailure)
        : Promise.resolve(checkReceipt(spec, index))
    )),
    safetyAudit: createSafetyAudit(() => {
      safetyCalls += 1;
      return Promise.resolve(safetyReceipt());
    }),
  });
  let rejection = null;
  try {
    await rejectionSuite.grader.grade(input);
  } catch (error) {
    rejection = error;
  }
  assert.ok(rejection);
  assert.strictEqual(
    rejection.code,
    SHADOW_PLAN_EVIDENCE_SUITE_REASONS.CHECK_FAILED
  );
  assert.doesNotMatch(rejection.message, /private provider|test output/);
  assert.doesNotMatch(
    JSON.stringify(rejectionSuite.diagnostics()),
    /private provider|test output/
  );
  assert.strictEqual(safetyCalls, 2);
}

async function testInvalidReceiptsFailClosedAfterSafetyAudit() {
  const request = createRequest('shadow-evidence-suite-receipt-1');
  const result = createResult(request, 'codex-app-server-shadow', 'private');
  let safetyCalls = 0;
  const suite = createSuite({
    checks: createChecks((spec, index) => Promise.resolve(
      index === 0
        ? checkReceipt(spec, index, { checkId: 'different-check' })
        : checkReceipt(spec, index)
    )),
    safetyAudit: createSafetyAudit(() => {
      safetyCalls += 1;
      return Promise.resolve(safetyReceipt());
    }),
  });
  await assert.rejects(
    suite.grader.grade(evaluatorInput({ request, result })),
    (error) => assertReason(
      error,
      SHADOW_PLAN_EVIDENCE_SUITE_REASONS.INVALID_CHECK_RECEIPT
    )
  );
  assert.strictEqual(safetyCalls, 1);
}

async function testInvalidCoverageFailsBeforeAnyCheckCanRun() {
  const missingCriterionChecks = Object.freeze(createChecks().slice(0, -1));
  assert.throws(
    () => createSuite({ checks: missingCriterionChecks }),
    (error) => assertReason(
      error,
      SHADOW_PLAN_EVIDENCE_SUITE_REASONS.INVALID_OPTIONS
    )
  );

  const invalidWeightChecks = createChecks(null, (spec) => (
    spec.id === 'acceptance-secondary'
      ? Object.freeze({ ...spec, weightBasisPoints: 3999 })
      : spec
  ));
  assert.throws(
    () => createSuite({ checks: invalidWeightChecks }),
    (error) => assertReason(
      error,
      SHADOW_PLAN_EVIDENCE_SUITE_REASONS.INVALID_OPTIONS
    )
  );
}

async function run() {
  assert.strictEqual(
    SHADOW_PLAN_EVIDENCE_SUITE_VERSION,
    'shadow-plan-evidence-suite.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_EVIDENCE_SUITE_GRADER_VERSION,
    'shadow-plan-evidence-suite-grader.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_EVIDENCE_CHECK_RECEIPT_SCHEMA_VERSION,
    'shadow-plan-evidence-check-receipt.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_SAFETY_AUDIT_RECEIPT_SCHEMA_VERSION,
    'shadow-plan-safety-audit-receipt.v1'
  );
  assert.deepStrictEqual(
    SHADOW_PLAN_RUBRIC.map((criterion) => criterion.id),
    [
      'functional_success',
      'acceptance_coverage',
      'verification_quality',
      'scope_precision',
      'regression_avoidance',
    ]
  );
  assertDeepFrozen(SHADOW_PLAN_EVIDENCE_SUITE_REASONS);

  await testChecksRunSequentiallyAndGradeObservableEvidence();
  await testObservedRunsCreateDigestBoundCorpusRecords();
  await testSafetyViolationsRemainObservedEvidence();
  await testCheckFailuresStillRunSafetyAndStaySanitized();
  await testInvalidReceiptsFailClosedAfterSafetyAudit();
  await testInvalidCoverageFailsBeforeAnyCheckCanRun();
  console.log('shadow plan evidence suite tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
