function normalizePlanText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function inferPlanTraits({ userMessage = '', executionIntent = '', workingBrief = null, acceptanceMatrix = null, projectGraph = null } = {}) {
  const source = normalizePlanText([
    userMessage,
    executionIntent,
    workingBrief ? JSON.stringify(workingBrief) : '',
    acceptanceMatrix ? JSON.stringify(acceptanceMatrix) : '',
    projectGraph ? JSON.stringify(projectGraph) : '',
  ].join('\n'));

  const persistenceRequired =
    hasAny(source, [/\bpostgres\b/, /\bpostgresql\b/, /\bprisma\b/, /\bbanco\b/, /\bdatabase\b/, /\bpersist/]) ||
    Boolean(projectGraph && projectGraph.persistence && projectGraph.persistence.required);
  const browserRequired = hasAny(source, [/\bplaywright\b/, /\be2e\b/, /\bbrowser\b/, /\bnavegador\b/, /\bsmoke\b/]);
  const realtimeRequired = hasAny(source, [/\btempo real\b/, /\brealtime\b/, /\bwebsocket\b/, /\bsocket\b/, /\bsincroniza/]);
  const repairMode = hasAny(source, [/\breparo\b/, /\bcorrigir\b/, /\berro\b/, /\bruntime\b/, /\btypecheck\b/]) ||
    normalizePlanText(executionIntent) === 'diagnostic_repair';
  const graphIssueCount = projectGraph && projectGraph.summary ? Number(projectGraph.summary.issues || 0) : 0;

  return {
    persistenceRequired,
    browserRequired,
    realtimeRequired,
    repairMode,
    graphIssueCount,
  };
}

function appendStage(stages, stage) {
  stages.push({
    id: stage.id,
    title: stage.title,
    goal: stage.goal,
    reason: stage.reason,
    expectedFiles: Array.isArray(stage.expectedFiles) ? stage.expectedFiles.filter(Boolean).slice(0, 10) : [],
    validation: Array.isArray(stage.validation) ? stage.validation.filter(Boolean).slice(0, 10) : [],
    status: 'pending',
  });
}

function buildAgenticDevelopmentPlan({
  userMessage = '',
  executionIntent = 'edit_project',
  workingBrief = null,
  acceptanceMatrix = null,
  projectGraph = null,
} = {}) {
  const traits = inferPlanTraits({ userMessage, executionIntent, workingBrief, acceptanceMatrix, projectGraph });
  const mode = traits.repairMode ? 'diagnostic_repair' : String(executionIntent || 'edit_project');
  const acceptanceItems = acceptanceMatrix && Array.isArray(acceptanceMatrix.items)
    ? acceptanceMatrix.items.slice(0, 12).map((item) => item.criterion).filter(Boolean)
    : [];
  const graphIssues = projectGraph && Array.isArray(projectGraph.issues)
    ? projectGraph.issues.slice(0, 8).map((issue) => ({
        id: issue.id,
        file: issue.file || '',
        relatedFile: issue.relatedFile || '',
        detail: issue.detail || '',
      }))
    : [];

  const stages = [];
  appendStage(stages, {
    id: 'observe_contracts',
    title: 'Observar contratos reais',
    goal: 'Ler arquivos existentes, grafo, imports, exports, stores, services, dominio, testes e diagnosticos antes de editar.',
    reason: traits.graphIssueCount
      ? 'Ha contratos suspeitos no grafo; editar sem resolver a causa raiz tende a criar APIs inexistentes.'
      : 'A edicao deve partir da arquitetura atual do projeto, nao de um blueprint generico.',
    expectedFiles: ['app/**', 'src/**', 'lib/**', 'tests/**'],
    validation: ['project_graph_report', 'diagnostics'],
  });
  appendStage(stages, {
    id: 'patch_contracts_first',
    title: 'Ajustar contratos antes da superficie',
    goal: 'Atualizar tipos, exports, store, services e dominio usados pela UI antes de alterar a tela.',
    reason: 'A UI so deve chamar membros existentes ou membros criados no contrato correspondente.',
    expectedFiles: ['src/store/**', 'src/services/**', 'src/domain/**', 'src/schemas/**'],
    validation: ['typecheck', 'unit_tests'],
  });

  if (traits.persistenceRequired) {
    appendStage(stages, {
      id: 'real_persistence_gate',
      title: 'Persistencia real',
      goal: 'Criar ou corrigir Docker/Postgres, Prisma, migration, seed, PrismaClient, repository/service, API route e db:check.',
      reason: 'Prisma validate sozinho nao prova backend operacional nem dados persistidos apos reload.',
      expectedFiles: ['docker-compose.yml', 'prisma/**', 'scripts/**', 'src/server/**', 'app/api/**'],
      validation: ['db:up', 'db:generate', 'db:migrate', 'db:seed', 'db:check'],
    });
  }

  if (traits.realtimeRequired) {
    appendStage(stages, {
      id: 'realtime_runtime',
      title: 'Sincronizacao em tempo real',
      goal: 'Definir canal de sincronizacao, estado compartilhado, persistencia de eventos e comportamento de reconexao.',
      reason: 'Apps colaborativos precisam provar multiplos clientes, conflito e persistencia, nao apenas estado local.',
      expectedFiles: ['src/realtime/**', 'app/api/**', 'src/server/**'],
      validation: ['multi_client_smoke', 'reload_persistence'],
    });
  }

  appendStage(stages, {
    id: 'vertical_slice',
    title: 'Fatia vertical executavel',
    goal: 'Entregar a menor mudanca coerente atravessando UI, estado, dominio, backend quando aplicavel e testes.',
    reason: 'A autonomia deve vir em passos pequenos com evidencia, evitando reescrita ampla e fragil.',
    expectedFiles: ['app/**', 'src/**', 'tests/**'],
    validation: ['npm run build', 'npm test'],
  });

  if (traits.browserRequired) {
    appendStage(stages, {
      id: 'browser_evidence',
      title: 'Evidencia de navegador',
      goal: 'Rodar Playwright e smoke visual com screenshots desktop/mobile quando houver superficie web.',
      reason: 'Build verde nao prova fluxo operacional nem layout real.',
      expectedFiles: ['tests/**', 'playwright.config.*'],
      validation: ['npm run test:e2e', 'screenshot:desktop', 'screenshot:mobile'],
    });
  }

  appendStage(stages, {
    id: 'promote_only_if_verified',
    title: 'Promover so com evidencias',
    goal: 'Aplicar no projeto real apenas depois de staging, validacao operacional e smoke visual passarem.',
    reason: 'Falhas devem alimentar reparo ou rollback sem contaminar o projeto real.',
    expectedFiles: [],
    validation: ['verified_execution', 'rollback_on_failure'],
  });

  return {
    version: 1,
    mode,
    summary: traits.repairMode
      ? 'Plano de reparo incremental orientado por grafo, diagnostico real e staging verificado.'
      : 'Plano de implementacao agentic com arquitetura, fatias verificaveis e promocao apenas com evidencias.',
    architecture: {
      boundaries: [
        'UI/App Router',
        'state/store',
        'domain/services',
        traits.persistenceRequired ? 'server/API/persistence' : 'runtime local/dados em memoria quando aceitavel',
        'tests/evidence',
      ],
      dataFlow: traits.persistenceRequired
        ? 'UI -> API/server action -> repository/service -> PrismaClient -> Postgres -> audit/evidence'
        : 'UI -> store/hooks -> services/domain -> tests/evidence',
      riskControls: [
        'staging temporario',
        'contratos do grafo antes de editar',
        'build/test obrigatorios',
        'rollback se falhar',
      ],
    },
    acceptanceItems,
    graphIssues,
    stages,
  };
}

module.exports = {
  buildAgenticDevelopmentPlan,
  inferPlanTraits,
};
