const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { registerUpdateHandlers } = require('../main/ipc/update_handlers');
const { prepareUpdateInstall } = require('../main/services/app_update_install_service');

const releaseTag = 'v1.0.5';
const installer = Buffer.from('verified installer bytes');
const installerDigest = crypto.createHash('sha256').update(installer).digest('hex');
const assetNames = {
  'darwin:arm64': 'Faber.Code-1.0.5-arm64.dmg',
  'darwin:x64': 'Faber.Code-1.0.5-x64.dmg',
  'win32:arm64': 'Faber.Code-Setup-1.0.5-arm64.exe',
  'win32:x64': 'Faber.Code-Setup-1.0.5-x64.exe',
  'linux:arm64': 'Faber-Code-1.0.5-arm64.AppImage',
  'linux:x64': 'Faber-Code-1.0.5-x86_64.AppImage',
};

function makeRelease(overrides = {}) {
  return { tag_name: releaseTag,
    assets: Object.values(assetNames).map((name) => ({
      name, size: installer.length, digest: `sha256:${installerDigest}`,
      browser_download_url: `https://github.com/Eduardo-Frigo/fabercode/releases/download/${releaseTag}/${name}`,
    })), ...overrides };
}

function harness({ platform, architecture, currentVersion = '1.0.3', release = makeRelease(),
  download = installer } = {}) {
  const handlers = {}, fetched = [], audit = [], prepared = [], scheduled = [];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-update-test-'));
  registerUpdateHandlers({
    platform, architecture,
    app: { getVersion: () => currentVersion, getPath: () => tempRoot },
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    fetchFn: async (url) => {
      fetched.push(url);
      if (url.includes('/releases/latest')) return { ok: true, status: 200, json: async () => release };
      return { ok: true, status: 200, headers: { get: () => String(download.length) },
        body: (async function* chunks() { yield download.subarray(0, 5); yield download.subarray(5); })() };
    },
    prepareInstall: async (options) => {
      prepared.push({ ...options, file: fs.readFileSync(options.downloadedFile) });
      return { start: () => { prepared[prepared.length - 1].started = true; }, cancel: () => {} };
    },
    schedule: (callback) => { scheduled.push(callback); },
    registerIpcHandler: (channel, handler) => { handlers[channel] = handler; },
  });
  return { handlers, fetched, audit, prepared, scheduled,
    cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }) };
}

(async () => {
  for (const [platformArchitecture, assetName] of Object.entries(assetNames)) {
    const [platform, architecture] = platformArchitecture.split(':');
    const test = harness({ platform, architecture });
    try {
      const checked = await test.handlers['app:update:check']();
      const expectedUrl = `https://github.com/Eduardo-Frigo/fabercode/releases/download/${releaseTag}/${assetName}`;
      assert.strictEqual(checked.ok, true, platformArchitecture);
      assert.strictEqual(checked.available, true, platformArchitecture);
      assert.strictEqual(checked.downloadUrl, expectedUrl);
      assert.ok(checked.installToken);
      const rejected = await test.handlers['app:update:install']({}, {
        downloadUrl: 'https://example.com/unsafe-installer', installToken: checked.installToken,
      });
      assert.strictEqual(rejected.ok, false);
      assert.strictEqual(test.fetched.length, 1);
      const installed = await test.handlers['app:update:install']({}, checked);
      assert.deepStrictEqual(installed, { ok: true, installing: true, latestVersion: releaseTag });
      assert.strictEqual(test.fetched[1], expectedUrl);
      assert.deepStrictEqual(test.prepared[0].file, installer);
      assert.strictEqual(test.prepared[0].platform, platform);
      assert.strictEqual(test.prepared[0].architecture, architecture);
      assert.strictEqual(test.scheduled.length, 1);
      await test.scheduled[0]();
      assert.strictEqual(test.prepared[0].started, true);
      assert.ok(test.audit.some((entry) => entry.type === 'app.update_install_prepared'));
    } finally { test.cleanup(); }
  }

  const same = harness({ platform: 'darwin', architecture: 'arm64', currentVersion: '1.0.5' });
  try { assert.strictEqual((await same.handlers['app:update:check']()).available, false); }
  finally { same.cleanup(); }
  const missing = harness({ platform: 'linux', architecture: 'x64', release: makeRelease({ assets: [] }) });
  try { assert.strictEqual((await missing.handlers['app:update:check']()).ok, false); }
  finally { missing.cleanup(); }
  const unsafeRelease = makeRelease();
  unsafeRelease.assets[0].browser_download_url = 'https://example.com/unsafe.dmg';
  const unsafe = harness({ platform: 'darwin', architecture: 'arm64', release: unsafeRelease });
  try { assert.strictEqual((await unsafe.handlers['app:update:check']()).ok, false); }
  finally { unsafe.cleanup(); }
  const corrupted = harness({ platform: 'darwin', architecture: 'arm64', download: Buffer.from('corrupted installer bytes') });
  try {
    const checked = await corrupted.handlers['app:update:check']();
    assert.strictEqual((await corrupted.handlers['app:update:install']({}, checked)).ok, false);
    assert.strictEqual(corrupted.prepared.length, 0);
  } finally { corrupted.cleanup(); }
  const missingDigestRelease = makeRelease();
  delete missingDigestRelease.assets[0].digest;
  const missingDigest = harness({ platform: 'darwin', architecture: 'arm64', release: missingDigestRelease });
  try { assert.strictEqual((await missingDigest.handlers['app:update:check']()).ok, false); }
  finally { missingDigest.cleanup(); }

  let launched = null;
  let exited = false;
  const windows = await prepareUpdateInstall({
    platform: 'win32', downloadedFile: 'Faber.Code-Setup-1.0.5-x64.exe',
    app: { exit: () => { exited = true; } },
    spawnProcess: (command, args) => {
      launched = { command, args };
      const child = new EventEmitter();
      child.unref = () => {};
      process.nextTick(() => child.emit('spawn'));
      return child;
    },
  });
  await windows.start();
  assert.deepStrictEqual(launched, {
    command: 'Faber.Code-Setup-1.0.5-x64.exe', args: ['--updated', '/S', '--force-run'],
  });
  assert.strictEqual(exited, true);
  console.log('update-handlers.test.js: ok');
})().catch((error) => { console.error(error); process.exit(1); });
