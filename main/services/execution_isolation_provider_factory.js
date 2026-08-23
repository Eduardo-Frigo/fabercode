'use strict';

const util = require('util');

const {
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  EXECUTION_WORKSPACE_STATES,
  absorbNativePromise,
  assertExecutionWorkspaceBackend,
  assertExecutionWorkspaceProbeResult,
  createUnsupportedExecutionWorkspaceBackend,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_STATES,
  assertProjectRootAuthorityBackend,
  assertProjectRootAuthorityProbeResult,
  createUnsupportedProjectRootAuthorityBackend,
} = require('../capabilities/project_root_authority_contract');
const {
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_STATES,
  assertProcessSupervisorBackend,
  assertProcessSupervisorDisposeReceipt,
  assertProcessSupervisorProbeResult,
  createUnsupportedProcessSupervisorBackend,
} = require('../capabilities/process_supervisor_contract');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');
const {
  EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
  createExecutionIsolationRuntimeConfig,
} = require('../runtime/execution_isolation_runtime_config');

const EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION =
  'execution-isolation-provider-factory.v2';
const PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION =
  'portable-execution-isolation-provider.v2';
const PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION =
  'portable-execution-isolation-attestation.v2';

const WORKSPACE_UNAVAILABLE_ID = 'faber-portable-execution-workspace-unavailable';
const ROOT_UNAVAILABLE_ID = 'faber-portable-project-root-unavailable';
const PROCESS_UNAVAILABLE_ID = 'faber-portable-process-supervisor-unavailable';
const PORTABLE_PROVIDER_UNAVAILABLE = 'PORTABLE_ISOLATION_PROVIDER_UNAVAILABLE';
const SAFE_BUILD_ID = /^[A-Za-z0-9._:@-]{1,128}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const DISPOSED_RECEIPT = Object.freeze({ ok: true, disposed: true });
const FAILED_DISPOSED_RECEIPT = Object.freeze({ ok: false, disposed: true });
const DEFAULT_CONFIG = createExecutionIsolationRuntimeConfig({ env: {} });

function exactDataFields(
  value,
  allowedKeys,
  requiredKeys = allowedKeys,
  { allowUndefined = [] } = {}
) {
  const preflight = preflightDataGraph(value);
  if (preflight.hasNativePromise || !preflight.bounded || !preflight.inspectable
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
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      preflightDataGraph(error);
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
      || (descriptor.value === undefined && !allowUndefined.includes(key))) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function normalizeConfig(value) {
  const fields = exactDataFields(value, ['version', 'mode', 'killSwitch']);
  if (!fields
    || fields.get('version') !== EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION
    || !['disabled', 'enabled'].includes(fields.get('mode'))
    || typeof fields.get('killSwitch') !== 'boolean') return null;
  return Object.freeze({
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode: fields.get('mode'),
    killSwitch: fields.get('killSwitch'),
  });
}

function captureOwnMethod(receiver, name) {
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(receiver, name); } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function' || util.types.isProxy(descriptor.value)) return null;
  return Object.freeze({ receiver, method: descriptor.value });
}

function providerDisposer(value) {
  if (util.types.isProxy(value)) return () => undefined;
  const captured = value ? captureOwnMethod(value, 'dispose') : null;
  let receiver = captured ? captured.receiver : null;
  let method = captured ? captured.method : null;
  let disposed = false;

  return function disposeProvider() {
    if (disposed) return DISPOSED_RECEIPT;
    disposed = true;
    const currentReceiver = receiver;
    const currentMethod = method;
    receiver = null;
    method = null;
    if (currentMethod) {
      try {
        preflightDataGraph(Reflect.apply(currentMethod, currentReceiver, []));
      } catch (error) {
        preflightDataGraph(error);
      }
    }
    return DISPOSED_RECEIPT;
  };
}

function disposeResolvedProviderPromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [
      (provider) => providerDisposer(provider)(),
      () => undefined,
    ]);
  } catch {
    // Poisoned native Promise species metadata is denied without consulting
    // a userland `.then` fallback.
  }
  return true;
}

function normalizeAttestation(
  value,
  providerVersion,
  buildId,
  workspaceBackend,
  rootBackend,
  processBackend
) {
  const fields = exactDataFields(value, [
    'schemaVersion',
    'workspaceBackendVersion',
    'projectRootAuthorityBackendVersion',
    'processSupervisorBackendVersion',
    'workspaceBackendId',
    'projectRootAuthorityBackendId',
    'processSupervisorBackendId',
    'sharedPhysicalRootAuthority',
    'sourceIdentityCompareAndSwap',
    'handleRelativeProjectAccess',
    'privateWorkspaceMaterialization',
    'rollbackByDiscard',
    'workspaceBoundProcessExecution',
    'networkDefaultDeny',
    'processTreeTermination',
    'zeroOrphanProcessDisposal',
    'attestationDigest',
  ]);
  if (!fields || !Object.isFrozen(value)
    || fields.get('schemaVersion') !== PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION
    || fields.get('workspaceBackendVersion') !== EXECUTION_WORKSPACE_BACKEND_VERSION
    || fields.get('projectRootAuthorityBackendVersion') !== PROJECT_ROOT_AUTHORITY_BACKEND_VERSION
    || fields.get('processSupervisorBackendVersion') !== PROCESS_SUPERVISOR_BACKEND_VERSION
    || fields.get('workspaceBackendId') !== workspaceBackend.id
    || fields.get('projectRootAuthorityBackendId') !== rootBackend.id
    || fields.get('processSupervisorBackendId') !== processBackend.id
    || fields.get('sharedPhysicalRootAuthority') !== true
    || fields.get('sourceIdentityCompareAndSwap') !== true
    || fields.get('handleRelativeProjectAccess') !== true
    || fields.get('privateWorkspaceMaterialization') !== true
    || fields.get('rollbackByDiscard') !== true
    || fields.get('workspaceBoundProcessExecution') !== true
    || fields.get('networkDefaultDeny') !== true
    || fields.get('processTreeTermination') !== true
    || fields.get('zeroOrphanProcessDisposal') !== true
    || typeof fields.get('attestationDigest') !== 'string'
    || !DIGEST.test(fields.get('attestationDigest'))) return null;

  const core = {
    providerVersion,
    buildId,
    schemaVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
    workspaceBackendVersion: EXECUTION_WORKSPACE_BACKEND_VERSION,
    projectRootAuthorityBackendVersion: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    processSupervisorBackendVersion: PROCESS_SUPERVISOR_BACKEND_VERSION,
    workspaceBackendId: workspaceBackend.id,
    projectRootAuthorityBackendId: rootBackend.id,
    processSupervisorBackendId: processBackend.id,
    sharedPhysicalRootAuthority: true,
    sourceIdentityCompareAndSwap: true,
    handleRelativeProjectAccess: true,
    privateWorkspaceMaterialization: true,
    rollbackByDiscard: true,
    workspaceBoundProcessExecution: true,
    networkDefaultDeny: true,
    processTreeTermination: true,
    zeroOrphanProcessDisposal: true,
  };
  return fields.get('attestationDigest') === canonicalSha256Digest(core) ? value : null;
}

function normalizeProvider(value) {
  const fields = exactDataFields(value, [
    'providerVersion',
    'buildId',
    'executionWorkspaceBackend',
    'projectRootAuthorityBackend',
    'processSupervisorBackend',
    'isolationAttestation',
    'dispose',
  ]);
  if (!fields || !Object.isFrozen(value)
    || fields.get('providerVersion') !== PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION
    || typeof fields.get('buildId') !== 'string'
    || !SAFE_BUILD_ID.test(fields.get('buildId'))
    || typeof fields.get('dispose') !== 'function') return null;

  const workspaceBackend = fields.get('executionWorkspaceBackend');
  const rootBackend = fields.get('projectRootAuthorityBackend');
  const processBackend = fields.get('processSupervisorBackend');
  try {
    if (!Object.isFrozen(workspaceBackend) || !Object.isFrozen(rootBackend)
      || !Object.isFrozen(processBackend)) return null;
    assertExecutionWorkspaceBackend(workspaceBackend);
    assertProjectRootAuthorityBackend(rootBackend);
    assertProcessSupervisorBackend(processBackend);
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  const isolationAttestation = normalizeAttestation(
    fields.get('isolationAttestation'),
    fields.get('providerVersion'),
    fields.get('buildId'),
    workspaceBackend,
    rootBackend,
    processBackend
  );
  if (!isolationAttestation) return null;
  return Object.freeze({ workspaceBackend, rootBackend, processBackend });
}

function probeEnforcedBackend(backend, kind) {
  const captured = captureOwnMethod(backend, 'probe');
  if (!captured) throw new TypeError(`${kind} probe unavailable`);
  let rawProbe;
  try {
    rawProbe = Reflect.apply(captured.method, captured.receiver, []);
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError(`${kind} probe failed`);
  }
  if (absorbNativePromise(rawProbe)) throw new TypeError(`${kind} async probe denied`);
  let probe;
  let enforcedState;
  if (kind === 'workspace') {
    probe = assertExecutionWorkspaceProbeResult(rawProbe);
    enforcedState = EXECUTION_WORKSPACE_STATES.ENFORCED;
  } else if (kind === 'root') {
    probe = assertProjectRootAuthorityProbeResult(rawProbe);
    enforcedState = PROJECT_ROOT_AUTHORITY_STATES.ENFORCED;
  } else if (kind === 'process') {
    probe = assertProcessSupervisorProbeResult(rawProbe);
    enforcedState = PROCESS_SUPERVISOR_STATES.ENFORCED;
  } else {
    throw new TypeError('Unknown portable isolation backend kind');
  }
  if (probe.state !== enforcedState) throw new TypeError(`${kind} backend is not enforced`);
  return probe;
}

function diagnostics(status, reasonCode, config) {
  return Object.freeze({
    status,
    reasonCode,
    mode: config.mode,
    killSwitch: config.killSwitch,
  });
}

function unsupportedBackends() {
  return Object.freeze({
    executionWorkspaceBackend: createUnsupportedExecutionWorkspaceBackend({
      id: WORKSPACE_UNAVAILABLE_ID,
      reasonCode: PORTABLE_PROVIDER_UNAVAILABLE,
    }),
    projectRootAuthorityBackend: createUnsupportedProjectRootAuthorityBackend({
      id: ROOT_UNAVAILABLE_ID,
      reasonCode: PORTABLE_PROVIDER_UNAVAILABLE,
    }),
    processSupervisorBackend: createUnsupportedProcessSupervisorBackend({
      id: PROCESS_UNAVAILABLE_ID,
      reasonCode: PORTABLE_PROVIDER_UNAVAILABLE,
    }),
  });
}

function unsupportedSelection(reasonCode, config, disposeProvider = () => DISPOSED_RECEIPT) {
  const unavailable = unsupportedBackends();
  let disposed = false;
  return Object.freeze({
    version: EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION,
    executionWorkspaceBackend: unavailable.executionWorkspaceBackend,
    projectRootAuthorityBackend: unavailable.projectRootAuthorityBackend,
    processSupervisorBackend: unavailable.processSupervisorBackend,
    diagnostics: diagnostics('unsupported', reasonCode, config),
    dispose(input) {
      preflightDataGraph(input);
      if (!disposed) {
        disposed = true;
        disposeProvider();
      }
      return DISPOSED_RECEIPT;
    },
  });
}

function createRevocableBackends({
  workspaceBackend,
  rootBackend,
  processBackend,
  workspaceProbe,
  rootProbe,
  processProbe,
  disposeProvider,
}) {
  const unavailable = unsupportedBackends();
  const workspaceAcquire = captureOwnMethod(workspaceBackend, 'acquire');
  const workspaceDiscard = captureOwnMethod(workspaceBackend, 'discard');
  const rootAcquire = captureOwnMethod(rootBackend, 'acquire');
  const processExec = captureOwnMethod(processBackend, 'exec');
  const processRead = captureOwnMethod(processBackend, 'read');
  const processWait = captureOwnMethod(processBackend, 'wait');
  const processStop = captureOwnMethod(processBackend, 'stop');
  const processDispose = captureOwnMethod(processBackend, 'dispose');
  if (!workspaceAcquire || !workspaceDiscard || !rootAcquire
    || !processExec || !processRead || !processWait || !processStop || !processDispose) {
    throw new TypeError('Provider backend methods became unavailable');
  }

  let workspaceActive = true;
  let rootActive = true;
  let processActive = true;
  let processDisposePending = false;
  let processDisposeSettled = false;
  let processDisposeReentered = false;
  let processDisposeResult = null;
  let processDisposePromise = null;
  let processDisposeError = null;
  let forceDisposePending = false;
  let forceDisposeReentered = false;
  let forceDisposeResult = null;
  let forceDisposePromise = null;

  function maybeDisposeProvider() {
    if (!workspaceActive && !rootActive && !processActive && !processDisposePending) {
      disposeProvider();
    }
  }

  function release(kind) {
    if (kind === 'workspace') workspaceActive = false;
    if (kind === 'root') rootActive = false;
    maybeDisposeProvider();
    return DISPOSED_RECEIPT;
  }

  function completeProcessDispose(value) {
    if (processDisposeReentered) {
      return failProcessDispose(new TypeError('Process supervisor disposal reentered'));
    }
    processDisposePending = false;
    processDisposeSettled = true;
    processDisposeResult = value;
    maybeDisposeProvider();
    return value;
  }

  function failProcessDispose(providerError) {
    preflightDataGraph(providerError);
    processDisposePending = false;
    processDisposeError = new TypeError('Process supervisor backend disposal failed');
    maybeDisposeProvider();
    throw processDisposeError;
  }

  function disposeProcess(input) {
    preflightDataGraph(input);
    if (processDisposePromise) return processDisposePromise;
    if (processDisposeSettled) return processDisposeResult;
    if (processDisposeError) throw processDisposeError;
    if (processDisposePending) {
      processDisposeReentered = true;
      throw new TypeError('Process supervisor backend disposal is reentrant');
    }
    processActive = false;
    processDisposePending = true;

    let rawResult;
    try {
      rawResult = Reflect.apply(processDispose.method, processDispose.receiver, []);
    } catch (providerError) {
      return failProcessDispose(providerError);
    }
    if (!util.types.isPromise(rawResult)) return completeProcessDispose(rawResult);

    processDisposePromise = new Promise((resolve, reject) => {
      const onFulfilled = (value) => {
        try { resolve(completeProcessDispose(value)); } catch (providerError) {
          preflightDataGraph(providerError);
          reject(processDisposeError);
        }
      };
      const onRejected = (providerError) => {
        try { failProcessDispose(providerError); } catch (safeError) { reject(safeError); }
      };
      try {
        Reflect.apply(Promise.prototype.then, rawResult, [onFulfilled, onRejected]);
      } catch (providerError) {
        onRejected(providerError);
      }
    });
    return processDisposePromise;
  }

  function finishForceDispose(value) {
    let valid = !forceDisposeReentered;
    try { assertProcessSupervisorDisposeReceipt(value); } catch (providerError) {
      preflightDataGraph(providerError);
      valid = false;
    }
    maybeDisposeProvider();
    forceDisposeResult = valid ? DISPOSED_RECEIPT : FAILED_DISPOSED_RECEIPT;
    forceDisposePending = false;
    forceDisposePromise = null;
    return forceDisposeResult;
  }

  function forceDispose(input) {
    preflightDataGraph(input);
    if (forceDisposeResult) return forceDisposeResult;
    if (forceDisposePromise) return forceDisposePromise;
    if (forceDisposePending) {
      forceDisposeReentered = true;
      throw new TypeError('Portable isolation selection disposal is reentrant');
    }
    forceDisposePending = true;
    workspaceActive = false;
    rootActive = false;

    let processResult;
    try { processResult = disposeProcess(); } catch (providerError) {
      preflightDataGraph(providerError);
      maybeDisposeProvider();
      forceDisposeResult = FAILED_DISPOSED_RECEIPT;
      forceDisposePending = false;
      return forceDisposeResult;
    }
    if (!util.types.isPromise(processResult)) return finishForceDispose(processResult);

    forceDisposePromise = new Promise((resolve) => {
      const onFulfilled = (value) => resolve(finishForceDispose(value));
      const onRejected = (providerError) => {
        preflightDataGraph(providerError);
        maybeDisposeProvider();
        forceDisposeResult = FAILED_DISPOSED_RECEIPT;
        forceDisposePending = false;
        forceDisposePromise = null;
        resolve(forceDisposeResult);
      };
      try {
        Reflect.apply(Promise.prototype.then, processResult, [onFulfilled, onRejected]);
      } catch (providerError) {
        onRejected(providerError);
      }
    });
    return forceDisposePromise;
  }

  const executionWorkspaceBackend = Object.freeze({
    version: EXECUTION_WORKSPACE_BACKEND_VERSION,
    id: workspaceBackend.id,
    probe(input) {
      preflightDataGraph(input);
      return workspaceActive ? workspaceProbe : unavailable.executionWorkspaceBackend.probe(input);
    },
    acquire(input) {
      if (!workspaceActive) return unavailable.executionWorkspaceBackend.acquire(input);
      return Reflect.apply(workspaceAcquire.method, workspaceAcquire.receiver, [input]);
    },
    discard(input) {
      if (!workspaceActive) return unavailable.executionWorkspaceBackend.discard(input);
      return Reflect.apply(workspaceDiscard.method, workspaceDiscard.receiver, [input]);
    },
    dispose(input) {
      preflightDataGraph(input);
      return release('workspace');
    },
  });

  const projectRootAuthorityBackend = Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    id: rootBackend.id,
    probe(input) {
      preflightDataGraph(input);
      return rootActive ? rootProbe : unavailable.projectRootAuthorityBackend.probe(input);
    },
    acquire(input) {
      if (!rootActive) return unavailable.projectRootAuthorityBackend.acquire(input);
      let result;
      try {
        result = Reflect.apply(rootAcquire.method, rootAcquire.receiver, [input]);
      } catch (error) {
        preflightDataGraph(error);
        throw error;
      }
      if (absorbNativePromise(result)) {
        throw new TypeError('project-root authority acquire must remain synchronous');
      }
      return result;
    },
    dispose(input) {
      preflightDataGraph(input);
      return release('root');
    },
  });

  const processSupervisorBackend = Object.freeze({
    version: PROCESS_SUPERVISOR_BACKEND_VERSION,
    id: processBackend.id,
    probe(input) {
      preflightDataGraph(input);
      return processActive ? processProbe : unavailable.processSupervisorBackend.probe(input);
    },
    exec(input) {
      if (!processActive) return unavailable.processSupervisorBackend.exec(input);
      return Reflect.apply(processExec.method, processExec.receiver, [input]);
    },
    read(input) {
      if (!processActive) return unavailable.processSupervisorBackend.read(input);
      return Reflect.apply(processRead.method, processRead.receiver, [input]);
    },
    wait(input) {
      if (!processActive) return unavailable.processSupervisorBackend.wait(input);
      return Reflect.apply(processWait.method, processWait.receiver, [input]);
    },
    stop(input) {
      if (!processActive) return unavailable.processSupervisorBackend.stop(input);
      return Reflect.apply(processStop.method, processStop.receiver, [input]);
    },
    dispose(input) {
      return disposeProcess(input);
    },
  });

  assertExecutionWorkspaceBackend(executionWorkspaceBackend);
  assertProjectRootAuthorityBackend(projectRootAuthorityBackend);
  assertProcessSupervisorBackend(processSupervisorBackend);
  return Object.freeze({
    executionWorkspaceBackend,
    projectRootAuthorityBackend,
    processSupervisorBackend,
    dispose: forceDispose,
  });
}

function createExecutionIsolationProviderSelection(options = {}) {
  const optionFields = exactDataFields(
    options,
    ['config', 'providerFactory'],
    [],
    { allowUndefined: ['providerFactory'] }
  );
  if (!optionFields) return unsupportedSelection('FACTORY_OPTIONS_INVALID', DEFAULT_CONFIG);

  const config = optionFields.has('config')
    ? normalizeConfig(optionFields.get('config'))
    : DEFAULT_CONFIG;
  if (!config) return unsupportedSelection('FACTORY_OPTIONS_INVALID', DEFAULT_CONFIG);
  if (config.mode !== 'enabled') return unsupportedSelection('RUNTIME_DISABLED', config);
  if (config.killSwitch) {
    return unsupportedSelection('RUNTIME_KILL_SWITCH_ACTIVE', config);
  }

  const providerFactory = optionFields.get('providerFactory');
  if (typeof providerFactory !== 'function') {
    return unsupportedSelection('PROVIDER_UNAVAILABLE', config);
  }

  let provider;
  try {
    provider = Reflect.apply(providerFactory, undefined, []);
  } catch (error) {
    if (!disposeResolvedProviderPromise(error)) preflightDataGraph(error);
    return unsupportedSelection('PROVIDER_REJECTED', config);
  }
  if (disposeResolvedProviderPromise(provider)) {
    return unsupportedSelection('PROVIDER_REJECTED', config);
  }

  const disposeProvider = providerDisposer(provider);
  const normalized = normalizeProvider(provider);
  if (!normalized) {
    disposeProvider();
    return unsupportedSelection('PROVIDER_REJECTED', config, disposeProvider);
  }

  let workspaceProbe;
  let rootProbe;
  let processProbe;
  try {
    workspaceProbe = probeEnforcedBackend(normalized.workspaceBackend, 'workspace');
    rootProbe = probeEnforcedBackend(normalized.rootBackend, 'root');
    processProbe = probeEnforcedBackend(normalized.processBackend, 'process');
  } catch (error) {
    preflightDataGraph(error);
    disposeProvider();
    return unsupportedSelection('BACKENDS_NOT_ENFORCED', config, disposeProvider);
  }

  let revocable;
  try {
    revocable = createRevocableBackends({
      workspaceBackend: normalized.workspaceBackend,
      rootBackend: normalized.rootBackend,
      processBackend: normalized.processBackend,
      workspaceProbe,
      rootProbe,
      processProbe,
      disposeProvider,
    });
  } catch (error) {
    preflightDataGraph(error);
    disposeProvider();
    return unsupportedSelection('PROVIDER_REJECTED', config, disposeProvider);
  }

  return Object.freeze({
    version: EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION,
    executionWorkspaceBackend: revocable.executionWorkspaceBackend,
    projectRootAuthorityBackend: revocable.projectRootAuthorityBackend,
    processSupervisorBackend: revocable.processSupervisorBackend,
    diagnostics: diagnostics('enforced', 'ENFORCED', config),
    dispose: revocable.dispose,
  });
}

module.exports = {
  EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION,
  PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
  createExecutionIsolationProviderSelection,
};
