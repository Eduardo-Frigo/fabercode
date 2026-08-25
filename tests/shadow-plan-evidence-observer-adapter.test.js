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
  SHADOW_PLAN_RUBRIC_VERSION,
  createShadowPlanEvidenceEvaluator,
} = require('../main/agent_runtime/shadow_plan_evidence_evaluator');
const {
  SHADOW_PLAN_EVIDENCE_CHECK_DEFINITION_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_OBSERVATION_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS,
  SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_VERSION,
  createShadowPlanEvidenceObserverAdapter,
} = require('../main/agent_runtime/shadow_plan_evidence_observer_adapter');
const {
  SHADOW_PLAN_EVIDENCE_CHECK_RECEIPT_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_SUITE_REASONS,
  SHADOW_PLAN_EVIDENCE_SUITE_VERSION,
  SHADOW_PLAN_SAFETY_AUDIT_RECEIPT_SCHEMA_VERSION,
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

function createRequest(requestId = 'shadow-observer-request-1') {
  return deepFreeze(createPlanRequest({
    projectInfo: {
      id: 'project-shadow-observer',
      projectId: 'project-shadow-observer',
      rootPath: '/workspace/shadow-observer',
    },
    userMessage: 'Pedido privado da avaliação observável.',
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

const CHECK_SPECS = Object.freeze([
  Object.freeze({
    id: 'functional-test',
    criterionId: 'functional_success',
    weightBasisPoints: 10000,
    passed: true,
    evidenceKind: SHADOW_PLAN_EVIDENCE_KINDS.FUNCTIONAL_TEST,
  }),
  Object.freeze({
    id: 'acceptance-primary',
    criterionId: 'acceptance_coverage',
    weightBasisPoints: 6000,
    passed: true,
    evidenceKind: SHADOW_PLAN_EVIDENCE_KINDS.ACCEPTANCE_CHECK,
  }),
  Object.freeze({
    id: 'acceptance-secondary',
    criterionId: 'acceptance_coverage',
    weightBasisPoints: 4000,
    passed: false,
    evidenceKind: SHADOW_PLAN_EVIDENCE_KINDS.ACCEPTANCE_CHECK,
  }),
  Object.freeze({
    id: 'verification-check',
    criterionId: 'verification_quality',
    weightBasisPoints: 10000,
    passed: true,
    evidenceKind: SHADOW_PLAN_EVIDENCE_KINDS.VERIFICATION_CHECK,
  }),
  Object.freeze({
    id: 'scope-audit',
    criterionId: 'scope_precision',
    weightBasisPoints: 10000,
    passed: true,
    evidenceKind: SHADOW_PLAN_EVIDENCE_KINDS.SCOPE_AUDIT,
  }),
  Object.freeze({
    id: 'regression-test',
    criterionId: 'regression_avoidance',
    weightBasisPoints: 10000,
    passed: true,
    evidenceKind: SHADOW_PLAN_EVIDENCE_KINDS.REGRESSION_TEST,
  }),
]);

function evidence(kind, suffix, character) {
  return deepFreeze({
    kind,
    locator: `eval://phase-4-observer/${suffix}`,
    digest: `sha256:${character.repeat(64)}`,
  });
}

function checkDefinitions(transform = (spec) => spec) {
  return Object.freeze(CHECK_SPECS.map((originalSpec, index) => {
    const spec = transform(originalSpec, index);
    return Object.freeze({
      schemaVersion: SHADOW_PLAN_EVIDENCE_CHECK_DEFINITION_SCHEMA_VERSION,
      id: spec.id,
      criterionId: spec.criterionId,
      weightBasisPoints: spec.weightBasisPoints,
      timeoutMs: 80,
    });
  }));
}

function checkReceipt(spec, index, overrides = {}) {
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_EVIDENCE_CHECK_RECEIPT_SCHEMA_VERSION,
    checkId: spec.id,
    passed: spec.passed,
    evidence: [evidence(
      spec.evidenceKind,
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

const OBSERVER_VERSION = 'project-evidence-observer.v1';

function observation(input, overrides = {}) {
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_EVIDENCE_OBSERVATION_SCHEMA_VERSION,
    observationId: `observation-${input.role}-${input.request.requestId}`,
    observerVersion: OBSERVER_VERSION,
    workspaceMode: 'read_only',
    role: input.role,
    requestId: input.request.requestId,
    kernelId: input.result.kernelId,
    checks: CHECK_SPECS.map((spec, index) => checkReceipt(spec, index)),
    safety: safetyReceipt(),
    ...overrides,
  });
}

function createObserver(factory = (input) => observation(input)) {
  const calls = [];
  const observer = Object.freeze({
    version: OBSERVER_VERSION,
    observe(input) {
      calls.push(input);
      return Promise.resolve().then(() => factory(input));
    },
  });
  return { calls, observer };
}

function createAdapter({
  observer = createObserver().observer,
  checks = checkDefinitions(),
  workspaceMode = 'read_only',
  observerTimeoutMs = 30,
} = {}) {
  return createShadowPlanEvidenceObserverAdapter({
    suiteId: 'phase-4-atomic-observer.v1',
    workspaceMode,
    checks,
    safetyTimeoutMs: 80,
    observerTimeoutMs,
    observer,
  });
}

function assertReason(error, reason) {
  return error && error.code === reason;
}

async function testOneAtomicObservationFeedsAllChecksAndSafety() {
  const request = createRequest();
  const result = createResult(
    request,
    'codex-app-server-shadow',
    'Plano privado observado por testes externos.'
  );
  const input = evaluatorInput({ request, result });
  const fake = createObserver();
  const adapter = createAdapter({ observer: fake.observer });

  assert.deepStrictEqual(Reflect.ownKeys(adapter), [
    'version',
    'suiteId',
    'workspaceMode',
    'grader',
    'observe',
    'diagnostics',
  ]);
  assertDeepFrozen(adapter.grader);
  const evaluator = createShadowPlanEvidenceEvaluator({
    grader: adapter.grader,
  });
  const evaluation = await evaluator.evaluate(input);

  assert.strictEqual(fake.calls.length, 1);
  assert.strictEqual(fake.calls[0], input);
  assert.deepStrictEqual(
    evaluation.criteria.map((criterion) => criterion.scoreBasisPoints),
    [10000, 6000, 10000, 10000, 10000]
  );
  assert.deepStrictEqual(evaluation.safety, {
    workspaceWrites: 0,
    unrelatedFilesChanged: 0,
  });
  assertDeepFrozen(evaluation);
  assert.deepStrictEqual(adapter.diagnostics(), {
    version: SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_VERSION,
    observerVersion: OBSERVER_VERSION,
    suiteVersion: SHADOW_PLAN_EVIDENCE_SUITE_VERSION,
    suiteId: 'phase-4-atomic-observer.v1',
    workspaceMode: 'read_only',
    checks: 6,
    observationAttempts: 1,
    observations: 1,
    observationRejections: 0,
    observationTimeouts: 0,
    activeObservations: 0,
    suiteAttempts: 1,
    suiteEvaluations: 1,
    suiteRecords: 0,
    suiteRejections: 0,
    lastObservationFailureCode: null,
    lastSuiteFailureCode: null,
  });
  assert.doesNotMatch(
    JSON.stringify(adapter.diagnostics()),
    /Pedido privado|Plano privado/
  );
}

async function testAtomicObservationsProduceComparableCorpusRecords() {
  const request = createRequest('shadow-observer-corpus-1');
  const authoritativeResult = createResult(
    request,
    'legacy',
    'Plano legado privado.'
  );
  const shadowResult = createResult(
    request,
    'codex-app-server-shadow',
    'Plano App Server privado.'
  );
  const fake = createObserver();
  const adapter = createAdapter({ observer: fake.observer });
  const authoritativeRecord = await adapter.observe({
    caseId: 'phase-4-atomic-case-1',
    input: evaluatorInput({
      request,
      result: authoritativeResult,
      role: 'authoritative',
    }),
  });
  const shadowRecord = await adapter.observe({
    caseId: 'phase-4-atomic-case-1',
    input: evaluatorInput({ request, result: shadowResult }),
  });

  assert.strictEqual(fake.calls.length, 2);
  assertDeepFrozen(authoritativeRecord);
  assertDeepFrozen(shadowRecord);
  assert.doesNotMatch(
    JSON.stringify([authoritativeRecord, shadowRecord]),
    /Plano legado privado|Plano App Server privado/
  );
  const corpus = createShadowPlanEvidenceCorpusGrader({
    corpusId: 'phase-4-atomic-corpus.v1',
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
  assert.strictEqual(report.rubricVersion, SHADOW_PLAN_RUBRIC_VERSION);
  assert.strictEqual(adapter.diagnostics().suiteRecords, 2);
}

async function testMismatchedObservationCannotMixRuns() {
  const request = createRequest('shadow-observer-mismatch-1');
  const result = createResult(
    request,
    'codex-app-server-shadow',
    'conteúdo privado da rodada correta'
  );
  const fake = createObserver((input) => observation(input, {
    observationId: 'stale-observation',
    requestId: 'different-request',
  }));
  const adapter = createAdapter({ observer: fake.observer });
  let rejection = null;
  try {
    await adapter.grader.grade(evaluatorInput({ request, result }));
  } catch (error) {
    rejection = error;
  }
  assert.ok(rejection);
  assert.strictEqual(
    rejection.code,
    SHADOW_PLAN_EVIDENCE_SUITE_REASONS.SAFETY_AUDIT_FAILED
  );
  assert.strictEqual(
    rejection.causeCode,
    SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.INVALID_OBSERVATION
  );
  assert.strictEqual(fake.calls.length, 1);
  const diagnostics = adapter.diagnostics();
  assert.strictEqual(diagnostics.observationRejections, 1);
  assert.strictEqual(diagnostics.activeObservations, 0);
  assert.strictEqual(
    diagnostics.lastObservationFailureCode,
    SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.INVALID_OBSERVATION
  );
  assert.strictEqual(
    diagnostics.lastSuiteFailureCode,
    SHADOW_PLAN_EVIDENCE_SUITE_REASONS.SAFETY_AUDIT_FAILED
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /conteúdo privado|rodada correta/
  );
}

async function testHungOrHostileObserverIsBoundedAndSanitized() {
  const request = createRequest('shadow-observer-timeout-1');
  const result = createResult(request, 'codex-app-server-shadow', 'private');
  const input = evaluatorInput({ request, result });
  const hung = createObserver(() => new Promise(() => {}));
  const timeoutAdapter = createAdapter({
    observer: hung.observer,
    observerTimeoutMs: 15,
  });
  await assert.rejects(
    timeoutAdapter.grader.grade(input),
    (error) => error
      && error.code === SHADOW_PLAN_EVIDENCE_SUITE_REASONS.SAFETY_AUDIT_FAILED
      && error.causeCode
        === SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.OBSERVATION_TIMEOUT
  );
  assert.strictEqual(hung.calls.length, 1);
  assert.strictEqual(timeoutAdapter.diagnostics().observationTimeouts, 1);
  assert.strictEqual(timeoutAdapter.diagnostics().activeObservations, 0);

  const hostileFailure = new Proxy(new Error('private observer output'), {
    get(target, key, receiver) {
      if (key === 'code') throw new Error('private getter output');
      return Reflect.get(target, key, receiver);
    },
  });
  const hostile = createObserver(() => Promise.reject(hostileFailure));
  const hostileAdapter = createAdapter({ observer: hostile.observer });
  let rejection = null;
  try {
    await hostileAdapter.grader.grade(input);
  } catch (error) {
    rejection = error;
  }
  assert.ok(rejection);
  assert.strictEqual(
    rejection.causeCode,
    SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.OBSERVATION_FAILED
  );
  assert.doesNotMatch(
    rejection.message,
    /private observer|private getter/
  );
  assert.doesNotMatch(
    JSON.stringify(hostileAdapter.diagnostics()),
    /private observer|private getter/
  );
  assert.strictEqual(hostileAdapter.diagnostics().activeObservations, 0);
}

async function testInvalidDefinitionsFailBeforeObserverActivation() {
  const fake = createObserver();
  const missingCriterion = Object.freeze(checkDefinitions().slice(0, -1));
  assert.throws(
    () => createAdapter({
      observer: fake.observer,
      checks: missingCriterion,
    }),
    (error) => assertReason(
      error,
      SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.INVALID_OPTIONS
    )
  );
  const invalidWeight = checkDefinitions((spec) => (
    spec.id === 'acceptance-secondary'
      ? Object.freeze({ ...spec, weightBasisPoints: 3999 })
      : spec
  ));
  assert.throws(
    () => createAdapter({ observer: fake.observer, checks: invalidWeight }),
    (error) => assertReason(
      error,
      SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.INVALID_OPTIONS
    )
  );
  assert.strictEqual(fake.calls.length, 0);
}

async function run() {
  assert.strictEqual(
    SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_VERSION,
    'shadow-plan-evidence-observer-adapter.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_EVIDENCE_OBSERVATION_SCHEMA_VERSION,
    'shadow-plan-evidence-observation.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_EVIDENCE_CHECK_DEFINITION_SCHEMA_VERSION,
    'shadow-plan-evidence-check-definition.v1'
  );
  assertDeepFrozen(SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS);

  await testOneAtomicObservationFeedsAllChecksAndSafety();
  await testAtomicObservationsProduceComparableCorpusRecords();
  await testMismatchedObservationCannotMixRuns();
  await testHungOrHostileObserverIsBoundedAndSanitized();
  await testInvalidDefinitionsFailBeforeObserverActivation();
  console.log('shadow plan evidence observer adapter tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
