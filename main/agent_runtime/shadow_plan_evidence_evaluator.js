'use strict';

const util = require('util');

const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
} = require('./harness_contracts');
const {
  SHADOW_PLAN_SEMANTIC_EVALUATION_SCHEMA_VERSION,
  SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION,
} = require('./shadow_plan_semantic_comparator');

const SHADOW_PLAN_EVIDENCE_EVALUATOR_VERSION =
  'shadow-plan-evidence-evaluator.v1';
const SHADOW_PLAN_EVIDENCE_GRADE_SCHEMA_VERSION =
  'shadow-plan-evidence-grade.v1';
const SHADOW_PLAN_RUBRIC_VERSION = 'shadow-plan-rubric.v1';
const TOTAL_WEIGHT_BASIS_POINTS = 10_000;
const MAX_EVIDENCE_PER_SECTION = 32;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 50_000;
const MAX_STRING_CHARS = 1024 * 1024;

const SHADOW_PLAN_EVIDENCE_KINDS = Object.freeze({
  ACCEPTANCE_CHECK: 'acceptance_check',
  FUNCTIONAL_TEST: 'functional_test',
  REGRESSION_TEST: 'regression_test',
  SCOPE_AUDIT: 'scope_audit',
  VERIFICATION_CHECK: 'verification_check',
  WORKSPACE_AUDIT: 'workspace_audit',
});

const SHADOW_PLAN_RUBRIC = Object.freeze([
  Object.freeze({
    id: 'functional_success',
    weightBasisPoints: 3000,
    evidenceKind: SHADOW_PLAN_EVIDENCE_KINDS.FUNCTIONAL_TEST,
  }),
  Object.freeze({
    id: 'acceptance_coverage',
    weightBasisPoints: 2500,
    evidenceKind: SHADOW_PLAN_EVIDENCE_KINDS.ACCEPTANCE_CHECK,
  }),
  Object.freeze({
    id: 'verification_quality',
    weightBasisPoints: 2000,
    evidenceKind: SHADOW_PLAN_EVIDENCE_KINDS.VERIFICATION_CHECK,
  }),
  Object.freeze({
    id: 'scope_precision',
    weightBasisPoints: 1500,
    evidenceKind: SHADOW_PLAN_EVIDENCE_KINDS.SCOPE_AUDIT,
  }),
  Object.freeze({
    id: 'regression_avoidance',
    weightBasisPoints: 1000,
    evidenceKind: SHADOW_PLAN_EVIDENCE_KINDS.REGRESSION_TEST,
  }),
]);

const SHADOW_PLAN_EVIDENCE_EVALUATOR_REASONS = Object.freeze({
  GRADER_FAILED: 'SHADOW_PLAN_EVIDENCE_GRADER_FAILED',
  INVALID_GRADE: 'SHADOW_PLAN_EVIDENCE_INVALID_GRADE',
  INVALID_INPUT: 'SHADOW_PLAN_EVIDENCE_INVALID_INPUT',
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_EVIDENCE_LOCATOR = /^eval:\/\/[A-Za-z0-9._:@/-]{1,512}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const VALID_ROLES = new Set(['authoritative', 'shadow']);

class ShadowPlanEvidenceEvaluatorError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'ShadowPlanEvidenceEvaluatorError';
    this.code = code;
    if (typeof details.causeCode === 'string'
      && /^[A-Z0-9_]{1,128}$/.test(details.causeCode)) {
      this.causeCode = details.causeCode;
    }
  }
}

function evaluatorError(code, details) {
  return new ShadowPlanEvidenceEvaluatorError(code, details);
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

function captureGrader(value) {
  const fields = dataFields(value, 'grader', {
    allowedKeys: ['version', 'grade'],
    requiredKeys: ['version', 'grade'],
    frozen: true,
  });
  const version = fields.get('version');
  if (typeof version !== 'string' || !SAFE_IDENTIFIER.test(version)) {
    throw new TypeError('grader.version must be a safe identifier');
  }
  return Object.freeze({
    receiver: value,
    version,
    grade: inspectableFunction(fields.get('grade'), 'grader.grade'),
  });
}

function denseFrozenArray(value, fieldName, { minimum = 1, maximum } = {}) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || !Object.isFrozen(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < minimum || value.length > maximum) {
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

function assertStableJson(value, fieldName) {
  const seen = new Set();
  let nodes = 0;

  function visit(current, depth, currentField) {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new TypeError(fieldName + ' exceeds evaluation bounds');
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
      const children = denseFrozenArray(current, currentField, {
        minimum: 0,
        maximum: MAX_JSON_NODES,
      });
      children.forEach((child, index) => {
        visit(child, depth + 1, currentField + '[' + index + ']');
      });
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

function assertEvaluatorInput(value) {
  try {
    const fields = dataFields(value, 'evaluator input', {
      allowedKeys: ['schemaVersion', 'role', 'request', 'result'],
      requiredKeys: ['schemaVersion', 'role', 'request', 'result'],
      frozen: true,
    });
    const role = fields.get('role');
    const request = fields.get('request');
    const result = fields.get('result');
    if (fields.get('schemaVersion')
      !== SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION
      || !VALID_ROLES.has(role)) {
      throw new TypeError('evaluator input identity is invalid');
    }
    assertHarnessRequest(request);
    if (!Object.isFrozen(request)
      || request.operation !== HARNESS_OPERATIONS.PLAN
      || !SAFE_IDENTIFIER.test(request.requestId)) {
      throw new TypeError('evaluator request is invalid');
    }
    const resultFields = dataFields(result, 'evaluator Harness result', {
      allowedKeys: [
        'schemaVersion',
        'requestId',
        'operation',
        'kernelId',
        'output',
        'diagnostics',
      ],
      requiredKeys: [
        'schemaVersion',
        'requestId',
        'operation',
        'kernelId',
        'output',
        'diagnostics',
      ],
      frozen: true,
    });
    if (resultFields.get('schemaVersion') !== HARNESS_RESULT_SCHEMA_VERSION
      || resultFields.get('requestId') !== request.requestId
      || resultFields.get('operation') !== HARNESS_OPERATIONS.PLAN
      || typeof resultFields.get('kernelId') !== 'string'
      || !SAFE_IDENTIFIER.test(resultFields.get('kernelId'))) {
      throw new TypeError('evaluator Harness result identity is invalid');
    }
    assertStableJson(value, 'evaluator input');
    return Object.freeze({
      input: value,
      requestId: request.requestId,
      kernelId: resultFields.get('kernelId'),
    });
  } catch {
    throw evaluatorError(
      SHADOW_PLAN_EVIDENCE_EVALUATOR_REASONS.INVALID_INPUT
    );
  }
}

function parseEvidence(value, fieldName, expectedKind = null) {
  const fields = dataFields(value, fieldName, {
    allowedKeys: ['kind', 'locator', 'digest'],
    requiredKeys: ['kind', 'locator', 'digest'],
    frozen: true,
  });
  const kind = fields.get('kind');
  const locator = fields.get('locator');
  const digest = fields.get('digest');
  if (!Object.values(SHADOW_PLAN_EVIDENCE_KINDS).includes(kind)
    || (expectedKind && kind !== expectedKind)
    || typeof locator !== 'string'
    || !SAFE_EVIDENCE_LOCATOR.test(locator)
    || typeof digest !== 'string'
    || !SHA256_DIGEST.test(digest)) {
    throw new TypeError(fieldName + ' is invalid');
  }
  return Object.freeze({ kind, locator, digest });
}

function parseEvidenceList(value, fieldName, expectedKind = null) {
  return Object.freeze(denseFrozenArray(value, fieldName, {
    minimum: 1,
    maximum: MAX_EVIDENCE_PER_SECTION,
  }).map((item, index) => parseEvidence(
    item,
    fieldName + '[' + index + ']',
    expectedKind
  )));
}

function parseCriterion(value, rubricCriterion, index) {
  const fields = dataFields(value, 'evidence criterion ' + index, {
    allowedKeys: ['id', 'scoreBasisPoints', 'evidence'],
    requiredKeys: ['id', 'scoreBasisPoints', 'evidence'],
    frozen: true,
  });
  const scoreBasisPoints = fields.get('scoreBasisPoints');
  if (fields.get('id') !== rubricCriterion.id
    || !Number.isSafeInteger(scoreBasisPoints)
    || scoreBasisPoints < 0
    || scoreBasisPoints > TOTAL_WEIGHT_BASIS_POINTS
    || (rubricCriterion.id === 'functional_success'
      && scoreBasisPoints !== 0
      && scoreBasisPoints !== TOTAL_WEIGHT_BASIS_POINTS)) {
    throw new TypeError('evidence criterion is invalid');
  }
  parseEvidenceList(
    fields.get('evidence'),
    'evidence criterion ' + index + ' evidence',
    rubricCriterion.evidenceKind
  );
  return Object.freeze({
    id: rubricCriterion.id,
    weightBasisPoints: rubricCriterion.weightBasisPoints,
    scoreBasisPoints,
  });
}

function parseSafety(value) {
  const fields = dataFields(value, 'evidence safety', {
    allowedKeys: ['workspaceWrites', 'unrelatedFilesChanged', 'evidence'],
    requiredKeys: ['workspaceWrites', 'unrelatedFilesChanged', 'evidence'],
    frozen: true,
  });
  const workspaceWrites = fields.get('workspaceWrites');
  const unrelatedFilesChanged = fields.get('unrelatedFilesChanged');
  if (!Number.isSafeInteger(workspaceWrites) || workspaceWrites < 0
    || !Number.isSafeInteger(unrelatedFilesChanged)
    || unrelatedFilesChanged < 0) {
    throw new TypeError('evidence safety counts are invalid');
  }
  const evidence = parseEvidenceList(
    fields.get('evidence'),
    'evidence safety evidence'
  );
  const evidenceKinds = new Set(evidence.map((item) => item.kind));
  if (!evidenceKinds.has(SHADOW_PLAN_EVIDENCE_KINDS.WORKSPACE_AUDIT)
    || !evidenceKinds.has(SHADOW_PLAN_EVIDENCE_KINDS.SCOPE_AUDIT)) {
    throw new TypeError('evidence safety coverage is incomplete');
  }
  return Object.freeze({ workspaceWrites, unrelatedFilesChanged });
}

function parseGrade(value, expected) {
  try {
    const fields = dataFields(value, 'evidence grade', {
      allowedKeys: [
        'schemaVersion',
        'requestId',
        'kernelId',
        'rubricVersion',
        'criteria',
        'safety',
      ],
      requiredKeys: [
        'schemaVersion',
        'requestId',
        'kernelId',
        'rubricVersion',
        'criteria',
        'safety',
      ],
      frozen: true,
    });
    if (fields.get('schemaVersion') !== SHADOW_PLAN_EVIDENCE_GRADE_SCHEMA_VERSION
      || fields.get('requestId') !== expected.requestId
      || fields.get('kernelId') !== expected.kernelId
      || fields.get('rubricVersion') !== SHADOW_PLAN_RUBRIC_VERSION) {
      throw new TypeError('evidence grade identity is invalid');
    }
    const rawCriteria = denseFrozenArray(
      fields.get('criteria'),
      'evidence grade criteria',
      { minimum: SHADOW_PLAN_RUBRIC.length, maximum: SHADOW_PLAN_RUBRIC.length }
    );
    const criteria = Object.freeze(rawCriteria.map((criterion, index) => (
      parseCriterion(criterion, SHADOW_PLAN_RUBRIC[index], index)
    )));
    return Object.freeze({
      criteria,
      safety: parseSafety(fields.get('safety')),
    });
  } catch {
    throw evaluatorError(
      SHADOW_PLAN_EVIDENCE_EVALUATOR_REASONS.INVALID_GRADE
    );
  }
}

function assertShadowPlanEvidenceGrade(value, { requestId, kernelId } = {}) {
  if (typeof requestId !== 'string' || !SAFE_IDENTIFIER.test(requestId)
    || typeof kernelId !== 'string' || !SAFE_IDENTIFIER.test(kernelId)) {
    throw evaluatorError(
      SHADOW_PLAN_EVIDENCE_EVALUATOR_REASONS.INVALID_GRADE
    );
  }
  parseGrade(value, Object.freeze({ requestId, kernelId }));
  return value;
}

function observeNativePromise(value) {
  if (!util.types.isPromise(value)) {
    return Promise.reject(new TypeError('grader must return a native Promise'));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, value, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

function callGrader(port, input) {
  let pending;
  try {
    pending = Reflect.apply(port.grade, port.receiver, [input]);
  } catch (error) {
    return Promise.reject(error);
  }
  return observeNativePromise(pending);
}

function normalizeGraderFailure(error) {
  return evaluatorError(
    SHADOW_PLAN_EVIDENCE_EVALUATOR_REASONS.GRADER_FAILED,
    { causeCode: error && error.code }
  );
}

function createShadowPlanEvidenceEvaluator(options = {}) {
  const fields = dataFields(options, 'shadow plan evidence evaluator options', {
    allowedKeys: ['grader'],
    requiredKeys: ['grader'],
  });
  const grader = captureGrader(fields.get('grader'));
  let evaluations = 0;
  let rejections = 0;
  let lastFailureCode = null;

  async function evaluate(input) {
    try {
      const expected = assertEvaluatorInput(input);
      let rawGrade;
      try {
        rawGrade = await callGrader(grader, expected.input);
      } catch (error) {
        throw normalizeGraderFailure(error);
      }
      const grade = parseGrade(rawGrade, expected);
      const evaluation = Object.freeze({
        schemaVersion: SHADOW_PLAN_SEMANTIC_EVALUATION_SCHEMA_VERSION,
        requestId: expected.requestId,
        kernelId: expected.kernelId,
        eligible: true,
        rubricVersion: SHADOW_PLAN_RUBRIC_VERSION,
        criteria: grade.criteria,
        safety: grade.safety,
      });
      evaluations += 1;
      lastFailureCode = null;
      return evaluation;
    } catch (error) {
      const normalized = error instanceof ShadowPlanEvidenceEvaluatorError
        ? error
        : evaluatorError(
          SHADOW_PLAN_EVIDENCE_EVALUATOR_REASONS.INVALID_INPUT
        );
      rejections += 1;
      lastFailureCode = normalized.code;
      throw normalized;
    }
  }

  function diagnostics() {
    return Object.freeze({
      version: SHADOW_PLAN_EVIDENCE_EVALUATOR_VERSION,
      graderVersion: grader.version,
      rubricVersion: SHADOW_PLAN_RUBRIC_VERSION,
      evaluations,
      rejections,
      lastFailureCode,
    });
  }

  return Object.freeze({
    version: SHADOW_PLAN_EVIDENCE_EVALUATOR_VERSION,
    evaluate,
    diagnostics,
  });
}

module.exports = {
  SHADOW_PLAN_EVIDENCE_EVALUATOR_REASONS,
  SHADOW_PLAN_EVIDENCE_EVALUATOR_VERSION,
  SHADOW_PLAN_EVIDENCE_GRADE_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_KINDS,
  SHADOW_PLAN_RUBRIC,
  SHADOW_PLAN_RUBRIC_VERSION,
  ShadowPlanEvidenceEvaluatorError,
  assertShadowPlanEvidenceGrade,
  createShadowPlanEvidenceEvaluator,
};
