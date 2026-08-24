'use strict';

const assert = require('assert');

const {
  CONTEXT_PACK_CITATION_KINDS,
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_ORDER,
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
  createContextPackCitation,
  createContextPackSection,
} = require('../main/agent_runtime/context_pack_contracts');
const {
  createContextPackCompiler,
} = require('../main/agent_runtime/context_pack_compiler');
const {
  CONTEXT_PACK_SOURCE_COLLECTOR_VERSION,
  createContextPackSourceCollector,
} = require('../main/agent_runtime/context_pack_collector');
const {
  createContextPackCollectionGrant,
  createContextPackSourceAuthorizer,
  createContextPackSourceReader,
} = require('../main/agent_runtime/context_pack_source_contracts');

const digest = (character) => `sha256:${character.repeat(64)}`;

const sourceDefinitions = Object.freeze({
  [CONTEXT_PACK_SECTION_IDS.MILESTONE]: Object.freeze({
    kind: CONTEXT_PACK_CITATION_KINDS.MILESTONE,
    locator: 'milestone://active/milestone-3',
    summary: 'Milestone 3 ativa; critérios de aceite preservados.',
    character: 'c',
  }),
  [CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS]: Object.freeze({
    kind: CONTEXT_PACK_CITATION_KINDS.PROJECT_INSTRUCTION,
    locator: 'project-instruction://AGENTS.md',
    summary: 'Instruções hierárquicas do projeto aplicáveis ao turno.',
    character: 'd',
  }),
  [CONTEXT_PACK_SECTION_IDS.MEMORY]: Object.freeze({
    kind: CONTEXT_PACK_CITATION_KINDS.CORTEX_MEMORY,
    locator: 'cortex://active-memory/memory-7',
    summary: 'Memória ativa válida com provenance.',
    character: 'e',
  }),
  [CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP]: Object.freeze({
    kind: CONTEXT_PACK_CITATION_KINDS.APPLICATION_MAP,
    locator: 'project-map://application-map',
    summary: 'Mapa da aplicação na revisão atual.',
    character: 'f',
  }),
  [CONTEXT_PACK_SECTION_IDS.GIT]: Object.freeze({
    kind: CONTEXT_PACK_CITATION_KINDS.GIT,
    locator: 'git://HEAD',
    summary: 'HEAD e dirty state capturados sem mutação.',
    character: 'a',
  }),
  [CONTEXT_PACK_SECTION_IDS.FILES]: Object.freeze({
    kind: CONTEXT_PACK_CITATION_KINDS.PROJECT_FILE,
    locator: 'project-file://manifest/relevant-files',
    summary: 'Arquivos relevantes identificados pelo leitor autorizado.',
    character: 'b',
  }),
  [CONTEXT_PACK_SECTION_IDS.CONVERSATION]: Object.freeze({
    kind: CONTEXT_PACK_CITATION_KINDS.CONVERSATION,
    locator: 'conversation://conversation-1/summary',
    summary: 'Resumo da conversa atual.',
    character: 'c',
  }),
});

function availableSection(id, definition, revision = `${id}-revision-1`) {
  return createContextPackSection({
    id,
    state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
    revision,
    summary: definition.summary,
    citations: Object.freeze([createContextPackCitation({
      kind: definition.kind,
      locator: definition.locator,
      revision,
      digest: digest(definition.character),
    })]),
    truncated: false,
  });
}

function buildGrant(authorityCharacter = 'd') {
  const requestRevision = 'request-revision-1';
  const authorityRevision = `authority-revision-${authorityCharacter}`;
  return createContextPackCollectionGrant({
    authorityDigest: digest(authorityCharacter),
    requestId: 'request-1',
    projectId: 'project-1',
    surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
    sourceScope: {
      projectId: 'project-1',
      rootPath: '/workspace/project',
      jobId: 'job-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
    },
    requestSection: availableSection(CONTEXT_PACK_SECTION_IDS.REQUEST, {
      kind: CONTEXT_PACK_CITATION_KINDS.RUNTIME_REQUEST,
      locator: 'runtime://request/request-1',
      summary: 'Continue a refatoração guiada por TDD.',
      character: 'a',
    }, requestRevision),
    permissionsSection: availableSection(CONTEXT_PACK_SECTION_IDS.PERMISSIONS, {
      kind: CONTEXT_PACK_CITATION_KINDS.JOB_AUTHORITY,
      locator: 'authority://job/job-1',
      summary: 'Somente leituras de contexto estão autorizadas neste checkpoint.',
      character: authorityCharacter,
    }, authorityRevision),
  });
}

function createCompiler() {
  return createContextPackCompiler({
    now: () => '2026-08-24T13:00:00.000Z',
    maxSummaryChars: 2048,
    maxSectionSummaryChars: 512,
  });
}

async function run() {
let activeReads = 0;
let maximumParallelReads = 0;
const readerContexts = [];
const readers = Object.freeze(Object.entries(sourceDefinitions).map(([sectionId, definition]) => (
  createContextPackSourceReader({
    sectionId,
    read(context) {
      readerContexts.push(context);
      activeReads += 1;
      maximumParallelReads = Math.max(maximumParallelReads, activeReads);
      return new Promise((resolve) => queueMicrotask(() => {
        activeReads -= 1;
        resolve(availableSection(sectionId, definition));
      }));
    },
  })
)));
let authorizationCalls = 0;
const authorizationInputs = [];
const grant = buildGrant();
const authorizer = createContextPackSourceAuthorizer({
  authorize(input) {
    authorizationCalls += 1;
    authorizationInputs.push(input);
    return grant;
  },
});
const collector = createContextPackSourceCollector({
  authorizer,
  compiler: createCompiler(),
  readers,
});
assert.strictEqual(Object.isFrozen(collector), true);
assert.deepStrictEqual(Reflect.ownKeys(collector), ['version', 'collect', 'diagnostics']);
assert.strictEqual(collector.version, CONTEXT_PACK_SOURCE_COLLECTOR_VERSION);

const binding = Object.freeze({ authorityId: 'binding-1' });
const manifest = await collector.collect(Object.freeze({
  binding,
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
}));
assert.deepStrictEqual(manifest.sections.map((section) => section.id), CONTEXT_PACK_SECTION_ORDER);
assert(manifest.sections.every((section) => section.state === CONTEXT_PACK_SECTION_STATES.AVAILABLE));
assert.strictEqual(authorizationCalls, 2);
assert.strictEqual(maximumParallelReads, readers.length);
assert.strictEqual(readerContexts.length, readers.length);
assert(readerContexts.every((context) => Object.isFrozen(context)));
assert(readerContexts.every((context) => context.sourceScope === grant.sourceScope));
assert(authorizationInputs.every((input) => Object.isFrozen(input)));
assert(authorizationInputs.every((input) => input.binding !== binding));
const serialized = JSON.stringify(manifest);
assert.strictEqual(serialized.includes('/workspace/project'), false);
assert.strictEqual(serialized.includes('rootPath'), false);
assert.strictEqual(serialized.includes('binding-1'), false);
assert.deepStrictEqual(collector.diagnostics(), Object.freeze({
  version: CONTEXT_PACK_SOURCE_COLLECTOR_VERSION,
  collections: 1,
  rejections: 0,
  sourceFailures: 0,
  lastPackId: manifest.packId,
}));

let thenGetterCalls = 0;
const hostileThenable = {};
Object.defineProperty(hostileThenable, 'then', {
  enumerable: true,
  get() {
    thenGetterCalls += 1;
    return () => {};
  },
});
const memorySection = availableSection(
  CONTEXT_PACK_SECTION_IDS.MEMORY,
  sourceDefinitions[CONTEXT_PACK_SECTION_IDS.MEMORY]
);
const degradedReaders = Object.freeze(readers.map((reader) => {
  if (reader.sectionId === CONTEXT_PACK_SECTION_IDS.GIT) {
    return createContextPackSourceReader({
      sectionId: reader.sectionId,
      read: () => Promise.reject(new Error('git unavailable')),
    });
  }
  if (reader.sectionId === CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS) {
    return createContextPackSourceReader({
      sectionId: reader.sectionId,
      read: () => availableSection(reader.sectionId, {
        ...sourceDefinitions[reader.sectionId],
        summary: `Instruções lidas em ${grant.sourceScope.rootPath}/AGENTS.md.`,
      }),
    });
  }
  if (reader.sectionId === CONTEXT_PACK_SECTION_IDS.FILES) {
    return createContextPackSourceReader({
      sectionId: reader.sectionId,
      read: () => memorySection,
    });
  }
  if (reader.sectionId === CONTEXT_PACK_SECTION_IDS.CONVERSATION) {
    return createContextPackSourceReader({
      sectionId: reader.sectionId,
      read: () => hostileThenable,
    });
  }
  return reader;
}));
const degradedCollector = createContextPackSourceCollector({
  authorizer,
  compiler: createCompiler(),
  readers: degradedReaders,
});
const degraded = await degradedCollector.collect(Object.freeze({
  binding,
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
}));
for (const sectionId of [
  CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS,
  CONTEXT_PACK_SECTION_IDS.GIT,
  CONTEXT_PACK_SECTION_IDS.FILES,
  CONTEXT_PACK_SECTION_IDS.CONVERSATION,
]) {
  assert.strictEqual(
    degraded.sections.find((section) => section.id === sectionId).state,
    CONTEXT_PACK_SECTION_STATES.UNAVAILABLE
  );
}
assert.strictEqual(thenGetterCalls, 0);
assert.strictEqual(degradedCollector.diagnostics().collections, 1);
assert.strictEqual(degradedCollector.diagnostics().sourceFailures, 4);

let driftCalls = 0;
const driftAuthorizer = createContextPackSourceAuthorizer({
  authorize() {
    driftCalls += 1;
    return driftCalls === 1 ? buildGrant('d') : buildGrant('e');
  },
});
const driftCollector = createContextPackSourceCollector({
  authorizer: driftAuthorizer,
  compiler: createCompiler(),
  readers,
});
await assert.rejects(() => driftCollector.collect(Object.freeze({
  binding,
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
})), /authority changed/i);
assert.strictEqual(driftCollector.diagnostics().collections, 0);
assert.strictEqual(driftCollector.diagnostics().rejections, 1);

let authorizerThenGetterCalls = 0;
const hostileAuthorization = {};
Object.defineProperty(hostileAuthorization, 'then', {
  get() {
    authorizerThenGetterCalls += 1;
    return () => {};
  },
});
const hostileAuthorizerCollector = createContextPackSourceCollector({
  authorizer: createContextPackSourceAuthorizer({
    authorize: () => hostileAuthorization,
  }),
  compiler: createCompiler(),
  readers,
});
await assert.rejects(() => hostileAuthorizerCollector.collect(Object.freeze({
  binding,
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
})), TypeError);
assert.strictEqual(authorizerThenGetterCalls, 0);

let bindingGetterCalls = 0;
const hostileInput = {
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
};
Object.defineProperty(hostileInput, 'binding', {
  enumerable: true,
  get() {
    bindingGetterCalls += 1;
    return binding;
  },
});
await assert.rejects(() => collector.collect(hostileInput), TypeError);
assert.strictEqual(bindingGetterCalls, 0);

let nestedBindingGetterCalls = 0;
const hostileNestedBinding = {};
Object.defineProperty(hostileNestedBinding, 'token', {
  enumerable: true,
  get() {
    nestedBindingGetterCalls += 1;
    return 'binding-1';
  },
});
await assert.rejects(() => collector.collect(Object.freeze({
  binding: Object.freeze({ nested: hostileNestedBinding }),
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
})), TypeError);
assert.strictEqual(nestedBindingGetterCalls, 0);

await assert.rejects(() => collector.collect(Object.freeze({
  binding,
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
  sections: Object.freeze([]),
})), TypeError);

console.log('context-pack-collector.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
