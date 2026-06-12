const assert = require('assert');
const http = require('http');

const { createExternalMcpBridgeService } = require('../main/services/external_mcp_bridge_service');
const { createExternalMcpTransportFactory } = require('../main/services/external_mcp_transport_factory_service');

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function createRpcResult(request, pathName) {
  if (request.method === 'initialize') {
    return {
      protocolVersion: '2025-06-18',
      serverInfo: { name: `Faber HTTP MCP ${pathName}`, version: '1.0.0' },
      capabilities: { tools: {} },
    };
  }
  if (request.method === 'tools/list') {
    return {
      tools: [
        {
          name: 'demo.echo',
          description: 'Echo seguro de teste HTTP/SSE.',
          inputSchema: { type: 'object' },
          annotations: { permission: 'read', riskLevel: 'low' },
        },
        {
          name: 'dangerous.delete',
          description: 'Remove arquivos e deve ser bloqueada por risco.',
          inputSchema: { type: 'object' },
          annotations: { permission: 'write', riskLevel: 'critical' },
        },
      ],
    };
  }
  if (request.method === 'tools/call') {
    return {
      content: [{ type: 'text', text: `echo:${request.params.arguments.message || 'ok'}` }],
      structuredContent: {
        endpoint: pathName,
        receivedProjectSessionArgument: Boolean(
          request.params &&
          request.params.arguments &&
          request.params.arguments.projectSession
        ),
      },
    };
  }
  return { isError: true, content: [{ type: 'text', text: `Metodo desconhecido: ${request.method}` }] };
}

function createEndpointServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || !['/rpc', '/sse'].includes(req.url)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const request = JSON.parse(await readRequestBody(req));
      requests.push({ pathName: req.url, request });
      if (request.id === undefined) {
        res.writeHead(204);
        res.end();
        return;
      }
      const payload = {
        jsonrpc: '2.0',
        id: request.id,
        result: createRpcResult(request, req.url),
      };
      if (req.url === '/sse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  return { requests, server };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

async function run() {
  const { requests, server } = createEndpointServer();
  const port = await listen(server);
  const endpointBase = `http://127.0.0.1:${port}`;
  const bridge = createExternalMcpBridgeService({
    servers: [
      {
        id: 'live-http',
        name: 'Live HTTP MCP',
        transport: 'http',
        endpoint: `${endpointBase}/rpc`,
        trust: 'approved',
        allowedTools: ['demo.echo', 'dangerous.delete'],
        riskPolicy: { maxRiskLevel: 'high', blockedRiskLevels: ['critical'] },
        requestTimeoutMs: 4000,
      },
      {
        id: 'live-sse',
        name: 'Live SSE MCP',
        transport: 'sse',
        endpoint: `${endpointBase}/sse`,
        trust: 'approved',
        allowedTools: ['demo.echo'],
        riskPolicy: { maxRiskLevel: 'high', blockedRiskLevels: ['critical'] },
        requestTimeoutMs: 4000,
      },
    ],
    transportFactory: createExternalMcpTransportFactory(),
    now: () => '2026-05-27T19:10:00.000Z',
  });

  try {
    const projectSession = { rootPath: process.cwd(), projectId: 'http-sse-smoke' };
    const httpDiscovery = await bridge.discoverTools({ serverId: 'live-http', projectSession, refresh: true });
    assert.strictEqual(httpDiscovery.ok, true);
    assert.strictEqual(httpDiscovery.data.tools.find((tool) => tool.name === 'demo.echo').allowed, true);
    assert.strictEqual(
      httpDiscovery.data.tools.find((tool) => tool.name === 'dangerous.delete').blockedReason,
      'tool_risk_blocked_by_policy'
    );

    const httpCall = await bridge.callTool({
      serverId: 'live-http',
      toolName: 'demo.echo',
      arguments: { message: 'http-ok' },
      projectSession,
    });
    assert.strictEqual(httpCall.ok, true);
    assert.strictEqual(httpCall.data.result.structuredContent.receivedProjectSessionArgument, false);

    const httpBlocked = await bridge.callTool({
      serverId: 'live-http',
      toolName: 'dangerous.delete',
      arguments: { path: 'blocked' },
      projectSession,
    });
    assert.strictEqual(httpBlocked.ok, false);
    assert.ok(httpBlocked.errors.includes('tool_risk_blocked_by_policy'));

    const sseDiscovery = await bridge.discoverTools({ serverId: 'live-sse', projectSession, refresh: true });
    assert.strictEqual(sseDiscovery.ok, true);
    const sseCall = await bridge.callTool({
      serverId: 'live-sse',
      toolName: 'demo.echo',
      arguments: { message: 'sse-ok' },
      projectSession,
    });
    assert.strictEqual(sseCall.ok, true);
    assert.strictEqual(sseCall.result.content[0].text, 'echo:sse-ok');
    assert.ok(requests.some((entry) => entry.request.method === 'notifications/initialized'));

    console.log('external-mcp-http-sse-endpoint-smoke.test.js: ok');
  } finally {
    bridge.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
