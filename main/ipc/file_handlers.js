function registerFileHandlers(dependencies = {}) {
  const {
    appendAuditEvent,
    computeLineChangeStats,
    fs,
    ingestRuntimeDiffStats,
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff,
    path,
    registerIpcHandler,
    resolveAuthorizedProjectPath,
    shell,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`File IPC dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('appendAuditEvent', appendAuditEvent);
    requireDependency('computeLineChangeStats', computeLineChangeStats);
    requireDependency('fs', fs);
    requireDependency('ingestRuntimeDiffStats', ingestRuntimeDiffStats);
    requireDependency('mergeDiffStatsEntry', mergeDiffStatsEntry);
    requireDependency('normalizeRelativePathForDiff', normalizeRelativePathForDiff);
    requireDependency('path', path);
    requireDependency('registerIpcHandler', registerIpcHandler);
    requireDependency('resolveAuthorizedProjectPath', resolveAuthorizedProjectPath);
    requireDependency('shell', shell);
  }

  assertReady();

  registerIpcHandler('file:reveal', async (_, payload) => {
    const { projectInfo, relativePath } = payload || {};
    if (!projectInfo || !relativePath) {
      return { ok: false, message: 'Parâmetros inválidos para revelar arquivo.' };
    }
    const resolved = resolveAuthorizedProjectPath(projectInfo, relativePath);
    if (!resolved.ok) return resolved;
    const abs = resolved.absolutePath;
    if (!fs.existsSync(abs)) {
      return { ok: false, message: 'Arquivo não encontrado no projeto.' };
    }
    try {
      shell.showItemInFolder(abs);
      return { ok: true, absolutePath: abs };
    } catch {
      const openResult = await shell.openPath(path.dirname(abs));
      if (openResult) {
        return { ok: false, message: `Falha ao revelar arquivo: ${openResult}`, absolutePath: abs };
      }
      return { ok: true, absolutePath: abs, fallback: 'open_parent_folder' };
    }
  });

  registerIpcHandler('file:read', (_, payload) => {
    const { projectInfo, relativePath } = payload || {};
    if (!projectInfo || !relativePath) {
      return { ok: false, message: 'Parâmetros inválidos para abrir arquivo.' };
    }

    const resolved = resolveAuthorizedProjectPath(projectInfo, relativePath);
    if (!resolved.ok) return resolved;
    const normalizedRelative = resolved.relativePath;
    const abs = resolved.absolutePath;
    if (!fs.existsSync(abs)) {
      return { ok: false, message: 'Arquivo não encontrado.' };
    }

    let stat;
    try {
      stat = fs.statSync(abs);
    } catch (error) {
      return { ok: false, message: `Falha ao ler metadados: ${error.message}` };
    }

    if (!stat.isFile()) {
      return { ok: false, message: 'O caminho informado não é um arquivo.' };
    }

    const MAX_PREVIEW_FILE_BYTES = 12 * 1024 * 1024;
    if (stat.size > MAX_PREVIEW_FILE_BYTES) {
      return {
        ok: false,
        message: `Arquivo muito grande para preview no painel (máximo ${Math.round(MAX_PREVIEW_FILE_BYTES / (1024 * 1024))} MB).`,
      };
    }

    let buffer;
    try {
      buffer = fs.readFileSync(abs);
    } catch (error) {
      return { ok: false, message: `Falha ao abrir arquivo: ${error.message}` };
    }

    if (buffer.includes(0)) {
      return { ok: false, message: 'Arquivo binário não suportado no visualizador.' };
    }

    const content = buffer.toString('utf8');
    const lineCount = content.split(/\r?\n/).length;
    const MAX_PREVIEW_FILE_LINES = 100000;
    if (lineCount > MAX_PREVIEW_FILE_LINES) {
      return {
        ok: false,
        message: `Arquivo com ${lineCount.toLocaleString('pt-BR')} linhas excede o limite do visualizador (${MAX_PREVIEW_FILE_LINES.toLocaleString('pt-BR')}).`,
      };
    }

    return {
      ok: true,
      relativePath: normalizedRelative,
      content,
      size: stat.size,
      lineCount,
      updatedAt: stat.mtime.toISOString(),
    };
  });

  registerIpcHandler('file:rename', (_, payload) => {
    try {
      const projectInfo = payload && payload.projectInfo ? payload.projectInfo : null;
      const relativePath = payload && payload.relativePath ? String(payload.relativePath) : '';
      const nextName = payload && payload.nextName ? String(payload.nextName) : '';

      if (!projectInfo || !relativePath || !nextName) {
        return { ok: false, message: 'Parâmetros inválidos para renomear arquivo.' };
      }
      if (nextName.includes('/') || nextName.includes('\\') || nextName.includes('\0') || nextName === '.' || nextName === '..') {
        return { ok: false, message: 'Nome de destino inválido.' };
      }

      const resolved = resolveAuthorizedProjectPath(projectInfo, relativePath);
      if (!resolved.ok) return resolved;
      const rootAbs = resolved.rootPath;
      const fromAbs = resolved.absolutePath;
      const parentAbs = path.dirname(fromAbs);
      const toAbs = path.resolve(parentAbs, nextName);

      if (!fromAbs.startsWith(rootAbs + path.sep) && fromAbs !== rootAbs) {
        return { ok: false, message: 'Caminho de origem inválido.' };
      }
      if (!toAbs.startsWith(rootAbs + path.sep) && toAbs !== rootAbs) {
        return { ok: false, message: 'Caminho de destino inválido.' };
      }
      if (!fs.existsSync(fromAbs)) {
        return { ok: false, message: 'Arquivo não encontrado para renomear.' };
      }
      if (fs.existsSync(toAbs)) {
        return { ok: false, message: 'Já existe um arquivo com esse nome.' };
      }

      fs.renameSync(fromAbs, toAbs);
      const nextRelativePath = path.relative(rootAbs, toAbs).split(path.sep).join('/');
      return { ok: true, relativePath: nextRelativePath };
    } catch (error) {
      return { ok: false, message: error && error.message ? error.message : 'Falha ao renomear arquivo.' };
    }
  });

  registerIpcHandler('file:write', (_, payload) => {
    const { projectInfo, relativePath, content } = payload || {};
    if (!projectInfo || !relativePath || typeof content !== 'string') {
      return { ok: false, message: 'Parâmetros inválidos para salvar arquivo.' };
    }

    const resolved = resolveAuthorizedProjectPath(projectInfo, relativePath);
    if (!resolved.ok) return resolved;
    const rootPath = resolved.rootPath;
    const normalizedRelative = resolved.relativePath;
    const abs = resolved.absolutePath;

    try {
      const previous = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
      fs.writeFileSync(abs, content, 'utf8');

      const rel = normalizeRelativePathForDiff(normalizedRelative);
      const diffStats = {};
      mergeDiffStatsEntry(diffStats, rel, computeLineChangeStats(previous, content));
      if (Object.keys(diffStats).length) {
        ingestRuntimeDiffStats(rootPath, diffStats);
      }

      appendAuditEvent('file.saved_from_lightbox', { rootPath, relativePath: normalizedRelative });
      return { ok: true, relativePath: normalizedRelative, diffStats };
    } catch (error) {
      return { ok: false, message: `Falha ao salvar arquivo: ${error.message}` };
    }
  });
}

module.exports = {
  registerFileHandlers,
};
