'use strict';

const crypto = require('crypto');

const { assertAgentKernel } = require('./agent_kernel');
const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
  createExecuteRequest,
  createMessageRequest,
  createPlanRequest,
} = require('./harness_contracts');
const {
  HARNESS_RUNTIME_CONFIG_VERSION,
  HARNESS_RUNTIME_MODES,
  createHarnessRuntimeConfig,
} = require('./harness_runtime_config');

function defaultRequestIdFactory() {
  return crypto.randomUUID();
}

function resolveRuntimeConfig(runtimeConfig) {
  if (
    runtimeConfig
    && typeof runtimeConfig === 'object'
    && runtimeConfig.schemaVersion === HARNESS_RUNTIME_CONFIG_VERSION
    && HARNESS_RUNTIME_MODES.includes(runtimeConfig.configuredMode)
  ) {
    return runtimeConfig;
  }
  return createHarnessRuntimeConfig({ env: {} });
}

function assertKernelResult(result, request, kernel) {
  if (!result || typeof result !== 'object') {
    throw new Error('Harness kernel returned an invalid result envelope.');
  }
  if (result.schemaVersion !== HARNESS_RESULT_SCHEMA_VERSION) {
    throw new Error('Harness kernel returned an unsupported result schema.');
  }
  if (result.requestId !== request.requestId || result.operation !== request.operation) {
    throw new Error('Harness kernel returned a result for a different request.');
  }
  if (result.kernelId !== kernel.id) {
    throw new Error('Harness kernel returned a result with a mismatched kernel id.');
  }
  if (!Object.prototype.hasOwnProperty.call(result, 'output')) {
    throw new Error('Harness kernel result is missing its output.');
  }
}

function getKernelDiagnostics(kernel) {
  if (typeof kernel.getDiagnostics === 'function') {
    return kernel.getDiagnostics();
  }
  return {
    id: kernel.id,
    version: typeof kernel.version === 'string' ? kernel.version : 'unknown',
    capabilities: Array.isArray(kernel.capabilities) ? [...kernel.capabilities] : [],
  };
}

function createHarnessRouter({
  legacyKernel,
  runtimeConfig = null,
  requestIdFactory = defaultRequestIdFactory,
} = {}) {
  assertAgentKernel(legacyKernel);
  if (typeof requestIdFactory !== 'function') {
    throw new Error('Harness router dependency missing: requestIdFactory');
  }

  const resolvedRuntimeConfig = resolveRuntimeConfig(runtimeConfig);
  const legacyMode = 'legacy';

  async function dispatch(request) {
    assertHarnessRequest(request);

    let result;
    if (request.operation === HARNESS_OPERATIONS.PLAN) {
      result = await legacyKernel.plan(request);
    } else if (request.operation === HARNESS_OPERATIONS.MESSAGE) {
      result = await legacyKernel.message(request);
    } else if (request.operation === HARNESS_OPERATIONS.EXECUTE) {
      result = await legacyKernel.execute(request);
    } else {
      throw new Error(`Harness operation not supported: ${request.operation}`);
    }

    assertKernelResult(result, request, legacyKernel);
    return result.output;
  }

  function nextRequestId() {
    return requestIdFactory();
  }

  function plan(payload) {
    return dispatch(createPlanRequest(payload, { requestId: nextRequestId() }));
  }

  function message(payload) {
    return dispatch(createMessageRequest(payload, { requestId: nextRequestId() }));
  }

  function execute(action, projectInfo) {
    return dispatch(createExecuteRequest(action, projectInfo, { requestId: nextRequestId() }));
  }

  function getStatus() {
    const configuredMode = resolvedRuntimeConfig.configuredMode || legacyMode;
    const configFallbackReason = resolvedRuntimeConfig.diagnostics
      && resolvedRuntimeConfig.diagnostics.fallbackReason;
    const configFallbackActive = configFallbackReason === 'kill_switch'
      || configFallbackReason === 'invalid_mode';
    return {
      ok: true,
      runtimeConfig: resolvedRuntimeConfig,
      requestedMode: resolvedRuntimeConfig.requestedMode || configuredMode,
      configuredMode,
      effectiveMode: legacyMode,
      activeKernelId: legacyKernel.id,
      fallbackActive: configuredMode !== legacyMode
        || resolvedRuntimeConfig.requestedMode !== legacyMode
        || configFallbackActive,
      reason: configFallbackReason === 'kill_switch' || configFallbackReason === 'invalid_mode'
        ? configFallbackReason
        : configuredMode === legacyMode
          ? 'legacy_default'
          : 'phase_1_legacy_fallback',
      kernel: getKernelDiagnostics(legacyKernel),
    };
  }

  return {
    execute,
    getStatus,
    message,
    plan,
  };
}

module.exports = {
  createHarnessRouter,
  defaultRequestIdFactory,
};
