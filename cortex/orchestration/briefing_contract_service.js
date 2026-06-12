const {
  findContractTermHits,
  resolveBriefingDomainFromScores,
  scoreBriefingDomainCandidates,
} = require('./briefing_contract_scoring_service');

function normalizeBriefingContractText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildBriefingContractContextText({
  userMessage = '',
  contextText = '',
  workGraph = null,
  acceptanceCriteria = [],
} = {}) {
  const parts = [userMessage, contextText];
  if (workGraph && typeof workGraph === 'object') {
    parts.push(workGraph.brief || '');
    if (workGraph.briefSpec) {
      try {
        parts.push(JSON.stringify(workGraph.briefSpec));
      } catch {
        parts.push(String(workGraph.briefSpec || ''));
      }
    }
    if (Array.isArray(workGraph.acceptanceCriteria)) {
      parts.push(workGraph.acceptanceCriteria.join(' '));
    }
  }
  if (Array.isArray(acceptanceCriteria)) parts.push(acceptanceCriteria.join(' '));
  return parts.filter(Boolean).join('\n');
}

function buildBriefingContractMemoryText({
  contextText = '',
  workGraph = null,
  acceptanceCriteria = [],
} = {}) {
  return buildBriefingContractContextText({
    userMessage: '',
    contextText,
    workGraph,
    acceptanceCriteria,
  });
}

const DOMAIN_PROFILES = {
  'intellectual-property': {
    id: 'intellectual-property',
    label: 'propriedade intelectual',
    brandFallback: 'Escritório de Propriedade Intelectual',
    positiveTerms: [
      'propriedade intelectual',
      'direito de propriedade intelectual',
      'propriedade industrial',
      'patente',
      'patentes',
      'registro de patente',
      'registro de patentes',
      'marcas e patentes',
      'registro de marcas',
      'desenho industrial',
      'desenhos industriais',
      'modelo de utilidade',
      'modelos de utilidade',
      'busca de anterioridade',
      'direito autoral',
      'direitos autorais',
      'contrato de tecnologia',
      'contratos de tecnologia',
      'protecao de software',
      'proteção de software',
      'inpi',
      'deposito do pedido',
      'depósito do pedido',
      'ativos intelectuais',
      'protecao internacional',
      'proteção internacional',
      'pct',
      'tratado',
      'invenção',
      'invencao',
    ],
    negativeTerms: [
      'studio habitat',
      'helena duarte arquitetura',
      'arquitetura contemporanea',
      'escritorio faber advocacia',
      'clinica sorriso',
      'dentista',
      'odontologia',
      'veterinario',
      'veterinaria',
      'pet',
      'linea bosco',
      'pisos de madeira',
      'paineis ripados',
      'painéis ripados',
      'decks',
      'chocolate',
      'jardinagem',
    ],
    guidance:
      'Preserve o domínio de propriedade intelectual: patentes, marcas, desenhos industriais, busca de anterioridade, INPI, estratégia nacional/internacional e proteção de ativos intelectuais.',
  },
  'sustainable-product-landing': {
    id: 'sustainable-product-landing',
    label: 'produto sustentável com catálogo',
    brandFallback: 'Marca de Produto Sustentável',
    positiveTerms: [
      'garrafa de vidro',
      'garrafas de vidro',
      'garrafas reutilizaveis',
      'garrafas reutilizáveis',
      'vidro reutilizavel',
      'vidro reutilizável',
      'livre de bpa',
      'bpa',
      'hidratação',
      'hidratacao',
      'sustentavel',
      'sustentável',
      'plastico descartavel',
      'plástico descartável',
      'sabor puro',
      'vidro premium',
      'garrafa classica',
      'garrafa clássica',
      'capa protetora',
    ],
    negativeTerms: [
      'studio habitat',
      'helena duarte arquitetura',
      'atelier couro faber',
      'artefatos de couro',
      'bolsas de couro',
      'escritorio faber advocacia',
      'clínica sorriso',
      'clinica sorriso',
      'linea bosco',
      'pisos de madeira',
      'esquadrias de aluminio',
      'esquadrias de alumínio',
      'fachadas em acm',
    ],
    guidance:
      'Preserve o domínio de produto sustentável com catálogo: atributos técnicos, benefícios, modelos, prova social, sustentabilidade, comparação, garantia, FAQ e CTAs de compra.',
  },
  'technical-b2b-services-site': {
    id: 'technical-b2b-services-site',
    label: 'serviços técnicos B2B multipágina',
    brandFallback: 'Empresa Técnica B2B',
    positiveTerms: [
      'esquadrias de aluminio',
      'esquadrias de alumínio',
      'fachadas em acm',
      'acm',
      'pele de vidro',
      'portas de aluminio',
      'portas de alumínio',
      'janelas de aluminio',
      'janelas de alumínio',
      'guarda-corpos',
      'guarda corpos',
      'brises metalicos',
      'brises metálicos',
      'portoes de aluminio',
      'portões de alumínio',
      'aluminio sob medida',
      'alumínio sob medida',
      'fachadas arquitetonicas',
      'fachadas arquitetônicas',
      'distrito industrial de sorocaba',
      'showroom em campinas',
      'calculadora de orcamento',
      'calculadora de orçamento',
    ],
    negativeTerms: [
      'studio habitat',
      'helena duarte arquitetura',
      'arquitetura contemporanea para espacos com identidade',
      'arquitetura contemporânea para espaços com identidade',
      'atelier couro faber',
      'garrafas de vidro',
      'escritorio faber advocacia',
      'clinica sorriso',
      'clínica sorriso',
      'linea bosco',
      'pisos de madeira',
    ],
    guidance:
      'Preserve o domínio de serviços técnicos B2B multipágina: soluções, projetos, diferenciais técnicos, calculadora de orçamento, blog, contato, captação de leads e rotas profundas.',
  },
  'premium-wine-landing': {
    id: 'premium-wine-landing',
    label: 'vinhos premium e experiência sensorial',
    brandFallback: 'Vinícola Boutique',
    positiveTerms: [
      'vinho',
      'vinhos',
      'vinhos artesanais',
      'vinhos premium',
      'vinhos de pequena producao',
      'vinhos de pequena produção',
      'vinicola',
      'vinícola',
      'vinicola boutique',
      'vinícola boutique',
      'kit degustacao',
      'kit degustação',
      'rotulo',
      'rótulo',
      'rotulos',
      'rótulos',
      'terroir',
      'uvas selecionadas',
      'colheita manual',
      'enologa',
      'enóloga',
      'enologo',
      'enólogo',
      'barrica',
      'barricas',
      'degustacao',
      'degustação',
      'harmonizacao',
      'harmonização',
      'vale serena',
      'tinto seco',
      'vinho branco',
      'vinho rose',
      'vinho rosé',
      'comprar vinho online',
    ],
    negativeTerms: [
      'pisos de madeira',
      'piso de madeira',
      'paineis ripados',
      'painéis ripados',
      'decks',
      'deck de madeira',
      'revestimentos naturais',
      'materiais de construcao',
      'materiais de construção',
      'cimento',
      'argamassa',
      'esquadrias de aluminio',
      'esquadrias de alumínio',
      'fachadas em acm',
      'pele de vidro',
      'garrafas de vidro',
      'bpa',
      'chocolate',
      'couro',
    ],
    guidance:
      'Preserve o domínio de vinhos premium: vinícola, terroir, rótulos, kit degustação, harmonização, experiência sensorial, oferta, prova social, captura de leads e CTAs de compra.',
  },
  'construction-materials-site': {
    id: 'construction-materials-site',
    label: 'loja de materiais de construção multipágina',
    brandFallback: 'Loja de Materiais de Construção',
    positiveTerms: [
      'materiais de construcao',
      'materiais de construção',
      'loja de materiais',
      'material de obra',
      'cimento',
      'brita',
      'argamassa',
      'tijolo',
      'tijolos',
      'telha',
      'telhas',
      'hidraulica',
      'hidráulica',
      'eletrica',
      'elétrica',
      'tintas',
      'ferramentas',
      'acabamentos',
      'lista de materiais',
      'entrega programada',
      'retirada na loja',
      'orcamento de obra',
      'orçamento de obra',
      'orcamento para obra',
      'orçamento para obra',
      'depósito de construção',
      'deposito de construcao',
      'catalogo de materiais',
      'catálogo de materiais',
    ],
    negativeTerms: [
      'vinho',
      'vinhos',
      'vinicola',
      'vinícola',
      'kit degustacao',
      'kit degustação',
      'terroir',
      'uvas selecionadas',
      'esquadrias de aluminio',
      'esquadrias de alumínio',
      'fachadas em acm',
      'pele de vidro',
      'linea bosco',
      'pisos de madeira',
      'paineis ripados',
      'painéis ripados',
      'garrafas de vidro',
      'couro',
      'chocolate',
    ],
    guidance:
      'Preserve o domínio de materiais de construção: loja, catálogo por categorias, serviços, entrega, retirada, orçamento/lista de materiais, institucional, contato e múltiplas páginas.',
  },
  'saas-tool': {
    id: 'saas-tool',
    label: 'SaaS e ferramenta operacional',
    brandFallback: 'Faber Workspace',
    positiveTerms: [
      'saas',
      'software de gestao',
      'software de gestão',
      'dashboard',
      'painel',
      'workspace operacional',
      'crm',
      'kanban',
      'pipeline',
      'automacao',
      'automação',
      'relatorios',
      'relatórios',
      'login',
      'gestao de usuarios',
      'gestão de usuários',
      'permissoes',
      'permissões',
      'assinatura',
      'planos',
      'demo',
      'onboarding',
    ],
    negativeTerms: [
      'garrafas de vidro',
      'esquadrias de aluminio',
      'esquadrias de alumínio',
      'jardinagem',
      'estufas',
      'chocolate',
      'arquitetura',
      'importacao',
      'importação',
    ],
    guidance:
      'Preserve o domínio de SaaS/ferramenta: produto, dashboard, módulos, workflow, automações, planos, prova, FAQ, captura de demo e experiência operacional completa.',
  },
  legal: {
    id: 'legal',
    label: 'advocacia',
    brandFallback: 'Escritório Faber Advocacia',
    positiveTerms: [
      'advocacia',
      'advogado',
      'advogada',
      'juridico',
      'juridica',
      'direito',
      'contrato',
      'contratos',
      'consultoria juridica',
      'trabalhista',
      'civel',
      'civil',
      'familia',
      'empresarial',
    ],
    negativeTerms: [
      'clinica sorriso',
      'dentista',
      'odontologia',
      'odontologico',
      'sorriso',
      'veterinario',
      'veterinaria',
      'pet',
      'vacina',
      'banho',
      'tosa',
    ],
    guidance:
      'Preserve o domínio jurídico: advocacia, direito, atendimento jurídico, áreas de atuação, contratos e consulta.',
  },
  dental: {
    id: 'dental',
    label: 'odontologia',
    brandFallback: 'Clínica Sorriso',
    positiveTerms: [
      'dentista',
      'odontologia',
      'odontologico',
      'sorriso',
      'consulta odontologica',
      'tratamento dental',
      'clareamento',
      'implante',
    ],
    negativeTerms: [
      'advocacia',
      'advogado',
      'advogada',
      'juridico',
      'direito',
      'veterinario',
      'veterinaria',
      'pet',
      'vacina',
    ],
    guidance:
      'Preserve o domínio odontológico: dentista, consulta odontológica, tratamentos, sorriso e agendamento.',
  },
  veterinary: {
    id: 'veterinary',
    label: 'veterinário',
    brandFallback: 'Clínica Faber Vet',
    positiveTerms: [
      'veterinario',
      'veterinaria',
      'pet',
      'animal',
      'clinica vet',
      'consulta veterinaria',
      'vacina',
      'cuidado animal',
      'banho',
      'tosa',
    ],
    negativeTerms: [
      'advocacia',
      'advogado',
      'advogada',
      'juridico',
      'direito',
      'dentista',
      'odontologia',
      'clinica sorriso',
    ],
    guidance:
      'Preserve o domínio veterinário: clínica, pets, consultas, vacinas, cuidado animal e agendamento.',
  },
  architecture: {
    id: 'architecture',
    label: 'arquitetura',
    brandFallback: 'Studio Habitat',
    positiveTerms: [
      'arquitetura',
      'arquiteto',
      'arquiteta',
      'projeto arquitetonico',
      'interiores',
      'obra',
      'portfolio',
    ],
    negativeTerms: [
      'advocacia',
      'dentista',
      'odontologia',
      'veterinario',
      'pet',
    ],
    guidance:
      'Preserve o domínio de arquitetura: projetos, interiores, portfólio, obra e atendimento consultivo.',
  },
  'import-services': {
    id: 'import-services',
    label: 'importação',
    brandFallback: 'ImportaPro Consultoria',
    positiveTerms: [
      'importacao',
      'importar',
      'comercio exterior',
      'logistica internacional',
      'desembaraco aduaneiro',
      'cotacao de importacao',
      'fornecedor internacional',
      'fornecedores internacionais',
      'alfandega',
      'aduaneiro',
      'produto que deseja importar',
    ],
    negativeTerms: [
      'advocacia',
      'dentista',
      'odontologia',
      'veterinario',
      'arquitetura',
      'arquiteta',
      'interiores',
    ],
    guidance:
      'Preserve o domínio de importação: fornecedores internacionais, custos, impostos, documentação, logística, desembaraço, cotação e formulário qualificado.',
  },
  'editorial-content': {
    id: 'editorial-content',
    label: 'conteúdo editorial',
    brandFallback: 'Revista Faber',
    positiveTerms: [
      'conteudo editorial',
      'conteúdo editorial',
      'revista',
      'magazine',
      'publicacao',
      'publicação',
      'portal de conteudo',
      'portal de conteúdo',
      'blog editorial',
      'newsletter',
      'artigos',
      'editorias',
      'colunas editoriais',
      'materias',
      'matérias',
      'reportagens',
      'guias',
      'leitura',
      'assinantes',
    ],
    negativeTerms: [
      'dashboard',
      'saas',
      'crm',
      'esquadrias',
      'importacao',
      'importação',
      'garrafas de vidro',
      'estufas',
      'jardinagem',
    ],
    guidance:
      'Preserve o domínio de conteúdo editorial: publicação, editorias, artigos, destaques, rotina editorial, newsletter, prova, FAQ e leitura recorrente.',
  },
  'photo-lab': {
    id: 'photo-lab',
    label: 'laboratório fotográfico',
    brandFallback: 'Laboratório Fotográfico',
    positiveTerms: [
      'laboratorio fotografico',
      'laboratório fotográfico',
      'lab fotografico',
      'lab fotográfico',
      'laboratorio de revelacao',
      'laboratório de revelação',
      'revelacao de filmes',
      'revelação de filmes',
      'revelacao c-41',
      'revelação c-41',
      'preto e branco',
      'digitalizacao profissional',
      'digitalização profissional',
      'digitalizacao de negativos',
      'digitalização de negativos',
      'negativos',
      'slides',
      'impressao fine art',
      'impressão fine art',
      'impressao pigmentada',
      'impressão pigmentada',
      'papel fotografico',
      'papel fotográfico',
      'restauracao fotografica',
      'restauração fotográfica',
      'restauracao de fotos',
      'restauração de fotos',
      'ampliacoes fotograficas',
      'ampliações fotográficas',
      'darkroom',
      'luz vermelha',
      'filme fotografico',
      'filme fotográfico',
      'fotografia analogica',
      'fotografia analógica',
    ],
    negativeTerms: [
      'escultura em madeira',
      'talha manual',
      'madeira bruta',
      'pisos de madeira',
      'painéis ripados',
      'paineis ripados',
      'esquadrias de aluminio',
      'esquadrias de alumínio',
      'materiais de construcao',
      'materiais de construção',
      'chocolate',
      'cacau',
      'estufas',
      'jardinagem',
      'importacao',
      'importação',
      'advocacia',
      'dentista',
      'odontologia',
    ],
    guidance:
      'Preserve o domínio de laboratório fotográfico: revelação, digitalização, impressão fine art, restauração, ampliação, portfólio visual, processo técnico, envio de arquivos/filmes e orçamento.',
  },
  photography: {
    id: 'photography',
    label: 'fotografia',
    brandFallback: 'Estúdio Aurora',
    positiveTerms: [
      'fotografia',
      'fotografo',
      'fotografa',
      'ensaio',
      'portfolio',
      'casamento',
      'evento',
    ],
    negativeTerms: [
      'advocacia',
      'dentista',
      'odontologia',
      'veterinario',
      'pet',
    ],
    guidance:
      'Preserve o domínio de fotografia: portfólio, ensaios, eventos, agenda e estilo visual.',
  },
  chocolate: {
    id: 'chocolate',
    label: 'chocolate artesanal',
    brandFallback: 'Maison Cacao',
    positiveTerms: [
      'chocolate',
      'chocolates',
      'cacau',
      'cacao',
      'bombom',
      'bombons',
      'chocolateria',
      'tablete',
      'tabletes',
      'trufa',
      'trufas',
      'ganache',
      'temperagem',
      'avelas',
      'artesanal',
      'premium',
      'sensorial',
      'do grao ao tablete',
      'maison cacao',
      'essencia do cacau',
    ],
    negativeTerms: [
      'couro',
      'bolsa',
      'bolsas',
      'pasta',
      'pastas',
      'carteira',
      'carteiras',
      'artefatos de couro',
      'atelier couro',
      'marroquinaria',
      'clinica sorriso',
      'dentista',
      'odontologia',
      'estufa',
      'estufas',
      'greenhouse',
      'imoveis',
      'imobiliaria',
    ],
    guidance:
      'Preserve o domínio de chocolate artesanal: cacau, chocolates, bombons, sabores, processo do grão ao tablete, experiência sensorial e CTA de compra.',
  },
  gardening: {
    id: 'gardening',
    label: 'jardinagem',
    brandFallback: 'Jardim Vivo',
    positiveTerms: [
      'jardinagem',
      'jardim',
      'jardins',
      'paisagismo',
      'plantas',
      'plantas internas',
      'plantas para apartamento',
      'horta caseira',
      'hortas caseiras',
      'jardim vertical',
      'jardins verticais',
      'vasos',
      'substratos',
      'fertilizantes',
      'sementes',
      'poda',
      'controle de pragas',
      'manutencao de jardim',
      'loja de jardinagem',
      'cuidados com plantas',
      'decoracao natural',
    ],
    negativeTerms: [
      'estufa agricola',
      'estufas agricolas',
      'greenhouse',
      'greenhouses',
      'cultivo protegido',
      'produtor rural',
      'controle climatico',
      'estrutura resistente',
      'arquitetura',
      'escultura em madeira',
    ],
    guidance:
      'Preserve o domínio de jardinagem: plantas, jardins, paisagismo, serviços de manutenção, produtos de jardinagem, blog educativo, galeria e contato.',
  },
  'wood-finishes': {
    id: 'wood-finishes',
    label: 'revestimentos de madeira',
    brandFallback: 'Estúdio de Revestimentos Naturais',
    positiveTerms: [
      'linea bosco',
      'revestimentos',
      'revestimentos naturais',
      'pisos de madeira',
      'piso de madeira',
      'painel ripado',
      'paineis ripados',
      'painéis ripados',
      'decks',
      'deck de madeira',
      'areas externas',
      'áreas externas',
      'madeira natural',
      'acabamentos arquitetonicos',
      'acabamentos arquitetônicos',
      'acabamentos naturais',
      'rodapes de madeira',
      'rodapés de madeira',
      'revestimento de parede',
      'paginações',
      'paginacoes',
      'chevron',
      'espinha de peixe',
      'carvalho',
      'nogueira',
      'cumaru',
      'freijo',
      'freijó',
      'tauari',
      'ipe',
      'ipê',
    ],
    negativeTerms: [
      'studio habitat',
      'helena duarte arquitetura',
      'arquitetura contemporanea para espacos com identidade',
      'arquitetura contemporânea para espaços com identidade',
      'escritorio faber advocacia',
      'propriedade intelectual',
      'patente',
      'patentes',
      'inpi',
      'advocacia',
      'clinica sorriso',
      'dentista',
      'odontologia',
      'chocolate',
      'cacau',
      'vinho',
      'vinhos',
      'vinicola',
      'vinícola',
      'terroir',
      'uvas selecionadas',
      'kit degustacao',
      'kit degustação',
      'degustacao',
      'degustação',
      'harmonizacao',
      'harmonização',
      'materiais de construcao',
      'materiais de construção',
      'cimento',
      'argamassa',
      'estufas agricolas',
      'cultivo protegido',
    ],
    guidance:
      'Preserve o domínio de revestimentos de madeira: pisos, painéis ripados, decks, texturas, paginações, projetos de alto padrão, atendimento para arquitetos e orçamento.',
  },
  'wood-sculpture': {
    id: 'wood-sculpture',
    label: 'escultura em madeira',
    brandFallback: 'Ateliê Madeira Viva',
    positiveTerms: [
      'escultura em madeira',
      'esculturas em madeira',
      'escultor em madeira',
      'escultor',
      'escultora',
      'escultura',
      'esculturas',
      'madeira',
      'madeira bruta',
      'talha',
      'talhado',
      'tallado',
      'entalhe',
      'veios',
      'textura da madeira',
      'ateliê',
      'atelie',
      'artista',
      'obras',
      'obras sob encomenda',
      'galeria',
      'portfólio',
      'portfolio',
      'lixamento',
      'acabamento',
      'peças únicas',
      'pecas unicas',
    ],
    negativeTerms: [
      'clinica sorriso',
      'dentista',
      'odontologia',
      'estufa',
      'estufas',
      'greenhouse',
      'jardinagem',
      'paisagismo',
      'chocolate',
      'cacau',
      'couro',
      'bolsas',
    ],
    guidance:
      'Preserve o domínio de escultura em madeira: artista/ateliê, peças únicas, madeira, talha manual, processo artesanal, portfólio, encomendas e hero com vídeo quando solicitado.',
  },
  'leather-goods': {
    id: 'leather-goods',
    label: 'artefatos de couro',
    brandFallback: 'Atelier Couro Faber',
    positiveTerms: [
      'couro',
      'bolsa',
      'bolsas',
      'pasta',
      'pastas',
      'artefatos de couro',
      'marroquinaria',
      'artesanal',
      'artesao',
      'artesa',
      'feito a mao',
      'longevidade',
    ],
    negativeTerms: [
      'advocacia',
      'advogado',
      'advogada',
      'juridico',
      'direito',
      'dentista',
      'odontologia',
      'veterinario',
      'pet',
      'software workspace',
      'chocolate',
      'chocolates',
      'cacau',
      'bombons',
      'chocolateria',
    ],
    guidance:
      'Preserve o domínio de artefatos de couro: bolsas, pastas, produção artesanal, matéria-prima, durabilidade e visual de atelier.',
  },
  greenhouses: {
    id: 'greenhouses',
    label: 'estufas agrícolas',
    brandFallback: 'Estufas Protegidas',
    positiveTerms: [
      'estufa',
      'estufas',
      'greenhouse',
      'greenhouses',
      'cultivo protegido',
      'viveiro',
      'viveiros',
      'horta comercial',
      'hortas comerciais',
      'floricultura',
      'floriculturas',
      'produtor rural',
      'agricultor',
      'agricultura',
      'hortalicas',
      'mudas',
      'irrigacao',
      'controle climatico',
    ],
    negativeTerms: [
      'clinica sorriso',
      'dentista',
      'odontologia',
      'odontologico',
      'sorriso',
      'real estate',
      'imoveis',
      'imobiliaria',
      'corretor',
      'interior residencial',
      'professional workspace',
    ],
    guidance:
      'Preserve o domínio de estufas agrícolas: cultivo protegido, produtores rurais, viveiros, hortas comerciais, proteção climática, estrutura resistente e orçamento.',
  },
  'humpback-whales': {
    id: 'humpback-whales',
    label: 'baleias jubarte',
    brandFallback: 'Jubarte Azul',
    positiveTerms: [
      'baleia',
      'baleias',
      'jubarte',
      'jubartes',
      'humpback',
      'whale',
      'whales',
      'oceano',
      'oceanico',
      'marinho',
      'vida marinha',
      'conservacao',
      'observacao',
    ],
    negativeTerms: [
      'advocacia',
      'advogado',
      'advogada',
      'juridico',
      'direito',
      'dentista',
      'odontologia',
      'veterinario',
      'pet',
    ],
    guidance:
      'Preserve o domínio marinho: baleias jubarte, oceano, conservação, pesquisa, observação e educação ambiental.',
  },
};

const DOMAIN_DETECTORS = [
  {
    id: 'intellectual-property',
    patterns: [
      /\bpropriedade intelectual\b/,
      /\bdireito de propriedade intelectual\b/,
      /\bpropriedade industrial\b/,
      /\bregistro de patentes?\b/,
      /\bpatentes?\b/,
      /\bmarcas? e patentes?\b/,
      /\bregistro de marcas\b/,
      /\bdesenhos? industriais?\b/,
      /\bmodelos? de utilidade\b/,
      /\bbusca de anterioridade\b/,
      /\bdireitos? autorais?\b/,
      /\bcontratos? de tecnologia\b/,
      /\bprote[cç][aã]o de software\b/,
      /\binpi\b/,
      /\bativos intelectuais\b/,
      /\bprote[cç][aã]o internacional\b/,
      /\bpct\b/,
    ],
  },
  {
    id: 'sustainable-product-landing',
    patterns: [
      /\bgarrafas? de vidro\b/,
      /\bgarrafas? reutiliz[aá]veis\b/,
      /\bvidro reutiliz[aá]vel\b/,
      /\blivre de bpa\b/,
      /\bsem bpa\b/,
      /\bsabor puro\b/,
      /\bvidro premium\b/,
      /\bpl[aá]stico descart[aá]vel\b/,
      /\bhidrata[cç][aã]o consciente\b/,
      /\bgarrafa cl[aá]ssica\b/,
      /\bcapa protetora\b/,
    ],
  },
  {
    id: 'technical-b2b-services-site',
    patterns: [
      /\besquadrias? de alum[ií]nio\b/,
      /\bfachadas? em acm\b/,
      /\bpele de vidro\b/,
      /\bportas? de alum[ií]nio\b/,
      /\bjanelas? de alum[ií]nio\b/,
      /\bguarda[-\s]?corpos?\b/,
      /\bbrises? met[aá]licos?\b/,
      /\bport[oõ]es? de alum[ií]nio\b/,
      /\balum[ií]nio sob medida\b/,
      /\bfachadas? arquitet[oô]nicas?\b/,
      /\bdistrito industrial de sorocaba\b/,
      /\bshowroom em campinas\b/,
      /\bcalculadora de or[cç]amento\b/,
    ],
  },
  {
    id: 'premium-wine-landing',
    patterns: [
      /\bvinhos? artesanais?\b/,
      /\bvinhos? premium\b/,
      /\bvinhos? de pequena produ[cç][aã]o\b/,
      /\bvin[ií]cola\b/,
      /\bvin[ií]cola boutique\b/,
      /\bkit degusta[cç][aã]o\b/,
      /\br[oó]tulos?\b/,
      /\bterroir\b/,
      /\buvas? selecionadas?\b/,
      /\bcolheita manual\b/,
      /\ben[oó]log[ao]\b/,
      /\bbarricas?\b/,
      /\bdegusta[cç][aã]o\b/,
      /\bharmoniza[cç][aã]o\b/,
      /\btinto seco\b/,
      /\bvinho branco\b/,
      /\bvinho ros[eé]\b/,
      /\bcomprar vinho online\b/,
    ],
  },
  {
    id: 'construction-materials-site',
    patterns: [
      /\bmateriais? de constru[cç][aã]o\b/,
      /\bloja de materiais\b/,
      /\bmaterial de obra\b/,
      /\bcimento\b/,
      /\bbrita\b/,
      /\bargamassa\b/,
      /\bblocos?\s+(?:de\s+)?(?:concreto|ceramicos?|cerâmicos?|vedacao|vedação|estruturais?|alvenaria)\b/,
      /\b(?:tijolos?|telhas?)\s+e\s+blocos?\b/,
      /\btijolos?\b/,
      /\btelhas?\b/,
      /\bhidr[aá]ulica\b/,
      /\bel[eé]trica\b/,
      /\blista de materiais\b/,
      /\bentrega programada\b/,
      /\bretirada na loja\b/,
      /\bor[cç]amento de obra\b/,
      /\bor[cç]amento para obra\b/,
      /\bdep[oó]sito de constru[cç][aã]o\b/,
      /\bcat[aá]logo de materiais\b/,
    ],
  },
  {
    id: 'wood-finishes',
    patterns: [
      /\blinea bosco\b/,
      /\brevestimentos? naturais?\b/,
      /\brevestimentos? de madeira\b/,
      /\bpisos? de madeira\b/,
      /\bpaineis? ripados?\b/,
      /\bpain[eé]is? ripados?\b/,
      /\bdecks?\b/,
      /\bdecks? de madeira\b/,
      /\bmadeira natural\b/,
      /\bacabamentos? arquitet[oô]nicos?\b/,
      /\brodap[eé]s?\s+(?:de\s+)?(?:madeira|naturais?|arquitet[oô]nicos?)\b/,
      /\bpaginac[oõ]es\b/,
      /\bchevron\b/,
      /\bespinha de peixe\b/,
      /\bcarvalho\b/,
      /\bnogueira\b/,
      /\bcumaru\b/,
      /\bfreij[oó]\b/,
      /\btauari\b/,
      /\bip[eê]\b/,
    ],
  },
  {
    id: 'saas-tool',
    patterns: [
      /\bsaas\b/,
      /\bsoftware de gest[aã]o\b/,
      /\bdashboard\b/,
      /\bpainel\b/,
      /\bworkspace operacional\b/,
      /\bcrm\b/,
      /\bkanban\b/,
      /\bpipeline\b/,
      /\bautoma[cç][aã]o\b/,
      /\brelat[oó]rios?\b/,
      /\blogin\b/,
      /\bgest[aã]o de usu[aá]rios?\b/,
      /\bpermiss[oõ]es\b/,
      /\bassinatura\b/,
      /\bplanos\b/,
      /\bdemo\b/,
      /\bonboarding\b/,
    ],
  },
  {
    id: 'editorial-content',
    patterns: [
      /\bconte[uú]do editorial\b/,
      /\brevista\b/,
      /\bmagazine\b/,
      /\bpublica[cç][aã]o\b/,
      /\bportal de conte[uú]do\b/,
      /\bblog editorial\b/,
      /\beditorias?\b/,
      /\bcolunas? editoriais?\b/,
      /\bmat[eé]rias?\b/,
      /\breportagens?\b/,
      /\bassinetes?\b/,
    ],
  },
  {
    id: 'gardening',
    patterns: [
      /\bjardinagem\b/,
      /\bjardins?\b/,
      /\bpaisagismo\b/,
      /\bcuidados com plantas\b/,
      /\bplantas para apartamento\b/,
      /\bplantas internas\b/,
      /\bhortas? caseiras?\b/,
      /\bjardins? verticais?\b/,
      /\bloja de jardinagem\b/,
      /\bmanutencao de jardim\b/,
      /\bdecoracao natural\b/,
    ],
  },
  {
    id: 'wood-sculpture',
    patterns: [
      /\besculturas? em madeira\b/,
      /\bescultor(?:a)? em madeira\b/,
      /\barte em madeira\b/,
      /\bmadeira bruta\b/,
      /\btalha manual\b/,
      /\bentalhe\b/,
      /\bveios da madeira\b/,
      /\bateli[eê] de escultura\b/,
      /\bobras sob encomenda\b/,
    ],
  },
  {
    id: 'greenhouses',
    patterns: [
      /\bestufas?\b/,
      /\bgreenhouses?\b/,
      /\bcultivo protegido\b/,
      /\bviveiros?\b/,
      /\bhortas? comerciais?\b/,
      /\bfloriculturas?\b/,
      /\bprodutor rural\b/,
      /\bagricultor(?:es)?\b/,
      /\bagricultura\b/,
      /\bhortalicas?\b/,
      /\bmudas?\b/,
      /\birrigacao\b/,
      /\bcontrole climatico\b/,
    ],
  },
  {
    id: 'legal',
    patterns: [
      /\badvocacia\b/,
      /\badvogad[oa]s?\b/,
      /\bjuridic[oa]\b/,
      /\bescritorio de advocacia\b/,
      /\bdireito\b/,
      /\btrabalhista\b/,
      /\bcivel\b/,
      /\bcivil\b/,
    ],
  },
  {
    id: 'dental',
    patterns: [
      /\bodonto/,
      /\bdentista\b/,
      /\bdental\b/,
      /\bclinica sorriso\b/,
      /\bclareamento\b/,
      /\bimplante\b/,
    ],
  },
  {
    id: 'veterinary',
    patterns: [
      /\bveterin/,
      /\bclinica vet/,
      /\bpet\b/,
      /\banimal\b/,
      /\bvacina\b/,
      /\bbanho\b/,
      /\btosa\b/,
    ],
  },
  {
    id: 'architecture',
    patterns: [
      /\barquitet/,
      /\binteriores\b/,
      /\bprojeto arquitetonico\b/,
      /\bobra\b/,
    ],
  },
  {
    id: 'import-services',
    patterns: [
      /\bimporta[cç][aã]o\b/,
      /\bimportar\b/,
      /\bcom[eé]rcio exterior\b/,
      /\blog[ií]stica internacional\b/,
      /\bdesembara[cç]o aduaneiro\b/,
      /\balf[aâ]ndega\b/,
      /\bfornecedor(?:es)? internacional(?:is|ais)?\b/,
      /\bcota[cç][aã]o de importa[cç][aã]o\b/,
    ],
  },
  {
    id: 'photo-lab',
    patterns: [
      /\blaborat[oó]rio fotogr[aá]fico\b/,
      /\blab fotogr[aá]fico\b/,
      /\blaborat[oó]rio de revela[cç][aã]o\b/,
      /\brevela[cç][aã]o de filmes?\b/,
      /\brevela[cç][aã]o c-41\b/,
      /\bdigitaliza[cç][aã]o profissional\b/,
      /\bdigitaliza[cç][aã]o de negativos?\b/,
      /\bimpress[aã]o fine art\b/,
      /\bimpress[aã]o pigmentada\b/,
      /\brestaura[cç][aã]o fotogr[aá]fica\b/,
      /\brestaura[cç][aã]o de fotos?\b/,
      /\bamplia[cç][oõ]es? fotogr[aá]ficas?\b/,
      /\bfilmes? fotogr[aá]ficos?\b/,
      /\bfotografia anal[oó]gica\b/,
      /\bnegativos? digitalizados?\b/,
      /\bdarkroom\b/,
    ],
  },
  {
    id: 'photography',
    patterns: [
      /\bfotograf/,
      /\bensaio\b/,
      /\bcasamento\b/,
      /\bevento\b/,
    ],
  },
  {
    id: 'chocolate',
    patterns: [
      /\bchocolates?\b/,
      /\bcacau\b/,
      /\bcacao\b/,
      /\bbombons?\b/,
      /\bchocolateria\b/,
      /\btabletes?\b/,
      /\btrufas?\b/,
      /\bganache\b/,
      /\btemperagem\b/,
      /\bbean to bar\b/,
    ],
  },
  {
    id: 'leather-goods',
    patterns: [
      /\bcouro\b/,
      /\bcouros\b/,
      /\bartefatos? de couro\b/,
      /\bmarroquinaria\b/,
      /\bbolsas?\b/,
      /\bpastas?\b/,
      /\bcarteiras?\b/,
    ],
  },
  {
    id: 'humpback-whales',
    patterns: [
      /\bbaleias?\b/,
      /\bjubartes?\b/,
      /\bhumpback\b/,
      /\bwhales?\b/,
      /\boceano\b/,
      /\boceanic[oa]\b/,
      /\bvida marinha\b/,
    ],
  },
];

function inferDomainFromText(value = '') {
  const resolution = resolveBriefingDomainFromScores(rankBriefingDomainCandidates(value));
  return resolution.domain || '';
}

function suppressSoftwareArchitectureDomainNoise(value = '') {
  const raw = String(value || '');
  const normalized = normalizeBriefingContractText(raw);
  if (!normalized) return raw;
  const hasSoftwareArchitectureContext =
    /\b(app|aplicacao|aplicação|sistema|software|next|react|tailwind|mcp|scaffold|codigo|código|ferramenta|mrp|erp|crm|ide)\b/.test(
      normalized
    ) &&
    /\barquitetura\b/.test(normalized);
  const hasArchitectureBusinessContext =
    /\b(site de arquitetura|escritorio de arquitetura|escritório de arquitetura|arquiteto|arquiteta|arq\.|interiores|projeto arquitetonico|projeto arquitetônico|obra|portfolio de projetos|portfólio de projetos|residencial|comercial)\b/.test(
      normalized
    );
  if (!hasSoftwareArchitectureContext || hasArchitectureBusinessContext) return raw;
  return raw
    .replace(/\barquitetura\s+(livre|guiada|do sistema|da aplica[cç][aã]o|de software|mcp)\b/gi, 'estrutura tecnica')
    .replace(/\b(software|guided)\s+architecture\b/gi, 'estrutura tecnica')
    .replace(/\barquitetura\b/gi, 'estrutura tecnica');
}

function rankBriefingDomainCandidates(value = '', options = {}) {
  return scoreBriefingDomainCandidates({
    text: suppressSoftwareArchitectureDomainNoise(value),
    domainProfiles: DOMAIN_PROFILES,
    domainDetectors: DOMAIN_DETECTORS,
    stripStaleContext: Boolean(options.stripStaleContext),
  });
}

function buildDomainSourceConflict(directResolution = {}, contextualResolution = {}) {
  if (!directResolution.domain || !contextualResolution.domain || directResolution.domain === contextualResolution.domain) {
    return { hasConflict: false };
  }
  return {
    hasConflict: true,
    type: 'current_vs_context_memory',
    candidates: [directResolution.domain, contextualResolution.domain],
    blocking: false,
    reason: 'current_user_message_overrides_context_memory',
  };
}

function selectBriefingDomainDecision({
  directResolution = {},
  contextualResolution = {},
  mergedResolution = {},
  suppressContextDomain = false,
} = {}) {
  const sourceConflict = buildDomainSourceConflict(directResolution, contextualResolution);
  const directConflict = directResolution.status === 'conflict';
  if (directConflict) {
    return {
      domain: '',
      source: 'conflict',
      status: 'conflict',
      confidence: directResolution.confidence || 0.35,
      fallbackReason: 'domain_conflict_current_user_message',
      blockDomainFallback: true,
      conflict: directResolution.conflict || { hasConflict: true },
      sourceConflict,
    };
  }

  if (directResolution.domain) {
    return {
      domain: directResolution.domain,
      source: 'current_user_message',
      status: directResolution.status || 'accepted',
      confidence: directResolution.confidence || 0.86,
      fallbackReason: '',
      blockDomainFallback: false,
      conflict: directResolution.conflict || { hasConflict: false },
      sourceConflict,
    };
  }

  if (contextualResolution.domain && !suppressContextDomain) {
    return {
      domain: contextualResolution.domain,
      source: 'context_memory',
      status: contextualResolution.status || 'accepted',
      confidence: contextualResolution.confidence || 0.78,
      fallbackReason: '',
      blockDomainFallback: false,
      conflict: contextualResolution.conflict || { hasConflict: false },
      sourceConflict,
    };
  }

  if (mergedResolution.domain && !suppressContextDomain) {
    return {
      domain: mergedResolution.domain,
      source: 'merged_source',
      status: mergedResolution.status || 'accepted',
      confidence: mergedResolution.confidence || 0.72,
      fallbackReason: '',
      blockDomainFallback: false,
      conflict: mergedResolution.conflict || { hasConflict: false },
      sourceConflict,
    };
  }

  const fallbackResolution = directResolution.topCandidate ? directResolution : contextualResolution.topCandidate ? contextualResolution : mergedResolution;
  return {
    domain: '',
    source: '',
    status: fallbackResolution.status || 'no_evidence',
    confidence: fallbackResolution.confidence || 0.1,
    fallbackReason: suppressContextDomain
      ? 'context_domain_suppressed_by_self_contained_brief'
      : (fallbackResolution.fallbackReason || 'no_domain_evidence'),
    blockDomainFallback: false,
    conflict: fallbackResolution.conflict || { hasConflict: false },
    sourceConflict,
  };
}

function inferStackFromText(value = '') {
  const normalized = normalizeBriefingContractText(value);
  if (!normalized) return '';
  if (/\b(lamp|php|mysql)\b/.test(normalized)) return 'lamp';
  if (/\bnext(\.js|js)?\b/.test(normalized) && /\btailwind\b/.test(normalized)) return 'next-tailwind';
  if (/\bnext(\.js|js)?\b/.test(normalized)) return 'next';
  if (/\breact\b/.test(normalized) && /\btailwind\b/.test(normalized)) return 'next-tailwind';
  if (/\breact\b/.test(normalized)) return 'react';
  if (/\b(static-web|static web|site estatico|site estatica|web estatico|web estatica|pagina estatica|pagina estatico|estatico|estatica|html css|html\/css|html, css|html e css|vanilla)\b/.test(normalized)) return 'static-web';
  if (/\bhtml\b|\bcss\b|\bjavascript\b|\bjs\b/.test(normalized)) return 'static-web';
  return '';
}

function isContextContinuationMessage(value = '') {
  const normalized = normalizeBriefingContractText(value);
  if (!normalized) return true;
  return /^(faz|faca|faça|gere|gerar|pode|sim|ok|certo|isso|continue|continua|prossiga|segue|faz com placeholders|faca com placeholders|faz isso|pode seguir)(\s|$)/.test(
    normalized
  ) && normalized.length <= 90;
}

function hasSelfContainedDirectBrief(value = '') {
  const normalized = normalizeBriefingContractText(value);
  if (!normalized) return false;
  const hasBuildSurface = /\b(criar|crie|gerar|gere|montar|monte|site|landing|pagina|web|app)\b/.test(normalized);
  const hasBriefDetails = /\b(hero|header|footer|secao|secoes|seção|seções|paleta|tipografia|video|imagem|produtos|servicos|processo|contato|cta|botao|premium|sensorial|sofisticado|elegante)\b/.test(normalized);
  return normalized.length >= 100 || (hasBuildSurface && hasBriefDetails);
}

function inferBriefingContract({
  userMessage = '',
  contextText = '',
  workGraph = null,
  acceptanceCriteria = [],
} = {}) {
  const directSource = String(userMessage || '');
  const memorySource = buildBriefingContractMemoryText({
    contextText,
    workGraph,
    acceptanceCriteria,
  });
  const fullSource = buildBriefingContractContextText({
    userMessage,
    contextText,
    workGraph,
    acceptanceCriteria,
  });
  const directDomainScores = rankBriefingDomainCandidates(directSource, { stripStaleContext: true });
  const contextualDomainScores = rankBriefingDomainCandidates(memorySource);
  const mergedDomainScores = rankBriefingDomainCandidates(fullSource);
  const directResolution = resolveBriefingDomainFromScores(directDomainScores);
  const contextualResolution = resolveBriefingDomainFromScores(contextualDomainScores);
  const mergedResolution = resolveBriefingDomainFromScores(mergedDomainScores);
  const directDomain = directResolution.domain || '';
  const contextualDomain = contextualResolution.domain || '';
  const mergedDomain = mergedResolution.domain || '';
  const directStack = inferStackFromText(directSource);
  const contextualStack = inferStackFromText(fullSource);
  const suppressContextDomain = Boolean(
    !directDomain &&
      contextualDomain &&
      hasSelfContainedDirectBrief(directSource) &&
      !isContextContinuationMessage(directSource)
  );
  const domainDecision = selectBriefingDomainDecision({
    directResolution,
    contextualResolution,
    mergedResolution,
    suppressContextDomain,
  });
  const domain = domainDecision.domain || '';
  const stack = directStack || contextualStack;
  const profile = domain ? DOMAIN_PROFILES[domain] : null;

  return {
    domain,
    domainLabel: profile ? profile.label : '',
    stack,
    brandFallback: profile ? profile.brandFallback : '',
    hasDomain: Boolean(domain),
    hasStack: Boolean(stack),
    guidance: profile ? profile.guidance : '',
    source: normalizeBriefingContractText(fullSource),
    directDomain,
    contextualDomain,
    mergedDomain,
    directStack,
    contextualStack,
    confidence: domainDecision.confidence,
    fallbackReason: domainDecision.fallbackReason,
    domainDecision: {
      source: domainDecision.source,
      status: domainDecision.status,
      confidence: domainDecision.confidence,
      fallbackReason: domainDecision.fallbackReason,
      blockDomainFallback: domainDecision.blockDomainFallback,
      conflict: domainDecision.conflict,
      sourceConflict: domainDecision.sourceConflict,
      contextSuppressed: suppressContextDomain,
      directScores: directDomainScores.slice(0, 4),
      contextualScores: contextualDomainScores.slice(0, 4),
      mergedScores: mergedDomainScores.slice(0, 4),
    },
  };
}

function getBriefingDomainProfile(domain = '') {
  return DOMAIN_PROFILES[String(domain || '').trim()] || null;
}

function countTermHits(normalized, terms = []) {
  return findContractTermHits(normalized, terms);
}

function evaluateBriefingAdherence({ contract = null, text = '' } = {}) {
  const activeContract = contract && typeof contract === 'object' ? contract : {};
  const profile = getBriefingDomainProfile(activeContract.domain);
  if (!profile) {
    return {
      enabled: false,
      passesMinimum: true,
      positiveHits: [],
      negativeHits: [],
      detail: '',
      hint: '',
      severity: 'info',
    };
  }

  const normalized = normalizeBriefingContractText(text);
  const positiveHits = countTermHits(normalized, profile.positiveTerms);
  const negativeHits = countTermHits(normalized, profile.negativeTerms);
  const minimumPositiveHits = 1;
  const hasPositiveDomain = positiveHits.length >= minimumPositiveHits;
  const hasConflictingDomain = negativeHits.length > 0;
  const passesMinimum = hasPositiveDomain && !hasConflictingDomain;
  const detail = hasConflictingDomain
    ? `Conteúdo conflita com o domínio ${profile.label}: detectou ${negativeHits.slice(0, 4).join(', ')}.`
    : `Conteúdo não demonstrou aderência suficiente ao domínio ${profile.label}.`;

  return {
    enabled: true,
    passesMinimum,
    positiveHits,
    negativeHits,
    hasPositiveDomain,
    hasConflictingDomain,
    severity: hasConflictingDomain ? 'critical' : 'warning',
    detail,
    hint: profile.guidance,
  };
}

function formatBriefingContractForPrompt(contract = {}) {
  const lines = [];
  if (contract.stack) lines.push(`Stack solicitado: ${contract.stack}.`);
  if (contract.domainLabel) lines.push(`Domínio solicitado: ${contract.domainLabel}.`);
  if (contract.guidance) lines.push(contract.guidance);
  return lines.join('\n');
}

module.exports = {
  buildBriefingContractContextText,
  evaluateBriefingAdherence,
  formatBriefingContractForPrompt,
  getBriefingDomainProfile,
  inferBriefingContract,
  inferDomainFromText,
  inferStackFromText,
  normalizeBriefingContractText,
};
