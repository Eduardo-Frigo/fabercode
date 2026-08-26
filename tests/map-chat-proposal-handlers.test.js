'use strict';

const assert = require('assert');

const {
  registerMapChatProposalHandlers,
} = require('../main/ipc/map_chat_proposal_handlers');

function createHandlerMap() {
  const handlers = {};
  return {
    handlers,
    registerIpcHandler(channel, handler) {
      handlers[channel] = handler;
    },
  };
}

function run() {
  assert.throws(
    () => registerMapChatProposalHandlers(),
    /mapChatProposalService/,
  );
  assert.throws(
    () => registerMapChatProposalHandlers({ mapChatProposalService: {} }),
    /registerIpcHandler/,
  );
  assert.throws(
    () => registerMapChatProposalHandlers({
      mapChatProposalService: {},
      registerIpcHandler() {},
    }),
    /previewApplicationMapPatch/,
  );

  const calls = [];
  const result = Object.freeze({
    ok: true,
    proposal: Object.freeze({
      proposalId: 'proposal-1',
      revision: 1,
      patchDigest: 'sha256:' + 'a'.repeat(64),
      status: 'pending',
    }),
  });
  const mapChatProposalService = {
    previewApplicationMapPatch(payload) {
      calls.push(['map-preview', payload]);
      return result;
    },
    previewMilestones(payload) {
      calls.push(['preview', payload]);
      return result;
    },
    approveProposal(payload) {
      calls.push(['approve', payload]);
      return result;
    },
    rejectProposal(payload) {
      calls.push(['reject', payload]);
      return result;
    },
  };
  const { handlers, registerIpcHandler } = createHandlerMap();
  registerMapChatProposalHandlers({
    mapChatProposalService,
    registerIpcHandler,
  });
  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'application-map:proposal:approve',
    'application-map:proposal:map:preview',
    'application-map:proposal:milestones:preview',
    'application-map:proposal:reject',
  ]);

  const previewPayload = {
    projectId: 'project-1',
    rootPath: '/workspace/project',
    conversationId: 'render-conversation-1',
    milestones: [],
  };
  const mapPreviewPayload = {
    projectId: 'project-1',
    rootPath: '/workspace/project',
    conversationId: 'chat-conversation-1',
    operations: [{ kind: 'remove_node', nodeId: 'node-old' }],
  };
  assert.strictEqual(
    handlers['application-map:proposal:map:preview'](null, mapPreviewPayload),
    result,
  );
  assert.strictEqual(
    handlers['application-map:proposal:milestones:preview'](null, previewPayload),
    result,
  );
  const decisionPayload = {
    projectId: 'project-1',
    rootPath: '/workspace/project',
    conversationId: 'render-conversation-1',
    proposalId: 'proposal-1',
    expectedRevision: 1,
    patchDigest: 'sha256:' + 'a'.repeat(64),
  };
  assert.strictEqual(
    handlers['application-map:proposal:approve'](null, decisionPayload),
    result,
  );
  assert.strictEqual(
    handlers['application-map:proposal:reject'](null, decisionPayload),
    result,
  );
  assert.deepStrictEqual(calls, [
    ['map-preview', mapPreviewPayload],
    ['preview', previewPayload],
    ['approve', decisionPayload],
    ['reject', decisionPayload],
  ]);

  mapChatProposalService.previewMilestones = () => ({ ok: false, code: 'forged' });
  mapChatProposalService.previewApplicationMapPatch = () => ({ ok: false, code: 'forged' });
  mapChatProposalService.approveProposal = () => ({ ok: false, code: 'forged' });
  mapChatProposalService.rejectProposal = () => ({ ok: false, code: 'forged' });
  assert.strictEqual(
    handlers['application-map:proposal:approve'](null, decisionPayload),
    result,
    'proposal service methods must be captured during registration',
  );

  const invalid = { ok: false, code: 'map_chat_proposal_ipc_invalid_input' };
  assert.deepStrictEqual(
    handlers['application-map:proposal:map:preview'](
      null,
      { ...mapPreviewPayload, operations: undefined },
    ),
    invalid,
  );
  assert.deepStrictEqual(
    handlers['application-map:proposal:milestones:preview'](
      null,
      { ...previewPayload, extraAuthority: true },
    ),
    invalid,
  );
  assert.deepStrictEqual(
    handlers['application-map:proposal:approve'](null, decisionPayload, {}),
    invalid,
  );
  assert.deepStrictEqual(
    handlers['application-map:proposal:reject'](null, {
      ...decisionPayload,
      patchDigest: undefined,
    }),
    invalid,
  );

  let getterReads = 0;
  const accessorPayload = { ...decisionPayload };
  Object.defineProperty(accessorPayload, 'proposalId', {
    enumerable: true,
    get() {
      getterReads += 1;
      return 'proposal-forged';
    },
  });
  assert.deepStrictEqual(
    handlers['application-map:proposal:approve'](null, accessorPayload),
    invalid,
  );
  assert.strictEqual(getterReads, 0);
  assert.strictEqual(calls.length, 5);

  console.log('map-chat-proposal-handlers tests passed');
}

run();
