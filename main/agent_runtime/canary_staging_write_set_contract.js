'use strict';

const util = require('util');

const {
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');

const CANARY_STAGING_WRITE_SET_SCHEMA_VERSION = 'canary-staging-write-set.v1';
const MAX_WRITE_SET_ENTRIES = 32;
const MAX_RELATIVE_PATH_BYTES = 4096;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ENTRY_KEYS = Object.freeze([
  'path',
  'kind',
  'mode',
  'bytes',
  'contentDigest',
]);
const PROTECTED_PATH = /(?:^|\/)(?:\.git|\.faber|node_modules|\.env(?:\..*)?)(?:\/|$)/i;

function exactFrozenFields(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || !Object.isFrozen(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
    || expectedKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
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

function denseFrozenArray(value) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || !Object.isFrozen(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1 || value.length > MAX_WRITE_SET_ENTRIES) return null;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) return null;
  const output = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) return null;
    output.push(descriptor.value);
  }
  return output;
}

function normalizeEntry(value, previousPath) {
  const fields = exactFrozenFields(value, ENTRY_KEYS);
  const relativePath = fields && fields.get('path');
  const kind = fields && fields.get('kind');
  const mode = fields && fields.get('mode');
  const bytes = fields && fields.get('bytes');
  const rawContentDigest = fields && fields.get('contentDigest');
  if (!fields || !safeRelativePath(relativePath)
    || previousPath !== null && relativePath <= previousPath
    || !['directory', 'file'].includes(kind)
    || !Number.isSafeInteger(mode) || mode < 0 || mode > 0o777) {
    throw new TypeError('Invalid canary staging write-set entry');
  }
  let contentDigest = null;
  if (kind === 'file') {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_FILE_BYTES) {
      throw new TypeError('Invalid canary staging write-set file size');
    }
    try {
      contentDigest = normalizeDigest(rawContentDigest, 'contentDigest');
    } catch {
      throw new TypeError('Invalid canary staging write-set content digest');
    }
  } else if (bytes !== null || rawContentDigest !== null) {
    throw new TypeError('Invalid canary staging write-set directory metadata');
  }
  return Object.freeze({
    path: relativePath,
    kind,
    mode,
    bytes: kind === 'file' ? bytes : null,
    contentDigest,
  });
}

function createCanaryStagingWriteSetDigest(value) {
  const entries = denseFrozenArray(value);
  if (!entries) throw new TypeError('Invalid canary staging write set');
  const normalized = [];
  let previousPath = null;
  for (const entry of entries) {
    const canonical = normalizeEntry(entry, previousPath);
    normalized.push(canonical);
    previousPath = canonical.path;
  }
  return canonicalSha256Digest({
    schemaVersion: CANARY_STAGING_WRITE_SET_SCHEMA_VERSION,
    entries: normalized,
  });
}

module.exports = {
  CANARY_STAGING_WRITE_SET_SCHEMA_VERSION,
  MAX_WRITE_SET_ENTRIES,
  createCanaryStagingWriteSetDigest,
};
