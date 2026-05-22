(function () {
  function createAppPreferencesController({
    callbacks = {},
    documentRef = document,
    inputEl = null,
    normalizeInterfaceLanguage = (value) => value || 'pt-BR',
    state,
    translate = (_key, fallback = '') => fallback,
    uiAppearanceController = null,
  } = {}) {
    if (!state) throw new Error('Renderer incompleto: estado de preferências ausente.');

    const {
      applyStaticTranslations = () => {},
      refreshAiSettingsCurrentLine = () => {},
      renderAiSettingsApiList = () => {},
      renderCortexLearning = () => {},
      renderNextSteps = () => {},
      renderWelcomePanel = () => {},
      setUiMode = () => {},
    } = callbacks;

    function applyAppearanceSettings(settings = {}, options = {}) {
      if (uiAppearanceController) {
        return uiAppearanceController.apply(settings, options);
      }
      return {
        interfaceTheme: state.interfaceTheme,
        panelFontScale: state.panelFontScale,
      };
    }

    function applyInterfaceLanguage(locale, options = {}) {
      const normalized = normalizeInterfaceLanguage(locale);
      state.interfaceLanguage = normalized;
      if (documentRef.documentElement) {
        documentRef.documentElement.lang = normalized;
      }
      applyStaticTranslations();
      if (inputEl) {
        inputEl.placeholder = state.uiMode === 'cortex' ? translate('cortexComposerPlaceholder') : translate('composerPlaceholder');
      }
      if (options.rerender !== false) {
        setUiMode(state.uiMode);
        renderNextSteps();
        renderCortexLearning(state.cortexLearningByProject[state.selectedProjectId] || null);
        renderAiSettingsApiList();
        refreshAiSettingsCurrentLine();
        renderWelcomePanel();
      }
    }

    function applyAccountPreferences(user = null) {
      if (!user) return;
      const themePreference = String(user.themePreference || '').trim();
      const languagePreference = String(user.languagePreference || '').trim();
      if (themePreference === 'light' || themePreference === 'dark') {
        applyAppearanceSettings({
          interfaceTheme: themePreference,
          panelFontScale: state.panelFontScale,
        }, { rerender: false });
      }
      if (languagePreference) {
        applyInterfaceLanguage(languagePreference, { rerender: false });
      }
    }

    return {
      applyAccountPreferences,
      applyAppearanceSettings,
      applyInterfaceLanguage,
    };
  }

  window.FaberAppPreferences = {
    createAppPreferencesController,
  };
})();
