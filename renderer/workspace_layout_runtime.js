(function () {
  const TOOL_ORDER = ['projects', 'files', 'terminal', 'cortex', 'chat', 'milestones', 'automations'];
  const ZONE_ORDER = {
    left: ['projects', 'files', 'cortex', 'terminal', 'chat', 'milestones', 'automations'],
    center: ['chat'],
    'center-tools': ['files', 'cortex', 'milestones', 'automations'],
    right: ['files', 'terminal', 'cortex', 'chat', 'projects', 'milestones', 'automations'],
    bottom: ['terminal', 'cortex', 'milestones', 'automations'],
  };

  function normalizePreferences(preferences = {}) {
    if (window.FaberWorkspaceLayoutPreferences && typeof window.FaberWorkspaceLayoutPreferences.normalizeWorkspaceLayoutPreferences === 'function') {
      return window.FaberWorkspaceLayoutPreferences.normalizeWorkspaceLayoutPreferences(preferences);
    }
    return {
      mode: String(preferences.mode || '').trim() === 'ide' ? 'ide' : 'chat',
      leftCollapsed: Boolean(preferences.leftCollapsed),
      rightCollapsed: Boolean(preferences.rightCollapsed),
      leftSlot: preferences.leftSlot || 'projects',
      rightSlot: preferences.rightSlot || 'files',
      terminalDock: preferences.terminalDock === 'bottom' ? 'bottom' : 'right',
      automationDock: preferences.automationDock === 'left' ? 'left' : 'right',
      toolPlacements: {
        projects: 'left',
        chat: 'center',
        files: 'right',
        terminal: preferences.terminalDock === 'bottom' ? 'bottom' : 'right',
        automations: 'right',
        cortex: 'right',
        milestones: 'right',
        ...(preferences.toolPlacements || {}),
      },
    };
  }

  function createWorkspaceLayoutRuntimeController(options = {}) {
    const doc = options.documentRef || document;

    function byId(id) {
      return doc.getElementById ? doc.getElementById(id) : null;
    }

    function getZones() {
      return {
        left: byId('workspace-left-zone'),
        center: byId('workspace-center-zone'),
        'center-tools': byId('workspace-center-tools-zone'),
        right: byId('workspace-right-zone'),
        bottom: byId('workspace-bottom-zone'),
      };
    }

    function getRegions() {
      return {
        projects: byId('workspace-projects-region'),
        chat: byId('workspace-chat-region'),
        files: byId('workspace-files-region'),
        terminal: byId('project-terminal-panel'),
        automations: byId('workspace-actions-region'),
        cortex: byId('cortex-learning-box'),
        milestones: byId('workspace-milestones-panel'),
      };
    }

    function zoneForTool(tool, placements) {
      const rawZone = placements && placements[tool] ? String(placements[tool]).trim().toLowerCase() : '';
      if (rawZone === 'left' || rawZone === 'right' || rawZone === 'bottom' || rawZone === 'hidden') return rawZone;
      if (rawZone === 'center') return tool === 'chat' ? 'center' : 'center-tools';
      return tool === 'projects' ? 'left' : tool === 'chat' ? 'center' : 'right';
    }

    function appendInOrder(zone, region, zoneName) {
      if (!zone || !region) return;
      const order = ZONE_ORDER[zoneName] || TOOL_ORDER;
      const tool = region.getAttribute ? region.getAttribute('data-workspace-runtime-tool') : '';
      const regionIndex = order.indexOf(tool);
      const children = Array.from(zone.children || []);
      const before = children.find((child) => {
        const childTool = child && child.getAttribute ? child.getAttribute('data-workspace-runtime-tool') : '';
        const childIndex = order.indexOf(childTool);
        return childIndex >= 0 && regionIndex >= 0 && childIndex > regionIndex;
      });
      zone.insertBefore(region, before || null);
    }

    function updateZoneState(zones) {
      Object.values(zones).forEach((zone) => {
        if (!zone || !zone.classList) return;
        const hasVisibleTool = Array.from(zone.children || []).some((child) => (
          child && child.classList && child.classList.contains('workspace-tool-region') && !child.classList.contains('workspace-runtime-hidden')
        ));
        zone.classList.toggle('is-empty', !hasVisibleTool);
      });
    }

    function applyPreferences(rawPreferences = {}) {
      const preferences = normalizePreferences(rawPreferences);
      const zones = getZones();
      const regions = getRegions();
      const placements = {
        ...preferences.toolPlacements,
        terminal: preferences.terminalDock === 'bottom' ? 'bottom' : preferences.toolPlacements.terminal,
      };

      TOOL_ORDER.forEach((tool) => {
        const region = regions[tool];
        if (!region) return;
        const zoneName = zoneForTool(tool, placements);
        const isHidden = zoneName === 'hidden';
        region.classList.toggle('workspace-runtime-hidden', isHidden);
        region.dataset.workspaceRuntimeZone = zoneName;
        if (isHidden) return;
        const targetZone = zones[zoneName] || zones.right;
        appendInOrder(targetZone, region, zoneName);
      });

      if (doc.body) {
        doc.body.dataset.workspaceRuntimeApplied = 'true';
      }
      updateZoneState(zones);
      return { preferences, zones, regions };
    }

    return {
      applyPreferences,
    };
  }

  window.FaberWorkspaceLayoutRuntime = {
    createWorkspaceLayoutRuntimeController,
  };
})();
