const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { registerUpdateHandlers } = require('../main/ipc/update_handlers');

function response({ ok = true, status = 200, json = null, text = '', buffer = null, headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return {
    ok,
    status,
    headers: {
      get: (key) => normalizedHeaders[String(key || '').toLowerCase()] || null,
    },
    json: async () => json,
    text: async () => text,
    arrayBuffer: async () => {
      const value = Buffer.from(buffer || '');
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    },
  };
}

(async () => {
  const handlers = {};
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-update-'));
  const dmgBuffer = Buffer.from('fake-dmg');
  const sha512 = crypto.createHash('sha512').update(dmgBuffer).digest('base64');
  const downloadUrl = 'https://github.com/Eduardo-Frigo/fabercode/releases/download/v0.1.3/Faber-Code-0.1.3-arm64.dmg';
  const audit = [];
  const fetchCalls = [];
  let relaunched = false;
  let exitCode = null;

  registerUpdateHandlers({
    platform: 'darwin',
    app: {
      getAppPath: () => path.resolve(__dirname, '..'),
      getPath: (name) => (name === 'temp' ? tempDir : tempDir),
      getVersion: () => '0.1.2',
      relaunch: () => {
        relaunched = true;
      },
      exit: (code) => {
        exitCode = code;
      },
    },
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    dialog: {},
    fetchFn: async (url) => {
      fetchCalls.push(String(url));
      if (String(url).includes('/releases/latest')) {
        return response({
          json: {
            tag_name: 'v0.1.3',
            assets: [
              {
                name: 'Faber-Code-0.1.3-arm64.dmg',
                browser_download_url: downloadUrl,
                size: dmgBuffer.length,
              },
              {
                name: 'latest-mac.yml',
                browser_download_url: 'https://github.com/Eduardo-Frigo/fabercode/releases/download/v0.1.3/latest-mac.yml',
                size: 120,
              },
            ],
          },
        });
      }
      if (String(url).endsWith('/latest-mac.yml')) {
        return response({ text: `version: 0.1.3\nsha512: ${sha512}\n` });
      }
      if (String(url) === downloadUrl) {
        return response({ buffer: dmgBuffer, headers: { 'content-length': String(dmgBuffer.length) } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    registerIpcHandler: (channel, handler) => {
      handlers[channel] = handler;
    },
  });

  const checked = await handlers['app:update:check']();
  assert.strictEqual(checked.ok, true);
  assert.strictEqual(checked.available, true);
  assert.strictEqual(checked.downloadUrl, downloadUrl);
  assert.ok(checked.installToken);

  const rejected = await handlers['app:update:install']({}, {
    downloadUrl: 'https://example.com/Faber-Code-0.1.3-arm64.dmg',
    installToken: checked.installToken,
  });
  assert.strictEqual(rejected.ok, false);
  assert.match(rejected.message, /nao confere|não confere|asset|Host/);

  const installed = await handlers['app:update:install']({}, {
    downloadUrl: checked.downloadUrl,
    installToken: checked.installToken,
  });
  assert.strictEqual(installed.ok, true);
  assert.strictEqual(relaunched, true);
  assert.strictEqual(exitCode, 0);
  assert.ok(audit.some((entry) => entry.type === 'app.update_download_start'));
  assert.strictEqual(fetchCalls.includes('https://example.com/Faber-Code-0.1.3-arm64.dmg'), false);

  for (const unsupportedPlatform of ['win32', 'linux']) {
    const unsupportedHandlers = {};
    const unsupportedFetchCalls = [];
    let unsupportedGetPathCalls = 0;
    let unsupportedRelaunches = 0;
    let unsupportedExits = 0;

    registerUpdateHandlers({
      platform: unsupportedPlatform,
      app: {
        getAppPath: () => path.resolve(__dirname, '..'),
        getPath: () => {
          unsupportedGetPathCalls += 1;
          return tempDir;
        },
        getVersion: () => '0.1.2',
        relaunch: () => {
          unsupportedRelaunches += 1;
        },
        exit: () => {
          unsupportedExits += 1;
        },
      },
      dialog: {},
      fetchFn: async (url) => {
        unsupportedFetchCalls.push(String(url));
        return response({ ok: false, status: 500 });
      },
      registerIpcHandler: (channel, handler) => {
        unsupportedHandlers[channel] = handler;
      },
    });

    const unsupportedCheck = await unsupportedHandlers['app:update:check']();
    assert.deepStrictEqual(unsupportedCheck, {
      ok: true,
      available: false,
      currentVersion: '0.1.2',
      latestVersion: 'N/A',
      downloadUrl: '',
      reasonCode: 'UPDATE_PLATFORM_UNSUPPORTED',
    });

    const unsupportedInstall = await unsupportedHandlers['app:update:install'](
      {},
      { downloadUrl, installToken: 'must-not-be-used' }
    );
    assert.deepStrictEqual(unsupportedInstall, {
      ok: false,
      reasonCode: 'UPDATE_PLATFORM_UNSUPPORTED',
      message: 'Atualizações automáticas estão disponíveis apenas no macOS.',
    });
    assert.strictEqual(unsupportedFetchCalls.length, 0);
    assert.strictEqual(unsupportedGetPathCalls, 0);
    assert.strictEqual(unsupportedRelaunches, 0);
    assert.strictEqual(unsupportedExits, 0);
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('update-handlers.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
