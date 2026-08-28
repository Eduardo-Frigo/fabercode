const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mainSource = fs.readFileSync(
  path.join(__dirname, '..', 'main.js'),
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

for (const dependency of [
  "require('./main/agent_runtime/default_on_rollout_policy')",
  "require('./main/agent_runtime/default_on_rollout_safety_interlock')",
  "require('./main/runtime/default_on_rollout_runtime_config')",
  "require('./main/services/default_on_rollout_facts_service')",
  "require('./main/services/default_on_canary_rollout_policy_adapter')",
]) {
  assert.ok(
    mainSource.includes(dependency),
    `default-on production wiring is missing: ${dependency}`
  );
}

const initializeSource = extractFunctionDeclaration(
  mainSource,
  'initializeCanaryEditProductionRuntime'
);
assertInOrder(
  initializeSource,
  [
    "const runtimeModeEligible = ['canary', 'on'].includes(",
    "const defaultOnPolicyReady = runtimeConfig.configuredMode !== 'on'",
    'defaultOnCanaryRolloutPolicy',
    "const defaultOnSafetyReady = runtimeConfig.configuredMode !== 'on'",
    'defaultOnSafetyInterlock',
    'if (!runtimeModeEligible',
    '|| !defaultOnPolicyReady',
    '|| !defaultOnSafetyReady',
    '|| !runtimeServices || !isolationReady)',
    "const rolloutPolicy = runtimeConfig.configuredMode === 'on'",
    '? defaultOnCanaryRolloutPolicy',
    ': createCanaryInternalRolloutPolicy({',
    'createCodexAppServerProductionClientActivation({',
  ],
  'MODE=on must require a ready main-owned rollout adapter before App Server startup'
);

const startupStart = mainSource.indexOf(
  'const harnessRuntimeConfig = createHarnessRuntimeConfig({ env: process.env });'
);
const startupEnd = mainSource.indexOf(
  'const assistantRuntime = createAssistantRuntimeFacade({',
  startupStart
);
assert.ok(startupStart >= 0 && startupEnd > startupStart, 'missing harness startup wiring');
const startupSource = mainSource.slice(startupStart, startupEnd);

assertInOrder(
  startupSource,
  [
    'const defaultOnRolloutRuntimeConfig = createDefaultOnRolloutRuntimeConfig({',
    'env: process.env,',
    'const defaultOnRolloutPolicy = createDefaultOnRolloutPolicy({',
    'stableReleaseVersions: defaultOnRolloutRuntimeConfig.stableReleaseVersions,',
    'const defaultOnRolloutFactsService = createDefaultOnRolloutFactsService({',
    'runtimeConfig: defaultOnRolloutRuntimeConfig,',
    'authorizeProjectBinding: (projectId, rootPath) => (',
    'getProjectAccess().authorizeProjectBinding(projectId, rootPath)',
    'const defaultOnRolloutSafetyInterlock = createDefaultOnRolloutSafetyInterlock({',
    'cancelJob(input) {',
    'const jobId = readAgenticDeleteDataProperty(input, \'jobId\');',
    'const receipt = assistantExecutionCoordinator.revokeJob(',
    'abortActiveJobExecution(jobId, \'default_on_rollout_safety_trip\');',
    'return receipt;',
    'closeBrowserJob(input) {',
    'agenticBrowserSessionServiceInstance.closeJob(input)',
    'closeRuntime() {',
    'const runtime = canaryEditProductionRuntimeInstance;',
    'canaryEditProductionRuntimeInstance = null;',
    'return runtime.close();',
    'audit: appendAuditEvent,',
    'const defaultOnRolloutDiagnostics = defaultOnRolloutPolicy.diagnostics();',
    "const defaultOnCanaryRolloutPolicy = harnessRuntimeConfig.configuredMode === 'on'",
    '&& defaultOnRolloutRuntimeConfig.valid',
    '&& defaultOnRolloutDiagnostics.stabilityGateSatisfied',
    '? createDefaultOnCanaryRolloutPolicyAdapter({',
    'runtimeConfig: harnessRuntimeConfig,',
    'rolloutPolicy: defaultOnRolloutPolicy,',
    'authorizeProjectBinding: (projectId, rootPath) => (',
    'getProjectAccess().authorizeProjectBinding(projectId, rootPath)',
    'defaultOnCanaryRolloutPolicy,',
    'defaultOnSafetyInterlock: defaultOnRolloutSafetyInterlock,',
    'harnessRouter = createHarnessRouter({',
    'canaryEditRunner: canaryRuntimeSelection.canaryEditRunner,',
    'defaultOnRolloutPolicy,',
    'defaultOnSafetyInterlock: defaultOnRolloutSafetyInterlock,',
    'persistDefaultOnRolloutSnapshot: (jobId, snapshot) => (',
    "setJobCheckpoint(jobId, 'harness_rollout', snapshot)",
    'resolveDefaultOnRolloutFacts: (identity) => (',
    'defaultOnRolloutFactsService.resolve(identity)',
  ],
  'production must build and persist the immutable job rollout decision before V2 routing'
);

assertInOrder(
  initializeSource,
  [
    'onCanaryFailed: (observation) => {',
    "const reason = readAgenticDeleteDataProperty(observation, 'reason');",
    "const safetyEvent = runtimeConfig.configuredMode === 'on'",
    '? classifyDefaultOnCanarySafetyEvent(reason)',
    'const evidenceDigest = `sha256:${crypto.createHash(\'sha256\')',
    "version: 'default-on-canary-safety-evidence.v1'",
    'const tripPromise = defaultOnSafetyInterlock.trip(Object.freeze({',
    'event: safetyEvent,',
    'sourceJobId: jobId,',
    'evidenceDigest,',
    'Reflect.apply(Promise.prototype.then, tripPromise, [() => {}, () => {}]);',
    'const terminalResult = markJobFailed(',
  ],
  'confirmed default-on safety failures must trip the main-owned interlock without blocking terminal observation'
);

console.log('default-on-production-wiring.test.js: ok');
