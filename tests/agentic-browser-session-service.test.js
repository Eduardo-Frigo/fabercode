const assert = require('assert');
const { EventEmitter } = require('events');

const {
  AGENTIC_BROWSER_SESSION_VERSION,
  AGENTIC_BROWSER_SESSION_REASONS,
  createAgenticBrowserSessionService,
} = require('../main/services/agentic_browser_session_service');

function createFakeBrowserWindowClass(state) {
  return class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.url = '';
      this.title = 'Faber preview';
      this.webContents = new EventEmitter();
      this.webContents.session = {
        webRequest: {
          onBeforeRequest: (...args) => {
            state.requestAuthorizationListener = typeof args[1] === 'function' ? args[1] : args[0];
            if (state.requestAuthorizationListener === null) state.requestAuthorizationListener = null;
          },
          onErrorOccurred: (...args) => {
            state.requestFailureListener = typeof args[1] === 'function' ? args[1] : args[0];
            if (state.requestFailureListener === null) state.requestFailureListener = null;
          },
        },
      };
      this.webContents.setWindowOpenHandler = (handler) => {
        state.windowOpenHandler = handler;
      };
      this.webContents.executeJavaScript = async (script) => {
        state.executedScripts.push(script);
        return { ok: true, tagName: 'button' };
      };
      this.webContents.capturePage = async () => ({
        toPNG: () => {
          state.capturePageCalls = (state.capturePageCalls || 0) + 1;
          return Buffer.from('real-png-bytes');
        },
      });
      this.webContents.getURL = () => this.url;
      this.webContents.getTitle = () => this.title;
      state.windows.push(this);
    }

    async loadURL(url) {
      state.loadedUrls.push(url);
      this.url = url;
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
    }
  };
}

function evaluateRequest(state, details) {
  return new Promise((resolve) => state.requestAuthorizationListener(details, resolve));
}

async function testPersistentNavigationInteractionAndVisualContent() {
  const state = {
    windows: [],
    loadedUrls: [],
    executedScripts: [],
    requestFailureListener: null,
    requestAuthorizationListener: null,
    windowOpenHandler: null,
  };
  const authorizationCalls = [];
  const service = createAgenticBrowserSessionService({
    BrowserWindow: createFakeBrowserWindowClass(state),
    authorizeNavigation: async (request) => {
      authorizationCalls.push(request);
      return { allowed: request.url.startsWith('http://127.0.0.1:') };
    },
    createSessionId: () => 'browser-session-1',
  });

  const opened = await service.open({
    jobId: 'job-1',
    rootPath: '/workspace/project',
    url: 'http://127.0.0.1:3000/',
    viewport: { width: 1280, height: 720 },
  });
  assert.strictEqual(opened.ok, true);
  assert.strictEqual(AGENTIC_BROWSER_SESSION_VERSION, 'agentic-browser-session.v2');
  assert.strictEqual(opened.session.revision, 1);
  assert.strictEqual(opened.session.id, 'browser-session-1');
  assert.strictEqual(state.windows.length, 1);
  assert.strictEqual(state.windows[0].options.show, false);
  assert.strictEqual(state.windows[0].options.webPreferences.contextIsolation, true);
  assert.strictEqual(state.windows[0].options.webPreferences.nodeIntegration, false);
  assert.strictEqual(state.windows[0].options.webPreferences.sandbox, true);
  assert.match(state.windows[0].options.webPreferences.partition, /^faber-agentic-browser-/);
  assert.strictEqual(state.windows[0].options.webPreferences.partition.startsWith('persist:'), false);

  state.windows[0].webContents.emit('console-message', {
    level: 'warning',
    message: 'API warning',
    lineNumber: 17,
    sourceId: 'app.js',
  });
  state.windows[0].webContents.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://asset.invalid/a.png', false);
  state.requestFailureListener({
    url: 'https://asset.invalid/a.png',
    error: 'net::ERR_NAME_NOT_RESOLVED',
    resourceType: 'image',
  });

  const navigated = await service.navigate({
    jobId: 'job-1',
    sessionId: 'browser-session-1',
    url: 'http://127.0.0.1:3000/dashboard',
  });
  assert.strictEqual(navigated.ok, true);
  assert.strictEqual(state.windows.length, 1);
  assert.deepStrictEqual(state.loadedUrls, [
    'http://127.0.0.1:3000/',
    'http://127.0.0.1:3000/dashboard',
  ]);

  const clicked = await service.interact({
    jobId: 'job-1',
    sessionId: 'browser-session-1',
    action: 'click',
    selector: '[data-testid="save"]',
  });
  const filled = await service.interact({
    jobId: 'job-1',
    sessionId: 'browser-session-1',
    action: 'fill',
    selector: '#name',
    value: 'Eduardo',
  });
  assert.strictEqual(clicked.ok, true);
  assert.strictEqual(filled.ok, true);
  assert.strictEqual(state.executedScripts.length, 2);
  assert.ok(state.executedScripts.every((script) => !/eval\s*\(|new Function/.test(script)));

  const capture = await service.capture({
    jobId: 'job-1',
    sessionId: 'browser-session-1',
  });
  assert.strictEqual(capture.ok, true);
  assert.deepStrictEqual(capture.image, {
    type: 'image',
    mimeType: 'image/png',
    data: Buffer.from('real-png-bytes').toString('base64'),
    bytes: Buffer.byteLength('real-png-bytes'),
  });
  assert.strictEqual(Object.hasOwn(capture, 'path'), false);

  const inspected = service.inspect({
    jobId: 'job-1',
    sessionId: 'browser-session-1',
  });
  assert.strictEqual(inspected.ok, true);
  assert.strictEqual(inspected.session.url, 'http://127.0.0.1:3000/dashboard');
  assert.ok(inspected.console.some((entry) => entry.message === 'API warning'));
  assert.ok(inspected.requestFailures.some((entry) => entry.url === 'https://asset.invalid/a.png'));
  assert.strictEqual(authorizationCalls.length, 2);

  const approvedSnapshot = inspected.session;
  state.windows[0].url = 'http://127.0.0.1:3000/replaced';
  state.windows[0].webContents.emit(
    'did-start-navigation',
    {},
    state.windows[0].url,
    false,
    true
  );
  const changedBeforeCapture = await service.capture({
    jobId: 'job-1',
    sessionId: 'browser-session-1',
    expectedRevision: approvedSnapshot.revision,
    expectedUrl: approvedSnapshot.url,
  });
  assert.deepStrictEqual(changedBeforeCapture, {
    ok: false,
    code: AGENTIC_BROWSER_SESSION_REASONS.SESSION_CHANGED,
  });
  assert.strictEqual(state.capturePageCalls, 1);

  const wrongJob = service.inspect({
    jobId: 'job-2',
    sessionId: 'browser-session-1',
  });
  assert.deepStrictEqual(wrongJob, {
    ok: false,
    code: AGENTIC_BROWSER_SESSION_REASONS.AUTHORITY_DENIED,
  });

  const closed = service.close({ jobId: 'job-1', sessionId: 'browser-session-1' });
  assert.strictEqual(closed.ok, true);
  assert.strictEqual(closed.closed, true);
  assert.strictEqual(state.windows[0].destroyed, true);
  assert.strictEqual(service.diagnostics().activeSessions, 0);
}

async function testNavigationRequiresAllowlistAuthorization() {
  const state = {
    windows: [],
    loadedUrls: [],
    executedScripts: [],
    requestFailureListener: null,
    requestAuthorizationListener: null,
    windowOpenHandler: null,
  };
  const service = createAgenticBrowserSessionService({
    BrowserWindow: createFakeBrowserWindowClass(state),
    authorizeNavigation: async ({ url }) => ({ allowed: !url.includes('blocked.example') }),
    createSessionId: () => 'browser-session-2',
  });
  const denied = await service.open({
    jobId: 'job-1',
    rootPath: '/workspace/project',
    url: 'https://blocked.example/private',
  });
  assert.deepStrictEqual(denied, {
    ok: false,
    code: AGENTIC_BROWSER_SESSION_REASONS.NAVIGATION_DENIED,
  });
  assert.strictEqual(state.windows.length, 0);
  assert.deepStrictEqual(state.loadedUrls, []);

  const invalid = await service.open({
    jobId: 'job-1',
    rootPath: '/workspace/project',
    url: 'javascript:alert(1)',
  });
  assert.deepStrictEqual(invalid, {
    ok: false,
    code: AGENTIC_BROWSER_SESSION_REASONS.INVALID_INPUT,
  });
}

async function testJobCancellationClosesPersistentSession() {
  const state = {
    windows: [],
    loadedUrls: [],
    executedScripts: [],
    requestFailureListener: null,
    requestAuthorizationListener: null,
    windowOpenHandler: null,
  };
  const controller = new AbortController();
  const service = createAgenticBrowserSessionService({
    BrowserWindow: createFakeBrowserWindowClass(state),
    authorizeNavigation: async () => ({ allowed: true }),
    createSessionId: () => 'browser-session-3',
  });
  const opened = await service.open({
    jobId: 'job-cancel',
    rootPath: '/workspace/project',
    url: 'file:///workspace/project/index.html',
    signal: controller.signal,
  });
  assert.strictEqual(opened.ok, true);

  controller.abort();
  await Promise.resolve();

  assert.strictEqual(state.windows[0].destroyed, true);
  assert.strictEqual(service.diagnostics().activeSessions, 0);

  const preAborted = new AbortController();
  preAborted.abort();
  const cancelled = await service.open({
    jobId: 'job-cancelled-before-open',
    rootPath: '/workspace/project',
    url: 'file:///workspace/project/index.html',
    signal: preAborted.signal,
  });
  assert.deepStrictEqual(cancelled, {
    ok: false,
    cancelled: true,
    code: AGENTIC_BROWSER_SESSION_REASONS.CANCELLED,
  });
}

async function testBrowserEgressAndSpontaneousNavigationFailClosed() {
  const state = {
    windows: [],
    loadedUrls: [],
    executedScripts: [],
    requestFailureListener: null,
    requestAuthorizationListener: null,
    windowOpenHandler: null,
  };
  const service = createAgenticBrowserSessionService({
    BrowserWindow: createFakeBrowserWindowClass(state),
    authorizeNavigation: async () => ({ allowed: true }),
    createSessionId: () => 'browser-session-egress',
  });
  const opened = await service.open({
    jobId: 'job-egress',
    rootPath: '/workspace/project',
    url: 'http://127.0.0.1:3000/',
  });
  assert.strictEqual(opened.ok, true);
  assert.strictEqual(typeof state.requestAuthorizationListener, 'function');
  assert.deepStrictEqual(state.windowOpenHandler({ url: 'https://outside.example/' }), {
    action: 'deny',
  });

  const sameOrigin = await evaluateRequest(state, {
    url: 'http://127.0.0.1:3000/api/health',
    resourceType: 'xhr',
  });
  const crossOrigin = await evaluateRequest(state, {
    url: 'https://outside.example/collect',
    resourceType: 'fetch',
  });
  assert.deepStrictEqual(sameOrigin, { cancel: false });
  assert.deepStrictEqual(crossOrigin, { cancel: true });

  let prevented = 0;
  state.windows[0].webContents.emit('will-navigate', {
    preventDefault() { prevented += 1; },
  }, 'https://outside.example/redirect');
  assert.strictEqual(prevented, 1);
  state.windows[0].webContents.emit('will-navigate', {
    preventDefault() { prevented += 1; },
  }, 'http://127.0.0.1:3000/settings');
  assert.strictEqual(prevented, 1);

  const inspected = service.inspect({
    jobId: 'job-egress',
    sessionId: opened.session.id,
  });
  assert.ok(inspected.requestFailures.some(
    (entry) => entry.url === 'https://outside.example/collect'
      && entry.error === 'blocked_by_browser_egress_policy'
  ));
}

async function testAdditionalOriginRequiresExplicitRequestAuthorization() {
  const state = {
    windows: [],
    loadedUrls: [],
    executedScripts: [],
    requestFailureListener: null,
    requestAuthorizationListener: null,
    windowOpenHandler: null,
  };
  const authorizations = [];
  const service = createAgenticBrowserSessionService({
    BrowserWindow: createFakeBrowserWindowClass(state),
    authorizeNavigation: async () => ({ allowed: true }),
    authorizeRequest: async (request) => {
      authorizations.push(request);
      return { allowed: request.url === 'https://cdn.allowed.example/app.css' };
    },
    createSessionId: () => 'browser-session-authorized-egress',
  });
  await service.open({
    jobId: 'job-authorized-egress',
    rootPath: '/workspace/project',
    url: 'http://127.0.0.1:3000/',
  });
  const allowed = await evaluateRequest(state, {
    url: 'https://cdn.allowed.example/app.css',
    resourceType: 'stylesheet',
  });
  assert.deepStrictEqual(allowed, { cancel: false });
  assert.strictEqual(authorizations.length, 1);
  assert.deepStrictEqual(authorizations[0], {
    jobId: 'job-authorized-egress',
    rootPath: '/workspace/project',
    sessionId: 'browser-session-authorized-egress',
    url: 'https://cdn.allowed.example/app.css',
    resourceType: 'stylesheet',
    operation: 'request',
  });
}

async function testExplicitJobAndRuntimeCleanupCloseHiddenWindows() {
  const state = {
    windows: [],
    loadedUrls: [],
    executedScripts: [],
    requestFailureListener: null,
    requestAuthorizationListener: null,
    windowOpenHandler: null,
  };
  let sequence = 0;
  const service = createAgenticBrowserSessionService({
    BrowserWindow: createFakeBrowserWindowClass(state),
    authorizeNavigation: async () => ({ allowed: true }),
    createSessionId: () => `browser-session-cleanup-${++sequence}`,
  });
  await service.open({
    jobId: 'job-cleanup-a',
    rootPath: '/workspace/project',
    url: 'http://127.0.0.1:3000/',
  });
  await service.open({
    jobId: 'job-cleanup-b',
    rootPath: '/workspace/project',
    url: 'http://127.0.0.1:3001/',
  });
  assert.strictEqual(service.diagnostics().activeSessions, 2);
  assert.deepStrictEqual(service.closeJob({ jobId: 'job-cleanup-a' }), {
    ok: true,
    closed: 1,
  });
  assert.strictEqual(state.windows[0].destroyed, true);
  assert.strictEqual(state.windows[1].destroyed, false);
  assert.strictEqual(service.diagnostics().activeSessions, 1);
  assert.deepStrictEqual(service.closeJob({ jobId: '../unsafe' }), {
    ok: false,
    closed: 0,
  });
  assert.deepStrictEqual(service.clear(), { ok: true, closed: 1 });
  assert.strictEqual(state.windows[1].destroyed, true);
  assert.strictEqual(service.diagnostics().activeSessions, 0);
}

async function main() {
  await testPersistentNavigationInteractionAndVisualContent();
  await testNavigationRequiresAllowlistAuthorization();
  await testJobCancellationClosesPersistentSession();
  await testBrowserEgressAndSpontaneousNavigationFailClosed();
  await testAdditionalOriginRequiresExplicitRequestAuthorization();
  await testExplicitJobAndRuntimeCleanupCloseHiddenWindows();
  console.log('agentic-browser-session-service.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
