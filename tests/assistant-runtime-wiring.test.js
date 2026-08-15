const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');

const rootDir = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
const coordinatorSource = fs.readFileSync(
  path.join(rootDir, 'main', 'agent_runtime', 'assistant_execution_coordinator.js'),
  'utf8'
);

function assertInOrder(source, fragments, message) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor + 1);
    assert.ok(next > cursor, `${message}: missing or out of order: ${fragment}`);
    cursor = next;
  }
}

function extractFunctionDeclaration(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function declaration: ${name}`);
  const openingBrace = source.indexOf('{', start);
  assert.ok(openingBrace > start, `missing function body: ${name}`);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function declaration: ${name}`);
}

assertInOrder(
  mainSource,
  [
    'const handleLegacyHarnessPlan = async (payload) => {',
    'normalizeAuthorizedProjectInfo(payload && payload.projectInfo ? payload.projectInfo : null)',
    'buildAssistantPlanResponse({ ...(payload || {}), projectInfo: project.projectInfo })',
  ],
  'legacy plan authorization and delegation must preserve their order'
);

assertInOrder(
  mainSource,
  [
    'const handleLegacyHarnessMessage = async (payload) => {',
    'normalizeAuthorizedProjectInfo(payload && payload.projectInfo ? payload.projectInfo : null)',
    'handleAssistantMessage({ ...(payload || {}), projectInfo: project.projectInfo })',
  ],
  'legacy message authorization and delegation must preserve their order'
);

assertInOrder(
  mainSource,
  [
    'const handleLegacyHarnessExecute = async (action, projectInfo, executionContext = null) => {',
    'const jobId = executionContext && typeof executionContext.jobId === \'string\'',
    'const executionSignal = executionContext && executionContext.signal',
    'project = normalizeAuthorizedProjectInfo(projectInfo || null);',
    "markJobFailed(jobId, 'project_authorization_failed', 'execute_authorization_failed')",
    'initialAction = bindActionToAuthorizedProject(action, projectInfo);',
  ],
  'legacy execute must derive authority before reauthorization and terminalize every rejected job'
);

const legacyExecuteStart = mainSource.indexOf(
  'const handleLegacyHarnessExecute = async (action, projectInfo, executionContext = null) => {'
);
const legacyExecuteEnd = mainSource.indexOf(
  'const legacyHarnessKernel = createLegacyKernelAdapter({',
  legacyExecuteStart
);
const legacyExecuteSource = mainSource.slice(legacyExecuteStart, legacyExecuteEnd);
assert.ok(legacyExecuteStart >= 0 && legacyExecuteEnd > legacyExecuteStart);
assert.strictEqual(
  legacyExecuteSource.includes('sessionPermissions.writeAlwaysAllow = true;'),
  false,
  'assistant execution must not silently grant write permission for the session'
);
assert.strictEqual(
  legacyExecuteSource.includes('sessionPermissions.terminalAlwaysAllow = true;'),
  false,
  'assistant execution must not silently grant terminal permission for the session'
);
assert.ok(
  legacyExecuteSource.includes('signal: executionSignal'),
  'the coordinator AbortSignal must reach the agentic loop'
);
assertInOrder(
  legacyExecuteSource,
  [
    'const authorityBinding = readAgenticDeleteDataProperty(',
    'if (!agenticDeleteStartupRecoveryHealthy) {',
    "markJobFailed(jobId, 'assistant_recovery_required', 'execute_recovery_blocked')",
    'return assistantRecoveryRequiredResult();',
    'project = normalizeAuthorizedProjectInfo(projectInfo || null);',
  ],
  'failed startup recovery must block every assistant execution before project mutation'
);
assert.ok(
  legacyExecuteSource.includes('const autoRepairMaxPasses = executionContext'),
  'derived repair actions must not inherit an exact coordinated action digest'
);
assert.ok(
  legacyExecuteSource.includes('markJobFailed(jobId, reason, `${phase}_fresh_approval_required`)'),
  'a failed coordinated action must require a new approval instead of retaining a stale digest for retry'
);
assert.ok(
  mainSource.includes('const ASSISTANT_PROCESS_EXECUTION_POLICY = PROCESS_EXECUTION_POLICIES.SUSPENDED;'),
  'assistant-originated project processes must stay suspended until the portable sandbox exists'
);
assert.ok(
  legacyExecuteSource.includes('processExecutionPolicy: ASSISTANT_PROCESS_EXECUTION_POLICY'),
  'staged assistant execution must receive the non-forgeable suspended process policy'
);
assert.ok(
  legacyExecuteSource.includes('processExecutionAllowed: false'),
  'post-execution quality must retain only its process-free checks for assistant jobs'
);
assert.ok(
  legacyExecuteSource.includes('const visualValidationReport = buildAssistantVisualValidationPending();'),
  'assistant execution must report preview validation as pending without starting an app'
);
assert.strictEqual(
  legacyExecuteSource.includes('runProjectVisualValidation(refreshed'),
  false,
  'assistant execution must not start preview or visual capture after file promotion'
);
assert.strictEqual(
  legacyExecuteSource.includes("requiredNodeScripts: ['build', 'test']"),
  false,
  'assistant execution must not schedule project build or test scripts'
);
assert.ok(
  legacyExecuteSource.includes('buildAssistantProcessValidationPendingMessage(agenticModifiedFiles)'),
  'agentic success output must replace model validation claims with a trusted pending notice'
);
assert.ok(
  mainSource.includes('registerPreviewHandlers({')
    && mainSource.includes('registerTerminalHandlers({')
    && mainSource.includes('runProjectVerification,'),
  'direct user Preview, Terminal and project verification paths must remain registered'
);
assert.ok(
  mainSource.includes('automaticGitDiffCollectionAllowed: false'),
  'automatic files-tree refresh must not execute repository-controlled Git diff callbacks'
);

assertInOrder(
  mainSource,
  [
    'const legacyHarnessKernel = createLegacyKernelAdapter({',
    'const harnessRouter = createHarnessRouter({',
    'runtimeConfig: createHarnessRuntimeConfig({ env: process.env })',
    'let agenticDeleteJournalAuthenticator = null;',
    'try {',
    'agenticDeleteJournalAuthenticator = createTransactionJournalAuthenticator({',
    "storageDir: app.getPath('userData'),",
    '} catch (error) {',
    "agenticDeleteJournalAuthenticatorErrorCode = typeof errorCode === 'string'",
    "'JOURNAL_AUTHENTICATOR_UNAVAILABLE';",
    'const agenticDeleteMutationBackend = createUnsupportedAnchoredFilesystemMutationBackend({',
    "reasonCode: 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE'",
    'const agenticDeleteRecoveryService = agenticDeleteJournalAuthenticator',
    '? createAgenticDeleteRecoveryService({',
    'getAuthorizedJobById,',
    'authorizeProjectBinding: (projectId, rootPath) => (',
    'getProjectAccess().authorizeProjectBinding(projectId, rootPath)',
    'createTransactionalRuntime: (authority) => {',
    'const transactionalRuntime = createTransactionalFilesystemDeleteService({',
    'authorizeLifecycle: authority.authorizeLifecycle,',
    'authorizeRoot: authority.authorizeRoot,',
    'authorizeEffectFrontier: authority.authorizeEffectFrontier,',
    'journalAuthenticator: agenticDeleteJournalAuthenticator,',
    'mutationBackend: agenticDeleteMutationBackend,',
    'const agenticDeleteStartupRecoveryService = createAgenticDeleteStartupRecoveryService({',
    'recoverInterruptedJobs,',
    'listAuthorizedJobRecoveryCandidates,',
    'recoverJob: agenticDeleteRecoveryService',
    '? agenticDeleteRecoveryService.recoverJob',
    ': () => Object.freeze({ ok: false }),',
    'const agenticDeleteStartupRecoveryResult = agenticDeleteStartupRecoveryService.recoverAtStartup({',
    "reason: 'runtime_restarted_before_job_completed',",
    'agenticDeleteStartupRecoveryHealthy = Boolean(agenticDeleteJournalAuthenticator)',
    '&& agenticDeleteStartupRecoveryResult.ok === true;',
    'const assistantJobAuthorityService = createAssistantJobAuthorityService({',
    'assistantJobAuthorityServiceInstance = assistantJobAuthorityService;',
    'const agenticDeleteRuntimeService = agenticDeleteJournalAuthenticator',
    '? createAgenticDeleteRuntimeService({',
    'journalAuthenticator: agenticDeleteJournalAuthenticator,',
    'mutationBackend: agenticDeleteMutationBackend,',
    'agenticDeleteRuntimeServiceInstance = agenticDeleteRuntimeService;',
    'const assistantPlanningAuthorizer = createAssistantPlanningAuthorizer({',
    'const assistantExecutionCoordinator = createAssistantExecutionCoordinator({',
    'maxActiveJobs: MAX_JOBS_STORED,',
    'beforeAuthorityRelease: beforeAgenticDeleteAuthorityRelease,',
    'harnessRouter.execute(action, projectInfo, executionContext)',
    'assistantExecutionCoordinatorInstance = assistantExecutionCoordinator;',
    'const assistantRuntime = createAssistantRuntimeFacade({',
    'authorizePlanningPayload: (input) => (',
    'agenticDeleteStartupRecoveryHealthy',
    '? assistantPlanningAuthorizer.authorize(input)',
    ': assistantRecoveryRequiredResult()',
    'registerAssistantHandlers({',
    'assistantRuntime,',
  ],
  'main process must compose authorization, coordination, the low-level router, and IPC in order'
);

assertInOrder(
  mainSource,
  [
    'onJobTerminal: observeAssistantJobTerminal,',
    'bindJobActionDigest,',
    'createAuthorizedAssistantJob,',
    'getAuthorizedJobById,',
    'markJobAwaitingUserInput,',
  ],
  'the state store must expose its main-only authority APIs behind a terminal observer'
);

assertInOrder(
  mainSource,
  [
    'function createCoordinatedAssistantPlanningJob(input = {}) {',
    'return coordinator.createPlanningJob(input);',
    'createAssistantJob: createCoordinatedAssistantPlanningJob,',
    'markJobAwaitingUserInput,',
  ],
  'Persona job creation must run inside the coordinator planning scope'
);

assertInOrder(
  mainSource,
  [
    'const cancelAssistantJob = async ({ jobId }) => {',
    'assistantExecutionCoordinator.revokeJob({ jobId })',
    "markJobCancelled(jobId, 'cancelled_by_user')",
    'const retryAssistantJob = ({ jobId }) => assistantRuntime.retry({ jobId });',
    'registerOrchestrationHandlers({',
    'cancelAssistantJob,',
    'retryAssistantJob,',
  ],
  'cancel and retry IPC must delegate to the authoritative runtime'
);

assert.ok(
  mainSource.includes("clearAssistantRuntimeAuthority('renderer_navigation')"),
  'renderer navigation must revoke process-local assistant authority'
);
assert.ok(
  mainSource.includes("clearAssistantRuntimeAuthority('renderer_process_gone')"),
  'renderer crashes must revoke process-local assistant authority'
);
assert.ok(
  mainSource.includes("clearAssistantRuntimeAuthority('app_before_quit')"),
  'application shutdown must revoke process-local assistant authority'
);
assert.ok(
  mainSource.includes("clearAssistantRuntimeAuthority('account_signed_out')"),
  'account sign-out must revoke process-local assistant authority'
);
assert.ok(
  mainSource.includes("clearAssistantRuntimeAuthority('account_signed_in')"),
  'account sign-in or identity replacement must revoke prior assistant authority'
);
assertInOrder(
  mainSource,
  [
    'function clearAssistantRuntimeAuthority(reason = \'runtime_lifecycle_changed\') {',
    'const windowInvalidation = invalidateAgenticDeleteWindow(reason);',
    'assistantRuntimeLifecycleReason = reason;',
    'assistantExecutionCoordinatorInstance.clear()',
    'agenticDeleteRuntimeServiceInstance.clear()',
    'assistantRuntimeLifecycleReason = null;',
    'onAuthorityRevoked: (jobId, reason) => {',
    'if (assistantRuntimeLifecycleReason) {',
    'markJobCancelled(jobId, assistantRuntimeLifecycleReason);',
  ],
  'lifecycle cleanup must invalidate delete authority, clear the coordinator, and persist cancellation in order'
);

const deleteRuntimeCompositionStart = mainSource.indexOf(
  'const agenticDeleteRuntimeService = agenticDeleteJournalAuthenticator'
);
const deleteRuntimeCompositionEnd = mainSource.indexOf(
  'agenticDeleteRuntimeServiceInstance = agenticDeleteRuntimeService;',
  deleteRuntimeCompositionStart
);
const deleteRuntimeComposition = mainSource.slice(
  deleteRuntimeCompositionStart,
  deleteRuntimeCompositionEnd
);
assert.ok(deleteRuntimeCompositionStart >= 0 && deleteRuntimeCompositionEnd > deleteRuntimeCompositionStart);
for (const dependency of [
  'authorizeLifecycle: authorizeAgenticDeleteLifecycle,',
  'authorizeRoot: authorizeAgenticDeleteRoot,',
  'authorizeEffectFrontier: authorizeAgenticDeleteEffectFrontier,',
  'getWindowLease: getAgenticDeleteWindowLease,',
  'getActorId: getAgenticDeleteActorId,',
  'showNativeDialog: showAgenticDeleteNativeDialog,',
  'mutationBackend: agenticDeleteMutationBackend,',
]) {
  assert.ok(
    deleteRuntimeComposition.includes(dependency),
    `main-only delete runtime composition is missing: ${dependency}`
  );
}
assert.strictEqual(
  deleteRuntimeComposition.includes('journalAuthenticator: agenticDeleteJournalAuthenticator,'),
  true,
  'the live and startup recovery runtimes must share one main-owned external journal authenticator'
);
assertInOrder(
  mainSource,
  [
    'registerPreviewHandlers({',
    'registerTerminalHandlers({',
    'let agenticDeleteJournalAuthenticator = null;',
    '} catch (error) {',
    "'[assistant-delete] journal authenticator unavailable'",
    'agenticDeleteStartupRecoveryHealthy = Boolean(agenticDeleteJournalAuthenticator)',
    'const agenticDeleteRuntimeService = agenticDeleteJournalAuthenticator',
    ': null;',
    'registerAssistantHandlers({',
    'createWindow();',
  ],
  'journal key loss must block assistant recovery/delete authority without suppressing user IPCs or the window'
);

for (const importedFactory of [
  'createTransactionJournalAuthenticator',
  'createAgenticDeleteRecoveryService',
  'createAgenticDeleteStartupRecoveryService',
  'createTransactionalFilesystemDeleteService',
]) {
  assert.ok(
    mainSource.includes(importedFactory),
    `main process recovery composition is missing import/use: ${importedFactory}`
  );
}

assert.strictEqual(
  (mainSource.match(/mainWindowDocumentLease = Object\.freeze\(Object\.create\(null\)\)/g) || []).length,
  1,
  'a document lease must only be minted at one trusted main-document load boundary'
);
assertInOrder(
  mainSource,
  [
    'let mainWindowDocumentLease = null;',
    'function invalidateAgenticDeleteWindow(reason = \'window_invalidated\') {',
    'mainWindowDocumentLease = null;',
    'runtime.invalidateWindow(reason)',
    "win.webContents.on('did-finish-load', () => {",
    'mainWindow === win',
    'trustedMainDocumentIsCurrent(win)',
    'win.webContents.getURL() === pathToFileURL(mainDocumentPath).href',
    'mainWindowDocumentLease = Object.freeze(Object.create(null));',
  ],
  'the old document lease must be invalidated before a new trusted local document may mint one'
);
for (const reason of [
  'renderer_navigation',
  'renderer_process_gone',
  'renderer_destroyed',
  'window_closed',
  'app_before_quit',
  'account_signed_out',
  'account_signed_in',
]) {
  assert.ok(
    mainSource.includes(`clearAssistantRuntimeAuthority('${reason}')`),
    `${reason} must invalidate the document and assistant authority`
  );
}

assertInOrder(
  mainSource,
  [
    'async function showAgenticDeleteNativeDialog(payload, dialogContext) {',
    'const capturedWindow = mainWindow;',
    'const capturedLease = getAgenticDeleteWindowLease();',
    "const signal = readAgenticDeleteDataProperty(dialogContext, 'signal');",
    '!trustedMainDocumentIsCurrent(capturedWindow)',
    'signal.aborted',
    'result = await dialog.showMessageBox(capturedWindow, {',
    '...payload,',
    'signal,',
    'capturedWindow !== mainWindow',
    'capturedLease !== getAgenticDeleteWindowLease()',
    '!trustedMainDocumentIsCurrent(capturedWindow)',
  ],
  'the native dialog must bind the signal, window, and opaque lease before and after its await'
);

const platformAuthCallbackStart = mainSource.indexOf('onAuthCompleted: () => {');
const platformAuthCallbackEnd = mainSource.indexOf(
  'port: Number.isFinite(FABER_BACKEND_PORT)',
  platformAuthCallbackStart
);
assertInOrder(
  mainSource.slice(platformAuthCallbackStart, platformAuthCallbackEnd),
  [
    "clearAssistantRuntimeAuthority('account_signed_in')",
    'rotateAgenticDeleteActorId();',
    "mainWindow.webContents.send('account:event', { type: 'signed-in' })",
  ],
  'backend authentication must clear authority and rotate the main-only actor before notifying the renderer'
);
const accountEventStart = mainSource.indexOf('emitAccountEvent: (payload) => {');
const accountEventEnd = mainSource.indexOf('normalizeExternalUrl,', accountEventStart);
const accountEventSource = mainSource.slice(accountEventStart, accountEventEnd);
assertInOrder(
  accountEventSource,
  [
    "clearAssistantRuntimeAuthority('account_signed_out')",
    'rotateAgenticDeleteActorId();',
    "clearAssistantRuntimeAuthority('account_signed_in')",
    'rotateAgenticDeleteActorId();',
    "mainWindow.webContents.send('account:event', payload)",
  ],
  'account identity changes must rotate the actor only after clearing previous authority'
);

const actorIdSource = extractFunctionDeclaration(mainSource, 'getAgenticDeleteActorId');
assertInOrder(
  actorIdSource,
  [
    'platformAccountService.getCurrentSession()',
    "readAgenticDeleteDataProperty(session, 'user')",
    "readAgenticDeleteDataProperty(user, 'id')",
    'AGENTIC_DELETE_ACTOR_ID_PATTERN.test(userId)',
    'return agenticDeleteActorId;',
  ],
  'the agent actor must come from a safe main-owned account id or the rotated process fallback'
);
assert.strictEqual(
  /email|name|renderer/i.test(actorIdSource),
  false,
  'renderer fields, email, and display names must never become the delete actor id'
);

const projectLabelSource = extractFunctionDeclaration(
  mainSource,
  'getAgenticDeleteProjectLabel'
);
assertInOrder(
  projectLabelSource,
  [
    'const binding = normalizeAgenticDeleteBinding(inputBinding);',
    'snapshot = readProjectsSnapshot();',
    "readAgenticDeleteDataProperty(project, 'id') === binding.projectId",
    "readAgenticDeleteDataProperty(project, 'rootPath') === binding.canonicalRootPath",
    "readAgenticDeleteDataProperty(project, 'state') !== 'deleted'",
    "readAgenticDeleteDataProperty(matches[0], 'name')",
    ".slice(0, 80)",
    "return normalized || 'Projeto atual';",
  ],
  'the dialog label must come from one exact main-owned project snapshot record'
);
assert.ok(
  legacyExecuteSource.includes('const projectLabel = getAgenticDeleteProjectLabel(deleteBinding);'),
  'delete execution must use the main-owned project label resolver'
);
assert.strictEqual(
  legacyExecuteSource.includes('projectInfo.name || projectInfo.title'),
  false,
  'renderer-projected labels must not reach the native delete dialog'
);

assertInOrder(
  mainSource,
  [
    'function currentAgenticDeleteBinding(inputBinding) {',
    'const lifecycleBefore = authorizeAgenticDeleteLifecycle(binding);',
    'const rootAuthorization = authorizeAgenticDeleteRoot(binding);',
    'const lifecycleAfter = authorizeAgenticDeleteLifecycle(binding);',
    'function authorizeAgenticDeleteEffectFrontier(input) {',
    'const binding = currentAgenticDeleteBinding(hasWindowLease ? wrappedBinding : input);',
    'windowLease !== getAgenticDeleteWindowLease()',
    "for (const digestField of ['requestDigest', 'impactDigest', 'checkpointDigest'])",
    'const finalBinding = currentAgenticDeleteBinding(binding);',
    'return Object.freeze({ authorized: true, binding: finalBinding, windowLease });',
  ],
  'root, lifecycle, lease, and exact digest checks must surround the final effect frontier'
);

assertInOrder(
  legacyExecuteSource,
  [
    "readAgenticDeleteDataProperty(\n      executionContext,\n      'authorityBinding'",
    'const deleteRuntime = agenticDeleteRuntimeServiceInstance;',
    'const deleteBinding = agenticDeleteRuntimeIsAvailable()',
    '? currentAgenticDeleteBinding(authorityBinding)',
    'if (deleteRuntime && deleteBinding) {',
    'agenticExecutionOptions.deletePaths = (deleteInput) => (',
    'deleteRuntime.executeDeletePaths(Object.freeze({',
    'binding: deleteBinding,',
    'requestedMode,',
    "paths: readAgenticDeleteDataProperty(deleteInput, 'paths')",
    "signal: readAgenticDeleteDataProperty(deleteInput, 'signal')",
    'projectLabel,',
    'Object.freeze(agenticExecutionOptions)',
  ],
  'delete_paths must only be injected for an available runtime with a current exact binding'
);

const releaseHookSource = extractFunctionDeclaration(
  mainSource,
  'beforeAgenticDeleteAuthorityRelease'
);
assertInOrder(
  releaseHookSource,
  [
    'if (agenticDeleteReleaseBinding !== null)',
    'agenticDeleteReleaseBinding = Object.freeze({ binding, terminalStatus });',
    'runtime.beforeAuthorityRelease(input)',
    '} finally {',
    'agenticDeleteReleaseBinding = null;',
  ],
  'terminal authority must exist only inside one non-reentrant synchronous release barrier'
);
assertInOrder(
  coordinatorSource,
  [
    'result = beforeAuthorityRelease(Object.freeze({',
    'record.releasePrepared = true;',
    'function removeRecord(record, reason, terminalStatus = null) {',
    'releaseBarrierConfirmed(record, reason, terminalStatus)',
    'removeLocalRecord(record, reason)',
    'revokeBindingConfirmed(record.binding)',
  ],
  'checkpoint release must finish before local removal and exact authority revocation'
);

const terminalBinding = createCapabilityDelegationBinding({
  projectId: 'project-a',
  canonicalRootPath: '/workspace/project-a',
  realRootPath: '/workspace/project-a',
  sessionId: 'session-a',
  jobId: 'job-a',
  kernelId: 'kernel-a',
  submissionDigest: `sha256:${'a'.repeat(64)}`,
});
let persistedTerminalStatus = 'completed';
const persistedTerminalJob = () => ({
  ok: true,
  job: {
    id: terminalBinding.jobId,
    status: persistedTerminalStatus,
    phase: persistedTerminalStatus,
    projectId: terminalBinding.projectId,
    rootPath: terminalBinding.canonicalRootPath,
    authorityContext: {
      schemaVersion: 'assistant-job-authority.v1',
      projectId: terminalBinding.projectId,
      canonicalRootPath: terminalBinding.canonicalRootPath,
      realRootPath: terminalBinding.realRootPath,
      sessionId: terminalBinding.sessionId,
      kernelId: terminalBinding.kernelId,
      submissionDigest: terminalBinding.submissionDigest,
      actionDigest: `sha256:${'b'.repeat(64)}`,
    },
  },
});
const releaseHarnessFactory = new Function(
  'createCapabilityDelegationBinding',
  'getAuthorizedJobById',
  `
    const AGENTIC_DELETE_BINDING_FIELDS = ${JSON.stringify([
    'projectId',
    'canonicalRootPath',
    'realRootPath',
    'sessionId',
    'jobId',
    'kernelId',
    'submissionDigest',
  ])};
    const AGENTIC_DELETE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
    let agenticDeleteReleaseBinding = null;
    let authorityCalls = 0;
    let throwDuringRelease = false;
    let assistantJobAuthorityServiceInstance = {
      authorizeLifecycle() {
        authorityCalls += 1;
        return Object.freeze({ authorized: false });
      },
    };
    let agenticDeleteRuntimeServiceInstance = null;
    ${extractFunctionDeclaration(mainSource, 'readAgenticDeleteDataProperty')}
    ${extractFunctionDeclaration(mainSource, 'normalizeAgenticDeleteBinding')}
    ${extractFunctionDeclaration(mainSource, 'agenticDeleteBindingsMatch')}
    ${extractFunctionDeclaration(mainSource, 'confirmedAgenticDeleteResult')}
    ${extractFunctionDeclaration(mainSource, 'authorizeAgenticDeleteLifecycle')}
    ${releaseHookSource}
    agenticDeleteRuntimeServiceInstance = {
      beforeAuthorityRelease(input) {
        if (throwDuringRelease) throw new Error('release failed');
        const during = authorizeAgenticDeleteLifecycle(
          readAgenticDeleteDataProperty(input, 'binding')
        );
        const nested = beforeAgenticDeleteAuthorityRelease(input);
        return Object.freeze({
          ok: readAgenticDeleteDataProperty(during, 'authorized') === true
            && readAgenticDeleteDataProperty(nested, 'ok') === false,
        });
      },
    };
    return Object.freeze({
      authorizeAgenticDeleteLifecycle,
      beforeAgenticDeleteAuthorityRelease,
      getAuthorityCalls: () => authorityCalls,
      setThrowDuringRelease: (value) => { throwDuringRelease = value === true; },
    });
  `
);
const releaseHarness = releaseHarnessFactory(
  createCapabilityDelegationBinding,
  () => persistedTerminalJob()
);
assert.strictEqual(
  releaseHarness.authorizeAgenticDeleteLifecycle(terminalBinding).authorized,
  false,
  'a persisted terminal job must be denied outside the coordinator release barrier'
);
assert.deepStrictEqual(
  releaseHarness.beforeAgenticDeleteAuthorityRelease({
    binding: terminalBinding,
    reason: 'job_terminal',
    terminalStatus: 'completed',
  }),
  { ok: true },
  'the exact persisted terminal binding must remain usable only while checkpoint release runs'
);
assert.strictEqual(
  releaseHarness.authorizeAgenticDeleteLifecycle(terminalBinding).authorized,
  false,
  'terminal authority must disappear immediately after checkpoint release'
);
assert.strictEqual(
  releaseHarness.getAuthorityCalls(),
  2,
  'the guarded terminal release must not call the normal lifecycle authorizer'
);
persistedTerminalStatus = 'failed';
assert.deepStrictEqual(
  releaseHarness.beforeAgenticDeleteAuthorityRelease({
    binding: terminalBinding,
    reason: 'job_terminal',
    terminalStatus: 'completed',
  }),
  { ok: false },
  'the release barrier must reject a persisted terminal status mismatch'
);
persistedTerminalStatus = 'completed';
releaseHarness.setThrowDuringRelease(true);
assert.throws(
  () => releaseHarness.beforeAgenticDeleteAuthorityRelease({
    binding: terminalBinding,
    reason: 'job_terminal',
    terminalStatus: 'completed',
  }),
  /release failed/,
  'release failures must propagate to poison coordinator authority'
);
releaseHarness.setThrowDuringRelease(false);
assert.strictEqual(
  releaseHarness.authorizeAgenticDeleteLifecycle(terminalBinding).authorized,
  false,
  'the terminal guard must be cleared in finally even when release throws'
);

assert.strictEqual(
  /registerIpcHandler\(\s*['"]assistant:(?:plan|message|execute)['"]/.test(mainSource),
  false,
  'main.js must not bypass main/ipc/assistant_handlers.js for harness operations'
);
assert.strictEqual(
  /registerIpcHandler\(\s*['"]assistant:route['"]/.test(mainSource),
  true,
  'assistant:route must remain on its frozen legacy path in Phase 1'
);
assert.strictEqual(
  /registerIpcHandler\(\s*['"]job:cancel['"]/.test(mainSource),
  false,
  'main.js must not retain a raw cancellation bypass outside orchestration handlers'
);

console.log('assistant-runtime-wiring.test.js: ok');
