'use strict';

const crypto = require('crypto');
const util = require('util');

const { assertAgentKernel } = require('./agent_kernel');
const {
  assertContextPackHarnessInjector,
} = require('./context_pack_harness_injector');
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

function assertKernelResult(result, request, expectedKernelIds) {
  const allowedKernelIds = Array.isArray(expectedKernelIds)
    ? expectedKernelIds
    : [expectedKernelIds.id];
  if (!result || typeof result !== 'object') {
    throw new Error('Harness kernel returned an invalid result envelope.');
  }
  if (result.schemaVersion !== HARNESS_RESULT_SCHEMA_VERSION) {
    throw new Error('Harness kernel returned an unsupported result schema.');
  }
  if (result.requestId !== request.requestId || result.operation !== request.operation) {
    throw new Error('Harness kernel returned a result for a different request.');
  }
  if (!allowedKernelIds.includes(result.kernelId)) {
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

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function inspectableFunction(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)) {
    throw new TypeError(`${fieldName} must be an inspectable function`);
  }
  try {
    Function.prototype.toString.call(value);
  } catch {
    throw new TypeError(`${fieldName} must be an inspectable function`);
  }
  return value;
}

function inspectFrozenDiagnostics(value, fieldName = 'shadowPlanRunner.diagnostics') {
  if (!isPlainRecord(value) || !Object.isFrozen(value)) {
    throw new TypeError(`${fieldName} must be synchronous frozen data`);
  }
  const fields = new Map();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = typeof key === 'string'
      ? Object.getOwnPropertyDescriptor(value, key)
      : null;
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || !['string', 'number', 'boolean'].includes(typeof descriptor.value)
        && descriptor.value !== null) {
      throw new TypeError(
        `${fieldName} must contain scalar data values only`
      );
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function readShadowPlanRunnerDiagnostics(port) {
  let diagnostics;
  try {
    diagnostics = Reflect.apply(port.diagnostics, port.receiver, []);
  } catch {
    throw new TypeError('shadowPlanRunner.diagnostics failed');
  }
  if (util.types.isPromise(diagnostics)) {
    throw new TypeError('shadowPlanRunner.diagnostics must be synchronous frozen data');
  }
  const fields = inspectFrozenDiagnostics(diagnostics, 'shadowPlanRunner.diagnostics');
  const version = fields.get('version');
  const authoritativeKernelId = fields.get('authoritativeKernelId');
  const shadowKernelId = fields.get('shadowKernelId');
  if (version !== port.version
    || authoritativeKernelId !== port.authoritativeKernelId
    || shadowKernelId !== port.shadowKernelId) {
    throw new TypeError('shadowPlanRunner diagnostics identity changed');
  }
  return diagnostics;
}

function captureShadowPlanRunner(value, authoritativeKernel) {
  if (value === null || value === undefined) return null;
  if (!isPlainRecord(value) || !Object.isFrozen(value)) {
    throw new TypeError('shadowPlanRunner must be a frozen port');
  }
  const allowedKeys = new Set(['version', 'plan', 'drain', 'diagnostics']);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))) {
    throw new TypeError('shadowPlanRunner has invalid fields');
  }
  const readDataValue = (key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`shadowPlanRunner.${key} is required`);
    }
    return descriptor.value;
  };
  const version = readDataValue('version');
  if (typeof version !== 'string'
    || !/^[A-Za-z0-9._:@-]{1,256}$/.test(version)) {
    throw new TypeError('shadowPlanRunner.version must be a safe identifier');
  }
  const port = {
    receiver: value,
    version,
    plan: inspectableFunction(readDataValue('plan'), 'shadowPlanRunner.plan'),
    diagnostics: inspectableFunction(
      readDataValue('diagnostics'),
      'shadowPlanRunner.diagnostics'
    ),
  };
  let diagnostics;
  try {
    diagnostics = Reflect.apply(port.diagnostics, port.receiver, []);
  } catch {
    throw new TypeError('shadowPlanRunner.diagnostics failed');
  }
  if (util.types.isPromise(diagnostics)) {
    throw new TypeError('shadowPlanRunner.diagnostics must be synchronous frozen data');
  }
  const diagnosticFields = inspectFrozenDiagnostics(
    diagnostics,
    'shadowPlanRunner.diagnostics'
  );
  if (diagnosticFields.get('version') !== version
    || diagnosticFields.get('authoritativeKernelId') !== authoritativeKernel.id) {
    throw new TypeError(
      'shadowPlanRunner.authoritativeKernelId must match legacyKernel.id'
    );
  }
  const shadowKernelId = diagnosticFields.get('shadowKernelId');
  if (typeof shadowKernelId !== 'string'
    || !/^[A-Za-z0-9._:@-]{1,256}$/.test(shadowKernelId)
    || shadowKernelId === authoritativeKernel.id) {
    throw new TypeError('shadowPlanRunner.shadowKernelId is invalid');
  }
  port.authoritativeKernelId = authoritativeKernel.id;
  port.shadowKernelId = shadowKernelId;
  return Object.freeze(port);
}

function callShadowPlanRunner(port, request) {
  let pending;
  try {
    pending = Reflect.apply(port.plan, port.receiver, [request]);
  } catch (error) {
    return Promise.reject(error);
  }
  if (!util.types.isPromise(pending)) {
    return Promise.reject(new TypeError(
      'shadowPlanRunner.plan must return a native Promise'
    ));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, pending, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

function readCanaryEditRunnerDiagnostics(port) {
  let diagnostics;
  try {
    diagnostics = Reflect.apply(port.diagnostics, port.receiver, []);
  } catch {
    throw new TypeError('canaryEditRunner.diagnostics failed');
  }
  if (util.types.isPromise(diagnostics)) {
    throw new TypeError(
      'canaryEditRunner.diagnostics must be synchronous frozen data'
    );
  }
  const fields = inspectFrozenDiagnostics(
    diagnostics,
    'canaryEditRunner.diagnostics'
  );
  if (fields.get('version') !== port.version
    || fields.get('authoritativeKernelId') !== port.authoritativeKernelId
    || fields.get('canaryKernelId') !== port.canaryKernelId) {
    throw new TypeError('canaryEditRunner diagnostics identity changed');
  }
  return diagnostics;
}

function captureCanaryEditRunner(value, authoritativeKernel) {
  if (value === null || value === undefined) return null;
  if (!isPlainRecord(value) || !Object.isFrozen(value)) {
    throw new TypeError('canaryEditRunner must be a frozen port');
  }
  const allowedKeys = new Set(['version', 'execute', 'diagnostics']);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))
    || keys.length !== allowedKeys.size) {
    throw new TypeError('canaryEditRunner has invalid fields');
  }
  const readDataValue = (key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`canaryEditRunner.${key} is required`);
    }
    return descriptor.value;
  };
  const version = readDataValue('version');
  if (typeof version !== 'string'
    || !/^[A-Za-z0-9._:@-]{1,256}$/.test(version)) {
    throw new TypeError('canaryEditRunner.version must be a safe identifier');
  }
  const port = {
    receiver: value,
    version,
    execute: inspectableFunction(
      readDataValue('execute'),
      'canaryEditRunner.execute'
    ),
    diagnostics: inspectableFunction(
      readDataValue('diagnostics'),
      'canaryEditRunner.diagnostics'
    ),
  };
  let diagnostics;
  try {
    diagnostics = Reflect.apply(port.diagnostics, port.receiver, []);
  } catch {
    throw new TypeError('canaryEditRunner.diagnostics failed');
  }
  if (util.types.isPromise(diagnostics)) {
    throw new TypeError(
      'canaryEditRunner.diagnostics must be synchronous frozen data'
    );
  }
  const diagnosticFields = inspectFrozenDiagnostics(
    diagnostics,
    'canaryEditRunner.diagnostics'
  );
  if (diagnosticFields.get('version') !== version
    || diagnosticFields.get('authoritativeKernelId') !== authoritativeKernel.id) {
    throw new TypeError(
      'canaryEditRunner.authoritativeKernelId must match legacyKernel.id'
    );
  }
  const canaryKernelId = diagnosticFields.get('canaryKernelId');
  if (typeof canaryKernelId !== 'string'
    || !/^[A-Za-z0-9._:@-]{1,256}$/.test(canaryKernelId)
    || canaryKernelId === authoritativeKernel.id) {
    throw new TypeError('canaryEditRunner.canaryKernelId is invalid');
  }
  port.authoritativeKernelId = authoritativeKernel.id;
  port.canaryKernelId = canaryKernelId;
  return Object.freeze(port);
}

function callCanaryEditRunner(port, request) {
  let pending;
  try {
    pending = Reflect.apply(port.execute, port.receiver, [request]);
  } catch (error) {
    return Promise.reject(error);
  }
  if (!util.types.isPromise(pending)) {
    return Promise.reject(new TypeError(
      'canaryEditRunner.execute must return a native Promise'
    ));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, pending, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

function createHarnessRouter({
  canaryEditRunner = null,
  contextPackInjector = null,
  legacyKernel,
  runtimeConfig = null,
  requestIdFactory = defaultRequestIdFactory,
  shadowPlanRunner = null,
} = {}) {
  assertAgentKernel(legacyKernel);
  if (typeof requestIdFactory !== 'function') {
    throw new Error('Harness router dependency missing: requestIdFactory');
  }
  const resolvedContextPackInjector = contextPackInjector === null
    ? null
    : assertContextPackHarnessInjector(contextPackInjector);

  const resolvedRuntimeConfig = resolveRuntimeConfig(runtimeConfig);
  const legacyMode = 'legacy';
  const capturedShadowPlanRunner = captureShadowPlanRunner(
    shadowPlanRunner,
    legacyKernel
  );
  const capturedCanaryEditRunner = captureCanaryEditRunner(
    canaryEditRunner,
    legacyKernel
  );
  const shadowActive = resolvedRuntimeConfig.configuredMode === 'shadow'
    && capturedShadowPlanRunner !== null;
  const canaryActive = resolvedRuntimeConfig.configuredMode === 'canary'
    && capturedCanaryEditRunner !== null;

  async function dispatch(request) {
    assertHarnessRequest(request);
    const kernelRequest = resolvedContextPackInjector
      ? await resolvedContextPackInjector.inject(request)
      : request;
    assertHarnessRequest(kernelRequest);
    if (resolvedContextPackInjector
      && (!Object.prototype.hasOwnProperty.call(kernelRequest, 'contextPack')
        || kernelRequest.requestId !== request.requestId
        || kernelRequest.operation !== request.operation)) {
      throw new Error('ContextPack injector returned a mismatched Harness request.');
    }

    let result;
    let expectedKernelIds = [legacyKernel.id];
    if (kernelRequest.operation === HARNESS_OPERATIONS.PLAN) {
      result = shadowActive
        ? await callShadowPlanRunner(capturedShadowPlanRunner, kernelRequest)
        : await legacyKernel.plan(kernelRequest);
    } else if (kernelRequest.operation === HARNESS_OPERATIONS.MESSAGE) {
      result = await legacyKernel.message(kernelRequest);
    } else if (kernelRequest.operation === HARNESS_OPERATIONS.EXECUTE) {
      if (canaryActive) {
        result = await callCanaryEditRunner(capturedCanaryEditRunner, kernelRequest);
        expectedKernelIds = [
          legacyKernel.id,
          capturedCanaryEditRunner.canaryKernelId,
        ];
      } else {
        result = await legacyKernel.execute(kernelRequest);
      }
    } else {
      throw new Error(`Harness operation not supported: ${kernelRequest.operation}`);
    }

    assertKernelResult(result, kernelRequest, expectedKernelIds);
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

  function execute(action, projectInfo, executionContext) {
    const options = { requestId: nextRequestId() };
    if (arguments.length >= 3) {
      options.executionContext = executionContext;
    }
    return dispatch(createExecuteRequest(action, projectInfo, options));
  }

  function getStatus() {
    const configuredMode = resolvedRuntimeConfig.configuredMode || legacyMode;
    const effectiveMode = shadowActive
      ? 'shadow'
      : canaryActive
        ? 'canary'
        : legacyMode;
    const configFallbackReason = resolvedRuntimeConfig.diagnostics
      && resolvedRuntimeConfig.diagnostics.fallbackReason;
    const configFallbackActive = configFallbackReason === 'kill_switch'
      || configFallbackReason === 'invalid_mode';
    let reason;
    if (configFallbackActive) {
      reason = configFallbackReason;
    } else if (shadowActive) {
      reason = 'shadow_active';
    } else if (canaryActive) {
      reason = 'canary_active';
    } else if (configuredMode === legacyMode) {
      reason = 'legacy_default';
    } else if (configuredMode === 'shadow') {
      reason = 'shadow_runner_unavailable';
    } else if (configuredMode === 'canary') {
      reason = 'canary_runner_unavailable';
    } else {
      reason = 'phase_5_not_promoted';
    }
    return {
      ok: true,
      runtimeConfig: resolvedRuntimeConfig,
      requestedMode: resolvedRuntimeConfig.requestedMode || configuredMode,
      configuredMode,
      effectiveMode,
      activeKernelId: canaryActive
        ? capturedCanaryEditRunner.canaryKernelId
        : legacyKernel.id,
      canaryKernelId: canaryActive
        ? capturedCanaryEditRunner.canaryKernelId
        : null,
      shadowKernelId: shadowActive
        ? capturedShadowPlanRunner.shadowKernelId
        : null,
      fallbackActive: configFallbackActive || configuredMode !== effectiveMode,
      reason,
      kernel: getKernelDiagnostics(legacyKernel),
      canaryKernel: canaryActive
        ? readCanaryEditRunnerDiagnostics(capturedCanaryEditRunner)
        : null,
      shadowKernel: shadowActive
        ? readShadowPlanRunnerDiagnostics(capturedShadowPlanRunner)
        : null,
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
