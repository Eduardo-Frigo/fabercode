(function () {
  function createProjectStateModalController(options = {}) {
    const api = options.api || {};
    const notify = typeof options.notify === 'function' ? options.notify : () => {};
    const refreshProjects = typeof options.refreshProjects === 'function' ? options.refreshProjects : async () => {};

    const elements = {
      archivedButton: document.getElementById('btn-archived-projects'),
      trashButton: document.getElementById('btn-trash-projects'),
      modal: document.getElementById('project-state-modal'),
      close: document.getElementById('project-state-modal-close'),
      title: document.getElementById('project-state-modal-title'),
      list: document.getElementById('project-state-modal-list'),
      footer: document.getElementById('project-state-modal-footer'),
    };

    let currentMode = null;

    function formatDate(project) {
      const raw = project && (project.archivedAt || project.deletedAt || project.createdAt);
      if (!raw) return 'sem data';
      const dt = new Date(raw);
      if (Number.isNaN(dt.getTime())) return 'sem data';
      return dt.toLocaleString('pt-BR');
    }

    function setTitle(mode) {
      if (!elements.title) return;
      elements.title.textContent = mode === 'archived' ? 'Projetos arquivados' : 'Lixeira de projetos';
    }

    function showEmpty(mode) {
      if (!elements.list) return;
      const empty = document.createElement('div');
      empty.className = 'project-state-empty';
      empty.textContent = mode === 'archived'
        ? 'Nenhum projeto arquivado.'
        : 'A lixeira está vazia.';
      elements.list.appendChild(empty);
    }

    async function refreshRows(mode) {
      if (!api.listProjectsByState) return [];
      const refreshed = await api.listProjectsByState(mode);
      return refreshed && refreshed.ok && Array.isArray(refreshed.projects) ? refreshed.projects : [];
    }

    async function refreshAfterMutation(mode) {
      await refreshProjects();
      await render(mode, await refreshRows(mode));
    }

    function createRestoreButton(mode, project) {
      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'project-state-restore';
      restoreBtn.textContent = 'Restaurar';
      restoreBtn.addEventListener('click', async () => {
        const result = await api.restoreProject({ id: project.id });
        if (!result || !result.ok) {
          notify((result && result.message) || 'Falha ao restaurar projeto.');
          return;
        }
        await refreshAfterMutation(mode);
      });
      return restoreBtn;
    }

    function createTrashButton(mode, project) {
      const trashBtn = document.createElement('button');
      trashBtn.type = 'button';
      trashBtn.className = 'project-state-clear';
      trashBtn.textContent = 'Mover para lixeira';
      trashBtn.addEventListener('click', async () => {
        const result = await api.trashProject({ id: project.id });
        if (!result || !result.ok) {
          notify((result && result.message) || 'Falha ao mover projeto para a lixeira.');
          return;
        }
        await refreshAfterMutation(mode);
      });
      return trashBtn;
    }

    function createDeleteButton(mode, project) {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'project-state-clear';
      deleteBtn.textContent = 'Excluir definitivo';
      deleteBtn.addEventListener('click', async () => {
        if (!await window.faberConfirm('Excluir definitivamente este projeto da lista?')) return;
        const result = await api.removeProject(project.id);
        if (!result || !result.ok) {
          notify((result && result.message) || 'Falha ao excluir projeto.');
          return;
        }
        await refreshAfterMutation(mode);
      });
      return deleteBtn;
    }

    function renderRow(mode, project) {
      const row = document.createElement('div');
      row.className = 'project-state-row';

      const info = document.createElement('div');
      info.className = 'project-state-info';
      const title = document.createElement('strong');
      title.textContent = String(project.name || 'Projeto');
      const meta = document.createElement('span');
      const stateLabel = mode === 'archived' ? 'Arquivado em' : 'Excluído em';
      meta.textContent = `${stateLabel}: ${formatDate(project)} • ${String(project.rootPath || '')}`;
      info.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'project-state-actions';
      actions.appendChild(createRestoreButton(mode, project));

      if (mode === 'archived') {
        actions.appendChild(createTrashButton(mode, project));
      }
      if (mode === 'deleted') {
        actions.appendChild(createDeleteButton(mode, project));
      }

      row.append(info, actions);
      return row;
    }

    function renderClearTrash(mode, rows) {
      if (!elements.footer || mode !== 'deleted') return;
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'project-state-clear';
      clearBtn.textContent = 'Esvaziar lixeira';
      clearBtn.disabled = rows.length === 0;
      clearBtn.addEventListener('click', async () => {
        if (!rows.length) return;
        if (!await window.faberConfirm('Esvaziar toda a lixeira? Essa ação não pode ser desfeita.')) return;
        const result = await api.clearTrashProjects();
        if (!result || !result.ok) {
          notify((result && result.message) || 'Falha ao esvaziar lixeira.');
          return;
        }
        await refreshProjects();
        await render(mode, []);
      });
      elements.footer.appendChild(clearBtn);
    }

    async function render(mode, items) {
      if (!elements.list || !elements.footer) return;
      const rows = Array.isArray(items) ? items : [];
      elements.list.innerHTML = '';
      elements.footer.innerHTML = '';

      if (!rows.length) {
        showEmpty(mode);
      } else {
        rows.forEach((project) => {
          elements.list.appendChild(renderRow(mode, project));
        });
      }

      renderClearTrash(mode, rows);
    }

    async function open(mode) {
      if (!elements.modal) return;
      const normalizedMode = mode === 'deleted' ? 'deleted' : 'archived';
      currentMode = normalizedMode;
      setTitle(normalizedMode);
      await render(normalizedMode, await refreshRows(normalizedMode));
      elements.modal.classList.remove('hidden');
      elements.modal.setAttribute('aria-hidden', 'false');
    }

    function close() {
      if (!elements.modal) return;
      elements.modal.classList.add('hidden');
      elements.modal.setAttribute('aria-hidden', 'true');
      currentMode = null;
      if (elements.list) elements.list.innerHTML = '';
      if (elements.footer) elements.footer.innerHTML = '';
    }

    function isOpen() {
      return Boolean(elements.modal && !elements.modal.classList.contains('hidden'));
    }

    function bindEvents() {
      if (elements.archivedButton) {
        elements.archivedButton.addEventListener('click', async () => {
          await open('archived');
        });
      }
      if (elements.trashButton) {
        elements.trashButton.addEventListener('click', async () => {
          await open('deleted');
        });
      }
      if (elements.close) {
        elements.close.addEventListener('click', close);
      }
      if (elements.modal) {
        elements.modal.addEventListener('click', (event) => {
          const shouldClose = event.target && event.target.dataset && event.target.dataset.close === '1';
          if (shouldClose) close();
        });
      }
    }

    return {
      bindEvents,
      close,
      getMode: () => currentMode,
      isOpen,
      open,
      render,
    };
  }

  window.FaberProjectStateModal = {
    createProjectStateModalController,
  };
})();
