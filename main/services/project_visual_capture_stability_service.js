function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function normalizeStabilitySnapshot(raw = {}) {
  const snapshot = raw && typeof raw === 'object' ? raw : {};
  return {
    readyState: String(snapshot.readyState || ''),
    bodyTextLength: Number(snapshot.bodyTextLength || 0),
    elementCount: Number(snapshot.elementCount || 0),
    pendingImages: Number(snapshot.pendingImages || 0),
    mediaCount: Number(snapshot.mediaCount || 0),
    fontsReady: snapshot.fontsReady !== false,
  };
}

function isPaintReady(snapshot = {}, options = {}) {
  const minBodyTextLength = Math.max(0, Number(options.minBodyTextLength || 1));
  const hasDom = Number(snapshot.elementCount || 0) > 0 || Number(snapshot.bodyTextLength || 0) >= minBodyTextLength;
  const readyState = String(snapshot.readyState || '');
  return hasDom && (readyState === 'complete' || readyState === 'interactive');
}

function isStableSnapshot(previous = null, current = null) {
  if (!previous || !current) return false;
  return (
    previous.readyState === current.readyState &&
    Math.abs(Number(previous.bodyTextLength || 0) - Number(current.bodyTextLength || 0)) <= 2 &&
    Math.abs(Number(previous.elementCount || 0) - Number(current.elementCount || 0)) <= 1 &&
    Number(previous.pendingImages || 0) === Number(current.pendingImages || 0) &&
    Number(previous.mediaCount || 0) === Number(current.mediaCount || 0)
  );
}

function createProjectVisualCaptureStabilityService(dependencies = {}) {
  const {
    waitFn = wait,
  } = dependencies;

  async function collectDomStabilitySnapshot(win = null) {
    if (!win || !win.webContents || typeof win.webContents.executeJavaScript !== 'function') {
      return normalizeStabilitySnapshot({});
    }

    try {
      const snapshot = await win.webContents.executeJavaScript(`
        (() => {
          const text = document.body ? String(document.body.innerText || document.body.textContent || '').replace(/\\s+/g, ' ').trim() : '';
          const images = Array.from(document.images || []);
          const pendingImages = images.filter((image) => !image.complete || image.naturalWidth === 0).length;
          return {
            readyState: document.readyState || '',
            bodyTextLength: text.length,
            elementCount: document.body ? document.body.querySelectorAll('*').length : 0,
            pendingImages,
            mediaCount: images.length + document.querySelectorAll('video,iframe,svg,canvas').length,
            fontsReady: !document.fonts || document.fonts.status === 'loaded',
          };
        })();
      `);
      return normalizeStabilitySnapshot(snapshot);
    } catch {
      return normalizeStabilitySnapshot({});
    }
  }

  async function waitForVisualCaptureStability(win = null, options = {}) {
    const timeoutMs = Math.max(50, Number(options.domReadyTimeoutMs === undefined ? 5000 : options.domReadyTimeoutMs));
    const intervalMs = Math.max(10, Number(options.domStableIntervalMs === undefined ? 120 : options.domStableIntervalMs));
    const quietMs = Math.max(0, Number(options.domStableQuietMs === undefined ? 240 : options.domStableQuietMs));
    const startedAt = Date.now();
    let lastSnapshot = null;
    let stableSince = 0;
    let attempts = 0;

    while (Date.now() - startedAt <= timeoutMs) {
      attempts += 1;
      const snapshot = await collectDomStabilitySnapshot(win);
      if (isPaintReady(snapshot, options) && isStableSnapshot(lastSnapshot, snapshot)) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= quietMs) {
          return {
            ok: true,
            reason: 'dom_stable',
            attempts,
            durationMs: Date.now() - startedAt,
            snapshot,
          };
        }
      } else {
        stableSince = 0;
      }
      lastSnapshot = snapshot;
      await waitFn(intervalMs);
    }

    return {
      ok: false,
      reason: 'dom_stability_timeout',
      attempts,
      durationMs: Date.now() - startedAt,
      snapshot: lastSnapshot,
      issue: {
        id: 'capture_dom_not_stable',
        severity: 'warning',
        detail: 'Preview carregou, mas o DOM não estabilizou antes da captura.',
        hint: 'Se a captura parecer incompleta, repita a validação com maior tempo de espera.',
      },
    };
  }

  return {
    collectDomStabilitySnapshot,
    waitForVisualCaptureStability,
  };
}

module.exports = {
  createProjectVisualCaptureStabilityService,
};
