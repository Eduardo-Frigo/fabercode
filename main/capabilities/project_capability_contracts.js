'use strict';

const PROJECT_CAPABILITY_CONTRACT_VERSION = 'project-capability.v1';
const PROJECT_CAPABILITY_REQUEST_SCHEMA_VERSION = 'project-capability.request.v1';
const PROJECT_CAPABILITY_RESULT_SCHEMA_VERSION = 'project-capability.result.v1';
const PROJECT_CAPABILITY_INSPECTION_SCHEMA_VERSION = 'project-capability.inspection.v1';

const PROJECT_CAPABILITY_PRINCIPAL_KINDS = Object.freeze({
  AGENT: 'agent',
  SYSTEM: 'system',
  USER_UI: 'user_ui',
});

const PROJECT_CAPABILITY_KINDS = Object.freeze({
  APPLICATION: 'application',
  FILESYSTEM: 'filesystem',
  GIT: 'git',
  MCP: 'mcp',
  MEMORY: 'memory',
  PREVIEW: 'preview',
  PROCESS: 'process',
});

const PROJECT_CAPABILITY_EFFECTS = Object.freeze({
  DESTRUCTIVE: 'destructive',
  DURABLE_MEMORY_WRITE: 'durable_memory_write',
  EXTERNAL_MUTATION: 'external_mutation',
  EXTERNAL_READ: 'external_read',
  FILESYSTEM_DELETE: 'filesystem_delete',
  FILESYSTEM_READ: 'filesystem_read',
  FILESYSTEM_WRITE: 'filesystem_write',
  GIT_METADATA_WRITE: 'git_metadata_write',
  NETWORK_ACCESS: 'network_access',
  PROCESS_EXECUTE: 'process_execute',
  SECRET_ACCESS: 'secret_access',
});

const PROJECT_CAPABILITY_DECISIONS = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
  REQUIRE_APPROVAL: 'require_approval',
});

const PROJECT_CAPABILITY_RESULT_STATUSES = Object.freeze({
  ALLOWED: 'allowed',
  APPROVAL_REQUIRED: 'approval_required',
  COMPLETED: 'completed',
  DENIED: 'denied',
  FAILED: 'failed',
});

/**
 * Standard broker/policy error codes. The wire contract intentionally remains
 * open to stable uppercase denial codes supplied by trusted capability
 * descriptors (for example `PROTECTED_PROJECT_PATH`). Consumers must handle an
 * unknown code as a denial, rather than treating this catalog as exhaustive.
 */
const PROJECT_CAPABILITY_STANDARD_ERROR_CODES = Object.freeze({
  APPROVAL_DENIED: 'APPROVAL_DENIED',
  APPROVAL_INVALID: 'APPROVAL_INVALID',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  AUDIT_FAILED: 'AUDIT_FAILED',
  BROKER_BUSY: 'BROKER_BUSY',
  CAPABILITY_DISABLED: 'CAPABILITY_DISABLED',
  CAPABILITY_EFFECT_UNKNOWN: 'CAPABILITY_EFFECT_UNKNOWN',
  CAPABILITY_EFFECTS_MISSING: 'CAPABILITY_EFFECTS_MISSING',
  CAPABILITY_NOT_ALLOWED: 'CAPABILITY_NOT_ALLOWED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  EXTERNAL_MUTATION_DISABLED: 'EXTERNAL_MUTATION_DISABLED',
  GRANT_REVALIDATION_FAILED: 'GRANT_REVALIDATION_FAILED',
  INVALID_CAPABILITY_REQUEST: 'INVALID_CAPABILITY_REQUEST',
  PROJECT_SCOPE_INVALID: 'PROJECT_SCOPE_INVALID',
  REQUEST_CHANGED: 'REQUEST_CHANGED',
  REVALIDATION_FAILED: 'REVALIDATION_FAILED',
  SANDBOX_DEGRADED: 'SANDBOX_DEGRADED',
  SANDBOX_GUARANTEES_INSUFFICIENT: 'SANDBOX_GUARANTEES_INSUFFICIENT',
  SANDBOX_UNAVAILABLE: 'SANDBOX_UNAVAILABLE',
  SECRET_ACCESS_DISABLED: 'SECRET_ACCESS_DISABLED',
  TERMINAL_REPLAY_NOT_AUTHORIZED: 'TERMINAL_REPLAY_NOT_AUTHORIZED',
});

const SUPPORTED_PRINCIPAL_KINDS = new Set(Object.values(PROJECT_CAPABILITY_PRINCIPAL_KINDS));
const SUPPORTED_KINDS = new Set(Object.values(PROJECT_CAPABILITY_KINDS));
const SUPPORTED_EFFECTS = new Set(Object.values(PROJECT_CAPABILITY_EFFECTS));
const SUPPORTED_DECISIONS = new Set(Object.values(PROJECT_CAPABILITY_DECISIONS));
const SUPPORTED_RESULT_STATUSES = new Set(Object.values(PROJECT_CAPABILITY_RESULT_STATUSES));

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim()) && !value.includes('\0');
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isProjectCapabilityPrincipal(principal) {
  if (!isRecord(principal) || !SUPPORTED_PRINCIPAL_KINDS.has(principal.kind)) return false;
  if (principal.kind === PROJECT_CAPABILITY_PRINCIPAL_KINDS.AGENT) {
    return hasOnlyKeys(principal, ['kind', 'kernelId']) && isNonEmptyString(principal.kernelId);
  }
  return hasOnlyKeys(principal, ['kind', 'actorId']) && isNonEmptyString(principal.actorId);
}

function createProjectCapabilityPrincipal(principal = {}) {
  const canonical = { kind: principal.kind };
  if (principal.kind === PROJECT_CAPABILITY_PRINCIPAL_KINDS.AGENT) {
    canonical.kernelId = typeof principal.kernelId === 'string'
      ? principal.kernelId.trim()
      : principal.kernelId;
  } else {
    canonical.actorId = typeof principal.actorId === 'string'
      ? principal.actorId.trim()
      : principal.actorId;
  }
  if (!isProjectCapabilityPrincipal(canonical)) {
    throw new TypeError('Invalid project capability principal');
  }
  return Object.freeze(canonical);
}

function isProjectSession(projectSession) {
  if (!isRecord(projectSession)) return false;
  if (!hasOnlyKeys(projectSession, [
    'sessionId',
    'projectId',
    'rootPath',
    'realRootPath',
    'cwd',
    'cwdRealPath',
    'jobId',
    'projectName',
    'source',
    'createdAt',
  ])) return false;
  if (!isNonEmptyString(projectSession.sessionId)) return false;
  if (!isNonEmptyString(projectSession.projectId)) return false;
  if (!isNonEmptyString(projectSession.rootPath)) return false;
  if (!isNonEmptyString(projectSession.realRootPath)) return false;
  if (projectSession.cwd !== undefined && !isNonEmptyString(projectSession.cwd)) return false;
  if (projectSession.cwdRealPath !== undefined && !isNonEmptyString(projectSession.cwdRealPath)) return false;
  if (projectSession.cwdRealPath !== undefined && projectSession.cwd === undefined) return false;
  if (projectSession.jobId !== undefined && typeof projectSession.jobId !== 'string') return false;
  for (const field of ['projectName', 'source', 'createdAt']) {
    if (projectSession[field] !== undefined && !isNonEmptyString(projectSession[field])) return false;
  }
  return true;
}

function createProjectSession(projectSession = {}) {
  const canonical = {};
  for (const field of [
    'sessionId',
    'projectId',
    'rootPath',
    'realRootPath',
    'cwd',
    'cwdRealPath',
    'jobId',
    'projectName',
    'source',
    'createdAt',
  ]) {
    if (projectSession[field] !== undefined) {
      canonical[field] = typeof projectSession[field] === 'string'
        ? projectSession[field].trim()
        : projectSession[field];
    }
  }
  if (!isProjectSession(canonical)) {
    throw new TypeError('Invalid project capability session');
  }
  return Object.freeze(canonical);
}

function isProjectCapabilityContext(context, principal = null) {
  if (!isRecord(context) || !isNonEmptyString(context.origin)) return false;
  if (!hasOnlyKeys(context, ['origin', 'directUserAction', 'correlationId', 'metadata'])) return false;
  if (context.directUserAction !== undefined && typeof context.directUserAction !== 'boolean') return false;
  if (context.correlationId !== undefined && !isNonEmptyString(context.correlationId)) return false;
  if (context.metadata !== undefined && !isRecord(context.metadata)) return false;
  if (context.directUserAction === true
    && (!principal || principal.kind !== PROJECT_CAPABILITY_PRINCIPAL_KINDS.USER_UI)) return false;
  return true;
}

function createProjectCapabilityContext(context = {}, principal = null) {
  const canonical = {
    origin: typeof context.origin === 'string' ? context.origin.trim() : context.origin,
  };
  if (context.directUserAction !== undefined) canonical.directUserAction = context.directUserAction;
  if (context.correlationId !== undefined) canonical.correlationId = context.correlationId;
  if (context.metadata !== undefined) canonical.metadata = context.metadata;
  if (!isProjectCapabilityContext(canonical, principal)) {
    throw new TypeError('Invalid project capability context');
  }
  return Object.freeze(canonical);
}

function isProjectCapabilityDescriptor(descriptor) {
  if (!(isRecord(descriptor)
    && isNonEmptyString(descriptor.capability)
    && isNonEmptyString(descriptor.action)
    && isNonEmptyString(descriptor.version)
    && SUPPORTED_KINDS.has(descriptor.kind)
    && Array.isArray(descriptor.effects)
    && descriptor.effects.length > 0
    && descriptor.effects.every((effect) => SUPPORTED_EFFECTS.has(effect)))) return false;
  for (const field of ['enabled', 'requiresApproval', 'requiresSandbox']) {
    if (descriptor[field] !== undefined && typeof descriptor[field] !== 'boolean') return false;
  }
  if (descriptor.risk !== undefined && !isNonEmptyString(descriptor.risk)) return false;
  if (descriptor.requiredSandboxFeatures !== undefined
    && (!Array.isArray(descriptor.requiredSandboxFeatures)
      || descriptor.requiredSandboxFeatures.some((feature) => !isNonEmptyString(feature)))) return false;
  for (const field of [
    'canonicalizePayload',
    'classifyEffects',
    'createSelector',
    'createSandboxExecutionSpec',
    'createSandboxExecutionRequest',
    'execute',
  ]) {
    if (descriptor[field] !== undefined && typeof descriptor[field] !== 'function') return false;
  }
  if (descriptor.createSandboxExecutionSpec && descriptor.createSandboxExecutionRequest) return false;
  if (descriptor.adapter !== undefined
    && (!isRecord(descriptor.adapter) || typeof descriptor.adapter.execute !== 'function')) return false;
  return true;
}

function assertProjectCapabilityDescriptor(descriptor) {
  if (!isProjectCapabilityDescriptor(descriptor)) {
    throw new TypeError('Invalid project capability descriptor');
  }
  return descriptor;
}

/**
 * Creates the operational descriptor consumed by the broker. Canonicalizers,
 * classifiers, selectors and sandbox-plan builders are trusted deterministic
 * functions and MUST be side-effect-free. Only `adapter.execute`/`execute` or
 * the selected sandbox backend may perform the authorized effect.
 */
function createProjectCapabilityDescriptor(input = {}) {
  const {
    capability,
    action,
    version,
    kind,
    effects,
  } = input;
  const uniqueEffects = Array.isArray(effects) ? [...new Set(effects)] : effects;
  const descriptor = {
    capability: typeof capability === 'string' ? capability.trim() : capability,
    action: typeof action === 'string' ? action.trim() : action,
    version: typeof version === 'string' ? version.trim() : version,
    kind,
    effects: Array.isArray(uniqueEffects) ? Object.freeze(uniqueEffects) : uniqueEffects,
  };
  for (const field of [
    'enabled',
    'requiresApproval',
    'requiresSandbox',
    'risk',
    'canonicalizePayload',
    'classifyEffects',
    'createSelector',
    'createSandboxExecutionSpec',
    'createSandboxExecutionRequest',
    'adapter',
    'execute',
  ]) {
    if (input[field] !== undefined) descriptor[field] = input[field];
  }
  if (input.requiredSandboxFeatures !== undefined) {
    descriptor.requiredSandboxFeatures = Array.isArray(input.requiredSandboxFeatures)
      ? Object.freeze([...new Set(input.requiredSandboxFeatures)])
      : input.requiredSandboxFeatures;
  }
  assertProjectCapabilityDescriptor(descriptor);
  const needsSandboxPlan = descriptor.requiresSandbox === true
    || descriptor.effects.includes(PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE);
  if (needsSandboxPlan
    && typeof descriptor.createSandboxExecutionSpec !== 'function'
    && typeof descriptor.createSandboxExecutionRequest !== 'function') {
    throw new TypeError('Operational process descriptor requires a sandbox plan builder');
  }
  if (!needsSandboxPlan
    && typeof descriptor.execute !== 'function'
    && (!descriptor.adapter || typeof descriptor.adapter.execute !== 'function')) {
    throw new TypeError('Operational descriptor requires an execution adapter');
  }
  return Object.freeze(descriptor);
}

function isProjectCapabilityRequest(request) {
  return isRecord(request)
    && hasOnlyKeys(request, [
      'schemaVersion',
      'requestId',
      'principal',
      'projectSession',
      'capability',
      'action',
      'payload',
      'context',
    ])
    && request.schemaVersion === PROJECT_CAPABILITY_REQUEST_SCHEMA_VERSION
    && isNonEmptyString(request.requestId)
    && isProjectCapabilityPrincipal(request.principal)
    && isProjectSession(request.projectSession)
    && isNonEmptyString(request.capability)
    && isNonEmptyString(request.action)
    && isRecord(request.payload)
    && isProjectCapabilityContext(request.context, request.principal);
}

function assertProjectCapabilityRequest(request) {
  if (!isProjectCapabilityRequest(request)) {
    throw new TypeError('Invalid project capability request');
  }
  return request;
}

function createProjectCapabilityRequest({
  requestId,
  principal,
  projectSession,
  capability,
  action,
  payload = {},
  context,
} = {}) {
  const canonicalPrincipal = createProjectCapabilityPrincipal(principal);
  const request = {
    schemaVersion: PROJECT_CAPABILITY_REQUEST_SCHEMA_VERSION,
    requestId: typeof requestId === 'string' ? requestId.trim() : requestId,
    principal: canonicalPrincipal,
    projectSession: createProjectSession(projectSession),
    capability: typeof capability === 'string' ? capability.trim() : capability,
    action: typeof action === 'string' ? action.trim() : action,
    payload,
    context: createProjectCapabilityContext(context, canonicalPrincipal),
  };
  assertProjectCapabilityRequest(request);
  return Object.freeze(request);
}

function isProjectCapabilityError(error) {
  return isRecord(error) && isNonEmptyString(error.code) && isNonEmptyString(error.message);
}

function normalizeProjectCapabilityError(error) {
  if (error === null || error === undefined) return null;
  const normalized = {
    code: typeof error.code === 'string' ? error.code.trim() : error.code,
    message: typeof error.message === 'string' ? error.message.trim() : error.message,
  };
  if (error.details !== undefined) normalized.details = error.details;
  if (!isProjectCapabilityError(normalized)) {
    throw new TypeError('Invalid project capability error');
  }
  return Object.freeze(normalized);
}

function isDecisionStatusPair(decision, status) {
  if (decision === PROJECT_CAPABILITY_DECISIONS.DENY) {
    return status === PROJECT_CAPABILITY_RESULT_STATUSES.DENIED;
  }
  if (decision === PROJECT_CAPABILITY_DECISIONS.REQUIRE_APPROVAL) {
    return status === PROJECT_CAPABILITY_RESULT_STATUSES.APPROVAL_REQUIRED;
  }
  return status === PROJECT_CAPABILITY_RESULT_STATUSES.ALLOWED
    || status === PROJECT_CAPABILITY_RESULT_STATUSES.COMPLETED
    || status === PROJECT_CAPABILITY_RESULT_STATUSES.FAILED;
}

function isProjectCapabilityResult(result) {
  if (!isRecord(result)) return false;
  if (result.schemaVersion !== PROJECT_CAPABILITY_RESULT_SCHEMA_VERSION) return false;
  if (!isNonEmptyString(result.requestId) || !isNonEmptyString(result.capability)) return false;
  if (!isNonEmptyString(result.action)) return false;
  if (!SUPPORTED_DECISIONS.has(result.decision) || !SUPPORTED_RESULT_STATUSES.has(result.status)) return false;
  if (!isDecisionStatusPair(result.decision, result.status)) return false;
  if (result.policy !== null && !isRecord(result.policy)) return false;
  if (result.approval !== null && !isRecord(result.approval)) return false;
  const requiresError = result.status === PROJECT_CAPABILITY_RESULT_STATUSES.DENIED
    || result.status === PROJECT_CAPABILITY_RESULT_STATUSES.FAILED;
  if (requiresError ? !isProjectCapabilityError(result.error) : result.error !== null) return false;
  return true;
}

function assertProjectCapabilityResult(result) {
  if (!isProjectCapabilityResult(result)) {
    throw new TypeError('Invalid project capability result');
  }
  return result;
}

function isProjectCapabilityInspection(inspection) {
  return isRecord(inspection)
    && inspection.schemaVersion === PROJECT_CAPABILITY_INSPECTION_SCHEMA_VERSION
    && isNonEmptyString(inspection.requestId)
    && isProjectSession(inspection.projectSession)
    && isNonEmptyString(inspection.capability)
    && isNonEmptyString(inspection.action)
    && Array.isArray(inspection.effects)
    && inspection.effects.every((effect) => SUPPORTED_EFFECTS.has(effect))
    && isNonEmptyString(inspection.risk)
    && SUPPORTED_DECISIONS.has(inspection.decision)
    && isNonEmptyString(inspection.reasonCode)
    && (inspection.grant === null
      || (isRecord(inspection.grant)
        && typeof inspection.grant.authorized === 'boolean'
        && isNonEmptyString(inspection.grant.reason)))
    && (inspection.sandbox === null || isRecord(inspection.sandbox));
}

function assertProjectCapabilityInspection(inspection) {
  if (!isProjectCapabilityInspection(inspection)) {
    throw new TypeError('Invalid project capability inspection');
  }
  return inspection;
}

function createProjectCapabilityResult({
  requestId,
  capability,
  action,
  decision,
  status,
  output = null,
  error = null,
  policy = null,
  approval = null,
} = {}) {
  const result = {
    schemaVersion: PROJECT_CAPABILITY_RESULT_SCHEMA_VERSION,
    requestId: typeof requestId === 'string' ? requestId.trim() : requestId,
    capability: typeof capability === 'string' ? capability.trim() : capability,
    action: typeof action === 'string' ? action.trim() : action,
    decision,
    status,
    output,
    error: normalizeProjectCapabilityError(error),
    policy,
    approval,
  };
  assertProjectCapabilityResult(result);
  return Object.freeze(result);
}

module.exports = {
  PROJECT_CAPABILITY_CONTRACT_VERSION,
  PROJECT_CAPABILITY_DECISIONS,
  PROJECT_CAPABILITY_EFFECTS,
  PROJECT_CAPABILITY_STANDARD_ERROR_CODES,
  PROJECT_CAPABILITY_KINDS,
  PROJECT_CAPABILITY_INSPECTION_SCHEMA_VERSION,
  PROJECT_CAPABILITY_PRINCIPAL_KINDS,
  PROJECT_CAPABILITY_REQUEST_SCHEMA_VERSION,
  PROJECT_CAPABILITY_RESULT_SCHEMA_VERSION,
  PROJECT_CAPABILITY_RESULT_STATUSES,
  assertProjectCapabilityDescriptor,
  assertProjectCapabilityInspection,
  assertProjectCapabilityRequest,
  assertProjectCapabilityResult,
  createProjectCapabilityContext,
  createProjectCapabilityDescriptor,
  createProjectCapabilityPrincipal,
  createProjectCapabilityRequest,
  createProjectCapabilityResult,
  isProjectCapabilityDescriptor,
  isProjectCapabilityInspection,
  isProjectCapabilityRequest,
  isProjectCapabilityResult,
};
