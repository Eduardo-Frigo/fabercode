'use strict';

const assert = require('assert');

const {
  DEFAULT_ON_ROLLOUT_RUNTIME_CONFIG_VERSION,
  createDefaultOnRolloutRuntimeConfig,
} = require('../main/runtime/default_on_rollout_runtime_config');
const {
  DEFAULT_ON_ROLLOUT_FACTS_SERVICE_VERSION,
  createDefaultOnRolloutFactsService,
} = require('../main/services/default_on_rollout_facts_service');

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      assertDeepFrozen(descriptor.value, seen);
    }
  }
}

function authorization(projectId, rootPath) {
  return Object.freeze({
    ok: true,
    authorized: true,
    projectId,
    rootPath,
    canonicalRootPath: rootPath,
    realRootPath: `/real${rootPath}`,
    physicalRootIdentity: Object.freeze({
      device: '1',
      inode: '2',
      entryDevice: '1',
      entryInode: '2',
      entryType: 'directory',
    }),
  });
}

function identity(overrides = {}) {
  return Object.freeze({
    jobId: 'job-default-production',
    projectId: 'project-alpha',
    rootPath: '/workspace/project-alpha',
    ...overrides,
  });
}

assert.strictEqual(
  DEFAULT_ON_ROLLOUT_RUNTIME_CONFIG_VERSION,
  'default-on-rollout-runtime-config.v1'
);
assert.strictEqual(
  DEFAULT_ON_ROLLOUT_FACTS_SERVICE_VERSION,
  'default-on-rollout-facts-service.v1'
);

const config = createDefaultOnRolloutRuntimeConfig({
  env: {
    FABER_HARNESS_V2_STABLE_RELEASES: '2.8.0, 2.9.0',
    FABER_HARNESS_V2_ALLOWED_PROJECTS: 'project-alpha,project-beta',
    FABER_HARNESS_V2_APPROVED_COHORT: 'project-alpha',
    FABER_HARNESS_V2_PROJECT_PINS: 'project-beta=legacy,project-gamma=v2',
    OPENAI_API_KEY: 'must-never-appear',
  },
});
assert.deepStrictEqual(config, {
  version: DEFAULT_ON_ROLLOUT_RUNTIME_CONFIG_VERSION,
  requested: true,
  valid: true,
  stableReleaseVersions: ['2.8.0', '2.9.0'],
  allowedProjectIds: ['project-alpha', 'project-beta'],
  approvedCohortProjectIds: ['project-alpha'],
  projectPins: [
    { projectId: 'project-beta', pin: 'legacy' },
    { projectId: 'project-gamma', pin: 'v2' },
  ],
  diagnostics: {
    source: 'env',
    requested: true,
    valid: true,
    stableVersionCount: 2,
    allowedProjectCount: 2,
    approvedCohortCount: 1,
    projectPinCount: 2,
    warnings: [],
  },
});
assertDeepFrozen(config);
assert.strictEqual(JSON.stringify(config.diagnostics).includes('project-alpha'), false);
assert.strictEqual(JSON.stringify(config).includes('must-never-appear'), false);

const defaultConfig = createDefaultOnRolloutRuntimeConfig({ env: {} });
assert.strictEqual(defaultConfig.requested, false);
assert.strictEqual(defaultConfig.valid, true);
assert.deepStrictEqual(defaultConfig.stableReleaseVersions, []);
assert.deepStrictEqual(defaultConfig.allowedProjectIds, []);
assert.deepStrictEqual(defaultConfig.approvedCohortProjectIds, []);
assert.deepStrictEqual(defaultConfig.projectPins, []);

for (const env of [
  { FABER_HARNESS_V2_STABLE_RELEASES: '2.9.0,2.9.0' },
  { FABER_HARNESS_V2_ALLOWED_PROJECTS: 'project-alpha,*' },
  { FABER_HARNESS_V2_APPROVED_COHORT: 'project-alpha' },
  { FABER_HARNESS_V2_PROJECT_PINS: 'project-alpha=canary' },
  { FABER_HARNESS_V2_PROJECT_PINS: 'project-alpha=v2,project-alpha=legacy' },
  { FABER_HARNESS_V2_ALLOWED_PROJECTS: 'project-alpha\0project-beta' },
]) {
  const invalid = createDefaultOnRolloutRuntimeConfig({ env });
  assert.strictEqual(invalid.requested, true);
  assert.strictEqual(invalid.valid, false);
  assert.deepStrictEqual(invalid.stableReleaseVersions, []);
  assert.deepStrictEqual(invalid.allowedProjectIds, []);
  assert.deepStrictEqual(invalid.approvedCohortProjectIds, []);
  assert.deepStrictEqual(invalid.projectPins, []);
  assert.deepStrictEqual(invalid.diagnostics.warnings, [
    'Default-on rollout manifest is invalid; legacy routing remains active.',
  ]);
  assertDeepFrozen(invalid);
}

const authorizations = [];
const factsService = createDefaultOnRolloutFactsService({
  runtimeConfig: config,
  authorizeProjectBinding(projectId, rootPath) {
    authorizations.push({ projectId, rootPath });
    return authorization(projectId, rootPath);
  },
});
assert.strictEqual(Object.isFrozen(factsService), true);
assert.deepStrictEqual(Reflect.ownKeys(factsService), [
  'version',
  'resolve',
  'diagnostics',
]);
assert.deepStrictEqual(factsService.resolve(identity()), {
  projectPin: null,
  allowlisted: true,
  approvedCohort: true,
});
assert.deepStrictEqual(authorizations, [{
  projectId: 'project-alpha',
  rootPath: '/workspace/project-alpha',
}]);
assertDeepFrozen(factsService.resolve(identity({
  jobId: 'job-default-production-2',
})));

assert.deepStrictEqual(factsService.resolve(identity({
  jobId: 'job-beta',
  projectId: 'project-beta',
  rootPath: '/workspace/project-beta',
})), {
  projectPin: 'legacy',
  allowlisted: true,
  approvedCohort: false,
});
assert.deepStrictEqual(factsService.resolve(identity({
  jobId: 'job-gamma',
  projectId: 'project-gamma',
  rootPath: '/workspace/project-gamma',
})), {
  projectPin: 'v2',
  allowlisted: false,
  approvedCohort: false,
});
assert.deepStrictEqual(factsService.resolve(identity({
  jobId: 'job-unknown',
  projectId: 'project-unknown',
  rootPath: '/workspace/project-unknown',
})), {
  projectPin: null,
  allowlisted: false,
  approvedCohort: false,
});
assert.deepStrictEqual(factsService.diagnostics(), {
  version: DEFAULT_ON_ROLLOUT_FACTS_SERVICE_VERSION,
  failureMode: 'deny',
  bindingMode: 'exact_authorized_project_root',
  allowedProjectCount: 2,
  approvedCohortCount: 1,
  projectPinCount: 2,
});
assertDeepFrozen(factsService.diagnostics());

const deniedFacts = Object.freeze({
  projectPin: 'legacy',
  allowlisted: false,
  approvedCohort: false,
});
for (const invalid of [
  null,
  {},
  identity({ jobId: '../unsafe' }),
  identity({ projectId: '' }),
  identity({ rootPath: 'relative/path' }),
  Object.freeze({ ...identity(), unexpected: true }),
  new Proxy(identity(), {}),
]) {
  assert.deepStrictEqual(factsService.resolve(invalid), deniedFacts);
}

const rejectedAuthorization = createDefaultOnRolloutFactsService({
  runtimeConfig: config,
  authorizeProjectBinding() {
    return Object.freeze({ authorized: false });
  },
});
assert.deepStrictEqual(rejectedAuthorization.resolve(identity()), deniedFacts);

const mismatchedAuthorization = createDefaultOnRolloutFactsService({
  runtimeConfig: config,
  authorizeProjectBinding(projectId, rootPath) {
    return authorization(projectId, `${rootPath}-changed`);
  },
});
assert.deepStrictEqual(mismatchedAuthorization.resolve(identity()), deniedFacts);

assert.throws(
  () => createDefaultOnRolloutFactsService({
    runtimeConfig: config,
    async authorizeProjectBinding() {
      return authorization('project-alpha', '/workspace/project-alpha');
    },
  }),
  /authorizeProjectBinding|synchronous/i
);
assert.throws(
  () => createDefaultOnRolloutRuntimeConfig({ env: {}, extra: true }),
  /options/i
);

console.log('default-on-rollout-runtime.test.js: ok');
