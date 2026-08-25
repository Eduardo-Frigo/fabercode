'use strict';

const assert = require('assert');

const {
  createHarnessResult,
  createPlanRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  SHADOW_PLAN_EVIDENCE_CORPUS_GRADER_VERSION,
  SHADOW_PLAN_EVIDENCE_CORPUS_REASONS,
  SHADOW_PLAN_EVIDENCE_CORPUS_RECORD_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_CORPUS_VERSION,
  createShadowPlanEvidenceCorpusGrader,
  createShadowPlanEvidenceCorpusRecord,
} = require('../main/agent_runtime/shadow_plan_evidence_corpus');
const {
  SHADOW_PLAN_EVIDENCE_GRADE_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_KINDS,
  SHADOW_PLAN_RUBRIC,
  SHADOW_PLAN_RUBRIC_VERSION,
  createShadowPlanEvidenceEvaluator,
} = require('../main/agent_runtime/shadow_plan_evidence_evaluator');
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

function createRequest(requestId = 'shadow-corpus-request-1') {
  return deepFreeze(createPlanRequest({
    projectInfo: {
      id: 'project-shadow-corpus',
      projectId: 'project-shadow-corpus',
      rootPath: '/workspace/shadow-corpus',
    },
    userMessage: 'Planeje conforme os critérios observáveis do corpus.',
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

const EVIDENCE_KIND_BY_CRITERION = Object.freeze({
  functional_success: SHADOW_PLAN_EVIDENCE_KINDS.FUNCTIONAL_TEST,
  acceptance_coverage: SHADOW_PLAN_EVIDENCE_KINDS.ACCEPTANCE_CHECK,
  verification_quality: SHADOW_PLAN_EVIDENCE_KINDS.VERIFICATION_CHECK,
  scope_precision: SHADOW_PLAN_EVIDENCE_KINDS.SCOPE_AUDIT,
  regression_avoidance: SHADOW_PLAN_EVIDENCE_KINDS.REGRESSION_TEST,
});

function evidence(kind, locatorSuffix, digestCharacter) {
  return deepFreeze({
    kind,
    locator: `eval://phase-4-corpus/${locatorSuffix}`,
    digest: `sha256:${digestCharacter.repeat(64)}`,
  });
}

function createGrade({ request, result, prefix, scores }) {
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_EVIDENCE_GRADE_SCHEMA_VERSION,
    requestId: request.requestId,
    kernelId: result.kernelId,
    rubricVersion: SHADOW_PLAN_RUBRIC_VERSION,
    criteria: SHADOW_PLAN_RUBRIC.map((criterion, index) => ({
      id: criterion.id,
      scoreBasisPoints: scores[index],
      evidence: [evidence(
        EVIDENCE_KIND_BY_CRITERION[criterion.id],
        `${prefix}/criterion-${index + 1}`,
        String(index + 1)
      )],
    })),
    safety: {
      workspaceWrites: 0,
      unrelatedFilesChanged: 0,
      evidence: [
        evidence(
          SHADOW_PLAN_EVIDENCE_KINDS.WORKSPACE_AUDIT,
          `${prefix}/workspace-audit`,
          'a'
        ),
        evidence(
          SHADOW_PLAN_EVIDENCE_KINDS.SCOPE_AUDIT,
          `${prefix}/scope-audit`,
          'b'
        ),
      ],
    },
  });
}

function evaluatorInput({ role, request, result }) {
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION,
    role,
    request,
    result,
  });
}

function createFixture() {
  const request = createRequest();
  const authoritativeResult = createResult(
    request,
    'legacy',
    'Resposta legada privada e diferente do shadow.'
  );
  const shadowResult = createResult(
    request,
    'codex-app-server-shadow',
    'Plano shadow privado, ligado às evidências pelo digest.'
  );
  const authoritativeGrade = createGrade({
    request,
    result: authoritativeResult,
    prefix: 'case-1/authoritative',
    scores: [10000, 8000, 8000, 9000, 9000],
  });
  const shadowGrade = createGrade({
    request,
    result: shadowResult,
    prefix: 'case-1/shadow',
    scores: [10000, 8500, 8500, 9000, 9000],
  });
  const authoritativeRecord = createShadowPlanEvidenceCorpusRecord({
    caseId: 'phase-4-case-1',
    role: 'authoritative',
    request,
    result: authoritativeResult,
    grade: authoritativeGrade,
  });
  const shadowRecord = createShadowPlanEvidenceCorpusRecord({
    caseId: 'phase-4-case-1',
    role: 'shadow',
    request,
    result: shadowResult,
    grade: shadowGrade,
  });
  return {
    authoritativeGrade,
    authoritativeRecord,
    authoritativeResult,
    request,
    shadowGrade,
    shadowRecord,
    shadowResult,
  };
}

function assertReason(error, reason) {
  return error && error.code === reason;
}

async function testRecordsBindExactRequestResultAndEvidence() {
  const fixture = createFixture();
  assert.deepStrictEqual(Reflect.ownKeys(fixture.authoritativeRecord), [
    'schemaVersion',
    'caseId',
    'role',
    'requestId',
    'kernelId',
    'requestDigest',
    'resultDigest',
    'grade',
  ]);
  assert.strictEqual(
    fixture.authoritativeRecord.schemaVersion,
    SHADOW_PLAN_EVIDENCE_CORPUS_RECORD_SCHEMA_VERSION
  );
  assert.match(fixture.authoritativeRecord.requestDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(fixture.authoritativeRecord.resultDigest, /^sha256:[a-f0-9]{64}$/);
  assert.notStrictEqual(
    fixture.authoritativeRecord.requestDigest,
    fixture.authoritativeRecord.resultDigest
  );
  assert.strictEqual(fixture.authoritativeRecord.grade, fixture.authoritativeGrade);
  assertDeepFrozen(fixture.authoritativeRecord);
}

async function testCorpusGraderIntegratesWithoutTextComparison() {
  const fixture = createFixture();
  const corpus = createShadowPlanEvidenceCorpusGrader({
    corpusId: 'phase-4-core.v1',
    records: Object.freeze([
      fixture.authoritativeRecord,
      fixture.shadowRecord,
    ]),
  });
  assert.strictEqual(Object.isFrozen(corpus), true);
  assert.deepStrictEqual(Reflect.ownKeys(corpus.grader), ['version', 'grade']);
  assert.strictEqual(corpus.grader.version, SHADOW_PLAN_EVIDENCE_CORPUS_GRADER_VERSION);
  assert.match(corpus.corpusDigest, /^sha256:[a-f0-9]{64}$/);
  assertDeepFrozen(corpus.grader);

  const evaluator = createShadowPlanEvidenceEvaluator({ grader: corpus.grader });
  const comparator = createShadowPlanSemanticComparator({ evaluator });
  const report = await comparator.compare({
    request: fixture.request,
    authoritativeResult: fixture.authoritativeResult,
    shadowResult: fixture.shadowResult,
  });
  assert.strictEqual(report.parity, true);
  assert.strictEqual(report.rubricVersion, SHADOW_PLAN_RUBRIC_VERSION);
  assert.doesNotMatch(
    JSON.stringify(report),
    /Resposta legada privada|Plano shadow privado/
  );
  assert.deepStrictEqual(corpus.diagnostics(), {
    version: SHADOW_PLAN_EVIDENCE_CORPUS_VERSION,
    graderVersion: SHADOW_PLAN_EVIDENCE_CORPUS_GRADER_VERSION,
    corpusId: 'phase-4-core.v1',
    corpusDigest: corpus.corpusDigest,
    records: 2,
    grades: 2,
    rejections: 0,
    digestMismatches: 0,
    lastFailureCode: null,
  });
  assertDeepFrozen(corpus.diagnostics());
}

async function testChangedResultCannotReuseObservedEvidence() {
  const fixture = createFixture();
  const corpus = createShadowPlanEvidenceCorpusGrader({
    corpusId: 'phase-4-digest-guard.v1',
    records: Object.freeze([fixture.shadowRecord]),
  });
  const changedResult = createResult(
    fixture.request,
    fixture.shadowResult.kernelId,
    'Resultado alterado depois da coleta de evidências.'
  );
  await assert.rejects(
    corpus.grader.grade(evaluatorInput({
      role: 'shadow',
      request: fixture.request,
      result: changedResult,
    })),
    (error) => assertReason(
      error,
      SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.DIGEST_MISMATCH
    )
  );
  const diagnostics = corpus.diagnostics();
  assert.strictEqual(diagnostics.grades, 0);
  assert.strictEqual(diagnostics.rejections, 1);
  assert.strictEqual(diagnostics.digestMismatches, 1);
  assert.strictEqual(
    diagnostics.lastFailureCode,
    SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.DIGEST_MISMATCH
  );
  assert.doesNotMatch(JSON.stringify(diagnostics), /Resultado alterado/);
}

async function testInvalidOrDuplicateEvidenceFailsBeforeRuntimeActivation() {
  const fixture = createFixture();
  const invalidGrade = deepFreeze({
    ...fixture.shadowGrade,
    criteria: fixture.shadowGrade.criteria.map((criterion, index) => (
      index === 0 ? { ...criterion, scoreBasisPoints: 9999 } : criterion
    )),
  });
  assert.throws(
    () => createShadowPlanEvidenceCorpusRecord({
      caseId: 'phase-4-invalid-grade',
      role: 'shadow',
      request: fixture.request,
      result: fixture.shadowResult,
      grade: invalidGrade,
    }),
    (error) => assertReason(
      error,
      SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.INVALID_RECORD
    )
  );
  assert.throws(
    () => createShadowPlanEvidenceCorpusGrader({
      corpusId: 'phase-4-duplicate.v1',
      records: Object.freeze([
        fixture.shadowRecord,
        fixture.shadowRecord,
      ]),
    }),
    (error) => assertReason(
      error,
      SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.DUPLICATE_RECORD
    )
  );
}

async function run() {
  assert.strictEqual(
    SHADOW_PLAN_EVIDENCE_CORPUS_VERSION,
    'shadow-plan-evidence-corpus.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_EVIDENCE_CORPUS_RECORD_SCHEMA_VERSION,
    'shadow-plan-evidence-corpus-record.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_EVIDENCE_CORPUS_GRADER_VERSION,
    'shadow-plan-evidence-corpus-grader.v1'
  );
  assertDeepFrozen(SHADOW_PLAN_EVIDENCE_CORPUS_REASONS);

  await testRecordsBindExactRequestResultAndEvidence();
  await testCorpusGraderIntegratesWithoutTextComparison();
  await testChangedResultCannotReuseObservedEvidence();
  await testInvalidOrDuplicateEvidenceFailsBeforeRuntimeActivation();
  console.log('shadow plan evidence corpus tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
