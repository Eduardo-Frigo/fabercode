const defaultFs = require('fs');
const defaultPath = require('path');

const {
  evaluateBriefingAdherence,
  formatBriefingContractForPrompt,
  inferBriefingContract,
} = require('./briefing_contract_service');

function normalizeQualityText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildArtifactQualityContextText({
  userMessage = '',
  workGraph = null,
  contextText = '',
  acceptanceCriteria = [],
} = {}) {
  const parts = [userMessage, contextText];
  if (workGraph && typeof workGraph === 'object') {
    parts.push(workGraph.brief || '');
    if (workGraph.briefSpec) {
      try {
        parts.push(JSON.stringify(workGraph.briefSpec));
      } catch {
        parts.push(String(workGraph.briefSpec || ''));
      }
    }
    if (Array.isArray(workGraph.acceptanceCriteria)) {
      parts.push(workGraph.acceptanceCriteria.join(' '));
    }
  }
  if (Array.isArray(acceptanceCriteria)) parts.push(acceptanceCriteria.join(' '));
  return parts.filter(Boolean).join('\n');
}

function isNarrowContentEditRequest(userMessage = '') {
  const source = normalizeQualityText(userMessage);
  if (!source) return false;
  const hasEditVerb = /\b(mude|altere|troque|substitua|atualize|renomeie|edite|editar|corrija|ajuste)\b/.test(source);
  const hasContentTarget = /\b(titulo|headline|subtitulo|texto|copy|label|rotulo|nome|descricao|frase)\b/.test(source);
  const hasBroadVisualOrStructuralTarget =
    /\b(layout|visual|cores?|paleta|estilo|css|tailwind|responsivo|hero|secao|secoes|servicos|contato|formulario|cards?|grid|pagina inteira|site inteiro|refaca|recrie|reestruture)\b/.test(source);
  return Boolean(hasEditVerb && hasContentTarget && !hasBroadVisualOrStructuralTarget);
}

function inferArtifactExpectations({
  userMessage = '',
  executionIntent = '',
  contextText = '',
  workGraph = null,
} = {}) {
  const contract = inferBriefingContract({ userMessage, contextText, workGraph });
  const source = normalizeQualityText(
    buildArtifactQualityContextText({ userMessage, contextText, workGraph })
  );
  const initMode = String(executionIntent || '').toLowerCase() === 'init_project';
  const editMode = String(executionIntent || '').toLowerCase() === 'edit_project';
  const narrowContentEdit = editMode && isNarrowContentEditRequest(userMessage);
  const siteLike = /\b(site|landing|one page|pagina|institucional|web|html|php|lamp|next|nextjs|next\.js|react|tailwind|cta)\b/.test(source);
  const lamp = contract.stack === 'lamp' || /\b(lamp|php|mysql)\b/.test(source);
  const next = ['next', 'next-tailwind'].includes(contract.stack) || /\b(next|nextjs|next\.js)\b/.test(source);
  const react = ['react', 'next', 'next-tailwind'].includes(contract.stack) || /\b(react)\b/.test(source) || next;
  const tailwind = contract.stack === 'next-tailwind' || /\b(tailwind)\b/.test(source);
  const placeholderAuthorized = /\b(placeholders?|default|defaults|padrao|qualquer coisa|voce decide|pode fazer|pode seguir|generico|generica)\b/.test(source);

  return {
    enabled: Boolean((initMode || siteLike) && !narrowContentEdit),
    initMode,
    editMode,
    narrowContentEdit,
    siteLike,
    lamp,
    next,
    react,
    tailwind,
    placeholderAuthorized,
    domain: contract.domain || '',
    domainLabel: contract.domainLabel || '',
    contract,
    source,
  };
}

function collectOperationWrites(operations = []) {
  const writes = new Map();
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (!operation || typeof operation !== 'object') continue;
    const op = String(operation.op || '').trim().toLowerCase();
    if (op !== 'write_file' && op !== 'append_file') continue;
    const relPath = String(operation.path || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    if (!relPath) continue;
    writes.set(relPath, String(operation.content || ''));
  }
  return writes;
}

function countCssRules(css = '') {
  return (String(css || '').match(/\{[^}]*\}/g) || []).length;
}

function hasAnyPattern(text, patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function extractExistingFileContent({ fs, path, projectRootPath, relPath }) {
  if (!projectRootPath || !relPath) return '';
  const abs = path.join(projectRootPath, relPath);
  try {
    if (!fs.existsSync(abs)) return '';
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > 600000) return '';
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}

function createArtifactQualityService(dependencies = {}) {
  const {
    fs = defaultFs,
    path = defaultPath,
    minArtifactQualityScore = 70,
  } = dependencies;

  function readCandidateContent(writes, projectRootPath, candidates = []) {
    for (const relPath of candidates) {
      const key = String(relPath || '').toLowerCase();
      if (writes.has(key)) return writes.get(key);
    }
    for (const relPath of candidates) {
      const existing = extractExistingFileContent({ fs, path, projectRootPath, relPath });
      if (existing) return existing;
    }
    return '';
  }

  function evaluateOperationBatchArtifactQuality({
    operations = [],
    projectRootPath = '',
    userMessage = '',
    executionIntent = '',
    contextText = '',
    workGraph = null,
  } = {}) {
    const expectations = inferArtifactExpectations({
      userMessage,
      executionIntent,
      contextText,
      workGraph,
    });

    if (!expectations.enabled) {
      return {
        enabled: false,
        score: 100,
        minScore: minArtifactQualityScore,
        passesMinimum: true,
        checks: {},
        issues: [],
        guidance: [],
        expectations,
      };
    }

    const writes = collectOperationWrites(operations);
    const htmlContent = readCandidateContent(writes, projectRootPath, ['index.html', 'index.php']);
    const phpContent = readCandidateContent(writes, projectRootPath, ['index.php']);
    const nextPageContent = readCandidateContent(writes, projectRootPath, [
      'app/page.tsx',
      'src/app/page.tsx',
      'pages/index.tsx',
      'src/pages/index.tsx',
      'app/page.jsx',
      'pages/index.jsx',
    ]);
    const nextLayoutContent = readCandidateContent(writes, projectRootPath, [
      'app/layout.tsx',
      'src/app/layout.tsx',
      'app/layout.jsx',
    ]);
    const packageContent = readCandidateContent(writes, projectRootPath, ['package.json']);
    const cssContent = readCandidateContent(writes, projectRootPath, [
      'style.css',
      'styles.css',
      'app/globals.css',
      'src/app/globals.css',
      'styles/globals.css',
    ]);
    const jsContent = readCandidateContent(writes, projectRootPath, ['script.js', 'app.js']);
    const merged = normalizeQualityText([htmlContent, phpContent, nextPageContent, nextLayoutContent, packageContent, cssContent, jsContent].join('\n'));
    const rawMerged = [htmlContent, phpContent, nextPageContent, nextLayoutContent, packageContent, cssContent, jsContent].join('\n');
    const cssRules = countCssRules(cssContent);
    const tailwindUtilityTokens = (
      rawMerged.match(/\b(?:sm:|md:|lg:|xl:|grid|flex|rounded|shadow|bg-\[|bg-|text-\[|text-|px-|py-|p-|gap-|max-w-|min-h-|border|backdrop-blur)\b/g) || []
    ).length;
    const visualTokens = [
      /background\s*:/i,
      /color\s*:/i,
      /border/i,
      /box-shadow/i,
      /font-size/i,
      /line-height/i,
      /gap\s*:/i,
      /padding\s*:/i,
      /margin\s*:/i,
    ].filter((pattern) => pattern.test(cssContent)).length;
    const layoutTokens = [
      /display\s*:\s*(grid|flex)/i,
      /grid-template/i,
      /align-items/i,
      /justify-content/i,
      /max-width/i,
      /min-height/i,
    ].filter((pattern) => pattern.test(cssContent)).length;

    const hasIndexHtml = writes.has('index.html') || Boolean(extractExistingFileContent({ fs, path, projectRootPath, relPath: 'index.html' }));
    const hasIndexPhp = writes.has('index.php') || Boolean(phpContent);
    const hasNextPage =
      writes.has('app/page.tsx') ||
      writes.has('src/app/page.tsx') ||
      writes.has('pages/index.tsx') ||
      writes.has('src/pages/index.tsx') ||
      Boolean(nextPageContent);
    const hasNextLayout =
      writes.has('app/layout.tsx') ||
      writes.has('src/app/layout.tsx') ||
      Boolean(nextLayoutContent);
    const packageHasNext = /"next"\s*:/i.test(packageContent);
    const packageHasTailwind = /"tailwindcss"\s*:/i.test(packageContent) || /"@tailwindcss\/postcss"\s*:/i.test(packageContent);
    const cssImportsTailwind = /@import\s+["']tailwindcss["']|@tailwind\s+(base|components|utilities)/i.test(cssContent);
    const usesTailwindUtilities =
      expectations.tailwind ||
      packageHasTailwind ||
      cssImportsTailwind ||
      tailwindUtilityTokens >= 10;
    const hasHeroSection = hasAnyPattern(merged, [
      /\bhero\b/,
      /\binicio\b/,
      /\bprincipal\b/,
      /\bpresenca digital\b/,
      /\bproposta de valor\b/,
      /\bheadline\b/,
    ]);
    const hasConversionSection = hasAnyPattern(merged, [
      /\bcontato\b/,
      /\bagendar\b/,
      /\bfale conosco\b/,
      /\bconversar\b/,
      /\bsolicitar\b/,
      /\bcomprar\b/,
      /\bconhecer colecoes\b/,
    ]);
    const sectionFamilies = [
      [/\bservicos\b/, /\batendimentos\b/, /\bofertas\b/, /\bsolucoes\b/],
      [/\bcolecoes\b/, /\bprodutos\b/, /\bproduto\b/, /\bcat[aá]logo\b/, /\bbolsas\b/, /\bpastas\b/],
      [/\bsobre\b/, /\bquem somos\b/, /\bhistoria\b/, /\batelier\b/, /\bequipe\b/],
      [/\bmetodo\b/, /\bprocesso\b/, /\bproducao\b/, /\bartesanal\b/, /\bpassos\b/],
      [/\bmateriais\b/, /\bmateria[-\s]prima\b/, /\bcouro\b/, /\bdurabilidade\b/, /\blongevidade\b/],
      [/\bdepoimentos\b/, /\bprova social\b/, /\bresultados\b/, /\bcredenciais\b/],
      [/\bfaq\b/, /\bperguntas\b/, /\bduvidas\b/, /\bcuidados\b/],
      [/\bgaleria\b/, /\bportfolio\b/, /\bprojetos\b/, /\breferencias\b/],
    ].filter((patterns) => hasAnyPattern(merged, patterns)).length;
    const checks = {
      stackEntry:
        expectations.lamp
          ? hasIndexPhp
          : expectations.next
            ? hasNextPage && hasNextLayout && packageHasNext
            : true,
      tailwindStack:
        !expectations.tailwind ||
        (packageHasTailwind && cssImportsTailwind && tailwindUtilityTokens >= 6),
      requiredSections:
        hasHeroSection &&
        hasConversionSection &&
        sectionFamilies >= 2,
      cssSubstantial:
        usesTailwindUtilities
          ? cssContent.trim().length >= 220 && tailwindUtilityTokens >= 10
          : cssContent.trim().length >= 500 &&
            cssRules >= 8 &&
            layoutTokens >= 2 &&
            visualTokens >= 5,
      responsive:
        /@media/i.test(cssContent) ||
        /clamp\s*\(/i.test(cssContent) ||
        /minmax\s*\(/i.test(cssContent) ||
        /\b(sm|md|lg|xl):/.test(rawMerged),
      contentSpecific: true,
      noGenericPlaceholders:
        !/\b(titulo principal|subtitulo|servico 1|servico 2|prova social curta|historia, diferenciais|lorem ipsum)\b/.test(merged),
      cta:
        /\b(agendar|falar com|contato|marcar consulta|enviar mensagem|conversar)\b/.test(merged),
    };
    const briefingAdherence = evaluateBriefingAdherence({
      contract: expectations.contract,
      text: rawMerged,
    });
    checks.contentSpecific = !briefingAdherence.enabled || briefingAdherence.passesMinimum;

    const issues = [];
    const guidance = [];
    const addIssue = (id, severity, detail, hint) => {
      issues.push({ id, severity, detail, hint });
      if (hint) guidance.push(hint);
    };

    if (!checks.stackEntry) {
      addIssue(
        'stack_entry',
        'critical',
        expectations.lamp
          ? hasIndexHtml
            ? 'Pedido LAMP/PHP gerou entrada HTML em vez de PHP.'
            : 'Pedido LAMP/PHP não gerou index.php.'
          : 'Pedido Next.js não gerou uma estrutura App Router mínima.',
        expectations.lamp
          ? 'Para LAMP/PHP, gere index.php como entrada principal e mantenha style.css/script.js conectados.'
          : 'Para Next.js, gere package.json, app/layout.tsx, app/page.tsx e app/globals.css.'
      );
    }
    if (!checks.tailwindStack) {
      addIssue(
        'tailwind_stack',
        'critical',
        'Pedido Tailwind não contém configuração/uso mínimo de Tailwind.',
        'Inclua tailwindcss no package.json, importe Tailwind no CSS global e use classes utilitárias no JSX.'
      );
    }
    if (!checks.requiredSections) {
      addIssue(
        'required_sections',
        'warning',
        'Página sem composição mínima de seções editáveis.',
        'Inclua hero/início, pelo menos duas seções coerentes com o domínio, contato/conversão e CTA explícita.'
      );
    }
    if (!checks.cssSubstantial) {
      addIssue(
        'css_substantial',
        'critical',
        `CSS insuficiente para uma página modular (${cssContent.trim().length} bytes, ${cssRules} regra(s)).`,
        'Expanda style.css com layout, espaçamento, cores, botões, cards/formulário e estados responsivos.'
      );
    }
    if (!checks.responsive) {
      addIssue(
        'responsive',
        'warning',
        'CSS sem regra responsiva detectável.',
        'Adicione @media, clamp(...) ou minmax(...) para mobile e desktop.'
      );
    }
    if (!checks.contentSpecific) {
      addIssue(
        'content_specific',
        briefingAdherence.severity || 'warning',
        briefingAdherence.detail || 'Conteúdo não preserva o domínio do pedido.',
        briefingAdherence.hint || 'Use placeholders contextualizados ao domínio solicitado.'
      );
    }
    if (!checks.noGenericPlaceholders) {
      addIssue(
        'generic_placeholders',
        'warning',
        'Foram detectados placeholders genéricos demais.',
        'Troque textos como "Título principal" e "Serviço 1" por placeholders contextualizados.'
      );
    }
    if (!checks.cta) {
      addIssue(
        'cta',
        'warning',
        'CTA principal não foi detectada.',
        'Inclua uma chamada para ação clara, como agendar consulta ou falar com a equipe.'
      );
    }

    const weights = {
      stackEntry: expectations.lamp || expectations.next ? 18 : 0,
      tailwindStack: expectations.tailwind ? 12 : 0,
      requiredSections: 18,
      cssSubstantial: 20,
      responsive: 12,
      contentSpecific: expectations.domain ? 14 : 8,
      noGenericPlaceholders: 14,
      cta: 12,
    };
    const maxScore = Object.values(weights).reduce((acc, value) => acc + value, 0) || 1;
    const score = Math.round(
      Object.entries(weights).reduce((acc, [key, weight]) => {
        return acc + (checks[key] ? weight : 0);
      }, 0) * 100 / maxScore
    );
    const criticalFailures = issues.filter((issue) => issue.severity === 'critical').map((issue) => issue.id);
    const passesMinimum = score >= minArtifactQualityScore && criticalFailures.length === 0;

    return {
      enabled: true,
      score,
      minScore: minArtifactQualityScore,
      passesMinimum,
      checks,
      issues,
      guidance: Array.from(new Set(guidance)),
      criticalFailures,
      expectations,
      briefingAdherence,
      metrics: {
        cssBytes: cssContent.trim().length,
        cssRules,
        layoutTokens,
        visualTokens,
        tailwindUtilityTokens,
        htmlBytes: htmlContent.trim().length || phpContent.trim().length,
      },
      hasIndexHtml,
      hasIndexPhp,
      hasNextPage,
      hasNextLayout,
      rawPreview: rawMerged.slice(0, 800),
    };
  }

  function buildArtifactQualityPromptGuidance({
    userMessage = '',
    executionIntent = '',
    contextText = '',
    workGraph = null,
  } = {}) {
    const expectations = inferArtifactExpectations({
      userMessage,
      executionIntent,
      contextText,
      workGraph,
    });
    if (!expectations.enabled) return '';

    const lines = [
      'Diretrizes suaves de qualidade visual e aderência:',
      '- Entregue uma página usável, não um wireframe cru: hero, seções coerentes com o domínio, contato/conversão e CTA clara.',
      '- Use placeholders contextualizados ao domínio do pedido; evite "Título principal", "Subtítulo", "Serviço 1" e textos genéricos similares.',
      '- O CSS deve ser substancial: layout, espaçamento, paleta, tipografia, botões, formulário/cards e responsividade.',
      '- Inclua regra responsiva com @media, clamp(...) ou minmax(...).',
    ];
    if (expectations.lamp) {
      lines.push('- Como o pedido é LAMP/PHP, use index.php como entrada principal, com style.css e script.js conectados.');
    }
    if (expectations.next) {
      lines.push('- Como o pedido é Next.js, use App Router com package.json, app/layout.tsx, app/page.tsx e app/globals.css.');
    }
    if (expectations.tailwind) {
      lines.push('- Como o pedido usa Tailwind, inclua dependências/configuração mínima e classes utilitárias responsivas no JSX.');
    }
    const briefingContractGuidance = formatBriefingContractForPrompt(expectations.contract);
    if (briefingContractGuidance) {
      for (const line of briefingContractGuidance.split('\n').filter(Boolean)) {
        lines.push(`- ${line}`);
      }
    }
    return lines.join('\n');
  }

  function formatArtifactQualityForPrompt(report, { maxIssues = 6 } = {}) {
    if (!report || !report.enabled) return '';
    const issues = Array.isArray(report.issues) ? report.issues.slice(0, maxIssues) : [];
    const lines = [
      `Qualidade de artefato: ${report.score}% (mínimo ${report.minScore}%).`,
      ...issues.map((issue, index) => {
        const severity = String(issue.severity || 'warning').toUpperCase();
        const hint = issue.hint ? ` Correção: ${issue.hint}` : '';
        return `${index + 1}. [${severity}] ${issue.detail}${hint}`;
      }),
    ];
    return lines.join('\n');
  }

  return {
    buildArtifactQualityContextText,
    buildArtifactQualityPromptGuidance,
    evaluateOperationBatchArtifactQuality,
    formatArtifactQualityForPrompt,
    inferArtifactExpectations,
    isNarrowContentEditRequest,
  };
}

module.exports = {
  buildArtifactQualityContextText,
  createArtifactQualityService,
  inferArtifactExpectations,
  isNarrowContentEditRequest,
  normalizeQualityText,
};
