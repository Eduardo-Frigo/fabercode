'use strict';

const util = require('util');

const {
  CONTEXT_PACK_SURFACES,
  assertContextPackManifest,
} = require('./context_pack_contracts');
const {
  HARNESS_OPERATIONS,
  assertHarnessRequest,
  attachContextPackToHarnessRequest,
} = require('./harness_contracts');

const CONTEXT_PACK_HARNESS_INJECTOR_VERSION = 'context-pack-harness-injector.v1';
const SUPPORTED_SURFACES = Object.freeze(Object.values(CONTEXT_PACK_SURFACES));

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

function inspectableFunction(value, fieldName, { synchronous = false } = {}) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)
    || (synchronous && util.types.isAsyncFunction(value))) {
    throw new TypeError(`${fieldName} must be an inspectable${
      synchronous ? ' synchronous' : ''
    } function`);
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

function captureRuntime(value) {
  const fields = exactDataFields(value, ['version', 'collect', 'diagnostics']);
  if (!fields || !Object.isFrozen(value)
    || typeof fields.get('version') !== 'string'
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(fields.get('version'))) {
    throw new TypeError('contextPackRuntime must be a frozen runtime port');
  }
  inspectableFunction(fields.get('diagnostics'), 'contextPackRuntime.diagnostics');
  return Object.freeze({
    receiver: value,
    collect: inspectableFunction(fields.get('collect'), 'contextPackRuntime.collect'),
  });
}

function consumeNativePromise(value) {
  if (!util.types.isPromise(value)) return;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => {}, () => {}]);
  } catch {
    // The synchronous binding boundary rejects native promises regardless.
  }
}

function observeNativePromise(value) {
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, value, [resolve, reject]);
    } catch {
      reject(new TypeError('ContextPack collection failed'));
    }
  });
}

function ownDataValue(value, key) {
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && descriptor.enumerable === true
    && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function surfaceForRequest(request) {
  if (request.operation === HARNESS_OPERATIONS.MESSAGE) {
    return ownDataValue(request.payload, 'isMapChat') === true
      ? CONTEXT_PACK_SURFACES.MAP_CHAT
      : CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE;
  }
  if (request.operation === HARNESS_OPERATIONS.EXECUTE) {
    const milestoneId = ownDataValue(request.action, 'milestoneId');
    return typeof milestoneId === 'string' && milestoneId.trim()
      ? CONTEXT_PACK_SURFACES.MILESTONE_EXECUTE
      : CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE;
  }
  return CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE;
}

function assertContextPackHarnessInjector(value) {
  const fields = exactDataFields(value, ['version', 'inject', 'diagnostics']);
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== CONTEXT_PACK_HARNESS_INJECTOR_VERSION) {
    throw new TypeError('contextPackInjector must implement the canonical injector contract');
  }
  try {
    inspectableFunction(fields.get('inject'), 'contextPackInjector.inject');
    inspectableFunction(fields.get('diagnostics'), 'contextPackInjector.diagnostics');
  } catch {
    throw new TypeError('contextPackInjector must implement the canonical injector contract');
  }
  return value;
}

function createContextPackHarnessInjector(options = {}) {
  const fields = exactDataFields(options, ['contextPackRuntime', 'bindRequest']);
  if (!fields) throw new TypeError('Invalid ContextPack Harness injector options');
  const runtime = captureRuntime(fields.get('contextPackRuntime'));
  const bindRequest = inspectableFunction(
    fields.get('bindRequest'),
    'bindRequest',
    { synchronous: true }
  );

  let injections = 0;
  let rejections = 0;
  let lastPackId = null;
  const surfaceCounters = new Map(SUPPORTED_SURFACES.map((surface) => [surface, 0]));

  async function inject(request) {
    try {
      assertHarnessRequest(request);
      if (!Object.isFrozen(request)
        || Object.prototype.hasOwnProperty.call(request, 'contextPack')) {
        throw new TypeError('ContextPack injection requires a fresh frozen Harness request');
      }
      const surface = surfaceForRequest(request);
      let binding;
      try {
        binding = Reflect.apply(bindRequest, undefined, [request]);
      } catch {
        throw new TypeError('ContextPack Harness binding failed');
      }
      if (util.types.isPromise(binding)) {
        consumeNativePromise(binding);
        throw new TypeError('ContextPack Harness binding must be synchronous');
      }

      const collectionInput = Object.freeze({ binding, surface });
      let pending;
      try {
        pending = Reflect.apply(runtime.collect, runtime.receiver, [collectionInput]);
      } catch {
        throw new TypeError('ContextPack collection failed');
      }
      if (!util.types.isPromise(pending)) {
        throw new TypeError('ContextPack collection must be asynchronous');
      }
      let collected;
      try {
        collected = await observeNativePromise(pending);
      } catch {
        throw new TypeError('ContextPack collection failed');
      }
      const manifest = assertContextPackManifest(collected);
      if (manifest.requestId !== request.requestId) {
        throw new TypeError('ContextPack requestId does not match its Harness request');
      }
      if (manifest.surface !== surface) {
        throw new TypeError('ContextPack surface does not match its Harness request');
      }
      const injected = attachContextPackToHarnessRequest(request, manifest);
      injections += 1;
      lastPackId = manifest.packId;
      surfaceCounters.set(surface, surfaceCounters.get(surface) + 1);
      return injected;
    } catch (error) {
      rejections += 1;
      throw error instanceof TypeError
        ? error
        : new TypeError('ContextPack Harness injection failed');
    }
  }

  function diagnostics() {
    return Object.freeze({
      version: CONTEXT_PACK_HARNESS_INJECTOR_VERSION,
      injections,
      rejections,
      lastPackId,
      surfaces: Object.freeze(Object.fromEntries(SUPPORTED_SURFACES.map(
        (surface) => [surface, surfaceCounters.get(surface)]
      ))),
    });
  }

  return Object.freeze({
    version: CONTEXT_PACK_HARNESS_INJECTOR_VERSION,
    inject,
    diagnostics,
  });
}

module.exports = {
  CONTEXT_PACK_HARNESS_INJECTOR_VERSION,
  assertContextPackHarnessInjector,
  createContextPackHarnessInjector,
};
