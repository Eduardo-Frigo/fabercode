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
const { createCortexMemorySyncService } = require('./cortex/memory/cortex_memory_sync_service');
const { createKnowledgeRuntimeService } = require('./cortex/memory/knowledge_runtime_service');
const { createAssistantFlow } = require('./cortex/orchestration/assistant_flow');
const { createArtifactQualityService } = require('./cortex/orchestration/artifact_quality_service');
const {
  resolveExecutionIntentFromContext,
} = require('./cortex/orchestration/execution_intent');
const {
  CORTEX_RENDER_RUNTIME_VERSION,
  createCortexRuntimeCheckpoint,
  createCortexWorkGraph,
  createRenderPass,
  setPassStatus,
} = require('./cortex/orchestration/render_runtime_state');
const { createCortexBriefingService } = require('./cortex/orchestration/briefing_service');
const { createProjectBlueprintService } = require('./cortex/orchestration/project_blueprint_service');
const { createCortexRenderPassService } = require('./cortex/orchestration/render_pass_service');
const { createCortexRepairValidationService } = require('./cortex/orchestration/repair_validation_service');
const { createCortexRuntimeBudgetService } = require('./cortex/orchestration/runtime_budget');
const { createCortexValidationService } = require('./cortex/orchestration/validation_service');
const { createOrchestrationStateStore } = require('./cortex/orchestration/state_store');
const { callMockPersonaProviderChat } = require('./cortex/providers/mock_provider');
const { createProviderRegistry } = require('./cortex/providers/registry');
const { createRemoteProviderClients } = require('./cortex/providers/remote_clients');
const { createRwkvProviderClient } = require('./cortex/providers/rwkv_client');
const { createAiRuntimeSettingsService, normalizeAiProviderName } = require('./cortex/providers/runtime_settings');
const { createAiRuntimeStatusService } = require('./cortex/providers/runtime_status');
const { createAutomataTools } = require('./cortex/tools/automata_tools');
const { createToolRegistry } = require('./cortex/tools/registry');
const { registerAiHandlers } = require('./main/ipc/ai_handlers');
const { registerFileHandlers } = require('./main/ipc/file_handlers');
const { registerGithubHandlers } = require('./main/ipc/github_handlers');
const { registerKnowledgeRuntimeHandlers } = require('./main/ipc/knowledge_runtime_handlers');
const { registerMempalaceHandlers } = require('./main/ipc/mempalace_handlers');
const { registerOrchestrationHandlers } = require('./main/ipc/orchestration_handlers');
const { registerPreviewHandlers } = require('./main/ipc/preview_handlers');
const { registerProjectHandlers } = require('./main/ipc/project_handlers');
const { createIpcSecurity } = require('./main/security/ipc_security');
const { createProjectAccess } = require('./main/security/project_access');
const { createSecretStore } = require('./main/security/secret_store');
const { normalizeExternalUrl } = require('./main/security/url_policy');
const { createCommandRunner } = require('./main/services/command_runner');
const { createProjectGitService } = require('./main/services/git_service');
const {
  createDeterministicEditService,
  extractRequestedTitle,
  isButtonColorEditRequest,
  isFooterInsertRequest,
  isHydrationMismatchRepairRequest,
} = require('./main/services/deterministic_edit_service');
const { createGithubIntegrationService } = require('./main/services/github_integration_service');
const { createLocalDiagnosticsService } = require('./main/services/local_diagnostics_service');
const { createPlatformGuidanceService } = require('./main/services/platform_guidance_service');
const { createPostExecutionQualityService } = require('./main/services/post_execution_quality_service');
const { createProjectPreviewRuntimeService } = require('./main/services/project_preview_runtime_service');
const { createProjectPreviewService } = require('./main/services/project_preview_service');
const { createProjectScanner } = require('./main/services/project_scanner');
const { createProjectVerificationService } = require('./main/services/project_verification_service');
const { createStackRegistryService } = require('./main/services/stack_registry_service');

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

const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.cache']);
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
const MAX_AUDIT_EVENTS = 300;
const MAX_CONVERSATION_MESSAGES = 200;
const MAX_CORTEX_LEARNING_EVENTS = 80;
const MAX_CORTEX_CONTEXT_ITEMS = 10;
const MAX_JOB_EVENTS = 120;
const MAX_JOBS_STORED = 180;
const AI_PROVIDER_OPTIONS = ['mock', 'rwkv', 'gemini', 'sambanova'];
const AI_PROVIDER_ENV = normalizeAiProviderName(process.env.AI_PROVIDER || 'rwkv');
const GEMINI_API_BASE_URL = process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_MODEL_BRAIN_ENV = process.env.GEMINI_MODEL_BRAIN || 'gemini-2.0-flash';
const GEMINI_MAX_REQUESTS_PER_MINUTE = Number.parseInt(
  process.env.GEMINI_MAX_REQUESTS_PER_MINUTE || '6',
  10
);
const SAMBANOVA_API_BASE_URL = process.env.SAMBANOVA_API_BASE_URL || 'https://api.sambanova.ai/v1';
const SAMBANOVA_API_KEY = process.env.SAMBANOVA_API_KEY || '';
const SAMBANOVA_MODEL_BRAIN_ENV = String(process.env.SAMBANOVA_MODEL_BRAIN || '').trim();
const SAMBANOVA_MIN_REQUEST_INTERVAL_MS = Number.parseInt(
  process.env.SAMBANOVA_MIN_REQUEST_INTERVAL_MS || '10000',
  10
);
const SAMBANOVA_MAX_REQUESTS_PER_MINUTE = Number.parseInt(
  process.env.SAMBANOVA_MAX_REQUESTS_PER_MINUTE || '3',
  10
);
const PERSONA_MODEL_ENGINE = process.env.PERSONA_MODEL_ENGINE || 'rwkv-local';
const PERSONA_MODEL_BRAIN = process.env.PERSONA_MODEL_BRAIN || 'rwkv-local';
const AI_REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.AI_REQUEST_TIMEOUT_MS || '420000',
  10
);
const BRAIN_BRIEFING_TIMEOUT_MS = Number.parseInt(
  process.env.BRAIN_BRIEFING_TIMEOUT_MS || String(Math.max(AI_REQUEST_TIMEOUT_MS, 600000)),
  10
);
const GEMINI_MIN_REQUEST_INTERVAL_MS = Number.parseInt(
  process.env.GEMINI_MIN_REQUEST_INTERVAL_MS || '8000',
  10
);
const GEMINI_429_BASE_BACKOFF_MS = Number.parseInt(
  process.env.GEMINI_429_BASE_BACKOFF_MS || '60000',
  10
);
const GEMINI_429_MAX_BACKOFF_MS = Number.parseInt(
  process.env.GEMINI_429_MAX_BACKOFF_MS || '300000',
  10
);
const SAMBANOVA_429_BASE_BACKOFF_MS = Number.parseInt(
  process.env.SAMBANOVA_429_BASE_BACKOFF_MS || '12000',
  10
);
const SAMBANOVA_429_MAX_BACKOFF_MS = Number.parseInt(
  process.env.SAMBANOVA_429_MAX_BACKOFF_MS || '120000',
  10
);
const RWKV_ENABLED = String(process.env.RWKV_ENABLED || 'true').toLowerCase() === 'true';
const RWKV_MODEL_PATH =
  process.env.RWKV_MODEL_PATH ||
  path.join(process.cwd(), 'models', 'rwkv', 'RWKV-x070-World-0.4B-v2.9-20250107-ctx4096');
const RWKV_TOKENIZER_PATH =
  process.env.RWKV_TOKENIZER_PATH ||
  path.join(process.cwd(), 'models', 'rwkv', 'tokenizer.json');
const RWKV_STRATEGY = process.env.RWKV_STRATEGY || 'cpu fp16';
const RWKV_MAX_NEW_TOKENS = Number.parseInt(process.env.RWKV_MAX_NEW_TOKENS || '80', 10);
const RWKV_TEMPERATURE = Number.parseFloat(process.env.RWKV_TEMPERATURE || '0.2');
const RWKV_TOP_P = Number.parseFloat(process.env.RWKV_TOP_P || '0.9');
const RWKV_V7_ON = String(process.env.RWKV_V7_ON || '0');
const RWKV_PROVIDER_SCRIPT = path.join(__dirname, 'cortex', 'rwkv', 'rwkv_provider.py');
const AUTOMATA_BUNDLE_ROOT = process.env.AUTOMATA_BUNDLE_ROOT || path.resolve(__dirname, '..', 'Automata');
const CORTEX_RAG_ENABLED = String(process.env.CORTEX_RAG_ENABLED || 'true').toLowerCase() === 'true';
const CORTEX_RAG_PROVIDER = String(process.env.CORTEX_RAG_PROVIDER || 'r2r').trim().toLowerCase();
const R2R_BASE_URL = String(process.env.R2R_BASE_URL || 'http://127.0.0.1:7272').trim().replace(/\/+$/, '');
const R2R_API_KEY = String(process.env.R2R_API_KEY || '').trim();
const R2R_CORTEX_INGEST_ENDPOINT = String(process.env.R2R_CORTEX_INGEST_ENDPOINT || '').trim();
const R2R_SEARCH_LIMIT = Number.parseInt(process.env.R2R_SEARCH_LIMIT || '6', 10);
const R2R_STATUS_TIMEOUT_MS = Number.parseInt(process.env.R2R_STATUS_TIMEOUT_MS || '3500', 10);
const R2R_TIMEOUT_MS = Number.parseInt(process.env.R2R_TIMEOUT_MS || '12000', 10);
const TIME_AS_COMPUTE_PROFILE = String(process.env.TIME_AS_COMPUTE_PROFILE || 'auto').toLowerCase();
const BRAIN_PLAN_MAX_ATTEMPTS_ENV = Number.parseInt(process.env.BRAIN_PLAN_MAX_ATTEMPTS || '2', 10);
const BRAIN_PLAN_MAX_ELAPSED_MS_ENV = Number.parseInt(process.env.BRAIN_PLAN_MAX_ELAPSED_MS || '480000', 10);
const SCAFFOLD_MAX_CLARIFICATIONS_ENV = Number.parseInt(process.env.SCAFFOLD_MAX_CLARIFICATIONS || '1', 10);
const PERSONA_PROTOCOL_VERSION = 'persona.v1';
const SUPPORTED_EXEC_PROTOCOLS = new Set([PERSONA_PROTOCOL_VERSION, 'a2.v1']);
const JOB_RETRY_STAGNATION_LIMIT = Number.parseInt(process.env.JOB_RETRY_STAGNATION_LIMIT || '12', 10);
const JOB_RETRY_NO_PROGRESS_MS = Number.parseInt(process.env.JOB_RETRY_NO_PROGRESS_MS || '1800000', 10);
const JOB_PROGRESS_MIN_DELTA = Number.parseInt(process.env.JOB_PROGRESS_MIN_DELTA || '1', 10);
const JOB_SOFT_TIMEOUT_MS = Number.parseInt(process.env.JOB_SOFT_TIMEOUT_MS || '3600000', 10);
const JOB_RETRY_SAME_REASON_LIMIT = Number.parseInt(process.env.JOB_RETRY_SAME_REASON_LIMIT || '6', 10);
const JOB_RETRY_SAME_FINGERPRINT_LIMIT = Number.parseInt(process.env.JOB_RETRY_SAME_FINGERPRINT_LIMIT || '3', 10);
const CORTEX_VALIDATION_MIN_SCORE = Number.parseInt(process.env.CORTEX_VALIDATION_MIN_SCORE || '55', 10);
const CORTEX_VALIDATION_REQUIRE_CORE = String(process.env.CORTEX_VALIDATION_REQUIRE_CORE || 'true').toLowerCase() === 'true';
const CORTEX_VALIDATION_STALL_LIMIT = Number.parseInt(process.env.CORTEX_VALIDATION_STALL_LIMIT || '2', 10);
const CORTEX_VALIDATION_REPAIR_MIN_IMPROVEMENT = Number.parseInt(
  process.env.CORTEX_VALIDATION_REPAIR_MIN_IMPROVEMENT || '2',
  10
);
const CORTEX_VALIDATION_REPAIR_STALL_LIMIT = Number.parseInt(
  process.env.CORTEX_VALIDATION_REPAIR_STALL_LIMIT || '1',
  10
);
const CORTEX_VALIDATION_MAX_RETRIES = Number.parseInt(process.env.CORTEX_VALIDATION_MAX_RETRIES || '8', 10);
const CORTEX_BRIEFING_MAX_RETRIES = Number.parseInt(process.env.CORTEX_BRIEFING_MAX_RETRIES || '8', 10);
const AUTOMATA_ENABLED = String(process.env.AUTOMATA_ENABLED || 'true').toLowerCase() === 'true';
const AUTOMATA_STRICT_EXECUTION = String(process.env.AUTOMATA_STRICT_EXECUTION || 'true').toLowerCase() === 'true';
const AIDER_MAIN_ROOT = process.env.AIDER_MAIN_ROOT || path.join(AUTOMATA_BUNDLE_ROOT, 'aider-main');
const POST_EXEC_QUALITY_ENABLED = String(process.env.POST_EXEC_QUALITY_ENABLED || 'true').toLowerCase() === 'true';
const POST_EXEC_QUALITY_MAX_FILES = Number.parseInt(process.env.POST_EXEC_QUALITY_MAX_FILES || '20', 10);
const POST_EXEC_QUALITY_MAX_ISSUES = Number.parseInt(process.env.POST_EXEC_QUALITY_MAX_ISSUES || '40', 10);
const POST_EXEC_QUALITY_TIMEOUT_MS = Number.parseInt(process.env.POST_EXEC_QUALITY_TIMEOUT_MS || '30000', 10);
const POST_EXEC_QUALITY_ENFORCE_ERRORS = String(process.env.POST_EXEC_QUALITY_ENFORCE_ERRORS || 'true').toLowerCase() === 'true';
const POST_EXEC_QUALITY_ENFORCE_WARNINGS = String(process.env.POST_EXEC_QUALITY_ENFORCE_WARNINGS || 'false').toLowerCase() === 'true';
const EXECUTION_ENFORCE_EFFECT_GATE = String(process.env.EXECUTION_ENFORCE_EFFECT_GATE || 'true').toLowerCase() === 'true';
const EXECUTION_ENFORCE_NONZERO_DIFF_ON_EDIT = String(
  process.env.EXECUTION_ENFORCE_NONZERO_DIFF_ON_EDIT || 'true'
).toLowerCase() === 'true';
const AUTO_REPAIR_ENABLED = String(process.env.AUTO_REPAIR_ENABLED || 'true').toLowerCase() === 'true';
const AUTO_REPAIR_MAX_PASSES = Number.parseInt(process.env.AUTO_REPAIR_MAX_PASSES || '2', 10);
const AIDER_LINT_TIMEOUT_MS = Number.parseInt(process.env.AIDER_LINT_TIMEOUT_MS || '15000', 10);
const MEMPALACE_LOCAL_VENV_PYTHON = path.join(
  __dirname,
  '.venv-mempalace',
  process.platform === 'win32' ? 'Scripts' : 'bin',
  process.platform === 'win32' ? 'python.exe' : 'python3'
);
const MEMPALACE_PYTHON_BIN =
  process.env.MEMPALACE_PYTHON_BIN ||
  (fs.existsSync(MEMPALACE_LOCAL_VENV_PYTHON) ? MEMPALACE_LOCAL_VENV_PYTHON : 'python3');
const MEMPALACE_COMMAND_TIMEOUT_MS = Number.parseInt(
  process.env.MEMPALACE_COMMAND_TIMEOUT_MS || '12000',
  10
);
const MEMPALACE_REPO_CANDIDATES = [
  process.env.MEMPALACE_REPO_PATH || null,
  path.join(__dirname, '..', 'mempalace-develop'),
  path.join(process.cwd(), '..', 'mempalace-develop'),
  path.join(process.cwd(), 'mempalace-develop'),
].filter(Boolean);

const COMMUNICATION_STYLE_GUIDE = [
  'Use PT-BR formal, claro e cordial.',
  'Priorize resposta curta e objetiva no chat.',
  'Evite jargão técnico quando não for necessário.',
  'Não use emojis.',
  'Se a pergunta for informativa, não proponha edição.',
  'Se for necessário aprofundar tecnicamente, sugira a geração de PDF técnico.',
].join(' ');

const PROVIDER_REQUEST_WINDOW_MS = 60000;
const providerRequestTimestampsMs = { gemini: [], sambanova: [] };
const providerCooldownUntilMs = { gemini: 0, sambanova: 0 };

const PERSONA_HUMANIZATION_PROTOCOL = [
  'Compreenda a intenção do usuário antes da literalidade do comando.',
  'Conduza diálogo iterativo com perguntas curtas de clarificação quando houver ambiguidade.',
  'Se houver múltiplas abordagens, proponha alternativas com prós e contras breves.',
  'Confirme entendimento antes de iniciar execução técnica.',
  'Se detectar repetição/loop, mude a estratégia: ofereça opção padrão segura para destravar o fluxo.',
  'Após cada resposta, sugira próximo passo lógico em linguagem simples.',
  'Adapte profundidade técnica ao nível de usuário leigo por padrão.',
  'Evite repetir exatamente o mesmo bloco de perguntas em turnos consecutivos.',
].join(' ');

const CORTEX_STOPWORDS = new Set([
  'a',
  'ao',
  'aos',
  'as',
  'com',
  'como',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'eu',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'ou',
  'para',
  'por',
  'que',
  'se',
  'sem',
  'um',
  'uma',
  'vou',
]);

function delayMs(ms) {
  const wait = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
  if (wait <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, wait));
}

function getProviderRequestsPerMinuteLimit(provider) {
  const normalized = normalizeProviderKey(provider) || String(provider || '').toLowerCase();
  if (normalized === 'sambanova') {
    return Math.max(
      1,
      Number.isFinite(Number(SAMBANOVA_MAX_REQUESTS_PER_MINUTE)) ? Number(SAMBANOVA_MAX_REQUESTS_PER_MINUTE) : 3
    );
  }
  if (normalized === 'gemini') {
    return Math.max(
      1,
      Number.isFinite(Number(GEMINI_MAX_REQUESTS_PER_MINUTE)) ? Number(GEMINI_MAX_REQUESTS_PER_MINUTE) : 6
    );
  }
  return 0;
}

async function enforceProviderRequestsPerMinute(provider) {
  const key = provider === 'sambanova' ? 'sambanova' : 'gemini';
  const maxPerMinute = getProviderRequestsPerMinuteLimit(provider);
  if (!Number.isFinite(maxPerMinute) || maxPerMinute <= 0) return;

  while (true) {
    const now = Date.now();
    const history = Array.isArray(providerRequestTimestampsMs[key]) ? providerRequestTimestampsMs[key] : [];
    const alive = history.filter((ts) => Number.isFinite(ts) && now - ts < PROVIDER_REQUEST_WINDOW_MS);
    providerRequestTimestampsMs[key] = alive;

    if (alive.length < maxPerMinute) {
      alive.push(now);
      providerRequestTimestampsMs[key] = alive;
      return;
    }

    const oldest = alive[0];
    const waitMs = Math.max(250, PROVIDER_REQUEST_WINDOW_MS - (now - oldest) + 25);
    await delayMs(waitMs);
  }
}

function normalizeProviderKey(provider) {
  const raw = String(provider || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes('sambanova')) return 'sambanova';
  if (raw.includes('gemini') || raw.includes('google')) return 'gemini';
  return null;
}

async function enforceProviderCooldown(provider) {
  const key = normalizeProviderKey(provider);
  if (!key) return;
  const until = Number(providerCooldownUntilMs[key] || 0);
  const waitMs = until - Date.now();
  if (waitMs > 0) await delayMs(waitMs);
}

function applyProviderCooldownFromReason(provider, reason, attemptFactor = 1) {
  const key = normalizeProviderKey(provider);
  if (!key) return;
  if (!isTransientTooManyRequestsReason(reason)) return;
  const backoffMs = computeRetryBackoffMs(reason, Math.max(1, Number(attemptFactor) || 1));
  const nextUntil = Date.now() + Math.max(1000, backoffMs);
  providerCooldownUntilMs[key] = Math.max(Number(providerCooldownUntilMs[key] || 0), nextUntil);
}

function clearProviderCooldown(provider) {
  const key = normalizeProviderKey(provider);
  if (!key) return;
  providerCooldownUntilMs[key] = 0;
}

function resolveTimeAsComputeProfile() {
  if (['rapido', 'balanceado', 'profundo'].includes(TIME_AS_COMPUTE_PROFILE)) {
    return TIME_AS_COMPUTE_PROFILE;
  }

  const ramGb = os.totalmem() / 1024 / 1024 / 1024;
  if (ramGb <= 10) return 'rapido';
  if (ramGb <= 24) return 'balanceado';
  return 'profundo';
}

function getRuntimeProfileSettings() {
  const profile = resolveTimeAsComputeProfile();
  if (profile === 'rapido') {
    return {
      profile,
      brainSampleFilesLimit: 14,
      engineSampleFilesLimit: 24,
      memoryContextChars: 1200,
      maxPromptCharsPerPass: 4200,
      maxOperationsPerPass: 6,
      maxRepairPasses: 1,
      keepAlive: '0s',
      generationOptions: {
        num_ctx: 2048,
        num_batch: 64,
        num_predict: 700,
        num_thread: 2,
        num_gpu: 0,
        temperature: 0.2,
      },
    };
  }
  if (profile === 'balanceado') {
    return {
      profile,
      brainSampleFilesLimit: 28,
      engineSampleFilesLimit: 40,
      memoryContextChars: 1800,
      maxPromptCharsPerPass: 7000,
      maxOperationsPerPass: 8,
      maxRepairPasses: 1,
      keepAlive: '30s',
      generationOptions: {
        num_ctx: 4096,
        num_batch: 128,
        num_predict: 1100,
        num_thread: 4,
        temperature: 0.2,
      },
    };
  }
  return {
    profile,
    brainSampleFilesLimit: 40,
    engineSampleFilesLimit: 60,
    memoryContextChars: 2400,
    maxPromptCharsPerPass: 11000,
    maxOperationsPerPass: 10,
    maxRepairPasses: 2,
    keepAlive: '2m',
    generationOptions: {
      num_ctx: 8192,
      num_batch: 256,
      num_predict: 1800,
      num_thread: 6,
      temperature: 0.2,
    },
  };
}

function sanitizePositiveInt(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getBrainBudgetSettings(runtimeSettings) {
  const defaultAttemptsByProfile = runtimeSettings.profile === 'rapido' ? 1 : 2;
  const maxAttempts = sanitizePositiveInt(BRAIN_PLAN_MAX_ATTEMPTS_ENV, defaultAttemptsByProfile);
  const maxElapsedMs = sanitizePositiveInt(BRAIN_PLAN_MAX_ELAPSED_MS_ENV, 480000);
  const maxClarifications = sanitizePositiveInt(SCAFFOLD_MAX_CLARIFICATIONS_ENV, 1);
  return {
    maxAttempts,
    maxElapsedMs,
    maxClarifications,
  };
}

const commandRunner = createCommandRunner({ spawn });
const { runCommand } = commandRunner;

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

const projectPreviewRuntimeService = createProjectPreviewRuntimeService({
  buildProjectPreviewPlan,
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

const memoryContextAdapter = createMemoryContextAdapter({
  CORTEX_RAG_ENABLED,
  CORTEX_RAG_PROVIDER,
  MEMPALACE_COMMAND_TIMEOUT_MS,
  MEMPALACE_PYTHON_BIN,
  MEMPALACE_REPO_CANDIDATES,
  R2R_API_KEY,
  R2R_BASE_URL,
  R2R_CORTEX_INGEST_ENDPOINT,
  R2R_SEARCH_LIMIT,
  R2R_STATUS_TIMEOUT_MS,
  R2R_TIMEOUT_MS,
  clipText,
  crypto,
  env: process.env,
  extractIntentTerms,
  fetchFn: fetch,
  fs,
  getRuntimeProfileSettings,
  getUserDataPath: () => app.getPath("userData"),
  path,
  runCommand,
});

const {
  buildMempalaceCortexCore,
  buildMempalacePlannerContext,
  buildRagPlannerContext,
  ensureMempalaceProjectIndexed,
  formatMempalaceCoreForPrompt,
  getMempalaceRuntimeStatus,
  getRagRuntimeStatus,
  indexCortexMemoryInRag,
  persistCortexMemoryToMempalace,
  persistCortexCheckpointToMempalace,
  searchMempalaceContext,
} = memoryContextAdapter;

const cortexBriefingService = createCortexBriefingService({
  BRAIN_BRIEFING_TIMEOUT_MS,
  PERSONA_MODEL_BRAIN,
  buildAttachmentsPromptContext,
  buildDiagnosticsPromptContext,
  buildLocalProjectDiagnostics,
  buildProjectEvolutionContext,
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
  buildProjectEvolutionContext,
  buildRuntimeBudget,
  callPersonaProviderChat,
  clipText,
  evaluateOperationBatchArtifactQuality,
  formatArtifactQualityForPrompt,
  formatLocalProjectDiagnosticsForPrompt,
  formatMempalaceCoreForPrompt,
  getRuntimeProfileSettings,
  hasRequiredProjectBlueprintFiles,
  normalizeRequestedRelativePath,
  shouldPreferProjectBlueprint,
  shouldUseProjectBlueprintFallback,
  tryParseJsonObject,
  validateOperationBatchPlan,
});

const {
  requestEngineOperationBatchAction,
} = cortexRenderPassService;

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
  path,
  protectSecret: (value) => getSecretStore().protectSecret(value),
  sambanovaApiKey: SAMBANOVA_API_KEY,
  sambanovaModelBrain: SAMBANOVA_MODEL_BRAIN_ENV,
  unprotectSecret: (value) => getSecretStore().unprotectSecret(value),
});

const {
  getEffectiveGeminiApiKey,
  getEffectiveGeminiModel,
  getEffectiveSambaNovaApiKey,
  getEffectiveSambaNovaModel,
  listCustomApiProfiles,
  readSettings: readAiRuntimeSettings,
  sanitizeCustomApiProfiles,
  sanitizeGeminiModelName,
  sanitizeSambaNovaModelName,
  setSelectedProvider: setSelectedAiProvider,
  writeSettings: writeAiRuntimeSettings,
} = aiRuntimeSettings;

function resolveCustomProviderKind(rawName = '') {
  const value = String(rawName || '').trim().toLowerCase();
  if (!value) return 'custom';
  if (value.includes('openai') || value === 'oai') return 'openai';
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('gemini') || value.includes('google')) return 'gemini';
  if (value.includes('samba')) return 'sambanova';
  return 'custom';
}

function resolveCustomApiEndpoint(profile = {}) {
  const kind = resolveCustomProviderKind(profile.providerName || '');
  if (kind === 'openai') return 'https://api.openai.com/v1/chat/completions';
  if (kind === 'deepseek') return 'https://api.deepseek.com/v1/chat/completions';

  const website = String(profile.website || '').trim();
  if (!website) return '';
  try {
    const parsed = new URL(website.startsWith('http') ? website : `https://${website}`);
    const full = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    if (full.endsWith('/chat/completions')) return full;
    if (full.endsWith('/v1')) return `${full}/chat/completions`;
    return `${parsed.origin}/v1/chat/completions`;
  } catch {
    return '';
  }
}

function getSelectedCustomApiProfile(selectedProvider = null) {
  const selected = String(selectedProvider || getSelectedAiProvider() || '').trim().toLowerCase();
  if (!selected.startsWith('custom:')) return null;
  const id = selected.slice('custom:'.length);
  if (!id) return null;
  const list = listCustomApiProfiles();
  const hit = list.find((entry) => String(entry.id || '').trim().toLowerCase() == id);
  return hit || null;
}

function maskApiKeyTail(value, visibleTail = 4) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= visibleTail) return '*'.repeat(text.length);
  return '*'.repeat(Math.max(0, text.length - visibleTail)) + text.slice(-visibleTail);
}

const remoteProviderClients = createRemoteProviderClients({
  AI_REQUEST_TIMEOUT_MS,
  GEMINI_API_BASE_URL,
  GEMINI_MIN_REQUEST_INTERVAL_MS,
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
  getEffectiveSambaNovaApiKey,
  getEffectiveSambaNovaModel,
  getSelectedCustomApiProfile,
  resolveCustomApiEndpoint,
  resolveCustomProviderKind,
  sanitizeSambaNovaModelName,
});

const {
  callCustomProviderChat,
  callGeminiChat,
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

function ensureProjectsStore() {
  const storeDir = app.getPath('userData');
  const storePath = path.join(storeDir, 'projects.json');

  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true });
  }

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({ projects: [] }, null, 2), 'utf8');
  }

  return storePath;
}

function normalizeProjectRecord(project = {}) {
  return {
    id: project.id,
    name: project.name || 'Projeto',
    rootPath: project.rootPath || '',
    createdAt: project.createdAt || new Date().toISOString(),
    state: ['active', 'archived', 'deleted'].includes(project.state) ? project.state : 'active',
    summary: typeof project.summary === 'string' ? project.summary : '',
    archivedAt: project.archivedAt || null,
    deletedAt: project.deletedAt || null,
  };
}

function readProjectsSnapshot() {
  const storePath = ensureProjectsStore();
  const raw = fs.readFileSync(storePath, 'utf8');
  const parsed = JSON.parse(raw);
  const projects = Array.isArray(parsed.projects) ? parsed.projects.map(normalizeProjectRecord) : [];
  return { projects };
}

function writeProjectsSnapshot(snapshot) {
  const storePath = ensureProjectsStore();
  const projects = Array.isArray(snapshot && snapshot.projects) ? snapshot.projects.map(normalizeProjectRecord) : [];
  fs.writeFileSync(storePath, JSON.stringify({ projects }, null, 2), 'utf8');
}

function readProjectsByState(state = 'active') {
  const snap = readProjectsSnapshot();
  return snap.projects.filter((p) => p.state === state);
}

function readProjects() {
  return readProjectsByState('active');
}

function writeProjects(projects) {
  const snap = readProjectsSnapshot();
  const nonActive = snap.projects.filter((p) => p.state !== 'active');
  const nextActive = Array.isArray(projects)
    ? projects.map((p) => normalizeProjectRecord({ ...p, state: 'active', archivedAt: null, deletedAt: null }))
    : [];
  writeProjectsSnapshot({ projects: [...nonActive, ...nextActive] });
}

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
  removeProjectConversationHistory,
  renameConversationEntry,
  renameCortexTopic,
  setJobCheckpoint,
  upsertCortexLearning,
  upsertCortexTopic,
} = orchestrationStateStore;

const cortexMemorySyncService = createCortexMemorySyncService({
  appendAuditEvent,
  clipText,
  indexCortexMemoryInRag,
  persistCortexMemoryToMempalace,
});

const {
  syncCortexMemory,
} = cortexMemorySyncService;

const knowledgeRuntimeService = createKnowledgeRuntimeService({
  appendAuditEvent,
  buildRagPlannerContext,
  getCortexLearning,
  getMempalaceRuntimeStatus,
  getRagRuntimeStatus,
  searchMempalaceContext,
  syncCortexMemory,
});

const {
  getKnowledgeRuntimeStatus,
  searchKnowledge,
  syncKnowledgeFromCortex,
} = knowledgeRuntimeService;

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

function buildCortexPromptContext(projectId, userMessage, runtimeSettings) {
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
  eventEntries.forEach((event, index) => {
    const base = event && (event.summary || event.text || event.type) ? event.summary || event.text || event.type : '';
    items.push({
      source: 'event',
      text: String(base || ''),
      recency: index + 1,
    });
  });

  const scored = items
    .map((item) => {
      const recencyBoost = Math.max(0, item.recency) * 0.02;
      return {
        ...item,
        score: scoreKnowledgeLine(item.text, intentTerms, recencyBoost),
      };
    })
    .filter((item) => item.text.length > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return {
      available: false,
      reason: 'learning_empty',
      contextText: '',
    };
  }

  const limit = Math.min(MAX_CORTEX_CONTEXT_ITEMS, runtimeSettings.profile === 'rapido' ? 6 : 10);
  const selected = scored.slice(0, limit);
  const contextText = selected.map((item) => `[${item.source}] ${clipText(item.text, 260)}`).join('\n');

  return {
    available: true,
    reason: null,
    selectedCount: selected.length,
    contextText,
  };
}

function clipTextPreserveLines(input, max = 2600) {
  const normalized = String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 14)).trim()}\n\n[...truncado]`;
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

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function isTextLikeExtension(ext) {
  return [
    '.txt',
    '.md',
    '.markdown',
    '.js',
    '.ts',
    '.tsx',
    '.jsx',
    '.json',
    '.py',
    '.php',
    '.java',
    '.yml',
    '.yaml',
    '.xml',
    '.html',
    '.css',
    '.scss',
    '.log',
  ].includes(ext);
}

function clipText(input, max = 4000) {
  const normalized = String(input || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3).trim()}...`;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic', '.heif', '.tiff', '.tif']);

function isImageLikeExtension(ext) {
  return IMAGE_EXTENSIONS.has(String(ext || '').toLowerCase());
}

async function extractImageTextViaMdls(filePath) {
  const mdlsResult = await runCommand('mdls', ['-name', 'kMDItemTextContent', '-raw', filePath], {
    timeoutMs: 8000,
  });
  if (!mdlsResult.ok) return '';
  const text = String(mdlsResult.stdout || '').trim();
  if (!text || text === '(null)') return '';
  return clipTextPreserveLines(text, 12000);
}

async function extractImageTextViaVision(filePath) {
  const swiftScript = [
    'import Foundation',
    'import Vision',
    'import AppKit',
    'let path = CommandLine.arguments.last ?? ""',
    'if path.isEmpty { exit(2) }',
    'let url = URL(fileURLWithPath: path)',
    'guard let image = NSImage(contentsOf: url) else { exit(3) }',
    'var rect = CGRect(origin: .zero, size: image.size)',
    'guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { exit(4) }',
    'let request = VNRecognizeTextRequest()',
    'request.recognitionLevel = .accurate',
    'request.usesLanguageCorrection = true',
    'request.recognitionLanguages = ["pt-BR", "en-US"]',
    'let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])',
    'do {',
    '  try handler.perform([request])',
    '  let items = (request.results as? [VNRecognizedTextObservation] ?? [])',
    '    .compactMap { $0.topCandidates(1).first?.string }',
    '    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }',
    '    .filter { !$0.isEmpty }',
    '  print(items.joined(separator: "\n"))',
    '} catch {',
    '  exit(5)',
    '}',
  ].join('\n');

  const swiftResult = await runCommand('xcrun', ['swift', '-e', swiftScript, filePath], {
    timeoutMs: 22000,
  });
  if (!swiftResult.ok) return '';
  const text = String(swiftResult.stdout || '').trim();
  if (!text) return '';
  return clipTextPreserveLines(text, 12000);
}

async function extractAttachmentText(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (!filePath || !fs.existsSync(filePath)) return '';

  if (isTextLikeExtension(ext)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return clipTextPreserveLines(raw, 12000);
  }

  if (ext === '.pdf') {
    const text = await extractImageTextViaMdls(filePath);
    if (text) return text;
  }

  if (isImageLikeExtension(ext)) {
    const mdlsText = await extractImageTextViaMdls(filePath);
    if (mdlsText) return mdlsText;

    const visionText = await extractImageTextViaVision(filePath);
    if (visionText) return visionText;
  }

  return '';
}

async function buildAttachmentsPromptContext(attachments = [], { maxAttachments = 4, maxCharsPerAttachment = 1200, totalMaxChars = 4200 } = {}) {
  if (!Array.isArray(attachments) || !attachments.length) return '';

  const selected = attachments
    .filter((entry) => entry && typeof entry === 'object')
    .filter((entry) => typeof entry.path === 'string' && entry.path.trim())
    .slice(0, Math.max(1, maxAttachments));

  if (!selected.length) return '';

  const blocks = [];
  let usedChars = 0;

  for (const attachment of selected) {
    const filePath = String(attachment.path || '').trim();
    if (!filePath) continue;

    const extracted = await extractAttachmentText(filePath);
    if (!extracted) continue;

    const name = attachment.name || path.basename(filePath);
    const type = attachment.type || path.extname(filePath).slice(1) || 'anexo';
    const excerpt = clipTextPreserveLines(extracted, Math.max(240, maxCharsPerAttachment));
    if (!excerpt) continue;

    const block = `[${name} | ${type}]\n${excerpt}`;
    const blockLen = block.length + 2;
    if (usedChars + blockLen > totalMaxChars && blocks.length > 0) break;

    blocks.push(block);
    usedChars += blockLen;
  }

  return blocks.join('\n\n');
}


async function processCortexLearningPayload({ projectId, userMessage, attachments = [], projectInfo, topic = 'geral' }) {
  if (!projectId) {
    return { ok: false, message: 'Projeto inválido para modo Cortex.' };
  }

  const normalizedTopic = String(topic || 'geral').trim().toLowerCase() || 'geral';
  const personaLearned = [];
  const executorLearned = [];
  const events = [];
  const attachmentLearning = [];

  const normalizedUserMessage = clipText(userMessage || '', 5000);
  if (normalizedUserMessage) {
    personaLearned.push(`Entendimento do usuário: ${normalizedUserMessage}`);
    executorLearned.push('Recebeu novos requisitos funcionais em linguagem natural, prontos para virar tarefas executáveis.');
    events.push({
      type: 'cortex.user_input',
      text: normalizedUserMessage,
      topic: normalizedTopic,
      createdAt: new Date().toISOString(),
    });
  }

  for (const attachment of attachments) {
    const filePath = attachment.path || '';
    const fileName = attachment.name || path.basename(filePath || 'arquivo');
    const extractedText = await extractAttachmentText(filePath);
    const learnedSnippet = extractedText
      ? clipText(extractedText, 700)
      : 'Não foi possível extrair texto automaticamente. Arquivo registrado para consulta manual.';

    attachmentLearning.push({
      name: fileName,
      path: filePath,
      summary: learnedSnippet,
    });
  }

  if (attachmentLearning.length) {
    attachmentLearning.forEach((entry) => {
      personaLearned.push(`Documento "${entry.name}": ${entry.summary}`);
      executorLearned.push(
        `Requisito técnico absorvido de "${entry.name}" e convertido em instruções operacionais quando necessário.`
      );
      events.push({
        type: 'cortex.attachment_learned',
        fileName: entry.name,
        summary: entry.summary,
        topic: normalizedTopic,
        createdAt: new Date().toISOString(),
      });
    });
  }

  const upsert = upsertCortexLearning(projectId, {
    persona: personaLearned,
    executor: executorLearned,
    events,
  });
  if (!upsert.ok) return upsert;

  const syncResult = await syncKnowledgeFromCortex({
    projectId,
    projectInfo,
    topic: normalizedTopic,
    userMessage: normalizedUserMessage,
    attachments,
    attachmentLearning,
    learning: upsert.learning,
  });

  appendAuditEvent('cortex.learning_updated', {
    projectId,
    rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
    attachments: attachments.map((a) => ({ name: a.name, type: a.type || null })),
    topic: normalizedTopic,
    userMessageSize: normalizedUserMessage.length,
    sync: {
      mempalace: syncResult && syncResult.mempalace ? syncResult.mempalace.reason || (syncResult.mempalace.ok ? 'ok' : 'unknown') : 'unknown',
      rag: syncResult && syncResult.rag ? syncResult.rag.reason || (syncResult.rag.ok ? 'ok' : 'unknown') : 'unknown',
    },
  });

  return {
    ok: true,
    message:
      syncResult && syncResult.message
        ? syncResult.message
        : 'Memória registrada. A Persona recebeu o contexto e o Executor recebeu regras para próximas tarefas.',
    learning: upsert.learning,
    sync: syncResult,
    knowledgeStatus: syncResult && syncResult.status ? syncResult.status : null,
  };
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

function buildAppendDiffPreview(targetFile, previousContent, appendedBlock) {
  const previousLinesCount = previousContent.length ? previousContent.split('\n').length : 0;
  const addedLines = appendedBlock.split('\n');
  const header = [
    `--- a/${targetFile}`,
    `+++ b/${targetFile}`,
    `@@ -${previousLinesCount},0 +${previousLinesCount + 1},${addedLines.length} @@`,
  ];
  const body = addedLines.map((line) => `+${line}`);
  return [...header, ...body].join('\n');
}

function buildWriteFileDiffPreview(targetFile, previousContent, nextContent) {
  const previousLines = previousContent.length ? previousContent.split('\n') : [];
  const nextLines = nextContent.split('\n');
  const header = [
    `--- a/${targetFile}`,
    `+++ b/${targetFile}`,
    `@@ -1,${previousLines.length} +1,${nextLines.length} @@`,
  ];
  const body = [
    ...previousLines.map((line) => `-${line}`),
    ...nextLines.map((line) => `+${line}`),
  ];
  return [...header, ...body].join('\n');
}

function buildOperationBatchDiffPreview(operations = []) {
  const chunks = [];
  for (const operation of operations) {
    if (operation.op === 'mkdir') {
      chunks.push(`+++ dir/${operation.path}`);
      continue;
    }

    if (operation.op === 'append_file') {
      const lines = String(operation.content || '').split('\n');
      const header = [`--- a/${operation.path}`, `+++ b/${operation.path}`, '@@ append @@'];
      const body = lines.map((line) => `+${line}`).slice(0, 120);
      chunks.push([...header, ...body].join('\n'));
      continue;
    }

    if (operation.op === 'write_file') {
      const lines = String(operation.content || '').split('\n').slice(0, 120);
      const header = [`--- a/${operation.path}`, `+++ b/${operation.path}`, `@@ -0,0 +1,${lines.length} @@`];
      const body = lines.map((line) => `+${line}`);
      chunks.push([...header, ...body].join('\n'));
    }
  }
  return chunks.join('\n');
}

function hasScaffoldIntent(userMessage) {
  const normalized = String(userMessage || '').toLowerCase();
  const buildVerb = /\b(crie|criar|gere|gerar|monte|montar|construa|construir|implemente|implementar|desenvolva|desenvolver|faca|fa[cç]a|produza|produzir)\b/.test(
    normalized
  );
  const requestStyle = /\b(quero|preciso|gostaria|poderia|segue com|pode seguir)\b/.test(normalized);
  const buildObject =
    /\b(aplica[cç][aã]o|app|sistema|site|projeto|calculadora|dashboard|api|landing)\b/.test(normalized) ||
    normalized.includes('landing page') ||
    normalized.includes('single page');
  return (buildVerb || requestStyle) && buildObject;
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
  const displayName = formatProviderDisplayName(provider);
  const details = clipText(String(errorMessage || '').replace(/\s+/g, ' ').trim(), 360);
  const lower = details.toLowerCase();

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
  return lines.length ? `Histórico recente:\n${lines.join('\n')}` : 'Histórico recente: indisponível.';
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
    response:
      schema.value.decision === 'execute'
        ? buildFriendlyExecutionStartResponse(schema.value.executionMessage || userMessage)
        : schema.value.response,
    executionMessage: sanitizeAssistantText(schema.value.executionMessage || userMessage, userMessage),
    confidence: schema.value.confidence,
    raw: rawRoute,
  };
}

async function requestPersonaRouteDecision({ projectInfo, userMessage = '', attachments = [], contextHint = null, conversationMessages = [] }) {
  const provider = getSelectedAiProvider();
  const defaultsAuthorized = shouldUseDefaultScaffoldConfiguration(userMessage);
  const hasProjectFilesForDeterministicEdit = Boolean(projectInfo && Number(projectInfo.totalFiles || 0) > 0);
  const deterministicEditIntent =
    hasProjectFilesForDeterministicEdit &&
    (Boolean(extractRequestedTitle(userMessage)) ||
      isButtonColorEditRequest(userMessage) ||
      isFooterInsertRequest(userMessage) ||
      isHydrationMismatchRepairRequest(userMessage));
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
      },
    };
  }

  if (defaultsAuthorized && (Boolean(contextHint && contextHint.awaitingScaffoldClarification) || hasScaffoldIntent(userMessage))) {
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
    return {
      ok: false,
      decision: 'chat',
      providerUnavailable: true,
      response: buildAiProviderUnavailableMessage(status || {}),
      meta: {
        planner: 'persona_router',
        reason: status && status.reason ? status.reason : 'provider_not_ready',
        provider: status && status.provider ? status.provider : getSelectedAiProvider(),
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
    'Use português natural, acolhedor e direto; evite respostas robóticas como "vou alterar" quando nenhuma alteração foi aplicada ainda.',
  ].join(' ');

  const userPrompt = [
    `Mensagem do usuário: ${String(userMessage || '').trim() || '[mensagem vazia]'}`,
    projectSummary ? `Projeto aberto: ${JSON.stringify(projectSummary)}` : 'Projeto aberto: nenhum.',
    formatConversationMessagesForPrompt(conversationMessages),
    contextHint && contextHint.lastJobContext
      ? `Último job conhecido: ${JSON.stringify(contextHint.lastJobContext).slice(0, 1800)}`
      : 'Último job conhecido: nenhum.',
    contextHint ? `Sinais de contexto: ${JSON.stringify(contextHint).slice(0, 1800)}` : 'Sinais de contexto: nenhum.',
    Array.isArray(attachments) && attachments.length
      ? `Anexos: ${attachments.map((item) => `${item.name || 'anexo'} (${item.type || 'tipo desconhecido'})`).join(', ')}`
      : 'Anexos: nenhum.',
    attachmentContext
      ? `Conteúdo útil extraído dos anexos (OCR/texto):\n${attachmentContext}`
      : 'Conteúdo útil extraído dos anexos: indisponível.',
    localDiagnosticsContext
      ? `Diagnóstico local dos arquivos atuais:\n${localDiagnosticsContext}`
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
      { options: { num_predict: 220 } }
    );
    const parsed = tryParseJsonObject(raw);
    let normalized = normalizePersonaRouteDecision(parsed, userMessage);
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
        },
      };
    }

    const fallbackResponse = looksLikeInvalidPersonaText(raw)
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
    const message = error && error.message ? error.message : String(error || '');
    appendAuditEvent('assistant.route_provider_failed', {
      provider,
      rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      message,
    });
    return {
      ok: false,
      decision: 'chat',
      providerUnavailable: true,
      response: buildAiProviderFailureMessage(provider, message),
      meta: {
        planner: 'persona_router',
        reason: `provider_error:${message}`,
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
      ? `Memória recuperada: ${mempalaceContext.contextText}`
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

  if (hasScaffoldIntent(userMessage)) {
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
  return /(ai_error:|ai_provider_error:|rwkv_error:|gemini_error:|sambanova_error:|openai_error:|deepseek_error:|custom_api_error:|mock_error:)/i.test(text);
}

async function callAiProviderChat(model, messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, requestOptions = {}) {
  const registry = createProviderRegistry({
    appendAuditEvent,
    callCustomProviderChat,
    callGeminiChat,
    callMockPersonaProviderChat,
    callRwkvProviderChat,
    callSambaNovaChat,
    getEffectiveGeminiModel,
    getEffectiveSambaNovaModel,
    getSelectedAiProvider,
    rwkvEnabled: RWKV_ENABLED,
  });

  return registry.chat(model, messages, timeoutMs, requestOptions);
}

async function callPersonaProviderChat(model, messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, requestOptions = {}) {
  return callAiProviderChat(model, messages, timeoutMs, requestOptions);
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

async function requestBrainPlannerResponse({
  projectInfo,
  userMessage,
  attachments,
  basePlan,
  mempalaceContext,
  cortexContext,
  contextHint = {},
}) {
  const runtimeSettings = getRuntimeProfileSettings();
  const compactProject = {
    rootPath: projectInfo.rootPath,
    stacks: projectInfo.stacks,
    totalFiles: projectInfo.totalFiles,
    counters: projectInfo.counters,
    sampleFiles: (projectInfo.files || []).slice(0, runtimeSettings.brainSampleFilesLimit),
  };
  const projectEvolutionContext = buildProjectEvolutionContext(projectInfo, userMessage, {
    maxFiles: Math.max(4, Math.min(10, Number(runtimeSettings.brainSampleFilesLimit) || 8)),
    maxCharsPerFile: 950,
    totalMaxChars: 5600,
  });

  const systemPrompt =
    'Você é uma arquiteta de software que conversa com usuário final de forma simples e humana. ' +
    `${COMMUNICATION_STYLE_GUIDE} ` +
    `${PERSONA_HUMANIZATION_PROTOCOL} ` +
    'Não exponha detalhes internos técnicos sem solicitação explícita. ' +
    'Quando houver pedido de edição, confirme o entendimento em linguagem comum, explique o efeito esperado e peça confirmação. ' +
    'Use no máximo 3 perguntas por resposta quando estiver clarificando.';

  const userPrompt = [
    `Pedido do usuário: ${userMessage}`,
    contextHint && contextHint.awaitingScaffoldClarification
      ? `Contexto de diálogo: estamos em fase de clarificação para criação de aplicação (tentativas anteriores: ${
          Number(contextHint.scaffoldClarificationAttempts || 0)
        }).`
      : 'Contexto de diálogo: turno normal.',
    attachments.length
      ? `Anexos recebidos: ${attachments.map((a) => `${a.name} (${a.type || 'desconhecido'})`).join(', ')}`
      : 'Anexos recebidos: nenhum',
    basePlan.action && basePlan.action.targetFile
      ? `Arquivo alvo interno escolhido pelo sistema: ${basePlan.action.targetFile}`
      : `Ação interna proposta: ${basePlan.action ? basePlan.action.type : 'informacional sem ação técnica'}`,
    `Contexto resumido do projeto: ${JSON.stringify(compactProject)}`,
    mempalaceContext && mempalaceContext.contextText
      ? `Memória recuperada do MemPalace (use apenas o que for relevante e confiável):\n${mempalaceContext.contextText}`
      : 'Memória recuperada do MemPalace: indisponível para esta tentativa.',
    cortexContext && cortexContext.available && cortexContext.contextText
      ? `Conhecimento compartilhado do Cortex (Persona + execução):\n${cortexContext.contextText}`
      : 'Conhecimento compartilhado do Cortex: sem entradas úteis nesta tentativa.',
    `Protocolo interno: gere resposta de orquestração da Persona. A execução ficará no executor estático via contrato ${PERSONA_PROTOCOL_VERSION}.`,
  ].join('\n');

  const content = await callPersonaProviderChat(PERSONA_MODEL_BRAIN, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
  return sanitizeAssistantText(content, basePlan.response || 'Certo, vou te ajudar com isso.');
}


function checkpointCortexRuntime(jobId, workGraph, runtimeBudget, extra = {}) {
  if (!jobId) return;
  setJobCheckpoint(jobId, 'cortex_runtime', createCortexRuntimeCheckpoint(workGraph, runtimeBudget, extra));
}

function compactPromptPart(value, limit) {
  return clipText(String(value || ''), Math.max(200, Number(limit) || 1200));
}

function buildCortexPausePlan({ projectInfo, userMessage, attachments, runtimeBudget }) {
  const basePlan = buildConfirmationPlan(projectInfo, userMessage, attachments);
  return {
    ...(basePlan.ok ? basePlan : { ok: true, response: '', action: null }),
    action: null,
    response: [
      'Pausei este trabalho antes de iniciar nova inferência porque o Cortex detectou pressão crítica de memória local (guard ativo para provedores locais).',
      'O pedido ficou preservado no job. Feche apps pesados ou aguarde o Mac aliviar a memória, depois use tentar novamente para retomar sem reabrir tudo do zero.',
    ].join(' '),
    meta: {
      planner: 'cortex_runtime',
      model: null,
      reason: 'paused_memory_pressure',
      runtime: CORTEX_RENDER_RUNTIME_VERSION,
      runtimeBudget,
    },
  };
}

async function runCortexRenderRuntimePlan({ projectInfo, userMessage, attachments = [], contextHint = {}, jobId = null }) {
  const runtimeSettings = getRuntimeProfileSettings();
  const runtimeBudget = await getCortexRuntimeBudget();
  if (jobId) {
    markJobPhase(jobId, 'cortex_intake', { runtime: CORTEX_RENDER_RUNTIME_VERSION });
    setJobCheckpoint(jobId, 'runtime_budget', runtimeBudget);
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
  const defaultScaffoldAuthorized =
    shouldUseDefaultScaffoldConfiguration(userMessage) || shouldUseDefaultScaffoldConfiguration(effectiveUserMessage);
  const brainBudget = getBrainBudgetSettings(runtimeSettings);
  const clarificationAttempts = Number(contextHint && contextHint.scaffoldClarificationAttempts ? contextHint.scaffoldClarificationAttempts : 0);
  const latestDiagnostics = contextHint && contextHint.latestDiagnostics ? contextHint.latestDiagnostics : null;
  const executionIntent = resolveExecutionIntent(effectiveUserMessage, contextHint, projectInfo);
  if (
    !defaultScaffoldAuthorized &&
    (executionIntent === 'init_project' || hasScaffoldIntent(effectiveUserMessage)) &&
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
      },
    };
  }
  const mempalaceContext = projectInfo
    ? await buildMempalacePlannerContext(projectInfo, effectiveUserMessage)
    : { ok: false, available: false, reason: 'missing_project' };
  const mempalaceCore = projectInfo
    ? await buildMempalaceCortexCore(projectInfo, effectiveUserMessage, runtimeSettings)
    : { ok: false, available: false, reason: 'missing_project' };
  const ragContext = projectInfo
    ? await buildRagPlannerContext(projectInfo, effectiveUserMessage, attachments, runtimeSettings)
    : { ok: false, available: false, reason: 'missing_project', provider: CORTEX_RAG_PROVIDER };
  const cortexContext = buildCortexPromptContext(projectInfo && projectInfo.id ? projectInfo.id : null, effectiveUserMessage, runtimeSettings);
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
  if (jobId) markJobPhase(jobId, 'cortex_briefing', { passId: brainPass.id });
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
      },
    };
  }

  if (brainBriefing && brainBriefing.needsClarification && defaultScaffoldAuthorized) {
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
  if (jobId) markJobPhase(jobId, 'cortex_render_pass', { passId: renderPass.id });
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
      workGraph,
      runtimeBudget,
      latestDiagnostics,
      artifactContext,
      executionIntent,
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
      workGraph,
      runtimeBudget,
      latestDiagnostics,
      executionIntent,
      artifactContext,
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
  if (jobId) markJobPhase(jobId, 'cortex_validation', { score: validation.score });
  if (!validation.ready) {
    const repairValidationResult = await runRepairValidationLoop({
      projectInfo,
      userMessage: effectiveUserMessage,
      attachments,
      mempalaceContext,
      mempalaceCore,
      ragContext,
      cortexContext,
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
        artifactMinimum: 'artifactMinimum (qualidade visual/aderência abaixo do mínimo)',
        artifactStack: 'artifactStack (stack solicitada não preservada)',
        artifactCss: 'artifactCss (CSS visual insuficiente)',
      };
      const formatChecks = (checks) => checks.map((key) => checkLabels[key] || key).join(', ');
      const coreBlockingChecks = ['operations', 'files', 'runnableEntry', 'patchFirst', 'artifactMinimum'];
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
      `A validação técnica marcou ${validation.score}% (mínimo ${validation.minScore}%).${artifactQualitySummary} Deseja aplicar esses artefatos no projeto?`,
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


function isCssStylesheetRepairRequest(text = '') {
  const normalized = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const mentionsCss = /\b(css|style\.css|stylesheet|estilo)\b/.test(normalized);
  const mentionsHtml = /\b(html|index\.html|pagina|site|arquivo)\b/.test(normalized);
  const mentionsConnection = /(conect|carreg|link|href|import|nao esta funcionando|nao funciona|corrig)/.test(normalized);
  return mentionsCss && mentionsHtml && mentionsConnection;
}

function toPosixPath(filePath = '') {
  return String(filePath || '').split(path.sep).join('/');
}

function findProjectRelativeFile(projectRoot, projectInfo, fileName) {
  const directCandidates = [fileName, `public/${fileName}`, `src/${fileName}`, `pages/${fileName}`];
  for (const candidate of directCandidates) {
    if (fs.existsSync(path.join(projectRoot, candidate))) return candidate;
  }
  const files = Array.isArray(projectInfo && projectInfo.files) ? projectInfo.files : [];
  const match = files.find((item) => {
    const rel = typeof item === 'string' ? item : item && (item.path || item.relativePath || item.name);
    return rel && path.basename(rel) === fileName;
  });
  if (!match) return null;
  const rel = typeof match === 'string' ? match : match.path || match.relativePath || match.name;
  return rel ? toPosixPath(rel) : null;
}

function normalizeRelativeHref(fromFile, toFile) {
  const fromDir = path.posix.dirname(toPosixPath(fromFile));
  let href = path.posix.relative(fromDir === '.' ? '' : fromDir, toPosixPath(toFile));
  if (!href || href === '') href = path.posix.basename(toFile);
  if (!href.startsWith('.') && !href.startsWith('/')) href = `./${href}`;
  return href;
}

function escapeRegExpLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceStylesheetHref(html, fromHref, toHref) {
  const source = String(html || '');
  const escapedFrom = escapeRegExpLiteral(fromHref);
  const patterns = [
    new RegExp(`(<link\\b[^>]*rel=["']?stylesheet["']?[^>]*href=["'])${escapedFrom}(["'][^>]*>)`, 'i'),
    new RegExp(`(<link\\b[^>]*href=["'])${escapedFrom}(["'][^>]*rel=["']?stylesheet["']?[^>]*>)`, 'i'),
  ];
  for (const pattern of patterns) {
    const next = source.replace(pattern, `$1${toHref}$2`);
    if (next !== source) return { changed: true, content: next };
  }
  return { changed: false, content: source };
}

function ensureHtmlHasStylesheetLink(html, href) {
  const source = String(html || '');
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existingStyleLink = new RegExp(`<link\\b[^>]*rel=["']?stylesheet["']?[^>]*href=["'][^"']*style\\.css["'][^>]*>`, 'i');
  const exactLink = `<link rel="stylesheet" href="${href}">`;

  if (existingStyleLink.test(source)) {
    const next = source.replace(existingStyleLink, exactLink);
    return { changed: next !== source, content: next };
  }

  const alreadyExact = new RegExp(`<link\\b[^>]*href=["']${escapedHref}["'][^>]*rel=["']?stylesheet["']?[^>]*>|<link\\b[^>]*rel=["']?stylesheet["']?[^>]*href=["']${escapedHref}["'][^>]*>`, 'i');
  if (alreadyExact.test(source)) return { changed: false, content: source };

  const line = `  ${exactLink}\n`;
  if (/<\/head>/i.test(source)) {
    return { changed: true, content: source.replace(/<\/head>/i, `${line}</head>`) };
  }
  if (/<head\b[^>]*>/i.test(source)) {
    return { changed: true, content: source.replace(/<head\b[^>]*>/i, (match) => `${match}\n${line.trimEnd()}`) };
  }
  if (/<html\b[^>]*>/i.test(source)) {
    return {
      changed: true,
      content: source.replace(/<html\b[^>]*>/i, (match) => `${match}\n<head>\n  <meta charset="UTF-8">\n${line}</head>`),
    };
  }
  return {
    changed: true,
    content: `<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="UTF-8">\n${line}</head>\n<body>\n${source}\n</body>\n</html>\n`,
  };
}

function isCssRuntimeRepairRequest(text = '') {
  const normalized = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const mentionsCss = /\b(css|style\.css|stylesheet|estilo|estilos|visual|cores|tipografia)\b/.test(normalized);
  const mentionsProblem = /(quebrad|sem estilo|sem estilos|html estatico|nao esta funcionando|nao funciona|nao carrega|carreg|conect|corrig|arrum|visual)/.test(normalized);
  return mentionsCss && mentionsProblem;
}

function repairInvalidCssCustomPropertyReferences(css = '') {
  const source = String(css || '');
  let replacements = 0;
  const content = source.replace(/var\(\s*-{3,}([a-zA-Z0-9_-]+)(\s*,[^)]*)?\s*\)/g, (_match, name, fallback = '') => {
    replacements += 1;
    return `var(--${name}${fallback || ''})`;
  });
  return {
    changed: content !== source,
    content,
    replacements,
  };
}

function buildCssRuntimeRepairOperationBatch({ projectInfo, userMessage, attachments = [], executionIntent, reason = 'css_runtime_repair' }) {
  if (executionIntent !== 'edit_project') return null;
  const projectRoot = projectInfo && projectInfo.rootPath;
  if (!projectRoot) return null;

  const styleRel = findProjectRelativeFile(projectRoot, projectInfo, 'style.css');
  if (!styleRel) return null;

  const styleAbs = path.join(projectRoot, styleRel);
  if (!fs.existsSync(styleAbs)) return null;

  const currentCss = fs.readFileSync(styleAbs, 'utf8');
  const result = repairInvalidCssCustomPropertyReferences(currentCss);
  if (!result.changed) return null;

  const linkAlreadyOkNote = reason === 'css_link_already_ok_css_runtime_repair'
    ? 'O link do CSS ja estava presente; encontrei a raiz do problema no proprio CSS. '
    : '';

  return {
    ok: true,
    action: {
      type: 'operation_batch',
      intent: 'edit_project',
      rootPath: projectRoot,
      targetFile: styleRel,
      operations: [
        {
          op: 'write_file',
          path: styleRel,
          content: result.content,
        },
      ],
      diffPreview: `Corrigir ${result.replacements} referencia(s) invalida(s) de variaveis CSS em ${styleRel}.`,
      summary: `${linkAlreadyOkNote}Corrigir referencias invalidas de variaveis CSS em ${styleRel} para o navegador aplicar cores, fundos e tipografia corretamente.`,
      userMessage,
      attachments,
      generatedBy: 'automata_static_css_runtime_repair',
    },
    raw: reason,
  };
}

const deterministicEditService = createDeterministicEditService({
  fs,
  path,
  buildOperationBatchDiffPreview,
  normalizeRequestedRelativePath,
});

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
  SAMBANOVA_API_BASE_URL,
  SAMBANOVA_API_KEY,
  extractJsonFromMixedText,
  getCortexRuntimeBudget,
  getEffectiveGeminiApiKey,
  getEffectiveGeminiModel,
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
let toolRegistryInstance = null;

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

function getToolRegistry() {
  if (!toolRegistryInstance) {
    toolRegistryInstance = createToolRegistry();
    for (const tool of createAutomataTools(getAutomataExecutor())) {
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
  collectGitDiffStats,
  getProjectGitStatus,
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

let assistantFlowInstance = null;

function getAssistantFlow() {
  if (!assistantFlowInstance) {
    assistantFlowInstance = createAssistantFlow({
      appendAuditEvent,
      appendJobEvent,
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
      requestPersonaRouteDecision,
      runtimeVersion: CORTEX_RENDER_RUNTIME_VERSION,
      setJobCheckpoint,
    });
  }
  return assistantFlowInstance;
}

function appendAssistantRouteAudit(route, projectInfo) {
  return getAssistantFlow().appendAssistantRouteAudit(route, projectInfo);
}

async function buildAssistantPlanResponse(payload = {}) {
  return getAssistantFlow().buildAssistantPlanResponse(payload);
}

async function handleAssistantMessage(payload = {}) {
  return getAssistantFlow().handleAssistantMessage(payload);
}

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, 'assets', 'logo_faber.png'),
    path.join(__dirname, 'assets', 'temp_logo_faber.png'),
    path.join(__dirname, 'build', 'icon.png'),
    path.join(process.cwd(), 'assets', 'logo_faber.png'),
    path.join(process.cwd(), 'assets', 'temp_logo_faber.png'),
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

  registerProjectHandlers({
    appendAuditEvent,
    authorizeProjectRoot,
    buildNextSteps,
    buildProjectPreviewPlan,
    buildProjectVerificationPlan,
    collectGitDiffStats,
    collectProjectFilesTree,
    dialog,
    getProjectGitStatus,
    getRuntimeDiffStats,
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
    writeProjectsSnapshot,
  });

  registerGithubHandlers({
    appendAuditEvent,
    authorizeProjectRoot,
    buildGithubPublishPlan,
    executeGithubPublish,
    getGithubAuthStatus,
    registerIpcHandler,
    scanProject,
  });

  registerPreviewHandlers({
    appendAuditEvent,
    authorizeProjectRoot,
    getProjectPreviewRuntimeStatus,
    registerIpcHandler,
    scanProject,
    shell,
    startProjectPreview,
    stopProjectPreview,
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
    const route = await requestPersonaRouteDecision({
      projectInfo: project.projectInfo,
      userMessage: userMessage || '',
      attachments: attachments || [],
      contextHint: contextHint || null,
      conversationMessages: conversationMessages || [],
    });
    appendAssistantRouteAudit(route, project.projectInfo);
    return route;
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

    try {
      const rootPath = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
      const autoRepairMaxPasses = Math.max(0, Math.min(5, Number.isFinite(Number(AUTO_REPAIR_MAX_PASSES)) ? Number(AUTO_REPAIR_MAX_PASSES) : 0));
      const originalUserMessage = initialAction && typeof initialAction.userMessage === 'string' ? initialAction.userMessage : '';
      const originalAttachments = initialAction && Array.isArray(initialAction.attachments) ? initialAction.attachments : [];

      let currentAction = initialAction;
      let currentProjectInfo = projectInfo;
      let autoRepairAttempt = 0;

      while (true) {
        if (jobId) {
          appendJobEvent(jobId, 'job.execute_pass_started', {
            executionPass: autoRepairAttempt + 1,
            totalPlannedPasses: autoRepairMaxPasses + 1,
            targetFile: currentAction && currentAction.targetFile ? currentAction.targetFile : null,
            intent: currentAction && currentAction.intent ? currentAction.intent : null,
          });
        }

        const result = executeAction(currentAction);
        if (!result.ok) {
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
        const qualityReport = await runPostExecutionQualityReport(refreshed, {
          modifiedFiles: result.modifiedFiles || [],
          userMessage: originalUserMessage,
          attachments: originalAttachments,
          executionIntent: currentAction && currentAction.intent ? currentAction.intent : '',
          artifactContext: currentAction && currentAction.artifactContext ? currentAction.artifactContext : '',
        });
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

        if (!effectGate.shouldBlock && !qualityGate.shouldBlock) {
          if (jobId) {
            setJobCheckpoint(jobId, 'execute_result', {
              ok: true,
              modifiedFiles: result.modifiedFiles || [],
              message: result.message || null,
              qualitySummary: qualityReport && qualityReport.summary ? qualityReport.summary : null,
              executionReport,
              autoRepairAttempt,
            });
            markJobCompleted(jobId, {
              modifiedFiles: result.modifiedFiles || [],
              qualitySummary: qualityReport && qualityReport.summary ? qualityReport.summary : null,
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
            diffTotals: executionReport && executionReport.totals ? executionReport.totals : null,
            autoRepairAttempt,
          });
          return {
            ...result,
            projectInfo: refreshed,
            nextSteps: buildNextSteps(refreshed),
            qualityReport,
            executionReport,
            autoRepairAttempt,
          };
        }

        const blockedByEffectGate = effectGate.shouldBlock;
        const blockedByQualityGate = qualityGate.shouldBlock;
        const gateMessage = blockedByEffectGate
          ? buildExecutionEffectGateMessage(effectGate)
          : buildPostExecutionGateMessage(qualityGate);
        const gateReason = blockedByEffectGate ? effectGate.reason : qualityGate.reason;

        if (jobId) {
          const summary = qualityReport && qualityReport.summary ? qualityReport.summary : {};
          appendJobEvent(jobId, 'job.execute_validation_blocked', {
            reason: gateReason,
            errors: Number(summary.errors || 0),
            warnings: Number(summary.warnings || 0),
            filesChecked: Number(summary.filesChecked || 0),
            modifiedFilesCount: Number(effectGate.modifiedFilesCount || 0),
            totalDelta: Number(effectGate.totalDelta || 0),
            blockedBy: blockedByEffectGate ? 'execution_effect' : 'post_exec_quality',
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
          blockedBy: blockedByEffectGate ? 'execution_effect' : 'post_exec_quality',
          modifiedFilesCount: Number(effectGate.modifiedFilesCount || 0),
          totalDelta: Number(effectGate.totalDelta || 0),
          autoRepairAttempt,
        });

        const canAutoRepair =
          AUTO_REPAIR_ENABLED &&
          autoRepairAttempt < autoRepairMaxPasses &&
          Boolean(String(originalUserMessage || '').trim());

        if (!canAutoRepair) {
          if (jobId) {
            setJobCheckpoint(jobId, 'execute_result', {
              ok: false,
              blockedByPostExecutionValidation: true,
              modifiedFiles: result.modifiedFiles || [],
              qualitySummary: qualityReport && qualityReport.summary ? qualityReport.summary : null,
              executionReport,
              reason: gateReason,
              blockedBy: blockedByEffectGate ? 'execution_effect' : 'post_exec_quality',
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
            blockedByExecutionEffect: blockedByEffectGate,
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
            blockedBy: blockedByEffectGate ? 'execution_effect' : 'post_exec_quality',
          });
        }

        const latestDiagnostics = buildDiagnosticsHintFromQualityReport(qualityReport);
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
            blockedByExecutionEffect: blockedByEffectGate,
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
      if (jobId) {
        markJobFailed(jobId, error.message, 'execute_failed');
      }
      appendAuditEvent('assistant.execute_failed', {
        rootPath: projectInfo ? projectInfo.rootPath : null,
        jobId,
        message: error.message,
      });
      return { ok: false, message: `Erro na execução: ${error.message}` };
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
    SAMBANOVA_API_BASE_URL,
    SAMBANOVA_API_KEY,
    appendAuditEvent,
    getAiRuntimeStatus,
    getEffectiveGeminiApiKey,
    getEffectiveGeminiModel,
    getEffectiveSambaNovaApiKey,
    getEffectiveSambaNovaModel,
    maskApiKeyTail,
    normalizeAiProviderName,
    readAiRuntimeSettings,
    registerIpcHandler,
    sanitizeCustomApiProfiles,
    sanitizeGeminiModelName,
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
    normalizeAuthorizedProjectInfo,
    registerIpcHandler,
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
  stopAllProjectPreviews().catch(() => {});
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
