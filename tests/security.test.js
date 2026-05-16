const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createIpcSecurity } = require('../main/security/ipc_security');
const { createProjectAccess } = require('../main/security/project_access');
const { createSecretStore } = require('../main/security/secret_store');
const { normalizeExternalUrl } = require('../main/security/url_policy');

function run() {
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`locked:${value}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').replace(/^locked:/, ''),
  };
  const secretStore = createSecretStore({ safeStorage });
  const protectedValue = secretStore.protectSecret('abc123');

  assert.match(protectedValue, /^enc:v1:/);
  assert.strictEqual(secretStore.unprotectSecret(protectedValue), 'abc123');
  assert.strictEqual(secretStore.unprotectSecret('legacy-key'), 'legacy-key');
  assert.strictEqual(normalizeExternalUrl('https://github.com/example/repo').ok, true);
  assert.strictEqual(normalizeExternalUrl('https://aistudio.google.com/app/apikey').ok, true);
  assert.strictEqual(normalizeExternalUrl('https://cloud.sambanova.ai/').ok, true);
  assert.strictEqual(normalizeExternalUrl('https://platform.openai.com/api-keys').ok, true);
  assert.strictEqual(normalizeExternalUrl('https://platform.deepseek.com/api_keys').ok, true);
  assert.strictEqual(normalizeExternalUrl('file:///tmp/x').ok, false);
  assert.strictEqual(normalizeExternalUrl('https://example.com').ok, false);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-security-'));
  try {
    const projectRoot = path.join(tempRoot, 'project');
    const deletedRoot = path.join(tempRoot, 'deleted');
    const outsideRoot = path.join(tempRoot, 'outside');
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.mkdirSync(deletedRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'ok.txt'), 'ok', 'utf8');
    fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), 'secret', 'utf8');

    try {
      fs.symlinkSync(outsideRoot, path.join(projectRoot, 'external-link'), 'dir');
    } catch {
      // Ambientes sem permissao para symlink ainda validam os demais guardrails.
    }

    const projectAccess = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot: () => ({
        projects: [
          { id: 'active', rootPath: projectRoot, state: 'active' },
          { id: 'deleted', rootPath: deletedRoot, state: 'deleted' },
        ],
      }),
    });

    assert.strictEqual(projectAccess.authorizeRootPath(projectRoot).ok, true);
    assert.strictEqual(projectAccess.authorizeRootPath(deletedRoot).ok, false);
    assert.strictEqual(projectAccess.authorizeRootPath(outsideRoot).ok, false);
    assert.strictEqual(projectAccess.normalizeProjectInfo({ rootPath: projectRoot, name: 'Projeto' }).ok, true);
    assert.strictEqual(projectAccess.resolveInsideRoot(projectRoot, 'src/ok.txt').ok, true);
    assert.strictEqual(projectAccess.resolveInsideRoot(projectRoot, '../outside/secret.txt').ok, false);
    assert.strictEqual(projectAccess.resolveInsideRoot(projectRoot, path.join(projectRoot, 'src', 'ok.txt')).ok, false);
    if (fs.existsSync(path.join(projectRoot, 'external-link'))) {
      assert.strictEqual(projectAccess.resolveInsideRoot(projectRoot, 'external-link/secret.txt').ok, false);
    }

    const rescanningProjectAccess = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot: () => ({
        projects: [{ id: 'active', rootPath: projectRoot, state: 'active' }],
      }),
      scanProject: (rootPath) => ({
        rootPath,
        totalFiles: 0,
        files: [],
        stacks: ['Projeto genérico'],
        counters: {},
      }),
    });
    const staleInfo = rescanningProjectAccess.normalizeProjectInfo({
      rootPath: projectRoot,
      totalFiles: 99,
      files: ['stale.js'],
      stacks: ['Stale'],
    });
    assert.strictEqual(staleInfo.ok, true);
    assert.strictEqual(staleInfo.projectInfo.totalFiles, 0);
    assert.deepStrictEqual(staleInfo.projectInfo.files, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const trustedSender = { id: 'trusted' };
  const untrustedSender = { id: 'untrusted' };
  const mainWindow = {
    webContents: trustedSender,
    isDestroyed: () => false,
  };
  const ipcSecurity = createIpcSecurity({ getMainWindow: () => mainWindow });
  assert.strictEqual(ipcSecurity.validateSender({ sender: trustedSender }).ok, true);
  assert.strictEqual(ipcSecurity.validateSender({ sender: untrustedSender }).ok, false);

  let called = false;
  const wrapped = ipcSecurity.wrapHandler(async () => {
    called = true;
    return { ok: true };
  });
  return Promise.resolve()
    .then(() => wrapped({ sender: untrustedSender }))
    .then((result) => {
      assert.strictEqual(result.ok, false);
      assert.strictEqual(called, false);
      return wrapped({ sender: trustedSender });
    })
    .then((result) => {
      assert.strictEqual(result.ok, true);
      assert.strictEqual(called, true);
      console.log('security.test.js: ok');
    });
}

Promise.resolve(run()).catch((error) => {
  console.error(error);
  process.exit(1);
});
