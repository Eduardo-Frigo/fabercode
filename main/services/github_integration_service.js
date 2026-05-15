const defaultFs = require('fs');
const defaultPath = require('path');

const DEFAULT_BRANCH = 'main';
const DEFAULT_COMMIT_MESSAGE = 'Initial Faber Code commit';
const DEFAULT_GITIGNORE_LINES = [
  'node_modules/',
  '.next/',
  'dist/',
  'build/',
  '.env',
  '.env.*',
  '!.env.example',
  '.DS_Store',
];

function normalizeGithubText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function createGithubIntegrationService(dependencies = {}) {
  const {
    fs = defaultFs,
    path = defaultPath,
    runCommand = async () => ({ ok: false, stdout: '', stderr: 'runCommand unavailable' }),
    timeoutMs = 20000,
  } = dependencies;

  function safeExists(filePath) {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  function safeReadFile(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  }

  function safeWriteFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
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

  function normalizeRepoName(value = '') {
    const cleaned = String(value || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^[._-]+/, '')
      .replace(/[._-]+$/, '')
      .slice(0, 100);
    return cleaned || 'faber-code-project';
  }

  function normalizeVisibility(value = '') {
    const normalized = normalizeGithubText(value);
    if (normalized === 'public' || normalized === 'publico') return 'public';
    return 'private';
  }

  function normalizeOwner(value = '') {
    return String(value || '')
      .trim()
      .replace(/^@+/, '')
      .replace(/[^a-zA-Z0-9-]+/g, '');
  }

  function normalizeBranch(value = '') {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._/-]+/g, '-')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '') || DEFAULT_BRANCH;
  }

  function quoteCommandArg(value = '') {
    const text = String(value || '');
    if (/^[a-zA-Z0-9_./:@-]+$/.test(text)) return text;
    return `"${text.replace(/"/g, '\\"')}"`;
  }

  function commandText(bin, args = []) {
    return [bin, ...(Array.isArray(args) ? args : [])].map(quoteCommandArg).join(' ');
  }

  function parseGhUsername(output = '') {
    const text = String(output || '');
    const accountMatch = text.match(/account\s+([^\s()]+)/i);
    if (accountMatch) return accountMatch[1].replace(/^@/, '');
    const loggedMatch = text.match(/logged in to github\.com as\s+([^\s()]+)/i);
    if (loggedMatch) return loggedMatch[1].replace(/^@/, '');
    return '';
  }

  function normalizeGitRemoteUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    const sshMatch = value.match(/^git@github\.com:([^\s]+)$/i);
    if (sshMatch) return `https://github.com/${sshMatch[1].replace(/\.git$/i, '')}`;
    if (/^https?:\/\/github\.com\//i.test(value)) return value.replace(/\.git$/i, '');
    return value.replace(/\.git$/i, '');
  }

  async function getGithubAuthStatus() {
    const version = await runCommand('gh', ['--version'], { timeoutMs: 3000 });
    if (isCommandUnavailableResult(version, 'gh')) {
      return {
        ok: true,
        ghInstalled: false,
        authenticated: false,
        username: '',
        message: 'GitHub CLI (`gh`) não está instalado.',
      };
    }
    if (!version.ok) {
      return {
        ok: false,
        ghInstalled: false,
        authenticated: false,
        username: '',
        message: 'Não foi possível executar GitHub CLI (`gh`).',
      };
    }

    const auth = await runCommand('gh', ['auth', 'status', '--hostname', 'github.com'], { timeoutMs: 5000 });
    const output = `${auth.stdout || ''}\n${auth.stderr || ''}`;
    if (!auth.ok) {
      return {
        ok: true,
        ghInstalled: true,
        authenticated: false,
        username: parseGhUsername(output),
        message: 'GitHub CLI instalado, mas sem autenticação ativa para github.com.',
      };
    }

    return {
      ok: true,
      ghInstalled: true,
      authenticated: true,
      username: parseGhUsername(output),
      message: 'GitHub CLI autenticado.',
    };
  }

  async function getLocalGitState(rootPath) {
    const inside = await runCommand('git', ['-C', rootPath, 'rev-parse', '--is-inside-work-tree'], {
      timeoutMs: 3000,
    });
    const isGitRepo = Boolean(inside.ok && /true/i.test(String(inside.stdout || '').trim()));
    if (!isGitRepo) {
      return {
        isGitRepo: false,
        branch: '',
        hasCommits: false,
        hasChanges: true,
        originUrl: '',
        originGithubUrl: '',
      };
    }

    const branch = await runCommand('git', ['-C', rootPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 });
    const head = await runCommand('git', ['-C', rootPath, 'rev-parse', '--verify', 'HEAD'], { timeoutMs: 3000 });
    const status = await runCommand('git', ['-C', rootPath, 'status', '--porcelain'], { timeoutMs: 5000 });
    const origin = await runCommand('git', ['-C', rootPath, 'remote', 'get-url', 'origin'], { timeoutMs: 3000 });
    const originUrl = origin.ok ? String(origin.stdout || '').trim() : '';
    const originGithubUrl = normalizeGitRemoteUrl(originUrl);

    return {
      isGitRepo: true,
      branch: branch.ok ? String(branch.stdout || '').trim() : '',
      hasCommits: Boolean(head.ok),
      hasChanges: !status.ok || String(status.stdout || '').trim().length > 0,
      originUrl,
      originGithubUrl,
    };
  }

  function getGitignoreStatus(rootPath) {
    const gitignorePath = path.join(rootPath, '.gitignore');
    const content = safeReadFile(gitignorePath);
    const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
    const missing = DEFAULT_GITIGNORE_LINES.filter((line) => !lines.includes(line));
    const hasEnvFile = safeExists(path.join(rootPath, '.env'));
    const ignoresEnv = lines.includes('.env') || lines.includes('.env*') || lines.includes('.env.*');
    return {
      exists: safeExists(gitignorePath),
      path: gitignorePath,
      missing,
      hasEnvFile,
      ignoresEnv,
      needsUpdate: missing.length > 0,
    };
  }

  function ensureGitignore(rootPath) {
    const status = getGitignoreStatus(rootPath);
    if (!status.needsUpdate) return { changed: false, missing: [] };
    const current = safeReadFile(status.path);
    const prefix = current && !current.endsWith('\n') ? '\n' : '';
    const next = `${current}${prefix}${status.missing.join('\n')}\n`;
    safeWriteFile(status.path, next);
    return { changed: true, missing: status.missing };
  }

  function buildRepoFullName(owner, repoName) {
    return owner ? `${owner}/${repoName}` : repoName;
  }

  function buildGhCreateArgs({ owner, repoName, visibility, sourcePath, remoteName, push = true }) {
    const args = ['repo', 'create', buildRepoFullName(owner, repoName), `--${visibility}`, '--source', sourcePath, '--remote', remoteName];
    if (push) args.push('--push');
    return args;
  }

  function action(id, label, bin, args, required = true) {
    return {
      id,
      label,
      kind: 'command',
      required,
      command: { bin, args },
      commandText: commandText(bin, args),
    };
  }

  async function buildGithubPublishPlan(projectInfo = {}, options = {}) {
    const rawRootPath = String(projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '').trim();
    if (!rawRootPath) {
      return {
        ok: false,
        ready: false,
        rootPath: '',
        actions: [],
        warnings: ['Selecione uma pasta de projeto antes de publicar no GitHub.'],
        message: 'Projeto sem rootPath válido.',
      };
    }

    const rootPath = path.resolve(rawRootPath);
    if (rootPath === path.parse(rootPath).root) {
      return {
        ok: false,
        ready: false,
        rootPath: '',
        actions: [],
        warnings: ['A raiz do filesystem não pode ser publicada como projeto.'],
        message: 'rootPath inválido.',
      };
    }

    const repoName = normalizeRepoName(options.repoName || path.basename(rootPath));
    const owner = normalizeOwner(options.owner || '');
    const visibility = normalizeVisibility(options.visibility || 'private');
    const branch = normalizeBranch(options.branch || DEFAULT_BRANCH);
    const commitMessage = String(options.commitMessage || DEFAULT_COMMIT_MESSAGE).trim() || DEFAULT_COMMIT_MESSAGE;
    const remoteName = String(options.remoteName || 'origin').trim() || 'origin';
    const auth = await getGithubAuthStatus();
    const git = await getLocalGitState(rootPath);
    const gitignore = getGitignoreStatus(rootPath);
    const hasGithubOrigin = Boolean(git.originGithubUrl && /^https:\/\/github\.com\//i.test(git.originGithubUrl));
    const needsRepoCreate = !git.originUrl;
    const needsCommit = !git.hasCommits || git.hasChanges || gitignore.needsUpdate;
    const warnings = [];
    const blockers = [];
    const actions = [];

    if (gitignore.hasEnvFile && !gitignore.ignoresEnv) {
      warnings.push('Arquivo `.env` encontrado; `.gitignore` precisa ignorar segredos antes do commit.');
    }
    if (git.originUrl && !hasGithubOrigin) {
      blockers.push('Remote `origin` existe, mas não aponta para github.com.');
    }
    if (needsRepoCreate && !auth.ghInstalled) blockers.push('GitHub CLI (`gh`) não está instalado.');
    if (needsRepoCreate && !auth.authenticated) blockers.push('GitHub CLI (`gh`) não está autenticado.');

    if (!git.isGitRepo) actions.push(action('git_init', 'Inicializar Git', 'git', ['-C', rootPath, 'init']));
    actions.push(action('git_branch', `Definir branch ${branch}`, 'git', ['-C', rootPath, 'branch', '-M', branch]));
    if (gitignore.needsUpdate) {
      actions.push({
        id: 'gitignore_update',
        label: 'Atualizar .gitignore seguro',
        kind: 'file',
        required: true,
        detail: `Adicionar: ${gitignore.missing.join(', ')}`,
      });
    }
    if (needsCommit) {
      actions.push(action('git_add', 'Preparar arquivos para commit', 'git', ['-C', rootPath, 'add', '-A']));
      actions.push(action('git_commit', 'Criar commit', 'git', ['-C', rootPath, 'commit', '-m', commitMessage]));
    }
    if (needsRepoCreate) {
      actions.push(action(
        'github_repo_create',
        'Criar repositório GitHub e enviar branch',
        'gh',
        buildGhCreateArgs({ owner, repoName, visibility, sourcePath: rootPath, remoteName, push: true })
      ));
    } else if (hasGithubOrigin) {
      actions.push(action('git_push', 'Enviar branch para GitHub', 'git', ['-C', rootPath, 'push', '-u', remoteName, branch]));
    }

    const ready = blockers.length === 0;
    return {
      ok: true,
      ready,
      rootPath,
      repoName,
      owner,
      repoFullName: buildRepoFullName(owner, repoName),
      visibility,
      branch,
      commitMessage,
      remoteName,
      auth,
      git,
      gitignore,
      hasGithubOrigin,
      needsRepoCreate,
      needsCommit,
      actions,
      warnings,
      blockers,
      message: ready
        ? 'Plano GitHub pronto para confirmação.'
        : 'Plano GitHub bloqueado por pré-requisitos.',
    };
  }

  async function runStep(results, id, label, bin, args, rootPath) {
    const result = await runCommand(bin, args, { cwd: rootPath, timeoutMs });
    const entry = {
      id,
      label,
      commandText: commandText(bin, args),
      status: result.ok ? 'passed' : 'failed',
      detail: result.ok
        ? 'Comando concluído.'
        : String(result.stderr || result.stdout || 'Comando falhou sem saída detalhada.').trim().split('\n')[0],
    };
    results.push(entry);
    return result.ok;
  }

  async function executeGithubPublish(projectInfo = {}, options = {}) {
    const plan = await buildGithubPublishPlan(projectInfo, options);
    if (!plan.ok || !plan.ready) {
      return {
        ok: false,
        plan,
        results: [],
        message: plan.message || 'Publicação GitHub bloqueada.',
      };
    }

    const results = [];
    if (!plan.git.isGitRepo) {
      const initialized = await runStep(results, 'git_init', 'Inicializar Git', 'git', ['-C', plan.rootPath, 'init'], plan.rootPath);
      if (!initialized) return { ok: false, plan, results, message: 'Falha ao inicializar Git.' };
    }

    const branched = await runStep(
      results,
      'git_branch',
      `Definir branch ${plan.branch}`,
      'git',
      ['-C', plan.rootPath, 'branch', '-M', plan.branch],
      plan.rootPath
    );
    if (!branched) return { ok: false, plan, results, message: 'Falha ao definir branch.' };

    if (plan.gitignore.needsUpdate) {
      const updated = ensureGitignore(plan.rootPath);
      results.push({
        id: 'gitignore_update',
        label: 'Atualizar .gitignore seguro',
        status: 'passed',
        detail: updated.changed ? `Linhas adicionadas: ${updated.missing.join(', ')}` : 'Sem mudanças necessárias.',
      });
    }

    const needsCommitAfterGitignore = plan.needsCommit || plan.gitignore.needsUpdate;
    if (needsCommitAfterGitignore) {
      const added = await runStep(results, 'git_add', 'Preparar arquivos para commit', 'git', ['-C', plan.rootPath, 'add', '-A'], plan.rootPath);
      if (!added) return { ok: false, plan, results, message: 'Falha ao preparar arquivos para commit.' };

      const status = await runCommand('git', ['-C', plan.rootPath, 'status', '--porcelain'], {
        cwd: plan.rootPath,
        timeoutMs: 5000,
      });
      if (status.ok && String(status.stdout || '').trim()) {
        const committed = await runStep(
          results,
          'git_commit',
          'Criar commit',
          'git',
          ['-C', plan.rootPath, 'commit', '-m', plan.commitMessage],
          plan.rootPath
        );
        if (!committed) {
          return {
            ok: false,
            plan,
            results,
            message: 'Falha ao criar commit. Confira `git config user.name` e `git config user.email`.',
          };
        }
      } else {
        results.push({
          id: 'git_commit',
          label: 'Criar commit',
          status: 'skipped',
          detail: 'Nenhuma alteração para commit.',
        });
      }
    }

    if (plan.needsRepoCreate) {
      const created = await runStep(
        results,
        'github_repo_create',
        'Criar repositório GitHub e enviar branch',
        'gh',
        buildGhCreateArgs({
          owner: plan.owner,
          repoName: plan.repoName,
          visibility: plan.visibility,
          sourcePath: plan.rootPath,
          remoteName: plan.remoteName,
          push: true,
        }),
        plan.rootPath
      );
      if (!created) return { ok: false, plan, results, message: 'Falha ao criar repositório GitHub.' };
    } else if (plan.hasGithubOrigin) {
      const pushed = await runStep(
        results,
        'git_push',
        'Enviar branch para GitHub',
        'git',
        ['-C', plan.rootPath, 'push', '-u', plan.remoteName, plan.branch],
        plan.rootPath
      );
      if (!pushed) return { ok: false, plan, results, message: 'Falha ao enviar branch para GitHub.' };
    }

    const repoUrl = plan.needsRepoCreate
      ? `https://github.com/${plan.repoFullName}`
      : plan.git.originGithubUrl;
    return {
      ok: true,
      plan,
      results,
      repoUrl,
      message: 'Projeto publicado no GitHub.',
    };
  }

  return {
    buildGithubPublishPlan,
    executeGithubPublish,
    getGithubAuthStatus,
    isCommandUnavailableResult,
    normalizeRepoName,
    normalizeVisibility,
  };
}

module.exports = {
  createGithubIntegrationService,
  normalizeGithubText,
};
