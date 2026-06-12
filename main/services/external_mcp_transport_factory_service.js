const { createExternalMcpHttpTransport } = require('./external_mcp_http_transport_service');
const { createExternalMcpStdioTransport } = require('./external_mcp_stdio_transport_service');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeId(value = '') {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function createExternalMcpTransportFactory(dependencies = {}) {
  const {
    childProcess,
    fetchImpl,
  } = dependencies;

  function createTransport(server = {}) {
    const transport = normalizeId(server.transport || server.transportKind || server.type);
    if (transport === 'stdio') {
      return createExternalMcpStdioTransport({
        command: server.command,
        args: server.args,
        cwd: server.cwd,
        env: server.env,
        childProcess,
        requestTimeoutMs: server.requestTimeoutMs || server.timeoutMs,
      });
    }
    if (transport === 'http' || transport === 'sse' || server.endpoint || server.url) {
      return createExternalMcpHttpTransport({
        endpoint: server.endpoint || server.url,
        headers: server.headers,
        fetchImpl,
        requestTimeoutMs: server.requestTimeoutMs || server.timeoutMs,
        accept: transport === 'sse' ? 'text/event-stream, application/json' : 'application/json, text/event-stream',
      });
    }
    return null;
  }

  return {
    createTransport,
  };
}

module.exports = {
  createExternalMcpTransportFactory,
};
