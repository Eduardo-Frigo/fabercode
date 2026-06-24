(function () {
  function createMilestonesPanelController(options = {}) {
    const api = options.api || {};
    const getSelectedProjectId = typeof options.getSelectedProjectId === 'function' ? options.getSelectedProjectId : () => '';
    const getSelectedProjectInfo = typeof options.getSelectedProjectInfo === 'function' ? options.getSelectedProjectInfo : () => null;
    const updateStatus = typeof options.updateStatus === 'function' ? options.updateStatus : () => {};
    const getTerminalController = typeof options.getTerminalController === 'function' ? options.getTerminalController : () => null;

    const container = document.getElementById('workspace-milestones-panel');
    const timelineContent = document.getElementById('milestones-timeline-content');
    const btnProjectMilestones = document.getElementById('btn-project-milestones');
    const badgeProjectMilestones = document.getElementById('project-milestones-count');

    let milestones = [];
    let selectedMilestoneId = null;

    function init() {
      if (btnProjectMilestones) {
        btnProjectMilestones.addEventListener('click', () => {
          togglePanel();
        });
      }

      window.addEventListener('faber:milestones-updated', async () => {
        const projectInfo = getSelectedProjectInfo();
        if (!projectInfo || !projectInfo.rootPath) return;
        if (document.body.classList.contains('mode-milestones')) {
          await refresh();
        }
      });
    }

    function togglePanel() {
      const active = document.body.classList.toggle('mode-milestones');
      if (btnProjectMilestones) {
        btnProjectMilestones.classList.toggle('active', active);
      }

      if (active) {
        document.body.classList.remove('mode-cortex');
        document.body.classList.remove('mode-map-chat');
        document.body.classList.remove('mode-map-render');
        document.body.classList.remove('mode-git');
        document.body.classList.remove('mode-terminal');

        const cortexBtn = document.getElementById('btn-cortex-mode');
        if (cortexBtn) cortexBtn.classList.remove('active');
        const mapAiBtn = document.getElementById('btn-map-ai');
        if (mapAiBtn) mapAiBtn.classList.remove('active');
        const gitBtn = document.getElementById('btn-project-git');
        if (gitBtn) gitBtn.classList.remove('active');
        const terminalBtn = document.getElementById('btn-project-terminal');
        if (terminalBtn) terminalBtn.classList.remove('active');

        const term = getTerminalController();
        if (term) {
          term.closePanel();
        }

        if (document.body.classList.contains('workspace-right-collapsed')) {
          const rightToggle = document.getElementById('workspace-collapse-right');
          if (rightToggle) rightToggle.click();
        }

        const rightPanelTitle = document.getElementById('right-panel-title');
        if (rightPanelTitle) rightPanelTitle.textContent = 'Milestones';

        refresh();
      } else {
        const rightPanelTitle = document.getElementById('right-panel-title');
        if (rightPanelTitle) rightPanelTitle.textContent = 'Arquivos';
      }

      const filesBtn = document.getElementById('btn-project-files');
      if (filesBtn) {
        filesBtn.classList.toggle('active', !active);
      }
    }

    async function refresh() {
      const projectId = getSelectedProjectId();
      const info = getSelectedProjectInfo();
      if (!projectId || !info || !info.rootPath) {
        resetForNoProject();
        return;
      }

      const result = await api.listMilestones({ rootPath: info.rootPath });
      if (result && result.ok && Array.isArray(result.milestones)) {
        milestones = result.milestones;
        render();
        updateBadge();
      }
    }

    function updateBadge() {
      if (!badgeProjectMilestones) return;
      badgeProjectMilestones.textContent = '';
      badgeProjectMilestones.classList.add('hidden');
    }

    function render() {
      if (!timelineContent) return;
      timelineContent.innerHTML = '';

      if (!milestones.length) {
        const empty = document.createElement('div');
        empty.className = 'milestone-empty-state';
        empty.setAttribute('aria-live', 'polite');

        const eyebrow = document.createElement('span');
        eyebrow.className = 'milestone-empty-eyebrow';
        eyebrow.textContent = 'Aguardando renderização';

        const title = document.createElement('strong');
        title.textContent = 'Nenhuma milestone gerada ainda';

        const copy = document.createElement('p');
        copy.textContent = 'Execute a renderização do mapa para gerar o passo a passo de desenvolvimento e preencher esta área com etapas reais.';

        empty.appendChild(eyebrow);
        empty.appendChild(title);
        empty.appendChild(copy);
        timelineContent.appendChild(empty);
        return;
      }

      milestones.forEach((milestone) => {
        const isExpanded = milestone.id === selectedMilestoneId;

        const item = document.createElement('div');
        item.className = `milestone-item status-${milestone.status || 'planned'}`;
        if (isExpanded) item.classList.add('selected');

        const marker = document.createElement('div');
        marker.className = 'milestone-marker';
        marker.textContent = String(milestone.number);

        const card = document.createElement('div');
        card.className = 'milestone-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-expanded', String(isExpanded));

        const header = document.createElement('div');
        header.className = 'milestone-card-header';

        const title = document.createElement('span');
        title.className = 'milestone-card-title';
        title.textContent = milestone.title || `Milestone ${milestone.number}`;
        header.appendChild(title);

        const toggle = document.createElement('span');
        toggle.className = 'milestone-card-toggle';
        toggle.innerHTML = isExpanded
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        header.appendChild(toggle);

        card.appendChild(header);

        if (isExpanded && milestone.summary) {
          const summary = document.createElement('div');
          summary.className = 'milestone-summary';
          summary.textContent = milestone.summary;
          card.appendChild(summary);
        }

        if (isExpanded && Array.isArray(milestone.tasks) && milestone.tasks.length) {
          const tasksContainer = document.createElement('div');
          tasksContainer.className = 'milestone-tasks';

          milestone.tasks.forEach((task) => {
            const taskItem = document.createElement('label');
            taskItem.className = 'milestone-task-item';
            if (task.status === 'done') {
              taskItem.classList.add('task-done');
            }
            taskItem.addEventListener('click', (event) => {
              event.stopPropagation();
            });

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = task.status === 'done';
            checkbox.addEventListener('change', async (event) => {
              event.stopPropagation();
              const info = getSelectedProjectInfo();
              if (!info || !info.rootPath) return;

              const newStatus = checkbox.checked ? 'done' : 'pending';
              const updateRes = await api.updateMilestoneTask({
                rootPath: info.rootPath,
                milestoneId: milestone.id,
                taskId: task.id,
                task: { status: newStatus },
              });

              if (updateRes && updateRes.ok) {
                task.status = newStatus;
                taskItem.classList.toggle('task-done', newStatus === 'done');
                updateBadge();
              } else {
                checkbox.checked = !checkbox.checked;
                alert('Erro ao atualizar tarefa: ' + ((updateRes && updateRes.message) || 'Erro desconhecido.'));
              }
            });

            const label = document.createElement('span');
            label.textContent = task.title || 'Tarefa sem título';

            taskItem.appendChild(checkbox);
            taskItem.appendChild(label);
            tasksContainer.appendChild(taskItem);
          });

          card.appendChild(tasksContainer);
        }

        if (isExpanded && Array.isArray(milestone.references) && milestone.references.length) {
          const referencesContainer = document.createElement('div');
          referencesContainer.className = 'milestone-references';

          const referencesTitle = document.createElement('span');
          referencesTitle.textContent = 'Markdowns de referência';

          const referencesList = document.createElement('ul');
          milestone.references.forEach((reference) => {
            const referenceItem = document.createElement('li');
            referenceItem.textContent = reference && reference.path ? reference.path : String(reference || '');
            referencesList.appendChild(referenceItem);
          });

          referencesContainer.appendChild(referencesTitle);
          referencesContainer.appendChild(referencesList);
          card.appendChild(referencesContainer);
        }

        const toggleSelection = () => {
          selectedMilestoneId = isExpanded ? null : milestone.id;
          render();
        };

        card.addEventListener('click', (event) => {
          if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON' || event.target.closest('.milestone-task-item')) {
            return;
          }
          toggleSelection();
        });

        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleSelection();
          }
        });

        item.appendChild(marker);
        item.appendChild(card);
        timelineContent.appendChild(item);
      });
    }

    function resetForNoProject() {
      milestones = [];
      selectedMilestoneId = null;
      if (timelineContent) timelineContent.innerHTML = '';
      if (badgeProjectMilestones) badgeProjectMilestones.classList.add('hidden');
    }

    return {
      init,
      refresh,
      resetForNoProject,
    };
  }

  window.FaberMilestonesPanel = {
    createMilestonesPanelController,
  };
})();
