'use strict';

const childProcess = require('child_process');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const {
  CODEX_APP_SERVER_PINNED_CLI_VERSION,
  CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
  assertCodexAppServerShadowOutboundMessage,
  createCodexAppServerInitializeRequest,
  createCodexAppServerInitializedNotification,
  verifyCodexAppServerGeneratedSchemas,
} = require('../agent_runtime/codex_app_server_shadow_protocol');

const CODEX_APP_SERVER_STDIO_CLIENT_VERSION = 'codex-app-server-stdio-client.v1';
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 5_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_LINE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_PENDING_REQUESTS = 32;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;

const CODEX_APP_SERVER_STDIO_CLIENT_STATES = Object.freeze({
  IDLE: 'idle',
  VERIFYING: 'verifying',
  STARTING: 'starting',
  INITIALIZING: 'initializing',
  READY: 'ready',
  FAILED: 'failed',
  CLOSED: 'closed',
});

const CODEX_APP_SERVER_STDIO_CLIENT_REASONS = Object.freeze({
  CAPACITY_EXCEEDED: 'CODEX_APP_SERVER_CLIENT_CAPACITY_EXCEEDED',
  CLOSED: 'CODEX_APP_SERVER_CLIENT_CLOSED',
  DUPLICATE_REQUEST_ID: 'CODEX_APP_SERVER_CLIENT_DUPLICATE_REQUEST_ID',
  INVALID_PROCESS: 'CODEX_APP_SERVER_CLIENT_INVALID_PROCESS',
  INVALID_SERVER_MESSAGE: 'CODEX_APP_SERVER_CLIENT_INVALID_SERVER_MESSAGE',
  MCP_DISCOVERY_FAILED: 'CODEX_APP_SERVER_CLIENT_MCP_DISCOVERY_FAILED',
  METHOD_NOT_AVAILABLE: 'CODEX_APP_SERVER_CLIENT_METHOD_NOT_AVAILABLE',
  NOT_READY: 'CODEX_APP_SERVER_CLIENT_NOT_READY',
  OUTBOUND_LINE_LIMIT: 'CODEX_APP_SERVER_CLIENT_OUTBOUND_LINE_LIMIT',
  PROCESS_EXITED: 'CODEX_APP_SERVER_CLIENT_PROCESS_EXITED',
  PROCESS_SPAWN_FAILED: 'CODEX_APP_SERVER_CLIENT_PROCESS_SPAWN_FAILED',
  REMOTE_ERROR: 'CODEX_APP_SERVER_CLIENT_REMOTE_ERROR',
  REQUEST_TIMEOUT: 'CODEX_APP_SERVER_CLIENT_REQUEST_TIMEOUT',
  STDIN_WRITE_FAILED: 'CODEX_APP_SERVER_CLIENT_STDIN_WRITE_FAILED',
  UNSUPPORTED_SERVER_REQUEST: 'CODEX_APP_SERVER_CLIENT_UNSUPPORTED_SERVER_REQUEST',
  VERSION_CHECK_FAILED: 'CODEX_APP_SERVER_CLIENT_VERSION_CHECK_FAILED',
  VERSION_MISMATCH: 'CODEX_APP_SERVER_CLIENT_VERSION_MISMATCH',
});

const OPERATIONAL_METHODS = new Set(['thread/start', 'turn/start', 'turn/interrupt']);
const SAFE_MCP_SERVER_NAME = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_MCP_SERVERS = 128;

class CodexAppServerStdioClientError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'CodexAppServerStdioClientError';
    this.code = code;
    if (Number.isSafeInteger(details.remoteCode)) this.remoteCode = details.remoteCode;
    if (Number.isSafeInteger(details.exitCode)) this.exitCode = details.exitCode;
    if (typeof details.signal === 'string' && details.signal) this.signal = details.signal;
  }
}

function clientError(code, details) {
  return new CodexAppServerStdioClientError(code, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== 'string')) {
    return false;
  }
  const expected = [...expectedKeys].sort();
  const actual = [...keys].sort();
  if (actual.some((key, index) => key !== expected[index])) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function freezeJson(value) {
  if (!value || typeof value !== 'object') return value;
  const pending = [value];
  const visited = new Set();
  const objects = [];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    objects.push(current);
    for (const child of Object.values(current)) {
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    Object.freeze(objects[index]);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertAbsolutePath(value, label) {
  assertNonEmptyString(value, label);
  if (value.includes('\0')) throw new TypeError(`${label} must not contain NUL`);
  if (!path.isAbsolute(value)) throw new TypeError(`${label} must be absolute`);
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new TypeError(`${label} is outside its supported bounds`);
  }
  return candidate;
}

function normalizeEnvironment(environment) {
  if (!isPlainObject(environment)) throw new TypeError('environment must be a plain object');
  const output = {};
  for (const key of Reflect.ownKeys(environment)) {
    if (typeof key !== 'string' || !key || key.includes('=') || key.includes('\0')) {
      throw new TypeError('environment contains an invalid key');
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string' || descriptor.value.includes('\0')) {
      throw new TypeError('environment contains an invalid value');
    }
    output[key] = descriptor.value;
  }
  return Object.freeze(output);
}

function createCodexAppServerStdioClient(options = {}) {
  if (!isPlainObject(options)) throw new TypeError('App Server client options are invalid');
  const {
    codexCommand,
    cwd,
    clientVersion,
    environment = { ...process.env },
    execFile = childProcess.execFile,
    spawn = childProcess.spawn,
    requestTimeoutMs,
    versionCheckTimeoutMs,
    closeTimeoutMs,
    maxLineBytes,
    maxPendingRequests,
  } = options;

  assertAbsolutePath(codexCommand, 'codexCommand');
  assertAbsolutePath(cwd, 'cwd');
  assertNonEmptyString(clientVersion, 'clientVersion');
  if (typeof execFile !== 'function') throw new TypeError('execFile must be a function');
  if (typeof spawn !== 'function') throw new TypeError('spawn must be a function');

  const safeEnvironment = normalizeEnvironment(environment);
  const safeRequestTimeoutMs = boundedInteger(
    requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    100,
    120_000,
    'requestTimeoutMs'
  );
  const safeVersionCheckTimeoutMs = boundedInteger(
    versionCheckTimeoutMs,
    DEFAULT_VERSION_CHECK_TIMEOUT_MS,
    100,
    30_000,
    'versionCheckTimeoutMs'
  );
  const safeCloseTimeoutMs = boundedInteger(
    closeTimeoutMs,
    DEFAULT_CLOSE_TIMEOUT_MS,
    50,
    10_000,
    'closeTimeoutMs'
  );
  const safeMaxLineBytes = boundedInteger(
    maxLineBytes,
    DEFAULT_MAX_LINE_BYTES,
    256,
    16 * 1024 * 1024,
    'maxLineBytes'
  );
  const safeMaxPendingRequests = boundedInteger(
    maxPendingRequests,
    DEFAULT_MAX_PENDING_REQUESTS,
    1,
    256,
    'maxPendingRequests'
  );

  let state = CODEX_APP_SERVER_STDIO_CLIENT_STATES.IDLE;
  let verifiedCliVersion = null;
  let isolatedMcpServerNames = null;
  let processRef = null;
  let processExited = true;
  let processExitPromise = null;
  let resolveProcessExit = null;
  let terminationSignalSent = null;
  let startPromise = null;
  let closePromise = null;
  let lastFailure = null;
  let stdoutBuffer = '';
  let stderrBytes = 0;
  let inboundNotifications = 0;
  const stdoutDecoder = new StringDecoder('utf8');
  const pendingRequests = new Map();
  const notificationListeners = new Set();

  function isProcessRunning() {
    return Boolean(
      processRef
      && processExited === false
      && processRef.exitCode === null
      && processRef.killed !== true
      && state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.READY
    );
  }

  function status() {
    return Object.freeze({
      version: CODEX_APP_SERVER_STDIO_CLIENT_VERSION,
      state,
      pinnedCliVersion: CODEX_APP_SERVER_PINNED_CLI_VERSION,
      verifiedCliVersion,
      running: isProcessRunning(),
      pendingRequests: pendingRequests.size,
      inboundNotifications,
      stderrBytes,
      lastFailureCode: lastFailure ? lastFailure.code : null,
    });
  }

  function isolationProfile() {
    return freezeJson({
      version: CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
      complete: isolatedMcpServerNames !== null,
      disabledMcpServerNames: isolatedMcpServerNames === null
        ? []
        : [...isolatedMcpServerNames],
    });
  }

  function endProcessStdin() {
    if (!processRef) return;
    try {
      if (processRef.stdin && typeof processRef.stdin.end === 'function') {
        processRef.stdin.end();
      }
    } catch {
      // Signalling still proceeds when stdin cannot be closed.
    }
  }

  function signalProcess(signal) {
    if (!processRef || processExited || typeof processRef.kill !== 'function') return false;
    if (terminationSignalSent === 'SIGKILL'
      || (terminationSignalSent === 'SIGTERM' && signal === 'SIGTERM')) return true;
    try {
      const signalled = processRef.kill(signal);
      if (signalled === false) return false;
      terminationSignalSent = signal;
      return true;
    } catch {
      return false;
    }
  }

  function markProcessExited() {
    if (processExited) return;
    processExited = true;
    if (resolveProcessExit) resolveProcessExit();
    resolveProcessExit = null;
  }

  function waitForProcessExit(timeoutMs) {
    if (!processRef || processExited || !processExitPromise) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      processExitPromise.then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  function rejectAllPending(error) {
    for (const entry of pendingRequests.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pendingRequests.clear();
  }

  function normalizeFailure(error, fallbackCode) {
    if (error instanceof CodexAppServerStdioClientError) return error;
    if (error && typeof error.code === 'string'
      && error.code.startsWith('CODEX_APP_SERVER_')) return error;
    return clientError(fallbackCode);
  }

  function fail(error, { terminate = true } = {}) {
    const normalized = normalizeFailure(
      error,
      CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE
    );
    if (state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.CLOSED) return normalized;
    if (state !== CODEX_APP_SERVER_STDIO_CLIENT_STATES.FAILED) {
      state = CODEX_APP_SERVER_STDIO_CLIENT_STATES.FAILED;
      lastFailure = normalized;
    }
    rejectAllPending(lastFailure || normalized);
    if (terminate) {
      endProcessStdin();
      signalProcess('SIGTERM');
    }
    return lastFailure || normalized;
  }

  function verifyPinnedCliVersion() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const complete = (error, stdout) => {
        if (settled) return;
        settled = true;
        if (error) {
          reject(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.VERSION_CHECK_FAILED));
          return;
        }
        const match = /^codex-cli\s+([^\s]+)$/.exec(String(stdout || '').trim());
        if (!match || match[1] !== CODEX_APP_SERVER_PINNED_CLI_VERSION) {
          reject(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.VERSION_MISMATCH));
          return;
        }
        resolve(match[1]);
      };
      try {
        Reflect.apply(execFile, null, [
          codexCommand,
          ['--version'],
          {
            cwd,
            env: safeEnvironment,
            encoding: 'utf8',
            maxBuffer: 64 * 1024,
            timeout: safeVersionCheckTimeoutMs,
            windowsHide: true,
            shell: false,
          },
          complete,
        ]);
      } catch {
        complete(new Error('version check failed'), '', '');
      }
    });
  }

  function discoverEnabledMcpServerNames() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const complete = (error, stdout) => {
        if (settled) return;
        settled = true;
        if (error) {
          reject(clientError(
            CODEX_APP_SERVER_STDIO_CLIENT_REASONS.MCP_DISCOVERY_FAILED
          ));
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout || ''));
          if (!Array.isArray(parsed) || parsed.length > MAX_MCP_SERVERS) {
            throw new TypeError('MCP discovery result is invalid');
          }
          const seen = new Set();
          const enabled = [];
          for (const entry of parsed) {
            if (!isPlainObject(entry)) throw new TypeError('MCP entry is invalid');
            const nameDescriptor = Object.getOwnPropertyDescriptor(entry, 'name');
            const enabledDescriptor = Object.getOwnPropertyDescriptor(entry, 'enabled');
            const name = nameDescriptor && nameDescriptor.enumerable === true
              && Object.hasOwn(nameDescriptor, 'value')
              ? nameDescriptor.value
              : null;
            const isEnabled = enabledDescriptor && enabledDescriptor.enumerable === true
              && Object.hasOwn(enabledDescriptor, 'value')
              ? enabledDescriptor.value
              : null;
            if (typeof name !== 'string' || !SAFE_MCP_SERVER_NAME.test(name)
              || typeof isEnabled !== 'boolean' || seen.has(name)) {
              throw new TypeError('MCP entry is invalid');
            }
            seen.add(name);
            if (isEnabled) enabled.push(name);
          }
          resolve(Object.freeze(enabled.sort()));
        } catch {
          reject(clientError(
            CODEX_APP_SERVER_STDIO_CLIENT_REASONS.MCP_DISCOVERY_FAILED
          ));
        }
      };
      try {
        Reflect.apply(execFile, null, [
          codexCommand,
          ['mcp', 'list', '--json'],
          {
            cwd,
            env: safeEnvironment,
            encoding: 'utf8',
            maxBuffer: 256 * 1024,
            timeout: safeVersionCheckTimeoutMs,
            windowsHide: true,
            shell: false,
          },
          complete,
        ]);
      } catch {
        complete(new Error('MCP discovery failed'), '', '');
      }
    });
  }

  function validateProcess(child) {
    return Boolean(
      child
      && typeof child.on === 'function'
      && child.stdin
      && typeof child.stdin.write === 'function'
      && typeof child.stdin.on === 'function'
      && child.stdout
      && typeof child.stdout.on === 'function'
      && child.stderr
      && typeof child.stderr.on === 'function'
    );
  }

  function handleServerResponse(message) {
    const hasResult = Object.hasOwn(message, 'result');
    const hasError = Object.hasOwn(message, 'error');
    const expectedKeys = hasResult ? ['id', 'result'] : ['id', 'error'];
    if (hasResult === hasError || !hasExactDataKeys(message, expectedKeys)) {
      fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE));
      return;
    }
    if (!pendingRequests.has(message.id)) {
      fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE));
      return;
    }
    const entry = pendingRequests.get(message.id);
    pendingRequests.delete(message.id);
    clearTimeout(entry.timer);
    if (hasError) {
      const remote = message.error;
      if (!isPlainObject(remote)
        || !Number.isSafeInteger(remote.code)
        || typeof remote.message !== 'string') {
        const error = clientError(
          CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE
        );
        entry.reject(error);
        fail(error);
        return;
      }
      entry.reject(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.REMOTE_ERROR, {
        remoteCode: remote.code,
      }));
      return;
    }
    entry.resolve(freezeJson(message.result));
  }

  function handleServerNotification(message) {
    const expectedKeys = ['method'];
    if (Object.hasOwn(message, 'params')) expectedKeys.push('params');
    if (Object.hasOwn(message, 'emittedAtMs')) expectedKeys.push('emittedAtMs');
    if (!hasExactDataKeys(message, expectedKeys)
      || typeof message.method !== 'string'
      || !message.method.trim()
      || (Object.hasOwn(message, 'emittedAtMs')
        && (!Number.isSafeInteger(message.emittedAtMs) || message.emittedAtMs < 0))) {
      fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE));
      return;
    }
    const frozen = freezeJson(message);
    inboundNotifications += 1;
    for (const listener of [...notificationListeners]) {
      try {
        Reflect.apply(listener, null, [frozen]);
      } catch {
        // An observer cannot break the transport lifecycle.
      }
    }
  }

  function handleServerLine(line) {
    if (!line.trim()) return;
    if (Buffer.byteLength(line, 'utf8') > safeMaxLineBytes) {
      fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE));
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE));
      return;
    }
    if (!isPlainObject(message) || Object.hasOwn(message, 'jsonrpc')) {
      fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE));
      return;
    }
    const hasId = Object.hasOwn(message, 'id');
    const hasMethod = Object.hasOwn(message, 'method');
    if (hasId && hasMethod) {
      fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.UNSUPPORTED_SERVER_REQUEST));
      return;
    }
    if (hasId) {
      handleServerResponse(message);
      return;
    }
    if (hasMethod) {
      handleServerNotification(message);
      return;
    }
    fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE));
  }

  function handleStdout(chunk) {
    if ([
      CODEX_APP_SERVER_STDIO_CLIENT_STATES.CLOSED,
      CODEX_APP_SERVER_STDIO_CLIENT_STATES.FAILED,
    ].includes(state)) return;
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8');
      stdoutBuffer += stdoutDecoder.write(bytes);
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const rawLine = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        handleServerLine(line);
        if (state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.FAILED) return;
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
      if (Buffer.byteLength(stdoutBuffer, 'utf8') > safeMaxLineBytes) {
        fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE));
      }
    } catch {
      fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_SERVER_MESSAGE));
    }
  }

  function handleStderr(chunk) {
    let bytes = 0;
    try {
      bytes = Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(String(chunk || ''), 'utf8');
    } catch {
      bytes = 0;
    }
    stderrBytes = Math.min(MAX_DIAGNOSTIC_BYTES, stderrBytes + bytes);
  }

  function attachProcess(child) {
    processRef = child;
    processExited = false;
    terminationSignalSent = null;
    processExitPromise = new Promise((resolve) => {
      resolveProcessExit = resolve;
    });
    child.stdin.on('error', () => {
      if ([
        CODEX_APP_SERVER_STDIO_CLIENT_STATES.CLOSED,
        CODEX_APP_SERVER_STDIO_CLIENT_STATES.FAILED,
      ].includes(state)) return;
      fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.STDIN_WRITE_FAILED));
    });
    child.stdout.on('data', handleStdout);
    child.stderr.on('data', handleStderr);
    child.on('error', () => {
      markProcessExited();
      fail(
        clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.PROCESS_EXITED),
        { terminate: false }
      );
    });
    child.on('exit', (code, signal) => {
      markProcessExited();
      if ([
        CODEX_APP_SERVER_STDIO_CLIENT_STATES.CLOSED,
        CODEX_APP_SERVER_STDIO_CLIENT_STATES.FAILED,
      ].includes(state)) return;
      fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.PROCESS_EXITED, {
        exitCode: code,
        signal,
      }), { terminate: false });
    });
  }

  function spawnServer() {
    let child;
    try {
      child = Reflect.apply(spawn, null, [
        codexCommand,
        ['app-server', '--listen', 'stdio://'],
        {
          cwd,
          env: safeEnvironment,
          shell: false,
          detached: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      ]);
    } catch {
      throw clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.PROCESS_SPAWN_FAILED);
    }
    if (!validateProcess(child)) {
      if (child && typeof child.kill === 'function') {
        try { child.kill('SIGTERM'); } catch { /* Best-effort invalid child cleanup. */ }
      }
      throw clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.INVALID_PROCESS);
    }
    attachProcess(child);
  }

  function writeJsonLine(message) {
    if (state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.CLOSED) {
      return Promise.reject(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.CLOSED));
    }
    if (state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.FAILED) {
      return Promise.reject(lastFailure);
    }
    let line;
    try {
      line = `${JSON.stringify(message)}\n`;
    } catch {
      return Promise.reject(clientError(
        CODEX_APP_SERVER_STDIO_CLIENT_REASONS.STDIN_WRITE_FAILED
      ));
    }
    if (Buffer.byteLength(line, 'utf8') > safeMaxLineBytes) {
      return Promise.reject(clientError(
        CODEX_APP_SERVER_STDIO_CLIENT_REASONS.OUTBOUND_LINE_LIMIT
      ));
    }
    if (!processRef || processExited || processRef.exitCode !== null
      || processRef.stdin.writableEnded === true
      || processRef.stdin.destroyed === true) {
      return Promise.reject(clientError(
        CODEX_APP_SERVER_STDIO_CLIENT_REASONS.PROCESS_EXITED
      ));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.STDIN_WRITE_FAILED));
      }, safeRequestTimeoutMs);
      const complete = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.STDIN_WRITE_FAILED));
          return;
        }
        resolve();
      };
      try {
        processRef.stdin.write(line, 'utf8', complete);
      } catch {
        complete(new Error('stdin write failed'));
      }
    });
  }

  function dispatchRequest(message) {
    if (pendingRequests.has(message.id)) {
      return Promise.reject(clientError(
        CODEX_APP_SERVER_STDIO_CLIENT_REASONS.DUPLICATE_REQUEST_ID
      ));
    }
    if (pendingRequests.size >= safeMaxPendingRequests) {
      return Promise.reject(clientError(
        CODEX_APP_SERVER_STDIO_CLIENT_REASONS.CAPACITY_EXCEEDED
      ));
    }
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pendingRequests.has(message.id)) return;
        fail(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.REQUEST_TIMEOUT));
      }, safeRequestTimeoutMs);
      pendingRequests.set(message.id, { resolve, reject, timer });
    });
    writeJsonLine(message).catch((error) => fail(error));
    return response;
  }

  async function performStart() {
    state = CODEX_APP_SERVER_STDIO_CLIENT_STATES.VERIFYING;
    verifyCodexAppServerGeneratedSchemas();
    verifiedCliVersion = await verifyPinnedCliVersion();
    isolatedMcpServerNames = await discoverEnabledMcpServerNames();
    if (state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.CLOSED) {
      throw clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.CLOSED);
    }

    state = CODEX_APP_SERVER_STDIO_CLIENT_STATES.STARTING;
    spawnServer();
    state = CODEX_APP_SERVER_STDIO_CLIENT_STATES.INITIALIZING;
    const initializeRequest = createCodexAppServerInitializeRequest({
      id: 0,
      clientVersion,
    });
    const initializeResult = await dispatchRequest(initializeRequest);
    if (state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.CLOSED) {
      throw clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.CLOSED);
    }
    if (state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.FAILED) throw lastFailure;
    await writeJsonLine(createCodexAppServerInitializedNotification());
    if (state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.CLOSED) {
      throw clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.CLOSED);
    }
    if (state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.FAILED) throw lastFailure;

    state = CODEX_APP_SERVER_STDIO_CLIENT_STATES.READY;
    const readyReceipt = freezeJson({
      ok: true,
      clientVersion,
      codexCliVersion: verifiedCliVersion,
      initializeResult,
    });
    return readyReceipt;
  }

  function start() {
    if (state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.CLOSED) {
      return Promise.reject(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.CLOSED));
    }
    if (state === CODEX_APP_SERVER_STDIO_CLIENT_STATES.FAILED) {
      return Promise.reject(lastFailure);
    }
    if (startPromise) return startPromise;
    startPromise = performStart().catch((error) => {
      const normalized = normalizeFailure(
        error,
        CODEX_APP_SERVER_STDIO_CLIENT_REASONS.PROCESS_SPAWN_FAILED
      );
      if (![CODEX_APP_SERVER_STDIO_CLIENT_STATES.CLOSED,
        CODEX_APP_SERVER_STDIO_CLIENT_STATES.FAILED].includes(state)) {
        fail(normalized);
      }
      throw normalized;
    });
    return startPromise;
  }

  function request(message) {
    try {
      assertCodexAppServerShadowOutboundMessage(message);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!OPERATIONAL_METHODS.has(message.method)) {
      return Promise.reject(clientError(
        CODEX_APP_SERVER_STDIO_CLIENT_REASONS.METHOD_NOT_AVAILABLE
      ));
    }
    if (state !== CODEX_APP_SERVER_STDIO_CLIENT_STATES.READY) {
      return Promise.reject(clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.NOT_READY));
    }
    return dispatchRequest(message);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('notification listener is invalid');
    notificationListeners.add(listener);
    const unsubscribe = () => notificationListeners.delete(listener);
    return Object.freeze(unsubscribe);
  }

  async function performClose() {
    state = CODEX_APP_SERVER_STDIO_CLIENT_STATES.CLOSED;
    const error = clientError(CODEX_APP_SERVER_STDIO_CLIENT_REASONS.CLOSED);
    rejectAllPending(error);
    notificationListeners.clear();
    endProcessStdin();

    if (!processRef || processExited) {
      return Object.freeze({
        ok: true,
        closed: true,
        processTerminated: false,
        forced: false,
        exited: true,
      });
    }

    let processTerminated = signalProcess('SIGTERM');
    let exited = await waitForProcessExit(safeCloseTimeoutMs);
    let forced = false;
    if (!exited) {
      forced = signalProcess('SIGKILL');
      processTerminated = processTerminated || forced;
      exited = await waitForProcessExit(safeCloseTimeoutMs);
    }
    return Object.freeze({
      ok: exited,
      closed: true,
      processTerminated,
      forced,
      exited,
    });
  }

  function close() {
    if (!closePromise) closePromise = performClose();
    return closePromise;
  }

  return Object.freeze({ close, isolationProfile, request, start, status, subscribe });
}

module.exports = {
  CODEX_APP_SERVER_STDIO_CLIENT_REASONS,
  CODEX_APP_SERVER_STDIO_CLIENT_STATES,
  CODEX_APP_SERVER_STDIO_CLIENT_VERSION,
  CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
  CodexAppServerStdioClientError,
  createCodexAppServerStdioClient,
};
