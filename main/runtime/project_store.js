function createProjectStore(dependencies = {}) {
  const {
    fs,
    getUserDataPath,
    path,
  } = dependencies;

  function assertReady() {
    if (!fs) throw new Error('Project store dependency missing: fs');
    if (!path) throw new Error('Project store dependency missing: path');
    if (typeof getUserDataPath !== 'function') throw new Error('Project store dependency missing: getUserDataPath');
  }

  function ensureProjectsStore() {
    assertReady();
    const storeDir = getUserDataPath();
    const storePath = path.join(storeDir, 'projects.json');

    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }

    if (!fs.existsSync(storePath)) {
      fs.writeFileSync(storePath, JSON.stringify({ projects: [] }, null, 2), 'utf8');
    }

    return storePath;
  }

  function normalizeProjectRecord(project = {}) {
    return {
      id: project.id,
      name: project.name || 'Projeto',
      rootPath: project.rootPath || '',
      createdAt: project.createdAt || new Date().toISOString(),
      state: ['active', 'archived', 'deleted'].includes(project.state) ? project.state : 'active',
      summary: typeof project.summary === 'string' ? project.summary : '',
      archivedAt: project.archivedAt || null,
      deletedAt: project.deletedAt || null,
    };
  }

  function readProjectsSnapshot() {
    const storePath = ensureProjectsStore();
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    const projects = Array.isArray(parsed.projects) ? parsed.projects.map(normalizeProjectRecord) : [];
    return { projects };
  }

  function writeProjectsSnapshot(snapshot) {
    const storePath = ensureProjectsStore();
    const projects = Array.isArray(snapshot && snapshot.projects) ? snapshot.projects.map(normalizeProjectRecord) : [];
    fs.writeFileSync(storePath, JSON.stringify({ projects }, null, 2), 'utf8');
  }

  function readProjectsByState(state = 'active') {
    const snap = readProjectsSnapshot();
    return snap.projects.filter((project) => project.state === state);
  }

  function readProjects() {
    return readProjectsByState('active');
  }

  function writeProjects(projects) {
    const snap = readProjectsSnapshot();
    const nonActive = snap.projects.filter((project) => project.state !== 'active');
    const nextActive = Array.isArray(projects)
      ? projects.map((project) => normalizeProjectRecord({ ...project, state: 'active', archivedAt: null, deletedAt: null }))
      : [];
    writeProjectsSnapshot({ projects: [...nonActive, ...nextActive] });
  }

  return {
    ensureProjectsStore,
    normalizeProjectRecord,
    readProjects,
    readProjectsByState,
    readProjectsSnapshot,
    writeProjects,
    writeProjectsSnapshot,
  };
}

module.exports = {
  createProjectStore,
};
