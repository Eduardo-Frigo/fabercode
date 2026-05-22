function createMainRuntimeConfig({
  cwd = process.cwd(),
  dirname = __dirname,
  env = process.env,
  fs,
  normalizeAiProviderName,
  path,
  platform = process.platform,
} = {}) {
  if (!fs) throw new Error('main runtime config dependency missing: fs');
  if (!path) throw new Error('main runtime config dependency missing: path');
  if (typeof normalizeAiProviderName !== 'function') {
    throw new Error('main runtime config dependency missing: normalizeAiProviderName');
  }

  const MAX_AUDIT_EVENTS = 300;
  const MAX_CONVERSATION_MESSAGES = 200;
  const MAX_CORTEX_LEARNING_EVENTS = 80;
  const MAX_CORTEX_CONTEXT_ITEMS = 10;
  const MAX_JOB_EVENTS = 120;
  const MAX_JOBS_STORED = 180;
  const AI_PROVIDER_OPTIONS = ['mock', 'rwkv', 'openai', 'gemini', 'sambanova'];
  const AI_PROVIDER_ENV = normalizeAiProviderName(env.AI_PROVIDER || 'rwkv');
  const OPENAI_API_BASE_URL = env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
  const OPENAI_API_KEY = env.OPENAI_API_KEY || '';
  const OPENAI_MODEL_BRAIN_ENV = env.OPENAI_MODEL_BRAIN || 'gpt-5-codex';
  const PEXELS_API_KEY = env.PEXELS_API_KEY || env.PEXELS_ACCESS_KEY || '';
  const FABER_DATABASE_URL = env.FABER_DATABASE_URL || env.DATABASE_URL || '';
  const FABER_SESSION_SECRET = env.FABER_SESSION_SECRET || env.SESSION_SECRET || '';
  const FABER_APP_BASE_URL = env.FABER_APP_BASE_URL || 'http://127.0.0.1:37418';
  const FABER_BACKEND_HOST = env.FABER_BACKEND_HOST || '127.0.0.1';
  const FABER_BACKEND_PORT = Number.parseInt(env.FABER_BACKEND_PORT || '37418', 10);
  const FABER_POSTGRES_SSL = String(env.FABER_POSTGRES_SSL || 'false').toLowerCase() === 'true';
  const FABER_AUTH_DEV_CODES = String(env.FABER_AUTH_DEV_CODES || 'false').toLowerCase() === 'true';
  const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID || '';
  const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || '';
  const GOOGLE_REDIRECT_URI = env.GOOGLE_REDIRECT_URI || '';
  const OPENAI_MIN_REQUEST_INTERVAL_MS = Number.parseInt(
    env.OPENAI_MIN_REQUEST_INTERVAL_MS || '0',
    10
  );
  const OPENAI_MAX_REQUESTS_PER_MINUTE = Number.parseInt(
    env.OPENAI_MAX_REQUESTS_PER_MINUTE || '12',
    10
  );
  const GEMINI_API_BASE_URL = env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
  const GEMINI_API_KEY = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '';
  const GEMINI_MODEL_BRAIN_ENV = env.GEMINI_MODEL_BRAIN || 'gemini-2.0-flash';
  const GEMINI_MAX_REQUESTS_PER_MINUTE = Number.parseInt(
    env.GEMINI_MAX_REQUESTS_PER_MINUTE || '6',
    10
  );
  const SAMBANOVA_API_BASE_URL = env.SAMBANOVA_API_BASE_URL || 'https://api.sambanova.ai/v1';
  const SAMBANOVA_API_KEY = env.SAMBANOVA_API_KEY || '';
  const SAMBANOVA_MODEL_BRAIN_ENV = String(env.SAMBANOVA_MODEL_BRAIN || '').trim();
  const SAMBANOVA_MIN_REQUEST_INTERVAL_MS = Number.parseInt(
    env.SAMBANOVA_MIN_REQUEST_INTERVAL_MS || '10000',
    10
  );
  const SAMBANOVA_MAX_REQUESTS_PER_MINUTE = Number.parseInt(
    env.SAMBANOVA_MAX_REQUESTS_PER_MINUTE || '3',
    10
  );
  const PERSONA_MODEL_ENGINE = env.PERSONA_MODEL_ENGINE || 'rwkv-local';
  const PERSONA_MODEL_BRAIN = env.PERSONA_MODEL_BRAIN || 'rwkv-local';
  const AI_REQUEST_TIMEOUT_MS = Number.parseInt(
    env.AI_REQUEST_TIMEOUT_MS || '420000',
    10
  );
  const BRAIN_BRIEFING_TIMEOUT_MS = Number.parseInt(
    env.BRAIN_BRIEFING_TIMEOUT_MS || String(Math.max(AI_REQUEST_TIMEOUT_MS, 600000)),
    10
  );
  const GEMINI_MIN_REQUEST_INTERVAL_MS = Number.parseInt(
    env.GEMINI_MIN_REQUEST_INTERVAL_MS || '8000',
    10
  );
  const GEMINI_429_BASE_BACKOFF_MS = Number.parseInt(
    env.GEMINI_429_BASE_BACKOFF_MS || '60000',
    10
  );
  const GEMINI_429_MAX_BACKOFF_MS = Number.parseInt(
    env.GEMINI_429_MAX_BACKOFF_MS || '300000',
    10
  );
  const OPENAI_429_BASE_BACKOFF_MS = Number.parseInt(
    env.OPENAI_429_BASE_BACKOFF_MS || '12000',
    10
  );
  const OPENAI_429_MAX_BACKOFF_MS = Number.parseInt(
    env.OPENAI_429_MAX_BACKOFF_MS || '180000',
    10
  );
  const SAMBANOVA_429_BASE_BACKOFF_MS = Number.parseInt(
    env.SAMBANOVA_429_BASE_BACKOFF_MS || '12000',
    10
  );
  const SAMBANOVA_429_MAX_BACKOFF_MS = Number.parseInt(
    env.SAMBANOVA_429_MAX_BACKOFF_MS || '120000',
    10
  );
  const RWKV_ENABLED = String(env.RWKV_ENABLED || 'true').toLowerCase() === 'true';
  const RWKV_MODEL_PATH =
    env.RWKV_MODEL_PATH ||
    path.join(cwd, 'models', 'rwkv', 'RWKV-x070-World-0.4B-v2.9-20250107-ctx4096');
  const RWKV_TOKENIZER_PATH =
    env.RWKV_TOKENIZER_PATH ||
    path.join(cwd, 'models', 'rwkv', 'tokenizer.json');
  const RWKV_STRATEGY = env.RWKV_STRATEGY || 'cpu fp16';
  const RWKV_MAX_NEW_TOKENS = Number.parseInt(env.RWKV_MAX_NEW_TOKENS || '80', 10);
  const RWKV_TEMPERATURE = Number.parseFloat(env.RWKV_TEMPERATURE || '0.2');
  const RWKV_TOP_P = Number.parseFloat(env.RWKV_TOP_P || '0.9');
  const RWKV_V7_ON = String(env.RWKV_V7_ON || '0');
  const RWKV_PROVIDER_SCRIPT = path.join(dirname, 'cortex', 'rwkv', 'rwkv_provider.py');
  const AUTOMATA_BUNDLE_ROOT = env.AUTOMATA_BUNDLE_ROOT || path.resolve(dirname, '..', 'Automata');
  const CORTEX_RAG_ENABLED = String(env.CORTEX_RAG_ENABLED || 'true').toLowerCase() === 'true';
  const CORTEX_RAG_PROVIDER = String(env.CORTEX_RAG_PROVIDER || 'r2r').trim().toLowerCase();
  const R2R_BASE_URL = String(env.R2R_BASE_URL || 'http://127.0.0.1:7272').trim().replace(/\/+$/, '');
  const R2R_API_KEY = String(env.R2R_API_KEY || '').trim();
  const R2R_CORTEX_INGEST_ENDPOINT = String(env.R2R_CORTEX_INGEST_ENDPOINT || '').trim();
  const R2R_SEARCH_LIMIT = Number.parseInt(env.R2R_SEARCH_LIMIT || '6', 10);
  const R2R_STATUS_TIMEOUT_MS = Number.parseInt(env.R2R_STATUS_TIMEOUT_MS || '3500', 10);
  const R2R_TIMEOUT_MS = Number.parseInt(env.R2R_TIMEOUT_MS || '12000', 10);
  const TIME_AS_COMPUTE_PROFILE = String(env.TIME_AS_COMPUTE_PROFILE || 'auto').toLowerCase();
  const BRAIN_PLAN_MAX_ATTEMPTS_ENV = Number.parseInt(env.BRAIN_PLAN_MAX_ATTEMPTS || '2', 10);
  const BRAIN_PLAN_MAX_ELAPSED_MS_ENV = Number.parseInt(env.BRAIN_PLAN_MAX_ELAPSED_MS || '480000', 10);
  const SCAFFOLD_MAX_CLARIFICATIONS_ENV = Number.parseInt(env.SCAFFOLD_MAX_CLARIFICATIONS || '1', 10);
  const PERSONA_PROTOCOL_VERSION = 'persona.v1';
  const SUPPORTED_EXEC_PROTOCOLS = new Set([PERSONA_PROTOCOL_VERSION, 'a2.v1']);
  const JOB_RETRY_STAGNATION_LIMIT = Number.parseInt(env.JOB_RETRY_STAGNATION_LIMIT || '12', 10);
  const JOB_RETRY_NO_PROGRESS_MS = Number.parseInt(env.JOB_RETRY_NO_PROGRESS_MS || '1800000', 10);
  const JOB_PROGRESS_MIN_DELTA = Number.parseInt(env.JOB_PROGRESS_MIN_DELTA || '1', 10);
  const JOB_SOFT_TIMEOUT_MS = Number.parseInt(env.JOB_SOFT_TIMEOUT_MS || '3600000', 10);
  const JOB_RETRY_SAME_REASON_LIMIT = Number.parseInt(env.JOB_RETRY_SAME_REASON_LIMIT || '6', 10);
  const JOB_RETRY_SAME_FINGERPRINT_LIMIT = Number.parseInt(env.JOB_RETRY_SAME_FINGERPRINT_LIMIT || '3', 10);
  const CORTEX_VALIDATION_MIN_SCORE = Number.parseInt(env.CORTEX_VALIDATION_MIN_SCORE || '55', 10);
  const CORTEX_VALIDATION_REQUIRE_CORE = String(env.CORTEX_VALIDATION_REQUIRE_CORE || 'true').toLowerCase() === 'true';
  const CORTEX_VALIDATION_STALL_LIMIT = Number.parseInt(env.CORTEX_VALIDATION_STALL_LIMIT || '2', 10);
  const CORTEX_VALIDATION_REPAIR_MIN_IMPROVEMENT = Number.parseInt(
    env.CORTEX_VALIDATION_REPAIR_MIN_IMPROVEMENT || '2',
    10
  );
  const CORTEX_VALIDATION_REPAIR_STALL_LIMIT = Number.parseInt(
    env.CORTEX_VALIDATION_REPAIR_STALL_LIMIT || '1',
    10
  );
  const CORTEX_VALIDATION_MAX_RETRIES = Number.parseInt(env.CORTEX_VALIDATION_MAX_RETRIES || '8', 10);
  const CORTEX_BRIEFING_MAX_RETRIES = Number.parseInt(env.CORTEX_BRIEFING_MAX_RETRIES || '8', 10);
  const AUTOMATA_ENABLED = String(env.AUTOMATA_ENABLED || 'true').toLowerCase() === 'true';
  const AUTOMATA_STRICT_EXECUTION = String(env.AUTOMATA_STRICT_EXECUTION || 'true').toLowerCase() === 'true';
  const AIDER_MAIN_ROOT = env.AIDER_MAIN_ROOT || path.join(AUTOMATA_BUNDLE_ROOT, 'aider-main');
  const POST_EXEC_QUALITY_ENABLED = String(env.POST_EXEC_QUALITY_ENABLED || 'true').toLowerCase() === 'true';
  const POST_EXEC_QUALITY_MAX_FILES = Number.parseInt(env.POST_EXEC_QUALITY_MAX_FILES || '20', 10);
  const POST_EXEC_QUALITY_MAX_ISSUES = Number.parseInt(env.POST_EXEC_QUALITY_MAX_ISSUES || '40', 10);
  const POST_EXEC_QUALITY_TIMEOUT_MS = Number.parseInt(env.POST_EXEC_QUALITY_TIMEOUT_MS || '30000', 10);
  const POST_EXEC_QUALITY_ENFORCE_ERRORS = String(env.POST_EXEC_QUALITY_ENFORCE_ERRORS || 'true').toLowerCase() === 'true';
  const POST_EXEC_QUALITY_ENFORCE_WARNINGS = String(env.POST_EXEC_QUALITY_ENFORCE_WARNINGS || 'false').toLowerCase() === 'true';
  const EXECUTION_ENFORCE_EFFECT_GATE = String(env.EXECUTION_ENFORCE_EFFECT_GATE || 'true').toLowerCase() === 'true';
  const EXECUTION_ENFORCE_NONZERO_DIFF_ON_EDIT = String(
    env.EXECUTION_ENFORCE_NONZERO_DIFF_ON_EDIT || 'true'
  ).toLowerCase() === 'true';
  const AUTO_REPAIR_ENABLED = String(env.AUTO_REPAIR_ENABLED || 'true').toLowerCase() === 'true';
  const AUTO_REPAIR_MAX_PASSES = Number.parseInt(env.AUTO_REPAIR_MAX_PASSES || '2', 10);
  const AIDER_LINT_TIMEOUT_MS = Number.parseInt(env.AIDER_LINT_TIMEOUT_MS || '15000', 10);
  const MEMPALACE_LOCAL_VENV_PYTHON = path.join(
    dirname,
    '.venv-mempalace',
    platform === 'win32' ? 'Scripts' : 'bin',
    platform === 'win32' ? 'python.exe' : 'python3'
  );
  const MEMPALACE_PYTHON_BIN =
    env.MEMPALACE_PYTHON_BIN ||
    (fs.existsSync(MEMPALACE_LOCAL_VENV_PYTHON) ? MEMPALACE_LOCAL_VENV_PYTHON : 'python3');
  const MEMPALACE_COMMAND_TIMEOUT_MS = Number.parseInt(
    env.MEMPALACE_COMMAND_TIMEOUT_MS || '12000',
    10
  );
  const MEMPALACE_REPO_CANDIDATES = [
    env.MEMPALACE_REPO_PATH || null,
    path.join(dirname, '..', 'mempalace-develop'),
    path.join(cwd, '..', 'mempalace-develop'),
    path.join(cwd, 'mempalace-develop'),
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
  const providerRequestTimestampsMs = { openai: [], gemini: [], sambanova: [] };
  const providerCooldownUntilMs = { openai: 0, gemini: 0, sambanova: 0 };
  
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

  return {
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
    R2R_BASE_URL,
    R2R_API_KEY,
    R2R_CORTEX_INGEST_ENDPOINT,
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
  };
}

module.exports = {
  createMainRuntimeConfig,
};
