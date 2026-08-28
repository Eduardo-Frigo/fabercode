const defaultFs = require('fs');
const defaultPath = require('path');

function normalizeVerificationText(value = '') {
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

function createProjectVerificationService(dependencies = {}) {
  const {
    fs = defaultFs,
    path = defaultPath,
    runCommand = async () => ({ ok: false, stdout: '', stderr: 'runCommand unavailable' }),
    timeoutMs = 120000,
  } = dependencies;

  function safeExists(filePath) {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  function safeReadJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  function safeReadText(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  }

  function stripJsonCommentsAndTrailingCommas(value = '') {
    const source = String(value || '').replace(/^\uFEFF/, '');
    let withoutComments = '';
    let inString = false;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
      const current = source[index];
      const next = source[index + 1];
      if (inString) {
        withoutComments += current;
        if (escaped) escaped = false;
        else if (current === '\\') escaped = true;
        else if (current === '"') inString = false;
        continue;
      }
      if (current === '"') {
        inString = true;
        withoutComments += current;
        continue;
      }
      if (current === '/' && next === '/') {
        index += 2;
        while (index < source.length && source[index] !== '\n') index += 1;
        if (index < source.length) withoutComments += '\n';
        continue;
      }
      if (current === '/' && next === '*') {
        index += 2;
        while (index < source.length - 1
          && !(source[index] === '*' && source[index + 1] === '/')) {
          if (source[index] === '\n') withoutComments += '\n';
          index += 1;
        }
        index += 1;
        continue;
      }
      withoutComments += current;
    }

    let output = '';
    inString = false;
    escaped = false;
    for (let index = 0; index < withoutComments.length; index += 1) {
      const current = withoutComments[index];
      if (inString) {
        output += current;
        if (escaped) escaped = false;
        else if (current === '\\') escaped = true;
        else if (current === '"') inString = false;
        continue;
      }
      if (current === '"') {
        inString = true;
        output += current;
        continue;
      }
      if (current === ',') {
        let lookahead = index + 1;
        while (lookahead < withoutComments.length && /\s/.test(withoutComments[lookahead])) {
          lookahead += 1;
        }
        if (withoutComments[lookahead] === '}' || withoutComments[lookahead] === ']') continue;
      }
      output += current;
    }
    return output;
  }

  function safeReadJsonLike(filePath) {
    try {
      return JSON.parse(stripJsonCommentsAndTrailingCommas(fs.readFileSync(filePath, 'utf8')));
    } catch {
      return null;
    }
  }

  function normalizeStacks(projectInfo = {}) {
    return (Array.isArray(projectInfo && projectInfo.stacks) ? projectInfo.stacks : [])
      .map((stack) => String(stack || '').trim())
      .filter(Boolean);
  }

  function hasStack(projectInfo, expectedStack) {
    const expected = normalizeVerificationText(expectedStack);
    return normalizeStacks(projectInfo).some((stack) => normalizeVerificationText(stack) === expected);
  }

  function collectKnownFiles(projectInfo = {}) {
    return new Set(
      (Array.isArray(projectInfo && projectInfo.files) ? projectInfo.files : [])
        .map(toPosixPath)
        .filter(Boolean)
    );
  }

  function hasProjectFile(rootPath, knownFiles, relativePath) {
    const relPath = toPosixPath(relativePath);
    return knownFiles.has(relPath) || safeExists(path.join(rootPath, relPath));
  }

  function dependencyMap(packageJson = {}) {
    const manifest = packageJson && typeof packageJson === 'object' ? packageJson : {};
    return {
      ...(manifest.dependencies || {}),
      ...(manifest.devDependencies || {}),
    };
  }

  function packageHasDependency(packageJson, dependencyName) {
    const deps = dependencyMap(packageJson);
    return Object.prototype.hasOwnProperty.call(deps, dependencyName);
  }

  function parseSemver(value = '') {
    const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      raw: match[0],
    };
  }

  function compareSemver(a, b) {
    if (!a || !b) return 0;
    for (const key of ['major', 'minor', 'patch']) {
      if (a[key] > b[key]) return 1;
      if (a[key] < b[key]) return -1;
    }
    return 0;
  }

  function installedVersionSatisfiesSpec(installedVersion = '', requestedSpec = '') {
    const spec = String(requestedSpec || '').trim();
    if (!spec) return true;
    const base = parseSemver(spec);
    if (!base) return true;
    const installed = parseSemver(installedVersion);
    if (!installed) return false;
    if (/^\d+\.\d+\.\d+$/.test(spec)) return installed.raw === base.raw;
    if (spec.startsWith('~')) {
      return installed.major === base.major && installed.minor === base.minor && compareSemver(installed, base) >= 0;
    }
    if (spec.startsWith('^')) {
      return installed.major === base.major && compareSemver(installed, base) >= 0;
    }
    return true;
  }

  function collectDependencyInstallIssues(rootPath, packageJson, dependenciesInstalled) {
    if (!packageJson) return [];
    if (!dependenciesInstalled) return ['node_modules ausente'];
    const issues = [];
    for (const [packageName, requestedSpec] of Object.entries(dependencyMap(packageJson))) {
      const packageJsonPath = path.join(rootPath, 'node_modules', ...String(packageName || '').split('/'), 'package.json');
      const installedPackage = safeReadJson(packageJsonPath);
      if (!installedPackage || !installedPackage.version) {
        issues.push(`${packageName} ausente em node_modules`);
      } else if (!installedVersionSatisfiesSpec(installedPackage.version, requestedSpec)) {
        issues.push(`${packageName} instalado em ${installedPackage.version}, solicitado ${requestedSpec}`);
      }
      if (issues.length >= 8) break;
    }
    return issues;
  }

  function packageHasScript(packageJson, scriptName) {
    return Boolean(packageJson && packageJson.scripts && typeof packageJson.scripts[scriptName] === 'string');
  }

  function resolveRequiredNodeScripts(options = {}) {
    const required = new Set();
    const entries = Array.isArray(options.requiredNodeScripts) ? options.requiredNodeScripts : [];
    for (const entry of entries) {
      const name = String(entry || '').trim();
      if (name) required.add(name);
    }
    if (options.requireNodeBuild === true) required.add('build');
    if (options.requireNodeTests === true) required.add('test');
    return required;
  }

  function resolvePlaywrightRequired(options = {}, hasPlaywrightCapability = false) {
    const mode = options.requirePlaywright;
    if (mode === 'if_available' || mode === 'when_available' || mode === 'auto') {
      return Boolean(hasPlaywrightCapability);
    }
    return Boolean(mode);
  }

  function isPlaceholderTestScript(scriptValue = '') {
    const source = normalizeVerificationText(scriptValue);
    return source.includes('no test specified') || source.includes('sem testes') || source.includes('exit 1');
  }

  function findPlaywrightConfig(rootPath, knownFiles) {
    const candidates = [
      'playwright.config.ts',
      'playwright.config.js',
      'playwright.config.mjs',
      'playwright.config.cjs',
      'e2e/playwright.config.ts',
      'tests/playwright.config.ts',
    ];
    return candidates.find((candidate) => hasProjectFile(rootPath, knownFiles, candidate)) || '';
  }

  function findPlaywrightScript(packageJson = {}) {
    const scripts = packageJson && packageJson.scripts && typeof packageJson.scripts === 'object'
      ? packageJson.scripts
      : {};
    const preferred = ['test:e2e', 'e2e', 'test:playwright', 'playwright'];
    for (const name of preferred) {
      if (typeof scripts[name] === 'string' && /playwright/i.test(scripts[name])) return name;
    }
    for (const [name, value] of Object.entries(scripts)) {
      if (/playwright/i.test(String(name)) || /playwright\s+test/i.test(String(value))) return name;
    }
    return '';
  }

  function detectPackageManager(rootPath) {
    if (safeExists(path.join(rootPath, 'pnpm-lock.yaml'))) return 'pnpm';
    if (safeExists(path.join(rootPath, 'yarn.lock'))) return 'yarn';
    if (safeExists(path.join(rootPath, 'bun.lockb')) || safeExists(path.join(rootPath, 'bun.lock'))) return 'bun';
    return 'npm';
  }

  function buildScriptCommand(packageManager, scriptName) {
    if (packageManager === 'yarn') return { bin: 'yarn', args: [scriptName] };
    if (packageManager === 'bun') return { bin: 'bun', args: ['run', scriptName] };
    if (packageManager === 'pnpm') return { bin: 'pnpm', args: ['run', scriptName] };
    return { bin: 'npm', args: scriptName === 'test' ? ['test'] : ['run', scriptName] };
  }

  function buildInstallCommand(packageManager) {
    if (packageManager === 'yarn') return { bin: 'yarn', args: ['install'] };
    if (packageManager === 'bun') return { bin: 'bun', args: ['install'] };
    if (packageManager === 'pnpm') return { bin: 'pnpm', args: ['install'] };
    return { bin: 'npm', args: ['install'] };
  }

  function commandText(command) {
    if (!command || !command.bin) return '';
    return [command.bin, ...(Array.isArray(command.args) ? command.args : [])].join(' ');
  }

  function buildStaticStep({ id, label, ok, detail, required = true }) {
    return {
      id,
      label,
      kind: 'static',
      required,
      expectedStatus: ok ? 'passed' : 'failed',
      detail,
    };
  }

  function buildManualStep({ id, label, command, detail, required = true }) {
    return {
      id,
      label,
      kind: 'manual',
      required,
      command,
      commandText: commandText(command),
      detail,
    };
  }

  function buildCommandStep({ id, label, command, detail, required = true, blockedBy = [] }) {
    return {
      id,
      label,
      kind: 'command',
      required,
      command,
      commandText: commandText(command),
      blockedBy,
      timeoutMs,
      detail,
    };
  }

  function normalizeBlockedBy(blockedBy = []) {
    return Array.from(new Set((Array.isArray(blockedBy) ? blockedBy : []).filter(Boolean)));
  }

  function isAbortSignalAborted(signal) {
    return Boolean(signal && signal.aborted);
  }

  function collectPhpFiles(projectInfo, knownFiles, rootPath) {
    const fromProject = Array.from(knownFiles).filter((file) => path.extname(file).toLowerCase() === '.php');
    const prioritized = [];
    for (const file of ['index.php', 'public/index.php']) {
      if (hasProjectFile(rootPath, knownFiles, file)) prioritized.push(file);
    }
    for (const file of fromProject) {
      if (!prioritized.includes(file)) prioritized.push(file);
    }
    return prioritized.slice(0, 12);
  }

  function hasAnyEntry(rootPath, knownFiles, entries = []) {
    return entries.some((entry) => hasProjectFile(rootPath, knownFiles, entry));
  }

  function hasKnownFileMatching(rootPath, knownFiles, predicate) {
    for (const file of knownFiles) {
      if (predicate(toPosixPath(file))) return true;
    }
    try {
      const stack = [rootPath];
      while (stack.length) {
        const current = stack.pop();
        const dirents = fs.readdirSync(current, { withFileTypes: true });
        for (const dirent of dirents) {
          if (!dirent || !dirent.name) continue;
          if (['node_modules', '.next', '.git', '.faber'].includes(dirent.name)) continue;
          const absPath = path.join(current, dirent.name);
          const relPath = toPosixPath(path.relative(rootPath, absPath));
          if (dirent.isDirectory()) {
            stack.push(absPath);
          } else if (predicate(relPath)) {
            return true;
          }
        }
      }
    } catch {
      // best-effort static scan only
    }
    return false;
  }

  const ACCEPTANCE_SOURCE_EXTENSIONS = new Set([
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.mjs',
    '.cjs',
    '.py',
    '.php',
    '.html',
    '.htm',
    '.vue',
    '.svelte',
  ]);

  function isSafeAcceptanceSourcePath(relativePath = '') {
    const relPath = toPosixPath(relativePath).replace(/^\.\/+/, '');
    if (!relPath || relPath.startsWith('/') || /^[a-z]:\//i.test(relPath)) return false;
    if (relPath.split('/').includes('..')) return false;
    if (/(^|\/)(node_modules|\.next|\.git|\.faber|dist|build|coverage|vendor)(\/|$)/i.test(relPath)) return false;
    if (/(^|\/)(tests?|__tests__|fixtures?|docs?|examples?)(\/|$)/i.test(relPath)) return false;
    if (/\.(?:test|spec)\.[^.]+$/i.test(relPath)) return false;
    return ACCEPTANCE_SOURCE_EXTENSIONS.has(path.extname(relPath).toLowerCase());
  }

  function collectAcceptanceSourceEntries(rootPath, knownFiles) {
    const candidateFiles = new Set();
    const maxCandidates = 400;
    const addCandidate = (value) => {
      if (candidateFiles.size >= maxCandidates) return;
      const relPath = toPosixPath(value).replace(/^\.\/+/, '');
      if (isSafeAcceptanceSourcePath(relPath)) candidateFiles.add(relPath);
    };

    for (const relPath of knownFiles) addCandidate(relPath);

    try {
      const pendingDirectories = [rootPath];
      let visitedDirectories = 0;
      while (pendingDirectories.length && candidateFiles.size < maxCandidates && visitedDirectories < 240) {
        const current = pendingDirectories.pop();
        visitedDirectories += 1;
        const dirents = fs.readdirSync(current, { withFileTypes: true });
        for (const dirent of dirents) {
          if (!dirent || !dirent.name || dirent.isSymbolicLink()) continue;
          const absPath = path.join(current, dirent.name);
          const relPath = toPosixPath(path.relative(rootPath, absPath));
          if (dirent.isDirectory()) {
            if (!/(^|\/)(node_modules|\.next|\.git|\.faber|dist|build|coverage|vendor|tests?|__tests__|fixtures?|docs?|examples?)(\/|$)/i.test(relPath)) {
              pendingDirectories.push(absPath);
            }
          } else {
            addCandidate(relPath);
          }
          if (candidateFiles.size >= maxCandidates) break;
        }
      }
    } catch {
      // The project scan remains best-effort and bounded.
    }

    const entries = [];
    let totalCharacters = 0;
    for (const relPath of Array.from(candidateFiles).sort()) {
      if (entries.length >= 200 || totalCharacters >= 1500000) break;
      const content = safeReadText(path.join(rootPath, relPath)).slice(0, 120000);
      totalCharacters += content.length;
      entries.push({ path: relPath, content });
    }
    return entries;
  }

  function inspectCriticalJsonSyntax(rootPath, knownFiles) {
    const candidates = new Set();
    const addCandidate = (relativePath) => {
      const normalized = toPosixPath(relativePath).replace(/^\.\/+/, '');
      if (!normalized || /(^|\/)node_modules(\/|$)/.test(normalized)) return;
      if (/(^|\/)package\.json$/i.test(normalized)
        || /(^|\/)(?:tsconfig(?:\.[^/]+)?|jsconfig)\.json$/i.test(normalized)) {
        if (safeExists(path.join(rootPath, normalized))) candidates.add(normalized);
      }
    };
    for (const relativePath of knownFiles) addCandidate(relativePath);
    for (const relativePath of ['package.json', 'tsconfig.json', 'jsconfig.json']) {
      addCandidate(relativePath);
    }

    const issues = [];
    for (const relativePath of [...candidates].sort().slice(0, 128)) {
      const filePath = path.join(rootPath, relativePath);
      const isJsonConfig = /(^|\/)(?:tsconfig(?:\.[^/]+)?|jsconfig)\.json$/i.test(relativePath);
      try {
        const source = fs.readFileSync(filePath, 'utf8');
        JSON.parse(isJsonConfig ? stripJsonCommentsAndTrailingCommas(source) : source);
      } catch {
        issues.push(relativePath);
      }
    }
    return { checked: candidates.size, issues };
  }

  const LOCAL_MODULE_EXTENSIONS = Object.freeze([
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.mjs',
    '.cjs',
    '.json',
    '.css',
    '.scss',
    '.sass',
    '.less',
    '.node',
  ]);

  function isInsideProjectRoot(rootPath, candidatePath) {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || Boolean(
      relative
        && relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative)
    );
  }

  function localModuleTargetExists(rootPath, basePath) {
    if (!isInsideProjectRoot(rootPath, basePath)) return false;
    const candidates = [basePath];
    if (!path.extname(basePath)) {
      for (const extension of LOCAL_MODULE_EXTENSIONS) {
        candidates.push(`${basePath}${extension}`);
        candidates.push(path.join(basePath, `index${extension}`));
      }
      candidates.push(path.join(basePath, 'package.json'));
    }
    return candidates.some((candidate) => {
      if (!isInsideProjectRoot(rootPath, candidate) || !safeExists(candidate)) return false;
      try {
        return fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
  }

  function readLocalAliasRules(rootPath) {
    const configPath = ['tsconfig.json', 'jsconfig.json']
      .map((name) => path.join(rootPath, name))
      .find(safeExists);
    const config = configPath ? safeReadJsonLike(configPath) : null;
    const compilerOptions = config && config.compilerOptions && typeof config.compilerOptions === 'object'
      ? config.compilerOptions
      : {};
    const rawBaseUrl = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
    const baseUrl = path.resolve(rootPath, rawBaseUrl);
    const safeBaseUrl = isInsideProjectRoot(rootPath, baseUrl) ? baseUrl : rootPath;
    const paths = compilerOptions.paths && typeof compilerOptions.paths === 'object'
      && !Array.isArray(compilerOptions.paths)
      ? compilerOptions.paths
      : {};
    const rules = [];
    for (const [key, rawTargets] of Object.entries(paths)) {
      if (!['@/', '~/'].some((prefix) => String(key).startsWith(prefix))) continue;
      const targets = Array.isArray(rawTargets) ? rawTargets : [];
      for (const target of targets.slice(0, 8)) {
        if (typeof target !== 'string' || !target.trim()) continue;
        rules.push({ key: String(key), target: target.trim(), baseUrl: safeBaseUrl });
      }
    }
    return rules;
  }

  function resolveAliasModuleBases(rootPath, specifier, aliasRules) {
    const candidates = [];
    for (const rule of aliasRules) {
      const wildcardIndex = rule.key.indexOf('*');
      if (wildcardIndex === -1) {
        if (specifier === rule.key) candidates.push(path.resolve(rule.baseUrl, rule.target));
        continue;
      }
      const prefix = rule.key.slice(0, wildcardIndex);
      const suffix = rule.key.slice(wildcardIndex + 1);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      const wildcardValue = specifier.slice(prefix.length, specifier.length - suffix.length);
      candidates.push(path.resolve(rule.baseUrl, rule.target.replace('*', wildcardValue)));
    }
    if (!candidates.length && (specifier.startsWith('@/') || specifier.startsWith('~/'))) {
      const relative = specifier.slice(2);
      candidates.push(path.resolve(rootPath, relative));
      candidates.push(path.resolve(rootPath, 'src', relative));
    }
    return candidates;
  }

  function collectLocalModuleSpecifiers(content = '') {
    const specifiers = new Set();
    const patterns = [
      /\b(?:import|export)\s+(?:type\s+)?(?:[^;'"`]*?\s+from\s+)?['"]([^'"]+)['"]/g,
      /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(String(content || '')))) {
        const specifier = String(match[1] || '').split(/[?#]/, 1)[0].trim();
        if ((specifier.startsWith('./') || specifier.startsWith('../')
          || specifier.startsWith('@/') || specifier.startsWith('~/'))
          && !specifier.includes('${')) {
          specifiers.add(specifier);
        }
        if (specifiers.size >= 200) break;
      }
    }
    return [...specifiers];
  }

  function inspectLocalModuleResolution(rootPath, knownFiles) {
    const aliasRules = readLocalAliasRules(rootPath);
    const issues = [];
    let importsChecked = 0;
    for (const entry of collectAcceptanceSourceEntries(rootPath, knownFiles)) {
      for (const specifier of collectLocalModuleSpecifiers(entry.content)) {
        importsChecked += 1;
        const importerPath = path.join(rootPath, entry.path);
        const candidates = specifier.startsWith('./') || specifier.startsWith('../')
          ? [path.resolve(path.dirname(importerPath), specifier)]
          : resolveAliasModuleBases(rootPath, specifier, aliasRules);
        if (!candidates.some((candidate) => localModuleTargetExists(rootPath, candidate))) {
          issues.push({ importer: entry.path, specifier });
          if (issues.length >= 12) return { importsChecked, issues };
        }
      }
    }
    return { importsChecked, issues };
  }

  function inferRequestedProductCapabilities(options = {}) {
    const context = normalizeVerificationText([
      options.userMessage,
      options.acceptanceContext,
    ].filter(Boolean).join('\n'));
    const hasAllCrudTerms = [
      /\b(create|criar|cadastro|cadastrar)\b/,
      /\b(read|ler|listar|consulta|consultar)\b/,
      /\b(update|atualizar|editar)\b/,
      /\b(delete|deletar|excluir|remover)\b/,
    ].every((pattern) => pattern.test(context));

    return {
      auth: /\b(auth|authentication|autenticacao|autenticar|login|logout|sessao|signin|sign in|sign-in)\b/.test(context),
      crud: /\bcrud\b/.test(context) || hasAllCrudTerms,
      upload: /\b(upload|uploads|file upload|envio de arquivos?|enviar arquivos?|anexos?)\b/.test(context),
      multipleRoutes: /\b(multiplas?|varias?) (rotas?|paginas?)\b|\b(multiple|several) (routes?|pages?)\b/.test(context),
    };
  }

  function routeSurfaceFromFile(relativePath = '') {
    const relPath = toPosixPath(relativePath);
    const appPageMatch = relPath.match(/^(?:src\/)?app\/(.*\/)?page\.(?:js|jsx|ts|tsx)$/i);
    const appApiMatch = relPath.match(/^(?:src\/)?app\/api\/(.*\/)?route\.(?:js|jsx|ts|tsx)$/i);
    if (appPageMatch || appApiMatch) {
      const prefix = appApiMatch ? 'api/' : '';
      const rawSegments = String((appApiMatch || appPageMatch)[1] || '').split('/').filter(Boolean);
      const routeSegments = rawSegments.filter((segment) => !/^\(.+\)$/.test(segment) && !segment.startsWith('@'));
      return `/${prefix}${routeSegments.join('/')}`.replace(/\/$/, '') || '/';
    }

    const pagesMatch = relPath.match(/^(?:src\/)?pages\/(.+)\.(?:js|jsx|ts|tsx)$/i);
    if (pagesMatch && !/(^|\/)_(?:app|document|error)$/.test(pagesMatch[1])) {
      const route = pagesMatch[1].replace(/(^|\/)index$/i, '$1');
      return `/${route}`.replace(/\/$/, '') || '/';
    }

    if (/\.html?$/i.test(relPath)) {
      const route = relPath.replace(/\.html?$/i, '').replace(/(^|\/)index$/i, '$1');
      return `/${route}`.replace(/\/$/, '') || '/';
    }
    if (/\.php$/i.test(relPath)) {
      const route = relPath.replace(/\.php$/i, '').replace(/(^|\/)index$/i, '$1');
      return `/${route}`.replace(/\/$/, '') || '/';
    }
    return '';
  }

  function collectRouteSurfaces(sourceEntries = []) {
    const routes = new Set();
    for (const entry of sourceEntries) {
      const fileRoute = routeSurfaceFromFile(entry.path);
      if (fileRoute) routes.add(`file:${fileRoute}`);

      const routePattern = /(?:app|router|api)\s*\.\s*(?:get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
      let match;
      while ((match = routePattern.exec(entry.content))) {
        routes.add(`declared:${match[1]}`);
        if (routes.size >= 100) break;
      }
    }
    return routes;
  }

  function appendRequestedProductCapabilitySteps({ steps, rootPath, knownFiles, options }) {
    const requested = inferRequestedProductCapabilities(options);
    if (!Object.values(requested).some(Boolean)) return;

    const sourceEntries = collectAcceptanceSourceEntries(rootPath, knownFiles);
    if (requested.auth) {
      const authBoundaryEntries = sourceEntries.filter((entry) =>
        /(^|\/)[^/]*(auth|login|session|identity|security|middleware)[^/]*\.(?:js|jsx|ts|tsx|mjs|cjs|py|php)$/i.test(entry.path)
      );
      const authBehaviorPattern = /\b(authenticate|verifypassword|verify_password|comparepassword|compare_password|signin|sign_in|signout|sign_out|getserversession|create_session|createsession|verifytoken|verify_token|oauth2passwordbearer)\b|supabase\s*\.\s*auth|firebase\s*\.\s*auth|bcrypt\s*\.\s*compare/i;
      const authBehaviorOk = authBoundaryEntries.some((entry) => authBehaviorPattern.test(entry.content));
      const authOk = authBoundaryEntries.length > 0 && authBehaviorOk;
      steps.push(buildStaticStep({
        id: 'acceptance_auth',
        label: 'Aceitação: autenticação',
        ok: authOk,
        required: true,
        detail: authOk
          ? 'Encontrou boundary de autenticação com comportamento verificável de login, sessão ou credencial.'
          : 'Autenticação solicitada exige boundary dedicado e comportamento real de login, sessão ou verificação de credencial.',
      }));
    }

    if (requested.crud) {
      const crudBoundaryText = sourceEntries
        .filter((entry) => (
          /(^|\/)[^/]*(repository|service|controller|route|api|database|db|store|model)[^/]*\.(?:js|jsx|ts|tsx|mjs|cjs|py|php)$/i.test(entry.path)
          || (/\.py$/i.test(entry.path)
            && /@(?:app|router)\s*\.\s*(?:get|post|put|patch|delete)\s*\(/i.test(entry.content))
        ))
        .map((entry) => entry.content)
        .join('\n');
      const crudOperations = {
        create: /\b(create|insert|add|save|post)\b/i.test(crudBoundaryText),
        read: /\b(findmany|find_many|findunique|find_unique|findfirst|find_first|findall|find_all|list|get|select|read|fetch)\b/i.test(crudBoundaryText),
        update: /\b(update|patch|put|upsert|modify)\b/i.test(crudBoundaryText),
        delete: /\b(delete|remove|destroy)\b/i.test(crudBoundaryText),
      };
      const missingCrudOperations = Object.entries(crudOperations)
        .filter(([, present]) => !present)
        .map(([operation]) => operation);
      const crudOk = missingCrudOperations.length === 0;
      steps.push(buildStaticStep({
        id: 'acceptance_crud',
        label: 'Aceitação: CRUD completo',
        ok: crudOk,
        required: true,
        detail: crudOk
          ? 'Encontrou create, read, update e delete em boundary de dados ou API.'
          : `CRUD completo solicitado ainda não comprova: ${missingCrudOperations.join(', ')}.`,
      }));
    }

    if (requested.upload) {
      const combinedSource = sourceEntries.map((entry) => entry.content).join('\n');
      const uploadClientOk = /<input[^>]+type\s*=\s*['"]file['"]/i.test(combinedSource)
        || /\bnew\s+formdata\s*\(/i.test(combinedSource);
      const uploadHandlerOk = /request\s*\.\s*formdata\s*\(|\buploadfile\b|\bmulter\b|multipart\/form-data|\bfiles?\s*\[/i.test(combinedSource);
      const uploadStorageOk = /storage\s*\.\s*upload\s*\(|\.\s*upload\s*\(|\bputobject\s*\(|\buploadbytes\s*\(|\bwritefile\s*\(/i.test(combinedSource);
      const uploadOk = uploadClientOk && uploadHandlerOk && uploadStorageOk;
      steps.push(buildStaticStep({
        id: 'acceptance_upload',
        label: 'Aceitação: upload de arquivos',
        ok: uploadOk,
        required: true,
        detail: uploadOk
          ? 'Encontrou seleção/FormData, handler multipart e envio ou gravação do arquivo.'
          : 'Upload solicitado exige seleção/FormData, handler multipart e envio ou gravação real do arquivo.',
      }));
    }

    if (requested.multipleRoutes) {
      const routeSurfaces = collectRouteSurfaces(sourceEntries);
      const multipleRoutesOk = routeSurfaces.size >= 2;
      steps.push(buildStaticStep({
        id: 'acceptance_multiple_routes',
        label: 'Aceitação: múltiplas rotas',
        ok: multipleRoutesOk,
        required: true,
        detail: multipleRoutesOk
          ? `Encontrou ${routeSurfaces.size} superfícies de rota distintas.`
          : `Múltiplas rotas solicitadas exigem ao menos 2 superfícies reais; encontrou ${routeSurfaces.size}.`,
      }));
    }
  }

  function inferStackFlags(projectInfo, packageJson, knownFiles, rootPath) {
    const hasPackage = Boolean(packageJson);
    const hasNextDependency = packageHasDependency(packageJson, 'next');
    const hasReactDependency = packageHasDependency(packageJson, 'react');
    const hasElectronDependency = packageHasDependency(packageJson, 'electron');
    const hasTailwindDependency = packageHasDependency(packageJson, 'tailwindcss') ||
      packageHasDependency(packageJson, '@tailwindcss/postcss');
    const hasNextEntry = hasAnyEntry(rootPath, knownFiles, [
      'app/page.tsx',
      'src/app/page.tsx',
      'pages/index.tsx',
      'src/pages/index.tsx',
      'app/page.jsx',
      'src/app/page.jsx',
    ]);
    const hasHtmlEntry = hasProjectFile(rootPath, knownFiles, 'index.html');
    const hasLampEntry = hasProjectFile(rootPath, knownFiles, 'index.php') || hasProjectFile(rootPath, knownFiles, 'public/index.php');
    const hasElectronEntry = hasAnyEntry(rootPath, knownFiles, ['main.js', 'electron/main.js', 'src/main.js']);
    const fastApiEntryCandidates = [
      'main.py',
      'app/main.py',
      'src/main.py',
      'backend/main.py',
      'backend/app/main.py',
      'api/main.py',
      'apps/api/main.py',
    ];
    const fastApiEntry = fastApiEntryCandidates.find((candidate) => hasProjectFile(rootPath, knownFiles, candidate))
      || Array.from(knownFiles).find((relPath) => /(^|\/)(app|api)\/main\.py$/i.test(relPath))
      || '';
    const pythonManifestPaths = new Set(
      Array.from(knownFiles).filter((relPath) => /(^|\/)(requirements(?:-[^/]+)?\.txt|pyproject\.toml)$/i.test(relPath))
    );
    for (const candidate of [
      'requirements.txt',
      'pyproject.toml',
      'backend/requirements.txt',
      'backend/pyproject.toml',
      'api/requirements.txt',
      'api/pyproject.toml',
    ]) {
      if (hasProjectFile(rootPath, knownFiles, candidate)) pythonManifestPaths.add(candidate);
    }
    const pythonManifestText = Array.from(pythonManifestPaths)
      .map((relPath) => safeReadText(path.join(rootPath, relPath)))
      .join('\n');
    const hasFastApiDependency = /\bfastapi\b/i.test(pythonManifestText);
    const pythonTestFiles = Array.from(knownFiles).filter(
      (relPath) => /(^|\/)tests?\/(test_[^/]+|[^/]+_test)\.py$/i.test(relPath)
    );
    const pythonTestText = pythonTestFiles
      .map((relPath) => safeReadText(path.join(rootPath, relPath)))
      .join('\n');
    const hasPythonTests = pythonTestFiles.length > 0;
    const hasPytestTests = /\bpytest\b/i.test(`${pythonManifestText}\n${pythonTestText}`);
    const hasUnittestTests = /(?:^|\n)\s*(?:from\s+unittest\b|import\s+unittest\b)|\bunittest\s*\.\s*TestCase\b/i.test(pythonTestText);
    const pythonTestFramework = hasUnittestTests && !hasPytestTests ? 'unittest' : 'pytest';
    const firstPythonTest = pythonTestFiles.sort()[0] || '';
    const pythonTestSegments = toPosixPath(firstPythonTest).split('/').filter(Boolean);
    const pythonTestMarkerIndex = pythonTestSegments.findIndex((segment) => /^tests?$/i.test(segment));
    const pythonTestDirectory = pythonTestMarkerIndex >= 0
      ? pythonTestSegments.slice(0, pythonTestMarkerIndex + 1).join('/')
      : 'tests';
    const workspaceEntries = Array.isArray(packageJson && packageJson.workspaces)
      ? packageJson.workspaces
      : packageJson && packageJson.workspaces && Array.isArray(packageJson.workspaces.packages)
        ? packageJson.workspaces.packages
        : [];
    const hasWorkspaceConfig = workspaceEntries.length > 0 || hasAnyEntry(rootPath, knownFiles, [
      'pnpm-workspace.yaml',
      'lerna.json',
    ]);
    const hasWorkspacePackageManifest = hasKnownFileMatching(
      rootPath,
      knownFiles,
      (relPath) => /^(apps|packages|services)\/[^/]+\/package\.json$/i.test(relPath)
    );
    const hasMonorepo = hasStack(projectInfo, 'Monorepo')
      || hasWorkspaceConfig
      || Boolean(
        hasWorkspacePackageManifest
          && (packageHasDependency(packageJson, 'turbo') || packageHasDependency(packageJson, 'nx'))
      );
    const hasFastApi = hasStack(projectInfo, 'FastAPI')
      || hasStack(projectInfo, 'Python/FastAPI')
      || hasFastApiDependency
      || Boolean(fastApiEntry && /\bfastapi\b/i.test(safeReadText(path.join(rootPath, fastApiEntry))));

    return {
      hasPackage,
      hasNext: hasStack(projectInfo, 'Next.js') || hasNextDependency || hasNextEntry,
      hasReact: hasStack(projectInfo, 'React') || hasReactDependency,
      hasElectron: hasStack(projectInfo, 'Electron') || hasElectronDependency,
      hasTailwind: hasStack(projectInfo, 'Tailwind CSS') || hasTailwindDependency,
      hasLamp: hasStack(projectInfo, 'PHP/LAMP') || hasLampEntry,
      hasFastApi,
      hasMonorepo,
      hasStaticWeb: !hasPackage && !hasLampEntry && hasHtmlEntry,
      hasHtmlEntry,
      hasLampEntry,
      hasElectronEntry,
      hasNextEntry,
      fastApiEntry,
      hasFastApiDependency,
      hasPythonTests,
      pythonTestDirectory,
      pythonTestFramework,
      hasWorkspaceConfig,
      hasWorkspacePackageManifest,
    };
  }

  function buildProjectVerificationPlan(projectInfo = {}, options = {}) {
    const rawRootPath = String(projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '').trim();
    if (!rawRootPath) {
      return {
        ok: false,
        rootPath: '',
        message: 'Projeto sem rootPath válido para verificação.',
        steps: [],
        warnings: ['Selecione uma pasta de projeto antes de verificar.'],
      };
    }

    const rootPath = path.resolve(rawRootPath);
    if (rootPath === path.parse(rootPath).root) {
      return {
        ok: false,
        rootPath: '',
        message: 'Projeto sem rootPath válido para verificação.',
        steps: [],
        warnings: ['Selecione uma pasta de projeto antes de verificar.'],
      };
    }

    const knownFiles = collectKnownFiles(projectInfo);
    const packageJsonPath = path.join(rootPath, 'package.json');
    const packageJson = safeReadJson(packageJsonPath);
    const packageManager = packageJson ? detectPackageManager(rootPath) : null;
    const flags = inferStackFlags(projectInfo, packageJson, knownFiles, rootPath);
    const requiredNodeScripts = resolveRequiredNodeScripts(options);
    const steps = [];
    const warnings = [];
    const structuralPrerequisites = [];

    appendRequestedProductCapabilitySteps({
      steps,
      rootPath,
      knownFiles,
      options,
    });

    const criticalJsonSyntax = inspectCriticalJsonSyntax(rootPath, knownFiles);
    if (criticalJsonSyntax.checked > 0) {
      const jsonSyntaxStepId = 'project_json_syntax';
      steps.push(buildStaticStep({
        id: jsonSyntaxStepId,
        label: 'Sintaxe de configurações JSON/JSONC',
        ok: criticalJsonSyntax.issues.length === 0,
        required: true,
        detail: criticalJsonSyntax.issues.length === 0
          ? `${criticalJsonSyntax.checked} arquivo(s) JSON/JSONC crítico(s) válido(s).`
          : `Arquivos JSON/JSONC inválidos: ${criticalJsonSyntax.issues.join(', ')}.`,
      }));
      structuralPrerequisites.push(jsonSyntaxStepId);
    }

    const localModuleResolution = inspectLocalModuleResolution(rootPath, knownFiles);
    if (localModuleResolution.importsChecked > 0) {
      const localModuleStepId = 'local_module_resolution';
      const unresolved = localModuleResolution.issues;
      steps.push(buildStaticStep({
        id: localModuleStepId,
        label: 'Resolução de módulos locais',
        ok: unresolved.length === 0,
        required: true,
        detail: unresolved.length === 0
          ? `${localModuleResolution.importsChecked} import(s) local(is) resolvido(s).`
          : `Imports locais não resolvidos: ${unresolved.map((issue) => (
              `${issue.importer} -> ${issue.specifier}`
            )).join('; ')}.`,
      }));
      structuralPrerequisites.push(localModuleStepId);
    }

    if (flags.hasMonorepo) {
      const monorepoChecks = [
        {
          id: 'monorepo_root_manifest',
          label: 'Manifesto raiz do monorepo',
          ok: Boolean(packageJson),
          detail: packageJson
            ? 'Encontrou package.json na raiz do workspace.'
            : 'Monorepo Node exige package.json na raiz do workspace.',
        },
        {
          id: 'monorepo_workspace_config',
          label: 'Configuração de workspace',
          ok: flags.hasWorkspaceConfig,
          detail: flags.hasWorkspaceConfig
            ? 'Encontrou configuração workspaces, pnpm-workspace.yaml ou lerna.json.'
            : 'Monorepo exige uma configuração de workspace explícita.',
        },
        {
          id: 'monorepo_package_manifest',
          label: 'Pacotes do workspace',
          ok: flags.hasWorkspacePackageManifest,
          detail: flags.hasWorkspacePackageManifest
            ? 'Encontrou package.json em apps/, packages/ ou services/.'
            : 'Monorepo exige ao menos um manifesto de pacote no workspace.',
        },
      ];
      for (const check of monorepoChecks) {
        steps.push(buildStaticStep({ ...check, required: true }));
        structuralPrerequisites.push(check.id);
      }
    }

    if (flags.hasNext) {
      const nextEntryOk = flags.hasNextEntry;
      steps.push(buildStaticStep({
        id: 'next_entry',
        label: 'Entrada Next.js',
        ok: nextEntryOk,
        detail: nextEntryOk
          ? 'Encontrou entrada Next.js compatível.'
          : 'Next.js precisa de app/page.tsx, src/app/page.tsx, pages/index.tsx ou equivalente.',
      }));

      steps.push(buildStaticStep({
        id: 'next_package',
        label: 'Pacote Next.js',
        ok: Boolean(packageJson && packageHasDependency(packageJson, 'next')),
        detail: packageJson
          ? 'package.json disponível para validação de scripts e dependências.'
          : 'package.json ausente; não é possível validar build Next.js.',
      }));
    }

    if (flags.hasTailwind) {
      const cssEntryOk = hasAnyEntry(rootPath, knownFiles, ['app/globals.css', 'src/app/globals.css', 'styles/globals.css', 'style.css']);
      steps.push(buildStaticStep({
        id: 'tailwind_css_entry',
        label: 'Entrada de estilos Tailwind/CSS',
        ok: cssEntryOk,
        detail: cssEntryOk
          ? 'Encontrou arquivo de estilos global para Tailwind/CSS.'
          : 'Projeto Tailwind precisa de arquivo global de estilos importado pela aplicação.',
      }));
    }

    if (flags.hasElectron) {
      steps.push(buildStaticStep({
        id: 'electron_package',
        label: 'Pacote Electron',
        ok: Boolean(packageJson && packageHasDependency(packageJson, 'electron')),
        detail: packageJson
          ? 'package.json disponível para validação de dependência Electron.'
          : 'package.json ausente; não é possível validar dependências Electron.',
      }));

      steps.push(buildStaticStep({
        id: 'electron_entry',
        label: 'Entrada Electron',
        ok: flags.hasElectronEntry,
        detail: flags.hasElectronEntry
          ? 'Encontrou entrada Electron compatível.'
          : 'Electron precisa de main.js, electron/main.js ou src/main.js como entrada clara.',
      }));
    }

    if (packageJson) {
      const dependenciesInstalled = safeExists(path.join(rootPath, 'node_modules'));
      const dependencyIssues = collectDependencyInstallIssues(rootPath, packageJson, dependenciesInstalled);
      const dependencyStepId = 'node_dependencies';
      const blockedByDependencies = [];
      if (dependencyIssues.length) {
        const installCommand = buildInstallCommand(packageManager);
        steps.push(buildCommandStep({
          id: dependencyStepId,
          label: dependenciesInstalled ? 'Atualizar dependências Node' : 'Instalar dependências Node',
          command: installCommand,
          required: true,
          detail: dependenciesInstalled
            ? `Dependências desalinhadas com package.json: ${dependencyIssues.join('; ')}.`
            : 'Dependências não estão instaladas; executa instalação real antes de build/test/smoke.',
        }));
        blockedByDependencies.push(dependencyStepId);
      }

      const runtimePrerequisites = [...structuralPrerequisites];
      const scriptOrder = [
        { name: 'build', label: 'Build da aplicação', required: flags.hasMonorepo || flags.hasNext || (flags.hasReact && !flags.hasElectron) },
        { name: 'typecheck', label: 'Typecheck', required: false },
        { name: 'lint', label: 'Lint', required: false },
        { name: 'test', label: 'Testes automatizados', required: flags.hasMonorepo },
      ];
      const nodeScriptSteps = [];

      for (const script of scriptOrder) {
        const required = Boolean(script.required || requiredNodeScripts.has(script.name));
        if (!packageHasScript(packageJson, script.name)) {
          if (required) {
            nodeScriptSteps.push(buildStaticStep({
              id: `node_${script.name}_script`,
              label: `Script obrigatório: ${script.name}`,
              ok: false,
              required: true,
              detail: `Script \`${script.name}\` ausente no package.json; a validação operacional não pode ser declarada.`,
            }));
          } else if (script.required) {
            warnings.push(`Script \`${script.name}\` ausente no package.json.`);
          }
          continue;
        }
        if (script.name === 'test' && isPlaceholderTestScript(packageJson.scripts.test)) {
          if (required) {
            nodeScriptSteps.push(buildStaticStep({
              id: 'node_test_script',
              label: 'Script obrigatório: test',
              ok: false,
              required: true,
              detail: 'Script `test` parece placeholder; testes reais são obrigatórios neste modo.',
            }));
          } else {
            warnings.push('Script `test` parece placeholder e será ignorado pela verificação automática.');
          }
          continue;
        }
        const command = buildScriptCommand(packageManager, script.name);
        nodeScriptSteps.push(buildCommandStep({
          id: `node_${script.name}`,
          label: script.label,
          command,
          required,
          blockedBy: normalizeBlockedBy([...blockedByDependencies, ...runtimePrerequisites]),
          detail: `Executa \`${commandText(command)}\` na raiz do projeto.`,
        }));
      }

      const prismaSchemaPath = path.join(rootPath, 'prisma', 'schema.prisma');
      const prismaSchema = safeReadText(prismaSchemaPath);
      const hasPrismaSchema = hasProjectFile(rootPath, knownFiles, 'prisma/schema.prisma');
      const hasPrismaDependency = packageHasDependency(packageJson, '@prisma/client') || packageHasDependency(packageJson, 'prisma');
      const usesPostgres = /provider\s*=\s*"postgresql"/i.test(prismaSchema);
      const persistenceContext = String(options.userMessage || options.acceptanceContext || '');
      const persistenceRequested = options.requirePersistence === true ||
        /\b(postgres|postgresql|prisma|sqlite|drizzle|supabase|firebase|banco|database|persist[eê]ncia|persistir|migration|seed)\b/i.test(persistenceContext);
      const hasDrizzleDependency = packageHasDependency(packageJson, 'drizzle-orm')
        || packageHasDependency(packageJson, 'drizzle-kit');
      const hasSqliteDependency = packageHasDependency(packageJson, 'better-sqlite3')
        || packageHasDependency(packageJson, 'sqlite3')
        || packageHasDependency(packageJson, '@libsql/client');
      const hasSupabaseDependency = packageHasDependency(packageJson, '@supabase/supabase-js');
      const hasFirebaseDependency = packageHasDependency(packageJson, 'firebase')
        || packageHasDependency(packageJson, 'firebase-admin');
      const requestsDrizzleSqlite = /\bdrizzle\b/i.test(persistenceContext)
        && /\b(sqlite|libsql|turso)\b/i.test(persistenceContext);
      const requestsSupabase = /\bsupabase\b/i.test(persistenceContext);
      const requestsFirebase = /\b(firebase|firestore)\b/i.test(persistenceContext);
      const requestsPrismaPostgres = /\b(postgres|postgresql|prisma)\b/i.test(persistenceContext);
      let persistenceStrategy = '';
      if (requestsSupabase && !requestsFirebase) {
        persistenceStrategy = 'supabase';
      } else if (requestsFirebase && !requestsSupabase) {
        persistenceStrategy = 'firebase';
      } else if (requestsDrizzleSqlite) {
        persistenceStrategy = 'drizzle_sqlite';
      } else if (requestsPrismaPostgres) {
        persistenceStrategy = 'prisma_postgres';
      } else if (hasSupabaseDependency && !hasFirebaseDependency) {
        persistenceStrategy = 'supabase';
      } else if (hasFirebaseDependency && !hasSupabaseDependency) {
        persistenceStrategy = 'firebase';
      } else if (hasDrizzleDependency && hasSqliteDependency) {
        persistenceStrategy = 'drizzle_sqlite';
      } else if (hasPrismaDependency && hasPrismaSchema && usesPostgres) {
        persistenceStrategy = 'prisma_postgres';
      }
      const drizzleSqlitePersistence = persistenceStrategy === 'drizzle_sqlite';
      const prismaPostgresPersistence = persistenceStrategy === 'prisma_postgres';
      const offlinePersistenceValidation = options.persistenceValidationMode === 'offline';
      const addManagedPersistenceCheck = ({ strategyLabel, staticStepIds }) => {
        const stepId = 'persistence_db_check';
        if (!packageHasScript(packageJson, 'db:check')) {
          const missingScriptStepId = `${stepId}_script`;
          steps.push(buildStaticStep({
            id: missingScriptStepId,
            label: 'Script obrigatório: db:check',
            ok: false,
            required: true,
            detail: `${strategyLabel} exige script \`db:check\` para evidência operacional da persistência.`,
          }));
          runtimePrerequisites.push(missingScriptStepId);
          return;
        }
        const command = buildScriptCommand(packageManager, 'db:check');
        steps.push(buildCommandStep({
          id: stepId,
          label: `${strategyLabel}: db:check`,
          command,
          required: true,
          blockedBy: normalizeBlockedBy([...blockedByDependencies, ...staticStepIds]),
          detail: `Executa \`${commandText(command)}\` para comprovar a persistência gerenciada.`,
        }));
        runtimePrerequisites.push(stepId);
      };
      if (persistenceStrategy === 'supabase') {
        const hasSupabaseConfig = hasProjectFile(rootPath, knownFiles, 'supabase/config.toml');
        const hasSupabaseMigration = hasKnownFileMatching(
          rootPath,
          knownFiles,
          (relPath) => /^supabase\/migrations\/[^/]+\.sql$/i.test(relPath)
        );
        const hasSupabaseClient = hasKnownFileMatching(
          rootPath,
          knownFiles,
          (relPath) => /(^|\/)(lib|server)\/[^/]*supabase[^/]*\.(ts|js)$/i.test(relPath)
        );
        const persistenceStaticStepIds = [
          'persistence_supabase_dependency',
          'persistence_supabase_config',
          'persistence_supabase_migration',
          'persistence_supabase_client',
        ];
        steps.push(buildStaticStep({
          id: 'persistence_supabase_dependency',
          label: 'Cliente Supabase',
          ok: hasSupabaseDependency,
          required: true,
          detail: hasSupabaseDependency
            ? 'Encontrou @supabase/supabase-js declarado no package.json.'
            : 'Persistência Supabase exige @supabase/supabase-js declarado no package.json.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_supabase_config',
          label: 'Configuração Supabase',
          ok: hasSupabaseConfig,
          required: true,
          detail: hasSupabaseConfig
            ? 'Encontrou supabase/config.toml versionado.'
            : 'Persistência Supabase exige supabase/config.toml versionado.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_supabase_migration',
          label: 'Migration Supabase',
          ok: hasSupabaseMigration,
          required: true,
          detail: hasSupabaseMigration
            ? 'Encontrou migration SQL versionada pelo Supabase.'
            : 'Persistência Supabase exige supabase/migrations/*.sql versionado.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_supabase_client',
          label: 'Boundary Supabase',
          ok: hasSupabaseClient,
          required: true,
          detail: hasSupabaseClient
            ? 'Encontrou cliente Supabase em boundary lib/server dedicado.'
            : 'Persistência Supabase exige cliente dedicado em lib/server.',
        }));
        addManagedPersistenceCheck({
          strategyLabel: 'Persistência Supabase',
          staticStepIds: persistenceStaticStepIds,
        });
      } else if (persistenceStrategy === 'firebase') {
        const hasFirebaseConfig = hasProjectFile(rootPath, knownFiles, 'firebase.json');
        const hasFirebaseRules = hasAnyEntry(rootPath, knownFiles, [
          'firestore.rules',
          'storage.rules',
          'database.rules.json',
        ]);
        const hasFirebaseClient = hasKnownFileMatching(
          rootPath,
          knownFiles,
          (relPath) => /(^|\/)(lib|server)\/[^/]*firebase[^/]*\.(ts|js)$/i.test(relPath)
        );
        const persistenceStaticStepIds = [
          'persistence_firebase_dependency',
          'persistence_firebase_config',
          'persistence_firebase_rules',
          'persistence_firebase_client',
        ];
        steps.push(buildStaticStep({
          id: 'persistence_firebase_dependency',
          label: 'SDK Firebase',
          ok: hasFirebaseDependency,
          required: true,
          detail: hasFirebaseDependency
            ? 'Encontrou SDK Firebase declarado no package.json.'
            : 'Persistência Firebase exige firebase ou firebase-admin declarado no package.json.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_firebase_config',
          label: 'Configuração Firebase',
          ok: hasFirebaseConfig,
          required: true,
          detail: hasFirebaseConfig
            ? 'Encontrou firebase.json versionado.'
            : 'Persistência Firebase exige firebase.json versionado.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_firebase_rules',
          label: 'Regras Firebase',
          ok: hasFirebaseRules,
          required: true,
          detail: hasFirebaseRules
            ? 'Encontrou regras versionadas para o serviço Firebase utilizado.'
            : 'Persistência Firebase exige firestore.rules, storage.rules ou database.rules.json.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_firebase_client',
          label: 'Boundary Firebase',
          ok: hasFirebaseClient,
          required: true,
          detail: hasFirebaseClient
            ? 'Encontrou cliente Firebase em boundary lib/server dedicado.'
            : 'Persistência Firebase exige cliente dedicado em lib/server.',
        }));
        addManagedPersistenceCheck({
          strategyLabel: 'Persistência Firebase',
          staticStepIds: persistenceStaticStepIds,
        });
      } else if (drizzleSqlitePersistence) {
        const hasDrizzleConfig = hasAnyEntry(rootPath, knownFiles, [
          'drizzle.config.ts',
          'drizzle.config.js',
          'drizzle.config.mjs',
          'drizzle.config.cjs',
        ]);
        const hasDrizzleSchema = hasKnownFileMatching(
          rootPath,
          knownFiles,
          (relPath) => /(^|\/)db\/schema\.(ts|js)$|(^|\/)drizzle\/schema\.(ts|js)$/i.test(relPath)
        );
        const hasDrizzleMigration = hasKnownFileMatching(
          rootPath,
          knownFiles,
          (relPath) => /^drizzle\/.+\.sql$/i.test(relPath)
        );
        const hasRepository = hasKnownFileMatching(
          rootPath,
          knownFiles,
          (relPath) => /(^|\/)(repositories?|.*repository|.*_repository)\.(ts|js)$/i.test(relPath)
        );
        const persistenceStaticStepIds = [
          'persistence_drizzle_config',
          'persistence_drizzle_schema',
          'persistence_drizzle_migration',
          'persistence_sqlite_driver',
          'persistence_repository',
        ];
        let previousPersistenceCommandId = '';

        steps.push(buildStaticStep({
          id: 'persistence_drizzle_config',
          label: 'Configuração Drizzle',
          ok: hasDrizzleConfig,
          required: true,
          detail: hasDrizzleConfig
            ? 'Encontrou drizzle.config.* para a estratégia SQLite.'
            : 'Persistência Drizzle exige drizzle.config.* versionado.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_drizzle_schema',
          label: 'Schema Drizzle',
          ok: hasDrizzleSchema,
          required: true,
          detail: hasDrizzleSchema
            ? 'Encontrou schema Drizzle em módulo de banco dedicado.'
            : 'Persistência Drizzle exige db/schema.ts ou drizzle/schema.ts.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_drizzle_migration',
          label: 'Migration Drizzle',
          ok: hasDrizzleMigration,
          required: true,
          detail: hasDrizzleMigration
            ? 'Encontrou migration SQL versionada pelo Drizzle.'
            : 'Persistência Drizzle exige drizzle/**/*.sql versionado.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_sqlite_driver',
          label: 'Driver SQLite',
          ok: hasSqliteDependency,
          required: true,
          detail: hasSqliteDependency
            ? 'Encontrou driver SQLite/LibSQL declarado no package.json.'
            : 'Persistência SQLite exige better-sqlite3, sqlite3 ou @libsql/client.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_repository',
          label: 'Repository/service persistente',
          ok: hasRepository,
          required: true,
          detail: hasRepository
            ? 'Encontrou repository/service dedicado à persistência Drizzle.'
            : 'Persistência Drizzle exige repository/service dedicado.',
        }));

        for (const scriptName of ['db:migrate', 'db:check']) {
          const stepId = `persistence_${scriptName.replace(/[^a-z0-9]+/gi, '_')}`;
          if (!packageHasScript(packageJson, scriptName)) {
            const missingScriptStepId = `${stepId}_script`;
            steps.push(buildStaticStep({
              id: missingScriptStepId,
              label: `Script obrigatório: ${scriptName}`,
              ok: false,
              required: true,
              detail: `Persistência Drizzle/SQLite exige script \`${scriptName}\` no package.json.`,
            }));
            previousPersistenceCommandId = missingScriptStepId;
            continue;
          }
          const command = buildScriptCommand(packageManager, scriptName);
          steps.push(buildCommandStep({
            id: stepId,
            label: `Persistência Drizzle/SQLite: ${scriptName}`,
            command,
            required: true,
            blockedBy: normalizeBlockedBy([
              ...blockedByDependencies,
              ...persistenceStaticStepIds,
              ...(previousPersistenceCommandId ? [previousPersistenceCommandId] : []),
            ]),
            detail: `Executa \`${commandText(command)}\` para comprovar a persistência SQLite.`,
          }));
          previousPersistenceCommandId = stepId;
        }
        if (previousPersistenceCommandId) runtimePrerequisites.push(previousPersistenceCommandId);
      } else if (prismaPostgresPersistence) {
        const hasDockerCompose = hasAnyEntry(rootPath, knownFiles, ['docker-compose.yml', 'compose.yml']);
        const hasMigration = hasKnownFileMatching(rootPath, knownFiles, (relPath) => /^prisma\/migrations\/[^/]+\/migration\.sql$/i.test(relPath));
        const hasSeed = hasAnyEntry(rootPath, knownFiles, ['scripts/seed.mjs', 'scripts/seed.js', 'prisma/seed.ts', 'prisma/seed.js']) ||
          Boolean(packageJson.prisma && packageJson.prisma.seed);
        const hasPrismaClient = hasAnyEntry(rootPath, knownFiles, ['src/server/prisma.ts', 'src/lib/prisma.ts', 'lib/prisma.ts']);
        const hasRepository = hasKnownFileMatching(rootPath, knownFiles, (relPath) => /(^|\/)(repositories?|.*repository|.*_repository)\.(ts|js)$|^src\/server\/.*repository\.(ts|js)$/i.test(relPath));
        const hasApiRoute = hasKnownFileMatching(rootPath, knownFiles, (relPath) => /^app\/api\/.+\/route\.(ts|js)$/i.test(relPath));
        const hasDbCheck = packageHasScript(packageJson, 'db:check');
        const persistenceStaticStepIds = [
          'persistence_prisma_schema',
          'persistence_docker_compose',
          'persistence_migration',
          'persistence_seed',
          'persistence_prisma_client',
          'persistence_repository',
          'persistence_api_route',
        ];
        let previousPersistenceCommandId = '';

        steps.push(buildStaticStep({
          id: 'persistence_prisma_schema',
          label: 'Schema Prisma Postgres',
          ok: hasPrismaSchema && usesPostgres,
          required: true,
          detail: hasPrismaSchema && usesPostgres
            ? 'Encontrou schema Prisma apontando para provider postgresql.'
            : 'Persistência real exige prisma/schema.prisma com provider postgresql.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_docker_compose',
          label: 'Docker/Postgres local',
          ok: hasDockerCompose,
          required: true,
          detail: hasDockerCompose
            ? 'Encontrou docker-compose.yml/compose.yml para Postgres local.'
            : 'Persistência real exige docker-compose.yml ou compose.yml com Postgres local.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_migration',
          label: 'Migration Prisma',
          ok: hasMigration,
          required: true,
          detail: hasMigration
            ? 'Encontrou migration.sql versionada.'
            : 'Persistência real exige prisma/migrations/**/migration.sql.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_seed',
          label: 'Seed de banco',
          ok: hasSeed,
          required: true,
          detail: hasSeed
            ? 'Encontrou seed executável para popular dados operacionais.'
            : 'Persistência real exige script/arquivo de seed.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_prisma_client',
          label: 'PrismaClient',
          ok: hasPrismaClient,
          required: true,
          detail: hasPrismaClient
            ? 'Encontrou módulo PrismaClient compartilhado.'
            : 'Persistência real exige PrismaClient em módulo de servidor.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_repository',
          label: 'Repository/service persistente',
          ok: hasRepository,
          required: true,
          detail: hasRepository
            ? 'Encontrou repository/service dedicado à persistência.'
            : 'Persistência real exige repository/service usando o PrismaClient.',
        }));
        steps.push(buildStaticStep({
          id: 'persistence_api_route',
          label: 'Contrato frontend/backend',
          ok: hasApiRoute,
          required: true,
          detail: hasApiRoute
            ? 'Encontrou API route/server boundary para a UI consumir dados persistidos.'
            : 'Frontend precisa chamar API route ou server action para usar dados persistidos.',
        }));

        const prismaValidationScripts = offlinePersistenceValidation
          ? ['db:check']
          : ['db:up', 'db:generate', 'db:migrate', 'db:seed', 'db:check'];
        for (const scriptName of prismaValidationScripts) {
          const stepId = `persistence_${scriptName.replace(/[^a-z0-9]+/gi, '_')}`;
          if (!packageHasScript(packageJson, scriptName)) {
            const missingScriptStepId = `${stepId}_script`;
            steps.push(buildStaticStep({
              id: missingScriptStepId,
              label: `Script obrigatório: ${scriptName}`,
              ok: false,
              required: true,
              detail: `Persistência real exige script \`${scriptName}\` no package.json.`,
            }));
            previousPersistenceCommandId = missingScriptStepId;
            continue;
          }
          const command = buildScriptCommand(packageManager, scriptName);
          const blockers = normalizeBlockedBy([
            ...blockedByDependencies,
            ...persistenceStaticStepIds,
            ...(previousPersistenceCommandId ? [previousPersistenceCommandId] : []),
          ]);
          steps.push(buildCommandStep({
            id: stepId,
            label: `Persistência: ${scriptName}`,
            command,
            required: true,
            blockedBy: blockers,
            timeoutMs: scriptName === 'db:up' ? 120000 : timeoutMs,
            detail: offlinePersistenceValidation
              ? `Executa \`${commandText(command)}\` para validar offline schema, migration, seed e contrato de persistência.`
              : `Executa \`${commandText(command)}\` para comprovar persistência real.`,
          }));
          previousPersistenceCommandId = stepId;
        }

        if (previousPersistenceCommandId) runtimePrerequisites.push(previousPersistenceCommandId);
      } else if (persistenceRequested) {
        warnings.push(
          'Persistência solicitada, mas a estratégia não foi reconhecida como Prisma/Postgres ou Drizzle/SQLite; nenhuma regra específica de outra stack foi aplicada.'
        );
      }

      for (const step of nodeScriptSteps) {
        if (step && step.kind === 'command') {
          step.blockedBy = normalizeBlockedBy([...(step.blockedBy || []), ...runtimePrerequisites]);
        }
        steps.push(step);
      }

      const playwrightScriptName = findPlaywrightScript(packageJson);
      const playwrightConfig = findPlaywrightConfig(rootPath, knownFiles);
      const hasPlaywrightDependency =
        packageHasDependency(packageJson, '@playwright/test') ||
        packageHasDependency(packageJson, 'playwright');
      const requirePlaywright = resolvePlaywrightRequired(
        options,
        Boolean(playwrightScriptName || playwrightConfig || hasPlaywrightDependency)
      );
      if (playwrightScriptName) {
        const command = buildScriptCommand(packageManager, playwrightScriptName);
        steps.push(buildCommandStep({
          id: 'node_playwright',
          label: 'Playwright',
          command,
          required: requirePlaywright,
          blockedBy: normalizeBlockedBy([...blockedByDependencies, ...runtimePrerequisites]),
          detail: `Executa \`${commandText(command)}\` para smoke E2E com Playwright.`,
        }));
      } else if (hasPlaywrightDependency || playwrightConfig) {
        const command = packageManager === 'pnpm'
          ? { bin: 'pnpm', args: ['exec', 'playwright', 'test'] }
          : packageManager === 'yarn'
            ? { bin: 'yarn', args: ['playwright', 'test'] }
            : packageManager === 'bun'
              ? { bin: 'bun', args: ['x', 'playwright', 'test'] }
              : { bin: 'npx', args: ['playwright', 'test'] };
        steps.push(buildCommandStep({
          id: 'node_playwright',
          label: 'Playwright',
          command,
          required: requirePlaywright,
          blockedBy: normalizeBlockedBy([...blockedByDependencies, ...runtimePrerequisites]),
          detail: `Executa \`${commandText(command)}\` para smoke E2E com Playwright.`,
        }));
      } else if (requirePlaywright) {
        steps.push(buildStaticStep({
          id: 'node_playwright_required',
          label: 'Playwright obrigatório',
          ok: false,
          required: true,
          detail: 'Nenhum script, dependência ou configuração Playwright foi encontrado para validar smoke E2E.',
        }));
      }
    }

    if (flags.hasFastApi) {
      const fastApiStaticStepIds = ['fastapi_dependency', 'fastapi_entry'];
      steps.push(buildStaticStep({
        id: 'fastapi_dependency',
        label: 'Dependência FastAPI',
        ok: flags.hasFastApiDependency,
        required: true,
        detail: flags.hasFastApiDependency
          ? 'Encontrou FastAPI declarado em requirements.txt ou pyproject.toml.'
          : 'Projeto FastAPI exige a dependência fastapi em requirements.txt ou pyproject.toml.',
      }));
      steps.push(buildStaticStep({
        id: 'fastapi_entry',
        label: 'Entrada FastAPI',
        ok: Boolean(flags.fastApiEntry),
        required: true,
        detail: flags.fastApiEntry
          ? `Encontrou entrada FastAPI em ${flags.fastApiEntry}.`
          : 'Projeto FastAPI exige main.py em uma raiz Python reconhecível.',
      }));

      const compileStepId = 'python_compile';
      if (flags.fastApiEntry) {
        steps.push(buildCommandStep({
          id: compileStepId,
          label: 'Compilação Python',
          command: { bin: 'python3', args: ['-m', 'py_compile', flags.fastApiEntry] },
          required: true,
          blockedBy: fastApiStaticStepIds,
          detail: `Executa \`python3 -m py_compile ${flags.fastApiEntry}\` sem alterar o projeto.`,
        }));
      }

      if (flags.hasPythonTests) {
        const usesUnittest = flags.pythonTestFramework === 'unittest';
        const testStepId = usesUnittest ? 'python_unittest' : 'python_pytest';
        const testCommand = usesUnittest
          ? {
            bin: 'python3',
            args: ['-m', 'unittest', 'discover', '-s', flags.pythonTestDirectory, '-p', 'test_*.py'],
          }
          : { bin: 'python3', args: ['-m', 'pytest'] };
        steps.push(buildCommandStep({
          id: testStepId,
          label: 'Testes Python',
          command: testCommand,
          required: true,
          blockedBy: normalizeBlockedBy([
            ...fastApiStaticStepIds,
            ...(flags.fastApiEntry ? [compileStepId] : []),
          ]),
          detail: usesUnittest
            ? `Executa unittest da biblioteca padrão em ${flags.pythonTestDirectory}.`
            : 'Executa `python3 -m pytest` para validar o backend FastAPI.',
        }));
      } else if (options.requirePythonTests === true) {
        steps.push(buildStaticStep({
          id: 'python_pytest_required',
          label: 'Testes Python obrigatórios',
          ok: false,
          required: true,
          detail: 'Nenhum tests/test_*.py foi encontrado para o backend FastAPI.',
        }));
      } else {
        warnings.push('Backend FastAPI sem testes Python detectáveis; pytest não será executado automaticamente.');
      }
    }

    if (flags.hasLamp) {
      steps.push(buildStaticStep({
        id: 'lamp_entry',
        label: 'Entrada LAMP/PHP',
        ok: flags.hasLampEntry,
        detail: flags.hasLampEntry
          ? 'Encontrou index.php ou public/index.php.'
          : 'Projeto LAMP precisa de uma entrada PHP clara.',
      }));

      const phpFiles = collectPhpFiles(projectInfo, knownFiles, rootPath);
      if (!phpFiles.length) {
        warnings.push('Nenhum arquivo PHP encontrado para validar com `php -l`.');
      }
      for (const relPath of phpFiles) {
        steps.push(buildCommandStep({
          id: `php_lint_${relPath.replace(/[^a-z0-9]+/gi, '_')}`,
          label: `Sintaxe PHP: ${relPath}`,
          command: { bin: 'php', args: ['-l', relPath] },
          required: true,
          detail: `Executa \`php -l ${relPath}\` sem alterar arquivos.`,
        }));
      }
    }

    if (flags.hasStaticWeb) {
      steps.push(buildStaticStep({
        id: 'static_web_entry',
        label: 'Entrada web estática',
        ok: flags.hasHtmlEntry,
        detail: flags.hasHtmlEntry ? 'Encontrou index.html.' : 'Projeto estático precisa de index.html.',
      }));
    }

    if (!steps.length) {
      warnings.push('Stack não reconhecida para verificação automática; use revisão manual, diff e execução local da stack.');
    }

    return {
      ok: true,
      rootPath,
      detectedStacks: normalizeStacks(projectInfo),
      packageManager,
      steps,
      warnings,
      summary: {
        totalSteps: steps.length,
        requiredSteps: steps.filter((step) => step.required).length,
        manualSteps: steps.filter((step) => step.kind === 'manual').length,
        commandSteps: steps.filter((step) => step.kind === 'command').length,
      },
    };
  }

  function buildShortOutput(commandResult) {
    const stderr = String((commandResult && commandResult.stderr) || '').trim();
    const stdout = String((commandResult && commandResult.stdout) || '').trim();
    const merged = stderr || stdout;
    if (!merged) return 'Comando falhou sem saída detalhada.';
    return merged.split('\n').map((line) => line.trim()).filter(Boolean)[0].slice(0, 360);
  }

  function isCommandUnavailableResult(commandResult, binName) {
    if (!commandResult || commandResult.ok) return false;
    const bin = String(binName || '').toLowerCase();
    const stderr = String(commandResult.stderr || '').toLowerCase();
    const stdout = String(commandResult.stdout || '').toLowerCase();
    const merged = `${stderr}\n${stdout}`;
    const code = commandResult.code !== undefined && commandResult.code !== null
      ? Number(commandResult.code)
      : Number(commandResult.exitCode);

    return (
      code === 127 ||
      merged.includes('enoent') ||
      merged.includes('command not found') ||
      merged.includes('no such file or directory') ||
      (bin && merged.includes(`spawn ${bin}`) && merged.includes('not found'))
    );
  }

  async function runProjectVerification(projectInfo = {}, options = {}) {
    const plan = buildProjectVerificationPlan(projectInfo, options);
    if (!plan.ok) {
      return {
        ok: false,
        ready: false,
        plan,
        results: [],
        summary: { passed: 0, failed: 0, warnings: 0, blocked: 0, manual: 0 },
        message: plan.message || 'Plano de verificação inválido.',
      };
    }

    const results = [];
    const unresolvedManualSteps = new Set();
    const failedRequiredSteps = new Set();

    for (const step of plan.steps) {
      if (isAbortSignalAborted(options.signal)) {
        results.push({
          id: 'verification_aborted',
          label: 'Verificação abortada',
          status: 'failed',
          required: true,
          detail: 'Verificação operacional abortada por timeout ou cancelamento.',
        });
        break;
      }

      if (step.kind === 'static') {
        if (step.required && step.expectedStatus === 'failed') failedRequiredSteps.add(step.id);
        results.push({
          id: step.id,
          label: step.label,
          status: step.expectedStatus,
          required: step.required,
          detail: step.detail,
        });
        continue;
      }

      if (step.kind === 'manual') {
        unresolvedManualSteps.add(step.id);
        results.push({
          id: step.id,
          label: step.label,
          status: 'manual',
          required: step.required,
          commandText: step.commandText,
          detail: step.detail,
        });
        continue;
      }

      const blockers = (Array.isArray(step.blockedBy) ? step.blockedBy : []).filter(
        (id) => unresolvedManualSteps.has(id) || failedRequiredSteps.has(id)
      );
      if (blockers.length) {
        if (step.required) failedRequiredSteps.add(step.id);
        results.push({
          id: step.id,
          label: step.label,
          status: 'blocked',
          required: step.required,
          commandText: step.commandText,
          blockedBy: blockers,
          detail: 'Comando bloqueado por etapa prévia pendente ou com falha.',
        });
        continue;
      }

      const command = step.command || {};
      const commandResult = await runCommand(command.bin, command.args || [], {
        cwd: plan.rootPath,
        signal: options.signal,
        timeoutMs: step.timeoutMs || timeoutMs,
      });

      if (commandResult && commandResult.ok) {
        results.push({
          id: step.id,
          label: step.label,
          status: 'passed',
          required: step.required,
          commandText: step.commandText,
          detail: 'Comando finalizado com sucesso.',
        });
        continue;
      }

      if (isCommandUnavailableResult(commandResult, command.bin)) {
        results.push({
          id: step.id,
          label: step.label,
          status: 'warning',
          required: false,
          commandText: step.commandText,
          detail: `Comando \`${command.bin}\` indisponível no ambiente local.`,
        });
        continue;
      }

      if (step.required) failedRequiredSteps.add(step.id);
      results.push({
        id: step.id,
        label: step.label,
        status: step.required ? 'failed' : 'warning',
        required: step.required,
        commandText: step.commandText,
        detail: buildShortOutput(commandResult),
      });
    }

    const summary = {
      passed: results.filter((result) => result.status === 'passed').length,
      failed: results.filter((result) => result.status === 'failed').length,
      warnings: results.filter((result) => result.status === 'warning').length + plan.warnings.length,
      blocked: results.filter((result) => result.status === 'blocked').length,
      manual: results.filter((result) => result.status === 'manual').length,
    };
    const requiredFailures = results.filter((result) => result.required && ['failed', 'blocked'].includes(result.status));
    const requiredManual = results.filter((result) => result.required && result.status === 'manual');
    const ready = requiredFailures.length === 0 && requiredManual.length === 0;

    return {
      ok: summary.failed === 0,
      ready,
      plan,
      results,
      warnings: plan.warnings,
      summary,
      message: ready
        ? 'Verificação concluída sem bloqueios obrigatórios.'
        : 'Verificação encontrou etapas obrigatórias pendentes ou com falha.',
    };
  }

  return {
    buildProjectVerificationPlan,
    detectPackageManager,
    isCommandUnavailableResult,
    runProjectVerification,
  };
}

module.exports = {
  createProjectVerificationService,
  normalizeVerificationText,
};
