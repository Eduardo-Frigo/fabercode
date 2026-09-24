'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  assertMacReleasePrerequisites,
  verifyMacReleaseArtifacts,
} = require('../build/mac_release_gate');

const identity = '1) ABCD "Developer ID Application: Eduardo Frigo (TEAM123)"';
const invoke = (_, args) => {
  assert.deepStrictEqual(args, ['find-identity', '-v', '-p', 'codesigning']);
  return identity;
};

assert.throws(() => assertMacReleasePrerequisites({
  platform: 'darwin', env: {}, exec: () => '0 valid identities found',
}), /Developer ID Application/);
assert.throws(() => assertMacReleasePrerequisites({
  platform: 'darwin', env: {}, exec: invoke,
}), /notarization credentials/);
assert.doesNotThrow(() => assertMacReleasePrerequisites({
  platform: 'darwin', env: { APPLE_KEYCHAIN_PROFILE: 'faber-release' }, exec: invoke,
}));
assert.doesNotThrow(() => assertMacReleasePrerequisites({
  platform: 'darwin',
  env: { CSC_LINK: '/private/certificate.p12', APPLE_KEYCHAIN_PROFILE: 'faber-release' },
  exec: () => '0 valid identities found',
}));

const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-mac-release-gate-'));
try {
  const appPath = path.join(releaseDir, 'mac-arm64', 'Faber Code.app');
  const dmgPath = path.join(releaseDir, 'Faber Code-1.0.1-arm64.dmg');
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(dmgPath, 'fixture');
  const commands = [];
  verifyMacReleaseArtifacts({
    releaseDir, version: '1.0.1', architecture: 'arm64',
    exec: (command, args) => {
      commands.push([command, args[0]]);
      return command === 'codesign' && args[0] === '--display'
        ? `Authority=Developer ID Application: Eduardo Frigo (TEAM123)\n`
        : '';
    },
  });
  assert.deepStrictEqual(commands, [
    ['codesign', '--verify'],
    ['codesign', '--display'],
    ['xcrun', 'stapler'],
    ['spctl', '--assess'],
    ['hdiutil', 'verify'],
  ]);
  assert.throws(() => verifyMacReleaseArtifacts({
    releaseDir, version: '1.0.1', architecture: 'arm64',
    exec: () => 'Authority=Apple Development: Eduardo Frigo\n',
  }), /not signed with Apple Developer ID Application/);
} finally {
  fs.rmSync(releaseDir, { recursive: true, force: true });
}

console.log('mac release gate: ok');
