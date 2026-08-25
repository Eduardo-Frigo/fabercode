'use strict';

const util = require('util');

const {
  CODEX_APP_SERVER_KERNEL_ID,
  createCodexAppServerKernelAdapter,
} = require('./codex_app_server_kernel_adapter');
const {
  HARNESS_RUNTIME_CONFIG_VERSION,
  HARNESS_RUNTIME_MODES,
} = require('./harness_runtime_config');
const {
  createShadowPlanEvidenceEvaluator,
} = require('./shadow_plan_evidence_evaluator');
const {
  SHADOW_PLAN_EVALUATION_LEDGER_VERSION,
  createShadowPlanEvaluationLedger,
} = require('./shadow_plan_evaluation_ledger');
const {
  SHADOW_PLAN_RUNNER_VERSION,
  createShadowPlanRunner,
} = require('./shadow_plan_runner');
const {
  createShadowPlanSemanticComparator,
} = require('./shadow_plan_semantic_comparator');

const SHADOW_PLAN_RUNTIME_COMPOSITION_VERSION =
  'shadow-plan-runtime-composition.v1';
const SHADOW_PLAN_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION =
  'shadow-plan-runtime-close-receipt.v1';

const SHADOW_PLAN_RUNTIME_COMPOSITION_STATES = Object.freeze({
  BLOCKED: 'blocked',
  CLOSED: 'closed',
  CLOSING: 'closing',
  DISABLED: 'disabled',
  READY: 'ready',
});

const SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS = Object.freeze({
  ADAPTER_DISABLED: 'adapter_disabled',
  AUTHORITATIVE_KERNEL_UNAVAILABLE: 'authoritative_kernel_unavailable',
  CLIENT_CLOSE_FAILED: 'client_close_failed',
  CLIENT_UNAVAILABLE: 'client_unavailable',
  CLOSED: 'closed',
  COMPOSITION_FAILED: 'composition_failed',
  DRAIN_FAILED: 'drain_failed',
  EVIDENCE_GRADER_UNAVAILABLE: 'evidence_grader_unavailable',
  INVALID_OPTIONS: 'invalid_options',
  INVALID_RUNTIME_CONFIG: 'invalid_runtime_config',
  KILL_SWITCH: 'kill_switch',
  MODE_NOT_SHADOW: 'mode_not_shadow',
  PROMPT_PROJECTOR_UNAVAILABLE: 'prompt_projector_unavailable',
  READY: 'ready',
});

const OPTION_KEYS = Object.freeze([
  'adapterEnabled',
  'authoritativeKernel',
  'client',
  'grader',
  'model',
  'promptProjector',
  'requestIdFactory',
  'runtimeConfig',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'adapterEnabled',
  'runtimeConfig',
]);
const RUNTIME_CONFIG_KEYS = Object.freeze([
  'schemaVersion',
  'requestedMode',
  'configuredMode',
  'killSwitch',
  'configuredPrimaryKernel',
  'configuredShadowKernel',
  'diagnostics',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!isPlainRecord(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.some((key) => typeof key !== 'string'
    || FORBIDDEN_KEYS.has(key)
    || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function ownDataValue(value, key) {
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return null;
  }
  return descriptor && descriptor.enumerable === true
    && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : null;
}

function normalizeRuntimeConfig(value) {
  const fields = exactDataFields(value, RUNTIME_CONFIG_KEYS);
  if (!fields || !Object.isFrozen(value)
    || fields.get('schemaVersion') !== HARNESS_RUNTIME_CONFIG_VERSION
    || !HARNESS_RUNTIME_MODES.includes(fields.get('requestedMode'))
    || !HARNESS_RUNTIME_MODES.includes(fields.get('configuredMode'))
    || typeof fields.get('killSwitch') !== 'boolean') return null;
  const requestedMode = fields.get('requestedMode');
  const configuredMode = fields.get('configuredMode');
  const killSwitch = fields.get('killSwitch');
  const expectedPrimaryKernel = configuredMode === 'legacy'
    || configuredMode === 'shadow'
    ? 'legacy'
    : 'v2';
  const expectedShadowKernel = configuredMode === 'shadow' ? 'v2' : null;
  if (fields.get('configuredPrimaryKernel') !== expectedPrimaryKernel
    || fields.get('configuredShadowKernel') !== expectedShadowKernel
    || (killSwitch && configuredMode !== 'legacy')) return null;
  const fallbackReason = ownDataValue(fields.get('diagnostics'), 'fallbackReason');
  return Object.freeze({
    requestedMode,
    configuredMode,
    killSwitch,
    fallbackReason: typeof fallbackReason === 'string' ? fallbackReason : null,
  });
}

function inspectableFunction(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)) {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  try {
    Function.prototype.toString.call(value);
  } catch {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  return value;
}

function captureClientLifecycle(value) {
  if (!isPlainRecord(value) || !Object.isFrozen(value)) {
    throw new TypeError('client must be a frozen port');
  }
  const close = ownDataValue(value, 'close');
  const status = ownDataValue(value, 'status');
  return Object.freeze({
    receiver: value,
    close: inspectableFunction(close, 'client.close'),
    status: inspectableFunction(status, 'client.status'),
  });
}

function observeNativePromise(value, fieldName) {
  if (!util.types.isPromise(value)) {
    return Promise.reject(new TypeError(fieldName + ' must return a native Promise'));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, value, [resolve, reject]);
    } catch {
      reject(new TypeError(fieldName + ' failed'));
    }
  });
}

function callAsyncPort(port, methodName, args = []) {
  let pending;
  try {
    pending = Reflect.apply(port[methodName], port.receiver, args);
  } catch {
    return Promise.reject(new TypeError(methodName + ' failed'));
  }
  return observeNativePromise(pending, methodName);
}

function readClientState(clientLifecycle) {
  if (!clientLifecycle) return null;
  try {
    const value = Reflect.apply(
      clientLifecycle.status,
      clientLifecycle.receiver,
      []
    );
    if (util.types.isPromise(value) || !isPlainRecord(value)
      || !Object.isFrozen(value)) return 'unknown';
    const state = ownDataValue(value, 'state');
    return typeof state === 'string'
      && /^[a-z][a-z0-9_-]{0,63}$/.test(state)
      ? state
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

function confirmedClientClose(value) {
  if (!isPlainRecord(value) || !Object.isFrozen(value)) return false;
  return ownDataValue(value, 'closed') === true
    && ownDataValue(value, 'exited') === true;
}

function createRuntimePort({
  initialState,
  initialReason,
  runtimeConfig,
  adapterEnabled,
  runner = null,
  ledger = null,
  clientLifecycle = null,
}) {
  let state = initialState;
  let reason = initialReason;
  let closePromise = null;
  let lastCloseFailureCode = null;

  function diagnostics() {
    return Object.freeze({
      version: SHADOW_PLAN_RUNTIME_COMPOSITION_VERSION,
      state,
      reason,
      requestedMode: runtimeConfig ? runtimeConfig.requestedMode : null,
      configuredMode: runtimeConfig ? runtimeConfig.configuredMode : null,
      adapterEnabled,
      shadowRunnerAvailable: runner !== null,
      shadowKernelId: runner ? CODEX_APP_SERVER_KERNEL_ID : null,
      runnerVersion: runner ? SHADOW_PLAN_RUNNER_VERSION : null,
      ledgerVersion: ledger ? SHADOW_PLAN_EVALUATION_LEDGER_VERSION : null,
      clientState: readClientState(clientLifecycle),
      closing: state === SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.CLOSING,
      closed: state === SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.CLOSED,
      lastCloseFailureCode,
    });
  }

  function snapshot() {
    return ledger ? ledger.snapshot() : null;
  }

  async function performClose() {
    state = SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.CLOSING;
    let drained = runner === null;
    let clientClosed = clientLifecycle === null;

    if (runner) {
      try {
        await observeNativePromise(runner.drain(), 'shadowPlanRunner.drain');
        drained = true;
      } catch {
        lastCloseFailureCode =
          SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.DRAIN_FAILED;
      }
    }

    if (clientLifecycle) {
      try {
        const closeReceipt = await callAsyncPort(clientLifecycle, 'close');
        clientClosed = confirmedClientClose(closeReceipt);
        if (!clientClosed) {
          lastCloseFailureCode =
            SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.CLIENT_CLOSE_FAILED;
        }
      } catch {
        clientClosed = false;
        lastCloseFailureCode =
          SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.CLIENT_CLOSE_FAILED;
      }
    }

    state = SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.CLOSED;
    reason = SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.CLOSED;
    return Object.freeze({
      schemaVersion: SHADOW_PLAN_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION,
      ok: drained && clientClosed,
      closed: true,
      drained,
      clientClosed,
      lastFailureCode: lastCloseFailureCode,
    });
  }

  function close() {
    if (!closePromise) closePromise = performClose();
    return closePromise;
  }

  return Object.freeze({
    version: SHADOW_PLAN_RUNTIME_COMPOSITION_VERSION,
    shadowPlanRunner: runner,
    snapshot,
    diagnostics,
    close,
  });
}

function unavailableRuntime({
  state,
  reason,
  runtimeConfig = null,
  adapterEnabled = false,
}) {
  return createRuntimePort({
    initialState: state,
    initialReason: reason,
    runtimeConfig,
    adapterEnabled,
  });
}

function createShadowPlanRuntimeComposition(options = {}) {
  const fields = exactDataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS);
  if (!fields || typeof fields.get('adapterEnabled') !== 'boolean') {
    return unavailableRuntime({
      state: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.INVALID_OPTIONS,
    });
  }
  const adapterEnabled = fields.get('adapterEnabled');
  const runtimeConfig = normalizeRuntimeConfig(fields.get('runtimeConfig'));
  if (!runtimeConfig) {
    return unavailableRuntime({
      state: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.INVALID_RUNTIME_CONFIG,
      adapterEnabled,
    });
  }
  if (runtimeConfig.killSwitch || runtimeConfig.fallbackReason === 'kill_switch') {
    return unavailableRuntime({
      state: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.DISABLED,
      reason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.KILL_SWITCH,
      runtimeConfig,
      adapterEnabled,
    });
  }
  if (runtimeConfig.configuredMode !== 'shadow') {
    return unavailableRuntime({
      state: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.DISABLED,
      reason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.MODE_NOT_SHADOW,
      runtimeConfig,
      adapterEnabled,
    });
  }
  if (!adapterEnabled) {
    return unavailableRuntime({
      state: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.ADAPTER_DISABLED,
      runtimeConfig,
      adapterEnabled,
    });
  }
  if (!fields.has('authoritativeKernel') || !fields.get('authoritativeKernel')) {
    return unavailableRuntime({
      state: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.AUTHORITATIVE_KERNEL_UNAVAILABLE,
      runtimeConfig,
      adapterEnabled,
    });
  }
  if (!fields.has('client') || !fields.get('client')) {
    return unavailableRuntime({
      state: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.CLIENT_UNAVAILABLE,
      runtimeConfig,
      adapterEnabled,
    });
  }
  if (!fields.has('promptProjector') || !fields.get('promptProjector')) {
    return unavailableRuntime({
      state: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.PROMPT_PROJECTOR_UNAVAILABLE,
      runtimeConfig,
      adapterEnabled,
    });
  }
  if (!fields.has('grader') || !fields.get('grader')) {
    return unavailableRuntime({
      state: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.EVIDENCE_GRADER_UNAVAILABLE,
      runtimeConfig,
      adapterEnabled,
    });
  }

  try {
    const evaluator = createShadowPlanEvidenceEvaluator({
      grader: fields.get('grader'),
    });
    const comparator = createShadowPlanSemanticComparator({ evaluator });
    const ledger = createShadowPlanEvaluationLedger();
    const clientLifecycle = captureClientLifecycle(fields.get('client'));
    const adapterOptions = {
      client: fields.get('client'),
      promptProjector: fields.get('promptProjector'),
    };
    if (fields.has('model')) adapterOptions.model = fields.get('model');
    if (fields.has('requestIdFactory')) {
      adapterOptions.requestIdFactory = fields.get('requestIdFactory');
    }
    const shadowKernel = createCodexAppServerKernelAdapter(adapterOptions);
    const runner = createShadowPlanRunner({
      authoritativeKernel: fields.get('authoritativeKernel'),
      shadowKernel,
      comparator,
      reportSink: ledger.reportSink,
    });
    return createRuntimePort({
      initialState: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.READY,
      initialReason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.READY,
      runtimeConfig,
      adapterEnabled,
      runner,
      ledger,
      clientLifecycle,
    });
  } catch {
    return unavailableRuntime({
      state: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.COMPOSITION_FAILED,
      runtimeConfig,
      adapterEnabled,
    });
  }
}

module.exports = {
  SHADOW_PLAN_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION,
  SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS,
  SHADOW_PLAN_RUNTIME_COMPOSITION_STATES,
  SHADOW_PLAN_RUNTIME_COMPOSITION_VERSION,
  createShadowPlanRuntimeComposition,
};
