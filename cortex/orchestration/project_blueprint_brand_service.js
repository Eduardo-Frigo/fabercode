const { inferExplicitBrand } = require('./briefing_spec_service');
const { normalizeBlueprintText } = require('./project_blueprint_utils');

function inferExplicitBrandFromSource(normalized = '') {
  if (/\bhelena duarte\b/.test(normalized)) return 'Helena Duarte Arquitetura';
  return '';
}

function inferBlueprintBrand(source = '', contract = null) {
  const normalized = normalizeBlueprintText(source);
  const explicitBrand = inferExplicitBrand(source) || inferExplicitBrandFromSource(normalized);
  if (explicitBrand) return explicitBrand;
  if (contract && contract.brandFallback) return contract.brandFallback;
  if (/\bgarrafas? de vidro\b|\bvidro reutilizavel\b|\bvidro reutilizável\b|\blivre de bpa\b/.test(normalized)) return 'Marca de Produto Sustentável';
  if (/\besquadrias? de aluminio\b|\besquadrias? de alumínio\b|\bfachadas? em acm\b|\bpele de vidro\b/.test(normalized)) return 'Empresa Técnica B2B';
  if (/\bvinhos? artesanais?\b|\bvin[ií]cola\b|\bkit degusta[cç][aã]o\b|\bterroir\b|\br[oó]tulos?\b/.test(normalized)) return 'Vinícola Boutique';
  if (/\bmateriais? de constru[cç][aã]o\b|\bloja de materiais\b|\bcimento\b|\bargamassa\b|\blista de materiais\b/.test(normalized)) return 'Loja de Materiais de Construção';
  if (/\bpropriedade intelectual\b|\bpatentes?\b|\bdesenhos? industriais?\b|\bbusca de anterioridade\b|\binpi\b/.test(normalized)) return 'Escritório de Propriedade Intelectual';
  if (/\blinea bosco\b|\bpisos? de madeira\b|\bpaineis? ripados?\b|\bdecks?\b|\brevestimentos? naturais?\b|\bmadeira natural\b/.test(normalized)) return 'Estúdio de Revestimentos Naturais';
  if (/\badvocacia\b|\badvogad[oa]s?\b|\bjuridic[oa]\b|\bdireito\b/.test(normalized)) return 'Escritório Faber Advocacia';
  if (/\bveterin/.test(normalized)) return 'Clínica Faber Vet';
  if (/\bimporta[cç][aã]o\b|\bcomercio exterior\b|\blogistica internacional\b|\bdesembaraco aduaneiro\b/.test(normalized)) return 'ImportaPro Consultoria';
  if (/\blaborat[oó]rio fotogr[aá]fico\b|\blaborat[oó]rio de revela[cç][aã]o\b|\brevela[cç][aã]o de filmes?\b|\bdigitaliza[cç][aã]o de negativos?\b|\bimpress[aã]o fine art\b|\brestaura[cç][aã]o fotogr[aá]fica\b/.test(normalized)) return 'Laboratório Fotográfico';
  if (/\bestufas?\b|\bgreenhouses?\b|\bcultivo protegido\b|\bviveiros?\b|\bhortas? comerciais?\b|\bprodutor rural\b|\bagricultura\b/.test(normalized)) return 'Estufas Protegidas';
  if (/\bbaleias?\b|\bjubartes?\b|\bhumpback\b|\bwhales?\b|\boceano\b/.test(normalized)) return 'Jubarte Azul';
  if (/\b(chocolates?|cacau|cacao|bombons?|chocolateria|tabletes?|trufas?|ganache|temperagem|bean to bar)\b/.test(normalized)) return 'Maison Cacao';
  if (/\bjardinagem\b|\bjardins?\b|\bpaisagismo\b|\bcuidados com plantas\b|\bjardins? verticais?\b/.test(normalized)) return 'Jardim Vivo';
  if (/\besculturas? em madeira\b|\bescultor(?:a)? em madeira\b|\barte em madeira\b|\bmadeira bruta\b|\btalha manual\b|\bateli[eê] de escultura\b/.test(normalized)) return 'Ateliê Madeira Viva';
  if (/\bcouro\b|\bcouros\b|\bartefatos? de couro\b|\bmarroquinaria\b|\bbolsas?\b|\bpastas?\b|\bcarteiras?\b/.test(normalized)) return 'Atelier Couro Faber';
  if (/\bfotograf/.test(normalized)) return 'Estúdio Aurora';
  if (/\bodonto|dent/.test(normalized)) return 'Clínica Sorriso';
  if (/\barquit/.test(normalized)) return 'Studio Habitat';
  return 'Faber Projeto';
}

module.exports = {
  inferBlueprintBrand,
  inferExplicitBrandFromSource,
};
