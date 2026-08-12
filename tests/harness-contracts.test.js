'use strict';

const assert = require('assert');

const {
  HARNESS_CONTRACT_VERSION,
  HARNESS_OPERATIONS,
  HARNESS_REQUEST_SCHEMA_VERSION,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
  createExecuteRequest,
  createHarnessResult,
  createMessageRequest,
  createPlanRequest,
  isHarnessRequest,
} = require('../main/agent_runtime/harness_contracts');

assert.strictEqual(HARNESS_CONTRACT_VERSION, 'harness.v1');
assert.deepStrictEqual(HARNESS_OPERATIONS, {
  PLAN: 'plan',
  MESSAGE: 'message',
  EXECUTE: 'execute',
});

const planPayload = { projectInfo: { id: 'project-1' }, userMessage: 'planeje' };
const planRequest = createPlanRequest(planPayload, { requestId: 'request-plan-1' });
assert.deepStrictEqual(planRequest, {
  schemaVersion: HARNESS_REQUEST_SCHEMA_VERSION,
  requestId: 'request-plan-1',
  operation: 'plan',
  payload: planPayload,
});
assert.strictEqual(planRequest.payload, planPayload, 'plan payload reference must be preserved');
assert.strictEqual(Object.isFrozen(planRequest), true);
assert.strictEqual(isHarnessRequest(planRequest), true);
assert.strictEqual(assertHarnessRequest(planRequest), planRequest);

const messagePayload = { userMessage: 'continue', attachments: [] };
const messageRequest = createMessageRequest(messagePayload, { requestId: 'request-message-1' });
assert.strictEqual(messageRequest.operation, 'message');
assert.strictEqual(messageRequest.payload, messagePayload, 'message payload reference must be preserved');
assert.strictEqual(isHarnessRequest(messageRequest), true);

const action = { type: 'agentic_tool_loop', jobId: 'job-1' };
const projectInfo = { id: 'project-1', rootPath: '/tmp/project' };
const executeRequest = createExecuteRequest(action, projectInfo, { requestId: 'request-execute-1' });
assert.deepStrictEqual(executeRequest, {
  schemaVersion: HARNESS_REQUEST_SCHEMA_VERSION,
  requestId: 'request-execute-1',
  operation: 'execute',
  action,
  projectInfo,
});
assert.strictEqual(executeRequest.action, action, 'execute action reference must be preserved');
assert.strictEqual(executeRequest.projectInfo, projectInfo, 'execute project reference must be preserved');
assert.strictEqual(Object.hasOwn(executeRequest, 'executionContext'), false);
assert.strictEqual(isHarnessRequest(executeRequest), true);

const abortController = new AbortController();
const executionContext = {
  jobId: 'job-1',
  signal: abortController.signal,
};
const contextualExecuteRequest = createExecuteRequest(action, projectInfo, {
  requestId: 'request-execute-context-1',
  executionContext,
});
assert.deepStrictEqual(contextualExecuteRequest, {
  schemaVersion: HARNESS_REQUEST_SCHEMA_VERSION,
  requestId: 'request-execute-context-1',
  operation: 'execute',
  action,
  projectInfo,
  executionContext,
});
assert.strictEqual(contextualExecuteRequest.executionContext, executionContext);
assert.strictEqual(contextualExecuteRequest.executionContext.signal, abortController.signal);
assert.strictEqual(Object.isFrozen(executionContext), false, 'execution context must not be cloned or frozen');
assert.strictEqual(isHarnessRequest(contextualExecuteRequest), true);

const explicitUndefinedContextRequest = createExecuteRequest(action, projectInfo, {
  requestId: 'request-execute-undefined-context',
  executionContext: undefined,
});
assert.strictEqual(Object.hasOwn(explicitUndefinedContextRequest, 'executionContext'), true);
assert.strictEqual(explicitUndefinedContextRequest.executionContext, undefined);
assert.strictEqual(isHarnessRequest(explicitUndefinedContextRequest), true);

const legacyOutput = { ok: true, response: 'feito', action };
const diagnostics = { elapsedMs: 4 };
const result = createHarnessResult({
  requestId: executeRequest.requestId,
  operation: executeRequest.operation,
  kernelId: 'legacy',
  output: legacyOutput,
  diagnostics,
});
assert.deepStrictEqual(result, {
  schemaVersion: HARNESS_RESULT_SCHEMA_VERSION,
  requestId: 'request-execute-1',
  operation: 'execute',
  kernelId: 'legacy',
  output: legacyOutput,
  diagnostics,
});
assert.strictEqual(result.output, legacyOutput, 'kernel output reference must be preserved');
assert.strictEqual(result.diagnostics, diagnostics, 'diagnostics reference must be preserved');
assert.strictEqual(Object.hasOwn(result, 'executionContext'), false);
assert.strictEqual(Object.isFrozen(result), true);

assert.throws(() => createPlanRequest({}, {}), /requestId/);
assert.throws(() => createMessageRequest({}, { requestId: ' ' }), /requestId/);
assert.throws(() => createHarnessResult({
  requestId: 'request-1',
  operation: 'unknown',
  kernelId: 'legacy',
  output: {},
}), /Unsupported harness operation/);
assert.throws(() => createHarnessResult({
  requestId: 'request-1',
  operation: 'plan',
  kernelId: '',
  output: {},
}), /kernelId/);
assert.strictEqual(isHarnessRequest(null), false);
assert.strictEqual(isHarnessRequest({ ...planRequest, schemaVersion: 'future.v2' }), false);
assert.strictEqual(isHarnessRequest({ ...executeRequest, projectInfo: undefined }), true);
const inheritedContextRequest = Object.assign(
  Object.create({ executionContext }),
  executeRequest
);
assert.strictEqual(isHarnessRequest(inheritedContextRequest), false);
assert.strictEqual(isHarnessRequest({
  schemaVersion: HARNESS_REQUEST_SCHEMA_VERSION,
  requestId: 'request-1',
  operation: 'execute',
  action,
}), false);
assert.throws(() => assertHarnessRequest({}), /Invalid harness request/);

console.log('harness contracts tests passed');
