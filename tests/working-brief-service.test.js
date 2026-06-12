const assert = require('assert');

const { buildWorkingBrief } = require('../cortex/orchestration/working_brief_service');

function createProjectInfo(overrides = {}) {
  return {
    rootPath: '/tmp/faber-working-brief',
    files: [],
    totalFiles: 0,
    ...overrides,
  };
}

function run() {
  const legal = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Quero criar um site em next.js, com react e tailwind.',
      'O site é para um advogado, quero ele com cor azul e branco.',
      'Use uma tipografia do Google e placeholders.',
    ].join(' '),
  });

  assert.strictEqual(legal.schemaVersion, 'working-brief-v1');
  assert.strictEqual(legal.intent.action, 'create_project');
  assert.strictEqual(legal.product.domain, 'legal');
  assert.strictEqual(legal.product.stack, 'next-tailwind');
  assert.strictEqual(legal.style.palette.primary, '#3240a8');
  assert.strictEqual(legal.style.palette.background, '#ffffff');
  assert.strictEqual(legal.style.typography.provider, 'google');
  assert.strictEqual(legal.mediaIntent[0].provider, 'pexels');
  assert.strictEqual(legal.mediaIntent[0].orientation, 'landscape');
  assert.strictEqual(legal.mediaIntent[0].color, '#3240a8');
  assert.ok(legal.mediaIntent[0].query.includes('law office'));
  assert.ok(legal.iconIntent.some((icon) => icon.semanticName === 'scale'));

  const metadataOnlyNextCreate = buildWorkingBrief({
    projectInfo: createProjectInfo({
      files: ['.faber/project.json'],
      totalFiles: 1,
    }),
    userMessage: 'Oi, gera um site pra mim em next.js, com múltiplas páginas e no topo do body um hero com video no fundo',
  });
  assert.strictEqual(metadataOnlyNextCreate.project.state, 'metadata_only_project');
  assert.strictEqual(metadataOnlyNextCreate.project.hasApplicationFiles, false);
  assert.strictEqual(metadataOnlyNextCreate.intent.action, 'create_project');
  assert.strictEqual(metadataOnlyNextCreate.product.stack, 'next');

  const existingHeroEdit = buildWorkingBrief({
    projectInfo: createProjectInfo({
      files: ['index.html', 'style.css', 'script.js'],
      totalFiles: 3,
    }),
    userMessage: 'Precisamos ajustar o hero do topo do body, colocar um vídeo de abelhas voando e mudar o blend da camada branca',
    conversationMessages: [
      {
        role: 'user',
        text: 'Recrie do zero este projeto como site institucional multipágina em HTML, CSS e JavaScript.',
      },
    ],
  });
  assert.strictEqual(existingHeroEdit.intent.action, 'edit_project');
  assert.strictEqual(existingHeroEdit.intent.intake.executionIntent, 'edit_project');
  assert.strictEqual(existingHeroEdit.source.consolidated.includes('Recrie do zero'), false);

  const leatherGoods = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Quero uma landing page em next.js para uma empresa que vende artefatos de couro, como bolsas e pastas.',
      'A marca usa vermelho marsala e um offwhite quase amarelo alaranjado.',
      'O visual deve parecer europeu, artesanal e falar sobre qualidade e longevidade do couro.',
    ].join(' '),
  });
  assert.strictEqual(leatherGoods.intent.action, 'create_project');
  assert.strictEqual(leatherGoods.product.domain, 'leather-goods');
  assert.strictEqual(leatherGoods.product.domainLabel, 'artefatos de couro');
  assert.strictEqual(leatherGoods.product.brandFallback, 'Atelier Couro Faber');
  assert.strictEqual(leatherGoods.style.palette.primary, '#8f3447');
  assert.strictEqual(leatherGoods.style.palette.background, '#fcf7e3');
  assert.ok(leatherGoods.mediaIntent[0].query.includes('leather bags'));
  assert.ok(leatherGoods.iconIntent.some((icon) => icon.semanticName === 'briefcase'));

  const greenhouses = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Criar landing page em Next.js para estufas agrícolas, viveiros e cultivo protegido.',
      'Quero hero video full width, verde profundo, off-white, formulário de orçamento e WhatsApp.',
    ].join(' '),
  });
  assert.strictEqual(greenhouses.intent.action, 'create_project');
  assert.strictEqual(greenhouses.product.domain, 'greenhouses');
  assert.strictEqual(greenhouses.product.domainLabel, 'estufas agrícolas');
  assert.strictEqual(greenhouses.product.brandFallback, 'Estufas Protegidas');
  assert.strictEqual(greenhouses.style.palette.primary, '#1f5a3d');
  assert.strictEqual(greenhouses.style.palette.background, '#fcf7e3');
  assert.strictEqual(greenhouses.mediaIntent[0].mediaType, 'video');
  assert.ok(greenhouses.mediaIntent[0].query.includes('greenhouse farming'));
  assert.ok(greenhouses.iconIntent.some((icon) => icon.semanticName === 'leaf'));
  assert.ok(greenhouses.iconIntent.some((icon) => icon.semanticName === 'droplet'));

  const importServices = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Criar landing page de importação para consultoria em importação de produtos.',
      'Precisa falar de comércio exterior, cotação internacional, fornecedores, documentação, logística internacional, desembaraço aduaneiro, WhatsApp e formulário de cotação.',
    ].join(' '),
  });
  assert.strictEqual(importServices.intent.action, 'create_project');
  assert.strictEqual(importServices.product.domain, 'import-services');
  assert.strictEqual(importServices.product.domainLabel, 'importação');
  assert.strictEqual(importServices.product.brandFallback, 'ImportaPro Consultoria');
  assert.strictEqual(importServices.style.palette.primary, '#0b1f3a');
  assert.ok(importServices.mediaIntent[0].query.includes('shipping containers'));
  assert.ok(importServices.iconIntent.some((icon) => icon.semanticName === 'globe-alt'));

  const gardening = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Crie um site completo de jardinagem com serviços de paisagismo, loja de produtos, blog educativo, galeria e contato.',
      'A comunicação deve ser acolhedora, natural e profissional, com plantas, jardins, vasos, substratos e manutenção.',
    ].join(' '),
    contextText: 'conversa antiga sobre estufas agrícolas e cultivo protegido',
  });
  assert.strictEqual(gardening.intent.action, 'create_project');
  assert.strictEqual(gardening.product.domain, 'gardening');
  assert.strictEqual(gardening.product.domainLabel, 'jardinagem');
  assert.strictEqual(gardening.product.brandFallback, 'Jardim Vivo');
  assert.ok(gardening.mediaIntent[0].query.includes('home garden'));
  assert.ok(gardening.iconIntent.some((icon) => icon.semanticName === 'leaf'));

  const woodSculpture = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Crie um site de escultura em madeira para um artista e ateliê.',
      'Quero hero no topo com vídeo full width no fundo, portfólio, processo artesanal, talha manual, obras sob encomenda e contato.',
      'O público inclui colecionadores, arquitetos e designers de interiores.',
    ].join(' '),
    contextText: 'conversa antiga sobre clínica dental e arquitetura residencial',
  });
  assert.strictEqual(woodSculpture.intent.action, 'create_project');
  assert.strictEqual(woodSculpture.product.domain, 'wood-sculpture');
  assert.strictEqual(woodSculpture.product.domainLabel, 'escultura em madeira');
  assert.strictEqual(woodSculpture.product.brandFallback, 'Ateliê Madeira Viva');
  assert.strictEqual(woodSculpture.mediaIntent[0].mediaType, 'video');
  assert.ok(woodSculpture.mediaIntent[0].query.includes('wood carving'));

  const aureaIp = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing — Landing Page Institucional',
      'Escritório de Patentes: Aurea IP & Patentes',
      'Criar landing page sofisticada para registro de patentes, marcas, desenhos industriais, modelos de utilidade, busca de anterioridade, INPI e proteção internacional.',
      'Precisa ter hero com vídeo full width, serviços, especialista, atuação global, processo, diferenciais, contato e footer.',
    ].join('\n'),
    contextText: 'smoke anterior sobre Studio Habitat e Helena Duarte Arquitetura',
    activeMemory: {
      schemaVersion: 'active-memory-v1',
      current: { continuationIntent: true },
      decision: {
        briefingContextText: 'Memória antiga: Studio Habitat, Helena Duarte Arquitetura e arquitetura contemporânea.',
      },
    },
  });
  assert.strictEqual(aureaIp.intent.action, 'create_project');
  assert.strictEqual(aureaIp.product.domain, 'intellectual-property');
  assert.strictEqual(aureaIp.product.domainLabel, 'propriedade intelectual');
  assert.strictEqual(aureaIp.product.brandFallback, 'Aurea IP & Patentes');
  assert.strictEqual(aureaIp.source.memoryContextSuppressed, true);
  assert.strictEqual(aureaIp.source.consolidated.includes('Studio Habitat'), false);
  assert.ok(aureaIp.mediaIntent[0].query.includes('patent law'));
  assert.ok(aureaIp.iconIntent.some((icon) => icon.semanticName === 'shield-check'));

  const lineaBosco = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing — Site Completo',
      'Empresa: Linea Bosco Revestimentos',
      'Criar site completo elegante para pisos de madeira, painéis ripados, decks, revestimentos naturais, acabamentos arquitetônicos, projetos, inspirações e orçamento.',
      'A experiência visual deve valorizar madeira natural, paginações, carvalho, nogueira, cumaru, freijó, tauari e ipê.',
    ].join('\n'),
    contextText: 'smoke anterior sobre Studio Habitat e Helena Duarte Arquitetura',
    activeMemory: {
      schemaVersion: 'active-memory-v1',
      current: { continuationIntent: true },
      decision: {
        briefingContextText: 'Memória antiga: Studio Habitat, Helena Duarte Arquitetura e arquitetura contemporânea.',
      },
    },
  });
  assert.strictEqual(lineaBosco.intent.action, 'create_project');
  assert.strictEqual(lineaBosco.product.domain, 'wood-finishes');
  assert.strictEqual(lineaBosco.product.domainLabel, 'revestimentos de madeira');
  assert.strictEqual(lineaBosco.product.brandFallback, 'Linea Bosco Revestimentos');
  assert.strictEqual(lineaBosco.source.memoryContextSuppressed, true);
  assert.strictEqual(lineaBosco.source.consolidated.includes('Helena Duarte'), false);
  assert.ok(lineaBosco.mediaIntent[0].query.includes('wood flooring'));
  assert.ok(lineaBosco.iconIntent.some((icon) => icon.semanticName === 'layers'));

  const wineLanding = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing completo — Landing Page de Vinhos',
      'Nome da marca',
      'Vinícola de Teste',
      'Criar landing page para vinhos artesanais premium, vinícola boutique, kit degustação, rótulos, terroir, uvas selecionadas, colheita manual, barricas, harmonização e oferta especial.',
    ].join('\n'),
    contextText: 'smoke antigo sobre pisos de madeira, carvalho, nogueira e decks',
  });
  assert.strictEqual(wineLanding.intent.action, 'create_project');
  assert.strictEqual(wineLanding.product.domain, 'premium-wine-landing');
  assert.strictEqual(wineLanding.product.domainLabel, 'vinhos premium e experiência sensorial');
  assert.strictEqual(wineLanding.product.brandFallback, 'Vinícola de Teste');
  assert.notStrictEqual(wineLanding.product.domain, 'wood-finishes');
  assert.ok(wineLanding.mediaIntent[0].query.includes('wine bottle'));
  assert.ok(wineLanding.iconIntent.some((icon) => icon.semanticName === 'sparkles'));

  const constructionMaterials = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Faça um site completo com múltiplas páginas do tema materiais de construção.',
      'Quero sobre da empresa, produtos, serviços, orçamento, contato, cimento, areia, brita, argamassa, tijolos, telhas, hidráulica, elétrica, ferramentas, tintas, entrega programada e lista de materiais.',
    ].join(' '),
    contextText: 'smoke antigo sobre vinhos, terroir, garrafas de vidro e esquadrias de alumínio',
  });
  assert.strictEqual(constructionMaterials.intent.action, 'create_project');
  assert.strictEqual(constructionMaterials.product.domain, 'construction-materials-site');
  assert.strictEqual(constructionMaterials.product.domainLabel, 'loja de materiais de construção multipágina');
  assert.strictEqual(constructionMaterials.product.brandFallback, 'Loja de Materiais de Construção');
  assert.notStrictEqual(constructionMaterials.product.domain, 'technical-b2b-services-site');
  assert.ok(constructionMaterials.mediaIntent[0].query.includes('construction materials store'));
  assert.ok(constructionMaterials.iconIntent.some((icon) => icon.semanticName === 'document-text'));

  const architecture = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Criar site completo para Helena Duarte Arquitetura.',
      'Precisa de hero com vídeo full width, serviços de arquitetura, projetos, cases, processo, insights, depoimentos e contato.',
      'Paleta off-white, areia, grafite e tipografia Playfair Display.',
    ].join(' '),
  });
  assert.strictEqual(architecture.intent.action, 'create_project');
  assert.strictEqual(architecture.product.domain, 'architecture');
  assert.strictEqual(architecture.product.domainLabel, 'arquitetura');
  assert.strictEqual(architecture.product.brandFallback, 'Helena Duarte Arquitetura');
  assert.strictEqual(architecture.intent.contentMode, 'user_final');
  assert.strictEqual(architecture.source.memoryContextSuppressed, true);
  assert.strictEqual(architecture.source.consolidated.includes('escultura em madeira'), false);
  assert.strictEqual(architecture.contractEscalation.required, false);
  assert.strictEqual(architecture.style.palette.primary, '#2f2f2d');
  assert.ok(architecture.mediaIntent[0].query.includes('architecture'));
  assert.ok(architecture.iconIntent.some((icon) => icon.semanticName === 'building'));

  const photoLab = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing completo — Site para Laboratório Fotográfico',
      'Nome fictício do negócio',
      'Lumen Lab Fotográfico',
      'Criar site cinematográfico para laboratório fotográfico especializado em revelação de filmes, digitalização profissional, impressão fine art, restauração fotográfica, ampliações, negativos e atendimento para fotógrafos.',
      'Usar fundo escuro elegante, âmbar, hero full width com vídeo, serviços, portfólio, processo, orçamento, depoimentos e contato.',
    ].join('\n'),
    contextText: 'smoke antigo sobre escultura em madeira para artista e galeria',
  });
  assert.strictEqual(photoLab.intent.action, 'create_project');
  assert.strictEqual(photoLab.product.domain, 'photo-lab');
  assert.strictEqual(photoLab.product.domainLabel, 'laboratório fotográfico');
  assert.strictEqual(photoLab.product.brandFallback, 'Lumen Lab Fotográfico');
  assert.strictEqual(photoLab.source.memoryContextSuppressed, true);
  assert.strictEqual(photoLab.contractEscalation.required, false);
  assert.strictEqual(photoLab.style.palette.primary, '#c98b3c');
  assert.strictEqual(photoLab.style.palette.background, '#111111');
  assert.strictEqual(photoLab.style.palette.surface, '#1c1c1c');
  assert.strictEqual(photoLab.mediaIntent[0].mediaType, 'video');
  assert.ok(photoLab.mediaIntent[0].query.includes('darkroom'));
  assert.ok(photoLab.iconIntent.some((icon) => icon.semanticName === 'camera'));

  const chocolate = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Quero criar um site em Next.js com React e Tailwind.',
      'Tema: chocolate artesanal, premium e sensorial, com cacau, bombons e processo do grão ao tablete.',
      'Paleta: marrom chocolate #3B1F14, cacau escuro #1E0F0A, creme #F7E7CE, dourado suave #C89B5A e branco quente #FFF8F0.',
      'Tipografia: Playfair Display nos títulos e Inter nos textos.',
    ].join(' '),
    contextText: 'conversa antiga sobre bolsas, pastas e artefatos de couro artesanal',
  });
  assert.strictEqual(chocolate.intent.action, 'create_project');
  assert.strictEqual(chocolate.product.domain, 'chocolate');
  assert.strictEqual(chocolate.product.domainLabel, 'chocolate artesanal');
  assert.strictEqual(chocolate.product.brandFallback, 'Maison Cacao');
  assert.strictEqual(chocolate.style.palette.primary, '#3b1f14');
  assert.strictEqual(chocolate.style.palette.background, '#f7e7ce');
  assert.ok(chocolate.mediaIntent[0].query.includes('artisan chocolate'));
  assert.ok(chocolate.iconIntent.some((icon) => icon.semanticName === 'gift'));

  const conflictingDomain = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'Criar landing em Next.js para chocolate artesanal e bolsas de couro premium.',
  });
  assert.strictEqual(conflictingDomain.intent.action, 'create_project');
  assert.strictEqual(conflictingDomain.product.domain, '');
  assert.strictEqual(conflictingDomain.product.brandFallback, 'Faber Projeto');
  assert.ok(conflictingDomain.intent.missingSlots.includes('domain_or_allow_default'));
  assert.strictEqual(conflictingDomain.intent.missingSlots.includes('blueprint_contract_required'), false);
  assert.strictEqual(conflictingDomain.contractEscalation.required, false);
  assert.strictEqual(conflictingDomain.contractEscalation.advisory, true);

  const unsupportedFinal = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing Completo — Site de Escola de Musica Experimental.',
      'Criar site completo com hero, professores, agenda, blog, galeria, depoimentos, contato e formulario.',
      'Use conteudo final, sem placeholder, com identidade visual editorial.',
    ].join(' '),
    contextText: 'conversa antiga sobre Jardim Vivo e jardinagem',
  });
  assert.strictEqual(unsupportedFinal.intent.action, 'create_project');
  assert.ok(unsupportedFinal.product.domain.startsWith('temporary-'));
  assert.strictEqual(unsupportedFinal.product.domainLabel, 'escola de musica experimental');
  assert.strictEqual(unsupportedFinal.source.memoryContextSuppressed, true);
  assert.strictEqual(unsupportedFinal.source.consolidated.includes('Jardim Vivo'), false);
  assert.strictEqual(unsupportedFinal.contractEscalation.required, false);
  assert.strictEqual(unsupportedFinal.contractEscalation.code, 'temporary_blueprint_contract_synthesized');
  assert.strictEqual(unsupportedFinal.temporaryBlueprintContract.status, 'active');
  assert.strictEqual(unsupportedFinal.temporaryBlueprintContract.memoryPolicy.staleContextAllowed, false);
  assert.ok(unsupportedFinal.temporaryBlueprintContract.requiredPages.some((page) => page.id === '/professores'));
  assert.ok(unsupportedFinal.temporaryBlueprintContract.requiredPages.some((page) => page.id === '/agenda'));
  assert.ok(unsupportedFinal.mediaIntent[0].query.includes('music school'));
  assert.ok(unsupportedFinal.iconIntent.some((icon) => icon.semanticName === 'calendar-check'));

  const tremnBriefing = [
    'Criar um novo projeto web estático institucional para Tremn — Escola de Gestão Consciente.',
    'Importante: este projeto não é SaaS, não é dashboard, não é CRM, não é landing page de software, não é consultoria genérica e não deve usar conteúdo de projetos anteriores.',
    'O visitante deve entender o que é a Escola, por que ela existe, para quem ela é, quais são suas premissas, como funciona a jornada e como entrar em contato.',
    'Páginas obrigatórias: Início, A Escola, Premissas, Jornada, Conteúdos e Contato.',
    'Home: hero com título "Uma nova consciência para uma nova forma de gerir.", botões Conheça a Escola e Ver premissas, As 5 premissas e chamada final.',
    'Premissas: Ir além da mera existência; Crenças e conhecimentos são degraus; A verdadeira transformação é interna; Responsabilidade é consciência em ação; Novos níveis de consciência criam novas soluções.',
    'Jornada: Perceber, Questionar, Interiorizar, Responsabilizar-se, Transformar.',
    'Conteúdos: artigos/reflexões sobre liderança consciente, autoconhecimento, sustentabilidade, cultura organizacional, futuro do trabalho, tecnologia e humanidade.',
    'Cores obrigatórias e únicas: Pantone P 14-16 C, P 10-7 C, Pantone P 20-2 C, Pantone P 179-16 C e Pantone P 1-1 C.',
    'Tipografias obrigatórias: Assistant para títulos e Inter para textos.',
    'Não usar Dashboard executivo, Pipeline de trabalho, Automação de rotinas, Serviços, Depoimentos ou Agendar demo.',
  ].join(' ');
  const tremn = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: tremnBriefing,
    contextText: 'tentativa antiga: SaaS operacional para equipes, Dashboard executivo, Pipeline de trabalho e Agendar demo.',
  });
  assert.strictEqual(tremn.intent.action, 'create_project');
  assert.strictEqual(tremn.intent.autonomy, 'low');
  assert.strictEqual(tremn.intent.contentMode, 'user_final');
  assert.strictEqual(tremn.product.domain, 'temporary-tremn-escola-de-gestao-consciente');
  assert.strictEqual(tremn.product.domainLabel, 'Tremn — Escola de Gestão Consciente');
  assert.strictEqual(tremn.product.brandFallback, 'Tremn — Escola de Gestão Consciente');
  assert.strictEqual(tremn.product.stack, 'static-web');
  assert.strictEqual(tremn.source.memoryContextSuppressed, true);
  assert.strictEqual(tremn.source.consolidated.includes('SaaS operacional'), false);
  assert.strictEqual(tremn.style.palette.primary, '#f0be43');
  assert.strictEqual(tremn.style.palette.background, '#f8f7f2');
  assert.strictEqual(tremn.style.palette.surface, '#f1cc98');
  assert.strictEqual(tremn.style.palette.text, '#2d2a29');
  assert.strictEqual(tremn.style.typography.family, 'Inter');
  assert.strictEqual(tremn.style.typography.headingFamily, 'Assistant');
  assert.deepStrictEqual(tremn.temporaryBlueprintContract.requiredPages.map((page) => page.id), [
    '/',
    '/a-escola',
    '/premissas',
    '/jornada',
    '/conteudos',
    '/contato',
  ]);
  assert.strictEqual(tremn.temporaryBlueprintContract.label.includes('Dashboard'), false);
  assert.strictEqual(tremn.temporaryBlueprintContract.label.includes('chamada final'), false);
  assert.strictEqual(tremn.temporaryBlueprintContract.domain.includes('final'), false);

  const autonomous = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'faz qualquer coisa ai, pode sugerir tudo e usar placeholders',
  });

  assert.strictEqual(autonomous.intent.action, 'create_project');
  assert.strictEqual(autonomous.intent.autonomy, 'high');
  assert.strictEqual(autonomous.intent.askBeforePlanning, false);
  assert.strictEqual(autonomous.intent.contentMode, 'ai_placeholder');
  assert.strictEqual(autonomous.product.domain, 'general-institutional-site');
  assert.strictEqual(autonomous.product.domainLabel, 'site institucional genérico');
  assert.strictEqual(autonomous.product.stack, 'next-tailwind');
  assert.strictEqual(autonomous.product.defaultedDomain, true);
  assert.ok(autonomous.executionPrompt.includes('site institucional genérico'));
  assert.ok(autonomous.executionPrompt.includes('Stack sugerida: next-tailwind.'));
  assert.ok(autonomous.mediaIntent[0].query.includes('institutional website'));

  const existingProject = buildWorkingBrief({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      totalFiles: 3,
    }),
    userMessage: 'troque a cor principal para azul',
  });

  assert.strictEqual(existingProject.project.state, 'existing_project');
  assert.strictEqual(existingProject.intent.action, 'edit_project');
  assert.strictEqual(existingProject.intent.scope, 'existing_project');

  const activeMemoryContinuation = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'Segue com o contexto combinado',
    activeMemory: {
      schemaVersion: 'active-memory-v1',
      current: { continuationIntent: true },
      user: { available: true, selectedCount: 1 },
      project: { available: true, selectedCount: 1, projectFilesText: '' },
      decision: {
        briefingContextText:
          'Memoria ativa separada por fonte.\nMemoria de projeto/Cortex:\n- Criar landing em Next.js para chocolate artesanal premium com paleta creme e cacau.',
      },
    },
  });
  assert.strictEqual(activeMemoryContinuation.intent.action, 'create_project');
  assert.strictEqual(activeMemoryContinuation.product.domain, 'chocolate');
  assert.strictEqual(activeMemoryContinuation.memory.continuationIntent, true);
  assert.ok(activeMemoryContinuation.assumptions.some((entry) => entry.includes('memoria/contexto')));

  console.log('working-brief-service.test.js: ok');
}

run();
