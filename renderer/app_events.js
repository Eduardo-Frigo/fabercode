(function () {
  function createAppEventsController({
    api = {},
    callbacks = {},
    controllers = {},
    elements = {},
  } = {}) {
    const {
      appDragRegionEl = null,
      appShellEl = null,
      cortexModeBtnEl = null,
      inputEl = null,
      newConversationBtnEl = null,
      projectGitBtnEl = null,
      projectPreviewBtnEl = null,
      projectSettingsBtnEl = null,
    } = elements;
    const {
      aiSettingsController = null,
      automataContractsController = null,
      chatController = null,
      cortexController = null,
      projectFileEditorController = null,
      projectFileTreeController = null,
      projectSidebarController = null,
      projectStateModalController = null,
      projectTerminalController = null,
      welcomeProjectModalController = null,
      accountGateController = null,
      workspaceLayoutController = null,
      applicationMapController = null,
    } = controllers;
    const {
      closeAiSettingsModal = () => {},
      closeCortexModal = () => {},
      closeProjectStateModal = () => {},
      closeWelcomeProjectModal = () => {},
      hideProjectContextMenu = () => {},
      onAddProject = async () => {},
      onCancel = async () => {},
      onConfirm = async () => {},
      onNewConversation = async () => {},
      onProjectGitClick = async () => {},
      onProjectPreviewClick = async () => {},
      onSend = async () => {},
      openAiSettingsModal = async () => {},
      openCortexModal = async () => {},
    } = callbacks;

    function bindEvents() {
      async function toggleWindowFromChrome(event) {
        event.preventDefault();
        try {
          await api.toggleWindowMaximize();
        } catch {}
      }
    
      if (appDragRegionEl) {
        appDragRegionEl.addEventListener('dblclick', toggleWindowFromChrome);
      }
    
      if (appShellEl) {
        appShellEl.addEventListener('dblclick', async (event) => {
          if (event.target !== appShellEl) return;
          await toggleWindowFromChrome(event);
        });
      }
    
      document.getElementById('btn-add-project').addEventListener('click', onAddProject);
      if (newConversationBtnEl) newConversationBtnEl.addEventListener('click', onNewConversation);
      document.getElementById('btn-send').addEventListener('click', onSend);
      document.getElementById('btn-confirm').addEventListener('click', onConfirm);
      document.getElementById('btn-cancel').addEventListener('click', onCancel);
    
      if (projectSettingsBtnEl) {
        projectSettingsBtnEl.addEventListener('click', async () => {
          await openAiSettingsModal();
        });
      }
      const projectFilesBtnEl = document.getElementById('btn-project-files');
      if (projectFilesBtnEl) {
        projectFilesBtnEl.addEventListener('click', () => {
          if (document.body.classList.contains('workspace-right-collapsed')) {
            if (workspaceLayoutController) {
              workspaceLayoutController.updatePreferences({ rightCollapsed: false }, { persist: true });
            } else {
              const rightToggle = document.getElementById('workspace-collapse-right');
              if (rightToggle) rightToggle.click();
            }
          }
          if (typeof setUiMode === 'function') {
            setUiMode('default');
          }
          document.body.classList.remove('mode-milestones');
          document.body.classList.remove('mode-map-chat');
          document.body.classList.remove('mode-map-render');
          document.body.classList.remove('mode-terminal');
          document.body.classList.remove('mode-git');

          // Reset center view: hide map canvas and show chat region
          if (applicationMapController && typeof applicationMapController.switchTab === 'function') {
            applicationMapController.switchTab('chat');
          }
          
          const milestonesBtn = document.getElementById('btn-project-milestones');
          if (milestonesBtn) milestonesBtn.classList.remove('active');
          const mapAiBtn = document.getElementById('btn-map-ai');
          if (mapAiBtn) mapAiBtn.classList.remove('active');
          const gitBtn = document.getElementById('btn-project-git');
          if (gitBtn) gitBtn.classList.remove('active');
          const terminalBtn = document.getElementById('btn-project-terminal');
          if (terminalBtn) terminalBtn.classList.remove('active');
          
          if (projectTerminalController) {
            projectTerminalController.closePanel();
          }
          const filesRegion = document.getElementById('workspace-files-region');
          if (filesRegion) filesRegion.classList.remove('workspace-runtime-hidden');
          
          projectFilesBtnEl.classList.add('active');
          
          const rightPanelTitle = document.getElementById('right-panel-title');
          if (rightPanelTitle) rightPanelTitle.textContent = 'Arquivos';
        });
      }
      if (projectGitBtnEl) {
        projectGitBtnEl.addEventListener('click', onProjectGitClick);
      }
      if (projectPreviewBtnEl) {
        projectPreviewBtnEl.addEventListener('click', onProjectPreviewClick);
      }
      if (cortexController) cortexController.bindEvents();
      if (chatController) chatController.bindEvents();
      if (projectSidebarController) projectSidebarController.bindEvents();
      if (projectStateModalController) projectStateModalController.bindEvents();
      if (welcomeProjectModalController) welcomeProjectModalController.bindEvents();
      if (projectTerminalController) projectTerminalController.bindEvents();
      if (automataContractsController) automataContractsController.bindEvents();
    
      if (accountGateController) accountGateController.bindEvents();
      if (aiSettingsController) aiSettingsController.bindEvents();
      if (projectFileTreeController) projectFileTreeController.bindEvents();
      if (projectFileEditorController) projectFileEditorController.bindEvents();
    
      document.addEventListener('keydown', async (event) => {
        if (event.key === 'Escape' && projectSidebarController && projectSidebarController.isContextMenuOpen()) {
          hideProjectContextMenu();
          return;
        }
        if (event.key === 'Escape' && welcomeProjectModalController && welcomeProjectModalController.isOpen()) {
          closeWelcomeProjectModal();
          return;
        }
        if (event.key === 'Escape' && projectStateModalController && projectStateModalController.isOpen()) {
          closeProjectStateModal();
          return;
        }
        if (event.key === 'Escape' && cortexController && cortexController.isOpen()) {
          closeCortexModal();
          return;
        }
        if (event.key === 'Escape' && aiSettingsController && aiSettingsController.isOpen()) {
          closeAiSettingsModal();
          return;
        }
        if (event.key === 'Escape' && automataContractsController) {
          automataContractsController.closePanel();
        }
      });
    
      inputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onSend();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          onSend();
        }
      });
    }

    return { bindEvents };
  }

  window.FaberAppEvents = {
    createAppEventsController,
  };
})();
