(function () {
  function inferGithubRepoNameFromProject(projects = [], selectedProjectId = null, selectedProjectInfo = null) {
    const selected = (Array.isArray(projects) ? projects : []).find((project) => project && project.id === selectedProjectId);
    const fromName = selected && selected.name ? String(selected.name).trim() : '';
    if (fromName) return fromName.replace(/\s+/g, '-');

    const rootPath = selectedProjectInfo && selectedProjectInfo.rootPath
      ? String(selectedProjectInfo.rootPath)
      : '';
    const parts = rootPath.split(/[\\/]+/).filter(Boolean);
    return parts[parts.length - 1] || 'faber-code-project';
  }

  function formatGithubPublishPlan(plan) {
    if (!plan) return 'Não consegui montar o plano GitHub.';
    const blockers = Array.isArray(plan.blockers) ? plan.blockers : [];
    const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
    const actions = Array.isArray(plan.actions) ? plan.actions : [];
    const lines = [
      `Plano de publicação GitHub para ${plan.repoFullName || plan.repoName || 'repositório'} (${plan.visibility || 'private'}).`,
      `Branch prevista: ${plan.branch || 'main'}.`,
    ];

    if (plan.auth && plan.auth.ghInstalled === false) {
      lines.push('Ainda não encontrei o GitHub CLI (`gh`) neste Mac.');
      lines.push('Próximo passo: instale com `brew install gh`, depois rode `gh auth login` e volte a clicar em Git.');
    } else if (plan.auth && plan.auth.authenticated === false) {
      lines.push('O GitHub CLI (`gh`) está instalado, mas ainda não está autenticado no github.com.');
      lines.push('Próximo passo: rode `gh auth login`, escolha GitHub.com, faça login pelo navegador e depois clique em Git novamente.');
    }

    if (warnings.length) {
      lines.push(`Avisos: ${warnings.join(' ')}`);
    }
    if (blockers.length) {
      lines.push(`Bloqueios: ${blockers.join(' ')}`);
    }
    if (actions.length) {
      lines.push(`Ações previstas: ${actions.map((entry) => entry.label || entry.id).join(' > ')}.`);
    }
    if (!plan.ready) {
      lines.push('Nada foi publicado ainda. Resolva os bloqueios acima para eu conseguir criar o commit e enviar o repositório.');
    } else {
      lines.push('Tudo pronto para publicar. Ao confirmar, vou preparar os arquivos, criar o commit e enviar para o GitHub.');
    }
    return lines.join('\n');
  }

  function formatPreviewStartFailure(result) {
    const plan = result && result.plan ? result.plan : null;
    const warnings = plan && Array.isArray(plan.warnings) ? plan.warnings : [];
    const blockers = plan && Array.isArray(plan.blockers) ? plan.blockers : [];
    const steps = plan && Array.isArray(plan.steps) ? plan.steps : [];
    const blockedSteps = steps.filter((step) => step && step.status === 'blocked');
    const manualSteps = steps.filter((step) => step && step.status === 'manual');
    const lines = [(result && result.message) || 'Execução local bloqueada.'];
    if (warnings.length) lines.push(`Avisos: ${warnings.join(' ')}`);
    if (blockers.length) lines.push(`Bloqueios: ${blockers.join(' ')}`);
    if (manualSteps.length) {
      lines.push(`Etapas manuais: ${manualSteps.map((step) => step.commandText || step.label).join(', ')}`);
    }
    if (blockedSteps.length) {
      lines.push(`Etapas bloqueadas: ${blockedSteps.map((step) => step.label || step.id).join(', ')}`);
    }
    if (result && result.session && (result.session.stderr || result.session.stdout)) {
      const output = String(result.session.stderr || result.session.stdout || '').trim();
      if (output) lines.push(`Saída do servidor: ${output.slice(-900)}`);
    }
    return lines.join('\n');
  }

  function hasMissingDevScriptWarning(plan) {
    const warnings = plan && Array.isArray(plan.warnings) ? plan.warnings.join(' ') : '';
    return /script `dev` ausente/i.test(warnings);
  }

  function findDependencyInstallCommand(plan) {
    const steps = plan && Array.isArray(plan.steps) ? plan.steps : [];
    const dependencyStep = steps.find((step) => {
      return step && step.id === 'preview_dependencies' && step.status === 'manual' && step.commandText;
    });
    return dependencyStep && dependencyStep.commandText ? String(dependencyStep.commandText).trim() : '';
  }

  function buildTerminalPreviewCommand(plan) {
    if (!plan || hasMissingDevScriptWarning(plan)) return '';
    const commandText = String(plan.commandText || '').trim();
    if (!commandText) return '';
    const dependencyCommand = findDependencyInstallCommand(plan);
    return dependencyCommand ? `${dependencyCommand} && ${commandText}` : commandText;
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
    const updateStatus = typeof options.updateStatus === 'function' ? options.updateStatus : () => {};
    const confirmAction = typeof options.confirmAction === 'function'
      ? options.confirmAction
      : (message) => window.confirm(message);

    function appendTransientAssistantMessage(text) {
      appendMessage('assistant', text, { persistToConversation: false });
    }

    async function publishToGithub() {
      const projectInfo = getSelectedProjectInfo();
      if (!projectInfo || !projectInfo.rootPath) {
        appendTransientAssistantMessage('Selecione um projeto antes de configurar GitHub.');
        return;
      }
      if (!api.getGithubPublishPlan || !api.publishProjectToGithub) {
        appendTransientAssistantMessage('A integração GitHub ainda não está disponível neste build.');
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

      const confirmed = confirmAction(
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

    async function startPreview() {
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
    inferGithubRepoNameFromProject,
  };
})();
