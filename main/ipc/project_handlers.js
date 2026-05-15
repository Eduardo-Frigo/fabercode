function registerProjectHandlers(dependencies = {}) {
  const {
    appendAuditEvent,
    authorizeProjectRoot,
    buildNextSteps,
    buildProjectPreviewPlan,
    buildProjectVerificationPlan,
    collectGitDiffStats,
    collectProjectFilesTree,
    dialog,
    getProjectGitStatus,
    getRuntimeDiffStats,
    mergeDiffStatsEntry,
    normalizeExternalUrl,
    normalizeProjectRecord,
    path,
    readProjectsByState,
    readProjectsSnapshot,
    registerIpcHandler,
    removeProjectConversationHistory,
    runProjectVerification,
    scanProject,
    shell,
    writeProjectsSnapshot,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Project IPC dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('appendAuditEvent', appendAuditEvent);
    requireDependency('authorizeProjectRoot', authorizeProjectRoot);
    requireDependency('buildNextSteps', buildNextSteps);
    requireDependency('buildProjectPreviewPlan', buildProjectPreviewPlan);
    requireDependency('buildProjectVerificationPlan', buildProjectVerificationPlan);
    requireDependency('collectGitDiffStats', collectGitDiffStats);
    requireDependency('collectProjectFilesTree', collectProjectFilesTree);
    requireDependency('dialog', dialog);
    requireDependency('getProjectGitStatus', getProjectGitStatus);
    requireDependency('getRuntimeDiffStats', getRuntimeDiffStats);
    requireDependency('mergeDiffStatsEntry', mergeDiffStatsEntry);
    requireDependency('normalizeExternalUrl', normalizeExternalUrl);
    requireDependency('normalizeProjectRecord', normalizeProjectRecord);
    requireDependency('path', path);
    requireDependency('readProjectsByState', readProjectsByState);
    requireDependency('readProjectsSnapshot', readProjectsSnapshot);
    requireDependency('registerIpcHandler', registerIpcHandler);
    requireDependency('removeProjectConversationHistory', removeProjectConversationHistory);
    requireDependency('runProjectVerification', runProjectVerification);
    requireDependency('scanProject', scanProject);
    requireDependency('shell', shell);
    requireDependency('writeProjectsSnapshot', writeProjectsSnapshot);
  }

  assertReady();

  registerIpcHandler('projects:list', () => {
    return readProjectsByState('active');
  });

  registerIpcHandler('projects:add', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Selecione a pasta do projeto',
    });

    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, message: 'Seleção cancelada.' };
    }

    const selectedPath = path.resolve(result.filePaths[0]);
    const name = path.basename(selectedPath);

    const snap = readProjectsSnapshot();
    const idx = snap.projects.findIndex((project) => path.resolve(project.rootPath) === selectedPath);

    if (idx >= 0) {
      const existing = snap.projects[idx];
      snap.projects[idx] = normalizeProjectRecord({
        ...existing,
        rootPath: selectedPath,
        name: existing.name || name,
        state: 'active',
        archivedAt: null,
        deletedAt: null,
      });
      writeProjectsSnapshot(snap);
      appendAuditEvent('project.restored_or_reused', {
        projectId: existing.id,
        name: existing.name || name,
        rootPath: selectedPath,
      });
    } else {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      snap.projects.push(
        normalizeProjectRecord({
          id,
          name,
          rootPath: selectedPath,
          createdAt: new Date().toISOString(),
          state: 'active',
          summary: '',
          archivedAt: null,
          deletedAt: null,
        })
      );
      writeProjectsSnapshot(snap);
      appendAuditEvent('project.added', { projectId: id, name, rootPath: selectedPath });
    }

    return { ok: true, projects: readProjectsByState('active') };
  });

  registerIpcHandler('projects:remove', (_, id) => {
    const snap = readProjectsSnapshot();
    const nextProjects = snap.projects.filter((project) => project.id !== id);
    writeProjectsSnapshot({ projects: nextProjects });
    removeProjectConversationHistory(id);
    appendAuditEvent('project.removed', { projectId: id });
    return { ok: true, projects: readProjectsByState('active') };
  });

  registerIpcHandler('projects:listByState', (_, payload) => {
    const state = payload && typeof payload.state === 'string' ? payload.state : 'active';
    if (!['active', 'archived', 'deleted'].includes(state)) {
      return { ok: false, message: 'Estado inválido.', projects: [] };
    }
    return { ok: true, projects: readProjectsByState(state) };
  });

  registerIpcHandler('projects:rename', (_, payload) => {
    const id = payload && payload.id;
    const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!id || !name) return { ok: false, message: 'Parâmetros inválidos.' };

    const snap = readProjectsSnapshot();
    const idx = snap.projects.findIndex((project) => project.id === id);
    if (idx < 0) return { ok: false, message: 'Projeto não encontrado.' };

    snap.projects[idx] = normalizeProjectRecord({ ...snap.projects[idx], name });
    writeProjectsSnapshot(snap);
    appendAuditEvent('project.renamed', { projectId: id, name });
    return { ok: true, projects: readProjectsByState('active') };
  });

  registerIpcHandler('projects:archive', (_, payload) => {
    const id = payload && payload.id;
    const summary = payload && typeof payload.summary === 'string' ? payload.summary : '';
    if (!id) return { ok: false, message: 'id é obrigatório.' };

    const snap = readProjectsSnapshot();
    const idx = snap.projects.findIndex((project) => project.id === id);
    if (idx < 0) return { ok: false, message: 'Projeto não encontrado.' };

    snap.projects[idx] = normalizeProjectRecord({
      ...snap.projects[idx],
      state: 'archived',
      summary,
      archivedAt: new Date().toISOString(),
    });
    writeProjectsSnapshot(snap);
    appendAuditEvent('project.archived', { projectId: id });
    return { ok: true, projects: readProjectsByState('active') };
  });

  registerIpcHandler('projects:trash', (_, payload) => {
    const id = payload && payload.id;
    const summary = payload && typeof payload.summary === 'string' ? payload.summary : '';
    if (!id) return { ok: false, message: 'id é obrigatório.' };

    const snap = readProjectsSnapshot();
    const idx = snap.projects.findIndex((project) => project.id === id);
    if (idx < 0) return { ok: false, message: 'Projeto não encontrado.' };

    snap.projects[idx] = normalizeProjectRecord({
      ...snap.projects[idx],
      state: 'deleted',
      summary,
      deletedAt: new Date().toISOString(),
    });
    writeProjectsSnapshot(snap);
    appendAuditEvent('project.trashed', { projectId: id });
    return { ok: true, projects: readProjectsByState('active') };
  });

  registerIpcHandler('projects:restore', (_, payload) => {
    const id = payload && payload.id;
    if (!id) return { ok: false, message: 'id é obrigatório.' };

    const snap = readProjectsSnapshot();
    const idx = snap.projects.findIndex((project) => project.id === id);
    if (idx < 0) return { ok: false, message: 'Projeto não encontrado.' };

    snap.projects[idx] = normalizeProjectRecord({
      ...snap.projects[idx],
      state: 'active',
      archivedAt: null,
      deletedAt: null,
    });
    writeProjectsSnapshot(snap);
    appendAuditEvent('project.restored', { projectId: id });
    return { ok: true, projects: readProjectsByState('active') };
  });

  registerIpcHandler('projects:trash:clear', () => {
    const snap = readProjectsSnapshot();
    const toDelete = snap.projects.filter((project) => project.state === 'deleted').map((project) => project.id);
    const next = snap.projects.filter((project) => project.state !== 'deleted');
    writeProjectsSnapshot({ projects: next });
    toDelete.forEach((id) => removeProjectConversationHistory(id));
    appendAuditEvent('project.trash_cleared', { count: toDelete.length });
    return { ok: true, projects: readProjectsByState('active') };
  });

  registerIpcHandler('project:scan', (_, rootPath) => {
    const authorization = authorizeProjectRoot(rootPath);
    if (!authorization.ok) return authorization;
    try {
      const info = scanProject(authorization.rootPath);
      appendAuditEvent('project.scanned', {
        rootPath: authorization.rootPath,
        totalFiles: info.totalFiles,
        stacks: info.stacks,
      });
      return {
        ok: true,
        info,
        nextSteps: buildNextSteps(info),
        previewPlan: buildProjectPreviewPlan(info),
        verificationPlan: buildProjectVerificationPlan(info),
      };
    } catch (error) {
      appendAuditEvent('project.scan_failed', { rootPath: authorization.rootPath, message: error.message });
      return { ok: false, message: `Falha ao analisar projeto: ${error.message}` };
    }
  });

  registerIpcHandler('project:preview:plan', (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return { ...authorization, plan: null };
    try {
      const info = scanProject(authorization.rootPath);
      const plan = buildProjectPreviewPlan(info, payload && payload.options ? payload.options : {});
      appendAuditEvent('project.preview_plan_built', {
        rootPath: authorization.rootPath,
        ready: Boolean(plan && plan.ready),
        mode: plan && plan.mode ? plan.mode : '',
        stack: plan && plan.stack ? plan.stack : '',
      });
      return { ok: true, info, plan };
    } catch (error) {
      appendAuditEvent('project.preview_plan_failed', { rootPath: authorization.rootPath, message: error.message });
      return { ok: false, message: `Falha ao planejar preview: ${error.message}`, plan: null };
    }
  });

  registerIpcHandler('project:verify:plan', (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return { ...authorization, plan: null };
    try {
      const info = scanProject(authorization.rootPath);
      const plan = buildProjectVerificationPlan(info);
      appendAuditEvent('project.verification_plan_built', {
        rootPath: authorization.rootPath,
        steps: plan && plan.summary ? plan.summary.totalSteps : 0,
      });
      return { ok: true, info, plan };
    } catch (error) {
      appendAuditEvent('project.verification_plan_failed', { rootPath: authorization.rootPath, message: error.message });
      return { ok: false, message: `Falha ao planejar verificação: ${error.message}`, plan: null };
    }
  });

  registerIpcHandler('project:verify:run', async (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return { ...authorization, report: null };
    try {
      const info = scanProject(authorization.rootPath);
      const report = await runProjectVerification(info);
      appendAuditEvent('project.verification_run', {
        rootPath: authorization.rootPath,
        ready: Boolean(report && report.ready),
        summary: report && report.summary ? report.summary : null,
      });
      return { ok: true, info, report };
    } catch (error) {
      appendAuditEvent('project.verification_run_failed', { rootPath: authorization.rootPath, message: error.message });
      return { ok: false, message: `Falha ao executar verificação: ${error.message}`, report: null };
    }
  });

  registerIpcHandler('project:files-tree', async (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return { ...authorization, rows: [], diffStats: {} };
    const rootPath = authorization.rootPath;

    try {
      const rows = collectProjectFilesTree(rootPath, 1400);
      const gitDiffStats = await collectGitDiffStats(rootPath);
      const runtimeStats = getRuntimeDiffStats(rootPath);
      const diffStats = { ...gitDiffStats };
      for (const [relPath, stat] of Object.entries(runtimeStats || {})) {
        mergeDiffStatsEntry(diffStats, relPath, stat);
      }
      return { ok: true, rows, diffStats };
    } catch (error) {
      return { ok: false, message: error.message, rows: [], diffStats: {} };
    }
  });

  registerIpcHandler('project:git:status', async (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return authorization;
    return getProjectGitStatus(authorization.rootPath);
  });

  registerIpcHandler('project:git:open-latest', async (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return authorization;
    const status = await getProjectGitStatus(authorization.rootPath);
    if (!status.ok) return status;
    if (!status.isGitRepo) return { ok: false, message: 'Projeto não está em Git.' };
    if (!status.latestUrl) return { ok: false, message: 'Commit remoto não disponível para abrir.' };
    const externalUrl = normalizeExternalUrl(status.latestUrl);
    if (!externalUrl.ok) return externalUrl;
    await shell.openExternal(externalUrl.url);
    return { ok: true, url: externalUrl.url };
  });

  registerIpcHandler('project:deploy:open', async (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return authorization;
    const status = await getProjectGitStatus(authorization.rootPath);
    if (!status.ok) return status;
    if (!status.isGitRepo) return { ok: false, message: 'Projeto não está em Git.' };

    const targetUrl = status.actionsUrl || status.remoteUrl || null;
    if (!targetUrl) return { ok: false, message: 'Nenhum remoto configurado para deploy.' };
    const externalUrl = normalizeExternalUrl(targetUrl);
    if (!externalUrl.ok) return externalUrl;

    await shell.openExternal(externalUrl.url);
    return { ok: true, url: externalUrl.url };
  });
}

module.exports = {
  registerProjectHandlers,
};
