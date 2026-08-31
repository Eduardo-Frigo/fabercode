(function () {
  const projectToolsSupport = window.FaberProjectToolsSupport;
  if (!projectToolsSupport) {
    throw new Error('Renderer incompleto: FaberProjectToolsSupport ausente.');
  }
  const projectToolsGit = window.FaberProjectToolsGit;
  if (!projectToolsGit) {
    throw new Error('Renderer incompleto: FaberProjectToolsGit ausente.');
  }
  const {
    buildTerminalPreviewCommand,
    formatGithubAuthGuidance,
    formatGithubPublishPlan,
    formatPreviewStartFailure,
    getGithubAuthCommand,
    inferGithubRepoNameFromProject,
  } = projectToolsSupport;
  const { createProjectGitTool } = projectToolsGit;

  function uiText(key, fallback, replacements = {}) {
    let value = window.t ? window.t(key, fallback) : fallback;
    Object.entries(replacements).forEach(([name, replacement]) => {
      value = String(value).split(`{${name}}`).join(String(replacement));
    });
    return value;
  }

  function createToolButton(label, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ['right-tool-action', className].filter(Boolean).join(' ');
    button.textContent = label;
    return button;
  }

  function createToolSection(title, subtitle = '') {
    const section = document.createElement('section');
    section.className = 'right-tool-section';
    const head = document.createElement('div');
    head.className = 'right-tool-section__head';
    const strong = document.createElement('strong');
    strong.textContent = title;
    head.appendChild(strong);
    if (subtitle) {
      const span = document.createElement('span');
      span.textContent = subtitle;
      head.appendChild(span);
    }
    section.appendChild(head);
    return section;
  }

  function dispatchTutorialPreviewStarted(detail = {}) {
    if (
      typeof window === 'undefined'
      || typeof window.dispatchEvent !== 'function'
      || typeof window.CustomEvent !== 'function'
    ) return;
    window.dispatchEvent(new window.CustomEvent('faber:project-preview-started', { detail }));
  }

  function dispatchTutorialPreviewFailed(detail = {}) {
    if (
      typeof window === 'undefined'
      || typeof window.dispatchEvent !== 'function'
      || typeof window.CustomEvent !== 'function'
    ) return;
    window.dispatchEvent(new window.CustomEvent('faber:project-preview-failed', { detail }));
  }

  function setRightPanelTitle(title) {
    const rightPanelTitle = document.getElementById('right-panel-title');
    if (rightPanelTitle) rightPanelTitle.textContent = title;
  }

  function setFilesRegionRuntimeHidden(hidden) {
    const filesRegion = document.getElementById('workspace-files-region');
    if (!filesRegion) return;
    filesRegion.classList.toggle('workspace-runtime-hidden', Boolean(hidden));
  }

  function createProjectToolsController(options = {}) {
    const api = options.api || {};
    const terminalController = options.terminalController || null;
    const getProjects = typeof options.getProjects === 'function' ? options.getProjects : () => [];
    const getSelectedProjectId = typeof options.getSelectedProjectId === 'function'
      ? options.getSelectedProjectId
      : () => null;
    const getSelectedProjectInfo = typeof options.getSelectedProjectInfo === 'function'
      ? options.getSelectedProjectInfo
      : () => null;
    const requestTextInput = typeof options.requestTextInput === 'function'
      ? options.requestTextInput
      : async () => null;
    const appendMessage = typeof options.appendMessage === 'function' ? options.appendMessage : () => {};
    const openFile = typeof options.openFile === 'function' ? options.openFile : async () => {};
    const refreshFileTree = typeof options.refreshFileTree === 'function' ? options.refreshFileTree : async () => {};
    const refreshProjects = typeof options.refreshProjects === 'function' ? options.refreshProjects : async () => {};
    const selectProject = typeof options.selectProject === 'function' ? options.selectProject : async () => {};
    const updateStatus = typeof options.updateStatus === 'function' ? options.updateStatus : () => {};
    const confirmAction = typeof options.confirmAction === 'function'
      ? options.confirmAction
      : (message) => window.faberConfirm ? window.faberConfirm(message) : window.confirm(message);
    function appendTransientAssistantMessage(text) {
      appendMessage('assistant', text, { persistToConversation: false });
    }

    const toolSurface = {
      root: null,
      title: null,
      subtitle: null,
      body: null,
      close: null,
      backdrop: null,
    };

    function ensureToolSurface() {
      if (toolSurface.root) return toolSurface;

      const root = document.createElement('div');
      root.id = 'right-tool-lightbox';
      root.className = 'right-tool-lightbox hidden';
      root.setAttribute('aria-hidden', 'true');

      const backdrop = document.createElement('button');
      backdrop.id = 'right-tool-lightbox-backdrop';
      backdrop.className = 'right-tool-lightbox__backdrop';
      backdrop.type = 'button';
      backdrop.setAttribute('aria-label', uiText('closeTool', 'Fechar ferramenta'));

      const panel = document.createElement('section');
      panel.className = 'right-tool-lightbox__panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'false');

      const header = document.createElement('div');
      header.className = 'right-tool-lightbox__head';
      const titleWrap = document.createElement('div');
      const title = document.createElement('strong');
      title.id = 'right-tool-lightbox-title';
      const subtitle = document.createElement('span');
      subtitle.id = 'right-tool-lightbox-subtitle';
      titleWrap.append(title, subtitle);
      const close = document.createElement('button');
      close.id = 'right-tool-lightbox-close';
      close.type = 'button';
      close.className = 'right-tool-lightbox__close';
      close.setAttribute('aria-label', uiText('closeTool', 'Fechar ferramenta'));
      close.textContent = '×';
      header.append(titleWrap, close);

      const body = document.createElement('div');
      body.id = 'right-tool-lightbox-body';
      body.className = 'right-tool-lightbox__body';

      panel.append(header, body);
      root.append(backdrop, panel);
      document.body.appendChild(root);

      toolSurface.root = root;
      toolSurface.title = title;
      toolSurface.subtitle = subtitle;
      toolSurface.body = body;
      toolSurface.close = close;
      toolSurface.backdrop = backdrop;

      close.addEventListener('click', closeToolSurface);
      backdrop.addEventListener('click', closeToolSurface);
      return toolSurface;
    }

    function closeToolSurface() {
      if (!toolSurface.root) return;
      toolSurface.root.classList.add('hidden');
      toolSurface.root.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('right-tool-lightbox-open');
      setFilesRegionRuntimeHidden(false);
    }

    function openToolSurface(title, subtitle = '', kind = '') {
      const surface = ensureToolSurface();

      if (kind === 'git' || kind === 'github') {
        surface.root.classList.add('hidden');
        surface.root.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('right-tool-lightbox-open');

        document.body.classList.add('mode-git');
        document.body.classList.remove('mode-terminal');
        document.body.classList.remove('mode-cortex');
        document.body.classList.remove('mode-milestones');
        document.body.classList.remove('mode-map-chat');
        document.body.classList.remove('mode-map-render');

        const cortexBtn = document.getElementById('btn-cortex-mode');
        if (cortexBtn) cortexBtn.classList.remove('active');
        const milestonesBtn = document.getElementById('btn-project-milestones');
        if (milestonesBtn) milestonesBtn.classList.remove('active');
        const mapAiBtn = document.getElementById('btn-map-ai');
        if (mapAiBtn) mapAiBtn.classList.remove('active');
        const terminalBtn = document.getElementById('btn-project-terminal');
        if (terminalBtn) terminalBtn.classList.remove('active');
        const filesBtn = document.getElementById('btn-project-files');
        if (filesBtn) filesBtn.classList.remove('active');

        const gitBtn = document.getElementById('btn-project-git');
        if (gitBtn) gitBtn.classList.add('active');

        setRightPanelTitle('Git');
        setFilesRegionRuntimeHidden(true);
        requestAnimationFrame(() => setRightPanelTitle('Git'));

        if (document.body.classList.contains('workspace-right-collapsed')) {
          const rightToggle = document.getElementById('workspace-collapse-right');
          if (rightToggle) rightToggle.click();
        }

        if (terminalController) {
          terminalController.closePanel();
        }

        const gitPanelContent = document.getElementById('git-panel-content');
        if (gitPanelContent) {
          gitPanelContent.innerHTML = '';
          return gitPanelContent;
        }
      }

      surface.title.textContent = title;
      surface.subtitle.textContent = subtitle;
      surface.body.innerHTML = '';
      surface.body.dataset.toolKind = kind;
      surface.root.classList.remove('hidden');
      surface.root.setAttribute('aria-hidden', 'false');
      document.body.classList.add('right-tool-lightbox-open');
      return surface.body;
    }

    function renderToolLoading(body, text) {
      body.innerHTML = '';
      const loading = document.createElement('div');
      loading.className = 'right-tool-loading';
      const dot = document.createElement('span');
      dot.className = 'right-tool-loading__dot';
      const copy = document.createElement('strong');
      copy.textContent = text;
      loading.append(dot, copy);
      body.appendChild(loading);
    }

    function getProjectRootOrNotify(body) {
      const projectInfo = getSelectedProjectInfo();
      if (projectInfo && projectInfo.rootPath) return projectInfo;
      body.innerHTML = '';
      const empty = createToolSection(window.t ? window.t('noProjectSelectedError', 'Nenhum projeto selecionado') : 'Nenhum projeto selecionado', window.t ? window.t('chooseProjectForTool', 'Escolha um projeto para usar esta ferramenta.') : 'Escolha um projeto para usar esta ferramenta.');
      body.appendChild(empty);
      return null;
    }

    function normalizeGithubAuthStatus(result) {
      if (!result) return null;
      return result.status ? result.status : result;
    }

    async function copyGithubCommand(command) {
      if (!command) return;
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(command);
          updateStatus(uiText('githubCommandCopied', 'Comando GitHub copiado'));
          return;
        }
      } catch {
        // Fall through to chat guidance.
      }
      appendTransientAssistantMessage(uiText('runCommandInTerminal', 'Rode este comando no terminal:\n{command}', { command }));
    }

    function createGithubCommandPanel(command) {
      const wrap = document.createElement('div');
      wrap.className = 'right-tool-command-panel';
      const code = document.createElement('code');
      code.textContent = command;
      const copy = createToolButton(uiText('copyCommand', 'Copiar comando'));
      copy.addEventListener('click', () => copyGithubCommand(command));
      wrap.append(code, copy);
      return wrap;
    }

    function createGithubVisibilityControl(initial = 'private') {
      const group = document.createElement('div');
      group.className = 'right-tool-segmented';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', uiText('repositoryVisibility', 'Visibilidade do repositório'));
      let value = initial === 'public' ? 'public' : 'private';

      function makeButton(nextValue, label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.dataset.value = nextValue;
        button.setAttribute('aria-pressed', String(nextValue === value));
        button.addEventListener('click', () => {
          value = nextValue;
          group.querySelectorAll('button').forEach((entry) => {
            entry.setAttribute('aria-pressed', String(entry.dataset.value === value));
          });
        });
        return button;
      }

      group.append(
        makeButton('private', uiText('privateVisibility', 'Privado')),
        makeButton('public', uiText('publicVisibility', 'Público'))
      );
      return {
        element: group,
        getValue: () => value,
      };
    }

    function renderGithubPlanBox(box, plan, publishOptions, projectInfo) {
      box.innerHTML = '';
      const guidance = formatGithubAuthGuidance(plan.auth || {});
      box.className = `right-tool-github-result right-tool-github-result--${plan.ready ? 'ready' : 'blocked'}`;

      const title = document.createElement('strong');
      title.textContent = plan.ready ? uiText('reviewReady', 'Revisão pronta') : guidance.title;
      const copy = document.createElement('p');
      copy.textContent = plan.ready
        ? uiText('githubReviewBeforeSend', 'Confira as ações abaixo. Nada será enviado antes do próximo clique.')
        : guidance.message;
      box.append(title, copy);

      const actions = Array.isArray(plan.actions) ? plan.actions : [];
      if (actions.length) {
        const list = document.createElement('ol');
        list.className = 'right-tool-step-list';
        actions.forEach((entry) => {
          const item = document.createElement('li');
          item.textContent = entry.label || entry.id || uiText('githubAction', 'Ação GitHub');
          list.appendChild(item);
        });
        box.appendChild(list);
      }

      const blockers = Array.isArray(plan.blockers) ? plan.blockers : [];
      if (blockers.length) {
        const blocked = document.createElement('p');
        blocked.className = 'right-tool-github-note';
        blocked.textContent = uiText('pendingItems', 'Pendências: {value}', { value: blockers.join(' ') });
        box.appendChild(blocked);
      }

      const command = getGithubAuthCommand(plan.auth || {});
      if (!plan.ready && command) {
        box.appendChild(createGithubCommandPanel(command));
      }

      if (!plan.ready) return;

      const publish = createToolButton(uiText('publishNow', 'Publicar agora'), 'right-tool-action--primary');
      publish.addEventListener('click', async () => {
        publish.disabled = true;
        updateStatus(uiText('publishingGithub', 'Publicando no GitHub...'));
        box.classList.add('is-working');
        const publishResult = await api.publishProjectToGithub({
          rootPath: projectInfo.rootPath,
          options: publishOptions,
        });
        box.classList.remove('is-working');

        if (!publishResult || !publishResult.ok) {
          publish.disabled = false;
          const message = (publishResult && publishResult.message) || uiText('githubPublishFailed', 'Falha ao publicar no GitHub.');
          appendTransientAssistantMessage(message);
          title.textContent = uiText('githubPublishIncomplete', 'Publicação não concluída');
          copy.textContent = message;
          updateStatus(uiText('githubPublishFailedStatus', 'GitHub: falha na publicação'));
          return;
        }

        const repoUrl = publishResult.report && publishResult.report.repoUrl ? publishResult.report.repoUrl : '';
        title.textContent = uiText('publishedGithub', 'Publicado no GitHub');
        copy.textContent = repoUrl || uiText('projectPublishedGithub', 'Projeto publicado no GitHub.');
        appendTransientAssistantMessage(repoUrl
          ? uiText('projectPublishedGithubUrl', 'Projeto publicado no GitHub: {url}', { url: repoUrl })
          : uiText('projectPublishedGithub', 'Projeto publicado no GitHub.'));
        updateStatus(uiText('githubPublishedStatus', 'GitHub publicado'));
        await refreshFileTree();
      });
      box.appendChild(publish);
    }

    async function renderGithubPublishWizardBody(body, projectInfo) {
      body.innerHTML = '';
      const section = createToolSection(
        uiText('publishGithubTitle', 'Publicar no GitHub'),
        uiText('publishGithubDesc', 'Conecte a conta local, revise o plano e envie quando estiver pronto.')
      );
      const defaultRepoName = inferGithubRepoNameFromProject(
        getProjects(),
        getSelectedProjectId(),
        projectInfo
      );

      const authResult = api.getGithubAuthStatus ? await api.getGithubAuthStatus() : null;
      const auth = normalizeGithubAuthStatus(authResult) || { ok: false };
      const guidance = formatGithubAuthGuidance(auth);

      const status = document.createElement('div');
      status.className = `right-tool-github-status right-tool-github-status--${guidance.tone}`;
      const statusTitle = document.createElement('strong');
      statusTitle.textContent = guidance.title;
      const statusCopy = document.createElement('p');
      statusCopy.textContent = guidance.message;
      status.append(statusTitle, statusCopy);
      if (guidance.command) status.appendChild(createGithubCommandPanel(guidance.command));

      const form = document.createElement('div');
      form.className = 'right-tool-github-form';

      const repoLabel = document.createElement('label');
      repoLabel.className = 'right-tool-field';
      const repoText = document.createElement('span');
      repoText.textContent = uiText('repositoryName', 'Nome do repositório');
      const repoInput = document.createElement('input');
      repoInput.type = 'text';
      repoInput.className = 'right-tool-input';
      repoInput.value = defaultRepoName;
      repoInput.placeholder = defaultRepoName;
      repoInput.autocomplete = 'off';
      repoLabel.append(repoText, repoInput);

      const visibilityLabel = document.createElement('div');
      visibilityLabel.className = 'right-tool-field';
      const visibilityText = document.createElement('span');
      visibilityText.textContent = uiText('visibility', 'Visibilidade');
      const visibility = createGithubVisibilityControl('private');
      visibilityLabel.append(visibilityText, visibility.element);

      const resultBox = document.createElement('div');
      resultBox.className = 'right-tool-github-result hidden';

      const review = createToolButton(uiText('reviewPlan', 'Revisar plano'), 'right-tool-action--primary');
      review.addEventListener('click', async () => {
        review.disabled = true;
        resultBox.classList.remove('hidden');
        resultBox.innerHTML = '';
        renderToolLoading(resultBox, uiText('checkingGithub', 'Verificando GitHub...'));
        const publishOptions = {
          repoName: repoInput.value || defaultRepoName,
          visibility: visibility.getValue(),
        };
        updateStatus(uiText('preparingGithubPlan', 'Preparando plano GitHub...'));
        const planResult = await api.getGithubPublishPlan({
          rootPath: projectInfo.rootPath,
          options: publishOptions,
        });
        review.disabled = false;

        if (!planResult || !planResult.ok || !planResult.plan) {
          const message = (planResult && planResult.message) || uiText('githubPlanningFailed', 'Falha ao planejar publicação GitHub.');
          resultBox.innerHTML = '';
          resultBox.className = 'right-tool-github-result right-tool-github-result--blocked';
          const strong = document.createElement('strong');
          strong.textContent = uiText('planUnavailable', 'Plano indisponível');
          const copy = document.createElement('p');
          copy.textContent = message;
          resultBox.append(strong, copy);
          appendTransientAssistantMessage(message);
          updateStatus(uiText('githubPlanUnavailableStatus', 'GitHub: plano indisponível'));
          return;
        }

        renderGithubPlanBox(resultBox, planResult.plan, publishOptions, projectInfo);
        updateStatus(planResult.plan.ready
          ? uiText('githubPlanReadyStatus', 'GitHub: plano pronto')
          : uiText('githubPendingStatus', 'GitHub: pendências encontradas'));
      });

      form.append(repoLabel, visibilityLabel, review, resultBox);
      section.append(status, form);
      body.appendChild(section);
    }

    async function runGithubPublishWizard() {
      const projectInfo = getSelectedProjectInfo();
      if (!projectInfo || !projectInfo.rootPath) {
        appendTransientAssistantMessage(uiText('selectProjectBeforeGithub', 'Selecione um projeto antes de configurar GitHub.'));
        return;
      }
      if (!api.getGithubPublishPlan || !api.publishProjectToGithub) {
        appendTransientAssistantMessage(uiText('githubIntegrationUnavailable', 'A integração GitHub ainda não está disponível neste build.'));
        return;
      }
      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const body = openToolSurface('GitHub', uiText('githubToolDesc', 'Conta, repositório e envio com revisão local.'), 'github');
        renderToolLoading(body, uiText('checkingGithubAccount', 'Verificando conta GitHub...'));
        await renderGithubPublishWizardBody(body, projectInfo);
        return;
      }

      const defaultRepoName = inferGithubRepoNameFromProject(
        getProjects(),
        getSelectedProjectId(),
        projectInfo
      );
      const repoNameInput = await requestTextInput({
        title: uiText('repositoryName', 'Nome do repositório GitHub'),
        initialValue: defaultRepoName,
        placeholder: defaultRepoName,
      });
      if (repoNameInput === null) return;

      const visibilityInput = await requestTextInput({
        title: uiText('repositoryVisibility', 'Visibilidade do repositório'),
        initialValue: 'private',
        placeholder: uiText('visibilityPrompt', 'private ou public'),
      });
      if (visibilityInput === null) return;

      const publishOptions = {
        repoName: repoNameInput || defaultRepoName,
        visibility: /^public$/i.test(String(visibilityInput || '').trim()) ? 'public' : 'private',
      };

      updateStatus(uiText('preparingGithubPlan', 'Preparando plano GitHub...'));
      const planResult = await api.getGithubPublishPlan({
        rootPath: projectInfo.rootPath,
        options: publishOptions,
      });

      if (!planResult || !planResult.ok || !planResult.plan) {
        appendTransientAssistantMessage((planResult && planResult.message) || uiText('githubPlanningFailed', 'Falha ao planejar publicação GitHub.'));
        updateStatus(uiText('githubPlanUnavailableStatus', 'GitHub: plano indisponível'));
        return;
      }

      appendTransientAssistantMessage(formatGithubPublishPlan(planResult.plan));
      if (!planResult.plan.ready) {
        updateStatus(uiText('githubPendingStatus', 'GitHub: pendências encontradas'));
        return;
      }

      const confirmed = await confirmAction(
        uiText('githubPublishConfirm', 'Publicar este projeto no GitHub como {repo}?', {
          repo: planResult.plan.repoFullName || publishOptions.repoName,
        })
      );
      if (!confirmed) {
        updateStatus(uiText('githubPublishCanceled', 'Publicação GitHub cancelada'));
        return;
      }

      updateStatus(uiText('publishingGithub', 'Publicando no GitHub...'));
      const publishResult = await api.publishProjectToGithub({
        rootPath: projectInfo.rootPath,
        options: publishOptions,
      });

      if (!publishResult || !publishResult.ok) {
        appendTransientAssistantMessage((publishResult && publishResult.message) || uiText('githubPublishFailed', 'Falha ao publicar no GitHub.'));
        updateStatus(uiText('githubPublishFailedStatus', 'GitHub: falha na publicação'));
        return;
      }

      const repoUrl = publishResult.report && publishResult.report.repoUrl ? publishResult.report.repoUrl : '';
      appendTransientAssistantMessage(repoUrl
        ? uiText('projectPublishedGithubUrl', 'Projeto publicado no GitHub: {url}', { url: repoUrl })
        : uiText('projectPublishedGithub', 'Projeto publicado no GitHub.'));
      updateStatus(uiText('githubPublishedStatus', 'GitHub publicado'));
    }

    const gitTool = createProjectGitTool({
      api,
      appendTransientAssistantMessage,
      confirmAction,
      createGithubCommandPanel,
      createToolButton,
      createToolSection,
      getProjectRootOrNotify,
      normalizeGithubAuthStatus,
      openFile,
      openToolSurface,
      refreshFileTree,
      refreshProjects,
      renderToolLoading,
      runGithubPublishWizard,
      selectProject,
      updateStatus,
    });

    async function publishToGithub() {
      await gitTool.renderGitTool({ resetOpenStep: true });
    }

    function renderPreviewToolProgress(body, pct, label) {
      body.innerHTML = '';
      const section = createToolSection(window.t ? window.t('runAppProjectTitle', 'Executar projeto') : 'Executar projeto', window.t ? window.t('runAppProjectDesc', 'Acompanhe a preparação da visualização local.') : 'Acompanhe a preparação da visualização local.');
      const meter = document.createElement('div');
      meter.className = 'right-tool-run-meter';
      if (Number(pct) >= 100) meter.classList.add('is-complete');
      const bar = document.createElement('span');
      bar.style.width = `${Math.max(0, Math.min(100, Number(pct) || 0))}%`;
      meter.appendChild(bar);
      const copy = document.createElement('strong');
      copy.textContent = `${Math.round(Math.max(0, Math.min(100, Number(pct) || 0)))}% · ${label}`;
      section.append(meter, copy);
      body.appendChild(section);
    }

    async function startPreview() {
      const selectedProject = getSelectedProjectInfo();
      try {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
          const started = await runPreviewStart();
          if (started) dispatchTutorialPreviewStarted({ rootPath: selectedProject?.rootPath || '' });
          else dispatchTutorialPreviewFailed({ rootPath: selectedProject?.rootPath || '' });
          return started;
        }
        const body = openToolSurface(window.t ? window.t('runAppTitle', 'Executar') : 'Executar', window.t ? window.t('runAppDesc', 'Rodar e abrir a visualização local do projeto.') : 'Rodar e abrir a visualização local do projeto.', 'run');
        const projectInfo = getProjectRootOrNotify(body);
        if (!projectInfo) {
          dispatchTutorialPreviewFailed({ message: uiText('noProjectSelectedError', 'Nenhum projeto selecionado para esta ferramenta.') });
          return false;
        }
        renderPreviewToolProgress(body, 18, window.t ? window.t('previewPlanning', 'planejando visualização') : 'planejando visualização');
        await new Promise((resolve) => setTimeout(resolve, 120));
        renderPreviewToolProgress(body, 46, window.t ? window.t('previewPreparing', 'preparando terminal ou servidor local') : 'preparando terminal ou servidor local');
        await new Promise((resolve) => setTimeout(resolve, 120));
        renderPreviewToolProgress(body, 72, window.t ? window.t('previewStarting', 'iniciando execução') : 'iniciando execução');
        const started = await runPreviewStart();
        if (started) {
          renderPreviewToolProgress(body, 100, window.t ? window.t('previewRequested', 'visualização solicitada') : 'visualização solicitada');
          dispatchTutorialPreviewStarted({ rootPath: projectInfo.rootPath });
        } else {
          dispatchTutorialPreviewFailed({ rootPath: projectInfo.rootPath });
        }
        return started;
      } catch (error) {
        const message = error && error.message ? error.message : uiText('localRunUnavailable', 'A execução local ainda não está disponível nesta versão.');
        appendTransientAssistantMessage(message);
        updateStatus(uiText('previewBlocked', 'Execução bloqueada'));
        dispatchTutorialPreviewFailed({ rootPath: selectedProject?.rootPath || '', message });
        return false;
      }
    }

    async function runPreviewStart() {
      const projectInfo = getSelectedProjectInfo();
      if (!projectInfo || !projectInfo.rootPath) {
        appendTransientAssistantMessage(uiText('selectProjectBeforeRun', 'Selecione um projeto antes de executar localmente.'));
        return false;
      }
      if (!api.startProjectPreview) {
        appendTransientAssistantMessage(uiText('localRunUnavailable', 'A execução local ainda não está disponível nesta versão.'));
        return false;
      }

      const terminalStarted = await startPreviewInTerminal(projectInfo);
      if (terminalStarted !== null) return terminalStarted;

      updateStatus(uiText('previewRunningProject', 'Executando projeto local...'));
      const result = await api.startProjectPreview({
        rootPath: projectInfo.rootPath,
        open: true,
        options: {
          autoInstallDependencies: true,
        },
      });

      if (!result || !result.ok || !result.session) {
        appendTransientAssistantMessage(formatPreviewStartFailure(result || null));
        updateStatus(uiText('previewBlocked', 'Execução bloqueada'));
        return false;
      }

      const installNote = result.install && result.install.ok
        ? uiText('previewDependencyInstall', ' Dependências instaladas automaticamente antes da execução.')
        : '';
      const target = result.session.url || result.session.commandText || 'processo local iniciado';
      appendTransientAssistantMessage(uiText('previewActiveTarget', 'Execução local ativa: {target}.{installNote}', { target, installNote }));
      updateStatus(uiText('previewActive', 'Execução local ativa'));
      return true;
    }

    async function startPreviewInTerminal(projectInfo) {
      if (
        !terminalController ||
        typeof terminalController.runProjectCommand !== 'function' ||
        !api.getProjectPreviewPlan ||
        !api.startProjectPreview
      ) {
        return null;
      }

      updateStatus(uiText('previewPlanningStatus', 'Planejando execução local...'));
      const planResult = await api.getProjectPreviewPlan({
        rootPath: projectInfo.rootPath,
      });
      const plan = planResult && planResult.plan ? planResult.plan : null;
      if (
        !planResult
        || !planResult.ok
        || !plan
        || ['file', 'static_server'].includes(plan.mode)
      ) {
        return null;
      }
      const command = buildTerminalPreviewCommand(plan);
      if (!command) {
        appendTransientAssistantMessage(formatPreviewStartFailure({
          message: uiText('previewBlockedBeforeTerminal', 'Execução local bloqueada antes de abrir o terminal.'),
          plan,
        }));
        updateStatus(uiText('previewBlocked', 'Execução bloqueada'));
        return false;
      }

      updateStatus(uiText('previewRunningTerminal', 'Executando no terminal interno...'));
      const terminalResult = await terminalController.runProjectCommand(command, {
        createNewTabIfRunning: true,
      });
      if (!terminalResult || !terminalResult.ok) {
        appendTransientAssistantMessage((terminalResult && terminalResult.message) || uiText('previewTerminalStartFailed', 'Não consegui iniciar o comando no terminal interno.'));
        updateStatus(uiText('previewBlocked', 'Execução bloqueada'));
        return false;
      }

      if (plan.mode !== 'server') {
        appendTransientAssistantMessage(uiText('previewTerminalStartedCommand', 'Execução local iniciada no terminal interno: {command}.', { command }));
        updateStatus(uiText('previewActive', 'Execução local ativa'));
        return true;
      }

      const result = await api.startProjectPreview({
        rootPath: projectInfo.rootPath,
        open: true,
        options: {
          attachToExistingServer: true,
          port: plan.port,
          readyTimeoutMs: 180000,
          readyPollIntervalMs: 500,
        },
      });

      if (!result || !result.ok || !result.session) {
        appendTransientAssistantMessage(formatPreviewStartFailure(result || null));
        updateStatus(uiText('previewBlocked', 'Execução bloqueada'));
        return false;
      }

      const target = result.session.url || plan.url || 'servidor local iniciado';
      appendTransientAssistantMessage(uiText('previewTerminalActiveTarget', 'Execução local ativa no terminal interno: {target}.', { target }));
      updateStatus(uiText('previewActive', 'Execução local ativa'));
      return true;
    }

    return {
      buildTerminalPreviewCommand,
      formatGithubPublishPlan,
      formatPreviewStartFailure,
      inferGithubRepoNameFromProject: () => inferGithubRepoNameFromProject(
        getProjects(),
        getSelectedProjectId(),
        getSelectedProjectInfo()
      ),
      publishToGithub,
      startPreview,
    };
  }

  window.FaberProjectTools = {
    buildTerminalPreviewCommand,
    createProjectToolsController,
    formatGithubPublishPlan,
    formatPreviewStartFailure,
    formatGithubAuthGuidance,
    getGithubAuthCommand,
    inferGithubRepoNameFromProject,
  };
})();
