const assert = require('assert');

const {
  buildBriefingSpec,
  inferExplicitBrand,
  inferRequestedPages,
  inferRequestedSections,
} = require('../cortex/orchestration/briefing_spec_service');

function run() {
  const architecture = buildBriefingSpec({
    userMessage: [
      'Briefing Completo — Site de Arquitetura.',
      'Nome do escritório: Helena Duarte Arquitetura.',
      'Desenvolver site completo em Next.js para uma arquiteta.',
      'Precisa ter hero com vídeo full width, sobre, serviços, projetos/cases, processo, insights, contato, depoimentos e formulário.',
      'Paleta off-white, areia, grafite e tipografia Playfair Display.',
    ].join(' '),
    contextText: 'conversa antiga sobre Clinica Sorriso, estufas agricolas e cultivo protegido',
  });
  assert.strictEqual(architecture.schemaVersion, 'briefing-spec-v1');
  assert.strictEqual(architecture.current.selfContained, true);
  assert.strictEqual(architecture.current.brand, 'Helena Duarte Arquitetura');
  assert.strictEqual(architecture.contextPolicy.staleContextSuppressed, true);
  assert.strictEqual(architecture.generationSource.includes('Clinica Sorriso'), false);
  assert.strictEqual(architecture.domain.id, 'architecture');
  assert.strictEqual(architecture.content.finalRequested, true);
  assert.strictEqual(architecture.contractEscalation.required, false);
  assert.ok(architecture.required.sectionIds.includes('hero'));
  assert.ok(architecture.required.sectionIds.includes('video'));
  assert.ok(architecture.required.sectionIds.includes('gallery'));
  assert.ok(architecture.required.pageIds.includes('/sobre'));
  assert.ok(architecture.required.pageIds.includes('/contato'));

  const importSections = inferRequestedSections([
    'Criar landing page de importação com hero, CTA, WhatsApp, serviços, processo, tipos de importação, prova social, formulário, FAQ e footer.',
  ].join(' '));
  assert.ok(importSections.some((section) => section.id === 'hero'));
  assert.ok(importSections.some((section) => section.id === 'contact'));
  assert.ok(importSections.some((section) => section.id === 'footer'));

  const pages = inferRequestedPages('Site completo com Página Sobre, Página Serviços, Página Blog / Insights e Página Contato.');
  assert.ok(pages.some((page) => page.id === '/sobre'));
  assert.ok(pages.some((page) => page.id === '/servicos'));
  assert.ok(pages.some((page) => page.id === '/insights'));
  assert.ok(pages.some((page) => page.id === '/contato'));

  const unsupportedFinal = buildBriefingSpec({
    userMessage: [
      'Briefing Completo — Site de Escola de Musica Experimental.',
      'Criar site completo com hero, aulas, professores, agenda de apresentações, loja, blog, galeria, depoimentos, contato e formulário.',
      'Use o conteúdo final do briefing, sem placeholder, com identidade visual roxa, dourada e tipografia editorial.',
    ].join(' '),
    contextText: 'Memoria antiga: criar site de jardinagem com Jardim Vivo.',
  });
  assert.strictEqual(unsupportedFinal.current.selfContained, true);
  assert.strictEqual(unsupportedFinal.contextPolicy.staleContextSuppressed, true);
  assert.strictEqual(unsupportedFinal.domain.id, '');
  assert.strictEqual(unsupportedFinal.contractEscalation.required, false);
  assert.strictEqual(unsupportedFinal.contractEscalation.code, 'temporary_blueprint_contract_synthesized');
  assert.strictEqual(unsupportedFinal.temporaryBlueprintContract.status, 'active');
  assert.strictEqual(unsupportedFinal.temporaryBlueprintContract.source, 'current_briefing');
  assert.strictEqual(unsupportedFinal.temporaryBlueprintContract.memoryPolicy.staleContextAllowed, false);
  assert.ok(unsupportedFinal.temporaryBlueprintContract.requiredSections.some((section) => section.id === 'team'));
  assert.ok(unsupportedFinal.temporaryBlueprintContract.requiredSections.some((section) => section.id === 'events'));
  assert.ok(unsupportedFinal.temporaryBlueprintContract.requiredPages.some((page) => page.id === '/professores'));
  assert.ok(unsupportedFinal.temporaryBlueprintContract.requiredPages.some((page) => page.id === '/agenda'));

  const forgeMrp = buildBriefingSpec({
    userMessage: [
      'Briefing completo: crie uma ferramenta operacional Forge MRP em Next.js para manufatura discreta.',
      'Deve ter cadastro de itens, BOM multinível, estoque auditável, ordens de produção, cálculo determinístico de necessidades e audit log.',
    ].join(' '),
  });
  assert.strictEqual(forgeMrp.temporaryBlueprintContract.status, 'active');
  assert.strictEqual(forgeMrp.temporaryBlueprintContract.domain, 'temporary-forge-mrp');
  assert.strictEqual(forgeMrp.temporaryBlueprintContract.label, 'Forge MRP');

  const fitCalc = buildBriefingSpec({
    userMessage: [
      'Crie uma ferramenta simples em Next.js chamada FitCalc IMC.',
      'Precisa ser uma calculadora de IMC com peso, altura, resultado, classificacao, historico local, CTA para calcular agora e conteudo final sem placeholder.',
    ].join(' '),
  });
  assert.strictEqual(fitCalc.temporaryBlueprintContract.domain, 'temporary-fitcalc-imc');
  assert.strictEqual(fitCalc.temporaryBlueprintContract.label, 'fitcalc imc');
  assert.strictEqual(fitCalc.temporaryBlueprintContract.calculatorContract.id, 'imc');

  const visualEditor = buildBriefingSpec({
    userMessage: 'Crie um editor visual simples para montar layouts com canvas, camadas, inspetor de propriedades e exportação JSON.',
  });
  assert.strictEqual(visualEditor.temporaryBlueprintContract.domain, 'temporary-editor-visual-de-layout');
  assert.strictEqual(visualEditor.temporaryBlueprintContract.label, 'editor visual de layout');

  const dataExplorer = buildBriefingSpec({
    userMessage: 'Crie um app de dados para explorar um CSV de vendas com tabela, filtros, busca textual, métricas agregadas e gráfico simples.',
  });
  assert.strictEqual(dataExplorer.temporaryBlueprintContract.domain, 'temporary-explorador-de-dados-csv');
  assert.strictEqual(dataExplorer.temporaryBlueprintContract.label, 'explorador de dados CSV');

  const tremnInstitutional = buildBriefingSpec({
    userMessage: [
      'Recrie do zero este projeto como SITE INSTITUCIONAL MULTIPÁGINA estático para Tremn — Escola de Gestão Consciente.',
      'Fonte de verdade: use somente esta mensagem atual. Suprima memória ativa, contexto antigo e briefing desta conversa.',
      'Não reaproveite Clínica Sorriso, dashboard, SaaS, pipeline, demo ou controle de processos.',
      'Não é SaaS, não é dashboard, não é app interno, não é ferramenta e não é landing page única.',
      'Páginas reais obrigatórias: index.html, a-escola.html, premissas.html, jornada.html, conteudos.html, contato.html.',
      'Visual claro com bloco escuro pontual para frase de impacto e rodapé inferior global.',
      'Tipografia Assistant e Inter, paleta Pantone P 1-1 C, P 20-2 C, P 179-16 C, P 10-7 C e P 14-16 C.',
    ].join('\n'),
    contextText: 'tentativa antiga: SaaS operacional, dashboard executivo, Pipeline de trabalho e Agendar demo.',
  });
  assert.strictEqual(tremnInstitutional.current.selfContained, true);
  assert.strictEqual(tremnInstitutional.contractEscalation.required, false);
  assert.strictEqual(tremnInstitutional.temporaryBlueprintContract.status, 'active');
  assert.strictEqual(tremnInstitutional.temporaryBlueprintContract.domain, 'temporary-tremn-escola-de-gestao-consciente');
  assert.ok(tremnInstitutional.required.pageIds.includes('/'));
  assert.ok(tremnInstitutional.required.pageIds.includes('/a-escola'));
  assert.ok(tremnInstitutional.required.pageIds.includes('/premissas'));
  assert.ok(tremnInstitutional.required.pageIds.includes('/jornada'));
  assert.ok(tremnInstitutional.required.pageIds.includes('/conteudos'));
  assert.ok(tremnInstitutional.required.pageIds.includes('/contato'));
  assert.strictEqual(tremnInstitutional.generationSource.includes('dashboard executivo'), false);

  const conflict = buildBriefingSpec({
    userMessage: 'Briefing completo: criar site final para chocolate artesanal premium e bolsas de couro, sem placeholder.',
  });
  assert.strictEqual(conflict.contractEscalation.required, false);
  assert.strictEqual(conflict.contractEscalation.advisory, true);
  assert.strictEqual(conflict.contractEscalation.code, 'current_briefing_domain_conflict');
  assert.strictEqual(conflict.contractEscalation.suggestedContract.type, 'suggest_blueprint');
  assert.strictEqual(conflict.contractEscalation.suggestedContract.status, 'advisory');

  const continuation = buildBriefingSpec({
    userMessage: 'Segue com o briefing completo que passei',
    contextText: 'Briefing anterior: criar landing page de chocolate artesanal premium com cacau, bombons e contato.',
  });
  assert.strictEqual(continuation.contextPolicy.memoryAllowedForContent, true);
  assert.ok(continuation.generationSource.includes('chocolate artesanal'));

  const aureaIp = buildBriefingSpec({
    userMessage: [
      'Briefing — Landing Page Institucional',
      'Escritório de Patentes: Aurea IP & Patentes',
      'Criar landing page sofisticada, confiável e internacional para registro de patentes, marcas, desenhos industriais, modelos de utilidade, busca de anterioridade, INPI e proteção internacional.',
      'A estrutura deve incluir hero com vídeo full width, apresentação, especialista, serviços, atuação global, processo, diferenciais, chamada final, contato e footer.',
    ].join('\n'),
    contextText: 'Memória antiga: Studio Habitat, Helena Duarte Arquitetura e arquitetura contemporânea para espaços com identidade.',
    activeMemory: {
      current: { continuationIntent: true },
      decision: {
        briefingContextText: 'Memória ativa antiga: Studio Habitat e Helena Duarte Arquitetura.',
      },
    },
  });
  assert.strictEqual(aureaIp.current.selfContained, true);
  assert.strictEqual(aureaIp.current.continuation, false);
  assert.strictEqual(aureaIp.current.brand, 'Aurea IP & Patentes');
  assert.strictEqual(aureaIp.contextPolicy.memoryAllowedForContent, false);
  assert.strictEqual(aureaIp.contextPolicy.staleContextSuppressed, true);
  assert.strictEqual(aureaIp.generationSource.includes('Studio Habitat'), false);
  assert.strictEqual(aureaIp.domain.id, 'intellectual-property');

  const lineaBosco = buildBriefingSpec({
    userMessage: [
      'Briefing — Site Completo',
      'Empresa: Linea Bosco Revestimentos',
      'Criar site completo elegante para pisos de madeira, painéis ripados, decks, revestimentos naturais, acabamentos arquitetônicos, projetos, inspirações e orçamento.',
      'O site deve ter Home, Sobre, Produtos, Pisos de Madeira, Painéis Ripados, Decks, Projetos, Inspirações, Contato, orçamento, galeria e footer global.',
    ].join('\n'),
    contextText: 'Memória antiga: Studio Habitat, Helena Duarte Arquitetura e arquitetura contemporânea.',
    activeMemory: {
      current: { continuationIntent: true },
      decision: {
        briefingContextText: 'Memória ativa antiga: Studio Habitat e Helena Duarte Arquitetura.',
      },
    },
  });
  assert.strictEqual(lineaBosco.current.selfContained, true);
  assert.strictEqual(lineaBosco.current.continuation, false);
  assert.strictEqual(lineaBosco.current.brand, 'Linea Bosco Revestimentos');
  assert.strictEqual(lineaBosco.contextPolicy.memoryAllowedForContent, false);
  assert.strictEqual(lineaBosco.generationSource.includes('Helena Duarte'), false);
  assert.strictEqual(lineaBosco.domain.id, 'wood-finishes');
  assert.ok(lineaBosco.required.pageIds.includes('/produtos'));
  assert.ok(lineaBosco.required.pageIds.includes('/pisos'));
  assert.ok(lineaBosco.required.pageIds.includes('/paineis'));
  assert.ok(lineaBosco.required.pageIds.includes('/decks'));
  assert.ok(lineaBosco.required.pageIds.includes('/projetos'));
  assert.ok(lineaBosco.required.pageIds.includes('/inspiracoes'));

  assert.strictEqual(inferExplicitBrand('Nome da marca: Jardim Claro.'), 'Jardim Claro');
  assert.strictEqual(
    inferExplicitBrand('Escritório de Patentes: Aurea IP & Patentes Criar landing page sofisticada'),
    'Aurea IP & Patentes'
  );
  assert.strictEqual(
    inferExplicitBrand('Empresa: Linea Bosco Revestimentos Conceito do projeto criar site completo'),
    'Linea Bosco Revestimentos'
  );
  assert.strictEqual(
    inferExplicitBrand('Nome do produto:\nNexaFlow Desk\nCriar landing SaaS operacional'),
    'NexaFlow Desk'
  );
  assert.strictEqual(
    inferExplicitBrand('Criar landing page em Next.js para NexaFlow Desk, SaaS operacional para equipes.'),
    'NexaFlow Desk'
  );
  assert.strictEqual(
    inferExplicitBrand('Criar landing page em Next.js para VitraPure, garrafas de vidro sustentaveis.'),
    'VitraPure'
  );
  assert.strictEqual(
    inferExplicitBrand('Criar site em Next.js para Alumivance Esquadrias e Fachadas, esquadrias de aluminio.'),
    'Alumivance Esquadrias e Fachadas'
  );
  assert.strictEqual(
    inferExplicitBrand('Criar landing page em Next.js para Aurora di Vento, vinhos artesanais premium.'),
    'Aurora di Vento'
  );
  assert.strictEqual(
    inferExplicitBrand('Criar portal editorial em Next.js para VoxLumen Revista com editorias e newsletter.'),
    'VoxLumen Revista'
  );
  assert.strictEqual(
    inferExplicitBrand('Nome do projeto:\nVoxLumen Revista\nCriar hub editorial'),
    'VoxLumen Revista'
  );

  console.log('briefing-spec-service.test.js: ok');
}

run();
