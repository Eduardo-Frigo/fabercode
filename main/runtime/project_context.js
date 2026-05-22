function createProjectContextService(dependencies = {}) {
  const {
    CORTEX_STOPWORDS = new Set(),
    MAX_CORTEX_CONTEXT_ITEMS = 10,
    clipText,
    clipTextPreserveLines,
    fs,
    getCortexLearning,
    path,
  } = dependencies;

  function extractIntentTerms(text) {
    const tokens = String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !CORTEX_STOPWORDS.has(token));
    return [...new Set(tokens)];
  }

  function scoreKnowledgeLine(line, intentTerms, recencyBoost = 0) {
    const normalized = String(line || '').toLowerCase();
    if (!normalized) return 0;
    let score = recencyBoost;
    for (const term of intentTerms) {
      if (normalized.includes(term)) score += 2;
    }
    return score;
  }

  function buildCortexPromptContext(projectId, userMessage, runtimeSettings = {}) {
    if (!projectId) {
      return {
        available: false,
        reason: 'missing_project_id',
        contextText: '',
      };
    }

    const learningResult = getCortexLearning(projectId);
    if (!learningResult.ok || !learningResult.learning) {
      return {
        available: false,
        reason: 'learning_unavailable',
        contextText: '',
      };
    }

    const learning = learningResult.learning;
    const items = [];
    const personaEntries = Array.isArray(learning.persona)
      ? learning.persona
      : Array.isArray(learning.ia2)
        ? learning.ia2
        : [];
    const executorEntries = Array.isArray(learning.executor)
      ? learning.executor
      : Array.isArray(learning.ia1)
        ? learning.ia1
        : [];
    const eventEntries = Array.isArray(learning.events) ? learning.events : [];
    const intentTerms = extractIntentTerms(userMessage);

    personaEntries.forEach((text, index) => {
      items.push({
        source: 'persona',
        text: String(text || ''),
        recency: index + 1,
      });
    });
    executorEntries.forEach((text, index) => {
      items.push({
        source: 'executor',
        text: String(text || ''),
        recency: index + 1,
      });
    });
    eventEntries.forEach((event, index) => {
      const base = event && (event.summary || event.text || event.type) ? event.summary || event.text || event.type : '';
      items.push({
        source: 'event',
        text: String(base || ''),
        recency: index + 1,
      });
    });

    const scored = items
      .map((item) => {
        const recencyBoost = Math.max(0, item.recency) * 0.02;
        return {
          ...item,
          score: scoreKnowledgeLine(item.text, intentTerms, recencyBoost),
        };
      })
      .filter((item) => item.text.length > 0)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return {
        available: false,
        reason: 'learning_empty',
        contextText: '',
      };
    }

    const limit = Math.min(MAX_CORTEX_CONTEXT_ITEMS, runtimeSettings.profile === 'rapido' ? 6 : 10);
    const selected = scored.slice(0, limit);
    const contextText = selected.map((item) => `[${item.source}] ${clipText(item.text, 260)}`).join('\n');

    return {
      available: true,
      reason: null,
      selectedCount: selected.length,
      contextText,
    };
  }

  function isProjectContextCandidateFile(relPath = '') {
    const lower = String(relPath || '').toLowerCase();
    return /(^|\/)index\.(html|php)$/.test(lower) ||
      /(^|\/)(style|styles)\.(css|scss)$/.test(lower) ||
      /(^|\/)(script|main|app)\.(js|ts|jsx|tsx)$/.test(lower) ||
      /(^|\/)(readme\.md|package\.json|composer\.json|vite\.config\.(js|ts)|next\.config\.(js|ts)|tailwind\.config\.(js|ts))$/.test(lower) ||
      /\.(html|css|scss|js|ts|jsx|tsx|php|json|md)$/i.test(lower);
  }

  function tokenizeProjectIntentKeywords(message = '') {
    const base = String(message || '').toLowerCase();
    const words = base
      .replace(/[^a-z0-9à-ÿ\s_-]/gi, ' ')
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => entry.length >= 4)
      .slice(0, 40);
    const seeded = [
      'index',
      'style',
      'css',
      'script',
      'javascript',
      'html',
      'landing',
      'faq',
      'plano',
      'planos',
      'whatsapp',
      'contato',
      'sobre',
      'servicos',
      'depoimentos',
      'responsivo',
      'mobile',
      'layout',
      'header',
      'footer',
      'cta',
      'formulario',
      'agendamento',
    ];
    return Array.from(new Set([...seeded, ...words]));
  }

  function scoreProjectContextFile(relPath = '', keywords = []) {
    const lower = String(relPath || '').toLowerCase();
    let score = 0;
    if (/^index\.(html|php)$/.test(lower)) score += 40;
    if (/(^|\/)(style|styles)\.(css|scss)$/.test(lower)) score += 34;
    if (/(^|\/)(script|main|app)\.(js|ts|jsx|tsx)$/.test(lower)) score += 30;
    if (/readme\.md$/.test(lower)) score += 26;
    if (/\/pages\//.test(lower)) score += 20;
    if (/\.(html|php)$/.test(lower)) score += 14;
    if (/\.(css|scss)$/.test(lower)) score += 12;
    if (/\.(js|ts|jsx|tsx)$/.test(lower)) score += 10;

    for (const key of keywords || []) {
      if (!key) continue;
      if (lower.includes(String(key).toLowerCase())) score += 5;
    }

    if (lower.includes('node_modules/') || lower.includes('/dist/') || lower.includes('/build/')) score -= 100;
    return score;
  }

  function buildProjectEvolutionContext(projectInfo, userMessage, { maxFiles = 8, maxCharsPerFile = 900, totalMaxChars = 5200 } = {}) {
    if (!projectInfo || !projectInfo.rootPath || !Array.isArray(projectInfo.files) || !projectInfo.files.length) return '';

    const keywords = tokenizeProjectIntentKeywords(userMessage);
    const candidates = projectInfo.files
      .map((entry) => String(entry || '').replace(/\\/g, '/'))
      .filter(Boolean)
      .filter((entry) => isProjectContextCandidateFile(entry))
      .map((entry) => ({
        relPath: entry,
        score: scoreProjectContextFile(entry, keywords),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(maxFiles * 3, maxFiles));

    const blocks = [];
    let usedChars = 0;

    for (const candidate of candidates) {
      if (blocks.length >= maxFiles || usedChars >= totalMaxChars) break;
      const absPath = path.join(projectInfo.rootPath, candidate.relPath);
      if (!fs.existsSync(absPath)) continue;

      let content = '';
      try {
        const stat = fs.statSync(absPath);
        if (!stat.isFile() || stat.size > 220000) continue;
        content = fs.readFileSync(absPath, 'utf8');
      } catch {
        continue;
      }

      const excerpt = clipTextPreserveLines(content, maxCharsPerFile);
      if (!excerpt) continue;

      const block = `[${candidate.relPath}]\n${excerpt}`;
      const blockLen = block.length + 2;
      if (usedChars + blockLen > totalMaxChars && blocks.length > 0) break;

      blocks.push(block);
      usedChars += blockLen;
    }

    return blocks.join('\n\n');
  }

  return {
    buildCortexPromptContext,
    buildProjectEvolutionContext,
    extractIntentTerms,
    isProjectContextCandidateFile,
    scoreKnowledgeLine,
    scoreProjectContextFile,
    tokenizeProjectIntentKeywords,
  };
}

module.exports = {
  createProjectContextService,
};
