'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');
const {
  areEquivalentPortablePaths,
} = require('../capabilities/sandbox_backend_contract');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');
const {
  CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION,
  CANARY_EDIT_ACTION_CLASSIFIER_VERSION,
  classifyCanaryEditAction,
} = require('../agent_runtime/canary_edit_action_classifier');
const {
  CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION,
  CANARY_EDIT_ADMISSION_POLICY_VERSION,
  evaluateCanaryEditAdmission,
} = require('../agent_runtime/canary_edit_admission_policy');
const {
  CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
  CANARY_ROLLOUT_EVIDENCE_SINK_VERSION,
} = require('./canary_rollout_evidence_ledger');
const {
  CANARY_ROLLOUT_DECISION_SCHEMA_VERSION,
  CANARY_ROLLOUT_SELECTOR_VERSION,
  CANARY_ROLLOUT_STAGES,
} = require('./canary_rollout_selector');
const {
  MAX_WRITE_SET_ENTRIES,
} = require('./canary_staging_write_set_contract');
const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
} = require('./harness_contracts');

const CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_VERSION =
  'canary-rollout-evidence-observer-adapter.v1';

const CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_REASONS = Object.freeze({
  EVIDENCE_REJECTED: 'CANARY_ROLLOUT_EVIDENCE_OBSERVER_EVIDENCE_REJECTED',
  OBSERVATION_INCOMPLETE:
    'CANARY_ROLLOUT_EVIDENCE_OBSERVER_OBSERVATION_INCOMPLETE',
});

const OPTION_KEYS = Object.freeze([
  'admissionFactsProvider',
  'rolloutSelector',
  'evidenceSink',
]);
const FACTS_PROVIDER_KEYS = Object.freeze([
  'version',
  'inspect',
  'diagnostics',
]);
const FACTS_DIAGNOSTIC_KEYS = Object.freeze([
  'version',
  'authorityMode',
  'checkpointMode',
  'mutationObservation',
  'rolloutPolicy',
  'failureMode',
]);
const ROLLOUT_SELECTOR_KEYS = Object.freeze([
  'version',
  'select',
  'diagnostics',
]);
const EVIDENCE_SINK_KEYS = Object.freeze(['version', 'record']);
const RUNNER_KEYS = Object.freeze(['version', 'execute', 'diagnostics']);
const RESULT_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'operation',
  'kernelId',
  'output',
  'diagnostics',
]);
const CANARY_OUTPUT_KEYS = Object.freeze([
  'status',
  'mutationScope',
  'changedPaths',
  'writeSetDigest',
]);
const AUTHORITY_BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const FACT_KEYS = Object.freeze([
  'projectAuthorized',
  'checkpoint',
  'rootMutation',
  'rollout',
]);
const ROLLOUT_FACT_KEYS = Object.freeze([
  'killSwitch',
  'projectPin',
  'allowlisted',
  'internal',
  'rolloutStage',
]);
const ROLLOUT_DECISION_KEYS = Object.freeze([
  'schemaVersion',
  'selectorVersion',
  'selected',
  'reason',
  'rolloutStage',
  'thresholdBasisPoints',
  'cohortBasisPoints',
]);
const ADMISSION_DECISION_KEYS = Object.freeze([
  'schemaVersion',
  'policyVersion',
  'eligible',
  'reason',
  'prerequisites',
]);
const VALID_ROLLOUT_STAGES = new Set(Object.values(CANARY_ROLLOUT_STAGES));
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const PROTECTED_PATH =
  /(?:^|\/)(?:\.git|\.faber|node_modules|\.env(?:\..*)?)(?:\/|$)/i;
const MAX_RELATIVE_PATH_BYTES = 4096;

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

function dataFields(value, expectedKeys, {
  exact = true,
  frozen = false,
} = {}) {
  if (!isPlainRecord(value) || frozen && !Object.isFrozen(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (exact && keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
    || exact && expectedKeys.some((key) => !keys.includes(key))) return null;
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

function ownDataValue(value, key, { enumerable = null } = {}) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return null;
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || descriptor.value === undefined
    || enumerable !== null && descriptor.enumerable !== enumerable) return null;
  return descriptor.value;
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

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [
      () => undefined,
      () => undefined,
    ]);
  } catch {
    // A malformed native Promise remains rejected by the synchronous port.
  }
  return true;
}

function callSynchronousPort(port, methodName, args) {
  return Reflect.apply(port[methodName], port.receiver, args);
}

function inspectFactsDiagnostics(port) {
  let value;
  try {
    value = callSynchronousPort(port, 'diagnostics', []);
  } catch {
    throw new TypeError('admissionFactsProvider.diagnostics failed');
  }
  const fields = dataFields(value, FACTS_DIAGNOSTIC_KEYS, { frozen: true });
  if (absorbNativePromise(value) || !fields
    || fields.get('version') !== port.version
    || fields.get('authorityMode') !== 'exact_job_action_root'
    || fields.get('checkpointMode') !== 'authority_bound'
    || fields.get('mutationObservation') !== 'external_exact'
    || fields.get('rolloutPolicy') !== 'external_exact'
    || fields.get('failureMode') !== 'deny') {
    throw new TypeError('admissionFactsProvider diagnostics are invalid');
  }
  return value;
}

function captureFactsProvider(value) {
  const fields = dataFields(value, FACTS_PROVIDER_KEYS, { frozen: true });
  const version = fields && fields.get('version');
  if (!fields || typeof version !== 'string' || !SAFE_IDENTIFIER.test(version)) {
    throw new TypeError('admissionFactsProvider is invalid');
  }
  const port = Object.freeze({
    receiver: value,
    version,
    inspect: inspectableFunction(
      fields.get('inspect'),
      'admissionFactsProvider.inspect'
    ),
    diagnostics: inspectableFunction(
      fields.get('diagnostics'),
      'admissionFactsProvider.diagnostics'
    ),
  });
  inspectFactsDiagnostics(port);
  return port;
}

function captureRolloutSelector(value) {
  const fields = dataFields(value, ROLLOUT_SELECTOR_KEYS, { frozen: true });
  if (!fields || fields.get('version') !== CANARY_ROLLOUT_SELECTOR_VERSION) {
    throw new TypeError('rolloutSelector is invalid');
  }
  return Object.freeze({
    receiver: value,
    version: fields.get('version'),
    select: inspectableFunction(fields.get('select'), 'rolloutSelector.select'),
    diagnostics: inspectableFunction(
      fields.get('diagnostics'),
      'rolloutSelector.diagnostics'
    ),
  });
}

function captureEvidenceSink(value) {
  const fields = dataFields(value, EVIDENCE_SINK_KEYS, { frozen: true });
  if (!fields
    || fields.get('version') !== CANARY_ROLLOUT_EVIDENCE_SINK_VERSION) {
    throw new TypeError('evidenceSink is invalid');
  }
  return Object.freeze({
    receiver: value,
    version: fields.get('version'),
    record: inspectableFunction(fields.get('record'), 'evidenceSink.record'),
  });
}

function captureDependencies(options) {
  const fields = dataFields(options, OPTION_KEYS);
  if (!fields) {
    throw new TypeError('Invalid canary rollout evidence observer options');
  }
  try {
    return Object.freeze({
      admissionFactsProvider: captureFactsProvider(
        fields.get('admissionFactsProvider')
      ),
      rolloutSelector: captureRolloutSelector(fields.get('rolloutSelector')),
      evidenceSink: captureEvidenceSink(fields.get('evidenceSink')),
    });
  } catch {
    throw new TypeError('Invalid canary rollout evidence observer options');
  }
}

function bindingsMatch(left, right) {
  return AUTHORITY_BINDING_KEYS.every((key) => left[key] === right[key]);
}

function inspectRequest(value) {
  try {
    assertHarnessRequest(value);
  } catch {
    return null;
  }
  if (!Object.isFrozen(value) || value.operation !== HARNESS_OPERATIONS.EXECUTE
    || typeof value.requestId !== 'string'
    || !SAFE_IDENTIFIER.test(value.requestId)) return null;
  const executionContext = ownDataValue(value, 'executionContext', {
    enumerable: true,
  });
  const rawBinding = executionContext && ownDataValue(
    executionContext,
    'authorityBinding',
    { enumerable: false }
  );
  if (!isPlainRecord(executionContext) || !Object.isFrozen(executionContext)
    || !rawBinding || !Object.isFrozen(rawBinding)) return null;
  let binding;
  try {
    binding = createCapabilityDelegationBinding(rawBinding);
  } catch {
    return null;
  }
  if (!bindingsMatch(binding, rawBinding)
    || ownDataValue(executionContext, 'jobId', { enumerable: true })
      !== binding.jobId) return null;
  const projectInfo = ownDataValue(value, 'projectInfo', { enumerable: true });
  const id = projectInfo && ownDataValue(projectInfo, 'id', {
    enumerable: true,
  });
  const projectIdAlias = projectInfo && ownDataValue(
    projectInfo,
    'projectId',
    { enumerable: true }
  );
  const projectId = typeof id === 'string' ? id : projectIdAlias;
  const rootPath = projectInfo && ownDataValue(projectInfo, 'rootPath', {
    enumerable: true,
  });
  if (!isPlainRecord(projectInfo) || !Object.isFrozen(projectInfo)
    || projectId !== binding.projectId
    || projectIdAlias !== null && projectIdAlias !== binding.projectId
    || !areEquivalentPortablePaths(rootPath, binding.canonicalRootPath)) {
    return null;
  }
  return Object.freeze({
    request: value,
    requestId: value.requestId,
    action: ownDataValue(value, 'action', { enumerable: true }),
    binding,
  });
}

function normalizeFacts(value) {
  const fields = dataFields(value, FACT_KEYS, { frozen: true });
  const rolloutFields = fields && dataFields(
    fields.get('rollout'),
    ROLLOUT_FACT_KEYS,
    { frozen: true }
  );
  if (!fields || !rolloutFields
    || typeof fields.get('projectAuthorized') !== 'boolean'
    || typeof rolloutFields.get('killSwitch') !== 'boolean'
    || ![null, 'legacy', 'canary'].includes(
      rolloutFields.get('projectPin')
    )
    || typeof rolloutFields.get('allowlisted') !== 'boolean'
    || typeof rolloutFields.get('internal') !== 'boolean'
    || !VALID_ROLLOUT_STAGES.has(rolloutFields.get('rolloutStage'))) {
    return null;
  }
  return Object.freeze({ fields, rolloutFields });
}

function normalizeClassification(value, expected) {
  if (!value || !Object.isFrozen(value)) return null;
  try {
    if (canonicalSha256Digest(value) !== canonicalSha256Digest(expected)) {
      return null;
    }
  } catch {
    return null;
  }
  return value.schemaVersion === CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION
    && value.classifierVersion === CANARY_EDIT_ACTION_CLASSIFIER_VERSION
    ? value
    : null;
}

function normalizeRolloutDecision(value, factsSnapshot) {
  const fields = dataFields(value, ROLLOUT_DECISION_KEYS, { frozen: true });
  if (!fields
    || fields.get('schemaVersion') !== CANARY_ROLLOUT_DECISION_SCHEMA_VERSION
    || fields.get('selectorVersion') !== CANARY_ROLLOUT_SELECTOR_VERSION
    || typeof fields.get('selected') !== 'boolean'
    || typeof fields.get('reason') !== 'string'
    || fields.get('rolloutStage')
      !== factsSnapshot.rolloutFields.get('rolloutStage')) return null;
  return value;
}

function inspectEligibility(scope) {
  if (!scope.identity || !scope.facts
    || !scope.classification || !scope.rolloutDecision) return null;
  let expectedClassification;
  try {
    expectedClassification = classifyCanaryEditAction(scope.identity.action);
  } catch {
    return null;
  }
  const classification = normalizeClassification(
    scope.classification,
    expectedClassification
  );
  const factsSnapshot = normalizeFacts(scope.facts);
  const rolloutDecision = factsSnapshot && normalizeRolloutDecision(
    scope.rolloutDecision,
    factsSnapshot
  );
  if (!classification || !factsSnapshot || !rolloutDecision) return null;
  const admissionDecision = evaluateCanaryEditAdmission(Object.freeze({
    runtimeMode: 'canary',
    projectAuthorization: Object.freeze({
      authorized: factsSnapshot.fields.get('projectAuthorized'),
      binding: scope.identity.binding,
    }),
    editProfile: classification.editProfile,
    checkpoint: factsSnapshot.fields.get('checkpoint'),
    rootMutation: factsSnapshot.fields.get('rootMutation'),
  }));
  const admissionFields = dataFields(
    admissionDecision,
    ADMISSION_DECISION_KEYS,
    { frozen: true }
  );
  if (!admissionFields
    || admissionFields.get('schemaVersion')
      !== CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION
    || admissionFields.get('policyVersion')
      !== CANARY_EDIT_ADMISSION_POLICY_VERSION) return null;
  return Object.freeze({
    eligible: admissionFields.get('eligible') === true,
    rolloutStage: factsSnapshot.rolloutFields.get('rolloutStage'),
    route: rolloutDecision.selected === true ? 'canary' : 'baseline',
  });
}

function inspectRunnerDiagnostics(port) {
  let value;
  try {
    value = callSynchronousPort(port, 'diagnostics', []);
  } catch {
    throw new TypeError('runner.diagnostics failed');
  }
  if (absorbNativePromise(value) || !isPlainRecord(value)
    || !Object.isFrozen(value)) {
    throw new TypeError('runner.diagnostics must return frozen data');
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = typeof key === 'string'
      ? Object.getOwnPropertyDescriptor(value, key)
      : null;
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || !['string', 'number', 'boolean'].includes(typeof descriptor.value)
        && descriptor.value !== null) {
      throw new TypeError('runner.diagnostics must contain scalar data');
    }
  }
  if (ownDataValue(value, 'version', { enumerable: true }) !== port.version
    || ownDataValue(value, 'authoritativeKernelId', { enumerable: true })
      !== port.authoritativeKernelId
    || ownDataValue(value, 'canaryKernelId', { enumerable: true })
      !== port.canaryKernelId) {
    throw new TypeError('runner diagnostics identity changed');
  }
  return value;
}

function captureRunner(value) {
  const fields = dataFields(value, RUNNER_KEYS, { frozen: true });
  const version = fields && fields.get('version');
  if (!fields || typeof version !== 'string' || !SAFE_IDENTIFIER.test(version)) {
    throw new TypeError('runner is invalid');
  }
  const execute = inspectableFunction(fields.get('execute'), 'runner.execute');
  const diagnostics = inspectableFunction(
    fields.get('diagnostics'),
    'runner.diagnostics'
  );
  let initial;
  try {
    initial = Reflect.apply(diagnostics, value, []);
  } catch {
    throw new TypeError('runner.diagnostics failed');
  }
  if (absorbNativePromise(initial) || !isPlainRecord(initial)
    || !Object.isFrozen(initial)) {
    throw new TypeError('runner diagnostics identity is invalid');
  }
  const authoritativeKernelId = ownDataValue(
    initial,
    'authoritativeKernelId',
    { enumerable: true }
  );
  const canaryKernelId = ownDataValue(initial, 'canaryKernelId', {
    enumerable: true,
  });
  if (typeof authoritativeKernelId !== 'string'
    || !SAFE_IDENTIFIER.test(authoritativeKernelId)
    || typeof canaryKernelId !== 'string'
    || !SAFE_IDENTIFIER.test(canaryKernelId)
    || authoritativeKernelId === canaryKernelId) {
    throw new TypeError('runner diagnostics identity is invalid');
  }
  const port = Object.freeze({
    receiver: value,
    version,
    authoritativeKernelId,
    canaryKernelId,
    execute,
    diagnostics,
  });
  inspectRunnerDiagnostics(port);
  return port;
}

function inspectResult(value, scope, runner) {
  const fields = dataFields(value, RESULT_KEYS, { frozen: true });
  if (!fields
    || fields.get('schemaVersion') !== HARNESS_RESULT_SCHEMA_VERSION
    || fields.get('requestId') !== scope.identity.requestId
    || fields.get('operation') !== HARNESS_OPERATIONS.EXECUTE
    || ![runner.authoritativeKernelId, runner.canaryKernelId].includes(
      fields.get('kernelId')
    )) return null;
  return fields;
}

function baselineSucceeded(output) {
  return ownDataValue(output, 'ok', { enumerable: true }) === true;
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')
    || value.includes('\\')
    || Buffer.byteLength(value, 'utf8') > MAX_RELATIVE_PATH_BYTES
    || value.startsWith('/') || /^[A-Za-z]:\//.test(value)
    || value.startsWith('//') || PROTECTED_PATH.test(value)) return false;
  return value.split('/').every((component) => component
    && component !== '.' && component !== '..');
}

function inspectChangedPaths(value) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || !Object.isFrozen(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1 || value.length > MAX_WRITE_SET_ENTRIES) return null;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) return null;
  const output = [];
  let previous = null;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const relativePath = descriptor && descriptor.enumerable === true
      && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : null;
    if (!safeRelativePath(relativePath)
      || previous !== null && relativePath <= previous) return null;
    output.push(relativePath);
    previous = relativePath;
  }
  return Object.freeze(output);
}

function canarySucceeded(output) {
  const fields = dataFields(output, CANARY_OUTPUT_KEYS, { frozen: true });
  if (!fields || fields.get('status') !== 'completed'
    || fields.get('mutationScope') !== 'staging'
    || !inspectChangedPaths(fields.get('changedPaths'))) return false;
  let digest;
  try {
    digest = normalizeDigest(fields.get('writeSetDigest'), 'writeSetDigest');
  } catch {
    return false;
  }
  return digest === fields.get('writeSetDigest');
}

function callRunner(port, request) {
  let pending;
  try {
    pending = Reflect.apply(port.execute, port.receiver, [request]);
  } catch (error) {
    return Promise.reject(error);
  }
  if (!util.types.isPromise(pending)) {
    return Promise.reject(new TypeError('runner.execute must return a native Promise'));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, pending, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

function createCanaryRolloutEvidenceObserverAdapter(options = {}) {
  const dependencies = captureDependencies(options);
  const activeScopes = [];
  let observedRunner = null;
  let runnerVersion = null;
  let requests = 0;
  let eligibleObservations = 0;
  let ineligibleObservations = 0;
  let baselineEvidence = 0;
  let canaryEvidence = 0;
  let conservativeFailures = 0;
  let incompleteObservations = 0;
  let evidenceRejections = 0;
  let lastFailureCode = null;

  function currentScope() {
    return activeScopes[activeScopes.length - 1] || null;
  }

  function inspectFacts(request, classification) {
    const value = callSynchronousPort(
      dependencies.admissionFactsProvider,
      'inspect',
      [request, classification]
    );
    const scope = currentScope();
    if (scope && scope.identity && scope.identity.request === request
      && !util.types.isPromise(value)) {
      scope.facts = value;
      scope.classification = classification;
    }
    return value;
  }

  function factsDiagnostics() {
    return callSynchronousPort(
      dependencies.admissionFactsProvider,
      'diagnostics',
      []
    );
  }

  const admissionFactsProvider = Object.freeze({
    version: dependencies.admissionFactsProvider.version,
    inspect: inspectFacts,
    diagnostics: factsDiagnostics,
  });

  function selectRollout(input) {
    const value = callSynchronousPort(
      dependencies.rolloutSelector,
      'select',
      [input]
    );
    const scope = currentScope();
    if (scope && !util.types.isPromise(value)) scope.rolloutDecision = value;
    return value;
  }

  function rolloutDiagnostics() {
    return callSynchronousPort(
      dependencies.rolloutSelector,
      'diagnostics',
      []
    );
  }

  const rolloutSelector = Object.freeze({
    version: dependencies.rolloutSelector.version,
    select: selectRollout,
    diagnostics: rolloutDiagnostics,
  });

  function rejectObservation() {
    incompleteObservations += 1;
    lastFailureCode =
      CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_REASONS.OBSERVATION_INCOMPLETE;
  }

  function settleObservationBestEffort(scope, result, rejection) {
    try {
      settleObservation(scope, result, rejection);
    } catch {
      rejectObservation();
    }
  }

  function recordEvidence(evidence) {
    let result;
    try {
      result = Reflect.apply(
        dependencies.evidenceSink.record,
        dependencies.evidenceSink.receiver,
        [evidence]
      );
    } catch {
      evidenceRejections += 1;
      lastFailureCode =
        CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_REASONS.EVIDENCE_REJECTED;
      return false;
    }
    if (absorbNativePromise(result) || result !== undefined) {
      evidenceRejections += 1;
      lastFailureCode =
        CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_REASONS.EVIDENCE_REJECTED;
      return false;
    }
    if (evidence.route === 'canary') canaryEvidence += 1;
    else baselineEvidence += 1;
    lastFailureCode = null;
    return true;
  }

  function settleObservation(scope, result, rejection) {
    const eligibility = inspectEligibility(scope);
    if (!eligibility) {
      rejectObservation();
      return;
    }
    if (!eligibility.eligible) {
      ineligibleObservations += 1;
      return;
    }
    eligibleObservations += 1;
    let succeeded = false;
    let corrupted = false;
    if (rejection) {
      corrupted = eligibility.route === 'canary';
      if (corrupted) conservativeFailures += 1;
    } else {
      const fields = inspectResult(result, scope, observedRunner);
      if (!fields) {
        rejectObservation();
        return;
      }
      const kernelId = fields.get('kernelId');
      if (eligibility.route === 'baseline') {
        if (kernelId !== observedRunner.authoritativeKernelId) {
          rejectObservation();
          return;
        }
        succeeded = baselineSucceeded(fields.get('output'));
      } else if (kernelId === observedRunner.canaryKernelId) {
        if (!canarySucceeded(fields.get('output'))) {
          rejectObservation();
          return;
        }
        succeeded = true;
      } else if (kernelId !== observedRunner.authoritativeKernelId) {
        rejectObservation();
        return;
      }
    }
    recordEvidence(Object.freeze({
      schemaVersion: CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
      jobId: scope.identity.binding.jobId,
      projectId: scope.identity.binding.projectId,
      rolloutStage: eligibility.rolloutStage,
      route: eligibility.route,
      eligible: true,
      terminal: true,
      succeeded,
      manualRollback: false,
      corrupted,
      dataLossIncident: false,
      securityIncident: false,
      duplicateExternalEffect: false,
    }));
  }

  function observeRunner(value) {
    if (observedRunner) {
      throw new TypeError('canary rollout evidence observer already owns a runner');
    }
    observedRunner = captureRunner(value);
    runnerVersion = observedRunner.version;

    async function execute(request) {
      requests += 1;
      const scope = {
        identity: inspectRequest(request),
        facts: null,
        classification: null,
        rolloutDecision: null,
      };
      let pending;
      activeScopes.push(scope);
      try {
        pending = callRunner(observedRunner, request);
      } finally {
        activeScopes.pop();
      }
      try {
        const result = await pending;
        settleObservationBestEffort(scope, result, null);
        return result;
      } catch (error) {
        settleObservationBestEffort(scope, null, error);
        throw error;
      }
    }

    function runnerDiagnostics() {
      return inspectRunnerDiagnostics(observedRunner);
    }

    return Object.freeze({
      version: observedRunner.version,
      execute,
      diagnostics: runnerDiagnostics,
    });
  }

  function diagnostics() {
    return Object.freeze({
      version: CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_VERSION,
      evidenceSinkVersion: dependencies.evidenceSink.version,
      runnerVersion,
      requests,
      eligibleObservations,
      ineligibleObservations,
      baselineEvidence,
      canaryEvidence,
      conservativeFailures,
      incompleteObservations,
      evidenceRejections,
      lastFailureCode,
    });
  }

  return Object.freeze({
    version: CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_VERSION,
    admissionFactsProvider,
    rolloutSelector,
    observeRunner,
    diagnostics,
  });
}

module.exports = {
  CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_REASONS,
  CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_VERSION,
  createCanaryRolloutEvidenceObserverAdapter,
};
