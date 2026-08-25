'use strict';

const assert = require('assert');

const {
  CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION,
  CANARY_EDIT_ACTION_CLASSIFIER_REASONS,
  CANARY_EDIT_ACTION_CLASSIFIER_VERSION,
  classifyCanaryEditAction,
} = require('../main/agent_runtime/canary_edit_action_classifier');
const {
  evaluateCanaryEditAdmission,
} = require('../main/agent_runtime/canary_edit_admission_policy');

const HASH = 'a'.repeat(64);

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

function assertEligible(action, expected) {
  const result = classifyCanaryEditAction(action);
  assert.strictEqual(result.eligible, true);
  assert.strictEqual(result.reason, CANARY_EDIT_ACTION_CLASSIFIER_REASONS.ELIGIBLE);
  assert.deepStrictEqual(result.editProfile, {
    kind: 'local_edit',
    installRequested: false,
    networkRequested: false,
  });
  assert.deepStrictEqual(result.summary, expected);
  assertDeepFrozen(result);
  return result;
}

function assertDenied(action, reason) {
  const result = classifyCanaryEditAction(action);
  assert.strictEqual(result.eligible, false);
  assert.strictEqual(result.reason, reason);
  assert.strictEqual(result.editProfile, null);
  assertDeepFrozen(result);
  return result;
}

assert.strictEqual(
  CANARY_EDIT_ACTION_CLASSIFIER_VERSION,
  'canary-edit-action-classifier.v1'
);
assert.strictEqual(
  CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION,
  'canary-edit-action-classification.v1'
);
assert.deepStrictEqual(CANARY_EDIT_ACTION_CLASSIFIER_REASONS, {
  ELIGIBLE: 'eligible_local_edit',
  INVALID_ACTION: 'invalid_action',
  UNSUPPORTED_ACTION: 'unsupported_action',
  UNSUPPORTED_OPERATION: 'unsupported_operation',
  UNSAFE_PATH: 'unsafe_path',
  CONTENT_INVALID: 'content_invalid',
  LIMIT_EXCEEDED: 'limit_exceeded',
  EXTERNAL_EFFECT_REQUESTED: 'external_effect_requested',
});

const patch = assertEligible({
  type: 'apply_file_patch',
  targetFile: 'src/app.js',
  previousContentHash: HASH,
  nextContent: 'export const value = 2;\n',
}, {
  actionType: 'apply_file_patch',
  operationCount: 1,
  writeCount: 1,
  directoryCount: 0,
  totalContentBytes: 24,
});

assertEligible({
  type: 'edit_file_fuzzy',
  targetFile: 'src/app.js',
  targetContent: 'value = 1',
  replacementContent: 'value = 2',
}, {
  actionType: 'edit_file_fuzzy',
  operationCount: 1,
  writeCount: 1,
  directoryCount: 0,
  totalContentBytes: 18,
});

assertEligible({
  type: 'operation_batch',
  operations: [
    { op: 'mkdir', path: 'src/components' },
    { op: 'write_file', path: 'src/components/card.js', content: 'card\n' },
    { op: 'append_file', path: 'src/index.js', content: 'export {};\n' },
  ],
}, {
  actionType: 'operation_batch',
  operationCount: 3,
  writeCount: 2,
  directoryCount: 1,
  totalContentBytes: 16,
});

assertEligible({
  type: 'write_files',
  rootPath: '/workspace/project-a',
  executionCommand: {
    protocol: 'faber-exec-v2',
    task_type: 'apply_file_patch',
    root_path: '/workspace/project-a',
    target_file: 'src/app.js',
    previous_content_hash: HASH,
    next_content: 'next\n',
  },
}, {
  actionType: 'apply_file_patch',
  operationCount: 1,
  writeCount: 1,
  directoryCount: 0,
  totalContentBytes: 5,
});

assertEligible({
  type: 'write_files',
  executionCommand: {
    protocol: 'faber-exec-v2',
    task_type: 'execute_operation_batch',
    operations: [{ op: 'write_file', path: 'src/app.js', content: 'ok' }],
  },
}, {
  actionType: 'operation_batch',
  operationCount: 1,
  writeCount: 1,
  directoryCount: 0,
  totalContentBytes: 2,
});

const admission = evaluateCanaryEditAdmission({
  runtimeMode: 'canary',
  projectAuthorization: {
    authorized: true,
    binding: {
      projectId: 'project-a',
      canonicalRootPath: '/workspace/project-a',
      realRootPath: '/real/workspace/project-a',
      sessionId: 'session-canary-a',
      jobId: 'job-canary-a',
      kernelId: 'codex-app-server-canary',
      submissionDigest: `sha256:${HASH}`,
    },
  },
  editProfile: patch.editProfile,
  checkpoint: {
    checkpointDigest: `sha256:${'b'.repeat(64)}`,
    checkpointVerified: true,
    projectId: 'project-a',
    canonicalRootPath: '/workspace/project-a',
    jobId: 'job-canary-a',
  },
  rootMutation: {
    canonicalRootPath: '/workspace/project-a',
    ownerJobId: 'job-canary-a',
    activeOtherMutatingJobs: 0,
  },
});
assert.strictEqual(admission.eligible, true);

for (const action of [
  null,
  {},
  new Proxy({ type: 'apply_file_patch' }, {}),
]) {
  assertDenied(action, CANARY_EDIT_ACTION_CLASSIFIER_REASONS.INVALID_ACTION);
}

for (const action of [
  { type: 'create_application' },
  { type: 'search_text_in_files', targetText: 'value' },
  { type: 'write_files', files: [{ path: 'src/app.js', content: 'unsafe ambiguity' }] },
  {
    type: 'apply_file_patch',
    targetFile: 'src/app.js',
    previousContentHash: HASH,
    nextContent: 'ok',
    executionCommand: { task_type: 'npm_install' },
  },
]) {
  assertDenied(action, CANARY_EDIT_ACTION_CLASSIFIER_REASONS.UNSUPPORTED_ACTION);
}

for (const flag of [
  'installRequested',
  'networkRequested',
  'requiresInstall',
  'requiresNetwork',
]) {
  assertDenied({
    type: 'apply_file_patch',
    targetFile: 'src/app.js',
    previousContentHash: HASH,
    nextContent: 'ok',
    [flag]: true,
  }, CANARY_EDIT_ACTION_CLASSIFIER_REASONS.EXTERNAL_EFFECT_REQUESTED);
}
assertDenied({
  type: 'apply_file_patch',
  targetFile: 'src/app.js',
  previousContentHash: HASH,
  nextContent: 'ok',
  effects: ['filesystem_write', 'network_access'],
}, CANARY_EDIT_ACTION_CLASSIFIER_REASONS.EXTERNAL_EFFECT_REQUESTED);

for (const operation of [
  { op: 'delete_file', path: 'src/app.js' },
  { op: 'run_command', path: 'npm install' },
  { op: 'write_file', path: 'src/app.js' },
]) {
  assertDenied(
    { type: 'operation_batch', operations: [operation] },
    operation.op === 'write_file'
      ? CANARY_EDIT_ACTION_CLASSIFIER_REASONS.CONTENT_INVALID
      : CANARY_EDIT_ACTION_CLASSIFIER_REASONS.UNSUPPORTED_OPERATION
  );
}

for (const targetFile of [
  '../outside.js',
  '/tmp/outside.js',
  'C:\\outside.js',
  '.git/config',
  'src/.git/config',
  '.faber/state.json',
  'node_modules/pkg/index.js',
  '.env',
]) {
  assertDenied({
    type: 'apply_file_patch',
    targetFile,
    previousContentHash: HASH,
    nextContent: 'blocked',
  }, CANARY_EDIT_ACTION_CLASSIFIER_REASONS.UNSAFE_PATH);
}

assertDenied({
  type: 'operation_batch',
  operations: Array.from({ length: 33 }, (_, index) => ({
    op: 'write_file',
    path: `src/${index}.js`,
    content: 'x',
  })),
}, CANARY_EDIT_ACTION_CLASSIFIER_REASONS.LIMIT_EXCEEDED);
assertDenied({
  type: 'apply_file_patch',
  targetFile: 'src/large.js',
  previousContentHash: HASH,
  nextContent: 'x'.repeat(2 * 1024 * 1024 + 1),
}, CANARY_EDIT_ACTION_CLASSIFIER_REASONS.LIMIT_EXCEEDED);

const sparseOperations = [];
sparseOperations.length = 1;
assertDenied(
  { type: 'operation_batch', operations: sparseOperations },
  CANARY_EDIT_ACTION_CLASSIFIER_REASONS.INVALID_ACTION
);

let getterCalls = 0;
const accessorAction = {};
Object.defineProperty(accessorAction, 'type', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return 'apply_file_patch';
  },
});
assertDenied(accessorAction, CANARY_EDIT_ACTION_CLASSIFIER_REASONS.INVALID_ACTION);
assert.strictEqual(getterCalls, 0);

console.log('canary edit action classifier tests passed');
