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
const personaOrchestratorSource = fs.readFileSync(
  path.join(rootDir, 'cortex', 'orchestration', 'persona_orchestrator.js'),
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
  const parameterEnd = source.indexOf(') {', start);
  const openingBrace = parameterEnd >= 0 ? parameterEnd + 2 : -1;
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

for (const functionName of [
  'requestAiProductRouteDecision',
  'requestPersonaRouteDecision',
  'requestDirectPersonaChat',
]) {
  const promptSource = extractFunctionDeclaration(mainSource, functionName);
  assert.strictEqual(
    (promptSource.match(/promptProjection\.trustedPrompt/g) || []).length,
    1,
    `${functionName} must inject the trusted ContextPack projection exactly once`
  );
  assert.strictEqual(
    (promptSource.match(/promptProjection\.untrustedPrompt/g) || []).length,
    1,
    `${functionName} must inject the untrusted ContextPack projection exactly once`
  );
  assertInOrder(
    promptSource,
    [
      'const systemPrompt =',
      'promptProjection ? promptProjection.trustedPrompt :',
      'const userPrompt =',
      'promptProjection ? promptProjection.untrustedPrompt :',
      "{ role: 'system', content: systemPrompt }",
      "{ role: 'user', content: userPrompt }",
    ],
    `${functionName} must preserve the ContextPack trust boundary across provider roles`
  );
}

const directPersonaChatSource = extractFunctionDeclaration(mainSource, 'requestDirectPersonaChat');
assert.ok(
  directPersonaChatSource.includes('isMapChat = false')
    && directPersonaChatSource.includes('getMapChatReadOnlySystemGuidance(')
    && directPersonaChatSource.includes('getMapRenderReadOnlySystemGuidance('),
  'direct Map Chat responses must receive the main-owned read-only system profile'
);
assertInOrder(
  directPersonaChatSource,
  [
    'const mapChatSystemGuidance = isMapChat',
    'getMapChatReadOnlySystemGuidance(',
    'getMapRenderReadOnlySystemGuidance(',
    'const systemPrompt =',
    'mapChatSystemGuidance,',
    'promptProjection ? promptProjection.trustedPrompt :',
  ],
  'Map Chat read-only guidance must be fixed in the system role before trusted ContextPack context'
);
const naturalRouteSource = extractFunctionDeclaration(
  personaOrchestratorSource,
  'buildNaturalRouteOnlyResponse'
);
assert.ok(
  naturalRouteSource.includes('isMapChat: payload.isMapChat === true'),
  'the map-only surface marker must reach direct persona chat'
);

assertInOrder(
  mainSource,
  [
    'const handleLegacyHarnessPlan = async (payload, contextPack = null) => {',
    'normalizeAuthorizedProjectInfo(payload && payload.projectInfo ? payload.projectInfo : null)',
    'projectHarnessContextPackForPrompt(contextPack, project.projectInfo)',
    'buildAssistantPlanResponse({',
    'contextPackPromptProjection,',
  ],
  'legacy plan authorization and delegation must preserve their order'
);

assertInOrder(
  mainSource,
  [
    'const handleLegacyHarnessMessage = async (payload, contextPack = null) => {',
    'normalizeAuthorizedProjectInfo(payload && payload.projectInfo ? payload.projectInfo : null)',
    'projectHarnessContextPackForPrompt(contextPack, project.projectInfo)',
    'handleAssistantMessage({',
    'contextPackPromptProjection,',
  ],
  'legacy message authorization and delegation must preserve their order'
);

assertInOrder(
  mainSource,
  [
    'async function runCortexRenderRuntimePlan({',
    'const promptProjection = normalizeContextPackPromptProjection(contextPackPromptProjection);',
    'requestCortexBrainBriefing({',
    'contextPackPromptProjection: promptProjection,',
    'requestEngineOperationBatchAction({',
    'contextPackPromptProjection: promptProjection,',
    'runRepairValidationLoop({',
    'contextPackPromptProjection: promptProjection,',
  ],
  'Cortex planning and repair prompts must keep the same validated ContextPack projection'
);

const optionalBlueprintScaffoldSource = extractFunctionDeclaration(
  mainSource,
  'applyAgenticOptionalBlueprintScaffold'
);
assertInOrder(
  optionalBlueprintScaffoldSource,
  [
    "creationProfile.scaffold.strategy !== 'faber_blueprint'",
    'buildProjectBlueprintOperationBatch({',
    "executionIntent: 'init_project'",
    'force: true,',
    'executeOperationBatchAction({',
  ],
  'the optional blueprint must require main-owned opt-in and reuse the governed operation executor'
);
const agenticToolLoopFactorySource = extractFunctionDeclaration(
  mainSource,
  'getAgenticToolLoopService'
);
assert.ok(
  agenticToolLoopFactorySource.includes(
    'applyOptionalBlueprintScaffold: applyAgenticOptionalBlueprintScaffold'
  ),
  'production must bind the opt-in blueprint scaffold into the unified agentic loop'
);

assert.ok(
  mainSource.includes("require('./main/services/agentic_model_tool_result_service')"),
  'production must use the hardened multimodal tool-result transport'
);
assert.strictEqual(
  mainSource.includes('function buildAgenticToolResultInput('),
  false,
  'production must not retain the legacy text-only tool-result serializer'
);
const agenticModelTurnSource = extractFunctionDeclaration(
  mainSource,
  'requestAgenticModelTurn'
);
assert.ok(
  mainSource.includes('resolveOpenAiResponsesReasoningEffort,'),
  'production must import the shared Responses reasoning capability resolver'
);
assert.ok(
  agenticModelTurnSource.includes(
    'resolveOpenAiResponsesReasoningEffort(effectiveModel)'
  ),
  'the agentic Responses route must use the same model capability resolver as provider chat'
);
assert.strictEqual(
  agenticModelTurnSource.includes("'minimal'"),
  false,
  'the agentic Responses route must not retain a model-obsolete minimal effort literal'
);
assertInOrder(
  agenticModelTurnSource,
  [
    'const destination = resolveAgenticModelProviderDestination(provider);',
    'const toolResultOptions = buildAgenticVisualTransportOptions(',
    'buildAgenticResponsesToolResultInput(toolResults, toolResultOptions)',
  ],
  'Responses visual content must consume approval against the current exact provider destination'
);
const chatCompletionsAgenticSource = extractFunctionDeclaration(
  mainSource,
  'callChatCompletionsAgentic'
);
assert.match(
  chatCompletionsAgenticSource,
  /buildAgenticChatCompletionToolResultMessages\(\s*toolResults,\s*toolResultOptions\s*\)/,
  'Chat Completions visual content must use the same approval-gated transport'
);

const legacyExecuteStart = mainSource.indexOf(
  'const handleLegacyHarnessExecute = async (action, projectInfo, executionContext = null, contextPack = null) => {'
);
const legacyExecuteEnd = mainSource.indexOf(
  'const legacyHarnessKernel = createLegacyKernelAdapter({',
  legacyExecuteStart
);
const legacyExecuteSource = mainSource.slice(legacyExecuteStart, legacyExecuteEnd);
assert.ok(legacyExecuteStart >= 0 && legacyExecuteEnd > legacyExecuteStart);

for (const requiredModule of [
  "require('./main/services/agentic_browser_broker_factory')",
  "require('./main/services/agentic_browser_session_service')",
  "require('./main/services/agentic_mcp_tool_broker_factory')",
  "require('./main/services/agentic_mcp_write_approval_service')",
  "require('./main/services/agentic_visual_egress_approval_service')",
  "require('./main/capabilities/capability_grant_store')",
  "require('./main/capabilities/pending_approval_store')",
]) {
  assert.ok(
    mainSource.includes(requiredModule),
    `production visual runtime must import ${requiredModule}`
  );
}
assertInOrder(
  mainSource,
  [
    'const agenticVisualEgressApprovalService = createAgenticVisualEgressApprovalService({',
    'agenticVisualEgressApprovalServiceInstance = agenticVisualEgressApprovalService;',
    'const agenticBrowserSessionService = createAgenticBrowserSessionService({',
    'agenticBrowserSessionServiceInstance = agenticBrowserSessionService;',
    'const agenticBrowserBrokerFactory = createAgenticBrowserBrokerFactory({',
    'agenticBrowserBrokerFactoryInstance = agenticBrowserBrokerFactory;',
    'const assistantExecutionCoordinator = createAssistantExecutionCoordinator({',
  ],
  'the visual approval and browser authority must exist before coordinated execution starts'
);
assertInOrder(
  legacyExecuteSource,
  [
    'const browserBrokerFactory = agenticBrowserBrokerFactoryInstance;',
    'const browserBinding = currentAgenticDeleteBinding(authorityBinding);',
    'browserRoute = browserBrokerFactory.createRoute(',
    "Object.defineProperty(agenticExecutionOptions, 'openBrowser'",
    "Object.defineProperty(agenticExecutionOptions, 'interactBrowser'",
    "Object.defineProperty(agenticExecutionOptions, 'captureBrowser'",
    "Object.defineProperty(agenticExecutionOptions, 'authorizeVisualEgress'",
    "Object.defineProperty(agenticExecutionOptions, 'consumeVisualEgress'",
  ],
  'browser and visual callbacks must remain private execution-context capabilities'
);
assert.ok(
  mainSource.includes('const activeAgenticExecutionSignalsByJobId = new Map();'),
  'production must retain the exact coordinator signal only for the active agentic job'
);
const activeBrowserSignalSource = extractFunctionDeclaration(
  mainSource,
  'getActiveAgenticExecutionSignal'
);
assert.ok(
  activeBrowserSignalSource.includes('activeAgenticExecutionSignalsByJobId.get(binding.jobId)'),
  'the Browser Broker must resolve cancellation from the active coordinator signal registry'
);
assertInOrder(
  legacyExecuteSource,
  [
    'activeAgenticExecutionSignalsByJobId.set(jobId, browserExecutionSignalRecord);',
    'agenticResult = await getAgenticToolLoopService().executeAction(',
    'activeAgenticExecutionSignalsByJobId.delete(jobId);',
  ],
  'the exact browser signal binding must exist only around the agentic execution'
);
for (const privateVisualCallback of [
  'openBrowser',
  'navigateBrowser',
  'interactBrowser',
  'captureBrowser',
  'inspectBrowser',
  'closeBrowser',
  'authorizeVisualEgress',
  'consumeVisualEgress',
]) {
  const callbackStart = legacyExecuteSource.indexOf(
    `Object.defineProperty(agenticExecutionOptions, '${privateVisualCallback}'`
  );
  assert.ok(callbackStart >= 0, `missing private visual callback ${privateVisualCallback}`);
  assert.ok(
    legacyExecuteSource.slice(callbackStart, callbackStart + 420).includes('enumerable: false'),
    `${privateVisualCallback} must not enter enumerable execution payloads`
  );
}
const runtimeClearSource = extractFunctionDeclaration(
  mainSource,
  'clearAssistantRuntimeAuthority'
);
assert.ok(
  runtimeClearSource.includes('agenticVisualEgressApprovalServiceInstance.clear()')
    && runtimeClearSource.includes('agenticBrowserSessionServiceInstance.clear()'),
  'runtime authority reset must revoke visual approvals and destroy hidden browser windows'
);

const providerDestinationSource = extractFunctionDeclaration(
  mainSource,
  'resolveAgenticModelProviderDestination'
);
const buildProviderDestinationResolver = new Function(
  'resolveOpenAiBaseUrl',
  'OPENAI_API_BASE_URL',
  'GEMINI_API_BASE_URL',
  `${providerDestinationSource}; return resolveAgenticModelProviderDestination;`
);
assert.deepStrictEqual(
  buildProviderDestinationResolver(
    (value) => value,
    'https://api.openai.com/v1',
    'https://generativelanguage.googleapis.com/v1beta'
  )('openai'),
  { providerId: 'openai', providerOrigin: 'https://api.openai.com' }
);
assert.strictEqual(
  buildProviderDestinationResolver(
    (value) => value,
    'https://custom.example/v1',
    'https://generativelanguage.googleapis.com/v1beta'
  )('openai'),
  null,
  'custom OpenAI-compatible origins must remain text-only'
);
assert.strictEqual(
  buildProviderDestinationResolver(
    (value) => value,
    'https://api.openai.com/v1',
    'https://custom-gemini.example/v1beta'
  )('gemini'),
  null,
  'custom Gemini origins must remain text-only'
);

assertInOrder(
  mainSource,
  [
    'const handleLegacyHarnessExecute = async (action, projectInfo, executionContext = null, contextPack = null) => {',
    'const jobId = executionContext && typeof executionContext.jobId === \'string\'',
    'const executionSignal = executionContext && executionContext.signal',
    'project = normalizeAuthorizedProjectInfo(projectInfo || null);',
    "markJobFailed(jobId, 'project_authorization_failed', 'execute_authorization_failed')",
    'initialAction = bindActionToAuthorizedProject(action, projectInfo);',
  ],
  'legacy execute must derive authority before reauthorization and terminalize every rejected job'
);

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
  mainSource.includes(
    "require('./main/services/execution_isolation_authorized_job_executor')"
  ),
  'production must compose the authority-bound sandbox executor'
);
assert.ok(
  mainSource.includes(
    "require('./main/services/execution_isolation_broker_sandbox_registry')"
  ) && mainSource.includes(
    "require('./main/services/agentic_process_broker_factory')"
  ),
  'production must compose the private executor through the process broker route'
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
const agenticInspectionSource = extractFunctionDeclaration(
  mainSource,
  'inspectAgenticProjectValidation'
);
assert.ok(
  agenticInspectionSource.includes('scanProject(rootPath)')
    && agenticInspectionSource.includes('buildProjectVerificationPlan(refreshed')
    && agenticInspectionSource.includes("requiredNodeScripts: ['build', 'test']")
    && agenticInspectionSource.includes('requirePythonTests: true'),
  'create/init inspection must rescan the authorized project and build a strict stack-adaptive plan without executing it'
);
assert.ok(
  mainSource.includes('inspectProjectValidation: inspectAgenticProjectValidation'),
  'production must expose the stack-adaptive inspection callback only through the agentic loop service boundary'
);
assert.ok(
  mainSource.includes('automaticGitDiffCollectionAllowed: false'),
  'automatic files-tree refresh must not execute repository-controlled Git diff callbacks'
);

const coordinatedExecuteStart = coordinatorSource.indexOf('async function execute(input = {}) {');
const coordinatedExecuteEnd = coordinatorSource.indexOf(
  'function revokeJob(input = {}) {',
  coordinatedExecuteStart
);
assert.ok(
  coordinatedExecuteStart >= 0 && coordinatedExecuteEnd > coordinatedExecuteStart,
  'missing coordinated execute function'
);
const coordinatedExecuteSource = coordinatorSource.slice(
  coordinatedExecuteStart,
  coordinatedExecuteEnd
);
assertInOrder(
  coordinatedExecuteSource,
  [
    'authorityService.authorizeExecute({',
    "authorizationFields.get('actionDigest')",
    'prepareAuthorizedJobExecutor(',
    'prepareProjectRootExecution(',
    'executeAction(',
  ],
  'the job executor must be created only after exact action authorization and before runtime entry'
);
const privateExecutionContextSource = extractFunctionDeclaration(
  coordinatorSource,
  'createPrivateExecutionContext'
);
assert.ok(
  privateExecutionContextSource.includes("Object.defineProperty(context, 'sandboxExecutor'")
    && privateExecutionContextSource.includes('enumerable: false'),
  'the authority-bound sandbox executor must reach runtime only through private context'
);
const executionRemovalSource = extractFunctionDeclaration(
  coordinatorSource,
  'removeExecutionRecord'
);
assertInOrder(
  executionRemovalSource,
  [
    'closeAuthorizedJobExecutorConfirmed(record)',
    'releaseBarrierConfirmed(record',
    'releaseProjectRootLeaseConfirmed(record)',
    'removeLocalRecord(record',
    'revokeBindingConfirmed(record.binding)',
  ],
  'executor cleanup must be confirmed before delete/root barriers and authority revocation'
);

for (const productionCanaryDependency of [
  "require('./main/agent_runtime/default_on_rollout_policy')",
  "require('./main/agent_runtime/default_on_rollout_safety_interlock')",
  "require('./main/runtime/codex_app_server_runtime_config')",
  "require('./main/runtime/default_on_rollout_runtime_config')",
  "require('./main/services/codex_app_server_production_client_activation')",
  "require('./main/services/canary_internal_rollout_policy')",
  "require('./main/services/default_on_canary_rollout_policy_adapter')",
  "require('./main/services/default_on_rollout_facts_service')",
  "require('./main/services/canary_edit_production_runtime')",
  "require('./main/services/canary_manual_rollback_job_service')",
  "require('./main/services/canary_manual_rollback_journal_adapter')",
  "require('./main/services/canary_promotion_rollback_store_adapter')",
  "require('./main/services/canary_rollout_evidence_journal_adapter')",
]) {
  assert.ok(
    mainSource.includes(productionCanaryDependency),
    `main process canary wiring is missing: ${productionCanaryDependency}`
  );
}

const canaryInitializationSource = extractFunctionDeclaration(
  mainSource,
  'initializeCanaryEditProductionRuntime'
);
assertInOrder(
  canaryInitializationSource,
  [
    "const runtimeModeEligible = ['canary', 'on'].includes(",
    "const defaultOnPolicyReady = runtimeConfig.configuredMode !== 'on'",
    "const defaultOnSafetyReady = runtimeConfig.configuredMode !== 'on'",
    'if (!runtimeModeEligible',
    '|| !defaultOnPolicyReady',
    '|| !defaultOnSafetyReady',
    '|| !runtimeServices || !isolationReady)',
    'createCodexAppServerRuntimeConfig({ env: process.env })',
    "const rolloutPolicy = runtimeConfig.configuredMode === 'on'",
    '? defaultOnCanaryRolloutPolicy',
    ': createCanaryInternalRolloutPolicy({',
    'authorizeProjectBinding: (projectId, rootPath) => (',
    'getProjectAccess().authorizeProjectBinding(projectId, rootPath)',
    'const evidenceJournal = createCanaryRolloutEvidenceJournalAdapter({',
    "storageDir: app.getPath('userData')",
    'const promotionRollbackStore = createCanaryPromotionRollbackStoreAdapter({',
    "storageDir: app.getPath('userData')",
    'const manualRollbackJournal = createCanaryManualRollbackJournalAdapter({',
    "storageDir: app.getPath('userData')",
    'createCodexAppServerProductionClientActivation({',
    "cwd: app.getPath('userData')",
    'clientVersion: app.getVersion()',
    'environment: Object.freeze({ ...process.env })',
    'clientSelection = await clientActivation.start();',
    'if (clientSelection.ready !== true || !clientSelection.client)',
    'productionRuntime = createCanaryEditProductionRuntime({',
    'authorityService,',
    'projectRootAuthorityRegistry: runtimeServices.projectRootAuthorityRegistry,',
    'executionWorkspaceRegistry: runtimeServices.executionWorkspaceRegistry,',
    'inspectRootMutation: (binding) => coordinator.inspectRootMutation(binding),',
    'inspectRollout: (binding) => rolloutPolicy.inspect(binding),',
    'promotionIdFactory: () => `canary-promotion-${crypto.randomUUID()}`',
    'evidenceJournal,',
    'promotionRollbackStore,',
    'manualRollbackJournal,',
    'onCanaryCompleted: (observation) => {',
    "const jobId = readAgenticDeleteDataProperty(observation, 'jobId');",
    "'promotionId'",
    "'changedPaths'",
    'const terminalResult = markJobCompleted(jobId, {',
    'canary: true,',
    'canaryPromotionId: promotionId,',
    'modifiedFiles: changedPaths,',
    '...buildAssistantProcessValidationPendingFields(',
    "appendAuditEvent('assistant.canary_edit_completed'",
    'return terminalResult;',
    'onCanaryFailed: (observation) => {',
    "const reason = readAgenticDeleteDataProperty(observation, 'reason');",
    "const safetyEvent = runtimeConfig.configuredMode === 'on'",
    '? classifyDefaultOnCanarySafetyEvent(reason)',
    'const tripPromise = defaultOnSafetyInterlock.trip(Object.freeze({',
    'sourceJobId: jobId,',
    'evidenceDigest,',
    'const terminalResult = markJobFailed(',
    "'execute_failed'",
    "appendAuditEvent('assistant.canary_edit_failed'",
    'return terminalResult;',
    'client: clientSelection.client,',
    'if (!productionRuntime.canaryEditRunner',
    'await productionRuntime.close();',
    'canaryEditProductionRuntimeInstance = productionRuntime;',
    'activeKernelId: CANARY_EDIT_PRODUCTION_KERNEL_ID,',
  ],
  'canary/default-on startup must require the portable sandbox, exact rollout authorization, pinned client readiness, and a ready production runner before changing kernel identity'
);
assert.ok(
  canaryInitializationSource.includes(
    'await closeUnownedCodexAppServerSelection(clientSelection);'
  ),
  'a ready App Server client must be closed if ownership cannot transfer to the canary runtime'
);
assertInOrder(
  canaryInitializationSource,
  [
    'runtimeServices.diagnostics()',
    "isolationDiagnostics.state === 'ready'",
    "const runtimeModeEligible = ['canary', 'on'].includes(",
    "const defaultOnSafetyReady = runtimeConfig.configuredMode !== 'on'",
    '|| !runtimeServices || !isolationReady)',
    'createCodexAppServerProductionClientActivation({',
  ],
  'canary/default-on activation must not start a client unless the portable isolation service set is positively ready'
);

assertInOrder(
  mainSource,
  [
    'const legacyHarnessKernel = createLegacyKernelAdapter({',
    'let agenticDeleteJournalAuthenticator = null;',
    'try {',
    'agenticDeleteJournalAuthenticator = createTransactionJournalAuthenticator({',
    "storageDir: app.getPath('userData'),",
    '} catch (error) {',
    "agenticDeleteJournalAuthenticatorErrorCode = typeof errorCode === 'string'",
    "'JOURNAL_AUTHENTICATOR_UNAVAILABLE';",
    'const agenticDeleteMutationRuntimeConfig = createAnchoredMutationRuntimeConfig({',
    'env: process.env,',
    'agenticDeleteMutationBackendSelection = createAgenticDeleteMutationBackendSelection({',
    'config: agenticDeleteMutationRuntimeConfig,',
    'const agenticDeleteMutationBackend = agenticDeleteMutationBackendSelection.backend;',
    'const agenticDeleteRecoveryService = agenticDeleteJournalAuthenticator',
    '? createAgenticDeleteRecoveryService({',
    'getAuthorizedJobById,',
    'authorizeProjectBinding: (projectId, rootPath) => (',
    'getProjectAccess().authorizeProjectBinding(projectId, rootPath)',
    'createTransactionalRuntime: (authority, projectRootReader) => {',
    'const transactionalOptions = {',
    'authorizeLifecycle: authority.authorizeLifecycle,',
    'authorizeRoot: authority.authorizeRoot,',
    'authorizeEffectFrontier: authority.authorizeEffectFrontier,',
    'journalAuthenticator: agenticDeleteJournalAuthenticator,',
    'mutationBackend: agenticDeleteMutationBackend,',
    'transactionalOptions.getProjectRootReader = () => projectRootReader;',
    'createTransactionalFilesystemDeleteService(transactionalOptions)',
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
    'const assistantExecutionIsolationRuntimeServices = executionIsolationRuntimeServices;',
    'let harnessRouter = null;',
    'const assistantExecutionCoordinator = createAssistantExecutionCoordinator({',
    'maxActiveJobs: MAX_JOBS_STORED,',
    'beforeAuthorityRelease: beforeAgenticDeleteAuthorityRelease,',
    'createAuthorizedJobExecutor: ({ binding }) => {',
    'if (!assistantExecutionIsolationRuntimeServices) {',
    'return createExecutionIsolationAuthorizedJobExecutor({',
    'authorityService: assistantJobAuthorityService,',
    'jobSessionService: assistantExecutionIsolationRuntimeServices.jobSessionService,',
    'harnessRouter.execute(action, projectInfo, executionContext)',
    'assistantExecutionCoordinatorInstance = assistantExecutionCoordinator;',
    'const harnessRolloutEnvironment = Object.freeze({ ...process.env });',
    'const harnessRuntimeConfig = createHarnessRuntimeConfig({',
    'env: harnessRolloutEnvironment,',
    'const defaultOnRolloutRuntimeConfig = createDefaultOnRolloutRuntimeConfig({',
    'env: harnessRolloutEnvironment,',
    'const defaultOnRolloutPolicy = createDefaultOnRolloutPolicy({',
    'const defaultOnRolloutFactsService = createDefaultOnRolloutFactsService({',
    'const defaultOnRolloutSafetyInterlock = createDefaultOnRolloutSafetyInterlock({',
    'cancelJob(input) {',
    'const receipt = assistantExecutionCoordinator.revokeJob(',
    "abortActiveJobExecution(jobId, 'default_on_rollout_safety_trip');",
    'closeBrowserJob(input) {',
    'agenticBrowserSessionServiceInstance.closeJob(input)',
    'closeRuntime() {',
    'const runtime = canaryEditProductionRuntimeInstance;',
    'canaryEditProductionRuntimeInstance = null;',
    'return runtime.close();',
    'const defaultOnCanaryRolloutPolicy = harnessRuntimeConfig.configuredMode',
    'const canaryRuntimeSelection = await initializeCanaryEditProductionRuntime({',
    'authoritativeKernel: legacyHarnessKernel,',
    'authorityService: assistantJobAuthorityService,',
    'coordinator: assistantExecutionCoordinator,',
    'defaultOnCanaryRolloutPolicy,',
    'defaultOnSafetyInterlock: defaultOnRolloutSafetyInterlock,',
    'runtimeConfig: harnessRuntimeConfig,',
    'runtimeServices: assistantExecutionIsolationRuntimeServices,',
    'const activeHarnessKernelId = canaryRuntimeSelection.activeKernelId;',
    'const contextPackHarnessProductionService = createContextPackHarnessProductionService({',
    'authorizeProjectBinding: (projectId, rootPath) => (',
    'getProjectAccess().authorizeProjectBinding(projectId, rootPath)',
    'authorizeExecutionBinding: (binding) => (',
    'assistantJobAuthorityServiceInstance',
    'getProjectRootAuthorityRegistry: () => (',
    'executionIsolationRuntimeServices',
    'getActiveMemory: (input) => resolveActiveMemoryContext(input),',
    'kernelId: activeHarnessKernelId,',
    'harnessRouter = createHarnessRouter({',
    'canaryEditRunner: canaryRuntimeSelection.canaryEditRunner,',
    'contextPackInjector: contextPackHarnessProductionService.contextPackInjector,',
    'defaultOnRolloutPolicy,',
    'defaultOnSafetyInterlock: defaultOnRolloutSafetyInterlock,',
    'persistDefaultOnRolloutSnapshot: (jobId, snapshot) => (',
    'resolveDefaultOnRolloutFacts: (identity) => (',
    'runtimeConfig: harnessRuntimeConfig,',
    'const assistantRuntime = createAssistantRuntimeFacade({',
    'authorizePlanningPayload: (input) => (',
    'agenticDeleteStartupRecoveryHealthy',
    '? assistantPlanningAuthorizer.authorize(input)',
    ': assistantRecoveryRequiredResult()',
    'kernelId: activeHarnessKernelId,',
    'registerAssistantHandlers({',
    'assistantRuntime,',
  ],
  'main process must compose authorization, coordination, the low-level router, and IPC in order'
);

assertInOrder(
  mainSource,
  [
    "require('./main/services/map_chat_session_service')",
    "require('./main/ipc/map_chat_handlers')",
    'const assistantRuntime = createAssistantRuntimeFacade({',
    'const mapChatSessionService = createMapChatSessionService({',
    'assistantRuntime,',
    'applicationMapService,',
    'authorizeProjectBinding: (projectId, rootPath) => (',
    'getProjectAccess().authorizeProjectBinding(projectId, rootPath)',
    'conversationStore: orchestrationStateStore,',
    'milestoneService,',
    'registerMapChatHandlers({',
    'mapChatSessionService,',
    'registerIpcHandler,',
  ],
  'main process must compose the dedicated read-only Map Chat session boundary'
);

assertInOrder(
  mainSource,
  [
    "require('./main/services/map_chat_proposal_store')",
    "require('./main/services/map_chat_proposal_service')",
    "require('./main/ipc/map_chat_proposal_handlers')",
    'const mapChatProposalStore = createMapChatProposalStore({',
    "storageDir: app.getPath('userData'),",
    'const mapChatProposalService = createMapChatProposalService({',
    'applicationMapService,',
    'authorizeProjectBinding: (projectId, rootPath) => (',
    'conversationStore: orchestrationStateStore,',
    'milestoneService,',
    'proposalStore: mapChatProposalStore,',
    'registerMapChatProposalHandlers({',
    'mapChatProposalService,',
    'registerIpcHandler,',
  ],
  'main process must compose durable structured Map Chat proposal approvals'
);

assertInOrder(
  mainSource,
  [
    "require('./main/services/milestone_validation_service')",
    'const milestoneValidationService = createMilestoneValidationService({',
    'getAuthorizedJobById,',
    'milestoneService,',
    'registerMilestoneHandlers({',
    'milestoneGitStatusService,',
    'milestoneService,',
    'milestoneValidationService,',
  ],
  'milestone completion must be composed from durable validated jobs and verified Git commits'
);

assertInOrder(
  mainSource,
  [
    'const canaryRuntimeSelection = await initializeCanaryEditProductionRuntime({',
    'const canaryManualRollbackJobService = createCanaryManualRollbackJobService({',
    'getAuthorizedJobById,',
    'getManualRollback: () => {',
    'const runtime = canaryEditProductionRuntimeInstance;',
    'return runtime ? runtime.manualRollback : null;',
    'markJobCanaryRolledBack,',
    'audit: appendAuditEvent,',
    'const activeHarnessKernelId = canaryRuntimeSelection.activeKernelId;',
  ],
  'manual canary rollback must bind durable job authority to the owned production runtime'
);

assert.strictEqual(
  (mainSource.match(/createAgenticDeleteMutationBackendSelection\(\{/g) || []).length,
  1,
  'the main process must select one shared anchored mutation backend exactly once'
);
for (const forbiddenProductionSeam of [
  'createUnsupportedAnchoredFilesystemMutationBackend',
  'createAnchoredMutationBackendAdapter',
  'anchored_mutation_backend_adapter',
  'providerFactory',
  'isolationAttestation',
]) {
  assert.strictEqual(
    mainSource.includes(forbiddenProductionSeam),
    false,
    `main.js must not directly own the native provider seam: ${forbiddenProductionSeam}`
  );
}
assertInOrder(
  mainSource,
  [
    "app.on('before-quit', (event) => {",
    "clearAssistantRuntimeAuthority('app_before_quit');",
    'beginPortableIsolationHelperShutdown(event);',
    'if (agenticDeleteMutationBackendSelection) {',
    'agenticDeleteMutationBackendSelection.dispose();',
    'agenticDeleteMutationBackendSelection = null;',
    'platformBackendService.stop().catch(() => {});',
  ],
  'shutdown must revoke assistant authority before disposing the main-only mutation seam'
);

assertInOrder(
  mainSource,
  [
    'async function initializePortableIsolationHelperActivation() {',
    'createExecutionIsolationRuntimeConfig({ env: process.env })',
    'createProductionPortableIsolationHelperActivationRuntime({',
    'resourcesPath: process.resourcesPath,',
    'packaged: app.isPackaged,',
    'utilityProcess.fork(modulePath, args, options)',
    'portableIsolationHelperActivationRuntime = runtime;',
    'const selection = await runtime.start();',
    'const runtimeServices = createExecutionIsolationRuntimeServices({',
    'selection,',
    'executionIsolationRuntimeServices = runtimeServices;',
    'portableIsolationHelperProviderSelection = selection;',
    'await initializePortableIsolationHelperActivation();',
  ],
  'main must activate the production-pinned helper and compose one lifecycle-owned service set after Electron is ready'
);

assertInOrder(
  mainSource,
  [
    'function beginPortableIsolationHelperShutdown(event) {',
    'const canaryRuntime = canaryEditProductionRuntimeInstance;',
    'const runtimeServices = executionIsolationRuntimeServices;',
    'event.preventDefault()',
    'canaryEditProductionRuntimeInstance = null;',
    'portableIsolationHelperProviderSelection = null;',
    'executionIsolationRuntimeServices = null;',
    'await canaryRuntime.close()',
    'await runtimeServices.dispose()',
    'await runtime.dispose()',
    'canaryRuntimeClosed',
    'zeroOrphanShutdownConfirmed',
    'portableIsolationHelperActivationRuntime = null;',
    'portableIsolationHelperShutdownComplete = true;',
    'app.quit();',
  ],
  'portable helper shutdown must revoke access, drain services before helper authority, and only then resume application quit'
);

assertInOrder(
  mainSource,
  [
    'onJobTerminal: observeAssistantJobTerminal,',
    'bindJobActionDigest,',
    'createAuthorizedAssistantJob,',
    'getAuthorizedJobById,',
    'markJobCanaryRolledBack,',
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
    'const rollbackCanaryJob = (input) => (',
    'canaryManualRollbackJobService.rollback(input)',
    'const retryAssistantJob = ({ jobId }) => assistantRuntime.retry({ jobId });',
    'registerOrchestrationHandlers({',
    'cancelAssistantJob,',
    'rollbackCanaryJob,',
    'retryAssistantJob,',
  ],
  'cancel, canary rollback, and retry IPC must delegate to authoritative runtime services'
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
  'createAnchoredMutationRuntimeConfig',
  'createAgenticDeleteMutationBackendSelection',
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

assertInOrder(
  legacyExecuteSource,
  [
    "readAgenticDeleteDataProperty(\n      executionContext,\n      'sandboxExecutor'",
    'const processBrokerFactory = agenticProcessBrokerFactoryInstance;',
    'const processBinding = currentAgenticDeleteBinding(authorityBinding);',
    'processBrokerFactory.createRoute(Object.freeze({',
    'binding: processBinding,',
    'sandboxExecutor,',
    'processExecutionPolicy: ASSISTANT_PROCESS_EXECUTION_POLICY,',
    "Object.defineProperty(agenticExecutionOptions, 'executeProcess'",
    'enumerable: false,',
    'processRoute.execute(Object.freeze({',
    "command: readAgenticDeleteDataProperty(processInput, 'command')",
    "args: readAgenticDeleteDataProperty(processInput, 'args')",
    "timeoutMs: readAgenticDeleteDataProperty(processInput, 'timeoutMs')",
    "Object.defineProperty(agenticExecutionOptions, 'readProcess'",
    'processRoute.read(Object.freeze({',
    "cursor: readAgenticDeleteDataProperty(processInput, 'cursor')",
    "maxBytes: readAgenticDeleteDataProperty(processInput, 'maxBytes')",
    "Object.defineProperty(agenticExecutionOptions, 'waitProcess'",
    'processRoute.wait(Object.freeze({',
    "afterRevision: readAgenticDeleteDataProperty(processInput, 'afterRevision')",
    "timeoutMs: readAgenticDeleteDataProperty(processInput, 'timeoutMs')",
    "Object.defineProperty(agenticExecutionOptions, 'stopProcess'",
    'processRoute.stop(Object.freeze({',
    'expectedRevision: readAgenticDeleteDataProperty(',
    "'expectedRevision'",
    'Object.freeze(agenticExecutionOptions)',
  ],
  'the private job executor and its process identity must be consumed only by the exact process broker route while production remains suspended'
);

assertInOrder(
  legacyExecuteSource,
  [
    "readAgenticDeleteDataProperty(\n      executionContext,\n      'sandboxExecutor'",
    'const gitReadBrokerFactory = agenticGitReadBrokerFactoryInstance;',
    'const gitReadBinding = currentAgenticDeleteBinding(authorityBinding);',
    'gitReadBrokerFactory.createRoute(Object.freeze({',
    'binding: gitReadBinding,',
    'sandboxExecutor,',
    "Object.defineProperty(agenticExecutionOptions, 'readGitStatus'",
    'enumerable: false,',
    'gitReadRoute.readStatus()',
    "Object.defineProperty(agenticExecutionOptions, 'readGitHead'",
    'enumerable: false,',
    'gitReadRoute.readHead()',
    "Object.defineProperty(agenticExecutionOptions, 'readGitDiff'",
    'enumerable: false,',
    'gitReadRoute.readDiff()',
    'Object.freeze(agenticExecutionOptions)',
  ],
  'Git status must enter the loop only through a fixed-command broker route bound to the private job executor'
);
const privateGitReadCallbackStart = legacyExecuteSource.indexOf(
  "Object.defineProperty(agenticExecutionOptions, 'readGitStatus'"
);
assert.ok(privateGitReadCallbackStart >= 0, 'missing private readGitStatus callback');
assert.ok(
  legacyExecuteSource.slice(privateGitReadCallbackStart, privateGitReadCallbackStart + 220)
    .includes('enumerable: false'),
  'readGitStatus must remain non-enumerable'
);
for (const callbackName of ['readGitHead', 'readGitDiff']) {
  const callbackStart = legacyExecuteSource.indexOf(
    `Object.defineProperty(agenticExecutionOptions, '${callbackName}'`
  );
  assert.ok(callbackStart >= 0, `missing private ${callbackName} callback`);
  assert.ok(
    legacyExecuteSource.slice(callbackStart, callbackStart + 220)
      .includes('enumerable: false'),
    `${callbackName} must remain non-enumerable`
  );
}

assertInOrder(
  legacyExecuteSource,
  [
    'const mcpDiscoveryBrokerFactory = agenticMcpDiscoveryBrokerFactoryInstance;',
    'const mcpDiscoveryBinding = currentAgenticDeleteBinding(authorityBinding);',
    'mcpDiscoveryBrokerFactory.createRoute(Object.freeze({',
    'binding: mcpDiscoveryBinding,',
    "Object.defineProperty(agenticExecutionOptions, 'readMcpDiscovery'",
    'enumerable: false,',
    'mcpDiscoveryRoute.readCached()',
    'Object.freeze(agenticExecutionOptions)',
  ],
  'cached MCP metadata must enter the loop only through a private job-bound cache-only route'
);
const privateMcpDiscoveryCallbackStart = legacyExecuteSource.indexOf(
  "Object.defineProperty(agenticExecutionOptions, 'readMcpDiscovery'"
);
assert.ok(
  privateMcpDiscoveryCallbackStart >= 0,
  'missing private readMcpDiscovery callback'
);
assert.ok(
  legacyExecuteSource
    .slice(privateMcpDiscoveryCallbackStart, privateMcpDiscoveryCallbackStart + 240)
    .includes('enumerable: false'),
  'readMcpDiscovery must remain non-enumerable'
);
const mcpDiscoveryRouteStart = legacyExecuteSource.indexOf(
  'const mcpDiscoveryBrokerFactory = agenticMcpDiscoveryBrokerFactoryInstance;'
);
const mcpDiscoveryRouteEnd = legacyExecuteSource.indexOf(
  'const mcpToolBrokerFactory = agenticMcpToolBrokerFactoryInstance;',
  mcpDiscoveryRouteStart
);
const mcpDiscoveryRouteSource = legacyExecuteSource.slice(
  mcpDiscoveryRouteStart,
  mcpDiscoveryRouteEnd
);
for (const forbiddenMcpRouteToken of [
  'externalMcpBridge',
  'discoverTools',
  'callTool',
  'endpoint',
  'includeSecrets',
  'serverRegistry',
]) {
  assert.strictEqual(
    mcpDiscoveryRouteSource.includes(forbiddenMcpRouteToken),
    false,
    `the MCP cache-only route must not receive ${forbiddenMcpRouteToken}`
  );
}

assertInOrder(
  legacyExecuteSource,
  [
    'const mcpToolBrokerFactory = agenticMcpToolBrokerFactoryInstance;',
    'const mcpToolBinding = currentAgenticDeleteBinding(authorityBinding);',
    'mcpToolRoute = mcpToolBrokerFactory.createRoute(Object.freeze({',
    'binding: mcpToolBinding,',
    "Object.defineProperty(agenticExecutionOptions, 'callMcpTool'",
    'enumerable: false,',
    'mcpToolRoute.call(Object.freeze({',
    "serverId: readAgenticDeleteDataProperty(mcpInput, 'serverId')",
    "toolName: readAgenticDeleteDataProperty(mcpInput, 'toolName')",
    "arguments: readAgenticDeleteDataProperty(mcpInput, 'arguments')",
    "idempotencyKey: readAgenticDeleteDataProperty(mcpInput, 'idempotencyKey')",
    'Object.freeze(agenticExecutionOptions)',
  ],
  'MCP invocation must enter the loop only through the private exact job-bound broker route'
);
const privateMcpToolCallbackStart = legacyExecuteSource.indexOf(
  "Object.defineProperty(agenticExecutionOptions, 'callMcpTool'"
);
assert.ok(privateMcpToolCallbackStart >= 0, 'missing private callMcpTool callback');
assert.ok(
  legacyExecuteSource.slice(privateMcpToolCallbackStart, privateMcpToolCallbackStart + 640)
    .includes('enumerable: false'),
  'callMcpTool must remain non-enumerable'
);

assertInOrder(
  legacyExecuteSource,
  [
    "readAgenticDeleteDataProperty(\n      executionContext,\n      'projectRootLease'",
    "readAgenticDeleteDataProperty(projectRootLease, 'reader')",
    'const domainReadBrokerFactory = agenticDomainReadBrokerFactoryInstance;',
    'domainReadBrokerFactory.createRoute(Object.freeze({',
    'binding: domainReadBinding,',
    'projectRootReader,',
    "Object.defineProperty(agenticExecutionOptions, 'readDomain'",
    'enumerable: false,',
    'domainReadRoute.execute(Object.freeze({',
    "capability: readAgenticDeleteDataProperty(domainInput, 'capability')",
    "action: readAgenticDeleteDataProperty(domainInput, 'action')",
    "payload: readAgenticDeleteDataProperty(domainInput, 'payload')",
    'Object.freeze(agenticExecutionOptions)',
  ],
  'Files, Map, and Milestones must enter the loop only through the private job-bound domain broker route'
);
const privateDomainCallbackStart = legacyExecuteSource.indexOf(
  "Object.defineProperty(agenticExecutionOptions, 'readDomain'"
);
assert.ok(privateDomainCallbackStart >= 0, 'missing private readDomain callback');
assert.ok(
  legacyExecuteSource.slice(privateDomainCallbackStart, privateDomainCallbackStart + 220)
    .includes('enumerable: false'),
  'readDomain must remain non-enumerable'
);
assert.strictEqual(
  legacyExecuteSource.includes('projectRootReader: projectRootReader'),
  false,
  'the raw project-root reader must never be forwarded to the model loop'
);
for (const privateProcessCallback of [
  'executeProcess',
  'readProcess',
  'waitProcess',
  'stopProcess',
]) {
  const callbackStart = legacyExecuteSource.indexOf(
    `Object.defineProperty(agenticExecutionOptions, '${privateProcessCallback}'`
  );
  assert.ok(callbackStart >= 0, `missing private process callback: ${privateProcessCallback}`);
  assert.ok(
    legacyExecuteSource.slice(callbackStart, callbackStart + 220).includes('enumerable: false'),
    `${privateProcessCallback} must remain non-enumerable`
  );
}
assert.strictEqual(
  legacyExecuteSource.includes('sandboxExecutor: sandboxExecutor'),
  false,
  'the raw sandbox executor must never be forwarded to the model tool loop'
);

assertInOrder(
  mainSource,
  [
    'const assistantExecutionIsolationRuntimeServices = executionIsolationRuntimeServices;',
    'const assistantProcessSandboxRegistry = assistantExecutionIsolationRuntimeServices',
    '? createExecutionIsolationBrokerSandboxRegistry({',
    'runtimeServices: assistantExecutionIsolationRuntimeServices,',
    'const agenticProcessBrokerFactory = assistantProcessSandboxRegistry',
    '? createAgenticProcessBrokerFactory({',
    'authorizeLifecycle: authorizeAgenticDeleteLifecycle,',
    'authorizeRoot: authorizeAgenticDeleteRoot,',
    'authorizeEffectFrontier: authorizeAgenticDeleteEffectFrontier,',
    'sandboxRegistry: assistantProcessSandboxRegistry,',
    'agenticProcessBrokerFactoryInstance = agenticProcessBrokerFactory;',
    'const assistantExecutionCoordinator = createAssistantExecutionCoordinator({',
  ],
  'the attested sandbox registry and process broker factory must be composed before coordinator execution starts'
);
assertInOrder(
  mainSource,
  [
    'const agenticGitReadBrokerFactory = assistantProcessSandboxRegistry',
    '? createAgenticGitReadBrokerFactory({',
    'authorizeLifecycle: authorizeAgenticDeleteLifecycle,',
    'authorizeRoot: authorizeAgenticDeleteRoot,',
    'authorizeEffectFrontier: authorizeAgenticDeleteEffectFrontier,',
    'sandboxRegistry: assistantProcessSandboxRegistry,',
    'agenticGitReadBrokerFactoryInstance = agenticGitReadBrokerFactory;',
    'const assistantExecutionCoordinator = createAssistantExecutionCoordinator({',
  ],
  'the fixed Git read broker factory must be composed before coordinated execution starts'
);
assertInOrder(
  mainSource,
  [
    'const agenticDomainReadBrokerFactory = createAgenticDomainReadBrokerFactory({',
    'authorizeLifecycle: authorizeAgenticDeleteLifecycle,',
    'authorizeRoot: authorizeAgenticDeleteRoot,',
    'authorizeEffectFrontier: authorizeAgenticDeleteEffectFrontier,',
    'agenticDomainReadBrokerFactoryInstance = agenticDomainReadBrokerFactory;',
    'const assistantExecutionCoordinator = createAssistantExecutionCoordinator({',
  ],
  'the read-only domain broker factory must be composed before coordinated execution starts'
);
assertInOrder(
  mainSource,
  [
    'const agenticMcpDiscoveryBrokerFactory = createAgenticMcpDiscoveryBrokerFactory({',
    'authorizeLifecycle: authorizeAgenticDeleteLifecycle,',
    'authorizeRoot: authorizeAgenticDeleteRoot,',
    'authorizeEffectFrontier: authorizeAgenticDeleteEffectFrontier,',
    'readDiscoveryCache: () => externalMcpDiscoveryCacheService.listDiscoveries(),',
    'agenticMcpDiscoveryBrokerFactoryInstance = agenticMcpDiscoveryBrokerFactory;',
    'const assistantExecutionCoordinator = createAssistantExecutionCoordinator({',
  ],
  'the cache-only MCP discovery broker must be composed before coordinated execution starts'
);
const mcpDiscoveryCompositionStart = mainSource.indexOf(
  'const agenticMcpDiscoveryBrokerFactory = createAgenticMcpDiscoveryBrokerFactory({'
);
const mcpDiscoveryCompositionEnd = mainSource.indexOf(
  'const agenticMcpWriteApprovalService = createAgenticMcpWriteApprovalService({',
  mcpDiscoveryCompositionStart
);
const mcpDiscoveryCompositionSource = mainSource.slice(
  mcpDiscoveryCompositionStart,
  mcpDiscoveryCompositionEnd
);
for (const forbiddenMcpCompositionToken of [
  'externalMcpBridgeService',
  'externalMcpServerRegistryService',
  'discoverTools',
  'callTool',
  'includeSecrets',
]) {
  assert.strictEqual(
    mcpDiscoveryCompositionSource.includes(forbiddenMcpCompositionToken),
    false,
    `MCP discovery composition must not receive ${forbiddenMcpCompositionToken}`
  );
}

assertInOrder(
  mainSource,
  [
    'const agenticMcpWriteApprovalService = createAgenticMcpWriteApprovalService({',
    'showNativeDialog: showAgenticDeleteNativeDialog,',
    'authorizeLifecycle: authorizeAgenticDeleteLifecycle,',
    'authorizeRoot: authorizeAgenticMcpWriteRoot,',
    'authorizeWriteFrontier: authorizeAgenticMcpWriteFrontier,',
    'getWindowLease: getAgenticDeleteWindowLease,',
    'getSignal: getActiveAgenticExecutionSignal,',
    'agenticMcpWriteApprovalServiceInstance = agenticMcpWriteApprovalService;',
    'const agenticMcpToolBrokerFactory = createAgenticMcpToolBrokerFactory({',
    'readDiscoveryCache: () => externalMcpDiscoveryCacheService.listDiscoveries(),',
    'callExternalTool: callAgenticExternalMcpTool,',
    'requestWriteApproval: requestAgenticMcpWriteApproval,',
    'consumeWriteApproval: consumeAgenticMcpWriteApproval,',
    'getSignal: getActiveAgenticExecutionSignal,',
    'agenticMcpToolBrokerFactoryInstance = agenticMcpToolBrokerFactory;',
    'const assistantExecutionCoordinator = createAssistantExecutionCoordinator({',
  ],
  'MCP external effects must be composed behind exact native approval before coordination'
);
const mcpWriteFrontierSource = extractFunctionDeclaration(
  mainSource,
  'authorizeAgenticMcpWriteFrontier'
);
for (const exactMcpWriteField of [
  "'serverId'",
  "'toolName'",
  "'invocationDigest'",
  'getAgenticDeleteWindowLease()',
  'currentAgenticDeleteBinding(binding)',
]) {
  assert.ok(
    mcpWriteFrontierSource.includes(exactMcpWriteField),
    `MCP write frontier must bind ${exactMcpWriteField}`
  );
}
assert.ok(
  runtimeClearSource.includes('agenticMcpWriteApprovalServiceInstance.clear()'),
  'runtime authority reset must revoke pending and active MCP write approvals'
);
assert.ok(
  legacyExecuteSource.includes('agenticMcpWriteApprovalServiceInstance.cancelJob(Object.freeze({'),
  'terminal agentic execution must revoke unused MCP write receipts'
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
