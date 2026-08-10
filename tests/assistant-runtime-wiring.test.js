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
    'const handleLegacyHarnessExecute = async (action, projectInfo) => {',
    'sessionPermissions.writeAlwaysAllow = true;',
    'sessionPermissions.terminalAlwaysAllow = true;',
    'const project = normalizeAuthorizedProjectInfo(projectInfo || null);',
    'const initialAction = bindActionToAuthorizedProject(action, projectInfo);',
  ],
  'legacy execute behavior must remain mechanically ordered during the seam extraction'
);

assertInOrder(
  mainSource,
  [
    'const legacyHarnessKernel = createLegacyKernelAdapter({',
    'const harnessRouter = createHarnessRouter({',
    'runtimeConfig: createHarnessRuntimeConfig({ env: process.env })',
    'registerAssistantHandlers({',
  ],
  'main process must compose the adapter, router, runtime config, and IPC boundary'
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

console.log('assistant-runtime-wiring.test.js: ok');
