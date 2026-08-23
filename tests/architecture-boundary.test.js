const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

const ignoredDirs = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'dist',
  'node_modules',
  'release',
]);

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function walkJsFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function relative(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

function assertDoesNotMatch(source, pattern, message) {
  assert.strictEqual(pattern.test(source), false, message);
}

function assertRendererBoundary() {
  const rendererDir = path.join(rootDir, 'renderer');
  const rendererFiles = walkJsFiles(rendererDir);
  const appSource = read('renderer/app.js');

  for (const filePath of rendererFiles) {
    const rel = relative(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    assertDoesNotMatch(source, /\brequire\s*\(/, `${rel} must not use CommonJS require; preload owns Node/Electron access`);
    assertDoesNotMatch(source, /\bipcRenderer\b/, `${rel} must not access ipcRenderer directly`);
    assertDoesNotMatch(source, /require\(['"]electron['"]\)/, `${rel} must not import Electron directly`);
    if (rel !== 'renderer/app.js') {
      assertDoesNotMatch(
        source,
        /\bwindow\.localcodeApi\b/,
        `${rel} must receive the preload bridge through injected controller options`
      );
    }
  }

  assert.ok(
    appSource.includes('window.FaberAppState.createInitialRendererState()'),
    'renderer/app.js must initialize UI state through renderer/app_state.js'
  );
  assert.ok(
    appSource.includes('window.FaberStartupPreloader.createStartupPreloaderController'),
    'renderer/app.js must delegate startup preloader behavior to renderer/startup_preloader.js'
  );
  assertDoesNotMatch(
    appSource,
    /\bBOOT_MIN_PRELOADER_MS\b|\bpreloaderHideRequested\b|\bstartupPreloaderEl\b/,
    'renderer/app.js must not own startup preloader timing or DOM removal internals'
  );
}

function assertPreloadBoundary() {
  const source = read('preload.js');
  assert.ok(
    source.includes("contextBridge.exposeInMainWorld('localcodeApi'"),
    'preload.js must expose a single localcodeApi bridge'
  );
  assertDoesNotMatch(
    source,
    /exposeInMainWorld\(['"]ipcRenderer['"]/,
    'preload.js must never expose raw ipcRenderer'
  );
  assertDoesNotMatch(
    source,
    /exposeInMainWorld\(['"]electron['"]/,
    'preload.js must never expose raw Electron objects'
  );
}

function assertCortexBoundary() {
  const cortexFiles = walkJsFiles(path.join(rootDir, 'cortex'));
  for (const filePath of cortexFiles) {
    const rel = relative(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    assertDoesNotMatch(source, /require\(['"]electron['"]\)/, `${rel} must stay runtime-agnostic and not import Electron`);
    assertDoesNotMatch(source, /require\(['"](?:[^'"]*[\/\\])?renderer[\/\\][^'"]*['"]\)/, `${rel} must not depend on renderer modules`);
    assertDoesNotMatch(source, /\bipcRenderer\b/, `${rel} must not use renderer IPC APIs`);
  }
}

function assertMainBoundary() {
  const mainFiles = [
    path.join(rootDir, 'main.js'),
    ...walkJsFiles(path.join(rootDir, 'main')),
  ];

  for (const filePath of mainFiles) {
    const rel = relative(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    assertDoesNotMatch(source, /require\(['"][^'"]*renderer\/[^'"]*\.js['"]\)/, `${rel} must not import renderer scripts`);
    assertDoesNotMatch(source, /\bipcRenderer\b/, `${rel} must not use renderer-side IPC APIs`);
  }
}

function assertAgentRuntimeBoundary() {
  const runtimeDir = path.join(rootDir, 'main', 'agent_runtime');
  const runtimeFiles = walkJsFiles(runtimeDir);
  assert.ok(runtimeFiles.length >= 5, 'agent runtime boundary must include contracts, config, router, and kernels');

  for (const filePath of runtimeFiles) {
    const rel = relative(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    assertDoesNotMatch(source, /require\(['"]electron['"]\)/, `${rel} must not import Electron`);
    assertDoesNotMatch(source, /require\(['"][^'"]*renderer[^'"]*['"]\)/, `${rel} must not import renderer modules`);
    assertDoesNotMatch(source, /require\(['"][^'"]*cortex[^'"]*['"]\)/, `${rel} must not import Cortex internals`);
    assertDoesNotMatch(source, /\bipc(?:Main|Renderer)\b/, `${rel} must not own IPC transport`);
  }

  const routerSource = read('main/agent_runtime/harness_router.js');
  const facadeSource = read('main/agent_runtime/assistant_runtime_facade.js');
  assertDoesNotMatch(
    routerSource,
    /require\(['"]\.\/legacy_kernel_adapter['"]\)/,
    'HarnessRouter must depend on the AgentKernel contract, not the legacy adapter implementation'
  );
  assertDoesNotMatch(
    facadeSource,
    /\.execute\(\s*action\b|execute\(\s*action\s*,\s*projectInfo/,
    'AssistantRuntimeFacade must expose execution by authoritative job locator only'
  );
  assert.ok(
    facadeSource.includes('coordinator.execute(input)'),
    'AssistantRuntimeFacade must delegate public execution to the main-only coordinator'
  );
  assert.ok(
    facadeSource.includes('coordinator.retry({'),
    'AssistantRuntimeFacade must delegate retry to the main-only coordinator'
  );
}

function assertProjectCapabilityBoundary() {
  const capabilityDir = path.join(rootDir, 'main', 'capabilities');
  const capabilityFiles = walkJsFiles(capabilityDir);
  assert.ok(
    capabilityFiles.length >= 10,
    'project capability boundary must include contracts, policy, grants, approvals, task delegation, broker, and sandbox ports'
  );

  for (const filePath of capabilityFiles) {
    const rel = relative(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    assertDoesNotMatch(source, /require\(['"]electron['"]\)/, `${rel} must not import Electron`);
    assertDoesNotMatch(source, /require\(['"][^'"]*renderer[^'"]*['"]\)/, `${rel} must not import renderer modules`);
    assertDoesNotMatch(source, /require\(['"][^'"]*cortex[^'"]*['"]\)/, `${rel} must not import Cortex internals`);
    assertDoesNotMatch(source, /require\(['"][^'"]*legacy[^'"]*['"]\)/, `${rel} must not depend on the legacy harness`);
    assertDoesNotMatch(source, /\bipc(?:Main|Renderer)\b/, `${rel} must not own IPC transport`);
  }

  const brokerSource = read('main/capabilities/project_capability_broker.js');
  const registrySource = read('main/capabilities/sandbox_backend_registry.js');
  const delegationStoreSource = read('main/capabilities/task_delegation_store.js');
  for (const [label, source] of [
    ['ProjectCapabilityBroker', brokerSource],
    ['SandboxBackendRegistry', registrySource],
  ]) {
    assertDoesNotMatch(source, /\bprocess\.platform\b/, `${label} must select behavior by injected capabilities`);
    assertDoesNotMatch(source, /require\(['"]child_process['"]\)/, `${label} must not spawn host processes directly`);
  }

  assert.ok(
    delegationStoreSource.includes('consentAuthority.consume'),
    'TaskDelegationStore must consume consent through an injected main-process authority'
  );
  assert.ok(
    delegationStoreSource.includes('authorizeRoot'),
    'TaskDelegationStore must revalidate an authoritative project root'
  );
  assertDoesNotMatch(
    delegationStoreSource,
    /writeAlwaysAllow|terminalAlwaysAllow|autoExecute/,
    'Task delegation must not reuse legacy global or model-controlled authority flags'
  );

  const publicConsentBoundarySources = [
    ['preload.js', read('preload.js')],
    ...walkJsFiles(path.join(rootDir, 'renderer')).map((filePath) => [
      relative(filePath),
      fs.readFileSync(filePath, 'utf8'),
    ]),
    ...walkJsFiles(path.join(rootDir, 'main', 'ipc')).map((filePath) => [
      relative(filePath),
      fs.readFileSync(filePath, 'utf8'),
    ]),
  ];
  for (const [label, source] of publicConsentBoundarySources) {
    assertDoesNotMatch(
      source,
      /\bconsentHandle\b|\bissueFromNativeConfirmation\b|trusted_consent_authority/,
      `${label} must not expose or accept main-only trusted consent authority handles`
    );
    assertDoesNotMatch(
      source,
      /\bsubmissionId\b|\bbeginSubmission\b|assistant_job_authority_service/,
      `${label} must not expose main-only assistant job authority handles`
    );
  }

  const jobAuthoritySource = read('main/services/assistant_job_authority_service.js');
  assertDoesNotMatch(jobAuthoritySource, /require\(['"]electron['"]\)/, 'Assistant job authority must not import Electron');
  assertDoesNotMatch(jobAuthoritySource, /require\(['"][^'"]*renderer[^'"]*['"]\)/, 'Assistant job authority must not import renderer modules');
  assertDoesNotMatch(jobAuthoritySource, /require\(['"][^'"]*cortex[^'"]*['"]\)/, 'Assistant job authority must receive persistence through injection');
  assertDoesNotMatch(jobAuthoritySource, /\bipc(?:Main|Renderer)\b/, 'Assistant job authority must not own IPC transport');

  const nativeConsentSource = read('main/services/native_task_consent_service.js');
  assertDoesNotMatch(nativeConsentSource, /require\(['"]electron['"]\)/, 'Native task consent must receive the dialog adapter through injection');
  assertDoesNotMatch(nativeConsentSource, /require\(['"][^'"]*renderer[^'"]*['"]\)/, 'Native task consent must not import renderer modules');
  assertDoesNotMatch(nativeConsentSource, /require\(['"][^'"]*cortex[^'"]*['"]\)/, 'Native task consent must not import Cortex internals');
  assertDoesNotMatch(nativeConsentSource, /\bipc(?:Main|Renderer)\b/, 'Native task consent must not own IPC transport');

  const nativeEffectApprovalSource = read('main/services/native_effect_approval_service.js');
  const transactionalDeleteSource = read('main/services/transactional_filesystem_delete_service.js');
  const anchoredMutationAdapterSource = read('main/services/anchored_mutation_backend_adapter.js');
  const deleteOrchestratorSource = read('main/services/agentic_delete_orchestrator.js');
  const deleteRuntimeSource = read('main/services/agentic_delete_runtime_service.js');
  for (const [label, source] of [
    ['Native effect approval', nativeEffectApprovalSource],
    ['Transactional delete service', transactionalDeleteSource],
    ['Agentic delete orchestrator', deleteOrchestratorSource],
    ['Agentic delete runtime', deleteRuntimeSource],
  ]) {
    assertDoesNotMatch(source, /require\(['"]electron['"]\)/, `${label} must receive Electron adapters through injection`);
    assertDoesNotMatch(source, /require\(['"][^'"]*renderer[^'"]*['"]\)/, `${label} must not import renderer modules`);
    assertDoesNotMatch(source, /\bipc(?:Main|Renderer)\b/, `${label} must not own IPC transport`);
  }
  assert.ok(
    transactionalDeleteSource.includes('createUnsupportedAnchoredFilesystemMutationBackend'),
    'Transactional delete must default to an unavailable anchored mutation backend'
  );
  assert.ok(
    /TRANSACTIONAL_FILESYSTEM_DELETE_SERVICE_VERSION\s*=\s*['"]transactional-filesystem-delete-service\.v2['"]/.test(
      transactionalDeleteSource
    ),
    'Transactional delete must keep the anchored namespace-I/O v2 consumer contract'
  );
  assertDoesNotMatch(
    transactionalDeleteSource,
    /\bfunction\s+(?:readPrivateJson|ensurePrivateDirectories|loadTransactionFromDisk)\s*\(/,
    'Transactional delete must not retain pathname-based private metadata fallbacks'
  );
  const transactionalDeleteFactoryStart = transactionalDeleteSource.indexOf(
    'function createTransactionalFilesystemDeleteService'
  );
  const transactionalDeleteFactoryEnd = transactionalDeleteSource.indexOf(
    'class TransactionalFilesystemDeleteService',
    transactionalDeleteFactoryStart
  );
  assert.ok(
    transactionalDeleteFactoryStart >= 0 && transactionalDeleteFactoryEnd > transactionalDeleteFactoryStart,
    'Transactional delete factory boundary must remain inspectable'
  );
  const transactionalDeleteFactorySource = transactionalDeleteSource.slice(
    transactionalDeleteFactoryStart,
    transactionalDeleteFactoryEnd
  );
  assertDoesNotMatch(
    transactionalDeleteFactorySource,
    /\bfs\.(?:appendFileSync|chmodSync|chownSync|copyFileSync|cpSync|linkSync|mkdirSync|renameSync|rmSync|rmdirSync|symlinkSync|truncateSync|unlinkSync|utimesSync|writeFileSync)\s*\(/,
    'Transactional delete core must not mutate private metadata by pathname'
  );
  assertDoesNotMatch(
    transactionalDeleteFactorySource,
    /\bdurability\.(?:writeJsonAtomic|syncDirectory)\s*\(/,
    'Transactional delete core must not revive the legacy pathname durability adapter'
  );
  const prepareStart = transactionalDeleteFactorySource.indexOf('function prepare(input = {})');
  const prepareEnd = transactionalDeleteFactorySource.indexOf(
    'function normalizeTerminalInput',
    prepareStart
  );
  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart, 'Transactional prepare boundary must remain inspectable');
  const prepareSource = transactionalDeleteFactorySource.slice(prepareStart, prepareEnd);
  const prepareSessionIndex = prepareSource.indexOf(
    'transaction.mutationSession = prepareMutationSession(transaction);'
  );
  const firstPrivateWriteIndex = prepareSource.indexOf('writeNamespaceJson(');
  assert.ok(
    prepareSessionIndex >= 0 && firstPrivateWriteIndex > prepareSessionIndex,
    'Transactional delete must open the anchored session before its first private metadata write'
  );
  assert.ok(
    /authorizeFinalFrontier\(transaction\.binding\);\s*const movement = transaction\.mutationSession\.moveToQuarantine\(/.test(
      transactionalDeleteSource
    )
      && /authorizeFinalFrontier\(transaction\.binding\);\s*const purged = transaction\.mutationSession\.purgeQuarantine\(/.test(
        transactionalDeleteSource
      )
      && /authorizeFinalFrontier\(binding\);\s*const cleaned = rootNamespaceMethod\(orphanRoot, 'cleanupAuthenticatedOrphan'\)/.test(
        transactionalDeleteSource
      ),
    'Transactional delete must enter the combined frontier immediately before every irreversible anchored mutation'
  );
  assert.ok(
    /ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION\s*=\s*['"]anchored-mutation-backend-adapter\.v3['"]/.test(
      anchoredMutationAdapterSource
    )
      && anchoredMutationAdapterSource.includes(
        'namespaceIoVersion: ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION'
      )
      && anchoredMutationAdapterSource.includes('openRootNamespace'),
    'Anchored helper adapter must expose the receipt-bound namespace-I/O v3 backend surface'
  );
  assertDoesNotMatch(
    anchoredMutationAdapterSource,
    /\bNAMESPACE_IO_CONSUMER_NOT_INTEGRATED\b/,
    'Anchored helper adapter must not retain the pre-consumer integration blocker'
  );
  assertDoesNotMatch(
    [...publicConsentBoundarySources, ['cortex/tools/automata_tools.js', read('cortex/tools/automata_tools.js')]]
      .map(([, source]) => source)
      .join('\n'),
    /\bauthorityBinding\b|\bcheckpointDigest\b|\bdelegationId\b|\bnativeEffectApprovalService\b|\bidentityReceipt\b|\breceiptDigest\b|\brootIdentityDigest\b|\bnamespaceIdentityDigest\b|\bproviderFactory\b|physicalIdentityReceipts|anchored-mutation-provider/,
    'Renderer, IPC and Cortex tools must not expose transactional delete authority or physical identity internals'
  );

  for (const [label, source] of publicConsentBoundarySources) {
    assertDoesNotMatch(
      source,
      /\bensureTaskDelegation\b|native_task_consent_service/,
      `${label} must not expose the main-only native consent service`
    );
  }

  const orchestrationIpcSource = read('main/ipc/orchestration_handlers.js');
  assertDoesNotMatch(
    orchestrationIpcSource,
    /\bgetAuthorizedJobById\b|\bbindJobActionDigest\b/,
    'Orchestration IPC must use only public redacted job APIs'
  );
}

function assertAssistantHarnessCompositionBoundary() {
  const mainSource = read('main.js');
  const handlerSource = read('main/ipc/assistant_handlers.js');
  const agenticToolLoopSource = read('main/services/agentic_tool_loop_service.js');
  const mutationBackendFactorySource = read(
    'main/services/agentic_delete_mutation_backend_factory.js'
  );
  const mutationRuntimeConfigSource = read(
    'main/runtime/anchored_mutation_runtime_config.js'
  );
  const preloadSource = read('preload.js');
  const appActionsSource = read('renderer/app_actions.js');
  const mainModuleSources = walkJsFiles(path.join(rootDir, 'main')).map((filePath) => ({
    filePath,
    source: fs.readFileSync(filePath, 'utf8'),
  }));
  const mainRuntimeSources = [
    mainSource,
    ...mainModuleSources.map(({ source }) => source),
  ].join('\n');

  assertDoesNotMatch(
    mainSource,
    /anchored_mutation_backend_adapter|createAnchoredMutationBackendAdapter|providerFactory|\.node\b/,
    'main.js must reach anchored mutation only through the fail-closed main-only factory seam'
  );
  assert.ok(
    mainSource.includes('createAnchoredMutationRuntimeConfig({')
      && mainSource.includes('env: process.env,')
      && mainSource.includes('createAgenticDeleteMutationBackendSelection({')
      && mainSource.includes('config: agenticDeleteMutationRuntimeConfig,')
      && mainSource.includes(
        'const agenticDeleteMutationBackend = agenticDeleteMutationBackendSelection.backend;'
      ),
    'main.js must compose anchored mutation through runtime config and the fail-closed factory'
  );
  assertDoesNotMatch(
    mainSource,
    /createUnsupportedAnchoredFilesystemMutationBackend|anchored-mutation-provider\.v1|isolationAttestation/,
    'main.js must neither construct the fallback nor attest a native provider itself'
  );
  assert.ok(
    mutationBackendFactorySource.includes('createUnsupportedAnchoredFilesystemMutationBackend')
      && mutationBackendFactorySource.includes('createAnchoredMutationBackendAdapter')
      && mutationBackendFactorySource.includes("'anchored-mutation-isolation-attestation.v1'")
      && mutationBackendFactorySource.includes('physicalIdentityReceipts')
      && mutationBackendFactorySource.includes('sourceIdentityCompareAndSwap')
      && mutationBackendFactorySource.includes('subtreeMutationExcluded')
      && mutationBackendFactorySource.includes('durablePhysicalProgress'),
    'the main-only factory must own fallback, adapter creation, and exact isolation attestation'
  );
  assert.ok(
    mutationRuntimeConfigSource.includes("'FABER_ANCHORED_MUTATION_MODE'")
      && mutationRuntimeConfigSource.includes("'FABER_ANCHORED_MUTATION_KILL_SWITCH'")
      && mutationRuntimeConfigSource.includes("mode: 'disabled'")
      && mutationRuntimeConfigSource.includes('killSwitch: true'),
    'anchored mutation runtime config must default to disabled behind an active kill switch'
  );
  assert.strictEqual(
    (mainSource.match(/mutationBackend: agenticDeleteMutationBackend,/g) || []).length,
    2,
    'main.js must inject one selected delete backend into exactly the recovery and live runtimes'
  );
  assert.ok(
    mainSource.includes('agenticDeleteMutationBackendSelection.dispose();')
      && mainSource.includes('agenticDeleteMutationBackendSelection = null;'),
    'main.js must dispose the selected provider seam at process shutdown'
  );
  assert.strictEqual(
    (mainRuntimeSources.match(/createAgenticDeleteMutationBackendSelection\(\{/g) || []).length,
    1,
    'production must keep exactly one fail-closed mutation backend selection site'
  );
  for (const { filePath, source } of mainModuleSources) {
    const relativePath = path.relative(rootDir, filePath);
    if ([
      'main/services/agentic_delete_mutation_backend_factory.js',
      'main/services/anchored_mutation_backend_adapter.js',
      'main/services/execution_isolation_provider_factory.js',
    ].includes(relativePath)) continue;
    assertDoesNotMatch(
      source,
      /\bproviderFactory\b|createAnchoredMutationBackendAdapter|require\(['"][^'"]*anchored_mutation_backend_adapter['"]\)/,
      `${relativePath} must not activate or bypass a sealed native-provider seam`
    );
  }
  assertDoesNotMatch(
    agenticToolLoopSource,
    /name:\s*['"](?:run_command|preview_capture)['"]/,
    'the model must not receive shell or preview capture before the portable sandbox exists'
  );
  assert.ok(
    agenticToolLoopSource.includes('informe-as como pendentes para o usuário'),
    'the model prompt must describe suspended validation honestly'
  );
  assert.ok(
    mainSource.includes('processExecutionPolicy: ASSISTANT_PROCESS_EXECUTION_POLICY')
      && mainSource.includes('processExecutionAllowed: false')
      && mainSource.includes('buildAssistantVisualValidationPending()'),
    'all assistant-owned indirect process and preview paths must stay suspended'
  );
  assert.ok(
    preloadSource.includes("startProjectPreview: (payload) => ipcRenderer.invoke('project:preview:start', payload)")
      && preloadSource.includes("runProjectTerminalCommand: (payload) => ipcRenderer.invoke('project:terminal:run', payload)"),
    'direct user Preview and Terminal APIs must remain available while assistant shell is suspended'
  );

  for (const operation of ['plan', 'message', 'execute']) {
    const registrationPattern = new RegExp(
      `registerIpcHandler\\(\\s*['"]assistant:${operation}['"]`,
      'g'
    );
    assert.strictEqual(
      (mainRuntimeSources.match(registrationPattern) || []).length,
      1,
      `assistant:${operation} must be registered exactly once in the main process`
    );
    assert.ok(
      registrationPattern.test(handlerSource),
      `assistant:${operation} must be owned by main/ipc/assistant_handlers.js`
    );
  }

  assert.ok(mainSource.includes('createLegacyKernelAdapter({'), 'main.js must compose the legacy kernel adapter');
  assert.ok(mainSource.includes('createHarnessRouter({'), 'main.js must compose the HarnessRouter');
  assert.ok(mainSource.includes('registerAssistantHandlers({'), 'main.js must register assistant IPC through the harness');
  assert.ok(
    mainSource.includes('assistantRuntime,'),
    'assistant IPC must receive the authoritative runtime facade'
  );
  assertDoesNotMatch(
    preloadSource,
    /executePlan:\s*\(\s*action\s*,\s*projectInfo\s*\)|ipcRenderer\.invoke\(['"]job:cancel['"]|assistant:execute['"],\s*action/,
    'preload must expose execute and cancel by authoritative job locator only'
  );
  assertDoesNotMatch(
    appActionsSource,
    /meta\.autoExecute|pendingAction\.jobId|executePlan\(\s*state\.pendingAction/,
    'renderer plans and actions must never mint execution authority'
  );
  assertDoesNotMatch(
    mainSource,
    /registerIpcHandler\(\s*['"]job:cancel['"]|sessionPermissions\.(?:writeAlwaysAllow|terminalAlwaysAllow)\s*=\s*true;[\s\S]{0,300}normalizeAuthorizedProjectInfo\(projectInfo/,
    'main must not retain raw cancellation or assistant auto-grant bypasses'
  );
}

function assertProductToolchainUsesExecutionBoundary() {
  const productContract = read('tests/product-toolchain-contract.test.js');
  assert.ok(
    productContract.includes('createAutomataExecutor'),
    'product toolchain contract must validate writes through the Automata executor'
  );
  assert.ok(
    productContract.includes('findCssImportOrderViolation'),
    'product toolchain contract must guard generated CSS import ordering'
  );

  const executor = read('cortex/automata/core/executor.js');
  assert.ok(
    executor.includes('normalizeCssImportOrder'),
    'Automata executor must normalize CSS imports before writing CSS files'
  );
}

function assertExecutionWorkspaceBoundary() {
  const mainSource = read('main.js');
  const coordinatorSource = read('main/agent_runtime/assistant_execution_coordinator.js');
  const recoverySource = read('main/services/agentic_delete_recovery_service.js');
  const contractSource = read('main/capabilities/execution_workspace_contract.js');
  const registrySource = read('main/capabilities/execution_workspace_registry.js');
  const rootAuthorityContractSource = read('main/capabilities/project_root_authority_contract.js');
  const rootAuthorityRegistrySource = read('main/capabilities/project_root_authority_registry.js');
  const isolationRuntimeConfigSource = read(
    'main/runtime/execution_isolation_runtime_config.js'
  );
  const isolationProviderFactorySource = read(
    'main/services/execution_isolation_provider_factory.js'
  );
  const processSupervisorContractSource = read(
    'main/capabilities/process_supervisor_contract.js'
  );
  const portableIsolationHelperProtocolSource = read(
    'main/capabilities/portable_isolation_helper_protocol.js'
  );
  const portableIsolationHelperBackendContractSource = read(
    'main/capabilities/portable_isolation_helper_backend_contract.js'
  );
  const portableIsolationHelperLauncherContractSource = read(
    'main/capabilities/portable_isolation_helper_launcher_contract.js'
  );
  const portableIsolationHelperPrivateTransportContractSource = read(
    'main/capabilities/portable_isolation_helper_private_transport_contract.js'
  );
  const portableIsolationHelperDistributionAttestationContractSource = read(
    'main/capabilities/portable_isolation_helper_distribution_attestation_contract.js'
  );
  const portableIsolationHelperDistributionVerifierSource = read(
    'main/services/portable_isolation_helper_distribution_verifier.js'
  );
  const portableIsolationHelperClientSource = read(
    'main/services/portable_isolation_helper_client.js'
  );
  const portableIsolationHelperProviderAdapterSource = read(
    'main/services/portable_isolation_helper_provider_adapter.js'
  );
  const portableIsolationHelperRuntimeSessionSource = read(
    'main/services/portable_isolation_helper_runtime_session.js'
  );
  const portableIsolationHelperBackendDispatcherSource = read(
    'main/services/portable_isolation_helper_backend_dispatcher.js'
  );
  const portableExecutionWorkspaceBackendSource = read(
    'main/services/portable_isolation_helper_execution_workspace_backend.js'
  );
  const portableProjectRootAuthorityBackendSource = read(
    'main/services/portable_isolation_helper_project_root_authority_backend.js'
  );
  const portableProcessSupervisorBackendSource = read(
    'main/services/portable_isolation_helper_process_supervisor_backend.js'
  );
  const portableIsolationHelperPrivateTransportSource = read(
    'main/services/portable_isolation_helper_private_transport.js'
  );
  const portableIsolationHelperPhysicalRuntimeSource = read(
    'main/services/portable_isolation_helper_physical_runtime.js'
  );
  const portableIsolationHelperUtilityChannelSource = read(
    'main/services/portable_isolation_helper_utility_channel.js'
  );
  const portableIsolationHelperHostLauncherSource = read(
    'main/services/portable_isolation_helper_host_launcher.js'
  );
  const portableIsolationHelperUtilityEntrySource = read(
    'main/portable_isolation_helper/utility_entry.js'
  );
  const portableIsolationHelperDistributionAttestationSource = read(
    'main/portable_isolation_helper/distribution_attestation.json'
  );
  const portableIsolationHelperReleaseAttestationBuilderSource = read(
    'build/portable_isolation_helper_release_attestation_builder.js'
  );
  const portableIsolationHelperAfterPackSource = read(
    'build/portable_isolation_helper_after_pack.js'
  );
  const portableIsolationHelperBundleBuilderSource = read(
    'build/portable_isolation_helper_bundle_builder.js'
  );
  const portableIsolationHelperReleaseTrustSource = read(
    'main/security/portable_isolation_helper_release_trust.js'
  );
  const packageConfig = JSON.parse(read('package.json'));
  const processSupervisorSource = read('main/agent_runtime/execution/process_supervisor.js');
  const projectScannerSource = read('main/services/project_scanner.js');
  const transactionalDeleteSource = read(
    'main/services/transactional_filesystem_delete_service.js'
  );
  const agenticDeleteRuntimeSource = read('main/services/agentic_delete_runtime_service.js');
  const sandboxContractSource = read('main/capabilities/sandbox_backend_contract.js');
  const verifiedExecutionSource = read('main/services/project_verified_execution_service.js');

  for (const [relativePath, source] of [
    ['main/capabilities/execution_workspace_contract.js', contractSource],
    ['main/capabilities/execution_workspace_registry.js', registrySource],
    ['main/capabilities/project_root_authority_contract.js', rootAuthorityContractSource],
    ['main/capabilities/project_root_authority_registry.js', rootAuthorityRegistrySource],
    ['main/capabilities/process_supervisor_contract.js', processSupervisorContractSource],
    [
      'main/capabilities/portable_isolation_helper_protocol.js',
      portableIsolationHelperProtocolSource,
    ],
    [
      'main/capabilities/portable_isolation_helper_backend_contract.js',
      portableIsolationHelperBackendContractSource,
    ],
    [
      'main/capabilities/portable_isolation_helper_launcher_contract.js',
      portableIsolationHelperLauncherContractSource,
    ],
    [
      'main/capabilities/portable_isolation_helper_private_transport_contract.js',
      portableIsolationHelperPrivateTransportContractSource,
    ],
    [
      'main/capabilities/portable_isolation_helper_distribution_attestation_contract.js',
      portableIsolationHelperDistributionAttestationContractSource,
    ],
    [
      'main/services/portable_isolation_helper_distribution_verifier.js',
      portableIsolationHelperDistributionVerifierSource,
    ],
    [
      'main/services/portable_isolation_helper_client.js',
      portableIsolationHelperClientSource,
    ],
    [
      'main/services/portable_isolation_helper_provider_adapter.js',
      portableIsolationHelperProviderAdapterSource,
    ],
    [
      'main/services/portable_isolation_helper_runtime_session.js',
      portableIsolationHelperRuntimeSessionSource,
    ],
    [
      'main/services/portable_isolation_helper_backend_dispatcher.js',
      portableIsolationHelperBackendDispatcherSource,
    ],
    [
      'main/services/portable_isolation_helper_private_transport.js',
      portableIsolationHelperPrivateTransportSource,
    ],
    [
      'main/services/portable_isolation_helper_utility_channel.js',
      portableIsolationHelperUtilityChannelSource,
    ],
  ]) {
    assertDoesNotMatch(
      source,
      /require\(['"](?:electron|child_process|fs)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(/,
      `${relativePath} must remain a data/ownership boundary without filesystem, process, or IPC authority`
    );
    assertDoesNotMatch(
      source,
      /\bproviderFactory\b/,
      `${relativePath} must not activate a workspace provider`
    );
  }

  assertDoesNotMatch(
    `${isolationRuntimeConfigSource}\n${isolationProviderFactorySource}`,
    /require\(['"](?:electron|child_process|fs)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|\.node\b/,
    'portable isolation selection must remain a data-only seam without process, filesystem, IPC, or addon loading authority'
  );
  assertDoesNotMatch(
    `${isolationRuntimeConfigSource}\n${isolationProviderFactorySource}`,
    /FABER_EXECUTION_ISOLATION_(?:PROVIDER|ADDON)_PATH/,
    'portable isolation selection must not accept a provider path from the environment'
  );
  assert.ok(
    isolationRuntimeConfigSource.includes("'FABER_EXECUTION_ISOLATION_MODE'")
      && isolationRuntimeConfigSource.includes("'FABER_EXECUTION_ISOLATION_KILL_SWITCH'")
      && isolationRuntimeConfigSource.includes("mode: 'disabled'")
      && isolationRuntimeConfigSource.includes('killSwitch: true'),
    'portable isolation runtime config must default to disabled behind an active kill switch'
  );
  assert.ok(
    isolationProviderFactorySource.includes(
      "'portable-execution-isolation-provider.v2'"
    )
      && isolationProviderFactorySource.includes(
        "'portable-execution-isolation-attestation.v2'"
      )
      && isolationProviderFactorySource.includes('executionWorkspaceBackend')
      && isolationProviderFactorySource.includes('projectRootAuthorityBackend')
      && isolationProviderFactorySource.includes('processSupervisorBackend')
      && isolationProviderFactorySource.includes('assertExecutionWorkspaceBackend')
      && isolationProviderFactorySource.includes('assertProjectRootAuthorityBackend')
      && isolationProviderFactorySource.includes('assertProcessSupervisorBackend'),
    'one sealed portable provider must supply workspace, pinned-root, and process backends'
  );
  for (const attestedGuarantee of [
    'sharedPhysicalRootAuthority',
    'sourceIdentityCompareAndSwap',
    'handleRelativeProjectAccess',
    'privateWorkspaceMaterialization',
    'rollbackByDiscard',
    'workspaceBoundProcessExecution',
    'networkDefaultDeny',
    'processTreeTermination',
    'zeroOrphanProcessDisposal',
  ]) {
    assert.ok(
      isolationProviderFactorySource.includes(attestedGuarantee),
      `portable provider attestation must bind ${attestedGuarantee}`
    );
  }
  assert.ok(
    isolationProviderFactorySource.includes('canonicalSha256Digest(core)')
      && isolationProviderFactorySource.includes(
        "unsupportedSelection('BACKENDS_NOT_ENFORCED'"
      )
      && isolationProviderFactorySource.includes('absorbNativePromise(rawProbe)'),
    'portable provider activation must verify a canonical attestation and three synchronous enforced probes'
  );
  assertDoesNotMatch(
    isolationProviderFactorySource,
    /project-root authority acquire must remain synchronous|absorbNativePromise\(result\)/,
    'portable root acquisition must preserve the provider native Promise for the async registry'
  );
  assertDoesNotMatch(
    isolationProviderFactorySource,
    /captureOwnMethod\((?:workspaceBackend|rootBackend),\s*['"]dispose['"]\)/,
    'backend facades must release the one shared provider instead of independently closing physical authority'
  );
  assert.ok(
    isolationProviderFactorySource.includes("captureOwnMethod(processBackend, 'dispose')")
      && isolationProviderFactorySource.includes('assertProcessSupervisorDisposeReceipt(value)')
      && isolationProviderFactorySource.includes('processDisposePending')
      && isolationProviderFactorySource.includes('processDisposeReentered')
      && isolationProviderFactorySource.includes('maybeDisposeProvider()'),
    'process disposal must be captured, zero-orphan validated, reentrancy-safe, and complete before provider release'
  );
  assertDoesNotMatch(
    mainSource,
    /execution_isolation_(?:runtime_config|provider_factory)|createExecutionIsolationProviderSelection/,
    'production must not activate portable isolation until a bundled attested provider exists'
  );
  assertDoesNotMatch(
    portableIsolationHelperProtocolSource,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(/,
    'the portable helper protocol must remain data-only without launch, filesystem, network, IPC, or dynamic-loading authority'
  );
  for (const requirement of [
    'bundledDistributionOnly',
    'platformSignatureRequired',
    'privateFramedTransport',
    'singleSessionPerHelper',
    'dataOnlyMessages',
    'digestBound',
    'sequenceBound',
    'responseCorrelation',
    'workspaceRootBound',
    'physicalRootAuthority',
    'networkDefaultDeny',
    'processTreeTermination',
    'boundedCursorOutput',
    'zeroOrphanShutdown',
    'noProviderPathInjection',
  ]) {
    assert.ok(
      portableIsolationHelperProtocolSource.includes(requirement),
      `portable helper handshake must bind ${requirement}`
    );
  }
  for (const operation of [
    'workspace.acquire',
    'workspace.discard',
    'root.acquire',
    'root.list',
    'root.read_file',
    'root.inspect_entry',
    'root.close',
    'process.exec',
    'process.read',
    'process.wait',
    'process.stop',
    'provider.dispose',
  ]) {
    assert.ok(
      portableIsolationHelperProtocolSource.includes(operation),
      `portable helper protocol must enumerate ${operation}`
    );
  }
  assert.ok(
    portableIsolationHelperProtocolSource.includes('expectedBundleIdentityDigest')
      && portableIsolationHelperProtocolSource.includes("'platform_verified'")
      && portableIsolationHelperProtocolSource.includes('sessionBindingDigest')
      && portableIsolationHelperProtocolSource.includes('previousResponseDigest')
      && portableIsolationHelperProtocolSource.includes('PROTOCOL_SESSION_BUSY')
      && portableIsolationHelperProtocolSource.includes('PROTOCOL_REQUEST_REPLAY')
      && portableIsolationHelperProtocolSource.includes('activeWorkspaces')
      && portableIsolationHelperProtocolSource.includes('activeRootLeases')
      && portableIsolationHelperProtocolSource.includes('activeProcesses')
      && portableIsolationHelperProtocolSource.includes('orphaned')
      && portableIsolationHelperProtocolSource.includes("'portable-isolation-helper-failure.v1'")
      && portableIsolationHelperProtocolSource.includes('assertPortableIsolationHelperFailureReceipt(response.payload)'),
    'helper sessions must be bundle-bound, digest-chained, exclusive, sanitize failures, and prove zero live authority at shutdown'
  );
  assert.ok(
    portableIsolationHelperBackendContractSource.includes(
      "'portable-isolation-backend-contract.v1'"
    )
      && portableIsolationHelperBackendContractSource.includes(
        "'portable-isolation-backend-request.v1'"
      )
      && portableIsolationHelperBackendContractSource.includes(
        "'portable-isolation-backend-response.v1'"
      )
      && portableIsolationHelperProviderAdapterSource.includes(
        "require('../capabilities/portable_isolation_helper_backend_contract')"
      ),
    'the main adapter and helper runtime must share one immutable backend-envelope contract'
  );
  assert.ok(
    portableIsolationHelperRuntimeSessionSource.includes(
      "'portable-isolation-helper-runtime-session.v1'"
    )
      && portableIsolationHelperRuntimeSessionSource.includes('crypto.randomBytes')
      && portableIsolationHelperRuntimeSessionSource.includes(
        'previousResponseDigest'
      )
      && portableIsolationHelperRuntimeSessionSource.includes(
        "fail('RUNTIME_REQUEST_REPLAY')"
      )
      && portableIsolationHelperRuntimeSessionSource.includes(
        "reasonCode: 'HELPER_OPERATION_FAILED'"
      )
      && portableIsolationHelperRuntimeSessionSource.includes(
        'assertPortableIsolationHelperShutdownReceipt'
      ),
    'the server-side helper session must bind fresh identity, request order, response digests, sanitized failures, backend routing, and zero-authority shutdown'
  );
  assert.ok(
    portableIsolationHelperBackendDispatcherSource.includes(
      "'portable-isolation-helper-backend-dispatcher.v1'"
    )
      && portableIsolationHelperBackendDispatcherSource.includes(
        'EXECUTION_WORKSPACE_REQUIRED_GUARANTEES'
      )
      && portableIsolationHelperBackendDispatcherSource.includes(
        'PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES'
      )
      && portableIsolationHelperBackendDispatcherSource.includes(
        'PROCESS_SUPERVISOR_REQUIRED_GUARANTEES'
      )
      && portableIsolationHelperBackendDispatcherSource.includes(
        'workspaceForProcess(request)'
      )
      && portableIsolationHelperBackendDispatcherSource.includes(
        'ownsActiveProcess'
      )
      && portableIsolationHelperBackendDispatcherSource.includes(
        'isPortableIsolationHelperRuntimeOperationError'
      )
      && portableIsolationHelperBackendDispatcherSource.includes(
        'assertProcessSupervisorDisposeReceipt'
      )
      && portableIsolationHelperBackendDispatcherSource.includes(
        'createPortableIsolationHelperShutdownReceipt'
      ),
    'the helper dispatcher must activate three enforced backends, bind processes to issued workspaces, block live-workspace discard, sanitize provider failures, and prove zero live authority'
  );
  assertDoesNotMatch(
    `${portableIsolationHelperLauncherContractSource}\n${portableIsolationHelperPrivateTransportContractSource}\n${portableIsolationHelperDistributionAttestationContractSource}\n${portableIsolationHelperDistributionVerifierSource}\n${portableIsolationHelperBackendContractSource}\n${portableIsolationHelperRuntimeSessionSource}\n${portableIsolationHelperPrivateTransportSource}`,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(|\b(?:binary|executable|helper|provider)Path\b/,
    'portable helper launch, distribution, backend envelope, runtime session, and framing foundations must not own host launch, filesystem, network, IPC, dynamic-loading, environment, or injected-path authority'
  );
  assertDoesNotMatch(
    portableIsolationHelperBackendDispatcherSource,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(|\b(?:binary|executable|helper|provider)Path\b/,
    'the helper dispatcher must receive authority only through its three captured backends'
  );
  assert.ok(
    portableExecutionWorkspaceBackendSource.includes(
      "'portable-execution-workspace-backend.v1'"
    )
      && portableExecutionWorkspaceBackendSource.includes(
        'createProjectRootPhysicalIdentityDigest'
      )
      && portableExecutionWorkspaceBackendSource.includes(
        'EXECUTION_WORKSPACE_REQUIRED_GUARANTEES'
      )
      && portableExecutionWorkspaceBackendSource.includes(
        'ownersBySourceIdentity'
      )
      && portableExecutionWorkspaceBackendSource.includes(
        'fs.opendirSync'
      )
      && portableExecutionWorkspaceBackendSource.includes(
        'fs.constants.O_EXCL'
      )
      && portableExecutionWorkspaceBackendSource.includes(
        'WORKSPACE_SOURCE_LINK_ESCAPE'
      )
      && portableExecutionWorkspaceBackendSource.includes(
        'WORKSPACE_PHYSICAL_IDENTITY_CHANGED'
      )
      && portableExecutionWorkspaceBackendSource.includes(
        'removeDirectoryTree'
      ),
    'the physical workspace backend must pin source identity, copy into one private root, reject link escape, enforce exclusive ownership, and discard only the issued inode'
  );
  assertDoesNotMatch(
    portableExecutionWorkspaceBackendSource,
    /require\(['"](?:electron|child_process|net|tls|http|https|worker_threads|module)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(|fs\.rmSync/,
    'the physical workspace backend may own local filesystem authority but no process, network, IPC, environment, or dynamic-loading authority'
  );
  assert.ok(
    portableProjectRootAuthorityBackendSource.includes(
      "'portable-project-root-authority-backend.v1'"
    )
      && portableProjectRootAuthorityBackendSource.includes(
        'createProjectRootPhysicalIdentityDigest'
      )
      && portableProjectRootAuthorityBackendSource.includes(
        'PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES'
      )
      && portableProjectRootAuthorityBackendSource.includes(
        'ownersBySourceIdentity'
      )
      && portableProjectRootAuthorityBackendSource.includes('fs.opendirSync')
      && portableProjectRootAuthorityBackendSource.includes(
        'fs.constants.O_EXCL'
      )
      && portableProjectRootAuthorityBackendSource.includes('fs.readSync')
      && portableProjectRootAuthorityBackendSource.includes(
        'PROJECT_ROOT_SOURCE_IDENTITY_MISMATCH'
      )
      && portableProjectRootAuthorityBackendSource.includes(
        'PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED'
      )
      && portableProjectRootAuthorityBackendSource.includes(
        'acceptIncompleteArchive'
      ),
    'the physical project-root backend must pin one source, seal a private descriptor-backed snapshot, keep links inert, and authenticate both normal and partial cleanup'
  );
  const portableProjectRootReaderStart =
    portableProjectRootAuthorityBackendSource.indexOf('function createReader');
  const portableProjectRootReaderEnd =
    portableProjectRootAuthorityBackendSource.indexOf(
      'function createLease',
      portableProjectRootReaderStart
    );
  assert.ok(
    portableProjectRootReaderStart >= 0
      && portableProjectRootReaderEnd > portableProjectRootReaderStart,
    'the physical project-root reader boundary must remain inspectable'
  );
  assertDoesNotMatch(
    portableProjectRootAuthorityBackendSource.slice(
      portableProjectRootReaderStart,
      portableProjectRootReaderEnd
    ),
    /lstatSync|openSync|opendirSync|readlinkSync|realpathSync|statSync/,
    'the sealed project-root reader must never reopen the source snapshot by pathname'
  );
  assertDoesNotMatch(
    portableProjectRootAuthorityBackendSource,
    /require\(['"](?:electron|child_process|net|tls|http|https|worker_threads|module)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(|fs\.rmSync/,
    'the physical project-root backend may own local filesystem authority but no process, network, IPC, environment, or dynamic-loading authority'
  );
  assert.ok(
    portableProcessSupervisorBackendSource.includes(
      "'portable-process-supervisor-backend.v1'"
    )
      && portableProcessSupervisorBackendSource.includes("'/usr/bin/sandbox-exec'")
      && portableProcessSupervisorBackendSource.includes("'(deny default)'")
      && portableProcessSupervisorBackendSource.includes(
        'SANDBOX_NETWORK_MODES.DISABLED'
      )
      && portableProcessSupervisorBackendSource.includes(
        'createProjectRootPhysicalIdentityDigest'
      )
      && portableProcessSupervisorBackendSource.includes("'-DWORKSPACE_ENTRY='")
      && portableProcessSupervisorBackendSource.includes("'-DWORKSPACE_ROOT='")
      && portableProcessSupervisorBackendSource.includes('detached: true')
      && portableProcessSupervisorBackendSource.includes(
        'process.kill(-record.processGroupId'
      )
      && portableProcessSupervisorBackendSource.includes(
        'MAX_RETAINED_OUTPUT_BYTES'
      )
      && portableProcessSupervisorBackendSource.includes('StringDecoder')
      && portableProcessSupervisorBackendSource.includes('removeOwnedTree')
      && portableProcessSupervisorBackendSource.includes('terminateProcessTree'),
    'the physical process backend must pin logical and physical workspaces, apply default-deny Seatbelt, retain bounded UTF-8 output, and reap the detached process group'
  );
  assertDoesNotMatch(
    portableProcessSupervisorBackendSource,
    /\(allow network-|require\(['"](?:electron|net|tls|http|https|worker_threads|module)['"]\)|\bipcRenderer\b|\bipcMain\b|childProcess\.(?:exec|execFile)\s*\(|shell:\s*true|\bprocess\.env\b|\bimport\s*\(|process\.dlopen|\.node\b|sandboxExecutablePath/,
    'the physical process backend may own fixed local process/filesystem authority but no network, IPC, inherited-environment, dynamic-loading, native-addon, shell expansion, or injected sandbox-path authority'
  );
  assertDoesNotMatch(
    mainSource,
    /portable_isolation_helper_(?:execution_workspace|project_root_authority|process_supervisor)_backend|createPortable(?:ExecutionWorkspace|ProjectRootAuthority|ProcessSupervisor)Backend/,
    'the production main process must not directly compose any physical helper backend'
  );
  assertDoesNotMatch(
    portableIsolationHelperUtilityEntrySource,
    /portable_isolation_helper_(?:execution_workspace|project_root_authority|process_supervisor)_backend|createPortable(?:ExecutionWorkspace|ProjectRootAuthority|ProcessSupervisor)Backend/,
    'the signed utility entry must delegate physical composition to exactly one composition root'
  );
  assert.ok(
    portableIsolationHelperUtilityEntrySource.includes(
      'createPortableIsolationHelperPhysicalRuntime'
    )
      && portableIsolationHelperPhysicalRuntimeSource.includes(
        'createPortableExecutionWorkspaceBackend'
      )
      && portableIsolationHelperPhysicalRuntimeSource.includes(
        'createPortableProjectRootAuthorityBackend'
      )
      && portableIsolationHelperPhysicalRuntimeSource.includes(
        'createPortableProcessSupervisorBackend'
      )
      && portableIsolationHelperPhysicalRuntimeSource.includes(
        'createPortableIsolationHelperBackendDispatcher'
      ),
    'the signed helper composition root must activate all three fixed physical backends behind one runtime boundary'
  );
  const helperExtraResource = packageConfig.build.extraResources.find(
    (entry) => entry && entry.to === 'portable-isolation-helper'
  );
  assert.ok(helperExtraResource, 'the fixed portable helper resource must remain declared');
  assert.deepStrictEqual(helperExtraResource.filter, [
    'utility_entry.js',
    'distribution_attestation.json',
  ], 'only the generated self-contained helper and its attestation may enter the fixed signed distribution');
  assert.ok(
    portableIsolationHelperDistributionAttestationContractSource.includes(
      "'portable-isolation-helper-distribution-manifest.v1'"
    )
      && portableIsolationHelperDistributionAttestationContractSource.includes(
        "'portable-isolation-helper-distribution-attestation.v1'"
      )
      && portableIsolationHelperDistributionAttestationContractSource.includes(
        "'ed25519'"
      )
      && portableIsolationHelperDistributionAttestationContractSource.includes(
        'portableIsolationHelperDistributionSigningPayload'
      )
      && portableIsolationHelperDistributionVerifierSource.includes('crypto.verify')
      && portableIsolationHelperDistributionVerifierSource.includes(
        "asymmetricKeyType !== 'ed25519'"
      )
      && portableIsolationHelperDistributionVerifierSource.includes(
        'canonicalSha256Digest'
      )
      && portableIsolationHelperDistributionVerifierSource.includes(
        'DISTRIBUTION_TRUST_REJECTED'
      )
      && portableIsolationHelperDistributionVerifierSource.includes(
        'DISTRIBUTION_ATTESTATION_MISMATCH'
      ),
    'distribution trust must be canonical, Ed25519-only, platform-and-architecture-bound, digest-bound, and fail closed'
  );
  assertDoesNotMatch(
    portableIsolationHelperReleaseAttestationBuilderSource,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bprocess\.env\b|\b__dirname\b|\bspawn\s*\(|\bexecFile\s*\(|\bimport\s*\(|\bconsole\./,
    'the release attestation builder must be a pure cryptographic boundary without filesystem, process, environment, network, dynamic-loading, or logging authority'
  );
  assert.ok(
    portableIsolationHelperReleaseAttestationBuilderSource.includes(
      "require('crypto')"
    )
      && portableIsolationHelperReleaseAttestationBuilderSource.includes(
        "asymmetricKeyType !== 'ed25519'"
      )
      && portableIsolationHelperReleaseAttestationBuilderSource.includes(
        'portableIsolationHelperDistributionSigningPayload'
      )
      && portableIsolationHelperReleaseAttestationBuilderSource.includes(
        'crypto.sign'
      )
      && portableIsolationHelperReleaseAttestationBuilderSource.includes(
        'privateKeyBytes.fill(0)'
      ),
    'release attestation signing must be Ed25519-only, canonical, public-root-bound, and zeroize decoded secret bytes'
  );
  assertDoesNotMatch(
    portableIsolationHelperReleaseTrustSource,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(|PRIVATE KEY|privateKey|FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY/,
    'the production release trust root must contain public verification material only and must not read mutable runtime inputs'
  );
  assert.ok(
    portableIsolationHelperReleaseTrustSource.includes(
      "'portable-isolation-helper-release-trust.v1'"
    )
      && portableIsolationHelperReleaseTrustSource.includes(
        "PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_STATE = 'unconfigured'"
      )
      && portableIsolationHelperReleaseTrustSource.includes('Object.freeze([])')
      && portableIsolationHelperReleaseTrustSource.includes(
        "'RELEASE_TRUST_UNCONFIGURED'"
      )
      && portableIsolationHelperReleaseTrustSource.includes(
        'createPortableIsolationHelperPlatformSignatureVerifier'
      ),
    'production release trust must remain explicitly unconfigured and fail closed until a public release root is provisioned'
  );
  assertDoesNotMatch(
    portableIsolationHelperBundleBuilderSource,
    /process\.cwd|process\.env|\bglob\b|readdirSync|opendirSync|\beval\s*\(|new Function|\bimport\s*\(/,
    'the build-only bundle composer must use a fixed source allowlist without ambient discovery or dynamic evaluation'
  );
  assert.ok(
    portableIsolationHelperBundleBuilderSource.includes(
      'PORTABLE_ISOLATION_HELPER_BUNDLE_MODULE_IDS'
    )
      && portableIsolationHelperBundleBuilderSource.includes('fs.constants.O_NOFOLLOW')
      && portableIsolationHelperBundleBuilderSource.includes('new vm.Script')
      && portableIsolationHelperBundleBuilderSource.includes('sourceIdentityDigest'),
    'the helper bundle must be deterministic, link-race-resistant, syntax-checked, and source-identity-bound'
  );
  assertDoesNotMatch(
    portableIsolationHelperAfterPackSource,
    /require\(['"](?:electron|child_process|net|tls|http|https|worker_threads|module)['"]\)|\bspawn\s*\(|\bexecFile\s*\(|\bimport\s*\(|\bconsole\./,
    'the release hook may own only local build-time filesystem and cryptographic authority'
  );
  const releaseEnvironmentReferences = [
    ...portableIsolationHelperAfterPackSource.matchAll(
      /process\.env\[([A-Z0-9_]+)\]/g
    ),
  ].map((match) => match[1]).sort();
  assert.deepStrictEqual(releaseEnvironmentReferences, [
    'FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID_ENV',
    'FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_ENV',
  ]);
  assert.ok(
    portableIsolationHelperAfterPackSource.includes('packager.getResourcesDir')
      && portableIsolationHelperAfterPackSource.includes('packager.projectDir')
      && portableIsolationHelperAfterPackSource.includes('fs.constants.O_NOFOLLOW')
      && portableIsolationHelperAfterPackSource.includes('fs.constants.O_EXCL')
      && portableIsolationHelperAfterPackSource.includes('fs.fsyncSync')
      && portableIsolationHelperAfterPackSource.includes('fs.renameSync')
      && portableIsolationHelperAfterPackSource.includes(
        'createPortableIsolationHelperReleaseSignatureVerifier'
      )
      && portableIsolationHelperAfterPackSource.includes(
        'createPortableIsolationHelperBundleBuilder'
      ),
    'the afterPack hook must build the fixed helper, resist link races, sign the final bytes, install both resources atomically, and guard its default entry through production trust'
  );
  assert.strictEqual(
    packageConfig.build.afterPack,
    'build/portable_isolation_helper_after_pack.js'
  );
  assert.strictEqual(
    packageConfig.build.files.some((entry) => (
      entry.includes('portable_isolation_helper_after_pack')
      || entry.includes('portable_isolation_helper_release_attestation_builder')
      || entry.includes('portable_isolation_helper_bundle_builder')
    )),
    false,
    'release signing code must remain build-only and outside the packaged application'
  );
  assert.ok(
    packageConfig.scripts['test:execution-workspace'].includes(
      'npm run test:portable-isolation-helper-runtime'
    )
      && packageConfig.scripts['test:portable-isolation-helper-runtime'].includes(
        'portable-execution-workspace-backend.test.js'
      )
      && packageConfig.scripts['test:portable-isolation-helper-runtime'].includes(
        'portable-project-root-authority-backend.test.js'
      )
      && packageConfig.scripts['test:portable-isolation-helper-runtime'].includes(
        'portable-process-supervisor-backend.test.js'
      )
      && packageConfig.scripts['test:portable-isolation-helper-runtime'].includes(
        'portable-isolation-helper-backend-dispatcher.test.js'
      )
      && packageConfig.scripts['test:portable-isolation-helper-runtime'].includes(
        'portable-isolation-helper-runtime-composition.test.js'
      )
      && packageConfig.scripts['test:portable-isolation-helper-runtime'].includes(
        'portable-isolation-helper-utility-entry-runtime.test.js'
      )
      && packageConfig.scripts['test:portable-isolation-helper-release'].includes(
        'portable-isolation-helper-bundle-builder.test.js'
      )
      && packageConfig.scripts['test:execution-workspace'].includes(
        'npm run test:portable-isolation-helper-release'
      ),
    'the aggregate execution-workspace gate must run all three physical backends, composed utility runtime, deterministic bundling, release signing, and packaging tests'
  );
  assert.ok(
    portableIsolationHelperLauncherContractSource.includes(
      "'portable-isolation-helper-bundle-descriptor.v1'"
    )
      && portableIsolationHelperLauncherContractSource.includes(
        "'application_bundle'"
      )
      && portableIsolationHelperLauncherContractSource.includes(
        "'private_framed'"
      )
      && portableIsolationHelperLauncherContractSource.includes(
        "'platform_verified'"
      )
      && portableIsolationHelperLauncherContractSource.includes(
        'signatureIdentityDigest'
      )
      && portableIsolationHelperLauncherContractSource.includes(
        'PORTABLE_ISOLATION_HELPER_REQUIREMENTS'
      )
      && portableIsolationHelperLauncherContractSource.includes(
        'descriptorDigest: canonicalSha256Digest(core)'
      )
      && portableIsolationHelperLauncherContractSource.includes(
        'requestDigest: canonicalSha256Digest(core)'
      )
      && portableIsolationHelperLauncherContractSource.includes(
        'receiptDigest: canonicalSha256Digest(core)'
      )
      && portableIsolationHelperLauncherContractSource.includes(
        "fail('LAUNCH_RECEIPT_MISMATCH')"
      ),
    'portable helper launch authority must be bundle-only, platform-signature-bound, private-transport-bound, requirement-bound, and digest-correlated without exposing a helper path'
  );
  assert.ok(
    portableIsolationHelperPrivateTransportContractSource.includes(
      "'portable-isolation-helper-private-frame.v1'"
    )
      && portableIsolationHelperPrivateTransportContractSource.includes(
        'PORTABLE_ISOLATION_HELPER_LIMITS.maxMessageBytes'
      )
      && portableIsolationHelperPrivateTransportContractSource.includes(
        'payloadBytes'
      )
      && portableIsolationHelperPrivateTransportContractSource.includes(
        'payloadDigest'
      )
      && portableIsolationHelperPrivateTransportContractSource.includes(
        'requestPayloadDigest'
      )
      && portableIsolationHelperPrivateTransportContractSource.includes(
        "new util.TextDecoder('utf-8', { fatal: true })"
      )
      && portableIsolationHelperPrivateTransportContractSource.includes(
        "JSON.stringify(payload) !== json"
      ),
    'private helper frames must be byte-bounded, digest-bound, request-correlated, strict UTF-8, and canonically encoded'
  );
  assert.ok(
    portableIsolationHelperPrivateTransportSource.includes(
      'assertPortableIsolationHelperLaunchReceipt'
    )
      && portableIsolationHelperPrivateTransportSource.includes(
        'Object.isFrozen(value)'
      )
      && portableIsolationHelperPrivateTransportSource.includes(
        'exchangePending'
      )
      && portableIsolationHelperPrivateTransportSource.includes(
        'expectedBundleIdentityDigest'
      )
      && portableIsolationHelperPrivateTransportSource.includes(
        'request.payload.expectedBundleIdentityDigest'
      )
      && portableIsolationHelperPrivateTransportSource.includes(
        'processTreeTerminated'
      )
      && portableIsolationHelperPrivateTransportSource.includes('helperExited')
      && portableIsolationHelperPrivateTransportSource.includes(
        "fields.get('orphaned') !== 0"
      )
      && portableIsolationHelperPrivateTransportSource.includes(
        "'PRIVATE_TRANSPORT_REENTRANT'"
      ),
    'private helper transport must accept only an attested frozen channel, serialize one exchange, bind the handshake bundle, reject reentrancy, and require zero-orphan termination proof'
  );
  assertDoesNotMatch(
    portableIsolationHelperUtilityChannelSource,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bipcRenderer\b|\bipcMain\b|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(/,
    'the utility channel must own only an injected UtilityProcess endpoint and data-only framed messages'
  );
  assert.ok(
    portableIsolationHelperUtilityChannelSource.includes(
      "'portable-isolation-helper-utility-wire.v1'"
    )
      && portableIsolationHelperUtilityChannelSource.includes(
        'normalizeUtilityProcess'
      )
      && portableIsolationHelperUtilityChannelSource.includes(
        'normalizeRuntimeBinding'
      )
      && portableIsolationHelperUtilityChannelSource.includes(
        'channelBindingDigest'
      )
      && portableIsolationHelperUtilityChannelSource.includes(
        'processTreeTerminated'
      )
      && portableIsolationHelperUtilityChannelSource.includes('helperExited')
      && portableIsolationHelperUtilityChannelSource.includes('attachedListeners')
      && portableIsolationHelperUtilityChannelSource.includes(
        "['active', 'aborted', 'aborting']"
      )
      && ['binaryPath', 'executablePath', 'helperPath', 'providerPath'].every(
        (forbiddenKey) => portableIsolationHelperUtilityChannelSource.includes(
          `'${forbiddenKey}'`
        )
      ),
    'the utility channel must bind one private endpoint, clean listeners, support abort-plus-close, and prove clean process exit'
  );
  assertDoesNotMatch(
    portableIsolationHelperHostLauncherSource,
    /require\(['"](?:electron|child_process|net|tls|http|https|worker_threads|module)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(/,
    'the host launcher must receive only the fixed Electron utility-process fork primitive and must not gain shell, network, IPC, environment, or dynamic-loading authority'
  );
  assertDoesNotMatch(
    portableIsolationHelperHostLauncherSource,
    /['"](?:binaryPath|executablePath|helperPath|providerPath)['"]/,
    'the host launcher must not accept a caller-selected helper executable path'
  );
  assert.ok(
    portableIsolationHelperHostLauncherSource.includes("require('crypto')")
      && portableIsolationHelperHostLauncherSource.includes("require('fs')")
      && portableIsolationHelperHostLauncherSource.includes("require('path')")
      && portableIsolationHelperHostLauncherSource.includes(
        "const RESOURCE_DIRECTORY_NAME = 'portable-isolation-helper'"
      )
      && portableIsolationHelperHostLauncherSource.includes(
        "const RESOURCE_ENTRY_NAME = 'utility_entry.js'"
      )
      && portableIsolationHelperHostLauncherSource.includes(
        "const RESOURCE_ATTESTATION_NAME = 'distribution_attestation.json'"
      )
      && portableIsolationHelperHostLauncherSource.includes(
        'HOST_PACKAGED_APP_REQUIRED'
      )
      && portableIsolationHelperHostLauncherSource.includes(
        'PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION'
      )
      && portableIsolationHelperHostLauncherSource.includes('fs.constants.O_NOFOLLOW')
      && portableIsolationHelperHostLauncherSource.includes(
        "new util.TextDecoder('utf-8', { fatal: true })"
      )
      && portableIsolationHelperHostLauncherSource.includes(
        'assertPortableIsolationHelperDistributionAttestation'
      )
      && portableIsolationHelperHostLauncherSource.includes('attestationDigest')
      && portableIsolationHelperHostLauncherSource.includes('manifestDigest')
      && portableIsolationHelperHostLauncherSource.includes(
        'sameResource(before, after)'
      )
      && portableIsolationHelperHostLauncherSource.includes(
        'openPortableIsolationHelperUtilityChannel'
      )
      && portableIsolationHelperHostLauncherSource.includes('runtimeBinding')
      && portableIsolationHelperHostLauncherSource.includes('disposeRequested'),
    'the sole host authority must resolve the fixed helper plus its canonical attestation, verify both physical identities and the release signature, bind that identity into one utility channel, and close in-flight launches'
  );
  assertDoesNotMatch(
    portableIsolationHelperUtilityEntrySource,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bprocess\.env\b|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|\bimport\s*\(/,
    'the packaged helper entry must load only its fixed bundled modules and never gain ambient host, shell, network, IPC, environment, or dynamic-loading authority'
  );
  assert.ok(
    portableIsolationHelperUtilityEntrySource.includes('process.parentPort')
      && portableIsolationHelperUtilityEntrySource.includes(
        'createPortableIsolationHelperPhysicalRuntime'
      )
      && portableIsolationHelperUtilityEntrySource.includes(
        'assertPortableIsolationHelperPrivateFrame'
      )
      && portableIsolationHelperUtilityEntrySource.includes('assertZeroAuthority')
      && portableIsolationHelperUtilityEntrySource.includes('processTreeTerminated')
      && portableIsolationHelperUtilityEntrySource.includes('dispose_ready')
      && !portableIsolationHelperUtilityEntrySource.includes(
        'HELPER_RUNTIME_UNAVAILABLE'
      ),
    'the helper entry must bind its attested runtime, frame every exchange, and prove zero authority before abort or exit'
  );
  assert.ok(
    packageConfig.build.files.includes('!main/portable_isolation_helper/**/*')
      && JSON.stringify(packageConfig.build.extraResources) === JSON.stringify([{
        from: 'main/portable_isolation_helper',
        to: 'portable-isolation-helper',
        filter: ['utility_entry.js', 'distribution_attestation.json'],
      }])
      && portableIsolationHelperDistributionAttestationSource
        === '{"status":"unconfigured_release_attestation"}\n',
    'the helper and fail-closed release-attestation placeholder must ship together at one fixed extraResource location outside the application ASAR'
  );
  assertDoesNotMatch(
    portableIsolationHelperClientSource,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(|\b(?:binary|executable|helper)Path\b/,
    'the portable helper client must conduct an injected transport without launch, filesystem, network, IPC, dynamic-loading, or binary-path authority'
  );
  assert.ok(
    portableIsolationHelperClientSource.includes("'portable-isolation-helper-transport.v1'")
      && portableIsolationHelperClientSource.includes('Object.isFrozen(value)')
      && portableIsolationHelperClientSource.includes("Reflect.apply(transport[methodName]")
      && portableIsolationHelperClientSource.includes(
        'assertPortableIsolationHelperHandshakeResponse'
      )
      && portableIsolationHelperClientSource.includes(
        'createPortableIsolationHelperSessionController'
      )
      && portableIsolationHelperClientSource.includes('controller.accept(outcome.value)')
      && portableIsolationHelperClientSource.includes("'DISPOSE_INTERRUPTED'")
      && portableIsolationHelperClientSource.includes("'closed_unconfirmed'")
      && portableIsolationHelperClientSource.includes('helperShutdownConfirmed')
      && portableIsolationHelperClientSource.includes('transportClosed'),
    'the portable helper client must capture an exact frozen transport, validate every response, interrupt pending work, and distinguish confirmed shutdown from mere transport closure'
  );
  assert.ok(
    portableIsolationHelperClientSource.includes(
      "operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE"
    )
      && portableIsolationHelperClientSource.includes(
        "operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE"
      ),
    'handshake and provider disposal must remain reserved to the client lifecycle'
  );
  assertDoesNotMatch(
    portableIsolationHelperProviderAdapterSource,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(|\b(?:binary|executable|helper)Path\b/,
    'the portable helper provider adapter must only translate data contracts and never gain launch, filesystem, network, IPC, dynamic-loading, or binary-path authority'
  );
  assert.ok(
    portableIsolationHelperProviderAdapterSource.includes(
      "'portable-isolation-helper-provider-candidate.v2'"
    )
      && portableIsolationHelperProviderAdapterSource.includes('activationReady: true')
      && portableIsolationHelperProviderAdapterSource.includes('activationBlockReason: null')
      && portableIsolationHelperProviderAdapterSource.includes('const provider = Object.freeze({')
      && portableIsolationHelperProviderAdapterSource.includes(
        'MAX_QUEUED_EXCHANGES = 1_024'
      )
      && portableIsolationHelperProviderAdapterSource.includes(
        'pendingWorkspaceOperations'
      )
      && portableIsolationHelperProviderAdapterSource.includes('pendingRootOperations')
      && portableIsolationHelperProviderAdapterSource.includes(
        'pendingProcessOperations'
      )
      && portableIsolationHelperProviderAdapterSource.includes(
        'Promise.allSettled(pendingOperations)'
      )
      && portableIsolationHelperProviderAdapterSource.includes(
        "reasonCode: 'PROVIDER_DISPOSE'"
      )
      && portableIsolationHelperProviderAdapterSource.includes('client.quarantine')
      && portableIsolationHelperProviderAdapterSource.includes(
        'canonicalSha256Digest(core)'
      )
      && portableIsolationHelperProviderAdapterSource.includes(
        'PORTABLE_ISOLATION_HELPER_REQUIREMENTS'
      )
      && portableIsolationHelperProviderAdapterSource.includes(
        'canonicalSha256Digest(capabilityCore)'
      ),
    'the provider candidate must expose one exact activatable facade, revalidate its handshake, serialize bounded work, preserve pending authority, quarantine invalid domains, reap processes, and bind one attestation'
  );
  for (const operationName of [
    'WORKSPACE_ACQUIRE', 'WORKSPACE_DISCARD',
    'ROOT_ACQUIRE', 'ROOT_LIST', 'ROOT_READ_FILE', 'ROOT_INSPECT_ENTRY', 'ROOT_CLOSE',
    'PROCESS_EXEC', 'PROCESS_READ', 'PROCESS_WAIT', 'PROCESS_STOP',
  ]) {
    assert.ok(
      portableIsolationHelperProviderAdapterSource.includes(
        `PORTABLE_ISOLATION_HELPER_OPERATIONS.${operationName}`
      ),
      `portable helper provider adapter must map ${operationName}`
    );
  }
  assertDoesNotMatch(
    `${mainSource}\n${isolationProviderFactorySource}`,
    /portable_isolation_helper_(?:protocol|backend_contract|backend_dispatcher|execution_workspace_backend|project_root_authority_backend|process_supervisor_backend|physical_runtime|runtime_session|launcher_contract|private_transport_contract|distribution_attestation_contract|client|private_transport|distribution_verifier|provider_adapter|utility_channel|host_launcher|release_trust)|(?:createPortable(?:ExecutionWorkspace|ProjectRootAuthority|ProcessSupervisor)Backend|createPortableIsolationHelper(?:SessionController|PhysicalRuntime|RuntimeSession|BackendDispatcher|Client|PrivateTransport|DistributionTrustedKey|PlatformSignatureVerifier|ProviderAdapter|HostLauncher|ReleaseSignatureVerifier)|openPortableIsolationHelperUtilityChannel)/,
    'the signed helper runtime now exists, but production main activation must remain suspended until a pinned public release trust root is provisioned'
  );

  assertDoesNotMatch(
    processSupervisorSource,
    /require\(['"](?:electron|child_process|fs)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|command_runner|project_terminal|project_preview/,
    'the portable process supervisor must own lifecycle only through its injected backend'
  );
  for (const guarantee of [
    'workspace_root_bound',
    'physical_cwd_revalidation',
    'network_default_deny',
    'process_tree_termination',
    'bounded_cursor_output',
    'orphan_reaping',
    'execution_identity_binding',
  ]) {
    assert.ok(
      processSupervisorContractSource.includes(guarantee),
      `the portable process supervisor contract must require ${guarantee}`
    );
  }
  assert.ok(
    processSupervisorContractSource.includes(
      'sandboxRequest.rootPath !== workspaceLease.workspaceRootPath'
    )
      && processSupervisorContractSource.includes(
        'sandboxRequest.realRootPath !== workspaceLease.workspaceRealRootPath'
      )
      && processSupervisorContractSource.includes('value.tempRoots.length !== 0')
      && processSupervisorContractSource.includes('value.cacheRoots.length !== 0'),
    'process execution must bind to the isolated workspace and deny unauthorised external roots'
  );
  assert.ok(
    processSupervisorSource.includes('function exec(input)')
      && processSupervisorSource.includes('function read(input)')
      && processSupervisorSource.includes('function wait(input)')
      && processSupervisorSource.includes('function stop(input)')
      && processSupervisorSource.includes("reasonCode: 'SUPERVISOR_DISPOSED'")
      && processSupervisorSource.indexOf('const pendingStops =')
        < processSupervisorSource.indexOf("'dispose',", processSupervisorSource.indexOf('const pendingStops =')),
    'the supervisor must expose cursor lifecycle operations and stop active trees before backend disposal'
  );
  assert.ok(
    processSupervisorSource.includes('request.workspaceAuthorityDigest')
      && processSupervisorSource.includes('PROCESS_SUPERVISOR_REASONS.AUTHORITY_MISMATCH')
      && processSupervisorSource.includes('PROCESS_SUPERVISOR_REASONS.STATE_REGRESSION'),
    'read/wait/stop must retain workspace authority and monotonic process state'
  );
  assertDoesNotMatch(
    mainSource,
    /agent_runtime\/execution\/process_supervisor|createProcessSupervisor\s*\(/,
    'production must keep the process supervisor unwired until a bundled portable backend exists'
  );

  for (const guarantee of [
    'pinned_physical_root',
    'handle_relative_read',
    'handle_relative_inspect',
    'no_symlink_traversal',
    'no_pathname_reopen',
    'authenticated_close',
  ]) {
    assert.ok(
      rootAuthorityContractSource.includes(guarantee),
      `the project-root authority contract must require ${guarantee}`
    );
  }

  assert.ok(
    coordinatorSource.includes('authorityService.authorizeProjectRootLease(record.binding)')
      && coordinatorSource.includes('refreshProjectFromRootLease(')
      && coordinatorSource.includes("purpose: 'execution'"),
    'execution must authorize, acquire, and refresh from the pinned project root'
  );
  assert.ok(
    coordinatorSource.includes("Object.defineProperty(context, 'projectRootLease'")
      && coordinatorSource.includes('enumerable: false'),
    'the project-root lease must remain private in the execution context'
  );
  const coordinatorRemovalStart = coordinatorSource.indexOf(
    '  function removeRecord(record, reason, terminalStatus = null) {'
  );
  const coordinatorRemovalEnd = coordinatorSource.indexOf(
    '  function failPlanningRecord',
    coordinatorRemovalStart
  );
  assert.ok(
    coordinatorRemovalStart >= 0 && coordinatorRemovalEnd > coordinatorRemovalStart,
    'the coordinator release boundary must remain inspectable'
  );
  const coordinatorRemovalSource = coordinatorSource.slice(
    coordinatorRemovalStart,
    coordinatorRemovalEnd
  );
  assert.ok(
    coordinatorRemovalSource.indexOf('releaseBarrierConfirmed')
      < coordinatorRemovalSource.indexOf('releaseProjectRootLeaseConfirmed')
      && coordinatorRemovalSource.indexOf('releaseProjectRootLeaseConfirmed')
        < coordinatorRemovalSource.indexOf('revokeBindingConfirmed'),
    'execution cleanup must close mutation workflows, then the root, then job authority'
  );

  assert.ok(
    recoverySource.includes('acquireRecoveryRootLease(')
      && recoverySource.includes("purpose: 'recovery'")
      && recoverySource.includes('expectedPhysicalRootIdentityDigest'),
    'delete recovery must pin the reauthorized physical root before replay'
  );
  const recoveryCleanupStart = recoverySource.indexOf('    } finally {',
    recoverySource.indexOf('  function recoverJob(input = {}) {'));
  const recoveryCleanupEnd = recoverySource.indexOf(
    '  function diagnostics()',
    recoveryCleanupStart
  );
  assert.ok(
    recoveryCleanupStart >= 0 && recoveryCleanupEnd > recoveryCleanupStart,
    'the recovery cleanup boundary must remain inspectable'
  );
  const recoveryCleanupSource = recoverySource.slice(
    recoveryCleanupStart,
    recoveryCleanupEnd
  );
  assert.ok(
    recoveryCleanupSource.indexOf('releaseRecoveryRootLease')
      < recoveryCleanupSource.indexOf('authority.revoke()')
      && recoveryCleanupSource.indexOf('authority.revoke()')
        < recoveryCleanupSource.indexOf('finishAttempt('),
    'recovery must close the root, revoke ephemeral authority, then seal and audit'
  );

  assert.ok(
    recoverySource.includes('createTransactionalRuntime(Object.freeze({')
      && recoverySource.includes('}), projectRootReader)'),
    'recovery must pass its already-held root reader into the transactional runtime'
  );
  assert.ok(
    agenticDeleteRuntimeSource.includes(
      'transactionOptions.getProjectRootReader = getProjectRootReader'
    ),
    'the agentic runtime must forward private root-reader authority to transactions'
  );
  const anchoredDeleteStart = transactionalDeleteSource.indexOf(
    '  function inspectProjectRootEntry('
  );
  const anchoredReaderEnd = transactionalDeleteSource.indexOf(
    '  function assertSafeAncestors(',
    anchoredDeleteStart
  );
  assert.ok(
    anchoredDeleteStart >= 0 && anchoredReaderEnd > anchoredDeleteStart,
    'the anchored transactional reader boundary must remain inspectable'
  );
  const anchoredReaderSource = transactionalDeleteSource.slice(
    anchoredDeleteStart,
    anchoredReaderEnd
  );
  const anchoredScanStart = transactionalDeleteSource.indexOf(
    '  function scanAnchoredEntry('
  );
  const anchoredScanEnd = transactionalDeleteSource.indexOf(
    '  function scanTargets(',
    anchoredScanStart
  );
  assert.ok(
    anchoredScanStart >= 0 && anchoredScanEnd > anchoredScanStart,
    'the anchored transactional scan boundary must remain inspectable'
  );
  const anchoredScanSource = transactionalDeleteSource.slice(
    anchoredScanStart,
    anchoredScanEnd
  );
  assert.ok(
    anchoredScanSource.includes('rootReader,')
      && anchoredScanSource.includes('inspectProjectRootEntry(rootReader, relativePath)')
      && anchoredScanSource.includes('listProjectRootDirectory(rootReader, relativePath)'),
    'transaction preparation must inspect targets through the retained root reader'
  );
  assertDoesNotMatch(
    `${anchoredReaderSource}\n${anchoredScanSource}`,
    /\bfs\.|readFileSync|readdirSync|realpathSync|lstatSync|statSync|openSync|fstatSync/,
    'the anchored transactional scan must never reopen the project by pathname'
  );
  assertDoesNotMatch(
    transactionalDeleteSource,
    /purpose:\s*['"]mutation_prepare['"]|projectRootAuthority\.acquire|acquireProjectRootLease/,
    'transaction preparation must reuse the execution/recovery lease instead of acquiring another root'
  );

  assertDoesNotMatch(
    rootAuthorityRegistrySource,
    /\bregister\s*\(|process\.platform|sandbox_backend_registry/,
    'project-root ownership must capture one immutable backend'
  );
  const anchoredScannerStart = projectScannerSource.indexOf(
    'function normalizeRootLeaseInput'
  );
  const anchoredScannerEnd = projectScannerSource.indexOf(
    '  return {\n    collectProjectFilesTree,',
    anchoredScannerStart
  );
  assert.ok(
    anchoredScannerStart >= 0 && anchoredScannerEnd > anchoredScannerStart,
    'the anchored project scanner boundary must remain inspectable'
  );
  const anchoredScannerSource = projectScannerSource.slice(
    anchoredScannerStart,
    anchoredScannerEnd
  );
  assertDoesNotMatch(
    anchoredScannerSource,
    /\bfs\.|readFileSync|readdirSync|realpathSync|lstatSync|statSync/,
    'the anchored project scanner must never reopen the project by pathname'
  );
  assert.ok(
    anchoredScannerSource.includes('invokeRootList(reader, relativeDirectory)')
      && anchoredScannerSource.includes("rootPath: ''"),
    'the anchored scanner must read through its lease and detect stacks from its snapshot'
  );
  assertDoesNotMatch(
    mainSource,
    /project_root_authority_(?:contract|registry)|createProjectRootAuthorityRegistry/,
    'production must keep project-root authority fail-closed until a pinned provider exists'
  );
  for (const guarantee of [
    'exclusive_source_binding',
    'private_workspace_root',
    'source_root_not_mutated',
    'rollback_by_discard',
    'physical_source_identity',
    'physical_workspace_identity',
  ]) {
    assert.ok(
      contractSource.includes(guarantee),
      `the execution workspace contract must require ${guarantee}`
    );
  }

  assertDoesNotMatch(
    registrySource,
    /\bregister\s*\(|process\.platform|sandbox_backend_registry/,
    'workspace ownership must use one immutable backend and must stay separate from process sandbox selection'
  );
  assertDoesNotMatch(
    mainSource,
    /execution_workspace_(?:contract|registry)|createExecutionWorkspaceRegistry/,
    'production must remain fail-closed until an enforced isolated workspace provider exists'
  );
  assertDoesNotMatch(
    sandboxContractSource,
    /execution_workspace_(?:contract|registry)|createExecutionWorkspaceRegistry/,
    'process sandbox and workspace ownership must remain separate authorities'
  );
  assertDoesNotMatch(
    verifiedExecutionSource,
    /execution_workspace_(?:contract|registry)|createExecutionWorkspaceRegistry/,
    'the legacy temporary copy must not be promoted as an enforced execution workspace provider'
  );
}

assertRendererBoundary();
assertPreloadBoundary();
assertCortexBoundary();
assertMainBoundary();
assertAgentRuntimeBoundary();
assertProjectCapabilityBoundary();
assertAssistantHarnessCompositionBoundary();
assertExecutionWorkspaceBoundary();
assertProductToolchainUsesExecutionBoundary();

console.log('architecture-boundary.test.js: ok');
