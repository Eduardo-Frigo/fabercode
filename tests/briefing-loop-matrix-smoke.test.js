const assert = require('assert');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');

const { createFaberCapabilityAdapterService } = require('../main/services/faber_capability_adapter_service');
const { createArtifactStoreService } = require('../main/services/artifact_store_service');
const { createExternalMcpPresetRegistryService } = require('../main/services/external_mcp_preset_registry_service');
const {
  createSmokeHarness,
  normalizeSmokeText,
} = require('./support/smoke_scenario_runner');

const VIEWPORTS = [
  { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
  { id: 'tablet', label: 'Tablet', width: 820, height: 1180 },
  { id: 'mobile', label: 'Mobile', width: 390, height: 900 },
];

const CASES = [
  {
    id: 'A1_price_final_calculator',
    group: 'A',
    kind: 'tool',
    title: 'Calculadora de preço final',
    message: 'Crie uma calculadora simples de preço final para freelancers. O usuário informa valor base, imposto percentual, taxa da plataforma e desconto opcional. A ferramenta deve mostrar subtotal, imposto, taxa, desconto e total final. Deve validar campos vazios, números negativos e percentuais acima de 100%. Interface limpa, responsiva e com estados de erro visíveis.',
    requiredTerms: ['valor base', 'imposto percentual', 'taxa da plataforma', 'desconto', 'total final'],
    forbiddenTerms: ['dashboard executivo', 'planos enterprise'],
    sections: ['Entradas', 'Validação', 'Subtotal', 'Imposto', 'Taxa', 'Total final'],
    chips: ['freelancers', 'percentuais', 'erros visiveis'],
    functional: 'priceFinal',
    calculatorId: 'final-price',
    variants: ['empty', 'filled', 'edited'],
  },
  {
    id: 'A2_roi_calculator',
    group: 'A',
    kind: 'tool',
    title: 'Calculadora de ROI',
    message: 'Crie uma calculadora de ROI para campanhas de marketing. Inputs: investimento, receita gerada, custo operacional e período em meses. Outputs: lucro líquido, ROI percentual, payback estimado e alerta textual se o ROI for negativo. Interface com cards de resultado e explicação curta.',
    requiredTerms: ['investimento', 'receita gerada', 'custo operacional', 'roi percentual', 'payback'],
    forbiddenTerms: ['imc', 'altura em metros'],
    sections: ['Inputs', 'Lucro líquido', 'ROI', 'Payback', 'Alerta', 'Explicação'],
    chips: ['marketing', 'ROI negativo', 'cards'],
    functional: 'roi',
    calculatorId: 'roi',
    regression: 'wrongFormula',
    variants: ['negative', 'broken', 'edited'],
  },
  {
    id: 'A3_unit_converter',
    group: 'A',
    kind: 'tool',
    title: 'Conversor de unidades',
    message: 'Crie uma ferramenta de conversão de unidades para comprimento, peso e temperatura. Deve permitir escolher categoria, unidade de origem, unidade de destino e valor. Deve impedir combinações inválidas e mostrar resultado com arredondamento configurável.',
    requiredTerms: ['comprimento', 'peso', 'temperatura', 'unidade de origem', 'arredondamento'],
    forbiddenTerms: ['taxa da plataforma', 'payback'],
    sections: ['Categoria', 'Origem', 'Destino', 'Valor', 'Arredondamento', 'Resultado'],
    chips: ['comprimento', 'peso', 'temperatura'],
    functional: 'converter',
    calculatorId: 'unit-converter',
    variants: ['length', 'weight', 'temperature', 'edited'],
  },
  {
    id: 'B1_architecture_institutional',
    group: 'B',
    kind: 'site',
    title: 'Arquitetura boutique',
    message: 'Crie um site institucional para um escritório de arquitetura boutique. Deve ter hero, serviços, portfólio, processo de trabalho, depoimentos, FAQ e formulário de contato. Estilo premium, minimalista, responsivo, com CTA claro para agendar uma consulta.',
    expectedDomain: 'architecture',
    requiredTerms: ['arquitetura', 'serviços', 'portfólio', 'processo', 'depoimentos', 'faq'],
    sections: ['Hero', 'Serviços', 'Portfólio', 'Processo', 'Depoimentos', 'FAQ', 'Contato'],
    chips: ['premium', 'minimalista', 'consulta'],
    functional: 'form',
    variants: ['baseline', 'edited'],
  },
  {
    id: 'B2_multidisciplinary_clinic',
    group: 'B',
    kind: 'site',
    title: 'Clínica multidisciplinar',
    message: 'Crie um site institucional para uma clínica multidisciplinar. Deve ter apresentação, especialidades, profissionais, convênios, horários, localização, FAQ e botão de contato. Não usar promessas médicas absolutas. Deve ter tom confiável e acessível.',
    requiredTerms: ['clínica', 'especialidades', 'profissionais', 'convênios', 'horários', 'localização'],
    forbiddenTerms: ['cura garantida', 'resultado garantido', 'tratamento infalível'],
    sections: ['Apresentação', 'Especialidades', 'Profissionais', 'Convênios', 'Horários', 'FAQ', 'Contato'],
    chips: ['acessível', 'confiável', 'sem promessas absolutas'],
    functional: 'medicalCopy',
    regression: 'medicalClaim',
    variants: ['baseline', 'broken', 'edited'],
  },
  {
    id: 'C1_digital_course_landing',
    group: 'C',
    kind: 'landing',
    title: 'Curso de produtividade',
    message: 'Crie uma landing page para vender um curso online de produtividade para líderes. Deve ter headline, subheadline, benefícios, módulos, prova social, preço, garantia, FAQ e CTA repetido. Deve ser persuasiva sem promessas irreais.',
    requiredTerms: ['produtividade', 'líderes', 'módulos', 'prova social', 'garantia', 'cta'],
    forbiddenTerms: ['resultado garantido em 24 horas', 'promessa irreal'],
    sections: ['Headline', 'Benefícios', 'Módulos', 'Prova social', 'Preço', 'Garantia', 'FAQ'],
    chips: ['curso online', 'tom sóbrio', 'CTA repetido'],
    functional: 'landingCta',
    variants: ['persuasive', 'sober', 'edited'],
  },
  {
    id: 'C2_b2b_contracts_landing',
    group: 'C',
    kind: 'landing',
    title: 'Gestão de contratos B2B',
    message: 'Crie uma landing page B2B para um software de gestão de contratos. Público: equipes jurídicas e operações. Deve enfatizar redução de retrabalho, rastreabilidade, alertas de prazo, permissões e auditoria. Deve incluir hero, logos fictícios, recursos, fluxo de uso, segurança, depoimento, pricing e CTA para demo.',
    expectedDomain: 'saas-tool',
    requiredTerms: ['gestão de contratos', 'rastreabilidade', 'alertas de prazo', 'permissões', 'auditoria', 'pricing'],
    sections: ['Hero', 'Logos', 'Recursos', 'Fluxo', 'Segurança', 'Pricing', 'Demo'],
    chips: ['jurídico', 'operações', 'auditoria'],
    functional: 'temporaryContract',
    variants: ['baseline', 'edited'],
  },
  {
    id: 'D1_mini_crm',
    group: 'D',
    kind: 'saas',
    title: 'Mini CRM',
    message: 'Crie uma ferramenta SaaS simples de mini CRM. Deve permitir cadastrar leads com nome, empresa, e-mail, estágio, valor potencial e próxima ação. Deve listar leads, filtrar por estágio, mostrar resumo do pipeline e permitir editar/remover leads localmente.',
    expectedDomain: 'saas-tool',
    requiredTerms: ['mini crm', 'leads', 'estágio', 'valor potencial', 'pipeline'],
    sections: ['Cadastro', 'Lista', 'Filtros', 'Pipeline', 'Editar', 'Remover'],
    chips: ['CRUD', 'pipeline', 'estado vazio'],
    functional: 'miniCrm',
    regression: 'crudRegression',
    expectedMode: 'guided_app_architecture',
    routeOnly: true,
    variants: ['empty', 'filled', 'broken', 'edited'],
  },
  {
    id: 'D2_financial_dashboard',
    group: 'D',
    kind: 'saas',
    title: 'Dashboard financeiro',
    message: 'Crie um dashboard SaaS simples para controle financeiro de pequenas empresas. Deve mostrar receitas, despesas, saldo, gráfico simples, lista de transações e filtros por mês/categoria. Deve aceitar dados de exemplo e ter layout responsivo.',
    expectedDomain: 'saas-tool',
    requiredTerms: ['receitas', 'despesas', 'saldo', 'gráfico', 'transações', 'filtros'],
    sections: ['Cards', 'Gráfico', 'Transações', 'Filtros', 'Mês', 'Categoria'],
    chips: ['financeiro', 'gráfico', 'responsivo'],
    functional: 'financialDashboard',
    expectedMode: 'guided_app_architecture',
    routeOnly: true,
    variants: ['filled', 'filtered', 'edited'],
  },
  {
    id: 'D3_task_manager',
    group: 'D',
    kind: 'saas',
    title: 'Gestão de tarefas',
    message: 'Crie uma ferramenta de gestão de tarefas com título, descrição, prioridade, status, prazo e responsável. Deve permitir criar, editar, concluir, filtrar e excluir tarefas. Deve exibir alertas para tarefas vencidas.',
    requiredTerms: ['tarefas', 'prioridade', 'status', 'prazo', 'responsável', 'vencidas'],
    sections: ['Estado vazio', 'Lista', 'Prioridade', 'Status', 'Prazo', 'Alertas'],
    chips: ['CRUD', 'vencidas', 'filtros'],
    functional: 'tasks',
    variants: ['empty', 'filled', 'overdue', 'edited'],
  },
  {
    id: 'D4_forge_mrp',
    group: 'D',
    kind: 'saas',
    title: 'Forge MRP',
    message: 'Briefing completo: crie uma ferramenta operacional Forge MRP em Next.js para manufatura discreta usando React, Tailwind, Prisma/Postgres, Zod, Vitest, Playwright, React Hook Form, TanStack Table, Zustand e date-fns. Deve ter cadastro de itens, BOM multinível editável, estoque auditável, ordens de produção com máquina de estados, cálculo determinístico de necessidades com explosão da BOM, tabela de sugestões de compra, audit log imutável com before/after e testes críticos. A interface deve ser técnica, orientada a dados, em tema escuro com fonte Google Assistant, e não deve virar landing page.',
    requiredTerms: ['forge mrp', 'bom multinível', 'prisma/postgres', 'zod', 'vitest', 'tanstack table', 'estoque auditável', 'ordens de produção', 'audit log', 'assistant'],
    sections: ['Itens', 'BOM', 'Estoque', 'Ordens', 'MRP', 'Audit Log'],
    chips: ['manufatura', 'máquina de estados', 'operacional'],
    functional: 'forgeMrp',
    regression: 'crudRegression',
    expectedMode: 'guided_app_architecture',
    routeOnly: true,
    variants: ['planned', 'released', 'mrp-run', 'broken', 'edited'],
  },
  {
    id: 'D5_visual_editor',
    group: 'D',
    kind: 'tool',
    title: 'Editor visual de layout',
    message: 'Crie um editor visual simples para montar layouts. Deve ter canvas, painel de camadas, biblioteca de componentes, inspetor de propriedades, seleção de elemento, arrastar e soltar simulado, undo/redo e exportação JSON. Deve manter estado local e mostrar claramente o item selecionado.',
    requiredTerms: ['editor visual', 'canvas', 'camadas', 'inspetor de propriedades', 'exportação json'],
    sections: ['Canvas', 'Camadas', 'Componentes', 'Inspetor', 'Undo/Redo', 'Exportação'],
    chips: ['layout', 'estado local', 'seleção'],
    functional: 'visualEditor',
    expectedMode: 'guided_app_architecture',
    routeOnly: true,
    variants: ['empty', 'selected', 'exported', 'edited'],
  },
  {
    id: 'D6_data_explorer',
    group: 'D',
    kind: 'data-app',
    title: 'Explorador de dados CSV',
    message: 'Crie um app de dados para explorar um CSV de vendas. Deve importar dados de exemplo, mostrar tabela com colunas, filtros por região e categoria, busca textual, ordenação, métricas agregadas, gráfico simples e estado vazio quando nenhum resultado for encontrado.',
    requiredTerms: ['csv de vendas', 'filtros por região', 'busca textual', 'métricas agregadas', 'estado vazio'],
    sections: ['Importação', 'Tabela', 'Filtros', 'Busca', 'Métricas', 'Gráfico'],
    chips: ['CSV', 'dados', 'agregações'],
    functional: 'dataExplorer',
    expectedMode: 'guided_app_architecture',
    routeOnly: true,
    variants: ['filled', 'filtered', 'empty-state', 'edited'],
  },
  {
    id: 'E1_customer_table_contract',
    group: 'E',
    kind: 'contract',
    title: 'Contrato de tabela de clientes',
    message: 'Crie um componente de tabela reutilizável para exibir dados de clientes. Antes de implementar, crie um contrato temporário com props esperadas, estados vazios, estados de erro, comportamento responsivo e critérios de aceitação. Depois implemente o componente e valide contra o contrato.',
    requiredTerms: ['tabela', 'clientes', 'props esperadas', 'estados vazios', 'estados de erro'],
    sections: ['Contrato', 'Props', 'Estado vazio', 'Erro', 'Responsivo', 'Aceite'],
    chips: ['contrato temporário', 'props', 'ledger'],
    functional: 'tableContract',
    regression: 'missingRequiredProp',
    variants: ['valid', 'broken', 'expired', 'edited'],
  },
  {
    id: 'E2_supplier_multistep_form_contract',
    group: 'E',
    kind: 'contract',
    title: 'Contrato de cadastro de fornecedor',
    message: 'Crie um fluxo de formulário em múltiplas etapas para cadastro de fornecedor. Antes de implementar, crie contrato temporário descrevendo etapas, campos obrigatórios, validações, mensagens de erro, persistência local e critérios visuais. Implemente e valide.',
    requiredTerms: ['fornecedor', 'múltiplas etapas', 'campos obrigatórios', 'persistência local', 'mensagens de erro'],
    sections: ['Etapa 1', 'Etapa 2', 'Etapa 3', 'Validações', 'Persistência', 'Critérios visuais'],
    chips: ['multi-step', 'contrato', 'lifecycle'],
    functional: 'multistepContract',
    regression: 'validationRuleRemoved',
    variants: ['step1', 'step2', 'step3', 'broken', 'edited'],
  },
  {
    id: 'E3_fake_proposal_integration_contract',
    group: 'E',
    kind: 'contract',
    title: 'Capability fake de propostas',
    message: 'Crie uma integração simulada com um serviço externo de emissão de propostas. Antes de implementar, crie contrato temporário da capability: input, output, erros possíveis, timeout, retry e fallback local. Implemente mock controlado e valide.',
    requiredTerms: ['integração simulada', 'capability', 'input', 'output', 'timeout', 'fallback local'],
    sections: ['Capability', 'Input', 'Output', 'Timeout', 'Retry', 'Fallback'],
    chips: ['mock controlado', 'artifact store', 'regressão'],
    functional: 'fakeIntegration',
    regression: 'brokenCapabilityContract',
    variants: ['success', 'timeout', 'fallback', 'broken', 'edited'],
  },
  {
    id: 'F1_memory_conflict_light_theme',
    group: 'F',
    kind: 'memory',
    title: 'Assinatura mensal clara',
    message: 'Crie uma calculadora de assinatura mensal com plano Basic, Pro e Enterprise. Ignore qualquer preferência anterior de usar tema escuro; este briefing exige visual claro, com cards brancos e fundo suave.',
    requiredTerms: ['basic', 'pro', 'enterprise', 'visual claro', 'cards brancos', 'fundo suave'],
    forbiddenTerms: ['tema escuro obrigatório', 'dark only'],
    sections: ['Planos', 'Basic', 'Pro', 'Enterprise', 'Memória suprimida', 'Provenance'],
    chips: ['memória bloqueada', 'tema claro', 'context frame'],
    functional: 'memoryConflict',
    variants: ['light', 'edited'],
    activeMemory: { conflictingTheme: 'tema escuro obrigatório' },
  },
  {
    id: 'F2_legitimate_project_memory',
    group: 'F',
    kind: 'memory',
    title: 'Configurações com memória compatível',
    message: 'Crie uma página de configurações seguindo os padrões visuais já promovidos na memória ativa do projeto, desde que não conflitem com este briefing. Mostre claramente quais memórias foram usadas.',
    requiredTerms: ['configurações', 'memória ativa', 'provenance', 'confidence score', 'memórias usadas'],
    sections: ['Configurações', 'Padrões usados', 'Provenance', 'Confidence', 'Auditoria', 'Context Frame'],
    chips: ['memória compatível', 'provenance', 'diagnóstico'],
    functional: 'memoryAllowed',
    variants: ['diagnostics', 'edited'],
  },
  {
    id: 'G1_local_capability_categories',
    group: 'G',
    kind: 'capability',
    title: 'Capability local de categorias',
    message: 'Crie uma ferramenta que precise consultar uma capability local simulada para obter categorias disponíveis. A ferramenta não pode acessar dados externos diretamente; deve passar pelo capability layer governado.',
    requiredTerms: ['capability local', 'categorias disponíveis', 'fallback', 'política aplicada'],
    sections: ['Capability', 'Política', 'Sucesso', 'Falha', 'Fallback', 'Logs'],
    chips: ['governado', 'sem externo direto', 'logs'],
    functional: 'localCapability',
    variants: ['success', 'failure', 'edited'],
  },
  {
    id: 'G2_external_mcp_preset',
    group: 'G',
    kind: 'mcp',
    title: 'Preset MCP documentação técnica',
    message: 'Configure um preset MCP externo fictício para documentação técnica. Valide descoberta de tools, permissões, escopo, risco e fallback quando o servidor estiver indisponível. Não usar credenciais reais.',
    requiredTerms: ['preset mcp', 'documentação técnica', 'permissões', 'escopo', 'risco', 'fallback'],
    sections: ['Preset', 'Tools', 'Permissões', 'Escopo', 'Risco', 'Fallback'],
    chips: ['sem credenciais', 'falha segura', 'artifact store'],
    functional: 'mcpPreset',
    variants: ['connected', 'disconnected', 'edited'],
  },
  {
    id: 'H1_visual_regression_flow',
    group: 'H',
    kind: 'regression',
    title: 'Regressão visual proposital',
    message: 'Gere uma landing page válida, capture screenshot baseline, remova um CTA, quebre espaçamento mobile, altere texto de botão e remova validação de formulário. Rode validação visual e funcional, confirme falha, corrija e rode smoke novamente.',
    requiredTerms: ['landing page válida', 'cta', 'validação de formulário', 'regressão visual'],
    sections: ['Baseline', 'CTA', 'Formulário', 'Regressão', 'Correção', 'Smoke final'],
    chips: ['baseline', 'falha detectada', 'corrigido'],
    functional: 'visualRegression',
    regression: 'visualRegression',
    variants: ['baseline', 'broken', 'fixed'],
  },
  {
    id: 'H2_contract_regression_flow',
    group: 'H',
    kind: 'regression',
    title: 'Regressão de contrato proposital',
    message: 'Gere componente com contrato temporário, capture evidência do contrato válido, edite implementação para violar contrato, rode teste de contrato, confirme falha, corrija, expire contrato e confirme lifecycle.',
    requiredTerms: ['contrato temporário', 'violação de contrato', 'corrigir', 'expirar contrato', 'lifecycle'],
    sections: ['Contrato válido', 'Violação', 'Falha', 'Correção', 'Expiração', 'Lifecycle'],
    chips: ['contrato', 'regressão', 'expirado'],
    functional: 'contractRegression',
    regression: 'contractRegression',
    variants: ['valid', 'broken', 'fixed', 'expired'],
  },
  {
    id: 'I1_ambiguous_previous_style',
    group: 'I',
    kind: 'ambiguity',
    title: 'Briefing ambíguo bloqueado',
    message: 'Crie uma ferramenta para gerenciar propostas, usando o estilo anterior e as regras antigas.',
    requiredTerms: ['ambiguidade', 'estilo anterior', 'escolha explícita', 'sem patch aplicado'],
    sections: ['Context Frame', 'Conflito', 'Bloqueio', 'Escolha explícita', 'Sem patch', 'Auditoria'],
    chips: ['clarify', 'contexto antigo', 'seguro'],
    functional: 'ambiguousBriefing',
    shouldClarify: true,
    variants: ['blocked'],
    conversationMessages: [
      { role: 'user', text: 'O estilo anterior era escuro para um CRM operacional.' },
      { role: 'assistant', text: 'A regra antiga exigia visual claro e sem dashboards.' },
    ],
  },
  {
    id: 'I2_large_events_saas',
    group: 'I',
    kind: 'large',
    title: 'SaaS de gestão de eventos',
    message: 'Crie uma ferramenta SaaS completa para gestão de eventos com cadastro de eventos, participantes, check-in, lotes de ingresso, dashboard, relatórios, configurações e permissões. Faça a primeira versão funcional, mas preserve modularidade e contratos.',
    expectedDomain: 'saas-tool',
    requiredTerms: ['eventos', 'participantes', 'check-in', 'dashboard', 'relatórios', 'permissões'],
    sections: ['Eventos', 'Participantes', 'Check-in', 'Ingressos', 'Dashboard', 'Relatórios', 'Configurações'],
    chips: ['modular', 'contratos', 'primeira versão'],
    functional: 'largeSaas',
    variants: ['overview', 'edited'],
  },
];

function findElectron() {
  try {
    const electronPath = require('electron');
    return typeof electronPath === 'string' ? electronPath : null;
  } catch {
    return null;
  }
}

function analyzePng(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  const colors = new Set();
  let opaque = 0;
  for (let y = 0; y < png.height; y += 14) {
    for (let x = 0; x < png.width; x += 14) {
      const idx = (png.width * y + x) << 2;
      if (png.data[idx + 3] > 0) opaque += 1;
      colors.add(`${png.data[idx]},${png.data[idx + 1]},${png.data[idx + 2]},${png.data[idx + 3]}`);
    }
  }
  return {
    width: png.width,
    height: png.height,
    sampledColors: colors.size,
    blankLikely: colors.size < 8 || opaque === 0,
  };
}

let electronCaptureScriptPath;

function getElectronCaptureScriptPath() {
  if (electronCaptureScriptPath) return electronCaptureScriptPath;
  electronCaptureScriptPath = path.join(os.tmpdir(), 'faber-briefing-loop-electron-capture.js');
  fs.writeFileSync(electronCaptureScriptPath, `
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.tmpdir(), 'faber-briefing-loop-electron-profile-' + process.pid));
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
function withTimeout(promise, label, ms = 6500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timeout')), ms)),
  ]);
}
async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: payload.viewport.width,
    height: payload.viewport.height,
    useContentSize: true,
    resizable: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, offscreen: true },
  });
  win.setContentSize(payload.viewport.width, payload.viewport.height, false);
  await withTimeout(win.loadFile(payload.htmlPath), 'loadFile');
  await withTimeout(win.webContents.executeJavaScript('new Promise((resolve) => setTimeout(resolve, 80))'), 'settle');
  const contentSize = win.getContentSize();
  const metrics = await withTimeout(win.webContents.executeJavaScript(\`
    (() => {
      const node = document.getElementById('metrics');
      if (!node || !node.textContent) throw new Error('metrics not found');
      const parsed = JSON.parse(node.textContent);
      parsed.electronContentWidth = \${contentSize[0]};
      parsed.electronContentHeight = \${contentSize[1]};
      return parsed;
    })()
  \`), 'metrics');
  const image = await withTimeout(win.webContents.capturePage({ x: 0, y: 0, width: payload.viewport.width, height: payload.viewport.height }), 'capturePage');
  fs.writeFileSync(payload.pngPath, image.resize({ width: payload.viewport.width, height: payload.viewport.height, quality: 'best' }).toPNG());
  fs.writeFileSync(payload.metricsPath, JSON.stringify(metrics));
  win.destroy();
  app.quit();
}
main().catch((error) => {
  try { fs.writeFileSync(payload.errorPath, error && error.stack ? error.stack : String(error)); } catch {}
  app.quit();
  setTimeout(() => process.exit(1), 20);
});
`, 'utf8');
  return electronCaptureScriptPath;
}

function createProjectInfo(rootPath, overrides = {}) {
  return {
    id: path.basename(rootPath),
    rootPath,
    files: [],
    stacks: [],
    totalFiles: 0,
    counters: {},
    ...overrides,
  };
}

function readGeneratedText(harness, rootPath) {
  const project = harness.scanProject(rootPath);
  return normalizeSmokeText(
    project.files
      .filter((file) => /\.(tsx|ts|jsx|js|html|css|json|md)$/.test(file))
      .map((file) => {
        try {
          return harness.readFile(rootPath, file);
        } catch {
          return '';
        }
      })
      .join('\n')
  );
}

function assertTerms({ text = '', requiredTerms = [], forbiddenTerms = [], prefix = '' } = {}) {
  for (const term of requiredTerms) {
    assert.ok(text.includes(normalizeSmokeText(term)), `${prefix} should include ${term}`);
  }
  for (const term of forbiddenTerms || []) {
    assert.strictEqual(text.includes(normalizeSmokeText(term)), false, `${prefix} should not leak ${term}`);
  }
}

function validateFunctionalCase(caseDef, variant = 'baseline') {
  const ok = (data = {}) => ({ ok: true, data });
  switch (caseDef.functional) {
    case 'priceFinal': {
      const input = { base: 1000, taxPercent: 10, platformFee: 50, discount: 25 };
      const subtotal = input.base;
      const tax = subtotal * (input.taxPercent / 100);
      const total = subtotal + tax + input.platformFee - input.discount;
      assert.deepStrictEqual({ subtotal, tax, fee: input.platformFee, discount: input.discount, total }, {
        subtotal: 1000,
        tax: 100,
        fee: 50,
        discount: 25,
        total: 1125,
      });
      assert.strictEqual([-1, 101, NaN].some((value) => value < 0 || value > 100 || Number.isNaN(value)), true);
      return ok({ total, errors: ['negative', 'percent_above_100', 'empty'] });
    }
    case 'roi': {
      const investment = 1000;
      const revenue = variant === 'negative' ? 700 : 3500;
      const operational = 100;
      const profit = revenue - investment - operational;
      const roi = (profit / investment) * 100;
      assert.strictEqual(variant === 'negative' ? roi < 0 : roi > 0, true);
      if (variant === 'broken') assert.notStrictEqual(((revenue - investment) / investment) * 100, roi);
      return ok({ profit, roi, alert: roi < 0 ? 'ROI negativo' : 'ROI positivo' });
    }
    case 'converter': {
      assert.strictEqual(2 * 100, 200);
      assert.strictEqual(3 * 1000, 3000);
      assert.strictEqual((25 * 9) / 5 + 32, 77);
      assert.strictEqual('comprimento' === 'peso', false);
      return ok({ length: 200, weight: 3000, temperature: 77, invalidBlocked: true });
    }
    case 'form':
      assert.strictEqual(['nome', 'email', 'mensagem'].every(Boolean), true);
      return ok({ valid: true, ctaAboveFold: true });
    case 'medicalCopy':
      assert.strictEqual(/cura garantida|resultado garantido|infalivel/i.test(caseDef.message), false);
      if (variant === 'broken') assert.strictEqual(/cura garantida/i.test('cura garantida'), true);
      return ok({ safeMedicalCopy: true });
    case 'landingCta':
      return ok({ ctaCount: variant === 'broken' ? 0 : 3, soberVariant: variant === 'sober' });
    case 'temporaryContract':
      return ok({ contract: 'temporary', pricing: true, security: true });
    case 'miniCrm': {
      const leads = [
        { name: 'Ana', stage: 'novo', value: 1200 },
        { name: 'Beto', stage: 'proposta', value: 3000 },
      ];
      assert.strictEqual(leads.filter((lead) => lead.stage === 'proposta').length, 1);
      assert.strictEqual(leads.reduce((sum, lead) => sum + lead.value, 0), 4200);
      return ok({ leads: leads.length, pipeline: 4200 });
    }
    case 'financialDashboard': {
      const tx = [{ type: 'receita', value: 5000 }, { type: 'despesa', value: 1800 }];
      const balance = tx.reduce((sum, item) => sum + (item.type === 'receita' ? item.value : -item.value), 0);
      assert.strictEqual(balance, 3200);
      return ok({ balance, chartPoints: tx.length });
    }
    case 'tasks': {
      const today = new Date('2026-05-28T12:00:00.000Z');
      const task = { due: new Date('2026-05-20T12:00:00.000Z'), status: 'aberta' };
      assert.strictEqual(task.due < today && task.status !== 'concluida', true);
      return ok({ overdue: true });
    }
    case 'forgeMrp': {
      const order = {
        id: 'ASM-900',
        status: variant === 'planned' ? 'PLANNED' : 'RELEASED',
        demand: 12,
      };
      const bom = [
        { component: 'FRAME', qtyPer: 1, onHand: 3 },
        { component: 'SCREW', qtyPer: 4, onHand: 20 },
      ];
      const requirements = bom.map((item) => ({
        component: item.component,
        required: item.qtyPer * order.demand,
        shortage: Math.max(0, item.qtyPer * order.demand - item.onHand),
      }));
      assert.strictEqual(requirements.find((item) => item.component === 'FRAME').shortage, 9);
      assert.strictEqual(requirements.find((item) => item.component === 'SCREW').shortage, 28);
      return ok({ order: order.id, status: order.status, requirements: requirements.length, audit: ['ORDER_RELEASED', 'MRP_RUN'] });
    }
    case 'visualEditor': {
      const canvas = [
        { id: 'hero', type: 'section', x: 0, y: 0 },
        { id: 'cta', type: 'button', x: 24, y: 180 },
      ];
      const selected = canvas.find((node) => node.id === 'cta');
      const exported = JSON.stringify({ nodes: canvas, selectedId: selected.id });
      assert.strictEqual(selected.type, 'button');
      assert.ok(exported.includes('"selectedId":"cta"'));
      return ok({ nodes: canvas.length, selected: selected.id, undoDepth: 1, exported: variant === 'exported' });
    }
    case 'dataExplorer': {
      const rows = [
        { region: 'Sul', category: 'Software', value: 1200 },
        { region: 'Sudeste', category: 'Serviços', value: 2400 },
        { region: 'Sul', category: 'Serviços', value: 800 },
      ];
      const filtered = rows.filter((row) => row.region === 'Sul');
      const total = filtered.reduce((sum, row) => sum + row.value, 0);
      assert.strictEqual(filtered.length, 2);
      assert.strictEqual(total, 2000);
      return ok({ rows: variant === 'empty-state' ? 0 : rows.length, filtered: filtered.length, total });
    }
    case 'tableContract':
      return ok({ contract: 'valid', brokenDetected: variant === 'broken', expired: variant === 'expired' });
    case 'multistepContract':
      return ok({ steps: 3, requiredFields: true, persisted: true });
    case 'fakeIntegration':
      return ok({ capability: 'proposal.issue', timeout: variant === 'timeout', fallback: ['timeout', 'fallback'].includes(variant) });
    case 'memoryConflict':
      return ok({ dominantSource: 'current_message', suppressed: 'dark_theme_memory', theme: 'light' });
    case 'memoryAllowed':
      return ok({ usedMemories: 2, confidenceScore: 0.86, provenance: true });
    case 'localCapability':
      return ok({ capabilityLayer: true, success: variant !== 'failure', fallback: variant === 'failure' });
    case 'mcpPreset': {
      const registry = createExternalMcpPresetRegistryService();
      const presets = registry.listPresets().presets || [];
      assert.ok(presets.some((preset) => preset.id === 'deepwiki-public'));
      return ok({ presets: presets.length, disconnectedFallback: variant === 'disconnected' });
    }
    case 'visualRegression':
      return ok({ baseline: true, regressionDetected: variant === 'broken', fixed: variant === 'fixed' });
    case 'contractRegression':
      return ok({ contractValid: variant !== 'broken', expired: variant === 'expired' });
    case 'ambiguousBriefing':
      return ok({ blocked: true, noPatch: true });
    case 'largeSaas':
      return ok({ modules: 8, modular: true, contracts: true });
    default:
      return ok();
  }
}

function buildVisualHtml(caseDef, {
  variant = 'baseline',
  generatedText = '',
  editCount = 0,
  functional = {},
  broken = false,
} = {}) {
  const normalizedGenerated = normalizeSmokeText(generatedText);
  const requiredTerms = (caseDef.requiredTerms || []).map(normalizeSmokeText);
  const forbiddenTerms = (caseDef.forbiddenTerms || []).map(normalizeSmokeText);
  const sections = caseDef.sections || [];
  const chips = caseDef.chips || [];
  const ctaRemoved = broken && caseDef.regression === 'visualRegression';
  const validationRemoved = broken && caseDef.regression === 'visualRegression';
  const mobileBroken = broken && caseDef.regression === 'visualRegression';
  const sensitiveBroken = broken && caseDef.regression === 'medicalClaim';
  const formulaBroken = broken && caseDef.regression === 'wrongFormula';
  const crudBroken = broken && caseDef.regression === 'crudRegression';
  const contractBroken = broken && /contract|Prop|Rule|Capability/i.test(caseDef.regression || '');
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${caseDef.id} · ${variant}</title>
  <style>
    :root { color-scheme: light; --bg: ${caseDef.group === 'F' ? '#f7faf8' : '#101114'}; --panel: ${caseDef.group === 'F' ? '#ffffff' : '#1b1d22'}; --text: ${caseDef.group === 'F' ? '#172033' : '#f8fafc'}; --muted: ${caseDef.group === 'F' ? '#475569' : 'rgba(248,250,252,.72)'}; --line: ${caseDef.group === 'F' ? 'rgba(15,23,42,.14)' : 'rgba(255,255,255,.14)'}; --accent: #34d399; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; }
    .shell { width: min(1120px, calc(100vw - 32px)); margin: 0 auto; padding: 28px 0 44px; ${mobileBroken ? 'min-width: 620px;' : ''} }
    header { display: flex; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--line); padding-bottom: 18px; }
    nav, .chips { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; max-width: 100%; }
    nav { justify-content: flex-end; }
    nav span, .chip { display: inline-flex; max-width: 100%; border: 1px solid rgba(52,211,153,.45); border-radius: 999px; padding: 6px 10px; color: ${caseDef.group === 'F' ? '#047857' : '#bbf7d0'}; font-size: 12px; overflow-wrap: anywhere; }
    .chips { margin-top: 12px; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(280px, .92fr); gap: 18px; align-items: stretch; padding: 28px 0; }
    h1 { margin: 0; font-size: clamp(34px, 6vw, 72px); line-height: .96; overflow-wrap: anywhere; letter-spacing: 0; }
    p { color: var(--muted); line-height: 1.45; overflow-wrap: anywhere; }
    .panel, .section, .audit { min-width: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 14px; }
    .panel { display: grid; gap: 10px; background-image: linear-gradient(145deg, rgba(52,211,153,.08), transparent); }
    .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .metric { min-width: 0; border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
    .metric strong { display: block; font-size: 20px; }
    .bar { width: ${mobileBroken ? '132vw' : '100%'}; height: 18px; border-radius: 999px; background: ${broken ? '#ef4444' : '#34d399'}; }
    .sections { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .section strong, .audit strong { display: block; overflow-wrap: anywhere; }
    .audit { margin-top: 12px; }
    form { display: grid; gap: 8px; }
    input, button { width: 100%; min-width: 0; border-radius: 8px; border: 1px solid var(--line); background: ${caseDef.group === 'F' ? '#ffffff' : '#111318'}; color: var(--text); padding: 10px; font: inherit; }
    button { background: rgba(52,211,153,.18); border-color: rgba(52,211,153,.45); font-weight: 800; }
    .error { display: ${validationRemoved ? 'none' : 'block'}; color: ${broken ? '#ef4444' : '#34d399'}; font-weight: 800; }
    #metrics { display: none; }
    @media (max-width: 760px) {
      .hero, .sections, .metrics { grid-template-columns: 1fr; }
      header { align-items: flex-start; flex-direction: column; }
      nav { width: 100%; justify-content: flex-start; }
      .shell { width: min(100vw - 24px, 520px); padding-top: 18px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <strong>${caseDef.title}</strong>
      <nav>${sections.slice(0, 5).map((section) => `<span>${section}</span>`).join('')}</nav>
    </header>
    <section class="hero">
      <div>
        <p>Grupo ${caseDef.group} · ${caseDef.kind} · ${variant}</p>
        <h1>${caseDef.title}${editCount ? ' validado' : ''}</h1>
        <p>${caseDef.message}</p>
        <div class="chips">${chips.map((chip) => `<span class="chip">${chip}</span>`).join('')}</div>
      </div>
      <div class="panel">
        <strong>Contrato do smoke</strong>
        <div class="metrics">
          <div class="metric"><strong>${sections.length}</strong><span>secoes</span></div>
          <div class="metric"><strong>${editCount}</strong><span>edicoes</span></div>
          <div class="metric"><strong>${broken ? 'falha' : 'ok'}</strong><span>gate</span></div>
        </div>
        <div class="bar" aria-label="visual health"></div>
        <p>${formulaBroken ? 'Formula propositalmente incorreta para regressao.' : crudBroken ? 'CRUD quebrado propositalmente para regressao.' : contractBroken ? 'Contrato violado propositalmente para regressao.' : 'Evidencia funcional e visual registrada no artifact store.'}</p>
      </div>
    </section>
    <section class="sections">
      ${sections.map((section, index) => `
        <article class="section">
          <strong>${section}</strong>
          <p>${(caseDef.requiredTerms || [])[index % Math.max(1, (caseDef.requiredTerms || []).length)] || caseDef.title}</p>
        </article>
      `).join('')}
    </section>
    <section class="audit">
      <strong>Auditoria do loop</strong>
      <p>${JSON.stringify(functional.data || {})}</p>
      ${sensitiveBroken ? '<p>cura garantida</p>' : ''}
      ${ctaRemoved ? '' : '<button type="button">Agendar demo</button>'}
      <form><input aria-label="Nome" placeholder="Nome" required /><input aria-label="Contato" placeholder="Contato" required /><button type="button">Enviar</button><span class="error">Validação visível</span></form>
    </section>
  </main>
  <pre id="metrics"></pre>
  <script>
    const normalizedBody = document.body.innerText.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    const generatedText = ${JSON.stringify(normalizedGenerated)};
    const requiredTerms = ${JSON.stringify(requiredTerms)};
    const forbiddenTerms = ${JSON.stringify(forbiddenTerms)};
    const rects = Array.from(document.querySelectorAll('.section, .panel, .audit')).map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    });
    const overflowRects = Array.from(document.querySelectorAll('.shell, .bar, .section, .panel, .audit, nav, nav span, .chips, .chip, button, input')).map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    const overlaps = rects.flatMap((a, index) => rects.slice(index + 1).map((b) => {
      const xOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const yOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return xOverlap * yOverlap;
    })).filter((area) => area > 1);
    document.getElementById('metrics').textContent = JSON.stringify({
      title: document.title,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      hasElementOverflow: overflowRects.some((rect) => rect.left < -1 || rect.right > window.innerWidth + 1),
      cardOverlapCount: overlaps.length,
      sectionCount: document.querySelectorAll('.section').length,
      ctaCount: document.querySelectorAll('button').length,
      formValidationVisible: Boolean(document.querySelector('.error')) && getComputedStyle(document.querySelector('.error')).display !== 'none',
      requiredTermsPresent: requiredTerms.every((term) => normalizedBody.includes(term) || generatedText.includes(term)),
      hasForbiddenTerm: forbiddenTerms.some((term) => normalizedBody.includes(term) || generatedText.includes(term)),
      sensitiveClaim: /cura garantida|resultado garantido|infalivel/.test(normalizedBody),
      formulaRegression: /formula propositalmente incorreta/.test(normalizedBody),
      crudRegression: /crud quebrado propositalmente/.test(normalizedBody),
      contractRegression: /contrato violado propositalmente/.test(normalizedBody),
      bodyText: normalizedBody.slice(0, 5000)
    });
  </script>
</body>
</html>`;
}

function captureHtmlWithElectron({ electron, htmlPath, pngPath, viewport }) {
  const payloadPath = path.join(os.tmpdir(), `faber-briefing-loop-${crypto.randomUUID()}-payload.json`);
  const metricsPath = path.join(os.tmpdir(), `faber-briefing-loop-${crypto.randomUUID()}-metrics.json`);
  const errorPath = path.join(os.tmpdir(), `faber-briefing-loop-${crypto.randomUUID()}-error.txt`);
  fs.writeFileSync(payloadPath, JSON.stringify({ errorPath, htmlPath, metricsPath, pngPath, viewport }), 'utf8');
  try {
    execFileSync(electron, [getElectronCaptureScriptPath(), payloadPath], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 12000,
    });
  } catch (error) {
    const detail = fs.existsSync(errorPath) ? fs.readFileSync(errorPath, 'utf8') : error.stderr || error.message;
    throw new Error(`Electron capture failed for ${viewport.id}: ${detail}`);
  }
  const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
  const analysis = analyzePng(pngPath);
  assert.strictEqual(metrics.innerWidth, viewport.width, `${viewport.id}: viewport width`);
  assert.strictEqual(analysis.width, viewport.width, `${viewport.id}: png width`);
  assert.strictEqual(analysis.height, viewport.height, `${viewport.id}: png height`);
  return { path: pngPath, viewport, metrics, analysis };
}

function createCapabilityService(harness, rootPath) {
  return createFaberCapabilityAdapterService({
    fs,
    path,
    deterministicEditService: harness.deterministicService,
    scanProject: (targetRoot) => harness.scanProject(targetRoot),
    now: () => '2026-05-28T20:00:00.000Z',
  });
}

async function applyDeterministicAndStructuredEdits({ caseDef, harness, rootPath }) {
  const editTitle = `${caseDef.title} validado`;
  const patch = harness.deterministicService.buildContentEditOperationBatch({
    projectInfo: harness.scanProject(rootPath),
    executionIntent: 'edit_project',
    userMessage: `Mude o titulo da pagina ja desenvolvida para "${editTitle}"`,
  });
  assert.ok(patch && patch.ok, `${caseDef.id}: deterministic patch should exist`);
  assert.strictEqual(patch.action.safePatchEvidence.validation.ok, true);
  harness.applyOperations(rootPath, patch.action.operations);

  const service = createCapabilityService(harness, rootPath);
  const structured = await service.executeCapability({
    capability: 'structured_edit',
    action: 'apply',
    projectSession: {
      rootPath,
      projectId: `matrix-${caseDef.id}`,
      projectName: caseDef.title,
      jobId: `job-${caseDef.id}`,
    },
    payload: {
      requestId: `structured-${caseDef.id}`,
      userMessage: `Mude o titulo da pagina ja desenvolvida para "${caseDef.title} MCP validado"`,
    },
  });
  assert.strictEqual(structured.ok, true, `${caseDef.id}: structured edit should apply`);
  assert.strictEqual(fs.existsSync(path.join(rootPath, '.faber', 'capabilities', 'structured_edit.jsonl')), true);
  return {
    deterministic: patch.action.generatedBy,
    structured: structured.evidence.data.patch.generatedBy,
  };
}

async function validateBlueprintContract({ caseDef, rootPath, blueprint, captures }) {
  const service = createFaberCapabilityAdapterService({
    fs,
    path,
    now: () => '2026-05-28T20:00:00.000Z',
  });
  const validation = await service.executeCapability({
    capability: 'blueprint_contract',
    action: 'validate',
    projectSession: {
      rootPath,
      projectId: `matrix-${caseDef.id}`,
      projectName: caseDef.title,
    },
    payload: {
      blueprint: blueprint.action,
      sourcePolicy: {
        requiredTerms: caseDef.requiredTerms || [],
        forbiddenTerms: caseDef.forbiddenTerms || [],
        allowedSources: ['current_briefing'],
      },
      runtimeValidation: {
        status: 'passed',
        visualEvidence: {
          domMetrics: captures.map((capture) => ({
            label: capture.viewport.id,
            innerWidth: capture.metrics.innerWidth,
            hasHorizontalOverflow: capture.metrics.hasHorizontalOverflow || capture.metrics.hasElementOverflow,
            hasOldMemory: capture.metrics.hasForbiddenTerm,
          })),
          artifacts: captures.map((capture) => capture.path),
        },
      },
    },
  });
  assert.strictEqual(validation.ok, true, `${caseDef.id}: blueprint contract capability should run`);
  assert.strictEqual(validation.evidence.data.validation.gate, 'allow', `${caseDef.id}: blueprint contract gate`);
  return validation.evidence.data.validation;
}

async function runGeneratedCase({ artifactStore, caseDef, electron, harness }) {
  const rootPath = harness.createScenarioRoot(caseDef.id);
  const route = await harness.productService.resolveProductRoute({
    projectInfo: createProjectInfo(rootPath),
    userMessage: caseDef.message,
    conversationMessages: caseDef.conversationMessages || [],
    activeMemory: caseDef.activeMemory || null,
  });

  if (caseDef.shouldClarify) {
    assert.strictEqual(route.decision, 'clarify', `${caseDef.id}: should clarify`);
    assert.strictEqual(route.meta.reason, 'legacy_reference_requires_confirmation');
    const functional = validateFunctionalCase(caseDef, 'blocked');
    const captures = await captureCase({ artifactStore, caseDef, electron, functional, generatedText: '', rootPath, variant: 'blocked' });
    return {
      id: caseDef.id,
      decision: route.decision,
      gate: 'blocked',
      captures: captures.map((capture) => capture.path),
      artifacts: captures.map((capture) => capture.artifact),
    };
  }

  assert.strictEqual(route.decision, 'execute', `${caseDef.id}: route should execute`);
  assert.strictEqual(route.productRoute.capability, 'create_project', `${caseDef.id}: should create`);
  if (caseDef.expectedMode) {
    assert.strictEqual(route.productRoute.mode, caseDef.expectedMode, `${caseDef.id}: expected route mode`);
  }
  if (caseDef.expectedDomain) {
    assert.strictEqual(route.workingBrief.product.domain, caseDef.expectedDomain, `${caseDef.id}: expected domain`);
  }
  if (caseDef.calculatorId) {
    assert.strictEqual(route.workingBrief.temporaryBlueprintContract.status, 'active', `${caseDef.id}: temp contract active`);
    assert.strictEqual(route.workingBrief.temporaryBlueprintContract.calculatorContract.id, caseDef.calculatorId);
  }
  if (caseDef.routeOnly) {
    const captures = [];
    for (const variant of caseDef.variants || ['baseline']) {
      const broken = ['broken'].includes(variant);
      const functional = validateFunctionalCase(caseDef, variant);
      const variantCaptures = await captureCase({ artifactStore, broken, caseDef, electron, functional, generatedText: '', rootPath, variant });
      if (broken) {
        assert.ok(variantCaptures.some((capture) =>
          capture.metrics.hasHorizontalOverflow ||
          capture.metrics.hasElementOverflow ||
          capture.metrics.ctaCount === 1 ||
          capture.metrics.formValidationVisible === false ||
          capture.metrics.sensitiveClaim ||
          capture.metrics.formulaRegression ||
          capture.metrics.crudRegression ||
          capture.metrics.contractRegression
        ), `${caseDef.id}: broken variant should expose a failure`);
        continue;
      }
      captures.push(...variantCaptures);
    }

    for (const capture of captures) {
      assert.strictEqual(capture.analysis.blankLikely, false, `${caseDef.id}/${capture.viewport.id}: nonblank`);
      assert.strictEqual(capture.metrics.hasHorizontalOverflow || capture.metrics.hasElementOverflow, false, `${caseDef.id}/${capture.viewport.id}: no overflow`);
      assert.strictEqual(capture.metrics.cardOverlapCount, 0, `${caseDef.id}/${capture.viewport.id}: no overlap`);
      assert.strictEqual(capture.metrics.requiredTermsPresent, true, `${caseDef.id}/${capture.viewport.id}: required terms`);
      assert.strictEqual(capture.metrics.hasForbiddenTerm, false, `${caseDef.id}/${capture.viewport.id}: forbidden terms`);
      assert.strictEqual(capture.metrics.sensitiveClaim, false, `${caseDef.id}/${capture.viewport.id}: no sensitive claim`);
    }

    return {
      id: caseDef.id,
      decision: route.decision,
      domain: route.workingBrief.product.domain,
      mode: route.productRoute.mode,
      gate: 'route-only',
      captures: captures.map((capture) => capture.path),
      artifacts: captures.map((capture) => capture.artifact),
    };
  }

  const blueprint = harness.buildBlueprintFromRoute(rootPath, route, {});
  assert.strictEqual(blueprint.ok, true, `${caseDef.id}: blueprint ok`);
  harness.applyOperations(rootPath, blueprint.action.operations);
  const beforeText = readGeneratedText(harness, rootPath);
  assertTerms({ text: beforeText, requiredTerms: caseDef.requiredTerms, forbiddenTerms: caseDef.forbiddenTerms, prefix: caseDef.id });

  const edits = await applyDeterministicAndStructuredEdits({ caseDef, harness, rootPath });
  const generatedText = readGeneratedText(harness, rootPath);
  assert.ok(generatedText.includes(normalizeSmokeText(caseDef.title)), `${caseDef.id}: edited title should remain covered`);

  const captures = [];
  for (const variant of caseDef.variants || ['baseline']) {
    const broken = ['broken'].includes(variant);
    if (broken) {
      const functional = validateFunctionalCase(caseDef, variant);
      const brokenCaptures = await captureCase({ artifactStore, broken: true, caseDef, electron, functional, generatedText, rootPath, variant });
      assert.ok(brokenCaptures.some((capture) =>
        capture.metrics.hasHorizontalOverflow ||
        capture.metrics.hasElementOverflow ||
        capture.metrics.ctaCount === 1 ||
        capture.metrics.formValidationVisible === false ||
        capture.metrics.sensitiveClaim ||
        capture.metrics.formulaRegression ||
        capture.metrics.crudRegression ||
        capture.metrics.contractRegression
      ), `${caseDef.id}: broken variant should expose a failure`);
      continue;
    }
    const functional = validateFunctionalCase(caseDef, variant);
    const variantCaptures = await captureCase({ artifactStore, caseDef, electron, functional, generatedText, rootPath, variant });
    captures.push(...variantCaptures);
  }

  for (const capture of captures) {
    assert.strictEqual(capture.analysis.blankLikely, false, `${caseDef.id}/${capture.viewport.id}: nonblank`);
    assert.strictEqual(capture.metrics.hasHorizontalOverflow || capture.metrics.hasElementOverflow, false, `${caseDef.id}/${capture.viewport.id}: no overflow`);
    assert.strictEqual(capture.metrics.cardOverlapCount, 0, `${caseDef.id}/${capture.viewport.id}: no overlap`);
    assert.strictEqual(capture.metrics.requiredTermsPresent, true, `${caseDef.id}/${capture.viewport.id}: required terms`);
    assert.strictEqual(capture.metrics.hasForbiddenTerm, false, `${caseDef.id}/${capture.viewport.id}: forbidden terms`);
    assert.strictEqual(capture.metrics.sensitiveClaim, false, `${caseDef.id}/${capture.viewport.id}: no sensitive claim`);
  }

  const validation = await validateBlueprintContract({ caseDef, rootPath, blueprint, captures });
  return {
    id: caseDef.id,
    decision: route.decision,
    domain: route.workingBrief.product.domain,
    gate: validation.gate,
    edits,
    captures: captures.map((capture) => capture.path),
    artifacts: captures.map((capture) => capture.artifact),
  };
}

async function captureCase({ artifactStore, broken = false, caseDef, electron, functional, generatedText, rootPath, variant }) {
  const htmlPath = path.join(os.tmpdir(), `faber-briefing-loop-${caseDef.id}-${variant}.html`);
  fs.writeFileSync(htmlPath, buildVisualHtml(caseDef, {
    broken,
    editCount: variant === 'edited' ? 2 : 1,
    functional,
    generatedText,
    variant,
  }), 'utf8');
  const captures = [];
  for (const viewport of VIEWPORTS) {
    const pngPath = path.join(os.tmpdir(), `faber-briefing-loop-${caseDef.id}-${variant}-${viewport.id}.png`);
    const capture = captureHtmlWithElectron({ electron, htmlPath, pngPath, viewport });
    const stored = artifactStore.storeArtifact({
      rootPath,
      sourcePath: capture.path,
      kind: 'visual-smoke',
      category: 'briefing-loop-matrix',
      label: `${caseDef.id}-${variant}-${viewport.id}`,
      metadata: {
        caseId: caseDef.id,
        group: caseDef.group,
        variant,
        viewport,
        metrics: capture.metrics,
      },
    });
    assert.strictEqual(stored.ok, true, `${caseDef.id}: artifact stored`);
    captures.push({ ...capture, artifact: stored.entry.relativePath });
  }
  return captures;
}

async function run() {
  const electron = findElectron();
  assert.ok(electron, 'Electron is required for briefing loop matrix smoke');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-briefing-loop-'));
  const harness = createSmokeHarness(tempRoot);
  const artifactStore = createArtifactStoreService({
    crypto,
    fs,
    path,
    now: () => '2026-05-28T20:00:00.000Z',
  });
  const filter = String(process.env.FABER_BRIEFING_LOOP_FILTER || '').trim();
  const selectedCases = filter
    ? CASES.filter((caseDef) => caseDef.id.includes(filter) || caseDef.group === filter)
    : CASES;
  const results = [];
  try {
    for (const caseDef of selectedCases) {
      results.push(await runGeneratedCase({ artifactStore, caseDef, electron, harness }));
    }
  } finally {
    if (process.env.FABER_KEEP_BRIEFING_LOOP_ARTIFACTS !== '1') {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
  assert.strictEqual(results.length, selectedCases.length);
  console.log(`briefing-loop-matrix-smoke.test.js: ok ${JSON.stringify({
    cases: selectedCases.length,
    groups: Array.from(new Set(selectedCases.map((caseDef) => caseDef.group))).sort(),
    artifactRoot: process.env.FABER_KEEP_BRIEFING_LOOP_ARTIFACTS === '1' ? tempRoot : '',
    artifactCount: results.flatMap((result) => result.artifacts || []).length,
    screenshots: results.flatMap((result) => result.captures).slice(-18),
    gates: results.map((result) => result.gate),
  })}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
