'use strict';

const assert = require('assert');

const {
  classifyCapabilityEffect,
} = require('../main/capabilities/capability_effect_classifier');

const {
  PROJECT_CAPABILITY_CONTRACT_VERSION,
  PROJECT_CAPABILITY_DECISIONS,
  PROJECT_CAPABILITY_EFFECTS,
  PROJECT_CAPABILITY_STANDARD_ERROR_CODES,
  PROJECT_CAPABILITY_KINDS,
  PROJECT_CAPABILITY_INSPECTION_SCHEMA_VERSION,
  PROJECT_CAPABILITY_PRINCIPAL_KINDS,
  PROJECT_CAPABILITY_REQUEST_SCHEMA_VERSION,
  PROJECT_CAPABILITY_RESULT_SCHEMA_VERSION,
  PROJECT_CAPABILITY_RESULT_STATUSES,
  assertProjectCapabilityRequest,
  createProjectCapabilityDescriptor,
  createProjectCapabilityRequest,
  createProjectCapabilityResult,
  isProjectCapabilityDescriptor,
  isProjectCapabilityInspection,
  isProjectCapabilityRequest,
  isProjectCapabilityResult,
} = require('../main/capabilities/project_capability_contracts');

assert.strictEqual(PROJECT_CAPABILITY_CONTRACT_VERSION, 'project-capability.v1');
assert.strictEqual(PROJECT_CAPABILITY_STANDARD_ERROR_CODES.APPROVAL_INVALID, 'APPROVAL_INVALID');
assert.strictEqual(
  PROJECT_CAPABILITY_STANDARD_ERROR_CODES.SANDBOX_GUARANTEES_INSUFFICIENT,
  'SANDBOX_GUARANTEES_INSUFFICIENT'
);

const agentPrincipal = {
  kind: PROJECT_CAPABILITY_PRINCIPAL_KINDS.AGENT,
  kernelId: 'harness-v2',
};
const projectSession = {
  sessionId: 'session-1',
  projectId: 'project-1',
  rootPath: '/workspace/project',
  realRootPath: '/private/workspace/project',
  cwd: '/workspace/project/packages/app',
  cwdRealPath: '/private/workspace/project/packages/app',
  jobId: 'job-1',
};
const payload = { command: 'npm test' };
const request = createProjectCapabilityRequest({
  requestId: 'request-1',
  principal: agentPrincipal,
  projectSession,
  capability: 'project_terminal',
  action: 'run_command',
  payload,
  context: { origin: 'agentic_tool_loop', correlationId: 'job-1' },
});

assert.strictEqual(request.schemaVersion, PROJECT_CAPABILITY_REQUEST_SCHEMA_VERSION);
assert.strictEqual(request.capability, 'project_terminal');
assert.strictEqual(request.action, 'run_command');
assert.strictEqual(request.principal.kind, 'agent');
assert.strictEqual(request.principal.kernelId, 'harness-v2');
assert.strictEqual(request.projectSession.sessionId, 'session-1');
assert.strictEqual(request.projectSession.realRootPath, '/private/workspace/project');
assert.strictEqual(request.payload, payload);
assert.strictEqual(Object.isFrozen(request), true);
assert.strictEqual(Object.isFrozen(request.principal), true);
assert.strictEqual(Object.isFrozen(request.projectSession), true);
assert.strictEqual(isProjectCapabilityRequest(request), true);
assert.strictEqual(assertProjectCapabilityRequest(request), request);
assert.strictEqual(Object.hasOwn(request, 'descriptor'), false);

const descriptor = createProjectCapabilityDescriptor({
  capability: 'project_terminal',
  action: 'run_command',
  version: 'project-terminal.run-command.v1',
  kind: PROJECT_CAPABILITY_KINDS.PROCESS,
  effects: [
    PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE,
    PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_WRITE,
    PROJECT_CAPABILITY_EFFECTS.NETWORK_ACCESS,
    PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE,
  ],
  requiresSandbox: true,
  requiredSandboxFeatures: ['filesystem_scope'],
  createSandboxExecutionSpec(input) {
    return { command: { kind: 'shell', text: input.command } };
  },
});
assert.deepStrictEqual(descriptor.effects, ['process_execute', 'filesystem_write', 'network_access']);
assert.strictEqual(Object.isFrozen(descriptor), true);
assert.strictEqual(Object.isFrozen(descriptor.effects), true);
assert.strictEqual(isProjectCapabilityDescriptor(descriptor), true);
assert.strictEqual(typeof descriptor.createSandboxExecutionSpec, 'function');
assert.deepStrictEqual(descriptor.requiredSandboxFeatures, ['filesystem_scope']);
const classification = classifyCapabilityEffect({ request, descriptor });
assert.strictEqual(classification.descriptorVersion, 'project-terminal.run-command.v1');
assert.deepStrictEqual(classification.effects, descriptor.effects);
assert.strictEqual(classification.canonicalPayload.command, 'npm test');
assert.throws(() => createProjectCapabilityDescriptor({
  capability: 'project_terminal',
  action: 'run_command',
  kind: PROJECT_CAPABILITY_KINDS.PROCESS,
  effects: [PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE],
}), /descriptor/);
assert.throws(() => createProjectCapabilityDescriptor({
  capability: 'filesystem.write',
  action: 'write',
  version: 'filesystem.write.v1',
  kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
  effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_WRITE],
}), /execution adapter/);
assert.throws(() => createProjectCapabilityDescriptor({
  capability: 'process.run',
  action: 'run',
  version: 'process.run.v1',
  kind: PROJECT_CAPABILITY_KINDS.PROCESS,
  effects: [PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE],
}), /sandbox plan/);

const userRequest = createProjectCapabilityRequest({
  requestId: 'request-user',
  principal: { kind: PROJECT_CAPABILITY_PRINCIPAL_KINDS.USER_UI, actorId: 'renderer-main-window' },
  projectSession,
  capability: 'git',
  action: 'discard',
  payload: { path: 'src/app.js' },
  context: { origin: 'git_panel', directUserAction: true },
});
assert.strictEqual(userRequest.context.directUserAction, true);

const systemRequest = createProjectCapabilityRequest({
  requestId: 'request-system',
  principal: { kind: PROJECT_CAPABILITY_PRINCIPAL_KINDS.SYSTEM, actorId: 'preview-runtime' },
  projectSession,
  capability: 'preview',
  action: 'capture',
  context: { origin: 'preview_service' },
});
assert.strictEqual(isProjectCapabilityRequest(systemRequest), true);

assert.throws(() => createProjectCapabilityRequest({
  requestId: 'missing-kernel',
  principal: { kind: 'agent' },
  projectSession,
  capability: 'file',
  action: 'write',
  context: { origin: 'test' },
}), /principal/);
assert.throws(() => createProjectCapabilityRequest({
  requestId: 'missing-session-id',
  principal: agentPrincipal,
  projectSession: { ...projectSession, sessionId: '' },
  capability: 'file',
  action: 'write',
  context: { origin: 'test' },
}), /session/);
assert.throws(() => createProjectCapabilityRequest({
  requestId: 'missing-real-root',
  principal: agentPrincipal,
  projectSession: { ...projectSession, realRootPath: '' },
  capability: 'file',
  action: 'write',
  context: { origin: 'test' },
}), /session/);
assert.throws(() => createProjectCapabilityRequest({
  requestId: 'forged-click',
  principal: agentPrincipal,
  projectSession,
  capability: 'git',
  action: 'reset',
  context: { origin: 'agentic_tool_loop', directUserAction: true },
}), /context/);
assert.strictEqual(isProjectCapabilityRequest({ ...request, schemaVersion: 'future.v2' }), false);
assert.strictEqual(isProjectCapabilityRequest({ ...request, payload: 'npm test' }), false);
assert.strictEqual(isProjectCapabilityRequest({ ...request, capability: '' }), false);
assert.strictEqual(isProjectCapabilityRequest({
  ...request,
  descriptor: { effects: ['destructive'], risk: 'low' },
}), false);

const allowed = createProjectCapabilityResult({
  requestId: request.requestId,
  capability: request.capability,
  action: request.action,
  decision: PROJECT_CAPABILITY_DECISIONS.ALLOW,
  status: PROJECT_CAPABILITY_RESULT_STATUSES.COMPLETED,
  output: { exitCode: 0 },
  policy: { policyId: 'autonomy-inside-project.v1' },
});
assert.strictEqual(allowed.schemaVersion, PROJECT_CAPABILITY_RESULT_SCHEMA_VERSION);
assert.strictEqual(isProjectCapabilityResult(allowed), true);

const approvalRequired = createProjectCapabilityResult({
  requestId: request.requestId,
  capability: request.capability,
  action: request.action,
  decision: PROJECT_CAPABILITY_DECISIONS.REQUIRE_APPROVAL,
  status: PROJECT_CAPABILITY_RESULT_STATUSES.APPROVAL_REQUIRED,
  approval: { scope: 'network', grantId: null },
});
assert.strictEqual(isProjectCapabilityResult(approvalRequired), true);

const denied = createProjectCapabilityResult({
  requestId: request.requestId,
  capability: request.capability,
  action: request.action,
  decision: PROJECT_CAPABILITY_DECISIONS.DENY,
  status: PROJECT_CAPABILITY_RESULT_STATUSES.DENIED,
  error: { code: 'CAPABILITY_NOT_ALLOWED', message: 'Capability denied.' },
});
assert.strictEqual(isProjectCapabilityResult(denied), true);

assert.strictEqual(isProjectCapabilityInspection({
  schemaVersion: PROJECT_CAPABILITY_INSPECTION_SCHEMA_VERSION,
  requestId: request.requestId,
  projectSession: request.projectSession,
  capability: request.capability,
  action: request.action,
  effects: descriptor.effects,
  risk: 'high',
  decision: PROJECT_CAPABILITY_DECISIONS.REQUIRE_APPROVAL,
  reasonCode: 'APPROVAL_REQUIRED',
  grant: { authorized: false, reason: 'grant_not_found' },
  sandbox: { backendId: 'fake', state: 'enforced', features: ['filesystem_scope'] },
}), true);

assert.throws(() => createProjectCapabilityResult({
  requestId: 'bad-pair',
  capability: 'git',
  action: 'reset',
  decision: PROJECT_CAPABILITY_DECISIONS.DENY,
  status: PROJECT_CAPABILITY_RESULT_STATUSES.COMPLETED,
}), /result/);
assert.throws(() => createProjectCapabilityResult({
  requestId: 'failed-without-error',
  capability: 'terminal',
  action: 'run',
  decision: PROJECT_CAPABILITY_DECISIONS.ALLOW,
  status: PROJECT_CAPABILITY_RESULT_STATUSES.FAILED,
}), /result/);

console.log('project capability contracts tests passed');
