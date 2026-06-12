(function () {
  const DEFAULT_STORAGE_KEY = 'faber.panelLayout.v1';
  const DEFAULT_LIMITS = {
    leftMin: 260,
    leftMax: 520,
    rightMin: 280,
    rightMax: 560,
    centerMin: 500,
    defaultLeft: 320,
    defaultRight: 360,
  };

  function createPanelLayoutController(options = {}) {
    const appShell = options.appShell || document.querySelector('.app-shell');
    const splitterLeft = options.splitterLeft || document.getElementById('splitter-left');
    const splitterRight = options.splitterRight || document.getElementById('splitter-right');
    const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
    const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };

    function clampNumber(value, min, max) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return min;
      return Math.min(Math.max(numeric, min), max);
    }

    function readStoredLayout() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
        return {
          left: Number(parsed.left) || limits.defaultLeft,
          right: Number(parsed.right) || limits.defaultRight,
        };
      } catch {
        return {
          left: limits.defaultLeft,
          right: limits.defaultRight,
        };
      }
    }

    function isSideCollapsed(side) {
      const body = appShell && appShell.ownerDocument
        ? appShell.ownerDocument.body
        : document.body;
      return Boolean(
        body &&
        body.classList &&
        body.classList.contains(`workspace-${side}-collapsed`)
      );
    }

    function measurePanelWidth(selector, fallback) {
      const panel = document.querySelector(selector);
      if (!panel || typeof panel.getBoundingClientRect !== 'function') return fallback;
      const width = panel.getBoundingClientRect().width;
      return Number.isFinite(width) && width > 1 ? width : fallback;
    }

    function getCurrentLayout() {
      const stored = readStoredLayout();
      return {
        left: isSideCollapsed('left')
          ? stored.left
          : measurePanelWidth('.panel-left', stored.left || limits.defaultLeft),
        right: isSideCollapsed('right')
          ? stored.right
          : measurePanelWidth('.panel-right', stored.right || limits.defaultRight),
      };
    }

    function normalizeLayout(layout = {}) {
      const shellWidth = appShell ? appShell.getBoundingClientRect().width : window.innerWidth;
      const availableForSidebars = Math.max(
        limits.leftMin + limits.rightMin,
        shellWidth - limits.centerMin - 72
      );
      let left = clampNumber(layout.left, limits.leftMin, limits.leftMax);
      let right = clampNumber(layout.right, limits.rightMin, limits.rightMax);

      const overflow = left + right - availableForSidebars;
      if (overflow > 0) {
        const rightReduction = Math.min(overflow, Math.max(0, right - limits.rightMin));
        right -= rightReduction;
        const remaining = overflow - rightReduction;
        if (remaining > 0) {
          left -= Math.min(remaining, Math.max(0, left - limits.leftMin));
        }
      }

      return {
        left: Math.round(clampNumber(left, limits.leftMin, limits.leftMax)),
        right: Math.round(clampNumber(right, limits.rightMin, limits.rightMax)),
      };
    }

    function applyLayout(layout = {}, applyOptions = {}) {
      if (!appShell) return;
      const next = normalizeLayout(layout);
      if (!isSideCollapsed('left')) {
        appShell.style.setProperty('--faber-left-panel-width', `${next.left}px`);
      }
      if (!isSideCollapsed('right')) {
        appShell.style.setProperty('--faber-right-panel-width', `${next.right}px`);
      }
      if (applyOptions.persist) {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {}
      }
    }

    function bindSplitter(handle, side) {
      if (!handle || !appShell) return;

      function startResize(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        const startLayout = getCurrentLayout();
        document.body.classList.add('is-panel-resizing');
        handle.classList.add('is-dragging');

        function onPointerMove(moveEvent) {
          const deltaX = moveEvent.clientX - startX;
          const nextLayout = {
            left: side === 'left' ? startLayout.left + deltaX : startLayout.left,
            right: side === 'right' ? startLayout.right - deltaX : startLayout.right,
          };
          applyLayout(nextLayout);
        }

        function onPointerUp() {
          document.body.classList.remove('is-panel-resizing');
          handle.classList.remove('is-dragging');
          applyLayout(getCurrentLayout(), { persist: true });
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          window.removeEventListener('pointercancel', onPointerUp);
        }

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
      }

      handle.addEventListener('pointerdown', startResize);
      handle.addEventListener('dblclick', (event) => {
        event.preventDefault();
        applyLayout({
          left: limits.defaultLeft,
          right: limits.defaultRight,
        }, { persist: true });
      });
    }

    function initialize() {
      applyLayout(readStoredLayout());
      bindSplitter(splitterLeft, 'left');
      bindSplitter(splitterRight, 'right');
      window.addEventListener('resize', () => {
        applyLayout(getCurrentLayout(), { persist: true });
      });
    }

    return {
      applyLayout,
      getCurrentLayout,
      initialize,
    };
  }

  window.FaberPanelLayout = {
    createPanelLayoutController,
  };
})();
