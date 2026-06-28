const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function registerUpdateHandlers(dependencies = {}) {
  const {
    registerIpcHandler,
    app,
    dialog,
    appendAuditEvent = () => {},
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Update IPC dependency missing: ${name}`);
  }

  requireDependency('registerIpcHandler', registerIpcHandler);
  requireDependency('app', app);
  requireDependency('dialog', dialog);

  function isVersionNewer(current, latest) {
    const cleanCurrent = current.replace(/^v/, '');
    const cleanLatest = latest.replace(/^v/, '');
    const pCurrent = cleanCurrent.split('.').map(Number);
    const pLatest = cleanLatest.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const c = pCurrent[i] || 0;
      const l = pLatest[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  function getAppBundlePath() {
    const exePath = process.execPath;
    const appIdx = exePath.indexOf('.app');
    if (appIdx !== -1) {
      return exePath.substring(0, appIdx + 4);
    }
    return null;
  }

  registerIpcHandler('app:update:check', async () => {
    try {
      const packageJsonPath = path.join(app.getAppPath(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const currentVersion = packageJson.version;

      const res = await fetch('https://api.github.com/repos/Eduardo-Frigo/fabercode/releases/latest', {
        headers: {
          'User-Agent': 'FaberCode-App-Updater'
        }
      });
      if (res.status === 404) {
        return {
          ok: true,
          available: false,
          currentVersion,
          latestVersion: 'N/A',
          downloadUrl: '',
        };
      }
      if (!res.ok) {
        throw new Error(`GitHub API returned status ${res.status}`);
      }

      const release = await res.json();
      const latestVersion = release.tag_name;
      
      const available = isVersionNewer(currentVersion, latestVersion);
      let downloadUrl = '';
      if (available && Array.isArray(release.assets)) {
        const dmgAsset = release.assets.find(asset => asset.name.endsWith('.dmg'));
        if (dmgAsset) {
          downloadUrl = dmgAsset.browser_download_url;
        }
      }

      return {
        ok: true,
        available,
        currentVersion,
        latestVersion,
        downloadUrl,
      };
    } catch (error) {
      appendAuditEvent('app.update_check_failed', { message: error.message });
      return { ok: false, message: error.message };
    }
  });

  registerIpcHandler('app:update:install', async (_, payload = {}) => {
    const downloadUrl = payload.downloadUrl;
    if (!downloadUrl) {
      return { ok: false, message: 'URL de download ausente.' };
    }

    try {
      appendAuditEvent('app.update_download_start', { url: downloadUrl });

      const res = await fetch(downloadUrl);
      if (!res.ok) {
        throw new Error(`Erro ao baixar DMG: status ${res.status}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const tempDir = app.getPath('temp');
      const dmgPath = path.join(tempDir, 'FaberCodeUpdate.dmg');
      fs.writeFileSync(dmgPath, buffer);

      appendAuditEvent('app.update_download_complete', { dmgPath });

      const appBundlePath = getAppBundlePath();
      if (!appBundlePath) {
        console.log('Update simulated: not running in packaged app. Restarting Dev server.');
        app.relaunch();
        app.exit(0);
        return { ok: true };
      }

      const scriptPath = path.join(tempDir, 'install_update.sh');
      const scriptContent = `#!/bin/bash
# Wait for Electron to fully exit
sleep 1.5

# Mount DMG
MOUNT_DIR=$(mktemp -d -t fabercode-mount)
hdiutil attach "${dmgPath}" -mountpoint "$MOUNT_DIR" -nobrowse -quiet

# Find .app inside the mount
APP_IN_DMG=$(find "$MOUNT_DIR" -maxdepth 1 -name "*.app" | head -n 1)

if [ -n "$APP_IN_DMG" ]; then
  rm -rf "${appBundlePath}"
  cp -R "$APP_IN_DMG" "${appBundlePath}"
fi

# Unmount DMG and clean up
hdiutil detach "$MOUNT_DIR" -force -quiet
rm -rf "$MOUNT_DIR"
rm -f "${dmgPath}"

# Relaunch the app
open "${appBundlePath}"

# Remove this script
rm -f "$0"
`;

      fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

      const child = spawn('/bin/bash', [scriptPath], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      app.exit(0);
      return { ok: true };
    } catch (error) {
      appendAuditEvent('app.update_install_failed', { message: error.message });
      return { ok: false, message: error.message };
    }
  });
}

module.exports = {
  registerUpdateHandlers,
};
