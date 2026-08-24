'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  CONTEXT_PACK_SURFACES,
} = require('../agent_runtime/context_pack_contracts');
const {
  createContextPackHarnessInjector,
} = require('../agent_runtime/context_pack_harness_injector');
const {
  HARNESS_OPERATIONS,
  HARNESS_REQUEST_SCHEMA_VERSION,
  assertHarnessRequest,
} = require('../agent_runtime/harness_contracts');
const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  assertProjectRootAuthorityCloseReceipt,
  assertProjectRootAuthorityLease,
  assertProjectRootReader,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootPhysicalIdentityDigest,
} = require('../capabilities/project_root_authority_contract');
const {
  isPortableAbsolutePath,
} = require('../capabilities/sandbox_backend_contract');
const {
  createContextPackProductionRuntime,
} = require('./context_pack_production_runtime');

const CONTEXT_PACK_HARNESS_PRODUCTION_SERVICE_VERSION =
  'context-pack-harness-production-service.v1';
const MANAGED_RUNTIME_VERSION = 'context-pack-harness-managed-runtime.v1';
const BINDING_SCHEMA_VERSION = 'context-pack-harness-binding.v1';
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_ACTIVE_BINDINGS = 1_024;
const HARD_MAX_ACTIVE_BINDINGS = 10_000;
const MAX_RELEVANT_FILES = 32;
const MAX_CONVERSATION_MESSAGES = 8;
const MAX_REQUEST_CHARS = 16_384;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'applicationMapService',
  'authorizeExecutionBinding',
  'authorizeProjectBinding',
  'getActiveMemory',
  'getProjectRootAuthorityRegistry',
  'gitService',
  'kernelId',
  'milestoneService',
]);
const OPTION_KEYS = Object.freeze([
  ...REQUIRED_OPTION_KEYS,
  'compilerOptions',
  'maxActiveBindings',
  'nonceFactory',
]);
const AUTHORITY_BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const PHYSICAL_IDENTITY_KEYS = Object.freeze([
  'device',
  'inode',
  'entryDevice',
  'entryInode',
  'entryType',
]);

function defaultNonceFactory() {
  return crypto.randomBytes(32).toString('base64url');
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return false;
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch { return false; }
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, fieldName) {
  if (!isPlainRecord(value)) throw new TypeError(`${fieldName} must be a plain data record`);
  const fields = new Map();
  let keys;
  try { keys = Reflect.ownKeys(value); } catch {
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  for (const key of keys) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) {
      throw new TypeError(`${fieldName} contains a forbidden key`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      throw new TypeError(`${fieldName} must contain enumerable data properties only`);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys, fieldName = 'value') {
  const fields = dataFields(value, fieldName);
  if ([...fields.keys()].some((key) => !allowedKeys.includes(key))
    || requiredKeys.some((key) => !fields.has(key))) {
    throw new TypeError(`${fieldName} contains unsupported or missing fields`);
  }
  return fields;
}

function denseArrayValues(value, fieldName, maximum) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    throw new TypeError(`${fieldName} must be a bounded plain array`);
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${fieldName} must be dense`);
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain data values`);
    }
    return descriptor.value;
  });
}

function captureCallback(value, fieldName, { synchronous = false } = {}) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)
    || (synchronous && util.types.isAsyncFunction(value))) {
    throw new TypeError(`${fieldName} must be an inspectable${
      synchronous ? ' synchronous' : ''
    } function`);
  }
  let keys;
  try { keys = Reflect.ownKeys(value); } catch {
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  if (keys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key !== 'string' || !descriptor
      || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable === true;
  })) {
    throw new TypeError(`${fieldName} must not carry enumerable authority`);
  }
  return value;
}

function captureOwnMethod(value, methodName, fieldName) {
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) {
    throw new TypeError(`${fieldName} must be a trusted object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, methodName);
  if (!descriptor || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) {
    throw new TypeError(`${fieldName}.${methodName} must be an own data method`);
  }
  return Object.freeze({ receiver: value, method: descriptor.value });
}

function consumeNativePromise(value) {
  if (!util.types.isPromise(value)) return;
  try { Reflect.apply(Promise.prototype.then, value, [() => {}, () => {}]); } catch {
    // Rejected at the synchronous authority boundary.
  }
}

function callSynchronous(callback, args, fieldName) {
  let value;
  try { value = Reflect.apply(callback, undefined, args); } catch {
    throw new TypeError(`${fieldName} failed`);
  }
  if (util.types.isPromise(value)) {
    consumeNativePromise(value);
    throw new TypeError(`${fieldName} must remain synchronous`);
  }
  return value;
}

function observeNativePromise(value, fieldName) {
  if (!util.types.isPromise(value)) {
    return Promise.reject(new TypeError(`${fieldName} must return a native promise`));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, value, [
        resolve,
        () => reject(new TypeError(`${fieldName} failed`)),
      ]);
    } catch {
      reject(new TypeError(`${fieldName} failed`));
    }
  });
}

function safeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${fieldName} must be a safe identifier`);
  }
  return value;
}

function boundedText(value, fieldName, maximum = MAX_REQUEST_CHARS) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) {
    throw new TypeError(`${fieldName} must be bounded text`);
  }
  return value.trim();
}

function portableAbsolutePath(value, fieldName) {
  if (typeof value !== 'string' || value !== value.trim()
    || value.length > 32_768 || value.includes('\0')
    || !isPortableAbsolutePath(value)
    || value.replace(/\\/g, '/') === '/'
    || /^[A-Za-z]:\/?$/.test(value.replace(/\\/g, '/'))) {
    throw new TypeError(`${fieldName} must be a project absolute path`);
  }
  return value;
}

function safeRelativePath(value, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value !== value.trim()
    || value.length > 4_096 || value.includes('\0') || value.includes('\\')) return null;
  if (allowEmpty && value === '') return '';
  if (!value || value.startsWith('/') || /^[A-Za-z]:\//.test(value)
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  return value;
}

function canonicalDigest(value) {
  return `sha256:${crypto.createHash('sha256')
    .update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function snapshotsMatch(left, right, keys) {
  return keys.every((key) => left[key] === right[key]);
}

function snapshotJson(
  value,
  state = { depth: 0, nodes: 0, stringBytes: 0, seen: new Set() }
) {
  state.nodes += 1;
  if (state.nodes > 20_000 || state.depth > 24) {
    throw new TypeError('ContextPack turn input exceeds its structural bound');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new TypeError('ContextPack turn input contains NUL');
    state.stringBytes += Buffer.byteLength(value, 'utf8');
    if (state.stringBytes > 1024 * 1024) {
      throw new TypeError('ContextPack turn input exceeds its text bound');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('ContextPack turn input contains an invalid number');
    }
    return value;
  }
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) {
    throw new TypeError('ContextPack turn input must be JSON-safe');
  }
  if (state.seen.has(value)) throw new TypeError('ContextPack turn input contains a cycle');
  state.seen.add(value);
  state.depth += 1;
  try {
    if (Array.isArray(value)) {
      return Object.freeze(denseArrayValues(
        value,
        'ContextPack turn array',
        10_000
      ).map((entry) => snapshotJson(entry, state)));
    }
    const fields = dataFields(value, 'ContextPack turn object');
    const output = Object.create(null);
    for (const [key, entry] of fields) output[key] = snapshotJson(entry, state);
    return Object.freeze(output);
  } finally {
    state.depth -= 1;
    state.seen.delete(value);
  }
}

function ownDataValue(fields, key, fallback = undefined) {
  return fields.has(key) ? fields.get(key) : fallback;
}

function hiddenDataValue(value, key, fieldName) {
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) {
    throw new TypeError(`${fieldName} must be a trusted private context`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== false
    || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${fieldName}.${key} must be a private data property`);
  }
  return descriptor.value;
}

function optionalHiddenDataValue(value, key, fieldName) {
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) {
    throw new TypeError(`${fieldName} must be a trusted private context`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return null;
  if (descriptor.enumerable !== false || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${fieldName}.${key} must be a private data property`);
  }
  return descriptor.value;
}

function executionContextFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('executionContext must be a plain private context');
  }
  const publicKeys = new Set(['jobId', 'requestedMode', 'signal']);
  const privateKeys = new Set(['authorityBinding', 'projectRootLease', 'sandboxExecutor']);
  const fields = new Map();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || (!publicKeys.has(key) && !privateKeys.has(key))) {
      throw new TypeError('executionContext contains an unsupported field');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const expectedEnumerable = publicKeys.has(key);
    if (!descriptor || descriptor.enumerable !== expectedEnumerable
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('executionContext authority visibility is invalid');
    }
    if (expectedEnumerable) fields.set(key, descriptor.value);
  }
  if (!fields.has('jobId') || !fields.has('requestedMode') || !fields.has('signal')) {
    throw new TypeError('executionContext is incomplete');
  }
  return fields;
}

function normalizeConversationMessages(value) {
  if (value === undefined) return Object.freeze([]);
  const values = denseArrayValues(value, 'conversationMessages', 1_024)
    .slice(-MAX_CONVERSATION_MESSAGES);
  return Object.freeze(values.map((message, index) => {
    const fields = dataFields(message, `conversationMessages[${index}]`);
    const role = fields.get('role') === 'assistant' ? 'assistant' : 'user';
    const rawText = fields.has('text')
      ? fields.get('text')
      : fields.has('content')
        ? fields.get('content')
        : fields.get('message');
    const text = boundedText(
      typeof rawText === 'string' ? rawText.slice(0, 4_000) : '',
      `conversationMessages[${index}].text`,
      4_000
    );
    return Object.freeze({ role, text });
  }).filter((message) => message.text));
}

function normalizeOptionalIdentifier(value) {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value) ? value : null;
}

function readOptionalContextIdentifier(payloadFields, contextFields, key) {
  const direct = normalizeOptionalIdentifier(ownDataValue(payloadFields, key));
  if (direct !== null) return direct;
  return contextFields ? normalizeOptionalIdentifier(ownDataValue(contextFields, key)) : null;
}

function collectRelativePaths(target, candidate) {
  if (target.length >= MAX_RELEVANT_FILES) return;
  const relativePath = safeRelativePath(candidate);
  if (relativePath !== null && !target.includes(relativePath)) target.push(relativePath);
}

function pathsFromArray(value, fieldName, selector) {
  if (value === undefined) return [];
  try {
    return denseArrayValues(value, fieldName, 10_000).map(selector).filter(Boolean);
  } catch {
    return [];
  }
}

function deriveRelevantFiles({ actionFields, contextFields, projectFields }) {
  const paths = [];
  const actionFiles = actionFields && actionFields.has('files')
    ? pathsFromArray(actionFields.get('files'), 'action.files', (entry) => {
      try { return ownDataValue(dataFields(entry, 'action file'), 'path'); } catch { return null; }
    })
    : [];
  const hintedFiles = contextFields && contextFields.has('relevantFiles')
    ? pathsFromArray(contextFields.get('relevantFiles'), 'contextHint.relevantFiles', (entry) => entry)
    : [];
  const projectFiles = projectFields.has('files')
    ? pathsFromArray(projectFields.get('files'), 'projectInfo.files', (entry) => entry)
    : [];
  for (const candidate of [...actionFiles, ...hintedFiles, ...projectFiles]) {
    collectRelativePaths(paths, candidate);
  }
  return Object.freeze(paths);
}

function redactRoot(text, rootPaths) {
  let output = text;
  for (const rootPath of rootPaths.filter(Boolean).sort((left, right) => right.length - left.length)) {
    output = output.split(rootPath).join('[project-root]');
    const normalized = rootPath.replace(/\\/g, '/');
    if (normalized !== rootPath) output = output.split(normalized).join('[project-root]');
  }
  return output;
}

function normalizeProjectIdentity(projectInfo) {
  const projectFields = dataFields(projectInfo, 'projectInfo');
  const candidates = ['id', 'projectId']
    .filter((key) => projectFields.has(key))
    .map((key) => safeIdentifier(projectFields.get(key), `projectInfo.${key}`));
  if (!candidates.length || candidates.some((candidate) => candidate !== candidates[0])) {
    throw new TypeError('projectInfo identity is missing or inconsistent');
  }
  return Object.freeze({
    projectFields,
    projectId: candidates[0],
    rootPath: portableAbsolutePath(projectFields.get('rootPath'), 'projectInfo.rootPath'),
  });
}

function normalizeAuthorityBinding(value) {
  const canonical = createCapabilityDelegationBinding(value);
  const fields = dataFields(value, 'authority binding');
  if (fields.size !== AUTHORITY_BINDING_KEYS.length
    || !AUTHORITY_BINDING_KEYS.every((key) => fields.has(key))
    || !Object.isFrozen(value)
    || !snapshotsMatch(canonical, value, AUTHORITY_BINDING_KEYS)) {
    throw new TypeError('authority binding is not canonical');
  }
  return canonical;
}

function validateProjectAuthorization(raw, expectedProjectId, expectedRootPath) {
  const fields = dataFields(raw, 'project authorization');
  if (fields.get('authorized') !== true || fields.get('ok') !== true) {
    throw new TypeError('project authorization was denied');
  }
  const projectId = safeIdentifier(fields.get('projectId'), 'authorized projectId');
  const canonicalRootPath = portableAbsolutePath(
    fields.has('canonicalRootPath') ? fields.get('canonicalRootPath') : fields.get('rootPath'),
    'authorized canonicalRootPath'
  );
  const realRootPath = portableAbsolutePath(
    fields.get('realRootPath'),
    'authorized realRootPath'
  );
  if (projectId !== expectedProjectId || canonicalRootPath !== expectedRootPath) {
    throw new TypeError('project authorization changed the requested binding');
  }
  const physicalFields = exactDataFields(
    fields.get('physicalRootIdentity'),
    PHYSICAL_IDENTITY_KEYS,
    PHYSICAL_IDENTITY_KEYS,
    'physicalRootIdentity'
  );
  const physicalRootIdentity = {};
  for (const key of PHYSICAL_IDENTITY_KEYS) physicalRootIdentity[key] = physicalFields.get(key);
  const physicalRootIdentityDigest = createProjectRootPhysicalIdentityDigest(
    physicalRootIdentity
  );
  return Object.freeze({
    projectId,
    canonicalRootPath,
    realRootPath,
    physicalRootIdentityDigest,
  });
}

function projectAuthorizationsMatch(left, right) {
  return snapshotsMatch(left, right, [
    'projectId',
    'canonicalRootPath',
    'realRootPath',
    'physicalRootIdentityDigest',
  ]);
}

function validateExecutionAuthorization(raw, expectedBinding, expectedPhysicalDigest) {
  if (!Object.isFrozen(raw)) throw new TypeError('execution authorization must be frozen');
  const fields = dataFields(raw, 'execution authorization');
  if (fields.get('authorized') !== true || !fields.has('binding')) {
    throw new TypeError('execution authorization was denied');
  }
  const binding = normalizeAuthorityBinding(fields.get('binding'));
  if (!snapshotsMatch(binding, expectedBinding, AUTHORITY_BINDING_KEYS)
    || fields.get('physicalRootIdentityDigest') !== expectedPhysicalDigest) {
    throw new TypeError('execution authorization changed the job binding');
  }
  return Object.freeze({ binding, physicalRootIdentityDigest: expectedPhysicalDigest });
}

function surfaceForRequest(operation, payloadFields, actionFields) {
  if (operation === HARNESS_OPERATIONS.MESSAGE) {
    return ownDataValue(payloadFields, 'isMapChat') === true
      ? CONTEXT_PACK_SURFACES.MAP_CHAT
      : CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE;
  }
  if (operation === HARNESS_OPERATIONS.EXECUTE) {
    const milestoneId = actionFields ? ownDataValue(actionFields, 'milestoneId') : null;
    return typeof milestoneId === 'string' && milestoneId.trim()
      ? CONTEXT_PACK_SURFACES.MILESTONE_EXECUTE
      : CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE;
  }
  return CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE;
}

function createContextPackHarnessProductionService(options = {}) {
  const fields = exactDataFields(
    options,
    OPTION_KEYS,
    REQUIRED_OPTION_KEYS,
    'ContextPack Harness production options'
  );
  const authorizeProjectBinding = captureCallback(
    fields.get('authorizeProjectBinding'),
    'authorizeProjectBinding',
    { synchronous: true }
  );
  const authorizeExecutionBinding = captureCallback(
    fields.get('authorizeExecutionBinding'),
    'authorizeExecutionBinding',
    { synchronous: true }
  );
  const getProjectRootAuthorityRegistry = captureCallback(
    fields.get('getProjectRootAuthorityRegistry'),
    'getProjectRootAuthorityRegistry',
    { synchronous: true }
  );
  const getActiveMemory = captureCallback(fields.get('getActiveMemory'), 'getActiveMemory');
  const nonceFactory = captureCallback(
    fields.has('nonceFactory') ? fields.get('nonceFactory') : defaultNonceFactory,
    'nonceFactory',
    { synchronous: true }
  );
  const kernelId = safeIdentifier(fields.get('kernelId'), 'kernelId');
  const maxActiveBindings = fields.has('maxActiveBindings')
    ? fields.get('maxActiveBindings')
    : MAX_ACTIVE_BINDINGS;
  if (!Number.isSafeInteger(maxActiveBindings) || maxActiveBindings < 1
    || maxActiveBindings > HARD_MAX_ACTIVE_BINDINGS) {
    throw new TypeError('maxActiveBindings is invalid');
  }

  const issuedBindings = new WeakSet();
  const recordsByNonce = new Map();
  const recordsByRequestId = new Map();
  let bindings = 0;
  let collections = 0;
  let rejections = 0;
  let requestLeasesAcquired = 0;
  let requestLeasesClosed = 0;
  let executionLeasesReused = 0;
  let contextPackInjector = null;

  function authorizeProject(projectId, rootPath) {
    return validateProjectAuthorization(
      callSynchronous(
        authorizeProjectBinding,
        [projectId, rootPath],
        'authorizeProjectBinding'
      ),
      projectId,
      rootPath
    );
  }

  function authorizeExecution(binding, physicalDigest) {
    return validateExecutionAuthorization(
      callSynchronous(
        authorizeExecutionBinding,
        [binding],
        'authorizeExecutionBinding'
      ),
      binding,
      physicalDigest
    );
  }

  function nextNonce() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const nonce = callSynchronous(nonceFactory, [], 'nonceFactory');
      if (typeof nonce === 'string' && SAFE_IDENTIFIER.test(nonce)
        && !recordsByNonce.has(nonce)) return nonce;
    }
    throw new TypeError('ContextPack binding nonce is unavailable');
  }

  function validateExecutionLease(leaseValue, binding, physicalDigest) {
    const leaseFields = exactDataFields(leaseValue, [
      'version',
      'leaseId',
      'jobId',
      'projectId',
      'purpose',
      'physicalRootIdentityDigest',
      'authorityDigest',
      'reader',
      'close',
    ], undefined, 'projectRootLease');
    if (!Object.isFrozen(leaseValue) || leaseFields.get('purpose') !== 'execution') {
      throw new TypeError('execution projectRootLease is invalid');
    }
    const expectedRequest = createProjectRootAuthorityAcquireRequest({
      leaseId: leaseFields.get('leaseId'),
      binding,
      expectedPhysicalRootIdentityDigest: physicalDigest,
      purpose: 'execution',
    });
    const lease = assertProjectRootAuthorityLease(leaseValue, expectedRequest);
    assertProjectRootReader(lease.reader);
    return Object.freeze({ lease, expectedRequest });
  }

  function parsePlanningRequest(requestFields, operation) {
    const payload = requestFields.get('payload');
    const payloadFields = dataFields(payload, 'Harness payload');
    const identity = normalizeProjectIdentity(payloadFields.get('projectInfo'));
    const projectAuthorization = authorizeProject(identity.projectId, identity.rootPath);
    const contextHint = payloadFields.has('contextHint')
      && payloadFields.get('contextHint') !== null
      ? snapshotJson(payloadFields.get('contextHint'))
      : Object.freeze(Object.create(null));
    const contextFields = dataFields(contextHint, 'contextHint');
    const conversationMessages = normalizeConversationMessages(
      ownDataValue(payloadFields, 'conversationMessages')
    );
    const requestId = requestFields.get('requestId');
    const conversationId = readOptionalContextIdentifier(
      payloadFields,
      contextFields,
      'conversationId'
    ) || (conversationMessages.length ? requestId : null);
    const userId = readOptionalContextIdentifier(payloadFields, contextFields, 'userId');
    const relativeCwd = safeRelativePath(
      ownDataValue(contextFields, 'relativeCwd', ''),
      { allowEmpty: true }
    ) || '';
    const relevantFiles = deriveRelevantFiles({
      actionFields: null,
      contextFields,
      projectFields: identity.projectFields,
    });
    const attachments = payloadFields.has('attachments')
      ? snapshotJson(payloadFields.get('attachments'))
      : Object.freeze([]);
    const projectSnapshot = snapshotJson(payloadFields.get('projectInfo'));
    const rawRequestText = boundedText(
      typeof ownDataValue(payloadFields, 'userMessage') === 'string'
        ? ownDataValue(payloadFields, 'userMessage').slice(0, MAX_REQUEST_CHARS)
        : '',
      'payload.userMessage'
    ) || (attachments.length ? 'Solicitação com anexos autorizados.' : 'Continuar o turno autorizado.');
    const requestText = redactRoot(rawRequestText, [
      projectAuthorization.canonicalRootPath,
      projectAuthorization.realRootPath,
    ]);
    return Object.freeze({
      actionFields: null,
      attachments,
      conversationId,
      conversationMessages,
      executionBinding: null,
      executionLease: null,
      expectedSurface: surfaceForRequest(operation, payloadFields, null),
      jobId: null,
      permissionsText: 'Leitura contextual autorizada para este projeto; este ContextPack não concede mutações.',
      projectAuthorization,
      projectId: identity.projectId,
      projectInfo: projectSnapshot,
      relativeCwd,
      relevantFiles,
      requestText,
      rootPath: identity.rootPath,
      userId,
      contextHint,
    });
  }

  function parseExecuteRequest(requestFields) {
    const identity = normalizeProjectIdentity(requestFields.get('projectInfo'));
    const projectAuthorization = authorizeProject(identity.projectId, identity.rootPath);
    const action = requestFields.get('action');
    const actionFields = dataFields(action, 'Harness action');
    if (!requestFields.has('executionContext')) {
      throw new TypeError('executionContext is required for ContextPack execution');
    }
    const executionContext = requestFields.get('executionContext');
    if (!Object.isFrozen(executionContext)) {
      throw new TypeError('executionContext must be private and frozen');
    }
    const contextFields = executionContextFields(executionContext);
    const binding = normalizeAuthorityBinding(hiddenDataValue(
      executionContext,
      'authorityBinding',
      'executionContext'
    ));
    if (contextFields.get('jobId') !== binding.jobId
      || binding.projectId !== identity.projectId
      || binding.canonicalRootPath !== identity.rootPath
      || binding.realRootPath !== projectAuthorization.realRootPath
      || binding.kernelId !== kernelId) {
      throw new TypeError('executionContext authority does not match the Harness request');
    }
    authorizeExecution(binding, projectAuthorization.physicalRootIdentityDigest);
    const rawExecutionLease = optionalHiddenDataValue(
      executionContext,
      'projectRootLease',
      'executionContext'
    );
    const executionLease = rawExecutionLease === null
      ? null
      : validateExecutionLease(
        rawExecutionLease,
        binding,
        projectAuthorization.physicalRootIdentityDigest
      ).lease;
    const actionType = typeof ownDataValue(actionFields, 'type') === 'string'
      ? boundedText(ownDataValue(actionFields, 'type').slice(0, 128), 'action.type', 128)
      : 'authorized_action';
    const milestoneId = normalizeOptionalIdentifier(ownDataValue(actionFields, 'milestoneId'));
    const requestText = [
      `Executar ação autorizada do tipo ${actionType || 'authorized_action'}.`,
      milestoneId ? `Milestone: ${milestoneId}.` : '',
    ].filter(Boolean).join(' ');
    const relevantFiles = deriveRelevantFiles({
      actionFields,
      contextFields: null,
      projectFields: identity.projectFields,
    });
    return Object.freeze({
      attachments: Object.freeze([]),
      conversationId: null,
      conversationMessages: Object.freeze([]),
      executionBinding: binding,
      executionLease,
      expectedSurface: surfaceForRequest(HARNESS_OPERATIONS.EXECUTE, null, actionFields),
      jobId: binding.jobId,
      permissionsText: 'Leitura contextual autorizada pelo job; mutações permanecem limitadas às capacidades delegadas.',
      projectAuthorization,
      projectId: identity.projectId,
      projectInfo: snapshotJson(requestFields.get('projectInfo')),
      relativeCwd: '',
      relevantFiles,
      requestText,
      rootPath: identity.rootPath,
      userId: null,
      contextHint: Object.freeze(Object.create(null)),
    });
  }

  function bindRequest(request) {
    bindings += 1;
    try {
      assertHarnessRequest(request);
      if (!Object.isFrozen(request) || recordsByNonce.size >= maxActiveBindings) {
        throw new TypeError('Harness request cannot receive a ContextPack binding');
      }
      const operation = request.operation;
      const allowedKeys = operation === HARNESS_OPERATIONS.EXECUTE
        ? ['action', 'projectInfo', 'executionContext', 'schemaVersion', 'requestId', 'operation']
        : ['payload', 'schemaVersion', 'requestId', 'operation'];
      const requiredKeys = operation === HARNESS_OPERATIONS.EXECUTE
        ? ['action', 'projectInfo', 'executionContext', 'schemaVersion', 'requestId', 'operation']
        : allowedKeys;
      const requestFields = exactDataFields(
        request,
        allowedKeys,
        requiredKeys,
        'Harness request'
      );
      if (requestFields.get('schemaVersion') !== HARNESS_REQUEST_SCHEMA_VERSION
        || requestFields.get('operation') !== operation) {
        throw new TypeError('Harness request contract changed during binding');
      }
      const requestId = safeIdentifier(requestFields.get('requestId'), 'Harness requestId');
      if (recordsByRequestId.has(requestId)) {
        throw new TypeError('Harness requestId already has an active ContextPack binding');
      }
      const parsed = operation === HARNESS_OPERATIONS.EXECUTE
        ? parseExecuteRequest(requestFields)
        : parsePlanningRequest(requestFields, operation);
      const nonce = nextNonce();
      const binding = Object.freeze({
        schemaVersion: BINDING_SCHEMA_VERSION,
        requestId,
        nonce,
      });
      const record = {
        ...parsed,
        authorityDigest: null,
        binding,
        nonce,
        reader: null,
        requestId,
        requestLease: null,
        requestLeaseExpectedRequest: null,
        state: 'issued',
      };
      issuedBindings.add(binding);
      recordsByNonce.set(nonce, record);
      recordsByRequestId.set(requestId, record);
      return binding;
    } catch {
      rejections += 1;
      throw new TypeError('ContextPack Harness production binding failed');
    }
  }

  function recordFromSerializedBinding(value, surface) {
    const token = exactDataFields(
      value,
      ['schemaVersion', 'requestId', 'nonce'],
      ['schemaVersion', 'requestId', 'nonce'],
      'serialized ContextPack binding'
    );
    if (token.get('schemaVersion') !== BINDING_SCHEMA_VERSION) {
      throw new TypeError('ContextPack binding schema is invalid');
    }
    const nonce = safeIdentifier(token.get('nonce'), 'ContextPack binding nonce');
    const requestId = safeIdentifier(token.get('requestId'), 'ContextPack binding requestId');
    const record = recordsByNonce.get(nonce);
    if (!record || record.requestId !== requestId || record.expectedSurface !== surface
      || record.state !== 'collecting') {
      throw new TypeError('ContextPack binding is stale or mismatched');
    }
    return record;
  }

  function validateCurrentAuthorities(record) {
    const currentProject = authorizeProject(record.projectId, record.rootPath);
    if (!projectAuthorizationsMatch(currentProject, record.projectAuthorization)) {
      throw new TypeError('ContextPack project authority changed during collection');
    }
    if (record.executionBinding) {
      authorizeExecution(
        record.executionBinding,
        record.projectAuthorization.physicalRootIdentityDigest
      );
      if (record.executionLease
        && record.executionLease.authorityDigest !== record.authorityDigest) {
        throw new TypeError('ContextPack execution lease changed during collection');
      }
    }
  }

  function authorizeSerializedBinding(input) {
    const inputFields = exactDataFields(
      input,
      ['binding', 'surface'],
      ['binding', 'surface'],
      'ContextPack production authorization input'
    );
    const surface = inputFields.get('surface');
    const record = recordFromSerializedBinding(inputFields.get('binding'), surface);
    validateCurrentAuthorities(record);
    return {
      authorized: true,
      authorityDigest: record.authorityDigest,
      requestId: record.requestId,
      projectId: record.projectId,
      sourceScope: {
        projectId: record.projectId,
        rootPath: record.rootPath,
        jobId: record.jobId,
        conversationId: record.conversationId,
        userId: record.userId,
        relativeCwd: record.relativeCwd,
        relevantFiles: record.relevantFiles,
      },
      requestText: record.requestText,
      permissionsText: record.permissionsText,
    };
  }

  function recordFromReaderContext(context) {
    const contextFields = dataFields(context, 'ContextPack reader context');
    const requestId = contextFields.get('requestId');
    const record = recordsByRequestId.get(requestId);
    if (!record || record.state !== 'collecting'
      || contextFields.get('projectId') !== record.projectId
      || contextFields.get('authorityDigest') !== record.authorityDigest) {
      throw new TypeError('ContextPack reader context is stale or mismatched');
    }
    return record;
  }

  function getBoundProjectRootReader(context) {
    const record = recordFromReaderContext(context);
    return assertProjectRootReader(record.reader);
  }

  function getBoundConversation(context) {
    const record = recordFromReaderContext(context);
    if (record.conversationId === null || !record.conversationMessages.length) return null;
    return Object.freeze({
      revision: canonicalDigest(record.conversationMessages),
      messages: record.conversationMessages,
    });
  }

  function getBoundActiveMemory(context) {
    const record = recordFromReaderContext(context);
    const input = Object.freeze({
      requestId: record.requestId,
      projectInfo: record.projectInfo,
      userMessage: record.requestText,
      attachments: record.attachments,
      contextHint: record.contextHint,
      conversationMessages: record.conversationMessages,
      userId: record.userId || '',
      conversationId: record.conversationId || '',
      jobId: record.jobId || '',
      stage: record.expectedSurface,
    });
    try { return Reflect.apply(getActiveMemory, undefined, [input]); } catch {
      throw new TypeError('getActiveMemory failed');
    }
  }

  const productionRuntimeOptions = {
    authorizeBinding: authorizeSerializedBinding,
    applicationMapService: fields.get('applicationMapService'),
    milestoneService: fields.get('milestoneService'),
    gitService: fields.get('gitService'),
    getActiveMemory: getBoundActiveMemory,
    getConversation: getBoundConversation,
    getProjectRootReader: getBoundProjectRootReader,
  };
  if (fields.has('compilerOptions')) {
    productionRuntimeOptions.compilerOptions = fields.get('compilerOptions');
  }
  const productionRuntime = createContextPackProductionRuntime(productionRuntimeOptions);

  function syntheticRootBinding(record) {
    if (record.executionBinding) return record.executionBinding;
    const tokenDigest = canonicalDigest({
      schemaVersion: BINDING_SCHEMA_VERSION,
      requestId: record.requestId,
      nonce: record.nonce,
      projectId: record.projectId,
    });
    const token = tokenDigest.slice('sha256:'.length, 'sha256:'.length + 48);
    return createCapabilityDelegationBinding({
      projectId: record.projectId,
      canonicalRootPath: record.projectAuthorization.canonicalRootPath,
      realRootPath: record.projectAuthorization.realRootPath,
      sessionId: `context-session-${token}`,
      jobId: `context-request-${token}`,
      kernelId,
      submissionDigest: tokenDigest,
    });
  }

  async function acquireRequestLease(record) {
    const registry = callSynchronous(
      getProjectRootAuthorityRegistry,
      [],
      'getProjectRootAuthorityRegistry'
    );
    const acquire = captureOwnMethod(registry, 'acquire', 'projectRootAuthorityRegistry');
    const binding = syntheticRootBinding(record);
    let rawAcquire;
    try {
      rawAcquire = Reflect.apply(acquire.method, acquire.receiver, [{
        binding,
        expectedPhysicalRootIdentityDigest:
          record.projectAuthorization.physicalRootIdentityDigest,
        purpose: 'project_scan',
      }]);
    } catch {
      throw new TypeError('projectRootAuthorityRegistry.acquire failed');
    }
    const result = await observeNativePromise(
      rawAcquire,
      'projectRootAuthorityRegistry.acquire'
    );
    if (!Object.isFrozen(result)) {
      throw new TypeError('project-root acquire result must be frozen');
    }
    const resultFields = exactDataFields(
      result,
      ['ok', 'lease', 'idempotent'],
      ['ok', 'lease', 'idempotent'],
      'project-root acquire result'
    );
    if (resultFields.get('ok') !== true
      || typeof resultFields.get('idempotent') !== 'boolean') {
      throw new TypeError('project-root request lease was denied');
    }
    const leaseValue = resultFields.get('lease');
    const leaseFields = dataFields(leaseValue, 'project-root request lease');
    const expectedRequest = createProjectRootAuthorityAcquireRequest({
      leaseId: leaseFields.get('leaseId'),
      binding,
      expectedPhysicalRootIdentityDigest:
        record.projectAuthorization.physicalRootIdentityDigest,
      purpose: 'project_scan',
    });
    const lease = assertProjectRootAuthorityLease(leaseValue, expectedRequest);
    record.requestLease = lease;
    record.requestLeaseExpectedRequest = expectedRequest;
    record.reader = lease.reader;
    record.authorityDigest = lease.authorityDigest;
    requestLeasesAcquired += 1;
  }

  async function closeRequestLease(record) {
    if (!record.requestLease) return;
    const close = captureOwnMethod(record.requestLease, 'close', 'projectRootLease');
    let rawClose;
    try { rawClose = Reflect.apply(close.method, close.receiver, []); } catch {
      throw new TypeError('projectRootLease.close failed');
    }
    const receipt = await observeNativePromise(rawClose, 'projectRootLease.close');
    assertProjectRootAuthorityCloseReceipt(
      receipt,
      record.requestLeaseExpectedRequest
    );
    requestLeasesClosed += 1;
  }

  async function collect(input) {
    let record = null;
    let manifest = null;
    let failure = null;
    try {
      const inputFields = exactDataFields(
        input,
        ['binding', 'surface'],
        ['binding', 'surface'],
        'managed ContextPack collection input'
      );
      const binding = inputFields.get('binding');
      if (!Object.isFrozen(input) || !issuedBindings.has(binding)) {
        throw new TypeError('managed ContextPack binding was not issued by this service');
      }
      const bindingFields = exactDataFields(
        binding,
        ['schemaVersion', 'requestId', 'nonce'],
        ['schemaVersion', 'requestId', 'nonce'],
        'managed ContextPack binding'
      );
      record = recordsByNonce.get(bindingFields.get('nonce'));
      if (!record || record.binding !== binding || record.state !== 'issued'
        || record.requestId !== bindingFields.get('requestId')
        || record.expectedSurface !== inputFields.get('surface')) {
        throw new TypeError('managed ContextPack binding is stale or mismatched');
      }
      record.state = 'collecting';
      if (record.executionLease) {
        record.reader = record.executionLease.reader;
        record.authorityDigest = record.executionLease.authorityDigest;
        executionLeasesReused += 1;
      } else {
        await acquireRequestLease(record);
      }
      manifest = await productionRuntime.collect(Object.freeze({
        binding,
        surface: inputFields.get('surface'),
      }));
    } catch (error) {
      failure = error;
    }
    if (record && record.requestLease) {
      try { await closeRequestLease(record); } catch (error) { failure = error; }
    }
    if (record) {
      record.state = 'closed';
      recordsByNonce.delete(record.nonce);
      recordsByRequestId.delete(record.requestId);
    }
    if (failure) {
      rejections += 1;
      throw new TypeError('Production ContextPack collection failed');
    }
    collections += 1;
    return manifest;
  }

  function managedRuntimeDiagnostics() {
    return Object.freeze({
      version: MANAGED_RUNTIME_VERSION,
      activeBindings: recordsByNonce.size,
      production: productionRuntime.diagnostics(),
    });
  }

  const managedRuntime = Object.freeze({
    version: MANAGED_RUNTIME_VERSION,
    collect,
    diagnostics: managedRuntimeDiagnostics,
  });
  contextPackInjector = createContextPackHarnessInjector({
    contextPackRuntime: managedRuntime,
    bindRequest,
  });

  function diagnostics() {
    return Object.freeze({
      version: CONTEXT_PACK_HARNESS_PRODUCTION_SERVICE_VERSION,
      bindings,
      collections,
      rejections,
      activeBindings: recordsByNonce.size,
      requestLeases: Object.freeze({
        acquired: requestLeasesAcquired,
        closed: requestLeasesClosed,
      }),
      executionLeasesReused,
      injector: contextPackInjector.diagnostics(),
      runtime: productionRuntime.diagnostics(),
    });
  }

  return Object.freeze({
    version: CONTEXT_PACK_HARNESS_PRODUCTION_SERVICE_VERSION,
    contextPackInjector,
    diagnostics,
  });
}

module.exports = {
  CONTEXT_PACK_HARNESS_PRODUCTION_SERVICE_VERSION,
  createContextPackHarnessProductionService,
};
