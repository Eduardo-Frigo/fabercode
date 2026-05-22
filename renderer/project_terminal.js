(function () {
  function createProjectTerminalController(options = {}) {
    const api = options.api || {};
    const getProjectId = typeof options.getProjectId === 'function' ? options.getProjectId : () => null;
    const getProjectInfo = typeof options.getProjectInfo === 'function' ? options.getProjectInfo : () => null;
    const getProjects = typeof options.getProjects === 'function' ? options.getProjects : () => [];
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
      placement: document.getElementById('project-terminal-placement'),
      newTab: document.getElementById('project-terminal-new-tab'),
      clear: document.getElementById('project-terminal-clear'),
      stop: document.getElementById('project-terminal-stop'),
      minimize: document.getElementById('project-terminal-minimize'),
      close: document.getElementById('project-terminal-close'),
      filesTree: document.getElementById('project-files-tree'),
    };

    const terminalState = {
      panelOpen: false,
      panelMinimized: false,
      panelPlacement: 'bottom',
      sessionsByProject: {},
      activeSessionByProject: {},
    };

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

    function placePanel() {
      if (!elements.panel || !elements.filesTree) return;
      const filesBox = elements.filesTree.closest('.next-steps-box');
      if (!filesBox || !filesBox.parentElement) return;
      if (terminalState.panelPlacement === 'top') {
        if (filesBox.previousElementSibling !== elements.panel) {
          filesBox.parentElement.insertBefore(elements.panel, filesBox);
        }
      } else if (filesBox.nextElementSibling !== elements.panel) {
        filesBox.parentElement.insertBefore(elements.panel, filesBox.nextElementSibling);
      }
    }

    function render() {
      if (!elements.panel) return;
      const info = getProjectInfo();
      const hasProject = Boolean(info && info.rootPath);
      if (elements.button) elements.button.disabled = !hasProject;
      if (!hasProject || !terminalState.panelOpen) {
        elements.panel.classList.add('hidden');
        return;
      }

      placePanel();
      const sessions = getSessionsForActiveProject();
      const activeSession = getActiveSession();
      elements.panel.classList.remove('hidden');
      elements.panel.classList.toggle('is-minimized', Boolean(terminalState.panelMinimized));
      elements.panel.dataset.placement = terminalState.panelPlacement;

      if (elements.tabs) {
        elements.tabs.innerHTML = '';
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
          elements.tabs.appendChild(tab);
        });
      }

      if (elements.body) {
        elements.body.classList.toggle('hidden', Boolean(terminalState.panelMinimized));
      }
      if (elements.cwd) {
        elements.cwd.textContent = activeSession ? activeSession.cwd || '.' : '.';
      }
      if (elements.output) {
        const nextOutput = activeSession ? activeSession.output || '' : 'Nenhum terminal aberto.\n';
        if (elements.output.textContent !== nextOutput) {
          elements.output.textContent = nextOutput;
          elements.output.scrollTop = elements.output.scrollHeight;
        }
      }

      const isRunning = activeSession && activeSession.status === 'running';
      if (elements.input) elements.input.disabled = !activeSession || isRunning;
      if (elements.stop) elements.stop.disabled = !isRunning;
      if (elements.clear) elements.clear.disabled = !activeSession;
      if (elements.close) elements.close.disabled = !activeSession;
      if (elements.minimize) {
        elements.minimize.textContent = terminalState.panelMinimized ? '▣' : '−';
      }
      if (elements.placement) {
        elements.placement.title = terminalState.panelPlacement === 'top'
          ? 'Mover terminal para baixo'
          : 'Mover terminal para cima';
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
          terminalState.panelOpen = false;
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
      if (elements.clear) elements.clear.addEventListener('click', clearSession);
      if (elements.stop) elements.stop.addEventListener('click', stopCommand);
      if (elements.close) elements.close.addEventListener('click', closeSession);
      if (elements.minimize) {
        elements.minimize.addEventListener('click', () => {
          terminalState.panelMinimized = !terminalState.panelMinimized;
          render();
        });
      }
      if (elements.placement) {
        elements.placement.addEventListener('click', () => {
          terminalState.panelPlacement = terminalState.panelPlacement === 'top' ? 'bottom' : 'top';
          render();
        });
      }
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
