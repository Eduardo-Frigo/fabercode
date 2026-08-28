'use strict';

const path = require('path');
const util = require('util');

const {
  DEFAULT_ON_ROLLOUT_RUNTIME_CONFIG_VERSION,
} = require('../runtime/default_on_rollout_runtime_config');

const DEFAULT_ON_ROLLOUT_FACTS_SERVICE_VERSION =
  'default-on-rollout-facts-service.v1';
const OPTION_KEYS = Object.freeze([
  'runtimeConfig',
  'authorizeProjectBinding',
]);
const IDENTITY_KEYS = Object.freeze(['jobId', 'projectId', 'rootPath']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const VALID_ENTRY_TYPES = new Set(['directory', 'symlink']);
const DENIED_FACTS = Object.freeze({
  projectPin: 'legacy',
  allowlisted: false,
  approvedCohort: false,
});

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

function dataFields(value, expectedKeys, { exact = true, frozen = false } = {}) {
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

function inspectableSynchronousFunction(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isAsyncFunction(value)
    || util.types.isGeneratorFunction(value)) {
    throw new TypeError(`${fieldName} must be an inspectable synchronous function`);
  }
  try {
    Function.prototype.toString.call(value);
  } catch {
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  return value;
}

function denseFrozenStrings(value) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || !Object.isFrozen(value)) return null;
  const output = [];
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== value.length + 1 || keys[keys.length - 1] !== 'length') {
    return null;
  }
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = keys[index] === key
      ? Object.getOwnPropertyDescriptor(value, key) : null;
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string') return null;
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function normalizeRuntimeConfig(value) {
  if (!isPlainRecord(value) || !Object.isFrozen(value)
    || value.version !== DEFAULT_ON_ROLLOUT_RUNTIME_CONFIG_VERSION
    || typeof value.valid !== 'boolean') return null;
  const allowedProjectIds = denseFrozenStrings(value.allowedProjectIds);
  const approvedCohortProjectIds = denseFrozenStrings(
    value.approvedCohortProjectIds
  );
  const pinValues = Array.isArray(value.projectPins)
    && Object.isFrozen(value.projectPins)
    ? value.projectPins : null;
  if (!allowedProjectIds || !approvedCohortProjectIds || !pinValues) return null;
  const projectPins = new Map();
  for (const record of pinValues) {
    const fields = dataFields(record, ['projectId', 'pin'], { frozen: true });
    if (!fields || !SAFE_IDENTIFIER.test(fields.get('projectId'))
      || !['legacy', 'v2'].includes(fields.get('pin'))
      || projectPins.has(fields.get('projectId'))) return null;
    projectPins.set(fields.get('projectId'), fields.get('pin'));
  }
  return Object.freeze({
    valid: value.valid,
    allowedProjectIds: new Set(allowedProjectIds),
    approvedCohortProjectIds: new Set(approvedCohortProjectIds),
    projectPins,
  });
}

function normalizeIdentity(value) {
  const fields = dataFields(value, IDENTITY_KEYS, { frozen: true });
  if (!fields || !SAFE_IDENTIFIER.test(fields.get('jobId'))
    || !SAFE_IDENTIFIER.test(fields.get('projectId'))
    || typeof fields.get('rootPath') !== 'string'
    || !path.isAbsolute(fields.get('rootPath'))
    || fields.get('rootPath').includes('\0')) return null;
  return Object.freeze({
    jobId: fields.get('jobId'),
    projectId: fields.get('projectId'),
    rootPath: path.normalize(fields.get('rootPath')),
  });
}

function validPhysicalRootIdentity(value) {
  const fields = dataFields(
    value,
    ['device', 'inode', 'entryDevice', 'entryInode', 'entryType'],
    { exact: true }
  );
  return Boolean(fields && VALID_ENTRY_TYPES.has(fields.get('entryType'))
    && ['device', 'inode', 'entryDevice', 'entryInode'].every((key) => (
      typeof fields.get(key) === 'string'
      && Boolean(fields.get(key))
      && !fields.get(key).includes('\0')
    )));
}

function authorizationMatches(value, identity) {
  const fields = dataFields(value, [
    'ok',
    'authorized',
    'projectId',
    'rootPath',
    'canonicalRootPath',
    'realRootPath',
    'physicalRootIdentity',
  ]);
  return Boolean(fields
    && fields.get('ok') === true
    && fields.get('authorized') === true
    && fields.get('projectId') === identity.projectId
    && fields.get('rootPath') === identity.rootPath
    && fields.get('canonicalRootPath') === identity.rootPath
    && typeof fields.get('realRootPath') === 'string'
    && path.isAbsolute(fields.get('realRootPath'))
    && validPhysicalRootIdentity(fields.get('physicalRootIdentity')));
}

function createDefaultOnRolloutFactsService(options = {}) {
  const fields = dataFields(options, OPTION_KEYS);
  if (!fields) {
    throw new TypeError('Invalid default-on rollout facts service options');
  }
  const runtimeConfig = normalizeRuntimeConfig(fields.get('runtimeConfig'));
  if (!runtimeConfig) {
    throw new TypeError('Invalid default-on rollout facts runtimeConfig');
  }
  const authorizeProjectBinding = inspectableSynchronousFunction(
    fields.get('authorizeProjectBinding'),
    'authorizeProjectBinding'
  );
  const diagnosticsSnapshot = Object.freeze({
    version: DEFAULT_ON_ROLLOUT_FACTS_SERVICE_VERSION,
    failureMode: 'deny',
    bindingMode: 'exact_authorized_project_root',
    allowedProjectCount: runtimeConfig.allowedProjectIds.size,
    approvedCohortCount: runtimeConfig.approvedCohortProjectIds.size,
    projectPinCount: runtimeConfig.projectPins.size,
  });

  function resolve(value) {
    const identity = normalizeIdentity(value);
    if (!runtimeConfig.valid || !identity) return DENIED_FACTS;
    let authorization;
    try {
      authorization = Reflect.apply(authorizeProjectBinding, undefined, [
        identity.projectId,
        identity.rootPath,
      ]);
    } catch {
      return DENIED_FACTS;
    }
    if (util.types.isPromise(authorization)) {
      try {
        Reflect.apply(Promise.prototype.then, authorization, [() => {}, () => {}]);
      } catch { /* invalid asynchronous authorization remains denied */ }
      return DENIED_FACTS;
    }
    if (!authorizationMatches(authorization, identity)) return DENIED_FACTS;
    return Object.freeze({
      projectPin: runtimeConfig.projectPins.get(identity.projectId) || null,
      allowlisted: runtimeConfig.allowedProjectIds.has(identity.projectId),
      approvedCohort: runtimeConfig.approvedCohortProjectIds.has(
        identity.projectId
      ),
    });
  }

  function diagnostics() {
    return diagnosticsSnapshot;
  }

  return Object.freeze({
    version: DEFAULT_ON_ROLLOUT_FACTS_SERVICE_VERSION,
    resolve,
    diagnostics,
  });
}

module.exports = {
  DEFAULT_ON_ROLLOUT_FACTS_SERVICE_VERSION,
  createDefaultOnRolloutFactsService,
};
