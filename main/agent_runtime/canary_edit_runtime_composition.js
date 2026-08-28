'use strict';

const util = require('util');

const {
  CANARY_EDIT_RUNNER_VERSION,
  createCanaryEditRunner,
} = require('./canary_edit_runner');
const {
  CANARY_MANUAL_ROLLBACK_SERVICE_VERSION,
  createCanaryManualRollbackService,
} = require('./canary_manual_rollback_service');
const {
  CANARY_PROMOTION_CONTROLLER_VERSION,
  createCanaryPromotionController,
} = require('./canary_promotion_controller');
const {
  CANARY_ROLLOUT_EVIDENCE_LEDGER_VERSION,
  createCanaryRolloutEvidenceLedger,
} = require('./canary_rollout_evidence_ledger');
const {
  createCanaryRolloutEvidenceObserverAdapter,
} = require('./canary_rollout_evidence_observer_adapter');
const {
  createCanaryRolloutSelector,
} = require('./canary_rollout_selector');
const {
  CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION,
  createCanaryTransactionalStagingExecutor,
} = require('./canary_transactional_staging_executor');
const {
  HARNESS_RUNTIME_CONFIG_VERSION,
  HARNESS_RUNTIME_MODES,
} = require('./harness_runtime_config');

const CANARY_EDIT_RUNTIME_COMPOSITION_VERSION =
  'canary-edit-runtime-composition.v1';
const CANARY_EDIT_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION =
  'canary-edit-runtime-close-receipt.v1';

const CANARY_EDIT_RUNTIME_COMPOSITION_STATES = Object.freeze({
  BLOCKED: 'blocked',
  CLOSED: 'closed',
  CLOSING: 'closing',
  DISABLED: 'disabled',
  READY: 'ready',
});

const CANARY_EDIT_RUNTIME_COMPOSITION_REASONS = Object.freeze({
  ADAPTER_DISABLED: 'adapter_disabled',
  ADMISSION_FACTS_PROVIDER_UNAVAILABLE:
    'admission_facts_provider_unavailable',
  AUTHORITATIVE_KERNEL_UNAVAILABLE: 'authoritative_kernel_unavailable',
  CANARY_EDITOR_UNAVAILABLE: 'canary_editor_unavailable',
  CLIENT_CLOSE_FAILED: 'client_close_failed',
  CLIENT_NOT_READY: 'client_not_ready',
  CLIENT_UNAVAILABLE: 'client_unavailable',
  CLOSED: 'closed',
  COHORT_SEED_UNAVAILABLE: 'cohort_seed_unavailable',
  COMPOSITION_FAILED: 'composition_failed',
  DRAIN_FAILED: 'drain_failed',
  EVIDENCE_JOURNAL_UNAVAILABLE: 'evidence_journal_unavailable',
  MANUAL_ROLLBACK_JOURNAL_UNAVAILABLE:
    'manual_rollback_journal_unavailable',
  INVALID_OPTIONS: 'invalid_options',
  INVALID_RUNTIME_CONFIG: 'invalid_runtime_config',
  KILL_SWITCH: 'kill_switch',
  MODE_NOT_CANARY: 'mode_not_canary',
  PROMOTION_BACKEND_UNAVAILABLE: 'promotion_backend_unavailable',
  READY: 'ready',
  WORKSPACE_SESSION_UNAVAILABLE: 'workspace_session_unavailable',
});

const OPTION_KEYS = Object.freeze([
  'runtimeConfig',
  'adapterEnabled',
  'authoritativeKernel',
  'admissionFactsProvider',
  'cohortSeed',
  'workspaceSessionPort',
  'canaryEditor',
  'promotionBackend',
  'evidenceJournal',
  'manualRollbackJournal',
  'client',
  'minimumCanaryJobs',
  'minimumBaselineJobs',
]);
const REQUIRED_OPTION_KEYS = Object.freeze(['runtimeConfig', 'adapterEnabled']);
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

function dataFields(value, allowedKeys, requiredKeys = allowedKeys) {
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
  const fields = dataFields(value, RUNTIME_CONFIG_KEYS);
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
    || killSwitch && configuredMode !== 'legacy') return null;
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
    throw new TypeError('client must be a frozen lifecycle port');
  }
  return Object.freeze({
    receiver: value,
    close: inspectableFunction(ownDataValue(value, 'close'), 'client.close'),
    status: inspectableFunction(ownDataValue(value, 'status'), 'client.status'),
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
  executor = null,
  ledger = null,
  manualRollbackService = null,
  rolloutEvidenceObserver = null,
  clientLifecycle = null,
}) {
  let state = initialState;
  let reason = initialReason;
  let closePromise = null;
  let lastCloseFailureCode = null;
  const inFlight = new Set();

  function trackExecution(request) {
    if (state !== CANARY_EDIT_RUNTIME_COMPOSITION_STATES.READY) {
      return Promise.reject(new TypeError('canary runtime is closing or closed'));
    }
    let pending;
    try {
      pending = Reflect.apply(runner.execute, runner, [request]);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!util.types.isPromise(pending)) {
      return Promise.reject(new TypeError(
        'canaryEditRunner.execute must return a native Promise'
      ));
    }
    const tracked = observeNativePromise(pending, 'canaryEditRunner.execute');
    inFlight.add(tracked);
    Reflect.apply(Promise.prototype.then, tracked, [
      () => inFlight.delete(tracked),
      () => inFlight.delete(tracked),
    ]);
    return tracked;
  }

  const canaryEditRunner = runner
    ? Object.freeze({
      version: runner.version,
      execute: trackExecution,
      diagnostics: () => runner.diagnostics(),
    })
    : null;

  function trackManualRollback(request) {
    if (state !== CANARY_EDIT_RUNTIME_COMPOSITION_STATES.READY) {
      return Promise.reject(new TypeError('canary runtime is closing or closed'));
    }
    let pending;
    try {
      pending = Reflect.apply(
        manualRollbackService.rollback,
        manualRollbackService,
        [request]
      );
    } catch (error) {
      return Promise.reject(error);
    }
    if (!util.types.isPromise(pending)) {
      return Promise.reject(new TypeError(
        'manualRollbackService.rollback must return a native Promise'
      ));
    }
    const tracked = observeNativePromise(
      pending,
      'manualRollbackService.rollback'
    );
    inFlight.add(tracked);
    Reflect.apply(Promise.prototype.then, tracked, [
      () => inFlight.delete(tracked),
      () => inFlight.delete(tracked),
    ]);
    return tracked;
  }

  const manualRollback = manualRollbackService
    ? Object.freeze({
      version: CANARY_MANUAL_ROLLBACK_SERVICE_VERSION,
      rollback: trackManualRollback,
      diagnostics: () => manualRollbackService.diagnostics(),
    })
    : null;

  function diagnostics() {
    const runnerDiagnostics = runner ? runner.diagnostics() : null;
    const ledgerDiagnostics = ledger ? ledger.diagnostics() : null;
    return Object.freeze({
      version: CANARY_EDIT_RUNTIME_COMPOSITION_VERSION,
      state,
      reason,
      requestedMode: runtimeConfig ? runtimeConfig.requestedMode : null,
      configuredMode: runtimeConfig ? runtimeConfig.configuredMode : null,
      adapterEnabled,
      canaryRunnerAvailable: canaryEditRunner !== null,
      canaryKernelId: runnerDiagnostics
        ? runnerDiagnostics.canaryKernelId
        : null,
      runnerVersion: runner ? CANARY_EDIT_RUNNER_VERSION : null,
      executorVersion: executor
        ? CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION
        : null,
      ledgerVersion: ledger ? CANARY_ROLLOUT_EVIDENCE_LEDGER_VERSION : null,
      journalVersion: ledgerDiagnostics
        ? ledgerDiagnostics.journalVersion
        : null,
      recoveredEvidence: ledgerDiagnostics
        ? ledgerDiagnostics.recoveredEvidence
        : 0,
      recoveredReconciliations: ledgerDiagnostics
        ? ledgerDiagnostics.recoveredReconciliations
        : 0,
      manualRollbackService: manualRollbackService
        ? manualRollbackService.diagnostics()
        : null,
      rolloutEvidenceObserver: rolloutEvidenceObserver
        ? rolloutEvidenceObserver.diagnostics()
        : null,
      clientState: readClientState(clientLifecycle),
      inFlightExecutions: inFlight.size,
      closing: state === CANARY_EDIT_RUNTIME_COMPOSITION_STATES.CLOSING,
      closed: state === CANARY_EDIT_RUNTIME_COMPOSITION_STATES.CLOSED,
      lastCloseFailureCode,
    });
  }

  function snapshot(rolloutStage) {
    return ledger ? ledger.snapshot(rolloutStage) : null;
  }

  function advancement(rolloutStage) {
    return ledger ? ledger.advancement(rolloutStage) : null;
  }

  async function drainExecutions() {
    const pending = [...inFlight];
    await Promise.all(pending.map((execution) => new Promise((resolve) => {
      Reflect.apply(Promise.prototype.then, execution, [resolve, resolve]);
    })));
    return inFlight.size === 0;
  }

  async function performClose() {
    state = CANARY_EDIT_RUNTIME_COMPOSITION_STATES.CLOSING;
    let drained = runner === null;
    let clientClosed = clientLifecycle === null;
    if (runner) {
      try {
        drained = await drainExecutions();
        if (!drained) {
          lastCloseFailureCode =
            CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.DRAIN_FAILED;
        }
      } catch {
        drained = false;
        lastCloseFailureCode =
          CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.DRAIN_FAILED;
      }
    }
    if (clientLifecycle) {
      try {
        const closeReceipt = await callAsyncPort(clientLifecycle, 'close');
        clientClosed = confirmedClientClose(closeReceipt);
        if (!clientClosed) {
          lastCloseFailureCode =
            CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.CLIENT_CLOSE_FAILED;
        }
      } catch {
        clientClosed = false;
        lastCloseFailureCode =
          CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.CLIENT_CLOSE_FAILED;
      }
    }
    state = CANARY_EDIT_RUNTIME_COMPOSITION_STATES.CLOSED;
    reason = CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.CLOSED;
    return Object.freeze({
      schemaVersion: CANARY_EDIT_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION,
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
    version: CANARY_EDIT_RUNTIME_COMPOSITION_VERSION,
    canaryEditRunner,
    evidenceSink: ledger ? ledger.evidenceSink : null,
    reconciliationSink: ledger ? ledger.reconciliationSink : null,
    manualRollback,
    snapshot,
    advancement,
    diagnostics,
    close,
  });
}

function unavailableRuntime({
  state,
  reason,
  runtimeConfig = null,
  adapterEnabled = false,
  clientLifecycle = null,
}) {
  return createRuntimePort({
    initialState: state,
    initialReason: reason,
    runtimeConfig,
    adapterEnabled,
    clientLifecycle,
  });
}

function createCanaryEditRuntimeComposition(options = {}) {
  const fields = dataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS);
  if (!fields || typeof fields.get('adapterEnabled') !== 'boolean') {
    return unavailableRuntime({
      state: CANARY_EDIT_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.INVALID_OPTIONS,
    });
  }
  const adapterEnabled = fields.get('adapterEnabled');
  const runtimeConfig = normalizeRuntimeConfig(fields.get('runtimeConfig'));
  if (!runtimeConfig) {
    return unavailableRuntime({
      state: CANARY_EDIT_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.INVALID_RUNTIME_CONFIG,
      adapterEnabled,
    });
  }
  if (runtimeConfig.killSwitch || runtimeConfig.fallbackReason === 'kill_switch') {
    return unavailableRuntime({
      state: CANARY_EDIT_RUNTIME_COMPOSITION_STATES.DISABLED,
      reason: CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.KILL_SWITCH,
      runtimeConfig,
      adapterEnabled,
    });
  }
  if (!['canary', 'on'].includes(runtimeConfig.configuredMode)) {
    return unavailableRuntime({
      state: CANARY_EDIT_RUNTIME_COMPOSITION_STATES.DISABLED,
      reason: CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.MODE_NOT_CANARY,
      runtimeConfig,
      adapterEnabled,
    });
  }
  if (!adapterEnabled) {
    return unavailableRuntime({
      state: CANARY_EDIT_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.ADAPTER_DISABLED,
      runtimeConfig,
      adapterEnabled,
    });
  }
  const requiredAuthorities = [
    ['authoritativeKernel', 'AUTHORITATIVE_KERNEL_UNAVAILABLE'],
    ['admissionFactsProvider', 'ADMISSION_FACTS_PROVIDER_UNAVAILABLE'],
    ['cohortSeed', 'COHORT_SEED_UNAVAILABLE'],
    ['workspaceSessionPort', 'WORKSPACE_SESSION_UNAVAILABLE'],
    ['canaryEditor', 'CANARY_EDITOR_UNAVAILABLE'],
    ['promotionBackend', 'PROMOTION_BACKEND_UNAVAILABLE'],
    ['evidenceJournal', 'EVIDENCE_JOURNAL_UNAVAILABLE'],
    ['manualRollbackJournal', 'MANUAL_ROLLBACK_JOURNAL_UNAVAILABLE'],
    ['client', 'CLIENT_UNAVAILABLE'],
  ];
  for (const [fieldName, reasonName] of requiredAuthorities) {
    const value = fields.has(fieldName) ? fields.get(fieldName) : null;
    if (value === null || value === undefined || value === '') {
      return unavailableRuntime({
        state: CANARY_EDIT_RUNTIME_COMPOSITION_STATES.BLOCKED,
        reason: CANARY_EDIT_RUNTIME_COMPOSITION_REASONS[reasonName],
        runtimeConfig,
        adapterEnabled,
      });
    }
  }
  let clientLifecycle;
  try {
    clientLifecycle = captureClientLifecycle(fields.get('client'));
  } catch {
    return unavailableRuntime({
      state: CANARY_EDIT_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.COMPOSITION_FAILED,
      runtimeConfig,
      adapterEnabled,
    });
  }
  if (readClientState(clientLifecycle) !== 'ready') {
    return unavailableRuntime({
      state: CANARY_EDIT_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.CLIENT_NOT_READY,
      runtimeConfig,
      adapterEnabled,
      clientLifecycle,
    });
  }

  try {
    const rolloutSelector = createCanaryRolloutSelector({
      cohortSeed: fields.get('cohortSeed'),
    });
    const ledgerOptions = {};
    if (fields.has('minimumCanaryJobs')) {
      ledgerOptions.minimumCanaryJobs = fields.get('minimumCanaryJobs');
    }
    if (fields.has('minimumBaselineJobs')) {
      ledgerOptions.minimumBaselineJobs = fields.get('minimumBaselineJobs');
    }
    ledgerOptions.evidenceJournal = fields.get('evidenceJournal');
    const ledger = createCanaryRolloutEvidenceLedger(ledgerOptions);
    const rolloutEvidenceObserver =
      createCanaryRolloutEvidenceObserverAdapter({
        admissionFactsProvider: fields.get('admissionFactsProvider'),
        rolloutSelector,
        evidenceSink: ledger.evidenceSink,
      });
    const promotionController = createCanaryPromotionController({
      backend: fields.get('promotionBackend'),
    });
    if (promotionController.version !== CANARY_PROMOTION_CONTROLLER_VERSION) {
      throw new TypeError('promotion controller version mismatch');
    }
    const manualRollbackService = createCanaryManualRollbackService({
      promotionController,
      reconciliationSink: ledger.reconciliationSink,
      registrationJournal: fields.get('manualRollbackJournal'),
    });
    const canaryKernelId = ownDataValue(
      fields.get('canaryEditor'),
      'kernelId'
    );
    const executor = createCanaryTransactionalStagingExecutor({
      kernelId: canaryKernelId,
      workspaceSessionPort: fields.get('workspaceSessionPort'),
      canaryEditor: fields.get('canaryEditor'),
      promotionController,
      promotionSink: manualRollbackService.promotionSink,
    });
    const unobservedRunner = createCanaryEditRunner({
      authoritativeKernel: fields.get('authoritativeKernel'),
      admissionFactsProvider: rolloutEvidenceObserver.admissionFactsProvider,
      rolloutSelector: rolloutEvidenceObserver.rolloutSelector,
      stagedCanaryExecutor: executor,
    });
    const runner = rolloutEvidenceObserver.observeRunner(unobservedRunner);
    return createRuntimePort({
      initialState: CANARY_EDIT_RUNTIME_COMPOSITION_STATES.READY,
      initialReason: CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.READY,
      runtimeConfig,
      adapterEnabled,
      runner,
      executor,
      ledger,
      manualRollbackService,
      rolloutEvidenceObserver,
      clientLifecycle,
    });
  } catch {
    return unavailableRuntime({
      state: CANARY_EDIT_RUNTIME_COMPOSITION_STATES.BLOCKED,
      reason: CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.COMPOSITION_FAILED,
      runtimeConfig,
      adapterEnabled,
      clientLifecycle,
    });
  }
}

module.exports = {
  CANARY_EDIT_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION,
  CANARY_EDIT_RUNTIME_COMPOSITION_REASONS,
  CANARY_EDIT_RUNTIME_COMPOSITION_STATES,
  CANARY_EDIT_RUNTIME_COMPOSITION_VERSION,
  createCanaryEditRuntimeComposition,
};
