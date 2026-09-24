const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCommandRunner } = require('../main/services/command_runner');
const { buildDesktopToolPath } = require('../main/services/desktop_tool_path_service');
const { createHostRequirementsService } = require('../main/services/host_requirements_service');

async function run() {
  const restrictedPath = process.platform === 'win32'
    ? 'C:\\Windows\\System32;C:\\Windows'
    : '/usr/bin:/bin:/usr/sbin:/sbin';
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-desktop-path-'));
  try {
    const nvmBin = path.join(temporaryHome, '.nvm', 'versions', 'node', 'v24.18.0', 'bin');
    fs.mkdirSync(nvmBin, { recursive: true });
    fs.writeFileSync(path.join(nvmBin, 'node'), '#!/bin/sh\necho v24.18.0\n', { mode: 0o755 });
    const withNvm = buildDesktopToolPath({
      env: { HOME: temporaryHome, PATH: restrictedPath },
      platform: 'darwin',
      systemBinDirs: [],
    });
    assert.strictEqual(withNvm, `${restrictedPath}${path.delimiter}${nvmBin}`);
    assert.strictEqual(buildDesktopToolPath({
      env: { HOME: temporaryHome, PATH: withNvm },
      platform: 'darwin',
      systemBinDirs: [],
    }), withNvm);
    assert.strictEqual(buildDesktopToolPath({
      env: { HOME: temporaryHome, PATH: restrictedPath },
      platform: 'win32',
    }), restrictedPath);

    if (process.platform === 'darwin') {
      const emptyBin = path.join(temporaryHome, 'empty-bin');
      fs.mkdirSync(emptyBin);
      const guiEnv = { HOME: temporaryHome, PATH: emptyBin };
      const runner = createCommandRunner({ processEnv: guiEnv });
      assert.strictEqual((await runner.runCommand('node', ['--version'])).ok, false);
      guiEnv.PATH = buildDesktopToolPath({ env: guiEnv, systemBinDirs: [] });
      const found = await runner.runCommand('node', ['--version']);
      assert.strictEqual(found.ok, true, found.stderr);
      assert.strictEqual(found.stdout.trim(), 'v24.18.0');
    }

    const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-other-user-'));
    try {
      const fnmBin = path.join(otherHome, '.local', 'share', 'fnm', 'node-versions', 'v22.23.2', 'installation', 'bin');
      const otherEnv = { HOME: otherHome, PATH: restrictedPath };
      const service = createHostRequirementsService({
        platform: 'darwin',
        refreshPath: () => {
          otherEnv.PATH = buildDesktopToolPath({
            env: otherEnv,
            platform: 'darwin',
            systemBinDirs: [],
          });
        },
        runCommand: async (command) => ({
          ok: command === 'git' || otherEnv.PATH.split(path.delimiter).includes(fnmBin),
          stdout: command === 'git' ? 'git version 2.50.1' : 'v22.23.2',
        }),
      });
      assert.strictEqual((await service.getHostRequirements()).ready, false);
      fs.mkdirSync(fnmBin, { recursive: true });
      fs.writeFileSync(path.join(fnmBin, 'node'), '', { mode: 0o755 });
      assert.strictEqual((await service.getHostRequirements()).ready, true,
        'Verificar novamente must discover Node installed after the app launched');
    } finally {
      fs.rmSync(otherHome, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }

  console.log('desktop-tool-path-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
