'use strict';

const util = require('util');

const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
} = require('./harness_contracts');
const {
  createShadowPlanEvidenceCorpusRecord,
} = require('./shadow_plan_evidence_corpus');
const {
  SHADOW_PLAN_EVIDENCE_GRADE_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_KINDS,
  SHADOW_PLAN_RUBRIC,
  SHADOW_PLAN_RUBRIC_VERSION,
  assertShadowPlanEvidenceGrade,
} = require('./shadow_plan_evidence_evaluator');
const {
  SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION,
} = require('./shadow_plan_semantic_comparator');

const SHADOW_PLAN_EVIDENCE_SUITE_VERSION =
  'shadow-plan-evidence-suite.v1';
const SHADOW_PLAN_EVIDENCE_SUITE_GRADER_VERSION =
  'shadow-plan-evidence-suite-grader.v1';
const SHADOW_PLAN_EVIDENCE_CHECK_RECEIPT_SCHEMA_VERSION =
  'shadow-plan-evidence-check-receipt.v1';
const SHADOW_PLAN_SAFETY_AUDIT_RECEIPT_SCHEMA_VERSION =
  'shadow-plan-safety-audit-receipt.v1';

const SHADOW_PLAN_EVIDENCE_SUITE_REASONS = Object.freeze({
  CHECK_FAILED: 'SHADOW_PLAN_EVIDENCE_CHECK_FAILED',
  CHECK_TIMEOUT: 'SHADOW_PLAN_EVIDENCE_CHECK_TIMEOUT',
  CORPUS_RECORD_FAILED: 'SHADOW_PLAN_EVIDENCE_CORPUS_RECORD_FAILED',
  INVALID_CHECK_RECEIPT: 'SHADOW_PLAN_EVIDENCE_INVALID_CHECK_RECEIPT',
  INVALID_INPUT: 'SHADOW_PLAN_EVIDENCE_SUITE_INVALID_INPUT',
  INVALID_OPTIONS: 'SHADOW_PLAN_EVIDENCE_SUITE_INVALID_OPTIONS',
  INVALID_SAFETY_RECEIPT: 'SHADOW_PLAN_EVIDENCE_INVALID_SAFETY_RECEIPT',
  SAFETY_AUDIT_FAILED: 'SHADOW_PLAN_SAFETY_AUDIT_FAILED',
  SAFETY_AUDIT_TIMEOUT: 'SHADOW_PLAN_SAFETY_AUDIT_TIMEOUT',
});

const TOTAL_WEIGHT_BASIS_POINTS = 10_000;
const MAX_CHECKS = 32;
const MAX_EVIDENCE_PER_SECTION = 32;
const MIN_TIMEOUT_MS = 10;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 100_000;
const MAX_STRING_CHARS = 4 * 1024 * 1024;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_EVIDENCE_LOCATOR = /^eval:\/\/[A-Za-z0-9._:@/-]{1,512}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const VALID_ROLES = new Set(['authoritative', 'shadow']);
const VALID_WORKSPACE_MODES = new Set(['read_only', 'disposable_copy']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CHECK_KEYS = Object.freeze([
  'version',
  'id',
  'criterionId',
  'weightBasisPoints',
  'timeoutMs',
  'run',
]);
const RESULT_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'operation',
  'kernelId',
  'output',
  'diagnostics',
]);

class ShadowPlanEvidenceSuiteError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'ShadowPlanEvidenceSuiteError';
    this.code = code;
    if (typeof details.causeCode === 'string'
      && /^[A-Z0-9_]{1,128}$/.test(details.causeCode)) {
      this.causeCode = details.causeCode;
    }
  }
}

function suiteError(code, details) {
  return new ShadowPlanEvidenceSuiteError(code, details);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys, {
  frozen = false,
} = {}) {
  if (!isPlainRecord(value) || (frozen && !Object.isFrozen(value))) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.some((key) => typeof key !== 'string'
    || FORBIDDEN_KEYS.has(key)
    || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function dataFields(value, fieldName, { frozen = true } = {}) {
  if (!isPlainRecord(value) || (frozen && !Object.isFrozen(value))) {
    throw new TypeError(fieldName + ' must be a stable data record');
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(fieldName + ' must be inspectable');
  }
  const fields = new Map();
  for (const key of keys) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) {
      throw new TypeError(fieldName + ' contains a forbidden key');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) {
      throw new TypeError(fieldName + ' must contain data values');
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function denseFrozenArray(value, fieldName, minimum, maximum) {
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

function assertIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(fieldName + ' must be a safe identifier');
  }
  return value;
}

function assertTimeout(value, fieldName) {
  if (!Number.isSafeInteger(value)
    || value < MIN_TIMEOUT_MS
    || value > MAX_TIMEOUT_MS) {
    throw new TypeError(fieldName + ' is outside the bounded timeout range');
  }
  return value;
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
      if (!Number.isFinite(current) || Object.is(current, -0)) {
        throw new TypeError(currentField + ' is invalid');
      }
      return;
    }
    if (!current || typeof current !== 'object' || util.types.isProxy(current)
      || !Object.isFrozen(current) || seen.has(current)) {
      throw new TypeError(currentField + ' must be stable JSON data');
    }
    seen.add(current);
    if (Array.isArray(current)) {
      const children = denseFrozenArray(
        current,
        currentField,
        0,
        MAX_JSON_NODES
      );
      children.forEach((child, index) => {
        visit(child, depth + 1, currentField + '[' + index + ']');
      });
      return;
    }
    const fields = dataFields(current, currentField);
    for (const [key, child] of fields.entries()) {
      visit(child, depth + 1, currentField + '.' + key);
    }
  }

  visit(value, 0, fieldName);
  return value;
}

function inspectEvaluatorInput(value) {
  try {
    const fields = exactDataFields(value, [
      'schemaVersion',
      'role',
      'request',
      'result',
    ], undefined, { frozen: true });
    if (!fields
      || fields.get('schemaVersion')
        !== SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION
      || !VALID_ROLES.has(fields.get('role'))) {
      throw new TypeError('evaluator input identity is invalid');
    }
    const request = fields.get('request');
    const result = fields.get('result');
    assertHarnessRequest(request);
    if (!Object.isFrozen(request)
      || request.operation !== HARNESS_OPERATIONS.PLAN) {
      throw new TypeError('evaluator request is invalid');
    }
    const requestId = assertIdentifier(request.requestId, 'requestId');
    const resultFields = exactDataFields(
      result,
      RESULT_KEYS,
      RESULT_KEYS,
      { frozen: true }
    );
    if (!resultFields
      || resultFields.get('schemaVersion') !== HARNESS_RESULT_SCHEMA_VERSION
      || resultFields.get('requestId') !== requestId
      || resultFields.get('operation') !== HARNESS_OPERATIONS.PLAN) {
      throw new TypeError('evaluator result identity is invalid');
    }
    const kernelId = assertIdentifier(
      resultFields.get('kernelId'),
      'kernelId'
    );
    assertStableJson(value, 'evaluator input');
    return Object.freeze({
      input: value,
      role: fields.get('role'),
      request,
      result,
      requestId,
      kernelId,
    });
  } catch {
    throw suiteError(SHADOW_PLAN_EVIDENCE_SUITE_REASONS.INVALID_INPUT);
  }
}

function parseEvidence(value, fieldName, expectedKind = null) {
  const fields = exactDataFields(value, [
    'kind',
    'locator',
    'digest',
  ], undefined, { frozen: true });
  if (!fields) throw new TypeError(fieldName + ' is invalid');
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
  return value;
}

function parseEvidenceList(value, fieldName, expectedKind = null) {
  return Object.freeze(denseFrozenArray(
    value,
    fieldName,
    1,
    MAX_EVIDENCE_PER_SECTION
  ).map((item, index) => parseEvidence(
    item,
    fieldName + '[' + index + ']',
    expectedKind
  )));
}

function captureCheck(value, index, rubricById) {
  const fields = exactDataFields(
    value,
    CHECK_KEYS,
    CHECK_KEYS,
    { frozen: true }
  );
  if (!fields) throw new TypeError('check ' + index + ' is invalid');
  const version = assertIdentifier(fields.get('version'), 'check.version');
  const id = assertIdentifier(fields.get('id'), 'check.id');
  const criterionId = assertIdentifier(
    fields.get('criterionId'),
    'check.criterionId'
  );
  const rubricCriterion = rubricById.get(criterionId);
  const weightBasisPoints = fields.get('weightBasisPoints');
  if (!rubricCriterion
    || !Number.isSafeInteger(weightBasisPoints)
    || weightBasisPoints <= 0
    || weightBasisPoints > TOTAL_WEIGHT_BASIS_POINTS) {
    throw new TypeError('check rubric coverage is invalid');
  }
  return Object.freeze({
    receiver: value,
    version,
    id,
    criterionId,
    evidenceKind: rubricCriterion.evidenceKind,
    weightBasisPoints,
    timeoutMs: assertTimeout(fields.get('timeoutMs'), 'check.timeoutMs'),
    run: inspectableFunction(fields.get('run'), 'check.run'),
  });
}

function captureChecks(value) {
  const rubricById = new Map(SHADOW_PLAN_RUBRIC.map((criterion) => [
    criterion.id,
    criterion,
  ]));
  const checks = denseFrozenArray(value, 'checks', 1, MAX_CHECKS)
    .map((check, index) => captureCheck(check, index, rubricById));
  const checkIds = new Set();
  const criterionCounts = new Map();
  const criterionWeights = new Map();
  for (const check of checks) {
    if (checkIds.has(check.id)) throw new TypeError('check ids must be unique');
    checkIds.add(check.id);
    criterionCounts.set(
      check.criterionId,
      (criterionCounts.get(check.criterionId) || 0) + 1
    );
    criterionWeights.set(
      check.criterionId,
      (criterionWeights.get(check.criterionId) || 0)
        + check.weightBasisPoints
    );
  }
  for (const criterion of SHADOW_PLAN_RUBRIC) {
    if (criterionWeights.get(criterion.id) !== TOTAL_WEIGHT_BASIS_POINTS) {
      throw new TypeError('each rubric criterion must have complete weight');
    }
  }
  if (criterionCounts.get('functional_success') !== 1
    || checks.find((check) => check.criterionId === 'functional_success')
      .weightBasisPoints !== TOTAL_WEIGHT_BASIS_POINTS) {
    throw new TypeError('functional success must be a single binary check');
  }
  return Object.freeze(checks);
}

function captureSafetyAudit(value) {
  const fields = exactDataFields(value, [
    'version',
    'timeoutMs',
    'run',
  ], undefined, { frozen: true });
  if (!fields) throw new TypeError('safetyAudit must be a frozen port');
  return Object.freeze({
    receiver: value,
    version: assertIdentifier(fields.get('version'), 'safetyAudit.version'),
    timeoutMs: assertTimeout(fields.get('timeoutMs'), 'safetyAudit.timeoutMs'),
    run: inspectableFunction(fields.get('run'), 'safetyAudit.run'),
  });
}

function parseCheckReceipt(value, check) {
  try {
    const fields = exactDataFields(value, [
      'schemaVersion',
      'checkId',
      'passed',
      'evidence',
    ], undefined, { frozen: true });
    if (!fields
      || fields.get('schemaVersion')
        !== SHADOW_PLAN_EVIDENCE_CHECK_RECEIPT_SCHEMA_VERSION
      || fields.get('checkId') !== check.id
      || typeof fields.get('passed') !== 'boolean') {
      throw new TypeError('check receipt identity is invalid');
    }
    return Object.freeze({
      check,
      passed: fields.get('passed'),
      evidence: parseEvidenceList(
        fields.get('evidence'),
        'check receipt evidence',
        check.evidenceKind
      ),
    });
  } catch {
    throw suiteError(
      SHADOW_PLAN_EVIDENCE_SUITE_REASONS.INVALID_CHECK_RECEIPT
    );
  }
}

function parseSafetyReceipt(value) {
  try {
    const fields = exactDataFields(value, [
      'schemaVersion',
      'workspaceWrites',
      'unrelatedFilesChanged',
      'evidence',
    ], undefined, { frozen: true });
    const workspaceWrites = fields && fields.get('workspaceWrites');
    const unrelatedFilesChanged = fields
      && fields.get('unrelatedFilesChanged');
    if (!fields
      || fields.get('schemaVersion')
        !== SHADOW_PLAN_SAFETY_AUDIT_RECEIPT_SCHEMA_VERSION
      || !Number.isSafeInteger(workspaceWrites)
      || workspaceWrites < 0
      || !Number.isSafeInteger(unrelatedFilesChanged)
      || unrelatedFilesChanged < 0) {
      throw new TypeError('safety receipt identity is invalid');
    }
    const evidence = parseEvidenceList(
      fields.get('evidence'),
      'safety receipt evidence'
    );
    const evidenceKinds = new Set(evidence.map((item) => item.kind));
    if (!evidenceKinds.has(SHADOW_PLAN_EVIDENCE_KINDS.WORKSPACE_AUDIT)
      || !evidenceKinds.has(SHADOW_PLAN_EVIDENCE_KINDS.SCOPE_AUDIT)) {
      throw new TypeError('safety receipt coverage is incomplete');
    }
    return Object.freeze({
      workspaceWrites,
      unrelatedFilesChanged,
      evidence,
    });
  } catch {
    throw suiteError(
      SHADOW_PLAN_EVIDENCE_SUITE_REASONS.INVALID_SAFETY_RECEIPT
    );
  }
}

function causeDetails(error) {
  let causeCode = null;
  if (error && (typeof error === 'object' || typeof error === 'function')
    && !util.types.isProxy(error)) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
      if (descriptor && Object.hasOwn(descriptor, 'value')
        && typeof descriptor.value === 'string') {
        causeCode = descriptor.value;
      }
    } catch {
      causeCode = null;
    }
  }
  return Object.freeze({
    causeCode,
  });
}

function callPortWithTimeout(port, input, {
  failedReason,
  timeoutReason,
}) {
  let pending;
  try {
    pending = Reflect.apply(port.run, port.receiver, [input]);
  } catch (error) {
    return Promise.reject(suiteError(failedReason, causeDetails(error)));
  }
  if (!util.types.isPromise(pending)) {
    return Promise.reject(suiteError(failedReason));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(suiteError(timeoutReason));
    }, port.timeoutMs);
    try {
      Reflect.apply(Promise.prototype.then, pending, [
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(suiteError(failedReason, causeDetails(error)));
        },
      ]);
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(suiteError(failedReason));
      }
    }
  });
}

function buildGrade(inspected, observedChecks, safety) {
  const scores = new Map();
  const evidenceByCriterion = new Map();
  for (const criterion of SHADOW_PLAN_RUBRIC) {
    scores.set(criterion.id, 0);
    evidenceByCriterion.set(criterion.id, []);
  }
  for (const observed of observedChecks) {
    if (observed.passed) {
      scores.set(
        observed.check.criterionId,
        scores.get(observed.check.criterionId)
          + observed.check.weightBasisPoints
      );
    }
    evidenceByCriterion.get(observed.check.criterionId)
      .push(...observed.evidence);
  }
  const grade = Object.freeze({
    schemaVersion: SHADOW_PLAN_EVIDENCE_GRADE_SCHEMA_VERSION,
    requestId: inspected.requestId,
    kernelId: inspected.kernelId,
    rubricVersion: SHADOW_PLAN_RUBRIC_VERSION,
    criteria: Object.freeze(SHADOW_PLAN_RUBRIC.map((criterion) => (
      Object.freeze({
        id: criterion.id,
        scoreBasisPoints: scores.get(criterion.id),
        evidence: Object.freeze([
          ...evidenceByCriterion.get(criterion.id),
        ]),
      })
    ))),
    safety: Object.freeze({
      workspaceWrites: safety.workspaceWrites,
      unrelatedFilesChanged: safety.unrelatedFilesChanged,
      evidence: safety.evidence,
    }),
  });
  try {
    assertShadowPlanEvidenceGrade(grade, {
      requestId: inspected.requestId,
      kernelId: inspected.kernelId,
    });
  } catch {
    throw suiteError(
      SHADOW_PLAN_EVIDENCE_SUITE_REASONS.INVALID_CHECK_RECEIPT
    );
  }
  return grade;
}

function createShadowPlanEvidenceSuite(options = {}) {
  let suiteId;
  let workspaceMode;
  let checks;
  let safetyAudit;
  try {
    const fields = exactDataFields(options, [
      'suiteId',
      'workspaceMode',
      'checks',
      'safetyAudit',
    ]);
    if (!fields) throw new TypeError('suite options are invalid');
    suiteId = assertIdentifier(fields.get('suiteId'), 'suiteId');
    workspaceMode = fields.get('workspaceMode');
    if (!VALID_WORKSPACE_MODES.has(workspaceMode)) {
      throw new TypeError('workspaceMode is invalid');
    }
    checks = captureChecks(fields.get('checks'));
    safetyAudit = captureSafetyAudit(fields.get('safetyAudit'));
  } catch {
    throw suiteError(SHADOW_PLAN_EVIDENCE_SUITE_REASONS.INVALID_OPTIONS);
  }

  let attempts = 0;
  let evaluations = 0;
  let records = 0;
  let rejections = 0;
  let timeouts = 0;
  let safetyAudits = 0;
  let lastFailureCode = null;

  function registerFailure(error) {
    const normalized = error instanceof ShadowPlanEvidenceSuiteError
      ? error
      : suiteError(SHADOW_PLAN_EVIDENCE_SUITE_REASONS.INVALID_INPUT);
    rejections += 1;
    lastFailureCode = normalized.code;
    return normalized;
  }

  async function executeEvaluation(input) {
    attempts += 1;
    try {
      const inspected = inspectEvaluatorInput(input);
      const observedChecks = [];
      let checkFailure = null;
      for (const check of checks) {
        try {
          const receipt = await callPortWithTimeout(check, inspected.input, {
            failedReason: SHADOW_PLAN_EVIDENCE_SUITE_REASONS.CHECK_FAILED,
            timeoutReason: SHADOW_PLAN_EVIDENCE_SUITE_REASONS.CHECK_TIMEOUT,
          });
          observedChecks.push(parseCheckReceipt(receipt, check));
        } catch (error) {
          checkFailure = error instanceof ShadowPlanEvidenceSuiteError
            ? error
            : suiteError(
              SHADOW_PLAN_EVIDENCE_SUITE_REASONS.CHECK_FAILED
            );
          if (checkFailure.code
            === SHADOW_PLAN_EVIDENCE_SUITE_REASONS.CHECK_TIMEOUT) {
            timeouts += 1;
          }
          break;
        }
      }

      let safety = null;
      let safetyFailure = null;
      safetyAudits += 1;
      try {
        const receipt = await callPortWithTimeout(
          safetyAudit,
          inspected.input,
          {
            failedReason:
              SHADOW_PLAN_EVIDENCE_SUITE_REASONS.SAFETY_AUDIT_FAILED,
            timeoutReason:
              SHADOW_PLAN_EVIDENCE_SUITE_REASONS.SAFETY_AUDIT_TIMEOUT,
          }
        );
        safety = parseSafetyReceipt(receipt);
      } catch (error) {
        safetyFailure = error instanceof ShadowPlanEvidenceSuiteError
          ? error
          : suiteError(
            SHADOW_PLAN_EVIDENCE_SUITE_REASONS.SAFETY_AUDIT_FAILED
          );
        if (safetyFailure.code
          === SHADOW_PLAN_EVIDENCE_SUITE_REASONS.SAFETY_AUDIT_TIMEOUT) {
          timeouts += 1;
        }
      }

      if (safetyFailure) throw safetyFailure;
      if (checkFailure) throw checkFailure;
      const grade = buildGrade(inspected, observedChecks, safety);
      evaluations += 1;
      lastFailureCode = null;
      return Object.freeze({ inspected, grade });
    } catch (error) {
      throw registerFailure(error);
    }
  }

  async function grade(input) {
    const evaluated = await executeEvaluation(input);
    return evaluated.grade;
  }

  async function observe(optionsValue = {}) {
    let caseId;
    let input;
    try {
      const fields = exactDataFields(optionsValue, ['caseId', 'input']);
      if (!fields) throw new TypeError('observe options are invalid');
      caseId = assertIdentifier(fields.get('caseId'), 'caseId');
      input = fields.get('input');
    } catch {
      attempts += 1;
      throw registerFailure(suiteError(
        SHADOW_PLAN_EVIDENCE_SUITE_REASONS.INVALID_INPUT
      ));
    }
    const evaluated = await executeEvaluation(input);
    try {
      const record = createShadowPlanEvidenceCorpusRecord({
        caseId,
        role: evaluated.inspected.role,
        request: evaluated.inspected.request,
        result: evaluated.inspected.result,
        grade: evaluated.grade,
      });
      records += 1;
      lastFailureCode = null;
      return record;
    } catch (error) {
      throw registerFailure(suiteError(
        SHADOW_PLAN_EVIDENCE_SUITE_REASONS.CORPUS_RECORD_FAILED,
        causeDetails(error)
      ));
    }
  }

  const grader = Object.freeze({
    version: SHADOW_PLAN_EVIDENCE_SUITE_GRADER_VERSION,
    grade,
  });

  function diagnostics() {
    return Object.freeze({
      version: SHADOW_PLAN_EVIDENCE_SUITE_VERSION,
      graderVersion: SHADOW_PLAN_EVIDENCE_SUITE_GRADER_VERSION,
      suiteId,
      workspaceMode,
      checks: checks.length,
      attempts,
      evaluations,
      records,
      rejections,
      timeouts,
      safetyAudits,
      lastFailureCode,
    });
  }

  return Object.freeze({
    version: SHADOW_PLAN_EVIDENCE_SUITE_VERSION,
    suiteId,
    workspaceMode,
    grader,
    observe,
    diagnostics,
  });
}

module.exports = {
  SHADOW_PLAN_EVIDENCE_CHECK_RECEIPT_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_SUITE_GRADER_VERSION,
  SHADOW_PLAN_EVIDENCE_SUITE_REASONS,
  SHADOW_PLAN_EVIDENCE_SUITE_VERSION,
  SHADOW_PLAN_SAFETY_AUDIT_RECEIPT_SCHEMA_VERSION,
  ShadowPlanEvidenceSuiteError,
  createShadowPlanEvidenceSuite,
};
