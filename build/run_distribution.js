'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { version } = require('../package.json');
const {
  PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS,
} = require('../main/security/portable_isolation_helper_release_trust');
const {
  assertMacReleasePrerequisites,
  verifyMacReleaseArtifacts,
} = require('./mac_release_gate');

const targets = Object.freeze({
  mac: { platform: 'darwin', args: ['--mac', 'dmg'] },
  'mac-unsigned': {
    platform: 'darwin',
    args: [
      '--mac', 'dmg',
      '-c.mac.identity=null',
      '-c.mac.forceCodeSigning=false',
      '-c.mac.hardenedRuntime=false',
      '-c.mac.notarize=false',
    ],
  },
  win: { platform: 'win32', args: ['--win', 'nsis'] },
  linux: { platform: 'linux', args: ['--linux', 'AppImage'] },
});
const [targetName, ...architectures] = process.argv.slice(2);
const target = targets[targetName];
if (!target || architectures.length === 0
  || architectures.some((architecture) => !['x64', 'arm64'].includes(architecture))) {
  throw new Error('Use: node build/run_distribution.js <mac|mac-unsigned|win|linux> <x64|arm64> [...]');
}
if (targetName === 'mac') assertMacReleasePrerequisites();

const keyFile = process.env.FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_FILE;
if (!keyFile || !path.isAbsolute(keyFile)) {
  throw new Error('Informe FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_FILE.');
}
const keyStat = fs.lstatSync(keyFile);
if (!keyStat.isFile() || keyStat.isSymbolicLink()
  || (process.platform !== 'win32' && (keyStat.mode & 0o077) !== 0)) {
  throw new Error('A chave de distribuição precisa ser um arquivo privado (modo 0600).');
}
const encodedKey = fs.readFileSync(keyFile, 'utf8').trim();
const privateKey = crypto.createPrivateKey({
  key: Buffer.from(encodedKey, 'base64'),
  format: 'der',
  type: 'pkcs8',
});
if (privateKey.asymmetricKeyType !== 'ed25519') {
  throw new Error('A chave de distribuição deve ser Ed25519.');
}
const publicKeyDer = crypto.createPublicKey(privateKey).export({
  format: 'der',
  type: 'spki',
});
const publicKeySpkiDerBase64 = publicKeyDer.toString('base64');
const publicKeyDigest = 'sha256:' + crypto.createHash('sha256').update(publicKeyDer).digest('hex');
const buildPlans = architectures.map((architecture) => {
  const keyId = 'faber-portable-helper-release-v' + version
    + '-' + target.platform + '-' + architecture;
  const trusted = PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS.find((entry) => (
    entry.keyId === keyId && entry.platform === target.platform
    && entry.architecture === architecture
  ));
  if (!trusted || trusted.publicKeySpkiDerBase64 !== publicKeySpkiDerBase64
    || trusted.publicKeyDigest !== publicKeyDigest) {
    throw new Error('A chave de distribuição não corresponde ao registro de confiança ' + keyId + '.');
  }
  return { architecture, keyId };
});

const builderCli = require.resolve('electron-builder/out/cli/cli.js');
for (const { architecture, keyId } of buildPlans) {
  const result = spawnSync(process.execPath, [
    builderCli,
    ...target.args,
    '--' + architecture,
    '--publish',
    'never',
  ], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID: keyId,
      FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_PKCS8_DER_BASE64: encodedKey,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  if (targetName === 'mac') {
    verifyMacReleaseArtifacts({
      releaseDir: path.resolve(__dirname, '..', 'release'),
      version,
      architecture,
    });
  }
  if (targetName === 'mac-unsigned') {
    const appDir = architecture === 'arm64' ? 'mac-arm64' : 'mac';
    const appPath = path.resolve(__dirname, '..', 'release', appDir, 'Faber Code.app');
    const dmgPath = path.resolve(__dirname, '..', 'release', `Faber Code-${version}-${architecture}.dmg`);
    if (!fs.existsSync(appPath) || !fs.existsSync(dmgPath)) {
      throw new Error(`Missing unsigned macOS ${architecture} app or DMG.`);
    }
    const signature = spawnSync('codesign', ['--display', '--verbose=4', appPath], { encoding: 'utf8' });
    const signatureDetails = `${signature.stdout || ''}\n${signature.stderr || ''}`;
    if (signature.error || (signature.status !== 0
      && !signatureDetails.includes('code object is not signed at all'))
      || (signature.status === 0
      && (!signatureDetails.includes('Signature=adhoc')
        || /Authority=|TeamIdentifier=(?!not set)/.test(signatureDetails)))) {
      throw new Error(`macOS ${architecture} build unexpectedly has a trusted code signature.`);
    }
    const verify = spawnSync('hdiutil', ['verify', dmgPath], { stdio: 'inherit' });
    if (verify.error) throw verify.error;
    if (verify.status !== 0) process.exit(verify.status || 1);
  }
}
