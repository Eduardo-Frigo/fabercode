'use strict';

const util = require('util');

const {
  createContextPackCompiler,
} = require('../agent_runtime/context_pack_compiler');
const {
  createContextPackSourceCollector,
} = require('../agent_runtime/context_pack_collector');
const {
  createContextPackProductionAuthorizer,
} = require('./context_pack_production_authorizer');
const {
  createContextPackProductionSourceReaders,
} = require('./context_pack_production_source_readers');

const CONTEXT_PACK_PRODUCTION_RUNTIME_VERSION = 'context-pack-production-runtime.v1';
const OPTION_KEYS = Object.freeze([
  'authorizeBinding',
  'applicationMapService',
  'milestoneService',
  'gitService',
  'getActiveMemory',
  'getConversation',
  'getProjectRootReader',
  'compilerOptions',
]);
const REQUIRED_OPTION_KEYS = Object.freeze(OPTION_KEYS.filter(
  (key) => key !== 'compilerOptions'
));

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

function captureOwnMethod(value, methodName, fieldName) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, methodName);
  } catch {
    throw new TypeError(`${fieldName}.${methodName} must be inspectable`);
  }
  if (!descriptor || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) {
    throw new TypeError(`${fieldName}.${methodName} must be an own data method`);
  }
  return Object.freeze({ receiver: value, method: descriptor.value });
}

function createContextPackProductionRuntime(options = {}) {
  const fields = exactDataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS);
  if (!fields) throw new TypeError('Invalid production ContextPack runtime options');

  const authorizerBundle = createContextPackProductionAuthorizer({
    authorizeBinding: fields.get('authorizeBinding'),
  });
  const compiler = createContextPackCompiler(
    fields.has('compilerOptions') ? fields.get('compilerOptions') : {}
  );
  const readerBundle = createContextPackProductionSourceReaders({
    applicationMapService: fields.get('applicationMapService'),
    milestoneService: fields.get('milestoneService'),
    gitService: fields.get('gitService'),
    getActiveMemory: fields.get('getActiveMemory'),
    getConversation: fields.get('getConversation'),
    getProjectRootReader: fields.get('getProjectRootReader'),
  });
  const collector = createContextPackSourceCollector({
    authorizer: authorizerBundle.authorizer,
    compiler,
    readers: readerBundle.readers,
  });

  const collectPort = captureOwnMethod(collector, 'collect', 'collector');
  const authorizerDiagnostics = captureOwnMethod(
    authorizerBundle,
    'diagnostics',
    'authorizerBundle'
  );
  const compilerDiagnostics = captureOwnMethod(compiler, 'diagnostics', 'compiler');
  const readerDiagnostics = captureOwnMethod(readerBundle, 'diagnostics', 'readerBundle');
  const collectorDiagnostics = captureOwnMethod(collector, 'diagnostics', 'collector');

  function collect(input) {
    return Reflect.apply(collectPort.method, collectPort.receiver, [input]);
  }

  function diagnostics() {
    return Object.freeze({
      version: CONTEXT_PACK_PRODUCTION_RUNTIME_VERSION,
      authorizer: Reflect.apply(
        authorizerDiagnostics.method,
        authorizerDiagnostics.receiver,
        []
      ),
      compiler: Reflect.apply(compilerDiagnostics.method, compilerDiagnostics.receiver, []),
      readers: Reflect.apply(readerDiagnostics.method, readerDiagnostics.receiver, []),
      collector: Reflect.apply(collectorDiagnostics.method, collectorDiagnostics.receiver, []),
    });
  }

  return Object.freeze({
    version: CONTEXT_PACK_PRODUCTION_RUNTIME_VERSION,
    collect,
    diagnostics,
  });
}

module.exports = {
  CONTEXT_PACK_PRODUCTION_RUNTIME_VERSION,
  createContextPackProductionRuntime,
};
