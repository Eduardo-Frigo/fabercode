const defaultFs = require('fs');
const defaultPath = require('path');

const {
  isPatchStyleRequest,
  looksLikeScaffoldRewriteBatch,
} = require('./render_pass_service');
const {
  findCssImportOrderViolation,
  isCssOperationPath,
} = require('./css_operation_safety');
const { buildVisualValidationReport } = require('./visual_validation_service');

function buildSemanticRequirementsFromPrompt(userMessage = '') {
  const text = String(userMessage || '').toLowerCase();
  const specs = [
    { id: 'faq', regex: /\bfaq\b|perguntas frequentes|d[uú]vidas frequentes/i },
    { id: 'plans', regex: /\bplanos?\b|pre[cç]os?|assinaturas?/i },
    { id: 'whatsapp', regex: /whatsapp|whats app|wa\.me/i },
    { id: 'contact', regex: /contato|fale conosco|agendar|agendamento|formul[aá]rio/i },
    { id: 'services', regex: /servi[cç]os?|atendimentos?/i },
    { id: 'testimonials', regex: /depoimentos?|avalia[cç][õo]es?|testemunhos?/i },
    { id: 'about', regex: /\bsobre\b|quem somos|nossa hist[oó]ria/i },
  ];

  return specs
    .filter((entry) => entry.regex.test(text))
    .map((entry) => entry.id);
}

function looksLikeInstructionOnlyContent(content = '') {
  const text = String(content || '').trim();
  if (!text) return false;
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const startsAsInstruction =
    /^(atualizar|substituir|aplicar|definir|restaurar|trocar|ajustar|corrigir|garantir|manter|preservar|criar|incluir|adicionar|se necessario|nenhuma alteracao)\b/.test(
      normalized
    );
  const hasCodeShape =
    /[{}<>;=]|\b(import|export|function|const|let|var|return|class|type|interface|describe|test|expect)\b/.test(text);
  return Boolean(startsAsInstruction && !hasCodeShape);
}

function validateCriticalOperationContent(operation = {}) {
  if (!operation || (operation.op !== 'write_file' && operation.op !== 'append_file')) return null;
  const relPath = String(operation.path || '').replace(/\\/g, '/').toLowerCase();
  const content = String(operation.content || '');
  const trimmed = content.trim();
  if (!relPath || !trimmed) return null;

  if (/package\.json$|tsconfig\.json$|jsconfig\.json$/i.test(relPath)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { path: relPath, reason: 'json_not_object' };
      }
    } catch {
      return { path: relPath, reason: 'invalid_json' };
    }
  }

  if (looksLikeInstructionOnlyContent(trimmed)) {
    return { path: relPath, reason: 'instruction_text_in_code_file' };
  }

  if (/\.(tsx|ts|jsx|js|mjs|cjs)$/i.test(relPath)) {
    const hasCodeToken =
      /\b(import|export|function|const|let|var|return|class|type|interface|describe|test|it|expect)\b|module\.exports|exports\.|=>|<[A-Za-z][^>]*>/.test(
        trimmed
      );
    if (!hasCodeToken) return { path: relPath, reason: 'missing_code_tokens' };
  }

  if (/\.(css|scss|sass)$/i.test(relPath)) {
    const hasCssShape = /[{;}@]|\b(tailwind|layer|media|container|font-family|background|color)\b/i.test(trimmed);
    if (!hasCssShape) return { path: relPath, reason: 'missing_css_tokens' };
  }

  return null;
}

function createCortexValidationService(dependencies = {}) {
  const {
    CORTEX_VALIDATION_MIN_SCORE = 55,
    CORTEX_VALIDATION_REQUIRE_CORE = true,
    CORTEX_VALIDATION_REPAIR_MIN_IMPROVEMENT = 2,
    excludedDirs = new Set(),
    evaluateOperationBatchArtifactQuality = () => null,
    fs = defaultFs,
    path = defaultPath,
    normalizeRequestedRelativePath = (value) => String(value || '').replace(/\\/g, '/'),
  } = dependencies;

  function evaluateExecutionReadiness({
    operations = [],
    projectRootPath = null,
    executionIntent = 'edit_project',
    userMessage = '',
    artifactContext = '',
  } = {}) {
    const opList = Array.isArray(operations) ? operations : [];
    const initMode = String(executionIntent || '').toLowerCase() === 'init_project';

    const filesWritten = new Set(
      opList
        .filter((op) => op && (op.op === 'write_file' || op.op === 'append_file'))
        .map((op) => String(op.path || '').toLowerCase())
    );
    const dirsTouched = new Set(
      opList
        .filter((op) => op && op.op === 'mkdir')
        .map((op) => String(op.path || '').toLowerCase().replace(/\/+$/, ''))
        .filter(Boolean)
    );

    const existingFiles = new Set();
    const existingDirs = new Set();
    const contentParts = opList
      .filter((op) => op && (op.op === 'write_file' || op.op === 'append_file'))
      .map((op) => String(op.content || ''));
    const cssImportOrderViolations = [];
    const invalidOperationContents = opList
      .map((op) => validateCriticalOperationContent(op))
      .filter(Boolean);

    if (projectRootPath && typeof projectRootPath === 'string' && fs.existsSync(projectRootPath)) {
      const stack = [projectRootPath];
      while (stack.length && existingFiles.size <= 1200) {
        const current = stack.pop();
        let dirents = [];
        try {
          dirents = fs.readdirSync(current, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of dirents) {
          const abs = path.join(current, entry.name);
          const rel = path.relative(projectRootPath, abs).replace(/\\/g, '/');
          if (!rel || rel.startsWith('..')) continue;
          const lowerRel = rel.toLowerCase();
          if (entry.isDirectory()) {
            if (excludedDirs.has(entry.name)) continue;
            existingDirs.add(lowerRel.replace(/\/+$/, ''));
            stack.push(abs);
            continue;
          }
          existingFiles.add(lowerRel);
        }
      }

      const commonCandidates = [
        'index.html',
        'index.php',
        'style.css',
        'styles.css',
        'script.js',
        'app.js',
        'package.json',
        'app/layout.tsx',
        'app/page.tsx',
        'app/globals.css',
        'src/app/layout.tsx',
        'src/app/page.tsx',
        'src/app/globals.css',
        'readme.md',
        'pages/contato.html',
        'pages/servicos.html',
      ];
      for (const relPath of commonCandidates) {
        const safeRel = normalizeRequestedRelativePath(relPath);
        if (!safeRel) continue;
        const absPath = path.join(projectRootPath, safeRel);
        if (!fs.existsSync(absPath)) continue;
        try {
          const stat = fs.statSync(absPath);
          if (!stat.isFile()) continue;
          if (stat.size <= 450000) {
            contentParts.push(fs.readFileSync(absPath, 'utf8'));
          }
        } catch {
          // ignora arquivos inacessíveis
        }
      }
    }

    for (const op of opList) {
      if (!op || (op.op !== 'write_file' && op.op !== 'append_file')) continue;
      if (!isCssOperationPath(op.path)) continue;
      const relPath = normalizeRequestedRelativePath(op.path);
      let cssContent = String(op.content || '');
      if (op.op === 'append_file' && projectRootPath && typeof projectRootPath === 'string' && relPath) {
        const absPath = path.join(projectRootPath, relPath);
        try {
          if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
            cssContent = `${fs.readFileSync(absPath, 'utf8')}${cssContent}`;
          }
        } catch {
          // Se o arquivo existente não puder ser lido, a validação principal segue.
        }
      }
      const violation = findCssImportOrderViolation(cssContent);
      if (violation) {
        cssImportOrderViolations.push({
          op: op.op,
          path: String(op.path || ''),
          line: violation.line,
          statement: violation.statement,
        });
      }
    }

    const mergedContent = contentParts.join('\n').toLowerCase();
    const semanticRequirements = buildSemanticRequirementsFromPrompt(userMessage);
    const semanticTokenMap = {
      faq: /\bfaq\b|perguntas frequentes|d[uú]vidas frequentes/i,
      plans: /\bplanos?\b|pre[cç]os?|assinaturas?/i,
      whatsapp: /whatsapp|whats app|wa\.me/i,
      contact: /contato|fale conosco|agendar|agendamento|formul[aá]rio/i,
      services: /servi[cç]os?|atendimentos?/i,
      testimonials: /depoimentos?|avalia[cç][õo]es?|testemunhos?/i,
      about: /\bsobre\b|quem somos|nossa hist[oó]ria/i,
    };
    const semanticHits = semanticRequirements.filter((id) => {
      const pattern = semanticTokenMap[id];
      return pattern ? pattern.test(mergedContent) : false;
    });
    const semanticCoverage =
      semanticRequirements.length > 0
        ? Number((semanticHits.length / semanticRequirements.length).toFixed(2))
        : 1;

    const writeCount = filesWritten.size;
    const hasDiskIndex =
      existingFiles.has('index.html') ||
      existingFiles.has('index.php') ||
      filesWritten.has('index.html') ||
      filesWritten.has('index.php');
    const hasNextEntry =
      existingFiles.has('app/page.tsx') ||
      existingFiles.has('src/app/page.tsx') ||
      existingFiles.has('pages/index.tsx') ||
      existingFiles.has('src/pages/index.tsx') ||
      filesWritten.has('app/page.tsx') ||
      filesWritten.has('src/app/page.tsx') ||
      filesWritten.has('pages/index.tsx') ||
      filesWritten.has('src/pages/index.tsx');
    const requestedNext = /\b(next|nextjs|next\.js|react|tailwind)\b/i.test(`${userMessage}\n${artifactContext}`);
    const linkedCss = /(href\s*=\s*["'][^"']*style\.css["'])/i.test(mergedContent);
    const linkedJs = /(src\s*=\s*["'][^"']*script\.js["'])/i.test(mergedContent);
    const hasCssFile = existingFiles.has('style.css') || filesWritten.has('style.css');
    const hasJsFile = existingFiles.has('script.js') || filesWritten.has('script.js');
    const touchedExistingFile = Array.from(filesWritten).some((file) => existingFiles.has(file));
    const scaffoldRewrite = looksLikeScaffoldRewriteBatch(opList);
    const patchStyle = isPatchStyleRequest(userMessage);
    const artifactQuality = evaluateOperationBatchArtifactQuality({
      operations: opList,
      projectRootPath,
      executionIntent,
      userMessage,
      contextText: artifactContext,
    });
    const artifactChecks = artifactQuality && artifactQuality.enabled
      ? {
          artifactStack: artifactQuality.checks ? artifactQuality.checks.stackEntry !== false : true,
          artifactCss: artifactQuality.checks ? artifactQuality.checks.cssSubstantial !== false : true,
          artifactResponsive: artifactQuality.checks ? artifactQuality.checks.responsive !== false : true,
          artifactSpecificity: artifactQuality.checks ? artifactQuality.checks.contentSpecific !== false : true,
          artifactNoGeneric: artifactQuality.checks ? artifactQuality.checks.noGenericPlaceholders !== false : true,
          artifactMinimum: Boolean(artifactQuality.passesMinimum),
        }
      : {};

    const checks = {
      operations: opList.length > 0,
      files: writeCount >= 1,
      runnableEntry: hasDiskIndex || hasNextEntry || (!requestedNext && writeCount > 0),
      patchFirst:
        initMode || !patchStyle || !scaffoldRewrite || touchedExistingFile,
      cssLinked:
        !hasCssFile || linkedCss || !hasDiskIndex,
      jsLinked:
        !hasJsFile || linkedJs || !hasDiskIndex,
      contentNonEmpty: mergedContent.trim().length > 40,
      operationContentValidity: invalidOperationContents.length === 0,
      cssImportOrder: cssImportOrderViolations.length === 0,
      semanticCoverage:
        semanticRequirements.length === 0 || semanticCoverage >= 0.6,
      ...artifactChecks,
    };

    const total = Object.keys(checks).length;
    const passed = Object.values(checks).filter(Boolean).length;
    const score = Math.round((passed / total) * 100);
    const minScore = Math.max(1, Math.min(100, CORTEX_VALIDATION_MIN_SCORE));
    const artifactGatePassed = !artifactQuality || !artifactQuality.enabled || Boolean(artifactQuality.passesMinimum);
    const artifactBlocksPreExecution = Boolean(initMode && !artifactGatePassed);
    const technicalChecksPassed = Boolean(
      checks.operations &&
      checks.files &&
      checks.runnableEntry &&
      checks.patchFirst &&
      checks.operationContentValidity &&
      checks.cssImportOrder
    );
    const coreChecksPassed = Boolean(technicalChecksPassed && !artifactBlocksPreExecution);
    const ready = CORTEX_VALIDATION_REQUIRE_CORE ? coreChecksPassed && score >= minScore : score >= minScore;
    const visualValidation = buildVisualValidationReport({
      technicalChecksPassed,
      technicalScore: score,
      minTechnicalScore: minScore,
      artifactQuality: artifactQuality && artifactQuality.enabled ? artifactQuality : null,
    });

    return {
      score,
      checks,
      filesWritten: Array.from(filesWritten),
      semanticRequirements,
      semanticHits,
      semanticCoverage,
      cssImportOrderViolations,
      invalidOperationContents,
      artifactQuality: artifactQuality && artifactQuality.enabled ? artifactQuality : null,
      missingRequiredFiles: [],
      missingRequiredDirs: [],
      minScore,
      technicalChecksPassed,
      visualValidation,
      coreChecksPassed,
      ready,
    };
  }

  function hasValidationCoverageImproved(previousCoverage, nextCoverage) {
    if (!nextCoverage) return false;
    if (!previousCoverage) return true;
    if (Boolean(nextCoverage.ready) && !Boolean(previousCoverage.ready)) return true;
    if (
      Number(nextCoverage.score || 0) >=
      Number(previousCoverage.score || 0) + Math.max(1, CORTEX_VALIDATION_REPAIR_MIN_IMPROVEMENT)
    ) {
      return true;
    }
    if (!Boolean(previousCoverage.coreChecksPassed) && Boolean(nextCoverage.coreChecksPassed)) return true;
    const previousArtifactScore = Number(previousCoverage.artifactQuality && previousCoverage.artifactQuality.score);
    const nextArtifactScore = Number(nextCoverage.artifactQuality && nextCoverage.artifactQuality.score);
    if (
      Number.isFinite(previousArtifactScore) &&
      Number.isFinite(nextArtifactScore) &&
      nextArtifactScore >= previousArtifactScore + Math.max(1, CORTEX_VALIDATION_REPAIR_MIN_IMPROVEMENT)
    ) {
      return true;
    }

    const prevMissingFiles = Array.isArray(previousCoverage.missingRequiredFiles)
      ? previousCoverage.missingRequiredFiles.length
      : 0;
    const nextMissingFiles = Array.isArray(nextCoverage.missingRequiredFiles)
      ? nextCoverage.missingRequiredFiles.length
      : 0;
    if (nextMissingFiles < prevMissingFiles) return true;

    const prevMissingDirs = Array.isArray(previousCoverage.missingRequiredDirs)
      ? previousCoverage.missingRequiredDirs.length
      : 0;
    const nextMissingDirs = Array.isArray(nextCoverage.missingRequiredDirs)
      ? nextCoverage.missingRequiredDirs.length
      : 0;
    if (nextMissingDirs < prevMissingDirs) return true;

    return false;
  }

  function normalizeOpMergePath(value) {
    const normalized = normalizeRequestedRelativePath(value);
    return normalized ? normalized.toLowerCase() : '';
  }

  function mergeOperationBatches(baseOperations = [], incomingOperations = []) {
    const dirs = new Map();
    const files = new Map();
    const passthrough = [];

    const ingest = (list = []) => {
      for (const raw of list || []) {
        if (!raw || typeof raw !== 'object') continue;
        const op = String(raw.op || '').trim().toLowerCase();
        const relPath = normalizeOpMergePath(raw.path);
        if (!relPath) continue;

        if (op === 'mkdir') {
          if (!dirs.has(relPath)) dirs.set(relPath, { op: 'mkdir', path: relPath });
          continue;
        }

        if (op === 'write_file' || op === 'append_file') {
          files.set(relPath, {
            op,
            path: relPath,
            content: typeof raw.content === 'string' ? raw.content : '',
          });
          continue;
        }

        passthrough.push({ ...raw, path: relPath });
      }
    };

    ingest(baseOperations);
    ingest(incomingOperations);

    return [...dirs.values(), ...files.values(), ...passthrough];
  }

  return {
    buildSemanticRequirementsFromPrompt,
    evaluateExecutionReadiness,
    hasValidationCoverageImproved,
    mergeOperationBatches,
  };
}

module.exports = {
  buildSemanticRequirementsFromPrompt,
  createCortexValidationService,
};
