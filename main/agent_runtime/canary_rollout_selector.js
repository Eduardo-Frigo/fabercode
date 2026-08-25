'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  HARNESS_RUNTIME_MODES,
} = require('./harness_runtime_config');

const CANARY_ROLLOUT_SELECTOR_VERSION = 'canary-rollout-selector.v1';
const CANARY_ROLLOUT_DECISION_SCHEMA_VERSION = 'canary-rollout-decision.v1';
const CANARY_ROLLOUT_ALGORITHM = 'sha256-project-cohort.v1';

const CANARY_ROLLOUT_STAGES = Object.freeze({
  INTERNAL: 'internal',
  PERCENT_1: '1_percent',
  PERCENT_5: '5_percent',
  PERCENT_25: '25_percent',
  PERCENT_50: '50_percent',
});

const CANARY_ROLLOUT_REASONS = Object.freeze({
  SELECTED_INTERNAL: 'selected_internal',
  SELECTED_COHORT: 'selected_cohort',
  SELECTED_PROJECT_PIN: 'selected_project_pin',
  INVALID_INPUT: 'invalid_input',
  KILL_SWITCH: 'kill_switch',
  MODE_NOT_CANARY: 'mode_not_canary',
  PINNED_LEGACY: 'pinned_legacy',
  NOT_ALLOWLISTED: 'not_allowlisted',
  INTERNAL_ONLY: 'internal_only',
  OUTSIDE_COHORT: 'outside_cohort',
});

const STAGE_THRESHOLDS = Object.freeze({
  [CANARY_ROLLOUT_STAGES.INTERNAL]: 0,
  [CANARY_ROLLOUT_STAGES.PERCENT_1]: 100,
  [CANARY_ROLLOUT_STAGES.PERCENT_5]: 500,
  [CANARY_ROLLOUT_STAGES.PERCENT_25]: 2500,
  [CANARY_ROLLOUT_STAGES.PERCENT_50]: 5000,
});
const OPTION_KEYS = Object.freeze(['cohortSeed']);
const INPUT_KEYS = Object.freeze([
  'killSwitch',
  'configuredMode',
  'projectId',
  'projectPin',
  'allowlisted',
  'internal',
  'rolloutStage',
]);
const PROJECT_PINS = new Set([null, 'legacy', 'canary']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_PROJECT_ID = /^[A-Za-z0-9._:@-]{1,256}$/;

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

function exactDataFields(value, expectedKeys) {
  if (!isPlainRecord(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key)
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

function normalizeInput(value) {
  const fields = exactDataFields(value, INPUT_KEYS);
  if (!fields || typeof fields.get('killSwitch') !== 'boolean'
    || !HARNESS_RUNTIME_MODES.includes(fields.get('configuredMode'))
    || typeof fields.get('projectId') !== 'string'
    || !SAFE_PROJECT_ID.test(fields.get('projectId'))
    || !PROJECT_PINS.has(fields.get('projectPin'))
    || typeof fields.get('allowlisted') !== 'boolean'
    || typeof fields.get('internal') !== 'boolean'
    || !Object.hasOwn(STAGE_THRESHOLDS, fields.get('rolloutStage'))) return null;
  return Object.freeze(Object.fromEntries(INPUT_KEYS.map((key) => [key, fields.get(key)])));
}

function cohortBasisPoints(cohortSeed, projectId) {
  const digest = crypto.createHash('sha256')
    .update(CANARY_ROLLOUT_ALGORITHM, 'utf8')
    .update('\0', 'utf8')
    .update(cohortSeed, 'utf8')
    .update('\0', 'utf8')
    .update(projectId, 'utf8')
    .digest();
  return Math.floor(digest.readUInt32BE(0) / 0x1_0000_0000 * 10_000);
}

function decision({
  selected,
  reason,
  rolloutStage,
  thresholdBasisPoints,
  projectCohortBasisPoints,
}) {
  return Object.freeze({
    schemaVersion: CANARY_ROLLOUT_DECISION_SCHEMA_VERSION,
    selectorVersion: CANARY_ROLLOUT_SELECTOR_VERSION,
    selected,
    reason,
    rolloutStage,
    thresholdBasisPoints,
    cohortBasisPoints: projectCohortBasisPoints,
  });
}

function invalidDecision() {
  return decision({
    selected: false,
    reason: CANARY_ROLLOUT_REASONS.INVALID_INPUT,
    rolloutStage: null,
    thresholdBasisPoints: null,
    projectCohortBasisPoints: null,
  });
}

function createCanaryRolloutSelector(options = {}) {
  const fields = exactDataFields(options, OPTION_KEYS);
  const cohortSeed = fields && fields.get('cohortSeed');
  if (!fields || typeof cohortSeed !== 'string' || !cohortSeed
    || cohortSeed.length > 256 || cohortSeed.includes('\0')) {
    throw new TypeError('Canary rollout selector options require a bounded cohortSeed');
  }

  function select(value) {
    const input = normalizeInput(value);
    if (!input) return invalidDecision();
    const thresholdBasisPoints = STAGE_THRESHOLDS[input.rolloutStage];
    const projectCohortBasisPoints = cohortBasisPoints(cohortSeed, input.projectId);
    const build = (selected, reason) => decision({
      selected,
      reason,
      rolloutStage: input.rolloutStage,
      thresholdBasisPoints,
      projectCohortBasisPoints,
    });

    if (input.killSwitch) return build(false, CANARY_ROLLOUT_REASONS.KILL_SWITCH);
    if (input.configuredMode !== 'canary') {
      return build(false, CANARY_ROLLOUT_REASONS.MODE_NOT_CANARY);
    }
    if (input.projectPin === 'legacy') {
      return build(false, CANARY_ROLLOUT_REASONS.PINNED_LEGACY);
    }
    if (input.projectPin === 'canary') {
      return build(true, CANARY_ROLLOUT_REASONS.SELECTED_PROJECT_PIN);
    }
    if (!input.allowlisted) {
      return build(false, CANARY_ROLLOUT_REASONS.NOT_ALLOWLISTED);
    }
    if (input.internal) {
      return build(true, CANARY_ROLLOUT_REASONS.SELECTED_INTERNAL);
    }
    if (input.rolloutStage === CANARY_ROLLOUT_STAGES.INTERNAL) {
      return build(false, CANARY_ROLLOUT_REASONS.INTERNAL_ONLY);
    }
    if (projectCohortBasisPoints < thresholdBasisPoints) {
      return build(true, CANARY_ROLLOUT_REASONS.SELECTED_COHORT);
    }
    return build(false, CANARY_ROLLOUT_REASONS.OUTSIDE_COHORT);
  }

  function diagnostics() {
    return Object.freeze({
      version: CANARY_ROLLOUT_SELECTOR_VERSION,
      algorithm: CANARY_ROLLOUT_ALGORITHM,
      stages: Object.freeze({ ...STAGE_THRESHOLDS }),
    });
  }

  return Object.freeze({
    version: CANARY_ROLLOUT_SELECTOR_VERSION,
    select,
    diagnostics,
  });
}

module.exports = {
  CANARY_ROLLOUT_DECISION_SCHEMA_VERSION,
  CANARY_ROLLOUT_REASONS,
  CANARY_ROLLOUT_SELECTOR_VERSION,
  CANARY_ROLLOUT_STAGES,
  createCanaryRolloutSelector,
};
