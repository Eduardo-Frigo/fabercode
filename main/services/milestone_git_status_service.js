function createMilestoneGitStatusService(dependencies = {}) {
  const gitService = dependencies.gitService;
  const milestoneService = dependencies.milestoneService;

  async function getMilestoneGitStatus(rootPath, milestoneId) {
    if (!gitService) {
      return { ok: false, message: 'gitService dependency missing' };
    }
    if (!milestoneService) {
      return { ok: false, message: 'milestoneService dependency missing' };
    }

    try {
      const worktree = await gitService.getProjectGitWorktree(rootPath);
      const milestones = milestoneService.listMilestones(rootPath);
      const m = milestones.find((x) => x.id === milestoneId);
      if (!m) {
        return { ok: false, message: 'Milestone not found' };
      }

      const modifiedFiles = worktree && Array.isArray(worktree.entries) 
        ? worktree.entries.map((entry) => entry.path) 
        : [];

      // A milestone-related file is either defined in milestone.relatedFiles or tasks
      const relatedSet = new Set(m.relatedFiles || []);
      if (m.tasks) {
        m.tasks.forEach((t) => {
          if (t.relatedFiles) {
            t.relatedFiles.forEach((f) => relatedSet.add(f));
          }
        });
      }

      const relatedFiles = Array.from(relatedSet);
      const matchedModified = modifiedFiles.filter((f) => relatedFiles.includes(f));
      const otherModified = modifiedFiles.filter((f) => !relatedFiles.includes(f));

      return {
        ok: true,
        isGitRepo: worktree.isGitRepo !== false,
        branch: worktree.branch || '',
        modifiedFiles,
        relatedFiles,
        matchedModified,
        otherModified,
        latestCommit: worktree.latest || null,
      };
    } catch (e) {
      console.error('Failed to get milestone git status', e);
      return { ok: false, message: e.message || String(e) };
    }
  }

  return {
    getMilestoneGitStatus,
  };
}

module.exports = {
  createMilestoneGitStatusService,
};
