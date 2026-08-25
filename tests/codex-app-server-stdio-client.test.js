'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');

const {
  CODEX_APP_SERVER_PINNED_CLI_VERSION,
  createCodexAppServerShadowThreadStartRequest,
} = require('../main/agent_runtime/codex_app_server_shadow_protocol');
const {
  CODEX_APP_SERVER_STDIO_CLIENT_REASONS,
  CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
  CODEX_APP_SERVER_STDIO_CLIENT_STATES,
  CODEX_APP_SERVER_STDIO_CLIENT_VERSION,
  createCodexAppServerStdioClient,
} = require('../main/services/codex_app_server_stdio_client');

const CODEX_COMMAND = '/opt/faber/bin/codex';
const PROJECT_ROOT = '/tmp/faber-shadow-project';
const CLIENT_VERSION = '0.1.3';

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function assertReason(error, reason) {
  return error && error.code === reason;
}

class FakeReadable extends EventEmitter {
  constructor() {
    super();
    this.encoding = null;
  }

  setEncoding(encoding) {
    this.encoding = encoding;
  }
}

function emitJson(child, message, splitAt = null) {
  const line = `${JSON.stringify(message)}\n`;
  if (!Number.isSafeInteger(splitAt) || splitAt <= 0 || splitAt >= line.length) {
    child.stdout.emit('data', Buffer.from(line));
    return;
  }
  child.stdout.emit('data', Buffer.from(line.slice(0, splitAt)));
  child.stdout.emit('data', Buffer.from(line.slice(splitAt)));
}

function createProcessHarness({
  versionOutput = `codex-cli ${CODEX_APP_SERVER_PINNED_CLI_VERSION}\n`,
  versionError = null,
  mcpListOutput = '[]',
  mcpListError = null,
  onMessage = null,
} = {}) {
  const calls = {
    execFile: [],
    spawn: [],
    children: [],
  };

  function execFile(command, args, options, callback) {
    calls.execFile.push({ command, args, options });
    const isVersion = args.length === 1 && args[0] === '--version';
    queueMicrotask(() => callback(
      isVersion ? versionError : mcpListError,
      isVersion ? versionOutput : mcpListOutput,
      ''
    ));
    return { pid: 101 };
  }

  function spawn(command, args, options) {
    const child = new EventEmitter();
    child.stdout = new FakeReadable();
    child.stderr = new FakeReadable();
    child.exitCode = null;
    child.killed = false;
    child.killSignals = [];
    child.writes = [];
    child.stdin = new EventEmitter();
    child.stdin.ended = false;
    child.stdin.write = function write(value, encoding, callback) {
        child.writes.push({ value, encoding });
        const message = JSON.parse(String(value).trim());
        queueMicrotask(() => callback(null));
        queueMicrotask(() => {
          const handled = typeof onMessage === 'function'
            ? onMessage({ child, message, emitJson }) === true
            : false;
          if (handled) return;
          if (message.method === 'initialize') {
            emitJson(child, {
              id: message.id,
              result: {
                userAgent: 'codex-test-agent',
                platformFamily: 'unix',
                platformOs: 'macos',
              },
            }, 17);
          }
        });
        return true;
    };
    child.stdin.end = function end() {
      this.ended = true;
    };
    child.kill = (signal) => {
      child.killSignals.push(signal);
      child.killed = true;
      child.exitCode = 0;
      queueMicrotask(() => child.emit('exit', 0, signal));
      return true;
    };
    calls.spawn.push({ command, args, options });
    calls.children.push(child);
    return child;
  }

  return { calls, execFile, spawn };
}

function createClient(harness, overrides = {}) {
  return createCodexAppServerStdioClient({
    codexCommand: CODEX_COMMAND,
    cwd: PROJECT_ROOT,
    clientVersion: CLIENT_VERSION,
    environment: { FABER_CODEX_TEST: '1' },
    execFile: harness.execFile,
    spawn: harness.spawn,
    requestTimeoutMs: 1000,
    ...overrides,
  });
}

async function testHappyPath() {
  const notifications = [];
  const harness = createProcessHarness({
    onMessage({ child, message, emitJson: emit }) {
      if (message.method !== 'thread/start') return false;
      queueMicrotask(() => {
        emit(child, {
          method: 'thread/started',
          params: { thread: { id: 'thread-shadow-1' } },
          emittedAtMs: 1787597271241,
        });
        emit(child, {
          id: message.id,
          result: { thread: { id: 'thread-shadow-1' } },
        }, 11);
      });
      return true;
    },
  });
  const client = createClient(harness);

  assert.strictEqual(CODEX_APP_SERVER_STDIO_CLIENT_VERSION, 'codex-app-server-stdio-client.v1');
  assert.deepStrictEqual(CODEX_APP_SERVER_STDIO_CLIENT_STATES, {
    IDLE: 'idle',
    VERIFYING: 'verifying',
    STARTING: 'starting',
    INITIALIZING: 'initializing',
    READY: 'ready',
    FAILED: 'failed',
    CLOSED: 'closed',
  });
  assertDeepFrozen(CODEX_APP_SERVER_STDIO_CLIENT_STATES);
  assertDeepFrozen(CODEX_APP_SERVER_STDIO_CLIENT_REASONS);
  assert.strictEqual(Object.isFrozen(client), true);
  assert.deepStrictEqual(client.isolationProfile(), {
    version: CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
    complete: false,
    disabledMcpServerNames: [],
  });
  assertDeepFrozen(client.isolationProfile());
  assert.deepStrictEqual(client.status(), {
    version: CODEX_APP_SERVER_STDIO_CLIENT_VERSION,
    state: 'idle',
    pinnedCliVersion: CODEX_APP_SERVER_PINNED_CLI_VERSION,
    verifiedCliVersion: null,
    running: false,
    pendingRequests: 0,
    inboundNotifications: 0,
    stderrBytes: 0,
    lastFailureCode: null,
  });

  const unsubscribe = client.subscribe((notification) => notifications.push(notification));
  assert.strictEqual(Object.isFrozen(unsubscribe), true);
  const threadRequest = createCodexAppServerShadowThreadStartRequest({
    id: 1,
    cwd: PROJECT_ROOT,
  });
  await assert.rejects(
    client.request(threadRequest),
    (error) => assertReason(error, CODEX_APP_SERVER_STDIO_CLIENT_REASONS.NOT_READY)
  );

  const firstStart = client.start();
  const secondStart = client.start();
  assert.strictEqual(secondStart, firstStart);
  const readiness = await firstStart;
  assert.deepStrictEqual(readiness, {
    ok: true,
    clientVersion: CLIENT_VERSION,
    codexCliVersion: CODEX_APP_SERVER_PINNED_CLI_VERSION,
    initializeResult: {
      userAgent: 'codex-test-agent',
      platformFamily: 'unix',
      platformOs: 'macos',
    },
  });
  assertDeepFrozen(readiness);
  assert.strictEqual(await client.start(), readiness);

  assert.strictEqual(harness.calls.execFile.length, 2);
  assert.deepStrictEqual(harness.calls.execFile[0].args, ['--version']);
  assert.deepStrictEqual(harness.calls.execFile[1].args, ['mcp', 'list', '--json']);
  assert.strictEqual(harness.calls.execFile[0].command, CODEX_COMMAND);
  assert.strictEqual(harness.calls.execFile[0].options.shell, false);
  assert.strictEqual(harness.calls.execFile[0].options.cwd, PROJECT_ROOT);
  assert.deepStrictEqual(harness.calls.execFile[0].options.env, { FABER_CODEX_TEST: '1' });
  assert.deepStrictEqual(client.isolationProfile(), {
    version: CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
    complete: true,
    disabledMcpServerNames: [],
  });
  assertDeepFrozen(client.isolationProfile());
  assert.strictEqual(harness.calls.spawn.length, 1);
  assert.strictEqual(harness.calls.spawn[0].command, CODEX_COMMAND);
  assert.deepStrictEqual(
    harness.calls.spawn[0].args,
    ['app-server', '--listen', 'stdio://']
  );
  assert.deepStrictEqual(harness.calls.spawn[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.strictEqual(harness.calls.spawn[0].options.shell, false);
  assert.strictEqual(harness.calls.spawn[0].options.detached, false);
  assert.strictEqual(harness.calls.children[0].stdout.encoding, null);
  assert.strictEqual(harness.calls.children[0].stderr.encoding, null);

  const handshake = harness.calls.children[0].writes.map(({ value }) => JSON.parse(value));
  assert.deepStrictEqual(handshake.map((message) => message.method), [
    'initialize',
    'initialized',
  ]);
  assert.strictEqual(Object.hasOwn(handshake[0], 'jsonrpc'), false);
  assert.strictEqual(Object.hasOwn(handshake[1], 'jsonrpc'), false);
  assert.strictEqual(handshake[0].id, 0);

  await assert.rejects(
    client.request({ id: 9, method: 'command/exec', params: {} }),
    (error) => error && error.code === 'CODEX_APP_SERVER_SHADOW_METHOD_BLOCKED'
  );
  const result = await client.request(threadRequest);
  assert.deepStrictEqual(result, { thread: { id: 'thread-shadow-1' } });
  assertDeepFrozen(result);
  assert.strictEqual(notifications.length, 1);
  assert.deepStrictEqual(notifications[0], {
    method: 'thread/started',
    params: { thread: { id: 'thread-shadow-1' } },
    emittedAtMs: 1787597271241,
  });
  assertDeepFrozen(notifications[0]);
  assert.strictEqual(unsubscribe(), true);

  assert.deepStrictEqual(client.status(), {
    version: CODEX_APP_SERVER_STDIO_CLIENT_VERSION,
    state: 'ready',
    pinnedCliVersion: CODEX_APP_SERVER_PINNED_CLI_VERSION,
    verifiedCliVersion: CODEX_APP_SERVER_PINNED_CLI_VERSION,
    running: true,
    pendingRequests: 0,
    inboundNotifications: 1,
    stderrBytes: 0,
    lastFailureCode: null,
  });
  const firstClose = client.close();
  const secondClose = client.close();
  assert.strictEqual(secondClose, firstClose);
  assert.deepStrictEqual(await firstClose, {
    ok: true,
    closed: true,
    processTerminated: true,
    forced: false,
    exited: true,
  });
  assert.strictEqual(harness.calls.children[0].stdin.ended, true);
  assert.deepStrictEqual(harness.calls.children[0].killSignals, ['SIGTERM']);
  assert.deepStrictEqual(await secondClose, await firstClose);
}

async function testPinnedVersionMismatchFailsBeforeSpawn() {
  const harness = createProcessHarness({ versionOutput: 'codex-cli 0.150.0\n' });
  const client = createClient(harness);
  await assert.rejects(
    client.start(),
    (error) => assertReason(error, CODEX_APP_SERVER_STDIO_CLIENT_REASONS.VERSION_MISMATCH)
  );
  assert.strictEqual(harness.calls.spawn.length, 0);
  assert.strictEqual(client.status().state, 'failed');
  assert.strictEqual(
    client.status().lastFailureCode,
    CODEX_APP_SERVER_STDIO_CLIENT_REASONS.VERSION_MISMATCH
  );
  await client.close();
}

async function testEnabledMcpDiscoveryIsCompleteAndFailsClosed() {
  const harness = createProcessHarness({
    mcpListOutput: JSON.stringify([
      { name: 'disabled-server', enabled: false },
      { name: 'node_repl', enabled: true },
      { name: 'figma', enabled: true },
    ]),
  });
  const client = createClient(harness);
  await client.start();
  assert.deepStrictEqual(client.isolationProfile(), {
    version: CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
    complete: true,
    disabledMcpServerNames: ['figma', 'node_repl'],
  });
  await client.close();

  for (const fixture of [
    { mcpListError: new Error('private MCP config path') },
    { mcpListOutput: '{not-json' },
    { mcpListOutput: JSON.stringify([{ name: '../unsafe', enabled: true }]) },
  ]) {
    const failedHarness = createProcessHarness(fixture);
    const failedClient = createClient(failedHarness);
    await assert.rejects(
      failedClient.start(),
      (error) => assertReason(
        error,
        CODEX_APP_SERVER_STDIO_CLIENT_REASONS.MCP_DISCOVERY_FAILED
      )
    );
    assert.strictEqual(failedHarness.calls.spawn.length, 0);
    assert.strictEqual(failedClient.isolationProfile().complete, false);
    await failedClient.close();
  }
}

async function testExitAfterInitializeResponseSkipsInitializedWrite() {
  const harness = createProcessHarness({
    onMessage({ child, message, emitJson: emit }) {
      if (message.method !== 'initialize') return false;
      queueMicrotask(() => {
        emit(child, {
          id: message.id,
          result: {
            userAgent: 'codex-exiting-agent',
            platformFamily: 'unix',
            platformOs: 'macos',
          },
        });
        child.exitCode = 0;
        child.emit('exit', 0, null);
      });
      return true;
    },
  });
  const client = createClient(harness);
  await assert.rejects(
    client.start(),
    (error) => assertReason(error, CODEX_APP_SERVER_STDIO_CLIENT_REASONS.PROCESS_EXITED)
  );
  const methods = harness.calls.children[0].writes.map(({ value }) => JSON.parse(value).method);
  assert.deepStrictEqual(methods, ['initialize']);
  await client.close();
}

async function testStdinErrorIsContainedAndFailsClosed() {
  const harness = createProcessHarness();
  const client = createClient(harness);
  await client.start();
  const child = harness.calls.children[0];
  assert.doesNotThrow(() => child.stdin.emit('error', new Error('pipe closed')));
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.strictEqual(client.status().state, 'failed');
  assert.strictEqual(
    client.status().lastFailureCode,
    CODEX_APP_SERVER_STDIO_CLIENT_REASONS.STDIN_WRITE_FAILED
  );
  await client.close();
}

async function testInvalidJsonFailsClosed() {
  const harness = createProcessHarness({
    onMessage({ child, message }) {
      if (message.method !== 'thread/start') return false;
      queueMicrotask(() => child.stdout.emit('data', Buffer.from('not-json\n')));
      return true;
    },
  });
  const client = createClient(harness);
  await client.start();
  const request = createCodexAppServerShadowThreadStartRequest({
    id: 11,
    cwd: PROJECT_ROOT,
  });
  await assert.rejects(
    client.request(request),
    (error) => assertReason(
      error,
      CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE
    )
  );
  assert.strictEqual(client.status().state, 'failed');
  assert.deepStrictEqual(harness.calls.children[0].killSignals, ['SIGTERM']);
  await client.close();
}

async function testInvalidNotificationEnvelopeFailsClosed() {
  const invalidNotifications = [
    {
      method: 'thread/started',
      params: { thread: { id: 'thread-shadow-invalid-time' } },
      emittedAtMs: 1.5,
    },
    {
      method: 'thread/started',
      params: { thread: { id: 'thread-shadow-extra-key' } },
      emittedAtMs: 1787597271241,
      unexpected: true,
    },
  ];

  for (const [index, notification] of invalidNotifications.entries()) {
    const harness = createProcessHarness({
      onMessage({ child, message, emitJson: emit }) {
        if (message.method !== 'thread/start') return false;
        queueMicrotask(() => emit(child, notification));
        return true;
      },
    });
    const client = createClient(harness);
    await client.start();
    const request = createCodexAppServerShadowThreadStartRequest({
      id: 40 + index,
      cwd: PROJECT_ROOT,
    });
    await assert.rejects(
      client.request(request),
      (error) => assertReason(
        error,
        CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE
      )
    );
    assert.strictEqual(client.status().state, 'failed');
    assert.deepStrictEqual(harness.calls.children[0].killSignals, ['SIGTERM']);
    await client.close();
  }
}

async function testServerInitiatedRequestFailsClosed() {
  const harness = createProcessHarness({
    onMessage({ child, message, emitJson: emit }) {
      if (message.method !== 'thread/start') return false;
      queueMicrotask(() => emit(child, {
        id: 'server-approval-1',
        method: 'item/commandExecution/requestApproval',
        params: { command: 'git status' },
      }));
      return true;
    },
  });
  const client = createClient(harness);
  await client.start();
  const request = createCodexAppServerShadowThreadStartRequest({
    id: 12,
    cwd: PROJECT_ROOT,
  });
  await assert.rejects(
    client.request(request),
    (error) => assertReason(
      error,
      CODEX_APP_SERVER_STDIO_CLIENT_REASONS.UNSUPPORTED_SERVER_REQUEST
    )
  );
  assert.strictEqual(client.status().state, 'failed');
  assert.deepStrictEqual(harness.calls.children[0].killSignals, ['SIGTERM']);
  await client.close();
}

async function testDuplicateIdsAndCloseRejectPending() {
  const harness = createProcessHarness({
    onMessage({ message }) {
      return message.method === 'thread/start';
    },
  });
  const client = createClient(harness);
  await client.start();
  const request = createCodexAppServerShadowThreadStartRequest({
    id: 22,
    cwd: PROJECT_ROOT,
  });
  const pending = client.request(request);
  await assert.rejects(
    client.request(request),
    (error) => assertReason(
      error,
      CODEX_APP_SERVER_STDIO_CLIENT_REASONS.DUPLICATE_REQUEST_ID
    )
  );
  const closing = client.close();
  await assert.rejects(
    pending,
    (error) => assertReason(error, CODEX_APP_SERVER_STDIO_CLIENT_REASONS.CLOSED)
  );
  await closing;
}

async function testOutboundLineLimitFailsClosed() {
  const harness = createProcessHarness();
  const client = createClient(harness, { maxLineBytes: 512 });
  await client.start();
  const request = createCodexAppServerShadowThreadStartRequest({
    id: 33,
    cwd: PROJECT_ROOT,
    model: 'm'.repeat(1024),
  });
  await assert.rejects(
    client.request(request),
    (error) => assertReason(
      error,
      CODEX_APP_SERVER_STDIO_CLIENT_REASONS.OUTBOUND_LINE_LIMIT
    )
  );
  assert.strictEqual(client.status().state, 'failed');
  await client.close();
}

async function run() {
  const defaultEnvironmentHarness = createProcessHarness();
  const defaultEnvironmentClient = createCodexAppServerStdioClient({
    codexCommand: CODEX_COMMAND,
    cwd: PROJECT_ROOT,
    clientVersion: CLIENT_VERSION,
    execFile: defaultEnvironmentHarness.execFile,
    spawn: defaultEnvironmentHarness.spawn,
  });
  assert.strictEqual(defaultEnvironmentClient.status().state, 'idle');
  await defaultEnvironmentClient.close();

  assert.throws(
    () => createCodexAppServerStdioClient({
      codexCommand: 'codex',
      cwd: PROJECT_ROOT,
      clientVersion: CLIENT_VERSION,
    }),
    /absolute/i
  );
  assert.throws(
    () => createCodexAppServerStdioClient({
      codexCommand: CODEX_COMMAND,
      cwd: 'relative/project',
      clientVersion: CLIENT_VERSION,
    }),
    /absolute/i
  );
  assert.throws(
    () => createCodexAppServerStdioClient({
      codexCommand: `/opt/faber/bin/co\0dex`,
      cwd: PROJECT_ROOT,
      clientVersion: CLIENT_VERSION,
    }),
    /NUL/i
  );

  await testHappyPath();
  await testPinnedVersionMismatchFailsBeforeSpawn();
  await testEnabledMcpDiscoveryIsCompleteAndFailsClosed();
  await testExitAfterInitializeResponseSkipsInitializedWrite();
  await testStdinErrorIsContainedAndFailsClosed();
  await testInvalidJsonFailsClosed();
  await testInvalidNotificationEnvelopeFailsClosed();
  await testServerInitiatedRequestFailsClosed();
  await testDuplicateIdsAndCloseRejectPending();
  await testOutboundLineLimitFailsClosed();
  console.log('codex app server stdio client tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
