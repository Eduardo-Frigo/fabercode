'use strict';

const crypto = require('crypto');

const {
  HARD_MAX_DELEGATION_CONSTRAINTS,
  immutableSnapshot,
  normalizeDigest,
} = require('./capability_delegation_contracts');

const TRANSACTIONAL_DELETE_CONTRACT_VERSION = 'transactional-delete.v1';
const TRANSACTIONAL_DELETE_PUBLIC_REQUEST_SCHEMA_VERSION = 'transactional-delete.public-request.v1';
const TRANSACTIONAL_DELETE_IMPACT_SCHEMA_VERSION = 'transactional-delete.impact.v1';
const TRANSACTIONAL_DELETE_PLAN_SCHEMA_VERSION = 'transactional-delete.plan.v1';
const TRANSACTIONAL_DELETE_CHECKPOINT_MANIFEST_SCHEMA_VERSION = 'transactional-delete.checkpoint-manifest.v1';
const TRANSACTIONAL_DELETE_STATE_RECORD_SCHEMA_VERSION = 'transactional-delete.state-record.v1';
const TRANSACTIONAL_DELETE_PUBLIC_RESULT_SCHEMA_VERSION = 'transactional-delete.public-result.v1';

const TRANSACTIONAL_DELETE_PATH_STYLES = Object.freeze({
  POSIX: 'posix',
  WINDOWS: 'windows',
});

const TRANSACTIONAL_DELETE_ENTRY_KINDS = Object.freeze({
  DIRECTORY: 'directory',
  FILE: 'file',
  SYMLINK: 'symlink',
});

const TRANSACTIONAL_DELETE_STATES = Object.freeze({
  PREPARING: 'PREPARING',
  PREPARED: 'PREPARED',
  APPLYING: 'APPLYING',
  COMMITTED: 'COMMITTED',
  ROLLING_BACK: 'ROLLING_BACK',
  ROLLED_BACK: 'ROLLED_BACK',
  PURGING: 'PURGING',
  PURGED: 'PURGED',
  RECOVERY_PRE_COMMIT: 'RECOVERY_PRE_COMMIT',
  RECOVERY_POST_COMMIT: 'RECOVERY_POST_COMMIT',
});

const TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES = Object.freeze({
  COMPLETED: 'completed',
  DENIED: 'denied',
  FAILED: 'failed',
});

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SUPPORTED_PATH_STYLES = new Set(Object.values(TRANSACTIONAL_DELETE_PATH_STYLES));
const SUPPORTED_ENTRY_KINDS = new Set(Object.values(TRANSACTIONAL_DELETE_ENTRY_KINDS));
const SUPPORTED_STATES = new Set(Object.values(TRANSACTIONAL_DELETE_STATES));
const SUPPORTED_PUBLIC_RESULT_STATUSES = new Set(
  Object.values(TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES)
);
const MAX_EXACT_PATH_LENGTH = 4096;
const SAFE_REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/;
const GLOB_PATTERN = /[*?\[\]{}]|(?:^|\/)\.?[@+!]\(/;
const WINDOWS_ABSOLUTE_OR_DEVICE_PATTERN = /^(?:[A-Za-z]:|\/\/|\\\\|\\[?.]\\|\/)/;
const WINDOWS_FORBIDDEN_COMPONENT_PATTERN = /[<>:"|\u0000-\u001F]/;
const WINDOWS_RESERVED_COMPONENT_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

const ALLOWED_STATE_TRANSITIONS = Object.freeze({
  [TRANSACTIONAL_DELETE_STATES.PREPARING]: Object.freeze([
    TRANSACTIONAL_DELETE_STATES.PREPARED,
    TRANSACTIONAL_DELETE_STATES.ROLLING_BACK,
    TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT,
  ]),
  [TRANSACTIONAL_DELETE_STATES.PREPARED]: Object.freeze([
    TRANSACTIONAL_DELETE_STATES.APPLYING,
    TRANSACTIONAL_DELETE_STATES.ROLLING_BACK,
    TRANSACTIONAL_DELETE_STATES.PURGING,
    TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT,
  ]),
  [TRANSACTIONAL_DELETE_STATES.APPLYING]: Object.freeze([
    TRANSACTIONAL_DELETE_STATES.COMMITTED,
    TRANSACTIONAL_DELETE_STATES.ROLLING_BACK,
    TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT,
  ]),
  [TRANSACTIONAL_DELETE_STATES.COMMITTED]: Object.freeze([
    // COMMITTED means the paths are quarantined, not yet permanently purged.
    // A failed/cancelled job must therefore still be able to restore them.
    TRANSACTIONAL_DELETE_STATES.ROLLING_BACK,
    TRANSACTIONAL_DELETE_STATES.PURGING,
    TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT,
  ]),
  [TRANSACTIONAL_DELETE_STATES.ROLLING_BACK]: Object.freeze([
    TRANSACTIONAL_DELETE_STATES.ROLLED_BACK,
    TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT,
  ]),
  [TRANSACTIONAL_DELETE_STATES.ROLLED_BACK]: Object.freeze([
    TRANSACTIONAL_DELETE_STATES.PURGING,
    TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT,
  ]),
  [TRANSACTIONAL_DELETE_STATES.PURGING]: Object.freeze([
    TRANSACTIONAL_DELETE_STATES.PURGED,
    TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT,
  ]),
  [TRANSACTIONAL_DELETE_STATES.PURGED]: Object.freeze([]),
  [TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT]: Object.freeze([
    TRANSACTIONAL_DELETE_STATES.ROLLING_BACK,
  ]),
  [TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT]: Object.freeze([
    TRANSACTIONAL_DELETE_STATES.PURGING,
  ]),
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ownEnumerableDataKeys(value, fieldName) {
  const isArray = Array.isArray(value);
  const enumerableKeys = Object.keys(value);
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (isArray && key === 'length') continue;
    if (typeof key !== 'string') {
      throw new TypeError(`${fieldName} must not contain symbol keys`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain enumerable data properties only`);
    }
  }
  if (ownKeys.length !== enumerableKeys.length + (isArray ? 1 : 0)) {
    throw new TypeError(`${fieldName} contains unsupported own properties`);
  }
  return enumerableKeys;
}

function assertPlainRecord(value, fieldName) {
  if (!isRecord(value)) throw new TypeError(`${fieldName} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${fieldName} must be a plain object`);
  }
  ownEnumerableDataKeys(value, fieldName);
  return value;
}

function assertOnlyKeys(value, allowedKeys, fieldName) {
  const keys = ownEnumerableDataKeys(value, fieldName);
  for (const key of keys) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new TypeError(`${fieldName} contains forbidden key: ${key}`);
    }
    if (!allowedKeys.includes(key)) {
      throw new TypeError(`${fieldName} contains unsupported field: ${key}`);
    }
    if (value[key] === undefined) {
      throw new TypeError(`${fieldName} must not contain undefined`);
    }
  }
  return keys;
}

function assertDenseArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${fieldName} must be a plain array`);
  }
  const keys = ownEnumerableDataKeys(value, fieldName);
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${fieldName} must be a dense array with indexed values only`);
  }
  return value;
}

function normalizePathStyle(value) {
  if (!SUPPORTED_PATH_STYLES.has(value)) {
    throw new TypeError('pathStyle must be posix or windows');
  }
  return value;
}

function normalizeCaseSensitivity(value) {
  if (typeof value !== 'boolean') throw new TypeError('caseSensitive must be a trusted boolean');
  return value;
}

function pathComparisonKey(value, caseSensitive) {
  const normalized = value.normalize('NFC');
  if (caseSensitive) return normalized;
  // JavaScript has no full Unicode CaseFolding API. Uppercase followed by
  // lowercase closes important filesystem aliases that lowercase alone misses
  // (for example Greek final sigma ς versus σ) while physical identity is
  // still rechecked by the transactional filesystem planner.
  return normalized.toUpperCase().toLowerCase().normalize('NFC');
}

function compareExactPaths(left, right, caseSensitive) {
  const leftKey = pathComparisonKey(left, caseSensitive);
  const rightKey = pathComparisonKey(right, caseSensitive);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return left < right ? -1 : (left > right ? 1 : 0);
}

function normalizeExactRelativePath(value, pathStyle, fieldName = 'path') {
  normalizePathStyle(pathStyle);
  if (typeof value !== 'string' || !value || value.length > MAX_EXACT_PATH_LENGTH) {
    throw new TypeError(`${fieldName} must be a non-empty relative path`);
  }
  if (value.includes('\0')) throw new TypeError(`${fieldName} must not contain NUL`);
  if (value.trim() !== value) throw new TypeError(`${fieldName} must not require trimming`);
  if (value === '.' || value === '..') throw new TypeError(`${fieldName} must not resolve to project root`);
  if (value.includes('\\')) {
    throw new TypeError(`${fieldName} contains an ambiguous path separator`);
  }
  if (WINDOWS_ABSOLUTE_OR_DEVICE_PATTERN.test(value)) {
    throw new TypeError(`${fieldName} must not be absolute, UNC, drive-relative, or a device path`);
  }
  if (value.includes('//') || value.endsWith('/')) {
    throw new TypeError(`${fieldName} contains ambiguous or empty path components`);
  }
  if (GLOB_PATTERN.test(value)) throw new TypeError(`${fieldName} must not contain glob syntax`);

  const components = value.split('/');
  if (components.some((component) => !component || component === '.' || component === '..')) {
    throw new TypeError(`${fieldName} must be an exact relative path without traversal`);
  }
  if (pathStyle === TRANSACTIONAL_DELETE_PATH_STYLES.WINDOWS) {
    for (const component of components) {
      if (WINDOWS_FORBIDDEN_COMPONENT_PATTERN.test(component)
        || WINDOWS_RESERVED_COMPONENT_PATTERN.test(component)
        || /[ .]$/.test(component)) {
        throw new TypeError(`${fieldName} is not an exact Windows project path`);
      }
    }
  }
  return value;
}

function isProtectedTransactionalDeletePath(value, pathStyle) {
  const exactPath = normalizeExactRelativePath(value, pathStyle);
  // Protected Faber and secret metadata is denied regardless of host volume casing.
  const key = pathComparisonKey(exactPath, false);
  const components = key.split('/');
  if (components.some((component) => (
    component === '.git'
    || component === '.faber'
    || component === '.ssh'
    || component === 'private_context'
    || component.startsWith('.env')
  ))) return true;
  return key === 'docs/application-map'
    || key.startsWith('docs/application-map/')
    || key === 'docs/milestones'
    || key.startsWith('docs/milestones/')
    || key === 'map assets'
    || key.startsWith('map assets/');
}

function normalizeExactRelativePaths(input, pathStyle, {
  caseSensitive,
  fieldName = 'paths',
  maxPaths = HARD_MAX_DELEGATION_CONSTRAINTS.maxFilesPerDecision,
  rejectRelations = true,
} = {}) {
  normalizeCaseSensitivity(caseSensitive);
  assertDenseArray(input, fieldName);
  if (input.length < 1 || input.length > maxPaths) {
    throw new TypeError(`${fieldName} must contain between 1 and ${maxPaths} exact paths`);
  }
  const paths = input.map((entry, index) => {
    const exactPath = normalizeExactRelativePath(entry, pathStyle, `${fieldName}[${index}]`);
    if (isProtectedTransactionalDeletePath(exactPath, pathStyle)) {
      throw new TypeError(`${fieldName}[${index}] is a protected project path`);
    }
    return exactPath;
  }).sort((left, right) => compareExactPaths(left, right, caseSensitive));

  for (let index = 1; index < paths.length; index += 1) {
    const previous = pathComparisonKey(paths[index - 1], caseSensitive);
    const current = pathComparisonKey(paths[index], caseSensitive);
    if (previous === current) throw new TypeError(`${fieldName} must not contain duplicate paths`);
  }
  if (rejectRelations) {
    for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
      const left = pathComparisonKey(paths[leftIndex], caseSensitive);
      for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
        const right = pathComparisonKey(paths[rightIndex], caseSensitive);
        if (right.startsWith(`${left}/`) || left.startsWith(`${right}/`)) {
          throw new TypeError(`${fieldName} must not contain ancestor and descendant paths`);
        }
      }
    }
  }
  return Object.freeze(paths);
}

function canonicalSha256Digest(value) {
  const canonicalJson = JSON.stringify(immutableSnapshot(value));
  return `sha256:${crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex')}`;
}

function normalizeNonNegativeSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeTimestamp(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`${fieldName} must be a non-negative finite timestamp`);
  }
  return value;
}

function createTransactionalDeletePublicRequest(
  input = {},
  { pathStyle: trustedPathStyle, caseSensitive: trustedCaseSensitive } = {}
) {
  assertPlainRecord(input, 'delete request');
  assertOnlyKeys(input, ['schemaVersion', 'contractVersion', 'paths'], 'delete request');
  if (input.schemaVersion !== undefined
    && input.schemaVersion !== TRANSACTIONAL_DELETE_PUBLIC_REQUEST_SCHEMA_VERSION) {
    throw new TypeError('Unsupported delete request schemaVersion');
  }
  if (input.contractVersion !== undefined
    && input.contractVersion !== TRANSACTIONAL_DELETE_CONTRACT_VERSION) {
    throw new TypeError('Unsupported delete request contractVersion');
  }
  const pathStyle = normalizePathStyle(trustedPathStyle);
  const caseSensitive = normalizeCaseSensitivity(trustedCaseSensitive);
  const paths = normalizeExactRelativePaths(input.paths, pathStyle, { caseSensitive });
  return immutableSnapshot({
    schemaVersion: TRANSACTIONAL_DELETE_PUBLIC_REQUEST_SCHEMA_VERSION,
    contractVersion: TRANSACTIONAL_DELETE_CONTRACT_VERSION,
    paths,
  });
}

function createTransactionalDeleteImpact(input = {}) {
  assertPlainRecord(input, 'delete impact');
  assertOnlyKeys(
    input,
    ['schemaVersion', 'contractVersion', 'files', 'bytes', 'directories'],
    'delete impact'
  );
  if (input.schemaVersion !== undefined
    && input.schemaVersion !== TRANSACTIONAL_DELETE_IMPACT_SCHEMA_VERSION) {
    throw new TypeError('Unsupported delete impact schemaVersion');
  }
  if (input.contractVersion !== undefined
    && input.contractVersion !== TRANSACTIONAL_DELETE_CONTRACT_VERSION) {
    throw new TypeError('Unsupported delete impact contractVersion');
  }
  const files = normalizeNonNegativeSafeInteger(input.files, 'impact.files');
  const bytes = normalizeNonNegativeSafeInteger(input.bytes, 'impact.bytes');
  const directories = normalizeNonNegativeSafeInteger(input.directories, 'impact.directories');
  if (files === 0 && directories === 0) {
    throw new TypeError('delete impact must include at least one file or directory');
  }
  if (files > HARD_MAX_DELEGATION_CONSTRAINTS.maxFilesPerDecision
    || bytes > HARD_MAX_DELEGATION_CONSTRAINTS.maxBytesPerDecision
    || directories > HARD_MAX_DELEGATION_CONSTRAINTS.maxDirectoriesPerDecision) {
    throw new TypeError('delete impact exceeds delegation hard caps');
  }
  return immutableSnapshot({
    schemaVersion: TRANSACTIONAL_DELETE_IMPACT_SCHEMA_VERSION,
    contractVersion: TRANSACTIONAL_DELETE_CONTRACT_VERSION,
    files,
    bytes,
    directories,
  });
}

function createPlanEntries(input, request) {
  assertDenseArray(input, 'plan.entries');
  if (input.length !== request.paths.length) {
    throw new TypeError('plan.entries must describe every requested path exactly once');
  }
  const byPath = new Map();
  for (let index = 0; index < input.length; index += 1) {
    const entry = input[index];
    assertPlainRecord(entry, `plan.entries[${index}]`);
    assertOnlyKeys(entry, ['relativePath', 'kind'], `plan.entries[${index}]`);
    const relativePath = normalizeExactRelativePath(
      entry.relativePath,
      request.pathStyle,
      `plan.entries[${index}].relativePath`
    );
    if (isProtectedTransactionalDeletePath(relativePath, request.pathStyle)) {
      throw new TypeError(`plan.entries[${index}] contains a protected project path`);
    }
    const key = pathComparisonKey(relativePath, request.caseSensitive);
    if (byPath.has(key)) throw new TypeError('plan.entries must not contain duplicate paths');
    if (!SUPPORTED_ENTRY_KINDS.has(entry.kind)) {
      throw new TypeError(`plan.entries[${index}].kind is unsupported`);
    }
    byPath.set(key, immutableSnapshot({ relativePath, kind: entry.kind }));
  }
  return Object.freeze(request.paths.map((relativePath) => {
    const entry = byPath.get(pathComparisonKey(relativePath, request.caseSensitive));
    if (!entry) throw new TypeError('plan.entries do not match the requested exact paths');
    return entry;
  }));
}

function createTransactionalDeletePlan(input = {}) {
  assertPlainRecord(input, 'delete plan input');
  assertOnlyKeys(input, ['request', 'pathStyle', 'caseSensitive', 'entries', 'impact'], 'delete plan input');
  const pathStyle = normalizePathStyle(input.pathStyle);
  const caseSensitive = normalizeCaseSensitivity(input.caseSensitive);
  const request = createTransactionalDeletePublicRequest(input.request, { pathStyle, caseSensitive });
  const entries = createPlanEntries(input.entries, { ...request, pathStyle, caseSensitive });
  const impact = createTransactionalDeleteImpact(input.impact);
  const directFiles = entries.filter((entry) => entry.kind !== TRANSACTIONAL_DELETE_ENTRY_KINDS.DIRECTORY).length;
  const directDirectories = entries.length - directFiles;
  if (impact.files < directFiles || impact.directories < directDirectories) {
    throw new TypeError('delete impact cannot be smaller than the exact targets');
  }
  const requestDigest = canonicalSha256Digest({ pathStyle, caseSensitive, request });
  const impactDigest = canonicalSha256Digest(impact);
  const planCore = {
    schemaVersion: TRANSACTIONAL_DELETE_PLAN_SCHEMA_VERSION,
    contractVersion: TRANSACTIONAL_DELETE_CONTRACT_VERSION,
    pathStyle,
    caseSensitive,
    request,
    entries,
    impact,
    requestDigest,
    impactDigest,
  };
  return immutableSnapshot({
    ...planCore,
    planDigest: canonicalSha256Digest(planCore),
  });
}

function assertTransactionalDeletePlan(input) {
  assertPlainRecord(input, 'delete plan');
  assertOnlyKeys(input, [
    'schemaVersion',
    'contractVersion',
    'pathStyle',
    'caseSensitive',
    'request',
    'entries',
    'impact',
    'requestDigest',
    'impactDigest',
    'planDigest',
  ], 'delete plan');
  if (input.schemaVersion !== TRANSACTIONAL_DELETE_PLAN_SCHEMA_VERSION
    || input.contractVersion !== TRANSACTIONAL_DELETE_CONTRACT_VERSION) {
    throw new TypeError('Unsupported delete plan version');
  }
  const recreated = createTransactionalDeletePlan({
    request: input.request,
    pathStyle: input.pathStyle,
    caseSensitive: input.caseSensitive,
    entries: input.entries,
    impact: input.impact,
  });
  for (const field of ['requestDigest', 'impactDigest', 'planDigest']) {
    if (normalizeDigest(input[field], `plan.${field}`) !== recreated[field]) {
      throw new TypeError(`delete plan ${field} does not match canonical content`);
    }
  }
  return recreated;
}

function createCheckpointEntry(input, index, pathStyle) {
  const fieldName = `manifest.entries[${index}]`;
  assertPlainRecord(input, fieldName);
  assertOnlyKeys(input, [
    'relativePath',
    'kind',
    'bytes',
    'mode',
    'mtimeMs',
    'contentDigest',
    'linkTarget',
  ], fieldName);
  const relativePath = normalizeExactRelativePath(input.relativePath, pathStyle, `${fieldName}.relativePath`);
  if (isProtectedTransactionalDeletePath(relativePath, pathStyle)) {
    throw new TypeError(`${fieldName} contains a protected project path`);
  }
  if (!SUPPORTED_ENTRY_KINDS.has(input.kind)) throw new TypeError(`${fieldName}.kind is unsupported`);
  const bytes = normalizeNonNegativeSafeInteger(input.bytes, `${fieldName}.bytes`);
  const mode = normalizeNonNegativeSafeInteger(input.mode, `${fieldName}.mode`);
  if (mode > 0o7777) throw new TypeError(`${fieldName}.mode is unsupported`);
  const mtimeMs = normalizeTimestamp(input.mtimeMs, `${fieldName}.mtimeMs`);
  let contentDigest = null;
  let linkTarget = null;
  if (input.kind === TRANSACTIONAL_DELETE_ENTRY_KINDS.DIRECTORY) {
    if (bytes !== 0 || input.contentDigest !== null || input.linkTarget !== null) {
      throw new TypeError(`${fieldName} directory metadata is inconsistent`);
    }
  } else {
    contentDigest = normalizeDigest(input.contentDigest, `${fieldName}.contentDigest`);
    if (input.kind === TRANSACTIONAL_DELETE_ENTRY_KINDS.SYMLINK) {
      if (typeof input.linkTarget !== 'string' || !input.linkTarget || input.linkTarget.includes('\0')) {
        throw new TypeError(`${fieldName}.linkTarget must be a non-empty data string`);
      }
      linkTarget = input.linkTarget;
    } else if (input.linkTarget !== null) {
      throw new TypeError(`${fieldName} file must not contain a link target`);
    }
  }
  return immutableSnapshot({
    relativePath,
    kind: input.kind,
    bytes,
    mode,
    mtimeMs,
    contentDigest,
    linkTarget,
  });
}

function createTransactionalDeleteCheckpointManifest(input = {}) {
  assertPlainRecord(input, 'checkpoint manifest input');
  assertOnlyKeys(input, ['plan', 'entries', 'createdAt'], 'checkpoint manifest input');
  const plan = assertTransactionalDeletePlan(input.plan);
  assertDenseArray(input.entries, 'manifest.entries');
  const maxEntries = HARD_MAX_DELEGATION_CONSTRAINTS.maxFilesPerDecision
    + HARD_MAX_DELEGATION_CONSTRAINTS.maxDirectoriesPerDecision;
  if (input.entries.length < 1 || input.entries.length > maxEntries) {
    throw new TypeError(`manifest.entries must contain between 1 and ${maxEntries} entries`);
  }
  const entries = input.entries
    .map((entry, index) => createCheckpointEntry(entry, index, plan.pathStyle))
    .sort((left, right) => compareExactPaths(
      left.relativePath,
      right.relativePath,
      plan.caseSensitive
    ));
  const seen = new Set();
  for (const entry of entries) {
    const key = pathComparisonKey(entry.relativePath, plan.caseSensitive);
    if (seen.has(key)) throw new TypeError('manifest.entries must not contain duplicate paths');
    seen.add(key);
  }
  const files = entries.filter((entry) => entry.kind !== TRANSACTIONAL_DELETE_ENTRY_KINDS.DIRECTORY).length;
  const directories = entries.length - files;
  const bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  if (!Number.isSafeInteger(bytes)
    || files !== plan.impact.files
    || directories !== plan.impact.directories
    || bytes !== plan.impact.bytes) {
    throw new TypeError('manifest entries must exactly match the planned impact');
  }
  const entriesByPath = new Map(entries.map((entry) => [
    pathComparisonKey(entry.relativePath, plan.caseSensitive),
    entry,
  ]));
  const targetsByPath = new Map(plan.entries.map((entry) => [
    pathComparisonKey(entry.relativePath, plan.caseSensitive),
    entry,
  ]));
  for (const target of plan.entries) {
    const checkpointEntry = entriesByPath.get(pathComparisonKey(target.relativePath, plan.caseSensitive));
    if (!checkpointEntry || checkpointEntry.kind !== target.kind) {
      throw new TypeError('manifest must contain every exact planned target with the same kind');
    }
  }
  for (const entry of entries) {
    const entryKey = pathComparisonKey(entry.relativePath, plan.caseSensitive);
    const owner = [...targetsByPath.entries()].find(([targetKey]) => (
      entryKey === targetKey || entryKey.startsWith(`${targetKey}/`)
    ));
    if (!owner) throw new TypeError('manifest contains an entry outside exact planned targets');
    const [targetKey, target] = owner;
    if (entryKey !== targetKey && target.kind !== TRANSACTIONAL_DELETE_ENTRY_KINDS.DIRECTORY) {
      throw new TypeError('manifest must not contain descendants of a non-directory target');
    }
    let parentKey = entryKey.includes('/') ? entryKey.slice(0, entryKey.lastIndexOf('/')) : '';
    while (parentKey && parentKey.length >= targetKey.length) {
      const parentEntry = entriesByPath.get(parentKey);
      if (!parentEntry || parentEntry.kind !== TRANSACTIONAL_DELETE_ENTRY_KINDS.DIRECTORY) {
        throw new TypeError('manifest must include the complete directory parent closure');
      }
      if (parentKey === targetKey) break;
      parentKey = parentKey.includes('/') ? parentKey.slice(0, parentKey.lastIndexOf('/')) : '';
    }
  }
  const createdAt = normalizeTimestamp(input.createdAt, 'manifest.createdAt');
  const manifestCore = {
    schemaVersion: TRANSACTIONAL_DELETE_CHECKPOINT_MANIFEST_SCHEMA_VERSION,
    contractVersion: TRANSACTIONAL_DELETE_CONTRACT_VERSION,
    createdAt,
    pathStyle: plan.pathStyle,
    caseSensitive: plan.caseSensitive,
    planDigest: plan.planDigest,
    requestDigest: plan.requestDigest,
    impactDigest: plan.impactDigest,
    impact: plan.impact,
    entries,
  };
  return immutableSnapshot({
    ...manifestCore,
    checkpointDigest: canonicalSha256Digest(manifestCore),
  });
}

function normalizeState(value, fieldName = 'state') {
  if (!SUPPORTED_STATES.has(value)) throw new TypeError(`${fieldName} is unsupported`);
  return value;
}

function createTransactionalDeleteStateRecord(input = {}) {
  assertPlainRecord(input, 'delete state input');
  assertOnlyKeys(
    input,
    ['state', 'previousState', 'at', 'reasonCode'],
    'delete state input'
  );
  const state = normalizeState(input.state);
  const previousState = input.previousState === null
    ? null
    : normalizeState(input.previousState, 'previousState');
  if (previousState === null && state !== TRANSACTIONAL_DELETE_STATES.PREPARING) {
    throw new TypeError('The initial transactional delete state must be PREPARING');
  }
  if (previousState !== null && !ALLOWED_STATE_TRANSITIONS[previousState].includes(state)) {
    throw new TypeError(`Unsupported transactional delete transition: ${previousState} -> ${state}`);
  }
  const reasonCode = input.reasonCode === undefined ? '' : input.reasonCode;
  if (typeof reasonCode !== 'string'
    || (reasonCode && !SAFE_REASON_CODE_PATTERN.test(reasonCode))) {
    throw new TypeError('reasonCode must be an uppercase stable code');
  }
  if ((state === TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT
      || state === TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT)
    && !reasonCode) {
    throw new TypeError('Recovery states require a reasonCode');
  }
  return immutableSnapshot({
    schemaVersion: TRANSACTIONAL_DELETE_STATE_RECORD_SCHEMA_VERSION,
    contractVersion: TRANSACTIONAL_DELETE_CONTRACT_VERSION,
    previousState,
    state,
    at: normalizeTimestamp(input.at, 'state.at'),
    reasonCode,
  });
}

function createPublicImpactSummary(input = {}) {
  assertPlainRecord(input, 'public impact');
  assertOnlyKeys(input, ['files', 'bytes', 'directories'], 'public impact');
  const summary = {
    files: normalizeNonNegativeSafeInteger(input.files, 'public impact.files'),
    bytes: normalizeNonNegativeSafeInteger(input.bytes, 'public impact.bytes'),
    directories: normalizeNonNegativeSafeInteger(input.directories, 'public impact.directories'),
  };
  if (summary.files > HARD_MAX_DELEGATION_CONSTRAINTS.maxFilesPerDecision
    || summary.bytes > HARD_MAX_DELEGATION_CONSTRAINTS.maxBytesPerDecision
    || summary.directories > HARD_MAX_DELEGATION_CONSTRAINTS.maxDirectoriesPerDecision) {
    throw new TypeError('public impact exceeds delegation hard caps');
  }
  return immutableSnapshot(summary);
}

function createTransactionalDeletePublicResult(input = {}) {
  assertPlainRecord(input, 'public delete result');
  assertOnlyKeys(input, ['status', 'state', 'impact', 'errorCode'], 'public delete result');
  if (!SUPPORTED_PUBLIC_RESULT_STATUSES.has(input.status)) {
    throw new TypeError('public delete result status is unsupported');
  }
  const state = normalizeState(input.state);
  const errorCode = input.errorCode === null || input.errorCode === undefined ? null : input.errorCode;
  if (errorCode !== null
    && (typeof errorCode !== 'string' || !SAFE_REASON_CODE_PATTERN.test(errorCode))) {
    throw new TypeError('public delete errorCode must be an uppercase stable code');
  }
  if (input.status === TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES.COMPLETED) {
    if (![TRANSACTIONAL_DELETE_STATES.COMMITTED, TRANSACTIONAL_DELETE_STATES.PURGED].includes(state)) {
      throw new TypeError('completed delete results require COMMITTED or PURGED state');
    }
    if (errorCode !== null) throw new TypeError('completed delete results must not include errorCode');
  } else if (errorCode === null) {
    throw new TypeError('non-completed delete results require errorCode');
  }
  return immutableSnapshot({
    schemaVersion: TRANSACTIONAL_DELETE_PUBLIC_RESULT_SCHEMA_VERSION,
    contractVersion: TRANSACTIONAL_DELETE_CONTRACT_VERSION,
    ok: input.status === TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES.COMPLETED,
    status: input.status,
    state,
    impact: createPublicImpactSummary(input.impact),
    errorCode,
  });
}

module.exports = {
  ALLOWED_STATE_TRANSITIONS,
  TRANSACTIONAL_DELETE_CHECKPOINT_MANIFEST_SCHEMA_VERSION,
  TRANSACTIONAL_DELETE_CONTRACT_VERSION,
  TRANSACTIONAL_DELETE_ENTRY_KINDS,
  TRANSACTIONAL_DELETE_IMPACT_SCHEMA_VERSION,
  TRANSACTIONAL_DELETE_PATH_STYLES,
  TRANSACTIONAL_DELETE_PLAN_SCHEMA_VERSION,
  TRANSACTIONAL_DELETE_PUBLIC_REQUEST_SCHEMA_VERSION,
  TRANSACTIONAL_DELETE_PUBLIC_RESULT_SCHEMA_VERSION,
  TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES,
  TRANSACTIONAL_DELETE_STATE_RECORD_SCHEMA_VERSION,
  TRANSACTIONAL_DELETE_STATES,
  assertTransactionalDeletePlan,
  canonicalSha256Digest,
  createTransactionalDeleteCheckpointManifest,
  createTransactionalDeleteImpact,
  createTransactionalDeletePlan,
  createTransactionalDeletePublicRequest,
  createTransactionalDeletePublicResult,
  createTransactionalDeleteStateRecord,
  isProtectedTransactionalDeletePath,
  normalizeExactRelativePath,
  normalizeExactRelativePaths,
};
