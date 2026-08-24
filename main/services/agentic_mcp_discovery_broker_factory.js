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

const AGENTIC_MCP_DISCOVERY_BROKER_FACTORY_VERSION =
  'agentic-mcp-discovery-broker-factory.v1';
const AGENTIC_MCP_DISCOVERY_ROUTE_VERSION = 'agentic-mcp-discovery-route.v1';
const AGENTIC_MCP_DISCOVERY_DESCRIPTOR_VERSION =
  'agentic-mcp-discovery-descriptor.v1';
const MCP_DISCOVERY_FORMAT = 'mcp-discovery-cache-v1';
const MCP_DISCOVERY_CAPABILITY = 'external_mcp';
const MCP_DISCOVERY_ACTION = 'read_cached_discovery';
const MCP_CACHE_SCHEMA_VERSION = 'faber-external-mcp-discovery-cache-v1';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,255}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);
const PERMISSIONS = new Set(['read', 'write']);
const MAX_SOURCE_SERVERS = 512;
const MAX_SOURCE_TOOLS_PER_SERVER = 4_096;
const MAX_SOURCE_TEXT_BYTES = 16 * 1024;
const MAX_PUBLIC_SERVERS = 64;
const MAX_PUBLIC_TOOLS_PER_SERVER = 128;
const MAX_PUBLIC_TOOLS = 2_048;
const MAX_PUBLIC_SERVER_NAME_BYTES = 4 * 1024;
const MAX_PUBLIC_DESCRIPTION_BYTES = 2 * 1024;
const MAX_PUBLIC_OUTPUT_BYTES = 256 * 1024;
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
  'audit',
  'now',
  'requestIdFactory',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'readDiscoveryCache',
]);
const CACHE_RESULT_KEYS = Object.freeze([
  'ok',
  'schemaVersion',
  'updatedAt',
  'discoveries',
]);
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
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (error) {
    preflightDataGraph(error);
    return undefined;
  }
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
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

function boundedText(value, { allowEmpty = true, pattern = null } = {}) {
  return typeof value === 'string'
    && value === value.trim()
    && (allowEmpty || value.length > 0)
    && !value.includes('\0')
    && Buffer.byteLength(value, 'utf8') <= MAX_SOURCE_TEXT_BYTES
    && (!pattern || pattern.test(value));
}

function clipUtf8(value, maximumBytes) {
  const source = Buffer.from(value, 'utf8');
  if (source.length <= maximumBytes) return Object.freeze({ text: value, truncated: false });
  const suffix = Buffer.from('...', 'utf8');
  let end = Math.max(0, maximumBytes - suffix.length);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  while (end > 0) {
    try {
      return Object.freeze({
        text: `${decoder.decode(source.subarray(0, end))}...`,
        truncated: true,
      });
    } catch {
      end -= 1;
    }
  }
  return Object.freeze({ text: '...', truncated: true });
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function discoveryFailure(code) {
  return Object.freeze({
    ok: false,
    format: MCP_DISCOVERY_FORMAT,
    code,
  });
}

function projectCachedDiscovery(raw) {
  const preflight = preflightDataGraph(raw);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable) {
    return discoveryFailure('MCP_DISCOVERY_INVALID_SOURCE');
  }
  const rootFields = exactOwnDataFields(raw, CACHE_RESULT_KEYS, CACHE_RESULT_KEYS);
  if (!rootFields || rootFields.get('ok') !== true
    || rootFields.get('schemaVersion') !== MCP_CACHE_SCHEMA_VERSION
    || !boundedText(rootFields.get('updatedAt'))) {
    return discoveryFailure('MCP_DISCOVERY_INVALID_SOURCE');
  }
  const discoveryKeys = denseArrayKeys(rootFields.get('discoveries'), MAX_SOURCE_SERVERS);
  if (!discoveryKeys) return discoveryFailure('MCP_DISCOVERY_SOURCE_LIMIT_EXCEEDED');

  const normalizedServers = [];
  const seenServerIds = new Set();
  for (const discoveryKey of discoveryKeys) {
    const entryFields = exactOwnDataFields(
      rootFields.get('discoveries')[discoveryKey],
      CACHE_ENTRY_KEYS,
      CACHE_ENTRY_KEYS
    );
    const serverId = entryFields && entryFields.get('serverId');
    const toolCount = entryFields && entryFields.get('toolCount');
    const tools = entryFields && entryFields.get('tools');
    const toolKeys = denseArrayKeys(tools, MAX_SOURCE_TOOLS_PER_SERVER);
    if (!entryFields || !boundedText(serverId, { allowEmpty: false, pattern: SERVER_ID_PATTERN })
      || seenServerIds.has(serverId)
      || !Number.isSafeInteger(toolCount) || Object.is(toolCount, -0)
      || toolCount < 0 || !toolKeys || toolCount !== toolKeys.length
      || !boundedText(entryFields.get('cachedAt'))
      || !boundedText(entryFields.get('discoveredAt'))) {
      return discoveryFailure('MCP_DISCOVERY_INVALID_SOURCE');
    }
    seenServerIds.add(serverId);
    const normalizedTools = [];
    const serverNames = new Set();
    for (const toolKey of toolKeys) {
      const toolFields = exactOwnDataFields(tools[toolKey], CACHE_TOOL_KEYS, CACHE_TOOL_KEYS);
      const toolServerId = toolFields && toolFields.get('serverId');
      const serverName = toolFields && toolFields.get('serverName');
      const name = toolFields && toolFields.get('name');
      const description = toolFields && toolFields.get('description');
      const permission = toolFields && toolFields.get('permission');
      const riskLevel = toolFields && toolFields.get('riskLevel');
      if (!toolFields
        || !boundedText(toolServerId)
        || (toolServerId && toolServerId !== serverId)
        || !boundedText(serverName)
        || !boundedText(name, { allowEmpty: false, pattern: TOOL_NAME_PATTERN })
        || !boundedText(toolFields.get('normalizedName'))
        || !boundedText(toolFields.get('mcpToolName'))
        || !boundedText(description)
        || !PERMISSIONS.has(permission)
        || !RISK_LEVELS.has(riskLevel)
        || typeof toolFields.get('allowed') !== 'boolean'
        || !boundedText(toolFields.get('blockedReason'))) {
        return discoveryFailure('MCP_DISCOVERY_INVALID_SOURCE');
      }
      if (serverName) serverNames.add(serverName);
      const clippedDescription = clipUtf8(description, MAX_PUBLIC_DESCRIPTION_BYTES);
      normalizedTools.push(Object.freeze({
        name,
        description: clippedDescription.text,
        permission,
        riskLevel,
        cachedPolicyState: toolFields.get('allowed') ? 'allowed' : 'blocked',
        descriptionTruncated: clippedDescription.truncated,
      }));
    }
    const sortedNames = [...serverNames].sort(compareText);
    const clippedServerName = clipUtf8(
      sortedNames[0] || serverId,
      MAX_PUBLIC_SERVER_NAME_BYTES
    );
    normalizedServers.push(Object.freeze({
      id: serverId,
      name: clippedServerName.text,
      nameTruncated: clippedServerName.truncated,
      tools: normalizedTools.sort((left, right) => (
        compareText(left.name, right.name)
        || compareText(left.description, right.description)
        || compareText(left.permission, right.permission)
        || compareText(left.riskLevel, right.riskLevel)
        || compareText(left.cachedPolicyState, right.cachedPolicyState)
      )),
    }));
  }
  normalizedServers.sort((left, right) => compareText(left.id, right.id));

  const servers = [];
  let publicToolCount = 0;
  let truncated = normalizedServers.length > MAX_PUBLIC_SERVERS;
  let outputLimitReached = false;
  for (const normalizedServer of normalizedServers.slice(0, MAX_PUBLIC_SERVERS)) {
    if (normalizedServer.nameTruncated) truncated = true;
    if (publicToolCount >= MAX_PUBLIC_TOOLS) {
      truncated = true;
      break;
    }
    const publicTools = [];
    const sourceTools = normalizedServer.tools;
    if (sourceTools.length > MAX_PUBLIC_TOOLS_PER_SERVER) truncated = true;
    for (const sourceTool of sourceTools.slice(0, MAX_PUBLIC_TOOLS_PER_SERVER)) {
      if (publicToolCount >= MAX_PUBLIC_TOOLS) {
        truncated = true;
        break;
      }
      const projectedTool = Object.freeze({
        cachedPolicyState: sourceTool.cachedPolicyState,
        description: sourceTool.description,
        name: sourceTool.name,
        permission: sourceTool.permission,
        riskLevel: sourceTool.riskLevel,
      });
      const candidateServer = {
        id: normalizedServer.id,
        name: normalizedServer.name,
        tools: [...publicTools, projectedTool],
      };
      const candidateServers = [...servers, candidateServer];
      if (Buffer.byteLength(JSON.stringify(candidateServers), 'utf8') > MAX_PUBLIC_OUTPUT_BYTES) {
        truncated = true;
        outputLimitReached = true;
        break;
      }
      publicTools.push(projectedTool);
      publicToolCount += 1;
      if (sourceTool.descriptionTruncated) truncated = true;
    }
    const projectedServer = Object.freeze({
      id: normalizedServer.id,
      name: normalizedServer.name,
      tools: Object.freeze(publicTools),
    });
    const candidateServers = [...servers, projectedServer];
    if (Buffer.byteLength(JSON.stringify(candidateServers), 'utf8') > MAX_PUBLIC_OUTPUT_BYTES) {
      truncated = true;
      break;
    }
    servers.push(projectedServer);
    if (outputLimitReached) break;
  }
  const frozenServers = Object.freeze(servers);
  const revision = `sha256:${crypto.createHash('sha256')
    .update(JSON.stringify(frozenServers), 'utf8').digest('hex')}`;
  return Object.freeze({
    ok: true,
    format: MCP_DISCOVERY_FORMAT,
    source: 'local_cache',
    externalCallsEnabled: false,
    revision,
    serverCount: frozenServers.length,
    toolCount: publicToolCount,
    truncated,
    servers: frozenServers,
  });
}

function createAgenticMcpDiscoveryBrokerFactory(options = {}) {
  const optionFields = exactOwnDataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS);
  if (!optionFields) throw new TypeError('Invalid agentic MCP discovery broker options');
  const authorizeLifecycle = optionFields.get('authorizeLifecycle');
  const authorizeRoot = optionFields.get('authorizeRoot');
  const authorizeEffectFrontier = optionFields.get('authorizeEffectFrontier');
  const readDiscoveryCache = optionFields.get('readDiscoveryCache');
  const audit = optionFields.has('audit') ? optionFields.get('audit') : () => {};
  const now = optionFields.has('now') ? optionFields.get('now') : () => Date.now();
  const requestIdFactory = optionFields.has('requestIdFactory')
    ? optionFields.get('requestIdFactory')
    : () => `agentic-mcp-discovery:${crypto.randomUUID()}`;
  for (const [name, callback] of [
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeEffectFrontier', authorizeEffectFrontier],
    ['readDiscoveryCache', readDiscoveryCache],
    ['audit', audit],
    ['now', now],
    ['requestIdFactory', requestIdFactory],
  ]) {
    if (typeof callback !== 'function' || util.types.isProxy(callback)) {
      throw new TypeError(`${name} must be a trusted function`);
    }
  }

  let routesCreated = 0;
  let totalRequests = 0;

  function createRoute(input = {}) {
    const fields = exactOwnDataFields(input, ['binding'], ['binding']);
    if (!fields) throw new TypeError('Invalid agentic MCP discovery route options');
    let binding;
    try {
      binding = createCapabilityDelegationBinding(fields.get('binding'));
    } catch (error) {
      preflightDataGraph(error);
      throw new TypeError('Agentic MCP discovery route binding is invalid');
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

    function readCachedDiscovery() {
      if (!allAuthorityActive()) {
        return discoveryFailure('MCP_DISCOVERY_AUTHORITY_DENIED');
      }
      let raw;
      try {
        raw = Reflect.apply(readDiscoveryCache, undefined, []);
      } catch (error) {
        preflightDataGraph(error);
        return discoveryFailure('MCP_DISCOVERY_SOURCE_FAILED');
      }
      if (util.types.isPromise(raw)) {
        preflightDataGraph(raw);
        return discoveryFailure('MCP_DISCOVERY_ASYNC_SOURCE_REJECTED');
      }
      if (!allAuthorityActive()) {
        preflightDataGraph(raw);
        return discoveryFailure('MCP_DISCOVERY_AUTHORITY_DENIED');
      }
      const projected = projectCachedDiscovery(raw);
      if (!allAuthorityActive()) {
        return discoveryFailure('MCP_DISCOVERY_AUTHORITY_DENIED');
      }
      return projected;
    }

    const descriptor = createProjectCapabilityDescriptor({
      capability: MCP_DISCOVERY_CAPABILITY,
      action: MCP_DISCOVERY_ACTION,
      version: AGENTIC_MCP_DISCOVERY_DESCRIPTOR_VERSION,
      kind: PROJECT_CAPABILITY_KINDS.MCP,
      effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ],
      risk: 'low',
      canonicalizePayload(payload) {
        const payloadFields = exactOwnDataFields(payload, [], []);
        if (!payloadFields) throw new TypeError('MCP cached discovery payload is invalid');
        return Object.freeze({});
      },
      adapter: Object.freeze({ execute: readCachedDiscovery }),
    });
    const broker = createProjectCapabilityBroker({
      authorizeProjectSession: authorizeSession,
      authorizeProjectEffect: authorizeEffect,
      descriptorResolver: Object.freeze({
        resolve(capability, action) {
          return capability === MCP_DISCOVERY_CAPABILITY && action === MCP_DISCOVERY_ACTION
            ? descriptor
            : null;
        },
      }),
      classifier: new CapabilityEffectClassifier(),
      policy: new CapabilityPolicyService(),
      grantStore: Object.freeze({
        inspect() { return Object.freeze({ authorized: false, reason: 'grant_not_required' }); },
        consume() { return Object.freeze({ authorized: false, reason: 'grant_not_required' }); },
      }),
      pendingApprovalStore: Object.freeze({
        create() { throw new Error('Cached MCP discovery must not request approval'); },
        resolve() { throw new Error('Cached MCP discovery has no pending approval'); },
      }),
      approvalReviewer: Object.freeze({
        verifyDecision() { return Object.freeze({ verified: false }); },
      }),
      sandboxRegistry: Object.freeze({
        select() { throw new Error('Cached MCP discovery must not select a process sandbox'); },
      }),
      buildSandboxEnvironment() {
        throw new Error('Cached MCP discovery must not build a process environment');
      },
      audit: Object.freeze({ record(event) { return audit(event); } }),
      now,
    });
    let requests = 0;
    let completed = 0;
    let denied = 0;
    let failed = 0;

    async function readCached() {
      if (arguments.length !== 0) {
        throw new TypeError('Cached MCP discovery does not accept model-controlled input');
      }
      let requestId;
      try {
        requestId = requestIdFactory();
      } catch (error) {
        preflightDataGraph(error);
        throw new TypeError('Agentic MCP discovery request id generation failed');
      }
      if (util.types.isPromise(requestId) || typeof requestId !== 'string'
        || !REQUEST_ID_PATTERN.test(requestId)) {
        preflightDataGraph(requestId);
        throw new TypeError('Agentic MCP discovery request id is invalid');
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
        capability: MCP_DISCOVERY_CAPABILITY,
        action: MCP_DISCOVERY_ACTION,
        payload: Object.freeze({}),
        context: Object.freeze({
          origin: 'agentic_tool_loop',
          correlationId: binding.jobId,
        }),
      });
      const result = await broker.execute(request);
      const output = dataValue(result, 'output');
      if (dataValue(result, 'status') === 'completed' && dataValue(output, 'ok') === true) {
        completed += 1;
      } else if (dataValue(result, 'status') === 'denied') {
        denied += 1;
      } else {
        failed += 1;
      }
      return result;
    }

    function diagnostics() {
      return Object.freeze({
        version: AGENTIC_MCP_DISCOVERY_ROUTE_VERSION,
        capability: MCP_DISCOVERY_CAPABILITY,
        action: MCP_DISCOVERY_ACTION,
        requests,
        completed,
        denied,
        failed,
        source: 'local_cache',
        externalCallsEnabled: false,
        authorityBoundary: 'job_binding',
      });
    }

    routesCreated += 1;
    return Object.freeze({
      version: AGENTIC_MCP_DISCOVERY_ROUTE_VERSION,
      readCached,
      diagnostics,
    });
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_MCP_DISCOVERY_BROKER_FACTORY_VERSION,
      descriptorVersion: AGENTIC_MCP_DISCOVERY_DESCRIPTOR_VERSION,
      routesCreated,
      totalRequests,
      capability: MCP_DISCOVERY_CAPABILITY,
      action: MCP_DISCOVERY_ACTION,
      source: 'local_cache',
      externalCallsDefault: false,
      authorityBoundary: 'main_process_only',
    });
  }

  return Object.freeze({ createRoute, diagnostics });
}

module.exports = {
  AGENTIC_MCP_DISCOVERY_BROKER_FACTORY_VERSION,
  AGENTIC_MCP_DISCOVERY_DESCRIPTOR_VERSION,
  AGENTIC_MCP_DISCOVERY_ROUTE_VERSION,
  MCP_DISCOVERY_FORMAT,
  createAgenticMcpDiscoveryBrokerFactory,
};
