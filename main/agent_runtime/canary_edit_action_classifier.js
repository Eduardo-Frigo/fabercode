'use strict';

const util = require('util');

const CANARY_EDIT_ACTION_CLASSIFIER_VERSION = 'canary-edit-action-classifier.v1';
const CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION =
  'canary-edit-action-classification.v1';

const CANARY_EDIT_ACTION_CLASSIFIER_REASONS = Object.freeze({
  ELIGIBLE: 'eligible_local_edit',
  INVALID_ACTION: 'invalid_action',
  UNSUPPORTED_ACTION: 'unsupported_action',
  UNSUPPORTED_OPERATION: 'unsupported_operation',
  UNSAFE_PATH: 'unsafe_path',
  CONTENT_INVALID: 'content_invalid',
  LIMIT_EXCEEDED: 'limit_exceeded',
  EXTERNAL_EFFECT_REQUESTED: 'external_effect_requested',
});

const MAX_OPERATIONS = 32;
const MAX_TOTAL_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_PATH_BYTES = 4096;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EXTERNAL_EFFECT_FLAGS = Object.freeze([
  'installRequested',
  'networkRequested',
  'requiresInstall',
  'requiresNetwork',
]);
const LOCAL_EFFECTS = new Set(['filesystem_read', 'filesystem_write']);
const PATCH_HASH = /^(?:sha256:)?[a-f0-9]{64}$/i;
const SAFE_ACTION_TYPE = /^[a-z][a-z0-9_]{0,79}$/;
const PROTECTED_PATH = /(?:^|\/)(?:\.git|\.faber|node_modules|\.env(?:\..*)?)(?:\/|$)/i;

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

function dataFields(value, allowedKeys = null) {
  if (!isPlainRecord(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.some((key) => typeof key !== 'string'
    || FORBIDDEN_KEYS.has(key)
    || allowedKeys && !allowedKeys.includes(key))) return null;
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

function denseDataArray(value) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  } catch {
    return null;
  }
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) return null;
  const values = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) return null;
    values.push(descriptor.value);
  }
  return values;
}

function normalizedActionType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return SAFE_ACTION_TYPE.test(normalized) ? normalized : null;
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) return false;
  const portable = value.replace(/\\/g, '/');
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable)
    || portable.startsWith('//')) return false;
  const components = portable.split('/');
  if (components.some((component) => !component
    || component === '.' || component === '..')) return false;
  return !PROTECTED_PATH.test(portable);
}

function inspectExternalEffects(fields) {
  for (const flag of EXTERNAL_EFFECT_FLAGS) {
    if (!fields.has(flag)) continue;
    const value = fields.get(flag);
    if (typeof value !== 'boolean') return 'invalid';
    if (value) return 'external';
  }
  if (fields.has('effects')) {
    const effects = denseDataArray(fields.get('effects'));
    if (!effects || effects.some((effect) => typeof effect !== 'string')) return 'invalid';
    if (effects.some((effect) => !LOCAL_EFFECTS.has(effect))) return 'external';
  }
  if (fields.has('commands')) {
    const commands = denseDataArray(fields.get('commands'));
    if (!commands) return 'invalid';
    if (commands.length > 0) return 'external';
  }
  return 'local';
}

function summary(actionType, operationCount, writeCount, directoryCount, totalContentBytes) {
  return Object.freeze({
    actionType,
    operationCount,
    writeCount,
    directoryCount,
    totalContentBytes,
  });
}

function emptySummary(actionType = null) {
  return summary(actionType, 0, 0, 0, 0);
}

function classification(eligible, reason, actionSummary, editProfile = null) {
  return Object.freeze({
    schemaVersion: CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION,
    classifierVersion: CANARY_EDIT_ACTION_CLASSIFIER_VERSION,
    eligible,
    reason,
    editProfile,
    summary: actionSummary,
  });
}

function denied(reason, actionType = null) {
  return classification(false, reason, emptySummary(actionType));
}

function eligible(actionSummary) {
  return classification(
    true,
    CANARY_EDIT_ACTION_CLASSIFIER_REASONS.ELIGIBLE,
    actionSummary,
    Object.freeze({
      kind: 'local_edit',
      installRequested: false,
      networkRequested: false,
    })
  );
}

function contentBytes(value) {
  if (typeof value !== 'string' || value.includes('\0')) return null;
  return Buffer.byteLength(value, 'utf8');
}

function classifyPatch(fields, names = {}) {
  const actionType = 'apply_file_patch';
  const targetFile = fields.get(names.targetFile || 'targetFile');
  const previousContentHash = fields.get(
    names.previousContentHash || 'previousContentHash'
  );
  const nextContent = fields.get(names.nextContent || 'nextContent');
  if (!isSafeRelativePath(targetFile)) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.UNSAFE_PATH, actionType);
  }
  if (typeof previousContentHash !== 'string' || !PATCH_HASH.test(previousContentHash)) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.CONTENT_INVALID, actionType);
  }
  const totalContentBytes = contentBytes(nextContent);
  if (totalContentBytes === null) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.CONTENT_INVALID, actionType);
  }
  if (totalContentBytes > MAX_TOTAL_CONTENT_BYTES) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.LIMIT_EXCEEDED, actionType);
  }
  return eligible(summary(actionType, 1, 1, 0, totalContentBytes));
}

function classifyFuzzyEdit(fields) {
  const actionType = 'edit_file_fuzzy';
  if (!isSafeRelativePath(fields.get('targetFile'))) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.UNSAFE_PATH, actionType);
  }
  const targetBytes = contentBytes(fields.get('targetContent'));
  const replacementBytes = contentBytes(fields.get('replacementContent'));
  if (targetBytes === null || targetBytes === 0 || replacementBytes === null) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.CONTENT_INVALID, actionType);
  }
  const totalContentBytes = targetBytes + replacementBytes;
  if (totalContentBytes > MAX_TOTAL_CONTENT_BYTES) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.LIMIT_EXCEEDED, actionType);
  }
  return eligible(summary(actionType, 1, 1, 0, totalContentBytes));
}

function classifyOperationBatch(operationsValue) {
  const actionType = 'operation_batch';
  const operations = denseDataArray(operationsValue);
  if (!operations) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.INVALID_ACTION, actionType);
  }
  if (operations.length === 0) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.UNSUPPORTED_OPERATION, actionType);
  }
  if (operations.length > MAX_OPERATIONS) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.LIMIT_EXCEEDED, actionType);
  }

  let writeCount = 0;
  let directoryCount = 0;
  let totalContentBytes = 0;
  for (const operation of operations) {
    const operationFields = dataFields(operation, ['op', 'path', 'content']);
    if (!operationFields || !operationFields.has('op') || !operationFields.has('path')) {
      return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.INVALID_ACTION, actionType);
    }
    const operationType = normalizedActionType(operationFields.get('op'));
    if (!['mkdir', 'write_file', 'append_file'].includes(operationType)) {
      return denied(
        CANARY_EDIT_ACTION_CLASSIFIER_REASONS.UNSUPPORTED_OPERATION,
        actionType
      );
    }
    if (!isSafeRelativePath(operationFields.get('path'))) {
      return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.UNSAFE_PATH, actionType);
    }
    if (operationType === 'mkdir') {
      if (operationFields.has('content')) {
        return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.INVALID_ACTION, actionType);
      }
      directoryCount += 1;
      continue;
    }
    if (!operationFields.has('content')) {
      return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.CONTENT_INVALID, actionType);
    }
    const operationContentBytes = contentBytes(operationFields.get('content'));
    if (operationContentBytes === null) {
      return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.CONTENT_INVALID, actionType);
    }
    writeCount += 1;
    totalContentBytes += operationContentBytes;
    if (totalContentBytes > MAX_TOTAL_CONTENT_BYTES) {
      return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.LIMIT_EXCEEDED, actionType);
    }
  }
  return eligible(summary(
    actionType,
    operations.length,
    writeCount,
    directoryCount,
    totalContentBytes
  ));
}

function classifyExecutionCommand(value) {
  const fields = dataFields(value, [
    'protocol',
    'task_type',
    'root_path',
    'target_file',
    'previous_content_hash',
    'next_content',
    'operations',
  ]);
  if (!fields || !fields.has('task_type')) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.INVALID_ACTION);
  }
  const taskType = normalizedActionType(fields.get('task_type'));
  if (taskType === 'apply_file_patch') {
    return classifyPatch(fields, {
      targetFile: 'target_file',
      previousContentHash: 'previous_content_hash',
      nextContent: 'next_content',
    });
  }
  if (taskType === 'execute_operation_batch') {
    return classifyOperationBatch(fields.get('operations'));
  }
  return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.UNSUPPORTED_ACTION, taskType);
}

function classifyCanaryEditAction(action = {}) {
  const fields = dataFields(action);
  if (!fields) return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.INVALID_ACTION);
  const externalEffects = inspectExternalEffects(fields);
  if (externalEffects === 'invalid') {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.INVALID_ACTION);
  }
  if (externalEffects === 'external') {
    return denied(
      CANARY_EDIT_ACTION_CLASSIFIER_REASONS.EXTERNAL_EFFECT_REQUESTED
    );
  }
  if (fields.has('executionCommand')) {
    return classifyExecutionCommand(fields.get('executionCommand'));
  }
  if (!fields.has('type')) {
    return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.INVALID_ACTION);
  }
  const actionType = normalizedActionType(fields.get('type'));
  if (!actionType) return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.INVALID_ACTION);
  if (actionType === 'apply_file_patch') return classifyPatch(fields);
  if (actionType === 'edit_file_fuzzy') return classifyFuzzyEdit(fields);
  if (actionType === 'operation_batch' || actionType === 'execute_operation_batch') {
    return classifyOperationBatch(fields.get('operations'));
  }
  return denied(CANARY_EDIT_ACTION_CLASSIFIER_REASONS.UNSUPPORTED_ACTION, actionType);
}

module.exports = {
  CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION,
  CANARY_EDIT_ACTION_CLASSIFIER_REASONS,
  CANARY_EDIT_ACTION_CLASSIFIER_VERSION,
  classifyCanaryEditAction,
};
