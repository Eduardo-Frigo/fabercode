const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function appBundlePath(executablePath) {
  const match = String(executablePath || '').match(/^(.*?\.app)\/Contents\/MacOS\/[^/]+$/);
  return match ? match[1] : '';
}

async function readPlistValue(plistPath, key, run = execFileAsync) {
  const { stdout } = await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath]);
  return String(stdout || '').trim();
}

function writeUpdaterScript(tempDir, contents) {
  const scriptPath = path.join(tempDir, 'apply-update.sh');
  fs.writeFileSync(scriptPath, contents, { mode: 0o700, flag: 'wx' });
  return scriptPath;
}

async function startDetached(command, args, app, spawnProcess = spawn) {
  const child = spawnProcess(command, args, { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  if (typeof child.unref === 'function') child.unref();
  app.exit(0);
}

async function prepareMacUpdate(options) {
  const { app, architecture, downloadedFile, latestVersion, tempDir,
    executablePath = process.execPath, run = execFileAsync, spawnProcess = spawn } = options;
  const target = appBundlePath(executablePath);
  if (!target || path.basename(target) !== 'Faber Code.app' || !fs.existsSync(target)) {
    throw new Error('Execute uma cópia instalada do Faber Code para usar a atualização interna.');
  }
  const parent = path.dirname(target);
  fs.accessSync(parent, fs.constants.W_OK);
  const suffix = crypto.randomBytes(8).toString('hex');
  const staged = path.join(parent, `.Faber Code.app.update-${suffix}`);
  const backup = path.join(parent, `.Faber Code.app.backup-${suffix}`);
  const mountPoint = path.join(tempDir, 'mount');
  let mounted = false;
  let scriptPath = '';
  try {
    await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, '-quiet', downloadedFile]);
    mounted = true;
    const source = path.join(mountPoint, 'Faber Code.app');
    if (!fs.statSync(source).isDirectory()) throw new Error('O DMG não contém o aplicativo esperado.');
    const plist = path.join(source, 'Contents', 'Info.plist');
    if (await readPlistValue(plist, 'CFBundleIdentifier', run) !== 'com.faber.code'
      || await readPlistValue(plist, 'CFBundleShortVersionString', run) !== latestVersion.replace(/^v/, '')) {
      throw new Error('O aplicativo no DMG não corresponde à versão verificada.');
    }
    const executable = path.join(source, 'Contents', 'MacOS', 'Faber Code');
    const { stdout: architectures } = await run('/usr/bin/lipo', ['-archs', executable]);
    if (!String(architectures).trim().split(/\s+/).includes(architecture)) {
      throw new Error('O aplicativo no DMG não corresponde à arquitetura deste Mac.');
    }
    await run('/usr/bin/ditto', [source, staged]);
    const stagedVersion = await readPlistValue(path.join(staged, 'Contents', 'Info.plist'), 'CFBundleShortVersionString', run);
    if (stagedVersion !== latestVersion.replace(/^v/, '')) throw new Error('Falha ao preparar a nova versão.');
  } catch (error) {
    fs.rmSync(staged, { recursive: true, force: true });
    throw error;
  } finally {
    if (mounted) {
      try {
        await run('/usr/bin/hdiutil', ['detach', mountPoint, '-quiet']);
      } catch (error) {
        fs.rmSync(staged, { recursive: true, force: true });
        throw error;
      }
    }
  }

  const script = `#!/bin/bash
set -euo pipefail
TARGET=${shellQuote(target)}
STAGED=${shellQuote(staged)}
BACKUP=${shellQuote(backup)}
SOURCE_PID=${Number(process.pid)}
for attempt in {1..120}; do
  if ! kill -0 "$SOURCE_PID" 2>/dev/null; then break; fi
  sleep 0.5
done
if kill -0 "$SOURCE_PID" 2>/dev/null; then exit 1; fi
mv "$TARGET" "$BACKUP"
if ! mv "$STAGED" "$TARGET"; then
  mv "$BACKUP" "$TARGET"
  exit 1
fi
if ! /usr/bin/open -n "$TARGET"; then
  mv "$TARGET" "$STAGED"
  mv "$BACKUP" "$TARGET"
  /usr/bin/open "$TARGET" || true
  exit 1
fi
rm -rf "$BACKUP" "$STAGED" ${shellQuote(downloadedFile)}
rm -f "$0"
`;
  scriptPath = writeUpdaterScript(tempDir, script);
  return {
    start: () => startDetached('/bin/bash', [scriptPath], app, spawnProcess),
    cancel: () => {
      fs.rmSync(staged, { recursive: true, force: true });
      fs.rmSync(scriptPath, { force: true });
    },
  };
}

function prepareWindowsUpdate(options) {
  const { app, downloadedFile, spawnProcess = spawn } = options;
  return {
    start: () => startDetached(downloadedFile, ['/S'], app, spawnProcess),
    cancel: () => {},
  };
}

function prepareLinuxUpdate(options) {
  const { app, downloadedFile, tempDir, executablePath = process.env.APPIMAGE,
    spawnProcess = spawn } = options;
  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error('A atualização interna no Linux requer que o Faber Code esteja em execução como AppImage.');
  }
  const parent = path.dirname(executablePath);
  fs.accessSync(parent, fs.constants.W_OK);
  const suffix = crypto.randomBytes(8).toString('hex');
  const staged = path.join(parent, `.Faber-Code.update-${suffix}.AppImage`);
  const backup = path.join(parent, `.Faber-Code.backup-${suffix}.AppImage`);
  fs.copyFileSync(downloadedFile, staged, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(staged, 0o755);
  const script = `#!/bin/sh
set -eu
TARGET=${shellQuote(executablePath)}
STAGED=${shellQuote(staged)}
BACKUP=${shellQuote(backup)}
SOURCE_PID=${Number(process.pid)}
attempt=0
while kill -0 "$SOURCE_PID" 2>/dev/null && [ "$attempt" -lt 120 ]; do
  sleep 0.5
  attempt=$((attempt + 1))
done
if kill -0 "$SOURCE_PID" 2>/dev/null; then exit 1; fi
mv "$TARGET" "$BACKUP"
if ! mv "$STAGED" "$TARGET"; then
  mv "$BACKUP" "$TARGET"
  exit 1
fi
"$TARGET" >/dev/null 2>&1 &
rm -f "$BACKUP" "$STAGED" ${shellQuote(downloadedFile)} "$0"
`;
  const scriptPath = writeUpdaterScript(tempDir, script);
  return {
    start: () => startDetached('/bin/sh', [scriptPath], app, spawnProcess),
    cancel: () => {
      fs.rmSync(staged, { force: true });
      fs.rmSync(scriptPath, { force: true });
    },
  };
}

async function prepareUpdateInstall(options) {
  if (options.platform === 'darwin') return prepareMacUpdate(options);
  if (options.platform === 'win32') return prepareWindowsUpdate(options);
  if (options.platform === 'linux') return prepareLinuxUpdate(options);
  throw new Error('Sistema não compatível com a atualização interna.');
}

module.exports = { prepareUpdateInstall, appBundlePath };
