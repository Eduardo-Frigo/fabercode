const { formatBriefingContractForPrompt } = require('./briefing_contract_service');
const {
  HEROICONS_SOURCE_URL,
  buildBlueprintIconSet,
} = require('./blueprint_icon_registry');
const { normalizeBlueprintText } = require('./project_blueprint_utils');
const { inferProjectBlueprintRequest } = require('./project_blueprint_request');
const { inferBlueprintBrand } = require('./project_blueprint_brand_service');
const {
  BLUEPRINT_LAYOUT_PIECE_INVENTORY,
  buildBlueprintModuleContract,
  inferBlueprintLayoutVariant,
  resolveBlueprintLayoutRecipe,
  resolveBlueprintTheme,
} = require('./project_blueprint_layout');
const {
  buildBlueprintOperations,
  isSafeBlueprintPath,
  normalizeBlueprintMediaAssets,
} = require('./project_blueprint_templates');
const { buildBlueprintCoverageContract } = require('./project_blueprint_coverage_contract');
const {
  validateProjectBlueprintContract,
} = require('./project_blueprint_contract_validation_service');

function createProjectBlueprintService(dependencies = {}) {
  const {
    stackRegistry = null,
  } = dependencies;

  function buildProjectBlueprintOperationBatch({
    projectInfo,
    userMessage = '',
    attachments = [],
    executionIntent = 'edit_project',
    buildOperationBatchDiffPreview = () => '',
    contextText = '',
    workGraph = null,
    force = false,
    mediaAssets = {},
    workingBrief = null,
    buildModeRoute = null,
  } = {}) {
    const request = inferProjectBlueprintRequest({
      userMessage,
      contextText,
      workGraph,
      attachments,
      executionIntent,
      projectInfo,
      stackRegistry,
      workingBrief,
    });

    if (!request.enabled && !(force && request.siteLike)) return null;
    if (request.hasVisualReference && !force) return null;
    if (!force && !request.forceBlueprint) return null;

    const brand = inferBlueprintBrand(request.rawSource || userMessage, request.briefingContract);
    const theme = resolveBlueprintTheme({
      source: request.rawSource || userMessage,
      contract: request.briefingContract,
      workingBrief,
    });
    const iconIntent = workingBrief && Array.isArray(workingBrief.iconIntent) ? workingBrief.iconIntent : [];
    const layoutVariant = inferBlueprintLayoutVariant(request.rawSource || userMessage, workingBrief);
    const layoutRecipe = resolveBlueprintLayoutRecipe({
      source: request.rawSource || userMessage,
      contract: request.briefingContract,
      layoutVariant,
      workingBrief,
    });
    const moduleContract = buildBlueprintModuleContract({
      contract: request.briefingContract,
      layoutRecipe,
      layoutVariant,
    });
    const operations = buildBlueprintOperations({
      stack: request.stack,
      brand,
      stackProfile: request.stackProfile,
      contract: request.briefingContract,
      theme,
      mediaAssets,
      iconIntent,
      layoutVariant,
      layoutRecipe,
    });
    if (!operations.length) return null;
    const coverageContract = buildBlueprintCoverageContract({
      source: request.rawSource || userMessage,
      contract: request.briefingContract,
      workingBrief,
      layoutRecipe,
      operations,
    });
    const contractValidation = validateProjectBlueprintContract({
      stack: request.stack,
      stackProfile: request.stackProfile,
      operations,
      moduleContract,
      coverageContract,
    });
    if (!contractValidation.ok) {
      return {
        ok: false,
        raw: 'project_blueprint_contract_validation_failed',
        errors: contractValidation.issues.map((issue) => issue.message || issue.id),
        contractValidation,
      };
    }
    const iconSet = buildBlueprintIconSet({ contract: request.briefingContract, iconIntent });

    const rawProfileTargetFile = request.stackProfile && request.stackProfile.blueprint
      ? request.stackProfile.blueprint.targetFile
      : '';
    const profileTargetFile = isSafeBlueprintPath(rawProfileTargetFile) ? rawProfileTargetFile : '';
    const targetFile = profileTargetFile || (request.stack === 'lamp'
      ? 'index.php'
      : request.stack === 'next-tailwind'
        ? 'app/page.tsx'
        : operations[0].path || 'index.html');
    const media = normalizeBlueprintMediaAssets(mediaAssets);
    const stackLabel = request.stackProfile && request.stackProfile.label
      ? request.stackProfile.label
      : request.stack === 'lamp'
      ? 'LAMP'
      : request.stack === 'next-tailwind'
        ? 'Next.js + Tailwind'
        : 'web';

    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'init_project',
        rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '',
        targetFile,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: `Criar composição modular ${stackLabel} com header, hero, seções, footer e placeholders editáveis.`,
        userMessage,
        attachments,
        generatedBy: 'project_blueprint_service',
        blueprint: {
          stack: request.stack,
          profileId: request.stackProfile ? request.stackProfile.id : '',
          profileSource: request.stackProfile ? request.stackProfile.source : '',
          briefingContract: {
            domain: request.briefingContract ? request.briefingContract.domain : '',
            stack: request.briefingContract ? request.briefingContract.stack : '',
            schemaVersion: request.briefingContract ? request.briefingContract.workingBriefSchemaVersion || '' : '',
            temporaryBlueprintContract: request.briefingContract && request.briefingContract.temporaryBlueprintContract
              ? {
                  schemaVersion: request.briefingContract.temporaryBlueprintContract.schemaVersion || '',
                  status: request.briefingContract.temporaryBlueprintContract.status || '',
                  source: request.briefingContract.temporaryBlueprintContract.source || '',
                  activation: request.briefingContract.temporaryBlueprintContract.activation || '',
                  domain: request.briefingContract.temporaryBlueprintContract.domain || '',
                }
              : null,
          },
          theme: {
            accent: theme.accent,
            background: theme.bg,
            fontFamily: theme.typography.family,
          },
          layoutVariant,
          layoutRecipe,
          visualGrammar: layoutRecipe && layoutRecipe.visualGrammar ? layoutRecipe.visualGrammar : null,
          moduleContract,
          sectionManifest: coverageContract && coverageContract.requirements
            ? coverageContract.requirements.manifest || null
            : null,
          coverageContract,
          contractValidation,
          media: media.hero
            ? {
                provider: media.hero.provider,
                kind: media.hero.kind,
                query: media.hero.query,
                attribution: media.hero.attribution,
                sourceUrl: media.hero.sourceUrl,
              }
            : null,
          icons: {
            provider: 'internal',
            reference: HEROICONS_SOURCE_URL,
            names: iconSet.map((icon) => icon.name),
          },
          workingBrief: workingBrief
            ? {
                schemaVersion: workingBrief.schemaVersion || '',
                autonomy: workingBrief.intent ? workingBrief.intent.autonomy || '' : '',
                contentMode: workingBrief.intent ? workingBrief.intent.contentMode || '' : '',
                defaultedDomain: workingBrief.product ? Boolean(workingBrief.product.defaultedDomain) : false,
              }
            : null,
          buildMode: buildModeRoute && buildModeRoute.mode ? buildModeRoute.mode : '',
          reason: request.forceBlueprint ? 'default_authorized' : 'quality_fallback',
        },
      },
      raw: `project_blueprint:${request.stackProfile ? request.stackProfile.id : request.stack}`,
    };
  }

  function shouldPreferProjectBlueprint(options = {}) {
    const request = inferProjectBlueprintRequest({ ...options, stackRegistry });
    return Boolean(request.enabled && request.forceBlueprint);
  }

  function shouldUseProjectBlueprintFallback(options = {}) {
    const request = inferProjectBlueprintRequest({ ...options, stackRegistry });
    return Boolean(request.canFallback && !request.hasVisualReference);
  }

  function hasRequiredProjectBlueprintFiles({ operations = [], userMessage = '', contextText = '', workGraph = null } = {}) {
    const request = inferProjectBlueprintRequest({
      userMessage,
      contextText,
      workGraph,
      executionIntent: 'init_project',
      stackRegistry,
    });
    const writes = new Set(
      (Array.isArray(operations) ? operations : [])
        .filter((op) => op && (op.op === 'write_file' || op.op === 'append_file'))
        .map((op) => String(op.path || '').replace(/\\/g, '/').toLowerCase())
    );
    const profileRequired = request.stackProfile && request.stackProfile.blueprint && Array.isArray(request.stackProfile.blueprint.requiredFiles)
      ? request.stackProfile.blueprint.requiredFiles
        .map((file) => String(file || '').replace(/\\/g, '/').toLowerCase())
        .filter(isSafeBlueprintPath)
      : null;
    const required = profileRequired || (request.stack === 'lamp'
      ? ['index.php', 'style.css', 'script.js']
      : request.stack === 'next-tailwind'
        ? ['package.json', 'app/layout.tsx', 'app/page.tsx', 'app/globals.css']
        : ['index.html', 'style.css', 'script.js']);
    return required.every((file) => writes.has(file));
  }

  function buildProjectBlueprintPromptGuidance(options = {}) {
    const request = inferProjectBlueprintRequest({ ...options, stackRegistry });
    if (!request.enabled) return '';
    const lines = [
      'Diretrizes de composição modular:',
      '- Monte o projeto como peças editáveis: header, hero, seções do body e footer. Varie a receita conforme domínio, objetivo, referência visual e pedido do usuário.',
      '- Quando o pedido for de projeto/site/página completa, o Faber Code deve montar uma primeira versão completa e ajustável: gramática visual, módulos, rotas quando fizer sentido, CTAs, formulário, prova, FAQ e footer. O usuário deve trocar textos e imagens depois, não completar uma estrutura rasa.',
      '- Use uma composição base apenas quando o pedido estiver genérico, com defaults/placeholders ou quando a geração vier tecnicamente fraca.',
      '- Se o usuário pedir uma peça que ainda não existe na biblioteca, trate como contrato temporário data-only e promova pelo Automata Contract Ledger após aceite e smoke test.',
      '- Se houver Figma, mockup, print, referência visual, anexo ou briefing criativo específico, preserve a direção criativa e adapte a composição em vez de forçar template genérico.',
    ];
    if (request.stack === 'next-tailwind') {
      lines.push('- Para Next.js + Tailwind, prefira App Router com package.json, app/layout.tsx, app/page.tsx e app/globals.css.');
    }
    if (request.stack === 'lamp') {
      lines.push('- Para LAMP/PHP, use index.php, style.css e script.js conectados.');
    }
    const contractGuidance = formatBriefingContractForPrompt(request.briefingContract);
    if (contractGuidance) {
      for (const line of contractGuidance.split('\n').filter(Boolean)) lines.push(`- ${line}`);
    }
    if (request.stackProfile && request.stackProfile.blueprint) {
      const pluginGuidance = request.stackProfile.blueprint.promptGuidance;
      if (Array.isArray(pluginGuidance)) lines.push(...pluginGuidance.map((line) => `- ${line}`));
      else if (pluginGuidance) lines.push(`- ${pluginGuidance}`);
    }
    return lines.join('\n');
  }

  return {
    buildProjectBlueprintOperationBatch,
    buildProjectBlueprintPromptGuidance,
    hasRequiredProjectBlueprintFiles,
    inferProjectBlueprintRequest,
    shouldPreferProjectBlueprint,
    shouldUseProjectBlueprintFallback,
    BLUEPRINT_LAYOUT_PIECE_INVENTORY,
    buildBlueprintModuleContract,
  };
}

module.exports = {
  BLUEPRINT_LAYOUT_PIECE_INVENTORY,
  buildBlueprintModuleContract,
  createProjectBlueprintService,
  inferBlueprintLayoutVariant,
  inferProjectBlueprintRequest,
  normalizeBlueprintText,
  resolveBlueprintLayoutRecipe,
  resolveBlueprintTheme,
};
