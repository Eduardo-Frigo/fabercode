'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

const {
  createAgenticBrowserSessionService,
} = require('../main/services/agentic_browser_session_service');

function pathInside(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return Boolean(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function authorizeLocalFile(rootPath, rawUrl) {
  let targetPath;
  try {
    targetPath = fileURLToPath(new URL(rawUrl));
  } catch {
    return false;
  }
  return pathInside(rootPath, targetPath) && fs.statSync(targetPath).isFile();
}

async function main() {
  app.disableHardwareAcceleration();
  app.setPath(
    'userData',
    path.join(os.tmpdir(), `faber-agentic-browser-electron-profile-${process.pid}`)
  );
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  await app.whenReady();

  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-agentic-browser-live-'));
  try {
    fs.writeFileSync(
      path.join(rootPath, 'style.css'),
      'body{margin:0;background:#16324f;color:#fff}main{padding:48px;font:32px sans-serif}',
      'utf8'
    );
    fs.writeFileSync(
      path.join(rootPath, 'index.html'),
      '<!doctype html><link rel="stylesheet" href="style.css"><main>Faber browser live</main>',
      'utf8'
    );
    const requestedUrl = String(
      process.env.FABER_AGENTIC_BROWSER_SMOKE_URL || ''
    ).trim();
    const indexUrl = requestedUrl
      ? new URL(requestedUrl).href
      : pathToFileURL(path.join(rootPath, 'index.html')).href;
    const navigationAllowed = (jobId, candidateRoot, url) => (
      jobId === 'job-electron-live'
      && candidateRoot === rootPath
      && (requestedUrl ? new URL(url).href === indexUrl : authorizeLocalFile(rootPath, url))
    );
    const service = createAgenticBrowserSessionService({
      BrowserWindow,
      authorizeNavigation: async ({ jobId, rootPath: candidateRoot, url }) => ({
        allowed: navigationAllowed(jobId, candidateRoot, url),
      }),
      authorizeRequest: async ({ jobId, rootPath: candidateRoot, url }) => ({
        allowed: jobId === 'job-electron-live'
          && candidateRoot === rootPath
          && authorizeLocalFile(rootPath, url),
      }),
    });
    const controller = new AbortController();
    const opened = await service.open({
      jobId: 'job-electron-live',
      rootPath,
      url: indexUrl,
      viewport: { width: 960, height: 640 },
      signal: controller.signal,
    });
    assert.strictEqual(opened.ok, true);
    assert.strictEqual(opened.session.url, indexUrl);

    const captured = await service.capture({
      jobId: 'job-electron-live',
      sessionId: opened.session.id,
      signal: controller.signal,
    });
    assert.strictEqual(captured.ok, true);
    assert.strictEqual(captured.image.mimeType, 'image/png');
    const png = Buffer.from(captured.image.data, 'base64');
    assert.strictEqual(captured.image.bytes, png.length);
    assert.ok(png.length > 1000);
    assert.deepStrictEqual(
      Array.from(png.subarray(0, 8)),
      [137, 80, 78, 71, 13, 10, 26, 10]
    );

    const inspected = service.inspect({
      jobId: 'job-electron-live',
      sessionId: opened.session.id,
    });
    assert.strictEqual(inspected.ok, true);
    assert.strictEqual(inspected.session.status, 'open');
    assert.strictEqual(
      inspected.console.some((entry) => entry.level === 3),
      false,
      'the live preview must not emit browser console errors'
    );
    const criticalRequestFailures = inspected.requestFailures.filter((entry) => !(
      entry.resourceType === 'font' && entry.error === 'net::ERR_CACHE_MISS'
    ));
    assert.deepStrictEqual(criticalRequestFailures, []);

    controller.abort();
    assert.strictEqual(service.diagnostics().activeSessions, 0);
    assert.deepStrictEqual(service.clear(), { ok: true, closed: 0 });
    console.log('agentic-browser-session-electron-smoke.js: ok');
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  app.quit();
  setTimeout(() => process.exit(1), 20);
});
