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
    ].includes(relativePath)) continue;
    assertDoesNotMatch(
      source,
      /\bproviderFactory\b|createAnchoredMutationBackendAdapter|require\(['"][^'"]*anchored_mutation_backend_adapter['"]\)/,
      `${relativePath} must not activate or bypass the sealed mutation provider seam before phase 2.4`
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

assertRendererBoundary();
assertPreloadBoundary();
assertCortexBoundary();
assertMainBoundary();
assertAgentRuntimeBoundary();
assertProjectCapabilityBoundary();
assertAssistantHarnessCompositionBoundary();
assertProductToolchainUsesExecutionBoundary();

console.log('architecture-boundary.test.js: ok');
