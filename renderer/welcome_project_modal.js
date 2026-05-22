(function () {
  function createWelcomeProjectModalController(options = {}) {
    const t = typeof options.t === 'function' ? options.t : (key, fallback = '') => fallback || key;
    const getProjects = typeof options.getProjects === 'function' ? options.getProjects : () => [];
    const getSelectedProjectId = typeof options.getSelectedProjectId === 'function' ? options.getSelectedProjectId : () => null;
    const onStartProject = typeof options.onStartProject === 'function' ? options.onStartProject : async () => {};
    const onCreateProject = typeof options.onCreateProject === 'function' ? options.onCreateProject : async () => {};
    const onClose = typeof options.onClose === 'function' ? options.onClose : () => {};

    const elements = {
      modal: document.getElementById('welcome-project-modal'),
      backdrop: document.getElementById('welcome-project-backdrop'),
      close: document.getElementById('welcome-project-close'),
      list: document.getElementById('welcome-project-list'),
      create: document.getElementById('welcome-project-create'),
      startConversation: document.getElementById('welcome-start-conversation'),
      newProject: document.getElementById('welcome-new-project'),
    };

    function getRows() {
      return (Array.isArray(getProjects()) ? getProjects() : [])
        .filter((project) => project && project.id && !project.deletedAt && !project.archivedAt);
    }

    function close() {
      if (!elements.modal) return;
      elements.modal.classList.add('hidden');
      elements.modal.setAttribute('aria-hidden', 'true');
      onClose();
    }

    function isOpen() {
      return Boolean(elements.modal && !elements.modal.classList.contains('hidden'));
    }

    function renderList() {
      if (!elements.list) return;
      const rows = getRows();
      elements.list.innerHTML = '';

      if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'welcome-project-empty';
        empty.textContent = t('noProjectsForWelcome');
        elements.list.appendChild(empty);
        return;
      }

      rows.forEach((project) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'welcome-project-row';
        if (project.id === getSelectedProjectId()) item.classList.add('active');

        const info = document.createElement('span');
        info.className = 'welcome-project-row__info';
        const name = document.createElement('strong');
        name.textContent = String(project.name || 'Projeto');
        const path = document.createElement('small');
        path.textContent = String(project.rootPath || '');
        info.append(name, path);

        const action = document.createElement('span');
        action.className = 'welcome-project-row__action';
        action.textContent = t('startInProject');

        item.append(info, action);
        item.addEventListener('click', async () => {
          close();
          await onStartProject(project.id);
        });
        elements.list.appendChild(item);
      });
    }

    function open() {
      if (!elements.modal) return;
      renderList();
      elements.modal.classList.remove('hidden');
      elements.modal.setAttribute('aria-hidden', 'false');
    }

    async function createProject() {
      close();
      await onCreateProject();
    }

    function bindEvents() {
      if (elements.startConversation) {
        elements.startConversation.addEventListener('click', open);
      }
      if (elements.newProject) {
        elements.newProject.addEventListener('click', createProject);
      }
      if (elements.create) {
        elements.create.addEventListener('click', createProject);
      }
      if (elements.close) {
        elements.close.addEventListener('click', close);
      }
      if (elements.backdrop) {
        elements.backdrop.addEventListener('click', close);
      }
    }

    return {
      bindEvents,
      close,
      isOpen,
      open,
      renderList,
    };
  }

  window.FaberWelcomeProjectModal = {
    createWelcomeProjectModalController,
  };
})();
