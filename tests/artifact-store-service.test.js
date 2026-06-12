const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createArtifactStoreService,
} = require('../main/services/artifact_store_service');

function run() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-artifact-store-project-'));
  const sourcePath = path.join(os.tmpdir(), `faber-artifact-source-${Date.now()}.txt`);
  fs.writeFileSync(sourcePath, 'visual evidence', 'utf8');
  try {
    const service = createArtifactStoreService({
      crypto,
      fs,
      path,
      now: () => '2026-05-28T13:00:00.000Z',
      idFactory: () => 'artifact-id',
    });

    const stored = service.storeArtifact({
      rootPath,
      sourcePath,
      kind: 'screenshot',
      category: 'visual_capture',
      label: 'desktop',
      metadata: { viewport: { width: 1365, height: 768 } },
    });
    assert.strictEqual(stored.ok, true);
    assert.ok(stored.relativePath.startsWith('.faber/artifacts/2026-05-28/'));
    assert.strictEqual(fs.existsSync(stored.path), true);

    const listed = service.listArtifacts({ rootPath });
    assert.strictEqual(listed.ok, true);
    assert.strictEqual(listed.artifacts.length, 1);
    assert.strictEqual(listed.artifacts[0].kind, 'screenshot');
    assert.strictEqual(listed.artifacts[0].sha256.length, 64);
    assert.deepStrictEqual(listed.artifacts[0].metadata.viewport, { width: 1365, height: 768 });

    console.log('artifact-store-service.test.js: ok');
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
    fs.rmSync(sourcePath, { force: true });
  }
}

run();
