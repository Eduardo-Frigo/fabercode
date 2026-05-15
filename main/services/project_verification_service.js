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

  function packageHasScript(packageJson, scriptName) {
    return Boolean(packageJson && packageJson.scripts && typeof packageJson.scripts[scriptName] === 'string');
  }

  function isPlaceholderTestScript(scriptValue = '') {
    const source = normalizeVerificationText(scriptValue);
    return source.includes('no test specified') || source.includes('sem testes') || source.includes('exit 1');
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

  function buildProjectVerificationPlan(projectInfo = {}) {
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
      const dependencyStepId = 'node_dependencies';
      if (!dependenciesInstalled) {
        const installCommand = buildInstallCommand(packageManager);
        steps.push(buildManualStep({
          id: dependencyStepId,
          label: 'Instalar dependências Node',
          command: installCommand,
          detail: 'Dependências não estão instaladas; a verificação não roda instalação automaticamente.',
        }));
      }

      const blockedByDependencies = dependenciesInstalled ? [] : [dependencyStepId];
      const scriptOrder = [
        { name: 'build', label: 'Build da aplicação', required: flags.hasNext || (flags.hasReact && !flags.hasElectron) },
        { name: 'typecheck', label: 'Typecheck', required: false },
        { name: 'lint', label: 'Lint', required: false },
        { name: 'test', label: 'Testes automatizados', required: false },
      ];

      for (const script of scriptOrder) {
        if (!packageHasScript(packageJson, script.name)) {
          if (script.required) warnings.push(`Script \`${script.name}\` ausente no package.json.`);
          continue;
        }
        if (script.name === 'test' && isPlaceholderTestScript(packageJson.scripts.test)) {
          warnings.push('Script `test` parece placeholder e será ignorado pela verificação automática.');
          continue;
        }
        const command = buildScriptCommand(packageManager, script.name);
        steps.push(buildCommandStep({
          id: `node_${script.name}`,
          label: script.label,
          command,
          required: script.required,
          blockedBy: blockedByDependencies,
          detail: `Executa \`${commandText(command)}\` na raiz do projeto.`,
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

  async function runProjectVerification(projectInfo = {}) {
    const plan = buildProjectVerificationPlan(projectInfo);
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

    for (const step of plan.steps) {
      if (step.kind === 'static') {
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

      const blockers = (Array.isArray(step.blockedBy) ? step.blockedBy : []).filter((id) => unresolvedManualSteps.has(id));
      if (blockers.length) {
        results.push({
          id: step.id,
          label: step.label,
          status: 'blocked',
          required: step.required,
          commandText: step.commandText,
          blockedBy: blockers,
          detail: 'Comando bloqueado por etapa manual pendente.',
        });
        continue;
      }

      const command = step.command || {};
      const commandResult = await runCommand(command.bin, command.args || [], {
        cwd: plan.rootPath,
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
