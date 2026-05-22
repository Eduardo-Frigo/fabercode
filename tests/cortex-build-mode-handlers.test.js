const assert = require('assert');

const {
  CORTEX_BUILD_MODE_HANDLERS,
  hasCortexPolicyOwnedBuildMode,
  resolveCortexBuildModeRoutePayload,
} = require('../cortex/orchestration/cortex_build_mode_handlers_service');

function run() {
  assert.deepStrictEqual(
    CORTEX_BUILD_MODE_HANDLERS.map((handler) => handler.mode),
    ['tool_action', 'diagnostic_repair', 'design_to_code']
  );
  assert.strictEqual(hasCortexPolicyOwnedBuildMode('tool_action'), true);
  assert.strictEqual(hasCortexPolicyOwnedBuildMode('adaptive_blueprint'), false);

  const toolAction = resolveCortexBuildModeRoutePayload({
    buildModeRoute: { mode: 'tool_action', confidence: 0.7 },
    routedExecutionMessage: 'rodar npm run build',
    projectState: 'existing_project',
  });
  assert.strictEqual(toolAction.reason, 'build_mode_tool_action');
  assert.strictEqual(toolAction.capability, 'project_tools');
  assert.strictEqual(toolAction.executionIntent, 'tool_action');
  assert.strictEqual(toolAction.confidence, 0.88);

  const diagnostic = resolveCortexBuildModeRoutePayload({
    buildModeRoute: { mode: 'diagnostic_repair', confidence: 0.81 },
    routedExecutionMessage: 'diagnosticar build',
    projectState: 'existing_project',
  });
  assert.strictEqual(diagnostic.reason, 'build_mode_diagnostic_repair');
  assert.strictEqual(diagnostic.capability, 'diagnose_project');
  assert.strictEqual(diagnostic.executionIntent, 'diagnose_project');

  const designToCode = resolveCortexBuildModeRoutePayload({
    buildModeRoute: { mode: 'design_to_code', confidence: 0.8 },
    routedExecutionMessage: 'converter mockup',
    projectState: 'empty_project',
    signals: { hasApplicationFiles: false },
  });
  assert.strictEqual(designToCode.reason, 'build_mode_design_to_code');
  assert.strictEqual(designToCode.capability, 'create_project');
  assert.strictEqual(designToCode.executionIntent, 'init_project');

  const designEdit = resolveCortexBuildModeRoutePayload({
    buildModeRoute: { mode: 'design_to_code', confidence: 0.8 },
    routedExecutionMessage: 'converter mockup',
    projectState: 'existing_project',
    signals: { hasApplicationFiles: true },
  });
  assert.strictEqual(designEdit.capability, 'edit_project');
  assert.strictEqual(designEdit.executionIntent, 'edit_project');

  assert.strictEqual(resolveCortexBuildModeRoutePayload({ buildModeRoute: { mode: 'adaptive_blueprint' } }), null);

  console.log('cortex-build-mode-handlers.test.js: ok');
}

run();
