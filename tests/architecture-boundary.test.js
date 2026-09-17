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
  const codexAppServerKernelAdapterSource = read(
    'main/agent_runtime/codex_app_server_kernel_adapter.js'
  );
  const codexAppServerRuntimeConfigSource = read(
    'main/runtime/codex_app_server_runtime_config.js'
  );
  const codexAppServerProductionClientActivationSource = read(
    'main/services/codex_app_server_production_client_activation.js'
  );
  const shadowPlanSemanticComparatorSource = read(
    'main/agent_runtime/shadow_plan_semantic_comparator.js'
  );
  const shadowPlanEvidenceEvaluatorSource = read(
    'main/agent_runtime/shadow_plan_evidence_evaluator.js'
  );
  const shadowPlanEvidenceCorpusSource = read(
    'main/agent_runtime/shadow_plan_evidence_corpus.js'
  );
  const shadowPlanEvidenceSuiteSource = read(
    'main/agent_runtime/shadow_plan_evidence_suite.js'
  );
  const shadowPlanEvidenceObserverAdapterSource = read(
    'main/agent_runtime/shadow_plan_evidence_observer_adapter.js'
  );
  const shadowPlanEvaluationLedgerSource = read(
    'main/agent_runtime/shadow_plan_evaluation_ledger.js'
  );
  const shadowPlanRunnerSource = read(
    'main/agent_runtime/shadow_plan_runner.js'
  );
  const shadowPlanRuntimeCompositionSource = read(
    'main/agent_runtime/shadow_plan_runtime_composition.js'
  );
  const canaryEditAdmissionPolicySource = read(
    'main/agent_runtime/canary_edit_admission_policy.js'
  );
  const canaryAdmissionFactsProviderSource = read(
    'main/services/canary_admission_facts_provider.js'
  );
  const canaryInternalRolloutPolicySource = read(
    'main/services/canary_internal_rollout_policy.js'
  );
  const canaryEditActionClassifierSource = read(
    'main/agent_runtime/canary_edit_action_classifier.js'
  );
  const canaryRolloutSelectorSource = read(
    'main/agent_runtime/canary_rollout_selector.js'
  );
  const canaryRolloutEvidenceLedgerSource = read(
    'main/agent_runtime/canary_rollout_evidence_ledger.js'
  );
  const canaryRolloutEvidenceJournalSource = read(
    'main/services/canary_rollout_evidence_journal_adapter.js'
  );
  const canaryPromotionRollbackStoreSource = read(
    'main/services/canary_promotion_rollback_store_adapter.js'
  );
  const canaryManualRollbackJournalSource = read(
    'main/services/canary_manual_rollback_journal_adapter.js'
  );
  const canaryManualRollbackJobServiceSource = read(
    'main/services/canary_manual_rollback_job_service.js'
  );
  const canaryRolloutEvidenceObserverSource = read(
    'main/agent_runtime/canary_rollout_evidence_observer_adapter.js'
  );
  const canaryEditLifecycleSource = read(
    'main/agent_runtime/canary_edit_lifecycle.js'
  );
  const canaryEditRunnerSource = read(
    'main/agent_runtime/canary_edit_runner.js'
  );
  const canaryEditRuntimeCompositionSource = read(
    'main/agent_runtime/canary_edit_runtime_composition.js'
  );
  const canaryEditProductionRuntimeSource = read(
    'main/services/canary_edit_production_runtime.js'
  );
  const canaryEditTerminalObserverSource = read(
    'main/services/canary_edit_terminal_observer_adapter.js'
  );
  const canaryStagingContractSource = read(
    'main/agent_runtime/canary_staging_contract.js'
  );
  const canaryPromotionContractSource = read(
    'main/agent_runtime/canary_promotion_contract.js'
  );
  const canaryPromotionControllerSource = read(
    'main/agent_runtime/canary_promotion_controller.js'
  );
  const canaryStagingTrialExecutorSource = read(
    'main/agent_runtime/canary_staging_trial_executor.js'
  );
  const canaryTransactionalStagingExecutorSource = read(
    'main/agent_runtime/canary_transactional_staging_executor.js'
  );
  const canaryWorkspaceSessionPortAdapterSource = read(
    'main/services/canary_workspace_session_port_adapter.js'
  );
  const canarySourceSnapshotProviderSource = read(
    'main/services/canary_source_snapshot_provider.js'
  );
  const canaryStagingWriteSetContractSource = read(
    'main/agent_runtime/canary_staging_write_set_contract.js'
  );
  const canaryLocalStagingEditorAdapterSource = read(
    'main/services/canary_local_staging_editor_adapter.js'
  );
  const canaryLocalPromotionBackendSource = read(
    'main/services/canary_local_promotion_backend.js'
  );
  const defaultOnRolloutPolicySource = read(
    'main/agent_runtime/default_on_rollout_policy.js'
  );
  const defaultOnRolloutSafetyInterlockSource = read(
    'main/agent_runtime/default_on_rollout_safety_interlock.js'
  );
  assertDoesNotMatch(
    routerSource,
    /require\(['"]\.\/legacy_kernel_adapter['"]\)/,
    'HarnessRouter must depend on the AgentKernel contract, not the legacy adapter implementation'
  );
  const routerPlanDispatchStart = routerSource.indexOf(
    'if (kernelRequest.operation === HARNESS_OPERATIONS.PLAN)'
  );
  const routerMessageDispatchStart = routerSource.indexOf(
    'else if (kernelRequest.operation === HARNESS_OPERATIONS.MESSAGE)',
    routerPlanDispatchStart
  );
  const routerExecuteDispatchStart = routerSource.indexOf(
    'else if (kernelRequest.operation === HARNESS_OPERATIONS.EXECUTE)',
    routerMessageDispatchStart
  );
  const routerUnsupportedDispatchStart = routerSource.indexOf(
    '} else {',
    routerExecuteDispatchStart
  );
  assert.ok(
    routerPlanDispatchStart >= 0
      && routerMessageDispatchStart > routerPlanDispatchStart
      && routerExecuteDispatchStart > routerMessageDispatchStart
      && routerUnsupportedDispatchStart > routerExecuteDispatchStart,
    'HarnessRouter must retain explicit plan, message, and execute dispatch branches'
  );
  assert.ok(
    routerSource.slice(
      routerPlanDispatchStart,
      routerMessageDispatchStart
    ).includes('callShadowPlanRunner(capturedShadowPlanRunner, kernelRequest)'),
    'HarnessRouter must route shadow observation only through its plan branch'
  );
  assertDoesNotMatch(
    routerSource.slice(routerMessageDispatchStart, routerUnsupportedDispatchStart),
    /callShadowPlanRunner\s*\(/,
    'HarnessRouter must keep the shadow plan runner out of message and execute'
  );
  assertDoesNotMatch(
    routerSource.slice(routerMessageDispatchStart, routerExecuteDispatchStart),
    /callCanaryEditRunner\s*\(/,
    'HarnessRouter must keep canary editing out of message dispatch'
  );
  assert.ok(
    routerSource.slice(
      routerExecuteDispatchStart,
      routerUnsupportedDispatchStart
    ).includes('callCanaryEditRunner(capturedCanaryEditRunner, kernelRequest)'),
    'HarnessRouter must route canary editing only through its explicit execute branch'
  );
  assert.ok(
    routerSource.includes("resolvedRuntimeConfig.configuredMode === 'shadow'")
      && routerSource.includes("reason = 'shadow_active'")
      && routerSource.includes("reason = 'shadow_runner_unavailable'"),
    'HarnessRouter must activate shadow explicitly and report unavailable composition fail-closed'
  );
  assert.ok(
    routerSource.includes("resolvedRuntimeConfig.configuredMode === 'canary'")
      && routerSource.includes("reason = 'canary_active'")
      && routerSource.includes("reason = 'canary_runner_unavailable'")
      && routerSource.includes(
        'canaryEditRunner.execute must return a native Promise'
      ),
    'HarnessRouter must activate canary explicitly, require a native async runner, and report unavailable composition fail-closed'
  );
  for (const [label, source] of [
    ['default-on rollout policy', defaultOnRolloutPolicySource],
    ['default-on safety interlock', defaultOnRolloutSafetyInterlockSource],
  ]) {
    assertDoesNotMatch(
      source,
      /require\(['"](?:fs|child_process|worker_threads|electron|net|tls|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm|reset)\s*\(/,
      `${label} must remain a pure main-owned authority boundary without ambient host effects or broad reset`
    );
  }
  const defaultOnExecuteStart = routerSource.indexOf(
    "} else if (defaultOnSnapshot\n        && defaultOnSnapshot.selectedKernel === 'v2')"
  );
  const defaultOnBeginIndex = routerSource.indexOf(
    'beginDefaultOnSafetyExecution(',
    defaultOnExecuteStart
  );
  const defaultOnRunnerIndex = routerSource.indexOf(
    'result = await callCanaryEditRunner(',
    defaultOnBeginIndex
  );
  const defaultOnFinishIndex = routerSource.indexOf(
    'finishDefaultOnSafetyExecution(',
    defaultOnRunnerIndex
  );
  assert.ok(
    defaultOnExecuteStart >= 0
      && defaultOnBeginIndex > defaultOnExecuteStart
      && defaultOnRunnerIndex > defaultOnBeginIndex
      && defaultOnFinishIndex > defaultOnRunnerIndex
      && routerSource.indexOf(
        'captureAndPersistDefaultOnSnapshot(kernelRequest)',
        routerExecuteDispatchStart
      ) < defaultOnExecuteStart,
    'default-on execution must persist its job snapshot, arm safety, execute V2, and settle safety in that order'
  );
  assert.ok(
    defaultOnRolloutSafetyInterlockSource.indexOf("state = 'tripped';")
      < defaultOnRolloutSafetyInterlockSource.indexOf(
        'tripPromise = performTrip(request, [...activeJobs.values()]);'
      )
      && defaultOnRolloutSafetyInterlockSource.indexOf('synchronousCall(cancelJob')
        < defaultOnRolloutSafetyInterlockSource.indexOf(
          'synchronousCall(closeBrowserJob'
        )
      && defaultOnRolloutSafetyInterlockSource.indexOf(
        'synchronousCall(closeBrowserJob'
      ) < defaultOnRolloutSafetyInterlockSource.indexOf(
        'Reflect.apply(closeRuntime'
      )
      && defaultOnRolloutSafetyInterlockSource.includes('broadResetUsed: false')
      && defaultOnRolloutSafetyInterlockSource.includes("restartMode: 'legacy_new_job'"),
    'a safety trip must close admission before cancelling exact jobs, browser sessions, and runtime without broad reset'
  );
  assertDoesNotMatch(
    routerSource.slice(
      routerExecuteDispatchStart,
      routerUnsupportedDispatchStart
    ),
    /catch[\s\S]{0,300}legacyKernel\.execute/,
    'HarnessRouter must never invent a legacy fallback after an ambiguous canary failure'
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
  assertDoesNotMatch(
    codexAppServerKernelAdapterSource,
    /require\(['"](?:fs|child_process|worker_threads|electron)['"]\)/,
    'the App Server kernel adapter must not own host I/O, process, worker, or Electron capabilities'
  );
  assertDoesNotMatch(
    codexAppServerKernelAdapterSource,
    /\b(?:exec|execFile|spawn|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'the App Server kernel adapter must remain a plan-only protocol consumer'
  );
  assert.ok(
    codexAppServerKernelAdapterSource.includes(
      'capabilities: [HARNESS_OPERATIONS.PLAN]'
    )
      && codexAppServerKernelAdapterSource.includes('shadow: true')
      && codexAppServerKernelAdapterSource.includes('readOnly: true'),
    'the App Server kernel adapter must stay explicitly plan-only, shadow, and read-only'
  );
  assertDoesNotMatch(
    codexAppServerKernelAdapterSource,
    /codex_app_server_stdio_client/,
    'the App Server kernel adapter must depend on the protocol contract, not the child-process transport implementation'
  );
  assertDoesNotMatch(
    codexAppServerRuntimeConfigSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'App Server runtime configuration must only normalize explicit environment data without gaining host execution authority'
  );
  assert.ok(
    codexAppServerRuntimeConfigSource.includes("'FABER_APP_SERVER_ADAPTER'")
      && codexAppServerRuntimeConfigSource.includes("'FABER_CODEX_COMMAND'")
      && codexAppServerRuntimeConfigSource.includes(
        "reason: CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.DEFAULT_DISABLED"
      )
      && codexAppServerRuntimeConfigSource.includes(
        'commandPath: null'
      ),
    'App Server activation must default off and require an explicit absolute command path without leaking ignored paths'
  );
  assertDoesNotMatch(
    codexAppServerProductionClientActivationSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork)\s*\(/,
    'production App Server activation must delegate process ownership to the pinned stdio client and receive environment explicitly'
  );
  const clientActivationStartIndex =
    codexAppServerProductionClientActivationSource.indexOf(
      "const receipt = await callNativeAsync(client, 'start');"
    );
  const clientActivationStatusIndex =
    codexAppServerProductionClientActivationSource.indexOf(
      'const status = readClientStatus(client);',
      clientActivationStartIndex
    );
  const clientActivationIsolationIndex =
    codexAppServerProductionClientActivationSource.indexOf(
      '|| !validIsolationProfile(client)'
    );
  const clientActivationCleanupIndex =
    codexAppServerProductionClientActivationSource.indexOf(
      'cleanupConfirmed = await cleanupClient();'
    );
  assert.ok(
    clientActivationStartIndex >= 0
      && clientActivationStatusIndex > clientActivationStartIndex
      && clientActivationIsolationIndex > clientActivationStatusIndex
      && clientActivationCleanupIndex > clientActivationIsolationIndex
      && codexAppServerProductionClientActivationSource.includes(
        'CODEX_APP_SERVER_PINNED_CLI_VERSION'
      )
      && codexAppServerProductionClientActivationSource.includes(
        "['shadow', 'canary', 'on'].includes(runtimeConfig.configuredMode)"
      ),
    'production App Server activation must require pinned readiness and complete isolation before selection, cleaning every failed client'
  );
  for (const [label, source] of [
    ['shadow semantic comparator', shadowPlanSemanticComparatorSource],
    ['shadow evidence evaluator', shadowPlanEvidenceEvaluatorSource],
    ['shadow evidence corpus', shadowPlanEvidenceCorpusSource],
    ['shadow evidence suite', shadowPlanEvidenceSuiteSource],
    ['shadow evidence observer adapter', shadowPlanEvidenceObserverAdapterSource],
    ['shadow evaluation ledger', shadowPlanEvaluationLedgerSource],
    ['shadow plan runner', shadowPlanRunnerSource],
    ['shadow runtime composition', shadowPlanRuntimeCompositionSource],
  ]) {
    assertDoesNotMatch(
      source,
      /require\(['"](?:fs|child_process|worker_threads|electron)['"]\)/,
      `${label} must not own host I/O, process, worker, or Electron capabilities`
    );
  }
  assertDoesNotMatch(
    shadowPlanSemanticComparatorSource,
    /\.response\b|JSON\.stringify\s*\(|localeCompare\s*\(/,
    'shadow comparison must use structured criteria instead of plan-text equality or ordering'
  );
  for (const [label, source] of [
    ['shadow evidence evaluator', shadowPlanEvidenceEvaluatorSource],
    ['shadow evidence corpus', shadowPlanEvidenceCorpusSource],
    ['shadow evidence suite', shadowPlanEvidenceSuiteSource],
    ['shadow evidence observer adapter', shadowPlanEvidenceObserverAdapterSource],
    ['shadow evaluation ledger', shadowPlanEvaluationLedgerSource],
  ]) {
    assertDoesNotMatch(
      source,
      /\.response\b|JSON\.stringify\s*\(|localeCompare\s*\(/,
      `${label} must grade and aggregate structured evidence without plan-text equality or ordering`
    );
  }
  assert.ok(
    shadowPlanEvidenceEvaluatorSource.includes("id: 'functional_success'")
      && shadowPlanEvidenceEvaluatorSource.includes('weightBasisPoints: 3000')
      && shadowPlanEvidenceEvaluatorSource.includes("id: 'acceptance_coverage'")
      && shadowPlanEvidenceEvaluatorSource.includes('weightBasisPoints: 2500'),
    'shadow evidence evaluation must pin the versioned functional and acceptance rubric'
  );
  assert.ok(
    shadowPlanEvidenceCorpusSource.includes(
      'record.requestDigest !== inspected.requestDigest'
    )
      && shadowPlanEvidenceCorpusSource.includes(
        'record.resultDigest !== inspected.resultDigest'
      )
      && shadowPlanEvidenceCorpusSource.includes(
        'assertShadowPlanEvidenceGrade(grade, {'
      )
      && shadowPlanEvidenceCorpusSource.includes(
        'return record.grade;'
      ),
    'the evidence corpus must return only rubric-valid grades bound to the exact observed request and result digests'
  );
  assertDoesNotMatch(
    shadowPlanEvidenceCorpusSource,
    /\.response\b|localeCompare\s*\(|\b(?:spawn|execFile|fork)\s*\(/,
    'the evidence corpus must not compare plan text or own executable authority'
  );
  assert.ok(
    shadowPlanEvidenceSuiteSource.includes('for (const check of checks)')
      && shadowPlanEvidenceSuiteSource.indexOf(
        'const receipt = await callPortWithTimeout(check, inspected.input, {'
      ) < shadowPlanEvidenceSuiteSource.indexOf(
        'const receipt = await callPortWithTimeout(\n          safetyAudit,'
      )
      && shadowPlanEvidenceSuiteSource.includes(
        'criterionWeights.get(criterion.id) !== TOTAL_WEIGHT_BASIS_POINTS'
      )
      && shadowPlanEvidenceSuiteSource.includes(
        'assertShadowPlanEvidenceGrade(grade, {'
      )
      && shadowPlanEvidenceSuiteSource.includes(
        'createShadowPlanEvidenceCorpusRecord({'
      ),
    'the evidence suite must run weighted checks sequentially, audit safety, validate the grade, and bind observed corpus records'
  );
  assertDoesNotMatch(
    shadowPlanEvidenceSuiteSource,
    /\.response\b|JSON\.stringify\s*\(|localeCompare\s*\(|\b(?:spawn|execFile|fork)\s*\(|\bprocess\.env\b/,
    'the evidence suite must receive observable ports without plan-text comparison or ambient executable authority'
  );
  assert.ok(
    shadowPlanEvidenceObserverAdapterSource.includes(
      'const activeByInput = new WeakMap();'
    )
      && shadowPlanEvidenceObserverAdapterSource.includes(
        'callObserverWithTimeout('
      )
      && shadowPlanEvidenceObserverAdapterSource.includes(
        'observerTimeoutMs >= safetyTimeoutMs'
      )
      && shadowPlanEvidenceObserverAdapterSource.includes(
        '.finally(() => releaseObservation(input));'
      )
      && shadowPlanEvidenceObserverAdapterSource.includes(
        "fields.get('requestId') !== identity.requestId"
      )
      && shadowPlanEvidenceObserverAdapterSource.includes(
        "fields.get('kernelId') !== identity.kernelId"
      )
      && shadowPlanEvidenceObserverAdapterSource.includes(
        'suite = createShadowPlanEvidenceSuite({'
      ),
    'the observer adapter must share one bounded identity-bound observation across checks and release it after the mandatory safety audit'
  );
  assertDoesNotMatch(
    shadowPlanEvidenceObserverAdapterSource,
    /\.response\b|JSON\.stringify\s*\(|localeCompare\s*\(|\b(?:spawn|execFile|fork)\s*\(|\bprocess\.env\b/,
    'the observer adapter must consume injected receipts without plan-text comparison or ambient process authority'
  );
  assert.ok(
    shadowPlanEvaluationLedgerSource.includes(
      'DEFAULT_REQUIRED_PARITY_RATE_BASIS_POINTS = 9000'
    )
      && shadowPlanEvaluationLedgerSource.includes(
        'DEFAULT_MAXIMUM_FUNCTIONAL_REGRESSION_BASIS_POINTS = 300'
      )
      && shadowPlanEvaluationLedgerSource.includes('safetyViolations > 0'),
    'shadow evaluation promotion must require 90% parity, at most 3pp functional regression, and zero safety violations'
  );
  assert.ok(
    shadowPlanRunnerSource.includes('scheduleObservation({')
      && shadowPlanRunnerSource.indexOf('scheduleObservation({')
        < shadowPlanRunnerSource.lastIndexOf('const authoritative = await authoritativeOutcome;')
      && shadowPlanRunnerSource.includes('return authoritative.result;'),
    'shadow observation must start before the runner returns the unchanged authoritative result'
  );
  assert.ok(
    shadowPlanRuntimeCompositionSource.includes(
      "EVIDENCE_GRADER_UNAVAILABLE: 'evidence_grader_unavailable'"
    )
      && shadowPlanRuntimeCompositionSource.indexOf(
        'const evaluator = createShadowPlanEvidenceEvaluator({'
      ) < shadowPlanRuntimeCompositionSource.indexOf(
        'const shadowKernel = createCodexAppServerKernelAdapter(adapterOptions);'
      )
      && shadowPlanRuntimeCompositionSource.indexOf(
        'const shadowKernel = createCodexAppServerKernelAdapter(adapterOptions);'
      ) < shadowPlanRuntimeCompositionSource.indexOf(
        'const runner = createShadowPlanRunner({'
      ),
    'shadow runtime composition must require trusted evidence before creating the App Server plan runner'
  );
  assert.ok(
    shadowPlanRuntimeCompositionSource.indexOf(
      "await observeNativePromise(runner.drain(), 'shadowPlanRunner.drain');"
    ) < shadowPlanRuntimeCompositionSource.indexOf(
      "const closeReceipt = await callAsyncPort(clientLifecycle, 'close');"
    ),
    'shadow runtime shutdown must drain bounded observations before closing its App Server client'
  );
  assertDoesNotMatch(
    shadowPlanRuntimeCompositionSource,
    /\bprocess\.env\b|\b(?:spawn|execFile|fork)\s*\(/,
    'shadow runtime composition must receive explicit ports without ambient process or executable authority'
  );
  assertDoesNotMatch(
    canaryEditAdmissionPolicySource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'canary admission must remain a pure fail-closed decision boundary without ambient mutation, process, network, or Electron authority'
  );
  for (const prerequisite of [
    'projectAuthorized',
    'localEdit',
    'installFree',
    'networkFree',
    'checkpointValid',
    'rootMutationExclusive',
  ]) {
    assert.ok(
      canaryEditAdmissionPolicySource.includes(prerequisite),
      `canary admission must enforce the ${prerequisite} prerequisite`
    );
  }
  assertDoesNotMatch(
    canaryAdmissionFactsProviderSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'canary admission facts must derive a fail-closed snapshot without ambient mutation, process, network, or Electron authority'
  );
  const canaryFactsExecuteAuthorityIndex =
    canaryAdmissionFactsProviderSource.indexOf(
      'dependencies.authorityService.authorizeExecute,'
    );
  const canaryFactsRootAuthorityIndex =
    canaryAdmissionFactsProviderSource.indexOf(
      'dependencies.authorityService.authorizeProjectRootLease,'
    );
  const canaryFactsMutationIndex = canaryAdmissionFactsProviderSource.indexOf(
    'dependencies.inspectRootMutation,'
  );
  const canaryFactsRolloutIndex = canaryAdmissionFactsProviderSource.indexOf(
    'dependencies.inspectRollout,'
  );
  const canaryFactsCheckpointIndex =
    canaryAdmissionFactsProviderSource.indexOf(
      'const checkpointDigest = canonicalSha256Digest({'
    );
  assert.ok(
    canaryFactsExecuteAuthorityIndex >= 0
      && canaryFactsRootAuthorityIndex > canaryFactsExecuteAuthorityIndex
      && canaryFactsMutationIndex > canaryFactsRootAuthorityIndex
      && canaryFactsRolloutIndex > canaryFactsMutationIndex
      && canaryFactsCheckpointIndex > canaryFactsRolloutIndex
      && canaryAdmissionFactsProviderSource.includes(
        'CANARY_ADMISSION_FACTS_CHECKPOINT_SCHEMA_VERSION'
      )
      && canaryAdmissionFactsProviderSource.includes(
        'activeOtherMutatingJobs: 1'
      )
      && canaryAdmissionFactsProviderSource.includes('killSwitch: true'),
    'canary admission facts must reauthorize the exact action and root before observations, bind the checkpoint, and deny on unavailable live state'
  );
  assertDoesNotMatch(
    canaryInternalRolloutPolicySource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'the internal canary rollout policy must receive project authorization explicitly without ambient filesystem, process, network, or Electron authority'
  );
  const internalRolloutModeIndex = canaryInternalRolloutPolicySource.indexOf(
    "runtimeConfig.configuredMode === 'canary'"
  );
  const internalRolloutBindingIndex = canaryInternalRolloutPolicySource.indexOf(
    'const binding = normalizeBinding(inputBinding);'
  );
  const internalRolloutAuthorizationIndex =
    canaryInternalRolloutPolicySource.indexOf(
      'authorization = Reflect.apply(authorizeProjectBinding, undefined, ['
    );
  const internalRolloutMatchIndex = canaryInternalRolloutPolicySource.indexOf(
    'authorizationMatches(authorization, binding)'
  );
  assert.ok(
    canaryInternalRolloutPolicySource.includes(
      "'canary-internal-rollout-policy.v1'"
    )
      && internalRolloutModeIndex >= 0
      && internalRolloutBindingIndex > internalRolloutModeIndex
      && internalRolloutAuthorizationIndex > internalRolloutBindingIndex
      && internalRolloutMatchIndex > internalRolloutAuthorizationIndex
      && canaryInternalRolloutPolicySource.includes(
        "projectPin: canaryActive ? null : 'legacy'"
      )
      && canaryInternalRolloutPolicySource.includes(
        'rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL'
      ),
    'initial canary rollout must be canary-mode-only, exact-binding authorized, internal-only, and pinned to legacy otherwise'
  );
  assertDoesNotMatch(
    canaryEditActionClassifierSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'canary edit classification must remain a pure data boundary without ambient mutation, process, network, or Electron authority'
  );
  assert.ok(
    canaryEditActionClassifierSource.includes("'mkdir', 'write_file', 'append_file'")
      && canaryEditActionClassifierSource.includes('MAX_OPERATIONS = 32')
      && canaryEditActionClassifierSource.includes(
        'MAX_TOTAL_CONTENT_BYTES = 2 * 1024 * 1024'
      )
      && canaryEditActionClassifierSource.includes('EXTERNAL_EFFECT_FLAGS'),
    'canary classification must permit only bounded local text edits and reject requested external effects'
  );
  assertDoesNotMatch(
    canaryRolloutSelectorSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'canary rollout selection must remain a pure deterministic boundary without ambient mutation, process, network, or Electron authority'
  );
  assert.ok(
    canaryRolloutSelectorSource.includes("PERCENT_1: '1_percent'")
      && canaryRolloutSelectorSource.includes("PERCENT_5: '5_percent'")
      && canaryRolloutSelectorSource.includes("PERCENT_25: '25_percent'")
      && canaryRolloutSelectorSource.includes("PERCENT_50: '50_percent'")
      && canaryRolloutSelectorSource.indexOf('if (input.killSwitch)')
        < canaryRolloutSelectorSource.indexOf("if (input.projectPin === 'legacy')")
      && canaryRolloutSelectorSource.indexOf("if (input.projectPin === 'canary')")
        < canaryRolloutSelectorSource.indexOf('if (!input.allowlisted)'),
    'canary rollout must pin the internal, 1%, 5%, 25%, and 50% stages with kill-switch and project-pin precedence'
  );
  assertDoesNotMatch(
    canaryRolloutEvidenceLedgerSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'canary rollout evidence must remain an append-only pure aggregation boundary without ambient mutation, process, network, or Electron authority'
  );
  assert.ok(
    canaryRolloutEvidenceLedgerSource.includes(
      'MANUAL_ROLLBACK_LIMIT_BASIS_POINTS = 200'
    )
      && canaryRolloutEvidenceLedgerSource.includes(
        'CORRUPTED_JOB_LIMIT_BASIS_POINTS = 50'
      )
      && canaryRolloutEvidenceLedgerSource.includes(
        'MAXIMUM_SUCCESS_REGRESSION_BASIS_POINTS = 300'
      )
      && canaryRolloutEvidenceLedgerSource.includes(
        'state.dataLossIncidents > 0'
      )
      && canaryRolloutEvidenceLedgerSource.includes(
        'state.securityIncidents > 0'
      )
      && canaryRolloutEvidenceLedgerSource.includes(
        'state.duplicateExternalEffects > 0'
      )
      && canaryRolloutEvidenceLedgerSource.includes(
        'STAGE_ORDER.indexOf(fromStage)'
      )
      && canaryRolloutEvidenceLedgerSource.includes(
        'jobIds.has(evidence.jobId)'
      )
      && canaryRolloutEvidenceLedgerSource.indexOf('journal.append,')
        < canaryRolloutEvidenceLedgerSource.indexOf('acceptEvidence(evidence);'),
    'canary rollout advancement must use isolated per-stage evidence, global job uniqueness, zero-tolerance safety gates, and the fixed 2%, 0.5%, and 3pp thresholds'
  );
  assertDoesNotMatch(
    canaryRolloutEvidenceJournalSource,
    /require\(['"](?:child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|reset)\s*\(/,
    'the rollout evidence journal may own its private file only, never process, network, Electron, Git, or environment authority'
  );
  assert.ok(
    canaryRolloutEvidenceJournalSource.includes('fs.constants.O_NOFOLLOW')
      && canaryRolloutEvidenceJournalSource.includes('fs.fsyncSync(descriptor)')
      && canaryRolloutEvidenceJournalSource.includes('previousRecordDigest')
      && canaryRolloutEvidenceJournalSource.includes("digest('hex')")
      && canaryRolloutEvidenceJournalSource.includes('fs.chmodSync(directoryPath, 0o700)')
      && canaryRolloutEvidenceJournalSource.includes('fs.fchmodSync(descriptor, 0o600)')
      && canaryRolloutEvidenceJournalSource.includes('JOURNAL_CORRUPTED'),
    'the rollout evidence journal must be private, durable, hash chained, symlink resistant, and fail closed during recovery'
  );
  assertDoesNotMatch(
    canaryPromotionRollbackStoreSource,
    /require\(['"](?:child_process|worker_threads|electron|net|tls|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork)\s*\(|\b(?:git|Git)\s+(?:reset|checkout|clean|restore)\b/,
    'the promotion rollback store may own private persistence only, never process, network, Electron, environment, or broad Git authority'
  );
  assert.ok(
    canaryPromotionRollbackStoreSource.includes('fs.constants.O_NOFOLLOW')
      && canaryPromotionRollbackStoreSource.includes(
        'fs.fsyncSync(descriptor)'
      )
      && canaryPromotionRollbackStoreSource.includes(
        'fs.chmodSync(directoryPath, 0o700)'
      )
      && canaryPromotionRollbackStoreSource.includes(
        'fs.fchmodSync(descriptor, 0o600)'
      )
      && canaryPromotionRollbackStoreSource.includes('fs.renameSync(')
      && canaryPromotionRollbackStoreSource.includes('STORAGE_CORRUPTED')
      && canaryPromotionRollbackStoreSource.includes('RECOVERY_AMBIGUOUS')
      && canaryPromotionRollbackStoreSource.includes(
        "stateModel: 'prepared_committed_settled'"
      ),
    'the promotion rollback store must durably persist private inverse patches, reject links or corruption, and fail closed on ambiguous recovery'
  );
  assertDoesNotMatch(
    canaryManualRollbackJournalSource,
    /require\(['"](?:child_process|worker_threads|electron|net|tls|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork)\s*\(|\b(?:git|Git)\s+(?:reset|checkout|clean|restore)\b/,
    'the manual rollback journal may own private persistence only, never process, network, Electron, environment, or broad Git authority'
  );
  assert.ok(
    canaryManualRollbackJournalSource.includes('fs.constants.O_NOFOLLOW')
      && canaryManualRollbackJournalSource.includes(
        'fs.fsyncSync(descriptor)'
      )
      && canaryManualRollbackJournalSource.includes(
        'fs.chmodSync(directoryPath, 0o700)'
      )
      && canaryManualRollbackJournalSource.includes(
        'fs.fchmodSync(descriptor, 0o600)'
      )
      && canaryManualRollbackJournalSource.includes('fs.renameSync(')
      && canaryManualRollbackJournalSource.includes('JOURNAL_CORRUPTED')
      && canaryManualRollbackJournalSource.includes(
        "stateModel: 'registered_removed'"
      ),
    'the manual rollback journal must durably persist private registrations, reject links or corruption, and remove only settled promotions'
  );
  assertDoesNotMatch(
    canaryManualRollbackJobServiceSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|tls|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'the job rollback coordinator must use captured authority ports without ambient filesystem, process, network, Electron, or environment authority'
  );
  assert.ok(
    canaryManualRollbackJobServiceSource.includes(
      "const REQUEST_KEYS = Object.freeze(['jobId'])"
    )
      && canaryManualRollbackJobServiceSource.includes(
        "exactDataFields(value, REQUEST_KEYS, { frozen: true })"
      )
      && canaryManualRollbackJobServiceSource.includes(
        'dependencies.getAuthorizedJobById(request.jobId)'
      )
      && canaryManualRollbackJobServiceSource.includes(
        'dependencies.getManualRollback()'
      )
      && canaryManualRollbackJobServiceSource.indexOf(
        'Reflect.apply(port.rollback, port.receiver, [coreInput])'
      ) < canaryManualRollbackJobServiceSource.indexOf(
        'dependencies.markJobCanaryRolledBack('
      ),
    'manual rollback must accept only a frozen job locator, re-authorize durable canary evidence, restore through the owned runtime, and persist the receipt afterward'
  );
  assertDoesNotMatch(
    canaryEditLifecycleSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'canary edit lifecycle must remain a pure transition boundary without ambient mutation, process, network, or Electron authority'
  );
  assertDoesNotMatch(
    canaryRolloutEvidenceObserverSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm|reset)\s*\(/,
    'canary rollout observation must use captured ports without ambient host authority'
  );
  assert.ok(
    canaryRolloutEvidenceObserverSource.includes(
      'scope.facts = value;'
    )
      && canaryRolloutEvidenceObserverSource.includes(
        'scope.rolloutDecision = value;'
      )
      && canaryRolloutEvidenceObserverSource.includes(
        "route: rolloutDecision.selected === true ? 'canary' : 'baseline'"
      )
      && canaryRolloutEvidenceObserverSource.includes(
        "corrupted = eligibility.route === 'canary';"
      )
      && canaryRolloutEvidenceObserverSource.includes(
        'settleObservationBestEffort(scope, result, null);'
      ),
    'automatic rollout evidence must use the runner facts and cohort snapshot, attribute clean fallback to canary, and never rewrite execution on observer failure'
  );
  assert.ok(
    canaryEditLifecycleSource.includes(
      "mutationFrontier === CANARY_EDIT_MUTATION_FRONTIERS.SOURCE"
    )
      && canaryEditLifecycleSource.includes("? 'reverted'")
      && canaryEditLifecycleSource.includes(
        "state = CANARY_EDIT_LIFECYCLE_STATES.QUARANTINED"
      )
      && canaryEditLifecycleSource.indexOf(
        "state = CANARY_EDIT_LIFECYCLE_STATES.FALLBACK_READY"
      ) < canaryEditLifecycleSource.lastIndexOf(
        "state = CANARY_EDIT_LIFECYCLE_STATES.LEGACY_STARTED"
      ),
    'canary fallback must require sufficient cleanup after mutation and quarantine ambiguous source rollback before legacy starts'
  );
  assertDoesNotMatch(
    canaryEditRunnerSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'canary runner must orchestrate explicit trusted ports without ambient filesystem, process, network, or Electron authority'
  );
  const canaryClassificationIndex = canaryEditRunnerSource.indexOf(
    'const classification = classifyCanaryEditAction(actionValue);'
  );
  const canaryFactsIndex = canaryEditRunnerSource.indexOf(
    'const factsSnapshot = inspectFacts('
  );
  const canaryRolloutIndex = canaryEditRunnerSource.indexOf(
    'const rolloutDecision = selectRollout('
  );
  const canaryAdmissionIndex = canaryEditRunnerSource.indexOf(
    'const admissionDecision = decideAdmission('
  );
  const canaryGrantIndex = canaryEditRunnerSource.indexOf(
    'const grant = Object.freeze({'
  );
  const canaryEffectFrontierIndex = canaryEditRunnerSource.lastIndexOf(
    'dependencies.stagedCanaryExecutor.execute,'
  );
  assert.ok(
    canaryClassificationIndex >= 0
      && canaryFactsIndex > canaryClassificationIndex
      && canaryRolloutIndex > canaryFactsIndex
      && canaryAdmissionIndex > canaryRolloutIndex
      && canaryGrantIndex > canaryAdmissionIndex
      && canaryEffectFrontierIndex > canaryGrantIndex,
    'canary runner must classify, snapshot trusted facts, select rollout, admit, and grant before entering staging execution'
  );
  assert.ok(
    canaryEditRunnerSource.includes("workspaceIsolation') !== 'per_job_staging'")
      && canaryEditRunnerSource.includes("networkMode') !== 'disabled'")
      && canaryEditRunnerSource.includes("installMode') !== 'disabled'")
      && canaryEditRunnerSource.includes("promotionMode') !== 'explicit_checkpointed'"),
    'canary runner must accept only per-job staging executors with network and install disabled and explicit checkpointed promotion'
  );
  const canaryFallbackSignalIndex = canaryEditRunnerSource.indexOf(
    'const signal = normalizeFallbackSignal(result, request, authorityBinding);',
    canaryEffectFrontierIndex
  );
  const canaryFallbackVerificationIndex = canaryEditRunnerSource.indexOf(
    'if (!signal || !verifyCleanFallback(signal))',
    canaryFallbackSignalIndex
  );
  const canaryPostFrontierLegacyIndex = canaryEditRunnerSource.indexOf(
    'return fallbackToLegacy(request, signal.reason);',
    canaryFallbackVerificationIndex
  );
  assert.ok(
    canaryFallbackSignalIndex > canaryEffectFrontierIndex
      && canaryFallbackVerificationIndex > canaryFallbackSignalIndex
      && canaryPostFrontierLegacyIndex > canaryFallbackVerificationIndex
      && canaryEditRunnerSource.includes('lifecycle.confirmCleanup(signal.cleanupReceipt)')
      && canaryEditRunnerSource.includes('const legacy = lifecycle.startLegacy();'),
    'canary runner must start post-frontier legacy fallback only after an exact signal passes lifecycle cleanup and legacy-start transitions'
  );
  assertDoesNotMatch(
    canaryEditRunnerSource.slice(
      canaryEffectFrontierIndex,
      canaryFallbackSignalIndex
    ),
    /fallbackToLegacy\s*\(/,
    'an ambiguous staged execution rejection must never trigger legacy fallback'
  );
  assert.ok(
    canaryEditRunnerSource.includes(
      "diagnosticFields.get('authorityMode') !== 'exact_job_action_root'"
    )
      && canaryEditRunnerSource.includes(
        "diagnosticFields.get('checkpointMode') !== 'authority_bound'"
      )
      && canaryEditRunnerSource.includes(
        "diagnosticFields.get('failureMode') !== 'deny'"
      ),
    'canary runner must accept only an authority-bound fail-closed admission facts provider'
  );
  assertDoesNotMatch(
    canaryStagingContractSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'canary staging contracts must remain pure receipt validation without ambient mutation, process, network, or Electron authority'
  );
  assert.ok(
    canaryStagingContractSource.includes('assertExecutionWorkspaceLease(')
      && canaryStagingContractSource.includes('portablePathsOverlap(sourcePath, workspacePath)')
      && canaryStagingContractSource.includes("fields.get('sourceMutated') !== false")
      && canaryStagingContractSource.includes('assertExecutionWorkspaceDiscardReceipt(')
      && canaryStagingContractSource.includes(
        'CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION'
      ),
    'canary staging contracts must bind disjoint execution workspaces, prove staging-only writes, and translate physical discard into lifecycle cleanup evidence'
  );
  assertDoesNotMatch(
    canaryWorkspaceSessionPortAdapterSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm|reset)\s*\(/,
    'canary workspace session adapter must use explicit authorities without ambient filesystem, Git reset, process, network, or Electron access'
  );
  const workspacePortRootAcquireIndex =
    canaryWorkspaceSessionPortAdapterSource.indexOf(
      "'projectRootAuthorityRegistry.acquire'"
    );
  const workspacePortWorkspaceAcquireIndex =
    canaryWorkspaceSessionPortAdapterSource.indexOf(
      "'executionWorkspaceRegistry.acquire'",
      workspacePortRootAcquireIndex
    );
  const workspacePortSnapshotIndex =
    canaryWorkspaceSessionPortAdapterSource.indexOf(
      "'sourceSnapshotProvider.inspect'",
      workspacePortWorkspaceAcquireIndex
    );
  const workspacePortOpenOutcomeIndex =
    canaryWorkspaceSessionPortAdapterSource.indexOf(
      'schemaVersion: CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION',
      workspacePortSnapshotIndex
    );
  assert.ok(
    workspacePortRootAcquireIndex >= 0
      && workspacePortWorkspaceAcquireIndex > workspacePortRootAcquireIndex
      && workspacePortSnapshotIndex > workspacePortWorkspaceAcquireIndex
      && workspacePortOpenOutcomeIndex > workspacePortSnapshotIndex
      && canaryWorkspaceSessionPortAdapterSource.includes(
        'record.sourceRootIdentityDigest =\n      rootAuthorization.physicalRootIdentityDigest;'
      )
      && canaryWorkspaceSessionPortAdapterSource.includes(
        'session = createCanaryStagingSession({'
      ),
    'canary workspace opening must bind execute and physical-root authority, acquire pinned root before isolated workspace, verify its snapshot, and only then emit a staging session'
  );
  const workspacePortDiscardStart =
    canaryWorkspaceSessionPortAdapterSource.indexOf(
      'async function performDiscard(record)'
    );
  const workspacePortDiscardRequestIndex =
    canaryWorkspaceSessionPortAdapterSource.indexOf(
      'createExecutionWorkspaceDiscardRequest({',
      workspacePortDiscardStart
    );
  const workspacePortCleanupIndex =
    canaryWorkspaceSessionPortAdapterSource.indexOf(
      'const clean = await cleanupAcquisitions(record);',
      workspacePortDiscardRequestIndex
    );
  const workspacePortReceiptIndex =
    canaryWorkspaceSessionPortAdapterSource.indexOf(
      'createExecutionWorkspaceDiscardReceipt({',
      workspacePortCleanupIndex
    );
  assert.ok(
    workspacePortDiscardStart >= 0
      && workspacePortDiscardRequestIndex > workspacePortDiscardStart
      && workspacePortCleanupIndex > workspacePortDiscardRequestIndex
      && workspacePortReceiptIndex > workspacePortCleanupIndex
      && canaryWorkspaceSessionPortAdapterSource.includes(
        'workspaceClean = confirmedWorkspaceRollback(result);'
      )
      && canaryWorkspaceSessionPortAdapterSource.includes(
        'rootClean = confirmedRootRelease(result);'
      )
      && canaryWorkspaceSessionPortAdapterSource.includes(
        'quarantine(record);\n      throw adapterError('
      ),
    'canary workspace cleanup must prove physical rollback and root release before manufacturing a discard receipt, and quarantine every ambiguous cleanup'
  );
  assertDoesNotMatch(
    canarySourceSnapshotProviderSource,
    /require\(['"](?:fs|path|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm|reset)\s*\(/,
    'canary source snapshot provider must inspect only its pinned reader without ambient pathname, process, network, Git CLI, or Electron authority'
  );
  assertDoesNotMatch(
    canarySourceSnapshotProviderSource,
    /workspaceRootPath|workspaceRealRootPath|\.canonicalRootPath\s*\)/,
    'canary source snapshot provider must never reopen either source or staging by pathname'
  );
  const sourceSnapshotScanIndex = canarySourceSnapshotProviderSource.indexOf(
    'const tree = await scanSourceTree(reader, limits);'
  );
  const sourceSnapshotPreconditionIndex =
    canarySourceSnapshotProviderSource.indexOf(
      'await verifyPreconditions(reader, plan, tree);',
      sourceSnapshotScanIndex
    );
  const sourceSnapshotGitIndex = canarySourceSnapshotProviderSource.indexOf(
    'const gitState = await inspectGitState(reader, tree.gitEntry);',
    sourceSnapshotPreconditionIndex
  );
  const sourceSnapshotOutputIndex = canarySourceSnapshotProviderSource.indexOf(
    'return snapshotOutput(context, plan, tree, gitState);',
    sourceSnapshotGitIndex
  );
  assert.ok(
    sourceSnapshotScanIndex >= 0
      && sourceSnapshotPreconditionIndex > sourceSnapshotScanIndex
      && sourceSnapshotGitIndex > sourceSnapshotPreconditionIndex
      && sourceSnapshotOutputIndex > sourceSnapshotGitIndex
      && canarySourceSnapshotProviderSource.includes(
        "for (const methodName of ['list', 'inspectEntry', 'readFile'])"
      )
      && canarySourceSnapshotProviderSource.includes(
        'tree.entries.filter((entry) => !planned.has(entry.path))'
      ),
    'canary source snapshot must traverse the pinned reader, verify edit preconditions, reject unsafe Git state, preserve user-owned paths, and only then emit checkpoint facts'
  );
  for (const marker of [
    '.git/index.lock',
    '.git/MERGE_HEAD',
    '.git/CHERRY_PICK_HEAD',
    '.git/rebase-apply',
    '.git/rebase-merge',
    '.git/sequencer',
  ]) {
    assert.ok(
      canarySourceSnapshotProviderSource.includes(marker),
      `canary source snapshot must fail closed while ${marker} exists`
    );
  }
  assert.ok(
    canarySourceSnapshotProviderSource.includes(
      'schemaVersion: CANARY_SOURCE_CHECKPOINT_SCHEMA_VERSION'
    )
      && canarySourceSnapshotProviderSource.includes(
        'workspaceAuthorityDigest: context.workspaceRequest.workspaceAuthorityDigest'
      )
      && canarySourceSnapshotProviderSource.includes(
        'activeOtherMutatingJobs: 0'
      ),
    'canary checkpoint must bind action, physical source, isolated workspace, full source/Git/user digests, and the exclusive job owner'
  );
  assertDoesNotMatch(
    canaryStagingWriteSetContractSource,
    /require\(['"](?:fs|path|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm|rename)\s*\(/,
    'canary staging write-set contract must remain a pure canonical digest contract'
  );
  assertDoesNotMatch(
    canaryLocalStagingEditorAdapterSource,
    /require\(['"](?:child_process|worker_threads|electron|net|tls|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork)\s*\(|\b(?:npm|pnpm|yarn|bun)\b/,
    'canary local editor must not acquire process, network, install, Electron, or environment authority'
  );
  assertDoesNotMatch(
    canaryLocalStagingEditorAdapterSource,
    /(?:path\.join|fs\.[A-Za-z]+)\([^\n)]*source(?:Real)?RootPath/,
    'canary local editor must never address the authorized source root with a filesystem operation'
  );
  const localEditorRootIndex = canaryLocalStagingEditorAdapterSource.indexOf(
    'const root = captureWorkspaceRoot(context.session);'
  );
  const localEditorApplyIndex = canaryLocalStagingEditorAdapterSource.indexOf(
    'for (const operation of context.plan)',
    localEditorRootIndex
  );
  const localEditorWriteSetIndex = canaryLocalStagingEditorAdapterSource.indexOf(
    'const entries = Object.freeze(changedPaths.map',
    localEditorApplyIndex
  );
  const localEditorReceiptIndex = canaryLocalStagingEditorAdapterSource.indexOf(
    'const writeReceipt = createCanaryStagingWriteReceipt({',
    localEditorWriteSetIndex
  );
  assert.ok(
    localEditorRootIndex >= 0
      && localEditorApplyIndex > localEditorRootIndex
      && localEditorWriteSetIndex > localEditorApplyIndex
      && localEditorReceiptIndex > localEditorWriteSetIndex
      && canaryLocalStagingEditorAdapterSource.includes('O_NOFOLLOW')
      && canaryLocalStagingEditorAdapterSource.includes(
        'createProjectRootPhysicalIdentityDigest'
      )
      && canaryLocalStagingEditorAdapterSource.includes('fs.renameSync(')
      && canaryLocalStagingEditorAdapterSource.includes('sourceMutated: false')
      && canaryLocalStagingEditorAdapterSource.includes(
        "settlements.get(context.session.stagingId)"
      ),
    'canary local editor must authenticate the physical staging root, reject link following, atomically settle writes, digest final paths, preserve source isolation, and deduplicate replay'
  );
  assertDoesNotMatch(
    canaryLocalPromotionBackendSource,
    /require\(['"](?:child_process|worker_threads|electron|net|tls|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork)\s*\(|\b(?:npm|pnpm|yarn|bun)\b/,
    'canary local promotion must not acquire process, network, install, Electron, or environment authority'
  );
  assertDoesNotMatch(
    canaryLocalPromotionBackendSource,
    /\b(?:git|Git)\s+(?:reset|checkout|clean|restore)\b/,
    'canary local promotion must never use broad Git rollback commands'
  );
  const localPromotionPrepareIndex =
    canaryLocalPromotionBackendSource.indexOf('function preparePromotion');
  const localPromotionSourceFirstIndex =
    canaryLocalPromotionBackendSource.indexOf(
      'sourceFirst = inspectSourceState(',
      localPromotionPrepareIndex
    );
  const localPromotionStagingFirstIndex =
    canaryLocalPromotionBackendSource.indexOf(
      'stagingFirst = inspectStagingWriteSet(',
      localPromotionSourceFirstIndex
    );
  const localPromotionInverseIndex =
    canaryLocalPromotionBackendSource.indexOf(
      'inverse = prepareInverse(',
      localPromotionStagingFirstIndex
    );
  const localPromotionSourceSecondIndex =
    canaryLocalPromotionBackendSource.indexOf(
      'sourceSecond = inspectSourceState(',
      localPromotionInverseIndex
    );
  const localPromotionStagingSecondIndex =
    canaryLocalPromotionBackendSource.indexOf(
      'stagingSecond = inspectStagingWriteSet(',
      localPromotionSourceSecondIndex
    );
  const localPromotionWriteIndex =
    canaryLocalPromotionBackendSource.indexOf(
      'applyPromotion(record.roots.sourceRoot',
      localPromotionStagingSecondIndex
    );
  assert.ok(
    localPromotionPrepareIndex >= 0
      && localPromotionSourceFirstIndex > localPromotionPrepareIndex
      && localPromotionStagingFirstIndex > localPromotionSourceFirstIndex
      && localPromotionInverseIndex > localPromotionStagingFirstIndex
      && localPromotionSourceSecondIndex > localPromotionInverseIndex
      && localPromotionStagingSecondIndex > localPromotionSourceSecondIndex
      && localPromotionWriteIndex > localPromotionStagingSecondIndex
      && canaryLocalPromotionBackendSource.includes(
        'assertCanaryPromotionBackendRequest'
      )
      && canaryLocalPromotionBackendSource.includes(
        'createProjectRootPhysicalIdentityDigest'
      )
      && canaryLocalPromotionBackendSource.includes('O_NOFOLLOW')
      && canaryLocalPromotionBackendSource.includes('fs.renameSync(')
      && canaryLocalPromotionBackendSource.includes('restoreBaseline(')
      && canaryLocalPromotionBackendSource.includes('verifyBaseline(')
      && canaryLocalPromotionBackendSource.includes(
        'throw new CanaryPromotionBackendAmbiguousError()'
      ),
    'canary local promotion must authenticate both physical roots, double-check source and staging before the first atomic write, prepare an inverse patch first, and prove rollback or report ambiguity'
  );
  assertDoesNotMatch(
    canaryPromotionContractSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm|reset)\s*\(/,
    'canary promotion contracts must remain pure receipt validation without ambient mutation, process, network, Electron, or broad reset authority'
  );
  assert.ok(
    canaryPromotionContractSource.includes(
      "fields.get('activeOtherMutatingJobs') !== 0"
    )
      && canaryPromotionContractSource.includes(
        'normalized.checkpointDigest !== session.checkpointDigest'
      )
      && canaryPromotionContractSource.includes(
        'normalized.sourceRootIdentityDigest !== session.sourceRootIdentityDigest'
      )
      && canaryPromotionContractSource.includes(
        "sourceAfterDigest === request.sourceStateDigest"
      )
      && canaryPromotionContractSource.includes(
        "fields.get('gitIndexAfterDigest') !== request.gitIndexDigest"
      )
      && canaryPromotionContractSource.includes(
        "fields.get('userDirtyAfterDigest') !== request.userDirtyDigest"
      )
      && canaryPromotionContractSource.includes("disposition: 'reverted'"),
    'canary promotion must revalidate checkpoint, physical root, exclusivity, changed source, preserved index/dirty state, and job-specific revert evidence'
  );
  assertDoesNotMatch(
    canaryPromotionControllerSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm|reset)\s*\(/,
    'canary promotion controller must use an explicit backend without ambient filesystem, Git reset, process, network, or Electron authority'
  );
  assert.ok(
    canaryPromotionControllerSource.includes(
      "diagnosticFields.get('inversePatch') !== 'job_scoped'"
    )
      && canaryPromotionControllerSource.includes(
        "diagnosticFields.get('rejectionFrontier') !== 'pre_write_only'"
      )
      && canaryPromotionControllerSource.includes(
        "diagnosticFields.get('settlementMode') !== 'terminal_receipt'"
      )
      && canaryPromotionControllerSource.indexOf(
        'request = normalizePromotionInput(input)'
      ) < canaryPromotionControllerSource.indexOf(
        "dependencies.backend, 'promote'"
      )
      && canaryPromotionControllerSource.includes(
        'receipt = assertCanaryPromotionReceipt(value, request);'
      )
      && canaryPromotionControllerSource.includes(
        'return assertCanaryPromotionRevertReceipt(value, {'
      ),
    'canary promotion controller must validate before the effect frontier and accept only terminal promotion/revert receipts from a job-scoped inverse-patch backend'
  );
  assert.ok(
    canaryPromotionControllerSource.includes(
      'error instanceof CanaryPromotionBackendAmbiguousError'
    )
      && canaryPromotionControllerSource.includes(
        'CANARY_PROMOTION_CONTROLLER_REASONS.PROMOTION_AMBIGUOUS'
      )
      && canaryPromotionContractSource.includes(
        'CANARY_PROMOTION_BACKEND_AMBIGUOUS_CODE'
      ),
    'post-write ambiguity must remain distinct from pre-write promotion rejection so legacy fallback stays blocked'
  );
  assertDoesNotMatch(
    canaryStagingTrialExecutorSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm)\s*\(/,
    'canary staging trial executor must use explicit ports without ambient filesystem, process, network, or Electron authority'
  );
  const trialOpenIndex = canaryStagingTrialExecutorSource.indexOf(
    "dependencies.workspaceSessionPort,\n        'open'"
  );
  const trialWriteFrontierIndex = canaryStagingTrialExecutorSource.indexOf(
    'const writeFrontier = lifecycle.noteWrite({'
  );
  const trialEditIndex = canaryStagingTrialExecutorSource.indexOf(
    "dependencies.canaryEditor,\n        'execute'"
  );
  const trialFallbackIndex = canaryStagingTrialExecutorSource.indexOf(
    'const fallback = lifecycle.requestFallback({ reason: fallbackReason });'
  );
  const trialDiscardIndex = canaryStagingTrialExecutorSource.indexOf(
    "dependencies.workspaceSessionPort,\n        'discard'"
  );
  const trialCleanupIndex = canaryStagingTrialExecutorSource.indexOf(
    'const cleanup = lifecycle.confirmCleanup(discardReceipt.lifecycleReceipt);'
  );
  const trialSignalIndex = canaryStagingTrialExecutorSource.indexOf(
    'schemaVersion: CANARY_EDIT_RUNNER_FALLBACK_SIGNAL_SCHEMA_VERSION'
  );
  assert.ok(
    trialOpenIndex >= 0
      && trialWriteFrontierIndex > trialOpenIndex
      && trialEditIndex > trialWriteFrontierIndex
      && trialFallbackIndex > trialEditIndex
      && trialDiscardIndex > trialFallbackIndex
      && trialCleanupIndex > trialDiscardIndex
      && trialSignalIndex > trialCleanupIndex,
    'canary staging trial must open, mark the write frontier, settle editing, request fallback, verify discard, confirm cleanup, and only then emit fallback-ready'
  );
  assert.ok(
    canaryStagingTrialExecutorSource.includes("? 'promotion_unavailable'")
      && canaryStagingTrialExecutorSource.includes("sourceMutation') !== 'forbidden'")
      && canaryStagingTrialExecutorSource.includes("settlementMode') !== 'terminal'"),
    'canary staging trial must remain source-write forbidden and discard even a successful terminal edit until explicit promotion exists'
  );
  assertDoesNotMatch(
    canaryTransactionalStagingExecutorSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm|reset)\s*\(/,
    'transactional canary staging must use guarded ports without ambient filesystem, Git reset, process, network, or Electron authority'
  );
  const transactionalOpenIndex =
    canaryTransactionalStagingExecutorSource.indexOf(
      "dependencies.workspaceSessionPort,\n        'open'"
    );
  const transactionalEditIndex =
    canaryTransactionalStagingExecutorSource.indexOf(
      "dependencies.canaryEditor,\n        'execute'",
      transactionalOpenIndex
    );
  const transactionalRequestIndex =
    canaryTransactionalStagingExecutorSource.indexOf(
      'createCanaryPromotionRequest(promotionInput);',
      transactionalEditIndex
    );
  const transactionalPromoteIndex =
    canaryTransactionalStagingExecutorSource.indexOf(
      "dependencies.promotionController,\n        'promote'",
      transactionalRequestIndex
    );
  const transactionalSourceFrontierIndex =
    canaryTransactionalStagingExecutorSource.indexOf(
      'scope: CANARY_EDIT_MUTATION_FRONTIERS.SOURCE',
      transactionalPromoteIndex
    );
  const transactionalDiscardIndex =
    canaryTransactionalStagingExecutorSource.indexOf(
      "dependencies.workspaceSessionPort,\n        'discard'",
      transactionalSourceFrontierIndex
    );
  const transactionalCompleteIndex =
    canaryTransactionalStagingExecutorSource.indexOf(
      'const completed = lifecycle.completeCanary();',
      transactionalDiscardIndex
    );
  assert.ok(
    transactionalOpenIndex >= 0
      && transactionalEditIndex > transactionalOpenIndex
      && transactionalRequestIndex > transactionalEditIndex
      && transactionalPromoteIndex > transactionalRequestIndex
      && transactionalSourceFrontierIndex > transactionalPromoteIndex
      && transactionalDiscardIndex > transactionalSourceFrontierIndex
      && transactionalCompleteIndex > transactionalDiscardIndex,
    'transactional canary success must open isolated staging, edit, validate promotion authority, promote, record the source frontier, discard staging, and only then complete'
  );
  const stagingFallbackStart =
    canaryTransactionalStagingExecutorSource.indexOf(
      'async function settleStagingFallback'
    );
  const sourceFallbackStart =
    canaryTransactionalStagingExecutorSource.indexOf(
      'async function settleSourceFallback'
    );
  const transactionalExecuteStart =
    canaryTransactionalStagingExecutorSource.indexOf(
      'async function execute(request, grant)'
    );
  assert.ok(
    stagingFallbackStart >= 0
      && canaryTransactionalStagingExecutorSource.indexOf(
        "dependencies.workspaceSessionPort,\n        'discard'",
        stagingFallbackStart
      ) < sourceFallbackStart
      && canaryTransactionalStagingExecutorSource.indexOf(
        'lifecycle.confirmCleanup(discardReceipt.lifecycleReceipt)',
        stagingFallbackStart
      ) < sourceFallbackStart
      && canaryTransactionalStagingExecutorSource.indexOf(
        "dependencies.promotionController,\n        'revert'",
        sourceFallbackStart
      ) < transactionalExecuteStart
      && canaryTransactionalStagingExecutorSource.indexOf(
        'lifecycle.confirmCleanup(revertReceipt.lifecycleReceipt)',
        sourceFallbackStart
      ) < transactionalExecuteStart
      && canaryTransactionalStagingExecutorSource.includes(
        'CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.PROMOTION_AMBIGUOUS'
      ),
    'transactional canary fallback must prove staging discard before pre-write fallback, prove source revert after promotion, and quarantine ambiguous promotion settlement'
  );
  assertDoesNotMatch(
    canaryEditRuntimeCompositionSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm|reset)\s*\(/,
    'canary runtime composition must wire explicit ports without ambient filesystem, Git reset, process, network, or Electron authority'
  );
  const compositionModeIndex = canaryEditRuntimeCompositionSource.indexOf(
    "if (!['canary', 'on'].includes(runtimeConfig.configuredMode))"
  );
  const compositionSelectorIndex = canaryEditRuntimeCompositionSource.indexOf(
    'const rolloutSelector = createCanaryRolloutSelector({'
  );
  const compositionPromotionIndex = canaryEditRuntimeCompositionSource.indexOf(
    'const promotionController = createCanaryPromotionController({'
  );
  const compositionLedgerIndex = canaryEditRuntimeCompositionSource.indexOf(
    'const ledger = createCanaryRolloutEvidenceLedger(ledgerOptions);'
  );
  const compositionEvidenceObserverIndex =
    canaryEditRuntimeCompositionSource.indexOf(
      'createCanaryRolloutEvidenceObserverAdapter({'
    );
  const compositionExecutorIndex = canaryEditRuntimeCompositionSource.indexOf(
    'const executor = createCanaryTransactionalStagingExecutor({'
  );
  const compositionRunnerIndex = canaryEditRuntimeCompositionSource.indexOf(
    'const unobservedRunner = createCanaryEditRunner({'
  );
  assert.ok(
    compositionModeIndex >= 0
      && compositionSelectorIndex > compositionModeIndex
      && compositionLedgerIndex > compositionSelectorIndex
      && compositionEvidenceObserverIndex > compositionLedgerIndex
      && compositionPromotionIndex > compositionEvidenceObserverIndex
      && compositionExecutorIndex > compositionPromotionIndex
      && compositionRunnerIndex > compositionExecutorIndex
      && canaryEditRuntimeCompositionSource.indexOf(
        'rolloutEvidenceObserver.observeRunner(unobservedRunner)'
      ) > compositionRunnerIndex
      && canaryEditRuntimeCompositionSource.includes(
        "fields.get('canaryEditor'),\n      'kernelId'"
      )
      && canaryEditRuntimeCompositionSource.includes(
        "ledgerOptions.evidenceJournal = fields.get('evidenceJournal');"
      ),
    'canary runtime composition must stay lazy outside canary mode and compose selector, guarded promotion, transactional staging, runner, and evidence without invoking editor accessors'
  );
  assert.ok(
    canaryEditRuntimeCompositionSource.indexOf(
      'drained = await drainExecutions();'
    ) < canaryEditRuntimeCompositionSource.indexOf(
      "const closeReceipt = await callAsyncPort(clientLifecycle, 'close');"
    )
      && canaryEditRuntimeCompositionSource.includes(
        "state !== CANARY_EDIT_RUNTIME_COMPOSITION_STATES.READY"
      )
      && canaryEditRuntimeCompositionSource.includes('inFlight.add(tracked);'),
    'canary runtime shutdown must reject new work, track native executions, drain them, and only then close its client'
  );
  assertDoesNotMatch(
    canaryEditProductionRuntimeSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm|reset)\s*\(/,
    'canary production composition must receive explicit authorities without ambient filesystem, Git reset, process, network, or Electron authority'
  );
  assertDoesNotMatch(
    canaryEditTerminalObserverSource,
    /require\(['"](?:fs|child_process|worker_threads|electron|net|http|https)['"]\)|\bprocess\.env\b|\b(?:spawn|execFile|fork|writeFile|appendFile|unlink|rm|reset)\s*\(/,
    'the canary terminal observer must only consume injected callbacks and safe result data'
  );
  const terminalFallbackIndex = canaryEditTerminalObserverSource.indexOf(
    "=== dependencies.runner.authoritativeKernelId"
  );
  const terminalCompletionCallbackIndex =
    canaryEditTerminalObserverSource.indexOf(
      'dependencies.onCanaryCompleted,'
    );
  assert.ok(
    terminalFallbackIndex >= 0
      && terminalCompletionCallbackIndex > terminalFallbackIndex
      && canaryEditTerminalObserverSource.includes(
        "fields.get('mutationScope') !== 'staging'"
      )
      && canaryEditTerminalObserverSource.includes(
        "ownDataValue(executionContext, 'authorityBinding', {"
      ),
    'the terminal observer must distinguish authoritative fallback before calling completion and bind safe canary output to private job authority'
  );
  const productionFactsIndex = canaryEditProductionRuntimeSource.indexOf(
    'const admissionFactsProvider = createCanaryAdmissionFactsProvider({'
  );
  const productionRollbackAlignmentIndex =
    canaryEditProductionRuntimeSource.indexOf(
      'assertDurableRollbackAlignment('
    );
  const productionSnapshotIndex = canaryEditProductionRuntimeSource.indexOf(
    'const sourceSnapshotProvider = createCanarySourceSnapshotProvider();'
  );
  const productionWorkspaceIndex = canaryEditProductionRuntimeSource.indexOf(
    'const workspaceSessionPort = createCanaryWorkspaceSessionPortAdapter({'
  );
  const productionEditorIndex = canaryEditProductionRuntimeSource.indexOf(
    'const canaryEditor = createCanaryLocalStagingEditorAdapter({'
  );
  const productionPromotionIndex = canaryEditProductionRuntimeSource.indexOf(
    'const promotionBackend = createCanaryLocalPromotionBackend({'
  );
  const productionRuntimeIndex = canaryEditProductionRuntimeSource.indexOf(
    'const runtime = createCanaryEditRuntimeComposition(runtimeOptions);'
  );
  const productionTerminalObserverIndex =
    canaryEditProductionRuntimeSource.indexOf(
      'createCanaryEditTerminalObserverAdapter({'
    );
  assert.ok(
    productionRollbackAlignmentIndex >= 0
      && productionFactsIndex > productionRollbackAlignmentIndex
      && productionSnapshotIndex > productionFactsIndex
      && productionWorkspaceIndex > productionSnapshotIndex
      && productionEditorIndex > productionWorkspaceIndex
      && productionPromotionIndex > productionEditorIndex
      && productionRuntimeIndex > productionPromotionIndex
      && productionTerminalObserverIndex > productionRuntimeIndex
      && canaryEditProductionRuntimeSource.includes(
        "rollbackStore: fields.get('promotionRollbackStore')"
      )
      && canaryEditProductionRuntimeSource.includes(
        "manualRollbackJournal: fields.get('manualRollbackJournal')"
      )
      && canaryEditRuntimeCompositionSource.includes(
        "registrationJournal: fields.get('manualRollbackJournal')"
      )
      && canaryEditProductionRuntimeSource.includes(
        "CANARY_EDIT_PRODUCTION_KERNEL_ID = 'codex-app-server-canary'"
      ),
    'canary production must compose live admission, authenticated snapshots, isolated workspace edits, inverse-patch promotion, and the guarded runtime under one pinned kernel identity'
  );
  assert.ok(
    canaryEditRuntimeCompositionSource.includes(
      "CLIENT_NOT_READY: 'client_not_ready'"
    )
      && canaryEditRuntimeCompositionSource.indexOf(
        "readClientState(clientLifecycle) !== 'ready'"
      ) < canaryEditRuntimeCompositionSource.indexOf(
        'const rolloutSelector = createCanaryRolloutSelector({'
      ),
    'canary composition must reject an unready App Server client before constructing editing or rollout authority'
  );
}

function assertPhase9QualificationBoundary() {
  const packageConfig = JSON.parse(read('package.json'));
  const scripts = packageConfig.scripts || {};
  for (const requiredScript of [
    'test:default-on-rollout',
    'test:phase9:contracts',
    'test:phase9:security',
    'test:phase9:e2e',
    'test:phase9:evals',
    'test:phase9',
    'test:phase9:live',
    'test:phase9:qualification',
  ]) {
    assert.strictEqual(
      typeof scripts[requiredScript],
      'string',
      `phase 9 qualification must retain ${requiredScript}`
    );
  }
  assert.ok(
    scripts['test:phase9'].includes('default-on-release-gate.test.js')
      && scripts['test:phase9'].includes('test:phase9:contracts')
      && scripts['test:phase9'].includes('test:phase9:security')
      && scripts['test:phase9'].includes('test:phase9:e2e')
      && scripts['test:phase9'].includes('test:phase9:evals')
      && !scripts['test:phase9'].includes('test:phase9:live')
      && scripts['test:phase9:qualification'].includes('test:phase9')
      && scripts['test:phase9:qualification'].includes('test:phase9:live'),
    'phase 9 must keep a deterministic gate and require the separate live gate for final qualification'
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
  assert.ok(
    orchestrationIpcSource.includes(
      "registerIpcHandler('orchestration:jobs:rollback-canary', async (_, ...args) => {"
    )
      && orchestrationIpcSource.includes(
        'return publicJobResult(await rollbackCanaryJob(envelope));'
      ),
    'canary rollback IPC must accept the exact job envelope and redact authority fields before returning'
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
      'main/services/portable_isolation_helper_activation_runtime.js',
    ].includes(relativePath)) continue;
    assertDoesNotMatch(
      source,
      /\bproviderFactory\b|createAnchoredMutationBackendAdapter|require\(['"][^'"]*anchored_mutation_backend_adapter['"]\)/,
      `${relativePath} must not activate or bypass a sealed native-provider seam`
    );
  }
  assertDoesNotMatch(
    agenticToolLoopSource,
    /name:\s*['"]preview_capture['"]/,
    'the model must not receive preview capture before its isolated runtime exists'
  );
  assert.ok(
    agenticToolLoopSource.includes("BROKERED: 'brokered'")
      && agenticToolLoopSource.includes("SUSPENDED: 'suspended'")
      && agenticToolLoopSource.includes(
        'processExecutionPolicy === AGENTIC_PROCESS_EXECUTION_POLICIES.BROKERED'
      )
      && agenticToolLoopSource.includes("name: 'run_command'")
      && mainSource.includes(
        'const ASSISTANT_PROCESS_EXECUTION_POLICY = AGENTIC_PROCESS_EXECUTION_POLICIES.BROKERED;'
      ),
    'run_command must exist only behind the exact brokered policy now backed by the portable sandbox'
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
  assert.ok(
    preloadSource.includes(
      "rollbackCanaryJob: (payload) =>\n    ipcRenderer.invoke('orchestration:jobs:rollback-canary', payload)"
    ),
    'preload must expose canary rollback only through its job-locator IPC channel'
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
  const isolationRuntimeServicesSource = read(
    'main/services/execution_isolation_runtime_services.js'
  );
  const isolationJobSessionSource = read(
    'main/services/execution_isolation_job_session_service.js'
  );
  const isolationJobProcessGatewaySource = read(
    'main/services/execution_isolation_job_process_gateway.js'
  );
  const isolationAuthorizedJobExecutorSource = read(
    'main/services/execution_isolation_authorized_job_executor.js'
  );
  const agenticProcessBrokerFactorySource = read(
    'main/services/agentic_process_broker_factory.js'
  );
  const agenticGitReadBrokerFactorySource = read(
    'main/services/agentic_git_read_broker_factory.js'
  );
  const agenticMcpDiscoveryBrokerFactorySource = read(
    'main/services/agentic_mcp_discovery_broker_factory.js'
  );
  const brokerSandboxRegistrySource = read(
    'main/services/execution_isolation_broker_sandbox_registry.js'
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
  const portableIsolationHelperActivationRuntimeSource = read(
    'main/services/portable_isolation_helper_activation_runtime.js'
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
      'main/services/execution_isolation_runtime_services.js',
      isolationRuntimeServicesSource,
    ],
    [
      'main/services/execution_isolation_job_session_service.js',
      isolationJobSessionSource,
    ],
    [
      'main/services/execution_isolation_job_process_gateway.js',
      isolationJobProcessGatewaySource,
    ],
    [
      'main/services/execution_isolation_authorized_job_executor.js',
      isolationAuthorizedJobExecutorSource,
    ],
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
    `${isolationRuntimeConfigSource}\n${isolationProviderFactorySource}\n${isolationRuntimeServicesSource}\n${isolationJobSessionSource}\n${isolationJobProcessGatewaySource}\n${isolationAuthorizedJobExecutorSource}`,
    /require\(['"](?:electron|child_process|fs)['"]\)|\bipcRenderer\b|\bipcMain\b|\bspawn\s*\(|\bexecFile\s*\(|\.node\b/,
    'portable isolation selection must remain a data-only seam without process, filesystem, IPC, or addon loading authority'
  );
  assertDoesNotMatch(
    `${isolationRuntimeConfigSource}\n${isolationProviderFactorySource}\n${isolationRuntimeServicesSource}\n${isolationJobSessionSource}\n${isolationJobProcessGatewaySource}\n${isolationAuthorizedJobExecutorSource}`,
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
  assert.ok(
    isolationRuntimeServicesSource.includes('createExecutionWorkspaceRegistry')
      && isolationRuntimeServicesSource.includes('createProjectRootAuthorityRegistry')
      && isolationRuntimeServicesSource.includes('createProcessSupervisor')
      && isolationRuntimeServicesSource.includes(
        'createExecutionIsolationJobSessionService'
      )
      && isolationRuntimeServicesSource.indexOf(
        'await invokeCaptured(disposeJobSessions)'
      ) < isolationRuntimeServicesSource.indexOf(
        'await invokeCaptured(disposeProcessSupervisor)'
      )
      && isolationRuntimeServicesSource.indexOf(
        'await invokeCaptured(disposeProcessSupervisor)'
      ) < isolationRuntimeServicesSource.indexOf(
        'await invokeCaptured(disposeExecutionWorkspace)'
      )
      && isolationRuntimeServicesSource.indexOf(
        'await invokeCaptured(disposeExecutionWorkspace)'
      ) < isolationRuntimeServicesSource.indexOf(
        'await invokeCaptured(disposeProjectRootAuthority)'
      )
      && isolationRuntimeServicesSource.indexOf(
        'await invokeCaptured(disposeProjectRootAuthority)'
      ) < isolationRuntimeServicesSource.indexOf(
        'await invokeCaptured(selection.dispose)'
      ),
    'one runtime-services boundary must own job sessions plus all three facades and dispose sessions, process, workspace, root, then provider selection'
  );
  assert.ok(
    isolationJobSessionSource.indexOf('await ensureProcessProbe()')
      < isolationJobSessionSource.indexOf(
        'invokeCaptured(dependencies.rootAcquire'
      )
      && isolationJobSessionSource.indexOf(
        'invokeCaptured(dependencies.rootAcquire'
      ) < isolationJobSessionSource.indexOf(
        'invokeCaptured(dependencies.workspaceAcquire'
      )
      && isolationJobSessionSource.indexOf(
        'dependencies.workspaceRollback'
      ) < isolationJobSessionSource.indexOf(
        'dependencies.rootRelease'
      ),
    'job sessions must verify process isolation, pin the root, create a private workspace, then unwind workspace before root'
  );
  assertDoesNotMatch(
    isolationJobSessionSource,
    /createSandboxExecutionRequest|createProcessSupervisorExecRequest|dependencies\.processExec|\bcommand\b/,
    'job-session lifecycle ownership must delegate command construction and execution to the process gateway'
  );
  assert.ok(
    isolationJobProcessGatewaySource.includes('createSandboxExecutionRequest')
      && isolationJobProcessGatewaySource.includes(
        'createProcessSupervisorExecRequest'
      )
      && isolationJobProcessGatewaySource.includes('processExec:')
      && isolationJobProcessGatewaySource.includes(
        'workspaceLease: dependencies.workspaceLease'
      )
      && isolationJobProcessGatewaySource.includes(
        'rootPath: dependencies.workspaceLease.workspaceRootPath'
      )
      && isolationJobProcessGatewaySource.includes(
        'realRootPath: dependencies.workspaceLease.workspaceRealRootPath'
      ),
    'the process gateway must retarget broker-authorized requests and bind supervisor authority to the private workspace lease'
  );
  assert.ok(
    isolationJobSessionSource.indexOf(
      'const processesStopped = await releaseProcessGateway(record);'
    ) < isolationJobSessionSource.indexOf(
      '? await releaseAuthorities(record)'
    ),
    'job-session close must confirm process-tree shutdown before workspace rollback and root release'
  );
  assert.ok(
    mainSource.includes(
      "require('./main/services/execution_isolation_runtime_services')"
    )
      && mainSource.includes(
        "require('./main/services/execution_isolation_authorized_job_executor')"
      )
      && mainSource.includes(
        "require('./main/services/execution_isolation_broker_sandbox_registry')"
      )
      && mainSource.includes(
        "require('./main/services/agentic_process_broker_factory')"
      )
      && mainSource.includes(
        "require('./main/services/agentic_git_read_broker_factory')"
      )
      && mainSource.includes(
        "require('./main/services/agentic_mcp_discovery_broker_factory')"
      )
      && mainSource.includes('createExecutionIsolationRuntimeServices({')
      && mainSource.includes('executionIsolationRuntimeServices = runtimeServices;'),
    'production must compose portable backends, the job-bound executor, and its broker route through one lifecycle-owned boundary'
  );
  assert.ok(
    agenticProcessBrokerFactorySource.includes('createProjectCapabilityBroker({')
      && agenticProcessBrokerFactorySource.includes('sandboxExecutor,')
      && agenticProcessBrokerFactorySource.includes(
        'effects: [PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE]'
      )
      && agenticProcessBrokerFactorySource.includes("origin: 'agentic_tool_loop'")
      && brokerSandboxRegistrySource.includes('authorized_job_executor_only')
      && brokerSandboxRegistrySource.includes('SANDBOX_EXECUTOR_REQUIRED'),
    'agentic process execution must cross the generic broker and selection-only registry before the private executor'
  );
  assert.ok(
    agenticGitReadBrokerFactorySource.includes('createProjectCapabilityBroker({')
      && agenticGitReadBrokerFactorySource.includes(
        'kind: PROJECT_CAPABILITY_KINDS.GIT'
      )
      && agenticGitReadBrokerFactorySource.includes(
        'PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ'
      )
      && agenticGitReadBrokerFactorySource.includes(
        'PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE'
      )
      && agenticGitReadBrokerFactorySource.includes("'--no-optional-locks'")
      && agenticGitReadBrokerFactorySource.includes("'--no-pager'")
      && agenticGitReadBrokerFactorySource.includes("'core.quotepath=false'")
      && agenticGitReadBrokerFactorySource.includes("'core.fsmonitor=false'")
      && agenticGitReadBrokerFactorySource.includes("'submodule.recurse=false'")
      && agenticGitReadBrokerFactorySource.includes("origin: 'agentic_tool_loop'")
      && agenticGitReadBrokerFactorySource.includes("networkMode: 'disabled'")
      && agenticGitReadBrokerFactorySource.includes(
        "commandPolicy: 'fixed_read_only'"
      ),
    'agentic Git status must be a fixed read-only process capability through the generic broker and private executor'
  );
  assert.ok(
    agenticMcpDiscoveryBrokerFactorySource.includes('createProjectCapabilityBroker({')
      && agenticMcpDiscoveryBrokerFactorySource.includes(
        'kind: PROJECT_CAPABILITY_KINDS.MCP'
      )
      && agenticMcpDiscoveryBrokerFactorySource.includes(
        'effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ]'
      )
      && agenticMcpDiscoveryBrokerFactorySource.includes(
        "source: 'local_cache'"
      )
      && agenticMcpDiscoveryBrokerFactorySource.includes(
        'externalCallsEnabled: false'
      )
      && agenticMcpDiscoveryBrokerFactorySource.includes(
        "origin: 'agentic_tool_loop'"
      ),
    'agentic MCP discovery must be a job-bound local-cache read through the generic broker'
  );
  assertDoesNotMatch(
    agenticMcpDiscoveryBrokerFactorySource,
    /PROJECT_CAPABILITY_EFFECTS\.(?:EXTERNAL_READ|EXTERNAL_MUTATION|NETWORK_ACCESS|PROCESS_EXECUTE|SECRET_ACCESS)/,
    'cached MCP discovery must declare only the local filesystem-read effect'
  );
  assertDoesNotMatch(
    agenticMcpDiscoveryBrokerFactorySource,
    /external_mcp_(?:bridge|server_registry)_service|discoverTools|callTool|includeSecrets/,
    'cached MCP discovery must not own server registry, transport, refresh, invocation, or secret access'
  );
  for (const [label, source] of [
    ['agentic process broker factory', agenticProcessBrokerFactorySource],
    ['agentic Git read broker factory', agenticGitReadBrokerFactorySource],
    ['agentic MCP discovery broker factory', agenticMcpDiscoveryBrokerFactorySource],
    ['execution isolation broker registry', brokerSandboxRegistrySource],
  ]) {
    assertDoesNotMatch(source, /require\(['"](?:electron|child_process)['"]\)/,
      `${label} must not own Electron or host process spawning`);
    assertDoesNotMatch(source, /legacy_kernel|faber_capability_adapter/,
      `${label} must not fall back to a legacy execution path`);
  }
  assert.strictEqual(
    mainSource.includes('execution_isolation_job_session_service'),
    false,
    'main must receive job sessions only through the runtime-services boundary'
  );
  assert.strictEqual(
    mainSource.includes('execution_isolation_job_process_gateway'),
    false,
    'main must not bypass job sessions to reach the process gateway'
  );
  assertDoesNotMatch(
    mainSource,
    /jobSessionService\.(?:open|close|dispose)\s*\(/,
    'main must inject the job-session facade without operating its lifecycle directly'
  );
  assert.ok(
    coordinatorSource.includes('createAuthorizedJobExecutor')
      && coordinatorSource.includes("Object.defineProperty(context, 'sandboxExecutor'")
      && coordinatorSource.indexOf('closeAuthorizedJobExecutorConfirmed(record)')
        < coordinatorSource.indexOf('releaseBarrierConfirmed(record, reason, terminalStatus)'),
    'the coordinator must privately carry and close the job executor before broader authority release'
  );
  assert.ok(
    packageConfig.scripts['test:execution-workspace'].includes(
      'execution-isolation-job-process-gateway.test.js'
    )
      &&
    packageConfig.scripts['test:execution-workspace'].includes(
      'execution-isolation-job-session-service.test.js'
    )
      && packageConfig.scripts['test:execution-workspace'].includes(
        'test:execution-isolation-authorized-job'
      )
      && packageConfig.scripts['test:execution-workspace'].includes(
        'execution-isolation-broker-sandbox-registry.test.js'
      )
      && packageConfig.scripts['test:agentic-process-broker'].includes(
        'agentic-process-broker-factory.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:agentic-process-broker'
      )
      && typeof packageConfig.scripts['test:canary-admission-facts-provider']
        === 'string'
      && packageConfig.scripts['test:canary-admission-facts-provider'].includes(
        'canary-admission-facts-provider.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:canary-admission-facts-provider'
      )
      && typeof packageConfig.scripts['test:canary-internal-rollout-policy']
        === 'string'
      && packageConfig.scripts['test:canary-internal-rollout-policy'].includes(
        'canary-internal-rollout-policy.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:canary-internal-rollout-policy'
      )
      && packageConfig.scripts['test:agentic-git-read-broker'].includes(
        'agentic-git-read-broker-factory.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:agentic-git-read-broker'
      )
      && packageConfig.scripts['test:agentic-mcp-discovery-broker'].includes(
        'agentic-mcp-discovery-broker-factory.test.js'
      )
      && packageConfig.scripts['test:agentic-mcp-discovery-broker'].includes(
        'test:mcp-discovery-cache'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:agentic-mcp-discovery-broker'
      )
      && typeof packageConfig.scripts['test:canary-rollout-evidence-ledger']
        === 'string'
      && packageConfig.scripts['test:canary-rollout-evidence-ledger'].includes(
        'canary-rollout-evidence-ledger.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:canary-rollout-evidence-ledger'
      )
      && typeof packageConfig.scripts['test:canary-rollout-evidence-observer']
        === 'string'
      && packageConfig.scripts['test:canary-rollout-evidence-observer'].includes(
        'canary-rollout-evidence-observer-adapter.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:canary-rollout-evidence-observer'
      )
      && typeof packageConfig.scripts[
        'test:canary-transactional-staging-executor'
      ] === 'string'
      && packageConfig.scripts[
        'test:canary-transactional-staging-executor'
      ].includes('canary-transactional-staging-executor.test.js')
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:canary-transactional-staging-executor'
      )
      && typeof packageConfig.scripts['test:canary-edit-runtime-composition']
        === 'string'
      && packageConfig.scripts['test:canary-edit-runtime-composition'].includes(
        'canary-edit-runtime-composition.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:canary-edit-runtime-composition'
      )
      && typeof packageConfig.scripts['test:canary-edit-production-runtime']
        === 'string'
      && packageConfig.scripts['test:canary-edit-production-runtime'].includes(
        'canary-edit-production-runtime.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:canary-edit-production-runtime'
      )
      && typeof packageConfig.scripts['test:canary-edit-terminal-observer']
        === 'string'
      && packageConfig.scripts['test:canary-edit-terminal-observer'].includes(
        'canary-edit-terminal-observer-adapter.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:canary-edit-terminal-observer'
      )
      && packageConfig.scripts['test:canary-phase5-internal-real-sample'].includes(
        'canary-phase5-internal-real-sample.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:canary-phase5-internal-real-sample'
      )
      && packageConfig.scripts['test:codex-app-server-runtime-config'].includes(
        'codex-app-server-runtime-config.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:codex-app-server-runtime-config'
      )
      && packageConfig.scripts['test:codex-app-server-stdio-client'].includes(
        'codex-app-server-stdio-client.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:codex-app-server-stdio-client'
      )
      && packageConfig.scripts['test:codex-app-server-production-client'].includes(
        'codex-app-server-production-client-activation.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:codex-app-server-production-client'
      )
      && typeof packageConfig.scripts['test:codex-app-server-kernel-adapter'] === 'string'
      && packageConfig.scripts['test:codex-app-server-kernel-adapter'].includes(
        'codex-app-server-kernel-adapter.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:codex-app-server-kernel-adapter'
      )
      && typeof packageConfig.scripts['test:shadow-plan-semantic-comparator'] === 'string'
      && packageConfig.scripts['test:shadow-plan-semantic-comparator'].includes(
        'shadow-plan-semantic-comparator.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:shadow-plan-semantic-comparator'
      )
      && typeof packageConfig.scripts['test:shadow-plan-evidence-evaluator'] === 'string'
      && packageConfig.scripts['test:shadow-plan-evidence-evaluator'].includes(
        'shadow-plan-evidence-evaluator.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:shadow-plan-evidence-evaluator'
      )
      && typeof packageConfig.scripts['test:shadow-plan-evidence-corpus'] === 'string'
      && packageConfig.scripts['test:shadow-plan-evidence-corpus'].includes(
        'shadow-plan-evidence-corpus.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:shadow-plan-evidence-corpus'
      )
      && typeof packageConfig.scripts['test:shadow-plan-evidence-suite'] === 'string'
      && packageConfig.scripts['test:shadow-plan-evidence-suite'].includes(
        'shadow-plan-evidence-suite.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:shadow-plan-evidence-suite'
      )
      && typeof packageConfig.scripts['test:shadow-plan-evidence-observer-adapter'] === 'string'
      && packageConfig.scripts['test:shadow-plan-evidence-observer-adapter'].includes(
        'shadow-plan-evidence-observer-adapter.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:shadow-plan-evidence-observer-adapter'
      )
      && typeof packageConfig.scripts['test:shadow-plan-phase4-real-sample'] === 'string'
      && packageConfig.scripts['test:shadow-plan-phase4-real-sample'].includes(
        'shadow-plan-phase4-real-sample.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:shadow-plan-phase4-real-sample'
      )
      && typeof packageConfig.scripts['test:shadow-plan-evaluation-ledger'] === 'string'
      && packageConfig.scripts['test:shadow-plan-evaluation-ledger'].includes(
        'shadow-plan-evaluation-ledger.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:shadow-plan-evaluation-ledger'
      )
      && typeof packageConfig.scripts['test:shadow-plan-runner'] === 'string'
      && packageConfig.scripts['test:shadow-plan-runner'].includes(
        'shadow-plan-runner.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:shadow-plan-runner'
      )
      && typeof packageConfig.scripts['test:shadow-plan-runtime-composition'] === 'string'
      && packageConfig.scripts['test:shadow-plan-runtime-composition'].includes(
        'shadow-plan-runtime-composition.test.js'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'test:shadow-plan-runtime-composition'
      )
      && packageConfig.scripts['test:harness-runtime'].includes(
        'node tests/harness-router.test.js'
      ),
    'aggregate gates must run workspace, broker, fixed-read, discovery, App Server, real shadow evidence, and complete shadow runtime tests'
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
  assert.ok(
    mainSource.includes('createExecutionIsolationRuntimeConfig({ env: process.env })')
      && mainSource.includes(
        'createProductionPortableIsolationHelperActivationRuntime({'
      )
      && mainSource.includes('resourcesPath: process.resourcesPath,')
      && mainSource.includes('packaged: app.isPackaged,')
      && mainSource.includes('const selection = await runtime.start();')
      && mainSource.includes('beginPortableIsolationHelperShutdown(event);'),
    'production must compose only the packaged, runtime-configured, lifecycle-owned portable activation boundary'
  );
  assertDoesNotMatch(
    mainSource,
    /execution_isolation_provider_factory|createExecutionIsolationProviderSelection|portable_isolation_helper_(?:host_launcher|private_transport|client|provider_adapter|release_trust)/,
    'main.js must not bypass the single production portable activation boundary'
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
        "PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_STATE = 'configured'"
      )
      && portableIsolationHelperReleaseTrustSource.includes("platform: 'darwin'")
      && portableIsolationHelperReleaseTrustSource.includes("platform: 'linux'")
      && portableIsolationHelperReleaseTrustSource.includes("platform: 'win32'")
      && portableIsolationHelperReleaseTrustSource.includes("architecture: 'arm64'")
      && portableIsolationHelperReleaseTrustSource.includes(
        "'RELEASE_TRUST_UNCONFIGURED'"
      )
      && portableIsolationHelperReleaseTrustSource.includes(
        'createPortableIsolationHelperPlatformSignatureVerifier'
      ),
    'production release trust must contain only the configured public ARM64 release roots and retain fail-closed validation'
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
      )
      && packageConfig.scripts['test:execution-workspace'].includes(
        'npm run test:portable-isolation-helper-activation'
      ),
    'the aggregate execution-workspace gate must run all three physical backends, composed utility runtime, deterministic bundling, release signing, packaging, and production activation tests'
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
    mainSource,
    /portable_isolation_helper_(?:protocol|backend_contract|backend_dispatcher|execution_workspace_backend|project_root_authority_backend|process_supervisor_backend|physical_runtime|runtime_session|launcher_contract|private_transport_contract|distribution_attestation_contract|client|private_transport|distribution_verifier|provider_adapter|utility_channel|host_launcher|release_trust)|(?:createPortable(?:ExecutionWorkspace|ProjectRootAuthority|ProcessSupervisor)Backend|createPortableIsolationHelper(?:SessionController|PhysicalRuntime|RuntimeSession|BackendDispatcher|Client|PrivateTransport|DistributionTrustedKey|PlatformSignatureVerifier|ProviderAdapter|HostLauncher|ReleaseSignatureVerifier)|openPortableIsolationHelperUtilityChannel)/,
    'main.js must own only the activation boundary, never lower helper construction, trust, transport, or physical authority'
  );
  assert.ok(
    portableIsolationHelperActivationRuntimeSource.includes(
      'createPortableIsolationHelperReleaseSignatureVerifier'
    )
      && portableIsolationHelperActivationRuntimeSource.includes(
        'createPortableIsolationHelperHostLauncher'
      )
      && portableIsolationHelperActivationRuntimeSource.includes(
        'createPortableIsolationHelperPrivateTransport'
      )
      && portableIsolationHelperActivationRuntimeSource.includes(
        'createPortableIsolationHelperClient'
      )
      && portableIsolationHelperActivationRuntimeSource.includes(
        'createPortableIsolationHelperProviderAdapter'
      )
      && portableIsolationHelperActivationRuntimeSource.includes(
        'createExecutionIsolationProviderSelection'
      )
      && portableIsolationHelperActivationRuntimeSource.includes(
        'createProductionPortableIsolationHelperActivationRuntime'
      )
      && portableIsolationHelperActivationRuntimeSource.includes(
        'zeroOrphanShutdownConfirmed'
      ),
    'one production activation boundary must bind public release trust through launch, private transport, handshake, provider selection, and zero-orphan shutdown'
  );
  assertDoesNotMatch(
    portableIsolationHelperActivationRuntimeSource,
    /process\.env|PRIVATE KEY|privateKey|providerPath|executablePath|binaryPath|require\(['"]electron['"]\)/,
    'the activation boundary must not read mutable environment, hold secret keys, accept provider paths, or import Electron directly'
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
    'production must reach the process supervisor only through the runtime-services boundary'
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
  const coordinatorRootMutationStart = coordinatorSource.indexOf(
    '  function inspectRootMutation(inputBinding) {'
  );
  const coordinatorRootMutationEnd = coordinatorSource.indexOf(
    '  function diagnostics()',
    coordinatorRootMutationStart
  );
  const coordinatorRootMutationSource = coordinatorSource.slice(
    coordinatorRootMutationStart,
    coordinatorRootMutationEnd
  );
  assert.ok(
    coordinatorSource.includes(
      "ASSISTANT_EXECUTION_COORDINATOR_VERSION = 'assistant-execution-coordinator.v4'"
    )
      && coordinatorRootMutationStart >= 0
      && coordinatorRootMutationEnd > coordinatorRootMutationStart
      && coordinatorRootMutationSource.indexOf(
        'binding = immutableAuthorityBinding(inputBinding);'
      ) < coordinatorRootMutationSource.indexOf(
        'const owner = recordsByJobId.get(binding.jobId);'
      )
      && coordinatorRootMutationSource.includes(
        "owner.state !== 'executing'"
      )
      && coordinatorRootMutationSource.includes(
        'record.binding.canonicalRootPath !== binding.canonicalRootPath'
      )
      && coordinatorRootMutationSource.includes(
        'activeOtherMutatingJobs += 1;'
      )
      && coordinatorRootMutationSource.includes(
        'return rootMutationObservation(binding, 1);'
      ),
    'the coordinator must expose an exact synchronous root-mutation observation that counts concurrent execution and denies stale, unhealthy, or releasing authority'
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
    'production must reach project-root authority only through the runtime-services boundary'
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
    'production must reach workspace ownership only through the runtime-services boundary'
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
assertPhase9QualificationBoundary();
assertProjectCapabilityBoundary();
assertAssistantHarnessCompositionBoundary();
assertExecutionWorkspaceBoundary();
assertProductToolchainUsesExecutionBoundary();

console.log('architecture-boundary.test.js: ok');
