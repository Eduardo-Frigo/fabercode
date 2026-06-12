const {
  buildCapabilityResult,
  normalizeCapabilityId,
  normalizeProjectSession,
} = require('./capability_result');
const {
  buildProjectSession,
  validateProjectSessionScope,
} = require('./project_session_contract');
const { evaluateAiTrustBoundary } = require('../security/ai_trust_boundary');

function normalizeAdapter(adapter = {}) {
  const capability = normalizeCapabilityId(adapter.capability);
  const actions = Array.isArray(adapter.actions)
    ? adapter.actions.map(normalizeCapabilityId).filter(Boolean)
    : [];
  return {
    ...adapter,
    capability,
    actions,
    permission: String(adapter.permission || 'read').trim() || 'read',
    description: String(adapter.description || '').trim(),
    inputSchema: adapter.inputSchema || { type: 'object' },
  };
}

function createCapabilityGateway(dependencies = {}) {
  const {
    adapters = [],
    now = () => new Date().toISOString(),
    sessionFactory = buildProjectSession,
  } = dependencies;

  const adaptersByCapability = new Map();
  for (const adapter of adapters.map(normalizeAdapter)) {
    if (!adapter.capability) {
      throw new Error('Capability adapter sem id.');
    }
    if (adaptersByCapability.has(adapter.capability)) {
      throw new Error(`Capability adapter duplicado: ${adapter.capability}`);
    }
    if (typeof adapter.handle !== 'function') {
      throw new Error(`Capability adapter sem handler: ${adapter.capability}`);
    }
    adaptersByCapability.set(adapter.capability, adapter);
  }

  function listCapabilities() {
    return Array.from(adaptersByCapability.values()).map((adapter) => ({
      capability: adapter.capability,
      actions: adapter.actions,
      permission: adapter.permission,
      description: adapter.description,
      inputSchema: adapter.inputSchema,
      mcpToolName: `faber.${adapter.capability}`,
    }));
  }

  async function executeCapability(request = {}) {
    const capability = normalizeCapabilityId(request.capability);
    const action = normalizeCapabilityId(request.action);
    const adapter = adaptersByCapability.get(capability);
    const startedAt = now();
    const projectSession = normalizeProjectSession(
      request.projectSession && request.projectSession.rootPath
        ? sessionFactory(request.projectSession)
        : request.projectSession || {}
    );

    if (!adapter) {
      return buildCapabilityResult({
        ok: false,
        status: 'blocked',
        capability,
        action,
        projectSession,
        startedAt,
        finishedAt: now(),
        source: 'capability_gateway',
        message: `Capability não registrada: ${capability || '<vazia>'}.`,
        errors: ['capability_not_registered'],
      });
    }

    if (!action || (adapter.actions.length && !adapter.actions.includes(action))) {
      return buildCapabilityResult({
        ok: false,
        status: 'blocked',
        capability,
        action,
        projectSession,
        startedAt,
        finishedAt: now(),
        source: 'capability_gateway',
        message: `Ação não permitida para ${capability}: ${action || '<vazia>'}.`,
        errors: ['capability_action_not_allowed'],
      });
    }

    const scope = validateProjectSessionScope(projectSession);
    if (!scope.ok) {
      return buildCapabilityResult({
        ok: false,
        status: 'blocked',
        capability,
        action,
        projectSession,
        startedAt,
        finishedAt: now(),
        source: 'capability_gateway',
        message: scope.message,
        errors: ['project_session_scope_invalid'],
      });
    }

    const aiTrustBoundary = evaluateAiTrustBoundary({
      requestedCapability: capability,
      requestedAction: action,
      explicitBoundary: request.aiTrustBoundary || (request.payload && request.payload.aiTrustBoundary) || null,
      sources: request.aiTrustBoundarySources || [],
    });
    if (aiTrustBoundary.blocked) {
      return buildCapabilityResult({
        ok: false,
        status: 'blocked',
        capability,
        action,
        projectSession,
        startedAt,
        finishedAt: now(),
        source: 'capability_gateway',
        message: aiTrustBoundary.message || 'Prompt injection bloqueado antes da execucao de capability.',
        errors: ['prompt_injection_risk_blocked'],
        warnings: aiTrustBoundary.findings.map((finding) => ({
          type: 'prompt_injection',
          sourceType: finding.sourceType,
          severity: finding.severity,
          categories: finding.categories,
        })),
      });
    }

    try {
      const adapterResult = await adapter.handle({
        action,
        payload: request.payload || {},
        projectSession,
        startedAt,
      });
      return buildCapabilityResult({
        capability,
        action,
        projectSession,
        startedAt,
        finishedAt: now(),
        source: adapterResult && adapterResult.source ? adapterResult.source : adapter.capability,
        ok: Boolean(adapterResult && adapterResult.ok),
        status: adapterResult && adapterResult.status ? adapterResult.status : '',
        message: adapterResult && adapterResult.message ? adapterResult.message : '',
        artifacts: adapterResult && adapterResult.artifacts,
        logs: adapterResult && adapterResult.logs,
        warnings: adapterResult && adapterResult.warnings,
        errors: adapterResult && adapterResult.errors,
        data: adapterResult && adapterResult.data,
        result: adapterResult && adapterResult.result,
      });
    } catch (error) {
      return buildCapabilityResult({
        ok: false,
        status: 'failed',
        capability,
        action,
        projectSession,
        startedAt,
        finishedAt: now(),
        source: adapter.capability,
        message: error && error.message ? error.message : 'Falha desconhecida na capability.',
        errors: [error && error.message ? error.message : 'capability_error'],
      });
    }
  }

  return {
    executeCapability,
    listCapabilities,
  };
}

module.exports = {
  createCapabilityGateway,
};
