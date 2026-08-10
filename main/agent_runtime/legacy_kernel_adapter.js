'use strict';

const { AgentKernel } = require('./agent_kernel');
const {
  HARNESS_OPERATIONS,
  assertHarnessRequest,
  createHarnessResult,
} = require('./harness_contracts');

const LEGACY_KERNEL_ID = 'legacy';
const LEGACY_KERNEL_VERSION = 'legacy-kernel.v1';

function requireCallback(name, callback) {
  if (typeof callback !== 'function') {
    throw new Error(`Legacy kernel dependency missing: ${name}`);
  }
}

function assertRequestOperation(request, expectedOperation) {
  assertHarnessRequest(request);
  if (request.operation !== expectedOperation) {
    throw new Error(
      `Legacy kernel request operation mismatch: expected ${expectedOperation}, received ${request.operation}`
    );
  }
}

class LegacyKernelAdapter extends AgentKernel {
  constructor({ plan, message, execute } = {}) {
    requireCallback('plan', plan);
    requireCallback('message', message);
    requireCallback('execute', execute);

    super({
      id: LEGACY_KERNEL_ID,
      version: LEGACY_KERNEL_VERSION,
      capabilities: [
        HARNESS_OPERATIONS.PLAN,
        HARNESS_OPERATIONS.MESSAGE,
        HARNESS_OPERATIONS.EXECUTE,
      ],
    });

    this.legacyPlan = plan;
    this.legacyMessage = message;
    this.legacyExecute = execute;
  }

  async plan(request) {
    assertRequestOperation(request, HARNESS_OPERATIONS.PLAN);
    const output = await this.legacyPlan(request.payload);
    return createHarnessResult({
      requestId: request.requestId,
      operation: request.operation,
      kernelId: this.id,
      output,
      diagnostics: this.getDiagnostics(),
    });
  }

  async message(request) {
    assertRequestOperation(request, HARNESS_OPERATIONS.MESSAGE);
    const output = await this.legacyMessage(request.payload);
    return createHarnessResult({
      requestId: request.requestId,
      operation: request.operation,
      kernelId: this.id,
      output,
      diagnostics: this.getDiagnostics(),
    });
  }

  async execute(request) {
    assertRequestOperation(request, HARNESS_OPERATIONS.EXECUTE);
    const output = await this.legacyExecute(request.action, request.projectInfo);
    return createHarnessResult({
      requestId: request.requestId,
      operation: request.operation,
      kernelId: this.id,
      output,
      diagnostics: this.getDiagnostics(),
    });
  }
}

function createLegacyKernelAdapter(dependencies = {}) {
  return new LegacyKernelAdapter(dependencies);
}

module.exports = {
  LEGACY_KERNEL_ID,
  LEGACY_KERNEL_VERSION,
  LegacyKernelAdapter,
  createLegacyKernelAdapter,
};
