(function () {
  const DEFAULT_LOGO_ASSETS = {
    dark: {
      preloader: './assets/Faber-Code-Logo-horizontal.png',
      panel: './assets/Faber-Code-Logo-02.png',
    },
    light: {
      preloader: './assets/Faber-Code-Logo-light-preloader.png',
      panel: './assets/Faber-Code-Logo-light-panel.png',
    },
  };

  const DEFAULT_THEMED_ICON_ASSETS = [
    {
      selector: '#btn-cortex-mode img',
      dark: './assets/icons/brain.svg',
      light: './assets/icons/brain-light.svg',
    },
    {
      selector: '#btn-archived-projects img',
      dark: './assets/icons/archive.svg',
      light: './assets/icons/archive-light.svg',
    },
    {
      selector: '#btn-trash-projects img',
      dark: './assets/icons/bin.svg',
      light: './assets/icons/bin-light.svg',
    },
    {
      selector: '#btn-project-settings img',
      dark: './assets/icons/settings.svg',
      light: './assets/icons/settings-light.svg',
    },
  ];

  function normalizeInterfaceTheme(rawValue) {
    return String(rawValue || '').trim().toLowerCase() === 'light' ? 'light' : 'dark';
  }

  function normalizePanelFontScale(rawValue) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return 100;
    return Math.min(120, Math.max(90, Math.round(value / 5) * 5));
  }

  function createUiAppearanceController(options = {}) {
    const doc = options.documentRef || document;
    const state = options.state || {};
    const logoAssets = options.logoAssets || DEFAULT_LOGO_ASSETS;
    const themedIconAssets = Array.isArray(options.themedIconAssets)
      ? options.themedIconAssets
      : DEFAULT_THEMED_ICON_ASSETS;

    function applyLogoTheme(theme) {
      const normalized = normalizeInterfaceTheme(theme);
      const assets = logoAssets[normalized] || logoAssets.dark;
      const preloaderLogo = doc.querySelector('.startup-preloader__logo-img');
      const panelLogo = doc.querySelector('.welcome-panel__logo');
      const accountGateLogo = doc.querySelector('.account-gate__logo');
      if (preloaderLogo && preloaderLogo.getAttribute('src') !== assets.preloader) {
        preloaderLogo.setAttribute('src', assets.preloader);
      }
      if (panelLogo && panelLogo.getAttribute('src') !== assets.panel) {
        panelLogo.setAttribute('src', assets.panel);
      }
      if (accountGateLogo && accountGateLogo.getAttribute('src') !== assets.panel) {
        accountGateLogo.setAttribute('src', assets.panel);
      }
    }

    function applyIconTheme(theme) {
      const normalized = normalizeInterfaceTheme(theme);
      themedIconAssets.forEach((entry) => {
        const icon = doc.querySelector(entry.selector);
        const nextSrc = entry[normalized] || entry.dark;
        if (icon && icon.getAttribute('src') !== nextSrc) {
          icon.setAttribute('src', nextSrc);
        }
      });
    }

    function applyAppearanceSettings(settings = {}, applyOptions = {}) {
      const theme = normalizeInterfaceTheme(settings.interfaceTheme || state.interfaceTheme);
      const fontScale = normalizePanelFontScale(settings.panelFontScale || state.panelFontScale);

      state.interfaceTheme = theme;
      state.panelFontScale = fontScale;

      if (doc.body) {
        doc.body.dataset.theme = theme;
      }
      if (doc.documentElement) {
        doc.documentElement.style.setProperty('--panel-font-scale', String(fontScale / 100));
      }

      applyLogoTheme(theme);
      applyIconTheme(theme);

      if (applyOptions.rerender !== false && typeof options.renderWelcomePanel === 'function') {
        options.renderWelcomePanel();
      }

      return {
        interfaceTheme: theme,
        panelFontScale: fontScale,
      };
    }

    return {
      apply: applyAppearanceSettings,
      applyIconTheme,
      applyLogoTheme,
      normalizeInterfaceTheme,
      normalizePanelFontScale,
    };
  }

  window.FaberUiAppearance = {
    createUiAppearanceController,
    normalizeInterfaceTheme,
    normalizePanelFontScale,
  };
})();
