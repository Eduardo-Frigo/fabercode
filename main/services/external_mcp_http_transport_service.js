const DEFAULT_TIMEOUT_MS = 10000;

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeHeaders(value = {}) {
  if (!value || typeof value !== 'object') return {};
  return Object.keys(value).reduce((acc, key) => {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) return acc;
    acc[normalizedKey] = String(value[key] || '');
    return acc;
  }, {});
}

function parseSsePayload(text = '') {
  const events = String(text || '')
    .split(/\n\n+/)
    .map((block) => block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s?/, ''))
      .join('\n')
      .trim())
    .filter(Boolean)
    .filter((data) => data !== '[DONE]');
  for (const data of events) {
    try {
      return JSON.parse(data);
    } catch {
      // Continue looking for a JSON-RPC payload.
    }
  }
  return {
    error: {
      code: -32700,
      message: 'Resposta SSE MCP sem payload JSON-RPC valido.',
    },
  };
}

function createExternalMcpHttpTransport(dependencies = {}) {
  const {
    endpoint,
    headers = {},
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = DEFAULT_TIMEOUT_MS,
    accept = 'application/json, text/event-stream',
  } = dependencies;

  const safeEndpoint = normalizeText(endpoint);
  const safeHeaders = normalizeHeaders(headers);
  const timeoutMs = Math.max(500, Math.min(120000, Number(requestTimeoutMs) || DEFAULT_TIMEOUT_MS));
  let nextId = 1;

  function validateEndpoint() {
    if (!safeEndpoint) {
      return { ok: false, message: 'Endpoint HTTP MCP ausente.' };
    }
    let url = null;
    try {
      url = new URL(safeEndpoint);
    } catch {
      return { ok: false, message: 'Endpoint HTTP MCP invalido.' };
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { ok: false, message: 'Endpoint HTTP MCP deve usar http ou https.' };
    }
    return { ok: true, url };
  }

  async function sendJsonRpc(method, params = {}, { notification = false } = {}) {
    const endpointValidation = validateEndpoint();
    if (!endpointValidation.ok) {
      return {
        error: {
          code: -32602,
          message: endpointValidation.message,
        },
      };
    }
    if (typeof fetchImpl !== 'function') {
      return {
        error: {
          code: -32000,
          message: 'fetch indisponivel para transporte HTTP MCP.',
        },
      };
    }

    const id = notification ? '' : String(nextId);
    if (!notification) nextId += 1;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const body = {
      jsonrpc: '2.0',
      method: normalizeText(method),
      params: params && typeof params === 'object' ? params : {},
    };
    if (!notification) body.id = id;
    try {
      const response = await fetchImpl(safeEndpoint, {
        method: 'POST',
        headers: {
          Accept: accept,
          'Content-Type': 'application/json',
          ...safeHeaders,
        },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!response || response.ok === false) {
        return {
          error: {
            code: -32003,
            message: `HTTP MCP falhou com status ${response && response.status ? response.status : 'desconhecido'}.`,
          },
        };
      }
      if (notification) return { ok: true };
      const contentType = response.headers && typeof response.headers.get === 'function'
        ? normalizeText(response.headers.get('content-type')).toLowerCase()
        : '';
      const payload = contentType.includes('text/event-stream')
        ? parseSsePayload(await response.text())
        : await response.json();
      if (payload && payload.error) return { error: payload.error };
      return payload && payload.result !== undefined ? payload.result : payload;
    } catch (error) {
      if (timer) clearTimeout(timer);
      return {
        error: {
          code: error && error.name === 'AbortError' ? -32001 : -32000,
          message: error && error.message ? error.message : 'Falha no transporte HTTP MCP.',
        },
      };
    }
  }

  async function request(method, params = {}) {
    return sendJsonRpc(method, params, { notification: false });
  }

  async function notify(method, params = {}) {
    return sendJsonRpc(method, params, { notification: true });
  }

  function status() {
    const endpointValidation = validateEndpoint();
    return {
      endpoint: safeEndpoint,
      ok: endpointValidation.ok,
      message: endpointValidation.message || '',
    };
  }

  return {
    notify,
    request,
    status,
  };
}

module.exports = {
  createExternalMcpHttpTransport,
};
