const PROJECT_BLUEPRINT_CONTRACT_VALIDATION_SCHEMA_VERSION = 'project-blueprint-contract-validation-v1';

function normalizeBlueprintValidationPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function uniqueValidationList(values = []) {
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

function listWriteOperationPaths(operations = []) {
  return (Array.isArray(operations) ? operations : [])
    .filter((operation) => operation && (operation.op === 'write_file' || operation.op === 'append_file'))
    .map((operation) => normalizeBlueprintValidationPath(operation.path))
    .filter(Boolean);
}

function listWriteOperations(operations = []) {
  return (Array.isArray(operations) ? operations : [])
    .filter((operation) => operation && (operation.op === 'write_file' || operation.op === 'append_file'))
    .map((operation) => ({
      ...operation,
      path: normalizeBlueprintValidationPath(operation.path),
      content: typeof operation.content === 'string' ? operation.content : '',
    }))
    .filter((operation) => operation.path);
}

function inferRequiredBlueprintFiles({ stack = '', stackProfile = null } = {}) {
  const profileRequired = stackProfile && stackProfile.blueprint && Array.isArray(stackProfile.blueprint.requiredFiles)
    ? stackProfile.blueprint.requiredFiles.map(normalizeBlueprintValidationPath).filter(Boolean)
    : null;
  if (profileRequired && profileRequired.length) return uniqueValidationList(profileRequired);
  if (stack === 'lamp') return ['index.php', 'style.css', 'script.js'];
  if (stack === 'next-tailwind') return ['package.json', 'app/layout.tsx', 'app/page.tsx', 'app/globals.css'];
  return ['index.html', 'style.css', 'script.js'];
}

function pushCheck(checks, id, status, details = {}) {
  checks.push({
    id,
    status,
    ...details,
  });
}

function createIssue(id, message, details = {}) {
  return {
    id,
    message,
    ...details,
  };
}

function validateRequiredFiles({ stack = '', stackProfile = null, operations = [] } = {}, issues, checks) {
  const requiredFiles = inferRequiredBlueprintFiles({ stack, stackProfile });
  const writes = new Set(listWriteOperationPaths(operations));
  const missing = requiredFiles.filter((file) => !writes.has(file));
  if (missing.length) {
    issues.push(createIssue('required_files_missing', 'Blueprint não gerou todos os arquivos mínimos do contrato.', {
      severity: 'blocker',
      missing,
    }));
  }
  pushCheck(checks, 'required_files', missing.length ? 'failed' : 'passed', {
    requiredFiles,
    missing,
  });
}

function validateCoverageContract({ coverageContract = null, stack = '' } = {}, issues, checks) {
  if (!coverageContract || typeof coverageContract !== 'object') {
    issues.push(createIssue('coverage_contract_missing', 'Blueprint sem contrato de cobertura.', { severity: 'blocker' }));
    pushCheck(checks, 'coverage_contract', 'failed');
    return;
  }
  const strictCoverageGate = stack === 'next-tailwind';
  const passed = coverageContract.status === 'passed' &&
    (!coverageContract.evaluation || coverageContract.evaluation.passes !== false);
  if (!passed && strictCoverageGate) {
    issues.push(createIssue('coverage_contract_failed', 'Contrato de cobertura da blueprint não passou.', {
      severity: 'blocker',
      coverageStatus: coverageContract.status || '',
    }));
  }
  pushCheck(checks, 'coverage_contract', passed ? 'passed' : (strictCoverageGate ? 'failed' : 'warning'), {
    coverageStatus: coverageContract.status || '',
    strictCoverageGate,
  });
}

function validateModuleContract({ moduleContract = null } = {}, issues, checks) {
  if (!moduleContract || typeof moduleContract !== 'object') {
    issues.push(createIssue('module_contract_missing', 'Blueprint sem moduleContract.', { severity: 'blocker' }));
    pushCheck(checks, 'module_contract', 'failed');
    return;
  }
  const valid = moduleContract.schemaVersion === 'blueprint-module-contract-v1' &&
    moduleContract.slots &&
    typeof moduleContract.slots === 'object';
  if (!valid) {
    issues.push(createIssue('module_contract_invalid', 'moduleContract não segue o contrato esperado.', {
      severity: 'blocker',
      schemaVersion: moduleContract.schemaVersion || '',
    }));
  }
  pushCheck(checks, 'module_contract', valid ? 'passed' : 'failed', {
    moduleStatus: moduleContract.status || '',
    schemaVersion: moduleContract.schemaVersion || '',
  });
}

function listResponsiveHeaderOperations(operations = []) {
  return listWriteOperations(operations)
    .filter((operation) => /^app\/(?:[^/]+\/)*page\.tsx$/.test(operation.path))
    .filter((operation) =>
      /Abrir menu de navegação|Navegação principal mobile|BlueprintResponsiveHeader/.test(operation.content)
    );
}

function validateNextResponsiveNavigation({ moduleContract = null, operations = [] } = {}, issues, checks) {
  const responsive = moduleContract &&
    moduleContract.visualContracts &&
    moduleContract.visualContracts.responsiveNavigation
    ? moduleContract.visualContracts.responsiveNavigation
    : null;
  const contractOk = Boolean(
    responsive &&
    responsive.schemaVersion === 'blueprint-responsive-navigation-v1' &&
    responsive.mobileNavigation === 'hamburger' &&
    responsive.mobileUntil === 'lg' &&
    responsive.desktopNavigation === 'inline_links' &&
    responsive.desktopFrom === 'lg' &&
    responsive.hamburgerPlacement === 'header_right_absolute' &&
    responsive.overflowPolicy === 'no_horizontal_scroll'
  );
  if (!contractOk) {
    issues.push(createIssue('responsive_navigation_contract_invalid', 'Contrato de navegação responsiva ausente ou inválido.', {
      severity: 'blocker',
      responsiveNavigation: responsive || null,
    }));
  }

  const headerOperations = listResponsiveHeaderOperations(operations);
  const invalidHeaders = [];
  for (const operation of headerOperations) {
    const content = operation.content || '';
    const failures = [];
    if (!content.includes('lg:hidden')) failures.push('missing_lg_hidden_hamburger');
    if (!content.includes('lg:flex')) failures.push('missing_lg_desktop_nav');
    if (!content.includes('absolute right-5')) failures.push('hamburger_not_pinned_right');
    if (!content.includes('max-w-[calc(100vw-7.5rem)]')) failures.push('brand_does_not_reserve_hamburger_space');
    if (content.includes('md:hidden')) failures.push('uses_md_hidden_breakpoint');
    if (failures.length) invalidHeaders.push({ path: operation.path, failures });
  }

  if (!headerOperations.length) {
    issues.push(createIssue('responsive_header_missing', 'Blueprint Next não gerou header responsivo auditável.', {
      severity: 'blocker',
    }));
  }
  if (invalidHeaders.length) {
    issues.push(createIssue('responsive_header_invalid', 'Header responsivo viola o contrato visual da blueprint.', {
      severity: 'blocker',
      invalidHeaders,
    }));
  }
  pushCheck(checks, 'responsive_navigation', contractOk && headerOperations.length && !invalidHeaders.length ? 'passed' : 'failed', {
    headerFiles: headerOperations.map((operation) => operation.path),
    invalidHeaders,
  });
}

function temporaryRoutePath(routeId = '', stack = '') {
  const clean = String(routeId || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean) return stack === 'static-web' ? 'index.html' : '';
  if (stack === 'static-web') return `${clean}.html`;
  if (stack === 'lamp') return clean === 'index' ? 'index.php' : `${clean}.php`;
  return `app/${clean}/page.tsx`;
}

function validateTemporaryBlueprintContract({ stack = '', moduleContract = null, operations = [] } = {}, issues, checks) {
  const temporary = moduleContract && moduleContract.temporaryBlueprintContract
    ? moduleContract.temporaryBlueprintContract
    : null;
  if (!temporary) {
    pushCheck(checks, 'temporary_blueprint_contract', 'skipped');
    return;
  }
  const requiredPages = Array.isArray(temporary.requiredPages) ? temporary.requiredPages : [];
  const writes = new Set(listWriteOperationPaths(operations));
  const missingPages = requiredPages
    .map((page) => temporaryRoutePath(typeof page === 'string' ? page : page.id, stack))
    .filter(Boolean)
    .filter((routePath) => !writes.has(routePath));
  const safeActivation = [
    'auto_synthesized_current_briefing',
    'temporary',
  ].includes(temporary.activation);
  const memoryPolicy = temporary.memoryPolicy && typeof temporary.memoryPolicy === 'object'
    ? temporary.memoryPolicy
    : {};
  const validPolicy = temporary.source === 'current_briefing' &&
    temporary.status === 'active' &&
    safeActivation &&
    temporary.schemaVersion === 'temporary-blueprint-contract-v1' &&
    memoryPolicy.staleContextAllowed === false &&
    memoryPolicy.source === 'current_message_only' &&
    memoryPolicy.contaminationGuard === 'do_not_complete_with_active_memory';
  if (!validPolicy) {
    issues.push(createIssue('temporary_blueprint_contract_invalid', 'Contrato temporário não declara política segura de origem/ativação.', {
      severity: 'blocker',
      temporary,
    }));
  }
  if (missingPages.length) {
    issues.push(createIssue('temporary_blueprint_pages_missing', 'Contrato temporário não gerou todas as rotas obrigatórias.', {
      severity: 'blocker',
      missingPages,
    }));
  }
  pushCheck(checks, 'temporary_blueprint_contract', validPolicy && !missingPages.length ? 'passed' : 'failed', {
    requiredPages,
    missingPages,
    source: temporary.source || '',
    activation: temporary.activation || '',
  });
}

function validateProjectBlueprintContract({
  stack = '',
  stackProfile = null,
  operations = [],
  moduleContract = null,
  coverageContract = null,
} = {}) {
  const issues = [];
  const checks = [];
  validateRequiredFiles({ stack, stackProfile, operations }, issues, checks);
  validateModuleContract({ moduleContract }, issues, checks);
  validateCoverageContract({ coverageContract, stack }, issues, checks);
  if (stack === 'next-tailwind') {
    validateNextResponsiveNavigation({ moduleContract, operations }, issues, checks);
  } else {
    pushCheck(checks, 'responsive_navigation', 'skipped', { stack });
  }
  validateTemporaryBlueprintContract({ stack, moduleContract, operations }, issues, checks);

  return {
    schemaVersion: PROJECT_BLUEPRINT_CONTRACT_VALIDATION_SCHEMA_VERSION,
    ok: issues.length === 0,
    status: issues.length === 0 ? 'passed' : 'blocked',
    gate: issues.length === 0 ? 'allow' : 'block',
    checks,
    issues,
  };
}

module.exports = {
  PROJECT_BLUEPRINT_CONTRACT_VALIDATION_SCHEMA_VERSION,
  validateProjectBlueprintContract,
};
