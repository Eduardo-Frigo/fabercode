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

    return {
      hasPackage,
      hasNext: hasStack(projectInfo, 'Next.js') || hasNextDependency || hasNextEntry,
      hasReact: hasStack(projectInfo, 'React') || hasReactDependency,
      hasElectron: hasStack(projectInfo, 'Electron') || hasElectronDependency,
      hasTailwind: hasStack(projectInfo, 'Tailwind CSS') || hasTailwindDependency,
      hasLamp: hasStack(projectInfo, 'PHP/LAMP') || hasLampEntry,
      hasStaticWeb: !hasPackage && !hasLampEntry && hasHtmlEntry,
      hasHtmlEntry,
      hasLampEntry,
      hasElectronEntry,
      hasNextEntry,
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

      const runtimePrerequisites = [];
      const scriptOrder = [
        { name: 'build', label: 'Build da aplicação', required: flags.hasNext || (flags.hasReact && !flags.hasElectron) },
        { name: 'typecheck', label: 'Typecheck', required: false },
        { name: 'lint', label: 'Lint', required: false },
        { name: 'test', label: 'Testes automatizados', required: false },
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
      const persistenceRequested = options.requirePersistence === true ||
        /\b(postgres|postgresql|prisma|banco|database|persist[eê]ncia|persistir|migration|seed)\b/i.test(String(options.userMessage || options.acceptanceContext || ''));
      if (persistenceRequested || (hasPrismaDependency && hasPrismaSchema && usesPostgres)) {
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

        for (const scriptName of ['db:up', 'db:generate', 'db:migrate', 'db:seed', 'db:check']) {
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
            detail: `Executa \`${commandText(command)}\` para comprovar persistência real.`,
          }));
          previousPersistenceCommandId = stepId;
        }

        if (previousPersistenceCommandId) runtimePrerequisites.push(previousPersistenceCommandId);
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
