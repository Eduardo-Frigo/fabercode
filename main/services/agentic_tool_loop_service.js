const util = require('util');

function defaultClipText(value = '', maxChars = 12000) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function actionRequiresFileChanges(action = {}) {
  const route = action.routeDecision || {};
  const productRoute = route.productRoute || {};
  const text = `${action.userMessage || ''} ${route.executionMessage || ''}`.toLowerCase();
  return (
    productRoute.capability === 'create_project' ||
    productRoute.executionIntent === 'init_project' ||
    productRoute.capability === 'edit_project' ||
    productRoute.executionIntent === 'edit_project' ||
    /\b(criar|crie|gerar|gere|implementar|implemente|arquivos|projeto|app|site|escrever|alterar|altere|modificar|modifique|adicionar|adicione)\b/.test(text)
  );
}

const AGENTIC_EXECUTION_CANCELLED_CODE = 'AGENTIC_EXECUTION_CANCELLED';
const AGENTIC_PROCESS_VALIDATION_PENDING_MESSAGE =
  'Tarefa encerrada. Lint, testes e build não foram executados e o preview não foi capturado; essas validações permanecem pendentes até existir um sandbox portátil.';
const AGENTIC_FAILURE_VALIDATION_PENDING_MESSAGE =
  'Tarefa encerrada como falha. Lint, testes e build não foram executados e o preview não foi capturado; essas validações permanecem pendentes.';
const AGENTIC_MODEL_TEXT_CHECKPOINT_MESSAGE =
  'Resposta textual do modelo recebida; conteúdo omitido. Validações de processo permanecem pendentes.';
const AGENTIC_PROCESS_EXECUTION_POLICIES = Object.freeze({
  BROKERED: 'brokered',
  SUSPENDED: 'suspended',
});
const RUN_COMMAND_MAX_ARGS = 128;
const RUN_COMMAND_MAX_ARG_LENGTH = 8192;
const RUN_COMMAND_MAX_COMMAND_LENGTH = 4096;
const RUN_COMMAND_MIN_TIMEOUT_MS = 1000;
const RUN_COMMAND_MAX_TIMEOUT_MS = 600000;
const READ_COMMAND_OUTPUT_MAX_BYTES = 1024 * 1024;
const WAIT_COMMAND_MAX_TIMEOUT_MS = 60000;
const PROCESS_OUTPUT_STREAMS = new Set(['stdout', 'stderr', 'system']);
const RUN_COMMAND_PUBLIC_STATUSES = new Set([
  'running',
  'succeeded',
  'failed',
  'stopped',
  'timed_out',
]);
const RUN_COMMAND_SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

class AgenticExecutionCancelledError extends Error {
  constructor(phase = 'agentic_execution') {
    super('A execução agentic foi cancelada antes de concluir a operação atual.');
    this.name = 'AgenticExecutionCancelledError';
    this.code = AGENTIC_EXECUTION_CANCELLED_CODE;
    this.status = 'cancelled';
    this.cancelled = true;
    this.phase = String(phase || 'agentic_execution');
  }
}

function isSignalAborted(signal = null) {
  return Boolean(signal && signal.aborted);
}

function throwIfExecutionCancelled(signal = null, phase = 'agentic_execution') {
  if (isSignalAborted(signal)) {
    throw new AgenticExecutionCancelledError(phase);
  }
}

function isAgenticExecutionCancelledError(error = null) {
  return Boolean(
    error
      && (
        error instanceof AgenticExecutionCancelledError
        || error.code === AGENTIC_EXECUTION_CANCELLED_CODE
      )
  );
}

const DELETE_PATHS_TOOL_MAX_PATHS = 32;
const DELETE_PATHS_TOOL_MAX_REASON_LENGTH = 1000;
const DELETE_PATHS_TOOL_MAX_PATH_LENGTH = 4096;
const DELETE_PATHS_SAFE_STATES = new Set([
  'PREPARING',
  'PREPARED',
  'APPLYING',
  'COMMITTED',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'PURGING',
  'PURGED',
  'RECOVERY_PRE_COMMIT',
  'RECOVERY_POST_COMMIT',
]);
const DELETE_PATHS_SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const DOMAIN_READ_SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const DOMAIN_READ_FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DOMAIN_READ_MAX_NODES = 50_000;
const DOMAIN_READ_MAX_DEPTH = 32;
const DOMAIN_READ_MAX_STRING_BYTES = 2 * 1024 * 1024;

function ownDataValue(record, key) {
  if (!record || (typeof record !== 'object' && typeof record !== 'function')
    || util.types.isProxy(record)) return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    return undefined;
  }
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function snapshotDomainReadData(
  value,
  state = { seen: new Set(), nodes: 0, stringBytes: 0 },
  depth = 0
) {
  if (depth > DOMAIN_READ_MAX_DEPTH) {
    throw new TypeError('Domain read result exceeds its depth bound');
  }
  state.nodes += 1;
  if (state.nodes > DOMAIN_READ_MAX_NODES) {
    throw new TypeError('Domain read result exceeds its node bound');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('Domain read result contains an invalid number');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new TypeError('Domain read result contains NUL');
    state.stringBytes += Buffer.byteLength(value, 'utf8');
    if (state.stringBytes > DOMAIN_READ_MAX_STRING_BYTES) {
      throw new TypeError('Domain read result exceeds its string bound');
    }
    return value;
  }
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) {
    throw new TypeError('Domain read result contains an unsupported value');
  }
  if (state.seen.has(value)) throw new TypeError('Domain read result contains a cycle');
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if ((isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)) {
    throw new TypeError('Domain read result must contain plain data');
  }
  const keys = Reflect.ownKeys(value).filter((key) => !(isArray && key === 'length'));
  if (keys.some((key) => typeof key !== 'string' || DOMAIN_READ_FORBIDDEN_KEYS.has(key))) {
    throw new TypeError('Domain read result contains a forbidden key');
  }
  if (isArray && (keys.length !== value.length
    || keys.some((key, index) => key !== String(index)))) {
    throw new TypeError('Domain read result arrays must be dense');
  }
  state.seen.add(value);
  try {
    if (isArray) {
      const entries = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('Domain read arrays must contain data properties');
        }
        return snapshotDomainReadData(descriptor.value, state, depth + 1);
      });
      return Object.freeze(entries);
    }
    const output = {};
    for (const key of keys.sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
        throw new TypeError('Domain read objects must contain data properties');
      }
      output[key] = snapshotDomainReadData(descriptor.value, state, depth + 1);
    }
    return Object.freeze(output);
  } finally {
    state.seen.delete(value);
  }
}

function optionalExecutionCallback(executionContext, key) {
  const callback = ownDataValue(executionContext, key);
  return typeof callback === 'function' && !util.types.isProxy(callback) ? callback : null;
}

function readContextPackPromptProjection(executionContext) {
  const projection = ownDataValue(executionContext, 'contextPackPromptProjection');
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)
    || util.types.isProxy(projection) || !Object.isFrozen(projection)) {
    return Object.freeze({ trustedPrompt: '', untrustedPrompt: '' });
  }
  const trustedPrompt = ownDataValue(projection, 'trustedPrompt');
  const untrustedPrompt = ownDataValue(projection, 'untrustedPrompt');
  return Object.freeze({
    trustedPrompt: typeof trustedPrompt === 'string' && trustedPrompt.length <= 8_192
      ? trustedPrompt
      : '',
    untrustedPrompt: typeof untrustedPrompt === 'string' && untrustedPrompt.length <= 20_000
      ? untrustedPrompt
      : '',
  });
}

function normalizeRunCommandToolInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || util.types.isProxy(input)) {
    throw new TypeError('run_command input must be a plain data record');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('run_command input must be a plain data record');
  }
  const keys = Reflect.ownKeys(input);
  const supported = ['command', 'args', 'timeoutMs'];
  if (keys.length !== supported.length
    || supported.some((key) => !keys.includes(key))
    || keys.some((key) => typeof key !== 'string' || !supported.includes(key))) {
    throw new TypeError('run_command input contains unsupported fields');
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) {
      throw new TypeError('run_command input must contain enumerable data properties only');
    }
  }

  const command = ownDataValue(input, 'command');
  const args = ownDataValue(input, 'args');
  const timeoutMs = ownDataValue(input, 'timeoutMs');
  if (typeof command !== 'string' || command.trim().length < 1
    || command.length > RUN_COMMAND_MAX_COMMAND_LENGTH || command.includes('\0')) {
    throw new TypeError('run_command command is invalid');
  }
  if (!Array.isArray(args) || util.types.isProxy(args)
    || Object.getPrototypeOf(args) !== Array.prototype
    || args.length > RUN_COMMAND_MAX_ARGS) {
    throw new TypeError('run_command args must be a bounded plain array');
  }
  const argKeys = Reflect.ownKeys(args).filter((key) => key !== 'length');
  if (argKeys.length !== args.length
    || argKeys.some((key, index) => key !== String(index))) {
    throw new TypeError('run_command args must be a dense data array');
  }
  const normalizedArgs = [];
  for (const key of argKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(args, key);
    const value = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    if (!descriptor || descriptor.enumerable !== true || typeof value !== 'string'
      || value.length > RUN_COMMAND_MAX_ARG_LENGTH || value.includes('\0')) {
      throw new TypeError('run_command args contain an invalid value');
    }
    normalizedArgs.push(value);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < RUN_COMMAND_MIN_TIMEOUT_MS
    || timeoutMs > RUN_COMMAND_MAX_TIMEOUT_MS || Object.is(timeoutMs, -0)) {
    throw new TypeError('run_command timeout is outside the supported bounds');
  }
  return Object.freeze({
    command: command.trim(),
    args: Object.freeze(normalizedArgs),
    timeoutMs,
  });
}

function failedRunCommandToolResult(errorCode, status = 'failed') {
  return Object.freeze({
    ok: false,
    status,
    message: 'O processo isolado foi negado ou não pôde ser iniciado.',
    errors: Object.freeze([errorCode]),
    modifiedFiles: Object.freeze([]),
    data: null,
  });
}

function sanitizeRunCommandToolResult(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || util.types.isProxy(raw)) {
      return failedRunCommandToolResult('RUN_COMMAND_INVALID_RESULT');
    }
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) {
      return failedRunCommandToolResult('RUN_COMMAND_INVALID_RESULT');
    }
    const status = ownDataValue(raw, 'status');
    const decision = ownDataValue(raw, 'decision');
    if (status !== 'completed' || decision !== 'allow') {
      const error = ownDataValue(raw, 'error');
      const rawCode = ownDataValue(error, 'code');
      const errorCode = typeof rawCode === 'string' && RUN_COMMAND_SAFE_ERROR_CODE.test(rawCode)
        ? rawCode
        : 'RUN_COMMAND_OPERATION_FAILED';
      return failedRunCommandToolResult(
        errorCode,
        status === 'denied' ? 'denied' : 'failed'
      );
    }

    const output = ownDataValue(raw, 'output');
    if (!output || typeof output !== 'object' || Array.isArray(output)
      || util.types.isProxy(output)) {
      return failedRunCommandToolResult('RUN_COMMAND_INVALID_RESULT');
    }
    const outputPrototype = Object.getPrototypeOf(output);
    const processStatus = ownDataValue(output, 'status');
    const revision = ownDataValue(output, 'revision');
    const exitCode = ownDataValue(output, 'exitCode');
    const timedOut = ownDataValue(output, 'timedOut');
    const stopped = ownDataValue(output, 'stopped');
    const availableFromCursor = ownDataValue(output, 'availableFromCursor');
    const outputCursor = ownDataValue(output, 'outputCursor');
    if ((outputPrototype !== Object.prototype && outputPrototype !== null)
      || !RUN_COMMAND_PUBLIC_STATUSES.has(processStatus)
      || !Number.isSafeInteger(revision) || revision < 1
      || (exitCode !== null && (!Number.isSafeInteger(exitCode) || Object.is(exitCode, -0)))
      || typeof timedOut !== 'boolean' || typeof stopped !== 'boolean'
      || !Number.isSafeInteger(availableFromCursor) || availableFromCursor < 0
      || !Number.isSafeInteger(outputCursor) || outputCursor < availableFromCursor) {
      return failedRunCommandToolResult('RUN_COMMAND_INVALID_RESULT');
    }
    return Object.freeze({
      ok: true,
      status: 'completed',
      message: 'Processo iniciado pelo broker no sandbox isolado do job.',
      errors: Object.freeze([]),
      modifiedFiles: Object.freeze([]),
      data: Object.freeze({
        status: processStatus,
        revision,
        exitCode,
        timedOut,
        stopped,
        availableFromCursor,
        outputCursor,
      }),
    });
  } catch {
    return failedRunCommandToolResult('RUN_COMMAND_INVALID_RESULT');
  }
}

function normalizeExactProcessOperationInput(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || util.types.isProxy(input)) {
    throw new TypeError('Process operation input must be a plain data record');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Process operation input must be a plain data record');
  }
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length !== keys.length
    || keys.some((key) => !ownKeys.includes(key))
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError('Process operation input contains unsupported fields');
  }
  const values = {};
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      throw new TypeError('Process operation input must contain data properties only');
    }
    values[key] = descriptor.value;
  }
  return values;
}

function boundedProcessInteger(value, {
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
} = {}) {
  return Number.isSafeInteger(value) && !Object.is(value, -0)
    && value >= minimum && value <= maximum;
}

function normalizeReadCommandOutputToolInput(input) {
  const values = normalizeExactProcessOperationInput(input, ['cursor', 'maxBytes']);
  if (!boundedProcessInteger(values.cursor)
    || !boundedProcessInteger(values.maxBytes, {
      minimum: 1,
      maximum: READ_COMMAND_OUTPUT_MAX_BYTES,
    })) {
    throw new TypeError('read_command_output bounds are invalid');
  }
  return Object.freeze({ cursor: values.cursor, maxBytes: values.maxBytes });
}

function normalizeWaitCommandToolInput(input) {
  const values = normalizeExactProcessOperationInput(input, ['afterRevision', 'timeoutMs']);
  if (!boundedProcessInteger(values.afterRevision)
    || !boundedProcessInteger(values.timeoutMs, {
      minimum: 1,
      maximum: WAIT_COMMAND_MAX_TIMEOUT_MS,
    })) {
    throw new TypeError('wait_command bounds are invalid');
  }
  return Object.freeze({
    afterRevision: values.afterRevision,
    timeoutMs: values.timeoutMs,
  });
}

function normalizeStopCommandToolInput(input) {
  const values = normalizeExactProcessOperationInput(input, ['expectedRevision']);
  if (!boundedProcessInteger(values.expectedRevision, { minimum: 1 })) {
    throw new TypeError('stop_command revision is invalid');
  }
  return Object.freeze({ expectedRevision: values.expectedRevision });
}

function failedProcessOperationToolResult(operation, code) {
  return Object.freeze({
    ok: false,
    status: 'failed',
    message: `A operação ${operation} do processo isolado foi negada ou falhou.`,
    errors: Object.freeze([code]),
    modifiedFiles: Object.freeze([]),
    data: null,
  });
}

function safeProcessOperationError(raw, fallback) {
  const rawCode = ownDataValue(raw, 'code');
  return typeof rawCode === 'string' && RUN_COMMAND_SAFE_ERROR_CODE.test(rawCode)
    ? rawCode
    : fallback;
}

function sanitizeProcessSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || util.types.isProxy(raw)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(raw);
  const status = ownDataValue(raw, 'status');
  const revision = ownDataValue(raw, 'revision');
  const exitCode = ownDataValue(raw, 'exitCode');
  const timedOut = ownDataValue(raw, 'timedOut');
  const stopped = ownDataValue(raw, 'stopped');
  const availableFromCursor = ownDataValue(raw, 'availableFromCursor');
  const outputCursor = ownDataValue(raw, 'outputCursor');
  if ((prototype !== Object.prototype && prototype !== null)
    || !RUN_COMMAND_PUBLIC_STATUSES.has(status)
    || !boundedProcessInteger(revision, { minimum: 1 })
    || (exitCode !== null && (!Number.isSafeInteger(exitCode) || Object.is(exitCode, -0)))
    || typeof timedOut !== 'boolean' || typeof stopped !== 'boolean'
    || !boundedProcessInteger(availableFromCursor)
    || !boundedProcessInteger(outputCursor, { minimum: availableFromCursor })) {
    return null;
  }
  return Object.freeze({
    status,
    revision,
    exitCode,
    timedOut,
    stopped,
    availableFromCursor,
    outputCursor,
  });
}

function sanitizeReadCommandOutputToolResult(raw, request) {
  try {
    const snapshot = sanitizeProcessSnapshot(raw);
    if (!snapshot) {
      return failedProcessOperationToolResult(
        'read_command_output',
        safeProcessOperationError(raw, 'READ_COMMAND_OUTPUT_INVALID_RESULT')
      );
    }
    const cursor = ownDataValue(raw, 'cursor');
    const nextCursor = ownDataValue(raw, 'nextCursor');
    const truncated = ownDataValue(raw, 'truncated');
    const eof = ownDataValue(raw, 'eof');
    const chunks = ownDataValue(raw, 'chunks');
    if (cursor !== request.cursor || !boundedProcessInteger(nextCursor)
      || nextCursor < Math.max(cursor, snapshot.availableFromCursor)
      || nextCursor > snapshot.outputCursor
      || typeof truncated !== 'boolean'
      || truncated !== (cursor < snapshot.availableFromCursor)
      || typeof eof !== 'boolean'
      || !Array.isArray(chunks) || util.types.isProxy(chunks)
      || Object.getPrototypeOf(chunks) !== Array.prototype) {
      return failedProcessOperationToolResult(
        'read_command_output',
        'READ_COMMAND_OUTPUT_INVALID_RESULT'
      );
    }
    const chunkKeys = Reflect.ownKeys(chunks).filter((key) => key !== 'length');
    if (chunkKeys.length !== chunks.length
      || chunkKeys.some((key, index) => key !== String(index))) {
      return failedProcessOperationToolResult(
        'read_command_output',
        'READ_COMMAND_OUTPUT_INVALID_RESULT'
      );
    }
    let expectedCursor = Math.max(cursor, snapshot.availableFromCursor);
    let totalBytes = 0;
    const sanitizedChunks = [];
    for (const key of chunkKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(chunks, key);
      const chunk = descriptor && Object.hasOwn(descriptor, 'value')
        ? descriptor.value
        : null;
      if (!descriptor || descriptor.enumerable !== true || !chunk
        || typeof chunk !== 'object' || Array.isArray(chunk) || util.types.isProxy(chunk)
        || (Object.getPrototypeOf(chunk) !== Object.prototype
          && Object.getPrototypeOf(chunk) !== null)) {
        return failedProcessOperationToolResult(
          'read_command_output',
          'READ_COMMAND_OUTPUT_INVALID_RESULT'
        );
      }
      const startCursor = ownDataValue(chunk, 'startCursor');
      const endCursor = ownDataValue(chunk, 'endCursor');
      const stream = ownDataValue(chunk, 'stream');
      const text = ownDataValue(chunk, 'text');
      const byteLength = typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : -1;
      if (startCursor !== expectedCursor || !boundedProcessInteger(endCursor)
        || endCursor <= startCursor || endCursor - startCursor !== byteLength
        || !PROCESS_OUTPUT_STREAMS.has(stream)) {
        return failedProcessOperationToolResult(
          'read_command_output',
          'READ_COMMAND_OUTPUT_INVALID_RESULT'
        );
      }
      totalBytes += byteLength;
      if (totalBytes > request.maxBytes) {
        return failedProcessOperationToolResult(
          'read_command_output',
          'READ_COMMAND_OUTPUT_INVALID_RESULT'
        );
      }
      expectedCursor = endCursor;
      sanitizedChunks.push(Object.freeze({ startCursor, endCursor, stream, text }));
    }
    const terminal = processStatusIsTerminal(snapshot.status);
    if (expectedCursor !== nextCursor
      || (eof && (!terminal || nextCursor !== snapshot.outputCursor))) {
      return failedProcessOperationToolResult(
        'read_command_output',
        'READ_COMMAND_OUTPUT_INVALID_RESULT'
      );
    }
    return Object.freeze({
      ok: true,
      status: 'completed',
      message: 'Saída limitada do processo isolado lida pelo cursor.',
      errors: Object.freeze([]),
      modifiedFiles: Object.freeze([]),
      data: Object.freeze({
        ...snapshot,
        cursor,
        nextCursor,
        truncated,
        chunks: Object.freeze(sanitizedChunks),
        eof,
      }),
    });
  } catch {
    return failedProcessOperationToolResult(
      'read_command_output',
      'READ_COMMAND_OUTPUT_INVALID_RESULT'
    );
  }
}

function processStatusIsTerminal(status) {
  return status === 'succeeded' || status === 'failed'
    || status === 'stopped' || status === 'timed_out';
}

function sanitizeWaitCommandToolResult(raw, request) {
  try {
    const snapshot = sanitizeProcessSnapshot(raw);
    const changed = ownDataValue(raw, 'changed');
    if (!snapshot || typeof changed !== 'boolean'
      || snapshot.revision < request.afterRevision
      || changed !== (snapshot.revision > request.afterRevision)) {
      return failedProcessOperationToolResult(
        'wait_command',
        safeProcessOperationError(raw, 'WAIT_COMMAND_INVALID_RESULT')
      );
    }
    return Object.freeze({
      ok: true,
      status: 'completed',
      message: 'Estado do processo isolado observado pelo broker.',
      errors: Object.freeze([]),
      modifiedFiles: Object.freeze([]),
      data: Object.freeze({ ...snapshot, changed }),
    });
  } catch {
    return failedProcessOperationToolResult('wait_command', 'WAIT_COMMAND_INVALID_RESULT');
  }
}

function sanitizeStopCommandToolResult(raw, request) {
  try {
    const snapshot = sanitizeProcessSnapshot(raw);
    const treeTerminated = ownDataValue(raw, 'treeTerminated');
    const idempotent = ownDataValue(raw, 'idempotent');
    if (!snapshot || treeTerminated !== true || typeof idempotent !== 'boolean'
      || !processStatusIsTerminal(snapshot.status)
      || snapshot.revision < request.expectedRevision
      || (!idempotent && snapshot.revision <= request.expectedRevision)) {
      return failedProcessOperationToolResult(
        'stop_command',
        safeProcessOperationError(raw, 'STOP_COMMAND_INVALID_RESULT')
      );
    }
    return Object.freeze({
      ok: true,
      status: 'completed',
      message: 'Árvore do processo isolado encerrada pelo broker.',
      errors: Object.freeze([]),
      modifiedFiles: Object.freeze([]),
      data: Object.freeze({ ...snapshot, treeTerminated: true, idempotent }),
    });
  } catch {
    return failedProcessOperationToolResult('stop_command', 'STOP_COMMAND_INVALID_RESULT');
  }
}

function normalizeDeletePathsToolInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('delete_paths input must be a plain data record');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('delete_paths input must be a plain data record');
  }

  const keys = Reflect.ownKeys(input);
  if (!keys.includes('paths') || keys.some((key) => (
    typeof key !== 'string' || (key !== 'paths' && key !== 'reason')
  ))) {
    throw new TypeError('delete_paths input contains unsupported fields');
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('delete_paths input must contain enumerable data properties only');
    }
  }

  const paths = ownDataValue(input, 'paths');
  if (!Array.isArray(paths) || Object.getPrototypeOf(paths) !== Array.prototype) {
    throw new TypeError('delete_paths paths must be a plain array');
  }
  if (paths.length < 1 || paths.length > DELETE_PATHS_TOOL_MAX_PATHS) {
    throw new TypeError('delete_paths paths are outside the supported bounds');
  }
  const pathKeys = Reflect.ownKeys(paths);
  if (pathKeys.length !== paths.length + 1 || !pathKeys.includes('length')) {
    throw new TypeError('delete_paths paths must be a dense array');
  }

  const normalizedPaths = [];
  for (let index = 0; index < paths.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(paths, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('delete_paths paths must be a dense data array');
    }
    const value = descriptor.value;
    if (typeof value !== 'string'
      || value.length < 1
      || value.length > DELETE_PATHS_TOOL_MAX_PATH_LENGTH
      || value.trim().length < 1) {
      throw new TypeError('delete_paths paths must contain non-empty strings');
    }
    normalizedPaths.push(value);
  }
  if (pathKeys.some((key) => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(String(key)))) {
    throw new TypeError('delete_paths paths must contain indexed values only');
  }

  if (keys.includes('reason')) {
    const reason = ownDataValue(input, 'reason');
    if (reason !== null && (typeof reason !== 'string'
      || reason.trim().length < 1
      || reason.length > DELETE_PATHS_TOOL_MAX_REASON_LENGTH)) {
      throw new TypeError('delete_paths reason must be a non-empty bounded string');
    }
  }

  return Object.freeze({ paths: Object.freeze(normalizedPaths) });
}

function failedDeletePathsToolResult(errorCode) {
  return Object.freeze({
    ok: false,
    status: 'failed',
    message: 'A exclusão dedicada não pôde ser concluída.',
    errors: Object.freeze([errorCode]),
    modifiedFiles: Object.freeze([]),
  });
}

function sanitizeDeletePathsToolResult(raw, paths) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return failedDeletePathsToolResult('DELETE_PATHS_INVALID_RESULT');
    }
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) {
      return failedDeletePathsToolResult('DELETE_PATHS_INVALID_RESULT');
    }

    const statusValue = ownDataValue(raw, 'status');
    const status = ['completed', 'denied', 'failed'].includes(statusValue)
      ? statusValue
      : 'failed';
    const completed = status === 'completed' && ownDataValue(raw, 'ok') === true;
    const stateValue = ownDataValue(raw, 'state');
    const state = DELETE_PATHS_SAFE_STATES.has(stateValue) ? stateValue : null;
    const errorValue = ownDataValue(raw, 'errorCode');
    const errorCode = completed
      ? null
      : (typeof errorValue === 'string' && DELETE_PATHS_SAFE_ERROR_CODE.test(errorValue)
        ? errorValue
        : 'DELETE_PATHS_OPERATION_FAILED');

    let impact = null;
    const rawImpact = ownDataValue(raw, 'impact');
    if (rawImpact && typeof rawImpact === 'object' && !Array.isArray(rawImpact)) {
      const values = {};
      let valid = true;
      for (const field of ['files', 'bytes', 'directories']) {
        const value = ownDataValue(rawImpact, field);
        if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
          valid = false;
          break;
        }
        values[field] = value;
      }
      if (valid) impact = Object.freeze(values);
    }

    return Object.freeze({
      ok: completed,
      status: completed ? 'completed' : status,
      message: completed
        ? 'Exclusão dedicada concluída e mantida no checkpoint transacional.'
        : 'A exclusão dedicada foi negada ou não pôde ser concluída.',
      errors: Object.freeze(completed ? [] : [errorCode]),
      modifiedFiles: Object.freeze(completed ? [...paths] : []),
      data: Object.freeze({ state, impact, errorCode }),
    });
  } catch {
    return failedDeletePathsToolResult('DELETE_PATHS_INVALID_RESULT');
  }
}

function failedDomainReadToolResult(raw, fallbackCode = 'DOMAIN_READ_OPERATION_FAILED') {
  const rawError = ownDataValue(raw, 'error');
  const errorCodeValue = ownDataValue(rawError, 'code') || ownDataValue(raw, 'code');
  const errorCode = typeof errorCodeValue === 'string'
    && DOMAIN_READ_SAFE_ERROR_CODE.test(errorCodeValue)
    ? errorCodeValue
    : fallbackCode;
  return Object.freeze({
    ok: false,
    status: ownDataValue(raw, 'status') === 'denied' ? 'denied' : 'failed',
    message: 'A leitura governada do domínio foi negada ou não pôde ser concluída.',
    errors: Object.freeze([errorCode]),
    modifiedFiles: Object.freeze([]),
    data: null,
  });
}

function sanitizeDomainReadToolResult(raw, capability, action) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || util.types.isProxy(raw)
      || (Object.getPrototypeOf(raw) !== Object.prototype
        && Object.getPrototypeOf(raw) !== null)
      || ownDataValue(raw, 'status') !== 'completed'
      || ownDataValue(raw, 'decision') !== 'allow') {
      return failedDomainReadToolResult(raw);
    }
    const output = snapshotDomainReadData(ownDataValue(raw, 'output'));
    if (!output || typeof output !== 'object' || Array.isArray(output)
      || ownDataValue(output, 'ok') !== true) {
      return failedDomainReadToolResult(
        output,
        'DOMAIN_READ_INVALID_RESULT'
      );
    }
    const labels = {
      'filesystem.project_tree': 'Árvore governada do projeto lida pelo Broker.',
      'filesystem.read_file': 'Arquivo governado do projeto lido pelo Broker.',
      'application_map.read': 'Application Map lido pelo serviço de domínio governado.',
      'milestones.read': 'Milestones lidas pelo serviço de domínio governado.',
    };
    return Object.freeze({
      ok: true,
      status: 'completed',
      message: labels[`${capability}.${action}`] || 'Domínio lido pelo Broker.',
      errors: Object.freeze([]),
      modifiedFiles: Object.freeze([]),
      data: output,
    });
  } catch {
    return failedDomainReadToolResult(raw, 'DOMAIN_READ_INVALID_RESULT');
  }
}

function safeToolCallKey(toolName, input) {
  if (toolName === 'run_command') {
    try {
      const normalized = normalizeRunCommandToolInput(input);
      return `${toolName}:${JSON.stringify(normalized)}`;
    } catch {
      return `${toolName}:invalid_input`;
    }
  }
  if (toolName === 'delete_paths') {
    try {
      const normalized = normalizeDeletePathsToolInput(input);
      return `${toolName}:${JSON.stringify(normalized.paths)}`;
    } catch {
      return `${toolName}:invalid_input`;
    }
  }
  const processOperationNormalizers = {
    read_command_output: normalizeReadCommandOutputToolInput,
    wait_command: normalizeWaitCommandToolInput,
    stop_command: normalizeStopCommandToolInput,
  };
  if (Object.hasOwn(processOperationNormalizers, toolName)) {
    try {
      const normalized = processOperationNormalizers[toolName](input);
      return `${toolName}:${JSON.stringify(normalized)}`;
    } catch {
      return `${toolName}:invalid_input`;
    }
  }
  try {
    return `${toolName}:${JSON.stringify(input || {})}`;
  } catch {
    return `${toolName}:unserializable_input`;
  }
}

function invokeModelTurnWithCancellation(signal, phase, invoke) {
  throwIfExecutionCancelled(signal, `${phase}:before`);

  if (!signal || typeof signal.addEventListener !== 'function') {
    let operation;
    try {
      operation = invoke();
    } catch (error) {
      if (isSignalAborted(signal)) throw new AgenticExecutionCancelledError(`${phase}:after`);
      throw error;
    }
    return Promise.resolve(operation).then(
      (value) => {
        throwIfExecutionCancelled(signal, `${phase}:after`);
        return value;
      },
      (error) => {
        if (isSignalAborted(signal)) throw new AgenticExecutionCancelledError(`${phase}:after`);
        throw error;
      }
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const rejectCancelled = (suffix) => {
      settle(reject, new AgenticExecutionCancelledError(`${phase}:${suffix}`));
    };
    const onAbort = () => rejectCancelled('aborted');

    signal.addEventListener('abort', onAbort, { once: true });
    if (isSignalAborted(signal)) {
      rejectCancelled('before');
      return;
    }

    let operation;
    try {
      operation = invoke();
    } catch (error) {
      if (isSignalAborted(signal)) {
        rejectCancelled('after');
      } else {
        settle(reject, error);
      }
      return;
    }

    Promise.resolve(operation).then(
      (value) => {
        if (isSignalAborted(signal)) {
          rejectCancelled('after');
          return;
        }
        settle(resolve, value);
      },
      (error) => {
        if (isSignalAborted(signal)) {
          rejectCancelled('after');
          return;
        }
        settle(reject, error);
      }
    );
  });
}

async function invokeEffectWithCancellation(signal, phase, invoke) {
  throwIfExecutionCancelled(signal, `${phase}:before`);

  let operation;
  try {
    operation = invoke();
  } catch (error) {
    if (isSignalAborted(signal)) {
      throw new AgenticExecutionCancelledError(`${phase}:after`);
    }
    throw error;
  }

  try {
    const value = await operation;
    throwIfExecutionCancelled(signal, `${phase}:after`);
    return value;
  } catch (error) {
    if (isAgenticExecutionCancelledError(error)) throw error;
    if (isSignalAborted(signal)) {
      throw new AgenticExecutionCancelledError(`${phase}:after`);
    }
    throw error;
  }
}

function createAgenticToolLoopService(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    appendJobEvent = () => {},
    clipText = defaultClipText,
    executeCapability = null,
    executeTool = null,
    getEffectiveGeminiModel = () => '',
    getEffectiveOpenAiModel = () => '',
    getSelectedAiProvider = () => '',
    requestModelTurn = null,
    setJobCheckpoint = () => {},
    shouldUseModel = () => false,
    timeoutMs = 90000,
    maxSteps = 10,
  } = dependencies;

  function supportsAgenticExecution() {
    const provider = String(getSelectedAiProvider() || '').trim().toLowerCase();
    if (provider === 'openai') {
      const model = String(getEffectiveOpenAiModel() || '').trim();
      return Boolean(model);
    }
    if (provider === 'gemini') {
      return true;
    }
    return false;
  }

  function buildProjectSession(projectInfo = {}) {
    return {
      projectId: projectInfo && projectInfo.id ? projectInfo.id : '',
      rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '',
      realRootPath:
        projectInfo && (projectInfo.realRootPath || projectInfo.rootPath)
          ? projectInfo.realRootPath || projectInfo.rootPath
          : '',
    };
  }

  function summarizeAttachments(attachments = []) {
    if (!Array.isArray(attachments) || !attachments.length) return '';
    return attachments
      .map((item) => `${item && item.name ? item.name : 'anexo'} (${item && item.type ? item.type : 'desconhecido'})`)
      .join(', ');
  }

  function buildSystemPrompt(projectInfo = {}, executionContext = {}) {
    const rootPath = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    const processExecutionAvailable = ownDataValue(
      executionContext,
      'processExecutionAvailable'
    ) === true;
    const processControlAvailable = ownDataValue(
      executionContext,
      'processControlAvailable'
    ) === true;
    const domainReadAvailable = ownDataValue(
      executionContext,
      'domainReadAvailable'
    ) === true;
    return [
      'Você é o runtime agentic do Faber Code. Seu trabalho é agir como um engenheiro de software sênior direto no projeto.',
      'IMPORTANTE: Você está na fase de EXECUÇÃO. Não responda apenas com texto (ex: "Vou começar"). Você deve chamar ferramentas imediatamente.',
      '## Diretrizes de Edição (CRÍTICO)',
      '1. PREFIRA EDITAR A REESCREVER: Nunca use write_file para modificar um arquivo existente inteiro. Sempre use `edit_file_fuzzy`.',
      '2. COMO USAR edit_file_fuzzy: Copie um bloco único e exato do arquivo (targetContent) e forneça a nova versão (replacementContent). O sistema ignora espaços e indentações para te ajudar a encontrar o bloco.',
      processExecutionAvailable
        ? processControlAvailable
          ? '3. PROCESSOS ISOLADOS: Use `run_command` somente para executáveis e argumentos explícitos. Acompanhe com `read_command_output` e `wait_command`; use `stop_command` para encerrar a árvore. Rede, shell composto e preview continuam indisponíveis; nunca afirme uma validação sem evidência retornada pelas ferramentas.'
          : '3. PROCESSOS ISOLADOS: Use `run_command` somente para executáveis e argumentos explícitos dentro do sandbox do job. Rede, shell composto e preview continuam indisponíveis; nunca afirme uma validação sem evidência retornada pelas ferramentas.'
        : '3. VALIDAÇÃO HONESTA: As ferramentas atuais não executam lint, testes ou builds nem capturam preview. Nunca afirme que essas validações foram executadas; informe-as como pendentes para o usuário.',
      domainReadAvailable
        ? '4. MAPA DA APLICAÇÃO E MILESTONES: Use `read_application_map` e `read_milestones` para consultar os estados canônicos. `.faber/**` continua privado — nunca leia, crie ou edite esse namespace como arquivo.'
        : '4. MAPA DA APLICAÇÃO E MILESTONES: `.faber/**` é um namespace privado do runtime — nunca leia, crie ou edite arquivos nele. Ao alterar o produto, mantenha atualizados somente os documentos públicos aplicáveis em `docs/application-map/` e `docs/milestones/`; os espelhos internos são responsabilidade de serviços main-only.',
      '## Conclusão',
      'Sempre chame a ferramenta `finish_task` para indicar que você terminou, não importa se foi um sucesso ou se você encontrou um bloqueio instransponível.',
      `Projeto ativo: ${rootPath || 'indisponível'}.`,
    ].join('\n');
  }

  function buildBoundTools(projectInfo = {}, executionContext = {}) {
    const projectSession = buildProjectSession(projectInfo);
    const rootPath = projectSession.rootPath;
    const signal = ownDataValue(executionContext, 'signal') || null;
    const deletePathsSignal = typeof AbortSignal === 'function' && signal instanceof AbortSignal
      ? signal
      : null;
    const deletePaths = optionalExecutionCallback(executionContext, 'deletePaths');
    const readDomain = optionalExecutionCallback(executionContext, 'readDomain');
    const processExecutionPolicy = ownDataValue(executionContext, 'processExecutionPolicy');
    const processCallback = optionalExecutionCallback(executionContext, 'executeProcess');
    const executeProcess = processExecutionPolicy === AGENTIC_PROCESS_EXECUTION_POLICIES.BROKERED
      ? processCallback
      : null;
    const readProcessCallback = optionalExecutionCallback(executionContext, 'readProcess');
    const waitProcessCallback = optionalExecutionCallback(executionContext, 'waitProcess');
    const stopProcessCallback = optionalExecutionCallback(executionContext, 'stopProcess');
    const processControlAvailable = Boolean(
      executeProcess && readProcessCallback && waitProcessCallback && stopProcessCallback
    );
    const processSignal = typeof AbortSignal === 'function' && signal instanceof AbortSignal
      ? signal
      : null;
    const invocationOptions = signal ? Object.freeze({ signal }) : null;
    const capability = (capabilityId, action, payload = {}) => {
      const request = {
        capability: capabilityId,
        action,
        payload,
        projectSession,
        ...(signal ? { signal } : {}),
      };
      return signal
        ? executeCapability(request, invocationOptions)
        : executeCapability(request);
    };
    const runTool = (name, input = {}) => (
      signal
        ? executeTool(name, input, invocationOptions)
        : executeTool(name, input)
    );
    const governedDomainRead = async (capabilityId, action, payload) => {
      const raw = await readDomain(Object.freeze({
        capability: capabilityId,
        action,
        payload: Object.freeze(payload),
      }));
      return sanitizeDomainReadToolResult(raw, capabilityId, action);
    };

    return [
      {
        name: 'project_tree',
        description: 'Lista a árvore resumida do projeto ativo sem alterar arquivos.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        execute: async () => readDomain
          ? governedDomainRead('filesystem', 'project_tree', { maxEntries: 500 })
          : capability('filesystem', 'project_tree', {}),
      },
      {
        name: 'read_file',
        description: 'Lê um arquivo dentro do projeto ativo.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['path'],
          properties: {
            path: { type: 'string' },
            maxChars: { type: 'integer', minimum: 200, maximum: 20000 },
          },
        },
        execute: async (input = {}) => {
          const requestedMaxChars = ownDataValue(input, 'maxChars');
          const maxBytes = Number.isSafeInteger(requestedMaxChars)
            ? requestedMaxChars
            : 12_000;
          const filePath = ownDataValue(input, 'path');
          return readDomain
            ? governedDomainRead('filesystem', 'read_file', {
              path: filePath,
              maxBytes,
            })
            : capability('filesystem', 'read_file', {
              path: filePath,
              maxChars: requestedMaxChars,
            });
        },
      },
      ...(readDomain ? [
        {
          name: 'read_application_map',
          description: 'Lê o Application Map canônico por uma capacidade de domínio read-only e retorna sua revisão.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
          execute: async () => governedDomainRead('application_map', 'read', {}),
        },
        {
          name: 'read_milestones',
          description: 'Lê as Milestones canônicas por uma capacidade de domínio read-only e retorna sua revisão.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
          execute: async () => governedDomainRead('milestones', 'read', {}),
        },
      ] : []),
      {
        name: 'search_text',
        description: 'Busca texto nos arquivos do projeto sem alterar conteúdo.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['targetText'],
          properties: {
            targetText: { type: 'string' },
          },
        },
        execute: async (input = {}) =>
          runTool('automata.search_text_in_files', {
            rootPath,
            targetText: input.targetText,
          }),
      },
      {
        name: 'write_file',
        description: 'Cria ou sobrescreve um arquivo dentro do projeto ativo.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'content'],
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
        },
        execute: async (input = {}) =>
          runTool('automata.execute_operation_batch', {
            rootPath,
            operations: [
              {
                op: 'write_file',
                path: input.path,
                content: String(input.content || ''),
              },
            ],
          }),
      },
      {
        name: 'write_files_batch',
        description: 'Cria ou sobrescreve vários arquivos em um lote único dentro do projeto ativo.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['operations'],
          properties: {
            operations: {
              type: 'array',
              minItems: 1,
              maxItems: 24,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['path', 'content'],
                properties: {
                  path: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
          },
        },
        execute: async (input = {}) =>
          runTool('automata.execute_operation_batch', {
            rootPath,
            operations: (Array.isArray(input.operations) ? input.operations : []).map((entry) => ({
              op: 'write_file',
              path: entry.path,
              content: String(entry.content || ''),
            })),
          }),
      },
      {
        name: 'edit_file_fuzzy',
        description: 'Edita um arquivo existente substituindo um bloco de texto por outro de forma tolerante a falhas.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'targetContent', 'replacementContent'],
          properties: {
            path: { type: 'string' },
            targetContent: { type: 'string' },
            replacementContent: { type: 'string' },
          },
        },
        execute: async (input = {}) =>
          runTool('automata.edit_file_fuzzy', {
            rootPath,
            targetFile: input.path,
            targetContent: String(input.targetContent || ''),
            replacementContent: String(input.replacementContent || ''),
          }),
      },
      ...(deletePaths ? [{
        name: 'delete_paths',
        description: 'Exclui caminhos exatos do projeto pelo fluxo dedicado, aprovado e transacional. `reason` é apenas uma explicação e nunca concede autoridade.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['paths'],
          properties: {
            paths: {
              type: 'array',
              minItems: 1,
              maxItems: DELETE_PATHS_TOOL_MAX_PATHS,
              items: { type: 'string', minLength: 1, maxLength: DELETE_PATHS_TOOL_MAX_PATH_LENGTH },
            },
            reason: {
              // OpenAI strict schemas require every property in `required`.
              // Nullable keeps the public explanation optional there, while
              // non-strict providers may omit it entirely.
              type: ['string', 'null'],
              minLength: 1,
              maxLength: DELETE_PATHS_TOOL_MAX_REASON_LENGTH,
              description: 'Explicação não autoritativa da exclusão solicitada.',
            },
          },
        },
        execute: async (input = {}) => {
          throwIfExecutionCancelled(signal, 'delete_paths:before_validation');
          let normalized;
          try {
            normalized = normalizeDeletePathsToolInput(input);
          } catch {
            return failedDeletePathsToolResult('DELETE_PATHS_INVALID_INPUT');
          }
          throwIfExecutionCancelled(signal, 'delete_paths:before_callback');

          let rawResult;
          try {
            rawResult = await deletePaths(Object.freeze({
              paths: normalized.paths,
              signal: deletePathsSignal,
            }));
          } catch (error) {
            if (error instanceof AgenticExecutionCancelledError) throw error;
            throwIfExecutionCancelled(signal, 'delete_paths:after_callback');
            return failedDeletePathsToolResult('DELETE_PATHS_OPERATION_FAILED');
          }
          throwIfExecutionCancelled(signal, 'delete_paths:after_callback');
          return sanitizeDeletePathsToolResult(rawResult, normalized.paths);
        },
      }] : []),
      ...(executeProcess ? [{
        name: 'run_command',
        description: 'Inicia um executável com argumentos explícitos no sandbox isolado e sem rede do job.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['command', 'args', 'timeoutMs'],
          properties: {
            command: {
              type: 'string',
              minLength: 1,
              maxLength: RUN_COMMAND_MAX_COMMAND_LENGTH,
            },
            args: {
              type: 'array',
              maxItems: RUN_COMMAND_MAX_ARGS,
              items: { type: 'string', maxLength: RUN_COMMAND_MAX_ARG_LENGTH },
            },
            timeoutMs: {
              type: 'integer',
              minimum: RUN_COMMAND_MIN_TIMEOUT_MS,
              maximum: RUN_COMMAND_MAX_TIMEOUT_MS,
            },
          },
        },
        execute: async (input = {}) => {
          throwIfExecutionCancelled(signal, 'run_command:before_validation');
          let normalized;
          try {
            normalized = normalizeRunCommandToolInput(input);
          } catch {
            return failedRunCommandToolResult('RUN_COMMAND_INVALID_INPUT');
          }
          throwIfExecutionCancelled(signal, 'run_command:before_callback');
          const callbackInput = {
            command: normalized.command,
            args: normalized.args,
            timeoutMs: normalized.timeoutMs,
            ...(processSignal ? { signal: processSignal } : {}),
          };
          let rawResult;
          try {
            rawResult = await executeProcess(Object.freeze(callbackInput));
          } catch (error) {
            if (error instanceof AgenticExecutionCancelledError) throw error;
            throwIfExecutionCancelled(signal, 'run_command:after_callback');
            return failedRunCommandToolResult('RUN_COMMAND_OPERATION_FAILED');
          }
          throwIfExecutionCancelled(signal, 'run_command:after_callback');
          return sanitizeRunCommandToolResult(rawResult);
        },
      }] : []),
      ...(processControlAvailable ? [
        {
          name: 'read_command_output',
          description: 'Lê uma faixa limitada da saída do processo isolado atual usando cursor.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['cursor', 'maxBytes'],
            properties: {
              cursor: { type: 'integer', minimum: 0 },
              maxBytes: {
                type: 'integer',
                minimum: 1,
                maximum: READ_COMMAND_OUTPUT_MAX_BYTES,
              },
            },
          },
          execute: async (input = {}) => {
            throwIfExecutionCancelled(signal, 'read_command_output:before_validation');
            let normalized;
            try {
              normalized = normalizeReadCommandOutputToolInput(input);
            } catch {
              return failedProcessOperationToolResult(
                'read_command_output',
                'READ_COMMAND_OUTPUT_INVALID_INPUT'
              );
            }
            throwIfExecutionCancelled(signal, 'read_command_output:before_callback');
            let rawResult;
            try {
              rawResult = await readProcessCallback(normalized);
            } catch (error) {
              if (error instanceof AgenticExecutionCancelledError) throw error;
              throwIfExecutionCancelled(signal, 'read_command_output:after_callback');
              return failedProcessOperationToolResult(
                'read_command_output',
                'READ_COMMAND_OUTPUT_OPERATION_FAILED'
              );
            }
            throwIfExecutionCancelled(signal, 'read_command_output:after_callback');
            return sanitizeReadCommandOutputToolResult(rawResult, normalized);
          },
        },
        {
          name: 'wait_command',
          description: 'Aguarda por tempo limitado uma mudança de revisão do processo isolado atual.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['afterRevision', 'timeoutMs'],
            properties: {
              afterRevision: { type: 'integer', minimum: 0 },
              timeoutMs: {
                type: 'integer',
                minimum: 1,
                maximum: WAIT_COMMAND_MAX_TIMEOUT_MS,
              },
            },
          },
          execute: async (input = {}) => {
            throwIfExecutionCancelled(signal, 'wait_command:before_validation');
            let normalized;
            try {
              normalized = normalizeWaitCommandToolInput(input);
            } catch {
              return failedProcessOperationToolResult(
                'wait_command',
                'WAIT_COMMAND_INVALID_INPUT'
              );
            }
            throwIfExecutionCancelled(signal, 'wait_command:before_callback');
            let rawResult;
            try {
              rawResult = await waitProcessCallback(normalized);
            } catch (error) {
              if (error instanceof AgenticExecutionCancelledError) throw error;
              throwIfExecutionCancelled(signal, 'wait_command:after_callback');
              return failedProcessOperationToolResult(
                'wait_command',
                'WAIT_COMMAND_OPERATION_FAILED'
              );
            }
            throwIfExecutionCancelled(signal, 'wait_command:after_callback');
            return sanitizeWaitCommandToolResult(rawResult, normalized);
          },
        },
        {
          name: 'stop_command',
          description: 'Encerra a árvore do processo isolado atual na revisão observada.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['expectedRevision'],
            properties: {
              expectedRevision: { type: 'integer', minimum: 1 },
            },
          },
          execute: async (input = {}) => {
            throwIfExecutionCancelled(signal, 'stop_command:before_validation');
            let normalized;
            try {
              normalized = normalizeStopCommandToolInput(input);
            } catch {
              return failedProcessOperationToolResult(
                'stop_command',
                'STOP_COMMAND_INVALID_INPUT'
              );
            }
            throwIfExecutionCancelled(signal, 'stop_command:before_callback');
            let rawResult;
            try {
              rawResult = await stopProcessCallback(normalized);
            } catch (error) {
              if (error instanceof AgenticExecutionCancelledError) throw error;
              throwIfExecutionCancelled(signal, 'stop_command:after_callback');
              return failedProcessOperationToolResult(
                'stop_command',
                'STOP_COMMAND_OPERATION_FAILED'
              );
            }
            throwIfExecutionCancelled(signal, 'stop_command:after_callback');
            return sanitizeStopCommandToolResult(rawResult, normalized);
          },
        },
      ] : []),
      {
        name: 'finish_task',
        description: 'Encerra a execução do agente. Chame esta ferramenta quando terminar tudo ou não puder prosseguir.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'summary'],
          properties: {
            status: { type: 'string', enum: ['success', 'failure'] },
            summary: { type: 'string', description: 'Resumo do que foi feito e do que ficou pendente.' },
          },
        },
        execute: async (input = {}) => {
          const succeeded = input.status === 'success';
          return {
            ok: succeeded,
            status: input.status,
            message: succeeded
              ? AGENTIC_PROCESS_VALIDATION_PENDING_MESSAGE
              : AGENTIC_FAILURE_VALIDATION_PENDING_MESSAGE,
            _isFinishTask: true,
          };
        },
      },
      {
        name: 'terminal_status',
        description: 'Consulta sessões e saída atual do terminal do projeto.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        execute: async () => {
          const res = await capability('terminal', 'status', {});
          if (res && res.data && Array.isArray(res.data.sessions)) {
            const isRunning = res.data.sessions.some(s => s.running);
            if (isRunning) {
              await new Promise(r => setTimeout(r, 4000));
            }
          }
          return res;
        },
      },
      {
        name: 'git_status',
        description: 'Lê o status Git atual do projeto.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
        execute: async () => capability('git', 'status', {}),
      },
      {
        name: 'structured_edit_plan',
        description: 'Pede ao Faber um patch estruturado determinístico para uma alteração pontual.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['prompt'],
          properties: {
            prompt: { type: 'string' },
          },
        },
        execute: async (input = {}) =>
          capability('structured_edit', 'plan', {
            prompt: input.prompt,
          }),
      },
      {
        name: 'structured_edit_apply',
        description: 'Aplica um patch estruturado determinístico quando o pedido encaixa em micro-edits seguros.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['prompt'],
          properties: {
            prompt: { type: 'string' },
          },
        },
        execute: async (input = {}) =>
          capability('structured_edit', 'apply', {
            prompt: input.prompt,
          }),
      },
    ];
  }

  function sanitizeSchemaForStrict(schema) {
    if (!schema || typeof schema !== 'object') {
      return { type: 'object', properties: {}, required: [], additionalProperties: false };
    }
    const result = { ...schema };
    if (result.type === 'object') {
      result.additionalProperties = false;
      if (!result.properties) {
        result.properties = {};
      }
      const propKeys = Object.keys(result.properties);
      const newProperties = {};
      for (const key of propKeys) {
        newProperties[key] = sanitizeSchemaForStrict(result.properties[key]);
      }
      result.properties = newProperties;
      result.required = propKeys;
    } else if (result.type === 'array' && result.items) {
      result.items = sanitizeSchemaForStrict(result.items);
    }
    return result;
  }

  function buildToolDefinitions(tools = []) {
    const provider = String(getSelectedAiProvider() || '').trim().toLowerCase();
    const isStrictSupported = provider === 'openai';

    return tools.map((tool) => {
      const baseParams = tool.inputSchema || { type: 'object', additionalProperties: false, properties: {} };
      const parameters = isStrictSupported ? sanitizeSchemaForStrict(baseParams) : baseParams;

      const definition = {
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters,
      };
      if (isStrictSupported) {
        definition.strict = true;
      }
      return definition;
    });
  }

  function makeToolIndex(tools = []) {
    const map = new Map();
    for (const tool of tools) {
      map.set(tool.name, tool);
    }
    return map;
  }

  function collectModifiedFilesFromResult(toolName, input, result) {
    const files = new Set();
    if ((toolName === 'write_file' || toolName === 'automata.apply_file_patch') && input) {
      const p = input.path || input.targetFile;
      if (p) files.add(String(p));
    }
    if (toolName === 'write_files_batch' || toolName === 'automata.execute_operation_batch') {
      for (const entry of Array.isArray(input && input.operations) ? input.operations : []) {
        if (entry && entry.path) files.add(String(entry.path));
      }
    }
    const candidates = [];
    if (result && Array.isArray(result.modifiedFiles)) candidates.push(...result.modifiedFiles);
    if (result && result.data && Array.isArray(result.data.applied)) candidates.push(...result.data.applied);
    if (result && result.result && Array.isArray(result.result.applied)) candidates.push(...result.result.applied);
    for (const value of candidates) {
      if (value) files.add(String(value));
    }
    return [...files];
  }

  function summarizeToolResultForModel(result) {
    const summary = {
      ok: Boolean(result && result.ok),
      status: result && result.status ? result.status : '',
      message: result && result.message ? result.message : '',
      errors: result && Array.isArray(result.errors) ? result.errors.slice(0, 8) : [],
      warnings: result && Array.isArray(result.warnings) ? result.warnings.slice(0, 8) : [],
      artifacts: result && Array.isArray(result.artifacts) ? result.artifacts.slice(0, 8) : [],
      logs: result && Array.isArray(result.logs) ? result.logs.slice(0, 4) : [],
      data: result && result.data ? result.data : null,
    };
    
    // Safely truncate large string data before stringify
    if (summary.data && typeof summary.data.content === 'string' && summary.data.content.length > 13000) {
      summary.data.content = summary.data.content.slice(0, 13000) + '... [TRUNCATED]';
    }
    if (summary.logs && summary.logs[0] && typeof summary.logs[0] === 'string' && summary.logs[0].length > 13000) {
      summary.logs[0] = summary.logs[0].slice(0, 13000) + '... [TRUNCATED]';
    }
    
    const raw = JSON.stringify(summary, null, 2);
    return raw.length > 14000 ? raw.slice(0, 13997) + '...' : raw;
  }

  function buildConversationMessages(conversationMessages = [], userMessage = '', attachments = []) {
    const messages = [];
    for (const message of Array.isArray(conversationMessages) ? conversationMessages.slice(-8) : []) {
      const role = message && message.role === 'assistant' ? 'assistant' : 'user';
      const content = String(
        message && (message.text || message.content || message.message)
          ? message.text || message.content || message.message
          : ''
      ).trim();
      if (!content) continue;
      messages.push({ role, content });
    }
    const contentArr = [];
    if (userMessage) {
      contentArr.push({ type: 'text', text: String(userMessage).trim() });
    }
    
    if (Array.isArray(attachments)) {
      const fs = require('fs');
      for (const att of attachments) {
        if (att && att.path && (att.type.startsWith('image/') || att.path.match(/\.(png|jpe?g|gif|webp)$/i))) {
          try {
            if (fs.existsSync(att.path)) {
              const base64 = fs.readFileSync(att.path, 'base64');
              let mime = att.type || 'image/jpeg';
              if (att.path.endsWith('.png')) mime = 'image/png';
              else if (att.path.endsWith('.webp')) mime = 'image/webp';
              else if (att.path.endsWith('.gif')) mime = 'image/gif';
              contentArr.push({
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${base64}` }
              });
            }
          } catch (e) {}
        }
      }
    }
    
    if (contentArr.length > 0) {
      messages.push({ role: 'user', content: contentArr });
    } else {
      const attachmentSummary = summarizeAttachments(attachments);
      const fallbackMessage = attachmentSummary
        ? `${String(userMessage || '').trim()}\n\nAnexos: ${attachmentSummary}`
        : String(userMessage || '').trim();
      if (fallbackMessage) messages.push({ role: 'user', content: fallbackMessage });
    }
    
    return messages;
  }

  function buildExecutionPlan(payload = {}) {
    if (!supportsAgenticExecution()) return null;
    const projectInfo = payload.projectInfo || null;
    if (!projectInfo || !projectInfo.rootPath) return null;

    return {
      ok: true,
      response: 'Entendi. Vou trabalhar nisso agora e te volto com resultado real.',
      action: {
        type: 'agentic_tool_loop',
        userMessage: payload.userMessage || '',
        attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
        conversationMessages: Array.isArray(payload.conversationMessages) ? payload.conversationMessages : [],
        contextHint: payload.contextHint || null,
        routeDecision: payload.routeDecision || null,
        rootPath: projectInfo.rootPath,
      },
      meta: {
        planner: 'agentic_tool_loop',
        reason: 'agentic_tool_loop_ready',
        autoExecute: true,
        provider: getSelectedAiProvider(),
      },
    };
  }

  async function executeAction(action = {}, projectInfo = {}, options = {}) {
    if (!supportsAgenticExecution()) {
      return {
        ok: false,
        message: 'O loop agentic direto só está disponível com os provedores suportados (OpenAI, Gemini).',
      };
    }
    if (typeof requestModelTurn !== 'function') {
      return { ok: false, message: 'Cliente do modelo agentic indisponível.' };
    }
    if (typeof executeCapability !== 'function' || typeof executeTool !== 'function') {
      return { ok: false, message: 'Ferramentas locais indisponíveis para o loop agentic.' };
    }

    const jobId = options && options.jobId ? String(options.jobId) : String(action && action.jobId ? action.jobId : '');
    const signal = options && options.signal ? options.signal : null;
    throwIfExecutionCancelled(signal, 'agentic_execution:start');
    const deletePaths = optionalExecutionCallback(options, 'deletePaths');
    const readDomain = optionalExecutionCallback(options, 'readDomain');
    const processExecutionPolicy = ownDataValue(options, 'processExecutionPolicy');
    const executeProcess = optionalExecutionCallback(options, 'executeProcess');
    const readProcess = optionalExecutionCallback(options, 'readProcess');
    const waitProcess = optionalExecutionCallback(options, 'waitProcess');
    const stopProcess = optionalExecutionCallback(options, 'stopProcess');
    const processExecutionAvailable = processExecutionPolicy
      === AGENTIC_PROCESS_EXECUTION_POLICIES.BROKERED && Boolean(executeProcess);
    const processControlAvailable = processExecutionAvailable
      && Boolean(readProcess && waitProcess && stopProcess);
    const contextPackPrompts = readContextPackPromptProjection(options);
    const tools = buildBoundTools(projectInfo, {
      signal,
      deletePaths,
      readDomain,
      processExecutionPolicy,
      executeProcess,
      readProcess,
      waitProcess,
      stopProcess,
    });
    const toolDefinitions = buildToolDefinitions(tools);
    const toolIndex = makeToolIndex(tools);
    const conversationMessages = buildConversationMessages(
      action.conversationMessages || [],
      action.userMessage || '',
      action.attachments || []
    );
    if (contextPackPrompts.untrustedPrompt) {
      const insertionIndex = Math.max(0, conversationMessages.length - 1);
      conversationMessages.splice(insertionIndex, 0, {
        role: 'user',
        content: contextPackPrompts.untrustedPrompt,
      });
    }
    const systemPrompt = [
      buildSystemPrompt(projectInfo, {
        processExecutionAvailable,
        processControlAvailable,
        domainReadAvailable: Boolean(readDomain),
      }),
      contextPackPrompts.trustedPrompt,
    ].filter(Boolean).join('\n\n');
    const allTextParts = [];
    const modifiedFiles = new Set();
    const toolRuns = [];
    let previousResponseId = '';
    let pendingToolResults = [];
    let isFinished = false;
  let lastFinishResult = null;
    let finishReason = '';
    
    // Doom Loop Detector State
    const recentFailedToolCalls = [];
    let consecutiveEmptyTurns = 0;

    if (jobId) {
      const activeProvider = String(getSelectedAiProvider() || '').trim().toLowerCase();
      setJobCheckpoint(jobId, 'agentic_loop', {
        started: true,
        provider: activeProvider,
        model: activeProvider === 'gemini' ? getEffectiveGeminiModel() : getEffectiveOpenAiModel(),
      });
    }

    for (let step = 0; step < maxSteps; step += 1) {
      throwIfExecutionCancelled(signal, `model_turn:${step + 1}:before`);
      if (jobId) {
        appendJobEvent(jobId, 'job.agentic_turn_started', {
          step: step + 1,
          previousResponseId: previousResponseId || null,
        });
      }

      const turn = await invokeModelTurnWithCancellation(
        signal,
        `model_turn:${step + 1}`,
        () => requestModelTurn({
          previousResponseId,
          systemPrompt,
          conversationMessages,
          toolResults: pendingToolResults,
          tools: toolDefinitions,
          timeoutMs,
          ...(signal ? { signal } : {}),
        })
      );
      throwIfExecutionCancelled(signal, `model_turn:${step + 1}:after`);

      previousResponseId = turn && turn.responseId ? String(turn.responseId) : previousResponseId;
      if (turn && turn.text) {
        allTextParts.push(String(turn.text).trim());
      }

      if (jobId) {
        setJobCheckpoint(jobId, 'agentic_last_turn', {
          step: step + 1,
          responseId: previousResponseId || null,
          toolCalls: Array.isArray(turn && turn.toolCalls) ? turn.toolCalls.length : 0,
          textPreview: turn && turn.text ? AGENTIC_MODEL_TEXT_CHECKPOINT_MESSAGE : '',
        });
      }

      const toolCalls = Array.isArray(turn && turn.toolCalls) ? turn.toolCalls : [];
      if (!toolCalls.length && !isFinished) {
        consecutiveEmptyTurns += 1;
        const finalMessage = allTextParts.filter(Boolean).join('\n\n').trim();

        if (modifiedFiles.size > 0 && finalMessage) {
          return {
            ok: true,
            agentic: true,
            message: AGENTIC_PROCESS_VALIDATION_PENDING_MESSAGE,
            modifiedFiles: [...modifiedFiles],
            toolRuns,
          };
        }
        
        if (consecutiveEmptyTurns < 4 && maxSteps > 1) {
          if (turn && turn.text) {
            conversationMessages.push({ role: 'assistant', content: turn.text });
          }
          conversationMessages.push({
            role: 'user',
            content: 'Lembrete: Você não chamou nenhuma ferramenta. Você DEVE usar tools para interagir com o projeto e concluir a tarefa. Não pare até terminar usando finish_task.',
          });
          previousResponseId = '';
          pendingToolResults = [];
          continue;
        }

        if (actionRequiresFileChanges(action) && modifiedFiles.size === 0) {
          return {
            ok: false,
            status: 'blocked',
            errors: ['agentic_no_file_changes'],
            message: 'Sem alterações de arquivos requeridas.',
            modifiedFiles: [],
            toolRuns,
          };
        }
        return {
          ok: true,
          agentic: true,
          message: AGENTIC_PROCESS_VALIDATION_PENDING_MESSAGE,
          modifiedFiles: [...modifiedFiles],
          toolRuns,
        };
      }

      consecutiveEmptyTurns = 0;
      pendingToolResults = [];
      for (const call of toolCalls) {
        throwIfExecutionCancelled(signal, `tool_call:${step + 1}:before_resolution`);
        const tool = toolIndex.get(String(call && call.name ? call.name : ''));
        if (!tool) {
          const output = JSON.stringify({ ok: false, message: `Tool desconhecida: ${call && call.name ? call.name : ''}` });
          pendingToolResults.push({
            callId: call && call.callId ? call.callId : call && call.id ? call.id : '',
            output,
          });
          continue;
        }

        // Doom Loop Check
        const currentCallKey = safeToolCallKey(tool.name, call.input || {});
        const identicalFails = recentFailedToolCalls.filter(k => k === currentCallKey).length;
        if (identicalFails >= 2) {
          pendingToolResults.push({
            callId: call && call.callId ? call.callId : call && call.id ? call.id : '',
            output: JSON.stringify({ ok: false, message: 'SISTEMA: Você repetiu esta exata chamada falha múltiplas vezes. Você está preso em um DOOM LOOP. Por favor, tente uma abordagem completamente diferente ou encerre usando finish_task.' }),
          });
          continue;
        }

        if (jobId) {
          appendJobEvent(jobId, 'job.agentic_tool_called', {
            step: step + 1,
            toolName: tool.name,
          });
        }

        let result = null;
        try {
          result = await invokeEffectWithCancellation(
            signal,
            `tool_call:${step + 1}:${tool.name}`,
            () => tool.execute(call.input || {})
          );
          throwIfExecutionCancelled(signal, `tool_call:${step + 1}:${tool.name}:after`);
          if (result && result._isFinishTask) {
            isFinished = true;
            finishReason = result.message;
            lastFinishResult = result;
            // Preserve status from finish_task for later checks
            result.finishTaskStatus = result.status;
          }
        } catch (error) {
          if (isAgenticExecutionCancelledError(error) || isSignalAborted(signal)) {
            throw isAgenticExecutionCancelledError(error)
              ? error
              : new AgenticExecutionCancelledError(`tool_call:${step + 1}:${tool.name}:after`);
          }
          result = {
            ok: false,
            status: 'failed',
            message: error && error.message ? error.message : String(error || ''),
            errors: ['agentic_tool_execution_failed'],
          };
        }

        if (!result.ok) {
          recentFailedToolCalls.push(currentCallKey);
          if (recentFailedToolCalls.length > 10) recentFailedToolCalls.shift();
        }

        collectModifiedFilesFromResult(tool.name, call.input || {}, result).forEach((file) => modifiedFiles.add(file));

        toolRuns.push({
          step: step + 1,
          toolName: tool.name,
          ok: Boolean(result && result.ok),
          message: result && result.message ? result.message : '',
        });

        if (jobId) {
          appendJobEvent(jobId, 'job.agentic_tool_result', {
            step: step + 1,
            toolName: tool.name,
            ok: Boolean(result && result.ok),
            message: result && result.message ? clipText(result.message, 320) : '',
          });
        }

        pendingToolResults.push({
          callId: call && call.callId ? call.callId : call && call.id ? call.id : '',
          output: summarizeToolResultForModel(result),
        });
      }

      if (isFinished) {
        if (lastFinishResult && lastFinishResult.status === 'failure') {
          return {
            ok: false,
            status: 'failed',
            errors: ['agentic_finish_failure'],
            message: AGENTIC_FAILURE_VALIDATION_PENDING_MESSAGE,
            modifiedFiles: [...modifiedFiles],
            toolRuns,
          };
        }
        if (actionRequiresFileChanges(action) && modifiedFiles.size === 0 && lastFinishResult && lastFinishResult.status === 'success') {
          return {
            ok: false,
            status: 'blocked',
            errors: ['agentic_no_file_changes'],
            message: 'Sem alterações de arquivos requeridas ao finalizar.',
            modifiedFiles: [],
            toolRuns,
          };
        }
        return {
          ok: true,
          agentic: true,
          message: finishReason,
          modifiedFiles: [...modifiedFiles],
          toolRuns,
        };
      }
    }

    appendAuditEvent('assistant.agentic_loop_step_limit', {
      rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      maxSteps,
    });

    return {
      ok: false,
      status: 'step_limit',
      errors: ['agentic_step_limit_exceeded'],
      message: `O loop agentic atingiu o limite de ${maxSteps} passos antes de concluir.`,
      modifiedFiles: [...modifiedFiles],
      toolRuns,
    };
  }

  return {
    buildExecutionPlan,
    executeAction,
    supportsAgenticExecution,
  };
}

module.exports = {
  AGENTIC_EXECUTION_CANCELLED_CODE,
  AGENTIC_PROCESS_EXECUTION_POLICIES,
  AgenticExecutionCancelledError,
  createAgenticToolLoopService,
  isAgenticExecutionCancelledError,
};
