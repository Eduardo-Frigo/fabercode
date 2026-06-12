const {
  validateProjectBlueprintContract,
} = require('../../cortex/orchestration/project_blueprint_contract_validation_service');
const {
  isInsideRoot,
} = require('../../cortex/capabilities/project_session_contract');

const BLUEPRINT_CONTRACT_CAPABILITY_SCHEMA_VERSION = 'faber-blueprint-contract-capability-v1';

function clipText(value = '', maxChars = 8000) {
  const text = String(value || '');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function normalizePath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeList(value = []) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function uniqueList(values = []) {
  const seen = new Set();
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function normalizeOperation(operation = {}) {
  if (!operation || typeof operation !== 'object') return null;
  const path = normalizePath(operation.path);
  if (!path) return null;
  return {
    op: operation.op || 'write_file',
    path,
    content: typeof operation.content === 'string' ? operation.content : '',
  };
}

function summarizeOperations(operations = []) {
  return (Array.isArray(operations) ? operations : [])
    .map(normalizeOperation)
    .filter(Boolean)
    .map((operation) => ({
      op: operation.op,
      path: operation.path,
      bytes: String(operation.content || '').length,
    }));
}

function resolveBlueprintContainer(payload = {}) {
  const direct = payload.blueprint && typeof payload.blueprint === 'object' ? payload.blueprint : {};
  if (direct.action && typeof direct.action === 'object') return direct.action;
  if (payload.action && typeof payload.action === 'object') return payload.action;
  return direct;
}

function resolveBlueprintMetadata(payload = {}) {
  const container = resolveBlueprintContainer(payload);
  return payload.blueprintMetadata ||
    payload.blueprintContract ||
    payload.metadata ||
    container.blueprint ||
    {};
}

function extractBlueprintInput(payload = {}) {
  const container = resolveBlueprintContainer(payload);
  const metadata = resolveBlueprintMetadata(payload);
  const operations = (
    Array.isArray(payload.operations) ? payload.operations
      : Array.isArray(container.operations) ? container.operations
        : []
  ).map(normalizeOperation).filter(Boolean);
  return {
    operations,
    stack: payload.stack || metadata.stack || '',
    stackProfile: payload.stackProfile || metadata.stackProfile || null,
    moduleContract: payload.moduleContract || metadata.moduleContract || null,
    coverageContract: payload.coverageContract || metadata.coverageContract || null,
    metadata,
  };
}

function shouldSkipProjectEntry(relPath = '') {
  return /(^|\/)(node_modules|\.next|\.git|\.faber|dist|build|coverage)(\/|$)/.test(relPath);
}

function isContractReadableFile(relPath = '') {
  return (
    /^(package\.json|next\.config\.mjs|tsconfig\.json|postcss\.config\.mjs|index\.html|index\.php|style\.css|script\.js)$/.test(relPath) ||
    /^app\/.+\.(tsx|ts|jsx|js|css)$/.test(relPath) ||
    /^src\/.+\.(tsx|ts|jsx|js|css|astro)$/.test(relPath)
  );
}

function collectProjectOperations({ fs, path, projectSession = {}, maxFiles = 160 } = {}) {
  if (!fs || !path || !projectSession.rootPath) return [];
  const root = path.resolve(projectSession.rootPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const operations = [];

  function walk(current) {
    if (operations.length >= maxFiles) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (operations.length >= maxFiles) return;
      const absPath = path.join(current, entry.name);
      const relPath = normalizePath(path.relative(root, absPath));
      if (!relPath || shouldSkipProjectEntry(relPath)) continue;
      if (entry.isDirectory()) {
        walk(absPath);
        continue;
      }
      if (!entry.isFile() || !isContractReadableFile(relPath)) continue;
      operations.push({
        op: 'write_file',
        path: relPath,
        content: fs.readFileSync(absPath, 'utf8'),
      });
    }
  }

  walk(root);
  return operations;
}

function routeFromPagePath(relPath = '') {
  const clean = normalizePath(relPath);
  if (clean === 'app/page.tsx') return '/';
  const match = clean.match(/^app\/(.+)\/page\.tsx$/);
  return match && match[1] ? `/${match[1].replace(/\/+/g, '/')}` : '';
}

function buildRouteEvidence(operations = []) {
  const routes = uniqueList((Array.isArray(operations) ? operations : [])
    .map((operation) => routeFromPagePath(operation.path))
    .filter(Boolean));
  return {
    count: routes.length,
    routes,
    files: (Array.isArray(operations) ? operations : [])
      .map((operation) => normalizePath(operation.path))
      .filter(Boolean),
  };
}

function collectOperationsText(operations = []) {
  return (Array.isArray(operations) ? operations : [])
    .map((operation) => `${operation.path || ''}\n${operation.content || ''}`)
    .join('\n');
}

function buildSourcePolicyEvidence(operations = [], payload = {}) {
  const policy = payload.sourcePolicy && typeof payload.sourcePolicy === 'object' ? payload.sourcePolicy : {};
  const forbiddenTerms = normalizeList(policy.forbiddenTerms || payload.forbiddenTerms);
  const requiredTerms = normalizeList(policy.requiredTerms || payload.requiredTerms);
  const text = normalizeText(collectOperationsText(operations));
  const forbiddenHits = forbiddenTerms.filter((term) => text.includes(normalizeText(term)));
  const missingRequiredTerms = requiredTerms.filter((term) => !text.includes(normalizeText(term)));
  const ok = forbiddenHits.length === 0 && missingRequiredTerms.length === 0;
  return {
    ok,
    status: ok ? 'passed' : 'failed',
    allowedSources: normalizeList(policy.allowedSources || payload.allowedSources),
    forbiddenSources: normalizeList(policy.forbiddenSources || payload.forbiddenSources),
    forbiddenTerms,
    requiredTerms,
    forbiddenHits,
    missingRequiredTerms,
  };
}

function normalizeRuntimeMetrics(payload = {}) {
  const visualEvidence = payload.visualEvidence && typeof payload.visualEvidence === 'object'
    ? payload.visualEvidence
    : payload.runtimeEvidence && typeof payload.runtimeEvidence === 'object'
      ? payload.runtimeEvidence
      : {};
  if (Array.isArray(visualEvidence.domMetrics)) return visualEvidence.domMetrics;
  if (Array.isArray(visualEvidence.metrics)) return visualEvidence.metrics;
  if (Array.isArray(payload.domMetrics)) return payload.domMetrics;
  if (visualEvidence.domMetrics && typeof visualEvidence.domMetrics === 'object') return [visualEvidence.domMetrics];
  if (visualEvidence.metrics && typeof visualEvidence.metrics === 'object') return [visualEvidence.metrics];
  if (payload.domMetrics && typeof payload.domMetrics === 'object') return [payload.domMetrics];
  return [];
}

function collectRuntimeArtifacts(payload = {}) {
  const visualEvidence = payload.visualEvidence && typeof payload.visualEvidence === 'object'
    ? payload.visualEvidence
    : {};
  const captures = Array.isArray(visualEvidence.captures)
    ? visualEvidence.captures
    : Array.isArray(payload.captures)
      ? payload.captures
      : [];
  return uniqueList([
    ...normalizeList(payload.artifacts),
    ...normalizeList(visualEvidence.artifacts),
    ...captures.flatMap((capture) => {
      if (!capture || typeof capture !== 'object') return [];
      if (Array.isArray(capture.artifactPaths)) return capture.artifactPaths;
      return [capture.artifactPath || capture.path || ''];
    }),
  ]);
}

function evaluateRuntimeEvidence(payload = {}) {
  const metrics = normalizeRuntimeMetrics(payload);
  const issues = [];
  const checks = [];
  for (const metric of metrics) {
    if (!metric || typeof metric !== 'object') continue;
    const width = Number(metric.innerWidth || metric.width || (metric.viewport && metric.viewport.width) || 0);
    const label = metric.label || metric.id || (width ? `${width}px` : 'viewport');
    if (metric.hasHorizontalOverflow === true) {
      issues.push({ id: 'runtime_horizontal_overflow', label, severity: 'blocker' });
    }
    if (metric.hasOldMemory === true) {
      issues.push({ id: 'runtime_stale_memory_detected', label, severity: 'blocker' });
    }
    if (width > 0 && width < 1024) {
      if (metric.hamburgerVisible === false) {
        issues.push({ id: 'runtime_mobile_hamburger_missing', label, severity: 'blocker' });
      }
      if (metric.desktopNavVisible === true) {
        issues.push({ id: 'runtime_mobile_desktop_nav_visible', label, severity: 'blocker' });
      }
    }
    if (width >= 1024) {
      if (metric.desktopNavVisible === false) {
        issues.push({ id: 'runtime_desktop_nav_missing', label, severity: 'blocker' });
      }
      if (metric.hamburgerVisible === true) {
        issues.push({ id: 'runtime_desktop_hamburger_visible', label, severity: 'blocker' });
      }
    }
    checks.push({
      label,
      width,
      hamburgerVisible: metric.hamburgerVisible,
      desktopNavVisible: metric.desktopNavVisible,
      hasHorizontalOverflow: metric.hasHorizontalOverflow,
      hasOldMemory: metric.hasOldMemory,
    });
  }
  return {
    ok: issues.length === 0,
    status: metrics.length ? (issues.length ? 'failed' : 'passed') : 'not_provided',
    checks,
    issues,
  };
}

function createBlueprintContractSuggestion({ validation, payload = {}, projectSession = {} } = {}) {
  const moduleContract = validation.moduleContract || {};
  const temporary = moduleContract.temporaryBlueprintContract || null;
  const domain = moduleContract.domain || (temporary && temporary.domain) || validation.stack || 'blueprint';
  return {
    id: temporary && temporary.domain
      ? `suggested.blueprint_contract.${temporary.domain}`
      : `suggested.blueprint_contract.${domain}`,
    title: temporary
      ? `Contrato temporário de blueprint: ${temporary.domain || domain}`
      : `Contrato de blueprint: ${domain}`,
    capability: 'create_project',
    observedMessage: payload.userMessage || payload.prompt || '',
    reason: validation.summary,
    triggerExamples: [
      'validar contrato de blueprint antes de aplicar',
      'promover contrato temporário após smoke visual',
    ],
    proposedContract: {
      kind: 'blueprint_contract_guardian',
      schemaVersion: BLUEPRINT_CONTRACT_CAPABILITY_SCHEMA_VERSION,
      stack: validation.stack,
      domain,
      moduleContractStatus: moduleContract.status || '',
      temporaryBlueprintContract: temporary
        ? {
            schemaVersion: temporary.schemaVersion || '',
            status: temporary.status || '',
            source: temporary.source || '',
            activation: temporary.activation || '',
            domain: temporary.domain || '',
            memoryPolicy: temporary.memoryPolicy || null,
            requiredPages: temporary.requiredPages || [],
            requiredSections: temporary.requiredSections || [],
          }
        : null,
      contractValidation: validation.contractValidation,
      runtimeValidation: validation.runtimeValidation,
      sourcePolicy: validation.sourcePolicy,
      routes: validation.routes.routes,
      project: {
        id: projectSession.projectId || '',
        rootPath: projectSession.rootPath || '',
      },
    },
  };
}

function summarizeModuleContract(moduleContract = null) {
  if (!moduleContract || typeof moduleContract !== 'object') return null;
  return {
    schemaVersion: moduleContract.schemaVersion || '',
    status: moduleContract.status || '',
    libraryScope: moduleContract.libraryScope || '',
    domain: moduleContract.domain || '',
    temporaryBlueprintContract: moduleContract.temporaryBlueprintContract || null,
    visualContracts: moduleContract.visualContracts || null,
    commitPolicy: moduleContract.commitPolicy || null,
  };
}

function summarizeCoverageContract(coverageContract = null) {
  if (!coverageContract || typeof coverageContract !== 'object') return null;
  const evaluation = coverageContract.evaluation && typeof coverageContract.evaluation === 'object'
    ? coverageContract.evaluation
    : {};
  return {
    schemaVersion: coverageContract.schemaVersion || '',
    status: coverageContract.status || '',
    domain: evaluation.domain || '',
    score: Number(evaluation.score || 0),
    passes: evaluation.passes !== false,
    missing: Array.isArray(evaluation.missing) ? evaluation.missing : [],
  };
}

function summarizeValidationForEvidence(validation = {}) {
  return {
    schemaVersion: validation.schemaVersion || BLUEPRINT_CONTRACT_CAPABILITY_SCHEMA_VERSION,
    ok: Boolean(validation.ok),
    status: validation.status || '',
    gate: validation.gate || '',
    stack: validation.stack || '',
    summary: validation.summary || '',
    operationsSummary: validation.operationsSummary || [],
    moduleContract: summarizeModuleContract(validation.moduleContract),
    coverageContract: summarizeCoverageContract(validation.coverageContract),
    contractValidation: validation.contractValidation || null,
    runtimeValidation: validation.runtimeValidation || null,
    sourcePolicy: validation.sourcePolicy || null,
    routes: validation.routes || null,
    artifacts: validation.artifacts || [],
    issues: validation.issues || [],
  };
}

function repairResponsiveNavigationOperations(operations = []) {
  const repairs = [];
  const repairedOperations = (Array.isArray(operations) ? operations : []).map((operation) => {
    const normalized = normalizeOperation(operation);
    if (!normalized) return operation;
    let content = normalized.content;
    const before = content;
    content = content
      .replace(/\bmd:hidden\b/g, 'lg:hidden')
      .replace(/\bmd:flex\b/g, 'lg:flex')
      .replace(/\bmd:inline-flex\b/g, 'lg:inline-flex')
      .replace(/\bmd:max-w-none\b/g, 'lg:max-w-none')
      .replace(/\bmd:pr-0\b/g, 'lg:pr-0');
    if (content !== before) {
      repairs.push({
        path: normalized.path,
        changes: ['responsive_navigation_breakpoint_lg'],
      });
      return { ...operation, content };
    }
    return operation;
  });
  return { repairs, repairedOperations };
}

function createBlueprintContractCapabilityService(dependencies = {}) {
  const {
    automataContractLedgerService = null,
    fs = null,
    path = null,
  } = dependencies;

  function resolveValidationInput({ payload = {}, projectSession = {} } = {}) {
    const extracted = extractBlueprintInput(payload);
    const operations = extracted.operations.length
      ? extracted.operations
      : collectProjectOperations({ fs, path, projectSession });
    return {
      ...extracted,
      operations,
    };
  }

  function validateBlueprintContract({ payload = {}, projectSession = {} } = {}) {
    const input = resolveValidationInput({ payload, projectSession });
    const contractValidation = validateProjectBlueprintContract({
      stack: input.stack,
      stackProfile: input.stackProfile,
      operations: input.operations,
      moduleContract: input.moduleContract,
      coverageContract: input.coverageContract,
    });
    const routes = buildRouteEvidence(input.operations);
    const sourcePolicy = buildSourcePolicyEvidence(input.operations, payload);
    const runtimeValidation = evaluateRuntimeEvidence(payload);
    const artifacts = collectRuntimeArtifacts(payload);
    const contractIssues = Array.isArray(contractValidation.issues) ? contractValidation.issues : [];
    const sourceIssues = sourcePolicy.ok ? [] : [{
      id: 'source_policy_failed',
      forbiddenHits: sourcePolicy.forbiddenHits,
      missingRequiredTerms: sourcePolicy.missingRequiredTerms,
    }];
    const runtimeIssues = Array.isArray(runtimeValidation.issues) ? runtimeValidation.issues : [];
    const issues = [...contractIssues, ...sourceIssues, ...runtimeIssues];
    const ok = issues.length === 0;
    return {
      schemaVersion: BLUEPRINT_CONTRACT_CAPABILITY_SCHEMA_VERSION,
      ok,
      status: ok ? 'passed' : 'blocked',
      gate: ok ? 'allow' : 'block',
      stack: input.stack,
      operations: input.operations,
      operationsSummary: summarizeOperations(input.operations),
      moduleContract: input.moduleContract,
      coverageContract: input.coverageContract,
      contractValidation,
      runtimeValidation,
      sourcePolicy,
      routes,
      artifacts,
      issues,
      summary: ok
        ? 'Contrato de blueprint validado pelo MCP.'
        : 'Contrato de blueprint bloqueado pelo MCP.',
    };
  }

  function requireAutomataLedger() {
    if (!automataContractLedgerService) {
      return { ok: false, reason: 'automata_contract_ledger_unavailable' };
    }
    return { ok: true, ledger: automataContractLedgerService };
  }

  function resolveLedgerEntryId(payload = {}) {
    return String(payload.ledgerEntryId || payload.entryId || payload.id || '').trim();
  }

  function writeRepairedOperations(projectSession = {}, operations = []) {
    if (!fs || !path) return { ok: false, errors: ['filesystem_unavailable'], applied: [] };
    const root = path.resolve(projectSession.rootPath || '');
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return { ok: false, errors: ['project_root_unavailable'], applied: [] };
    }
    const applied = [];
    for (const operation of operations.map(normalizeOperation).filter(Boolean)) {
      if (operation.op !== 'write_file') {
        return { ok: false, errors: ['unsupported_repair_operation'], applied };
      }
      const target = path.resolve(path.join(root, operation.path));
      if (!isInsideRoot(root, target)) {
        return { ok: false, errors: ['repair_path_outside_root'], applied };
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, operation.content, 'utf8');
      applied.push(operation.path);
    }
    return { ok: true, applied };
  }

  async function handle({ action, payload = {}, projectSession = {} } = {}) {
    if (action === 'validate') {
      const validation = validateBlueprintContract({ payload, projectSession });
      return {
        ok: validation.ok,
        status: validation.ok ? 'succeeded' : 'blocked',
        message: validation.summary,
        artifacts: validation.artifacts,
        errors: validation.issues.map((issue) => issue.id || issue.message || 'blueprint_contract_issue'),
        data: { validation: summarizeValidationForEvidence(validation) },
        result: { validation: summarizeValidationForEvidence(validation) },
      };
    }

    if (action === 'repair') {
      const initial = validateBlueprintContract({ payload, projectSession });
      if (initial.ok) {
        return {
          ok: true,
          status: 'succeeded',
          message: 'Contrato já estava válido; nenhuma correção necessária.',
          artifacts: initial.artifacts,
          data: { validation: summarizeValidationForEvidence(initial), repair: { needed: false, repairs: [] } },
          result: { validation: initial, repairedOperations: initial.operations },
        };
      }
      const { repairs, repairedOperations } = repairResponsiveNavigationOperations(initial.operations);
      const repairedPayload = {
        ...payload,
        operations: repairedOperations,
        stack: initial.stack,
        moduleContract: initial.moduleContract,
        coverageContract: initial.coverageContract,
      };
      const repaired = validateBlueprintContract({ payload: repairedPayload, projectSession });
      const applyResult = payload.apply === true || payload.write === true
        ? writeRepairedOperations(projectSession, repairedOperations)
        : { ok: true, applied: [] };
      const ok = repairs.length > 0 && repaired.ok && applyResult.ok;
      return {
        ok,
        status: ok ? 'succeeded' : 'blocked',
        message: ok
          ? 'Correção automática de contrato gerada pelo MCP.'
          : 'MCP não conseguiu reparar automaticamente a violação de contrato.',
        artifacts: repaired.artifacts,
        errors: ok ? [] : [
          ...repaired.issues.map((issue) => issue.id || issue.message || 'blueprint_contract_issue'),
          ...(applyResult.errors || []),
        ],
        data: {
          validation: summarizeValidationForEvidence(repaired),
          initialValidation: {
            ok: initial.ok,
            status: initial.status,
            issues: initial.issues,
          },
          repair: {
            needed: true,
            repairs,
            applied: applyResult.applied || [],
          },
        },
        result: {
          validation: repaired,
          repairedOperations,
          applied: applyResult.applied || [],
        },
      };
    }

    if (action === 'suggest') {
      const ledgerDependency = requireAutomataLedger();
      if (!ledgerDependency.ok) {
        return {
          ok: false,
          status: 'failed',
          message: 'Ledger de contratos indisponível para sugestão.',
          errors: [ledgerDependency.reason],
        };
      }
      const validation = validateBlueprintContract({ payload, projectSession });
      if (!validation.ok) {
        return {
          ok: false,
          status: 'blocked',
          message: 'Contrato inválido não foi sugerido para promoção.',
          errors: validation.issues.map((issue) => issue.id || issue.message || 'blueprint_contract_issue'),
          data: { validation: summarizeValidationForEvidence(validation) },
          result: { validation: summarizeValidationForEvidence(validation) },
        };
      }
      const suggestion = createBlueprintContractSuggestion({ validation, payload, projectSession });
      const ledgerResult = ledgerDependency.ledger.suggestContract(suggestion, {
        provider: 'mcp_blueprint_contract_capability',
        project: {
          projectId: projectSession.projectId || projectSession.id || '',
          rootPath: projectSession.rootPath || '',
        },
      });
      return {
        ok: Boolean(ledgerResult && ledgerResult.ok),
        status: ledgerResult && ledgerResult.ok ? 'succeeded' : 'failed',
        message: ledgerResult && ledgerResult.ok
          ? 'Contrato de blueprint sugerido ao ledger.'
          : 'Falha ao sugerir contrato de blueprint.',
        errors: ledgerResult && ledgerResult.ok ? [] : [ledgerResult && ledgerResult.reason ? ledgerResult.reason : 'contract_suggestion_failed'],
        data: { validation: summarizeValidationForEvidence(validation), automataLedger: ledgerResult },
        result: { validation: summarizeValidationForEvidence(validation), automataLedger: ledgerResult },
      };
    }

    if (action === 'stage' || action === 'trial' || action === 'promote') {
      const ledgerDependency = requireAutomataLedger();
      if (!ledgerDependency.ok) {
        return {
          ok: false,
          status: 'failed',
          message: 'Ledger de contratos indisponível.',
          errors: [ledgerDependency.reason],
        };
      }
      const entryId = resolveLedgerEntryId(payload);
      if (!entryId) {
        return {
          ok: false,
          status: 'blocked',
          message: 'Id do contrato no ledger ausente.',
          errors: ['missing_ledger_entry_id'],
        };
      }
      let ledgerResult = null;
      if (action === 'stage') {
        ledgerResult = ledgerDependency.ledger.stageContract(entryId, { note: payload.note || 'stage via MCP blueprint_contract' });
      } else if (action === 'trial') {
        const current = ledgerDependency.ledger.getEntry(entryId);
        if (current.ok && current.entry.status === 'staged') {
          ledgerResult = ledgerDependency.ledger.markTrialRunning(entryId, { note: payload.note || 'trial via MCP blueprint_contract' });
        } else {
          ledgerResult = current;
        }
        if (ledgerResult && ledgerResult.ok && Object.prototype.hasOwnProperty.call(payload, 'passed')) {
          ledgerResult = ledgerDependency.ledger.markTrialResult(ledgerResult.entry.id, {
            passed: Boolean(payload.passed),
            note: payload.note || 'trial result via MCP blueprint_contract',
            trial: payload.trial && typeof payload.trial === 'object' ? payload.trial : {},
          });
        }
      } else {
        ledgerResult = ledgerDependency.ledger.promoteContract(entryId, { note: payload.note || 'promote via MCP blueprint_contract' });
      }
      return {
        ok: Boolean(ledgerResult && ledgerResult.ok),
        status: ledgerResult && ledgerResult.ok ? 'succeeded' : 'failed',
        message: ledgerResult && ledgerResult.ok
          ? `Contrato atualizado no ledger: ${action}.`
          : `Falha ao atualizar contrato no ledger: ${action}.`,
        errors: ledgerResult && ledgerResult.ok ? [] : [ledgerResult && ledgerResult.reason ? ledgerResult.reason : 'contract_ledger_transition_failed'],
        data: { automataLedger: ledgerResult },
        result: { automataLedger: ledgerResult },
      };
    }

    return {
      ok: false,
      status: 'blocked',
      message: `Ação de contrato não suportada: ${action || '<vazia>'}.`,
      errors: ['blueprint_contract_action_unsupported'],
    };
  }

  return {
    handle,
    validateBlueprintContract,
  };
}

module.exports = {
  BLUEPRINT_CONTRACT_CAPABILITY_SCHEMA_VERSION,
  createBlueprintContractCapabilityService,
};
