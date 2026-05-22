(function () {
  const support = window.FaberAiSettingsSupport || {};
  const {
    humanizeProviderName,
    normalizeDisabledBuiltInProviders,
    normalizeInterfaceLanguage,
    normalizeInterfaceTheme,
    normalizeKnownProvider,
    normalizePanelFontScale,
    providerDocsUrl,
  } = support;

  const requiredHelpers = {
    humanizeProviderName,
    normalizeDisabledBuiltInProviders,
    normalizeInterfaceLanguage,
    normalizeInterfaceTheme,
    normalizeKnownProvider,
    normalizePanelFontScale,
    providerDocsUrl,
  };

  Object.entries(requiredHelpers).forEach(([name, helper]) => {
    if (typeof helper !== 'function') {
      throw new Error(`Renderer incompleto: FaberAiSettingsSupport.${name} ausente.`);
    }
  });

  function isBuiltInProviderDisabled(draft, provider) {
    if (!draft) return false;
    const normalized = normalizeKnownProvider(provider);
    return normalizeDisabledBuiltInProviders(draft.disabledBuiltInProviders).includes(normalized);
  }

  function setBuiltInProviderDisabled(draft, provider, disabled) {
    if (!draft) return;
    const normalized = normalizeKnownProvider(provider);
    const current = new Set(normalizeDisabledBuiltInProviders(draft.disabledBuiltInProviders));
    if (disabled) current.add(normalized);
    else current.delete(normalized);
    draft.disabledBuiltInProviders = Array.from(current);
  }

  function createAiSettingsDraft(settings) {
    const customApis = Array.isArray(settings && settings.customApis) ? settings.customApis : [];
    return {
      selectedProvider: normalizeKnownProvider(settings && settings.provider ? settings.provider : 'rwkv'),
      interfaceLanguage: normalizeInterfaceLanguage(settings && settings.interfaceLanguage),
      interfaceTheme: normalizeInterfaceTheme(settings && settings.interfaceTheme),
      panelFontScale: normalizePanelFontScale(settings && settings.panelFontScale),
      disabledBuiltInProviders: normalizeDisabledBuiltInProviders(settings && settings.disabledBuiltInProviders),
      openai: {
        model: String((settings && settings.openai && settings.openai.model) || ''),
        apiLabel: String((settings && settings.openai && settings.openai.apiLabel) || ''),
        keyPending: '',
        keyCleared: false,
        hasKey: Boolean(settings && settings.openai && settings.openai.hasKey),
        keyMasked: String((settings && settings.openai && settings.openai.keyMasked) || ''),
        keySource: String((settings && settings.openai && settings.openai.keySource) || 'none'),
      },
      gemini: {
        model: String((settings && settings.gemini && settings.gemini.model) || ''),
        apiLabel: String((settings && settings.gemini && settings.gemini.apiLabel) || ''),
        keyPending: '',
        keyCleared: false,
        hasKey: Boolean(settings && settings.gemini && settings.gemini.hasKey),
        keyMasked: String((settings && settings.gemini && settings.gemini.keyMasked) || ''),
        keySource: String((settings && settings.gemini && settings.gemini.keySource) || 'none'),
      },
      sambanova: {
        model: String((settings && settings.sambanova && settings.sambanova.model) || ''),
        apiLabel: String((settings && settings.sambanova && settings.sambanova.apiLabel) || ''),
        keyPending: '',
        keyCleared: false,
        hasKey: Boolean(settings && settings.sambanova && settings.sambanova.hasKey),
        keyMasked: String((settings && settings.sambanova && settings.sambanova.keyMasked) || ''),
        keySource: String((settings && settings.sambanova && settings.sambanova.keySource) || 'none'),
      },
      pexels: {
        keyPending: '',
        keyCleared: false,
        hasKey: Boolean(settings && settings.mediaAssets && settings.mediaAssets.pexels && settings.mediaAssets.pexels.hasKey),
        keyMasked: String((settings && settings.mediaAssets && settings.mediaAssets.pexels && settings.mediaAssets.pexels.keyMasked) || ''),
        keySource: String((settings && settings.mediaAssets && settings.mediaAssets.pexels && settings.mediaAssets.pexels.keySource) || 'none'),
        website: String((settings && settings.mediaAssets && settings.mediaAssets.pexels && settings.mediaAssets.pexels.website) || providerDocsUrl('pexels')),
      },
      customApis: customApis.map((item, index) => ({
        id: String(item && item.id ? item.id : `custom-${Date.now()}-${index}`),
        providerName: String((item && item.providerName) || '').trim(),
        model: String((item && item.model) || '').trim(),
        apiLabel: String((item && item.apiLabel) || '').trim(),
        website: String((item && item.website) || '').trim(),
        keyPending: '',
        hasKey: Boolean(item && item.hasKey),
        keyMasked: String((item && item.keyMasked) || ''),
      })),
    };
  }

  function buildAiSettingsApiRows({ draft, translate }) {
    if (!draft) return [];
    const t = typeof translate === 'function' ? translate : (key) => key;
    const rows = [
      {
        id: 'builtin:mock',
        kind: 'builtin',
        provider: 'mock',
        providerName: 'mock',
        title: 'Mock Local',
        subtitle: 'Sem API | respostas determinísticas para testes',
        selectable: true,
        editable: false,
        hasKey: true,
        keyMasked: '',
        model: 'mock-persona',
        apiLabel: '',
        website: '',
      },
      {
        id: 'builtin:rwkv',
        kind: 'builtin',
        provider: 'rwkv',
        providerName: 'rwkv',
        title: 'RWKV Local',
        subtitle: 'Sem API key | execução local',
        selectable: true,
        editable: false,
        hasKey: true,
        keyMasked: '',
        model: '',
        apiLabel: '',
        website: '',
      },
    ];

    if (!isBuiltInProviderDisabled(draft, 'gemini')) {
      rows.push({
        id: 'builtin:gemini',
        kind: 'builtin',
        provider: 'gemini',
        providerName: 'gemini',
        title: 'Gemini API',
        subtitle: draft.gemini.apiLabel || 'Google AI Studio',
        selectable: Boolean(draft.gemini.hasKey && String(draft.gemini.model || '').trim()),
        editable: true,
        hasKey: draft.gemini.hasKey,
        keyMasked: draft.gemini.keyMasked,
        model: draft.gemini.model,
        apiLabel: draft.gemini.apiLabel,
        website: providerDocsUrl('gemini'),
      });
    }

    if (!isBuiltInProviderDisabled(draft, 'openai')) {
      rows.push({
        id: 'builtin:openai',
        kind: 'builtin',
        provider: 'openai',
        providerName: 'openai',
        title: 'OpenAI API',
        subtitle: draft.openai.apiLabel || 'OpenAI Platform',
        selectable: Boolean(draft.openai.hasKey && String(draft.openai.model || '').trim()),
        editable: true,
        hasKey: draft.openai.hasKey,
        keyMasked: draft.openai.keyMasked,
        model: draft.openai.model,
        apiLabel: draft.openai.apiLabel,
        website: providerDocsUrl('openai'),
      });
    }

    if (!isBuiltInProviderDisabled(draft, 'sambanova')) {
      rows.push({
        id: 'builtin:sambanova',
        kind: 'builtin',
        provider: 'sambanova',
        providerName: 'sambanova',
        title: 'SambaNova API',
        subtitle: draft.sambanova.apiLabel || 'SambaNova Cloud',
        selectable: Boolean(draft.sambanova.hasKey && String(draft.sambanova.model || '').trim()),
        editable: true,
        hasKey: draft.sambanova.hasKey,
        keyMasked: draft.sambanova.keyMasked,
        model: draft.sambanova.model,
        apiLabel: draft.sambanova.apiLabel,
        website: providerDocsUrl('sambanova'),
      });
    }

    rows.push({
      id: 'asset:pexels',
      kind: 'asset',
      provider: 'pexels',
      providerName: 'pexels',
      title: 'Pexels',
      subtitle: t('pexelsAssetSubtitle'),
      selectable: false,
      editable: true,
      hasKey: draft.pexels.hasKey,
      keyMasked: draft.pexels.keyMasked,
      model: '',
      apiLabel: '',
      website: draft.pexels.website || providerDocsUrl('pexels'),
    });

    draft.customApis.forEach((item) => {
      const providerName = String(item.providerName || '').trim();
      const normalizedProvider = providerName.toLowerCase();
      const hasRunnableKind = /(openai|deepseek|gemini|google|samba)/i.test(providerName);
      const selectable = Boolean(item.hasKey && String(item.model || '').trim() && (hasRunnableKind || String(item.website || '').trim()));

      rows.push({
        id: `custom:${item.id}`,
        kind: 'custom',
        provider: `custom:${item.id}`,
        customId: item.id,
        providerHint: normalizedProvider,
        providerName,
        title: humanizeProviderName(providerName || 'Serviço customizado'),
        subtitle: item.apiLabel || t('customProfile'),
        selectable,
        editable: true,
        hasKey: item.hasKey,
        keyMasked: item.keyMasked,
        model: item.model,
        apiLabel: item.apiLabel,
        website: item.website || providerDocsUrl(providerName),
      });
    });

    return rows;
  }

  window.FaberAiSettingsDraft = {
    buildAiSettingsApiRows,
    createAiSettingsDraft,
    isBuiltInProviderDisabled,
    setBuiltInProviderDisabled,
  };
})();
