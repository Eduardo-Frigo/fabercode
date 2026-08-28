'use strict';

const crypto = require('crypto');
const path = require('path');
const util = require('util');

const {
  HARNESS_RUNTIME_MODES,
} = require('./harness_runtime_config');

const DEFAULT_ON_ROLLOUT_POLICY_VERSION = 'default-on-rollout-policy.v1';
const DEFAULT_ON_ROLLOUT_SNAPSHOT_SCHEMA_VERSION =
  'default-on-rollout-snapshot.v1';
const DEFAULT_ON_MINIMUM_STABLE_VERSIONS = 2;

const DEFAULT_ON_ROLLOUT_REASONS = Object.freeze({
  DEFAULT_ON: 'default_on',
  INVALID_INPUT: 'invalid_input',
  KILL_SWITCH: 'kill_switch',
  PINNED_LEGACY: 'pinned_legacy',
  PINNED_V2: 'pinned_v2',
  STABILITY_GATE_NOT_MET: 'stability_gate_not_met',
  NOT_ALLOWLISTED: 'not_allowlisted',
  COHORT_NOT_APPROVED: 'cohort_not_approved',
  MODE_NOT_ON: 'mode_not_on',
});

const OPTION_KEYS = Object.freeze(['stableReleaseVersions']);
const INPUT_KEYS = Object.freeze([
  'jobId',
  'projectId',
  'canonicalRootPath',
  'configuredMode',
  'killSwitch',
  'projectPin',
  'allowlisted',
  'approvedCohort',
]);
const PROJECT_PINS = new Set([null, 'legacy', 'v2']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_RELEASE_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/;

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
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
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

function normalizeStableReleaseVersions(value) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || !Object.isFrozen(value) || value.length > 32) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== value.length + 1
    || keys[keys.length - 1] !== 'length') return null;
  const versions = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (keys[index] !== key) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string'
      || !SAFE_RELEASE_VERSION.test(descriptor.value)) return null;
    versions.push(descriptor.value);
  }
  if (new Set(versions).size !== versions.length) return null;
  return Object.freeze(versions);
}

function normalizeInput(value) {
  const fields = exactDataFields(value, INPUT_KEYS);
  if (!fields
    || typeof fields.get('jobId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('jobId'))
    || typeof fields.get('projectId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('projectId'))
    || typeof fields.get('canonicalRootPath') !== 'string'
    || !path.isAbsolute(fields.get('canonicalRootPath'))
    || fields.get('canonicalRootPath').includes('\0')
    || path.normalize(fields.get('canonicalRootPath'))
      !== fields.get('canonicalRootPath')
    || !HARNESS_RUNTIME_MODES.includes(fields.get('configuredMode'))
    || typeof fields.get('killSwitch') !== 'boolean'
    || !PROJECT_PINS.has(fields.get('projectPin'))
    || typeof fields.get('allowlisted') !== 'boolean'
    || typeof fields.get('approvedCohort') !== 'boolean') return null;
  return Object.freeze(Object.fromEntries(
    INPUT_KEYS.map((key) => [key, fields.get(key)])
  ));
}

function digestPolicy(input, stableReleaseVersions) {
  const canonical = JSON.stringify({
    schemaVersion: DEFAULT_ON_ROLLOUT_SNAPSHOT_SCHEMA_VERSION,
    policyVersion: DEFAULT_ON_ROLLOUT_POLICY_VERSION,
    jobId: input.jobId,
    projectId: input.projectId,
    canonicalRootPath: input.canonicalRootPath,
    flags: {
      configuredMode: input.configuredMode,
      killSwitch: input.killSwitch,
      projectPin: input.projectPin,
      allowlisted: input.allowlisted,
      approvedCohort: input.approvedCohort,
    },
    stableReleaseVersions,
  });
  return `sha256:${crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function createSnapshot({
  input,
  selectedKernel,
  reason,
  stableVersionCount,
  stabilityGateSatisfied,
  policyDigest,
}) {
  return Object.freeze({
    schemaVersion: DEFAULT_ON_ROLLOUT_SNAPSHOT_SCHEMA_VERSION,
    policyVersion: DEFAULT_ON_ROLLOUT_POLICY_VERSION,
    jobId: input ? input.jobId : null,
    projectId: input ? input.projectId : null,
    canonicalRootPath: input ? input.canonicalRootPath : null,
    selectedKernel,
    reason,
    flags: input ? Object.freeze({
      configuredMode: input.configuredMode,
      killSwitch: input.killSwitch,
      projectPin: input.projectPin,
      allowlisted: input.allowlisted,
      approvedCohort: input.approvedCohort,
    }) : null,
    releaseGate: Object.freeze({
      minimumStableVersions: DEFAULT_ON_MINIMUM_STABLE_VERSIONS,
      stableVersionCount,
      satisfied: stabilityGateSatisfied,
    }),
    policyDigest,
  });
}

function createConflictError() {
  const error = new Error('A rollout snapshot already exists for this job');
  error.code = 'ROLLOUT_SNAPSHOT_CONFLICT';
  return error;
}

function createDefaultOnRolloutPolicy(options = {}) {
  const fields = exactDataFields(options, OPTION_KEYS);
  const stableReleaseVersions = fields
    ? normalizeStableReleaseVersions(fields.get('stableReleaseVersions'))
    : null;
  if (!fields || !stableReleaseVersions) {
    throw new TypeError(
      'Default-on rollout policy options require frozen stableReleaseVersions'
    );
  }

  const stableVersionCount = stableReleaseVersions.length;
  const stabilityGateSatisfied = stableVersionCount
    >= DEFAULT_ON_MINIMUM_STABLE_VERSIONS;
  const snapshots = new Map();
  const diagnosticsSnapshot = Object.freeze({
    version: DEFAULT_ON_ROLLOUT_POLICY_VERSION,
    minimumStableVersions: DEFAULT_ON_MINIMUM_STABLE_VERSIONS,
    stableVersionCount,
    stabilityGateSatisfied,
    precedence: 'kill_switch>project_pin>allowlist>cohort>default',
    snapshotMode: 'job_bound_immutable',
  });

  function decide(input) {
    if (input.killSwitch) {
      return Object.freeze({
        selectedKernel: 'legacy',
        reason: DEFAULT_ON_ROLLOUT_REASONS.KILL_SWITCH,
      });
    }
    if (input.projectPin === 'legacy') {
      return Object.freeze({
        selectedKernel: 'legacy',
        reason: DEFAULT_ON_ROLLOUT_REASONS.PINNED_LEGACY,
      });
    }
    if (!stabilityGateSatisfied) {
      return Object.freeze({
        selectedKernel: 'legacy',
        reason: DEFAULT_ON_ROLLOUT_REASONS.STABILITY_GATE_NOT_MET,
      });
    }
    if (input.projectPin === 'v2') {
      return Object.freeze({
        selectedKernel: 'v2',
        reason: DEFAULT_ON_ROLLOUT_REASONS.PINNED_V2,
      });
    }
    if (!input.allowlisted) {
      return Object.freeze({
        selectedKernel: 'legacy',
        reason: DEFAULT_ON_ROLLOUT_REASONS.NOT_ALLOWLISTED,
      });
    }
    if (!input.approvedCohort) {
      return Object.freeze({
        selectedKernel: 'legacy',
        reason: DEFAULT_ON_ROLLOUT_REASONS.COHORT_NOT_APPROVED,
      });
    }
    if (input.configuredMode !== 'on') {
      return Object.freeze({
        selectedKernel: 'legacy',
        reason: DEFAULT_ON_ROLLOUT_REASONS.MODE_NOT_ON,
      });
    }
    return Object.freeze({
      selectedKernel: 'v2',
      reason: DEFAULT_ON_ROLLOUT_REASONS.DEFAULT_ON,
    });
  }

  function capture(value) {
    const input = normalizeInput(value);
    if (!input) {
      return createSnapshot({
        input: null,
        selectedKernel: 'legacy',
        reason: DEFAULT_ON_ROLLOUT_REASONS.INVALID_INPUT,
        stableVersionCount,
        stabilityGateSatisfied,
        policyDigest: null,
      });
    }
    const policyDigest = digestPolicy(input, stableReleaseVersions);
    const existing = snapshots.get(input.jobId);
    if (existing) {
      if (existing.policyDigest !== policyDigest) throw createConflictError();
      return existing;
    }
    const result = decide(input);
    const snapshot = createSnapshot({
      input,
      selectedKernel: result.selectedKernel,
      reason: result.reason,
      stableVersionCount,
      stabilityGateSatisfied,
      policyDigest,
    });
    snapshots.set(input.jobId, snapshot);
    return snapshot;
  }

  function get(jobId) {
    if (typeof jobId !== 'string' || !SAFE_IDENTIFIER.test(jobId)) return null;
    return snapshots.get(jobId) || null;
  }

  function diagnostics() {
    return diagnosticsSnapshot;
  }

  return Object.freeze({
    version: DEFAULT_ON_ROLLOUT_POLICY_VERSION,
    capture,
    get,
    diagnostics,
  });
}

module.exports = {
  DEFAULT_ON_ROLLOUT_POLICY_VERSION,
  DEFAULT_ON_ROLLOUT_REASONS,
  DEFAULT_ON_ROLLOUT_SNAPSHOT_SCHEMA_VERSION,
  createDefaultOnRolloutPolicy,
};
