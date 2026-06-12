const defaultFs = require('fs');
const defaultPath = require('path');
const { pathToFileURL: defaultPathToFileURL } = require('url');

function normalizePreviewText(value = '') {
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

function createProjectPreviewService(dependencies = {}) {
  const {
    fs = defaultFs,
    path = defaultPath,
    pathToFileURL = defaultPathToFileURL,
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

  function collectKnownFiles(projectInfo = {}) {
    return new Set(
      (Array.isArray(projectInfo && projectInfo.files) ? projectInfo.files : [])
        .map(toPosixPath)
        .filter(Boolean)
    );
  }

  function normalizeStacks(projectInfo = {}) {
    return (Array.isArray(projectInfo && projectInfo.stacks) ? projectInfo.stacks : [])
      .map((stack) => String(stack || '').trim())
      .filter(Boolean);
  }

  function hasStack(projectInfo, expectedStack) {
    const expected = normalizePreviewText(expectedStack);
    return normalizeStacks(projectInfo).some((stack) => normalizePreviewText(stack) === expected);
  }

  function hasProjectFile(rootPath, knownFiles, relativePath) {
    const relPath = toPosixPath(relativePath);
    return knownFiles.has(relPath) || safeExists(path.join(rootPath, relPath));
  }

  function findFirstProjectFile(rootPath, knownFiles, candidates = []) {
    return candidates.find((candidate) => hasProjectFile(rootPath, knownFiles, candidate)) || null;
  }

  function dependencyMap(packageJson = {}) {
    const manifest = packageJson && typeof packageJson === 'object' ? packageJson : {};
    return {
      ...(manifest.dependencies || {}),
      ...(manifest.devDependencies || {}),
    };
  }

  function packageHasDependency(packageJson, dependencyName) {
    return Object.prototype.hasOwnProperty.call(dependencyMap(packageJson), dependencyName);
  }

  function packageNames(packageJson = {}) {
    return Object.keys(dependencyMap(packageJson)).filter(Boolean);
  }

  function packageHasScript(packageJson, scriptName) {
    return Boolean(packageJson && packageJson.scripts && typeof packageJson.scripts[scriptName] === 'string');
  }

  function getPackageScript(packageJson, scriptName) {
    return packageJson && packageJson.scripts && typeof packageJson.scripts[scriptName] === 'string'
      ? packageJson.scripts[scriptName]
      : '';
  }

  function detectPackageManager(rootPath) {
    if (safeExists(path.join(rootPath, 'pnpm-lock.yaml'))) return 'pnpm';
    if (safeExists(path.join(rootPath, 'yarn.lock'))) return 'yarn';
    if (safeExists(path.join(rootPath, 'bun.lockb')) || safeExists(path.join(rootPath, 'bun.lock'))) return 'bun';
    return 'npm';
  }

  function buildInstallCommand(packageManager, options = {}) {
    const force = options.force === true;
    if (packageManager === 'yarn') return { bin: 'yarn', args: force ? ['install', '--force'] : ['install'] };
    if (packageManager === 'bun') return { bin: 'bun', args: force ? ['install', '--force'] : ['install'] };
    if (packageManager === 'pnpm') return { bin: 'pnpm', args: force ? ['install', '--force'] : ['install'] };
    return { bin: 'npm', args: force ? ['install', '--force'] : ['install'] };
  }

  function buildDependencyInstallCommand(packageManager, dependencyState = {}) {
    if (
      dependencyState.reason === 'broken_installed_package' &&
      dependencyState.hasPackageLock &&
      packageManager === 'npm'
    ) {
      return { bin: 'npm', args: ['ci'] };
    }
    return buildInstallCommand(packageManager, {
      force: dependencyState.reason === 'broken_installed_package',
    });
  }

  function buildDevCommand(packageManager, runtimeKind, port) {
    const hostArg = runtimeKind === 'next' ? '--hostname' : '--host';
    const runtimeArgs = [hostArg, '127.0.0.1', '--port', String(port)];
    if (packageManager === 'yarn') return { bin: 'yarn', args: ['dev', ...runtimeArgs] };
    if (packageManager === 'bun') return { bin: 'bun', args: ['run', 'dev', '--', ...runtimeArgs] };
    if (packageManager === 'pnpm') return { bin: 'pnpm', args: ['run', 'dev', '--', ...runtimeArgs] };
    return { bin: 'npm', args: ['run', 'dev', '--', ...runtimeArgs] };
  }

  function buildPlainScriptCommand(packageManager, scriptName) {
    if (packageManager === 'yarn') return { bin: 'yarn', args: [scriptName] };
    if (packageManager === 'bun') return { bin: 'bun', args: ['run', scriptName] };
    if (packageManager === 'pnpm') return { bin: 'pnpm', args: ['run', scriptName] };
    return { bin: 'npm', args: ['run', scriptName] };
  }

  function commandText(command) {
    if (!command || !command.bin) return '';
    return [command.bin, ...(Array.isArray(command.args) ? command.args : [])].join(' ');
  }

  function hasLocalBinary(rootPath, binaryName = '') {
    const name = String(binaryName || '').trim();
    if (!name) return true;
    const binDir = path.join(rootPath, 'node_modules', '.bin');
    return (
      safeExists(path.join(binDir, name)) ||
      safeExists(path.join(binDir, `${name}.cmd`)) ||
      safeExists(path.join(binDir, `${name}.ps1`))
    );
  }

  function isSourceFile(relativePath = '') {
    const relPath = toPosixPath(relativePath);
    if (/(^|\/)(node_modules|\.git|\.next|dist|build|coverage)\//.test(relPath)) return false;
    return /\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(relPath);
  }

  function collectKnownSourceFiles(rootPath, knownFiles) {
    const files = Array.from(knownFiles || []).filter(isSourceFile);
    if (files.length) return files.slice(0, 300);

    const discovered = [];
    const queue = ['app', 'pages', 'src', 'components', 'lib'];
    while (queue.length && discovered.length < 300) {
      const relDir = queue.shift();
      let entries = [];
      try {
        entries = fs.readdirSync(path.join(rootPath, relDir), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry || !entry.name || entry.name.startsWith('.')) continue;
        const relPath = toPosixPath(path.join(relDir, entry.name));
        if (entry.isDirectory()) {
          if (!/(^|\/)(node_modules|\.git|\.next|dist|build|coverage)$/.test(relPath)) queue.push(relPath);
          continue;
        }
        if (entry.isFile() && isSourceFile(relPath)) discovered.push(relPath);
        if (discovered.length >= 300) break;
      }
    }
    return discovered;
  }

  function extractBareImportPackage(specifier = '') {
    const value = String(specifier || '').trim();
    if (!value || value.startsWith('.') || value.startsWith('/') || /^[a-z]+:\/\//i.test(value)) return '';
    if (value.startsWith('#')) return '';
    if (value.startsWith('@')) {
      const parts = value.split('/').filter(Boolean);
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : '';
    }
    return value.split('/')[0] || '';
  }

  function collectImportedPackagesFromContent(content = '') {
    const imported = new Set();
    const text = String(content || '');
    const patterns = [
      /\bimport\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
      /\bexport\s+[^'"]+?\s+from\s+['"]([^'"]+)['"]/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
      let match = pattern.exec(text);
      while (match) {
        const packageName = extractBareImportPackage(match[1]);
        if (packageName) imported.add(packageName);
        match = pattern.exec(text);
      }
    }
    return imported;
  }

  function collectImportedPackages(rootPath, knownFiles) {
    const imported = new Set();
    for (const relPath of collectKnownSourceFiles(rootPath, knownFiles)) {
      let content = '';
      try {
        content = fs.readFileSync(path.join(rootPath, relPath), 'utf8');
      } catch {
        continue;
      }
      for (const packageName of collectImportedPackagesFromContent(content)) imported.add(packageName);
    }
    return imported;
  }

  function findMissingDeclaredImportedPackages(rootPath, packageJson, knownFiles) {
    const declared = new Set(packageNames(packageJson));
    if (!declared.size) return [];
    return Array.from(collectImportedPackages(rootPath, knownFiles))
      .filter((packageName) => declared.has(packageName))
      .filter((packageName) => !safeExists(path.join(rootPath, 'node_modules', packageName, 'package.json')))
      .sort();
  }

  function findBrokenInstalledPackage(rootPath) {
    const checks = [
      {
        packageName: 'ts-interface-checker',
        requiredFiles: ['dist/index.js', 'dist/types.js'],
      },
    ];

    return checks.find((check) => {
      const packageRoot = path.join(rootPath, 'node_modules', check.packageName);
      if (!safeExists(path.join(packageRoot, 'package.json'))) return false;
      return check.requiredFiles.some((relativePath) => !safeExists(path.join(packageRoot, relativePath)));
    }) || null;
  }

  function inferScriptBinary(script = '') {
    const normalized = String(script || '').trim();
    if (!normalized) return '';
    const parts = normalized.split(/\s+/).filter(Boolean);
    while (parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[0])) parts.shift();
    if (parts[0] === 'cross-env') parts.shift();
    while (parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[0])) parts.shift();
    const first = parts[0] || '';
    return /^(next|vite|electron|astro|vue-cli-service|svelte-kit)$/.test(first) ? first : '';
  }

  function inferRequiredRuntimeBinary(packageJson, runtimeKind) {
    if (runtimeKind === 'next') return 'next';
    if (runtimeKind === 'electron') return 'electron';
    const scriptBinary = inferScriptBinary(getPackageScript(packageJson, 'dev'));
    if (scriptBinary) return scriptBinary;
    if (runtimeKind === 'react' && packageHasDependency(packageJson, 'vite')) return 'vite';
    return '';
  }

  function assessDependencyReadiness(rootPath, packageJson, runtimeKind, knownFiles = new Set()) {
    const nodeModulesPath = path.join(rootPath, 'node_modules');
    const requiredBinary = inferRequiredRuntimeBinary(packageJson, runtimeKind);
    if (!safeExists(nodeModulesPath)) {
      return {
        ready: false,
        reason: 'missing_node_modules',
        requiredBinary,
        hasPackageLock: safeExists(path.join(rootPath, 'package-lock.json')),
        detail: 'Dependências ausentes; preview com servidor Node depende de instalação.',
      };
    }
    if (requiredBinary && !hasLocalBinary(rootPath, requiredBinary)) {
      return {
        ready: false,
        reason: 'missing_runtime_binary',
        requiredBinary,
        hasPackageLock: safeExists(path.join(rootPath, 'package-lock.json')),
        detail: `Dependências incompletas; node_modules existe, mas node_modules/.bin/${requiredBinary} não foi encontrado.`,
      };
    }
    const brokenPackage = findBrokenInstalledPackage(rootPath);
    if (brokenPackage) {
      return {
        ready: false,
        reason: 'broken_installed_package',
        requiredBinary,
        hasPackageLock: safeExists(path.join(rootPath, 'package-lock.json')),
        detail: `Dependências incompletas; node_modules/${brokenPackage.packageName} está presente, mas arquivos internos obrigatórios não foram encontrados.`,
      };
    }
    const missingDeclaredImports = findMissingDeclaredImportedPackages(rootPath, packageJson, knownFiles);
    if (missingDeclaredImports.length) {
      const missingList = missingDeclaredImports.slice(0, 5).join(', ');
      return {
        ready: false,
        reason: 'missing_declared_dependency',
        requiredBinary,
        hasPackageLock: safeExists(path.join(rootPath, 'package-lock.json')),
        missingPackages: missingDeclaredImports,
        detail: `Dependências declaradas e usadas no código ainda não estão instaladas em node_modules: ${missingList}.`,
      };
    }
    return {
      ready: true,
      reason: 'ready',
      requiredBinary,
      hasPackageLock: safeExists(path.join(rootPath, 'package-lock.json')),
      detail: 'Dependências locais prontas.',
    };
  }

  function buildManualDependencyStep(packageManager, dependencyState = {}) {
    const command = buildDependencyInstallCommand(packageManager, dependencyState);
    return {
      id: 'preview_dependencies',
      label: 'Instalar dependências para preview',
      kind: 'manual',
      status: 'manual',
      command,
      commandText: commandText(command),
      detail: dependencyState.detail || 'Dependências ausentes; preview com servidor Node depende de instalação manual.',
    };
  }

  function buildServerStep({ command, status, detail, blockedBy = [] }) {
    return {
      id: 'preview_server',
      label: 'Iniciar servidor de preview',
      kind: 'command',
      status,
      command,
      commandText: commandText(command),
      blockedBy,
      detail,
    };
  }

  function buildAppStep({ command, status, detail, blockedBy = [] }) {
    return {
      id: 'preview_app',
      label: 'Iniciar aplicativo de preview',
      kind: 'command',
      status,
      command,
      commandText: commandText(command),
      blockedBy,
      detail,
    };
  }

  function buildOpenStep({ url, status = 'ready', detail = 'Abrir URL de preview.' }) {
    return {
      id: 'preview_open',
      label: 'Abrir preview',
      kind: 'open',
      status,
      url,
      detail,
    };
  }

  function parseManualPreviewUrl(options = {}) {
    const rawUrl = String(options.manualPreviewUrl || options.activePreviewUrl || '').trim();
    if (!rawUrl) return null;
    try {
      const url = new URL(rawUrl);
      if (!/^https?:$/.test(url.protocol)) return null;
      const hostname = String(url.hostname || '').toLowerCase();
      if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) return null;
      const port = Number.parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10);
      if (!port) return null;
      return {
        url: url.href,
        port,
      };
    } catch {
      return null;
    }
  }

  function buildManualActivePreviewPlan(rootPath, options = {}) {
    const activePreview = parseManualPreviewUrl(options);
    if (!activePreview) return null;
    return {
      ok: true,
      ready: true,
      rootPath,
      mode: 'server',
      stack: 'Manual HTTP preview',
      status: 'ready',
      source: 'manual_active_preview',
      port: activePreview.port,
      url: activePreview.url,
      command: null,
      commandText: '',
      cwd: rootPath,
      packageManager: null,
      steps: [
        buildOpenStep({
          url: activePreview.url,
          detail: 'Usar preview local já iniciado manualmente.',
        }),
      ],
      warnings: [],
      message: 'Plano de preview usando servidor local já ativo.',
    };
  }

  function rejectInvalidRoot() {
    return {
      ok: false,
      ready: false,
      rootPath: '',
      mode: 'unsupported',
      status: 'blocked',
      steps: [],
      warnings: ['Selecione uma pasta de projeto antes de gerar preview.'],
      message: 'Projeto sem rootPath válido para preview.',
    };
  }

  function buildStaticPreviewPlan(rootPath, entryFile) {
    const entryPath = path.join(rootPath, entryFile);
    const url = pathToFileURL(entryPath).href;
    return {
      ok: true,
      ready: true,
      rootPath,
      mode: 'file',
      stack: 'web_estatico',
      status: 'ready',
      entryFile,
      url,
      steps: [buildOpenStep({ url, detail: `Abrir ${entryFile} diretamente no navegador.` })],
      warnings: [],
      message: 'Preview estático pronto.',
    };
  }

  function buildLampPreviewPlan(rootPath, entryFile, options = {}) {
    const port = Number.parseInt(options.port || '8080', 10);
    const docRoot = entryFile.startsWith('public/') ? 'public' : '.';
    const url = `http://127.0.0.1:${port}/`;
    const command = { bin: 'php', args: ['-S', `127.0.0.1:${port}`, '-t', docRoot] };
    return {
      ok: true,
      ready: true,
      rootPath,
      mode: 'server',
      stack: 'PHP/LAMP',
      status: 'ready',
      entryFile,
      port,
      url,
      command,
      commandText: commandText(command),
      cwd: rootPath,
      steps: [
        buildServerStep({
          command,
          status: 'ready',
          detail: 'Servidor PHP embutido para preview local.',
        }),
        buildOpenStep({ url }),
      ],
      warnings: ['O preview LAMP depende do binário `php` disponível no ambiente local.'],
      message: 'Plano de preview LAMP pronto.',
    };
  }

  function buildNodePreviewPlan(rootPath, packageJson, packageManager, runtimeKind, options = {}, knownFiles = new Set()) {
    const port = Number.parseInt(options.port || (runtimeKind === 'next' ? '3000' : '5173'), 10);
    const url = `http://127.0.0.1:${port}/`;
    const dependencyState = assessDependencyReadiness(rootPath, packageJson, runtimeKind, knownFiles);
    const dependenciesInstalled = dependencyState.ready;
    const hasDevScript = packageHasScript(packageJson, 'dev');
    const command = buildDevCommand(packageManager, runtimeKind, port);
    const steps = [];
    const blockers = [];
    const warnings = [];

    if (!dependenciesInstalled) {
      steps.push(buildManualDependencyStep(packageManager, dependencyState));
      blockers.push('preview_dependencies');
      if (
        dependencyState.reason === 'missing_runtime_binary' ||
        dependencyState.reason === 'broken_installed_package' ||
        dependencyState.reason === 'missing_declared_dependency'
      ) warnings.push(dependencyState.detail);
    }
    if (!hasDevScript) warnings.push('Script `dev` ausente no package.json; preview por servidor Node fica bloqueado.');

    const ready = dependenciesInstalled && hasDevScript;
    steps.push(buildServerStep({
      command,
      status: ready ? 'ready' : 'blocked',
      blockedBy: blockers,
      detail: ready
        ? 'Servidor de desenvolvimento pronto para iniciar.'
        : 'Servidor de preview bloqueado por dependências ausentes ou script `dev` inexistente.',
    }));
    steps.push(buildOpenStep({
      url,
      status: ready ? 'ready' : 'blocked',
      detail: ready ? 'Abrir URL depois que o servidor estiver ativo.' : 'URL depende do servidor de preview.',
    }));

    return {
      ok: true,
      ready,
      rootPath,
      mode: 'server',
      stack: runtimeKind === 'next' ? 'Next.js' : 'React',
      status: ready ? 'ready' : 'blocked',
      port,
      url,
      command,
      commandText: commandText(command),
      cwd: rootPath,
      packageManager,
      steps,
      warnings,
      message: ready ? 'Plano de preview Node pronto.' : 'Plano de preview Node tem bloqueios manuais.',
    };
  }

  function buildElectronPreviewPlan(rootPath, packageJson, packageManager, knownFiles) {
    const dependencyState = assessDependencyReadiness(rootPath, packageJson, 'electron', knownFiles);
    const dependenciesInstalled = dependencyState.ready;
    const hasDevScript = packageHasScript(packageJson, 'dev');
    const entryFile = findFirstProjectFile(rootPath, knownFiles, ['main.js', 'electron/main.js', 'src/main.js']);
    const command = buildPlainScriptCommand(packageManager, 'dev');
    const steps = [];
    const blockers = [];
    const warnings = [];

    if (!dependenciesInstalled) {
      steps.push(buildManualDependencyStep(packageManager, dependencyState));
      blockers.push('preview_dependencies');
      if (
        dependencyState.reason === 'missing_runtime_binary' ||
        dependencyState.reason === 'broken_installed_package' ||
        dependencyState.reason === 'missing_declared_dependency'
      ) warnings.push(dependencyState.detail);
    }
    if (!hasDevScript) warnings.push('Script `dev` ausente no package.json; preview Electron fica bloqueado.');
    if (!entryFile) warnings.push('Entrada Electron não encontrada em main.js, electron/main.js ou src/main.js.');

    const ready = dependenciesInstalled && hasDevScript;
    steps.push(buildAppStep({
      command,
      status: ready ? 'ready' : 'blocked',
      blockedBy: blockers,
      detail: ready
        ? 'Aplicativo Electron pronto para iniciar via script dev.'
        : 'Preview Electron bloqueado por dependências ausentes ou script `dev` inexistente.',
    }));

    return {
      ok: true,
      ready,
      rootPath,
      mode: 'app',
      stack: 'Electron',
      status: ready ? 'ready' : 'blocked',
      entryFile,
      port: null,
      url: null,
      command,
      commandText: commandText(command),
      cwd: rootPath,
      packageManager,
      steps,
      warnings,
      message: ready ? 'Plano de preview Electron pronto.' : 'Plano de preview Electron tem bloqueios manuais.',
    };
  }

  function buildGenericNodePreviewPlan(rootPath, packageJson, packageManager, options = {}, knownFiles = new Set()) {
    const port = Number.parseInt(options.port || '5173', 10);
    const url = `http://127.0.0.1:${port}/`;
    const dependencyState = assessDependencyReadiness(rootPath, packageJson, 'generic', knownFiles);
    const dependenciesInstalled = dependencyState.ready;
    const hasDevScript = packageHasScript(packageJson, 'dev');
    const command = buildDevCommand(packageManager, 'generic', port);
    const steps = [];
    const blockers = [];
    const warnings = ['Stack Node generica; confirme no navegador se o script `dev` aceita `--host` e `--port`.'];

    if (!dependenciesInstalled) {
      steps.push(buildManualDependencyStep(packageManager, dependencyState));
      blockers.push('preview_dependencies');
      if (
        dependencyState.reason === 'missing_runtime_binary' ||
        dependencyState.reason === 'broken_installed_package' ||
        dependencyState.reason === 'missing_declared_dependency'
      ) warnings.push(dependencyState.detail);
    }
    if (!hasDevScript) warnings.push('Script `dev` ausente no package.json.');

    const ready = dependenciesInstalled && hasDevScript;
    steps.push(buildServerStep({
      command,
      status: ready ? 'ready' : 'blocked',
      blockedBy: blockers,
      detail: ready ? 'Servidor generico de desenvolvimento pronto para iniciar.' : 'Preview generico bloqueado.',
    }));
    steps.push(buildOpenStep({ url, status: ready ? 'ready' : 'blocked' }));

    return {
      ok: true,
      ready,
      rootPath,
      mode: 'server',
      stack: 'Node',
      status: ready ? 'ready' : 'blocked',
      port,
      url,
      command,
      commandText: commandText(command),
      cwd: rootPath,
      packageManager,
      steps,
      warnings,
      message: ready ? 'Plano de preview Node generico pronto.' : 'Plano de preview Node generico tem bloqueios.',
    };
  }

  function buildProjectPreviewPlan(projectInfo = {}, options = {}) {
    const rawRootPath = String(projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '').trim();
    if (!rawRootPath) return rejectInvalidRoot();

    const rootPath = path.resolve(rawRootPath);
    if (rootPath === path.parse(rootPath).root) return rejectInvalidRoot();

    const manualPlan = buildManualActivePreviewPlan(rootPath, options);
    if (manualPlan) return manualPlan;

    const knownFiles = collectKnownFiles(projectInfo);
    const packageJson = safeReadJson(path.join(rootPath, 'package.json'));
    const packageManager = packageJson ? detectPackageManager(rootPath) : null;
    const hasNext = hasStack(projectInfo, 'Next.js') || packageHasDependency(packageJson, 'next');
    const hasReact = hasStack(projectInfo, 'React') || packageHasDependency(packageJson, 'react');
    const hasElectron = hasStack(projectInfo, 'Electron') || packageHasDependency(packageJson, 'electron');
    const lampEntry = findFirstProjectFile(rootPath, knownFiles, ['public/index.php', 'index.php']);
    const staticEntry = findFirstProjectFile(rootPath, knownFiles, ['index.html', 'public/index.html']);

    if (hasNext && packageJson) {
      return buildNodePreviewPlan(rootPath, packageJson, packageManager, 'next', options, knownFiles);
    }

    if (hasElectron && packageJson) {
      return buildElectronPreviewPlan(rootPath, packageJson, packageManager, knownFiles);
    }

    if (hasReact && packageJson) {
      return buildNodePreviewPlan(rootPath, packageJson, packageManager, 'react', options, knownFiles);
    }

    if (lampEntry) {
      return buildLampPreviewPlan(rootPath, lampEntry, options);
    }

    if (staticEntry) {
      return buildStaticPreviewPlan(rootPath, staticEntry);
    }

    if (packageJson) {
      return buildGenericNodePreviewPlan(rootPath, packageJson, packageManager, options, knownFiles);
    }

    return {
      ok: true,
      ready: false,
      rootPath,
      mode: 'unsupported',
      stack: 'Projeto generico',
      status: 'unsupported',
      steps: [],
      warnings: ['Nao foi encontrada uma entrada de preview conhecida: index.html, index.php ou package.json com script dev.'],
      message: 'Preview automatico ainda nao suportado para esta estrutura.',
    };
  }

  return {
    buildProjectPreviewPlan,
    detectPackageManager,
  };
}

module.exports = {
  createProjectPreviewService,
  normalizePreviewText,
};
