(function () {
  const TOOL_ORDER = ['projects', 'chat', 'files', 'terminal', 'automations', 'cortex'];
  const TOOL_LABELS = {
    projects: 'Projetos',
    chat: 'Chat',
    files: 'Arquivos',
    terminal: 'Terminal',
    automations: 'Automações',
    cortex: 'Cortex',
  };
  const DROP_ZONES = new Set(['left', 'center', 'right', 'bottom', 'hidden']);
  const PANEL_SLOTS = new Set(['projects', 'files', 'terminal', 'automations', 'cortex']);

  function normalizeToolPlacements(placements = {}) {
    if (window.FaberWorkspaceLayoutPreferences && typeof window.FaberWorkspaceLayoutPreferences.normalizeToolPlacements === 'function') {
      return window.FaberWorkspaceLayoutPreferences.normalizeToolPlacements(placements);
    }
    const source = placements && typeof placements === 'object' ? placements : {};
    const next = {
      projects: 'left',
      chat: 'center',
      files: 'right',
      terminal: 'right',
      automations: 'right',
      cortex: 'right',
    };
    TOOL_ORDER.forEach((tool) => {
      const zone = String(source[tool] || '').trim().toLowerCase();
      if (DROP_ZONES.has(zone)) next[tool] = zone;
    });
    return next;
  }

  function normalizeLayout(layout = {}, normalizePreferences) {
    if (typeof normalizePreferences === 'function') return normalizePreferences(layout);
    return {
      mode: String(layout.mode || '').trim() === 'ide' ? 'ide' : 'chat',
      leftCollapsed: Boolean(layout.leftCollapsed),
      rightCollapsed: Boolean(layout.rightCollapsed),
      leftSlot: layout.leftSlot || 'projects',
      rightSlot: layout.rightSlot || 'files',
      terminalDock: layout.terminalDock || 'right',
      automationDock: layout.automationDock || 'right',
      toolPlacements: normalizeToolPlacements(layout.toolPlacements),
    };
  }

  function syncControlsFromPlacements(layout = {}, normalizePreferences) {
    const normalized = normalizeLayout(layout, normalizePreferences);
    const placements = normalizeToolPlacements(normalized.toolPlacements);
    if (PANEL_SLOTS.has(normalized.leftSlot)) placements[normalized.leftSlot] = 'left';
    if (PANEL_SLOTS.has(normalized.rightSlot)) placements[normalized.rightSlot] = 'right';
    placements.terminal = normalized.terminalDock === 'bottom' ? 'bottom' : (placements.terminal === 'left' ? 'left' : 'right');
    placements.automations = normalized.automationDock === 'left' ? 'left' : (placements.automations === 'hidden' ? 'hidden' : 'right');
    return normalizeLayout({ ...normalized, toolPlacements: placements }, normalizePreferences);
  }

  function deriveControlsFromPlacements(layout = {}, normalizePreferences) {
    const normalized = normalizeLayout(layout, normalizePreferences);
    const placements = normalizeToolPlacements(normalized.toolPlacements);
    const leftSlot = TOOL_ORDER.find((tool) => placements[tool] === 'left' && PANEL_SLOTS.has(tool)) || normalized.leftSlot;
    const rightSlot = TOOL_ORDER.find((tool) => placements[tool] === 'right' && PANEL_SLOTS.has(tool)) || normalized.rightSlot;
    const terminalDock = placements.terminal === 'bottom' ? 'bottom' : 'right';
    const automationDock = placements.automations === 'left' ? 'left' : 'right';
    return normalizeLayout({
      ...normalized,
      leftSlot,
      rightSlot,
      terminalDock,
      automationDock,
      toolPlacements: placements,
    }, normalizePreferences);
  }

  function buildWorkspacePreset(presetName, currentLayout = {}, normalizePreferences) {
    const normalized = normalizeLayout(currentLayout, normalizePreferences);
    const preset = String(presetName || '').trim().toLowerCase();
    const base = {
      ...normalized,
      leftCollapsed: false,
      rightCollapsed: false,
    };
    if (preset === 'ide') {
      return deriveControlsFromPlacements({
        ...base,
        mode: 'ide',
        terminalDock: 'bottom',
        toolPlacements: {
          projects: 'left',
          chat: 'center',
          files: 'right',
          terminal: 'bottom',
          automations: 'right',
          cortex: 'right',
        },
      }, normalizePreferences);
    }
    if (preset === 'focus') {
      return deriveControlsFromPlacements({
        ...base,
        mode: normalized.mode,
        rightCollapsed: true,
        terminalDock: 'bottom',
        toolPlacements: {
          projects: 'hidden',
          chat: 'center',
          files: 'hidden',
          terminal: 'bottom',
          automations: 'hidden',
          cortex: 'hidden',
        },
      }, normalizePreferences);
    }
    return deriveControlsFromPlacements({
      ...base,
      mode: 'chat',
      terminalDock: 'right',
      toolPlacements: {
        projects: 'left',
        chat: 'center',
        files: 'right',
        terminal: 'right',
        automations: 'right',
        cortex: 'right',
      },
    }, normalizePreferences);
  }

  function createWorkspaceLayoutBuilder(options = {}) {
    const doc = options.documentRef || document;
    const elements = options.elements || {};
    const normalizePreferences = options.normalizePreferences;
    const getLayout = typeof options.getLayout === 'function' ? options.getLayout : () => ({});
    const onChange = typeof options.onChange === 'function' ? options.onChange : null;
    let draggedTool = '';
    let bound = false;

    function findZoneContainer(zone) {
      return (elements.workspaceZoneItemContainers || []).find((container) => (
        container.getAttribute('data-workspace-zone-items') === zone
      )) || null;
    }

    function createZoneChip(tool) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'workspace-tool-chip is-zone-chip';
      button.setAttribute('draggable', 'true');
      button.setAttribute('data-workspace-tool', tool);
      button.textContent = TOOL_LABELS[tool] || tool;
      return button;
    }

    function render() {
      const layout = normalizeLayout(getLayout(), normalizePreferences);
      const placements = normalizeToolPlacements(layout.toolPlacements);
      (elements.workspaceZoneItemContainers || []).forEach((container) => {
        container.innerHTML = '';
      });
      TOOL_ORDER.forEach((tool) => {
        const zone = placements[tool] || 'hidden';
        const container = findZoneContainer(zone);
        if (container) container.appendChild(createZoneChip(tool));
      });
      (elements.workspaceToolChips || []).forEach((chip) => {
        const tool = chip.getAttribute('data-workspace-tool');
        const zone = placements[tool] || 'hidden';
        chip.classList.toggle('is-placed', zone !== 'hidden');
        chip.setAttribute('data-active-zone', zone);
      });
    }

    function moveTool(tool, zone) {
      if (!TOOL_LABELS[tool] || !DROP_ZONES.has(zone)) return;
      const layout = normalizeLayout(getLayout(), normalizePreferences);
      const placements = normalizeToolPlacements(layout.toolPlacements);
      if (onChange) onChange({ toolPlacements: { ...placements, [tool]: zone } });
    }

    function readDraggedTool(event) {
      return (event.dataTransfer && event.dataTransfer.getData('text/plain')) || draggedTool;
    }

    function startDrag(event) {
      const target = event.target && event.target.closest ? event.target.closest('[data-workspace-tool]') : null;
      if (!target) return;
      draggedTool = target.getAttribute('data-workspace-tool') || '';
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedTool);
      }
    }

    function bind() {
      if (bound) return;
      bound = true;
      (elements.workspaceToolChips || []).forEach((chip) => {
        chip.addEventListener('dragstart', startDrag);
      });
      (elements.workspaceDropZones || []).forEach((zone) => {
        zone.addEventListener('dragstart', startDrag);
        zone.addEventListener('dragover', (event) => {
          event.preventDefault();
          zone.classList.add('is-drag-over');
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });
        zone.addEventListener('dragleave', () => {
          zone.classList.remove('is-drag-over');
        });
        zone.addEventListener('drop', (event) => {
          event.preventDefault();
          zone.classList.remove('is-drag-over');
          moveTool(readDraggedTool(event), zone.getAttribute('data-workspace-zone') || 'hidden');
          draggedTool = '';
        });
      });
    }

    return {
      bind,
      deriveControlsFromPlacements: (layout) => deriveControlsFromPlacements(layout, normalizePreferences),
      render,
      syncControlsFromPlacements: (layout) => syncControlsFromPlacements(layout, normalizePreferences),
    };
  }

  window.FaberWorkspaceLayoutBuilder = {
    buildWorkspacePreset,
    createWorkspaceLayoutBuilder,
    deriveControlsFromPlacements,
    normalizeToolPlacements,
    syncControlsFromPlacements,
  };
})();
