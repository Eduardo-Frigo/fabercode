#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { spawn, spawnSync } = require('child_process');

const { app, BrowserWindow, safeStorage } = require('electron');

const { createAutomataExecutor } = require('../cortex/automata/core/executor');
const { createAutomataTools } = require('../cortex/tools/automata_tools');
const { createToolRegistry } = require('../cortex/tools/registry');
const {
  extractOpenAiResponsesText,
  sanitizeOpenAiModelName,
} = (() => {
  const clients = require('../cortex/providers/remote_clients');
  const settings = require('../cortex/providers/runtime_settings');
  return {
    extractOpenAiResponsesText: clients.extractOpenAiResponsesText,
    sanitizeOpenAiModelName: settings.sanitizeOpenAiModelName,
  };
})();
const {
  createAiRuntimeSettingsService,
} = require('../cortex/providers/runtime_settings');
const { createSecretStore } = require('../main/security/secret_store');
const {
  AGENTIC_PROCESS_EXECUTION_POLICIES,
  createAgenticToolLoopService,
} = require('../main/services/agentic_tool_loop_service');
const {
  buildAgenticResponsesConversationInput,
  buildAgenticResponsesToolResultInput,
} = require('../main/services/agentic_model_tool_result_service');
const {
  createAgenticBrowserSessionService,
} = require('../main/services/agentic_browser_session_service');
const {
  createApplicationCreationCorpusEvaluator,
} = require('../main/services/application_creation_corpus_service');
const {
  createApplicationCreationLiveCorpusPolicy,
} = require('../main/services/application_creation_live_corpus_policy');
const {
  createApplicationCreationLiveCorpusModelResolver,
} = require('../main/services/application_creation_live_corpus_model_resolver');
const {
  createApplicationCreationLiveCorpusRepairService,
} = require('../main/services/application_creation_live_corpus_repair_service');
const { createProjectScanner } = require('../main/services/project_scanner');
const {
  createProjectVerificationService,
} = require('../main/services/project_verification_service');

const LIVE_CORPUS_REPORT_VERSION = 'application-creation-live-corpus.v1';
const PROVIDER_TIMEOUT_MS = 180_000;
const COMMAND_TIMEOUT_MS = 600_000;
const SERVER_START_TIMEOUT_MS = 30_000;
const MAX_LOG_CHARS = 4_000;
const SYSTEM_READ_PATHS = Object.freeze([
  '/Applications',
  '/Library',
  '/System',
  '/bin',
  '/dev',
  '/opt',
  '/private/etc',
  '/private/var/db',
  '/private/var/select',
  '/sbin',
  '/usr',
]);
let cleanupTemporaryWorkspace = () => {};

function keepLiveCorpusProcessAlive() {}

function parseArgs(argv = []) {
  const output = {
    scenario: '',
    reportPath: '',
    resumeReportPath: '',
    keepTemp: false,
  };
  for (const raw of argv) {
    const value = String(raw || '');
    if (value === '--keep-temp') output.keepTemp = true;
    else if (value.startsWith('--scenario=')) output.scenario = value.slice('--scenario='.length).trim();
    else if (value.startsWith('--report=')) output.reportPath = value.slice('--report='.length).trim();
    else if (value.startsWith('--resume-report=')) {
      output.resumeReportPath = value.slice('--resume-report='.length).trim();
    }
  }
  return output;
}

function clipText(value = '', maximum = MAX_LOG_CHARS) {
  const text = String(value || '').replace(/\0/g, '');
  return text.length > maximum ? `${text.slice(0, maximum - 3)}...` : text;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeRelativePath(value = '') {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized === '..'
    || normalized.startsWith('../') || normalized.includes('\0')) return '';
  return normalized.replace(/^\.\/+/, '');
}

function isInsideRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function listProjectFiles(rootPath) {
  const files = [];
  const pending = [rootPath];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.live-')
        || entry.name === '.next' || entry.name === 'dist' || entry.name === 'build') continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile()) files.push(path.relative(rootPath, absolutePath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function computeLineChangeStats(previous, next) {
  const previousLines = String(previous || '').split('\n');
  const nextLines = String(next || '').split('\n');
  return {
    added: Math.max(0, nextLines.length - previousLines.length),
    removed: Math.max(0, previousLines.length - nextLines.length),
  };
}

function createExecutor() {
  return createAutomataExecutor({
    computeLineChangeStats,
    fs,
    hashText: (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex'),
    ingestRuntimeDiffStats: () => {},
    isTextLikeExtension: () => true,
    mergeDiffStatsEntry: (target, file, stats) => {
      target[file] = stats;
    },
    normalizeRelativePathForDiff: normalizeRelativePath,
    normalizeRequestedRelativePath: normalizeRelativePath,
    path,
    validateExecutionCommand: () => ({ ok: true }),
  });
}

function createFileToolSurface(projectRoot) {
  const registry = createToolRegistry();
  const executor = createExecutor();
  for (const tool of createAutomataTools(executor)) registry.register(tool);

  function assertBoundRoot(requestRoot) {
    const actual = fs.realpathSync(String(requestRoot || ''));
    if (actual !== fs.realpathSync(projectRoot)) {
      throw new Error('live corpus capability root mismatch');
    }
  }

  return Object.freeze({
    async executeCapability(request = {}) {
      const session = request.projectSession || {};
      assertBoundRoot(session.rootPath);
      if (request.capability !== 'filesystem') {
        return { ok: false, status: 'blocked', message: 'Capacidade não disponível no corpus vivo.' };
      }
      if (request.action === 'project_tree') {
        const files = listProjectFiles(projectRoot).slice(0, 500);
        return {
          ok: true,
          status: 'completed',
          message: `${files.length} arquivo(s) no workspace temporário.`,
          data: { files },
        };
      }
      if (request.action === 'read_file') {
        const relativePath = normalizeRelativePath(request.payload && request.payload.path);
        const absolutePath = relativePath ? path.resolve(projectRoot, relativePath) : '';
        if (!relativePath || !isInsideRoot(projectRoot, absolutePath)
          || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
          return { ok: false, status: 'failed', message: 'Arquivo não encontrado no workspace temporário.' };
        }
        const maximum = Math.min(20_000, Math.max(200, Number(request.payload.maxChars) || 12_000));
        return {
          ok: true,
          status: 'completed',
          message: `Arquivo ${relativePath} lido.`,
          data: { content: fs.readFileSync(absolutePath, 'utf8').slice(0, maximum) },
        };
      }
      return { ok: false, status: 'blocked', message: 'Ação de filesystem não disponível.' };
    },
    executeTool(name, input) {
      return registry.execute(name, input);
    },
  });
}

function createRouteDecision(executionIntent = 'init_project') {
  return {
    decision: 'execute',
    productRoute: {
      capability: executionIntent === 'edit_project' ? 'edit_project' : 'create_project',
      executionIntent,
      mode: 'agentic',
      projectState: executionIntent === 'edit_project' ? 'existing_project' : 'empty_project',
    },
  };
}

function createScenarios() {
  const common = [
    'Trabalhe apenas no workspace temporário ativo.',
    'Não instale pacotes, não execute comandos, não use rede e não escreva segredos.',
    'Use somente dependências publicadas em registry.npmjs.org com versões explícitas ou ranges sem URL, Git ou file:.',
    'Não use fontes, imagens, APIs ou assets externos.',
    'Inclua scripts locais de build, test e start quando aplicáveis; nenhum preinstall, install, postinstall ou prepare.',
    'Implemente arquivos pequenos mas funcionais, depois use inspect_project_validation, corrija toda falha obrigatória e finalize.',
  ].join(' ');
  return [
    {
      id: 'next-react-backend',
      stack: 'Next/React backend',
      stacks: ['Next.js'],
      allowedRuleScopes: ['next'],
      options: { requiredNodeScripts: ['build', 'test'] },
      prompt: `${common} Crie um app Next.js App Router com TypeScript, React, página inicial, página de itens e backend em app/api/items/route.ts. Use next, react e react-dom, teste local com node --test e start com next start. Mantenha a configuração coerente: se package.json usar type=module, use next.config.mjs ou export default e nunca module.exports em next.config.js.`,
    },
    {
      id: 'supabase',
      stack: 'Supabase',
      stacks: ['Node/Express'],
      allowedRuleScopes: ['supabase'],
      options: { requirePersistence: true, userMessage: 'Crie backend persistente com Supabase.' },
      prompt: `${common} Crie um backend Node funcional com @supabase/supabase-js, supabase/config.toml, migration SQL, cliente em src/lib/supabase.js, repositório CRUD, servidor HTTP local, testes node --test e db:check totalmente offline.`,
    },
    {
      id: 'firebase',
      stack: 'Firebase',
      stacks: ['Node/Express'],
      allowedRuleScopes: ['firebase'],
      options: { requirePersistence: true, userMessage: 'Crie backend persistente com Firebase Firestore.' },
      prompt: `${common} Crie um backend Node funcional com firebase, firebase.json, firestore.rules, cliente em src/lib/firebase.js, repositório CRUD, servidor HTTP local, testes node --test e db:check totalmente offline.`,
    },
    {
      id: 'prisma-postgres',
      stack: 'Prisma/Postgres',
      stacks: ['Next.js'],
      allowedRuleScopes: ['next', 'prisma_postgres'],
      options: {
        requiredNodeScripts: ['build', 'test'],
        requirePersistence: true,
        persistenceValidationMode: 'offline',
        userMessage: 'Crie app Next com Prisma, Postgres, migration e seed.',
      },
      prompt: `${common} Crie um app Next.js mínimo com Prisma/Postgres, @prisma/client, prisma, schema.prisma, migration SQL, seed, db:check offline, repositório CRUD, rota API, build e testes que não dependam de banco ou Docker em execução. Não execute prisma generate: isole o acesso ao PrismaClient para que build e testes offline não precisem do cliente gerado.`,
    },
    {
      id: 'drizzle-sqlite',
      stack: 'SQLite/Drizzle',
      stacks: ['Node/Express'],
      allowedRuleScopes: ['drizzle_sqlite'],
      options: { requirePersistence: true, userMessage: 'Crie persistência SQLite com Drizzle.' },
      prompt: `${common} Crie um backend Node com drizzle-orm e SQLite, drizzle.config.js, schema, migration SQL, repositório CRUD, servidor HTTP local, build e testes offline. Evite dependência nativa; o db:check pode validar a migration sem abrir banco.`,
    },
    {
      id: 'python-fastapi',
      stack: 'Python/FastAPI',
      stacks: ['Python/FastAPI'],
      allowedRuleScopes: ['fastapi'],
      options: { requirePythonTests: true },
      prompt: `${common} Crie uma API Python FastAPI em backend/app/main.py com /health e CRUD em memória. Extraia a lógica CRUD para um módulo que use apenas a biblioteca padrão e teste essa lógica com unittest, sem importar FastAPI nos testes offline. Inclua requirements.txt fixado sem pytest. Não use pip nem tente instalar dependências.`,
    },
    {
      id: 'static-web',
      stack: 'Static Web',
      stacks: ['Static Web'],
      allowedRuleScopes: ['static_web'],
      options: {},
      prompt: `${common} Crie uma aplicação web estática acessível e funcional com index.html, style.css e app.js. Ela deve exibir um catálogo, permitir filtrar itens no navegador e não depender de servidor ou recurso externo.`,
    },
    {
      id: 'monorepo',
      stack: 'Monorepo',
      stacks: ['Monorepo'],
      allowedRuleScopes: ['monorepo'],
      options: {},
      prompt: `${common} Crie um monorepo npm workspaces com apps/web e packages/shared. Inclua build, test e start no root, uma aplicação web local funcional e uma biblioteca compartilhada, sem turbo e sem recurso externo.`,
    },
    {
      id: 'dirty-existing-application',
      stack: 'Existing Node application',
      stacks: ['Node/Express'],
      allowedRuleScopes: [],
      options: { requiredNodeScripts: ['build', 'test'] },
      executionIntent: 'edit_project',
      dirtyWorktree: true,
      prompt: `${common} Evolua a aplicação existente adicionando uma rota /health e teste correspondente em novos arquivos. Preserve exatamente src/existing.js e user-notes.md, não limpe Git e não altere o índice. Use apenas node:http e a biblioteca padrão; exporte um handler testável, não inicie servidor durante import e teste a resposta diretamente com node:test sem abrir socket.`,
    },
    {
      id: 'requested-product-capabilities',
      stack: 'Next product capabilities',
      stacks: ['Next.js'],
      allowedRuleScopes: ['next'],
      options: {
        requiredNodeScripts: ['build', 'test'],
        userMessage: 'Crie um app com autenticação, CRUD completo, upload de arquivos e múltiplas rotas.',
      },
      prompt: `${common} Crie um app Next.js mínimo mas funcional em JavaScript, sem TypeScript e sem tsconfig, com autenticação local, CRUD completo, upload multipart validado e múltiplas rotas. Inclua páginas login e dashboard; boundary auth_service com authenticate/verifyPassword; repositório com create/list/update/delete; input file e FormData; rota API que use request.formData e grave upload com node:fs writeFile; build, start e testes node --test.`,
    },
  ];
}

function seedScenario(scenario, rootPath) {
  fs.mkdirSync(rootPath, { recursive: true });
  if (!scenario.dirtyWorktree) return null;
  writeJson(path.join(rootPath, 'package.json'), {
    name: 'dirty-existing-live-corpus',
    version: '1.0.0',
    type: 'module',
    scripts: {
      build: 'node --check src/existing.js',
      test: 'node --test',
      start: 'node src/server.js',
    },
  });
  fs.mkdirSync(path.join(rootPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(rootPath, 'src/existing.js'), 'export const value = "user-dirty-change";\n', 'utf8');
  fs.writeFileSync(path.join(rootPath, 'user-notes.md'), 'Não sobrescrever esta anotação do usuário.\n', 'utf8');
  spawnSync('git', ['init', '-q'], { cwd: rootPath, encoding: 'utf8' });
  return Object.freeze({
    status: spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: rootPath,
      encoding: 'utf8',
    }).stdout,
    sourceHash: hashFile(path.join(rootPath, 'src/existing.js')),
    notesHash: hashFile(path.join(rootPath, 'user-notes.md')),
  });
}

function dirtySnapshot(rootPath) {
  return Object.freeze({
    status: spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: rootPath,
      encoding: 'utf8',
    }).stdout,
    sourceHash: hashFile(path.join(rootPath, 'src/existing.js')),
    notesHash: hashFile(path.join(rootPath, 'user-notes.md')),
  });
}

function parseAgenticToolCalls(responseData = {}) {
  const output = Array.isArray(responseData && responseData.output) ? responseData.output : [];
  return output
    .filter((item) => item && item.type === 'function_call' && item.name)
    .map((item) => {
      let input = {};
      try {
        input = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        input = { rawArguments: String(item.arguments || '') };
      }
      return {
        id: item.id || item.call_id || '',
        callId: item.call_id || item.id || '',
        name: item.name,
        input,
      };
    });
}

function createOpenAiTurnClient({ apiKey, baseUrl, model, policy, metrics }) {
  const destination = policy.resolveOfficialProviderDestination({ providerId: 'openai', baseUrl });
  const endpoint = `${destination.baseUrl}/responses`;
  let lastRequestAt = 0;

  return async function requestModelTurn({
    previousResponseId = '',
    systemPrompt = '',
    conversationMessages = [],
    toolResults = [],
    tools = [],
    timeoutMs = PROVIDER_TIMEOUT_MS,
  } = {}) {
    const waitMs = Math.max(0, 750 - (Date.now() - lastRequestAt));
    if (waitMs) await delay(waitMs);
    const input = previousResponseId
      ? buildAgenticResponsesToolResultInput(toolResults)
      : buildAgenticResponsesConversationInput(conversationMessages);
    if (!input.length) throw new Error('live corpus provider input is empty');

    const body = {
      model,
      input,
      instructions: String(systemPrompt || '').trim(),
      tools: Array.isArray(tools) && tools.length ? tools : undefined,
      tool_choice: 'auto',
      store: true,
      max_output_tokens: 4096,
    };
    if (/^gpt-5(?:[.-]|$)/i.test(model)) {
      body.reasoning = { effort: 'low' };
      body.text = { verbosity: 'medium' };
    }
    if (previousResponseId) body.previous_response_id = String(previousResponseId);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || PROVIDER_TIMEOUT_MS));
      try {
        lastRequestAt = Date.now();
        metrics.requests += 1;
        const response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const responseText = await response.text().catch(() => '');
          if (response.status === 429 && attempt < 3) {
            const retryAfter = Number(response.headers.get('retry-after'));
            await delay(Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(60_000, retryAfter * 1000)
              : attempt * 5_000);
            continue;
          }
          throw new Error(`OpenAI HTTP ${response.status}${responseText ? `: ${clipText(responseText, 360)}` : ''}`);
        }
        const data = await response.json();
        const usage = data && data.usage ? data.usage : {};
        metrics.inputTokens += Number(usage.input_tokens) || 0;
        metrics.outputTokens += Number(usage.output_tokens) || 0;
        metrics.totalTokens += Number(usage.total_tokens) || 0;
        return {
          responseId: data && data.id ? String(data.id) : '',
          text: extractOpenAiResponsesText(data),
          toolCalls: parseAgenticToolCalls(data),
        };
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error('OpenAI retry limit exceeded');
  };
}

function buildProjectInfo(scanner, rootPath, stacks) {
  const scanned = scanner.scanProject(rootPath);
  return {
    ...scanned,
    id: path.basename(rootPath),
    rootPath,
    realRootPath: fs.realpathSync(rootPath),
    stacks: [...stacks],
  };
}

function createInspectionCallback(scanner, scenario) {
  const staticVerification = createProjectVerificationService({
    fs,
    path,
    runCommand: async () => ({ ok: true, stdout: '', stderr: '' }),
  });
  return async ({ projectInfo, userMessage }) => {
    const refreshed = buildProjectInfo(scanner, projectInfo.rootPath, scenario.stacks);
    const plan = staticVerification.buildProjectVerificationPlan(refreshed, {
      ...scenario.options,
      acceptanceContext: userMessage,
      userMessage,
      requirePlaywright: 'if_available',
    });
    if (!plan || plan.ok !== true) {
      return {
        ok: true,
        staticReady: false,
        processValidationPending: true,
        staticChecks: [{
          id: 'project_verification_plan',
          label: 'Plano de validação',
          status: 'failed',
          required: true,
          detail: plan && plan.message ? String(plan.message) : 'Plano indisponível.',
        }],
        pendingCommands: [],
        warnings: [],
      };
    }
    const staticChecks = plan.steps
      .filter((step) => step && step.kind === 'static')
      .map((step) => ({
        id: String(step.id || ''),
        label: String(step.label || ''),
        status: step.expectedStatus === 'passed' ? 'passed' : 'failed',
        required: step.required === true,
        detail: String(step.detail || ''),
      }));
    const pendingCommands = plan.steps
      .filter((step) => step && (step.kind === 'command' || step.kind === 'manual'))
      .map((step) => ({
        id: String(step.id || ''),
        label: String(step.label || ''),
        commandText: String(step.commandText || ''),
        required: step.required === true,
        blockedBy: Array.isArray(step.blockedBy) ? step.blockedBy.map(String) : [],
      }));
    return {
      ok: true,
      staticReady: !staticChecks.some((step) => step.required && step.status === 'failed'),
      processValidationPending: true,
      staticChecks,
      pendingCommands,
      warnings: Array.isArray(plan.warnings) ? plan.warnings.map(String) : [],
    };
  };
}

function sandboxLiteral(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function canonicalSandboxPath(value) {
  const absolutePath = path.resolve(String(value || ''));
  try {
    return fs.realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

function sandboxAncestorPaths(value) {
  const output = [];
  const root = path.parse(value).root;
  let current = path.dirname(value);
  while (current && current !== root) {
    output.push(current);
    current = path.dirname(current);
  }
  return output.reverse();
}

function buildSandboxProfile({
  workspaceRoot,
  writablePaths = [],
  allowNetwork = false,
  networkMode = '',
}) {
  const canonicalWorkspaceRoot = canonicalSandboxPath(workspaceRoot);
  const canonicalWritablePaths = writablePaths.map(canonicalSandboxPath);
  const readPaths = [
    ...SYSTEM_READ_PATHS.map(canonicalSandboxPath),
    canonicalWorkspaceRoot,
    ...canonicalWritablePaths,
  ];
  const ancestorRules = [...new Set(sandboxAncestorPaths(canonicalWorkspaceRoot))]
    .map((value) => `(literal ${sandboxLiteral(value)})`)
    .join(' ');
  const readRules = [...new Set(readPaths)]
    .map((value) => `(subpath ${sandboxLiteral(value)})`)
    .join(' ');
  const writeRules = [canonicalWorkspaceRoot, ...canonicalWritablePaths]
    .map((value) => `(subpath ${sandboxLiteral(value)})`)
    .join(' ');
  const encodingPath = path.join(os.homedir(), '.CFUserTextEncoding');
  const encodingRule = fs.existsSync(encodingPath)
    ? `(literal ${sandboxLiteral(canonicalSandboxPath(encodingPath))})`
    : '';
  const networkRules = allowNetwork
    ? ['(allow network-outbound)']
    : networkMode === 'loopback'
      ? [
          '(allow network-bind (local tcp "localhost:*"))',
          '(allow network-inbound (local tcp "localhost:*"))',
          '(allow network-outbound (remote tcp "localhost:*"))',
        ]
      : ['(deny network*)'];
  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow signal (target same-sandbox))',
    '(allow sysctl-read)',
    '(allow mach-lookup (global-name "com.apple.SystemConfiguration.DNSConfiguration"))',
    '(allow ipc-posix-shm-read-data (ipc-posix-name "apple.shm.notification_center"))',
    `(allow file-read* (literal "/") (literal "/etc") (literal "/var") ${ancestorRules} ${encodingRule} ${readRules})`,
    `(allow file-write* ${writeRules})`,
    ...networkRules,
  ].join('\n');
}

function buildOfflineEnvironment(workspaceRoot) {
  const tempPath = path.join(workspaceRoot, '.live-tmp');
  const homePath = path.join(workspaceRoot, '.live-home');
  const cachePath = path.join(workspaceRoot, '.live-offline-cache');
  const userConfigPath = path.join(workspaceRoot, '.live-offline-npmrc');
  const globalConfigPath = path.join(workspaceRoot, '.live-offline-npmrc-global');
  fs.mkdirSync(tempPath, { recursive: true });
  fs.mkdirSync(homePath, { recursive: true });
  fs.mkdirSync(cachePath, { recursive: true });
  fs.writeFileSync(userConfigPath, '', 'utf8');
  fs.writeFileSync(globalConfigPath, '', 'utf8');
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    HOME: homePath,
    USERPROFILE: homePath,
    TMPDIR: tempPath,
    CI: '1',
    PORT: '',
    HOST: '127.0.0.1',
    NEXT_TELEMETRY_DISABLED: '1',
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_cache: cachePath,
    npm_config_userconfig: userConfigPath,
    npm_config_globalconfig: globalConfigPath,
    DATABASE_URL: 'postgresql://faber:faber@127.0.0.1:5432/faber',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'live-corpus-placeholder',
  };
}

function runSandboxedCommand({
  workspaceRoot,
  command,
  args = [],
  environment,
  profilePath,
  timeoutMs = COMMAND_TIMEOUT_MS,
}) {
  const startedAt = Date.now();
  const canonicalWorkspaceRoot = canonicalSandboxPath(workspaceRoot);
  const result = spawnSync('/usr/bin/sandbox-exec', ['-f', profilePath, command, ...args], {
    cwd: canonicalWorkspaceRoot,
    encoding: 'utf8',
    env: environment,
    maxBuffer: 8 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return {
    ok: !result.error && result.status === 0,
    code: result.error && result.error.code === 'ETIMEDOUT' ? 124 : result.status,
    signal: result.signal || null,
    stdout: clipText(result.stdout),
    stderr: clipText(
      result.stderr
        || (result.error && result.error.message)
        || (result.signal ? `Process terminated by ${result.signal}.` : '')
    ),
    durationMs: Date.now() - startedAt,
  };
}

function installNodeDependencies({ rootPath, policy, sharedRoot }) {
  if (!fs.existsSync(path.join(rootPath, 'package.json'))) {
    return { attempted: false, ok: true, lifecycleScriptsEnabled: false, suppressedLifecycleScripts: [] };
  }
  const install = policy.buildNpmInstallInvocation({
    rootPath,
    npmExecutable: '/usr/local/bin/npm',
  });
  if (install.dependencyCount === 0) {
    return {
      attempted: false,
      ok: true,
      code: 0,
      signal: null,
      stdout: 'No dependencies declared.',
      stderr: '',
      registryOrigin: install.registryOrigin,
      lifecycleScriptsEnabled: false,
      suppressedLifecycleScripts: [...install.suppressedLifecycleScripts],
      dependencyCount: 0,
    };
  }
  const canonicalRootPath = policy.assertTemporaryWorkspace(rootPath);
  const canonicalSharedRoot = policy.assertTemporaryWorkspace(sharedRoot);
  const installSupportPath = path.join(canonicalRootPath, '.live-install');
  fs.mkdirSync(installSupportPath, { recursive: true });
  const guardPath = path.join(installSupportPath, 'npm-registry-guard.cjs');
  const cachePath = path.join(canonicalSharedRoot, 'npm-cache');
  const userConfigPath = path.join(installSupportPath, 'npmrc');
  const globalConfigPath = path.join(installSupportPath, 'npmrc-global');
  const homePath = path.join(installSupportPath, 'home');
  const profilePath = path.join(canonicalRootPath, '.npm-install.sb');
  fs.copyFileSync(path.resolve(__dirname, '../scripts/npm_registry_egress_guard.cjs'), guardPath);
  fs.writeFileSync(userConfigPath, '', 'utf8');
  fs.writeFileSync(globalConfigPath, '', 'utf8');
  fs.mkdirSync(homePath, { recursive: true });
  fs.mkdirSync(cachePath, { recursive: true });
  fs.writeFileSync(profilePath, buildSandboxProfile({
    workspaceRoot: canonicalRootPath,
    writablePaths: [cachePath],
    allowNetwork: true,
  }), 'utf8');
  const environment = policy.buildNpmChildEnvironment(process.env, {
    homePath,
    cachePath,
    userConfigPath,
    globalConfigPath,
    networkGuardPath: guardPath,
  });
  const execution = runSandboxedCommand({
    workspaceRoot: canonicalRootPath,
    command: install.command,
    args: install.args,
    environment,
    profilePath,
  });
  if (execution.ok) policy.auditNpmLockfileEgress(rootPath);
  return {
    attempted: true,
    ...execution,
    registryOrigin: install.registryOrigin,
    lifecycleScriptsEnabled: false,
    suppressedLifecycleScripts: [...install.suppressedLifecycleScripts],
    dependencyCount: install.dependencyCount,
  };
}

function createVerificationRunner({ rootPath, installResult, executionLog }) {
  const canonicalRootPath = canonicalSandboxPath(rootPath);
  const profilePath = path.join(canonicalRootPath, '.offline-validation.sb');
  fs.writeFileSync(profilePath, buildSandboxProfile({ workspaceRoot: canonicalRootPath }), 'utf8');
  const environment = buildOfflineEnvironment(canonicalRootPath);

  return async (bin, args = [], options = {}) => {
    if (bin === 'npm' && args.length === 1 && args[0] === 'install') {
      const result = installResult.attempted
        ? {
            ok: installResult.ok,
            code: installResult.code,
            stdout: installResult.stdout || '',
            stderr: installResult.stderr || '',
          }
        : { ok: true, code: 0, stdout: 'No dependencies declared.', stderr: '' };
      executionLog.push({
        bin: 'npm',
        args: ['install', '--ignore-scripts'],
        ok: result.ok,
        code: result.code,
        signal: result.signal || null,
        message: result.ok ? '' : clipText(result.stderr || result.stdout, 1_200),
      });
      return result;
    }

    const executables = {
      npm: '/usr/local/bin/npm',
      node: '/usr/local/bin/node',
      python3: fs.existsSync('/usr/local/bin/python3') ? '/usr/local/bin/python3' : '/usr/bin/python3',
    };
    if (!Object.hasOwn(executables, bin)) {
      const unavailable = {
        ok: false,
        code: 127,
        stdout: '',
        stderr: `${bin}: command not found under the authorized live corpus policy`,
      };
      executionLog.push({
        bin,
        args: [...args],
        ok: false,
        unavailable: true,
        message: clipText(unavailable.stderr, 1_200),
      });
      return unavailable;
    }
    const commandArgs = bin === 'npm' ? ['--ignore-scripts', ...args] : [...args];
    const result = runSandboxedCommand({
      workspaceRoot: canonicalRootPath,
      command: executables[bin],
      args: commandArgs,
      environment,
      profilePath,
      timeoutMs: options.timeoutMs || COMMAND_TIMEOUT_MS,
    });
    executionLog.push({
      bin,
      args: commandArgs,
      ok: result.ok,
      code: result.code,
      signal: result.signal || null,
      durationMs: result.durationMs,
      message: result.ok ? '' : clipText(result.stderr || result.stdout, 1_200),
    });
    return result;
  };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && address.port;
      server.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs = SERVER_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
}

function urlAllowedForPreview(rawUrl, rootPath) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'file:') {
      return isInsideRoot(rootPath, fileURLToPath(parsed));
    }
    return ['http:', 'https:'].includes(parsed.protocol)
      && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function capturePreview(browserService, rootPath, targetUrl, jobId) {
  const opened = await browserService.open({
    jobId,
    rootPath,
    url: targetUrl,
    viewport: { width: 1280, height: 800 },
  });
  if (!opened.ok) return { attempted: true, passed: false, reason: opened.code || 'open_failed' };
  try {
    const captured = await browserService.capture({ jobId, sessionId: opened.session.id });
    const inspected = browserService.inspect({ jobId, sessionId: opened.session.id });
    const failures = inspected.ok && Array.isArray(inspected.requestFailures)
      ? inspected.requestFailures.filter((entry) => !/ERR_CACHE_MISS/i.test(String(entry.error || '')))
      : [];
    const consoleErrors = inspected.ok && Array.isArray(inspected.console)
      ? inspected.console.filter((entry) => Number(entry.level) >= 3)
      : [];
    return {
      attempted: true,
      passed: Boolean(captured.ok && captured.image && captured.image.bytes > 0
        && failures.length === 0 && consoleErrors.length === 0),
      screenshotBytes: captured.ok && captured.image ? captured.image.bytes : 0,
      requestFailures: failures.length,
      consoleErrors: consoleErrors.length,
    };
  } finally {
    browserService.close({ jobId, sessionId: opened.session.id });
  }
}

async function validatePreview({ browserService, scenario, rootPath }) {
  const staticEntry = path.join(rootPath, 'index.html');
  if (fs.existsSync(staticEntry)) {
    return capturePreview(
      browserService,
      rootPath,
      pathToFileURL(staticEntry).href,
      `preview-${scenario.id}`
    );
  }

  const packageJson = readJson(path.join(rootPath, 'package.json'));
  const hasStart = Boolean(packageJson && packageJson.scripts && packageJson.scripts.start);
  const isFastApi = scenario.id === 'python-fastapi';
  if (!hasStart && !isFastApi) return { attempted: false, passed: false, reason: 'start_script_absent' };

  const port = await findFreePort();
  const canonicalRootPath = canonicalSandboxPath(rootPath);
  const profilePath = path.join(canonicalRootPath, '.offline-preview.sb');
  fs.writeFileSync(profilePath, buildSandboxProfile({
    workspaceRoot: canonicalRootPath,
    networkMode: 'loopback',
  }), 'utf8');
  const environment = {
    ...buildOfflineEnvironment(canonicalRootPath),
    PORT: String(port),
  };
  const command = isFastApi
    ? (fs.existsSync('/usr/local/bin/python3') ? '/usr/local/bin/python3' : '/usr/bin/python3')
    : '/usr/local/bin/npm';
  const hasNext = Boolean(packageJson && (
    (packageJson.dependencies && packageJson.dependencies.next)
      || (packageJson.devDependencies && packageJson.devDependencies.next)
  ));
  const args = isFastApi
    ? ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', String(port)]
    : hasNext
      ? ['--ignore-scripts', 'run', 'start', '--', '--hostname', '127.0.0.1', '--port', String(port)]
      : ['--ignore-scripts', 'run', 'start'];
  const child = spawn('/usr/bin/sandbox-exec', ['-f', profilePath, command, ...args], {
    cwd: canonicalRootPath,
    detached: true,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  const appendServerOutput = (chunk) => {
    serverOutput = clipText(`${serverOutput}${String(chunk || '')}`, 1_000);
  };
  if (child.stdout) child.stdout.on('data', appendServerOutput);
  if (child.stderr) child.stderr.on('data', appendServerOutput);
  try {
    const ready = await Promise.race([
      waitForPort(port),
      new Promise((resolve) => child.once('exit', () => resolve(false))),
    ]);
    if (!ready) {
      return {
        attempted: true,
        passed: false,
        reason: 'server_not_ready',
        message: clipText(serverOutput, 320),
      };
    }
    return await capturePreview(
      browserService,
      rootPath,
      `http://127.0.0.1:${port}/`,
      `preview-${scenario.id}`
    );
  } finally {
    killProcessTree(child);
  }
}

function compactVerification(verification) {
  return {
    ok: verification.ok,
    ready: verification.ready,
    plan: {
      steps: verification.plan.steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        required: step.required,
        expectedStatus: step.expectedStatus,
      })),
    },
    results: verification.results.map((result) => ({
      id: result.id,
      status: result.status,
      required: result.required,
    })),
    summary: verification.summary,
    warnings: verification.warnings,
  };
}

function capturePackageManifestState(rootPath) {
  return listProjectFiles(rootPath)
    .filter((relativePath) => path.basename(relativePath) === 'package.json')
    .map((relativePath) => `${relativePath}:${hashFile(path.join(rootPath, relativePath))}`)
    .join('|');
}

function mergeGenerationEvidence(previous, current, repairAttempts) {
  return {
    ...current,
    modifiedFiles: [...new Set([
      ...(Array.isArray(previous && previous.modifiedFiles) ? previous.modifiedFiles : []),
      ...(Array.isArray(current && current.modifiedFiles) ? current.modifiedFiles : []),
    ])],
    toolRuns: [
      ...(Array.isArray(previous && previous.toolRuns) ? previous.toolRuns : []),
      ...(Array.isArray(current && current.toolRuns) ? current.toolRuns : []),
    ],
    repairAttempts,
  };
}

async function executeAgenticScenarioPass({
  loop,
  rootPath,
  scanner,
  scenario,
  userMessage,
  executionIntent,
  jobId,
}) {
  const projectInfo = buildProjectInfo(scanner, rootPath, scenario.stacks);
  const plan = loop.buildExecutionPlan({
    projectInfo,
    userMessage,
    routeDecision: createRouteDecision(executionIntent),
  });
  if (!plan || !plan.action) {
    return {
      ok: false,
      status: 'failed',
      message: 'O loop agentic não produziu um plano executável.',
      modifiedFiles: [],
      toolRuns: [],
    };
  }
  try {
    return await loop.executeAction(plan.action, projectInfo, {
      jobId,
      processExecutionPolicy: AGENTIC_PROCESS_EXECUTION_POLICIES.SUSPENDED,
    });
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      message: clipText(error && error.message ? error.message : error),
      modifiedFiles: [],
      toolRuns: [],
    };
  }
}

function installScenarioDependencies({ rootPath, policy, sharedRoot }) {
  try {
    return installNodeDependencies({ rootPath, policy, sharedRoot });
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      code: error && error.code ? error.code : 'INSTALL_POLICY_FAILED',
      stderr: clipText(error && error.message ? error.message : error),
      lifecycleScriptsEnabled: false,
      suppressedLifecycleScripts: [],
    };
  }
}

async function verifyScenarioProject({ rootPath, scanner, scenario, installResult }) {
  const executionLog = [];
  const verifier = createProjectVerificationService({
    fs,
    path,
    runCommand: createVerificationRunner({ rootPath, installResult, executionLog }),
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  const refreshed = buildProjectInfo(scanner, rootPath, scenario.stacks);
  try {
    const verification = await verifier.runProjectVerification(refreshed, {
      ...scenario.options,
      acceptanceContext: scenario.options.userMessage || scenario.prompt,
      userMessage: scenario.options.userMessage || scenario.prompt,
      requirePlaywright: 'if_available',
    });
    return { executionLog, verification };
  } catch (error) {
    return {
      executionLog,
      verification: {
        ok: false,
        ready: false,
        plan: { steps: [] },
        results: [{ id: 'verification_exception', status: 'failed', required: true }],
        summary: { passed: 0, failed: 1, warnings: 0, blocked: 0, manual: 0 },
        warnings: [clipText(error && error.message ? error.message : error)],
      },
    };
  }
}

async function runScenario({
  scenario,
  sharedRoot,
  scanner,
  policy,
  requestModelTurn,
  browserService,
  model,
}) {
  const startedAt = Date.now();
  const rootPath = path.join(sharedRoot, 'workspaces', scenario.id);
  const beforeDirty = seedScenario(scenario, rootPath);
  const tools = createFileToolSurface(rootPath);
  const loop = createAgenticToolLoopService({
    appendAuditEvent: () => {},
    appendJobEvent: () => {},
    executeCapability: tools.executeCapability,
    executeTool: tools.executeTool,
    getEffectiveOpenAiModel: () => model,
    getSelectedAiProvider: () => 'openai',
    inspectProjectValidation: createInspectionCallback(scanner, scenario),
    requestModelTurn,
    setJobCheckpoint: () => {},
    maxSteps: 40,
  });
  let generation = await executeAgenticScenarioPass({
    loop,
    rootPath,
    scanner,
    scenario,
    userMessage: scenario.prompt,
    executionIntent: scenario.executionIntent || 'init_project',
    jobId: `live-corpus-${scenario.id}`,
  });
  let installResult = installScenarioDependencies({ rootPath, policy, sharedRoot });
  let verificationPass = await verifyScenarioProject({
    rootPath,
    scanner,
    scenario,
    installResult,
  });
  let { executionLog, verification } = verificationPass;
  const repairService = createApplicationCreationLiveCorpusRepairService({ maxAttempts: 2 });
  let repairAttempts = 0;
  while (repairService.shouldAttemptRepair({
    attempt: repairAttempts,
    generation,
    installResult,
    verification,
    executionLog,
  })) {
    const manifestStateBefore = capturePackageManifestState(rootPath);
    const repairPrompt = repairService.buildRepairPrompt({
      scenario,
      rootPaths: [rootPath, canonicalSandboxPath(rootPath)],
      verification,
      executionLog,
    });
    const repair = await executeAgenticScenarioPass({
      loop,
      rootPath,
      scanner,
      scenario,
      userMessage: repairPrompt,
      executionIntent: 'init_project',
      jobId: `live-corpus-${scenario.id}-repair-${repairAttempts + 1}`,
    });
    repairAttempts += 1;
    generation = mergeGenerationEvidence(generation, repair, repairAttempts);
    const repairProducedFiles = Array.isArray(repair.modifiedFiles)
      && repair.modifiedFiles.length > 0;
    if (!repairProducedFiles) break;
    const manifestStateAfter = capturePackageManifestState(rootPath);
    if (manifestStateAfter !== manifestStateBefore) {
      installResult = installScenarioDependencies({ rootPath, policy, sharedRoot });
      if (!installResult.ok) break;
    }
    verificationPass = await verifyScenarioProject({
      rootPath,
      scanner,
      scenario,
      installResult,
    });
    ({ executionLog, verification } = verificationPass);
  }

  let preview = {
    attempted: false,
    passed: false,
    reason: 'verification_not_ready',
  };
  if (verification.ready) {
    try {
      preview = await validatePreview({ browserService, scenario, rootPath });
    } catch (error) {
      preview = {
        attempted: true,
        passed: false,
        reason: clipText(error && error.message ? error.message : error, 240),
      };
    }
  }

  const afterDirty = scenario.dirtyWorktree ? dirtySnapshot(rootPath) : null;
  const dirtyPreserved = !scenario.dirtyWorktree || Boolean(
    beforeDirty
      && afterDirty
      && beforeDirty.sourceHash === afterDirty.sourceHash
      && beforeDirty.notesHash === afterDirty.notesHash
  );
  const executedChecks = executionLog.filter((entry) => entry.ok && !(entry.bin === 'npm' && entry.args[0] === 'install'));
  const failedChecks = executionLog.filter((entry) => !entry.ok).map((entry) => ({
    bin: entry.bin,
    args: entry.args,
    code: entry.code === undefined ? null : entry.code,
    signal: entry.signal || null,
    message: clipText(entry.message || '', 320),
  }));
  const executionStarted = preview.passed || executedChecks.length > 0;
  const criteriaMet = Boolean(
    installResult.ok
      && verification.ready
      && dirtyPreserved
      && executionStarted
  );
  const observation = {
    id: scenario.id,
    stack: scenario.stack,
    allowedRuleScopes: scenario.allowedRuleScopes,
    verification: compactVerification(verification),
    execution: {
      mode: 'live',
      started: executionStarted,
      criteriaMet,
    },
    dirtyWorktree: {
      required: Boolean(scenario.dirtyWorktree),
      preserved: dirtyPreserved,
    },
    promoted: criteriaMet,
  };
  return {
    observation,
    result: {
      id: scenario.id,
      passed: criteriaMet,
      durationMs: Date.now() - startedAt,
      generation: {
        ok: Boolean(generation.ok),
        status: generation.status || (generation.ok ? 'completed' : 'failed'),
        message: clipText(generation.message || '', 600),
        modifiedFiles: Array.isArray(generation.modifiedFiles) ? generation.modifiedFiles.length : 0,
        toolCalls: Array.isArray(generation.toolRuns) ? generation.toolRuns.length : 0,
        staticReady: Boolean(generation.creationInspection && generation.creationInspection.staticReady),
        repairAttempts,
      },
      install: {
        attempted: installResult.attempted,
        ok: installResult.ok,
        code: installResult.code === undefined ? 0 : installResult.code,
        signal: installResult.signal || null,
        message: installResult.ok
          ? ''
          : clipText(installResult.stderr || installResult.stdout, 600),
        registryOrigin: installResult.registryOrigin || null,
        lifecycleScriptsEnabled: false,
        suppressedLifecycleScripts: installResult.suppressedLifecycleScripts || [],
        dependencyCount: installResult.dependencyCount || 0,
      },
      verification: {
        ready: verification.ready,
        summary: verification.summary,
        executedChecks,
        failedChecks,
      },
      preview,
      dirtyWorktreePreserved: dirtyPreserved,
      fileCount: listProjectFiles(rootPath).length,
    },
  };
}

function readResumeReport(filePath, provider, model) {
  if (!filePath) return { observations: [], results: [], metrics: {} };
  const report = readJson(filePath);
  if (!report || report.version !== LIVE_CORPUS_REPORT_VERSION
    || report.provider !== provider || report.model !== model
    || !Array.isArray(report.observations) || !Array.isArray(report.scenarios)) {
    throw new Error('Resume report is incompatible with the current live corpus run.');
  }
  const results = report.scenarios.filter((entry) => entry && entry.passed === true);
  const passedIds = new Set(results.map((entry) => entry.id));
  return {
    observations: report.observations.filter((entry) => (
      entry
        && passedIds.has(entry.id)
        && entry.execution
        && entry.execution.mode === 'live'
    )),
    results,
    metrics: report.metrics && typeof report.metrics === 'object' ? report.metrics : {},
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = createApplicationCreationLiveCorpusPolicy({ fs, os, path });
  const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-live-corpus-'));
  let cleaned = false;
  cleanupTemporaryWorkspace = () => {
    if (cleaned) return;
    cleaned = true;
    if (!args.keepTemp) fs.rmSync(sharedRoot, { recursive: true, force: true });
  };
  policy.assertTemporaryWorkspace(sharedRoot);
  const reportRoot = args.reportPath
    ? ''
    : fs.mkdtempSync(path.join(os.tmpdir(), 'faber-live-corpus-report-'));
  const reportPath = args.reportPath
    ? path.resolve(args.reportPath)
    : path.join(reportRoot, 'report.json');
  const reportParent = path.dirname(reportPath);
  fs.mkdirSync(reportParent, { recursive: true });
  policy.assertTemporaryWorkspace(reportParent);

  app.setName('Faber Code');
  app.on('window-all-closed', keepLiveCorpusProcessAlive);
  await app.whenReady();
  const secretStore = createSecretStore({ safeStorage });
  const runtimeSettings = createAiRuntimeSettingsService({
    aiProviderEnv: process.env.AI_PROVIDER || 'mock',
    fs,
    getUserDataPath: () => path.join(os.homedir(), 'Library/Application Support/Faber Code'),
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModelBrain: process.env.OPENAI_MODEL_BRAIN || '',
    path,
    protectSecret: secretStore.protectSecret,
    unprotectSecret: secretStore.unprotectSecret,
  });
  const settings = runtimeSettings.readSettings();
  const provider = String(settings.selectedProvider || '').trim().toLowerCase();
  if (provider !== 'openai') throw new Error('The configured live corpus provider is not an authorized OpenAI destination.');
  const apiKey = runtimeSettings.getEffectiveOpenAiApiKey();
  const configuredModel = sanitizeOpenAiModelName(runtimeSettings.getEffectiveOpenAiModel() || '');
  if (!apiKey || !configuredModel) throw new Error('The configured OpenAI provider is incomplete.');
  const baseUrl = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
  policy.resolveOfficialProviderDestination({ providerId: provider, baseUrl });

  const metrics = {
    requests: 0,
    discoveryRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  const modelResolution = await createApplicationCreationLiveCorpusModelResolver().resolve({
    apiKey,
    baseUrl,
    configuredModel,
    policy,
    metrics,
  });
  const model = modelResolution.model;
  console.log(JSON.stringify({
    event: 'live_corpus_model_resolved',
    configuredModel,
    model,
    usedConfiguredModel: modelResolution.usedConfiguredModel,
  }));
  const requestModelTurn = createOpenAiTurnClient({
    apiKey,
    baseUrl,
    model,
    policy,
    metrics,
  });
  const scanner = createProjectScanner({ fs, path });
  const browserService = createAgenticBrowserSessionService({
    BrowserWindow,
    authorizeNavigation: async (input) => ({
      allowed: urlAllowedForPreview(input.url, input.rootPath),
    }),
    authorizeRequest: async (input) => ({
      allowed: urlAllowedForPreview(input.url, input.rootPath),
    }),
  });
  const resume = readResumeReport(args.resumeReportPath, provider, model);
  for (const key of ['requests', 'discoveryRequests', 'inputTokens', 'outputTokens', 'totalTokens']) {
    metrics[key] += Number(resume.metrics[key]) || 0;
  }
  const observations = [...resume.observations];
  const results = [...resume.results];
  const completed = new Set(observations.map((entry) => entry.id));
  const scenarios = createScenarios().filter((scenario) => {
    if (completed.has(scenario.id)) return false;
    return !args.scenario || args.scenario === 'all' || scenario.id === args.scenario;
  });
  if (!scenarios.length && !observations.length) throw new Error('No live corpus scenarios were selected.');

  const startedAt = new Date().toISOString();
  const buildReport = (completedAt = null) => ({
    version: LIVE_CORPUS_REPORT_VERSION,
    startedAt,
    completedAt,
    provider,
    configuredModel,
    model,
    modelResolution: {
      usedConfiguredModel: modelResolution.usedConfiguredModel,
    },
    authorization: {
      temporaryWorkspacesOnly: true,
      providerOrigin: 'https://api.openai.com',
      packageRegistryOrigin: 'https://registry.npmjs.org',
      lifecycleScriptsEnabled: false,
    },
    metrics,
    scenarios: results,
    observations,
    evaluation: createApplicationCreationCorpusEvaluator().evaluate(observations),
  });
  try {
    for (const scenario of scenarios) {
      console.log(JSON.stringify({ event: 'live_corpus_scenario_started', id: scenario.id }));
      const outcome = await runScenario({
        scenario,
        sharedRoot,
        scanner,
        policy,
        requestModelTurn,
        browserService,
        model,
      });
      observations.push(outcome.observation);
      results.push(outcome.result);
      writeJson(reportPath, buildReport());
      console.log(JSON.stringify({
        event: 'live_corpus_scenario_finished',
        id: scenario.id,
        passed: outcome.result.passed,
        durationMs: outcome.result.durationMs,
      }));
    }
    const report = buildReport(new Date().toISOString());
    const evaluation = report.evaluation;
    writeJson(reportPath, report);
    console.log(JSON.stringify({
      ok: evaluation.gatePassed,
      reportPath,
      totalScenarios: evaluation.totalScenarios,
      passedScenarios: evaluation.passedScenarios,
      passRate: evaluation.passRate,
      liveExecutionCoverage: evaluation.liveExecutionCoverage,
      gatePassed: evaluation.gatePassed,
      providerRequests: metrics.requests,
      totalTokens: metrics.totalTokens,
    }, null, 2));
    process.exitCode = evaluation.gatePassed ? 0 : 2;
  } finally {
    browserService.clear();
    cleanupTemporaryWorkspace();
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error && error.code ? error.code : null,
      error: clipText(error && error.message ? error.message : error),
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(() => {
    app.removeListener('window-all-closed', keepLiveCorpusProcessAlive);
    cleanupTemporaryWorkspace();
    if (app && typeof app.exit === 'function') app.exit(process.exitCode || 0);
  });
