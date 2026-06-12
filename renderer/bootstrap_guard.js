(function () {
  function normalizeRequiredModule(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const globalName = typeof entry.globalName === 'string' ? entry.globalName.trim() : '';
    const methods = Array.isArray(entry.methods)
      ? entry.methods.map((method) => String(method || '').trim()).filter(Boolean)
      : [];
    if (!globalName) return null;
    return { globalName, methods };
  }

  function getMissingRendererModules(requiredModules) {
    const missing = [];
    const entries = Array.isArray(requiredModules) ? requiredModules : [];

    entries.forEach((entry) => {
      const normalized = normalizeRequiredModule(entry);
      if (!normalized) return;
      const target = window[normalized.globalName];

      if (!target || typeof target !== 'object') {
        missing.push(normalized.globalName);
        return;
      }

      normalized.methods.forEach((method) => {
        if (typeof target[method] !== 'function') {
          missing.push(`${normalized.globalName}.${method}`);
        }
      });
    });

    return missing;
  }

  function showFatalBootError(error) {
    const preloader = document.getElementById('startup-preloader');
    if (preloader && preloader.parentNode) {
      preloader.parentNode.removeChild(preloader);
    }

    document.body.classList.add('ui-ready');

    const shell = document.querySelector('.app-shell');
    if (shell) shell.classList.add('hidden');

    const existing = document.getElementById('renderer-boot-error');
    const panel = existing || document.createElement('div');
    panel.id = 'renderer-boot-error';
    panel.className = 'renderer-boot-error';
    panel.setAttribute('role', 'alert');
    panel.textContent = error && error.message ? error.message : 'Falha ao iniciar a interface do Faber Code.';

    if (!existing) document.body.appendChild(panel);
  }

  function requireRendererModules(requiredModules) {
    const missing = getMissingRendererModules(requiredModules);
    if (!missing.length) return true;
    const error = new Error(`Renderer incompleto: módulos ausentes (${missing.join(', ')}).`);
    showFatalBootError(error);
    throw error;
  }

  window.FaberBootstrapGuard = {
    getMissingRendererModules,
    requireRendererModules,
    showFatalBootError,
  };
})();
