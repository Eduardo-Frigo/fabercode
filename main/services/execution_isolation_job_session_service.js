'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');
const {
  EXECUTION_WORKSPACE_LEASE_VERSION,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  EXECUTION_WORKSPACE_REGISTRY_VERSION,
} = require('../capabilities/execution_workspace_registry');
const {
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  assertProjectRootReader,
} = require('../capabilities/project_root_authority_contract');
const {
  PROCESS_SUPERVISOR_STATES,
  assertProcessSupervisorProbeResult,
} = require('../capabilities/process_supervisor_contract');
const {
  PROCESS_SUPERVISOR_VERSION,
} = require('../agent_runtime/execution/process_supervisor');
const {
  EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_DISPOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_VERSION,
  createExecutionIsolationJobProcessGateway,
} = require('./execution_isolation_job_process_gateway');

const EXECUTION_ISOLATION_JOB_SESSION_SERVICE_VERSION =
  'execution-isolation-job-session-service.v3';
const EXECUTION_ISOLATION_JOB_SESSION_VERSION =
  'execution-isolation-job-session.v3';
const EXECUTION_ISOLATION_JOB_SESSION_DISPOSE_RECEIPT_VERSION =
  'execution-isolation-job-session-dispose-receipt.v2';
const EXECUTION_ISOLATION_JOB_SESSION_CLOSE_RECEIPT_VERSION =
  'execution-isolation-job-session-close-receipt.v1';

const DEFAULT_MAX_ACTIVE_SESSIONS = 64;
const HARD_MAX_ACTIVE_SESSIONS = 1_024;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);

const EXECUTION_ISOLATION_JOB_SESSION_REASONS = Object.freeze({
  CAPACITY_EXCEEDED: 'EXECUTION_ISOLATION_SESSION_CAPACITY_EXCEEDED',
  DISPOSED: 'EXECUTION_ISOLATION_SESSION_SERVICE_DISPOSED',
  INVALID_INPUT: 'EXECUTION_ISOLATION_SESSION_INVALID_INPUT',
  MUTATION_REVISION_MISMATCH: 'EXECUTION_ISOLATION_SESSION_MUTATION_REVISION_MISMATCH',
  PROCESS_ACTIVE: 'EXECUTION_ISOLATION_SESSION_PROCESS_ACTIVE',
  PROCESS_UNAVAILABLE: 'EXECUTION_ISOLATION_PROCESS_UNAVAILABLE',
  PROCESS_GATEWAY_FAILED: 'EXECUTION_ISOLATION_PROCESS_GATEWAY_FAILED',
  ROOT_ACQUIRE_FAILED: 'EXECUTION_ISOLATION_ROOT_ACQUIRE_FAILED',
  SESSION_CLOSED: 'EXECUTION_ISOLATION_SESSION_CLOSED',
  SESSION_MISMATCH: 'EXECUTION_ISOLATION_SESSION_MISMATCH',
  SESSION_NOT_FOUND: 'EXECUTION_ISOLATION_SESSION_NOT_FOUND',
  SESSION_UNHEALTHY: 'EXECUTION_ISOLATION_SESSION_UNHEALTHY',
  WORKSPACE_ACQUIRE_FAILED: 'EXECUTION_ISOLATION_WORKSPACE_ACQUIRE_FAILED',
});

function denied(code) {
  return Object.freeze({ ok: false, code });
}

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

function captureOwnMethod(receiver, name) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(receiver, name);
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) return null;
  return Object.freeze({ receiver, method: descriptor.value });
}

function settledOutcome(value) {
  if (!util.types.isPromise(value)) {
    return Promise.resolve(Object.freeze({ ok: true, value }));
  }
  return new Promise((resolve) => {
    const onFulfilled = (resolvedValue) => resolve(Object.freeze({
      ok: true,
      value: resolvedValue,
    }));
    const onRejected = (error) => {
      preflightDataGraph(error);
      resolve(Object.freeze({ ok: false, value: null }));
    };
    try {
      Reflect.apply(Promise.prototype.then, value, [onFulfilled, onRejected]);
    } catch (error) {
      preflightDataGraph(error);
      resolve(Object.freeze({ ok: false, value: null }));
    }
  });
}

function invokeCaptured(captured, args = []) {
  let raw;
  try {
    raw = Reflect.apply(captured.method, captured.receiver, args);
  } catch (error) {
    preflightDataGraph(error);
    return Promise.resolve(Object.freeze({ ok: false, value: null }));
  }
  return settledOutcome(raw);
}

function normalizeOpenInput(value) {
  const fields = exactOwnDataFields(value, [
    'binding',
    'sourceRootIdentityDigest',
    'mutationRevision',
  ]);
  if (!fields) return null;
  try {
    const mutationRevision = fields.get('mutationRevision');
    if (!Number.isSafeInteger(mutationRevision) || mutationRevision < 0
      || Object.is(mutationRevision, -0)) return null;
    return Object.freeze({
      binding: createCapabilityDelegationBinding(fields.get('binding')),
      sourceRootIdentityDigest: normalizeDigest(
        fields.get('sourceRootIdentityDigest'),
        'sourceRootIdentityDigest'
      ),
      mutationRevision,
    });
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
}

function normalizeCloseInput(value) {
  const fields = exactOwnDataFields(value, ['binding']);
  if (!fields) return null;
  try {
    return Object.freeze({
      binding: createCapabilityDelegationBinding(fields.get('binding')),
    });
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
}

function bindingsMatch(left, right) {
  return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function inputsMatch(left, right) {
  return bindingsMatch(left.binding, right.binding)
    && left.sourceRootIdentityDigest === right.sourceRootIdentityDigest;
}

function normalizeSuccessfulAcquire(outcome) {
  if (!outcome.ok || !Object.isFrozen(outcome.value)) return null;
  const fields = exactOwnDataFields(
    outcome.value,
    ['ok', 'lease', 'idempotent'],
    ['ok', 'lease']
  );
  if (!fields || fields.get('ok') !== true
    || (fields.has('idempotent')
      && typeof fields.get('idempotent') !== 'boolean')) return null;
  return fields.get('lease');
}

function normalizeRootLease(value, input) {
  const fields = exactOwnDataFields(value, [
    'version',
    'leaseId',
    'jobId',
    'projectId',
    'purpose',
    'physicalRootIdentityDigest',
    'authorityDigest',
    'reader',
    'close',
  ]);
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== PROJECT_ROOT_AUTHORITY_LEASE_VERSION
    || typeof fields.get('leaseId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('leaseId'))
    || fields.get('jobId') !== input.binding.jobId
    || fields.get('projectId') !== input.binding.projectId
    || fields.get('purpose') !== 'execution'
    || fields.get('physicalRootIdentityDigest') !== input.sourceRootIdentityDigest
    || typeof fields.get('authorityDigest') !== 'string'
    || !DIGEST.test(fields.get('authorityDigest'))
    || typeof fields.get('close') !== 'function') return null;
  try {
    assertProjectRootReader(fields.get('reader'));
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  return value;
}

function normalizeWorkspaceLease(value, input) {
  const fields = exactOwnDataFields(value, [
    'version',
    'leaseId',
    'jobId',
    'sourceRootIdentityDigest',
    'workspaceAuthorityDigest',
    'workspaceRootIdentityDigest',
    'workspaceRootPath',
    'workspaceRealRootPath',
  ]);
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== EXECUTION_WORKSPACE_LEASE_VERSION
    || typeof fields.get('leaseId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('leaseId'))
    || fields.get('jobId') !== input.binding.jobId
    || fields.get('sourceRootIdentityDigest') !== input.sourceRootIdentityDigest
    || !['workspaceAuthorityDigest', 'workspaceRootIdentityDigest'].every((key) => (
      typeof fields.get(key) === 'string' && DIGEST.test(fields.get(key))
    ))
    || typeof fields.get('workspaceRootPath') !== 'string'
    || typeof fields.get('workspaceRealRootPath') !== 'string') return null;
  return value;
}

function successfulWorkspaceRollback(outcome) {
  if (!outcome.ok || !Object.isFrozen(outcome.value)) return false;
  const fields = exactOwnDataFields(
    outcome.value,
    ['ok', 'rolledBack', 'idempotent']
  );
  return Boolean(fields
    && fields.get('ok') === true
    && fields.get('rolledBack') === true
    && typeof fields.get('idempotent') === 'boolean');
}

function successfulRootRelease(outcome) {
  if (!outcome.ok || !Object.isFrozen(outcome.value)) return false;
  const fields = exactOwnDataFields(outcome.value, ['ok', 'closed', 'idempotent']);
  return Boolean(fields
    && fields.get('ok') === true
    && fields.get('closed') === true
    && typeof fields.get('idempotent') === 'boolean');
}

function successfulProcessGatewayDispose(outcome) {
  if (!outcome.ok || !Object.isFrozen(outcome.value)) return false;
  const fields = exactOwnDataFields(outcome.value, [
    'version',
    'ok',
    'disposed',
    'active',
    'terminal',
    'quarantined',
  ]);
  return Boolean(fields
    && fields.get('version')
      === EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_DISPOSE_RECEIPT_VERSION
    && fields.get('ok') === true
    && fields.get('disposed') === true
    && fields.get('active') === 0
    && Number.isSafeInteger(fields.get('terminal'))
    && fields.get('terminal') >= 0
    && fields.get('quarantined') === 0);
}

function captureDependencies(options) {
  const optionFields = exactOwnDataFields(options, [
    'executionWorkspaceRegistry',
    'projectRootAuthorityRegistry',
    'processSupervisor',
    'maxActiveSessions',
  ], [
    'executionWorkspaceRegistry',
    'projectRootAuthorityRegistry',
    'processSupervisor',
  ]);
  if (!optionFields) {
    throw new TypeError('Invalid execution isolation job session service options');
  }
  const workspace = optionFields.get('executionWorkspaceRegistry');
  const root = optionFields.get('projectRootAuthorityRegistry');
  const process = optionFields.get('processSupervisor');
  const workspaceFields = exactOwnDataFields(workspace, [
    'version',
    'acquire',
    'rollback',
    'diagnostics',
    'dispose',
  ]);
  const rootFields = exactOwnDataFields(root, [
    'acquire',
    'diagnostics',
    'dispose',
    'release',
  ]);
  const processFields = exactOwnDataFields(process, [
    'version',
    'probe',
    'exec',
    'read',
    'wait',
    'stop',
    'diagnostics',
    'dispose',
  ]);
  if (!workspaceFields || !rootFields || !processFields
    || !Object.isFrozen(workspace) || !Object.isFrozen(root) || !Object.isFrozen(process)
    || workspaceFields.get('version') !== EXECUTION_WORKSPACE_REGISTRY_VERSION
    || processFields.get('version') !== PROCESS_SUPERVISOR_VERSION) {
    throw new TypeError('Invalid execution isolation job session dependencies');
  }
  const captured = {
    workspaceAcquire: captureOwnMethod(workspace, 'acquire'),
    workspaceRollback: captureOwnMethod(workspace, 'rollback'),
    rootAcquire: captureOwnMethod(root, 'acquire'),
    rootRelease: captureOwnMethod(root, 'release'),
    processProbe: captureOwnMethod(process, 'probe'),
  };
  if (Object.values(captured).some((entry) => !entry)) {
    throw new TypeError('Invalid execution isolation job session dependencies');
  }
  const maxActiveSessions = optionFields.has('maxActiveSessions')
    ? optionFields.get('maxActiveSessions')
    : DEFAULT_MAX_ACTIVE_SESSIONS;
  if (!Number.isSafeInteger(maxActiveSessions) || maxActiveSessions < 1
    || maxActiveSessions > HARD_MAX_ACTIVE_SESSIONS
    || Object.is(maxActiveSessions, -0)) {
    throw new TypeError('Invalid execution isolation job session capacity');
  }
  return Object.freeze({
    ...captured,
    processSupervisor: process,
    maxActiveSessions,
  });
}

function createExecutionIsolationJobSessionService(options = {}) {
  const dependencies = captureDependencies(options);
  const records = new Map();
  let serviceState = 'ready';
  let processState = 'unprobed';
  let processProbePromise = null;
  let disposeRequested = false;
  let disposePromise = null;
  let disposeReceipt = null;
  let closedCount = 0;

  function ensureProcessProbe() {
    if (processProbePromise) return processProbePromise;
    processProbePromise = invokeCaptured(dependencies.processProbe).then((outcome) => {
      if (!outcome.ok) {
        processState = 'rejected';
        serviceState = 'blocked';
        return false;
      }
      try {
        const probe = assertProcessSupervisorProbeResult(outcome.value);
        processState = probe.state;
        if (probe.state !== PROCESS_SUPERVISOR_STATES.ENFORCED) {
          serviceState = 'blocked';
          return false;
        }
        return true;
      } catch (error) {
        preflightDataGraph(error);
        processState = 'rejected';
        serviceState = 'blocked';
        return false;
      }
    });
    return processProbePromise;
  }

  function recordHasAuthority(record) {
    return Boolean(record.workspaceLease || record.rootLease);
  }

  async function releaseAuthorities(record) {
    let workspaceRolledBack = !record.workspaceLease;
    let rootReleased = !record.rootLease;
    if (record.workspaceLease) {
      const workspaceOutcome = await invokeCaptured(
        dependencies.workspaceRollback,
        [Object.freeze({
          binding: record.input.binding,
          leaseId: record.workspaceLease.leaseId,
        })]
      );
      workspaceRolledBack = successfulWorkspaceRollback(workspaceOutcome);
      if (workspaceRolledBack) record.workspaceLease = null;
    }
    if (record.rootLease) {
      const rootOutcome = await invokeCaptured(
        dependencies.rootRelease,
        [Object.freeze({
          binding: record.input.binding,
          leaseId: record.rootLease.leaseId,
        })]
      );
      rootReleased = successfulRootRelease(rootOutcome);
      if (rootReleased) record.rootLease = null;
    }
    return Object.freeze({
      workspaceRolledBack,
      rootReleased,
      clean: workspaceRolledBack && rootReleased,
    });
  }

  async function releaseProcessGateway(record) {
    if (!record.processGatewayDispose) return true;
    const outcome = await invokeCaptured(record.processGatewayDispose);
    return successfulProcessGatewayDispose(outcome);
  }

  function processGatewayIsIdle(record) {
    const captured = record.processGatewayMethods
      && record.processGatewayMethods.diagnostics;
    if (!captured) return null;
    let value;
    try {
      value = Reflect.apply(captured.method, captured.receiver, []);
    } catch (error) {
      preflightDataGraph(error);
      return null;
    }
    const fields = exactOwnDataFields(value, [
      'version',
      'state',
      'disposed',
      'active',
      'starting',
      'running',
      'terminal',
      'quarantined',
    ]);
    if (!fields || !Object.isFrozen(value)
      || fields.get('version') !== EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_VERSION
      || typeof fields.get('state') !== 'string'
      || typeof fields.get('disposed') !== 'boolean'
      || !['active', 'starting', 'running', 'terminal', 'quarantined']
        .every((key) => Number.isSafeInteger(fields.get(key))
          && fields.get(key) >= 0
          && !Object.is(fields.get(key), -0))) return null;
    return fields.get('active') === 0;
  }

  function invokeProcessGateway(record, name, input) {
    if (record.closeRequested || ['closing', 'closed'].includes(record.state)) {
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_CLOSED
      ));
    }
    if (record.state !== 'active') {
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_UNHEALTHY
      ));
    }
    const captured = record.processGatewayMethods
      && record.processGatewayMethods[name];
    if (!captured) {
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.PROCESS_GATEWAY_FAILED
      ));
    }
    let raw;
    try {
      raw = Reflect.apply(captured.method, captured.receiver, [input]);
    } catch (error) {
      preflightDataGraph(error);
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.PROCESS_GATEWAY_FAILED
      ));
    }
    if (!util.types.isPromise(raw)) {
      preflightDataGraph(raw);
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.PROCESS_GATEWAY_FAILED
      ));
    }
    return raw;
  }

  function sessionDiagnostics(record) {
    let processes = null;
    const captured = record.processGatewayMethods
      && record.processGatewayMethods.diagnostics;
    if (captured) {
      try {
        processes = Reflect.apply(captured.method, captured.receiver, []);
      } catch (error) {
        preflightDataGraph(error);
        processes = null;
      }
    }
    return Object.freeze({
      version: EXECUTION_ISOLATION_JOB_SESSION_VERSION,
      jobId: record.input.binding.jobId,
      projectId: record.input.binding.projectId,
      state: record.state,
      processIsolationState: processState,
      rootAuthorityHeld: Boolean(record.rootLease),
      workspaceAuthorityHeld: Boolean(record.workspaceLease),
      processes,
    });
  }

  function closeRecord(record) {
    if (record.closeReceipt) return Promise.resolve(record.closeReceipt);
    if (record.closePromise) return record.closePromise;
    record.closeRequested = true;
    record.closePromise = Promise.resolve().then(async () => {
      if (record.refreshPromise) {
        await settledOutcome(record.refreshPromise);
      }
      if (record.openPromise && record.state === 'opening') {
        await settledOutcome(record.openPromise);
      }
      if (record.state === 'closed') return record.closeReceipt;
      record.state = 'closing';
      const processesStopped = await releaseProcessGateway(record);
      const cleanup = processesStopped
        ? await releaseAuthorities(record)
        : Object.freeze({
          workspaceRolledBack: false,
          rootReleased: false,
          clean: false,
        });
      const receipt = Object.freeze({
        version: EXECUTION_ISOLATION_JOB_SESSION_CLOSE_RECEIPT_VERSION,
        ok: processesStopped && cleanup.clean,
        closed: processesStopped && cleanup.clean,
        processesStopped,
        workspaceRolledBack: cleanup.workspaceRolledBack,
        rootReleased: cleanup.rootReleased,
      });
      if (processesStopped && cleanup.clean) {
        record.state = 'closed';
        if (record.wasActive) closedCount += 1;
        record.closeReceipt = receipt;
      } else {
        record.state = 'quarantined';
        serviceState = 'degraded';
      }
      record.closePromise = null;
      return receipt;
    });
    return record.closePromise;
  }

  function createSessionFacade(record) {
    return Object.freeze({
      version: EXECUTION_ISOLATION_JOB_SESSION_VERSION,
      jobId: record.input.binding.jobId,
      projectId: record.input.binding.projectId,
      exec(input) {
        return invokeProcessGateway(record, 'exec', input);
      },
      read(input) {
        return invokeProcessGateway(record, 'read', input);
      },
      wait(input) {
        return invokeProcessGateway(record, 'wait', input);
      },
      stop(input) {
        return invokeProcessGateway(record, 'stop', input);
      },
      diagnostics() {
        return sessionDiagnostics(record);
      },
      close() {
        return closeRecord(record);
      },
    });
  }

  function failOpen(record, code, {
    retain = record.refreshAttempt === true,
  } = {}) {
    record.state = retain ? 'quarantined' : 'released';
    if (retain) {
      serviceState = 'degraded';
    } else if (!record.closeRequested
      && records.get(record.input.binding.jobId) === record) {
      records.delete(record.input.binding.jobId);
    }
    return denied(code);
  }

  function interruptionReason(record) {
    if (disposeRequested) {
      return EXECUTION_ISOLATION_JOB_SESSION_REASONS.DISPOSED;
    }
    if (record.closeRequested) {
      return EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_CLOSED;
    }
    return null;
  }

  async function beginOpen(record) {
    const processEnforced = await ensureProcessProbe();
    if (!processEnforced) {
      return failOpen(
        record,
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.PROCESS_UNAVAILABLE
      );
    }
    const beforeRootInterruption = interruptionReason(record);
    if (beforeRootInterruption) {
      return failOpen(record, beforeRootInterruption);
    }

    const rootOutcome = await invokeCaptured(dependencies.rootAcquire, [
      Object.freeze({
        binding: record.input.binding,
        expectedPhysicalRootIdentityDigest: record.input.sourceRootIdentityDigest,
        purpose: 'execution',
      }),
    ]);
    const rootLease = normalizeRootLease(
      normalizeSuccessfulAcquire(rootOutcome),
      record.input
    );
    if (!rootLease) {
      return failOpen(
        record,
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.ROOT_ACQUIRE_FAILED
      );
    }
    record.rootLease = rootLease;
    const beforeWorkspaceInterruption = interruptionReason(record);
    if (beforeWorkspaceInterruption) {
      const cleanup = await releaseAuthorities(record);
      return failOpen(
        record,
        beforeWorkspaceInterruption,
        { retain: record.refreshAttempt === true || !cleanup.clean }
      );
    }

    const workspaceOutcome = await invokeCaptured(dependencies.workspaceAcquire, [
      Object.freeze({
        binding: record.input.binding,
        sourceRootIdentityDigest: record.input.sourceRootIdentityDigest,
      }),
    ]);
    const workspaceLease = normalizeWorkspaceLease(
      normalizeSuccessfulAcquire(workspaceOutcome),
      record.input
    );
    if (!workspaceLease) {
      const cleanup = await releaseAuthorities(record);
      return failOpen(
        record,
        cleanup.clean
          ? EXECUTION_ISOLATION_JOB_SESSION_REASONS.WORKSPACE_ACQUIRE_FAILED
          : EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_UNHEALTHY,
        { retain: record.refreshAttempt === true || !cleanup.clean }
      );
    }
    record.workspaceLease = workspaceLease;
    let processGateway;
    let processGatewayMethods;
    try {
      processGateway = createExecutionIsolationJobProcessGateway({
        binding: record.input.binding,
        workspaceLease,
        processSupervisor: dependencies.processSupervisor,
        mutationRevision: record.input.mutationRevision,
      });
      processGatewayMethods = Object.freeze(Object.fromEntries(
        ['exec', 'read', 'wait', 'stop', 'diagnostics', 'dispose'].map((name) => {
          const captured = captureOwnMethod(processGateway, name);
          if (!captured) {
            throw new TypeError('Invalid execution isolation process gateway');
          }
          return [name, captured];
        })
      ));
    } catch (error) {
      preflightDataGraph(error);
      const cleanup = await releaseAuthorities(record);
      return failOpen(
        record,
        cleanup.clean
          ? EXECUTION_ISOLATION_JOB_SESSION_REASONS.PROCESS_GATEWAY_FAILED
          : EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_UNHEALTHY,
        { retain: record.refreshAttempt === true || !cleanup.clean }
      );
    }
    record.processGateway = processGateway;
    record.processGatewayMethods = processGatewayMethods;
    record.processGatewayDispose = processGatewayMethods.dispose;
    if (!record.session) record.session = createSessionFacade(record);
    record.wasActive = true;
    record.state = 'active';
    record.refreshAttempt = false;
    const activeInterruption = interruptionReason(record);
    if (activeInterruption) {
      return denied(activeInterruption);
    }
    return Object.freeze({
      ok: true,
      session: record.session,
      idempotent: false,
    });
  }

  function beginRefresh(record, normalized) {
    const idle = processGatewayIsIdle(record);
    if (idle === false) {
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.PROCESS_ACTIVE
      ));
    }
    if (idle !== true) {
      record.state = 'quarantined';
      serviceState = 'degraded';
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_UNHEALTHY
      ));
    }

    record.state = 'refreshing';
    record.refreshInput = normalized;
    record.refreshAttempt = true;
    const operation = Promise.resolve().then(async () => {
      const gatewayReleased = await releaseProcessGateway(record);
      if (!gatewayReleased) {
        record.state = 'quarantined';
        serviceState = 'degraded';
        return denied(EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_UNHEALTHY);
      }
      record.processGateway = null;
      record.processGatewayMethods = null;
      record.processGatewayDispose = null;

      const cleanup = await releaseAuthorities(record);
      if (!cleanup.clean) {
        record.state = 'quarantined';
        serviceState = 'degraded';
        return denied(EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_UNHEALTHY);
      }

      record.input = normalized;
      record.state = 'opening';
      return beginOpen(record);
    }).then((outcome) => outcome, (error) => {
      preflightDataGraph(error);
      record.state = 'quarantined';
      serviceState = 'degraded';
      return denied(EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_UNHEALTHY);
    });
    record.refreshPromise = operation.then((outcome) => {
      record.refreshPromise = null;
      record.refreshInput = null;
      return outcome;
    });
    return record.refreshPromise;
  }

  function activeReservationCount() {
    let count = 0;
    for (const record of records.values()) {
      if (['opening', 'refreshing', 'active', 'closing', 'quarantined']
        .includes(record.state)) {
        count += 1;
      }
    }
    return count;
  }

  function openNormalized(normalized) {
    if (disposeRequested || disposeReceipt) {
      return Promise.resolve(denied(EXECUTION_ISOLATION_JOB_SESSION_REASONS.DISPOSED));
    }
    const existing = records.get(normalized.binding.jobId);
    if (existing) {
      if (!inputsMatch(existing.input, normalized)) {
        return Promise.resolve(denied(
          EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_MISMATCH
        ));
      }
      if (existing.refreshPromise) {
        const targetRevision = existing.refreshInput
          ? existing.refreshInput.mutationRevision
          : existing.input.mutationRevision;
        if (normalized.mutationRevision === targetRevision) {
          return existing.refreshPromise;
        }
        if (normalized.mutationRevision < targetRevision) {
          return Promise.resolve(denied(
            EXECUTION_ISOLATION_JOB_SESSION_REASONS.MUTATION_REVISION_MISMATCH
          ));
        }
        return existing.refreshPromise.then((outcome) => (
          outcome && outcome.ok === true ? openNormalized(normalized) : outcome
        ));
      }
      if (existing.state === 'opening') {
        if (normalized.mutationRevision === existing.input.mutationRevision) {
          return existing.openPromise;
        }
        if (normalized.mutationRevision < existing.input.mutationRevision) {
          return Promise.resolve(denied(
            EXECUTION_ISOLATION_JOB_SESSION_REASONS.MUTATION_REVISION_MISMATCH
          ));
        }
        return existing.openPromise.then((outcome) => (
          outcome && outcome.ok === true ? openNormalized(normalized) : outcome
        ));
      }
      if (existing.state === 'active') {
        if (normalized.mutationRevision > existing.input.mutationRevision) {
          return beginRefresh(existing, normalized);
        }
        if (normalized.mutationRevision < existing.input.mutationRevision) {
          return Promise.resolve(denied(
            EXECUTION_ISOLATION_JOB_SESSION_REASONS.MUTATION_REVISION_MISMATCH
          ));
        }
        return Promise.resolve(Object.freeze({
          ok: true,
          session: existing.session,
          idempotent: true,
        }));
      }
      if (existing.state === 'closed') {
        return Promise.resolve(denied(
          EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_CLOSED
        ));
      }
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_UNHEALTHY
      ));
    }
    if (activeReservationCount() >= dependencies.maxActiveSessions) {
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.CAPACITY_EXCEEDED
      ));
    }
    const record = {
      input: normalized,
      state: 'opening',
      openPromise: null,
      closePromise: null,
      closeReceipt: null,
      closeRequested: false,
      rootLease: null,
      workspaceLease: null,
      processGateway: null,
      processGatewayMethods: null,
      processGatewayDispose: null,
      session: null,
      wasActive: false,
      refreshAttempt: false,
      refreshInput: null,
      refreshPromise: null,
    };
    records.set(normalized.binding.jobId, record);
    record.openPromise = Promise.resolve().then(() => beginOpen(record));
    return record.openPromise;
  }

  function open(input) {
    const normalized = normalizeOpenInput(input);
    if (!normalized) {
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.INVALID_INPUT
      ));
    }
    return openNormalized(normalized);
  }

  function close(input) {
    const normalized = normalizeCloseInput(input);
    if (!normalized) {
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.INVALID_INPUT
      ));
    }
    const record = records.get(normalized.binding.jobId);
    if (!record) {
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_NOT_FOUND
      ));
    }
    if (!bindingsMatch(record.input.binding, normalized.binding)) {
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_MISMATCH
      ));
    }
    return closeRecord(record);
  }

  function diagnostics() {
    const counts = {
      opening: 0,
      refreshing: 0,
      active: 0,
      closing: 0,
      quarantined: 0,
    };
    for (const record of records.values()) {
      if (Object.hasOwn(counts, record.state)) counts[record.state] += 1;
    }
    return Object.freeze({
      version: EXECUTION_ISOLATION_JOB_SESSION_SERVICE_VERSION,
      state: serviceState,
      processIsolationState: processState,
      disposed: Boolean(disposeReceipt),
      opening: counts.opening,
      active: counts.opening + counts.refreshing + counts.active + counts.closing,
      closed: closedCount,
      quarantined: counts.quarantined,
      maxActiveSessions: dependencies.maxActiveSessions,
    });
  }

  function dispose() {
    if (disposeReceipt) return Promise.resolve(disposeReceipt);
    if (disposePromise) return disposePromise;
    disposeRequested = true;
    serviceState = 'disposing';
    disposePromise = Promise.resolve().then(async () => {
      const closeResults = await Promise.all(
        [...records.values()]
          .filter((record) => record.state !== 'closed')
          .map((record) => closeRecord(record))
      );
      const after = diagnostics();
      const clean = closeResults.every((receipt) => receipt && receipt.ok === true)
        && after.active === 0
        && after.quarantined === 0
        && ![...records.values()].some(recordHasAuthority);
      disposeReceipt = Object.freeze({
        version: EXECUTION_ISOLATION_JOB_SESSION_DISPOSE_RECEIPT_VERSION,
        ok: clean,
        disposed: true,
        active: after.active,
        closed: closedCount,
        quarantined: after.quarantined,
      });
      serviceState = clean ? 'disposed' : 'degraded';
      disposePromise = null;
      return disposeReceipt;
    });
    return disposePromise;
  }

  return Object.freeze({
    version: EXECUTION_ISOLATION_JOB_SESSION_SERVICE_VERSION,
    open,
    close,
    diagnostics,
    dispose,
  });
}

module.exports = {
  EXECUTION_ISOLATION_JOB_SESSION_CLOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_JOB_SESSION_DISPOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_JOB_SESSION_REASONS,
  EXECUTION_ISOLATION_JOB_SESSION_SERVICE_VERSION,
  EXECUTION_ISOLATION_JOB_SESSION_VERSION,
  createExecutionIsolationJobSessionService,
};
