'use strict';

const assert = require('assert');

const { AgentKernel } = require('../main/agent_runtime/agent_kernel');
const {
  CONTEXT_PACK_CITATION_KINDS,
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
  createContextPackCitation,
  createContextPackSection,
} = require('../main/agent_runtime/context_pack_contracts');
const {
  createContextPackCompiler,
} = require('../main/agent_runtime/context_pack_compiler');
const {
  attachContextPackToHarnessRequest,
  createHarnessResult,
  createPlanRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  SHADOW_PLAN_SEMANTIC_EVALUATION_SCHEMA_VERSION,
  createShadowPlanSemanticComparator,
} = require('../main/agent_runtime/shadow_plan_semantic_comparator');
const {
  SHADOW_PLAN_RUNNER_REASONS,
  SHADOW_PLAN_RUNNER_VERSION,
  createShadowPlanRunner,
} = require('../main/agent_runtime/shadow_plan_runner');

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function digest(character) {
  return 'sha256:' + character.repeat(64);
}

function availableSection({ id, kind, locator, character, summary }) {
  return createContextPackSection({
    id,
    state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
    revision: 'revision-shadow-runner-1',
    summary,
    citations: Object.freeze([createContextPackCitation({
      kind,
      locator,
      revision: 'revision-shadow-runner-1',
      digest: digest(character),
    })]),
    truncated: false,
  });
}

function createRequest({
  requestId = 'shadow-runner-request-1',
  withContextPack = true,
  surface = CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE,
} = {}) {
  const payload = deepFreeze({
    projectInfo: {
      id: 'project-shadow-runner',
      projectId: 'project-shadow-runner',
      rootPath: '/workspace/shadow-runner',
    },
    userMessage: 'Planeje a refatoração preservando comportamento.',
  });
  const request = createPlanRequest(payload, { requestId });
  if (!withContextPack) return request;
  const manifest = createContextPackCompiler({
    now: () => '2026-08-24T22:00:00.000Z',
  }).compile({
    requestId,
    projectId: payload.projectInfo.projectId,
    surface,
    sections: Object.freeze([
      availableSection({
        id: CONTEXT_PACK_SECTION_IDS.REQUEST,
        kind: CONTEXT_PACK_CITATION_KINDS.RUNTIME_REQUEST,
        locator: 'runtime://request/' + requestId,
        character: 'c',
        summary: payload.userMessage,
      }),
      availableSection({
        id: CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
        kind: CONTEXT_PACK_CITATION_KINDS.JOB_AUTHORITY,
        locator: 'authority://request/' + requestId,
        character: 'd',
        summary: 'Somente planejamento shadow sem mutações.',
      }),
    ]),
  });
  return attachContextPackToHarnessRequest(request, manifest);
}

function createResult(request, kernelId, response) {
  return createHarnessResult({
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
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

class RecordingKernel extends AgentKernel {
  constructor(id, runPlan) {
    super({ id, version: id + '.v1', capabilities: ['plan'] });
    this.calls = [];
    this.runPlan = runPlan;
  }

  plan(request) {
    this.calls.push(request);
    return this.runPlan(request);
  }
}

function createEvaluation(requestId, kernelId, scores) {
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_SEMANTIC_EVALUATION_SCHEMA_VERSION,
    requestId,
    kernelId,
    eligible: true,
    rubricVersion: 'runner-rubric.v1',
    criteria: [
      {
        id: 'acceptance_coverage',
        weightBasisPoints: 5000,
        scoreBasisPoints: scores[0],
      },
      {
        id: 'verification_quality',
        weightBasisPoints: 5000,
        scoreBasisPoints: scores[1],
      },
    ],
    safety: {
      workspaceWrites: 0,
      unrelatedFilesChanged: 0,
    },
  });
}

function createComparator(requestId, evaluatorCalls = null) {
  const evaluator = Object.freeze({
    version: 'runner-evaluator.v1',
    evaluate(input) {
      if (evaluatorCalls) evaluatorCalls.push(input);
      const scores = input.role === 'authoritative'
        ? [7000, 7000]
        : [7300, 7200];
      return Promise.resolve(createEvaluation(
        requestId,
        input.result.kernelId,
        scores
      ));
    },
  });
  return createShadowPlanSemanticComparator({ evaluator });
}

function createSink() {
  const reports = [];
  return {
    reports,
    sink: Object.freeze({
      version: 'test-shadow-report-sink.v1',
      record(report) {
        reports.push(report);
      },
    }),
  };
}

function createRunnerFixture({
  request = createRequest(),
  legacyRun,
  shadowRun,
  comparator = null,
  sinkFixture = createSink(),
  shadowObservationTimeoutMs = 1000,
  comparisonTimeoutMs = 1000,
} = {}) {
  const legacyResult = createResult(request, 'legacy', 'Resposta legada autoritativa.');
  const shadowResult = deepFreeze(createResult(
    request,
    'codex-app-server-shadow',
    '1. Mapear.\n2. Alterar.\n3. Validar.'
  ));
  const legacyKernel = new RecordingKernel(
    'legacy',
    legacyRun || (() => Promise.resolve(legacyResult))
  );
  const shadowKernel = new RecordingKernel(
    'codex-app-server-shadow',
    shadowRun || (() => Promise.resolve(shadowResult))
  );
  const runner = createShadowPlanRunner({
    authoritativeKernel: legacyKernel,
    shadowKernel,
    comparator: comparator || createComparator(request.requestId),
    reportSink: sinkFixture.sink,
    shadowObservationTimeoutMs,
    comparisonTimeoutMs,
  });
  return {
    legacyKernel,
    legacyResult,
    request,
    runner,
    shadowKernel,
    shadowResult,
    sinkFixture,
  };
}

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(resolve, ms, value));
}

async function testAuthoritativeResultDoesNotWaitForShadow() {
  const shadow = deferred();
  const fixture = createRunnerFixture({ shadowRun: () => shadow.promise });
  const pending = fixture.runner.plan(fixture.request);
  const race = await Promise.race([
    pending.then((result) => ({ kind: 'result', result })),
    delay(50, { kind: 'timeout' }),
  ]);
  assert.strictEqual(race.kind, 'result');
  assert.strictEqual(race.result, fixture.legacyResult);
  assert.strictEqual(fixture.legacyKernel.calls.length, 1);
  assert.strictEqual(fixture.shadowKernel.calls.length, 1);
  assert.strictEqual(fixture.legacyKernel.calls[0], fixture.request);
  assert.strictEqual(fixture.shadowKernel.calls[0], fixture.request);
  assert.strictEqual(fixture.sinkFixture.reports.length, 0);
  assert.strictEqual(fixture.runner.diagnostics().activeObservations, 1);

  shadow.resolve(fixture.shadowResult);
  const drained = await fixture.runner.drain();
  assert.strictEqual(fixture.sinkFixture.reports.length, 1);
  assert.strictEqual(fixture.sinkFixture.reports[0].requestId, fixture.request.requestId);
  assert.strictEqual(fixture.sinkFixture.reports[0].parity, true);
  assert.deepStrictEqual(drained, fixture.runner.diagnostics());
  assert.deepStrictEqual(fixture.runner.diagnostics(), {
    version: SHADOW_PLAN_RUNNER_VERSION,
    authoritativeKernelId: 'legacy',
    shadowKernelId: 'codex-app-server-shadow',
    shadowObservationTimeoutMs: 1000,
    comparisonTimeoutMs: 1000,
    plans: 1,
    authoritativeCompleted: 1,
    authoritativeFailed: 0,
    shadowStarted: 1,
    shadowSkipped: 0,
    shadowCompleted: 1,
    shadowFailed: 0,
    shadowTimedOut: 0,
    comparisonsCompleted: 1,
    comparisonsFailed: 0,
    reportsRecorded: 1,
    reportsRejected: 0,
    activeObservations: 0,
    lastShadowFailureCode: null,
    lastComparisonVerdict: 'equivalent',
  });
}

async function testIneligibleRequestNeverStartsShadow() {
  const request = createRequest({
    requestId: 'shadow-runner-ineligible',
    withContextPack: false,
  });
  const fixture = createRunnerFixture({ request });
  const result = await fixture.runner.plan(request);
  assert.strictEqual(result, fixture.legacyResult);
  assert.strictEqual(fixture.legacyKernel.calls.length, 1);
  assert.strictEqual(fixture.shadowKernel.calls.length, 0);
  assert.strictEqual(fixture.runner.diagnostics().shadowSkipped, 1);
  assert.strictEqual(fixture.runner.diagnostics().activeObservations, 0);
}

async function testComparisonUsesSnapshotCapturedBeforePublicReturn() {
  const request = createRequest({ requestId: 'shadow-runner-stable-snapshot' });
  const evaluatorCalls = [];
  const shadow = deferred();
  const fixture = createRunnerFixture({
    request,
    comparator: createComparator(request.requestId, evaluatorCalls),
    shadowRun: () => shadow.promise,
  });
  const result = await fixture.runner.plan(request);
  assert.strictEqual(result, fixture.legacyResult);
  const authoritativeText = result.output.response;
  result.output.response = 'texto adulterado depois da devolução pública';
  shadow.resolve(fixture.shadowResult);
  await fixture.runner.drain();
  const authoritativeEvaluation = evaluatorCalls.find(
    (input) => input.role === 'authoritative'
  );
  assert(authoritativeEvaluation);
  assert.strictEqual(
    authoritativeEvaluation.result.output.response,
    authoritativeText
  );
  assert.notStrictEqual(
    authoritativeEvaluation.result.output.response,
    result.output.response
  );
}

async function testShadowFailureCannotReplaceLegacyResult() {
  const privateFailure = new Error('private shadow provider response');
  privateFailure.code = 'PRIVATE_SHADOW_FAILURE';
  const fixture = createRunnerFixture({
    request: createRequest({ requestId: 'shadow-runner-shadow-failure' }),
    shadowRun: () => Promise.reject(privateFailure),
  });
  const result = await fixture.runner.plan(fixture.request);
  assert.strictEqual(result, fixture.legacyResult);
  await fixture.runner.drain();
  const diagnostics = fixture.runner.diagnostics();
  assert.strictEqual(diagnostics.authoritativeCompleted, 1);
  assert.strictEqual(diagnostics.shadowFailed, 1);
  assert.strictEqual(diagnostics.comparisonsCompleted, 0);
  assert.strictEqual(
    diagnostics.lastShadowFailureCode,
    SHADOW_PLAN_RUNNER_REASONS.SHADOW_FAILED
  );
  assert.strictEqual(fixture.sinkFixture.reports.length, 0);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private shadow|provider response/i);
}

async function testComparatorFailureCannotReplaceLegacyResult() {
  const comparator = Object.freeze({
    version: 'failing-comparator.v1',
    compare() {
      return Promise.reject(new Error('private comparison inputs'));
    },
    diagnostics() {
      return Object.freeze({ version: 'failing-comparator.v1' });
    },
  });
  const fixture = createRunnerFixture({
    request: createRequest({ requestId: 'shadow-runner-comparison-failure' }),
    comparator,
  });
  const result = await fixture.runner.plan(fixture.request);
  assert.strictEqual(result, fixture.legacyResult);
  await fixture.runner.drain();
  assert.strictEqual(fixture.runner.diagnostics().comparisonsFailed, 1);
  assert.strictEqual(fixture.sinkFixture.reports.length, 0);
  assert.doesNotMatch(
    JSON.stringify(fixture.runner.diagnostics()),
    /private comparison/i
  );
}

async function testAuthoritativeFailureRemainsAuthoritative() {
  const authoritativeFailure = new Error('legacy public failure');
  const request = createRequest({ requestId: 'shadow-runner-legacy-failure' });
  const fixture = createRunnerFixture({
    request,
    legacyRun: () => Promise.reject(authoritativeFailure),
  });
  await assert.rejects(
    fixture.runner.plan(request),
    (error) => error === authoritativeFailure
  );
  await fixture.runner.drain();
  assert.strictEqual(fixture.runner.diagnostics().authoritativeFailed, 1);
  assert.strictEqual(fixture.runner.diagnostics().comparisonsCompleted, 0);
  assert.strictEqual(fixture.sinkFixture.reports.length, 0);
}

async function testShadowObservationTimeoutIsBounded() {
  const never = deferred();
  const fixture = createRunnerFixture({
    request: createRequest({ requestId: 'shadow-runner-timeout' }),
    shadowRun: () => never.promise,
    shadowObservationTimeoutMs: 20,
  });
  const result = await fixture.runner.plan(fixture.request);
  assert.strictEqual(result, fixture.legacyResult);
  await fixture.runner.drain();
  const diagnostics = fixture.runner.diagnostics();
  assert.strictEqual(diagnostics.shadowTimedOut, 1);
  assert.strictEqual(diagnostics.shadowFailed, 1);
  assert.strictEqual(
    diagnostics.lastShadowFailureCode,
    SHADOW_PLAN_RUNNER_REASONS.SHADOW_TIMEOUT
  );
}

async function run() {
  assert.strictEqual(SHADOW_PLAN_RUNNER_VERSION, 'shadow-plan-runner.v1');
  assert.strictEqual(Object.isFrozen(SHADOW_PLAN_RUNNER_REASONS), true);
  assert.throws(() => createShadowPlanRunner(), /authoritativeKernel/i);

  await testAuthoritativeResultDoesNotWaitForShadow();
  await testIneligibleRequestNeverStartsShadow();
  await testComparisonUsesSnapshotCapturedBeforePublicReturn();
  await testShadowFailureCannotReplaceLegacyResult();
  await testComparatorFailureCannotReplaceLegacyResult();
  await testAuthoritativeFailureRemainsAuthoritative();
  await testShadowObservationTimeoutIsBounded();
  console.log('shadow plan runner tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
