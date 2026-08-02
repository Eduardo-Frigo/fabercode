(function () {
  function uiText(key, fallback) {
    return window.t ? window.t(key, fallback) : fallback;
  }

  function currentLocale() {
    const lang = String(document.documentElement.lang || 'pt-BR').toLowerCase();
    if (lang.startsWith('en')) return 'en-US';
    if (lang.startsWith('es')) return 'es-ES';
    return 'pt-BR';
  }

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

    function getTutorialRuntime() {
      return window.FaberTutorialRuntime || null;
    }

    function formatDate(project) {
      const raw = project && (project.archivedAt || project.deletedAt || project.createdAt);
      if (!raw) return uiText('noDate', 'sem data');
      const dt = new Date(raw);
      if (Number.isNaN(dt.getTime())) return uiText('noDate', 'sem data');
      return dt.toLocaleString(currentLocale());
    }

    function setTitle(mode) {
      if (!elements.title) return;
      elements.title.textContent = mode === 'archived'
        ? uiText('archivedProjects', 'Projetos arquivados')
        : uiText('trashModalTitle', 'Lixeira de projetos');
    }

    function showEmpty(mode) {
      if (!elements.list) return;
      const empty = document.createElement('div');
      empty.className = 'project-state-empty';
      empty.textContent = mode === 'archived'
        ? uiText('noArchivedProjects', 'Nenhum projeto arquivado.')
        : uiText('trashEmpty', 'A lixeira está vazia.');
      elements.list.appendChild(empty);
    }

    async function refreshRows(mode) {
      if (!api.listProjectsByState) return [];
      const refreshed = await api.listProjectsByState(mode);
      return refreshed && refreshed.ok && Array.isArray(refreshed.projects) ? refreshed.projects : [];
    }

    async function getRowsForMode(mode) {
      const tutorialRuntime = getTutorialRuntime();
      if (tutorialRuntime && typeof tutorialRuntime.getProjectStateRows === 'function') {
        const tutorialRows = tutorialRuntime.getProjectStateRows(mode);
        if (tutorialRows !== null) return Array.isArray(tutorialRows) ? tutorialRows : [];
      }
      return refreshRows(mode);
    }

    async function refreshAfterMutation(mode) {
      await refreshProjects();
      await render(mode, await getRowsForMode(mode));
    }

    async function runTutorialAction(payload) {
      const tutorialRuntime = getTutorialRuntime();
      if (!tutorialRuntime || typeof tutorialRuntime.handleProjectStateAction !== 'function') return null;
      return tutorialRuntime.handleProjectStateAction(payload);
    }

    function createRestoreButton(mode, project) {
      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'project-state-restore';
      restoreBtn.textContent = uiText('restoreBtn', 'Restaurar');
      restoreBtn.addEventListener('click', async () => {
        if (project && project.__tutorialPlaceholder) {
          const outcome = await runTutorialAction({ action: 'restore', mode, projectId: project.id });
          if (outcome && outcome.handled) {
            if (outcome.closeModal) {
              close();
              return;
            }
            await render(mode, await getRowsForMode(mode));
            return;
          }
        }
        const result = await api.restoreProject({ id: project.id });
        if (!result || !result.ok) {
          notify((result && result.message) || uiText('restoreProjectFailed', 'Falha ao restaurar projeto.'));
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
      trashBtn.textContent = uiText('moveToTrash', 'Mover para lixeira');
      trashBtn.addEventListener('click', async () => {
        const result = await api.trashProject({ id: project.id });
        if (!result || !result.ok) {
          notify((result && result.message) || uiText('trashProjectFailed', 'Falha ao mover projeto para a lixeira.'));
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
      deleteBtn.textContent = uiText('deleteDefinitiveBtn', 'Excluir definitivo');
      deleteBtn.addEventListener('click', async () => {
        if (project && project.__tutorialPlaceholder) {
          const outcome = await runTutorialAction({ action: 'delete', mode, projectId: project.id });
          if (outcome && outcome.handled) {
            await render(mode, await getRowsForMode(mode));
            return;
          }
        }
        if (!await window.faberConfirm(uiText('permanentDeleteConfirm', 'Excluir definitivamente este projeto da lista?'))) return;
        const result = await api.removeProject(project.id);
        if (!result || !result.ok) {
          notify((result && result.message) || uiText('deleteProjectFailed', 'Falha ao excluir projeto.'));
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
      title.textContent = String(project.name || uiText('defaultProjectName', 'Projeto'));
      const meta = document.createElement('span');
      const stateLabel = mode === 'archived'
        ? uiText('archivedAt', 'Arquivado em')
        : uiText('deletedAt', 'Excluído em');
      meta.textContent = `${stateLabel}: ${formatDate(project)} • ${String(project.rootPath || '')}`;
      info.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'project-state-actions';
      actions.appendChild(createRestoreButton(mode, project));
      if (mode === 'archived') actions.appendChild(createTrashButton(mode, project));
      if (mode === 'deleted') actions.appendChild(createDeleteButton(mode, project));

      row.append(info, actions);
      return row;
    }

    function renderClearTrash(mode, rows) {
      if (!elements.footer || mode !== 'deleted') return;
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'project-state-clear';
      clearBtn.textContent = uiText('emptyTrashBtn', 'Esvaziar lixeira');
      clearBtn.disabled = rows.length === 0;
      clearBtn.addEventListener('click', async () => {
        if (!rows.length) return;
        if (!await window.faberConfirm(uiText('emptyTrashConfirm', 'Esvaziar toda a lixeira? Essa ação não pode ser desfeita.'))) return;
        const result = await api.clearTrashProjects();
        if (!result || !result.ok) {
          notify((result && result.message) || uiText('emptyTrashFailed', 'Falha ao esvaziar lixeira.'));
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

      if (!rows.length) showEmpty(mode);
      else rows.forEach((project) => {
        elements.list.appendChild(renderRow(mode, project));
      });

      renderClearTrash(mode, rows);
    }

    async function open(mode) {
      if (!elements.modal) return;
      const normalizedMode = mode === 'deleted' ? 'deleted' : 'archived';
      currentMode = normalizedMode;
      setTitle(normalizedMode);
      await render(normalizedMode, await getRowsForMode(normalizedMode));
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
      if (elements.close) elements.close.addEventListener('click', close);
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
