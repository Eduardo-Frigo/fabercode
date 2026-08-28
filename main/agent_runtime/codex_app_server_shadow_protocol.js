'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CODEX_APP_SERVER_SHADOW_PROTOCOL_VERSION = 'codex-app-server-shadow-protocol.v1';
const CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION =
  'codex-app-server-shadow-isolation-profile.v1';
const CODEX_APP_SERVER_PINNED_CLI_VERSION = '0.150.0-alpha.12.2';
const SCHEMA_MANIFEST_VERSION = 'codex-app-server-generated-schema-manifest.v1';
const SCHEMA_DIRECTORY = path.join(
  __dirname,
  'protocol',
  'codex_app_server',
  CODEX_APP_SERVER_PINNED_CLI_VERSION
);
const SCHEMA_MANIFEST_PATH = path.join(SCHEMA_DIRECTORY, 'manifest.json');

const CODEX_APP_SERVER_SHADOW_TRANSPORT = deepFreeze({
  kind: 'stdio',
  listen: 'stdio://',
  framing: 'jsonl',
  jsonrpcVersion: '2.0',
  includeJsonrpcMember: false,
});

const CODEX_APP_SERVER_SHADOW_ALLOWED_METHODS = deepFreeze({
  requests: ['initialize', 'thread/start', 'turn/start', 'turn/interrupt'],
  notifications: ['initialized'],
});
const CODEX_APP_SERVER_SHADOW_HANDSHAKE = deepFreeze(['initialize', 'initialized']);
const SAFE_MCP_SERVER_NAME = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_DISABLED_MCP_SERVERS = 128;

const ALLOWED_REQUEST_METHODS = new Set(CODEX_APP_SERVER_SHADOW_ALLOWED_METHODS.requests);
const ALLOWED_NOTIFICATION_METHODS = new Set(
  CODEX_APP_SERVER_SHADOW_ALLOWED_METHODS.notifications
);

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function protocolError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function schemaIntegrityError(message, cause) {
  return protocolError('CODEX_APP_SERVER_SCHEMA_INTEGRITY_FAILED', message, cause);
}

function invalidMessage(message) {
  throw protocolError('CODEX_APP_SERVER_SHADOW_INVALID_MESSAGE', message);
}

function unsafeParams(message) {
  throw protocolError('CODEX_APP_SERVER_SHADOW_UNSAFE_PARAMS', message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return false;
  if (keys.length !== expectedKeys.length) return false;
  const actual = [...keys].sort();
  const expected = [...expectedKeys].sort();
  if (actual.some((key, index) => key !== expected[index])) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    unsafeParams(`${label} must be a non-empty string`);
  }
}

function assertRequestId(id) {
  const validString = typeof id === 'string' && Boolean(id.trim());
  const validInteger = Number.isSafeInteger(id) && id >= 0;
  if (!validString && !validInteger) invalidMessage('App Server request id is invalid');
}

function assertAbsoluteCwd(cwd) {
  assertNonEmptyString(cwd, 'App Server shadow cwd');
  if (!path.isAbsolute(cwd)) unsafeParams('App Server shadow cwd must be absolute');
}

function normalizeDisabledMcpServerNames(value) {
  if (!Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || !Object.isFrozen(value)
    || value.length > MAX_DISABLED_MCP_SERVERS) {
    unsafeParams('App Server shadow disabled MCP servers are invalid');
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) {
    unsafeParams('App Server shadow disabled MCP servers must be dense');
  }
  const names = keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const name = descriptor && descriptor.enumerable === true
      && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : null;
    if (typeof name !== 'string' || !SAFE_MCP_SERVER_NAME.test(name)) {
      unsafeParams('App Server shadow disabled MCP server name is invalid');
    }
    return name;
  });
  if (new Set(names).size !== names.length) {
    unsafeParams('App Server shadow MCP isolation profile is invalid');
  }
  return Object.freeze([...names].sort());
}

function createMcpIsolationConfig(disabledMcpServerNames) {
  const mcpServers = {};
  for (const name of normalizeDisabledMcpServerNames(disabledMcpServerNames)) {
    mcpServers[name] = { enabled: false };
  }
  return {
    features: { apps: false, plugins: false },
    mcp_servers: mcpServers,
  };
}

function assertMcpIsolationConfig(config) {
  if (!hasExactDataKeys(config, ['features', 'mcp_servers'])
    || !hasExactDataKeys(config.features, ['apps', 'plugins'])
    || config.features.apps !== false
    || config.features.plugins !== false
    || !isPlainObject(config.mcp_servers)) {
    unsafeParams('App Server shadow integration isolation is invalid');
  }
  const names = Reflect.ownKeys(config.mcp_servers);
  if (names.some((name) => typeof name !== 'string')
    || names.length > MAX_DISABLED_MCP_SERVERS) {
    unsafeParams('App Server shadow MCP isolation profile is invalid');
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(config.mcp_servers, name);
    if (!SAFE_MCP_SERVER_NAME.test(name)
      || !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || !hasExactDataKeys(descriptor.value, ['enabled'])
      || descriptor.value.enabled !== false) {
      unsafeParams('App Server shadow MCP isolation entry is invalid');
    }
  }
}

function readPinnedManifest() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(SCHEMA_MANIFEST_PATH, 'utf8'));
  } catch (error) {
    throw schemaIntegrityError('Could not read the pinned App Server schema manifest', error);
  }

  if (!isPlainObject(parsed)
    || parsed.schemaVersion !== SCHEMA_MANIFEST_VERSION
    || parsed.codexCliVersion !== CODEX_APP_SERVER_PINNED_CLI_VERSION
    || parsed.generatorCommand !== 'codex app-server generate-json-schema --out <directory>'
    || !Array.isArray(parsed.artifacts)
    || parsed.artifacts.length !== 2) {
    throw schemaIntegrityError('Pinned App Server schema manifest is invalid');
  }

  return deepFreeze(parsed);
}

const CODEX_APP_SERVER_SCHEMA_MANIFEST = readPinnedManifest();

function verifyCodexAppServerGeneratedSchemas({ readFileSync = fs.readFileSync } = {}) {
  if (typeof readFileSync !== 'function') {
    throw new TypeError('readFileSync must be a function');
  }

  const artifacts = CODEX_APP_SERVER_SCHEMA_MANIFEST.artifacts.map((artifact) => {
    if (!isPlainObject(artifact)
      || typeof artifact.file !== 'string'
      || path.basename(artifact.file) !== artifact.file
      || typeof artifact.sha256 !== 'string'
      || typeof artifact.title !== 'string'
      || !Number.isSafeInteger(artifact.definitions)) {
      throw schemaIntegrityError('Pinned App Server schema artifact metadata is invalid');
    }

    let bytes;
    try {
      const loaded = readFileSync(path.join(SCHEMA_DIRECTORY, artifact.file));
      bytes = Buffer.isBuffer(loaded) ? loaded : Buffer.from(loaded);
    } catch (error) {
      throw schemaIntegrityError(`Could not read pinned schema artifact ${artifact.file}`, error);
    }

    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== artifact.sha256 || bytes.length !== artifact.bytes) {
      throw schemaIntegrityError(`Pinned schema artifact ${artifact.file} failed SHA-256 attestation`);
    }

    let schema;
    try {
      schema = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw schemaIntegrityError(`Pinned schema artifact ${artifact.file} is not valid JSON`, error);
    }

    const definitions = isPlainObject(schema.definitions)
      ? Object.keys(schema.definitions).length
      : -1;
    if (schema.title !== artifact.title || definitions !== artifact.definitions) {
      throw schemaIntegrityError(`Pinned schema artifact ${artifact.file} has unexpected metadata`);
    }

    return {
      file: artifact.file,
      sha256,
      title: schema.title,
      definitions,
    };
  });

  return deepFreeze({
    ok: true,
    schemaVersion: CODEX_APP_SERVER_SCHEMA_MANIFEST.schemaVersion,
    codexCliVersion: CODEX_APP_SERVER_PINNED_CLI_VERSION,
    artifacts,
  });
}

function assertInitializeRequest(message) {
  if (!hasExactDataKeys(message.params, ['clientInfo', 'capabilities'])) {
    unsafeParams('App Server initialize params are outside the shadow profile');
  }
  const { clientInfo, capabilities } = message.params;
  if (!hasExactDataKeys(clientInfo, ['name', 'title', 'version'])
    || clientInfo.name !== 'faber-code-shadow-harness'
    || clientInfo.title !== 'Faber Code Shadow Harness'
    || typeof clientInfo.version !== 'string'
    || !clientInfo.version.trim()) {
    unsafeParams('App Server shadow client identity is invalid');
  }
  if (!hasExactDataKeys(capabilities, ['experimentalApi', 'requestAttestation'])
    || capabilities.experimentalApi !== false
    || capabilities.requestAttestation !== false) {
    unsafeParams('App Server shadow capabilities must remain stable and non-attested');
  }
}

function assertThreadStartRequest(message) {
  if (!isPlainObject(message.params)) {
    unsafeParams('App Server thread/start params are outside the shadow profile');
  }
  const hasModel = Object.hasOwn(message.params, 'model');
  const expectedKeys = ['cwd', 'approvalPolicy', 'sandbox', 'ephemeral', 'config'];
  if (hasModel) expectedKeys.push('model');
  if (!hasExactDataKeys(message.params, expectedKeys)) {
    unsafeParams('App Server thread/start params are outside the shadow profile');
  }
  assertAbsoluteCwd(message.params.cwd);
  if (message.params.approvalPolicy !== 'never'
    || message.params.sandbox !== 'read-only'
    || message.params.ephemeral !== true) {
    unsafeParams('App Server shadow threads must be ephemeral, read-only, and non-approving');
  }
  if (hasModel) assertNonEmptyString(message.params.model, 'App Server shadow model');
  assertMcpIsolationConfig(message.params.config);
}

function assertTurnStartRequest(message) {
  if (!hasExactDataKeys(
    message.params,
    ['threadId', 'input', 'cwd', 'approvalPolicy', 'sandboxPolicy']
  )) {
    unsafeParams('App Server turn/start params are outside the shadow profile');
  }
  assertNonEmptyString(message.params.threadId, 'App Server shadow threadId');
  assertAbsoluteCwd(message.params.cwd);
  if (message.params.approvalPolicy !== 'never') {
    unsafeParams('App Server shadow turns cannot request approval');
  }
  if (!hasExactDataKeys(message.params.sandboxPolicy, ['type', 'networkAccess'])
    || message.params.sandboxPolicy.type !== 'readOnly'
    || message.params.sandboxPolicy.networkAccess !== false) {
    unsafeParams('App Server shadow turns must use the offline read-only sandbox');
  }
  if (!Array.isArray(message.params.input) || message.params.input.length !== 1) {
    unsafeParams('App Server shadow turns accept exactly one text input');
  }
  const [input] = message.params.input;
  if (!hasExactDataKeys(input, ['type', 'text', 'text_elements'])
    || input.type !== 'text'
    || typeof input.text !== 'string'
    || !input.text.trim()
    || !Array.isArray(input.text_elements)
    || input.text_elements.length !== 0) {
    unsafeParams('App Server shadow turn input must be plain non-empty text');
  }
}

function assertTurnInterruptRequest(message) {
  if (!hasExactDataKeys(message.params, ['threadId', 'turnId'])) {
    unsafeParams('App Server turn/interrupt params are outside the shadow profile');
  }
  assertNonEmptyString(message.params.threadId, 'App Server shadow threadId');
  assertNonEmptyString(message.params.turnId, 'App Server shadow turnId');
}

function assertCodexAppServerShadowOutboundMessage(message) {
  if (!isPlainObject(message) || Object.hasOwn(message, 'jsonrpc')) {
    invalidMessage('App Server shadow messages must omit the jsonrpc member');
  }
  const methodDescriptor = Object.getOwnPropertyDescriptor(message, 'method');
  if (!methodDescriptor
    || !Object.hasOwn(methodDescriptor, 'value')
    || typeof methodDescriptor.value !== 'string') {
    invalidMessage('App Server shadow message method is invalid');
  }
  const method = methodDescriptor.value;

  if (ALLOWED_NOTIFICATION_METHODS.has(method)) {
    if (!hasExactDataKeys(message, ['method'])) {
      invalidMessage('App Server initialized notification has an invalid envelope');
    }
    return message;
  }
  if (!ALLOWED_REQUEST_METHODS.has(method)) {
    throw protocolError(
      'CODEX_APP_SERVER_SHADOW_METHOD_BLOCKED',
      `App Server method ${method || '<empty>'} is blocked in shadow mode`
    );
  }
  if (!hasExactDataKeys(message, ['id', 'method', 'params'])) {
    invalidMessage(`App Server ${method} request has an invalid envelope`);
  }
  assertRequestId(message.id);

  switch (method) {
    case 'initialize':
      assertInitializeRequest(message);
      break;
    case 'thread/start':
      assertThreadStartRequest(message);
      break;
    case 'turn/start':
      assertTurnStartRequest(message);
      break;
    case 'turn/interrupt':
      assertTurnInterruptRequest(message);
      break;
    default:
      throw protocolError(
        'CODEX_APP_SERVER_SHADOW_METHOD_BLOCKED',
        `App Server method ${method} is blocked in shadow mode`
      );
  }
  return message;
}

function freezeValidatedMessage(message) {
  const frozen = deepFreeze(message);
  assertCodexAppServerShadowOutboundMessage(frozen);
  return frozen;
}

function createCodexAppServerInitializeRequest({ id, clientVersion } = {}) {
  assertRequestId(id);
  assertNonEmptyString(clientVersion, 'App Server shadow clientVersion');
  return freezeValidatedMessage({
    id,
    method: 'initialize',
    params: {
      clientInfo: {
        name: 'faber-code-shadow-harness',
        title: 'Faber Code Shadow Harness',
        version: clientVersion,
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    },
  });
}

function createCodexAppServerInitializedNotification() {
  return freezeValidatedMessage({ method: 'initialized' });
}

function createCodexAppServerShadowThreadStartRequest({
  id,
  cwd,
  model,
  disabledMcpServerNames = Object.freeze([]),
} = {}) {
  assertRequestId(id);
  assertAbsoluteCwd(cwd);
  const params = {
    cwd,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: true,
    config: createMcpIsolationConfig(disabledMcpServerNames),
  };
  if (model !== undefined && model !== null) {
    assertNonEmptyString(model, 'App Server shadow model');
    params.model = model;
  }
  return freezeValidatedMessage({ id, method: 'thread/start', params });
}

function createCodexAppServerShadowTurnStartRequest({
  id,
  threadId,
  cwd,
  prompt,
} = {}) {
  assertRequestId(id);
  assertNonEmptyString(threadId, 'App Server shadow threadId');
  assertAbsoluteCwd(cwd);
  assertNonEmptyString(prompt, 'App Server shadow prompt');
  return freezeValidatedMessage({
    id,
    method: 'turn/start',
    params: {
      threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      cwd,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    },
  });
}

function createCodexAppServerShadowTurnInterruptRequest({ id, threadId, turnId } = {}) {
  assertRequestId(id);
  assertNonEmptyString(threadId, 'App Server shadow threadId');
  assertNonEmptyString(turnId, 'App Server shadow turnId');
  return freezeValidatedMessage({
    id,
    method: 'turn/interrupt',
    params: { threadId, turnId },
  });
}

module.exports = {
  CODEX_APP_SERVER_PINNED_CLI_VERSION,
  CODEX_APP_SERVER_SCHEMA_MANIFEST,
  CODEX_APP_SERVER_SHADOW_ALLOWED_METHODS,
  CODEX_APP_SERVER_SHADOW_HANDSHAKE,
  CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
  CODEX_APP_SERVER_SHADOW_PROTOCOL_VERSION,
  CODEX_APP_SERVER_SHADOW_TRANSPORT,
  assertCodexAppServerShadowOutboundMessage,
  createCodexAppServerInitializeRequest,
  createCodexAppServerInitializedNotification,
  createCodexAppServerShadowThreadStartRequest,
  createCodexAppServerShadowTurnInterruptRequest,
  createCodexAppServerShadowTurnStartRequest,
  verifyCodexAppServerGeneratedSchemas,
};
