'use strict';

const assert = require('assert');

const {
  AGENT_KERNEL_CONTRACT_VERSION,
  AGENT_KERNEL_METHODS,
  AgentKernel,
  assertAgentKernel,
} = require('../main/agent_runtime/agent_kernel');

async function run() {
  assert.strictEqual(AGENT_KERNEL_CONTRACT_VERSION, 'agent-kernel.v1');
  assert.deepStrictEqual(AGENT_KERNEL_METHODS, ['plan', 'message', 'execute']);

  const baseKernel = new AgentKernel({
    id: 'base',
    version: '1.0.0',
    capabilities: ['plan'],
  });
  assert.strictEqual(assertAgentKernel(baseKernel), baseKernel);
  assert.deepStrictEqual(baseKernel.getDiagnostics(), {
    contractVersion: AGENT_KERNEL_CONTRACT_VERSION,
    id: 'base',
    version: '1.0.0',
    capabilities: ['plan'],
  });
  assert.strictEqual(Object.isFrozen(baseKernel.capabilities), true);

  for (const operation of AGENT_KERNEL_METHODS) {
    await assert.rejects(
      baseKernel[operation]({ requestId: 'request-1' }),
      (error) => error
        && error.code === 'AGENT_KERNEL_OPERATION_NOT_IMPLEMENTED'
        && error.kernelId === 'base'
        && error.operation === operation
    );
  }

  class TestKernel extends AgentKernel {
    async plan(request) {
      return request;
    }

    async message(request) {
      return request;
    }

    async execute(request) {
      return request;
    }
  }

  const testKernel = new TestKernel({ id: 'test' });
  const request = { requestId: 'request-2' };
  assert.strictEqual(await testKernel.plan(request), request);
  assert.strictEqual(await testKernel.message(request), request);
  assert.strictEqual(await testKernel.execute(request), request);

  const plainKernel = {
    id: 'plain',
    plan: async () => null,
    message: async () => null,
    execute: async () => null,
  };
  assert.strictEqual(assertAgentKernel(plainKernel), plainKernel);

  assert.throws(() => new AgentKernel(), /id/);
  assert.throws(() => new AgentKernel({ id: 'broken', capabilities: {} }), /capabilities/);
  assert.throws(() => assertAgentKernel(null), /object/);
  assert.throws(() => assertAgentKernel({ id: 'broken' }), /plan/);
  assert.throws(() => assertAgentKernel({ ...plainKernel, message: null }), /message/);

  console.log('agent kernel tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
