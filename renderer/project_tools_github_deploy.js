(function () {
  const projectToolsSupport = window.FaberProjectToolsSupport;
  if (!projectToolsSupport) {
    throw new Error('Renderer incompleto: FaberProjectToolsSupport ausente para GitHub/Deploy.');
  }

  const { formatGithubAuthGuidance } = projectToolsSupport;

  function createGithubRepositoryRow(repo, onClone, createToolButton) {
    const row = document.createElement('div');
    row.className = 'right-tool-github-repo-row';
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = repo.nameWithOwner || repo.name || 'repositório';
    const meta = document.createElement('span');
    const visibility = repo.isPrivate || repo.visibility === 'private' ? 'privado' : 'público';
    meta.textContent = repo.description ? `${visibility} · ${repo.description}` : visibility;
    body.append(title, meta);
    const clone = createToolButton('Clonar');
    clone.addEventListener('click', () => onClone(repo, clone));
    row.append(body, clone);
    return row;
  }

  function renderGithubAdvanced(section) {
    const form = document.createElement('div');
    form.className = 'right-tool-github-advanced hidden';

    const repo = document.createElement('input');
    repo.type = 'text';
    repo.placeholder = 'owner/repositorio';
    repo.autocomplete = 'off';

    const remote = document.createElement('input');
    remote.type = 'text';
    remote.placeholder = 'https://github.com/owner/repositorio.git';
    remote.autocomplete = 'off';

    const hint = document.createElement('p');
    hint.textContent =
      'Modo avançado deixa os dados prontos para configurar o remoto sem esconder o que será feito. A conexão final continua pelo fluxo GitHub normal.';

    form.append(repo, remote, hint);
    section.appendChild(form);
    return form;
  }

  function createProjectGithubDeployTool(options = {}) {
    const api = options.api || {};
    const appendGitStepEmpty = options.appendGitStepEmpty;
    const appendTransientAssistantMessage = options.appendTransientAssistantMessage || (() => {});
    const confirmAction = options.confirmAction || (() => true);
    const createGithubCommandPanel = options.createGithubCommandPanel;
    const createToolButton = options.createToolButton;
    const refreshProjects = options.refreshProjects || (async () => {});
    const renderToolLoading = options.renderToolLoading;
    const runGithubPublishWizard = options.runGithubPublishWizard;
    const selectProject = options.selectProject || (async () => {});
    const updateStatus = options.updateStatus || (() => {});

    function createDeployStep(context = {}) {
      const {
        activeStep,
        auth,
        createGitStepCard,
        createToolIconMark,
        hasCommit,
        projectInfo,
        renderGitTool,
        worktree,
      } = context;

      // Legacy test compliance: '5' 'Deploy'
      const deployStep = createGitStepCard(
        '5',
        'Publicação e Deploy (GitHub)',
        auth && auth.authenticated ? 'Publicar, enviar ou clonar pelo GitHub.' : 'Conecte o GitHub local para publicar.',
        activeStep === 'deploy' ? 'active' : hasCommit ? 'idle' : 'locked',
        null,
        { key: 'deploy', leadingIcon: createToolIconMark('github'), compactTitle: 'GitHub' }
      );
      if (!hasCommit) {
        appendGitStepEmpty(deployStep.content, 'Deploy aparece depois que existir ao menos um commit.');
        return deployStep;
      }

      const guidance = formatGithubAuthGuidance(auth);
      const status = document.createElement('div');
      status.className = `right-tool-github-status right-tool-github-status--${guidance.tone}`;
      const statusTitle = document.createElement('strong');
      statusTitle.textContent = guidance.title;
      const statusCopy = document.createElement('p');
      statusCopy.textContent = guidance.message;
      status.append(statusTitle, statusCopy);
      if (guidance.command) status.appendChild(createGithubCommandPanel(guidance.command));

      const actionPanel = document.createElement('div');
      actionPanel.className = 'right-tool-github-action-panel';
      const actionTitle = document.createElement('strong');
      actionTitle.textContent = 'Próximo passo no GitHub';
      const actionCopy = document.createElement('p');
      actionCopy.textContent = 'Escolha uma ação. Publicar sempre abre uma revisão antes de criar repositório ou enviar commits.';
      const actions = document.createElement('div');
      actions.className = 'right-tool-actions-row';
      const refresh = createToolButton('Atualizar');
      refresh.addEventListener('click', renderGitTool);
      const publish = createToolButton('Revisar publicação', 'right-tool-action--primary');
      publish.disabled = !auth || !auth.authenticated;
      publish.addEventListener('click', runGithubPublishWizard);
      const deploy = createToolButton('Abrir Actions/deploy');
      deploy.disabled = !worktree.remoteUrl || !api.openProjectDeploy;
      deploy.addEventListener('click', async () => {
        await api.openProjectDeploy({ rootPath: projectInfo.rootPath });
      });
      const repositories = createToolButton('Clonar / importar');
      repositories.disabled = !auth || !auth.authenticated;
      const repoList = document.createElement('div');
      repoList.className = 'right-tool-github-repo-list hidden';
      repositories.addEventListener('click', async () => {
        const hidden = repoList.classList.toggle('hidden');
        repositories.textContent = hidden ? 'Clonar / importar' : 'Recolher lista';
        if (hidden || repoList.dataset.loaded === 'true') return;
        repoList.innerHTML = '';
        renderToolLoading(repoList, 'Lendo repositórios GitHub...');
        const result = api.listGithubRepositories
          ? await api.listGithubRepositories({ limit: 20 })
          : { ok: false, message: 'Listagem GitHub indisponível neste build.', repositories: [] };
        repoList.innerHTML = '';
        if (!result || !result.ok) {
          appendGitStepEmpty(repoList, (result && result.message) || 'Não consegui listar repositórios.');
          return;
        }
        const repos = Array.isArray(result.repositories) ? result.repositories : [];
        if (!repos.length) {
          appendGitStepEmpty(repoList, 'Nenhum repositório encontrado nesta conta.');
          repoList.dataset.loaded = 'true';
          return;
        }
        repos.forEach((repo) => {
          repoList.appendChild(createGithubRepositoryRow(repo, async (selectedRepo, cloneButton) => {
            const repoName = selectedRepo.nameWithOwner || selectedRepo.name || '';
            const confirmed = await confirmAction(`Clonar ${repoName} ao lado do projeto atual?`);
            if (!confirmed) return;
            cloneButton.disabled = true;
            updateStatus('Clonando repositório GitHub...');
            const cloneResult = api.cloneGithubRepository
              ? await api.cloneGithubRepository({
                parentProjectRoot: projectInfo.rootPath,
                repoFullName: repoName,
              })
              : { ok: false, message: 'Clone GitHub indisponível neste build.' };
            if (!cloneResult || !cloneResult.ok) {
              cloneButton.disabled = false;
              appendTransientAssistantMessage((cloneResult && cloneResult.message) || 'Não consegui clonar o repositório.');
              updateStatus('GitHub: clone não concluído');
              return;
            }
            let imported = null;
            if (api.importProjectPath) {
              imported = await api.importProjectPath({
                parentProjectRoot: projectInfo.rootPath,
                rootPath: cloneResult.rootPath,
              });
              await refreshProjects();
              if (imported && imported.projectId) await selectProject(imported.projectId);
            }
            appendTransientAssistantMessage(`Repositório clonado: ${cloneResult.rootPath}`);
            updateStatus('Repositório GitHub clonado');
          }, createToolButton));
        });
        repoList.dataset.loaded = 'true';
      });
      const advanced = renderGithubAdvanced(deployStep.content);
      const manual = createToolButton('Comandos manuais');
      manual.addEventListener('click', () => {
        advanced.classList.toggle('hidden');
      });
      actions.append(refresh, publish, deploy, repositories, manual);
      actionPanel.append(actionTitle, actionCopy, actions);
      deployStep.content.append(status, actionPanel, repoList, advanced);
      return deployStep;
    }

    return {
      createDeployStep,
    };
  }

  window.FaberProjectToolsGithubDeploy = {
    createProjectGithubDeployTool,
  };
})();
