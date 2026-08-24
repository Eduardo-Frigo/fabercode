'use strict';

const util = require('util');

const {
  SANDBOX_A1_REQUIRED_FEATURES,
  SANDBOX_BACKEND_SCHEMA_VERSION,
  SANDBOX_BACKEND_SECURITY_MODEL,
  createSandboxProbeResult,
} = require('../capabilities/sandbox_backend_contract');
const {
  createSandboxBackendRegistry,
} = require('../capabilities/sandbox_backend_registry');
const {
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION,
} = require('./execution_isolation_runtime_services');

const EXECUTION_ISOLATION_BROKER_SANDBOX_REGISTRY_VERSION =
  'execution-isolation-broker-sandbox-registry.v1';
const BROKER_BACKEND_ID = 'execution-isolation-authorized-job-executor';
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

class SandboxExecutorRequiredError extends Error {
  constructor() {
    super('The selection-only sandbox backend cannot execute a process directly.');
    this.name = 'SandboxExecutorRequiredError';
    this.code = 'SANDBOX_EXECUTOR_REQUIRED';
  }
}

function exactOptions(value) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== 1 || keys[0] !== 'runtimeServices') return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, 'runtimeServices');
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  return descriptor && descriptor.enumerable === true
    && Object.hasOwn(descriptor, 'value') && descriptor.value !== undefined
    ? descriptor.value
    : null;
}

function ownDataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (error) {
    preflightDataGraph(error);
    return undefined;
  }
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function captureRuntimeServices(value) {
  if (!value || typeof value !== 'object' || util.types.isProxy(value)
    || !Object.isFrozen(value)
    || ownDataValue(value, 'version') !== EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION) {
    throw new TypeError('Invalid execution isolation broker registry runtime services');
  }
  const diagnostics = ownDataValue(value, 'diagnostics');
  if (typeof diagnostics !== 'function' || util.types.isProxy(diagnostics)) {
    throw new TypeError('Invalid execution isolation broker registry diagnostics');
  }
  return Object.freeze({ receiver: value, diagnostics });
}

function readRuntimeState(captured) {
  let raw;
  try {
    raw = Reflect.apply(captured.diagnostics, captured.receiver, []);
  } catch (error) {
    preflightDataGraph(error);
    return Object.freeze({ enforced: false, reasonCode: 'DIAGNOSTICS_REJECTED' });
  }
  if (util.types.isPromise(raw) || !raw || typeof raw !== 'object'
    || Array.isArray(raw) || util.types.isProxy(raw) || !Object.isFrozen(raw)) {
    preflightDataGraph(raw);
    return Object.freeze({ enforced: false, reasonCode: 'DIAGNOSTICS_INVALID' });
  }
  const version = ownDataValue(raw, 'version');
  const state = ownDataValue(raw, 'state');
  const selectionStatus = ownDataValue(raw, 'selectionStatus');
  const rawReasonCode = ownDataValue(raw, 'selectionReasonCode');
  const reasonCode = typeof rawReasonCode === 'string' && SAFE_REASON_CODE.test(rawReasonCode)
    ? rawReasonCode
    : 'RUNTIME_UNAVAILABLE';
  return Object.freeze({
    enforced: version === EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION
      && state === 'ready' && selectionStatus === 'enforced',
    reasonCode,
  });
}

function createExecutionIsolationBrokerSandboxRegistry(options = {}) {
  const runtimeServices = exactOptions(options);
  if (!runtimeServices) {
    throw new TypeError('Invalid execution isolation broker sandbox registry options');
  }
  const captured = captureRuntimeServices(runtimeServices);
  const backend = Object.freeze({
    schemaVersion: SANDBOX_BACKEND_SCHEMA_VERSION,
    securityModel: SANDBOX_BACKEND_SECURITY_MODEL,
    id: BROKER_BACKEND_ID,
    probe() {
      const runtime = readRuntimeState(captured);
      return runtime.enforced
        ? createSandboxProbeResult({
          state: 'enforced',
          features: SANDBOX_A1_REQUIRED_FEATURES,
        })
        : createSandboxProbeResult({
          state: 'unavailable',
          features: [],
          reason: `Execution isolation runtime unavailable (${runtime.reasonCode}).`,
        });
    },
    execute() {
      return Promise.reject(new SandboxExecutorRequiredError());
    },
    terminate() {
      return Promise.resolve(Object.freeze({
        ok: false,
        code: 'SANDBOX_EXECUTOR_REQUIRED',
        message: 'The authority-bound job executor owns process termination.',
      }));
    },
  });
  const registry = createSandboxBackendRegistry({
    backends: [backend],
    unsupportedReason: 'The execution isolation runtime is not enforced.',
  });
  const selectDescriptor = Object.getOwnPropertyDescriptor(registry, 'select');
  if (!selectDescriptor || !Object.hasOwn(selectDescriptor, 'value')
    || typeof selectDescriptor.value !== 'function') {
    throw new TypeError('Execution isolation broker registry composition failed');
  }
  const select = selectDescriptor.value;

  function diagnostics() {
    const runtime = readRuntimeState(captured);
    return Object.freeze({
      version: EXECUTION_ISOLATION_BROKER_SANDBOX_REGISTRY_VERSION,
      state: runtime.enforced ? 'enforced' : 'unavailable',
      reasonCode: runtime.reasonCode,
      backendId: BROKER_BACKEND_ID,
      executionBoundary: 'authorized_job_executor_only',
    });
  }

  return Object.freeze({
    version: EXECUTION_ISOLATION_BROKER_SANDBOX_REGISTRY_VERSION,
    select(context) {
      return Reflect.apply(select, registry, [context]);
    },
    diagnostics,
  });
}

module.exports = {
  EXECUTION_ISOLATION_BROKER_SANDBOX_REGISTRY_VERSION,
  SandboxExecutorRequiredError,
  createExecutionIsolationBrokerSandboxRegistry,
};
