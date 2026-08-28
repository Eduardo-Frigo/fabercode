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
const {
  DEFAULT_ON_ROLLOUT_POLICY_VERSION,
  DEFAULT_ON_ROLLOUT_REASONS,
  DEFAULT_ON_ROLLOUT_SNAPSHOT_SCHEMA_VERSION,
} = require('./default_on_rollout_policy');
const {
  DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION,
} = require('./default_on_rollout_safety_interlock');

const SAFE_ROLLOUT_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const DEFAULT_ON_FACT_KEYS = Object.freeze([
  'projectPin',
  'allowlisted',
  'approvedCohort',
]);
const DEFAULT_ON_SNAPSHOT_KEYS = Object.freeze([
  'schemaVersion',
  'policyVersion',
  'jobId',
  'projectId',
  'canonicalRootPath',
  'selectedKernel',
  'reason',
  'flags',
  'releaseGate',
  'policyDigest',
]);
const DEFAULT_ON_FLAG_KEYS = Object.freeze([
  'configuredMode',
  'killSwitch',
  'projectPin',
  'allowlisted',
  'approvedCohort',
]);
const DEFAULT_ON_RELEASE_GATE_KEYS = Object.freeze([
  'minimumStableVersions',
  'stableVersionCount',
  'satisfied',
]);
const DEFAULT_ON_SAFETY_PORT_KEYS = Object.freeze([
  'version',
  'begin',
  'finish',
  'trip',
  'diagnostics',
]);
const DEFAULT_ON_SAFETY_BEGIN_RECEIPT_KEYS = Object.freeze([
  'ok',
  'allowed',
  'idempotent',
  'jobId',
  'reason',
]);
const DEFAULT_ON_SAFETY_FINISH_RECEIPT_KEYS = Object.freeze([
  'ok',
  'finished',
  'jobId',
]);
const DEFAULT_ON_REASON_VALUES = new Set(
  Object.values(DEFAULT_ON_ROLLOUT_REASONS)
);

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

function inspectableSynchronousFunction(value, fieldName) {
  const inspected = inspectableFunction(value, fieldName);
  if (util.types.isAsyncFunction(inspected)) {
    throw new TypeError(`${fieldName} must be synchronous`);
  }
  return inspected;
}

function exactDataFields(value, expectedKeys, { frozen = false } = {}) {
  if (!isPlainRecord(value) || frozen && !Object.isFrozen(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || !expectedKeys.includes(key))
    || expectedKeys.some((key) => !keys.includes(key))) return null;
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
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : null;
}

function callSynchronous(callback, receiver, args, fieldName) {
  let result;
  try {
    result = Reflect.apply(callback, receiver, args);
  } catch (error) {
    throw error;
  }
  if (util.types.isPromise(result)) {
    try {
      Reflect.apply(Promise.prototype.then, result, [() => {}, () => {}]);
    } catch {
      // The invalid asynchronous contract remains fail closed.
    }
    throw new TypeError(`${fieldName} must be synchronous`);
  }
  return result;
}

function captureDefaultOnRolloutPolicy(value) {
  if (value === null || value === undefined) return null;
  const fields = exactDataFields(
    value,
    ['version', 'capture', 'get', 'diagnostics'],
    { frozen: true }
  );
  if (!fields
    || fields.get('version') !== DEFAULT_ON_ROLLOUT_POLICY_VERSION) {
    throw new TypeError('defaultOnRolloutPolicy must be a frozen policy port');
  }
  const capture = inspectableSynchronousFunction(
    fields.get('capture'),
    'defaultOnRolloutPolicy.capture'
  );
  inspectableSynchronousFunction(
    fields.get('get'),
    'defaultOnRolloutPolicy.get'
  );
  const diagnostics = inspectableSynchronousFunction(
    fields.get('diagnostics'),
    'defaultOnRolloutPolicy.diagnostics'
  );
  const diagnosticValue = callSynchronous(
    diagnostics,
    value,
    [],
    'defaultOnRolloutPolicy.diagnostics'
  );
  const diagnosticFields = inspectFrozenDiagnostics(
    diagnosticValue,
    'defaultOnRolloutPolicy.diagnostics'
  );
  if (diagnosticFields.get('version') !== DEFAULT_ON_ROLLOUT_POLICY_VERSION
    || typeof diagnosticFields.get('stabilityGateSatisfied') !== 'boolean') {
    throw new TypeError('defaultOnRolloutPolicy diagnostics are invalid');
  }
  return Object.freeze({
    receiver: value,
    capture,
    stabilityGateSatisfied: diagnosticFields.get('stabilityGateSatisfied'),
  });
}

function captureDefaultOnSafetyInterlock(value) {
  if (value === null || value === undefined) return null;
  const fields = exactDataFields(
    value,
    DEFAULT_ON_SAFETY_PORT_KEYS,
    { frozen: true }
  );
  if (!fields
    || fields.get('version')
      !== DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION) {
    throw new TypeError(
      'defaultOnSafetyInterlock must be a frozen safety port'
    );
  }
  const begin = inspectableSynchronousFunction(
    fields.get('begin'),
    'defaultOnSafetyInterlock.begin'
  );
  const finish = inspectableSynchronousFunction(
    fields.get('finish'),
    'defaultOnSafetyInterlock.finish'
  );
  inspectableFunction(fields.get('trip'), 'defaultOnSafetyInterlock.trip');
  const diagnostics = inspectableSynchronousFunction(
    fields.get('diagnostics'),
    'defaultOnSafetyInterlock.diagnostics'
  );
  const diagnosticFields = inspectFrozenDiagnostics(callSynchronous(
    diagnostics,
    value,
    [],
    'defaultOnSafetyInterlock.diagnostics'
  ), 'defaultOnSafetyInterlock.diagnostics');
  if (diagnosticFields.get('version')
      !== DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION
    || !['armed', 'tripped'].includes(diagnosticFields.get('state'))
    || !Number.isSafeInteger(diagnosticFields.get('activeJobs'))
    || diagnosticFields.get('activeJobs') < 0) {
    throw new TypeError('defaultOnSafetyInterlock diagnostics are invalid');
  }
  return Object.freeze({ receiver: value, begin, finish });
}

function beginDefaultOnSafetyExecution(port, snapshot) {
  const registration = Object.freeze({
    jobId: snapshot.jobId,
    projectId: snapshot.projectId,
    canonicalRootPath: snapshot.canonicalRootPath,
    policyDigest: snapshot.policyDigest,
  });
  const receipt = callSynchronous(
    port.begin,
    port.receiver,
    [registration],
    'defaultOnSafetyInterlock.begin'
  );
  const fields = exactDataFields(
    receipt,
    DEFAULT_ON_SAFETY_BEGIN_RECEIPT_KEYS,
    { frozen: true }
  );
  if (!fields || fields.get('ok') !== true
    || typeof fields.get('allowed') !== 'boolean'
    || typeof fields.get('idempotent') !== 'boolean'
    || fields.get('jobId') !== snapshot.jobId
    || typeof fields.get('reason') !== 'string') {
    throw new TypeError('defaultOnSafetyInterlock.begin returned invalid data');
  }
  if (fields.get('allowed') !== true) {
    throw new Error('Default-on safety interlock blocked V2 execution');
  }
  return registration;
}

function finishDefaultOnSafetyExecution(port, registration) {
  const completion = Object.freeze({
    jobId: registration.jobId,
    policyDigest: registration.policyDigest,
  });
  const receipt = callSynchronous(
    port.finish,
    port.receiver,
    [completion],
    'defaultOnSafetyInterlock.finish'
  );
  const fields = exactDataFields(
    receipt,
    DEFAULT_ON_SAFETY_FINISH_RECEIPT_KEYS,
    { frozen: true }
  );
  if (!fields || fields.get('ok') !== true
    || fields.get('finished') !== true
    || fields.get('jobId') !== registration.jobId) {
    throw new Error('Default-on safety interlock finish was not confirmed');
  }
}

function normalizeDefaultOnFacts(value) {
  const fields = exactDataFields(value, DEFAULT_ON_FACT_KEYS, { frozen: true });
  if (!fields || ![null, 'legacy', 'v2'].includes(fields.get('projectPin'))
    || typeof fields.get('allowlisted') !== 'boolean'
    || typeof fields.get('approvedCohort') !== 'boolean') return null;
  return Object.freeze({
    projectPin: fields.get('projectPin'),
    allowlisted: fields.get('allowlisted'),
    approvedCohort: fields.get('approvedCohort'),
  });
}

function validateDefaultOnSnapshot(value, expected) {
  const fields = exactDataFields(value, DEFAULT_ON_SNAPSHOT_KEYS, { frozen: true });
  const flags = fields && exactDataFields(
    fields.get('flags'),
    DEFAULT_ON_FLAG_KEYS,
    { frozen: true }
  );
  const releaseGate = fields && exactDataFields(
    fields.get('releaseGate'),
    DEFAULT_ON_RELEASE_GATE_KEYS,
    { frozen: true }
  );
  if (!fields || !flags || !releaseGate
    || fields.get('schemaVersion') !== DEFAULT_ON_ROLLOUT_SNAPSHOT_SCHEMA_VERSION
    || fields.get('policyVersion') !== DEFAULT_ON_ROLLOUT_POLICY_VERSION
    || fields.get('jobId') !== expected.jobId
    || fields.get('projectId') !== expected.projectId
    || fields.get('canonicalRootPath') !== expected.canonicalRootPath
    || !['legacy', 'v2'].includes(fields.get('selectedKernel'))
    || !DEFAULT_ON_REASON_VALUES.has(fields.get('reason'))
    || !SHA256_DIGEST.test(fields.get('policyDigest'))
    || flags.get('configuredMode') !== expected.configuredMode
    || flags.get('killSwitch') !== expected.killSwitch
    || flags.get('projectPin') !== expected.projectPin
    || flags.get('allowlisted') !== expected.allowlisted
    || flags.get('approvedCohort') !== expected.approvedCohort
    || releaseGate.get('minimumStableVersions') !== 2
    || !Number.isSafeInteger(releaseGate.get('stableVersionCount'))
    || releaseGate.get('stableVersionCount') < 0
    || typeof releaseGate.get('satisfied') !== 'boolean') {
    throw new TypeError('defaultOnRolloutPolicy returned an invalid snapshot');
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
  defaultOnRolloutPolicy = null,
  defaultOnSafetyInterlock = null,
  legacyKernel,
  persistDefaultOnRolloutSnapshot = null,
  resolveDefaultOnRolloutFacts = null,
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
  const capturedDefaultOnRolloutPolicy = captureDefaultOnRolloutPolicy(
    defaultOnRolloutPolicy
  );
  const capturedDefaultOnSafetyInterlock = captureDefaultOnSafetyInterlock(
    defaultOnSafetyInterlock
  );
  const suppliedDefaultOnDependencies = [
    capturedDefaultOnRolloutPolicy,
    capturedDefaultOnSafetyInterlock,
    resolveDefaultOnRolloutFacts,
    persistDefaultOnRolloutSnapshot,
  ].filter((value) => value !== null && value !== undefined).length;
  if (suppliedDefaultOnDependencies !== 0 && suppliedDefaultOnDependencies !== 4) {
    throw new TypeError('Default-on rollout dependencies must be supplied together');
  }
  const capturedResolveDefaultOnRolloutFacts = suppliedDefaultOnDependencies === 4
    ? inspectableSynchronousFunction(
      resolveDefaultOnRolloutFacts,
      'resolveDefaultOnRolloutFacts'
    )
    : null;
  const capturedPersistDefaultOnRolloutSnapshot = suppliedDefaultOnDependencies === 4
    ? inspectableSynchronousFunction(
      persistDefaultOnRolloutSnapshot,
      'persistDefaultOnRolloutSnapshot'
    )
    : null;
  const shadowActive = resolvedRuntimeConfig.configuredMode === 'shadow'
    && capturedShadowPlanRunner !== null;
  const canaryActive = resolvedRuntimeConfig.configuredMode === 'canary'
    && capturedCanaryEditRunner !== null;
  const defaultOnConfigured = resolvedRuntimeConfig.configuredMode === 'on'
    && capturedCanaryEditRunner !== null
    && suppliedDefaultOnDependencies === 4;
  const defaultOnActive = defaultOnConfigured
    && capturedDefaultOnRolloutPolicy.stabilityGateSatisfied;

  function captureAndPersistDefaultOnSnapshot(request) {
    const executionContext = ownDataValue(request, 'executionContext');
    const projectInfo = ownDataValue(request, 'projectInfo');
    const jobId = ownDataValue(executionContext, 'jobId');
    const projectId = ownDataValue(projectInfo, 'id')
      || ownDataValue(projectInfo, 'projectId');
    const canonicalRootPath = ownDataValue(projectInfo, 'rootPath');
    if (typeof jobId !== 'string' || !SAFE_ROLLOUT_IDENTIFIER.test(jobId)
      || typeof projectId !== 'string'
      || !SAFE_ROLLOUT_IDENTIFIER.test(projectId)
      || typeof canonicalRootPath !== 'string'
      || !canonicalRootPath) {
      throw new TypeError('Default-on rollout requires exact job and project identities');
    }
    const identity = Object.freeze({
      jobId,
      projectId,
      rootPath: canonicalRootPath,
    });
    const facts = normalizeDefaultOnFacts(callSynchronous(
      capturedResolveDefaultOnRolloutFacts,
      undefined,
      [identity],
      'resolveDefaultOnRolloutFacts'
    ));
    if (!facts) {
      throw new TypeError('resolveDefaultOnRolloutFacts returned invalid facts');
    }
    const expected = Object.freeze({
      jobId,
      projectId,
      canonicalRootPath,
      configuredMode: resolvedRuntimeConfig.configuredMode,
      killSwitch: resolvedRuntimeConfig.killSwitch,
      ...facts,
    });
    const snapshot = validateDefaultOnSnapshot(callSynchronous(
      capturedDefaultOnRolloutPolicy.capture,
      capturedDefaultOnRolloutPolicy.receiver,
      [expected],
      'defaultOnRolloutPolicy.capture'
    ), expected);
    const persisted = callSynchronous(
      capturedPersistDefaultOnRolloutSnapshot,
      undefined,
      [jobId, snapshot],
      'persistDefaultOnRolloutSnapshot'
    );
    if (ownDataValue(persisted, 'ok') !== true) {
      throw new Error('Default-on rollout checkpoint persistence failed');
    }
    return snapshot;
  }

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
      const defaultOnSnapshot = defaultOnActive
        ? captureAndPersistDefaultOnSnapshot(kernelRequest)
        : null;
      if (canaryActive) {
        result = await callCanaryEditRunner(capturedCanaryEditRunner, kernelRequest);
        expectedKernelIds = [
          legacyKernel.id,
          capturedCanaryEditRunner.canaryKernelId,
        ];
      } else if (defaultOnSnapshot
        && defaultOnSnapshot.selectedKernel === 'v2') {
        const safetyRegistration = beginDefaultOnSafetyExecution(
          capturedDefaultOnSafetyInterlock,
          defaultOnSnapshot
        );
        try {
          result = await callCanaryEditRunner(
            capturedCanaryEditRunner,
            kernelRequest
          );
          expectedKernelIds = [
            legacyKernel.id,
            capturedCanaryEditRunner.canaryKernelId,
          ];
        } finally {
          finishDefaultOnSafetyExecution(
            capturedDefaultOnSafetyInterlock,
            safetyRegistration
          );
        }
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
        : defaultOnActive
          ? 'on'
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
    } else if (defaultOnActive) {
      reason = 'default_on_active';
    } else if (configuredMode === legacyMode) {
      reason = 'legacy_default';
    } else if (configuredMode === 'shadow') {
      reason = 'shadow_runner_unavailable';
    } else if (configuredMode === 'canary') {
      reason = 'canary_runner_unavailable';
    } else if (configuredMode === 'on' && defaultOnConfigured) {
      reason = 'default_on_stability_gate_not_met';
    } else {
      reason = 'phase_9_not_promoted';
    }
    return {
      ok: true,
      runtimeConfig: resolvedRuntimeConfig,
      requestedMode: resolvedRuntimeConfig.requestedMode || configuredMode,
      configuredMode,
      effectiveMode,
      activeKernelId: canaryActive || defaultOnActive
        ? capturedCanaryEditRunner.canaryKernelId
        : legacyKernel.id,
      canaryKernelId: canaryActive || defaultOnActive
        ? capturedCanaryEditRunner.canaryKernelId
        : null,
      shadowKernelId: shadowActive
        ? capturedShadowPlanRunner.shadowKernelId
        : null,
      fallbackActive: configFallbackActive || configuredMode !== effectiveMode,
      reason,
      kernel: getKernelDiagnostics(legacyKernel),
      canaryKernel: canaryActive || defaultOnActive
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
