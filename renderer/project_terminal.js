(function () {
  function createProjectTerminalController(options = {}) {
    const api = options.api || {};
    const getProjectId = typeof options.getProjectId === 'function' ? options.getProjectId : () => null;
    const getProjectInfo = typeof options.getProjectInfo === 'function' ? options.getProjectInfo : () => null;
    const getProjects = typeof options.getProjects === 'function' ? options.getProjects : () => [];
    const getWorkspacePreferences = typeof options.getWorkspacePreferences === 'function'
      ? options.getWorkspacePreferences
      : () => null;
    const applyWorkspacePreferences = typeof options.applyWorkspacePreferences === 'function'
      ? options.applyWorkspacePreferences
      : null;
    const ensureProjectReady = typeof options.ensureProjectReady === 'function'
      ? options.ensureProjectReady
      : async () => Boolean(getProjectInfo() && getProjectInfo().rootPath);
    const notify = typeof options.notify === 'function' ? options.notify : () => {};

    const elements = {
      button: document.getElementById('btn-project-terminal'),
      panel: document.getElementById('project-terminal-panel'),
      tabs: document.getElementById('project-terminal-tabs'),
      body: document.getElementById('project-terminal-body'),
      output: document.getElementById('project-terminal-output'),
      form: document.getElementById('project-terminal-form'),
      input: document.getElementById('project-terminal-input'),
      cwd: document.getElementById('project-terminal-cwd'),
      status: document.getElementById('project-terminal-status'),
      placement: document.getElementById('project-terminal-placement'),
      newTab: document.getElementById('project-terminal-new-tab'),
      clear: document.getElementById('project-terminal-clear'),
      stop: document.getElementById('project-terminal-stop'),
      minimize: document.getElementById('project-terminal-minimize'),
      close: document.getElementById('project-terminal-close'),
      filesTree: document.getElementById('project-files-tree'),
    };

    const lightbox = {
      root: null,
      backdrop: null,
      shell: null,
    };

    const terminalState = {
      panelOpen: false,
      panelMinimized: false,
      panelPlacement: 'right',
      sessionsByProject: {},
      activeSessionByProject: {},
    };

    function getTerminalPlacement() {
      const preferences = getWorkspacePreferences() || {};
      const placement = preferences.toolPlacements && preferences.toolPlacements.terminal
        ? preferences.toolPlacements.terminal
        : preferences.terminalDock;
      if (placement === 'bottom') return 'bottom';
      if (placement === 'hidden') return 'hidden';
      return terminalState.panelPlacement === 'bottom' ? 'bottom' : 'right';
    }

    function setTerminalPlacement(placement) {
      const nextPlacement = placement === 'bottom' ? 'bottom' : 'right';
      terminalState.panelPlacement = nextPlacement;
      if (applyWorkspacePreferences) {
        const preferences = getWorkspacePreferences() || {};
        const toolPlacements = {
          ...(preferences.toolPlacements || {}),
          terminal: nextPlacement,
        };
        applyWorkspacePreferences({
          ...preferences,
          terminalDock: nextPlacement,
          toolPlacements,
        }, { persist: true });
      }
    }

    function getProjectKey() {
      const projectId = getProjectId();
      if (projectId) return projectId;
      const info = getProjectInfo();
      return info && info.rootPath ? String(info.rootPath) : '';
    }

    function getSessionsForActiveProject() {
      const key = getProjectKey();
      return key && Array.isArray(terminalState.sessionsByProject[key])
        ? terminalState.sessionsByProject[key]
        : [];
    }

    function setSessionsForActiveProject(sessions) {
      const key = getProjectKey();
      if (!key) return;
      terminalState.sessionsByProject[key] = Array.isArray(sessions) ? sessions : [];
      const activeId = terminalState.activeSessionByProject[key];
      if (!terminalState.sessionsByProject[key].some((session) => session && session.id === activeId)) {
        terminalState.activeSessionByProject[key] = terminalState.sessionsByProject[key][0]
          ? terminalState.sessionsByProject[key][0].id
          : null;
      }
    }

    function getActiveSession() {
      const key = getProjectKey();
      const sessions = getSessionsForActiveProject();
      const activeId = key ? terminalState.activeSessionByProject[key] : null;
      return sessions.find((session) => session && session.id === activeId) || sessions[0] || null;
    }

    function upsertSessionForRoot(session) {
      if (!session || !session.rootPath) return;
      const projects = Array.isArray(getProjects()) ? getProjects() : [];
      const project = projects.find((item) => item && item.rootPath === session.rootPath);
      const key = project ? project.id : session.rootPath;
      const existing = Array.isArray(terminalState.sessionsByProject[key])
        ? terminalState.sessionsByProject[key]
        : [];
      const next = existing.filter((item) => item && item.id !== session.id);
      next.push(session);
      terminalState.sessionsByProject[key] = next;
      if (!terminalState.activeSessionByProject[key]) {
        terminalState.activeSessionByProject[key] = session.id;
      }
    }

    function removeSessionForActiveProject(sessionId) {
      const key = getProjectKey();
      if (!key) return;
      const next = getSessionsForActiveProject().filter((session) => session && session.id !== sessionId);
      terminalState.sessionsByProject[key] = next;
      if (terminalState.activeSessionByProject[key] === sessionId) {
        terminalState.activeSessionByProject[key] = next[0] ? next[0].id : null;
      }
    }

    function closePanel() {
      terminalState.panelOpen = false;
      terminalState.panelMinimized = false;

      const placement = getTerminalPlacement();
      if (placement === 'right') {
        document.body.classList.remove('mode-terminal');
        const filesRegion = document.getElementById('workspace-files-region');
        if (filesRegion) filesRegion.classList.remove('workspace-runtime-hidden');

        const filesBtn = document.getElementById('btn-project-files');
        if (filesBtn) filesBtn.classList.add('active');
        if (elements.button) elements.button.classList.remove('active');

        const rightPanelTitle = document.getElementById('right-panel-title');
        if (rightPanelTitle) rightPanelTitle.textContent = 'Arquivos';
      }

      render();
    }

    function ensureLightbox() {
      if (lightbox.root) return lightbox;
      const root = document.createElement('div');
      root.id = 'project-terminal-lightbox';
      root.className = 'project-terminal-lightbox hidden';
      root.setAttribute('aria-hidden', 'true');

      const backdrop = document.createElement('button');
      backdrop.type = 'button';
      backdrop.className = 'project-terminal-lightbox__backdrop';
      backdrop.setAttribute('aria-label', 'Fechar terminal');

      const shell = document.createElement('div');
      shell.className = 'project-terminal-lightbox__shell';

      root.append(backdrop, shell);
      document.body.appendChild(root);
      backdrop.addEventListener('click', closePanel);

      lightbox.root = root;
      lightbox.backdrop = backdrop;
      lightbox.shell = shell;
      return lightbox;
    }

    function placePanel() {
      if (!elements.panel) return;
      const placement = getTerminalPlacement();

      if (placement === 'right') {
        const rightZone = document.getElementById('workspace-right-zone');
        const actionsRegion = document.getElementById('workspace-actions-region');
        if (rightZone && elements.panel.parentElement !== rightZone) {
          if (actionsRegion && actionsRegion.parentElement === rightZone) {
            rightZone.insertBefore(elements.panel, actionsRegion);
          } else {
            rightZone.appendChild(elements.panel);
          }
        }
        if (lightbox.root) {
          lightbox.root.classList.add('hidden');
          lightbox.root.setAttribute('aria-hidden', 'true');
          document.body.classList.remove('project-terminal-lightbox-open');
        }
        return;
      }

      if (placement === 'bottom') {
        const bottomZone = document.getElementById('workspace-bottom-zone');
        if (bottomZone && elements.panel.parentElement !== bottomZone) {
          bottomZone.appendChild(elements.panel);
        }
        if (lightbox.root) {
          lightbox.root.classList.add('hidden');
          lightbox.root.setAttribute('aria-hidden', 'true');
          document.body.classList.remove('project-terminal-lightbox-open');
        }
        return;
      }

      if (terminalState.panelOpen) {
        const surface = ensureLightbox();
        if (elements.panel.parentElement !== surface.shell) {
          surface.shell.appendChild(elements.panel);
        }
        return;
      }
      const bottomZone = document.getElementById('workspace-bottom-zone');
      const rightZone = document.getElementById('workspace-right-zone');
      const filesRegion = document.getElementById('workspace-files-region');
      if (placement === 'bottom' && bottomZone && elements.panel.parentElement !== bottomZone) {
        bottomZone.appendChild(elements.panel);
        return;
      }
      if (placement !== 'bottom' && rightZone && elements.panel.parentElement !== rightZone) {
        const reference = filesRegion && filesRegion.parentElement === rightZone ? filesRegion.nextSibling : rightZone.firstChild;
        rightZone.insertBefore(elements.panel, reference || null);
      }
    }

    function render() {
      if (!elements.panel) return;
      const info = getProjectInfo();
      const hasProject = Boolean(info && info.rootPath);
      if (elements.button) {
        elements.button.disabled = !hasProject;
        elements.button.classList.toggle('active', Boolean(hasProject && terminalState.panelOpen));
      }
      if (!hasProject || !terminalState.panelOpen) {
        elements.panel.classList.add('hidden');
        if (lightbox.root) {
          lightbox.root.classList.add('hidden');
          lightbox.root.setAttribute('aria-hidden', 'true');
          document.body.classList.remove('project-terminal-lightbox-open');
        }
        const placement = getTerminalPlacement();
        if (placement === 'right') {
          document.body.classList.remove('mode-terminal');
        }
        placePanel();
        return;
      }

      placePanel();
      const placement = getTerminalPlacement();
      if (placement === 'right') {
        document.body.classList.add('mode-terminal');
        document.body.classList.remove('mode-git');
        document.body.classList.remove('mode-cortex');
        document.body.classList.remove('mode-milestones');
        document.body.classList.remove('mode-map-chat');

        const cortexBtn = document.getElementById('btn-cortex-mode');
        if (cortexBtn) cortexBtn.classList.remove('active');
        const milestonesBtn = document.getElementById('btn-project-milestones');
        if (milestonesBtn) milestonesBtn.classList.remove('active');
        const mapAiBtn = document.getElementById('btn-map-ai');
        if (mapAiBtn) mapAiBtn.classList.remove('active');
        const gitBtn = document.getElementById('btn-project-git');
        if (gitBtn) gitBtn.classList.remove('active');
        const filesBtn = document.getElementById('btn-project-files');
        if (filesBtn) filesBtn.classList.remove('active');
        const filesRegion = document.getElementById('workspace-files-region');
        if (filesRegion) filesRegion.classList.add('workspace-runtime-hidden');

        if (elements.button) elements.button.classList.add('active');

        const rightPanelTitle = document.getElementById('right-panel-title');
        if (rightPanelTitle) rightPanelTitle.textContent = 'Terminal';

        if (document.body.classList.contains('workspace-right-collapsed')) {
          const rightToggle = document.getElementById('workspace-collapse-right');
          if (rightToggle) rightToggle.click();
        }

        if (lightbox.root) {
          lightbox.root.classList.add('hidden');
          lightbox.root.setAttribute('aria-hidden', 'true');
          document.body.classList.remove('project-terminal-lightbox-open');
        }
      } else if (placement === 'bottom') {
        document.body.classList.remove('mode-terminal');
        if (lightbox.root) {
          lightbox.root.classList.add('hidden');
          lightbox.root.setAttribute('aria-hidden', 'true');
          document.body.classList.remove('project-terminal-lightbox-open');
        }
      } else {
        if (lightbox.root) {
          lightbox.root.classList.remove('hidden');
          lightbox.root.setAttribute('aria-hidden', 'false');
          document.body.classList.add('project-terminal-lightbox-open');
        }
        document.body.classList.remove('mode-terminal');
      }

      const sessions = getSessionsForActiveProject();
      const activeSession = getActiveSession();
      elements.panel.classList.remove('hidden');
      elements.panel.classList.toggle('is-minimized', Boolean(terminalState.panelMinimized));
      elements.panel.dataset.placement = placement;
      elements.panel.dataset.sessionStatus = activeSession ? activeSession.status || 'idle' : 'empty';

      if (elements.tabs) {
        elements.tabs.innerHTML = '';
        const sessionWrap = document.createElement('div');
        sessionWrap.className = 'project-terminal-tabs__sessions';
        const actionWrap = document.createElement('div');
        actionWrap.className = 'project-terminal-tabs__actions';

        sessions.forEach((session) => {
          const tab = document.createElement('button');
          tab.type = 'button';
          tab.className = 'project-terminal-tab' + (activeSession && session.id === activeSession.id ? ' active' : '');
          tab.dataset.sessionId = session.id;
          tab.textContent = session.name || 'Terminal';
          tab.title = session.absoluteCwd || session.cwd || '';
          tab.addEventListener('click', () => {
            const key = getProjectKey();
            if (key) terminalState.activeSessionByProject[key] = session.id;
            render();
          });
          sessionWrap.appendChild(tab);
        });

        if (elements.newTab) actionWrap.appendChild(elements.newTab);
        if (elements.stop) actionWrap.appendChild(elements.stop);

        elements.tabs.append(sessionWrap, actionWrap);
      }

      if (elements.body) {
        elements.body.classList.toggle('hidden', Boolean(terminalState.panelMinimized));
      }
      if (elements.cwd) {
        elements.cwd.textContent = activeSession ? activeSession.cwd || '.' : '.';
      }
      if (elements.status) {
        const status = activeSession ? activeSession.status || 'idle' : 'empty';
        elements.status.textContent = status === 'running' ? 'Executando' : status === 'empty' ? 'Sem sessão' : 'Pronto';
        elements.status.dataset.status = status;
      }
      if (elements.output) {
        const nextOutput = activeSession ? activeSession.output || '' : 'Nenhum terminal aberto.\n';
        if (elements.output.textContent !== nextOutput) {
          elements.output.textContent = nextOutput;
          if (elements.body) {
            elements.body.scrollTop = elements.body.scrollHeight;
          } else {
            elements.output.scrollTop = elements.output.scrollHeight;
          }
        }
      }

      const isRunning = activeSession && activeSession.status === 'running';
      if (elements.input) elements.input.disabled = !activeSession || isRunning;
      if (elements.stop) elements.stop.disabled = !activeSession;
      if (elements.close) elements.close.disabled = false;
      if (elements.minimize) {
        elements.minimize.textContent = terminalState.panelMinimized ? '▣' : '−';
      }
      if (elements.placement) {
        elements.placement.textContent = placement === 'bottom' ? '▥' : '▤';
        elements.placement.title = placement === 'bottom'
          ? 'Mover terminal para o painel direito'
          : 'Mover terminal para a base';
        elements.placement.setAttribute('aria-label', elements.placement.title);
      }
    }

    async function refresh(options = {}) {
      const info = getProjectInfo();
      if (!info || !info.rootPath || !api.listProjectTerminalSessions) return false;
      const rootPath = info.rootPath;
      const listResult = await api.listProjectTerminalSessions({ rootPath });
      let sessions = listResult && listResult.ok && Array.isArray(listResult.sessions) ? listResult.sessions : [];
      if (!sessions.length && options.createIfEmpty && api.createProjectTerminalSession) {
        const createResult = await api.createProjectTerminalSession({
          rootPath,
          name: 'Terminal 1',
        });
        sessions = createResult && createResult.ok && createResult.session ? [createResult.session] : [];
      }
      setSessionsForActiveProject(sessions);
      render();
      return sessions.length > 0;
    }

    async function open() {
      const ready = await ensureProjectReady();
      const info = getProjectInfo();
      if (!ready || !info || !info.rootPath) {
        notify('Selecione um projeto antes de abrir o terminal.');
        return;
      }

      setTerminalPlacement('right');

      const placement = getTerminalPlacement();
      if (placement === 'right' && terminalState.panelOpen) {
        closePanel();
        return;
      }

      terminalState.panelOpen = true;
      terminalState.panelMinimized = false;
      await refresh({ createIfEmpty: true });
      render();
      if (elements.input && !elements.input.disabled) elements.input.focus();
    }

    async function createTab() {
      const info = getProjectInfo();
      if (!info || !info.rootPath || !api.createProjectTerminalSession) return null;
      const sessions = getSessionsForActiveProject();
      const result = await api.createProjectTerminalSession({
        rootPath: info.rootPath,
        name: `Terminal ${sessions.length + 1}`,
      });
      if (!result || !result.ok || !result.session) {
        notify((result && result.message) || 'Não consegui abrir um novo terminal.');
        return null;
      }
      const key = getProjectKey();
      terminalState.sessionsByProject[key] = [...sessions, result.session];
      terminalState.activeSessionByProject[key] = result.session.id;
      terminalState.panelOpen = true;
      terminalState.panelMinimized = false;
      render();
      if (elements.input) elements.input.focus();
      return result.session;
    }

    async function ensureRunnableSession(options = {}) {
      const ready = await ensureProjectReady();
      const info = getProjectInfo();
      if (!ready || !info || !info.rootPath) {
        notify('Selecione um projeto antes de abrir o terminal.');
        return null;
      }
      terminalState.panelOpen = true;
      terminalState.panelMinimized = false;
      await refresh({ createIfEmpty: true });
      let activeSession = getActiveSession();
      if (activeSession && activeSession.status === 'running' && options.createNewTabIfRunning !== false) {
        activeSession = await createTab();
      }
      render();
      return activeSession;
    }

    async function runProjectCommand(command, options = {}) {
      const commandText = String(command || '').trim();
      if (!commandText || !api.runProjectTerminalCommand) {
        return { ok: false, message: 'Terminal interno indisponível para executar o comando.' };
      }
      const activeSession = await ensureRunnableSession(options);
      if (!activeSession) return { ok: false, message: 'Não consegui abrir uma sessão de terminal.' };
      const info = getProjectInfo();
      if (!info || !info.rootPath) {
        return { ok: false, message: 'Projeto sem pasta local para executar no terminal.' };
      }

      if (elements.input) elements.input.value = '';
      const result = await api.runProjectTerminalCommand({
        rootPath: info.rootPath,
        sessionId: activeSession.id,
        command: commandText,
      });
      if (result && result.session) {
        upsertSessionForRoot(result.session);
        const key = getProjectKey();
        if (key) terminalState.activeSessionByProject[key] = result.session.id;
        render();
      }
      if (!result || !result.ok) {
        notify((result && result.message) || 'Não consegui executar o comando no terminal.');
      }
      return result || { ok: false, message: 'Não consegui executar o comando no terminal.' };
    }

    async function runCommand(event) {
      if (event) event.preventDefault();
      const activeSession = getActiveSession();
      const info = getProjectInfo();
      const command = elements.input ? elements.input.value.trim() : '';
      if (!activeSession || !command || !info || !info.rootPath || !api.runProjectTerminalCommand) return;
      elements.input.value = '';
      const result = await api.runProjectTerminalCommand({
        rootPath: info.rootPath,
        sessionId: activeSession.id,
        command,
      });
      if (result && result.session) {
        upsertSessionForRoot(result.session);
        render();
      }
      if (!result || !result.ok) {
        notify((result && result.message) || 'Não consegui executar o comando no terminal.');
      }
    }

    async function stopCommand() {
      const activeSession = getActiveSession();
      const info = getProjectInfo();
      if (!activeSession || !info || !info.rootPath || !api.stopProjectTerminalCommand) return;
      const result = await api.stopProjectTerminalCommand({
        rootPath: info.rootPath,
        sessionId: activeSession.id,
      });
      if (result && result.session) {
        upsertSessionForRoot(result.session);
        render();
      }
    }

    async function clearSession() {
      const activeSession = getActiveSession();
      const info = getProjectInfo();
      if (!activeSession || !info || !info.rootPath || !api.clearProjectTerminalSession) return;
      const result = await api.clearProjectTerminalSession({
        rootPath: info.rootPath,
        sessionId: activeSession.id,
      });
      if (result && result.session) {
        upsertSessionForRoot(result.session);
        render();
      }
    }

    async function closeSession() {
      const activeSession = getActiveSession();
      const info = getProjectInfo();
      if (!activeSession || !info || !info.rootPath || !api.closeProjectTerminalSession) return;
      const result = await api.closeProjectTerminalSession({
        rootPath: info.rootPath,
        sessionId: activeSession.id,
      });
      if (result && result.ok) {
        removeSessionForActiveProject(activeSession.id);
        if (!getSessionsForActiveProject().length) {
          closePanel();
          return;
        }
        render();
      }
    }

    function handleTerminalEvent(payload) {
      if (!payload || !payload.session) return;
      upsertSessionForRoot(payload.session);
      const active = getActiveSession();
      if (terminalState.panelOpen && active && active.id === payload.session.id) {
        render();
      }
    }

    function bindEvents() {
      if (elements.button) elements.button.addEventListener('click', open);
      if (elements.form) elements.form.addEventListener('submit', runCommand);
      if (elements.newTab) elements.newTab.addEventListener('click', createTab);
      if (elements.stop) elements.stop.addEventListener('click', closeSession);
      if (elements.close) elements.close.addEventListener('click', closePanel);
      if (elements.minimize) {
        elements.minimize.addEventListener('click', () => {
          terminalState.panelMinimized = !terminalState.panelMinimized;
          render();
        });
      }
      if (elements.placement) {
        elements.placement.addEventListener('click', () => {
          setTerminalPlacement(getTerminalPlacement() === 'bottom' ? 'right' : 'bottom');
          render();
        });
      }
      if (elements.body) {
        elements.body.addEventListener('click', () => {
          if (elements.input && !elements.input.disabled) {
            elements.input.focus();
          }
        });
      }
      if (elements.output) {
        elements.output.addEventListener('click', () => {
          const selection = window.getSelection ? window.getSelection().toString() : '';
          if (!selection && elements.input && !elements.input.disabled) {
            elements.input.focus();
          }
        });
      }
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && terminalState.panelOpen) closePanel();
      });
      if (api && typeof api.onProjectTerminalEvent === 'function') {
        api.onProjectTerminalEvent(handleTerminalEvent);
      }
    }

    function resetForNoProject() {
      terminalState.panelOpen = false;
      render();
    }

    function isOpen() {
      return Boolean(terminalState.panelOpen);
    }

    return {
      bindEvents,
      closePanel,
      createTab,
      isOpen,
      open,
      refresh,
      render,
      runProjectCommand,
      resetForNoProject,
    };
  }

  window.FaberProjectTerminal = {
    createProjectTerminalController,
  };
})();
