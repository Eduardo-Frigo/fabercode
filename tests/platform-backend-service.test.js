const assert = require('assert');

const { createPlatformBackendService } = require('../main/services/platform_backend_service');

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
  assert.strictEqual(completed.length, 1);
  assert.ok(audit.some((event) => event.type === 'platform_backend.google_callback_ok'));

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

  console.log('platform-backend-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
