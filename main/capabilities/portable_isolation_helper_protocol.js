'use strict';

const {
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  preflightDataGraph,
} = require('./execution_workspace_contract');
const {
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
} = require('./project_root_authority_contract');
const {
  PROCESS_SUPERVISOR_BACKEND_VERSION,
} = require('./process_supervisor_contract');
const {
  immutableSnapshot,
} = require('./capability_delegation_contracts');
const {
  canonicalSha256Digest,
} = require('./transactional_delete_contracts');

const PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION =
  'portable-isolation-helper-protocol.v1';
const PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION =
  'portable-isolation-helper-handshake.v1';
const PORTABLE_ISOLATION_HELPER_REQUEST_VERSION =
  'portable-isolation-helper-request.v1';
const PORTABLE_ISOLATION_HELPER_RESPONSE_VERSION =
  'portable-isolation-helper-response.v1';
const PORTABLE_ISOLATION_HELPER_CONTROLLER_VERSION =
  'portable-isolation-helper-session-controller.v1';
const PORTABLE_ISOLATION_HELPER_FAILURE_VERSION =
  'portable-isolation-helper-failure.v1';

const PORTABLE_ISOLATION_HELPER_OPERATIONS = Object.freeze({
  HANDSHAKE: 'handshake',
  WORKSPACE_ACQUIRE: 'workspace.acquire',
  WORKSPACE_DISCARD: 'workspace.discard',
  ROOT_ACQUIRE: 'root.acquire',
  ROOT_LIST: 'root.list',
  ROOT_READ_FILE: 'root.read_file',
  ROOT_INSPECT_ENTRY: 'root.inspect_entry',
  ROOT_CLOSE: 'root.close',
  PROCESS_EXEC: 'process.exec',
  PROCESS_READ: 'process.read',
  PROCESS_WAIT: 'process.wait',
  PROCESS_STOP: 'process.stop',
  PROVIDER_DISPOSE: 'provider.dispose',
});

const PORTABLE_ISOLATION_HELPER_REQUIREMENTS = immutableSnapshot({
  bundledDistributionOnly: true,
  platformSignatureRequired: true,
  privateFramedTransport: true,
  singleSessionPerHelper: true,
  dataOnlyMessages: true,
  digestBound: true,
  sequenceBound: true,
  responseCorrelation: true,
  workspaceRootBound: true,
  physicalRootAuthority: true,
  networkDefaultDeny: true,
  processTreeTermination: true,
  boundedCursorOutput: true,
  zeroOrphanShutdown: true,
  noProviderPathInjection: true,
});

const PORTABLE_ISOLATION_HELPER_LIMITS = Object.freeze({
  maxMessageBytes: 2 * 1024 * 1024,
  maxSequence: 1_000_000,
  maxExchanges: 1_000_000,
});

const REQUEST_KEYS = Object.freeze([
  'version',
  'kind',
  'requestId',
  'operation',
  'sequence',
  'sessionId',
  'previousResponseDigest',
  'payload',
  'payloadDigest',
  'requestDigest',
]);
const RESPONSE_KEYS = Object.freeze([
  'version',
  'kind',
  'requestId',
  'operation',
  'sequence',
  'sessionId',
  'requestDigest',
  'previousResponseDigest',
  'payload',
  'payloadDigest',
  'responseDigest',
]);
const HANDSHAKE_REQUEST_INPUT_KEYS = Object.freeze([
  'requestId',
  'clientId',
  'clientNonce',
  'expectedBundleIdentityDigest',
  'providerVersion',
  'attestationVersion',
]);
const HANDSHAKE_REQUEST_PAYLOAD_KEYS = Object.freeze([
  'handshakeVersion',
  'protocolVersion',
  'clientId',
  'clientNonce',
  'expectedBundleIdentityDigest',
  'providerVersion',
  'attestationVersion',
  'executionWorkspaceBackendVersion',
  'projectRootAuthorityBackendVersion',
  'processSupervisorBackendVersion',
  'requirementsDigest',
]);
const HANDSHAKE_RESPONSE_INPUT_KEYS = Object.freeze([
  'helperId',
  'helperBuildId',
  'helperNonce',
  'sessionId',
  'bundleIdentityDigest',
  'executionWorkspaceBackendId',
  'projectRootAuthorityBackendId',
  'processSupervisorBackendId',
  'platform',
]);
const HANDSHAKE_RESPONSE_PAYLOAD_KEYS = Object.freeze([
  'accepted',
  'handshakeVersion',
  'protocolVersion',
  'helperId',
  'helperBuildId',
  'helperNonce',
  'sessionId',
  'bundleIdentityDigest',
  'providerVersion',
  'attestationVersion',
  'executionWorkspaceBackendVersion',
  'projectRootAuthorityBackendVersion',
  'processSupervisorBackendVersion',
  'executionWorkspaceBackendId',
  'projectRootAuthorityBackendId',
  'processSupervisorBackendId',
  'platform',
  'requirementsDigest',
  'capabilityDigest',
  'sessionBindingDigest',
]);
const PLATFORM_KEYS = Object.freeze(['os', 'architecture', 'signatureVerification']);
const FAILURE_KEYS = Object.freeze(['version', 'ok', 'reasonCode', 'retryable']);
const SHUTDOWN_KEYS = Object.freeze([
  'ok',
  'disposed',
  'activeWorkspaces',
  'activeRootLeases',
  'activeProcesses',
  'orphaned',
]);
const CONTROLLER_OPTION_KEYS = Object.freeze(['handshakeRequest', 'handshakeResponse']);
const CONTROLLER_REQUEST_KEYS = Object.freeze(['requestId', 'operation', 'payload']);
const QUARANTINE_KEYS = Object.freeze(['reasonCode']);

const OPERATIONS = new Set(Object.values(PORTABLE_ISOLATION_HELPER_OPERATIONS));
const SESSION_OPERATIONS = new Set(
  Object.values(PORTABLE_ISOLATION_HELPER_OPERATIONS)
    .filter((operation) => operation !== PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE)
);
const SUPPORTED_OS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const SAFE_PROTOCOL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const NONCE = /^[a-f0-9]{64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REQUIREMENTS_DIGEST = canonicalSha256Digest(PORTABLE_ISOLATION_HELPER_REQUIREMENTS);

class PortableIsolationHelperProtocolError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperProtocolError';
    this.code = code;
  }
}

function protocolError(code) {
  return new PortableIsolationHelperProtocolError(code);
}

function fail(code) {
  throw protocolError(code);
}

function observeDataGraphs(values) {
  const preflight = preflightDataGraph(values);
  if (preflight.hasNativePromise) fail('PROTOCOL_ASYNC_INPUT');
  if (!preflight.bounded) fail('PROTOCOL_LIMIT_EXCEEDED');
  if (!preflight.inspectable) fail('PROTOCOL_DATA_INVALID');
  return preflight;
}

function observeDataGraph(value) {
  return observeDataGraphs([value]);
}

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  observeDataGraph(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('PROTOCOL_DATA_INVALID');
  }
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    preflightDataGraph(error);
    fail('PROTOCOL_DATA_INVALID');
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) {
    fail('PROTOCOL_DATA_INVALID');
  }
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      preflightDataGraph(error);
      fail('PROTOCOL_DATA_INVALID');
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      fail('PROTOCOL_DATA_INVALID');
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function snapshotRecord(value) {
  observeDataGraph(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('PROTOCOL_DATA_INVALID');
  }
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch (error) {
    preflightDataGraph(error);
    fail('PROTOCOL_DATA_INVALID');
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail('PROTOCOL_DATA_INVALID');
  }
  try {
    return immutableSnapshot(value);
  } catch (error) {
    preflightDataGraph(error);
    fail('PROTOCOL_DATA_INVALID');
  }
}

function safeIdentifier(value) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    fail('PROTOCOL_DATA_INVALID');
  }
  return value;
}

function safeProtocolIdentifier(value) {
  if (typeof value !== 'string' || !SAFE_PROTOCOL_IDENTIFIER.test(value)) {
    fail('PROTOCOL_DATA_INVALID');
  }
  return value;
}

function safeNonce(value) {
  if (typeof value !== 'string' || !NONCE.test(value)) fail('PROTOCOL_DATA_INVALID');
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail('PROTOCOL_DATA_INVALID');
  return value;
}

function safeReasonCode(value) {
  if (typeof value !== 'string' || !SAFE_REASON_CODE.test(value)) {
    fail('PROTOCOL_DATA_INVALID');
  }
  return value;
}

function safeInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum
    || Object.is(value, -0)) fail('PROTOCOL_DATA_INVALID');
  return value;
}

function serializedBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch (error) {
    preflightDataGraph(error);
    fail('PROTOCOL_DATA_INVALID');
  }
}

function assertMessageBound(value) {
  if (serializedBytes(value) > PORTABLE_ISOLATION_HELPER_LIMITS.maxMessageBytes) {
    fail('PROTOCOL_LIMIT_EXCEEDED');
  }
  return value;
}

function normalizeOperation(value, allowHandshake = true) {
  if (typeof value !== 'string' || !OPERATIONS.has(value)
    || (!allowHandshake && !SESSION_OPERATIONS.has(value))) {
    fail('PROTOCOL_OPERATION_INVALID');
  }
  return value;
}

function createRequestEnvelope({
  requestId,
  operation,
  sequence,
  sessionId,
  previousResponseDigest,
  payload,
}) {
  const canonicalPayload = snapshotRecord(payload);
  const core = {
    version: PORTABLE_ISOLATION_HELPER_REQUEST_VERSION,
    kind: 'request',
    requestId: safeIdentifier(requestId),
    operation: normalizeOperation(operation),
    sequence: safeInteger(
      sequence,
      0,
      PORTABLE_ISOLATION_HELPER_LIMITS.maxSequence
    ),
    sessionId,
    previousResponseDigest,
    payload: canonicalPayload,
    payloadDigest: canonicalSha256Digest(canonicalPayload),
  };
  if (core.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
    if (core.sequence !== 0 || sessionId !== null || previousResponseDigest !== null) {
      fail('PROTOCOL_DATA_INVALID');
    }
  } else {
    if (core.sequence < 1) fail('PROTOCOL_DATA_INVALID');
    core.sessionId = safeIdentifier(sessionId);
    core.previousResponseDigest = safeDigest(previousResponseDigest);
  }
  const request = immutableSnapshot({
    ...core,
    requestDigest: canonicalSha256Digest(core),
  });
  return assertMessageBound(request);
}

function assertPortableIsolationHelperRequest(value) {
  const fields = exactDataFields(value, REQUEST_KEYS);
  if (fields.get('version') !== PORTABLE_ISOLATION_HELPER_REQUEST_VERSION
    || fields.get('kind') !== 'request') fail('PROTOCOL_DATA_INVALID');
  const normalized = createRequestEnvelope({
    requestId: fields.get('requestId'),
    operation: fields.get('operation'),
    sequence: fields.get('sequence'),
    sessionId: fields.get('sessionId'),
    previousResponseDigest: fields.get('previousResponseDigest'),
    payload: fields.get('payload'),
  });
  if (fields.get('payloadDigest') !== normalized.payloadDigest
    || fields.get('requestDigest') !== normalized.requestDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH');
  }
  return normalized;
}

function createPortableIsolationHelperRequest(input = {}) {
  const fields = exactDataFields(input, [
    'requestId',
    'operation',
    'sequence',
    'sessionId',
    'previousResponseDigest',
    'payload',
  ]);
  const operation = normalizeOperation(fields.get('operation'), false);
  return createRequestEnvelope({
    requestId: fields.get('requestId'),
    operation,
    sequence: fields.get('sequence'),
    sessionId: fields.get('sessionId'),
    previousResponseDigest: fields.get('previousResponseDigest'),
    payload: fields.get('payload'),
  });
}

function normalizeHandshakeRequestPayload(value) {
  const fields = exactDataFields(value, HANDSHAKE_REQUEST_PAYLOAD_KEYS);
  if (fields.get('handshakeVersion') !== PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION
    || fields.get('protocolVersion') !== PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION
    || fields.get('executionWorkspaceBackendVersion') !== EXECUTION_WORKSPACE_BACKEND_VERSION
    || fields.get('projectRootAuthorityBackendVersion')
      !== PROJECT_ROOT_AUTHORITY_BACKEND_VERSION
    || fields.get('processSupervisorBackendVersion') !== PROCESS_SUPERVISOR_BACKEND_VERSION
    || fields.get('requirementsDigest') !== REQUIREMENTS_DIGEST) {
    fail('PROTOCOL_DATA_INVALID');
  }
  return immutableSnapshot({
    handshakeVersion: PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION,
    protocolVersion: PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION,
    clientId: safeIdentifier(fields.get('clientId')),
    clientNonce: safeNonce(fields.get('clientNonce')),
    expectedBundleIdentityDigest: safeDigest(fields.get('expectedBundleIdentityDigest')),
    providerVersion: safeProtocolIdentifier(fields.get('providerVersion')),
    attestationVersion: safeProtocolIdentifier(fields.get('attestationVersion')),
    executionWorkspaceBackendVersion: EXECUTION_WORKSPACE_BACKEND_VERSION,
    projectRootAuthorityBackendVersion: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    processSupervisorBackendVersion: PROCESS_SUPERVISOR_BACKEND_VERSION,
    requirementsDigest: REQUIREMENTS_DIGEST,
  });
}

function createPortableIsolationHelperHandshakeRequest(input = {}) {
  const fields = exactDataFields(input, HANDSHAKE_REQUEST_INPUT_KEYS);
  const payload = normalizeHandshakeRequestPayload({
    handshakeVersion: PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION,
    protocolVersion: PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION,
    clientId: fields.get('clientId'),
    clientNonce: fields.get('clientNonce'),
    expectedBundleIdentityDigest: fields.get('expectedBundleIdentityDigest'),
    providerVersion: fields.get('providerVersion'),
    attestationVersion: fields.get('attestationVersion'),
    executionWorkspaceBackendVersion: EXECUTION_WORKSPACE_BACKEND_VERSION,
    projectRootAuthorityBackendVersion: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    processSupervisorBackendVersion: PROCESS_SUPERVISOR_BACKEND_VERSION,
    requirementsDigest: REQUIREMENTS_DIGEST,
  });
  return createRequestEnvelope({
    requestId: fields.get('requestId'),
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE,
    sequence: 0,
    sessionId: null,
    previousResponseDigest: null,
    payload,
  });
}

function assertPortableIsolationHelperHandshakeRequest(value) {
  const request = assertPortableIsolationHelperRequest(value);
  if (request.operation !== PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
    fail('PROTOCOL_OPERATION_INVALID');
  }
  const payload = normalizeHandshakeRequestPayload(request.payload);
  if (canonicalSha256Digest(payload) !== request.payloadDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH');
  }
  return request;
}

function normalizePlatform(value) {
  const fields = exactDataFields(value, PLATFORM_KEYS);
  if (!SUPPORTED_OS.has(fields.get('os'))
    || !SUPPORTED_ARCHITECTURES.has(fields.get('architecture'))
    || fields.get('signatureVerification') !== 'platform_verified') {
    fail('PROTOCOL_DATA_INVALID');
  }
  return immutableSnapshot({
    os: fields.get('os'),
    architecture: fields.get('architecture'),
    signatureVerification: 'platform_verified',
  });
}

function createResponseEnvelope(requestValue, payloadValue, responseSessionId) {
  observeDataGraphs([requestValue, payloadValue]);
  const request = assertPortableIsolationHelperRequest(requestValue);
  const payload = snapshotRecord(payloadValue);
  const sessionId = request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE
    ? safeIdentifier(responseSessionId)
    : request.sessionId;
  const core = {
    version: PORTABLE_ISOLATION_HELPER_RESPONSE_VERSION,
    kind: 'response',
    requestId: request.requestId,
    operation: request.operation,
    sequence: request.sequence,
    sessionId,
    requestDigest: request.requestDigest,
    previousResponseDigest: request.previousResponseDigest,
    payload,
    payloadDigest: canonicalSha256Digest(payload),
  };
  const response = immutableSnapshot({
    ...core,
    responseDigest: canonicalSha256Digest(core),
  });
  return assertMessageBound(response);
}

function createPortableIsolationHelperResponse(requestValue, payloadValue) {
  observeDataGraphs([requestValue, payloadValue]);
  const request = assertPortableIsolationHelperRequest(requestValue);
  if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
    fail('PROTOCOL_OPERATION_INVALID');
  }
  return createResponseEnvelope(request, payloadValue, request.sessionId);
}

function assertPortableIsolationHelperResponse(value, expectedRequestValue) {
  observeDataGraphs([value, expectedRequestValue]);
  const expectedRequest = assertPortableIsolationHelperRequest(expectedRequestValue);
  const fields = exactDataFields(value, RESPONSE_KEYS);
  if (fields.get('version') !== PORTABLE_ISOLATION_HELPER_RESPONSE_VERSION
    || fields.get('kind') !== 'response') fail('PROTOCOL_DATA_INVALID');
  if (fields.get('requestId') !== expectedRequest.requestId
    || fields.get('operation') !== expectedRequest.operation
    || fields.get('sequence') !== expectedRequest.sequence
    || fields.get('requestDigest') !== expectedRequest.requestDigest
    || fields.get('previousResponseDigest') !== expectedRequest.previousResponseDigest
    || (expectedRequest.operation !== PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE
      && fields.get('sessionId') !== expectedRequest.sessionId)) {
    fail('PROTOCOL_RESPONSE_MISMATCH');
  }
  const normalized = createResponseEnvelope(
    expectedRequest,
    fields.get('payload'),
    fields.get('sessionId')
  );
  if (fields.get('payloadDigest') !== normalized.payloadDigest
    || fields.get('responseDigest') !== normalized.responseDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH');
  }
  return normalized;
}

function capabilityCoreFromHandshake(request, fields, platform) {
  return {
    protocolVersion: PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION,
    helperId: safeIdentifier(fields.get('helperId')),
    helperBuildId: safeIdentifier(fields.get('helperBuildId')),
    bundleIdentityDigest: safeDigest(fields.get('bundleIdentityDigest')),
    providerVersion: request.payload.providerVersion,
    attestationVersion: request.payload.attestationVersion,
    executionWorkspaceBackendVersion: EXECUTION_WORKSPACE_BACKEND_VERSION,
    projectRootAuthorityBackendVersion: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    processSupervisorBackendVersion: PROCESS_SUPERVISOR_BACKEND_VERSION,
    executionWorkspaceBackendId: safeIdentifier(fields.get('executionWorkspaceBackendId')),
    projectRootAuthorityBackendId: safeIdentifier(fields.get('projectRootAuthorityBackendId')),
    processSupervisorBackendId: safeIdentifier(fields.get('processSupervisorBackendId')),
    platform,
    requirementsDigest: REQUIREMENTS_DIGEST,
  };
}

function assertDistinctBackendIds(core) {
  const ids = new Set([
    core.executionWorkspaceBackendId,
    core.projectRootAuthorityBackendId,
    core.processSupervisorBackendId,
  ]);
  if (ids.size !== 3) fail('PROTOCOL_DATA_INVALID');
}

function createPortableIsolationHelperHandshakeResponse(requestValue, input = {}) {
  observeDataGraphs([requestValue, input]);
  const request = assertPortableIsolationHelperHandshakeRequest(requestValue);
  const fields = exactDataFields(input, HANDSHAKE_RESPONSE_INPUT_KEYS);
  const bundleIdentityDigest = safeDigest(fields.get('bundleIdentityDigest'));
  if (bundleIdentityDigest !== request.payload.expectedBundleIdentityDigest) {
    fail('PROTOCOL_BUNDLE_IDENTITY_MISMATCH');
  }
  const helperNonce = safeNonce(fields.get('helperNonce'));
  if (helperNonce === request.payload.clientNonce) fail('PROTOCOL_DATA_INVALID');
  const sessionId = safeIdentifier(fields.get('sessionId'));
  const platform = normalizePlatform(fields.get('platform'));
  const capabilityCore = capabilityCoreFromHandshake(request, fields, platform);
  assertDistinctBackendIds(capabilityCore);
  const capabilityDigest = canonicalSha256Digest(capabilityCore);
  const sessionBindingDigest = canonicalSha256Digest({
    requestDigest: request.requestDigest,
    capabilityDigest,
    clientNonce: request.payload.clientNonce,
    helperNonce,
    sessionId,
    bundleIdentityDigest,
  });
  const payload = immutableSnapshot({
    accepted: true,
    handshakeVersion: PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION,
    ...capabilityCore,
    helperNonce,
    sessionId,
    capabilityDigest,
    sessionBindingDigest,
  });
  return createResponseEnvelope(request, payload, sessionId);
}

function normalizeHandshakeResponsePayload(value, request) {
  const fields = exactDataFields(value, HANDSHAKE_RESPONSE_PAYLOAD_KEYS);
  if (fields.get('accepted') !== true
    || fields.get('handshakeVersion') !== PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION
    || fields.get('protocolVersion') !== PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION
    || fields.get('providerVersion') !== request.payload.providerVersion
    || fields.get('attestationVersion') !== request.payload.attestationVersion
    || fields.get('executionWorkspaceBackendVersion') !== EXECUTION_WORKSPACE_BACKEND_VERSION
    || fields.get('projectRootAuthorityBackendVersion')
      !== PROJECT_ROOT_AUTHORITY_BACKEND_VERSION
    || fields.get('processSupervisorBackendVersion') !== PROCESS_SUPERVISOR_BACKEND_VERSION
    || fields.get('requirementsDigest') !== REQUIREMENTS_DIGEST) {
    fail('PROTOCOL_DATA_INVALID');
  }
  const bundleIdentityDigest = safeDigest(fields.get('bundleIdentityDigest'));
  if (bundleIdentityDigest !== request.payload.expectedBundleIdentityDigest) {
    fail('PROTOCOL_BUNDLE_IDENTITY_MISMATCH');
  }
  const helperNonce = safeNonce(fields.get('helperNonce'));
  if (helperNonce === request.payload.clientNonce) fail('PROTOCOL_DATA_INVALID');
  const sessionId = safeIdentifier(fields.get('sessionId'));
  const platform = normalizePlatform(fields.get('platform'));
  const capabilityCore = capabilityCoreFromHandshake(request, fields, platform);
  assertDistinctBackendIds(capabilityCore);
  const capabilityDigest = canonicalSha256Digest(capabilityCore);
  if (fields.get('capabilityDigest') !== capabilityDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH');
  }
  const sessionBindingDigest = canonicalSha256Digest({
    requestDigest: request.requestDigest,
    capabilityDigest,
    clientNonce: request.payload.clientNonce,
    helperNonce,
    sessionId,
    bundleIdentityDigest,
  });
  if (fields.get('sessionBindingDigest') !== sessionBindingDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH');
  }
  return immutableSnapshot({
    accepted: true,
    handshakeVersion: PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION,
    ...capabilityCore,
    helperNonce,
    sessionId,
    capabilityDigest,
    sessionBindingDigest,
  });
}

function assertPortableIsolationHelperHandshakeResponse(value, requestValue) {
  observeDataGraphs([value, requestValue]);
  const request = assertPortableIsolationHelperHandshakeRequest(requestValue);
  const response = assertPortableIsolationHelperResponse(value, request);
  const payload = normalizeHandshakeResponsePayload(response.payload, request);
  if (payload.sessionId !== response.sessionId
    || canonicalSha256Digest(payload) !== response.payloadDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH');
  }
  return response;
}

function normalizeFailureReceipt(value) {
  const fields = exactDataFields(value, FAILURE_KEYS);
  if (fields.get('version') !== PORTABLE_ISOLATION_HELPER_FAILURE_VERSION
    || fields.get('ok') !== false
    || typeof fields.get('retryable') !== 'boolean') {
    fail('PROTOCOL_DATA_INVALID');
  }
  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_FAILURE_VERSION,
    ok: false,
    reasonCode: safeReasonCode(fields.get('reasonCode')),
    retryable: fields.get('retryable'),
  });
}

function createPortableIsolationHelperFailureReceipt(input = {}) {
  const fields = exactDataFields(input, ['reasonCode', 'retryable']);
  return normalizeFailureReceipt({
    version: PORTABLE_ISOLATION_HELPER_FAILURE_VERSION,
    ok: false,
    reasonCode: fields.get('reasonCode'),
    retryable: fields.get('retryable'),
  });
}

function assertPortableIsolationHelperFailureReceipt(value) {
  return normalizeFailureReceipt(value);
}

function normalizeShutdownReceipt(value) {
  const fields = exactDataFields(value, SHUTDOWN_KEYS);
  if (fields.get('ok') !== true || fields.get('disposed') !== true) {
    fail('PROTOCOL_DATA_INVALID');
  }
  const receipt = {
    ok: true,
    disposed: true,
    activeWorkspaces: safeInteger(fields.get('activeWorkspaces'), 0, 0),
    activeRootLeases: safeInteger(fields.get('activeRootLeases'), 0, 0),
    activeProcesses: safeInteger(fields.get('activeProcesses'), 0, 0),
    orphaned: safeInteger(fields.get('orphaned'), 0, 0),
  };
  return Object.freeze(receipt);
}

function createPortableIsolationHelperShutdownReceipt(input = {}) {
  return normalizeShutdownReceipt({
    ok: true,
    disposed: true,
    ...Object.fromEntries(exactDataFields(input, [
      'activeWorkspaces',
      'activeRootLeases',
      'activeProcesses',
      'orphaned',
    ])),
  });
}

function assertPortableIsolationHelperShutdownReceipt(value) {
  return normalizeShutdownReceipt(value);
}

function createPortableIsolationHelperSessionController(options = {}) {
  const optionFields = exactDataFields(options, CONTROLLER_OPTION_KEYS);
  const handshakeRequest = assertPortableIsolationHelperHandshakeRequest(
    optionFields.get('handshakeRequest')
  );
  const handshakeResponse = assertPortableIsolationHelperHandshakeResponse(
    optionFields.get('handshakeResponse'),
    handshakeRequest
  );
  const sessionId = handshakeResponse.sessionId;
  let previousResponseDigest = handshakeResponse.responseDigest;
  let nextSequence = 1;
  let exchanges = 0;
  let state = 'active';
  let pendingRequest = null;
  const usedRequestIds = new Set([handshakeRequest.requestId]);

  function request(input) {
    observeDataGraph(input);
    if (state === 'busy') fail('PROTOCOL_SESSION_BUSY');
    if (state === 'closed') fail('PROTOCOL_SESSION_CLOSED');
    if (state === 'quarantined') fail('PROTOCOL_SESSION_QUARANTINED');
    if (exchanges >= PORTABLE_ISOLATION_HELPER_LIMITS.maxExchanges
      || nextSequence > PORTABLE_ISOLATION_HELPER_LIMITS.maxSequence) {
      state = 'quarantined';
      fail('PROTOCOL_LIMIT_EXCEEDED');
    }
    const fields = exactDataFields(input, CONTROLLER_REQUEST_KEYS);
    const operation = normalizeOperation(fields.get('operation'), false);
    const nextRequest = createPortableIsolationHelperRequest({
      requestId: fields.get('requestId'),
      operation,
      sequence: nextSequence,
      sessionId,
      previousResponseDigest,
      payload: fields.get('payload'),
    });
    if (usedRequestIds.has(nextRequest.requestId)) {
      state = 'quarantined';
      fail('PROTOCOL_REQUEST_REPLAY');
    }
    usedRequestIds.add(nextRequest.requestId);
    pendingRequest = nextRequest;
    state = 'busy';
    return pendingRequest;
  }

  function accept(value) {
    try {
      observeDataGraph(value);
    } catch (inputError) {
      preflightDataGraph(inputError);
      pendingRequest = null;
      state = 'quarantined';
      fail('PROTOCOL_RESPONSE_REJECTED');
    }
    if (!pendingRequest || state !== 'busy') {
      state = 'quarantined';
      fail('PROTOCOL_RESPONSE_REJECTED');
    }
    let response;
    try {
      response = assertPortableIsolationHelperResponse(value, pendingRequest);
      if (Object.hasOwn(response.payload, 'ok') && response.payload.ok === false) {
        assertPortableIsolationHelperFailureReceipt(response.payload);
      }
      if (pendingRequest.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE) {
        assertPortableIsolationHelperShutdownReceipt(response.payload);
      }
    } catch (error) {
      preflightDataGraph(error);
      pendingRequest = null;
      state = 'quarantined';
      fail('PROTOCOL_RESPONSE_REJECTED');
    }
    previousResponseDigest = response.responseDigest;
    nextSequence += 1;
    exchanges += 1;
    const closed = pendingRequest.operation
      === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE;
    pendingRequest = null;
    state = closed ? 'closed' : 'active';
    return response;
  }

  function quarantine(input) {
    const fields = exactDataFields(input, QUARANTINE_KEYS);
    safeReasonCode(fields.get('reasonCode'));
    pendingRequest = null;
    state = 'quarantined';
    return Object.freeze({ ok: true, quarantined: true });
  }

  function diagnostics() {
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_CONTROLLER_VERSION,
      state,
      nextSequence,
      exchanges,
      pending: pendingRequest !== null,
    });
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_CONTROLLER_VERSION,
    request,
    accept,
    quarantine,
    diagnostics,
  });
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_CONTROLLER_VERSION,
  PORTABLE_ISOLATION_HELPER_FAILURE_VERSION,
  PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION,
  PORTABLE_ISOLATION_HELPER_LIMITS,
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION,
  PORTABLE_ISOLATION_HELPER_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_REQUIREMENTS,
  PORTABLE_ISOLATION_HELPER_RESPONSE_VERSION,
  PortableIsolationHelperProtocolError,
  assertPortableIsolationHelperFailureReceipt,
  assertPortableIsolationHelperHandshakeRequest,
  assertPortableIsolationHelperHandshakeResponse,
  assertPortableIsolationHelperRequest,
  assertPortableIsolationHelperResponse,
  assertPortableIsolationHelperShutdownReceipt,
  createPortableIsolationHelperFailureReceipt,
  createPortableIsolationHelperHandshakeRequest,
  createPortableIsolationHelperHandshakeResponse,
  createPortableIsolationHelperRequest,
  createPortableIsolationHelperResponse,
  createPortableIsolationHelperSessionController,
  createPortableIsolationHelperShutdownReceipt,
};
