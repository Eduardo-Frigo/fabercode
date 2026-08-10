'use strict';

const AGENT_KERNEL_CONTRACT_VERSION = 'agent-kernel.v1';
const AGENT_KERNEL_METHODS = Object.freeze(['plan', 'message', 'execute']);

class AgentKernel {
  constructor({ id, version = 'unknown', capabilities = [] } = {}) {
    if (typeof id !== 'string' || !id.trim()) {
      throw new TypeError('Agent kernel id must be a non-empty string');
    }
    if (!Array.isArray(capabilities)) {
      throw new TypeError('Agent kernel capabilities must be an array');
    }

    this.id = id;
    this.version = String(version || 'unknown');
    this.capabilities = Object.freeze([...capabilities]);
  }

  async plan() {
    throw this.createUnsupportedOperationError('plan');
  }

  async message() {
    throw this.createUnsupportedOperationError('message');
  }

  async execute() {
    throw this.createUnsupportedOperationError('execute');
  }

  createUnsupportedOperationError(operation) {
    const error = new Error(`Agent kernel "${this.id}" does not implement ${operation}`);
    error.code = 'AGENT_KERNEL_OPERATION_NOT_IMPLEMENTED';
    error.kernelId = this.id;
    error.operation = operation;
    return error;
  }

  getDiagnostics() {
    return {
      contractVersion: AGENT_KERNEL_CONTRACT_VERSION,
      id: this.id,
      version: this.version,
      capabilities: [...this.capabilities],
    };
  }
}

function assertAgentKernel(kernel) {
  if (!kernel || typeof kernel !== 'object') {
    throw new TypeError('Agent kernel must be an object');
  }
  if (typeof kernel.id !== 'string' || !kernel.id.trim()) {
    throw new TypeError('Agent kernel id must be a non-empty string');
  }
  for (const methodName of AGENT_KERNEL_METHODS) {
    if (typeof kernel[methodName] !== 'function') {
      throw new TypeError(`Agent kernel "${kernel.id}" must implement ${methodName}()`);
    }
  }
  return kernel;
}

module.exports = {
  AGENT_KERNEL_CONTRACT_VERSION,
  AGENT_KERNEL_METHODS,
  AgentKernel,
  assertAgentKernel,
};
