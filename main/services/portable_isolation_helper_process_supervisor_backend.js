'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { StringDecoder } = require('string_decoder');

const {
  PROJECT_ROOT_ENTRY_KINDS,
  createProjectRootPhysicalIdentityDigest,
} = require('../capabilities/project_root_authority_contract');
const {
  SANDBOX_COMMAND_KINDS,
  SANDBOX_NETWORK_MODES,
} = require('../capabilities/sandbox_backend_contract');
const {
  PROCESS_EXECUTION_STATUSES,
  PROCESS_OUTPUT_STREAMS,
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  PROCESS_SUPERVISOR_STATES,
  assertProcessSupervisorExecRequest,
  createProcessSupervisorDisposeReceipt,
  createProcessSupervisorExecReceipt,
  createProcessSupervisorProbeResult,
  createProcessSupervisorReadResult,
  createProcessSupervisorStopReceipt,
  createProcessSupervisorWaitResult,
  normalizeReadRequest,
  normalizeStopRequest,
  normalizeWaitRequest,
} = require('../capabilities/process_supervisor_contract');

const PORTABLE_PROCESS_SUPERVISOR_BACKEND_VERSION =
  'portable-process-supervisor-backend.v1';
const PORTABLE_PROCESS_SUPERVISOR_BACKEND_ID =
  'portable-physical-process-supervisor';
const DARWIN_SANDBOX_EXECUTABLE = '/usr/bin/sandbox-exec';
const SESSION_DIRECTORY_PREFIX = 'faber-portable-processes-';
const EXECUTION_DIRECTORY_PREFIX = 'process-execution-';
const PROBE_DIRECTORY_PREFIX = 'faber-portable-process-probe-';
const MAX_RETAINED_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_CHUNK_BYTES = 64 * 1024;
const MAX_PRIVATE_TREE_ENTRIES = 200_000;
const MAX_EXECUTION_RECORDS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;
const TERMINATION_GRACE_MS = 500;
const TERMINATION_HARD_MS = 2_000;
const TERMINATION_POLL_MS = 20;
const TERMINAL_STATUSES = new Set([
  PROCESS_EXECUTION_STATUSES.SUCCEEDED,
  PROCESS_EXECUTION_STATUSES.FAILED,
  PROCESS_EXECUTION_STATUSES.STOPPED,
  PROCESS_EXECUTION_STATUSES.TIMED_OUT,
]);
const RESERVED_ENVIRONMENT_KEYS = new Set([
  'BASH_ENV',
  'CDPATH',
  'ENV',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_SYSTEM',
  'HOME',
  'IFS',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PATH',
  'PERL5OPT',
  'PERL5LIB',
  'PYTHONHOME',
  'PYTHONPATH',
  'RUBYOPT',
  'SHELLOPTS',
  'SSH_ASKPASS',
  'TEMP',
  'TMP',
  'TMPDIR',
  'ZDOTDIR',
]);
const SAFE_SYSTEM_EXECUTABLE_ROOTS = Object.freeze([
  '/System',
  '/Library/Apple',
  '/usr',
  '/bin',
  '/sbin',
  '/opt/homebrew',
  '/nix/store',
]);
const SAFE_SHELLS = new Set(['/bin/sh', '/bin/bash', '/bin/zsh']);

const DARWIN_SEATBELT_PROFILE = Object.freeze([
  '(version 1)',
  '(deny default)',
  '(allow process-exec)',
  '(allow process-fork)',
  '(allow signal (target same-sandbox))',
  '(allow process-info* (target same-sandbox))',
  '(allow sysctl-read)',
  '(allow file-read* file-test-existence file-map-executable',
  '  (subpath "/System")',
  '  (subpath "/Library/Apple")',
  '  (subpath "/usr")',
  '  (subpath "/bin")',
  '  (subpath "/sbin")',
  '  (subpath "/dev")',
  '  (subpath "/private/etc")',
  '  (subpath "/private/var/db/timezone")',
  '  (subpath (param "WORKSPACE_ENTRY"))',
  '  (path-ancestors (param "WORKSPACE_ENTRY"))',
  '  (subpath (param "WORKSPACE_ROOT"))',
  '  (path-ancestors (param "WORKSPACE_ROOT"))',
  '  (subpath (param "RUNTIME_ROOT"))',
  '  (path-ancestors (param "RUNTIME_ROOT"))',
  '  (subpath (param "TOOLCHAIN_ROOT"))',
  '  (path-ancestors (param "TOOLCHAIN_ROOT")))',
  '(allow file-read* file-write* file-test-existence',
  '  (subpath (param "WORKSPACE_ENTRY"))',
  '  (subpath (param "WORKSPACE_ROOT"))',
  '  (subpath (param "RUNTIME_ROOT")))',
  '(allow file-read-data file-test-existence file-write-data file-ioctl',
  '  (subpath "/dev/fd"))',
  '(allow file-read* file-write* file-ioctl',
  '  (literal "/dev/null")',
  '  (literal "/dev/zero")',
  '  (literal "/dev/random")',
  '  (literal "/dev/urandom")',
  '  (literal "/dev/tty")',
  '  (literal "/dev/ptmx"))',
].join('\n'));

class PortableProcessSupervisorBackendError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableProcessSupervisorBackendError';
    this.code = code;
  }
}

function fail(code) {
  throw new PortableProcessSupervisorBackendError(code);
}

function rethrow(error, fallbackCode) {
  if (error instanceof PortableProcessSupervisorBackendError) throw error;
  fail(fallbackCode);
}

function normalizeOptions(value) {
  const code = 'PROCESS_SUPERVISOR_BACKEND_OPTIONS_INVALID';
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) fail(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(code);
  }
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== 0) {
    fail(code);
  }
}

function errorCode(error) {
  if (!error || typeof error !== 'object' || util.types.isProxy(error)) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function isMissing(error) {
  return errorCode(error) === 'ENOENT';
}

function lstatBigInt(location) {
  return fs.lstatSync(location, { bigint: true });
}

function statBigInt(location) {
  return fs.statSync(location, { bigint: true });
}

function statKind(stat) {
  try {
    if (stat.isSymbolicLink()) return PROJECT_ROOT_ENTRY_KINDS.SYMLINK;
    if (stat.isDirectory()) return PROJECT_ROOT_ENTRY_KINDS.DIRECTORY;
    if (stat.isFile()) return PROJECT_ROOT_ENTRY_KINDS.FILE;
    return PROJECT_ROOT_ENTRY_KINDS.OTHER;
  } catch {
    return 'unknown';
  }
}

function statSnapshot(stat) {
  try {
    return Object.freeze({
      kind: statKind(stat),
      device: String(stat.dev),
      inode: String(stat.ino),
      mode: String(stat.mode),
      uid: String(stat.uid),
      gid: String(stat.gid),
      size: String(stat.size),
      modifiedNanoseconds: String(stat.mtimeNs),
      changedNanoseconds: String(stat.ctimeNs),
    });
  } catch {
    fail('PROCESS_PHYSICAL_IDENTITY_INVALID');
  }
}

function sameIdentity(left, right) {
  return Boolean(left && right
    && left.kind === right.kind
    && left.device === right.device
    && left.inode === right.inode);
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right)
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.modifiedNanoseconds === right.modifiedNanoseconds
    && left.changedNanoseconds === right.changedNanoseconds;
}

function localPathKey(value) {
  const normalized = path.normalize(path.resolve(value));
  return path.sep === '\\' ? normalized.toLowerCase() : normalized;
}

function sameLocalPath(left, right) {
  return localPathKey(left) === localPathKey(right);
}

function isInsideOrEqual(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  if (sameLocalPath(parent, candidate)) return true;
  const relative = path.relative(parent, candidate);
  return Boolean(relative)
    && relative !== '..'
    && !relative.startsWith('..' + path.sep)
    && !path.isAbsolute(relative);
}

function isStrictlyInside(parentPath, candidatePath) {
  return !sameLocalPath(parentPath, candidatePath)
    && isInsideOrEqual(parentPath, candidatePath);
}

function physicalRootIdentityDigest(entrySnapshot, targetSnapshot) {
  if (![PROJECT_ROOT_ENTRY_KINDS.DIRECTORY, PROJECT_ROOT_ENTRY_KINDS.SYMLINK]
    .includes(entrySnapshot.kind)
    || targetSnapshot.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
    fail('PROCESS_PHYSICAL_IDENTITY_INVALID');
  }
  try {
    return createProjectRootPhysicalIdentityDigest({
      device: targetSnapshot.device,
      inode: targetSnapshot.inode,
      entryDevice: entrySnapshot.device,
      entryInode: entrySnapshot.inode,
      entryType: entrySnapshot.kind,
    });
  } catch (error) {
    rethrow(error, 'PROCESS_PHYSICAL_IDENTITY_INVALID');
  }
}

function captureDirectoryAuthority(logicalPath, boundRealPath, changedCode) {
  if (!path.isAbsolute(logicalPath) || !path.isAbsolute(boundRealPath)
    || sameLocalPath(logicalPath, path.parse(logicalPath).root)
    || sameLocalPath(boundRealPath, path.parse(boundRealPath).root)) {
    fail(changedCode);
  }
  try {
    const entryBefore = statSnapshot(lstatBigInt(logicalPath));
    const targetBefore = statSnapshot(statBigInt(logicalPath));
    if (![PROJECT_ROOT_ENTRY_KINDS.DIRECTORY, PROJECT_ROOT_ENTRY_KINDS.SYMLINK]
      .includes(entryBefore.kind)
      || targetBefore.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) fail(changedCode);
    const realPath = fs.realpathSync(logicalPath);
    const expectedRealPath = fs.realpathSync(boundRealPath);
    const realEntry = statSnapshot(lstatBigInt(realPath));
    const entryAfter = statSnapshot(lstatBigInt(logicalPath));
    const targetAfter = statSnapshot(statBigInt(logicalPath));
    if (!sameLocalPath(realPath, expectedRealPath)
      || realEntry.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY
      || !sameSnapshot(entryBefore, entryAfter)
      || !sameSnapshot(targetBefore, targetAfter)
      || !sameIdentity(targetAfter, realEntry)) fail(changedCode);
    return Object.freeze({
      logicalPath,
      realPath,
      entrySnapshot: entryAfter,
      targetSnapshot: targetAfter,
    });
  } catch (error) {
    rethrow(error, changedCode);
  }
}

function captureExecutionAuthority(request) {
  const sandboxRequest = request.sandboxRequest;
  const root = captureDirectoryAuthority(
    sandboxRequest.rootPath,
    sandboxRequest.realRootPath,
    'PROCESS_WORKSPACE_IDENTITY_CHANGED'
  );
  const rootDigest = physicalRootIdentityDigest(
    root.entrySnapshot,
    root.targetSnapshot
  );
  if (rootDigest !== request.workspaceRootIdentityDigest) {
    fail('PROCESS_WORKSPACE_IDENTITY_MISMATCH');
  }
  const cwd = captureDirectoryAuthority(
    sandboxRequest.cwd,
    sandboxRequest.cwdRealPath,
    'PROCESS_CWD_IDENTITY_MISMATCH'
  );
  if (!isInsideOrEqual(root.realPath, cwd.realPath)) {
    fail('PROCESS_CWD_IDENTITY_MISMATCH');
  }
  return Object.freeze({ root, rootDigest, cwd });
}

function assertExecutionAuthorityUnchanged(authority, request) {
  const current = captureExecutionAuthority(request);
  if (current.rootDigest !== authority.rootDigest
    || !sameLocalPath(current.root.realPath, authority.root.realPath)
    || !sameSnapshot(current.root.entrySnapshot, authority.root.entrySnapshot)
    || !sameSnapshot(current.root.targetSnapshot, authority.root.targetSnapshot)
    || !sameLocalPath(current.cwd.realPath, authority.cwd.realPath)
    || !sameSnapshot(current.cwd.entrySnapshot, authority.cwd.entrySnapshot)
    || !sameSnapshot(current.cwd.targetSnapshot, authority.cwd.targetSnapshot)) {
    fail('PROCESS_EXECUTION_AUTHORITY_CHANGED');
  }
}

function captureSandboxExecutable() {
  try {
    const before = statSnapshot(lstatBigInt(DARWIN_SANDBOX_EXECUTABLE));
    const realPath = fs.realpathSync(DARWIN_SANDBOX_EXECUTABLE);
    const target = statSnapshot(statBigInt(DARWIN_SANDBOX_EXECUTABLE));
    const after = statSnapshot(lstatBigInt(DARWIN_SANDBOX_EXECUTABLE));
    const executableMode = BigInt(target.mode) & 0o111n;
    const unsafeMode = BigInt(target.mode) & 0o022n;
    if (before.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE
      || target.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE
      || !sameLocalPath(realPath, DARWIN_SANDBOX_EXECUTABLE)
      || !sameSnapshot(before, after)
      || !sameIdentity(after, target)
      || target.uid !== '0'
      || executableMode === 0n
      || unsafeMode !== 0n) fail('PROCESS_SUPERVISOR_SANDBOX_UNAVAILABLE');
    return Object.freeze({ path: realPath, identity: target });
  } catch (error) {
    rethrow(error, 'PROCESS_SUPERVISOR_SANDBOX_UNAVAILABLE');
  }
}

function assertSandboxExecutableUnchanged(expected) {
  const current = captureSandboxExecutable();
  if (!sameLocalPath(current.path, expected.path)
    || !sameSnapshot(current.identity, expected.identity)) {
    fail('PROCESS_SUPERVISOR_SANDBOX_CHANGED');
  }
}

function ownedDirectoryRecord(location, parentRealPath, invalidCode) {
  try {
    const before = statSnapshot(lstatBigInt(location));
    if (before.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) fail(invalidCode);
    const realPath = fs.realpathSync(location);
    const after = statSnapshot(lstatBigInt(location));
    if (!sameSnapshot(before, after)
      || !sameLocalPath(location, realPath)
      || (parentRealPath && !isStrictlyInside(parentRealPath, realPath))) {
      fail(invalidCode);
    }
    return Object.freeze({ path: location, realPath, identity: after });
  } catch (error) {
    rethrow(error, invalidCode);
  }
}

function createPrivateDirectory(prefix, parentRecord = null) {
  let createdPath = null;
  let createdIdentity = null;
  const invalidCode = 'PROCESS_PRIVATE_STORAGE_INVALID';
  try {
    const parentPath = parentRecord
      ? parentRecord.path
      : fs.realpathSync(os.tmpdir());
    const parentRealPath = parentRecord
      ? parentRecord.realPath
      : parentPath;
    if (!path.isAbsolute(parentPath)
      || sameLocalPath(parentPath, path.parse(parentPath).root)) fail(invalidCode);
    if (parentRecord) {
      const currentParent = statSnapshot(lstatBigInt(parentRecord.path));
      if (!sameIdentity(currentParent, parentRecord.identity)) fail(invalidCode);
    }
    createdPath = fs.mkdtempSync(path.join(parentPath, prefix));
    createdIdentity = statSnapshot(lstatBigInt(createdPath));
    if (createdIdentity.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) fail(invalidCode);
    fs.chmodSync(createdPath, 0o700);
    return ownedDirectoryRecord(createdPath, parentRealPath, invalidCode);
  } catch (error) {
    if (createdPath && createdIdentity) {
      try {
        const current = statSnapshot(lstatBigInt(createdPath));
        if (sameIdentity(current, createdIdentity)) fs.rmdirSync(createdPath);
      } catch { /* refuse ambiguous cleanup */ }
    }
    rethrow(error, invalidCode);
  }
}

function lstatOrNull(location, fallbackCode) {
  try {
    return lstatBigInt(location);
  } catch (error) {
    if (isMissing(error)) return null;
    rethrow(error, fallbackCode);
  }
}

function directoryNames(location, expectedIdentity, changedCode, cleanupState) {
  let directory;
  const names = [];
  try {
    const before = statSnapshot(lstatBigInt(location));
    if (before.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY
      || !sameIdentity(before, expectedIdentity)) fail(changedCode);
    directory = fs.opendirSync(location);
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      if (typeof entry.name !== 'string' || !entry.name
        || entry.name === '.' || entry.name === '..'
        || entry.name.includes('/') || entry.name.includes('\\')) fail(changedCode);
      cleanupState.entries += 1;
      if (cleanupState.entries > MAX_PRIVATE_TREE_ENTRIES) {
        fail('PROCESS_PRIVATE_STORAGE_LIMIT_EXCEEDED');
      }
      names.push(entry.name);
    }
    directory.closeSync();
    directory = null;
    const after = statSnapshot(lstatBigInt(location));
    if (!sameSnapshot(before, after)) fail(changedCode);
  } catch (error) {
    if (directory) {
      try { directory.closeSync(); } catch { /* best effort */ }
    }
    rethrow(error, changedCode);
  }
  names.sort();
  return names;
}

function removeOwnedTree(record, cleanupState = { entries: 0 }) {
  const changedCode = 'PROCESS_PRIVATE_STORAGE_CHANGED';
  const currentStat = lstatOrNull(record.path, changedCode);
  if (!currentStat) return;
  const current = statSnapshot(currentStat);
  if (current.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY
    || !sameIdentity(current, record.identity)) fail(changedCode);
  try { fs.chmodSync(record.path, 0o700); } catch (error) {
    rethrow(error, changedCode);
  }
  const names = directoryNames(record.path, current, changedCode, cleanupState);
  for (const name of names) {
    const childPath = path.join(record.path, name);
    let child;
    try { child = statSnapshot(lstatBigInt(childPath)); } catch (error) {
      rethrow(error, changedCode);
    }
    if (child.kind === PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
      removeOwnedTree(Object.freeze({
        path: childPath,
        realPath: childPath,
        identity: child,
      }), cleanupState);
    } else {
      try {
        const final = statSnapshot(lstatBigInt(childPath));
        if (!sameIdentity(final, child)) fail(changedCode);
        fs.unlinkSync(childPath);
      } catch (error) {
        rethrow(error, changedCode);
      }
    }
  }
  try {
    const final = statSnapshot(lstatBigInt(record.path));
    if (!sameIdentity(final, record.identity)) fail(changedCode);
    fs.rmdirSync(record.path);
  } catch (error) {
    rethrow(error, changedCode);
  }
}

function seatbeltArguments({ workspaceEntry, workspaceRoot, runtimeRoot, toolchainRoot, command, args }) {
  return [
    '-p',
    DARWIN_SEATBELT_PROFILE,
    '-DWORKSPACE_ENTRY=' + workspaceEntry,
    '-DWORKSPACE_ROOT=' + workspaceRoot,
    '-DRUNTIME_ROOT=' + runtimeRoot,
    '-DTOOLCHAIN_ROOT=' + toolchainRoot,
    '--',
    command,
    ...args,
  ];
}

function fixedSearchDirectories(authority) {
  const candidates = [
    path.join(authority.cwd.realPath, 'node_modules', '.bin'),
    path.join(authority.root.realPath, 'node_modules', '.bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  return Object.freeze(candidates.filter((candidate, index) => (
    candidates.findIndex((entry) => sameLocalPath(entry, candidate)) === index
  )));
}

function trustedToolchainRoot(executablePath, workspaceRoot) {
  if (isInsideOrEqual(workspaceRoot, executablePath)) return workspaceRoot;
  for (const root of SAFE_SYSTEM_EXECUTABLE_ROOTS) {
    if (!isInsideOrEqual(root, executablePath)) continue;
    if (root !== '/nix/store') return root;
    const relative = path.relative(root, executablePath).split(path.sep);
    if (!relative[0]) break;
    return path.join(root, relative[0]);
  }
  fail('PROCESS_EXECUTABLE_OUTSIDE_AUTHORITY');
}

function executableSnapshot(candidate, authority) {
  try {
    const entryBefore = statSnapshot(lstatBigInt(candidate));
    const targetBefore = statSnapshot(statBigInt(candidate));
    const realPath = fs.realpathSync(candidate);
    const entryAfter = statSnapshot(lstatBigInt(candidate));
    const targetAfter = statSnapshot(statBigInt(candidate));
    if (![PROJECT_ROOT_ENTRY_KINDS.FILE, PROJECT_ROOT_ENTRY_KINDS.SYMLINK]
      .includes(entryBefore.kind)
      || targetBefore.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE
      || !sameSnapshot(entryBefore, entryAfter)
      || !sameSnapshot(targetBefore, targetAfter)
      || (BigInt(targetAfter.mode) & 0o111n) === 0n) {
      fail('PROCESS_EXECUTABLE_INVALID');
    }
    const toolchainRoot = trustedToolchainRoot(realPath, authority.root.realPath);
    return Object.freeze({
      entryPath: candidate,
      entryIdentity: entryAfter,
      realPath,
      targetIdentity: targetAfter,
      toolchainRoot,
    });
  } catch (error) {
    rethrow(error, 'PROCESS_EXECUTABLE_INVALID');
  }
}

function resolveExecutable(command, authority) {
  const executable = command.executable;
  const candidates = [];
  if (path.isAbsolute(executable)) {
    candidates.push(path.normalize(executable));
  } else if (executable.includes('/') || executable.includes('\\')) {
    candidates.push(path.resolve(authority.cwd.realPath, executable));
  } else {
    for (const directory of fixedSearchDirectories(authority)) {
      candidates.push(path.join(directory, executable));
    }
  }
  for (const candidate of candidates) {
    try {
      return executableSnapshot(candidate, authority);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue;
      if (error instanceof PortableProcessSupervisorBackendError
        && error.code === 'PROCESS_EXECUTABLE_INVALID') {
        const missing = lstatOrNull(candidate, 'PROCESS_EXECUTABLE_INVALID');
        if (!missing) continue;
      }
      throw error;
    }
  }
  fail('PROCESS_EXECUTABLE_NOT_FOUND');
}

function assertExecutableUnchanged(executable) {
  try {
    const entry = statSnapshot(lstatBigInt(executable.entryPath));
    const realPath = fs.realpathSync(executable.entryPath);
    const target = statSnapshot(statBigInt(executable.entryPath));
    if (!sameLocalPath(realPath, executable.realPath)
      || !sameSnapshot(entry, executable.entryIdentity)
      || !sameSnapshot(target, executable.targetIdentity)) {
      fail('PROCESS_EXECUTABLE_CHANGED');
    }
  } catch (error) {
    rethrow(error, 'PROCESS_EXECUTABLE_CHANGED');
  }
}

function resolveCommand(request, authority) {
  const command = request.sandboxRequest.command;
  if (command.kind === SANDBOX_COMMAND_KINDS.EXECUTABLE) {
    const executable = resolveExecutable(command, authority);
    return Object.freeze({ executable, args: Object.freeze([...command.args]) });
  }
  if (command.kind !== SANDBOX_COMMAND_KINDS.SHELL) {
    fail('PROCESS_COMMAND_UNSUPPORTED');
  }
  const shellCommand = Object.freeze({
    executable: command.shellPath || '/bin/sh',
    args: Object.freeze([]),
  });
  const executable = resolveExecutable(shellCommand, authority);
  if (!SAFE_SHELLS.has(executable.realPath)) fail('PROCESS_SHELL_UNSUPPORTED');
  const args = path.basename(executable.realPath) === 'zsh'
    ? ['-f', '-c', command.text]
    : ['-c', command.text];
  return Object.freeze({ executable, args: Object.freeze(args) });
}

function buildEnvironment(request, authority, runtimeRoot) {
  const environment = {};
  for (const [key, value] of Object.entries(request.sandboxRequest.env)) {
    if (RESERVED_ENVIRONMENT_KEYS.has(key)
      || key.startsWith('DYLD_') || key.startsWith('LD_')) continue;
    environment[key] = value;
  }
  environment.HOME = runtimeRoot;
  environment.PATH = fixedSearchDirectories(authority).join(path.delimiter);
  environment.PWD = authority.cwd.realPath;
  environment.TEMP = runtimeRoot;
  environment.TMP = runtimeRoot;
  environment.TMPDIR = runtimeRoot + path.sep;
  return environment;
}

function utf8Prefix(text, maximumBytes) {
  if (maximumBytes <= 0 || !text) return Object.freeze({ text: '', bytes: 0 });
  let result = '';
  let bytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return Object.freeze({ text: result, bytes });
}

function utf8SuffixAt(text, byteOffset) {
  if (byteOffset === 0) return text;
  let bytes = 0;
  let index = 0;
  for (const character of text) {
    if (bytes === byteOffset) return text.slice(index);
    bytes += Buffer.byteLength(character, 'utf8');
    index += character.length;
    if (bytes > byteOffset) return null;
  }
  return bytes === byteOffset ? '' : null;
}

function bumpRevision(record) {
  if (!Number.isSafeInteger(record.revision) || record.revision >= Number.MAX_SAFE_INTEGER) {
    fail('PROCESS_REVISION_LIMIT_EXCEEDED');
  }
  record.revision += 1;
  notifyWaiters(record);
}

function appendOutputText(record, stream, text) {
  let remaining = text;
  let changed = false;
  while (remaining) {
    const part = utf8Prefix(remaining, MAX_OUTPUT_CHUNK_BYTES);
    if (!part.text || part.bytes <= 0) fail('PROCESS_OUTPUT_ENCODING_INVALID');
    const startCursor = record.outputCursor;
    const endCursor = startCursor + part.bytes;
    if (!Number.isSafeInteger(endCursor)) fail('PROCESS_OUTPUT_LIMIT_EXCEEDED');
    const previous = record.outputChunks[record.outputChunks.length - 1];
    if (previous && previous.stream === stream
      && Buffer.byteLength(previous.text, 'utf8') + part.bytes
        <= MAX_OUTPUT_CHUNK_BYTES) {
      previous.text += part.text;
      previous.endCursor = endCursor;
    } else {
      record.outputChunks.push({ startCursor, endCursor, stream, text: part.text });
    }
    record.outputCursor = endCursor;
    record.retainedOutputBytes += part.bytes;
    remaining = remaining.slice(part.text.length);
    changed = true;
  }
  while (record.retainedOutputBytes > MAX_RETAINED_OUTPUT_BYTES
    && record.outputChunks.length > 0) {
    const removed = record.outputChunks.shift();
    record.retainedOutputBytes -= removed.endCursor - removed.startCursor;
    record.availableFromCursor = removed.endCursor;
  }
  if (record.outputChunks.length > 0) {
    record.availableFromCursor = record.outputChunks[0].startCursor;
  } else {
    record.availableFromCursor = record.outputCursor;
  }
  if (changed) bumpRevision(record);
}

function appendSystemCode(record, code) {
  appendOutputText(record, PROCESS_OUTPUT_STREAMS.SYSTEM, '[' + code + ']\n');
}

function snapshotFields(record) {
  return Object.freeze({
    status: record.status,
    revision: record.revision,
    exitCode: record.exitCode,
    signal: record.signal,
    timedOut: record.timedOut,
    stopped: record.stopped,
    availableFromCursor: record.availableFromCursor,
    outputCursor: record.outputCursor,
  });
}

function waitResult(record, request) {
  return createProcessSupervisorWaitResult({
    request,
    ...snapshotFields(record),
    changed: record.revision > request.afterRevision,
  });
}

function notifyWaiters(record) {
  for (const waiter of [...record.waiters]) {
    if (record.revision <= waiter.request.afterRevision) continue;
    record.waiters.delete(waiter);
    clearTimeout(waiter.timer);
    waiter.resolve(waitResult(record, waiter.request));
  }
}

function rejectWaiters(record, error) {
  for (const waiter of [...record.waiters]) {
    record.waiters.delete(waiter);
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
}

function groupExists(record) {
  if (!Number.isSafeInteger(record.processGroupId) || record.processGroupId <= 1) {
    return false;
  }
  try {
    process.kill(-record.processGroupId, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false;
    if (errorCode(error) === 'EPERM') return true;
    rethrow(error, 'PROCESS_TREE_STATUS_FAILED');
  }
}

function signalGroup(record, signal) {
  try {
    process.kill(-record.processGroupId, signal);
    record.terminationSignal = signal;
    return true;
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false;
    rethrow(error, 'PROCESS_TREE_TERMINATION_FAILED');
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForGroupExit(record, maximumMs) {
  const deadline = Date.now() + maximumMs;
  while (groupExists(record)) {
    if (Date.now() >= deadline) return false;
    await delay(TERMINATION_POLL_MS);
  }
  return true;
}

function terminateProcessTree(record) {
  if (record.treeTerminationPromise) return record.treeTerminationPromise;
  record.treeTerminationPromise = (async () => {
    if (!groupExists(record)) return true;
    signalGroup(record, 'SIGTERM');
    if (await waitForGroupExit(record, TERMINATION_GRACE_MS)) return true;
    signalGroup(record, 'SIGKILL');
    if (await waitForGroupExit(record, TERMINATION_HARD_MS)) return true;
    fail('PROCESS_TREE_TERMINATION_FAILED');
  })();
  record.treeTerminationPromise.catch(() => {});
  return record.treeTerminationPromise;
}

function terminalState(record, code, signal) {
  const normalizedSignal = typeof signal === 'string' && signal
    ? signal.toUpperCase()
    : (record.terminationSignal || null);
  if (record.terminationKind === 'timeout') {
    return Object.freeze({
      status: PROCESS_EXECUTION_STATUSES.TIMED_OUT,
      exitCode: null,
      signal: normalizedSignal || 'SIGTERM',
      timedOut: true,
      stopped: false,
    });
  }
  if (record.terminationKind === 'stop' || record.terminationKind === 'dispose') {
    return Object.freeze({
      status: PROCESS_EXECUTION_STATUSES.STOPPED,
      exitCode: null,
      signal: normalizedSignal || 'SIGTERM',
      timedOut: false,
      stopped: true,
    });
  }
  if (Number.isSafeInteger(code) && code === 0 && normalizedSignal === null) {
    return Object.freeze({
      status: PROCESS_EXECUTION_STATUSES.SUCCEEDED,
      exitCode: 0,
      signal: null,
      timedOut: false,
      stopped: false,
    });
  }
  return Object.freeze({
    status: PROCESS_EXECUTION_STATUSES.FAILED,
    exitCode: Number.isSafeInteger(code) && code > 0 ? code : null,
    signal: normalizedSignal || (Number.isSafeInteger(code) ? null : 'SIGABRT'),
    timedOut: false,
    stopped: false,
  });
}

function createPortableProcessSupervisorBackend(options = {}) {
  normalizeOptions(options);
  let state = 'idle';
  let probeReceipt = null;
  let sandboxExecutable = null;
  let sessionRoot = null;
  let disposePromise = null;
  let disposeReceipt = null;
  const records = new Map();
  const activeByJob = new Map();

  function unavailable(reasonCode) {
    return createProcessSupervisorProbeResult({
      state: PROCESS_SUPERVISOR_STATES.UNAVAILABLE,
      guarantees: [],
      reasonCode,
    });
  }

  function cleanupRecordStorage(record) {
    if (!record.storage) return;
    removeOwnedTree(record.storage);
    record.storage = null;
  }

  function quarantineRecord(record, code) {
    state = 'quarantined';
    record.quarantined = true;
    const error = new PortableProcessSupervisorBackendError(code);
    rejectWaiters(record, error);
    if (record.rejectTerminal) record.rejectTerminal(error);
    return error;
  }

  async function finalizeRecord(record, code, signal) {
    if (record.finalizePromise) return record.finalizePromise;
    record.finalizePromise = (async () => {
      if (record.timeoutTimer) {
        clearTimeout(record.timeoutTimer);
        record.timeoutTimer = null;
      }
      const stdoutRemainder = record.stdoutDecoder.end();
      const stderrRemainder = record.stderrDecoder.end();
      if (stdoutRemainder) {
        appendOutputText(record, PROCESS_OUTPUT_STREAMS.STDOUT, stdoutRemainder);
      }
      if (stderrRemainder) {
        appendOutputText(record, PROCESS_OUTPUT_STREAMS.STDERR, stderrRemainder);
      }
      await terminateProcessTree(record);
      cleanupRecordStorage(record);
      const terminal = terminalState(record, code, signal);
      record.status = terminal.status;
      record.exitCode = terminal.exitCode;
      record.signal = terminal.signal;
      record.timedOut = terminal.timedOut;
      record.stopped = terminal.stopped;
      if (activeByJob.get(record.request.jobId) === record) {
        activeByJob.delete(record.request.jobId);
      }
      bumpRevision(record);
      const snapshot = snapshotFields(record);
      record.resolveTerminal(snapshot);
      if (!record.execSettled) {
        record.execSettled = true;
        record.resolveExec(createProcessSupervisorExecReceipt({
          request: record.request,
          ...snapshot,
        }));
      }
      return snapshot;
    })().catch((error) => {
      throw quarantineRecord(record, error instanceof PortableProcessSupervisorBackendError
        ? error.code
        : 'PROCESS_TERMINAL_CLEANUP_FAILED');
    });
    record.finalizePromise.catch(() => {});
    return record.finalizePromise;
  }

  function scheduleFinalizeFallback(record, code, signal) {
    setTimeout(() => {
      finalizeRecord(record, code, signal).catch(() => {});
    }, 100);
  }

  function startTimeout(record) {
    record.timeoutTimer = setTimeout(() => {
      if (record.status !== PROCESS_EXECUTION_STATUSES.RUNNING) return;
      record.terminationKind = 'timeout';
      terminateProcessTree(record).then(() => {
        scheduleFinalizeFallback(
          record,
          record.child && record.child.exitCode,
          record.child && record.child.signalCode
        );
      }).catch(() => {});
    }, record.request.sandboxRequest.timeoutMs);
    if (record.timeoutTimer && typeof record.timeoutTimer.unref === 'function') {
      record.timeoutTimer.unref();
    }
  }

  function attachChild(record, child) {
    record.child = child;
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        try {
          const text = record.stdoutDecoder.write(Buffer.from(chunk));
          if (text) appendOutputText(record, PROCESS_OUTPUT_STREAMS.STDOUT, text);
        } catch {
          quarantineRecord(record, 'PROCESS_OUTPUT_CAPTURE_FAILED');
        }
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        try {
          const text = record.stderrDecoder.write(Buffer.from(chunk));
          if (text) appendOutputText(record, PROCESS_OUTPUT_STREAMS.STDERR, text);
        } catch {
          quarantineRecord(record, 'PROCESS_OUTPUT_CAPTURE_FAILED');
        }
      });
    }
    child.once('spawn', () => {
      try {
        if (!Number.isSafeInteger(child.pid) || child.pid <= 1
          || child.pid === process.pid) fail('PROCESS_SPAWN_IDENTITY_INVALID');
        record.spawned = true;
        record.processGroupId = child.pid;
        startTimeout(record);
        if (!record.execSettled) {
          record.execSettled = true;
          record.resolveExec(createProcessSupervisorExecReceipt({
            request: record.request,
            ...snapshotFields(record),
          }));
        }
      } catch (error) {
        quarantineRecord(record, error instanceof PortableProcessSupervisorBackendError
          ? error.code
          : 'PROCESS_SPAWN_IDENTITY_INVALID');
      }
    });
    child.once('error', () => {
      try { appendSystemCode(record, 'PROCESS_SPAWN_FAILED'); } catch { /* quarantined below */ }
      if (!record.spawned) scheduleFinalizeFallback(record, 1, null);
    });
    child.once('exit', (code, signal) => {
      record.rootExitCode = code;
      record.rootSignal = signal;
      terminateProcessTree(record).then(() => {
        scheduleFinalizeFallback(record, code, signal);
      }).catch(() => {});
    });
    child.once('close', (code, signal) => {
      finalizeRecord(record, code, signal).catch(() => {});
    });
  }

  function probe(input) {
    void input;
    if (state === 'disposed' || state === 'disposing') {
      return unavailable('PROCESS_SUPERVISOR_BACKEND_DISPOSED');
    }
    if (state === 'quarantined') {
      return unavailable('PROCESS_SUPERVISOR_BACKEND_UNHEALTHY');
    }
    if (probeReceipt) return probeReceipt;
    if (process.platform !== 'darwin') {
      state = 'unavailable';
      probeReceipt = unavailable('PROCESS_SUPERVISOR_PLATFORM_UNAVAILABLE');
      return probeReceipt;
    }
    let probeRoot = null;
    try {
      sandboxExecutable = captureSandboxExecutable();
      probeRoot = createPrivateDirectory(PROBE_DIRECTORY_PREFIX);
      const result = childProcess.spawnSync(
        sandboxExecutable.path,
        seatbeltArguments({
          workspaceEntry: probeRoot.path,
          workspaceRoot: probeRoot.realPath,
          runtimeRoot: probeRoot.realPath,
          toolchainRoot: '/usr',
          command: '/usr/bin/true',
          args: [],
        }),
        {
          cwd: probeRoot.realPath,
          env: {
            HOME: probeRoot.realPath,
            PATH: '/usr/bin:/bin',
            TEMP: probeRoot.realPath,
            TMP: probeRoot.realPath,
            TMPDIR: probeRoot.realPath + path.sep,
          },
          stdio: 'ignore',
          timeout: PROBE_TIMEOUT_MS,
          windowsHide: true,
        }
      );
      assertSandboxExecutableUnchanged(sandboxExecutable);
      if (!result || result.error || result.signal || result.status !== 0) {
        fail('PROCESS_SUPERVISOR_SANDBOX_UNAVAILABLE');
      }
      removeOwnedTree(probeRoot);
      probeRoot = null;
      state = 'ready';
      probeReceipt = createProcessSupervisorProbeResult({
        state: PROCESS_SUPERVISOR_STATES.ENFORCED,
        guarantees: PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
      });
      return probeReceipt;
    } catch {
      if (probeRoot) {
        try { removeOwnedTree(probeRoot); } catch { /* probe remains unavailable */ }
      }
      sandboxExecutable = null;
      state = 'unavailable';
      probeReceipt = unavailable('PROCESS_SUPERVISOR_SANDBOX_UNAVAILABLE');
      return probeReceipt;
    }
  }

  function assertReady() {
    if (state === 'idle') probe();
    if (state !== 'ready' || !sandboxExecutable) {
      fail('PROCESS_SUPERVISOR_BACKEND_UNAVAILABLE');
    }
  }

  function ensureSessionRoot() {
    if (sessionRoot) {
      const current = statSnapshot(lstatBigInt(sessionRoot.path));
      if (!sameIdentity(current, sessionRoot.identity)) {
        state = 'quarantined';
        fail('PROCESS_PRIVATE_STORAGE_CHANGED');
      }
      return sessionRoot;
    }
    try {
      sessionRoot = createPrivateDirectory(SESSION_DIRECTORY_PREFIX);
      return sessionRoot;
    } catch (error) {
      state = 'quarantined';
      rethrow(error, 'PROCESS_PRIVATE_STORAGE_UNAVAILABLE');
    }
  }

  function recordForAuthority(request) {
    const record = records.get(request.executionId);
    if (!record) fail('PROCESS_EXECUTION_NOT_FOUND');
    if (record.request.jobId !== request.jobId
      || record.request.workspaceAuthorityDigest
        !== request.workspaceAuthorityDigest) {
      fail('PROCESS_EXECUTION_AUTHORITY_MISMATCH');
    }
    if (record.quarantined) fail('PROCESS_EXECUTION_QUARANTINED');
    return record;
  }

  async function exec(value) {
    assertReady();
    let request;
    try { request = assertProcessSupervisorExecRequest(value); } catch (error) {
      rethrow(error, 'PROCESS_EXEC_REQUEST_INVALID');
    }
    if (request.sandboxRequest.networkMode !== SANDBOX_NETWORK_MODES.DISABLED) {
      fail('PROCESS_NETWORK_AUTHORITY_UNAVAILABLE');
    }
    if (records.has(request.executionId)) fail('PROCESS_EXECUTION_ALREADY_EXISTS');
    if (activeByJob.has(request.jobId)) fail('PROCESS_JOB_ALREADY_ACTIVE');
    if (records.size >= MAX_EXECUTION_RECORDS) fail('PROCESS_EXECUTION_LIMIT_EXCEEDED');
    const authority = captureExecutionAuthority(request);
    const command = resolveCommand(request, authority);
    const root = ensureSessionRoot();
    let storage = null;
    try {
      storage = createPrivateDirectory(EXECUTION_DIRECTORY_PREFIX, root);
      const environment = buildEnvironment(request, authority, storage.realPath);
      assertSandboxExecutableUnchanged(sandboxExecutable);
      assertExecutionAuthorityUnchanged(authority, request);
      assertExecutableUnchanged(command.executable);
      const record = {
        availableFromCursor: 0,
        child: null,
        execSettled: false,
        exitCode: null,
        finalizePromise: null,
        outputChunks: [],
        outputCursor: 0,
        processGroupId: null,
        quarantined: false,
        request,
        retainedOutputBytes: 0,
        revision: 1,
        signal: null,
        spawned: false,
        status: PROCESS_EXECUTION_STATUSES.RUNNING,
        stderrDecoder: new StringDecoder('utf8'),
        stdoutDecoder: new StringDecoder('utf8'),
        stopped: false,
        storage,
        terminationKind: null,
        terminationSignal: null,
        timedOut: false,
        timeoutTimer: null,
        treeTerminationPromise: null,
        waiters: new Set(),
      };
      record.execPromise = new Promise((resolve, reject) => {
        record.resolveExec = resolve;
        record.rejectExec = reject;
      });
      record.terminalPromise = new Promise((resolve, reject) => {
        record.resolveTerminal = resolve;
        record.rejectTerminal = reject;
      });
      record.terminalPromise.catch(() => {});
      records.set(request.executionId, record);
      activeByJob.set(request.jobId, record);
      let child;
      try {
        child = childProcess.spawn(
          sandboxExecutable.path,
          seatbeltArguments({
            workspaceEntry: authority.root.logicalPath,
            workspaceRoot: authority.root.realPath,
            runtimeRoot: storage.realPath,
            toolchainRoot: command.executable.toolchainRoot,
            command: command.executable.realPath,
            args: command.args,
          }),
          {
            cwd: authority.cwd.realPath,
            detached: true,
            env: environment,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          }
        );
      } catch (error) {
        records.delete(request.executionId);
        activeByJob.delete(request.jobId);
        cleanupRecordStorage(record);
        rethrow(error, 'PROCESS_SPAWN_FAILED');
      }
      attachChild(record, child);
      storage = null;
      return record.execPromise;
    } catch (error) {
      if (storage) {
        try { removeOwnedTree(storage); } catch {
          state = 'quarantined';
          fail('PROCESS_EXEC_ACQUIRE_CLEANUP_FAILED');
        }
      }
      throw error;
    }
  }

  async function read(value) {
    assertReady();
    let request;
    try { request = normalizeReadRequest(value); } catch (error) {
      rethrow(error, 'PROCESS_READ_REQUEST_INVALID');
    }
    const record = recordForAuthority(request);
    if (request.cursor > record.outputCursor) fail('PROCESS_OUTPUT_CURSOR_INVALID');
    let cursor = Math.max(request.cursor, record.availableFromCursor);
    let remainingBytes = request.maxBytes;
    const chunks = [];
    for (const chunk of record.outputChunks) {
      if (chunk.endCursor <= cursor) continue;
      if (chunk.startCursor > cursor) fail('PROCESS_OUTPUT_STATE_INVALID');
      const suffix = utf8SuffixAt(chunk.text, cursor - chunk.startCursor);
      if (suffix === null) fail('PROCESS_OUTPUT_CURSOR_INVALID');
      const part = utf8Prefix(suffix, remainingBytes);
      if (!part.text) break;
      chunks.push(Object.freeze({
        startCursor: cursor,
        endCursor: cursor + part.bytes,
        stream: chunk.stream,
        text: part.text,
      }));
      cursor += part.bytes;
      remainingBytes -= part.bytes;
      if (part.text.length !== suffix.length || remainingBytes === 0) break;
    }
    return createProcessSupervisorReadResult({
      request,
      ...snapshotFields(record),
      chunks,
      eof: TERMINAL_STATUSES.has(record.status) && cursor === record.outputCursor,
    });
  }

  async function wait(value) {
    assertReady();
    let request;
    try { request = normalizeWaitRequest(value); } catch (error) {
      rethrow(error, 'PROCESS_WAIT_REQUEST_INVALID');
    }
    const record = recordForAuthority(request);
    if (request.afterRevision > record.revision) fail('PROCESS_REVISION_INVALID');
    if (record.revision > request.afterRevision) return waitResult(record, request);
    return new Promise((resolve, reject) => {
      const waiter = { request, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        record.waiters.delete(waiter);
        try { resolve(waitResult(record, request)); } catch (error) { reject(error); }
      }, request.timeoutMs);
      record.waiters.add(waiter);
    });
  }

  async function stop(value) {
    assertReady();
    let request;
    try { request = normalizeStopRequest(value); } catch (error) {
      rethrow(error, 'PROCESS_STOP_REQUEST_INVALID');
    }
    const record = recordForAuthority(request);
    if (record.revision < request.expectedRevision) fail('PROCESS_REVISION_INVALID');
    if (TERMINAL_STATUSES.has(record.status)) {
      return createProcessSupervisorStopReceipt({
        request,
        ...snapshotFields(record),
        treeTerminated: true,
        idempotent: true,
      });
    }
    record.terminationKind = 'stop';
    await terminateProcessTree(record);
    scheduleFinalizeFallback(
      record,
      record.child && record.child.exitCode,
      record.child && record.child.signalCode
    );
    await record.terminalPromise;
    return createProcessSupervisorStopReceipt({
      request,
      ...snapshotFields(record),
      treeTerminated: true,
      idempotent: false,
    });
  }

  function removeSessionRoot() {
    if (!sessionRoot) return;
    removeOwnedTree(sessionRoot);
    sessionRoot = null;
  }

  async function dispose(input) {
    void input;
    if (disposeReceipt) return disposeReceipt;
    if (disposePromise) return disposePromise;
    if (state === 'disposed') return createProcessSupervisorDisposeReceipt({ orphaned: 0 });
    state = 'disposing';
    disposePromise = (async () => {
      for (const record of records.values()) {
        if (TERMINAL_STATUSES.has(record.status)) continue;
        record.terminationKind = 'dispose';
        await terminateProcessTree(record);
        scheduleFinalizeFallback(
          record,
          record.child && record.child.exitCode,
          record.child && record.child.signalCode
        );
      }
      for (const record of records.values()) {
        if (!TERMINAL_STATUSES.has(record.status)) await record.terminalPromise;
        if (groupExists(record) || record.quarantined || record.storage) {
          fail('PROCESS_SUPERVISOR_ORPHANED_AUTHORITY');
        }
      }
      removeSessionRoot();
      state = 'disposed';
      disposeReceipt = createProcessSupervisorDisposeReceipt({ orphaned: 0 });
      disposePromise = null;
      return disposeReceipt;
    })().catch((error) => {
      state = 'quarantined';
      disposePromise = null;
      rethrow(error, 'PROCESS_SUPERVISOR_DISPOSE_FAILED');
    });
    return disposePromise;
  }

  return Object.freeze({
    version: PROCESS_SUPERVISOR_BACKEND_VERSION,
    id: PORTABLE_PROCESS_SUPERVISOR_BACKEND_ID,
    probe,
    exec,
    read,
    wait,
    stop,
    dispose,
  });
}

module.exports = {
  PORTABLE_PROCESS_SUPERVISOR_BACKEND_ID,
  PORTABLE_PROCESS_SUPERVISOR_BACKEND_VERSION,
  PortableProcessSupervisorBackendError,
  createPortableProcessSupervisorBackend,
};
