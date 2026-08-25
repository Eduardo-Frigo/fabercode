'use strict';

const assert = require('assert');

const {
  CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION,
  CANARY_EDIT_LIFECYCLE_CODES,
  CANARY_EDIT_LIFECYCLE_STATES,
  CANARY_EDIT_LIFECYCLE_VERSION,
  CANARY_EDIT_MUTATION_FRONTIERS,
  createCanaryEditLifecycle,
} = require('../main/agent_runtime/canary_edit_lifecycle');

function createLifecycle(suffix = 'a') {
  return createCanaryEditLifecycle({
    jobId: `job-canary-${suffix}`,
    stagingId: `staging-canary-${suffix}`,
  });
}

function cleanupReceipt(suffix = 'a', overrides = {}) {
  return {
    schemaVersion: CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION,
    jobId: `job-canary-${suffix}`,
    stagingId: `staging-canary-${suffix}`,
    disposition: 'discarded',
    clean: true,
    ...overrides,
  };
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

assert.strictEqual(CANARY_EDIT_LIFECYCLE_VERSION, 'canary-edit-lifecycle.v1');
assert.strictEqual(
  CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION,
  'canary-edit-cleanup-receipt.v1'
);
assert.deepStrictEqual(CANARY_EDIT_LIFECYCLE_STATES, {
  ACTIVE: 'active',
  CLEANUP_REQUIRED: 'cleanup_required',
  FALLBACK_READY: 'fallback_ready',
  LEGACY_STARTED: 'legacy_started',
  CANARY_COMPLETED: 'canary_completed',
  QUARANTINED: 'quarantined',
});
assert.deepStrictEqual(CANARY_EDIT_MUTATION_FRONTIERS, {
  NONE: 'none',
  STAGING: 'staging',
  SOURCE: 'source',
});

const pristine = createLifecycle('pristine');
assert.strictEqual(Object.isFrozen(pristine), true);
assert.strictEqual(pristine.version, CANARY_EDIT_LIFECYCLE_VERSION);
assert.deepStrictEqual(pristine.snapshot(), {
  version: CANARY_EDIT_LIFECYCLE_VERSION,
  state: CANARY_EDIT_LIFECYCLE_STATES.ACTIVE,
  mutationFrontier: CANARY_EDIT_MUTATION_FRONTIERS.NONE,
  fallbackReason: null,
  fallbackAllowed: false,
  cleanupRequired: false,
  requiredCleanupDisposition: null,
});
assertDeepFrozen(pristine.snapshot());

const preWriteFallback = pristine.requestFallback({ reason: 'adapter_unavailable' });
assert.strictEqual(preWriteFallback.ok, true);
assert.strictEqual(preWriteFallback.code, CANARY_EDIT_LIFECYCLE_CODES.FALLBACK_READY);
assert.strictEqual(preWriteFallback.snapshot.fallbackAllowed, true);
assert.strictEqual(preWriteFallback.snapshot.cleanupRequired, false);
assert.strictEqual(pristine.startLegacy().ok, true);
assert.strictEqual(pristine.snapshot().state, CANARY_EDIT_LIFECYCLE_STATES.LEGACY_STARTED);
assert.strictEqual(
  pristine.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING }).ok,
  false
);

const staged = createLifecycle('staged');
const stagedWrite = staged.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING });
assert.strictEqual(stagedWrite.ok, true);
assert.strictEqual(stagedWrite.code, CANARY_EDIT_LIFECYCLE_CODES.WRITE_RECORDED);
assert.strictEqual(staged.snapshot().mutationFrontier, CANARY_EDIT_MUTATION_FRONTIERS.STAGING);
assert.strictEqual(
  staged.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING }).code,
  CANARY_EDIT_LIFECYCLE_CODES.IDEMPOTENT
);
const stagedFallback = staged.requestFallback({ reason: 'canary_execution_failed' });
assert.strictEqual(stagedFallback.ok, false);
assert.strictEqual(stagedFallback.code, CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_REQUIRED);
assert.strictEqual(stagedFallback.snapshot.cleanupRequired, true);
assert.strictEqual(stagedFallback.snapshot.requiredCleanupDisposition, 'discarded_or_reverted');
assert.strictEqual(staged.startLegacy().ok, false);
assert.strictEqual(staged.startLegacy().code, CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_REQUIRED);
const stagedCleanup = staged.confirmCleanup(cleanupReceipt('staged'));
assert.strictEqual(stagedCleanup.ok, true);
assert.strictEqual(stagedCleanup.code, CANARY_EDIT_LIFECYCLE_CODES.FALLBACK_READY);
assert.strictEqual(staged.startLegacy().ok, true);

const source = createLifecycle('source');
assert.strictEqual(
  source.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.SOURCE }).code,
  CANARY_EDIT_LIFECYCLE_CODES.INVALID_TRANSITION
);
assert.strictEqual(
  source.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING }).ok,
  true
);
assert.strictEqual(
  source.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.SOURCE }).ok,
  true
);
assert.strictEqual(source.snapshot().mutationFrontier, CANARY_EDIT_MUTATION_FRONTIERS.SOURCE);
const sourceFallback = source.requestFallback({ reason: 'promotion_failed' });
assert.strictEqual(sourceFallback.code, CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_REQUIRED);
assert.strictEqual(sourceFallback.snapshot.requiredCleanupDisposition, 'reverted');
const sourceCleanup = source.confirmCleanup(cleanupReceipt('source', {
  disposition: 'reverted',
}));
assert.strictEqual(sourceCleanup.ok, true);
assert.strictEqual(source.startLegacy().ok, true);

const insufficient = createLifecycle('insufficient');
insufficient.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING });
insufficient.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.SOURCE });
insufficient.requestFallback({ reason: 'promotion_failed' });
const insufficientCleanup = insufficient.confirmCleanup(cleanupReceipt('insufficient'));
assert.strictEqual(insufficientCleanup.ok, false);
assert.strictEqual(
  insufficientCleanup.code,
  CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_INSUFFICIENT
);
assert.strictEqual(
  insufficient.snapshot().state,
  CANARY_EDIT_LIFECYCLE_STATES.QUARANTINED
);
assert.strictEqual(insufficient.startLegacy().ok, false);

const failedCleanup = createLifecycle('failed-cleanup');
failedCleanup.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING });
failedCleanup.requestFallback({ reason: 'canary_failed' });
const failedReceipt = failedCleanup.confirmCleanup(cleanupReceipt('failed-cleanup', {
  clean: false,
}));
assert.strictEqual(failedReceipt.ok, false);
assert.strictEqual(failedReceipt.code, CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_FAILED);
assert.strictEqual(failedCleanup.snapshot().state, CANARY_EDIT_LIFECYCLE_STATES.QUARANTINED);

const mismatched = createLifecycle('mismatch');
mismatched.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING });
mismatched.requestFallback({ reason: 'canary_failed' });
assert.strictEqual(
  mismatched.confirmCleanup(cleanupReceipt('other')).code,
  CANARY_EDIT_LIFECYCLE_CODES.INVALID_INPUT
);
assert.strictEqual(
  mismatched.snapshot().state,
  CANARY_EDIT_LIFECYCLE_STATES.CLEANUP_REQUIRED
);
assert.strictEqual(mismatched.confirmCleanup(cleanupReceipt('mismatch')).ok, true);

const completed = createLifecycle('completed');
completed.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING });
completed.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.SOURCE });
assert.strictEqual(completed.completeCanary().ok, true);
assert.strictEqual(completed.snapshot().state, CANARY_EDIT_LIFECYCLE_STATES.CANARY_COMPLETED);
assert.strictEqual(
  completed.requestFallback({ reason: 'too_late' }).code,
  CANARY_EDIT_LIFECYCLE_CODES.INVALID_TRANSITION
);
assert.strictEqual(completed.startLegacy().ok, false);
assert.strictEqual(
  completed.completeCanary().code,
  CANARY_EDIT_LIFECYCLE_CODES.IDEMPOTENT
);

for (const invalidCall of [
  () => createLifecycle('invalid-write').noteWrite({ scope: 'workspace' }),
  () => createLifecycle('invalid-fallback').requestFallback({ reason: '' }),
  () => createLifecycle('invalid-cleanup').confirmCleanup(null),
]) {
  const result = invalidCall();
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, CANARY_EDIT_LIFECYCLE_CODES.INVALID_INPUT);
  assertDeepFrozen(result);
}

let getterCalls = 0;
const accessorWrite = {};
Object.defineProperty(accessorWrite, 'scope', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return CANARY_EDIT_MUTATION_FRONTIERS.STAGING;
  },
});
assert.strictEqual(
  createLifecycle('accessor').noteWrite(accessorWrite).code,
  CANARY_EDIT_LIFECYCLE_CODES.INVALID_INPUT
);
assert.strictEqual(getterCalls, 0);
assert.throws(
  () => createCanaryEditLifecycle({ jobId: '', stagingId: 'staging-a' }),
  /options/
);
assert.throws(
  () => createCanaryEditLifecycle(new Proxy({
    jobId: 'job-a',
    stagingId: 'staging-a',
  }, {})),
  /options/
);

console.log('canary edit lifecycle tests passed');
