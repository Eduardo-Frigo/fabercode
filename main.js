const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const dotenv = require('dotenv');
const { createAutomataExecutor } = require('./cortex/automata/core/executor');
const { validateOperationBatchPlan, validateRouteDecision } = require('./cortex/contracts/schemas');
const { createMemoryContextAdapter } = require('./cortex/memory/context_adapter');
const { createActiveMemoryService } = require('./cortex/memory/active_memory_service');
const { createCortexMemorySyncService } = require('./cortex/memory/cortex_memory_sync_service');
const { createKnowledgeRuntimeService } = require('./cortex/memory/knowledge_runtime_service');
const { createMemoryEmbeddingProviderService } = require('./cortex/memory/memory_embedding_provider_service');
const { createPersonaOrchestrator } = require('./cortex/orchestration/persona_orchestrator');
const { buildAgenticDevelopmentPlan } = require('./cortex/orchestration/agentic_development_plan_service');
const { createAutomataContractLedgerService } = require('./cortex/orchestration/automata_contract_ledger_service');
const { buildAcceptanceMatrixFromBriefing } = require('./cortex/orchestration/acceptance_matrix_service');
const { createArtifactQualityService } = require('./cortex/orchestration/artifact_quality_service');
const {
  hasApplicationSurfaceFiles: hasApplicationSurfaceFilesForBlueprintGuard,
  hasExplicitProjectRebuildIntent,
  resolveExecutionIntentFromContext,
} = require('./cortex/orchestration/execution_intent');
const {
  buildProductIntake,
} = require('./cortex/orchestration/product_intake_service');
const {
  CORTEX_RENDER_RUNTIME_VERSION,
  createCortexRuntimeCheckpoint,
  createCortexWorkGraph,
  createRenderPass,
  setPassStatus,
} = require('./cortex/orchestration/render_runtime_state');
const { createCortexBriefingService } = require('./cortex/orchestration/briefing_service');
const { createProductOrchestratorService } = require('./cortex/orchestration/product_orchestrator_service');
const { createProjectBlueprintService } = require('./cortex/orchestration/project_blueprint_service');
const {
  createCortexRenderPassService,
  hasInstructionOnlyCriticalProjectFiles,
} = require('./cortex/orchestration/render_pass_service');
const { createCortexRepairValidationService } = require('./cortex/orchestration/repair_validation_service');
const { createCortexRuntimeBudgetService } = require('./cortex/orchestration/runtime_budget');
const { createCortexValidationService } = require('./cortex/orchestration/validation_service');
const {
  buildForgeMrpOperationBatch,
  isForgeMrpRequest,
} = require('./cortex/orchestration/forge_mrp_blueprint_service');
const { createOrchestrationStateStore } = require('./cortex/orchestration/state_store');
const { callMockPersonaProviderChat } = require('./cortex/providers/mock_provider');
const { createProviderRegistry } = require('./cortex/providers/registry');
const {
  buildProviderFailureReason,
  normalizeProviderFailure,
} = require('./cortex/providers/provider_failure_service');
const {
  createRemoteProviderClients,
  extractOpenAiResponsesText,
  resolveOpenAiBaseUrl,
  shouldUseOpenAiResponsesApi,
} = require('./cortex/providers/remote_clients');
const { createRwkvProviderClient } = require('./cortex/providers/rwkv_client');
const {
  createAiRuntimeSettingsService,
  normalizeAiProviderName,
} = require('./cortex/providers/runtime_settings');
const { createAiRuntimeStatusService } = require('./cortex/providers/runtime_status');
const { createAutomataTools } = require('./cortex/tools/automata_tools');
const { createCapabilityTools } = require('./cortex/tools/capability_tools');
const { createToolRegistry } = require('./cortex/tools/registry');
const {
  compactJsonForPrompt,
  wrapUntrustedPromptSection,
} = require('./cortex/security/ai_trust_boundary');
const { registerAccountHandlers } = require('./main/ipc/account_handlers');
const { registerAiHandlers } = require('./main/ipc/ai_handlers');
const { registerAutomataContractHandlers } = require('./main/ipc/automata_contract_handlers');
const { registerExternalMcpHandlers } = require('./main/ipc/external_mcp_handlers');
const { registerFileHandlers } = require('./main/ipc/file_handlers');
const { registerGithubHandlers } = require('./main/ipc/github_handlers');
const { registerKnowledgeRuntimeHandlers } = require('./main/ipc/knowledge_runtime_handlers');
const { registerMempalaceHandlers } = require('./main/ipc/mempalace_handlers');
const { registerOrchestrationHandlers } = require('./main/ipc/orchestration_handlers');
const { registerPreviewHandlers } = require('./main/ipc/preview_handlers');
const { registerProjectHandlers } = require('./main/ipc/project_handlers');
const { registerTerminalHandlers } = require('./main/ipc/terminal_handlers');
const { createIpcSecurity } = require('./main/security/ipc_security');
const { createProjectAccess } = require('./main/security/project_access');
const { createSecretStore } = require('./main/security/secret_store');
const { normalizeExternalUrl, normalizePreviewOpenUrl } = require('./main/security/url_policy');
const { createArtifactStoreService } = require('./main/services/artifact_store_service');
const { createCommandRunner } = require('./main/services/command_runner');
const { createCortexRuntimeJobService } = require('./main/services/cortex_runtime_job_service');
const { createCortexLearningPayloadService } = require('./main/services/cortex_learning_payload_service');
const { createCssRuntimeRepairService } = require('./main/services/css_runtime_repair_service');
const {
  buildCortexPexelsContractFromPersonaBrief,
  resolveRuntimeLocalBlueprintPolicy,
  shouldTreatRuntimeRequestAsDiagnostic,
  resolveCortexProductRuntimeContract,
  resolveCortexProductRouteDecisionFromContextHint,
  resolveCortexBuildModeRouteFromProductRoute,
  resolvePersonaWorkingBriefFromProductRoute,
} = require('./main/services/cortex_product_runtime_contract_service');
const { createProjectGitService } = require('./main/services/git_service');
const {
  createDeterministicEditService,
  extractRequestedTitle,
  isBackgroundColorEditRequest,
  isButtonColorEditRequest,
  isCardTextEditRequest,
  isCtaTextEditRequest,
  isFaqItemPatchRequest,
  isFooterInsertRequest,
  isFormFieldPatchRequest,
  isGridColumnsEditRequest,
  isHeroMediaPatchRequest,
  isHeadingColorEditRequest,
  isHydrationMismatchRepairRequest,
  isLiteralColorReplacementRequest,
  isNavLinkEditRequest,
  isSecondaryCtaEditRequest,
  isSectionRemoveRequest,
  isSectionReorderRequest,
  isStatTextPatchRequest,
  isThemeColorEditRequest,
  isTypographyEditRequest,
  isUnsupportedBackgroundMediaRequest,
} = require('./main/services/deterministic_edit_service');
const {
  buildDeterministicEditPatchCheckpoint,
  buildDeterministicEditPatchEventPayload,
} = require('./main/services/deterministic_edit_patch_evidence_service');
const { createVisualHeroPatchService } = require('./main/services/visual_hero_patch_service');
const { createGithubIntegrationService } = require('./main/services/github_integration_service');
const { createFaberCapabilityAdapterService } = require('./main/services/faber_capability_adapter_service');
const { createExternalMcpServerRegistryService } = require('./main/services/external_mcp_server_registry_service');
const { createExternalMcpPresetRegistryService } = require('./main/services/external_mcp_preset_registry_service');
const { createExternalMcpDiscoveryCacheService } = require('./main/services/external_mcp_discovery_cache_service');
const { createLocalDiagnosticsService } = require('./main/services/local_diagnostics_service');
const { createCortexMemoryManagementService } = require('./main/services/cortex_memory_management_service');
const { createMemoryEvidenceLedgerService } = require('./main/services/memory_evidence_ledger_service');
const { createPlatformAccountService } = require('./main/services/platform_account_service');
const { createPlatformBackendService } = require('./main/services/platform_backend_service');
const { createPlatformGuidanceService } = require('./main/services/platform_guidance_service');
const { createPlatformMediaService } = require('./main/services/platform_media_service');
const { createPexelsAssetService } = require('./main/services/pexels_asset_service');
const { createPostgresUserStore } = require('./main/services/postgres_user_store');
const { createPostExecutionQualityService } = require('./main/services/post_execution_quality_service');
const { createProjectPreviewRuntimeService } = require('./main/services/project_preview_runtime_service');
const { createProjectPreviewService } = require('./main/services/project_preview_service');
const { createProjectPreviewDiagnosticService } = require('./main/services/project_preview_diagnostic_service');
const { createProjectScanner } = require('./main/services/project_scanner');
const { createProjectTerminalService } = require('./main/services/project_terminal_service');
const { createProjectVerificationService } = require('./main/services/project_verification_service');
const {
  buildDiagnosticsHintFromVerifiedExecution,
  createProjectVerifiedExecutionService,
  shouldVerifyAction: shouldVerifyProjectAction,
} = require('./main/services/project_verified_execution_service');
const { createAgenticToolLoopService } = require('./main/services/agentic_tool_loop_service');
const { createProjectVisualCaptureService } = require('./main/services/project_visual_capture_service');
const { createProjectVisualValidationRuntimeService } = require('./main/services/project_visual_validation_runtime_service');
const { createStackRegistryService } = require('./main/services/stack_registry_service');
const { createAttachmentContextService } = require('./main/runtime/attachment_context');
const { createCustomProviderProfileService } = require('./main/runtime/custom_provider_profile');
const { buildOperationBatchDiffPreview } = require('./main/runtime/diff_preview');
const { createFileTextUtils } = require('./main/runtime/file_text_utils');
const { createProjectContextService } = require('./main/runtime/project_context');
const { createProjectStore } = require('./main/runtime/project_store');
const { createMainRuntimeConfig } = require('./main/runtime/runtime_config');
const { createProviderRateLimiter } = require('./main/runtime/provider_rate_limiter');
const { createRuntimeProfileService } = require('./main/runtime/runtime_profile');

function loadEnvFromCandidates(candidates) {
  const loadedPaths = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate) || !fs.existsSync(candidate)) continue;
    seen.add(candidate);
    dotenv.config({ path: candidate, override: false });
    loadedPaths.push(candidate);
  }
  return loadedPaths;
}

const ENV_PATH_CANDIDATES = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env'),
  app.isPackaged ? path.join(process.resourcesPath, '.env') : null,
  app.isPackaged ? path.join(path.dirname(process.execPath), '.env') : null,
].filter(Boolean);
const LOADED_ENV_PATHS = loadEnvFromCandidates(ENV_PATH_CANDIDATES);

const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.cache', '.faber']);
const MAX_FILES_SCAN = 800;
const stackRegistryService = createStackRegistryService({
  fs,
  path,
  pluginDirectories: [
    path.join(__dirname, 'plugins', 'stacks'),
  ],
});
const projectScanner = createProjectScanner({
  excludedDirs: EXCLUDED_DIRS,
  fs,
  maxFilesScan: MAX_FILES_SCAN,
  path,
  stackRegistry: stackRegistryService,
});
const {
  collectProjectFilesTree,
  scanProject,
} = projectScanner;
const {
  MAX_AUDIT_EVENTS,
  MAX_CONVERSATION_MESSAGES,
  MAX_CORTEX_LEARNING_EVENTS,
  MAX_CORTEX_CONTEXT_ITEMS,
  MAX_JOB_EVENTS,
  MAX_JOBS_STORED,
  AI_PROVIDER_OPTIONS,
  AI_PROVIDER_ENV,
  OPENAI_API_BASE_URL,
  OPENAI_API_KEY,
  OPENAI_MODEL_BRAIN_ENV,
  PEXELS_API_KEY,
  FABER_DATABASE_URL,
  FABER_SESSION_SECRET,
  FABER_APP_BASE_URL,
  FABER_BACKEND_HOST,
  FABER_BACKEND_PORT,
  FABER_POSTGRES_SSL,
  FABER_AUTH_DEV_CODES,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_REDIRECT_URI,
  GITHUB_SCOPES,
  OPENAI_MIN_REQUEST_INTERVAL_MS,
  OPENAI_MAX_REQUESTS_PER_MINUTE,
  GEMINI_API_BASE_URL,
  GEMINI_API_KEY,
  GEMINI_MODEL_BRAIN_ENV,
  GEMINI_MAX_REQUESTS_PER_MINUTE,
  SAMBANOVA_API_BASE_URL,
  SAMBANOVA_API_KEY,
  SAMBANOVA_MODEL_BRAIN_ENV,
  SAMBANOVA_MIN_REQUEST_INTERVAL_MS,
  SAMBANOVA_MAX_REQUESTS_PER_MINUTE,
  PERSONA_MODEL_ENGINE,
  PERSONA_MODEL_BRAIN,
  AI_REQUEST_TIMEOUT_MS,
  BRAIN_BRIEFING_TIMEOUT_MS,
  GEMINI_MIN_REQUEST_INTERVAL_MS,
  GEMINI_429_BASE_BACKOFF_MS,
  GEMINI_429_MAX_BACKOFF_MS,
  OPENAI_429_BASE_BACKOFF_MS,
  OPENAI_429_MAX_BACKOFF_MS,
  SAMBANOVA_429_BASE_BACKOFF_MS,
  SAMBANOVA_429_MAX_BACKOFF_MS,
  RWKV_ENABLED,
  RWKV_MODEL_PATH,
  RWKV_TOKENIZER_PATH,
  RWKV_STRATEGY,
  RWKV_MAX_NEW_TOKENS,
  RWKV_TEMPERATURE,
  RWKV_TOP_P,
  RWKV_V7_ON,
  RWKV_PROVIDER_SCRIPT,
  AUTOMATA_BUNDLE_ROOT,
  CORTEX_RAG_ENABLED,
  CORTEX_RAG_PROVIDER,
  CORTEX_MEMORY_EMBEDDING_PROVIDER,
  CORTEX_MEMORY_EMBEDDING_ENDPOINT,
  CORTEX_MEMORY_EMBEDDING_API_KEY,
  CORTEX_MEMORY_EMBEDDING_MODEL,
  CORTEX_MEMORY_EMBEDDING_DIMENSIONS,
  CORTEX_MEMORY_EMBEDDING_TIMEOUT_MS,
  R2R_BASE_URL,
  R2R_API_KEY,
  R2R_CORTEX_INGEST_ENDPOINT,
  R2R_CORTEX_REINDEX_ENDPOINT,
  R2R_CORTEX_DELETE_ENDPOINT,
  R2R_SEARCH_LIMIT,
  R2R_STATUS_TIMEOUT_MS,
  R2R_TIMEOUT_MS,
  TIME_AS_COMPUTE_PROFILE,
  BRAIN_PLAN_MAX_ATTEMPTS_ENV,
  BRAIN_PLAN_MAX_ELAPSED_MS_ENV,
  SCAFFOLD_MAX_CLARIFICATIONS_ENV,
  PERSONA_PROTOCOL_VERSION,
  SUPPORTED_EXEC_PROTOCOLS,
  JOB_RETRY_STAGNATION_LIMIT,
  JOB_RETRY_NO_PROGRESS_MS,
  JOB_PROGRESS_MIN_DELTA,
  JOB_SOFT_TIMEOUT_MS,
  JOB_RETRY_SAME_REASON_LIMIT,
  JOB_RETRY_SAME_FINGERPRINT_LIMIT,
  CORTEX_VALIDATION_MIN_SCORE,
  CORTEX_VALIDATION_REQUIRE_CORE,
  CORTEX_VALIDATION_STALL_LIMIT,
  CORTEX_VALIDATION_REPAIR_MIN_IMPROVEMENT,
  CORTEX_VALIDATION_REPAIR_STALL_LIMIT,
  CORTEX_VALIDATION_MAX_RETRIES,
  CORTEX_BRIEFING_MAX_RETRIES,
  AUTOMATA_ENABLED,
  AUTOMATA_STRICT_EXECUTION,
  AIDER_MAIN_ROOT,
  POST_EXEC_QUALITY_ENABLED,
  POST_EXEC_QUALITY_MAX_FILES,
  POST_EXEC_QUALITY_MAX_ISSUES,
  POST_EXEC_QUALITY_TIMEOUT_MS,
  POST_EXEC_QUALITY_ENFORCE_ERRORS,
  POST_EXEC_QUALITY_ENFORCE_WARNINGS,
  EXECUTION_ENFORCE_EFFECT_GATE,
  EXECUTION_ENFORCE_NONZERO_DIFF_ON_EDIT,
  AUTO_REPAIR_ENABLED,
  AUTO_REPAIR_MAX_PASSES,
  AIDER_LINT_TIMEOUT_MS,
  MEMPALACE_LOCAL_VENV_PYTHON,
  MEMPALACE_PYTHON_BIN,
  MEMPALACE_COMMAND_TIMEOUT_MS,
  MEMPALACE_REPO_CANDIDATES,
  COMMUNICATION_STYLE_GUIDE,
  PROVIDER_REQUEST_WINDOW_MS,
  PERSONA_HUMANIZATION_PROTOCOL,
  CORTEX_STOPWORDS,
} = createMainRuntimeConfig({
  cwd: process.cwd(),
  dirname: __dirname,
  env: process.env,
  fs,
  normalizeAiProviderName,
  path,
  platform: process.platform,
});

const providerRateLimiter = createProviderRateLimiter({
  computeRetryBackoffMs,
  isTransientTooManyRequestsReason,
  maxRequestsPerMinute: {
    gemini: GEMINI_MAX_REQUESTS_PER_MINUTE,
    openai: OPENAI_MAX_REQUESTS_PER_MINUTE,
    sambanova: SAMBANOVA_MAX_REQUESTS_PER_MINUTE,
  },
  providerRequestWindowMs: PROVIDER_REQUEST_WINDOW_MS,
});
const {
  applyProviderCooldownFromReason,
  clearProviderCooldown,
  delayMs,
  enforceProviderCooldown,
  enforceProviderRequestsPerMinute,
  getProviderRequestsPerMinuteLimit,
  normalizeProviderKey,
} = providerRateLimiter;

const runtimeProfileService = createRuntimeProfileService({
  brainPlanMaxAttemptsEnv: BRAIN_PLAN_MAX_ATTEMPTS_ENV,
  brainPlanMaxElapsedMsEnv: BRAIN_PLAN_MAX_ELAPSED_MS_ENV,
  os,
  scaffoldMaxClarificationsEnv: SCAFFOLD_MAX_CLARIFICATIONS_ENV,
  timeAsComputeProfile: TIME_AS_COMPUTE_PROFILE,
});
const {
  getBrainBudgetSettings,
  getRuntimeProfileSettings,
  resolveTimeAsComputeProfile,
  sanitizePositiveInt,
} = runtimeProfileService;

const commandRunner = createCommandRunner({ spawn });
const { runCommand } = commandRunner;

const fileTextUtils = createFileTextUtils({ crypto });
const {
  clipText,
  clipTextPreserveLines,
  hashText,
  isTextLikeExtension,
} = fileTextUtils;

const attachmentContextService = createAttachmentContextService({
  clipTextPreserveLines,
  fs,
  isTextLikeExtension,
  path,
  runCommand,
});

const {
  buildAttachmentsPromptContext,
  extractAttachmentText,
} = attachmentContextService;

const projectTerminalService = createProjectTerminalService({
  fs,
  path,
  spawn,
});

const localDiagnosticsService = createLocalDiagnosticsService({ fs, path });
const {
  buildLocalProjectDiagnostics,
  formatLocalProjectDiagnosticsForPrompt,
  hasCssOrVisualRepairIntent,
  hasEditIntent,
  hasExistingProjectFiles,
  hasProjectEvolutionIntent,
  shouldForceExecutionFromLocalDiagnostics,
} = localDiagnosticsService;

const platformGuidanceService = createPlatformGuidanceService();
const {
  buildProjectNextSteps,
} = platformGuidanceService;

const projectPreviewService = createProjectPreviewService({
  fs,
  path,
});
const {
  buildProjectPreviewPlan,
} = projectPreviewService;

const projectPreviewDiagnosticService = createProjectPreviewDiagnosticService({
  buildProjectPreviewPlan,
});
const {
  buildPreviewDiagnosticResponse,
} = projectPreviewDiagnosticService;

const projectPreviewRuntimeService = createProjectPreviewRuntimeService({
  buildProjectPreviewPlan,
  fs,
  path,
  spawn,
});
const {
  getProjectPreviewRuntimeStatus,
  startProjectPreview,
  stopAllProjectPreviews,
  stopProjectPreview,
} = projectPreviewRuntimeService;

const projectVerificationService = createProjectVerificationService({
  fs,
  path,
  runCommand,
});
const {
  buildProjectVerificationPlan,
  runProjectVerification,
} = projectVerificationService;

const artifactQualityService = createArtifactQualityService({
  fs,
  path,
});
const {
  buildArtifactQualityContextText,
  buildArtifactQualityPromptGuidance,
  evaluateOperationBatchArtifactQuality,
  formatArtifactQualityForPrompt,
} = artifactQualityService;

const artifactStoreService = createArtifactStoreService({
  crypto,
  fs,
  path,
});

const projectVisualCaptureService = createProjectVisualCaptureService({
  BrowserWindow,
  app,
  artifactStore: artifactStoreService,
  fs,
  path,
});

const projectVisualValidationRuntimeService = createProjectVisualValidationRuntimeService({
  captureProjectPreview: projectVisualCaptureService.captureProjectPreview,
  executeBrowserPreviewCapability: (projectInfo, options = {}) => {
    const captureOptions = options.captureOptions || {};
    const viewports = Array.isArray(captureOptions.viewports) && captureOptions.viewports.length
      ? captureOptions.viewports
      : captureOptions.viewport
        ? [captureOptions.viewport]
        : null;
    return getFaberCapabilityAdapterService().executeCapability({
      capability: 'browser_preview',
      action: 'capture',
      projectSession: {
        rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '',
        projectName: projectInfo && projectInfo.name ? projectInfo.name : '',
      },
      payload: {
        options: options.previewOptions || {},
        captureOptions,
        viewports,
      },
    });
  },
  evaluateOperationBatchArtifactQuality,
  startProjectPreview,
});
const {
  buildVisualValidationDiagnosticsHint,
  buildVisualValidationGateMessage,
  evaluateVisualValidationGate,
  runProjectVisualValidation,
} = projectVisualValidationRuntimeService;

const projectBlueprintService = createProjectBlueprintService({
  stackRegistry: stackRegistryService,
});
const {
  buildProjectBlueprintOperationBatch,
  buildProjectBlueprintPromptGuidance,
  hasRequiredProjectBlueprintFiles,
  shouldPreferProjectBlueprint,
  shouldUseProjectBlueprintFallback,
} = projectBlueprintService;

const postExecutionQualityService = createPostExecutionQualityService({
  AIDER_LINT_TIMEOUT_MS,
  AIDER_MAIN_ROOT,
  EXECUTION_ENFORCE_EFFECT_GATE,
  EXECUTION_ENFORCE_NONZERO_DIFF_ON_EDIT,
  POST_EXEC_QUALITY_ENABLED,
  POST_EXEC_QUALITY_ENFORCE_ERRORS,
  POST_EXEC_QUALITY_ENFORCE_WARNINGS,
  POST_EXEC_QUALITY_MAX_FILES,
  POST_EXEC_QUALITY_MAX_ISSUES,
  POST_EXEC_QUALITY_TIMEOUT_MS,
  clipTextPreserveLines,
  evaluateOperationBatchArtifactQuality,
  fs,
  path,
  runCommand,
});
const {
  buildDiagnosticsHintFromQualityReport,
  buildDiagnosticsPromptContext,
  buildExecutionEffectGateMessage,
  buildExecutionOutcomeReport,
  buildPostExecutionGateMessage,
  evaluateExecutionEffectGate,
  evaluatePostExecutionGate,
  runPostExecutionQualityReport,
} = postExecutionQualityService;

const cortexRuntimeBudgetService = createCortexRuntimeBudgetService({
  CORTEX_MEMORY_PAUSE_FREE_MB: Number.parseInt(process.env.CORTEX_MEMORY_PAUSE_FREE_MB || '384', 10),
  CORTEX_MEMORY_PAUSE_SWAP_MB: Number.parseInt(process.env.CORTEX_MEMORY_PAUSE_SWAP_MB || '4096', 10),
  getRuntimeProfileSettings,
  getSelectedAiProvider,
  normalizeAiProviderName,
  os,
  platform: process.platform,
  runCommand,
});

const {
  buildRuntimeBudget,
  getCortexRuntimeBudget,
} = cortexRuntimeBudgetService;

let projectContextService;

const memoryContextAdapter = createMemoryContextAdapter({
  CORTEX_RAG_ENABLED,
  CORTEX_RAG_PROVIDER,
  MEMPALACE_COMMAND_TIMEOUT_MS,
  MEMPALACE_PYTHON_BIN,
  MEMPALACE_REPO_CANDIDATES,
  R2R_API_KEY,
  R2R_BASE_URL,
  R2R_CORTEX_INGEST_ENDPOINT,
  R2R_CORTEX_REINDEX_ENDPOINT,
  R2R_CORTEX_DELETE_ENDPOINT,
  R2R_SEARCH_LIMIT,
  R2R_STATUS_TIMEOUT_MS,
  R2R_TIMEOUT_MS,
  clipText,
  crypto,
  env: process.env,
  extractIntentTerms: (text) => (projectContextService ? projectContextService.extractIntentTerms(text) : []),
  fetchFn: fetch,
  fs,
  getRuntimeProfileSettings,
  getUserDataPath: () => app.getPath("userData"),
  path,
  runCommand,
});

const memoryEmbeddingProviderService = createMemoryEmbeddingProviderService({
  config: {
    provider: CORTEX_MEMORY_EMBEDDING_PROVIDER,
    endpoint: CORTEX_MEMORY_EMBEDDING_ENDPOINT || OPENAI_API_BASE_URL,
    apiKey: CORTEX_MEMORY_EMBEDDING_API_KEY,
    model: CORTEX_MEMORY_EMBEDDING_MODEL,
    dimensions: CORTEX_MEMORY_EMBEDDING_DIMENSIONS,
    timeoutMs: CORTEX_MEMORY_EMBEDDING_TIMEOUT_MS,
    allowFallback: true,
  },
  fetchFn: fetch,
});

const {
  buildMempalaceCortexCore,
  buildMempalacePlannerContext,
  buildRagPlannerContext,
  ensureMempalaceProjectIndexed,
  forgetMempalaceMemory,
  forgetRagMemory,
  formatMempalaceCoreForPrompt,
  getMempalaceRuntimeStatus,
  getRagRuntimeStatus,
  indexCortexMemoryInRag,
  persistCortexMemoryToMempalace,
  persistCortexCheckpointToMempalace,
  reindexRagProject,
  searchMempalaceContext,
} = memoryContextAdapter;

const cortexBriefingService = createCortexBriefingService({
  BRAIN_BRIEFING_TIMEOUT_MS,
  PERSONA_MODEL_BRAIN,
  buildAttachmentsPromptContext,
  buildDiagnosticsPromptContext,
  buildLocalProjectDiagnostics,
  buildProjectEvolutionContext: (...args) =>
    projectContextService ? projectContextService.buildProjectEvolutionContext(...args) : '',
  callPersonaProviderChat,
  clipText,
  formatLocalProjectDiagnosticsForPrompt,
  formatMempalaceCoreForPrompt,
  getRuntimeProfileSettings,
  hasScaffoldIntent,
  sanitizeAssistantText,
  tryParseJsonObject,
});

const {
  buildCortexBriefingClarificationResponse,
  buildDefaultScaffoldPrompt,
  getCortexBriefingClarificationQuestions,
  requestCortexBrainBriefing,
  shouldAskCortexBriefingClarification,
  shouldUseDefaultScaffoldConfiguration,
} = cortexBriefingService;

const productOrchestratorService = createProductOrchestratorService({
  extractRequestedTitle,
  getSelectedAiProvider,
  hasEditIntent,
  hasScaffoldIntent,
  hasSearchIntent,
  isButtonColorEditRequest,
  isBackgroundColorEditRequest,
  isCardTextEditRequest,
  isCtaTextEditRequest,
  isFaqItemPatchRequest,
  isFooterInsertRequest,
  isFormFieldPatchRequest,
  isGridColumnsEditRequest,
  isHeroMediaPatchRequest,
  isHeadingColorEditRequest,
  isHydrationMismatchRepairRequest,
  isLiteralColorReplacementRequest,
  isNavLinkEditRequest,
  isSecondaryCtaEditRequest,
  isSectionRemoveRequest,
  isSectionReorderRequest,
  isStatTextPatchRequest,
  isThemeColorEditRequest,
  isTypographyEditRequest,
  isUnsupportedBackgroundMediaRequest,
  requestAiProductRouteDecision,
  resolveExecutionIntent,
  shouldPreferProjectBlueprint,
  shouldUseDefaultScaffoldConfiguration,
});
const {
  resolveProductRoute,
} = productOrchestratorService;

const cortexRenderPassService = createCortexRenderPassService({
  AI_REQUEST_TIMEOUT_MS,
  PERSONA_MODEL_ENGINE,
  buildAttachmentsPromptContext,
  buildArtifactQualityPromptGuidance,
  buildDeterministicPatchOperationBatch,
  buildDiagnosticsPromptContext,
  buildLocalProjectDiagnostics,
  buildOperationBatchDiffPreview,
  buildProjectBlueprintOperationBatch,
  buildProjectBlueprintPromptGuidance,
  buildProjectEvolutionContext: (...args) =>
    projectContextService ? projectContextService.buildProjectEvolutionContext(...args) : '',
  buildProjectGraphContext: (...args) =>
    projectContextService ? projectContextService.buildProjectGraphContext(...args) : '',
  buildRuntimeBudget,
  buildVisualStructuralFallbackOperationBatch,
  callPersonaProviderChat,
  clipText,
  evaluateOperationBatchArtifactQuality,
  formatArtifactQualityForPrompt,
  formatLocalProjectDiagnosticsForPrompt,
  formatMempalaceCoreForPrompt,
  getRuntimeProfileSettings,
  hasRequiredProjectBlueprintFiles,
  normalizeRequestedRelativePath,
  resolveBlueprintMediaAssets: (options) => resolveBlueprintMediaAssets(options),
  shouldPreferProjectBlueprint,
  shouldUseProjectBlueprintFallback,
  tryParseJsonObject,
  validateOperationBatchPlan,
});

const {
  requestEngineOperationBatchAction,
} = cortexRenderPassService;

const cortexRuntimeJobService = createCortexRuntimeJobService({
  appendJobEvent: (...args) => appendJobEvent(...args),
  buildConfirmationPlan,
  buildDeterministicEditPatchCheckpoint,
  buildDeterministicEditPatchEventPayload,
  clipText,
  createCortexRuntimeCheckpoint,
  markJobPhase: (...args) => markJobPhase(...args),
  runtimeVersion: CORTEX_RENDER_RUNTIME_VERSION,
  setJobCheckpoint: (...args) => setJobCheckpoint(...args),
});

const {
  buildCortexPausePlan,
  checkpointCortexRuntime,
  checkpointDeterministicPatchPlan,
  checkpointProjectBlueprintPlan,
  checkpointRuntimeBudget,
  compactPromptPart,
  markCortexRuntimePhase,
} = cortexRuntimeJobService;

const cortexValidationService = createCortexValidationService({
  CORTEX_VALIDATION_MIN_SCORE,
  CORTEX_VALIDATION_REQUIRE_CORE,
  CORTEX_VALIDATION_REPAIR_MIN_IMPROVEMENT,
  excludedDirs: EXCLUDED_DIRS,
  evaluateOperationBatchArtifactQuality,
  fs,
  path,
  normalizeRequestedRelativePath,
});

const {
  evaluateExecutionReadiness,
  hasValidationCoverageImproved,
  mergeOperationBatches,
} = cortexValidationService;

const cortexRepairValidationService = createCortexRepairValidationService({
  CORTEX_VALIDATION_REPAIR_STALL_LIMIT,
  buildOperationBatchDiffPreview,
  checkpointCortexRuntime,
  evaluateExecutionReadiness,
  hasValidationCoverageImproved,
  mergeOperationBatches,
  requestEngineOperationBatchAction,
});

const {
  runRepairValidationLoop,
} = cortexRepairValidationService;

let secretStoreInstance = null;

function getSecretStore() {
  if (!secretStoreInstance) {
    secretStoreInstance = createSecretStore({ safeStorage });
  }
  return secretStoreInstance;
}

const aiRuntimeSettings = createAiRuntimeSettingsService({
  aiProviderEnv: AI_PROVIDER_ENV,
  fs,
  geminiApiKey: GEMINI_API_KEY,
  geminiModelBrain: GEMINI_MODEL_BRAIN_ENV,
  getUserDataPath: () => app.getPath('userData'),
  openaiApiKey: OPENAI_API_KEY,
  openaiModelBrain: OPENAI_MODEL_BRAIN_ENV,
  path,
  pexelsApiKey: PEXELS_API_KEY,
  protectSecret: (value) => getSecretStore().protectSecret(value),
  sambanovaApiKey: SAMBANOVA_API_KEY,
  sambanovaModelBrain: SAMBANOVA_MODEL_BRAIN_ENV,
  unprotectSecret: (value) => getSecretStore().unprotectSecret(value),
});

const externalMcpServerRegistryService = createExternalMcpServerRegistryService({
  fs,
  getUserDataPath: () => app.getPath('userData'),
  path,
  protectSecret: (value) => getSecretStore().protectSecret(value),
  unprotectSecret: (value) => getSecretStore().unprotectSecret(value),
});

const externalMcpPresetRegistryService = createExternalMcpPresetRegistryService();

const externalMcpDiscoveryCacheService = createExternalMcpDiscoveryCacheService({
  fs,
  getUserDataPath: () => app.getPath('userData'),
  path,
});

const {
  getEffectiveOpenAiApiKey,
  getEffectiveOpenAiModel,
  getEffectivePexelsApiKey,
  getEffectiveGeminiApiKey,
  getEffectiveGeminiModel,
  getEffectiveSambaNovaApiKey,
  getEffectiveSambaNovaModel,
  listCustomApiProfiles,
  readSettings: readAiRuntimeSettings,
  sanitizeCustomApiProfiles,
  sanitizeOpenAiModelName,
  sanitizeGeminiModelName,
  sanitizeSambaNovaModelName,
  setSelectedProvider: setSelectedAiProvider,
  writeSettings: writeAiRuntimeSettings,
} = aiRuntimeSettings;

const postgresUserStore = createPostgresUserStore({
  databaseUrl: FABER_DATABASE_URL,
  ssl: FABER_POSTGRES_SSL ? { rejectUnauthorized: false } : null,
});

const platformAccountService = createPlatformAccountService({
  allowDevEmailCodes: FABER_AUTH_DEV_CODES,
  appBaseUrl: FABER_APP_BASE_URL,
  databaseUrl: FABER_DATABASE_URL,
  fetchFn: fetch,
  googleClientId: GOOGLE_CLIENT_ID,
  googleClientSecret: GOOGLE_CLIENT_SECRET,
  googleRedirectUri: GOOGLE_REDIRECT_URI,
  githubClientId: GITHUB_CLIENT_ID,
  githubClientSecret: GITHUB_CLIENT_SECRET,
  githubRedirectUri: GITHUB_REDIRECT_URI,
  githubScopes: GITHUB_SCOPES,
  pexelsApiKey: PEXELS_API_KEY,
  protectSecret: (value) => getSecretStore().protectSecret(value),
  sessionSecret: FABER_SESSION_SECRET,
  store: postgresUserStore,
  unprotectSecret: (value) => getSecretStore().unprotectSecret(value),
});

const pexelsAssetService = createPexelsAssetService({
  fetchFn: fetch,
  getApiKey: () => {
    if (platformAccountService.getCurrentSession()) {
      const platformKey = platformAccountService.getPlatformPexelsApiKey();
      if (platformKey) return platformKey;
    }
    return getEffectivePexelsApiKey();
  },
});

const platformMediaService = createPlatformMediaService({
  accountService: platformAccountService,
  getLocalPexelsApiKey: () => getEffectivePexelsApiKey(),
  localAssetService: pexelsAssetService,
});

const platformBackendService = createPlatformBackendService({
  accountService: platformAccountService,
  appendAuditEvent: (...args) => appendAuditEvent(...args),
  host: FABER_BACKEND_HOST,
  mediaService: platformMediaService,
  onAuthCompleted: () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('account:event', { type: 'signed-in' });
    }
  },
  port: Number.isFinite(FABER_BACKEND_PORT) ? FABER_BACKEND_PORT : 37418,
});

const {
  resolveBlueprintMediaAssets,
} = platformMediaService;

const customProviderProfileService = createCustomProviderProfileService({
  getSelectedAiProvider,
  listCustomApiProfiles,
});

const {
  getSelectedCustomApiProfile,
  maskApiKeyTail,
  resolveCustomApiEndpoint,
  resolveCustomProviderKind,
} = customProviderProfileService;

const remoteProviderClients = createRemoteProviderClients({
  AI_REQUEST_TIMEOUT_MS,
  GEMINI_API_BASE_URL,
  GEMINI_MIN_REQUEST_INTERVAL_MS,
  OPENAI_API_BASE_URL,
  OPENAI_MIN_REQUEST_INTERVAL_MS,
  RWKV_TEMPERATURE,
  RWKV_TOP_P,
  SAMBANOVA_API_BASE_URL,
  SAMBANOVA_MIN_REQUEST_INTERVAL_MS,
  applyProviderCooldownFromReason,
  clearProviderCooldown,
  delayMs,
  enforceProviderCooldown,
  enforceProviderRequestsPerMinute,
  fetchFn: fetch,
  getEffectiveGeminiApiKey,
  getEffectiveGeminiModel,
  getEffectiveOpenAiApiKey,
  getEffectiveOpenAiModel,
  getEffectiveSambaNovaApiKey,
  getEffectiveSambaNovaModel,
  getSelectedCustomApiProfile,
  resolveCustomApiEndpoint,
  resolveCustomProviderKind,
  sanitizeOpenAiModelName,
  sanitizeSambaNovaModelName,
});

const {
  callCustomProviderChat,
  callGeminiChat,
  callOpenAiChat,
  callSambaNovaChat,
} = remoteProviderClients;

const rwkvProviderClient = createRwkvProviderClient({
  AI_REQUEST_TIMEOUT_MS,
  MEMPALACE_PYTHON_BIN,
  RWKV_CUDA_ON: String(process.env.RWKV_CUDA_ON || '0'),
  RWKV_JIT_ON: String(process.env.RWKV_JIT_ON || '0'),
  RWKV_MAX_NEW_TOKENS,
  RWKV_MODEL_PATH,
  RWKV_PROVIDER_SCRIPT,
  RWKV_STRATEGY,
  RWKV_TEMPERATURE,
  RWKV_TOKENIZER_PATH,
  RWKV_TOP_P,
  RWKV_V7_ON,
  extractJsonFromMixedText,
  runCommand,
});

const { callRwkvProviderChat } = rwkvProviderClient;

const projectStore = createProjectStore({
  fs,
  getUserDataPath: () => app.getPath('userData'),
  path,
});

const {
  normalizeProjectRecord,
  readProjects,
  readProjectsByState,
  readProjectsSnapshot,
  writeProjects,
  writeProjectsSnapshot,
} = projectStore;

const orchestrationStateStore = createOrchestrationStateStore({
  CORTEX_BRIEFING_MAX_RETRIES,
  CORTEX_VALIDATION_MAX_RETRIES,
  CORTEX_VALIDATION_STALL_LIMIT,
  JOB_PROGRESS_MIN_DELTA,
  JOB_RETRY_NO_PROGRESS_MS,
  JOB_RETRY_SAME_FINGERPRINT_LIMIT,
  JOB_RETRY_SAME_REASON_LIMIT,
  JOB_RETRY_STAGNATION_LIMIT,
  JOB_SOFT_TIMEOUT_MS,
  MAX_AUDIT_EVENTS,
  MAX_CONVERSATION_MESSAGES,
  MAX_CORTEX_LEARNING_EVENTS,
  MAX_JOB_EVENTS,
  MAX_JOBS_STORED,
  computeRetryBackoffMs,
  fs,
  getUserDataPath: () => app.getPath("userData"),
  isNonRetriableProviderReason,
  path,
});

const {
  addConversationEntry,
  addConversationMessage,
  appendAuditEvent,
  appendJobEvent,
  createAssistantJob,
  getCortexLearning,
  getJobById,
  isJobCancelled,
  listConversationMessages,
  listJobs,
  markJobCancelled,
  markJobCompleted,
  markJobFailed,
  markJobPausedForMemory,
  markJobPhase,
  markJobRetryPending,
  readOrchestrationState,
  recoverInterruptedJobs,
  removeProjectConversationHistory,
  renameConversationEntry,
  renameCortexTopic,
  setJobCheckpoint,
  upsertCortexLearning,
  upsertCortexTopic,
  writeOrchestrationState,
} = orchestrationStateStore;

const interruptedJobsRecovery = recoverInterruptedJobs('runtime_restarted_before_job_completed');
if (interruptedJobsRecovery && interruptedJobsRecovery.recovered > 0) {
  console.warn('[jobs] recovered interrupted jobs after runtime start', interruptedJobsRecovery);
}

projectContextService = createProjectContextService({
  CORTEX_STOPWORDS,
  MAX_CORTEX_CONTEXT_ITEMS,
  clipText,
  clipTextPreserveLines,
  fs,
  getCortexLearning,
  path,
});

const cortexMemoryManagementService = createCortexMemoryManagementService({
  appendAuditEvent,
  readOrchestrationState,
  writeOrchestrationState,
});

const {
  listCortexMemories,
  manageCortexMemory,
} = cortexMemoryManagementService;

const {
  buildCortexPromptContext,
  buildProjectEvolutionContext,
  buildProjectGraphReport,
  buildProjectGraphContext,
  extractIntentTerms,
} = projectContextService;

const cortexMemorySyncService = createCortexMemorySyncService({
  appendAuditEvent,
  clipText,
  indexCortexMemoryInRag,
  persistCortexMemoryToMempalace,
});

const {
  syncCortexMemory,
} = cortexMemorySyncService;

const automataContractLedgerService = createAutomataContractLedgerService({
  fs,
  path,
  getUserDataPath: () => app.getPath('userData'),
});

const memoryEvidenceLedgerService = createMemoryEvidenceLedgerService({
  fs,
  path,
});

const {
  appendMemoryEvidence,
  listMemoryEvidence,
} = memoryEvidenceLedgerService;

const knowledgeRuntimeService = createKnowledgeRuntimeService({
  appendAuditEvent,
  appendMemoryEvidence,
  buildRagPlannerContext,
  forgetMempalaceMemory,
  forgetRagMemory,
  reindexMempalaceProject: ensureMempalaceProjectIndexed,
  reindexRagProject,
  getCortexLearning,
  getMempalaceRuntimeStatus,
  getRagRuntimeStatus,
  getEmbeddingRuntimeStatus: () => memoryEmbeddingProviderService.getStatus(),
  listCortexMemories,
  manageCortexMemory,
  searchMempalaceContext,
  syncCortexMemory,
});

const {
  getKnowledgeRuntimeStatus,
  runMemoryLifecycleOperation,
  searchKnowledge,
  syncKnowledgeFromCortex,
} = knowledgeRuntimeService;

const cortexLearningPayloadService = createCortexLearningPayloadService({
  appendAuditEvent,
  clipText,
  extractAttachmentText,
  path,
  syncKnowledgeFromCortex,
  upsertCortexLearning,
});

const {
  processCortexLearningPayload,
} = cortexLearningPayloadService;

const activeMemoryService = createActiveMemoryService({
  appendAuditEvent,
  buildCortexPromptContext,
  buildMempalaceCortexCore,
  buildMempalacePlannerContext,
  buildProjectEvolutionContext,
  buildRagPlannerContext,
  clipText,
  extractIntentTerms,
  formatMempalaceCoreForPrompt,
  getCortexLearning,
  getRuntimeProfileSettings,
  appendMemoryEvidence,
  embeddingProvider: memoryEmbeddingProviderService,
});

const {
  buildActiveMemoryContext,
  summarizeActiveMemory,
} = activeMemoryService;

async function resolveActiveMemoryContext({
  projectInfo = null,
  userMessage = '',
  attachments = [],
  contextHint = null,
  conversationMessages = [],
  userId = '',
  conversationId = '',
  jobId = '',
  stage = 'runtime',
} = {}) {
  return buildActiveMemoryContext({
    projectInfo,
    projectId: projectInfo && projectInfo.id ? projectInfo.id : null,
    userMessage,
    attachments,
    contextHint,
    conversationMessages,
    userId,
    conversationId,
    jobId,
    runtimeSettings: getRuntimeProfileSettings(),
    stage,
  });
}

function normalizeRequestedRelativePath(rawPath) {
  if (!rawPath) return null;
  const sanitized = String(rawPath).trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!sanitized) return null;
  if (path.isAbsolute(sanitized)) return null;
  const normalized = path.normalize(sanitized).replace(/^(\.\/)+/, '');
  if (!normalized || normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) return null;
  return normalized;
}

function resolveExecutionIntent(userMessage, contextHint = {}, projectInfo = null) {
  return resolveExecutionIntentFromContext({
    userMessage,
    contextHint,
    projectInfo,
    hasScaffoldIntent,
    hasEditIntent,
    hasProjectEvolutionIntent,
  });
}

function hasSearchIntent(userMessage) {
  const normalized = String(userMessage || '').toLowerCase();
  return (
    /\b(encontre|encontrar|achar|ache|localize|localizar|procure|procurar)\b/.test(normalized) &&
    /\b(arquivo|texto|frase|mensagem|string)\b/.test(normalized)
  );
}

function extractSearchTargetText(userMessage) {
  const text = String(userMessage || '').trim();
  if (!text) return '';
  const quoted = text.match(/["“']([^"”']{3,})["”']/);
  if (quoted && quoted[1]) return quoted[1].trim();

  const afterTextWord = text.match(/(?:texto|frase|mensagem|string)\s*[:\-]?\s*(.+)$/i);
  if (afterTextWord && afterTextWord[1]) return afterTextWord[1].trim();
  return text;
}

function isAffirmativeShortReply(userMessage) {
  const normalized = String(userMessage || '').toLowerCase().trim();
  return /^(sim|s|ok|certo|isso|pode|pode gerar|gera|gerar|por favor|pode sim|claro|manda ver|fa[çc]a|fa[çc]a por favor|pode fazer|pode criar)[.!?]*$/.test(
    normalized
  );
}

function isDocumentFollowUp(userMessage) {
  const normalized = String(userMessage || '').toLowerCase().trim();
  return /\b(pdf|documento|relat[oó]rio|explica[cç][aã]o|gerar|gere|fa[çc]a|crie|criar)\b/.test(normalized);
}

function wantsTechnicalPdf(userMessage, contextHint = {}) {
  const normalized = String(userMessage || '').toLowerCase();
  const explicitRequest =
    /\b(pdf|explica[cç][aã]o t[eé]cnica|explicar tecnicamente|detalhamento t[eé]cnico|relat[oó]rio t[eé]cnico|documento t[eé]cnico)\b/i.test(
      normalized
    );
  if (explicitRequest) return true;
  if (!contextHint.awaitingTechnicalPdfConfirmation) return false;
  return isAffirmativeShortReply(normalized) || isDocumentFollowUp(normalized);
}

function buildVisibleReportsDir(projectInfo) {
  const candidates = [
    projectInfo && projectInfo.rootPath ? path.join(projectInfo.rootPath, 'Faber Reports') : null,
    path.join(app.getPath('home'), 'Desktop', 'Faber Reports'),
    path.join(app.getPath('documents'), 'Faber Reports'),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {
      // Tenta próximo diretório candidato.
    }
  }

  const fallback = path.join(app.getPath('userData'), 'reports');
  if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function hasScaffoldIntent(userMessage, projectInfo = null, contextText = '') {
  return Boolean(buildProductIntake({ userMessage, projectInfo, contextText }).signals.scaffoldIntent);
}

function hasDiagnosticIntent(userMessage, projectInfo = null, contextText = '') {
  return Boolean(buildProductIntake({ userMessage, projectInfo, contextText }).signals.diagnosticIntent);
}

function inferApplicationPurpose(projectInfo) {
  const corpus = `${(projectInfo.files || []).join(' ')} ${projectInfo.stacks.join(' ')}`.toLowerCase();
  const has = (pattern) => pattern.test(corpus);

  if (has(/\b(budget|orcamento|orçamento|proposta|proposal|pricing|price)\b/)) {
    return 'Parece ser um sistema de orçamento/comercial, usado para montar propostas, valores e documentos de atendimento.';
  }

  if (has(/\b(checkout|cart|carrinho|pedido|order|produto|catalog)\b/)) {
    return 'Parece ser uma aplicação de vendas/pedidos, com fluxo de catálogo e fechamento de compra.';
  }

  if (has(/\b(login|auth|usuario|usuário|perfil|account)\b/)) {
    return 'Parece ser um sistema com área de usuário, focado em login, gestão de conta e operações internas.';
  }

  if (projectInfo.stacks.includes('PHP/LAMP')) {
    return 'Parece ser um sistema web em PHP para uso interno ou operacional, com páginas e templates de negócio.';
  }

  return 'Parece ser uma aplicação web de negócio. Para confirmar com mais precisão, preciso de uma análise técnica mais profunda.';
}

function buildInformationalPlan(projectInfo, userMessage = '') {
  const normalized = String(userMessage || '').trim().toLowerCase();
  const isGreeting = /^(oi|ol[aá]|bom dia|boa tarde|boa noite|e ai|e aí|hello|hi)\b/.test(normalized);
  if (isGreeting || normalized.length <= 3) {
    return {
      ok: true,
      response: [
        'Não iniciei execução porque essa mensagem não contém um pedido claro de criação ou edição.',
        '',
        'Para conversar com a Persona, o Faber Code precisa validar o provedor de IA selecionado.',
        'Para executar trabalho no projeto, descreva a criação ou alteração desejada.',
      ].join('\n'),
      action: null,
      meta: {
        intent: 'informational',
      },
    };
  }

  const purpose = inferApplicationPurpose(projectInfo);
  const response = [
    `${purpose}`,
    '',
    'Posso ajudar de duas formas:',
    '1. Criar uma nova aplicação a partir de um briefing alinhado.',
    '2. Corrigir ou evoluir este projeto analisando os arquivos atuais e aplicando patch incremental.',
    '',
    'Me diga qual caminho você quer seguir e eu preparo o próximo passo sem alterar arquivos antes da sua confirmação.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    ok: true,
    response,
    action: null,
    meta: {
      intent: 'informational',
    },
  };
}

function buildConversationOnlyPlan(userMessage = '') {
  return {
    ok: true,
    response: [
      'Não iniciei execução porque essa mensagem parece conversa ou confirmação, não uma solicitação de criação/edição.',
      '',
      'Quando houver um pedido claro, eu abro o fluxo de trabalho, analiso o projeto e peço confirmação antes de alterar arquivos.',
    ].join('\n'),
    action: null,
    meta: {
      planner: 'conversation_router',
      reason: 'conversation_only',
      intent: 'conversation',
      noJob: true,
    },
  };
}

function formatProviderDisplayName(provider) {
  const key = String(provider || '').toLowerCase();
  if (key === 'openai') return 'OpenAI API';
  if (key === 'gemini') return 'Gemini API';
  if (key === 'sambanova') return 'SambaNova API';
  if (key === 'rwkv') return 'RWKV Local';
  if (key.startsWith('custom:')) return 'API custom';
  return provider || 'IA selecionada';
}

function buildAiProviderUnavailableMessage(status = {}) {
  const provider = formatProviderDisplayName(status.provider || getSelectedAiProvider());
  const reason = String(status.reason || '');

  if (reason === 'gemini_api_key_missing') {
    return 'A Persona não respondeu porque o Gemini está selecionado, mas nenhuma chave Gemini válida está configurada.';
  }
  if (reason === 'openai_api_key_missing') {
    return 'A Persona não respondeu porque a OpenAI está selecionada, mas nenhuma chave OpenAI válida está configurada.';
  }
  if (reason === 'openai_model_missing') {
    return 'A Persona não respondeu porque a OpenAI está selecionada, mas nenhum modelo OpenAI válido está configurado.';
  }
  if (reason === 'sambanova_api_key_missing') {
    return 'A Persona não respondeu porque a SambaNova está selecionada, mas nenhuma chave SambaNova válida está configurada.';
  }
  if (reason === 'rwkv_model_missing') {
    return 'A Persona não respondeu porque o RWKV Local está selecionado, mas o arquivo do modelo não foi encontrado.';
  }
  if (reason === 'rwkv_tokenizer_missing') {
    return 'A Persona não respondeu porque o RWKV Local está selecionado, mas o tokenizer não foi encontrado.';
  }
  if (reason === 'custom_api_key_missing') {
    return 'A Persona não respondeu porque a API custom selecionada está sem chave configurada.';
  }
  if (reason === 'custom_api_model_missing') {
    return 'A Persona não respondeu porque a API custom selecionada está sem modelo configurado.';
  }
  if (reason === 'custom_api_endpoint_missing') {
    return 'A Persona não respondeu porque a API custom selecionada está sem endpoint válido.';
  }

  return `A Persona não respondeu porque o provedor selecionado (${provider}) não está pronto nesta tentativa.`;
}

function buildAiProviderFailureMessage(provider, errorMessage = '') {
  const failure = normalizeProviderFailure(errorMessage, provider);
  const displayName = formatProviderDisplayName(provider);
  const details = clipText(String(failure.technicalMessage || '').replace(/\s+/g, ' ').trim(), 360);
  const lower = details.toLowerCase();

  if (failure.category === 'configuration') {
    return `${displayName} não está pronto para esta chamada. Revise chave, modelo ou endpoint nas configurações de IA.`;
  }
  if (failure.category === 'auth') {
    return `${displayName} recusou a conexão. A chave pode estar revogada, inválida ou sem permissão para o modelo selecionado.`;
  }
  if (failure.category === 'rate_limit') {
    return `${displayName} recusou a conexão por limite/rate limit. Aguarde a janela liberar, reduza a cadência ou troque de provedor.`;
  }
  if (failure.category === 'empty_response' || failure.category === 'invalid_output') {
    return `${displayName} respondeu sem um plano utilizável. Não iniciei execução nem alterei arquivos.`;
  }
  if (/401|403|unauthorized|forbidden|invalid api key|api key/i.test(details)) {
    return `${displayName} recusou a conexão. A chave pode estar revogada, inválida ou sem permissão para o modelo selecionado.`;
  }
  if (/429|rate.?limit|quota|too many requests|insufficient_quota/i.test(details)) {
    return `${displayName} recusou a conexão por limite/rate limit. Aguarde a janela liberar, reduza a cadência ou troque de provedor.`;
  }
  if (/model|not available|deprecated|410/i.test(lower)) {
    return `${displayName} recusou o modelo configurado. Escolha um modelo disponível no painel de APIs e tente novamente.`;
  }
  if (/timeout|timedout|aborted|abort|sigkill/i.test(lower)) {
    return `${displayName} foi interrompido antes de concluir a resposta. Isso costuma acontecer por timeout ou pressão de memória. Não iniciei execução falsa; reduza o pedido, aumente o timeout ou tente outro provedor.`;
  }

  return details
    ? `${displayName} falhou ao responder. Detalhe técnico: ${details}`
    : `${displayName} falhou ao responder nesta tentativa.`;
}

function buildFriendlyExecutionStartResponse(userMessage = '') {
  const normalized = String(userMessage || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/\btitulo\b/.test(normalized) && /\b(mude|altere|troque|substitua|atualize|renomeie|editar|edite)\b/.test(normalized)) {
    return 'Entendi. Vou localizar o título nos arquivos atuais e preparar uma alteração pequena para sua confirmação.';
  }

  if (hasEditIntent(normalized) || hasProjectEvolutionIntent(normalized)) {
    return 'Entendi. Vou analisar os arquivos atuais e preparar uma edição incremental, mexendo só no que for necessário.';
  }

  if (hasScaffoldIntent(normalized)) {
    return 'Entendi. Vou estruturar uma primeira versão coerente e mostrar a proposta antes de aplicar qualquer arquivo.';
  }

  return 'Entendi. Vou analisar o projeto e preparar a próxima ação com segurança antes de alterar arquivos.';
}

function looksLikeInvalidPersonaText(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return true;
  const compact = normalized.replace(/\s+/g, '');
  const alnum = (normalized.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length;
  const symbols = (normalized.match(/[^A-Za-zÀ-ÿ0-9\s.,;:!?\"'()\[\]{}_\-\/\\]/g) || []).length;
  const repeatedTinyPattern = compact.length >= 16 && /(.{1,4})\1{7,}/.test(compact);
  const mostlySymbols = normalized.length >= 16 && symbols > Math.max(8, alnum);
  return repeatedTinyPattern || mostlySymbols;
}

function looksLikeRouteDecisionJson(text) {
  const normalized = String(text || '').trim();
  return /^\s*[{`]/.test(normalized) && /"decision"\s*:/i.test(normalized);
}

function readLooseJsonStringValue(text, key) {
  const source = String(text || '');
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*"`, 'i');
  const match = keyPattern.exec(source);
  if (!match) return '';

  let value = '';
  let escaped = false;
  for (let index = match.index + match[0].length; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      value += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') break;
    value += char;
  }

  if (!value) return '';
  try {
    return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  } catch {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();
  }
}

function tryRecoverPersonaRouteDecisionFromText(rawText, userMessage = '') {
  const text = String(rawText || '').trim();
  if (!looksLikeRouteDecisionJson(text)) return null;

  const decision =
    readLooseJsonStringValue(text, 'decision') ||
    ((text.match(/"decision"\s*:\s*("?)(chat|clarify|execute)\1/i) || [])[2] || '');
  const normalizedDecision = String(decision || '').trim().toLowerCase();
  if (!['chat', 'clarify', 'execute'].includes(normalizedDecision)) return null;

  return normalizePersonaRouteDecision({
    decision: normalizedDecision,
    response: readLooseJsonStringValue(text, 'response'),
    executionMessage:
      readLooseJsonStringValue(text, 'executionMessage') ||
      readLooseJsonStringValue(text, 'execution_request') ||
      userMessage,
    confidence: Number((text.match(/"confidence"\s*:\s*([0-9.]+)/i) || [])[1]),
  }, userMessage);
}

function formatConversationMessagesForPrompt(messages = []) {
  if (!Array.isArray(messages) || !messages.length) return 'Histórico recente: indisponível.';
  const lines = messages
    .slice(-10)
    .map((message) => {
      const role = message && message.role === 'user' ? 'Usuário' : 'Persona';
      const text = compactPromptPart(message && message.text ? message.text : '', 700);
      return text ? `${role}: ${text}` : null;
    })
    .filter(Boolean);
  return lines.length
    ? wrapUntrustedPromptSection('Historico recente', lines.join('\n'), {
        sourceType: 'conversation_history',
        maxChars: 7000,
      })
    : 'Histórico recente: indisponível.';
}

function formatUntrustedPromptSection(label, value, sourceType, maxChars = 1800) {
  const text = compactPromptPart(value, maxChars);
  return wrapUntrustedPromptSection(label, text, { sourceType, maxChars });
}

function formatUntrustedJsonPromptSection(label, value, sourceType, maxChars = 1800) {
  const text = compactJsonForPrompt(value, maxChars);
  return wrapUntrustedPromptSection(label, text, { sourceType, maxChars });
}

function normalizePersonaRouteDecision(rawRoute, userMessage = '') {
  if (!rawRoute || typeof rawRoute !== 'object') return null;
  const decision = String(rawRoute.decision || rawRoute.mode || rawRoute.action || '').trim().toLowerCase();
  const allowed = new Set(['chat', 'clarify', 'execute']);
  if (!allowed.has(decision)) return null;

  const response = sanitizeAssistantText(
    rawRoute.response || rawRoute.message || '',
    decision === 'execute'
      ? 'Entendi. Vou analisar o projeto e preparar a proposta de execução antes de alterar qualquer arquivo.'
      : 'Entendi. Vou continuar a conversa sem iniciar execução.'
  );
  const schema = validateRouteDecision({
    decision,
    response,
    executionMessage: rawRoute.executionMessage || rawRoute.execution_request || userMessage,
    confidence: Number.isFinite(Number(rawRoute.confidence)) ? Number(rawRoute.confidence) : undefined,
  });
  if (!schema.ok) return null;

  return {
    ok: true,
    decision: schema.value.decision,
    response: schema.value.response,
    executionMessage: sanitizeAssistantText(schema.value.executionMessage || userMessage, userMessage),
    confidence: schema.value.confidence,
    raw: rawRoute,
  };
}

function formatProductContractForPrompt(productContract = {}) {
  const capabilities = productContract && productContract.capabilities ? productContract.capabilities : {};
  const lines = Object.entries(capabilities).map(([key, value]) => {
    const modes = Array.isArray(value.modes) && value.modes.length ? ` modos=${value.modes.join(',')}` : '';
    const intent = value.executionIntent ? ` intent=${value.executionIntent}` : '';
    return `- ${key}:${intent}${modes} :: ${value.description || ''}`;
  });
  const rules = Array.isArray(productContract.rules) ? productContract.rules.map((rule) => `- ${rule}`) : [];
  return [
    `Versao: ${productContract.schemaVersion || 'product-route-v1'}`,
    'Capacidades:',
    lines.join('\n') || '- indisponivel',
    'Regras:',
    rules.join('\n') || '- indisponivel',
  ].join('\n');
}

function formatProductFactsForPrompt(productFacts = {}) {
  const signals = productFacts && productFacts.signals ? productFacts.signals : {};
  return JSON.stringify(
    {
      projectState: productFacts.projectState || 'unknown',
      executionIntent: productFacts.executionIntent || '',
      hasProject: Boolean(productFacts.hasProject),
      signals,
    },
    null,
    2
  );
}

async function requestAiProductRouteDecision({
  projectInfo,
  userMessage = '',
  sourceMessage = '',
  attachments = [],
  contextHint = null,
  conversationMessages = [],
  activeMemory = null,
  productContract = {},
  productFacts = {},
} = {}) {
  const provider = getSelectedAiProvider();
  const status = await getAiRuntimeStatus().catch((error) => ({
    ok: false,
    provider,
    reason: 'runtime_status_error',
    message: error && error.message ? error.message : String(error || ''),
  }));

  if (!status || !status.ok || !status.ready) {
    const failure = normalizeProviderFailure(
      status && (status.message || status.reason) ? status.message || status.reason : 'provider_not_ready',
      provider,
      {
        code: status && status.reason ? status.reason : 'provider_not_ready',
        category: 'configuration',
        retryable: false,
        provider: status && status.provider ? status.provider : provider,
        source: 'runtime_status',
      }
    );
    return {
      ok: false,
      providerUnavailable: true,
      provider,
      reason: failure.code,
      errorMessage: failure.technicalMessage,
      providerFailure: failure,
    };
  }

  const timeoutMs = provider === 'rwkv' ? Math.min(AI_REQUEST_TIMEOUT_MS, 120000) : Math.min(AI_REQUEST_TIMEOUT_MS, 45000);
  const projectSummary = projectInfo
    ? {
        rootPath: projectInfo.rootPath || null,
        stacks: projectInfo.stacks || [],
        totalFiles: projectInfo.totalFiles || 0,
        sampleFiles: (projectInfo.files || []).slice(0, 18),
      }
    : null;
  const history = formatConversationMessagesForPrompt(conversationMessages);
  const attachmentSummary = Array.isArray(attachments) && attachments.length
    ? attachments.map((item) => `${item.name || 'anexo'} (${item.type || 'tipo desconhecido'})`).join(', ')
    : 'nenhum';
  const activeMemoryContext =
    activeMemory && activeMemory.decision && (activeMemory.decision.routeContextText || activeMemory.decision.briefingContextText)
      ? clipText(activeMemory.decision.routeContextText || activeMemory.decision.briefingContextText, 1800)
      : '';

  const systemPrompt = [
    'Voce e o Product Router do Faber Code.',
    'Sua unica funcao e interpretar o pedido do usuario contra o contrato de capacidades do produto.',
    'Voce nao executa, nao promete que arquivos foram alterados e nao inventa ferramentas fora do contrato.',
    'Responda somente JSON valido.',
    'A decisao final ainda sera validada por um policy gate deterministico.',
    'Use execute apenas quando houver uma capacidade clara do Faber Code para atender o pedido.',
    'Use clarify quando faltar informacao de produto ou quando o pedido conflitar com o estado do projeto.',
    'Use chat para conversa, pergunta conceitual ou pedido que nao exige acao em arquivos/ferramentas.',
  ].join(' ');

  const userPrompt = [
    'Contrato de produto:',
    formatProductContractForPrompt(productContract),
    '',
    `Mensagem atual: ${String(userMessage || '').trim() || '[mensagem vazia]'}`,
    `Mensagem consolidada: ${String(sourceMessage || userMessage || '').trim() || '[mensagem vazia]'}`,
    projectSummary ? `Projeto aberto: ${JSON.stringify(projectSummary)}` : 'Projeto aberto: nenhum.',
    `Fatos determinísticos: ${formatProductFactsForPrompt(productFacts)}`,
    activeMemoryContext
      ? formatUntrustedPromptSection(
          'Memoria ativa operacional (separada por mensagem atual, usuario e projeto)',
          activeMemoryContext,
          'active_memory',
          1800
        )
      : 'Memória ativa operacional: indisponível.',
    history,
    contextHint
      ? formatUntrustedJsonPromptSection('Contexto do runtime', contextHint, 'runtime_context', 1600)
      : 'Contexto do runtime: nenhum.',
    `Anexos: ${attachmentSummary}`,
    '',
    'Formato obrigatorio:',
    '{',
    '  "decision": "chat|clarify|execute",',
    '  "capability": "conversation|create_project|edit_project|search_project|diagnose_project|project_tools",',
    '  "mode": "faber_blueprint|cortex_scaffold|deterministic_patch|cortex_incremental_edit|local_search|local_diagnostics|terminal|preview|git|runner|ai_router",',
    '  "executionIntent": "init_project|edit_project|search_project|diagnose_project|tool_action",',
    '  "response": "resposta curta para o usuario",',
    '  "executionMessage": "pedido tecnico consolidado quando decision=execute",',
    '  "missingSlots": ["campo faltante opcional"],',
    '  "confidence": 0.0',
    '}',
  ].join('\n');

  try {
    const raw = await callPersonaProviderChat(
      PERSONA_MODEL_BRAIN,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      timeoutMs,
      { options: { num_predict: 650 } }
    );
    const parsed = tryParseJsonObject(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        ...parsed,
        provider,
        rawText: raw,
      };
    }
    return {
      ok: false,
      provider,
      invalidOutput: true,
      rawText: sanitizeAssistantText(raw, ''),
    };
  } catch (error) {
    const failure = normalizeProviderFailure(error, provider);
    return {
      ok: false,
      provider,
      providerUnavailable: true,
      reason: failure.code,
      errorMessage: failure.technicalMessage,
      providerFailure: failure,
    };
  }
}

async function requestPersonaRouteDecision({
  projectInfo,
  userMessage = '',
  attachments = [],
  contextHint = null,
  conversationMessages = [],
  activeMemory = null,
}) {
  const provider = getSelectedAiProvider();
  const activeMemorySummary = activeMemory ? summarizeActiveMemory(activeMemory) : null;
  const defaultsAuthorized = shouldUseDefaultScaffoldConfiguration(userMessage);
  const hasProjectFilesForDeterministicEdit = Boolean(projectInfo && Number(projectInfo.totalFiles || 0) > 0);
  const deterministicEditIntent =
    hasProjectFilesForDeterministicEdit &&
    (Boolean(extractRequestedTitle(userMessage)) ||
      isButtonColorEditRequest(userMessage) ||
      isBackgroundColorEditRequest(userMessage) ||
      isHeadingColorEditRequest(userMessage) ||
      isFooterInsertRequest(userMessage) ||
      isHydrationMismatchRepairRequest(userMessage) ||
      isLiteralColorReplacementRequest(userMessage) ||
      isThemeColorEditRequest(userMessage) ||
      isTypographyEditRequest(userMessage));
  if (deterministicEditIntent) {
    return {
      ok: true,
      decision: 'execute',
      response: buildFriendlyExecutionStartResponse(userMessage),
      executionMessage: userMessage,
      confidence: 0.99,
      provider,
      meta: {
        planner: 'deterministic_router',
        reason: 'deterministic_edit_intent',
        provider,
        activeMemory: activeMemorySummary,
      },
    };
  }

  if (defaultsAuthorized && (Boolean(contextHint && contextHint.awaitingScaffoldClarification) || hasScaffoldIntent(userMessage, projectInfo))) {
    return {
      ok: true,
      decision: 'execute',
      response:
        'Combinado. Vou usar placeholders coerentes e preparar uma primeira versão sem travar em novas perguntas.',
      executionMessage: contextHint && contextHint.awaitingScaffoldClarification
        ? buildDefaultScaffoldPrompt(userMessage, contextHint)
        : userMessage,
      confidence: 0.98,
      provider,
      meta: {
        planner: 'persona_router',
        reason: 'defaults_authorized_execute',
        provider,
        activeMemory: activeMemorySummary,
      },
    };
  }

  const status = await getAiRuntimeStatus().catch((error) => ({
    ok: false,
    provider,
    reason: 'runtime_status_error',
    message: error && error.message ? error.message : String(error || ''),
  }));

  if (!status || !status.ok || !status.ready) {
    const failure = normalizeProviderFailure(
      status && (status.message || status.reason) ? status.message || status.reason : 'provider_not_ready',
      provider,
      {
        code: status && status.reason ? status.reason : 'provider_not_ready',
        category: 'configuration',
        retryable: false,
        provider: status && status.provider ? status.provider : getSelectedAiProvider(),
        source: 'runtime_status',
      }
    );
    return {
      ok: false,
      decision: 'chat',
      providerUnavailable: true,
      response: buildAiProviderUnavailableMessage(status || {}),
      providerFailure: failure,
      meta: {
        planner: 'persona_router',
        reason: failure.code,
        providerFailure: failure,
        provider: status && status.provider ? status.provider : getSelectedAiProvider(),
        activeMemory: activeMemorySummary,
      },
    };
  }

  const timeoutMs = provider === 'rwkv' ? Math.min(AI_REQUEST_TIMEOUT_MS, 120000) : Math.min(AI_REQUEST_TIMEOUT_MS, 45000);
  const projectSummary = projectInfo
    ? {
        rootPath: projectInfo.rootPath || null,
        stacks: projectInfo.stacks || [],
        totalFiles: projectInfo.totalFiles || 0,
        sampleFiles: (projectInfo.files || []).slice(0, 18),
      }
    : null;
  const localDiagnostics = buildLocalProjectDiagnostics({ projectInfo, userMessage, attachments });
  const localDiagnosticsContext = formatLocalProjectDiagnosticsForPrompt(localDiagnostics);
  const attachmentContext = Array.isArray(attachments) && attachments.length
    ? await buildAttachmentsPromptContext(attachments, {
        maxAttachments: 3,
        maxCharsPerAttachment: 900,
        totalMaxChars: 2200,
      }).catch(() => '')
    : '';
  const activeMemoryContext =
    activeMemory && activeMemory.decision && (activeMemory.decision.routeContextText || activeMemory.decision.briefingContextText)
      ? clipText(activeMemory.decision.routeContextText || activeMemory.decision.briefingContextText, 1800)
      : '';

  const systemPrompt = [
    'Você é a Persona do Faber Code e decide o próximo passo conversando com o usuário.',
    'Responda somente JSON válido.',
    'Você decide entre três modos:',
    'chat = conversa, saudação, teste, confirmação ou pergunta sem pedido de desenvolvimento.',
    'clarify = usuário quer criar/editar, mas faltam dados importantes antes de começar.',
    'execute = usuário pediu claramente criação, edição, diagnóstico técnico ou correção de arquivos do projeto.',
    'Nunca escolha execute para mensagens como "oi", "ok", "certo vou testar", "consegue executar isso?" ou conversas sem objetivo técnico claro.',
    'Se a mensagem atual for uma retentativa curta como "tente novamente", "retente" ou "continue", use o último job e o histórico recente para manter o mesmo objetivo técnico.',
    'Se o último job falhou e o usuário pedir retentativa, escolha execute somente quando houver pedido técnico anterior claro no contexto.',
    'Não diga que analisou arquivos, executou código ou aplicou mudanças no modo chat/clarify.',
    'Se houver diagnóstico local com achados acionáveis para correção/edição de arquivos, escolha execute; não peça ao usuário para redescrever arquivos que já estão no projeto.',
    'Se o usuário autorizou defaults ou disse para seguir depois de alinhamento suficiente, escolha execute em vez de fazer nova rodada de perguntas.',
    'Use clarify apenas quando faltar decisão de produto/design que bloqueia execução segura; não use clarify para bugs técnicos que podem ser diagnosticados nos arquivos locais.',
    'Se escolher execute, explique brevemente o que vai analisar e defina executionMessage com o pedido técnico consolidado.',
    'Mantenha response e executionMessage curtos para evitar JSON truncado.',
    'Use português natural, acolhedor e direto; evite respostas robóticas como "vou alterar" quando nenhuma alteração foi aplicada ainda.',
  ].join(' ');

  const userPrompt = [
    `Mensagem do usuário: ${String(userMessage || '').trim() || '[mensagem vazia]'}`,
    projectSummary ? `Projeto aberto: ${JSON.stringify(projectSummary)}` : 'Projeto aberto: nenhum.',
    formatConversationMessagesForPrompt(conversationMessages),
    contextHint && contextHint.lastJobContext
      ? formatUntrustedJsonPromptSection('Ultimo job conhecido', contextHint.lastJobContext, 'last_job_context', 1800)
      : 'Último job conhecido: nenhum.',
    contextHint
      ? formatUntrustedJsonPromptSection('Sinais de contexto', contextHint, 'runtime_context', 1800)
      : 'Sinais de contexto: nenhum.',
    activeMemoryContext
      ? formatUntrustedPromptSection(
          'Memoria ativa operacional (mensagem atual / usuario / projeto)',
          activeMemoryContext,
          'active_memory',
          1800
        )
      : 'Memória ativa operacional: indisponível.',
    Array.isArray(attachments) && attachments.length
      ? `Anexos: ${attachments.map((item) => `${item.name || 'anexo'} (${item.type || 'tipo desconhecido'})`).join(', ')}`
      : 'Anexos: nenhum.',
    attachmentContext
      ? formatUntrustedPromptSection('Conteudo util extraido dos anexos (OCR/texto)', attachmentContext, 'attachments', 2200)
      : 'Conteúdo útil extraído dos anexos: indisponível.',
    localDiagnosticsContext
      ? formatUntrustedPromptSection('Diagnostico local dos arquivos atuais', localDiagnosticsContext, 'local_diagnostics', 1800)
      : 'Diagnóstico local dos arquivos atuais: indisponível.',
    'Formato obrigatório:',
    '{',
    '  "decision": "chat|clarify|execute",',
    '  "response": "resposta curta para o usuário",',
    '  "executionMessage": "pedido técnico consolidado quando decision=execute",',
    '  "confidence": 0.0',
    '}',
  ].join('\n');

  try {
    const raw = await callPersonaProviderChat(
      PERSONA_MODEL_BRAIN,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      timeoutMs,
      { options: { num_predict: 700 } }
    );
    const parsed = tryParseJsonObject(raw);
    let normalized = normalizePersonaRouteDecision(parsed, userMessage) ||
      tryRecoverPersonaRouteDecisionFromText(raw, userMessage);
    if (normalized && normalized.decision === 'clarify' && shouldForceExecutionFromLocalDiagnostics({
      userMessage,
      projectInfo,
      localDiagnostics,
      contextHint,
    })) {
      normalized = {
        ...normalized,
        decision: 'execute',
        response:
          'Encontrei contexto técnico suficiente nos arquivos do projeto. Vou analisar e preparar uma alteração incremental segura antes de aplicar.',
        executionMessage: localDiagnostics.suggestedExecutionMessage || normalized.executionMessage || userMessage,
      };
    }
    if (normalized) {
      return {
        ...normalized,
        provider,
        meta: {
        planner: 'persona_router',
        reason: normalized.decision === 'execute' ? 'persona_selected_execution' : `persona_${normalized.decision}`,
        provider,
        activeMemory: activeMemorySummary,
      },
    };
    }

    const fallbackResponse = looksLikeInvalidPersonaText(raw) || looksLikeRouteDecisionJson(raw)
      ? 'A IA selecionada respondeu fora de um formato legível. Não iniciei execução nem alterei arquivos; tente novamente com outro provedor ou ajuste a configuração da IA.'
      : sanitizeAssistantText(
          raw,
          'A Persona respondeu fora do protocolo de execução. Não iniciei job nem alterei arquivos.'
        );

    return {
      ok: true,
      decision: 'chat',
      response: fallbackResponse,
      provider,
      meta: {
        planner: 'persona_router',
        reason: looksLikeInvalidPersonaText(raw) ? 'persona_invalid_output' : 'persona_non_json_chat',
        provider,
      },
    };
  } catch (error) {
    const failure = normalizeProviderFailure(error, provider);
    const message = failure.technicalMessage;
    appendAuditEvent('assistant.route_provider_failed', {
      provider,
      rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      code: failure.code,
      category: failure.category,
      retryable: failure.retryable,
      message,
    });
    return {
      ok: false,
      decision: 'chat',
      providerUnavailable: true,
      response: buildAiProviderFailureMessage(provider, failure),
      providerFailure: failure,
      meta: {
        planner: 'persona_router',
        reason: buildProviderFailureReason(failure, 'provider_error', provider),
        providerFailure: failure,
        provider,
        activeMemory: activeMemorySummary,
      },
    };
  }
}

async function requestDirectPersonaChat({
  projectInfo,
  userMessage = '',
  attachments = [],
  contextHint = null,
  conversationMessages = [],
  activeMemory = null,
  routeDecision = null,
} = {}) {
  const provider = getSelectedAiProvider();
  const status = await getAiRuntimeStatus().catch((error) => ({
    ok: false,
    provider,
    reason: 'runtime_status_error',
    message: error && error.message ? error.message : String(error || ''),
  }));

  if (!status || !status.ok || !status.ready) {
    const failure = normalizeProviderFailure(
      status && (status.message || status.reason) ? status.message || status.reason : 'provider_not_ready',
      provider,
      {
        code: status && status.reason ? status.reason : 'provider_not_ready',
        category: 'configuration',
        retryable: false,
        provider: status && status.provider ? status.provider : provider,
        source: 'runtime_status',
      }
    );
    return {
      ok: false,
      providerUnavailable: true,
      provider,
      response: buildAiProviderUnavailableMessage(status || {}),
      providerFailure: failure,
      meta: {
        planner: 'direct_persona_chat',
        reason: failure.code,
        provider,
      },
    };
  }

  const timeoutMs = provider === 'rwkv' ? Math.min(AI_REQUEST_TIMEOUT_MS, 120000) : Math.min(AI_REQUEST_TIMEOUT_MS, 45000);
  const projectSummary = projectInfo
    ? {
        rootPath: projectInfo.rootPath || null,
        stacks: projectInfo.stacks || [],
        totalFiles: projectInfo.totalFiles || 0,
        sampleFiles: (projectInfo.files || []).slice(0, 14),
      }
    : null;
  const routeMode = routeDecision && routeDecision.decision ? String(routeDecision.decision).trim() : 'chat';
  const routeReason =
    routeDecision && routeDecision.meta && routeDecision.meta.reason
      ? String(routeDecision.meta.reason).trim()
      : '';
  const attachmentSummary = Array.isArray(attachments) && attachments.length
    ? attachments.map((item) => `${item.name || 'anexo'} (${item.type || 'tipo desconhecido'})`).join(', ')
    : 'nenhum';
  const activeMemoryContext =
    activeMemory && activeMemory.decision && (activeMemory.decision.routeContextText || activeMemory.decision.briefingContextText)
      ? clipText(activeMemory.decision.routeContextText || activeMemory.decision.briefingContextText, 1600)
      : '';

  const systemPrompt = [
    'Você é o Faber Code conversando diretamente com o usuário.',
    'Responda como um assistente de desenvolvimento natural, claro e humano.',
    'Não use templates de produto, slogans, CTA, "composição modular", nem listas de caminhos prontos.',
    'Não diga que alterou arquivos, executou comandos ou validou o projeto se isso ainda não aconteceu.',
    'Se faltar algo para continuar com segurança, faça no máximo uma pergunta direta.',
    'Se a mensagem for conversa comum, responda normalmente.',
    'Se o pedido for técnico mas a rota atual não liberou execução, explique em linguagem simples o que falta ou qual é o próximo passo.',
    'Mantenha a resposta curta o bastante para caber bem no chat.',
  ].join(' ');

  const userPrompt = [
    `Mensagem do usuário: ${String(userMessage || '').trim() || '[mensagem vazia]'}`,
    `Rota atual: ${routeMode}${routeReason ? ` (${routeReason})` : ''}`,
    projectSummary ? `Projeto aberto: ${JSON.stringify(projectSummary)}` : 'Projeto aberto: nenhum.',
    `Anexos: ${attachmentSummary}`,
    formatConversationMessagesForPrompt(conversationMessages),
    activeMemoryContext
      ? formatUntrustedPromptSection(
          'Memoria ativa operacional',
          activeMemoryContext,
          'active_memory',
          1600
        )
      : 'Memória ativa operacional: indisponível.',
    contextHint
      ? formatUntrustedJsonPromptSection('Contexto do runtime', contextHint, 'runtime_context', 1400)
      : 'Contexto do runtime: nenhum.',
  ].join('\n');

  try {
    const raw = await callPersonaProviderChat(
      PERSONA_MODEL_BRAIN,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      timeoutMs,
      { options: { num_predict: 900 } }
    );
    const response = sanitizeAssistantText(
      raw,
      routeDecision && routeDecision.response ? routeDecision.response : 'Estou aqui. Me diga o que você quer fazer.'
    );
    return {
      ok: true,
      response,
      provider,
      meta: {
        planner: 'direct_persona_chat',
        reason: routeReason || 'direct_chat_response',
        provider,
      },
    };
  } catch (error) {
    const failure = normalizeProviderFailure(error, provider);
    return {
      ok: false,
      providerUnavailable: true,
      provider,
      response:
        routeDecision && routeDecision.response
          ? routeDecision.response
          : buildAiProviderFailureMessage(provider, failure),
      providerFailure: failure,
      meta: {
        planner: 'direct_persona_chat',
        reason: buildProviderFailureReason(failure, 'provider_error', provider),
        provider,
      },
    };
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function requestBrainReportNarrative(projectInfo, userMessage, mempalaceContext) {
  const compactProject = {
    stacks: projectInfo.stacks,
    totalFiles: projectInfo.totalFiles,
    counters: projectInfo.counters,
    sampleFiles: (projectInfo.files || []).slice(0, 30),
  };

  const systemPrompt =
    'Você é uma arquiteta de software explicando para um usuário não técnico. ' +
    'Escreva de forma clara, objetiva e útil. Sem jargão desnecessário.';

  const userPrompt = [
    `Pedido do usuário: ${userMessage}`,
    `Contexto resumido: ${JSON.stringify(compactProject)}`,
    mempalaceContext && mempalaceContext.contextText
      ? formatUntrustedPromptSection('Memoria recuperada', mempalaceContext.contextText, 'mempalace_context', 2400)
      : 'Memória recuperada: indisponível.',
    'Gere um texto em português com estas seções exatamente nesta ordem:',
    '1) O que essa ferramenta faz na prática',
    '2) Como ela funciona por dentro (sem jargão excessivo)',
    '3) O que já está pronto hoje',
    '4) Próximos passos recomendados',
    'Limite total: 450 palavras.',
  ].join('\n');

  const content = await callPersonaProviderChat(
    PERSONA_MODEL_BRAIN,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    AI_REQUEST_TIMEOUT_MS,
    { options: { num_predict: 96 } }
  );

  return sanitizeAssistantText(content, '');
}

async function generateTechnicalPdfReport(projectInfo, userMessage, narrativeText = '') {
  const reportsDir = buildVisibleReportsDir(projectInfo);

  const timestamp = new Date();
  const stamp = `${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, '0')}${String(
    timestamp.getDate()
  ).padStart(2, '0')}-${String(timestamp.getHours()).padStart(2, '0')}${String(
    timestamp.getMinutes()
  ).padStart(2, '0')}${String(timestamp.getSeconds()).padStart(2, '0')}`;
  const outputPath = path.join(reportsDir, `faber-relatorio-tecnico-${stamp}.pdf`);

  const filesPreview = (projectInfo.files || []).slice(0, 30).map((file) => `<li>${escapeHtml(file)}</li>`).join('');
  const c = projectInfo.counters;
  const steps = buildNextSteps(projectInfo).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
  const purpose = inferApplicationPurpose(projectInfo);

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Relatório Técnico - Faber Code</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; margin: 36px; color: #0f172a; line-height: 1.45; }
      h1 { font-size: 24px; margin: 0 0 8px; }
      h2 { font-size: 18px; margin: 24px 0 8px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
      h3 { font-size: 14px; margin: 16px 0 6px; }
      p, li { font-size: 12px; }
      ul { margin: 8px 0 0 18px; padding: 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 12px; text-align: left; }
      .muted { color: #475569; }
    </style>
  </head>
  <body>
    <h1>Relatório Técnico do Projeto</h1>
    <p class="muted">Gerado por Faber Code em ${escapeHtml(timestamp.toISOString())}</p>
    <p><strong>Pedido do usuário:</strong> ${escapeHtml(userMessage)}</p>

    <h2>1. Resumo Executivo (linguagem leiga)</h2>
    <p>${escapeHtml(purpose)}</p>
    <p>Em termos práticos: este relatório foi gerado para responder ao pedido "<strong>${escapeHtml(
      userMessage
    )}</strong>" com foco em entendimento e próximos passos.</p>

    ${
      narrativeText
        ? `<h2>2. Explicação Contextual da IA</h2><p>${escapeHtml(narrativeText).replace(/\n/g, '<br>')}</p>`
        : ''
    }

    <h2>3. Visão Técnica Objetiva</h2>
    <p>Stack detectada: <strong>${escapeHtml(projectInfo.stacks.join(', '))}</strong></p>
    <p>Total de arquivos analisados: <strong>${projectInfo.totalFiles}</strong> (limite da análise: ${projectInfo.scannedLimit})</p>

    <h2>4. Distribuição por Tipo</h2>
    <table>
      <thead><tr><th>Tipo</th><th>Quantidade</th></tr></thead>
      <tbody>
        <tr><td>TS</td><td>${c.ts}</td></tr>
        <tr><td>TSX</td><td>${c.tsx}</td></tr>
        <tr><td>JS</td><td>${c.js}</td></tr>
        <tr><td>JSX</td><td>${c.jsx}</td></tr>
        <tr><td>PHP</td><td>${c.php}</td></tr>
        <tr><td>CSS/SCSS</td><td>${c.css}</td></tr>
        <tr><td>MD</td><td>${c.md}</td></tr>
        <tr><td>Outros</td><td>${c.other}</td></tr>
      </tbody>
    </table>

    <h2>5. Estrutura (Amostra)</h2>
    <h3>Arquivos de referência</h3>
    <ul>${filesPreview || '<li>Nenhum arquivo listado na amostra.</li>'}</ul>

    <h2>6. Próximos Passos Recomendados</h2>
    <ul>${steps}</ul>
  </body>
</html>`;

  const reportWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
    },
  });

  try {
    await reportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdfBuffer = await reportWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
    });
    fs.writeFileSync(outputPath, pdfBuffer);
    return { outputPath, reportsDir };
  } finally {
    reportWindow.destroy();
  }
}

function buildSearchTextAction(projectInfo, userMessage) {
  const targetText = extractSearchTargetText(userMessage);
  return {
    type: 'search_text_in_files',
    targetText,
    rootPath: projectInfo.rootPath,
    maxResults: 20,
    diffPreview: null,
  };
}

function buildConfirmationPlan(projectInfo, userMessage, attachments = []) {
  if (!projectInfo) {
    if (!hasEditIntent(userMessage)) {
      return {
        ok: true,
        response: [
          'Estou pronto para ajudar.',
          '',
          'Para criar ou editar arquivos, selecione um projeto no painel da esquerda ou crie um novo projeto primeiro.',
          'Depois disso, posso conversar, alinhar briefing, analisar arquivos e propor alterações com confirmação antes de executar.',
        ].join('\n'),
        action: null,
        meta: {
          intent: 'informational',
        },
      };
    }
    return {
      ok: false,
      response: 'Para executar alterações eu preciso de um projeto selecionado no painel da esquerda.',
      action: null,
    };
  }

  if (!hasEditIntent(userMessage)) {
    if (hasSearchIntent(userMessage)) {
      const action = buildSearchTextAction(projectInfo, userMessage);
      return {
        ok: true,
        response:
          'Entendi. Posso procurar esse texto no projeto agora e te mostrar os arquivos exatos onde ele aparece. Deseja continuar?',
        action,
        meta: {
          intent: 'search',
        },
      };
    }
    return buildInformationalPlan(projectInfo, userMessage);
  }

  if (hasScaffoldIntent(userMessage, projectInfo)) {
    return {
      ok: true,
      response:
        'Entendi, você quer criar uma aplicação. Vou transformar isso em um plano inicial seguro antes de executar qualquer arquivo. Deseja continuar?',
      action: null,
      meta: {
        intent: 'scaffold',
      },
    };
  }

  const humanSummary = [
    `Entendi a solicitação: ${userMessage}`,
    attachments.length ? `Recebi ${attachments.length} anexo(s) como contexto.` : null,
    'Vou analisar os arquivos atuais, preparar um plano incremental pela Persona e validar antes de aplicar.',
    'A alteração só será aplicada após sua confirmação explícita.',
    'Deseja continuar?',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    ok: true,
    response: humanSummary,
    action: null,
    meta: {
      intent: 'edit',
    },
  };
}

function sanitizeAssistantText(text, fallback) {
  const base = typeof text === 'string' && text.trim().length ? text : fallback;
  const normalized = String(base).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\u0000/g, '').trim();
  if (!normalized) return fallback;

  const lines = normalized.split('\n');
  const compactLines = [];
  let previousKey = '';
  let emptyRun = 0;

  for (const line of lines) {
    const cleanLine = String(line).replace(/[ \t]+/g, ' ').trimEnd();
    if (!cleanLine.trim()) {
      emptyRun += 1;
      if (emptyRun <= 1) compactLines.push('');
      continue;
    }
    emptyRun = 0;
    const key = cleanLine.trim().toLowerCase();
    if (key && key === previousKey) continue;
    previousKey = key;
    compactLines.push(cleanLine);
  }

  const compact = compactLines.join('\n').trim();
  const maxLength = 4000;
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 20).trim()}\n\n[...]`;
}

function extractFirstBalancedJsonObject(rawText = '') {
  const text = String(rawText || '');
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function sanitizeJsonCandidate(candidate = '') {
  const text = String(candidate || '').trim();
  if (!text) return text;
  // Remove trailing commas in objects/arrays: {"a":1,} / [1,2,]
  return text.replace(/,\s*([}\]])/g, '$1');
}

function tryParseJsonObject(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const fencedCandidate = fenced && fenced[1] ? fenced[1].trim() : '';
  const balancedFromText = extractFirstBalancedJsonObject(text);
  const balancedFromFence = fencedCandidate ? extractFirstBalancedJsonObject(fencedCandidate) : null;

  const candidates = [
    text,
    fencedCandidate,
    balancedFromText,
    balancedFromFence,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const direct = String(candidate || '').trim();
    if (!direct) continue;
    try {
      return JSON.parse(direct);
    } catch {
      const sanitized = sanitizeJsonCandidate(direct);
      if (!sanitized || sanitized === direct) continue;
      try {
        return JSON.parse(sanitized);
      } catch {
        continue;
      }
    }
  }

  return null;
}

function isNonRetriableProviderReason(reason) {
  const text = String(reason || '').toLowerCase();
  if (!text) return false;

  // 429 can be transient (rate burst) OR definitive (quota/billing).
  if (text.includes('http 429')) {
    const isHardQuota =
      text.includes('insufficient_quota') ||
      text.includes('billing') ||
      (text.includes('quota') && !text.includes('rate_limit_exceeded'));

    const isTransientRateLimit =
      text.includes('rate limit') ||
      text.includes('rate_limit_exceeded') ||
      text.includes('retry-after');

    if (isHardQuota) return true;
    if (isTransientRateLimit) return false;
  }

  if (text.includes('insufficient_quota')) return true;
  if (text.includes('rate limit') && text.includes('plan')) return true;

  // Auth/config/model errors are not transient.
  if (text.includes('http 401') || text.includes('http401')) return true;
  if (text.includes('http 403') || text.includes('http403')) return true;
  if (text.includes('http 404') || text.includes('http404')) return true;
  if (text.includes('http 410') || text.includes('http410')) return true;

  // Provider text patterns (ex.: SambaNova model removed/deprecated/unavailable)
  if (text.includes('requested model') && (text.includes('not available') || text.includes('deprecated') || text.includes('deprecation'))) {
    return true;
  }
  if (text.includes('model') && text.includes('not available')) return true;
  if (text.includes('model_unconfigured')) return true;
  if (text.includes('visual_validation_capture_unavailable')) return true;
  if (text.includes('visual_validation_preview_not_ready')) return true;

  return false;
}

function isTransientTooManyRequestsReason(reason) {
  const text = String(reason || '').toLowerCase();
  if (!text.includes('http 429')) return false;
  if (isNonRetriableProviderReason(text)) return false;
  return true;
}

function parseRetryAfterMs(reason) {
  const text = String(reason || '');
  const match = text.match(/retry-after\s*:\s*([^\)\]\s]+)/i);
  if (!match || !match[1]) return null;

  const raw = String(match[1]).trim();
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(10 * 60 * 1000, seconds * 1000);
  }

  const asDate = new Date(raw).getTime();
  if (!Number.isFinite(asDate)) return null;
  const delta = asDate - Date.now();
  if (delta <= 0) return null;
  return Math.min(10 * 60 * 1000, delta);
}

function detectProviderFromReason(reason) {
  const text = String(reason || '').toLowerCase();
  if (text.includes('openai')) return 'openai';
  if (text.includes('sambanova')) return 'sambanova';
  if (text.includes('gemini') || text.includes('google')) return 'gemini';
  return 'generic';
}

function computeRetryBackoffMs(reason, stagnationCount) {
  const attempts = Math.max(1, Number(stagnationCount) || 1);
  const genericBackoff = Math.min(45000, 1500 * attempts);
  if (!isTransientTooManyRequestsReason(reason)) return genericBackoff;

  const retryAfterMs = parseRetryAfterMs(reason);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.max(genericBackoff, retryAfterMs);
  }

  const provider = detectProviderFromReason(reason);
  const exp = Math.min(6, attempts - 1);

  if (provider === 'sambanova') {
    const raw = SAMBANOVA_429_BASE_BACKOFF_MS * Math.pow(2, exp);
    return Math.min(SAMBANOVA_429_MAX_BACKOFF_MS, Math.max(genericBackoff, raw));
  }

  if (provider === 'gemini') {
    const raw = GEMINI_429_BASE_BACKOFF_MS * Math.pow(2, exp);
    return Math.min(GEMINI_429_MAX_BACKOFF_MS, Math.max(genericBackoff, raw));
  }

  if (provider === 'openai') {
    const raw = OPENAI_429_BASE_BACKOFF_MS * Math.pow(2, exp);
    return Math.min(OPENAI_429_MAX_BACKOFF_MS, Math.max(genericBackoff, raw));
  }

  const raw = 5000 * Math.pow(2, Math.min(5, exp));
  return Math.min(180000, Math.max(genericBackoff, raw));
}

function extractJsonFromMixedText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const lines = text.split(/\r?\n/).reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue;
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function getSelectedAiProvider() {
  const settings = readAiRuntimeSettings();
  return normalizeAiProviderName(settings.selectedProvider || AI_PROVIDER_ENV);
}

function isAiRetryableReason(reason) {
  const text = String(reason || '');
  if (/n[aã]o retornou texto gerado|empty response|blank response|invalid output|json invalido|json inválido/i.test(text)) {
    return false;
  }
  return /(ai_error:|ai_provider_error:|rwkv_error:|gemini_error:|sambanova_error:|openai_error:|deepseek_error:|custom_api_error:|mock_error:)/i.test(text);
}

async function callAiProviderChat(model, messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, requestOptions = {}) {
  const registry = createProviderRegistry({
    appendAuditEvent,
    callCustomProviderChat,
    callGeminiChat,
    callMockPersonaProviderChat,
    callOpenAiChat,
    callRwkvProviderChat,
    callSambaNovaChat,
    getEffectiveGeminiModel,
    getEffectiveOpenAiModel,
    getEffectiveSambaNovaModel,
    getSelectedAiProvider,
    rwkvEnabled: RWKV_ENABLED,
  });

  return registry.chat(model, messages, timeoutMs, requestOptions);
}

async function callPersonaProviderChat(model, messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, requestOptions = {}) {
  return callAiProviderChat(model, messages, timeoutMs, requestOptions);
}

function buildAgenticOpenAiInput(conversationMessages = []) {
  return (Array.isArray(conversationMessages) ? conversationMessages : [])
    .map((message) => {
      const role = String(message && message.role ? message.role : 'user').trim().toLowerCase();
      const text = String(message && message.content ? message.content : '').trim();
      if (!text) return null;
      if (role === 'assistant') {
        return {
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        };
      }
      return {
        role: 'user',
        content: [{ type: 'input_text', text }],
      };
    })
    .filter(Boolean);
}

function buildAgenticToolResultInput(toolResults = []) {
  return (Array.isArray(toolResults) ? toolResults : [])
    .map((item) => {
      const callId = String(item && item.callId ? item.callId : '').trim();
      if (!callId) return null;
      return {
        type: 'function_call_output',
        call_id: callId,
        output: typeof item.output === 'string' ? item.output : JSON.stringify(item.output || {}),
      };
    })
    .filter(Boolean);
}

function parseAgenticToolCalls(responseData = {}) {
  const output = Array.isArray(responseData && responseData.output) ? responseData.output : [];
  return output
    .filter((item) => item && item.type === 'function_call' && item.name)
    .map((item) => {
      const rawArguments = typeof item.arguments === 'string' ? item.arguments.trim() : '';
      let input = {};
      if (rawArguments) {
        try {
          input = JSON.parse(rawArguments);
        } catch {
          input = { rawArguments };
        }
      }
      return {
        id: item.id || item.call_id || '',
        callId: item.call_id || item.id || '',
        name: item.name,
        input,
      };
    });
}

const accumulatedAgenticMessagesMap = new Map();

async function callChatCompletionsAgentic({
  endpoint,
  apiKey,
  model,
  previousResponseId,
  systemPrompt,
  conversationMessages,
  toolResults,
  tools,
  timeoutMs,
}) {
  let messages = [];

  // Cleanup old cache entries (older than 30 minutes)
  const now = Date.now();
  for (const [key, value] of accumulatedAgenticMessagesMap.entries()) {
    if (now - value.timestamp > 30 * 60 * 1000) {
      accumulatedAgenticMessagesMap.delete(key);
    }
  }

  if (previousResponseId) {
    const cachedEntry = accumulatedAgenticMessagesMap.get(previousResponseId);
    if (!cachedEntry) {
      throw new Error(`Agentic conversation session not found for ID: ${previousResponseId}`);
    }
    messages = [...cachedEntry.messages];

    for (const result of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: result.callId || result.id || '',
        content: typeof result.output === 'string' ? result.output : JSON.stringify(result.output || {}),
      });
    }
  } else {
    if (systemPrompt && String(systemPrompt).trim()) {
      messages.push({
        role: 'system',
        content: String(systemPrompt).trim(),
      });
    }
    for (const msg of conversationMessages) {
      const role = String(msg && msg.role ? msg.role : 'user').trim().toLowerCase();
      const content = String(msg && msg.content ? msg.content : '').trim();
      if (content) {
        messages.push({
          role: role === 'assistant' ? 'assistant' : 'user',
          content,
        });
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 90000));

  const body = {
    model,
    messages,
    tools: Array.isArray(tools) && tools.length ? tools : undefined,
    tool_choice: Array.isArray(tools) && tools.length ? 'auto' : undefined,
    max_tokens: 4096,
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const clipped = String(errorBody || '').replace(/\s+/g, ' ').slice(0, 400);
      throw new Error(`Chat Completions HTTP ${response.status}${clipped ? `: ${clipped}` : ''}`);
    }

    const data = await response.json();
    const firstChoice = data.choices && data.choices[0];
    let text = '';
    let toolCalls = [];

    if (firstChoice && firstChoice.message) {
      text = typeof firstChoice.message.content === 'string' ? firstChoice.message.content.trim() : '';
      toolCalls = parseChatCompletionToolCalls(firstChoice.message);
    }

    const responseId = data.id || `agentic_chat_comp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const assistantMessage = {
      role: 'assistant',
      content: text || null,
    };
    if (firstChoice && firstChoice.message && Array.isArray(firstChoice.message.tool_calls)) {
      assistantMessage.tool_calls = firstChoice.message.tool_calls;
    }
    messages.push(assistantMessage);

    accumulatedAgenticMessagesMap.set(responseId, {
      messages,
      timestamp: Date.now(),
    });

    return {
      responseId,
      text,
      toolCalls,
      raw: data,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseChatCompletionToolCalls(message = {}) {
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return toolCalls
    .filter((tc) => tc && tc.type === 'function' && tc.function && tc.function.name)
    .map((tc) => {
      const rawArguments = typeof tc.function.arguments === 'string' ? tc.function.arguments.trim() : '';
      let input = {};
      if (rawArguments) {
        try {
          input = JSON.parse(rawArguments);
        } catch {
          input = { rawArguments };
        }
      }
      return {
        id: tc.id || '',
        callId: tc.id || '',
        name: tc.function.name,
        input,
      };
    });
}

function actionRequiresMaterialChange(action = {}) {
  const route = action.routeDecision || {};
  const productRoute = route.productRoute || {};
  const text = `${action.userMessage || ''} ${route.executionMessage || ''}`.toLowerCase();
  return (
    productRoute.capability === 'create_project' ||
    productRoute.executionIntent === 'init_project' ||
    productRoute.capability === 'edit_project' ||
    productRoute.executionIntent === 'edit_project' ||
    /\b(criar|crie|gerar|gere|implementar|implemente|arquivos|projeto|app|site|escrever|alterar|altere|modificar|modifique|adicionar|adicione)\b/.test(text)
  );
}

async function requestAgenticModelTurn({
  previousResponseId = '',
  systemPrompt = '',
  conversationMessages = [],
  toolResults = [],
  tools = [],
  timeoutMs = 90000,
} = {}) {
  const provider = String(getSelectedAiProvider() || '').trim().toLowerCase();

  if (provider === 'openai') {
    const apiKey = String(getEffectiveOpenAiApiKey() || '').trim();
    if (!apiKey) {
      throw new Error('OpenAI api_key_missing: configure uma API key válida antes de usar o loop agentic.');
    }

    const effectiveModel = sanitizeOpenAiModelName(getEffectiveOpenAiModel() || '');
    if (!effectiveModel) {
      throw new Error('OpenAI model_unconfigured: configure um modelo válido antes de usar o loop agentic.');
    }

    if (shouldUseOpenAiResponsesApi(effectiveModel)) {
      const input = previousResponseId
        ? buildAgenticToolResultInput(toolResults)
        : buildAgenticOpenAiInput(conversationMessages);
      if (!input.length) {
        throw new Error('OpenAI agentic_empty_input: o loop agentic não recebeu contexto suficiente para continuar.');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 90000));
      const body = {
        model: effectiveModel,
        input,
        instructions: String(systemPrompt || '').trim(),
        tools: Array.isArray(tools) && tools.length ? tools : undefined,
        tool_choice: 'auto',
        store: true,
        max_output_tokens: 4096,
        reasoning: { effort: /\bcodex\b/i.test(effectiveModel) ? 'low' : 'minimal' },
        text: { verbosity: /\bcodex\b/i.test(effectiveModel) ? 'medium' : 'low' },
      };
      if (previousResponseId) {
        body.previous_response_id = String(previousResponseId);
      }

      try {
        const response = await fetch(`${resolveOpenAiBaseUrl(OPENAI_API_BASE_URL)}/responses`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          const clipped = String(errorBody || '').replace(/\s+/g, ' ').slice(0, 400);
          throw new Error(`OpenAI HTTP ${response.status}${clipped ? `: ${clipped}` : ''}`);
        }

        const data = await response.json();
        return {
          responseId: data && data.id ? String(data.id) : '',
          text: extractOpenAiResponsesText(data),
          toolCalls: parseAgenticToolCalls(data),
          raw: data,
        };
      } finally {
        clearTimeout(timeout);
      }
    } else {
      const baseUrl = resolveOpenAiBaseUrl(OPENAI_API_BASE_URL);
      const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';
      return callChatCompletionsAgentic({
        endpoint,
        apiKey,
        model: effectiveModel,
        previousResponseId,
        systemPrompt,
        conversationMessages,
        toolResults,
        tools,
        timeoutMs,
      });
    }
  } else if (provider === 'gemini') {
    const apiKey = String(getEffectiveGeminiApiKey() || '').trim();
    if (!apiKey) {
      throw new Error('Gemini api_key_missing: configure uma API key válida antes de usar o loop agentic.');
    }

    const effectiveModel = sanitizeGeminiModelName(getEffectiveGeminiModel() || '');
    if (!effectiveModel) {
      throw new Error('Gemini model_unconfigured: configure um modelo válido antes de usar o loop agentic.');
    }

    const baseUrl = String(GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const endpoint = `${baseUrl}/openai/chat/completions`;

    return callChatCompletionsAgentic({
      endpoint,
      apiKey,
      model: effectiveModel,
      previousResponseId,
      systemPrompt,
      conversationMessages,
      toolResults,
      tools,
      timeoutMs,
    });
  } else {
    throw new Error(`Provedor de loop agentic não suportado: ${provider}`);
  }
}

function buildExecutionCommandFromAction(action) {
  const protocol = PERSONA_PROTOCOL_VERSION;
  const issuer = 'persona';
  const targetExecutor = 'automata_executor';

  if (action.type === 'operation_batch') {
    return {
      protocol,
      issuer,
      target_executor: targetExecutor,
      task_type: 'execute_operation_batch',
      operation: action.intent || 'operation_batch',
      root_path: action.rootPath,
      operations: action.operations,
      constraints: {
        require_workspace_scope: true,
        require_audit_event: true,
      },
    };
  }

  if (action.type === 'search_text_in_files') {
    return {
      protocol,
      issuer,
      target_executor: targetExecutor,
      task_type: 'search_text_in_files',
      operation: 'search_text',
      root_path: action.rootPath,
      target_text: action.targetText,
      max_results: action.maxResults || 20,
      constraints: {
        require_workspace_scope: true,
        require_audit_event: true,
      },
    };
  }

  return {
    protocol,
    issuer,
    target_executor: targetExecutor,
    task_type: 'apply_file_patch',
    operation: action.intent || 'edit_patch',
    root_path: action.rootPath,
    target_file: action.targetFile,
    previous_content_hash: action.previousContentHash,
    next_content: action.nextContent,
    constraints: {
      require_hash_match: true,
      require_workspace_scope: true,
      require_audit_event: true,
    },
  };
}

async function buildInitialBlueprintRuntimePlan({
  projectInfo,
  userMessage,
  attachments = [],
  executionIntent,
  runtimeBudget,
  basePlan,
  contextHint = {},
  workingBrief = null,
  buildModeRoute = null,
  productRouteDecision = null,
} = {}) {
  if (executionIntent !== 'init_project') return null;

  const contextRoute =
    productRouteDecision && typeof productRouteDecision === 'object'
      ? productRouteDecision
      : resolveCortexProductRouteDecisionFromContextHint(contextHint);
  const structuredWorkingBrief = workingBrief || resolvePersonaWorkingBriefFromProductRoute(contextRoute);
  const structuredBuildModeRoute = buildModeRoute || resolveCortexBuildModeRouteFromProductRoute(contextRoute);
  const contextRouteMeta = contextRoute && contextRoute.meta ? contextRoute.meta : {};
  const contextProductRoute = contextRoute && contextRoute.productRoute ? contextRoute.productRoute : {};
  const routeMode = String(
    contextProductRoute.mode ||
      contextRouteMeta.mode ||
      contextRouteMeta.buildMode ||
      (structuredBuildModeRoute ? structuredBuildModeRoute.mode : '') ||
      ''
  ).toLowerCase();
  const explicitRebuild = hasExplicitProjectRebuildIntent(userMessage);
  const blueprintOptions = {
    userMessage,
    executionIntent,
    attachments,
    workingBrief: structuredWorkingBrief,
  };
  const localBlueprintPolicy = resolveRuntimeLocalBlueprintPolicy({
    routeMode,
    buildModeRoute: structuredBuildModeRoute,
    explicitRebuild,
    preferLocalBlueprint: shouldPreferProjectBlueprint(blueprintOptions),
    fallbackLocalBlueprint: shouldUseProjectBlueprintFallback(blueprintOptions),
  });
  if (localBlueprintPolicy.guidedAppArchitecture) return null;
  const explicitRebuildAllowsLocalBlueprint = localBlueprintPolicy.explicitRebuildAllowsLocalBlueprint;
  if (
    hasApplicationSurfaceFilesForBlueprintGuard(projectInfo) &&
    !explicitRebuildAllowsLocalBlueprint
  ) {
    return null;
  }
  const routeAllowsBlueprint = localBlueprintPolicy.routeAllowsBlueprint;

  if (!routeAllowsBlueprint && !shouldPreferProjectBlueprint(blueprintOptions)) return null;

  const mediaAssets = await resolveBlueprintMediaAssets({
    userMessage,
    projectInfo,
    workingBrief: structuredWorkingBrief,
    buildModeRoute: structuredBuildModeRoute,
    productRouteDecision: contextRoute,
    mediaIntent: structuredWorkingBrief && Array.isArray(structuredWorkingBrief.mediaIntent)
      ? structuredWorkingBrief.mediaIntent
      : [],
    contract: buildCortexPexelsContractFromPersonaBrief(structuredWorkingBrief),
  });
  const blueprint = buildProjectBlueprintOperationBatch({
    projectInfo,
    userMessage,
    attachments,
    executionIntent,
    buildOperationBatchDiffPreview,
    force: true,
    mediaAssets,
    workingBrief: structuredWorkingBrief,
    buildModeRoute: structuredBuildModeRoute,
  });
  if (!blueprint || !blueprint.ok || !blueprint.action) return null;

  const artifactContext = [
    'Compositor modular determinístico de criação inicial.',
    'Aplicado antes do briefing remoto para preservar stack, domínio e peças de layout do pedido.',
  ].join(' ');
  const validation = evaluateExecutionReadiness({
    operations: blueprint.action.operations,
    projectRootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
    executionIntent,
    userMessage,
    artifactContext,
  });
  if (!validation || !validation.ready) {
    if (explicitRebuildAllowsLocalBlueprint) {
      return {
        ...basePlan,
        action: null,
        response: [
          'O blueprint local foi selecionado para esta recriação explícita, mas a validação técnica bloqueou a aplicação.',
          `Pontuação: ${validation ? validation.score : 0}% (mínimo ${validation ? validation.minScore : CORTEX_VALIDATION_MIN_SCORE}%).`,
          'Não usei fallback remoto para substituir esse contrato local.',
        ].join(' '),
        meta: {
          planner: 'cortex_runtime',
          model: null,
          reason: `project_blueprint_validation_failed:${validation ? validation.score : 0}`,
          runtime: CORTEX_RENDER_RUNTIME_VERSION,
          runtimeBudget,
          validation,
          protocol: PERSONA_PROTOCOL_VERSION,
        },
      };
    }
    return null;
  }

  const actionWithCommand = {
    ...blueprint.action,
    cortexRuntimeVersion: CORTEX_RENDER_RUNTIME_VERSION,
    cortexValidated: true,
    workGraphId: null,
    renderPassId: null,
    executionValidation: validation,
    artifactContext,
    executionCommand: buildExecutionCommandFromAction(blueprint.action),
  };
  const writeCount = actionWithCommand.operations.filter((op) => op.op === 'write_file' || op.op === 'append_file').length;
  const stackLabel = actionWithCommand.blueprint && actionWithCommand.blueprint.stack
    ? actionWithCommand.blueprint.stack
    : 'web';

  return {
    ...basePlan,
    action: actionWithCommand,
    response: [
      `Preparei uma composição modular ${stackLabel} sem depender de nova chamada remota.`,
      `O compositor local preparou ${actionWithCommand.operations.length} operação(ões), com ${writeCount} arquivo(s) gerado(s).`,
      `A validação técnica marcou ${validation.score}% (mínimo ${validation.minScore}%).${formatVisualValidationSummary(validation)} Deseja aplicar esses artefatos no projeto?`,
    ].join(' '),
    meta: {
      planner: 'cortex_runtime',
      model: null,
      reason: 'project_blueprint_ready',
      runtime: CORTEX_RENDER_RUNTIME_VERSION,
      runtimeBudget,
      protocol: PERSONA_PROTOCOL_VERSION,
      blueprint: actionWithCommand.blueprint || null,
    },
  };
}

function resolveProductRouteModeForRuntime({ contextHint = {}, productRouteDecision = null, buildModeRoute = null } = {}) {
  const contextRoute =
    productRouteDecision && typeof productRouteDecision === 'object'
      ? productRouteDecision
      : resolveCortexProductRouteDecisionFromContextHint(contextHint);
  const contextProductRoute = contextRoute && contextRoute.productRoute ? contextRoute.productRoute : {};
  const contextRouteMeta = contextRoute && contextRoute.meta ? contextRoute.meta : {};
  return String(
    contextProductRoute.mode ||
      contextRouteMeta.mode ||
      contextRouteMeta.buildMode ||
      (buildModeRoute && buildModeRoute.mode ? buildModeRoute.mode : '') ||
      ''
  ).toLowerCase();
}

function buildDeterministicPatchRuntimePlan({
  projectInfo,
  userMessage,
  attachments = [],
  executionIntent,
  runtimeBudget,
  basePlan,
  contextHint = {},
  buildModeRoute = null,
  productRouteDecision = null,
} = {}) {
  if (executionIntent !== 'edit_project') return null;
  const routeMode = resolveProductRouteModeForRuntime({ contextHint, productRouteDecision, buildModeRoute });
  if (routeMode !== 'deterministic_patch') return null;
  if (isUnsupportedBackgroundMediaRequest(userMessage) && !isHeroMediaPatchRequest(userMessage)) {
    return null;
  }

  const localDiagnostics = buildLocalProjectDiagnostics({ projectInfo, userMessage, attachments });
  const patch = buildDeterministicPatchOperationBatch({
    projectInfo,
    userMessage,
    attachments,
    executionIntent,
    localDiagnostics,
  });
  const safePatchClassification = deterministicEditService.classifySafeContentEditRequest(userMessage);

  if (!patch || !patch.ok || !patch.action) {
    const unsupportedVisualPatch = safePatchClassification &&
      safePatchClassification.kind === 'background_media_overlay_requires_visual_patch';
    const safetyRejected = patch && patch.safePatchValidation && patch.safePatchValidation.ok === false;
    return {
      ...basePlan,
      action: null,
      response:
        unsupportedVisualPatch
          ? 'Este pedido não é um micro-patch determinístico seguro: imagem, vídeo ou overlay no fundo exigem edição visual/estrutural. Não vou fingir que isso é só troca de cor; mantive o projeto intacto para seguir por uma rota semântica com validação visual.'
          : safetyRejected
            ? 'O micro-patch determinístico foi bloqueado pela validação de segurança antes de qualquer aplicação. Mantive o projeto intacto para seguir por uma rota semântica ou por um contrato mais específico.'
            : 'Identifiquei uma rota de patch determinístico, mas nenhum contrato local ativo conseguiu materializar uma alteração segura. Vou preservar o projeto e manter este pedido para resolução semântica pela IA.',
      meta: {
        planner: 'cortex_runtime',
        model: null,
        reason: unsupportedVisualPatch
          ? 'deterministic_patch_unsupported_visual_request'
          : safetyRejected
            ? 'deterministic_patch_safety_rejected'
          : 'deterministic_patch_contract_unresolved',
        runtime: CORTEX_RENDER_RUNTIME_VERSION,
        runtimeBudget,
        localDiagnostics,
        safePatchClassification,
        safePatchValidation: patch && patch.safePatchValidation ? patch.safePatchValidation : null,
        safePatchEvidence: patch && patch.safePatchEvidence ? patch.safePatchEvidence : null,
      },
    };
  }

  const artifactContext = [
    'Patch determinístico local.',
    'Executado antes do briefing remoto porque a rota do produto já apontou um contrato técnico ativo.',
  ].join(' ');
  const validation = evaluateExecutionReadiness({
    operations: patch.action.operations,
    projectRootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
    executionIntent,
    userMessage,
    artifactContext,
  });

  if (!validation || !validation.ready) {
    return {
      ...basePlan,
      action: null,
      response:
        'Preparei o patch local, mas a validação técnica não liberou a execução. Mantive o projeto intacto para não aplicar uma alteração incompleta.',
      meta: {
        planner: 'cortex_runtime',
        model: null,
        reason: `deterministic_patch_validation_failed:${validation ? validation.score : 0}`,
        runtime: CORTEX_RENDER_RUNTIME_VERSION,
        runtimeBudget,
        localDiagnostics,
        validation,
      },
    };
  }

  const actionWithCommand = {
    ...patch.action,
    cortexRuntimeVersion: CORTEX_RENDER_RUNTIME_VERSION,
    cortexValidated: true,
    workGraphId: null,
    renderPassId: null,
    executionValidation: validation,
    artifactContext,
    executionCommand: buildExecutionCommandFromAction(patch.action),
  };
  const writeCount = actionWithCommand.operations.filter((op) => op.op === 'write_file' || op.op === 'append_file').length;

  return {
    ...basePlan,
    action: actionWithCommand,
    response: [
      'Preparei uma alteração local com contrato determinístico ativo, sem depender de chamada remota.',
      `A validação técnica marcou ${validation.score}% (mínimo ${validation.minScore}%).${formatVisualValidationSummary(validation)}`,
      `Serão alterado(s) ${writeCount} arquivo(s). Deseja aplicar?`,
    ].join(' '),
    meta: {
      planner: 'cortex_runtime',
      model: null,
      reason: 'deterministic_patch_ready',
      runtime: CORTEX_RENDER_RUNTIME_VERSION,
      runtimeBudget,
      protocol: PERSONA_PROTOCOL_VERSION,
      localDiagnostics,
    },
  };
}

async function buildVisualStructuralFallbackRuntimePlan({
  projectInfo,
  userMessage,
  attachments = [],
  executionIntent,
  runtimeBudget,
  basePlan,
  providerFailure = null,
} = {}) {
  if (executionIntent !== 'edit_project') return null;
  const patch = await buildVisualStructuralFallbackOperationBatch({
    projectInfo,
    userMessage,
    attachments,
    executionIntent,
    providerFailure,
  });
  if (patch && patch.blocked) {
    return {
      ...basePlan,
      action: null,
      response: patch.message || 'O pedido exige mídia real no hero, mas nenhum provider retornou um asset válido. Mantive o projeto intacto.',
      meta: {
        planner: 'cortex_runtime',
        model: null,
        reason: patch.reason || 'visual_structural_patch_blocked',
        runtime: CORTEX_RENDER_RUNTIME_VERSION,
        runtimeBudget,
        providerFailure,
      },
    };
  }
  if (!patch || !patch.ok || !patch.action) return null;

  const artifactContext = [
    'Patch visual estrutural local.',
    'Usado para pedidos de hero, midia de fundo, camadas e blend quando a falta de asset externo nao deve bloquear a edicao.',
  ].join(' ');
  const validation = evaluateExecutionReadiness({
    operations: patch.action.operations,
    projectRootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
    executionIntent,
    userMessage,
    artifactContext,
  });

  if (!validation || !validation.ready) {
    return {
      ...basePlan,
      action: null,
      response:
        'Preparei uma edição visual local, mas a validação técnica não liberou a execução. Mantive o projeto intacto para uma correção orientada pelo diagnóstico.',
      meta: {
        planner: 'cortex_runtime',
        model: null,
        reason: `visual_structural_patch_validation_failed:${validation ? validation.score : 0}`,
        runtime: CORTEX_RENDER_RUNTIME_VERSION,
        runtimeBudget,
        validation,
      },
    };
  }

  const actionWithCommand = {
    ...patch.action,
    cortexRuntimeVersion: CORTEX_RENDER_RUNTIME_VERSION,
    cortexValidated: true,
    workGraphId: null,
    renderPassId: null,
    executionValidation: validation,
    artifactContext,
    executionCommand: buildExecutionCommandFromAction(patch.action),
  };
  const writeCount = actionWithCommand.operations.filter((op) => op.op === 'write_file' || op.op === 'append_file').length;

  return {
    ...basePlan,
    action: actionWithCommand,
    response: [
      'Preparei uma edição visual incremental do hero sem recriar o projeto.',
      actionWithCommand.microContract && actionWithCommand.microContract.sourceStatus === 'ready'
        ? 'Resolvi um vídeo real para o hero, apliquei grayscale na mídia e mantive apenas overlays brancos leves para preservar a imagem.'
        : 'Como nenhum arquivo/URL de vídeo foi anexado, deixei um slot de vídeo editável com fallback visual seguro e as duas camadas brancas solicitadas.',
      `A validação técnica marcou ${validation.score}% (mínimo ${validation.minScore}%).${formatVisualValidationSummary(validation)}`,
      `Serão alterado(s) ${writeCount} arquivo(s). Deseja aplicar?`,
    ].join(' '),
    meta: {
      planner: 'cortex_runtime',
      model: null,
      reason: 'visual_structural_patch_ready',
      runtime: CORTEX_RENDER_RUNTIME_VERSION,
      runtimeBudget,
      protocol: PERSONA_PROTOCOL_VERSION,
      providerFailure,
    },
  };
}

function buildRuntimeIntentSourceMessage(userMessage = '', contextHint = {}) {
  const routeDecision =
    contextHint && contextHint.personaRouteDecision && typeof contextHint.personaRouteDecision === 'object'
      ? contextHint.personaRouteDecision
      : {};
  const conversationMessages = Array.isArray(contextHint && contextHint.conversationMessages)
    ? contextHint.conversationMessages
    : [];
  const recentConversation = conversationMessages
    .slice(-8)
    .map((message) => {
      const role = message && message.role ? String(message.role) : 'message';
      const text = message && message.text ? String(message.text) : '';
      return text ? `${role}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');

  return clipText([
    contextHint && contextHint.originalUserMessage ? `Pedido original: ${contextHint.originalUserMessage}` : '',
    userMessage ? `Pedido técnico atual: ${userMessage}` : '',
    contextHint && contextHint.routeExecutionMessage ? `Execução roteada: ${contextHint.routeExecutionMessage}` : '',
    routeDecision.response ? `Resposta da Persona: ${routeDecision.response}` : '',
    routeDecision.executionMessage ? `Mensagem de execução da Persona: ${routeDecision.executionMessage}` : '',
    recentConversation ? `Histórico recente:\n${recentConversation}` : '',
  ].filter(Boolean).join('\n\n'), 6000);
}

function resolveRuntimeExecutionIntent({
  intentSourceMessage = '',
  effectiveUserMessage = '',
  contextHint = {},
  projectInfo = null,
  productRuntimeContract = null,
} = {}) {
  const routeDecision = productRuntimeContract && productRuntimeContract.routeDecision
    ? productRuntimeContract.routeDecision
    : resolveCortexProductRouteDecisionFromContextHint(contextHint);
  const productRoute = routeDecision && routeDecision.productRoute ? routeDecision.productRoute : {};
  const buildModeRoute = productRuntimeContract && productRuntimeContract.buildModeRoute
    ? productRuntimeContract.buildModeRoute
    : resolveCortexBuildModeRouteFromProductRoute(routeDecision);
  const routedIntent = String(
    productRoute.executionIntent ||
      (buildModeRoute && buildModeRoute.executionIntent) ||
      ''
  )
    .trim()
    .toLowerCase();

  if (
    routeDecision &&
    routeDecision.decision === 'execute' &&
    routedIntent &&
    routedIntent !== 'conversation'
  ) {
    return routedIntent;
  }

  return resolveExecutionIntent(intentSourceMessage || effectiveUserMessage, contextHint, projectInfo);
}

function bindActionToAuthorizedProject(action, projectInfo) {
  const rootPath = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
  if (!action || typeof action !== 'object' || !rootPath) return action;

  const boundAction = {
    ...action,
    rootPath,
  };

  if (action.executionCommand && typeof action.executionCommand === 'object') {
    boundAction.executionCommand = {
      ...action.executionCommand,
      root_path: rootPath,
    };
  }

  return boundAction;
}

function validateExecutionCommand(command) {
  if (!command || typeof command !== 'object') {
    return { ok: false, message: 'Comando de execução ausente.' };
  }
  if (!SUPPORTED_EXEC_PROTOCOLS.has(command.protocol)) {
    return {
      ok: false,
      message: `Protocolo inválido. Esperado: ${Array.from(SUPPORTED_EXEC_PROTOCOLS).join(' ou ')}.`,
    };
  }
  if (!['apply_file_patch', 'search_text_in_files', 'execute_operation_batch'].includes(command.task_type)) {
    return { ok: false, message: 'Tipo de tarefa não suportado.' };
  }
  if (command.task_type === 'execute_operation_batch') {
    if (!command.root_path || !Array.isArray(command.operations) || !command.operations.length) {
      return { ok: false, message: 'Comando incompleto para operação em lote.' };
    }
    for (const operation of command.operations) {
      if (!operation || typeof operation !== 'object') {
        return { ok: false, message: 'Operação inválida no lote.' };
      }
      if (!['mkdir', 'write_file', 'append_file'].includes(operation.op)) {
        return { ok: false, message: `Operação não suportada no lote: ${operation.op}` };
      }
      if (!operation.path || typeof operation.path !== 'string') {
        return { ok: false, message: 'Operação de lote sem caminho de arquivo/pasta.' };
      }
      if ((operation.op === 'write_file' || operation.op === 'append_file') && typeof operation.content !== 'string') {
        return { ok: false, message: `Operação ${operation.op} sem conteúdo textual.` };
      }
    }
    return { ok: true };
  }
  if (command.task_type === 'search_text_in_files') {
    if (!command.root_path || !command.target_text) {
      return { ok: false, message: 'Comando incompleto para busca de texto.' };
    }
    return { ok: true };
  }
  if (!command.root_path || !command.target_file || !command.previous_content_hash || typeof command.next_content !== 'string') {
    return { ok: false, message: 'Comando incompleto para apply_file_patch.' };
  }
  return { ok: true };
}

async function runCortexRenderRuntimePlan({ projectInfo, userMessage, attachments = [], contextHint = {}, jobId = null }) {
  const runtimeSettings = getRuntimeProfileSettings();
  const runtimeBudget = await getCortexRuntimeBudget();
  if (jobId) {
    markCortexRuntimePhase(jobId, 'cortex_intake', { runtime: CORTEX_RENDER_RUNTIME_VERSION });
    checkpointRuntimeBudget(jobId, runtimeBudget);
  }

  if (runtimeBudget.pausePolicy.shouldPause) {
    return buildCortexPausePlan({ projectInfo, userMessage, attachments, runtimeBudget });
  }

  const basePlan = buildConfirmationPlan(projectInfo, userMessage, attachments);
  if (!basePlan.ok) {
    return {
      ...basePlan,
      meta: {
        planner: 'cortex_runtime',
        reason: 'invalid_project_context',
        runtime: CORTEX_RENDER_RUNTIME_VERSION,
        runtimeBudget,
      },
    };
  }

  const baseIntent = basePlan && basePlan.meta ? String(basePlan.meta.intent || '') : '';
  const personaApprovedExecution = Boolean(contextHint && contextHint.personaApprovedExecution);
  if (!personaApprovedExecution && (baseIntent === 'informational' || baseIntent === 'edit_needs_target')) {
    return {
      ...basePlan,
      action: null,
      meta: {
        ...(basePlan.meta || {}),
        planner: 'cortex_runtime',
        reason: baseIntent === 'informational' ? 'conversation_only' : 'edit_needs_target',
        runtime: CORTEX_RENDER_RUNTIME_VERSION,
        runtimeBudget,
      },
    };
  }

  const effectiveUserMessage =
    contextHint && contextHint.awaitingScaffoldClarification && shouldUseDefaultScaffoldConfiguration(userMessage)
      ? buildDefaultScaffoldPrompt(userMessage, contextHint)
      : userMessage;
  const currentDiagnosticIntent = hasDiagnosticIntent(userMessage, projectInfo);
  const effectiveDiagnosticIntent = hasDiagnosticIntent(effectiveUserMessage, projectInfo);
  const defaultScaffoldAuthorized =
    shouldUseDefaultScaffoldConfiguration(userMessage) || shouldUseDefaultScaffoldConfiguration(effectiveUserMessage);
  const brainBudget = getBrainBudgetSettings(runtimeSettings);
  const clarificationAttempts = Number(contextHint && contextHint.scaffoldClarificationAttempts ? contextHint.scaffoldClarificationAttempts : 0);
  const latestDiagnostics = contextHint && contextHint.latestDiagnostics ? contextHint.latestDiagnostics : null;
  const intentSourceMessage = buildRuntimeIntentSourceMessage(effectiveUserMessage, contextHint);
  const activeMemory =
    contextHint && contextHint.activeMemory && contextHint.activeMemory.schemaVersion === 'active-memory-v1'
      ? contextHint.activeMemory
      : await resolveActiveMemoryContext({
          projectInfo,
          userMessage: effectiveUserMessage,
          attachments,
          contextHint,
          conversationMessages: contextHint && Array.isArray(contextHint.conversationMessages)
            ? contextHint.conversationMessages
            : [],
          stage: 'runtime',
        });
  const productRuntimeContract = resolveCortexProductRuntimeContract(contextHint);
  const executionIntent = resolveRuntimeExecutionIntent({
    intentSourceMessage,
    effectiveUserMessage,
    contextHint,
    projectInfo,
    productRuntimeContract,
  });
  const diagnosticRequest = shouldTreatRuntimeRequestAsDiagnostic({
    executionIntent,
    userMessage: effectiveUserMessage,
    currentDiagnosticIntent,
    effectiveDiagnosticIntent,
    contextDiagnosticIntent: hasDiagnosticIntent(intentSourceMessage, projectInfo),
    routeCapability:
      (productRuntimeContract.routeDecision &&
        (productRuntimeContract.routeDecision.capability ||
          (productRuntimeContract.routeDecision.productRoute &&
            productRuntimeContract.routeDecision.productRoute.capability))) ||
      '',
  });
  const initialBlueprintPlan = await buildInitialBlueprintRuntimePlan({
    projectInfo,
    userMessage: intentSourceMessage || effectiveUserMessage,
    attachments,
    executionIntent,
    runtimeBudget,
    basePlan,
    contextHint,
    workingBrief: productRuntimeContract.workingBrief,
    buildModeRoute: productRuntimeContract.buildModeRoute,
    productRouteDecision: productRuntimeContract.routeDecision,
  });
  if (initialBlueprintPlan) {
    checkpointProjectBlueprintPlan(jobId, initialBlueprintPlan);
    return initialBlueprintPlan;
  }

  const visualStructuralFallbackPlan = await buildVisualStructuralFallbackRuntimePlan({
    projectInfo,
    userMessage: intentSourceMessage || effectiveUserMessage,
    attachments,
    executionIntent,
    runtimeBudget,
    basePlan,
  });
  if (visualStructuralFallbackPlan) {
    checkpointDeterministicPatchPlan(jobId, visualStructuralFallbackPlan);
    return visualStructuralFallbackPlan;
  }

  const deterministicPatchPlan = buildDeterministicPatchRuntimePlan({
    projectInfo,
    userMessage: intentSourceMessage || effectiveUserMessage,
    attachments,
    executionIntent,
    runtimeBudget,
    basePlan,
    contextHint,
    buildModeRoute: productRuntimeContract.buildModeRoute,
    productRouteDecision: productRuntimeContract.routeDecision,
  });
  if (deterministicPatchPlan) {
    checkpointDeterministicPatchPlan(jobId, deterministicPatchPlan);
    return deterministicPatchPlan;
  }
  if (diagnosticRequest) {
    const previewDiagnostic = buildPreviewDiagnosticResponse({
      projectInfo,
      latestDiagnostics,
      options: {
        port: contextHint && contextHint.previewPort ? contextHint.previewPort : undefined,
        manualPreviewUrl: contextHint && contextHint.activePreviewUrl ? contextHint.activePreviewUrl : undefined,
      },
    });
    if (previewDiagnostic && previewDiagnostic.ok) {
      return {
        ...basePlan,
        action: null,
        response: previewDiagnostic.response,
        meta: {
          ...(basePlan.meta || {}),
          planner: 'cortex_runtime',
          model: PERSONA_MODEL_BRAIN,
          reason: 'conversation_only',
          diagnosticReason: previewDiagnostic.reason,
          runtime: CORTEX_RENDER_RUNTIME_VERSION,
          runtimeBudget,
          noFileChanges: true,
          previewDiagnostic: {
            ready: Boolean(previewDiagnostic.ready),
            reason: previewDiagnostic.reason,
            planStatus: previewDiagnostic.plan ? previewDiagnostic.plan.status || '' : '',
            stack: previewDiagnostic.plan ? previewDiagnostic.plan.stack || '' : '',
            commandText: previewDiagnostic.plan ? previewDiagnostic.plan.commandText || '' : '',
            url: previewDiagnostic.plan ? previewDiagnostic.plan.url || '' : '',
            warnings: previewDiagnostic.plan && Array.isArray(previewDiagnostic.plan.warnings)
              ? previewDiagnostic.plan.warnings.slice(0, 6)
              : [],
          },
          activeMemory: summarizeActiveMemory(activeMemory),
        },
      };
    }
  }
  if (
    !defaultScaffoldAuthorized &&
    !diagnosticRequest &&
    (executionIntent === 'init_project' || hasScaffoldIntent(effectiveUserMessage, projectInfo)) &&
    shouldAskCortexBriefingClarification(effectiveUserMessage, contextHint) &&
    clarificationAttempts < Math.max(1, Number(brainBudget.maxClarifications || 2))
  ) {
    return {
      ...basePlan,
      action: null,
      response: buildCortexBriefingClarificationResponse(effectiveUserMessage, clarificationAttempts),
      meta: {
        planner: 'cortex_runtime',
        model: PERSONA_MODEL_BRAIN,
        reason: 'cortex_briefing_clarification_needed',
        runtime: CORTEX_RENDER_RUNTIME_VERSION,
        runtimeBudget,
        awaitingScaffoldClarification: true,
        scaffoldClarificationAttempts: clarificationAttempts + 1,
        lastScaffoldPrompt: effectiveUserMessage,
        clarificationQuestions: getCortexBriefingClarificationQuestions(),
        activeMemory: summarizeActiveMemory(activeMemory),
      },
    };
  }
  const mempalaceContext = projectInfo
    ? (activeMemory && activeMemory.project && activeMemory.project.mempalace
        ? activeMemory.project.mempalace
        : await buildMempalacePlannerContext(projectInfo, effectiveUserMessage))
    : { ok: false, available: false, reason: 'missing_project' };
  const mempalaceCore = projectInfo
    ? (activeMemory && activeMemory.project && activeMemory.project.mempalaceCore
        ? activeMemory.project.mempalaceCore
        : await buildMempalaceCortexCore(projectInfo, effectiveUserMessage, runtimeSettings))
    : { ok: false, available: false, reason: 'missing_project' };
  const ragContext = projectInfo
    ? (activeMemory && activeMemory.project && activeMemory.project.rag
        ? activeMemory.project.rag
        : await buildRagPlannerContext(projectInfo, effectiveUserMessage, attachments, runtimeSettings))
    : { ok: false, available: false, reason: 'missing_project', provider: CORTEX_RAG_PROVIDER };
  const cortexContext =
    activeMemory && activeMemory.project && activeMemory.project.cortex
      ? activeMemory.project.cortex
      : buildCortexPromptContext(projectInfo && projectInfo.id ? projectInfo.id : null, effectiveUserMessage, runtimeSettings);
  const workGraph = createCortexWorkGraph({
    projectInfo,
    userMessage: effectiveUserMessage,
    attachments,
    runtimeBudget,
    memory: mempalaceContext,
    mempalaceCore,
    rag: ragContext,
    cortex: cortexContext,
  });
  workGraph.activeMemory = summarizeActiveMemory(activeMemory);
  workGraph.productRouteDecision = productRuntimeContract.routeDecision || null;
  workGraph.workingBrief = productRuntimeContract.workingBrief || null;
  workGraph.buildModeRoute = productRuntimeContract.buildModeRoute || null;
  workGraph.projectGraph = typeof buildProjectGraphReport === 'function'
    ? buildProjectGraphReport(projectInfo, effectiveUserMessage, {
        maxFiles: 18,
        maxIssues: 16,
      })
    : null;
  checkpointCortexRuntime(jobId, workGraph, runtimeBudget, { stage: 'created' });

  const brainPass = createRenderPass({
    role: 'persona_orchestrator',
    kind: 'briefing',
    inputRefs: ['user_request', 'project_scan', 'cortex_memory'],
    outputContract: { brief: 'string', acceptanceCriteria: 'string[]' },
    maxTokens: 500,
  });
  workGraph.passes.push(brainPass);
  workGraph.currentPassId = brainPass.id;
  workGraph.status = 'briefing';
  setPassStatus(workGraph, brainPass.id, 'running');
  markCortexRuntimePhase(jobId, 'cortex_briefing', { passId: brainPass.id });
  checkpointCortexRuntime(jobId, workGraph, runtimeBudget, { stage: 'briefing_started' });

  let brainBriefing;
  try {
    brainBriefing = await requestCortexBrainBriefing({
      projectInfo,
      userMessage: effectiveUserMessage,
      attachments,
      mempalaceContext,
      mempalaceCore,
      ragContext,
      cortexContext,
      activeMemory,
      runtimeBudget,
      latestDiagnostics,
    });
  } catch (error) {
    setPassStatus(workGraph, brainPass.id, 'failed', { message: error.message });
    workGraph.status = 'failed';
    checkpointCortexRuntime(jobId, workGraph, runtimeBudget, { stage: 'briefing_failed' });
    await persistCortexCheckpointToMempalace(projectInfo, workGraph, 'briefing_failed');
    return {
      ...basePlan,
      action: null,
      response:
        'O Cortex iniciou o trabalho, mas a Persona não conseguiu concluir o briefing nesta tentativa. Não vou forçar execução sem briefing validado; o job ficou pronto para retentativa.',
      meta: {
        planner: 'cortex_runtime',
        model: PERSONA_MODEL_BRAIN,
        reason: `cortex_briefing_error:${error.message}`,
        runtime: CORTEX_RENDER_RUNTIME_VERSION,
        runtimeBudget,
        memory: mempalaceContext,
        mempalaceCore,
        cortex: cortexContext,
        activeMemory: summarizeActiveMemory(activeMemory),
      },
    };
  }

  if (brainBriefing && brainBriefing.needsClarification && (defaultScaffoldAuthorized || diagnosticRequest)) {
    brainBriefing = {
      ...brainBriefing,
      needsClarification: false,
      clarificationQuestions: [],
    };
  }

  if (brainBriefing && brainBriefing.needsClarification) {
    const personaQuestions = Array.isArray(brainBriefing.clarificationQuestions)
      ? brainBriefing.clarificationQuestions.filter(Boolean).slice(0, 5)
      : [];
    const nextQuestions = personaQuestions.length ? personaQuestions : getCortexBriefingClarificationQuestions();
    const nextAttempts = clarificationAttempts + 1;

    setPassStatus(workGraph, brainPass.id, 'needs_input', {
      message: 'A Persona solicitou alinhamento adicional antes da execução.',
      questions: nextQuestions,
    });
    workGraph.status = 'awaiting_briefing_clarification';
    checkpointCortexRuntime(jobId, workGraph, runtimeBudget, { stage: 'briefing_clarification_needed' });
    await persistCortexCheckpointToMempalace(projectInfo, workGraph, 'briefing_clarification_needed');

    return {
      ...basePlan,
      action: null,
      response: buildCortexBriefingClarificationResponse(effectiveUserMessage, clarificationAttempts, nextQuestions),
      meta: {
        planner: 'cortex_runtime',
        model: PERSONA_MODEL_BRAIN,
        reason: 'cortex_briefing_clarification_needed',
        runtime: CORTEX_RENDER_RUNTIME_VERSION,
        runtimeBudget,
        awaitingScaffoldClarification: true,
        scaffoldClarificationAttempts: nextAttempts,
        lastScaffoldPrompt: effectiveUserMessage,
        clarificationQuestions: nextQuestions,
        memory: mempalaceContext,
        mempalaceCore,
        cortex: cortexContext,
        activeMemory: summarizeActiveMemory(activeMemory),
      },
    };
  }

  setPassStatus(workGraph, brainPass.id, 'completed', brainBriefing);
  workGraph.brief = brainBriefing.brief;
  workGraph.briefSpec = brainBriefing.briefSpec || null;
  workGraph.executionIntent = executionIntent;
  workGraph.acceptanceCriteria = Array.isArray(brainBriefing.acceptanceCriteria)
    ? brainBriefing.acceptanceCriteria
    : [];
  workGraph.acceptanceMatrix = buildAcceptanceMatrixFromBriefing({
    acceptanceCriteria: workGraph.acceptanceCriteria,
    userMessage: effectiveUserMessage,
    executionIntent,
    workingBrief: productRuntimeContract.workingBrief,
  });
  workGraph.agenticPlan = buildAgenticDevelopmentPlan({
    userMessage: effectiveUserMessage,
    executionIntent,
    workingBrief: productRuntimeContract.workingBrief,
    acceptanceMatrix: workGraph.acceptanceMatrix,
    projectGraph: workGraph.projectGraph,
  });
  const artifactContext = buildArtifactQualityContextText({
    userMessage: effectiveUserMessage,
    workGraph,
  });
  checkpointCortexRuntime(jobId, workGraph, runtimeBudget, { stage: 'briefing_completed' });

  const renderPass = createRenderPass({
    role: 'persona_executor',
    kind: 'render_operations',
    inputRefs: [brainPass.id, 'project_scan'],
    outputContract: { operations: 'operation_batch', coverage: '100%' },
    maxTokens: runtimeBudget.generationOptions.num_predict,
  });
  workGraph.passes.push(renderPass);
  workGraph.currentPassId = renderPass.id;
  workGraph.status = 'rendering';
  setPassStatus(workGraph, renderPass.id, 'running');
  markCortexRuntimePhase(jobId, 'cortex_render_pass', { passId: renderPass.id });
  checkpointCortexRuntime(jobId, workGraph, runtimeBudget, { stage: 'render_started' });

  const requestPersonaExecutionPlan = async () => {
    return requestEngineOperationBatchAction({
      projectInfo,
      userMessage: effectiveUserMessage,
      attachments,
      mempalaceContext,
      mempalaceCore,
      ragContext,
      cortexContext,
      activeMemory,
      workGraph,
      runtimeBudget,
      latestDiagnostics,
      artifactContext,
      executionIntent,
      productRouteDecision: productRuntimeContract.routeDecision,
      workingBrief: productRuntimeContract.workingBrief,
      buildModeRoute: productRuntimeContract.buildModeRoute,
    });
  };

  let enginePlan = await requestPersonaExecutionPlan();

  if (!enginePlan.ok && enginePlan.coverage && runtimeBudget.maxRepairPasses > 0) {
    setPassStatus(workGraph, renderPass.id, 'needs_repair', {
      message: enginePlan.message,
      coverage: enginePlan.coverage,
    });
    const repairPass = createRenderPass({
      role: 'persona_executor',
      kind: 'repair_operations',
      inputRefs: [renderPass.id, 'validation.coverage'],
      outputContract: { operations: 'operation_batch', coverage: '100%' },
      maxTokens: runtimeBudget.generationOptions.num_predict,
      repairOf: renderPass.id,
    });
    workGraph.passes.push(repairPass);
    workGraph.currentPassId = repairPass.id;
    setPassStatus(workGraph, repairPass.id, 'running');
    checkpointCortexRuntime(jobId, workGraph, runtimeBudget, { stage: 'repair_started' });
    enginePlan = await requestEngineOperationBatchAction({
      projectInfo,
      userMessage: effectiveUserMessage,
      attachments,
      mempalaceContext,
      mempalaceCore,
      ragContext,
      cortexContext,
      activeMemory,
      workGraph,
      runtimeBudget,
      latestDiagnostics,
      executionIntent,
      artifactContext,
      productRouteDecision: productRuntimeContract.routeDecision,
      workingBrief: productRuntimeContract.workingBrief,
      buildModeRoute: productRuntimeContract.buildModeRoute,
      repairContext: {
        failedCoverage: enginePlan.coverage,
        failedRaw: enginePlan.raw || '',
        failedMessage: enginePlan.message,
      },
    });
    setPassStatus(workGraph, repairPass.id, enginePlan.ok ? 'completed' : 'failed', {
      message: enginePlan.message || null,
      coverage: enginePlan.coverage || null,
      schemaErrors: enginePlan.schemaErrors || null,
      rawPreview: enginePlan.raw ? clipText(enginePlan.raw, 1200) : null,
    });
  } else {
    setPassStatus(workGraph, renderPass.id, enginePlan.ok ? 'completed' : 'failed', {
      message: enginePlan.message || null,
      coverage: enginePlan.coverage || null,
      schemaErrors: enginePlan.schemaErrors || null,
      rawPreview: enginePlan.raw ? clipText(enginePlan.raw, 1200) : null,
    });
  }

  if (!enginePlan.ok || !enginePlan.action) {
    workGraph.status = 'failed_validation';
    if (enginePlan.coverage) workGraph.validationResults.push(enginePlan.coverage);
    checkpointCortexRuntime(jobId, workGraph, runtimeBudget, { stage: 'validation_failed' });
    await persistCortexCheckpointToMempalace(projectInfo, workGraph, 'validation_failed');
    const patchFirstRejected =
      typeof enginePlan.message === 'string' &&
      (enginePlan.message.toLowerCase().includes('modo edit_project') ||
        enginePlan.message.toLowerCase().includes('patch-first'));

    return {
      ...basePlan,
      action: null,
      response: patchFirstRejected
        ? 'Bloqueei uma tentativa de recriar o projeto inteiro durante modo de edição incremental. Para este pedido, vou manter patch pontual nos arquivos existentes e preservar o contexto para a próxima tentativa.'
        : 'O Cortex renderizou o pedido em passes, mas o executor ainda não atingiu os critérios de aceite. Não vou aplicar um resultado incompleto; o próximo passo é retentar o pass de reparo a partir do checkpoint.',
      meta: {
        planner: 'cortex_runtime',
        model: null,
        reason: patchFirstRejected ? 'cortex_patchfirst_guardrail' : enginePlan.message || 'cortex_validation_unmet',
        runtime: CORTEX_RENDER_RUNTIME_VERSION,
        runtimeBudget,
        workGraphId: workGraph.id,
        memory: mempalaceContext,
        mempalaceCore,
        cortex: cortexContext,
        activeMemory: summarizeActiveMemory(activeMemory),
      },
    };
  }

  let validation = evaluateExecutionReadiness({
    operations: enginePlan.action.operations,
    projectRootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
    executionIntent,
    userMessage: effectiveUserMessage,
    artifactContext,
  });
  workGraph.validationResults.push(validation);
  markCortexRuntimePhase(jobId, 'cortex_validation', { score: validation.score });
  if (
    !validation.ready &&
    hasInstructionOnlyCriticalProjectFiles(projectInfo) &&
    isForgeMrpRequest({
      userMessage: effectiveUserMessage,
      contextText: artifactContext,
      workGraph,
      workingBrief: productRuntimeContract.workingBrief,
    })
  ) {
    const forgeFallbackPlan = buildForgeMrpOperationBatch({
      projectInfo,
      userMessage: effectiveUserMessage,
      attachments,
      executionIntent,
      buildOperationBatchDiffPreview,
      evaluateOperationBatchArtifactQuality,
      contextText: artifactContext,
      workGraph,
      raw: `forge_mrp_blueprint_after_validation_score:${validation.score}`,
    });
    if (forgeFallbackPlan && forgeFallbackPlan.ok && forgeFallbackPlan.action) {
      const forgeFallbackValidation = evaluateExecutionReadiness({
        operations: forgeFallbackPlan.action.operations,
        projectRootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
        executionIntent,
        userMessage: effectiveUserMessage,
        artifactContext,
      });
      if (forgeFallbackValidation.ready) {
        enginePlan = forgeFallbackPlan;
        validation = forgeFallbackValidation;
        workGraph.validationResults.push(forgeFallbackValidation);
        checkpointCortexRuntime(jobId, workGraph, runtimeBudget, {
          stage: 'forge_mrp_validation_fallback_ready',
          previousScore: workGraph.validationResults.length > 1
            ? workGraph.validationResults[workGraph.validationResults.length - 2].score
            : null,
          fallbackScore: forgeFallbackValidation.score,
        });
      }
    }
  }
  if (!validation.ready) {
    const repairValidationResult = await runRepairValidationLoop({
      projectInfo,
      userMessage: effectiveUserMessage,
      attachments,
      mempalaceContext,
      mempalaceCore,
      ragContext,
      cortexContext,
      activeMemory,
      workGraph,
      renderPass,
      enginePlan,
      validation,
      runtimeBudget,
      latestDiagnostics,
      executionIntent,
      artifactContext,
      jobId,
    });
    enginePlan = repairValidationResult.enginePlan;
    validation = repairValidationResult.validation;
    const patchFirstGuardrailHit = Boolean(repairValidationResult.patchFirstGuardrailHit);
    const patchFirstGuardrailMessage = repairValidationResult.patchFirstGuardrailMessage || '';

    if (!validation.ready) {
      if (patchFirstGuardrailHit) {
        workGraph.status = 'failed_validation';
        checkpointCortexRuntime(jobId, workGraph, runtimeBudget, { stage: 'final_validation_patchfirst_guardrail' });
        await persistCortexCheckpointToMempalace(projectInfo, workGraph, 'final_validation_patchfirst_guardrail');

        return {
          ...basePlan,
          action: null,
          response:
            'Bloqueei uma tentativa de recriar o projeto inteiro durante o loop de reparo em modo de edição incremental. Vou preservar o checkpoint para continuar com patch pontual nos arquivos existentes.',
          meta: {
            planner: 'cortex_runtime',
            model: null,
            reason: 'cortex_patchfirst_guardrail',
            runtime: CORTEX_RENDER_RUNTIME_VERSION,
            runtimeBudget,
            workGraphId: workGraph.id,
            memory: mempalaceContext,
            mempalaceCore,
            cortex: cortexContext,
            activeMemory: summarizeActiveMemory(activeMemory),
            guardrailMessage: patchFirstGuardrailMessage || null,
          },
        };
      }

      workGraph.status = 'failed_validation';
      checkpointCortexRuntime(jobId, workGraph, runtimeBudget, { stage: 'final_validation_failed' });
      await persistCortexCheckpointToMempalace(projectInfo, workGraph, 'final_validation_failed');

      const missingFilesText = Array.isArray(validation.missingRequiredFiles) && validation.missingRequiredFiles.length
        ? ` Arquivos faltantes: ${validation.missingRequiredFiles.slice(0, 8).join(', ')}.`
        : '';
      const missingDirsText = Array.isArray(validation.missingRequiredDirs) && validation.missingRequiredDirs.length
        ? ` Pastas faltantes: ${validation.missingRequiredDirs.slice(0, 8).join(', ')}.`
        : '';
      const checkLabels = {
        operations: 'operations (nenhuma operação aplicável)',
        files: 'files (artefatos base não gerados)',
        runnableEntry: 'runnableEntry (entrada executável ausente)',
        patchFirst: 'patchFirst (patch não materializado antes do texto)',
        operationContentValidity: 'operationContentValidity (conteúdo de arquivo crítico não é código/configuração válido)',
        artifactMinimum: 'artifactMinimum (qualidade visual/aderência abaixo do mínimo)',
        artifactStack: 'artifactStack (stack solicitada não preservada)',
        artifactCss: 'artifactCss (CSS visual insuficiente)',
      };
      const formatChecks = (checks) => checks.map((key) => checkLabels[key] || key).join(', ');
      const coreBlockingChecks = ['operations', 'files', 'runnableEntry', 'patchFirst', 'operationContentValidity', 'artifactMinimum'];
      const coreFailedChecks = Object.entries(validation.checks || {})
        .filter(([key, ok]) => !ok && coreBlockingChecks.includes(key))
        .map(([key]) => key);
      const nonCoreFailedChecks = Object.entries(validation.checks || {})
        .filter(([key, ok]) => !ok && !coreBlockingChecks.includes(key))
        .map(([key]) => key);
      const nonCoreFailedText = nonCoreFailedChecks.length
        ? ` Ajustes pendentes detectados em: ${nonCoreFailedChecks.join(', ')}.`
        : '';
      const scorePassed = Number(validation.score) >= Number(validation.minScore);
      const validationFailureSummary = validation.coreChecksPassed
        ? `A pontuação final ficou em ${validation.score}% (mínimo ${validation.minScore}%). Os critérios de núcleo passaram, porém ainda existem pontos de qualidade a ajustar.`
        : scorePassed
          ? `A pontuação passou (${validation.score}% de mínimo ${validation.minScore}%), mas a validação bloqueou porque checks obrigatórios falharam: ${formatChecks(coreFailedChecks.length ? coreFailedChecks : ['core_checks'])}.`
          : `A pontuação final ficou em ${validation.score}% (mínimo ${validation.minScore}%) e checks obrigatórios falharam: ${formatChecks(coreFailedChecks.length ? coreFailedChecks : ['core_checks'])}.`;

      return {
        ...basePlan,
        action: null,
        response:
          `O Cortex concluiu os passes, mas a validação técnica final não liberou a aplicação. ${validationFailureSummary}${nonCoreFailedText}${missingFilesText}${missingDirsText} O job ficou preservado para reparo orientado pelo checkpoint.`,
        meta: {
          planner: 'cortex_runtime',
          model: null,
          reason: `cortex_validation_score:${validation.score}`,
          runtime: CORTEX_RENDER_RUNTIME_VERSION,
          runtimeBudget,
          workGraphId: workGraph.id,
          memory: mempalaceContext,
          mempalaceCore,
          cortex: cortexContext,
          activeMemory: summarizeActiveMemory(activeMemory),
        },
      };
    }
  }

  const actionWithA2 = {
    ...enginePlan.action,
    cortexRuntimeVersion: CORTEX_RENDER_RUNTIME_VERSION,
    cortexValidated: true,
    workGraphId: workGraph.id,
    renderPassId: workGraph.currentPassId,
    executionValidation: validation,
    artifactContext,
    executionCommand: buildExecutionCommandFromAction(enginePlan.action),
  };
  const writeCount = actionWithA2.operations.filter((op) => op.op === 'write_file' || op.op === 'append_file').length;
  const artifactQualitySummary = validation && validation.artifactQuality
    ? ` Qualidade visual/aderência: ${validation.artifactQuality.score}% (mínimo ${validation.artifactQuality.minScore}%).`
    : '';
  const visualValidationSummary = formatVisualValidationSummary(validation);
  workGraph.status = 'awaiting_confirmation';
  workGraph.artifacts = actionWithA2.operations.map((op) => ({ op: op.op, path: op.path }));
  checkpointCortexRuntime(jobId, workGraph, runtimeBudget, { stage: 'ready_for_confirmation' });
  const mempalacePersist = await persistCortexCheckpointToMempalace(projectInfo, workGraph, 'ready_for_confirmation');

  return {
    ...basePlan,
    action: actionWithA2,
    response: [
      `Cortex renderizou o pedido em ${workGraph.passes.length} pass(es) sequenciais.`,
      `A Persona preparou ${actionWithA2.operations.length} operação(ões), com ${writeCount} arquivo(s) alterado(s).`,
      `A validação técnica marcou ${validation.score}% (mínimo ${validation.minScore}%).${artifactQualitySummary}${visualValidationSummary} Deseja aplicar esses artefatos no projeto?`,
    ].join(' '),
    meta: {
      planner: 'cortex_runtime',
      model: null,
      reason: 'cortex_render_ready',
      runtime: CORTEX_RENDER_RUNTIME_VERSION,
      runtimeBudget,
      workGraphId: workGraph.id,
      protocol: PERSONA_PROTOCOL_VERSION,
      memory: mempalaceContext,
      mempalaceCore,
      mempalacePersist,
      cortex: cortexContext,
      activeMemory: summarizeActiveMemory(activeMemory),
      personaModel: PERSONA_MODEL_BRAIN,
    },
  };
}

async function buildPlanWithCortexRuntime(projectInfo, userMessage, attachments = [], contextHint = {}, jobId = null) {
  // Novo caminho padrão: Cortex runtime único para init/edit (Persona + Automata).
  // Sem fallback legado de orquestração.
  if (projectInfo) {
    return runCortexRenderRuntimePlan({ projectInfo, userMessage, attachments, contextHint, jobId });
  }
  const basePlan = buildConfirmationPlan(projectInfo, userMessage, attachments);
  return {
    ...basePlan,
    action: null,
    response: 'Selecione um projeto antes de pedir geração/edição. O fluxo legado foi desativado e o Cortex opera apenas no runtime unificado.',
    meta: {
      planner: 'cortex_runtime',
      reason: 'missing_project_context',
      runtime: CORTEX_RENDER_RUNTIME_VERSION,
    },
  };
}


const cssRuntimeRepairService = createCssRuntimeRepairService({ fs, path });
const {
  buildCssRuntimeRepairOperationBatch,
  ensureHtmlHasStylesheetLink,
  findProjectRelativeFile,
  isCssRuntimeRepairRequest,
  isCssStylesheetRepairRequest,
  normalizeRelativeHref,
  replaceStylesheetHref,
} = cssRuntimeRepairService;

const deterministicEditService = createDeterministicEditService({
  fs,
  path,
  buildOperationBatchDiffPreview,
  normalizeRequestedRelativePath,
});
const visualHeroPatchService = createVisualHeroPatchService({
  fs,
  path,
  buildOperationBatchDiffPreview,
  normalizeRequestedRelativePath,
  resolveHeroMediaAssets: (options) => resolveBlueprintMediaAssets(options),
});

async function buildVisualStructuralFallbackOperationBatch(options = {}) {
  return visualHeroPatchService.buildHeroVisualOverlayOperationBatch(options);
}

function buildDeterministicPatchOperationBatch({ projectInfo, userMessage, attachments = [], executionIntent, localDiagnostics = null }) {
  if (executionIntent !== 'edit_project') return null;
  const contentEditPatch = deterministicEditService.buildContentEditOperationBatch({
    projectInfo,
    userMessage,
    attachments,
    executionIntent,
    localDiagnostics,
  });
  if (contentEditPatch) return contentEditPatch;

  const diagnosticsCssLinkRequest = Boolean(
    localDiagnostics &&
      ((Array.isArray(localDiagnostics.htmlFilesWithoutStylesheet) && localDiagnostics.htmlFilesWithoutStylesheet.length > 0) ||
        (Array.isArray(localDiagnostics.brokenStylesheetLinks) && localDiagnostics.brokenStylesheetLinks.length > 0))
  );
  const diagnosticsCssRuntimeRequest = Boolean(
    localDiagnostics && Array.isArray(localDiagnostics.invalidCssVarRefs) && localDiagnostics.invalidCssVarRefs.length > 0
  );
  const cssLinkRequest = isCssStylesheetRepairRequest(userMessage) || diagnosticsCssLinkRequest;
  const cssRuntimeRequest = isCssRuntimeRepairRequest(userMessage) || diagnosticsCssRuntimeRequest;
  if (!cssLinkRequest && !cssRuntimeRequest) return null;

  const projectRoot = projectInfo && projectInfo.rootPath;
  if (!projectRoot) return null;

  if (cssLinkRequest) {
    const indexRel = findProjectRelativeFile(projectRoot, projectInfo, 'index.html');
    const styleRel = findProjectRelativeFile(projectRoot, projectInfo, 'style.css');
    if (indexRel && styleRel) {
      const indexAbs = path.join(projectRoot, indexRel);
      if (fs.existsSync(indexAbs)) {
        const currentHtml = fs.readFileSync(indexAbs, 'utf8');
        const href = normalizeRelativeHref(indexRel, styleRel);
        const brokenLink =
          localDiagnostics && Array.isArray(localDiagnostics.brokenStylesheetLinks)
            ? localDiagnostics.brokenStylesheetLinks.find((item) => item && item.html === indexRel && item.href)
            : null;
        const hrefRepair = brokenLink ? replaceStylesheetHref(currentHtml, brokenLink.href, href) : { changed: false, content: currentHtml };
        const result = hrefRepair.changed ? hrefRepair : ensureHtmlHasStylesheetLink(currentHtml, href);
        if (result.changed) {
          const actionVerb = hrefRepair.changed ? 'Corrigir href quebrado' : 'Conectar';
          return {
            ok: true,
            action: {
              type: 'operation_batch',
              intent: 'edit_project',
              rootPath: projectRoot,
              targetFile: indexRel,
              operations: [
                {
                  op: 'write_file',
                  path: indexRel,
                  content: result.content,
                },
              ],
              diffPreview: `${actionVerb} ${styleRel} em ${indexRel} usando href ${href}.`,
              summary: `Corrigir o carregamento do CSS ${hrefRepair.changed ? 'substituindo o href quebrado' : 'adicionando/normalizando o link'} para ${styleRel} em ${indexRel}.`,
              userMessage,
              attachments,
              generatedBy: 'automata_static_css_link_patch',
            },
            raw: hrefRepair.changed ? 'deterministic_css_broken_href_patch' : 'deterministic_css_link_patch',
          };
        }
      }
    }
  }

  return buildCssRuntimeRepairOperationBatch({
    projectInfo,
    userMessage,
    attachments,
    executionIntent,
    reason: cssLinkRequest ? 'css_link_already_ok_css_runtime_repair' : 'css_runtime_repair',
  });
}

const aiRuntimeStatus = createAiRuntimeStatusService({
  AI_PROVIDER_OPTIONS,
  CORTEX_RAG_ENABLED,
  CORTEX_RAG_PROVIDER,
  CORTEX_RENDER_RUNTIME_VERSION,
  GEMINI_API_KEY,
  LOADED_ENV_PATHS,
  MEMPALACE_PYTHON_BIN,
  PERSONA_MODEL_BRAIN,
  R2R_BASE_URL,
  R2R_SEARCH_LIMIT,
  R2R_TIMEOUT_MS,
  RWKV_CUDA_ON: String(process.env.RWKV_CUDA_ON || '0'),
  RWKV_ENABLED,
  RWKV_JIT_ON: String(process.env.RWKV_JIT_ON || '0'),
  RWKV_MODEL_PATH,
  RWKV_PROVIDER_SCRIPT,
  RWKV_STRATEGY,
  RWKV_TOKENIZER_PATH,
  RWKV_V7_ON,
  OPENAI_API_BASE_URL,
  OPENAI_API_KEY,
  SAMBANOVA_API_BASE_URL,
  SAMBANOVA_API_KEY,
  extractJsonFromMixedText,
  getCortexRuntimeBudget,
  getEffectiveGeminiApiKey,
  getEffectiveGeminiModel,
  getEffectiveOpenAiApiKey,
  getEffectiveOpenAiModel,
  getEffectiveSambaNovaApiKey,
  getEffectiveSambaNovaModel,
  getRuntimeProfileSettings,
  getSelectedAiProvider,
  getSelectedCustomApiProfile,
  maskApiKeyTail,
  os,
  readAiRuntimeSettings,
  resolveCustomApiEndpoint,
  resolveCustomProviderKind,
  runCommand,
});

const getAiRuntimeStatus = aiRuntimeStatus.getStatus;


let automataExecutorInstance = null;
let faberCapabilityAdapterServiceInstance = null;
let agenticToolLoopServiceInstance = null;
let projectVerifiedExecutionServiceInstance = null;
let toolRegistryInstance = null;
const activeExecutionControllersByJobId = new Map();

function createExecutionCancelledError(jobId = '') {
  const error = new Error('Ação cancelada pelo usuário. Nenhum arquivo foi alterado.');
  error.code = 'job_cancelled';
  error.jobId = jobId || null;
  return error;
}

function beginActiveJobExecution(jobId = '') {
  if (!jobId || typeof AbortController === 'undefined') return null;
  const existing = activeExecutionControllersByJobId.get(jobId);
  if (existing && existing.controller && !existing.controller.signal.aborted) {
    existing.controller.abort();
  }
  const controller = new AbortController();
  activeExecutionControllersByJobId.set(jobId, {
    controller,
    startedAt: new Date().toISOString(),
  });
  return controller;
}

function endActiveJobExecution(jobId = '', controller = null) {
  if (!jobId) return;
  const current = activeExecutionControllersByJobId.get(jobId);
  if (!current) return;
  if (!controller || current.controller === controller) {
    activeExecutionControllersByJobId.delete(jobId);
  }
}

function abortActiveJobExecution(jobId = '', reason = 'cancelled_by_user') {
  if (!jobId) return { ok: false, aborted: false, message: 'jobId é obrigatório.' };
  const current = activeExecutionControllersByJobId.get(jobId);
  if (!current || !current.controller) {
    return { ok: true, aborted: false, reason };
  }
  try {
    current.controller.abort();
  } catch {
    // best effort cancellation
  }
  return { ok: true, aborted: true, reason };
}

function assertJobExecutionNotCancelled(jobId = '', signal = null) {
  if (!jobId) return;
  if (isJobCancelled(jobId) || (signal && signal.aborted)) {
    throw createExecutionCancelledError(jobId);
  }
}

function getAutomataExecutor() {
  if (!automataExecutorInstance) {
    automataExecutorInstance = createAutomataExecutor({
      computeLineChangeStats,
      excludedDirs: EXCLUDED_DIRS,
      fs,
      hashText,
      ingestRuntimeDiffStats,
      isTextLikeExtension,
      mergeDiffStatsEntry,
      normalizeRelativePathForDiff,
      normalizeRequestedRelativePath,
      path,
      validateExecutionCommand,
    });
  }
  return automataExecutorInstance;
}

function getFaberCapabilityAdapterService() {
  if (!faberCapabilityAdapterServiceInstance) {
    const externalMcpRegistry = externalMcpServerRegistryService.listServers({ includeSecrets: true });
    faberCapabilityAdapterServiceInstance = createFaberCapabilityAdapterService({
      captureProjectPreview: projectVisualCaptureService.captureProjectPreview,
      fs,
      getProjectGitStatus,
      getProjectPreviewRuntimeStatus,
      path,
      scanProject,
      startProjectPreview,
      stopProjectPreview,
      deterministicEditService,
      externalMcpServers: externalMcpRegistry.servers || [],
      automataContractLedgerService,
      appendAuditEvent,
      appendJobEvent,
      setJobCheckpoint,
      terminalService: projectTerminalService,
    });
  }
  return faberCapabilityAdapterServiceInstance;
}

function resetFaberCapabilityRuntime() {
  if (faberCapabilityAdapterServiceInstance && typeof faberCapabilityAdapterServiceInstance.closeExternalMcpTransports === 'function') {
    faberCapabilityAdapterServiceInstance.closeExternalMcpTransports();
  }
  faberCapabilityAdapterServiceInstance = null;
  agenticToolLoopServiceInstance = null;
  toolRegistryInstance = null;
}

function getToolRegistry() {
  if (!toolRegistryInstance) {
    toolRegistryInstance = createToolRegistry();
    for (const tool of createAutomataTools(getAutomataExecutor())) {
      toolRegistryInstance.register(tool);
    }
    for (const tool of createCapabilityTools(getFaberCapabilityAdapterService())) {
      toolRegistryInstance.register(tool);
    }
  }
  return toolRegistryInstance;
}

function executePatchAction(action) {
  return getToolRegistry().execute('automata.apply_file_patch', action);
}

function executeOperationBatchAction(action) {
  return getToolRegistry().execute('automata.execute_operation_batch', action);
}

function executeSearchTextAction(action) {
  return getToolRegistry().execute('automata.search_text_in_files', action);
}

function executeAction(action) {
  return getToolRegistry().execute('automata.execute_action', action);
}

function getAgenticToolLoopService() {
  if (!agenticToolLoopServiceInstance) {
    agenticToolLoopServiceInstance = createAgenticToolLoopService({
      appendAuditEvent,
      appendJobEvent,
      executeCapability: (input) => getFaberCapabilityAdapterService().executeCapability(input),
      executeTool: (name, input) => getToolRegistry().execute(name, input),
      getEffectiveGeminiModel,
      getEffectiveOpenAiModel,
      getSelectedAiProvider,
      requestModelTurn: requestAgenticModelTurn,
      setJobCheckpoint,
      shouldUseModel: shouldUseOpenAiResponsesApi,
    });
  }
  return agenticToolLoopServiceInstance;
}

function buildAgenticExecutionPlan(payload = {}) {
  return getAgenticToolLoopService().buildExecutionPlan(payload);
}

function getProjectVerifiedExecutionService() {
  if (!projectVerifiedExecutionServiceInstance) {
    projectVerifiedExecutionServiceInstance = createProjectVerifiedExecutionService({
      crypto,
      executeAction,
      fs,
      os,
      path,
      runProjectVerification,
      runProjectVisualValidation,
      scanProject,
    });
  }
  return projectVerifiedExecutionServiceInstance;
}

const runtimeDiffStatsByRoot = new Map();

function normalizeRelativePathForDiff(value) {
  return String(value || '').replace(/^\/+/, '').split('\\').join('/');
}

function computeLineChangeStats(beforeText, afterText) {
  const beforeLines = String(beforeText || '').replace(/\r\n/g, '\n').split('\n');
  const afterLines = String(afterText || '').replace(/\r\n/g, '\n').split('\n');

  let changed = 0;
  const shared = Math.min(beforeLines.length, afterLines.length);
  for (let i = 0; i < shared; i += 1) {
    if (beforeLines[i] !== afterLines[i]) changed += 1;
  }

  const addedTail = Math.max(0, afterLines.length - beforeLines.length);
  const deletedTail = Math.max(0, beforeLines.length - afterLines.length);

  const add = changed + addedTail;
  const del = changed + deletedTail;
  return { add, del };
}

function mergeDiffStatsEntry(target, relPath, entry) {
  const normalizedPath = normalizeRelativePathForDiff(relPath);
  if (!normalizedPath || !entry) return;
  const add = Math.max(0, Number(entry.add) || 0);
  const del = Math.max(0, Number(entry.del) || 0);
  if (add <= 0 && del <= 0) return;

  const previous = target[normalizedPath] || { add: 0, del: 0 };
  target[normalizedPath] = {
    add: Math.max(Number(previous.add) || 0, add),
    del: Math.max(Number(previous.del) || 0, del),
  };
}

const projectGitService = createProjectGitService({
  mergeDiffStatsEntry,
  normalizeRelativePathForDiff,
  runCommand,
});
const {
  commitProjectGitFiles,
  collectGitDiffFirstLines,
  collectGitDiffStats,
  getProjectGitWorktree,
  getProjectGitStatus,
  initProjectGitRepository,
  stageProjectGitFiles,
} = projectGitService;

const githubIntegrationService = createGithubIntegrationService({
  fs,
  path,
  runCommand,
});
const {
  buildGithubPublishPlan,
  executeGithubPublish,
  getGithubAuthStatus,
  cloneGithubRepository,
  listGithubRepositories,
} = githubIntegrationService;

function ingestRuntimeDiffStats(rootPath, diffStats) {
  const safeRoot = path.resolve(String(rootPath || ''));
  if (!safeRoot || !diffStats || typeof diffStats !== 'object') return;

  const previous = runtimeDiffStatsByRoot.get(safeRoot) || {};
  const merged = { ...previous };
  for (const [relPath, stat] of Object.entries(diffStats)) {
    mergeDiffStatsEntry(merged, relPath, stat);
  }
  runtimeDiffStatsByRoot.set(safeRoot, merged);
}

function getRuntimeDiffStats(rootPath) {
  const safeRoot = path.resolve(String(rootPath || ''));
  return runtimeDiffStatsByRoot.get(safeRoot) || {};
}

function buildNextSteps(projectInfo) {
  return buildProjectNextSteps(projectInfo);
}

function formatVisualValidationSummary(validation = null) {
  const visual = validation && validation.visualValidation ? validation.visualValidation : null;
  if (!visual || !visual.required || visual.status === 'not_required') return '';
  return ` Validação visual: ${visual.summary}`;
}

let personaOrchestratorInstance = null;

function getPersonaOrchestrator() {
  if (!personaOrchestratorInstance) {
    personaOrchestratorInstance = createPersonaOrchestrator({
      appendAuditEvent,
      appendJobEvent,
      appendMemoryEvidence,
      buildAgenticExecutionPlan,
      buildAiProviderFailureMessage,
      buildConversationOnlyPlan,
      buildPlanWithCortexRuntime,
      clipText,
      createAssistantJob,
      getSelectedAiProvider,
      isAiRetryableReason,
      markJobCompleted,
      markJobFailed,
      markJobPausedForMemory,
      markJobPhase,
      markJobRetryPending,
      requestDirectPersonaChat,
      requestPersonaRouteDecision,
      resolveActiveMemoryContext,
      resolveProductRoute,
      runtimeVersion: CORTEX_RENDER_RUNTIME_VERSION,
      setJobCheckpoint,
      summarizeActiveMemory,
      suggestAutomataContract: (input, options) => automataContractLedgerService.suggestContract(input, options),
    });
  }
  return personaOrchestratorInstance;
}

function appendAssistantRouteAudit(route, projectInfo) {
  return getPersonaOrchestrator().appendAssistantRouteAudit(route, projectInfo);
}

async function buildAssistantPlanResponse(payload = {}) {
  return getPersonaOrchestrator().buildAssistantPlanResponse(payload);
}

async function handleAssistantMessage(payload = {}) {
  return getPersonaOrchestrator().handleAssistantMessage(payload);
}

async function resolveAssistantRouteDecision(payload = {}) {
  return getPersonaOrchestrator().resolveAssistantRouteDecision(payload);
}

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, 'assets', 'logo_faber.png'),
    path.join(__dirname, 'build', 'icon.png'),
    path.join(process.cwd(), 'assets', 'logo_faber.png'),
    path.join(process.cwd(), 'build', 'icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let mainWindow = null;
let ipcSecurityInstance = null;
let projectAccessInstance = null;

function getIpcSecurity() {
  if (!ipcSecurityInstance) {
    ipcSecurityInstance = createIpcSecurity({
      getMainWindow: () => mainWindow,
    });
  }
  return ipcSecurityInstance;
}

function getProjectAccess() {
  if (!projectAccessInstance) {
    projectAccessInstance = createProjectAccess({
      fs,
      path,
      readProjectsSnapshot,
      scanProject,
    });
  }
  return projectAccessInstance;
}

function registerIpcHandler(channel, handler) {
  ipcMain.handle(channel, getIpcSecurity().wrapHandler(handler));
}

function authorizeProjectRoot(rootPath) {
  return getProjectAccess().authorizeRootPath(rootPath);
}

function normalizeAuthorizedProjectInfo(projectInfo) {
  return getProjectAccess().normalizeProjectInfo(projectInfo);
}

function resolveAuthorizedProjectPath(projectInfo, relativePath) {
  const project = normalizeAuthorizedProjectInfo(projectInfo);
  if (!project.ok) return project;
  return getProjectAccess().resolveInsideRoot(project.projectInfo.rootPath, relativePath);
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    show: false,
    width: 1420,
    height: 900,
    minWidth: 1180,
    minHeight: 740,
    title: 'Faber Code',
    icon: resolveAppIconPath() || undefined,
    backgroundColor: '#00000000',
    transparent: isMac,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    frame: true,
    titleBarStyle: 'hiddenInset',
    titleBarOverlay: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = normalizeExternalUrl(url);
    if (externalUrl.ok) {
      shell.openExternal(externalUrl.url).catch(() => {});
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (isMac) {
      win.setWindowButtonVisibility(true);
    }
    win.show();
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

app.whenReady().then(() => {
  app.setName('Faber Code');
  const dockIconPath = resolveAppIconPath();
  if (process.platform === 'darwin' && dockIconPath && app.dock && typeof app.dock.setIcon === 'function') {
    try {
      app.dock.setIcon(dockIconPath);
    } catch {}
  }

  registerAccountHandlers({
    accountService: platformAccountService,
    appendAuditEvent,
    emitAccountEvent: (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('account:event', payload);
      }
    },
    normalizeExternalUrl,
    registerIpcHandler,
    shell,
  });
  platformBackendService.start().catch((error) => {
    appendAuditEvent('platform_backend.start_failed', {
      message: error && error.message ? error.message : String(error || ''),
    });
  });

  registerProjectHandlers({
    appendAuditEvent,
    authorizeProjectRoot,
    buildNextSteps,
    buildProjectPreviewPlan,
    buildProjectVerificationPlan,
    commitProjectGitFiles,
    collectGitDiffFirstLines,
    collectGitDiffStats,
    collectProjectFilesTree,
    dialog,
    fs,
    getProjectGitWorktree,
    getProjectGitStatus,
    getRuntimeDiffStats,
    initProjectGitRepository,
    mergeDiffStatsEntry,
    normalizeExternalUrl,
    normalizeProjectRecord,
    path,
    readProjectsByState,
    readProjectsSnapshot,
    registerIpcHandler,
    removeProjectConversationHistory,
    runProjectVerification,
    scanProject,
    shell,
    stageProjectGitFiles,
    writeProjectsSnapshot,
  });

  registerGithubHandlers({
    appendAuditEvent,
    authorizeProjectRoot,
    buildGithubPublishPlan,
    cloneGithubRepository,
    executeGithubPublish,
    getGithubAuthStatus,
    listGithubRepositories,
    path,
    registerIpcHandler,
    scanProject,
  });

  registerPreviewHandlers({
    appendAuditEvent,
    authorizeProjectRoot,
    getProjectPreviewRuntimeStatus,
    normalizePreviewOpenUrl,
    registerIpcHandler,
    scanProject,
    shell,
    startProjectPreview,
    stopProjectPreview,
  });

  registerTerminalHandlers({
    appendAuditEvent,
    authorizeProjectRoot,
    registerIpcHandler,
    terminalService: projectTerminalService,
  });

  registerAutomataContractHandlers({
    appendAuditEvent,
    ledgerService: automataContractLedgerService,
    normalizeAuthorizedProjectInfo,
    registerIpcHandler,
  });

  registerExternalMcpHandlers({
    appendAuditEvent,
    authorizeProjectRoot,
    discoveryCacheService: externalMcpDiscoveryCacheService,
    presetRegistryService: externalMcpPresetRegistryService,
    registryService: externalMcpServerRegistryService,
    registerIpcHandler,
    resetCapabilityRuntime: resetFaberCapabilityRuntime,
  });

  registerIpcHandler('window:toggle-maximize', () => {
    const targetWindow = BrowserWindow.getFocusedWindow() || mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return { ok: false, message: 'Janela principal indisponível.' };
    }
    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }
    return { ok: true, maximized: targetWindow.isMaximized() };
  });

  registerIpcHandler('assistant:route', async (_, payload) => {
    const { projectInfo, userMessage, attachments, contextHint, conversationMessages } = payload || {};
    const project = normalizeAuthorizedProjectInfo(projectInfo);
    if (!project.ok) return project;
    return resolveAssistantRouteDecision({
      projectInfo: project.projectInfo,
      userMessage: userMessage || '',
      attachments: attachments || [],
      contextHint: contextHint || null,
      conversationMessages: conversationMessages || [],
    });
  });

  registerIpcHandler('assistant:plan', async (_, payload) => {
    const project = normalizeAuthorizedProjectInfo(payload && payload.projectInfo ? payload.projectInfo : null);
    if (!project.ok) return project;
    return buildAssistantPlanResponse({ ...(payload || {}), projectInfo: project.projectInfo });
  });

  registerIpcHandler('assistant:message', async (_, payload) => {
    const project = normalizeAuthorizedProjectInfo(payload && payload.projectInfo ? payload.projectInfo : null);
    if (!project.ok) return project;
    return handleAssistantMessage({ ...(payload || {}), projectInfo: project.projectInfo });
  });

  registerIpcHandler('tools:list', () => {
    return { ok: true, tools: getToolRegistry().list() };
  });

  registerIpcHandler('assistant:execute', async (_, action, projectInfo) => {
    const project = normalizeAuthorizedProjectInfo(projectInfo || null);
    if (!project.ok) return project;
    projectInfo = project.projectInfo;
    const initialAction = bindActionToAuthorizedProject(action, projectInfo);
    const jobId = initialAction && initialAction.jobId ? initialAction.jobId : null;
    if (isJobCancelled(jobId)) {
      return { ok: false, message: 'Ação cancelada pelo usuário. Nenhum arquivo foi alterado.' };
    }
    if (jobId) {
      markJobPhase(jobId, 'execute_pending', {
        hasExecutionCommand: Boolean(initialAction && initialAction.executionCommand),
      });
      setJobCheckpoint(jobId, 'execute_payload', {
        actionType: initialAction && initialAction.type ? initialAction.type : null,
        hasExecutionCommand: Boolean(initialAction && initialAction.executionCommand),
      });
    }
    const executionController = beginActiveJobExecution(jobId);
    const executionSignal = executionController ? executionController.signal : null;

    try {
      assertJobExecutionNotCancelled(jobId, executionSignal);
      const rootPath = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
      const autoRepairMaxPasses = Math.max(0, Math.min(5, Number.isFinite(Number(AUTO_REPAIR_MAX_PASSES)) ? Number(AUTO_REPAIR_MAX_PASSES) : 0));
      const originalUserMessage = initialAction && typeof initialAction.userMessage === 'string' ? initialAction.userMessage : '';
      const originalAttachments = initialAction && Array.isArray(initialAction.attachments) ? initialAction.attachments : [];

      if (initialAction && initialAction.type === 'agentic_tool_loop') {
        if (jobId) {
          markJobPhase(jobId, 'execute_pending', {
            mode: 'agentic_tool_loop',
          });
          appendJobEvent(jobId, 'job.agentic_execution_started', {
            provider: getSelectedAiProvider(),
            model: getEffectiveOpenAiModel(),
          });
        }
        const agenticResult = await getAgenticToolLoopService().executeAction(initialAction, projectInfo, { jobId });
        const refreshed = scanProject(rootPath);
        const finalResult = {
          ...agenticResult,
          projectInfo: refreshed,
          nextSteps: buildNextSteps(refreshed),
        };

        if (agenticResult && agenticResult.ok) {
          const requiresMaterialChange = actionRequiresMaterialChange(initialAction);
          const changedFiles = Array.isArray(agenticResult.modifiedFiles) ? agenticResult.modifiedFiles : [];
          if (requiresMaterialChange && changedFiles.length === 0) {
            const blocked = {
              ...finalResult,
              ok: false,
              status: 'blocked',
              message: 'A execução terminou sem criar ou alterar arquivos.',
              errors: ['agentic_no_file_changes'],
            };
            if (jobId) {
              markJobFailed(jobId, 'agentic_no_file_changes', 'execute_validation');
            }
            appendAuditEvent('assistant.agentic_execute_failed', {
              rootPath,
              jobId,
              message: 'agentic_no_file_changes',
            });
            return blocked;
          }

          if (jobId) {
            setJobCheckpoint(jobId, 'execute_result', {
              ok: true,
              agentic: true,
              modifiedFiles: changedFiles,
              toolRuns: Array.isArray(agenticResult.toolRuns) ? agenticResult.toolRuns.slice(0, 20) : [],
            });
            markJobCompleted(jobId, {
              agentic: true,
              modifiedFiles: changedFiles,
            });
          }
          appendAuditEvent('assistant.agentic_execute_success', {
            rootPath,
            jobId,
            modifiedFiles: changedFiles,
            toolRuns: Array.isArray(agenticResult.toolRuns) ? agenticResult.toolRuns.length : 0,
          });
          return finalResult;
        }

        if (jobId) {
          markJobFailed(jobId, agenticResult && agenticResult.message ? agenticResult.message : 'agentic_execute_failed', 'execute_failed');
        }
        appendAuditEvent('assistant.agentic_execute_failed', {
          rootPath,
          jobId,
          message: agenticResult && agenticResult.message ? agenticResult.message : 'agentic_execute_failed',
        });
        return finalResult;
      }

      let currentAction = initialAction;
      let currentProjectInfo = projectInfo;
      let autoRepairAttempt = 0;

      while (true) {
        assertJobExecutionNotCancelled(jobId, executionSignal);
        if (jobId) {
          appendJobEvent(jobId, 'job.execute_pass_started', {
            executionPass: autoRepairAttempt + 1,
            totalPlannedPasses: autoRepairMaxPasses + 1,
            targetFile: currentAction && currentAction.targetFile ? currentAction.targetFile : null,
            intent: currentAction && currentAction.intent ? currentAction.intent : null,
          });
        }

        const verifiedExecutionRequired = shouldVerifyProjectAction(currentAction);
        if (jobId && verifiedExecutionRequired) {
          markJobPhase(jobId, 'execute_staging', {
            executionPass: autoRepairAttempt + 1,
            requiredCommands: ['build', 'test', 'playwright_if_available'],
            visualSmoke: true,
          });
          appendJobEvent(jobId, 'job.verified_execution_started', {
            executionPass: autoRepairAttempt + 1,
            requiredCommands: ['npm run build', 'npm test', 'playwright when available'],
            visualSmoke: true,
          });
        }

        const result = await getProjectVerifiedExecutionService().executeVerified(currentAction, currentProjectInfo, {
          userMessage: originalUserMessage,
          executionIntent: currentAction && currentAction.intent ? currentAction.intent : '',
          artifactContext: currentAction && currentAction.artifactContext ? currentAction.artifactContext : '',
          verificationOptions: {
            requiredNodeScripts: ['build', 'test'],
            requirePlaywright: 'if_available',
            signal: executionSignal,
            userMessage: originalUserMessage,
            acceptanceContext: currentAction && currentAction.summary ? currentAction.summary : '',
            requirePersistence: /\b(postgres|postgresql|prisma|banco|database|persist[eê]ncia|persistir|migration|seed)\b/i.test(
              `${originalUserMessage || ''}\n${currentAction && currentAction.summary ? currentAction.summary : ''}`
            ),
          },
          visualOptions: {
            enabled: true,
            force: true,
            timeoutMs: 90000,
            previewOptions: {
              stopAfterCapture: true,
            },
          },
        });
        assertJobExecutionNotCancelled(jobId, executionSignal);
        if (jobId && verifiedExecutionRequired) {
          appendJobEvent(jobId, 'job.verified_execution_finished', {
            executionPass: autoRepairAttempt + 1,
            ok: Boolean(result && result.ok),
            promoted: Boolean(result && result.promoted),
            staged: Boolean(result && result.staged),
            commandResults: Array.isArray(result && result.commandResults)
              ? result.commandResults.slice(0, 12)
              : [],
            visualStatus:
              result && result.visualValidation && result.visualValidation.status
                ? result.visualValidation.status
                : 'not_run',
          });
        }
        if (!result.ok) {
          const stagedDiagnostics = buildDiagnosticsHintFromVerifiedExecution(result);
          const canAutoRepairStagedFailure =
            verifiedExecutionRequired &&
            result &&
            result.staged &&
            result.promoted === false &&
            AUTO_REPAIR_ENABLED &&
            autoRepairAttempt < autoRepairMaxPasses &&
            Boolean(String(originalUserMessage || '').trim()) &&
            stagedDiagnostics &&
            Array.isArray(stagedDiagnostics.issues) &&
            stagedDiagnostics.issues.length > 0;

          if (canAutoRepairStagedFailure) {
            const gateReason = 'verified_execution_failed';
            const refreshed = scanProject(rootPath);
            autoRepairAttempt += 1;
            if (jobId) {
              markJobPhase(jobId, 'cortex_validation', {
                autoRepairAttempt,
                maxAutoRepairPasses: autoRepairMaxPasses,
                reason: gateReason,
              });
              appendJobEvent(jobId, 'job.execute_validation_blocked', {
                reason: gateReason,
                blockedBy: 'verified_execution',
                diagnosticsCount: stagedDiagnostics.issues.length,
                autoRepairAttempt,
                promoted: false,
              });
              appendJobEvent(jobId, 'job.auto_repair_planning', {
                autoRepairAttempt,
                maxAutoRepairPasses: autoRepairMaxPasses,
                reason: gateReason,
                blockedBy: 'verified_execution',
              });
            }
            appendAuditEvent('assistant.execute_staging_blocked', {
              rootPath,
              jobId,
              message: result.message,
              commandResults: Array.isArray(result.commandResults) ? result.commandResults.slice(0, 12) : [],
              visualValidationStatus:
                result && result.visualValidation && result.visualValidation.status
                  ? result.visualValidation.status
                  : null,
              autoRepairAttempt,
            });

            assertJobExecutionNotCancelled(jobId, executionSignal);
            const repairPlan = await buildPlanWithCortexRuntime(
              refreshed,
              originalUserMessage,
              originalAttachments,
              {
                mode: 'auto_repair',
                latestDiagnostics: stagedDiagnostics,
                lastPlanner: 'cortex_runtime',
                lastIntent: currentAction && currentAction.intent ? currentAction.intent : 'edit_project',
                lastReason: gateReason,
                lastHadAction: true,
              },
              jobId
            );
            assertJobExecutionNotCancelled(jobId, executionSignal);

            if (!(repairPlan && repairPlan.ok && repairPlan.action)) {
              if (jobId) {
                appendJobEvent(jobId, 'job.auto_repair_plan_failed', {
                  autoRepairAttempt,
                  reason: repairPlan && repairPlan.meta && repairPlan.meta.reason
                    ? repairPlan.meta.reason
                    : gateReason,
                  blockedBy: 'verified_execution',
                });
                const retryMarked = markJobRetryPending(jobId, gateReason, 'execute_validation');
                if (retryMarked.ok && retryMarked.job && retryMarked.job.retryState && retryMarked.job.retryState.retryable === false) {
                  markJobFailed(jobId, gateReason, 'execute_validation_retry_exhausted');
                }
              }
              const repairMessage = repairPlan && repairPlan.response
                ? String(repairPlan.response)
                : 'Não consegui montar um plano de reparo automático nesta rodada.';
              return {
                ...result,
                ok: false,
                message: `${result.message || 'A validação verificada bloqueou a promoção.'}\n${repairMessage}`,
                projectInfo: refreshed,
                nextSteps: buildNextSteps(refreshed),
                blockedByVerifiedExecution: true,
                latestDiagnostics: stagedDiagnostics,
                autoRepairAttempt,
              };
            }

            currentAction = bindActionToAuthorizedProject({
              ...repairPlan.action,
              userMessage: originalUserMessage,
              attachments: originalAttachments,
              artifactContext: currentAction && currentAction.artifactContext ? currentAction.artifactContext : '',
              jobId,
            }, refreshed);
            if (jobId) {
              appendJobEvent(jobId, 'job.auto_repair_plan_ready', {
                autoRepairAttempt,
                targetFile: currentAction && currentAction.targetFile ? currentAction.targetFile : null,
                intent: currentAction && currentAction.intent ? currentAction.intent : null,
                protocol:
                  currentAction &&
                  currentAction.executionCommand &&
                  currentAction.executionCommand.protocol
                    ? currentAction.executionCommand.protocol
                    : 'unknown',
                blockedBy: 'verified_execution',
              });
            }
            currentProjectInfo = refreshed;
            continue;
          }

          if (jobId) {
            const message = String(result.message || 'execution_rejected');
            if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('abort')) {
              const retryMarked = markJobRetryPending(jobId, message, 'execute_pending');
              if (retryMarked.ok && retryMarked.job && retryMarked.job.retryState && retryMarked.job.retryState.retryable === false) {
                markJobFailed(jobId, message, 'execute_retry_exhausted');
              }
            } else {
              markJobFailed(jobId, message, 'execute_failed');
            }
          }
          appendAuditEvent('assistant.execute_rejected', {
            rootPath: currentProjectInfo ? currentProjectInfo.rootPath : null,
            jobId,
            message: result.message,
            protocol:
              currentAction && currentAction.executionCommand && currentAction.executionCommand.protocol
                ? currentAction.executionCommand.protocol
                : 'unknown',
            autoRepairAttempt,
          });
          return result;
        }

        const refreshed = scanProject(rootPath);
        assertJobExecutionNotCancelled(jobId, executionSignal);
        const qualityReport = await runPostExecutionQualityReport(refreshed, {
          modifiedFiles: result.modifiedFiles || [],
          userMessage: originalUserMessage,
          attachments: originalAttachments,
          executionIntent: currentAction && currentAction.intent ? currentAction.intent : '',
          artifactContext: currentAction && currentAction.artifactContext ? currentAction.artifactContext : '',
        });
        assertJobExecutionNotCancelled(jobId, executionSignal);
        const visualValidationReport = await runProjectVisualValidation(refreshed, {
          action: currentAction,
          userMessage: originalUserMessage,
          executionIntent: currentAction && currentAction.intent ? currentAction.intent : '',
          artifactContext: currentAction && currentAction.artifactContext ? currentAction.artifactContext : '',
        });
        assertJobExecutionNotCancelled(jobId, executionSignal);
        if (qualityReport && visualValidationReport && visualValidationReport.required) {
          qualityReport.visualValidation = visualValidationReport;
          qualityReport.summary = {
            ...(qualityReport.summary || {}),
            visualValidation: {
              status: visualValidationReport.status,
              summary: visualValidationReport.summary,
              captureStatus: visualValidationReport.capture ? visualValidationReport.capture.status : 'not_run',
              artifactPath: visualValidationReport.capture ? visualValidationReport.capture.artifactPath : '',
              artifactPaths: visualValidationReport.capture && Array.isArray(visualValidationReport.capture.artifactPaths)
                ? visualValidationReport.capture.artifactPaths
                : [],
              viewportCount: visualValidationReport.capture ? Number(visualValidationReport.capture.viewportCount || 0) : 0,
              productCoverage: visualValidationReport.capture && visualValidationReport.capture.productCoverage
                ? {
                    passesMinimum: Boolean(visualValidationReport.capture.productCoverage.passesMinimum),
                    score: Number(visualValidationReport.capture.productCoverage.score || 0),
                    summary: visualValidationReport.capture.productCoverage.summary || '',
                  }
                : null,
            },
          };
        }
        if (jobId) {
          appendJobEvent(jobId, 'job.execute_pass_finished', {
            executionPass: autoRepairAttempt + 1,
            modifiedFilesCount: Array.isArray(result.modifiedFiles) ? result.modifiedFiles.length : 0,
            modifiedFiles: Array.isArray(result.modifiedFiles) ? result.modifiedFiles.slice(0, 20) : [],
          });
        }
        const executionReport = buildExecutionOutcomeReport(result, qualityReport);
        const effectGate = evaluateExecutionEffectGate(currentAction, result, executionReport);
        const qualityGate = evaluatePostExecutionGate(qualityReport);
        const visualGate = evaluateVisualValidationGate(visualValidationReport);

        if (!effectGate.shouldBlock && !qualityGate.shouldBlock && !visualGate.shouldBlock) {
          if (jobId) {
            setJobCheckpoint(jobId, 'execute_result', {
              ok: true,
              modifiedFiles: result.modifiedFiles || [],
              message: result.message || null,
              qualitySummary: qualityReport && qualityReport.summary ? qualityReport.summary : null,
              visualValidation: visualValidationReport || null,
              executionReport,
              autoRepairAttempt,
            });
            markJobCompleted(jobId, {
              modifiedFiles: result.modifiedFiles || [],
              qualitySummary: qualityReport && qualityReport.summary ? qualityReport.summary : null,
              visualValidation: visualValidationReport || null,
              executionReport,
              autoRepairAttempt,
            });
          }
          appendAuditEvent('assistant.execute_success', {
            rootPath,
            jobId,
            modifiedFiles: result.modifiedFiles || [],
            protocol:
              currentAction && currentAction.executionCommand && currentAction.executionCommand.protocol
                ? currentAction.executionCommand.protocol
                : 'unknown',
            personaModel: PERSONA_MODEL_BRAIN,
            qualitySummary: qualityReport && qualityReport.summary ? qualityReport.summary : null,
            visualValidationStatus: visualValidationReport && visualValidationReport.status ? visualValidationReport.status : null,
            diffTotals: executionReport && executionReport.totals ? executionReport.totals : null,
            autoRepairAttempt,
          });
          return {
            ...result,
            projectInfo: refreshed,
            nextSteps: buildNextSteps(refreshed),
            qualityReport,
            visualValidation: visualValidationReport,
            executionReport,
            autoRepairAttempt,
          };
        }

        const blockedByEffectGate = effectGate.shouldBlock;
        const blockedByQualityGate = qualityGate.shouldBlock;
        const blockedByVisualGate = visualGate.shouldBlock;
        const blockedBy = blockedByEffectGate
          ? 'execution_effect'
          : blockedByQualityGate
            ? 'post_exec_quality'
            : 'visual_validation';
        const gateMessage = blockedByEffectGate
          ? buildExecutionEffectGateMessage(effectGate)
          : blockedByQualityGate
            ? buildPostExecutionGateMessage(qualityGate)
            : buildVisualValidationGateMessage(visualGate);
        const gateReason = blockedByEffectGate
          ? effectGate.reason
          : blockedByQualityGate
            ? qualityGate.reason
            : visualGate.reason;

        if (jobId) {
          const summary = qualityReport && qualityReport.summary ? qualityReport.summary : {};
          appendJobEvent(jobId, 'job.execute_validation_blocked', {
            reason: gateReason,
            errors: Number(summary.errors || 0),
            warnings: Number(summary.warnings || 0),
            filesChecked: Number(summary.filesChecked || 0),
            modifiedFilesCount: Number(effectGate.modifiedFilesCount || 0),
            totalDelta: Number(effectGate.totalDelta || 0),
            blockedBy,
            autoRepairAttempt,
          });
        }
        if (blockedByEffectGate && jobId) {
          appendJobEvent(jobId, 'job.execute_effect_blocked', {
            reason: effectGate.reason,
            taskType: effectGate.taskType || 'unknown',
            modifiedFilesCount: Number(effectGate.modifiedFilesCount || 0),
            totalDelta: Number(effectGate.totalDelta || 0),
            autoRepairAttempt,
          });
        }
        appendAuditEvent('assistant.execute_quality_blocked', {
          rootPath,
          jobId,
          modifiedFiles: result.modifiedFiles || [],
          qualitySummary: qualityReport && qualityReport.summary ? qualityReport.summary : null,
          reason: gateReason,
          blockedBy,
          modifiedFilesCount: Number(effectGate.modifiedFilesCount || 0),
          totalDelta: Number(effectGate.totalDelta || 0),
          autoRepairAttempt,
        });

        const canAutoRepair =
          AUTO_REPAIR_ENABLED &&
          autoRepairAttempt < autoRepairMaxPasses &&
          Boolean(String(originalUserMessage || '').trim()) &&
          !(blockedByVisualGate && visualGate && visualGate.autoRepairable === false);

        if (!canAutoRepair) {
          if (jobId) {
            setJobCheckpoint(jobId, 'execute_result', {
              ok: false,
              blockedByPostExecutionValidation: true,
            modifiedFiles: result.modifiedFiles || [],
            qualitySummary: qualityReport && qualityReport.summary ? qualityReport.summary : null,
            executionReport,
            visualValidation: visualValidationReport || null,
            reason: gateReason,
            blockedBy,
            modifiedFilesCount: Number(effectGate.modifiedFilesCount || 0),
            totalDelta: Number(effectGate.totalDelta || 0),
            autoRepairAttempt,
          });
          const retryMarked = markJobRetryPending(jobId, gateReason, 'execute_validation');
            if (retryMarked.ok && retryMarked.job && retryMarked.job.retryState && retryMarked.job.retryState.retryable === false) {
              markJobFailed(jobId, gateReason, 'execute_validation_retry_exhausted');
            }
          }
          return {
            ok: false,
            message: gateMessage || 'A validação técnica pós-execução bloqueou a conclusão desta rodada.',
            projectInfo: refreshed,
            nextSteps: buildNextSteps(refreshed),
            modifiedFiles: result.modifiedFiles || [],
            qualityReport,
            executionReport,
            visualValidation: visualValidationReport,
            blockedByExecutionEffect: blockedByEffectGate,
            blockedByVisualValidation: blockedByVisualGate,
            blockedByPostExecutionValidation: true,
            autoRepairAttempt,
          };
        }

        autoRepairAttempt += 1;
        if (jobId) {
          markJobPhase(jobId, 'cortex_validation', {
            autoRepairAttempt,
            maxAutoRepairPasses: autoRepairMaxPasses,
            reason: gateReason,
          });
          appendJobEvent(jobId, 'job.auto_repair_planning', {
            autoRepairAttempt,
            maxAutoRepairPasses: autoRepairMaxPasses,
            reason: gateReason,
            blockedBy,
          });
        }

        let latestDiagnostics = buildDiagnosticsHintFromQualityReport(qualityReport);
        const visualDiagnostics = buildVisualValidationDiagnosticsHint(visualValidationReport);
        if (visualDiagnostics && visualDiagnostics.issues && visualDiagnostics.issues.length) {
          if (latestDiagnostics && Array.isArray(latestDiagnostics.issues)) {
            latestDiagnostics.issues = [
              ...visualDiagnostics.issues,
              ...latestDiagnostics.issues,
            ].slice(0, 40);
            latestDiagnostics.summary = {
              ...(latestDiagnostics.summary || {}),
              total: Number(latestDiagnostics.summary && latestDiagnostics.summary.total || 0) + Number(visualDiagnostics.summary && visualDiagnostics.summary.total || 0),
              errors: Number(latestDiagnostics.summary && latestDiagnostics.summary.errors || 0) + Number(visualDiagnostics.summary && visualDiagnostics.summary.errors || 0),
              warnings: Number(latestDiagnostics.summary && latestDiagnostics.summary.warnings || 0) + Number(visualDiagnostics.summary && visualDiagnostics.summary.warnings || 0),
            };
          } else {
            latestDiagnostics = visualDiagnostics;
          }
        }
        if (blockedByEffectGate) {
          const issue = {
            severity: 'error',
            code: 'execution_no_effect',
            file:
              currentAction && currentAction.targetFile
                ? String(currentAction.targetFile)
                : (effectGate.taskType || 'executor'),
            detail: buildExecutionEffectGateMessage(effectGate),
          };
          if (latestDiagnostics && Array.isArray(latestDiagnostics.issues)) {
            latestDiagnostics.issues = [issue, ...latestDiagnostics.issues].slice(0, 40);
          }
          if (latestDiagnostics && latestDiagnostics.summary) {
            latestDiagnostics.summary.errors = Number(latestDiagnostics.summary.errors || 0) + 1;
          }
        }
        assertJobExecutionNotCancelled(jobId, executionSignal);
        const repairPlan = await buildPlanWithCortexRuntime(
          refreshed,
          originalUserMessage,
          originalAttachments,
          {
            mode: 'auto_repair',
            latestDiagnostics,
            lastPlanner: 'cortex_runtime',
            lastIntent: currentAction && currentAction.intent ? currentAction.intent : 'edit_project',
            lastReason: gateReason,
            lastHadAction: true,
          },
          jobId
        );
        assertJobExecutionNotCancelled(jobId, executionSignal);

        if (!(repairPlan && repairPlan.ok && repairPlan.action)) {
          if (jobId) {
            appendJobEvent(jobId, 'job.auto_repair_plan_failed', {
              autoRepairAttempt,
              reason: repairPlan && repairPlan.meta && repairPlan.meta.reason
                ? repairPlan.meta.reason
                : gateReason,
            });
          }
          const repairMessage = repairPlan && repairPlan.response
            ? String(repairPlan.response)
            : 'Não consegui montar um plano de reparo automático nesta rodada.';
          if (jobId) {
            const retryMarked = markJobRetryPending(jobId, gateReason, 'execute_validation');
            if (retryMarked.ok && retryMarked.job && retryMarked.job.retryState && retryMarked.job.retryState.retryable === false) {
              markJobFailed(jobId, gateReason, 'execute_validation_retry_exhausted');
            }
          }
          return {
            ok: false,
            message: `${gateMessage}\n${repairMessage}`,
            projectInfo: refreshed,
            nextSteps: buildNextSteps(refreshed),
            modifiedFiles: result.modifiedFiles || [],
            qualityReport,
            executionReport,
            visualValidation: visualValidationReport,
            blockedByExecutionEffect: blockedByEffectGate,
            blockedByVisualValidation: blockedByVisualGate,
            blockedByPostExecutionValidation: true,
            autoRepairAttempt,
          };
        }

        currentAction = bindActionToAuthorizedProject({
          ...repairPlan.action,
          userMessage: originalUserMessage,
          attachments: originalAttachments,
          artifactContext: currentAction && currentAction.artifactContext ? currentAction.artifactContext : '',
          jobId,
        }, refreshed);
        if (jobId) {
          appendJobEvent(jobId, 'job.auto_repair_plan_ready', {
            autoRepairAttempt,
            targetFile: currentAction && currentAction.targetFile ? currentAction.targetFile : null,
            intent: currentAction && currentAction.intent ? currentAction.intent : null,
            protocol:
              currentAction &&
              currentAction.executionCommand &&
              currentAction.executionCommand.protocol
                ? currentAction.executionCommand.protocol
                : 'unknown',
          });
        }
        currentProjectInfo = refreshed;
      }
    } catch (error) {
      if (error && error.code === 'job_cancelled') {
        if (jobId) {
          abortActiveJobExecution(jobId, 'cancelled_by_user');
          markJobCancelled(jobId, 'cancelled_by_user');
        }
        appendAuditEvent('assistant.execute_cancelled', {
          rootPath: projectInfo ? projectInfo.rootPath : null,
          jobId,
          message: error.message,
        });
        return {
          ok: false,
          cancelled: true,
          message: error.message,
        };
      }
      if (jobId) {
        markJobFailed(jobId, error.message, 'execute_failed');
      }
      appendAuditEvent('assistant.execute_failed', {
        rootPath: projectInfo ? projectInfo.rootPath : null,
        jobId,
        message: error.message,
      });
      return { ok: false, message: `Erro na execução: ${error.message}` };
    } finally {
      endActiveJobExecution(jobId, executionController);
    }
  });

  registerOrchestrationHandlers({
    MAX_CONVERSATION_MESSAGES,
    addConversationEntry,
    addConversationMessage,
    appendAuditEvent,
    appendJobEvent,
    getJobById,
    listConversationMessages,
    listJobs,
    abortActiveJobExecution,
    markJobCancelled,
    markJobPhase,
    readOrchestrationState,
    registerIpcHandler,
    renameConversationEntry,
  });

  registerAiHandlers({
    AI_PROVIDER_ENV,
    AI_PROVIDER_OPTIONS,
    GEMINI_API_KEY,
    OPENAI_API_BASE_URL,
    OPENAI_API_KEY,
    PEXELS_API_KEY,
    SAMBANOVA_API_BASE_URL,
    SAMBANOVA_API_KEY,
    appendAuditEvent,
    getAiRuntimeStatus,
    getEffectiveGeminiApiKey,
    getEffectiveGeminiModel,
    getEffectiveOpenAiApiKey,
    getEffectiveOpenAiModel,
    getEffectivePexelsApiKey,
    getEffectiveSambaNovaApiKey,
    getEffectiveSambaNovaModel,
    maskApiKeyTail,
    normalizeAiProviderName,
    readAiRuntimeSettings,
    registerIpcHandler,
    sanitizeCustomApiProfiles,
    sanitizeGeminiModelName,
    sanitizeOpenAiModelName,
    sanitizeSambaNovaModelName,
    setSelectedAiProvider,
    writeAiRuntimeSettings,
  });

  registerMempalaceHandlers({
    appendAuditEvent,
    ensureMempalaceProjectIndexed,
    getMempalaceRuntimeStatus,
    normalizeAuthorizedProjectInfo,
    registerIpcHandler,
    searchMempalaceContext,
  });

  registerKnowledgeRuntimeHandlers({
    appendAuditEvent,
    getKnowledgeRuntimeStatus,
    listMemoryEvidence,
    normalizeAuthorizedProjectInfo,
    registerIpcHandler,
    runMemoryLifecycleOperation,
    searchKnowledge,
  });

  registerIpcHandler('cortex:learning:get', (_, payload) => {
    const { projectId } = payload || {};
    return getCortexLearning(projectId);
  });

  registerIpcHandler('cortex:learning:learn', async (_, payload) => {
    const { projectId, projectInfo, userMessage, attachments, topic } = payload || {};
    const project = normalizeAuthorizedProjectInfo(projectInfo || null);
    if (!project.ok) return project;
    return processCortexLearningPayload({
      projectId,
      projectInfo: project.projectInfo,
      userMessage: userMessage || '',
      attachments: Array.isArray(attachments) ? attachments : [],
      topic,
    });
  });

  registerIpcHandler('cortex:topic:upsert', (_, payload) => {
    const { projectId, topic } = payload || {};
    return upsertCortexTopic(projectId, topic || {});
  });

  registerIpcHandler('cortex:topic:rename', (_, payload) => {
    const { projectId, topicId, label } = payload || {};
    return renameCortexTopic(projectId, topicId, label);
  });

  registerFileHandlers({
    appendAuditEvent,
    computeLineChangeStats,
    fs,
    ingestRuntimeDiffStats,
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff,
    path,
    registerIpcHandler,
    resolveAuthorizedProjectPath,
    shell,
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  platformBackendService.stop().catch(() => {});
  resetFaberCapabilityRuntime();
  projectTerminalService.stopAllSessions();
  stopAllProjectPreviews().catch(() => {});
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
