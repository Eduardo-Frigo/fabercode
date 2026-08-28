const APPLICATION_CREATION_CORPUS_VERSION = 'application-creation-corpus.v1';
const APPLICATION_CREATION_CORPUS_MIN_PASS_RATE = 0.85;

function roundedRatio(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeStepId(value = '') {
  return String(value || '').trim().toLowerCase();
}

function classifyApplicationRuleScope(stepId = '') {
  const id = normalizeStepId(stepId);
  if (/^next_/.test(id)) return 'next';
  if (/^tailwind_/.test(id)) return 'tailwind';
  if (/^electron_/.test(id)) return 'electron';
  if (/^monorepo_/.test(id)) return 'monorepo';
  if (/^persistence_supabase_/.test(id)) return 'supabase';
  if (/^persistence_firebase_/.test(id)) return 'firebase';
  if (/^persistence_(drizzle|sqlite)_/.test(id)) return 'drizzle_sqlite';
  if (/^persistence_(prisma|docker)_/.test(id)) return 'prisma_postgres';
  if (/^(fastapi|python)_/.test(id)) return 'fastapi';
  if (/^(lamp|php_lint)_/.test(id)) return 'lamp';
  if (/^static_web_/.test(id)) return 'static_web';
  return 'generic';
}

function collectRequiredFailureIds(verification = {}) {
  const failures = new Set();
  const results = Array.isArray(verification.results) ? verification.results : [];
  for (const result of results) {
    if (!result || result.required !== true) continue;
    if (['failed', 'blocked', 'manual'].includes(String(result.status || '').toLowerCase())) {
      failures.add(normalizeStepId(result.id) || 'required_verification');
    }
  }

  const steps = verification.plan && Array.isArray(verification.plan.steps)
    ? verification.plan.steps
    : [];
  for (const step of steps) {
    if (!step || step.required !== true || step.kind !== 'static') continue;
    if (String(step.expectedStatus || '').toLowerCase() === 'failed') {
      failures.add(normalizeStepId(step.id) || 'required_static_verification');
    }
  }
  return Array.from(failures);
}

function normalizeAllowedRuleScopes(observation = {}) {
  return new Set(
    (Array.isArray(observation.allowedRuleScopes) ? observation.allowedRuleScopes : [])
      .map((scope) => String(scope || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function inspectForeignStackRules(observation = {}) {
  const verification = observation.verification && typeof observation.verification === 'object'
    ? observation.verification
    : {};
  const steps = verification.plan && Array.isArray(verification.plan.steps)
    ? verification.plan.steps
    : [];
  const allowedScopes = normalizeAllowedRuleScopes(observation);
  const violations = [];
  const seen = new Set();
  for (const step of steps) {
    const stepId = normalizeStepId(step && step.id);
    const ruleScope = classifyApplicationRuleScope(stepId);
    if (!stepId || ruleScope === 'generic' || allowedScopes.has(ruleScope)) continue;
    const key = `${stepId}:${ruleScope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({
      scenarioId: String(observation.id || ''),
      stepId,
      ruleScope,
    });
  }
  return violations;
}

function normalizeMinimumPassRate(value) {
  if (value === undefined || value === null) return APPLICATION_CREATION_CORPUS_MIN_PASS_RATE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new TypeError('minimumPassRate must be greater than 0 and at most 1');
  }
  return parsed;
}

function createApplicationCreationCorpusEvaluator(options = {}) {
  const minimumPassRate = normalizeMinimumPassRate(options.minimumPassRate);

  function evaluate(observations = []) {
    if (!Array.isArray(observations) || observations.length === 0) {
      throw new TypeError('application creation corpus requires at least one observation');
    }

    const scenarioIds = new Set();
    const scenarios = [];
    const crossStackViolations = [];
    const requiredFailureScenarios = [];
    const unsafePromotionScenarios = [];
    const dirtyWorktreeViolations = [];
    const pendingLiveScenarios = [];

    for (const observation of observations) {
      if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
        throw new TypeError('application creation observation must be an object');
      }
      const id = String(observation.id || '').trim();
      if (!id || scenarioIds.has(id)) {
        throw new TypeError('application creation observation id must be unique and non-empty');
      }
      scenarioIds.add(id);

      const verification = observation.verification && typeof observation.verification === 'object'
        ? observation.verification
        : {};
      const execution = observation.execution && typeof observation.execution === 'object'
        ? observation.execution
        : {};
      const dirtyWorktree = observation.dirtyWorktree && typeof observation.dirtyWorktree === 'object'
        ? observation.dirtyWorktree
        : {};
      const requiredFailureIds = collectRequiredFailureIds(verification);
      const foreignRules = inspectForeignStackRules(observation);
      const verificationReady = verification.ready === true && requiredFailureIds.length === 0;
      const executionMode = execution.mode === 'live' ? 'live' : 'controlled';
      const executionPassed = execution.started === true && execution.criteriaMet === true;
      const dirtyWorktreePreserved = dirtyWorktree.required !== true || dirtyWorktree.preserved === true;
      const passed = verificationReady
        && executionPassed
        && dirtyWorktreePreserved
        && foreignRules.length === 0;

      crossStackViolations.push(...foreignRules);
      if (requiredFailureIds.length > 0) requiredFailureScenarios.push(id);
      if (observation.promoted === true && requiredFailureIds.length > 0) unsafePromotionScenarios.push(id);
      if (!dirtyWorktreePreserved) dirtyWorktreeViolations.push(id);
      if (executionMode !== 'live') pendingLiveScenarios.push(id);

      scenarios.push({
        id,
        stack: String(observation.stack || '').trim(),
        passed,
        verificationReady,
        executionMode,
        executionPassed,
        dirtyWorktreePreserved,
        requiredFailureIds,
        foreignRuleCount: foreignRules.length,
        promoted: observation.promoted === true,
      });
    }

    const totalScenarios = scenarios.length;
    const passedScenarios = scenarios.filter((scenario) => scenario.passed).length;
    const liveScenarios = scenarios.filter((scenario) => scenario.executionMode === 'live').length;
    const livePassedScenarios = scenarios.filter(
      (scenario) => scenario.executionMode === 'live' && scenario.passed
    ).length;
    const passRate = roundedRatio(passedScenarios, totalScenarios);
    const liveExecutionCoverage = roundedRatio(liveScenarios, totalScenarios);
    const preflightPassed = passRate >= minimumPassRate
      && crossStackViolations.length === 0
      && unsafePromotionScenarios.length === 0
      && dirtyWorktreeViolations.length === 0;
    const gatePassed = preflightPassed && liveExecutionCoverage === 1;
    const status = gatePassed
      ? 'passed'
      : preflightPassed && pendingLiveScenarios.length > 0
        ? 'pending_live_execution'
        : 'failed';

    return deepFreeze({
      version: APPLICATION_CREATION_CORPUS_VERSION,
      minimumPassRate,
      totalScenarios,
      passedScenarios,
      passRate,
      liveScenarios,
      livePassedScenarios,
      livePassRate: roundedRatio(livePassedScenarios, totalScenarios),
      liveExecutionCoverage,
      preflightPassed,
      gatePassed,
      status,
      pendingLiveScenarios,
      crossStackViolations,
      requiredFailureScenarios,
      unsafePromotionScenarios,
      dirtyWorktreeViolations,
      scenarios,
    });
  }

  return Object.freeze({
    evaluate,
    minimumPassRate,
    version: APPLICATION_CREATION_CORPUS_VERSION,
  });
}

module.exports = {
  APPLICATION_CREATION_CORPUS_MIN_PASS_RATE,
  APPLICATION_CREATION_CORPUS_VERSION,
  classifyApplicationRuleScope,
  createApplicationCreationCorpusEvaluator,
};
