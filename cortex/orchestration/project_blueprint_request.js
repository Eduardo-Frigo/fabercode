const { inferBriefingContract } = require('./briefing_contract_service');
const {
  hasApplicationSurfaceFiles,
  hasExplicitProjectRebuildIntent,
} = require('./execution_intent');
const {
  buildBlueprintContextText,
  compactBlueprintJson,
  hasProfileBlueprintOperations,
  normalizeBlueprintText,
} = require('./project_blueprint_utils');

function buildWorkingBriefBlueprintContext(workingBrief = null) {
  if (!workingBrief || typeof workingBrief !== 'object') return '';
  const product = workingBrief.product && typeof workingBrief.product === 'object' ? workingBrief.product : {};
  const source = workingBrief.source && typeof workingBrief.source === 'object' ? workingBrief.source : {};
  const style = workingBrief.style && typeof workingBrief.style === 'object' ? workingBrief.style : {};
  const parts = [
    workingBrief.executionPrompt || '',
    source.current || '',
    source.consolidated || '',
    product.domainLabel || product.domain || '',
    product.stack || '',
    compactBlueprintJson(style.palette || null),
    compactBlueprintJson(style.typography || null),
    compactBlueprintJson(workingBrief.mediaIntent || null),
    compactBlueprintJson(workingBrief.iconIntent || null),
  ];
  return parts.filter(Boolean).join('\n');
}

function mergeWorkingBriefContract(workingBrief = null, fallbackContract = {}) {
  const contract = fallbackContract && typeof fallbackContract === 'object' ? fallbackContract : {};
  if (!workingBrief || typeof workingBrief !== 'object') return contract;
  const product = workingBrief.product && typeof workingBrief.product === 'object' ? workingBrief.product : {};
  const source = workingBrief.source && typeof workingBrief.source === 'object' ? workingBrief.source : {};
  const domain = product.domain || contract.domain || '';
  const stack = product.stack || contract.stack || '';

  return {
    ...contract,
    domain,
    domainLabel: product.domainLabel || contract.domainLabel || '',
    stack,
    brandFallback: product.brandFallback || contract.brandFallback || '',
    hasDomain: Boolean(domain),
    hasStack: Boolean(stack),
    source: source.normalized || contract.source || '',
    workingBriefSchemaVersion: workingBrief.schemaVersion || '',
  };
}

function isWorkingBriefCreateIntent(workingBrief = null) {
  return Boolean(
    workingBrief &&
      workingBrief.intent &&
      String(workingBrief.intent.action || '').trim() === 'create_project'
  );
}

function isWorkingBriefDefaultAuthorized(workingBrief = null) {
  if (!workingBrief || typeof workingBrief !== 'object') return false;
  const intent = workingBrief.intent && typeof workingBrief.intent === 'object' ? workingBrief.intent : {};
  return intent.autonomy === 'high' || intent.contentMode === 'ai_placeholder' || intent.contentMode === 'placeholder';
}

function resolveRegistryBlueprintStack({ stackRegistry = null, source = '', projectInfo = null } = {}) {
  if (!stackRegistry || typeof stackRegistry.resolveStackProfilesFromText !== 'function') return null;

  const rootPath = projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '';
  const profiles = stackRegistry.resolveStackProfilesFromText(source, rootPath);
  if (!Array.isArray(profiles) || !profiles.length) return null;

  const ids = new Set(profiles.map((profile) => String(profile.id || '').toLowerCase()));
  const customBlueprintProfile = profiles.find((profile) => profile.source !== 'builtin' && hasProfileBlueprintOperations(profile));
  if (customBlueprintProfile) {
    return {
      stack: `profile:${customBlueprintProfile.id}`,
      profile: customBlueprintProfile,
    };
  }

  if (ids.has('lamp')) return { stack: 'lamp', profile: profiles.find((profile) => profile.id === 'lamp') || null };
  if (ids.has('next') || (ids.has('react') && ids.has('tailwind'))) {
    return { stack: 'next-tailwind', profile: profiles.find((profile) => profile.id === 'next') || null };
  }

  return null;
}

function inferProjectBlueprintRequest({
  userMessage = '',
  contextText = '',
  workGraph = null,
  attachments = [],
  executionIntent = '',
  projectInfo = null,
  stackRegistry = null,
  workingBrief = null,
} = {}) {
  const workingBriefContext = buildWorkingBriefBlueprintContext(workingBrief);
  const rawSource = buildBlueprintContextText({
    userMessage,
    contextText: [contextText, workingBriefContext].filter(Boolean).join('\n'),
    workGraph,
  });
  const source = normalizeBlueprintText(rawSource);
  const inferredContract = inferBriefingContract({
    userMessage,
    contextText: [contextText, workingBriefContext].filter(Boolean).join('\n'),
    workGraph,
  });
  const briefingContract = mergeWorkingBriefContract(workingBrief, inferredContract);
  const initMode = String(executionIntent || '').toLowerCase() === 'init_project';
  const registryResolution = resolveRegistryBlueprintStack({ stackRegistry, source: rawSource, projectInfo });
  const briefCreateIntent = isWorkingBriefCreateIntent(workingBrief);
  const briefDefaultAuthorized = isWorkingBriefDefaultAuthorized(workingBrief);
  const briefProjectKind = workingBrief && workingBrief.product ? String(workingBrief.product.projectKind || '') : '';
  const siteLike = /\b(site|landing|one page|pagina|institucional|web|html|php|lamp|next|nextjs|react|tailwind|cta|desktop|electron|astro|vue)\b/.test(source) ||
    Boolean(registryResolution) ||
    Boolean(briefProjectKind) ||
    Boolean(briefingContract.domain);
  const creationLike =
    /\b(criar|crie|gerar|gere|desenvolver|desenvolva|montar|monte|fazer|faca|novo|nova)\b/.test(source) ||
    briefCreateIntent;
  const defaultLike =
    /\b(placeholder|placeholders|default|defaults|padrao|qualquer coisa|voce decide|pode fazer|pode seguir|generico|generica|informacoes genericas)\b/.test(source) ||
    briefDefaultAuthorized;
  const productLandingLike =
    /\b(produto|produtos|produto digital|catalogo|catalogos|colecao|colecoes|vitrine|loja|boutique|ecommerce|e-commerce|comercio|landing page de produto)\b/.test(source) ||
    /\b(couro|couros|artefatos?|bolsas?|pastas?|carteiras?|acessorios?|marroquinaria|artesanal|feito a mao|materia-prima|durabilidade|longevidade)\b/.test(source);
  const domainBlueprintLike = Boolean(
    briefingContract.domain ||
      (workingBrief && workingBrief.product && workingBrief.product.domain) ||
      productLandingLike
  );
  const composedBlueprintLike = Boolean(defaultLike || domainBlueprintLike);
  const existingApplication = hasApplicationSurfaceFiles(projectInfo);
  const explicitRebuild = hasExplicitProjectRebuildIntent(source);
  const hasVisualReference =
    /\b(figma|figjam|mockup|wireframe|layout especifico|layout específico|pixel perfect|referencia visual|referência visual|prototipo|protótipo)\b/.test(source) ||
    /\b(design system|sistema de design)\s+(existente|especifico|específico|fornecido|anexado|de referencia|de referência)\b/.test(source) ||
    (Array.isArray(attachments) && attachments.length > 0);
  const lamp = briefingContract.stack === 'lamp' || /\b(lamp|php|mysql)\b/.test(source);
  const nextTailwind = briefingContract.stack === 'next-tailwind' || /\b(next|nextjs|next\.js|tailwind)\b/.test(source) || (/\breact\b/.test(source) && /\btailwind\b/.test(source));
  const explicitStaticWeb =
    briefingContract.stack === 'static-web' ||
    /\b(static-web|static web|site estatico|site estático|pagina estatica|pagina estática|html css|html\/css|html, css|html e css|vanilla)\b/.test(source);
  const stack = registryResolution
    ? registryResolution.stack
    : lamp ? 'lamp' : nextTailwind ? 'next-tailwind' : explicitStaticWeb ? 'static-web' : 'next-tailwind';

  return {
    enabled: Boolean(initMode && (!existingApplication || explicitRebuild) && siteLike && (creationLike || composedBlueprintLike)),
    canFallback: Boolean(initMode && (!existingApplication || explicitRebuild) && siteLike && !hasVisualReference),
    forceBlueprint: Boolean(initMode && (!existingApplication || explicitRebuild) && siteLike && composedBlueprintLike && !hasVisualReference),
    hasVisualReference,
    initMode,
    siteLike,
    stack,
    stackProfile: registryResolution ? registryResolution.profile : null,
    briefingContract,
    source,
    rawSource,
  };
}


module.exports = {
  inferProjectBlueprintRequest,
};
