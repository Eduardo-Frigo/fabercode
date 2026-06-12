const defaultFs = require('fs');
const defaultPath = require('path');

const {
  evaluateBriefingAdherence,
  formatBriefingContractForPrompt,
  inferBriefingContract,
} = require('./briefing_contract_service');
const { inferExplicitBrand } = require('./briefing_spec_service');

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
  const targetSource = source
    .replace(/\b(?:nao|sem)\s+(?:altere|alterar|mude|mudar|mexa|mexer|toque|tocar|modifique|modificar)\b[^.!?;]*/g, ' ')
    .replace(/\bpreserv(?:e|ar)\b[^.!?;]*/g, ' ');
  const hasEditVerb = /\b(mude|altere|troque|substitua|atualize|renomeie|edite|editar|corrija|ajuste)\b/.test(source);
  const hasContentTarget = /\b(titulo|headline|subtitulo|texto|copy|label|rotulo|nome|descricao|frase)\b/.test(source);
  const hasScopedTypographyTarget =
    /\b(tipografia|tipografias|fonte|fontes|font|google font|next\/font|tracking|letter spacing|letter-spacing|peso|pesos|h1|metadata\.title)\b/.test(source);
  const hasScopeLimiter =
    /\b(somente|apenas|so|só|pequena|pequeno|pontual|verificavel|verificável|nao altere|não altere|sem alterar|preserve|preservar)\b/.test(source);
  const hasBroadVisualOrStructuralTarget =
    /\b(layout|visual|cores?|paleta|estilo|css|tailwind|responsivo|hero|secao|secoes|servicos|contato|formulario|cards?|grid|pagina inteira|site inteiro|refaca|recrie|reestruture)\b/.test(targetSource);
  const hasHardStructuralTarget =
    /\b(layout|hero|secao|secoes|servicos|contato|formulario|cards?|grid|pagina inteira|site inteiro|refaca|recrie|reestruture|arquitetura|dominio|servicos|testes)\b/.test(targetSource);
  const scopedTypographyEdit = Boolean(
    hasEditVerb &&
      hasScopedTypographyTarget &&
      hasScopeLimiter &&
      !/\b(pagina inteira|site inteiro|refaca|recrie|reestruture)\b/.test(source)
  );
  return Boolean((hasEditVerb && hasContentTarget && !hasBroadVisualOrStructuralTarget) || (scopedTypographyEdit && !hasHardStructuralTarget));
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
  const normalizedExecutionIntent = String(executionIntent || '').toLowerCase();
  const initMode = normalizedExecutionIntent === 'init_project';
  const editMode = normalizedExecutionIntent === 'edit_project';
  const diagnosticRepairMode = normalizedExecutionIntent === 'diagnostic_repair';
  const narrowContentEdit = editMode && isNarrowContentEditRequest(userMessage);
  const siteLike = /\b(site|landing|one page|pagina|institucional|web|html|php|lamp|next|nextjs|next\.js|react|tailwind|cta)\b/.test(source);
  const lamp = contract.stack === 'lamp' || /\b(lamp|php|mysql)\b/.test(source);
  const next = ['next', 'next-tailwind'].includes(contract.stack) || /\b(next|nextjs|next\.js)\b/.test(source);
  const react = ['react', 'next', 'next-tailwind'].includes(contract.stack) || /\b(react)\b/.test(source) || next;
  const tailwind = contract.stack === 'next-tailwind' || /\b(tailwind)\b/.test(source);
  const placeholderDenied = /\b(sem placeholders?|nao usar placeholders?|nao quero placeholders?|conteudo final|conteudo especifico|conteudo real)\b/.test(source);
  const placeholderAuthorized = !placeholderDenied && /\b(placeholders?|default|defaults|padrao|qualquer coisa|voce decide|pode fazer|pode seguir|generico|generica)\b/.test(source);
  const requiredPageIds = inferRequiredPageIds({ source, workGraph });
  const complexApp = inferComplexAppContract(source);
  const staticMultipage =
    !diagnosticRepairMode &&
    !next &&
    !lamp &&
    (
      requiredPageIds.length > 1 ||
      /\b(multipagina|multipaginas|multi pagina|multi paginas|multiplas paginas|m[uú]ltiplas p[aá]ginas|varias paginas|v[aá]rias p[aá]ginas|rotas obrigatorias|rotas\/paginas obrigatorias|p[aá]ginas obrigat[oó]rias)\b/.test(source)
    );

  return {
    enabled: Boolean((initMode || siteLike || complexApp.enabled) && !narrowContentEdit),
    initMode,
    editMode,
    diagnosticRepairMode,
    narrowContentEdit,
    siteLike,
    lamp,
    next,
    react,
    tailwind,
    placeholderAuthorized,
    staticMultipage,
    complexApp,
    requiredPageIds,
    domain: contract.domain || '',
    domainLabel: contract.domainLabel || '',
    contract,
    source,
  };
}

function normalizeRouteId(value = '') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'index';
}

function inferRequiredPageIds({ source = '', workGraph = null } = {}) {
  const ids = new Set();
  const add = (value) => {
    const id = normalizeRouteId(value);
    if (id) ids.add(id);
  };
  let structuredPageIdsFound = false;

  if (workGraph && typeof workGraph === 'object') {
    const specs = [
      workGraph.briefSpec,
      workGraph.briefSpec && workGraph.briefSpec.temporaryBlueprintContract,
      workGraph.temporaryBlueprintContract,
    ].filter(Boolean);
    for (const spec of specs) {
      const pages = Array.isArray(spec.pages)
        ? spec.pages
        : Array.isArray(spec.requiredPages)
          ? spec.requiredPages
        : [];
      for (const page of pages) {
        if (!page) continue;
        structuredPageIdsFound = true;
        add(page.slug || page.id || page.label || page.title || '');
      }
    }
  }

  if (structuredPageIdsFound && ids.size > 1) return Array.from(ids);

  const explicitHtmlFiles = String(source || '').match(/\b[a-z0-9][a-z0-9-]*\.html\b/gi) || [];
  for (const fileName of explicitHtmlFiles) {
    add(fileName.replace(/\.html$/i, ''));
  }
  if (explicitHtmlFiles.length > 1 && ids.size > 1) return Array.from(ids);

  const pageMatches = String(source || '').match(/\b(inicio|in[ií]cio|a escola|premissas|jornada|conte[uú]dos?|contato|sobre|servi[cç]os|blog|portfolio|portf[oó]lio)\b/gi) || [];
  for (const page of pageMatches) add(page);
  if (/\b6\s+p[aá]ginas\b/.test(source) && ids.size < 6) {
    ['inicio', 'a escola', 'premissas', 'jornada', 'conteudos', 'contato'].forEach(add);
  }
  return Array.from(ids);
}

function inferComplexAppContract(source = '') {
  const normalized = normalizeQualityText(source);
  if (!normalized) {
    return {
      enabled: false,
      domainExpected: false,
      testsExpected: false,
      families: [],
      profile: '',
    };
  }
  const forgeMrp = isForgeMrpSource(normalized);
  const surfaceSignal =
    /\b(sistema|aplicacao|aplicação|app|ferramenta|dashboard|crm|erp|mrp|planner|gestao|gestão|admin|administrativa|operacional)\b/.test(
      normalized
    );
  const familyDefinitions = [
    { id: 'data_model', pattern: /\b(modelo de dados|schema|entidade|interface|type|tabela|relacional|prisma|postgres|orm)\b/ },
    { id: 'domain_rules', pattern: /\b(regra|regras|dominio|domínio|deterministico|determinístico|validacao|validação|bloquear|impedir|inconsistenc)\b/ },
    { id: 'workflow', pattern: /\b(fluxo|estado|estados|maquina de estados|máquina de estados|fsm|transicao|transição|pedido|ordem)\b/ },
    { id: 'calculation', pattern: /\b(calculo|cálculo|calcular|necessidades|faltante|disponibilidade|saldo|reserva)\b/ },
    { id: 'auditability', pattern: /\b(audit|auditoria|log|rastreabilidade|imutavel|imutável|historico|histórico)\b/ },
    { id: 'operations', pattern: /\b(crud|cadastrar|editar|desativar|movimentacao|movimentação|entrada|saida|saída|estoque|inventory|bom)\b/ },
    { id: 'tests', pattern: /\b(testes?|unitarios?|unitários?|vitest|playwright|testavel|testável|testaveis|testáveis)\b/ },
  ];
  const families = familyDefinitions
    .filter((definition) => definition.pattern.test(normalized))
    .map((definition) => definition.id);
  const longStructuredBrief =
    normalized.length > 1800 &&
    /\b(mvp|escopo|funcionalidades|regras|modelo de dados|telas principais|criterios de aceite|critérios de aceite)\b/.test(
      normalized
    );
  const enabled = Boolean(surfaceSignal && (families.length >= 3 || longStructuredBrief));
  return {
    enabled,
    domainExpected: Boolean(
      enabled && families.some((id) => ['data_model', 'domain_rules', 'workflow', 'calculation', 'operations'].includes(id))
    ),
    testsExpected: Boolean(enabled && families.includes('tests')),
    families,
    profile: forgeMrp ? 'forge_mrp' : '',
  };
}

function isForgeMrpSource(source = '') {
  const normalized = normalizeQualityText(source);
  return /\bforge mrp\b/.test(normalized) ||
    (/\bmrp\b/.test(normalized) &&
      /\b(manufatura|manufacturing|bom|bill of materials|estoque|ordens? de producao|ordens? de produção|necessidades|audit log|auditoria)\b/.test(normalized));
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function packageMentionsDependency(packageContent = '', names = []) {
  return names.some((name) => new RegExp(`"${escapeRegExp(name)}"\\s*:`, 'i').test(packageContent));
}

function hasAnyFilePath(filePaths = [], patterns = []) {
  return filePaths.some((relPath) => patterns.some((pattern) => pattern.test(String(relPath || ''))));
}

function countPatternHits(text = '', patterns = []) {
  return patterns.filter((pattern) => pattern.test(String(text || ''))).length;
}

function evaluateForgeMrpStaticContract({
  cssContent = '',
  domainContent = '',
  filePaths = [],
  nextLayoutContent = '',
  nextPageContent = '',
  packageContent = '',
  rawMerged = '',
  testContent = '',
} = {}) {
  const normalizedAll = normalizeQualityText(rawMerged);
  const normalizedDomain = normalizeQualityText(domainContent);
  const normalizedPage = normalizeQualityText(nextPageContent);
  const normalizedStyle = normalizeQualityText(`${cssContent}\n${nextLayoutContent}\n${nextPageContent}`);

  const stackDependencies = [
    ['next'],
    ['react'],
    ['react-dom'],
    ['tailwindcss', '@tailwindcss/postcss'],
    ['prisma'],
    ['@prisma/client'],
    ['zod'],
    ['vitest'],
    ['@playwright/test', 'playwright'],
    ['react-hook-form'],
    ['@tanstack/react-table', '@tanstack/table-core'],
    ['zustand'],
    ['date-fns'],
  ];
  const stackHits = stackDependencies.filter((names) => packageMentionsDependency(packageContent, names)).length;
  const hasPostgresContract =
    hasAnyFilePath(filePaths, [/^prisma\/schema\.prisma$/i]) &&
    /\bprovider\s*=\s*["']postgresql["']|\bdatabase_url\b/i.test(rawMerged);

  const hasDomainFile = hasAnyFilePath(filePaths, [
    /(^|\/)(src\/)?domain\//i,
    /(^|\/)(src\/)?models?\//i,
    /(^|\/)(src\/)?rules?\//i,
  ]);
  const hasServiceFile = hasAnyFilePath(filePaths, [
    /(^|\/)(src\/)?services?\//i,
    /(^|\/)(src\/)?use-cases?\//i,
    /(^|\/)(src\/)?repositories?\//i,
  ]);
  const hasSchemaFile =
    hasAnyFilePath(filePaths, [/^prisma\/schema\.prisma$/i, /(^|\/)(src\/)?schemas?\//i]) ||
    /\bz\.object\b|\bzod\b/i.test(rawMerged);

  const mrpExplosionTokens = countPatternHits(normalizedDomain, [
    /\b(bom|component|components|bill of materials)\b/,
    /\b(explode|explodir|walk|traverse|percorr|recursive|recurs|stack|queue|fila|pilha)\b/,
    /\b(qtyper|quantityper|quantidade por|component\.quantity|component\.qty|perassembly)\b/,
    /\b(shortage|faltante|necessidade|requirement|grossrequirement|netrequirement)\b/,
    /\b(lot|lote|leadtime|lead time|safetystock|estoque de seguranca|estoque de segurança)\b/,
  ]);
  const directOnlyMrp =
    /\borders?\.filter\b[\s\S]{0,140}\bitemid\s*===\s*item\.id/i.test(domainContent) &&
    !/\b(explode|walk|traverse|recursive|recurs|component)/i.test(domainContent);

  const bomCrudTokens = countPatternHits(normalizedPage, [
    /\b(bom|estrutura de produto|revisao|revisão|componentes?)\b/,
    /\b(adicionar|add|editar|edit|remover|remove|desativar|ativar)\b/,
    /\b(form|input|select|useform|react hook form)\b/,
    /\b(table|tabela|tanstack|usereacttable)\b/,
    /\b(qtyper|quantityper|quantidade|componentitem|item componente)\b/,
  ]);

  const auditTokens = countPatternHits(normalizedDomain, [
    /\b(auditentry|audit log|auditoria|auditlog)\b/,
    /\b(before|antes|previous|prev)\b/,
    /\b(after|depois|next)\b/,
    /\b(user|userid|usuario|usuário|actor|origem|origin)\b/,
    /\b(append|appendonly|imutavel|imutável|immutable|readonly|object\.freeze|push)\b/,
  ]);

  const productionTokens = countPatternHits(normalizedDomain, [
    /\b(draft|rascunho|validated|validado|in_production|em producao|em produção|done|finalizado|cancelled|cancelado)\b/,
    /\b(transition|transicao|transição|state machine|maquina de estados|máquina de estados)\b/,
    /\b(invalid|invalida|inválida|throw new error)\b/,
    /\b(negative|negativo|saldo insuficiente|saldo nunca|stock never|estoque nunca)\b/,
    /\b(reserve|reservar|consume|consumir|movimentacao|movimentação|stock movement)\b/,
  ]);

  const criticalTestHits = countPatternHits(normalizeQualityText(testContent), [
    /\b(bom multinivel|bom multinível|multi[-\s]?level|explode|explodir|componentes)\b/,
    /\b(saldo negativo|negative stock|saldo insuficiente|estoque nunca)\b/,
    /\b(transicao invalida|transição inválida|invalid transition|maquina de estados|máquina de estados)\b/,
    /\b(audit|auditoria|before|after|immut|imut)\b/,
    /\b(ciclo|cycle|circular)\b/,
    /\b(faltante|shortage|necessidade liquida|necessidade líquida|planned order|sugestoes de compra|sugestões de compra)\b/,
    /\b(zod|schema|validacao|validação)\b/,
  ]);

  const hasAssistantFont =
    /\bassistant\b/i.test(rawMerged) ||
    /--font-assistant\b/i.test(cssContent) ||
    /font-family\s*:\s*var\(--font-assistant\)/i.test(cssContent);
  const hasDarkTheme =
    /color-scheme\s*:\s*dark/i.test(cssContent) ||
    /\bbg-(slate|zinc|neutral|stone|gray)-9(00|50)\b/i.test(nextPageContent) ||
    /#[0-1][0-9a-f]{5}\b/i.test(cssContent);
  const hasOperationalShell =
    /\b(max-w-|mx-auto|container)\b/i.test(nextPageContent) &&
    /\b(aside|nav|sticky|lg:grid-cols|xl:grid-cols|grid-cols-\[)\b/i.test(nextPageContent) &&
    /\b(kpi|indicador|dashboard|control room|ordens abertas|necessidades|sugestoes|sugestões|auditoria)\b/i.test(nextPageContent);
  const hasCrudeLightShell =
    /color-scheme\s*:\s*light/i.test(cssContent) ||
    /\bbg-slate-100\b/i.test(nextLayoutContent) ||
    /font-family\s*:\s*['"]?inter/i.test(cssContent);

  return {
    checks: {
      stack: stackHits >= stackDependencies.length - 1 && hasPostgresContract,
      architecture: hasAnyFilePath(filePaths, [/^prisma\/schema\.prisma$/i]) && hasDomainFile && hasServiceFile && hasSchemaFile,
      mrpExplosion: mrpExplosionTokens >= 5 && !directOnlyMrp,
      bomCrudUi: bomCrudTokens >= 5,
      auditTrail: auditTokens >= 5,
      productionRules: productionTokens >= 5,
      criticalTests: criticalTestHits >= 5,
      visualSystem: hasAssistantFont && hasDarkTheme && hasOperationalShell && !hasCrudeLightShell,
    },
    metrics: {
      stackHits,
      stackExpected: stackDependencies.length,
      hasPostgresContract,
      mrpExplosionTokens,
      directOnlyMrp,
      bomCrudTokens,
      auditTokens,
      productionTokens,
      criticalTestHits,
      hasAssistantFont,
      hasDarkTheme,
      hasOperationalShell,
      hasCrudeLightShell,
    },
  };
}

function collectExistingProjectFilePaths({ fs, path, projectRootPath, maxFiles = 600 } = {}) {
  if (!projectRootPath) return [];
  const out = [];
  const ignored = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage']);
  function walk(dir, prefix = '') {
    if (out.length >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry || !entry.name || ignored.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory && entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile && entry.isFile()) {
        out.push(rel.replace(/\\/g, '/').toLowerCase());
      }
      if (out.length >= maxFiles) return;
    }
  }
  try {
    if (fs.existsSync(projectRootPath) && fs.statSync(projectRootPath).isDirectory()) {
      walk(projectRootPath, '');
    }
  } catch {
    return [];
  }
  return out;
}

function collectNextRouteIds(paths = []) {
  const ids = new Set(['/']);
  let hasDynamicRoute = false;
  for (const rawPath of paths) {
    const relPath = String(rawPath || '').replace(/\\/g, '/').toLowerCase();
    const match = relPath.match(/^(?:src\/)?app\/(.+)\/page\.(tsx|jsx|ts|js)$/);
    if (!match) continue;
    const route = match[1].replace(/\/\(.*?\)/g, '').replace(/^\/+|\/+$/g, '');
    if (!route) {
      ids.add('/');
      continue;
    }
    if (route.includes('[')) hasDynamicRoute = true;
    ids.add(route);
    ids.add(route.split('/')[0]);
  }
  return { ids, hasDynamicRoute };
}

function extractInternalRouteLinks(rawContent = '') {
  const links = new Set();
  const pattern = /\bhref\s*=\s*(?:{["'`]([^"'`#?]+)["'`]}|["'`]([^"'`#?]+)["'`])/g;
  let match;
  while ((match = pattern.exec(String(rawContent || '')))) {
    const href = String(match[1] || match[2] || '').trim();
    if (!href || href === '/' || href.startsWith('#') || !href.startsWith('/') || href.startsWith('//')) continue;
    const route = href.replace(/^\/+|\/+$/g, '').split(/[?#]/)[0].toLowerCase();
    if (route && !route.startsWith('api/')) links.add(route);
  }
  return Array.from(links);
}

function stripStringsAndCommentsFromLine(line = '', state = {}) {
  let out = '';
  let escaped = Boolean(state.escaped);
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1] || '';
    if (state.blockComment) {
      if (char === '*' && next === '/') {
        state.blockComment = false;
        index += 1;
      }
      out += ' ';
      continue;
    }
    if (state.quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === state.quote) {
        state.quote = '';
      }
      out += ' ';
      continue;
    }
    if (char === '/' && next === '/') {
      out += ' ';
      break;
    }
    if (char === '/' && next === '*') {
      state.blockComment = true;
      out += '  ';
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      state.quote = char;
      escaped = false;
      out += ' ';
      continue;
    }
    out += char;
  }
  state.escaped = escaped;
  return out;
}

function findTopLevelNextBrowserGlobalAccess(rawContent = '', relPath = '') {
  const findings = [];
  const state = { quote: '', blockComment: false, escaped: false };
  let depth = 0;
  const lines = String(rawContent || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const stripped = stripStringsAndCommentsFromLine(lines[index], state);
    if (
      depth <= 0 &&
      /\b(?:document|window|localStorage|sessionStorage|navigator)\s*(?:\.|\[)/.test(stripped)
    ) {
      findings.push({
        file: relPath,
        line: index + 1,
        snippet: lines[index].trim().slice(0, 140),
      });
    }
    for (const char of stripped) {
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth = Math.max(0, depth - 1);
      }
    }
  }
  return findings;
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

function collectExistingStaticPageFiles({ fs, path, projectRootPath } = {}) {
  if (!projectRootPath) return [];
  try {
    if (!fs.existsSync(projectRootPath) || !fs.statSync(projectRootPath).isDirectory()) return [];
    return fs.readdirSync(projectRootPath, { withFileTypes: true })
      .filter((entry) => entry && entry.isFile && entry.isFile())
      .map((entry) => String(entry.name || ''))
      .filter((fileName) => /\.(html|htm)$/i.test(fileName))
      .map((fileName) => normalizeRouteId(fileName.replace(/\.(html|htm)$/i, '')))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function countCssRules(css = '') {
  return (String(css || '').match(/\{[^}]*\}/g) || []).length;
}

function hasAnyPattern(text, patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

const GENERIC_VISIBLE_PLACEHOLDER_PATTERNS = [
  /\batendimento placeholder premium\b/,
  /\bconteudo provisorio\b/,
  /\bconteudo provisório\b/,
  /\bconteudo real\b[\s\S]{0,80}\bproxima etapa\b/,
  /\bconteúdo real\b[\s\S]{0,80}\bpróxima etapa\b/,
  /\bpronta para evoluir\b/,
  /\bpronta para receber conteudo real\b/,
  /\bpronta para receber conteúdo real\b/,
  /\bfaber projeto\b/,
  /\bescritorio faber advocacia\b/,
  /\bescritório faber advocacia\b/,
  /\bstudio habitat\b/,
  /\bhelena duarte arquitetura\b/,
  /\batelier couro faber\b/,
  /\barquitetura contemporanea para espacos com identidade\b/,
  /\barquitetura contemporânea para espaços com identidade\b/,
  /\buma presenca digital clara para transformar visitantes em contatos\b/,
  /\buma presença digital clara para transformar visitantes em contatos\b/,
  /\beste conteudo e definitivo\b/,
  /\beste conteúdo é definitivo\b/,
  /\bcopy contextual\b/,
  /\bprimeira versao usa copy\b/,
  /\bprimeira versão usa copy\b/,
  /\bo formulario ja envia dados\b/,
  /\bo formulário já envia dados\b/,
  /\bsatisfacao placeholder\b/,
  /\bsatisfação placeholder\b/,
  /\banos de experiencia simulada\b/,
  /\banos de experiência simulada\b/,
];

const KNOWN_STALE_FALLBACK_BRANDS = [
  'Faber Projeto',
  'Escritório Faber Advocacia',
  'Escritorio Faber Advocacia',
  'Studio Habitat',
  'Helena Duarte',
  'Helena Duarte Arquitetura',
  'Atelier Couro Faber',
  'Maison Cacao',
  'maisoncacao.com',
  'Clínica Sorriso',
  'Clinica Sorriso',
];

function readWorkGraphBrand(workGraph = null) {
  if (!workGraph || typeof workGraph !== 'object') return '';
  const spec = workGraph.briefSpec && typeof workGraph.briefSpec === 'object'
    ? workGraph.briefSpec
    : null;
  const candidates = [
    spec && spec.brand,
    spec && spec.brandName,
    spec && spec.current && spec.current.brand,
    spec && spec.content && spec.content.brand,
    spec && spec.content && spec.content.brandName,
    spec && spec.temporaryBlueprintContract && spec.temporaryBlueprintContract.brandFallback,
    spec && spec.temporaryBlueprintContract && spec.temporaryBlueprintContract.domainLabel,
    workGraph && workGraph.workingBrief && workGraph.workingBrief.product && workGraph.workingBrief.product.brandFallback,
    workGraph && workGraph.product && workGraph.product.brandFallback,
  ];
  return candidates.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function inferExpectedArtifactBrand({ userMessage = '', workGraph = null } = {}) {
  return inferExplicitBrand(userMessage) || readWorkGraphBrand(workGraph) || '';
}

function splitBrandTokens(value = '') {
  return normalizeQualityText(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function artifactTextContainsBrand(normalizedText = '', brand = '') {
  const normalizedBrand = normalizeQualityText(brand);
  if (!normalizedBrand) return true;
  if (normalizedText.includes(normalizedBrand)) return true;
  const tokens = splitBrandTokens(normalizedBrand);
  if (!tokens.length) return false;
  const primaryToken = tokens[0];
  if (primaryToken && normalizedText.includes(primaryToken)) return true;
  return tokens.length > 1 && tokens.filter((token) => normalizedText.includes(token)).length >= 2;
}

function detectStaleFallbackBrands(normalizedText = '', expectedBrand = '', currentUserMessage = '') {
  const expectedTokens = new Set(splitBrandTokens(expectedBrand));
  const normalizedCurrentMessage = normalizeQualityText(currentUserMessage);
  return KNOWN_STALE_FALLBACK_BRANDS.filter((brand) => {
    const normalizedBrand = normalizeQualityText(brand);
    if (!normalizedBrand || !normalizedText.includes(normalizedBrand)) return false;
    if (normalizedCurrentMessage.includes(normalizedBrand)) return false;
    const brandTokens = splitBrandTokens(brand);
    return !brandTokens.some((token) => expectedTokens.has(token));
  });
}

function hasFinalContentExpectation(expectations = {}) {
  if (expectations.placeholderAuthorized) return false;
  const source = String(expectations.source || '');
  return Boolean(
    expectations.domain ||
      /\b(briefing completo|conteudo final|conteúdo final|conteudo especifico|conteúdo específico|conteudo que solicitei|conteúdo que solicitei|site completo|landing page|pagina final|página final|conteudo real|conteúdo real)\b/.test(source)
  );
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
    const nextBrowserGlobalFindings = expectations.next
      ? [
          ...findTopLevelNextBrowserGlobalAccess(nextPageContent, 'app/page.tsx'),
          ...findTopLevelNextBrowserGlobalAccess(nextLayoutContent, 'app/layout.tsx'),
        ].filter((finding) => finding.snippet)
      : [];
    const packageContent = readCandidateContent(writes, projectRootPath, ['package.json']);
    const cssContent = readCandidateContent(writes, projectRootPath, [
      'style.css',
      'styles.css',
      'app/globals.css',
      'src/app/globals.css',
      'styles/globals.css',
    ]);
    const jsContent = readCandidateContent(writes, projectRootPath, ['script.js', 'app.js']);
    const prismaSchemaContent = readCandidateContent(writes, projectRootPath, ['prisma/schema.prisma']);
    const filePaths = Array.from(new Set([
      ...Array.from(writes.keys()),
      ...collectExistingProjectFilePaths({ fs, path, projectRootPath }),
    ]));
    const domainFilePaths = filePaths.filter((relPath) => {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relPath)) return false;
      if (/(^|\/)(app|pages)\/.*\/?page\.(tsx|jsx|ts|js)$/i.test(relPath)) return false;
      if (/(^|\/)(app|pages)\/.*\/?layout\.(tsx|jsx|ts|js)$/i.test(relPath)) return false;
      if (/(^|\/)components?\//i.test(relPath)) return false;
      if (/(^|\/)(tailwind|postcss|next-env|next\.config|tsconfig)/i.test(relPath)) return false;
      return /(^|\/)(src\/)?(domain|services?|lib|store|models?|types?|schemas?|use-cases?|rules?|core)\//i.test(relPath);
    });
    const testFilePaths = filePaths.filter((relPath) => {
      return /(^|\/)(__tests__|tests?)\/|(\.|-)test\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relPath);
    });
    const domainContent = domainFilePaths
      .map((relPath) => readCandidateContent(writes, projectRootPath, [relPath]))
      .filter(Boolean)
      .join('\n');
    const testContent = testFilePaths
      .map((relPath) => readCandidateContent(writes, projectRootPath, [relPath]))
      .filter(Boolean)
      .join('\n');
    const merged = normalizeQualityText([htmlContent, phpContent, nextPageContent, nextLayoutContent, packageContent, cssContent, jsContent].join('\n'));
    const rawMerged = [htmlContent, phpContent, nextPageContent, nextLayoutContent, packageContent, cssContent, jsContent, prismaSchemaContent, domainContent, testContent].join('\n');
    const finalContentExpected = hasFinalContentExpectation(expectations);
    const expectedBrand = inferExpectedArtifactBrand({ userMessage, workGraph });
    const staleFallbackBrands = detectStaleFallbackBrands(merged, expectedBrand, userMessage);
    const forgeMrpContract = expectations.complexApp && expectations.complexApp.profile === 'forge_mrp'
      ? evaluateForgeMrpStaticContract({
          cssContent,
          domainContent,
          filePaths,
          nextLayoutContent,
          nextPageContent,
          packageContent,
          rawMerged,
          testContent,
        })
      : null;
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
    const staticPageFiles = Array.from(writes.keys())
      .filter((relPath) => /\.(html|htm)$/i.test(relPath))
      .map((relPath) => normalizeRouteId(relPath.replace(/\.(html|htm)$/i, '').replace(/\/index$/i, '')));
    if (hasIndexHtml && !staticPageFiles.includes('index')) staticPageFiles.push('index');
    if (expectations.editMode) {
      for (const existingPage of collectExistingStaticPageFiles({ fs, path, projectRootPath })) {
        if (!staticPageFiles.includes(existingPage)) staticPageFiles.push(existingPage);
      }
    }
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
      /\bexplorar\b/,
      /\bescolher\b/,
      /\bconhecer colecoes\b/,
    ]);
    const sectionFamilies = [
      [/\bservicos\b/, /\batendimentos\b/, /\bofertas\b/, /\bsolucoes\b/],
      [/\bcolecoes\b/, /\bprodutos\b/, /\bproduto\b/, /\bcat[aá]logo\b/, /\bbolsas\b/, /\bpastas\b/],
      [/\bchocolates?\b/, /\bcacau\b/, /\bbombons?\b/, /\bsabores\b/, /\btabletes?\b/],
      [/\bsobre\b/, /\bquem somos\b/, /\bhistoria\b/, /\batelier\b/, /\bequipe\b/],
      [/\bmetodo\b/, /\bprocesso\b/, /\bproducao\b/, /\bartesanal\b/, /\bpassos\b/],
      [/\bmateriais\b/, /\bmateria[-\s]prima\b/, /\bcouro\b/, /\bdurabilidade\b/, /\blongevidade\b/],
      [/\btemperagem\b/, /\bdo grao\b/, /\btextura\b/, /\bingredientes?\b/],
      [/\bdepoimentos\b/, /\bprova social\b/, /\bresultados\b/, /\bcredenciais\b/],
      [/\bfaq\b/, /\bperguntas\b/, /\bduvidas\b/, /\bcuidados\b/],
      [/\bgaleria\b/, /\bportfolio\b/, /\bprojetos\b/, /\breferencias\b/],
    ].filter((patterns) => hasAnyPattern(merged, patterns)).length;
    const nextRoutes = collectNextRouteIds(filePaths);
    const internalRouteLinks = extractInternalRouteLinks(rawMerged);
    const unresolvedInternalRouteLinks = internalRouteLinks.filter((route) => {
      if (nextRoutes.hasDynamicRoute) return false;
      return !nextRoutes.ids.has(route) && !nextRoutes.ids.has(route.split('/')[0]);
    });
    const domainRuleTokens = [
      /\bfunction\b|\bexport\s+(function|const|class|type|interface)\b/i,
      /\bthrow new error\b|\breturn\b|\bif\s*\(/i,
      /\bvalidate|validar|calculate|calcular|transition|transicao|transição|stock|estoque|audit|bom|order|pedido|estado\b/i,
    ].filter((pattern) => pattern.test(domainContent)).length;
    const uiOperationTokens = [
      /\b(onclick|onsubmit|usestate|usereducer)\b/i,
      /\b<form\b|\b<input\b|\b<select\b|\b<button\b/i,
      /\btable\b|\blist\b|\bfilter\b|\bsearch\b|\bdata-testid\b/i,
    ].filter((pattern) => pattern.test(rawMerged)).length;
    const testAssertionTokens = [
      /\b(assert|expect|test\s*\(|it\s*\(|describe\s*\()/i,
      /\bnegative|insuficiente|ciclo|transicao|transição|faltante|missing|audit|estoque|stock\b/i,
    ].filter((pattern) => pattern.test(testContent)).length;
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
        expectations.complexApp.enabled
          ? uiOperationTokens >= 2 && domainRuleTokens >= 1
          : hasHeroSection &&
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
      expectedBrandPresent: !expectedBrand || artifactTextContainsBrand(merged, expectedBrand),
      noStaleFallbackBrands: staleFallbackBrands.length === 0,
      noGenericPlaceholders:
        !hasAnyPattern(merged, [/\b(titulo principal|subtitulo|servico 1|servico 2|prova social curta|historia, diferenciais|lorem ipsum)\b/]) &&
        (
          expectations.placeholderAuthorized ||
          !hasAnyPattern(merged, GENERIC_VISIBLE_PLACEHOLDER_PATTERNS)
        ),
      cta:
        expectations.complexApp.enabled ||
        /\b(agendar|falar com|contato|marcar consulta|enviar mensagem|conversar|comprar|explorar|escolher|ver colecao|ver colecoes|conhecer sabores)\b/.test(merged),
      staticMultipageFiles:
        !expectations.staticMultipage ||
        staticPageFiles.length >= Math.max(2, expectations.requiredPageIds.length || 2),
      complexAppDomainLayer:
        !expectations.complexApp.enabled ||
        !expectations.complexApp.domainExpected ||
        (domainFilePaths.length >= 1 && domainRuleTokens >= 2),
      complexAppOperableUi:
        !expectations.complexApp.enabled ||
        uiOperationTokens >= 2,
      complexAppTests:
        !expectations.complexApp.enabled ||
        !expectations.complexApp.testsExpected ||
        (testFilePaths.length >= 1 && testAssertionTokens >= 2),
      forgeMrpStack:
        !forgeMrpContract ||
        forgeMrpContract.checks.stack,
      forgeMrpArchitecture:
        !forgeMrpContract ||
        forgeMrpContract.checks.architecture,
      forgeMrpBomExplosion:
        !forgeMrpContract ||
        forgeMrpContract.checks.mrpExplosion,
      forgeMrpBomCrudUi:
        !forgeMrpContract ||
        forgeMrpContract.checks.bomCrudUi,
      forgeMrpAuditTrail:
        !forgeMrpContract ||
        forgeMrpContract.checks.auditTrail,
      forgeMrpProductionRules:
        !forgeMrpContract ||
        forgeMrpContract.checks.productionRules,
      forgeMrpCriticalTests:
        !forgeMrpContract ||
        forgeMrpContract.checks.criticalTests,
      forgeMrpVisualSystem:
        !forgeMrpContract ||
        forgeMrpContract.checks.visualSystem,
      nextInternalRoutes:
        !expectations.next ||
        unresolvedInternalRouteLinks.length === 0,
      nextBrowserGlobals:
        !expectations.next ||
        nextBrowserGlobalFindings.length === 0,
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
    if (!checks.expectedBrandPresent) {
      addIssue(
        'expected_brand_missing',
        'critical',
        `A marca explícita "${expectedBrand}" não apareceu nos artefatos gerados.`,
        'Recalcule o blueprint a partir do briefing atual e preserve a marca explícita em layout, metadados e conteúdo visível.'
      );
    }
    if (!checks.noStaleFallbackBrands) {
      addIssue(
        'stale_fallback_brand',
        'critical',
        `Foram detectadas marcas de fallback antigo: ${staleFallbackBrands.join(', ')}.`,
        'Remova marcas antigas do contexto/memória e gere a entrega com a marca e domínio do briefing atual.'
      );
    }
    if (!checks.noGenericPlaceholders) {
      addIssue(
        'generic_placeholders',
        finalContentExpected ? 'critical' : 'warning',
        finalContentExpected
          ? 'Foram detectados placeholders genéricos em uma entrega que deveria usar conteúdo final do briefing.'
          : 'Foram detectados placeholders genéricos demais.',
        finalContentExpected
          ? 'Regere a entrega a partir do briefing consolidado; não aplique blueprint genérico com Faber Projeto, Studio Habitat ou conteúdo provisório.'
          : 'Troque textos como "Título principal" e "Serviço 1" por placeholders contextualizados.'
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
    if (!checks.staticMultipageFiles) {
      addIssue(
        'static_multipage_files',
        'critical',
        `Pedido multipágina estático gerou ${staticPageFiles.length} arquivo(s) HTML, mas esperava pelo menos ${Math.max(2, expectations.requiredPageIds.length || 2)}.`,
        'Gere arquivos HTML reais para cada página/rota solicitada e conecte o menu entre eles.'
      );
    }
    if (!checks.complexAppDomainLayer) {
      addIssue(
        'complex_app_domain_layer',
        'critical',
        'App complexo foi reduzido a superfície visual; não há camada de domínio/serviços com regras verificáveis.',
        'Crie módulos livres de domínio, services, lib, store ou core com modelos, validações, cálculos e transições fora do componente visual.'
      );
    }
    if (!checks.complexAppOperableUi) {
      addIssue(
        'complex_app_operable_ui',
        'critical',
        'App complexo não expõe uma fatia operável na UI; parece dashboard estático ou landing page.',
        'Entregue uma UI que permita executar ao menos um fluxo real do domínio: formulário, ação de estado, cálculo, filtro, tabela ou movimentação.'
      );
    }
    if (!checks.complexAppTests) {
      addIssue(
        'complex_app_tests',
        'critical',
        'O briefing pediu testes/regras críticas, mas não há teste de domínio detectável.',
        'Adicione testes unitários ou validações locais para regras críticas, sem prender a arquitetura a um scaffold específico.'
      );
    }
    if (!checks.forgeMrpStack) {
      addIssue(
        'forge_mrp_stack',
        'critical',
        'Forge MRP não trouxe a stack contratada do briefing.',
        'Inclua Next/App Router, React, Tailwind, Prisma/Postgres, Zod, Vitest, Playwright, React Hook Form, TanStack Table, Zustand e date-fns no package/schema.'
      );
    }
    if (!checks.forgeMrpArchitecture) {
      addIssue(
        'forge_mrp_architecture',
        'critical',
        'Forge MRP foi reduzido a página/classe local sem arquitetura de domínio, serviço e persistência.',
        'Crie prisma/schema.prisma, camada src/domain para regras puras, camada src/services/use-cases para operações e schemas Zod fora da UI.'
      );
    }
    if (!checks.forgeMrpBomExplosion) {
      addIssue(
        'forge_mrp_bom_explosion',
        'critical',
        'Cálculo MRP não comprova explosão multinível da BOM para gerar necessidades de componentes.',
        'Implemente explodeBom/calculateMaterialRequirements recursivo/iterativo com quantidade por componente, lead time, lote, estoque de segurança e faltantes.'
      );
    }
    if (!checks.forgeMrpBomCrudUi) {
      addIssue(
        'forge_mrp_bom_crud_ui',
        'critical',
        'A UI não expõe cadastro operacional completo de BOM/revisões/componentes.',
        'Inclua formulário editável de BOM com componente, quantidade por unidade, revisão ativa e ações adicionar/editar/remover.'
      );
    }
    if (!checks.forgeMrpAuditTrail) {
      addIssue(
        'forge_mrp_audit_trail',
        'critical',
        'Audit log do Forge MRP não comprova trilha imutável com before/after, usuário/origem e append-only.',
        'Modele AuditEntry com before/after, actor/origin, timestamp e use append-only nas operações de domínio.'
      );
    }
    if (!checks.forgeMrpProductionRules) {
      addIssue(
        'forge_mrp_production_rules',
        'critical',
        'Ordens/estoque não comprovam máquina de estados e movimentações atômicas sem saldo negativo.',
        'Modele estados Rascunho/Validado/Em Produção/Finalizado/Cancelado, bloqueie transições inválidas e consuma/reserve estoque atomicamente.'
      );
    }
    if (!checks.forgeMrpCriticalTests) {
      addIssue(
        'forge_mrp_critical_tests',
        'critical',
        'Testes do Forge MRP não cobrem os casos críticos do briefing.',
        'Adicione testes Vitest para BOM multinível, faltantes exatos, ciclo de BOM, saldo negativo, transição inválida, auditoria e validação Zod.'
      );
    }
    if (!checks.forgeMrpVisualSystem) {
      addIssue(
        'forge_mrp_visual_system',
        'critical',
        'Visual do Forge MRP não comprova tema escuro, fonte Assistant e layout operacional refinado.',
        'Use Assistant por variável CSS local/offline ou next/font quando houver rede, shell escuro com container/aside/nav, KPIs, tabelas densas, estados e Tailwind responsivo.'
      );
    }
    if (!checks.nextInternalRoutes) {
      addIssue(
        'next_internal_routes',
        'critical',
        `Links internos sem rota Next.js correspondente: ${unresolvedInternalRouteLinks.join(', ')}.`,
        'Crie as rotas reais referenciadas ou troque links quebrados por controles internos operáveis.'
      );
    }
    if (!checks.nextBrowserGlobals) {
      const firstFinding = nextBrowserGlobalFindings[0];
      addIssue(
        'next_browser_globals',
        'critical',
        `Next.js usa API de navegador em escopo de módulo (${firstFinding.file}:${firstFinding.line}).`,
        'Mova document/window/localStorage para useEffect ou handlers dentro de componente client; para estilos, use app/globals.css ou classes Tailwind.'
      );
    }

    const weights = {
      stackEntry: expectations.lamp || expectations.next ? 18 : 0,
      tailwindStack: expectations.tailwind ? 12 : 0,
      requiredSections: 18,
      cssSubstantial: 20,
      responsive: 12,
      contentSpecific: expectations.domain ? 14 : 8,
      expectedBrandPresent: expectedBrand ? 12 : 0,
      noStaleFallbackBrands: finalContentExpected || staleFallbackBrands.length ? 12 : 0,
      noGenericPlaceholders: 14,
      cta: 12,
      staticMultipageFiles: expectations.staticMultipage ? 16 : 0,
      complexAppDomainLayer: expectations.complexApp.enabled && expectations.complexApp.domainExpected ? 22 : 0,
      complexAppOperableUi: expectations.complexApp.enabled ? 18 : 0,
      complexAppTests: expectations.complexApp.enabled && expectations.complexApp.testsExpected ? 18 : 0,
      forgeMrpStack: forgeMrpContract ? 18 : 0,
      forgeMrpArchitecture: forgeMrpContract ? 18 : 0,
      forgeMrpBomExplosion: forgeMrpContract ? 20 : 0,
      forgeMrpBomCrudUi: forgeMrpContract ? 16 : 0,
      forgeMrpAuditTrail: forgeMrpContract ? 16 : 0,
      forgeMrpProductionRules: forgeMrpContract ? 16 : 0,
      forgeMrpCriticalTests: forgeMrpContract ? 18 : 0,
      forgeMrpVisualSystem: forgeMrpContract ? 18 : 0,
      nextInternalRoutes: expectations.next ? 12 : 0,
      nextBrowserGlobals: expectations.next ? 16 : 0,
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
      expectedBrand,
      briefingAdherence,
      metrics: {
        cssBytes: cssContent.trim().length,
        cssRules,
        layoutTokens,
        visualTokens,
        tailwindUtilityTokens,
        htmlBytes: htmlContent.trim().length || phpContent.trim().length,
        domainFiles: domainFilePaths.length,
        testFiles: testFilePaths.length,
        unresolvedInternalRouteLinks: unresolvedInternalRouteLinks.length,
        nextBrowserGlobalFindings: nextBrowserGlobalFindings.length,
        forgeMrp: forgeMrpContract ? forgeMrpContract.metrics : null,
      },
      hasIndexHtml,
      hasIndexPhp,
      hasNextPage,
      hasNextLayout,
      complexApp: expectations.complexApp,
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

    const lines = expectations.complexApp && expectations.complexApp.enabled
      ? [
          'Diretrizes de qualidade para app complexo:',
          '- Entregue uma fatia vertical executável, não landing page, dashboard estático ou vitrine visual.',
          '- A interface deve operar dados reais do domínio: formulário, ação de estado, cálculo, tabela, filtro ou movimentação.',
          '- O CSS deve ser substancial para a ferramenta: layout, densidade, estados, tabelas/formulários e responsividade.',
          '- Inclua regra responsiva com @media, clamp(...) ou minmax(...).',
        ]
      : [
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
      lines.push('- Em Next.js/App Router, não use document, window, localStorage, sessionStorage ou navigator em escopo de módulo; para CSS use app/globals.css/Tailwind e, para APIs do navegador, use useEffect/handlers dentro de componente client.');
    }
    if (expectations.tailwind) {
      lines.push('- Como o pedido usa Tailwind, inclua dependências/configuração mínima e classes utilitárias responsivas no JSX.');
    }
    if (expectations.complexApp && expectations.complexApp.enabled) {
      lines.push(
        '- Contrato de app complexo: escolha livremente a arquitetura, mas entregue uma fatia vertical executável, não um template estático.',
        '- Separe regras críticas da UI em domínio/services/lib/store/core; a UI pode chamar essas regras, mas não deve ser a única fonte de verdade.',
        '- Links internos precisam apontar para rotas reais ou virar controles internos operáveis; não deixe CTA levando para 404.',
        '- Se o briefing pedir testes, inclua testes unitários ou validações locais para regras críticas do domínio.'
      );
    }
    if (expectations.complexApp && expectations.complexApp.profile === 'forge_mrp') {
      lines.push(
        '- Forge MRP obrigatório: não entregue casca em memória. Use Next/App Router, React, Tailwind, Prisma/Postgres, Zod, Vitest, Playwright, React Hook Form, TanStack Table, Zustand e date-fns quando o briefing pedir essa stack.',
        '- Forge MRP obrigatório: modele prisma/schema.prisma, src/domain com regras puras, src/services/use-cases com operações, schemas Zod e testes Vitest.',
        '- Forge MRP obrigatório: o cálculo deve explodir BOM multinível para componentes, considerando quantidade por componente, lead time, lote, estoque de segurança, saldo e faltantes/sugestões de compra.',
        '- Forge MRP obrigatório: a UI precisa permitir CRUD de itens, BOM/revisões/componentes, movimentações de estoque, ordens com máquina de estados, execução de MRP e audit log.',
        '- Forge MRP obrigatório: audit log append-only com timestamp, entidade, ação, usuário/origem, before/after e payload; estoque nunca pode ficar negativo.',
        '- Forge MRP obrigatório: visual operacional escuro com fonte Assistant via variável CSS local/offline ou next/font quando houver rede, shell com container/aside/nav, KPIs, tabelas densas, estados e Tailwind responsivo.'
      );
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
  inferComplexAppContract,
  isNarrowContentEditRequest,
  normalizeQualityText,
};
