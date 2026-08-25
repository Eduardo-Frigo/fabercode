'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  CANARY_ROLLOUT_STAGES,
} = require('./canary_rollout_selector');

const CANARY_ROLLOUT_EVIDENCE_LEDGER_VERSION =
  'canary-rollout-evidence-ledger.v1';
const CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION =
  'canary-rollout-evidence.v1';
const CANARY_ROLLOUT_EVIDENCE_SINK_VERSION =
  'canary-rollout-evidence-sink.v1';
const CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SCHEMA_VERSION =
  'canary-rollout-evidence-reconciliation.v1';
const CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SINK_VERSION =
  'canary-rollout-evidence-reconciliation-sink.v1';
const CANARY_ROLLOUT_EVIDENCE_SNAPSHOT_SCHEMA_VERSION =
  'canary-rollout-evidence-snapshot.v1';
const CANARY_ROLLOUT_ADVANCEMENT_DECISION_SCHEMA_VERSION =
  'canary-rollout-advancement-decision.v1';
const CANARY_ROLLOUT_EVIDENCE_JOURNAL_VERSION =
  'canary-rollout-evidence-journal.v2';
const CANARY_ROLLOUT_EVIDENCE_JOURNAL_SNAPSHOT_SCHEMA_VERSION =
  'canary-rollout-evidence-journal-snapshot.v2';

const TOTAL_BASIS_POINTS = 10_000;
const DEFAULT_MINIMUM_CANARY_JOBS = 10;
const DEFAULT_MINIMUM_BASELINE_JOBS = 10;
const MAXIMUM_SAMPLE_SIZE = 1_000_000;
const MANUAL_ROLLBACK_LIMIT_BASIS_POINTS = 200;
const CORRUPTED_JOB_LIMIT_BASIS_POINTS = 50;
const MAXIMUM_SUCCESS_REGRESSION_BASIS_POINTS = 300;

const CANARY_ROLLOUT_GATE_STATUSES = Object.freeze({
  BLOCKED: 'blocked',
  INSUFFICIENT_DATA: 'insufficient_data',
  PASS: 'pass',
});

const CANARY_ROLLOUT_GATE_REASONS = Object.freeze({
  CORRUPTED_JOB_RATE: 'corrupted_job_rate_at_or_above_limit',
  DATA_LOSS_INCIDENT: 'data_loss_incident',
  DUPLICATE_EXTERNAL_EFFECT: 'duplicate_external_effect',
  INSUFFICIENT_BASELINE_SAMPLE: 'insufficient_baseline_sample',
  INSUFFICIENT_CANARY_SAMPLE: 'insufficient_canary_sample',
  MANUAL_ROLLBACK_RATE: 'manual_rollback_rate_at_or_above_limit',
  SECURITY_INCIDENT: 'security_incident',
  SUCCESS_BELOW_BASELINE: 'success_below_baseline_tolerance',
});

const CANARY_ROLLOUT_ADVANCEMENT_REASONS = Object.freeze({
  GATE_BLOCKED: 'gate_blocked',
  GATE_INSUFFICIENT_DATA: 'gate_insufficient_data',
  GATE_PASSED: 'gate_passed',
  TERMINAL_STAGE: 'terminal_stage',
});

const CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS = Object.freeze({
  DUPLICATE_EVIDENCE: 'CANARY_ROLLOUT_DUPLICATE_EVIDENCE',
  DUPLICATE_RECONCILIATION: 'CANARY_ROLLOUT_DUPLICATE_RECONCILIATION',
  INVALID_EVIDENCE: 'CANARY_ROLLOUT_INVALID_EVIDENCE',
  INVALID_RECONCILIATION: 'CANARY_ROLLOUT_INVALID_RECONCILIATION',
  PERSISTENCE_FAILED: 'CANARY_ROLLOUT_EVIDENCE_PERSISTENCE_FAILED',
  RECONCILIATION_NO_NEW_SIGNAL: 'CANARY_ROLLOUT_RECONCILIATION_NO_NEW_SIGNAL',
  RECONCILIATION_TARGET_MISMATCH: 'CANARY_ROLLOUT_RECONCILIATION_TARGET_MISMATCH',
  RECONCILIATION_TARGET_NOT_FOUND: 'CANARY_ROLLOUT_RECONCILIATION_TARGET_NOT_FOUND',
});

const STAGE_ORDER = Object.freeze([
  CANARY_ROLLOUT_STAGES.INTERNAL,
  CANARY_ROLLOUT_STAGES.PERCENT_1,
  CANARY_ROLLOUT_STAGES.PERCENT_5,
  CANARY_ROLLOUT_STAGES.PERCENT_25,
  CANARY_ROLLOUT_STAGES.PERCENT_50,
]);
const VALID_STAGES = new Set(STAGE_ORDER);
const VALID_ROUTES = new Set(['baseline', 'canary']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OPTION_KEYS = Object.freeze([
  'minimumCanaryJobs',
  'minimumBaselineJobs',
  'evidenceJournal',
]);
const EVIDENCE_KEYS = Object.freeze([
  'schemaVersion',
  'jobId',
  'projectId',
  'rolloutStage',
  'route',
  'eligible',
  'terminal',
  'succeeded',
  'manualRollback',
  'corrupted',
  'dataLossIncident',
  'securityIncident',
  'duplicateExternalEffect',
]);
const RECONCILIATION_KEYS = Object.freeze([
  'schemaVersion',
  'reconciliationId',
  'jobId',
  'projectId',
  'rolloutStage',
  'manualRollback',
  'corrupted',
  'dataLossIncident',
  'securityIncident',
  'duplicateExternalEffect',
]);
const JOURNAL_EVENT_KEYS = Object.freeze(['type', 'value']);
const OUTCOME_SIGNAL_KEYS = Object.freeze([
  'manualRollback',
  'corrupted',
  'dataLossIncident',
  'securityIncident',
  'duplicateExternalEffect',
]);

class CanaryRolloutEvidenceLedgerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryRolloutEvidenceLedgerError';
    this.code = code;
  }
}

function ledgerError(code) {
  return new CanaryRolloutEvidenceLedgerError(code);
}

function plainDataFields(value, expectedKeys, {
  exact = true,
  frozen = false,
} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)
    || frozen && !Object.isFrozen(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || exact && keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key)
      || !expectedKeys.includes(key))
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

function boundedSampleSize(value, fallback, fieldName) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate)
    || candidate < 1 || candidate > MAXIMUM_SAMPLE_SIZE) {
    throw new TypeError(fieldName + ' is outside its supported bounds');
  }
  return candidate;
}

function normalizeEvidence(value) {
  const fields = plainDataFields(value, EVIDENCE_KEYS, { frozen: true });
  if (!fields
    || fields.get('schemaVersion') !== CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION
    || typeof fields.get('jobId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('jobId'))
    || typeof fields.get('projectId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('projectId'))
    || !VALID_STAGES.has(fields.get('rolloutStage'))
    || !VALID_ROUTES.has(fields.get('route'))
    || fields.get('eligible') !== true
    || fields.get('terminal') !== true
    || typeof fields.get('succeeded') !== 'boolean'
    || OUTCOME_SIGNAL_KEYS.some(
      (key) => typeof fields.get(key) !== 'boolean'
    )) return null;
  const hasCanarySignal = OUTCOME_SIGNAL_KEYS.some((key) => fields.get(key));
  if (fields.get('route') === 'baseline' && hasCanarySignal
    || fields.get('succeeded') && hasCanarySignal) return null;
  return Object.freeze(Object.fromEntries(
    EVIDENCE_KEYS.map((key) => [key, fields.get(key)])
  ));
}

function normalizeReconciliation(value) {
  const fields = plainDataFields(value, RECONCILIATION_KEYS, { frozen: true });
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SCHEMA_VERSION
    || typeof fields.get('reconciliationId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('reconciliationId'))
    || typeof fields.get('jobId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('jobId'))
    || typeof fields.get('projectId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('projectId'))
    || !VALID_STAGES.has(fields.get('rolloutStage'))
    || OUTCOME_SIGNAL_KEYS.some(
      (key) => typeof fields.get(key) !== 'boolean'
    )
    || !OUTCOME_SIGNAL_KEYS.some((key) => fields.get(key))) return null;
  return Object.freeze(Object.fromEntries(
    RECONCILIATION_KEYS.map((key) => [key, fields.get(key)])
  ));
}

function scalarToken(name, value) {
  const text = String(value);
  return name.length + ':' + name + ':' + text.length + ':' + text;
}

function canonicalEvidence(evidence) {
  return EVIDENCE_KEYS.map(
    (key) => scalarToken(key, evidence[key])
  ).join('|');
}

function canonicalReconciliation(reconciliation) {
  return RECONCILIATION_KEYS.map(
    (key) => scalarToken(key, reconciliation[key])
  ).join('|');
}

function rateBasisPoints(numerator, denominator) {
  if (denominator === 0) return 0;
  return Math.round(numerator * TOTAL_BASIS_POINTS / denominator);
}

function rateAtOrAbove(numerator, denominator, thresholdBasisPoints) {
  if (denominator === 0) return false;
  return BigInt(numerator) * BigInt(TOTAL_BASIS_POINTS)
    >= BigInt(denominator) * BigInt(thresholdBasisPoints);
}

function successRegressionExceeds(state) {
  if (state.baselineJobs === 0 || state.canaryJobs === 0) return false;
  const regressionNumerator = BigInt(state.baselineSuccesses)
      * BigInt(state.canaryJobs)
    - BigInt(state.canarySuccesses) * BigInt(state.baselineJobs);
  return regressionNumerator * BigInt(TOTAL_BASIS_POINTS)
    > BigInt(MAXIMUM_SUCCESS_REGRESSION_BASIS_POINTS)
      * BigInt(state.baselineJobs) * BigInt(state.canaryJobs);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function createStageState() {
  return {
    acceptedEvidence: 0,
    headDigest: null,
    baselineJobs: 0,
    baselineSuccesses: 0,
    canaryJobs: 0,
    canarySuccesses: 0,
    manualRollbacks: 0,
    corruptedJobs: 0,
    dataLossIncidents: 0,
    securityIncidents: 0,
    duplicateExternalEffects: 0,
  };
}

function assertStage(rolloutStage) {
  if (typeof rolloutStage !== 'string' || !VALID_STAGES.has(rolloutStage)) {
    throw new TypeError('rolloutStage must identify a supported canary stage');
  }
  return rolloutStage;
}

function captureEvidenceJournal(value) {
  const fields = plainDataFields(
    value,
    ['version', 'load', 'append', 'diagnostics'],
    { frozen: true }
  );
  if (!fields
    || fields.get('version') !== CANARY_ROLLOUT_EVIDENCE_JOURNAL_VERSION) {
    return null;
  }
  for (const methodName of ['load', 'append', 'diagnostics']) {
    const method = fields.get(methodName);
    if (typeof method !== 'function' || util.types.isProxy(method)
      || util.types.isGeneratorFunction(method)) return null;
    try {
      Function.prototype.toString.call(method);
    } catch {
      return null;
    }
  }
  return Object.freeze({
    receiver: value,
    version: fields.get('version'),
    load: fields.get('load'),
    append: fields.get('append'),
  });
}

function denseFrozenEvents(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || !Object.isFrozen(value)) return null;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) return null;
  const entries = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) return null;
    const eventFields = plainDataFields(
      descriptor.value,
      JOURNAL_EVENT_KEYS,
      { frozen: true }
    );
    if (!eventFields
      || !['evidence', 'reconciliation'].includes(eventFields.get('type'))) {
      return null;
    }
    entries.push(Object.freeze({
      type: eventFields.get('type'),
      value: eventFields.get('value'),
    }));
  }
  return entries;
}

function loadPersistedEvents(journal) {
  let snapshot;
  try {
    snapshot = Reflect.apply(journal.load, journal.receiver, []);
  } catch {
    throw ledgerError(
      CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.PERSISTENCE_FAILED
    );
  }
  if (util.types.isPromise(snapshot)) {
    snapshot.catch(() => {});
    throw ledgerError(
      CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.PERSISTENCE_FAILED
    );
  }
  const fields = plainDataFields(
    snapshot,
    ['schemaVersion', 'events'],
    { frozen: true }
  );
  const entries = fields ? denseFrozenEvents(fields.get('events')) : null;
  if (!fields || !entries
    || fields.get('schemaVersion')
      !== CANARY_ROLLOUT_EVIDENCE_JOURNAL_SNAPSHOT_SCHEMA_VERSION) {
    throw ledgerError(
      CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.PERSISTENCE_FAILED
    );
  }
  return entries;
}

function createCanaryRolloutEvidenceLedger(options = {}) {
  const fields = plainDataFields(options, OPTION_KEYS, { exact: false });
  if (!fields) throw new TypeError('Invalid canary rollout evidence ledger options');
  const journal = fields.has('evidenceJournal')
    ? captureEvidenceJournal(fields.get('evidenceJournal'))
    : null;
  if (fields.has('evidenceJournal') && !journal) {
    throw new TypeError('Invalid canary rollout evidence journal');
  }
  const minimumCanaryJobs = boundedSampleSize(
    fields.get('minimumCanaryJobs'),
    DEFAULT_MINIMUM_CANARY_JOBS,
    'minimumCanaryJobs'
  );
  const minimumBaselineJobs = boundedSampleSize(
    fields.get('minimumBaselineJobs'),
    DEFAULT_MINIMUM_BASELINE_JOBS,
    'minimumBaselineJobs'
  );
  const stageStates = new Map(
    STAGE_ORDER.map((stage) => [stage, createStageState()])
  );
  const jobIds = new Set();
  const reconciliationIds = new Set();
  const jobOutcomes = new Map();
  let acceptedEvidence = 0;
  let acceptedReconciliations = 0;
  let rejections = 0;
  let duplicateEvidence = 0;
  let lastFailureCode = null;
  let recoveredEvidence = 0;
  let recoveredReconciliations = 0;

  function acceptEvidence(evidence) {
    const state = stageStates.get(evidence.rolloutStage);
    const nextDigest = 'sha256:' + crypto.createHash('sha256')
      .update(state.headDigest || '')
      .update('\n')
      .update(canonicalEvidence(evidence))
      .digest('hex');
    jobIds.add(evidence.jobId);
    acceptedEvidence += 1;
    state.acceptedEvidence += 1;
    state.headDigest = nextDigest;
    if (evidence.route === 'baseline') {
      state.baselineJobs += 1;
      state.baselineSuccesses += evidence.succeeded ? 1 : 0;
    } else {
      state.canaryJobs += 1;
      state.canarySuccesses += evidence.succeeded ? 1 : 0;
      state.manualRollbacks += evidence.manualRollback ? 1 : 0;
      state.corruptedJobs += evidence.corrupted ? 1 : 0;
      state.dataLossIncidents += evidence.dataLossIncident ? 1 : 0;
      state.securityIncidents += evidence.securityIncident ? 1 : 0;
      state.duplicateExternalEffects += evidence.duplicateExternalEffect
        ? 1
        : 0;
    }
    jobOutcomes.set(evidence.jobId, {
      evidence,
      succeeded: evidence.succeeded,
      manualRollback: evidence.manualRollback,
      corrupted: evidence.corrupted,
      dataLossIncident: evidence.dataLossIncident,
      securityIncident: evidence.securityIncident,
      duplicateExternalEffect: evidence.duplicateExternalEffect,
    });
  }

  function persistJournalValue(value) {
    if (!journal) return;
    let persisted;
    try {
      persisted = Reflect.apply(
        journal.append,
        journal.receiver,
        [value]
      );
    } catch {
      throw ledgerError(
        CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.PERSISTENCE_FAILED
      );
    }
    if (util.types.isPromise(persisted)) {
      persisted.catch(() => {});
      throw ledgerError(
        CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.PERSISTENCE_FAILED
      );
    }
    if (persisted !== undefined) {
      throw ledgerError(
        CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.PERSISTENCE_FAILED
      );
    }
  }

  function record(value) {
    try {
      const evidence = normalizeEvidence(value);
      if (!evidence) {
        throw ledgerError(
          CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.INVALID_EVIDENCE
        );
      }
      if (jobIds.has(evidence.jobId)) {
        throw ledgerError(
          CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.DUPLICATE_EVIDENCE
        );
      }
      persistJournalValue(evidence);
      acceptEvidence(evidence);
      lastFailureCode = null;
      return undefined;
    } catch (error) {
      const normalized = error instanceof CanaryRolloutEvidenceLedgerError
        ? error
        : ledgerError(
          CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.INVALID_EVIDENCE
        );
      rejections += 1;
      if (normalized.code
        === CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.DUPLICATE_EVIDENCE) {
        duplicateEvidence += 1;
      }
      lastFailureCode = normalized.code;
      throw normalized;
    }
  }

  function validateReconciliationTarget(reconciliation) {
    const outcome = jobOutcomes.get(reconciliation.jobId);
    if (!outcome) {
      throw ledgerError(
        CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS
          .RECONCILIATION_TARGET_NOT_FOUND
      );
    }
    if (outcome.evidence.route !== 'canary'
      || outcome.evidence.projectId !== reconciliation.projectId
      || outcome.evidence.rolloutStage !== reconciliation.rolloutStage
      || reconciliation.manualRollback && !outcome.evidence.succeeded) {
      throw ledgerError(
        CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.RECONCILIATION_TARGET_MISMATCH
      );
    }
    const newSignals = OUTCOME_SIGNAL_KEYS.filter(
      (key) => reconciliation[key] && !outcome[key]
    );
    if (newSignals.length === 0) {
      throw ledgerError(
        CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.RECONCILIATION_NO_NEW_SIGNAL
      );
    }
    return Object.freeze({ outcome, newSignals: Object.freeze(newSignals) });
  }

  function acceptReconciliation(reconciliation, target) {
    const state = stageStates.get(reconciliation.rolloutStage);
    state.headDigest = 'sha256:' + crypto.createHash('sha256')
      .update(state.headDigest || '')
      .update('\n')
      .update(canonicalReconciliation(reconciliation))
      .digest('hex');
    if (target.outcome.succeeded) {
      state.canarySuccesses -= 1;
      target.outcome.succeeded = false;
    }
    for (const key of target.newSignals) {
      target.outcome[key] = true;
      if (key === 'manualRollback') state.manualRollbacks += 1;
      else if (key === 'corrupted') state.corruptedJobs += 1;
      else if (key === 'dataLossIncident') state.dataLossIncidents += 1;
      else if (key === 'securityIncident') state.securityIncidents += 1;
      else if (key === 'duplicateExternalEffect') {
        state.duplicateExternalEffects += 1;
      }
    }
    reconciliationIds.add(reconciliation.reconciliationId);
    acceptedReconciliations += 1;
  }

  function recordReconciliation(value) {
    try {
      const reconciliation = normalizeReconciliation(value);
      if (!reconciliation) {
        throw ledgerError(
          CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.INVALID_RECONCILIATION
        );
      }
      if (reconciliationIds.has(reconciliation.reconciliationId)) {
        throw ledgerError(
          CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.DUPLICATE_RECONCILIATION
        );
      }
      const target = validateReconciliationTarget(reconciliation);
      persistJournalValue(reconciliation);
      acceptReconciliation(reconciliation, target);
      lastFailureCode = null;
      return undefined;
    } catch (error) {
      const normalized = error instanceof CanaryRolloutEvidenceLedgerError
        ? error
        : ledgerError(
          CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.INVALID_RECONCILIATION
        );
      rejections += 1;
      lastFailureCode = normalized.code;
      throw normalized;
    }
  }

  if (journal) {
    const persistedEvents = loadPersistedEvents(journal);
    try {
      for (const event of persistedEvents) {
        if (event.type === 'evidence') {
          const evidence = normalizeEvidence(event.value);
          if (!evidence || jobIds.has(evidence.jobId)) throw new Error();
          acceptEvidence(evidence);
          recoveredEvidence += 1;
        } else {
          const reconciliation = normalizeReconciliation(event.value);
          if (!reconciliation
            || reconciliationIds.has(reconciliation.reconciliationId)) {
            throw new Error();
          }
          const target = validateReconciliationTarget(reconciliation);
          acceptReconciliation(reconciliation, target);
          recoveredReconciliations += 1;
        }
      }
    } catch {
      throw ledgerError(
        CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS.PERSISTENCE_FAILED
      );
    }
  }

  const evidenceSink = Object.freeze({
    version: CANARY_ROLLOUT_EVIDENCE_SINK_VERSION,
    record,
  });
  const reconciliationSink = Object.freeze({
    version: CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SINK_VERSION,
    record: recordReconciliation,
  });

  function snapshot(stageValue) {
    const rolloutStage = assertStage(stageValue);
    const state = stageStates.get(rolloutStage);
    const baselineSuccessRateBasisPoints = rateBasisPoints(
      state.baselineSuccesses,
      state.baselineJobs
    );
    const canarySuccessRateBasisPoints = rateBasisPoints(
      state.canarySuccesses,
      state.canaryJobs
    );
    const manualRollbackRateBasisPoints = rateBasisPoints(
      state.manualRollbacks,
      state.canaryJobs
    );
    const corruptedJobRateBasisPoints = rateBasisPoints(
      state.corruptedJobs,
      state.canaryJobs
    );
    const reasons = [];
    if (state.dataLossIncidents > 0) {
      reasons.push(CANARY_ROLLOUT_GATE_REASONS.DATA_LOSS_INCIDENT);
    }
    if (state.securityIncidents > 0) {
      reasons.push(CANARY_ROLLOUT_GATE_REASONS.SECURITY_INCIDENT);
    }
    if (state.duplicateExternalEffects > 0) {
      reasons.push(CANARY_ROLLOUT_GATE_REASONS.DUPLICATE_EXTERNAL_EFFECT);
    }
    let status;
    if (reasons.length > 0) {
      status = CANARY_ROLLOUT_GATE_STATUSES.BLOCKED;
    } else if (state.canaryJobs < minimumCanaryJobs
      || state.baselineJobs < minimumBaselineJobs) {
      status = CANARY_ROLLOUT_GATE_STATUSES.INSUFFICIENT_DATA;
      if (state.canaryJobs < minimumCanaryJobs) {
        reasons.push(
          CANARY_ROLLOUT_GATE_REASONS.INSUFFICIENT_CANARY_SAMPLE
        );
      }
      if (state.baselineJobs < minimumBaselineJobs) {
        reasons.push(
          CANARY_ROLLOUT_GATE_REASONS.INSUFFICIENT_BASELINE_SAMPLE
        );
      }
    } else {
      if (rateAtOrAbove(
        state.manualRollbacks,
        state.canaryJobs,
        MANUAL_ROLLBACK_LIMIT_BASIS_POINTS
      )) {
        reasons.push(CANARY_ROLLOUT_GATE_REASONS.MANUAL_ROLLBACK_RATE);
      }
      if (rateAtOrAbove(
        state.corruptedJobs,
        state.canaryJobs,
        CORRUPTED_JOB_LIMIT_BASIS_POINTS
      )) {
        reasons.push(CANARY_ROLLOUT_GATE_REASONS.CORRUPTED_JOB_RATE);
      }
      if (successRegressionExceeds(state)) {
        reasons.push(CANARY_ROLLOUT_GATE_REASONS.SUCCESS_BELOW_BASELINE);
      }
      status = reasons.length === 0
        ? CANARY_ROLLOUT_GATE_STATUSES.PASS
        : CANARY_ROLLOUT_GATE_STATUSES.BLOCKED;
    }
    return deepFreeze({
      schemaVersion: CANARY_ROLLOUT_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
      ledgerVersion: CANARY_ROLLOUT_EVIDENCE_LEDGER_VERSION,
      rolloutStage,
      thresholds: {
        minimumCanaryJobs,
        minimumBaselineJobs,
        manualRollbackMustBeBelowBasisPoints:
          MANUAL_ROLLBACK_LIMIT_BASIS_POINTS,
        corruptedJobMustBeBelowBasisPoints:
          CORRUPTED_JOB_LIMIT_BASIS_POINTS,
        maximumSuccessRegressionBasisPoints:
          MAXIMUM_SUCCESS_REGRESSION_BASIS_POINTS,
      },
      totals: {
        baselineJobs: state.baselineJobs,
        baselineSuccesses: state.baselineSuccesses,
        baselineSuccessRateBasisPoints,
        canaryJobs: state.canaryJobs,
        canarySuccesses: state.canarySuccesses,
        canarySuccessRateBasisPoints,
        successDeltaBasisPoints: canarySuccessRateBasisPoints
          - baselineSuccessRateBasisPoints,
        manualRollbacks: state.manualRollbacks,
        manualRollbackRateBasisPoints,
        corruptedJobs: state.corruptedJobs,
        corruptedJobRateBasisPoints,
        dataLossIncidents: state.dataLossIncidents,
        securityIncidents: state.securityIncidents,
        duplicateExternalEffects: state.duplicateExternalEffects,
      },
      gate: { status, reasons },
      headDigest: state.headDigest,
    });
  }

  function advancement(stageValue) {
    const fromStage = assertStage(stageValue);
    const stageSnapshot = snapshot(fromStage);
    const currentIndex = STAGE_ORDER.indexOf(fromStage);
    const toStage = STAGE_ORDER[currentIndex + 1] || null;
    let allowed = false;
    let reason;
    if (toStage === null) {
      reason = CANARY_ROLLOUT_ADVANCEMENT_REASONS.TERMINAL_STAGE;
    } else if (stageSnapshot.gate.status
      === CANARY_ROLLOUT_GATE_STATUSES.PASS) {
      allowed = true;
      reason = CANARY_ROLLOUT_ADVANCEMENT_REASONS.GATE_PASSED;
    } else if (stageSnapshot.gate.status
      === CANARY_ROLLOUT_GATE_STATUSES.BLOCKED) {
      reason = CANARY_ROLLOUT_ADVANCEMENT_REASONS.GATE_BLOCKED;
    } else {
      reason = CANARY_ROLLOUT_ADVANCEMENT_REASONS.GATE_INSUFFICIENT_DATA;
    }
    return Object.freeze({
      schemaVersion: CANARY_ROLLOUT_ADVANCEMENT_DECISION_SCHEMA_VERSION,
      fromStage,
      toStage,
      allowed,
      reason,
      gateStatus: stageSnapshot.gate.status,
    });
  }

  function diagnostics() {
    return deepFreeze({
      version: CANARY_ROLLOUT_EVIDENCE_LEDGER_VERSION,
      evidenceSinkVersion: CANARY_ROLLOUT_EVIDENCE_SINK_VERSION,
      journalVersion: journal ? journal.version : null,
      recoveredEvidence,
      recoveredReconciliations,
      acceptedEvidence,
      acceptedReconciliations,
      acceptedByStage: Object.fromEntries(STAGE_ORDER.map(
        (stage) => [stage, stageStates.get(stage).acceptedEvidence]
      )),
      rejections,
      duplicateEvidence,
      lastFailureCode,
    });
  }

  return Object.freeze({
    version: CANARY_ROLLOUT_EVIDENCE_LEDGER_VERSION,
    evidenceSink,
    reconciliationSink,
    snapshot,
    advancement,
    diagnostics,
  });
}

module.exports = {
  CANARY_ROLLOUT_ADVANCEMENT_DECISION_SCHEMA_VERSION,
  CANARY_ROLLOUT_ADVANCEMENT_REASONS,
  CANARY_ROLLOUT_EVIDENCE_LEDGER_REASONS,
  CANARY_ROLLOUT_EVIDENCE_LEDGER_VERSION,
  CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SCHEMA_VERSION,
  CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SINK_VERSION,
  CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
  CANARY_ROLLOUT_EVIDENCE_SINK_VERSION,
  CANARY_ROLLOUT_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
  CANARY_ROLLOUT_GATE_REASONS,
  CANARY_ROLLOUT_GATE_STATUSES,
  CanaryRolloutEvidenceLedgerError,
  createCanaryRolloutEvidenceLedger,
};
