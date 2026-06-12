(function () {
  const support = window.FaberAiSettingsSupport || {};
  const controller = window.FaberAiSettingsController || {};

  const requiredSupportMethods = [
    'buildComposerProviderOptionsFromSettings',
    'buildModelPresetOptions',
    'normalizeInterfaceLanguage',
    'normalizeInterfaceTheme',
    'normalizeKnownProvider',
    'normalizePanelFontScale',
    'providerStatusLabel',
  ];

  requiredSupportMethods.forEach((method) => {
    if (typeof support[method] !== 'function') {
      throw new Error(`Renderer incompleto: FaberAiSettingsSupport.${method} ausente.`);
    }
  });

  if (typeof controller.createAiSettingsController !== 'function') {
    throw new Error('Renderer incompleto: FaberAiSettingsController.createAiSettingsController ausente.');
  }

  window.FaberAiSettings = {
    buildComposerProviderOptionsFromSettings: support.buildComposerProviderOptionsFromSettings,
    buildModelPresetOptions: support.buildModelPresetOptions,
    createAiSettingsController: controller.createAiSettingsController,
    normalizeInterfaceLanguage: support.normalizeInterfaceLanguage,
    normalizeInterfaceTheme: support.normalizeInterfaceTheme,
    normalizeKnownProvider: support.normalizeKnownProvider,
    normalizePanelFontScale: support.normalizePanelFontScale,
    providerStatusLabel: support.providerStatusLabel,
  };
})();
