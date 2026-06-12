const VISUAL_GRAMMAR_CONTRACT_VERSION = 'visual-grammar-contract-v1';

const VISUAL_GRAMMAR_CONTRACTS = Object.freeze({
  'consumer-product-mosaic': Object.freeze({
    id: 'consumer-product-mosaic',
    label: 'produto premium com mosaico comercial',
    family: 'commerce',
    signature: 'hero com mosaico de produto, barra de benefícios, grade de modelos, prova social e oferta final',
    header: 'commerce-nav-with-dual-cta',
    hero: 'product-mosaic',
    sectionRhythm: 'benefit-strip_product-cards_sustainability-band_offer-stack',
    modules: [
      'hero.product-mosaic',
      'benefit.icon-strip',
      'commerce.product-cards',
      'comparison.two-column',
      'impact.sustainability-band',
      'proof.testimonial-row',
      'conversion.offer-form',
    ],
    density: 'retail-rich',
    visualIntent: 'premium, claro, tangível e orientado à compra',
  }),
  'technical-b2b-systems': Object.freeze({
    id: 'technical-b2b-systems',
    label: 'site técnico B2B com matriz operacional',
    family: 'b2b-technical',
    signature: 'hero técnico escuro, trilha de métricas, matriz de soluções, calculadora e projetos profundos',
    header: 'split-nav-quote-cta',
    hero: 'technical-command-split',
    sectionRhythm: 'metric-rail_solution-matrix_estimator-band_project-ledger_process-timeline',
    modules: [
      'hero.technical-command-split',
      'metrics.rail',
      'services.solution-matrix',
      'calculator.estimator-band',
      'portfolio.project-ledger',
      'process.timeline',
      'lead.contact-panel',
    ],
    density: 'operational-rich',
    visualIntent: 'preciso, corporativo, arquitetônico e orientado a orçamento',
  }),
  'wine-sensory-cellar': Object.freeze({
    id: 'wine-sensory-cellar',
    label: 'vinhos premium com narrativa sensorial',
    family: 'sensory-commerce',
    signature: 'hero de vinhedo/adega, narrativa de origem, kit de rótulos, harmonização, oferta e captura VIP',
    header: 'cellar-commerce-nav',
    hero: 'vineyard-cellar-split',
    sectionRhythm: 'origin_story_wine_labels_harmonization_offer_lead_form_faq',
    modules: [
      'hero.vineyard-cellar-split',
      'story.origin-cellar',
      'commerce.wine-label-cards',
      'experience.tasting-notes',
      'pairing.harmonization-grid',
      'conversion.offer-panel',
      'lead.vip-form',
    ],
    density: 'sensory-rich',
    visualIntent: 'sofisticado, acolhedor, artesanal, premium e orientado a degustação',
  }),
  'construction-retail-yard': Object.freeze({
    id: 'construction-retail-yard',
    label: 'loja de materiais com pátio comercial',
    family: 'retail-technical',
    signature: 'hero de depósito/loja, categorias de materiais, serviços, orçamento por lista, entrega e contato',
    header: 'store-quote-nav',
    hero: 'retail-yard-command',
    sectionRhythm: 'category_aisles_services_budget_form_delivery_proof_contact',
    modules: [
      'hero.retail-yard-command',
      'catalog.material-category-aisles',
      'services.delivery-retail-grid',
      'calculator.budget-list-panel',
      'process.order-delivery-steps',
      'lead.quote-contact-form',
    ],
    density: 'retail-operational-rich',
    visualIntent: 'direto, comercial, confiável, organizado e focado em orçamento de obra',
  }),
  'editorial-portfolio-statement': Object.freeze({
    id: 'editorial-portfolio-statement',
    label: 'portfolio editorial de autoridade',
    family: 'portfolio',
    signature: 'statement hero, galeria assimétrica, processo editorial e contato enxuto',
    header: 'portfolio-minimal',
    hero: 'statement-grid',
    sectionRhythm: 'statement_gallery_process_contact',
    modules: ['hero.statement-grid', 'gallery.asymmetric', 'process.editorial', 'lead.minimal-contact'],
    density: 'editorial-airy',
    visualIntent: 'autoral, espaçado e visualmente seletivo',
  }),
  'atelier-catalog-studio': Object.freeze({
    id: 'atelier-catalog-studio',
    label: 'atelier catálogo artesanal',
    family: 'atelier',
    signature: 'hero de atelier, catálogo por coleção, bloco material e cuidados',
    header: 'atelier-minimal',
    hero: 'atelier-showcase',
    sectionRhythm: 'collection_material_process_care_contact',
    modules: ['hero.atelier-showcase', 'catalog.collection-grid', 'story.material-band', 'process.craft-cards', 'faq.care'],
    density: 'craft-catalog',
    visualIntent: 'manual, tátil e comercial sem cara de SaaS',
  }),
  'sensory-immersive-story': Object.freeze({
    id: 'sensory-immersive-story',
    label: 'história sensorial imersiva',
    family: 'sensory',
    signature: 'hero full-bleed, vídeo/imagem imersiva, cards sensoriais e CTA forte',
    header: 'transparent-media-nav',
    hero: 'full-bleed-media',
    sectionRhythm: 'immersive_story_features_media_products_cta',
    modules: ['hero.full-bleed-media', 'story.sensory-copy', 'media.feature-film', 'commerce.highlight-cards'],
    density: 'immersive',
    visualIntent: 'emocional, atmosférico e orientado a desejo',
  }),
  'agri-commercial-system': Object.freeze({
    id: 'agri-commercial-system',
    label: 'sistema agro/jardinagem comercial',
    family: 'agri-b2b',
    signature: 'hero comercial, soluções práticas, catálogo/galeria, prova de operação e formulário de lead',
    header: 'sticky-simple',
    hero: 'technical-field-split',
    sectionRhythm: 'services_products_gallery_method_blog_testimonials_faq_form',
    modules: ['hero.field-split', 'services.technical-grid', 'catalog.practical-cards', 'gallery.operational', 'stats.operational', 'lead.quote-form'],
    density: 'commercial-practical',
    visualIntent: 'claro, produtivo e focado em lead qualificado',
  }),
  'trade-logistics-command': Object.freeze({
    id: 'trade-logistics-command',
    label: 'comando de importacao e logistica',
    family: 'trade-services',
    signature: 'hero escuro de operacao, checklist de importacao, matriz de servicos, processo e formulario qualificado',
    header: 'trade-command-nav',
    hero: 'operations-command-center',
    sectionRhythm: 'service_matrix_import_types_differentials_operations_process_guides_quote_form',
    modules: ['hero.operations-command-center', 'services.trade-matrix', 'catalog.import-types', 'process.customs-timeline', 'lead.qualified-quote-form'],
    density: 'logistics-rich',
    visualIntent: 'seguro, internacional, operacional e orientado a cotacao',
  }),
  'saas-tool-workspace': Object.freeze({
    id: 'saas-tool-workspace',
    label: 'workspace SaaS operacional',
    family: 'saas-tool',
    signature: 'hero com produto em dashboard, sidebar simulada, cards de modulo, workflow e captura de demo',
    header: 'product-app-nav',
    hero: 'dashboard-workspace-preview',
    sectionRhythm: 'product_overview_modules_workflow_pricing_proof_demo_form',
    modules: ['hero.dashboard-workspace-preview', 'product.module-grid', 'workflow.pipeline', 'pricing.plan-cards', 'lead.demo-form'],
    density: 'product-ops-rich',
    visualIntent: 'funcional, confiavel, focado em produto e pronto para demonstracao',
  }),
  'editorial-content-hub': Object.freeze({
    id: 'editorial-content-hub',
    label: 'hub editorial de conteudo',
    family: 'editorial-content',
    signature: 'hero de publicacao, destaques editoriais, editorias, artigos, newsletter e prova',
    header: 'publication-nav',
    hero: 'editorial-front-page',
    sectionRhythm: 'featured_story_editorial_sections_article_grid_routine_newsletter',
    modules: ['hero.editorial-front-page', 'content.featured-grid', 'content.topic-grid', 'content.article-ledger', 'lead.newsletter-form'],
    density: 'publication-rich',
    visualIntent: 'editorial, informativo, autoral e orientado a leitura recorrente',
  }),
  'modular-editorial-default': Object.freeze({
    id: 'modular-editorial-default',
    label: 'editorial modular padrão',
    family: 'default',
    signature: 'header, hero editorial, grid de serviços, método, prova e contato',
    header: 'sticky-simple',
    hero: 'editorial-split',
    sectionRhythm: 'services_about_method_testimonials_faq_contact',
    modules: ['hero.editorial-split', 'services.grid', 'about.stats', 'process.cards', 'lead.contact-form'],
    density: 'balanced',
    visualIntent: 'profissional, flexível e neutro',
  }),
});

function readVisualGrammar(id = '') {
  const key = String(id || '').trim();
  return VISUAL_GRAMMAR_CONTRACTS[key] || VISUAL_GRAMMAR_CONTRACTS['modular-editorial-default'];
}

function resolveVisualGrammarId({ domain = '', recipeId = '', layoutVariant = '' } = {}) {
  if (domain === 'sustainable-product-landing' || recipeId === 'consumer-product-catalog-landing') {
    return 'consumer-product-mosaic';
  }
  if (domain === 'technical-b2b-services-site' || recipeId === 'technical-b2b-lead-site') {
    return 'technical-b2b-systems';
  }
  if (domain === 'premium-wine-landing' || recipeId === 'wine-sensory-landing') return 'wine-sensory-cellar';
  if (domain === 'construction-materials-site' || recipeId === 'construction-materials-store-site') return 'construction-retail-yard';
  if (domain === 'import-services' || recipeId === 'import-service-landing') return 'trade-logistics-command';
  if (domain === 'saas-tool' || recipeId === 'saas-tool-landing') return 'saas-tool-workspace';
  if (domain === 'editorial-content' || recipeId === 'editorial-content-hub') return 'editorial-content-hub';
  if (domain === 'leather-goods' || recipeId === 'artisan-commerce') return 'atelier-catalog-studio';
  if (domain === 'wood-finishes' || recipeId === 'portfolio-gallery' || domain === 'architecture') return 'editorial-portfolio-statement';
  if (domain === 'photo-lab' || recipeId === 'photographic-lab-site') return 'sensory-immersive-story';
  if (domain === 'greenhouses' || domain === 'gardening' || recipeId === 'agri-commercial-landing' || recipeId === 'garden-service-commerce') return 'agri-commercial-system';
  if (domain === 'chocolate' || layoutVariant === 'full_bleed_media' || recipeId === 'sensory-chocolate-landing' || recipeId === 'immersive-story') {
    return 'sensory-immersive-story';
  }
  return 'modular-editorial-default';
}

function resolveBlueprintVisualGrammar(options = {}) {
  return readVisualGrammar(resolveVisualGrammarId(options));
}

module.exports = {
  VISUAL_GRAMMAR_CONTRACT_VERSION,
  VISUAL_GRAMMAR_CONTRACTS,
  readVisualGrammar,
  resolveBlueprintVisualGrammar,
  resolveVisualGrammarId,
};
