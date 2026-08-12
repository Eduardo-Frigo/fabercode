'use strict';

const ASSISTANT_PLANNING_AUTHORIZER_VERSION = 'assistant-planning-authorizer.v1';
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const INTERNAL_HINT_KEYS = new Set([
  'actionDigest',
  'approvalId',
  'approvalProof',
  'authorityContext',
  'binding',
  'canonicalRootPath',
  'consentHandle',
  'decisionId',
  'delegationId',
  'grantId',
  'jobId',
  'kernelId',
  'personaApprovedExecution',
  'personaRouteDecision',
  'physicalRootIdentity',
  'productRouteDecision',
  'realRootPath',
  'requestDigest',
  'sessionId',
  'submissionDigest',
  'submissionId',
]);
const PROJECT_PRIVATE_KEYS = new Set([
  'authorized',
  'canonicalRootPath',
  'physicalRootIdentity',
  'realRootPath',
]);

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataEntries(value, fieldName) {
  const arrayValue = Array.isArray(value);
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (arrayValue && key === 'length') continue;
    if (typeof key !== 'string') throw new TypeError(`${fieldName} must not contain symbols`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain enumerable data properties only`);
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function dataFields(value, fieldName) {
  if (!isPlainRecord(value)) throw new TypeError(`${fieldName} must be a plain data record`);
  return new Map(ownDataEntries(value, fieldName));
}

function snapshotJson(
  value,
  { stripKeys = null, maxDepth = 32, maxNodes = 50_000, maxStringBytes = 2 * 1024 * 1024 } = {},
  state = { nodes: 0, stringBytes: 0, seen: new Set() },
  depth = 0,
) {
  if (depth > maxDepth) throw new TypeError('Planning payload exceeds depth limit');
  state.nodes += 1;
  if (state.nodes > maxNodes) throw new TypeError('Planning payload exceeds node limit');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new TypeError('Planning payload contains NUL');
    state.stringBytes += Buffer.byteLength(value, 'utf8');
    if (state.stringBytes > maxStringBytes) throw new TypeError('Planning payload exceeds string limit');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('Invalid numeric payload');
    return value;
  }
  if (!value || typeof value !== 'object') throw new TypeError('Planning payload must be JSON-safe');
  if (state.seen.has(value)) throw new TypeError('Planning payload must not contain cycles');
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = ownDataEntries(value, 'planning payload array');
      if (entries.length !== value.length || entries.some(([key], index) => key !== String(index))) {
        throw new TypeError('Planning payload arrays must be dense');
      }
      return Object.freeze(entries.map(([, entry]) => snapshotJson(
        entry,
        { stripKeys, maxDepth, maxNodes, maxStringBytes },
        state,
        depth + 1,
      )));
    }
    const entries = ownDataEntries(value, 'planning payload object');
    if (!isPlainRecord(value)) throw new TypeError('Planning payload objects must be plain');
    const output = Object.create(null);
    for (const [key, entry] of entries) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError('Planning payload contains a forbidden key');
      if (stripKeys && stripKeys.has(key)) continue;
      output[key] = snapshotJson(
        entry,
        { stripKeys, maxDepth, maxNodes, maxStringBytes },
        state,
        depth + 1,
      );
    }
    return Object.freeze(output);
  } finally {
    state.seen.delete(value);
  }
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) output[key] = clonePlain(entry);
  return output;
}

function freezeJsonSnapshot(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    freezeJsonSnapshot(entry);
  }
  return Object.freeze(value);
}

function normalizeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.includes('\0')) {
    throw new TypeError(`${fieldName} is invalid`);
  }
  return value;
}

function deny(message = 'Projeto não autorizado para o assistente.') {
  return Object.freeze({ ok: false, code: 'assistant_project_not_authorized', message });
}

function createAssistantPlanningAuthorizer(options = {}) {
  const fields = dataFields(options, 'assistant planning authorizer options');
  const authorizeProjectBinding = fields.get('authorizeProjectBinding');
  const authorizeProjectRootBinding = fields.get('authorizeProjectRootBinding');
  const normalizeProjectInfo = fields.get('normalizeProjectInfo');
  for (const [name, callback] of [
    ['authorizeProjectBinding', authorizeProjectBinding],
    ['authorizeProjectRootBinding', authorizeProjectRootBinding],
    ['normalizeProjectInfo', normalizeProjectInfo],
  ]) {
    if (typeof callback !== 'function') throw new TypeError(`${name} is required`);
  }

  function authorize(input = {}) {
    try {
      const inputFields = dataFields(input, 'planning authorization input');
      if (inputFields.size !== 2 || !inputFields.has('operation') || !inputFields.has('payload')) {
        throw new TypeError('Planning authorization input is invalid');
      }
      const operation = inputFields.get('operation');
      if (!['plan', 'message', 'map_message'].includes(operation)) {
        throw new TypeError('Planning operation is invalid');
      }
      const rawPayload = snapshotJson(inputFields.get('payload'));
      const payloadFields = dataFields(rawPayload, 'planning payload');
      const rawProject = payloadFields.get('projectInfo');
      const projectFields = dataFields(rawProject, 'planning projectInfo');
      const rootPath = normalizeIdentifier(projectFields.get('rootPath'), 'projectInfo.rootPath');

      const ids = ['id', 'projectId']
        .filter((key) => projectFields.has(key))
        .map((key) => normalizeIdentifier(projectFields.get(key), `projectInfo.${key}`));
      if (ids.length > 1 && ids.some((id) => id !== ids[0])) {
        throw new TypeError('Project identifiers conflict');
      }
      let binding;
      if (ids.length) {
        binding = authorizeProjectBinding(ids[0], rootPath);
      } else {
        binding = authorizeProjectRootBinding(rootPath);
      }
      if (!binding || typeof binding.then === 'function') return deny();
      const bindingFields = dataFields(binding, 'project binding authorization');
      if (bindingFields.get('ok') !== true || bindingFields.get('authorized') !== true) {
        return deny(bindingFields.has('message') ? bindingFields.get('message') : undefined);
      }
      const projectId = normalizeIdentifier(bindingFields.get('projectId'), 'authorized projectId');
      const canonicalRootPath = normalizeIdentifier(
        bindingFields.get('canonicalRootPath'),
        'authorized canonicalRootPath',
      );

      const candidateProject = clonePlain(snapshotJson(rawProject, { stripKeys: PROJECT_PRIVATE_KEYS }));
      candidateProject.id = projectId;
      candidateProject.projectId = projectId;
      candidateProject.rootPath = canonicalRootPath;
      const normalized = normalizeProjectInfo(candidateProject, { requireProjectBinding: true });
      if (!normalized || typeof normalized.then === 'function') return deny();
      const normalizedFields = dataFields(normalized, 'normalized project result');
      if (normalizedFields.get('ok') !== true) {
        return deny(normalizedFields.has('message') ? normalizedFields.get('message') : undefined);
      }
      const normalizedProject = snapshotJson(normalizedFields.get('projectInfo'));
      const normalizedProjectFields = dataFields(normalizedProject, 'normalized projectInfo');
      if (normalizedProjectFields.get('id') !== projectId
        || normalizedProjectFields.get('projectId') !== projectId
        || normalizedProjectFields.get('rootPath') !== canonicalRootPath) {
        return deny('O vínculo do projeto mudou durante a autorização.');
      }

      const safePayload = clonePlain(snapshotJson(rawPayload, { stripKeys: INTERNAL_HINT_KEYS }));
      safePayload.projectInfo = clonePlain(normalizedProject);
      return Object.freeze({ ok: true, payload: freezeJsonSnapshot(safePayload) });
    } catch {
      return deny();
    }
  }

  return Object.freeze({ authorize });
}

module.exports = {
  ASSISTANT_PLANNING_AUTHORIZER_VERSION,
  createAssistantPlanningAuthorizer,
};
