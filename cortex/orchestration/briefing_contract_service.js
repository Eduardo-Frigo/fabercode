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

const DOMAIN_PROFILES = {
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
    id: 'photography',
    patterns: [
      /\bfotograf/,
      /\bensaio\b/,
      /\bcasamento\b/,
      /\bevento\b/,
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
      /\bartesanal\b/,
      /\bartesa[oa]\b/,
      /\bfeito a mao\b/,
      /\blongevidade\b/,
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
  const normalized = normalizeBriefingContractText(value);
  if (!normalized) return '';
  const match = DOMAIN_DETECTORS.find((entry) => entry.patterns.some((pattern) => pattern.test(normalized)));
  return match ? match.id : '';
}

function inferStackFromText(value = '') {
  const normalized = normalizeBriefingContractText(value);
  if (!normalized) return '';
  if (/\b(lamp|php|mysql)\b/.test(normalized)) return 'lamp';
  if (/\bnext(\.js|js)?\b/.test(normalized) && /\btailwind\b/.test(normalized)) return 'next-tailwind';
  if (/\bnext(\.js|js)?\b/.test(normalized)) return 'next';
  if (/\breact\b/.test(normalized) && /\btailwind\b/.test(normalized)) return 'next-tailwind';
  if (/\breact\b/.test(normalized)) return 'react';
  if (/\b(static-web|static web|site estatico|pagina estatica|html css|html\/css|html, css|html e css|vanilla)\b/.test(normalized)) return 'static-web';
  if (/\bhtml\b|\bcss\b|\bjavascript\b|\bjs\b/.test(normalized)) return 'static-web';
  return '';
}

function inferBriefingContract({
  userMessage = '',
  contextText = '',
  workGraph = null,
  acceptanceCriteria = [],
} = {}) {
  const directSource = String(userMessage || '');
  const fullSource = buildBriefingContractContextText({
    userMessage,
    contextText,
    workGraph,
    acceptanceCriteria,
  });
  const directDomain = inferDomainFromText(directSource);
  const contextualDomain = inferDomainFromText(fullSource);
  const directStack = inferStackFromText(directSource);
  const contextualStack = inferStackFromText(fullSource);
  const domain = directDomain || contextualDomain;
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
    directStack,
    contextualStack,
  };
}

function getBriefingDomainProfile(domain = '') {
  return DOMAIN_PROFILES[String(domain || '').trim()] || null;
}

function countTermHits(normalized, terms = []) {
  return terms.filter((term) => normalized.includes(normalizeBriefingContractText(term)));
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
