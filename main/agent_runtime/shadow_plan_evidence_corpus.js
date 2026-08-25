'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
} = require('./harness_contracts');
const {
  SHADOW_PLAN_EVIDENCE_GRADE_SCHEMA_VERSION,
  SHADOW_PLAN_RUBRIC_VERSION,
  assertShadowPlanEvidenceGrade,
} = require('./shadow_plan_evidence_evaluator');
const {
  SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION,
} = require('./shadow_plan_semantic_comparator');

const SHADOW_PLAN_EVIDENCE_CORPUS_VERSION =
  'shadow-plan-evidence-corpus.v1';
const SHADOW_PLAN_EVIDENCE_CORPUS_RECORD_SCHEMA_VERSION =
  'shadow-plan-evidence-corpus-record.v1';
const SHADOW_PLAN_EVIDENCE_CORPUS_GRADER_VERSION =
  'shadow-plan-evidence-corpus-grader.v1';

const SHADOW_PLAN_EVIDENCE_CORPUS_REASONS = Object.freeze({
  DIGEST_MISMATCH: 'SHADOW_PLAN_EVIDENCE_CORPUS_DIGEST_MISMATCH',
  DUPLICATE_RECORD: 'SHADOW_PLAN_EVIDENCE_CORPUS_DUPLICATE_RECORD',
  INVALID_INPUT: 'SHADOW_PLAN_EVIDENCE_CORPUS_INVALID_INPUT',
  INVALID_OPTIONS: 'SHADOW_PLAN_EVIDENCE_CORPUS_INVALID_OPTIONS',
  INVALID_RECORD: 'SHADOW_PLAN_EVIDENCE_CORPUS_INVALID_RECORD',
  RECORD_NOT_FOUND: 'SHADOW_PLAN_EVIDENCE_CORPUS_RECORD_NOT_FOUND',
});

const MAX_RECORDS = 10_000;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 100_000;
const MAX_STRING_BYTES = 4 * 1024 * 1024;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const VALID_ROLES = new Set(['authoritative', 'shadow']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'caseId',
  'role',
  'requestId',
  'kernelId',
  'requestDigest',
  'resultDigest',
  'grade',
]);

class ShadowPlanEvidenceCorpusError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ShadowPlanEvidenceCorpusError';
    this.code = code;
  }
}

function corpusError(code) {
  return new ShadowPlanEvidenceCorpusError(code);
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

function canonicalJsonDigest(value, fieldName) {
  const hash = crypto.createHash('sha256');
  const active = new Set();
  let nodes = 0;
  let stringBytes = 0;

  function token(prefix, text = '') {
    const bytes = Buffer.from(String(text), 'utf8');
    hash.update(prefix);
    hash.update(String(bytes.length));
    hash.update(':');
    hash.update(bytes);
  }

  function visit(current, depth, currentField) {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new TypeError(fieldName + ' exceeds digest bounds');
    }
    if (current === null) {
      token('z');
      return;
    }
    if (typeof current === 'boolean') {
      token('b', current ? '1' : '0');
      return;
    }
    if (typeof current === 'string') {
      if (current.includes('\0')) throw new TypeError(currentField + ' is invalid');
      stringBytes += Buffer.byteLength(current, 'utf8');
      if (stringBytes > MAX_STRING_BYTES) {
        throw new TypeError(fieldName + ' exceeds text bounds');
      }
      token('s', current);
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) {
        throw new TypeError(currentField + ' is invalid');
      }
      token('n', String(current));
      return;
    }
    if (!current || typeof current !== 'object' || util.types.isProxy(current)
      || !Object.isFrozen(current) || active.has(current)) {
      throw new TypeError(currentField + ' must be acyclic frozen JSON data');
    }
    active.add(current);
    try {
      if (Array.isArray(current)) {
        const children = denseFrozenArray(
          current,
          currentField,
          0,
          MAX_JSON_NODES
        );
        token('[', children.length);
        children.forEach((child, index) => {
          visit(child, depth + 1, currentField + '[' + index + ']');
        });
        token(']');
        return;
      }
      const fields = dataFields(current, currentField);
      const keys = [...fields.keys()].sort();
      token('{', keys.length);
      for (const key of keys) {
        token('k', key);
        visit(fields.get(key), depth + 1, currentField + '.' + key);
      }
      token('}');
    } finally {
      active.delete(current);
    }
  }

  visit(value, 0, fieldName);
  return 'sha256:' + hash.digest('hex');
}

function assertIdentity(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(fieldName + ' must be a safe identifier');
  }
  return value;
}

function inspectRequestResult(request, result) {
  canonicalJsonDigest(request, 'Harness request');
  canonicalJsonDigest(result, 'Harness result');
  assertHarnessRequest(request);
  if (request.operation !== HARNESS_OPERATIONS.PLAN) {
    throw new TypeError('evidence corpus only supports plan requests');
  }
  assertIdentity(request.requestId, 'requestId');
  const resultFields = exactDataFields(result, [
    'schemaVersion',
    'requestId',
    'operation',
    'kernelId',
    'output',
    'diagnostics',
  ], undefined, { frozen: true });
  if (!resultFields
    || resultFields.get('schemaVersion') !== HARNESS_RESULT_SCHEMA_VERSION
    || resultFields.get('requestId') !== request.requestId
    || resultFields.get('operation') !== HARNESS_OPERATIONS.PLAN) {
    throw new TypeError('Harness result identity is invalid');
  }
  const kernelId = assertIdentity(resultFields.get('kernelId'), 'kernelId');
  return Object.freeze({
    requestId: request.requestId,
    kernelId,
    requestDigest: canonicalJsonDigest(request, 'Harness request'),
    resultDigest: canonicalJsonDigest(result, 'Harness result'),
  });
}

function createShadowPlanEvidenceCorpusRecord(options = {}) {
  const fields = exactDataFields(options, [
    'caseId',
    'role',
    'request',
    'result',
    'grade',
  ]);
  try {
    if (!fields) throw new TypeError('record options are invalid');
    const caseId = assertIdentity(fields.get('caseId'), 'caseId');
    const role = fields.get('role');
    if (!VALID_ROLES.has(role)) throw new TypeError('role is invalid');
    const inspected = inspectRequestResult(
      fields.get('request'),
      fields.get('result')
    );
    const grade = fields.get('grade');
    canonicalJsonDigest(grade, 'evidence grade');
    assertShadowPlanEvidenceGrade(grade, {
      requestId: inspected.requestId,
      kernelId: inspected.kernelId,
    });
    return Object.freeze({
      schemaVersion: SHADOW_PLAN_EVIDENCE_CORPUS_RECORD_SCHEMA_VERSION,
      caseId,
      role,
      requestId: inspected.requestId,
      kernelId: inspected.kernelId,
      requestDigest: inspected.requestDigest,
      resultDigest: inspected.resultDigest,
      grade,
    });
  } catch {
    throw corpusError(SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.INVALID_RECORD);
  }
}

function parseCorpusRecord(value) {
  try {
    const fields = exactDataFields(value, RECORD_KEYS, RECORD_KEYS, {
      frozen: true,
    });
    if (!fields
      || fields.get('schemaVersion')
        !== SHADOW_PLAN_EVIDENCE_CORPUS_RECORD_SCHEMA_VERSION
      || !VALID_ROLES.has(fields.get('role'))
      || !SHA256_DIGEST.test(fields.get('requestDigest'))
      || !SHA256_DIGEST.test(fields.get('resultDigest'))) {
      throw new TypeError('corpus record identity is invalid');
    }
    const caseId = assertIdentity(fields.get('caseId'), 'caseId');
    const requestId = assertIdentity(fields.get('requestId'), 'requestId');
    const kernelId = assertIdentity(fields.get('kernelId'), 'kernelId');
    const grade = fields.get('grade');
    canonicalJsonDigest(value, 'corpus record');
    assertShadowPlanEvidenceGrade(grade, { requestId, kernelId });
    return Object.freeze({
      record: value,
      caseId,
      role: fields.get('role'),
      requestId,
      kernelId,
      requestDigest: fields.get('requestDigest'),
      resultDigest: fields.get('resultDigest'),
      grade,
    });
  } catch (error) {
    if (error instanceof ShadowPlanEvidenceCorpusError) throw error;
    throw corpusError(SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.INVALID_RECORD);
  }
}

function recordKey(role, requestId, kernelId) {
  return role + '\n' + requestId + '\n' + kernelId;
}

function inspectGraderInput(value) {
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
      throw new TypeError('grader input identity is invalid');
    }
    canonicalJsonDigest(value, 'grader input');
    const inspected = inspectRequestResult(
      fields.get('request'),
      fields.get('result')
    );
    return Object.freeze({
      role: fields.get('role'),
      ...inspected,
    });
  } catch {
    throw corpusError(SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.INVALID_INPUT);
  }
}

function createShadowPlanEvidenceCorpusGrader(options = {}) {
  const fields = exactDataFields(options, ['corpusId', 'records']);
  if (!fields) {
    throw corpusError(SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.INVALID_OPTIONS);
  }
  let corpusId;
  let parsedRecords;
  try {
    corpusId = assertIdentity(fields.get('corpusId'), 'corpusId');
    parsedRecords = denseFrozenArray(
      fields.get('records'),
      'records',
      1,
      MAX_RECORDS
    ).map(parseCorpusRecord);
  } catch (error) {
    if (error instanceof ShadowPlanEvidenceCorpusError) throw error;
    throw corpusError(SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.INVALID_OPTIONS);
  }

  const recordsByKey = new Map();
  for (const parsed of parsedRecords) {
    const key = recordKey(parsed.role, parsed.requestId, parsed.kernelId);
    if (recordsByKey.has(key)) {
      throw corpusError(
        SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.DUPLICATE_RECORD
      );
    }
    recordsByKey.set(key, parsed);
  }
  const corpusDigest = canonicalJsonDigest(
    Object.freeze(parsedRecords.map((parsed) => parsed.record)),
    'evidence corpus'
  );
  let grades = 0;
  let rejections = 0;
  let digestMismatches = 0;
  let lastFailureCode = null;

  async function grade(input) {
    try {
      const inspected = inspectGraderInput(input);
      const record = recordsByKey.get(recordKey(
        inspected.role,
        inspected.requestId,
        inspected.kernelId
      ));
      if (!record) {
        throw corpusError(
          SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.RECORD_NOT_FOUND
        );
      }
      if (record.requestDigest !== inspected.requestDigest
        || record.resultDigest !== inspected.resultDigest) {
        throw corpusError(
          SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.DIGEST_MISMATCH
        );
      }
      grades += 1;
      lastFailureCode = null;
      return record.grade;
    } catch (error) {
      const normalized = error instanceof ShadowPlanEvidenceCorpusError
        ? error
        : corpusError(SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.INVALID_INPUT);
      rejections += 1;
      if (normalized.code
        === SHADOW_PLAN_EVIDENCE_CORPUS_REASONS.DIGEST_MISMATCH) {
        digestMismatches += 1;
      }
      lastFailureCode = normalized.code;
      throw normalized;
    }
  }

  const grader = Object.freeze({
    version: SHADOW_PLAN_EVIDENCE_CORPUS_GRADER_VERSION,
    grade,
  });

  function diagnostics() {
    return Object.freeze({
      version: SHADOW_PLAN_EVIDENCE_CORPUS_VERSION,
      graderVersion: SHADOW_PLAN_EVIDENCE_CORPUS_GRADER_VERSION,
      corpusId,
      corpusDigest,
      records: parsedRecords.length,
      grades,
      rejections,
      digestMismatches,
      lastFailureCode,
    });
  }

  return Object.freeze({
    version: SHADOW_PLAN_EVIDENCE_CORPUS_VERSION,
    corpusId,
    corpusDigest,
    grader,
    diagnostics,
  });
}

module.exports = {
  SHADOW_PLAN_EVIDENCE_CORPUS_GRADER_VERSION,
  SHADOW_PLAN_EVIDENCE_CORPUS_REASONS,
  SHADOW_PLAN_EVIDENCE_CORPUS_RECORD_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_CORPUS_VERSION,
  ShadowPlanEvidenceCorpusError,
  createShadowPlanEvidenceCorpusGrader,
  createShadowPlanEvidenceCorpusRecord,
};
