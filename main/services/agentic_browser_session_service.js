'use strict';

const defaultCrypto = require('crypto');

const AGENTIC_BROWSER_SESSION_VERSION = 'agentic-browser-session.v1';
const AGENTIC_BROWSER_SESSION_REASONS = Object.freeze({
  AUTHORITY_DENIED: 'AGENTIC_BROWSER_SESSION_AUTHORITY_DENIED',
  CANCELLED: 'AGENTIC_BROWSER_SESSION_CANCELLED',
  IMAGE_TOO_LARGE: 'AGENTIC_BROWSER_SESSION_IMAGE_TOO_LARGE',
  INVALID_INPUT: 'AGENTIC_BROWSER_SESSION_INVALID_INPUT',
  NAVIGATION_DENIED: 'AGENTIC_BROWSER_SESSION_NAVIGATION_DENIED',
  OPERATION_FAILED: 'AGENTIC_BROWSER_SESSION_OPERATION_FAILED',
  SESSION_NOT_FOUND: 'AGENTIC_BROWSER_SESSION_NOT_FOUND',
  UNAVAILABLE: 'AGENTIC_BROWSER_SESSION_UNAVAILABLE',
});

const SAFE_ID = /^[A-Za-z0-9._:@-]{1,256}$/;
const ALLOWED_PROTOCOLS = new Set(['file:', 'http:', 'https:']);
const MAX_URL_LENGTH = 8192;
const MAX_ROOT_PATH_LENGTH = 8192;
const MAX_SELECTOR_LENGTH = 2048;
const MAX_FILL_VALUE_LENGTH = 65536;
const MAX_LOG_ENTRIES = 128;
const MAX_LOG_TEXT_LENGTH = 4096;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

function clipText(value = '', maximum = MAX_LOG_TEXT_LENGTH) {
  const text = String(value || '').replace(/\0/g, '');
  return text.length > maximum ? `${text.slice(0, Math.max(0, maximum - 3))}...` : text;
}

function dataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validId(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function normalizeConsoleLevel(value) {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.min(3, Number(value)));
  const levels = Object.freeze({ debug: 0, info: 1, warning: 2, error: 3 });
  return typeof value === 'string' && Object.hasOwn(levels, value)
    ? levels[value]
    : 0;
}

function normalizeUrl(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_URL_LENGTH || value.includes('\0')) return '';
  try {
    const parsed = new URL(value);
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function normalizeViewport(value = {}) {
  const width = Number(value && value.width);
  const height = Number(value && value.height);
  return Object.freeze({
    width: Number.isFinite(width) ? Math.max(320, Math.min(3840, Math.round(width))) : 1365,
    height: Number.isFinite(height) ? Math.max(240, Math.min(2160, Math.round(height))) : 768,
  });
}

function createAgenticBrowserSessionService(dependencies = {}) {
  const {
    BrowserWindow = null,
    authorizeNavigation,
    authorizeRequest = null,
    createSessionId = () => `browser-${defaultCrypto.randomUUID()}`,
    crypto = defaultCrypto,
    maxScreenshotBytes = MAX_SCREENSHOT_BYTES,
    now = () => new Date().toISOString(),
  } = dependencies;

  if (typeof authorizeNavigation !== 'function') {
    throw new TypeError('authorizeNavigation dependency missing');
  }
  if (authorizeRequest !== null && typeof authorizeRequest !== 'function') {
    throw new TypeError('authorizeRequest dependency invalid');
  }
  if (typeof createSessionId !== 'function') {
    throw new TypeError('createSessionId dependency invalid');
  }
  const screenshotByteLimit = Number.isSafeInteger(maxScreenshotBytes)
    && maxScreenshotBytes > 0
    && maxScreenshotBytes <= MAX_SCREENSHOT_BYTES
    ? maxScreenshotBytes
    : MAX_SCREENSHOT_BYTES;
  const sessions = new Map();

  function cancelledResult() {
    return Object.freeze({
      ok: false,
      cancelled: true,
      code: AGENTIC_BROWSER_SESSION_REASONS.CANCELLED,
    });
  }

  function invalidInputResult() {
    return Object.freeze({
      ok: false,
      code: AGENTIC_BROWSER_SESSION_REASONS.INVALID_INPUT,
    });
  }

  function boundedPush(target, entry) {
    target.push(Object.freeze(entry));
    if (target.length > MAX_LOG_ENTRIES) target.splice(0, target.length - MAX_LOG_ENTRIES);
  }

  function summarizeSession(session) {
    const webContents = session.window && session.window.webContents;
    const currentUrl = webContents && typeof webContents.getURL === 'function'
      ? clipText(webContents.getURL(), MAX_URL_LENGTH)
      : session.url;
    const title = webContents && typeof webContents.getTitle === 'function'
      ? clipText(webContents.getTitle(), 1024)
      : '';
    return Object.freeze({
      id: session.id,
      status: session.closed ? 'closed' : 'open',
      url: currentUrl || session.url,
      title,
      viewport: session.viewport,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  }

  function sessionLookup(jobId, sessionId) {
    if (!validId(jobId) || !validId(sessionId)) return { error: invalidInputResult() };
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        error: Object.freeze({
          ok: false,
          code: AGENTIC_BROWSER_SESSION_REASONS.SESSION_NOT_FOUND,
        }),
      };
    }
    if (session.jobId !== jobId) {
      return {
        error: Object.freeze({
          ok: false,
          code: AGENTIC_BROWSER_SESSION_REASONS.AUTHORITY_DENIED,
        }),
      };
    }
    return { session };
  }

  function detachRequestFailureListener(session) {
    const webRequest = session.window
      && session.window.webContents
      && session.window.webContents.session
      && session.window.webContents.session.webRequest;
    if (!webRequest || typeof webRequest.onErrorOccurred !== 'function') return;
    try {
      webRequest.onErrorOccurred(null);
      if (typeof webRequest.onBeforeRequest === 'function') {
        webRequest.onBeforeRequest(null);
      }
    } catch {
      // The job-specific Electron partition will be discarded with the window.
    }
  }

  function closeSession(session) {
    if (!session || session.closed) return false;
    session.closed = true;
    session.updatedAt = now();
    if (typeof session.removeAbortListener === 'function') session.removeAbortListener();
    if (typeof session.removeNavigationGuards === 'function') session.removeNavigationGuards();
    detachRequestFailureListener(session);
    try {
      const destroyed = session.window
        && typeof session.window.isDestroyed === 'function'
        && session.window.isDestroyed();
      if (!destroyed && session.window && typeof session.window.destroy === 'function') {
        session.window.destroy();
      }
    } catch {
      // best effort isolated-window cleanup
    }
    sessions.delete(session.id);
    return true;
  }

  function registerDiagnostics(session) {
    const webContents = session.window && session.window.webContents;
    if (!webContents || typeof webContents.on !== 'function') return;

    webContents.on('console-message', (details) => {
      boundedPush(session.consoleEntries, {
        level: normalizeConsoleLevel(dataValue(details, 'level')),
        message: clipText(dataValue(details, 'message')),
        line: Number.isFinite(Number(dataValue(details, 'lineNumber')))
          ? Number(dataValue(details, 'lineNumber'))
          : 0,
        sourceId: clipText(dataValue(details, 'sourceId'), 2048),
        createdAt: now(),
      });
    });
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      boundedPush(session.requestFailures, {
        url: clipText(validatedUrl, MAX_URL_LENGTH),
        error: clipText(errorDescription),
        errorCode: Number.isFinite(Number(errorCode)) ? Number(errorCode) : 0,
        resourceType: isMainFrame === true ? 'main_frame' : 'subresource',
        createdAt: now(),
      });
    });

    const webRequest = webContents.session && webContents.session.webRequest;
    if (webRequest && typeof webRequest.onErrorOccurred === 'function') {
      webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
        boundedPush(session.requestFailures, {
          url: clipText(dataValue(details, 'url'), MAX_URL_LENGTH),
          error: clipText(dataValue(details, 'error')),
          errorCode: 0,
          resourceType: clipText(dataValue(details, 'resourceType'), 128),
          createdAt: now(),
        });
      });
    }
  }

  function requestWithinNavigationScope(session, rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl || rawUrl.length > MAX_URL_LENGTH
      || rawUrl.includes('\0')) return false;
    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      return false;
    }
    if (target.protocol === 'data:' || target.protocol === 'blob:') return true;
    if (!ALLOWED_PROTOCOLS.has(target.protocol)) return false;
    const candidateScopes = [session.url, session.authorizedNavigationUrl].filter(Boolean);
    for (const scopeUrl of candidateScopes) {
      let scope;
      try {
        scope = new URL(scopeUrl);
      } catch {
        continue;
      }
      if (target.href === scope.href) return true;
      if (['http:', 'https:'].includes(target.protocol)
        && target.protocol === scope.protocol && target.origin === scope.origin) return true;
    }
    return false;
  }

  async function authorizeSubresource(session, details) {
    const rawUrl = dataValue(details, 'url');
    if (requestWithinNavigationScope(session, rawUrl)) return true;
    if (typeof authorizeRequest !== 'function' || session.closed) return false;
    let authorization;
    try {
      authorization = await authorizeRequest(Object.freeze({
        jobId: session.jobId,
        rootPath: session.rootPath,
        sessionId: session.id,
        url: String(rawUrl || ''),
        resourceType: clipText(dataValue(details, 'resourceType'), 128),
        operation: 'request',
      }));
    } catch {
      return false;
    }
    return !session.closed && dataValue(authorization, 'allowed') === true;
  }

  function registerNavigationAndEgressGuards(session) {
    const webContents = session.window && session.window.webContents;
    if (!webContents) return () => {};
    if (typeof webContents.setWindowOpenHandler === 'function') {
      webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    }

    const guardTopLevelNavigation = (event, targetUrl) => {
      if (requestWithinNavigationScope(session, targetUrl)) return;
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      boundedPush(session.requestFailures, {
        url: clipText(targetUrl, MAX_URL_LENGTH),
        error: 'blocked_by_browser_navigation_policy',
        errorCode: 0,
        resourceType: 'main_frame',
        createdAt: now(),
      });
    };
    if (typeof webContents.on === 'function') {
      webContents.on('will-navigate', guardTopLevelNavigation);
      webContents.on('will-redirect', guardTopLevelNavigation);
    }

    const webRequest = webContents.session && webContents.session.webRequest;
    if (webRequest && typeof webRequest.onBeforeRequest === 'function') {
      webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        let settled = false;
        const finish = (allowed) => {
          if (settled) return;
          settled = true;
          if (!allowed) {
            boundedPush(session.requestFailures, {
              url: clipText(dataValue(details, 'url'), MAX_URL_LENGTH),
              error: 'blocked_by_browser_egress_policy',
              errorCode: 0,
              resourceType: clipText(dataValue(details, 'resourceType'), 128),
              createdAt: now(),
            });
          }
          try {
            callback({ cancel: !allowed });
          } catch {
            // Electron owns the callback lifecycle; a closed request stays closed.
          }
        };
        Promise.resolve(authorizeSubresource(session, details)).then(
          (allowed) => finish(allowed === true),
          () => finish(false)
        );
      });
    }

    return () => {
      if (typeof webContents.removeListener === 'function') {
        webContents.removeListener('will-navigate', guardTopLevelNavigation);
        webContents.removeListener('will-redirect', guardTopLevelNavigation);
      }
    };
  }

  function addSessionAbortListener(session, signal) {
    if (!signal || typeof signal.addEventListener !== 'function') return () => {};
    const onAbort = () => closeSession(session);
    signal.addEventListener('abort', onAbort, { once: true });
    return () => {
      if (typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    };
  }

  async function authorize({ jobId, rootPath, sessionId = '', url, operation }) {
    let authorization;
    try {
      authorization = await authorizeNavigation(Object.freeze({
        jobId,
        rootPath,
        sessionId,
        url,
        operation,
      }));
    } catch {
      return false;
    }
    return dataValue(authorization, 'allowed') === true;
  }

  function waitWithCancellation(promise, signal, session = null) {
    if (!signal || typeof signal.addEventListener !== 'function') return Promise.resolve(promise);
    if (signal.aborted) return Promise.reject(Object.freeze({ cancelled: true }));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        callback(value);
      };
      const onAbort = () => {
        if (session) closeSession(session);
        finish(reject, Object.freeze({ cancelled: true }));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(promise).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error)
      );
    });
  }

  async function open(input = {}) {
    const jobId = input && input.jobId;
    const rootPath = input && input.rootPath;
    const targetUrl = normalizeUrl(input && input.url);
    const signal = input && input.signal;
    if (!validId(jobId)
      || typeof rootPath !== 'string'
      || !rootPath
      || rootPath.length > MAX_ROOT_PATH_LENGTH
      || rootPath.includes('\0')
      || !targetUrl) {
      return invalidInputResult();
    }
    if (signal && signal.aborted) return cancelledResult();
    if (typeof BrowserWindow !== 'function') {
      return Object.freeze({
        ok: false,
        code: AGENTIC_BROWSER_SESSION_REASONS.UNAVAILABLE,
      });
    }
    const allowed = await authorize({
      jobId,
      rootPath,
      url: targetUrl,
      operation: 'open',
    });
    if (!allowed) {
      return Object.freeze({
        ok: false,
        code: AGENTIC_BROWSER_SESSION_REASONS.NAVIGATION_DENIED,
      });
    }
    if (signal && signal.aborted) return cancelledResult();

    const id = String(createSessionId() || '');
    if (!validId(id) || sessions.has(id)) return invalidInputResult();
    const viewport = normalizeViewport(input.viewport);
    const partitionHash = crypto.createHash('sha256').update(jobId, 'utf8').digest('hex').slice(0, 24);
    let session = null;
    try {
      const window = new BrowserWindow({
        width: viewport.width,
        height: viewport.height,
        show: false,
        backgroundColor: '#ffffff',
        webPreferences: {
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: `faber-agentic-browser-${partitionHash}-${id}`,
        },
      });
      session = {
        id,
        jobId,
        rootPath,
        url: targetUrl,
        viewport,
        window,
        createdAt: now(),
        updatedAt: now(),
        closed: false,
        consoleEntries: [],
        requestFailures: [],
        removeAbortListener: null,
        removeNavigationGuards: null,
        authorizedNavigationUrl: targetUrl,
      };
      sessions.set(id, session);
      registerDiagnostics(session);
      session.removeNavigationGuards = registerNavigationAndEgressGuards(session);
      session.removeAbortListener = addSessionAbortListener(session, signal);
      await waitWithCancellation(window.loadURL(targetUrl), signal, session);
      if (session.closed) return cancelledResult();
      session.authorizedNavigationUrl = '';
      session.updatedAt = now();
      return deepFreeze({
        ok: true,
        session: summarizeSession(session),
      });
    } catch (error) {
      if (session) closeSession(session);
      if ((error && error.cancelled) || (signal && signal.aborted)) return cancelledResult();
      return Object.freeze({
        ok: false,
        code: AGENTIC_BROWSER_SESSION_REASONS.OPERATION_FAILED,
      });
    }
  }

  async function navigate(input = {}) {
    const lookup = sessionLookup(input && input.jobId, input && input.sessionId);
    if (lookup.error) return lookup.error;
    const session = lookup.session;
    const targetUrl = normalizeUrl(input && input.url);
    const signal = input && input.signal;
    if (!targetUrl) return invalidInputResult();
    if (signal && signal.aborted) {
      closeSession(session);
      return cancelledResult();
    }
    const allowed = await authorize({
      jobId: session.jobId,
      rootPath: session.rootPath,
      sessionId: session.id,
      url: targetUrl,
      operation: 'navigate',
    });
    if (!allowed) {
      return Object.freeze({
        ok: false,
        code: AGENTIC_BROWSER_SESSION_REASONS.NAVIGATION_DENIED,
      });
    }
    try {
      session.authorizedNavigationUrl = targetUrl;
      await waitWithCancellation(session.window.loadURL(targetUrl), signal, session);
      if (session.closed) return cancelledResult();
      session.url = targetUrl;
      session.authorizedNavigationUrl = '';
      session.updatedAt = now();
      return deepFreeze({ ok: true, session: summarizeSession(session) });
    } catch (error) {
      session.authorizedNavigationUrl = '';
      if ((error && error.cancelled) || (signal && signal.aborted)) return cancelledResult();
      return Object.freeze({
        ok: false,
        code: AGENTIC_BROWSER_SESSION_REASONS.OPERATION_FAILED,
      });
    }
  }

  function normalizeInteraction(input = {}) {
    const action = input && input.action;
    const selector = input && input.selector;
    if (!['click', 'fill'].includes(action)
      || typeof selector !== 'string'
      || !selector
      || selector.length > MAX_SELECTOR_LENGTH
      || selector.includes('\0')) return null;
    if (action === 'click' && input.value !== undefined) return null;
    if (action === 'fill'
      && (typeof input.value !== 'string'
        || input.value.length > MAX_FILL_VALUE_LENGTH
        || input.value.includes('\0'))) return null;
    return Object.freeze({
      action,
      selector,
      value: action === 'fill' ? input.value : '',
    });
  }

  function buildInteractionScript(interaction) {
    const selector = JSON.stringify(interaction.selector);
    const action = JSON.stringify(interaction.action);
    const value = JSON.stringify(interaction.value);
    return `(() => {
      const selector = ${selector};
      const action = ${action};
      const value = ${value};
      const element = document.querySelector(selector);
      if (!element) return { ok: false, reason: 'element_not_found' };
      if (action === 'click') {
        if (typeof element.click !== 'function') return { ok: false, reason: 'element_not_clickable' };
        element.click();
      } else {
        element.focus();
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { ok: true, tagName: String(element.tagName || '').toLowerCase() };
    })()`;
  }

  async function interact(input = {}) {
    const lookup = sessionLookup(input && input.jobId, input && input.sessionId);
    if (lookup.error) return lookup.error;
    const interaction = normalizeInteraction(input);
    if (!interaction) return invalidInputResult();
    const signal = input && input.signal;
    if (signal && signal.aborted) {
      closeSession(lookup.session);
      return cancelledResult();
    }
    const webContents = lookup.session.window && lookup.session.window.webContents;
    if (!webContents || typeof webContents.executeJavaScript !== 'function') {
      return Object.freeze({
        ok: false,
        code: AGENTIC_BROWSER_SESSION_REASONS.UNAVAILABLE,
      });
    }
    try {
      const raw = await waitWithCancellation(
        webContents.executeJavaScript(buildInteractionScript(interaction)),
        signal,
        lookup.session
      );
      const resultOk = dataValue(raw, 'ok') === true;
      const reason = clipText(dataValue(raw, 'reason'), 128);
      const tagName = clipText(dataValue(raw, 'tagName'), 128);
      lookup.session.updatedAt = now();
      return deepFreeze({
        ok: resultOk,
        action: interaction.action,
        selector: interaction.selector,
        ...(tagName ? { tagName } : {}),
        ...(!resultOk && reason ? { reason } : {}),
      });
    } catch (error) {
      if ((error && error.cancelled) || (signal && signal.aborted)) return cancelledResult();
      return Object.freeze({
        ok: false,
        code: AGENTIC_BROWSER_SESSION_REASONS.OPERATION_FAILED,
      });
    }
  }

  async function capture(input = {}) {
    const lookup = sessionLookup(input && input.jobId, input && input.sessionId);
    if (lookup.error) return lookup.error;
    const signal = input && input.signal;
    if (signal && signal.aborted) {
      closeSession(lookup.session);
      return cancelledResult();
    }
    const webContents = lookup.session.window && lookup.session.window.webContents;
    if (!webContents || typeof webContents.capturePage !== 'function') {
      return Object.freeze({
        ok: false,
        code: AGENTIC_BROWSER_SESSION_REASONS.UNAVAILABLE,
      });
    }
    try {
      const image = await waitWithCancellation(webContents.capturePage(), signal, lookup.session);
      const png = image && typeof image.toPNG === 'function' ? image.toPNG() : null;
      if (!Buffer.isBuffer(png)) throw new TypeError('Browser screenshot is not a PNG buffer');
      if (png.length > screenshotByteLimit) {
        return Object.freeze({
          ok: false,
          code: AGENTIC_BROWSER_SESSION_REASONS.IMAGE_TOO_LARGE,
        });
      }
      lookup.session.updatedAt = now();
      return deepFreeze({
        ok: true,
        session: summarizeSession(lookup.session),
        image: {
          type: 'image',
          mimeType: 'image/png',
          data: png.toString('base64'),
          bytes: png.length,
        },
      });
    } catch (error) {
      if ((error && error.cancelled) || (signal && signal.aborted)) return cancelledResult();
      return Object.freeze({
        ok: false,
        code: AGENTIC_BROWSER_SESSION_REASONS.OPERATION_FAILED,
      });
    }
  }

  function inspect(input = {}) {
    const lookup = sessionLookup(input && input.jobId, input && input.sessionId);
    if (lookup.error) return lookup.error;
    return deepFreeze({
      ok: true,
      session: summarizeSession(lookup.session),
      console: lookup.session.consoleEntries.map((entry) => ({ ...entry })),
      requestFailures: lookup.session.requestFailures.map((entry) => ({ ...entry })),
    });
  }

  function close(input = {}) {
    const lookup = sessionLookup(input && input.jobId, input && input.sessionId);
    if (lookup.error) return lookup.error;
    const closed = closeSession(lookup.session);
    return Object.freeze({
      ok: true,
      closed,
      sessionId: lookup.session.id,
    });
  }

  function closeJob(input = {}) {
    let keys;
    let descriptor;
    try {
      keys = Reflect.ownKeys(input);
      descriptor = Object.getOwnPropertyDescriptor(input, 'jobId');
    } catch {
      return Object.freeze({ ok: false, closed: 0 });
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || (Object.getPrototypeOf(input) !== Object.prototype
        && Object.getPrototypeOf(input) !== null)
      || keys.length !== 1 || keys[0] !== 'jobId'
      || !descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || !validId(descriptor.value)) {
      return Object.freeze({ ok: false, closed: 0 });
    }
    let closed = 0;
    for (const session of Array.from(sessions.values())) {
      if (session.jobId === descriptor.value && closeSession(session)) closed += 1;
    }
    return Object.freeze({ ok: true, closed });
  }

  function clear() {
    let closed = 0;
    for (const session of Array.from(sessions.values())) {
      if (closeSession(session)) closed += 1;
    }
    return Object.freeze({ ok: true, closed });
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_BROWSER_SESSION_VERSION,
      activeSessions: sessions.size,
    });
  }

  return Object.freeze({
    version: AGENTIC_BROWSER_SESSION_VERSION,
    open,
    navigate,
    interact,
    capture,
    inspect,
    close,
    closeJob,
    clear,
    diagnostics,
  });
}

module.exports = {
  AGENTIC_BROWSER_SESSION_REASONS,
  AGENTIC_BROWSER_SESSION_VERSION,
  createAgenticBrowserSessionService,
};
