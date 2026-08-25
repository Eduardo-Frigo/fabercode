'use strict';

const util = require('util');

const {
  createCanaryEditRuntimeComposition,
} = require('../agent_runtime/canary_edit_runtime_composition');
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
  'client',
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

function createCanaryEditProductionRuntime(options = {}) {
  const fields = exactDataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS);
  if (!fields || typeof fields.get('adapterEnabled') !== 'boolean') {
    throw new TypeError('Invalid canary edit production runtime options');
  }

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
  const promotionBackend = createCanaryLocalPromotionBackend();
  const runtimeOptions = {
    runtimeConfig: fields.get('runtimeConfig'),
    adapterEnabled: fields.get('adapterEnabled'),
    authoritativeKernel: fields.get('authoritativeKernel'),
    admissionFactsProvider,
    cohortSeed: fields.get('cohortSeed'),
    workspaceSessionPort,
    canaryEditor,
    promotionBackend,
    client: fields.get('client'),
  };
  if (fields.has('minimumCanaryJobs')) {
    runtimeOptions.minimumCanaryJobs = fields.get('minimumCanaryJobs');
  }
  if (fields.has('minimumBaselineJobs')) {
    runtimeOptions.minimumBaselineJobs = fields.get('minimumBaselineJobs');
  }
  const runtime = createCanaryEditRuntimeComposition(runtimeOptions);

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
    });
  }

  function close() {
    return runtime.close();
  }

  return Object.freeze({
    version: CANARY_EDIT_PRODUCTION_RUNTIME_VERSION,
    canaryEditRunner: runtime.canaryEditRunner,
    evidenceSink: runtime.evidenceSink,
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
