const {
  rankMemoryCandidates,
} = require('../../cortex/memory/memory_provenance_service');

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
    const nowMs = Date.now();

    function isEventSuppressed(event = {}) {
      if (!event || typeof event !== 'object') return true;
      if (event.deletedAt || event.status === 'deleted' || event.status === 'expired') return true;
      const expiresAt = event.expiresAt || (event.validity && event.validity.expiresAt) || null;
      const expiresMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
      return Number.isFinite(expiresMs) && expiresMs <= nowMs;
    }

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
    eventEntries.filter((event) => !isEventSuppressed(event)).forEach((event, index) => {
      const base = event && (event.summary || event.text || event.type) ? event.summary || event.text || event.type : '';
      items.push({
        source: 'event',
        text: String(base || ''),
        recency: index + 1,
        sourceId: event.memoryId || event.id || `event:${index + 1}`,
        sourceType: event.promoted || event.status === 'promoted' ? 'project_memory_promoted' : 'project_memory_event',
        promoted: Boolean(event.promoted || event.status === 'promoted'),
      });
    });

    const fallbackScored = items
      .map((item) => {
        const recencyBoost = Math.max(0, item.recency) * 0.02;
        return {
          ...item,
          score: scoreKnowledgeLine(item.text, intentTerms, recencyBoost),
        };
      })
      .filter((item) => item.text.length > 0)
      .sort((a, b) => b.score - a.score);

    if (!fallbackScored.length) {
      return {
        available: false,
        reason: 'learning_empty',
        contextText: '',
      };
    }

    const limit = Math.min(MAX_CORTEX_CONTEXT_ITEMS, runtimeSettings.profile === 'rapido' ? 6 : 10);
    const ranked = rankMemoryCandidates(fallbackScored, intentTerms.join(' '), {
      limit,
      minConfidence: intentTerms.length ? 0.03 : 0,
    });
    const selectedByVector = Array.isArray(ranked.used) && ranked.used.length ? ranked.used : null;
    const scored = selectedByVector || fallbackScored;
    const selected = scored.slice(0, limit);
    const contextText = selected.map((item) => `[${item.source}] ${clipText(item.text, 260)}`).join('\n');

    return {
      available: true,
      reason: null,
      selectedCount: selected.length,
      ranking: {
        strategy: selectedByVector ? 'semantic_vector' : 'intent_terms_fallback',
        vectorModel: selectedByVector && selectedByVector[0] ? selectedByVector[0].vectorModel : null,
        semanticAverage: selectedByVector && selectedByVector.length
          ? Number((selectedByVector.reduce((sum, item) => sum + Number(item.semanticSimilarity || 0), 0) / selectedByVector.length).toFixed(4))
          : 0,
      },
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

  function isProjectGraphCandidateFile(relPath = '') {
    const lower = String(relPath || '').replace(/\\/g, '/').toLowerCase();
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(lower)) return false;
    if (lower.includes('node_modules/') || lower.includes('/dist/') || lower.includes('/build/')) return false;
    return /^(app|pages|src|lib|tests|__tests__)\//.test(lower);
  }

  function readProjectGraphFile(projectInfo = {}, relPath = '') {
    const rootPath = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!rootPath || !relPath) return '';
    try {
      const absPath = path.join(rootPath, relPath);
      if (!fs.existsSync(absPath)) return '';
      const stat = fs.statSync(absPath);
      if (!stat.isFile() || stat.size > 300000) return '';
      return fs.readFileSync(absPath, 'utf8');
    } catch {
      return '';
    }
  }

  function extractProjectGraphImports(content = '') {
    const imports = [];
    const patterns = [
      /\bimport\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
      let match = null;
      while ((match = pattern.exec(String(content || '')))) {
        imports.push(match[1]);
      }
    }
    return Array.from(new Set(imports)).slice(0, 40);
  }

  function extractProjectGraphExports(content = '') {
    const exports = [];
    const source = String(content || '');
    const patterns = [
      /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
      /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
      /\bexport\s+(?:type|interface|class|enum)\s+([A-Za-z_$][\w$]*)/g,
      /\bmodule\.exports\s*=\s*\{([\s\S]*?)\}/g,
    ];
    for (const pattern of patterns.slice(0, 3)) {
      let match = null;
      while ((match = pattern.exec(source))) exports.push(match[1]);
    }
    let cjsMatch = null;
    while ((cjsMatch = patterns[3].exec(source))) {
      String(cjsMatch[1] || '')
        .split(',')
        .map((entry) => entry.trim().split(':')[0].trim())
        .filter(Boolean)
        .forEach((entry) => exports.push(entry));
    }
    return Array.from(new Set(exports)).slice(0, 50);
  }

  function resolveProjectGraphImport(fromRelPath = '', specifier = '', knownFiles = new Set()) {
    const raw = String(specifier || '').trim();
    if (!raw || !raw.startsWith('.')) return null;
    const fromDir = path.posix.dirname(String(fromRelPath || '').replace(/\\/g, '/'));
    const base = path.posix.normalize(path.posix.join(fromDir, raw));
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.jsx`,
      path.posix.join(base, 'index.ts'),
      path.posix.join(base, 'index.tsx'),
      path.posix.join(base, 'index.js'),
      path.posix.join(base, 'index.jsx'),
    ];
    return candidates.find((candidate) => knownFiles.has(candidate)) || null;
  }

  function extractStoreVariableNames(content = '') {
    const names = [];
    const pattern = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*use[A-Za-z0-9_$]*Store\s*\(/g;
    let match = null;
    while ((match = pattern.exec(String(content || '')))) names.push(match[1]);
    return Array.from(new Set(names));
  }

  function extractMemberReads(content = '', objectName = '') {
    if (!objectName) return [];
    const escaped = objectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\.([A-Za-z_$][\\w$]*)`, 'g');
    const reads = [];
    let match = null;
    while ((match = pattern.exec(String(content || '')))) reads.push(match[1]);
    return Array.from(new Set(reads)).slice(0, 80);
  }

  function fileDeclaresProperty(content = '', property = '') {
    if (!property) return false;
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b\\s*[:=?(]`).test(String(content || ''));
  }

  function buildProjectGraphContext(projectInfo, userMessage, {
    maxFiles = 16,
    maxIssues = 12,
    totalMaxChars = 5200,
  } = {}) {
    if (!projectInfo || !projectInfo.rootPath || !Array.isArray(projectInfo.files)) return '';

    const knownFiles = new Set(
      projectInfo.files
        .map((entry) => String(entry || '').replace(/\\/g, '/'))
        .filter(Boolean)
    );
    const keywords = tokenizeProjectIntentKeywords(userMessage);
    const relFiles = Array.from(knownFiles)
      .filter((entry) => isProjectGraphCandidateFile(entry))
      .map((entry) => ({
        relPath: entry,
        score:
          scoreProjectContextFile(entry, keywords) +
          (/(^|\/)(app\/page|src\/store|src\/services|src\/domain|tests?)\//.test(entry) ? 20 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxFiles);

    const graphByPath = new Map();
    for (const file of relFiles) {
      const content = readProjectGraphFile(projectInfo, file.relPath);
      if (!content) continue;
      const imports = extractProjectGraphImports(content);
      graphByPath.set(file.relPath, {
        relPath: file.relPath,
        imports,
        resolvedImports: imports
          .map((specifier) => resolveProjectGraphImport(file.relPath, specifier, knownFiles))
          .filter(Boolean),
        exports: extractProjectGraphExports(content),
        storeVariables: extractStoreVariableNames(content),
        content,
      });
    }

    const issues = [];
    for (const node of graphByPath.values()) {
      if (!node.storeVariables.length) continue;
      const storeTargets = node.resolvedImports.filter((relPath) => /store/i.test(relPath));
      for (const storeTarget of storeTargets) {
        const storeNode =
          graphByPath.get(storeTarget) ||
          {
            relPath: storeTarget,
            content: readProjectGraphFile(projectInfo, storeTarget),
            exports: [],
          };
        if (!storeNode.content) continue;
        for (const variableName of node.storeVariables) {
          for (const member of extractMemberReads(node.content, variableName)) {
            if (fileDeclaresProperty(storeNode.content, member)) continue;
            issues.push({
              id: 'missing_store_contract_member',
              file: node.relPath,
              relatedFile: storeTarget,
              detail: `${node.relPath} usa ${variableName}.${member}, mas ${storeTarget} nao declara ${member}.`,
            });
          }
        }
      }
    }

    const lines = ['Grafo de projeto para edicao/reparo:'];
    for (const node of graphByPath.values()) {
      lines.push(`- ${node.relPath}`);
      if (node.imports.length) lines.push(`  imports: ${node.imports.slice(0, 10).join(', ')}`);
      if (node.resolvedImports.length) lines.push(`  arquivos relacionados: ${node.resolvedImports.slice(0, 10).join(', ')}`);
      if (node.exports.length) lines.push(`  exports: ${node.exports.slice(0, 12).join(', ')}`);
    }
    if (issues.length) {
      lines.push('Contratos suspeitos detectados:');
      issues.slice(0, maxIssues).forEach((issue) => {
        lines.push(`- [${issue.id}] ${issue.detail}`);
      });
    }

    return clipTextPreserveLines(lines.join('\n'), totalMaxChars);
  }

  return {
    buildProjectGraphContext,
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
