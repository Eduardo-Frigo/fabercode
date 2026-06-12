const NODE_RUNTIME_COMMAND_RE = /(^|[\s;&|()])(?:npm|npx|node|next|pnpm|yarn|bun)(?=$|[\s;&|()])/;

function createProjectNodeRuntimeService(dependencies = {}) {
  const {
    fs,
    path,
    processEnv = process.env,
  } = dependencies;

  function isAvailable() {
    return Boolean(fs && path);
  }

  function readTextIfExists(filePath) {
    if (!isAvailable()) return '';
    try {
      if (!fs.existsSync(filePath)) return '';
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  }

  function normalizeNvmVersion(value = '') {
    const firstLine = String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
    if (!firstLine || firstLine.startsWith('#')) return '';
    const token = firstLine.split(/\s+/)[0].replace(/^node-?/i, '');
    if (/^v\d+\.\d+\.\d+$/.test(token)) return token;
    if (/^\d+\.\d+\.\d+$/.test(token)) return `v${token}`;
    return '';
  }

  function resolveNvmDir() {
    const explicit = String(processEnv.NVM_DIR || '').trim();
    if (explicit) return explicit;
    const home = String(processEnv.HOME || '').trim();
    return home ? path.join(home, '.nvm') : '';
  }

  function resolveProjectRuntime(rootPath) {
    const projectRoot = String(rootPath || '').trim();
    if (!isAvailable() || !projectRoot) {
      return { active: false, reason: 'missing_dependencies' };
    }

    const nvmrcPath = path.join(projectRoot, '.nvmrc');
    const version = normalizeNvmVersion(readTextIfExists(nvmrcPath));
    if (!version) {
      return { active: false, reason: 'missing_nvmrc' };
    }

    const nvmDir = resolveNvmDir();
    if (!nvmDir) {
      return { active: false, reason: 'missing_nvm_dir', version };
    }

    const binPath = path.join(nvmDir, 'versions', 'node', version, 'bin');
    if (!fs.existsSync(binPath)) {
      return { active: false, reason: 'missing_node_version', version, nvmDir, binPath };
    }

    return {
      active: true,
      version,
      nvmDir,
      binPath,
    };
  }

  function prependPath(env, binPath) {
    const currentPath = String(env.PATH || env.Path || '');
    return currentPath ? `${binPath}${path.delimiter}${currentPath}` : binPath;
  }

  function buildEnv(rootPath, extraEnv = {}) {
    const env = { ...processEnv, ...extraEnv };
    delete env.npm_config_metrics_registry;
    delete env.NPM_CONFIG_METRICS_REGISTRY;

    const runtime = resolveProjectRuntime(rootPath);
    if (runtime.active) {
      env.PATH = prependPath(env, runtime.binPath);
      env.NVM_DIR = runtime.nvmDir;
      env.NVM_BIN = runtime.binPath;
      env.FABER_NODE_VERSION = runtime.version;
    }

    return { env, runtime };
  }

  function shellQuote(value = '') {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
  }

  function shouldBootstrapShellCommand(command = '') {
    return NODE_RUNTIME_COMMAND_RE.test(String(command || ''));
  }

  function buildShellCommand(rootPath, command = '') {
    const text = String(command || '');
    if (!shouldBootstrapShellCommand(text)) return { command: text, runtime: resolveProjectRuntime(rootPath) };

    const runtime = resolveProjectRuntime(rootPath);
    if (!runtime.active) return { command: text, runtime };

    const prefix = [
      `export PATH=${shellQuote(runtime.binPath)}${path.delimiter}$PATH`,
      `export NVM_DIR=${shellQuote(runtime.nvmDir)}`,
      `export NVM_BIN=${shellQuote(runtime.binPath)}`,
      `export FABER_NODE_VERSION=${shellQuote(runtime.version)}`,
    ].join('; ');

    return {
      command: `${prefix}; ${text}`,
      runtime,
    };
  }

  return {
    buildEnv,
    buildShellCommand,
    resolveProjectRuntime,
  };
}

module.exports = {
  createProjectNodeRuntimeService,
};
