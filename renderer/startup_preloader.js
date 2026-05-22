(function () {
  function createStartupPreloaderController(options = {}) {
    const doc = options.document || document;
    const element = options.element || doc.querySelector(options.selector || '#startup-preloader');
    const minVisibleMs = Math.max(0, Number(options.minVisibleMs || 0));
    const startedAt = Number.isFinite(Number(options.startedAt)) ? Number(options.startedAt) : Date.now();
    let hideRequested = false;

    function finish() {
      if (element && element.parentNode) {
        element.parentNode.removeChild(element);
      }
      if (doc.body) {
        doc.body.classList.add('ui-ready');
      }
    }

    function hide() {
      if (hideRequested) return;
      hideRequested = true;

      if (!element) {
        finish();
        return;
      }

      const elapsed = Date.now() - startedAt;
      const waitMs = Math.max(0, minVisibleMs - elapsed);

      window.setTimeout(() => {
        element.classList.add('is-hidden');
        window.setTimeout(finish, 460);
      }, waitMs);
    }

    function startWatchdog(optionsForWatchdog = {}) {
      const timeoutMs = Math.max(0, Number(optionsForWatchdog.timeoutMs || 0));
      const isFinished = typeof optionsForWatchdog.isFinished === 'function'
        ? optionsForWatchdog.isFinished
        : () => false;
      const onTimeout = typeof optionsForWatchdog.onTimeout === 'function'
        ? optionsForWatchdog.onTimeout
        : null;

      return window.setTimeout(() => {
        if (isFinished()) return;
        if (onTimeout) onTimeout();
        hide();
      }, timeoutMs);
    }

    return {
      hide,
      startWatchdog,
    };
  }

  window.FaberStartupPreloader = {
    createStartupPreloaderController,
  };
})();
