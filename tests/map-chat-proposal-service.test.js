'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MAP_CHAT_PROPOSAL_STORE_REASONS,
  createMapChatProposalStore,
} = require('../main/services/map_chat_proposal_store');
const {
  MAP_CHAT_PROPOSAL_SERVICE_REASONS,
  MAP_CHAT_PROPOSAL_SERVICE_VERSION,
  createMapChatProposalService,
} = require('../main/services/map_chat_proposal_service');

const ROOT_PATH = '/workspace/project';
const BASE_DIGEST = 'sha256:' + 'a'.repeat(64);
const NEXT_DIGEST = 'sha256:' + 'b'.repeat(64);
const MAP_BASE_DIGEST = 'sha256:' + 'c'.repeat(64);
const MAP_NEXT_DIGEST = 'sha256:' + 'd'.repeat(64);

function milestones(title = 'Fundação') {
  return [{
    id: 'milestone-1',
    number: 1,
    title,
    summary: 'Preparar a base.',
    status: 'planned',
    tasks: [{
      id: 'task-1',
      title: 'Configurar a base',
      status: 'pending',
    }],
    acceptanceCriteria: 'A base inicia sem erros.',
    validationCommands: 'npm test',
    references: [{ path: 'docs/application-map/README.md' }],
    commits: [],
    notes: '',
  }];
}

function previewInput(overrides = {}) {
  return {
    projectId: 'project-1',
    rootPath: ROOT_PATH,
    conversationId: 'render-conversation-1',
    milestones: milestones(),
    ...overrides,
  };
}

function approvalInput(proposal, overrides = {}) {
  return {
    projectId: 'project-1',
    rootPath: ROOT_PATH,
    conversationId: 'render-conversation-1',
    proposalId: proposal.proposalId,
    expectedRevision: proposal.revision,
    patchDigest: proposal.patchDigest,
    ...overrides,
  };
}

function mapPreviewInput(overrides = {}) {
  return {
    projectId: 'project-1',
    rootPath: ROOT_PATH,
    conversationId: 'chat-conversation-1',
    operations: [{
      kind: 'upsert_node',
      node: {
        id: 'node-login',
        type: 'text',
        title: 'Login',
      },
    }],
    ...overrides,
  };
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-chat-proposal-service-'));
  let sequence = 0;
  let currentDigest = BASE_DIGEST;
  let currentMapDigest = MAP_BASE_DIGEST;
  let applyResult = { ok: true, contentDigest: NEXT_DIGEST };
  let mapApplyResult = { ok: true, contentDigest: MAP_NEXT_DIGEST };
  let observedProposalId = null;
  const calls = {
    authorization: [],
    apply: [],
    mapApply: [],
    mapSnapshots: [],
    conversations: 0,
    snapshots: [],
  };
  try {
    const proposalStore = createMapChatProposalStore({
      storageDir: tempRoot,
      now: () => Date.parse('2026-08-25T15:00:00.000Z') + sequence,
      idFactory: () => 'proposal-' + (++sequence),
    });
    const conversationStore = {
      readOrchestrationState() {
        calls.conversations += 1;
        return {
          conversationsByProject: {
            'project-1': [{
              id: 'render-conversation-1',
              source: 'map_render',
            }, {
              id: 'chat-conversation-1',
              source: 'map_chat',
            }],
          },
        };
      },
    };
    const milestoneService = {
      readMilestonesSnapshot(rootPath) {
        calls.snapshots.push(rootPath);
        return {
          ok: true,
          found: currentDigest !== null,
          format: currentDigest === null ? null : 'rendered',
          renderedAt: null,
          source: null,
          milestones: [],
          contentDigest: currentDigest,
        };
      },
      applyApprovedProposal(rootPath, input) {
        calls.apply.push({ rootPath, input });
        if (observedProposalId) {
          const applying = proposalStore.getProposal(observedProposalId);
          assert.strictEqual(applying.ok, true);
          assert.strictEqual(applying.proposal.status, 'applying');
        }
        return applyResult;
      },
    };
    const applicationMapService = {
      readApplicationMapSnapshot(rootPath) {
        calls.mapSnapshots.push(rootPath);
        return {
          ok: true,
          found: currentMapDigest !== null,
          map: currentMapDigest === null ? null : { nodes: [], edges: [] },
          contentDigest: currentMapDigest,
        };
      },
      applyApprovedProposal(rootPath, input) {
        calls.mapApply.push({ rootPath, input });
        if (observedProposalId) {
          const applying = proposalStore.getProposal(observedProposalId);
          assert.strictEqual(applying.ok, true);
          assert.strictEqual(applying.proposal.status, 'applying');
        }
        return mapApplyResult;
      },
    };
    const authorizeProjectBinding = (projectId, rootPath) => {
      calls.authorization.push({ projectId, rootPath });
      return {
        ok: true,
        authorized: true,
        projectId,
        rootPath,
        canonicalRootPath: rootPath,
      };
    };
    const service = createMapChatProposalService({
      applicationMapService,
      authorizeProjectBinding,
      conversationStore,
      milestoneService,
      proposalStore,
    });
    assert.strictEqual(service.version, MAP_CHAT_PROPOSAL_SERVICE_VERSION);
    assert.strictEqual(Object.isFrozen(service), true);

    const preview = service.previewMilestones(previewInput());
    assert.strictEqual(preview.ok, true);
    assert.strictEqual(preview.proposal.surface, 'map_render');
    assert.strictEqual(preview.proposal.target, 'milestones');
    assert.strictEqual(preview.proposal.baseDigest, BASE_DIGEST);
    assert.deepStrictEqual(preview.proposal.patch, {
      milestones: milestones(),
      operation: 'replace',
      schemaVersion: 'milestone-replacement-patch.v1',
    });
    assert.strictEqual(calls.apply.length, 0, 'preview must never mutate milestones');
    assert.strictEqual(Object.isFrozen(preview.proposal.patch.milestones), true);

    const claimedDone = milestones('Conclusão forjada');
    claimedDone[0].status = 'done';
    claimedDone[0].completionEvidence = {
      jobId: 'job-forged',
      status: 'passed',
    };
    assert.deepStrictEqual(
      service.previewMilestones(previewInput({ milestones: claimedDone })),
      { ok: false, code: MAP_CHAT_PROPOSAL_SERVICE_REASONS.INVALID_INPUT },
    );

    const multipleActive = milestones('Ativa 1');
    multipleActive[0].status = 'active';
    multipleActive.push({
      ...milestones('Ativa 2')[0],
      id: 'milestone-2',
      number: 2,
      status: 'active',
    });
    assert.deepStrictEqual(
      service.previewMilestones(previewInput({ milestones: multipleActive })),
      { ok: false, code: MAP_CHAT_PROPOSAL_SERVICE_REASONS.INVALID_INPUT },
    );

    currentDigest = NEXT_DIGEST;
    const stale = service.approveProposal(approvalInput(preview.proposal));
    assert.deepStrictEqual(
      stale,
      { ok: false, code: MAP_CHAT_PROPOSAL_SERVICE_REASONS.STALE_BASE },
    );
    assert.strictEqual(
      proposalStore.getProposal(preview.proposal.proposalId).proposal.status,
      'pending',
    );
    assert.strictEqual(calls.apply.length, 0);

    currentDigest = BASE_DIGEST;
    const refined = service.previewMilestones(previewInput({
      milestones: milestones('Fundação refinada'),
    }));
    assert.strictEqual(
      proposalStore.getProposal(preview.proposal.proposalId).proposal.status,
      'superseded',
    );

    observedProposalId = refined.proposal.proposalId;
    const approved = service.approveProposal(approvalInput(refined.proposal));
    assert.strictEqual(approved.ok, true);
    assert.strictEqual(approved.proposal.status, 'applied');
    assert.strictEqual(approved.proposal.revision, 3);
    assert.strictEqual(approved.contentDigest, NEXT_DIGEST);
    assert.strictEqual(calls.apply.length, 1);

    const mapPreview = service.previewApplicationMapPatch(mapPreviewInput());
    assert.strictEqual(mapPreview.ok, true);
    assert.strictEqual(mapPreview.proposal.surface, 'map_chat');
    assert.strictEqual(mapPreview.proposal.target, 'application_map');
    assert.strictEqual(mapPreview.proposal.baseDigest, MAP_BASE_DIGEST);
    assert.deepStrictEqual(mapPreview.proposal.patch, {
      operations: mapPreviewInput().operations,
      schemaVersion: 'application-map-patch.v1',
    });
    assert.strictEqual(calls.mapApply.length, 0, 'map preview must never mutate the map');

    observedProposalId = mapPreview.proposal.proposalId;
    const approvedMap = service.approveProposal(approvalInput(mapPreview.proposal, {
      conversationId: 'chat-conversation-1',
    }));
    assert.strictEqual(approvedMap.ok, true);
    assert.strictEqual(approvedMap.proposal.status, 'applied');
    assert.strictEqual(approvedMap.contentDigest, MAP_NEXT_DIGEST);
    assert.strictEqual(calls.mapApply.length, 1);
    assert.deepStrictEqual(calls.mapApply[0], {
      rootPath: ROOT_PATH,
      input: {
        expectedDigest: MAP_BASE_DIGEST,
        patch: mapPreview.proposal.patch,
        patchDigest: mapPreview.proposal.patchDigest,
      },
    });
    assert.strictEqual(calls.apply.length, 1, 'map proposal must not dispatch to milestones');

    const wrongMapSurface = service.previewApplicationMapPatch(mapPreviewInput({
      conversationId: 'render-conversation-1',
    }));
    assert.deepStrictEqual(
      wrongMapSurface,
      { ok: false, code: MAP_CHAT_PROPOSAL_SERVICE_REASONS.CONVERSATION_FORBIDDEN },
    );
    assert.strictEqual(calls.apply[0].rootPath, ROOT_PATH);
    assert.deepStrictEqual(calls.apply[0].input, {
      expectedDigest: BASE_DIGEST,
      patch: refined.proposal.patch,
      patchDigest: refined.proposal.patchDigest,
    });

    const replay = service.approveProposal(approvalInput(refined.proposal));
    assert.deepStrictEqual(
      replay,
      { ok: false, code: MAP_CHAT_PROPOSAL_STORE_REASONS.NOT_PENDING },
    );
    assert.strictEqual(calls.apply.length, 1);

    const toReject = service.previewMilestones(previewInput({
      milestones: milestones('Descartar'),
    }));
    const rejected = service.rejectProposal(approvalInput(toReject.proposal));
    assert.strictEqual(rejected.ok, true);
    assert.strictEqual(rejected.proposal.status, 'rejected');
    assert.strictEqual(calls.apply.length, 1);

    const failing = service.previewMilestones(previewInput({
      milestones: milestones('Falha controlada'),
    }));
    applyResult = { ok: false, code: 'MILESTONE_WRITE_FAILED' };
    observedProposalId = failing.proposal.proposalId;
    const failed = service.approveProposal(approvalInput(failing.proposal));
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.code, MAP_CHAT_PROPOSAL_SERVICE_REASONS.APPLY_FAILED);
    assert.strictEqual(failed.proposal.status, 'failed');
    assert.strictEqual(failed.proposal.failureCode, 'MILESTONE_WRITE_FAILED');

    const wrongSurface = service.previewMilestones(previewInput({
      conversationId: 'chat-conversation-1',
    }));
    assert.deepStrictEqual(
      wrongSurface,
      { ok: false, code: MAP_CHAT_PROPOSAL_SERVICE_REASONS.CONVERSATION_FORBIDDEN },
    );

    const forgedService = createMapChatProposalService({
      applicationMapService,
      authorizeProjectBinding: () => ({
        ok: false,
        authorized: false,
        projectId: 'project-1',
        rootPath: ROOT_PATH,
        canonicalRootPath: ROOT_PATH,
      }),
      conversationStore,
      milestoneService,
      proposalStore,
    });
    assert.deepStrictEqual(
      forgedService.previewMilestones(previewInput()),
      { ok: false, code: MAP_CHAT_PROPOSAL_SERVICE_REASONS.PROJECT_NOT_AUTHORIZED },
    );

    const authorizationsBeforeInvalid = calls.authorization.length;
    assert.deepStrictEqual(
      service.previewMilestones({ ...previewInput(), extraAuthority: true }),
      { ok: false, code: MAP_CHAT_PROPOSAL_SERVICE_REASONS.INVALID_INPUT },
    );
    assert.strictEqual(calls.authorization.length, authorizationsBeforeInvalid);

    // Captured methods cannot be replaced after service composition.
    milestoneService.applyApprovedProposal = () => ({ ok: true, contentDigest: 'forged' });
    applicationMapService.applyApprovedProposal = () => ({ ok: true, contentDigest: 'forged' });
    applicationMapService.readApplicationMapSnapshot = () => ({
      ok: true,
      found: true,
      map: {},
      contentDigest: 'sha256:' + 'f'.repeat(64),
    });
    conversationStore.readOrchestrationState = () => ({
      conversationsByProject: {
        'project-1': [{ id: 'render-conversation-1', source: 'development' }],
      },
    });
    applyResult = { ok: true, contentDigest: NEXT_DIGEST };
    const captured = service.previewMilestones(previewInput({
      milestones: milestones('Dependências capturadas'),
    }));
    assert.strictEqual(captured.ok, true);

    currentMapDigest = MAP_BASE_DIGEST;
    mapApplyResult = { ok: true, contentDigest: MAP_NEXT_DIGEST };
    const capturedMap = service.previewApplicationMapPatch(mapPreviewInput({
      operations: [{ kind: 'remove_node', nodeId: 'node-obsolete' }],
    }));
    assert.strictEqual(capturedMap.ok, true);

    assert.throws(
      () => createMapChatProposalService({}),
      /Invalid Map Chat proposal service options/,
    );

    console.log('map-chat-proposal-service tests passed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
