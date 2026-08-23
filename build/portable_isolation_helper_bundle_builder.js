'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');
const vm = require('vm');

const PORTABLE_ISOLATION_HELPER_BUNDLE_BUILDER_VERSION =
  'portable-isolation-helper-bundle-builder.v1';
const PORTABLE_ISOLATION_HELPER_BUNDLE_RESULT_VERSION =
  'portable-isolation-helper-bundle-result.v1';
const PORTABLE_ISOLATION_HELPER_BUNDLE_ENTRY_MODULE_ID =
  'main/portable_isolation_helper/utility_entry.js';
const PORTABLE_ISOLATION_HELPER_BUNDLE_MODULE_IDS = Object.freeze([
  'main/capabilities/capability_delegation_contracts.js',
  'main/capabilities/execution_workspace_contract.js',
  'main/capabilities/portable_isolation_helper_backend_contract.js',
  'main/capabilities/portable_isolation_helper_distribution_attestation_contract.js',
  'main/capabilities/portable_isolation_helper_private_transport_contract.js',
  'main/capabilities/portable_isolation_helper_protocol.js',
  'main/capabilities/process_supervisor_contract.js',
  'main/capabilities/project_root_authority_contract.js',
  'main/capabilities/sandbox_backend_contract.js',
  'main/capabilities/transactional_delete_contracts.js',
  'main/services/portable_isolation_helper_backend_dispatcher.js',
  'main/services/portable_isolation_helper_execution_workspace_backend.js',
  'main/services/portable_isolation_helper_physical_runtime.js',
  'main/services/portable_isolation_helper_process_supervisor_backend.js',
  'main/services/portable_isolation_helper_project_root_authority_backend.js',
  'main/services/portable_isolation_helper_runtime_session.js',
  PORTABLE_ISOLATION_HELPER_BUNDLE_ENTRY_MODULE_ID,
]);
const NATIVE_MODULES = Object.freeze([
  'child_process',
  'crypto',
  'fs',
  'os',
  'path',
  'string_decoder',
  'util',
]);
const OPTION_KEYS = Object.freeze(['projectRootPath']);
const MAX_MODULE_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 768 * 1024;
const MAX_BUNDLE_BYTES = 1024 * 1024;
const UTF8_DECODER = new util.TextDecoder('utf-8', { fatal: true });

class PortableIsolationHelperBundleBuilderError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperBundleBuilderError';
    this.code = code;
  }
}

function bundleError(code) {
  return new PortableIsolationHelperBundleBuilderError(code);
}

function fail(code) {
  throw bundleError(code);
}

function exactOptions(value) {
  const code = 'BUNDLE_BUILDER_OPTIONS_INVALID';
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
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== OPTION_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))) {
    fail(code);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'projectRootPath');
  if (!descriptor || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'string'
    || !descriptor.value || descriptor.value !== descriptor.value.trim()
    || descriptor.value.includes('\0') || !path.isAbsolute(descriptor.value)) {
    fail(code);
  }
  const resolved = path.resolve(descriptor.value);
  if (resolved === path.parse(resolved).root) fail(code);
  return resolved;
}

function statSnapshot(stat) {
  try {
    return Object.freeze({
      device: String(stat.dev),
      inode: String(stat.ino),
      mode: String(stat.mode),
      links: String(stat.nlink),
      size: String(stat.size),
      modifiedNanoseconds: String(stat.mtimeNs),
      changedNanoseconds: String(stat.ctimeNs),
      file: stat.isFile(),
      directory: stat.isDirectory(),
      symbolicLink: stat.isSymbolicLink(),
    });
  } catch {
    fail('BUNDLE_SOURCE_INVALID');
  }
}

function sameSnapshot(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.mode === right.mode
    && left.links === right.links
    && left.size === right.size
    && left.modifiedNanoseconds === right.modifiedNanoseconds
    && left.changedNanoseconds === right.changedNanoseconds
    && left.file === right.file
    && left.directory === right.directory
    && left.symbolicLink === right.symbolicLink;
}

function captureProjectRoot(projectRootPath) {
  try {
    const before = statSnapshot(fs.lstatSync(projectRootPath, { bigint: true }));
    const realPath = fs.realpathSync(projectRootPath);
    const after = statSnapshot(fs.lstatSync(projectRootPath, { bigint: true }));
    if (!before.directory || before.symbolicLink
      || !sameSnapshot(before, after) || realPath !== projectRootPath) {
      fail('BUNDLE_SOURCE_INVALID');
    }
    return Object.freeze({ path: projectRootPath, identity: after });
  } catch (error) {
    if (error instanceof PortableIsolationHelperBundleBuilderError) throw error;
    fail('BUNDLE_SOURCE_INVALID');
  }
}

function assertProjectRootUnchanged(root) {
  try {
    const current = statSnapshot(fs.lstatSync(root.path, { bigint: true }));
    if (!sameSnapshot(current, root.identity)
      || fs.realpathSync(root.path) !== root.path) fail('BUNDLE_SOURCE_CHANGED');
  } catch (error) {
    if (error instanceof PortableIsolationHelperBundleBuilderError) throw error;
    fail('BUNDLE_SOURCE_CHANGED');
  }
}

function containedPath(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && relative !== '..'
    && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function inspectSource(root, moduleId) {
  const location = path.join(root.path, ...moduleId.split('/'));
  if (!containedPath(root.path, location)) fail('BUNDLE_SOURCE_INVALID');
  let descriptor;
  let bytes;
  try {
    const before = statSnapshot(fs.lstatSync(location, { bigint: true }));
    if (!before.file || before.symbolicLink || before.links !== '1'
      || BigInt(before.size) < 1n || BigInt(before.size) > BigInt(MAX_MODULE_BYTES)) {
      fail('BUNDLE_SOURCE_INVALID');
    }
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number'
      ? fs.constants.O_NOFOLLOW
      : 0;
    descriptor = fs.openSync(location, fs.constants.O_RDONLY | noFollow);
    const opened = statSnapshot(fs.fstatSync(descriptor, { bigint: true }));
    if (!sameSnapshot(before, opened)) fail('BUNDLE_SOURCE_CHANGED');
    bytes = fs.readFileSync(descriptor);
    const after = statSnapshot(fs.fstatSync(descriptor, { bigint: true }));
    const final = statSnapshot(fs.lstatSync(location, { bigint: true }));
    if (!sameSnapshot(opened, after) || !sameSnapshot(after, final)
      || !Buffer.isBuffer(bytes) || bytes.length !== Number(opened.size)) {
      fail('BUNDLE_SOURCE_CHANGED');
    }
    const source = UTF8_DECODER.decode(bytes);
    if (source.includes('\0') || Buffer.from(source, 'utf8').length !== bytes.length) {
      fail('BUNDLE_SOURCE_INVALID');
    }
    return Object.freeze({
      id: moduleId,
      bytes: bytes.length,
      digest: sha256(bytes),
      source,
    });
  } catch (error) {
    if (error instanceof PortableIsolationHelperBundleBuilderError) throw error;
    fail('BUNDLE_SOURCE_INVALID');
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* fail closed above */ }
    }
    if (Buffer.isBuffer(bytes)) bytes.fill(0);
  }
}

function moduleFactories(sources) {
  return sources.map((record) => (
    `${JSON.stringify(record.id)}: function(module, exports, require, __filename, __dirname) {\n`
      + `${record.source}\n}`
  )).join(',\n');
}

function runtimeLoader(entryModuleId, nativeModules, sourceIdentityDigest) {
  return [
    `const __faberEntryModuleId = ${JSON.stringify(entryModuleId)};`,
    `const __faberNativeModules = new Set(${JSON.stringify(nativeModules)});`,
    `const __faberSourceIdentityDigest = ${JSON.stringify(sourceIdentityDigest)};`,
    'const __faberModuleCache = new Map();',
    'function __faberResolve(parentId, request) {',
    "  if (typeof request !== 'string' || !request || request.includes('\\0')",
    "    || request.includes('\\\\')) throw new Error('FABER_BUNDLE_REQUIRE_REJECTED');",
    '  if (__faberNativeModules.has(request)) return Object.freeze({ native: true, id: request });',
    "  if (!request.startsWith('./') && !request.startsWith('../')) {",
    "    throw new Error('FABER_BUNDLE_REQUIRE_REJECTED');",
    '  }',
    "  const segments = parentId.split('/');",
    '  segments.pop();',
    "  for (const segment of request.split('/')) {",
    "    if (!segment || segment === '.') continue;",
    "    if (segment === '..') {",
    "      if (segments.length === 0) throw new Error('FABER_BUNDLE_REQUIRE_REJECTED');",
    '      segments.pop();',
    '    } else {',
    '      segments.push(segment);',
    '    }',
    '  }',
    "  let id = segments.join('/');",
    "  if (!id.endsWith('.js')) id += '.js';",
    "  if (!Object.hasOwn(__faberFactories, id)) throw new Error('FABER_BUNDLE_REQUIRE_REJECTED');",
    '  return Object.freeze({ native: false, id });',
    '}',
    'function __faberLoad(id, parentId) {',
    '  const resolved = parentId === null',
    '    ? Object.freeze({ native: false, id })',
    '    : __faberResolve(parentId, id);',
    '  if (resolved.native) return __faberNativeRequire(resolved.id);',
    '  if (__faberModuleCache.has(resolved.id)) {',
    '    return __faberModuleCache.get(resolved.id).exports;',
    '  }',
    '  const factory = __faberFactories[resolved.id];',
    "  if (typeof factory !== 'function') throw new Error('FABER_BUNDLE_MODULE_MISSING');",
    '  const moduleRecord = { exports: {} };',
    '  __faberModuleCache.set(resolved.id, moduleRecord);',
    '  const localRequire = (request) => __faberLoad(request, resolved.id);',
    "  const slash = resolved.id.lastIndexOf('/');",
    "  const filename = '/faber-portable-isolation-helper/' + resolved.id;",
    "  const dirname = '/faber-portable-isolation-helper/'",
    "    + (slash < 0 ? '' : resolved.id.slice(0, slash));",
    '  try {',
    '    factory(moduleRecord, moduleRecord.exports, localRequire, filename, dirname);',
    '    return moduleRecord.exports;',
    '  } catch (error) {',
    '    __faberModuleCache.delete(resolved.id);',
    '    throw error;',
    '  }',
    '}',
    'void __faberSourceIdentityDigest;',
    '__faberLoad(__faberEntryModuleId, null);',
  ].join('\n');
}

function createBundleSource(sources, sourceIdentityDigest) {
  return [
    "'use strict';",
    '',
    'const __faberNativeRequire = require;',
    'const __faberFactories = Object.freeze({',
    moduleFactories(sources),
    '});',
    runtimeLoader(
      PORTABLE_ISOLATION_HELPER_BUNDLE_ENTRY_MODULE_ID,
      NATIVE_MODULES,
      sourceIdentityDigest
    ),
    '',
  ].join('\n');
}

function createPortableIsolationHelperBundleBuilder(options = {}) {
  const projectRootPath = exactOptions(options);
  const root = captureProjectRoot(projectRootPath);

  function build(input) {
    if (arguments.length !== 0 || input !== undefined) {
      fail('BUNDLE_BUILD_REQUEST_INVALID');
    }
    assertProjectRootUnchanged(root);
    const sources = [];
    let totalSourceBytes = 0;
    for (const moduleId of PORTABLE_ISOLATION_HELPER_BUNDLE_MODULE_IDS) {
      const source = inspectSource(root, moduleId);
      totalSourceBytes += source.bytes;
      if (totalSourceBytes > MAX_SOURCE_BYTES) fail('BUNDLE_SOURCE_LIMIT_EXCEEDED');
      sources.push(source);
    }
    assertProjectRootUnchanged(root);
    const sourceIdentity = Object.freeze({
      version: 'portable-isolation-helper-bundle-source-set.v1',
      modules: sources.map((source) => Object.freeze({
        id: source.id,
        digest: source.digest,
        bytes: source.bytes,
      })),
    });
    const sourceIdentityDigest = sha256(
      Buffer.from(JSON.stringify(sourceIdentity), 'utf8')
    );
    const bundleSource = createBundleSource(sources, sourceIdentityDigest);
    const bundleBytes = Buffer.byteLength(bundleSource, 'utf8');
    if (bundleBytes < 1 || bundleBytes > MAX_BUNDLE_BYTES) {
      fail('BUNDLE_OUTPUT_LIMIT_EXCEEDED');
    }
    try {
      new vm.Script(bundleSource, { filename: 'utility_entry.js' });
    } catch {
      fail('BUNDLE_OUTPUT_INVALID');
    }
    const entry = sources.find((source) => (
      source.id === PORTABLE_ISOLATION_HELPER_BUNDLE_ENTRY_MODULE_ID
    ));
    if (!entry) fail('BUNDLE_OUTPUT_INVALID');
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_BUNDLE_RESULT_VERSION,
      entryModuleId: PORTABLE_ISOLATION_HELPER_BUNDLE_ENTRY_MODULE_ID,
      moduleIds: PORTABLE_ISOLATION_HELPER_BUNDLE_MODULE_IDS,
      entrySourceDigest: entry.digest,
      sourceIdentityDigest,
      bundleDigest: sha256(Buffer.from(bundleSource, 'utf8')),
      bundleBytes,
      bundleSource,
    });
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_BUNDLE_BUILDER_VERSION,
    build,
  });
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_BUNDLE_BUILDER_VERSION,
  PORTABLE_ISOLATION_HELPER_BUNDLE_ENTRY_MODULE_ID,
  PORTABLE_ISOLATION_HELPER_BUNDLE_MODULE_IDS,
  PortableIsolationHelperBundleBuilderError,
  createPortableIsolationHelperBundleBuilder,
};
