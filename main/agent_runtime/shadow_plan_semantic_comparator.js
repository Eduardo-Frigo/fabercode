'use strict';

const util = require('util');

const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
} = require('./harness_contracts');

const SHADOW_PLAN_SEMANTIC_COMPARATOR_VERSION =
  'shadow-plan-semantic-comparator.v1';
const SHADOW_PLAN_SEMANTIC_EVALUATION_SCHEMA_VERSION =
  'shadow-plan-semantic-evaluation.v1';
const SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION =
  'shadow-plan-semantic-comparison.v1';
const SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION =
  'shadow-plan-semantic-evaluator-input.v1';
const DEFAULT_TOLERANCE_BASIS_POINTS = 300;
const MAX_CRITERIA = 64;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 50_000;
const MAX_STRING_CHARS = 1024 * 1024;
const TOTAL_WEIGHT_BASIS_POINTS = 10_000;

const SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS = Object.freeze({
  EVALUATION_MISMATCH: 'SHADOW_PLAN_SEMANTIC_EVALUATION_MISMATCH',
  EVALUATOR_FAILED: 'SHADOW_PLAN_SEMANTIC_EVALUATOR_FAILED',
  INVALID_EVALUATION: 'SHADOW_PLAN_SEMANTIC_INVALID_EVALUATION',
  INVALID_INPUT: 'SHADOW_PLAN_SEMANTIC_INVALID_INPUT',
});

const SHADOW_PLAN_SEMANTIC_VERDICTS = Object.freeze({
  AUTHORITATIVE_BETTER: 'authoritative_better',
  EQUIVALENT: 'equivalent',
  SAFETY_VIOLATION: 'safety_violation',
  SHADOW_BETTER: 'shadow_better',
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;

class ShadowPlanSemanticComparatorError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'ShadowPlanSemanticComparatorError';
    this.code = code;
    if (typeof details.causeCode === 'string'
      && /^[A-Z0-9_]{1,128}$/.test(details.causeCode)) {
      this.causeCode = details.causeCode;
    }
  }
}

function comparatorError(code, details) {
  return new ShadowPlanSemanticComparatorError(code, details);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, fieldName, {
  allowedKeys = null,
  requiredKeys = null,
  frozen = false,
} = {}) {
  if (!isPlainRecord(value) || (frozen && !Object.isFrozen(value))) {
    throw new TypeError(fieldName + ' must be a plain data record');
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(fieldName + ' must be inspectable');
  }
  if (keys.some((key) => typeof key !== 'string'
    || FORBIDDEN_KEYS.has(key)
    || (allowedKeys && !allowedKeys.includes(key)))) {
    throw new TypeError(fieldName + ' has invalid fields');
  }
  if (requiredKeys) {
    const missing = requiredKeys.find((key) => !keys.includes(key));
    if (missing) throw new TypeError(fieldName + ' is missing ' + missing);
  }
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) {
      throw new TypeError(fieldName + ' must contain enumerable data values');
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function inspectableFunction(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)) {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  try {
    Function.prototype.toString.call(value);
  } catch {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  return value;
}

function captureEvaluator(value) {
  const fields = dataFields(value, 'evaluator', {
    allowedKeys: ['version', 'evaluate', 'diagnostics'],
    requiredKeys: ['version', 'evaluate'],
    frozen: true,
  });
  const version = fields.get('version');
  if (typeof version !== 'string' || !SAFE_IDENTIFIER.test(version)) {
    throw new TypeError('evaluator.version must be a safe identifier');
  }
  return Object.freeze({
    receiver: value,
    version,
    evaluate: inspectableFunction(fields.get('evaluate'), 'evaluator.evaluate'),
  });
}

function boundedInteger(value, fallback, minimum, maximum, fieldName) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate)
    || candidate < minimum || candidate > maximum) {
    throw new TypeError(fieldName + ' is outside its supported bounds');
  }
  return candidate;
}

function assertStableJson(value, fieldName) {
  const seen = new Set();
  let nodes = 0;

  function visit(current, depth, currentField) {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new TypeError(fieldName + ' exceeds comparison bounds');
    }
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      if (current.length > MAX_STRING_CHARS || current.includes('\0')) {
        throw new TypeError(currentField + ' is invalid');
      }
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError(currentField + ' is invalid');
      return;
    }
    if (!current || typeof current !== 'object' || util.types.isProxy(current)
      || !Object.isFrozen(current) || seen.has(current)) {
      throw new TypeError(currentField + ' must be stable JSON data');
    }
    seen.add(current);

    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) {
        throw new TypeError(currentField + ' must be a standard array');
      }
      const keys = Reflect.ownKeys(current).filter((key) => key !== 'length');
      if (keys.length !== current.length
        || keys.some((key, index) => key !== String(index))) {
        throw new TypeError(currentField + ' must be a dense array');
      }
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError(currentField + ' must contain data values');
        }
        visit(descriptor.value, depth + 1, currentField + '[' + index + ']');
      }
      return;
    }

    const fields = dataFields(current, currentField, { frozen: true });
    for (const [key, child] of fields.entries()) {
      visit(child, depth + 1, currentField + '.' + key);
    }
  }

  visit(value, 0, fieldName);
  return value;
}

function assertPlanRequest(value) {
  try {
    assertHarnessRequest(value);
    if (!Object.isFrozen(value) || value.operation !== HARNESS_OPERATIONS.PLAN) {
      throw new TypeError('comparison request must be a frozen plan request');
    }
    assertStableJson(value, 'comparison request');
    return value;
  } catch {
    throw comparatorError(
      SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS.INVALID_INPUT
    );
  }
}

function assertPlanResult(value, request, fieldName) {
  try {
    const fields = dataFields(value, fieldName, { frozen: true });
    if (fields.get('schemaVersion') !== HARNESS_RESULT_SCHEMA_VERSION
      || fields.get('requestId') !== request.requestId
      || fields.get('operation') !== HARNESS_OPERATIONS.PLAN
      || typeof fields.get('kernelId') !== 'string'
      || !SAFE_IDENTIFIER.test(fields.get('kernelId'))
      || !fields.has('output')) {
      throw new TypeError(fieldName + ' is invalid');
    }
    assertStableJson(value, fieldName);
    return value;
  } catch {
    throw comparatorError(
      SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS.INVALID_INPUT
    );
  }
}

function parseCriterion(value, index) {
  const fields = dataFields(value, 'evaluation criterion ' + index, {
    allowedKeys: ['id', 'weightBasisPoints', 'scoreBasisPoints'],
    requiredKeys: ['id', 'weightBasisPoints', 'scoreBasisPoints'],
    frozen: true,
  });
  const id = fields.get('id');
  const weightBasisPoints = fields.get('weightBasisPoints');
  const scoreBasisPoints = fields.get('scoreBasisPoints');
  if (typeof id !== 'string' || !SAFE_IDENTIFIER.test(id)
    || !Number.isSafeInteger(weightBasisPoints)
    || weightBasisPoints < 1
    || weightBasisPoints > TOTAL_WEIGHT_BASIS_POINTS
    || !Number.isSafeInteger(scoreBasisPoints)
    || scoreBasisPoints < 0
    || scoreBasisPoints > TOTAL_WEIGHT_BASIS_POINTS) {
    throw new TypeError('evaluation criterion is invalid');
  }
  return Object.freeze({ id, weightBasisPoints, scoreBasisPoints });
}

function denseFrozenArray(value, fieldName, maximum) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || !Object.isFrozen(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1 || value.length > maximum) {
    throw new TypeError(fieldName + ' must be a bounded frozen array');
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(fieldName + ' must be dense');
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(fieldName + ' must contain data values');
    }
    return descriptor.value;
  });
}

function parseSafety(value) {
  const fields = dataFields(value, 'semantic evaluation safety', {
    allowedKeys: ['workspaceWrites', 'unrelatedFilesChanged'],
    requiredKeys: ['workspaceWrites', 'unrelatedFilesChanged'],
    frozen: true,
  });
  const workspaceWrites = fields.get('workspaceWrites');
  const unrelatedFilesChanged = fields.get('unrelatedFilesChanged');
  if (!Number.isSafeInteger(workspaceWrites) || workspaceWrites < 0
    || !Number.isSafeInteger(unrelatedFilesChanged)
    || unrelatedFilesChanged < 0) {
    throw new TypeError('semantic evaluation safety is invalid');
  }
  return Object.freeze({ workspaceWrites, unrelatedFilesChanged });
}

function parseEvaluation(value, expected) {
  try {
    const fields = dataFields(value, 'semantic evaluation', {
      allowedKeys: [
        'schemaVersion',
        'requestId',
        'kernelId',
        'eligible',
        'rubricVersion',
        'criteria',
        'safety',
      ],
      requiredKeys: [
        'schemaVersion',
        'requestId',
        'kernelId',
        'eligible',
        'rubricVersion',
        'criteria',
        'safety',
      ],
      frozen: true,
    });
    if (fields.get('schemaVersion') !== SHADOW_PLAN_SEMANTIC_EVALUATION_SCHEMA_VERSION
      || fields.get('requestId') !== expected.requestId
      || fields.get('kernelId') !== expected.kernelId
      || fields.get('eligible') !== true
      || typeof fields.get('rubricVersion') !== 'string'
      || !SAFE_IDENTIFIER.test(fields.get('rubricVersion'))) {
      throw new TypeError('semantic evaluation identity is invalid');
    }
    const criteria = Object.freeze(denseFrozenArray(
      fields.get('criteria'),
      'semantic evaluation criteria',
      MAX_CRITERIA
    ).map(parseCriterion));
    const ids = new Set(criteria.map((criterion) => criterion.id));
    const totalWeight = criteria.reduce(
      (sum, criterion) => sum + criterion.weightBasisPoints,
      0
    );
    if (ids.size !== criteria.length
      || totalWeight !== TOTAL_WEIGHT_BASIS_POINTS) {
      throw new TypeError('semantic evaluation rubric is invalid');
    }
    return Object.freeze({
      requestId: fields.get('requestId'),
      kernelId: fields.get('kernelId'),
      rubricVersion: fields.get('rubricVersion'),
      criteria,
      safety: parseSafety(fields.get('safety')),
    });
  } catch (error) {
    if (error instanceof ShadowPlanSemanticComparatorError) throw error;
    throw comparatorError(
      SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS.INVALID_EVALUATION
    );
  }
}

function observeNativePromise(value) {
  if (!util.types.isPromise(value)) {
    return Promise.reject(comparatorError(
      SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS.EVALUATOR_FAILED
    ));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, value, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

function callEvaluator(port, input) {
  let pending;
  try {
    pending = Reflect.apply(port.evaluate, port.receiver, [input]);
  } catch (error) {
    return Promise.reject(error);
  }
  return observeNativePromise(pending);
}

function evaluationInput(role, request, result) {
  return Object.freeze({
    schemaVersion: SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION,
    role,
    request,
    result,
  });
}

function normalizeEvaluatorFailure(error) {
  if (error instanceof ShadowPlanSemanticComparatorError) return error;
  return comparatorError(
    SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS.EVALUATOR_FAILED,
    { causeCode: error && error.code }
  );
}

function assertMatchingEvaluations(authoritative, shadow) {
  const rubricMatches = authoritative.rubricVersion === shadow.rubricVersion;
  const criteriaMatch = authoritative.criteria.length === shadow.criteria.length
    && authoritative.criteria.every((criterion, index) => (
      criterion.id === shadow.criteria[index].id
      && criterion.weightBasisPoints === shadow.criteria[index].weightBasisPoints
    ));
  if (!rubricMatches || !criteriaMatch) {
    throw comparatorError(
      SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS.EVALUATION_MISMATCH
    );
  }
}

function weightedScore(criteria) {
  const numerator = criteria.reduce(
    (sum, criterion) => sum
      + (criterion.weightBasisPoints * criterion.scoreBasisPoints),
    0
  );
  return Math.round(numerator / TOTAL_WEIGHT_BASIS_POINTS);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function buildReport({
  request,
  authoritativeResult,
  shadowResult,
  authoritativeEvaluation,
  shadowEvaluation,
  toleranceBasisPoints,
}) {
  assertMatchingEvaluations(authoritativeEvaluation, shadowEvaluation);
  const authoritativeScore = weightedScore(authoritativeEvaluation.criteria);
  const shadowScore = weightedScore(shadowEvaluation.criteria);
  const delta = shadowScore - authoritativeScore;
  const safetyPassed = shadowEvaluation.safety.workspaceWrites === 0
    && shadowEvaluation.safety.unrelatedFilesChanged === 0;
  let verdict;
  if (!safetyPassed) {
    verdict = SHADOW_PLAN_SEMANTIC_VERDICTS.SAFETY_VIOLATION;
  } else if (delta > toleranceBasisPoints) {
    verdict = SHADOW_PLAN_SEMANTIC_VERDICTS.SHADOW_BETTER;
  } else if (delta < -toleranceBasisPoints) {
    verdict = SHADOW_PLAN_SEMANTIC_VERDICTS.AUTHORITATIVE_BETTER;
  } else {
    verdict = SHADOW_PLAN_SEMANTIC_VERDICTS.EQUIVALENT;
  }
  const parity = safetyPassed && delta >= -toleranceBasisPoints;
  const criteria = authoritativeEvaluation.criteria.map((criterion, index) => {
    const shadowCriterion = shadowEvaluation.criteria[index];
    return {
      id: criterion.id,
      weightBasisPoints: criterion.weightBasisPoints,
      authoritativeScoreBasisPoints: criterion.scoreBasisPoints,
      shadowScoreBasisPoints: shadowCriterion.scoreBasisPoints,
      deltaBasisPoints: shadowCriterion.scoreBasisPoints - criterion.scoreBasisPoints,
    };
  });
  return deepFreeze({
    schemaVersion: SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION,
    requestId: request.requestId,
    operation: HARNESS_OPERATIONS.PLAN,
    rubricVersion: authoritativeEvaluation.rubricVersion,
    eligible: true,
    verdict,
    parity,
    toleranceBasisPoints,
    kernels: {
      authoritative: authoritativeResult.kernelId,
      shadow: shadowResult.kernelId,
    },
    scores: {
      authoritativeBasisPoints: authoritativeScore,
      shadowBasisPoints: shadowScore,
      deltaBasisPoints: delta,
    },
    safety: {
      authoritativeWorkspaceWrites:
        authoritativeEvaluation.safety.workspaceWrites,
      authoritativeUnrelatedFilesChanged:
        authoritativeEvaluation.safety.unrelatedFilesChanged,
      shadowWorkspaceWrites: shadowEvaluation.safety.workspaceWrites,
      shadowUnrelatedFilesChanged:
        shadowEvaluation.safety.unrelatedFilesChanged,
      passed: safetyPassed,
    },
    criteria,
  });
}

function createShadowPlanSemanticComparator(options = {}) {
  const fields = dataFields(options, 'shadow semantic comparator options', {
    allowedKeys: ['evaluator', 'toleranceBasisPoints'],
    requiredKeys: ['evaluator'],
  });
  const evaluator = captureEvaluator(fields.get('evaluator'));
  const toleranceBasisPoints = boundedInteger(
    fields.get('toleranceBasisPoints'),
    DEFAULT_TOLERANCE_BASIS_POINTS,
    0,
    TOTAL_WEIGHT_BASIS_POINTS,
    'toleranceBasisPoints'
  );
  let comparisons = 0;
  let parityPasses = 0;
  let safetyViolations = 0;
  let rejections = 0;
  let lastVerdict = null;
  let lastFailureCode = null;

  async function compare(input = {}) {
    try {
      const inputFields = dataFields(input, 'semantic comparison input', {
        allowedKeys: ['request', 'authoritativeResult', 'shadowResult'],
        requiredKeys: ['request', 'authoritativeResult', 'shadowResult'],
      });
      const request = assertPlanRequest(inputFields.get('request'));
      const authoritativeResult = assertPlanResult(
        inputFields.get('authoritativeResult'),
        request,
        'authoritative Harness result'
      );
      const shadowResult = assertPlanResult(
        inputFields.get('shadowResult'),
        request,
        'shadow Harness result'
      );
      if (authoritativeResult.kernelId === shadowResult.kernelId) {
        throw comparatorError(
          SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS.INVALID_INPUT
        );
      }

      let values;
      try {
        values = await Promise.all([
          callEvaluator(evaluator, evaluationInput(
            'authoritative',
            request,
            authoritativeResult
          )),
          callEvaluator(evaluator, evaluationInput(
            'shadow',
            request,
            shadowResult
          )),
        ]);
      } catch (error) {
        throw normalizeEvaluatorFailure(error);
      }
      const authoritativeEvaluation = parseEvaluation(values[0], {
        requestId: request.requestId,
        kernelId: authoritativeResult.kernelId,
      });
      const shadowEvaluation = parseEvaluation(values[1], {
        requestId: request.requestId,
        kernelId: shadowResult.kernelId,
      });
      const report = buildReport({
        request,
        authoritativeResult,
        shadowResult,
        authoritativeEvaluation,
        shadowEvaluation,
        toleranceBasisPoints,
      });
      comparisons += 1;
      if (report.parity) parityPasses += 1;
      if (report.verdict === SHADOW_PLAN_SEMANTIC_VERDICTS.SAFETY_VIOLATION) {
        safetyViolations += 1;
      }
      lastVerdict = report.verdict;
      lastFailureCode = null;
      return report;
    } catch (error) {
      const normalized = error instanceof ShadowPlanSemanticComparatorError
        ? error
        : comparatorError(
          SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS.INVALID_INPUT
        );
      rejections += 1;
      lastFailureCode = normalized.code;
      throw normalized;
    }
  }

  function diagnostics() {
    return Object.freeze({
      version: SHADOW_PLAN_SEMANTIC_COMPARATOR_VERSION,
      evaluatorVersion: evaluator.version,
      toleranceBasisPoints,
      comparisons,
      parityPasses,
      safetyViolations,
      rejections,
      lastVerdict,
      lastFailureCode,
    });
  }

  return Object.freeze({
    version: SHADOW_PLAN_SEMANTIC_COMPARATOR_VERSION,
    compare,
    diagnostics,
  });
}

module.exports = {
  SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION,
  SHADOW_PLAN_SEMANTIC_COMPARATOR_REASONS,
  SHADOW_PLAN_SEMANTIC_COMPARATOR_VERSION,
  SHADOW_PLAN_SEMANTIC_EVALUATION_SCHEMA_VERSION,
  SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION,
  SHADOW_PLAN_SEMANTIC_VERDICTS,
  ShadowPlanSemanticComparatorError,
  createShadowPlanSemanticComparator,
};
