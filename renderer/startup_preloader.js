(function () {
  function createStartupPreloaderController(options = {}) {
    const doc = options.document || document;
    const view = doc.defaultView || window;
    const element = options.element || doc.querySelector(options.selector || '#startup-preloader');
    const logoElement = options.logoElement || (element && typeof element.querySelector === 'function'
      ? element.querySelector('.startup-preloader__logo-img')
      : null);
    const logoAnimationClass = options.logoAnimationClass || 'is-animating';
    const logoAnimationTimeoutMs = Math.max(0, Number(options.logoAnimationTimeoutMs || 1600));
    const minVisibleMs = Math.max(0, Number(options.minVisibleMs || 0));
    const startedAt = Number.isFinite(Number(options.startedAt)) ? Number(options.startedAt) : Date.now();
    let hideRequested = false;
    let logoAnimationStarted = false;
    let logoAnimationDone = !logoElement;
    let logoAnimationTimer = null;
    let logoAnimationWaiters = [];

    function resolveLogoAnimation() {
      if (logoAnimationDone) return;
      logoAnimationDone = true;
      if (logoAnimationTimer) {
        view.clearTimeout(logoAnimationTimer);
        logoAnimationTimer = null;
      }
      const waiters = logoAnimationWaiters;
      logoAnimationWaiters = [];
      waiters.forEach((resolve) => resolve());
    }

    function startLogoAnimation() {
      if (!logoElement || logoAnimationStarted) return;
      logoAnimationStarted = true;

      const run = () => {
        if (!logoElement || !logoElement.classList) {
          resolveLogoAnimation();
          return;
        }
        if (typeof logoElement.addEventListener === 'function') {
          logoElement.addEventListener('animationend', resolveLogoAnimation, { once: true });
          logoElement.addEventListener('animationcancel', resolveLogoAnimation, { once: true });
        }
        logoAnimationTimer = view.setTimeout(resolveLogoAnimation, logoAnimationTimeoutMs);
        logoElement.classList.remove(logoAnimationClass);
        if (typeof logoElement.offsetWidth === 'number') {
          void logoElement.offsetWidth;
        }
        logoElement.classList.add(logoAnimationClass);
      };

      if (typeof view.requestAnimationFrame === 'function') {
        view.requestAnimationFrame(run);
      } else {
        view.setTimeout(run, 0);
      }
    }

    function waitForLogoAnimation() {
      if (logoAnimationDone) return Promise.resolve();
      startLogoAnimation();
      return new Promise((resolve) => {
        logoAnimationWaiters.push(resolve);
      });
    }

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

      view.setTimeout(() => {
        waitForLogoAnimation().then(() => {
          element.classList.add('is-hidden');
          view.setTimeout(finish, 460);
        });
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

      return view.setTimeout(() => {
        if (isFinished()) return;
        if (onTimeout) onTimeout();
        hide();
      }, timeoutMs);
    }

    startLogoAnimation();

    return {
      hide,
      waitForLogoAnimation,
      startWatchdog,
    };
  }

  window.FaberStartupPreloader = {
    createStartupPreloaderController,
  };
})();
