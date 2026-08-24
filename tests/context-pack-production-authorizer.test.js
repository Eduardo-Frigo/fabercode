'use strict';

const assert = require('assert');

const {
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
} = require('../main/agent_runtime/context_pack_contracts');
const {
  CONTEXT_PACK_PRODUCTION_AUTHORIZER_VERSION,
  createContextPackProductionAuthorizer,
} = require('../main/services/context_pack_production_authorizer');

const digest = (character) => `sha256:${character.repeat(64)}`;

function authorization(overrides = {}) {
  return {
    authorized: true,
    authorityDigest: digest('a'),
    requestId: 'request-1',
    projectId: 'project-1',
    sourceScope: {
      projectId: 'project-1',
      rootPath: '/workspace/project',
      jobId: null,
      conversationId: 'conversation-1',
      userId: 'user-1',
      relativeCwd: 'src',
      relevantFiles: ['package.json', 'src/index.js'],
    },
    requestText: 'Continue a refatoração guiada por TDD.',
    permissionsText: 'Leitura contextual autorizada; nenhuma mutação autorizada.',
    ...overrides,
  };
}

const calls = [];
const bundle = createContextPackProductionAuthorizer({
  authorizeBinding(input) {
    calls.push(input);
    return authorization();
  },
});
assert.strictEqual(Object.isFrozen(bundle), true);
assert.deepStrictEqual(Reflect.ownKeys(bundle), ['version', 'authorizer', 'diagnostics']);
assert.strictEqual(bundle.version, CONTEXT_PACK_PRODUCTION_AUTHORIZER_VERSION);
assert.strictEqual(Object.isFrozen(bundle.authorizer), true);

const binding = Object.freeze({ turnId: 'turn-1' });
const input = Object.freeze({
  binding,
  surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE,
});
const grant = bundle.authorizer.authorize(input);
assert.strictEqual(grant.requestId, 'request-1');
assert.strictEqual(grant.projectId, 'project-1');
assert.strictEqual(grant.surface, CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE);
assert.strictEqual(grant.authorityDigest, digest('a'));
assert.strictEqual(grant.requestSection.id, CONTEXT_PACK_SECTION_IDS.REQUEST);
assert.strictEqual(grant.requestSection.state, CONTEXT_PACK_SECTION_STATES.AVAILABLE);
assert.strictEqual(grant.requestSection.summary, 'Continue a refatoração guiada por TDD.');
assert.strictEqual(
  grant.requestSection.citations[0].locator,
  'runtime://request/request-1'
);
assert.strictEqual(grant.permissionsSection.id, CONTEXT_PACK_SECTION_IDS.PERMISSIONS);
assert.strictEqual(grant.permissionsSection.state, CONTEXT_PACK_SECTION_STATES.AVAILABLE);
assert.strictEqual(
  grant.permissionsSection.citations[0].locator,
  'authority://request/request-1'
);
assert.strictEqual(grant.permissionsSection.citations[0].digest, digest('a'));
assert.deepStrictEqual(grant.sourceScope.relevantFiles, ['package.json', 'src/index.js']);
assert.strictEqual(JSON.stringify([
  grant.requestSection,
  grant.permissionsSection,
]).includes('/workspace/project'), false);
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0], input);
assert.deepStrictEqual(bundle.diagnostics(), Object.freeze({
  version: CONTEXT_PACK_PRODUCTION_AUTHORIZER_VERSION,
  authorizations: 1,
  rejections: 0,
}));

const jobBundle = createContextPackProductionAuthorizer({
  authorizeBinding: () => authorization({
    sourceScope: {
      ...authorization().sourceScope,
      jobId: 'job-7',
    },
  }),
});
const jobGrant = jobBundle.authorizer.authorize(input);
assert.strictEqual(
  jobGrant.permissionsSection.citations[0].locator,
  'authority://job/job-7'
);

const deniedBundle = createContextPackProductionAuthorizer({
  authorizeBinding: () => ({ ...authorization(), authorized: false }),
});
assert.throws(() => deniedBundle.authorizer.authorize(input), TypeError);
assert.deepStrictEqual(deniedBundle.diagnostics(), Object.freeze({
  version: CONTEXT_PACK_PRODUCTION_AUTHORIZER_VERSION,
  authorizations: 0,
  rejections: 1,
}));

const asyncBundle = createContextPackProductionAuthorizer({
  authorizeBinding: () => Promise.resolve(authorization()),
});
assert.throws(() => asyncBundle.authorizer.authorize(input), /synchronous/i);

let getterCalls = 0;
const hostileAuthorization = authorization();
Object.defineProperty(hostileAuthorization, 'requestText', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return 'hostile';
  },
});
const hostileBundle = createContextPackProductionAuthorizer({
  authorizeBinding: () => hostileAuthorization,
});
assert.throws(() => hostileBundle.authorizer.authorize(input), TypeError);
assert.strictEqual(getterCalls, 0);

const disclosureBundle = createContextPackProductionAuthorizer({
  authorizeBinding: () => authorization({
    requestText: 'Leia /workspace/project/private.txt.',
  }),
});
assert.throws(() => disclosureBundle.authorizer.authorize(input), /rootPath/i);

assert.throws(() => createContextPackProductionAuthorizer({
  authorizeBinding: new Proxy(() => authorization(), {}),
}), /authorizeBinding/i);

console.log('context-pack-production-authorizer.test.js: ok');
