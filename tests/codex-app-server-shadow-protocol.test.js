'use strict';

const assert = require('assert');
const fs = require('fs');

const {
  CODEX_APP_SERVER_PINNED_CLI_VERSION,
  CODEX_APP_SERVER_SCHEMA_MANIFEST,
  CODEX_APP_SERVER_SHADOW_ALLOWED_METHODS,
  CODEX_APP_SERVER_SHADOW_HANDSHAKE,
  CODEX_APP_SERVER_SHADOW_PROTOCOL_VERSION,
  CODEX_APP_SERVER_SHADOW_TRANSPORT,
  assertCodexAppServerShadowOutboundMessage,
  createCodexAppServerInitializeRequest,
  createCodexAppServerInitializedNotification,
  createCodexAppServerShadowThreadStartRequest,
  createCodexAppServerShadowTurnInterruptRequest,
  createCodexAppServerShadowTurnStartRequest,
  verifyCodexAppServerGeneratedSchemas,
} = require('../main/agent_runtime/codex_app_server_shadow_protocol');

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function assertErrorCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

assert.strictEqual(
  CODEX_APP_SERVER_SHADOW_PROTOCOL_VERSION,
  'codex-app-server-shadow-protocol.v1'
);
assert.strictEqual(CODEX_APP_SERVER_PINNED_CLI_VERSION, '0.149.0-alpha.4.1');
assert.deepStrictEqual(CODEX_APP_SERVER_SHADOW_TRANSPORT, {
  kind: 'stdio',
  listen: 'stdio://',
  framing: 'jsonl',
  jsonrpcVersion: '2.0',
  includeJsonrpcMember: false,
});
assert.deepStrictEqual(CODEX_APP_SERVER_SHADOW_ALLOWED_METHODS, {
  requests: ['initialize', 'thread/start', 'turn/start', 'turn/interrupt'],
  notifications: ['initialized'],
});
assert.deepStrictEqual(CODEX_APP_SERVER_SHADOW_HANDSHAKE, ['initialize', 'initialized']);
assertDeepFrozen(CODEX_APP_SERVER_SHADOW_TRANSPORT);
assertDeepFrozen(CODEX_APP_SERVER_SHADOW_ALLOWED_METHODS);
assertDeepFrozen(CODEX_APP_SERVER_SHADOW_HANDSHAKE);
assertDeepFrozen(CODEX_APP_SERVER_SCHEMA_MANIFEST);

assert.strictEqual(
  CODEX_APP_SERVER_SCHEMA_MANIFEST.schemaVersion,
  'codex-app-server-generated-schema-manifest.v1'
);
assert.strictEqual(
  CODEX_APP_SERVER_SCHEMA_MANIFEST.codexCliVersion,
  CODEX_APP_SERVER_PINNED_CLI_VERSION
);
assert.strictEqual(
  CODEX_APP_SERVER_SCHEMA_MANIFEST.generatorCommand,
  'codex app-server generate-json-schema --out <directory>'
);
assert.deepStrictEqual(
  CODEX_APP_SERVER_SCHEMA_MANIFEST.artifacts.map((artifact) => artifact.file),
  [
    'codex_app_server_protocol.schemas.json',
    'codex_app_server_protocol.v2.schemas.json',
  ]
);

const schemaVerification = verifyCodexAppServerGeneratedSchemas();
assert.strictEqual(schemaVerification.ok, true);
assert.strictEqual(schemaVerification.codexCliVersion, CODEX_APP_SERVER_PINNED_CLI_VERSION);
assert.strictEqual(schemaVerification.artifacts.length, 2);
assert.deepStrictEqual(
  schemaVerification.artifacts.map(({ title, definitions }) => ({ title, definitions })),
  [
    { title: 'CodexAppServerProtocol', definitions: 82 },
    { title: 'CodexAppServerProtocolV2', definitions: 579 },
  ]
);
assertDeepFrozen(schemaVerification);

assertErrorCode(
  () => verifyCodexAppServerGeneratedSchemas({
    readFileSync(filePath) {
      if (filePath.endsWith('codex_app_server_protocol.v2.schemas.json')) {
        return Buffer.from('{}');
      }
      return fs.readFileSync(filePath);
    },
  }),
  'CODEX_APP_SERVER_SCHEMA_INTEGRITY_FAILED'
);

const initializeRequest = createCodexAppServerInitializeRequest({
  id: 'rpc-initialize-1',
  clientVersion: '0.1.3',
});
assert.deepStrictEqual(initializeRequest, {
  id: 'rpc-initialize-1',
  method: 'initialize',
  params: {
    clientInfo: {
      name: 'faber-code-shadow-harness',
      title: 'Faber Code Shadow Harness',
      version: '0.1.3',
    },
    capabilities: {
      experimentalApi: false,
      requestAttestation: false,
    },
  },
});
assertDeepFrozen(initializeRequest);
assert.strictEqual(
  assertCodexAppServerShadowOutboundMessage(initializeRequest),
  initializeRequest
);

const initializedNotification = createCodexAppServerInitializedNotification();
assert.deepStrictEqual(initializedNotification, { method: 'initialized' });
assertDeepFrozen(initializedNotification);
assert.strictEqual(
  assertCodexAppServerShadowOutboundMessage(initializedNotification),
  initializedNotification
);

const threadStartRequest = createCodexAppServerShadowThreadStartRequest({
  id: 2,
  cwd: '/tmp/faber-shadow-project',
  model: 'gpt-5.6',
});
assert.deepStrictEqual(threadStartRequest, {
  id: 2,
  method: 'thread/start',
  params: {
    cwd: '/tmp/faber-shadow-project',
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: true,
    model: 'gpt-5.6',
  },
});
assertDeepFrozen(threadStartRequest);
assert.strictEqual(
  assertCodexAppServerShadowOutboundMessage(threadStartRequest),
  threadStartRequest
);

const turnStartRequest = createCodexAppServerShadowTurnStartRequest({
  id: 3,
  threadId: 'thread-1',
  cwd: '/tmp/faber-shadow-project',
  prompt: 'Crie apenas um plano; não altere arquivos.',
});
assert.deepStrictEqual(turnStartRequest, {
  id: 3,
  method: 'turn/start',
  params: {
    threadId: 'thread-1',
    input: [{
      type: 'text',
      text: 'Crie apenas um plano; não altere arquivos.',
      text_elements: [],
    }],
    cwd: '/tmp/faber-shadow-project',
    approvalPolicy: 'never',
    sandboxPolicy: {
      type: 'readOnly',
      networkAccess: false,
    },
  },
});
assertDeepFrozen(turnStartRequest);
assert.strictEqual(
  assertCodexAppServerShadowOutboundMessage(turnStartRequest),
  turnStartRequest
);

const interruptRequest = createCodexAppServerShadowTurnInterruptRequest({
  id: 4,
  threadId: 'thread-1',
  turnId: 'turn-1',
});
assert.deepStrictEqual(interruptRequest, {
  id: 4,
  method: 'turn/interrupt',
  params: { threadId: 'thread-1', turnId: 'turn-1' },
});
assertDeepFrozen(interruptRequest);
assert.strictEqual(
  assertCodexAppServerShadowOutboundMessage(interruptRequest),
  interruptRequest
);

for (const method of [
  'thread/shellCommand',
  'command/exec',
  'command/exec/write',
  'fs/writeFile',
  'fs/createDirectory',
  'process/start',
  'config/value/write',
  'mcpServer/tool/call',
  'thread/archive',
  'unknown/read',
]) {
  assertErrorCode(
    () => assertCodexAppServerShadowOutboundMessage({ id: 9, method, params: {} }),
    'CODEX_APP_SERVER_SHADOW_METHOD_BLOCKED'
  );
}

assertErrorCode(
  () => assertCodexAppServerShadowOutboundMessage({
    ...initializeRequest,
    jsonrpc: '2.0',
  }),
  'CODEX_APP_SERVER_SHADOW_INVALID_MESSAGE'
);
assertErrorCode(
  () => assertCodexAppServerShadowOutboundMessage({
    ...initializeRequest,
    params: {
      ...initializeRequest.params,
      capabilities: { experimentalApi: true, requestAttestation: false },
    },
  }),
  'CODEX_APP_SERVER_SHADOW_UNSAFE_PARAMS'
);
assertErrorCode(
  () => assertCodexAppServerShadowOutboundMessage({
    ...threadStartRequest,
    params: { ...threadStartRequest.params, sandbox: 'workspace-write' },
  }),
  'CODEX_APP_SERVER_SHADOW_UNSAFE_PARAMS'
);
assertErrorCode(
  () => assertCodexAppServerShadowOutboundMessage({
    ...threadStartRequest,
    params: { ...threadStartRequest.params, ephemeral: false },
  }),
  'CODEX_APP_SERVER_SHADOW_UNSAFE_PARAMS'
);
assertErrorCode(
  () => assertCodexAppServerShadowOutboundMessage({
    id: 10,
    method: 'thread/start',
    params: null,
  }),
  'CODEX_APP_SERVER_SHADOW_UNSAFE_PARAMS'
);
assertErrorCode(
  () => assertCodexAppServerShadowOutboundMessage({
    ...turnStartRequest,
    params: {
      ...turnStartRequest.params,
      sandboxPolicy: { type: 'readOnly', networkAccess: true },
    },
  }),
  'CODEX_APP_SERVER_SHADOW_UNSAFE_PARAMS'
);
assertErrorCode(
  () => createCodexAppServerShadowThreadStartRequest({
    id: 5,
    cwd: 'relative/project',
  }),
  'CODEX_APP_SERVER_SHADOW_UNSAFE_PARAMS'
);
assertErrorCode(
  () => createCodexAppServerShadowTurnStartRequest({
    id: 6,
    threadId: 'thread-1',
    cwd: '/tmp/faber-shadow-project',
    prompt: '',
  }),
  'CODEX_APP_SERVER_SHADOW_UNSAFE_PARAMS'
);

console.log('codex app server shadow protocol tests passed');
