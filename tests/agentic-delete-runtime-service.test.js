'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  createAnchoredFilesystemMutationProbe,
} = require('../main/capabilities/anchored_filesystem_mutation_backend_contract');
const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');
const {
  createAgenticDeleteRuntimeService,
} = require('../main/services/agentic_delete_runtime_service');

const bound = createCapabilityDelegationBinding({
  projectId: 'project-a',
  canonicalRootPath: '/projects/a',
  realRootPath: '/projects/a',
  sessionId: 'session-a',
  jobId: 'job-a',
  kernelId: 'kernel-a',
  submissionDigest: `sha256:${'a'.repeat(64)}`,
});
const lease = Object.freeze({ document: 1 });
let lifecycleActive = true;
let rootActive = true;

const testJournalKey = Buffer.alloc(32, 0x2a);
const testJournalAuthenticator = Object.freeze({
  seal(_rootPath, value) {
    return `hmac-sha256:${crypto
      .createHmac('sha256', testJournalKey)
      .update(canonicalSha256Digest(value), 'utf8')
      .digest('hex')}`;
  },
  verify(rootPath, value, tag) {
    if (typeof tag !== 'string') return false;
    const expected = this.seal(rootPath, value);
    return expected.length === tag.length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(tag));
  },
});

function exists(entryPath) {
  try { fs.lstatSync(entryPath); return true; } catch { return false; }
}

function createTestAnchoredBackend() {
  const probe = createAnchoredFilesystemMutationProbe({
    backendId: 'runtime-integration-test-backend',
    state: 'enforced',
    guarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
    reasonCode: 'ENFORCED',
  });
  return Object.freeze({
    probe() { return probe; },
    prepare(input) {
      const targets = input.targets.map((target) => ({ ...target }));
      const identities = targets.map((target) => {
        const targetPath = path.join(input.rootPath, ...target.relativePath.split('/'));
        const stat = fs.lstatSync(targetPath);
        return { dev: stat.dev, ino: stat.ino };
      });
      let closed = false;
      function verify() {
        if (closed) return { verified: false };
        return {
          verified: targets.every((target, index) => {
            const targetPath = path.join(input.rootPath, ...target.relativePath.split('/'));
            const payloadPath = path.join(input.payloadPath, target.payloadName);
            const candidate = exists(targetPath) ? targetPath : payloadPath;
            if (!exists(candidate)) return false;
            const stat = fs.lstatSync(candidate);
            return stat.dev === identities[index].dev && stat.ino === identities[index].ino;
          }),
        };
      }
      return Object.freeze({
        schemaVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
        verify,
        moveToQuarantine() {
          if (!verify().verified) throw new Error('identity changed');
          const moved = [];
          for (const target of targets) {
            fs.renameSync(
              path.join(input.rootPath, ...target.relativePath.split('/')),
              path.join(input.payloadPath, target.payloadName)
            );
            moved.push(target.payloadName);
          }
          return { moved };
        },
        restoreFromQuarantine() {
          const restored = [];
          for (const target of [...targets].reverse()) {
            const source = path.join(input.payloadPath, target.payloadName);
            const destination = path.join(input.rootPath, ...target.relativePath.split('/'));
            if (exists(source) && exists(destination)) throw new Error('rollback collision');
            if (exists(source)) {
              fs.renameSync(source, destination);
              restored.push(target.payloadName);
            }
          }
          return { restored };
        },
        purgeQuarantine() {
          fs.rmSync(input.transactionPath, { recursive: true, force: false });
          if (exists(input.headPath)) fs.unlinkSync(input.headPath);
          if (exists(input.anchorPath)) fs.rmSync(input.anchorPath, { recursive: true, force: false });
          return { purged: true };
        },
        close() { closed = true; return { closed: true }; },
      });
    },
  });
}

function makeRuntime() {
  return createAgenticDeleteRuntimeService({
    authorizeLifecycle(candidate) {
      return lifecycleActive
        ? { authorized: true, binding: candidate }
        : { authorized: false };
    },
    authorizeRoot(input) {
      const candidateBinding = input && input.jobId ? input : null;
      const projectId = candidateBinding ? candidateBinding.projectId : input.projectId;
      const rootPath = candidateBinding ? candidateBinding.canonicalRootPath : input.rootPath;
      return rootActive
        ? {
          ok: true,
          authorized: true,
          projectId,
          rootPath,
          canonicalRootPath: rootPath,
          realRootPath: rootPath,
        }
        : { ok: false, authorized: false };
    },
    authorizeEffectFrontier(candidate) {
      const binding = candidate && candidate.binding ? candidate.binding : candidate;
      return lifecycleActive && rootActive
        ? { authorized: true, binding }
        : { authorized: false };
    },
    getWindowLease: () => lease,
    getActorId: () => 'actor-main',
    showNativeDialog: async () => ({ response: 0 }),
    pathStyle: 'posix',
    caseSensitive: false,
  });
}

(async () => {
  const runtime = makeRuntime();
  const diagnostics = runtime.diagnostics();
  assert.strictEqual(diagnostics.available, false);
  assert.strictEqual(diagnostics.backendState, 'unavailable');
  assert.strictEqual(JSON.stringify(diagnostics).includes('/projects/a'), false);

  const denied = await runtime.executeDeletePaths({
    binding: bound,
    requestedMode: 'ask_each',
    paths: ['src/obsolete.txt'],
    projectLabel: 'Projeto A',
  });
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.status, 'failed');
  assert.strictEqual(denied.errorCode, 'INVALID_REQUEST');
  assert.strictEqual(JSON.stringify(denied).includes('/projects/a'), false);

  assert.deepStrictEqual(runtime.beforeAuthorityRelease({
    binding: bound,
    reason: 'job_cancelled',
    terminalStatus: null,
  }), { ok: true });
  assert.deepStrictEqual(runtime.beforeAuthorityRelease({
    binding: bound,
    reason: 'job_terminal',
    terminalStatus: 'completed',
  }), { ok: true });
  assert.deepStrictEqual(runtime.beforeAuthorityRelease({
    binding: bound,
    reason: 'job_terminal',
    terminalStatus: 'unknown',
  }), { ok: false });

  const invalidated = runtime.invalidateWindow('renderer_navigation');
  assert.strictEqual(invalidated.ok, true);
  const cleared = runtime.clear();
  assert.strictEqual(cleared.ok, true);

  assert.throws(() => createAgenticDeleteRuntimeService({
    authorizeLifecycle() {},
    authorizeRoot() {},
    authorizeEffectFrontier() {},
    getWindowLease() {},
    getActorId() {},
    showNativeDialog() {},
    pathStyle: 'posix',
    caseSensitive: false,
    unexpected: true,
  }), /unsupported fields/);

  lifecycleActive = false;
  rootActive = false;
  const inactive = await makeRuntime().executeDeletePaths({
    binding: bound,
    requestedMode: 'delegate_task',
    paths: ['src/obsolete.txt'],
    projectLabel: 'Projeto A',
  });
  assert.strictEqual(inactive.ok, false);
  assert.strictEqual(inactive.status, 'denied');
  assert.strictEqual(inactive.errorCode, 'CONTEXT_INVALID');

  lifecycleActive = true;
  const contradictoryRootRuntime = createAgenticDeleteRuntimeService({
    authorizeLifecycle(candidate) {
      return { authorized: true, binding: candidate };
    },
    authorizeRoot(input) {
      const candidate = input && input.jobId ? input : null;
      const projectId = candidate ? candidate.projectId : input.projectId;
      const canonicalRootPath = candidate ? candidate.canonicalRootPath : input.rootPath;
      return {
        ok: true,
        authorized: false,
        projectId,
        rootPath: canonicalRootPath,
        canonicalRootPath,
        realRootPath: canonicalRootPath,
      };
    },
    authorizeEffectFrontier(candidate) {
      return { authorized: true, binding: candidate.binding || candidate };
    },
    getWindowLease: () => lease,
    getActorId: () => 'actor-main',
    showNativeDialog: async () => ({ response: 0 }),
    pathStyle: 'posix',
    caseSensitive: false,
  });
  const contradictoryRoot = await contradictoryRootRuntime.executeDeletePaths({
    binding: bound,
    requestedMode: 'ask_each',
    paths: ['src/obsolete.txt'],
    projectLabel: 'Projeto A',
  });
  assert.strictEqual(contradictoryRoot.status, 'denied');
  assert.strictEqual(contradictoryRoot.errorCode, 'CONTEXT_INVALID');

  // Real composition smoke: the same binding crosses consent, broker,
  // transaction and terminal purge without exposing any bearer authority.
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-delete-runtime-'));
  try {
    const realRootPath = fs.realpathSync(rootPath);
    fs.mkdirSync(path.join(realRootPath, 'src'));
    fs.writeFileSync(path.join(realRootPath, 'src', 'obsolete.txt'), 'obsolete');
    const integrationBinding = createCapabilityDelegationBinding({
      ...bound,
      canonicalRootPath: realRootPath,
      realRootPath,
      jobId: 'job-integration',
    });
    lifecycleActive = true;
    rootActive = true;
    const integrationRuntime = createAgenticDeleteRuntimeService({
      authorizeLifecycle(candidate) {
        return { authorized: true, binding: candidate };
      },
      authorizeRoot(input) {
        const candidate = input && input.jobId ? input : null;
        const projectId = candidate ? candidate.projectId : input.projectId;
        const canonicalRootPath = candidate ? candidate.canonicalRootPath : input.rootPath;
        return {
          ok: true,
          authorized: true,
          projectId,
          rootPath: canonicalRootPath,
          canonicalRootPath,
          realRootPath: canonicalRootPath,
        };
      },
      authorizeEffectFrontier(candidate) {
        const candidateBinding = candidate.binding || candidate;
        return {
          authorized: true,
          binding: candidateBinding,
          ...(candidate.windowLease ? { windowLease: candidate.windowLease } : {}),
        };
      },
      getWindowLease: () => lease,
      getActorId: () => 'actor-main',
      showNativeDialog: async () => ({ response: 1 }),
      mutationBackend: createTestAnchoredBackend(),
      journalAuthenticator: testJournalAuthenticator,
      pathStyle: 'posix',
      caseSensitive: true,
    });
    assert.strictEqual(integrationRuntime.diagnostics().available, true);
    const integrated = await integrationRuntime.executeDeletePaths({
      binding: integrationBinding,
      requestedMode: 'ask_each',
      paths: ['src/obsolete.txt'],
      projectLabel: 'Projeto de integração',
    });
    assert.strictEqual(integrated.ok, true);
    assert.strictEqual(integrated.status, 'completed');
    assert.strictEqual(integrated.state, 'COMMITTED');
    assert.strictEqual(exists(path.join(realRootPath, 'src', 'obsolete.txt')), false);
    assert.strictEqual(JSON.stringify(integrated).includes(realRootPath), false);
    assert.deepStrictEqual(integrationRuntime.beforeAuthorityRelease({
      binding: integrationBinding,
      reason: 'job_terminal',
      terminalStatus: 'completed',
    }), { ok: true });
    const transactionsPath = path.join(realRootPath, '.faber', 'transactions');
    assert.deepStrictEqual(fs.readdirSync(transactionsPath), []);
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }

  console.log('agentic delete runtime service tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
