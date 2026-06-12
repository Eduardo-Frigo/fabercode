const {
  inferRequestedPages,
  inferRequestedSections,
} = require('./briefing_spec_service');
const { normalizeBlueprintText } = require('./project_blueprint_utils');

const PROJECT_BLUEPRINT_MANIFEST_VERSION = 'project-blueprint-manifest-v1';

const SECTION_COVERAGE_KEYS = {
  hero: ['hero'],
  cta: ['ctas'],
  services: ['services'],
  products: ['productsStore'],
  blog: ['blog'],
  gallery: ['galleryPortfolio'],
  testimonials: ['testimonials', 'testimonialDepth'],
  contact: ['contact'],
  footer: ['footerSocial'],
  faq: ['faq'],
  process: ['process'],
  about: ['about'],
  differentials: ['differentials'],
  form: ['contact', 'formFields'],
  sustainability: ['differentials'],
  comparison: ['differentials'],
  guarantee: ['faq'],
  calculator: ['formFields'],
  careers: ['about', 'formFields'],
  team: ['services', 'about'],
  events: ['blog', 'process'],
};

function uniqueStrings(values = []) {
  const seen = new Set();
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function uniqueEntries(entries = []) {
  const seen = new Set();
  return entries
    .filter((entry) => entry && entry.id)
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
}

function normalizeRouteId(value = '') {
  const route = String(value || '').trim();
  if (!route || route === '/') return route || '';
  return `/${route.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function readBriefingSpec(workingBrief = null) {
  if (!workingBrief || typeof workingBrief !== 'object') return null;
  if (workingBrief.briefingSpec && typeof workingBrief.briefingSpec === 'object') return workingBrief.briefingSpec;
  return null;
}

function readSpecSections(spec = null) {
  if (!spec || !spec.required) return [];
  if (Array.isArray(spec.required.sections) && spec.required.sections.length) return spec.required.sections;
  return (Array.isArray(spec.required.sectionIds) ? spec.required.sectionIds : [])
    .map((id) => ({ id, label: id }));
}

function readSpecPages(spec = null) {
  if (!spec || !spec.required) return [];
  if (Array.isArray(spec.required.pages) && spec.required.pages.length) return spec.required.pages;
  return (Array.isArray(spec.required.pageIds) ? spec.required.pageIds : [])
    .map((id) => ({ id, label: id }));
}

function hasAny(normalized = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(normalized));
}

function buildMediaCoverageKeys(normalized = '', sectionIds = []) {
  const requestedVideo = sectionIds.includes('video') || /\bvideo\b/.test(normalized);
  if (!requestedVideo) return [];
  const heroVideo = hasAny(normalized, [
    /\bhero\b[\s\S]{0,120}\bvideo\b/,
    /\bvideo\b[\s\S]{0,120}\bhero\b/,
    /\btopo\b[\s\S]{0,120}\bvideo\b/,
  ]);
  const bodyVideo = hasAny(normalized, [
    /\bvideo\b[\s\S]{0,120}\bcorpo\b/,
    /\bbody\b[\s\S]{0,120}\bvideo\b/,
    /\balem do hero\b[\s\S]{0,160}\bvideo\b/,
    /\balém do hero\b[\s\S]{0,160}\bvideo\b/,
    /\bsecao\b[\s\S]{0,80}\bvideo\b[\s\S]{0,80}\bcorpo\b/,
    /\bseção\b[\s\S]{0,80}\bvideo\b[\s\S]{0,80}\bcorpo\b/,
  ]);
  const keys = [];
  if (heroVideo || !bodyVideo) keys.push('videoHero');
  if (bodyVideo) keys.push('videoSection');
  return keys;
}

function buildCoverageKeyMap(sectionIds = [], normalized = '') {
  const keys = {};
  sectionIds.forEach((sectionId) => {
    (SECTION_COVERAGE_KEYS[sectionId] || []).forEach((key) => {
      keys[key] = true;
    });
  });
  buildMediaCoverageKeys(normalized, sectionIds).forEach((key) => {
    keys[key] = true;
  });
  return keys;
}

function buildProjectBlueprintManifest({
  source = '',
  contract = {},
  workingBrief = null,
  layoutRecipe = null,
} = {}) {
  const spec = readBriefingSpec(workingBrief);
  const normalized = normalizeBlueprintText([
    source,
    contract && contract.source ? contract.source : '',
    workingBrief && workingBrief.source ? workingBrief.source.current || '' : '',
    workingBrief && workingBrief.source ? workingBrief.source.consolidated || '' : '',
    layoutRecipe && layoutRecipe.id ? layoutRecipe.id : '',
  ].filter(Boolean).join('\n'));

  const domain = contract && contract.domain ? contract.domain : '';
  const productEventSaas = domain === 'saas-tool' && hasAny(normalized, [
    /\bgestao de eventos\b/,
    /\bgestão de eventos\b/,
    /\bparticipantes\b/,
    /\bcheck-in\b/,
    /\blotes de ingresso\b/,
  ]);
  const keepSection = (section) => !(productEventSaas && section && section.id === 'events');
  const keepPage = (page) => !(productEventSaas && normalizeRouteId(page && page.id) === '/agenda');
  const specSections = readSpecSections(spec).filter(keepSection);
  const specPages = readSpecPages(spec).filter(keepPage);
  const inferredSections = (specSections.length ? [] : inferRequestedSections(normalized)).filter(keepSection);
  const inferredPages = (specPages.length ? [] : inferRequestedPages(normalized)).filter(keepPage);
  const requiredSections = uniqueEntries([...specSections, ...inferredSections]).filter(keepSection);
  const requiredPages = uniqueEntries([...specPages, ...inferredPages])
    .map((page) => ({ ...page, id: normalizeRouteId(page.id) }))
    .filter((page) => page.id)
    .filter(keepPage);
  const sectionIds = uniqueStrings(requiredSections.map((section) => section.id));
  const pageIds = uniqueStrings(requiredPages.map((page) => page.id));
  const expectedRoutes = pageIds.filter((pageId) => pageId && pageId !== '/');
  const coverage = buildCoverageKeyMap(sectionIds, normalized);

  return {
    schemaVersion: PROJECT_BLUEPRINT_MANIFEST_VERSION,
    source: spec ? 'briefing_spec' : 'inferred_source',
    domain,
    requiredSections,
    requiredPages,
    sectionIds,
    pageIds,
    expectedRoutes,
    coverage,
  };
}

module.exports = {
  PROJECT_BLUEPRINT_MANIFEST_VERSION,
  buildProjectBlueprintManifest,
};
