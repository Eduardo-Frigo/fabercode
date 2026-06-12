const assert = require('assert');
const http = require('http');

const {
  buildLoginResultHtml,
  createPlatformBackendService,
} = require('../main/services/platform_backend_service');

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function run() {
  let currentSession = null;
  const audit = [];
  const accountService = {
    getStatus: () => ({ ok: true, signedIn: Boolean(currentSession), user: currentSession && currentSession.user }),
    getCurrentSession: () => currentSession,
    exchangeGoogleCode: async ({ code, state }) => {
      if (code !== 'code-ok' || state !== 'state-ok') return { ok: false, message: 'bad oauth' };
      currentSession = { user: { email: 'owner@example.com' } };
      return { ok: true, session: currentSession };
    },
    exchangeGithubCode: async ({ code, state }) => {
      if (code !== 'github-code-ok' || state !== 'github-state-ok') return { ok: false, message: 'bad github oauth' };
      currentSession = { user: { email: 'github-owner@example.com' } };
      return { ok: true, session: currentSession };
    },
  };
  const mediaService = {
    resolveBlueprintMediaAssets: async (payload) => ({
      provider: 'pexels',
      hero: null,
      query: payload.userMessage || '',
      status: 'missing_key',
    }),
  };
  const completed = [];
  const service = createPlatformBackendService({
    accountService,
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    host: '127.0.0.1',
    mediaService,
    onAuthCompleted: (session) => completed.push(session),
    port: 0,
  });

  const started = await service.start();
  assert.strictEqual(started.running, true);
  const baseUrl = started.baseUrl;

  const health = await fetch(`${baseUrl}/health`);
  assert.strictEqual(health.ok, true);
  const healthJson = await health.json();
  assert.strictEqual(healthJson.ok, true);
  assert.strictEqual(healthJson.service, 'faber-platform-backend');

  const blockedMedia = await fetch(`${baseUrl}/api/media/blueprint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userMessage: 'site para advogado' }),
  });
  assert.strictEqual(blockedMedia.status, 401);

  const callback = await fetch(`${baseUrl}/auth/google/callback?code=code-ok&state=state-ok`);
  assert.strictEqual(callback.status, 200);
  const callbackHtml = await callback.text();
  assert.ok(callbackHtml.includes('FaberCode'));
  assert.ok(callbackHtml.includes('Login feito com sucesso!'));
  assert.ok(callbackHtml.includes('Pode fechar essa página.'));
  assert.strictEqual(callbackHtml.includes('id="close-tab"'), false);
  assert.ok(callbackHtml.includes("window.close()"));
  assert.ok(callbackHtml.includes("data-close-blocked"));
  assert.strictEqual(callbackHtml.includes('background: #f7f6f1'), false);
  assert.strictEqual(completed.length, 1);
  assert.ok(audit.some((event) => event.type === 'platform_backend.google_callback_ok'));

  const githubCallback = await fetch(`${baseUrl}/auth/github/callback?code=github-code-ok&state=github-state-ok`);
  assert.strictEqual(githubCallback.status, 200);
  const githubCallbackHtml = await githubCallback.text();
  assert.ok(githubCallbackHtml.includes('Login feito com sucesso!'));
  assert.strictEqual(completed.length, 2);
  assert.ok(audit.some((event) => event.type === 'platform_backend.github_callback_ok'));

  const accountStatus = await fetch(`${baseUrl}/api/account/status`);
  const accountStatusJson = await accountStatus.json();
  assert.strictEqual(accountStatusJson.signedIn, true);

  const media = await fetch(`${baseUrl}/api/media/blueprint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userMessage: 'site para advogado' }),
  });
  assert.strictEqual(media.status, 200);
  const mediaJson = await media.json();
  assert.strictEqual(mediaJson.ok, true);
  assert.strictEqual(mediaJson.media.query, 'site para advogado');

  const stopped = await service.stop();
  assert.strictEqual(stopped.ok, true);

  const blocker = http.createServer((request, response) => response.end('old instance'));
  const occupiedPort = await listen(blocker);
  const retryAudit = [];
  const retryService = createPlatformBackendService({
    accountService,
    appendAuditEvent: (type, payload) => retryAudit.push({ type, payload }),
    host: '127.0.0.1',
    mediaService,
    port: occupiedPort,
    startRetryAttempts: 8,
    startRetryDelayMs: 20,
  });
  const retryStart = retryService.start();
  setTimeout(() => {
    close(blocker).catch(() => {});
  }, 40);
  const retried = await retryStart;
  assert.strictEqual(retried.running, true);
  assert.strictEqual(retried.port, occupiedPort);
  assert.ok(retryAudit.some((event) => event.type === 'platform_backend.start_retry'));
  const retryHealth = await fetch(`${retried.baseUrl}/health`);
  assert.strictEqual(retryHealth.ok, true);
  await retryService.stop();

  const failureHtml = buildLoginResultHtml({ ok: false, message: '<bad oauth>' });
  assert.ok(failureHtml.includes('&lt;bad oauth&gt;'));
  assert.strictEqual(failureHtml.includes('<bad oauth>'), false);

  console.log('platform-backend-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
