'use strict';

const HARNESS_CONTRACT_VERSION = 'harness.v1';
const HARNESS_REQUEST_SCHEMA_VERSION = 'harness.request.v1';
const HARNESS_RESULT_SCHEMA_VERSION = 'harness.result.v1';

const HARNESS_OPERATIONS = Object.freeze({
  PLAN: 'plan',
  MESSAGE: 'message',
  EXECUTE: 'execute',
});

const SUPPORTED_OPERATIONS = new Set(Object.values(HARNESS_OPERATIONS));

function assertOperation(operation) {
  if (!SUPPORTED_OPERATIONS.has(operation)) {
    throw new TypeError(`Unsupported harness operation: ${String(operation)}`);
  }
}

function assertRequestId(requestId) {
  if (typeof requestId !== 'string' || !requestId.trim()) {
    throw new TypeError('Harness requestId must be a non-empty string');
  }
}

function createHarnessRequest(operation, fields, { requestId } = {}) {
  assertOperation(operation);
  assertRequestId(requestId);

  return Object.freeze({
    ...fields,
    schemaVersion: HARNESS_REQUEST_SCHEMA_VERSION,
    requestId,
    operation,
  });
}

function createPlanRequest(payload, options) {
  return createHarnessRequest(HARNESS_OPERATIONS.PLAN, { payload }, options);
}

function createMessageRequest(payload, options) {
  return createHarnessRequest(HARNESS_OPERATIONS.MESSAGE, { payload }, options);
}

function createExecuteRequest(action, projectInfo, options) {
  return createHarnessRequest(
    HARNESS_OPERATIONS.EXECUTE,
    { action, projectInfo },
    options
  );
}

function createHarnessResult({
  requestId,
  operation,
  kernelId,
  output,
  diagnostics = null,
} = {}) {
  assertRequestId(requestId);
  assertOperation(operation);
  if (typeof kernelId !== 'string' || !kernelId.trim()) {
    throw new TypeError('Harness kernelId must be a non-empty string');
  }

  return Object.freeze({
    schemaVersion: HARNESS_RESULT_SCHEMA_VERSION,
    requestId,
    operation,
    kernelId,
    output,
    diagnostics,
  });
}

function isHarnessRequest(request) {
  if (!request || typeof request !== 'object') return false;
  if (request.schemaVersion !== HARNESS_REQUEST_SCHEMA_VERSION) return false;
  if (typeof request.requestId !== 'string' || !request.requestId.trim()) return false;
  if (!SUPPORTED_OPERATIONS.has(request.operation)) return false;

  if (request.operation === HARNESS_OPERATIONS.EXECUTE) {
    return Object.prototype.hasOwnProperty.call(request, 'action')
      && Object.prototype.hasOwnProperty.call(request, 'projectInfo');
  }

  return Object.prototype.hasOwnProperty.call(request, 'payload');
}

function assertHarnessRequest(request) {
  if (!isHarnessRequest(request)) {
    throw new TypeError('Invalid harness request');
  }
  return request;
}

module.exports = {
  HARNESS_CONTRACT_VERSION,
  HARNESS_OPERATIONS,
  HARNESS_REQUEST_SCHEMA_VERSION,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
  createExecuteRequest,
  createHarnessRequest,
  createHarnessResult,
  createMessageRequest,
  createPlanRequest,
  isHarnessRequest,
};
