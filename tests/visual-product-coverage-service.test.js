const assert = require('assert');

const { createVisualProductCoverageService } = require('../cortex/orchestration/visual_product_coverage_service');

function createCompleteSnapshot(overrides = {}) {
  return {
    title: 'Atelie Madeira Viva',
    viewport: { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
    bodyText: [
      'Esculturas em madeira com loja, portfolio, blog, depoimentos e contato.',
      'Encomendar agora.',
    ].join(' '),
    headings: ['Esculturas em madeira com presenca de galeria'],
    buttons: ['Encomendar agora', 'Ver portfolio'],
    images: [{ src: 'hero-madeira.jpg', alt: 'escultura em madeira' }],
    videos: [],
    iframes: [],
    svgCount: 4,
    iconLikeCount: 4,
    sectionCount: 8,
    formCount: 4,
    aboveFold: {
      text: 'Esculturas em madeira com presenca de galeria Encomendar agora Ver portfolio',
      headings: ['Esculturas em madeira com presenca de galeria'],
      buttons: ['Encomendar agora', 'Ver portfolio'],
      hasH1: true,
      visibleTextBlocks: 9,
      mediaCount: 1,
    },
    ctaCandidates: [
      { text: 'Encomendar agora', href: '#contato', aboveFold: true, visibleInViewport: true },
      { text: 'Ver portfolio', href: '#portfolio', aboveFold: true, visibleInViewport: true },
    ],
    sections: [
      {
        tag: 'section',
        id: 'hero',
        className: 'hero-section',
        heading: 'Esculturas em madeira com presenca de galeria',
        text: 'Esculturas autorais, talha fina, obras sob encomenda e pecas prontas para entrega.',
        buttonTexts: ['Encomendar agora'],
        mediaCount: 1,
        itemCount: 1,
        aboveFold: true,
        visibleInViewport: true,
      },
      {
        tag: 'section',
        id: 'loja',
        heading: 'Loja de obras disponiveis',
        text: 'Loja com produtos, pecas prontas, esculturas de parede, totens, objetos decorativos e obras disponiveis para comprar agora.',
        buttonTexts: ['Comprar escultura'],
        linkTexts: ['Escultura de parede', 'Toten em madeira', 'Objeto decorativo'],
        mediaCount: 3,
        itemCount: 3,
      },
      {
        tag: 'section',
        id: 'blog',
        heading: 'Blog do atelie',
        text: 'Blog com artigos sobre madeira, acabamento natural, conservacao de esculturas, bastidores do processo e guias de compra.',
        linkTexts: ['Como escolher madeira', 'Cuidados com esculturas', 'Processo de talha'],
        itemCount: 3,
      },
      {
        tag: 'section',
        id: 'portfolio',
        heading: 'Portfolio e galeria',
        text: 'Galeria e portfolio com projetos realizados, obras selecionadas, encomendas especiais e fotos de antes e depois.',
        linkTexts: ['Ver projeto jardim', 'Ver obra de parede', 'Ver escultura grande'],
        mediaCount: 4,
        itemCount: 4,
      },
      {
        tag: 'section',
        id: 'depoimentos',
        heading: 'Depoimentos de clientes',
        text: 'Depoimentos de clientes, avaliacoes de colecionadores e relatos sobre encomendas entregues para casas, hoteis e escritorios.',
        itemCount: 3,
      },
      {
        tag: 'section',
        id: 'contato',
        heading: 'Contato e orcamento',
        text: 'Contato por formulario, WhatsApp e email para orcamento, prazo, dimensoes, tipo de madeira e mensagem do cliente.',
        buttonTexts: ['Enviar orcamento'],
        formControlCount: 5,
        itemCount: 5,
      },
      {
        tag: 'footer',
        id: 'rodape',
        heading: 'Rodape',
        text: 'Footer com Instagram, YouTube, WhatsApp, email, links de rodape e todos os direitos reservados.',
        linkTexts: ['Instagram', 'YouTube', 'WhatsApp'],
        itemCount: 3,
      },
    ],
    ...overrides,
  };
}

function run() {
  const service = createVisualProductCoverageService({ minProductCoverageScore: 78 });
  const fullSiteBriefing = [
    'Criar site completo para escultura em madeira.',
    'Precisa ter hero, CTA, loja de produtos, blog, galeria/portfolio, depoimentos, contato com formulario e footer com redes sociais.',
  ].join(' ');

  const complete = service.evaluateVisualProductCoverage({
    userMessage: fullSiteBriefing,
    pageSnapshot: createCompleteSnapshot(),
  });
  assert.strictEqual(complete.enabled, true);
  assert.strictEqual(complete.passesMinimum, true);
  assert.strictEqual(complete.checks.heroAboveFold, true);
  assert.strictEqual(complete.checks.ctaAboveFold, true);
  assert.strictEqual(complete.checks.productsStore, true);
  assert.strictEqual(complete.checks.blog, true);
  assert.strictEqual(complete.checks.galleryPortfolio, true);
  assert.strictEqual(complete.checks.testimonials, true);
  assert.strictEqual(complete.checks.contactForm, true);
  assert.strictEqual(complete.checks.footer, true);

  const missingSections = service.evaluateVisualProductCoverage({
    userMessage: fullSiteBriefing,
    pageSnapshot: createCompleteSnapshot({
      sections: [
        {
          tag: 'section',
          id: 'hero',
          heading: 'Esculturas em madeira',
          text: 'Esculturas autorais e encomendas especiais.',
          buttonTexts: ['Encomendar agora'],
          aboveFold: true,
          visibleInViewport: true,
        },
      ],
    }),
  });
  assert.strictEqual(missingSections.passesMinimum, false);
  assert.ok(missingSections.issues.some((issue) => issue.id === 'product_section_missing_blog'));
  assert.ok(missingSections.issues.some((issue) => issue.id === 'product_section_missing_contactForm'));

  const ctaBelowFold = service.evaluateVisualProductCoverage({
    userMessage: 'Criar landing page com hero e CTA principal acima da dobra.',
    pageSnapshot: createCompleteSnapshot({
      aboveFold: {
        text: 'Esculturas em madeira com presenca de galeria',
        headings: ['Esculturas em madeira com presenca de galeria'],
        buttons: [],
        hasH1: true,
        visibleTextBlocks: 6,
        mediaCount: 1,
      },
      ctaCandidates: [
        { text: 'Encomendar agora', href: '#contato', aboveFold: false, visibleInViewport: false },
      ],
    }),
  });
  assert.strictEqual(ctaBelowFold.passesMinimum, false);
  assert.ok(ctaBelowFold.issues.some((issue) => issue.id === 'product_cta_above_fold_missing'));

  const colorPatch = service.evaluateVisualProductCoverage({
    userMessage: 'Troque o fundo para vermelho.',
    contextText: 'O projeto possui loja, blog, portfolio e contato.',
    pageSnapshot: createCompleteSnapshot(),
  });
  assert.strictEqual(colorPatch.enabled, false);
  assert.strictEqual(colorPatch.passesMinimum, true);

  const forgeTool = service.evaluateVisualProductCoverage({
    userMessage:
      'Corrija o preview Next.js preservando ferramenta Forge MRP com formulario, tabela, acoes, itens, BOM, estoque auditavel, ordens com maquina de estados, calculo deterministico e audit log.',
    pageSnapshot: createCompleteSnapshot({
      title: 'Forge MRP',
      bodyText:
        'Forge MRP cadastro de itens estrutura de produto BOM movimentacao de estoque ordens de producao auditoria tabela acoes cadastrar liberar iniciar finalizar.',
      headings: ['Forge MRP', 'Cadastro de Itens', 'Ordens de Producao', 'Audit Log'],
      buttons: ['Cadastrar', 'Liberar', 'Iniciar', 'Finalizar'],
      aboveFold: {
        text: 'Forge MRP cadastro de itens estrutura de produto BOM movimentacao de estoque ordens de producao auditoria',
        headings: ['Forge MRP'],
        buttons: ['Cadastrar'],
        hasH1: true,
        visibleTextBlocks: 8,
      },
      ctaCandidates: [{ text: 'Cadastrar', href: '', aboveFold: true, visibleInViewport: true }],
      formCount: 12,
      sections: [
        {
          tag: 'section',
          id: 'forge-mrp',
          heading: 'Cadastro de Itens',
          text: 'Cadastro de itens BOM estoque auditavel ordens de producao maquina de estados audit log tabela acoes.',
          buttonTexts: ['Cadastrar', 'Liberar'],
          formControlCount: 12,
          itemCount: 6,
          aboveFold: true,
          visibleInViewport: true,
        },
      ],
    }),
  });
  assert.strictEqual(forgeTool.enabled, true);
  assert.strictEqual(forgeTool.expectations.required.operationalSurface, true);
  assert.strictEqual(forgeTool.expectations.required.cta, false);
  assert.strictEqual(forgeTool.expectations.required.contactForm, false);
  assert.strictEqual(forgeTool.passesMinimum, true);

  const ctaOnlySite = service.evaluateVisualProductCoverage({
    userMessage: 'Criar site institucional com CTA Comprar agora acima da dobra.',
    contextText: 'Botao Comprar agora no hero.',
    pageSnapshot: createCompleteSnapshot({
      sections: [
        {
          tag: 'section',
          id: 'hero',
          heading: 'Institucional Faber',
          text: 'Site institucional com proposta clara e botao Comprar agora.',
          buttonTexts: ['Comprar agora'],
          aboveFold: true,
          visibleInViewport: true,
        },
      ],
    }),
  });
  assert.strictEqual(ctaOnlySite.expectations.required.productsStore, false);
  assert.strictEqual(ctaOnlySite.issues.some((issue) => issue.id === 'product_section_missing_productsStore'), false);

  const multipageHome = service.evaluateVisualProductCoverage({
    userMessage: [
      'Criar site institucional multipágina.',
      'Páginas reais obrigatórias: index.html, a-escola.html, premissas.html, jornada.html, conteudos.html, contato.html.',
      'Home com hero, CTA e seções institucionais.',
      'Conteúdos: área preparada para artigos e reflexões.',
      'Contato: formulário completo.',
    ].join(' '),
    pageSnapshot: createCompleteSnapshot({
      title: 'Tremn — Escola de Gestão Consciente',
      url: 'http://localhost:5173/index.html',
      bodyText: 'Tremn Início A Escola Premissas Jornada Conteúdos Contato Uma nova consciência para uma nova forma de gerir Quero conhecer',
      headings: ['Uma nova consciência para uma nova forma de gerir'],
      buttons: ['Quero conhecer', 'Ver premissas'],
      aboveFold: {
        text: 'Uma nova consciência para uma nova forma de gerir Quero conhecer Ver premissas',
        headings: ['Uma nova consciência para uma nova forma de gerir'],
        buttons: ['Quero conhecer', 'Ver premissas'],
        hasH1: true,
        visibleTextBlocks: 5,
        mediaCount: 0,
      },
      ctaCandidates: [
        { text: 'Quero conhecer', href: 'contato.html', aboveFold: true, visibleInViewport: true },
      ],
      sections: [
        {
          tag: 'section',
          id: 'hero',
          heading: 'Uma nova consciência para uma nova forma de gerir',
          text: 'A Escola de Gestão Consciente apoia líderes, gestores e organizações.',
          buttonTexts: ['Quero conhecer', 'Ver premissas'],
          aboveFold: true,
          visibleInViewport: true,
        },
        {
          tag: 'footer',
          id: 'rodape',
          heading: 'Footer',
          text: 'Footer com links, contato, newsletter, redes sociais e todos os direitos reservados.',
          linkTexts: ['Início', 'Conteúdos', 'Contato'],
          formControlCount: 1,
          itemCount: 4,
        },
      ],
    }),
  });
  assert.strictEqual(multipageHome.passesMinimum, true);
  assert.strictEqual(multipageHome.expectations.scope.multipage, true);
  assert.strictEqual(multipageHome.expectations.required.blog, false);
  assert.strictEqual(multipageHome.expectations.required.contactForm, false);
  assert.strictEqual(multipageHome.issues.some((issue) => issue.id === 'product_section_missing_blog'), false);

  const negativePreviousProjects = service.evaluateVisualProductCoverage({
    userMessage: [
      'Criar site institucional multipágina para Tremn.',
      'Não reaproveite conteúdo, layout, marca ou arquivos de projetos anteriores.',
      'Páginas reais obrigatórias: index.html, conteudos.html, contato.html.',
      'Conteúdos: área preparada para artigos e reflexões.',
    ].join(' '),
    pageSnapshot: createCompleteSnapshot({
      title: 'Tremn — Escola de Gestão Consciente',
      url: 'http://localhost:5173/index.html',
      bodyText: 'Tremn Início Conteúdos Contato Uma nova consciência para uma nova forma de gerir Quero conhecer',
      headings: ['Uma nova consciência para uma nova forma de gerir'],
      buttons: ['Quero conhecer'],
      aboveFold: {
        text: 'Uma nova consciência para uma nova forma de gerir Quero conhecer',
        headings: ['Uma nova consciência para uma nova forma de gerir'],
        buttons: ['Quero conhecer'],
        hasH1: true,
        visibleTextBlocks: 5,
      },
      ctaCandidates: [
        { text: 'Quero conhecer', href: 'contato.html', aboveFold: true, visibleInViewport: true },
      ],
      sections: [
        {
          tag: 'section',
          id: 'hero',
          heading: 'Uma nova consciência para uma nova forma de gerir',
          text: 'A Escola de Gestão Consciente apoia líderes, gestores e organizações.',
          buttonTexts: ['Quero conhecer'],
          aboveFold: true,
          visibleInViewport: true,
        },
      ],
    }),
  });
  assert.strictEqual(negativePreviousProjects.expectations.required.galleryPortfolio, false);
  assert.strictEqual(negativePreviousProjects.issues.some((issue) => issue.id === 'product_section_missing_galleryPortfolio'), false);

  const visiblePlaceholder = service.evaluateVisualProductCoverage({
    userMessage: 'Briefing Completo: criar landing page final de importação com hero, CTA, serviços, contato e footer.',
    pageSnapshot: createCompleteSnapshot({
      title: 'Faber Projeto',
      aboveFold: {
        text: 'Faber Projeto Atendimento placeholder premium conteudo provisorio pronto para evoluir Agendar conversa',
        headings: ['Faber Projeto'],
        buttons: ['Agendar conversa'],
        hasH1: true,
        visibleTextBlocks: 6,
        mediaCount: 1,
      },
      ctaCandidates: [
        { text: 'Agendar conversa', href: '#contato', aboveFold: true, visibleInViewport: true },
      ],
      sections: [
        {
          tag: 'section',
          id: 'hero',
          heading: 'Faber Projeto',
          text: 'Atendimento placeholder premium com conteudo provisorio pronto para evoluir.',
          buttonTexts: ['Agendar conversa'],
          aboveFold: true,
          visibleInViewport: true,
        },
        {
          tag: 'section',
          id: 'contato',
          heading: 'Contato',
          text: 'Contato por formulario, WhatsApp e email.',
          formControlCount: 3,
        },
        {
          tag: 'footer',
          id: 'rodape',
          heading: 'Rodape',
          text: 'Footer com WhatsApp e Instagram.',
        },
      ],
    }),
  });
  assert.strictEqual(visiblePlaceholder.checks.noGenericProductPlaceholders, false);
  assert.strictEqual(visiblePlaceholder.passesMinimum, false);
  assert.ok(visiblePlaceholder.issues.some((issue) => issue.id === 'product_generic_placeholder_visible'));

  const aureaFallbackVisible = service.evaluateVisualProductCoverage({
    userMessage: 'Briefing Completo: criar landing page final para Aurea IP & Patentes com patentes, marcas, busca de anterioridade, INPI, proteção internacional, contato e footer.',
    pageSnapshot: createCompleteSnapshot({
      title: 'Escritório Faber Advocacia',
      aboveFold: {
        text: 'Escritório Faber Advocacia Uma presença digital clara para transformar visitantes em contatos Agendar conversa',
        headings: ['Escritório Faber Advocacia'],
        buttons: ['Agendar conversa'],
        hasH1: true,
        visibleTextBlocks: 6,
        mediaCount: 1,
      },
      sections: [
        {
          tag: 'section',
          id: 'hero',
          heading: 'Escritório Faber Advocacia',
          text: 'Uma presença digital clara para transformar visitantes em contatos.',
          buttonTexts: ['Agendar conversa'],
          aboveFold: true,
          visibleInViewport: true,
        },
      ],
    }),
  });
  assert.strictEqual(aureaFallbackVisible.checks.noGenericProductPlaceholders, false);
  assert.strictEqual(aureaFallbackVisible.passesMinimum, false);

  const lineaStaleVisible = service.evaluateVisualProductCoverage({
    userMessage: 'Briefing Completo: criar site completo final para Linea Bosco Revestimentos com pisos de madeira, painéis ripados, decks, projetos, inspirações, orçamento e contato.',
    pageSnapshot: createCompleteSnapshot({
      title: 'Studio Habitat',
      aboveFold: {
        text: 'Studio Habitat Helena Duarte Arquitetura arquitetura contemporânea para espaços com identidade Solicitar proposta',
        headings: ['Arquitetura contemporânea para espaços com identidade'],
        buttons: ['Solicitar proposta'],
        hasH1: true,
        visibleTextBlocks: 7,
        mediaCount: 1,
      },
      sections: [
        {
          tag: 'section',
          id: 'hero',
          heading: 'Arquitetura contemporânea para espaços com identidade',
          text: 'Helena Duarte Arquitetura apresenta projetos residenciais, comerciais e de interiores.',
          buttonTexts: ['Solicitar proposta'],
          aboveFold: true,
          visibleInViewport: true,
        },
      ],
    }),
  });
  assert.strictEqual(lineaStaleVisible.checks.noGenericProductPlaceholders, false);
  assert.strictEqual(lineaStaleVisible.passesMinimum, false);

  console.log('visual-product-coverage-service.test.js: ok');
}

run();
