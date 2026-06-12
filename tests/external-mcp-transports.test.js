const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createExternalMcpHttpTransport } = require('../main/services/external_mcp_http_transport_service');
const { createExternalMcpStdioTransport } = require('../main/services/external_mcp_stdio_transport_service');

async function testStdioTransport() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-mcp-stdio-'));
  const fixturePath = path.join(__dirname, 'fixtures', 'external_mcp_stdio_visual_server.js');
  const artifactPath = path.join(tempRoot, '.faber', 'external-mcp-artifacts', 'stdio-test.png');
  const transport = createExternalMcpStdioTransport({
    command: process.execPath,
    args: [fixturePath],
    requestTimeoutMs: 4000,
  });

  try {
    const initialize = await transport.request('initialize', {
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'Faber Test' },
    });
    assert.strictEqual(initialize.serverInfo.name, 'Faber Visual Fixture MCP');
    const initialized = await transport.notify('notifications/initialized', {});
    assert.strictEqual(initialized.ok, true);

    const listed = await transport.request('tools/list', {});
    assert.strictEqual(listed.tools.length, 2);
    assert.strictEqual(listed.tools.some((tool) => tool.name === 'visual.capture'), true);

    const capture = await transport.request('tools/call', {
      name: 'visual.capture',
      arguments: {
        artifactPath,
        projectSession: { rootPath: tempRoot, projectId: 'stdio-test' },
      },
    });
    assert.deepStrictEqual(capture.artifacts, [artifactPath]);
    assert.strictEqual(fs.existsSync(artifactPath), true);
    assert.strictEqual(capture.structuredContent.domMetrics.length, 3);
    assert.strictEqual(transport.status().running, true);
  } finally {
    transport.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testHttpTransportJsonAndSse() {
  const calls = [];
  const jsonTransport = createExternalMcpHttpTransport({
    endpoint: 'https://mcp.example.test/rpc',
    headers: { Authorization: 'Bearer test' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const request = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            tools: [{ name: 'demo.echo', inputSchema: { type: 'object' } }],
          },
        }),
      };
    },
  });
  const listed = await jsonTransport.request('tools/list', {});
  assert.strictEqual(listed.tools[0].name, 'demo.echo');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer test');
  const notified = await jsonTransport.notify('notifications/initialized', {});
  assert.strictEqual(notified.ok, true);
  const notificationBody = JSON.parse(calls[1].options.body);
  assert.strictEqual(notificationBody.id, undefined);
  assert.strictEqual(notificationBody.method, 'notifications/initialized');

  const sseTransport = createExternalMcpHttpTransport({
    endpoint: 'https://mcp.example.test/sse',
    accept: 'text/event-stream',
    fetchImpl: async (_, options) => {
      const request = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        text: async () => [
          'event: message',
          `data: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'ok' }] } })}`,
          '',
        ].join('\n'),
      };
    },
  });
  const called = await sseTransport.request('tools/call', { name: 'demo.echo', arguments: {} });
  assert.strictEqual(called.content[0].text, 'ok');

  const invalidTransport = createExternalMcpHttpTransport({ endpoint: 'file:///tmp/socket' });
  const invalid = await invalidTransport.request('tools/list', {});
  assert.strictEqual(Boolean(invalid.error), true);
  assert.match(invalid.error.message, /http ou https/);
}

async function run() {
  await testStdioTransport();
  await testHttpTransportJsonAndSse();
  console.log('external-mcp-transports.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
