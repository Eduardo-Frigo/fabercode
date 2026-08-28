'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  AGENTIC_MCP_TOOL_BROKER_FACTORY_VERSION,
  AGENTIC_MCP_TOOL_ROUTE_REASONS,
  AGENTIC_MCP_TOOL_ROUTE_VERSION,
  MCP_TOOL_RESULT_FORMAT,
  createAgenticMcpToolBrokerFactory,
} = require('../main/services/agentic_mcp_tool_broker_factory');

const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

const binding = createCapabilityDelegationBinding({
  projectId: 'project-mcp-tool',
  canonicalRootPath: '/projects/mcp-tool',
  realRootPath: '/private/projects/mcp-tool',
  sessionId: 'session-mcp-tool',
  jobId: 'job-mcp-tool',
  kernelId: 'kernel-mcp-tool',
  submissionDigest: sha256('mcp-tool-submission'),
});

function cacheSnapshot() {
  return {
    ok: true,
    schemaVersion: 'faber-external-mcp-discovery-cache-v1',
    updatedAt: '2026-08-27T20:00:00.000Z',
    discoveries: [{
      serverId: 'docs-approved',
      toolCount: 3,
      cachedAt: '2026-08-27T19:59:00.000Z',
      discoveredAt: '2026-08-27T19:58:00.000Z',
      tools: [
        {
          serverId: 'docs-approved',
          serverName: 'Docs Approved',
          name: 'search_docs',
          normalizedName: 'search_docs',
          mcpToolName: 'external_mcp.docs-approved.search_docs',
          description: 'Search approved documentation.',
          inputSchema: { type: 'object' },
          permission: 'read',
          riskLevel: 'low',
          riskPolicy: {},
          allowed: true,
          blockedReason: '',
        },
        {
          serverId: 'docs-approved',
          serverName: 'Docs Approved',
          name: 'blocked_read',
          normalizedName: 'blocked_read',
          mcpToolName: 'external_mcp.docs-approved.blocked_read',
          description: 'Blocked read.',
          inputSchema: { type: 'object' },
          permission: 'read',
          riskLevel: 'medium',
          riskPolicy: {},
          allowed: false,
          blockedReason: 'tool_blocked_by_policy',
        },
        {
          serverId: 'docs-approved',
          serverName: 'Docs Approved',
          name: 'publish_docs',
          normalizedName: 'publish_docs',
          mcpToolName: 'external_mcp.docs-approved.publish_docs',
          description: 'Publish documentation.',
          inputSchema: { type: 'object' },
          permission: 'write',
          riskLevel: 'high',
          riskPolicy: {},
          allowed: true,
          blockedReason: '',
        },
      ],
    }],
  };
}

function createHarness({ approveWrite = true } = {}) {
  const approvalReceipt = Object.freeze(Object.create(null));
  const state = {
    active: true,
    approvalConsumes: 0,
    approvalRequests: 0,
    cacheReads: 0,
    calls: [],
    signal: null,
  };
  const factory = createAgenticMcpToolBrokerFactory({
    authorizeLifecycle(candidate) {
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    authorizeRoot(input) {
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
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    readDiscoveryCache() {
      state.cacheReads += 1;
      return cacheSnapshot();
    },
    callExternalTool(input) {
      state.calls.push(input);
      return Promise.resolve({
        ok: true,
        status: 'succeeded',
        artifacts: ['/private/projects/mcp-tool/never-expose.txt'],
        result: {
          content: [
            { type: 'text', text: 'External documentation result.' },
            { type: 'image', mimeType: 'image/png', data: 'never-expose-base64' },
          ],
          structuredContent: { matches: 3 },
        },
        endpoint: 'https://secret-endpoint.invalid/mcp',
      });
    },
    requestWriteApproval(input) {
      state.approvalRequests += 1;
      assert.match(input.invocationDigest, /^sha256:[a-f0-9]{64}$/);
      return Promise.resolve(approveWrite
        ? { ok: true, approved: true, receipt: approvalReceipt }
        : { ok: true, approved: false, reason: 'mcp_write_denied' });
    },
    consumeWriteApproval(input) {
      state.approvalConsumes += 1;
      return input.receipt === approvalReceipt
        ? { ok: true, authorized: true, reason: 'mcp_write_consumed' }
        : { ok: false, authorized: false, reason: 'mcp_write_mismatch' };
    },
    getSignal() {
      return state.signal;
    },
  });
  return {
    factory,
    route: factory.createRoute(Object.freeze({ binding })),
    state,
  };
}

async function testAllowedReadIsBoundedAndIdempotent() {
  const harness = createHarness();
  assert.strictEqual(harness.factory.diagnostics().version, AGENTIC_MCP_TOOL_BROKER_FACTORY_VERSION);
  assert.strictEqual(harness.route.version, AGENTIC_MCP_TOOL_ROUTE_VERSION);
  assert.strictEqual(Object.isFrozen(harness.route), true);

  const input = Object.freeze({
    serverId: 'docs-approved',
    toolName: 'search_docs',
    arguments: Object.freeze({ query: 'capability broker', limit: 3 }),
    idempotencyKey: 'mcp-search-docs-1',
  });
  const first = await harness.route.call(input);
  assert.deepStrictEqual(first, {
    ok: true,
    status: 'succeeded',
    format: MCP_TOOL_RESULT_FORMAT,
    serverId: 'docs-approved',
    toolName: 'search_docs',
    content: [
      { type: 'text', text: 'External documentation result.' },
      { type: 'image', mimeType: 'image/png' },
    ],
    structuredContent: { matches: 3 },
    artifactCount: 1,
    truncated: false,
    untrusted: true,
  });
  assert.strictEqual(Object.isFrozen(first), true);
  assert.strictEqual(Object.isFrozen(first.content), true);
  assert.strictEqual(Object.isFrozen(first.structuredContent), true);
  assert.strictEqual(harness.state.calls.length, 1);
  assert.strictEqual(Object.isFrozen(harness.state.calls[0]), true);
  assert.strictEqual(Object.isFrozen(harness.state.calls[0].arguments), true);
  assert.strictEqual(harness.state.calls[0].projectSession.rootPath, binding.canonicalRootPath);
  assert.strictEqual(harness.state.calls[0].signal, null);
  const serialized = JSON.stringify(first);
  for (const forbidden of [
    'never-expose.txt',
    'never-expose-base64',
    'secret-endpoint.invalid',
    '/private/projects',
  ]) {
    assert.strictEqual(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }

  const replay = await harness.route.call(input);
  assert.strictEqual(replay, first);
  assert.strictEqual(harness.state.calls.length, 1);
  const conflict = await harness.route.call(Object.freeze({
    ...input,
    arguments: Object.freeze({ query: 'different payload' }),
  }));
  assert.deepStrictEqual(conflict, {
    ok: false,
    code: AGENTIC_MCP_TOOL_ROUTE_REASONS.IDEMPOTENCY_CONFLICT,
  });
  assert.strictEqual(harness.state.calls.length, 1);
}

async function testAllowlistAndNativeWriteApprovalFailClosed() {
  const harness = createHarness();
  const blockedRead = await harness.route.call(Object.freeze({
    serverId: 'docs-approved',
    toolName: 'blocked_read',
    arguments: Object.freeze({}),
    idempotencyKey: 'blocked-read-1',
  }));
  assert.deepStrictEqual(blockedRead, {
    ok: false,
    code: AGENTIC_MCP_TOOL_ROUTE_REASONS.NOT_ALLOWLISTED,
  });

  const write = await harness.route.call(Object.freeze({
    serverId: 'docs-approved',
    toolName: 'publish_docs',
    arguments: Object.freeze({ title: 'Must never publish' }),
    idempotencyKey: 'blocked-write-1',
  }));
  assert.strictEqual(write.ok, true);
  assert.strictEqual(harness.state.approvalRequests, 1);
  assert.strictEqual(harness.state.approvalConsumes, 1);
  assert.strictEqual(harness.state.calls.length, 1);

  const replay = await harness.route.call(Object.freeze({
    serverId: 'docs-approved',
    toolName: 'publish_docs',
    arguments: Object.freeze({ title: 'Must never publish' }),
    idempotencyKey: 'blocked-write-1',
  }));
  assert.strictEqual(replay, write);
  assert.strictEqual(harness.state.approvalRequests, 1);
  assert.strictEqual(harness.state.approvalConsumes, 1);
  assert.strictEqual(harness.state.calls.length, 1);

  const conflict = await harness.route.call(Object.freeze({
    serverId: 'docs-approved',
    toolName: 'publish_docs',
    arguments: Object.freeze({ title: 'Different write' }),
    idempotencyKey: 'blocked-write-1',
  }));
  assert.deepStrictEqual(conflict, {
    ok: false,
    code: AGENTIC_MCP_TOOL_ROUTE_REASONS.IDEMPOTENCY_CONFLICT,
  });
  assert.strictEqual(harness.state.calls.length, 1);

  const deniedHarness = createHarness({ approveWrite: false });
  const denied = await deniedHarness.route.call(Object.freeze({
    serverId: 'docs-approved',
    toolName: 'publish_docs',
    arguments: Object.freeze({ title: 'Denied write' }),
    idempotencyKey: 'denied-write-1',
  }));
  assert.deepStrictEqual(denied, {
    ok: false,
    code: AGENTIC_MCP_TOOL_ROUTE_REASONS.APPROVAL_DENIED,
  });
  assert.strictEqual(deniedHarness.state.approvalRequests, 1);
  assert.strictEqual(deniedHarness.state.approvalConsumes, 0);
  assert.strictEqual(deniedHarness.state.calls.length, 0);
}

async function testCancellationAndAuthorityRevocationStopBeforeTheEffect() {
  const harness = createHarness();
  const controller = new AbortController();
  controller.abort();
  harness.state.signal = controller.signal;
  const cancelled = await harness.route.call(Object.freeze({
    serverId: 'docs-approved',
    toolName: 'search_docs',
    arguments: Object.freeze({ query: 'cancelled' }),
    idempotencyKey: 'cancelled-read-1',
  }));
  assert.deepStrictEqual(cancelled, {
    ok: false,
    cancelled: true,
    code: AGENTIC_MCP_TOOL_ROUTE_REASONS.CANCELLED,
  });
  assert.strictEqual(harness.state.calls.length, 0);

  harness.state.signal = null;
  harness.state.active = false;
  const revoked = await harness.route.call(Object.freeze({
    serverId: 'docs-approved',
    toolName: 'search_docs',
    arguments: Object.freeze({ query: 'revoked' }),
    idempotencyKey: 'revoked-read-1',
  }));
  assert.deepStrictEqual(revoked, {
    ok: false,
    code: AGENTIC_MCP_TOOL_ROUTE_REASONS.AUTHORITY_DENIED,
  });
  assert.strictEqual(harness.state.calls.length, 0);
}

async function testInvalidArgumentsNeverReachTheConnector() {
  const harness = createHarness();
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => harness.route.call({
    serverId: 'docs-approved',
    toolName: 'search_docs',
    arguments: cyclic,
    idempotencyKey: 'invalid-cycle-1',
  }), /MCP tool input is invalid/);
  assert.strictEqual(harness.state.calls.length, 0);
}

async function main() {
  await testAllowedReadIsBoundedAndIdempotent();
  await testAllowlistAndNativeWriteApprovalFailClosed();
  await testCancellationAndAuthorityRevocationStopBeforeTheEffect();
  await testInvalidArgumentsNeverReachTheConnector();
  console.log('agentic-mcp-tool-broker-factory.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
