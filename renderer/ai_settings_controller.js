(function () {
  const support = window.FaberAiSettingsSupport || {};
  const {
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
  } = support;

  const requiredHelpers = {
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

  Object.entries(requiredHelpers).forEach(([name, helper]) => {
    if (typeof helper !== 'function') {
      throw new Error(`Renderer incompleto: FaberAiSettingsSupport.${name} ausente.`);
    }
  });

  function createAiSettingsController(options = {}) {
    const api = options.api || {};
    const elements = window.FaberAiSettingsElements.getAiSettingsElements();
    const workspaceLayoutBuilderModule = window.FaberWorkspaceLayoutBuilder || {};
    const workspaceConfigurationAvailable = Boolean(elements.workspacePanel && elements.openWorkspace);

    let draft = null;
    let workspaceLayoutBuilder = null;

    function translate(key, fallback = '') {
      return typeof options.t === 'function' ? options.t(key, fallback) : fallback || key;
    }

    function notify(message) {
      if (typeof options.notify === 'function') options.notify(message);
    }

    function getSelectedProvider() {
      if (typeof options.getSelectedProvider === 'function') return options.getSelectedProvider();
      return 'rwkv';
    }

    function setSelectedProvider(provider) {
      const normalized = normalizeKnownProvider(provider);
      if (typeof options.setSelectedProvider === 'function') options.setSelectedProvider(normalized);
      return normalized;
    }

    function getInterfaceLanguage() {
      if (typeof options.getInterfaceLanguage === 'function') return options.getInterfaceLanguage();
      return 'pt-BR';
    }

    function applyInterfaceLanguage(language, applyOptions) {
      if (typeof options.applyInterfaceLanguage === 'function') {
        options.applyInterfaceLanguage(normalizeInterfaceLanguage(language), applyOptions);
      }
    }

    function getInterfaceTheme() {
      if (typeof options.getInterfaceTheme === 'function') return options.getInterfaceTheme();
      return 'dark';
    }

    function getPanelFontScale() {
      if (typeof options.getPanelFontScale === 'function') return options.getPanelFontScale();
      return 100;
    }

    function normalizeWorkspacePreferences(preferences = {}) {
      if (window.FaberWorkspaceLayoutPreferences && typeof window.FaberWorkspaceLayoutPreferences.normalizeWorkspaceLayoutPreferences === 'function') {
        return window.FaberWorkspaceLayoutPreferences.normalizeWorkspaceLayoutPreferences(preferences);
      }
      const toolPlacements = workspaceLayoutBuilderModule.normalizeToolPlacements
        ? workspaceLayoutBuilderModule.normalizeToolPlacements(preferences.toolPlacements)
        : {
            projects: 'left',
            chat: 'center',
            files: 'right',
            terminal: 'right',
            automations: 'right',
            cortex: 'right',
          };
      return {
        mode: String(preferences.mode || '').trim() === 'ide' ? 'ide' : 'chat',
        leftCollapsed: Boolean(preferences.leftCollapsed),
        rightCollapsed: Boolean(preferences.rightCollapsed),
        leftSlot: preferences.leftSlot || 'projects',
        rightSlot: preferences.rightSlot || 'files',
        terminalDock: preferences.terminalDock || 'right',
        automationDock: preferences.automationDock || 'right',
        toolPlacements,
      };
    }

    function getWorkspacePreferences() {
      if (typeof options.getWorkspacePreferences === 'function') {
        return normalizeWorkspacePreferences(options.getWorkspacePreferences());
      }
      return normalizeWorkspacePreferences({});
    }

    function applyWorkspacePreferences(preferences, applyOptions = {}) {
      if (typeof options.applyWorkspacePreferences === 'function') {
        options.applyWorkspacePreferences(normalizeWorkspacePreferences(preferences), applyOptions);
      }
    }

    function getWorkspaceLayoutBuilder() {
      if (!workspaceConfigurationAvailable) return null;
      if (workspaceLayoutBuilder) return workspaceLayoutBuilder;
      if (typeof workspaceLayoutBuilderModule.createWorkspaceLayoutBuilder !== 'function') return null;
      workspaceLayoutBuilder = workspaceLayoutBuilderModule.createWorkspaceLayoutBuilder({
        documentRef: document,
        elements,
        normalizePreferences: normalizeWorkspacePreferences,
        getLayout: () => (draft ? draft.workspaceLayout : null),
        onChange: (partial) => updateWorkspaceDraft(partial),
      });
      return workspaceLayoutBuilder;
    }

    function applyAppearanceSettings(settings, applyOptions) {
      if (typeof options.applyAppearanceSettings === 'function') {
        const nextSettings = settings || {};
        options.applyAppearanceSettings({
          interfaceTheme: normalizeInterfaceTheme(nextSettings.interfaceTheme || getInterfaceTheme()),
          panelFontScale: normalizePanelFontScale(nextSettings.panelFontScale || getPanelFontScale()),
        }, applyOptions);
      }
    }

    function updateStatus(message) {
      if (typeof options.updateStatus === 'function') options.updateStatus(message);
    }

    function compactKeyLabel(hasKey, keyMasked) {
      if (!hasKey) return translate('keyNotConfigured');
      const tail = String(keyMasked || '').replace(/^\*+/, '').trim();
      return tail ? translate('keySavedEnding').replace('{tail}', tail) : translate('keySaved');
    }

    function apiRowReadinessLabel(row) {
      if (!row) return translate('notConfigured');
      if (row.selectable) return translate('ready');
      if (row.kind === 'asset' && row.hasKey) return translate('ready');
      if (row.kind === 'builtin' && (row.provider === 'mock' || row.provider === 'rwkv')) return translate('ready');
      return translate('needsConfig');
    }

    function apiRowKindLabel(row) {
      if (!row) return 'API';
      if (row.kind === 'asset') return translate('assets');
      if (row.provider === 'mock' || row.provider === 'rwkv') return translate('local');
      return row.kind === 'custom' ? translate('custom') : translate('native');
    }

    function isBuiltInProviderDisabled(provider) {
      return window.FaberAiSettingsDraft.isBuiltInProviderDisabled(draft, provider);
    }

    function setBuiltInProviderDisabled(provider, disabled) {
      window.FaberAiSettingsDraft.setBuiltInProviderDisabled(draft, provider, disabled);
    }

    function showPanel(panel) {
      if (elements.homePanel) elements.homePanel.classList.toggle('hidden', panel !== 'home');
      if (elements.languagePanel) elements.languagePanel.classList.toggle('hidden', panel !== 'language');
      if (elements.appearancePanel) elements.appearancePanel.classList.toggle('hidden', panel !== 'appearance');
      if (elements.workspacePanel) elements.workspacePanel.classList.toggle('hidden', panel !== 'workspace');
      if (elements.accountPanel) elements.accountPanel.classList.toggle('hidden', panel !== 'account');
      if (elements.apisPanel) elements.apisPanel.classList.toggle('hidden', panel !== 'apis');
      if (elements.mcpPanel) elements.mcpPanel.classList.toggle('hidden', panel !== 'mcp');
    }

    function close() {
      if (!elements.modal) return;
      elements.modal.classList.add('hidden');
      elements.modal.setAttribute('aria-hidden', 'true');
      draft = null;
    }

    function isOpen() {
      return Boolean(elements.modal && !elements.modal.classList.contains('hidden'));
    }

    function createDraft(settings) {
      return window.FaberAiSettingsDraft.createAiSettingsDraft(settings);
    }

    function getDraftApiRows() {
      return window.FaberAiSettingsDraft.buildAiSettingsApiRows({ draft, translate });
    }

    function renderComposerProviderOptions(settings) {
      if (!elements.composerProvider) return;
      const rows = buildComposerProviderOptionsFromSettings(settings);
      const current = normalizeKnownProvider(getSelectedProvider() || elements.composerProvider.value || 'rwkv');

      elements.composerProvider.innerHTML = '';
      rows.forEach((entry) => {
        const opt = document.createElement('option');
        opt.value = entry.value;
        opt.textContent = entry.label;
        elements.composerProvider.appendChild(opt);
      });

      const exists = rows.some((entry) => entry.value === current);
      const selected = exists ? current : 'rwkv';
      elements.composerProvider.value = selected;
      setSelectedProvider(selected);
    }

    function refreshCurrentLine() {
      if (!elements.current || !draft) return;
      const rows = getDraftApiRows();
      const active = rows.find((row) => row.provider === draft.selectedProvider);
      elements.current.innerHTML = '';
      if (!active) {
        const title = document.createElement('strong');
        title.textContent = translate('noActiveAi');
        const detail = document.createElement('span');
        detail.textContent = translate('chooseReadyApi');
        elements.current.append(title, detail);
        return;
      }
      const title = document.createElement('strong');
      title.textContent = translate('activeAiProject').replace('{name}', active.title);
      const detail = document.createElement('span');
      const modelInfo = active.model ? translate('modelPrefix').replace('{model}', active.model) : translate('defaultLocalModel');
      detail.textContent = `${apiRowKindLabel(active)} | ${modelInfo} | ${compactKeyLabel(active.hasKey, active.keyMasked)}`;
      elements.current.append(title, detail);
    }

    function renderAppearanceControls() {
      if (!draft) return;
      const theme = normalizeInterfaceTheme(draft.interfaceTheme);
      const fontScale = normalizePanelFontScale(draft.panelFontScale);
      draft.interfaceTheme = theme;
      draft.panelFontScale = fontScale;
      if (elements.theme) elements.theme.value = theme;
      if (elements.fontScale) elements.fontScale.value = String(fontScale);
      if (elements.fontScaleValue) elements.fontScaleValue.textContent = `${fontScale}%`;
    }

    function renderWorkspaceControls() {
      if (!workspaceConfigurationAvailable || !draft) return;
      draft.workspaceLayout = normalizeWorkspacePreferences(draft.workspaceLayout || getWorkspacePreferences());
      if (elements.workspaceMode) elements.workspaceMode.value = draft.workspaceLayout.mode;
      if (elements.workspaceLeftCollapsed) elements.workspaceLeftCollapsed.checked = Boolean(draft.workspaceLayout.leftCollapsed);
      if (elements.workspaceRightCollapsed) elements.workspaceRightCollapsed.checked = Boolean(draft.workspaceLayout.rightCollapsed);
      if (elements.workspaceLeftSlot) elements.workspaceLeftSlot.value = draft.workspaceLayout.leftSlot;
      if (elements.workspaceRightSlot) elements.workspaceRightSlot.value = draft.workspaceLayout.rightSlot;
      if (elements.workspaceTerminalDock) elements.workspaceTerminalDock.value = draft.workspaceLayout.terminalDock;
      const builder = getWorkspaceLayoutBuilder();
      if (builder) builder.render();
      (elements.workspacePresetButtons || []).forEach((button) => {
        const preset = String(button.getAttribute('data-workspace-preset') || 'chat');
        const isActive = (
          (preset === 'chat' && draft.workspaceLayout.mode === 'chat' && draft.workspaceLayout.terminalDock !== 'bottom' && !draft.workspaceLayout.rightCollapsed) ||
          (preset === 'ide' && draft.workspaceLayout.mode === 'ide' && draft.workspaceLayout.terminalDock === 'bottom' && !draft.workspaceLayout.rightCollapsed) ||
          (preset === 'focus' && draft.workspaceLayout.rightCollapsed && draft.workspaceLayout.toolPlacements.projects === 'hidden')
        );
        button.classList.toggle('is-active', Boolean(isActive));
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    function updateWorkspaceDraft(partial = {}, applyOptions = {}) {
      if (!workspaceConfigurationAvailable) return;
      if (!draft) return;
      const merged = normalizeWorkspacePreferences({
        ...(draft.workspaceLayout || getWorkspacePreferences()),
        ...partial,
      });
      const changedControls = ['leftSlot', 'rightSlot', 'terminalDock', 'automationDock'].some((key) => (
        partial && Object.prototype.hasOwnProperty.call(partial, key)
      ));
      const builder = getWorkspaceLayoutBuilder();
      draft.workspaceLayout = partial && Object.prototype.hasOwnProperty.call(partial, 'toolPlacements')
        ? (builder ? builder.deriveControlsFromPlacements(merged) : merged)
        : (changedControls && builder ? builder.syncControlsFromPlacements(merged) : merged);
      renderWorkspaceControls();
      applyWorkspacePreferences(draft.workspaceLayout, {
        persist: true,
        applyPreset: Boolean(applyOptions.applyPreset),
      });
    }

    const accountPanel = window.FaberAiSettingsAccountPanel.createAiSettingsAccountPanel({
      api,
      elements,
      translate,
      notify,
    });
    const {
      completeEmailLogin,
      refreshAccountStatus,
      signOutAccount,
      startEmailLogin,
      startGoogleLogin,
    } = accountPanel;
    const mcpPanel = window.FaberAiSettingsMcpPanel && typeof window.FaberAiSettingsMcpPanel.createAiSettingsMcpPanel === 'function'
      ? window.FaberAiSettingsMcpPanel.createAiSettingsMcpPanel({
          api,
          elements,
          notify,
        })
      : null;

    function closeEditor() {
      if (elements.editor) elements.editor.classList.add('hidden');
      if (elements.editorId) elements.editorId.value = '';
      if (elements.editorKind) elements.editorKind.value = '';
      if (elements.editorProvider) elements.editorProvider.value = '';
      if (elements.editorLabel) elements.editorLabel.value = '';
      if (elements.editorModelPreset) elements.editorModelPreset.value = '';
      if (elements.editorModel) elements.editorModel.value = '';
      if (elements.editorKey) elements.editorKey.value = '';
      if (elements.editorWebsite) elements.editorWebsite.value = '';
    }

    function syncModelPresetSelection() {
      if (!elements.editorModelPreset || !elements.editorModel) return;
      const current = String(elements.editorModel.value || '').trim();
      const values = Array.from(elements.editorModelPreset.options || []).map((option) => option.value);
      elements.editorModelPreset.value = values.includes(current) ? current : '';
    }

    function renderModelPresetOptions(row) {
      if (!elements.editorModelPreset) return;
      const currentModel = row && row.model ? row.model : '';
      elements.editorModelPreset.innerHTML = '';
      buildModelPresetOptions(row, currentModel).forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.value;
        option.textContent = entry.label;
        elements.editorModelPreset.appendChild(option);
      });
      syncModelPresetSelection();
    }

    function setHelpLink(provider) {
      if (!elements.providerHelp || !elements.providerHelpLink) return;
      const href = providerDocsUrl(provider);
      if (href) {
        elements.providerHelp.classList.remove('hidden');
        elements.providerHelpLink.href = href;
      } else {
        elements.providerHelp.classList.add('hidden');
        elements.providerHelpLink.href = '#';
      }
    }

    function openEditorForRow(row) {
      if (!row) return;
      if (elements.editor) elements.editor.classList.remove('hidden');
      if (elements.editorId) elements.editorId.value = row.id;
      if (elements.editorKind) elements.editorKind.value = row.kind;
      if (elements.editorProvider) elements.editorProvider.value = row.kind === 'custom' ? (row.providerName || row.title) : row.title;
      if (elements.editorLabel) elements.editorLabel.value = row.apiLabel || '';
      if (elements.editorModel) elements.editorModel.value = row.model || '';
      if (elements.editorKey) elements.editorKey.value = '';
      if (elements.editorWebsite) elements.editorWebsite.value = row.website || '';
      if (elements.editorProvider) elements.editorProvider.disabled = row.kind === 'builtin' || row.kind === 'asset';
      renderModelPresetOptions(row);
      setHelpLink(row.providerHint || row.provider);
    }

    async function removeCustomApiDraft(customId) {
      if (!draft || !customId) return;
      const entry = draft.customApis.find((item) => item.id === customId);
      if (!entry) return;
      const label = entry.apiLabel || humanizeProviderName(entry.providerName || translate('customApis'));
      const confirmed = await window.faberConfirm(`Remover "${label}" das APIs salvas? A remoção só será gravada ao clicar em Salvar.`);
      if (!confirmed) return;

      draft.customApis = draft.customApis.filter((item) => item.id !== customId);
      if (normalizeKnownProvider(draft.selectedProvider) === `custom:${customId}`) {
        draft.selectedProvider = 'rwkv';
      }
      if (elements.editorId && elements.editorId.value === `custom:${customId}`) {
        closeEditor();
      }
      renderApiList();
      refreshCurrentLine();
      setHelpLink(draft.selectedProvider);
    }

    async function clearBuiltinRemoteProviderDraft(provider) {
      if (!draft) return;
      const normalized = normalizeKnownProvider(provider);
      const config = normalized === 'openai'
        ? draft.openai
        : normalized === 'gemini'
          ? draft.gemini
          : normalized === 'sambanova'
            ? draft.sambanova
            : null;
      if (!config) return;

      const label = normalized === 'openai' ? 'OpenAI API' : normalized === 'gemini' ? 'Gemini API' : 'SambaNova API';
      const confirmed = await window.faberConfirm(`Remover "${label}" da lista de APIs do projeto? O provedor continuará disponível para adicionar novamente.`);
      if (!confirmed) return;

      setBuiltInProviderDisabled(normalized, true);
      config.apiLabel = '';
      config.model = '';
      config.keyPending = '';
      config.keyCleared = true;
      config.hasKey = false;
      config.keyMasked = '';
      config.keySource = 'none';

      if (normalizeKnownProvider(draft.selectedProvider) === normalized) {
        draft.selectedProvider = 'rwkv';
      }

      if (elements.editorId && elements.editorId.value === `builtin:${normalized}`) {
        closeEditor();
      }
      renderApiList();
      refreshCurrentLine();
      setHelpLink(draft.selectedProvider);
    }

    function createApiActionButton(label, className, onClick, disabled = false) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = label;
      button.disabled = disabled;
      if (typeof onClick === 'function') button.addEventListener('click', onClick);
      return button;
    }

    function renderApiSection(title, rows) {
      const section = document.createElement('div');
      section.className = 'ai-settings-api-section';

      const heading = document.createElement('p');
      heading.className = 'ai-settings-api-section-title';
      heading.textContent = title;
      section.appendChild(heading);

      if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'ai-settings-api-empty';
        empty.textContent = translate('noCustomApi');
        section.appendChild(empty);
        return section;
      }

      rows.forEach((row) => {
        const isActive = row.provider === draft.selectedProvider;
        const isReady = Boolean(row.selectable);
        const item = document.createElement('div');
        item.className = 'ai-settings-api-item';
        if (isActive) item.classList.add('is-active');
        if (!isReady) item.classList.add('is-incomplete');

        const meta = document.createElement('div');
        meta.className = 'ai-settings-api-meta';

        const titleRow = document.createElement('div');
        titleRow.className = 'ai-settings-api-title-row';

        const titleEl = document.createElement('strong');
        titleEl.textContent = row.title;
        titleRow.appendChild(titleEl);

        const kindBadge = document.createElement('span');
        kindBadge.className = 'ai-settings-api-badge';
        kindBadge.textContent = apiRowKindLabel(row);
        titleRow.appendChild(kindBadge);

        const readinessBadge = document.createElement('span');
        readinessBadge.className = `ai-settings-api-badge${isReady ? '' : ' is-warning'}`;
        readinessBadge.textContent = apiRowReadinessLabel(row);
        titleRow.appendChild(readinessBadge);

        if (isActive) {
          const activeBadge = document.createElement('span');
          activeBadge.className = 'ai-settings-api-badge is-active';
          activeBadge.textContent = translate('active');
          titleRow.appendChild(activeBadge);
        }

        const detail = document.createElement('div');
        detail.className = 'ai-settings-api-detail';
        detail.textContent = row.subtitle || translate('noLabel');

        const facts = document.createElement('div');
        facts.className = 'ai-settings-api-facts';
      const modelInfo = row.kind === 'asset'
        ? translate('assetUsage')
        : row.model ? translate('modelPrefix').replace('{model}', row.model) : translate('defaultLocalModel');
      facts.textContent = `${modelInfo} | ${compactKeyLabel(row.hasKey, row.keyMasked)}`;

        meta.append(titleRow, detail, facts);

        const actions = document.createElement('div');
        actions.className = 'ai-settings-api-actions';

        if (isActive) {
          actions.appendChild(createApiActionButton(translate('active'), 'btn btn-muted', null, true));
        } else if (row.selectable) {
          actions.appendChild(createApiActionButton(translate('use'), 'btn btn-success', () => {
            draft.selectedProvider = normalizeKnownProvider(row.provider);
            refreshCurrentLine();
            renderApiList();
            setHelpLink(row.providerHint || row.provider);
          }));
        } else if (row.editable) {
          actions.appendChild(createApiActionButton(translate('configure'), 'btn btn-muted', () => {
            openEditorForRow(row);
          }));
        }

        if (row.editable && (row.selectable || isActive)) {
          actions.appendChild(createApiActionButton(translate('edit'), 'btn btn-muted', () => {
            openEditorForRow(row);
          }));
        }

        if (row.kind === 'custom' && row.customId) {
          actions.appendChild(createApiActionButton(translate('remove'), 'btn btn-danger', async () => {
            await removeCustomApiDraft(row.customId);
          }));
        } else if (row.kind === 'builtin' && (row.provider === 'openai' || row.provider === 'gemini' || row.provider === 'sambanova')) {
          actions.appendChild(createApiActionButton(translate('remove'), 'btn btn-danger', async () => {
            await clearBuiltinRemoteProviderDraft(row.provider);
          }));
        }

        item.append(meta, actions);
        section.appendChild(item);
      });

      return section;
    }

    function renderApiList() {
      if (!elements.apiList) return;
      elements.apiList.innerHTML = '';
      const rows = getDraftApiRows();
      const builtinRows = rows.filter((row) => row.kind === 'builtin');
      const customRows = rows.filter((row) => row.kind === 'custom');
      const assetRows = rows.filter((row) => row.kind === 'asset');
      elements.apiList.appendChild(renderApiSection(translate('nativeLocalProviders'), builtinRows));
      elements.apiList.appendChild(renderApiSection(translate('assetProviders'), assetRows));
      elements.apiList.appendChild(renderApiSection(translate('customApis'), customRows));
    }

    function addCustomApiDraft(providerValue) {
      if (!draft) return;
      const normalized = String(providerValue || '').trim().toLowerCase();
      const builtInProvider = normalizeKnownProvider(normalized);
      if (builtInProvider === 'openai' || builtInProvider === 'gemini' || builtInProvider === 'sambanova') {
        setBuiltInProviderDisabled(builtInProvider, false);
        renderApiList();
        refreshCurrentLine();
        const row = getDraftApiRows().find((item) => item.provider === builtInProvider);
        if (row) openEditorForRow(row);
        return;
      }

      const providerName = normalized === 'custom' ? '' : normalized;
      const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      draft.customApis.push({
        id,
        providerName,
        model: '',
        apiLabel: '',
        website: providerDocsUrl(providerName),
        keyPending: '',
        hasKey: false,
        keyMasked: '',
      });
      renderApiList();
      if (elements.editor) elements.editor.classList.remove('hidden');
      if (elements.editorId) elements.editorId.value = `custom:${id}`;
      if (elements.editorKind) elements.editorKind.value = 'custom';
      if (elements.editorProvider) elements.editorProvider.disabled = false;
      if (elements.editorProvider) elements.editorProvider.value = humanizeProviderName(providerName || '');
      if (elements.editorLabel) elements.editorLabel.value = '';
      if (elements.editorModel) elements.editorModel.value = '';
      if (elements.editorKey) elements.editorKey.value = '';
      if (elements.editorWebsite) elements.editorWebsite.value = providerDocsUrl(providerName);
      renderModelPresetOptions({
        kind: 'custom',
        provider: `custom:${id}`,
        providerHint: providerName,
        providerName,
        model: '',
        title: humanizeProviderName(providerName || ''),
      });
      setHelpLink(providerName);
    }

    function applyEditorChanges() {
      if (!draft || !elements.editorId) return true;
      const rowId = String(elements.editorId.value || '');
      if (!rowId) return true;
      const keyTyped = elements.editorKey ? String(elements.editorKey.value || '').trim() : '';
      const label = elements.editorLabel ? String(elements.editorLabel.value || '').trim() : '';
      const model = elements.editorModel ? String(elements.editorModel.value || '').trim() : '';
      const website = elements.editorWebsite ? String(elements.editorWebsite.value || '').trim() : '';
      const providerText = elements.editorProvider ? String(elements.editorProvider.value || '').trim() : '';

      if (rowId === 'builtin:openai') {
        draft.openai.apiLabel = label;
        draft.openai.model = model;
        if (keyTyped) {
          draft.openai.keyPending = keyTyped;
          draft.openai.keyCleared = false;
          draft.openai.hasKey = true;
          draft.openai.keyMasked = maskTail(keyTyped);
        }
      } else if (rowId === 'builtin:gemini') {
        draft.gemini.apiLabel = label;
        draft.gemini.model = model;
        if (keyTyped) {
          draft.gemini.keyPending = keyTyped;
          draft.gemini.keyCleared = false;
          draft.gemini.hasKey = true;
          draft.gemini.keyMasked = maskTail(keyTyped);
        }
      } else if (rowId === 'builtin:sambanova') {
        draft.sambanova.apiLabel = label;
        draft.sambanova.model = model;
        if (keyTyped) {
          draft.sambanova.keyPending = keyTyped;
          draft.sambanova.keyCleared = false;
          draft.sambanova.hasKey = true;
          draft.sambanova.keyMasked = maskTail(keyTyped);
        }
      } else if (rowId === 'asset:pexels') {
        if (keyTyped) {
          draft.pexels.keyPending = keyTyped;
          draft.pexels.keyCleared = false;
          draft.pexels.hasKey = true;
          draft.pexels.keyMasked = maskTail(keyTyped);
        }
      } else if (rowId.startsWith('custom:')) {
        const customId = rowId.slice('custom:'.length);
        const entry = draft.customApis.find((item) => item.id === customId);
        if (entry) {
          const providerName = normalizeCustomProviderName(providerText) || entry.providerName;
          if (!providerName) {
            window.alert('Informe o serviço da API antes de salvar este perfil.');
            return false;
          }
          entry.providerName = providerName;
          entry.apiLabel = label;
          entry.model = model;
          entry.website = website;
          if (keyTyped) {
            entry.keyPending = keyTyped;
            entry.hasKey = true;
            entry.keyMasked = maskTail(keyTyped);
          }
        }
      }

      closeEditor();
      renderApiList();
      refreshCurrentLine();
      return true;
    }

    async function open() {
      if (!elements.modal || !api.getAiSettings) {
        notify('Configurações de IA indisponíveis nesta build.');
        return;
      }

      let settings = null;
      try {
        settings = await api.getAiSettings();
      } catch {
        notify('Não consegui carregar as configurações de IA agora.');
        return;
      }

      if (!settings || !settings.ok) {
        notify('Não consegui carregar as configurações de IA agora.');
        return;
      }

      draft = createDraft(settings);
      draft.workspaceLayout = getWorkspacePreferences();
      applyInterfaceLanguage(draft.interfaceLanguage || getInterfaceLanguage(), { rerender: false });
      applyAppearanceSettings({
        interfaceTheme: draft.interfaceTheme || getInterfaceTheme(),
        panelFontScale: draft.panelFontScale || getPanelFontScale(),
      }, { rerender: false });
      setSelectedProvider(draft.selectedProvider);
      closeEditor();
      showPanel('home');
      if (elements.language) {
        elements.language.value = draft.interfaceLanguage || 'pt-BR';
      }
      renderAppearanceControls();
      await refreshAccountStatus();
      renderApiList();
      refreshCurrentLine();
      setHelpLink(getSelectedProvider());

      elements.modal.classList.remove('hidden');
      elements.modal.setAttribute('aria-hidden', 'false');
    }

    async function saveFromModal() {
      if (!api.saveAiSettings || !draft) {
        notify('Salvar configurações de IA ainda não está disponível nesta build.');
        return;
      }

      if (elements.editor && !elements.editor.classList.contains('hidden')) {
        const applied = applyEditorChanges();
        if (!applied) return;
      }

      const selectedProvider = normalizeKnownProvider(draft.selectedProvider);
      const selectedCustomId = selectedProvider.startsWith('custom:') ? selectedProvider.slice('custom:'.length) : '';
      const selectedBuiltInDisabled = normalizeDisabledBuiltInProviders(draft.disabledBuiltInProviders).includes(selectedProvider);
      const selectedProviderExists =
        !selectedBuiltInDisabled &&
        (!selectedCustomId || (draft.customApis || []).some((item) => item.id === selectedCustomId));
      const payload = {
        provider: selectedProviderExists ? selectedProvider : 'rwkv',
        interfaceLanguage: normalizeInterfaceLanguage(draft.interfaceLanguage),
        interfaceTheme: normalizeInterfaceTheme(draft.interfaceTheme),
        panelFontScale: normalizePanelFontScale(draft.panelFontScale),
        openaiModel: String(draft.openai.model || '').trim(),
        openaiApiLabel: String(draft.openai.apiLabel || '').trim(),
        geminiModel: String(draft.gemini.model || '').trim(),
        geminiApiLabel: String(draft.gemini.apiLabel || '').trim(),
        sambanovaModel: String(draft.sambanova.model || '').trim(),
        sambanovaApiLabel: String(draft.sambanova.apiLabel || '').trim(),
        disabledBuiltInProviders: normalizeDisabledBuiltInProviders(draft.disabledBuiltInProviders),
        customApis: (draft.customApis || []).map((item) => ({
          id: item.id,
          providerName: String(item.providerName || '').trim(),
          model: String(item.model || '').trim(),
          apiLabel: String(item.apiLabel || '').trim(),
          website: String(item.website || '').trim(),
          apiKey: String(item.keyPending || '').trim(),
        })),
      };

      if (String(draft.openai.keyPending || '').trim()) payload.openaiApiKey = String(draft.openai.keyPending || '').trim();
      else if (draft.openai.keyCleared) payload.openaiApiKey = '';
      if (String(draft.gemini.keyPending || '').trim()) payload.geminiApiKey = String(draft.gemini.keyPending || '').trim();
      else if (draft.gemini.keyCleared) payload.geminiApiKey = '';
      if (String(draft.sambanova.keyPending || '').trim()) payload.sambanovaApiKey = String(draft.sambanova.keyPending || '').trim();
      else if (draft.sambanova.keyCleared) payload.sambanovaApiKey = '';
      if (String(draft.pexels.keyPending || '').trim()) payload.pexelsApiKey = String(draft.pexels.keyPending || '').trim();
      else if (draft.pexels.keyCleared) payload.pexelsApiKey = '';

      const saved = await api.saveAiSettings(payload);
      if (!saved || !saved.ok) {
        notify('Não consegui salvar as configurações de IA nesta tentativa.');
        return;
      }

      setSelectedProvider(String(saved.provider || payload.provider || 'rwkv'));
      applyInterfaceLanguage(saved.interfaceLanguage || payload.interfaceLanguage || getInterfaceLanguage());
      applyAppearanceSettings({
        interfaceTheme: saved.interfaceTheme || payload.interfaceTheme || getInterfaceTheme(),
        panelFontScale: saved.panelFontScale || payload.panelFontScale || getPanelFontScale(),
      });
      try {
        const refreshedSettings = await api.getAiSettings();
        if (refreshedSettings && refreshedSettings.ok) {
          renderComposerProviderOptions(refreshedSettings);
        } else if (elements.composerProvider) {
          elements.composerProvider.value = getSelectedProvider();
        }
      } catch {
        if (elements.composerProvider) elements.composerProvider.value = getSelectedProvider();
      }
      if (typeof options.refreshAiStatus === 'function') await options.refreshAiStatus();

      updateStatus('Provedor selecionado: ' + providerStatusLabel(getSelectedProvider()));
      close();
    }

    async function applyComposerProviderBeforeSend() {
      if (!elements.composerProvider || !api || !api.setAiProvider) return;
      const chosen = normalizeKnownProvider(elements.composerProvider.value || getSelectedProvider() || 'rwkv');
      if (!chosen || chosen === getSelectedProvider()) return;
      try {
        const saved = await api.setAiProvider(chosen);
        if (saved && saved.ok) {
          setSelectedProvider(String(saved.provider || chosen));
          updateStatus('Provedor selecionado: ' + providerStatusLabel(getSelectedProvider()));
        }
      } catch {
        // segue com provedor atual
      }
    }

    async function loadInitialSettings() {
      if (!api || !api.getAiSettings) {
        if (elements.composerProvider) elements.composerProvider.value = normalizeKnownProvider(getSelectedProvider());
        return;
      }
      try {
        const settings = await api.getAiSettings();
        if (settings && settings.ok) {
          applyInterfaceLanguage(settings.interfaceLanguage || getInterfaceLanguage(), { rerender: false });
          applyAppearanceSettings({
            interfaceTheme: settings.interfaceTheme || getInterfaceTheme(),
            panelFontScale: settings.panelFontScale || getPanelFontScale(),
          }, { rerender: false });
          renderComposerProviderOptions(settings);
          if (!String(getSelectedProvider() || '').startsWith('custom:')) {
            setSelectedProvider(normalizeKnownProvider(settings.provider || getSelectedProvider() || 'rwkv'));
          }
          if (elements.composerProvider && getSelectedProvider()) {
            const desired = normalizeKnownProvider(getSelectedProvider());
            if ([...elements.composerProvider.options].some((opt) => opt.value === desired)) {
              elements.composerProvider.value = desired;
            }
          }
        }
      } catch {
        if (elements.composerProvider) elements.composerProvider.value = normalizeKnownProvider(getSelectedProvider());
      }
    }

    function bindEvents() {
      if (elements.composerProvider && api && api.setAiProvider) {
        elements.composerProvider.addEventListener('change', async () => {
          const chosen = normalizeKnownProvider(elements.composerProvider.value || getSelectedProvider() || 'rwkv');
          const saved = await api.setAiProvider(chosen);
          if (saved && saved.ok) {
            setSelectedProvider(String(saved.provider || chosen));
            updateStatus('Provedor selecionado: ' + providerStatusLabel(getSelectedProvider()));
          }
        });
      }

      if (elements.openLanguage) {
        elements.openLanguage.addEventListener('click', () => {
          showPanel('language');
          if (elements.language && draft) {
            elements.language.value = draft.interfaceLanguage || 'pt-BR';
          }
        });
      }

      if (elements.language) {
        elements.language.addEventListener('change', () => {
          if (!draft) return;
          draft.interfaceLanguage = normalizeInterfaceLanguage(elements.language.value);
          elements.language.value = draft.interfaceLanguage;
          applyInterfaceLanguage(draft.interfaceLanguage);
        });
      }

      if (elements.openAppearance) {
        elements.openAppearance.addEventListener('click', () => {
          showPanel('appearance');
          renderAppearanceControls();
        });
      }

      if (workspaceConfigurationAvailable && elements.openWorkspace) {
        elements.openWorkspace.addEventListener('click', () => {
          showPanel('workspace');
          renderWorkspaceControls();
        });
      }

      if (elements.openAccount) {
        elements.openAccount.addEventListener('click', async () => {
          showPanel('account');
          await refreshAccountStatus();
        });
      }

      if (elements.theme) {
        elements.theme.addEventListener('change', () => {
          if (!draft) return;
          draft.interfaceTheme = normalizeInterfaceTheme(elements.theme.value);
          renderAppearanceControls();
          applyAppearanceSettings({
            interfaceTheme: draft.interfaceTheme,
            panelFontScale: draft.panelFontScale,
          });
        });
      }

      if (elements.fontScale) {
        elements.fontScale.addEventListener('input', () => {
          if (!draft) return;
          draft.panelFontScale = normalizePanelFontScale(elements.fontScale.value);
          renderAppearanceControls();
          applyAppearanceSettings({
            interfaceTheme: draft.interfaceTheme,
            panelFontScale: draft.panelFontScale,
          });
        });
      }

      if (workspaceConfigurationAvailable && elements.workspaceMode) {
        elements.workspaceMode.addEventListener('change', () => {
          updateWorkspaceDraft({ mode: elements.workspaceMode.value }, { applyPreset: true });
        });
      }

      if (workspaceConfigurationAvailable && elements.workspaceLeftCollapsed) {
        elements.workspaceLeftCollapsed.addEventListener('change', () => {
          updateWorkspaceDraft({ leftCollapsed: elements.workspaceLeftCollapsed.checked });
        });
      }

      if (workspaceConfigurationAvailable && elements.workspaceRightCollapsed) {
        elements.workspaceRightCollapsed.addEventListener('change', () => {
          updateWorkspaceDraft({ rightCollapsed: elements.workspaceRightCollapsed.checked });
        });
      }

      if (workspaceConfigurationAvailable && elements.workspaceLeftSlot) {
        elements.workspaceLeftSlot.addEventListener('change', () => {
          updateWorkspaceDraft({ leftSlot: elements.workspaceLeftSlot.value });
        });
      }

      if (workspaceConfigurationAvailable && elements.workspaceRightSlot) {
        elements.workspaceRightSlot.addEventListener('change', () => {
          updateWorkspaceDraft({ rightSlot: elements.workspaceRightSlot.value });
        });
      }

      if (workspaceConfigurationAvailable && elements.workspaceTerminalDock) {
        elements.workspaceTerminalDock.addEventListener('change', () => {
          updateWorkspaceDraft({ terminalDock: elements.workspaceTerminalDock.value });
        });
      }

      if (workspaceConfigurationAvailable) {
        (elements.workspacePresetButtons || []).forEach((button) => {
          button.addEventListener('click', () => {
            const builderModule = workspaceLayoutBuilderModule;
            const preset = String(button.getAttribute('data-workspace-preset') || 'chat');
            if (typeof builderModule.buildWorkspacePreset === 'function') {
              const nextLayout = builderModule.buildWorkspacePreset(preset, draft ? draft.workspaceLayout : getWorkspacePreferences(), normalizeWorkspacePreferences);
              updateWorkspaceDraft(nextLayout, { applyPreset: true });
            }
          });
        });
      }

      const builder = getWorkspaceLayoutBuilder();
      if (builder) builder.bind();
      if (mcpPanel) mcpPanel.bindEvents();

      if (elements.openApis) {
        elements.openApis.addEventListener('click', () => {
          showPanel('apis');
          renderApiList();
          refreshCurrentLine();
        });
      }

      if (elements.openMcp) {
        elements.openMcp.addEventListener('click', async () => {
          showPanel('mcp');
          if (mcpPanel) await mcpPanel.refresh();
        });
      }

      if (elements.backHome) {
        elements.backHome.addEventListener('click', () => {
          showPanel('home');
          closeEditor();
        });
      }
      if (elements.backHomeMcp) {
        elements.backHomeMcp.addEventListener('click', () => {
          showPanel('home');
        });
      }

      if (elements.backHomeAppearance) {
        elements.backHomeAppearance.addEventListener('click', () => {
          showPanel('home');
        });
      }

      if (elements.backHomeWorkspace) {
        elements.backHomeWorkspace.addEventListener('click', () => {
          showPanel('home');
        });
      }

      if (elements.backHomeAccount) {
        elements.backHomeAccount.addEventListener('click', () => {
          showPanel('home');
        });
      }

      if (elements.backHomeApis) {
        elements.backHomeApis.addEventListener('click', () => {
          showPanel('home');
          closeEditor();
        });
      }

      if (elements.accountGoogleLogin) {
        elements.accountGoogleLogin.addEventListener('click', async () => {
          await startGoogleLogin();
        });
      }

      if (elements.accountEmailStart) {
        elements.accountEmailStart.addEventListener('click', async () => {
          await startEmailLogin();
        });
      }

      if (elements.accountEmailComplete) {
        elements.accountEmailComplete.addEventListener('click', async () => {
          await completeEmailLogin();
        });
      }

      if (elements.accountSignOut) {
        elements.accountSignOut.addEventListener('click', async () => {
          await signOutAccount();
        });
      }

      if (api && typeof api.onAccountEvent === 'function') {
        api.onAccountEvent((eventPayload = {}) => {
          const type = eventPayload && eventPayload.type ? String(eventPayload.type) : '';
          refreshAccountStatus(type === 'signed-out' ? translate('accountSignedOut') : translate('emailLoginComplete'));
        });
      }

      if (elements.addApi) {
        elements.addApi.addEventListener('click', () => {
          addCustomApiDraft(elements.addProvider ? elements.addProvider.value : 'custom');
        });
      }

      if (elements.editorCancel) {
        elements.editorCancel.addEventListener('click', () => {
          closeEditor();
        });
      }

      if (elements.editorSave) {
        elements.editorSave.addEventListener('click', () => {
          applyEditorChanges();
        });
      }

      if (elements.editorModelPreset && elements.editorModel) {
        elements.editorModelPreset.addEventListener('change', () => {
          const selected = String(elements.editorModelPreset.value || '').trim();
          if (selected) elements.editorModel.value = selected;
        });
      }

      if (elements.editorModel) {
        elements.editorModel.addEventListener('input', syncModelPresetSelection);
      }

      if (elements.editorProvider) {
        elements.editorProvider.addEventListener('input', () => {
          if (!elements.editorKind || elements.editorKind.value !== 'custom') return;
          const providerName = normalizeCustomProviderName(elements.editorProvider.value || '');
          renderModelPresetOptions({
            kind: 'custom',
            provider: `custom:${providerName || 'custom'}`,
            providerHint: providerName,
            providerName,
            model: elements.editorModel ? elements.editorModel.value : '',
            title: humanizeProviderName(providerName || ''),
          });
          setHelpLink(providerName);
        });
      }

      if (elements.save) {
        elements.save.addEventListener('click', async () => {
          await saveFromModal();
        });
      }

      if (elements.cancel) elements.cancel.addEventListener('click', close);
      if (elements.close) elements.close.addEventListener('click', close);
      if (elements.backdrop) elements.backdrop.addEventListener('click', close);
    }

    return {
      applyComposerProviderBeforeSend,
      bindEvents,
      close,
      isOpen,
      loadInitialSettings,
      open,
      refreshCurrentLine,
      renderApiList,
      renderComposerProviderOptions,
    };
  }

  window.FaberAiSettingsController = {
    createAiSettingsController,
  };
})();
