'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  AGENTIC_MCP_DISCOVERY_BROKER_FACTORY_VERSION,
  AGENTIC_MCP_DISCOVERY_ROUTE_VERSION,
  MCP_DISCOVERY_FORMAT,
  createAgenticMcpDiscoveryBrokerFactory,
} = require('../main/services/agentic_mcp_discovery_broker_factory');

const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

const binding = createCapabilityDelegationBinding({
  projectId: 'project-a',
  canonicalRootPath: '/projects/a',
  realRootPath: '/private/projects/a',
  sessionId: 'session-a',
  jobId: 'job-a',
  kernelId: 'kernel-a',
  submissionDigest: sha256('submission-a'),
});

function tool(overrides = {}) {
  return {
    serverId: 'visual-auditor',
    serverName: 'Visual Auditor',
    name: 'read_page',
    normalizedName: 'read_page',
    mcpToolName: 'visual-auditor.read_page',
    description: 'Inspeciona a página sem alterar estado.',
    inputSchema: { type: 'object', secretDefault: 'never-expose' },
    permission: 'read',
    riskLevel: 'low',
    riskPolicy: { transport: 'stdio', command: '/private/bin/secret-helper' },
    allowed: true,
    blockedReason: '',
    ...overrides,
  };
}

function cacheSnapshot() {
  return {
    ok: true,
    schemaVersion: 'faber-external-mcp-discovery-cache-v1',
    updatedAt: '2026-08-24T16:00:00.000Z',
    discoveries: [
      {
        serverId: 'visual-auditor',
        toolCount: 3,
        cachedAt: '2026-08-24T15:59:00.000Z',
        discoveredAt: '2026-08-24T15:58:00.000Z',
        tools: [
          tool({
            name: 'publish_page',
            normalizedName: 'publish_page',
            mcpToolName: 'visual-auditor.publish_page',
            description: 'Publica a página.',
            permission: 'write',
            riskLevel: 'high',
          }),
          tool(),
          tool({
            name: 'blocked_read',
            normalizedName: 'blocked_read',
            mcpToolName: 'visual-auditor.blocked_read',
            description: 'Leitura bloqueada pelo administrador.',
            permission: 'read',
            riskLevel: 'medium',
            allowed: false,
            blockedReason: 'token at /private/projects/a/.env',
          }),
        ],
      },
      {
        serverId: 'alpha-docs',
        toolCount: 1,
        cachedAt: '2026-08-24T15:57:00.000Z',
        discoveredAt: '2026-08-24T15:56:00.000Z',
        tools: [tool({
          serverId: 'alpha-docs',
          serverName: 'Alpha Docs',
          name: 'search_docs',
          normalizedName: 'search_docs',
          mcpToolName: 'alpha-docs.search_docs',
          description: 'Pesquisa documentação em cache.',
        })],
      },
    ],
  };
}

function createHarness({ readDiscoveryCache = null } = {}) {
  const state = {
    active: true,
    audits: [],
    cacheReads: 0,
    effectChecks: 0,
    lifecycleChecks: 0,
    requestIds: 0,
    revokeAfterCacheRead: false,
    rootChecks: 0,
  };
  const source = readDiscoveryCache || function readCache() {
    assert.strictEqual(arguments.length, 0);
    state.cacheReads += 1;
    const snapshot = cacheSnapshot();
    if (state.revokeAfterCacheRead) state.active = false;
    return snapshot;
  };
  const factory = createAgenticMcpDiscoveryBrokerFactory({
    authorizeLifecycle(candidate) {
      state.lifecycleChecks += 1;
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    authorizeRoot(input) {
      state.rootChecks += 1;
      return state.active
        ? Object.freeze({
          ok: true,
          authorized: true,
          projectId: input.projectId,
          rootPath: input.rootPath,
          canonicalRootPath: input.rootPath,
          realRootPath: binding.realRootPath,
        })
        : Object.freeze({ authorized: false });
    },
    authorizeEffectFrontier(candidate) {
      state.effectChecks += 1;
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    readDiscoveryCache: source,
    audit(event) {
      state.audits.push(event);
    },
    requestIdFactory() {
      state.requestIds += 1;
      return `mcp-discovery-${state.requestIds}`;
    },
  });
  const route = factory.createRoute(Object.freeze({ binding }));
  return { factory, route, state };
}

async function run() {
  const harness = createHarness();
  assert.strictEqual(Object.isFrozen(harness.factory), true);
  assert.strictEqual(
    harness.factory.diagnostics().version,
    AGENTIC_MCP_DISCOVERY_BROKER_FACTORY_VERSION
  );
  assert.strictEqual(Object.isFrozen(harness.route), true);
  assert.deepStrictEqual(Reflect.ownKeys(harness.route), [
    'version',
    'readCached',
    'diagnostics',
  ]);
  assert.strictEqual(harness.route.version, AGENTIC_MCP_DISCOVERY_ROUTE_VERSION);
  assert.strictEqual(JSON.stringify(harness.route).includes('/projects/a'), false);
  assert.strictEqual(JSON.stringify(harness.route).includes('submissionDigest'), false);

  const result = await harness.route.readCached();
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.decision, 'allow');
  assert.strictEqual(result.output.ok, true);
  assert.strictEqual(result.output.format, MCP_DISCOVERY_FORMAT);
  assert.strictEqual(result.output.source, 'local_cache');
  assert.strictEqual(result.output.externalCallsEnabled, false);
  assert.strictEqual(result.output.serverCount, 2);
  assert.strictEqual(result.output.toolCount, 4);
  assert.strictEqual(result.output.truncated, false);
  assert.match(result.output.revision, /^sha256:[a-f0-9]{64}$/);
  assert.deepStrictEqual(result.output.servers.map((server) => server.id), [
    'alpha-docs',
    'visual-auditor',
  ]);
  assert.deepStrictEqual(result.output.servers[1], {
    id: 'visual-auditor',
    name: 'Visual Auditor',
    tools: [
      {
        name: 'blocked_read',
        description: 'Leitura bloqueada pelo administrador.',
        permission: 'read',
        riskLevel: 'medium',
        cachedPolicyState: 'blocked',
      },
      {
        name: 'publish_page',
        description: 'Publica a página.',
        permission: 'write',
        riskLevel: 'high',
        cachedPolicyState: 'allowed',
      },
      {
        name: 'read_page',
        description: 'Inspeciona a página sem alterar estado.',
        permission: 'read',
        riskLevel: 'low',
        cachedPolicyState: 'allowed',
      },
    ],
  });
  assert.strictEqual(
    result.output.revision,
    sha256(JSON.stringify(result.output.servers))
  );
  assert.strictEqual(Object.isFrozen(result.output), true);
  assert.strictEqual(Object.isFrozen(result.output.servers), true);
  assert.strictEqual(Object.isFrozen(result.output.servers[0]), true);
  assert.strictEqual(Object.isFrozen(result.output.servers[0].tools), true);
  assert.strictEqual(Object.isFrozen(result.output.servers[0].tools[0]), true);
  const serialized = JSON.stringify(result.output);
  for (const forbidden of [
    'never-expose',
    '/private',
    'inputSchema',
    'riskPolicy',
    'blockedReason',
    'mcpToolName',
    'cachedAt',
    'discoveredAt',
    'updatedAt',
    'stdio',
  ]) {
    assert.strictEqual(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
  assert.strictEqual(harness.state.cacheReads, 1);
  assert(harness.state.lifecycleChecks >= 3);
  assert(harness.state.rootChecks >= 3);
  assert(harness.state.effectChecks >= 2);
  assert.strictEqual(JSON.stringify(harness.state.audits).includes('/projects/a'), false);

  await assert.rejects(
    harness.route.readCached({ serverId: 'visual-auditor' }),
    /does not accept model-controlled input/
  );
  assert.strictEqual(harness.state.cacheReads, 1);

  const routeDiagnostics = harness.route.diagnostics();
  assert.deepStrictEqual(routeDiagnostics, {
    version: AGENTIC_MCP_DISCOVERY_ROUTE_VERSION,
    capability: 'external_mcp',
    action: 'read_cached_discovery',
    requests: 1,
    completed: 1,
    denied: 0,
    failed: 0,
    source: 'local_cache',
    externalCallsEnabled: false,
    authorityBoundary: 'job_binding',
  });
  assert.deepStrictEqual(harness.factory.diagnostics(), {
    version: AGENTIC_MCP_DISCOVERY_BROKER_FACTORY_VERSION,
    descriptorVersion: 'agentic-mcp-discovery-descriptor.v1',
    routesCreated: 1,
    totalRequests: 1,
    capability: 'external_mcp',
    action: 'read_cached_discovery',
    source: 'local_cache',
    externalCallsDefault: false,
    authorityBoundary: 'main_process_only',
  });

  harness.state.active = false;
  const readsBeforeRevocation = harness.state.cacheReads;
  const revoked = await harness.route.readCached();
  assert.strictEqual(revoked.status, 'denied');
  assert.strictEqual(revoked.error.code, 'PROJECT_SCOPE_INVALID');
  assert.strictEqual(harness.state.cacheReads, readsBeforeRevocation);

  const raceHarness = createHarness();
  raceHarness.state.revokeAfterCacheRead = true;
  const race = await raceHarness.route.readCached();
  assert.strictEqual(race.status, 'completed');
  assert.strictEqual(race.output.ok, false);
  assert.strictEqual(race.output.format, MCP_DISCOVERY_FORMAT);
  assert.strictEqual(race.output.code, 'MCP_DISCOVERY_AUTHORITY_DENIED');
  assert.strictEqual(raceHarness.state.cacheReads, 1);

  let asyncReads = 0;
  const asyncHarness = createHarness({
    readDiscoveryCache() {
      asyncReads += 1;
      return Promise.resolve(cacheSnapshot());
    },
  });
  const asyncResult = await asyncHarness.route.readCached();
  assert.strictEqual(asyncResult.status, 'completed');
  assert.strictEqual(asyncResult.output.ok, false);
  assert.strictEqual(asyncResult.output.code, 'MCP_DISCOVERY_ASYNC_SOURCE_REJECTED');
  assert.strictEqual(asyncReads, 1);

  let invalidReads = 0;
  const invalidHarness = createHarness({
    readDiscoveryCache() {
      invalidReads += 1;
      return { ...cacheSnapshot(), endpoint: 'https://secret.invalid/mcp' };
    },
  });
  const invalid = await invalidHarness.route.readCached();
  assert.strictEqual(invalid.status, 'completed');
  assert.strictEqual(invalid.output.ok, false);
  assert.strictEqual(invalid.output.code, 'MCP_DISCOVERY_INVALID_SOURCE');
  assert.strictEqual(JSON.stringify(invalid.output).includes('secret.invalid'), false);
  assert.strictEqual(invalidReads, 1);

  const boundedHarness = createHarness({
    readDiscoveryCache() {
      const snapshot = cacheSnapshot();
      const oversizedTool = tool({
        serverId: 'bounded-server',
        serverName: 'S'.repeat(6_000),
        name: 'bounded_tool',
        normalizedName: 'bounded_tool',
        mcpToolName: 'bounded-server.bounded_tool',
        description: 'D'.repeat(3_000),
      });
      return {
        ...snapshot,
        discoveries: [{
          serverId: 'bounded-server',
          toolCount: 1,
          cachedAt: '2026-08-24T15:59:00.000Z',
          discoveredAt: '2026-08-24T15:58:00.000Z',
          tools: [oversizedTool],
        }],
      };
    },
  });
  const bounded = await boundedHarness.route.readCached();
  assert.strictEqual(bounded.status, 'completed');
  assert.strictEqual(bounded.output.ok, true);
  assert.strictEqual(bounded.output.truncated, true);
  assert.strictEqual(
    Buffer.byteLength(bounded.output.servers[0].name, 'utf8'),
    4 * 1024
  );
  assert.strictEqual(bounded.output.servers[0].name.endsWith('...'), true);
  assert.strictEqual(
    Buffer.byteLength(bounded.output.servers[0].tools[0].description, 'utf8'),
    2 * 1024
  );
  assert.strictEqual(bounded.output.servers[0].tools[0].description.endsWith('...'), true);

  console.log('agentic MCP discovery broker factory tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
