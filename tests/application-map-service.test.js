const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApplicationMapService } = require('../main/services/application_map_service');
const { createApplicationMapRenderService } = require('../main/services/application_map_render_service');

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-map-test-'));
  
  try {
    const mapService = createApplicationMapService({ fs, path });
    const renderService = createApplicationMapRenderService({ fs, path, mapService });

    // Test getMap on non-existent map (should return empty default map)
    const initialMap = mapService.getMap(tempRoot);
    assert.deepStrictEqual(initialMap.nodes, []);
    assert.deepStrictEqual(initialMap.edges, []);
    assert.deepStrictEqual(initialMap.viewport, { x: 0, y: 0, zoom: 1 });

    // Test saveMap
    const testMap = {
      nodes: [
        { id: 'node-1', type: 'group', title: 'Frontend', description: 'Web UI Component' },
        { id: 'node-2', type: 'text', title: 'Home Page', description: 'Landing page', parentId: 'node-1' }
      ],
      edges: [
        { id: 'edge-1', sourceNodeId: 'node-1', targetNodeId: 'node-2', type: 'contains' }
      ],
      viewport: { x: 10, y: 20, zoom: 1.5 }
    };
    const saveRes = mapService.saveMap(tempRoot, testMap);
    assert.strictEqual(saveRes.ok, true);

    const savedMap = mapService.getMap(tempRoot);
    assert.strictEqual(savedMap.nodes.length, 2);
    assert.strictEqual(savedMap.edges.length, 1);
    assert.strictEqual(savedMap.viewport.x, 10);
    assert.strictEqual(savedMap.viewport.zoom, 1.5);

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
