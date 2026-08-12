'use strict';

const path = require('path');

const SANDBOX_BACKEND_SCHEMA_VERSION = 'sandbox-backend.v1';
const SANDBOX_BACKEND_SECURITY_MODEL = 'physical-root-revalidation.v1';
const SANDBOX_PROBE_RESULT_SCHEMA_VERSION = 'sandbox-backend.probe-result.v1';
const SANDBOX_EXECUTION_REQUEST_SCHEMA_VERSION = 'sandbox-execution.request.v1';

const SANDBOX_BACKEND_STATES = Object.freeze({
  DEGRADED: 'degraded',
  ENFORCED: 'enforced',
  UNAVAILABLE: 'unavailable',
});

const SANDBOX_FEATURES = Object.freeze({
  FILESYSTEM_SCOPE: 'filesystem_scope',
  NETWORK_ISOLATION: 'network_isolation',
  PROCESS_EXECUTE: 'process_execute',
  PROCESS_TREE_TERMINATION: 'process_tree_termination',
});

const SANDBOX_A1_REQUIRED_FEATURES = Object.freeze([
  SANDBOX_FEATURES.FILESYSTEM_SCOPE,
  SANDBOX_FEATURES.NETWORK_ISOLATION,
  SANDBOX_FEATURES.PROCESS_EXECUTE,
  SANDBOX_FEATURES.PROCESS_TREE_TERMINATION,
]);

const SANDBOX_NETWORK_MODES = Object.freeze({
  APPROVED: 'broker_approved',
  DISABLED: 'disabled',
});

const SANDBOX_COMMAND_KINDS = Object.freeze({
  EXECUTABLE: 'executable',
  SHELL: 'shell',
});

const SUPPORTED_STATES = new Set(Object.values(SANDBOX_BACKEND_STATES));
const SUPPORTED_FEATURES = new Set(Object.values(SANDBOX_FEATURES));
const SUPPORTED_NETWORK_MODES = new Set(Object.values(SANDBOX_NETWORK_MODES));
const SUPPORTED_COMMAND_KINDS = new Set(Object.values(SANDBOX_COMMAND_KINDS));

class SandboxUnavailableError extends Error {
  constructor(message = 'No enforced sandbox backend is available.') {
    super(message);
    this.name = 'SandboxUnavailableError';
    this.code = 'SANDBOX_UNAVAILABLE';
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim()) && !value.includes('\0');
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === value.length
    && keys.every((key, index) => key === String(index));
}

function uniqueFeatures(features) {
  if (!isDenseArray(features)) throw new TypeError('Sandbox features must be a dense array');
  const normalized = [];
  for (const feature of features) {
    if (!SUPPORTED_FEATURES.has(feature)) {
      throw new TypeError(`Unsupported sandbox feature: ${String(feature)}`);
    }
    if (!normalized.includes(feature)) normalized.push(feature);
  }
  return Object.freeze(normalized);
}

function isSandboxProbeResult(result) {
  if (!isRecord(result)) return false;
  if (result.schemaVersion !== SANDBOX_PROBE_RESULT_SCHEMA_VERSION) return false;
  if (!SUPPORTED_STATES.has(result.state)) return false;
  if (!isDenseArray(result.features)
    || result.features.some((feature) => !SUPPORTED_FEATURES.has(feature))) {
    return false;
  }
  if (result.reason !== null && !isNonEmptyString(result.reason)) return false;
  if (result.state === SANDBOX_BACKEND_STATES.UNAVAILABLE && !isNonEmptyString(result.reason)) {
    return false;
  }
  return true;
}

function assertSandboxProbeResult(result) {
  if (!isSandboxProbeResult(result)) {
    throw new TypeError('Invalid sandbox probe result');
  }
  return result;
}

function createSandboxProbeResult({ state, features = [], reason = null } = {}) {
  const result = {
    schemaVersion: SANDBOX_PROBE_RESULT_SCHEMA_VERSION,
    state,
    features: uniqueFeatures(features),
    reason: reason === null ? null : String(reason || '').trim(),
  };
  assertSandboxProbeResult(result);
  return Object.freeze(result);
}

function isValidWindowsPathComponent(component) {
  if (!component || component === '.' || component === '..') return false;
  if (/[<>:"|?*\u0000-\u001F]/.test(component) || /[ .]$/.test(component)) return false;
  const basename = component.split('.')[0];
  return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(basename);
}

function hasValidWindowsTail(tail, { allowEmpty = true } = {}) {
  if (!tail) return allowEmpty;
  const components = tail.split(/[\\/]/);
  if (components[components.length - 1] === '') components.pop();
  return components.length > 0 && components.every(isValidWindowsPathComponent);
}

function isStrictWindowsDrivePath(value) {
  const match = /^([A-Za-z]:)[\\/](.*)$/.exec(value);
  return Boolean(match) && hasValidWindowsTail(match[2]);
}

function isStrictWindowsUncPath(value) {
  const match = /^\\\\([^\\/]+)[\\/]([^\\/]+)(?:[\\/](.*))?$/.exec(value);
  return Boolean(match)
    && isValidWindowsPathComponent(match[1])
    && isValidWindowsPathComponent(match[2])
    && hasValidWindowsTail(match[3] || '');
}

function describePortableAbsolutePath(value) {
  if (!isNonEmptyString(value)) return null;
  if (/^[\\/]{2}[?.][\\/]/.test(value) || value.startsWith('//')) return null;
  if (isStrictWindowsDrivePath(value)) {
    return { flavor: path.win32, type: 'win_drive' };
  }
  if (isStrictWindowsUncPath(value)) {
    return { flavor: path.win32, type: 'win_unc' };
  }
  if (path.posix.isAbsolute(value)) {
    return { flavor: path.posix, type: 'posix' };
  }
  return null;
}

function isPortableAbsolutePath(value) {
  return Boolean(describePortableAbsolutePath(value));
}

function getPathFlavor(value) {
  const descriptor = describePortableAbsolutePath(value);
  return descriptor ? descriptor.flavor : null;
}

function isPathInsideProjectRoot(projectRoot, candidatePath) {
  if (!isPortableAbsolutePath(projectRoot) || !isPortableAbsolutePath(candidatePath)) return false;
  const flavor = getPathFlavor(projectRoot);
  if (flavor !== getPathFlavor(candidatePath)) return false;
  const root = flavor.resolve(projectRoot);
  const candidate = flavor.resolve(candidatePath);
  const relative = flavor.relative(root, candidate);
  return relative === ''
    || (relative !== '..'
      && !relative.startsWith(`..${flavor.sep}`)
      && !flavor.isAbsolute(relative));
}

function areEquivalentPortablePaths(leftPath, rightPath) {
  if (!isPortableAbsolutePath(leftPath) || !isPortableAbsolutePath(rightPath)) return false;
  const flavor = getPathFlavor(leftPath);
  if (flavor !== getPathFlavor(rightPath)) return false;
  return flavor.relative(flavor.resolve(leftPath), flavor.resolve(rightPath)) === '';
}

function isSandboxCommand(command) {
  if (!isRecord(command) || !SUPPORTED_COMMAND_KINDS.has(command.kind)) return false;
  if (command.kind === SANDBOX_COMMAND_KINDS.EXECUTABLE) {
    return hasOnlyKeys(command, ['kind', 'executable', 'args'])
      && isNonEmptyString(command.executable)
      && isDenseArray(command.args)
      && command.args.every((arg) => typeof arg === 'string' && !arg.includes('\0'));
  }
  return hasOnlyKeys(command, ['kind', 'text', 'shellPath'])
    && isNonEmptyString(command.text)
    && (command.shellPath === undefined || isNonEmptyString(command.shellPath));
}

function isSandboxExecutionRequest(request) {
  if (!isRecord(request)) return false;
  if (!hasOnlyKeys(request, [
    'schemaVersion',
    'executionId',
    'requestId',
    'grantId',
    'rootPath',
    'realRootPath',
    'cwd',
    'cwdRealPath',
    'command',
    'env',
    'requiredFeatures',
    'networkMode',
    'tempRoots',
    'cacheRoots',
    'timeoutMs',
  ])) return false;
  if (request.schemaVersion !== SANDBOX_EXECUTION_REQUEST_SCHEMA_VERSION) return false;
  if (!isNonEmptyString(request.executionId)) return false;
  if (!isNonEmptyString(request.requestId) || !isNonEmptyString(request.grantId)) return false;
  if (!isPortableAbsolutePath(request.rootPath) || !isPortableAbsolutePath(request.realRootPath)) return false;
  if (!isPortableAbsolutePath(request.cwd) || !isPortableAbsolutePath(request.cwdRealPath)) return false;
  if (!isPathInsideProjectRoot(request.rootPath, request.cwd)) return false;
  if (!isPathInsideProjectRoot(request.realRootPath, request.cwdRealPath)) return false;
  if (!isSandboxCommand(request.command)) return false;
  if (!isRecord(request.env)) return false;
  if (Object.entries(request.env).some(([key, value]) => (
    !isNonEmptyString(key) || key.includes('=') || typeof value !== 'string' || value.includes('\0')
  ))) return false;
  if (!isDenseArray(request.requiredFeatures)
    || request.requiredFeatures.some((feature) => !SUPPORTED_FEATURES.has(feature))
    || !SANDBOX_A1_REQUIRED_FEATURES.every(
      (feature) => request.requiredFeatures.includes(feature)
    )) return false;
  for (const roots of [request.tempRoots, request.cacheRoots]) {
    if (!isDenseArray(roots) || roots.some((root) => !isPortableAbsolutePath(root))) return false;
  }
  if (!SUPPORTED_NETWORK_MODES.has(request.networkMode)) return false;
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) return false;
  return true;
}

function assertSandboxExecutionRequest(request) {
  if (!isSandboxExecutionRequest(request)) {
    throw new TypeError('Invalid sandbox execution request');
  }
  return request;
}

function createSandboxExecutionRequest({
  executionId,
  requestId,
  grantId,
  rootPath,
  realRootPath,
  cwd = rootPath,
  cwdRealPath = realRootPath,
  command,
  env = {},
  requiredFeatures = SANDBOX_A1_REQUIRED_FEATURES,
  networkMode = SANDBOX_NETWORK_MODES.DISABLED,
  tempRoots = [],
  cacheRoots = [],
  timeoutMs = 120000,
} = {}) {
  if (!isSandboxCommand(command)) {
    throw new TypeError('Invalid sandbox execution request command');
  }
  const canonicalCommand = isRecord(command)
    ? Object.freeze({
      kind: command.kind,
      ...(command.kind === SANDBOX_COMMAND_KINDS.EXECUTABLE
        ? {
          executable: typeof command.executable === 'string'
            ? command.executable.trim()
            : command.executable,
          args: Object.freeze(Array.isArray(command.args) ? [...command.args] : command.args),
        }
        : {
          text: typeof command.text === 'string' ? command.text.trim() : command.text,
          ...(command.shellPath === undefined ? {} : { shellPath: command.shellPath }),
        }),
    })
    : command;
  const request = {
    schemaVersion: SANDBOX_EXECUTION_REQUEST_SCHEMA_VERSION,
    executionId: typeof executionId === 'string' ? executionId.trim() : executionId,
    requestId: typeof requestId === 'string' ? requestId.trim() : requestId,
    grantId: typeof grantId === 'string' ? grantId.trim() : grantId,
    rootPath,
    realRootPath,
    cwd,
    cwdRealPath,
    command: canonicalCommand,
    env: Object.freeze(isRecord(env) ? { ...env } : env),
    requiredFeatures: uniqueFeatures([
      ...SANDBOX_A1_REQUIRED_FEATURES,
      ...requiredFeatures,
    ]),
    networkMode,
    tempRoots: Object.freeze(Array.isArray(tempRoots) ? [...new Set(tempRoots)] : tempRoots),
    cacheRoots: Object.freeze(Array.isArray(cacheRoots) ? [...new Set(cacheRoots)] : cacheRoots),
    timeoutMs,
  };
  assertSandboxExecutionRequest(request);
  return Object.freeze(request);
}

/**
 * `execute` owns the final trust check: immediately before spawning, a backend
 * must resolve logical `cwd` physically and verify that it equals
 * `cwdRealPath` and is still contained by `realRootPath`. Logical `cwd` is
 * contained by `rootPath`, so projects opened through symlinks remain valid.
 * The portable contract never performs I/O.
 */
function isSandboxBackend(backend) {
  return isRecord(backend)
    && backend.schemaVersion === SANDBOX_BACKEND_SCHEMA_VERSION
    && backend.securityModel === SANDBOX_BACKEND_SECURITY_MODEL
    && isNonEmptyString(backend.id)
    && typeof backend.probe === 'function'
    && typeof backend.execute === 'function'
    && typeof backend.terminate === 'function';
}

function assertSandboxBackend(backend) {
  if (!isSandboxBackend(backend)) {
    throw new TypeError('Invalid sandbox backend');
  }
  return backend;
}

function createUnsupportedSandboxBackend({
  id = 'unsupported',
  reason = 'No enforced sandbox backend is available.',
} = {}) {
  const normalizedReason = String(reason || '').trim();
  if (!isNonEmptyString(id) || !normalizedReason) {
    throw new TypeError('Invalid unsupported sandbox backend configuration');
  }

  const backend = {
    schemaVersion: SANDBOX_BACKEND_SCHEMA_VERSION,
    securityModel: SANDBOX_BACKEND_SECURITY_MODEL,
    id: String(id).trim(),
    async probe() {
      return createSandboxProbeResult({
        state: SANDBOX_BACKEND_STATES.UNAVAILABLE,
        features: [],
        reason: normalizedReason,
      });
    },
    async execute() {
      throw new SandboxUnavailableError(normalizedReason);
    },
    async terminate() {
      return Object.freeze({
        ok: false,
        code: 'SANDBOX_UNAVAILABLE',
        message: normalizedReason,
      });
    },
  };
  return Object.freeze(backend);
}

module.exports = {
  SANDBOX_BACKEND_SCHEMA_VERSION,
  SANDBOX_BACKEND_SECURITY_MODEL,
  SANDBOX_BACKEND_STATES,
  SANDBOX_A1_REQUIRED_FEATURES,
  SANDBOX_COMMAND_KINDS,
  SANDBOX_EXECUTION_REQUEST_SCHEMA_VERSION,
  SANDBOX_FEATURES,
  SANDBOX_NETWORK_MODES,
  SANDBOX_PROBE_RESULT_SCHEMA_VERSION,
  SandboxUnavailableError,
  assertSandboxBackend,
  assertSandboxExecutionRequest,
  assertSandboxProbeResult,
  areEquivalentPortablePaths,
  createSandboxExecutionRequest,
  createSandboxProbeResult,
  createUnsupportedSandboxBackend,
  isPathInsideProjectRoot,
  isPortableAbsolutePath,
  isSandboxBackend,
  isSandboxCommand,
  isSandboxExecutionRequest,
  isSandboxProbeResult,
};
