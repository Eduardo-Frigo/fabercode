'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  PROJECT_CAPABILITY_EFFECTS,
  PROJECT_CAPABILITY_KINDS,
  createProjectCapabilityDescriptor,
  createProjectCapabilityRequest,
} = require('../capabilities/project_capability_contracts');
const {
  CapabilityEffectClassifier,
} = require('../capabilities/capability_effect_classifier');
const {
  CapabilityPolicyService,
} = require('../capabilities/capability_policy_service');
const {
  createProjectCapabilityBroker,
} = require('../capabilities/project_capability_broker');
const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  SANDBOX_COMMAND_KINDS,
} = require('../capabilities/sandbox_backend_contract');
const {
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');

const AGENTIC_GIT_READ_BROKER_FACTORY_VERSION = 'agentic-git-read-broker-factory.v1';
const AGENTIC_GIT_READ_ROUTE_VERSION = 'agentic-git-read-route.v1';
const AGENTIC_GIT_READ_DESCRIPTOR_VERSION = 'agentic-git-read-descriptor.v1';
const GIT_CAPABILITY = 'git';
const GIT_STATUS_ACTION = 'status';
const GIT_STATUS_FORMAT = 'git-status-porcelain-v1';
const GIT_STATUS_COMMAND_TIMEOUT_MS = 25_000;
const GIT_STATUS_WAIT_TIMEOUT_MS = 30_000;
const GIT_STATUS_MAX_OUTPUT_BYTES = 256 * 1024;
const GIT_STATUS_MAX_WAIT_REVISIONS = 256;
const GIT_STATUS_MAX_ENTRIES = 10_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const BROKER_EXECUTION_ID = /^sandbox-exec:[a-f0-9]{64}$/;
const PROCESS_STATUSES = new Set([
  'running',
  'succeeded',
  'failed',
  'stopped',
  'timed_out',
]);
const TERMINAL_PROCESS_STATUSES = new Set([
  'succeeded',
  'failed',
  'stopped',
  'timed_out',
]);
const CONFLICT_STATUSES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const GIT_STATUS_STOP_REASON = 'AGENTIC_GIT_STATUS_WAIT_LIMIT';
const GIT_STATUS_ARGS = Object.freeze([
  '--no-optional-locks',
  '--no-pager',
  '-c',
  'core.quotepath=false',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  'submodule.recurse=false',
  'status',
  '--porcelain=v1',
  '--branch',
  '--untracked-files=all',
  '--ignore-submodules=all',
]);
const OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'sandboxRegistry',
  'audit',
  'now',
  'requestIdFactory',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'sandboxRegistry',
]);
const CREATE_KEYS = Object.freeze(['binding', 'sandboxExecutor']);
const BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const SNAPSHOT_KEYS = Object.freeze([
  'version',
  'executionId',
  'status',
  'revision',
  'exitCode',
  'signal',
  'timedOut',
  'stopped',
  'availableFromCursor',
  'outputCursor',
]);

function exactOwnDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      preflightDataGraph(error);
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      return null;
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function captureFrozenOwnMethod(receiver, name, fieldName) {
  if (!receiver || typeof receiver !== 'object' || util.types.isProxy(receiver)
    || !Object.isFrozen(receiver)) {
    throw new TypeError(fieldName + ' must be a frozen trusted object');
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(receiver, name);
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError(fieldName + '.' + name + ' is invalid');
  }
  if (!descriptor || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) {
    throw new TypeError(fieldName + '.' + name + ' must be an own data method');
  }
  return Object.freeze({ receiver, method: descriptor.value });
}

function dataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (error) {
    preflightDataGraph(error);
    return undefined;
  }
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function sameBinding(left, right) {
  return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function normalizeLifecycleAuthorization(raw, expectedBinding) {
  if (util.types.isPromise(raw) || !raw || typeof raw !== 'object'
    || Array.isArray(raw) || util.types.isProxy(raw)
    || dataValue(raw, 'authorized') !== true) return null;
  try {
    const authorizedBinding = createCapabilityDelegationBinding(dataValue(raw, 'binding'));
    return sameBinding(authorizedBinding, expectedBinding) ? authorizedBinding : null;
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
}

function normalizeRootAuthorization(raw, expectedBinding) {
  if (util.types.isPromise(raw) || !raw || typeof raw !== 'object'
    || Array.isArray(raw) || util.types.isProxy(raw)
    || dataValue(raw, 'authorized') !== true
    || (Object.hasOwn(raw, 'ok') && dataValue(raw, 'ok') !== true)
    || dataValue(raw, 'projectId') !== expectedBinding.projectId) return null;
  const canonicalRootPath = dataValue(raw, 'canonicalRootPath') || dataValue(raw, 'rootPath');
  if (canonicalRootPath !== expectedBinding.canonicalRootPath
    || dataValue(raw, 'realRootPath') !== expectedBinding.realRootPath) return null;
  return Object.freeze({
    authorized: true,
    projectId: expectedBinding.projectId,
    rootPath: expectedBinding.canonicalRootPath,
    canonicalRootPath: expectedBinding.canonicalRootPath,
    realRootPath: expectedBinding.realRootPath,
  });
}

function sessionMatchesBinding(session, binding) {
  return Boolean(session) && typeof session === 'object' && !Array.isArray(session)
    && !util.types.isProxy(session)
    && dataValue(session, 'projectId') === binding.projectId
    && dataValue(session, 'sessionId') === binding.sessionId
    && dataValue(session, 'jobId') === binding.jobId
    && dataValue(session, 'rootPath') === binding.canonicalRootPath
    && dataValue(session, 'realRootPath') === binding.realRootPath;
}

function safeInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && !Object.is(value, -0)
    && value >= minimum && value <= maximum;
}

function gitStatusFailure(code) {
  return Object.freeze({
    ok: false,
    code,
    format: GIT_STATUS_FORMAT,
  });
}

function normalizeProcessSnapshot(value, expectedExecutionId, expectedVersion) {
  const fields = exactOwnDataFields(value, SNAPSHOT_KEYS, SNAPSHOT_KEYS);
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== expectedVersion
    || fields.get('executionId') !== expectedExecutionId
    || !BROKER_EXECUTION_ID.test(fields.get('executionId'))
    || !PROCESS_STATUSES.has(fields.get('status'))
    || !safeInteger(fields.get('revision'), 1)
    || !safeInteger(fields.get('availableFromCursor'))
    || !safeInteger(fields.get('outputCursor'))
    || fields.get('availableFromCursor') > fields.get('outputCursor')) return null;
  const exitCode = fields.get('exitCode');
  const signal = fields.get('signal');
  const timedOut = fields.get('timedOut');
  const stopped = fields.get('stopped');
  if ((exitCode !== null && !safeInteger(exitCode))
    || (signal !== null && (typeof signal !== 'string'
      || !/^[A-Z][A-Z0-9_]{0,31}$/.test(signal)))
    || typeof timedOut !== 'boolean' || typeof stopped !== 'boolean') return null;
  const status = fields.get('status');
  if (status === 'running' && (exitCode !== null || signal !== null || timedOut || stopped)) {
    return null;
  }
  if (status === 'succeeded' && (exitCode !== 0 || signal !== null || timedOut || stopped)) {
    return null;
  }
  if (status === 'failed'
    && ((exitCode === null && signal === null) || exitCode === 0 || timedOut || stopped)) {
    return null;
  }
  if (status === 'stopped' && (!stopped || timedOut)) return null;
  if (status === 'timed_out' && (!timedOut || stopped)) return null;
  return Object.freeze({
    executionId: expectedExecutionId,
    status,
    revision: fields.get('revision'),
    exitCode,
    signal,
    timedOut,
    stopped,
    availableFromCursor: fields.get('availableFromCursor'),
    outputCursor: fields.get('outputCursor'),
  });
}

function normalizeWaitResult(value, expectedExecutionId, afterRevision) {
  const fields = exactOwnDataFields(value, [...SNAPSHOT_KEYS, 'changed']);
  const snapshot = fields
    ? normalizeProcessSnapshot(
      Object.freeze(Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, fields.get(key)]))),
      expectedExecutionId,
      'process-supervisor-wait-result.v1'
    )
    : null;
  const changed = fields && fields.get('changed');
  if (!snapshot || typeof changed !== 'boolean'
    || snapshot.revision < afterRevision
    || changed !== (snapshot.revision > afterRevision)) return null;
  return Object.freeze({ ...snapshot, changed });
}

function exactDenseFrozenArray(value, maximum) {
  if (!Array.isArray(value) || !Object.isFrozen(value)
    || util.types.isProxy(value) || value.length > maximum) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  return keys.length === value.length
    && keys.every((key, index) => key === String(index))
    ? keys
    : null;
}

function normalizeReadResult(value, expectedExecutionId, expectedSnapshot) {
  const keys = [...SNAPSHOT_KEYS, 'cursor', 'nextCursor', 'truncated', 'chunks', 'eof'];
  const fields = exactOwnDataFields(value, keys, keys);
  const snapshot = fields
    ? normalizeProcessSnapshot(
      Object.freeze(Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, fields.get(key)]))),
      expectedExecutionId,
      'process-supervisor-read-result.v1'
    )
    : null;
  if (!snapshot || !TERMINAL_PROCESS_STATUSES.has(snapshot.status)
    || snapshot.status !== expectedSnapshot.status
    || snapshot.revision !== expectedSnapshot.revision
    || snapshot.exitCode !== expectedSnapshot.exitCode
    || snapshot.outputCursor !== expectedSnapshot.outputCursor
    || fields.get('cursor') !== 0
    || fields.get('nextCursor') !== snapshot.outputCursor
    || fields.get('truncated') !== false
    || fields.get('eof') !== true
    || snapshot.availableFromCursor !== 0) return null;
  const chunks = fields.get('chunks');
  const chunkKeys = exactDenseFrozenArray(chunks, 16_384);
  if (!chunkKeys) return null;
  let cursor = 0;
  let stdout = '';
  let stderr = '';
  for (const key of chunkKeys) {
    const chunk = chunks[key];
    const chunkFields = exactOwnDataFields(
      chunk,
      ['startCursor', 'endCursor', 'stream', 'text']
    );
    if (!chunkFields || !Object.isFrozen(chunk)
      || chunkFields.get('startCursor') !== cursor
      || !safeInteger(chunkFields.get('endCursor'), cursor + 1)
      || !['stdout', 'stderr', 'system'].includes(chunkFields.get('stream'))
      || typeof chunkFields.get('text') !== 'string'
      || chunkFields.get('text').includes('\0')) return null;
    const text = chunkFields.get('text');
    const bytes = Buffer.byteLength(text, 'utf8');
    if (chunkFields.get('endCursor') - cursor !== bytes) return null;
    cursor = chunkFields.get('endCursor');
    if (chunkFields.get('stream') === 'stdout') stdout += text;
    else stderr += text;
  }
  if (cursor !== snapshot.outputCursor
    || Buffer.byteLength(stdout, 'utf8') + Buffer.byteLength(stderr, 'utf8')
      !== snapshot.outputCursor) return null;
  return Object.freeze({ stdout, stderr });
}

function parseGitStatus(stdout) {
  if (typeof stdout !== 'string' || stdout.length < 4 || stdout.includes('\0')
    || Buffer.byteLength(stdout, 'utf8') > GIT_STATUS_MAX_OUTPUT_BYTES) {
    return gitStatusFailure('GIT_STATUS_INVALID_OUTPUT');
  }
  const lines = stdout.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length < 1 || !lines[0].startsWith('## ')) {
    return gitStatusFailure('GIT_STATUS_INVALID_OUTPUT');
  }
  const branch = lines.shift().slice(3);
  if (!branch || branch.length > 4096) {
    return gitStatusFailure('GIT_STATUS_INVALID_OUTPUT');
  }
  if (lines.length > GIT_STATUS_MAX_ENTRIES) {
    return gitStatusFailure('GIT_STATUS_ENTRY_LIMIT_EXCEEDED');
  }
  const entries = [];
  const counts = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };
  for (const line of lines) {
    if (line.length < 4 || line[2] !== ' ') {
      return gitStatusFailure('GIT_STATUS_INVALID_OUTPUT');
    }
    const status = line.slice(0, 2);
    const path = line.slice(3);
    if (!/^[ MADRCU?!T]{2}$/.test(status) || !path || path.includes('\0')) {
      return gitStatusFailure('GIT_STATUS_INVALID_OUTPUT');
    }
    if (status === '??') {
      counts.untracked += 1;
    } else if (CONFLICT_STATUSES.has(status)) {
      counts.conflicted += 1;
    } else {
      if (status[0] !== ' ' && status[0] !== '!') counts.staged += 1;
      if (status[1] !== ' ' && status[1] !== '!') counts.unstaged += 1;
    }
    entries.push(Object.freeze({ status, path }));
  }
  return Object.freeze({
    ok: true,
    format: GIT_STATUS_FORMAT,
    branch,
    clean: entries.length === 0,
    counts: Object.freeze(counts),
    entries: Object.freeze(entries),
  });
}

function processFailureForSnapshot(snapshot) {
  if (snapshot.status === 'timed_out') return 'GIT_STATUS_TIMED_OUT';
  if (snapshot.status === 'stopped') return 'GIT_STATUS_STOPPED';
  return 'GIT_STATUS_COMMAND_FAILED';
}

function invokeCaptured(captured, args) {
  let raw;
  try {
    raw = Reflect.apply(captured.method, captured.receiver, args);
  } catch (error) {
    preflightDataGraph(error);
    return Promise.resolve(Object.freeze({ ok: false, value: null }));
  }
  if (!util.types.isPromise(raw)) {
    preflightDataGraph(raw);
    return Promise.resolve(Object.freeze({ ok: false, value: null }));
  }
  return new Promise((resolve) => {
    const onFulfilled = (value) => resolve(Object.freeze({ ok: true, value }));
    const onRejected = (error) => {
      preflightDataGraph(error);
      resolve(Object.freeze({ ok: false, value: null }));
    };
    try {
      Reflect.apply(Promise.prototype.then, raw, [onFulfilled, onRejected]);
    } catch (error) {
      preflightDataGraph(error);
      resolve(Object.freeze({ ok: false, value: null }));
    }
  });
}

function createAgenticGitReadBrokerFactory(options = {}) {
  const optionFields = exactOwnDataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS);
  if (!optionFields) throw new TypeError('Invalid agentic Git read broker factory options');
  const authorizeLifecycle = optionFields.get('authorizeLifecycle');
  const authorizeRoot = optionFields.get('authorizeRoot');
  const authorizeEffectFrontier = optionFields.get('authorizeEffectFrontier');
  const sandboxRegistry = optionFields.get('sandboxRegistry');
  const audit = optionFields.has('audit') ? optionFields.get('audit') : () => {};
  const now = optionFields.has('now') ? optionFields.get('now') : () => Date.now();
  const requestIdFactory = optionFields.has('requestIdFactory')
    ? optionFields.get('requestIdFactory')
    : () => 'agentic-git-status:' + crypto.randomUUID();
  for (const [name, callback] of [
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeEffectFrontier', authorizeEffectFrontier],
    ['audit', audit],
    ['now', now],
    ['requestIdFactory', requestIdFactory],
  ]) {
    if (typeof callback !== 'function' || util.types.isProxy(callback)) {
      throw new TypeError(name + ' must be a function');
    }
  }
  captureFrozenOwnMethod(sandboxRegistry, 'select', 'sandboxRegistry');

  let routesCreated = 0;
  let totalRequests = 0;

  function createRoute(input = {}) {
    const fields = exactOwnDataFields(input, CREATE_KEYS, CREATE_KEYS);
    if (!fields) throw new TypeError('Agentic Git read route input contains unsupported fields');
    let binding;
    try {
      binding = createCapabilityDelegationBinding(fields.get('binding'));
    } catch (error) {
      preflightDataGraph(error);
      throw new TypeError('Agentic Git read route binding is invalid');
    }
    const sandboxExecutor = fields.get('sandboxExecutor');
    const processExecute = captureFrozenOwnMethod(
      sandboxExecutor,
      'execute',
      'sandboxExecutor'
    );
    const processRead = captureFrozenOwnMethod(
      sandboxExecutor,
      'read',
      'sandboxExecutor'
    );
    const processWait = captureFrozenOwnMethod(
      sandboxExecutor,
      'wait',
      'sandboxExecutor'
    );
    const processStop = captureFrozenOwnMethod(
      sandboxExecutor,
      'stop',
      'sandboxExecutor'
    );

    function rootAuthorization() {
      let raw;
      try {
        raw = authorizeRoot(Object.freeze({
          projectId: binding.projectId,
          rootPath: binding.canonicalRootPath,
        }));
      } catch (error) {
        preflightDataGraph(error);
        return null;
      }
      return normalizeRootAuthorization(raw, binding);
    }

    function lifecycleAuthorization() {
      let raw;
      try {
        raw = authorizeLifecycle(binding);
      } catch (error) {
        preflightDataGraph(error);
        return null;
      }
      return normalizeLifecycleAuthorization(raw, binding);
    }

    function authorizeSession(session) {
      if (!sessionMatchesBinding(session, binding)
        || !rootAuthorization() || !lifecycleAuthorization()) {
        return Object.freeze({ authorized: false });
      }
      return Object.freeze({ authorized: true, projectSession: session });
    }

    function authorizeEffect(session) {
      if (!sessionMatchesBinding(session, binding)) {
        return Object.freeze({ authorized: false });
      }
      let raw;
      try {
        raw = authorizeEffectFrontier(binding);
      } catch (error) {
        preflightDataGraph(error);
        return Object.freeze({ authorized: false });
      }
      if (!normalizeLifecycleAuthorization(raw, binding)) {
        return Object.freeze({ authorized: false });
      }
      return Object.freeze({ authorized: true, projectSession: session });
    }

    function controlAuthorized() {
      if (!rootAuthorization() || !lifecycleAuthorization()) return false;
      let raw;
      try {
        raw = authorizeEffectFrontier(binding);
      } catch (error) {
        preflightDataGraph(error);
        return false;
      }
      return Boolean(normalizeLifecycleAuthorization(raw, binding));
    }

    async function stopAfterWaitLimit(executionId, revision) {
      if (!controlAuthorized()) return;
      await invokeCaptured(processStop, [Object.freeze({
        executionId,
        expectedRevision: revision,
        reasonCode: GIT_STATUS_STOP_REASON,
      })]);
    }

    async function executeGitStatus(sandboxRequest, executionContext) {
      const executionId = dataValue(sandboxRequest, 'executionId');
      if (typeof executionId !== 'string' || !BROKER_EXECUTION_ID.test(executionId)
        || !controlAuthorized()) {
        return gitStatusFailure('GIT_STATUS_AUTHORITY_DENIED');
      }
      const started = await invokeCaptured(processExecute, [
        sandboxRequest,
        executionContext,
      ]);
      if (!started.ok) return gitStatusFailure('GIT_STATUS_EXECUTION_FAILED');
      let snapshot = normalizeProcessSnapshot(
        started.value,
        executionId,
        'process-supervisor-exec-receipt.v1'
      );
      if (!snapshot) return gitStatusFailure('GIT_STATUS_INVALID_PROCESS_RESULT');

      let waits = 0;
      while (snapshot.status === 'running' && waits < GIT_STATUS_MAX_WAIT_REVISIONS) {
        if (!controlAuthorized()) {
          return gitStatusFailure('GIT_STATUS_AUTHORITY_DENIED');
        }
        const waited = await invokeCaptured(processWait, [Object.freeze({
          executionId,
          afterRevision: snapshot.revision,
          timeoutMs: GIT_STATUS_WAIT_TIMEOUT_MS,
        })]);
        if (!waited.ok) return gitStatusFailure('GIT_STATUS_WAIT_FAILED');
        snapshot = normalizeWaitResult(waited.value, executionId, snapshot.revision);
        if (!snapshot) return gitStatusFailure('GIT_STATUS_INVALID_PROCESS_RESULT');
        waits += 1;
      }
      if (snapshot.status === 'running') {
        await stopAfterWaitLimit(executionId, snapshot.revision);
        return gitStatusFailure('GIT_STATUS_WAIT_LIMIT_EXCEEDED');
      }
      if (snapshot.outputCursor > GIT_STATUS_MAX_OUTPUT_BYTES
        || snapshot.availableFromCursor !== 0) {
        return gitStatusFailure('GIT_STATUS_OUTPUT_TOO_LARGE');
      }
      if (snapshot.outputCursor === 0) {
        return gitStatusFailure(processFailureForSnapshot(snapshot));
      }
      if (!controlAuthorized()) {
        return gitStatusFailure('GIT_STATUS_AUTHORITY_DENIED');
      }
      const read = await invokeCaptured(processRead, [Object.freeze({
        executionId,
        cursor: 0,
        maxBytes: snapshot.outputCursor,
      })]);
      if (!read.ok) return gitStatusFailure('GIT_STATUS_READ_FAILED');
      const output = normalizeReadResult(read.value, executionId, snapshot);
      if (!output) return gitStatusFailure('GIT_STATUS_INVALID_PROCESS_RESULT');
      if (snapshot.status !== 'succeeded' || snapshot.exitCode !== 0) {
        return gitStatusFailure(processFailureForSnapshot(snapshot));
      }
      return parseGitStatus(output.stdout);
    }

    const brokerSandboxExecutor = Object.freeze({ execute: executeGitStatus });
    const descriptor = createProjectCapabilityDescriptor({
      capability: GIT_CAPABILITY,
      action: GIT_STATUS_ACTION,
      version: AGENTIC_GIT_READ_DESCRIPTOR_VERSION,
      kind: PROJECT_CAPABILITY_KINDS.GIT,
      effects: [
        PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ,
        PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE,
      ],
      requiresSandbox: true,
      risk: 'low',
      canonicalizePayload() {
        return Object.freeze({});
      },
      createSandboxExecutionSpec() {
        return Object.freeze({
          command: Object.freeze({
            kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
            executable: 'git',
            args: GIT_STATUS_ARGS,
          }),
          timeoutMs: GIT_STATUS_COMMAND_TIMEOUT_MS,
        });
      },
    });
    const broker = createProjectCapabilityBroker({
      authorizeProjectSession: authorizeSession,
      authorizeProjectEffect: authorizeEffect,
      descriptorResolver: Object.freeze({
        resolve(capability, action) {
          return capability === GIT_CAPABILITY && action === GIT_STATUS_ACTION
            ? descriptor
            : null;
        },
      }),
      classifier: new CapabilityEffectClassifier(),
      policy: new CapabilityPolicyService(),
      grantStore: Object.freeze({
        inspect() { return Object.freeze({ authorized: false, reason: 'grant_not_found' }); },
        consume() { return Object.freeze({ authorized: false, reason: 'grant_not_found' }); },
      }),
      pendingApprovalStore: Object.freeze({
        create() { throw new Error('Read-only Git status must not request external approval'); },
        resolve() { throw new Error('Read-only Git status has no pending approval'); },
      }),
      approvalReviewer: Object.freeze({
        verifyDecision() { return Object.freeze({ verified: false }); },
      }),
      sandboxRegistry,
      sandboxExecutor: brokerSandboxExecutor,
      buildSandboxEnvironment() { return Object.freeze({}); },
      audit: Object.freeze({ record(event) { return audit(event); } }),
      now,
    });
    let requests = 0;
    let completed = 0;
    let failed = 0;

    async function readStatus() {
      if (arguments.length !== 0) {
        throw new TypeError('Git status does not accept model-controlled input');
      }
      let requestId;
      try {
        requestId = requestIdFactory();
      } catch (error) {
        preflightDataGraph(error);
        throw new TypeError('Agentic Git status request id generation failed');
      }
      if (util.types.isPromise(requestId) || typeof requestId !== 'string'
        || !REQUEST_ID_PATTERN.test(requestId)) {
        preflightDataGraph(requestId);
        throw new TypeError('Agentic Git status request id is invalid');
      }
      requests += 1;
      totalRequests += 1;
      const request = createProjectCapabilityRequest({
        requestId,
        principal: Object.freeze({ kind: 'agent', kernelId: binding.kernelId }),
        projectSession: Object.freeze({
          sessionId: binding.sessionId,
          projectId: binding.projectId,
          rootPath: binding.canonicalRootPath,
          realRootPath: binding.realRootPath,
          jobId: binding.jobId,
        }),
        capability: GIT_CAPABILITY,
        action: GIT_STATUS_ACTION,
        payload: Object.freeze({}),
        context: Object.freeze({
          origin: 'agentic_tool_loop',
          correlationId: binding.jobId,
        }),
      });
      const result = await broker.execute(request);
      const output = dataValue(result, 'output');
      if (dataValue(result, 'status') === 'completed'
        && dataValue(output, 'ok') === true) completed += 1;
      else failed += 1;
      return result;
    }

    function diagnostics() {
      return Object.freeze({
        version: AGENTIC_GIT_READ_ROUTE_VERSION,
        capability: GIT_CAPABILITY,
        action: GIT_STATUS_ACTION,
        requests,
        completed,
        failed,
        networkMode: 'disabled',
        commandPolicy: 'fixed_read_only',
        authorityBoundary: 'job_binding',
      });
    }

    routesCreated += 1;
    return Object.freeze({
      version: AGENTIC_GIT_READ_ROUTE_VERSION,
      readStatus,
      diagnostics,
    });
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_GIT_READ_BROKER_FACTORY_VERSION,
      descriptorVersion: AGENTIC_GIT_READ_DESCRIPTOR_VERSION,
      routesCreated,
      totalRequests,
      capability: GIT_CAPABILITY,
      action: GIT_STATUS_ACTION,
      networkDefault: 'disabled',
      commandPolicy: 'fixed_read_only',
      authorityBoundary: 'main_process_only',
    });
  }

  return Object.freeze({ createRoute, diagnostics });
}

module.exports = {
  AGENTIC_GIT_READ_BROKER_FACTORY_VERSION,
  AGENTIC_GIT_READ_DESCRIPTOR_VERSION,
  AGENTIC_GIT_READ_ROUTE_VERSION,
  createAgenticGitReadBrokerFactory,
};
