'use strict';

const assert = require('assert');

const {
  ASSISTANT_RUNTIME_FACADE_REASONS,
  createAssistantRuntimeFacade,
} = require('../main/agent_runtime/assistant_runtime_facade');

async function run() {
  const calls = [];
  const coordinator = {
    async coordinatePlanning(input) {
      calls.push(['coordinate', input]);
      return input.invoke(input.payload);
    },
    async execute(input) {
      calls.push(['execute', input]);
      return { ok: true, jobId: input.jobId };
    },
    async retry(input) {
      calls.push(['retry', input]);
      const output = await input.invoke({
        projectInfo: { id: 'project-1', rootPath: '/project' },
        userMessage: 'persisted request',
        attachments: [],
        jobId: input.jobId,
      });
      return { ...output, jobId: input.jobId };
    },
  };
  const harnessRouter = {
    getStatus: () => ({ ok: true, activeKernelId: 'legacy-kernel' }),
    message: async (payload) => {
      calls.push(['message', payload]);
      return { ok: true, channel: 'message', payload };
    },
    plan: async (payload) => {
      calls.push(['plan', payload]);
      return { ok: true, channel: 'plan', payload };
    },
    execute: async () => {
      throw new Error('the public facade must never expose the low-level execute path');
    },
  };
  const authorizePlanningPayload = ({ operation, payload }) => {
    calls.push(['authorize', operation, payload]);
    if (!payload.projectInfo || payload.projectInfo.rootPath !== '/project') {
      return { ok: false, message: 'Projeto não autorizado.' };
    }
    if (Object.hasOwn(payload, 'requestedMode')) {
      return { ok: false, message: 'requestedMode não pertence ao contrato público.' };
    }
    const approvalMode = Object.hasOwn(payload, 'approvalMode')
      ? payload.approvalMode
      : 'ask_each';
    if (operation !== 'map_message' && !['ask_each', 'delegate_task'].includes(approvalMode)) {
      return { ok: false, message: 'approvalMode inválido.' };
    }
    const authorizedPayload = {
      ...payload,
      projectInfo: {
        ...payload.projectInfo,
        id: 'project-1',
        projectId: 'project-1',
      },
    };
    if (operation === 'map_message') delete authorizedPayload.approvalMode;
    else authorizedPayload.approvalMode = approvalMode;
    return {
      ok: true,
      payload: authorizedPayload,
    };
  };

  const facade = createAssistantRuntimeFacade({
    authorizePlanningPayload,
    coordinator,
    harnessRouter,
    kernelId: 'legacy-kernel',
  });

  const plan = await facade.plan({
    projectInfo: { rootPath: '/project' },
    userMessage: 'build',
    attachments: [],
  });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.channel, 'plan');
  assert.strictEqual(plan.payload.projectInfo.id, 'project-1');
  assert.strictEqual(plan.payload.approvalMode, 'ask_each');
  assert.strictEqual(calls[0][0], 'authorize');
  assert.strictEqual(calls[1][0], 'coordinate');
  assert.strictEqual(calls[1][1].payload.approvalMode, 'ask_each');
  assert.strictEqual(calls[2][0], 'plan');

  calls.length = 0;
  const message = await facade.message({
    projectInfo: { rootPath: '/project' },
    userMessage: 'hello',
  });
  assert.strictEqual(message.channel, 'message');
  assert.strictEqual(calls[1][1].operation, 'message');

  calls.length = 0;
  const map = await facade.message({
    projectInfo: { rootPath: '/project' },
    userMessage: 'map',
    isMapChat: true,
    approvalMode: 'delegate_task',
  });
  assert.strictEqual(map.channel, 'message');
  assert.strictEqual(calls[1][1].operation, 'map_message');
  assert.strictEqual(Object.hasOwn(calls[1][1].payload, 'approvalMode'), false);

  calls.length = 0;
  const execution = await facade.execute({ jobId: 'job-1' });
  assert.deepStrictEqual(execution, { ok: true, jobId: 'job-1' });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'execute');

  calls.length = 0;
  const retry = await facade.retry({ jobId: 'job-1' });
  assert.strictEqual(retry.ok, true);
  assert.strictEqual(retry.channel, 'plan');
  assert.strictEqual(retry.payload.userMessage, 'persisted request');
  assert.strictEqual(Object.hasOwn(retry.payload, 'approvalMode'), false);
  assert.strictEqual(Object.hasOwn(retry.payload, 'requestedMode'), false);
  assert.strictEqual(calls[0][0], 'retry');
  assert.strictEqual(calls[1][0], 'plan');

  assert.strictEqual(
    (await facade.plan({
      projectInfo: { rootPath: '/project' },
      userMessage: 'forged retry',
      jobId: 'job-1',
    })).code,
    ASSISTANT_RUNTIME_FACADE_REASONS.RETRY_REQUIRES_RETRY_API,
  );
  assert.strictEqual(
    (await facade.retry({ jobId: 'job-1', phase: 'execute_pending' })).code,
    ASSISTANT_RUNTIME_FACADE_REASONS.INVALID_INPUT,
  );
  assert.strictEqual(
    (await facade.plan({
      projectInfo: { rootPath: '/project' },
      userMessage: 'legacy mode',
      requestedMode: 'delegate_task',
    })).code,
    ASSISTANT_RUNTIME_FACADE_REASONS.PROJECT_NOT_AUTHORIZED,
  );
  assert.strictEqual(
    (await facade.plan({
      projectInfo: { rootPath: '/project' },
      userMessage: 'invalid mode',
      approvalMode: 'always',
    })).code,
    ASSISTANT_RUNTIME_FACADE_REASONS.PROJECT_NOT_AUTHORIZED,
  );
  assert.strictEqual(
    (await facade.plan({ projectInfo: { rootPath: '/outside' }, userMessage: 'bad' })).code,
    ASSISTANT_RUNTIME_FACADE_REASONS.PROJECT_NOT_AUTHORIZED,
  );
  assert.strictEqual(
    (await facade.message(Object.defineProperty({}, 'userMessage', { get() { return 'hostile'; }, enumerable: true }))).code,
    ASSISTANT_RUNTIME_FACADE_REASONS.INVALID_INPUT,
  );
  assert.deepStrictEqual(facade.getStatus(), { ok: true, activeKernelId: 'legacy-kernel' });
  assert.strictEqual(Object.hasOwn(facade, 'route'), false);

  assert.throws(() => createAssistantRuntimeFacade({
    authorizePlanningPayload,
    coordinator: { ...coordinator, retry: null },
    harnessRouter,
    kernelId: 'legacy-kernel',
  }), /coordinator\.retry is required/);

  console.log('assistant-runtime-facade.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
