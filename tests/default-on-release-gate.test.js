'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const packageConfig = require('../package.json');

const scripts = packageConfig && packageConfig.scripts;
const liveCorpusSource = fs.readFileSync(
  path.join(__dirname, 'application-creation-live-corpus.electron.js'),
  'utf8'
);

function script(name) {
  assert.ok(scripts && typeof scripts[name] === 'string', `missing script: ${name}`);
  return scripts[name];
}

function assertInOrder(source, fragments, message) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor + 1);
    assert.ok(next > cursor, `${message}: missing or out of order: ${fragment}`);
    cursor = next;
  }
}

assertInOrder(
  script('test:default-on-rollout'),
  [
    'node tests/default-on-rollout-policy.test.js',
    'node tests/default-on-rollout-runtime.test.js',
    'node tests/default-on-canary-rollout-policy-adapter.test.js',
    'node tests/default-on-rollout-safety-interlock.test.js',
    'node tests/default-on-harness-router.test.js',
    'node tests/default-on-production-wiring.test.js',
    'node tests/assistant-runtime-wiring.test.js',
  ],
  'the default-on contract gate must cover policy, runtime, safety, routing, and production composition'
);

assertInOrder(
  script('test:phase9:contracts'),
  [
    'node tests/harness-contracts.test.js',
    'node tests/agent-kernel.test.js',
    'npm run test:preload-api-contract',
    'npm run test:ipc',
    'npm run test:persistence-contracts',
    'npm run test:default-on-rollout',
  ],
  'phase 9 contract qualification must retain public, IPC, store, kernel, and rollout conformance'
);

assertInOrder(
  script('test:phase9:security'),
  [
    'npm run test:security',
    'npm run test:ai-trust-boundary',
    'npm run test:capability-broker',
    'npm run test:phase8',
    'npm run test:process-supervisor',
    'npm run test:canary-transactional-staging-executor',
    'node tests/default-on-rollout-safety-interlock.test.js',
  ],
  'phase 9 security qualification must cover roots, secrets, commands, egress, approvals, cancellation, and rollback'
);

assertInOrder(
  script('test:phase9:e2e'),
  [
    'npm run test:phase6',
    'npm run test:project-preview-runtime',
    'npm run test:git-service',
    'npm run test:agentic-browser-session',
  ],
  'phase 9 deterministic E2E qualification must cover map-to-git, preview, Git, and browser flows'
);

assertInOrder(
  script('test:phase9:evals'),
  [
    'npm run test:shadow-plan-evidence-corpus',
    'npm run test:shadow-plan-phase4-real-sample',
    'npm run test:canary-phase5-internal-real-sample',
    'npm run test:application-creation-corpus',
  ],
  'phase 9 eval qualification must use semantic evidence and observable application outcomes'
);

const deterministicGate = script('test:phase9');
assertInOrder(
  deterministicGate,
  [
    'node tests/default-on-release-gate.test.js',
    'npm run test:phase9:contracts',
    'npm run test:phase9:security',
    'npm run test:phase9:e2e',
    'npm run test:phase9:evals',
  ],
  'the deterministic phase 9 gate must execute every mandatory offline category'
);
assert.strictEqual(
  deterministicGate.includes('test:phase9:live'),
  false,
  'the deterministic gate must stay runnable without provider credentials or network'
);

assertInOrder(
  script('test:phase9:live'),
  [
    'npm run smoke:agentic-browser-session',
    'npm run test:real-openai-prompt-injection',
    'npm run smoke:application-creation-live-corpus',
  ],
  'the live gate must cover Electron browser behavior, provider prompt injection, and the real application corpus'
);

assertInOrder(
  script('test:phase9:qualification'),
  [
    'npm run test:phase9',
    'npm run test:phase9:live',
  ],
  'default-on qualification must require both deterministic and live gates'
);

assert.strictEqual(
  script('smoke:application-creation-live-corpus'),
  'electron tests/application-creation-live-corpus.electron.js',
  'the live corpus gate must not retain workspaces or inject unauthorized arguments'
);

assertInOrder(
  liveCorpusSource,
  [
    'const reportRoot = args.reportPath',
    ": fs.mkdtempSync(path.join(os.tmpdir(), 'faber-live-corpus-report-'));",
    'const reportPath = args.reportPath',
    ": path.join(reportRoot, 'report.json');",
    'const reportParent = path.dirname(reportPath);',
    'policy.assertTemporaryWorkspace(reportParent);',
  ],
  'the live corpus report must live under a dedicated authorized temporary child directory'
);

assertInOrder(
  liveCorpusSource,
  [
    "app.on('window-all-closed', keepLiveCorpusProcessAlive);",
    'await app.whenReady();',
    'const buildReport = (completedAt = null) => ({',
    'results.push(outcome.result);',
    'writeJson(reportPath, buildReport());',
    'const report = buildReport(new Date().toISOString());',
    "app.removeListener('window-all-closed', keepLiveCorpusProcessAlive);",
    'app.exit(process.exitCode || 0);',
  ],
  'the live corpus must survive preview-window closure and checkpoint every completed scenario before final settlement'
);

assertInOrder(
  liveCorpusSource,
  [
    'const repairProducedFiles = Array.isArray(repair.modifiedFiles)',
    'if (!repairProducedFiles) break;',
    'if (verification.ready) {',
    'const criteriaMet = Boolean(',
    'installResult.ok',
    '&& verification.ready',
    '&& dirtyPreserved',
    '&& executionStarted',
  ],
  'live qualification must repair partial artifacts and trust verified observable outcomes over model narration'
);
assert.strictEqual(
  /const criteriaMet = Boolean\(\s*generation\.ok/.test(liveCorpusSource),
  false,
  'a model-reported status must not override successful independent verification'
);

console.log('default-on-release-gate.test.js: ok');
