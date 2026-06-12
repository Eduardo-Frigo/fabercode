const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createMemoryEvidenceLedgerService,
} = require('../main/services/memory_evidence_ledger_service');

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-memory-ledger-'));
  try {
    const service = createMemoryEvidenceLedgerService({
      fs,
      path,
      now: () => '2026-05-27T12:00:00.000Z',
      idFactory: () => 'entry-1',
    });
    const appended = service.appendMemoryEvidence({
      action: 'build_active_memory',
      ok: true,
      projectInfo: { id: 'project-1', rootPath: tempRoot },
      jobId: 'job-1',
      query: 'usar memoria ativa',
      decision: { routeContextAvailable: true },
      provenance: {
        schemaVersion: 'memory-provenance-v1',
        used: [{ title: 'MemPalace', confidenceScore: 0.7 }],
        blocked: [{ title: 'RAG antigo', blockedReason: 'below_confidence_threshold' }],
      },
      contextFrame: {
        dominantSource: 'active_memory',
        allowedSources: ['current_message', 'active_memory'],
        blockedSources: [],
      },
    });
    assert.strictEqual(appended.ok, true);
    assert.strictEqual(fs.existsSync(appended.path), true);

    const listed = service.listMemoryEvidence({
      projectInfo: { rootPath: tempRoot },
      jobId: 'job-1',
    });
    assert.strictEqual(listed.ok, true);
    assert.strictEqual(listed.entries.length, 1);
    assert.strictEqual(listed.entries[0].action, 'build_active_memory');
    assert.strictEqual(listed.entries[0].contextFrame.dominantSource, 'active_memory');
    assert.strictEqual(listed.entries[0].provenance.used.length, 1);

    const listedAll = service.listMemoryEvidence({
      projectInfo: { rootPath: tempRoot },
      limit: 10,
    });
    assert.strictEqual(listedAll.entries.length, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('memory-evidence-ledger-service.test.js: ok');
}

run();
