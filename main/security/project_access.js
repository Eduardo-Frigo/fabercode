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
    if (typeof rawRootPath !== 'string') return '';
    const value = rawRootPath.trim();
    if (!value || value.includes('\0')) return '';
    try {
      return path.resolve(value);
    } catch {
      return '';
    }
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

  function denyProjectBinding(message = 'Projeto não autorizado pelo processo principal.') {
    return { ok: false, authorized: false, message };
  }

  function inspectPlainDataObject(value) {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, data: null, keys: [] };
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return { ok: false, data: null, keys: [] };
      }
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== 'string')) {
        return { ok: false, data: null, keys: [] };
      }
      const data = Object.create(null);
      for (const key of keys) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          return { ok: false, data: null, keys: [] };
        }
        Object.defineProperty(data, key, {
          configurable: true,
          enumerable: true,
          value: descriptor.value,
          writable: true,
        });
      }
      return { ok: true, data, keys };
    } catch {
      return { ok: false, data: null, keys: [] };
    }
  }

  function inspectDataArray(value) {
    try {
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        return { ok: false, values: [] };
      }
      const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
      const length = lengthDescriptor && lengthDescriptor.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        return { ok: false, values: [] };
      }
      const allowedKeys = new Set(['length']);
      const values = [];
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        allowedKeys.add(key);
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          return { ok: false, values: [] };
        }
        values.push(descriptor.value);
      }
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))) {
        return { ok: false, values: [] };
      }
      return { ok: true, values };
    } catch {
      return { ok: false, values: [] };
    }
  }

  function hasInheritedProjectIdentity(value) {
    try {
      let prototype = Object.getPrototypeOf(value);
      while (prototype) {
        if (
          Reflect.getOwnPropertyDescriptor(prototype, 'id')
          || Reflect.getOwnPropertyDescriptor(prototype, 'projectId')
        ) {
          return true;
        }
        prototype = Object.getPrototypeOf(prototype);
      }
      return false;
    } catch {
      return true;
    }
  }

  function normalizeAbsoluteProjectRoot(rawRootPath) {
    if (typeof rawRootPath !== 'string' || rawRootPath !== rawRootPath.trim() || rawRootPath.includes('\0')) {
      return { ok: false, canonicalRootPath: '' };
    }
    if (!rawRootPath || !path.isAbsolute(rawRootPath)) {
      return { ok: false, canonicalRootPath: '' };
    }
    const canonicalRootPath = resolveRoot(rawRootPath);
    if (!canonicalRootPath || canonicalRootPath === path.parse(canonicalRootPath).root) {
      return { ok: false, canonicalRootPath: '' };
    }
    return { ok: true, canonicalRootPath };
  }

  function normalizeFileIdentity(stats) {
    try {
      if (!stats || stats.dev === undefined || stats.ino === undefined) return null;
      if (typeof stats.dev === 'number' && !Number.isFinite(stats.dev)) return null;
      if (typeof stats.ino === 'number' && !Number.isFinite(stats.ino)) return null;
      return { device: String(stats.dev), inode: String(stats.ino) };
    } catch {
      return null;
    }
  }

  function sameFileIdentity(left, right) {
    return Boolean(
      left
      && right
      && left.device === right.device
      && left.inode === right.inode
    );
  }

  function getEntryType(stats) {
    try {
      if (stats.isSymbolicLink()) return 'symlink';
      if (stats.isDirectory()) return 'directory';
      return 'other';
    } catch {
      return 'unknown';
    }
  }

  function capturePhysicalRoot(candidatePath) {
    try {
      const entryBefore = fs.lstatSync(candidatePath);
      const targetBefore = fs.statSync(candidatePath);
      if (!targetBefore.isDirectory()) return null;
      const realRootPath = resolveRoot(fs.realpathSync(candidatePath));
      if (!realRootPath || realRootPath === path.parse(realRootPath).root) return null;
      const entryAfter = fs.lstatSync(candidatePath);
      const targetAfter = fs.statSync(candidatePath);
      const entryIdentityBefore = normalizeFileIdentity(entryBefore);
      const entryIdentityAfter = normalizeFileIdentity(entryAfter);
      const targetIdentityBefore = normalizeFileIdentity(targetBefore);
      const targetIdentityAfter = normalizeFileIdentity(targetAfter);
      const entryType = getEntryType(entryBefore);
      if (
        entryType === 'unknown'
        || entryType !== getEntryType(entryAfter)
        || !sameFileIdentity(entryIdentityBefore, entryIdentityAfter)
        || !sameFileIdentity(targetIdentityBefore, targetIdentityAfter)
      ) {
        return null;
      }
      return {
        entryIdentity: entryIdentityAfter,
        entryType,
        realRootPath,
        targetIdentity: targetIdentityAfter,
      };
    } catch {
      return null;
    }
  }

  function samePhysicalRoot(left, right) {
    return Boolean(
      left
      && right
      && (
        left.realRootPath === right.realRootPath
        || sameFileIdentity(left.targetIdentity, right.targetIdentity)
      )
    );
  }

  function toPublicPhysicalRootIdentity(capture) {
    return {
      device: capture.targetIdentity.device,
      inode: capture.targetIdentity.inode,
      entryDevice: capture.entryIdentity.device,
      entryInode: capture.entryIdentity.inode,
      entryType: capture.entryType,
    };
  }

  function normalizeSnapshotProject(project) {
    const inspected = inspectPlainDataObject(project);
    if (!inspected.ok || hasInheritedProjectIdentity(project)) {
      return { valid: false, projectId: '', canonicalRootPath: '', state: '' };
    }

    const projectId = typeof inspected.data.id === 'string' ? inspected.data.id.trim() : '';
    const rawRootPath = typeof inspected.data.rootPath === 'string' ? inspected.data.rootPath : '';
    const normalizedRoot = normalizeAbsoluteProjectRoot(rawRootPath);
    const canonicalRootPath = normalizedRoot.canonicalRootPath;
    const state = typeof inspected.data.state === 'string' ? inspected.data.state : '';
    const valid = Boolean(
      projectId
      && inspected.data.id === projectId
      && rawRootPath
      && normalizedRoot.ok
      && ['active', 'archived', 'deleted'].includes(state)
    );

    return {
      valid,
      projectId,
      canonicalRootPath,
      state,
    };
  }

  function readSnapshotProjectRecords() {
    try {
      const snapshot = readProjectsSnapshot();
      const inspectedSnapshot = inspectPlainDataObject(snapshot);
      if (!inspectedSnapshot.ok || !Object.prototype.hasOwnProperty.call(inspectedSnapshot.data, 'projects')) {
        return { ok: false, records: [] };
      }
      const inspectedProjects = inspectDataArray(inspectedSnapshot.data.projects);
      if (!inspectedProjects.ok) return { ok: false, records: [] };
      return { ok: true, records: inspectedProjects.values.map(normalizeSnapshotProject) };
    } catch {
      return { ok: false, records: [] };
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
    const snapshot = readSnapshotProjectRecords();
    if (!snapshot.ok) return [];
    return snapshot.records
      .filter((record) => record.valid && record.state !== 'deleted')
      .map((record) => record.canonicalRootPath);
  }

  function authorizeRootPath(rawRootPath) {
    assertReady();
    const normalizedRoot = normalizeAbsoluteProjectRoot(rawRootPath);
    if (!normalizedRoot.ok) {
      return { ok: false, message: 'rootPath é obrigatório.' };
    }
    const rootPath = normalizedRoot.canonicalRootPath;
    const physicalRoot = capturePhysicalRoot(rootPath);
    if (!physicalRoot) {
      return { ok: false, message: 'Projeto não está acessível no disco.' };
    }
    const authorizedRoots = listAuthorizedRoots();
    if (!authorizedRoots.includes(rootPath)) {
      return { ok: false, message: 'Projeto não autorizado pelo processo principal.' };
    }
    const finalPhysicalRoot = capturePhysicalRoot(rootPath);
    if (
      !samePhysicalRoot(physicalRoot, finalPhysicalRoot)
      || !finalPhysicalRoot
      || !sameFileIdentity(physicalRoot.entryIdentity, finalPhysicalRoot.entryIdentity)
      || physicalRoot.entryType !== finalPhysicalRoot.entryType
    ) {
      return { ok: false, message: 'A raiz física do projeto mudou durante a autorização.' };
    }
    return {
      ok: true,
      rootPath,
      realRootPath: finalPhysicalRoot.realRootPath,
      physicalRootIdentity: toPublicPhysicalRootIdentity(finalPhysicalRoot),
    };
  }

  function authorizeProjectBinding(projectId, rawRootPath) {
    assertReady();

    if (typeof projectId !== 'string' || !projectId.trim() || projectId !== projectId.trim()) {
      return denyProjectBinding('projectId é obrigatório.');
    }
    const normalizedRequestedRoot = normalizeAbsoluteProjectRoot(rawRootPath);
    if (!normalizedRequestedRoot.ok) {
      return denyProjectBinding('rootPath é obrigatório.');
    }
    const canonicalRootPath = normalizedRequestedRoot.canonicalRootPath;

    const snapshot = readSnapshotProjectRecords();
    if (!snapshot.ok) {
      return denyProjectBinding('Não foi possível validar o projeto autorizado.');
    }
    const records = snapshot.records;
    if (records.some((record) => !record.valid)) {
      return denyProjectBinding('Registro de projeto inválido ou ambíguo.');
    }

    const recordsById = records.filter((record) => record.valid && record.projectId === projectId);
    const recordsByRoot = records.filter(
      (record) => record.valid && record.canonicalRootPath === canonicalRootPath
    );
    if (recordsById.length !== 1 || recordsByRoot.length !== 1 || recordsById[0] !== recordsByRoot[0]) {
      return denyProjectBinding();
    }

    const matchedRecord = recordsById[0];
    if (matchedRecord.state === 'deleted') {
      return denyProjectBinding();
    }
    const initialPhysicalRoot = capturePhysicalRoot(matchedRecord.canonicalRootPath);
    if (!initialPhysicalRoot) {
      return denyProjectBinding('Projeto não está acessível no disco.');
    }

    const hasPhysicalAlias = records.some((record) => {
      if (!record.valid || record === matchedRecord || record.state === 'deleted') return false;
      const otherPhysicalRoot = capturePhysicalRoot(record.canonicalRootPath);
      return samePhysicalRoot(initialPhysicalRoot, otherPhysicalRoot);
    });
    if (hasPhysicalAlias) {
      return denyProjectBinding('A raiz física do projeto está associada a mais de um registro.');
    }

    const finalPhysicalRoot = capturePhysicalRoot(matchedRecord.canonicalRootPath);
    if (!samePhysicalRoot(initialPhysicalRoot, finalPhysicalRoot)) {
      return denyProjectBinding('A raiz física do projeto mudou durante a autorização.');
    }
    if (
      !finalPhysicalRoot
      || !sameFileIdentity(initialPhysicalRoot.entryIdentity, finalPhysicalRoot.entryIdentity)
      || initialPhysicalRoot.entryType !== finalPhysicalRoot.entryType
    ) {
      return denyProjectBinding('A entrada física do projeto mudou durante a autorização.');
    }

    // Uma identidade baseada em path nunca elimina a troca posterior ao retorno.
    // O lifecycle deve repetir este binding e comparar a identidade imediatamente antes de cada efeito.
    return {
      ok: true,
      authorized: true,
      projectId: matchedRecord.projectId,
      canonicalRootPath: matchedRecord.canonicalRootPath,
      rootPath: matchedRecord.canonicalRootPath,
      realRootPath: finalPhysicalRoot.realRootPath,
      physicalRootIdentity: toPublicPhysicalRootIdentity(finalPhysicalRoot),
    };
  }

  function authorizeProjectRootBinding(rawRootPath) {
    assertReady();

    const normalizedRequestedRoot = normalizeAbsoluteProjectRoot(rawRootPath);
    if (!normalizedRequestedRoot.ok) {
      return denyProjectBinding('rootPath é obrigatório.');
    }
    const canonicalRootPath = normalizedRequestedRoot.canonicalRootPath;

    const snapshot = readSnapshotProjectRecords();
    if (!snapshot.ok) {
      return denyProjectBinding('Não foi possível validar o projeto autorizado.');
    }
    const records = snapshot.records;
    if (records.some((record) => !record.valid)) {
      return denyProjectBinding('Registro de projeto inválido ou ambíguo.');
    }

    const recordsByRoot = records.filter(
      (record) => record.canonicalRootPath === canonicalRootPath
    );
    if (recordsByRoot.length !== 1 || recordsByRoot[0].state === 'deleted') {
      return denyProjectBinding();
    }

    const matchedRecord = recordsByRoot[0];
    const recordsById = records.filter((record) => record.projectId === matchedRecord.projectId);
    if (recordsById.length !== 1 || recordsById[0] !== matchedRecord) {
      return denyProjectBinding('Identidade de projeto duplicada ou ambígua.');
    }

    // A resolução root-only serve apenas para descobrir a identidade persistida. O binding
    // forte repete a leitura do snapshot e todas as verificações físicas, fechando mudanças
    // entre a descoberta e a autorização sem alterar o caminho legado de normalizeProjectInfo.
    const authorization = authorizeProjectBinding(matchedRecord.projectId, canonicalRootPath);
    if (!authorization.ok) return authorization;
    if (
      authorization.projectId !== matchedRecord.projectId
      || authorization.canonicalRootPath !== canonicalRootPath
      || authorization.rootPath !== canonicalRootPath
    ) {
      return denyProjectBinding('O vínculo do projeto mudou durante a autorização.');
    }
    return authorization;
  }

  function getRequestedProjectId(projectInfo, inspectedProjectInfo) {
    if (!inspectedProjectInfo.ok || hasInheritedProjectIdentity(projectInfo)) {
      return { ok: false, message: 'Formato de projeto inválido.' };
    }
    const hasId = Object.prototype.hasOwnProperty.call(inspectedProjectInfo.data, 'id');
    const hasProjectId = Object.prototype.hasOwnProperty.call(inspectedProjectInfo.data, 'projectId');
    if (!hasId && !hasProjectId) return { ok: true, present: false, projectId: '' };

    const candidates = [];
    if (hasId) candidates.push(inspectedProjectInfo.data.id);
    if (hasProjectId) candidates.push(inspectedProjectInfo.data.projectId);
    if (candidates.some((value) => typeof value !== 'string' || !value.trim() || value !== value.trim())) {
      return { ok: false, message: 'Identidade do projeto inválida.' };
    }
    const uniqueIds = [...new Set(candidates)];
    if (uniqueIds.length !== 1) {
      return { ok: false, message: 'Identidade do projeto inconsistente.' };
    }
    return { ok: true, present: true, projectId: uniqueIds[0] };
  }

  function normalizeProjectInfo(projectInfo, options = undefined) {
    const inspectedProjectInfo = inspectPlainDataObject(projectInfo);
    if (!inspectedProjectInfo.ok || hasInheritedProjectIdentity(projectInfo)) {
      return { ok: false, message: 'Projeto ausente ou inválido.' };
    }
    const inspectedOptions = options === undefined
      ? { ok: true, data: Object.create(null) }
      : inspectPlainDataObject(options);
    if (!inspectedOptions.ok) {
      return { ok: false, message: 'Opções de autorização inválidas.' };
    }
    // O renderer atual ainda envia o resultado root-only do scanner. O novo coordinator
    // deve optar pelo modo estrito; projectInfo nunca pode desativá-lo por conta própria.
    const requireProjectBinding = inspectedOptions.data.requireProjectBinding === true;
    if (!inspectedProjectInfo.data.rootPath) {
      return { ok: false, message: 'Projeto ausente ou inválido.' };
    }
    const requestedIdentity = getRequestedProjectId(projectInfo, inspectedProjectInfo);
    if (!requestedIdentity.ok) return requestedIdentity;
    if (!requestedIdentity.present && requireProjectBinding) {
      return { ok: false, message: 'Identidade do projeto é obrigatória.' };
    }
    const authorization = requestedIdentity.present
      ? authorizeProjectBinding(requestedIdentity.projectId, inspectedProjectInfo.data.rootPath)
      : authorizeRootPath(inspectedProjectInfo.data.rootPath);
    if (!authorization.ok) return authorization;
    let scannedProjectInfo = null;
    if (typeof scanProject === 'function') {
      try {
        scannedProjectInfo = scanProject(authorization.rootPath);
      } catch {
        return {
          ok: false,
          message: 'Falha ao atualizar contexto do projeto.',
        };
      }
    }
    const inspectedScannedProjectInfo = scannedProjectInfo === null
      ? { ok: true, data: Object.create(null) }
      : inspectPlainDataObject(scannedProjectInfo);
    if (!inspectedScannedProjectInfo.ok) {
      return { ok: false, message: 'Contexto atualizado do projeto é inválido.' };
    }
    const normalizedProjectInfo = {
      ...inspectedProjectInfo.data,
      ...inspectedScannedProjectInfo.data,
      rootPath: authorization.rootPath,
    };
    delete normalizedProjectInfo.authorized;
    delete normalizedProjectInfo.canonicalRootPath;
    delete normalizedProjectInfo.realRootPath;
    delete normalizedProjectInfo.physicalRootIdentity;
    if (requestedIdentity.present) {
      normalizedProjectInfo.id = authorization.projectId;
      normalizedProjectInfo.projectId = authorization.projectId;
      normalizedProjectInfo.canonicalRootPath = authorization.canonicalRootPath;
      normalizedProjectInfo.realRootPath = authorization.realRootPath;
      normalizedProjectInfo.authorized = true;
    }

    return {
      ok: true,
      projectInfo: normalizedProjectInfo,
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
    authorizeProjectBinding,
    authorizeProjectRootBinding,
    authorizeRootPath,
    listAuthorizedRoots,
    normalizeProjectInfo,
    resolveInsideRoot,
  };
}

module.exports = {
  createProjectAccess,
};
