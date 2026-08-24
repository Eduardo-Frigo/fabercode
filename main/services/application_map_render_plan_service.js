const DEFAULT_COPY = Object.freeze({
  mapUntitledItem: 'Item sem título',
  renderCheckDocsLabel: 'Markdowns do mapa',
  renderCheckDocsHint: 'O mapa precisa ter markdowns estruturados para guiar a renderização.',
  renderCheckTradeoffsLabel: 'Tradeoffs do projeto',
  renderCheckTradeoffsHint: 'Documente decisões e compensações de frontend, backend e stack.',
  renderCheckSecurityLabel: 'Plano de segurança',
  renderCheckSecurityHint: 'A base do projeto precisa registrar proteção, autenticação e hardening.',
  renderCheckBrandingLabel: 'Marca e design system',
  renderCheckBrandingHint: 'O render precisa saber a linguagem visual e os assets da marca.',
  renderDefaultTask: 'Validar o escopo e os markdowns do mapa',
  renderDocsGapTitle: 'Fechar lacunas da documentação',
  renderDocsGapSummary: 'Completar os markdowns e as decisões que ainda impedem a execução segura do projeto.',
  renderDocsGapFallback: 'Lacuna não descrita',
  renderDocsGapNotes: 'Etapa derivada diretamente da validação de completude do mapa.',
  renderFoundationTitle: 'Preparar fundação técnica do projeto',
  renderFoundationSummary: 'Converter as decisões do mapa em base técnica executável antes de implementar telas e regras finais.',
  renderFoundationTaskOne: 'Validar a stack definida no mapa e registrar a decisão final de frontend, backend e banco.',
  renderFoundationTaskTwo: 'Organizar estrutura de pastas, scripts de desenvolvimento, build, lint e testes.',
  renderFoundationTaskThree: 'Criar arquivos de ambiente de exemplo sem segredos reais e documentar como configurar o projeto.',
  renderFoundationTaskFour: 'Transformar os itens técnicos do mapa em contratos iniciais para as próximas etapas.',
  renderFoundationNotes: 'Primeiro bloco do passo a passo: base técnica antes de implementar funcionalidades.',
  renderNodesConsidered: 'Itens do mapa considerados: {items}.',
  renderDesignTitle: 'Estruturar interface, marca e design system',
  renderDesignSummary: 'Transformar a linguagem visual documentada no mapa em tokens, componentes e navegação reutilizável.',
  renderDesignTaskOne: 'Consolidar cores, tipografia, espaçamentos, estados de interação e assets de marca.',
  renderDesignTaskTwo: 'Criar shell visual da aplicação com layout base e componentes compartilhados.',
  renderDesignTaskThree: 'Mapear telas, navegação e hierarquia visual antes de implementar o fluxo principal.',
  renderDesignTaskFour: 'Registrar lacunas de design que ainda precisem de imagens, logotipo ou documentação adicional.',
  renderDesignNotes: 'Esta etapa consolida o visual antes da implementação de telas finais.',
  renderProductTitle: 'Implementar fluxo principal da aplicação',
  renderProductSummary: 'Construir o caminho ponta a ponta que permite ao usuário usar o produto conforme o mapa definiu.',
  renderProductTaskOne: 'Implementar telas e rotas principais descritas no mapa da aplicação.',
  renderProductTaskTwo: 'Criar formulários, estados de carregamento, validações de interface e feedbacks de erro/sucesso.',
  renderProductTaskThree: 'Conectar cada ação do usuário ao contrato de dados esperado, mesmo que inicialmente com mocks.',
  renderProductTaskFour: 'Validar o fluxo completo pelo ponto de vista do usuário antes de avançar para hardening.',
  renderProductNotes: 'A partir daqui o plano passa a representar execução real do produto.',
  renderProductRealUserTask: 'Preparar o fluxo principal para teste guiado com usuários reais antes do fechamento.',
  renderBackendTitle: 'Construir backend, dados e integrações',
  renderBackendSummary: 'Implementar persistência, API, autenticação e regras de negócio alinhadas com o fluxo principal.',
  renderBackendTaskOne: 'Modelar entidades, relações, migrations e seeds necessários para o domínio desenhado.',
  renderBackendTaskTwo: 'Criar contratos REST/API e padronizar payloads, erros e status codes.',
  renderBackendTaskThree: 'Implementar autenticação, autorização e regras de negócio do backend.',
  renderBackendTaskFour: 'Integrar frontend, backend e banco em cenários reais do produto.',
  renderBackendNotes: 'A etapa usa o contexto consolidado dos markdowns e decisões do mapa.',
  renderPentestTitle: 'Executar pentest e correção de vulnerabilidades',
  renderPentestSummary: 'Validar a aplicação com testes ofensivos controlados e transformar achados em correções antes da entrega.',
  renderPentestTaskOne: 'Definir escopo do pentest, ambientes permitidos e critérios de parada.',
  renderPentestTaskTwo: 'Executar checklist OWASP para autenticação, autorização, sessão, inputs e exposição de dados.',
  renderPentestTaskThree: 'Registrar vulnerabilidades com severidade, evidência, impacto e recomendação.',
  renderPentestTaskFour: 'Corrigir achados críticos/altos e repetir os testes de validação antes de liberar a entrega.',
  renderLoggingTaskOne: 'Definir padrão de logs para erros de frontend, backend, autenticação e integrações.',
  renderLoggingTaskTwo: 'Registrar contexto mínimo de falhas sem expor dados sensíveis ou segredos.',
  renderLoggingTaskThree: 'Criar fluxo de captura, consulta e triagem de erros recorrentes.',
  renderRealUsersTitle: 'Validar fluxo com usuários reais',
  renderRealUsersSummary: 'Testar as etapas principais com pessoas reais antes de encerrar o plano de execução.',
  renderRealUsersTaskOne: 'Definir cenários de uso e critérios de sucesso para a validação com usuários.',
  renderRealUsersTaskTwo: 'Preparar ambiente, dados de teste e roteiro de observação para cada etapa crítica.',
  renderRealUsersTaskThree: 'Coletar dúvidas, bloqueios, erros e pontos de fricção durante a execução real.',
  renderRealUsersTaskFour: 'Transformar os achados em ajustes priorizados no plano antes da entrega final.',
  renderDeliveryTitle: 'Aplicar segurança, testes e entrega',
  renderDeliverySummary: 'Fechar o projeto com proteção, validação funcional, revisão técnica e preparação de entrega.',
  renderDeliveryTaskOne: 'Aplicar checklist de segurança definido no mapa: autenticação, autorização, headers, secrets e rate limiting.',
  renderDeliveryTaskTwo: 'Criar testes unitários, integração e fluxo ponta a ponta para as jornadas principais.',
  renderDeliveryTaskThree: 'Revisar logs, tratamento de erros, observabilidade e comportamento em produção.',
  renderDeliveryTaskFour: 'Preparar validação final, documentação de execução e critérios de aceite da entrega.',
  renderDeliveryNotes: 'Último passo da sequência, com validação antes de concluir a entrega.',
  renderDeliveryLoggingTaskOne: 'Adicionar alertas ou checklist de revisão para erros críticos antes da entrega.',
  renderDeliveryLoggingTaskTwo: 'Validar se os logs apoiam análise de incidentes sem expor dados sensíveis.',
  renderRefinementNotes: 'Etapa adicionada a partir do refinamento solicitado no chat de render.',
  renderReleaseTitle: 'Preparar liberação e lançamento do projeto',
  renderReleaseSummary: 'Organizar a etapa final de release para publicar, comunicar e acompanhar a aplicação após a validação.',
  renderReleaseTaskOne: 'Consolidar checklist de release com build, testes, variáveis de ambiente e documentação de execução.',
  renderReleaseTaskTwo: 'Definir plano de lançamento, responsáveis, janela de publicação e estratégia de rollback.',
  renderReleaseTaskThree: 'Acompanhar primeiros usuários reais, logs de erro e métricas críticas após a liberação.',
});

function normalizeRenderKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function createApplicationMapRenderPlanService(dependencies = {}) {
  const now = typeof dependencies.now === 'function' ? dependencies.now : () => Date.now();

  function text(copy, key, variables = {}) {
    const candidate = copy && typeof copy[key] === 'string' ? copy[key] : '';
    const template = candidate || DEFAULT_COPY[key] || key;
    return Object.entries(variables).reduce(
      (value, [name, replacement]) => value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement)),
      String(template),
    );
  }

  function evaluateReadiness(mapData = {}, combinedText = '', copy = {}) {
    const rootNodes = Array.isArray(mapData.nodes)
      ? mapData.nodes.filter((node) => node && !node.parentId)
      : [];
    const groups = rootNodes.filter((node) => node.type === 'group' || node.type === 'folder');
    const contextText = String(combinedText || '').toLowerCase();
    const nodeText = String(
      Array.isArray(mapData.nodes)
        ? mapData.nodes
          .map((node) => [node && node.title, node && node.description, node && node.content].filter(Boolean).join(' '))
          .join(' \n ')
        : '',
    ).toLowerCase();
    const fullText = `${contextText}\n${nodeText}`;

    const checks = [
      {
        id: 'docs',
        label: text(copy, 'renderCheckDocsLabel'),
        ok: groups.length > 0 || /docs\/application-map/.test(fullText),
        hint: text(copy, 'renderCheckDocsHint'),
      },
      {
        id: 'tradeoffs',
        label: text(copy, 'renderCheckTradeoffsLabel'),
        ok: /tradeoff|trade-offs|frontend|back-end|backend|stack/.test(fullText),
        hint: text(copy, 'renderCheckTradeoffsHint'),
      },
      {
        id: 'security',
        label: text(copy, 'renderCheckSecurityLabel'),
        ok: /seguran|security|rate limit|rate limiting|mfa|csp|hsts|auth|oauth|jwt/.test(fullText),
        hint: text(copy, 'renderCheckSecurityHint'),
      },
      {
        id: 'branding',
        label: text(copy, 'renderCheckBrandingLabel'),
        ok: /brand|marca|logo|logotipo|cores|color|design system|tipografia|tipographic|ui kit/.test(fullText),
        hint: text(copy, 'renderCheckBrandingHint'),
      },
    ];
    const missing = checks.filter((item) => !item.ok);
    return { checks, missing, ready: missing.length === 0 };
  }

  function buildMilestones(mapData = {}, readiness = {}, combinedText = '', documents = [], copy = {}) {
    const nodes = Array.isArray(mapData.nodes) ? mapData.nodes.filter(Boolean) : [];
    const milestones = [];
    let index = 1;
    const normalize = (value) => String(value || '').toLowerCase();
    const unique = (items) => Array.from(new Set((items || []).filter(Boolean)));
    const collectNodeTitles = (keywords, limit = 6) => unique(
      nodes
        .filter((node) => {
          const haystack = normalize([node.title, node.description, node.content, node.type].join(' '));
          return keywords.some((keyword) => haystack.includes(keyword));
        })
        .map((node) => node.title || node.description || node.type || text(copy, 'mapUntitledItem')),
    ).slice(0, limit);
    const documentList = Array.isArray(documents) ? documents.filter((doc) => doc && doc.path) : [];
    const pickReferences = (keywords = [], fallbackPaths = []) => {
      const matches = documentList
        .filter((doc) => {
          const haystack = normalize(`${doc.path}\n${doc.content || ''}`);
          return keywords.some((keyword) => haystack.includes(keyword));
        })
        .map((doc) => doc.path);
      return unique([...matches, ...fallbackPaths]).slice(0, 4).map((path) => ({ path }));
    };
    const makeTasks = (titles) => titles.map((title, taskIndex) => ({
      id: `render-task-${index}-${taskIndex + 1}`,
      title,
      status: 'pending',
    }));
    const addMilestone = (title, summary, tasks = [], extra = {}) => {
      const milestone = {
        id: `render-milestone-${index}`,
        number: index,
        title,
        summary,
        status: 'planned',
        tasks: tasks.length ? tasks : [{
          id: `render-task-${index}-1`,
          title: text(copy, 'renderDefaultTask'),
          status: 'pending',
        }],
        acceptanceCriteria: extra.acceptanceCriteria || '',
        validationCommands: extra.validationCommands || '',
        commits: [],
        notes: extra.notes || '',
        references: Array.isArray(extra.references) ? extra.references : [],
        changeMarker: extra.changeMarker || null,
      };
      milestones.push(milestone);
      index += 1;
      return milestone;
    };
    const addTasksToMilestone = (milestone, titles = [], markerLabel = '') => {
      if (!milestone || !Array.isArray(titles) || !titles.length) return;
      const currentTasks = Array.isArray(milestone.tasks) ? milestone.tasks : [];
      const additions = titles.map((title, taskIndex) => ({
        id: `${milestone.id}-refined-${currentTasks.length + taskIndex + 1}`,
        title,
        status: 'pending',
        isRefinement: true,
      }));
      milestone.tasks = [...currentTasks, ...additions];
      milestone.changeMarker = {
        type: 'task',
        count: additions.length,
        label: markerLabel || `+${additions.length}`,
      };
    };

    if (readiness.missing && readiness.missing.length) {
      addMilestone(
        text(copy, 'renderDocsGapTitle'),
        text(copy, 'renderDocsGapSummary'),
        readiness.missing.map((item, itemIndex) => ({
          id: `render-task-${index}-${itemIndex + 1}`,
          title: item.hint || item.label || text(copy, 'renderDocsGapFallback'),
          status: 'pending',
        })),
        {
          notes: text(copy, 'renderDocsGapNotes'),
          references: pickReferences(
            ['open question', 'open-question', 'decis', 'tradeoff', 'seguran', 'security', 'design', 'marca'],
            documentList.map((doc) => doc.path),
          ),
        },
      );
    }

    const foundationNodes = collectNodeTitles(['backend', 'database', 'banco', 'stack', 'setup', 'env', 'seguran']);
    addMilestone(
      text(copy, 'renderFoundationTitle'),
      text(copy, 'renderFoundationSummary'),
      makeTasks([
        text(copy, 'renderFoundationTaskOne'),
        text(copy, 'renderFoundationTaskTwo'),
        text(copy, 'renderFoundationTaskThree'),
        text(copy, 'renderFoundationTaskFour'),
      ]),
      {
        notes: foundationNodes.length
          ? text(copy, 'renderNodesConsidered', { items: foundationNodes.join(', ') })
          : text(copy, 'renderFoundationNotes'),
        references: pickReferences(['readme', 'backend', 'banco', 'database', 'stack', 'decis', 'seguran', 'security']),
      },
    );

    const designNodes = collectNodeTitles(['design', 'layout', 'frontend', 'brand', 'marca', 'logo', 'tipografia']);
    addMilestone(
      text(copy, 'renderDesignTitle'),
      text(copy, 'renderDesignSummary'),
      makeTasks([
        text(copy, 'renderDesignTaskOne'),
        text(copy, 'renderDesignTaskTwo'),
        text(copy, 'renderDesignTaskThree'),
        text(copy, 'renderDesignTaskFour'),
      ]),
      {
        notes: designNodes.length
          ? text(copy, 'renderNodesConsidered', { items: designNodes.join(', ') })
          : text(copy, 'renderDesignNotes'),
        references: pickReferences(['design', 'frontend', 'layout', 'marca', 'brand', 'logo', 'cor', 'cores', 'tipografia']),
      },
    );

    const productNodes = collectNodeTitles(['funções', 'funcao', 'feature', 'frontend', 'login', 'dashboard', 'fluxo', 'tarefa']);
    const productMilestone = addMilestone(
      text(copy, 'renderProductTitle'),
      text(copy, 'renderProductSummary'),
      makeTasks([
        text(copy, 'renderProductTaskOne'),
        text(copy, 'renderProductTaskTwo'),
        text(copy, 'renderProductTaskThree'),
        text(copy, 'renderProductTaskFour'),
      ]),
      {
        notes: productNodes.length
          ? text(copy, 'renderNodesConsidered', { items: productNodes.join(', ') })
          : text(copy, 'renderProductNotes'),
        references: pickReferences(['frontend', 'funções', 'funcoes', 'feature', 'login', 'dashboard', 'fluxo', 'tarefa']),
      },
    );

    const backendNodes = collectNodeTitles(['backend', 'api', 'database', 'banco', 'auth', 'jwt', 'sequelize', 'dados']);
    const backendMilestone = addMilestone(
      text(copy, 'renderBackendTitle'),
      text(copy, 'renderBackendSummary'),
      makeTasks([
        text(copy, 'renderBackendTaskOne'),
        text(copy, 'renderBackendTaskTwo'),
        text(copy, 'renderBackendTaskThree'),
        text(copy, 'renderBackendTaskFour'),
      ]),
      {
        notes: backendNodes.length
          ? text(copy, 'renderNodesConsidered', { items: backendNodes.join(', ') })
          : (combinedText ? text(copy, 'renderBackendNotes') : ''),
        references: pickReferences(['backend', 'api', 'database', 'banco', 'dados', 'sequelize', 'auth', 'jwt']),
      },
    );

    const securityNodes = collectNodeTitles(['seguran', 'security', 'teste', 'test', 'deploy', 'log', 'observ']);
    const normalizedContext = normalize(combinedText);
    const asksForPentest = /pentest|pen test|penetration test|teste de intrus|intrus[aã]o|vulnerability|vulnerabil|owasp/.test(normalizedContext);
    const asksForErrorLogging = /log de erro|logs de erro|error log|erro em produ|observabil|monitoramento|alerta|telemetria|sentry/.test(normalizedContext);
    const asksForRealUserValidation = /usu[aá]rios reais|usuario real|user test|teste com usu[aá]rio|valida[cç][aã]o com usu[aá]rios|pesquisa com usu[aá]rios|beta test|teste beta/.test(normalizedContext);

    if (asksForPentest) {
      addMilestone(
        text(copy, 'renderPentestTitle'),
        text(copy, 'renderPentestSummary'),
        makeTasks([
          text(copy, 'renderPentestTaskOne'),
          text(copy, 'renderPentestTaskTwo'),
          text(copy, 'renderPentestTaskThree'),
          text(copy, 'renderPentestTaskFour'),
        ]),
        {
          validationCommands: 'npm test\nnpm run build',
          notes: text(copy, 'renderRefinementNotes'),
          references: pickReferences(['seguran', 'security', 'auth', 'jwt', 'owasp', 'pentest', 'teste']),
          changeMarker: { type: 'milestone', count: 1, label: '+ etapa' },
        },
      );
    }

    if (asksForErrorLogging) {
      addTasksToMilestone(backendMilestone, [
        text(copy, 'renderLoggingTaskOne'),
        text(copy, 'renderLoggingTaskTwo'),
        text(copy, 'renderLoggingTaskThree'),
      ], '+3');
    }

    if (asksForRealUserValidation) {
      addMilestone(
        text(copy, 'renderRealUsersTitle'),
        text(copy, 'renderRealUsersSummary'),
        makeTasks([
          text(copy, 'renderRealUsersTaskOne'),
          text(copy, 'renderRealUsersTaskTwo'),
          text(copy, 'renderRealUsersTaskThree'),
          text(copy, 'renderRealUsersTaskFour'),
        ]),
        {
          notes: text(copy, 'renderRefinementNotes'),
          references: pickReferences(['readme', 'frontend', 'design', 'funções', 'funcoes', 'teste', 'valida']),
          changeMarker: { type: 'milestone', count: 1, label: '+ etapa' },
        },
      );
    }

    const deliveryMilestone = addMilestone(
      text(copy, 'renderDeliveryTitle'),
      text(copy, 'renderDeliverySummary'),
      makeTasks([
        text(copy, 'renderDeliveryTaskOne'),
        text(copy, 'renderDeliveryTaskTwo'),
        text(copy, 'renderDeliveryTaskThree'),
        text(copy, 'renderDeliveryTaskFour'),
      ]),
      {
        validationCommands: 'npm test\nnpm run build',
        notes: securityNodes.length
          ? text(copy, 'renderNodesConsidered', { items: securityNodes.join(', ') })
          : text(copy, 'renderDeliveryNotes'),
        references: pickReferences(['seguran', 'security', 'teste', 'test', 'deploy', 'log', 'observability', 'hsts', 'csp']),
      },
    );

    if (asksForErrorLogging) {
      addTasksToMilestone(deliveryMilestone, [
        text(copy, 'renderDeliveryLoggingTaskOne'),
        text(copy, 'renderDeliveryLoggingTaskTwo'),
      ], '+2');
    }
    if (asksForRealUserValidation && productMilestone && !productMilestone.changeMarker) {
      addTasksToMilestone(productMilestone, [text(copy, 'renderProductRealUserTask')], '+1');
    }
    return milestones;
  }

  function mergeTasks(previousTasks = [], nextTasks = []) {
    const seen = new Set();
    const merged = [];
    [...previousTasks, ...nextTasks].forEach((task) => {
      if (!task) return;
      const key = normalizeRenderKey(task.title || task.id);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push({ ...task });
    });
    return merged;
  }

  function buildRequestedReleaseMilestone(requestText, nextNumber, referencePicker, copy) {
    const normalized = normalizeRenderKey(requestText);
    const asksExplicitNewStep = /\b(adicionar|adicione|incluir|inclua|criar|crie|colocar|coloque|add|include|create|insert|anadir|agregar|incluya|incluir|crear|cree)\b/.test(normalized)
      && /\b(etapa|passo|ponto|milestone|step|stage|hito|paso|fase|8|oitavo|eighth|octavo)\b/.test(normalized);
    const asksRelease = /liberacao|lancamento|release|publicacao|go live|deploy final|entrega final|lancar|publicar|launch|publication|final deployment|final delivery|lanzamiento|publicacion|despliegue final|entrega final|publica/.test(normalized);
    if (!asksExplicitNewStep || !asksRelease) return null;
    return {
      id: `render-milestone-manual-release-${now()}`,
      number: nextNumber,
      title: text(copy, 'renderReleaseTitle'),
      summary: text(copy, 'renderReleaseSummary'),
      status: 'planned',
      tasks: [
        { id: `render-task-release-${nextNumber}-1`, title: text(copy, 'renderReleaseTaskOne'), status: 'pending', isRefinement: true },
        { id: `render-task-release-${nextNumber}-2`, title: text(copy, 'renderReleaseTaskTwo'), status: 'pending', isRefinement: true },
        { id: `render-task-release-${nextNumber}-3`, title: text(copy, 'renderReleaseTaskThree'), status: 'pending', isRefinement: true },
      ],
      acceptanceCriteria: '',
      validationCommands: 'npm test\nnpm run build',
      commits: [],
      notes: text(copy, 'renderRefinementNotes'),
      references: referencePicker(['readme', 'deploy', 'release', 'teste', 'seguran', 'security', 'log']),
      changeMarker: { type: 'milestone', count: 1, label: '+1' },
    };
  }

  function mergeMilestonePlan(previousMilestones, nextMilestones, requestText, referencePicker, copy) {
    const merged = [];
    const byTitle = new Map();
    const addOrMerge = (milestone) => {
      if (!milestone) return;
      const key = normalizeRenderKey(milestone.title || milestone.id);
      if (!key) return;
      const existing = byTitle.get(key);
      if (!existing) {
        const clone = {
          ...milestone,
          tasks: Array.isArray(milestone.tasks) ? milestone.tasks.map((task) => ({ ...task })) : [],
          references: Array.isArray(milestone.references)
            ? milestone.references.map((reference) => ({ ...reference }))
            : [],
        };
        byTitle.set(key, clone);
        merged.push(clone);
        return;
      }
      existing.summary = milestone.summary || existing.summary;
      existing.status = milestone.status || existing.status;
      existing.acceptanceCriteria = milestone.acceptanceCriteria || existing.acceptanceCriteria || '';
      existing.validationCommands = milestone.validationCommands || existing.validationCommands || '';
      existing.notes = milestone.notes || existing.notes || '';
      existing.tasks = mergeTasks(existing.tasks, milestone.tasks);
      existing.references = Array.isArray(milestone.references) && milestone.references.length
        ? milestone.references.map((reference) => ({ ...reference }))
        : existing.references;
      existing.changeMarker = milestone.changeMarker || existing.changeMarker || null;
    };
    previousMilestones.forEach(addOrMerge);
    nextMilestones.forEach(addOrMerge);
    const requestedRelease = buildRequestedReleaseMilestone(
      requestText,
      merged.length + 1,
      referencePicker,
      copy,
    );
    if (requestedRelease && !merged.some((milestone) => /libera|lan[cç]amento|release/i.test(milestone.title || ''))) {
      merged.push(requestedRelease);
    }
    return merged.map((milestone, milestoneIndex) => {
      const number = milestoneIndex + 1;
      return {
        ...milestone,
        id: milestone.id || `render-milestone-${number}`,
        number,
        tasks: Array.isArray(milestone.tasks)
          ? milestone.tasks.map((task, taskIndex) => ({
            ...task,
            id: task.id || `render-task-${number}-${taskIndex + 1}`,
          }))
          : [],
      };
    });
  }

  function buildRenderPlan(input = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const mapData = payload.mapData && typeof payload.mapData === 'object' ? payload.mapData : {};
    const combinedText = String(payload.combinedText || '');
    const documents = Array.isArray(payload.documents) ? payload.documents.filter(Boolean) : [];
    const copy = payload.copy && typeof payload.copy === 'object' ? payload.copy : {};
    const previousMilestones = Array.isArray(payload.previousMilestones)
      ? payload.previousMilestones.filter(Boolean)
      : [];
    const requestText = String(payload.requestText || '');
    const readiness = evaluateReadiness(mapData, combinedText, copy);
    const generatedMilestones = buildMilestones(mapData, readiness, combinedText, documents, copy);
    const referencePicker = (keywords = []) => {
      const normalizedKeywords = keywords.map(normalizeRenderKey).filter(Boolean);
      return documents
        .filter((document) => {
          const searchable = normalizeRenderKey(`${document.path || ''}\n${document.content || ''}`);
          return normalizedKeywords.some((keyword) => searchable.includes(keyword));
        })
        .map((document) => ({ path: document.path }))
        .slice(0, 4);
    };
    const milestones = previousMilestones.length || requestText
      ? mergeMilestonePlan(previousMilestones, generatedMilestones, requestText, referencePicker, copy)
      : generatedMilestones;
    return {
      ok: true,
      checks: readiness.checks,
      missing: readiness.missing,
      ready: readiness.ready,
      milestones,
    };
  }

  return { buildRenderPlan };
}

module.exports = {
  createApplicationMapRenderPlanService,
};
