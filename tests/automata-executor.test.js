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
        { op: 'unsupported_op', path: 'invalid.txt' },
      ],
    });
    assert.strictEqual(partialBatch.ok, false);
    assert.strictEqual(fs.existsSync(path.join(projectRoot, 'valid.txt')), false);

    const sensitiveBatch = executor.executeOperationBatchAction({
      rootPath: projectRoot,
      operations: [
        { op: 'write_file', path: '.env', content: 'API_KEY=leaked' },
      ],
    });
    assert.strictEqual(sensitiveBatch.ok, false);
    assert.match(sensitiveBatch.message, /caminho sensível/);
    assert.strictEqual(fs.existsSync(path.join(projectRoot, '.env')), false);

    const sensitivePatch = executor.executePatchAction({
      type: 'apply_file_patch',
      rootPath: projectRoot,
      targetFile: '.ssh/id_rsa',
      previousContentHash: hashText(''),
      nextContent: 'PRIVATE KEY',
    });
    assert.strictEqual(sensitivePatch.ok, false);
    assert.match(sensitivePatch.message, /caminho sensível/);

    const envExampleBatch = executor.executeOperationBatchAction({
      rootPath: projectRoot,
      operations: [
        { op: 'write_file', path: '.env.example', content: 'AI_PROVIDER=mock' },
      ],
    });
    assert.strictEqual(envExampleBatch.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8'), 'AI_PROVIDER=mock');
    diffIngestions.length = 0;

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

    const outsideRoot = path.join(tempRoot, 'outside');
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), 'secret', 'utf8');
    try {
      fs.symlinkSync(outsideRoot, path.join(projectRoot, 'external-link'), 'dir');
    } catch {
      // Some environments do not allow symlinks; the remaining guardrails still run.
    }
    if (fs.existsSync(path.join(projectRoot, 'external-link'))) {
      const symlinkBatch = executor.executeOperationBatchAction({
        rootPath: projectRoot,
        operations: [
          { op: 'write_file', path: 'external-link/secret.txt', content: 'leaked' },
        ],
      });
      assert.strictEqual(symlinkBatch.ok, false);
      assert.match(symlinkBatch.message, /caminho físico fora da raiz/);
      assert.strictEqual(fs.readFileSync(path.join(outsideRoot, 'secret.txt'), 'utf8'), 'secret');

      const symlinkPatch = executor.executePatchAction({
        type: 'apply_file_patch',
        rootPath: projectRoot,
        targetFile: 'external-link/secret.txt',
        previousContentHash: hashText('secret'),
        nextContent: 'leaked',
      });
      assert.strictEqual(symlinkPatch.ok, false);
      assert.match(symlinkPatch.message, /caminho físico fora da raiz/);

      const symlinkSearch = executor.executeSearchTextAction({
        rootPath: projectRoot,
        targetText: 'secret',
      });
      assert.strictEqual(symlinkSearch.ok, true);
      assert.strictEqual(symlinkSearch.searchResults.length, 0);
    }

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

    const idempotentPatch = executor.executePatchAction({
      type: 'apply_file_patch',
      rootPath: projectRoot,
      targetFile: 'contract.txt',
      previousContentHash: hashText('contract ok'),
      nextContent: 'contract ok',
    });
    assert.strictEqual(idempotentPatch.ok, true);
    assert.deepStrictEqual(idempotentPatch.modifiedFiles, []);
    assert.deepStrictEqual(idempotentPatch.diffStats, {});

    const idempotentBatch = executor.executeOperationBatchAction({
      rootPath: projectRoot,
      operations: [
        { op: 'write_file', path: 'contract.txt', content: 'contract ok' },
      ],
    });
    assert.strictEqual(idempotentBatch.ok, true);
    assert.deepStrictEqual(idempotentBatch.modifiedFiles, []);
    assert.deepStrictEqual(idempotentBatch.diffStats, {});
    assert.strictEqual(diffIngestions.length, 1);

    fs.mkdirSync(path.join(projectRoot, 'app'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'app', 'globals.css'), 'body { margin: 0; }\n', 'utf8');
    const cssAppendBatch = executor.executeOperationBatchAction({
      rootPath: projectRoot,
      operations: [
        {
          op: 'append_file',
          path: 'app/globals.css',
          content: '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap");\n:root { --color-bg: #fff; }\n',
        },
      ],
    });
    assert.strictEqual(cssAppendBatch.ok, true);
    const normalizedCss = fs.readFileSync(path.join(projectRoot, 'app', 'globals.css'), 'utf8');
    assert.ok(normalizedCss.startsWith('@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap");'));
    assert.strictEqual(/body\s*\{[^}]*\}\s*@import/i.test(normalizedCss), false);

    // Test delete_file and delete_dir
    const testFile = path.join(projectRoot, 'to_be_deleted.txt');
    fs.writeFileSync(testFile, 'hello delete', 'utf8');
    const testDir = path.join(projectRoot, 'folder_to_delete');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'file1.txt'), 'content1', 'utf8');

    // Test successful deletion batch
    const deleteBatch = executor.executeOperationBatchAction({
      rootPath: projectRoot,
      operations: [
        { op: 'delete_file', path: 'to_be_deleted.txt' },
        { op: 'delete_dir', path: 'folder_to_delete' },
      ],
    });
    assert.strictEqual(deleteBatch.ok, true);
    assert.ok(deleteBatch.modifiedFiles.includes('to_be_deleted.txt'));
    assert.ok(deleteBatch.modifiedFiles.includes('folder_to_delete'));
    assert.strictEqual(fs.existsSync(testFile), false);
    assert.strictEqual(fs.existsSync(testDir), false);

    // Test rollback of deletion batch
    fs.writeFileSync(testFile, 'hello delete rollback', 'utf8');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'file1.txt'), 'content1 rollback', 'utf8');

    const failingDeleteBatch = executor.executeOperationBatchAction({
      rootPath: projectRoot,
      operations: [
        { op: 'delete_file', path: 'to_be_deleted.txt' },
        { op: 'delete_dir', path: 'folder_to_delete' },
        { op: 'unsupported_op', path: 'fail.txt' },
      ],
    });
    assert.strictEqual(failingDeleteBatch.ok, false);
    assert.strictEqual(fs.existsSync(testFile), true);
    assert.strictEqual(fs.readFileSync(testFile, 'utf8'), 'hello delete rollback');
    assert.strictEqual(fs.existsSync(path.join(testDir, 'file1.txt')), true);
    assert.strictEqual(fs.readFileSync(path.join(testDir, 'file1.txt'), 'utf8'), 'content1 rollback');

    console.log('automata-executor.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
