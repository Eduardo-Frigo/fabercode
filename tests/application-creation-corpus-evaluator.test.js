const assert = require('assert');

const {
  APPLICATION_CREATION_CORPUS_MIN_PASS_RATE,
  createApplicationCreationCorpusEvaluator,
} = require('../main/services/application_creation_corpus_service');

function createObservation(id, overrides = {}) {
  const base = {
    id,
    stack: 'next',
    allowedRuleScopes: ['next'],
    verification: {
      ready: true,
      plan: { steps: [{ id: 'next_entry' }, { id: 'node_build' }] },
      results: [
        { id: 'next_entry', status: 'passed', required: true },
        { id: 'node_build', status: 'passed', required: true },
      ],
    },
    execution: {
      mode: 'controlled',
      started: true,
      criteriaMet: true,
    },
    dirtyWorktree: {
      required: false,
      preserved: true,
    },
    promoted: true,
  };
  return {
    ...base,
    ...overrides,
    verification: {
      ...base.verification,
      ...(overrides.verification || {}),
    },
    execution: {
      ...base.execution,
      ...(overrides.execution || {}),
    },
    dirtyWorktree: {
      ...base.dirtyWorktree,
      ...(overrides.dirtyWorktree || {}),
    },
  };
}

function testControlledCorpusKeepsLiveGatePending() {
  const evaluator = createApplicationCreationCorpusEvaluator();
  const observations = Array.from({ length: 7 }, (_, index) => createObservation(`controlled-${index + 1}`));
  observations[6] = createObservation('controlled-7', {
    execution: { criteriaMet: false },
    promoted: false,
  });

  const report = evaluator.evaluate(observations);

  assert.strictEqual(APPLICATION_CREATION_CORPUS_MIN_PASS_RATE, 0.85);
  assert.strictEqual(report.totalScenarios, 7);
  assert.strictEqual(report.passedScenarios, 6);
  assert.strictEqual(report.passRate, 0.8571);
  assert.strictEqual(report.preflightPassed, true);
  assert.strictEqual(report.liveExecutionCoverage, 0);
  assert.strictEqual(report.gatePassed, false);
  assert.strictEqual(report.status, 'pending_live_execution');
  assert.deepStrictEqual(report.pendingLiveScenarios, observations.map((entry) => entry.id));
  assert.strictEqual(Object.isFrozen(report), true);
  assert.strictEqual(Object.isFrozen(report.scenarios), true);
}

function testLiveCorpusPassesAtTheSameThreshold() {
  const evaluator = createApplicationCreationCorpusEvaluator();
  const observations = Array.from({ length: 7 }, (_, index) => createObservation(`live-${index + 1}`, {
    execution: { mode: 'live' },
  }));
  observations[6] = createObservation('live-7', {
    execution: { mode: 'live', criteriaMet: false },
    promoted: false,
  });

  const report = evaluator.evaluate(observations);

  assert.strictEqual(report.passRate, 0.8571);
  assert.strictEqual(report.liveExecutionCoverage, 1);
  assert.strictEqual(report.preflightPassed, true);
  assert.strictEqual(report.gatePassed, true);
  assert.strictEqual(report.status, 'passed');
}

function testBelowThresholdFails() {
  const evaluator = createApplicationCreationCorpusEvaluator();
  const observations = Array.from({ length: 6 }, (_, index) => createObservation(`threshold-${index + 1}`));
  observations[4] = createObservation('threshold-5', {
    execution: { criteriaMet: false },
    promoted: false,
  });
  observations[5] = createObservation('threshold-6', {
    execution: { started: false },
    promoted: false,
  });

  const report = evaluator.evaluate(observations);

  assert.strictEqual(report.passRate, 0.6667);
  assert.strictEqual(report.preflightPassed, false);
  assert.strictEqual(report.gatePassed, false);
  assert.strictEqual(report.status, 'failed');
}

function testForeignStackRuleFailsTheCorpus() {
  const evaluator = createApplicationCreationCorpusEvaluator();
  const report = evaluator.evaluate([
    createObservation('cross-stack', {
      verification: {
        plan: {
          steps: [
            { id: 'next_entry' },
            { id: 'persistence_prisma_schema' },
          ],
        },
      },
      execution: { mode: 'live' },
    }),
  ]);

  assert.strictEqual(report.passRate, 0);
  assert.strictEqual(report.preflightPassed, false);
  assert.deepStrictEqual(report.crossStackViolations, [{
    scenarioId: 'cross-stack',
    stepId: 'persistence_prisma_schema',
    ruleScope: 'prisma_postgres',
  }]);
}

function testRequiredFailureCanNeverBePromoted() {
  const evaluator = createApplicationCreationCorpusEvaluator();
  const report = evaluator.evaluate([
    createObservation('failed-build', {
      verification: {
        ready: false,
        results: [{ id: 'node_build', status: 'failed', required: true }],
      },
      execution: { mode: 'live' },
      promoted: true,
    }),
  ]);

  assert.strictEqual(report.gatePassed, false);
  assert.deepStrictEqual(report.requiredFailureScenarios, ['failed-build']);
  assert.deepStrictEqual(report.unsafePromotionScenarios, ['failed-build']);
}

function testDirtyWorktreeMustRemainPreserved() {
  const evaluator = createApplicationCreationCorpusEvaluator();
  const report = evaluator.evaluate([
    createObservation('dirty-worktree', {
      dirtyWorktree: { required: true, preserved: false },
      execution: { mode: 'live' },
      promoted: false,
    }),
  ]);

  assert.strictEqual(report.passRate, 0);
  assert.deepStrictEqual(report.dirtyWorktreeViolations, ['dirty-worktree']);
  assert.strictEqual(report.gatePassed, false);
}

function main() {
  testControlledCorpusKeepsLiveGatePending();
  testLiveCorpusPassesAtTheSameThreshold();
  testBelowThresholdFails();
  testForeignStackRuleFailsTheCorpus();
  testRequiredFailureCanNeverBePromoted();
  testDirtyWorktreeMustRemainPreserved();
  console.log('application-creation-corpus-evaluator.test.js: ok');
}

main();
