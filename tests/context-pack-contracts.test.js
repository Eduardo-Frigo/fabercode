'use strict';

const assert = require('assert');

const {
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
} = require('../main/agent_runtime/context_pack_contracts');

const digest = (character) => `sha256:${character.repeat(64)}`;

assert.strictEqual(CONTEXT_PACK_CONTRACT_VERSION, 'context-pack-contract.v1');
assert.strictEqual(CONTEXT_PACK_CITATION_SCHEMA_VERSION, 'context-pack-citation.v1');
assert.strictEqual(CONTEXT_PACK_SECTION_SCHEMA_VERSION, 'context-pack-section.v1');
assert.strictEqual(CONTEXT_PACK_MANIFEST_SCHEMA_VERSION, 'context-pack-manifest.v1');
for (const enumeration of [
  CONTEXT_PACK_CITATION_KINDS,
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
  CONTEXT_PACK_TRUST_LEVELS,
]) {
  assert.strictEqual(Object.isFrozen(enumeration), true);
}
assert.strictEqual(Object.isFrozen(CONTEXT_PACK_SECTION_ORDER), true);
assert.deepStrictEqual(CONTEXT_PACK_SECTION_ORDER, [
  'request',
  'permissions',
  'milestone',
  'instructions',
  'memory',
  'application_map',
  'git',
  'files',
  'conversation',
]);

const requestCitation = createContextPackCitation({
  kind: CONTEXT_PACK_CITATION_KINDS.RUNTIME_REQUEST,
  locator: 'runtime://request/request-1',
  revision: 'request-revision-1',
  digest: digest('a'),
});
assert.deepStrictEqual(requestCitation, Object.freeze({
  schemaVersion: CONTEXT_PACK_CITATION_SCHEMA_VERSION,
  kind: 'runtime_request',
  locator: 'runtime://request/request-1',
  revision: 'request-revision-1',
  digest: digest('a'),
}));
assert.strictEqual(Object.isFrozen(requestCitation), true);
assert.strictEqual(assertContextPackCitation(requestCitation), requestCitation);

const requestSection = createContextPackSection({
  id: CONTEXT_PACK_SECTION_IDS.REQUEST,
  state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
  revision: 'request-revision-1',
  summary: 'Implementar o manifesto compacto do ContextPack.',
  citations: Object.freeze([requestCitation]),
  truncated: false,
});
assert.deepStrictEqual(Reflect.ownKeys(requestSection), [
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
assert.strictEqual(requestSection.schemaVersion, CONTEXT_PACK_SECTION_SCHEMA_VERSION);
assert.strictEqual(requestSection.source, 'runtime_request');
assert.strictEqual(requestSection.trust, CONTEXT_PACK_TRUST_LEVELS.UNTRUSTED_CONTENT);
assert.strictEqual(requestSection.priority, 100);
assert.match(requestSection.sectionDigest, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(Object.isFrozen(requestSection), true);
assert.strictEqual(Object.isFrozen(requestSection.citations), true);
assert.strictEqual(assertContextPackSection(requestSection), requestSection);

const permissionsSection = createContextPackSection({
  id: CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
  state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
  revision: 'job-binding-1',
  summary: 'Workspace isolado; rede desabilitada; shell da IA suspenso.',
  citations: Object.freeze([createContextPackCitation({
    kind: CONTEXT_PACK_CITATION_KINDS.JOB_AUTHORITY,
    locator: 'authority://job/job-1',
    revision: 'job-binding-1',
    digest: digest('b'),
  })]),
  truncated: false,
});
assert.strictEqual(permissionsSection.trust, CONTEXT_PACK_TRUST_LEVELS.TRUSTED_RUNTIME);

const unavailableSections = CONTEXT_PACK_SECTION_ORDER
  .filter((id) => id !== requestSection.id && id !== permissionsSection.id)
  .map((id) => createContextPackSection({
    id,
    state: CONTEXT_PACK_SECTION_STATES.UNAVAILABLE,
    revision: null,
    summary: '',
    citations: Object.freeze([]),
    truncated: false,
  }));
const sections = Object.freeze(
  CONTEXT_PACK_SECTION_ORDER.map((id) => (
    id === requestSection.id
      ? requestSection
      : id === permissionsSection.id
        ? permissionsSection
        : unavailableSections.find((section) => section.id === id)
  ))
);
const budget = Object.freeze({
  maxSummaryChars: 4096,
  usedSummaryChars: sections.reduce((total, section) => total + section.summary.length, 0),
  estimatedTokens: 32,
  truncatedSections: Object.freeze([]),
});
const manifest = createContextPackManifest({
  requestId: 'request-1',
  projectId: 'project-1',
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
  createdAt: '2026-08-24T12:00:00.000Z',
  sections,
  budget,
});
assert.deepStrictEqual(Reflect.ownKeys(manifest), [
  'schemaVersion',
  'packId',
  'requestId',
  'projectId',
  'surface',
  'createdAt',
  'sections',
  'budget',
]);
assert.match(manifest.packId, /^context-pack:[a-f0-9]{64}$/);
assert.strictEqual(Object.isFrozen(manifest), true);
assert.strictEqual(assertContextPackManifest(manifest), manifest);

assert.throws(() => createContextPackCitation({
  kind: CONTEXT_PACK_CITATION_KINDS.PROJECT_FILE,
  locator: '/local/absolute/path',
  revision: '1',
  digest: digest('c'),
}), /locator/i);
assert.throws(() => createContextPackCitation({
  kind: CONTEXT_PACK_CITATION_KINDS.PROJECT_FILE,
  locator: `project-file://${['', 'private', 'example', 'private-project', 'file.js'].join('/')}`,
  revision: '1',
  digest: digest('c'),
}), /locator/i);
assert.throws(() => createContextPackCitation({
  kind: CONTEXT_PACK_CITATION_KINDS.PROJECT_FILE,
  locator: `project-file://${['C:', 'private-project', 'file.js'].join('/')}`,
  revision: '1',
  digest: digest('c'),
}), /locator/i);
assert.throws(() => createContextPackCitation({
  kind: CONTEXT_PACK_CITATION_KINDS.CORTEX_MEMORY,
  locator: 'cortex://memory/1',
  revision: '1',
  digest: 'not-a-digest',
}), /digest/i);
assert.throws(() => createContextPackSection({
  id: CONTEXT_PACK_SECTION_IDS.MEMORY,
  state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
  revision: 'memory-1',
  summary: 'Memória sem provenance.',
  citations: Object.freeze([]),
  truncated: false,
}), /citation/i);
assert.throws(() => createContextPackSection({
  id: CONTEXT_PACK_SECTION_IDS.GIT,
  state: CONTEXT_PACK_SECTION_STATES.UNAVAILABLE,
  revision: null,
  summary: 'não deveria existir',
  citations: Object.freeze([]),
  truncated: false,
}), /summary/i);
assert.throws(() => createContextPackSection({
  id: CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
  state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
  revision: 'authority-1',
  summary: 'Conteúdo não autoritativo não pode virar permissão.',
  citations: Object.freeze([createContextPackCitation({
    kind: CONTEXT_PACK_CITATION_KINDS.CORTEX_MEMORY,
    locator: 'cortex://memory/not-authority',
    revision: 'memory-1',
    digest: digest('c'),
  })]),
  truncated: false,
}), /citation kind/i);

let getterCalls = 0;
const hostileCitation = {
  kind: CONTEXT_PACK_CITATION_KINDS.RUNTIME_REQUEST,
  locator: 'runtime://request/hostile',
  revision: '1',
};
Object.defineProperty(hostileCitation, 'digest', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return digest('d');
  },
});
assert.throws(() => createContextPackCitation(hostileCitation), TypeError);
assert.strictEqual(getterCalls, 0);

let proxyTrapCalls = 0;
const hostileSection = new Proxy({
  id: CONTEXT_PACK_SECTION_IDS.REQUEST,
  state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
  revision: '1',
  summary: 'hostile',
  citations: Object.freeze([requestCitation]),
  truncated: false,
}, {
  ownKeys(target) {
    proxyTrapCalls += 1;
    return Reflect.ownKeys(target);
  },
});
assert.throws(() => createContextPackSection(hostileSection), TypeError);
assert.strictEqual(proxyTrapCalls, 0);

const mutableCitationListSection = Object.freeze({
  ...requestSection,
  citations: [requestCitation],
});
assert.throws(() => assertContextPackSection(mutableCitationListSection), TypeError);

const mutableBudgetListManifest = Object.freeze({
  ...manifest,
  budget: Object.freeze({
    ...manifest.budget,
    truncatedSections: [],
  }),
});
assert.throws(() => assertContextPackManifest(mutableBudgetListManifest), TypeError);

const forgedManifest = Object.freeze({
  ...manifest,
  packId: `context-pack:${'f'.repeat(64)}`,
});
assert.throws(() => assertContextPackManifest(forgedManifest), TypeError);

console.log('context-pack-contracts.test.js: ok');
