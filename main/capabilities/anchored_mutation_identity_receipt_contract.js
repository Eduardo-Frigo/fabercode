'use strict';

const util = require('util');

const {
  immutableSnapshot,
} = require('./capability_delegation_contracts');
const {
  canonicalSha256Digest,
} = require('./transactional_delete_contracts');

const ANCHORED_MUTATION_IDENTITY_RECEIPT_VERSION =
  'anchored-mutation-identity-receipt.v1';

const LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxProperties: 200_000,
  maxTargets: 32,
  maxEntries: 36,
  maxPathLength: 4096,
  maxIdentifierLength: 256,
  maxFilesystemTypeLength: 128,
});

const RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'helperBuildId',
  'platform',
  'bindingDigest',
  'checkpointDigest',
  'rootIdentity',
  'namespaceIdentity',
  'targets',
  'entries',
  'targetSetIdentityDigest',
  'entrySetIdentityDigest',
  'receiptDigest',
]);
const CREATE_KEYS = Object.freeze(RECEIPT_KEYS.filter((key) => ![
  'schemaVersion',
  'targetSetIdentityDigest',
  'entrySetIdentityDigest',
  'receiptDigest',
].includes(key)));
const PLATFORM_KEYS = Object.freeze([
  'os',
  'architecture',
  'filesystemType',
  'capabilityDigest',
]);
const IDENTITY_KEYS = Object.freeze([
  'volumeIdentityDigest',
  'objectIdentityDigest',
  'generationIdentityDigest',
  'identityDigest',
]);
const TARGET_KEYS = Object.freeze([
  'relativePath',
  'payloadName',
  'kind',
  'identity',
  'closureDigest',
  'linkIdentityDigest',
]);
const ENTRY_KEYS = Object.freeze([
  'relativePath',
  'kind',
  'identity',
  'closureDigest',
  'linkIdentityDigest',
]);
const EXPECTED_KEYS = Object.freeze([
  'bindingDigest',
  'checkpointDigest',
  'targets',
  'checkpointEntries',
]);
const EXPECTED_TARGET_KEYS = Object.freeze(['relativePath', 'payloadName']);
const EXPECTED_ENTRY_KEYS = Object.freeze([
  'relativePath',
  'kind',
  'bytes',
  'mode',
  'mtimeMs',
  'contentDigest',
  'linkTarget',
]);
const SUPPORTED_OS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_KINDS = new Set(['directory', 'file', 'symlink']);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@+-]{1,256}$/;
const SAFE_PAYLOAD_NAME = /^[A-Za-z0-9._-]{1,256}$/;

function absorbNativePromise(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    // The intrinsic Promise operation identifies actual native Promises and
    // never consults a user-controlled `.then` property.
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
    return true;
  } catch {
    return false;
  }
}

function preflightDataGraph(root) {
  const seen = new Set();
  const stack = [{ depth: 0, value: root }];
  let bounded = true;
  let hasNativePromise = false;
  let inspectable = true;
  let nodeCount = 0;
  let propertyCount = 0;

  while (stack.length > 0) {
    const { depth, value } = stack.pop();
    if (absorbNativePromise(value)) {
      hasNativePromise = true;
      continue;
    }
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    nodeCount += 1;
    if (nodeCount > LIMITS.maxNodes || depth > LIMITS.maxDepth) {
      bounded = false;
      continue;
    }
    if (util.types.isProxy(value)) inspectable = false;

    let keys;
    try { keys = Reflect.ownKeys(value); } catch (error) {
      if (absorbNativePromise(error)) hasNativePromise = true;
      inspectable = false;
      continue;
    }
    propertyCount += keys.length;
    const mayDescend = propertyCount <= LIMITS.maxProperties;
    if (!mayDescend) bounded = false;
    for (const key of keys) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
        if (absorbNativePromise(error)) hasNativePromise = true;
        inspectable = false;
        continue;
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
      if (absorbNativePromise(descriptor.value)) {
        hasNativePromise = true;
      } else if (mayDescend && descriptor.value
        && (typeof descriptor.value === 'object' || typeof descriptor.value === 'function')) {
        stack.push({ depth: depth + 1, value: descriptor.value });
      }
    }
  }
  return Object.freeze({ bounded, hasNativePromise, inspectable });
}

function assertPreflight(value, fieldName) {
  const result = preflightDataGraph(value);
  if (result.hasNativePromise) {
    throw new TypeError(`${fieldName} must not contain native Promises`);
  }
  if (!result.bounded) throw new TypeError(`${fieldName} exceeded its data graph bound`);
  if (!result.inspectable) throw new TypeError(`${fieldName} must not contain a Proxy`);
}

function exactDataFields(value, keys, fieldName, { optional = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || util.types.isProxy(value)) {
    throw new TypeError(`${fieldName} must be a plain data record`);
  }
  let prototype;
  let ownKeys;
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    throw new TypeError(`${fieldName} must be inspectable plain data`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${fieldName} must have a plain prototype`);
  }
  if (ownKeys.some((key) => typeof key !== 'string')
    || ownKeys.some((key) => !keys.includes(key))
    || (!optional && (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))))) {
    throw new TypeError(`${fieldName} has an invalid exact shape`);
  }
  const fields = new Map();
  for (const key of ownKeys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      absorbNativePromise(error);
      throw new TypeError(`${fieldName}.${key} must be inspectable`);
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      throw new TypeError(`${fieldName}.${key} must be an enumerable data property`);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function denseDataValues(value, fieldName, maxLength) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${fieldName} must be a standard dense array`);
  }
  let keys;
  try { keys = Reflect.ownKeys(value).filter((key) => key !== 'length'); } catch (error) {
    absorbNativePromise(error);
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${fieldName} must be a standard dense array`);
  }
  if (value.length < 1 || value.length > maxLength) {
    throw new TypeError(`${fieldName} exceeded its hard bound of ${maxLength}`);
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName}[${key}] must be an enumerable data property`);
    }
    return descriptor.value;
  });
}

function normalizeDigest(value, fieldName, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw new TypeError(`${fieldName} must be a canonical SHA-256 digest`);
  }
  return value;
}

function normalizeIdentifier(value, fieldName, maxLength = LIMITS.maxIdentifierLength) {
  if (typeof value !== 'string' || !value || value.length > maxLength
    || value.includes('\0') || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${fieldName} must be a bounded stable identifier`);
  }
  return value;
}

function normalizeRelativePath(value, fieldName) {
  if (typeof value !== 'string' || !value || value.length > LIMITS.maxPathLength
    || value.includes('\0') || value.startsWith('/') || value.startsWith('\\')
    || value.includes('\\') || /^[A-Za-z]:/.test(value)) {
    throw new TypeError(`${fieldName} must be a bounded portable relative path`);
  }
  const components = value.split('/');
  if (components.some((component) => !component || component === '.' || component === '..')) {
    throw new TypeError(`${fieldName} must be an exact relative path`);
  }
  return value;
}

function normalizeKind(value, fieldName) {
  if (!SUPPORTED_KINDS.has(value)) throw new TypeError(`${fieldName} is invalid`);
  return value;
}

function normalizeIdentity(value, fieldName) {
  const fields = exactDataFields(value, IDENTITY_KEYS, fieldName);
  const core = {
    volumeIdentityDigest: normalizeDigest(
      fields.get('volumeIdentityDigest'),
      `${fieldName}.volumeIdentityDigest`
    ),
    objectIdentityDigest: normalizeDigest(
      fields.get('objectIdentityDigest'),
      `${fieldName}.objectIdentityDigest`
    ),
    generationIdentityDigest: normalizeDigest(
      fields.get('generationIdentityDigest'),
      `${fieldName}.generationIdentityDigest`
    ),
  };
  const identityDigest = canonicalSha256Digest(core);
  if (fields.get('identityDigest') !== identityDigest) {
    throw new TypeError(`${fieldName}.identityDigest is inconsistent`);
  }
  return { ...core, identityDigest };
}

function normalizeKindBindings(kind, closureValue, linkValue, fieldName) {
  if (kind === 'directory') {
    if (linkValue !== null) throw new TypeError(`${fieldName}.linkIdentityDigest must be null`);
    return {
      closureDigest: normalizeDigest(closureValue, `${fieldName}.closureDigest`),
      linkIdentityDigest: null,
    };
  }
  if (kind === 'symlink') {
    if (closureValue !== null) throw new TypeError(`${fieldName}.closureDigest must be null`);
    return {
      closureDigest: null,
      linkIdentityDigest: normalizeDigest(linkValue, `${fieldName}.linkIdentityDigest`),
    };
  }
  if (closureValue !== null || linkValue !== null) {
    throw new TypeError(`${fieldName} file identity bindings must be null`);
  }
  return { closureDigest: null, linkIdentityDigest: null };
}

function normalizeTarget(value, index) {
  const fieldName = `targets[${index}]`;
  const fields = exactDataFields(value, TARGET_KEYS, fieldName);
  const kind = normalizeKind(fields.get('kind'), `${fieldName}.kind`);
  return {
    relativePath: normalizeRelativePath(fields.get('relativePath'), `${fieldName}.relativePath`),
    payloadName: (() => {
      const payloadName = fields.get('payloadName');
      if (typeof payloadName !== 'string' || !SAFE_PAYLOAD_NAME.test(payloadName)
        || payloadName === '.' || payloadName === '..') {
        throw new TypeError(`${fieldName}.payloadName is invalid`);
      }
      return payloadName;
    })(),
    kind,
    identity: normalizeIdentity(fields.get('identity'), `${fieldName}.identity`),
    ...normalizeKindBindings(
      kind,
      fields.get('closureDigest'),
      fields.get('linkIdentityDigest'),
      fieldName
    ),
  };
}

function normalizeEntry(value, index) {
  const fieldName = `entries[${index}]`;
  const fields = exactDataFields(value, ENTRY_KEYS, fieldName);
  const kind = normalizeKind(fields.get('kind'), `${fieldName}.kind`);
  return {
    relativePath: normalizeRelativePath(fields.get('relativePath'), `${fieldName}.relativePath`),
    kind,
    identity: normalizeIdentity(fields.get('identity'), `${fieldName}.identity`),
    ...normalizeKindBindings(
      kind,
      fields.get('closureDigest'),
      fields.get('linkIdentityDigest'),
      fieldName
    ),
  };
}

function assertUnique(values, selector, fieldName) {
  const seen = new Set();
  for (const value of values) {
    const key = selector(value);
    if (seen.has(key)) throw new TypeError(`${fieldName} contains a duplicate or physical alias`);
    seen.add(key);
  }
}

function physicalObjectKey(identity) {
  return `${identity.volumeIdentityDigest}:${identity.objectIdentityDigest}`;
}

function normalizePlatform(value) {
  const fields = exactDataFields(value, PLATFORM_KEYS, 'identity receipt platform');
  const os = fields.get('os');
  if (!SUPPORTED_OS.has(os)) throw new TypeError('identity receipt platform.os is unsupported');
  return {
    os,
    architecture: normalizeIdentifier(fields.get('architecture'), 'identity receipt platform.architecture'),
    filesystemType: normalizeIdentifier(
      fields.get('filesystemType'),
      'identity receipt platform.filesystemType',
      LIMITS.maxFilesystemTypeLength
    ),
    capabilityDigest: normalizeDigest(
      fields.get('capabilityDigest'),
      'identity receipt platform.capabilityDigest'
    ),
  };
}

function createAnchoredMutationIdentityReceipt(input = {}) {
  assertPreflight(input, 'identity receipt input');
  const fields = exactDataFields(input, CREATE_KEYS, 'identity receipt input');
  const rootIdentity = normalizeIdentity(fields.get('rootIdentity'), 'rootIdentity');
  const namespaceIdentity = normalizeIdentity(fields.get('namespaceIdentity'), 'namespaceIdentity');
  if (physicalObjectKey(rootIdentity) === physicalObjectKey(namespaceIdentity)) {
    throw new TypeError('rootIdentity and namespaceIdentity must not be physical aliases');
  }
  const targets = denseDataValues(fields.get('targets'), 'targets', LIMITS.maxTargets)
    .map(normalizeTarget);
  const entries = denseDataValues(fields.get('entries'), 'entries', LIMITS.maxEntries)
    .map(normalizeEntry);

  assertUnique(targets, (target) => target.relativePath, 'targets');
  assertUnique(targets, (target) => target.payloadName, 'targets');
  assertUnique(targets, (target) => target.identity.identityDigest, 'targets');
  assertUnique(targets, (target) => physicalObjectKey(target.identity), 'targets');
  assertUnique(entries, (entry) => entry.relativePath, 'entries');
  assertUnique(entries, (entry) => entry.identity.identityDigest, 'entries');
  assertUnique(entries, (entry) => physicalObjectKey(entry.identity), 'entries');
  const reservedPhysicalObjects = new Set([
    physicalObjectKey(rootIdentity),
    physicalObjectKey(namespaceIdentity),
  ]);
  if (targets.some((target) => reservedPhysicalObjects.has(physicalObjectKey(target.identity)))
    || entries.some((entry) => reservedPhysicalObjects.has(physicalObjectKey(entry.identity)))) {
    throw new TypeError('receipt targets or entries alias the anchored root namespace');
  }

  const entriesByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
  for (const target of targets) {
    const entry = entriesByPath.get(target.relativePath);
    if (!entry || entry.kind !== target.kind
      || entry.identity.identityDigest !== target.identity.identityDigest
      || entry.closureDigest !== target.closureDigest
      || entry.linkIdentityDigest !== target.linkIdentityDigest) {
      throw new TypeError('target identity must match its checkpoint entry identity');
    }
  }
  for (const entry of entries) {
    const owner = targets.find((target) => (
      entry.relativePath === target.relativePath
      || (target.kind === 'directory' && entry.relativePath.startsWith(`${target.relativePath}/`))
    ));
    if (!owner) throw new TypeError('receipt entries must belong to an exact target closure');
  }

  const targetSetIdentityDigest = canonicalSha256Digest(targets);
  const entrySetIdentityDigest = canonicalSha256Digest(entries);
  const core = {
    schemaVersion: ANCHORED_MUTATION_IDENTITY_RECEIPT_VERSION,
    helperBuildId: normalizeIdentifier(fields.get('helperBuildId'), 'helperBuildId'),
    platform: normalizePlatform(fields.get('platform')),
    bindingDigest: normalizeDigest(fields.get('bindingDigest'), 'bindingDigest'),
    checkpointDigest: normalizeDigest(fields.get('checkpointDigest'), 'checkpointDigest'),
    rootIdentity,
    namespaceIdentity,
    targets,
    entries,
    targetSetIdentityDigest,
    entrySetIdentityDigest,
  };
  return immutableSnapshot({ ...core, receiptDigest: canonicalSha256Digest(core) });
}

function normalizeExpectedTargets(value) {
  return denseDataValues(value, 'expected targets', LIMITS.maxTargets).map((target, index) => {
    const fields = exactDataFields(target, EXPECTED_TARGET_KEYS, `expected targets[${index}]`);
    return {
      relativePath: normalizeRelativePath(
        fields.get('relativePath'),
        `expected targets[${index}].relativePath`
      ),
      payloadName: (() => {
        const name = fields.get('payloadName');
        if (typeof name !== 'string' || !SAFE_PAYLOAD_NAME.test(name)
          || name === '.' || name === '..') {
          throw new TypeError(`expected targets[${index}].payloadName is invalid`);
        }
        return name;
      })(),
    };
  });
}

function normalizeExpectedEntries(value) {
  return denseDataValues(value, 'expected checkpointEntries', LIMITS.maxEntries)
    .map((entry, index) => {
      const fields = exactDataFields(
        entry,
        EXPECTED_ENTRY_KEYS,
        `expected checkpointEntries[${index}]`
      );
      return {
        relativePath: normalizeRelativePath(
          fields.get('relativePath'),
          `expected checkpointEntries[${index}].relativePath`
        ),
        kind: normalizeKind(fields.get('kind'), `expected checkpointEntries[${index}].kind`),
      };
    });
}

function assertAnchoredMutationIdentityReceipt(receipt, expected = {}) {
  assertPreflight(receipt, 'identity receipt');
  assertPreflight(expected, 'identity receipt expectations');
  const fields = exactDataFields(receipt, RECEIPT_KEYS, 'identity receipt');
  if (fields.get('schemaVersion') !== ANCHORED_MUTATION_IDENTITY_RECEIPT_VERSION) {
    throw new TypeError('identity receipt schemaVersion is unsupported');
  }
  const normalized = createAnchoredMutationIdentityReceipt({
    helperBuildId: fields.get('helperBuildId'),
    platform: fields.get('platform'),
    bindingDigest: fields.get('bindingDigest'),
    checkpointDigest: fields.get('checkpointDigest'),
    rootIdentity: fields.get('rootIdentity'),
    namespaceIdentity: fields.get('namespaceIdentity'),
    targets: fields.get('targets'),
    entries: fields.get('entries'),
  });
  for (const digestField of [
    'targetSetIdentityDigest',
    'entrySetIdentityDigest',
    'receiptDigest',
  ]) {
    if (fields.get(digestField) !== normalized[digestField]) {
      throw new TypeError(`identity receipt ${digestField} is inconsistent`);
    }
  }

  const expectedFields = exactDataFields(
    expected,
    EXPECTED_KEYS,
    'identity receipt expectations',
    { optional: true }
  );
  if (expectedFields.has('bindingDigest')
    && normalizeDigest(expectedFields.get('bindingDigest'), 'expected bindingDigest')
      !== normalized.bindingDigest) {
    throw new TypeError('identity receipt bindingDigest does not match the expected binding');
  }
  if (expectedFields.has('checkpointDigest')
    && normalizeDigest(expectedFields.get('checkpointDigest'), 'expected checkpointDigest')
      !== normalized.checkpointDigest) {
    throw new TypeError('identity receipt checkpointDigest does not match the expected checkpoint');
  }
  let expectedTargets = null;
  if (expectedFields.has('targets')) {
    expectedTargets = normalizeExpectedTargets(expectedFields.get('targets'));
    const actualTargets = normalized.targets.map(({ relativePath, payloadName }) => ({
      relativePath,
      payloadName,
    }));
    if (canonicalSha256Digest(expectedTargets) !== canonicalSha256Digest(actualTargets)) {
      throw new TypeError('identity receipt targets do not match the expected targets');
    }
  }
  if (expectedFields.has('checkpointEntries')) {
    const expectedEntries = normalizeExpectedEntries(expectedFields.get('checkpointEntries'));
    const actualEntries = normalized.entries.map(({ relativePath, kind }) => ({ relativePath, kind }));
    if (canonicalSha256Digest(expectedEntries) !== canonicalSha256Digest(actualEntries)) {
      throw new TypeError('identity receipt entries do not match the expected checkpointEntries');
    }
    const kindByPath = new Map(expectedEntries.map((entry) => [entry.relativePath, entry.kind]));
    if (normalized.targets.some((target) => kindByPath.get(target.relativePath) !== target.kind)) {
      throw new TypeError('identity receipt target kinds do not match checkpointEntries');
    }
  }
  return normalized;
}

module.exports = {
  ANCHORED_MUTATION_IDENTITY_RECEIPT_VERSION,
  assertAnchoredMutationIdentityReceipt,
  createAnchoredMutationIdentityReceipt,
};
