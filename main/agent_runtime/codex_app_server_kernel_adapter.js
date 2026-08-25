'use strict';

const path = require('path');
const util = require('util');

const { AgentKernel } = require('./agent_kernel');
const {
  CONTEXT_PACK_SURFACES,
  assertContextPackManifest,
} = require('./context_pack_contracts');
const {
  HARNESS_OPERATIONS,
  assertHarnessRequest,
  createHarnessResult,
} = require('./harness_contracts');
const {
  CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
  createCodexAppServerShadowThreadStartRequest,
  createCodexAppServerShadowTurnInterruptRequest,
  createCodexAppServerShadowTurnStartRequest,
} = require('./codex_app_server_shadow_protocol');
const {
  assertContextPackPromptProjection,
} = require('../services/context_pack_prompt_projection');

const CODEX_APP_SERVER_KERNEL_ID = 'codex-app-server-shadow';
const CODEX_APP_SERVER_KERNEL_ADAPTER_VERSION =
  'codex-app-server-kernel-adapter.v1';
const DEFAULT_COMPLETION_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ACTIVE_PLANS = 4;
const MAX_NOTIFICATION_BUFFER = 256;
const MAX_IDENTIFIER_CHARS = 1_024;
const MAX_OUTPUT_CHARS = 1024 * 1024;
const MAX_PROMPT_CHARS = 64 * 1024;
const MAX_DISABLED_MCP_SERVERS = 128;
const SAFE_MCP_SERVER_NAME = /^[A-Za-z0-9._-]{1,128}$/;

const CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS = Object.freeze({
  CAPACITY_EXCEEDED: 'CODEX_APP_SERVER_KERNEL_CAPACITY_EXCEEDED',
  CONTEXT_REJECTED: 'CODEX_APP_SERVER_KERNEL_CONTEXT_REJECTED',
  CONTEXT_REQUIRED: 'CODEX_APP_SERVER_KERNEL_CONTEXT_REQUIRED',
  INVALID_NOTIFICATION: 'CODEX_APP_SERVER_KERNEL_INVALID_NOTIFICATION',
  INVALID_REQUEST: 'CODEX_APP_SERVER_KERNEL_INVALID_REQUEST',
  INVALID_SERVER_RESULT: 'CODEX_APP_SERVER_KERNEL_INVALID_SERVER_RESULT',
  OUTPUT_MISSING: 'CODEX_APP_SERVER_KERNEL_OUTPUT_MISSING',
  TOOL_USE_BLOCKED: 'CODEX_APP_SERVER_KERNEL_TOOL_USE_BLOCKED',
  TRANSPORT_FAILED: 'CODEX_APP_SERVER_KERNEL_TRANSPORT_FAILED',
  TURN_FAILED: 'CODEX_APP_SERVER_KERNEL_TURN_FAILED',
  TURN_INTERRUPTED: 'CODEX_APP_SERVER_KERNEL_TURN_INTERRUPTED',
  TURN_TIMEOUT: 'CODEX_APP_SERVER_KERNEL_TURN_TIMEOUT',
});

const TEXT_ONLY_ITEM_TYPES = new Set([
  'agentMessage',
  'contextCompaction',
  'plan',
  'reasoning',
  'userMessage',
]);
const TERMINAL_TURN_STATUSES = new Set(['completed', 'failed', 'interrupted']);
const INTERRUPTIBLE_REASONS = new Set([
  CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_NOTIFICATION,
  CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TOOL_USE_BLOCKED,
  CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TURN_TIMEOUT,
]);
const PRIVATE_STATE = new WeakMap();
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

class CodexAppServerKernelAdapterError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'CodexAppServerKernelAdapterError';
    this.code = code;
    if (typeof details.causeCode === 'string'
      && /^[A-Z0-9_]{1,128}$/.test(details.causeCode)) {
      this.causeCode = details.causeCode;
    }
  }
}

function adapterError(code, details) {
  return new CodexAppServerKernelAdapterError(code, details);
}

function normalizeFailure(error, fallbackCode) {
  if (error instanceof CodexAppServerKernelAdapterError) return error;
  const causeCode = error && typeof error.code === 'string'
    ? error.code
    : null;
  return adapterError(fallbackCode, { causeCode });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, fieldName, { frozen = false } = {}) {
  if (!isPlainRecord(value) || (frozen && !Object.isFrozen(value))) {
    throw new TypeError(fieldName + ' must be a plain data record');
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(fieldName + ' must be inspectable');
  }
  const fields = new Map();
  for (const key of keys) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) {
      throw new TypeError(fieldName + ' contains a forbidden key');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) {
      throw new TypeError(fieldName + ' must contain enumerable data values');
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function denseArrayValues(value, fieldName, maximum) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || !Object.isFrozen(value) || value.length > maximum) {
    throw new TypeError(fieldName + ' must be a bounded frozen array');
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(fieldName + ' must be dense');
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(fieldName + ' must contain data values');
    }
    return descriptor.value;
  });
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function safeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || value.length > MAX_IDENTIFIER_CHARS || value.includes('\0')) {
    throw new TypeError(fieldName + ' is invalid');
  }
  return value;
}

function safeOutputText(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()
    || value.length > MAX_OUTPUT_CHARS || value.includes('\0')) {
    throw new TypeError(fieldName + ' is invalid');
  }
  return value.trim();
}

function boundedInteger(value, fallback, minimum, maximum, fieldName) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate)
    || candidate < minimum || candidate > maximum) {
    throw new TypeError(fieldName + ' is outside its supported bounds');
  }
  return candidate;
}

function readClientIsolationProfile(port) {
  let profile;
  try {
    profile = Reflect.apply(port.isolationProfile, port.receiver, []);
  } catch {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TRANSPORT_FAILED
    );
  }
  try {
    const fields = dataFields(profile, 'App Server isolation profile', {
      frozen: true,
    });
    if (fields.size !== 3
      || fields.get('version')
        !== CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION
      || fields.get('complete') !== true) {
      throw new TypeError('App Server isolation profile is incomplete');
    }
    const names = denseArrayValues(
      fields.get('disabledMcpServerNames'),
      'App Server disabled MCP servers',
      MAX_DISABLED_MCP_SERVERS
    );
    if (names.some((name) => typeof name !== 'string'
        || !SAFE_MCP_SERVER_NAME.test(name))
      || new Set(names).size !== names.length) {
      throw new TypeError('App Server isolation profile is invalid');
    }
    return Object.freeze([...names].sort());
  } catch {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TRANSPORT_FAILED
    );
  }
}

function inspectableFunction(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)) {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  try {
    Function.prototype.toString.call(value);
  } catch {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  return value;
}

function captureFrozenPort(value, methods, fieldName) {
  if (!isPlainRecord(value) || !Object.isFrozen(value)) {
    throw new TypeError(fieldName + ' must be a frozen port');
  }
  const captured = { receiver: value };
  for (const methodName of methods) {
    const descriptor = Object.getOwnPropertyDescriptor(value, methodName);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(fieldName + '.' + methodName + ' is required');
    }
    captured[methodName] = inspectableFunction(
      descriptor.value,
      fieldName + '.' + methodName
    );
  }
  return Object.freeze(captured);
}

function observeNativePromise(value, failureCode) {
  if (!util.types.isPromise(value)) {
    return Promise.reject(adapterError(failureCode));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, value, [resolve, reject]);
    } catch {
      reject(adapterError(failureCode));
    }
  });
}

function callAsyncPort(port, methodName, args) {
  let pending;
  try {
    pending = Reflect.apply(port[methodName], port.receiver, args);
  } catch (error) {
    return Promise.reject(error);
  }
  return observeNativePromise(
    pending,
    CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TRANSPORT_FAILED
  );
}

function callProjector(port, manifest) {
  let projection;
  try {
    projection = Reflect.apply(port.project, port.receiver, [manifest]);
  } catch {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.CONTEXT_REJECTED
    );
  }
  if (util.types.isPromise(projection)) {
    try {
      Reflect.apply(Promise.prototype.then, projection, [() => {}, () => {}]);
    } catch {
      // The asynchronous projector is rejected below.
    }
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.CONTEXT_REJECTED
    );
  }
  try {
    return assertContextPackPromptProjection(projection);
  } catch {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.CONTEXT_REJECTED
    );
  }
}

function readClientStatus(port) {
  try {
    const status = Reflect.apply(port.status, port.receiver, []);
    const fields = dataFields(status, 'App Server client status', { frozen: true });
    return {
      state: typeof fields.get('state') === 'string' ? fields.get('state') : 'unknown',
      running: fields.get('running') === true,
    };
  } catch {
    return { state: 'unknown', running: false };
  }
}

function nextRequestId(state) {
  let value;
  try {
    value = Reflect.apply(state.requestIdFactory, undefined, []);
  } catch {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_REQUEST
    );
  }
  const validString = typeof value === 'string'
    && value.length >= 1
    && value.length <= 256
    && value === value.trim()
    && !value.includes('\0');
  const validInteger = Number.isSafeInteger(value) && value >= 0;
  if (!validString && !validInteger) {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_REQUEST
    );
  }
  return value;
}

function inspectPlanRequest(state, request) {
  try {
    assertHarnessRequest(request);
  } catch {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_REQUEST
    );
  }
  if (!Object.isFrozen(request)
    || request.operation !== HARNESS_OPERATIONS.PLAN) {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_REQUEST
    );
  }
  const requestFields = dataFields(request, 'Harness plan request', { frozen: true });
  if (!requestFields.has('contextPack')) {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.CONTEXT_REQUIRED
    );
  }
  let manifest;
  try {
    manifest = assertContextPackManifest(requestFields.get('contextPack'));
  } catch {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.CONTEXT_REJECTED
    );
  }
  if (manifest.requestId !== request.requestId
    || manifest.surface !== CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE) {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.CONTEXT_REJECTED
    );
  }

  let payloadFields;
  let projectFields;
  try {
    payloadFields = dataFields(requestFields.get('payload'), 'Harness plan payload');
    projectFields = dataFields(
      payloadFields.get('projectInfo'),
      'Harness plan projectInfo'
    );
  } catch {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_REQUEST
    );
  }
  const projectId = projectFields.get('projectId');
  const id = projectFields.get('id');
  const rootPath = projectFields.get('rootPath');
  try {
    safeIdentifier(projectId, 'Harness projectId');
    safeIdentifier(id, 'Harness project id');
    if (id !== projectId || projectId !== manifest.projectId
      || typeof rootPath !== 'string' || rootPath !== rootPath.trim()
      || rootPath.includes('\0') || !path.isAbsolute(rootPath)
      || path.parse(rootPath).root === rootPath) {
      throw new TypeError('Harness project binding is invalid');
    }
  } catch {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.CONTEXT_REJECTED
    );
  }

  const projection = callProjector(state.promptProjector, manifest);
  if (projection.requestId !== request.requestId
    || projection.projectId !== projectId
    || projection.packId !== manifest.packId
    || projection.surface !== CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE) {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.CONTEXT_REJECTED
    );
  }
  return Object.freeze({
    manifest,
    projection,
    projectId,
    rootPath,
  });
}

function buildPlanningPrompt(request, inspected) {
  const prompt = [
    'FABER CODE SHADOW PLANNING TURN',
    'Produza somente um plano textual para o pedido representado pelo ContextPack.',
    'Não chame ferramentas de nenhuma espécie, não execute comandos, não altere arquivos e não faça chamadas externas.',
    'Use apenas o contexto fornecido. Se ele for insuficiente, registre a lacuna no plano sem tentar obtê-la por outra capacidade.',
    'Não afirme que testes, builds, lint, preview ou validações foram executados.',
    'Este turno é comparativo e não autoritativo; nunca produza uma ação executável para o Faber.',
    'Harness request: ' + request.requestId + '; projeto: ' + inspected.projectId + '.',
    inspected.projection.trustedPrompt,
    inspected.projection.untrustedPrompt,
    'Saída esperada: um plano completo, claro e verificável em texto simples.',
  ].join('\n\n');
  if (!prompt.trim() || prompt.includes('\0') || prompt.length > MAX_PROMPT_CHARS) {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.CONTEXT_REJECTED
    );
  }
  return prompt;
}

function parseThreadStartResult(value) {
  try {
    const fields = dataFields(value, 'thread/start result', { frozen: true });
    const threadFields = dataFields(
      fields.get('thread'),
      'thread/start result thread',
      { frozen: true }
    );
    return safeIdentifier(threadFields.get('id'), 'thread id');
  } catch {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_SERVER_RESULT
    );
  }
}

function parseTurnStartResult(value) {
  try {
    const fields = dataFields(value, 'turn/start result', { frozen: true });
    const turnFields = dataFields(
      fields.get('turn'),
      'turn/start result turn',
      { frozen: true }
    );
    const id = safeIdentifier(turnFields.get('id'), 'turn id');
    if (turnFields.get('status') !== 'inProgress') {
      throw new TypeError('turn/start status is invalid');
    }
    denseArrayValues(turnFields.get('items'), 'turn/start items', 512);
    return id;
  } catch {
    throw adapterError(
      CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_SERVER_RESULT
    );
  }
}

function parseThreadItem(value, fieldName, { allowIncompleteText = false } = {}) {
  const fields = dataFields(value, fieldName, { frozen: true });
  const type = safeIdentifier(fields.get('type'), fieldName + ' type');
  const id = safeIdentifier(fields.get('id'), fieldName + ' id');
  if (!TEXT_ONLY_ITEM_TYPES.has(type)) {
    return Object.freeze({ blocked: true, id, type });
  }
  if (type !== 'agentMessage' && type !== 'plan') {
    return Object.freeze({ blocked: false, output: null });
  }
  if (allowIncompleteText && fields.get('text') === '') {
    return Object.freeze({ blocked: false, output: null });
  }
  const text = safeOutputText(fields.get('text'), fieldName + ' text');
  const phase = fields.has('phase') && fields.get('phase') !== null
    ? safeIdentifier(fields.get('phase'), fieldName + ' phase')
    : null;
  return Object.freeze({
    blocked: false,
    output: Object.freeze({ id, type, text, phase }),
  });
}

function parseNotification(value) {
  let fields;
  let method;
  try {
    fields = dataFields(value, 'App Server notification', { frozen: true });
    method = safeIdentifier(fields.get('method'), 'notification method');
  } catch {
    return Object.freeze({
      kind: 'error',
      error: adapterError(
        CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_NOTIFICATION
      ),
    });
  }
  if (!['item/started', 'item/completed', 'turn/completed'].includes(method)) {
    return null;
  }

  try {
    const params = dataFields(
      fields.get('params'),
      method + ' params',
      { frozen: true }
    );
    if (method === 'turn/completed') {
      const threadId = safeIdentifier(params.get('threadId'), 'turn thread id');
      const turnFields = dataFields(
        params.get('turn'),
        'completed turn',
        { frozen: true }
      );
      const turnId = safeIdentifier(turnFields.get('id'), 'completed turn id');
      const status = safeIdentifier(
        turnFields.get('status'),
        'completed turn status'
      );
      if (!TERMINAL_TURN_STATUSES.has(status)) {
        throw new TypeError('completed turn status is invalid');
      }
      const outputs = [];
      let blocked = false;
      for (const item of denseArrayValues(
        turnFields.get('items'),
        'completed turn items',
        512
      )) {
        const parsed = parseThreadItem(item, 'completed turn item');
        blocked = blocked || parsed.blocked;
        if (parsed.output) outputs.push(parsed.output);
      }
      return Object.freeze({
        kind: blocked ? 'blocked' : 'terminal',
        threadId,
        turnId,
        status,
        outputs: Object.freeze(outputs),
      });
    }

    const threadId = safeIdentifier(params.get('threadId'), 'item thread id');
    const turnId = safeIdentifier(params.get('turnId'), 'item turn id');
    if (method === 'item/completed') {
      const completedAtMs = params.get('completedAtMs');
      if (!Number.isSafeInteger(completedAtMs) || completedAtMs < 0) {
        throw new TypeError('item completion timestamp is invalid');
      }
    }
    const parsed = parseThreadItem(
      params.get('item'),
      method + ' item',
      { allowIncompleteText: method === 'item/started' }
    );
    if (parsed.blocked) {
      return Object.freeze({ kind: 'blocked', threadId, turnId });
    }
    if (method === 'item/completed' && parsed.output) {
      return Object.freeze({
        kind: 'output',
        threadId,
        turnId,
        output: parsed.output,
      });
    }
    return Object.freeze({ kind: 'other', threadId, turnId });
  } catch {
    return Object.freeze({
      kind: 'error',
      error: adapterError(
        CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_NOTIFICATION
      ),
    });
  }
}

function createTurnObserver(timeoutMs) {
  const buffered = [];
  const outputs = new Map();
  let binding = null;
  let resolveCompletion = null;
  let rejectCompletion = null;
  let completionTimer = null;
  let settled = false;
  let disposed = false;

  function settle(error, value) {
    if (settled) return;
    settled = true;
    if (completionTimer) clearTimeout(completionTimer);
    completionTimer = null;
    if (error) rejectCompletion(error);
    else resolveCompletion(value);
  }

  function processEvent(event) {
    if (settled || disposed) return;
    if (event.kind === 'error') {
      settle(event.error);
      return;
    }
    if (event.threadId !== binding.threadId || event.turnId !== binding.turnId) {
      return;
    }
    if (event.kind === 'blocked') {
      settle(adapterError(
        CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TOOL_USE_BLOCKED
      ));
      return;
    }
    if (event.kind === 'output') {
      outputs.set(event.output.id, event.output);
      return;
    }
    if (event.kind !== 'terminal') return;
    for (const output of event.outputs) outputs.set(output.id, output);
    if (event.status === 'failed') {
      settle(adapterError(
        CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TURN_FAILED
      ));
      return;
    }
    if (event.status === 'interrupted') {
      settle(adapterError(
        CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TURN_INTERRUPTED
      ));
      return;
    }
    settle(null, Object.freeze({
      status: event.status,
      outputs: Object.freeze([...outputs.values()]),
    }));
  }

  function receive(notification) {
    if (settled || disposed) return;
    const event = parseNotification(notification);
    if (!event) return;
    if (!binding) {
      if (buffered.length >= MAX_NOTIFICATION_BUFFER) {
        buffered.length = 0;
        buffered.push(Object.freeze({
          kind: 'error',
          error: adapterError(
            CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_NOTIFICATION
          ),
        }));
        return;
      }
      buffered.push(event);
      return;
    }
    processEvent(event);
  }

  function bind(threadId, turnId) {
    if (binding || disposed) {
      return Promise.reject(adapterError(
        CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.INVALID_NOTIFICATION
      ));
    }
    binding = Object.freeze({ threadId, turnId });
    return new Promise((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
      for (const event of buffered) {
        processEvent(event);
        if (settled) break;
      }
      buffered.length = 0;
      if (!settled) {
        completionTimer = setTimeout(() => {
          settle(adapterError(
            CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TURN_TIMEOUT
          ));
        }, timeoutMs);
      }
    });
  }

  function dispose() {
    disposed = true;
    buffered.length = 0;
    if (completionTimer) clearTimeout(completionTimer);
    completionTimer = null;
  }

  return Object.freeze({ receive, bind, dispose });
}

function selectAuthoritativeOutput(outputs) {
  const plans = outputs.filter((item) => item.type === 'plan');
  if (plans.length) return plans[plans.length - 1];
  const finalAnswers = outputs.filter(
    (item) => item.type === 'agentMessage' && item.phase === 'final_answer'
  );
  if (finalAnswers.length) return finalAnswers[finalAnswers.length - 1];
  const messages = outputs.filter((item) => item.type === 'agentMessage');
  return messages.length ? messages[messages.length - 1] : null;
}

async function bestEffortInterrupt(state, threadId, turnId) {
  try {
    const request = createCodexAppServerShadowTurnInterruptRequest({
      id: nextRequestId(state),
      threadId,
      turnId,
    });
    await callAsyncPort(state.client, 'request', [request]);
  } catch {
    // The original terminal reason remains authoritative.
  }
}

async function runPlan(state, request) {
  const inspected = inspectPlanRequest(state, request);
  const prompt = buildPlanningPrompt(request, inspected);
  await callAsyncPort(state.client, 'start', []);
  const disabledMcpServerNames = readClientIsolationProfile(state.client);

  const threadResult = await callAsyncPort(state.client, 'request', [
    createCodexAppServerShadowThreadStartRequest({
      id: nextRequestId(state),
      cwd: inspected.rootPath,
      model: state.model,
      disabledMcpServerNames,
    }),
  ]);
  const threadId = parseThreadStartResult(threadResult);
  const observer = createTurnObserver(state.completionTimeoutMs);
  let unsubscribe = null;
  try {
    try {
      unsubscribe = Reflect.apply(
        state.client.subscribe,
        state.client.receiver,
        [observer.receive]
      );
    } catch {
      throw adapterError(
        CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TRANSPORT_FAILED
      );
    }
    if (typeof unsubscribe !== 'function' || !Object.isFrozen(unsubscribe)) {
      throw adapterError(
        CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TRANSPORT_FAILED
      );
    }

    const turnResult = await callAsyncPort(state.client, 'request', [
      createCodexAppServerShadowTurnStartRequest({
        id: nextRequestId(state),
        threadId,
        cwd: inspected.rootPath,
        prompt,
      }),
    ]);
    const turnId = parseTurnStartResult(turnResult);
    let completion;
    try {
      completion = await observer.bind(threadId, turnId);
    } catch (error) {
      if (INTERRUPTIBLE_REASONS.has(error && error.code)) {
        await bestEffortInterrupt(state, threadId, turnId);
      }
      throw error;
    }
    const outputItem = selectAuthoritativeOutput(completion.outputs);
    if (!outputItem) {
      throw adapterError(
        CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.OUTPUT_MISSING
      );
    }

    return deepFreeze({
      ok: true,
      response: outputItem.text,
      action: null,
      meta: {
        planner: CODEX_APP_SERVER_KERNEL_ID,
        reason: 'shadow_plan_completed',
        shadow: true,
        readOnly: true,
        contextPackId: inspected.manifest.packId,
        contextPackSurface: inspected.manifest.surface,
        threadId,
        turnId,
        turnStatus: completion.status,
        outputItemId: outputItem.id,
        outputItemType: outputItem.type,
      },
    });
  } finally {
    observer.dispose();
    if (unsubscribe) {
      try {
        Reflect.apply(unsubscribe, undefined, []);
      } catch {
        // Observer cleanup is best-effort after the turn has terminated.
      }
    }
  }
}

class CodexAppServerKernelAdapter extends AgentKernel {
  constructor(options = {}) {
    const fields = dataFields(options, 'Codex App Server kernel adapter options');
    const allowedKeys = new Set([
      'client',
      'completionTimeoutMs',
      'maxActivePlans',
      'model',
      'promptProjector',
      'requestIdFactory',
    ]);
    if ([...fields.keys()].some((key) => !allowedKeys.has(key))) {
      throw new TypeError('Codex App Server kernel adapter options are invalid');
    }
    const client = captureFrozenPort(
      fields.get('client'),
      ['start', 'isolationProfile', 'request', 'subscribe', 'status'],
      'client'
    );
    const promptProjector = captureFrozenPort(
      fields.get('promptProjector'),
      ['project', 'diagnostics'],
      'promptProjector'
    );
    const completionTimeoutMs = boundedInteger(
      fields.get('completionTimeoutMs'),
      DEFAULT_COMPLETION_TIMEOUT_MS,
      10,
      10 * 60 * 1000,
      'completionTimeoutMs'
    );
    const maxActivePlans = boundedInteger(
      fields.get('maxActivePlans'),
      DEFAULT_MAX_ACTIVE_PLANS,
      1,
      64,
      'maxActivePlans'
    );
    const modelValue = fields.get('model');
    const model = modelValue === undefined || modelValue === null
      ? undefined
      : safeIdentifier(modelValue, 'model');
    let defaultSequence = 0;
    const requestIdFactory = fields.has('requestIdFactory')
      ? inspectableFunction(fields.get('requestIdFactory'), 'requestIdFactory')
      : () => {
        defaultSequence += 1;
        return 'faber-shadow-rpc-' + defaultSequence;
      };

    super({
      id: CODEX_APP_SERVER_KERNEL_ID,
      version: CODEX_APP_SERVER_KERNEL_ADAPTER_VERSION,
      capabilities: [HARNESS_OPERATIONS.PLAN],
    });
    PRIVATE_STATE.set(this, {
      client,
      completionTimeoutMs,
      maxActivePlans,
      model,
      promptProjector,
      requestIdFactory,
      activePlans: 0,
      completedPlans: 0,
      failedPlans: 0,
      lastFailureCode: null,
    });
    Object.freeze(this);
  }

  async plan(request) {
    const state = PRIVATE_STATE.get(this);
    if (state.activePlans >= state.maxActivePlans) {
      const error = adapterError(
        CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.CAPACITY_EXCEEDED
      );
      state.failedPlans += 1;
      state.lastFailureCode = error.code;
      throw error;
    }
    state.activePlans += 1;
    let output = null;
    let failure = null;
    try {
      output = await runPlan(state, request);
      state.completedPlans += 1;
      state.lastFailureCode = null;
    } catch (error) {
      failure = normalizeFailure(
        error,
        CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS.TRANSPORT_FAILED
      );
      state.failedPlans += 1;
      state.lastFailureCode = failure.code;
    } finally {
      state.activePlans -= 1;
    }
    if (failure) throw failure;
    return createHarnessResult({
      requestId: request.requestId,
      operation: request.operation,
      kernelId: this.id,
      output,
      diagnostics: this.getDiagnostics(),
    });
  }

  getDiagnostics() {
    const state = PRIVATE_STATE.get(this);
    const clientStatus = readClientStatus(state.client);
    return deepFreeze({
      ...super.getDiagnostics(),
      shadow: true,
      readOnly: true,
      activePlans: state.activePlans,
      completedPlans: state.completedPlans,
      failedPlans: state.failedPlans,
      lastFailureCode: state.lastFailureCode,
      clientState: clientStatus.state,
      clientRunning: clientStatus.running,
    });
  }
}

function createCodexAppServerKernelAdapter(options = {}) {
  return new CodexAppServerKernelAdapter(options);
}

module.exports = {
  CODEX_APP_SERVER_KERNEL_ADAPTER_REASONS,
  CODEX_APP_SERVER_KERNEL_ADAPTER_VERSION,
  CODEX_APP_SERVER_KERNEL_ID,
  CodexAppServerKernelAdapter,
  CodexAppServerKernelAdapterError,
  createCodexAppServerKernelAdapter,
};
