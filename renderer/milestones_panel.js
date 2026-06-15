(function () {
  function createMilestonesPanelController(options = {}) {
    const api = options.api || {};
    const getSelectedProjectId = typeof options.getSelectedProjectId === 'function' ? options.getSelectedProjectId : () => '';
    const getSelectedProjectInfo = typeof options.getSelectedProjectInfo === 'function' ? options.getSelectedProjectInfo : () => null;
    const appendMessage = typeof options.appendMessage === 'function' ? options.appendMessage : () => {};
    const updateStatus = typeof options.updateStatus === 'function' ? options.updateStatus : () => {};
    const getTerminalController = typeof options.getTerminalController === 'function' ? options.getTerminalController : () => null;

    const container = document.getElementById('workspace-milestones-panel');
    const timelineContent = document.getElementById('milestones-timeline-content');
    const btnRender = document.getElementById('btn-milestones-render');
    const btnProjectMilestones = document.getElementById('btn-project-milestones');
    const badgeProjectMilestones = document.getElementById('project-milestones-count');

    let milestones = [];
    let selectedMilestoneId = null;
    let gitStatus = null;

    function init() {
      if (btnProjectMilestones) {
        btnProjectMilestones.addEventListener('click', () => {
          togglePanel();
        });
      }

      if (btnRender) {
        btnRender.addEventListener('click', async () => {
          const info = getSelectedProjectInfo();
          if (!info || !info.rootPath) return;

          btnRender.disabled = true;
          const result = await api.renderMilestones({ rootPath: info.rootPath });
          btnRender.disabled = false;

          if (result && result.ok) {
            appendMessage('assistant', `Documentação de Milestones renderizada em \`docs/milestones/\`.`, { persistToConversation: false });
          } else {
            alert('Falha ao renderizar milestones: ' + (result && result.message || 'Erro desconhecido.'));
          }
        });
      }
    }

    function togglePanel() {
      const active = document.body.classList.toggle('mode-milestones');
      if (btnProjectMilestones) {
        btnProjectMilestones.classList.toggle('active', active);
      }
      if (active) {
        // Hide cortex learning if open
        document.body.classList.remove('mode-cortex');
        const cortexBtn = document.getElementById('btn-cortex-mode');
        if (cortexBtn) cortexBtn.classList.remove('active');

        // Hide map chat if open
        document.body.classList.remove('mode-map-chat');
        const mapAiBtn = document.getElementById('btn-map-ai');
        if (mapAiBtn) mapAiBtn.classList.remove('active');

        refresh();
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
        
        // Find active milestone or default to first one if none selected
        const activeM = milestones.find(m => m.status === 'active');
        if (activeM) {
          if (!selectedMilestoneId) {
            selectedMilestoneId = activeM.id;
          }
        } else if (!selectedMilestoneId && milestones.length > 0) {
          selectedMilestoneId = milestones[0].id;
        }

        // Fetch git status for selected milestone
        if (selectedMilestoneId) {
          const gitRes = await api.getMilestoneGitStatus({ rootPath: info.rootPath, milestoneId: selectedMilestoneId });
          if (gitRes && gitRes.ok) {
            gitStatus = gitRes;
          } else {
            gitStatus = null;
          }
        } else {
          gitStatus = null;
        }

        render();
        updateBadge();
      }
    }

    function updateBadge() {
      if (!badgeProjectMilestones) return;
      // Count tasks remaining in active milestone
      const activeM = milestones.find(m => m.status === 'active');
      if (activeM && activeM.tasks) {
        const pendingCount = activeM.tasks.filter(t => t.status !== 'done').length;
        badgeProjectMilestones.textContent = String(pendingCount);
        badgeProjectMilestones.classList.toggle('hidden', pendingCount <= 0);
      } else {
        badgeProjectMilestones.classList.add('hidden');
      }
    }

    function render() {
      if (!timelineContent) return;
      timelineContent.innerHTML = '';

      milestones.forEach((m) => {
        const item = document.createElement('div');
        item.className = `milestone-item status-${m.status || 'planned'}`;
        if (m.id === selectedMilestoneId) {
          item.classList.add('selected');
        }

        const marker = document.createElement('div');
        marker.className = 'milestone-marker';
        marker.textContent = String(m.number);

        const card = document.createElement('div');
        card.className = 'milestone-card';

        const title = document.createElement('div');
        title.className = 'milestone-title';
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = m.title;
        title.appendChild(titleSpan);

        const badge = document.createElement('span');
        badge.className = `milestone-status-badge status-badge-${m.status || 'planned'}`;
        badge.textContent = getStatusLabel(m.status);
        title.appendChild(badge);

        const summary = document.createElement('div');
        summary.className = 'milestone-summary';
        summary.textContent = m.summary;

        card.appendChild(title);
        card.appendChild(summary);

        // Render tasks if expanded or active
        const isSelected = m.id === selectedMilestoneId;
        
        if (m.tasks && m.tasks.length > 0) {
          const tasksContainer = document.createElement('div');
          tasksContainer.className = 'milestone-tasks';

          m.tasks.forEach((t) => {
            const taskItem = document.createElement('label');
            taskItem.className = 'milestone-task-item';
            if (t.status === 'done') {
              taskItem.classList.add('task-done');
            }

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = t.status === 'done';
            checkbox.addEventListener('change', async (e) => {
              e.stopPropagation();
              const info = getSelectedProjectInfo();
              if (!info || !info.rootPath) return;

              const newStatus = checkbox.checked ? 'done' : 'pending';
              const updateRes = await api.updateMilestoneTask({
                rootPath: info.rootPath,
                milestoneId: m.id,
                taskId: t.id,
                task: { status: newStatus }
              });

              if (updateRes && updateRes.ok) {
                t.status = newStatus;
                if (newStatus === 'done') {
                  taskItem.classList.add('task-done');
                } else {
                  taskItem.classList.remove('task-done');
                }
                updateBadge();
              } else {
                checkbox.checked = !checkbox.checked; // revert
                alert('Erro ao atualizar tarefa: ' + (updateRes && updateRes.message || 'Erro desconhecido.'));
              }
            });

            const span = document.createElement('span');
            span.textContent = t.title;

            taskItem.appendChild(checkbox);
            taskItem.appendChild(span);
            tasksContainer.appendChild(taskItem);
          });
          card.appendChild(tasksContainer);
        }

        // Render details section if selected
        if (isSelected) {
          const details = document.createElement('div');
          details.className = 'milestone-details-section';

          if (m.acceptanceCriteria) {
            const block = document.createElement('div');
            block.className = 'milestone-detail-block';
            block.innerHTML = `<strong>Critérios de Aceite</strong><p>${m.acceptanceCriteria}</p>`;
            details.appendChild(block);
          }

          if (m.validationCommands) {
            const block = document.createElement('div');
            block.className = 'milestone-detail-block';
            block.innerHTML = `<strong>Validação</strong><p style="white-space: pre-wrap; font-family: monospace;">${m.validationCommands}</p>`;
            details.appendChild(block);
          }

          // Git Files Section
          if (gitStatus && (gitStatus.matchedModified.length > 0 || gitStatus.otherModified.length > 0)) {
            const gitBlock = document.createElement('div');
            gitBlock.className = 'milestone-detail-block';
            gitBlock.innerHTML = `<strong>Arquivos Modificados</strong>`;
            
            const gitFilesContainer = document.createElement('div');
            gitFilesContainer.className = 'milestone-git-files';

            gitStatus.matchedModified.forEach((file) => {
              const row = document.createElement('div');
              row.className = 'git-file-row matched';
              row.innerHTML = `<span>${file}</span><span>Modificado</span>`;
              gitFilesContainer.appendChild(row);
            });

            gitStatus.otherModified.forEach((file) => {
              const row = document.createElement('div');
              row.className = 'git-file-row other';
              row.innerHTML = `<span>${file}</span><span>Outro</span>`;
              gitFilesContainer.appendChild(row);
            });

            gitBlock.appendChild(gitFilesContainer);
            details.appendChild(gitBlock);

            // Commit section pre-filled form
            const commitBlock = document.createElement('div');
            commitBlock.className = 'milestone-detail-block';
            commitBlock.style.marginTop = '8px';

            const commitInput = document.createElement('input');
            commitInput.type = 'text';
            commitInput.className = 'milestone-commit-input';
            commitInput.placeholder = 'Mensagem de commit...';
            commitInput.value = `feat(milestone-${String(m.number).padStart(2, '0')}): ${m.title.toLowerCase()}`;
            commitInput.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 6px; color: #fff; font-size: 0.75rem; margin-bottom: 6px; width: 100%; box-sizing: border-box;';

            const commitBtn = document.createElement('button');
            commitBtn.className = 'btn-milestone-action btn-action-primary';
            commitBtn.textContent = 'Commit';
            commitBtn.style.width = '100%';

            commitBtn.addEventListener('click', async () => {
              const info = getSelectedProjectInfo();
              if (!info || !info.rootPath) return;

              const msg = commitInput.value.trim();
              if (!msg) {
                alert('Insira uma mensagem de commit.');
                return;
              }

              commitBtn.disabled = true;
              updateStatus('Enviando commit...');

              try {
                // First stage modified files
                const allFiles = [...gitStatus.matchedModified, ...gitStatus.otherModified];
                const stageResult = await api.stageProjectGitFiles({ rootPath: info.rootPath, files: allFiles });
                if (!stageResult || !stageResult.ok) {
                  throw new Error(stageResult?.message || 'Falha ao fazer stage dos arquivos.');
                }

                // Now commit
                const commitResult = await api.commitProjectGitFiles({
                  rootPath: info.rootPath,
                  message: msg,
                  files: allFiles
                });

                if (commitResult && commitResult.ok) {
                  // Link commit to milestone
                  await api.linkMilestoneCommit({
                    rootPath: info.rootPath,
                    milestoneId: m.id,
                    commit: {
                      hash: commitResult.hash || 'unknown',
                      message: msg,
                      createdAt: new Date().toISOString()
                    }
                  });

                  appendMessage('assistant', `Commit realizado com sucesso: \`${msg}\``, { persistToConversation: false });
                  await refresh();
                } else {
                  throw new Error(commitResult?.message || 'Erro ao fazer commit.');
                }
              } catch (err) {
                alert(err.message);
              } finally {
                commitBtn.disabled = false;
                updateStatus(`Projeto ativo: ${info.name}`);
              }
            });

            commitBlock.appendChild(commitInput);
            commitBlock.appendChild(commitBtn);
            details.appendChild(commitBlock);
          }

          // Actions
          const actions = document.createElement('div');
          actions.className = 'milestone-actions';

          if (m.status === 'planned' || m.status === 'ready' || m.status === 'blocked') {
            const btnActivate = document.createElement('button');
            btnActivate.className = 'btn-milestone-action btn-action-primary';
            btnActivate.textContent = 'Iniciar Etapa';
            btnActivate.addEventListener('click', async (e) => {
              e.stopPropagation();
              await updateStatusAction(m.id, 'active');
            });
            actions.appendChild(btnActivate);
          } else if (m.status === 'active') {
            if (m.validationCommands) {
              const btnValidate = document.createElement('button');
              btnValidate.className = 'btn-milestone-action';
              btnValidate.textContent = 'Validar';
              btnValidate.addEventListener('click', async (e) => {
                e.stopPropagation();
                const term = getTerminalController();
                if (term) {
                  term.open();
                  await term.runProjectCommand(m.validationCommands);
                } else {
                  alert('Terminal não disponível.');
                }
              });
              actions.appendChild(btnValidate);
            }

            const btnDone = document.createElement('button');
            btnDone.className = 'btn-milestone-action btn-action-primary';
            btnDone.textContent = 'Concluir';
            btnDone.addEventListener('click', async (e) => {
              e.stopPropagation();
              await updateStatusAction(m.id, 'done');
            });
            actions.appendChild(btnDone);

            const btnBlock = document.createElement('button');
            btnBlock.className = 'btn-milestone-action';
            btnBlock.textContent = 'Bloquear';
            btnBlock.style.color = '#e74c3c';
            btnBlock.addEventListener('click', async (e) => {
              e.stopPropagation();
              await updateStatusAction(m.id, 'blocked');
            });
            actions.appendChild(btnBlock);
          } else if (m.status === 'done') {
            const btnReopen = document.createElement('button');
            btnReopen.className = 'btn-milestone-action';
            btnReopen.textContent = 'Reabrir Etapa';
            btnReopen.addEventListener('click', async (e) => {
              e.stopPropagation();
              await updateStatusAction(m.id, 'active');
            });
            actions.appendChild(btnReopen);
          }

          details.appendChild(actions);
          card.appendChild(details);
        }

        // Click on card expands/collapses it (selects it)
        card.addEventListener('click', (e) => {
          // If we clicked on checkbox or button, don't toggle select
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('.milestone-task-item') || e.target.closest('.milestone-actions') || e.target.closest('.milestone-git-files')) {
            return;
          }
          selectedMilestoneId = isSelected ? null : m.id;
          refresh();
        });

        item.appendChild(marker);
        item.appendChild(card);
        timelineContent.appendChild(item);
      });
    }

    async function updateStatusAction(milestoneId, newStatus) {
      const info = getSelectedProjectInfo();
      if (!info || !info.rootPath) return;

      updateStatus('Atualizando status...');
      const result = await api.updateMilestoneStatus({
        rootPath: info.rootPath,
        milestoneId,
        status: newStatus
      });

      if (result && result.ok) {
        await refresh();
      } else {
        alert('Erro ao atualizar status: ' + (result && result.message || 'Erro desconhecido.'));
      }
      updateStatus(`Projeto ativo: ${info.name}`);
    }

    function getStatusLabel(status) {
      switch (status) {
        case 'planned': return 'Planejado';
        case 'ready': return 'Pronto';
        case 'active': return 'Ativo';
        case 'done': return 'Concluído';
        case 'blocked': return 'Bloqueado';
        default: return status || 'Pendente';
      }
    }

    function resetForNoProject() {
      milestones = [];
      selectedMilestoneId = null;
      gitStatus = null;
      if (timelineContent) timelineContent.innerHTML = '';
      if (badgeProjectMilestones) badgeProjectMilestones.classList.add('hidden');
    }

    return {
      init,
      refresh,
      resetForNoProject
    };
  }

  window.FaberMilestonesPanel = {
    createMilestonesPanelController
  };
})();
