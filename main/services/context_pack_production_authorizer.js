'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  CONTEXT_PACK_CITATION_KINDS,
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_STATES,
  createContextPackCitation,
  createContextPackSection,
} = require('../agent_runtime/context_pack_contracts');
const {
  createContextPackCollectionGrant,
  createContextPackSourceAuthorizer,
} = require('../agent_runtime/context_pack_source_contracts');

const CONTEXT_PACK_PRODUCTION_AUTHORIZER_VERSION =
  'context-pack-production-authorizer.v1';
const AUTHORIZATION_KEYS = Object.freeze([
  'authorized',
  'authorityDigest',
  'requestId',
  'projectId',
  'sourceScope',
  'requestText',
  'permissionsText',
]);
const SOURCE_SCOPE_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'jobId',
  'conversationId',
  'userId',
  'relativeCwd',
  'relevantFiles',
]);
const SOURCE_SCOPE_REQUIRED_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'jobId',
  'conversationId',
  'userId',
]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const MAX_REQUEST_CHARS = 16_384;
const MAX_PERMISSIONS_CHARS = 4_096;

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

function inspectableSynchronousCallback(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isAsyncFunction(value) || util.types.isGeneratorFunction(value)) {
    throw new TypeError(`${fieldName} must be an inspectable synchronous function`);
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  if (keys.some((key) => {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return true;
    }
    return typeof key !== 'string' || !descriptor
      || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable === true;
  })) {
    throw new TypeError(`${fieldName} must not carry enumerable authority`);
  }
  return value;
}

function consumeNativePromise(value) {
  if (!util.types.isPromise(value)) return;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => {}, () => {}]);
  } catch {
    // Native promises are rejected at this synchronous authorization boundary.
  }
}

function boundedText(value, fieldName, maximum) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) {
    throw new TypeError(`${fieldName} must be bounded text`);
  }
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${fieldName} must not be empty`);
  return normalized;
}

function safeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${fieldName} must be a safe identifier`);
  }
  return value;
}

function canonicalDigest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function createAvailableSection({ id, summary, revision, citation }) {
  return createContextPackSection({
    id,
    state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
    revision,
    summary,
    citations: Object.freeze([citation]),
    truncated: false,
  });
}

function createContextPackProductionAuthorizer(options = {}) {
  const optionFields = exactDataFields(options, ['authorizeBinding']);
  if (!optionFields) throw new TypeError('Invalid production ContextPack authorizer options');
  const authorizeBinding = inspectableSynchronousCallback(
    optionFields.get('authorizeBinding'),
    'authorizeBinding'
  );

  let authorizations = 0;
  let rejections = 0;

  function authorize(input = {}) {
    try {
      const inputFields = exactDataFields(input, ['binding', 'surface']);
      if (!inputFields || !Object.isFrozen(input)) {
        throw new TypeError('Invalid production ContextPack authorization input');
      }

      let rawAuthorization;
      try {
        rawAuthorization = Reflect.apply(authorizeBinding, undefined, [input]);
      } catch {
        throw new TypeError('Production ContextPack authorizeBinding failed');
      }
      if (util.types.isPromise(rawAuthorization)) {
        consumeNativePromise(rawAuthorization);
        throw new TypeError('Production ContextPack authorization must be synchronous');
      }

      const fields = exactDataFields(rawAuthorization, AUTHORIZATION_KEYS);
      if (!fields) throw new TypeError('Invalid production ContextPack authorization result');
      if (fields.get('authorized') !== true) {
        throw new TypeError('Production ContextPack authorization was denied');
      }
      const requestId = safeIdentifier(fields.get('requestId'), 'authorization.requestId');
      const projectId = safeIdentifier(fields.get('projectId'), 'authorization.projectId');
      const sourceScope = fields.get('sourceScope');
      const sourceScopeFields = exactDataFields(
        sourceScope,
        SOURCE_SCOPE_KEYS,
        SOURCE_SCOPE_REQUIRED_KEYS
      );
      if (!sourceScopeFields) {
        throw new TypeError('Invalid production ContextPack source scope');
      }
      const jobId = sourceScopeFields.get('jobId');
      if (jobId !== null) safeIdentifier(jobId, 'authorization.sourceScope.jobId');
      const requestText = boundedText(
        fields.get('requestText'),
        'authorization.requestText',
        MAX_REQUEST_CHARS
      );
      const permissionsText = boundedText(
        fields.get('permissionsText'),
        'authorization.permissionsText',
        MAX_PERMISSIONS_CHARS
      );
      const requestDigest = canonicalDigest({
        requestId,
        projectId,
        requestText,
      });
      const requestCitation = createContextPackCitation({
        kind: CONTEXT_PACK_CITATION_KINDS.RUNTIME_REQUEST,
        locator: `runtime://request/${requestId}`,
        revision: requestDigest,
        digest: requestDigest,
      });
      const authorityDigest = fields.get('authorityDigest');
      const permissionsCitation = createContextPackCitation({
        kind: CONTEXT_PACK_CITATION_KINDS.JOB_AUTHORITY,
        locator: jobId === null
          ? `authority://request/${requestId}`
          : `authority://job/${jobId}`,
        revision: authorityDigest,
        digest: authorityDigest,
      });
      const grant = createContextPackCollectionGrant({
        authorityDigest,
        requestId,
        projectId,
        surface: inputFields.get('surface'),
        sourceScope,
        requestSection: createAvailableSection({
          id: CONTEXT_PACK_SECTION_IDS.REQUEST,
          summary: requestText,
          revision: requestDigest,
          citation: requestCitation,
        }),
        permissionsSection: createAvailableSection({
          id: CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
          summary: permissionsText,
          revision: authorityDigest,
          citation: permissionsCitation,
        }),
      });
      authorizations += 1;
      return grant;
    } catch (error) {
      rejections += 1;
      throw error instanceof TypeError
        ? error
        : new TypeError('Production ContextPack authorization failed');
    }
  }

  const authorizer = createContextPackSourceAuthorizer({ authorize });

  function diagnostics() {
    return Object.freeze({
      version: CONTEXT_PACK_PRODUCTION_AUTHORIZER_VERSION,
      authorizations,
      rejections,
    });
  }

  return Object.freeze({
    version: CONTEXT_PACK_PRODUCTION_AUTHORIZER_VERSION,
    authorizer,
    diagnostics,
  });
}

module.exports = {
  CONTEXT_PACK_PRODUCTION_AUTHORIZER_VERSION,
  createContextPackProductionAuthorizer,
};
