const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createIpcSecurity } = require('../main/security/ipc_security');
const { createProjectAccess } = require('../main/security/project_access');
const { createSecretStore } = require('../main/security/secret_store');
const { normalizeExternalUrl, normalizePreviewOpenUrl } = require('../main/security/url_policy');

function getExpectedPhysicalRootIdentity(rootPath) {
  const target = fs.statSync(rootPath);
  const entry = fs.lstatSync(rootPath);
  return {
    device: String(target.dev),
    inode: String(target.ino),
    entryDevice: String(entry.dev),
    entryInode: String(entry.ino),
    entryType: entry.isSymbolicLink() ? 'symlink' : 'directory',
  };
}

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
  const strictSecretStore = createSecretStore({ allowPlaintextFallback: false, safeStorage: null });
  assert.strictEqual(strictSecretStore.protectSecret('abc123'), '');
  assert.strictEqual(strictSecretStore.unprotectSecret('plain:v1:YWJjMTIz'), 'abc123');
  assert.strictEqual(normalizeExternalUrl('https://github.com/example/repo').ok, true);
  assert.strictEqual(normalizeExternalUrl('https://aistudio.google.com/app/apikey').ok, true);
  assert.strictEqual(normalizeExternalUrl('https://cloud.sambanova.ai/').ok, true);
  assert.strictEqual(normalizeExternalUrl('https://platform.openai.com/api-keys').ok, true);
  assert.strictEqual(normalizeExternalUrl('https://platform.deepseek.com/api_keys').ok, true);
  assert.strictEqual(normalizeExternalUrl('http://github.com/example/repo').ok, false);
  assert.strictEqual(normalizeExternalUrl('file:///tmp/x').ok, false);
  assert.strictEqual(normalizeExternalUrl('https://example.com').ok, false);
  assert.strictEqual(normalizeExternalUrl('https://github.com.evil.test/example/repo').ok, false);
  assert.strictEqual(normalizeExternalUrl('https://token:secret@github.com/example/repo').ok, false);
  assert.strictEqual(normalizeExternalUrl('https://accounts.google.com/o/oauth2/v2/auth').ok, true);
  assert.strictEqual(normalizePreviewOpenUrl('file:///tmp/faber-preview/index.html').ok, true);
  assert.strictEqual(normalizePreviewOpenUrl('http://127.0.0.1:41231/').ok, true);
  assert.strictEqual(normalizePreviewOpenUrl('http://localhost:41231/').ok, true);
  assert.strictEqual(normalizePreviewOpenUrl('http://[::1]:41231/').ok, true);
  assert.strictEqual(normalizePreviewOpenUrl('https://github.com/example/repo').ok, false);
  assert.strictEqual(normalizePreviewOpenUrl('http://example.com/').ok, false);
  assert.strictEqual(normalizePreviewOpenUrl('javascript:alert(1)').ok, false);
  assert.strictEqual(normalizePreviewOpenUrl('http://user:pass@127.0.0.1:41231/').ok, false);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-security-'));
  try {
    const projectRoot = path.join(tempRoot, 'project');
    const projectBRoot = path.join(tempRoot, 'project-b');
    const archivedRoot = path.join(tempRoot, 'archived');
    const deletedRoot = path.join(tempRoot, 'deleted');
    const outsideRoot = path.join(tempRoot, 'outside');
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.mkdirSync(projectBRoot, { recursive: true });
    fs.mkdirSync(archivedRoot, { recursive: true });
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
          { id: 'project-b', rootPath: projectBRoot, state: 'active' },
          { id: 'archived', rootPath: archivedRoot, state: 'archived' },
          { id: 'deleted', rootPath: deletedRoot, state: 'deleted' },
        ],
      }),
    });

    assert.strictEqual(projectAccess.authorizeRootPath(projectRoot).ok, true);
    assert.strictEqual(projectAccess.authorizeRootPath(deletedRoot).ok, false);
    assert.strictEqual(projectAccess.authorizeRootPath(outsideRoot).ok, false);
    assert.deepStrictEqual(projectAccess.authorizeProjectBinding('active', projectRoot), {
      ok: true,
      authorized: true,
      projectId: 'active',
      canonicalRootPath: projectRoot,
      rootPath: projectRoot,
      realRootPath: fs.realpathSync(projectRoot),
      physicalRootIdentity: getExpectedPhysicalRootIdentity(projectRoot),
    });
    assert.deepStrictEqual(projectAccess.authorizeProjectRootBinding(projectRoot), {
      ok: true,
      authorized: true,
      projectId: 'active',
      canonicalRootPath: projectRoot,
      rootPath: projectRoot,
      realRootPath: fs.realpathSync(projectRoot),
      physicalRootIdentity: getExpectedPhysicalRootIdentity(projectRoot),
    });
    assert.strictEqual(projectAccess.authorizeProjectBinding('active', projectBRoot).ok, false);
    assert.strictEqual(projectAccess.authorizeProjectBinding('missing', projectRoot).ok, false);
    assert.strictEqual(projectAccess.authorizeProjectBinding('deleted', deletedRoot).ok, false);
    assert.strictEqual(projectAccess.authorizeProjectBinding('archived', archivedRoot).ok, true);
    assert.strictEqual(projectAccess.authorizeProjectRootBinding(projectBRoot).projectId, 'project-b');
    assert.strictEqual(projectAccess.authorizeProjectRootBinding(archivedRoot).projectId, 'archived');
    assert.strictEqual(projectAccess.authorizeProjectRootBinding(deletedRoot).ok, false);
    assert.strictEqual(projectAccess.authorizeProjectRootBinding(outsideRoot).ok, false);
    assert.strictEqual(projectAccess.normalizeProjectInfo({ rootPath: projectRoot, name: 'Projeto' }).ok, true);
    assert.strictEqual(
      projectAccess.normalizeProjectInfo(
        { rootPath: projectRoot, requireProjectBinding: false },
        { requireProjectBinding: true }
      ).ok,
      false
    );
    assert.strictEqual(
      projectAccess.normalizeProjectInfo({ rootPath: projectRoot }, { requireProjectBinding: true }).ok,
      false
    );
    const stronglyBoundProject = projectAccess.normalizeProjectInfo({
      id: 'active',
      projectId: 'active',
      rootPath: projectRoot,
      canonicalRootPath: outsideRoot,
      realRootPath: outsideRoot,
      authorized: false,
      name: 'Projeto',
    });
    assert.strictEqual(stronglyBoundProject.ok, true);
    assert.strictEqual(stronglyBoundProject.projectInfo.id, 'active');
    assert.strictEqual(stronglyBoundProject.projectInfo.projectId, 'active');
    assert.strictEqual(stronglyBoundProject.projectInfo.rootPath, projectRoot);
    assert.strictEqual(stronglyBoundProject.projectInfo.canonicalRootPath, projectRoot);
    assert.strictEqual(stronglyBoundProject.projectInfo.realRootPath, fs.realpathSync(projectRoot));
    assert.strictEqual(stronglyBoundProject.projectInfo.authorized, true);
    assert.strictEqual(
      projectAccess.normalizeProjectInfo(
        { id: 'active', rootPath: projectRoot },
        { requireProjectBinding: true }
      ).ok,
      true
    );
    assert.strictEqual(
      projectAccess.normalizeProjectInfo({ projectId: 'active', rootPath: projectRoot }).ok,
      true
    );
    assert.strictEqual(projectAccess.normalizeProjectInfo({ id: '', rootPath: projectRoot }).ok, false);
    assert.strictEqual(
      projectAccess.normalizeProjectInfo({ id: '', rootPath: projectRoot }, { requireProjectBinding: false }).ok,
      false
    );
    assert.strictEqual(
      projectAccess.normalizeProjectInfo({ id: 'active', projectId: 'project-b', rootPath: projectRoot }).ok,
      false
    );
    assert.strictEqual(projectAccess.resolveInsideRoot(projectRoot, 'src/ok.txt').ok, true);
    assert.strictEqual(projectAccess.resolveInsideRoot(projectRoot, '../outside/secret.txt').ok, false);
    assert.strictEqual(projectAccess.resolveInsideRoot(projectRoot, path.join(projectRoot, 'src', 'ok.txt')).ok, false);
    if (fs.existsSync(path.join(projectRoot, 'external-link'))) {
      assert.strictEqual(projectAccess.resolveInsideRoot(projectRoot, 'external-link').ok, false);
      assert.strictEqual(projectAccess.resolveInsideRoot(projectRoot, 'external-link/secret.txt').ok, false);
    }

    const duplicateIdAccess = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot: () => ({
        projects: [
          { id: 'duplicate', rootPath: projectRoot, state: 'active' },
          { id: 'duplicate', rootPath: projectBRoot, state: 'active' },
        ],
      }),
    });
    assert.strictEqual(duplicateIdAccess.authorizeProjectBinding('duplicate', projectRoot).ok, false);
    assert.strictEqual(duplicateIdAccess.authorizeProjectRootBinding(projectRoot).ok, false);

    const duplicateRootAccess = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot: () => ({
        projects: [
          { id: 'duplicate-root-a', rootPath: projectRoot, state: 'active' },
          { id: 'duplicate-root-b', rootPath: projectRoot, state: 'active' },
        ],
      }),
    });
    assert.strictEqual(duplicateRootAccess.authorizeProjectBinding('duplicate-root-a', projectRoot).ok, false);
    assert.strictEqual(duplicateRootAccess.authorizeProjectRootBinding(projectRoot).ok, false);

    const invalidRecordAccess = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot: () => ({
        projects: [{ id: 'invalid', rootPath: projectRoot, state: 'unknown' }],
      }),
    });
    assert.strictEqual(invalidRecordAccess.authorizeProjectBinding('invalid', projectRoot).ok, false);
    assert.strictEqual(invalidRecordAccess.authorizeProjectRootBinding(projectRoot).ok, false);

    const relativeRootAccess = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot: () => ({
        projects: [{ id: 'relative', rootPath: '.', state: 'active' }],
      }),
    });
    assert.strictEqual(relativeRootAccess.authorizeProjectBinding('relative', '.').ok, false);
    assert.strictEqual(relativeRootAccess.authorizeProjectRootBinding('.').ok, false);

    const filesystemRoot = path.parse(projectRoot).root;
    const filesystemRootAccess = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot: () => ({
        projects: [{ id: 'filesystem-root', rootPath: filesystemRoot, state: 'active' }],
      }),
    });
    assert.strictEqual(
      filesystemRootAccess.authorizeProjectBinding('filesystem-root', filesystemRoot).ok,
      false
    );
    assert.strictEqual(filesystemRootAccess.authorizeProjectRootBinding(filesystemRoot).ok, false);
    const filesystemRootLink = path.join(tempRoot, 'filesystem-root-link');
    try {
      fs.symlinkSync(filesystemRoot, filesystemRootLink, 'dir');
    } catch {
      // Ambientes sem permissao para symlink ainda validam a raiz literal.
    }
    if (fs.existsSync(filesystemRootLink)) {
      const filesystemRootLinkAccess = createProjectAccess({
        fs,
        path,
        readProjectsSnapshot: () => ({
          projects: [{ id: 'filesystem-root-link', rootPath: filesystemRootLink, state: 'active' }],
        }),
      });
      assert.strictEqual(
        filesystemRootLinkAccess.authorizeProjectBinding('filesystem-root-link', filesystemRootLink).ok,
        false
      );
      assert.strictEqual(filesystemRootLinkAccess.authorizeProjectRootBinding(filesystemRootLink).ok, false);
    }
    assert.strictEqual(projectAccess.authorizeProjectBinding('active', `${projectRoot}\0`).ok, false);
    assert.strictEqual(projectAccess.authorizeProjectRootBinding(`${projectRoot}\0`).ok, false);

    let snapshotRecordGetterReads = 0;
    const accessorRecord = { rootPath: projectRoot, state: 'active' };
    Object.defineProperty(accessorRecord, 'id', {
      enumerable: true,
      get() {
        snapshotRecordGetterReads += 1;
        throw new Error('snapshot getter must not execute');
      },
    });
    const accessorRecordAccess = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot: () => ({ projects: [accessorRecord] }),
    });
    assert.strictEqual(accessorRecordAccess.authorizeProjectBinding('active', projectRoot).ok, false);
    assert.strictEqual(accessorRecordAccess.authorizeProjectRootBinding(projectRoot).ok, false);
    assert.strictEqual(snapshotRecordGetterReads, 0);

    const inheritedRecord = Object.create({ id: 'active', rootPath: projectRoot, state: 'active' });
    const inheritedRecordAccess = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot: () => ({ projects: [inheritedRecord] }),
    });
    assert.strictEqual(inheritedRecordAccess.authorizeProjectBinding('active', projectRoot).ok, false);
    assert.strictEqual(inheritedRecordAccess.authorizeProjectRootBinding(projectRoot).ok, false);

    let snapshotGetterReads = 0;
    const accessorSnapshot = {};
    Object.defineProperty(accessorSnapshot, 'projects', {
      enumerable: true,
      get() {
        snapshotGetterReads += 1;
        throw new Error('snapshot projects getter must not execute');
      },
    });
    const accessorSnapshotAccess = createProjectAccess({ fs, path, readProjectsSnapshot: () => accessorSnapshot });
    assert.strictEqual(accessorSnapshotAccess.authorizeProjectBinding('active', projectRoot).ok, false);
    assert.strictEqual(accessorSnapshotAccess.authorizeProjectRootBinding(projectRoot).ok, false);
    assert.strictEqual(snapshotGetterReads, 0);

    let projectInfoGetterReads = 0;
    const accessorProjectInfo = { rootPath: projectRoot };
    Object.defineProperty(accessorProjectInfo, 'id', {
      enumerable: true,
      get() {
        projectInfoGetterReads += 1;
        throw new Error('projectInfo getter must not execute');
      },
    });
    assert.strictEqual(
      projectAccess.normalizeProjectInfo(accessorProjectInfo).ok,
      false
    );
    assert.strictEqual(projectInfoGetterReads, 0);

    const inheritedProjectInfo = Object.create({ id: 'active' });
    inheritedProjectInfo.rootPath = projectRoot;
    assert.strictEqual(
      projectAccess.normalizeProjectInfo(inheritedProjectInfo).ok,
      false
    );
    const hostileProjectInfoProxy = new Proxy(
      { id: 'active', rootPath: projectRoot },
      { ownKeys() { throw new Error('hostile ownKeys'); } }
    );
    assert.doesNotThrow(() => projectAccess.normalizeProjectInfo(hostileProjectInfoProxy));
    assert.strictEqual(projectAccess.normalizeProjectInfo(hostileProjectInfoProxy).ok, false);

    const nullPrototypeProjectInfo = Object.create(null);
    nullPrototypeProjectInfo.id = 'active';
    nullPrototypeProjectInfo.rootPath = projectRoot;
    assert.strictEqual(projectAccess.normalizeProjectInfo(nullPrototypeProjectInfo).ok, true);

    let optionGetterReads = 0;
    const accessorOptions = {};
    Object.defineProperty(accessorOptions, 'requireProjectBinding', {
      enumerable: true,
      get() {
        optionGetterReads += 1;
        throw new Error('option getter must not execute');
      },
    });
    assert.strictEqual(projectAccess.normalizeProjectInfo({ rootPath: projectRoot }, accessorOptions).ok, false);
    assert.strictEqual(optionGetterReads, 0);

    const windowsPath = path.win32;
    const windowsDirectoryStats = {
      dev: 7,
      ino: 11,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
    const windowsLikeFs = {
      lstatSync: () => windowsDirectoryStats,
      realpathSync: (value) => value,
      statSync: () => windowsDirectoryStats,
    };
    const windowsCaseAliasAccess = createProjectAccess({
      fs: windowsLikeFs,
      path: windowsPath,
      readProjectsSnapshot: () => ({
        projects: [
          { id: 'windows-a', rootPath: 'C:\\Workspace\\App', state: 'active' },
          { id: 'windows-b', rootPath: 'c:\\workspace\\app', state: 'active' },
        ],
      }),
    });
    assert.strictEqual(
      windowsCaseAliasAccess.authorizeProjectBinding('windows-a', 'C:\\Workspace\\App').ok,
      false
    );
    assert.strictEqual(
      windowsCaseAliasAccess.authorizeProjectRootBinding('C:\\Workspace\\App').ok,
      false
    );

    const caseAliasRoot = path.join(tempRoot, 'PROJECT-B');
    if (fs.existsSync(caseAliasRoot)) {
      const baseStats = fs.statSync(projectBRoot);
      const aliasStats = fs.statSync(caseAliasRoot);
      if (baseStats.dev === aliasStats.dev && baseStats.ino === aliasStats.ino) {
        const caseAliasAccess = createProjectAccess({
          fs,
          path,
          readProjectsSnapshot: () => ({
            projects: [
              { id: 'case-a', rootPath: projectBRoot, state: 'active' },
              { id: 'case-b', rootPath: caseAliasRoot, state: 'active' },
            ],
          }),
        });
        assert.strictEqual(caseAliasAccess.authorizeProjectBinding('case-a', projectBRoot).ok, false);
        assert.strictEqual(caseAliasAccess.authorizeProjectRootBinding(projectBRoot).ok, false);
      }
    }

    const symlinkProjectRoot = path.join(tempRoot, 'project-link');
    try {
      fs.symlinkSync(projectBRoot, symlinkProjectRoot, 'dir');
    } catch {
      // Ambientes sem permissao para symlink ainda validam os demais guardrails.
    }
    if (fs.existsSync(symlinkProjectRoot)) {
      const symlinkAccess = createProjectAccess({
        fs,
        path,
        readProjectsSnapshot: () => ({
          projects: [{ id: 'symlink', rootPath: symlinkProjectRoot, state: 'active' }],
        }),
      });
      const symlinkBinding = symlinkAccess.authorizeProjectBinding('symlink', symlinkProjectRoot);
      assert.strictEqual(symlinkBinding.ok, true);
      assert.strictEqual(symlinkBinding.canonicalRootPath, symlinkProjectRoot);
      assert.strictEqual(symlinkBinding.realRootPath, fs.realpathSync(projectBRoot));
      assert.deepStrictEqual(
        symlinkAccess.authorizeProjectRootBinding(symlinkProjectRoot),
        symlinkBinding
      );
      assert.strictEqual(symlinkAccess.authorizeProjectBinding('symlink', projectBRoot).ok, false);

      const physicalAliasAccess = createProjectAccess({
        fs,
        path,
        readProjectsSnapshot: () => ({
          projects: [
            { id: 'physical', rootPath: projectBRoot, state: 'active' },
            { id: 'symlink', rootPath: symlinkProjectRoot, state: 'active' },
          ],
        }),
      });
      assert.strictEqual(physicalAliasAccess.authorizeProjectBinding('physical', projectBRoot).ok, false);
      assert.strictEqual(physicalAliasAccess.authorizeProjectRootBinding(projectBRoot).ok, false);

      const swapLink = path.join(tempRoot, 'swap-link');
      fs.symlinkSync(projectBRoot, swapLink, 'dir');
      let swapRealpathCalls = 0;
      const swappingFs = Object.create(fs);
      swappingFs.realpathSync = (candidatePath) => {
        const result = fs.realpathSync(candidatePath);
        if (candidatePath === swapLink) {
          swapRealpathCalls += 1;
          if (swapRealpathCalls === 2) {
            fs.unlinkSync(swapLink);
            fs.symlinkSync(outsideRoot, swapLink, 'dir');
          }
        }
        return result;
      };
      const swappingAccess = createProjectAccess({
        fs: swappingFs,
        path,
        readProjectsSnapshot: () => ({
          projects: [{ id: 'swap', rootPath: swapLink, state: 'active' }],
        }),
      });
      assert.strictEqual(swappingAccess.authorizeProjectBinding('swap', swapLink).ok, false);
      assert.strictEqual(fs.realpathSync(swapLink), fs.realpathSync(outsideRoot));

      const rootBindingSwapLink = path.join(tempRoot, 'root-binding-swap-link');
      fs.symlinkSync(projectBRoot, rootBindingSwapLink, 'dir');
      let rootBindingRealpathCalls = 0;
      const rootBindingSwappingFs = Object.create(fs);
      rootBindingSwappingFs.realpathSync = (candidatePath) => {
        const result = fs.realpathSync(candidatePath);
        if (candidatePath === rootBindingSwapLink) {
          rootBindingRealpathCalls += 1;
          if (rootBindingRealpathCalls === 2) {
            fs.unlinkSync(rootBindingSwapLink);
            fs.symlinkSync(outsideRoot, rootBindingSwapLink, 'dir');
          }
        }
        return result;
      };
      const rootBindingSwappingAccess = createProjectAccess({
        fs: rootBindingSwappingFs,
        path,
        readProjectsSnapshot: () => ({
          projects: [{ id: 'root-binding-swap', rootPath: rootBindingSwapLink, state: 'active' }],
        }),
      });
      assert.strictEqual(rootBindingSwappingAccess.authorizeProjectRootBinding(rootBindingSwapLink).ok, false);
      assert.strictEqual(fs.realpathSync(rootBindingSwapLink), fs.realpathSync(outsideRoot));
    }

    let changingSnapshotReads = 0;
    const changingSnapshotAccess = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot: () => {
        changingSnapshotReads += 1;
        return {
          projects: [{
            id: changingSnapshotReads === 1 ? 'initial-id' : 'changed-id',
            rootPath: projectRoot,
            state: 'active',
          }],
        };
      },
    });
    assert.strictEqual(changingSnapshotAccess.authorizeProjectRootBinding(projectRoot).ok, false);
    assert.strictEqual(changingSnapshotReads, 2);

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

    let scannedGetterReads = 0;
    const accessorScanAccess = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot: () => ({
        projects: [{ id: 'active', rootPath: projectRoot, state: 'active' }],
      }),
      scanProject: () => {
        const scanned = { rootPath: projectRoot };
        Object.defineProperty(scanned, 'totalFiles', {
          enumerable: true,
          get() {
            scannedGetterReads += 1;
            throw new Error('scan getter must not execute');
          },
        });
        return scanned;
      },
    });
    assert.strictEqual(
      accessorScanAccess.normalizeProjectInfo({ id: 'active', rootPath: projectRoot }).ok,
      false
    );
    assert.strictEqual(scannedGetterReads, 0);
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
