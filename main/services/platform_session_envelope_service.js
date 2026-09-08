'use strict';

const crypto = require('crypto');
const util = require('util');

const SESSION_ENVELOPE_VERSION = 1;
const ENVELOPE_KEYS = Object.freeze(['protected', 'version', 'payload', 'signature']);
const SESSION_KEYS = Object.freeze(['id', 'user', 'createdAt', 'appVersion']);
const USER_KEYS = Object.freeze([
  'id',
  'email',
  'name',
  'avatarUrl',
  'provider',
  'providerUserId',
  'themePreference',
  'languagePreference',
]);
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{8,256}$/;
const SAFE_ACTOR_ID = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_APP_VERSION = /^[A-Za-z0-9.+_-]{1,64}$/;

function exactDataFields(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || util.types.isProxy(value) || util.types.isPromise(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length
      || keys.some((key) => typeof key !== 'string')
      || expectedKeys.some((key) => !keys.includes(key))) return null;
    const fields = new Map();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
        return null;
      }
      fields.set(key, descriptor.value);
    }
    return fields;
  } catch {
    return null;
  }
}

function validBoundedString(value, maxLength, { allowEmpty = true } = {}) {
  return typeof value === 'string'
    && value.length <= maxLength
    && (allowEmpty || value.length > 0)
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function normalizeSession(value) {
  const session = exactDataFields(value, SESSION_KEYS);
  if (!session) return null;
  const id = session.get('id');
  const createdAt = session.get('createdAt');
  const appVersion = session.get('appVersion');
  if (typeof id !== 'string' || !SAFE_SESSION_ID.test(id)
    || !validBoundedString(createdAt, 64, { allowEmpty: false })
    || !Number.isFinite(Date.parse(createdAt))
    || typeof appVersion !== 'string' || !SAFE_APP_VERSION.test(appVersion)) return null;

  const user = exactDataFields(session.get('user'), USER_KEYS);
  if (!user) return null;
  const userId = user.get('id');
  if (typeof userId !== 'string' || !SAFE_ACTOR_ID.test(userId)
    || !validBoundedString(user.get('email'), 320)
    || !validBoundedString(user.get('name'), 200, { allowEmpty: false })
    || !validBoundedString(user.get('avatarUrl'), 2048)
    || !validBoundedString(user.get('provider'), 64)
    || !validBoundedString(user.get('providerUserId'), 256)
    || !['', 'light', 'dark'].includes(user.get('themePreference'))
    || !['', 'pt-BR', 'en-US', 'es-ES'].includes(user.get('languagePreference'))) return null;

  return Object.freeze({
    id,
    createdAt,
    appVersion,
    user: Object.freeze({
      id: userId,
      email: user.get('email'),
      name: user.get('name'),
      avatarUrl: user.get('avatarUrl'),
      provider: user.get('provider'),
      providerUserId: user.get('providerUserId'),
      themePreference: user.get('themePreference'),
      languagePreference: user.get('languagePreference'),
    }),
  });
}

function createPlatformSessionEnvelopeService(dependencies = {}) {
  const {
    protectSecret,
    sessionSecret = '',
    unprotectSecret,
  } = dependencies;
  if (typeof protectSecret !== 'function') throw new TypeError('protectSecret is required');
  if (typeof unprotectSecret !== 'function') throw new TypeError('unprotectSecret is required');
  const secret = typeof sessionSecret === 'string' ? sessionSecret.trim() : '';

  function sign(payload) {
    if (!secret || typeof payload !== 'string' || !payload) return '';
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  }

  function signatureMatches(payload, signature) {
    const expected = sign(payload);
    if (!expected || typeof signature !== 'string' || !signature) return false;
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(signature, 'utf8');
    return expectedBuffer.length === actualBuffer.length
      && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }

  function createEnvelope(inputSession) {
    const session = normalizeSession(inputSession);
    if (!session || !secret) return null;
    try {
      const protectedPayload = protectSecret(JSON.stringify(session));
      if (protectedPayload && typeof protectedPayload.then === 'function') return null;
      if (typeof protectedPayload !== 'string' || !protectedPayload) return null;
      const signature = sign(protectedPayload);
      if (!signature) return null;
      return Object.freeze({
        protected: true,
        version: SESSION_ENVELOPE_VERSION,
        payload: protectedPayload,
        signature,
      });
    } catch {
      return null;
    }
  }

  function parseEnvelope(content) {
    if (!secret || typeof content !== 'string' || !content) return null;
    try {
      const parsed = JSON.parse(content);
      const envelope = exactDataFields(parsed, ENVELOPE_KEYS);
      if (!envelope
        || envelope.get('protected') !== true
        || envelope.get('version') !== SESSION_ENVELOPE_VERSION
        || typeof envelope.get('payload') !== 'string'
        || typeof envelope.get('signature') !== 'string'
        || !signatureMatches(envelope.get('payload'), envelope.get('signature'))) return null;
      const unprotected = unprotectSecret(envelope.get('payload'));
      if (unprotected && typeof unprotected.then === 'function') return null;
      if (typeof unprotected !== 'string' || !unprotected) return null;
      return normalizeSession(JSON.parse(unprotected));
    } catch {
      return null;
    }
  }

  return Object.freeze({
    createEnvelope,
    parseEnvelope,
  });
}

module.exports = {
  SESSION_ENVELOPE_VERSION,
  createPlatformSessionEnvelopeService,
};
