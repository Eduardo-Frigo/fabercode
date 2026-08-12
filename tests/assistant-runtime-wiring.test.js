const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');

function assertInOrder(source, fragments, message) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor + 1);
    assert.ok(next > cursor, `${message}: missing or out of order: ${fragment}`);
    cursor = next;
  }
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
assert.ok(
  legacyExecuteSource.includes('const autoRepairMaxPasses = executionContext'),
  'derived repair actions must not inherit an exact coordinated action digest'
);
assert.ok(
  legacyExecuteSource.includes('markJobFailed(jobId, reason, `${phase}_fresh_approval_required`)'),
  'a failed coordinated action must require a new approval instead of retaining a stale digest for retry'
);

assertInOrder(
  mainSource,
  [
    'const legacyHarnessKernel = createLegacyKernelAdapter({',
    'const harnessRouter = createHarnessRouter({',
    'runtimeConfig: createHarnessRuntimeConfig({ env: process.env })',
    'const assistantJobAuthorityService = createAssistantJobAuthorityService({',
    'const assistantPlanningAuthorizer = createAssistantPlanningAuthorizer({',
    'const assistantExecutionCoordinator = createAssistantExecutionCoordinator({',
    'harnessRouter.execute(action, projectInfo, executionContext)',
    'assistantExecutionCoordinatorInstance = assistantExecutionCoordinator;',
    'const assistantRuntime = createAssistantRuntimeFacade({',
    'authorizePlanningPayload: assistantPlanningAuthorizer.authorize,',
    'const interruptedJobsRecovery = recoverInterruptedJobs(',
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
assertInOrder(
  mainSource,
  [
    'assistantRuntimeLifecycleReason = reason;',
    'return assistantExecutionCoordinatorInstance.clear();',
    'assistantRuntimeLifecycleReason = null;',
    'onAuthorityRevoked: (jobId, reason) => {',
    'if (assistantRuntimeLifecycleReason) {',
    'markJobCancelled(jobId, assistantRuntimeLifecycleReason);',
  ],
  'lifecycle cleanup must persist cancellation while coordinator authority is being cleared'
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
