const fs = require('fs');
const path = require('path');

const MACOS_NODE_BIN_DIRS = Object.freeze([
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/local/bin',
]);

function versionParts(name) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(name);
  return match ? match.slice(1).map(Number) : null;
}

function buildDesktopToolPath(options = {}) {
  const {
    env = process.env,
    fileSystem = fs,
    pathModule = path,
    platform = process.platform,
    systemBinDirs = MACOS_NODE_BIN_DIRS,
  } = options;
  const current = String(env.PATH || env.Path || '');
  if (platform !== 'darwin') return current;

  const home = String(env.HOME || '').trim();
  const candidates = [...systemBinDirs];
  if (home) {
    candidates.push(
      pathModule.join(home, '.volta', 'bin'),
      pathModule.join(home, '.asdf', 'shims'),
      pathModule.join(home, '.local', 'share', 'mise', 'shims'),
      pathModule.join(home, '.nodenv', 'shims'),
    );
  }

  function addVersionedBins(versionsDir, suffix = []) {
    try {
      const versions = fileSystem.readdirSync(versionsDir)
        .filter((name) => versionParts(name))
        .sort((left, right) => {
          const a = versionParts(left);
          const b = versionParts(right);
          for (let index = 0; index < 3; index += 1) {
            if (a[index] !== b[index]) return b[index] - a[index];
          }
          return 0;
        });
      for (const version of versions) {
        candidates.push(pathModule.join(versionsDir, version, ...suffix, 'bin'));
      }
    } catch {
      // Version managers are optional.
    }
  }

  const nvmDir = String(env.NVM_DIR || (home && pathModule.join(home, '.nvm')) || '').trim();
  if (nvmDir) addVersionedBins(pathModule.join(nvmDir, 'versions', 'node'));
  if (home) {
    addVersionedBins(pathModule.join(home, '.local', 'share', 'fnm', 'node-versions'), ['installation']);
    addVersionedBins(pathModule.join(home, '.fnm', 'node-versions'), ['installation']);
    addVersionedBins(pathModule.join(home, '.asdf', 'installs', 'nodejs'));
    addVersionedBins(pathModule.join(home, '.local', 'share', 'mise', 'installs', 'node'));
    addVersionedBins(pathModule.join(home, '.nodenv', 'versions'));
  }

  const result = current.split(pathModule.delimiter).filter(Boolean);
  const seen = new Set(result);
  for (const directory of candidates) {
    if (!directory || seen.has(directory)) continue;
    try {
      fileSystem.accessSync(pathModule.join(directory, 'node'), fileSystem.constants.X_OK);
      result.push(directory);
      seen.add(directory);
    } catch {
      // Ignore unavailable or non-executable installations.
    }
  }
  return result.join(pathModule.delimiter);
}

module.exports = { buildDesktopToolPath };
