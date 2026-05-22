const CORTEX_POLICY_OWNED_BUILD_MODES = new Set(['tool_action', 'diagnostic_repair', 'design_to_code']);

function getBuildMode(buildModeRoute = null) {
  return String(buildModeRoute && buildModeRoute.mode ? buildModeRoute.mode : '').trim().toLowerCase();
}

function buildToolActionRoutePayload({
  buildModeRoute = null,
  provider = 'deterministic',
  projectState = '',
  routedExecutionMessage = '',
} = {}) {
  return {
    decision: 'execute',
    response: 'Entendi. Vou tratar isso como ação de ferramenta do projeto e preparar a execução adequada.',
    executionMessage: routedExecutionMessage,
    confidence: Math.max(Number(buildModeRoute && buildModeRoute.confidence ? buildModeRoute.confidence : 0), 0.88),
    reason: 'build_mode_tool_action',
    provider,
    capability: 'project_tools',
    mode: 'tool_action',
    executionIntent: 'tool_action',
    projectState,
    extraMeta: {
      buildMode: getBuildMode(buildModeRoute),
    },
  };
}

function buildDiagnosticRepairRoutePayload({
  buildModeRoute = null,
  provider = 'deterministic',
  projectState = '',
  routedExecutionMessage = '',
} = {}) {
  return {
    decision: 'execute',
    response: 'Entendi. Vou diagnosticar o projeto atual e preparar um reparo validável.',
    executionMessage: routedExecutionMessage,
    confidence: Math.max(Number(buildModeRoute && buildModeRoute.confidence ? buildModeRoute.confidence : 0), 0.9),
    reason: 'build_mode_diagnostic_repair',
    provider,
    capability: 'diagnose_project',
    mode: 'diagnostic_repair',
    executionIntent: 'diagnose_project',
    projectState,
    extraMeta: {
      buildMode: getBuildMode(buildModeRoute),
    },
  };
}

function buildDesignToCodeRoutePayload({
  buildModeRoute = null,
  provider = 'deterministic',
  projectState = '',
  routedExecutionMessage = '',
  signals = {},
} = {}) {
  const routeExecutionIntent =
    (buildModeRoute && buildModeRoute.executionIntent) || (signals && signals.hasApplicationFiles ? 'edit_project' : 'init_project');
  return {
    decision: 'execute',
    response:
      routeExecutionIntent === 'edit_project'
        ? 'Entendi. Vou converter a referência visual em uma alteração incremental no projeto atual.'
        : 'Entendi. Vou converter a referência visual em uma base inicial de projeto.',
    executionMessage: routedExecutionMessage,
    confidence: Math.max(Number(buildModeRoute && buildModeRoute.confidence ? buildModeRoute.confidence : 0), 0.88),
    reason: 'build_mode_design_to_code',
    provider,
    capability: routeExecutionIntent === 'edit_project' ? 'edit_project' : 'create_project',
    mode: 'design_to_code',
    executionIntent: routeExecutionIntent,
    projectState,
    extraMeta: {
      buildMode: getBuildMode(buildModeRoute),
    },
  };
}

const CORTEX_BUILD_MODE_HANDLERS = [
  {
    mode: 'tool_action',
    canHandle: ({ buildModeRoute } = {}) => getBuildMode(buildModeRoute) === 'tool_action',
    buildRoutePayload: buildToolActionRoutePayload,
  },
  {
    mode: 'diagnostic_repair',
    canHandle: ({ buildModeRoute } = {}) => getBuildMode(buildModeRoute) === 'diagnostic_repair',
    buildRoutePayload: buildDiagnosticRepairRoutePayload,
  },
  {
    mode: 'design_to_code',
    canHandle: ({ buildModeRoute } = {}) => getBuildMode(buildModeRoute) === 'design_to_code',
    buildRoutePayload: buildDesignToCodeRoutePayload,
  },
];

function hasCortexPolicyOwnedBuildMode(mode = '') {
  return CORTEX_POLICY_OWNED_BUILD_MODES.has(String(mode || '').trim().toLowerCase());
}

function resolveCortexBuildModeRoutePayload(context = {}) {
  const handler = CORTEX_BUILD_MODE_HANDLERS.find((candidate) => candidate.canHandle(context));
  return handler ? handler.buildRoutePayload(context) : null;
}

module.exports = {
  CORTEX_BUILD_MODE_HANDLERS,
  buildDesignToCodeRoutePayload,
  buildDiagnosticRepairRoutePayload,
  buildToolActionRoutePayload,
  hasCortexPolicyOwnedBuildMode,
  resolveCortexBuildModeRoutePayload,
};
