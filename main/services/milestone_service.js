const defaultFs = require('fs');
const defaultPath = require('path');

const EMPTY_MILESTONES = [];

function createMilestoneService(dependencies = {}) {
  const fs = dependencies.fs || defaultFs;
  const path = dependencies.path || defaultPath;

  function ensureFaberDir(rootPath) {
    const faberDir = path.join(rootPath, '.faber');
    if (!fs.existsSync(faberDir)) {
      fs.mkdirSync(faberDir, { recursive: true });
    }
    return faberDir;
  }

  function getMilestonesPath(rootPath) {
    return path.join(ensureFaberDir(rootPath), 'milestones.json');
  }

  function readMilestonesFile(rootPath) {
    const filePath = getMilestonesPath(rootPath);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error('Failed to parse milestones JSON', e);
      return null;
    }
  }

  function listMilestones(rootPath) {
    const rawMilestones = readMilestonesFile(rootPath);
    if (!rawMilestones || Array.isArray(rawMilestones)) {
      return EMPTY_MILESTONES;
    }
    if (!rawMilestones.renderedAt || !Array.isArray(rawMilestones.milestones)) {
      return EMPTY_MILESTONES;
    }
    return rawMilestones.milestones;
  }

  function saveMilestones(rootPath, milestones) {
    const filePath = getMilestonesPath(rootPath);
    const currentMilestones = readMilestonesFile(rootPath);
    if (currentMilestones && !Array.isArray(currentMilestones) && currentMilestones.renderedAt && Array.isArray(currentMilestones.milestones)) {
      const payload = {
        ...currentMilestones,
        updatedAt: new Date().toISOString(),
        milestones,
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    } else {
      fs.writeFileSync(filePath, JSON.stringify(milestones, null, 2), 'utf8');
    }
    return { ok: true, milestones };
  }

  function persistRenderedMilestones(rootPath, milestones) {
    const filePath = getMilestonesPath(rootPath);
    const payload = {
      renderedAt: new Date().toISOString(),
      source: 'application-map-render',
      milestones,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, milestones };
  }

  function updateMilestoneStatus(rootPath, milestoneId, status) {
    const milestones = listMilestones(rootPath);
    const m = milestones.find((x) => x.id === milestoneId);
    if (!m) return { ok: false, message: 'Milestone not found' };
    
    m.status = status;
    m.updatedAt = new Date().toISOString();
    if (status === 'active' && !m.startedAt) {
      m.startedAt = new Date().toISOString();
    }
    if (status === 'done' && !m.completedAt) {
      m.completedAt = new Date().toISOString();
    }
    saveMilestones(rootPath, milestones);
    return { ok: true, milestone: m };
  }

  function updateMilestoneTask(rootPath, milestoneId, taskId, taskUpdate) {
    const milestones = listMilestones(rootPath);
    const m = milestones.find((x) => x.id === milestoneId);
    if (!m) return { ok: false, message: 'Milestone not found' };
    
    const t = m.tasks.find((x) => x.id === taskId);
    if (!t) return { ok: false, message: 'Task not found' };
    
    Object.assign(t, taskUpdate);
    m.updatedAt = new Date().toISOString();
    saveMilestones(rootPath, milestones);
    return { ok: true, task: t };
  }

  function linkMilestoneCommit(rootPath, milestoneId, commit) {
    const milestones = listMilestones(rootPath);
    const m = milestones.find((x) => x.id === milestoneId);
    if (!m) return { ok: false, message: 'Milestone not found' };
    
    if (!m.commits) m.commits = [];
    m.commits.push(commit);
    m.updatedAt = new Date().toISOString();
    saveMilestones(rootPath, milestones);
    return { ok: true, milestone: m };
  }

  function renderMilestones(rootPath) {
    try {
      const rawMilestones = readMilestonesFile(rootPath);
      const milestones = Array.isArray(rawMilestones)
        ? rawMilestones
        : rawMilestones && Array.isArray(rawMilestones.milestones)
          ? rawMilestones.milestones
          : EMPTY_MILESTONES;
      if (!milestones.length) {
        return { ok: false, message: 'No milestones generated yet.' };
      }
      const docsDir = path.join(rootPath, 'docs', 'milestones');
      if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
      }

      // Generate README.md
      let readme = '# Plano de Desenvolvimento - Milestones\n\nTimeline do projeto organizada em etapas estruturadas:\n\n';
      milestones.forEach((m) => {
        const fileBasename = `milestone-${String(m.number).padStart(2, '0')}-${m.title.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.md`;
        let statusEmoji = '⚪';
        if (m.status === 'active') statusEmoji = '🔵';
        if (m.status === 'done') statusEmoji = '🟢';
        if (m.status === 'blocked') statusEmoji = '🔴';
        readme += `### ${statusEmoji} Milestone ${m.number}: [${m.title}](./${fileBasename})\n`;
        readme += `Status: \`${m.status}\`\n\n${m.summary}\n\n`;
      });
      fs.writeFileSync(path.join(docsDir, 'README.md'), readme, 'utf8');

      // Generate separate files
      milestones.forEach((m) => {
        const fileBasename = `milestone-${String(m.number).padStart(2, '0')}-${m.title.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.md`;
        let content = `# Milestone ${m.number} - ${m.title}\n\n`;
        content += `Status: **${m.status}**\n\n`;
        content += `## Objetivo\n\n${m.summary || ''}\n\n`;

        if (Array.isArray(m.references) && m.references.length) {
          content += `## Markdowns de Referência do Mapa\n\n`;
          m.references.forEach((reference) => {
            const referencePath = reference && reference.path ? reference.path : String(reference || '');
            if (referencePath) {
              content += `- \`${referencePath}\`\n`;
            }
          });
          content += `\n`;
        }
        
        content += `## Tarefas\n\n`;
        if (m.tasks && m.tasks.length) {
          m.tasks.forEach((t) => {
            const checked = t.status === 'done' ? '[x]' : '[ ]';
            content += `- ${checked} **${t.title}**\n`;
            if (t.description) content += `  _${t.description}_\n`;
          });
        } else {
          content += `- Não há tarefas cadastradas.\n`;
        }
        content += `\n`;

        content += `## Critérios de Aceite\n\n${m.acceptanceCriteria || ''}\n\n`;
        
        if (m.validationCommands) {
          content += `## Validação\n\n\`\`\`bash\n${m.validationCommands}\n\`\`\`\n\n`;
        }

        content += `## Commits Relacionados\n\n`;
        if (m.commits && m.commits.length) {
          m.commits.forEach((c) => {
            content += `- \`${c.hash.substring(0, 7)}\` - ${c.message} (${c.createdAt})\n`;
          });
        } else {
          content += `Nenhum commit associado a esta milestone ainda.\n`;
        }

        fs.writeFileSync(path.join(docsDir, fileBasename), content, 'utf8');
      });

      // Save raw JSON copy
      fs.writeFileSync(path.join(docsDir, 'milestones.json'), JSON.stringify(milestones, null, 2), 'utf8');
      persistRenderedMilestones(rootPath, milestones);

      return { ok: true, docsPath: docsDir };
    } catch (e) {
      console.error('Failed to render milestones', e);
      return { ok: false, message: e.message || String(e) };
    }
  }

  return {
    listMilestones,
    saveMilestones,
    updateMilestoneStatus,
    updateMilestoneTask,
    linkMilestoneCommit,
    renderMilestones,
  };
}

module.exports = {
  createMilestoneService,
};
