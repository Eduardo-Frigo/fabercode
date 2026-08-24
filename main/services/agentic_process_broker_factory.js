'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  PROJECT_CAPABILITY_EFFECTS,
  PROJECT_CAPABILITY_KINDS,
  createProjectCapabilityDescriptor,
  createProjectCapabilityRequest,
} = require('../capabilities/project_capability_contracts');
const {
  CapabilityEffectClassifier,
} = require('../capabilities/capability_effect_classifier');
const {
  CapabilityPolicyService,
} = require('../capabilities/capability_policy_service');
const {
  createProjectCapabilityBroker,
} = require('../capabilities/project_capability_broker');
const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  SANDBOX_COMMAND_KINDS,
} = require('../capabilities/sandbox_backend_contract');
const {
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');

const AGENTIC_PROCESS_BROKER_FACTORY_VERSION = 'agentic-process-broker-factory.v1';
const AGENTIC_PROCESS_ROUTE_VERSION = 'agentic-process-route.v1';
const AGENTIC_PROCESS_DESCRIPTOR_VERSION = 'agentic-process-descriptor.v1';
const PROCESS_CAPABILITY = 'process';
const PROCESS_ACTION = 'run';
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_COMMAND_LENGTH = 4_096;
const MAX_ARGS = 128;
const MAX_ARG_LENGTH = 8_192;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'sandboxRegistry',
  'audit',
  'now',
  'requestIdFactory',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'sandboxRegistry',
]);
const CREATE_KEYS = Object.freeze(['binding', 'sandboxExecutor']);
const EXECUTE_KEYS = Object.freeze(['command', 'args', 'timeoutMs']);
const BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);

function exactOwnDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    preflightDataGraph(error);
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
    } catch (error) {
      preflightDataGraph(error);
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function captureFrozenOwnMethod(receiver, name, fieldName) {
  if (!receiver || typeof receiver !== 'object' || util.types.isProxy(receiver)
    || !Object.isFrozen(receiver)) {
    throw new TypeError(`${fieldName} must be a frozen trusted object`);
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(receiver, name);
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError(`${fieldName}.${name} is invalid`);
  }
  if (!descriptor || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) {
    throw new TypeError(`${fieldName}.${name} must be an own data method`);
  }
  return Object.freeze({ receiver, method: descriptor.value });
}

function sameBinding(left, right) {
  return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function dataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (error) {
    preflightDataGraph(error);
    return undefined;
  }
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function normalizeLifecycleAuthorization(raw, expectedBinding) {
  if (util.types.isPromise(raw) || !raw || typeof raw !== 'object'
    || Array.isArray(raw) || util.types.isProxy(raw)
    || dataValue(raw, 'authorized') !== true) return null;
  try {
    const authorizedBinding = createCapabilityDelegationBinding(dataValue(raw, 'binding'));
    return sameBinding(authorizedBinding, expectedBinding) ? authorizedBinding : null;
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
}

function normalizeRootAuthorization(raw, expectedBinding) {
  if (util.types.isPromise(raw) || !raw || typeof raw !== 'object'
    || Array.isArray(raw) || util.types.isProxy(raw)
    || dataValue(raw, 'authorized') !== true
    || (Object.hasOwn(raw, 'ok') && dataValue(raw, 'ok') !== true)
    || dataValue(raw, 'projectId') !== expectedBinding.projectId) return null;
  const canonicalRootPath = dataValue(raw, 'canonicalRootPath') || dataValue(raw, 'rootPath');
  if (canonicalRootPath !== expectedBinding.canonicalRootPath
    || dataValue(raw, 'realRootPath') !== expectedBinding.realRootPath) return null;
  return Object.freeze({
    authorized: true,
    projectId: expectedBinding.projectId,
    rootPath: expectedBinding.canonicalRootPath,
    canonicalRootPath: expectedBinding.canonicalRootPath,
    realRootPath: expectedBinding.realRootPath,
  });
}

function sessionMatchesBinding(session, binding) {
  return Boolean(session) && typeof session === 'object' && !Array.isArray(session)
    && !util.types.isProxy(session)
    && dataValue(session, 'projectId') === binding.projectId
    && dataValue(session, 'sessionId') === binding.sessionId
    && dataValue(session, 'jobId') === binding.jobId
    && dataValue(session, 'rootPath') === binding.canonicalRootPath
    && dataValue(session, 'realRootPath') === binding.realRootPath;
}

function normalizeProcessInput(input) {
  const fields = exactOwnDataFields(input, EXECUTE_KEYS, EXECUTE_KEYS);
  if (!fields) throw new TypeError('Agentic process input must contain exact data fields');
  const command = fields.get('command');
  const args = fields.get('args');
  const timeoutMs = fields.get('timeoutMs');
  if (typeof command !== 'string' || command.trim().length < 1
    || command.length > MAX_COMMAND_LENGTH || command.includes('\0')) {
    throw new TypeError('Agentic process command is invalid');
  }
  if (!Array.isArray(args) || Object.getPrototypeOf(args) !== Array.prototype
    || util.types.isProxy(args) || args.length > MAX_ARGS) {
    throw new TypeError('Agentic process args must be a bounded plain array');
  }
  let argKeys;
  try {
    argKeys = Reflect.ownKeys(args).filter((key) => key !== 'length');
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError('Agentic process args are invalid');
  }
  if (argKeys.length !== args.length
    || argKeys.some((key, index) => key !== String(index))) {
    throw new TypeError('Agentic process args must be a dense data array');
  }
  const normalizedArgs = [];
  for (const key of argKeys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(args, key);
    } catch (error) {
      preflightDataGraph(error);
      throw new TypeError('Agentic process args are invalid');
    }
    const value = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    if (!descriptor || descriptor.enumerable !== true || typeof value !== 'string'
      || value.length > MAX_ARG_LENGTH || value.includes('\0')) {
      throw new TypeError('Agentic process args contain an invalid value');
    }
    normalizedArgs.push(value);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS
    || timeoutMs > MAX_TIMEOUT_MS || Object.is(timeoutMs, -0)) {
    throw new TypeError('Agentic process timeout is outside the supported bounds');
  }
  return Object.freeze({
    command: command.trim(),
    args: Object.freeze(normalizedArgs),
    timeoutMs,
  });
}

function createAgenticProcessBrokerFactory(options = {}) {
  const optionFields = exactOwnDataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS);
  if (!optionFields) throw new TypeError('Invalid agentic process broker factory options');
  const authorizeLifecycle = optionFields.get('authorizeLifecycle');
  const authorizeRoot = optionFields.get('authorizeRoot');
  const authorizeEffectFrontier = optionFields.get('authorizeEffectFrontier');
  const sandboxRegistry = optionFields.get('sandboxRegistry');
  const audit = optionFields.has('audit') ? optionFields.get('audit') : () => {};
  const now = optionFields.has('now') ? optionFields.get('now') : () => Date.now();
  const requestIdFactory = optionFields.has('requestIdFactory')
    ? optionFields.get('requestIdFactory')
    : () => `agentic-process:${crypto.randomUUID()}`;
  for (const [name, callback] of [
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeEffectFrontier', authorizeEffectFrontier],
    ['audit', audit],
    ['now', now],
    ['requestIdFactory', requestIdFactory],
  ]) {
    if (typeof callback !== 'function' || util.types.isProxy(callback)) {
      throw new TypeError(`${name} must be a function`);
    }
  }
  captureFrozenOwnMethod(sandboxRegistry, 'select', 'sandboxRegistry');

  let routesCreated = 0;
  let totalRequests = 0;

  function createRoute(input = {}) {
    const fields = exactOwnDataFields(input, CREATE_KEYS, CREATE_KEYS);
    if (!fields) throw new TypeError('Agentic process route input contains unsupported fields');
    let binding;
    try {
      binding = createCapabilityDelegationBinding(fields.get('binding'));
    } catch (error) {
      preflightDataGraph(error);
      throw new TypeError('Agentic process route binding is invalid');
    }
    const sandboxExecutor = fields.get('sandboxExecutor');

    function rootAuthorization() {
      let raw;
      try {
        raw = authorizeRoot(Object.freeze({
          projectId: binding.projectId,
          rootPath: binding.canonicalRootPath,
        }));
      } catch (error) {
        preflightDataGraph(error);
        return null;
      }
      return normalizeRootAuthorization(raw, binding);
    }

    function lifecycleAuthorization() {
      let raw;
      try {
        raw = authorizeLifecycle(binding);
      } catch (error) {
        preflightDataGraph(error);
        return null;
      }
      return normalizeLifecycleAuthorization(raw, binding);
    }

    function authorizeSession(session) {
      if (!sessionMatchesBinding(session, binding)
        || !rootAuthorization() || !lifecycleAuthorization()) {
        return Object.freeze({ authorized: false });
      }
      return Object.freeze({ authorized: true, projectSession: session });
    }

    function authorizeEffect(session) {
      if (!sessionMatchesBinding(session, binding)) {
        return Object.freeze({ authorized: false });
      }
      let raw;
      try {
        raw = authorizeEffectFrontier(binding);
      } catch (error) {
        preflightDataGraph(error);
        return Object.freeze({ authorized: false });
      }
      if (!normalizeLifecycleAuthorization(raw, binding)) {
        return Object.freeze({ authorized: false });
      }
      return Object.freeze({ authorized: true, projectSession: session });
    }

    const descriptor = createProjectCapabilityDescriptor({
      capability: PROCESS_CAPABILITY,
      action: PROCESS_ACTION,
      version: AGENTIC_PROCESS_DESCRIPTOR_VERSION,
      kind: PROJECT_CAPABILITY_KINDS.PROCESS,
      effects: [PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE],
      requiresSandbox: true,
      risk: 'medium',
      createSandboxExecutionSpec(payload) {
        return Object.freeze({
          command: Object.freeze({
            kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
            executable: payload.command,
            args: payload.args,
          }),
          timeoutMs: payload.timeoutMs,
        });
      },
    });
    const broker = createProjectCapabilityBroker({
      authorizeProjectSession: authorizeSession,
      authorizeProjectEffect: authorizeEffect,
      descriptorResolver: Object.freeze({
        resolve(capability, action) {
          return capability === PROCESS_CAPABILITY && action === PROCESS_ACTION
            ? descriptor
            : null;
        },
      }),
      classifier: new CapabilityEffectClassifier(),
      policy: new CapabilityPolicyService(),
      grantStore: Object.freeze({
        inspect() { return Object.freeze({ authorized: false, reason: 'grant_not_found' }); },
        consume() { return Object.freeze({ authorized: false, reason: 'grant_not_found' }); },
      }),
      pendingApprovalStore: Object.freeze({
        create() { throw new Error('Local process execution must not request external approval'); },
        resolve() { throw new Error('Local process execution has no pending approval'); },
      }),
      approvalReviewer: Object.freeze({
        verifyDecision() { return Object.freeze({ verified: false }); },
      }),
      sandboxRegistry,
      sandboxExecutor,
      buildSandboxEnvironment() { return Object.freeze({}); },
      audit: Object.freeze({ record(event) { return audit(event); } }),
      now,
    });
    let requests = 0;

    async function execute(rawInput) {
      const payload = normalizeProcessInput(rawInput);
      let requestId;
      try {
        requestId = requestIdFactory();
      } catch (error) {
        preflightDataGraph(error);
        throw new TypeError('Agentic process request id generation failed');
      }
      if (util.types.isPromise(requestId) || typeof requestId !== 'string'
        || !REQUEST_ID_PATTERN.test(requestId)) {
        preflightDataGraph(requestId);
        throw new TypeError('Agentic process request id is invalid');
      }
      requests += 1;
      totalRequests += 1;
      const request = createProjectCapabilityRequest({
        requestId,
        principal: Object.freeze({ kind: 'agent', kernelId: binding.kernelId }),
        projectSession: Object.freeze({
          sessionId: binding.sessionId,
          projectId: binding.projectId,
          rootPath: binding.canonicalRootPath,
          realRootPath: binding.realRootPath,
          jobId: binding.jobId,
        }),
        capability: PROCESS_CAPABILITY,
        action: PROCESS_ACTION,
        payload,
        context: Object.freeze({
          origin: 'agentic_tool_loop',
          correlationId: binding.jobId,
        }),
      });
      return broker.execute(request);
    }

    function diagnostics() {
      return Object.freeze({
        version: AGENTIC_PROCESS_ROUTE_VERSION,
        capability: PROCESS_CAPABILITY,
        action: PROCESS_ACTION,
        requests,
        networkMode: 'disabled',
        authorityBoundary: 'job_binding',
      });
    }

    routesCreated += 1;
    return Object.freeze({
      version: AGENTIC_PROCESS_ROUTE_VERSION,
      execute,
      diagnostics,
    });
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_PROCESS_BROKER_FACTORY_VERSION,
      routesCreated,
      totalRequests,
      capability: PROCESS_CAPABILITY,
      action: PROCESS_ACTION,
      networkDefault: 'disabled',
      authorityBoundary: 'main_process_only',
    });
  }

  return Object.freeze({ createRoute, diagnostics });
}

module.exports = {
  AGENTIC_PROCESS_BROKER_FACTORY_VERSION,
  AGENTIC_PROCESS_DESCRIPTOR_VERSION,
  AGENTIC_PROCESS_ROUTE_VERSION,
  createAgenticProcessBrokerFactory,
};
