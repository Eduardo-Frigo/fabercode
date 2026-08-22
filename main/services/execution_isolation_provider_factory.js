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
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');
const {
  EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
  createExecutionIsolationRuntimeConfig,
} = require('../runtime/execution_isolation_runtime_config');

const EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION =
  'execution-isolation-provider-factory.v1';
const PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION =
  'portable-execution-isolation-provider.v1';
const PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION =
  'portable-execution-isolation-attestation.v1';

const WORKSPACE_UNAVAILABLE_ID = 'faber-portable-execution-workspace-unavailable';
const ROOT_UNAVAILABLE_ID = 'faber-portable-project-root-unavailable';
const PORTABLE_PROVIDER_UNAVAILABLE = 'PORTABLE_ISOLATION_PROVIDER_UNAVAILABLE';
const SAFE_BUILD_ID = /^[A-Za-z0-9._:@-]{1,128}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const DISPOSED_RECEIPT = Object.freeze({ ok: true, disposed: true });
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

function normalizeAttestation(value, providerVersion, buildId, workspaceBackend, rootBackend) {
  const fields = exactDataFields(value, [
    'schemaVersion',
    'workspaceBackendVersion',
    'projectRootAuthorityBackendVersion',
    'workspaceBackendId',
    'projectRootAuthorityBackendId',
    'sharedPhysicalRootAuthority',
    'sourceIdentityCompareAndSwap',
    'handleRelativeProjectAccess',
    'privateWorkspaceMaterialization',
    'rollbackByDiscard',
    'attestationDigest',
  ]);
  if (!fields || !Object.isFrozen(value)
    || fields.get('schemaVersion') !== PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION
    || fields.get('workspaceBackendVersion') !== EXECUTION_WORKSPACE_BACKEND_VERSION
    || fields.get('projectRootAuthorityBackendVersion') !== PROJECT_ROOT_AUTHORITY_BACKEND_VERSION
    || fields.get('workspaceBackendId') !== workspaceBackend.id
    || fields.get('projectRootAuthorityBackendId') !== rootBackend.id
    || fields.get('sharedPhysicalRootAuthority') !== true
    || fields.get('sourceIdentityCompareAndSwap') !== true
    || fields.get('handleRelativeProjectAccess') !== true
    || fields.get('privateWorkspaceMaterialization') !== true
    || fields.get('rollbackByDiscard') !== true
    || typeof fields.get('attestationDigest') !== 'string'
    || !DIGEST.test(fields.get('attestationDigest'))) return null;

  const core = {
    providerVersion,
    buildId,
    schemaVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
    workspaceBackendVersion: EXECUTION_WORKSPACE_BACKEND_VERSION,
    projectRootAuthorityBackendVersion: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    workspaceBackendId: workspaceBackend.id,
    projectRootAuthorityBackendId: rootBackend.id,
    sharedPhysicalRootAuthority: true,
    sourceIdentityCompareAndSwap: true,
    handleRelativeProjectAccess: true,
    privateWorkspaceMaterialization: true,
    rollbackByDiscard: true,
  };
  return fields.get('attestationDigest') === canonicalSha256Digest(core) ? value : null;
}

function normalizeProvider(value) {
  const fields = exactDataFields(value, [
    'providerVersion',
    'buildId',
    'executionWorkspaceBackend',
    'projectRootAuthorityBackend',
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
  try {
    if (!Object.isFrozen(workspaceBackend) || !Object.isFrozen(rootBackend)) return null;
    assertExecutionWorkspaceBackend(workspaceBackend);
    assertProjectRootAuthorityBackend(rootBackend);
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  const isolationAttestation = normalizeAttestation(
    fields.get('isolationAttestation'),
    fields.get('providerVersion'),
    fields.get('buildId'),
    workspaceBackend,
    rootBackend
  );
  if (!isolationAttestation) return null;
  return Object.freeze({ workspaceBackend, rootBackend });
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
  const probe = kind === 'workspace'
    ? assertExecutionWorkspaceProbeResult(rawProbe)
    : assertProjectRootAuthorityProbeResult(rawProbe);
  const enforcedState = kind === 'workspace'
    ? EXECUTION_WORKSPACE_STATES.ENFORCED
    : PROJECT_ROOT_AUTHORITY_STATES.ENFORCED;
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
  });
}

function unsupportedSelection(reasonCode, config, disposeProvider = () => DISPOSED_RECEIPT) {
  const unavailable = unsupportedBackends();
  let disposed = false;
  return Object.freeze({
    version: EXECUTION_ISOLATION_PROVIDER_FACTORY_VERSION,
    executionWorkspaceBackend: unavailable.executionWorkspaceBackend,
    projectRootAuthorityBackend: unavailable.projectRootAuthorityBackend,
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
  workspaceProbe,
  rootProbe,
  disposeProvider,
}) {
  const unavailable = unsupportedBackends();
  const workspaceAcquire = captureOwnMethod(workspaceBackend, 'acquire');
  const workspaceDiscard = captureOwnMethod(workspaceBackend, 'discard');
  const rootAcquire = captureOwnMethod(rootBackend, 'acquire');
  if (!workspaceAcquire || !workspaceDiscard || !rootAcquire) {
    throw new TypeError('Provider backend methods became unavailable');
  }

  let workspaceActive = true;
  let rootActive = true;

  function release(kind) {
    if (kind === 'workspace') workspaceActive = false;
    if (kind === 'root') rootActive = false;
    if (!workspaceActive && !rootActive) disposeProvider();
    return DISPOSED_RECEIPT;
  }

  function forceDispose(input) {
    preflightDataGraph(input);
    workspaceActive = false;
    rootActive = false;
    disposeProvider();
    return DISPOSED_RECEIPT;
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

  assertExecutionWorkspaceBackend(executionWorkspaceBackend);
  assertProjectRootAuthorityBackend(projectRootAuthorityBackend);
  return Object.freeze({
    executionWorkspaceBackend,
    projectRootAuthorityBackend,
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
  try {
    workspaceProbe = probeEnforcedBackend(normalized.workspaceBackend, 'workspace');
    rootProbe = probeEnforcedBackend(normalized.rootBackend, 'root');
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
      workspaceProbe,
      rootProbe,
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
