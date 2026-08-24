'use strict';

const crypto = require('crypto');
const util = require('util');

const CONTEXT_PACK_CONTRACT_VERSION = 'context-pack-contract.v1';
const CONTEXT_PACK_CITATION_SCHEMA_VERSION = 'context-pack-citation.v1';
const CONTEXT_PACK_SECTION_SCHEMA_VERSION = 'context-pack-section.v1';
const CONTEXT_PACK_MANIFEST_SCHEMA_VERSION = 'context-pack-manifest.v1';

const CONTEXT_PACK_CITATION_KINDS = Object.freeze({
  RUNTIME_REQUEST: 'runtime_request',
  CONVERSATION: 'conversation',
  CORTEX_MEMORY: 'cortex_memory',
  APPLICATION_MAP: 'application_map',
  MILESTONE: 'milestone',
  GIT: 'git',
  PROJECT_INSTRUCTION: 'project_instruction',
  PROJECT_FILE: 'project_file',
  JOB_AUTHORITY: 'job_authority',
});

const CONTEXT_PACK_SECTION_IDS = Object.freeze({
  REQUEST: 'request',
  PERMISSIONS: 'permissions',
  MILESTONE: 'milestone',
  INSTRUCTIONS: 'instructions',
  MEMORY: 'memory',
  APPLICATION_MAP: 'application_map',
  GIT: 'git',
  FILES: 'files',
  CONVERSATION: 'conversation',
});

const CONTEXT_PACK_SECTION_STATES = Object.freeze({
  AVAILABLE: 'available',
  EMPTY: 'empty',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable',
});

const CONTEXT_PACK_SURFACES = Object.freeze({
  MAP_CHAT: 'map_chat',
  MAP_RENDER: 'map_render',
  DEVELOPMENT_PREPARE: 'development_prepare',
  DEVELOPMENT_EXECUTE: 'development_execute',
  MILESTONE_EXECUTE: 'milestone_execute',
  REVIEW: 'review',
});

const CONTEXT_PACK_TRUST_LEVELS = Object.freeze({
  TRUSTED_RUNTIME: 'trusted_runtime',
  UNTRUSTED_CONTENT: 'untrusted_content',
});

const CONTEXT_PACK_SECTION_ORDER = Object.freeze([
  CONTEXT_PACK_SECTION_IDS.REQUEST,
  CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
  CONTEXT_PACK_SECTION_IDS.MILESTONE,
  CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS,
  CONTEXT_PACK_SECTION_IDS.MEMORY,
  CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP,
  CONTEXT_PACK_SECTION_IDS.GIT,
  CONTEXT_PACK_SECTION_IDS.FILES,
  CONTEXT_PACK_SECTION_IDS.CONVERSATION,
]);

const SECTION_METADATA = Object.freeze({
  [CONTEXT_PACK_SECTION_IDS.REQUEST]: Object.freeze({
    source: 'runtime_request',
    trust: CONTEXT_PACK_TRUST_LEVELS.UNTRUSTED_CONTENT,
    priority: 100,
  }),
  [CONTEXT_PACK_SECTION_IDS.PERMISSIONS]: Object.freeze({
    source: 'job_authority',
    trust: CONTEXT_PACK_TRUST_LEVELS.TRUSTED_RUNTIME,
    priority: 95,
  }),
  [CONTEXT_PACK_SECTION_IDS.MILESTONE]: Object.freeze({
    source: 'milestone',
    trust: CONTEXT_PACK_TRUST_LEVELS.UNTRUSTED_CONTENT,
    priority: 90,
  }),
  [CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS]: Object.freeze({
    source: 'project_instruction',
    trust: CONTEXT_PACK_TRUST_LEVELS.UNTRUSTED_CONTENT,
    priority: 85,
  }),
  [CONTEXT_PACK_SECTION_IDS.MEMORY]: Object.freeze({
    source: 'cortex_memory',
    trust: CONTEXT_PACK_TRUST_LEVELS.UNTRUSTED_CONTENT,
    priority: 80,
  }),
  [CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP]: Object.freeze({
    source: 'application_map',
    trust: CONTEXT_PACK_TRUST_LEVELS.UNTRUSTED_CONTENT,
    priority: 75,
  }),
  [CONTEXT_PACK_SECTION_IDS.GIT]: Object.freeze({
    source: 'git',
    trust: CONTEXT_PACK_TRUST_LEVELS.UNTRUSTED_CONTENT,
    priority: 70,
  }),
  [CONTEXT_PACK_SECTION_IDS.FILES]: Object.freeze({
    source: 'project_file',
    trust: CONTEXT_PACK_TRUST_LEVELS.UNTRUSTED_CONTENT,
    priority: 65,
  }),
  [CONTEXT_PACK_SECTION_IDS.CONVERSATION]: Object.freeze({
    source: 'conversation',
    trust: CONTEXT_PACK_TRUST_LEVELS.UNTRUSTED_CONTENT,
    priority: 60,
  }),
});

const CITATION_SCHEMES = Object.freeze({
  [CONTEXT_PACK_CITATION_KINDS.RUNTIME_REQUEST]: 'runtime://',
  [CONTEXT_PACK_CITATION_KINDS.CONVERSATION]: 'conversation://',
  [CONTEXT_PACK_CITATION_KINDS.CORTEX_MEMORY]: 'cortex://',
  [CONTEXT_PACK_CITATION_KINDS.APPLICATION_MAP]: 'project-map://',
  [CONTEXT_PACK_CITATION_KINDS.MILESTONE]: 'milestone://',
  [CONTEXT_PACK_CITATION_KINDS.GIT]: 'git://',
  [CONTEXT_PACK_CITATION_KINDS.PROJECT_INSTRUCTION]: 'project-instruction://',
  [CONTEXT_PACK_CITATION_KINDS.PROJECT_FILE]: 'project-file://',
  [CONTEXT_PACK_CITATION_KINDS.JOB_AUTHORITY]: 'authority://',
});

const SECTION_CITATION_KINDS = Object.freeze({
  [CONTEXT_PACK_SECTION_IDS.REQUEST]: CONTEXT_PACK_CITATION_KINDS.RUNTIME_REQUEST,
  [CONTEXT_PACK_SECTION_IDS.PERMISSIONS]: CONTEXT_PACK_CITATION_KINDS.JOB_AUTHORITY,
  [CONTEXT_PACK_SECTION_IDS.MILESTONE]: CONTEXT_PACK_CITATION_KINDS.MILESTONE,
  [CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS]:
    CONTEXT_PACK_CITATION_KINDS.PROJECT_INSTRUCTION,
  [CONTEXT_PACK_SECTION_IDS.MEMORY]: CONTEXT_PACK_CITATION_KINDS.CORTEX_MEMORY,
  [CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP]:
    CONTEXT_PACK_CITATION_KINDS.APPLICATION_MAP,
  [CONTEXT_PACK_SECTION_IDS.GIT]: CONTEXT_PACK_CITATION_KINDS.GIT,
  [CONTEXT_PACK_SECTION_IDS.FILES]: CONTEXT_PACK_CITATION_KINDS.PROJECT_FILE,
  [CONTEXT_PACK_SECTION_IDS.CONVERSATION]: CONTEXT_PACK_CITATION_KINDS.CONVERSATION,
});

const SUPPORTED_CITATION_KINDS = new Set(Object.values(CONTEXT_PACK_CITATION_KINDS));
const SUPPORTED_SECTION_IDS = new Set(Object.values(CONTEXT_PACK_SECTION_IDS));
const SUPPORTED_SECTION_STATES = new Set(Object.values(CONTEXT_PACK_SECTION_STATES));
const SUPPORTED_SURFACES = new Set(Object.values(CONTEXT_PACK_SURFACES));
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const PACK_ID = /^context-pack:[a-f0-9]{64}$/;
const MAX_SUMMARY_CHARS = 65_536;
const MAX_CITATIONS = 32;

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      return null;
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function denseArrayValues(value, fieldName, maximum) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    throw new TypeError(`${fieldName} must be a bounded plain array`);
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  } catch {
    throw new TypeError(`${fieldName} is invalid`);
  }
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${fieldName} must be a dense data array`);
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain data values only`);
    }
    return descriptor.value;
  });
}

function safeText(value, fieldName, maximum = 256, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')
    || (!allowEmpty && (!value || value !== value.trim()))) {
    throw new TypeError(`${fieldName} is invalid`);
  }
  return allowEmpty ? value.trim() : value;
}

function safeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${fieldName} must be a safe identifier`);
  }
  return value;
}

function canonicalSha256(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function createContextPackCitation(input = {}) {
  const fields = exactDataFields(input, ['kind', 'locator', 'revision', 'digest']);
  if (!fields) throw new TypeError('Invalid ContextPack citation data');
  const kind = fields.get('kind');
  if (!SUPPORTED_CITATION_KINDS.has(kind)) {
    throw new TypeError('ContextPack citation kind is invalid');
  }
  const locator = safeText(fields.get('locator'), 'ContextPack citation locator', 512);
  if (!locator.startsWith(CITATION_SCHEMES[kind])
    || /\s/.test(locator) || locator.includes('..')) {
    throw new TypeError('ContextPack citation locator is invalid');
  }
  const revision = safeText(
    fields.get('revision'),
    'ContextPack citation revision',
    256
  );
  const digest = fields.get('digest');
  if (typeof digest !== 'string' || !SHA256_DIGEST.test(digest)) {
    throw new TypeError('ContextPack citation digest is invalid');
  }
  return Object.freeze({
    schemaVersion: CONTEXT_PACK_CITATION_SCHEMA_VERSION,
    kind,
    locator,
    revision,
    digest,
  });
}

function assertContextPackCitation(value) {
  const fields = exactDataFields(value, [
    'schemaVersion',
    'kind',
    'locator',
    'revision',
    'digest',
  ]);
  if (!fields || !Object.isFrozen(value)
    || fields.get('schemaVersion') !== CONTEXT_PACK_CITATION_SCHEMA_VERSION) {
    throw new TypeError('Invalid ContextPack citation');
  }
  const canonical = createContextPackCitation({
    kind: fields.get('kind'),
    locator: fields.get('locator'),
    revision: fields.get('revision'),
    digest: fields.get('digest'),
  });
  if (JSON.stringify(canonical) !== JSON.stringify(value)) {
    throw new TypeError('Invalid ContextPack citation');
  }
  return value;
}

function createContextPackSection(input = {}) {
  const fields = exactDataFields(input, [
    'id',
    'state',
    'revision',
    'summary',
    'citations',
    'truncated',
  ]);
  if (!fields) throw new TypeError('Invalid ContextPack section data');
  const id = fields.get('id');
  const state = fields.get('state');
  if (!SUPPORTED_SECTION_IDS.has(id) || !SUPPORTED_SECTION_STATES.has(state)) {
    throw new TypeError('ContextPack section id or state is invalid');
  }
  const metadata = SECTION_METADATA[id];
  const revisionValue = fields.get('revision');
  const revision = revisionValue === null
    ? null
    : safeText(revisionValue, 'ContextPack section revision', 256);
  const summary = safeText(
    fields.get('summary'),
    'ContextPack section summary',
    MAX_SUMMARY_CHARS,
    { allowEmpty: true }
  );
  const truncated = fields.get('truncated');
  if (typeof truncated !== 'boolean') {
    throw new TypeError('ContextPack section truncated flag is invalid');
  }
  const citations = Object.freeze(denseArrayValues(
    fields.get('citations'),
    'ContextPack section citations',
    MAX_CITATIONS
  ).map(assertContextPackCitation));
  if (citations.some((citation) => citation.kind !== SECTION_CITATION_KINDS[id])) {
    throw new TypeError('ContextPack section citation kind does not match its source');
  }
  const carriesContent = state === CONTEXT_PACK_SECTION_STATES.AVAILABLE
    || state === CONTEXT_PACK_SECTION_STATES.STALE;
  if (carriesContent && (!summary || !revision || citations.length < 1)) {
    throw new TypeError('Available ContextPack sections require summary, revision, and citation');
  }
  if (!carriesContent && summary !== '') {
    throw new TypeError('Empty or unavailable ContextPack section summary must be empty');
  }
  if (!carriesContent && truncated) {
    throw new TypeError('Empty or unavailable ContextPack section cannot be truncated');
  }
  const digestInput = {
    id,
    source: metadata.source,
    state,
    trust: metadata.trust,
    priority: metadata.priority,
    revision,
    summary,
    citations,
    truncated,
  };
  return Object.freeze({
    schemaVersion: CONTEXT_PACK_SECTION_SCHEMA_VERSION,
    ...digestInput,
    sectionDigest: canonicalSha256(digestInput),
  });
}

function assertContextPackSection(value) {
  const fields = exactDataFields(value, [
    'schemaVersion',
    'id',
    'source',
    'state',
    'trust',
    'priority',
    'revision',
    'summary',
    'citations',
    'truncated',
    'sectionDigest',
  ]);
  const citations = fields && fields.get('citations');
  if (!fields || !Object.isFrozen(value)
    || util.types.isProxy(citations) || !Object.isFrozen(citations)
    || fields.get('schemaVersion') !== CONTEXT_PACK_SECTION_SCHEMA_VERSION) {
    throw new TypeError('Invalid ContextPack section');
  }
  const canonical = createContextPackSection({
    id: fields.get('id'),
    state: fields.get('state'),
    revision: fields.get('revision'),
    summary: fields.get('summary'),
    citations: fields.get('citations'),
    truncated: fields.get('truncated'),
  });
  if (JSON.stringify(canonical) !== JSON.stringify(value)) {
    throw new TypeError('Invalid ContextPack section');
  }
  return value;
}

function normalizeCreatedAt(value) {
  const createdAt = safeText(value, 'ContextPack createdAt', 64);
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== createdAt) {
    throw new TypeError('ContextPack createdAt must be a canonical ISO timestamp');
  }
  return createdAt;
}

function normalizeBudget(value, sections) {
  const fields = exactDataFields(value, [
    'maxSummaryChars',
    'usedSummaryChars',
    'estimatedTokens',
    'truncatedSections',
  ]);
  const truncatedSectionsValue = fields && fields.get('truncatedSections');
  if (!fields || !Object.isFrozen(value)
    || util.types.isProxy(truncatedSectionsValue)
    || !Object.isFrozen(truncatedSectionsValue)) {
    throw new TypeError('Invalid ContextPack budget');
  }
  const maxSummaryChars = fields.get('maxSummaryChars');
  const usedSummaryChars = fields.get('usedSummaryChars');
  const estimatedTokens = fields.get('estimatedTokens');
  if (!Number.isSafeInteger(maxSummaryChars) || maxSummaryChars < 1
    || !Number.isSafeInteger(usedSummaryChars) || usedSummaryChars < 0
    || usedSummaryChars > maxSummaryChars
    || !Number.isSafeInteger(estimatedTokens) || estimatedTokens < 0) {
    throw new TypeError('Invalid ContextPack budget counters');
  }
  const truncatedSections = denseArrayValues(
    fields.get('truncatedSections'),
    'ContextPack truncated sections',
    CONTEXT_PACK_SECTION_ORDER.length
  );
  if (new Set(truncatedSections).size !== truncatedSections.length
    || truncatedSections.some((id) => !SUPPORTED_SECTION_IDS.has(id))) {
    throw new TypeError('Invalid ContextPack truncated sections');
  }
  const actualUsed = sections.reduce((total, section) => total + section.summary.length, 0);
  const actualTruncated = sections
    .filter((section) => section.truncated)
    .map((section) => section.id);
  if (usedSummaryChars !== actualUsed
    || JSON.stringify(truncatedSections) !== JSON.stringify(actualTruncated)) {
    throw new TypeError('ContextPack budget does not match its sections');
  }
  return Object.freeze({
    maxSummaryChars,
    usedSummaryChars,
    estimatedTokens,
    truncatedSections: Object.freeze([...truncatedSections]),
  });
}

function createContextPackManifest(input = {}) {
  const fields = exactDataFields(input, [
    'requestId',
    'projectId',
    'surface',
    'createdAt',
    'sections',
    'budget',
  ]);
  if (!fields) throw new TypeError('Invalid ContextPack manifest data');
  const requestId = safeIdentifier(fields.get('requestId'), 'ContextPack requestId');
  const projectId = safeIdentifier(fields.get('projectId'), 'ContextPack projectId');
  const surface = fields.get('surface');
  if (!SUPPORTED_SURFACES.has(surface)) {
    throw new TypeError('ContextPack surface is invalid');
  }
  const createdAt = normalizeCreatedAt(fields.get('createdAt'));
  const sections = Object.freeze(denseArrayValues(
    fields.get('sections'),
    'ContextPack sections',
    CONTEXT_PACK_SECTION_ORDER.length
  ).map(assertContextPackSection));
  if (sections.length !== CONTEXT_PACK_SECTION_ORDER.length
    || sections.some((section, index) => section.id !== CONTEXT_PACK_SECTION_ORDER[index])) {
    throw new TypeError('ContextPack sections must use the complete canonical order');
  }
  for (const requiredId of [
    CONTEXT_PACK_SECTION_IDS.REQUEST,
    CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
  ]) {
    const section = sections.find((entry) => entry.id === requiredId);
    if (!section || ![
      CONTEXT_PACK_SECTION_STATES.AVAILABLE,
      CONTEXT_PACK_SECTION_STATES.STALE,
    ].includes(section.state)) {
      throw new TypeError(`ContextPack ${requiredId} section must be available`);
    }
  }
  const budget = normalizeBudget(fields.get('budget'), sections);
  const packSnapshot = {
    requestId,
    projectId,
    surface,
    sectionDigests: sections.map((section) => section.sectionDigest),
    budget,
  };
  const packId = `context-pack:${canonicalSha256(packSnapshot).slice('sha256:'.length)}`;
  return Object.freeze({
    schemaVersion: CONTEXT_PACK_MANIFEST_SCHEMA_VERSION,
    packId,
    requestId,
    projectId,
    surface,
    createdAt,
    sections,
    budget,
  });
}

function assertContextPackManifest(value) {
  const fields = exactDataFields(value, [
    'schemaVersion',
    'packId',
    'requestId',
    'projectId',
    'surface',
    'createdAt',
    'sections',
    'budget',
  ]);
  const sections = fields && fields.get('sections');
  const budget = fields && fields.get('budget');
  if (!fields || !Object.isFrozen(value)
    || util.types.isProxy(sections) || !Object.isFrozen(sections)
    || util.types.isProxy(budget) || !Object.isFrozen(budget)
    || fields.get('schemaVersion') !== CONTEXT_PACK_MANIFEST_SCHEMA_VERSION
    || typeof fields.get('packId') !== 'string'
    || !PACK_ID.test(fields.get('packId'))) {
    throw new TypeError('Invalid ContextPack manifest');
  }
  const canonical = createContextPackManifest({
    requestId: fields.get('requestId'),
    projectId: fields.get('projectId'),
    surface: fields.get('surface'),
    createdAt: fields.get('createdAt'),
    sections: fields.get('sections'),
    budget: fields.get('budget'),
  });
  if (JSON.stringify(canonical) !== JSON.stringify(value)) {
    throw new TypeError('Invalid ContextPack manifest');
  }
  return value;
}

module.exports = {
  CONTEXT_PACK_CITATION_KINDS,
  CONTEXT_PACK_CITATION_SCHEMA_VERSION,
  CONTEXT_PACK_CONTRACT_VERSION,
  CONTEXT_PACK_MANIFEST_SCHEMA_VERSION,
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_ORDER,
  CONTEXT_PACK_SECTION_SCHEMA_VERSION,
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
  CONTEXT_PACK_TRUST_LEVELS,
  assertContextPackCitation,
  assertContextPackManifest,
  assertContextPackSection,
  createContextPackCitation,
  createContextPackManifest,
  createContextPackSection,
};
