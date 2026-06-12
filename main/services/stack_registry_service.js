const defaultFs = require('fs');
const defaultPath = require('path');

const DEFAULT_MAX_PLUGIN_FILES = 40;
const DEFAULT_MAX_PLUGIN_BYTES = 64 * 1024;

const BUILTIN_STACK_PROFILES = [
  {
    id: 'next',
    label: 'Next.js',
    category: 'web',
    aliases: ['next', 'nextjs'],
    source: 'builtin',
    detect: {
      packageDependencies: ['next'],
      files: [
        'app/page.tsx',
        'app/page.jsx',
        'src/app/page.tsx',
        'src/app/page.jsx',
        'pages/index.tsx',
        'pages/index.jsx',
        'src/pages/index.tsx',
        'src/pages/index.jsx',
      ],
    },
    preview: {
      mode: 'server',
      script: 'dev',
      defaultPort: 3000,
      hostFlag: '--hostname',
    },
    verification: {
      requiredScripts: ['build'],
      optionalScripts: ['typecheck', 'lint', 'test'],
    },
  },
  {
    id: 'react',
    label: 'React',
    category: 'web',
    aliases: ['react'],
    source: 'builtin',
    detect: {
      packageDependencies: ['react'],
      excludePackageDependencies: ['next'],
    },
    preview: {
      mode: 'server',
      script: 'dev',
      defaultPort: 5173,
      hostFlag: '--host',
    },
    verification: {
      requiredScripts: ['build'],
      optionalScripts: ['typecheck', 'lint', 'test'],
    },
  },
  {
    id: 'tailwind',
    label: 'Tailwind CSS',
    category: 'style',
    aliases: ['tailwind', 'tailwindcss'],
    source: 'builtin',
    detect: {
      packageDependencies: ['tailwindcss', '@tailwindcss/postcss'],
      files: [
        'tailwind.config.js',
        'tailwind.config.cjs',
        'tailwind.config.mjs',
        'tailwind.config.ts',
        'postcss.config.js',
        'postcss.config.cjs',
        'postcss.config.mjs',
      ],
    },
    verification: {
      requiredFilesAny: ['app/globals.css', 'src/app/globals.css', 'styles/globals.css', 'style.css'],
    },
  },
  {
    id: 'electron',
    label: 'Electron',
    category: 'desktop',
    aliases: ['electron'],
    source: 'builtin',
    detect: {
      packageDependencies: ['electron'],
    },
    preview: {
      mode: 'app',
      script: 'dev',
    },
    verification: {
      optionalScripts: ['build', 'typecheck', 'lint', 'test'],
      entryFilesAny: ['main.js', 'electron/main.js', 'src/main.js'],
    },
  },
  {
    id: 'vue',
    label: 'Vue',
    category: 'web',
    aliases: ['vue'],
    source: 'builtin',
    detect: {
      packageDependencies: ['vue'],
      excludePackageDependencies: ['next'],
    },
    preview: {
      mode: 'server',
      script: 'dev',
      defaultPort: 5173,
      hostFlag: '--host',
    },
  },
  {
    id: 'express',
    label: 'Node/Express',
    category: 'server',
    aliases: ['express', 'node express'],
    source: 'builtin',
    detect: {
      packageDependencies: ['express'],
    },
    verification: {
      optionalScripts: ['typecheck', 'lint', 'test'],
    },
  },
  {
    id: 'lamp',
    label: 'PHP/LAMP',
    category: 'web',
    aliases: ['php', 'lamp'],
    source: 'builtin',
    detect: {
      files: ['index.php', 'public/index.php', 'composer.json'],
      counters: {
        php: { min: 1 },
      },
    },
    preview: {
      mode: 'server',
      runtime: 'php',
      defaultPort: 8080,
      entryFilesAny: ['public/index.php', 'index.php'],
    },
    verification: {
      phpLint: true,
      entryFilesAny: ['public/index.php', 'index.php'],
    },
  },
  {
    id: 'python',
    label: 'Python',
    category: 'server',
    aliases: ['python', 'py'],
    source: 'builtin',
    detect: {
      counters: {
        py: { min: 1 },
      },
    },
  },
  {
    id: 'java',
    label: 'Java',
    category: 'server',
    aliases: ['java'],
    source: 'builtin',
    detect: {
      counters: {
        java: { min: 1 },
      },
    },
  },
];

function normalizeRegistryText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toPosixPath(value = '') {
  return String(value || '').replace(/\\/g, '/');
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function createDependencySet(packageJson = {}) {
  const manifest = isPlainObject(packageJson) ? packageJson : {};
  return new Set(
    Object.keys({
      ...(manifest.dependencies || {}),
      ...(manifest.devDependencies || {}),
      ...(manifest.peerDependencies || {}),
      ...(manifest.optionalDependencies || {}),
    }).map((dependency) => normalizeRegistryText(dependency))
  );
}

function normalizeFileSet(files = []) {
  return new Set(
    (Array.isArray(files) ? files : [])
      .map((file) => toPosixPath(file).toLowerCase())
      .filter(Boolean)
  );
}

function hasAny(values = [], predicate) {
  return values.some((value) => predicate(value));
}

function hasAll(values = [], predicate) {
  return values.every((value) => predicate(value));
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsSearchTerm(source, term) {
  const normalizedSource = normalizeRegistryText(source);
  const normalizedTerm = normalizeRegistryText(term);
  if (!normalizedSource || !normalizedTerm || normalizedTerm.length < 2) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`, 'i');
  return pattern.test(normalizedSource);
}

function sanitizeDetectConfig(detect = {}) {
  const source = isPlainObject(detect) ? detect : {};
  return {
    packageDependencies: asStringArray(source.packageDependencies),
    requiredPackageDependencies: asStringArray(source.requiredPackageDependencies),
    excludePackageDependencies: asStringArray(source.excludePackageDependencies),
    files: asStringArray(source.files).map(toPosixPath),
    requiredFiles: asStringArray(source.requiredFiles).map(toPosixPath),
    fileExtensions: asStringArray(source.fileExtensions).map((extension) => {
      const normalized = String(extension || '').trim().toLowerCase();
      return normalized && !normalized.startsWith('.') ? `.${normalized}` : normalized;
    }).filter(Boolean),
    counters: isPlainObject(source.counters) ? source.counters : {},
  };
}

function normalizeProfile(rawProfile, source = 'plugin') {
  if (!isPlainObject(rawProfile)) return null;

  const id = String(rawProfile.id || '').trim();
  const label = String(rawProfile.label || rawProfile.name || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(id)) return null;
  if (!label || label.length > 80) return null;

  return {
    id,
    label,
    category: String(rawProfile.category || 'custom').trim() || 'custom',
    aliases: uniqueStrings(asStringArray(rawProfile.aliases)),
    source,
    detect: sanitizeDetectConfig(rawProfile.detect),
    preview: isPlainObject(rawProfile.preview) ? { ...rawProfile.preview } : {},
    verification: isPlainObject(rawProfile.verification) ? { ...rawProfile.verification } : {},
    blueprint: isPlainObject(rawProfile.blueprint) ? { ...rawProfile.blueprint } : {},
  };
}

function createStackRegistryService(dependencies = {}) {
  const {
    builtinProfiles = BUILTIN_STACK_PROFILES,
    fs = defaultFs,
    maxPluginBytes = DEFAULT_MAX_PLUGIN_BYTES,
    maxPluginFiles = DEFAULT_MAX_PLUGIN_FILES,
    path = defaultPath,
    pluginDirectories = [],
    pluginProfiles = [],
    projectPluginDirectory = path.join('.faber', 'stacks'),
  } = dependencies;

  const normalizedBuiltins = builtinProfiles
    .map((profile) => normalizeProfile(profile, 'builtin'))
    .filter(Boolean);
  const normalizedInjectedPlugins = pluginProfiles
    .map((profile) => normalizeProfile(profile, 'plugin'))
    .filter(Boolean);

  function safeReadJson(filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > maxPluginBytes) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  function safeListPluginFiles(pluginDirectory) {
    try {
      const stat = fs.statSync(pluginDirectory);
      if (!stat.isDirectory()) return [];
      return fs.readdirSync(pluginDirectory)
        .filter((entry) => entry.toLowerCase().endsWith('.json'))
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .slice(0, maxPluginFiles)
        .map((entry) => path.join(pluginDirectory, entry));
    } catch {
      return [];
    }
  }

  function loadPluginProfiles(pluginDirectory) {
    const profiles = [];
    for (const filePath of safeListPluginFiles(pluginDirectory)) {
      const raw = safeReadJson(filePath);
      const entries = Array.isArray(raw) ? raw : [raw];
      for (const entry of entries) {
        const normalized = normalizeProfile(entry, 'plugin');
        if (normalized) profiles.push({ ...normalized, pluginPath: filePath });
      }
    }
    return profiles;
  }

  function collectProfiles(rootPath = '') {
    const loadedPlugins = [];
    for (const directory of pluginDirectories) {
      loadedPlugins.push(...loadPluginProfiles(directory));
    }

    const safeRootPath = String(rootPath || '').trim();
    if (safeRootPath && projectPluginDirectory) {
      loadedPlugins.push(...loadPluginProfiles(path.join(safeRootPath, projectPluginDirectory)));
    }

    const byId = new Map();
    for (const profile of normalizedBuiltins) byId.set(profile.id, profile);
    for (const profile of normalizedInjectedPlugins) {
      if (!byId.has(profile.id)) byId.set(profile.id, profile);
    }
    for (const profile of loadedPlugins) {
      if (!byId.has(profile.id)) byId.set(profile.id, profile);
    }
    return Array.from(byId.values());
  }

  function hasDependency(dependencySet, dependencyName) {
    return dependencySet.has(normalizeRegistryText(dependencyName));
  }

  function hasFile(fileSet, relativePath) {
    return fileSet.has(toPosixPath(relativePath).toLowerCase());
  }

  function hasFileExtension(fileSet, extension) {
    const normalizedExtension = String(extension || '').toLowerCase();
    return Array.from(fileSet).some((file) => file.endsWith(normalizedExtension));
  }

  function counterMatches(counters = {}, counterConfig = {}) {
    const entries = Object.entries(isPlainObject(counterConfig) ? counterConfig : {});
    if (!entries.length) return false;

    return entries.some(([counterName, rule]) => {
      const count = Number(counters[counterName] || 0);
      if (typeof rule === 'number') return count >= rule;
      if (isPlainObject(rule)) {
        const min = Number(rule.min || 0);
        const max = Number(rule.max || Number.POSITIVE_INFINITY);
        return count >= min && count <= max;
      }
      return count > 0;
    });
  }

  function matchProfile(profile, project = {}) {
    const detect = sanitizeDetectConfig(profile && profile.detect);
    const dependencySet = createDependencySet(project.packageJson);
    const fileSet = normalizeFileSet(project.files);

    if (detect.excludePackageDependencies.length &&
      hasAny(detect.excludePackageDependencies, (dependency) => hasDependency(dependencySet, dependency))) {
      return { matched: false, reasons: [] };
    }

    if (detect.requiredPackageDependencies.length &&
      !hasAll(detect.requiredPackageDependencies, (dependency) => hasDependency(dependencySet, dependency))) {
      return { matched: false, reasons: [] };
    }

    if (detect.requiredFiles.length &&
      !hasAll(detect.requiredFiles, (file) => hasFile(fileSet, file))) {
      return { matched: false, reasons: [] };
    }

    const reasons = [];
    if (detect.packageDependencies.length &&
      hasAny(detect.packageDependencies, (dependency) => hasDependency(dependencySet, dependency))) {
      reasons.push('package');
    }
    if (detect.files.length && hasAny(detect.files, (file) => hasFile(fileSet, file))) {
      reasons.push('file');
    }
    if (detect.fileExtensions.length && hasAny(detect.fileExtensions, (extension) => hasFileExtension(fileSet, extension))) {
      reasons.push('extension');
    }
    if (counterMatches(project.counters, detect.counters)) {
      reasons.push('counter');
    }

    const requiredOnlyMatch = Boolean(
      (detect.requiredPackageDependencies.length || detect.requiredFiles.length) &&
      !reasons.length
    );
    return {
      matched: reasons.length > 0 || requiredOnlyMatch,
      reasons: reasons.length ? reasons : (requiredOnlyMatch ? ['required'] : []),
    };
  }

  function detectProjectStacks(project = {}) {
    const rootPath = String(project.rootPath || '').trim();
    const packageJson = project.packageJson || (rootPath ? safeReadJson(path.join(rootPath, 'package.json')) : null);
    const files = Array.isArray(project.files) ? project.files : [];
    const counters = isPlainObject(project.counters) ? project.counters : {};
    const matches = [];

    for (const profile of collectProfiles(rootPath)) {
      const result = matchProfile(profile, { ...project, packageJson, files, counters });
      if (result.matched) {
        matches.push({
          id: profile.id,
          label: profile.label,
          category: profile.category,
          source: profile.source,
          reasons: result.reasons,
        });
      }
    }

    const stacks = uniqueStrings(matches.map((match) => match.label));
    return {
      stacks: stacks.length ? stacks : ['Projeto genérico'],
      matches,
    };
  }

  function getProfile(profileId, rootPath = '') {
    const expected = String(profileId || '').trim();
    return collectProfiles(rootPath).find((profile) => profile.id === expected) || null;
  }

  function buildProfileSearchTerms(profile) {
    const detect = sanitizeDetectConfig(profile && profile.detect);
    return uniqueStrings([
      profile && profile.id,
      profile && profile.label,
      ...(profile && Array.isArray(profile.aliases) ? profile.aliases : []),
      ...detect.packageDependencies,
    ]);
  }

  function resolveStackProfilesFromText(text = '', rootPath = '') {
    const source = String(text || '');
    if (!source.trim()) return [];

    return collectProfiles(rootPath)
      .map((profile) => {
        const terms = buildProfileSearchTerms(profile);
        const matchedTerms = terms.filter((term) => containsSearchTerm(source, term));
        if (!matchedTerms.length) return null;
        return {
          ...profile,
          match: {
            reasons: ['text'],
            terms: matchedTerms,
          },
        };
      })
      .filter(Boolean);
  }

  return {
    detectProjectStacks,
    getProfile,
    getProfiles: collectProfiles,
    loadPluginProfiles,
    matchProfile,
    normalizeProfile,
    resolveStackProfilesFromText,
  };
}

module.exports = {
  BUILTIN_STACK_PROFILES,
  createStackRegistryService,
  normalizeRegistryText,
  normalizeProfile,
};
