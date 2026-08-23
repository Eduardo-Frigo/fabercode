'use strict';

const util = require('util');

const {
  createProcessSupervisor,
} = require('../agent_runtime/execution/process_supervisor');
const {
  assertExecutionWorkspaceBackend,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  createExecutionWorkspaceRegistry,
} = require('../capabilities/execution_workspace_registry');
const {
  assertProjectRootAuthorityBackend,
} = require('../capabilities/project_root_authority_contract');
const {
  createProjectRootAuthorityRegistry,
} = require('../capabilities/project_root_authority_registry');
const {
  assertProcessSupervisorBackend,
} = require('../capabilities/process_supervisor_contract');
const {
  EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION,
} = require('./execution_isolation_provider_factory');
const {
  EXECUTION_ISOLATION_JOB_SESSION_DISPOSE_RECEIPT_VERSION,
  createExecutionIsolationJobSessionService,
} = require('./execution_isolation_job_session_service');

const EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION =
  'execution-isolation-runtime-services.v3';
const EXECUTION_ISOLATION_RUNTIME_SERVICES_DISPOSE_RECEIPT_VERSION =
  'execution-isolation-runtime-services-dispose-receipt.v3';

const SELECTION_KEYS = Object.freeze([
  'version',
  'executionWorkspaceBackend',
  'projectRootAuthorityBackend',
  'processSupervisorBackend',
  'diagnostics',
  'dispose',
]);
const SELECTION_DIAGNOSTIC_KEYS = Object.freeze([
  'status',
  'reasonCode',
  'mode',
  'killSwitch',
]);
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

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

function normalizeSelection(value) {
  const fields = exactOwnDataFields(value, SELECTION_KEYS);
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION) {
    throw new TypeError('Invalid execution isolation runtime services selection');
  }
  const diagnosticValue = fields.get('diagnostics');
  const diagnosticFields = exactOwnDataFields(
    diagnosticValue,
    SELECTION_DIAGNOSTIC_KEYS
  );
  const status = diagnosticFields && diagnosticFields.get('status');
  const reasonCode = diagnosticFields && diagnosticFields.get('reasonCode');
  const mode = diagnosticFields && diagnosticFields.get('mode');
  const killSwitch = diagnosticFields && diagnosticFields.get('killSwitch');
  if (!diagnosticFields || !Object.isFrozen(diagnosticValue)
    || !['enforced', 'unsupported'].includes(status)
    || typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode)
    || !['disabled', 'enabled'].includes(mode)
    || typeof killSwitch !== 'boolean') {
    throw new TypeError('Invalid execution isolation runtime services selection');
  }

  const executionWorkspaceBackend = fields.get('executionWorkspaceBackend');
  const projectRootAuthorityBackend = fields.get('projectRootAuthorityBackend');
  const processSupervisorBackend = fields.get('processSupervisorBackend');
  assertExecutionWorkspaceBackend(executionWorkspaceBackend);
  assertProjectRootAuthorityBackend(projectRootAuthorityBackend);
  assertProcessSupervisorBackend(processSupervisorBackend);
  const dispose = captureOwnMethod(value, 'dispose');
  if (!dispose) {
    throw new TypeError('Invalid execution isolation runtime services selection');
  }
  return Object.freeze({
    status,
    reasonCode,
    executionWorkspaceBackend,
    projectRootAuthorityBackend,
    processSupervisorBackend,
    dispose,
  });
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

function invokeCaptured(captured) {
  let raw;
  try {
    raw = Reflect.apply(captured.method, captured.receiver, []);
  } catch (error) {
    preflightDataGraph(error);
    return Promise.resolve(Object.freeze({ ok: false, value: null }));
  }
  return settledOutcome(raw);
}

function cleanProcessSupervisorReceipt(outcome) {
  if (!outcome.ok) return false;
  const fields = exactOwnDataFields(
    outcome.value,
    ['ok', 'disposed', 'quarantined', 'orphaned']
  );
  return Boolean(fields
    && fields.get('ok') === true
    && fields.get('disposed') === true
    && fields.get('quarantined') === 0
    && fields.get('orphaned') === 0);
}

function cleanRegistryReceipt(outcome) {
  if (!outcome.ok) return false;
  const fields = exactOwnDataFields(
    outcome.value,
    ['ok', 'disposed', 'quarantined']
  );
  return Boolean(fields
    && fields.get('ok') === true
    && fields.get('disposed') === true
    && fields.get('quarantined') === 0);
}

function cleanSelectionReceipt(outcome) {
  if (!outcome.ok) return false;
  const fields = exactOwnDataFields(outcome.value, ['ok', 'disposed']);
  return Boolean(fields
    && fields.get('ok') === true
    && fields.get('disposed') === true);
}

function cleanJobSessionsReceipt(outcome) {
  if (!outcome.ok) return false;
  const fields = exactOwnDataFields(outcome.value, [
    'version',
    'ok',
    'disposed',
    'active',
    'closed',
    'quarantined',
  ]);
  return Boolean(fields
    && fields.get('version') === EXECUTION_ISOLATION_JOB_SESSION_DISPOSE_RECEIPT_VERSION
    && fields.get('ok') === true
    && fields.get('disposed') === true
    && fields.get('active') === 0
    && Number.isSafeInteger(fields.get('closed'))
    && fields.get('closed') >= 0
    && fields.get('quarantined') === 0);
}

function createExecutionIsolationRuntimeServices(options = {}) {
  const optionFields = exactOwnDataFields(options, ['selection'], ['selection']);
  if (!optionFields) {
    throw new TypeError(
      'Invalid execution isolation runtime services options: selection is required'
    );
  }
  const selection = normalizeSelection(optionFields.get('selection'));

  let executionWorkspaceRegistry;
  let projectRootAuthorityRegistry;
  let processSupervisor;
  let jobSessionService;
  try {
    executionWorkspaceRegistry = createExecutionWorkspaceRegistry({
      backend: selection.executionWorkspaceBackend,
    });
    projectRootAuthorityRegistry = createProjectRootAuthorityRegistry({
      backend: selection.projectRootAuthorityBackend,
    });
    processSupervisor = createProcessSupervisor({
      backend: selection.processSupervisorBackend,
    });
    jobSessionService = createExecutionIsolationJobSessionService({
      executionWorkspaceRegistry,
      projectRootAuthorityRegistry,
      processSupervisor,
    });
  } catch (error) {
    preflightDataGraph(error);
    invokeCaptured(selection.dispose);
    throw new TypeError('Execution isolation runtime services composition failed');
  }

  const disposeProcessSupervisor = captureOwnMethod(processSupervisor, 'dispose');
  const disposeJobSessions = captureOwnMethod(jobSessionService, 'dispose');
  const disposeExecutionWorkspace = captureOwnMethod(
    executionWorkspaceRegistry,
    'dispose'
  );
  const disposeProjectRootAuthority = captureOwnMethod(
    projectRootAuthorityRegistry,
    'dispose'
  );
  if (!disposeJobSessions || !disposeProcessSupervisor || !disposeExecutionWorkspace
    || !disposeProjectRootAuthority) {
    invokeCaptured(selection.dispose);
    throw new TypeError('Execution isolation runtime services composition failed');
  }

  let state = selection.status === 'enforced' ? 'ready' : 'blocked';
  let disposePromise = null;
  let disposeReceipt = null;

  function diagnostics() {
    return Object.freeze({
      version: EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION,
      state,
      selectionStatus: selection.status,
      selectionReasonCode: selection.reasonCode,
      executionWorkspace: executionWorkspaceRegistry.diagnostics(),
      projectRootAuthority: projectRootAuthorityRegistry.diagnostics(),
      processSupervisor: processSupervisor.diagnostics(),
      jobSessions: jobSessionService.diagnostics(),
    });
  }

  function dispose() {
    if (disposeReceipt) return Promise.resolve(disposeReceipt);
    if (disposePromise) return disposePromise;
    state = 'disposing';
    disposePromise = Promise.resolve().then(async () => {
      const jobSessionsOutcome = await invokeCaptured(disposeJobSessions);
      const processOutcome = await invokeCaptured(disposeProcessSupervisor);
      const workspaceOutcome = await invokeCaptured(disposeExecutionWorkspace);
      const rootOutcome = await invokeCaptured(disposeProjectRootAuthority);
      const selectionOutcome = await invokeCaptured(selection.dispose);
      const jobSessionsDisposed = cleanJobSessionsReceipt(jobSessionsOutcome);
      const processSupervisorDisposed = cleanProcessSupervisorReceipt(processOutcome);
      const executionWorkspaceDisposed = cleanRegistryReceipt(workspaceOutcome);
      const projectRootAuthorityDisposed = cleanRegistryReceipt(rootOutcome);
      const selectionDisposed = cleanSelectionReceipt(selectionOutcome);
      disposeReceipt = Object.freeze({
        version: EXECUTION_ISOLATION_RUNTIME_SERVICES_DISPOSE_RECEIPT_VERSION,
        disposed: true,
        zeroOrphanShutdownConfirmed: jobSessionsDisposed
          && processSupervisorDisposed
          && executionWorkspaceDisposed
          && projectRootAuthorityDisposed
          && selectionDisposed,
        jobSessionsDisposed,
        processSupervisorDisposed,
        executionWorkspaceDisposed,
        projectRootAuthorityDisposed,
        selectionDisposed,
      });
      state = 'disposed';
      disposePromise = null;
      return disposeReceipt;
    });
    return disposePromise;
  }

  return Object.freeze({
    version: EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION,
    executionWorkspaceRegistry,
    projectRootAuthorityRegistry,
    processSupervisor,
    jobSessionService,
    diagnostics,
    dispose,
  });
}

module.exports = {
  EXECUTION_ISOLATION_RUNTIME_SERVICES_DISPOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_RUNTIME_SERVICES_VERSION,
  createExecutionIsolationRuntimeServices,
};
