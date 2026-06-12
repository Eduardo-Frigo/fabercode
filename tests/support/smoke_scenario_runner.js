const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');

const { createAutomataExecutor } = require('../../cortex/automata/core/executor');
const {
  LEDGER_STATUSES,
  createAutomataContractLedgerService,
} = require('../../cortex/orchestration/automata_contract_ledger_service');
const { createProductOrchestratorService } = require('../../cortex/orchestration/product_orchestrator_service');
const { createProjectBlueprintService } = require('../../cortex/orchestration/project_blueprint_service');
const { createDeterministicEditService } = require('../../main/services/deterministic_edit_service');
const { createFaberCapabilityAdapterService } = require('../../main/services/faber_capability_adapter_service');
const { createMemoryEvidenceLedgerService } = require('../../main/services/memory_evidence_ledger_service');
const { createProjectPreviewService } = require('../../main/services/project_preview_service');
const { createProjectScanner } = require('../../main/services/project_scanner');
const { createProjectVisualValidationRuntimeService } = require('../../main/services/project_visual_validation_runtime_service');
const { buildOperationBatchDiffPreview } = require('../../main/runtime/diff_preview');

function normalizeSmokeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function writeExternalMcpVisualArtifact(filePath, { width = 640, height = 360 } = {}) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      const inHeader = y < 72;
      const inHero = y >= 96 && y < 246 && x > 40 && x < width - 40;
      const inPanel = y >= 265 && y < 330 && x > 80 && x < width - 80;
      png.data[idx] = inHeader ? 17 : inHero ? 36 : inPanel ? 235 : 8;
      png.data[idx + 1] = inHeader ? 45 : inHero ? 130 : inPanel ? 196 : 13;
      png.data[idx + 2] = inHeader ? 82 : inHero ? 111 : inPanel ? 84 : 28;
      png.data[idx + 3] = 255;
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function analyzePngArtifact(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  const colors = new Set();
  let opaquePixels = 0;
  for (let y = 0; y < png.height; y += 18) {
    for (let x = 0; x < png.width; x += 18) {
      const idx = (png.width * y + x) << 2;
      if (png.data[idx + 3] > 0) opaquePixels += 1;
      colors.add(`${png.data[idx]},${png.data[idx + 1]},${png.data[idx + 2]},${png.data[idx + 3]}`);
    }
  }
  return {
    width: png.width,
    height: png.height,
    uniqueSampledColors: colors.size,
    opaquePixels,
    blankLikely: colors.size < 3 || opaquePixels === 0,
  };
}

function normalizeRequestedRelativePath(value) {
  const text = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const normalized = path.posix.normalize(text);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') return '';
  return normalized;
}

function assertSafeRelativePath(relPath) {
  const normalized = normalizeRequestedRelativePath(relPath);
  assert.ok(normalized, `operation path should be safe: ${relPath || '<empty>'}`);
  assert.strictEqual(path.isAbsolute(normalized), false, `operation path must be relative: ${normalized}`);
  assert.strictEqual(normalized.includes('\0'), false, `operation path must not contain null bytes: ${normalized}`);
  return normalized;
}

function computeLineChangeStats(previous, next) {
  const previousLines = String(previous || '').split('\n');
  const nextLines = String(next || '').split('\n');
  return {
    added: Math.max(0, nextLines.length - previousLines.length),
    removed: Math.max(0, previousLines.length - nextLines.length),
  };
}

function mergeDiffStatsEntry(target, file, stats) {
  target[file] = stats;
}

function validateExecutionCommand(command) {
  if (!command || !command.root_path) return { ok: false, message: 'root_path ausente' };
  if (!['apply_file_patch', 'search_text_in_files', 'execute_operation_batch'].includes(command.task_type)) {
    return { ok: false, message: 'task_type invalido' };
  }
  return { ok: true };
}

function createSmokeAutomataExecutor() {
  return createAutomataExecutor({
    computeLineChangeStats,
    fs,
    hashText,
    isTextLikeExtension: (ext) =>
      ['.txt', '.md', '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.scss', '.php'].includes(ext),
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff: normalizeRequestedRelativePath,
    normalizeRequestedRelativePath,
    path,
    validateExecutionCommand,
  });
}

function writeLocalBin(rootPath, name) {
  const target = path.join(rootPath, 'node_modules', '.bin', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '#!/usr/bin/env node\n', 'utf8');
  const packagePath = path.join(rootPath, 'node_modules', name, 'package.json');
  fs.mkdirSync(path.dirname(packagePath), { recursive: true });
  fs.writeFileSync(packagePath, `${JSON.stringify({ name, version: '0.0.0-smoke' }, null, 2)}\n`, 'utf8');
}

function collectFileHashes(rootPath, files = []) {
  const hashes = {};
  for (const relPath of files) {
    const safeRelPath = normalizeRequestedRelativePath(relPath);
    if (!safeRelPath) continue;
    const absPath = path.join(rootPath, safeRelPath);
    if (!fs.existsSync(absPath)) continue;
    hashes[safeRelPath] = hashText(fs.readFileSync(absPath, 'utf8'));
  }
  return hashes;
}

function assertGeneratedNextPageResponsiveSurface(blueprint) {
  const operations = blueprint && blueprint.action && Array.isArray(blueprint.action.operations)
    ? blueprint.action.operations
    : [];
  const pageOperation = operations.find((operation) => operation && operation.path === 'app/page.tsx');
  if (!pageOperation || typeof pageOperation.content !== 'string') return;
  assert.ok(
    pageOperation.content.includes('overflow-x-hidden'),
    'Next blueprint home page must prevent horizontal overflow at the page shell'
  );
  assert.ok(
    pageOperation.content.includes('data-blueprint-element="responsive-header"'),
    'Next blueprint home page must render the responsive header primitive'
  );
  assert.ok(
    pageOperation.content.includes('max-h-[calc(100vh-5rem)]') &&
      pageOperation.content.includes('overflow-y-auto'),
    'Next blueprint mobile menu must remain scrollable on compact mobile/tablet screens'
  );
  assert.ok(
    pageOperation.content.includes('<BlueprintIconBadge path=') &&
      pageOperation.content.includes('data-blueprint-element="icon-badge"'),
    'Next blueprint service icons must use the shared icon badge primitive'
  );
  assert.ok(
    pageOperation.content.includes('<BlueprintTestimonialProof testimonials=') &&
      pageOperation.content.includes('data-blueprint-element="testimonial-proof"'),
    'Next blueprint testimonials must use the shared responsive proof primitive'
  );
  assert.ok(
    pageOperation.content.includes('<BlueprintFooterUtility brand=') &&
      pageOperation.content.includes('data-blueprint-element="footer-utility-grid"'),
    'Next blueprint footer must use the shared footer utility grid primitive'
  );
  const heroHeadingMatch = pageOperation.content.match(/<h1 className="([^"]+)"/);
  assert.ok(heroHeadingMatch, 'Next blueprint home page must render a hero h1');
  const heroHeadingClass = heroHeadingMatch[1];
  assert.ok(heroHeadingClass.includes('break-words'), 'Next blueprint hero h1 must allow word wrapping');
  assert.ok(heroHeadingClass.includes('[overflow-wrap:anywhere]'), 'Next blueprint hero h1 must force safe mobile wrapping');
  assert.ok(heroHeadingClass.includes('text-3xl'), 'Next blueprint hero h1 must start with a mobile-safe type scale');
  const blueprintMeta = blueprint.action.blueprint || {};
  const layoutRecipe = blueprintMeta.layoutRecipe && typeof blueprintMeta.layoutRecipe === 'object'
    ? blueprintMeta.layoutRecipe
    : {};
  const media = blueprintMeta.media && typeof blueprintMeta.media === 'object' ? blueprintMeta.media : null;
  if (layoutRecipe.hero === 'full-bleed-media' && media) {
    assert.ok(
      pageOperation.content.includes('relative isolate'),
      'Full-bleed blueprint hero must be the top-level immersive hero surface'
    );
    assert.ok(
      pageOperation.content.includes('absolute inset-0 z-0 h-full w-full object-cover'),
      'Full-bleed blueprint hero media must cover the top hero, not render as a split-column preview'
    );
  }
}

function createProjectInfo(rootPath, overrides = {}) {
  return {
    id: path.basename(rootPath),
    rootPath,
    files: [],
    stacks: [],
    totalFiles: 0,
    counters: {},
    ...overrides,
  };
}

function createProductService({ blueprintService, deterministicService, provider = 'deterministic', overrides = {} } = {}) {
  return createProductOrchestratorService({
    getSelectedAiProvider: () => provider,
    shouldPreferProjectBlueprint: blueprintService.shouldPreferProjectBlueprint,
    extractRequestedTitle: deterministicService.extractRequestedTitle,
    isBackgroundColorEditRequest: deterministicService.isBackgroundColorEditRequest,
    isButtonColorEditRequest: deterministicService.isButtonColorEditRequest,
    isCardTextEditRequest: deterministicService.isCardTextEditRequest,
    isCtaTextEditRequest: deterministicService.isCtaTextEditRequest,
    isFaqItemPatchRequest: deterministicService.isFaqItemPatchRequest,
    isFooterInsertRequest: deterministicService.isFooterInsertRequest,
    isFormFieldPatchRequest: deterministicService.isFormFieldPatchRequest,
    isGridColumnsEditRequest: deterministicService.isGridColumnsEditRequest,
    isHeroMediaPatchRequest: deterministicService.isHeroMediaPatchRequest,
    isHeadingColorEditRequest: deterministicService.isHeadingColorEditRequest,
    isHydrationMismatchRepairRequest: deterministicService.isHydrationMismatchRepairRequest,
    isLiteralColorReplacementRequest: deterministicService.isLiteralColorReplacementRequest,
    isNavLinkEditRequest: deterministicService.isNavLinkEditRequest,
    isSecondaryCtaEditRequest: deterministicService.isSecondaryCtaEditRequest,
    isSectionRemoveRequest: deterministicService.isSectionRemoveRequest,
    isSectionReorderRequest: deterministicService.isSectionReorderRequest,
    isStatTextPatchRequest: deterministicService.isStatTextPatchRequest,
    isThemeColorEditRequest: deterministicService.isThemeColorEditRequest,
    isTypographyEditRequest: deterministicService.isTypographyEditRequest,
    ...overrides,
  });
}

function createSmokeHarness(tempRoot) {
  const blueprintService = createProjectBlueprintService();
  const deterministicService = createDeterministicEditService({
    fs,
    path,
    buildOperationBatchDiffPreview,
  });
  const previewService = createProjectPreviewService({ fs, path });
  const scanner = createProjectScanner({ fs, path });
  const executor = createSmokeAutomataExecutor();
  const productService = createProductService({ blueprintService, deterministicService });

  function createScenarioRoot(id) {
    const rootPath = path.join(tempRoot, id);
    fs.mkdirSync(rootPath, { recursive: true });
    return rootPath;
  }

  function applyOperations(rootPath, operations = []) {
    for (const operation of operations) {
      assertSafeRelativePath(operation && operation.path);
    }
    fs.mkdirSync(rootPath, { recursive: true });
    const result = executor.executeOperationBatchAction({ rootPath, operations });
    assert.strictEqual(result.ok, true, result.message);
    assert.strictEqual(result.transactional, true, 'smoke writes must go through transactional Automata executor');
    return result;
  }

  function scanProject(rootPath, overrides = {}) {
    return {
      id: path.basename(rootPath),
      ...scanner.scanProject(rootPath),
      ...overrides,
    };
  }

  function readFile(rootPath, relPath) {
    return fs.readFileSync(path.join(rootPath, assertSafeRelativePath(relPath)), 'utf8');
  }

  function buildBlueprintFromRoute(rootPath, route, mediaAssets = {}) {
    const projectInfo = createProjectInfo(rootPath);
    const blueprint = blueprintService.buildProjectBlueprintOperationBatch({
      projectInfo,
      userMessage: route.executionMessage,
      executionIntent: 'init_project',
      force: true,
      workingBrief: route.workingBrief,
      buildModeRoute: route.buildModeRoute,
      buildOperationBatchDiffPreview,
      mediaAssets,
    });
    assert.ok(blueprint && blueprint.ok, 'blueprint should be generated for smoke scenario');
    assertGeneratedNextPageResponsiveSurface(blueprint);
    return blueprint;
  }

  return {
    applyOperations,
    blueprintService,
    buildBlueprintFromRoute,
    createScenarioRoot,
    deterministicService,
    executor,
    previewService,
    productService,
    readFile,
    scanProject,
    tempRoot,
    writeLocalBin,
  };
}

async function runGreenhouseCreatePreviewScenario(harness) {
  const rootPath = harness.createScenarioRoot('greenhouse-create-preview');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Quero criar uma landing page em Next.js para venda de estufas agricolas.',
      'Preciso de hero video full width, verde profundo, cultivo protegido, viveiros e formulario de orcamento.',
    ].join(' '),
    conversationMessages: [
      { role: 'user', text: 'Antes eu pedi algo para Clinica Sorriso.' },
      { role: 'assistant', text: 'A primeira versao ficou odontologica e generica.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.mode, 'faber_blueprint');
  assert.strictEqual(route.workingBrief.product.domain, 'greenhouses');
  assert.notStrictEqual(route.workingBrief.product.domain, 'dental');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'video',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://videos.pexels.com/video-files/greenhouse-smoke.mp4',
      poster: 'https://images.pexels.com/photos/greenhouse-smoke.jpeg',
      alt: 'Modern greenhouse farming',
      attribution: 'Video de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/video/greenhouse-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'greenhouses');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'agri-commercial-landing');

  const execution = harness.applyOperations(rootPath, blueprint.action.operations);
  const projectInfo = harness.scanProject(rootPath);
  assert.ok(execution.modifiedFiles.includes('package.json'));
  assert.ok(execution.modifiedFiles.includes('app/page.tsx'));
  assert.ok(projectInfo.stacks.includes('Next.js'));
  assert.ok(projectInfo.stacks.includes('Tailwind CSS'));

  const generatedText = normalizeSmokeText([
    harness.readFile(rootPath, 'app/page.tsx'),
    harness.readFile(rootPath, 'app/layout.tsx'),
    harness.readFile(rootPath, 'app/globals.css'),
  ].join('\n'));
  assert.match(generatedText, /(estufa|greenhouse|cultivo protegido|protected cultivation)/);
  assert.doesNotMatch(generatedText, /(clinica sorriso|odontolog|dental clinic)/);

  const blockedPreview = harness.previewService.buildProjectPreviewPlan(projectInfo, { port: 3021 });
  assert.strictEqual(blockedPreview.ready, false);
  assert.ok(blockedPreview.steps.some((step) => step.id === 'preview_dependencies' && step.commandText === 'npm install'));

  harness.writeLocalBin(rootPath, 'next');
  const readyPreview = harness.previewService.buildProjectPreviewPlan(projectInfo, { port: 3021 });
  assert.strictEqual(readyPreview.ready, true);
  assert.strictEqual(readyPreview.commandText, 'npm run dev -- --hostname 127.0.0.1 --port 3021');
  assert.strictEqual(readyPreview.url, 'http://127.0.0.1:3021/');

  return {
    files: execution.modifiedFiles.length,
    preview: readyPreview.status,
    route: route.meta.reason,
  };
}

async function runGardeningOverridesStaleGreenhouseScenario(harness) {
  const rootPath = harness.createScenarioRoot('gardening-overrides-stale-greenhouse');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Crie um site completo de jardinagem com serviços de paisagismo, loja de produtos, blog educativo, galeria e contato.',
      'O conteúdo deve falar de plantas internas, plantas para apartamento, vasos, substratos, fertilizantes e cuidados com plantas.',
    ].join(' '),
    conversationMessages: [
      { role: 'user', text: 'Antes eu pedi estufas agrícolas e cultivo protegido.' },
      { role: 'assistant', text: 'A versão anterior ficou focada em Estufas Protegidas.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.workingBrief.product.domain, 'gardening');
  assert.notStrictEqual(route.workingBrief.product.domain, 'greenhouses');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/garden-smoke.jpeg',
      alt: 'Home garden landscaping',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/garden-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'gardening');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'garden-service-commerce');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.passes, true);
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.covered.routeNavigation, true);
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.covered.sectionDepth, true);
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.covered.testimonialDepth, true);
  assert.ok(blueprint.action.operations.some((operation) => operation.path === 'app/sobre/page.tsx'));
  assert.ok(blueprint.action.operations.some((operation) => operation.path === 'app/loja/page.tsx'));
  assert.ok(blueprint.action.operations.some((operation) => operation.path === 'app/blog/page.tsx'));
  assert.ok(blueprint.action.operations.some((operation) => operation.path === 'app/portfolio/page.tsx'));
  harness.applyOperations(rootPath, blueprint.action.operations);

  const homePage = harness.readFile(rootPath, 'app/page.tsx');
  assert.ok(homePage.includes("routeHref('/loja'"));
  assert.ok(homePage.includes('routeHref(blogRoute') && homePage.includes("'/blog'"));
  assert.ok(homePage.includes('routeHref(galleryRoute') && homePage.includes("'/portfolio'"));
  assert.ok(homePage.includes('testimonials.map'));
  const generatedText = normalizeSmokeText([
    homePage,
    harness.readFile(rootPath, 'app/layout.tsx'),
  ].join('\n'));
  assert.match(generatedText, /(jardinagem|paisagismo|plantas|jardim vivo|loja de jardinagem|dicas de jardinagem|galeria verde)/);
  assert.doesNotMatch(generatedText, /(estufas protegidas|cultivo protegido|modelos de estufas)/);

  return {
    domain: route.workingBrief.product.domain,
    route: route.meta.reason,
  };
}

async function runLongBriefingCreateNotSearchScenario(harness) {
  const rootPath = harness.createScenarioRoot('long-briefing-create-not-search');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Tudo sim, quero inclusive criar um site completo de jardinagem.',
      'O site deve ajudar o visitante a encontrar rapidamente informações sobre jardinagem, serviços, produtos e formas de contato.',
      'Precisa apresentar serviços, loja de produtos, blog educativo, galeria, depoimentos, CTA para orçamento, WhatsApp e formulário.',
      'Exemplo de texto: Cuidar de plantas pode ser simples, prazeroso e transformar qualquer ambiente em um espaço vivo.',
    ].join(' '),
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.notStrictEqual(route.meta.reason, 'search_project_intent');
  assert.strictEqual(route.workingBrief.product.domain, 'gardening');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/garden-long-brief-smoke.jpeg',
      alt: 'Garden long briefing smoke',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/garden-long-brief-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.covered.routeNavigation, true);
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.covered.footerSocial, true);
  harness.applyOperations(rootPath, blueprint.action.operations);
  const page = harness.readFile(rootPath, 'app/page.tsx');
  assert.ok(page.includes("routeHref('/loja'"));
  assert.ok(page.includes('routeHref(blogRoute') && page.includes("'/blog'"));
  assert.ok(page.includes('testimonials.map'));

  return {
    domain: route.workingBrief.product.domain,
    route: route.meta.reason,
  };
}

async function runImportServicesLandingScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-30-import-services');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing Completo: criar landing page de importação para captação de leads.',
      'A página deve explicar importação de produtos, consultoria em importação, cotação internacional, fornecedores, documentação, logística internacional, desembaraço aduaneiro e WhatsApp.',
      'Precisa ter hero, CTA Solicitar cotação, serviços, como funciona, tipos de importação, diferenciais, prova social, formulário completo com produto, país de origem, quantidade, objetivo da importação, FAQ e footer.',
    ].join(' '),
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.workingBrief.product.domain, 'import-services');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: 'international shipping containers port logistics cargo',
      src: 'https://images.pexels.com/photos/import-smoke.jpeg',
      alt: 'Containers em porto internacional',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/import-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'import-services');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'import-service-landing');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  harness.applyOperations(rootPath, blueprint.action.operations);

  const pageText = normalizeSmokeText(harness.readFile(rootPath, 'app/page.tsx'));
  assert.match(pageText, /(importe produtos com seguranca|consultoria em importacao|cotacao internacional|logistica internacional|solicitar analise de importacao|produto que deseja importar|pais de origem|quantidade estimada|objetivo da importacao|falar no whatsapp)/);
  assert.doesNotMatch(pageText, /(faber projeto|atendimento placeholder premium|conteudo provisorio|pronta para evoluir|studio habitat)/);

  return {
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
  };
}

async function runHelenaArchitectureSiteScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-31-helena-architecture');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing Completo: desenvolver site completo para Helena Duarte Arquitetura.',
      'O site deve ter múltiplas páginas: Início, Sobre, Serviços, Projetos, Processo, Insights e Contato.',
      'Hero com vídeo full width, arquitetura contemporânea para espaços com identidade, apresentação da Arq. Helena Duarte, manifesto, serviços, vídeo no corpo, cases, processo, diferenciais, depoimentos, CTA final e formulário de contato.',
    ].join(' '),
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.workingBrief.product.domain, 'architecture');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'video',
      provider: 'pexels',
      query: 'luxury contemporary architecture interiors design studio',
      src: 'https://videos.pexels.com/video-files/architecture-smoke.mp4',
      poster: 'https://images.pexels.com/photos/architecture-smoke.jpeg',
      alt: 'Ambiente arquitetônico contemporâneo',
      attribution: 'Video de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/video/architecture-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'architecture');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'architecture-studio-site');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  [
    'app/sobre/page.tsx',
    'app/servicos/page.tsx',
    'app/projetos/page.tsx',
    'app/processo/page.tsx',
    'app/insights/page.tsx',
    'app/contato/page.tsx',
  ].forEach((relPath) => {
    assert.ok(blueprint.action.operations.some((operation) => operation.path === relPath), `missing route ${relPath}`);
  });
  harness.applyOperations(rootPath, blueprint.action.operations);

  const pageText = normalizeSmokeText(harness.readFile(rootPath, 'app/page.tsx'));
  assert.match(pageText, /(helena duarte arquitetura|arquitetura contemporanea para espacos com identidade|projetos selecionados|insights de arquitetura|residencia jardim europa|clinica aurora|solicitar proposta)/);
  assert.match(pageText, /<video/);
  assert.doesNotMatch(pageText, /(faber projeto|atendimento placeholder premium|conteudo provisorio|pronta para evoluir|studio habitat)/);

  return {
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
    routes: 6,
  };
}

async function runAureaIpPatentesScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-32-aurea-ip-patentes');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing — Landing Page Institucional',
      'Escritório de Patentes: Aurea IP & Patentes',
      'Criar uma landing page sofisticada, confiável e internacional para apresentar um escritório especializado em registro de patentes, marcas, desenhos industriais e proteção de propriedade intelectual no Brasil e no exterior.',
      'A página deve transmitir autoridade, segurança jurídica, inovação e atendimento consultivo.',
      'Estrutura obrigatória: header, hero section com vídeo full width, apresentação, especialista Helena Duarte em propriedade intelectual, serviços, atuação global, carrossel de países, processo, diferenciais, chamada final, contato e footer escuro.',
      'Serviços: busca de anterioridade, redação de pedido de patente, depósito e acompanhamento, registro de marcas, proteção internacional e consultoria para startups e empresas.',
      'Use conteúdo específico final, sem placeholder genérico.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: Studio Habitat e Helena Duarte Arquitetura.' },
      { role: 'assistant', text: 'A versão anterior também usou Escritório Faber Advocacia e uma presença digital clara para transformar visitantes em contatos.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.product.domain, 'intellectual-property');
  assert.strictEqual(route.workingBrief.product.brandFallback, 'Aurea IP & Patentes');
  assert.notStrictEqual(route.workingBrief.product.domain, 'architecture');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'video',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://videos.pexels.com/video-files/ip-patent-smoke.mp4',
      poster: 'https://images.pexels.com/photos/ip-patent-smoke.jpeg',
      alt: 'Escritório de propriedade intelectual com documentos técnicos',
      attribution: 'Video de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/video/ip-patent-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'intellectual-property');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.hero, 'full-bleed-media');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  harness.applyOperations(rootPath, blueprint.action.operations);

  const generatedText = normalizeSmokeText([
    harness.readFile(rootPath, 'app/page.tsx'),
    harness.readFile(rootPath, 'app/layout.tsx'),
  ].join('\n'));
  assert.match(generatedText, /(aurea ip & patentes|protecao estrategica para ideias|busca de anterioridade|redacao de pedido de patente|registro de marcas|protecao internacional|tipo de protecao)/);
  assert.match(harness.readFile(rootPath, 'app/page.tsx'), /<video/);
  assert.doesNotMatch(generatedText, /(escritorio faber advocacia|uma presenca digital clara|atendimento placeholder premium|studio habitat|helena duarte arquitetura|arquitetura contemporanea para espacos com identidade)/);

  return {
    brand: route.workingBrief.product.brandFallback,
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
  };
}

async function runLineaBoscoRevestimentosScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-33-linea-bosco-revestimentos');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing — Site Completo',
      'Empresa: Linea Bosco Revestimentos',
      'Criar um site completo, elegante e minimalista para uma empresa especializada em pisos de madeira, painéis ripados, decks, revestimentos naturais e acabamentos arquitetônicos de alto padrão.',
      'O site deve transmitir sofisticação, confiança, cuidado artesanal e precisão técnica, valorizando textura da madeira e aplicações em ambientes residenciais, comerciais e corporativos.',
      'Páginas principais: Home, Sobre a Linea Bosco, Produtos, Pisos de Madeira, Painéis Ripados e Revestimentos, Decks e Áreas Externas, Projetos, Inspirações e Contato / Orçamento.',
      'Componentes obrigatórios: categorias de produtos, projetos em destaque, carrossel de texturas, suporte técnico para arquitetos, sustentabilidade, formulário de orçamento e footer escuro.',
      'Texturas e madeiras: carvalho natural, nogueira, cumaru, freijó, tauari, ipê, madeira clara, madeira escura, acabamento fosco e acetinado.',
      'Use conteúdo específico final, sem placeholder genérico.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: Studio Habitat, Helena Duarte Arquitetura, arquitetura contemporânea para espaços com identidade.' },
      { role: 'assistant', text: 'Não reutilizar o site antigo de arquitetura residencial.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.product.domain, 'wood-finishes');
  assert.strictEqual(route.workingBrief.product.brandFallback, 'Linea Bosco Revestimentos');
  assert.notStrictEqual(route.workingBrief.product.domain, 'architecture');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/wood-floor-smoke.jpeg',
      alt: 'Ambiente sofisticado com piso de madeira natural',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/wood-floor-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'wood-finishes');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'portfolio-gallery');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  [
    'app/page.tsx',
    'app/produtos/page.tsx',
    'app/projetos/page.tsx',
    'app/inspiracoes/page.tsx',
    'app/contato/page.tsx',
  ].forEach((relPath) => {
    assert.ok(blueprint.action.operations.some((operation) => operation.path === relPath), `missing route ${relPath}`);
  });
  harness.applyOperations(rootPath, blueprint.action.operations);

  const generatedText = normalizeSmokeText([
    harness.readFile(rootPath, 'app/page.tsx'),
    harness.readFile(rootPath, 'app/layout.tsx'),
    harness.readFile(rootPath, 'app/produtos/page.tsx'),
    harness.readFile(rootPath, 'app/projetos/page.tsx'),
    harness.readFile(rootPath, 'app/inspiracoes/page.tsx'),
    harness.readFile(rootPath, 'app/contato/page.tsx'),
  ].join('\n'));
  assert.match(generatedText, /(linea bosco revestimentos|pisos de madeira|paineis ripados|decks e areas externas|texturas que aproximam natureza e arquitetura|carvalho natural|nogueira|cumaru|solicitar orcamento|produto de interesse)/);
  assert.doesNotMatch(generatedText, /(studio habitat|helena duarte arquitetura|arquitetura contemporanea para espacos com identidade|escritorio faber advocacia|uma presenca digital clara|atendimento placeholder premium)/);

  return {
    brand: route.workingBrief.product.brandFallback,
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
  };
}

async function runVitraPureGlassBottlesScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-34-vitrapure-garrafas-vidro');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing completo — Landing Page de Garrafas de Vidro',
      'Nome da marca',
      'VitraPure',
      'Slogan: Beba melhor. Viva leve. Reduza o plástico.',
      'Criar landing page moderna, elegante e responsiva para garrafas de vidro reutilizáveis e sustentáveis.',
      'Hero com título "Sua água mais pura, sua rotina mais sustentável.", benefícios, sobre o produto, produtos, comparação, sustentabilidade, prova social, oferta, garantia, FAQ, chamada final e footer.',
      'Produtos: VitraPure Essential 500ml, VitraPure Aura 750ml, VitraPure Terra 1L.',
      'Use conteúdo específico final, sem placeholder genérico.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: Atelier Couro Faber, bolsas, pastas e couro artesanal.' },
      { role: 'assistant', text: 'Não reutilizar a landing de couro.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.product.domain, 'sustainable-product-landing');
  assert.strictEqual(route.workingBrief.product.brandFallback, 'VitraPure');
  assert.notStrictEqual(route.productRoute.mode, 'adaptive_blueprint');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/glass-bottle-smoke.jpeg',
      alt: 'Garrafa de vidro transparente em bancada clara',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/glass-bottle-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'sustainable-product-landing');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'consumer-product-catalog-landing');
  assert.strictEqual(blueprint.action.blueprint.visualGrammar.id, 'consumer-product-mosaic');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  harness.applyOperations(rootPath, blueprint.action.operations);

  const generatedText = normalizeSmokeText([
    harness.readFile(rootPath, 'app/page.tsx'),
    harness.readFile(rootPath, 'app/layout.tsx'),
  ].join('\n'));
  assert.match(generatedText, /(vitrapure|sua agua mais pura|livre de bpa|essential 500ml|aura 750ml|terra 1l|menos plastico|comprar agora|escolher minha garrafa)/);
  assert.match(generatedText, /data-visual-grammar="consumer-product-mosaic"/);
  assert.doesNotMatch(generatedText, /(atelier couro faber|bolsas de couro|helena duarte arquitetura|studio habitat|faber projeto|atendimento placeholder premium)/);

  return {
    brand: route.workingBrief.product.brandFallback,
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
    grammar: blueprint.action.blueprint.visualGrammar.id,
  };
}

async function runAlumivanceFacadesScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-35-alumivance-esquadrias-fachadas');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing completo — Site de Empresa de Esquadrias de Alumínio e ACM',
      'Nome da empresa',
      'Alumivance Esquadrias & Fachadas',
      'Slogan: Precisão em alumínio. Elegância em cada fachada.',
      'Criar site institucional completo, moderno, responsivo e multipágina para esquadrias de alumínio, fachadas em ACM, pele de vidro, guarda-corpos, brises metálicos e portões.',
      'Páginas: Início, Sobre a Alumivance, Soluções, Projetos, Calculadora de Orçamento, Blog, Contato e Trabalhe Conosco.',
      'A calculadora deve usar valor estimado = área em m² × valor base da solução × multiplicador do acabamento × multiplicador do vidro.',
      'Use conteúdo específico final, sem placeholder genérico.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: Helena Duarte Arquitetura, Studio Habitat, VitraPure e Atelier Couro Faber.' },
      { role: 'assistant', text: 'Não reutilizar conteúdo antigo de arquitetura, couro ou garrafas.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.product.domain, 'technical-b2b-services-site');
  assert.strictEqual(route.workingBrief.product.brandFallback, 'Alumivance Esquadrias & Fachadas');
  assert.notStrictEqual(route.productRoute.mode, 'adaptive_blueprint');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/aluminum-facade-smoke.jpeg',
      alt: 'Fachada moderna com alumínio, vidro e ACM',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/aluminum-facade-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'technical-b2b-services-site');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'technical-b2b-lead-site');
  assert.strictEqual(blueprint.action.blueprint.visualGrammar.id, 'technical-b2b-systems');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  [
    'app/sobre/page.tsx',
    'app/solucoes/page.tsx',
    'app/projetos/page.tsx',
    'app/calculadora/page.tsx',
    'app/blog/page.tsx',
    'app/contato/page.tsx',
    'app/trabalhe-conosco/page.tsx',
  ].forEach((relPath) => {
    assert.ok(blueprint.action.operations.some((operation) => operation.path === relPath), `missing route ${relPath}`);
  });
  harness.applyOperations(rootPath, blueprint.action.operations);

  const generatedText = normalizeSmokeText([
    harness.readFile(rootPath, 'app/page.tsx'),
    harness.readFile(rootPath, 'app/layout.tsx'),
    harness.readFile(rootPath, 'app/solucoes/page.tsx'),
    harness.readFile(rootPath, 'app/projetos/page.tsx'),
    harness.readFile(rootPath, 'app/calculadora/page.tsx'),
    harness.readFile(rootPath, 'app/contato/page.tsx'),
    harness.readFile(rootPath, 'app/trabalhe-conosco/page.tsx'),
  ].join('\n'));
  assert.match(generatedText, /(alumivance esquadrias & fachadas|esquadrias de aluminio|fachadas em acm|pele de vidro|calculadora de orcamento|basevalues|finishmultipliers|glassmultipliers|enviar para analise tecnica|rua engenheiro afonso martins|trabalhe conosco)/);
  assert.match(generatedText, /data-visual-grammar="technical-b2b-systems"/);
  assert.doesNotMatch(generatedText, /(helena duarte arquitetura|studio habitat|atelier couro faber|vitrapure|uma presenca digital clara|atendimento placeholder premium)/);

  return {
    brand: route.workingBrief.product.brandFallback,
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
    grammar: blueprint.action.blueprint.visualGrammar.id,
    routes: 7,
  };
}

async function runAuroraDiVentoWineScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-36-aurora-di-vento-vinhos');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing completo — Landing Page de Vinhos',
      'Nome da marca',
      'Aurora di Vento',
      'Tema: Vinhos artesanais premium.',
      'Produto principal: Kit Degustação com três rótulos selecionados.',
      'Criar landing page sofisticada para vinícola boutique, terroir, uvas selecionadas, colheita manual, barricas, rótulos, harmonização, prova social, oferta especial e formulário de captura.',
      'A página deve transmitir sofisticação, tradição, natureza, exclusividade, prazer e experiência sensorial.',
      'Use conteúdo específico final, sem placeholder genérico.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: Linea Bosco, pisos de madeira, carvalho, nogueira, decks e Studio Habitat.' },
      { role: 'assistant', text: 'Não reutilizar madeira, arquitetura antiga ou blueprint genérica.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.product.domain, 'premium-wine-landing');
  assert.strictEqual(route.workingBrief.product.brandFallback, 'Aurora di Vento');
  assert.notStrictEqual(route.workingBrief.product.domain, 'wood-finishes');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/wine-vineyard-smoke.jpeg',
      alt: 'Garrafa de vinho sobre mesa com vinhedo ao fundo',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/wine-vineyard-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'premium-wine-landing');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'wine-sensory-landing');
  assert.strictEqual(blueprint.action.blueprint.visualGrammar.id, 'wine-sensory-cellar');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  harness.applyOperations(rootPath, blueprint.action.operations);

  const generatedText = normalizeSmokeText([
    harness.readFile(rootPath, 'app/page.tsx'),
    harness.readFile(rootPath, 'app/layout.tsx'),
  ].join('\n'));
  assert.match(generatedText, /(aurora di vento|vinhos artesanais|kit degustacao|rotulo tinto reserva|harmonize cada rotulo|quero degustar agora|wine-sensory-cellar)/);
  assert.doesNotMatch(generatedText, /(linea bosco|pisos de madeira|paineis ripados|decks e areas externas|madeira natural para projetos|studio habitat|atendimento placeholder premium)/);

  return {
    brand: route.workingBrief.product.brandFallback,
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
    grammar: blueprint.action.blueprint.visualGrammar.id,
  };
}

async function runConstructionMaterialsSiteScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-37-materiais-construcao');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Faça um site completo com múltiplas páginas do tema materiais de construção.',
      'Nome da empresa',
      'Constrular Prime',
      'Quero múltiplas páginas e informações do sobre da empresa.',
      'Precisa de produtos, serviços, orçamento, contato, cimento, areia, brita, argamassa, tijolos, telhas, hidráulica, elétrica, ferramentas, tintas, entrega programada e lista de materiais.',
      'Use conteúdo específico final, sem placeholder genérico.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: Aurora di Vento, VitraPure, Alumivance, Studio Habitat e Atelier Couro Faber.' },
      { role: 'assistant', text: 'Não reutilizar vinho, garrafas, alumínio, arquitetura ou couro.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.product.domain, 'construction-materials-site');
  assert.strictEqual(route.workingBrief.product.brandFallback, 'Constrular Prime');
  assert.notStrictEqual(route.productRoute.mode, 'missing_domain_blueprint_contract');
  assert.notStrictEqual(route.workingBrief.product.domain, 'technical-b2b-services-site');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/construction-materials-smoke.jpeg',
      alt: 'Loja de materiais de construção com ferramentas e sacos de cimento',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/construction-materials-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'construction-materials-site');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'construction-materials-store-site');
  assert.strictEqual(blueprint.action.blueprint.visualGrammar.id, 'construction-retail-yard');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  [
    'app/sobre/page.tsx',
    'app/produtos/page.tsx',
    'app/servicos/page.tsx',
    'app/orcamento/page.tsx',
    'app/blog/page.tsx',
    'app/contato/page.tsx',
  ].forEach((relPath) => {
    assert.ok(blueprint.action.operations.some((operation) => operation.path === relPath), `missing route ${relPath}`);
  });
  harness.applyOperations(rootPath, blueprint.action.operations);

  const generatedText = normalizeSmokeText([
    harness.readFile(rootPath, 'app/page.tsx'),
    harness.readFile(rootPath, 'app/layout.tsx'),
    harness.readFile(rootPath, 'app/sobre/page.tsx'),
    harness.readFile(rootPath, 'app/produtos/page.tsx'),
    harness.readFile(rootPath, 'app/servicos/page.tsx'),
    harness.readFile(rootPath, 'app/orcamento/page.tsx'),
    harness.readFile(rootPath, 'app/blog/page.tsx'),
    harness.readFile(rootPath, 'app/contato/page.tsx'),
  ].join('\n'));
  assert.match(generatedText, /(constrular prime|materiais de construcao|categorias de materiais|cimento, areia e brita|lista de materiais|entrega programada|construction-retail-yard|orcamento)/);
  assert.doesNotMatch(generatedText, /(aurora di vento|vinicola boutique|vitrapure|alumivance esquadrias|helena duarte arquitetura|atelier couro faber|atendimento placeholder premium)/);

  return {
    brand: route.workingBrief.product.brandFallback,
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
    grammar: blueprint.action.blueprint.visualGrammar.id,
    routes: 6,
  };
}

async function runNexaFlowSaasToolScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-38-nexaflow-desk-saas');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing completo — Landing Page SaaS Operacional',
      'Nome do produto',
      'NexaFlow Desk',
      'Criar landing page completa em Next.js para uma ferramenta SaaS de gestão operacional de equipes.',
      'Precisa mostrar dashboard executivo, pipeline de trabalho, automações, relatórios, permissões, módulos, planos, depoimentos, FAQ e formulário para agendar demo.',
      'A experiência deve parecer produto de software real, com preview de workspace, cards de métricas e CTA para solicitar demo.',
      'Use conteúdo específico final, sem placeholder genérico.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: Alumivance, Aurora di Vento, Constrular Prime e Helena Duarte Arquitetura.' },
      { role: 'assistant', text: 'Não reutilizar construção, vinho, esquadrias ou arquitetura.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.product.domain, 'saas-tool');
  assert.strictEqual(route.workingBrief.product.brandFallback, 'NexaFlow Desk');
  assert.notStrictEqual(route.productRoute.mode, 'adaptive_blueprint');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route);
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'saas-tool');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'saas-tool-landing');
  assert.strictEqual(blueprint.action.blueprint.visualGrammar.id, 'saas-tool-workspace');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  harness.applyOperations(rootPath, blueprint.action.operations);

  const rawPage = harness.readFile(rootPath, 'app/page.tsx');
  assert.ok(rawPage.includes('overflow-x-hidden'), 'SaaS blueprint must prevent horizontal overflow at the page shell');
  assert.ok(rawPage.includes('[overflow-wrap:anywhere]'), 'SaaS hero title must force safe mobile wrapping');
  assert.ok(rawPage.includes('min-w-0 overflow-hidden rounded-lg'), 'SaaS dashboard preview must be contained on mobile');

  const generatedText = normalizeSmokeText([
    rawPage,
    harness.readFile(rootPath, 'app/layout.tsx'),
  ].join('\n'));
  assert.match(generatedText, /(nexaflow desk|dashboard executivo|pipeline de trabalho|agendar demo|solicitar demo|automacao|relatorios|permissoes|planos|saas-tool-workspace)/);
  assert.doesNotMatch(generatedText, /(helena duarte|studio habitat|atelier couro faber|vitrapure|alumivance|aurora di vento|constrular prime|placeholder contextual|este conteudo e definitivo|atendimento placeholder premium)/);

  return {
    brand: route.workingBrief.product.brandFallback,
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
    grammar: blueprint.action.blueprint.visualGrammar.id,
    routes: 0,
  };
}

async function runVoxLumenEditorialHubScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-39-voxlumen-revista-editorial');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing completo — Hub Editorial de Conteúdo',
      'Nome do projeto',
      'VoxLumen Revista',
      'Criar site completo em Next.js para uma revista digital e portal editorial.',
      'Precisa ter home, editorias, artigos recentes, destaques, guias, rotina editorial, newsletter, sobre, contato, prova social e FAQ.',
      'Gerar rotas profundas quando fizer sentido: artigos, editorias, newsletter, sobre e contato.',
      'Use conteúdo específico final, sem placeholder genérico.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: Studio Habitat, Helena Duarte Arquitetura, VitraPure e Atelier Couro Faber.' },
      { role: 'assistant', text: 'Não reutilizar arquitetura, produto sustentável, couro ou marcas antigas.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.product.domain, 'editorial-content');
  assert.strictEqual(route.workingBrief.product.brandFallback, 'VoxLumen Revista');
  assert.notStrictEqual(route.productRoute.mode, 'adaptive_blueprint');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route);
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'editorial-content');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'editorial-content-hub');
  assert.strictEqual(blueprint.action.blueprint.visualGrammar.id, 'editorial-content-hub');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  [
    'app/artigos/page.tsx',
    'app/editorias/page.tsx',
    'app/newsletter/page.tsx',
    'app/sobre/page.tsx',
    'app/contato/page.tsx',
  ].forEach((relPath) => {
    assert.ok(blueprint.action.operations.some((operation) => operation.path === relPath), `missing route ${relPath}`);
  });
  harness.applyOperations(rootPath, blueprint.action.operations);

  const generatedText = normalizeSmokeText([
    harness.readFile(rootPath, 'app/page.tsx'),
    harness.readFile(rootPath, 'app/layout.tsx'),
    harness.readFile(rootPath, 'app/artigos/page.tsx'),
    harness.readFile(rootPath, 'app/editorias/page.tsx'),
    harness.readFile(rootPath, 'app/newsletter/page.tsx'),
    harness.readFile(rootPath, 'app/sobre/page.tsx'),
    harness.readFile(rootPath, 'app/contato/page.tsx'),
  ].join('\n'));
  assert.match(generatedText, /(voxlumen revista|hub editorial|editorias|artigos recentes|assinar newsletter|rotina editorial|editorial-content-hub)/);
  assert.doesNotMatch(generatedText, /(helena duarte|studio habitat|atelier couro faber|vitrapure|alumivance|aurora di vento|constrular prime|placeholder contextual|este conteudo e definitivo|atendimento placeholder premium)/);

  return {
    brand: route.workingBrief.product.brandFallback,
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
    grammar: blueprint.action.blueprint.visualGrammar.id,
    routes: 5,
  };
}

async function runCacauNobreChocolateNoMediaScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-40-cacau-nobre-chocolate');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing completo — Landing Page Chocolate Premium',
      'Nome do produto',
      'Cacau Nobre Atelier',
      'Criar landing page sensorial em Next.js para chocolate artesanal premium.',
      'Precisa ter catálogo de chocolates e bombons, processo artesanal, prova social, FAQ, contato e CTA de compra.',
      'Use conteúdo específico final, sem copy provisória e sem reaproveitar marcas antigas.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: Maison Cacao, Atelier Couro Faber, VitraPure e Helena Duarte.' },
      { role: 'assistant', text: 'Não reutilizar marcas antigas ou contatos de receitas anteriores.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.product.domain, 'chocolate');
  assert.strictEqual(route.workingBrief.product.brandFallback, 'Cacau Nobre Atelier');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/cacau-nobre-smoke.jpeg',
      alt: 'Chocolate artesanal premium em mesa de degustação',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/cacau-nobre-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'chocolate');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'sensory-chocolate-landing');
  assert.strictEqual(blueprint.action.blueprint.media.provider, 'pexels');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.covered.productsStore, true);
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.covered.testimonialDepth, true);
  harness.applyOperations(rootPath, blueprint.action.operations);

  const rawPage = harness.readFile(rootPath, 'app/page.tsx');
  const generatedText = normalizeSmokeText([
    rawPage,
    harness.readFile(rootPath, 'app/layout.tsx'),
  ].join('\n'));
  assert.ok(rawPage.includes('https://images.pexels.com/photos/cacau-nobre-smoke.jpeg'));
  assert.ok(rawPage.includes('Foto de smoke no Pexels'));
  assert.ok(rawPage.includes('BlueprintResponsiveHeader'));
  assert.ok(rawPage.includes('Navegação principal mobile'));
  assert.ok(rawPage.includes('lg:hidden'));
  assert.ok(rawPage.includes('absolute right-5'));
  assert.ok(rawPage.includes('w-64 max-w-[calc(100vw-2rem)]'));
  assert.ok(rawPage.includes('overflow-x-hidden'));
  assert.ok(rawPage.includes('break-words'));
  assert.ok(rawPage.includes('testimonials.map'));
  assert.ok(rawPage.includes('contato@cacaunobreatelier.com.br'));
  assert.match(generatedText, /(cacau nobre atelier|chocolate feito para ser sentido|bombons especiais|processo artesanal|prova social|comprar agora)/);
  assert.doesNotMatch(generatedText, /(null as const|copy contextual|este conteudo e definitivo|maisoncacao|atelier couro faber|vitrapure|helena duarte)/);

  return {
    brand: route.workingBrief.product.brandFallback,
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
    grammar: blueprint.action.blueprint.visualGrammar.id,
  };
}

async function runLumenLabPhotoLabScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-42-lumen-lab-photo-lab');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing completo — Site para Laboratório Fotográfico',
      'Nome fictício do negócio',
      'Lumen Lab Fotográfico',
      'A marca atua com revelação de filmes, digitalização profissional, impressão fine art, restauração fotográfica, ampliações e atendimento para fotógrafos profissionais.',
      'O site deve ter estética cinematográfica, editorial e premium, fundo escuro, âmbar, hero full width com vídeo, serviços, portfólio, processo, orçamento, depoimentos, rodapé e botão Enviar arquivos.',
      'Use conteúdo específico final, sem placeholder genérico e sem reaproveitar memórias antigas.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: Ateliê Madeira Viva, escultura em madeira, artista, ateliê e galeria.' },
      { role: 'assistant', text: 'Não reutilizar madeira, talha, ateliê de escultura ou fallback placeholder.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.product.domain, 'photo-lab');
  assert.strictEqual(route.workingBrief.product.brandFallback, 'Lumen Lab Fotográfico');
  assert.strictEqual(route.workingBrief.contractEscalation.required, false);

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'video',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://videos.pexels.com/video-files/lumen-lab-smoke.mp4',
      poster: 'https://images.pexels.com/photos/lumen-lab-smoke.jpeg',
      alt: 'Laboratório fotográfico com negativos e luz de darkroom',
      attribution: 'Vídeo de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/video/lumen-lab-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'photo-lab');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'photographic-lab-site');
  assert.strictEqual(blueprint.action.blueprint.visualGrammar.id, 'sensory-immersive-story');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  harness.applyOperations(rootPath, blueprint.action.operations);

  const rawPage = harness.readFile(rootPath, 'app/page.tsx');
  const generatedText = normalizeSmokeText([
    rawPage,
    harness.readFile(rootPath, 'app/layout.tsx'),
    harness.readFile(rootPath, 'app/globals.css'),
  ].join('\n'));
  assert.ok(rawPage.includes('BlueprintResponsiveHeader'));
  assert.ok(rawPage.includes('Navegação principal mobile'));
  assert.ok(rawPage.includes('Enviar arquivos'));
  assert.ok(rawPage.includes('https://videos.pexels.com/video-files/lumen-lab-smoke.mp4'));
  assert.match(generatedText, /(lumen lab fotografico|transformamos imagens em memoria|revelacao de filmes|digitalizacao profissional|impressao fine art|restauracao fotografica|photo-lab|photographic-lab-site|sensory-immersive-story)/);
  assert.match(generatedText, /--color-bg: #111111/);
  assert.match(generatedText, /--color-accent: #c98b3c/);
  assert.doesNotMatch(generatedText, /(atendimento placeholder premium|este bloco usa texto placeholder|uma presenca digital clara|faber projeto|atelie madeira viva|escultura em madeira|talha manual)/);

  return {
    brand: route.workingBrief.product.brandFallback,
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
    grammar: blueprint.action.blueprint.visualGrammar.id,
  };
}

async function runAtlasPortImportServicesNoMediaScenario(harness) {
  const rootPath = harness.createScenarioRoot('teste-41-atlasport-import-services');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing completo — Landing Page de Comércio Exterior',
      'Nome do projeto',
      'AtlasPort Importações',
      'Criar landing page B2B em Next.js para serviços de importação, comércio exterior e desembaraço aduaneiro.',
      'Precisa ter serviços, tipos de importação, processo, guias, diferenciais, depoimentos, FAQ e formulário de cotação.',
      'Use conteúdo específico final e preserve os termos técnicos de comércio exterior.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: Alumivance, Aurora di Vento, Constrular Prime e Studio Habitat.' },
      { role: 'assistant', text: 'Não reutilizar construção, vinhos, esquadrias ou arquitetura.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.product.domain, 'import-services');
  assert.strictEqual(route.workingBrief.product.brandFallback, 'AtlasPort Importações');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/atlasport-import-smoke.jpeg',
      alt: 'Operação de comércio exterior com contêineres e logística internacional',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/atlasport-import-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'import-services');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'import-service-landing');
  assert.strictEqual(blueprint.action.blueprint.media.provider, 'pexels');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  harness.applyOperations(rootPath, blueprint.action.operations);

  const rawPage = harness.readFile(rootPath, 'app/page.tsx');
  const generatedText = normalizeSmokeText([
    rawPage,
    harness.readFile(rootPath, 'app/layout.tsx'),
  ].join('\n'));
  assert.ok(rawPage.includes('https://images.pexels.com/photos/atlasport-import-smoke.jpeg'));
  assert.ok(rawPage.includes('Foto de smoke no Pexels'));
  assert.ok(rawPage.includes('function HeroMedia'));
  assert.ok(rawPage.includes("heroMedia.src.includes('-smoke')"), 'Trade blueprint must avoid rendering synthetic smoke media as a broken image');
  assert.ok(rawPage.includes('<HeroMedia className="aspect-[16/9] w-full object-cover" />'));
  assert.ok(rawPage.includes('grid max-w-xs gap-3 sm:flex'), 'Trade blueprint CTAs must stack safely on mobile');
  assert.ok(rawPage.includes('max-w-xs break-words text-lg'), 'Trade blueprint hero text must wrap safely on mobile');
  assert.ok(rawPage.includes('BlueprintResponsiveHeader'));
  assert.ok(rawPage.includes('Navegação principal mobile'));
  assert.ok(rawPage.includes('lg:hidden'));
  assert.ok(rawPage.includes('absolute right-5'));
  assert.ok(rawPage.includes('w-64 max-w-[calc(100vw-2rem)]'));
  assert.ok(rawPage.includes('overflow-x-hidden'));
  assert.ok(rawPage.includes('break-words'));
  assert.match(generatedText, /(atlasport importacoes|comercio exterior|desembaraco aduaneiro|cotacao internacional|logistica internacional|produto que deseja importar|falar no whatsapp)/);
  assert.doesNotMatch(generatedText, /(null as const|atendimento placeholder premium|helena duarte|studio habitat|alumivance|aurora di vento|constrular prime)/);

  return {
    brand: route.workingBrief.product.brandFallback,
    domain: route.workingBrief.product.domain,
    recipe: blueprint.action.blueprint.layoutRecipe.id,
    grammar: blueprint.action.blueprint.visualGrammar.id,
  };
}

async function runWoodSculptureVideoHeroScenario(harness) {
  const rootPath = harness.createScenarioRoot('wood-sculpture-video-hero');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Crie um site de escultura em madeira para um artista e ateliê.',
      'Quero hero no topo com vídeo full width no fundo, portfólio, processo artesanal, talha manual, obras sob encomenda e contato.',
      'O público inclui colecionadores, arquitetos e designers de interiores.',
    ].join(' '),
    conversationMessages: [
      { role: 'user', text: 'Antes falamos de arquitetura residencial e clínica dental.' },
      { role: 'assistant', text: 'Não reutilizar Studio Habitat ou Clínica Sorriso.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.workingBrief.product.domain, 'wood-sculpture');
  assert.strictEqual(route.workingBrief.mediaIntent[0].mediaType, 'video');
  assert.notStrictEqual(route.workingBrief.product.domain, 'architecture');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'video',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://videos.pexels.com/video-files/wood-sculpture-smoke.mp4',
      poster: 'https://images.pexels.com/photos/wood-sculpture-smoke.jpeg',
      alt: 'Wood carving artisan hands',
      attribution: 'Video de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/video/wood-sculpture-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.briefingContract.domain, 'wood-sculpture');
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.hero, 'full-bleed-media');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.passes, true);
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.covered.routeNavigation, true);
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.covered.sectionDepth, true);
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.covered.testimonialDepth, true);
  assert.ok(blueprint.action.operations.some((operation) => operation.path === 'app/contato/page.tsx'));
  assert.ok(blueprint.action.operations.some((operation) => operation.path === 'app/portfolio/page.tsx'));
  assert.ok(blueprint.action.operations.some((operation) => operation.path === 'app/loja/page.tsx'));
  harness.applyOperations(rootPath, blueprint.action.operations);

  const page = harness.readFile(rootPath, 'app/page.tsx');
  const generatedText = normalizeSmokeText(page);
  assert.ok(page.includes('<video'));
  assert.ok(page.includes('routeHref(galleryRoute') && page.includes("'/portfolio'"));
  assert.ok(page.includes("routeHref('/contato'"));
  assert.ok(page.includes('testimonials.map'));
  assert.match(generatedText, /(escultura em madeira|madeira bruta|talha|atelie madeira viva|ateliê madeira viva|obras disponiveis|portfolio artistico|solicitar encomenda)/);
  assert.doesNotMatch(generatedText, /(studio habitat|clinica sorriso|modern dental clinic|estufas protegidas)/);

  return {
    domain: route.workingBrief.product.domain,
    media: route.workingBrief.mediaIntent[0].mediaType,
  };
}

async function runEmptyProjectBriefingContinuationScenario(harness) {
  const rootPath = harness.createScenarioRoot('empty-project-briefing-continuation');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'Quero criar algo novo, seguindo o briefing completo que passei nessa conversa',
    conversationMessages: [
      {
        role: 'user',
        text: [
          'Briefing: site completo de jardinagem com serviços de paisagismo, loja de produtos, blog educativo, galeria e contato.',
          'A home deve ter banner principal, produtos, conteúdos recentes do blog, depoimentos e chamada para orçamento.',
        ].join(' '),
      },
      {
        role: 'assistant',
        text: 'Antes de criar uma nova base neste projeto, preciso confirmar se você quer gerar um projeto novo ou editar a estrutura atual.',
      },
      { role: 'user', text: 'Não quero editar nada, quero algo novo.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'create_project');
  assert.strictEqual(route.productRoute.executionIntent, 'init_project');
  assert.strictEqual(route.workingBrief.product.domain, 'gardening');
  assert.strictEqual(route.meta.routeScore.requiresClarification, false);

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/garden-continuation-smoke.jpeg',
      alt: 'Garden continuation smoke',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/garden-continuation-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  assert.strictEqual(blueprint.action.blueprint.coverageContract.evaluation.covered.routeNavigation, true);
  harness.applyOperations(rootPath, blueprint.action.operations);
  const rawPage = harness.readFile(rootPath, 'app/page.tsx');
  assert.ok(rawPage.includes("routeHref('/loja'"));
  assert.ok(rawPage.includes('testimonials.map'));
  const page = normalizeSmokeText(rawPage);
  assert.match(page, /(jardim vivo|loja de jardinagem|dicas de jardinagem|solicite um orcamento)/);

  return {
    domain: route.workingBrief.product.domain,
    route: route.meta.reason,
  };
}

async function runDeterministicPatchScenario(harness) {
  const rootPath = harness.createScenarioRoot('deterministic-title-patch');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'Crie um site em Next.js para estufas agricolas com placeholders e verde profundo.',
  });
  assert.strictEqual(route.decision, 'execute');

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/greenhouse-title-smoke.jpeg',
      alt: 'Greenhouse smoke',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/greenhouse-title-smoke/',
    },
  });
  harness.applyOperations(rootPath, blueprint.action.operations);

  const projectInfo = harness.scanProject(rootPath);
  const patch = harness.deterministicService.buildContentEditOperationBatch({
    projectInfo,
    executionIntent: 'edit_project',
    userMessage: 'Altere o titulo da pagina para "Portal de Estufas Faber"',
  });

  assert.ok(patch && patch.ok, patch && patch.message);
  assert.strictEqual(patch.action.safePatchValidation.ok, true);
  assert.strictEqual(patch.action.safePatchClassification.supported, true);
  assert.strictEqual(patch.action.generatedBy, 'deterministic_title_edit_patch');

  const execution = harness.applyOperations(rootPath, patch.action.operations);
  const page = harness.readFile(rootPath, 'app/page.tsx');
  const layout = harness.readFile(rootPath, 'app/layout.tsx');
  assert.ok(page.includes('Portal de Estufas Faber'));
  assert.ok(layout.includes('Portal de Estufas Faber'));

  const cssBeforeColorPatch = harness.readFile(rootPath, 'app/globals.css');
  const accentMatch = cssBeforeColorPatch.match(/--color-accent:\s*(#[0-9a-fA-F]{6})\s*;/);
  assert.ok(accentMatch, 'generated blueprint should expose --color-accent for literal color patch smoke');
  const previousAccent = accentMatch[1].toLowerCase();
  const literalColorPatch = harness.deterministicService.buildContentEditOperationBatch({
    projectInfo: harness.scanProject(rootPath),
    executionIntent: 'edit_project',
    userMessage: `Quero alterar as cores aonde for ${previousAccent} por um azul, a cor #4293c2`,
  });

  assert.ok(literalColorPatch && literalColorPatch.ok, literalColorPatch && literalColorPatch.message);
  assert.strictEqual(literalColorPatch.action.generatedBy, 'micro_color_literal_replace_patch');
  assert.strictEqual(literalColorPatch.action.safePatchEvidence.status, 'approved');
  assert.strictEqual(literalColorPatch.action.safePatchEvidence.microContract.type, 'literal_color_replacement');
  const colorExecution = harness.applyOperations(rootPath, literalColorPatch.action.operations);
  const cssAfterColorPatch = harness.readFile(rootPath, 'app/globals.css');
  assert.ok(cssAfterColorPatch.includes('#4293c2'));
  assert.strictEqual(cssAfterColorPatch.includes(previousAccent), false);

  const footerPatch = harness.deterministicService.buildContentEditOperationBatch({
    projectInfo: harness.scanProject(rootPath),
    executionIntent: 'edit_project',
    userMessage: 'Insira um Rodapé no site com a cor #fcf7e3',
  });

  assert.ok(footerPatch && footerPatch.ok, footerPatch && footerPatch.message);
  assert.strictEqual(footerPatch.action.generatedBy, 'deterministic_footer_insert_patch');
  assert.strictEqual(footerPatch.action.safePatchClassification.kind, 'footer_insert_micro_patch');
  assert.strictEqual(footerPatch.action.safePatchEvidence.validation.ok, true);
  const footerExecution = harness.applyOperations(rootPath, footerPatch.action.operations);
  const pageAfterFooterPatch = harness.readFile(rootPath, 'app/page.tsx');
  assert.ok(pageAfterFooterPatch.includes('<BlueprintFooterUtility brand='));
  assert.ok(pageAfterFooterPatch.includes('backgroundColor="#fcf7e3"'));
  assert.ok(pageAfterFooterPatch.includes('Instagram'));

  return {
    files:
      execution.modifiedFiles.length +
      colorExecution.modifiedFiles.length +
      footerExecution.modifiedFiles.length,
    validation: patch.action.safePatchValidation.summary,
    route: patch.raw,
  };
}

async function runDeterministicStructuralPatchScenario(harness) {
  const rootPath = harness.createScenarioRoot('deterministic-structural-patch');
  fs.mkdirSync(path.join(rootPath, 'app'), { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, 'app', 'page.tsx'),
    [
      'export default function Page() {',
      '  return (',
      '    <>',
      '    <header><nav><a href="/">Início</a><a href="/blog">Blog</a></nav></header>',
      '    <main>',
      '      <section id="hero">',
      '        <img src="/hero-old.jpg" alt="Hero antigo" />',
      '        <video poster="/poster-old.jpg"><source src="/video-old.mp4" /></video>',
      '        <a href="#contato">Agendar conversa</a>',
      '        <a href="#servicos">Conhecer serviços</a>',
      '      </section>',
      '      <section id="servicos">',
      '        <div className="grid md:grid-cols-2 gap-6">',
      '          <article><h3>Diagnóstico inicial</h3><p>Mapeamento.</p></article>',
      '          <article><h3>Execução guiada</h3><p>Implantação.</p></article>',
      '        </div>',
      '      </section>',
      '      <section id="metricas"><h2>Métricas</h2><strong>120</strong><span>Clientes ativos</span></section>',
      '      <section id="blog"><h2>Blog</h2><p>Conteúdo antigo.</p></section>',
      '      <section id="depoimentos"><h2>Depoimentos</h2></section>',
      '      <section id="faq"><h2>FAQ</h2><article><h3>Como funciona?</h3><p>Em etapas.</p></article></section>',
      '      <section id="contato"><h2>Contato</h2><form><label><span>Nome</span><input name="nome" type="text" placeholder="Nome" /></label></form></section>',
      '    </main>',
      '    </>',
      '  );',
      '}',
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(rootPath, 'app', 'layout.tsx'),
    "export const metadata = { title: 'Patch estrutural' };\nexport default function Layout({ children }) { return <html><body>{children}</body></html>; }\n",
    'utf8'
  );

  const requests = [
    ['cta', 'Troque o texto do CTA secundário de Conhecer serviços para Ver planos', 'deterministic_cta_text_patch'],
    ['card', 'Troque o texto do segundo card para Consultoria premium', 'deterministic_card_text_patch'],
    ['grid', 'Mude o grid de serviços para 3 colunas no desktop', 'deterministic_grid_columns_patch'],
    ['section', 'Mova a seção FAQ para antes da seção Depoimentos', 'deterministic_section_reorder_patch'],
    ['faq_add', 'Adicione FAQ pergunta "Tem suporte?" resposta "Sim, com acompanhamento."', 'deterministic_faq_item_patch'],
    ['faq_edit', 'Edite a resposta da pergunta "Como funciona?" para "Em três etapas guiadas."', 'deterministic_faq_item_patch'],
    ['faq_remove', 'Remova FAQ pergunta "Como funciona?"', 'deterministic_faq_item_patch'],
    ['nav', 'Troque o link do menu de Blog para /insights', 'deterministic_nav_link_patch'],
    ['remove', 'Remova a seção Blog', 'deterministic_section_remove_patch'],
    ['form_add', 'Adicione campo WhatsApp ao formulário', 'deterministic_form_field_patch'],
    ['form_rename', 'Renomeie campo Nome para Nome completo', 'deterministic_form_field_patch'],
    ['stat', 'Troque a métrica de 120 para 250', 'deterministic_stat_text_patch'],
    ['media', 'Troque o poster do vídeo hero para /hero-poster.jpg', 'deterministic_hero_media_patch'],
  ];
  const generatedBy = [];
  let modifiedFiles = 0;

  for (const [, userMessage, expectedGenerator] of requests) {
    const patch = harness.deterministicService.buildContentEditOperationBatch({
      projectInfo: harness.scanProject(rootPath),
      executionIntent: 'edit_project',
      userMessage,
    });
    assert.ok(patch && patch.ok, `${userMessage}: ${patch && patch.message}`);
    assert.strictEqual(patch.action.generatedBy, expectedGenerator);
    assert.strictEqual(patch.action.safePatchValidation.ok, true);
    const execution = harness.applyOperations(rootPath, patch.action.operations);
    modifiedFiles += execution.modifiedFiles.length;
    generatedBy.push(patch.action.generatedBy);
  }

  const page = harness.readFile(rootPath, 'app/page.tsx');
  assert.ok(page.includes('Ver planos'));
  assert.ok(page.includes('Consultoria premium'));
  assert.ok(page.includes('lg:grid-cols-3'));
  assert.ok(page.indexOf('id="faq"') < page.indexOf('id="depoimentos"'));
  assert.ok(page.includes('<h3>Tem suporte?</h3>'));
  assert.ok(!page.includes('<h3>Como funciona?</h3>'));
  assert.ok(page.includes('<a href="/insights">Blog</a>'));
  assert.ok(!page.includes('id="blog"'));
  assert.ok(page.includes('<span>WhatsApp</span>'));
  assert.ok(page.includes('<span>Nome completo</span>'));
  assert.ok(page.includes('<strong>250</strong>'));
  assert.ok(page.includes('<video poster="/hero-poster.jpg">'));

  return {
    generatedBy,
    modifiedFiles,
  };
}

async function runMcpStructuredEditPersistenceScenario(harness) {
  const rootPath = harness.createScenarioRoot('mcp-structured-edit-persistence');
  fs.writeFileSync(
    path.join(rootPath, 'index.html'),
    [
      '<main>',
      '  <section id="hero">',
      '    <a href="#contato">Agendar conversa</a>',
      '    <a href="#servicos">Conhecer serviços</a>',
      '  </section>',
      '  <section id="servicos">',
      '    <div class="grid md:grid-cols-2 gap-6">',
      '      <article><h3>Diagnóstico Faber</h3><p>Mapeamento.</p></article>',
      '      <article><h3>Implantação guiada</h3><p>Execução.</p></article>',
      '    </div>',
      '  </section>',
      '</main>',
    ].join('\n'),
    'utf8'
  );

  const auditCalls = [];
  const jobEvents = [];
  const checkpoints = [];
  const projectSession = {
    rootPath,
    projectId: 'mcp-project-1',
    projectName: 'MCP Smoke',
    jobId: 'mcp-job-1',
  };
  const service = createFaberCapabilityAdapterService({
    fs,
    path,
    deterministicEditService: harness.deterministicService,
    scanProject: (targetRoot) => harness.scanProject(targetRoot),
    appendAuditEvent: (type, payload) => auditCalls.push({ type, payload }),
    appendJobEvent: (jobId, type, payload) => jobEvents.push({ jobId, type, payload }),
    setJobCheckpoint: (jobId, key, payload) => checkpoints.push({ jobId, key, payload }),
    now: () => '2026-05-26T12:00:00.000Z',
  });

  const capabilities = service.listCapabilities();
  const structuredCapability = capabilities.find((item) => item.capability === 'structured_edit');
  const filesystemCapability = capabilities.find((item) => item.capability === 'filesystem');
  assert.ok(structuredCapability, 'structured_edit capability should be registered');
  assert.deepStrictEqual(structuredCapability.actions, ['plan', 'apply']);
  assert.ok(filesystemCapability, 'filesystem capability should be registered');
  assert.strictEqual(filesystemCapability.actions.includes('write_file'), false);

  const plan = await service.executeCapability({
    capability: 'structured_edit',
    action: 'plan',
    projectSession,
    payload: {
      requestId: 'mcp-plan-1',
      userMessage: 'Troque o texto do CTA secundário de Conhecer serviços para Ver planos',
    },
  });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.evidence.data.patch.generatedBy, 'deterministic_cta_text_patch');
  assert.strictEqual(plan.evidence.data.patch.validation.ok, true);
  assert.ok(plan.evidence.data.patch.diffPreview.includes('index.html'));
  assert.strictEqual(plan.evidence.data.ledger.ok, true);
  assert.strictEqual(plan.evidence.data.ledger.relativePath, '.faber/capabilities/structured_edit.jsonl');
  assert.strictEqual(harness.readFile(rootPath, 'index.html').includes('Ver planos'), false);

  const apply = await service.executeCapability({
    capability: 'structured_edit',
    action: 'apply',
    projectSession,
    payload: {
      requestId: 'mcp-apply-1',
      userMessage: 'Mude o grid de serviços para 3 colunas no desktop',
    },
  });
  assert.strictEqual(apply.ok, true);
  assert.strictEqual(apply.evidence.data.patch.generatedBy, 'deterministic_grid_columns_patch');
  assert.deepStrictEqual(apply.evidence.data.applied, ['index.html']);
  assert.ok(harness.readFile(rootPath, 'index.html').includes('lg:grid-cols-3'));
  assert.strictEqual(apply.evidence.data.ledger.ok, true);

  const unsupported = await service.executeCapability({
    capability: 'structured_edit',
    action: 'apply',
    projectSession,
    payload: {
      requestId: 'mcp-blocked-1',
      userMessage: 'Reescreva o projeto inteiro com dashboard SaaS, login, billing e banco de dados',
    },
  });
  assert.strictEqual(unsupported.ok, false);
  assert.strictEqual(unsupported.status, 'blocked');
  assert.ok(unsupported.evidence.errors.includes('structured_edit_no_patch_available'));
  assert.strictEqual(unsupported.evidence.data.ledger.ok, true);

  const directWrite = await service.executeCapability({
    capability: 'filesystem',
    action: 'write_file',
    projectSession,
    payload: {
      path: 'index.html',
      content: '<main>escrita direta indevida</main>',
    },
  });
  assert.strictEqual(directWrite.ok, false);
  assert.strictEqual(directWrite.status, 'blocked');
  assert.ok(directWrite.evidence.errors.includes('capability_action_not_allowed'));
  assert.strictEqual(harness.readFile(rootPath, 'index.html').includes('escrita direta indevida'), false);

  const ledgerPath = path.join(rootPath, '.faber', 'capabilities', 'structured_edit.jsonl');
  assert.strictEqual(fs.existsSync(ledgerPath), true);
  const ledgerEntries = fs.readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.strictEqual(ledgerEntries.length, 3);
  assert.deepStrictEqual(ledgerEntries.map((entry) => entry.action), ['plan', 'apply', 'apply']);
  assert.deepStrictEqual(ledgerEntries.map((entry) => entry.status), ['succeeded', 'succeeded', 'blocked']);
  assert.strictEqual(ledgerEntries[0].schemaVersion, 'faber-capability-evidence-ledger-v1');
  assert.strictEqual(ledgerEntries[0].project.id, 'mcp-project-1');
  assert.strictEqual(ledgerEntries[0].jobId, 'mcp-job-1');
  assert.strictEqual(ledgerEntries[0].patch.generatedBy, 'deterministic_cta_text_patch');
  assert.strictEqual(ledgerEntries[1].patch.generatedBy, 'deterministic_grid_columns_patch');
  assert.deepStrictEqual(ledgerEntries[1].applied, ['index.html']);
  assert.strictEqual(ledgerEntries[2].ok, false);
  assert.ok(ledgerEntries[2].errors.includes('structured_edit_no_patch_available'));
  assert.ok(auditCalls.some((entry) => entry.type === 'capability.structured_edit.plan'));
  assert.ok(auditCalls.some((entry) => entry.type === 'capability.structured_edit.apply'));
  assert.ok(jobEvents.some((entry) => entry.jobId === 'mcp-job-1' && entry.type === 'job.capability.structured_edit'));
  assert.ok(checkpoints.some((entry) => entry.jobId === 'mcp-job-1' && entry.key === 'capability_structured_edit'));
  assert.strictEqual(harness.scanProject(rootPath).files.some((filePath) => String(filePath).startsWith('.faber/')), false);

  return {
    applied: apply.evidence.data.applied,
    blockedFilesystemWrite: true,
    ledgerEntries: ledgerEntries.length,
    persistedBy: ledgerEntries.slice(0, 2).map((entry) => entry.patch.generatedBy),
  };
}

async function runMcpExternalToolBridgeScenario(harness) {
  const rootPath = harness.createScenarioRoot('mcp-external-tool-bridge');
  fs.writeFileSync(
    path.join(rootPath, 'index.html'),
    [
      '<main>',
      '  <header><nav>Home Servicos Contato</nav></header>',
      '  <section id="hero"><h1>Faber External MCP Smoke</h1><p>Visual evidence bridge.</p></section>',
      '</main>',
    ].join('\n'),
    'utf8'
  );

  const artifactPath = path.join(rootPath, '.faber', 'external-mcp-artifacts', 'visual-auditor-desktop.png');
  const externalMcpCalls = [];
  const projectSession = {
    rootPath,
    projectId: 'mcp-external-project',
    projectName: 'MCP External Smoke',
    jobId: 'mcp-external-job',
  };
  const service = createFaberCapabilityAdapterService({
    fs,
    path,
    externalMcpServers: [
      {
        id: 'visual-auditor',
        name: 'Visual Auditor MCP',
        trust: 'approved',
        allowedTools: ['visual.capture'],
        blockedTools: ['filesystem.write'],
        permission: 'write',
        injectProjectSessionArgument: true,
      },
    ],
    externalMcpTransports: {
      'visual-auditor': {
        request: async (method, params) => {
          externalMcpCalls.push({ method, params });
          if (method === 'initialize') {
            return {
              protocolVersion: '2025-06-18',
              serverInfo: { name: 'Visual Auditor MCP', version: '1.0.0' },
            };
          }
          if (method === 'tools/list') {
            return {
              tools: [
                {
                  name: 'visual.capture',
                  description: 'Captura screenshot e DOM metrics por viewport.',
                  inputSchema: { type: 'object' },
                  annotations: { permission: 'write' },
                },
                {
                  name: 'filesystem.write',
                  description: 'Escrita direta bloqueada pela politica Faber.',
                  inputSchema: { type: 'object' },
                  annotations: { permission: 'write' },
                },
              ],
            };
          }
          if (method === 'tools/call') {
            assert.strictEqual(params.name, 'visual.capture');
            assert.strictEqual(params.arguments.projectSession.rootPath, rootPath);
            writeExternalMcpVisualArtifact(artifactPath);
            return {
              content: [
                { type: 'text', text: 'external visual capture complete' },
                { type: 'image', mimeType: 'image/png', path: artifactPath },
              ],
              structuredContent: {
                domMetrics: [
                  {
                    label: 'desktop',
                    innerWidth: 1365,
                    hamburgerVisible: false,
                    desktopNavVisible: true,
                    hasHorizontalOverflow: false,
                    hasOldMemory: false,
                  },
                  {
                    label: 'tablet',
                    innerWidth: 820,
                    hamburgerVisible: true,
                    desktopNavVisible: false,
                    hasHorizontalOverflow: false,
                    hasOldMemory: false,
                  },
                  {
                    label: 'mobile',
                    innerWidth: 390,
                    hamburgerVisible: true,
                    desktopNavVisible: false,
                    hasHorizontalOverflow: false,
                    hasOldMemory: false,
                  },
                ],
              },
              artifacts: [artifactPath],
            };
          }
          return { isError: true, content: [{ type: 'text', text: 'unsupported method' }] };
        },
      },
    },
    now: () => '2026-05-27T15:30:00.000Z',
  });

  const servers = await service.executeCapability({
    capability: 'external_mcp',
    action: 'servers',
    projectSession,
  });
  assert.strictEqual(servers.ok, true);
  assert.strictEqual(servers.evidence.data.servers[0].status, 'available');

  const discovery = await service.executeCapability({
    capability: 'external_mcp',
    action: 'discover_tools',
    projectSession,
    payload: { serverId: 'visual-auditor' },
  });
  assert.strictEqual(discovery.ok, true);
  assert.strictEqual(discovery.evidence.data.tools.find((tool) => tool.name === 'visual.capture').allowed, true);
  assert.strictEqual(discovery.evidence.data.tools.find((tool) => tool.name === 'filesystem.write').allowed, false);

  const capture = await service.executeCapability({
    capability: 'external_mcp',
    action: 'call_tool',
    projectSession,
    payload: {
      serverId: 'visual-auditor',
      toolName: 'visual.capture',
      arguments: {
        url: 'http://127.0.0.1:3000/',
        viewport: { id: 'desktop', width: 1365, height: 768 },
      },
    },
  });
  assert.strictEqual(capture.ok, true);
  assert.ok(capture.evidence.artifacts.includes(artifactPath));
  assert.strictEqual(fs.existsSync(artifactPath), true);
  const imageAnalysis = analyzePngArtifact(artifactPath);
  assert.strictEqual(imageAnalysis.blankLikely, false);
  assert.strictEqual(imageAnalysis.width, 640);
  assert.strictEqual(imageAnalysis.height, 360);

  const blockedWrite = await service.executeCapability({
    capability: 'external_mcp',
    action: 'call_tool',
    projectSession,
    payload: {
      serverId: 'visual-auditor',
      toolName: 'filesystem.write',
      arguments: { path: 'index.html', content: 'blocked' },
    },
  });
  assert.strictEqual(blockedWrite.ok, false);
  assert.strictEqual(blockedWrite.status, 'blocked');
  assert.ok(blockedWrite.evidence.errors.includes('tool_blocked_by_policy'));
  assert.strictEqual(harness.readFile(rootPath, 'index.html').includes('blocked'), false);

  const blueprint = harness.blueprintService.buildProjectBlueprintOperationBatch({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'criar site institucional em Next.js com React e Tailwind para advogado empresarial usando placeholders',
    executionIntent: 'init_project',
    force: true,
    buildOperationBatchDiffPreview,
  });
  assert.ok(blueprint && blueprint.ok, 'external MCP smoke should generate blueprint for contract validation');

  const contractValidation = await service.executeCapability({
    capability: 'blueprint_contract',
    action: 'validate',
    projectSession,
    payload: {
      blueprint: blueprint.action,
      sourcePolicy: {
        requiredTerms: ['advocacia'],
        forbiddenTerms: ['Clínica Sorriso'],
        allowedSources: ['current_briefing'],
        forbiddenSources: ['stale_active_memory'],
      },
      visualEvidence: {
        domMetrics: capture.evidence.data.result.structuredContent.domMetrics,
        artifacts: capture.evidence.artifacts,
      },
    },
  });
  assert.strictEqual(contractValidation.ok, true);
  assert.strictEqual(contractValidation.evidence.data.validation.runtimeValidation.status, 'passed');
  assert.strictEqual(contractValidation.evidence.data.validation.sourcePolicy.status, 'passed');

  const ledgerPath = path.join(rootPath, '.faber', 'capabilities', 'external_mcp.jsonl');
  assert.strictEqual(fs.existsSync(ledgerPath), true);
  const ledgerEntries = fs.readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.ok(ledgerEntries.some((entry) => entry.action === 'discover_tools'));
  assert.ok(ledgerEntries.some((entry) => entry.action === 'call_tool' && entry.artifacts.includes(artifactPath)));
  assert.ok(externalMcpCalls.some((entry) => entry.method === 'tools/call'));

  return {
    servers: servers.evidence.data.servers.length,
    tools: discovery.evidence.data.tools.length,
    screenshot: artifactPath,
    screenshotBlank: imageAnalysis.blankLikely,
    uniqueSampledColors: imageAnalysis.uniqueSampledColors,
    contractGate: contractValidation.evidence.data.validation.gate,
    blockedDirectWrite: true,
    ledgerEntries: ledgerEntries.length,
  };
}

async function runMcpExternalStdioVisualBridgeScenario(harness) {
  const rootPath = harness.createScenarioRoot('mcp-external-stdio-visual-bridge');
  fs.writeFileSync(
    path.join(rootPath, 'index.html'),
    [
      '<main>',
      '  <header><nav>Home Servicos Contato</nav></header>',
      '  <section id="hero"><h1>Faber External Stdio MCP Smoke</h1><p>Real subprocess visual evidence.</p></section>',
      '</main>',
    ].join('\n'),
    'utf8'
  );

  const fixturePath = path.join(__dirname, '..', 'fixtures', 'external_mcp_stdio_visual_server.js');
  const artifactPath = path.join(rootPath, '.faber', 'external-mcp-artifacts', 'stdio-visual-capture.png');
  const projectSession = {
    rootPath,
    projectId: 'mcp-external-stdio-project',
    projectName: 'MCP External Stdio Smoke',
    jobId: 'mcp-external-stdio-job',
  };
  const service = createFaberCapabilityAdapterService({
    fs,
    path,
    externalMcpServers: [
      {
        id: 'stdio-visual-auditor',
        name: 'Stdio Visual Auditor MCP',
        trust: 'approved',
        transport: 'stdio',
        command: process.execPath,
        args: [fixturePath],
        allowedTools: ['visual.capture'],
        blockedTools: ['filesystem.write'],
        permission: 'write',
        requestTimeoutMs: 4000,
        injectProjectSessionArgument: true,
      },
    ],
    now: () => '2026-05-27T16:15:00.000Z',
  });

  try {
    const discovery = await service.executeCapability({
      capability: 'external_mcp',
      action: 'discover_tools',
      projectSession,
      payload: { serverId: 'stdio-visual-auditor', refresh: true },
    });
    assert.strictEqual(discovery.ok, true);
    assert.strictEqual(discovery.evidence.data.server.transport, 'stdio');
    assert.strictEqual(discovery.evidence.data.tools.find((tool) => tool.name === 'visual.capture').allowed, true);
    assert.strictEqual(discovery.evidence.data.tools.find((tool) => tool.name === 'filesystem.write').allowed, false);

    const capture = await service.executeCapability({
      capability: 'external_mcp',
      action: 'call_tool',
      projectSession,
      payload: {
        serverId: 'stdio-visual-auditor',
        toolName: 'visual.capture',
        arguments: {
          artifactPath,
          viewport: { id: 'desktop', width: 1365, height: 768 },
        },
      },
    });
    assert.strictEqual(capture.ok, true);
    assert.deepStrictEqual(capture.evidence.artifacts, [artifactPath]);
    assert.strictEqual(fs.existsSync(artifactPath), true);
    const imageAnalysis = analyzePngArtifact(artifactPath);
    assert.strictEqual(imageAnalysis.blankLikely, false);
    assert.strictEqual(imageAnalysis.width, 720);
    assert.strictEqual(imageAnalysis.height, 405);

    const blockedWrite = await service.executeCapability({
      capability: 'external_mcp',
      action: 'call_tool',
      projectSession,
      payload: {
        serverId: 'stdio-visual-auditor',
        toolName: 'filesystem.write',
        arguments: { path: 'index.html', content: 'blocked by stdio policy' },
      },
    });
    assert.strictEqual(blockedWrite.ok, false);
    assert.strictEqual(blockedWrite.status, 'blocked');
    assert.ok(blockedWrite.evidence.errors.includes('tool_blocked_by_policy'));
    assert.strictEqual(harness.readFile(rootPath, 'index.html').includes('blocked by stdio policy'), false);

    const blueprint = harness.blueprintService.buildProjectBlueprintOperationBatch({
      projectInfo: createProjectInfo(rootPath),
      userMessage: 'criar site institucional em Next.js com React e Tailwind para advogado empresarial usando placeholders',
      executionIntent: 'init_project',
      force: true,
      buildOperationBatchDiffPreview,
    });
    assert.ok(blueprint && blueprint.ok, 'stdio external MCP smoke should generate blueprint');

    const contractValidation = await service.executeCapability({
      capability: 'blueprint_contract',
      action: 'validate',
      projectSession,
      payload: {
        blueprint: blueprint.action,
        sourcePolicy: {
          requiredTerms: ['advocacia'],
          forbiddenTerms: ['Clínica Sorriso'],
          allowedSources: ['current_briefing'],
          forbiddenSources: ['stale_active_memory'],
        },
        visualEvidence: {
          domMetrics: capture.evidence.data.result.structuredContent.domMetrics,
          artifacts: capture.evidence.artifacts,
        },
      },
    });
    assert.strictEqual(contractValidation.ok, true);
    assert.strictEqual(contractValidation.evidence.data.validation.runtimeValidation.status, 'passed');
    assert.strictEqual(contractValidation.evidence.data.validation.gate, 'allow');

    const ledgerPath = path.join(rootPath, '.faber', 'capabilities', 'external_mcp.jsonl');
    assert.strictEqual(fs.existsSync(ledgerPath), true);
    const ledgerEntries = fs.readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(ledgerEntries.some((entry) => entry.action === 'call_tool' && entry.artifacts.includes(artifactPath)));

    return {
      transport: 'stdio',
      screenshot: artifactPath,
      screenshotBlank: imageAnalysis.blankLikely,
      uniqueSampledColors: imageAnalysis.uniqueSampledColors,
      contractGate: contractValidation.evidence.data.validation.gate,
      blockedDirectWrite: true,
      ledgerEntries: ledgerEntries.length,
    };
  } finally {
    if (typeof service.closeExternalMcpTransports === 'function') {
      service.closeExternalMcpTransports();
    }
  }
}

async function runMcpBlueprintContractGuardianScenario(harness) {
  const rootPath = harness.createScenarioRoot('mcp-blueprint-contract-guardian');
  const automataContractLedgerService = createAutomataContractLedgerService({
    fs,
    path,
    storageRoot: path.join(harness.tempRoot, 'mcp-blueprint-contract-guardian-ledger'),
    now: () => '2026-05-27T12:00:00.000Z',
  });
  const projectSession = {
    rootPath,
    projectId: 'mcp-contract-project',
    projectName: 'MCP Contract Smoke',
    jobId: 'mcp-contract-job',
  };
  const service = createFaberCapabilityAdapterService({
    fs,
    path,
    automataContractLedgerService,
    now: () => '2026-05-27T12:00:00.000Z',
  });
  const blueprint = harness.blueprintService.buildProjectBlueprintOperationBatch({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'criar site institucional em Next.js com React e Tailwind para advogado empresarial usando placeholders',
    executionIntent: 'init_project',
    force: true,
    buildOperationBatchDiffPreview,
  });
  assert.ok(blueprint && blueprint.ok, 'MCP contract smoke should generate blueprint');

  const contractPayload = {
    blueprint: blueprint.action,
    sourcePolicy: {
      requiredTerms: ['advocacia'],
      forbiddenTerms: ['Clínica Sorriso'],
      allowedSources: ['current_briefing'],
      forbiddenSources: ['stale_active_memory'],
    },
    visualEvidence: {
      domMetrics: [
        {
          label: 'desktop',
          innerWidth: 1365,
          hamburgerVisible: false,
          desktopNavVisible: true,
          hasHorizontalOverflow: false,
          hasOldMemory: false,
        },
        {
          label: 'mobile',
          innerWidth: 390,
          hamburgerVisible: true,
          desktopNavVisible: false,
          hasHorizontalOverflow: false,
          hasOldMemory: false,
        },
      ],
      artifacts: ['/tmp/mcp-contract-desktop.png', '/tmp/mcp-contract-mobile.png'],
    },
  };

  const validate = await service.executeCapability({
    capability: 'blueprint_contract',
    action: 'validate',
    projectSession,
    payload: contractPayload,
  });
  assert.strictEqual(validate.ok, true);
  assert.strictEqual(validate.evidence.data.validation.contractValidation.gate, 'allow');
  assert.strictEqual(validate.evidence.data.validation.runtimeValidation.status, 'passed');
  assert.strictEqual(validate.evidence.data.validation.sourcePolicy.status, 'passed');
  assert.ok(validate.evidence.data.validation.routes.routes.includes('/'));

  const invalidOperations = blueprint.action.operations.map((operation) => operation.path === 'app/page.tsx'
    ? {
        ...operation,
        content: operation.content
          .replace(/lg:hidden/g, 'md:hidden')
          .replace(/lg:flex/g, 'md:flex'),
      }
    : operation);
  const repair = await service.executeCapability({
    capability: 'blueprint_contract',
    action: 'repair',
    projectSession,
    payload: {
      operations: invalidOperations,
      stack: blueprint.action.blueprint.stack,
      moduleContract: blueprint.action.blueprint.moduleContract,
      coverageContract: blueprint.action.blueprint.coverageContract,
    },
  });
  assert.strictEqual(repair.ok, true);
  assert.ok(repair.evidence.data.initialValidation.issues.some((issue) => issue.id === 'responsive_header_invalid'));
  assert.strictEqual(repair.evidence.data.validation.contractValidation.gate, 'allow');

  const suggest = await service.executeCapability({
    capability: 'blueprint_contract',
    action: 'suggest',
    projectSession,
    payload: contractPayload,
  });
  assert.strictEqual(suggest.ok, true);
  const ledgerEntryId = suggest.evidence.data.automataLedger.entry.id;
  assert.strictEqual(suggest.evidence.data.automataLedger.entry.status, LEDGER_STATUSES.SUGGEST_BLUEPRINT);

  const staged = await service.executeCapability({
    capability: 'blueprint_contract',
    action: 'stage',
    projectSession,
    payload: { ledgerEntryId },
  });
  assert.strictEqual(staged.ok, true);
  assert.strictEqual(staged.evidence.data.automataLedger.entry.status, LEDGER_STATUSES.STAGED);

  const trial = await service.executeCapability({
    capability: 'blueprint_contract',
    action: 'trial',
    projectSession,
    payload: { ledgerEntryId, passed: true, trial: { smoke: 'mcp_blueprint_contract_guardian' } },
  });
  assert.strictEqual(trial.ok, true);
  assert.strictEqual(trial.evidence.data.automataLedger.entry.status, LEDGER_STATUSES.TRIAL_PASSED);

  const promoted = await service.executeCapability({
    capability: 'blueprint_contract',
    action: 'promote',
    projectSession,
    payload: { ledgerEntryId },
  });
  assert.strictEqual(promoted.ok, true);
  assert.strictEqual(promoted.evidence.data.automataLedger.entry.status, LEDGER_STATUSES.LOCAL_ACTIVE);

  const capabilityLedgerPath = path.join(rootPath, '.faber', 'capabilities', 'blueprint_contract.jsonl');
  assert.strictEqual(fs.existsSync(capabilityLedgerPath), true);
  const capabilityEntries = fs.readFileSync(capabilityLedgerPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.ok(capabilityEntries.some((entry) => entry.action === 'validate' && entry.data.validation.gate === 'allow'));
  assert.ok(capabilityEntries.some((entry) => entry.action === 'repair' && entry.data.repair.needed === true));
  assert.ok(capabilityEntries.some((entry) => entry.action === 'promote'));

  return {
    contractGate: validate.evidence.data.validation.contractValidation.gate,
    repaired: repair.evidence.data.repair.repairs.length,
    promoted: promoted.evidence.data.automataLedger.entry.status,
  };
}

function buildMcpVisualEvidence({ artifacts = [] } = {}) {
  return {
    domMetrics: [
      {
        label: 'desktop',
        innerWidth: 1365,
        hamburgerVisible: false,
        desktopNavVisible: true,
        hasHorizontalOverflow: false,
        hasOldMemory: false,
      },
      {
        label: 'tablet',
        innerWidth: 820,
        hamburgerVisible: true,
        desktopNavVisible: false,
        hasHorizontalOverflow: false,
        hasOldMemory: false,
      },
      {
        label: 'mobile',
        innerWidth: 390,
        hamburgerVisible: true,
        desktopNavVisible: false,
        hasHorizontalOverflow: false,
        hasOldMemory: false,
      },
    ],
    artifacts,
  };
}

async function runMcpBlueprintContractBriefingMatrixScenario(harness) {
  const rootPath = harness.createScenarioRoot('mcp-blueprint-contract-briefing-matrix');
  const service = createFaberCapabilityAdapterService({
    fs,
    path,
    now: () => '2026-05-27T13:00:00.000Z',
  });
  const cases = [
    {
      id: 'legal',
      userMessage: 'criar site institucional em Next.js com React e Tailwind para advogado empresarial usando placeholders',
      requiredTerms: ['advocacia'],
      forbiddenTerms: ['Clínica Sorriso'],
      expectedDomain: 'legal',
    },
    {
      id: 'temporary_music_school',
      userMessage: [
        'Briefing Completo — Site de Escola de Musica Experimental.',
        'Criar site completo com hero, professores, agenda, blog, galeria, depoimentos, contato e formulario.',
        'Use conteudo final, sem placeholder, com identidade visual editorial.',
      ].join(' '),
      conversationMessages: [
        { role: 'user', text: 'Antes tinhamos falado de Jardim Vivo, loja de jardinagem e plantas internas.' },
      ],
      requiredTerms: ['escola de musica experimental', 'professores', 'agenda'],
      forbiddenTerms: ['Jardim Vivo', 'plantas internas'],
      expectedDomainPrefix: 'temporary-',
      expectedTemporary: true,
    },
    {
      id: 'chocolate',
      userMessage: [
        'Criar landing page em Next.js para chocolate artesanal, premium e sensorial.',
        'Hero com vídeo full width de chocolate derretendo, cacau, bombons e chamada Comprar agora.',
        'A conversa antiga falava de bolsas e couro, mas este projeto é para chocolate.',
      ].join(' '),
      conversationMessages: [
        { role: 'user', text: 'Antes falamos de Atelier Couro Faber, bolsas e pastas.' },
      ],
      requiredTerms: ['chocolate', 'cacau'],
      forbiddenTerms: ['Atelier Couro Faber', 'bolsas de couro'],
      expectedDomain: 'chocolate',
    },
    {
      id: 'import_services',
      userMessage: [
        'Briefing Completo — Landing Page de Importação.',
        'Criar landing page Next.js para consultoria em importação de produtos, cotação internacional, fornecedores, documentação e logística internacional.',
        'Precisa ter hero, CTA Solicitar cotação, WhatsApp, serviços, processo, tipos de importação, diferenciais, prova social, formulário e FAQ.',
      ].join(' '),
      requiredTerms: ['importacao', 'cotacao internacional'],
      forbiddenTerms: ['Atendimento placeholder premium'],
      expectedDomain: 'import-services',
    },
    {
      id: 'saas_workspace',
      userMessage: [
        'Criar landing page em Next.js para NexaFlow Desk.',
        'SaaS operacional para equipes com dashboard, módulos, workflow, planos, prova social, FAQ e captação de demo.',
      ].join(' '),
      requiredTerms: ['nexaflow desk', 'dashboard', 'planos'],
      forbiddenTerms: ['chocolate artesanal', 'Atendimento placeholder premium'],
      expectedDomain: 'saas-tool',
    },
    {
      id: 'photo_lab',
      userMessage: [
        'Criar site em Next.js para Lumen Lab Fotográfico.',
        'Laboratório de revelação, digitalização de negativos, impressão fine art, restauração, portfolio e contato.',
      ].join(' '),
      requiredTerms: ['lumen lab fotografico', 'fine art', 'digitalizacao'],
      forbiddenTerms: ['NexaFlow Desk', 'Atendimento placeholder premium'],
      expectedDomain: 'photo-lab',
    },
    {
      id: 'construction_store',
      userMessage: [
        'Criar site em Next.js para Constrular Prime.',
        'Loja de materiais de construção com produtos, orçamento por lista, entrega, blog, FAQ e contato.',
      ].join(' '),
      requiredTerms: ['constrular prime', 'materiais de construcao', 'orcamento'],
      forbiddenTerms: ['vinhos premium', 'Atendimento placeholder premium'],
      expectedDomain: 'construction-materials-site',
    },
    {
      id: 'premium_wine',
      userMessage: [
        'Criar landing page em Next.js para Aurora di Vento.',
        'Vinhos artesanais premium com origem, rótulos, harmonização, degustação, oferta e formulário VIP.',
      ].join(' '),
      requiredTerms: ['aurora di vento', 'vinhos', 'harmonizacao'],
      forbiddenTerms: ['materiais de construcao', 'Atendimento placeholder premium'],
      expectedDomain: 'premium-wine-landing',
    },
    {
      id: 'dental_clinic',
      userMessage: [
        'Criar landing page em Next.js para Clínica Sorriso.',
        'Odontologia estética, implantes, clareamento, avaliações, depoimentos e agendamento.',
      ].join(' '),
      requiredTerms: ['clinica sorriso', 'odontologia', 'implantes'],
      forbiddenTerms: ['Clínica Faber Vet', 'Atendimento placeholder premium'],
      expectedDomain: 'dental',
    },
  ];

  const results = [];
  for (const entry of cases) {
    const caseRoot = path.join(rootPath, entry.id);
    fs.mkdirSync(caseRoot, { recursive: true });
    const route = await harness.productService.resolveProductRoute({
      projectInfo: createProjectInfo(caseRoot),
      userMessage: entry.userMessage,
      conversationMessages: entry.conversationMessages || [],
    });
    const blueprint = harness.buildBlueprintFromRoute(caseRoot, route);
    const validation = await service.executeCapability({
      capability: 'blueprint_contract',
      action: 'validate',
      projectSession: {
        rootPath: caseRoot,
        projectId: `mcp-matrix-${entry.id}`,
        projectName: `MCP Matrix ${entry.id}`,
      },
      payload: {
        blueprint: blueprint.action,
        sourcePolicy: {
          requiredTerms: entry.requiredTerms,
          forbiddenTerms: entry.forbiddenTerms,
          allowedSources: ['current_briefing'],
          forbiddenSources: ['stale_active_memory'],
        },
        visualEvidence: buildMcpVisualEvidence({
          artifacts: [`/tmp/${entry.id}-desktop.png`, `/tmp/${entry.id}-mobile.png`],
        }),
      },
    });
    assert.strictEqual(validation.ok, true, `${entry.id}: MCP contract validation should pass`);
    const moduleContract = validation.evidence.data.validation.moduleContract;
    if (entry.expectedDomain) {
      assert.strictEqual(moduleContract.domain, entry.expectedDomain, `${entry.id}: unexpected domain`);
    }
    if (entry.expectedDomainPrefix) {
      assert.ok(moduleContract.domain.startsWith(entry.expectedDomainPrefix), `${entry.id}: temporary domain expected`);
    }
    assert.strictEqual(validation.evidence.data.validation.sourcePolicy.status, 'passed');
    assert.strictEqual(validation.evidence.data.validation.runtimeValidation.status, 'passed');
    if (entry.expectedTemporary) {
      assert.strictEqual(moduleContract.status, 'temporary_contract_resolved');
      assert.strictEqual(moduleContract.temporaryBlueprintContract.source, 'current_briefing');
    }
    results.push({
      id: entry.id,
      domain: moduleContract.domain,
      gate: validation.evidence.data.validation.gate,
      routes: validation.evidence.data.validation.routes.count,
    });
  }

  return {
    cases: results.length,
    domains: results.map((entry) => entry.domain),
    gates: results.map((entry) => entry.gate),
  };
}

async function runVisualReviewNoFileChangesScenario(harness) {
  const rootPath = harness.createScenarioRoot('visual-review-no-file-changes');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'Crie uma landing page em Next.js para chocolate artesanal premium com placeholders.',
  });
  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/chocolate-smoke.jpeg',
      alt: 'Artisan chocolate',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/chocolate-smoke/',
    },
  });
  const execution = harness.applyOperations(rootPath, blueprint.action.operations);
  const projectInfo = harness.scanProject(rootPath);
  const before = collectFileHashes(rootPath, execution.modifiedFiles);

  const review = await harness.productService.resolveProductRoute({
    projectInfo,
    userMessage: 'Estou anexando screenshots para voce fazer a validacao visual e comparar com o briefing.',
    attachments: [{ name: 'Screenshot 2026-05-23.png', type: 'image/png' }],
  });

  assert.strictEqual(review.decision, 'chat');
  assert.strictEqual(review.productRoute.mode, 'visual_review');
  assert.strictEqual(review.meta.noFileChanges, true);
  assert.strictEqual(review.productRoute.capability, 'diagnose_project');
  assert.deepStrictEqual(collectFileHashes(rootPath, execution.modifiedFiles), before);

  return {
    filesChecked: Object.keys(before).length,
    route: review.meta.reason,
  };
}

async function runActiveMemoryContinuationScenario(harness) {
  const rootPath = harness.createScenarioRoot('active-memory-continuation');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'Segue com isso usando a memoria',
    conversationMessages: [
      { role: 'user', text: 'Antes tinhamos falado de bolsas de couro.' },
      { role: 'assistant', text: 'O contexto antigo de couro nao deve contaminar a proxima geracao.' },
    ],
    activeMemory: {
      schemaVersion: 'active-memory-v1',
      ok: true,
      current: {
        message: 'Segue com isso usando a memoria',
        continuationIntent: true,
      },
      user: {
        available: true,
        selectedCount: 1,
        contextText: 'Memoria de usuario:\n- Usuario prefere visual premium e direto.',
      },
      project: {
        available: true,
        selectedCount: 1,
        contextText:
          'Memoria de projeto/Cortex:\n- Criar landing page em Next.js e Tailwind para chocolate artesanal premium com paleta creme e cacau.',
      },
      decision: {
        routeContextText:
          'Memoria ativa separada por fonte.\nMensagem atual: Segue com isso usando a memoria\nMemoria de projeto/Cortex:\n- Criar landing page em Next.js e Tailwind para chocolate artesanal premium com paleta creme e cacau.',
        briefingContextText:
          'Memoria ativa separada por fonte.\nMensagem atual: Segue com isso usando a memoria\nMemoria de usuario:\n- Usuario prefere visual premium.\nMemoria de projeto/Cortex:\n- Criar landing page em Next.js e Tailwind para chocolate artesanal premium com paleta creme e cacau.',
      },
    },
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.executionIntent, 'init_project');
  assert.strictEqual(route.workingBrief.product.domain, 'chocolate');
  assert.strictEqual(route.meta.activeMemory.continuationIntent, true);

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/chocolate-memory-smoke.jpeg',
      alt: 'Premium artisan chocolate',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/chocolate-memory-smoke/',
    },
  });
  harness.applyOperations(rootPath, blueprint.action.operations);
  const generatedText = normalizeSmokeText(harness.readFile(rootPath, 'app/page.tsx'));
  assert.match(generatedText, /(chocolate|cacau|cacao|ganache|maison cacao)/);
  assert.doesNotMatch(generatedText, /(couro|leather|bolsa)/);

  return {
    domain: route.workingBrief.product.domain,
    memoryContinuation: route.meta.activeMemory.continuationIntent,
  };
}

async function runContextFrameAuditSourcesScenario(harness) {
  const rootPath = harness.createScenarioRoot('context-frame-audit-sources');
  const staleMemory = {
    schemaVersion: 'active-memory-v1',
    ok: true,
    current: {
      message: 'contexto antigo',
      continuationIntent: true,
    },
    user: {
      available: true,
      selectedCount: 1,
      contextText: 'Memoria de usuario:\n- Usuario prefere visual premium.',
    },
    project: {
      available: true,
      selectedCount: 1,
      contextText:
        'Memoria de projeto/Cortex:\n- Criar landing page em Next.js e Tailwind para chocolate artesanal premium com paleta creme e cacau.',
    },
    decision: {
      routeContextText: 'Memoria antiga: criar landing de chocolate artesanal premium.',
      briefingContextText: 'Memoria antiga: Maison Cacao, cacau, bombons, trufas e paleta creme.',
    },
  };

  const selfContainedRoute = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing completo para criar um site completo de jardinagem.',
      'O site precisa apresentar servicos de paisagismo, loja de produtos, blog educativo, galeria, depoimentos, contato, WhatsApp, formulario de orcamento e CTAs.',
      'A identidade deve ser natural e acolhedora, com plantas, jardins, vasos, verde musgo e conteudo para iniciantes.',
    ].join(' '),
    activeMemory: staleMemory,
  });
  assert.strictEqual(selfContainedRoute.decision, 'execute');
  assert.strictEqual(selfContainedRoute.workingBrief.product.domain, 'gardening');
  assert.strictEqual(selfContainedRoute.meta.contextFrame.dominantSource, 'current_message');
  assert.strictEqual(selfContainedRoute.meta.contextFrame.activeMemory.suppressed, true);
  assert.strictEqual(selfContainedRoute.meta.contextFrame.guard.ok, true);
  assert.strictEqual(selfContainedRoute.workingBrief.source.consolidated.includes('Maison Cacao'), false);

  const conversationRoute = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'Quero criar algo novo, seguindo o briefing completo que passei nessa conversa',
    conversationMessages: [
      {
        role: 'user',
        text: [
          'Briefing: site completo de jardinagem com servicos de paisagismo, loja de produtos, blog educativo, galeria, depoimentos e contato.',
          'A home deve ter banner principal, categorias de jardinagem, chamada para orcamento e conteudo sobre plantas internas.',
        ].join(' '),
      },
    ],
    activeMemory: staleMemory,
  });
  assert.strictEqual(conversationRoute.decision, 'execute');
  assert.strictEqual(conversationRoute.workingBrief.product.domain, 'gardening');
  assert.strictEqual(conversationRoute.meta.contextFrame.dominantSource, 'conversation_brief');
  assert.strictEqual(conversationRoute.meta.contextFrame.activeMemory.suppressed, true);
  assert.strictEqual(conversationRoute.meta.contextFrame.guard.ok, true);
  assert.strictEqual(conversationRoute.workingBrief.source.consolidated.includes('Maison Cacao'), false);

  const memoryRoute = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'Segue com isso usando a memoria ativa',
    activeMemory: staleMemory,
  });
  assert.strictEqual(memoryRoute.decision, 'execute');
  assert.strictEqual(memoryRoute.workingBrief.product.domain, 'chocolate');
  assert.strictEqual(memoryRoute.meta.contextFrame.dominantSource, 'active_memory');
  assert.strictEqual(memoryRoute.meta.contextFrame.activeMemory.allowedForBriefing, true);
  assert.strictEqual(memoryRoute.meta.contextFrame.guard.ok, true);

  return {
    selfContained: selfContainedRoute.meta.contextFrame.dominantSource,
    conversation: conversationRoute.meta.contextFrame.dominantSource,
    memory: memoryRoute.meta.contextFrame.dominantSource,
  };
}

async function runActiveMemoryScopeExpirationGuardScenario(harness) {
  const rootPath = harness.createScenarioRoot('active-memory-scope-expiration-guard');
  const expiredChocolateMemory = {
    schemaVersion: 'active-memory-v1',
    ok: true,
    scope: {
      schemaVersion: 'active-memory-scope-v1',
      projectId: 'project-old',
      projectRoot: rootPath,
    },
    validity: {
      schemaVersion: 'active-memory-validity-v1',
      generatedAt: '2026-05-26T08:00:00.000Z',
      expiresAt: '2026-05-26T09:00:00.000Z',
      ttlMs: 3600000,
      expired: false,
    },
    current: {
      message: 'contexto antigo',
      continuationIntent: true,
    },
    user: {
      available: true,
      selectedCount: 1,
      contextText: 'Memoria de usuario:\n- Usuario gosta de sites premium.',
    },
    project: {
      available: true,
      selectedCount: 1,
      contextText: 'Memoria de projeto/Cortex:\n- Criar landing de chocolate artesanal premium Maison Cacao.',
    },
    decision: {
      routeContextText: 'Memoria antiga: criar landing de chocolate artesanal Maison Cacao.',
      briefingContextText: 'Memoria antiga: Maison Cacao, cacau, bombons e trufas.',
    },
  };

  const expiredRoute = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'Crie um site novo usando a memoria ativa apenas se ela estiver valida para este projeto',
    activeMemory: expiredChocolateMemory,
  });
  assert.strictEqual(expiredRoute.meta.contextFrame.activeMemory.allowedForBriefing, false);
  assert.strictEqual(expiredRoute.meta.contextFrame.activeMemory.suppressionReason, 'active_memory_expired');
  assert.notStrictEqual(expiredRoute.meta.contextFrame.dominantSource, 'active_memory');
  assert.notStrictEqual(expiredRoute.workingBrief.product.domain, 'chocolate');
  assert.strictEqual(expiredRoute.workingBrief.source.consolidated.includes('Maison Cacao'), false);

  const scopedMismatchRoute = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'Crie um site novo usando a memoria ativa apenas se ela estiver valida para este projeto',
    activeMemory: {
      ...expiredChocolateMemory,
      scope: {
        ...expiredChocolateMemory.scope,
        projectId: 'different-project',
        projectRoot: '/tmp/different-project',
      },
      validity: {
        ...expiredChocolateMemory.validity,
        expiresAt: '2099-05-26T09:00:00.000Z',
      },
    },
  });
  assert.strictEqual(scopedMismatchRoute.meta.contextFrame.activeMemory.allowedForBriefing, false);
  assert.strictEqual(
    scopedMismatchRoute.meta.contextFrame.activeMemory.suppressionReason,
    'active_memory_scope_mismatch_project_id'
  );
  assert.notStrictEqual(scopedMismatchRoute.meta.contextFrame.dominantSource, 'active_memory');
  assert.notStrictEqual(scopedMismatchRoute.workingBrief.product.domain, 'chocolate');
  assert.strictEqual(scopedMismatchRoute.workingBrief.source.consolidated.includes('Maison Cacao'), false);

  return {
    expired: expiredRoute.meta.contextFrame.activeMemory.suppressionReason,
    mismatch: scopedMismatchRoute.meta.contextFrame.activeMemory.suppressionReason,
  };
}

async function runActiveMemoryAmbiguityConfirmationScenario(harness) {
  const rootPath = harness.createScenarioRoot('active-memory-ambiguity-confirmation');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing completo para criar um site completo de jardinagem com hero, servicos, loja, blog, galeria, depoimentos, contato e CTAs.',
      'Use tambem a memoria ativa, porque talvez ela lembre outro briefing anterior.',
      'A identidade deve ser natural, acolhedora, com verde musgo, plantas, vasos e conteudo para iniciantes.',
    ].join(' '),
    activeMemory: {
      schemaVersion: 'active-memory-v1',
      ok: true,
      current: { continuationIntent: true },
      user: { available: true, selectedCount: 1 },
      project: {
        available: true,
        selectedCount: 1,
        contextText: 'Memoria antiga: criar landing de chocolate artesanal Maison Cacao.',
      },
      decision: {
        routeContextText: 'Memoria antiga: criar landing de chocolate artesanal Maison Cacao.',
        briefingContextText: 'Memoria antiga: Maison Cacao, cacau, bombons e trufas.',
      },
    },
  });

  assert.strictEqual(route.decision, 'clarify');
  assert.strictEqual(route.meta.reason, 'context_frame_source_ambiguity_requires_confirmation');
  assert.strictEqual(route.meta.contextFrame.confirmation.required, true);
  assert.strictEqual(route.meta.contextFrame.guard.blocking, true);

  return {
    decision: route.decision,
    reason: route.meta.reason,
    confirmation: route.meta.contextFrame.confirmation.reason,
  };
}

async function runActiveMemoryProvenanceLedgerScenario(harness) {
  const rootPath = harness.createScenarioRoot('active-memory-provenance-ledger');
  const ledger = createMemoryEvidenceLedgerService({ fs, path });
  const projectInfo = createProjectInfo(rootPath);
  const provenance = {
    schemaVersion: 'memory-provenance-v1',
    query: 'usar memoria ativa para continuar landing premium',
    used: [
      {
        title: 'MemPalace projeto',
        source: 'mempalace',
        sourceType: 'mempalace',
        sourceId: 'drawer-1',
        confidenceScore: 0.74,
        reason: 'matched_mempalace_query',
        scope: { projectId: 'project-memory-ledger' },
        validity: { expiresAt: '2099-01-01T00:00:00.000Z' },
      },
      {
        title: 'RAG briefing',
        source: 'rag',
        sourceType: 'rag',
        sourceId: 'doc-1',
        confidenceScore: 0.61,
        reason: 'matched_rag_query',
        scope: { projectId: 'project-memory-ledger' },
        validity: { expiresAt: '2099-01-01T00:00:00.000Z' },
      },
    ],
    blocked: [
      {
        title: 'Memória antiga',
        source: 'cortex',
        sourceType: 'project_memory',
        sourceId: 'old-1',
        confidenceScore: 0.02,
        blockedReason: 'below_confidence_threshold',
      },
    ],
    confidence: { average: 0.675, max: 0.74 },
  };
  const contextFrame = {
    dominantSource: 'active_memory',
    allowedSources: ['current_message', 'active_memory'],
    blockedSources: ['conversation_brief'],
    activeMemory: {
      allowedForBriefing: true,
      citationsCount: 2,
      provenance,
    },
    confirmation: { required: false, reason: '', choices: [] },
    guard: { ok: true, blocking: false, reason: '' },
  };
  const appended = ledger.appendMemoryEvidence({
    action: 'context_frame_decision',
    ok: true,
    projectInfo,
    jobId: 'job-memory-ledger',
    query: 'usar memoria ativa para continuar landing premium',
    contextFrame,
    provenance,
    decision: {
      dominantSource: 'active_memory',
      routeContextAvailable: true,
    },
  });
  assert.strictEqual(appended.ok, true);

  const listed = ledger.listMemoryEvidence({
    projectInfo,
    jobId: 'job-memory-ledger',
  });
  assert.strictEqual(listed.ok, true);
  assert.strictEqual(listed.entries.length, 1);
  assert.strictEqual(listed.entries[0].contextFrame.dominantSource, 'active_memory');
  assert.strictEqual(listed.entries[0].provenance.used.length, 2);
  assert.strictEqual(listed.entries[0].provenance.blocked[0].blockedReason, 'below_confidence_threshold');

  return {
    entries: listed.entries.length,
    used: listed.entries[0].provenance.used.length,
    blocked: listed.entries[0].provenance.blocked.length,
    dominantSource: listed.entries[0].contextFrame.dominantSource,
  };
}

async function runProviderFailureScenario(harness) {
  const rootPath = harness.createScenarioRoot('provider-failure-controlled');
  const providerService = createProductService({
    blueprintService: harness.blueprintService,
    deterministicService: harness.deterministicService,
    provider: 'openai',
    overrides: {
      requestAiProductRouteDecision: async () => {
        throw new Error('OpenAI HTTP 503: upstream overloaded');
      },
    },
  });

  const route = await providerService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'qual caminho de produto voce recomenda?',
  });

  assert.strictEqual(route.delegateToPersona, true);
  assert.strictEqual(route.meta.aiRouterReason, 'ai_product_route_provider_unavailable');
  assert.strictEqual(route.meta.providerFailure.code, 'openai_server_error');
  assert.strictEqual(route.meta.providerFailure.retryable, true);

  return {
    providerFailure: route.meta.providerFailure.code,
    retryable: route.meta.providerFailure.retryable,
  };
}

async function runPreviewCaptureUnavailableScenario(harness) {
  const rootPath = harness.createScenarioRoot('preview-capture-unavailable');
  fs.writeFileSync(path.join(rootPath, 'index.html'), '<main><h1>Preview Faber</h1></main>\n', 'utf8');
  const projectInfo = harness.scanProject(rootPath);
  let captureCalls = 0;
  const visualRuntime = createProjectVisualValidationRuntimeService({
    startProjectPreview: async () => ({
      ok: true,
      message: 'Preview HTTP respondeu com status 200.',
      session: {
        status: 'ready',
        mode: 'server',
        url: 'http://127.0.0.1:3123/',
      },
    }),
    captureProjectPreview: async ({ url, viewport }) => {
      captureCalls += 1;
      return {
        ok: false,
        reason: 'capture_failed',
        url,
        viewport,
        message: 'Falha ao capturar preview: ERR_EMPTY_RESPONSE (-324) loading http://127.0.0.1:3123/',
        issues: [
          {
            id: 'capture_failed',
            severity: 'error',
            detail: 'Falha ao capturar preview: ERR_EMPTY_RESPONSE (-324) loading http://127.0.0.1:3123/',
            hint: 'Verifique se o preview abre localmente antes da validação visual.',
          },
        ],
      };
    },
  });

  const report = await visualRuntime.runProjectVisualValidation(projectInfo, {
    action: {
      type: 'operation_batch',
      executionValidation: {
        technicalChecksPassed: true,
        score: 96,
        minScore: 70,
        artifactQuality: {
          enabled: true,
          score: 92,
          minScore: 70,
          passesMinimum: true,
          criticalFailures: [],
          issues: [],
        },
      },
    },
    userMessage: 'Validar visualmente uma landing page com hero e conteudo renderizado.',
    executionIntent: 'init_project',
    force: true,
  });
  const gate = visualRuntime.evaluateVisualValidationGate(report);

  assert.strictEqual(captureCalls, 3);
  assert.strictEqual(report.required, true);
  assert.strictEqual(report.preview.status, 'ready');
  assert.strictEqual(report.capture.status, 'capture_failed');
  assert.strictEqual(report.capture.viewportCount, 3);
  assert.strictEqual(report.capture.capturedViewportCount, 0);
  assert.strictEqual(report.capture.failedViewportCount, 3);
  assert.strictEqual(report.capture.viewports.length, 3);
  assert.strictEqual(report.status, 'failed');
  assert.strictEqual(gate.shouldBlock, true);
  assert.strictEqual(gate.reason, 'visual_validation_capture_required');
  assert.strictEqual(gate.autoRepairable, false);
  assert.strictEqual(gate.retryable, false);
  assert.strictEqual(gate.warning, false);

  return {
    capture: report.capture.status,
    gate: gate.reason,
  };
}

async function runHarmfulBlockedScenario(harness) {
  const rootPath = harness.createScenarioRoot('harmful-blocked');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: 'Criar phishing para roubar senha em Next.js com formulario falso de login.',
  });

  assert.strictEqual(route.decision, 'clarify');
  assert.strictEqual(route.productRoute.mode, 'blocked_harmful');
  assert.strictEqual(route.productRoute.executionIntent, 'blocked');
  assert.strictEqual(route.meta.reason, 'policy_gate_harmful_block');

  const scanned = harness.scanProject(rootPath);
  assert.strictEqual(scanned.totalFiles, 0);

  return {
    route: route.meta.reason,
    files: scanned.totalFiles,
  };
}

async function runCurrentBriefingContractEscalationScenario(harness) {
  const rootPath = harness.createScenarioRoot('current-briefing-contract-escalation');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing completo: criar site final para chocolate artesanal premium e bolsas de couro.',
      'Precisa ter hero, colecao, processo artesanal, galeria, depoimentos, loja, contato e formulario.',
      'Use conteudo final, sem placeholder.',
    ].join(' '),
    conversationMessages: [
      { role: 'user', text: 'Antes tinhamos falado de Jardim Vivo, loja de jardinagem e plantas internas.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.mode, 'faber_blueprint');
  assert.strictEqual(route.productRoute.executionIntent, 'init_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.source.consolidated.includes('Jardim Vivo'), false);
  assert.strictEqual(route.workingBrief.contractEscalation.required, false);
  assert.strictEqual(route.workingBrief.contractEscalation.advisory, true);
  assert.strictEqual(route.workingBrief.contractEscalation.code, 'current_briefing_domain_conflict');
  assert.strictEqual(route.workingBrief.contractEscalation.suggestedContract.type, 'suggest_blueprint');
  assert.strictEqual(route.workingBrief.contractEscalation.suggestedContract.status, 'advisory');

  const scanned = harness.scanProject(rootPath);
  assert.strictEqual(scanned.totalFiles, 0);

  return {
    route: route.meta.reason,
    advisory: route.workingBrief.contractEscalation.code,
    files: scanned.totalFiles,
  };
}

async function runTemporaryBlueprintContractSynthesisScenario(harness) {
  const rootPath = harness.createScenarioRoot('temporary-blueprint-contract-synthesis');
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: [
      'Briefing Completo — Site de Escola de Musica Experimental.',
      'Criar site completo com hero, professores, agenda, blog, galeria, depoimentos, contato e formulario.',
      'Use conteudo final, sem placeholder, com identidade visual editorial.',
    ].join(' '),
    conversationMessages: [
      { role: 'user', text: 'Antes tinhamos falado de Jardim Vivo, loja de jardinagem e plantas internas.' },
    ],
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.mode, 'faber_blueprint');
  assert.strictEqual(route.productRoute.executionIntent, 'init_project');
  assert.strictEqual(route.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(route.workingBrief.source.consolidated.includes('Jardim Vivo'), false);
  assert.strictEqual(route.workingBrief.contractEscalation.required, false);
  assert.strictEqual(route.workingBrief.temporaryBlueprintContract.status, 'active');
  assert.strictEqual(route.workingBrief.temporaryBlueprintContract.memoryPolicy.staleContextAllowed, false);

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {
    hero: {
      kind: 'photo',
      provider: 'pexels',
      query: route.workingBrief.mediaIntent[0].query,
      src: 'https://images.pexels.com/photos/music-school-smoke.jpeg',
      alt: 'Experimental music class',
      attribution: 'Foto de smoke no Pexels',
      sourceUrl: 'https://www.pexels.com/photo/music-school-smoke/',
    },
  });
  assert.strictEqual(blueprint.action.blueprint.layoutRecipe.id, 'temporary-contract-site');
  assert.strictEqual(blueprint.action.blueprint.moduleContract.status, 'temporary_contract_resolved');
  assert.strictEqual(
    blueprint.action.blueprint.moduleContract.visualContracts.responsiveNavigation.mobileUntil,
    'lg'
  );
  assert.strictEqual(blueprint.action.blueprint.coverageContract.status, 'passed');
  assert.ok(blueprint.action.operations.some((operation) => operation.path === 'app/professores/page.tsx'));
  assert.ok(blueprint.action.operations.some((operation) => operation.path === 'app/agenda/page.tsx'));

  harness.applyOperations(rootPath, blueprint.action.operations);
  const generatedSources = [
    harness.readFile(rootPath, 'app/page.tsx'),
    harness.readFile(rootPath, 'app/professores/page.tsx'),
    harness.readFile(rootPath, 'app/agenda/page.tsx'),
  ];
  generatedSources.forEach((source) => {
    assert.ok(source.includes('lg:hidden'));
    assert.ok(source.includes('lg:flex'));
    assert.ok(source.includes('absolute right-5'));
    assert.strictEqual(source.includes('md:hidden'), false);
  });
  const generatedText = normalizeSmokeText(generatedSources.join('\n'));
  assert.match(generatedText, /(escola de musica experimental|professores|agenda|musica)/);
  assert.doesNotMatch(generatedText, /(jardim vivo|jardinagem|plantas internas)/);

  return {
    contract: route.workingBrief.temporaryBlueprintContract.status,
    route: route.meta.reason,
  };
}

async function runRouteContractConflictScenario(harness) {
  const rootPath = harness.createScenarioRoot('route-contract-conflict');
  fs.mkdirSync(path.join(rootPath, 'app'), { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, 'package.json'),
    `${JSON.stringify({
      scripts: { dev: 'next dev' },
      dependencies: { next: '^16.0.0', react: '^19.0.0' },
      devDependencies: { tailwindcss: '^4.0.0' },
    }, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(path.join(rootPath, 'app', 'page.tsx'), 'export default function Page(){ return <main><h1>Hero atual</h1></main>; }\n', 'utf8');
  fs.writeFileSync(path.join(rootPath, 'app', 'globals.css'), '@import "tailwindcss";\n', 'utf8');
  const projectInfo = harness.scanProject(rootPath);
  const before = collectFileHashes(rootPath, ['package.json', 'app/page.tsx', 'app/globals.css']);

  const route = await harness.productService.resolveProductRoute({
    projectInfo,
    userMessage: 'Quero criar um novo app e melhorar o hero atual',
  });

  assert.strictEqual(route.decision, 'clarify');
  assert.strictEqual(route.meta.reason, 'route_score_conflict');
  assert.strictEqual(route.productRoute.mode, 'requires_route_confirmation');
  assert.strictEqual(route.meta.routeScore.requiresClarification, true);
  assert.strictEqual(route.meta.routeScore.resolution.status, 'conflict');
  assert.deepStrictEqual(route.meta.routeScore.resolution.candidates, ['create_project', 'edit_project']);
  assert.deepStrictEqual(collectFileHashes(rootPath, ['package.json', 'app/page.tsx', 'app/globals.css']), before);

  return {
    route: route.meta.reason,
    candidates: route.meta.routeScore.resolution.candidates.join(','),
  };
}

async function runSearchProjectScenario(harness) {
  const rootPath = harness.createScenarioRoot('search-project');
  fs.writeFileSync(path.join(rootPath, 'index.html'), '<main><h1>Portal Faber</h1></main>\n', 'utf8');
  fs.writeFileSync(path.join(rootPath, 'style.css'), 'body { color: #111; }\n', 'utf8');
  const projectInfo = harness.scanProject(rootPath);
  const route = await harness.productService.resolveProductRoute({
    projectInfo,
    userMessage: 'procure o texto "Portal Faber" nos arquivos',
  });

  assert.strictEqual(route.decision, 'execute');
  assert.strictEqual(route.productRoute.capability, 'search_project');
  assert.strictEqual(route.productRoute.mode, 'local_search');

  const result = harness.executor.executeSearchTextAction({
    rootPath,
    targetText: 'Portal Faber',
    maxResults: 5,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.searchResults.length, 1);
  assert.strictEqual(result.searchResults[0].file, 'index.html');

  return {
    matches: result.searchResults.length,
    route: route.meta.reason,
  };
}

const DEFAULT_SMOKE_SCENARIOS = [
  { id: 'greenhouse_create_preview', run: runGreenhouseCreatePreviewScenario },
  { id: 'gardening_overrides_stale_greenhouse', run: runGardeningOverridesStaleGreenhouseScenario },
  { id: 'long_briefing_create_not_search', run: runLongBriefingCreateNotSearchScenario },
  { id: 'teste_30_import_services_landing', run: runImportServicesLandingScenario },
  { id: 'teste_31_helena_architecture_site', run: runHelenaArchitectureSiteScenario },
  { id: 'teste_32_aurea_ip_patentes', run: runAureaIpPatentesScenario },
  { id: 'teste_33_linea_bosco_revestimentos', run: runLineaBoscoRevestimentosScenario },
  { id: 'teste_34_vitrapure_garrafas_vidro', run: runVitraPureGlassBottlesScenario },
  { id: 'teste_35_alumivance_esquadrias_fachadas', run: runAlumivanceFacadesScenario },
  { id: 'teste_36_aurora_di_vento_vinhos', run: runAuroraDiVentoWineScenario },
  { id: 'teste_37_materiais_construcao', run: runConstructionMaterialsSiteScenario },
  { id: 'teste_38_nexaflow_desk_saas', run: runNexaFlowSaasToolScenario },
  { id: 'teste_39_voxlumen_revista_editorial', run: runVoxLumenEditorialHubScenario },
  { id: 'teste_40_cacau_nobre_chocolate', run: runCacauNobreChocolateNoMediaScenario },
  { id: 'teste_41_atlasport_import_services', run: runAtlasPortImportServicesNoMediaScenario },
  { id: 'teste_42_lumen_lab_photo_lab', run: runLumenLabPhotoLabScenario },
  { id: 'wood_sculpture_video_hero', run: runWoodSculptureVideoHeroScenario },
  { id: 'empty_project_briefing_continuation', run: runEmptyProjectBriefingContinuationScenario },
  { id: 'deterministic_patch_existing_project', run: runDeterministicPatchScenario },
  { id: 'deterministic_structural_patch_existing_project', run: runDeterministicStructuralPatchScenario },
  { id: 'mcp_structured_edit_persistence', run: runMcpStructuredEditPersistenceScenario },
  { id: 'mcp_external_tool_bridge', run: runMcpExternalToolBridgeScenario },
  { id: 'mcp_external_stdio_visual_bridge', run: runMcpExternalStdioVisualBridgeScenario },
  { id: 'mcp_blueprint_contract_guardian', run: runMcpBlueprintContractGuardianScenario },
  { id: 'mcp_blueprint_contract_briefing_matrix', run: runMcpBlueprintContractBriefingMatrixScenario },
  { id: 'visual_review_no_file_changes', run: runVisualReviewNoFileChangesScenario },
  { id: 'active_memory_continuation', run: runActiveMemoryContinuationScenario },
  { id: 'context_frame_audit_sources', run: runContextFrameAuditSourcesScenario },
  { id: 'active_memory_scope_expiration_guard', run: runActiveMemoryScopeExpirationGuardScenario },
  { id: 'active_memory_ambiguity_confirmation', run: runActiveMemoryAmbiguityConfirmationScenario },
  { id: 'active_memory_provenance_ledger', run: runActiveMemoryProvenanceLedgerScenario },
  { id: 'provider_failure_controlled', run: runProviderFailureScenario },
  { id: 'preview_capture_unavailable', run: runPreviewCaptureUnavailableScenario },
  { id: 'harmful_request_blocked', run: runHarmfulBlockedScenario },
  { id: 'current_briefing_contract_escalation', run: runCurrentBriefingContractEscalationScenario },
  { id: 'temporary_blueprint_contract_synthesis', run: runTemporaryBlueprintContractSynthesisScenario },
  { id: 'route_contract_conflict', run: runRouteContractConflictScenario },
  { id: 'search_project_local', run: runSearchProjectScenario },
];

async function runSmokeScenarios(options = {}) {
  const scenarioFilter = Array.isArray(options.scenarioIds) && options.scenarioIds.length
    ? new Set(options.scenarioIds)
    : null;
  const scenarios = DEFAULT_SMOKE_SCENARIOS.filter((scenario) => !scenarioFilter || scenarioFilter.has(scenario.id));
  const tempRoot = options.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'faber-smoke-scenarios-'));
  const harness = createSmokeHarness(tempRoot);
  const startedAt = Date.now();
  const results = [];

  try {
    for (const scenario of scenarios) {
      const scenarioStartedAt = Date.now();
      try {
        const details = await scenario.run(harness);
        results.push({
          id: scenario.id,
          ok: true,
          durationMs: Date.now() - scenarioStartedAt,
          details: details || {},
        });
      } catch (error) {
        results.push({
          id: scenario.id,
          ok: false,
          durationMs: Date.now() - scenarioStartedAt,
          error: error && error.stack ? error.stack : String(error || ''),
        });
        if (!options.continueOnFailure) break;
      }
    }
  } finally {
    if (!options.keepArtifacts) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  return {
    ok: results.length === scenarios.length && results.every((result) => result.ok),
    durationMs: Date.now() - startedAt,
    tempRoot: options.keepArtifacts ? tempRoot : null,
    scenarioCount: scenarios.length,
    results,
  };
}

module.exports = {
  DEFAULT_SMOKE_SCENARIOS,
  createSmokeHarness,
  normalizeSmokeText,
  runSmokeScenarios,
};
