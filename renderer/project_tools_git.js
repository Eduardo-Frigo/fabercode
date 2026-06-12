(function () {
  const projectToolsSupport = window.FaberProjectToolsSupport;
  if (!projectToolsSupport) {
    throw new Error('Renderer incompleto: FaberProjectToolsSupport ausente para Git.');
  }
  const projectToolsGithubDeploy = window.FaberProjectToolsGithubDeploy;
  if (!projectToolsGithubDeploy) {
    throw new Error('Renderer incompleto: FaberProjectToolsGithubDeploy ausente.');
  }

  const {
    buildGitWorktreeViewModel,
    formatGitEntryStatus,
  } = projectToolsSupport;
  const { createProjectGithubDeployTool } = projectToolsGithubDeploy;

  function createDiffPills(entry = {}) {
    const wrap = document.createElement('span');
    wrap.className = 'right-tool-diff-pills';
    const add = Number(entry.add || 0);
    const del = Number(entry.del || 0);
    if (add > 0) {
      const addEl = document.createElement('span');
      addEl.className = 'project-tree-diff-add';
      addEl.textContent = `+${add}`;
      wrap.appendChild(addEl);
    }
    if (del > 0) {
      const delEl = document.createElement('span');
      delEl.className = 'project-tree-diff-del';
      delEl.textContent = `-${del}`;
      wrap.appendChild(delEl);
    }
    return wrap;
  }

  function createGitCompactFileRow(entry, options = {}, deps = {}) {
    const selectable = Boolean(options.selectable);
    const row = document.createElement(selectable ? 'label' : 'div');
    row.className = ['right-tool-git-file-chip', selectable ? 'right-tool-git-file-chip--selectable' : '']
      .filter(Boolean)
      .join(' ');

    if (selectable) {
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = options.checked !== false;
      check.dataset.file = entry.path || '';
      row.appendChild(check);
    } else {
      const dot = document.createElement('span');
      dot.className = 'right-tool-git-file-chip__dot';
      dot.textContent = '•';
      row.appendChild(dot);
    }

    const body = document.createElement('span');
    body.className = 'right-tool-git-file-chip__body';
    const fileButton = document.createElement('button');
    fileButton.type = 'button';
    fileButton.className = 'right-tool-file-link';
    fileButton.textContent = entry.path || 'arquivo';
    fileButton.title = `Abrir ${entry.path || 'arquivo'} na linha ${entry.firstLine || 1}`;
    fileButton.addEventListener('click', async (event) => {
      event.preventDefault();
      if (typeof deps.openFile === 'function') {
        await deps.openFile(entry.path || '', { line: Math.max(1, Number(entry.firstLine || 1) || 1) });
      }
    });

    const meta = document.createElement('span');
    meta.className = 'right-tool-git-file-chip__meta';
    meta.textContent = `${formatGitEntryStatus(entry)} · linha ${Math.max(1, Number(entry.firstLine || 1) || 1)}`;
    meta.appendChild(createDiffPills(entry));
    body.append(fileButton, meta);
    if (entry.binary && entry.summary) {
      const summary = document.createElement('span');
      summary.className = 'right-tool-git-file-chip__summary';
      summary.textContent = entry.summary;
      body.appendChild(summary);
    }
    row.appendChild(body);
    return row;
  }

  function createGitCompactFileList(entries, options = {}, deps = {}) {
    const list = document.createElement('div');
    list.className = 'right-tool-git-file-list';
    entries.forEach((entry) => {
      list.appendChild(createGitCompactFileRow(entry, options, deps));
    });
    return list;
  }

  function getCheckedGitFiles(list) {
    return Array.from(list.querySelectorAll('input[type="checkbox"]:checked'))
      .map((input) => input.dataset.file)
      .filter(Boolean);
  }

  function createGitSelectionControls(list, actionButton, noun = 'arquivo', deps = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'right-tool-git-selection';
    const summary = document.createElement('span');
    summary.className = 'right-tool-selection-summary';
    const selectAll = deps.createToolButton('Selecionar tudo');
    const clear = deps.createToolButton('Limpar seleção');

    const update = () => {
      const selected = getCheckedGitFiles(list).length;
      const total = list.querySelectorAll('input[type="checkbox"]').length;
      summary.textContent = `${selected}/${total} ${noun}${total === 1 ? '' : 's'} selecionado${selected === 1 ? '' : 's'}`;
      if (actionButton) actionButton.disabled = selected === 0;
    };

    selectAll.addEventListener('click', () => {
      list.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = true; });
      update();
    });
    clear.addEventListener('click', () => {
      list.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = false; });
      update();
    });
    list.addEventListener('change', update);
    update();
    wrap.append(summary, selectAll, clear);
    return wrap;
  }

  function createToolIconMark(kind = 'git') {
    const mark = document.createElement('span');
    mark.className = `right-tool-icon-mark right-tool-icon-mark--${kind}`;
    if (kind === 'github') {
      mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-1.9c-3.13.68-3.79-1.35-3.79-1.35-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 .1 1.63.74 2.2 1.1.18-.73.55-1.23 1-1.51-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.1-2.98 0 0 .94-.3 3.08 1.15a10.6 10.6 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.6 1.55.22 2.7.1 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.63 5.27-5.14 5.55.57.49 1.08 1.45 1.08 2.93v2.44c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z"></path></svg>';
    } else {
      mark.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.9 2.75a1.55 1.55 0 0 1 2.2 0l8.15 8.15a1.55 1.55 0 0 1 0 2.2l-8.15 8.15a1.55 1.55 0 0 1-2.2 0L2.75 13.1a1.55 1.55 0 0 1 0-2.2l8.15-8.15Z" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round"/><path d="M8.35 7.85v5.45m0 0a1.45 1.45 0 1 0 0 2.9 1.45 1.45 0 0 0 0-2.9Zm0-5.45a1.45 1.45 0 1 0 0-2.9 1.45 1.45 0 0 0 0 2.9Zm0 0 5.45 5.45m0 0a1.45 1.45 0 1 0 2.05 0 1.45 1.45 0 0 0-2.05 0Z" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    return mark;
  }

  function appendGitStepEmpty(content, text) {
    const empty = document.createElement('p');
    empty.className = 'right-tool-empty';
    empty.textContent = text;
    content.appendChild(empty);
    return empty;
  }

  function createProjectGitTool(options = {}) {
    const api = options.api || {};
    const createToolButton = options.createToolButton;
    const createToolSection = options.createToolSection;
    const openToolSurface = options.openToolSurface;
    const renderToolLoading = options.renderToolLoading;
    const getProjectRootOrNotify = options.getProjectRootOrNotify;
    const createGithubCommandPanel = options.createGithubCommandPanel;
    const runGithubPublishWizard = options.runGithubPublishWizard;
    const openFile = options.openFile;
    const appendTransientAssistantMessage = options.appendTransientAssistantMessage || (() => {});
    const updateStatus = options.updateStatus || (() => {});
    const refreshFileTree = options.refreshFileTree || (async () => {});
    const refreshProjects = options.refreshProjects || (async () => {});
    const selectProject = options.selectProject || (async () => {});
    const confirmAction = options.confirmAction || (() => true);
    const normalizeGithubAuthStatus = options.normalizeGithubAuthStatus || ((result) => result);
    let openGitStepKey = null;

    const deps = {
      createToolButton,
      openFile,
    };
    const githubDeployTool = createProjectGithubDeployTool({
      api,
      appendGitStepEmpty,
      appendTransientAssistantMessage,
      confirmAction,
      createGithubCommandPanel,
      createToolButton,
      refreshProjects,
      renderToolLoading,
      runGithubPublishWizard,
      selectProject,
      updateStatus,
    });

    function createGitStepCard(number, title, subtitle = '', state = 'idle', icon = null, stepOptions = {}) {
      const key = stepOptions.key || String(title || number).toLowerCase();
      const section = document.createElement('section');
      section.className = `right-tool-git-step right-tool-git-step--${state} right-tool-git-step--collapsed`;
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'right-tool-git-step__head';
      head.setAttribute('aria-expanded', 'false');
      const badge = document.createElement('span');
      badge.className = 'right-tool-git-step__badge';
      badge.textContent = String(number);
      const copy = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = title;
      const span = document.createElement('span');
      span.textContent = subtitle;
      copy.append(strong, span);
      head.append(badge, copy);
      const end = document.createElement('span');
      end.className = 'right-tool-git-step__end';
      if (icon) end.appendChild(icon);
      const toggle = document.createElement('span');
      toggle.className = 'right-tool-git-step__toggle';
      toggle.setAttribute('aria-hidden', 'true');
      toggle.textContent = '+';
      end.appendChild(toggle);
      head.appendChild(end);
      const content = document.createElement('div');
      content.className = 'right-tool-git-step__content';
      content.hidden = true;
      const setExpanded = (expanded) => {
        section.classList.toggle('right-tool-git-step--collapsed', !expanded);
        section.classList.toggle('right-tool-git-step--expanded', expanded);
        content.hidden = !expanded;
        head.setAttribute('aria-expanded', String(expanded));
        toggle.textContent = expanded ? '-' : '+';
      };
      section.__setGitStepExpanded = setExpanded;
      head.addEventListener('click', () => {
        const nextExpanded = content.hidden;
        if (nextExpanded && section.parentElement) {
          section.parentElement.querySelectorAll('.right-tool-git-step').forEach((entry) => {
            if (entry !== section && typeof entry.__setGitStepExpanded === 'function') {
              entry.__setGitStepExpanded(false);
            }
          });
        }
        openGitStepKey = nextExpanded ? key : null;
        setExpanded(nextExpanded);
      });
      section.append(head, content);
      if (openGitStepKey === key) setExpanded(true);
      return { section, content };
    }

    async function renderGitTool(renderOptions = {}) {
      if (renderOptions.resetOpenStep === true) openGitStepKey = null;
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        await runGithubPublishWizard();
        return;
      }
      const body = openToolSurface('Git', 'Untracked, Modified, Staged, Committed e Deploy.', 'git');
      renderToolLoading(body, 'Lendo repositório...');
      const projectInfo = getProjectRootOrNotify(body);
      if (!projectInfo) return;
      if (!api.getProjectGitWorktree && !api.getProjectGitStatus) {
        body.innerHTML = '';
        body.appendChild(createToolSection('Git indisponível', 'Este build ainda não expõe as ações Git.'));
        return;
      }

      const worktree = api.getProjectGitWorktree
        ? await api.getProjectGitWorktree({ rootPath: projectInfo.rootPath })
        : await api.getProjectGitStatus({ rootPath: projectInfo.rootPath });
      const authResult = api.getGithubAuthStatus ? await api.getGithubAuthStatus() : null;
      const auth = normalizeGithubAuthStatus(authResult) || { ok: false };
      body.innerHTML = '';

      if (!worktree || !worktree.ok) {
        body.appendChild(createToolSection('Não consegui ler o Git', (worktree && worktree.message) || 'Tente novamente.'));
        return;
      }

      const {
        activeStep,
        entries,
        hasCommit,
        latest,
        modifiedEntries,
        stagedEntries,
        totalAdd,
        totalDel,
        untrackedEntries,
      } = buildGitWorktreeViewModel(worktree);

      const summary = document.createElement('div');
      summary.className = 'right-tool-git-summary right-tool-git-summary--clean';
      const branch = document.createElement('strong');
      branch.textContent = worktree.isGitRepo
        ? worktree.branch ? `branch ${worktree.branch}` : 'repositório local'
        : 'Git ainda não ativo';
      const counts = document.createElement('div');
      counts.className = 'right-tool-git-counts';
      [
        ['Untracked', untrackedEntries.length],
        ['Modified', modifiedEntries.length],
        ['Staged', stagedEntries.length],
      ].forEach(([label, value]) => {
        const chip = document.createElement('span');
        chip.className = 'right-tool-git-count';
        chip.textContent = `${label}: ${value}`;
        counts.appendChild(chip);
      });
      summary.append(createToolIconMark('git'), branch, counts, createDiffPills({ add: totalAdd, del: totalDel }));
      body.appendChild(summary);

      if (!worktree.isGitRepo) {
        const setup = createGitStepCard(
          '1',
          'Repositório local',
          'Crie o histórico local antes de stage, commit e deploy.',
          'active',
          createToolIconMark('git'),
          { key: 'repo' }
        );
        appendGitStepEmpty(setup.content, 'Nada será publicado agora. Esta ação só ativa Git dentro da pasta do projeto.');
        const actionRow = document.createElement('div');
        actionRow.className = 'right-tool-actions-row';
        const action = createToolButton('Criar repositório local', 'right-tool-action--primary');
        action.addEventListener('click', async () => {
          action.disabled = true;
          updateStatus('Ativando repositório Git local...');
          const result = api.initProjectGitRepository
            ? await api.initProjectGitRepository({ rootPath: projectInfo.rootPath })
            : { ok: false, message: 'Ação Git init indisponível.' };
          if (!result || !result.ok) {
            action.disabled = false;
            appendTransientAssistantMessage((result && result.message) || 'Não consegui ativar Git neste projeto.');
            return;
          }
          updateStatus('Repositório Git local ativo');
          await renderGitTool();
          await refreshFileTree();
        });
        actionRow.appendChild(action);
        setup.content.appendChild(actionRow);
        body.appendChild(setup.section);
        return;
      }

      const flow = document.createElement('div');
      flow.className = 'right-tool-git-flow right-tool-git-flow--clean';
      body.appendChild(flow);

      const renderStageableStep = (stepId, title, files, emptyText) => {
        const step = createGitStepCard(
          stepId,
          title,
          files.length ? `${files.length} ${files.length === 1 ? 'arquivo encontrado' : 'arquivos encontrados'}.` : emptyText,
          activeStep === title.toLowerCase() ? 'active' : files.length ? 'idle' : 'done',
          null,
          { key: title.toLowerCase() }
        );
        if (!files.length) {
          appendGitStepEmpty(step.content, emptyText);
          return step;
        }
        const list = createGitCompactFileList(files, { selectable: true, checked: false }, deps);
        const actionRow = document.createElement('div');
        actionRow.className = 'right-tool-actions-row';
        const stage = createToolButton('Enviar selecionados para Staged', 'right-tool-action--primary');
        stage.addEventListener('click', async () => {
          const selectedFiles = getCheckedGitFiles(list);
          if (!selectedFiles.length) {
            appendTransientAssistantMessage('Escolha ao menos um arquivo antes de enviar para Staged.');
            return;
          }
          stage.disabled = true;
          updateStatus('Adicionando arquivos ao stage...');
          const result = api.stageProjectGitFiles
            ? await api.stageProjectGitFiles({ rootPath: projectInfo.rootPath, files: selectedFiles })
            : { ok: false, message: 'Stage indisponível neste build.' };
          if (!result || !result.ok) {
            stage.disabled = false;
            appendTransientAssistantMessage((result && result.message) || 'Não consegui stagear os arquivos.');
            return;
          }
          updateStatus('Arquivos em Staged');
          openGitStepKey = 'staged';
          await renderGitTool();
          await refreshFileTree();
        });
        const selection = createGitSelectionControls(list, stage, 'arquivo', deps);
        actionRow.appendChild(stage);
        step.content.append(selection, list, actionRow);
        return step;
      };

      const untrackedStep = renderStageableStep(
        '1',
        'Untracked',
        untrackedEntries,
        'Nenhum arquivo novo fora do Git.'
      );
      flow.appendChild(untrackedStep.section);

      const modifiedStep = renderStageableStep(
        '2',
        'Modified',
        modifiedEntries,
        'Nenhum arquivo modificado fora do stage.'
      );
      flow.appendChild(modifiedStep.section);

      const stagedStep = createGitStepCard(
        '3',
        'Staged',
        stagedEntries.length
          ? `${stagedEntries.length} ${stagedEntries.length === 1 ? 'arquivo pronto' : 'arquivos prontos'} para commit.`
          : 'Nada em Staged para commit.',
        activeStep === 'staged' ? 'active' : stagedEntries.length ? 'idle' : 'locked',
        null,
        { key: 'staged' }
      );
      if (!stagedEntries.length) {
        appendGitStepEmpty(stagedStep.content, entries.length ? 'Selecione arquivos em Untracked ou Modified antes do commit.' : 'Sem mudanças locais agora.');
      } else {
        const list = createGitCompactFileList(stagedEntries, { selectable: true, checked: false }, deps);
        const selectionHelp = document.createElement('p');
        selectionHelp.className = 'right-tool-empty';
        selectionHelp.textContent = 'Só os arquivos marcados entram no próximo commit. Os demais ficam fora desta passagem.';
        const message = document.createElement('input');
        message.type = 'text';
        message.className = 'right-tool-input';
        message.placeholder = 'Mensagem do commit';
        const actionRow = document.createElement('div');
        actionRow.className = 'right-tool-actions-row';
        const commit = createToolButton('Criar commit com selecionados', 'right-tool-action--primary');
        commit.addEventListener('click', async () => {
          const selectedFiles = getCheckedGitFiles(list);
          if (!selectedFiles.length) {
            appendTransientAssistantMessage('Escolha ao menos um arquivo em Staged para criar o commit.');
            return;
          }
          commit.disabled = true;
          updateStatus('Criando commit local...');
          const result = api.commitProjectGitFiles
            ? await api.commitProjectGitFiles({ rootPath: projectInfo.rootPath, message: message.value, files: selectedFiles })
            : { ok: false, message: 'Commit indisponível neste build.' };
          if (!result || !result.ok) {
            commit.disabled = false;
            appendTransientAssistantMessage((result && result.message) || 'Não consegui criar o commit.');
            return;
          }
          updateStatus('Commit local criado');
          openGitStepKey = 'committed';
          await renderGitTool();
          await refreshFileTree();
        });
        const selection = createGitSelectionControls(list, commit, 'arquivo', deps);
        actionRow.appendChild(commit);
        stagedStep.content.append(selectionHelp, selection, list, message, actionRow);
      }
      flow.appendChild(stagedStep.section);

      const committedStep = createGitStepCard(
        '4',
        'Committed',
        hasCommit ? 'Último commit local pronto para publicação.' : 'Nenhum commit local ainda.',
        activeStep === 'committed' ? 'active' : hasCommit ? 'done' : 'locked',
        null,
        { key: 'committed' }
      );
      if (!hasCommit) {
        appendGitStepEmpty(committedStep.content, 'Crie um commit em Staged para liberar publicação e deploy.');
      } else {
        const commitSummary = document.createElement('div');
        commitSummary.className = 'right-tool-commit-summary';
        const title = document.createElement('strong');
        title.textContent = latest.subject || 'Commit local';
        const meta = document.createElement('span');
        const hash = latest.hash ? latest.hash.slice(0, 7) : '';
        meta.textContent = [hash, latest.relative].filter(Boolean).join(' · ') || 'commit local';
        commitSummary.append(title, meta);
        committedStep.content.appendChild(commitSummary);
        if (worktree.latestUrl && api.openProjectLatestVersion) {
          const actionRow = document.createElement('div');
          actionRow.className = 'right-tool-actions-row';
          const openLatest = createToolButton('Abrir commit');
          openLatest.addEventListener('click', async () => {
            await api.openProjectLatestVersion({ rootPath: projectInfo.rootPath });
          });
          actionRow.appendChild(openLatest);
          committedStep.content.appendChild(actionRow);
        }
      }
      flow.appendChild(committedStep.section);

      const deployStep = githubDeployTool.createDeployStep({
        activeStep,
        auth,
        createGitStepCard,
        createToolIconMark,
        hasCommit,
        projectInfo,
        renderGitTool,
        worktree,
      });
      flow.appendChild(deployStep.section);
    }

    return {
      renderGitTool,
      resetOpenStep: () => {
        openGitStepKey = null;
      },
    };
  }

  window.FaberProjectToolsGit = {
    createProjectGitTool,
  };
})();
