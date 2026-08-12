'use strict';

const crypto = require('crypto');

const {
  PROJECT_CAPABILITY_DECISIONS,
  PROJECT_CAPABILITY_INSPECTION_SCHEMA_VERSION,
  PROJECT_CAPABILITY_RESULT_STATUSES,
  assertProjectCapabilityDescriptor,
  assertProjectCapabilityInspection,
  assertProjectCapabilityRequest,
  createProjectCapabilityResult,
  isProjectCapabilityDescriptor,
} = require('./project_capability_contracts');
const {
  CAPABILITY_POLICY_DECISIONS,
  CAPABILITY_POLICY_VERSION,
} = require('./capability_policy_service');
const {
  SANDBOX_NETWORK_MODES,
  areEquivalentPortablePaths,
  assertSandboxExecutionRequest,
  createSandboxExecutionRequest,
  isPathInsideProjectRoot,
  isPortableAbsolutePath,
  isSandboxCommand,
} = require('./sandbox_backend_contract');

const BROKER_REASON_CODES = Object.freeze({
  APPROVAL_DENIED: 'APPROVAL_DENIED',
  APPROVAL_INVALID: 'APPROVAL_INVALID',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  AUTHORIZATION_FAILED: 'PROJECT_SCOPE_INVALID',
  CAPABILITY_NOT_FOUND: 'CAPABILITY_NOT_ALLOWED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  AUDIT_FAILED: 'AUDIT_FAILED',
  REVALIDATION_FAILED: 'REVALIDATION_FAILED',
  REQUEST_CHANGED: 'REQUEST_CHANGED',
  BROKER_BUSY: 'BROKER_BUSY',
  GRANT_REVALIDATION_FAILED: 'GRANT_REVALIDATION_FAILED',
  TERMINAL_REPLAY_NOT_AUTHORIZED: 'TERMINAL_REPLAY_NOT_AUTHORIZED',
});

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

class ProjectCapabilityBrokerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProjectCapabilityBrokerError';
    this.code = code;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireMethod(target, method, dependencyName) {
  if (!target || typeof target[method] !== 'function') {
    throw new TypeError(`${dependencyName}.${method} must be a function`);
  }
}

function safeAuditIdentifier(value) {
  const normalized = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(normalized) ? normalized : '[redacted]';
}

function safeReasonCode(value, fallback = 'INTERNAL_BROKER_ERROR') {
  const normalized = String(value || '').trim();
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(normalized) ? normalized : fallback;
}

function ownEnumerableDataKeys(value) {
  const arrayValue = Array.isArray(value);
  const keys = Object.keys(value);
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (arrayValue && key === 'length') continue;
    if (typeof key !== 'string') {
      throw new TypeError('Capability values must not contain symbol keys');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Capability values must contain enumerable data properties only');
    }
  }
  if (ownKeys.length !== keys.length + (arrayValue ? 1 : 0)) {
    throw new TypeError('Capability values contain unsupported own properties');
  }
  return keys;
}

function canonicalizeForDigest(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Capability payload must contain finite numbers');
    if (Object.is(value, -0)) throw new TypeError('Capability digest input must not contain negative zero');
    return value;
  }
  if (value === undefined) throw new TypeError('Capability digest input must not contain undefined');
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Capability payload must not contain cycles');
    const keys = ownEnumerableDataKeys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      throw new TypeError('Capability digest arrays must be dense and contain only indexed values');
    }
    seen.add(value);
    const result = value.map((entry) => canonicalizeForDigest(entry, seen));
    seen.delete(value);
    return result;
  }
  if (!isRecord(value)) throw new TypeError('Capability payload contains an unsupported value');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Capability digest input must contain plain objects');
  }
  if (seen.has(value)) throw new TypeError('Capability payload must not contain cycles');
  seen.add(value);
  const result = {};
  for (const key of ownEnumerableDataKeys(value).sort()) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new TypeError(`Capability digest input contains forbidden key: ${key}`);
    }
    const entry = value[key];
    if (typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
      throw new TypeError('Capability payload contains an unsupported value');
    }
    result[key] = canonicalizeForDigest(entry, seen);
  }
  seen.delete(value);
  return result;
}

function deepFreezeSnapshot(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreezeSnapshot);
  return Object.freeze(value);
}

function snapshotCapabilityOutput(value) {
  return deepFreezeSnapshot(canonicalizeForDigest(value === undefined ? null : value));
}

function createRequestDigest(request, prepared) {
  const digestInput = canonicalizeForDigest({
    requestId: request.requestId,
    principal: request.principal,
    projectSession: prepared.projectSession,
    capability: request.capability,
    action: request.action,
    context: request.context,
    payload: prepared.classification.canonicalPayload,
    effects: prepared.classification.effects,
    risk: prepared.classification.risk,
    requiresApproval: prepared.classification.requiresApproval,
    requiresSandbox: prepared.classification.requiresSandbox,
    requiredSandboxFeatures: prepared.classification.requiredSandboxFeatures,
    network: prepared.classification.network,
    destructive: prepared.classification.destructive,
    selector: prepared.classification.selector,
    sandboxPlan: prepared.sandboxPlan,
    descriptorVersion: prepared.classification.descriptorVersion,
    policyVersion: prepared.policyVersion,
  });
  return crypto.createHash('sha256').update(JSON.stringify(digestInput)).digest('hex');
}

function normalizeAuthorizedSession(requested, authorization) {
  if (!isRecord(authorization)
    || authorization.authorized !== true
    || (!isRecord(authorization.projectSession) && !isRecord(authorization.session))) {
    throw new ProjectCapabilityBrokerError(
      BROKER_REASON_CODES.AUTHORIZATION_FAILED,
      'Project session is not authorized.'
    );
  }
  const session = authorization.projectSession || authorization.session;
  if (!isRecord(session)
    || session.projectId !== requested.projectId
    || session.sessionId !== requested.sessionId
    || !isPortableAbsolutePath(session.rootPath)
    || !isPortableAbsolutePath(session.realRootPath)
    || !areEquivalentPortablePaths(session.rootPath, requested.rootPath)
    || !areEquivalentPortablePaths(session.realRootPath, requested.realRootPath)
    || String(session.jobId || '') !== String(requested.jobId || '')
    || (requested.cwd !== undefined
      && (!isPortableAbsolutePath(session.cwd)
        || !areEquivalentPortablePaths(session.cwd, requested.cwd)))
    || (requested.cwdRealPath !== undefined
      && (!isPortableAbsolutePath(session.cwdRealPath)
        || !areEquivalentPortablePaths(session.cwdRealPath, requested.cwdRealPath)))
    || ((session.cwd === undefined) !== (session.cwdRealPath === undefined))
    || (session.cwd !== undefined
      && (!isPortableAbsolutePath(session.cwd)
        || !isPortableAbsolutePath(session.cwdRealPath)
        || !isPathInsideProjectRoot(session.rootPath, session.cwd)
        || !isPathInsideProjectRoot(session.realRootPath, session.cwdRealPath)
      ))) {
    throw new ProjectCapabilityBrokerError(
      BROKER_REASON_CODES.AUTHORIZATION_FAILED,
      'Authorized project session does not match the requested project scope.'
    );
  }
  const authoritative = {};
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
    if (session[field] !== undefined) authoritative[field] = session[field];
  }
  return Object.freeze(authoritative);
}

function createProjectCapabilityBroker({
  authorizeProjectSession,
  descriptorResolver,
  classifier,
  policy,
  grantStore,
  pendingApprovalStore,
  approvalReviewer,
  sandboxRegistry,
  buildSandboxEnvironment,
  audit,
  now,
  cacheTtlMs = 5 * 60 * 1000,
  maxCacheEntries = 1000,
  maxPendingEntries = 250,
} = {}) {
  if (typeof authorizeProjectSession !== 'function') {
    throw new TypeError('authorizeProjectSession must be a function');
  }
  if (typeof descriptorResolver !== 'function') requireMethod(descriptorResolver, 'resolve', 'descriptorResolver');
  requireMethod(classifier, 'classify', 'classifier');
  requireMethod(policy, 'evaluate', 'policy');
  requireMethod(grantStore, 'inspect', 'grantStore');
  requireMethod(grantStore, 'consume', 'grantStore');
  requireMethod(pendingApprovalStore, 'create', 'pendingApprovalStore');
  requireMethod(pendingApprovalStore, 'resolve', 'pendingApprovalStore');
  requireMethod(sandboxRegistry, 'select', 'sandboxRegistry');
  if (typeof approvalReviewer !== 'function') {
    requireMethod(approvalReviewer, 'verifyDecision', 'approvalReviewer');
  }
  if (typeof buildSandboxEnvironment !== 'function') {
    throw new TypeError('buildSandboxEnvironment must be a function');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  for (const [name, value] of Object.entries({ cacheTtlMs, maxCacheEntries, maxPendingEntries })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  }
  if (typeof audit !== 'function') requireMethod(audit, 'record', 'audit');

  const inflight = new Map();
  const terminalResults = new Map();
  const pendingByRequest = new Map();
  let auditFailures = 0;

  function nowMs() {
    const value = Number(now());
    if (!Number.isFinite(value)) throw new TypeError('now() must return a finite timestamp');
    return value;
  }

  function purgeState() {
    const current = nowMs();
    for (const [key, entry] of terminalResults) {
      if (entry.expiresAt <= current) terminalResults.delete(key);
    }
    for (const [key, entry] of pendingByRequest) {
      if (entry.expiresAt <= current) pendingByRequest.delete(key);
    }
    while (terminalResults.size > maxCacheEntries) {
      terminalResults.delete(terminalResults.keys().next().value);
    }
  }

  function approvalExpiresAt(approval) {
    const current = nowMs();
    const raw = approval && approval.expiresAt;
    const numeric = Number(raw);
    const parsed = Number.isFinite(numeric) ? numeric : Date.parse(String(raw || ''));
    if (!Number.isFinite(parsed) || parsed <= current) {
      throw new TypeError('Pending approval must provide a future expiresAt timestamp');
    }
    return parsed;
  }

  async function recordAudit(event) {
    const safeEvent = Object.freeze({
      event: safeAuditIdentifier(event.event),
      requestId: safeAuditIdentifier(event.requestId),
      projectId: safeAuditIdentifier(event.projectId),
      sessionId: safeAuditIdentifier(event.sessionId),
      capability: safeAuditIdentifier(event.capability),
      action: safeAuditIdentifier(event.action),
      decision: event.decision || null,
      reasonCode: event.reasonCode ? safeReasonCode(event.reasonCode) : null,
      effects: Object.freeze([...(event.effects || [])]),
    });
    if (typeof audit === 'function') await audit(safeEvent);
    else await audit.record(safeEvent);
  }

  async function resolveDescriptor(request) {
    const descriptor = typeof descriptorResolver === 'function'
      ? await descriptorResolver(request.capability, request.action, request)
      : await descriptorResolver.resolve(request.capability, request.action, request);
    if (!isRecord(descriptor)
      || !isProjectCapabilityDescriptor(descriptor)
      || descriptor.capability !== request.capability
      || descriptor.action !== request.action) {
      throw new ProjectCapabilityBrokerError(
        BROKER_REASON_CODES.CAPABILITY_NOT_FOUND,
        'Capability action is not registered.'
      );
    }
    assertProjectCapabilityDescriptor(descriptor);
    return descriptor;
  }

  async function buildSandboxPlan({
    authorizedRequest,
    projectSession,
    descriptor,
    classification,
    sandboxSelection,
  }) {
    if (!classification.requiresSandbox
      || classification.hardDeny
      || !sandboxSelection
      || !sandboxSelection.probe
      || sandboxSelection.probe.state !== 'enforced'
      || !Array.isArray(sandboxSelection.probe.features)
      || !classification.requiredSandboxFeatures.every(
        (feature) => sandboxSelection.probe.features.includes(feature)
      )) return null;

    // Descriptor planning hooks are trusted, side-effect-free canonicalizers.
    // Their output is snapshotted into the approval digest and recomputed during
    // final revalidation; execution adapters are never called in this phase.
    const createExecutionSpec = descriptor.createSandboxExecutionSpec
      || descriptor.createSandboxExecutionRequest;
    if (typeof createExecutionSpec !== 'function') {
      throw new ProjectCapabilityBrokerError(
        BROKER_REASON_CODES.CAPABILITY_NOT_FOUND,
        'Process capability has no trusted sandbox planning adapter.'
      );
    }
    const executionSpec = await createExecutionSpec(
      classification.canonicalPayload,
      Object.freeze({
        requestId: authorizedRequest.requestId,
        principal: authorizedRequest.principal,
        projectSession,
        capability: authorizedRequest.capability,
        action: authorizedRequest.action,
        effects: classification.effects,
      })
    );
    if (!isRecord(executionSpec) || !isSandboxCommand(executionSpec.command)) {
      throw new ProjectCapabilityBrokerError(
        BROKER_REASON_CODES.REVALIDATION_FAILED,
        'Process capability returned an invalid sandbox execution plan.'
      );
    }
    const timeoutMs = executionSpec.timeoutMs === undefined ? 120000 : executionSpec.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new ProjectCapabilityBrokerError(
        BROKER_REASON_CODES.REVALIDATION_FAILED,
        'Process capability returned an invalid sandbox timeout.'
      );
    }
    const canonicalRequest = deepFreezeSnapshot(canonicalizeForDigest({
      schemaVersion: authorizedRequest.schemaVersion,
      requestId: authorizedRequest.requestId,
      principal: authorizedRequest.principal,
      projectSession,
      capability: authorizedRequest.capability,
      action: authorizedRequest.action,
      payload: classification.canonicalPayload,
      context: authorizedRequest.context,
    }));
    const canonicalExecution = deepFreezeSnapshot(canonicalizeForDigest({
      command: executionSpec.command,
      timeoutMs,
    }));
    const canonicalClassification = deepFreezeSnapshot(canonicalizeForDigest({
      capabilityId: classification.capabilityId,
      descriptorVersion: classification.descriptorVersion,
      action: classification.action,
      canonicalPayload: classification.canonicalPayload,
      effects: classification.effects,
      hardDeny: classification.hardDeny,
      hardDenyReason: classification.hardDenyReason,
      network: classification.network,
      destructive: classification.destructive,
      requiresApproval: classification.requiresApproval,
      requiresSandbox: classification.requiresSandbox,
      requiredSandboxFeatures: classification.requiredSandboxFeatures,
      risk: classification.risk,
      selector: classification.selector,
    }));
    const trustedEnvironment = await buildSandboxEnvironment(Object.freeze({
      canonicalRequest,
      classification: canonicalClassification,
      execution: canonicalExecution,
    }));
    if (!isRecord(trustedEnvironment)) {
      throw new ProjectCapabilityBrokerError(
        BROKER_REASON_CODES.REVALIDATION_FAILED,
        'Trusted sandbox environment builder returned an invalid environment.'
      );
    }
    if (Object.entries(trustedEnvironment).some(([key, value]) => (
      !key || key.includes('\0') || key.includes('=')
      || typeof value !== 'string' || value.includes('\0')
    ))) {
      throw new ProjectCapabilityBrokerError(
        BROKER_REASON_CODES.REVALIDATION_FAILED,
        'Trusted sandbox environment builder returned invalid environment entries.'
      );
    }
    return deepFreezeSnapshot(canonicalizeForDigest({
      command: canonicalExecution.command,
      env: trustedEnvironment,
      timeoutMs,
    }));
  }

  async function prepare(request) {
    assertProjectCapabilityRequest(request);

    // Authorization intentionally precedes descriptor lookup, probes, grants and adapters.
    const authorization = await authorizeProjectSession(request.projectSession, request);
    const projectSession = normalizeAuthorizedSession(request.projectSession, authorization);
    const requestSnapshot = deepFreezeSnapshot(canonicalizeForDigest({
      principal: request.principal,
      payload: request.payload,
      context: request.context,
    }));
    const authorizedRequest = Object.freeze({
      ...request,
      principal: requestSnapshot.principal,
      projectSession,
      payload: requestSnapshot.payload,
      context: requestSnapshot.context,
    });
    assertProjectCapabilityRequest(authorizedRequest);
    const descriptor = await resolveDescriptor(authorizedRequest);
    const classification = await classifier.classify({
      request: authorizedRequest,
      descriptor,
      projectSession,
    });
    if (!classification || typeof classification !== 'object') {
      throw new ProjectCapabilityBrokerError(
        BROKER_REASON_CODES.CAPABILITY_NOT_FOUND,
        'Capability classification failed closed.'
      );
    }
    if (!classification.requiresSandbox) {
      const adapter = descriptor.adapter || descriptor;
      if (!adapter || typeof adapter.execute !== 'function') {
        throw new ProjectCapabilityBrokerError(
          BROKER_REASON_CODES.CAPABILITY_NOT_FOUND,
          'Capability has no trusted execution adapter.'
        );
      }
    }

    let sandboxSelection = null;
    if (classification.requiresSandbox && !classification.hardDeny) {
      sandboxSelection = await sandboxRegistry.select({
        requiredFeatures: classification.requiredSandboxFeatures || [],
        projectSession,
        execution: Object.freeze({
          requestId: request.requestId,
          capability: request.capability,
          action: request.action,
        }),
      });
    }

    const prePlanPolicyDecision = await policy.evaluate({
      classification,
      sandboxProbe: sandboxSelection && sandboxSelection.probe,
    });
    const sandboxPlan = prePlanPolicyDecision.decision === CAPABILITY_POLICY_DECISIONS.DENY
      ? null
      : await buildSandboxPlan({
        authorizedRequest,
        projectSession,
        descriptor,
        classification,
        sandboxSelection,
      });

    const prepared = {
      request,
      authorizedRequest,
      projectSession,
      descriptor,
      classification,
      sandboxSelection,
      sandboxPlan,
      policyVersion: String(policy.version || CAPABILITY_POLICY_VERSION).trim(),
    };
    prepared.requestDigest = createRequestDigest(authorizedRequest, prepared);
    return Object.freeze(prepared);
  }

  function grantQuery(prepared) {
    const session = prepared.projectSession;
    return {
      projectId: session.projectId,
      rootPath: session.realRootPath,
      sessionId: session.sessionId,
      jobId: session.jobId || '',
      selector: prepared.classification.selector,
      requestDigest: prepared.requestDigest,
    };
  }

  function approvalContext(prepared) {
    const session = prepared.projectSession;
    return {
      requestDigest: prepared.requestDigest,
      projectId: session.projectId,
      rootPath: session.realRootPath,
      sessionId: session.sessionId,
      jobId: session.jobId || '',
      selector: prepared.classification.selector,
    };
  }

  function pendingKey(prepared) {
    return `${prepared.request.requestId}:${prepared.requestDigest}`;
  }

  async function verifyApproval(prepared, options) {
    if (!options
      || (options.decision !== 'allow' && options.decision !== 'deny')
      || options.proof === undefined
      || options.proof === null) {
      return Object.freeze({ verified: false, reason: BROKER_REASON_CODES.APPROVAL_INVALID });
    }
    const input = Object.freeze({
      approvalId: options.approvalId,
      requestDigest: prepared.requestDigest,
      projectSession: prepared.projectSession,
      capability: prepared.request.capability,
      action: prepared.request.action,
      decision: options.decision,
      proof: options.proof,
    });
    let reviewed;
    try {
      reviewed = typeof approvalReviewer === 'function'
        ? await approvalReviewer(input)
        : await approvalReviewer.verifyDecision(input);
    } catch {
      return Object.freeze({ verified: false, reason: BROKER_REASON_CODES.APPROVAL_INVALID });
    }
    if (!reviewed || reviewed.verified !== true || reviewed.decision !== options.decision) {
      return Object.freeze({ verified: false, reason: BROKER_REASON_CODES.APPROVAL_INVALID });
    }
    return Object.freeze({ verified: true, decision: reviewed.decision });
  }

  function publicPolicy(decision) {
    return Object.freeze({ decision: decision.decision, reasonCode: decision.reasonCode });
  }

  function resultFor(request, fields) {
    return createProjectCapabilityResult({
      requestId: request.requestId,
      capability: request.capability,
      action: request.action,
      ...fields,
    });
  }

  function deniedResult(request, reasonCode, policyDecision = null) {
    return resultFor(request, {
      decision: PROJECT_CAPABILITY_DECISIONS.DENY,
      status: PROJECT_CAPABILITY_RESULT_STATUSES.DENIED,
      error: { code: reasonCode, message: 'Capability execution was denied by policy.' },
      policy: policyDecision ? publicPolicy(policyDecision) : null,
    });
  }

  async function inspect(request) {
    const prepared = await prepare(request);
    let policyDecision = await policy.evaluate({
      classification: prepared.classification,
      sandboxProbe: prepared.sandboxSelection && prepared.sandboxSelection.probe,
    });
    let grantAuthorization = null;
    if (policyDecision.decision !== CAPABILITY_POLICY_DECISIONS.DENY) {
      grantAuthorization = await grantStore.inspect(grantQuery(prepared));
      policyDecision = await policy.evaluate({
        classification: prepared.classification,
        grantAuthorization,
        sandboxProbe: prepared.sandboxSelection && prepared.sandboxSelection.probe,
      });
    }
    const inspection = Object.freeze({
      schemaVersion: PROJECT_CAPABILITY_INSPECTION_SCHEMA_VERSION,
      requestId: request.requestId,
      projectSession: prepared.projectSession,
      capability: request.capability,
      action: request.action,
      effects: prepared.classification.effects,
      risk: prepared.classification.risk,
      decision: policyDecision.decision,
      reasonCode: policyDecision.reasonCode,
      grant: grantAuthorization
        ? Object.freeze({
          authorized: grantAuthorization.authorized === true,
          reason: safeAuditIdentifier(grantAuthorization.reason || 'unknown'),
        })
        : null,
      sandbox: prepared.sandboxSelection
        ? Object.freeze({
          backendId: prepared.sandboxSelection.backend.id,
          state: prepared.sandboxSelection.probe.state,
          features: prepared.sandboxSelection.probe.features,
        })
        : null,
    });
    assertProjectCapabilityInspection(inspection);
    return inspection;
  }

  async function authorizeTerminalReplay(prepared, result) {
    const sandboxProbe = prepared.sandboxSelection && prepared.sandboxSelection.probe;
    const baseDecision = await policy.evaluate({
      classification: prepared.classification,
      sandboxProbe,
    });
    if (baseDecision.decision === CAPABILITY_POLICY_DECISIONS.DENY) return false;
    const reasonCode = result && result.policy && result.policy.reasonCode;
    if (reasonCode === 'APPROVAL_AUTHORIZED') return true;
    if (reasonCode === 'GRANT_AUTHORIZED') {
      const currentGrant = await grantStore.inspect(grantQuery(prepared));
      const currentDecision = await policy.evaluate({
        classification: prepared.classification,
        grantAuthorization: currentGrant,
        sandboxProbe,
      });
      return currentDecision.decision === CAPABILITY_POLICY_DECISIONS.ALLOW
        && currentDecision.reasonCode === 'GRANT_AUTHORIZED';
    }
    return baseDecision.decision === CAPABILITY_POLICY_DECISIONS.ALLOW;
  }

  function prepareEffect(prepared) {
    const {
      descriptor,
      classification,
      authorizedRequest,
      projectSession,
      sandboxSelection,
      sandboxPlan,
    } = prepared;
    const context = Object.freeze({
      requestId: authorizedRequest.requestId,
      principal: authorizedRequest.principal,
      projectSession,
      capability: authorizedRequest.capability,
      action: authorizedRequest.action,
      effects: classification.effects,
    });

    if (classification.requiresSandbox) {
      if (!sandboxSelection || !sandboxSelection.backend || !sandboxPlan) {
        throw new ProjectCapabilityBrokerError('SANDBOX_UNAVAILABLE', 'Enforced sandbox is unavailable.');
      }
      const expectedNetworkMode = classification.network
        ? SANDBOX_NETWORK_MODES.APPROVED
        : SANDBOX_NETWORK_MODES.DISABLED;
      const executionId = `sandbox-exec:${prepared.requestDigest}`;
      const sandboxGrantId = `sandbox-auth:${prepared.requestDigest}`;
      const sandboxRequest = createSandboxExecutionRequest({
        executionId,
        requestId: authorizedRequest.requestId,
        grantId: sandboxGrantId,
        rootPath: projectSession.rootPath,
        realRootPath: projectSession.realRootPath,
        cwd: projectSession.cwd || projectSession.rootPath,
        cwdRealPath: projectSession.cwdRealPath || projectSession.realRootPath,
        command: sandboxPlan.command,
        env: sandboxPlan.env,
        requiredFeatures: classification.requiredSandboxFeatures,
        networkMode: expectedNetworkMode,
        // External writable roots require a future, separately authorized capability.
        tempRoots: [],
        cacheRoots: [],
        timeoutMs: sandboxPlan.timeoutMs,
      });
      assertSandboxExecutionRequest(sandboxRequest);
      if (sandboxRequest.requestId !== authorizedRequest.requestId
        || sandboxRequest.rootPath !== projectSession.rootPath
        || sandboxRequest.realRootPath !== projectSession.realRootPath
        || sandboxRequest.executionId !== executionId
        || sandboxRequest.grantId !== sandboxGrantId) {
        throw new ProjectCapabilityBrokerError(
          BROKER_REASON_CODES.REVALIDATION_FAILED,
          'Sandbox execution request is not bound to the authorized project request.'
        );
      }
      return Object.freeze({
        execute() {
          return sandboxSelection.backend.execute(sandboxRequest);
        },
      });
    }

    const adapter = descriptor.adapter || descriptor;
    if (!adapter || typeof adapter.execute !== 'function') {
      throw new ProjectCapabilityBrokerError(
        BROKER_REASON_CODES.CAPABILITY_NOT_FOUND,
        'Capability has no trusted execution adapter.'
      );
    }
    return Object.freeze({
      execute() {
        return adapter.execute(classification.canonicalPayload, context);
      },
    });
  }

  async function executeOnce(request, options = {}, prepared) {
    const hardBoundaryDecision = await policy.evaluate({
      classification: prepared.classification,
      sandboxProbe: prepared.sandboxSelection && prepared.sandboxSelection.probe,
    });
    if (hardBoundaryDecision.decision === CAPABILITY_POLICY_DECISIONS.DENY) {
      const denied = deniedResult(request, hardBoundaryDecision.reasonCode, hardBoundaryDecision);
      await recordAudit({
        event: 'capability_denied',
        requestId: request.requestId,
        projectId: prepared.projectSession.projectId,
        sessionId: prepared.projectSession.sessionId,
        capability: request.capability,
        action: request.action,
        decision: hardBoundaryDecision.decision,
        reasonCode: hardBoundaryDecision.reasonCode,
        effects: prepared.classification.effects,
      });
      return denied;
    }

    const grantAuthorization = await grantStore.inspect(grantQuery(prepared));
    let approvalAuthorization = null;
    let policyDecision = await policy.evaluate({
      classification: prepared.classification,
      grantAuthorization,
      sandboxProbe: prepared.sandboxSelection && prepared.sandboxSelection.probe,
    });

    // A hard denial (including a missing enforced sandbox) cannot be overridden.
    if (policyDecision.decision === CAPABILITY_POLICY_DECISIONS.DENY) {
      const denied = deniedResult(request, policyDecision.reasonCode, policyDecision);
      await recordAudit({
        event: 'capability_denied',
        requestId: request.requestId,
        projectId: prepared.projectSession.projectId,
        sessionId: prepared.projectSession.sessionId,
        capability: request.capability,
        action: request.action,
        decision: policyDecision.decision,
        reasonCode: policyDecision.reasonCode,
        effects: prepared.classification.effects,
      });
      return denied;
    }

    if (policyDecision.decision === CAPABILITY_POLICY_DECISIONS.REQUIRE_APPROVAL) {
      if (!options.approvalId) {
        purgeState();
        const key = pendingKey(prepared);
        let created = pendingByRequest.get(key);
        if (!created || created.requestDigest !== prepared.requestDigest) {
          if (pendingByRequest.size >= maxPendingEntries) {
            await recordAudit({
              event: 'capability_denied',
              requestId: request.requestId,
              projectId: prepared.projectSession.projectId,
              sessionId: prepared.projectSession.sessionId,
              capability: request.capability,
              action: request.action,
              decision: 'deny',
              reasonCode: BROKER_REASON_CODES.BROKER_BUSY,
              effects: prepared.classification.effects,
            });
            return deniedResult(request, BROKER_REASON_CODES.BROKER_BUSY);
          }
          created = await pendingApprovalStore.create(approvalContext(prepared));
          pendingByRequest.set(key, {
            requestDigest: prepared.requestDigest,
            approval: created.approval,
            expiresAt: approvalExpiresAt(created.approval),
          });
          purgeState();
        } else {
          created = { approval: created.approval };
        }
        const result = resultFor(request, {
          decision: PROJECT_CAPABILITY_DECISIONS.REQUIRE_APPROVAL,
          status: PROJECT_CAPABILITY_RESULT_STATUSES.APPROVAL_REQUIRED,
          policy: publicPolicy(policyDecision),
          approval: created.approval,
        });
        await recordAudit({
          event: 'capability_approval_required',
          requestId: request.requestId,
          projectId: prepared.projectSession.projectId,
          sessionId: prepared.projectSession.sessionId,
          capability: request.capability,
          action: request.action,
          decision: policyDecision.decision,
          reasonCode: policyDecision.reasonCode,
          effects: prepared.classification.effects,
        });
        return result;
      }

      const verifiedDecision = await verifyApproval(prepared, options);
      if (!verifiedDecision.verified) {
        await recordAudit({
          event: 'capability_denied',
          requestId: request.requestId,
          projectId: prepared.projectSession.projectId,
          sessionId: prepared.projectSession.sessionId,
          capability: request.capability,
          action: request.action,
          decision: 'deny',
          reasonCode: BROKER_REASON_CODES.APPROVAL_INVALID,
          effects: prepared.classification.effects,
        });
        return deniedResult(request, BROKER_REASON_CODES.APPROVAL_INVALID);
      }

      const resolved = await pendingApprovalStore.resolve({
        ...approvalContext(prepared),
        approvalId: options.approvalId,
        decision: verifiedDecision.decision,
      });
      pendingByRequest.delete(pendingKey(prepared));
      if (!resolved || resolved.resolved !== true || resolved.decision !== 'allow') {
        const code = resolved && resolved.resolved === true
          ? BROKER_REASON_CODES.APPROVAL_DENIED
          : BROKER_REASON_CODES.APPROVAL_INVALID;
        await recordAudit({
          event: 'capability_denied',
          requestId: request.requestId,
          projectId: prepared.projectSession.projectId,
          sessionId: prepared.projectSession.sessionId,
          capability: request.capability,
          action: request.action,
          decision: 'deny',
          reasonCode: code,
          effects: prepared.classification.effects,
        });
        return deniedResult(request, code);
      }
      approvalAuthorization = { authorized: true };
      policyDecision = await policy.evaluate({
        classification: prepared.classification,
        grantAuthorization,
        approvalAuthorization,
        sandboxProbe: prepared.sandboxSelection && prepared.sandboxSelection.probe,
      });
    }

    // Re-authorize and re-canonicalize before recording execution intent. A
    // final authority-only check below closes revocation during the audit wait.
    let revalidated;
    try {
      revalidated = await prepare(request);
      if (revalidated.requestDigest !== prepared.requestDigest) {
        throw new ProjectCapabilityBrokerError(
          BROKER_REASON_CODES.REQUEST_CHANGED,
          'Capability request changed after policy evaluation.'
        );
      }
      const finalDecision = await policy.evaluate({
        classification: revalidated.classification,
        grantAuthorization,
        approvalAuthorization,
        sandboxProbe: revalidated.sandboxSelection && revalidated.sandboxSelection.probe,
      });
      if (finalDecision.decision !== CAPABILITY_POLICY_DECISIONS.ALLOW) {
        throw new ProjectCapabilityBrokerError(finalDecision.reasonCode, 'Capability failed revalidation.');
      }
    } catch (error) {
      const code = safeReasonCode(
        error && error.code,
        BROKER_REASON_CODES.REVALIDATION_FAILED
      );
      await recordAudit({
        event: 'capability_denied',
        requestId: request.requestId,
        projectId: prepared.projectSession.projectId,
        sessionId: prepared.projectSession.sessionId,
        capability: request.capability,
        action: request.action,
        decision: 'deny',
        reasonCode: code,
        effects: prepared.classification.effects,
      });
      return deniedResult(request, code);
    }

    try {
      await recordAudit({
        event: 'capability_execution_started',
        requestId: request.requestId,
        projectId: revalidated.projectSession.projectId,
        sessionId: revalidated.projectSession.sessionId,
        capability: request.capability,
        action: request.action,
        decision: 'allow',
        reasonCode: policyDecision.reasonCode,
        effects: revalidated.classification.effects,
      });
    } catch {
      auditFailures += 1;
      return resultFor(request, {
        decision: PROJECT_CAPABILITY_DECISIONS.ALLOW,
        status: PROJECT_CAPABILITY_RESULT_STATUSES.FAILED,
        error: { code: BROKER_REASON_CODES.AUDIT_FAILED, message: 'Capability audit failed before execution.' },
        policy: publicPolicy(policyDecision),
      });
    }

    let effectPlan;
    try {
      effectPlan = prepareEffect(revalidated);
    } catch {
      try {
        await recordAudit({
          event: 'capability_execution_failed',
          requestId: request.requestId,
          projectId: revalidated.projectSession.projectId,
          sessionId: revalidated.projectSession.sessionId,
          capability: request.capability,
          action: request.action,
          decision: 'allow',
          reasonCode: BROKER_REASON_CODES.EXECUTION_FAILED,
          effects: revalidated.classification.effects,
        });
      } catch {
        auditFailures += 1;
      }
      return resultFor(request, {
        decision: PROJECT_CAPABILITY_DECISIONS.ALLOW,
        status: PROJECT_CAPABILITY_RESULT_STATUSES.FAILED,
        error: { code: BROKER_REASON_CODES.EXECUTION_FAILED, message: 'Capability preparation failed.' },
        policy: publicPolicy(policyDecision),
      });
    }

    // Audit is an async boundary. Re-check the authoritative project scope
    // after it and after all effect planning, before consuming a grant or
    // invoking any adapter/backend.
    try {
      const finalAuthorization = await authorizeProjectSession(
        revalidated.projectSession,
        revalidated.authorizedRequest
      );
      normalizeAuthorizedSession(revalidated.projectSession, finalAuthorization);
    } catch (error) {
      const code = safeReasonCode(error && error.code, BROKER_REASON_CODES.AUTHORIZATION_FAILED);
      try {
        await recordAudit({
          event: 'capability_denied',
          requestId: request.requestId,
          projectId: revalidated.projectSession.projectId,
          sessionId: revalidated.projectSession.sessionId,
          capability: request.capability,
          action: request.action,
          decision: 'deny',
          reasonCode: code,
          effects: revalidated.classification.effects,
        });
      } catch {
        auditFailures += 1;
      }
      return deniedResult(request, code);
    }

    if (grantAuthorization && grantAuthorization.authorized === true) {
      const consumed = await grantStore.consume({
        ...grantQuery(revalidated),
        grantId: grantAuthorization.grant && grantAuthorization.grant.grantId,
      });
      if (!consumed || consumed.authorized !== true) {
        const denied = deniedResult(request, BROKER_REASON_CODES.GRANT_REVALIDATION_FAILED);
        await recordAudit({
          event: 'capability_denied',
          requestId: request.requestId,
          projectId: revalidated.projectSession.projectId,
          sessionId: revalidated.projectSession.sessionId,
          capability: request.capability,
          action: request.action,
          decision: 'deny',
          reasonCode: BROKER_REASON_CODES.GRANT_REVALIDATION_FAILED,
          effects: revalidated.classification.effects,
        });
        return denied;
      }
    }

    try {
      const output = snapshotCapabilityOutput(await effectPlan.execute());
      const completed = resultFor(request, {
        decision: PROJECT_CAPABILITY_DECISIONS.ALLOW,
        status: PROJECT_CAPABILITY_RESULT_STATUSES.COMPLETED,
        output,
        policy: publicPolicy(policyDecision),
      });
      try {
        await recordAudit({
          event: 'capability_execution_completed',
          requestId: request.requestId,
          projectId: revalidated.projectSession.projectId,
          sessionId: revalidated.projectSession.sessionId,
          capability: request.capability,
          action: request.action,
          decision: 'allow',
          reasonCode: policyDecision.reasonCode,
          effects: revalidated.classification.effects,
        });
      } catch {
        auditFailures += 1;
      }
      return completed;
    } catch {
      const failed = resultFor(request, {
        decision: PROJECT_CAPABILITY_DECISIONS.ALLOW,
        status: PROJECT_CAPABILITY_RESULT_STATUSES.FAILED,
        error: { code: BROKER_REASON_CODES.EXECUTION_FAILED, message: 'Capability execution failed.' },
        policy: publicPolicy(policyDecision),
      });
      try {
        await recordAudit({
          event: 'capability_execution_failed',
          requestId: request.requestId,
          projectId: revalidated.projectSession.projectId,
          sessionId: revalidated.projectSession.sessionId,
          capability: request.capability,
          action: request.action,
          decision: 'allow',
          reasonCode: BROKER_REASON_CODES.EXECUTION_FAILED,
          effects: revalidated.classification.effects,
        });
      } catch {
        auditFailures += 1;
      }
      return failed;
    }
  }

  async function execute(request, options = {}) {
    assertProjectCapabilityRequest(request);
    let prepared;
    try {
      prepared = await prepare(request);
    } catch (error) {
      const code = safeReasonCode(
        error && error.code,
        'INVALID_CAPABILITY_REQUEST'
      );
      await recordAudit({
        event: 'capability_denied',
        requestId: request.requestId,
        projectId: request.projectSession.projectId,
        sessionId: request.projectSession.sessionId,
        capability: request.capability,
        action: request.action,
        decision: 'deny',
        reasonCode: code,
      });
      return deniedResult(request, code);
    }
    purgeState();

    // Cache access occurs only after project authorization and is digest scoped.
    const cacheKey = `${request.requestId}:${prepared.requestDigest}`;
    const terminal = terminalResults.get(cacheKey);
    if (terminal) {
      let replayAuthorized = false;
      try {
        replayAuthorized = await authorizeTerminalReplay(prepared, terminal.result);
      } catch {
        replayAuthorized = false;
      }
      if (!replayAuthorized) {
        await recordAudit({
          event: 'capability_denied',
          requestId: request.requestId,
          projectId: prepared.projectSession.projectId,
          sessionId: prepared.projectSession.sessionId,
          capability: request.capability,
          action: request.action,
          decision: 'deny',
          reasonCode: BROKER_REASON_CODES.TERMINAL_REPLAY_NOT_AUTHORIZED,
          effects: prepared.classification.effects,
        });
        return deniedResult(request, BROKER_REASON_CODES.TERMINAL_REPLAY_NOT_AUTHORIZED);
      }
      return terminal.result;
    }
    const current = inflight.get(cacheKey);
    if (current) return current;
    if (inflight.size >= maxCacheEntries) {
      return deniedResult(request, BROKER_REASON_CODES.BROKER_BUSY);
    }

    const operation = executeOnce(request, options, prepared).then((result) => {
      if (result.status === PROJECT_CAPABILITY_RESULT_STATUSES.COMPLETED
        || result.status === PROJECT_CAPABILITY_RESULT_STATUSES.FAILED) {
        terminalResults.set(cacheKey, { result, expiresAt: nowMs() + cacheTtlMs });
        purgeState();
      }
      return result;
    }).finally(() => {
      inflight.delete(cacheKey);
    });
    inflight.set(cacheKey, operation);
    return operation;
  }

  async function approveAndExecute(request, { approvalId, decision, proof } = {}) {
    return execute(request, { approvalId, decision, proof });
  }

  function diagnostics() {
    return Object.freeze({
      inflightRequests: inflight.size,
      terminalRequests: terminalResults.size,
      pendingRequests: pendingByRequest.size,
      auditFailures,
      cacheTtlMs,
      maxCacheEntries,
      maxPendingEntries,
      idempotencyScope: 'process_local',
      externalMutationIntegration: 'disabled',
    });
  }

  return Object.freeze({ approveAndExecute, diagnostics, execute, inspect });
}

module.exports = {
  BROKER_REASON_CODES,
  ProjectCapabilityBrokerError,
  createProjectCapabilityBroker,
  createRequestDigest,
};
