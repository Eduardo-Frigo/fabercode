const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  LEDGER_STATUSES,
  createAutomataContractLedgerService,
} = require('../cortex/orchestration/automata_contract_ledger_service');
const { createProjectBlueprintService } = require('../cortex/orchestration/project_blueprint_service');
const { createFaberCapabilityAdapterService } = require('../main/services/faber_capability_adapter_service');

function buildOperationBatchDiffPreview(operations = []) {
  return operations.map((operation) => `${operation.op}:${operation.path}`).join('\n');
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-capability-adapter-'));
  const projectRoot = path.join(tempRoot, 'project');
  const outsideFile = path.join(tempRoot, 'outside-secret.txt');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'index.html'),
    [
      '<main>',
      '  <section id="hero">',
      '    <a href="#contato">Agendar conversa</a>',
      '    <a href="#servicos">Conhecer serviços</a>',
      '  </section>',
      '  <section id="servicos">',
      '    <div class="grid md:grid-cols-2 gap-6">',
      '      <article><h3>Diagnóstico Faber</h3><p>Mapeamento.</p></article>',
      '      <article><h3>Implantação guiada</h3><p>Execução.</p></article>',
      '    </div>',
      '  </section>',
      '  <section id="depoimentos"><h2>Depoimentos</h2></section>',
      '  <section id="faq"><h2>FAQ</h2></section>',
      '</main>',
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(outsideFile, 'segredo fora da raiz', 'utf8');

  try {
    const terminalCalls = [];
    const previewCalls = [];
    const stopPreviewCalls = [];
    const externalMcpCalls = [];
    const auditCalls = [];
    const jobEvents = [];
    const checkpoints = [];
    const automataContractLedgerService = createAutomataContractLedgerService({
      fs,
      path,
      storageRoot: path.join(tempRoot, 'automata-contracts'),
      now: () => '2026-05-25T12:00:00.000Z',
    });
    const service = createFaberCapabilityAdapterService({
      fs,
      path,
      automataContractLedgerService,
      scanProject: (rootPath) => ({
        rootPath,
        stack: 'static',
        files: ['index.html'],
        directories: [],
      }),
      startProjectPreview: async (_, options) => {
        previewCalls.push(options);
        return {
          ok: true,
          session: {
            status: 'ready',
            url: 'http://127.0.0.1:3000/',
            mode: 'server',
          },
          message: 'ready',
        };
      },
      stopProjectPreview: async (projectInfo) => {
        stopPreviewCalls.push(projectInfo);
        return { ok: true, stopped: true };
      },
      getProjectPreviewRuntimeStatus: () => ({ ok: true, running: true, session: { status: 'ready' } }),
      captureProjectPreview: async ({ viewport }) => ({
        ok: true,
        viewport,
        artifactPath: `/tmp/${viewport.id || 'desktop'}.png`,
        pageSnapshot: { text: 'Faber' },
        issues: [],
      }),
      getProjectGitStatus: async () => ({ ok: true, isGitRepo: false }),
      appendAuditEvent: (type, payload) => auditCalls.push({ type, payload }),
      appendJobEvent: (jobId, type, payload) => jobEvents.push({ jobId, type, payload }),
      setJobCheckpoint: (jobId, key, payload) => checkpoints.push({ jobId, key, payload }),
      terminalService: {
        createSession: ({ rootPath }) => ({
          ok: true,
          session: {
            id: 'term-1',
            rootPath,
            output: '',
          },
        }),
        runCommand: ({ command, sessionId }) => {
          terminalCalls.push({ command, sessionId });
          return {
            ok: true,
            started: true,
            session: {
              id: sessionId,
              output: `$ ${command}\n`,
            },
          };
        },
        stopCommand: () => ({ ok: true, stopped: true, session: { id: 'term-1' } }),
        listSessions: () => ({ ok: true, sessions: [{ id: 'term-1', status: 'idle' }] }),
      },
      externalMcpServers: [
        {
          id: 'visual-auditor',
          name: 'Visual Auditor MCP',
          trust: 'approved',
          allowedTools: ['visual.capture'],
          blockedTools: ['filesystem.write'],
          permission: 'write',
        },
      ],
      externalMcpTransports: {
        'visual-auditor': {
          request: async (method, params) => {
            externalMcpCalls.push({ method, params });
            if (method === 'initialize') return { serverInfo: { name: 'Visual Auditor MCP' } };
            if (method === 'tools/list') {
              return {
                tools: [
                  { name: 'visual.capture', description: 'Captura screenshot externo.', inputSchema: { type: 'object' } },
                  { name: 'filesystem.write', description: 'Escrita direta bloqueada.', inputSchema: { type: 'object' } },
                ],
              };
            }
            if (method === 'tools/call') {
              return {
                content: [
                  { type: 'text', text: 'captured' },
                  { type: 'image', path: '/tmp/external-mcp-desktop.png', mimeType: 'image/png' },
                ],
                structuredContent: {
                  domMetrics: [
                    {
                      label: 'desktop',
                      innerWidth: 1365,
                      hamburgerVisible: false,
                      desktopNavVisible: true,
                      hasHorizontalOverflow: false,
                    },
                  ],
                },
                artifacts: ['/tmp/external-mcp-desktop.png'],
              };
            }
            return { isError: true, content: [{ type: 'text', text: 'unknown' }] };
          },
        },
      },
      now: () => '2026-05-25T12:00:00.000Z',
    });

    const capabilities = service.listCapabilities().map((item) => item.capability).sort();
    assert.deepStrictEqual(capabilities, ['blueprint_contract', 'browser_preview', 'external_mcp', 'filesystem', 'git', 'structured_edit', 'terminal']);

    const externalServers = await service.executeCapability({
      capability: 'external_mcp',
      action: 'servers',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto' },
    });
    assert.strictEqual(externalServers.ok, true);
    assert.strictEqual(externalServers.evidence.data.servers[0].status, 'available');

    const externalDiscovery = await service.executeCapability({
      capability: 'external_mcp',
      action: 'discover_tools',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto' },
      payload: { serverId: 'visual-auditor' },
    });
    assert.strictEqual(externalDiscovery.ok, true);
    assert.strictEqual(externalDiscovery.evidence.data.tools.find((tool) => tool.name === 'visual.capture').allowed, true);
    assert.strictEqual(externalDiscovery.evidence.data.tools.find((tool) => tool.name === 'filesystem.write').allowed, false);

    const externalCapture = await service.executeCapability({
      capability: 'external_mcp',
      action: 'call_tool',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto', jobId: 'job-external' },
      payload: {
        serverId: 'visual-auditor',
        toolName: 'visual.capture',
        arguments: { url: 'http://127.0.0.1:3000/' },
      },
    });
    assert.strictEqual(externalCapture.ok, true);
    assert.deepStrictEqual(externalCapture.evidence.artifacts, ['/tmp/external-mcp-desktop.png']);
    assert.strictEqual(externalCapture.evidence.data.result.structuredContent.domMetrics[0].desktopNavVisible, true);
    assert.strictEqual(externalMcpCalls.some((entry) => entry.method === 'tools/call'), true);

    const externalBlocked = await service.executeCapability({
      capability: 'external_mcp',
      action: 'call_tool',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto' },
      payload: {
        serverId: 'visual-auditor',
        toolName: 'filesystem.write',
        arguments: { path: 'index.html' },
      },
    });
    assert.strictEqual(externalBlocked.ok, false);
    assert.strictEqual(externalBlocked.status, 'blocked');
    assert.ok(externalBlocked.evidence.errors.includes('tool_blocked_by_policy'));

    const externalLedgerPath = path.join(projectRoot, '.faber', 'capabilities', 'external_mcp.jsonl');
    assert.strictEqual(fs.existsSync(externalLedgerPath), true);

    const readResult = await service.executeCapability({
      capability: 'filesystem',
      action: 'read_file',
      projectSession: { rootPath: projectRoot },
      payload: { path: 'index.html' },
    });
    assert.strictEqual(readResult.ok, true);
    assert.strictEqual(readResult.evidence.data.path, 'index.html');
    assert.match(readResult.evidence.data.content, /Faber/);

    const structuredPlan = await service.executeCapability({
      capability: 'structured_edit',
      action: 'plan',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto', jobId: 'job-1' },
      payload: {
        requestId: 'request-plan-1',
        userMessage: 'Troque o texto do CTA secundário de Conhecer serviços para Ver planos',
      },
    });
    assert.strictEqual(structuredPlan.ok, true);
    assert.strictEqual(structuredPlan.evidence.data.patch.generatedBy, 'deterministic_cta_text_patch');
    assert.strictEqual(structuredPlan.evidence.data.patch.validation.ok, true);
    assert.deepStrictEqual(structuredPlan.evidence.data.patch.operations.map((operation) => operation.path), ['index.html']);
    assert.strictEqual(structuredPlan.evidence.data.ledger.ok, true);
    assert.strictEqual(structuredPlan.evidence.data.ledger.relativePath, '.faber/capabilities/structured_edit.jsonl');
    assert.ok(structuredPlan.evidence.data.patch.diffPreview.includes('index.html'));

    const structuredApply = await service.executeCapability({
      capability: 'structured_edit',
      action: 'apply',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto', jobId: 'job-1' },
      payload: {
        requestId: 'request-apply-1',
        userMessage: 'Mude o grid de serviços para 3 colunas no desktop',
      },
    });
    assert.strictEqual(structuredApply.ok, true);
    assert.strictEqual(structuredApply.evidence.data.patch.generatedBy, 'deterministic_grid_columns_patch');
    assert.deepStrictEqual(structuredApply.evidence.data.applied, ['index.html']);
    assert.match(fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8'), /lg:grid-cols-3/);
    assert.strictEqual(structuredApply.evidence.data.ledger.ok, true);

    const ledgerPath = path.join(projectRoot, '.faber', 'capabilities', 'structured_edit.jsonl');
    assert.strictEqual(fs.existsSync(ledgerPath), true);
    const ledgerEntries = fs.readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.strictEqual(ledgerEntries.length, 2);
    assert.deepStrictEqual(ledgerEntries.map((entry) => entry.action), ['plan', 'apply']);
    assert.strictEqual(ledgerEntries[0].jobId, 'job-1');
    assert.strictEqual(ledgerEntries[0].project.id, 'project-1');
    assert.strictEqual(ledgerEntries[1].patch.generatedBy, 'deterministic_grid_columns_patch');
    assert.deepStrictEqual(ledgerEntries[1].applied, ['index.html']);
    assert.ok(auditCalls.some((entry) => entry.type === 'capability.structured_edit.plan'));
    assert.ok(auditCalls.some((entry) => entry.type === 'capability.structured_edit.apply'));
    assert.ok(jobEvents.some((entry) => entry.jobId === 'job-1' && entry.type === 'job.capability.structured_edit'));
    assert.ok(checkpoints.some((entry) => entry.jobId === 'job-1' && entry.key === 'capability_structured_edit'));

    let symlinkCreated = false;
    const escapedLinkPath = path.join(projectRoot, 'escaped-secret.txt');
    try {
      fs.symlinkSync(outsideFile, escapedLinkPath);
      symlinkCreated = true;
    } catch (_) {
      symlinkCreated = false;
    }
    if (symlinkCreated) {
      const escapedReadResult = await service.executeCapability({
        capability: 'filesystem',
        action: 'read_file',
        projectSession: { rootPath: projectRoot },
        payload: { path: 'escaped-secret.txt' },
      });
      assert.strictEqual(escapedReadResult.ok, false);
      assert.strictEqual(escapedReadResult.status, 'failed');
      assert.match(escapedReadResult.message, /fora da raiz real/);
    }

    const captureResult = await service.executeCapability({
      capability: 'browser_preview',
      action: 'capture',
      projectSession: { rootPath: projectRoot },
      payload: {
        viewports: [
          { id: 'desktop', width: 1365, height: 768 },
          { id: 'mobile', width: 390, height: 844 },
        ],
        options: {
          open: true,
          autoInstallDependencies: false,
          reuseActiveSession: false,
          preferExistingServer: false,
        },
      },
    });
    assert.strictEqual(captureResult.ok, true);
    assert.deepStrictEqual(captureResult.evidence.artifacts, ['/tmp/desktop.png', '/tmp/mobile.png']);
    assert.strictEqual(captureResult.evidence.data.captures.length, 2);
    assert.strictEqual(previewCalls[0].open, false);
    assert.strictEqual(previewCalls[0].autoInstallDependencies, true);
    assert.strictEqual(previewCalls[0].reuseActiveSession, true);
    assert.strictEqual(previewCalls[0].preferExistingServer, true);
    assert.strictEqual(stopPreviewCalls.length, 0);

    const captureAndStopResult = await service.executeCapability({
      capability: 'browser_preview',
      action: 'capture',
      projectSession: { rootPath: projectRoot },
      payload: {
        viewports: [{ id: 'desktop', width: 1365, height: 768 }],
        options: {
          stopAfterCapture: true,
        },
      },
    });
    assert.strictEqual(captureAndStopResult.ok, true);
    assert.strictEqual(stopPreviewCalls.length, 1);
    assert.strictEqual(stopPreviewCalls[0].rootPath, projectRoot);

    const terminalResult = await service.executeCapability({
      capability: 'terminal',
      action: 'run_command',
      projectSession: { rootPath: projectRoot },
      payload: { command: 'npm run test' },
    });
    assert.strictEqual(terminalResult.ok, true);
    assert.strictEqual(terminalResult.status, 'running');
    assert.strictEqual(terminalCalls[0].sessionId, 'term-1');

    const gitResult = await service.executeCapability({
      capability: 'git',
      action: 'status',
      projectSession: { rootPath: projectRoot },
    });
    assert.strictEqual(gitResult.ok, true);
    assert.strictEqual(gitResult.evidence.data.git.isGitRepo, false);

    const blueprintService = createProjectBlueprintService();
    const legalBlueprint = blueprintService.buildProjectBlueprintOperationBatch({
      projectInfo: { rootPath: projectRoot },
      userMessage: 'criar site institucional em Next.js com React e Tailwind para advogado empresarial usando placeholders',
      executionIntent: 'init_project',
      force: true,
      buildOperationBatchDiffPreview,
    });
    assert.strictEqual(legalBlueprint.ok, true);

    const contractPayload = {
      blueprint: legalBlueprint.action,
      sourcePolicy: {
        forbiddenTerms: ['Clínica Sorriso'],
        requiredTerms: ['advocacia'],
        allowedSources: ['current_briefing'],
        forbiddenSources: ['stale_active_memory'],
      },
      visualEvidence: {
        domMetrics: [
          {
            label: 'desktop',
            innerWidth: 1365,
            hamburgerVisible: false,
            desktopNavVisible: true,
            hasHorizontalOverflow: false,
            hasOldMemory: false,
          },
          {
            label: 'mobile',
            innerWidth: 390,
            hamburgerVisible: true,
            desktopNavVisible: false,
            hasHorizontalOverflow: false,
            hasOldMemory: false,
          },
        ],
        artifacts: ['/tmp/contract-desktop.png', '/tmp/contract-mobile.png'],
      },
    };

    const contractValidation = await service.executeCapability({
      capability: 'blueprint_contract',
      action: 'validate',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto', jobId: 'job-2' },
      payload: contractPayload,
    });
    assert.strictEqual(contractValidation.ok, true);
    assert.strictEqual(contractValidation.evidence.data.validation.ok, true);
    assert.strictEqual(contractValidation.evidence.data.validation.contractValidation.gate, 'allow');
    assert.strictEqual(contractValidation.evidence.data.validation.runtimeValidation.status, 'passed');
    assert.ok(contractValidation.evidence.data.validation.routes.routes.includes('/'));
    assert.deepStrictEqual(contractValidation.evidence.artifacts, ['/tmp/contract-desktop.png', '/tmp/contract-mobile.png']);
    assert.strictEqual(contractValidation.evidence.data.ledger.relativePath, '.faber/capabilities/blueprint_contract.jsonl');

    const runtimeViolation = await service.executeCapability({
      capability: 'blueprint_contract',
      action: 'validate',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto' },
      payload: {
        ...contractPayload,
        visualEvidence: {
          domMetrics: [
            {
              label: 'mobile',
              innerWidth: 390,
              hamburgerVisible: false,
              desktopNavVisible: true,
              hasHorizontalOverflow: true,
              hasOldMemory: false,
            },
          ],
        },
      },
    });
    assert.strictEqual(runtimeViolation.ok, false);
    assert.ok(runtimeViolation.evidence.errors.includes('runtime_mobile_hamburger_missing'));
    assert.ok(runtimeViolation.evidence.errors.includes('runtime_mobile_desktop_nav_visible'));
    assert.ok(runtimeViolation.evidence.errors.includes('runtime_horizontal_overflow'));

    const staleOperations = legalBlueprint.action.operations.map((operation) => operation.path === 'app/page.tsx'
      ? { ...operation, content: `${operation.content}\n/* Clínica Sorriso */\n` }
      : operation);
    const staleMemoryViolation = await service.executeCapability({
      capability: 'blueprint_contract',
      action: 'validate',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto' },
      payload: {
        operations: staleOperations,
        stack: legalBlueprint.action.blueprint.stack,
        moduleContract: legalBlueprint.action.blueprint.moduleContract,
        coverageContract: legalBlueprint.action.blueprint.coverageContract,
        sourcePolicy: {
          forbiddenTerms: ['Clínica Sorriso'],
          requiredTerms: ['advocacia'],
        },
      },
    });
    assert.strictEqual(staleMemoryViolation.ok, false);
    assert.ok(staleMemoryViolation.evidence.errors.includes('source_policy_failed'));

    const invalidResponsiveOperations = legalBlueprint.action.operations.map((operation) => operation.path === 'app/page.tsx'
      ? {
          ...operation,
          content: operation.content
            .replace(/lg:hidden/g, 'md:hidden')
            .replace(/lg:flex/g, 'md:flex'),
        }
      : operation);
    const repairResult = await service.executeCapability({
      capability: 'blueprint_contract',
      action: 'repair',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto' },
      payload: {
        operations: invalidResponsiveOperations,
        stack: legalBlueprint.action.blueprint.stack,
        moduleContract: legalBlueprint.action.blueprint.moduleContract,
        coverageContract: legalBlueprint.action.blueprint.coverageContract,
      },
    });
    assert.strictEqual(repairResult.ok, true);
    assert.strictEqual(repairResult.evidence.data.repair.needed, true);
    assert.ok(repairResult.evidence.data.initialValidation.issues.some((issue) => issue.id === 'responsive_header_invalid'));
    assert.strictEqual(repairResult.evidence.data.validation.contractValidation.gate, 'allow');
    const repairedPage = repairResult.result.repairedOperations.find((operation) => operation.path === 'app/page.tsx').content;
    assert.ok(repairedPage.includes('lg:hidden'));
    assert.strictEqual(repairedPage.includes('md:hidden'), false);

    const suggestedContract = await service.executeCapability({
      capability: 'blueprint_contract',
      action: 'suggest',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto' },
      payload: contractPayload,
    });
    assert.strictEqual(suggestedContract.ok, true);
    const ledgerEntryId = suggestedContract.evidence.data.automataLedger.entry.id;
    assert.strictEqual(suggestedContract.evidence.data.automataLedger.entry.status, LEDGER_STATUSES.SUGGEST_BLUEPRINT);
    assert.strictEqual(
      suggestedContract.evidence.data.automataLedger.entry.contract.proposedContract.kind,
      'blueprint_contract_guardian'
    );

    const stagedContract = await service.executeCapability({
      capability: 'blueprint_contract',
      action: 'stage',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto' },
      payload: { ledgerEntryId },
    });
    assert.strictEqual(stagedContract.ok, true);
    assert.strictEqual(stagedContract.evidence.data.automataLedger.entry.status, LEDGER_STATUSES.STAGED);

    const trialContract = await service.executeCapability({
      capability: 'blueprint_contract',
      action: 'trial',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto' },
      payload: { ledgerEntryId, passed: true, trial: { smoke: 'mcp_blueprint_contract_guardian' } },
    });
    assert.strictEqual(trialContract.ok, true);
    assert.strictEqual(trialContract.evidence.data.automataLedger.entry.status, LEDGER_STATUSES.TRIAL_PASSED);

    const promotedContract = await service.executeCapability({
      capability: 'blueprint_contract',
      action: 'promote',
      projectSession: { rootPath: projectRoot, projectId: 'project-1', projectName: 'Projeto' },
      payload: { ledgerEntryId },
    });
    assert.strictEqual(promotedContract.ok, true);
    assert.strictEqual(promotedContract.evidence.data.automataLedger.entry.status, LEDGER_STATUSES.LOCAL_ACTIVE);

    const blueprintLedgerPath = path.join(projectRoot, '.faber', 'capabilities', 'blueprint_contract.jsonl');
    assert.strictEqual(fs.existsSync(blueprintLedgerPath), true);
    const blueprintLedgerEntries = fs.readFileSync(blueprintLedgerPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(blueprintLedgerEntries.some((entry) => entry.action === 'validate' && entry.data.validation.gate === 'allow'));
    assert.ok(blueprintLedgerEntries.some((entry) => entry.action === 'repair' && entry.data.repair.needed === true));
    assert.ok(blueprintLedgerEntries.some((entry) => entry.action === 'promote'));

    console.log('faber-capability-adapter-service.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
