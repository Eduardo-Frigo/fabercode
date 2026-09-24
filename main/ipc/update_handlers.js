const crypto = require('crypto');

const GITHUB_OWNER = 'Eduardo-Frigo';
const GITHUB_REPO = 'fabercode';
const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const UPDATE_TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_ASSET_BYTES = 450 * 1024 * 1024;

function registerUpdateHandlers(dependencies = {}) {
  const {
    registerIpcHandler,
    app,
    shell,
    appendAuditEvent = () => {},
    fetchFn = typeof fetch === 'function' ? fetch : null,
    platform = process.platform,
    architecture = process.arch,
  } = dependencies;

  for (const [name, value] of Object.entries({ registerIpcHandler, app, shell, fetchFn })) {
    if (!value) throw new Error(`Update IPC dependency missing: ${name}`);
  }

  let validatedUpdate = null;

  function sanitizeVersion(value) {
    const version = String(value || '').trim();
    return /^v?\d+\.\d+\.\d+$/.test(version) ? version : '';
  }

  function isVersionNewer(current, latest) {
    const currentParts = String(current).replace(/^v/, '').split('.').map(Number);
    const latestParts = String(latest).replace(/^v/, '').split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
      if (latestParts[index] > currentParts[index]) return true;
      if (latestParts[index] < currentParts[index]) return false;
    }
    return false;
  }

  function expectedAssetNames(version) {
    const number = version.replace(/^v/, '');
    if (!['x64', 'arm64'].includes(architecture)) return [];
    if (platform === 'darwin') {
      return [`Faber.Code-${number}-${architecture}.dmg`, `Faber Code-${number}-${architecture}.dmg`];
    }
    if (platform === 'win32') {
      return [`Faber.Code-Setup-${number}-${architecture}.exe`, `Faber Code-Setup-${number}-${architecture}.exe`];
    }
    if (platform === 'linux') {
      return [`Faber-Code-${number}-${architecture === 'x64' ? 'x86_64' : 'arm64'}.AppImage`];
    }
    return [];
  }

  function validatedAssetUrl(asset, version) {
    try {
      const url = new URL(String(asset.browser_download_url || ''));
      const expectedPath = `/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${version}/${asset.name}`;
      if (url.protocol !== 'https:' || url.hostname !== 'github.com'
        || url.username || url.password || url.search || url.hash
        || decodeURIComponent(url.pathname) !== expectedPath) {
        return '';
      }
      return url.toString();
    } catch {
      return '';
    }
  }

  async function fetchLatestUpdateMetadata() {
    const currentVersion = app.getVersion();
    const response = await fetchFn(GITHUB_LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'FaberCode-App-Updater',
      },
    });
    if (response.status === 404) {
      validatedUpdate = null;
      return { ok: true, available: false, currentVersion, latestVersion: 'N/A', downloadUrl: '' };
    }
    if (!response.ok) throw new Error(`GitHub API returned status ${response.status}`);

    const release = await response.json();
    const latestVersion = sanitizeVersion(release && release.tag_name);
    if (!latestVersion) throw new Error('GitHub retornou uma versao de update invalida.');
    if (!isVersionNewer(currentVersion, latestVersion)) {
      validatedUpdate = null;
      return { ok: true, available: false, currentVersion, latestVersion, downloadUrl: '' };
    }

    const expectedNames = expectedAssetNames(latestVersion);
    const asset = Array.isArray(release.assets)
      ? release.assets.find((item) => item && expectedNames.includes(item.name))
      : null;
    if (!asset) throw new Error('Release mais recente nao possui instalador para este sistema e arquitetura.');
    const downloadUrl = validatedAssetUrl(asset, latestVersion);
    const assetSize = Number(asset.size);
    if (!downloadUrl || !Number.isSafeInteger(assetSize) || assetSize <= 0 || assetSize > MAX_ASSET_BYTES) {
      throw new Error('Instalador de update invalido no release oficial.');
    }

    const token = validatedUpdate && validatedUpdate.downloadUrl === downloadUrl
      ? validatedUpdate.token
      : crypto.randomBytes(24).toString('base64url');
    validatedUpdate = { downloadUrl, latestVersion, token, checkedAt: Date.now() };
    return {
      ok: true,
      available: true,
      currentVersion,
      latestVersion,
      downloadUrl,
      installToken: token,
    };
  }

  registerIpcHandler('app:update:check', async () => {
    try {
      return await fetchLatestUpdateMetadata();
    } catch (error) {
      appendAuditEvent('app.update_check_failed', { message: error.message });
      return { ok: false, message: error.message };
    }
  });

  // Published installers are unsigned. Open the verified asset in the browser so
  // the user can complete installation through the operating system's normal flow.
  registerIpcHandler('app:update:install', async (_, payload = {}) => {
    try {
      if (!validatedUpdate || Date.now() - validatedUpdate.checkedAt > UPDATE_TOKEN_TTL_MS) {
        await fetchLatestUpdateMetadata();
      }
      const token = String(payload.installToken || '').trim();
      const requestedUrl = String(payload.downloadUrl || '').trim();
      if (!validatedUpdate || !token || token !== validatedUpdate.token
        || requestedUrl !== validatedUpdate.downloadUrl) {
        return { ok: false, message: 'Atualizacao nao validada. Verifique novamente.' };
      }
      await shell.openExternal(validatedUpdate.downloadUrl);
      appendAuditEvent('app.update_download_opened', {
        latestVersion: validatedUpdate.latestVersion,
        platform,
        architecture,
      });
      return { ok: true, opened: true, downloadUrl: validatedUpdate.downloadUrl };
    } catch (error) {
      appendAuditEvent('app.update_install_failed', { message: error.message });
      return { ok: false, message: error.message };
    }
  });
}

module.exports = { registerUpdateHandlers };
