const { createCapabilityGateway } = require('../../cortex/capabilities/capability_gateway');
const {
  buildProjectSession,
  isInsideRoot,
} = require('../../cortex/capabilities/project_session_contract');
const { buildOperationBatchDiffPreview } = require('../runtime/diff_preview');
const { createBlueprintContractCapabilityService } = require('./blueprint_contract_capability_service');
const { createCapabilityEvidenceLedgerService } = require('./capability_evidence_ledger_service');
const { createDeterministicEditService } = require('./deterministic_edit_service');
const { createExternalMcpBridgeService } = require('./external_mcp_bridge_service');
const { createExternalMcpTransportFactory } = require('./external_mcp_transport_factory_service');

function clipText(value = '', maxChars = 12000) {
  const text = String(value || '');
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

function normalizeViewportList(payload = {}) {
  if (Array.isArray(payload.viewports) && payload.viewports.length) return payload.viewports;
  if (payload.viewport) return [payload.viewport];
  return [{ id: 'desktop', width: 1365, height: 768 }];
}

function normalizeCapabilityPrompt(payload = {}) {
  return String(payload.userMessage || payload.prompt || payload.request || payload.message || '').trim();
}

function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return null;
  try {
    return fn(...args);
  } catch {
    return null;
  }
}

function createFaberCapabilityAdapterService(dependencies = {}) {
  const {
    captureProjectPreview = null,
    fs = null,
    getProjectGitStatus = null,
    getProjectPreviewRuntimeStatus = null,
    path = null,
    scanProject = null,
    startProjectPreview = null,
    stopProjectPreview = null,
    terminalService = null,
    deterministicEditService = null,
    capabilityEvidenceLedgerService = null,
    externalMcpService = null,
    externalMcpServers = [],
    externalMcpTransports = {},
    externalMcpTransportFactory = null,
    automataContractLedgerService = null,
    appendAuditEvent = null,
    appendJobEvent = null,
    setJobCheckpoint = null,
    now = () => new Date().toISOString(),
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Faber capability dependency missing: ${name}`);
  }

  function resolveRealPath(targetPath) {
    const resolver = fs.realpathSync && fs.realpathSync.native ? fs.realpathSync.native : fs.realpathSync;
    return resolver.call(fs, targetPath);
  }

  function readProjectFile(projectSession, relativePath) {
    requireDependency('fs', fs);
    requireDependency('path', path);
    const target = path.resolve(path.join(projectSession.rootPath, String(relativePath || '')));
    const root = path.resolve(projectSession.rootPath);
    if (!isInsideRoot(root, target)) {
      return { ok: false, message: 'Arquivo fora da raiz do projeto.' };
    }
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return { ok: false, message: 'Raiz do projeto não encontrada.' };
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return { ok: false, message: 'Arquivo não encontrado.' };
    }
    const realRoot = projectSession.realRootPath
      ? path.resolve(projectSession.realRootPath)
      : resolveRealPath(root);
    const realTarget = resolveRealPath(target);
    if (!isInsideRoot(realRoot, realTarget)) {
      return { ok: false, message: 'Arquivo fora da raiz real do projeto.' };
    }
    return {
      ok: true,
      relativePath: path.relative(root, target).split(path.sep).join('/'),
      content: fs.readFileSync(target, 'utf8'),
    };
  }

  function writeExistingProjectFile(projectSession, relativePath, content) {
    requireDependency('fs', fs);
    requireDependency('path', path);
    const target = path.resolve(path.join(projectSession.rootPath, String(relativePath || '')));
    const root = path.resolve(projectSession.rootPath);
    if (!isInsideRoot(root, target)) {
      return { ok: false, message: 'Arquivo fora da raiz do projeto.', path: relativePath };
    }
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return { ok: false, message: 'Raiz do projeto não encontrada.', path: relativePath };
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return { ok: false, message: 'Arquivo alvo não encontrado para edição estruturada.', path: relativePath };
    }
    const realRoot = projectSession.realRootPath
      ? path.resolve(projectSession.realRootPath)
      : resolveRealPath(root);
    const realTarget = resolveRealPath(target);
    if (!isInsideRoot(realRoot, realTarget)) {
      return { ok: false, message: 'Arquivo fora da raiz real do projeto.', path: relativePath };
    }
    fs.writeFileSync(target, String(content || ''), 'utf8');
    return {
      ok: true,
      path: path.relative(root, target).split(path.sep).join('/'),
    };
  }

  function applyStructuredOperations(projectSession, operations = []) {
    const applied = [];
    for (const [index, operation] of operations.entries()) {
      if (!operation || operation.op !== 'write_file') {
        return {
          ok: false,
          message: 'Operação não permitida em edição estruturada.',
          errors: ['structured_edit_unsupported_operation'],
          applied,
          index,
        };
      }
      const result = writeExistingProjectFile(projectSession, operation.path, operation.content);
      if (!result.ok) {
        return {
          ok: false,
          message: result.message,
          errors: ['structured_edit_write_failed'],
          applied,
          index,
          path: result.path || operation.path,
        };
      }
      applied.push(result.path);
    }
    return {
      ok: true,
      message: 'Edição estruturada aplicada.',
      applied,
    };
  }

  function getCapabilityEvidenceLedgerService() {
    if (capabilityEvidenceLedgerService) return capabilityEvidenceLedgerService;
    if (!fs || !path) return null;
    return createCapabilityEvidenceLedgerService({ fs, path, now });
  }

  function persistCapabilityEvidence({
    capability,
    action,
    projectSession,
    payload = {},
    ok,
    status,
    message,
    patch = null,
    applied = [],
    errors = [],
    warnings = [],
    artifacts = [],
    data = null,
  } = {}) {
    const jobId = String(payload.jobId || projectSession.jobId || '').trim();
    const ledgerService = getCapabilityEvidenceLedgerService();
    const ledger = ledgerService && typeof ledgerService.appendCapabilityEvidence === 'function'
      ? ledgerService.appendCapabilityEvidence({
          capability,
          action,
          projectSession,
          jobId,
          requestId: payload.requestId || '',
          userMessage: normalizeCapabilityPrompt(payload),
          ok,
          status,
          message,
          patch,
          applied,
          errors,
          warnings,
          artifacts,
          data,
        })
      : { ok: false, message: 'Capability evidence ledger unavailable.' };

    safeCall(appendAuditEvent, `capability.${capability}.${action}`, {
      ok: Boolean(ok),
      status,
      projectId: projectSession.projectId || '',
      jobId,
      ledgerPath: ledger && ledger.relativePath ? ledger.relativePath : '',
      generatedBy: patch && patch.generatedBy ? patch.generatedBy : '',
      applied,
      errors,
    });

    if (jobId) {
      const jobPayload = {
        ok: Boolean(ok),
        status,
        capability,
        action,
        ledgerPath: ledger && ledger.relativePath ? ledger.relativePath : '',
        generatedBy: patch && patch.generatedBy ? patch.generatedBy : '',
        files: patch && Array.isArray(patch.operations) ? patch.operations.map((operation) => operation.path).filter(Boolean) : [],
        applied,
        summary: data && data.validation && data.validation.summary ? data.validation.summary : '',
      };
      safeCall(appendJobEvent, jobId, `job.capability.${capability}`, jobPayload);
      safeCall(setJobCheckpoint, jobId, `capability_${capability}`, jobPayload);
    }

    return ledger;
  }

  const filesystemAdapter = {
    capability: 'filesystem',
    actions: ['project_tree', 'read_file'],
    permission: 'read',
    description: 'Lê árvore e arquivos do projeto ativo sem escrever no disco.',
    async handle({ action, payload, projectSession }) {
      if (action === 'project_tree') {
        if (typeof scanProject !== 'function') {
          return { ok: false, message: 'Scanner de projeto indisponível.', errors: ['scan_project_unavailable'] };
        }
        const info = scanProject(projectSession.rootPath);
        return {
          ok: true,
          status: 'succeeded',
          message: 'Árvore do projeto capturada.',
          data: {
            rootPath: info.rootPath,
            stack: info.stack || '',
            files: Array.isArray(info.files) ? info.files.slice(0, 500) : [],
            directories: Array.isArray(info.directories) ? info.directories.slice(0, 200) : [],
          },
          result: { info },
        };
      }

      const fileResult = readProjectFile(projectSession, payload.path || payload.relativePath || '');
      if (!fileResult.ok) {
        return { ok: false, message: fileResult.message, errors: ['file_read_failed'] };
      }
      return {
        ok: true,
        status: 'succeeded',
        message: `Arquivo lido: ${fileResult.relativePath}`,
        data: {
          path: fileResult.relativePath,
          content: clipText(fileResult.content, Number(payload.maxChars || 12000)),
        },
        result: fileResult,
      };
    },
  };

  const terminalAdapter = {
    capability: 'terminal',
    actions: ['create_session', 'run_command', 'stop_command', 'status'],
    permission: 'write',
    description: 'Opera terminal de projeto com sessão, cwd preso à raiz e retorno auditável.',
    async handle({ action, payload, projectSession }) {
      requireDependency('terminalService', terminalService);
      if (action === 'create_session') {
        const result = terminalService.createSession({
          rootPath: projectSession.rootPath,
          realRootPath: projectSession.realRootPath,
          name: payload.name,
        });
        return {
          ok: Boolean(result && result.ok),
          status: result && result.ok ? 'succeeded' : 'failed',
          message: result && result.message ? result.message : 'Sessão de terminal criada.',
          data: { session: result ? result.session : null },
          result,
        };
      }
      if (action === 'status') {
        const result = terminalService.listSessions({
          rootPath: projectSession.rootPath,
          realRootPath: projectSession.realRootPath,
        });
        return {
          ok: Boolean(result && result.ok),
          status: result && result.ok ? 'succeeded' : 'failed',
          message: 'Estado do terminal capturado.',
          data: { sessions: result && Array.isArray(result.sessions) ? result.sessions : [] },
          result,
        };
      }
      if (action === 'stop_command') {
        const result = terminalService.stopCommand({
          rootPath: projectSession.rootPath,
          sessionId: payload.sessionId,
        });
        return {
          ok: Boolean(result && result.ok),
          status: result && result.ok ? 'succeeded' : 'failed',
          message: result && result.message ? result.message : 'Comando interrompido.',
          data: { session: result ? result.session : null, stopped: Boolean(result && result.stopped) },
          result,
        };
      }

      let sessionId = payload.sessionId;
      let createdSession = null;
      if (!sessionId) {
        const created = terminalService.createSession({
          rootPath: projectSession.rootPath,
          realRootPath: projectSession.realRootPath,
          name: payload.name,
        });
        if (!created || !created.ok || !created.session) {
          return { ok: false, status: 'failed', message: created && created.message ? created.message : 'Falha ao criar terminal.', result: created };
        }
        createdSession = created.session;
        sessionId = created.session.id;
      }
      const result = terminalService.runCommand({
        rootPath: projectSession.rootPath,
        sessionId,
        command: payload.command,
      });
      return {
        ok: Boolean(result && result.ok),
        status: result && result.ok ? (result.started ? 'running' : 'succeeded') : 'failed',
        message: result && result.message ? result.message : result && result.started ? 'Comando iniciado.' : 'Comando processado.',
        logs: result && result.session && result.session.output ? [clipText(result.session.output, 8000)] : [],
        data: {
          createdSession,
          session: result ? result.session : null,
          started: Boolean(result && result.started),
        },
        result,
      };
    },
  };

  const browserPreviewAdapter = {
    capability: 'browser_preview',
    actions: ['start', 'capture', 'status', 'stop'],
    permission: 'write',
    description: 'Inicia preview, reutiliza servidor ativo e captura evidências visuais por viewport.',
    async handle({ action, payload, projectSession }) {
      if (action === 'status') {
        if (typeof getProjectPreviewRuntimeStatus !== 'function') {
          return { ok: false, message: 'Status de preview indisponível.', errors: ['preview_status_unavailable'] };
        }
        const result = getProjectPreviewRuntimeStatus({ rootPath: projectSession.rootPath });
        return {
          ok: Boolean(result && result.ok),
          status: result && result.ok ? (result.running ? 'running' : 'succeeded') : 'failed',
          message: result && result.message ? result.message : 'Status de preview capturado.',
          data: { session: result ? result.session : null, running: Boolean(result && result.running) },
          result,
        };
      }
      if (action === 'stop') {
        if (typeof stopProjectPreview !== 'function') {
          return { ok: false, message: 'Stop de preview indisponível.', errors: ['preview_stop_unavailable'] };
        }
        const result = await stopProjectPreview({ rootPath: projectSession.rootPath });
        return {
          ok: Boolean(result && result.ok),
          status: result && result.ok ? (result.stopped ? 'succeeded' : 'idle') : 'failed',
          message: result && result.message ? result.message : 'Preview interrompido.',
          data: { stopped: Boolean(result && result.stopped), session: result ? result.session : null },
          result,
        };
      }

      if (typeof scanProject !== 'function' || typeof startProjectPreview !== 'function') {
        return { ok: false, message: 'Preview runtime indisponível.', errors: ['preview_runtime_unavailable'] };
      }
      const info = scanProject(projectSession.rootPath);
      const requestedOptions = payload.options && typeof payload.options === 'object' ? payload.options : {};
      const stopAfterCapture = Boolean(action === 'capture' && (requestedOptions.stopAfterCapture || payload.stopAfterCapture));
      const preview = await startProjectPreview(info, {
        ...requestedOptions,
        open: false,
        autoInstallDependencies: action === 'capture',
        reuseActiveSession: true,
        preferExistingServer: true,
      });
      if (action === 'start') {
        return {
          ok: Boolean(preview && preview.ok),
          status: preview && preview.ok ? 'succeeded' : 'failed',
          message: preview && preview.message ? preview.message : 'Preview iniciado.',
          data: { preview },
          result: preview,
        };
      }

      try {
        const session = preview && preview.session ? preview.session : {};
        if (!preview || !preview.ok || session.status !== 'ready' || !session.url) {
          return {
            ok: false,
            status: 'failed',
            message: preview && preview.message ? preview.message : 'Preview não ficou pronto para captura.',
            errors: ['preview_not_ready'],
            data: { preview },
            result: { preview, captures: [] },
          };
        }
        if (typeof captureProjectPreview !== 'function') {
          return {
            ok: false,
            status: 'failed',
            message: 'Captura visual indisponível.',
            errors: ['preview_capture_unavailable'],
            data: { preview },
            result: { preview, captures: [] },
          };
        }

        const captures = [];
        for (const viewport of normalizeViewportList(payload)) {
          captures.push(await captureProjectPreview({
            url: session.url,
            rootPath: projectSession.rootPath,
            viewport,
            ...(payload.captureOptions || {}),
          }));
        }
        const failedCaptures = captures.filter((capture) => !capture || !capture.ok);
        const artifactPaths = captures
          .flatMap((capture) => {
            if (!capture) return [];
            if (Array.isArray(capture.artifactPaths)) return capture.artifactPaths;
            if (capture.artifactPath) return [capture.artifactPath];
            return capture.path ? [capture.path] : [];
          })
          .filter(Boolean);
        return {
          ok: failedCaptures.length === 0,
          status: failedCaptures.length === 0 ? 'succeeded' : 'failed',
          message: failedCaptures.length === 0
            ? 'Preview capturado com evidência visual real.'
            : 'Uma ou mais capturas de preview falharam.',
          artifacts: artifactPaths,
          errors: failedCaptures.length ? ['preview_capture_failed'] : [],
          data: { preview, captures, artifactPaths },
          result: { preview, captures },
        };
      } finally {
        if (stopAfterCapture && typeof stopProjectPreview === 'function') {
          await stopProjectPreview(info).catch(() => null);
        }
      }
    },
  };

  const gitAdapter = {
    capability: 'git',
    actions: ['status'],
    permission: 'read',
    description: 'Lê estado Git do projeto ativo para evidência e auditoria.',
    async handle({ projectSession }) {
      if (typeof getProjectGitStatus !== 'function') {
        return { ok: false, message: 'Git runtime indisponível.', errors: ['git_status_unavailable'] };
      }
      const result = await getProjectGitStatus(projectSession.rootPath);
      return {
        ok: Boolean(result && result.ok),
        status: result && result.ok ? 'succeeded' : 'failed',
        message: result && result.message ? result.message : 'Status Git capturado.',
        data: { git: result },
        result,
      };
    },
  };

  const structuredEditAdapter = {
    capability: 'structured_edit',
    actions: ['plan', 'apply'],
    permission: 'write',
    description: 'Planeja e aplica micro-edits estruturais com patch determinístico, validação e evidência.',
    inputSchema: {
      type: 'object',
      properties: {
        userMessage: { type: 'string' },
        prompt: { type: 'string' },
        attachments: { type: 'array' },
      },
    },
    async handle({ action, payload, projectSession }) {
      requireDependency('fs', fs);
      requireDependency('path', path);
      if (typeof scanProject !== 'function') {
        return { ok: false, status: 'failed', message: 'Scanner de projeto indisponível.', errors: ['scan_project_unavailable'] };
      }

      const userMessage = normalizeCapabilityPrompt(payload);
      if (!userMessage) {
        return { ok: false, status: 'blocked', message: 'Pedido de edição estruturada vazio.', errors: ['structured_edit_empty_prompt'] };
      }

      const projectInfo = scanProject(projectSession.rootPath);
      const editService = deterministicEditService || createDeterministicEditService({
        fs,
        path,
        buildOperationBatchDiffPreview,
      });
      const patch = editService.buildContentEditOperationBatch({
        projectInfo,
        userMessage,
        attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
        executionIntent: 'edit_project',
      });

      if (!patch) {
        const classification = typeof editService.classifySafeContentEditRequest === 'function'
          ? editService.classifySafeContentEditRequest(userMessage)
          : null;
        const ledger = persistCapabilityEvidence({
          capability: 'structured_edit',
          action,
          projectSession,
          payload,
          ok: false,
          status: 'blocked',
          message: 'Nenhum microcontrato determinístico estruturado reconheceu esse pedido.',
          errors: ['structured_edit_no_patch_available'],
        });
        return {
          ok: false,
          status: 'blocked',
          message: 'Nenhum microcontrato determinístico estruturado reconheceu esse pedido.',
          errors: ['structured_edit_no_patch_available'],
          data: { classification, ledger },
        };
      }

      if (!patch.ok || !patch.action) {
        const rejectedPatchData = {
          generatedBy: patch.safePatchEvidence && patch.safePatchEvidence.generator ? patch.safePatchEvidence.generator : '',
          targetFile: '',
          operations: [],
          diffPreview: '',
          microContract: patch.safePatchEvidence && patch.safePatchEvidence.microContract ? patch.safePatchEvidence.microContract : null,
          classification: patch.safePatchClassification || null,
          validation: patch.safePatchValidation || null,
          evidence: patch.safePatchEvidence || null,
        };
        const ledger = persistCapabilityEvidence({
          capability: 'structured_edit',
          action,
          projectSession,
          payload,
          ok: false,
          status: 'blocked',
          message: patch.message || 'Patch estruturado bloqueado pela validação.',
          patch: rejectedPatchData,
          errors: ['structured_edit_patch_rejected'],
        });
        return {
          ok: false,
          status: 'blocked',
          message: patch.message || 'Patch estruturado bloqueado pela validação.',
          errors: ['structured_edit_patch_rejected'],
          data: {
            classification: patch.safePatchClassification || null,
            validation: patch.safePatchValidation || null,
            evidence: patch.safePatchEvidence || null,
            ledger,
          },
          result: { patch },
        };
      }

      const patchData = {
        generatedBy: patch.action.generatedBy,
        targetFile: patch.action.targetFile,
        operations: patch.action.operations.map((operation) => ({
          op: operation.op,
          path: operation.path,
          bytes: String(operation.content || '').length,
        })),
        diffPreview: clipText(patch.action.diffPreview || '', 8000),
        microContract: patch.action.microContract || null,
        classification: patch.action.safePatchClassification || null,
        validation: patch.action.safePatchValidation || null,
        evidence: patch.action.safePatchEvidence || null,
      };

      if (action === 'plan') {
        const ledger = persistCapabilityEvidence({
          capability: 'structured_edit',
          action,
          projectSession,
          payload,
          ok: true,
          status: 'succeeded',
          message: 'Patch estruturado planejado e aprovado.',
          patch: patchData,
        });
        return {
          ok: true,
          status: 'succeeded',
          message: 'Patch estruturado planejado e aprovado.',
          data: { patch: patchData, ledger },
          result: { patch },
        };
      }

      const applied = applyStructuredOperations(projectSession, patch.action.operations);
      if (!applied.ok) {
        const ledger = persistCapabilityEvidence({
          capability: 'structured_edit',
          action,
          projectSession,
          payload,
          ok: false,
          status: 'failed',
          message: applied.message,
          patch: patchData,
          applied: applied.applied || [],
          errors: applied.errors || ['structured_edit_write_failed'],
        });
        return {
          ok: false,
          status: 'failed',
          message: applied.message,
          errors: applied.errors,
          data: { patch: patchData, applied: applied.applied || [], ledger },
          result: { patch, applied },
        };
      }

      const ledger = persistCapabilityEvidence({
        capability: 'structured_edit',
        action,
        projectSession,
        payload,
        ok: true,
        status: 'succeeded',
        message: 'Patch estruturado aplicado com evidência.',
        patch: patchData,
        applied: applied.applied,
      });

      return {
        ok: true,
        status: 'succeeded',
        message: 'Patch estruturado aplicado com evidência.',
        data: {
          patch: patchData,
          applied: applied.applied,
          ledger,
        },
        result: { patch, applied },
      };
    },
  };

  const blueprintContractCapabilityService = createBlueprintContractCapabilityService({
    automataContractLedgerService,
    fs,
    path,
  });

  const externalMcpCapabilityService = externalMcpService || createExternalMcpBridgeService({
    servers: externalMcpServers,
    transports: externalMcpTransports,
    transportFactory: externalMcpTransportFactory || createExternalMcpTransportFactory(),
    now,
  });

  const blueprintContractAdapter = {
    capability: 'blueprint_contract',
    actions: ['validate', 'repair', 'suggest', 'stage', 'trial', 'promote'],
    permission: 'write',
    description: 'Valida, repara, evidencia e promove contratos de blueprint via MCP.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint: { type: 'object' },
        operations: { type: 'array' },
        stack: { type: 'string' },
        moduleContract: { type: 'object' },
        coverageContract: { type: 'object' },
        visualEvidence: { type: 'object' },
        sourcePolicy: { type: 'object' },
        ledgerEntryId: { type: 'string' },
      },
    },
    async handle({ action, payload, projectSession }) {
      const result = await blueprintContractCapabilityService.handle({ action, payload, projectSession });
      const ledger = persistCapabilityEvidence({
        capability: 'blueprint_contract',
        action,
        projectSession,
        payload,
        ok: result.ok,
        status: result.status,
        message: result.message,
        errors: result.errors || [],
        warnings: result.warnings || [],
        artifacts: result.artifacts || [],
        data: result.data || {},
      });
      return {
        ...result,
        data: {
          ...(result.data || {}),
          ledger,
        },
      };
    },
  };

  const externalMcpAdapter = {
    capability: 'external_mcp',
    actions: ['servers', 'discover_tools', 'call_tool'],
    permission: 'write',
    description: 'Descobre e executa tools de servidores MCP externos aprovados com política, sessão de projeto e evidência.',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' },
        toolName: { type: 'string' },
        arguments: { type: 'object' },
        refresh: { type: 'boolean' },
      },
    },
    async handle({ action, payload, projectSession }) {
      let result = null;
      if (action === 'servers') {
        const servers = externalMcpCapabilityService.listServers();
        result = {
          ok: true,
          status: 'succeeded',
          message: 'Servidores MCP externos listados.',
          artifacts: [],
          data: { servers },
          result: { servers },
        };
      } else if (action === 'discover_tools') {
        result = await externalMcpCapabilityService.discoverTools({
          serverId: payload.serverId,
          projectSession,
          refresh: Boolean(payload.refresh),
        });
      } else {
        result = await externalMcpCapabilityService.callTool({
          serverId: payload.serverId,
          toolName: payload.toolName,
          arguments: payload.arguments || payload.input || payload.params || {},
          projectSession,
        });
      }

      const ledger = persistCapabilityEvidence({
        capability: 'external_mcp',
        action,
        projectSession,
        payload,
        ok: result.ok,
        status: result.status,
        message: result.message,
        errors: result.errors || [],
        warnings: result.warnings || [],
        artifacts: result.artifacts || [],
        data: result.data || {},
      });
      return {
        ...result,
        data: {
          ...(result.data || {}),
          ledger,
        },
      };
    },
  };

  const gateway = createCapabilityGateway({
    adapters: [
      filesystemAdapter,
      terminalAdapter,
      browserPreviewAdapter,
      gitAdapter,
      structuredEditAdapter,
      blueprintContractAdapter,
      externalMcpAdapter,
    ],
    now,
    sessionFactory: buildProjectSession,
  });

  return {
    closeExternalMcpTransports: () => (
      externalMcpCapabilityService && typeof externalMcpCapabilityService.close === 'function'
        ? externalMcpCapabilityService.close()
        : { ok: true, closed: [] }
    ),
    executeCapability: gateway.executeCapability,
    listCapabilities: gateway.listCapabilities,
  };
}

module.exports = {
  createFaberCapabilityAdapterService,
};
