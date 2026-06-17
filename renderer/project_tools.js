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
      backdrop.setAttribute('aria-label', 'Fechar ferramenta');

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
      close.setAttribute('aria-label', 'Fechar ferramenta');
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

        const rightPanelTitle = document.getElementById('right-panel-title');
        if (rightPanelTitle) rightPanelTitle.textContent = title || 'Git';

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
      const empty = createToolSection('Nenhum projeto selecionado', 'Escolha um projeto para usar esta ferramenta.');
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
          updateStatus('Comando GitHub copiado');
          return;
        }
      } catch {
        // Fall through to chat guidance.
      }
      appendTransientAssistantMessage(`Rode este comando no terminal:\n${command}`);
    }

    function createGithubCommandPanel(command) {
      const wrap = document.createElement('div');
      wrap.className = 'right-tool-command-panel';
      const code = document.createElement('code');
      code.textContent = command;
      const copy = createToolButton('Copiar comando');
      copy.addEventListener('click', () => copyGithubCommand(command));
      wrap.append(code, copy);
      return wrap;
    }

    function createGithubVisibilityControl(initial = 'private') {
      const group = document.createElement('div');
      group.className = 'right-tool-segmented';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Visibilidade do repositório');
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

      group.append(makeButton('private', 'Privado'), makeButton('public', 'Público'));
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
      title.textContent = plan.ready ? 'Revisão pronta' : guidance.title;
      const copy = document.createElement('p');
      copy.textContent = plan.ready
        ? 'Confira as ações abaixo. Nada será enviado antes do próximo clique.'
        : guidance.message;
      box.append(title, copy);

      const actions = Array.isArray(plan.actions) ? plan.actions : [];
      if (actions.length) {
        const list = document.createElement('ol');
        list.className = 'right-tool-step-list';
        actions.forEach((entry) => {
          const item = document.createElement('li');
          item.textContent = entry.label || entry.id || 'Ação GitHub';
          list.appendChild(item);
        });
        box.appendChild(list);
      }

      const blockers = Array.isArray(plan.blockers) ? plan.blockers : [];
      if (blockers.length) {
        const blocked = document.createElement('p');
        blocked.className = 'right-tool-github-note';
        blocked.textContent = `Pendências: ${blockers.join(' ')}`;
        box.appendChild(blocked);
      }

      const command = getGithubAuthCommand(plan.auth || {});
      if (!plan.ready && command) {
        box.appendChild(createGithubCommandPanel(command));
      }

      if (!plan.ready) return;

      const publish = createToolButton('Publicar agora', 'right-tool-action--primary');
      publish.addEventListener('click', async () => {
        publish.disabled = true;
        updateStatus('Publicando no GitHub...');
        box.classList.add('is-working');
        const publishResult = await api.publishProjectToGithub({
          rootPath: projectInfo.rootPath,
          options: publishOptions,
        });
        box.classList.remove('is-working');

        if (!publishResult || !publishResult.ok) {
          publish.disabled = false;
          const message = (publishResult && publishResult.message) || 'Falha ao publicar no GitHub.';
          appendTransientAssistantMessage(message);
          title.textContent = 'Publicação não concluída';
          copy.textContent = message;
          updateStatus('GitHub: falha na publicação');
          return;
        }

        const repoUrl = publishResult.report && publishResult.report.repoUrl ? publishResult.report.repoUrl : '';
        title.textContent = 'Publicado no GitHub';
        copy.textContent = repoUrl || 'Projeto publicado no GitHub.';
        appendTransientAssistantMessage(repoUrl ? `Projeto publicado no GitHub: ${repoUrl}` : 'Projeto publicado no GitHub.');
        updateStatus('GitHub publicado');
        await refreshFileTree();
      });
      box.appendChild(publish);
    }

    async function renderGithubPublishWizardBody(body, projectInfo) {
      body.innerHTML = '';
      const section = createToolSection('Publicar no GitHub', 'Conecte a conta local, revise o plano e envie quando estiver pronto.');
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
      repoText.textContent = 'Nome do repositório';
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
      visibilityText.textContent = 'Visibilidade';
      const visibility = createGithubVisibilityControl('private');
      visibilityLabel.append(visibilityText, visibility.element);

      const resultBox = document.createElement('div');
      resultBox.className = 'right-tool-github-result hidden';

      const review = createToolButton('Revisar plano', 'right-tool-action--primary');
      review.addEventListener('click', async () => {
        review.disabled = true;
        resultBox.classList.remove('hidden');
        resultBox.innerHTML = '';
        renderToolLoading(resultBox, 'Verificando GitHub...');
        const publishOptions = {
          repoName: repoInput.value || defaultRepoName,
          visibility: visibility.getValue(),
        };
        updateStatus('Preparando plano GitHub...');
        const planResult = await api.getGithubPublishPlan({
          rootPath: projectInfo.rootPath,
          options: publishOptions,
        });
        review.disabled = false;

        if (!planResult || !planResult.ok || !planResult.plan) {
          const message = (planResult && planResult.message) || 'Falha ao planejar publicação GitHub.';
          resultBox.innerHTML = '';
          resultBox.className = 'right-tool-github-result right-tool-github-result--blocked';
          const strong = document.createElement('strong');
          strong.textContent = 'Plano indisponível';
          const copy = document.createElement('p');
          copy.textContent = message;
          resultBox.append(strong, copy);
          appendTransientAssistantMessage(message);
          updateStatus('GitHub: plano indisponível');
          return;
        }

        renderGithubPlanBox(resultBox, planResult.plan, publishOptions, projectInfo);
        updateStatus(planResult.plan.ready ? 'GitHub: plano pronto' : 'GitHub: pendências encontradas');
      });

      form.append(repoLabel, visibilityLabel, review, resultBox);
      section.append(status, form);
      body.appendChild(section);
    }

    async function runGithubPublishWizard() {
      const projectInfo = getSelectedProjectInfo();
      if (!projectInfo || !projectInfo.rootPath) {
        appendTransientAssistantMessage('Selecione um projeto antes de configurar GitHub.');
        return;
      }
      if (!api.getGithubPublishPlan || !api.publishProjectToGithub) {
        appendTransientAssistantMessage('A integração GitHub ainda não está disponível neste build.');
        return;
      }
      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const body = openToolSurface('GitHub', 'Conta, repositório e envio com revisão local.', 'github');
        renderToolLoading(body, 'Verificando conta GitHub...');
        await renderGithubPublishWizardBody(body, projectInfo);
        return;
      }

      const defaultRepoName = inferGithubRepoNameFromProject(
        getProjects(),
        getSelectedProjectId(),
        projectInfo
      );
      const repoNameInput = await requestTextInput({
        title: 'Nome do repositório GitHub',
        initialValue: defaultRepoName,
        placeholder: defaultRepoName,
      });
      if (repoNameInput === null) return;

      const visibilityInput = await requestTextInput({
        title: 'Visibilidade do repositório',
        initialValue: 'private',
        placeholder: 'private ou public',
      });
      if (visibilityInput === null) return;

      const publishOptions = {
        repoName: repoNameInput || defaultRepoName,
        visibility: /^public$/i.test(String(visibilityInput || '').trim()) ? 'public' : 'private',
      };

      updateStatus('Preparando plano GitHub...');
      const planResult = await api.getGithubPublishPlan({
        rootPath: projectInfo.rootPath,
        options: publishOptions,
      });

      if (!planResult || !planResult.ok || !planResult.plan) {
        appendTransientAssistantMessage((planResult && planResult.message) || 'Falha ao planejar publicação GitHub.');
        updateStatus('GitHub: plano indisponível');
        return;
      }

      appendTransientAssistantMessage(formatGithubPublishPlan(planResult.plan));
      if (!planResult.plan.ready) {
        updateStatus('GitHub: pendências encontradas');
        return;
      }

      const confirmed = await confirmAction(
        `Publicar este projeto no GitHub como ${planResult.plan.repoFullName || publishOptions.repoName}?`
      );
      if (!confirmed) {
        updateStatus('Publicação GitHub cancelada');
        return;
      }

      updateStatus('Publicando no GitHub...');
      const publishResult = await api.publishProjectToGithub({
        rootPath: projectInfo.rootPath,
        options: publishOptions,
      });

      if (!publishResult || !publishResult.ok) {
        appendTransientAssistantMessage((publishResult && publishResult.message) || 'Falha ao publicar no GitHub.');
        updateStatus('GitHub: falha na publicação');
        return;
      }

      const repoUrl = publishResult.report && publishResult.report.repoUrl ? publishResult.report.repoUrl : '';
      appendTransientAssistantMessage(repoUrl ? `Projeto publicado no GitHub: ${repoUrl}` : 'Projeto publicado no GitHub.');
      updateStatus('GitHub publicado');
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
      const section = createToolSection('Executar projeto', 'Acompanhe a preparação da visualização local.');
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
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        await runPreviewStart();
        return;
      }
      const body = openToolSurface('Executar', 'Rodar e abrir a visualização local do projeto.', 'run');
      const projectInfo = getProjectRootOrNotify(body);
      if (!projectInfo) return;
      renderPreviewToolProgress(body, 18, 'planejando preview');
      await new Promise((resolve) => setTimeout(resolve, 120));
      renderPreviewToolProgress(body, 46, 'preparando terminal ou servidor local');
      await new Promise((resolve) => setTimeout(resolve, 120));
      renderPreviewToolProgress(body, 72, 'iniciando execução');
      await runPreviewStart();
      renderPreviewToolProgress(body, 100, 'visualização solicitada');
    }

    async function runPreviewStart() {
      const projectInfo = getSelectedProjectInfo();
      if (!projectInfo || !projectInfo.rootPath) {
        appendTransientAssistantMessage('Selecione um projeto antes de executar localmente.');
        return;
      }
      if (!api.startProjectPreview) {
        appendTransientAssistantMessage('Execução local ainda não está disponível neste build.');
        return;
      }

      const terminalStarted = await startPreviewInTerminal(projectInfo);
      if (terminalStarted) return;

      updateStatus('Executando projeto local...');
      const result = await api.startProjectPreview({
        rootPath: projectInfo.rootPath,
        open: true,
        options: {
          autoInstallDependencies: true,
        },
      });

      if (!result || !result.ok || !result.session) {
        appendTransientAssistantMessage(formatPreviewStartFailure(result || null));
        updateStatus('Execução bloqueada');
        return;
      }

      const installNote = result.install && result.install.ok
        ? ' Dependências instaladas automaticamente antes da execução.'
        : '';
      const target = result.session.url || result.session.commandText || 'processo local iniciado';
      appendTransientAssistantMessage(`Execução local ativa: ${target}.${installNote}`);
      updateStatus('Execução local ativa');
    }

    async function startPreviewInTerminal(projectInfo) {
      if (
        !terminalController ||
        typeof terminalController.runProjectCommand !== 'function' ||
        !api.getProjectPreviewPlan ||
        !api.startProjectPreview
      ) {
        return false;
      }

      updateStatus('Planejando execução local...');
      const planResult = await api.getProjectPreviewPlan({
        rootPath: projectInfo.rootPath,
      });
      const plan = planResult && planResult.plan ? planResult.plan : null;
      if (!planResult || !planResult.ok || !plan || plan.mode === 'file') {
        return false;
      }

      const command = buildTerminalPreviewCommand(plan);
      if (!command) {
        appendTransientAssistantMessage(formatPreviewStartFailure({
          message: 'Execução local bloqueada antes de abrir o terminal.',
          plan,
        }));
        updateStatus('Execução bloqueada');
        return true;
      }

      updateStatus('Executando no terminal interno...');
      const terminalResult = await terminalController.runProjectCommand(command, {
        createNewTabIfRunning: true,
      });
      if (!terminalResult || !terminalResult.ok) {
        appendTransientAssistantMessage((terminalResult && terminalResult.message) || 'Não consegui iniciar o comando no terminal interno.');
        updateStatus('Execução bloqueada');
        return true;
      }

      if (plan.mode !== 'server') {
        appendTransientAssistantMessage(`Execução local iniciada no terminal interno: ${command}.`);
        updateStatus('Execução local ativa');
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
        updateStatus('Execução bloqueada');
        return true;
      }

      const target = result.session.url || plan.url || 'servidor local iniciado';
      appendTransientAssistantMessage(`Execução local ativa no terminal interno: ${target}.`);
      updateStatus('Execução local ativa');
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
