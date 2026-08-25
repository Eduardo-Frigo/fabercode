'use strict';

const util = require('util');

const {
  createCanaryEditRuntimeComposition,
} = require('../agent_runtime/canary_edit_runtime_composition');
const {
  CANARY_MANUAL_ROLLBACK_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
} = require('../agent_runtime/canary_manual_rollback_journal_contract');
const {
  CANARY_PROMOTION_ROLLBACK_STORE_SNAPSHOT_SCHEMA_VERSION,
} = require('../agent_runtime/canary_promotion_rollback_store_contract');
const {
  createCanaryAdmissionFactsProvider,
} = require('./canary_admission_facts_provider');
const {
  createCanaryLocalPromotionBackend,
} = require('./canary_local_promotion_backend');
const {
  createCanaryLocalStagingEditorAdapter,
} = require('./canary_local_staging_editor_adapter');
const {
  createCanaryEditTerminalObserverAdapter,
} = require('./canary_edit_terminal_observer_adapter');
const {
  createCanarySourceSnapshotProvider,
} = require('./canary_source_snapshot_provider');
const {
  createCanaryWorkspaceSessionPortAdapter,
} = require('./canary_workspace_session_port_adapter');

const CANARY_EDIT_PRODUCTION_RUNTIME_VERSION =
  'canary-edit-production-runtime.v1';
const CANARY_EDIT_PRODUCTION_KERNEL_ID = 'codex-app-server-canary';

const OPTION_KEYS = Object.freeze([
  'runtimeConfig',
  'adapterEnabled',
  'authoritativeKernel',
  'authorityService',
  'projectRootAuthorityRegistry',
  'executionWorkspaceRegistry',
  'inspectRootMutation',
  'inspectRollout',
  'promotionIdFactory',
  'cohortSeed',
  'evidenceJournal',
  'promotionRollbackStore',
  'manualRollbackJournal',
  'client',
  'onCanaryCompleted',
  'onCanaryFailed',
  'minimumCanaryJobs',
  'minimumBaselineJobs',
]);
const REQUIRED_OPTION_KEYS = Object.freeze(OPTION_KEYS.filter(
  (key) => !['minimumCanaryJobs', 'minimumBaselineJobs'].includes(key)
));
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !allowedKeys.includes(key))
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
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) {
    return null;
  }
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch {
    return null;
  }
  return descriptor && descriptor.enumerable === true
    && Object.hasOwn(descriptor, 'value')
    ? descriptor.value : null;
}

function frozenArrayValues(value) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || !Object.isFrozen(value)) return null;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) return null;
  return keys.map((key) => ownDataValue(value, key));
}

function synchronousLoad(port, fieldName) {
  if (!port || typeof port !== 'object' || util.types.isProxy(port)
    || !Object.isFrozen(port)) {
    throw new TypeError(fieldName + ' must be a frozen durable port');
  }
  const load = ownDataValue(port, 'load');
  if (typeof load !== 'function' || util.types.isProxy(load)) {
    throw new TypeError(fieldName + '.load is invalid');
  }
  let snapshot;
  try { snapshot = Reflect.apply(load, port, []); } catch {
    throw new TypeError(fieldName + '.load failed');
  }
  if (util.types.isPromise(snapshot)) {
    snapshot.catch(() => {});
    throw new TypeError(fieldName + '.load must be synchronous');
  }
  return snapshot;
}

function rollbackStorePromotionIds(port) {
  const snapshot = synchronousLoad(port, 'promotionRollbackStore');
  const fields = exactDataFields(snapshot, ['schemaVersion', 'records']);
  const records = fields && Object.isFrozen(snapshot)
    ? frozenArrayValues(fields.get('records')) : null;
  if (!fields || !records
    || fields.get('schemaVersion')
      !== CANARY_PROMOTION_ROLLBACK_STORE_SNAPSHOT_SCHEMA_VERSION) {
    throw new TypeError('promotionRollbackStore snapshot is invalid');
  }
  return records.map((record) => {
    const request = ownDataValue(record, 'request');
    const promotionId = ownDataValue(request, 'promotionId');
    if (typeof promotionId !== 'string' || !promotionId) {
      throw new TypeError('promotionRollbackStore recovery is invalid');
    }
    return promotionId;
  });
}

function manualJournalPromotionIds(port) {
  const snapshot = synchronousLoad(port, 'manualRollbackJournal');
  const fields = exactDataFields(
    snapshot,
    ['schemaVersion', 'registrations']
  );
  const registrations = fields && Object.isFrozen(snapshot)
    ? frozenArrayValues(fields.get('registrations')) : null;
  if (!fields || !registrations
    || fields.get('schemaVersion')
      !== CANARY_MANUAL_ROLLBACK_JOURNAL_SNAPSHOT_SCHEMA_VERSION) {
    throw new TypeError('manualRollbackJournal snapshot is invalid');
  }
  return registrations.map((registration) => {
    const transaction = ownDataValue(registration, 'transaction');
    const request = ownDataValue(transaction, 'request');
    const promotionId = ownDataValue(request, 'promotionId');
    if (typeof promotionId !== 'string' || !promotionId) {
      throw new TypeError('manualRollbackJournal registration is invalid');
    }
    return promotionId;
  });
}

function assertDurableRollbackAlignment(promotionStore, manualJournal) {
  const promotionIds = rollbackStorePromotionIds(promotionStore).sort();
  const registrationIds = manualJournalPromotionIds(manualJournal).sort();
  if (new Set(promotionIds).size !== promotionIds.length
    || new Set(registrationIds).size !== registrationIds.length
    || promotionIds.length !== registrationIds.length
    || promotionIds.some((value, index) => value !== registrationIds[index])) {
    throw new TypeError('Durable manual rollback registrations are misaligned');
  }
}

function createCanaryEditProductionRuntime(options = {}) {
  const fields = exactDataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS);
  if (!fields || typeof fields.get('adapterEnabled') !== 'boolean'
    || typeof fields.get('onCanaryCompleted') !== 'function'
    || typeof fields.get('onCanaryFailed') !== 'function') {
    throw new TypeError('Invalid canary edit production runtime options');
  }

  assertDurableRollbackAlignment(
    fields.get('promotionRollbackStore'),
    fields.get('manualRollbackJournal')
  );

  const admissionFactsProvider = createCanaryAdmissionFactsProvider({
    authorityService: fields.get('authorityService'),
    inspectRootMutation: fields.get('inspectRootMutation'),
    inspectRollout: fields.get('inspectRollout'),
  });
  const sourceSnapshotProvider = createCanarySourceSnapshotProvider();
  const workspaceSessionPort = createCanaryWorkspaceSessionPortAdapter({
    authorityService: fields.get('authorityService'),
    projectRootAuthorityRegistry: fields.get('projectRootAuthorityRegistry'),
    executionWorkspaceRegistry: fields.get('executionWorkspaceRegistry'),
    sourceSnapshotProvider,
    promotionIdFactory: fields.get('promotionIdFactory'),
  });
  const canaryEditor = createCanaryLocalStagingEditorAdapter({
    kernelId: CANARY_EDIT_PRODUCTION_KERNEL_ID,
  });
  const promotionBackend = createCanaryLocalPromotionBackend({
    rollbackStore: fields.get('promotionRollbackStore'),
  });
  const runtimeOptions = {
    runtimeConfig: fields.get('runtimeConfig'),
    adapterEnabled: fields.get('adapterEnabled'),
    authoritativeKernel: fields.get('authoritativeKernel'),
    admissionFactsProvider,
    cohortSeed: fields.get('cohortSeed'),
    workspaceSessionPort,
    canaryEditor,
    promotionBackend,
    evidenceJournal: fields.get('evidenceJournal'),
    manualRollbackJournal: fields.get('manualRollbackJournal'),
    client: fields.get('client'),
  };
  if (fields.has('minimumCanaryJobs')) {
    runtimeOptions.minimumCanaryJobs = fields.get('minimumCanaryJobs');
  }
  if (fields.has('minimumBaselineJobs')) {
    runtimeOptions.minimumBaselineJobs = fields.get('minimumBaselineJobs');
  }
  const runtime = createCanaryEditRuntimeComposition(runtimeOptions);
  const terminalObserver = runtime.canaryEditRunner
    ? createCanaryEditTerminalObserverAdapter({
      runner: runtime.canaryEditRunner,
      onCanaryCompleted: fields.get('onCanaryCompleted'),
      onCanaryFailed: fields.get('onCanaryFailed'),
    })
    : null;

  function snapshot(rolloutStage) {
    return runtime.snapshot(rolloutStage);
  }

  function advancement(rolloutStage) {
    return runtime.advancement(rolloutStage);
  }

  function diagnostics() {
    return Object.freeze({
      version: CANARY_EDIT_PRODUCTION_RUNTIME_VERSION,
      runtime: runtime.diagnostics(),
      admissionFactsProvider: admissionFactsProvider.diagnostics(),
      sourceSnapshotProvider: sourceSnapshotProvider.diagnostics(),
      workspaceSessionPort: workspaceSessionPort.diagnostics(),
      canaryEditor: canaryEditor.diagnostics(),
      promotionBackend: promotionBackend.diagnostics(),
      promotionRollbackStore:
        fields.get('promotionRollbackStore').diagnostics(),
      manualRollbackJournal:
        fields.get('manualRollbackJournal').diagnostics(),
      evidenceJournal: fields.get('evidenceJournal').diagnostics(),
      terminalObserver: terminalObserver ? terminalObserver.diagnostics() : null,
    });
  }

  function close() {
    return runtime.close();
  }

  return Object.freeze({
    version: CANARY_EDIT_PRODUCTION_RUNTIME_VERSION,
    canaryEditRunner: terminalObserver
      ? terminalObserver.canaryEditRunner
      : null,
    evidenceSink: runtime.evidenceSink,
    reconciliationSink: runtime.reconciliationSink,
    manualRollback: runtime.manualRollback,
    snapshot,
    advancement,
    diagnostics,
    close,
  });
}

module.exports = {
  CANARY_EDIT_PRODUCTION_KERNEL_ID,
  CANARY_EDIT_PRODUCTION_RUNTIME_VERSION,
  createCanaryEditProductionRuntime,
};
