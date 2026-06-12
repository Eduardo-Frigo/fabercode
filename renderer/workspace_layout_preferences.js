(function () {
  const DEFAULT_STORAGE_KEY = 'faber.workspaceLayout.v1';
  const DEFAULT_ONBOARDING_KEY = 'faber.workspaceLayout.onboarding.v1';
  const WORKSPACE_MODES = new Set(['chat', 'ide']);
  const PANEL_SLOTS = new Set(['projects', 'files', 'terminal', 'automations', 'cortex']);
  const TERMINAL_DOCKS = new Set(['right', 'bottom']);
  const WORKSPACE_TOOL_ZONES = new Set(['left', 'center', 'right', 'bottom', 'hidden']);
  const DEFAULT_TOOL_PLACEMENTS = Object.freeze({
    projects: 'left',
    chat: 'center',
    files: 'right',
    terminal: 'right',
    automations: 'right',
    cortex: 'right',
  });

  const DEFAULT_PREFERENCES = {
    mode: 'chat',
    leftCollapsed: false,
    rightCollapsed: false,
    leftSlot: 'projects',
    rightSlot: 'files',
    terminalDock: 'right',
    automationDock: 'right',
    toolPlacements: DEFAULT_TOOL_PLACEMENTS,
  };

  const MODE_LAYOUT_PRESETS = {
    chat: { left: 320, right: 360 },
    ide: { left: 300, right: 460 },
  };

  function normalizeWorkspaceMode(rawValue) {
    const value = String(rawValue || '').trim().toLowerCase();
    if (value === 'ide' || value === 'developer' || value === 'programmer' || value === 'programador') return 'ide';
    return WORKSPACE_MODES.has(value) ? value : 'chat';
  }

  function normalizePanelSlot(rawValue, fallback = 'files') {
    const value = String(rawValue || '').trim().toLowerCase();
    return PANEL_SLOTS.has(value) ? value : fallback;
  }

  function normalizeTerminalDock(rawValue) {
    const value = String(rawValue || '').trim().toLowerCase();
    return TERMINAL_DOCKS.has(value) ? value : 'right';
  }

  function normalizeToolPlacements(rawPlacements = {}) {
    const source = rawPlacements && typeof rawPlacements === 'object' ? rawPlacements : {};
    const next = { ...DEFAULT_TOOL_PLACEMENTS };
    Object.keys(DEFAULT_TOOL_PLACEMENTS).forEach((tool) => {
      const zone = String(source[tool] || '').trim().toLowerCase();
      if (WORKSPACE_TOOL_ZONES.has(zone)) next[tool] = zone;
    });
    return next;
  }

  function normalizeWorkspaceLayoutPreferences(rawPreferences = {}) {
    const source = rawPreferences && typeof rawPreferences === 'object' ? rawPreferences : {};
    const mode = normalizeWorkspaceMode(source.mode);
    const toolPlacements = normalizeToolPlacements(source.toolPlacements);
    return {
      mode,
      leftCollapsed: Boolean(source.leftCollapsed),
      rightCollapsed: Boolean(source.rightCollapsed),
      leftSlot: normalizePanelSlot(source.leftSlot, DEFAULT_PREFERENCES.leftSlot),
      rightSlot: normalizePanelSlot(source.rightSlot, DEFAULT_PREFERENCES.rightSlot),
      terminalDock: normalizeTerminalDock(source.terminalDock),
      automationDock: String(source.automationDock || 'right').trim().toLowerCase() === 'left' ? 'left' : 'right',
      toolPlacements,
    };
  }

  function createWorkspaceLayoutPreferenceController(options = {}) {
    const doc = options.documentRef || document;
    const appShell = options.appShell || (doc.querySelector ? doc.querySelector('.app-shell') : null);
    const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
    const onboardingKey = options.onboardingKey || DEFAULT_ONBOARDING_KEY;
    const state = options.state || {};
    const panelLayoutController = options.panelLayoutController || null;
    const layoutRuntimeController = options.layoutRuntimeController || null;
    const onLayoutChanged = typeof options.onLayoutChanged === 'function' ? options.onLayoutChanged : () => {};
    const leftCollapsedRailWidth = Math.max(48, Number(options.leftCollapsedRailWidth || 58) || 58);
    const rightCollapsedRailWidth = Math.max(48, Number(options.rightCollapsedRailWidth || leftCollapsedRailWidth) || leftCollapsedRailWidth);
    const onboardingElements = {
      modal: doc.getElementById ? doc.getElementById('workspace-onboarding-modal') : null,
      skip: doc.getElementById ? doc.getElementById('workspace-onboarding-skip') : null,
      options: doc.querySelectorAll ? Array.from(doc.querySelectorAll('[data-workspace-onboarding-mode]')) : [],
    };

    let current = normalizeWorkspaceLayoutPreferences(state.workspaceLayoutPreferences || DEFAULT_PREFERENCES);
    let expandedLayout = null;

    function getStorage() {
      try {
        return doc.defaultView && doc.defaultView.localStorage ? doc.defaultView.localStorage : window.localStorage;
      } catch {
        return null;
      }
    }

    function readStoredPreferences() {
      const storage = getStorage();
      if (!storage) return normalizeWorkspaceLayoutPreferences(current);
      try {
        const rawStored = storage.getItem(storageKey);
        if (!rawStored) return normalizeWorkspaceLayoutPreferences(DEFAULT_PREFERENCES);
        const parsed = JSON.parse(rawStored || '{}');
        return normalizeWorkspaceLayoutPreferences({
          ...DEFAULT_PREFERENCES,
          leftCollapsed: Boolean(parsed.leftCollapsed),
          rightCollapsed: Boolean(parsed.rightCollapsed),
        });
      } catch {
        return normalizeWorkspaceLayoutPreferences(DEFAULT_PREFERENCES);
      }
    }

    function hasStoredPreferences() {
      const storage = getStorage();
      if (!storage) return false;
      try {
        return Boolean(storage.getItem(storageKey));
      } catch {
        return false;
      }
    }

    function hasCompletedOnboarding() {
      const storage = getStorage();
      if (!storage) return true;
      try {
        return storage.getItem(onboardingKey) === 'done';
      } catch {
        return true;
      }
    }

    function markOnboardingCompleted() {
      const storage = getStorage();
      if (!storage) return;
      try {
        storage.setItem(onboardingKey, 'done');
      } catch {}
    }

    function persistPreferences(preferences) {
      const storage = getStorage();
      if (!storage) return;
      try {
        storage.setItem(storageKey, JSON.stringify(normalizeWorkspaceLayoutPreferences(preferences)));
      } catch {}
    }

    function setButtonState(id, collapsed, labelOpen, labelClosed) {
      const button = doc.getElementById(id);
      if (!button) return;
      const label = collapsed ? labelClosed : labelOpen;
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    }

    function setOnboardingSelection(mode) {
      const normalizedMode = normalizeWorkspaceMode(mode);
      onboardingElements.options.forEach((button) => {
        const buttonMode = normalizeWorkspaceMode(button.getAttribute('data-workspace-onboarding-mode'));
        button.classList.toggle('is-selected', buttonMode === normalizedMode);
        button.setAttribute('aria-pressed', buttonMode === normalizedMode ? 'true' : 'false');
      });
    }

    function applyBodyState(preferences) {
      if (!doc.body) return;
      doc.body.dataset.workspaceMode = preferences.mode;
      doc.body.dataset.workspaceLeftSlot = preferences.leftSlot;
      doc.body.dataset.workspaceRightSlot = preferences.rightSlot;
      doc.body.dataset.workspaceTerminalDock = preferences.terminalDock;
      doc.body.dataset.workspaceToolProjects = preferences.toolPlacements.projects;
      doc.body.dataset.workspaceToolChat = preferences.toolPlacements.chat;
      doc.body.dataset.workspaceToolFiles = preferences.toolPlacements.files;
      doc.body.dataset.workspaceToolTerminal = preferences.toolPlacements.terminal;
      doc.body.dataset.workspaceToolAutomations = preferences.toolPlacements.automations;
      doc.body.dataset.workspaceToolCortex = preferences.toolPlacements.cortex;
      doc.body.classList.toggle('workspace-left-collapsed', Boolean(preferences.leftCollapsed));
      doc.body.classList.toggle('workspace-right-collapsed', Boolean(preferences.rightCollapsed));
    }

    function applyPanelPreset(mode) {
      const preset = MODE_LAYOUT_PRESETS[normalizeWorkspaceMode(mode)] || MODE_LAYOUT_PRESETS.chat;
      expandedLayout = { ...preset };
      if (panelLayoutController && typeof panelLayoutController.applyLayout === 'function') {
        panelLayoutController.applyLayout(preset, { persist: true });
      }
    }

    function rememberExpandedLayout(previousPreferences, nextPreferences) {
      const leftWillCollapse = !previousPreferences.leftCollapsed && nextPreferences.leftCollapsed;
      const rightWillCollapse = !previousPreferences.rightCollapsed && nextPreferences.rightCollapsed;
      if (!leftWillCollapse && !rightWillCollapse) return;
      if (panelLayoutController && typeof panelLayoutController.getCurrentLayout === 'function') {
        expandedLayout = panelLayoutController.getCurrentLayout();
      } else if (!expandedLayout) {
        expandedLayout = MODE_LAYOUT_PRESETS[nextPreferences.mode] || MODE_LAYOUT_PRESETS.chat;
      }
    }

    function applyCollapsedWidths(preferences, previousPreferences) {
      if (!appShell || !appShell.style) return;
      const fallback = MODE_LAYOUT_PRESETS[preferences.mode] || MODE_LAYOUT_PRESETS.chat;
      const restore = expandedLayout || fallback;
      if (preferences.leftCollapsed) {
        appShell.style.setProperty('--faber-left-panel-width', `${Math.round(leftCollapsedRailWidth)}px`);
        appShell.style.setProperty('--faber-left-splitter-width', '0px');
      } else if (previousPreferences.leftCollapsed) {
        appShell.style.setProperty('--faber-left-panel-width', `${Math.round(restore.left || fallback.left)}px`);
        appShell.style.setProperty('--faber-left-splitter-width', 'var(--faber-panel-splitter-width)');
      }
      if (preferences.rightCollapsed) {
        appShell.style.setProperty('--faber-right-panel-width', `${Math.round(rightCollapsedRailWidth)}px`);
        appShell.style.setProperty('--faber-right-splitter-width', '0px');
      } else if (previousPreferences.rightCollapsed) {
        appShell.style.setProperty('--faber-right-panel-width', `${Math.round(restore.right || fallback.right)}px`);
        appShell.style.setProperty('--faber-right-splitter-width', 'var(--faber-panel-splitter-width)');
      }
    }

    function applyPreferences(preferences = current, applyOptions = {}) {
      const previous = current;
      current = normalizeWorkspaceLayoutPreferences({ ...current, ...preferences });
      state.workspaceLayoutPreferences = current;
      rememberExpandedLayout(previous, current);
      applyBodyState(current);
      setButtonState('workspace-collapse-left', current.leftCollapsed, 'Recolher painel esquerdo', 'Expandir painel esquerdo');
      setButtonState('workspace-collapse-right', current.rightCollapsed, 'Recolher painel direito', 'Expandir painel direito');
      setButtonState('workspace-restore-left', current.leftCollapsed, 'Recolher painel esquerdo', 'Expandir painel esquerdo');
      setButtonState('workspace-restore-right', current.rightCollapsed, 'Recolher painel direito', 'Expandir painel direito');
      setOnboardingSelection(current.mode);
      if (applyOptions.applyPreset) applyPanelPreset(current.mode);
      applyCollapsedWidths(current, previous);
      if (layoutRuntimeController && typeof layoutRuntimeController.applyPreferences === 'function') {
        layoutRuntimeController.applyPreferences(current);
      }
      if (applyOptions.persist) persistPreferences(current);
      onLayoutChanged(current, previous);
      return current;
    }

    function updatePreferences(partial = {}, updateOptions = {}) {
      const previousMode = current.mode;
      const next = normalizeWorkspaceLayoutPreferences({ ...current, ...partial });
      const shouldApplyPreset = updateOptions.applyPreset || next.mode !== previousMode;
      return applyPreferences(next, {
        persist: updateOptions.persist !== false,
        applyPreset: shouldApplyPreset,
      });
    }

    function togglePanel(side) {
      if (side === 'left') return updatePreferences({ leftCollapsed: !current.leftCollapsed }, { persist: true });
      if (side === 'right') return updatePreferences({ rightCollapsed: !current.rightCollapsed }, { persist: true });
      return current;
    }

    function closeOnboarding() {
      if (!onboardingElements.modal) return;
      onboardingElements.modal.classList.add('hidden');
      onboardingElements.modal.setAttribute('aria-hidden', 'true');
    }

    function completeOnboarding(mode = 'chat') {
      markOnboardingCompleted();
      closeOnboarding();
      return updatePreferences({
        mode: normalizeWorkspaceMode(mode),
        leftCollapsed: false,
        rightCollapsed: false,
      }, { persist: true, applyPreset: true });
    }

    function maybeShowOnboarding(optionsForShow = {}) {
      if (!onboardingElements.modal) return false;
      if (optionsForShow.accountUnlocked === false) return false;
      if (hasStoredPreferences() || hasCompletedOnboarding()) return false;
      if (doc.body && doc.body.classList && doc.body.classList.contains('account-locked')) return false;
      onboardingElements.modal.classList.remove('hidden');
      onboardingElements.modal.setAttribute('aria-hidden', 'false');
      setOnboardingSelection(current.mode);
      return true;
    }

    function bindEvents() {
      const leftButton = doc.getElementById('workspace-collapse-left');
      const rightButton = doc.getElementById('workspace-collapse-right');
      const leftRestoreButton = doc.getElementById('workspace-restore-left');
      const rightRestoreButton = doc.getElementById('workspace-restore-right');
      if (leftButton) leftButton.addEventListener('click', () => togglePanel('left'));
      if (rightButton) rightButton.addEventListener('click', () => togglePanel('right'));
      if (leftRestoreButton) leftRestoreButton.addEventListener('click', () => updatePreferences({ leftCollapsed: false }, { persist: true }));
      if (rightRestoreButton) rightRestoreButton.addEventListener('click', () => updatePreferences({ rightCollapsed: false }, { persist: true }));
      onboardingElements.options.forEach((button) => {
        button.addEventListener('click', () => completeOnboarding(button.getAttribute('data-workspace-onboarding-mode') || 'chat'));
      });
      if (onboardingElements.skip) {
        onboardingElements.skip.addEventListener('click', () => completeOnboarding('chat'));
      }
    }

    function initialize() {
      current = readStoredPreferences();
      bindEvents();
      applyPreferences(current, { persist: false });
      return current;
    }

    return {
      applyPreferences,
      getPreferences: () => normalizeWorkspaceLayoutPreferences(current),
      initialize,
      normalizeWorkspaceLayoutPreferences,
      readStoredPreferences,
      maybeShowOnboarding,
      togglePanel,
      updatePreferences,
    };
  }

  window.FaberWorkspaceLayoutPreferences = {
    createWorkspaceLayoutPreferenceController,
    normalizePanelSlot,
    normalizeTerminalDock,
    normalizeToolPlacements,
    normalizeWorkspaceLayoutPreferences,
    normalizeWorkspaceMode,
  };
})();
