const assert = require('assert');

const { createVisualBriefingSemanticService } = require('../cortex/orchestration/visual_briefing_semantic_service');

function createChocolateSnapshot(overrides = {}) {
  return {
    title: 'Maison Cacao',
    bodyText: [
      'Chocolate feito para ser sentido.',
      'Cacau selecionado, bombons especiais, sabores intensos e experiencia premium.',
      'Veja como nasce o nosso chocolate: do grao ao tablete, temperagem e moldagem.',
      'Comprar agora. Instagram Facebook TikTok Pinterest YouTube.',
    ].join(' '),
    headings: ['Chocolate feito para ser sentido', 'Veja como nasce o nosso chocolate', 'Sabores especiais'],
    buttons: ['Explorar chocolates', 'Comprar agora'],
    images: [{ src: 'assets/chocolate-hero.jpg', alt: 'Chocolate derretendo' }],
    videos: [{ src: 'assets/chocolate-processo.mp4', alt: 'Processo de temperagem' }],
    iframes: [],
    svgCount: 4,
    iconLikeCount: 4,
    sectionCount: 7,
    formCount: 0,
    computedTokens: [
      {
        color: 'rgb(255, 248, 240)',
        backgroundColor: '#3b1f14',
        fontFamily: 'Playfair Display, serif',
      },
    ],
    ...overrides,
  };
}

function run() {
  const service = createVisualBriefingSemanticService({ minSemanticScore: 72 });
  const briefing = [
    'Criar site de chocolate artesanal, premium e sensorial.',
    'Hero com video, imagens, icones, produtos/sabores, processo, contato, footer e CTA Comprar agora.',
    'Paleta #3B1F14 #1E0F0A #F7E7CE #C89B5A #FFF8F0.',
  ].join(' ');

  const good = service.evaluateVisualBriefingSemantics({
    userMessage: briefing,
    pageSnapshot: createChocolateSnapshot(),
  });
  assert.strictEqual(good.enabled, true);
  assert.strictEqual(good.passesMinimum, true);
  assert.strictEqual(good.contract.domain, 'chocolate');
  assert.strictEqual(good.checks.video, true);
  assert.strictEqual(good.checks.products, true);
  assert.strictEqual(good.checks.process, true);

  const leatherResult = service.evaluateVisualBriefingSemantics({
    userMessage: briefing,
    pageSnapshot: {
      title: 'Atelier Couro Faber',
      bodyText: 'Bolsas de couro, pastas, carteiras e artefatos de couro feitos a mao para atravessar anos.',
      headings: ['Pecas de couro feitas para atravessar anos'],
      buttons: ['Conhecer colecoes'],
      images: [{ src: 'assets/couro.jpg', alt: 'costura em couro' }],
      videos: [],
      iframes: [],
      svgCount: 1,
      iconLikeCount: 1,
      sectionCount: 4,
      formCount: 0,
      computedTokens: [],
    },
  });
  assert.strictEqual(leatherResult.passesMinimum, false);
  assert.strictEqual(leatherResult.adherence.hasConflictingDomain, true);
  assert.ok(leatherResult.issues.some((issue) => issue.id === 'semantic_domain_adherence'));
  assert.ok(leatherResult.issues.some((issue) => issue.severity === 'critical'));

  const noVideo = service.evaluateVisualBriefingSemantics({
    userMessage: briefing,
    pageSnapshot: createChocolateSnapshot({ videos: [], iframes: [] }),
  });
  assert.strictEqual(noVideo.passesMinimum, false);
  assert.strictEqual(noVideo.checks.video, false);
  assert.ok(noVideo.issues.some((issue) => issue.id === 'semantic_video_missing'));

  const heroVideoEmpty = service.evaluateVisualBriefingSemantics({
    userMessage: 'Ajustar hero com video de abelhas, midia de fundo, camada branca e blend.',
    pageSnapshot: {
      title: 'Tremn',
      bodyText: 'Uma nova consciência para uma nova forma de gerir. Conheça a Escola.',
      headings: ['Uma nova consciência para uma nova forma de gerir'],
      buttons: ['Conheça a Escola'],
      images: [],
      videos: [{ src: '', alt: 'abelhas voando' }],
      iframes: [],
      svgCount: 1,
      iconLikeCount: 1,
      sectionCount: 2,
      formCount: 0,
      computedTokens: [
        { backgroundImage: 'radial-gradient(circle, rgba(0,0,0,.2), transparent)', className: 'hero-video-fallback' },
      ],
    },
  });
  assert.strictEqual(heroVideoEmpty.expectations.wantsVideo, true);
  assert.strictEqual(heroVideoEmpty.expectations.wantsImages, false);
  assert.strictEqual(heroVideoEmpty.checks.video, false);
  assert.ok(heroVideoEmpty.issues.some((issue) => issue.id === 'semantic_video_missing'));

  const heroVideoOnly = service.evaluateVisualBriefingSemantics({
    userMessage: 'Ajustar hero com video de abelhas, midia de fundo, camada branca e blend.',
    pageSnapshot: {
      title: 'Tremn',
      bodyText: 'Uma nova consciência para uma nova forma de gerir. Conheça a Escola.',
      headings: ['Uma nova consciência para uma nova forma de gerir'],
      buttons: ['Conheça a Escola'],
      images: [],
      videos: [{ src: 'https://videos.pexels.com/video-files/bees-smoke.mp4', alt: 'abelhas voando' }],
      iframes: [],
      svgCount: 1,
      iconLikeCount: 1,
      sectionCount: 2,
      formCount: 0,
      computedTokens: [
        { backgroundImage: 'radial-gradient(circle, rgba(0,0,0,.2), transparent)', className: 'hero-video-fallback' },
      ],
    },
  });
  assert.strictEqual(heroVideoOnly.checks.video, true);
  assert.strictEqual(heroVideoOnly.passesMinimum, true);

  const backgroundVisualGradient = service.evaluateVisualBriefingSemantics({
    userMessage: 'Ajustar hero visual com background visual claro e textura.',
    pageSnapshot: {
      title: 'Tremn',
      bodyText: 'Uma nova consciência para uma nova forma de gerir. Conheça a Escola.',
      headings: ['Uma nova consciência para uma nova forma de gerir'],
      buttons: ['Conheça a Escola'],
      images: [],
      videos: [],
      iframes: [],
      svgCount: 0,
      iconLikeCount: 0,
      sectionCount: 2,
      formCount: 0,
      computedTokens: [
        { backgroundImage: 'linear-gradient(135deg, #f8f7f2, #f1cc98)', className: 'hero-media-stack' },
      ],
    },
  });
  assert.strictEqual(backgroundVisualGradient.expectations.wantsImages, true);
  assert.strictEqual(backgroundVisualGradient.checks.images, true);
  assert.strictEqual(backgroundVisualGradient.passesMinimum, true);

  const forgeTool = service.evaluateVisualBriefingSemantics({
    userMessage:
      'Preserve a ferramenta Forge MRP com formulario, tabela, acoes, itens, BOM, estoque auditavel, ordens com maquina de estados, calculo deterministico e audit log.',
    pageSnapshot: {
      title: 'Forge MRP',
      bodyText:
        'Forge MRP cadastro de itens estrutura de produto BOM movimentacao de estoque ordens de producao auditoria tabela acoes cadastrar liberar iniciar finalizar.',
      headings: ['Forge MRP', 'Cadastro de Itens', 'Ordens de Producao', 'Audit Log'],
      buttons: ['Cadastrar', 'Liberar', 'Iniciar', 'Finalizar'],
      images: [],
      videos: [],
      iframes: [],
      svgCount: 0,
      iconLikeCount: 0,
      sectionCount: 6,
      formCount: 12,
      computedTokens: [],
    },
  });
  assert.strictEqual(forgeTool.expectations.operationalTool, true);
  assert.strictEqual(forgeTool.expectations.wantsCTA, false);
  assert.strictEqual(forgeTool.passesMinimum, true);

  const tremnMultipageHome = service.evaluateVisualBriefingSemantics({
    userMessage: [
      'Recrie do zero este projeto como SITE INSTITUCIONAL MULTIPÁGINA estático para Tremn.',
      'Páginas reais obrigatórias: index.html, a-escola.html, premissas.html, jornada.html, conteudos.html, contato.html.',
      'Home com hero, botões, seções e cards. Jornada com etapas Perceber, Questionar, Interiorizar, Responsabilizar-se e Transformar.',
      'Contato com opções do campo Interesse. Premissas com ícone simples e botão Ler mais.',
    ].join(' '),
    pageSnapshot: {
      url: 'file:///tmp/tremn/index.html',
      title: 'Tremn — Escola de Gestão Consciente',
      bodyText: [
        'Tremn — Escola de Gestão Consciente.',
        'Uma nova consciência para uma nova forma de gerir.',
        'Conheça a Escola. Ver premissas. Entrar em contato.',
        'Os desafios atuais pedem novos níveis de consciência.',
        'Ecologia Tecnologia Sociedade Economia Liderança.',
        'Cinco premissas orientam essa jornada.',
        '© Tremn — Escola de Gestão Consciente. Todos os direitos reservados.',
      ].join(' '),
      headings: ['Uma nova consciência para uma nova forma de gerir', 'Cinco premissas orientam essa jornada'],
      buttons: ['Conheça a Escola', 'Ver premissas', 'Entrar em contato'],
      images: [],
      videos: [],
      iframes: [],
      svgCount: 0,
      iconLikeCount: 0,
      sectionCount: 5,
      formCount: 0,
      computedTokens: [],
    },
  });
  assert.strictEqual(tremnMultipageHome.passesMinimum, true);
  assert.strictEqual(tremnMultipageHome.checks.products, true);
  assert.strictEqual(tremnMultipageHome.checks.process, true);
  assert.ok(tremnMultipageHome.expectations.scope.relaxed.includes('process_home_multipage'));
  assert.ok(!tremnMultipageHome.issues.some((issue) => issue.id === 'semantic_products_missing'));
  assert.ok(!tremnMultipageHome.issues.some((issue) => issue.id === 'semantic_process_missing'));

  const missingSnapshot = service.evaluateVisualBriefingSemantics({
    userMessage: briefing,
    pageSnapshot: null,
  });
  assert.strictEqual(missingSnapshot.passesMinimum, false);
  assert.ok(missingSnapshot.criticalFailures.includes('page_snapshot_missing'));

  console.log('visual-briefing-semantic-service.test.js: ok');
}

run();
