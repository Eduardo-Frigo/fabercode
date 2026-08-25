'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createExecutionWorkspaceRegistry,
} = require('../main/capabilities/execution_workspace_registry');
const {
  createProjectRootAuthorityRegistry,
} = require('../main/capabilities/project_root_authority_registry');
const {
  CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
  CANARY_ROLLOUT_GATE_STATUSES,
} = require('../main/agent_runtime/canary_rollout_evidence_ledger');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  createExecuteRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  createHarnessRuntimeConfig,
} = require('../main/agent_runtime/harness_runtime_config');
const {
  createLegacyKernelAdapter,
} = require('../main/agent_runtime/legacy_kernel_adapter');
const {
  createAssistantJobAuthorityService,
} = require('../main/services/assistant_job_authority_service');
const {
  CANARY_EDIT_PRODUCTION_KERNEL_ID,
  createCanaryEditProductionRuntime,
} = require('../main/services/canary_edit_production_runtime');
const {
  createCanaryInternalRolloutPolicy,
} = require('../main/services/canary_internal_rollout_policy');
const {
  createPortableExecutionWorkspaceBackend,
} = require('../main/services/portable_isolation_helper_execution_workspace_backend');
const {
  createPortableProjectRootAuthorityBackend,
} = require('../main/services/portable_isolation_helper_project_root_authority_backend');

function sha256(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function physicalRootIdentity(rootPath) {
  const entry = fs.lstatSync(rootPath);
  const target = fs.statSync(rootPath);
  return Object.freeze({
    device: String(target.dev),
    inode: String(target.ino),
    entryDevice: String(entry.dev),
    entryInode: String(entry.ino),
    entryType: entry.isSymbolicLink() ? 'symlink' : 'directory',
  });
}

function evidence({
  jobId,
  projectId,
  route,
  succeeded,
}) {
  return Object.freeze({
    schemaVersion: CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
    jobId,
    projectId,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    route,
    eligible: true,
    terminal: true,
    succeeded,
    manualRollback: false,
    corrupted: false,
    dataLossIncident: false,
    securityIncident: false,
    duplicateExternalEffect: false,
  });
}

async function main() {
  const fixtureRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'faber-phase5-internal-real-sample-'
  ));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const sourceFile = path.join(sourceRoot, 'src', 'app.js');
  const unrelatedFile = path.join(sourceRoot, 'notes.txt');
  const gitHead = path.join(sourceRoot, '.git', 'HEAD');
  const gitRef = path.join(sourceRoot, '.git', 'refs', 'heads', 'main');
  const gitIndex = path.join(sourceRoot, '.git', 'index');
  const originalSource = Buffer.from('module.exports = "original";\n', 'utf8');
  const promotedSource = Buffer.from('module.exports = "internal-canary";\n', 'utf8');
  const unrelatedBytes = Buffer.from('user-owned dirty note\n', 'utf8');
  const headBytes = Buffer.from('ref: refs/heads/main\n', 'utf8');
  const refBytes = Buffer.from(`${'7'.repeat(40)}\n`, 'utf8');
  const indexBytes = Buffer.from('user-index-state-v1\n', 'utf8');

  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.mkdirSync(path.dirname(gitRef), { recursive: true });
  fs.writeFileSync(sourceFile, originalSource);
  fs.writeFileSync(unrelatedFile, unrelatedBytes);
  fs.writeFileSync(gitHead, headBytes);
  fs.writeFileSync(gitRef, refBytes);
  fs.writeFileSync(gitIndex, indexBytes);

  const realRootPath = fs.realpathSync(sourceRoot);
  const physicalIdentity = physicalRootIdentity(sourceRoot);
  const projectId = 'phase5-internal-project';
  const jobId = 'phase5-internal-job';
  const requestPayload = Object.freeze({
    userMessage: 'Aplique uma edição local de baixo risco.',
    attachments: Object.freeze([]),
  });
  const jobs = new Map();

  function authorizeProjectBinding(inputProjectId, inputRootPath) {
    if (inputProjectId !== projectId || inputRootPath !== sourceRoot) {
      return Object.freeze({ authorized: false });
    }
    return Object.freeze({
      ok: true,
      authorized: true,
      projectId,
      canonicalRootPath: sourceRoot,
      rootPath: sourceRoot,
      realRootPath,
      physicalRootIdentity: physicalIdentity,
    });
  }

  const authorityService = createAssistantJobAuthorityService({
    authorizeProjectBinding,
    getJobById(inputJobId) {
      const job = jobs.get(inputJobId);
      return job
        ? Object.freeze({ ok: true, job })
        : Object.freeze({ ok: false, message: 'missing' });
    },
    now: () => 1_000,
    sessionIdFactory: () => `session_${'s'.repeat(24)}`,
    submissionIdFactory: () => `submission_${'u'.repeat(24)}`,
  });
  const started = authorityService.beginSubmission({
    projectId,
    rootPath: sourceRoot,
    kernelId: CANARY_EDIT_PRODUCTION_KERNEL_ID,
    request: requestPayload,
  });
  assert.strictEqual(started.ok, true);
  const job = {
    id: jobId,
    status: 'running',
    phase: 'persona_plan',
    projectId,
    rootPath: sourceRoot,
    request: requestPayload,
    retryState: { retryable: true },
    authorityContext: started.authorityContext,
  };
  jobs.set(jobId, job);
  const bound = authorityService.bindJob({
    submissionId: started.submissionId,
    jobId,
  });
  assert.strictEqual(bound.authorized, true);

  const action = deepFreeze({
    type: 'apply_file_patch',
    targetFile: 'src/app.js',
    previousContentHash: sha256(originalSource),
    nextContent: promotedSource.toString('utf8'),
  });
  const actionBinding = authorityService.bindAction({
    binding: bound.binding,
    action,
  });
  assert.strictEqual(actionBinding.authorized, true);
  job.authorityContext = actionBinding.authorityContext;
  job.phase = 'awaiting_user_confirmation';

  const executionContext = { jobId };
  Object.defineProperty(executionContext, 'authorityBinding', {
    enumerable: false,
    value: bound.binding,
  });
  Object.freeze(executionContext);
  const request = createExecuteRequest(
    action,
    deepFreeze({
      id: projectId,
      projectId,
      rootPath: sourceRoot,
    }),
    {
      requestId: 'phase5-internal-request',
      executionContext,
    }
  );

  const projectRootAuthorityRegistry = createProjectRootAuthorityRegistry({
    backend: createPortableProjectRootAuthorityBackend(),
    leaseIdFactory: () => 'phase5-internal-root-lease',
    maxActiveLeases: 2,
  });
  const executionWorkspaceRegistry = createExecutionWorkspaceRegistry({
    backend: createPortableExecutionWorkspaceBackend(),
    leaseIdFactory: () => 'phase5-internal-workspace-lease',
    maxActiveWorkspaces: 2,
  });
  const runtimeConfig = createHarnessRuntimeConfig({
    env: { FABER_HARNESS_V2_MODE: 'canary' },
  });
  const rolloutPolicy = createCanaryInternalRolloutPolicy({
    runtimeConfig,
    authorizeProjectBinding,
  });
  let legacyCalls = 0;
  const authoritativeKernel = createLegacyKernelAdapter({
    async plan() {
      return Object.freeze({ ok: true, action: null });
    },
    async message() {
      return Object.freeze({ ok: true, response: 'legacy' });
    },
    async execute() {
      legacyCalls += 1;
      return Object.freeze({ ok: true, engine: 'legacy' });
    },
  });
  let clientCloseCalls = 0;
  const terminalCompletions = [];
  const terminalFailures = [];
  const client = Object.freeze({
    close() {
      clientCloseCalls += 1;
      return Promise.resolve(Object.freeze({
        ok: true,
        closed: true,
        processTerminated: true,
        forced: false,
        exited: true,
      }));
    },
    status() {
      return Object.freeze({ state: 'ready' });
    },
  });

  let runtime = null;
  try {
    runtime = createCanaryEditProductionRuntime({
      runtimeConfig,
      adapterEnabled: true,
      authoritativeKernel,
      authorityService,
      projectRootAuthorityRegistry,
      executionWorkspaceRegistry,
      inspectRootMutation(binding) {
        return Object.freeze({
          canonicalRootPath: binding.canonicalRootPath,
          ownerJobId: binding.jobId,
          activeOtherMutatingJobs: 0,
        });
      },
      inspectRollout: rolloutPolicy.inspect,
      promotionIdFactory: () => 'phase5-internal-promotion',
      cohortSeed: 'phase5-internal-real-sample-v1',
      client,
      onCanaryCompleted(observation) {
        terminalCompletions.push(observation);
        return Object.freeze({ ok: true });
      },
      onCanaryFailed(observation) {
        terminalFailures.push(observation);
        return Object.freeze({ ok: true });
      },
      minimumCanaryJobs: 1,
      minimumBaselineJobs: 1,
    });
    assert.strictEqual(runtime.diagnostics().runtime.state, 'ready');

    const result = await runtime.canaryEditRunner.execute(request);
    assert.strictEqual(result.kernelId, CANARY_EDIT_PRODUCTION_KERNEL_ID);
    assert.strictEqual(result.output.status, 'completed');
    assert.strictEqual(result.output.mutationScope, 'staging');
    assert.deepStrictEqual(result.output.changedPaths, ['src/app.js']);
    assert.strictEqual(legacyCalls, 0);
    assert.strictEqual(terminalCompletions.length, 1);
    assert.deepStrictEqual(terminalCompletions[0], {
      jobId,
      projectId,
      requestId: request.requestId,
      changedPaths: ['src/app.js'],
      writeSetDigest: result.output.writeSetDigest,
    });
    assert.strictEqual(terminalFailures.length, 0);
    assert.deepStrictEqual(fs.readFileSync(sourceFile), promotedSource);
    assert.deepStrictEqual(fs.readFileSync(unrelatedFile), unrelatedBytes);
    assert.deepStrictEqual(fs.readFileSync(gitHead), headBytes);
    assert.deepStrictEqual(fs.readFileSync(gitRef), refBytes);
    assert.deepStrictEqual(fs.readFileSync(gitIndex), indexBytes);
    assert.strictEqual(
      executionWorkspaceRegistry.diagnostics().active,
      0
    );
    assert.strictEqual(
      executionWorkspaceRegistry.diagnostics().quarantined,
      0
    );
    assert.strictEqual(projectRootAuthorityRegistry.diagnostics().active, 0);
    assert.strictEqual(projectRootAuthorityRegistry.diagnostics().quarantined, 0);

    runtime.evidenceSink.record(evidence({
      jobId: 'phase5-internal-baseline-job',
      projectId: 'phase5-internal-baseline-project',
      route: 'baseline',
      succeeded: true,
    }));
    const snapshot = runtime.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL);
    assert.strictEqual(snapshot.gate.status, CANARY_ROLLOUT_GATE_STATUSES.PASS);
    assert.strictEqual(snapshot.totals.baselineJobs, 1);
    assert.strictEqual(snapshot.totals.canaryJobs, 1);
    assert.strictEqual(snapshot.totals.manualRollbacks, 0);
    assert.strictEqual(snapshot.totals.corruptedJobs, 0);
    assert.strictEqual(snapshot.totals.dataLossIncidents, 0);
    assert.strictEqual(snapshot.totals.securityIncidents, 0);
    assert.strictEqual(snapshot.totals.duplicateExternalEffects, 0);
    const advancement = runtime.advancement(CANARY_ROLLOUT_STAGES.INTERNAL);
    assert.strictEqual(advancement.allowed, true);
    assert.strictEqual(advancement.toStage, CANARY_ROLLOUT_STAGES.PERCENT_1);

    const closeReceipt = await runtime.close();
    assert.strictEqual(closeReceipt.ok, true);
    assert.strictEqual(closeReceipt.drained, true);
    assert.strictEqual(closeReceipt.clientClosed, true);
    assert.strictEqual(clientCloseCalls, 1);
  } finally {
    if (runtime) {
      try { await runtime.close(); } catch { /* cleanup continues */ }
    }
    await executionWorkspaceRegistry.dispose();
    await projectRootAuthorityRegistry.dispose();
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }

  console.log('canary-phase5-internal-real-sample.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
