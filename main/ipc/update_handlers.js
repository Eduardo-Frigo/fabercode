const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const GITHUB_OWNER = 'Eduardo-Frigo';
const GITHUB_REPO = 'fabercode';
const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const MAX_UPDATE_BYTES = 450 * 1024 * 1024;
const UPDATE_TOKEN_TTL_MS = 30 * 60 * 1000;
const DMG_NAME_RE = /^[A-Za-z0-9 ._-]+\.dmg$/;

function registerUpdateHandlers(dependencies = {}) {
  const {
    registerIpcHandler,
    app,
    dialog,
    appendAuditEvent = () => {},
    fetchFn = typeof fetch === 'function' ? fetch : null,
  } = dependencies;

  let validatedUpdate = null;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Update IPC dependency missing: ${name}`);
  }

  requireDependency('registerIpcHandler', registerIpcHandler);
  requireDependency('app', app);
  requireDependency('dialog', dialog);
  requireDependency('fetchFn', fetchFn);

  function getCurrentVersion() {
    if (app && typeof app.getVersion === 'function') return app.getVersion();
    const packageJsonPath = path.join(app.getAppPath(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version;
  }

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

  function createInstallToken() {
    return crypto.randomBytes(24).toString('base64url');
  }

  function sanitizeVersion(value = '') {
    const text = String(value || '').trim();
    return /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?$/.test(text) ? text : '';
  }

  function normalizeGithubReleaseAssetUrl(value = '') {
    try {
      const parsed = new URL(String(value || '').trim());
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== 'https:' || (host !== 'github.com' && host !== 'www.github.com')) {
        return { ok: false, message: 'Host de update nao autorizado.' };
      }
      if (parsed.username || parsed.password) {
        return { ok: false, message: 'URL de update com credenciais nao e autorizada.' };
      }
      const pathPrefix = `/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/`;
      if (!parsed.pathname.startsWith(pathPrefix)) {
        return { ok: false, message: 'Asset de update fora do repositorio oficial.' };
      }
      return { ok: true, url: parsed.toString(), pathname: parsed.pathname };
    } catch {
      return { ok: false, message: 'URL de update invalida.' };
    }
  }

  function findReleaseAsset(release, predicate) {
    if (!release || !Array.isArray(release.assets)) return null;
    return release.assets.find((asset) => asset && predicate(asset)) || null;
  }

  function parseSha512FromLatestYaml(text = '') {
    const match = String(text || '').match(/^sha512:\s*([A-Za-z0-9+/=]+)\s*$/m);
    return match ? match[1] : '';
  }

  async function resolveReleaseChecksum(release) {
    const yamlAsset = findReleaseAsset(release, (asset) => String(asset.name || '') === 'latest-mac.yml');
    if (!yamlAsset || !yamlAsset.browser_download_url) return '';
    const normalized = normalizeGithubReleaseAssetUrl(yamlAsset.browser_download_url);
    if (!normalized.ok) return '';
    const response = await fetchFn(normalized.url, { headers: { 'User-Agent': 'FaberCode-App-Updater' } });
    if (!response || !response.ok) return '';
    const text = typeof response.text === 'function' ? await response.text() : '';
    return parseSha512FromLatestYaml(text);
  }

  function assertValidUpdateAsset(release, asset) {
    const latestVersion = sanitizeVersion(release && release.tag_name);
    if (!latestVersion) return { ok: false, message: 'Versao de release invalida.' };
    const assetName = String(asset && asset.name ? asset.name : '').trim();
    if (!DMG_NAME_RE.test(assetName)) return { ok: false, message: 'Nome de DMG de update invalido.' };
    const normalized = normalizeGithubReleaseAssetUrl(asset && asset.browser_download_url);
    if (!normalized.ok) return normalized;
    const size = Number(asset.size || 0);
    if (size > MAX_UPDATE_BYTES) return { ok: false, message: 'DMG de update excede o tamanho permitido.' };
    return {
      ok: true,
      assetName,
      downloadUrl: normalized.url,
      latestVersion,
      size,
    };
  }

  async function fetchLatestUpdateMetadata() {
    const currentVersion = getCurrentVersion();
    const res = await fetchFn(GITHUB_LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'FaberCode-App-Updater',
      },
    });
    if (res.status === 404) {
      validatedUpdate = null;
      return {
        ok: true,
        available: false,
        currentVersion,
        latestVersion: 'N/A',
        downloadUrl: '',
      };
    }
    if (!res.ok) throw new Error(`GitHub API returned status ${res.status}`);

    const release = await res.json();
    const latestVersion = sanitizeVersion(release.tag_name);
    if (!latestVersion) throw new Error('GitHub retornou uma versao de update invalida.');
    const available = isVersionNewer(currentVersion, latestVersion);
    if (!available) {
      validatedUpdate = null;
      return { ok: true, available: false, currentVersion, latestVersion, downloadUrl: '' };
    }

    const dmgAsset = findReleaseAsset(release, (asset) => String(asset.name || '').toLowerCase().endsWith('.dmg'));
    if (!dmgAsset) throw new Error('Release mais recente nao possui DMG de update.');
    const updateAsset = assertValidUpdateAsset(release, dmgAsset);
    if (!updateAsset.ok) throw new Error(updateAsset.message);
    const sha512 = await resolveReleaseChecksum(release);

    validatedUpdate = {
      ...updateAsset,
      currentVersion,
      sha512,
      token: createInstallToken(),
      checkedAt: Date.now(),
    };

    return {
      ok: true,
      available: true,
      currentVersion,
      latestVersion,
      downloadUrl: updateAsset.downloadUrl,
      installToken: validatedUpdate.token,
    };
  }

  async function getValidatedUpdateForInstall(payload = {}) {
    const token = String(payload.installToken || payload.token || '').trim();
    const requestedUrl = String(payload.downloadUrl || '').trim();
    const stale = !validatedUpdate || Date.now() - validatedUpdate.checkedAt > UPDATE_TOKEN_TTL_MS;
    if (stale) {
      await fetchLatestUpdateMetadata();
    }
    if (!validatedUpdate) return { ok: false, message: 'Nenhum update validado esta disponivel.' };
    if (requestedUrl && requestedUrl !== validatedUpdate.downloadUrl) {
      return { ok: false, message: 'URL de update nao confere com o asset validado.' };
    }
    if (token && token !== validatedUpdate.token) {
      return { ok: false, message: 'Token de instalacao de update invalido.' };
    }
    return { ok: true, update: validatedUpdate };
  }

  function verifyDownloadSize(response) {
    const lengthHeader = response && response.headers && typeof response.headers.get === 'function'
      ? Number(response.headers.get('content-length') || 0)
      : 0;
    if (lengthHeader > MAX_UPDATE_BYTES) {
      return { ok: false, message: 'DMG de update excede o tamanho permitido.' };
    }
    return { ok: true };
  }

  function verifySha512(buffer, expected = '') {
    const digest = String(expected || '').trim();
    if (!digest) {
      if (String(process.env.FABER_UPDATE_ALLOW_MISSING_CHECKSUM || '').toLowerCase() === 'true') return { ok: true };
      return { ok: false, message: 'Checksum sha512 do update ausente.' };
    }
    const actual = crypto.createHash('sha512').update(buffer).digest('base64');
    if (actual !== digest) return { ok: false, message: 'Checksum sha512 do update nao confere.' };
    return { ok: true };
  }

  function shellQuote(value = '') {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
  }

  registerIpcHandler('app:update:check', async () => {
    try {
      return await fetchLatestUpdateMetadata();
    } catch (error) {
      appendAuditEvent('app.update_check_failed', { message: error.message });
      return { ok: false, message: error.message };
    }
  });

  registerIpcHandler('app:update:install', async (_, payload = {}) => {
    try {
      const resolved = await getValidatedUpdateForInstall(payload);
      if (!resolved.ok) return resolved;
      const update = resolved.update;
      appendAuditEvent('app.update_download_start', {
        assetName: update.assetName,
        latestVersion: update.latestVersion,
      });

      const res = await fetchFn(update.downloadUrl, {
        headers: { 'User-Agent': 'FaberCode-App-Updater' },
      });
      if (!res.ok) {
        throw new Error(`Erro ao baixar DMG: status ${res.status}`);
      }
      const sizeCheck = verifyDownloadSize(res);
      if (!sizeCheck.ok) throw new Error(sizeCheck.message);

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length > MAX_UPDATE_BYTES) throw new Error('DMG de update excede o tamanho permitido.');
      const checksum = verifySha512(buffer, update.sha512);
      if (!checksum.ok) throw new Error(checksum.message);

      const tempDir = app.getPath('temp');
      const dmgPath = path.join(tempDir, 'FaberCodeUpdate.dmg');
      fs.writeFileSync(dmgPath, buffer);

      appendAuditEvent('app.update_download_complete', { dmgPath });

      const appBundlePath = getAppBundlePath();
      if (!appBundlePath) {
        console.log('Update simulated: not running in packaged app. Restarting Dev server.');
        validatedUpdate = null;
        app.relaunch();
        app.exit(0);
        return { ok: true };
      }

      const scriptPath = path.join(tempDir, 'install_update.sh');
      const allowAdhocSignature = String(process.env.FABER_UPDATE_ALLOW_ADHOC_SIGNATURE || '').toLowerCase() === 'true';
      const expectedAppName = path.basename(appBundlePath);
      const scriptContent = `#!/bin/bash
set -euo pipefail
# Wait for Electron to fully exit
sleep 1.5

DMG_PATH=${shellQuote(dmgPath)}
TARGET_APP=${shellQuote(appBundlePath)}
EXPECTED_APP_NAME=${shellQuote(expectedAppName)}
ALLOW_ADHOC=${shellQuote(allowAdhocSignature ? 'true' : 'false')}

# Mount DMG
MOUNT_DIR=$(mktemp -d -t fabercode-mount)
cleanup() {
  hdiutil detach "$MOUNT_DIR" -force -quiet >/dev/null 2>&1 || true
  rm -rf "$MOUNT_DIR"
  rm -f "$DMG_PATH"
  rm -f "$0"
}
trap cleanup EXIT

hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_DIR" -nobrowse -readonly -quiet

# Find .app inside the mount
APP_IN_DMG=$(find "$MOUNT_DIR" -maxdepth 1 -type d -name "*.app" -print -quit)

if [ -z "$APP_IN_DMG" ]; then
  echo "Faber Code updater: app bundle nao encontrado no DMG." >&2
  exit 1
fi

if [ "$(basename "$APP_IN_DMG")" != "$EXPECTED_APP_NAME" ]; then
  echo "Faber Code updater: app bundle inesperado no DMG." >&2
  exit 1
fi

codesign --verify --deep --strict "$APP_IN_DMG"
SIGNATURE_INFO=$(codesign -dv --verbose=4 "$APP_IN_DMG" 2>&1 || true)
if [ "$ALLOW_ADHOC" != "true" ]; then
  if echo "$SIGNATURE_INFO" | grep -q "Signature=adhoc"; then
    echo "Faber Code updater: assinatura ad-hoc nao aceita em producao." >&2
    exit 1
  fi
  if echo "$SIGNATURE_INFO" | grep -q "TeamIdentifier=not set"; then
    echo "Faber Code updater: TeamIdentifier ausente." >&2
    exit 1
  fi
fi

if [ -n "$APP_IN_DMG" ]; then
  rm -rf "$TARGET_APP"
  cp -R "$APP_IN_DMG" "$TARGET_APP"
fi

# Relaunch the app
open "$TARGET_APP"
`;

      fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

      const child = spawn('/bin/bash', [scriptPath], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      validatedUpdate = null;
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
