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
      lines.push('O login aberto no navegador não autoriza publicações locais sozinho.');
      lines.push('Próximo passo: instale com `brew install gh`, depois rode `gh auth login --hostname github.com --web` e volte a clicar em Git.');
    } else if (plan.auth && plan.auth.authenticated === false) {
      lines.push('O GitHub CLI (`gh`) está instalado, mas ainda não está autenticado no github.com.');
      lines.push('O login aberto no navegador não autoriza publicações locais sozinho.');
      lines.push('Próximo passo: rode `gh auth login --hostname github.com --web`, faça login pelo navegador e depois clique em Git novamente.');
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

  function getGithubAuthCommand(auth = {}) {
    if (auth && auth.ghInstalled === false) return 'brew install gh';
    if (auth && auth.authenticated === false) return 'gh auth login --hostname github.com --web';
    return '';
  }

  function formatGithubAuthGuidance(auth = {}) {
    if (!auth || auth.ok === false) {
      return {
        tone: 'warning',
        title: 'Não consegui verificar a conta GitHub',
        message: 'Verifique a conexão local e tente novamente antes de publicar.',
        command: '',
      };
    }
    if (auth.ghInstalled === false) {
      return {
        tone: 'blocked',
        title: 'Instale o GitHub CLI',
        message: 'O Faber Code usa o GitHub CLI local para publicar com segurança. O login do navegador não basta para dar permissão ao app.',
        command: getGithubAuthCommand(auth),
      };
    }
    if (auth.authenticated === false) {
      return {
        tone: 'blocked',
        title: 'Conecte a conta no terminal',
        message: 'O navegador pode estar logado, mas o envio local precisa de uma sessão do GitHub CLI neste Mac.',
        command: getGithubAuthCommand(auth),
      };
    }
    return {
      tone: 'ready',
      title: auth.username ? `Conta conectada como @${auth.username}` : 'Conta GitHub conectada',
      message: 'Pronto para revisar repositório, commit e envio antes de publicar.',
      command: '',
    };
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

  function formatGitEntryStatus(entry = {}) {
    if (entry.status === 'untracked') return 'novo';
    if (entry.status === 'staged') return 'stage';
    if (entry.status === 'mixed') return 'stage + editado';
    return 'editado';
  }

  function compactDiffLine(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > 150 ? `${text.slice(0, 147)}...` : text;
  }

  function buildGitWorktreeViewModel(worktree = {}) {
    const entries = Array.isArray(worktree.entries) ? worktree.entries : [];
    const untrackedEntries = entries.filter((entry) => entry && entry.unstaged && entry.status === 'untracked');
    const modifiedEntries = entries.filter((entry) => entry && entry.unstaged && entry.status !== 'untracked');
    const stagedEntries = entries.filter((entry) => entry && entry.staged);
    const totalAdd = entries.reduce((sum, entry) => sum + (Number(entry.add) || 0), 0);
    const totalDel = entries.reduce((sum, entry) => sum + (Number(entry.del) || 0), 0);
    const latest = worktree.latest || {};
    const hasCommit = Boolean(latest.hash || latest.subject);
    const activeStep = !worktree.isGitRepo
      ? 'repo'
      : untrackedEntries.length
        ? 'untracked'
        : modifiedEntries.length
          ? 'modified'
          : stagedEntries.length
            ? 'staged'
            : hasCommit
              ? 'deploy'
              : 'committed';

    return {
      activeStep,
      entries,
      hasCommit,
      latest,
      modifiedEntries,
      stagedEntries,
      totalAdd,
      totalDel,
      untrackedEntries,
    };
  }

  window.FaberProjectToolsSupport = {
    buildGitWorktreeViewModel,
    buildTerminalPreviewCommand,
    compactDiffLine,
    formatGitEntryStatus,
    formatGithubAuthGuidance,
    formatGithubPublishPlan,
    formatPreviewStartFailure,
    getGithubAuthCommand,
    inferGithubRepoNameFromProject,
  };
})();
