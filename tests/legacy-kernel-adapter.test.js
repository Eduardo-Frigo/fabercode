'use strict';

const assert = require('assert');

const { assertAgentKernel } = require('../main/agent_runtime/agent_kernel');
const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  createExecuteRequest,
  createMessageRequest,
  createPlanRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  LEGACY_KERNEL_ID,
  LEGACY_KERNEL_VERSION,
  LegacyKernelAdapter,
  createLegacyKernelAdapter,
} = require('../main/agent_runtime/legacy_kernel_adapter');

async function run() {
  assert.throws(
    () => createLegacyKernelAdapter(),
    /plan/
  );
  assert.throws(
    () => createLegacyKernelAdapter({ plan: () => {} }),
    /message/
  );
  assert.throws(
    () => createLegacyKernelAdapter({ plan: () => {}, message: () => {} }),
    /execute/
  );

  const calls = [];
  const planOutput = { ok: true, action: { type: 'plan' } };
  const messageOutput = { ok: true, response: 'mensagem legada' };
  const executeOutput = { ok: true, modifiedFiles: ['src/app.js'] };
  const executeArgumentCounts = [];
  const adapter = createLegacyKernelAdapter({
    plan: async (payload) => {
      calls.push(['plan', payload]);
      return planOutput;
    },
    message: async (payload) => {
      calls.push(['message', payload]);
      return messageOutput;
    },
    execute: async function execute(action, projectInfo, executionContext) {
      executeArgumentCounts.push(arguments.length);
      calls.push(['execute', action, projectInfo, executionContext]);
      return executeOutput;
    },
  });

  assert.ok(adapter instanceof LegacyKernelAdapter);
  assert.strictEqual(assertAgentKernel(adapter), adapter);
  assert.strictEqual(adapter.id, LEGACY_KERNEL_ID);
  assert.strictEqual(adapter.version, LEGACY_KERNEL_VERSION);
  assert.deepStrictEqual(adapter.capabilities, ['plan', 'message', 'execute']);

  const planPayload = {
    projectInfo: { rootPath: '/tmp/project' },
    userMessage: 'Monte um plano',
  };
  const messagePayload = {
    projectInfo: { rootPath: '/tmp/project' },
    isMapChat: true,
  };
  const action = { type: 'operation_batch', operations: [] };
  const projectInfo = { rootPath: '/tmp/project' };
  const abortController = new AbortController();
  const executionContext = {
    jobId: 'job-1',
    signal: abortController.signal,
  };
  const planRequest = createPlanRequest(planPayload, { requestId: 'request-plan' });
  const messageRequest = createMessageRequest(messagePayload, { requestId: 'request-message' });
  const executeRequest = createExecuteRequest(action, projectInfo, {
    requestId: 'request-execute',
    executionContext,
  });
  const legacyExecuteRequest = createExecuteRequest(action, projectInfo, {
    requestId: 'request-execute-legacy',
  });

  const planResult = await adapter.plan(planRequest);
  const messageResult = await adapter.message(messageRequest);
  const executeResult = await adapter.execute(executeRequest);
  const legacyExecuteResult = await adapter.execute(legacyExecuteRequest);

  for (const [result, request, output] of [
    [planResult, planRequest, planOutput],
    [messageResult, messageRequest, messageOutput],
    [executeResult, executeRequest, executeOutput],
  ]) {
    assert.strictEqual(result.schemaVersion, HARNESS_RESULT_SCHEMA_VERSION);
    assert.strictEqual(result.requestId, request.requestId);
    assert.strictEqual(result.operation, request.operation);
    assert.strictEqual(result.kernelId, LEGACY_KERNEL_ID);
    assert.strictEqual(result.output, output);
    assert.strictEqual(Object.isFrozen(result), true);
    assert.strictEqual(result.diagnostics.id, LEGACY_KERNEL_ID);
  }

  assert.deepStrictEqual(calls, [
    ['plan', planPayload],
    ['message', messagePayload],
    ['execute', action, projectInfo, executionContext],
    ['execute', action, projectInfo, undefined],
  ]);
  assert.strictEqual(calls[0][1], planPayload);
  assert.strictEqual(calls[1][1], messagePayload);
  assert.strictEqual(calls[2][1], action);
  assert.strictEqual(calls[2][2], projectInfo);
  assert.strictEqual(calls[2][3], executionContext);
  assert.strictEqual(calls[2][3].signal, abortController.signal);
  assert.strictEqual(calls[3][3], undefined);
  assert.deepStrictEqual(executeArgumentCounts, [3, 3]);
  assert.strictEqual(Object.hasOwn(legacyExecuteRequest, 'executionContext'), false);
  assert.strictEqual(Object.hasOwn(executeResult, 'executionContext'), false);
  assert.strictEqual(legacyExecuteResult.requestId, legacyExecuteRequest.requestId);
  assert.strictEqual(legacyExecuteResult.output, executeOutput);

  await assert.rejects(
    adapter.plan(messageRequest),
    /operation mismatch/
  );
  await assert.rejects(
    adapter.execute(planRequest),
    /operation mismatch/
  );

  const rejection = new Error('legacy provider unavailable');
  const rejectingAdapter = createLegacyKernelAdapter({
    plan: async () => { throw rejection; },
    message: async () => { throw rejection; },
    execute: async () => { throw rejection; },
  });
  for (const [method, request] of [
    ['plan', planRequest],
    ['message', messageRequest],
    ['execute', executeRequest],
  ]) {
    await assert.rejects(
      rejectingAdapter[method](request),
      (error) => error === rejection
    );
  }

  const undefinedAdapter = createLegacyKernelAdapter({
    plan: () => undefined,
    message: () => undefined,
    execute: () => undefined,
  });
  const undefinedResult = await undefinedAdapter.plan(planRequest);
  assert.strictEqual(Object.hasOwn(undefinedResult, 'output'), true);
  assert.strictEqual(undefinedResult.output, undefined);

  await assert.rejects(
    adapter.plan({ operation: HARNESS_OPERATIONS.PLAN }),
    /Invalid harness request/
  );

  console.log('legacy-kernel-adapter.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
