'use strict';

const MAP_CHAT_PROPOSAL_IPC_INVALID_INPUT = Object.freeze({
  ok: false,
  code: 'map_chat_proposal_ipc_invalid_input',
});
const PREVIEW_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'conversationId',
  'milestones',
]);
const MAP_PREVIEW_KEYS = Object.freeze([
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
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isExactDataEnvelope(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length
      || keys.some((key) => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))
      || expectedKeys.some((key) => !keys.includes(key))) return false;
    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(
        descriptor
        && descriptor.enumerable === true
        && Object.hasOwn(descriptor, 'value')
        && descriptor.value !== undefined
      );
    });
  } catch {
    return false;
  }
}

function captureMethod(service, methodName) {
  const descriptor = Object.getOwnPropertyDescriptor(service, methodName);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function') {
    throw new Error('Map Chat proposal IPC service missing method: ' + methodName);
  }
  return descriptor.value;
}

function registerMapChatProposalHandlers(dependencies = {}) {
  const {
    mapChatProposalService,
    registerIpcHandler,
  } = dependencies;
  if (!mapChatProposalService) {
    throw new Error('Map Chat proposal IPC dependency missing: mapChatProposalService');
  }
  if (typeof registerIpcHandler !== 'function') {
    throw new Error('Map Chat proposal IPC dependency missing: registerIpcHandler');
  }
  const previewApplicationMapPatch = captureMethod(
    mapChatProposalService,
    'previewApplicationMapPatch',
  );
  const previewMilestones = captureMethod(mapChatProposalService, 'previewMilestones');
  const approveProposal = captureMethod(mapChatProposalService, 'approveProposal');
  const rejectProposal = captureMethod(mapChatProposalService, 'rejectProposal');

  registerIpcHandler('application-map:proposal:map:preview', (_, ...args) => {
    if (args.length !== 1 || !isExactDataEnvelope(args[0], MAP_PREVIEW_KEYS)) {
      return MAP_CHAT_PROPOSAL_IPC_INVALID_INPUT;
    }
    return Reflect.apply(previewApplicationMapPatch, mapChatProposalService, [args[0]]);
  });
  registerIpcHandler('application-map:proposal:milestones:preview', (_, ...args) => {
    if (args.length !== 1 || !isExactDataEnvelope(args[0], PREVIEW_KEYS)) {
      return MAP_CHAT_PROPOSAL_IPC_INVALID_INPUT;
    }
    return Reflect.apply(previewMilestones, mapChatProposalService, [args[0]]);
  });
  registerIpcHandler('application-map:proposal:approve', (_, ...args) => {
    if (args.length !== 1 || !isExactDataEnvelope(args[0], DECISION_KEYS)) {
      return MAP_CHAT_PROPOSAL_IPC_INVALID_INPUT;
    }
    return Reflect.apply(approveProposal, mapChatProposalService, [args[0]]);
  });
  registerIpcHandler('application-map:proposal:reject', (_, ...args) => {
    if (args.length !== 1 || !isExactDataEnvelope(args[0], DECISION_KEYS)) {
      return MAP_CHAT_PROPOSAL_IPC_INVALID_INPUT;
    }
    return Reflect.apply(rejectProposal, mapChatProposalService, [args[0]]);
  });
}

module.exports = {
  registerMapChatProposalHandlers,
};
