const { createProjectBlueprintService } = require('./project_blueprint_service');
const {
  buildForgeMrpOperationBatch,
  isForgeMrpRequest,
} = require('./forge_mrp_blueprint_service');
const { wrapUntrustedPromptSection } = require('../security/ai_trust_boundary');
const {
  hasApplicationSurfaceFiles,
  hasExplicitProjectRebuildIntent,
} = require('./execution_intent');
const { normalizeProviderFailure } = require('../providers/provider_failure_service');
const fs = require('fs');
const path = require('path');

const defaultProjectBlueprintService = createProjectBlueprintService();

function normalizeRenderText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasExplicitContractReviewIntent(value = '') {
  const source = normalizeRenderText(value);
  return /\b(contrato|contract|ledger|suggest_blueprint|blueprint contract|contrato de blueprint|contrato automata|contrato temporario)\b/.test(source) &&
    /\b(antes|previo|previamente|revisar|aprovacao|aprovar|staged|promover|governanca|policy|politica)\b/.test(source);
}

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

function buildOperationBatchResponseFormat(maxOperations = 8) {
  const maxItems = Math.max(1, Math.min(40, Number(maxOperations) || 8));
  return {
    type: 'json_schema',
    name: 'faber_operation_batch_plan',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: {
          type: 'string',
          minLength: 1,
        },
        operations: {
          type: 'array',
          minItems: 1,
          maxItems,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              op: {
                type: 'string',
                enum: ['mkdir', 'write_file', 'append_file'],
              },
              path: {
                type: 'string',
                minLength: 1,
              },
              content: {
                type: 'string',
              },
            },
            required: ['op', 'path', 'content'],
          },
        },
      },
      required: ['summary', 'operations'],
    },
  };
}

function readExistingApplicationSurface(projectInfo = {}) {
  const rootPath = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
  if (!rootPath) return '';
  const candidates = [
    'app/page.tsx',
    'src/app/page.tsx',
    'pages/index.tsx',
    'src/pages/index.tsx',
    'index.html',
    'index.php',
  ];
  const parts = [];
  for (const relPath of candidates) {
    try {
      const absPath = path.join(rootPath, relPath);
      if (!fs.existsSync(absPath)) continue;
      const stat = fs.statSync(absPath);
      if (!stat.isFile() || stat.size > 700000) continue;
      parts.push(fs.readFileSync(absPath, 'utf8'));
    } catch {
      // Conteúdo inacessível não deve bloquear o render principal.
    }
  }
  return parts.join('\n');
}

function shouldRegenerateFromBriefingCheckpoint({ projectInfo = {}, userMessage = '', executionIntent = '' } = {}) {
  if (String(executionIntent || '') === 'init_project') return false;
  const source = normalizeRenderText(userMessage);
  const asksForFinalBriefing = /\b(briefing completo|conteudo final|conteudo que solicitei|site completo|landing page|helena duarte|importacao|comercio exterior|arquitetura contemporanea)\b/.test(source);
  if (!asksForFinalBriefing) return false;
  const current = normalizeRenderText(readExistingApplicationSurface(projectInfo));
  if (!current) return false;
  return /\b(atendimento placeholder premium|conteudo provisorio|pronta para evoluir|pronta para receber conteudo real|faber projeto|studio habitat|este conteudo e definitivo|o formulario ja envia dados|satisfacao placeholder|anos de experiencia simulada)\b/.test(current);
}

function looksLikeInstructionOnlyProjectContent(content = '') {
  const text = String(content || '').trim();
  if (!text) return false;
  const normalized = normalizeRenderText(text);
  const startsAsInstruction =
    /^(atualizar|substituir|aplicar|definir|restaurar|trocar|ajustar|corrigir|garantir|manter|preservar|criar|incluir|adicionar|se necessario|nenhuma alteracao)\b/.test(
      normalized
    );
  const hasCodeShape =
    /[{}<>;=]|\b(import|export|function|const|let|var|return|class|type|interface|describe|test|expect)\b/.test(text);
  return Boolean(startsAsInstruction && !hasCodeShape);
}

function hasInstructionOnlyCriticalProjectFiles(projectInfo = {}) {
  const rootPath = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
  if (!rootPath) return false;
  const criticalFiles = [
    'package.json',
    'app/layout.tsx',
    'app/page.tsx',
    'app/globals.css',
    'tests/forge-mrp.spec.ts',
  ];
  let instructionOnlyCount = 0;
  for (const relPath of criticalFiles) {
    try {
      const absPath = path.join(rootPath, relPath);
      if (!fs.existsSync(absPath)) continue;
      const stat = fs.statSync(absPath);
      if (!stat.isFile() || stat.size > 50000) continue;
      if (looksLikeInstructionOnlyProjectContent(fs.readFileSync(absPath, 'utf8'))) instructionOnlyCount += 1;
    } catch {
      // Fallback Forge exige evidência positiva; falhas de leitura não contam.
    }
  }
  return instructionOnlyCount >= 2;
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

const SAFE_SECRET_TEMPLATE_FILES = new Set(['.env.example', '.env.sample', '.env.template']);
const SENSITIVE_OPERATION_FILE_NAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
  'secrets.json',
]);

function normalizeOperationSecurityPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

function isSensitiveOperationPath(value = '') {
  const normalized = normalizeOperationSecurityPath(value).toLowerCase();
  if (!normalized || SAFE_SECRET_TEMPLATE_FILES.has(normalized)) return false;
  if (normalized === '.env' || /^\.env\./.test(normalized)) return true;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.git' || part === '.ssh' || part === 'private_context')) return true;
  const fileName = parts[parts.length - 1] || normalized;
  if (SENSITIVE_OPERATION_FILE_NAMES.has(fileName)) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(fileName)) return true;
  return false;
}

function filterSensitiveOperationBatch(operations = []) {
  const safeOperations = [];
  const blockedOperations = [];
  for (const operation of Array.isArray(operations) ? operations : []) {
    const relPath = normalizeOperationSecurityPath(operation && operation.path ? operation.path : '');
    if (isSensitiveOperationPath(relPath)) {
      blockedOperations.push({
        op: operation && operation.op ? operation.op : '',
        path: relPath,
        reason: 'sensitive_path_blocked_before_confirmation',
      });
      continue;
    }
    safeOperations.push(operation);
  }
  return { operations: safeOperations, blockedOperations };
}

function getWriteOperationContent(operations = [], relPath = '') {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  const op = (Array.isArray(operations) ? operations : [])
    .slice()
    .reverse()
    .find((entry) => entry && entry.op === 'write_file' && entry.path === normalized && typeof entry.content === 'string');
  return op ? op.content : '';
}

function readProjectFileText(projectInfo = {}, relPath = '') {
  const rootPath = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
  if (!rootPath || !relPath) return '';
  try {
    const absPath = path.join(rootPath, relPath);
    if (!fs.existsSync(absPath)) return '';
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size > 400000) return '';
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

function hasAtAliasMapping(configText = '') {
  const text = String(configText || '');
  return /"paths"\s*:\s*\{[\s\S]*"@\/\*"\s*:\s*\[[\s\S]*"\*"/.test(text) ||
    /["']paths["']\s*:\s*\{[\s\S]*["']@\/\*["']\s*:\s*\[[\s\S]*["']\*["']/.test(text);
}

function operationBatchDeclaresAtAlias({ operations = [], projectInfo = {} } = {}) {
  const tsconfig = getWriteOperationContent(operations, 'tsconfig.json') || readProjectFileText(projectInfo, 'tsconfig.json');
  const jsconfig = getWriteOperationContent(operations, 'jsconfig.json') || readProjectFileText(projectInfo, 'jsconfig.json');
  return hasAtAliasMapping(tsconfig) || hasAtAliasMapping(jsconfig);
}

function resolveRelativeImportForProjectAlias(fromPath = '', aliasTarget = '') {
  const cleanTarget = String(aliasTarget || '').replace(/^\/+/, '');
  if (!cleanTarget) return '';
  const fromDir = path.posix.dirname(String(fromPath || '').replace(/\\/g, '/'));
  let relative = path.posix.relative(fromDir === '.' ? '' : fromDir, cleanTarget);
  if (!relative) relative = path.posix.basename(cleanTarget);
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return relative;
}

function rewriteAtAliasImportsForOperation(operation) {
  if (!operation || operation.op !== 'write_file' || typeof operation.content !== 'string') return operation;
  if (!/\.(?:tsx?|jsx?|mjs|cjs)$/.test(String(operation.path || ''))) return operation;
  const rewrite = (target) => resolveRelativeImportForProjectAlias(operation.path, target);
  const content = operation.content
    .replace(/(\bfrom\s*["'])@\/([^"']+)(["'])/g, (match, prefix, target, suffix) => {
      const relative = rewrite(target);
      return relative ? `${prefix}${relative}${suffix}` : match;
    })
    .replace(/(\bimport\s*\(\s*["'])@\/([^"']+)(["']\s*\))/g, (match, prefix, target, suffix) => {
      const relative = rewrite(target);
      return relative ? `${prefix}${relative}${suffix}` : match;
    })
    .replace(/(\brequire\s*\(\s*["'])@\/([^"']+)(["']\s*\))/g, (match, prefix, target, suffix) => {
      const relative = rewrite(target);
      return relative ? `${prefix}${relative}${suffix}` : match;
    });
  return content === operation.content ? operation : { ...operation, content };
}

function repairUnsupportedAtAliasImports({ operations = [], projectInfo = {} } = {}) {
  if (!Array.isArray(operations) || !operations.length) return operations;
  if (operationBatchDeclaresAtAlias({ operations, projectInfo })) return operations;
  return operations.map(rewriteAtAliasImportsForOperation);
}

function isPatchStyleRequest(userMessage) {
  const normalized = String(userMessage || '').toLowerCase();
  if (!normalized) return false;
  return /\b(corrija|corrigir|ajuste|ajustar|conserte|consertar|arrume|arrumar|melhore|melhorar|refatore|refatorar|atualize|atualizar|adicione|adicionar|remova|remover|troque|altere|alterar|edite|editar|corrigir)\b/.test(
    normalized
  );
}

function shouldBypassDeterministicPatchForRequest(userMessage = '') {
  const normalized = normalizeRenderText(userMessage);
  if (!/\b(fundo|background|bg|hero|topo)\b/.test(normalized)) return false;
  const asksMediaOrOverlay =
    /\b(imagem|image|foto|photo|video|midia|media)\b/.test(normalized) ||
    /\b(overlay|sobreposicao|camada)\b/.test(normalized);
  if (!asksMediaOrOverlay) return false;
  const explicitMicroMediaPatch =
    /\b(src|alt|poster|url)\b/.test(normalized) &&
    /\b(troque|mude|altere|atualize|substitua)\b/.test(normalized);
  return !explicitMicroMediaPatch;
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
    buildProjectGraphContext = () => '',
    buildRuntimeBudget,
    buildVisualStructuralFallbackOperationBatch = () => null,
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

  function wrapUntrusted(label, value, sourceType, limit) {
    const text = compactPromptPart(value, limit || 1800);
    return wrapUntrustedPromptSection(label, text, {
      sourceType,
      maxChars: limit || 1800,
    });
  }

  async function requestEngineOperationBatchAction({
    projectInfo,
    userMessage,
    attachments = [],
    mempalaceContext,
    mempalaceCore,
    ragContext,
    cortexContext,
    activeMemory = null,
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
    const contractEscalation =
      (workingBrief && workingBrief.contractEscalation) ||
      (workingBrief && workingBrief.briefingSpec ? workingBrief.briefingSpec.contractEscalation : null) ||
      null;
    if (
      contractEscalation &&
      contractEscalation.required &&
      contractEscalation.blocking &&
      hasExplicitContractReviewIntent(userMessage)
    ) {
      return {
        ok: false,
        message:
          contractEscalation.reason ||
          'O briefing atual exige um contrato de blueprint antes de gerar arquivos. Nenhum fallback generico foi aplicado.',
        raw: 'briefing_contract_escalation_required',
        contractEscalation,
      };
    }
    const activeRuntimeBudget = runtimeBudget || buildRuntimeBudget(runtimeSettings);
    const routeModeForBudget = String(
      (productRouteDecision && productRouteDecision.productRoute && productRouteDecision.productRoute.mode) ||
        (productRouteDecision && productRouteDecision.meta && productRouteDecision.meta.mode) ||
        (buildModeRoute && buildModeRoute.mode) ||
        ''
    ).trim().toLowerCase();
    const buildModeForBudget = String(buildModeRoute && buildModeRoute.mode ? buildModeRoute.mode : '').trim().toLowerCase();
    const isGuidedAppArchitecture = routeModeForBudget === 'guided_app_architecture' || buildModeForBudget === 'guided_app_architecture';
    const engineNumPredict = Math.max(
      isGuidedAppArchitecture ? 32768 : 700,
      Number(activeRuntimeBudget && activeRuntimeBudget.generationOptions
        ? activeRuntimeBudget.generationOptions.num_predict
        : 0) || 0
    );
    const baseMaxOps = Math.max(1, Number(activeRuntimeBudget.maxOperationsPerPass) || 6);
    const complexityMaxOps = Math.max(baseMaxOps, isGuidedAppArchitecture ? 16 : 8);
    const maxOps = Math.max(1, Math.min(isGuidedAppArchitecture ? 16 : 40, complexityMaxOps));
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
    const projectGraphContext = buildProjectGraphContext(projectInfo, userMessage, {
      maxFiles: Math.max(8, Math.min(18, Number(runtimeSettings.engineSampleFilesLimit) || 12)),
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
    const activeMemoryContext =
      activeMemory && activeMemory.decision && activeMemory.decision.editContextText
        ? compactPromptPart(activeMemory.decision.editContextText, 2200)
        : '';

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
    const buildForgeMrpBlueprintFallback = (raw = 'forge_mrp_blueprint:render_fallback', providerFailure = null) => {
      if (initMode || !hasApplicationFilesInProject) return null;
      if (!hasInstructionOnlyCriticalProjectFiles(projectInfo)) return null;
      if (!isForgeMrpRequest({ userMessage, contextText: artifactQualityContext, workGraph, workingBrief })) return null;
      return buildForgeMrpOperationBatch({
        projectInfo,
        userMessage,
        attachments,
        executionIntent,
        buildOperationBatchDiffPreview,
        evaluateOperationBatchArtifactQuality,
        contextText: artifactQualityContext,
        workGraph,
        providerFailure,
        raw,
      });
    };
    const productRouteMode = getProductRouteMode(productRouteDecision);
    const buildModeName = buildModeRoute && buildModeRoute.mode ? String(buildModeRoute.mode).toLowerCase() : '';
    const hasForgeDiagnosticContractBreak = () => {
      const source = normalizeRenderText([
        userMessage,
        diagnosticsContext,
        localDiagnosticsContext,
        projectGraphContext,
      ].filter(Boolean).join('\n'));
      return /\b(property snapshot does not exist|snapshot does not exist|cannot read properties of undefined reading items|store\.snapshot|missing_store_contract_member|nao declara snapshot|nao declara requirements|nao declara auditlog)\b/.test(source);
    };
    const buildForgeMrpDiagnosticRepairFallback = (raw = 'forge_mrp_diagnostic_repair_fallback') => {
      if (initMode || !hasApplicationFilesInProject) return null;
      if (!isForgeMrpRequest({ userMessage, contextText: artifactQualityContext, workGraph, workingBrief })) return null;
      const diagnosticMode =
        executionIntent === 'diagnostic_repair' ||
        productRouteMode === 'diagnostic_repair' ||
        buildModeName === 'diagnostic_repair';
      if (!diagnosticMode || !hasForgeDiagnosticContractBreak()) return null;
      return buildForgeMrpOperationBatch({
        projectInfo,
        userMessage,
        attachments,
        executionIntent: 'edit_project',
        buildOperationBatchDiffPreview,
        evaluateOperationBatchArtifactQuality,
        contextText: artifactQualityContext,
        workGraph,
        raw,
      });
    };
    const deterministicPatchRouteSelected = productRouteMode === 'deterministic_patch';
    const deterministicPatchBypassed = shouldBypassDeterministicPatchForRequest(userMessage);
    const buildRouteDeterministicPatch = () => {
      if (!deterministicPatchRouteSelected || deterministicPatchBypassed) return null;
      return buildDeterministicPatchOperationBatch({
        projectInfo,
        userMessage,
        attachments,
        executionIntent,
        localDiagnostics,
      });
    };
    const allowLocalBlueprintFallback = initMode && !isGuidedAppArchitecture;
    const localBlueprintRouteSelected =
      productRouteMode === 'adaptive_blueprint' ||
      productRouteMode === 'faber_blueprint' ||
      buildModeName === 'adaptive_blueprint' ||
      buildModeName === 'initial_blueprint';
    const localBlueprintRequestSelected = Boolean(
      localBlueprintRouteSelected ||
        (allowLocalBlueprintFallback && initMode && shouldPreferProjectBlueprint(blueprintOptions)) ||
        (allowLocalBlueprintFallback && initMode && shouldUseProjectBlueprintFallback(blueprintOptions))
    );
    const explicitBlueprintRebuild =
      initMode &&
      hasApplicationFilesInProject &&
      localBlueprintRequestSelected &&
      hasExplicitProjectRebuildIntent(userMessage);
    const projectBlueprintFallback = async (scaffoldUserMessage = userMessage) => {
      if (!allowLocalBlueprintFallback) return null;
      if (hasApplicationFilesInProject && !explicitBlueprintRebuild) return null;
      if (!shouldUseProjectBlueprintFallback(blueprintOptions)) return null;
      return projectBlueprint(scaffoldUserMessage, { force: true });
    };
    const visualStructuralFallback = async (providerFailure = null) => {
      if (!allowLocalBlueprintFallback) return null;
      return buildVisualStructuralFallbackOperationBatch({
        projectInfo,
        userMessage,
        attachments,
        executionIntent,
        localDiagnostics,
        productRouteDecision,
        workingBrief,
        buildModeRoute,
        providerFailure,
      });
    };
    const requiresAdaptiveBlueprint =
      initMode &&
      (productRouteMode === 'adaptive_blueprint' || buildModeName === 'adaptive_blueprint') &&
      (!hasApplicationFilesInProject || explicitBlueprintRebuild);
    const requiresLocalBlueprint =
      initMode &&
      localBlueprintRequestSelected &&
      (!hasApplicationFilesInProject || explicitBlueprintRebuild);
    if (requiresAdaptiveBlueprint || explicitBlueprintRebuild) {
      const blueprint = await projectBlueprint(userMessage, { force: true });
      if (blueprint) {
        blueprint.raw = blueprint.raw || (explicitBlueprintRebuild ? 'explicit_rebuild_blueprint_contract' : 'adaptive_blueprint_contract');
        return blueprint;
      }
      return {
        ok: false,
        message:
          explicitBlueprintRebuild
            ? 'O modo de recriação explícita selecionou blueprint local, mas o renderer não conseguiu montar um lote de arquivos coerente. Nenhuma chamada remota foi usada para substituir esse contrato.'
            : 'O modo adaptive_blueprint foi selecionado, mas o renderer local não conseguiu montar um lote de arquivos coerente. Nenhuma chamada remota foi usada para substituir esse contrato.',
        raw: explicitBlueprintRebuild ? 'explicit_rebuild_blueprint_contract_unresolved' : 'adaptive_blueprint_contract_unresolved',
      };
    }
    if (
      requiresLocalBlueprint ||
      (allowLocalBlueprintFallback && initMode && !hasApplicationFilesInProject && shouldPreferProjectBlueprint(blueprintOptions))
    ) {
      const blueprint = await projectBlueprint();
      if (blueprint) return blueprint;
    }
    if (
      !initMode &&
      hasApplicationFilesInProject &&
      shouldRegenerateFromBriefingCheckpoint({ projectInfo, userMessage, executionIntent })
    ) {
      const blueprint = await projectBlueprint(userMessage, { force: true });
      if (blueprint) {
        blueprint.raw = 'regenerate_from_briefing_checkpoint:placeholder_or_low_adherence';
        blueprint.regeneration = {
          strategy: 'regenerate_from_briefing_checkpoint',
          reason: 'existing_surface_has_generic_placeholder_and_user_supplied_final_briefing',
        };
        return blueprint;
      }
    }
    if (!initMode) {
      const forgeDiagnosticRepair = buildForgeMrpDiagnosticRepairFallback('forge_mrp_diagnostic_repair_before_remote');
      if (forgeDiagnosticRepair) return forgeDiagnosticRepair;
      const deterministicPatch = buildRouteDeterministicPatch();
      if (deterministicPatch) return deterministicPatch;
      if (deterministicPatchRouteSelected && !deterministicPatchBypassed) {
        return {
          ok: false,
          message:
            'A rota determinística foi selecionada, mas nenhum micro-contrato local conseguiu produzir um patch seguro para este pedido.',
          raw: 'deterministic_patch_contract_unresolved',
        };
      }
    }
    const forgeInstructionRecovery = buildForgeMrpBlueprintFallback('forge_mrp_blueprint_before_remote_instruction_recovery');
    if (forgeInstructionRecovery) return forgeInstructionRecovery;

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
        ? wrapUntrusted('Conteudo util extraido de anexos (OCR/texto)', attachmentContext, 'attachments', 3800)
        : null,
      `Projeto atual: ${JSON.stringify(compactProject)}`,
      projectEvolutionContext
        ? wrapUntrusted('Contexto de arquivos existentes para edicao incremental', projectEvolutionContext, 'project_files', 5200)
        : null,
      projectGraphContext
        ? wrapUntrusted('Grafo de imports/exports/tipos/chamadas e contratos relacionados', projectGraphContext, 'project_graph', 5200)
        : null,
      workGraph && workGraph.projectGraph
        ? wrapUntrusted('Relatorio estruturado do grafo do projeto', JSON.stringify(workGraph.projectGraph), 'project_graph_report', 4200)
        : null,
      workGraph && workGraph.agenticPlan
        ? wrapUntrusted('Plano agentic de arquitetura e etapas verificaveis', JSON.stringify(workGraph.agenticPlan), 'agentic_plan', 4200)
        : null,
      diagnosticsContext
        ? wrapUntrusted('Diagnostico tecnico anterior para correcao pontual', diagnosticsContext, 'diagnostics', 1800)
        : null,
      localDiagnosticsContext
        ? wrapUntrusted('Diagnostico local dos arquivos atuais', localDiagnosticsContext, 'local_diagnostics', 1800)
        : null,
      artifactQualityGuidance || null,
      blueprintGuidance || null,
      activeMemoryContext
        ? wrapUntrusted('Memoria ativa operacional (mensagem atual / usuario / projeto)', activeMemoryContext, 'active_memory', 2200)
        : 'Memória ativa operacional: indisponível',
      workGraph && workGraph.brief ? wrapUntrusted('Briefing da Persona', workGraph.brief, 'working_brief', 1500) : null,
      workGraph && workGraph.briefSpec
        ? wrapUntrusted('Especificacao detalhada da Persona (siteSpec)', JSON.stringify(workGraph.briefSpec), 'working_brief_spec', 4200)
        : null,
      workGraph && workGraph.acceptanceCriteria
        ? wrapUntrusted('Criterios Cortex', JSON.stringify(workGraph.acceptanceCriteria), 'acceptance_criteria', 2200)
        : null,
      mempalaceContext && mempalaceContext.contextText
        ? wrapUntrusted('Memoria util', mempalaceContext.contextText, 'mempalace_context', 2400)
        : 'Memória útil: indisponível',
      mempalaceCore && mempalaceCore.ok
        ? wrapUntrusted('MemPalace core (wake-up/KG/tuneis)', formatMempalaceCoreForPrompt(mempalaceCore, 1200), 'mempalace_core', 1200)
        : 'MemPalace core: indisponível',
      ragContext && ragContext.contextText
        ? wrapUntrusted(`RAG (${ragContext.provider || 'r2r'}) para contexto de edicao`, ragContext.contextText, 'rag', 1200)
        : 'RAG para contexto de edição: indisponível',
      cortexContext && cortexContext.available && cortexContext.contextText
        ? wrapUntrusted('Contexto do Cortex para execucao', cortexContext.contextText, 'cortex_context', 1800)
        : 'Contexto do Cortex para execução: indisponível',
      repairContext
        ? wrapUntrusted('Contexto de reparo do pass anterior', JSON.stringify(repairContext), 'repair_context', 1800)
        : null,
      'Regras obrigatórias:',
      '- Use caminhos relativos ao root do projeto.',
      '- Não use arquivos genéricos de notas para simular conclusão; edite os artefatos reais do projeto.',
      `- Gere no máximo ${maxOps} operações neste pass.`,
      '- Quando já existirem arquivos no projeto, priorize edição incremental dos arquivos existentes antes de criar uma base nova.',
      '- Antes de chamar uma API/hook/store/service existente, confirme no relatório do grafo se o membro/export realmente existe; se não existir, edite também o contrato correspondente ou use a API real disponível.',
      '- Se o relatório do grafo apontar import relativo não resolvido, membro de store inexistente ou persistência incompleta, trate isso como causa raiz do patch atual.',
      '- Use o plano agentic como ordem de raciocínio: observe contratos, ajuste contratos/tipos, entregue fatia vertical, valide e só então promova.',
      '- Nunca escreva .env, .env.local, .env.* com segredos, .ssh, private_context ou chaves privadas; quando precisar documentar variáveis, use somente .env.example.',
      initMode
        ? '- MODO INIT_PROJECT: você pode estruturar novos arquivos base do projeto conforme briefing.'
        : '- MODO EDIT_PROJECT: proibido recriar o projeto inteiro; faça patch pontual e incremental sobre os arquivos atuais.',
      isGuidedAppArchitecture
        ? '- MODO GUIDED_APP_ARCHITECTURE: para apps complexos, escolha livremente a arquitetura e entregue uma fatia vertical executável: domínio/services/lib fora da UI, dados iniciais, regras determinísticas, interface operável e testes ou validações locais quando cabíveis. Não reduza o pedido a landing page ou dashboard estático.'
        : null,
      isGuidedAppArchitecture
        ? '- No modo guiado complexo, seja compacto: entregue a menor fatia vertical útil em poucos arquivos, priorizando domínio determinístico, UI operável e testes. Não tente resolver todos os módulos do produto em um único pass.'
        : null,
      isGuidedAppArchitecture
        ? '- No modo guiado complexo, o Faber não aplicará blueprint/template genérico como fallback; se algo ficar raso, a validação vai pedir nova passagem orientada por contrato.'
        : null,
      /\bnext(\.js|js)?\b/i.test(`${userMessage}\n${artifactQualityContext}`)
        ? '- Para Next.js/App Router, não use document, window, localStorage, sessionStorage ou navigator em escopo de módulo. Coloque CSS em app/globals.css/classes Tailwind; se precisar de API do navegador, use "use client" com useEffect ou handlers dentro do componente.'
        : null,
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

    const buildProviderRequestOptions = (numPredict = engineNumPredict, operationLimit = maxOps, options = {}) => ({
      runtimeBudget: activeRuntimeBudget,
      options: {
        num_predict: numPredict,
        response_format: buildOperationBatchResponseFormat(operationLimit),
        text_verbosity: options.textVerbosity || (isGuidedAppArchitecture ? 'low' : undefined),
      },
    });
    const buildCompactRecoveryPrompt = (providerFailure = null) => {
      const compactMaxOps = Math.max(1, Math.min(isGuidedAppArchitecture ? 8 : 6, maxOps));
      return [
        providerFailure && providerFailure.technicalMessage
          ? `A tentativa anterior falhou antes de entregar JSON: ${compactPromptPart(providerFailure.technicalMessage, 500)}`
          : 'A tentativa anterior falhou antes de entregar JSON.',
        'Retorne SOMENTE JSON válido no formato obrigatório. Não explique. Não use markdown.',
        `Pedido do usuário: ${compactPromptPart(userMessage, Math.min(1600, activeRuntimeBudget.maxPromptCharsPerPass))}`,
        `Projeto atual: ${JSON.stringify(compactProject)}`,
        projectEvolutionContext
          ? wrapUntrusted('Arquivos relevantes para edicao incremental', projectEvolutionContext, 'project_files', 2600)
          : null,
        projectGraphContext
          ? wrapUntrusted('Grafo e contratos essenciais', projectGraphContext, 'project_graph', 2600)
          : null,
        workGraph && workGraph.projectGraph
          ? wrapUntrusted('Relatorio estruturado essencial do grafo', JSON.stringify(workGraph.projectGraph), 'project_graph_report', 2400)
          : null,
        workGraph && workGraph.agenticPlan
          ? wrapUntrusted('Plano agentic essencial', JSON.stringify(workGraph.agenticPlan), 'agentic_plan', 2200)
          : null,
        localDiagnosticsContext
          ? wrapUntrusted('Diagnostico local essencial', localDiagnosticsContext, 'local_diagnostics', 900)
          : null,
        workGraph && workGraph.brief ? wrapUntrusted('Briefing da Persona', workGraph.brief, 'working_brief', 900) : null,
        workGraph && workGraph.acceptanceCriteria
          ? wrapUntrusted('Criterios Cortex', JSON.stringify(workGraph.acceptanceCriteria), 'acceptance_criteria', 900)
          : null,
        `Gere no máximo ${compactMaxOps} operações.`,
        initMode
          ? 'Escolha livremente a arquitetura, mas entregue uma fatia vertical executável e compacta.'
          : 'Faça somente edição incremental no projeto existente; altere apenas os arquivos necessários ao pedido atual.',
        isGuidedAppArchitecture
          ? 'A fatia precisa conter UI operável, domínio/regras determinísticas fora da UI e teste ou validação local quando cabível.'
          : null,
        /\bnext(\.js|js)?\b/i.test(`${userMessage}\n${artifactQualityContext}`)
          ? 'Em Next.js/App Router, não use document/window/localStorage em escopo de módulo; use app/globals.css/Tailwind ou useEffect/handlers dentro de componente client.'
          : null,
        'Não entregue landing page, dashboard estático, README ou arquivo de notas como substituto.',
      ]
        .filter(Boolean)
        .join('\n');
    };

    let raw = '';
    try {
      raw = await callPersonaProviderChat(
        PERSONA_MODEL_ENGINE,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        AI_REQUEST_TIMEOUT_MS,
        buildProviderRequestOptions()
      );
    } catch (error) {
      let providerFailure = normalizeProviderFailure(error, 'persona_engine');
      let providerError = error;
      const compactRetryAllowed =
        providerFailure.category === 'output_limit' ||
        providerFailure.category === 'network' ||
        providerFailure.category === 'timeout';
      const compactRetryRouteAllowed =
        providerFailure.category === 'output_limit' ||
        isGuidedAppArchitecture ||
        executionIntent === 'edit_project' ||
        executionIntent === 'diagnose_project' ||
        executionIntent === 'diagnostic_repair' ||
        productRouteMode === 'cortex_incremental_edit' ||
        productRouteMode === 'diagnostic_repair' ||
        buildModeName === 'diagnostic_repair' ||
        buildModeName === 'existing_project_edit';
      if (compactRetryAllowed && compactRetryRouteAllowed) {
        try {
          const compactMaxOps = Math.max(1, Math.min(isGuidedAppArchitecture ? 8 : 6, maxOps));
          raw = await callPersonaProviderChat(
            PERSONA_MODEL_ENGINE,
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: buildCompactRecoveryPrompt(providerFailure) },
            ],
            AI_REQUEST_TIMEOUT_MS,
            buildProviderRequestOptions(isGuidedAppArchitecture ? 16000 : 12000, compactMaxOps, { textVerbosity: 'low' })
          );
        } catch (retryError) {
          providerFailure = normalizeProviderFailure(retryError, 'persona_engine');
          providerError = retryError;
        }
      }
      if (raw) {
        providerFailure = null;
      }
      if (providerFailure) {
        const forgeDiagnosticRepair = buildForgeMrpDiagnosticRepairFallback(
          `forge_mrp_diagnostic_repair_after_provider_failure:${providerFailure.code}`
        );
        if (forgeDiagnosticRepair) return forgeDiagnosticRepair;

        const forgeBlueprint = buildForgeMrpBlueprintFallback(
          `forge_mrp_blueprint_after_provider_failure:${providerFailure.code}`,
          providerFailure
        );
        if (forgeBlueprint) return forgeBlueprint;

        const deterministicPatch = buildRouteDeterministicPatch();
        if (deterministicPatch) return deterministicPatch;

        const visualFallback = await visualStructuralFallback(providerFailure);
        if (visualFallback) {
          visualFallback.providerFailure = providerFailure;
          visualFallback.raw = visualFallback.raw || `visual_structural_fallback_after_provider_failure:${providerFailure.code}`;
          return visualFallback;
        }

        const blueprint = await projectBlueprintFallback();
        if (blueprint) {
          blueprint.providerFailure = providerFailure;
          blueprint.raw = `project_blueprint_after_provider_failure:${blueprint.providerFailure.code}:${blueprint.providerFailure.technicalMessage}`;
          return blueprint;
        }

        throw providerError;
      }
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
      const deterministicPatch = buildRouteDeterministicPatch();
      if (deterministicPatch) return deterministicPatch;
      const blueprint = await projectBlueprintFallback();
      if (blueprint) return blueprint;

      try {
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
          buildProviderRequestOptions()
        );
      } catch (error) {
        const providerFailure = normalizeProviderFailure(error, 'persona_engine');
        const forgeBlueprint = buildForgeMrpBlueprintFallback(
          `forge_mrp_blueprint_after_repair_failure:${providerFailure.code}`,
          providerFailure
        );
        if (forgeBlueprint) return forgeBlueprint;

        const visualFallback = await visualStructuralFallback(providerFailure);
        if (visualFallback) {
          visualFallback.providerFailure = providerFailure;
          visualFallback.raw = visualFallback.raw || `visual_structural_fallback_after_repair_failure:${providerFailure.code}`;
          return visualFallback;
        }
        throw error;
      }
      parsed = tryParseJsonObject(repairedRaw);
      parsedPlanValidation = parsed
        ? validateOperationBatchPlan({
            ...parsed,
            summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : 'Plano de execução preparado pelo executor.',
          })
        : { ok: false, errors: ['execution_plan repair must be valid JSON'] };
    }

    if (!parsedPlanValidation.ok) {
      const deterministicPatch = buildRouteDeterministicPatch();
      if (deterministicPatch) return deterministicPatch;
      const forgeBlueprint = buildForgeMrpBlueprintFallback('forge_mrp_blueprint_after_invalid_json');
      if (forgeBlueprint) return forgeBlueprint;
      const blueprint = await projectBlueprintFallback();
      if (blueprint) return blueprint;
      const visualFallback = await visualStructuralFallback();
      if (visualFallback) return visualFallback;
      return {
        ok: false,
        message:
          'O executor não retornou um plano JSON válido de execução mesmo após uma tentativa de correção. Nenhum patch seguro pôde ser derivado para este pedido.',
        schemaErrors: parsedPlanValidation.errors,
        raw: repairedRaw || raw,
      };
    }

    const normalizedOperations = repairUnsupportedAtAliasImports({
      operations: parsedPlanValidation.value.operations
        .map((entry) => normalizeEngineOperation(entry, normalizeRequestedRelativePath))
        .filter(Boolean)
        .slice(0, maxOps),
      projectInfo,
    });
    const sensitiveFiltered = filterSensitiveOperationBatch(normalizedOperations);
    const operations = sensitiveFiltered.operations;
    const blockedSensitiveOperations = sensitiveFiltered.blockedOperations;

    if (!operations.length) {
      const deterministicPatch = buildRouteDeterministicPatch();
      if (deterministicPatch) return deterministicPatch;
      const forgeBlueprint = buildForgeMrpBlueprintFallback('forge_mrp_blueprint_after_empty_operations');
      if (forgeBlueprint) return forgeBlueprint;
      const blueprint = await projectBlueprintFallback();
      if (blueprint) return blueprint;
      const visualFallback = await visualStructuralFallback();
      if (visualFallback) return visualFallback;
      return {
        ok: false,
        message: blockedSensitiveOperations.length
          ? 'O executor retornou apenas operações em caminhos sensíveis. Nenhum patch seguro pôde ser derivado para este pedido.'
          : 'O executor não retornou operações executáveis. Nenhum patch seguro pôde ser derivado para este pedido.',
        blockedOperations: blockedSensitiveOperations,
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
    if (
      artifactQuality &&
      artifactQuality.enabled &&
      !artifactQuality.passesMinimum &&
      isForgeMrpRequest({ userMessage, contextText: artifactQualityContext, workGraph, workingBrief })
    ) {
      const forgeBlueprint = buildForgeMrpBlueprintFallback(`forge_mrp_blueprint_after_artifact_quality:${artifactQuality.score}`);
      if (forgeBlueprint) {
        forgeBlueprint.artifactQuality = artifactQuality;
        return forgeBlueprint;
      }
    }
    const shouldUseBlueprintForWeakInit =
      initMode &&
      allowLocalBlueprintFallback &&
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
      allowLocalBlueprintFallback &&
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
    if (blockedSensitiveOperations.length) {
      action.blockedOperations = blockedSensitiveOperations;
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
  filterSensitiveOperationBatch,
  hasInstructionOnlyCriticalProjectFiles,
  isSensitiveOperationPath,
  repairUnsupportedAtAliasImports,
  shouldBypassDeterministicPatchForRequest,
  validatePatchFirstOperationBatch,
};
