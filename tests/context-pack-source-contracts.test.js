'use strict';

const assert = require('assert');

const {
  CONTEXT_PACK_CITATION_KINDS,
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
  createContextPackCitation,
  createContextPackSection,
} = require('../main/agent_runtime/context_pack_contracts');
const {
  CONTEXT_PACK_COLLECTION_GRANT_SCHEMA_VERSION,
  CONTEXT_PACK_SOURCE_AUTHORIZER_VERSION,
  CONTEXT_PACK_SOURCE_READER_VERSION,
  assertContextPackCollectionGrant,
  assertContextPackSourceAuthorizer,
  assertContextPackSourceReader,
  createContextPackCollectionGrant,
  createContextPackSourceAuthorizer,
  createContextPackSourceReader,
} = require('../main/agent_runtime/context_pack_source_contracts');

const digest = (character) => `sha256:${character.repeat(64)}`;

function availableSection(id, kind, locator, revision, summary, character) {
  return createContextPackSection({
    id,
    state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
    revision,
    summary,
    citations: Object.freeze([createContextPackCitation({
      kind,
      locator,
      revision,
      digest: digest(character),
    })]),
    truncated: false,
  });
}

const requestSection = availableSection(
  CONTEXT_PACK_SECTION_IDS.REQUEST,
  CONTEXT_PACK_CITATION_KINDS.RUNTIME_REQUEST,
  'runtime://request/request-1',
  'request-revision-1',
  'Compile o contexto governado do projeto.',
  'a'
);
const permissionsSection = availableSection(
  CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
  CONTEXT_PACK_CITATION_KINDS.JOB_AUTHORITY,
  'authority://job/job-1',
  'authority-revision-1',
  'Leitura paralela autorizada; mutações não autorizadas.',
  'b'
);
const sourceScope = {
  projectId: 'project-1',
  rootPath: '/workspace/project',
  jobId: 'job-1',
  conversationId: 'conversation-1',
  userId: 'user-1',
};

const grant = createContextPackCollectionGrant({
  authorityDigest: digest('b'),
  requestId: 'request-1',
  projectId: 'project-1',
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
  sourceScope,
  requestSection,
  permissionsSection,
});
assert.deepStrictEqual(Reflect.ownKeys(grant), [
  'schemaVersion',
  'authorityDigest',
  'requestId',
  'projectId',
  'surface',
  'sourceScope',
  'requestSection',
  'permissionsSection',
]);
assert.strictEqual(grant.schemaVersion, CONTEXT_PACK_COLLECTION_GRANT_SCHEMA_VERSION);
assert.strictEqual(Object.isFrozen(grant), true);
assert.strictEqual(Object.isFrozen(grant.sourceScope), true);
assert.notStrictEqual(grant.sourceScope, sourceScope);
assert.strictEqual(assertContextPackCollectionGrant(grant), grant);

assert.throws(() => createContextPackCollectionGrant({
  authorityDigest: digest('c'),
  requestId: 'request-1',
  projectId: 'project-1',
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
  sourceScope,
  requestSection,
  permissionsSection,
}), /authority digest/i);
assert.throws(() => createContextPackCollectionGrant({
  authorityDigest: digest('b'),
  requestId: 'request-other',
  projectId: 'project-1',
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
  sourceScope,
  requestSection,
  permissionsSection,
}), /request citation/i);
assert.throws(() => createContextPackCollectionGrant({
  authorityDigest: digest('b'),
  requestId: 'request-1',
  projectId: 'project-other',
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
  sourceScope,
  requestSection,
  permissionsSection,
}), /project scope/i);
assert.throws(() => createContextPackCollectionGrant({
  authorityDigest: digest('b'),
  requestId: 'request-1',
  projectId: 'project-1',
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
  sourceScope: { ...sourceScope, rootPath: 'relative/project' },
  requestSection,
  permissionsSection,
}), /rootPath/i);
assert.throws(() => createContextPackCollectionGrant({
  authorityDigest: digest('b'),
  requestId: 'request-1',
  projectId: 'project-1',
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
  sourceScope,
  requestSection: availableSection(
    CONTEXT_PACK_SECTION_IDS.REQUEST,
    CONTEXT_PACK_CITATION_KINDS.RUNTIME_REQUEST,
    'runtime://request/request-1',
    'request-revision-1',
    `Não exponha ${sourceScope.rootPath} ao modelo.`,
    'a'
  ),
  permissionsSection,
}), /rootPath/i);

const mutableScopeGrant = Object.freeze({
  ...grant,
  sourceScope: { ...grant.sourceScope },
});
assert.throws(() => assertContextPackCollectionGrant(mutableScopeGrant), TypeError);

const read = () => Promise.resolve(null);
const reader = createContextPackSourceReader({
  sectionId: CONTEXT_PACK_SECTION_IDS.MILESTONE,
  read,
});
assert.deepStrictEqual(Reflect.ownKeys(reader), ['version', 'sectionId', 'read']);
assert.strictEqual(reader.version, CONTEXT_PACK_SOURCE_READER_VERSION);
assert.strictEqual(reader.read, read);
assert.strictEqual(Object.isFrozen(reader), true);
assert.strictEqual(assertContextPackSourceReader(reader), reader);
assert.throws(() => createContextPackSourceReader({
  sectionId: CONTEXT_PACK_SECTION_IDS.REQUEST,
  read,
}), /section/i);
assert.throws(() => createContextPackSourceReader({
  sectionId: CONTEXT_PACK_SECTION_IDS.GIT,
  read: new Proxy(read, {}),
}), /read/i);

const authorize = () => grant;
const authorizer = createContextPackSourceAuthorizer({ authorize });
assert.deepStrictEqual(Reflect.ownKeys(authorizer), ['version', 'authorize']);
assert.strictEqual(authorizer.version, CONTEXT_PACK_SOURCE_AUTHORIZER_VERSION);
assert.strictEqual(authorizer.authorize, authorize);
assert.strictEqual(Object.isFrozen(authorizer), true);
assert.strictEqual(assertContextPackSourceAuthorizer(authorizer), authorizer);

let getterCalls = 0;
const hostileReaderInput = {
  sectionId: CONTEXT_PACK_SECTION_IDS.GIT,
};
Object.defineProperty(hostileReaderInput, 'read', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return read;
  },
});
assert.throws(() => createContextPackSourceReader(hostileReaderInput), TypeError);
assert.strictEqual(getterCalls, 0);

console.log('context-pack-source-contracts.test.js: ok');
