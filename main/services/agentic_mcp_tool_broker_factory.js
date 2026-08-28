'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');

const AGENTIC_MCP_TOOL_BROKER_FACTORY_VERSION = 'agentic-mcp-tool-broker-factory.v1';
const AGENTIC_MCP_TOOL_ROUTE_VERSION = 'agentic-mcp-tool-route.v1';
const MCP_TOOL_RESULT_FORMAT = 'agentic-mcp-tool-result-v1';
const MCP_CACHE_SCHEMA_VERSION = 'faber-external-mcp-discovery-cache-v1';
const AGENTIC_MCP_TOOL_ROUTE_REASONS = Object.freeze({
  APPROVAL_DENIED: 'AGENTIC_MCP_TOOL_APPROVAL_DENIED',
  APPROVAL_INVALID: 'AGENTIC_MCP_TOOL_APPROVAL_INVALID',
  AUTHORITY_DENIED: 'AGENTIC_MCP_TOOL_AUTHORITY_DENIED',
  CACHE_INVALID: 'AGENTIC_MCP_TOOL_CACHE_INVALID',
  CANCELLED: 'AGENTIC_MCP_TOOL_CANCELLED',
  EXTERNAL_WRITE_DISABLED: 'AGENTIC_MCP_TOOL_EXTERNAL_WRITE_DISABLED',
  IDEMPOTENCY_CONFLICT: 'AGENTIC_MCP_TOOL_IDEMPOTENCY_CONFLICT',
  INVALID_INPUT: 'AGENTIC_MCP_TOOL_INVALID_INPUT',
  INVALID_RESULT: 'AGENTIC_MCP_TOOL_INVALID_RESULT',
  NOT_ALLOWLISTED: 'AGENTIC_MCP_TOOL_NOT_ALLOWLISTED',
  OPERATION_FAILED: 'AGENTIC_MCP_TOOL_OPERATION_FAILED',
});

const SAFE_ID = /^[A-Za-z0-9._:@-]{1,256}$/;
const SERVER_ID = /^[a-z0-9][a-z0-9_.:-]{0,255}$/;
const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ARGUMENT_NODES = 10_000;
const MAX_ARGUMENT_DEPTH = 32;
const MAX_ARGUMENT_STRING_BYTES = 256 * 1024;
const MAX_CACHE_SERVERS = 512;
const MAX_CACHE_TOOLS_PER_SERVER = 4_096;
const MAX_CONTENT_ENTRIES = 128;
const MAX_CONTENT_TEXT_BYTES = 32 * 1024;
const MAX_TOTAL_CONTENT_TEXT_BYTES = 128 * 1024;
const MAX_STRUCTURED_NODES = 10_000;
const MAX_STRUCTURED_STRING_BYTES = 128 * 1024;
const MAX_IDEMPOTENCY_RECORDS = 512;
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
  'readDiscoveryCache',
  'callExternalTool',
  'requestWriteApproval',
  'consumeWriteApproval',
  'getSignal',
  'audit',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'readDiscoveryCache',
  'callExternalTool',
  'requestWriteApproval',
  'consumeWriteApproval',
]);
const CACHE_ROOT_KEYS = Object.freeze(['ok', 'schemaVersion', 'updatedAt', 'discoveries']);
const CACHE_ENTRY_KEYS = Object.freeze([
  'serverId',
  'toolCount',
  'cachedAt',
  'discoveredAt',
  'tools',
]);
const CACHE_TOOL_KEYS = Object.freeze([
  'serverId',
  'serverName',
  'name',
  'normalizedName',
  'mcpToolName',
  'description',
  'inputSchema',
  'permission',
  'riskLevel',
  'riskPolicy',
  'allowed',
  'blockedReason',
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

function denseArrayKeys(value, maximum) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  return keys.length === value.length
    && keys.every((key, index) => key === String(index))
    ? keys
    : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function snapshotJson(value, limits, state = { nodes: 0, stringBytes: 0, seen: new Set() }, depth = 0) {
  if (depth > limits.maxDepth) throw new TypeError('MCP JSON exceeds depth bound');
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) throw new TypeError('MCP JSON exceeds node bound');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('MCP JSON contains an invalid number');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new TypeError('MCP JSON contains NUL');
    state.stringBytes += Buffer.byteLength(value, 'utf8');
    if (state.stringBytes > limits.maxStringBytes) {
      throw new TypeError('MCP JSON exceeds string bound');
    }
    return value;
  }
  if (!value || typeof value !== 'object' || util.types.isProxy(value)
    || util.types.isPromise(value) || state.seen.has(value)) {
    throw new TypeError('MCP JSON contains an unsupported value');
  }
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if ((isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)) {
    throw new TypeError('MCP JSON must contain plain data');
  }
  const keys = Reflect.ownKeys(value).filter((key) => !(isArray && key === 'length'));
  if (keys.some((key) => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))) {
    throw new TypeError('MCP JSON contains a forbidden key');
  }
  if (isArray && (keys.length !== value.length
    || keys.some((key, index) => key !== String(index)))) {
    throw new TypeError('MCP JSON arrays must be dense');
  }
  state.seen.add(value);
  try {
    if (isArray) {
      return Object.freeze(keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('MCP JSON arrays must contain data properties');
        }
        return snapshotJson(descriptor.value, limits, state, depth + 1);
      }));
    }
    const result = {};
    for (const key of [...keys].sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
        throw new TypeError('MCP JSON records must contain data properties');
      }
      result[key] = snapshotJson(descriptor.value, limits, state, depth + 1);
    }
    return Object.freeze(result);
  } finally {
    state.seen.delete(value);
  }
}

function snapshotArguments(value) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('MCP tool arguments are invalid');
  }
  return snapshotJson(value, {
    maxDepth: MAX_ARGUMENT_DEPTH,
    maxNodes: MAX_ARGUMENT_NODES,
    maxStringBytes: MAX_ARGUMENT_STRING_BYTES,
  });
}

function normalizeCallInput(input) {
  const fields = exactOwnDataFields(
    input,
    ['serverId', 'toolName', 'arguments', 'idempotencyKey'],
    ['serverId', 'toolName', 'arguments', 'idempotencyKey']
  );
  if (!fields || typeof fields.get('serverId') !== 'string'
    || !SERVER_ID.test(fields.get('serverId'))
    || typeof fields.get('toolName') !== 'string'
    || !TOOL_NAME.test(fields.get('toolName'))
    || typeof fields.get('idempotencyKey') !== 'string'
    || !SAFE_ID.test(fields.get('idempotencyKey'))) {
    throw new TypeError('MCP tool input is invalid');
  }
  let args;
  try {
    args = snapshotArguments(fields.get('arguments'));
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError('MCP tool input is invalid');
  }
  return Object.freeze({
    serverId: fields.get('serverId'),
    toolName: fields.get('toolName'),
    arguments: args,
    idempotencyKey: fields.get('idempotencyKey'),
  });
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
  return canonicalRootPath === expectedBinding.canonicalRootPath
    && dataValue(raw, 'realRootPath') === expectedBinding.realRootPath
    ? Object.freeze({ authorized: true })
    : null;
}

function routeFailure(code) {
  return Object.freeze({ ok: false, code });
}

function cancelledFailure() {
  return Object.freeze({
    ok: false,
    cancelled: true,
    code: AGENTIC_MCP_TOOL_ROUTE_REASONS.CANCELLED,
  });
}

function validCacheText(value) {
  return typeof value === 'string' && !value.includes('\0')
    && Buffer.byteLength(value, 'utf8') <= 16 * 1024;
}

function resolveCachedTool(raw, serverId, toolName) {
  const rootFields = exactOwnDataFields(raw, CACHE_ROOT_KEYS, CACHE_ROOT_KEYS);
  if (!rootFields || rootFields.get('ok') !== true
    || rootFields.get('schemaVersion') !== MCP_CACHE_SCHEMA_VERSION
    || !validCacheText(rootFields.get('updatedAt'))) {
    return Object.freeze({ ok: false, code: AGENTIC_MCP_TOOL_ROUTE_REASONS.CACHE_INVALID });
  }
  const discoveryKeys = denseArrayKeys(rootFields.get('discoveries'), MAX_CACHE_SERVERS);
  if (!discoveryKeys) {
    return Object.freeze({ ok: false, code: AGENTIC_MCP_TOOL_ROUTE_REASONS.CACHE_INVALID });
  }
  let matchedTool = null;
  for (const discoveryKey of discoveryKeys) {
    const entryFields = exactOwnDataFields(
      rootFields.get('discoveries')[discoveryKey],
      CACHE_ENTRY_KEYS,
      CACHE_ENTRY_KEYS
    );
    const tools = entryFields && entryFields.get('tools');
    const toolKeys = denseArrayKeys(tools, MAX_CACHE_TOOLS_PER_SERVER);
    if (!entryFields || typeof entryFields.get('serverId') !== 'string'
      || !SERVER_ID.test(entryFields.get('serverId'))
      || !Number.isSafeInteger(entryFields.get('toolCount'))
      || !toolKeys || entryFields.get('toolCount') !== toolKeys.length
      || !validCacheText(entryFields.get('cachedAt'))
      || !validCacheText(entryFields.get('discoveredAt'))) {
      return Object.freeze({ ok: false, code: AGENTIC_MCP_TOOL_ROUTE_REASONS.CACHE_INVALID });
    }
    for (const toolKey of toolKeys) {
      const toolFields = exactOwnDataFields(tools[toolKey], CACHE_TOOL_KEYS, CACHE_TOOL_KEYS);
      if (!toolFields || typeof toolFields.get('serverId') !== 'string'
        || (toolFields.get('serverId') && toolFields.get('serverId') !== entryFields.get('serverId'))
        || typeof toolFields.get('name') !== 'string'
        || !TOOL_NAME.test(toolFields.get('name'))
        || !['read', 'write'].includes(toolFields.get('permission'))
        || !['low', 'medium', 'high', 'critical'].includes(toolFields.get('riskLevel'))
        || typeof toolFields.get('allowed') !== 'boolean') {
        return Object.freeze({ ok: false, code: AGENTIC_MCP_TOOL_ROUTE_REASONS.CACHE_INVALID });
      }
      if (entryFields.get('serverId') === serverId && toolFields.get('name') === toolName) {
        if (matchedTool) {
          return Object.freeze({ ok: false, code: AGENTIC_MCP_TOOL_ROUTE_REASONS.CACHE_INVALID });
        }
        matchedTool = Object.freeze({
          allowed: toolFields.get('allowed'),
          permission: toolFields.get('permission'),
          riskLevel: toolFields.get('riskLevel'),
        });
      }
    }
  }
  if (!matchedTool || matchedTool.allowed !== true) {
    return Object.freeze({ ok: false, code: AGENTIC_MCP_TOOL_ROUTE_REASONS.NOT_ALLOWLISTED });
  }
  const policyDigest = crypto.createHash('sha256').update(JSON.stringify({
    updatedAt: rootFields.get('updatedAt'),
    serverId,
    toolName,
    permission: matchedTool.permission,
    riskLevel: matchedTool.riskLevel,
    allowed: matchedTool.allowed,
  })).digest('hex');
  return Object.freeze({ ok: true, ...matchedTool, policyDigest });
}

function clippedUtf8(value, maximumBytes) {
  const source = Buffer.from(value, 'utf8');
  if (source.length <= maximumBytes) return Object.freeze({ text: value, truncated: false });
  let end = maximumBytes - 3;
  while (end > 0 && (source[end] & 0xc0) === 0x80) end -= 1;
  return Object.freeze({
    text: `${source.subarray(0, Math.max(0, end)).toString('utf8')}...`,
    truncated: true,
  });
}

function projectExternalToolResult(raw, expected) {
  if (dataValue(raw, 'cancelled') === true) return cancelledFailure();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || util.types.isProxy(raw)
    || dataValue(raw, 'ok') !== true) {
    return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.OPERATION_FAILED);
  }
  const externalResult = dataValue(raw, 'result');
  if (!externalResult || typeof externalResult !== 'object' || Array.isArray(externalResult)
    || util.types.isProxy(externalResult)) {
    return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.INVALID_RESULT);
  }
  const nestedResult = dataValue(externalResult, 'result');
  const content = dataValue(externalResult, 'content')
    || dataValue(nestedResult, 'content')
    || [];
  const contentKeys = denseArrayKeys(content, MAX_CONTENT_ENTRIES);
  if (!contentKeys) return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.INVALID_RESULT);
  let totalTextBytes = 0;
  let truncated = false;
  const safeContent = [];
  for (const key of contentKeys) {
    const item = content[key];
    const type = dataValue(item, 'type');
    if (typeof type !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(type)) {
      return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.INVALID_RESULT);
    }
    if (type === 'text') {
      const text = dataValue(item, 'text');
      if (typeof text !== 'string' || text.includes('\0')) {
        return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.INVALID_RESULT);
      }
      const remaining = Math.max(0, MAX_TOTAL_CONTENT_TEXT_BYTES - totalTextBytes);
      const clipped = clippedUtf8(text, Math.min(MAX_CONTENT_TEXT_BYTES, remaining));
      totalTextBytes += Buffer.byteLength(clipped.text, 'utf8');
      truncated = truncated || clipped.truncated || remaining === 0;
      safeContent.push(Object.freeze({ type, text: clipped.text }));
      continue;
    }
    if (type === 'image') {
      const mimeType = dataValue(item, 'mimeType');
      safeContent.push(Object.freeze({
        type,
        ...(typeof mimeType === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)
          ? { mimeType }
          : {}),
      }));
      continue;
    }
    safeContent.push(Object.freeze({ type }));
  }
  const rawStructuredContent = dataValue(externalResult, 'structuredContent')
    || dataValue(nestedResult, 'structuredContent')
    || null;
  let structuredContent = null;
  if (rawStructuredContent !== null) {
    try {
      structuredContent = snapshotJson(rawStructuredContent, {
        maxDepth: MAX_ARGUMENT_DEPTH,
        maxNodes: MAX_STRUCTURED_NODES,
        maxStringBytes: MAX_STRUCTURED_STRING_BYTES,
      });
    } catch (error) {
      preflightDataGraph(error);
      truncated = true;
    }
  }
  const artifacts = dataValue(raw, 'artifacts');
  const artifactCount = Array.isArray(artifacts) && artifacts.length <= 10_000
    ? artifacts.length
    : 0;
  return deepFreeze({
    ok: true,
    status: 'succeeded',
    format: MCP_TOOL_RESULT_FORMAT,
    serverId: expected.serverId,
    toolName: expected.toolName,
    content: safeContent,
    structuredContent,
    artifactCount,
    truncated,
    untrusted: true,
  });
}

function invocationDigest(input, policyDigest) {
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    serverId: input.serverId,
    toolName: input.toolName,
    arguments: input.arguments,
    policyDigest,
  })).digest('hex');
  return `sha256:${digest}`;
}

function createAgenticMcpToolBrokerFactory(options = {}) {
  const fields = exactOwnDataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS);
  if (!fields) throw new TypeError('Invalid agentic MCP tool broker options');
  const authorizeLifecycle = fields.get('authorizeLifecycle');
  const authorizeRoot = fields.get('authorizeRoot');
  const authorizeEffectFrontier = fields.get('authorizeEffectFrontier');
  const readDiscoveryCache = fields.get('readDiscoveryCache');
  const callExternalTool = fields.get('callExternalTool');
  const requestWriteApproval = fields.get('requestWriteApproval');
  const consumeWriteApproval = fields.get('consumeWriteApproval');
  const getSignal = fields.has('getSignal') ? fields.get('getSignal') : () => null;
  const audit = fields.has('audit') ? fields.get('audit') : () => {};
  for (const [name, callback] of [
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeEffectFrontier', authorizeEffectFrontier],
    ['readDiscoveryCache', readDiscoveryCache],
    ['callExternalTool', callExternalTool],
    ['requestWriteApproval', requestWriteApproval],
    ['consumeWriteApproval', consumeWriteApproval],
    ['getSignal', getSignal],
    ['audit', audit],
  ]) {
    if (typeof callback !== 'function' || util.types.isProxy(callback)) {
      throw new TypeError(`${name} must be a trusted function`);
    }
  }

  let routesCreated = 0;
  let totalCalls = 0;

  function createRoute(input = {}) {
    const routeFields = exactOwnDataFields(input, ['binding'], ['binding']);
    if (!routeFields) throw new TypeError('Invalid agentic MCP tool route options');
    let binding;
    try {
      binding = createCapabilityDelegationBinding(routeFields.get('binding'));
    } catch (error) {
      preflightDataGraph(error);
      throw new TypeError('Agentic MCP tool route binding is invalid');
    }

    function allAuthorityActive() {
      let lifecycle;
      let root;
      let frontier;
      try {
        lifecycle = authorizeLifecycle(binding);
        root = authorizeRoot(Object.freeze({
          projectId: binding.projectId,
          rootPath: binding.canonicalRootPath,
        }));
        frontier = authorizeEffectFrontier(binding);
      } catch (error) {
        preflightDataGraph(error);
        return false;
      }
      return Boolean(
        normalizeLifecycleAuthorization(lifecycle, binding)
        && normalizeRootAuthorization(root, binding)
        && normalizeLifecycleAuthorization(frontier, binding)
      );
    }

    function currentSignal() {
      try {
        const signal = getSignal(binding);
        return signal && typeof signal === 'object' ? signal : null;
      } catch (error) {
        preflightDataGraph(error);
        return null;
      }
    }

    function cachedTool(serverId, toolName) {
      let raw;
      try {
        raw = Reflect.apply(readDiscoveryCache, undefined, []);
      } catch (error) {
        preflightDataGraph(error);
        return Object.freeze({ ok: false, code: AGENTIC_MCP_TOOL_ROUTE_REASONS.CACHE_INVALID });
      }
      if (util.types.isPromise(raw)) {
        preflightDataGraph(raw);
        return Object.freeze({ ok: false, code: AGENTIC_MCP_TOOL_ROUTE_REASONS.CACHE_INVALID });
      }
      return resolveCachedTool(raw, serverId, toolName);
    }

    const records = new Map();
    let calls = 0;
    let completed = 0;
    let denied = 0;
    let cancelled = 0;
    let idempotentReplays = 0;
    let idempotencyConflicts = 0;
    let writeApprovalRequests = 0;
    let writeApprovalConsumptions = 0;

    function call(rawInput) {
      const normalized = normalizeCallInput(rawInput);
      if (!allAuthorityActive()) {
        denied += 1;
        return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.AUTHORITY_DENIED);
      }
      const signal = currentSignal();
      if (signal && signal.aborted === true) {
        cancelled += 1;
        return cancelledFailure();
      }
      const policy = cachedTool(normalized.serverId, normalized.toolName);
      if (!policy.ok) {
        denied += 1;
        return routeFailure(policy.code);
      }
      const digest = invocationDigest(normalized, policy.policyDigest);
      const existing = records.get(normalized.idempotencyKey);
      if (existing) {
        if (existing.digest !== digest) {
          idempotencyConflicts += 1;
          return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.IDEMPOTENCY_CONFLICT);
        }
        idempotentReplays += 1;
        return existing.promise;
      }

      const invocation = Object.freeze({
        serverId: normalized.serverId,
        toolName: normalized.toolName,
        arguments: normalized.arguments,
        projectSession: Object.freeze({
          sessionId: binding.sessionId,
          projectId: binding.projectId,
          rootPath: binding.canonicalRootPath,
          realRootPath: binding.realRootPath,
          jobId: binding.jobId,
        }),
        signal,
      });
      const operation = (async () => {
        if (!allAuthorityActive()) {
          denied += 1;
          return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.AUTHORITY_DENIED);
        }
        const revalidated = cachedTool(normalized.serverId, normalized.toolName);
        if (!revalidated.ok || revalidated.permission !== policy.permission
          || revalidated.policyDigest !== policy.policyDigest) {
          denied += 1;
          return routeFailure(revalidated.code || AGENTIC_MCP_TOOL_ROUTE_REASONS.NOT_ALLOWLISTED);
        }
        if (signal && signal.aborted === true) {
          cancelled += 1;
          return cancelledFailure();
        }

        if (policy.permission === 'write') {
          const approvalInput = Object.freeze({
            binding,
            serverId: normalized.serverId,
            toolName: normalized.toolName,
            invocationDigest: digest,
            idempotencyKey: normalized.idempotencyKey,
            riskLevel: policy.riskLevel,
            signal,
          });
          let approval;
          try {
            approval = Reflect.apply(requestWriteApproval, undefined, [approvalInput]);
            if (util.types.isPromise(approval)) approval = await approval;
            writeApprovalRequests += 1;
          } catch (error) {
            preflightDataGraph(error);
            if (signal && signal.aborted === true) {
              cancelled += 1;
              return cancelledFailure();
            }
            denied += 1;
            return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.APPROVAL_INVALID);
          }
          if (signal && signal.aborted === true) {
            cancelled += 1;
            return cancelledFailure();
          }
          if (!approval || typeof approval !== 'object' || util.types.isProxy(approval)
            || dataValue(approval, 'ok') !== true
            || dataValue(approval, 'approved') !== true) {
            denied += 1;
            return routeFailure(
              dataValue(approval, 'ok') === true && dataValue(approval, 'approved') === false
                ? AGENTIC_MCP_TOOL_ROUTE_REASONS.APPROVAL_DENIED
                : AGENTIC_MCP_TOOL_ROUTE_REASONS.APPROVAL_INVALID
            );
          }
          const receipt = dataValue(approval, 'receipt');
          if (!receipt || typeof receipt !== 'object' || util.types.isProxy(receipt)) {
            denied += 1;
            return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.APPROVAL_INVALID);
          }
          if (!allAuthorityActive()) {
            denied += 1;
            return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.AUTHORITY_DENIED);
          }
          const approvedPolicy = cachedTool(normalized.serverId, normalized.toolName);
          if (!approvedPolicy.ok || approvedPolicy.permission !== 'write'
            || approvedPolicy.policyDigest !== policy.policyDigest) {
            denied += 1;
            return routeFailure(
              approvedPolicy.code || AGENTIC_MCP_TOOL_ROUTE_REASONS.NOT_ALLOWLISTED
            );
          }
          if (signal && signal.aborted === true) {
            cancelled += 1;
            return cancelledFailure();
          }
          let consumed;
          try {
            consumed = Reflect.apply(consumeWriteApproval, undefined, [Object.freeze({
              ...approvalInput,
              receipt,
            })]);
            writeApprovalConsumptions += 1;
          } catch (error) {
            preflightDataGraph(error);
            denied += 1;
            return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.APPROVAL_INVALID);
          }
          if (util.types.isPromise(consumed)
            || !consumed || typeof consumed !== 'object' || util.types.isProxy(consumed)
            || dataValue(consumed, 'ok') !== true
            || dataValue(consumed, 'authorized') !== true) {
            preflightDataGraph(consumed);
            denied += 1;
            return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.APPROVAL_INVALID);
          }
        }

        let raw;
        try {
          raw = Reflect.apply(callExternalTool, undefined, [invocation]);
          if (util.types.isPromise(raw)) raw = await raw;
        } catch (error) {
          preflightDataGraph(error);
          if (signal && signal.aborted === true) {
            cancelled += 1;
            return cancelledFailure();
          }
          return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.OPERATION_FAILED);
        }
        if (signal && signal.aborted === true) {
          cancelled += 1;
          return cancelledFailure();
        }
        if (!allAuthorityActive()) {
          denied += 1;
          return routeFailure(AGENTIC_MCP_TOOL_ROUTE_REASONS.AUTHORITY_DENIED);
        }
        const projected = projectExternalToolResult(raw, normalized);
        if (projected.ok) completed += 1;
        else if (projected.cancelled) cancelled += 1;
        return projected;
      })();
      if (records.size >= MAX_IDEMPOTENCY_RECORDS) {
        records.delete(records.keys().next().value);
      }
      records.set(normalized.idempotencyKey, Object.freeze({ digest, promise: operation }));
      calls += 1;
      totalCalls += 1;
      try {
        audit(Object.freeze({
          event: 'agentic_mcp_tool_started',
          serverId: normalized.serverId,
          toolName: normalized.toolName,
          permission: policy.permission,
          riskLevel: policy.riskLevel,
        }));
      } catch (error) {
        preflightDataGraph(error);
      }
      return operation;
    }

    function diagnostics() {
      return Object.freeze({
        version: AGENTIC_MCP_TOOL_ROUTE_VERSION,
        calls,
        completed,
        denied,
        cancelled,
        idempotentReplays,
        idempotencyConflicts,
        writeApprovalRequests,
        writeApprovalConsumptions,
        allowlistSource: 'local_cache',
        externalReadsEnabled: true,
        externalWritesEnabled: 'native_dialog_per_call',
        authorityBoundary: 'job_binding',
      });
    }

    routesCreated += 1;
    return Object.freeze({
      version: AGENTIC_MCP_TOOL_ROUTE_VERSION,
      call,
      diagnostics,
    });
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_MCP_TOOL_BROKER_FACTORY_VERSION,
      routesCreated,
      totalCalls,
      allowlistSource: 'local_cache',
      externalReadsDefault: 'allowlisted_only',
      externalWritesDefault: 'native_dialog_per_call',
      idempotencyScope: 'job_local',
      authorityBoundary: 'main_process_only',
    });
  }

  return Object.freeze({ createRoute, diagnostics });
}

module.exports = {
  AGENTIC_MCP_TOOL_BROKER_FACTORY_VERSION,
  AGENTIC_MCP_TOOL_ROUTE_REASONS,
  AGENTIC_MCP_TOOL_ROUTE_VERSION,
  MCP_TOOL_RESULT_FORMAT,
  createAgenticMcpToolBrokerFactory,
};
