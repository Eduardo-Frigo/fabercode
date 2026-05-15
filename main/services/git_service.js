function createProjectGitService(dependencies = {}) {
  const {
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff = (value) => String(value || '').replace(/^\/+/, '').split('\\').join('/'),
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
      const result = await runCommand('git', ['-C', rootPath, ...args], { timeoutMs: 1800 });
      if (!result.ok || !result.stdout) return;

      const lines = result.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
      for (const line of lines) {
        const parsed = parseNumstatLine(line);
        if (!parsed) continue;
        const add = parsed.add === '-' ? 0 : Number(parsed.add) || 0;
        const del = parsed.del === '-' ? 0 : Number(parsed.del) || 0;
        const file = normalizeRelativePathForDiff(parsed.file);
        mergeDiffStatsEntry(stats, file, { add, del });
      }
    }

    try {
      await mergeNumstat(['diff', '--numstat', '--']);
      await mergeNumstat(['diff', '--cached', '--numstat', '--']);

      const untrackedRes = await runCommand(
        'git',
        ['-C', rootPath, 'ls-files', '--others', '--exclude-standard'],
        { timeoutMs: 1200 }
      );
      if (untrackedRes.ok && untrackedRes.stdout) {
        const files = untrackedRes.stdout
          .split('\n')
          .map((line) => normalizeRelativePathForDiff(line.trim()))
          .filter(Boolean);
        for (const file of files) {
          mergeDiffStatsEntry(stats, file, { add: 1, del: 0 });
        }
      }
    } catch {
      return stats;
    }

    return stats;
  }

  return {
    collectGitDiffStats,
    getProjectGitStatus,
    normalizeGitRemoteUrl,
    parseNumstatLine,
  };
}

module.exports = {
  createProjectGitService,
};
