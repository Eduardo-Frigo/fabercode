'use strict';

const util = require('util');

const { assertAgentKernel } = require('./agent_kernel');
const {
  CONTEXT_PACK_SURFACES,
  assertContextPackManifest,
} = require('./context_pack_contracts');
const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
} = require('./harness_contracts');
const {
  SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION,
  SHADOW_PLAN_SEMANTIC_VERDICTS,
} = require('./shadow_plan_semantic_comparator');

const SHADOW_PLAN_RUNNER_VERSION = 'shadow-plan-runner.v1';
const DEFAULT_SHADOW_OBSERVATION_TIMEOUT_MS = 65_000;
const DEFAULT_COMPARISON_TIMEOUT_MS = 15_000;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 50_000;
const MAX_STRING_CHARS = 1024 * 1024;

const SHADOW_PLAN_RUNNER_REASONS = Object.freeze({
  COMPARISON_FAILED: 'SHADOW_PLAN_RUNNER_COMPARISON_FAILED',
  COMPARISON_TIMEOUT: 'SHADOW_PLAN_RUNNER_COMPARISON_TIMEOUT',
  INVALID_AUTHORITATIVE_RESULT: 'SHADOW_PLAN_RUNNER_INVALID_AUTHORITATIVE_RESULT',
  INVALID_COMPARISON_REPORT: 'SHADOW_PLAN_RUNNER_INVALID_COMPARISON_REPORT',
  INVALID_REQUEST: 'SHADOW_PLAN_RUNNER_INVALID_REQUEST',
  REPORT_FAILED: 'SHADOW_PLAN_RUNNER_REPORT_FAILED',
  SHADOW_FAILED: 'SHADOW_PLAN_RUNNER_SHADOW_FAILED',
  SHADOW_INVALID_RESULT: 'SHADOW_PLAN_RUNNER_SHADOW_INVALID_RESULT',
  SHADOW_TIMEOUT: 'SHADOW_PLAN_RUNNER_SHADOW_TIMEOUT',
  SNAPSHOT_FAILED: 'SHADOW_PLAN_RUNNER_SNAPSHOT_FAILED',
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const VALID_VERDICTS = new Set(Object.values(SHADOW_PLAN_SEMANTIC_VERDICTS));

class ShadowPlanRunnerError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'ShadowPlanRunnerError';
    this.code = code;
    if (typeof details.causeCode === 'string'
      && /^[A-Z0-9_]{1,128}$/.test(details.causeCode)) {
      this.causeCode = details.causeCode;
    }
  }
}

function runnerError(code, details) {
  return new ShadowPlanRunnerError(code, details);
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

function dataFields(value, fieldName, {
  allowedKeys = null,
  requiredKeys = null,
  frozen = false,
} = {}) {
  if (!isPlainRecord(value) || (frozen && !Object.isFrozen(value))) {
    throw new TypeError(fieldName + ' must be a plain data record');
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(fieldName + ' must be inspectable');
  }
  if (keys.some((key) => typeof key !== 'string'
    || FORBIDDEN_KEYS.has(key)
    || (allowedKeys && !allowedKeys.includes(key)))) {
    throw new TypeError(fieldName + ' has invalid fields');
  }
  if (requiredKeys) {
    const missing = requiredKeys.find((key) => !keys.includes(key));
    if (missing) throw new TypeError(fieldName + ' is missing ' + missing);
  }
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) {
      throw new TypeError(fieldName + ' must contain enumerable data values');
    }
    fields.set(key, descriptor.value);
  }
  return fields;
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

function captureKernel(value, fieldName) {
  try {
    assertAgentKernel(value);
  } catch {
    throw new TypeError(fieldName + ' must implement AgentKernel');
  }
  if (typeof value.id !== 'string' || !SAFE_IDENTIFIER.test(value.id)
    || !Array.isArray(value.capabilities)
    || !value.capabilities.includes(HARNESS_OPERATIONS.PLAN)) {
    throw new TypeError(fieldName + ' must support plan');
  }
  return Object.freeze({
    receiver: value,
    id: value.id,
    plan: inspectableFunction(value.plan, fieldName + '.plan'),
  });
}

function captureComparator(value) {
  const fields = dataFields(value, 'comparator', {
    allowedKeys: ['version', 'compare', 'diagnostics'],
    requiredKeys: ['version', 'compare', 'diagnostics'],
    frozen: true,
  });
  const version = fields.get('version');
  if (typeof version !== 'string' || !SAFE_IDENTIFIER.test(version)) {
    throw new TypeError('comparator.version must be a safe identifier');
  }
  return Object.freeze({
    receiver: value,
    version,
    compare: inspectableFunction(fields.get('compare'), 'comparator.compare'),
  });
}

function captureReportSink(value) {
  const fields = dataFields(value, 'reportSink', {
    allowedKeys: ['version', 'record'],
    requiredKeys: ['version', 'record'],
    frozen: true,
  });
  const version = fields.get('version');
  if (typeof version !== 'string' || !SAFE_IDENTIFIER.test(version)) {
    throw new TypeError('reportSink.version must be a safe identifier');
  }
  return Object.freeze({
    receiver: value,
    version,
    record: inspectableFunction(fields.get('record'), 'reportSink.record'),
  });
}

function boundedInteger(value, fallback, minimum, maximum, fieldName) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate)
    || candidate < minimum || candidate > maximum) {
    throw new TypeError(fieldName + ' is outside its supported bounds');
  }
  return candidate;
}

function cloneStableJson(value, fieldName) {
  const seen = new Set();
  let nodes = 0;

  function clone(current, depth, currentField) {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new TypeError(fieldName + ' exceeds snapshot bounds');
    }
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'string') {
      if (current.length > MAX_STRING_CHARS || current.includes('\0')) {
        throw new TypeError(currentField + ' is invalid');
      }
      return current;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError(currentField + ' is invalid');
      return current;
    }
    if (!current || typeof current !== 'object' || util.types.isProxy(current)
      || seen.has(current)) {
      throw new TypeError(currentField + ' must be acyclic JSON data');
    }
    seen.add(current);

    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) {
        throw new TypeError(currentField + ' must be a standard array');
      }
      const keys = Reflect.ownKeys(current).filter((key) => key !== 'length');
      if (keys.length !== current.length
        || keys.some((key, index) => key !== String(index))) {
        throw new TypeError(currentField + ' must be a dense array');
      }
      const output = keys.map((key, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError(currentField + ' must contain data values');
        }
        return clone(descriptor.value, depth + 1, currentField + '[' + index + ']');
      });
      return Object.freeze(output);
    }

    const fields = dataFields(current, currentField);
    const output = {};
    for (const [key, child] of fields.entries()) {
      output[key] = clone(child, depth + 1, currentField + '.' + key);
    }
    return Object.freeze(output);
  }

  return clone(value, 0, fieldName);
}

function assertPlanRequest(value) {
  try {
    assertHarnessRequest(value);
    if (!Object.isFrozen(value) || value.operation !== HARNESS_OPERATIONS.PLAN) {
      throw new TypeError('shadow plan runner requires a frozen plan request');
    }
    return value;
  } catch {
    throw runnerError(SHADOW_PLAN_RUNNER_REASONS.INVALID_REQUEST);
  }
}

function isEligibleRequest(request) {
  if (!Object.prototype.hasOwnProperty.call(request, 'contextPack')) return false;
  try {
    const manifest = assertContextPackManifest(request.contextPack);
    return Object.isFrozen(manifest)
      && manifest.requestId === request.requestId
      && manifest.surface === CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE;
  } catch {
    return false;
  }
}

function validateKernelResult(value, request, kernelId, reason) {
  try {
    const fields = dataFields(value, 'Harness kernel result', { frozen: true });
    if (fields.get('schemaVersion') !== HARNESS_RESULT_SCHEMA_VERSION
      || fields.get('requestId') !== request.requestId
      || fields.get('operation') !== HARNESS_OPERATIONS.PLAN
      || fields.get('kernelId') !== kernelId
      || !fields.has('output')) {
      throw new TypeError('Harness kernel result is mismatched');
    }
    return value;
  } catch {
    throw runnerError(reason);
  }
}

function observeNativePromise(value) {
  if (!util.types.isPromise(value)) {
    return Promise.reject(new TypeError('kernel operation must return a native Promise'));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, value, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

function callAsyncPort(port, methodName, args) {
  let pending;
  try {
    pending = Reflect.apply(port[methodName], port.receiver, args);
  } catch (error) {
    return Promise.reject(error);
  }
  return observeNativePromise(pending);
}

function createKernelOutcome(port, request, invalidReason) {
  return callAsyncPort(port, 'plan', [request]).then(
    (result) => {
      try {
        validateKernelResult(result, request, port.id, invalidReason);
      } catch (error) {
        return Object.freeze({ ok: false, error, invalid: true });
      }
      let snapshot = null;
      let snapshotFailed = false;
      try {
        snapshot = cloneStableJson(result, 'Harness result snapshot');
      } catch {
        snapshotFailed = true;
      }
      return Object.freeze({
        ok: true,
        result,
        snapshot,
        snapshotFailed,
      });
    },
    (error) => Object.freeze({ ok: false, error, invalid: false })
  );
}

function timedOutcome(pending, timeoutMs, timeoutCode) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(Object.freeze({
        ok: false,
        timedOut: true,
        error: runnerError(timeoutCode),
      }));
    }, timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    pending.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(Object.freeze({ ok: true, value }));
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(Object.freeze({ ok: false, timedOut: false, error }));
      }
    );
  });
}

function validateComparisonReport(value, requestId) {
  try {
    const fields = dataFields(value, 'semantic comparison report', { frozen: true });
    if (fields.get('schemaVersion') !== SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION
      || fields.get('requestId') !== requestId
      || fields.get('operation') !== HARNESS_OPERATIONS.PLAN
      || fields.get('eligible') !== true
      || typeof fields.get('verdict') !== 'string'
      || !VALID_VERDICTS.has(fields.get('verdict'))
      || typeof fields.get('parity') !== 'boolean') {
      throw new TypeError('semantic comparison report is invalid');
    }
    return value;
  } catch {
    throw runnerError(SHADOW_PLAN_RUNNER_REASONS.INVALID_COMPARISON_REPORT);
  }
}

function normalizeShadowFailure(outcome) {
  if (outcome.invalid) {
    return SHADOW_PLAN_RUNNER_REASONS.SHADOW_INVALID_RESULT;
  }
  return SHADOW_PLAN_RUNNER_REASONS.SHADOW_FAILED;
}

function createShadowPlanRunner(options = {}) {
  const fields = dataFields(options, 'shadow plan runner options', {
    allowedKeys: [
      'authoritativeKernel',
      'shadowKernel',
      'comparator',
      'reportSink',
      'shadowObservationTimeoutMs',
      'comparisonTimeoutMs',
    ],
    requiredKeys: [
      'authoritativeKernel',
      'shadowKernel',
      'comparator',
      'reportSink',
    ],
  });
  const authoritativeKernel = captureKernel(
    fields.get('authoritativeKernel'),
    'authoritativeKernel'
  );
  const shadowKernel = captureKernel(fields.get('shadowKernel'), 'shadowKernel');
  if (authoritativeKernel.id === shadowKernel.id) {
    throw new TypeError('authoritativeKernel and shadowKernel must be distinct');
  }
  const comparator = captureComparator(fields.get('comparator'));
  const reportSink = captureReportSink(fields.get('reportSink'));
  const shadowObservationTimeoutMs = boundedInteger(
    fields.get('shadowObservationTimeoutMs'),
    DEFAULT_SHADOW_OBSERVATION_TIMEOUT_MS,
    10,
    10 * 60 * 1000,
    'shadowObservationTimeoutMs'
  );
  const comparisonTimeoutMs = boundedInteger(
    fields.get('comparisonTimeoutMs'),
    DEFAULT_COMPARISON_TIMEOUT_MS,
    10,
    10 * 60 * 1000,
    'comparisonTimeoutMs'
  );

  let plans = 0;
  let authoritativeCompleted = 0;
  let authoritativeFailed = 0;
  let shadowStarted = 0;
  let shadowSkipped = 0;
  let shadowCompleted = 0;
  let shadowFailed = 0;
  let shadowTimedOut = 0;
  let comparisonsCompleted = 0;
  let comparisonsFailed = 0;
  let reportsRecorded = 0;
  let reportsRejected = 0;
  let lastShadowFailureCode = null;
  let lastComparisonVerdict = null;
  const activeObservations = new Set();

  function recordReport(report) {
    try {
      const result = Reflect.apply(
        reportSink.record,
        reportSink.receiver,
        [report]
      );
      if (util.types.isPromise(result)) {
        try {
          Reflect.apply(Promise.prototype.then, result, [() => {}, () => {}]);
        } catch {
          // The asynchronous sink is rejected below.
        }
        throw new TypeError('reportSink.record must be synchronous');
      }
      if (result !== undefined) {
        throw new TypeError('reportSink.record must not return authority');
      }
      reportsRecorded += 1;
    } catch {
      reportsRejected += 1;
    }
  }

  async function observeComparison({
    requestSnapshot,
    authoritativeOutcome,
    shadowOutcome,
  }) {
    const authoritative = await authoritativeOutcome;
    const boundedShadow = await timedOutcome(
      shadowOutcome,
      shadowObservationTimeoutMs,
      SHADOW_PLAN_RUNNER_REASONS.SHADOW_TIMEOUT
    );
    if (!boundedShadow.ok) {
      shadowFailed += 1;
      if (boundedShadow.timedOut) shadowTimedOut += 1;
      lastShadowFailureCode = boundedShadow.timedOut
        ? SHADOW_PLAN_RUNNER_REASONS.SHADOW_TIMEOUT
        : SHADOW_PLAN_RUNNER_REASONS.SHADOW_FAILED;
      return;
    }
    const shadow = boundedShadow.value;
    if (!shadow.ok) {
      shadowFailed += 1;
      lastShadowFailureCode = normalizeShadowFailure(shadow);
      return;
    }
    shadowCompleted += 1;
    lastShadowFailureCode = null;
    if (!authoritative.ok) return;
    if (!requestSnapshot || authoritative.snapshotFailed
      || !authoritative.snapshot || shadow.snapshotFailed || !shadow.snapshot) {
      comparisonsFailed += 1;
      return;
    }

    const comparisonInput = Object.freeze({
      request: requestSnapshot,
      authoritativeResult: authoritative.snapshot,
      shadowResult: shadow.snapshot,
    });
    const pendingComparison = callAsyncPort(
      comparator,
      'compare',
      [comparisonInput]
    );
    const boundedComparison = await timedOutcome(
      pendingComparison,
      comparisonTimeoutMs,
      SHADOW_PLAN_RUNNER_REASONS.COMPARISON_TIMEOUT
    );
    if (!boundedComparison.ok) {
      comparisonsFailed += 1;
      return;
    }
    let report;
    try {
      report = validateComparisonReport(
        boundedComparison.value,
        requestSnapshot.requestId
      );
    } catch {
      comparisonsFailed += 1;
      return;
    }
    comparisonsCompleted += 1;
    lastComparisonVerdict = report.verdict;
    recordReport(report);
  }

  function scheduleObservation(input) {
    const task = observeComparison(input).catch(() => {
      comparisonsFailed += 1;
    });
    activeObservations.add(task);
    task.then(() => {
      activeObservations.delete(task);
    });
  }

  async function plan(request) {
    const planRequest = assertPlanRequest(request);
    plans += 1;
    let eligible = isEligibleRequest(planRequest);
    let requestSnapshot = null;
    if (eligible) {
      try {
        requestSnapshot = cloneStableJson(planRequest, 'Harness request snapshot');
      } catch {
        eligible = false;
      }
    }

    const authoritativeOutcome = createKernelOutcome(
      authoritativeKernel,
      planRequest,
      SHADOW_PLAN_RUNNER_REASONS.INVALID_AUTHORITATIVE_RESULT
    );
    if (eligible) {
      shadowStarted += 1;
      const shadowOutcome = createKernelOutcome(
        shadowKernel,
        planRequest,
        SHADOW_PLAN_RUNNER_REASONS.SHADOW_INVALID_RESULT
      );
      scheduleObservation({
        requestSnapshot,
        authoritativeOutcome,
        shadowOutcome,
      });
    } else {
      shadowSkipped += 1;
    }

    const authoritative = await authoritativeOutcome;
    if (!authoritative.ok) {
      authoritativeFailed += 1;
      throw authoritative.error;
    }
    authoritativeCompleted += 1;
    return authoritative.result;
  }

  function diagnostics() {
    return Object.freeze({
      version: SHADOW_PLAN_RUNNER_VERSION,
      authoritativeKernelId: authoritativeKernel.id,
      shadowKernelId: shadowKernel.id,
      shadowObservationTimeoutMs,
      comparisonTimeoutMs,
      plans,
      authoritativeCompleted,
      authoritativeFailed,
      shadowStarted,
      shadowSkipped,
      shadowCompleted,
      shadowFailed,
      shadowTimedOut,
      comparisonsCompleted,
      comparisonsFailed,
      reportsRecorded,
      reportsRejected,
      activeObservations: activeObservations.size,
      lastShadowFailureCode,
      lastComparisonVerdict,
    });
  }

  async function drain() {
    while (activeObservations.size) {
      await Promise.all([...activeObservations]);
    }
    return diagnostics();
  }

  return Object.freeze({
    version: SHADOW_PLAN_RUNNER_VERSION,
    plan,
    drain,
    diagnostics,
  });
}

module.exports = {
  SHADOW_PLAN_RUNNER_REASONS,
  SHADOW_PLAN_RUNNER_VERSION,
  ShadowPlanRunnerError,
  createShadowPlanRunner,
};
