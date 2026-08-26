'use strict';

const util = require('util');

const MAP_CHAT_PROPOSAL_SERVICE_VERSION = 'map-chat-proposal-service.v1';
const APPLICATION_MAP_PATCH_SCHEMA_VERSION = 'application-map-patch.v1';
const MILESTONE_PATCH_SCHEMA_VERSION = 'milestone-replacement-patch.v1';
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MILESTONE_STATUSES = new Set([
  'planned',
  'ready',
  'active',
  'blocked',
]);
const TASK_STATUSES = new Set([
  'pending',
  'active',
  'blocked',
  'done',
]);

const MAP_CHAT_PROPOSAL_SERVICE_REASONS = Object.freeze({
  APPLY_FAILED: 'MAP_CHAT_PROPOSAL_APPLY_FAILED',
  CONTEXT_UNAVAILABLE: 'MAP_CHAT_PROPOSAL_CONTEXT_UNAVAILABLE',
  CONVERSATION_FORBIDDEN: 'MAP_CHAT_PROPOSAL_CONVERSATION_FORBIDDEN',
  CONVERSATION_NOT_FOUND: 'MAP_CHAT_PROPOSAL_CONVERSATION_NOT_FOUND',
  INVALID_INPUT: 'MAP_CHAT_PROPOSAL_INVALID_INPUT',
  PROJECT_NOT_AUTHORIZED: 'MAP_CHAT_PROPOSAL_PROJECT_NOT_AUTHORIZED',
  PROPOSAL_FORBIDDEN: 'MAP_CHAT_PROPOSAL_FORBIDDEN',
  STALE_BASE: 'MAP_CHAT_PROPOSAL_STALE_BASE',
  STORE_FAILED: 'MAP_CHAT_PROPOSAL_STORE_FAILED',
});

const OPTION_KEYS = Object.freeze([
  'applicationMapService',
  'authorizeProjectBinding',
  'conversationStore',
  'milestoneService',
  'proposalStore',
]);
const MILESTONE_PREVIEW_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'conversationId',
  'milestones',
]);
const APPLICATION_MAP_PREVIEW_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'conversationId',
  'operations',
]);
const DECISION_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'conversationId',
  'proposalId',
  'expectedRevision',
  'patchDigest',
]);

function deny(code) {
  return Object.freeze({ ok: false, code });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, expectedKeys = null) {
  if (!isPlainRecord(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.some((key) => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))
    || (expectedKeys && (keys.length !== expectedKeys.length
      || keys.some((key) => !expectedKeys.includes(key))
      || expectedKeys.some((key) => !keys.includes(key))))) return null;
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function freezeJsonSnapshot(
  value,
  state = { depth: 0, nodes: 0, stringChars: 0, seen: new Set() },
) {
  state.nodes += 1;
  if (state.nodes > 100_000 || state.depth > 48) {
    throw new TypeError('proposal data exceeds structural bounds');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('proposal numbers must be finite');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new TypeError('proposal strings must not contain NUL');
    state.stringChars += value.length;
    if (state.stringChars > 4_000_000) throw new TypeError('proposal text exceeds bounds');
    return value;
  }
  if (!value || typeof value !== 'object' || util.types.isProxy(value)
    || util.types.isPromise(value) || state.seen.has(value)) {
    throw new TypeError('proposal data must be acyclic JSON');
  }
  state.seen.add(value);
  state.depth += 1;
  try {
    let output;
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 20_000) {
        throw new TypeError('proposal arrays must be bounded');
      }
      const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
        throw new TypeError('proposal arrays must be dense');
      }
      output = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('proposal arrays must contain data properties');
        }
        return freezeJsonSnapshot(descriptor.value, state);
      });
    } else {
      const fields = dataFields(value);
      if (!fields || fields.size > 20_000) throw new TypeError('proposal objects are invalid');
      output = {};
      for (const [key, child] of fields) {
        Object.defineProperty(output, key, {
          enumerable: true,
          value: freezeJsonSnapshot(child, state),
        });
      }
    }
    return Object.freeze(output);
  } finally {
    state.depth -= 1;
    state.seen.delete(value);
  }
}

function denseArray(value, fieldName, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum) {
    throw new TypeError(fieldName + ' must be a bounded array');
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(fieldName + ' must be dense');
  }
  return keys.map((key) => value[key]);
}

function safeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(fieldName + ' must be a safe identifier');
  }
  return value;
}

function boundedText(value, fieldName, maximum = 32_768, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > maximum) {
    throw new TypeError(fieldName + ' must be bounded text');
  }
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new TypeError(fieldName + ' must not be empty');
  return normalized;
}

function projectAbsolutePath(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.includes('\0')
    || value.length > 32_768 || value === '/' || /^[A-Za-z]:[\\/]?$/.test(value)) {
    throw new TypeError('rootPath must be a project absolute path');
  }
  if (!value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value)
    && !/^\\\\[^\\]/.test(value)) {
    throw new TypeError('rootPath must be a project absolute path');
  }
  return value;
}

function safeDigest(value, fieldName, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !SAFE_DIGEST.test(value)) {
    throw new TypeError(fieldName + ' must be a digest');
  }
  return value;
}

function captureCallback(callback, fieldName) {
  if (typeof callback !== 'function' || util.types.isProxy(callback)
    || util.types.isAsyncFunction(callback) || util.types.isGeneratorFunction(callback)) {
    throw new TypeError(fieldName + ' must be a synchronous function');
  }
  return callback;
}

function captureOwnMethod(receiver, methodName, fieldName) {
  if (!receiver || typeof receiver !== 'object' || util.types.isProxy(receiver)) {
    throw new TypeError(fieldName + ' must be a trusted object');
  }
  const descriptor = Object.getOwnPropertyDescriptor(receiver, methodName);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function' || util.types.isProxy(descriptor.value)
    || util.types.isAsyncFunction(descriptor.value)
    || util.types.isGeneratorFunction(descriptor.value)) {
    throw new TypeError(fieldName + '.' + methodName + ' must be a synchronous own method');
  }
  return Object.freeze({ receiver, method: descriptor.value });
}

function callSync(port, args, fieldName) {
  let result;
  try {
    result = Reflect.apply(port.method, port.receiver, args);
  } catch {
    throw new TypeError(fieldName + ' failed');
  }
  if (result && typeof result.then === 'function') {
    if (util.types.isPromise(result)) {
      try { Reflect.apply(Promise.prototype.then, result, [() => {}, () => {}]); } catch {}
    }
    throw new TypeError(fieldName + ' must remain synchronous');
  }
  return result;
}

function callAuthorization(callback, projectId, rootPath) {
  let result;
  try {
    result = Reflect.apply(callback, undefined, [projectId, rootPath]);
  } catch {
    return null;
  }
  if (result && typeof result.then === 'function') return null;
  const fields = dataFields(result);
  if (!fields || fields.get('ok') !== true || fields.get('authorized') !== true
    || fields.get('projectId') !== projectId || fields.get('rootPath') !== rootPath
    || fields.get('canonicalRootPath') !== rootPath) return null;
  return Object.freeze({ projectId, rootPath });
}

function normalizeMilestones(raw) {
  const snapshot = freezeJsonSnapshot(raw);
  const milestones = denseArray(snapshot, 'milestones', 100);
  if (!milestones.length) throw new TypeError('milestones must not be empty');
  let activeCount = 0;
  for (const milestone of milestones) {
    const fields = dataFields(milestone);
    if (!fields) throw new TypeError('milestone must be a plain record');
    safeIdentifier(fields.get('id'), 'milestone id');
    if (!Number.isSafeInteger(fields.get('number')) || fields.get('number') < 1) {
      throw new TypeError('milestone number is invalid');
    }
    boundedText(fields.get('title'), 'milestone title', 1_024);
    if (!MILESTONE_STATUSES.has(fields.get('status'))) {
      throw new TypeError('milestone status is invalid');
    }
    if (fields.get('status') === 'active') activeCount += 1;
    if (fields.has('startedAt') || fields.has('completedAt')
      || fields.has('completionEvidence')) {
      throw new TypeError('proposed milestones must not claim lifecycle evidence');
    }
    const tasks = denseArray(fields.get('tasks'), 'milestone tasks', 500);
    for (const task of tasks) {
      const taskFields = dataFields(task);
      if (!taskFields) throw new TypeError('task must be a plain record');
      safeIdentifier(taskFields.get('id'), 'task id');
      boundedText(taskFields.get('title'), 'task title', 4_096);
      if (!TASK_STATUSES.has(taskFields.get('status'))) {
        throw new TypeError('task status is invalid');
      }
    }
    if (fields.has('references')) {
      for (const reference of denseArray(fields.get('references'), 'milestone references', 500)) {
        const referenceFields = dataFields(reference);
        if (!referenceFields || !referenceFields.has('path')) {
          throw new TypeError('milestone reference is invalid');
        }
        boundedText(referenceFields.get('path'), 'milestone reference path', 32_768);
      }
    }
    if (fields.has('commits')
      && denseArray(fields.get('commits'), 'milestone commits', 0).length !== 0) {
      throw new TypeError('proposed milestones must not claim commits');
    }
  }
  if (activeCount > 1) throw new TypeError('multiple active milestones are invalid');
  return snapshot;
}

function normalizePreviewInput(value) {
  try {
    const fields = dataFields(value, MILESTONE_PREVIEW_KEYS);
    if (!fields) return null;
    return Object.freeze({
      projectId: safeIdentifier(fields.get('projectId'), 'projectId'),
      rootPath: projectAbsolutePath(fields.get('rootPath')),
      conversationId: safeIdentifier(fields.get('conversationId'), 'conversationId'),
      milestones: normalizeMilestones(fields.get('milestones')),
    });
  } catch {
    return null;
  }
}

function normalizeApplicationMapProposalOperations(raw) {
  const snapshot = freezeJsonSnapshot(raw);
  const operations = denseArray(snapshot, 'application map operations', 500);
  if (!operations.length) throw new TypeError('application map operations must not be empty');
  for (const operation of operations) {
    const operationFields = dataFields(operation);
    if (!operationFields || typeof operationFields.get('kind') !== 'string') {
      throw new TypeError('application map operation is invalid');
    }
    const kind = operationFields.get('kind');
    if (kind === 'upsert_node') {
      const fields = dataFields(operation, ['kind', 'node']);
      const nodeFields = fields && dataFields(fields.get('node'));
      if (!fields || !nodeFields || !nodeFields.has('id')) {
        throw new TypeError('upsert_node is invalid');
      }
      safeIdentifier(nodeFields.get('id'), 'node id');
      if (nodeFields.has('parentId') && nodeFields.get('parentId') !== null) {
        safeIdentifier(nodeFields.get('parentId'), 'node parentId');
      }
    } else if (kind === 'remove_node') {
      const fields = dataFields(operation, ['kind', 'nodeId']);
      if (!fields) throw new TypeError('remove_node is invalid');
      safeIdentifier(fields.get('nodeId'), 'nodeId');
    } else if (kind === 'upsert_edge') {
      const fields = dataFields(operation, ['edge', 'kind']);
      const edgeFields = fields && dataFields(fields.get('edge'));
      if (!fields || !edgeFields) throw new TypeError('upsert_edge is invalid');
      safeIdentifier(edgeFields.get('id'), 'edge id');
      safeIdentifier(edgeFields.get('sourceNodeId'), 'edge sourceNodeId');
      safeIdentifier(edgeFields.get('targetNodeId'), 'edge targetNodeId');
    } else if (kind === 'remove_edge') {
      const fields = dataFields(operation, ['edgeId', 'kind']);
      if (!fields) throw new TypeError('remove_edge is invalid');
      safeIdentifier(fields.get('edgeId'), 'edgeId');
    } else if (kind === 'set_viewport') {
      const fields = dataFields(operation, ['kind', 'viewport']);
      const viewportFields = fields && dataFields(fields.get('viewport'), ['x', 'y', 'zoom']);
      if (!fields || !viewportFields
        || !Number.isFinite(viewportFields.get('x'))
        || !Number.isFinite(viewportFields.get('y'))
        || !Number.isFinite(viewportFields.get('zoom'))
        || viewportFields.get('zoom') < 0.05
        || viewportFields.get('zoom') > 16) {
        throw new TypeError('set_viewport is invalid');
      }
    } else {
      throw new TypeError('unsupported application map operation');
    }
  }
  return snapshot;
}

function normalizeApplicationMapPreviewInput(value) {
  try {
    const fields = dataFields(value, APPLICATION_MAP_PREVIEW_KEYS);
    if (!fields) return null;
    return Object.freeze({
      projectId: safeIdentifier(fields.get('projectId'), 'projectId'),
      rootPath: projectAbsolutePath(fields.get('rootPath')),
      conversationId: safeIdentifier(fields.get('conversationId'), 'conversationId'),
      operations: normalizeApplicationMapProposalOperations(fields.get('operations')),
    });
  } catch {
    return null;
  }
}

function normalizeDecisionInput(value) {
  try {
    const fields = dataFields(value, DECISION_KEYS);
    if (!fields) return null;
    const expectedRevision = fields.get('expectedRevision');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return null;
    return Object.freeze({
      projectId: safeIdentifier(fields.get('projectId'), 'projectId'),
      rootPath: projectAbsolutePath(fields.get('rootPath')),
      conversationId: safeIdentifier(fields.get('conversationId'), 'conversationId'),
      proposalId: safeIdentifier(fields.get('proposalId'), 'proposalId'),
      expectedRevision,
      patchDigest: safeDigest(fields.get('patchDigest'), 'patchDigest'),
    });
  } catch {
    return null;
  }
}

function conversationState(rawState, projectId, conversationId, expectedSource) {
  try {
    const snapshot = freezeJsonSnapshot(rawState);
    const stateFields = dataFields(snapshot);
    const byProject = dataFields(stateFields.get('conversationsByProject'));
    const bucket = byProject.has(projectId) ? byProject.get(projectId) : [];
    const matches = denseArray(bucket, 'project conversations', 120)
      .filter((entry) => {
        const fields = dataFields(entry);
        return fields && fields.get('id') === conversationId;
      });
    if (matches.length !== 1) return 'not_found';
    return dataFields(matches[0]).get('source') === expectedSource ? 'allowed' : 'forbidden';
  } catch {
    return 'forbidden';
  }
}

function normalizeSnapshotDigest(raw, fieldName) {
  try {
    const snapshot = freezeJsonSnapshot(raw);
    const fields = dataFields(snapshot);
    if (!fields || fields.get('ok') !== true || typeof fields.get('found') !== 'boolean') {
      return undefined;
    }
    const digest = fields.get('contentDigest');
    if (!fields.get('found')) return digest === null ? null : undefined;
    return safeDigest(digest, fieldName + ' contentDigest');
  } catch {
    return undefined;
  }
}

function normalizeStoreResult(raw) {
  try {
    const snapshot = freezeJsonSnapshot(raw);
    const fields = dataFields(snapshot);
    if (!fields || typeof fields.get('ok') !== 'boolean') return null;
    if (fields.get('ok') === false) {
      return deny(safeIdentifier(fields.get('code'), 'store code'));
    }
    const proposal = fields.get('proposal');
    const proposalFields = dataFields(proposal);
    if (!proposalFields
      || !['map_render', 'map_chat'].includes(proposalFields.get('surface'))
      || !['milestones', 'application_map'].includes(proposalFields.get('target'))) return null;
    safeIdentifier(proposalFields.get('proposalId'), 'proposalId');
    safeIdentifier(proposalFields.get('projectId'), 'projectId');
    safeIdentifier(proposalFields.get('conversationId'), 'conversationId');
    projectAbsolutePath(proposalFields.get('rootPath'));
    safeDigest(proposalFields.get('baseDigest'), 'baseDigest', { nullable: true });
    safeDigest(proposalFields.get('patchDigest'), 'patchDigest');
    if (!Number.isSafeInteger(proposalFields.get('revision'))
      || proposalFields.get('revision') < 1) return null;
    return Object.freeze({ ok: true, proposal });
  } catch {
    return null;
  }
}

function proposalContract(proposal) {
  const fields = dataFields(proposal);
  if (!fields) return null;
  if (fields.get('surface') === 'map_render' && fields.get('target') === 'milestones') {
    return Object.freeze({
      expectedSource: 'map_render',
      target: 'milestones',
    });
  }
  if (fields.get('surface') === 'map_chat' && fields.get('target') === 'application_map') {
    return Object.freeze({
      expectedSource: 'map_chat',
      target: 'application_map',
    });
  }
  return null;
}

function proposalMatchesBinding(proposal, input) {
  const fields = dataFields(proposal);
  return Boolean(fields
    && fields.get('projectId') === input.projectId
    && fields.get('rootPath') === input.rootPath
    && fields.get('conversationId') === input.conversationId);
}

function normalizeApplyResult(raw, fallbackCode) {
  try {
    const snapshot = freezeJsonSnapshot(raw);
    const fields = dataFields(snapshot);
    if (!fields || typeof fields.get('ok') !== 'boolean') return null;
    if (fields.get('ok') === true) {
      return Object.freeze({
        ok: true,
        contentDigest: safeDigest(fields.get('contentDigest'), 'contentDigest'),
      });
    }
    const code = fields.has('code') && typeof fields.get('code') === 'string'
      && SAFE_IDENTIFIER.test(fields.get('code'))
      ? fields.get('code')
      : fallbackCode;
    return Object.freeze({ ok: false, code });
  } catch {
    return null;
  }
}

function createMapChatProposalService(options = {}) {
  const fields = dataFields(options, OPTION_KEYS);
  if (!fields) throw new TypeError('Invalid Map Chat proposal service options');

  let authorizeProjectBinding;
  let readOrchestrationState;
  let readApplicationMapSnapshot;
  let readMilestonesSnapshot;
  let applyApplicationMapProposal;
  let applyMilestoneProposal;
  let createPreview;
  let getProposal;
  let claimApproval;
  let settleApproval;
  let rejectPreview;
  try {
    authorizeProjectBinding = captureCallback(
      fields.get('authorizeProjectBinding'),
      'authorizeProjectBinding',
    );
    const conversationStore = fields.get('conversationStore');
    const applicationMapService = fields.get('applicationMapService');
    const milestoneService = fields.get('milestoneService');
    const proposalStore = fields.get('proposalStore');
    readOrchestrationState = captureOwnMethod(
      conversationStore,
      'readOrchestrationState',
      'conversationStore',
    );
    readApplicationMapSnapshot = captureOwnMethod(
      applicationMapService,
      'readApplicationMapSnapshot',
      'applicationMapService',
    );
    applyApplicationMapProposal = captureOwnMethod(
      applicationMapService,
      'applyApprovedProposal',
      'applicationMapService',
    );
    readMilestonesSnapshot = captureOwnMethod(
      milestoneService,
      'readMilestonesSnapshot',
      'milestoneService',
    );
    applyMilestoneProposal = captureOwnMethod(
      milestoneService,
      'applyApprovedProposal',
      'milestoneService',
    );
    createPreview = captureOwnMethod(proposalStore, 'createPreview', 'proposalStore');
    getProposal = captureOwnMethod(proposalStore, 'getProposal', 'proposalStore');
    claimApproval = captureOwnMethod(proposalStore, 'claimApproval', 'proposalStore');
    settleApproval = captureOwnMethod(proposalStore, 'settleApproval', 'proposalStore');
    rejectPreview = captureOwnMethod(proposalStore, 'rejectPreview', 'proposalStore');
  } catch {
    throw new TypeError('Invalid Map Chat proposal service options');
  }

  function authorizeProject(input) {
    const authorized = callAuthorization(
      authorizeProjectBinding,
      input.projectId,
      input.rootPath,
    );
    if (!authorized) return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.PROJECT_NOT_AUTHORIZED);
    return Object.freeze({ ok: true });
  }

  function authorizeConversationState(input, expectedSource) {
    let state;
    try {
      state = conversationState(
        callSync(
          readOrchestrationState,
          [],
          'conversationStore.readOrchestrationState',
        ),
        input.projectId,
        input.conversationId,
        expectedSource,
      );
    } catch {
      state = 'forbidden';
    }
    if (state === 'not_found') {
      return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.CONVERSATION_NOT_FOUND);
    }
    if (state !== 'allowed') {
      return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.CONVERSATION_FORBIDDEN);
    }
    return Object.freeze({ ok: true });
  }

  function authorizeConversation(input, expectedSource) {
    const projectAccess = authorizeProject(input);
    if (!projectAccess.ok) return projectAccess;
    return authorizeConversationState(input, expectedSource);
  }

  function readBaseDigest(rootPath, target) {
    try {
      if (target === 'application_map') {
        return normalizeSnapshotDigest(callSync(
          readApplicationMapSnapshot,
          [rootPath],
          'applicationMapService.readApplicationMapSnapshot',
        ), 'application map');
      }
      if (target === 'milestones') {
        return normalizeSnapshotDigest(callSync(
          readMilestonesSnapshot,
          [rootPath],
          'milestoneService.readMilestonesSnapshot',
        ), 'milestone');
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  function previewMilestones(rawInput) {
    const input = normalizePreviewInput(rawInput);
    if (!input) return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.INVALID_INPUT);
    const access = authorizeConversation(input, 'map_render');
    if (!access.ok) return access;
    const baseDigest = readBaseDigest(input.rootPath, 'milestones');
    if (baseDigest === undefined) {
      return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.CONTEXT_UNAVAILABLE);
    }
    const patch = Object.freeze({
      schemaVersion: MILESTONE_PATCH_SCHEMA_VERSION,
      operation: 'replace',
      milestones: input.milestones,
    });
    const created = normalizeStoreResult(callSync(
      createPreview,
      [{
        projectId: input.projectId,
        rootPath: input.rootPath,
        conversationId: input.conversationId,
        surface: 'map_render',
        target: 'milestones',
        baseDigest,
        patch,
      }],
      'proposalStore.createPreview',
    ));
    return created || deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.STORE_FAILED);
  }

  function previewApplicationMapPatch(rawInput) {
    const input = normalizeApplicationMapPreviewInput(rawInput);
    if (!input) return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.INVALID_INPUT);
    const access = authorizeConversation(input, 'map_chat');
    if (!access.ok) return access;
    const baseDigest = readBaseDigest(input.rootPath, 'application_map');
    if (baseDigest === undefined) {
      return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.CONTEXT_UNAVAILABLE);
    }
    const patch = Object.freeze({
      schemaVersion: APPLICATION_MAP_PATCH_SCHEMA_VERSION,
      operations: input.operations,
    });
    const created = normalizeStoreResult(callSync(
      createPreview,
      [{
        projectId: input.projectId,
        rootPath: input.rootPath,
        conversationId: input.conversationId,
        surface: 'map_chat',
        target: 'application_map',
        baseDigest,
        patch,
      }],
      'proposalStore.createPreview',
    ));
    return created || deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.STORE_FAILED);
  }

  function getAuthorizedProposal(input) {
    const projectAccess = authorizeProject(input);
    if (!projectAccess.ok) return projectAccess;
    const found = normalizeStoreResult(callSync(
      getProposal,
      [input.proposalId],
      'proposalStore.getProposal',
    ));
    if (!found) return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.STORE_FAILED);
    if (!found.ok) return found;
    const contract = proposalContract(found.proposal);
    if (!contract || !proposalMatchesBinding(found.proposal, input)) {
      return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.PROPOSAL_FORBIDDEN);
    }
    const conversationAccess = authorizeConversationState(input, contract.expectedSource);
    if (!conversationAccess.ok) return conversationAccess;
    return Object.freeze({ ...found, contract });
  }

  function approveProposal(rawInput) {
    const input = normalizeDecisionInput(rawInput);
    if (!input) return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.INVALID_INPUT);
    let found;
    try {
      found = getAuthorizedProposal(input);
    } catch {
      return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.STORE_FAILED);
    }
    if (!found.ok) return found;
    const proposalFields = dataFields(found.proposal);
    const currentDigest = readBaseDigest(input.rootPath, found.contract.target);
    if (currentDigest === undefined) {
      return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.CONTEXT_UNAVAILABLE);
    }
    if (currentDigest !== proposalFields.get('baseDigest')) {
      return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.STALE_BASE);
    }

    const claimed = normalizeStoreResult(callSync(
      claimApproval,
      [{
        proposalId: input.proposalId,
        expectedRevision: input.expectedRevision,
        patchDigest: input.patchDigest,
      }],
      'proposalStore.claimApproval',
    ));
    if (!claimed) return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.STORE_FAILED);
    if (!claimed.ok) return claimed;

    const claimedFields = dataFields(claimed.proposal);
    const applyPort = found.contract.target === 'application_map'
      ? applyApplicationMapProposal
      : applyMilestoneProposal;
    const applyFieldName = found.contract.target === 'application_map'
      ? 'applicationMapService.applyApprovedProposal'
      : 'milestoneService.applyApprovedProposal';
    const fallbackApplyCode = found.contract.target === 'application_map'
      ? 'APPLICATION_MAP_APPLY_FAILED'
      : 'MILESTONE_APPLY_FAILED';
    let applied;
    try {
      applied = normalizeApplyResult(callSync(
        applyPort,
        [input.rootPath, {
          expectedDigest: claimedFields.get('baseDigest'),
          patch: claimedFields.get('patch'),
          patchDigest: claimedFields.get('patchDigest'),
        }],
        applyFieldName,
      ), fallbackApplyCode);
    } catch {
      applied = null;
    }
    const successful = Boolean(applied && applied.ok);
    const failureCode = successful
      ? null
      : applied && applied.code
        ? applied.code
        : fallbackApplyCode;
    const settled = normalizeStoreResult(callSync(
      settleApproval,
      [{
        proposalId: input.proposalId,
        expectedRevision: claimedFields.get('revision'),
        outcome: successful ? 'applied' : 'failed',
        failureCode,
      }],
      'proposalStore.settleApproval',
    ));
    if (!settled || !settled.ok) {
      return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.STORE_FAILED);
    }
    if (!successful) {
      return Object.freeze({
        ok: false,
        code: MAP_CHAT_PROPOSAL_SERVICE_REASONS.APPLY_FAILED,
        proposal: settled.proposal,
      });
    }
    return Object.freeze({
      ok: true,
      proposal: settled.proposal,
      contentDigest: applied.contentDigest,
    });
  }

  function rejectProposal(rawInput) {
    const input = normalizeDecisionInput(rawInput);
    if (!input) return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.INVALID_INPUT);
    let found;
    try {
      found = getAuthorizedProposal(input);
    } catch {
      return deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.STORE_FAILED);
    }
    if (!found.ok) return found;
    const rejected = normalizeStoreResult(callSync(
      rejectPreview,
      [{
        proposalId: input.proposalId,
        expectedRevision: input.expectedRevision,
        patchDigest: input.patchDigest,
      }],
      'proposalStore.rejectPreview',
    ));
    return rejected || deny(MAP_CHAT_PROPOSAL_SERVICE_REASONS.STORE_FAILED);
  }

  return Object.freeze({
    version: MAP_CHAT_PROPOSAL_SERVICE_VERSION,
    approveProposal,
    previewApplicationMapPatch,
    previewMilestones,
    rejectProposal,
  });
}

module.exports = {
  APPLICATION_MAP_PATCH_SCHEMA_VERSION,
  MAP_CHAT_PROPOSAL_SERVICE_REASONS,
  MAP_CHAT_PROPOSAL_SERVICE_VERSION,
  MILESTONE_PATCH_SCHEMA_VERSION,
  createMapChatProposalService,
  normalizeApplicationMapProposalOperations,
};
