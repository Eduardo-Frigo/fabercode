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
      railMenuToggle: options.railMenuToggleEl || document.getElementById('project-rail-menu-toggle'),
      railLightbox: options.railLightboxEl || document.getElementById('project-rail-lightbox'),
      railMenuList: options.railMenuListEl || document.getElementById('project-rail-lightbox-list'),
      railMenuClose: options.railMenuCloseEl || document.getElementById('project-rail-lightbox-close'),
      railMenuBackdrop: options.railMenuBackdropEl || document.getElementById('project-rail-lightbox-backdrop'),
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

    function isLeftRailCollapsed() {
      return Boolean(
        document.body &&
          document.body.classList &&
          document.body.classList.contains('workspace-left-collapsed')
      );
    }

    function isRailMenuOpen() {
      return Boolean(
        document.body &&
          document.body.classList &&
          document.body.classList.contains('project-rail-menu-open')
      );
    }

    function isInsideRailMenu(element) {
      return Boolean(element && elements.railMenuList && elements.railMenuList.contains(element));
    }

    function setRailMenuOpen(open) {
      if (!document.body || !document.body.classList) return;
      const nextOpen = Boolean(open) && isLeftRailCollapsed();
      document.body.classList.toggle('project-rail-menu-open', nextOpen);
      if (elements.railMenuToggle) {
        elements.railMenuToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      }
      if (elements.railLightbox) {
        elements.railLightbox.classList.toggle('hidden', !nextOpen);
        elements.railLightbox.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
      }
      if (nextOpen) renderRailMenu();
    }

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
      if (isRailMenuOpen()) {
        const target = event && event.target;
        const insideList = Boolean(elements.list && elements.list.contains(target));
        const insideRailLightbox = Boolean(elements.railLightbox && elements.railLightbox.contains(target));
        const insideToggle = Boolean(elements.railMenuToggle && elements.railMenuToggle.contains(target));
        if (!insideList && !insideRailLightbox && !insideToggle) setRailMenuOpen(false);
      }
      if (!hasExpandedProject()) return;
      const target = event && event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.project-item')) return;
      if (elements.contextMenu && elements.contextMenu.contains(target)) return;
      // We do not collapse expanded project items on clicking empty sidebar space
      // if (elements.list && !elements.list.contains(target)) return;
      // collapseExpandedProjects();
    }

    function renderEmpty(sourceLength) {
      renderEmptyInto(elements.list, sourceLength);
    }

    function renderEmptyInto(target, sourceLength) {
      if (!target) return;
      const empty = document.createElement('p');
      empty.className = 'subtext';
      empty.textContent = sourceLength
        ? 'Nenhum projeto encontrado para essa pesquisa.'
        : 'Nenhum projeto ainda.';
      target.appendChild(empty);
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

    function createProjectRailIcon() {
      const box = document.createElement('span');
      box.className = 'project-rail-icon';
      box.setAttribute('aria-hidden', 'true');
      box.innerHTML = '<svg viewBox="0 0 24 24" class="project-rail-icon-svg" focusable="false" aria-hidden="true"><path d="M5 8.4 12 5l7 3.4-7 3.4-7-3.4Z" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 8.5v6.9l7 3.6 7-3.6V8.5" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 11.8V19" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      return box;
    }

    function renderConversationList(projectId) {
      ensureConversationState(projectId);
      const convList = document.createElement('div');
      convList.className = 'conversation-tree';

      const conversations = (Array.isArray(getConversations(projectId)) ? getConversations(projectId) : [])
        .filter((c) => c && c.source !== 'map_chat' && c.source !== 'map_render');
      if (!conversations.length) {
        const emptyConv = document.createElement('div');
        emptyConv.className = 'conversation-item conversation-empty';
        emptyConv.textContent = window.t ? window.t('noConversationsYet', 'Sem conversas ainda') : 'Sem conversas ainda';
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
          const railMenuMode = isRailMenuOpen() || isInsideRailMenu(convItem);
          await onSelectConversation(projectId, conv);
          if (railMenuMode) setRailMenuOpen(false);
        });

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'conversation-rename-btn';
        renameBtn.title = 'Renomear conversa';
        renameBtn.setAttribute('aria-label', 'Renomear conversa');
        renameBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
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
      headerBtn.title = name;
      headerBtn.setAttribute('aria-label', `Abrir projeto ${name}`);
      headerBtn.addEventListener('click', async () => {
        const railMenuMode = isRailMenuOpen() || isInsideRailMenu(headerBtn);
        setExpanded(id, !isProjectExpanded(id));
        render();

        if (railMenuMode) {
          return;
        }

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
      menuBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px;"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>`;
      menuBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showContextMenu(id, event.clientX, event.clientY);
      });

      const mapBtn = document.createElement('button');
      mapBtn.type = 'button';
      const isMapActive = getSelectedProjectId() === id && document.getElementById('btn-tab-map')?.classList.contains('active');
      mapBtn.className = 'project-mini-btn project-mini-btn-map' + (isMapActive ? ' active' : '');
      mapBtn.title = 'Mapa da Aplicação';
      mapBtn.setAttribute('aria-label', 'Mapa da Aplicação');
      mapBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px;"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`;
      
      mapBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const railMenuMode = isRailMenuOpen() || isInsideRailMenu(mapBtn);
        if (getSelectedProjectId() !== id) {
          await onSelectProject(id, { initialTab: 'map' });
        } else {
          const tabMap = document.getElementById('btn-tab-map');
          if (tabMap) tabMap.click();
        }
        if (railMenuMode) setRailMenuOpen(false);
        render();
      });

      actions.append(mapBtn, newConvBtn, menuBtn);
      headerBtn.append(createProjectIcon(expanded), createProjectRailIcon(), nameEl, actions);
      wrapper.appendChild(headerBtn);

      if (expanded) {
        const subItemsContainer = document.createElement('div');
        subItemsContainer.className = 'project-sub-items';
        subItemsContainer.style.paddingLeft = '24px';
        subItemsContainer.style.display = 'flex';
        subItemsContainer.style.flexDirection = 'column';
        subItemsContainer.style.gap = '2px';
        subItemsContainer.style.marginTop = '4px';

        // 2. Chat / Conversas subheader
        const chatHeader = document.createElement('div');
        chatHeader.className = 'project-sub-header';
        chatHeader.style.fontSize = '0.7rem';
        chatHeader.style.color = 'rgba(255,255,255,0.3)';
        chatHeader.style.marginTop = '6px';
        chatHeader.style.marginBottom = '2px';
        chatHeader.style.fontWeight = '600';
        chatHeader.style.letterSpacing = '0.5px';
        chatHeader.style.paddingLeft = '8px';
        chatHeader.textContent = window.t ? window.t('conversationsTitle', 'CONVERSAS') : 'CONVERSAS';

        subItemsContainer.appendChild(chatHeader);
        subItemsContainer.appendChild(renderConversationList(id));
        wrapper.appendChild(subItemsContainer);
      }

      return wrapper;
    }

    function render() {
      renderProjectListInto(elements.list);
      if (isRailMenuOpen()) renderRailMenu();
    }

    function renderRailMenu() {
      renderProjectListInto(elements.railMenuList);
    }

    function renderProjectListInto(target) {
      if (!target) return;
      target.innerHTML = '';

      const query = String(getSearchQuery() || '').trim().toLowerCase();
      const source = Array.isArray(getProjects()) ? getProjects() : [];
      const visibleProjects = query
        ? source.filter((project) => String((project && project.name) || '').toLowerCase().includes(query))
        : source;

      if (!visibleProjects.length) {
        renderEmptyInto(target, source.length);
        return;
      }

      visibleProjects.forEach((project, index) => {
        target.appendChild(renderProject(project, index));
      });
    }

    function bindEvents() {
      if (elements.search) {
        elements.search.addEventListener('input', () => {
          setSearchQuery(elements.search.value || '');
          render();
        });
      }

      if (elements.railMenuToggle) {
        elements.railMenuToggle.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          setRailMenuOpen(!isRailMenuOpen());
        });
      }
      [elements.railMenuClose, elements.railMenuBackdrop].forEach((element) => {
        if (!element) return;
        element.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          setRailMenuOpen(false);
        });
      });

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
      document.addEventListener('keydown', (event) => {
        if (event && event.key === 'Escape') setRailMenuOpen(false);
      });
    }

    return {
      bindEvents,
      collapseExpandedProjects,
      handleOutsidePointerDown,
      hideContextMenu,
      isContextMenuOpen,
      isRailMenuOpen,
      render,
      renderRailMenu,
      setRailMenuOpen,
      showContextMenu,
    };
  }

  window.FaberProjectSidebar = {
    createProjectSidebarController,
    normalizeProjectItems,
  };
})();
