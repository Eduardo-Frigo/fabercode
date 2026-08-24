'use strict';

const util = require('util');

const {
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_ORDER,
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
  assertContextPackSection,
} = require('./context_pack_contracts');
const {
  isPortableAbsolutePath,
} = require('../capabilities/sandbox_backend_contract');

const CONTEXT_PACK_COLLECTION_GRANT_SCHEMA_VERSION = 'context-pack-collection-grant.v1';
const CONTEXT_PACK_SOURCE_AUTHORIZER_VERSION = 'context-pack-source-authorizer.v1';
const CONTEXT_PACK_SOURCE_READER_VERSION = 'context-pack-source-reader.v1';

const CONTEXT_PACK_OPTIONAL_SECTION_IDS = Object.freeze(
  CONTEXT_PACK_SECTION_ORDER.filter((sectionId) => ![
    CONTEXT_PACK_SECTION_IDS.REQUEST,
    CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
  ].includes(sectionId))
);

const OPTIONAL_SECTION_ID_SET = new Set(CONTEXT_PACK_OPTIONAL_SECTION_IDS);
const SUPPORTED_SURFACES = new Set(Object.values(CONTEXT_PACK_SURFACES));
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SOURCE_SCOPE_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'jobId',
  'conversationId',
  'userId',
]);

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      return null;
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function safeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${fieldName} must be a safe identifier`);
  }
  return value;
}

function nullableIdentifier(value, fieldName) {
  return value === null ? null : safeIdentifier(value, fieldName);
}

function normalizeSourceScope(value) {
  const fields = exactDataFields(value, SOURCE_SCOPE_KEYS);
  if (!fields) throw new TypeError('Invalid ContextPack source scope');
  const projectId = safeIdentifier(fields.get('projectId'), 'sourceScope.projectId');
  const rootPath = fields.get('rootPath');
  if (typeof rootPath !== 'string' || rootPath !== rootPath.trim()
    || rootPath.length > 32_768 || rootPath.includes('\0')
    || !isPortableAbsolutePath(rootPath)
    || rootPath.replace(/\\/g, '/') === '/'
    || /^[A-Za-z]:\/?$/.test(rootPath.replace(/\\/g, '/'))) {
    throw new TypeError('sourceScope.rootPath must be a portable absolute path');
  }
  return Object.freeze({
    projectId,
    rootPath,
    jobId: nullableIdentifier(fields.get('jobId'), 'sourceScope.jobId'),
    conversationId: nullableIdentifier(
      fields.get('conversationId'),
      'sourceScope.conversationId'
    ),
    userId: nullableIdentifier(fields.get('userId'), 'sourceScope.userId'),
  });
}

function doesContextPackSectionDiscloseRoot(section, rootPath) {
  const normalizedRoot = String(rootPath || '').replace(/\\/g, '/');
  const caseInsensitive = /^[A-Za-z]:\//.test(normalizedRoot);
  const comparableRoot = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
  const containsRoot = (value) => {
    if (typeof value !== 'string') return false;
    const normalizedValue = value.replace(/\\/g, '/');
    const comparableValue = caseInsensitive ? normalizedValue.toLowerCase() : normalizedValue;
    return comparableValue.includes(comparableRoot);
  };
  return containsRoot(section.summary)
    || containsRoot(section.revision)
    || section.citations.some((citation) => (
      containsRoot(citation.locator) || containsRoot(citation.revision)
    ));
}

function requiredGrantSection(value, expectedId, fieldName) {
  const section = assertContextPackSection(value);
  if (section.id !== expectedId || ![
    CONTEXT_PACK_SECTION_STATES.AVAILABLE,
    CONTEXT_PACK_SECTION_STATES.STALE,
  ].includes(section.state)) {
    throw new TypeError(`${fieldName} must be an available ${expectedId} section`);
  }
  return section;
}

function createContextPackCollectionGrant(input = {}) {
  const fields = exactDataFields(input, [
    'authorityDigest',
    'requestId',
    'projectId',
    'surface',
    'sourceScope',
    'requestSection',
    'permissionsSection',
  ]);
  if (!fields) throw new TypeError('Invalid ContextPack collection grant data');
  const authorityDigest = fields.get('authorityDigest');
  if (typeof authorityDigest !== 'string' || !SHA256_DIGEST.test(authorityDigest)) {
    throw new TypeError('ContextPack authority digest is invalid');
  }
  const requestId = safeIdentifier(fields.get('requestId'), 'grant.requestId');
  const projectId = safeIdentifier(fields.get('projectId'), 'grant.projectId');
  const surface = fields.get('surface');
  if (!SUPPORTED_SURFACES.has(surface)) {
    throw new TypeError('ContextPack grant surface is invalid');
  }
  const sourceScope = normalizeSourceScope(fields.get('sourceScope'));
  if (sourceScope.projectId !== projectId) {
    throw new TypeError('ContextPack project scope does not match its grant');
  }
  const requestSection = requiredGrantSection(
    fields.get('requestSection'),
    CONTEXT_PACK_SECTION_IDS.REQUEST,
    'requestSection'
  );
  const permissionsSection = requiredGrantSection(
    fields.get('permissionsSection'),
    CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
    'permissionsSection'
  );
  if (!requestSection.citations.some(
    (citation) => citation.locator === `runtime://request/${requestId}`
  )) {
    throw new TypeError('ContextPack request citation does not match its requestId');
  }
  if (!permissionsSection.citations.some(
    (citation) => citation.digest === authorityDigest
  )) {
    throw new TypeError('ContextPack authority digest is not cited by permissions');
  }
  if ([requestSection, permissionsSection].some(
    (section) => doesContextPackSectionDiscloseRoot(section, sourceScope.rootPath)
  )) {
    throw new TypeError('ContextPack grant sections must not disclose sourceScope.rootPath');
  }
  return Object.freeze({
    schemaVersion: CONTEXT_PACK_COLLECTION_GRANT_SCHEMA_VERSION,
    authorityDigest,
    requestId,
    projectId,
    surface,
    sourceScope,
    requestSection,
    permissionsSection,
  });
}

function assertContextPackCollectionGrant(value) {
  const fields = exactDataFields(value, [
    'schemaVersion',
    'authorityDigest',
    'requestId',
    'projectId',
    'surface',
    'sourceScope',
    'requestSection',
    'permissionsSection',
  ]);
  const sourceScope = fields && fields.get('sourceScope');
  if (!fields || !Object.isFrozen(value)
    || util.types.isProxy(sourceScope) || !Object.isFrozen(sourceScope)
    || fields.get('schemaVersion') !== CONTEXT_PACK_COLLECTION_GRANT_SCHEMA_VERSION) {
    throw new TypeError('Invalid ContextPack collection grant');
  }
  const canonical = createContextPackCollectionGrant({
    authorityDigest: fields.get('authorityDigest'),
    requestId: fields.get('requestId'),
    projectId: fields.get('projectId'),
    surface: fields.get('surface'),
    sourceScope,
    requestSection: fields.get('requestSection'),
    permissionsSection: fields.get('permissionsSection'),
  });
  if (JSON.stringify(canonical) !== JSON.stringify(value)) {
    throw new TypeError('Invalid ContextPack collection grant');
  }
  return value;
}

function createContextPackSourceReader(input = {}) {
  const fields = exactDataFields(input, ['sectionId', 'read']);
  if (!fields || !OPTIONAL_SECTION_ID_SET.has(fields.get('sectionId'))
    || typeof fields.get('read') !== 'function'
    || util.types.isProxy(fields.get('read'))) {
    throw new TypeError('ContextPack source reader section or read method is invalid');
  }
  return Object.freeze({
    version: CONTEXT_PACK_SOURCE_READER_VERSION,
    sectionId: fields.get('sectionId'),
    read: fields.get('read'),
  });
}

function assertContextPackSourceReader(value) {
  const fields = exactDataFields(value, ['version', 'sectionId', 'read']);
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== CONTEXT_PACK_SOURCE_READER_VERSION) {
    throw new TypeError('Invalid ContextPack source reader');
  }
  const canonical = createContextPackSourceReader({
    sectionId: fields.get('sectionId'),
    read: fields.get('read'),
  });
  if (canonical.sectionId !== value.sectionId || canonical.read !== value.read) {
    throw new TypeError('Invalid ContextPack source reader');
  }
  return value;
}

function createContextPackSourceAuthorizer(input = {}) {
  const fields = exactDataFields(input, ['authorize']);
  if (!fields || typeof fields.get('authorize') !== 'function'
    || util.types.isProxy(fields.get('authorize'))) {
    throw new TypeError('ContextPack source authorizer authorize method is invalid');
  }
  return Object.freeze({
    version: CONTEXT_PACK_SOURCE_AUTHORIZER_VERSION,
    authorize: fields.get('authorize'),
  });
}

function assertContextPackSourceAuthorizer(value) {
  const fields = exactDataFields(value, ['version', 'authorize']);
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== CONTEXT_PACK_SOURCE_AUTHORIZER_VERSION) {
    throw new TypeError('Invalid ContextPack source authorizer');
  }
  const canonical = createContextPackSourceAuthorizer({ authorize: fields.get('authorize') });
  if (canonical.authorize !== value.authorize) {
    throw new TypeError('Invalid ContextPack source authorizer');
  }
  return value;
}

module.exports = {
  CONTEXT_PACK_COLLECTION_GRANT_SCHEMA_VERSION,
  CONTEXT_PACK_OPTIONAL_SECTION_IDS,
  CONTEXT_PACK_SOURCE_AUTHORIZER_VERSION,
  CONTEXT_PACK_SOURCE_READER_VERSION,
  assertContextPackCollectionGrant,
  assertContextPackSourceAuthorizer,
  assertContextPackSourceReader,
  createContextPackCollectionGrant,
  createContextPackSourceAuthorizer,
  createContextPackSourceReader,
  doesContextPackSectionDiscloseRoot,
};
