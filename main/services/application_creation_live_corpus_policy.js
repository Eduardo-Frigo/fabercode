'use strict';

const NPM_REGISTRY_ORIGIN = 'https://registry.npmjs.org';
const NPM_REGISTRY_URL = `${NPM_REGISTRY_ORIGIN}/`;
const MAX_PACKAGE_MANIFESTS = 128;
const MAX_LOCKFILE_NODES = 100_000;
const DEPENDENCY_SECTIONS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const INSTALL_LIFECYCLE_NAMES = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
  'dependencies',
]);
const PROVIDER_DESTINATIONS = Object.freeze({
  openai: Object.freeze({
    origin: 'https://api.openai.com',
    pathname: '/v1',
  }),
  gemini: Object.freeze({
    origin: 'https://generativelanguage.googleapis.com',
    pathname: '/v1beta',
  }),
});

function codedError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function isInsideRoot(pathApi, rootPath, targetPath) {
  const relative = pathApi.relative(rootPath, targetPath);
  return Boolean(
    relative
      && relative !== '.'
      && !relative.startsWith(`..${pathApi.sep}`)
      && relative !== '..'
      && !pathApi.isAbsolute(relative)
  );
}

function parseJsonFile(fsApi, filePath, code) {
  try {
    return JSON.parse(fsApi.readFileSync(filePath, 'utf8'));
  } catch {
    throw codedError(code, `JSON inválido em ${filePath}.`);
  }
}

function normalizeRelativeFile(pathApi, rootPath, filePath) {
  return pathApi.relative(rootPath, filePath).split(pathApi.sep).join('/');
}

function validateRegistryDependencySpec(name, rawSpec, manifestPath) {
  const spec = String(rawSpec || '').trim();
  const normalized = spec.toLowerCase();
  if (!spec || normalized === '*' || normalized.startsWith('workspace:')) return;

  const forbiddenPrefix = /^(?:https?:|git(?:\+[^:]+)?:|ssh:|file:|link:|github:|gitlab:|bitbucket:)/i;
  const pathLike = /^(?:\.{0,2}[\\/]|~[\\/]|[\\/])/;
  const githubShorthand = /^[^@\s/]+\/[^\s/]+(?:#.*)?$/;
  if (forbiddenPrefix.test(spec) || pathLike.test(spec) || githubShorthand.test(spec)) {
    throw codedError(
      'LIVE_CORPUS_DEPENDENCY_SOURCE_DENIED',
      `A dependência ${name} usa uma fonte fora do registry npm autorizado.`,
      { manifestPath, name }
    );
  }

  if (normalized.startsWith('npm:')) {
    const aliased = spec.slice('npm:'.length);
    if (!aliased || forbiddenPrefix.test(aliased) || pathLike.test(aliased)) {
      throw codedError(
        'LIVE_CORPUS_DEPENDENCY_SOURCE_DENIED',
        `O alias npm da dependência ${name} não é seguro.`,
        { manifestPath, name }
      );
    }
  }
}

function walkProjectJsonFiles(fsApi, pathApi, rootPath, targetName) {
  const matches = [];
  const pending = [rootPath];
  while (pending.length) {
    const current = pending.pop();
    const entries = fsApi.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.faber') continue;
      const absolutePath = pathApi.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile() && entry.name === targetName) {
        matches.push(absolutePath);
        if (matches.length > MAX_PACKAGE_MANIFESTS) {
          throw codedError(
            'LIVE_CORPUS_MANIFEST_LIMIT_EXCEEDED',
            `Mais de ${MAX_PACKAGE_MANIFESTS} arquivos ${targetName} foram encontrados.`
          );
        }
      }
    }
  }
  return matches.sort();
}

function createApplicationCreationLiveCorpusPolicy(dependencies = {}) {
  const { fs, os, path } = dependencies;
  if (!fs) throw new Error('live corpus policy dependency missing: fs');
  if (!os) throw new Error('live corpus policy dependency missing: os');
  if (!path) throw new Error('live corpus policy dependency missing: path');

  function assertTemporaryWorkspace(rootPath) {
    const requested = String(rootPath || '').trim();
    if (!requested || !path.isAbsolute(requested) || !fs.existsSync(requested)) {
      throw codedError(
        'LIVE_CORPUS_WORKSPACE_NOT_TEMPORARY',
        'O corpus vivo exige um workspace temporário existente e absoluto.'
      );
    }
    const realTempRoot = fs.realpathSync(os.tmpdir());
    const realWorkspace = fs.realpathSync(requested);
    const stat = fs.statSync(realWorkspace);
    if (!stat.isDirectory() || !isInsideRoot(path, realTempRoot, realWorkspace)) {
      throw codedError(
        'LIVE_CORPUS_WORKSPACE_NOT_TEMPORARY',
        'O workspace do corpus vivo escapou da raiz temporária autorizada.'
      );
    }
    return realWorkspace;
  }

  function resolveOfficialProviderDestination(options = {}) {
    const providerId = String(options.providerId || '').trim().toLowerCase();
    const expected = PROVIDER_DESTINATIONS[providerId];
    let parsed;
    try {
      parsed = new URL(String(options.baseUrl || '').trim());
    } catch {
      parsed = null;
    }
    const normalizedPathname = parsed
      ? parsed.pathname.replace(/\/+$/, '') || '/'
      : '';
    if (!expected || !parsed || parsed.protocol !== 'https:'
      || parsed.origin !== expected.origin || parsed.username || parsed.password
      || parsed.search || parsed.hash || normalizedPathname !== expected.pathname) {
      throw codedError(
        'LIVE_CORPUS_PROVIDER_DESTINATION_DENIED',
        'O destino do provedor não corresponde a uma origem oficial autorizada.'
      );
    }
    return {
      providerId,
      providerOrigin: expected.origin,
      baseUrl: `${expected.origin}${expected.pathname}`,
    };
  }

  function inspectPackageManifests(rootPath) {
    const realWorkspace = assertTemporaryWorkspace(rootPath);
    const manifestFiles = walkProjectJsonFiles(fs, path, realWorkspace, 'package.json');
    const suppressedLifecycleScripts = [];
    let dependencyCount = 0;

    for (const manifestFile of manifestFiles) {
      const manifest = parseJsonFile(
        fs,
        manifestFile,
        'LIVE_CORPUS_PACKAGE_JSON_INVALID'
      );
      const relativeManifest = normalizeRelativeFile(path, realWorkspace, manifestFile);
      for (const section of DEPENDENCY_SECTIONS) {
        const dependenciesInSection = manifest && manifest[section];
        if (!dependenciesInSection || typeof dependenciesInSection !== 'object'
          || Array.isArray(dependenciesInSection)) continue;
        for (const [name, spec] of Object.entries(dependenciesInSection)) {
          dependencyCount += 1;
          validateRegistryDependencySpec(name, spec, relativeManifest);
        }
      }
      const scripts = manifest && manifest.scripts;
      if (scripts && typeof scripts === 'object' && !Array.isArray(scripts)) {
        for (const name of Object.keys(scripts).sort()) {
          if (INSTALL_LIFECYCLE_NAMES.has(String(name).toLowerCase())) {
            suppressedLifecycleScripts.push(`${relativeManifest}:${name}`);
          }
        }
      }
    }

    return Object.freeze({
      rootPath: realWorkspace,
      manifestFiles: Object.freeze(
        manifestFiles.map((filePath) => normalizeRelativeFile(path, realWorkspace, filePath))
      ),
      dependencyCount,
      suppressedLifecycleScripts: Object.freeze(suppressedLifecycleScripts),
    });
  }

  function buildNpmInstallInvocation(options = {}) {
    const inspection = inspectPackageManifests(options.rootPath);
    const command = String(options.npmExecutable || 'npm').trim() || 'npm';
    return Object.freeze({
      command,
      args: Object.freeze([
        'install',
        '--ignore-scripts',
        `--registry=${NPM_REGISTRY_URL}`,
        '--no-audit',
        '--no-fund',
        '--package-lock=true',
        '--foreground-scripts=false',
      ]),
      cwd: inspection.rootPath,
      registryOrigin: NPM_REGISTRY_ORIGIN,
      lifecycleScriptsEnabled: false,
      suppressedLifecycleScripts: inspection.suppressedLifecycleScripts,
      manifestFiles: inspection.manifestFiles,
      dependencyCount: inspection.dependencyCount,
    });
  }

  function buildNpmChildEnvironment(sourceEnvironment = {}, options = {}) {
    const environment = {};
    for (const key of ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'SYSTEMROOT']) {
      if (typeof sourceEnvironment[key] === 'string' && sourceEnvironment[key]) {
        environment[key] = sourceEnvironment[key];
      }
    }
    const networkGuardPath = String(options.networkGuardPath || '').trim();
    if (!networkGuardPath || !path.isAbsolute(networkGuardPath)) {
      throw codedError(
        'LIVE_CORPUS_NETWORK_GUARD_REQUIRED',
        'O processo npm exige o guard de rede absoluto.'
      );
    }
    const homePath = String(options.homePath || '').trim();
    if (!homePath) {
      throw codedError(
        'LIVE_CORPUS_TEMP_HOME_REQUIRED',
        'O processo npm exige um HOME temporário dedicado.'
      );
    }
    const realHomePath = assertTemporaryWorkspace(homePath);
    environment.HOME = realHomePath;
    environment.USERPROFILE = realHomePath;
    environment.NODE_OPTIONS = `--require=${JSON.stringify(networkGuardPath)}`;
    environment.npm_config_registry = NPM_REGISTRY_URL;
    environment.npm_config_ignore_scripts = 'true';
    environment.npm_config_audit = 'false';
    environment.npm_config_fund = 'false';
    environment.npm_config_update_notifier = 'false';
    environment.npm_config_progress = 'false';
    environment.npm_config_foreground_scripts = 'false';
    if (options.cachePath) environment.npm_config_cache = String(options.cachePath);
    if (options.userConfigPath) environment.npm_config_userconfig = String(options.userConfigPath);
    if (options.globalConfigPath) environment.npm_config_globalconfig = String(options.globalConfigPath);
    return Object.freeze(environment);
  }

  function isSafeWorkspaceLockLink(rootPath, lockfilePath, lockfile, entry, value) {
    if (!entry || entry.link !== true || !lockfile || typeof lockfile !== 'object') return false;
    const resolved = String(value || '').trim();
    if (!resolved || resolved.includes('\0') || path.isAbsolute(resolved)
      || /^[a-z][a-z0-9+.-]*:/i.test(resolved) || resolved.startsWith('~')) return false;

    const lockfileRoot = path.dirname(lockfilePath);
    const candidatePath = path.resolve(lockfileRoot, resolved);
    if (!isInsideRoot(path, rootPath, candidatePath) || !fs.existsSync(candidatePath)) return false;

    let realCandidate;
    try {
      realCandidate = fs.realpathSync(candidatePath);
    } catch {
      return false;
    }
    if (!isInsideRoot(path, rootPath, realCandidate)) return false;

    const packageManifest = path.join(realCandidate, 'package.json');
    try {
      if (!fs.statSync(packageManifest).isFile()) return false;
    } catch {
      return false;
    }

    const packages = lockfile.packages;
    if (!packages || typeof packages !== 'object' || Array.isArray(packages)) return false;
    const packageKey = normalizeRelativeFile(path, lockfileRoot, candidatePath);
    return Object.prototype.hasOwnProperty.call(packages, packageKey);
  }

  function auditResolvedTarget(rootPath, lockfilePath, lockfile, entryPath, entry, value) {
    const resolved = String(value || '').trim();
    if (!resolved) return false;
    let parsed;
    try {
      parsed = new URL(resolved);
    } catch {
      parsed = null;
    }
    if (parsed && parsed.protocol === 'https:' && parsed.origin === NPM_REGISTRY_ORIGIN
      && !parsed.username && !parsed.password) return 'registry';
    if (isSafeWorkspaceLockLink(rootPath, lockfilePath, lockfile, entry, resolved)) {
      return 'workspace';
    }

    throw codedError(
      'LIVE_CORPUS_LOCKFILE_EGRESS_DENIED',
      'O lockfile contém um artefato fora de registry.npmjs.org.',
      {
        lockfile: normalizeRelativeFile(path, rootPath, lockfilePath),
        entryPath,
      }
    );
  }

  function auditNpmLockfileEgress(rootPath) {
    const realWorkspace = assertTemporaryWorkspace(rootPath);
    const lockfiles = walkProjectJsonFiles(fs, path, realWorkspace, 'package-lock.json');
    let visitedNodes = 0;
    let resolvedArtifacts = 0;
    let workspaceLinks = 0;

    for (const lockfilePath of lockfiles) {
      const lockfile = parseJsonFile(
        fs,
        lockfilePath,
        'LIVE_CORPUS_PACKAGE_LOCK_INVALID'
      );
      const pending = [{ value: lockfile, entryPath: '$' }];
      while (pending.length) {
        const current = pending.pop();
        visitedNodes += 1;
        if (visitedNodes > MAX_LOCKFILE_NODES) {
          throw codedError(
            'LIVE_CORPUS_LOCKFILE_LIMIT_EXCEEDED',
            'O lockfile excedeu o limite estrutural da auditoria.'
          );
        }
        const value = current.value;
        if (!value || typeof value !== 'object') continue;
        if (typeof value.resolved === 'string' && value.resolved) {
          const resolvedKind = auditResolvedTarget(
            realWorkspace,
            lockfilePath,
            lockfile,
            current.entryPath,
            value,
            value.resolved
          );
          if (resolvedKind === 'registry') resolvedArtifacts += 1;
          if (resolvedKind === 'workspace') workspaceLinks += 1;
        }
        if (Array.isArray(value)) {
          value.forEach((child, index) => pending.push({
            value: child,
            entryPath: `${current.entryPath}[${index}]`,
          }));
        } else {
          for (const [key, child] of Object.entries(value)) {
            if (key === 'resolved') continue;
            pending.push({
              value: child,
              entryPath: `${current.entryPath}.${key}`,
            });
          }
        }
      }
    }

    return Object.freeze({
      ok: true,
      registryOrigin: NPM_REGISTRY_ORIGIN,
      lockfiles: Object.freeze(
        lockfiles.map((filePath) => normalizeRelativeFile(path, realWorkspace, filePath))
      ),
      resolvedArtifacts,
      workspaceLinks,
    });
  }

  return Object.freeze({
    assertTemporaryWorkspace,
    auditNpmLockfileEgress,
    buildNpmChildEnvironment,
    buildNpmInstallInvocation,
    inspectPackageManifests,
    resolveOfficialProviderDestination,
  });
}

module.exports = {
  NPM_REGISTRY_ORIGIN,
  NPM_REGISTRY_URL,
  createApplicationCreationLiveCorpusPolicy,
};
