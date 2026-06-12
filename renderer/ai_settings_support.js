(function () {
  function normalizeKnownProvider(rawValue) {
    const normalized = String(rawValue || '').trim().toLowerCase();
    if (normalized.startsWith('custom:')) return normalized;
    if (normalized === 'mock') return 'mock';
    if (normalized === 'openai' || normalized === 'oai') return 'openai';
    if (normalized === 'gemini') return 'gemini';
    if (normalized === 'sambanova') return 'sambanova';
    if (normalized === 'rwkv') return 'rwkv';
    return 'rwkv';
  }

  function providerStatusLabel(providerValue) {
    const normalized = normalizeKnownProvider(providerValue);
    if (normalized === 'mock') return 'Mock local';
    if (normalized === 'openai') return 'OpenAI API';
    if (normalized === 'gemini') return 'Gemini API';
    if (normalized === 'sambanova') return 'SambaNova API';
    if (normalized.startsWith('custom:')) return 'API custom';
    return 'RWKV local';
  }

  function normalizeInterfaceLanguage(rawValue) {
    const normalized = String(rawValue || '').trim();
    const allowed = new Set(['pt-BR', 'en-US', 'es-ES']);
    return allowed.has(normalized) ? normalized : 'pt-BR';
  }

  function normalizeInterfaceTheme(rawValue) {
    if (window.FaberUiAppearance && typeof window.FaberUiAppearance.normalizeInterfaceTheme === 'function') {
      return window.FaberUiAppearance.normalizeInterfaceTheme(rawValue);
    }
    return String(rawValue || '').trim().toLowerCase() === 'light' ? 'light' : 'dark';
  }

  function normalizePanelFontScale(rawValue) {
    if (window.FaberUiAppearance && typeof window.FaberUiAppearance.normalizePanelFontScale === 'function') {
      return window.FaberUiAppearance.normalizePanelFontScale(rawValue);
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return 100;
    return Math.min(120, Math.max(90, Math.round(value / 5) * 5));
  }

  function humanizeProviderName(rawValue) {
    const normalized = String(rawValue || '').trim().toLowerCase();
    if (normalized === 'mock') return 'Mock Local';
    if (normalized === 'rwkv') return 'RWKV Local';
    if (normalized.includes('gemini') || normalized.includes('google')) return 'Gemini API';
    if (normalized.includes('sambanova') || normalized.includes('samba')) return 'SambaNova API';
    if (normalized.includes('openai')) return 'OpenAI API';
    if (normalized.includes('pexels')) return 'Pexels';
    if (normalized.includes('deepseek')) return 'DeepSeek API';
    return String(rawValue || 'Serviço customizado').trim() || 'Serviço customizado';
  }

  function providerDocsUrl(providerName) {
    const key = String(providerName || '').trim().toLowerCase();
    if (key.includes('gemini') || key.includes('google')) return 'https://aistudio.google.com/app/apikey';
    if (key.includes('sambanova') || key.includes('samba')) return 'https://cloud.sambanova.ai/';
    if (key.includes('openai')) return 'https://platform.openai.com/api-keys';
    if (key.includes('pexels')) return 'https://www.pexels.com/api/';
    if (key.includes('deepseek')) return 'https://platform.deepseek.com/api_keys';
    return '';
  }

  const MODEL_PRESETS = {
    openai: [
      { value: 'gpt-5-codex', label: 'GPT-5 Codex - recomendado para smoke de código' },
      { value: 'gpt-5.4', label: 'GPT-5.4 - raciocínio forte' },
      { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini - rápido e econômico' },
      { value: 'gpt-5.2', label: 'GPT-5.2 - fallback estável' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini - legado econômico' },
    ],
    gemini: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ],
    sambanova: [
      { value: 'Meta-Llama-3.1-405B-Instruct', label: 'Llama 3.1 405B Instruct' },
      { value: 'Meta-Llama-3.1-70B-Instruct', label: 'Llama 3.1 70B Instruct' },
    ],
  };

  function inferModelPresetProvider(rowOrProvider) {
    if (typeof rowOrProvider === 'string') return normalizeKnownProvider(rowOrProvider);
    const row = rowOrProvider && typeof rowOrProvider === 'object' ? rowOrProvider : {};
    const source = [
      row.provider,
      row.providerHint,
      row.providerName,
      row.title,
    ].map((item) => String(item || '').toLowerCase()).join(' ');
    if (source.includes('openai')) return 'openai';
    if (source.includes('gemini') || source.includes('google')) return 'gemini';
    if (source.includes('sambanova') || source.includes('samba')) return 'sambanova';
    return normalizeKnownProvider(row.provider || row.providerHint || row.providerName || '');
  }

  function buildModelPresetOptions(rowOrProvider, currentModel = '') {
    const provider = inferModelPresetProvider(rowOrProvider);
    const presets = MODEL_PRESETS[provider] || [];
    const current = String(currentModel || '').trim();
    const hasCurrentPreset = presets.some((item) => item.value === current);
    const options = [{ value: '', label: 'Modelo customizado' }, ...presets];
    if (current && !hasCurrentPreset) options.push({ value: current, label: current });
    return options;
  }

  function normalizeDisabledBuiltInProviders(rawList) {
    const allowed = new Set(['openai', 'gemini', 'sambanova']);
    const list = Array.isArray(rawList) ? rawList : [];
    return Array.from(new Set(list.map((item) => normalizeKnownProvider(item)).filter((item) => allowed.has(item))));
  }

  function normalizeCustomProviderName(rawValue) {
    const value = String(rawValue || '').trim();
    const low = value.toLowerCase();
    if (!value) return '';
    if (low.includes('openai')) return 'openai';
    if (low.includes('deepseek')) return 'deepseek';
    if (low.includes('gemini') || low.includes('google')) return 'gemini';
    if (low.includes('sambanova')) return 'sambanova';
    return value;
  }

  function maskTail(value, visibleTail = 4) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= visibleTail) return '*'.repeat(text.length);
    return '*'.repeat(Math.max(0, text.length - visibleTail)) + text.slice(-visibleTail);
  }

  function buildComposerProviderOptionsFromSettings(settings) {
    const disabledBuiltIns = new Set(normalizeDisabledBuiltInProviders(settings && settings.disabledBuiltInProviders));
    const options = [
      { value: 'mock', label: 'Mock Local' },
      { value: 'rwkv', label: 'RWKV Local' },
    ];
    if (!disabledBuiltIns.has('openai')) options.push({ value: 'openai', label: 'OpenAI API' });
    if (!disabledBuiltIns.has('gemini')) options.push({ value: 'gemini', label: 'Gemini API' });
    if (!disabledBuiltIns.has('sambanova')) options.push({ value: 'sambanova', label: 'SambaNova API' });

    const customApis = Array.isArray(settings && settings.customApis) ? settings.customApis : [];
    customApis.forEach((item) => {
      const id = String(item && item.id ? item.id : '').trim();
      if (!id) return;
      const providerName = String((item && item.providerName) || '').trim();
      const model = String((item && item.model) || '').trim();
      const hasKey = Boolean(item && item.hasKey);
      const website = String((item && item.website) || '').trim();
      const supportedKind = /(openai|deepseek|gemini|google|samba)/i.test(providerName);
      const selectable = hasKey && model && (supportedKind || website);
      if (!selectable) return;

      const labelBase = humanizeProviderName(providerName || 'API custom');
      const labelSuffix = String((item && item.apiLabel) || '').trim();
      const label = labelSuffix ? `${labelBase} - ${labelSuffix}` : labelBase;
      options.push({ value: `custom:${id}`, label });
    });

    return options;
  }

  window.FaberAiSettingsSupport = {
    buildComposerProviderOptionsFromSettings,
    buildModelPresetOptions,
    humanizeProviderName,
    maskTail,
    normalizeCustomProviderName,
    normalizeDisabledBuiltInProviders,
    normalizeInterfaceLanguage,
    normalizeInterfaceTheme,
    normalizeKnownProvider,
    normalizePanelFontScale,
    providerDocsUrl,
    providerStatusLabel,
  };
})();
