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

  function extractProjectGraphCalls(content = '') {
    const calls = [];
    const source = String(content || '');
    const pattern = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g;
    const ignored = new Set([
      'if',
      'for',
      'while',
      'switch',
      'catch',
      'function',
      'return',
      'typeof',
      'new',
      'class',
    ]);
    let match = null;
    while ((match = pattern.exec(source))) {
      const name = match[1];
      if (!name || ignored.has(name)) continue;
      calls.push(name);
    }
    return Array.from(new Set(calls)).slice(0, 60);
  }

  function readProjectJson(projectInfo = {}, relPath = '') {
    const content = readProjectGraphFile(projectInfo, relPath);
    if (!content) return null;
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  function packageHasScript(packageJson = null, scriptName = '') {
    return Boolean(packageJson && packageJson.scripts && packageJson.scripts[scriptName]);
  }

  function packageHasDependency(packageJson = null, dependencyName = '') {
    if (!packageJson || !dependencyName) return false;
    return Boolean(
      (packageJson.dependencies && packageJson.dependencies[dependencyName]) ||
        (packageJson.devDependencies && packageJson.devDependencies[dependencyName])
    );
  }

  function hasKnownFileMatching(knownFiles = new Set(), predicate = () => false) {
    for (const relPath of knownFiles) {
      if (predicate(relPath)) return true;
    }
    return false;
  }

  function buildPersistenceGraphSignals(projectInfo = {}, knownFiles = new Set(), intentText = '') {
    const packageJson = readProjectJson(projectInfo, 'package.json');
    const prismaSchema = readProjectGraphFile(projectInfo, 'prisma/schema.prisma');
    const normalizedIntent = String(intentText || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const hasPrismaSchema = knownFiles.has('prisma/schema.prisma');
    const hasPrismaDependency =
      packageHasDependency(packageJson, '@prisma/client') ||
      packageHasDependency(packageJson, 'prisma');
    const usesPostgres = /provider\s*=\s*"postgresql"/i.test(prismaSchema);
    const explicitPostgres = /\bpostgres(?:ql)?\b/.test(normalizedIntent);
    const explicitPersistence = /\b(banco|database|persist|migration|migracao|seed|prisma)\b/.test(normalizedIntent);
    const requestedPersistenceSurface = hasPrismaSchema || hasPrismaDependency || usesPostgres || explicitPersistence;
    if (!requestedPersistenceSurface) {
      return {
        required: false,
        signals: [],
        missing: [],
      };
    }
    const required = usesPostgres || explicitPostgres || (explicitPersistence && hasPrismaDependency);
    const signals = [
      hasPrismaSchema ? 'prisma_schema' : '',
      hasPrismaDependency ? 'prisma_dependency' : '',
      usesPostgres ? 'postgres_provider' : '',
      explicitPersistence ? 'persistence_requested' : '',
      explicitPostgres ? 'postgres_requested' : '',
    ].filter(Boolean);
    if (!required) {
      return {
        required: false,
        signals,
        missing: [],
      };
    }

    const checks = [
      {
        id: 'docker_compose',
        ok: knownFiles.has('docker-compose.yml') || knownFiles.has('compose.yml'),
        detail: 'docker-compose.yml/compose.yml com Postgres local',
      },
      {
        id: 'migration',
        ok: hasKnownFileMatching(knownFiles, (relPath) => /^prisma\/migrations\/[^/]+\/migration\.sql$/i.test(relPath)),
        detail: 'prisma/migrations/**/migration.sql',
      },
      {
        id: 'seed',
        ok:
          knownFiles.has('scripts/seed.mjs') ||
          knownFiles.has('scripts/seed.js') ||
          knownFiles.has('prisma/seed.ts') ||
          knownFiles.has('prisma/seed.js') ||
          Boolean(packageJson && packageJson.prisma && packageJson.prisma.seed),
        detail: 'seed executavel',
      },
      {
        id: 'prisma_client',
        ok: knownFiles.has('src/server/prisma.ts') || knownFiles.has('src/lib/prisma.ts') || knownFiles.has('lib/prisma.ts'),
        detail: 'PrismaClient compartilhado em modulo de servidor',
      },
      {
        id: 'repository',
        ok: hasKnownFileMatching(knownFiles, (relPath) =>
          /(^|\/)(repositories?|.*repository|.*_repository)\.(ts|js)$|^src\/server\/.*repository\.(ts|js)$/i.test(relPath)
        ),
        detail: 'repository/service usando persistencia real',
      },
      {
        id: 'api_route',
        ok: hasKnownFileMatching(knownFiles, (relPath) => /^app\/api\/.+\/route\.(ts|js)$/i.test(relPath)),
        detail: 'API route/server boundary para UI',
      },
      {
        id: 'db_check',
        ok: packageHasScript(packageJson, 'db:check'),
        detail: 'script db:check',
      },
    ];

    return {
      required,
      signals,
      missing: checks.filter((check) => !check.ok).map((check) => check.id),
      checks,
    };
  }

  function buildProjectGraphReport(projectInfo, userMessage, {
    maxFiles = 16,
    maxIssues = 12,
  } = {}) {
    if (!projectInfo || !projectInfo.rootPath || !Array.isArray(projectInfo.files)) {
      return {
        version: 1,
        files: [],
        issues: [],
        persistence: { required: false, signals: [], missing: [] },
        summary: { files: 0, issues: 0, unresolvedImports: 0, missingStoreMembers: 0 },
      };
    }

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
      const resolvedImports = imports
        .map((specifier) => resolveProjectGraphImport(file.relPath, specifier, knownFiles))
        .filter(Boolean);
      const unresolvedRelativeImports = imports
        .filter((specifier) => String(specifier || '').startsWith('.'))
        .filter((specifier) => !resolveProjectGraphImport(file.relPath, specifier, knownFiles));
      graphByPath.set(file.relPath, {
        relPath: file.relPath,
        imports,
        resolvedImports,
        unresolvedRelativeImports,
        exports: extractProjectGraphExports(content),
        calls: extractProjectGraphCalls(content),
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
              severity: 'error',
              file: node.relPath,
              relatedFile: storeTarget,
              detail: `${node.relPath} usa ${variableName}.${member}, mas ${storeTarget} nao declara ${member}.`,
            });
          }
        }
      }
    }

    for (const node of graphByPath.values()) {
      for (const specifier of node.unresolvedRelativeImports || []) {
        issues.push({
          id: 'unresolved_relative_import',
          severity: 'error',
          file: node.relPath,
          relatedFile: specifier,
          detail: `${node.relPath} importa ${specifier}, mas nenhum arquivo relacionado foi encontrado no projeto.`,
        });
      }
    }

    const persistence = buildPersistenceGraphSignals(projectInfo, knownFiles, userMessage);
    for (const missing of persistence.missing || []) {
      issues.push({
        id: 'incomplete_persistence_contract',
        severity: 'warning',
        file: 'project',
        relatedFile: missing,
        detail: `Persistencia detectada, mas falta ${missing}.`,
      });
    }

    const files = Array.from(graphByPath.values()).map((node) => ({
      relPath: node.relPath,
      imports: node.imports.slice(0, 20),
      resolvedImports: node.resolvedImports.slice(0, 20),
      unresolvedRelativeImports: (node.unresolvedRelativeImports || []).slice(0, 20),
      exports: node.exports.slice(0, 20),
      calls: node.calls.slice(0, 24),
      storeVariables: node.storeVariables.slice(0, 12),
    }));
    const limitedIssues = issues.slice(0, maxIssues);

    return {
      version: 1,
      files,
      issues: limitedIssues,
      persistence,
      summary: {
        files: files.length,
        issues: limitedIssues.length,
        unresolvedImports: limitedIssues.filter((issue) => issue.id === 'unresolved_relative_import').length,
        missingStoreMembers: limitedIssues.filter((issue) => issue.id === 'missing_store_contract_member').length,
        incompletePersistence: limitedIssues.filter((issue) => issue.id === 'incomplete_persistence_contract').length,
      },
    };
  }

  function formatProjectGraphReport(report = {}, { totalMaxChars = 5200 } = {}) {
    const lines = ['Grafo de projeto para edicao/reparo:'];
    for (const node of report.files || []) {
      lines.push(`- ${node.relPath}`);
      if (node.imports.length) lines.push(`  imports: ${node.imports.slice(0, 10).join(', ')}`);
      if (node.resolvedImports.length) lines.push(`  arquivos relacionados: ${node.resolvedImports.slice(0, 10).join(', ')}`);
      if (node.exports.length) lines.push(`  exports: ${node.exports.slice(0, 12).join(', ')}`);
      if (node.calls.length) lines.push(`  chamadas: ${node.calls.slice(0, 12).join(', ')}`);
    }
    if (report.persistence && report.persistence.required) {
      lines.push(`Persistencia detectada: ${report.persistence.signals.join(', ') || 'sinais fracos'}`);
      if (report.persistence.missing && report.persistence.missing.length) {
        lines.push(`Persistencia incompleta: falta ${report.persistence.missing.join(', ')}`);
      }
    }
    if (report.issues && report.issues.length) {
      lines.push('Contratos suspeitos detectados:');
      report.issues.forEach((issue) => {
        lines.push(`- [${issue.id}] ${issue.detail}`);
      });
    }

    return clipTextPreserveLines(lines.join('\n'), totalMaxChars);
  }

  function buildProjectGraphContext(projectInfo, userMessage, {
    maxFiles = 16,
    maxIssues = 12,
    totalMaxChars = 5200,
  } = {}) {
    const report = buildProjectGraphReport(projectInfo, userMessage, { maxFiles, maxIssues });
    if (!report.files.length && !report.issues.length) return '';
    return formatProjectGraphReport(report, { totalMaxChars });
  }

  return {
    buildProjectGraphReport,
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
