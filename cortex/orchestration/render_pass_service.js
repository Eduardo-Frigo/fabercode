const { createProjectBlueprintService } = require('./project_blueprint_service');
const { hasApplicationSurfaceFiles } = require('./execution_intent');

const defaultProjectBlueprintService = createProjectBlueprintService();

function defaultNormalizeRequestedRelativePath(rawPath) {
  if (!rawPath) return null;
  const sanitized = String(rawPath).trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!sanitized) return null;
  if (/^(?:[a-zA-Z]:[\\/]|\/)/.test(sanitized)) return null;
  const normalized = sanitized.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (!normalized || normalized.startsWith('..') || normalized.includes('/../')) return null;
  return normalized;
}

function hasExistingProjectFiles(projectInfo) {
  if (!projectInfo || !Number.isFinite(Number(projectInfo.totalFiles))) return false;
  return Number(projectInfo.totalFiles) > 0;
}

function normalizeEngineOperation(rawOperation, normalizeRequestedRelativePath = defaultNormalizeRequestedRelativePath) {
  if (!rawOperation || typeof rawOperation !== 'object') return null;
  const op = String(rawOperation.op || rawOperation.action || rawOperation.type || '').trim().toLowerCase();
  const rawPath =
    rawOperation.path || rawOperation.target || rawOperation.file || rawOperation.dir || rawOperation.name;
  const normalizedPath = normalizeRequestedRelativePath(rawPath);
  if (!normalizedPath) return null;

  if (op === 'mkdir' || op === 'create_directory' || op === 'folder' || op === 'directory') {
    return { op: 'mkdir', path: normalizedPath };
  }
  if (op === 'write_file' || op === 'create_file' || op === 'file' || (!op && typeof rawOperation.content === 'string')) {
    return {
      op: 'write_file',
      path: normalizedPath,
      content: typeof rawOperation.content === 'string' ? rawOperation.content : '',
    };
  }
  if (op === 'append_file') {
    return {
      op: 'append_file',
      path: normalizedPath,
      content: typeof rawOperation.content === 'string' ? rawOperation.content : '',
    };
  }
  return null;
}

function isPatchStyleRequest(userMessage) {
  const normalized = String(userMessage || '').toLowerCase();
  if (!normalized) return false;
  return /\b(corrija|corrigir|ajuste|ajustar|conserte|consertar|arrume|arrumar|melhore|melhorar|refatore|refatorar|atualize|atualizar|adicione|adicionar|remova|remover|troque|altere|alterar|edite|editar|corrigir)\b/.test(
    normalized
  );
}

function looksLikeScaffoldRewriteBatch(operations = []) {
  const writes = operations
    .filter((entry) => entry && (entry.op === 'write_file' || entry.op === 'append_file'))
    .map((entry) => String(entry.path || '').replace(/\\/g, '/').toLowerCase());
  if (!writes.length) return false;

  const hasWebTriplet = ['index.html', 'style.css', 'script.js'].every((target) => writes.includes(target));
  const hasLampTriplet = ['index.php', 'style.css', 'script.js'].every((target) => writes.includes(target));
  const rootWrites = writes.filter((entry) => !entry.includes('/')).length;
  return hasWebTriplet || hasLampTriplet || rootWrites >= 4;
}

function validatePatchFirstOperationBatch({
  projectInfo,
  operations = [],
  executionIntent = 'edit_project',
  userMessage = '',
}) {
  if (executionIntent !== 'edit_project') return { ok: true };
  if (!hasExistingProjectFiles(projectInfo)) return { ok: true };

  const existingFiles = new Set(
    (Array.isArray(projectInfo && projectInfo.files) ? projectInfo.files : [])
      .map((entry) => String(entry || '').replace(/\\/g, '/'))
  );
  const touchedWrites = operations.filter((entry) => entry && (entry.op === 'write_file' || entry.op === 'append_file'));
  const touchedExistingCount = touchedWrites.filter((entry) => existingFiles.has(String(entry.path || '').replace(/\\/g, '/'))).length;
  const newFilesCount = touchedWrites.length - touchedExistingCount;
  const patchStyle = isPatchStyleRequest(userMessage);
  const scaffoldLikeBatch = looksLikeScaffoldRewriteBatch(operations);

  if (patchStyle && scaffoldLikeBatch && touchedExistingCount === 0) {
    return {
      ok: false,
      reason:
        'Plano rejeitado: no modo edit_project o executor tentou recriar o projeto inteiro sem alterar arquivos existentes do projeto.',
    };
  }

  if (patchStyle && newFilesCount >= 5 && touchedExistingCount === 0) {
    return {
      ok: false,
      reason:
        'Plano rejeitado: no modo edit_project o lote criou muitos arquivos novos sem patch incremental em arquivos existentes.',
    };
  }

  return { ok: true };
}

function isPatchFirstGuardrailMessage(message) {
  const normalized = String(message || '').toLowerCase();
  if (!normalized) return false;
  return normalized.includes('modo edit_project') || normalized.includes('patch-first');
}

function buildRenderArtifactContextText(userMessage = '', workGraph = null) {
  const parts = [userMessage];
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
  return parts.filter(Boolean).join('\n');
}

function getProductRouteMode(productRouteDecision = null) {
  if (!productRouteDecision || typeof productRouteDecision !== 'object') return '';
  if (productRouteDecision.productRoute && productRouteDecision.productRoute.mode) {
    return String(productRouteDecision.productRoute.mode || '').trim().toLowerCase();
  }
  if (productRouteDecision.mode) return String(productRouteDecision.mode || '').trim().toLowerCase();
  return '';
}

function createCortexRenderPassService(dependencies = {}) {
  const {
    AI_REQUEST_TIMEOUT_MS = 420000,
    PERSONA_MODEL_ENGINE = 'engine',
    buildAttachmentsPromptContext = async () => '',
    buildArtifactQualityPromptGuidance = () => '',
    buildDeterministicPatchOperationBatch = () => null,
    buildDiagnosticsPromptContext = () => '',
    buildLocalProjectDiagnostics = () => null,
    buildOperationBatchDiffPreview = () => '',
    buildProjectBlueprintOperationBatch = defaultProjectBlueprintService.buildProjectBlueprintOperationBatch,
    buildProjectBlueprintPromptGuidance = defaultProjectBlueprintService.buildProjectBlueprintPromptGuidance,
    buildProjectEvolutionContext = () => '',
    buildRuntimeBudget,
    callPersonaProviderChat,
    clipText = (value, max = 4000) => String(value || '').slice(0, max),
    evaluateOperationBatchArtifactQuality = () => null,
    formatArtifactQualityForPrompt = () => '',
    formatLocalProjectDiagnosticsForPrompt = () => '',
    formatMempalaceCoreForPrompt = () => '',
    getRuntimeProfileSettings,
    hasRequiredProjectBlueprintFiles = defaultProjectBlueprintService.hasRequiredProjectBlueprintFiles,
    normalizeRequestedRelativePath = defaultNormalizeRequestedRelativePath,
    resolveBlueprintMediaAssets = async () => ({}),
    shouldPreferProjectBlueprint = defaultProjectBlueprintService.shouldPreferProjectBlueprint,
    shouldUseProjectBlueprintFallback = defaultProjectBlueprintService.shouldUseProjectBlueprintFallback,
    tryParseJsonObject = (raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    validateOperationBatchPlan,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Cortex render pass dependency missing: ${name}`);
  }

  function compactPromptPart(value, limit) {
    return clipText(String(value || ''), Math.max(200, Number(limit) || 1200));
  }

  async function requestEngineOperationBatchAction({
    projectInfo,
    userMessage,
    attachments = [],
    mempalaceContext,
    mempalaceCore,
    ragContext,
    cortexContext,
    workGraph = null,
    runtimeBudget = null,
    latestDiagnostics = null,
    repairContext = null,
    artifactContext = '',
    executionIntent = 'edit_project',
    productRouteDecision = null,
    workingBrief = null,
    buildModeRoute = null,
  }) {
    requireDependency('buildRuntimeBudget', buildRuntimeBudget);
    requireDependency('callPersonaProviderChat', callPersonaProviderChat);
    requireDependency('getRuntimeProfileSettings', getRuntimeProfileSettings);
    requireDependency('validateOperationBatchPlan', validateOperationBatchPlan);

    const runtimeSettings = getRuntimeProfileSettings();
    const activeRuntimeBudget = runtimeBudget || buildRuntimeBudget(runtimeSettings);
    const engineNumPredict = Math.max(
      700,
      Number(activeRuntimeBudget && activeRuntimeBudget.generationOptions
        ? activeRuntimeBudget.generationOptions.num_predict
        : 0) || 0
    );
    const baseMaxOps = Math.max(1, Number(activeRuntimeBudget.maxOperationsPerPass) || 6);
    const complexityMaxOps = Math.max(baseMaxOps, 8);
    const maxOps = Math.max(1, Math.min(40, complexityMaxOps));
    const compactProject = {
      stacks: projectInfo.stacks,
      totalFiles: projectInfo.totalFiles,
      counters: projectInfo.counters,
      sampleFiles: (projectInfo.files || []).slice(0, runtimeSettings.engineSampleFilesLimit),
    };
    const projectEvolutionContext = buildProjectEvolutionContext(projectInfo, userMessage, {
      maxFiles: Math.max(5, Math.min(12, Number(runtimeSettings.engineSampleFilesLimit) || 10)),
      maxCharsPerFile: 900,
      totalMaxChars: 5200,
    });
    const attachmentContext = await buildAttachmentsPromptContext(attachments, {
      maxAttachments: 4,
      maxCharsPerAttachment: 1200,
      totalMaxChars: 3800,
    });
    const diagnosticsContext = buildDiagnosticsPromptContext(latestDiagnostics, {
      maxIssues: 8,
      maxChars: 1800,
    });
    const localDiagnostics = buildLocalProjectDiagnostics({ projectInfo, userMessage, attachments });
    const localDiagnosticsContext = formatLocalProjectDiagnosticsForPrompt(localDiagnostics);
    const artifactQualityContext = artifactContext || buildRenderArtifactContextText(userMessage, workGraph);
    const artifactQualityGuidance = buildArtifactQualityPromptGuidance({
      userMessage,
      executionIntent,
      contextText: artifactQualityContext,
      workGraph,
    });
    const blueprintGuidance = buildProjectBlueprintPromptGuidance({
      userMessage,
      executionIntent,
      contextText: artifactQualityContext,
      workGraph,
      attachments,
      workingBrief,
    });

    const initMode = executionIntent === 'init_project';
    const hasApplicationFilesInProject = hasApplicationSurfaceFiles(projectInfo);
    const blueprintOptions = {
      userMessage,
      executionIntent,
      contextText: artifactQualityContext,
      workGraph,
      attachments,
      workingBrief,
    };
    const resolveProjectBlueprintMediaAssets = async (scaffoldUserMessage = userMessage, options = {}) => {
      if (options.mediaAssets) return options.mediaAssets;
      try {
        return await resolveBlueprintMediaAssets({
          projectInfo,
          userMessage: scaffoldUserMessage,
          contextText: artifactQualityContext,
          workGraph,
          productRouteDecision,
          workingBrief,
          buildModeRoute,
          mediaIntent: workingBrief && Array.isArray(workingBrief.mediaIntent) ? workingBrief.mediaIntent : [],
          contract: workingBrief && workingBrief.product
            ? {
                domain: workingBrief.product.domain || '',
                stack: workingBrief.product.stack || '',
                palette: workingBrief.style && workingBrief.style.palette ? workingBrief.style.palette : {},
              }
            : {},
        });
      } catch {
        return {};
      }
    };
    const projectBlueprint = async (scaffoldUserMessage = userMessage, options = {}) => buildProjectBlueprintOperationBatch({
      projectInfo,
      userMessage: scaffoldUserMessage,
      attachments,
      executionIntent,
      buildOperationBatchDiffPreview,
      contextText: artifactQualityContext,
      workGraph,
      force: Boolean(options.force),
      mediaAssets: await resolveProjectBlueprintMediaAssets(scaffoldUserMessage, options),
      workingBrief,
      buildModeRoute,
    });
    const projectBlueprintFallback = async (scaffoldUserMessage = userMessage) => {
      if (hasApplicationFilesInProject) return null;
      if (!shouldUseProjectBlueprintFallback(blueprintOptions)) return null;
      return projectBlueprint(scaffoldUserMessage, { force: true });
    };
    const productRouteMode = getProductRouteMode(productRouteDecision);
    const buildModeName = buildModeRoute && buildModeRoute.mode ? String(buildModeRoute.mode).toLowerCase() : '';
    const requiresAdaptiveBlueprint =
      initMode &&
      !hasApplicationFilesInProject &&
      (productRouteMode === 'adaptive_blueprint' || buildModeName === 'adaptive_blueprint');
    if (requiresAdaptiveBlueprint) {
      const blueprint = await projectBlueprint(userMessage, { force: true });
      if (blueprint) {
        blueprint.raw = blueprint.raw || 'adaptive_blueprint_contract';
        return blueprint;
      }
      return {
        ok: false,
        message:
          'O modo adaptive_blueprint foi selecionado, mas o renderer local não conseguiu montar um lote de arquivos coerente. Nenhuma chamada remota foi usada para substituir esse contrato.',
        raw: 'adaptive_blueprint_contract_unresolved',
      };
    }
    if (initMode && !hasApplicationFilesInProject && shouldPreferProjectBlueprint(blueprintOptions)) {
      const blueprint = await projectBlueprint();
      if (blueprint) return blueprint;
    }
    if (!initMode) {
      const deterministicPatch = buildDeterministicPatchOperationBatch({
        projectInfo,
        userMessage,
        attachments,
        executionIntent,
        localDiagnostics,
      });
      if (deterministicPatch) return deterministicPatch;
      if (productRouteMode === 'deterministic_patch') {
        return {
          ok: false,
          message:
            'A rota determinística foi selecionada, mas nenhum micro-contrato local conseguiu produzir um patch seguro para este pedido.',
          raw: 'deterministic_patch_contract_unresolved',
        };
      }
    }
    const systemPrompt =
      'Você é o Executor técnico da Persona. Sua única função é produzir um plano executável de arquivos/pastas. ' +
      'Responda SOMENTE JSON válido, sem markdown e sem texto fora do JSON. ' +
      'A primeira letra da resposta deve ser { e a última deve ser }.';

    const userPrompt = [
      `Pedido do usuário: ${compactPromptPart(userMessage, activeRuntimeBudget.maxPromptCharsPerPass)}`,
      attachments.length
        ? `Anexos: ${attachments.map((a) => `${a.name} (${a.type || 'desconhecido'})`).join(', ')}`
        : 'Anexos: nenhum',
      attachmentContext
        ? `Conteúdo útil extraído de anexos (OCR/texto):\n${attachmentContext}`
        : null,
      `Projeto atual: ${JSON.stringify(compactProject)}`,
      projectEvolutionContext
        ? `Contexto de arquivos existentes (priorize edição incremental):\n${projectEvolutionContext}`
        : null,
      diagnosticsContext
        ? `Diagnóstico técnico anterior para orientar correção pontual:\n${diagnosticsContext}`
        : null,
      localDiagnosticsContext
        ? `Diagnóstico local dos arquivos atuais:\n${localDiagnosticsContext}`
        : null,
      artifactQualityGuidance || null,
      blueprintGuidance || null,
      workGraph && workGraph.brief ? `Briefing da Persona: ${compactPromptPart(workGraph.brief, 1500)}` : null,
      workGraph && workGraph.briefSpec
        ? `Especificação detalhada da Persona (siteSpec): ${JSON.stringify(workGraph.briefSpec).slice(0, 4200)}`
        : null,
      workGraph && workGraph.acceptanceCriteria
        ? `Critérios Cortex: ${JSON.stringify(workGraph.acceptanceCriteria).slice(0, 2200)}`
        : null,
      mempalaceContext && mempalaceContext.contextText
        ? `Memória útil: ${mempalaceContext.contextText}`
        : 'Memória útil: indisponível',
      mempalaceCore && mempalaceCore.ok
        ? `MemPalace core (wake-up/KG/túneis):\n${formatMempalaceCoreForPrompt(mempalaceCore, 1200)}`
        : 'MemPalace core: indisponível',
      ragContext && ragContext.contextText
        ? `RAG (${ragContext.provider || 'r2r'}) para contexto de edição:\n${compactPromptPart(ragContext.contextText, 1200)}`
        : 'RAG para contexto de edição: indisponível',
      cortexContext && cortexContext.available && cortexContext.contextText
        ? `Contexto do Cortex para execução (restrito ao que for acionável):\n${cortexContext.contextText}`
        : 'Contexto do Cortex para execução: indisponível',
      repairContext
        ? `Este é um pass de reparo. Corrija a cobertura anterior: ${JSON.stringify(repairContext).slice(0, 1800)}`
        : null,
      'Regras obrigatórias:',
      '- Use caminhos relativos ao root do projeto.',
      '- Não use arquivos genéricos de notas para simular conclusão; edite os artefatos reais do projeto.',
      `- Gere no máximo ${maxOps} operações neste pass.`,
      '- Quando já existirem arquivos no projeto, priorize edição incremental dos arquivos existentes antes de criar uma base nova.',
      initMode
        ? '- MODO INIT_PROJECT: você pode estruturar novos arquivos base do projeto conforme briefing.'
        : '- MODO EDIT_PROJECT: proibido recriar o projeto inteiro; faça patch pontual e incremental sobre os arquivos atuais.',
      '- Não reescreva arquivos que não precisem mudar para cumprir o pedido atual.',
      '- Para corrigir link de CSS/JS em HTML, edite o HTML real e use write_file com o conteúdo completo corrigido do arquivo.',
      '- Para qualquer edição de arquivo existente, prefira write_file com o conteúdo final completo do arquivo alvo.',
      '- Não entregue layout pronto copiado: gere artefatos específicos para o briefing e os critérios.',
      '- Se o pedido exigir múltiplas partes, entregue o menor lote completo e coerente para este pass.',
      '- Formato JSON obrigatório:',
      '{',
      '  "summary": "texto curto",',
      '  "operations": [',
      '    { "op": "mkdir", "path": "pasta" },',
      '    { "op": "write_file", "path": "pasta/arquivo.ext", "content": "conteudo" }',
      '  ]',
      '}',
      'Exemplo válido para corrigir CSS em HTML:',
      '{"summary":"Conecta style.css ao index.html","operations":[{"op":"write_file","path":"index.html","content":"<!doctype html>...<link rel=\"stylesheet\" href=\"./style.css\">..."}]}',
      'Se for pedido de criação de aplicação, entregue arquivos executáveis mínimos.',
    ]
      .filter(Boolean)
      .join('\n');

    let raw = '';
    try {
      raw = await callPersonaProviderChat(
        PERSONA_MODEL_ENGINE,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        AI_REQUEST_TIMEOUT_MS,
        { runtimeBudget: activeRuntimeBudget, options: { num_predict: engineNumPredict } }
      );
    } catch (error) {
      const deterministicPatch = buildDeterministicPatchOperationBatch({
        projectInfo,
        userMessage,
        attachments,
        executionIntent,
        localDiagnostics,
      });
      if (deterministicPatch) return deterministicPatch;

      const blueprint = await projectBlueprintFallback();
      if (blueprint) {
        blueprint.providerFailure = {
          provider: 'persona_engine',
          message: error && error.message ? error.message : String(error || ''),
        };
        blueprint.raw = `project_blueprint_after_provider_failure:${blueprint.providerFailure.message}`;
        return blueprint;
      }

      throw error;
    }

    let parsed = tryParseJsonObject(raw);
    let repairedRaw = null;
    let parsedPlanValidation = parsed
      ? validateOperationBatchPlan({
          ...parsed,
          summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : 'Plano de execução preparado pelo executor.',
        })
      : { ok: false, errors: ['execution_plan must be valid JSON'] };
    if (!parsedPlanValidation.ok) {
      const deterministicPatch = buildDeterministicPatchOperationBatch({
        projectInfo,
        userMessage,
        attachments,
        executionIntent,
        localDiagnostics,
      });
      if (deterministicPatch) return deterministicPatch;
      const blueprint = await projectBlueprintFallback();
      if (blueprint) return blueprint;

      repairedRaw = await callPersonaProviderChat(
        PERSONA_MODEL_ENGINE,
        [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              'A resposta anterior não estava em JSON executável. Converta o plano abaixo em JSON válido no formato obrigatório.',
              'Não explique. Não use markdown. Use operações write_file/mkdir apenas quando necessário.',
              'Pedido original:',
              userPrompt,
              'Resposta anterior:',
              compactPromptPart(raw, 3000),
            ].join('\n'),
          },
        ],
        AI_REQUEST_TIMEOUT_MS,
        { runtimeBudget: activeRuntimeBudget, options: { num_predict: engineNumPredict } }
      );
      parsed = tryParseJsonObject(repairedRaw);
      parsedPlanValidation = parsed
        ? validateOperationBatchPlan({
            ...parsed,
            summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : 'Plano de execução preparado pelo executor.',
          })
        : { ok: false, errors: ['execution_plan repair must be valid JSON'] };
    }

    if (!parsedPlanValidation.ok) {
      const deterministicPatch = buildDeterministicPatchOperationBatch({
        projectInfo,
        userMessage,
        attachments,
        executionIntent,
        localDiagnostics,
      });
      if (deterministicPatch) return deterministicPatch;
      const blueprint = await projectBlueprintFallback();
      if (blueprint) return blueprint;
      return {
        ok: false,
        message:
          'O executor não retornou um plano JSON válido de execução mesmo após uma tentativa de correção. Nenhum patch seguro pôde ser derivado para este pedido.',
        schemaErrors: parsedPlanValidation.errors,
        raw: repairedRaw || raw,
      };
    }

    const operations = parsedPlanValidation.value.operations
      .map((entry) => normalizeEngineOperation(entry, normalizeRequestedRelativePath))
      .filter(Boolean)
      .slice(0, maxOps);

    if (!operations.length) {
      const deterministicPatch = buildDeterministicPatchOperationBatch({
        projectInfo,
        userMessage,
        attachments,
        executionIntent,
        localDiagnostics,
      });
      if (deterministicPatch) return deterministicPatch;
      const blueprint = await projectBlueprintFallback();
      if (blueprint) return blueprint;
      return {
        ok: false,
        message: 'O executor não retornou operações executáveis. Nenhum patch seguro pôde ser derivado para este pedido.',
        raw,
      };
    }

    const patchFirstValidation = validatePatchFirstOperationBatch({
      projectInfo,
      operations,
      executionIntent,
      userMessage,
    });
    if (!patchFirstValidation.ok) {
      return {
        ok: false,
        message: patchFirstValidation.reason || 'Plano rejeitado pelo guardrail patch-first.',
        raw,
        operations,
      };
    }

    const artifactQuality = evaluateOperationBatchArtifactQuality({
      operations,
      projectRootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '',
      userMessage,
      executionIntent,
      contextText: artifactQualityContext,
      workGraph,
    });
    const artifactQualityContextForPrompt = formatArtifactQualityForPrompt(artifactQuality);
    const shouldUseBlueprintForWeakInit =
      initMode &&
      !hasApplicationFilesInProject &&
      artifactQuality &&
      artifactQuality.enabled &&
      !artifactQuality.passesMinimum &&
      shouldUseProjectBlueprintFallback(blueprintOptions);
    if (shouldUseBlueprintForWeakInit) {
      const blueprint = await projectBlueprint(userMessage, { force: true });
      if (blueprint) {
        blueprint.artifactQuality = artifactQuality;
        blueprint.raw = `project_blueprint_after_artifact_quality:${artifactQuality.score}`;
        return blueprint;
      }
    }

    if (
      initMode &&
      !hasApplicationFilesInProject &&
      shouldUseProjectBlueprintFallback(blueprintOptions) &&
      !hasRequiredProjectBlueprintFiles({ operations, userMessage, contextText: artifactQualityContext, workGraph })
    ) {
      const blueprint = await projectBlueprint(userMessage, { force: true });
      if (blueprint) return blueprint;
    }

    const firstWrite = operations.find((op) => op.op === 'write_file' || op.op === 'append_file');
    const targetFile = firstWrite ? firstWrite.path : operations[0].path;
    const summary = parsedPlanValidation.value.summary;

    const action = {
      type: 'operation_batch',
      intent: initMode ? 'init_project' : 'edit_project',
      rootPath: projectInfo.rootPath,
      targetFile,
      operations,
      diffPreview: buildOperationBatchDiffPreview(operations),
      summary,
      userMessage,
      attachments,
    };
    if (artifactQuality && artifactQuality.enabled) {
      action.artifactQuality = artifactQuality;
      action.artifactQualityPromptContext = artifactQualityContextForPrompt || null;
    }

    return {
      ok: true,
      action,
      artifactQuality: artifactQuality && artifactQuality.enabled ? artifactQuality : null,
    };
  }

  return {
    requestEngineOperationBatchAction,
  };
}

module.exports = {
  createCortexRenderPassService,
  buildRenderArtifactContextText,
  isPatchFirstGuardrailMessage,
  isPatchStyleRequest,
  looksLikeScaffoldRewriteBatch,
  normalizeEngineOperation,
  validatePatchFirstOperationBatch,
};
