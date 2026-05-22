(function () {
  function normalizeProjectItems(rawProjects) {
    const arr = Array.isArray(rawProjects)
      ? rawProjects
      : rawProjects && Array.isArray(rawProjects.projects)
        ? rawProjects.projects
        : [];

    return arr.map((project, index) => {
      const safe = project && typeof project === 'object' ? project : {};
      const safeName = (safe.name && String(safe.name).trim()) || 'Projeto';
      const safeRoot = safe.rootPath ? String(safe.rootPath) : '';
      const safeId = safe.id || `legacy-${index}-${safeRoot || safeName}`;
      return {
        ...safe,
        id: safeId,
        name: safeName,
        rootPath: safeRoot,
      };
    });
  }

  function createProjectSidebarController(options = {}) {
    const elements = {
      list: options.listEl || document.getElementById('projects-list'),
      search: options.searchEl || document.getElementById('projects-search'),
      contextMenu: options.contextMenuEl || document.getElementById('project-context-menu'),
    };

    const getProjects = typeof options.getProjects === 'function' ? options.getProjects : () => [];
    const getSearchQuery = typeof options.getSearchQuery === 'function' ? options.getSearchQuery : () => '';
    const setSearchQuery = typeof options.setSearchQuery === 'function' ? options.setSearchQuery : () => {};
    const getSelectedProjectId = typeof options.getSelectedProjectId === 'function' ? options.getSelectedProjectId : () => null;
    const getExpandedProjects = typeof options.getExpandedProjects === 'function' ? options.getExpandedProjects : () => ({});
    const setProjectExpanded = typeof options.setProjectExpanded === 'function' ? options.setProjectExpanded : () => {};
    const getConversations = typeof options.getConversations === 'function' ? options.getConversations : () => [];
    const ensureConversationState = typeof options.ensureConversationState === 'function' ? options.ensureConversationState : () => {};
    const getActiveConversationId = typeof options.getActiveConversationId === 'function' ? options.getActiveConversationId : () => null;
    const onSelectProject = typeof options.onSelectProject === 'function' ? options.onSelectProject : async () => {};
    const onRefreshSelectedProjectFiles = typeof options.onRefreshSelectedProjectFiles === 'function'
      ? options.onRefreshSelectedProjectFiles
      : async () => {};
    const shouldResyncProject = typeof options.shouldResyncProject === 'function' ? options.shouldResyncProject : () => true;
    const onPrepareNewConversation = typeof options.onPrepareNewConversation === 'function'
      ? options.onPrepareNewConversation
      : async () => {};
    const onSelectConversation = typeof options.onSelectConversation === 'function' ? options.onSelectConversation : async () => {};
    const onRenameProject = typeof options.onRenameProject === 'function' ? options.onRenameProject : async () => {};
    const onRenameConversation = typeof options.onRenameConversation === 'function'
      ? options.onRenameConversation
      : async () => {};
    const onContextAction = typeof options.onContextAction === 'function' ? options.onContextAction : async () => {};

    let contextProjectId = null;

    function isProjectExpanded(projectId) {
      const expanded = getExpandedProjects() || {};
      return Boolean(expanded[projectId]);
    }

    function setExpanded(projectId, value) {
      setProjectExpanded(projectId, Boolean(value));
    }

    function showContextMenu(projectId, x, y) {
      if (!elements.contextMenu || !projectId) return;
      contextProjectId = projectId;
      elements.contextMenu.classList.remove('hidden');
      elements.contextMenu.setAttribute('aria-hidden', 'false');
      const menuWidth = Math.max(150, elements.contextMenu.offsetWidth || 150);
      const menuHeight = Math.max(120, elements.contextMenu.offsetHeight || 120);
      const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - menuHeight - 8);
      const safeLeft = Math.min(maxLeft, Math.max(8, Number(x) || 8));
      const safeTop = Math.min(maxTop, Math.max(8, Number(y) || 8));
      elements.contextMenu.style.left = `${safeLeft}px`;
      elements.contextMenu.style.top = `${safeTop}px`;
    }

    function hideContextMenu() {
      if (!elements.contextMenu) return;
      elements.contextMenu.classList.add('hidden');
      elements.contextMenu.setAttribute('aria-hidden', 'true');
      elements.contextMenu.style.left = '-9999px';
      elements.contextMenu.style.top = '-9999px';
      contextProjectId = null;
    }

    function isContextMenuOpen() {
      return Boolean(elements.contextMenu && !elements.contextMenu.classList.contains('hidden'));
    }

    function hasExpandedProject() {
      return Object.values(getExpandedProjects() || {}).some(Boolean);
    }

    function collapseExpandedProjects() {
      if (!hasExpandedProject()) return false;
      Object.keys(getExpandedProjects() || {}).forEach((projectId) => {
        setExpanded(projectId, false);
      });
      render();
      return true;
    }

    function handleOutsidePointerDown(event) {
      if (!hasExpandedProject()) return;
      const target = event && event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.project-item')) return;
      if (elements.contextMenu && elements.contextMenu.contains(target)) return;
      if (elements.list && !elements.list.contains(target)) return;
      collapseExpandedProjects();
    }

    function renderEmpty(sourceLength) {
      if (!elements.list) return;
      const empty = document.createElement('p');
      empty.className = 'subtext';
      empty.textContent = sourceLength
        ? 'Nenhum projeto encontrado para essa pesquisa.'
        : 'Nenhum projeto ainda.';
      elements.list.appendChild(empty);
    }

    function createProjectIcon(isExpanded) {
      const folder = document.createElement('span');
      folder.className = 'folder-icon';
      folder.setAttribute('aria-hidden', 'true');
      folder.innerHTML = isExpanded
        ? '<svg viewBox="0 0 24 24" class="folder-icon-svg folder-open" focusable="false" aria-hidden="true"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h3.2c.5 0 1 .2 1.4.5l1 1c.4.3.8.5 1.3.5H20a1.8 1.8 0 0 1 1.7 2.4l-1.8 5.7A2.5 2.5 0 0 1 17.5 18h-12A2.5 2.5 0 0 1 3 15.5v-7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 24 24" class="folder-icon-svg folder-closed" focusable="false" aria-hidden="true"><path d="M3.75 7.5a2.25 2.25 0 0 1 2.25-2.25h3.2c.42 0 .82.17 1.12.47l1.14 1.14c.3.3.7.47 1.12.47H18a2.25 2.25 0 0 1 2.25 2.25v7.17A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      return folder;
    }

    function renderConversationList(projectId) {
      ensureConversationState(projectId);
      const convList = document.createElement('div');
      convList.className = 'conversation-tree';

      const conversations = Array.isArray(getConversations(projectId)) ? getConversations(projectId) : [];
      if (!conversations.length) {
        const emptyConv = document.createElement('div');
        emptyConv.className = 'conversation-item conversation-empty';
        emptyConv.textContent = 'Sem conversas ainda';
        convList.appendChild(emptyConv);
        return convList;
      }

      conversations.slice(0, 12).forEach((conv) => {
        const convRow = document.createElement('div');
        convRow.className = 'conversation-row';

        const convItem = document.createElement('button');
        convItem.type = 'button';
        const isActiveConversation = getActiveConversationId(projectId) === conv.id;
        convItem.className = 'conversation-item' + (isActiveConversation ? ' active' : '');
        convItem.textContent = conv.title || 'Conversa';

        convItem.addEventListener('dblclick', async (event) => {
          event.stopPropagation();
          await onRenameConversation(projectId, conv);
        });

        convItem.addEventListener('click', async (event) => {
          event.stopPropagation();
          await onSelectConversation(projectId, conv);
        });

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'conversation-rename-btn';
        renameBtn.title = 'Renomear conversa';
        renameBtn.setAttribute('aria-label', 'Renomear conversa');
        renameBtn.textContent = '✎';
        renameBtn.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await onRenameConversation(projectId, conv);
        });

        convRow.append(convItem, renameBtn);
        convList.appendChild(convRow);
      });

      return convList;
    }

    function renderProject(project, index) {
      const safe = project && typeof project === 'object' ? project : {};
      const id = safe.id || ('fallback-' + index);
      const name = (safe.name && String(safe.name).trim()) || 'Projeto';
      const expanded = isProjectExpanded(id);

      const wrapper = document.createElement('div');
      wrapper.className = 'project-item tree-item' + (getSelectedProjectId() === id ? ' active' : '');
      wrapper.dataset.projectId = id;

      wrapper.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        showContextMenu(id, event.clientX, event.clientY);
      });

      const headerBtn = document.createElement('button');
      headerBtn.className = 'project-tree-header';
      headerBtn.type = 'button';
      headerBtn.addEventListener('click', async () => {
        setExpanded(id, !isProjectExpanded(id));
        render();

        if (shouldResyncProject(id)) {
          await onSelectProject(id);
          return;
        }

        await onRefreshSelectedProjectFiles(id);
      });

      const nameEl = document.createElement('span');
      nameEl.className = 'project-name';
      nameEl.textContent = name;
      nameEl.addEventListener('dblclick', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await onRenameProject(id, name);
      });

      const actions = document.createElement('span');
      actions.className = 'project-tree-actions';

      const newConvBtn = document.createElement('button');
      newConvBtn.type = 'button';
      newConvBtn.className = 'project-mini-btn project-mini-btn-new-conv';
      newConvBtn.title = 'Nova conversa neste projeto';
      newConvBtn.setAttribute('aria-label', 'Nova conversa neste projeto');
      newConvBtn.textContent = '+';
      newConvBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await onPrepareNewConversation(id);
        render();
      });

      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'project-mini-btn project-mini-btn-menu';
      menuBtn.title = 'Opções do projeto';
      menuBtn.setAttribute('aria-label', 'Opções do projeto');
      menuBtn.textContent = '⋯';
      menuBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showContextMenu(id, event.clientX, event.clientY);
      });

      actions.append(newConvBtn, menuBtn);
      headerBtn.append(createProjectIcon(expanded), nameEl, actions);
      wrapper.appendChild(headerBtn);

      if (expanded) {
        wrapper.appendChild(renderConversationList(id));
      }

      return wrapper;
    }

    function render() {
      if (!elements.list) return;
      elements.list.innerHTML = '';

      const query = String(getSearchQuery() || '').trim().toLowerCase();
      const source = Array.isArray(getProjects()) ? getProjects() : [];
      const visibleProjects = query
        ? source.filter((project) => String((project && project.name) || '').toLowerCase().includes(query))
        : source;

      if (!visibleProjects.length) {
        renderEmpty(source.length);
        return;
      }

      visibleProjects.forEach((project, index) => {
        elements.list.appendChild(renderProject(project, index));
      });
    }

    function bindEvents() {
      if (elements.search) {
        elements.search.addEventListener('input', () => {
          setSearchQuery(elements.search.value || '');
          render();
        });
      }

      if (elements.contextMenu) {
        elements.contextMenu.addEventListener('click', async (event) => {
          const btn = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
          if (!btn || !contextProjectId) return;
          const action = btn.dataset.action;
          const targetProjectId = contextProjectId;
          hideContextMenu();
          await onContextAction(action, targetProjectId);
        });
      }

      document.addEventListener('pointerdown', handleOutsidePointerDown);
      document.addEventListener('click', (event) => {
        if (!isContextMenuOpen()) return;
        const insideProject = event.target && event.target.closest && event.target.closest('#project-context-menu');
        if (!insideProject) hideContextMenu();
      });
    }

    return {
      bindEvents,
      collapseExpandedProjects,
      handleOutsidePointerDown,
      hideContextMenu,
      isContextMenuOpen,
      render,
      showContextMenu,
    };
  }

  window.FaberProjectSidebar = {
    createProjectSidebarController,
    normalizeProjectItems,
  };
})();
