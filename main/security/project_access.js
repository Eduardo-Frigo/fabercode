function createProjectAccess(dependencies = {}) {
  const {
    fs,
    path,
    readProjectsSnapshot,
    scanProject,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Project access dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('fs', fs);
    requireDependency('path', path);
    requireDependency('readProjectsSnapshot', readProjectsSnapshot);
  }

  function resolveRoot(rawRootPath) {
    const value = String(rawRootPath || '').trim();
    if (!value || value.includes('\0')) return '';
    return path.resolve(value);
  }

  function isInsideRoot(rootPath, candidatePath) {
    const root = path.resolve(String(rootPath || ''));
    const candidate = path.resolve(String(candidatePath || ''));
    return candidate === root || candidate.startsWith(root + path.sep);
  }

  function getRealPathIfExists(candidatePath) {
    try {
      return fs.realpathSync(candidatePath);
    } catch {
      return '';
    }
  }

  function findNearestExistingParent(candidatePath, rootPath) {
    let current = path.resolve(path.dirname(candidatePath));
    const root = path.resolve(rootPath);

    while (current && isInsideRoot(root, current)) {
      if (fs.existsSync(current)) return current;
      const next = path.dirname(current);
      if (next === current) break;
      current = next;
    }

    return fs.existsSync(root) ? root : '';
  }

  function listAuthorizedRoots() {
    assertReady();
    const snapshot = readProjectsSnapshot();
    const projects = Array.isArray(snapshot && snapshot.projects) ? snapshot.projects : [];
    return projects
      .filter((project) => project && project.state !== 'deleted' && project.rootPath)
      .map((project) => resolveRoot(project.rootPath))
      .filter(Boolean);
  }

  function authorizeRootPath(rawRootPath) {
    assertReady();
    const rootPath = resolveRoot(rawRootPath);
    if (!rootPath) {
      return { ok: false, message: 'rootPath é obrigatório.' };
    }
    if (!fs.existsSync(rootPath)) {
      return { ok: false, message: 'Projeto não está acessível no disco.' };
    }
    const realRootPath = getRealPathIfExists(rootPath);
    if (!realRootPath) {
      return { ok: false, message: 'Projeto não está acessível no disco.' };
    }
    const authorizedRoots = listAuthorizedRoots();
    if (!authorizedRoots.includes(rootPath)) {
      return { ok: false, message: 'Projeto não autorizado pelo processo principal.' };
    }
    return { ok: true, rootPath, realRootPath };
  }

  function normalizeProjectInfo(projectInfo) {
    if (!projectInfo || !projectInfo.rootPath) {
      return { ok: false, message: 'Projeto ausente ou inválido.' };
    }
    const authorization = authorizeRootPath(projectInfo.rootPath);
    if (!authorization.ok) return authorization;
    let scannedProjectInfo = null;
    if (typeof scanProject === 'function') {
      try {
        scannedProjectInfo = scanProject(authorization.rootPath);
      } catch (error) {
        return {
          ok: false,
          message: `Falha ao atualizar contexto do projeto: ${error && error.message ? error.message : String(error || '')}`,
        };
      }
    }
    return {
      ok: true,
      projectInfo: {
        ...projectInfo,
        ...(scannedProjectInfo && typeof scannedProjectInfo === 'object' ? scannedProjectInfo : {}),
        rootPath: authorization.rootPath,
      },
    };
  }

  function resolveInsideRoot(rootPath, relativePath) {
    const rootAuthorization = authorizeRootPath(rootPath);
    if (!rootAuthorization.ok) return rootAuthorization;

    const rawInput = String(relativePath || '').trim();
    if (path.isAbsolute(rawInput) || /^[A-Za-z]:[\\/]/.test(rawInput)) {
      return { ok: false, message: 'Caminho inválido.' };
    }

    const rawRelative = rawInput.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!rawRelative || rawRelative.includes('\0') || rawRelative.split('/').includes('..')) {
      return { ok: false, message: 'Caminho inválido.' };
    }

    const absolutePath = path.resolve(rootAuthorization.rootPath, rawRelative);
    if (!isInsideRoot(rootAuthorization.rootPath, absolutePath)) {
      return { ok: false, message: 'Caminho fora da raiz do projeto.' };
    }

    const physicalPath = fs.existsSync(absolutePath)
      ? getRealPathIfExists(absolutePath)
      : getRealPathIfExists(findNearestExistingParent(absolutePath, rootAuthorization.rootPath));
    if (!physicalPath || !isInsideRoot(rootAuthorization.realRootPath, physicalPath)) {
      return { ok: false, message: 'Caminho físico fora da raiz do projeto.' };
    }

    return {
      ok: true,
      rootPath: rootAuthorization.rootPath,
      absolutePath,
      relativePath: rawRelative,
    };
  }

  return {
    authorizeRootPath,
    listAuthorizedRoots,
    normalizeProjectInfo,
    resolveInsideRoot,
  };
}

module.exports = {
  createProjectAccess,
};
