'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MAP_CHAT_PROPOSAL_STORE_REASONS,
  MAP_CHAT_PROPOSAL_STORE_VERSION,
  canonicalizeMapChatProposalPatch,
  createMapChatProposalStore,
} = require('../main/services/map_chat_proposal_store');

function previewInput(overrides = {}) {
  return {
    projectId: 'project-1',
    rootPath: '/workspace/project',
    conversationId: 'render-conversation-1',
    surface: 'map_render',
    target: 'milestones',
    baseDigest: `sha256:${'a'.repeat(64)}`,
    patch: {
      schemaVersion: 'milestone-replacement-patch.v1',
      operation: 'replace',
      milestones: [{
        id: 'milestone-1',
        number: 1,
        title: 'Fundação',
        status: 'planned',
        tasks: [],
      }],
    },
    ...overrides,
  };
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'map-chat-proposal-store-'));
  let clock = Date.parse('2026-08-25T12:00:00.000Z');
  let sequence = 0;
  try {
    const options = {
      storageDir: tempRoot,
      now: () => clock,
      idFactory: () => `proposal-${++sequence}`,
    };
    const store = createMapChatProposalStore(options);
    assert.strictEqual(store.version, MAP_CHAT_PROPOSAL_STORE_VERSION);
    assert.strictEqual(Object.isFrozen(store), true);

    const first = store.createPreview(previewInput());
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.proposal.proposalId, 'proposal-1');
    assert.strictEqual(first.proposal.revision, 1);
    assert.strictEqual(first.proposal.status, 'pending');
    assert.match(first.proposal.patchDigest, /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(Object.isFrozen(first.proposal), true);
    assert.strictEqual(Object.isFrozen(first.proposal.patch), true);

    const storePath = path.join(tempRoot, 'map-chat-proposals.v1.json');
    assert.strictEqual(fs.existsSync(storePath), true);
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(tempRoot).mode & 0o777, 0o700);
      assert.strictEqual(fs.statSync(storePath).mode & 0o777, 0o600);
    }

    const restarted = createMapChatProposalStore(options);
    assert.deepStrictEqual(restarted.getProposal('proposal-1'), first);

    clock += 1_000;
    const second = restarted.createPreview(previewInput({
      patch: {
        operation: 'replace',
        milestones: previewInput().patch.milestones,
        schemaVersion: 'milestone-replacement-patch.v1',
      },
    }));
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.proposal.proposalId, 'proposal-2');
    assert.strictEqual(second.proposal.patchDigest, first.proposal.patchDigest);
    const superseded = restarted.getProposal('proposal-1');
    assert.strictEqual(superseded.proposal.status, 'superseded');
    assert.strictEqual(superseded.proposal.revision, 2);

    assert.deepStrictEqual(
      restarted.claimApproval({
        proposalId: 'proposal-1',
        expectedRevision: 1,
        patchDigest: first.proposal.patchDigest,
      }),
      { ok: false, code: MAP_CHAT_PROPOSAL_STORE_REASONS.NOT_PENDING },
    );
    assert.deepStrictEqual(
      restarted.claimApproval({
        proposalId: 'proposal-2',
        expectedRevision: 99,
        patchDigest: second.proposal.patchDigest,
      }),
      { ok: false, code: MAP_CHAT_PROPOSAL_STORE_REASONS.REVISION_CONFLICT },
    );
    assert.deepStrictEqual(
      restarted.claimApproval({
        proposalId: 'proposal-2',
        expectedRevision: 1,
        patchDigest: `sha256:${'f'.repeat(64)}`,
      }),
      { ok: false, code: MAP_CHAT_PROPOSAL_STORE_REASONS.DIGEST_MISMATCH },
    );

    clock += 1_000;
    const claimed = restarted.claimApproval({
      proposalId: 'proposal-2',
      expectedRevision: 1,
      patchDigest: second.proposal.patchDigest,
    });
    assert.strictEqual(claimed.ok, true);
    assert.strictEqual(claimed.proposal.status, 'applying');
    assert.strictEqual(claimed.proposal.revision, 2);
    assert.deepStrictEqual(
      restarted.claimApproval({
        proposalId: 'proposal-2',
        expectedRevision: 1,
        patchDigest: second.proposal.patchDigest,
      }),
      { ok: false, code: MAP_CHAT_PROPOSAL_STORE_REASONS.NOT_PENDING },
    );

    clock += 1_000;
    const settled = restarted.settleApproval({
      proposalId: 'proposal-2',
      expectedRevision: 2,
      outcome: 'applied',
      failureCode: null,
    });
    assert.strictEqual(settled.ok, true);
    assert.strictEqual(settled.proposal.status, 'applied');
    assert.strictEqual(settled.proposal.revision, 3);
    assert.strictEqual(settled.proposal.resolvedAt, '2026-08-25T12:00:03.000Z');

    clock += 1_000;
    const third = restarted.createPreview(previewInput({ target: 'application_map' }));
    const rejected = restarted.rejectPreview({
      proposalId: third.proposal.proposalId,
      expectedRevision: third.proposal.revision,
      patchDigest: third.proposal.patchDigest,
    });
    assert.strictEqual(rejected.ok, true);
    assert.strictEqual(rejected.proposal.status, 'rejected');
    assert.strictEqual(rejected.proposal.revision, 2);

    const pending = restarted.listProposals({
      projectId: 'project-1',
      conversationId: 'render-conversation-1',
      status: 'pending',
    });
    assert.deepStrictEqual(pending, { ok: true, proposals: [] });

    const beforeInvalid = fs.readFileSync(storePath, 'utf8');
    const invalid = restarted.createPreview({ ...previewInput(), extraAuthority: true });
    assert.deepStrictEqual(
      invalid,
      { ok: false, code: MAP_CHAT_PROPOSAL_STORE_REASONS.INVALID_INPUT },
    );
    assert.strictEqual(fs.readFileSync(storePath, 'utf8'), beforeInvalid);

    const oversizedTree = { schemaVersion: 'oversized-tree.v1' };
    for (let branch = 0; branch < 6; branch += 1) {
      oversizedTree[`branch${branch}`] = Array.from(
        { length: 17_000 },
        () => ({ value: null }),
      );
    }
    assert.throws(
      () => canonicalizeMapChatProposalPatch(oversizedTree),
      /structural bounds/,
      'aggregate proposal complexity must not reset between nested branches',
    );

    fs.writeFileSync(storePath, '{"broken"', 'utf8');
    assert.deepStrictEqual(
      restarted.getProposal('proposal-2'),
      { ok: false, code: MAP_CHAT_PROPOSAL_STORE_REASONS.STORAGE_CORRUPTED },
    );

    console.log('map-chat-proposal-store tests passed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
