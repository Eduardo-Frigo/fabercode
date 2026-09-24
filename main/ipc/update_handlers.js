const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { prepareUpdateInstall } = require('../services/app_update_install_service');

const GITHUB_OWNER = 'Eduardo-Frigo';
const GITHUB_REPO = 'fabercode';
const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const UPDATE_TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_ASSET_BYTES = 450 * 1024 * 1024;

function registerUpdateHandlers(dependencies = {}) {
  const {
    registerIpcHandler,
    app,
    appendAuditEvent = () => {},
    fetchFn = typeof fetch === 'function' ? fetch : null,
    platform = process.platform,
    architecture = process.arch,
    prepareInstall = prepareUpdateInstall,
    schedule = setTimeout,
  } = dependencies;

  for (const [name, value] of Object.entries({ registerIpcHandler, app, fetchFn, prepareInstall })) {
    if (!value) throw new Error(`Update IPC dependency missing: ${name}`);
  }

  let validatedUpdate = null;
  let installInProgress = false;

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
    const digest = String(asset.digest || '');
    if (!downloadUrl || !Number.isSafeInteger(assetSize) || assetSize <= 0 || assetSize > MAX_ASSET_BYTES
      || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
      throw new Error('Instalador de update invalido no release oficial.');
    }

    const token = validatedUpdate && validatedUpdate.downloadUrl === downloadUrl
      ? validatedUpdate.token
      : crypto.randomBytes(24).toString('base64url');
    validatedUpdate = { downloadUrl, latestVersion, token, checkedAt: Date.now(),
      assetName: asset.name, assetSize, digest: digest.slice(7) };
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

  async function downloadVerifiedAsset(update, destination) {
    const response = await fetchFn(update.downloadUrl, {
      headers: { 'User-Agent': 'FaberCode-App-Updater' },
    });
    if (!response || !response.ok) throw new Error('Não foi possível baixar o instalador do GitHub.');
    const length = Number(response.headers && response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_ASSET_BYTES) throw new Error('Instalador excede o limite de tamanho.');

    const digest = crypto.createHash('sha256');
    let bytes = 0;
    const output = await fs.promises.open(destination, 'wx', 0o600);
    try {
      const chunks = response.body && response.body[Symbol.asyncIterator]
        ? response.body
        : [Buffer.from(await response.arrayBuffer())];
      for await (const part of chunks) {
        const chunk = Buffer.from(part);
        bytes += chunk.length;
        if (bytes > MAX_ASSET_BYTES || bytes > update.assetSize) {
          throw new Error('Tamanho do instalador não corresponde ao release.');
        }
        digest.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const result = await output.write(chunk, offset, chunk.length - offset);
          offset += result.bytesWritten;
        }
      }
    } finally {
      await output.close();
    }
    if (bytes !== update.assetSize || digest.digest('hex') !== update.digest) {
      throw new Error('O instalador baixado não passou na verificação SHA-256.');
    }
  }

  registerIpcHandler('app:update:install', async (_, payload = {}) => {
    if (installInProgress) return { ok: false, message: 'A atualização já está em andamento.' };
    let tempDir = '';
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
      installInProgress = true;
      const update = validatedUpdate;
      tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'faber-update-'));
      const downloadedFile = path.join(tempDir, update.assetName);
      appendAuditEvent('app.update_download_start', {
        latestVersion: update.latestVersion,
        platform,
        architecture,
      });
      await downloadVerifiedAsset(update, downloadedFile);
      const prepared = await prepareInstall({ app, platform, architecture,
        downloadedFile, latestVersion: update.latestVersion, tempDir });
      appendAuditEvent('app.update_install_prepared', {
        latestVersion: validatedUpdate.latestVersion,
        platform,
        architecture,
      });
      schedule(async () => {
        try {
          await prepared.start();
        } catch (error) {
          installInProgress = false;
          prepared.cancel();
          fs.rmSync(tempDir, { recursive: true, force: true });
          appendAuditEvent('app.update_install_failed', { message: error.message });
        }
      }, 250);
      return { ok: true, installing: true, latestVersion: update.latestVersion };
    } catch (error) {
      installInProgress = false;
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
      appendAuditEvent('app.update_install_failed', { message: error.message });
      return { ok: false, message: error.message };
    }
  });
}

module.exports = { registerUpdateHandlers };
