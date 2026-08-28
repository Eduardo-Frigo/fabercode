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
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');

const AGENTIC_BROWSER_BROKER_FACTORY_VERSION = 'agentic-browser-broker-factory.v1';
const AGENTIC_BROWSER_ROUTE_VERSION = 'agentic-browser-route.v1';
const AGENTIC_BROWSER_DESCRIPTOR_VERSION = 'agentic-browser-descriptor.v1';
const AGENTIC_BROWSER_ROUTE_REASONS = Object.freeze({
  AUTHORITY_DENIED: 'AGENTIC_BROWSER_ROUTE_AUTHORITY_DENIED',
  IDEMPOTENCY_CONFLICT: 'AGENTIC_BROWSER_ROUTE_IDEMPOTENCY_CONFLICT',
  INTERACTION_DENIED: 'AGENTIC_BROWSER_ROUTE_INTERACTION_DENIED',
  INVALID_INPUT: 'AGENTIC_BROWSER_ROUTE_INVALID_INPUT',
  OPERATION_FAILED: 'AGENTIC_BROWSER_ROUTE_OPERATION_FAILED',
});
const BROWSER_CAPABILITY = 'browser_preview';
const BROWSER_ACTION = 'navigate';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const MAX_URL_LENGTH = 8192;
const MAX_SELECTOR_LENGTH = 2048;
const MAX_FILL_VALUE_LENGTH = 65536;
const MAX_INTERACTION_RECORDS = 256;
const BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'browserSessionService',
  'grantStore',
  'pendingApprovalStore',
  'approvalReviewer',
  'audit',
  'now',
  'requestIdFactory',
  'getSignal',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'browserSessionService',
  'grantStore',
  'pendingApprovalStore',
  'approvalReviewer',
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

function dataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch (error) {
    preflightDataGraph(error);
    return undefined;
  }
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

function normalizeUrl(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_URL_LENGTH || value.includes('\0')) {
    throw new TypeError('Browser URL is invalid');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('Browser URL is invalid');
  }
  if (!['file:', 'http:', 'https:'].includes(parsed.protocol)) {
    throw new TypeError('Browser URL protocol is not allowed');
  }
  return parsed.href;
}

function normalizeViewport(value) {
  const fields = exactOwnDataFields(value, ['width', 'height'], ['width', 'height']);
  if (!fields) throw new TypeError('Browser viewport is invalid');
  const width = fields.get('width');
  const height = fields.get('height');
  if (!Number.isSafeInteger(width) || width < 320 || width > 3840
    || !Number.isSafeInteger(height) || height < 240 || height > 2160) {
    throw new TypeError('Browser viewport is outside the supported bounds');
  }
  return Object.freeze({ width, height });
}

function normalizeOpenInput(input) {
  const fields = exactOwnDataFields(input, ['url', 'viewport'], ['url', 'viewport']);
  if (!fields) throw new TypeError('Browser open input is invalid');
  return Object.freeze({
    operation: 'open',
    url: normalizeUrl(fields.get('url')),
    viewport: normalizeViewport(fields.get('viewport')),
  });
}

function normalizeNavigateInput(input) {
  const fields = exactOwnDataFields(input, ['sessionId', 'url'], ['sessionId', 'url']);
  if (!fields || typeof fields.get('sessionId') !== 'string'
    || !SESSION_ID_PATTERN.test(fields.get('sessionId'))) {
    throw new TypeError('Browser navigate input is invalid');
  }
  return Object.freeze({
    operation: 'navigate',
    sessionId: fields.get('sessionId'),
    url: normalizeUrl(fields.get('url')),
  });
}

function normalizeSessionInput(input) {
  const fields = exactOwnDataFields(input, ['sessionId'], ['sessionId']);
  if (!fields || typeof fields.get('sessionId') !== 'string'
    || !SESSION_ID_PATTERN.test(fields.get('sessionId'))) {
    throw new TypeError('Browser session input is invalid');
  }
  return Object.freeze({ sessionId: fields.get('sessionId') });
}

function normalizeInteractionInput(input) {
  const fields = exactOwnDataFields(
    input,
    ['sessionId', 'action', 'selector', 'value', 'idempotencyKey'],
    ['sessionId', 'action', 'selector', 'idempotencyKey']
  );
  if (!fields || typeof fields.get('sessionId') !== 'string'
    || !SESSION_ID_PATTERN.test(fields.get('sessionId'))
    || !['click', 'fill'].includes(fields.get('action'))
    || typeof fields.get('selector') !== 'string'
    || !fields.get('selector')
    || fields.get('selector').length > MAX_SELECTOR_LENGTH
    || fields.get('selector').includes('\0')
    || typeof fields.get('idempotencyKey') !== 'string'
    || !IDEMPOTENCY_KEY_PATTERN.test(fields.get('idempotencyKey'))) {
    throw new TypeError('Browser interaction input is invalid');
  }
  const action = fields.get('action');
  if ((action === 'click' && fields.has('value'))
    || (action === 'fill'
      && (!fields.has('value')
        || typeof fields.get('value') !== 'string'
        || fields.get('value').length > MAX_FILL_VALUE_LENGTH
        || fields.get('value').includes('\0')))) {
    throw new TypeError('Browser interaction input is invalid');
  }
  return Object.freeze({
    sessionId: fields.get('sessionId'),
    action,
    selector: fields.get('selector'),
    ...(action === 'fill' ? { value: fields.get('value') } : {}),
    idempotencyKey: fields.get('idempotencyKey'),
  });
}

function interactionDigest(input) {
  return crypto.createHash('sha256').update(JSON.stringify({
    sessionId: input.sessionId,
    action: input.action,
    selector: input.selector,
    value: input.action === 'fill' ? input.value : '',
  })).digest('hex');
}

function normalizeNavigationPayload(payload) {
  const fields = exactOwnDataFields(
    payload,
    ['operation', 'url', 'viewport', 'sessionId'],
    ['operation', 'url']
  );
  if (!fields) throw new TypeError('Browser navigation payload is invalid');
  const operation = fields.get('operation');
  if (operation === 'open' && fields.has('viewport') && !fields.has('sessionId')) {
    return Object.freeze({
      operation,
      url: normalizeUrl(fields.get('url')),
      viewport: normalizeViewport(fields.get('viewport')),
    });
  }
  if (operation === 'navigate' && fields.has('sessionId') && !fields.has('viewport')
    && typeof fields.get('sessionId') === 'string'
    && SESSION_ID_PATTERN.test(fields.get('sessionId'))) {
    return Object.freeze({
      operation,
      sessionId: fields.get('sessionId'),
      url: normalizeUrl(fields.get('url')),
    });
  }
  throw new TypeError('Browser navigation payload shape is invalid');
}

function isLocalBrowserUrl(url) {
  const parsed = new URL(url);
  return parsed.protocol === 'file:'
    || ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
}

function navigationOrigin(url) {
  const parsed = new URL(url);
  return parsed.protocol === 'file:' ? 'file://project' : parsed.origin;
}

function routeFailure(code) {
  return Object.freeze({ ok: false, code });
}

function createAgenticBrowserBrokerFactory(options = {}) {
  const fields = exactOwnDataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS);
  if (!fields) throw new TypeError('Invalid agentic browser broker options');
  const authorizeLifecycle = fields.get('authorizeLifecycle');
  const authorizeRoot = fields.get('authorizeRoot');
  const authorizeEffectFrontier = fields.get('authorizeEffectFrontier');
  const browserSessionService = fields.get('browserSessionService');
  const grantStore = fields.get('grantStore');
  const pendingApprovalStore = fields.get('pendingApprovalStore');
  const approvalReviewer = fields.get('approvalReviewer');
  const audit = fields.has('audit') ? fields.get('audit') : () => {};
  const now = fields.has('now') ? fields.get('now') : () => Date.now();
  const requestIdFactory = fields.has('requestIdFactory')
    ? fields.get('requestIdFactory')
    : () => `agentic-browser:${crypto.randomUUID()}`;
  const getSignal = fields.has('getSignal') ? fields.get('getSignal') : () => null;

  for (const [name, callback] of [
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeEffectFrontier', authorizeEffectFrontier],
    ['audit', audit],
    ['now', now],
    ['requestIdFactory', requestIdFactory],
    ['getSignal', getSignal],
  ]) {
    if (typeof callback !== 'function' || util.types.isProxy(callback)) {
      throw new TypeError(`${name} must be a trusted function`);
    }
  }
  for (const [name, receiver, methods] of [
    ['browserSessionService', browserSessionService, ['open', 'navigate', 'interact', 'capture', 'inspect', 'close']],
    ['grantStore', grantStore, ['inspect', 'consume']],
    ['pendingApprovalStore', pendingApprovalStore, ['create', 'resolve']],
    ['approvalReviewer', approvalReviewer, ['verifyDecision']],
  ]) {
    for (const method of methods) captureFrozenOwnMethod(receiver, method, name);
  }
  const browserOpen = captureFrozenOwnMethod(browserSessionService, 'open', 'browserSessionService');
  const browserNavigate = captureFrozenOwnMethod(browserSessionService, 'navigate', 'browserSessionService');
  const browserInteract = captureFrozenOwnMethod(browserSessionService, 'interact', 'browserSessionService');
  const browserCapture = captureFrozenOwnMethod(browserSessionService, 'capture', 'browserSessionService');
  const browserInspect = captureFrozenOwnMethod(browserSessionService, 'inspect', 'browserSessionService');
  const browserClose = captureFrozenOwnMethod(browserSessionService, 'close', 'browserSessionService');

  let routesCreated = 0;
  let totalNavigationRequests = 0;

  function createRoute(input = {}) {
    const routeFields = exactOwnDataFields(input, ['binding'], ['binding']);
    if (!routeFields) throw new TypeError('Invalid agentic browser route options');
    let binding;
    try {
      binding = createCapabilityDelegationBinding(routeFields.get('binding'));
    } catch (error) {
      preflightDataGraph(error);
      throw new TypeError('Agentic browser route binding is invalid');
    }

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

    function effectAuthorization() {
      let raw;
      try {
        raw = authorizeEffectFrontier(binding);
      } catch (error) {
        preflightDataGraph(error);
        return null;
      }
      return normalizeLifecycleAuthorization(raw, binding);
    }

    function allAuthorityActive() {
      return Boolean(rootAuthorization() && lifecycleAuthorization() && effectAuthorization());
    }

    function authorizeSession(session) {
      if (!sessionMatchesBinding(session, binding)
        || !rootAuthorization() || !lifecycleAuthorization()) {
        return Object.freeze({ authorized: false });
      }
      return Object.freeze({ authorized: true, projectSession: session });
    }

    function authorizeEffect(session) {
      if (!sessionMatchesBinding(session, binding) || !allAuthorityActive()) {
        return Object.freeze({ authorized: false });
      }
      return Object.freeze({ authorized: true, projectSession: session });
    }

    function currentSignal() {
      let signal = null;
      try {
        signal = getSignal(binding);
      } catch (error) {
        preflightDataGraph(error);
        return null;
      }
      return signal && typeof signal === 'object' ? signal : null;
    }

    const descriptor = createProjectCapabilityDescriptor({
      capability: BROWSER_CAPABILITY,
      action: BROWSER_ACTION,
      version: AGENTIC_BROWSER_DESCRIPTOR_VERSION,
      kind: PROJECT_CAPABILITY_KINDS.PREVIEW,
      effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ],
      risk: 'low',
      canonicalizePayload: normalizeNavigationPayload,
      classifyEffects(payload) {
        return isLocalBrowserUrl(payload.url)
          ? [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ]
          : [
              PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ,
              PROJECT_CAPABILITY_EFFECTS.NETWORK_ACCESS,
              PROJECT_CAPABILITY_EFFECTS.EXTERNAL_READ,
            ];
      },
      createSelector(payload) {
        return Object.freeze({
          kind: 'browser_navigation',
          operation: payload.operation,
          origin: navigationOrigin(payload.url),
        });
      },
      adapter: Object.freeze({
        execute(payload) {
          const signal = currentSignal();
          const base = {
            jobId: binding.jobId,
            rootPath: binding.canonicalRootPath,
            url: payload.url,
            ...(signal ? { signal } : {}),
          };
          if (payload.operation === 'open') {
            return Reflect.apply(browserOpen.method, browserOpen.receiver, [{
              ...base,
              viewport: payload.viewport,
            }]);
          }
          return Reflect.apply(browserNavigate.method, browserNavigate.receiver, [{
            ...base,
            sessionId: payload.sessionId,
          }]);
        },
      }),
    });
    const broker = createProjectCapabilityBroker({
      authorizeProjectSession: authorizeSession,
      authorizeProjectEffect: authorizeEffect,
      descriptorResolver: Object.freeze({
        resolve(capability, action) {
          return capability === BROWSER_CAPABILITY && action === BROWSER_ACTION
            ? descriptor
            : null;
        },
      }),
      classifier: new CapabilityEffectClassifier(),
      policy: new CapabilityPolicyService(),
      grantStore,
      pendingApprovalStore,
      approvalReviewer,
      sandboxRegistry: Object.freeze({
        select() { throw new Error('Browser navigation does not use a process sandbox'); },
      }),
      buildSandboxEnvironment() {
        throw new Error('Browser navigation does not build a process environment');
      },
      audit: Object.freeze({ record(event) { return audit(event); } }),
      now,
    });
    let navigationRequests = 0;
    let interactions = 0;
    let idempotentReplays = 0;
    let idempotencyConflicts = 0;
    let captures = 0;
    let inspections = 0;
    let closes = 0;

    const localSessions = new Set();
    const interactionRecords = new Map();

    async function executeNavigation(payload) {
      let requestId;
      try {
        requestId = requestIdFactory();
      } catch (error) {
        preflightDataGraph(error);
        throw new TypeError('Agentic browser request id generation failed');
      }
      if (util.types.isPromise(requestId) || typeof requestId !== 'string'
        || !REQUEST_ID_PATTERN.test(requestId)) {
        preflightDataGraph(requestId);
        throw new TypeError('Agentic browser request id is invalid');
      }
      navigationRequests += 1;
      totalNavigationRequests += 1;
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
        capability: BROWSER_CAPABILITY,
        action: BROWSER_ACTION,
        payload,
        context: Object.freeze({
          origin: 'agentic_tool_loop',
          correlationId: binding.jobId,
        }),
      });
      const result = await broker.execute(request);
      const output = dataValue(result, 'output');
      const session = dataValue(output, 'session');
      const sessionId = dataValue(session, 'id');
      const sessionUrl = dataValue(session, 'url');
      if (dataValue(result, 'status') === 'completed'
        && typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId)
        && typeof sessionUrl === 'string') {
        if (isLocalBrowserUrl(sessionUrl)) localSessions.add(sessionId);
        else localSessions.delete(sessionId);
      }
      return result;
    }

    function open(rawInput) {
      return executeNavigation(normalizeOpenInput(rawInput));
    }

    function navigate(rawInput) {
      return executeNavigation(normalizeNavigateInput(rawInput));
    }

    function interact(rawInput) {
      const normalized = normalizeInteractionInput(rawInput);
      if (!allAuthorityActive()) {
        return routeFailure(AGENTIC_BROWSER_ROUTE_REASONS.AUTHORITY_DENIED);
      }
      if (!localSessions.has(normalized.sessionId)) {
        return routeFailure(AGENTIC_BROWSER_ROUTE_REASONS.INTERACTION_DENIED);
      }
      const digest = interactionDigest(normalized);
      const existing = interactionRecords.get(normalized.idempotencyKey);
      if (existing) {
        if (existing.digest !== digest) {
          idempotencyConflicts += 1;
          return routeFailure(AGENTIC_BROWSER_ROUTE_REASONS.IDEMPOTENCY_CONFLICT);
        }
        idempotentReplays += 1;
        return existing.promise;
      }

      const signal = currentSignal();
      const invocation = Object.freeze({
        jobId: binding.jobId,
        sessionId: normalized.sessionId,
        action: normalized.action,
        selector: normalized.selector,
        ...(normalized.action === 'fill' ? { value: normalized.value } : {}),
        ...(signal ? { signal } : {}),
      });
      let raw;
      try {
        raw = Reflect.apply(browserInteract.method, browserInteract.receiver, [invocation]);
      } catch (error) {
        preflightDataGraph(error);
        raw = routeFailure(AGENTIC_BROWSER_ROUTE_REASONS.OPERATION_FAILED);
      }
      const promise = Promise.resolve(raw).then(
        (value) => allAuthorityActive()
          ? value
          : routeFailure(AGENTIC_BROWSER_ROUTE_REASONS.AUTHORITY_DENIED),
        (error) => {
          preflightDataGraph(error);
          return routeFailure(AGENTIC_BROWSER_ROUTE_REASONS.OPERATION_FAILED);
        }
      );
      if (interactionRecords.size >= MAX_INTERACTION_RECORDS) {
        interactionRecords.delete(interactionRecords.keys().next().value);
      }
      interactionRecords.set(normalized.idempotencyKey, Object.freeze({ digest, promise }));
      interactions += 1;
      return promise;
    }

    function directOperation(rawInput, captured, counter) {
      const normalized = normalizeSessionInput(rawInput);
      if (!allAuthorityActive()) {
        return routeFailure(AGENTIC_BROWSER_ROUTE_REASONS.AUTHORITY_DENIED);
      }
      const signal = currentSignal();
      const invocation = Object.freeze({
        jobId: binding.jobId,
        sessionId: normalized.sessionId,
        ...(signal ? { signal } : {}),
      });
      let raw;
      try {
        raw = Reflect.apply(captured.method, captured.receiver, [invocation]);
      } catch (error) {
        preflightDataGraph(error);
        return routeFailure(AGENTIC_BROWSER_ROUTE_REASONS.OPERATION_FAILED);
      }
      counter();
      if (!util.types.isPromise(raw)) return raw;
      return new Promise((resolve) => {
        try {
          Reflect.apply(Promise.prototype.then, raw, [
            (value) => resolve(
              allAuthorityActive()
                ? value
                : routeFailure(AGENTIC_BROWSER_ROUTE_REASONS.AUTHORITY_DENIED)
            ),
            (error) => {
              preflightDataGraph(error);
              resolve(routeFailure(AGENTIC_BROWSER_ROUTE_REASONS.OPERATION_FAILED));
            },
          ]);
        } catch (error) {
          preflightDataGraph(error);
          resolve(routeFailure(AGENTIC_BROWSER_ROUTE_REASONS.OPERATION_FAILED));
        }
      });
    }

    function capture(rawInput) {
      return directOperation(rawInput, browserCapture, () => { captures += 1; });
    }

    function inspect(rawInput) {
      return directOperation(rawInput, browserInspect, () => { inspections += 1; });
    }

    function close(rawInput) {
      const normalized = normalizeSessionInput(rawInput);
      localSessions.delete(normalized.sessionId);
      return directOperation(normalized, browserClose, () => { closes += 1; });
    }

    function diagnostics() {
      return Object.freeze({
        version: AGENTIC_BROWSER_ROUTE_VERSION,
        capability: BROWSER_CAPABILITY,
        action: BROWSER_ACTION,
        navigationRequests,
        interactions,
        idempotentReplays,
        idempotencyConflicts,
        captures,
        inspections,
        closes,
        interactionEnabled: true,
        externalInteractionPolicy: 'disabled',
        externalNavigationPolicy: 'grant_or_approval',
        authorityBoundary: 'job_binding',
      });
    }

    routesCreated += 1;
    return Object.freeze({
      version: AGENTIC_BROWSER_ROUTE_VERSION,
      open,
      navigate,
      interact,
      capture,
      inspect,
      close,
      diagnostics,
    });
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_BROWSER_BROKER_FACTORY_VERSION,
      descriptorVersion: AGENTIC_BROWSER_DESCRIPTOR_VERSION,
      routesCreated,
      totalNavigationRequests,
      capability: BROWSER_CAPABILITY,
      action: BROWSER_ACTION,
      externalNavigationPolicy: 'grant_or_approval',
      localInteractionPolicy: 'idempotency_key_required',
      externalInteractionDefault: 'disabled',
      authorityBoundary: 'main_process_only',
    });
  }

  return Object.freeze({ createRoute, diagnostics });
}

module.exports = {
  AGENTIC_BROWSER_BROKER_FACTORY_VERSION,
  AGENTIC_BROWSER_DESCRIPTOR_VERSION,
  AGENTIC_BROWSER_ROUTE_REASONS,
  AGENTIC_BROWSER_ROUTE_VERSION,
  createAgenticBrowserBrokerFactory,
};
