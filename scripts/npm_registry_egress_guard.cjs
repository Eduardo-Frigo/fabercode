'use strict';

const http = require('http');
const https = require('https');

const NPM_REGISTRY_HOST = 'registry.npmjs.org';

function blocked(target = '') {
  const error = new Error(`npm egress denied outside ${NPM_REGISTRY_HOST}: ${target || 'unknown target'}`);
  error.code = 'NPM_EGRESS_BLOCKED';
  throw error;
}

function normalizeRequestUrl(input, options = null, defaultProtocol = 'https:') {
  if (input instanceof URL) return input;
  if (typeof input === 'string') {
    try {
      return new URL(input);
    } catch {
      const optionHost = options && (options.hostname || options.host);
      if (!optionHost) return null;
    }
  }
  const source = input && typeof input === 'object' ? input : options;
  if (!source || typeof source !== 'object') return null;
  const protocol = String(source.protocol || defaultProtocol);
  const hostname = String(source.hostname || source.host || '').replace(/^\[|\]$/g, '');
  if (!hostname) return null;
  const port = source.port ? `:${source.port}` : '';
  const pathname = String(source.path || source.pathname || '/');
  try {
    return new URL(`${protocol}//${hostname}${port}${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
  } catch {
    return null;
  }
}

function assertRegistryUrl(input, options = null, defaultProtocol = 'https:') {
  const parsed = normalizeRequestUrl(input, options, defaultProtocol);
  if (!parsed || parsed.protocol !== 'https:' || parsed.hostname !== NPM_REGISTRY_HOST
    || (parsed.port && parsed.port !== '443') || parsed.username || parsed.password) {
    blocked(parsed ? parsed.origin : String(input || ''));
  }
  return parsed;
}

function requestOptionsFromArgs(args) {
  return args.length > 1 && args[1] && typeof args[1] === 'object'
    ? args[1]
    : null;
}

const originalHttpsRequest = https.request;
https.request = function guardedHttpsRequest(...args) {
  assertRegistryUrl(args[0], requestOptionsFromArgs(args), 'https:');
  return originalHttpsRequest.apply(this, args);
};

const originalHttpsGet = https.get;
https.get = function guardedHttpsGet(...args) {
  assertRegistryUrl(args[0], requestOptionsFromArgs(args), 'https:');
  return originalHttpsGet.apply(this, args);
};

http.request = function deniedHttpRequest(...args) {
  const target = normalizeRequestUrl(args[0], requestOptionsFromArgs(args), 'http:');
  return blocked(target ? target.origin : String(args[0] || ''));
};

http.get = function deniedHttpGet(...args) {
  const target = normalizeRequestUrl(args[0], requestOptionsFromArgs(args), 'http:');
  return blocked(target ? target.origin : String(args[0] || ''));
};

if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function guardedFetch(input, init) {
    assertRegistryUrl(input && input.url ? input.url : input, null, 'https:');
    return originalFetch(input, init);
  };
}

module.exports = Object.freeze({
  NPM_REGISTRY_HOST,
  assertRegistryUrl,
});
