'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  PROJECT_CAPABILITY_EFFECTS,
  PROJECT_CAPABILITY_KINDS,
  createProjectCapabilityDescriptor,
  createProjectCapabilityRequest,
} = require('../capabilities/project_capability_contracts');
const {
  CapabilityEffectClassifier,
} = require('../capabilities/capability_effect_classifier');
const {
  CapabilityPolicyService,
} = require('../capabilities/capability_policy_service');
const {
  createProjectCapabilityBroker,
} = require('../capabilities/project_capability_broker');
const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  MAX_READ_BYTES,
  PROJECT_ROOT_ENTRY_KINDS,
  assertProjectRootEntryInspectionResult,
  assertProjectRootListResult,
  assertProjectRootReadFileResult,
  assertProjectRootReader,
  createProjectRootEntryInspectionRequest,
  createProjectRootListRequest,
  createProjectRootReadFileRequest,
} = require('../capabilities/project_root_authority_contract');
const {
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');

const AGENTIC_DOMAIN_READ_BROKER_FACTORY_VERSION =
  'agentic-domain-read-broker-factory.v1';
const AGENTIC_DOMAIN_READ_ROUTE_VERSION = 'agentic-domain-read-route.v1';
const AGENTIC_DOMAIN_READ_DESCRIPTOR_VERSION = 'agentic-domain-read-descriptor.v1';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_CAPABILITY_COMPONENT = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_TREE_ENTRIES = 2_000;
const MAX_DIRECTORY_ENTRIES = 4_096;
const MAX_PUBLIC_READ_BYTES = 1024 * 1024;
const MAX_RELATIVE_PATH_BYTES = 4_096;
const DOMAIN_DOCUMENT_MAX_BYTES = MAX_READ_BYTES;
const BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'audit',
  'now',
  'requestIdFactory',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
]);
const CREATE_KEYS = Object.freeze(['binding', 'projectRootReader']);
const ROUTE_INPUT_KEYS = Object.freeze(['capability', 'action', 'payload']);
const ROUTE_CAPABILITIES = Object.freeze([
  'filesystem.project_tree',
  'filesystem.read_file',
  'application_map.read',
  'milestones.read',
]);
const PROTECTED_PATH_SEGMENTS = new Set([
  '.agents',
  '.aws',
  '.claude',
  '.codex',
  '.cursor',
  '.faber',
  '.git',
  '.gnupg',
  '.ssh',
  'credentials',
  'private_context',
]);
const PROTECTED_BASENAMES = new Set([
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.yarnrc',
  '.yarnrc.yml',
  '_netrc',
]);

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
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function dataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (error) {
    preflightDataGraph(error);
    return undefined;
  }
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function captureFrozenOwnMethod(receiver, methodName, fieldName) {
  if (!receiver || typeof receiver !== 'object' || util.types.isProxy(receiver)
    || !Object.isFrozen(receiver)) {
    throw new TypeError(`${fieldName} must be a frozen trusted object`);
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(receiver, methodName);
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError(`${fieldName}.${methodName} is invalid`);
  }
  if (!descriptor || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) {
    throw new TypeError(`${fieldName}.${methodName} must be an own data method`);
  }
  return Object.freeze({ receiver, method: descriptor.value });
}

function sameBinding(left, right) {
  return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function normalizeLifecycleAuthorization(raw, expectedBinding) {
  if (util.types.isPromise(raw) || !raw || typeof raw !== 'object'
    || Array.isArray(raw) || util.types.isProxy(raw)
    || dataValue(raw, 'authorized') !== true) return null;
  try {
    const authorizedBinding = createCapabilityDelegationBinding(dataValue(raw, 'binding'));
    return sameBinding(authorizedBinding, expectedBinding) ? authorizedBinding : null;
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
}

function normalizeRootAuthorization(raw, expectedBinding) {
  if (util.types.isPromise(raw) || !raw || typeof raw !== 'object'
    || Array.isArray(raw) || util.types.isProxy(raw)
    || dataValue(raw, 'authorized') !== true
    || (Object.hasOwn(raw, 'ok') && dataValue(raw, 'ok') !== true)
    || dataValue(raw, 'projectId') !== expectedBinding.projectId) return null;
  const canonicalRootPath = dataValue(raw, 'canonicalRootPath') || dataValue(raw, 'rootPath');
  if (canonicalRootPath !== expectedBinding.canonicalRootPath
    || dataValue(raw, 'realRootPath') !== expectedBinding.realRootPath) return null;
  return Object.freeze({
    authorized: true,
    projectId: expectedBinding.projectId,
    rootPath: expectedBinding.canonicalRootPath,
    canonicalRootPath: expectedBinding.canonicalRootPath,
    realRootPath: expectedBinding.realRootPath,
  });
}

function sessionMatchesBinding(session, binding) {
  return Boolean(session) && typeof session === 'object' && !Array.isArray(session)
    && !util.types.isProxy(session)
    && dataValue(session, 'projectId') === binding.projectId
    && dataValue(session, 'sessionId') === binding.sessionId
    && dataValue(session, 'jobId') === binding.jobId
    && dataValue(session, 'rootPath') === binding.canonicalRootPath
    && dataValue(session, 'realRootPath') === binding.realRootPath;
}

function normalizedRelativePath(value, fieldName) {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || value.includes('\0') || value.includes('\\') || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
    || Buffer.byteLength(value, 'utf8') > MAX_RELATIVE_PATH_BYTES) {
    throw new TypeError(`${fieldName} must be a bounded POSIX relative path`);
  }
  const components = value.split('/');
  if (components.some((component) => !component || component === '.' || component === '..')) {
    throw new TypeError(`${fieldName} must be a normalized POSIX relative path`);
  }
  return components.join('/');
}

function isProtectedProjectPath(value) {
  const normalized = String(value || '').toLowerCase();
  const segments = normalized.split('/');
  const basename = segments[segments.length - 1] || '';
  return segments.some((segment) => PROTECTED_PATH_SEGMENTS.has(segment))
    || PROTECTED_BASENAMES.has(basename)
    || basename === '.env'
    || basename.startsWith('.env.')
    || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/.test(basename)
    || /\.(?:key|pem|p12|pfx|jks|keystore)$/.test(basename)
    || /(?:^|[-_.])(?:api[-_]?key|token)(?:[-_.]|$)/.test(basename)
    || /(?:secret|credential|private[-_]?key)/.test(basename);
}

function normalizeTreePayload(value) {
  const fields = exactOwnDataFields(value, ['maxEntries'], []);
  if (!fields) throw new TypeError('Project tree payload is invalid');
  const maxEntries = fields.has('maxEntries') ? fields.get('maxEntries') : 500;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1
    || maxEntries > MAX_TREE_ENTRIES || Object.is(maxEntries, -0)) {
    throw new TypeError('Project tree maxEntries is invalid');
  }
  return Object.freeze({ maxEntries });
}

function normalizeReadFilePayload(value) {
  const fields = exactOwnDataFields(value, ['path', 'maxBytes']);
  if (!fields) throw new TypeError('Project file read payload is invalid');
  const maxBytes = fields.get('maxBytes');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1
    || maxBytes > MAX_PUBLIC_READ_BYTES || Object.is(maxBytes, -0)) {
    throw new TypeError('Project file read maxBytes is invalid');
  }
  return Object.freeze({
    path: normalizedRelativePath(fields.get('path'), 'path'),
    maxBytes,
  });
}

function normalizeEmptyPayload(value, fieldName) {
  const fields = exactOwnDataFields(value, [], []);
  if (!fields) throw new TypeError(`${fieldName} payload must be empty`);
  return Object.freeze({});
}

function normalizeRouteInput(value) {
  const fields = exactOwnDataFields(value, ROUTE_INPUT_KEYS, ROUTE_INPUT_KEYS);
  if (!fields || !Object.isFrozen(value)) {
    throw new TypeError('Agentic domain read input is invalid');
  }
  const capability = fields.get('capability');
  const action = fields.get('action');
  const rawPayload = fields.get('payload');
  if (typeof capability !== 'string' || !SAFE_CAPABILITY_COMPONENT.test(capability)
    || typeof action !== 'string' || !SAFE_CAPABILITY_COMPONENT.test(action)
    || !Object.isFrozen(rawPayload)) {
    throw new TypeError('Agentic domain read route is invalid');
  }
  const key = `${capability}.${action}`;
  let payload;
  if (key === 'filesystem.project_tree') payload = normalizeTreePayload(rawPayload);
  else if (key === 'filesystem.read_file') payload = normalizeReadFilePayload(rawPayload);
  else if (key === 'application_map.read') {
    payload = normalizeEmptyPayload(rawPayload, 'Application Map read');
  } else if (key === 'milestones.read') {
    payload = normalizeEmptyPayload(rawPayload, 'Milestones read');
  } else {
    payload = normalizeEmptyPayload(rawPayload, 'Unsupported capability');
  }
  return Object.freeze({ capability, action, payload });
}

function observeNativeResult(raw, normalize, fieldName) {
  if (!util.types.isPromise(raw)) {
    try {
      return Promise.resolve(normalize(raw));
    } catch (error) {
      preflightDataGraph(error);
      return Promise.reject(new TypeError(`${fieldName} returned invalid data`));
    }
  }
  return new Promise((resolve, reject) => {
    const onFulfilled = (value) => {
      try {
        resolve(normalize(value));
      } catch (error) {
        preflightDataGraph(error);
        reject(new TypeError(`${fieldName} returned invalid data`));
      }
    };
    const onRejected = (error) => {
      preflightDataGraph(error);
      reject(new TypeError(`${fieldName} failed`));
    };
    try {
      Reflect.apply(Promise.prototype.then, raw, [onFulfilled, onRejected]);
    } catch (error) {
      preflightDataGraph(error);
      reject(new TypeError(`${fieldName} promise was invalid`));
    }
  });
}

function invokeCaptured(captured, input, normalize, fieldName) {
  let raw;
  try {
    raw = Reflect.apply(captured.method, captured.receiver, [input]);
  } catch (error) {
    preflightDataGraph(error);
    return Promise.reject(new TypeError(`${fieldName} failed`));
  }
  return observeNativeResult(raw, normalize, fieldName);
}

function decodeUtf8Prefix(bytes, allowTrailingTrim) {
  if (!Buffer.isBuffer(bytes) || bytes.includes(0)) return null;
  const maximumTrim = allowTrailingTrim ? Math.min(3, bytes.length) : 0;
  for (let trim = 0; trim <= maximumTrim; trim += 1) {
    const candidate = trim === 0 ? bytes : bytes.subarray(0, bytes.length - trim);
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(candidate);
      return Object.freeze({ content, returnedBytes: candidate.length });
    } catch {
      // A bounded read may end in the middle of one UTF-8 code point.
    }
  }
  return null;
}

function stableInspectionMatches(left, right) {
  return left.found === right.found
    && left.kind === right.kind
    && left.bytes === right.bytes
    && left.contentDigest === right.contentDigest
    && left.entryIdentityDigest === right.entryIdentityDigest;
}

function createAgenticDomainReadBrokerFactory(options = {}) {
  const optionFields = exactOwnDataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS);
  if (!optionFields) throw new TypeError('Invalid agentic domain read broker options');
  const authorizeLifecycle = optionFields.get('authorizeLifecycle');
  const authorizeRoot = optionFields.get('authorizeRoot');
  const authorizeEffectFrontier = optionFields.get('authorizeEffectFrontier');
  const audit = optionFields.has('audit') ? optionFields.get('audit') : () => {};
  const now = optionFields.has('now') ? optionFields.get('now') : () => Date.now();
  const requestIdFactory = optionFields.has('requestIdFactory')
    ? optionFields.get('requestIdFactory')
    : () => `agentic-domain-read:${crypto.randomUUID()}`;
  for (const [name, callback] of [
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeEffectFrontier', authorizeEffectFrontier],
    ['audit', audit],
    ['now', now],
    ['requestIdFactory', requestIdFactory],
  ]) {
    if (typeof callback !== 'function' || util.types.isProxy(callback)) {
      throw new TypeError(`${name} must be a trusted function`);
    }
  }

  let routesCreated = 0;
  let totalRequests = 0;

  function createRoute(input = {}) {
    const fields = exactOwnDataFields(input, CREATE_KEYS, CREATE_KEYS);
    if (!fields) throw new TypeError('Invalid agentic domain read route options');
    let binding;
    let reader;
    try {
      binding = createCapabilityDelegationBinding(fields.get('binding'));
      reader = assertProjectRootReader(fields.get('projectRootReader'));
    } catch (error) {
      preflightDataGraph(error);
      throw new TypeError('Agentic domain read route authority is invalid');
    }
    const rootList = captureFrozenOwnMethod(reader, 'list', 'projectRootReader');
    const rootReadFile = captureFrozenOwnMethod(reader, 'readFile', 'projectRootReader');
    const rootInspectEntry = captureFrozenOwnMethod(
      reader,
      'inspectEntry',
      'projectRootReader'
    );

    function rootAuthorization() {
      let raw;
      try {
        raw = authorizeRoot(Object.freeze({
          projectId: binding.projectId,
          rootPath: binding.canonicalRootPath,
        }));
      } catch (error) {
        preflightDataGraph(error);
        return null;
      }
      return normalizeRootAuthorization(raw, binding);
    }

    function lifecycleAuthorization() {
      let raw;
      try {
        raw = authorizeLifecycle(binding);
      } catch (error) {
        preflightDataGraph(error);
        return null;
      }
      return normalizeLifecycleAuthorization(raw, binding);
    }

    function authorizeSession(session) {
      if (!sessionMatchesBinding(session, binding)
        || !rootAuthorization() || !lifecycleAuthorization()) {
        return Object.freeze({ authorized: false });
      }
      return Object.freeze({ authorized: true, projectSession: session });
    }

    function authorizeEffect(session) {
      if (!sessionMatchesBinding(session, binding)
        || !rootAuthorization() || !lifecycleAuthorization()) {
        return Object.freeze({ authorized: false });
      }
      let raw;
      try {
        raw = authorizeEffectFrontier(binding);
      } catch (error) {
        preflightDataGraph(error);
        return Object.freeze({ authorized: false });
      }
      if (!normalizeLifecycleAuthorization(raw, binding)) {
        return Object.freeze({ authorized: false });
      }
      // The job-owned effect frontier is deliberately the final callback
      // before ProjectCapabilityBroker enters the captured root reader.
      return Object.freeze({ authorized: true, projectSession: session });
    }

    function listDirectory(relativePath) {
      const request = createProjectRootListRequest({
        relativePath,
        maxEntries: MAX_DIRECTORY_ENTRIES,
      });
      return invokeCaptured(
        rootList,
        request,
        (value) => assertProjectRootListResult(value, request),
        'projectRootReader.list'
      );
    }

    function inspectEntry(relativePath) {
      const request = createProjectRootEntryInspectionRequest({ relativePath });
      return invokeCaptured(
        rootInspectEntry,
        request,
        (value) => assertProjectRootEntryInspectionResult(value, request),
        'projectRootReader.inspectEntry'
      );
    }

    function readRootFile(relativePath, maxBytes) {
      const request = createProjectRootReadFileRequest({ relativePath, maxBytes });
      return invokeCaptured(
        rootReadFile,
        request,
        (value) => assertProjectRootReadFileResult(value, request),
        'projectRootReader.readFile'
      );
    }

    async function readProjectTree(payload) {
      const entries = [];
      const queue = [''];
      let truncated = false;
      while (queue.length > 0 && entries.length < payload.maxEntries) {
        const directory = queue.shift();
        const listing = await listDirectory(directory);
        if (listing.truncated) truncated = true;
        for (const entry of listing.entries) {
          const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
          if (isProtectedProjectPath(relativePath)) continue;
          if (entries.length >= payload.maxEntries) {
            truncated = true;
            break;
          }
          entries.push(Object.freeze({ path: relativePath, kind: entry.kind }));
          if (entry.kind === PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) queue.push(relativePath);
        }
      }
      if (queue.length > 0) truncated = true;
      return Object.freeze({
        ok: true,
        entries: Object.freeze(entries),
        truncated,
      });
    }

    function fileFailure(path, code, inspection = null) {
      return Object.freeze({
        ok: false,
        found: Boolean(inspection && inspection.found),
        code,
        path,
        revision: inspection && inspection.contentDigest
          ? inspection.contentDigest
          : null,
        bytes: inspection && Number.isSafeInteger(inspection.bytes)
          ? inspection.bytes
          : null,
        returnedBytes: 0,
        encoding: null,
        truncated: false,
        content: null,
      });
    }

    async function readPublicProjectFile(payload) {
      const before = await inspectEntry(payload.path);
      if (!before.found) return fileFailure(payload.path, 'PROJECT_FILE_NOT_FOUND');
      if (before.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE) {
        return fileFailure(payload.path, 'PROJECT_FILE_NOT_FILE', before);
      }
      const read = await readRootFile(payload.path, payload.maxBytes);
      const after = await inspectEntry(payload.path);
      if (!read.found || !stableInspectionMatches(before, after)) {
        return fileFailure(payload.path, 'PROJECT_FILE_CHANGED', after);
      }
      const bytes = Buffer.from(read.contentBase64, 'base64');
      const truncated = after.bytes > bytes.length;
      if (!truncated && read.contentDigest !== after.contentDigest) {
        return fileFailure(payload.path, 'PROJECT_FILE_CHANGED', after);
      }
      const decoded = decodeUtf8Prefix(bytes, truncated);
      if (!decoded) return fileFailure(payload.path, 'PROJECT_FILE_BINARY', after);
      return Object.freeze({
        ok: true,
        found: true,
        code: null,
        path: payload.path,
        revision: after.contentDigest,
        bytes: after.bytes,
        returnedBytes: decoded.returnedBytes,
        encoding: 'utf8',
        truncated,
        content: decoded.content,
      });
    }

    async function readDomainJson(relativePath) {
      const before = await inspectEntry(relativePath);
      if (!before.found) {
        return Object.freeze({ found: false, parsed: null, revision: null });
      }
      if (before.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE
        || before.bytes > DOMAIN_DOCUMENT_MAX_BYTES) {
        return Object.freeze({
          found: true,
          parsed: null,
          revision: before.contentDigest,
          code: before.bytes > DOMAIN_DOCUMENT_MAX_BYTES
            ? 'DOMAIN_DOCUMENT_TOO_LARGE'
            : 'DOMAIN_DOCUMENT_NOT_FILE',
        });
      }
      const read = await readRootFile(relativePath, Math.max(1, before.bytes));
      const after = await inspectEntry(relativePath);
      if (!read.found || !stableInspectionMatches(before, after)
        || read.contentDigest !== after.contentDigest) {
        return Object.freeze({
          found: true,
          parsed: null,
          revision: after.contentDigest,
          code: 'DOMAIN_DOCUMENT_CHANGED',
        });
      }
      const decoded = decodeUtf8Prefix(Buffer.from(read.contentBase64, 'base64'), false);
      if (!decoded) {
        return Object.freeze({
          found: true,
          parsed: null,
          revision: after.contentDigest,
          code: 'DOMAIN_DOCUMENT_INVALID_ENCODING',
        });
      }
      try {
        return Object.freeze({
          found: true,
          parsed: JSON.parse(decoded.content),
          revision: after.contentDigest,
        });
      } catch {
        return Object.freeze({
          found: true,
          parsed: null,
          revision: after.contentDigest,
          code: 'DOMAIN_DOCUMENT_INVALID_JSON',
        });
      }
    }

    async function readApplicationMap() {
      const snapshot = await readDomainJson('.faber/application-map.json');
      if (!snapshot.found) {
        return Object.freeze({
          ok: true,
          found: false,
          code: null,
          format: null,
          revision: null,
          map: null,
        });
      }
      const map = snapshot.parsed;
      if (snapshot.code || !map || typeof map !== 'object' || Array.isArray(map)
        || !Array.isArray(map.nodes) || !Array.isArray(map.edges)
        || !map.viewport || typeof map.viewport !== 'object'
        || Array.isArray(map.viewport)) {
        return Object.freeze({
          ok: false,
          found: true,
          code: snapshot.code || 'INVALID_APPLICATION_MAP',
          format: null,
          revision: snapshot.revision,
          map: null,
        });
      }
      const format = typeof map.schemaVersion === 'string' && map.schemaVersion
        ? map.schemaVersion
        : 'application-map-legacy';
      return Object.freeze({
        ok: true,
        found: true,
        code: null,
        format,
        revision: snapshot.revision,
        map,
      });
    }

    async function readMilestones() {
      const snapshot = await readDomainJson('.faber/milestones.json');
      if (!snapshot.found) {
        return Object.freeze({
          ok: true,
          found: false,
          code: null,
          format: null,
          revision: null,
          sourceMapRevision: null,
          renderedAt: null,
          milestones: Object.freeze([]),
        });
      }
      const parsed = snapshot.parsed;
      let format = null;
      let sourceMapRevision = null;
      let renderedAt = null;
      let milestones = null;
      if (Array.isArray(parsed)) {
        format = 'milestones-draft';
        milestones = parsed;
      } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && Array.isArray(parsed.milestones)) {
        format = typeof parsed.schemaVersion === 'string' && parsed.schemaVersion
          ? parsed.schemaVersion
          : 'milestones-rendered';
        sourceMapRevision = parsed.sourceMapRevision === undefined
          ? null
          : parsed.sourceMapRevision;
        renderedAt = typeof parsed.renderedAt === 'string' ? parsed.renderedAt : null;
        milestones = parsed.milestones;
      }
      if (snapshot.code || milestones === null) {
        return Object.freeze({
          ok: false,
          found: true,
          code: snapshot.code || 'INVALID_MILESTONES',
          format: null,
          revision: snapshot.revision,
          sourceMapRevision: null,
          renderedAt: null,
          milestones: Object.freeze([]),
        });
      }
      return Object.freeze({
        ok: true,
        found: true,
        code: null,
        format,
        revision: snapshot.revision,
        sourceMapRevision,
        renderedAt,
        milestones,
      });
    }

    const filesystemTreeDescriptor = createProjectCapabilityDescriptor({
      capability: 'filesystem',
      action: 'project_tree',
      version: AGENTIC_DOMAIN_READ_DESCRIPTOR_VERSION,
      kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
      effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ],
      risk: 'low',
      canonicalizePayload: normalizeTreePayload,
      adapter: Object.freeze({ execute: readProjectTree }),
    });
    const filesystemReadDescriptor = createProjectCapabilityDescriptor({
      capability: 'filesystem',
      action: 'read_file',
      version: AGENTIC_DOMAIN_READ_DESCRIPTOR_VERSION,
      kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
      effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ],
      risk: 'low',
      canonicalizePayload: normalizeReadFilePayload,
      classifyEffects(payload) {
        return isProtectedProjectPath(payload.path)
          ? Object.freeze({
            effects: Object.freeze([PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ]),
            hardDeny: true,
            hardDenyReason: 'PROTECTED_PROJECT_PATH',
          })
          : Object.freeze({
            effects: Object.freeze([PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ]),
          });
      },
      adapter: Object.freeze({ execute: readPublicProjectFile }),
    });
    const mapReadDescriptor = createProjectCapabilityDescriptor({
      capability: 'application_map',
      action: 'read',
      version: AGENTIC_DOMAIN_READ_DESCRIPTOR_VERSION,
      kind: PROJECT_CAPABILITY_KINDS.APPLICATION,
      effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ],
      risk: 'low',
      canonicalizePayload: (payload) => normalizeEmptyPayload(payload, 'Application Map read'),
      adapter: Object.freeze({ execute: readApplicationMap }),
    });
    const milestoneReadDescriptor = createProjectCapabilityDescriptor({
      capability: 'milestones',
      action: 'read',
      version: AGENTIC_DOMAIN_READ_DESCRIPTOR_VERSION,
      kind: PROJECT_CAPABILITY_KINDS.APPLICATION,
      effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ],
      risk: 'low',
      canonicalizePayload: (payload) => normalizeEmptyPayload(payload, 'Milestones read'),
      adapter: Object.freeze({ execute: readMilestones }),
    });
    const descriptors = Object.freeze({
      'filesystem.project_tree': filesystemTreeDescriptor,
      'filesystem.read_file': filesystemReadDescriptor,
      'application_map.read': mapReadDescriptor,
      'milestones.read': milestoneReadDescriptor,
    });
    const broker = createProjectCapabilityBroker({
      authorizeProjectSession: authorizeSession,
      authorizeProjectEffect: authorizeEffect,
      descriptorResolver: Object.freeze({
        resolve(capability, action) {
          return descriptors[`${capability}.${action}`] || null;
        },
      }),
      classifier: new CapabilityEffectClassifier(),
      policy: new CapabilityPolicyService(),
      grantStore: Object.freeze({
        inspect() { return Object.freeze({ authorized: false, reason: 'grant_not_required' }); },
        consume() { return Object.freeze({ authorized: false, reason: 'grant_not_required' }); },
      }),
      pendingApprovalStore: Object.freeze({
        create() { throw new Error('Read-only domain capabilities must not request approval'); },
        resolve() { throw new Error('Read-only domain capabilities have no pending approval'); },
      }),
      approvalReviewer: Object.freeze({
        verifyDecision() { return Object.freeze({ verified: false }); },
      }),
      sandboxRegistry: Object.freeze({
        select() { throw new Error('Read-only domain capabilities must not select a process sandbox'); },
      }),
      buildSandboxEnvironment() {
        throw new Error('Read-only domain capabilities must not build a process environment');
      },
      audit: Object.freeze({ record(event) { return audit(event); } }),
      now,
    });
    let requests = 0;
    let completed = 0;
    let denied = 0;
    let failed = 0;

    async function execute(rawInput) {
      const normalized = normalizeRouteInput(rawInput);
      let requestId;
      try {
        requestId = requestIdFactory();
      } catch (error) {
        preflightDataGraph(error);
        throw new TypeError('Agentic domain read request id generation failed');
      }
      if (util.types.isPromise(requestId) || typeof requestId !== 'string'
        || !REQUEST_ID_PATTERN.test(requestId)) {
        preflightDataGraph(requestId);
        throw new TypeError('Agentic domain read request id is invalid');
      }
      requests += 1;
      totalRequests += 1;
      const capabilityRequest = createProjectCapabilityRequest({
        requestId,
        principal: Object.freeze({ kind: 'agent', kernelId: binding.kernelId }),
        projectSession: Object.freeze({
          sessionId: binding.sessionId,
          projectId: binding.projectId,
          rootPath: binding.canonicalRootPath,
          realRootPath: binding.realRootPath,
          jobId: binding.jobId,
        }),
        capability: normalized.capability,
        action: normalized.action,
        payload: normalized.payload,
        context: Object.freeze({
          origin: 'agentic_tool_loop',
          correlationId: binding.jobId,
        }),
      });
      const result = await broker.execute(capabilityRequest);
      if (result.status === 'completed') completed += 1;
      else if (result.status === 'denied') denied += 1;
      else if (result.status === 'failed') failed += 1;
      return result;
    }

    function diagnostics() {
      return Object.freeze({
        version: AGENTIC_DOMAIN_READ_ROUTE_VERSION,
        requests,
        completed,
        denied,
        failed,
        capabilities: ROUTE_CAPABILITIES,
        authorityBoundary: 'job_binding',
      });
    }

    routesCreated += 1;
    return Object.freeze({
      version: AGENTIC_DOMAIN_READ_ROUTE_VERSION,
      execute,
      diagnostics,
    });
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_DOMAIN_READ_BROKER_FACTORY_VERSION,
      routesCreated,
      totalRequests,
      capabilities: ROUTE_CAPABILITIES,
      authorityBoundary: 'main_process_only',
    });
  }

  return Object.freeze({ createRoute, diagnostics });
}

module.exports = {
  AGENTIC_DOMAIN_READ_BROKER_FACTORY_VERSION,
  AGENTIC_DOMAIN_READ_DESCRIPTOR_VERSION,
  AGENTIC_DOMAIN_READ_ROUTE_VERSION,
  createAgenticDomainReadBrokerFactory,
};
