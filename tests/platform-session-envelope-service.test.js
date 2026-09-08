'use strict';

const assert = require('assert');

const {
  createPlatformSessionEnvelopeService,
} = require('../main/services/platform_session_envelope_service');

function createService(sessionSecret = 'session-secret') {
  return createPlatformSessionEnvelopeService({
    protectSecret: (value) => `protected:${value}`,
    sessionSecret,
    unprotectSecret: (value) => String(value || '').replace(/^protected:/, ''),
  });
}

function validSession() {
  return {
    id: 'session-token-12345678',
    createdAt: '2026-09-04T12:00:00.000Z',
    appVersion: '0.1.3',
    user: {
      id: 'usr_local_1',
      email: 'local@example.com',
      name: 'Local User',
      avatarUrl: '',
      provider: 'password',
      providerUserId: 'local@example.com',
      themePreference: 'dark',
      languagePreference: 'pt-BR',
    },
  };
}

function run() {
  const service = createService();
  const session = validSession();
  const envelope = service.createEnvelope(session);
  assert.deepStrictEqual(Object.keys(envelope).sort(), [
    'payload',
    'protected',
    'signature',
    'version',
  ]);
  assert.strictEqual(envelope.protected, true);
  assert.strictEqual(envelope.version, 1);
  assert.ok(envelope.payload.startsWith('protected:'));
  assert.match(envelope.signature, /^[A-Za-z0-9_-]{43}$/);
  assert.deepStrictEqual(service.parseEnvelope(JSON.stringify(envelope)), session);

  assert.strictEqual(service.parseEnvelope(JSON.stringify(session)), null);
  assert.strictEqual(service.parseEnvelope('null'), null);
  assert.strictEqual(service.parseEnvelope('{not-json'), null);
  assert.strictEqual(service.parseEnvelope(JSON.stringify({
    ...envelope,
    version: 2,
  })), null);
  assert.strictEqual(service.parseEnvelope(JSON.stringify({
    ...envelope,
    extra: true,
  })), null);
  assert.strictEqual(service.parseEnvelope(JSON.stringify({
    ...envelope,
    signature: `${envelope.signature.slice(0, -1)}x`,
  })), null);
  assert.strictEqual(service.parseEnvelope(JSON.stringify({
    ...envelope,
    payload: 'protected:{malformed-json',
  })), null);

  const missingIdEnvelope = service.createEnvelope({
    ...session,
    id: '',
  });
  assert.strictEqual(missingIdEnvelope, null);

  const invalidUserEnvelope = service.createEnvelope({
    ...session,
    user: { ...session.user, id: '' },
  });
  assert.strictEqual(invalidUserEnvelope, null);

  const wrongSecretService = createService('another-session-secret');
  assert.strictEqual(wrongSecretService.parseEnvelope(JSON.stringify(envelope)), null);

  const noSecretService = createService('');
  assert.strictEqual(noSecretService.createEnvelope(session), null);
  assert.strictEqual(noSecretService.parseEnvelope(JSON.stringify(envelope)), null);

  const malformedProtectionService = createPlatformSessionEnvelopeService({
    protectSecret: async () => 'not-synchronous',
    sessionSecret: 'session-secret',
    unprotectSecret: () => JSON.stringify(session),
  });
  assert.strictEqual(malformedProtectionService.createEnvelope(session), null);

  const malformedUnprotectService = createPlatformSessionEnvelopeService({
    protectSecret: (value) => value,
    sessionSecret: 'session-secret',
    unprotectSecret: async () => JSON.stringify(session),
  });
  const plainEnvelope = malformedUnprotectService.createEnvelope(session);
  assert.ok(plainEnvelope);
  assert.strictEqual(
    malformedUnprotectService.parseEnvelope(JSON.stringify(plainEnvelope)),
    null,
  );

  assert.throws(
    () => createPlatformSessionEnvelopeService(),
    /protectSecret is required/,
  );

  console.log('platform-session-envelope-service.test.js: ok');
}

run();
