const defaultFs = require('fs');
const defaultPath = require('path');

function createProjectGitService(dependencies = {}) {
  const {
    fs = defaultFs,
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff = (value) => {
      let str = String(value || '').trim();
      if (str.startsWith('"') && str.endsWith('"')) {
        str = str.slice(1, -1);
        str = str.replace(/\\([0-7]{1,3})/g, (match, octal) => String.fromCharCode(parseInt(octal, 8)));
        str = str.replace(/\\(.)/g, (match, char) => {
          switch (char) {
            case 'n': return '\n';
            case 'r': return '\r';
            case 't': return '\t';
            case 'b': return '\b';
            case 'f': return '\f';
            default: return char;
          }
        });
      }
      return str.replace(/^\/+/, '').split('\\').join('/');
    },

    path = defaultPath,
    runCommand,
  } = dependencies;

  function requireDependency(name, value) {
    if (typeof value !== 'function') {
      throw new Error(`Project Git service dependency missing: ${name}`);
    }
  }

  function normalizeGitRemoteUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return null;

    const sshMatch = value.match(/^git@github\.com:([^\s]+)$/i);
    if (sshMatch) {
      return `https://github.com/${sshMatch[1].replace(/\.git$/i, '')}`;
    }

    if (/^https?:\/\/github\.com\//i.test(value)) {
      return value.replace(/\.git$/i, '');
    }

    return value.replace(/\.git$/i, '');
  }

  function gitPathArgs(rootPath, args = []) {
    return ['-C', rootPath, '-c', 'core.quotepath=false', ...args];
  }

  function normalizeGitSelectedPath(file) {
    const raw = String(file || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    if (!raw || raw.includes('\0')) return null;
    if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) return null;
    if (raw.split('/').includes('..')) return null;
    const normalized = normalizeRelativePathForDiff(raw).replace(/^(\.\/)+/, '');
    if (!normalized || normalized.split('/').includes('..')) return null;
    return normalized;
  }

  function normalizeGitSelectedPaths(files = []) {
    const selectedFiles = [];
    for (const file of Array.isArray(files) ? files : []) {
      const normalized = normalizeGitSelectedPath(file);
      if (!normalized) {
        return { ok: false, message: `Caminho Git inválido: ${String(file || '').trim() || '(vazio)'}` };
      }
      selectedFiles.push(normalized);
    }
    return { ok: true, files: selectedFiles };
  }

  async function getProjectGitStatus(rootPath) {
    requireDependency('runCommand', runCommand);

    const safeRoot = String(rootPath || '').trim();
    if (!safeRoot) return { ok: false, message: 'rootPath é obrigatório.' };

    const inside = await runCommand('git', ['-C', safeRoot, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 1400 });
    if (!inside.ok || !/true/i.test(String(inside.stdout || '').trim())) {
      return { ok: true, isGitRepo: false, message: 'Projeto não é um repositório Git.' };
    }

    const remoteRes = await runCommand('git', ['-C', safeRoot, 'remote', 'get-url', 'origin'], { timeoutMs: 1400 });
    const branchRes = await runCommand('git', ['-C', safeRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 1400 });
    const logRes = await runCommand('git', ['-C', safeRoot, 'log', '-1', '--pretty=format:%H%n%s%n%cr'], { timeoutMs: 1600 });

    const remoteUrlRaw = remoteRes.ok ? String(remoteRes.stdout || '').trim() : '';
    const remoteUrl = normalizeGitRemoteUrl(remoteUrlRaw);
    const branch = branchRes.ok ? String(branchRes.stdout || '').trim() : '';
    const logLines = logRes.ok ? String(logRes.stdout || '').split('\n') : [];
    const latestHash = (logLines[0] || '').trim();
    const latestSubject = (logLines[1] || '').trim();
    const latestRelative = (logLines[2] || '').trim();

    const isGithub = Boolean(remoteUrl && /^https?:\/\/github\.com\//i.test(remoteUrl));
    const latestUrl = isGithub && latestHash ? `${remoteUrl}/commit/${latestHash}` : null;
    const actionsUrl = isGithub ? `${remoteUrl}/actions` : null;

    return {
      ok: true,
      isGitRepo: true,
      remoteUrl,
      branch,
      latest: {
        hash: latestHash,
        subject: latestSubject,
        relative: latestRelative,
      },
      latestUrl,
      actionsUrl,
    };
  }

  function parseNumstatLine(line) {
    const tabParts = String(line || '').split('\t');
    if (tabParts.length >= 3) {
      return {
        add: tabParts[0],
        del: tabParts[1],
        file: tabParts.slice(2).join('\t'),
      };
    }

    const match = String(line || '').match(/^(\S+)\s+(\S+)\s+(.+)$/);
    if (!match) return null;
    return { add: match[1], del: match[2], file: match[3] };
  }

  async function collectGitDiffStats(rootPath) {
    requireDependency('runCommand', runCommand);
    requireDependency('mergeDiffStatsEntry', mergeDiffStatsEntry);

    const stats = {};

    async function mergeNumstat(args) {
      const result = await runCommand('git', gitPathArgs(rootPath, args), { timeoutMs: 1800 });
      if (!result.ok || !result.stdout) return;

      const lines = result.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
      for (const line of lines) {
        const parsed = parseNumstatLine(line);
        if (!parsed) continue;
        const binary = parsed.add === '-' || parsed.del === '-';
        const add = binary ? 0 : Number(parsed.add) || 0;
        const del = binary ? 0 : Number(parsed.del) || 0;
        const file = normalizeRelativePathForDiff(parsed.file);
        mergeDiffStatsEntry(stats, file, { add, del });
        if (binary && file) {
          stats[file] = {
            ...(stats[file] || { add: 0, del: 0 }),
            binary: true,
          };
        }
      }
    }

    try {
      await mergeNumstat(['diff', '--numstat', '--']);
      await mergeNumstat(['diff', '--cached', '--numstat', '--']);

      const untrackedRes = await runCommand(
        'git',
        gitPathArgs(rootPath, ['ls-files', '--others', '--exclude-standard']),
        { timeoutMs: 1200 }
      );
      if (untrackedRes.ok && untrackedRes.stdout) {
        const files = untrackedRes.stdout
          .split('\n')
          .map((line) => normalizeRelativePathForDiff(line.trim()))
          .filter(Boolean);
        for (const file of files) {
          const binary = isLikelyBinaryProjectFile(rootPath, file);
          mergeDiffStatsEntry(stats, file, { add: binary ? 0 : 1, del: 0 });
          if (binary && file) {
            stats[file] = {
              ...(stats[file] || { add: 0, del: 0 }),
              binary: true,
            };
          }
        }
      }
    } catch {
      return stats;
    }

    return stats;
  }

  function parseDiffHunkFirstLine(line) {
    const match = String(line || '').match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    return match ? Math.max(1, Number(match[1]) || 1) : null;
  }

  function trimDiffPreviewLine(value) {
    return String(value || '')
      .replace(/\t/g, '  ')
      .trim()
      .slice(0, 180);
  }

  function isLikelyBinaryProjectFile(rootPath, relativePath) {
    let fd = null;
    try {
      const sample = Buffer.alloc(8000);
      fd = fs.openSync(path.join(rootPath, relativePath), 'r');
      const bytesRead = fs.readSync(fd, sample, 0, sample.length, 0);
      for (let index = 0; index < bytesRead; index += 1) {
        if (sample[index] === 0) return true;
      }
    } catch {
      return false;
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // Best effort.
        }
      }
    }
    return false;
  }

  function summarizeDiffHunk(hunk) {
    const added = hunk && Array.isArray(hunk.added) ? hunk.added.find(Boolean) : '';
    const removed = hunk && Array.isArray(hunk.removed) ? hunk.removed.find(Boolean) : '';
    if (added && removed) return `Alterou "${removed}" para "${added}"`;
    if (added) return `Adicionou "${added}"`;
    if (removed) return `Removeu "${removed}"`;
    return `Alteração próxima à linha ${Math.max(1, Number(hunk && hunk.line) || 1)}`;
  }

  async function collectGitDiffHunks(rootPath) {
    requireDependency('runCommand', runCommand);

    const hunksByFile = {};

    function pushHunk(file, hunk) {
      const normalizedFile = normalizeRelativePathForDiff(file);
      if (!normalizedFile || !hunk) return;
      const prepared = {
        line: Math.max(1, Number(hunk.line) || 1),
        added: (Array.isArray(hunk.added) ? hunk.added : []).filter(Boolean).slice(0, 3),
        removed: (Array.isArray(hunk.removed) ? hunk.removed : []).filter(Boolean).slice(0, 3),
        context: (Array.isArray(hunk.context) ? hunk.context : []).filter(Boolean).slice(0, 2),
      };
      prepared.summary = summarizeDiffHunk(prepared);
      if (!hunksByFile[normalizedFile]) hunksByFile[normalizedFile] = [];
      if (hunksByFile[normalizedFile].length < 4) hunksByFile[normalizedFile].push(prepared);
    }

    async function mergeUnifiedDiff(args) {
      const result = await runCommand('git', gitPathArgs(rootPath, args), { timeoutMs: 2400 });
      if (!result.ok || !result.stdout) return;

      let currentFile = '';
      let currentHunk = null;
      const finishHunk = () => {
        if (currentFile && currentHunk) pushHunk(currentFile, currentHunk);
        currentHunk = null;
      };

      const lines = String(result.stdout || '').split('\n');
      for (const line of lines) {
        if (line.startsWith('diff --git ')) {
          finishHunk();
          currentFile = '';
          continue;
        }
        if (line.startsWith('+++ b/')) {
          currentFile = normalizeRelativePathForDiff(line.slice(6));
          continue;
        }
        if (line.startsWith('+++ /dev/null')) {
          currentFile = '';
          continue;
        }
        const firstLine = parseDiffHunkFirstLine(line);
        if (firstLine) {
          finishHunk();
          currentHunk = { line: firstLine, added: [], removed: [], context: [] };
          continue;
        }
        if (!currentHunk) continue;
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('+')) {
          currentHunk.added.push(trimDiffPreviewLine(line.slice(1)));
        } else if (line.startsWith('-')) {
          currentHunk.removed.push(trimDiffPreviewLine(line.slice(1)));
        } else if (line.startsWith(' ')) {
          currentHunk.context.push(trimDiffPreviewLine(line.slice(1)));
        }
      }
      finishHunk();
    }

    try {
      await mergeUnifiedDiff(['diff', '--unified=3', '--']);
      await mergeUnifiedDiff(['diff', '--cached', '--unified=3', '--']);

      const untrackedRes = await runCommand(
        'git',
        gitPathArgs(rootPath, ['ls-files', '--others', '--exclude-standard']),
        { timeoutMs: 1200 }
      );
      if (untrackedRes.ok && untrackedRes.stdout) {
        untrackedRes.stdout
          .split('\n')
          .map((line) => normalizeRelativePathForDiff(line.trim()))
          .filter(Boolean)
          .forEach((file) => {
            if (!hunksByFile[file]) {
              hunksByFile[file] = [{
                line: 1,
                added: ['Arquivo novo no projeto'],
                removed: [],
                context: [],
                summary: 'Arquivo novo no projeto',
              }];
            }
          });
      }
    } catch {
      return hunksByFile;
    }

    return hunksByFile;
  }

  async function collectGitDiffFirstLines(rootPath) {
    requireDependency('runCommand', runCommand);

    const firstLines = {};

    async function mergeUnifiedDiff(args) {
      const result = await runCommand('git', gitPathArgs(rootPath, args), { timeoutMs: 2200 });
      if (!result.ok || !result.stdout) return;

      let currentFile = '';
      const lines = result.stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('+++ b/')) {
          currentFile = normalizeRelativePathForDiff(line.slice(6));
          continue;
        }
        const firstLine = parseDiffHunkFirstLine(line);
        if (currentFile && firstLine && !firstLines[currentFile]) {
          firstLines[currentFile] = firstLine;
        }
      }
    }

    try {
      await mergeUnifiedDiff(['diff', '--unified=0', '--']);
      await mergeUnifiedDiff(['diff', '--cached', '--unified=0', '--']);

      const untrackedRes = await runCommand(
        'git',
        gitPathArgs(rootPath, ['ls-files', '--others', '--exclude-standard']),
        { timeoutMs: 1200 }
      );
      if (untrackedRes.ok && untrackedRes.stdout) {
        untrackedRes.stdout
          .split('\n')
          .map((line) => normalizeRelativePathForDiff(line.trim()))
          .filter(Boolean)
          .forEach((file) => {
            if (!firstLines[file]) firstLines[file] = 1;
          });
      }
    } catch {
      return firstLines;
    }

    return firstLines;
  }

  function parsePorcelainStatusLine(line) {
    const value = String(line || '');
    if (!value.trim()) return null;

    if (value.startsWith('?? ')) {
      return {
        path: normalizeRelativePathForDiff(value.slice(3).trim()),
        status: 'untracked',
        staged: false,
        unstaged: true,
        index: '?',
        worktree: '?',
      };
    }

    const index = value[0] || ' ';
    const worktree = value[1] || ' ';
    const rawPath = value.slice(3).trim();
    const renameParts = rawPath.split(' -> ');
    const filePath = renameParts[renameParts.length - 1] || rawPath;
    const staged = index !== ' ' && index !== '?';
    const unstaged = worktree !== ' ';
    return {
      path: normalizeRelativePathForDiff(filePath),
      status: staged && unstaged ? 'mixed' : staged ? 'staged' : 'modified',
      staged,
      unstaged,
      index,
      worktree,
    };
  }

  async function getProjectGitWorktree(rootPath) {
    requireDependency('runCommand', runCommand);

    const status = await getProjectGitStatus(rootPath);
    if (!status.ok || !status.isGitRepo) {
      return { ...status, entries: [], diffStats: {} };
    }

    const porcelainRes = await runCommand(
      'git',
      gitPathArgs(rootPath, ['status', '--porcelain=v1']),
      { timeoutMs: 1600 }
    );
    const lines = porcelainRes.ok && porcelainRes.stdout
      ? porcelainRes.stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean)
      : [];
    const diffStats = await collectGitDiffStats(rootPath);
    const firstLines = await collectGitDiffFirstLines(rootPath);
    const diffHunks = await collectGitDiffHunks(rootPath);
    const entries = lines
      .map(parsePorcelainStatusLine)
      .filter((entry) => entry && entry.path)
      .map((entry) => {
        const hunks = Array.isArray(diffHunks[entry.path]) ? diffHunks[entry.path] : [];
        const firstHunk = hunks[0] || null;
        const binary = Boolean(diffStats[entry.path] && diffStats[entry.path].binary);
        return {
          ...entry,
          add: Number(diffStats[entry.path] && diffStats[entry.path].add) || 0,
          del: Number(diffStats[entry.path] && diffStats[entry.path].del) || 0,
          binary,
          firstLine: Number(firstHunk && firstHunk.line) || Number(firstLines[entry.path]) || 1,
          hunks,
          summary: binary
            ? 'Arquivo binário: diff textual indisponível.'
            : firstHunk && firstHunk.summary
              ? firstHunk.summary
              : '',
        };
      });

    return {
      ...status,
      entries,
      diffStats,
      diffHunks,
    };
  }

  async function initProjectGitRepository(rootPath) {
    requireDependency('runCommand', runCommand);

    const safeRoot = String(rootPath || '').trim();
    if (!safeRoot) return { ok: false, message: 'rootPath é obrigatório.' };

    const result = await runCommand('git', ['-C', safeRoot, 'init'], { timeoutMs: 6000 });
    if (!result.ok) {
      return {
        ok: false,
        message: String(result.stderr || result.stdout || 'Não consegui ativar o repositório Git local.').trim(),
      };
    }
    const status = await getProjectGitWorktree(safeRoot);
    return { ...status, ok: true, initialized: true };
  }

  async function stageProjectGitFiles(rootPath, files = []) {
    requireDependency('runCommand', runCommand);

    const safeRoot = String(rootPath || '').trim();
    const normalizedFiles = normalizeGitSelectedPaths(files);
    if (!normalizedFiles.ok) return normalizedFiles;
    const selectedFiles = normalizedFiles.files;
    if (!safeRoot) return { ok: false, message: 'rootPath é obrigatório.' };
    if (!selectedFiles.length) return { ok: false, message: 'Selecione ao menos um arquivo para stage.' };

    const result = await runCommand('git', ['-C', safeRoot, 'add', '--', ...selectedFiles], { timeoutMs: 6000 });
    if (!result.ok) {
      return {
        ok: false,
        message: String(result.stderr || result.stdout || 'Não consegui adicionar os arquivos ao stage.').trim(),
      };
    }
    const worktree = await getProjectGitWorktree(safeRoot);
    return { ...worktree, ok: true, stagedFiles: selectedFiles };
  }

  async function unstageProjectGitFiles(rootPath, files = []) {
    requireDependency('runCommand', runCommand);

    const safeRoot = String(rootPath || '').trim();
    const normalizedFiles = normalizeGitSelectedPaths(files);
    if (!normalizedFiles.ok) return normalizedFiles;
    const selectedFiles = normalizedFiles.files;
    if (!safeRoot) return { ok: false, message: 'rootPath é obrigatório.' };
    if (!selectedFiles.length) return { ok: false, message: 'Selecione ao menos um arquivo para remover do stage.' };

    const result = await runCommand('git', ['-C', safeRoot, 'restore', '--staged', '--', ...selectedFiles], { timeoutMs: 6000 });
    if (!result.ok) {
      return {
        ok: false,
        message: String(result.stderr || result.stdout || 'Não consegui remover os arquivos do stage.').trim(),
      };
    }
    const worktree = await getProjectGitWorktree(safeRoot);
    return { ...worktree, ok: true, unstagedFiles: selectedFiles };
  }

  async function rollbackProjectGitFiles(rootPath, files = []) {
    requireDependency('runCommand', runCommand);
    const fs = require('fs');
    const path = require('path');

    const safeRoot = String(rootPath || '').trim();
    const normalizedFiles = normalizeGitSelectedPaths(files);
    if (!normalizedFiles.ok) return normalizedFiles;
    const selectedFiles = normalizedFiles.files;
    if (!safeRoot) return { ok: false, message: 'rootPath é obrigatório.' };
    if (!selectedFiles.length) return { ok: false, message: 'Selecione ao menos um arquivo para restaurar.' };

    const worktree = await getProjectGitWorktree(safeRoot);
    const untrackedSet = new Set(
      (worktree.entries || [])
        .filter((e) => e.status === 'untracked')
        .map((e) => String(e.path || '').trim())
    );

    const filesToGitRestore = [];
    const filesToUnlink = [];

    for (const file of selectedFiles) {
      if (untrackedSet.has(file)) {
        filesToUnlink.push(file);
      } else {
        filesToGitRestore.push(file);
      }
    }

    if (filesToGitRestore.length) {
      await runCommand('git', ['-C', safeRoot, 'restore', '--staged', '--', ...filesToGitRestore], { timeoutMs: 6000 });
      const restoreResult = await runCommand('git', ['-C', safeRoot, 'restore', '--', ...filesToGitRestore], { timeoutMs: 6000 });
      if (!restoreResult.ok) {
        await runCommand('git', ['-C', safeRoot, 'checkout', '--', ...filesToGitRestore], { timeoutMs: 6000 });
      }
    }

    for (const file of filesToUnlink) {
      try {
        const fullPath = path.resolve(safeRoot, file);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (err) {
        console.error('Failed to unlink untracked file:', file, err);
      }
    }

    const nextWorktree = await getProjectGitWorktree(safeRoot);
    return { ...nextWorktree, ok: true, rolledBackFiles: selectedFiles };
  }

  async function listStagedProjectGitFiles(rootPath) {
    requireDependency('runCommand', runCommand);

    const result = await runCommand('git', gitPathArgs(rootPath, ['diff', '--cached', '--name-only', '--']), { timeoutMs: 3000 });
    if (!result.ok) {
      return {
        ok: false,
        message: String(result.stderr || result.stdout || 'Não consegui ler os arquivos em Staged.').trim(),
        files: [],
      };
    }
    return {
      ok: true,
      files: String(result.stdout || '')
        .split('\n')
        .map((line) => normalizeRelativePathForDiff(line.trim()))
        .filter(Boolean),
    };
  }

  async function commitProjectGitFiles(rootPath, message, files = []) {
    requireDependency('runCommand', runCommand);

    const safeRoot = String(rootPath || '').trim();
    const commitMessage = String(message || '').trim();
    const normalizedFiles = normalizeGitSelectedPaths(files);
    if (!normalizedFiles.ok) return normalizedFiles;
    const selectedFiles = normalizedFiles.files;
    if (!safeRoot) return { ok: false, message: 'rootPath é obrigatório.' };
    if (!commitMessage) return { ok: false, message: 'Escreva uma mensagem para o commit.' };

    let committedFiles = [];
    let skippedFiles = [];
    if (selectedFiles.length) {
      const staged = await listStagedProjectGitFiles(safeRoot);
      if (!staged.ok) return staged;

      const selectedSet = new Set(selectedFiles);
      committedFiles = staged.files.filter((file) => selectedSet.has(file));
      skippedFiles = staged.files.filter((file) => !selectedSet.has(file));
      if (!committedFiles.length) {
        return { ok: false, message: 'Escolha ao menos um arquivo em Staged para criar o commit.' };
      }

      if (skippedFiles.length) {
        const reset = await runCommand('git', ['-C', safeRoot, 'reset', '--', ...skippedFiles], { timeoutMs: 6000 });
        if (!reset.ok) {
          return {
            ok: false,
            message: String(reset.stderr || reset.stdout || 'Não consegui manter os arquivos não selecionados fora do commit.').trim(),
          };
        }
      }
    }

    const result = await runCommand('git', ['-C', safeRoot, 'commit', '-m', commitMessage], { timeoutMs: 10000 });
    if (!result.ok) {
      return {
        ok: false,
        message: String(result.stderr || result.stdout || 'Não consegui criar o commit.').trim(),
      };
    }
    const worktree = await getProjectGitWorktree(safeRoot);
    return {
      ...worktree,
      ok: true,
      committed: true,
      committedFiles,
      skippedFiles,
      output: String(result.stdout || '').trim(),
    };
  }

  return {
    commitProjectGitFiles,
    collectGitDiffFirstLines,
    collectGitDiffHunks,
    collectGitDiffStats,
    getProjectGitWorktree,
    getProjectGitStatus,
    initProjectGitRepository,
    normalizeGitRemoteUrl,
    parseNumstatLine,
    parseDiffHunkFirstLine,
    parsePorcelainStatusLine,
    stageProjectGitFiles,
    unstageProjectGitFiles,
    rollbackProjectGitFiles,
  };
}

module.exports = {
  createProjectGitService,
};
