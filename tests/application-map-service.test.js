const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  APPLICATION_MAP_PROPOSAL_REASONS,
  createApplicationMapService,
} = require('../main/services/application_map_service');
const { createApplicationMapRenderService } = require('../main/services/application_map_render_service');
const {
  computeMapChatProposalPatchDigest,
} = require('../main/services/map_chat_proposal_store');

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-map-test-'));
  
  try {
    const mapService = createApplicationMapService({ fs, path });
    const renderService = createApplicationMapRenderService({ fs, path, mapService });

    const missingSnapshot = mapService.readApplicationMapSnapshot(tempRoot);
    assert.deepStrictEqual(missingSnapshot, {
      ok: true,
      found: false,
      map: null,
      contentDigest: null,
    });
    assert.strictEqual(fs.existsSync(path.join(tempRoot, '.faber')), false);

    // Test getMap on non-existent map (should return empty default map)
    const initialMap = mapService.getMap(tempRoot);
    assert.deepStrictEqual(initialMap.nodes, []);
    assert.deepStrictEqual(initialMap.edges, []);
    assert.deepStrictEqual(initialMap.viewport, { x: 0, y: 0 });
    assert.strictEqual(initialMap.zoom, 1);
    assert.strictEqual(fs.existsSync(path.join(tempRoot, '.faber')), false);

    // Test saveMap
    const testMap = {
      nodes: [
        { id: 'node-1', type: 'group', title: 'Frontend', description: 'Web UI Component' },
        { id: 'node-2', type: 'text', title: 'Home Page', description: 'Landing page', parentId: 'node-1' }
      ],
      edges: [
        { id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2', type: 'contains' }
      ],
      viewport: { x: 10, y: 20 },
      zoom: 1.5,
    };
    const saveRes = mapService.saveMap(tempRoot, testMap);
    assert.strictEqual(saveRes.ok, true);

    const savedMap = mapService.getMap(tempRoot);
    const savedSnapshot = mapService.readApplicationMapSnapshot(tempRoot);
    assert.strictEqual(savedSnapshot.ok, true);
    assert.strictEqual(savedSnapshot.found, true);
    assert.match(savedSnapshot.contentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.deepStrictEqual(savedSnapshot.map, savedMap);
    assert.strictEqual(savedMap.nodes.length, 2);
    assert.strictEqual(savedMap.edges.length, 1);
    assert.strictEqual(savedMap.viewport.x, 10);
    assert.strictEqual(savedMap.zoom, 1.5);

    // Test upsertNode (update)
    const updateNode = { id: 'node-2', type: 'text', title: 'Home Page v2', description: 'Updated landing page', parentId: 'node-1' };
    const upsertRes = mapService.upsertNode(tempRoot, updateNode);
    assert.strictEqual(upsertRes.ok, true);
    assert.strictEqual(upsertRes.node.title, 'Home Page v2');

    // Test upsertNode (insert)
    const newNode = { id: 'node-3', type: 'decision', title: 'Use React', description: 'Tech stack decision' };
    const insertRes = mapService.upsertNode(tempRoot, newNode);
    assert.strictEqual(insertRes.ok, true);

    const mapAfterUpserts = mapService.getMap(tempRoot);
    assert.strictEqual(mapAfterUpserts.nodes.length, 3);
    assert.strictEqual(mapAfterUpserts.nodes.find(n => n.id === 'node-2').title, 'Home Page v2');
    assert.strictEqual(mapAfterUpserts.zoom, 1.5);

    // Test removeNode
    const removeRes = mapService.removeNode(tempRoot, 'node-2');
    assert.strictEqual(removeRes.ok, true);

    const mapAfterRemove = mapService.getMap(tempRoot);
    assert.strictEqual(mapAfterRemove.nodes.length, 2);
    // Edge connected to node-2 should also be removed
    assert.strictEqual(mapAfterRemove.edges.length, 0);

    // Test rendering markdown
    const renderRes = renderService.renderMap(tempRoot);
    assert.strictEqual(renderRes.ok, true);

    const readmePath = path.join(tempRoot, 'docs', 'application-map', 'README.md');
    const frontendPath = path.join(tempRoot, 'docs', 'application-map', 'frontend.md');
    const decisionsPath = path.join(tempRoot, 'docs', 'application-map', 'decisions.md');

    assert.strictEqual(fs.existsSync(readmePath), true);
    assert.strictEqual(fs.existsSync(frontendPath), true);
    assert.strictEqual(fs.existsSync(decisionsPath), true);

    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.strictEqual(readmeContent.includes('Frontend'), true);

    const decisionsContent = fs.readFileSync(decisionsPath, 'utf8');
    assert.strictEqual(decisionsContent.includes('Use React'), true);

    // Approved map proposals are CAS-bound structured patches. They preserve
    // renderer state and existing asset references while applying once.
    const mapPath = path.join(tempRoot, '.faber', 'application-map.json');
    const assetsIndexPath = path.join(tempRoot, '.faber', 'map-assets-index.json');
    const proposalBaseMap = {
      nodes: [
        {
          id: 'node-group',
          type: 'group',
          title: 'Produto',
          position: { x: 40, y: 50 },
        },
        {
          id: 'node-asset',
          type: 'image',
          title: 'Referência',
          parentId: 'node-group',
          assetId: 'Map assets/references/brand.png',
          position: { x: 80, y: 90 },
        },
      ],
      edges: [],
      viewport: { x: -120, y: 64 },
      zoom: 1.25,
      updatedAt: '2026-08-25T12:00:00.000Z',
    };
    const assetsIndex = [{
      id: 'asset-1',
      projectRelativePath: 'Map assets/references/brand.png',
    }];
    fs.writeFileSync(mapPath, JSON.stringify(proposalBaseMap, null, 2), 'utf8');
    fs.writeFileSync(assetsIndexPath, JSON.stringify(assetsIndex, null, 2), 'utf8');
    const assetsIndexBytes = fs.readFileSync(assetsIndexPath, 'utf8');
    const proposalBase = mapService.readApplicationMapSnapshot(tempRoot);
    const proposalPatch = {
      schemaVersion: 'application-map-patch.v1',
      operations: [
        {
          kind: 'upsert_node',
          node: {
            id: 'node-login',
            type: 'text',
            title: 'Login',
            description: 'Entrada autenticada.',
            parentId: 'node-group',
            position: { x: 220, y: 90 },
          },
        },
        {
          kind: 'upsert_edge',
          edge: {
            id: 'edge-login-reference',
            sourceNodeId: 'node-login',
            targetNodeId: 'node-asset',
            type: 'depends_on',
          },
        },
        {
          kind: 'set_viewport',
          viewport: { x: -32, y: 18, zoom: 1.5 },
        },
      ],
    };
    const proposalPatchDigest = computeMapChatProposalPatchDigest(proposalPatch);

    const forgedPatchDigest = mapService.applyApprovedProposal(tempRoot, {
      expectedDigest: proposalBase.contentDigest,
      patch: proposalPatch,
      patchDigest: 'sha256:' + 'f'.repeat(64),
    });
    assert.deepStrictEqual(forgedPatchDigest, {
      ok: false,
      code: APPLICATION_MAP_PROPOSAL_REASONS.PATCH_DIGEST_MISMATCH,
    });
    assert.deepStrictEqual(mapService.readApplicationMapSnapshot(tempRoot).map, proposalBaseMap);

    const staleBase = mapService.applyApprovedProposal(tempRoot, {
      expectedDigest: 'sha256:' + '0'.repeat(64),
      patch: proposalPatch,
      patchDigest: proposalPatchDigest,
    });
    assert.deepStrictEqual(staleBase, {
      ok: false,
      code: APPLICATION_MAP_PROPOSAL_REASONS.STALE_BASE,
    });
    assert.deepStrictEqual(mapService.readApplicationMapSnapshot(tempRoot).map, proposalBaseMap);

    const appliedProposal = mapService.applyApprovedProposal(tempRoot, {
      expectedDigest: proposalBase.contentDigest,
      patch: proposalPatch,
      patchDigest: proposalPatchDigest,
    });
    assert.strictEqual(appliedProposal.ok, true);
    assert.match(appliedProposal.contentDigest, /^sha256:[a-f0-9]{64}$/);
    const appliedMap = mapService.readApplicationMapSnapshot(tempRoot).map;
    assert.strictEqual(appliedMap.nodes.length, 3);
    assert.strictEqual(appliedMap.edges.length, 1);
    assert.deepStrictEqual(appliedMap.viewport, { x: -32, y: 18 });
    assert.strictEqual(appliedMap.zoom, 1.5);
    assert.strictEqual(
      appliedMap.nodes.find((node) => node.id === 'node-asset').assetId,
      'Map assets/references/brand.png',
    );
    assert.strictEqual(fs.readFileSync(assetsIndexPath, 'utf8'), assetsIndexBytes);

    const replay = mapService.applyApprovedProposal(tempRoot, {
      expectedDigest: proposalBase.contentDigest,
      patch: proposalPatch,
      patchDigest: proposalPatchDigest,
    });
    assert.deepStrictEqual(replay, {
      ok: false,
      code: APPLICATION_MAP_PROPOSAL_REASONS.STALE_BASE,
    });

    const currentSnapshot = mapService.readApplicationMapSnapshot(tempRoot);
    const danglingPatch = {
      schemaVersion: 'application-map-patch.v1',
      operations: [{
        kind: 'upsert_edge',
        edge: {
          id: 'edge-dangling',
          sourceNodeId: 'node-login',
          targetNodeId: 'node-missing',
        },
      }],
    };
    const dangling = mapService.applyApprovedProposal(tempRoot, {
      expectedDigest: currentSnapshot.contentDigest,
      patch: danglingPatch,
      patchDigest: computeMapChatProposalPatchDigest(danglingPatch),
    });
    assert.deepStrictEqual(dangling, {
      ok: false,
      code: APPLICATION_MAP_PROPOSAL_REASONS.INVALID_PATCH,
    });
    assert.strictEqual(
      mapService.readApplicationMapSnapshot(tempRoot).contentDigest,
      currentSnapshot.contentDigest,
    );

  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

run()
  .then(() => {
    console.log('application-map-service.test.js: ok');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
