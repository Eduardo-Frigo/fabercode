const assert = require('assert');

const { registerUpdateHandlers } = require('../main/ipc/update_handlers');

const releaseTag = 'v1.0.3';
const assetNames = {
  'darwin:arm64': 'Faber.Code-1.0.3-arm64.dmg',
  'darwin:x64': 'Faber.Code-1.0.3-x64.dmg',
  'win32:arm64': 'Faber.Code-Setup-1.0.3-arm64.exe',
  'win32:x64': 'Faber.Code-Setup-1.0.3-x64.exe',
  'linux:arm64': 'Faber-Code-1.0.3-arm64.AppImage',
  'linux:x64': 'Faber-Code-1.0.3-x86_64.AppImage',
};

function makeRelease(overrides = {}) {
  return {
    tag_name: releaseTag,
    assets: Object.values(assetNames).map((name) => ({
      name,
      size: 120 * 1024 * 1024,
      browser_download_url: 'https://github.com/Eduardo-Frigo/fabercode/releases/download/' + releaseTag + '/' + name,
    })),
    ...overrides,
  };
}

function harness({ platform, architecture, currentVersion = '1.0.2', release = makeRelease() }) {
  const handlers = {};
  const opened = [];
  const fetched = [];
  const audit = [];
  registerUpdateHandlers({
    platform,
    architecture,
    app: { getVersion: () => currentVersion },
    shell: { openExternal: async (url) => { opened.push(url); } },
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    fetchFn: async (url) => {
      fetched.push(url);
      return { ok: true, status: 200, json: async () => release };
    },
    registerIpcHandler: (channel, handler) => { handlers[channel] = handler; },
  });
  return { handlers, opened, fetched, audit };
}

(async () => {
  for (const [platformArchitecture, assetName] of Object.entries(assetNames)) {
    const [platform, architecture] = platformArchitecture.split(':');
    const { handlers, opened, fetched, audit } = harness({ platform, architecture });
    const checked = await handlers['app:update:check']();
    const expectedUrl = 'https://github.com/Eduardo-Frigo/fabercode/releases/download/' + releaseTag + '/' + assetName;

    assert.strictEqual(checked.ok, true, platformArchitecture);
    assert.strictEqual(checked.available, true, platformArchitecture);
    assert.strictEqual(checked.currentVersion, '1.0.2');
    assert.strictEqual(checked.latestVersion, releaseTag);
    assert.strictEqual(checked.downloadUrl, expectedUrl);
    assert.ok(checked.installToken);

    const rejected = await handlers['app:update:install']({}, {
      downloadUrl: 'https://example.com/unsafe-installer',
      installToken: checked.installToken,
    });
    assert.strictEqual(rejected.ok, false);
    assert.deepStrictEqual(opened, []);

    const openedUpdate = await handlers['app:update:install']({}, {
      downloadUrl: checked.downloadUrl,
      installToken: checked.installToken,
    });
    assert.deepStrictEqual(openedUpdate, { ok: true, opened: true, downloadUrl: expectedUrl });
    assert.deepStrictEqual(opened, [expectedUrl]);
    assert.strictEqual(fetched.length, 1, 'The app must not silently download or execute the installer');
    assert.ok(audit.some((entry) => entry.type === 'app.update_download_opened'));
  }

  const sameVersion = harness({ platform: 'darwin', architecture: 'arm64', currentVersion: '1.0.3' });
  assert.deepStrictEqual(await sameVersion.handlers['app:update:check'](), {
    ok: true,
    available: false,
    currentVersion: '1.0.3',
    latestVersion: releaseTag,
    downloadUrl: '',
  });

  const missingAsset = harness({
    platform: 'linux',
    architecture: 'x64',
    release: makeRelease({ assets: [] }),
  });
  const missingResult = await missingAsset.handlers['app:update:check']();
  assert.strictEqual(missingResult.ok, false);
  assert.deepStrictEqual(missingAsset.opened, []);

  const unsafeRelease = makeRelease();
  unsafeRelease.assets[0].browser_download_url = 'https://example.com/Faber.Code-1.0.3-arm64.dmg';
  const unsafeAsset = harness({ platform: 'darwin', architecture: 'arm64', release: unsafeRelease });
  assert.strictEqual((await unsafeAsset.handlers['app:update:check']()).ok, false);
  assert.deepStrictEqual(unsafeAsset.opened, []);

  console.log('update-handlers.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
