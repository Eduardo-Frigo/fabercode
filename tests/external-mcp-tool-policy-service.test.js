const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  classifyExternalMcpTool,
  evaluateToolScopePolicy,
  evaluateToolPolicy,
  normalizeRiskPolicy,
  normalizeScopePolicy,
} = require('../main/services/external_mcp_tool_policy_service');

function run() {
  const policy = normalizeRiskPolicy({
    maxRiskLevel: 'medium',
    blockedRiskLevels: ['critical'],
    allowedPermissions: ['read'],
    requireExplicitAllowForHighRisk: true,
  });
  assert.deepStrictEqual(policy.allowedPermissions, ['read']);
  assert.strictEqual(policy.maxRiskLevel, 'medium');

  const readTool = classifyExternalMcpTool({
    name: 'docs.search',
    description: 'Search documentation.',
    annotations: { permission: 'read' },
  });
  assert.strictEqual(readTool.permission, 'read');
  assert.strictEqual(readTool.riskLevel, 'medium');

  const openWorldReadTool = classifyExternalMcpTool({
    name: 'read_wiki_structure',
    description: 'Read public repository documentation.',
    annotations: { permission: 'read', openWorldHint: true },
  });
  assert.strictEqual(openWorldReadTool.permission, 'read');
  assert.strictEqual(openWorldReadTool.riskLevel, 'medium');

  const openWorldWriteTool = classifyExternalMcpTool({
    name: 'publish.page',
    description: 'Publish a page.',
    annotations: { permission: 'write', openWorldHint: true },
  });
  assert.strictEqual(openWorldWriteTool.permission, 'write');
  assert.strictEqual(openWorldWriteTool.riskLevel, 'high');

  const publicDocsTool = classifyExternalMcpTool({
    name: 'read_wiki_structure',
    description: 'GitHub repository in owner/repo format.',
    annotations: { permission: 'read' },
  });
  assert.strictEqual(publicDocsTool.riskLevel, 'low');

  const writeEvaluation = evaluateToolPolicy({
    server: { permission: 'write', riskPolicy: policy },
    tool: {
      name: 'file.write',
      description: 'Write a file.',
      annotations: { permission: 'write' },
    },
    allowedByList: true,
  });
  assert.strictEqual(writeEvaluation.allowedByRiskPolicy, false);
  assert.strictEqual(writeEvaluation.blockedReason, 'tool_permission_blocked_by_policy');

  const criticalEvaluation = evaluateToolPolicy({
    server: { permission: 'write', riskPolicy: { maxRiskLevel: 'high', blockedRiskLevels: ['critical'] } },
    tool: {
      name: 'repo.delete',
      description: 'Delete project files.',
      annotations: { permission: 'write', riskLevel: 'critical' },
    },
    allowedByList: true,
  });
  assert.strictEqual(criticalEvaluation.allowedByRiskPolicy, false);
  assert.strictEqual(criticalEvaluation.blockedReason, 'tool_risk_blocked_by_policy');

  const highRiskAllowlistEvaluation = evaluateToolPolicy({
    server: {
      permission: 'write',
      riskPolicy: { maxRiskLevel: 'high', blockedRiskLevels: ['critical'], requireExplicitAllowForHighRisk: true },
    },
    tool: {
      name: 'file.create',
      description: 'Create a file.',
      annotations: { permission: 'write', riskLevel: 'high' },
    },
    allowedByList: false,
  });
  assert.strictEqual(highRiskAllowlistEvaluation.allowedByRiskPolicy, false);
  assert.strictEqual(highRiskAllowlistEvaluation.blockedReason, 'tool_high_risk_requires_allowlist');

  const scopePolicy = normalizeScopePolicy({
    allowedDirectories: ['.faber'],
    blockedDirectories: ['.git'],
    allowExternalNetwork: false,
    allowedNetworkHosts: ['localhost', 'api.safe.test'],
    blockedNetworkHosts: ['blocked.safe.test'],
  });
  assert.strictEqual(scopePolicy.enforceProjectRoot, true);
  assert.deepStrictEqual(scopePolicy.allowedDirectories, ['.faber']);
  assert.strictEqual(scopePolicy.allowExternalNetwork, false);

  const allowedScope = evaluateToolScopePolicy({
    server: { scopePolicy },
    arguments: {
      artifactPath: '.faber/captures/ok.png',
      url: 'http://localhost:3000',
    },
    projectSession: { rootPath: '/tmp/faber-project' },
  });
  assert.strictEqual(allowedScope.allowed, true);

  const outsideRoot = evaluateToolScopePolicy({
    server: { scopePolicy },
    arguments: { artifactPath: '/tmp/outside.png' },
    projectSession: { rootPath: '/tmp/faber-project' },
  });
  assert.strictEqual(outsideRoot.allowed, false);
  assert.strictEqual(outsideRoot.blockedReason, 'external_mcp_directory_outside_project_root');

  const blockedNetwork = evaluateToolScopePolicy({
    server: { scopePolicy },
    arguments: { endpoint: 'https://blocked.safe.test/rpc' },
    projectSession: { rootPath: '/tmp/faber-project' },
  });
  assert.strictEqual(blockedNetwork.allowed, false);
  assert.strictEqual(blockedNetwork.blockedReason, 'external_mcp_network_host_blocked');

  const externalNetwork = evaluateToolScopePolicy({
    server: { scopePolicy },
    arguments: { url: 'https://example.com/page' },
    projectSession: { rootPath: '/tmp/faber-project' },
  });
  assert.strictEqual(externalNetwork.allowed, false);
  assert.strictEqual(externalNetwork.blockedReason, 'external_mcp_network_host_not_allowed');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-mcp-policy-'));
  try {
    const projectRoot = path.join(tempRoot, 'project');
    const outsideRoot = path.join(tempRoot, 'outside');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });
    fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), 'secret', 'utf8');
    try {
      fs.symlinkSync(outsideRoot, path.join(projectRoot, 'outside-link'), 'dir');
    } catch {
      // Ambientes sem permissao para symlink ainda validam os demais guardrails.
    }

    if (fs.existsSync(path.join(projectRoot, 'outside-link'))) {
      const symlinkEscape = evaluateToolScopePolicy({
        server: { scopePolicy: { allowedDirectories: [projectRoot] } },
        arguments: { artifactPath: 'outside-link/secret.txt' },
        projectSession: { rootPath: projectRoot },
      });
      assert.strictEqual(symlinkEscape.allowed, false);
      assert.strictEqual(symlinkEscape.blockedReason, 'external_mcp_directory_physical_outside_project_root');
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('external-mcp-tool-policy-service.test.js: ok');
}

run();
