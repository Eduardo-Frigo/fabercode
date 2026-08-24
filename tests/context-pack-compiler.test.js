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
  CONTEXT_PACK_COMPILER_VERSION,
  createContextPackCompiler,
} = require('../main/agent_runtime/context_pack_compiler');

const digest = (character) => `sha256:${character.repeat(64)}`;

function citation(kind, locator, revision, character) {
  return createContextPackCitation({
    kind,
    locator,
    revision,
    digest: digest(character),
  });
}

function section(id, revision, summary, sourceCitation) {
  return createContextPackSection({
    id,
    state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
    revision,
    summary,
    citations: Object.freeze([sourceCitation]),
    truncated: false,
  });
}

const request = section(
  CONTEXT_PACK_SECTION_IDS.REQUEST,
  'request-revision-1',
  'Implemente um ContextPack compacto, determinístico e verificável.',
  citation(
    CONTEXT_PACK_CITATION_KINDS.RUNTIME_REQUEST,
    'runtime://request/request-1',
    'request-revision-1',
    'a'
  )
);
const permissions = section(
  CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
  'authority-revision-1',
  'Somente leitura de contexto; mutações continuam governadas pelo broker.',
  citation(
    CONTEXT_PACK_CITATION_KINDS.JOB_AUTHORITY,
    'authority://job/job-1',
    'authority-revision-1',
    'b'
  )
);
const memory = section(
  CONTEXT_PACK_SECTION_IDS.MEMORY,
  'memory-revision-7',
  'Preferência persistida: preservar Cortex, mapa, milestones, Files, Git e Execute durante a refatoração.',
  citation(
    CONTEXT_PACK_CITATION_KINDS.CORTEX_MEMORY,
    'cortex://memory/memory-7',
    'memory-revision-7',
    'c'
  )
);
const applicationMap = section(
  CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP,
  'map-revision-4',
  'Mapa com arquitetura do runtime, broker, serviços de domínio e projeções. '.repeat(8),
  citation(
    CONTEXT_PACK_CITATION_KINDS.APPLICATION_MAP,
    'project-map://application-map',
    'map-revision-4',
    'd'
  )
);
const git = section(
  CONTEXT_PACK_SECTION_IDS.GIT,
  'git-head-e31d083',
  'Branch de refatoração limpa, salvo um arquivo local não rastreado do usuário.',
  citation(
    CONTEXT_PACK_CITATION_KINDS.GIT,
    'git://HEAD',
    'git-head-e31d083',
    'e'
  )
);

const compiler = createContextPackCompiler({
  now: () => '2026-08-24T12:00:00.000Z',
  maxSummaryChars: 512,
  maxSectionSummaryChars: 96,
});
assert.strictEqual(Object.isFrozen(compiler), true);
assert.deepStrictEqual(Reflect.ownKeys(compiler), ['version', 'compile', 'diagnostics']);
assert.strictEqual(compiler.version, CONTEXT_PACK_COMPILER_VERSION);

const input = Object.freeze({
  requestId: 'request-1',
  projectId: 'project-1',
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
  sections: Object.freeze([git, applicationMap, memory, permissions, request]),
});
const manifest = compiler.compile(input);
assert.strictEqual(Object.isFrozen(manifest), true);
assert.deepStrictEqual(
  manifest.sections.map((entry) => entry.id),
  CONTEXT_PACK_SECTION_ORDER
);
assert.strictEqual(manifest.sections.length, CONTEXT_PACK_SECTION_ORDER.length);
assert.strictEqual(
  manifest.sections.find((entry) => entry.id === CONTEXT_PACK_SECTION_IDS.MILESTONE).state,
  CONTEXT_PACK_SECTION_STATES.UNAVAILABLE
);
assert.strictEqual(
  manifest.sections.find((entry) => entry.id === CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP)
    .truncated,
  true
);
assert(manifest.budget.usedSummaryChars <= manifest.budget.maxSummaryChars);
assert(manifest.budget.truncatedSections.includes(CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP));
assert(manifest.budget.estimatedTokens > 0);
assert.strictEqual(JSON.stringify(manifest).includes('rootPath'), false);
assert.strictEqual(JSON.stringify(manifest).includes('executionId'), false);
for (const manifestSection of manifest.sections) {
  assert.strictEqual(Object.hasOwn(manifestSection, 'content'), false);
  assert.strictEqual(Object.hasOwn(manifestSection, 'rootPath'), false);
  assert.strictEqual(Object.hasOwn(manifestSection, 'executionId'), false);
}

const reordered = compiler.compile(Object.freeze({
  ...input,
  sections: Object.freeze([...input.sections].reverse()),
}));
assert.deepStrictEqual(reordered, manifest);
assert.strictEqual(reordered.packId, manifest.packId);

const revised = compiler.compile(Object.freeze({
  ...input,
  sections: Object.freeze([
    ...input.sections.filter((entry) => entry.id !== CONTEXT_PACK_SECTION_IDS.GIT),
    section(
      CONTEXT_PACK_SECTION_IDS.GIT,
      'git-head-next',
      git.summary,
      citation(
        CONTEXT_PACK_CITATION_KINDS.GIT,
        'git://HEAD',
        'git-head-next',
        'f'
      )
    ),
  ]),
}));
assert.notStrictEqual(revised.packId, manifest.packId);

const laterCompiler = createContextPackCompiler({
  now: () => '2026-08-24T12:01:00.000Z',
  maxSummaryChars: 512,
  maxSectionSummaryChars: 96,
});
const laterManifest = laterCompiler.compile(input);
assert.notStrictEqual(laterManifest.createdAt, manifest.createdAt);
assert.strictEqual(
  laterManifest.packId,
  manifest.packId,
  'pack identity must be stable when only compilation time changes'
);

assert.throws(() => compiler.compile(Object.freeze({
  ...input,
  sections: Object.freeze([...input.sections, request]),
})), /duplicate/i);
assert.throws(() => compiler.compile(Object.freeze({
  ...input,
  sections: Object.freeze(input.sections.filter(
    (entry) => entry.id !== CONTEXT_PACK_SECTION_IDS.REQUEST
  )),
})), /request/i);

let getterCalls = 0;
const hostileInput = {
  requestId: 'request-hostile',
  projectId: 'project-1',
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
};
Object.defineProperty(hostileInput, 'sections', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return Object.freeze([request, permissions]);
  },
});
assert.throws(() => compiler.compile(hostileInput), TypeError);
assert.strictEqual(getterCalls, 0);

let proxyTrapCalls = 0;
const hostileProxy = new Proxy(input, {
  ownKeys(target) {
    proxyTrapCalls += 1;
    return Reflect.ownKeys(target);
  },
});
assert.throws(() => compiler.compile(hostileProxy), TypeError);
assert.strictEqual(proxyTrapCalls, 0);

let thenGetterCalls = 0;
const hostileClockResult = {};
Object.defineProperty(hostileClockResult, 'then', {
  get() {
    thenGetterCalls += 1;
    return () => {};
  },
});
const hostileClockCompiler = createContextPackCompiler({
  now: () => hostileClockResult,
});
assert.throws(() => hostileClockCompiler.compile(input), TypeError);
assert.strictEqual(thenGetterCalls, 0);

assert.deepStrictEqual(compiler.diagnostics(), Object.freeze({
  version: CONTEXT_PACK_COMPILER_VERSION,
  compilations: 3,
  lastPackId: revised.packId,
  maxSummaryChars: 512,
  maxSectionSummaryChars: 96,
}));

console.log('context-pack-compiler.test.js: ok');
