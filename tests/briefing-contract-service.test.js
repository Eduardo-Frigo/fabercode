const assert = require('assert');

const {
  evaluateBriefingAdherence,
  formatBriefingContractForPrompt,
  inferBriefingContract,
} = require('../cortex/orchestration/briefing_contract_service');

function run() {
  const directLegal = inferBriefingContract({
    userMessage: 'Criar site em Next.js, React e Tailwind para um advogado trabalhista',
    contextText: 'conversa antiga sobre dentista e Clínica Sorriso',
  });
  assert.strictEqual(directLegal.domain, 'legal');
  assert.strictEqual(directLegal.contextualDomain, 'dental');
  assert.strictEqual(directLegal.domainDecision.source, 'current_user_message');
  assert.strictEqual(directLegal.domainDecision.status, 'accepted');
  assert.strictEqual(directLegal.domainDecision.sourceConflict.hasConflict, true);
  assert.strictEqual(directLegal.domainDecision.directScores[0].status, 'accepted');
  assert.strictEqual(directLegal.domainDecision.directScores[0].hasStrongPositiveSignals, true);
  assert.strictEqual(directLegal.stack, 'next-tailwind');
  assert.strictEqual(directLegal.brandFallback, 'Escritório Faber Advocacia');

  const contextualLamp = inferBriefingContract({
    userMessage: 'faz com placeholders',
    contextText: 'Pedido consolidado: criar site institucional em LAMP para veterinário',
  });
  assert.strictEqual(contextualLamp.domain, 'veterinary');
  assert.strictEqual(contextualLamp.domainDecision.source, 'context_memory');
  assert.strictEqual(contextualLamp.stack, 'lamp');

  const defaultDomain = inferBriefingContract({
    userMessage: 'Criar site institucional sobre baleias jubarte e conservação do oceano',
  });
  assert.strictEqual(defaultDomain.domain, 'humpback-whales');
  assert.strictEqual(defaultDomain.domainLabel, 'baleias jubarte');
  assert.strictEqual(defaultDomain.brandFallback, 'Jubarte Azul');

  const leatherGoods = inferBriefingContract({
    userMessage: 'Criar landing em Next.js para vender bolsas, pastas e artefatos de couro artesanal',
  });
  assert.strictEqual(leatherGoods.domain, 'leather-goods');
  assert.strictEqual(leatherGoods.domainLabel, 'artefatos de couro');
  assert.strictEqual(leatherGoods.brandFallback, 'Atelier Couro Faber');

  const chocolate = inferBriefingContract({
    userMessage: 'Criar landing em Next.js para chocolate artesanal premium, cacau, bombons e temperagem',
    contextText: 'conversa antiga sobre bolsas, pastas e artefatos de couro artesanal',
  });
  assert.strictEqual(chocolate.domain, 'chocolate');
  assert.strictEqual(chocolate.contextualDomain, 'leather-goods');
  assert.strictEqual(chocolate.domainDecision.source, 'current_user_message');
  assert.strictEqual(chocolate.domainLabel, 'chocolate artesanal');
  assert.strictEqual(chocolate.brandFallback, 'Maison Cacao');

  const freshBriefWithoutDomain = inferBriefingContract({
    userMessage: [
      'Criar landing page artesanal premium e sensorial.',
      'Quero hero em vídeo, paleta creme e dourada, seção de produtos, processo, contato e CTA Comprar agora.',
      'Não quero que isso use contexto antigo automaticamente.',
    ].join(' '),
    contextText: 'conversa antiga sobre bolsas, pastas e artefatos de couro artesanal',
  });
  assert.strictEqual(freshBriefWithoutDomain.domain, '');
  assert.strictEqual(freshBriefWithoutDomain.contextualDomain, 'leather-goods');
  assert.strictEqual(freshBriefWithoutDomain.domainDecision.contextSuppressed, true);

  const weakArtisanalBrief = inferBriefingContract({
    userMessage: [
      'Criar landing page artesanal premium e sensorial.',
      'Quero hero em vídeo, paleta creme e dourada, seção de produtos, processo, contato e CTA Comprar agora.',
    ].join(' '),
  });
  assert.strictEqual(weakArtisanalBrief.domain, '');
  assert.strictEqual(weakArtisanalBrief.domainDecision.status, 'weak_evidence');
  assert.strictEqual(weakArtisanalBrief.domainDecision.fallbackReason, 'domain_weak_evidence');
  assert.strictEqual(weakArtisanalBrief.domainDecision.directScores[0].hasStrongPositiveSignals, false);

  const forgeSoftwareArchitecture = inferBriefingContract({
    userMessage: [
      'Recrie do zero este projeto como Forge MRP em Next.js com React e Tailwind.',
      'Use arquitetura livre/MCP e nao use scaffold visual generico.',
      'Entregue itens, BOM, estoque auditavel, ordens de producao, calculo deterministico e audit log.',
    ].join(' '),
  });
  assert.strictEqual(forgeSoftwareArchitecture.domain, '');
  assert.strictEqual(forgeSoftwareArchitecture.directDomain, '');
  assert.strictEqual(forgeSoftwareArchitecture.stack, 'next-tailwind');

  const tremnNegatedSaas = inferBriefingContract({
    userMessage: [
      'Criar novo projeto web estático institucional para Tremn — Escola de Gestão Consciente.',
      'Não é SaaS, não é dashboard, não é CRM e não deve usar conteúdo de tentativas anteriores.',
      'Páginas obrigatórias: Início, A Escola, Premissas, Jornada, Conteúdos e Contato.',
      'A Home tem chamada final, mas esse texto não é nome de contrato.',
      'Conteúdos pode ter artigos e newsletter como seção, não como domínio editorial.',
    ].join(' '),
    contextText: 'tentativa antiga: SaaS operacional para equipes com Dashboard executivo, Pipeline de trabalho e Agendar demo.',
  });
  assert.strictEqual(tremnNegatedSaas.domain, '');
  assert.strictEqual(tremnNegatedSaas.directDomain, '');
  assert.strictEqual(tremnNegatedSaas.contextualDomain, 'saas-tool');
  assert.strictEqual(tremnNegatedSaas.domainDecision.contextSuppressed, true);
  assert.strictEqual(tremnNegatedSaas.stack, 'static-web');

  const contractWordOnly = inferBriefingContract({
    userMessage: 'Contrato temporário para revisar footer sem executar automaticamente.',
  });
  assert.strictEqual(contractWordOnly.domain, '');
  assert.strictEqual(contractWordOnly.domainDecision.status, 'weak_evidence');
  assert.strictEqual(contractWordOnly.domainDecision.directScores[0].id, 'legal');
  assert.deepStrictEqual(contractWordOnly.domainDecision.directScores[0].signals.positive, ['contrato']);

  const legalCompetence = inferBriefingContract({
    userMessage: 'Criar site em Next.js para advocacia com competência jurídica trabalhista.',
  });
  assert.strictEqual(legalCompetence.domain, 'legal');
  assert.strictEqual(legalCompetence.domainDecision.directScores[0].negativeHits.includes('pet'), false);

  const conflictingDomainBrief = inferBriefingContract({
    userMessage: 'Criar landing em Next.js para chocolate artesanal e bolsas de couro premium.',
  });
  assert.strictEqual(conflictingDomainBrief.domain, '');
  assert.strictEqual(conflictingDomainBrief.domainDecision.source, 'conflict');
  assert.strictEqual(conflictingDomainBrief.domainDecision.status, 'conflict');
  assert.strictEqual(conflictingDomainBrief.domainDecision.blockDomainFallback, true);
  assert.strictEqual(conflictingDomainBrief.domainDecision.conflict.hasConflict, true);

  const greenhouse = inferBriefingContract({
    userMessage: [
      'Criar landing page em Next.js para venda de estufas agrícolas, viveiros e cultivo protegido.',
      'Usar React e Tailwind.',
      'Preciso de hero em vídeo, verde profundo, orçamento e modelos de estufas.',
    ].join(' '),
    contextText: 'conversa antiga sobre dentista, Clínica Sorriso e clareamento',
  });
  assert.strictEqual(greenhouse.domain, 'greenhouses');
  assert.strictEqual(greenhouse.domainLabel, 'estufas agrícolas');
  assert.strictEqual(greenhouse.stack, 'next-tailwind');
  assert.strictEqual(greenhouse.brandFallback, 'Estufas Protegidas');

  const importServices = inferBriefingContract({
    userMessage: [
      'Criar landing page de importação para consultoria em importação de produtos.',
      'Precisa falar de comércio exterior, cotação internacional, fornecedores, documentação, logística internacional, desembaraço aduaneiro e WhatsApp.',
    ].join(' '),
    contextText: 'conversa antiga sobre jardinagem e arquitetura residencial',
  });
  assert.strictEqual(importServices.domain, 'import-services');
  assert.strictEqual(importServices.domainLabel, 'importação');
  assert.strictEqual(importServices.brandFallback, 'ImportaPro Consultoria');
  assert.strictEqual(importServices.domainDecision.source, 'current_user_message');

  const gardening = inferBriefingContract({
    userMessage: [
      'Criar site completo de jardinagem com paisagismo, manutenção de jardim, produtos, blog e galeria.',
      'O conteúdo fala de plantas internas, plantas para apartamento, vasos, substratos, fertilizantes e cuidados com plantas.',
    ].join(' '),
    contextText: 'conversa antiga sobre estufas agrícolas, viveiros e cultivo protegido',
  });
  assert.strictEqual(gardening.domain, 'gardening');
  assert.strictEqual(gardening.domainLabel, 'jardinagem');
  assert.strictEqual(gardening.brandFallback, 'Jardim Vivo');
  assert.strictEqual(gardening.domainDecision.source, 'current_user_message');

  const woodSculpture = inferBriefingContract({
    userMessage: [
      'Criar site de escultura em madeira para artista e ateliê.',
      'Preciso de hero em vídeo full width, portfólio, talha manual, madeira bruta, obras sob encomenda e processo artesanal.',
      'O público inclui arquitetos e designers de interiores.',
    ].join(' '),
    contextText: 'conversa antiga sobre arquitetura residencial e clínica dental',
  });
  assert.strictEqual(woodSculpture.domain, 'wood-sculpture');
  assert.strictEqual(woodSculpture.domainLabel, 'escultura em madeira');
  assert.strictEqual(woodSculpture.brandFallback, 'Ateliê Madeira Viva');
  assert.strictEqual(woodSculpture.domainDecision.source, 'current_user_message');

  const aureaIp = inferBriefingContract({
    userMessage: [
      'Briefing — Landing Page Institucional',
      'Escritório de Patentes: Aurea IP & Patentes',
      'Criar landing page sofisticada para registro de patentes, marcas, desenhos industriais, modelos de utilidade, busca de anterioridade, INPI e proteção internacional.',
      'Precisa ter hero com vídeo full width, serviços, especialista, atuação global, processo, diferenciais, contato e footer escuro.',
    ].join('\n'),
    contextText: 'smoke anterior: Studio Habitat, Helena Duarte Arquitetura e arquitetura contemporânea para espaços com identidade',
  });
  assert.strictEqual(aureaIp.domain, 'intellectual-property');
  assert.strictEqual(aureaIp.domainLabel, 'propriedade intelectual');
  assert.strictEqual(aureaIp.brandFallback, 'Escritório de Propriedade Intelectual');
  assert.strictEqual(aureaIp.contextualDomain, 'architecture');
  assert.strictEqual(aureaIp.domainDecision.source, 'current_user_message');

  const lineaBosco = inferBriefingContract({
    userMessage: [
      'Briefing — Site Completo',
      'Empresa: Linea Bosco Revestimentos',
      'Criar site completo elegante para pisos de madeira, painéis ripados, decks, revestimentos naturais, acabamentos arquitetônicos, projetos, inspirações e orçamento.',
      'A comunicação deve falar de madeira natural, paginações, carvalho, nogueira, cumaru, freijó, tauari e ipê.',
    ].join('\n'),
    contextText: 'smoke anterior: Studio Habitat, Helena Duarte Arquitetura, arquitetura contemporânea e clínicas odontológicas',
  });
  assert.strictEqual(lineaBosco.domain, 'wood-finishes');
  assert.strictEqual(lineaBosco.domainLabel, 'revestimentos de madeira');
  assert.strictEqual(lineaBosco.brandFallback, 'Estúdio de Revestimentos Naturais');
  assert.notStrictEqual(lineaBosco.contextualDomain, 'wood-finishes');
  assert.strictEqual(lineaBosco.domainDecision.source, 'current_user_message');

  const wineLanding = inferBriefingContract({
    userMessage: [
      'Briefing completo — Landing Page de Vinhos',
      'Criar landing page para vinhos artesanais premium, vinícola boutique, kit degustação, rótulos, terroir, uvas selecionadas, colheita manual, barricas e harmonização.',
      'A copy deve vender uma experiência sensorial e uma oferta especial do kit.',
    ].join('\n'),
    contextText: 'smoke antigo sobre pisos de madeira, carvalho, nogueira e decks',
  });
  assert.strictEqual(wineLanding.domain, 'premium-wine-landing');
  assert.strictEqual(wineLanding.domainLabel, 'vinhos premium e experiência sensorial');
  assert.strictEqual(wineLanding.brandFallback, 'Vinícola Boutique');
  assert.notStrictEqual(wineLanding.domain, 'wood-finishes');
  assert.strictEqual(wineLanding.domainDecision.source, 'current_user_message');

  const constructionMaterials = inferBriefingContract({
    userMessage: [
      'Faça um site completo com múltiplas páginas do tema materiais de construção.',
      'Precisa de sobre da empresa, produtos, serviços, orçamento, contato, cimento, areia, brita, argamassa, tijolos, telhas, hidráulica, elétrica, ferramentas, tintas, entrega programada e lista de materiais.',
    ].join('\n'),
    contextText: 'smoke antigo sobre vinhos, terroir, garrafas de vidro e esquadrias de alumínio',
  });
  assert.strictEqual(constructionMaterials.domain, 'construction-materials-site');
  assert.strictEqual(constructionMaterials.domainLabel, 'loja de materiais de construção multipágina');
  assert.strictEqual(constructionMaterials.brandFallback, 'Loja de Materiais de Construção');
  assert.notStrictEqual(constructionMaterials.domain, 'technical-b2b-services-site');
  assert.strictEqual(constructionMaterials.domainDecision.source, 'current_user_message');

  const architecture = inferBriefingContract({
    userMessage: [
      'Criar site completo para Helena Duarte Arquitetura.',
      'Precisa de hero com vídeo full width, serviços de arquitetura, projetos, cases, processo, insights e contato.',
    ].join(' '),
    contextText: 'conversa antiga sobre escultura em madeira e clínica dental',
  });
  assert.strictEqual(architecture.domain, 'architecture');
  assert.strictEqual(architecture.domainLabel, 'arquitetura');
  assert.strictEqual(architecture.brandFallback, 'Studio Habitat');
  assert.strictEqual(architecture.domainDecision.source, 'current_user_message');

  const photoLab = inferBriefingContract({
    userMessage: [
      'Briefing completo — Site para Laboratório Fotográfico',
      'Nome fictício do negócio',
      'Lumen Lab Fotográfico',
      'Criar site cinematográfico para laboratório fotográfico especializado em revelação de filmes, digitalização profissional, impressão fine art, restauração fotográfica, ampliações, negativos e atendimento para fotógrafos.',
      'Precisa de hero full width com vídeo, serviços, portfólio, processo, orçamento, depoimentos e contato.',
    ].join('\n'),
    contextText: 'conversa antiga sobre escultura em madeira, artista, ateliê e galeria',
  });
  assert.strictEqual(photoLab.domain, 'photo-lab');
  assert.strictEqual(photoLab.domainLabel, 'laboratório fotográfico');
  assert.strictEqual(photoLab.brandFallback, 'Laboratório Fotográfico');
  assert.strictEqual(photoLab.contextualDomain, 'wood-sculpture');
  assert.strictEqual(photoLab.domainDecision.source, 'current_user_message');
  assert.strictEqual(photoLab.domainDecision.blockDomainFallback, false);
  assert.strictEqual(photoLab.domainDecision.directScores[0].id, 'photo-lab');

  const staleContextMention = inferBriefingContract({
    userMessage: [
      'Criar landing page em Next.js para venda de estufas agrícolas, residenciais e comerciais.',
      'A conversa antiga falava de Clínica Sorriso, mas este projeto é para cultivo protegido e viveiros.',
    ].join(' '),
  });
  assert.strictEqual(staleContextMention.domain, 'greenhouses');
  assert.strictEqual(staleContextMention.domainDecision.source, 'current_user_message');
  assert.strictEqual(staleContextMention.domainDecision.directScores[0].id, 'greenhouses');
  assert.strictEqual(staleContextMention.domainDecision.directScores[0].negativeHits.includes('clinica sorriso'), false);

  const conflict = evaluateBriefingAdherence({
    contract: directLegal,
    text: 'Clínica Sorriso oferece clareamento, implante e consulta odontológica.',
  });
  assert.strictEqual(conflict.enabled, true);
  assert.strictEqual(conflict.passesMinimum, false);
  assert.strictEqual(conflict.severity, 'critical');
  assert.ok(conflict.negativeHits.includes('clinica sorriso'));

  const legalOk = evaluateBriefingAdherence({
    contract: directLegal,
    text: 'Escritório de advocacia com consultoria jurídica, contratos e direito trabalhista.',
  });
  assert.strictEqual(legalOk.passesMinimum, true);

  const leatherOk = evaluateBriefingAdherence({
    contract: leatherGoods,
    text: 'Atelier de couro com bolsas, pastas, produção artesanal e acabamento feito à mão.',
  });
  assert.strictEqual(leatherOk.passesMinimum, true);

  const chocolateConflict = evaluateBriefingAdherence({
    contract: chocolate,
    text: 'Atelier Couro Faber vende bolsas, pastas e carteiras de couro.',
  });
  assert.strictEqual(chocolateConflict.passesMinimum, false);
  assert.strictEqual(chocolateConflict.severity, 'critical');
  assert.ok(chocolateConflict.negativeHits.includes('atelier couro'));

  const chocolateOk = evaluateBriefingAdherence({
    contract: chocolate,
    text: 'Maison Cacao apresenta chocolate artesanal, cacau selecionado, bombons e temperagem.',
  });
  assert.strictEqual(chocolateOk.passesMinimum, true);

  const greenhouseConflict = evaluateBriefingAdherence({
    contract: greenhouse,
    text: 'Clínica Sorriso com consultório odontológico e imagem de modern real estate interior.',
  });
  assert.strictEqual(greenhouseConflict.passesMinimum, false);
  assert.strictEqual(greenhouseConflict.severity, 'critical');
  assert.ok(greenhouseConflict.negativeHits.includes('clinica sorriso'));

  const greenhouseOk = evaluateBriefingAdherence({
    contract: greenhouse,
    text: 'Estufas agrícolas para cultivo protegido, viveiros, irrigação e produtores rurais.',
  });
  assert.strictEqual(greenhouseOk.passesMinimum, true);

  const importOk = evaluateBriefingAdherence({
    contract: importServices,
    text: 'Consultoria em importação com fornecedores internacionais, cotação, documentação, logística internacional e desembaraço aduaneiro.',
  });
  assert.strictEqual(importOk.passesMinimum, true);

  const aureaStaleFallback = evaluateBriefingAdherence({
    contract: aureaIp,
    text: 'Escritório Faber Advocacia cria uma presença digital clara para transformar visitantes em contatos.',
  });
  assert.strictEqual(aureaStaleFallback.passesMinimum, false);
  assert.strictEqual(aureaStaleFallback.severity, 'critical');

  const aureaOk = evaluateBriefingAdherence({
    contract: aureaIp,
    text: 'Aurea IP & Patentes atua com patentes, marcas, desenhos industriais, busca de anterioridade, INPI e proteção internacional.',
  });
  assert.strictEqual(aureaOk.passesMinimum, true);

  const lineaStaleFallback = evaluateBriefingAdherence({
    contract: lineaBosco,
    text: 'Studio Habitat apresenta Helena Duarte Arquitetura e arquitetura contemporânea para espaços com identidade.',
  });
  assert.strictEqual(lineaStaleFallback.passesMinimum, false);
  assert.strictEqual(lineaStaleFallback.severity, 'critical');

  const lineaOk = evaluateBriefingAdherence({
    contract: lineaBosco,
    text: 'Linea Bosco Revestimentos apresenta pisos de madeira, painéis ripados, decks, revestimentos naturais e acabamentos sob medida.',
  });
  assert.strictEqual(lineaOk.passesMinimum, true);

  const guidance = formatBriefingContractForPrompt(directLegal);
  assert.ok(guidance.includes('next-tailwind'));
  assert.ok(guidance.includes('advocacia'));
  assert.ok(formatBriefingContractForPrompt(greenhouse).includes('estufas agrícolas'));

  console.log('briefing-contract-service.test.js: ok');
}

run();
