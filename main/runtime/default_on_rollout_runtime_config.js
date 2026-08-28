'use strict';

const util = require('util');

const DEFAULT_ON_ROLLOUT_RUNTIME_CONFIG_VERSION =
  'default-on-rollout-runtime-config.v1';
const INVALID_WARNING =
  'Default-on rollout manifest is invalid; legacy routing remains active.';
const OPTION_KEYS = Object.freeze(['env']);
const ENVIRONMENT_KEYS = Object.freeze([
  'FABER_HARNESS_V2_STABLE_RELEASES',
  'FABER_HARNESS_V2_ALLOWED_PROJECTS',
  'FABER_HARNESS_V2_APPROVED_COHORT',
  'FABER_HARNESS_V2_PROJECT_PINS',
]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_RELEASE_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/;
const MAX_MANIFEST_FIELD_BYTES = 16 * 1024;
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

function readEnvironmentValue(env, key) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(env, key);
  } catch {
    return Object.freeze({ present: false, valid: false, value: '' });
  }
  if (!descriptor) {
    return Object.freeze({ present: false, valid: true, value: '' });
  }
  if (!Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'string'
    || descriptor.value.includes('\0')
    || Buffer.byteLength(descriptor.value, 'utf8') > MAX_MANIFEST_FIELD_BYTES) {
    return Object.freeze({ present: true, valid: false, value: '' });
  }
  return Object.freeze({
    present: true,
    valid: true,
    value: descriptor.value,
  });
}

function parseList(rawValue, pattern) {
  if (!rawValue.trim()) return Object.freeze([]);
  const values = rawValue.split(',').map((value) => value.trim());
  if (values.some((value) => !pattern.test(value))
    || new Set(values).size !== values.length) return null;
  return Object.freeze(values);
}

function parsePins(rawValue) {
  if (!rawValue.trim()) return Object.freeze([]);
  const records = [];
  const projectIds = new Set();
  for (const rawEntry of rawValue.split(',')) {
    const parts = rawEntry.trim().split('=');
    if (parts.length !== 2) return null;
    const projectId = parts[0].trim();
    const pin = parts[1].trim();
    if (!SAFE_IDENTIFIER.test(projectId)
      || !['legacy', 'v2'].includes(pin)
      || projectIds.has(projectId)) return null;
    projectIds.add(projectId);
    records.push(Object.freeze({ projectId, pin }));
  }
  return Object.freeze(records);
}

function frozenEmptyArray() {
  return Object.freeze([]);
}

function createConfig({
  requested,
  valid,
  stableReleaseVersions,
  allowedProjectIds,
  approvedCohortProjectIds,
  projectPins,
}) {
  const warnings = Object.freeze(valid ? [] : [INVALID_WARNING]);
  const safeStableReleaseVersions = valid
    ? stableReleaseVersions : frozenEmptyArray();
  const safeAllowedProjectIds = valid
    ? allowedProjectIds : frozenEmptyArray();
  const safeApprovedCohortProjectIds = valid
    ? approvedCohortProjectIds : frozenEmptyArray();
  const safeProjectPins = valid ? projectPins : frozenEmptyArray();
  const diagnostics = Object.freeze({
    source: requested ? 'env' : 'default',
    requested,
    valid,
    stableVersionCount: safeStableReleaseVersions.length,
    allowedProjectCount: safeAllowedProjectIds.length,
    approvedCohortCount: safeApprovedCohortProjectIds.length,
    projectPinCount: safeProjectPins.length,
    warnings,
  });
  return Object.freeze({
    version: DEFAULT_ON_ROLLOUT_RUNTIME_CONFIG_VERSION,
    requested,
    valid,
    stableReleaseVersions: safeStableReleaseVersions,
    allowedProjectIds: safeAllowedProjectIds,
    approvedCohortProjectIds: safeApprovedCohortProjectIds,
    projectPins: safeProjectPins,
    diagnostics,
  });
}

function createDefaultOnRolloutRuntimeConfig(options = {}) {
  const fields = exactDataFields(options, OPTION_KEYS);
  const env = fields && fields.get('env');
  if (!fields || !isPlainRecord(env)) {
    throw new TypeError('Invalid default-on rollout runtime config options');
  }
  const raw = Object.fromEntries(
    ENVIRONMENT_KEYS.map((key) => [key, readEnvironmentValue(env, key)])
  );
  const requested = ENVIRONMENT_KEYS.some((key) => raw[key].present);
  const rawValuesValid = ENVIRONMENT_KEYS.every((key) => raw[key].valid);
  const stableReleaseVersions = rawValuesValid
    ? parseList(raw.FABER_HARNESS_V2_STABLE_RELEASES.value, SAFE_RELEASE_VERSION)
    : null;
  const allowedProjectIds = rawValuesValid
    ? parseList(raw.FABER_HARNESS_V2_ALLOWED_PROJECTS.value, SAFE_IDENTIFIER)
    : null;
  const approvedCohortProjectIds = rawValuesValid
    ? parseList(raw.FABER_HARNESS_V2_APPROVED_COHORT.value, SAFE_IDENTIFIER)
    : null;
  const projectPins = rawValuesValid
    ? parsePins(raw.FABER_HARNESS_V2_PROJECT_PINS.value)
    : null;
  const approvedSubset = Boolean(allowedProjectIds && approvedCohortProjectIds
    && approvedCohortProjectIds.every((projectId) => (
      allowedProjectIds.includes(projectId)
    )));
  const valid = Boolean(rawValuesValid
    && stableReleaseVersions
    && allowedProjectIds
    && approvedCohortProjectIds
    && projectPins
    && approvedSubset);
  return createConfig({
    requested,
    valid,
    stableReleaseVersions,
    allowedProjectIds,
    approvedCohortProjectIds,
    projectPins,
  });
}

module.exports = {
  DEFAULT_ON_ROLLOUT_RUNTIME_CONFIG_VERSION,
  createDefaultOnRolloutRuntimeConfig,
};
