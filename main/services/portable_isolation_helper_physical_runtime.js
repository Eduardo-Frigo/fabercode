'use strict';

const util = require('util');

const {
  assertPortableIsolationHelperShutdownReceipt,
} = require('../capabilities/portable_isolation_helper_protocol');
const {
  PORTABLE_ISOLATION_HELPER_BUILD_ID,
  PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
} = require('../capabilities/portable_isolation_helper_distribution_attestation_contract');
const {
  createPortableIsolationHelperBackendDispatcher,
} = require('./portable_isolation_helper_backend_dispatcher');
const {
  PORTABLE_EXECUTION_WORKSPACE_BACKEND_ID,
  createPortableExecutionWorkspaceBackend,
} = require('./portable_isolation_helper_execution_workspace_backend');
const {
  PORTABLE_PROCESS_SUPERVISOR_BACKEND_ID,
  createPortableProcessSupervisorBackend,
} = require('./portable_isolation_helper_process_supervisor_backend');
const {
  PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_ID,
  createPortableProjectRootAuthorityBackend,
} = require('./portable_isolation_helper_project_root_authority_backend');
const {
  createPortableIsolationHelperRuntimeSession,
} = require('./portable_isolation_helper_runtime_session');

const PORTABLE_ISOLATION_HELPER_PHYSICAL_RUNTIME_VERSION =
  'portable-isolation-helper-physical-runtime.v1';
const PORTABLE_ISOLATION_HELPER_PHYSICAL_RUNTIME_ACTIVATION_VERSION =
  'portable-isolation-helper-physical-runtime-activation.v1';
const OPTION_KEYS = Object.freeze(['runtimeBinding']);
const BINDING_KEYS = Object.freeze([
  'helperId',
  'helperBuildId',
  'bundleIdentityDigest',
  'platform',
]);
const PLATFORM_KEYS = Object.freeze([
  'os',
  'architecture',
  'signatureVerification',
]);
const REASON_KEYS = Object.freeze(['reasonCode']);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);

class PortableIsolationHelperPhysicalRuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperPhysicalRuntimeError';
    this.code = code;
  }
}

function physicalRuntimeError(code) {
  return new PortableIsolationHelperPhysicalRuntimeError(code);
}

function fail(code) {
  throw physicalRuntimeError(code);
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // Never consult a userland thenable fallback.
  }
  return true;
}

function exactOwnDataFields(value, allowedKeys, requiredKeys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) fail(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    fail(code);
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) fail(code);
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      fail(code);
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      fail(code);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function normalizePlatform(value) {
  const fields = exactOwnDataFields(
    value,
    PLATFORM_KEYS,
    PLATFORM_KEYS,
    'PHYSICAL_RUNTIME_BINDING_INVALID'
  );
  if (fields.get('os') !== process.platform
    || fields.get('architecture') !== process.arch
    || !SUPPORTED_ARCHITECTURES.has(fields.get('architecture'))
    || fields.get('signatureVerification') !== 'platform_verified') {
    fail('PHYSICAL_RUNTIME_BINDING_INVALID');
  }
  return Object.freeze({
    os: fields.get('os'),
    architecture: fields.get('architecture'),
    signatureVerification: 'platform_verified',
  });
}

function normalizeRuntimeBinding(value) {
  const fields = exactOwnDataFields(
    value,
    BINDING_KEYS,
    BINDING_KEYS,
    'PHYSICAL_RUNTIME_BINDING_INVALID'
  );
  if (fields.get('helperId') !== PORTABLE_ISOLATION_HELPER_BUNDLE_ID
    || fields.get('helperBuildId') !== PORTABLE_ISOLATION_HELPER_BUILD_ID
    || typeof fields.get('bundleIdentityDigest') !== 'string'
    || !DIGEST.test(fields.get('bundleIdentityDigest'))) {
    fail('PHYSICAL_RUNTIME_BINDING_INVALID');
  }
  return Object.freeze({
    helperId: PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
    helperBuildId: PORTABLE_ISOLATION_HELPER_BUILD_ID,
    bundleIdentityDigest: fields.get('bundleIdentityDigest'),
    platform: normalizePlatform(fields.get('platform')),
  });
}

function normalizeOptions(value) {
  const fields = exactOwnDataFields(
    value,
    OPTION_KEYS,
    OPTION_KEYS,
    'PHYSICAL_RUNTIME_OPTIONS_INVALID'
  );
  return Object.freeze({
    runtimeBinding: normalizeRuntimeBinding(fields.get('runtimeBinding')),
  });
}

function normalizeReason(value, { applicationShutdownOnly = false } = {}) {
  const fields = exactOwnDataFields(
    value,
    REASON_KEYS,
    REASON_KEYS,
    'PHYSICAL_RUNTIME_DISPOSE_INVALID'
  );
  const reasonCode = fields.get('reasonCode');
  if (typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode)
    || (applicationShutdownOnly && reasonCode !== 'APPLICATION_SHUTDOWN')) {
    fail('PHYSICAL_RUNTIME_DISPOSE_INVALID');
  }
  return reasonCode;
}

function settledOutcome(value) {
  if (!util.types.isPromise(value)) {
    return Promise.resolve(Object.freeze({ ok: true, value }));
  }
  return new Promise((resolve) => {
    const fulfilled = (resolvedValue) => resolve(Object.freeze({
      ok: true,
      value: resolvedValue,
    }));
    const rejected = (error) => {
      absorbNativePromise(error);
      resolve(Object.freeze({ ok: false, value: null }));
    };
    try {
      Reflect.apply(Promise.prototype.then, value, [fulfilled, rejected]);
    } catch (error) {
      absorbNativePromise(error);
      resolve(Object.freeze({ ok: false, value: null }));
    }
  });
}

function createPortableIsolationHelperPhysicalRuntime(options = {}) {
  const normalized = normalizeOptions(options);
  let executionWorkspaceBackend;
  let projectRootAuthorityBackend;
  let processSupervisorBackend;
  let dispatcher;
  try {
    executionWorkspaceBackend = createPortableExecutionWorkspaceBackend();
    projectRootAuthorityBackend = createPortableProjectRootAuthorityBackend();
    processSupervisorBackend = createPortableProcessSupervisorBackend();
    dispatcher = createPortableIsolationHelperBackendDispatcher({
      executionWorkspaceBackend,
      projectRootAuthorityBackend,
      processSupervisorBackend,
    });
  } catch (error) {
    absorbNativePromise(error);
    fail('PHYSICAL_RUNTIME_UNAVAILABLE');
  }

  let state = 'idle';
  let activationPromise = null;
  let activationReceipt = null;
  let session = null;
  let disposalPromise = null;
  let disposalReceipt = null;

  function closeDispatcher() {
    if (disposalReceipt) return Promise.resolve(disposalReceipt);
    return settledOutcome(dispatcher.dispose(Object.freeze({
      reasonCode: 'APPLICATION_SHUTDOWN',
    }))).then((outcome) => {
      if (!outcome.ok) fail('PHYSICAL_RUNTIME_DISPOSE_FAILED');
      let receipt;
      try {
        receipt = assertPortableIsolationHelperShutdownReceipt(outcome.value);
      } catch (error) {
        absorbNativePromise(error);
        fail('PHYSICAL_RUNTIME_DISPOSE_FAILED');
      }
      if (receipt.activeWorkspaces !== 0 || receipt.activeRootLeases !== 0
        || receipt.activeProcesses !== 0 || receipt.orphaned !== 0) {
        fail('PHYSICAL_RUNTIME_DISPOSE_FAILED');
      }
      disposalReceipt = receipt;
      state = 'closed';
      return receipt;
    });
  }

  function activate() {
    if (activationReceipt) return Promise.resolve(activationReceipt);
    if (activationPromise) return activationPromise;
    if (state !== 'idle') {
      return Promise.reject(physicalRuntimeError('PHYSICAL_RUNTIME_UNAVAILABLE'));
    }
    state = 'activating';
    activationPromise = settledOutcome(dispatcher.activate()).then((outcome) => {
      if (!outcome.ok) throw physicalRuntimeError('PHYSICAL_RUNTIME_UNAVAILABLE');
      const receipt = outcome.value;
      if (!receipt || receipt.active !== true
        || receipt.executionWorkspaceBackendId
          !== PORTABLE_EXECUTION_WORKSPACE_BACKEND_ID
        || receipt.projectRootAuthorityBackendId
          !== PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_ID
        || receipt.processSupervisorBackendId
          !== PORTABLE_PROCESS_SUPERVISOR_BACKEND_ID) {
        throw physicalRuntimeError('PHYSICAL_RUNTIME_UNAVAILABLE');
      }
      try {
        session = createPortableIsolationHelperRuntimeSession({
          identity: Object.freeze({
            ...normalized.runtimeBinding,
            executionWorkspaceBackendId:
              PORTABLE_EXECUTION_WORKSPACE_BACKEND_ID,
            projectRootAuthorityBackendId:
              PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_ID,
            processSupervisorBackendId:
              PORTABLE_PROCESS_SUPERVISOR_BACKEND_ID,
          }),
          dispatch: dispatcher.dispatch,
          dispose: dispatcher.dispose,
        });
      } catch (error) {
        absorbNativePromise(error);
        throw physicalRuntimeError('PHYSICAL_RUNTIME_UNAVAILABLE');
      }
      activationReceipt = Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_PHYSICAL_RUNTIME_ACTIVATION_VERSION,
        active: true,
        executionWorkspaceBackendId: PORTABLE_EXECUTION_WORKSPACE_BACKEND_ID,
        projectRootAuthorityBackendId: PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_ID,
        processSupervisorBackendId: PORTABLE_PROCESS_SUPERVISOR_BACKEND_ID,
      });
      state = 'active';
      return activationReceipt;
    }).catch((error) => {
      absorbNativePromise(error);
      state = 'quarantined';
      return closeDispatcher().then(
        () => { throw physicalRuntimeError('PHYSICAL_RUNTIME_UNAVAILABLE'); },
        (disposeError) => {
          absorbNativePromise(disposeError);
          state = 'quarantined';
          throw physicalRuntimeError('PHYSICAL_RUNTIME_UNAVAILABLE');
        }
      );
    });
    return activationPromise;
  }

  function accept(value) {
    const ready = state === 'idle' ? activate() : Promise.resolve(activationReceipt);
    return ready.then(() => {
      if (state !== 'active' || !session) {
        throw physicalRuntimeError('PHYSICAL_RUNTIME_NOT_ACTIVE');
      }
      let raw;
      try {
        raw = session.accept(value);
      } catch (error) {
        absorbNativePromise(error);
        throw error;
      }
      return settledOutcome(raw).then((outcome) => {
        if (!outcome.ok) throw physicalRuntimeError('PHYSICAL_RUNTIME_REQUEST_FAILED');
        const response = outcome.value;
        if (session.diagnostics().state === 'closed') {
          try {
            disposalReceipt = assertPortableIsolationHelperShutdownReceipt(
              response.payload
            );
          } catch (error) {
            absorbNativePromise(error);
            state = 'quarantined';
            throw physicalRuntimeError('PHYSICAL_RUNTIME_REQUEST_FAILED');
          }
          state = 'closed';
        }
        return response;
      });
    });
  }

  function dispose(value) {
    normalizeReason(value, { applicationShutdownOnly: true });
    if (disposalReceipt) return Promise.resolve(disposalReceipt);
    if (disposalPromise) return disposalPromise;
    if (state === 'activating' && activationPromise) {
      disposalPromise = settledOutcome(activationPromise).then(() => {
        disposalPromise = null;
        return dispose(value);
      });
      return disposalPromise;
    }
    if (session && state === 'active') {
      try {
        session.quarantine(Object.freeze({ reasonCode: 'APPLICATION_SHUTDOWN' }));
      } catch (error) {
        absorbNativePromise(error);
      }
      state = 'quarantined';
    }
    disposalPromise = closeDispatcher().catch((error) => {
      absorbNativePromise(error);
      state = 'quarantined';
      throw physicalRuntimeError('PHYSICAL_RUNTIME_DISPOSE_FAILED');
    });
    return disposalPromise;
  }

  function quarantine(value) {
    const reasonCode = normalizeReason(value);
    if (disposalReceipt) return Promise.resolve(disposalReceipt);
    if (session && state === 'active') {
      try {
        session.quarantine(Object.freeze({ reasonCode }));
      } catch (error) {
        absorbNativePromise(error);
      }
    }
    if (state !== 'closed') state = 'quarantined';
    return dispose(Object.freeze({ reasonCode: 'APPLICATION_SHUTDOWN' }));
  }

  function diagnostics() {
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_PHYSICAL_RUNTIME_VERSION,
      state,
      activated: Boolean(activationReceipt),
      dispatcherState: dispatcher.diagnostics().state,
      sessionState: session ? session.diagnostics().state : null,
    });
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PHYSICAL_RUNTIME_VERSION,
    activate,
    accept,
    quarantine,
    dispose,
    diagnostics,
  });
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_PHYSICAL_RUNTIME_ACTIVATION_VERSION,
  PORTABLE_ISOLATION_HELPER_PHYSICAL_RUNTIME_VERSION,
  PortableIsolationHelperPhysicalRuntimeError,
  createPortableIsolationHelperPhysicalRuntime,
};
