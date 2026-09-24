'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function hasNotarizationCredentials(env) {
  return Boolean(
    (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER)
    || (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID)
    || env.APPLE_KEYCHAIN_PROFILE
  );
}

function assertMacReleasePrerequisites({ env = process.env, platform = process.platform, exec = run } = {}) {
  if (platform !== 'darwin') {
    throw new Error('macOS release packages must be built on macOS.');
  }
  const identities = exec('security', ['find-identity', '-v', '-p', 'codesigning']);
  const developerIdAvailable = /Developer ID Application:/.test(identities);
  if (!developerIdAvailable && !env.CSC_LINK) {
    throw new Error('A valid Apple Developer ID Application identity is required for a public macOS release.');
  }
  if (!hasNotarizationCredentials(env)) {
    throw new Error('Apple notarization credentials are required (API key, app-specific password, or Keychain profile).');
  }
}

function verifyMacReleaseArtifacts({ releaseDir, version, architecture, exec = run }) {
  const appDir = architecture === 'arm64' ? 'mac-arm64' : 'mac';
  const appPath = path.join(releaseDir, appDir, 'Faber Code.app');
  const dmgPath = path.join(releaseDir, `Faber Code-${version}-${architecture}.dmg`);
  if (!fs.existsSync(appPath) || !fs.existsSync(dmgPath)) {
    throw new Error(`Missing macOS ${architecture} app or DMG in ${releaseDir}`);
  }
  exec('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const signature = exec('codesign', ['--display', '--verbose=4', appPath]);
  if (!/Authority=Developer ID Application:/.test(signature)) {
    throw new Error(`macOS ${architecture} app is not signed with Apple Developer ID Application.`);
  }
  exec('xcrun', ['stapler', 'validate', '-v', appPath]);
  exec('spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath]);
  exec('hdiutil', ['verify', dmgPath]);
}

module.exports = {
  assertMacReleasePrerequisites,
  hasNotarizationCredentials,
  verifyMacReleaseArtifacts,
};
