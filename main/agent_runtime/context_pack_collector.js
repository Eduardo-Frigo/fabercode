'use strict';

const util = require('util');

const {
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
  assertContextPackManifest,
  assertContextPackSection,
  createContextPackSection,
} = require('./context_pack_contracts');
const {
  CONTEXT_PACK_COMPILER_VERSION,
} = require('./context_pack_compiler');
const {
  CONTEXT_PACK_OPTIONAL_SECTION_IDS,
  assertContextPackCollectionGrant,
  assertContextPackSourceAuthorizer,
  assertContextPackSourceReader,
  doesContextPackSectionDiscloseRoot,
} = require('./context_pack_source_contracts');

const CONTEXT_PACK_SOURCE_COLLECTOR_VERSION = 'context-pack-source-collector.v1';
const SUPPORTED_SURFACES = new Set(Object.values(CONTEXT_PACK_SURFACES));
const FORBIDDEN_BINDING_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BINDING_LIMITS = Object.freeze({
  maxDepth: 16,
  maxNodes: 2_048,
  maxStringBytes: 256 * 1024,
});

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

function denseArrayValues(value, fieldName, maximum) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || !Object.isFrozen(value) || value.length > maximum) {
    throw new TypeError(`${fieldName} must be a frozen bounded plain array`);
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  } catch {
    throw new TypeError(`${fieldName} is invalid`);
  }
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${fieldName} must be dense`);
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain data values`);
    }
    return descriptor.value;
  });
}

function immutableBindingSnapshot(
  value,
  state = { seen: new Set(), nodes: 0, stringBytes: 0 },
  depth = 0
) {
  if (depth > BINDING_LIMITS.maxDepth) {
    throw new TypeError('ContextPack authority binding exceeds its depth bound');
  }
  state.nodes += 1;
  if (state.nodes > BINDING_LIMITS.maxNodes) {
    throw new TypeError('ContextPack authority binding exceeds its node bound');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new TypeError('ContextPack authority binding contains NUL');
    state.stringBytes += Buffer.byteLength(value, 'utf8');
    if (state.stringBytes > BINDING_LIMITS.maxStringBytes) {
      throw new TypeError('ContextPack authority binding exceeds its string bound');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('ContextPack authority binding contains an invalid number');
    }
    return value;
  }
  if (!value || typeof value !== 'object' || util.types.isProxy(value)
    || typeof value === 'function' || typeof value === 'symbol'
    || typeof value === 'bigint') {
    throw new TypeError('ContextPack authority binding contains an unsupported value');
  }
  if (state.seen.has(value)) throw new TypeError('ContextPack authority binding contains a cycle');
  state.seen.add(value);
  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if ((isArray && prototype !== Array.prototype)
      || (!isArray && prototype !== Object.prototype && prototype !== null)) {
      throw new TypeError('ContextPack authority binding must contain plain data');
    }
    const keys = Reflect.ownKeys(value).filter((key) => !(isArray && key === 'length'));
    if (isArray && (keys.length !== value.length
      || keys.some((key, index) => key !== String(index)))) {
      throw new TypeError('ContextPack authority binding arrays must be dense');
    }
    if (!isArray && keys.length < 1 && depth === 0) {
      throw new TypeError('ContextPack authority binding must not be empty');
    }
    const output = isArray ? [] : Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || FORBIDDEN_BINDING_KEYS.has(key)) {
        throw new TypeError('ContextPack authority binding contains a forbidden key');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('ContextPack authority binding must contain data properties');
      }
      output[key] = immutableBindingSnapshot(descriptor.value, state, depth + 1);
    }
    return Object.freeze(output);
  } finally {
    state.seen.delete(value);
  }
}

function captureOwnMethod(value, methodName, fieldName) {
  const descriptor = Object.getOwnPropertyDescriptor(value, methodName);
  if (!descriptor || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) {
    throw new TypeError(`${fieldName}.${methodName} must be an own data method`);
  }
  return Object.freeze({ receiver: value, method: descriptor.value });
}

function consumeNativePromise(value) {
  if (!util.types.isPromise(value)) return;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => {}, () => {}]);
  } catch {
    // The synchronous boundary rejects native promises regardless of settlement.
  }
}

function observeReaderResult(value, sectionId) {
  if (!util.types.isPromise(value)) {
    return Promise.resolve(Object.freeze({ value }));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, value, [
        (resolved) => resolve(Object.freeze({ value: resolved })),
        () => reject(new TypeError(`ContextPack ${sectionId} reader failed`)),
      ]);
    } catch {
      reject(new TypeError(`ContextPack ${sectionId} reader failed`));
    }
  });
}

function unavailableSection(sectionId) {
  return createContextPackSection({
    id: sectionId,
    state: CONTEXT_PACK_SECTION_STATES.UNAVAILABLE,
    revision: null,
    summary: '',
    citations: Object.freeze([]),
    truncated: false,
  });
}

function createContextPackSourceCollector(options = {}) {
  const fields = exactDataFields(options, ['authorizer', 'compiler', 'readers']);
  if (!fields) throw new TypeError('Invalid ContextPack source collector options');
  const authorizer = assertContextPackSourceAuthorizer(fields.get('authorizer'));
  const compiler = fields.get('compiler');
  const compilerFields = exactDataFields(compiler, ['version', 'compile', 'diagnostics']);
  if (!compilerFields || !Object.isFrozen(compiler)
    || compilerFields.get('version') !== CONTEXT_PACK_COMPILER_VERSION) {
    throw new TypeError('ContextPack collector compiler is invalid');
  }
  const authorize = captureOwnMethod(authorizer, 'authorize', 'authorizer');
  const compile = captureOwnMethod(compiler, 'compile', 'compiler');
  const suppliedReaders = denseArrayValues(
    fields.get('readers'),
    'ContextPack source readers',
    CONTEXT_PACK_OPTIONAL_SECTION_IDS.length
  ).map(assertContextPackSourceReader);
  const readerById = new Map();
  for (const reader of suppliedReaders) {
    if (readerById.has(reader.sectionId)) {
      throw new TypeError(`Duplicate ContextPack source reader: ${reader.sectionId}`);
    }
    readerById.set(reader.sectionId, Object.freeze({
      sectionId: reader.sectionId,
      ...captureOwnMethod(reader, 'read', `reader.${reader.sectionId}`),
    }));
  }
  if (readerById.size !== CONTEXT_PACK_OPTIONAL_SECTION_IDS.length
    || CONTEXT_PACK_OPTIONAL_SECTION_IDS.some((sectionId) => !readerById.has(sectionId))) {
    throw new TypeError('ContextPack collector requires every optional source reader');
  }

  let collections = 0;
  let rejections = 0;
  let sourceFailures = 0;
  let lastPackId = null;

  function authorizeCollection(authorizationInput) {
    let value;
    try {
      value = Reflect.apply(authorize.method, authorize.receiver, [authorizationInput]);
    } catch {
      throw new TypeError('ContextPack source authorization failed');
    }
    if (util.types.isPromise(value)) {
      consumeNativePromise(value);
      throw new TypeError('ContextPack source authorization must be synchronous');
    }
    const grant = assertContextPackCollectionGrant(value);
    if (grant.surface !== authorizationInput.surface) {
      throw new TypeError('ContextPack source authorization changed the requested surface');
    }
    return grant;
  }

  function readSource(captured, context, rootPath) {
    let raw;
    try {
      raw = Reflect.apply(captured.method, captured.receiver, [context]);
    } catch {
      return Promise.resolve(Object.freeze({
        failed: true,
        section: unavailableSection(captured.sectionId),
      }));
    }
    return observeReaderResult(raw, captured.sectionId).then(
      ({ value }) => {
        try {
          const section = assertContextPackSection(value);
          if (section.id !== captured.sectionId
            || doesContextPackSectionDiscloseRoot(section, rootPath)) {
            throw new TypeError('ContextPack source reader returned a mismatched section');
          }
          return Object.freeze({ failed: false, section });
        } catch {
          return Object.freeze({
            failed: true,
            section: unavailableSection(captured.sectionId),
          });
        }
      },
      () => Object.freeze({
        failed: true,
        section: unavailableSection(captured.sectionId),
      })
    );
  }

  async function collect(input = {}) {
    try {
      const inputFields = exactDataFields(input, ['binding', 'surface']);
      if (!inputFields || !SUPPORTED_SURFACES.has(inputFields.get('surface'))) {
        throw new TypeError('Invalid ContextPack collection input');
      }
      const binding = immutableBindingSnapshot(inputFields.get('binding'));
      const authorizationInput = Object.freeze({
        binding,
        surface: inputFields.get('surface'),
      });
      const initialGrant = authorizeCollection(authorizationInput);
      const readerContext = Object.freeze({
        authorityDigest: initialGrant.authorityDigest,
        requestId: initialGrant.requestId,
        projectId: initialGrant.projectId,
        surface: initialGrant.surface,
        sourceScope: initialGrant.sourceScope,
      });
      const results = await Promise.all(CONTEXT_PACK_OPTIONAL_SECTION_IDS.map(
        (sectionId) => readSource(
          readerById.get(sectionId),
          readerContext,
          initialGrant.sourceScope.rootPath
        )
      ));
      const finalGrant = authorizeCollection(authorizationInput);
      if (JSON.stringify(finalGrant) !== JSON.stringify(initialGrant)) {
        throw new TypeError('ContextPack source authority changed during collection');
      }
      const sections = Object.freeze([
        initialGrant.requestSection,
        initialGrant.permissionsSection,
        ...results.map((result) => result.section),
      ]);
      let manifest;
      try {
        manifest = Reflect.apply(compile.method, compile.receiver, [{
          requestId: initialGrant.requestId,
          projectId: initialGrant.projectId,
          surface: initialGrant.surface,
          sections,
        }]);
      } catch {
        throw new TypeError('ContextPack compilation failed after source collection');
      }
      if (util.types.isPromise(manifest)) {
        consumeNativePromise(manifest);
        throw new TypeError('ContextPack compiler must remain synchronous');
      }
      assertContextPackManifest(manifest);
      sourceFailures += results.filter((result) => result.failed).length;
      collections += 1;
      lastPackId = manifest.packId;
      return manifest;
    } catch (error) {
      rejections += 1;
      throw error instanceof TypeError
        ? error
        : new TypeError('ContextPack source collection failed');
    }
  }

  function diagnostics() {
    return Object.freeze({
      version: CONTEXT_PACK_SOURCE_COLLECTOR_VERSION,
      collections,
      rejections,
      sourceFailures,
      lastPackId,
    });
  }

  return Object.freeze({
    version: CONTEXT_PACK_SOURCE_COLLECTOR_VERSION,
    collect,
    diagnostics,
  });
}

module.exports = {
  CONTEXT_PACK_SOURCE_COLLECTOR_VERSION,
  createContextPackSourceCollector,
};
