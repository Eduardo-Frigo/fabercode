const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createAutomataExecutor } = require('../cortex/automata/core/executor');

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeRequestedRelativePath(value) {
  const text = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const normalized = path.posix.normalize(text);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') return '';
  return normalized;
}

function computeLineChangeStats(previous, next) {
  const previousLines = String(previous || '').split('\n');
  const nextLines = String(next || '').split('\n');
  return {
    added: Math.max(0, nextLines.length - previousLines.length),
    removed: Math.max(0, previousLines.length - nextLines.length),
  };
}

function mergeDiffStatsEntry(target, file, stats) {
  target[file] = stats;
}

function validateExecutionCommand(command) {
  if (!command || !command.root_path) return { ok: false, message: 'root_path ausente' };
  if (!['apply_file_patch', 'search_text_in_files', 'execute_operation_batch'].includes(command.task_type)) {
    return { ok: false, message: 'task_type inválido' };
  }
  return { ok: true };
}

function createExecutor(diffIngestions, fsOverride = fs) {
  return createAutomataExecutor({
    computeLineChangeStats,
    fs: fsOverride,
    hashText,
    ingestRuntimeDiffStats: (rootPath, diffStats) => diffIngestions.push({ rootPath, diffStats }),
    isTextLikeExtension: () => true,
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff: normalizeRequestedRelativePath,
    normalizeRequestedRelativePath,
    path,
    validateExecutionCommand,
  });
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-executor-'));
  const projectRoot = path.join(tempRoot, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    const diffIngestions = [];
    const executor = createExecutor(diffIngestions);

    const partialBatch = executor.executeOperationBatchAction({
      rootPath: projectRoot,
      operations: [
        { op: 'write_file', path: 'valid.txt', content: 'valid' },
        { op: 'delete_file', path: 'invalid.txt' },
      ],
    });
    assert.strictEqual(partialBatch.ok, false);
    assert.strictEqual(fs.existsSync(path.join(projectRoot, 'valid.txt')), false);

    fs.writeFileSync(path.join(projectRoot, 'existing.txt'), 'original', 'utf8');
    const failingFs = Object.create(fs);
    failingFs.writeFileSync = (targetPath, content, encoding) => {
      if (String(targetPath).endsWith(path.join('nested', 'fail.txt'))) {
        throw new Error('simulated disk failure');
      }
      return fs.writeFileSync(targetPath, content, encoding);
    };
    const failingExecutor = createExecutor(diffIngestions, failingFs);
    const failedMidWriteBatch = failingExecutor.executeOperationBatchAction({
      rootPath: projectRoot,
      operations: [
        { op: 'write_file', path: 'existing.txt', content: 'changed' },
        { op: 'write_file', path: 'nested/new.txt', content: 'new file' },
        { op: 'write_file', path: 'nested/fail.txt', content: 'boom' },
      ],
    });
    assert.strictEqual(failedMidWriteBatch.ok, false);
    assert.strictEqual(failedMidWriteBatch.rolledBack, true);
    assert.match(failedMidWriteBatch.message, /rollback aplicado/);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'existing.txt'), 'utf8'), 'original');
    assert.strictEqual(fs.existsSync(path.join(projectRoot, 'nested', 'new.txt')), false);
    assert.strictEqual(fs.existsSync(path.join(projectRoot, 'nested')), false);
    assert.strictEqual(diffIngestions.length, 0);

    const outsidePatch = executor.executePatchAction({
      type: 'apply_file_patch',
      rootPath: projectRoot,
      absoluteTarget: path.join(tempRoot, 'outside.txt'),
      targetFile: 'outside.txt',
      previousContentHash: hashText(''),
      nextContent: 'outside',
    });
    assert.strictEqual(outsidePatch.ok, false);
    assert.match(outsidePatch.message, /fora da raiz/);

    const commandPatch = executor.execute({
      rootPath: projectRoot,
      targetFile: 'contract.txt',
      previousContentHash: hashText(''),
      nextContent: 'contract ok',
      executionCommand: {
        protocol: 'persona.v1',
        task_type: 'apply_file_patch',
        target_file: 'contract.txt',
        previous_content_hash: hashText(''),
        next_content: 'contract ok',
      },
    });
    assert.strictEqual(commandPatch.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'contract.txt'), 'utf8'), 'contract ok');
    assert.strictEqual(diffIngestions.length, 1);

    console.log('automata-executor.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
