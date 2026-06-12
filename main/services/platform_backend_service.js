const defaultHttp = require('http');
const { buildLoginResultHtml } = require('./platform_auth_callback_page_service');

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
  });
  response.end(html);
}

function readRequestJson(request, maxBytes = 1024 * 256) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk.toString('utf8');
      if (Buffer.byteLength(raw) > maxBytes) {
        reject(new Error('Payload muito grande.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON invalido.'));
      }
    });
    request.on('error', reject);
  });
}

function createPlatformBackendService(dependencies = {}) {
  const {
    accountService,
    appendAuditEvent = () => {},
    host = '127.0.0.1',
    http = defaultHttp,
    mediaService,
    onAuthCompleted = () => {},
    port = 37418,
    startRetryAttempts = 12,
    startRetryDelayMs = 250,
  } = dependencies;

  let server = null;
  let bound = null;

  function getStatus() {
    return {
      ok: true,
      running: Boolean(server && bound),
      host,
      port: bound && bound.port ? bound.port : port,
      baseUrl: bound ? `http://${bound.address}:${bound.port}` : `http://${host}:${port}`,
    };
  }

  async function handleGoogleCallback(url, response) {
    const code = url.searchParams.get('code') || '';
    const state = url.searchParams.get('state') || '';
    const result = await accountService.exchangeGoogleCode({ code, state });
    appendAuditEvent(result.ok ? 'platform_backend.google_callback_ok' : 'platform_backend.google_callback_failed', {
      ok: Boolean(result.ok),
      message: result.ok ? null : result.message || null,
    });
    if (result.ok) {
      onAuthCompleted(result.session || null);
    }
    sendHtml(response, result.ok ? 200 : 400, buildLoginResultHtml(result));
  }

  async function handleGithubCallback(url, response) {
    const code = url.searchParams.get('code') || '';
    const state = url.searchParams.get('state') || '';
    const result = await accountService.exchangeGithubCode({ code, state });
    appendAuditEvent(result.ok ? 'platform_backend.github_callback_ok' : 'platform_backend.github_callback_failed', {
      ok: Boolean(result.ok),
      message: result.ok ? null : result.message || null,
    });
    if (result.ok) {
      onAuthCompleted(result.session || null);
    }
    sendHtml(response, result.ok ? 200 : 400, buildLoginResultHtml(result));
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url || '/', `http://${host}:${port}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, { ok: true, service: 'faber-platform-backend', status: getStatus() });
    }
    if (request.method === 'GET' && url.pathname === '/api/account/status') {
      return sendJson(response, 200, accountService.getStatus());
    }
    if (request.method === 'GET' && url.pathname === '/auth/google/callback') {
      return handleGoogleCallback(url, response);
    }
    if (request.method === 'GET' && url.pathname === '/auth/github/callback') {
      return handleGithubCallback(url, response);
    }
    if (request.method === 'POST' && url.pathname === '/api/media/blueprint') {
      const session = accountService.getCurrentSession();
      if (!session) {
        return sendJson(response, 401, {
          ok: false,
          message: 'Login necessario para usar midia de plataforma.',
        });
      }
      const payload = await readRequestJson(request);
      const media = await mediaService.resolveBlueprintMediaAssets(payload || {});
      return sendJson(response, 200, { ok: true, media });
    }
    return sendJson(response, 404, { ok: false, message: 'Rota inexistente.' });
  }

  function start() {
    if (server) return Promise.resolve(getStatus());
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const bind = () => {
        const nextServer = http.createServer((request, response) => {
          handleRequest(request, response).catch((error) => {
            sendJson(response, 500, {
              ok: false,
              message: error && error.message ? error.message : String(error || ''),
            });
          });
        });

        const onError = (error) => {
          if (error && error.code === 'EADDRINUSE' && attempts < startRetryAttempts) {
            attempts += 1;
            appendAuditEvent('platform_backend.start_retry', {
              attempt: attempts,
              port,
              message: error.message,
            });
            setTimeout(bind, Math.max(10, Number(startRetryDelayMs) || 250));
            return;
          }
          reject(error);
        };

        nextServer.once('error', onError);
        try {
          nextServer.listen(port, host, () => {
            nextServer.removeListener('error', onError);
            const address = nextServer.address();
            bound = {
              address: typeof address === 'object' && address ? address.address : host,
              port: typeof address === 'object' && address ? address.port : port,
            };
            server = nextServer;
            appendAuditEvent('platform_backend.started', getStatus());
            resolve(getStatus());
          });
        } catch (error) {
          onError(error);
        }
      };

      bind();
    });
  }

  function stop() {
    if (!server) return Promise.resolve({ ok: true, stopped: false });
    return new Promise((resolve) => {
      const target = server;
      server = null;
      bound = null;
      target.close(() => {
        appendAuditEvent('platform_backend.stopped', { ok: true });
        resolve({ ok: true, stopped: true });
      });
    });
  }

  return {
    getStatus,
    start,
    stop,
  };
}

module.exports = {
  buildLoginResultHtml,
  createPlatformBackendService,
  readRequestJson,
};
