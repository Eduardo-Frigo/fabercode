const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildDiagnosticsHintFromVerifiedExecution,
  createProjectVerifiedExecutionService,
  PROCESS_EXECUTION_POLICIES,
  PROCESS_EXECUTION_PENDING_CHECKS,
  PROCESS_EXECUTION_VALIDATION_PENDING_REASON,
} = require('../main/services/project_verified_execution_service');

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createProjectInfo(rootPath) {
  return {
    rootPath,
    files: ['package.json', 'app.txt'],
    stacks: ['React'],
    totalFiles: 2,
    counters: {},
  };
}

function createFakeExecutor() {
  return (action = {}) => {
    const rootPath = String(action.rootPath || '');
    const operations = Array.isArray(action.operations)
      ? action.operations
      : action.executionCommand && Array.isArray(action.executionCommand.operations)
        ? action.executionCommand.operations
        : [];

    for (const operation of operations) {
      if (operation.op === 'mkdir') {
        fs.mkdirSync(path.join(rootPath, operation.path), { recursive: true });
        continue;
      }
      if (operation.op === 'write_file') {
        writeFile(path.join(rootPath, operation.path), operation.content || '');
      }
    }

    return {
      ok: true,
      modifiedFiles: operations.filter((operation) => operation.op === 'write_file').map((operation) => operation.path),
      diffStats: {},
      message: 'fake execution ok',
    };
  };
}

function assertNoTruthyVerifiedClaims(value, currentPath = 'result') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/verified/i.test(key)) {
      assert.strictEqual(Boolean(child), false, `${currentPath}.${key} must not claim verification`);
    }
    assertNoTruthyVerifiedClaims(child, `${currentPath}.${key}`);
  }
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-verified-exec-test-'));
  const projectRoot = path.join(tempRoot, 'project');
  writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: {
      build: 'node build.js',
      test: 'node test.js',
      'test:e2e': 'playwright test',
    },
    devDependencies: {
      '@playwright/test': '^1.0.0',
    },
  }, null, 2));
  writeFile(path.join(projectRoot, 'app.txt'), 'original');
  writeFile(path.join(projectRoot, 'node_modules', 'fake-package', 'dist', 'index.js'), 'module.exports = {};');

  const verificationRoots = [];
  const service = createProjectVerifiedExecutionService({
    crypto,
    executeAction: createFakeExecutor(),
    fs,
    os,
    path,
    scanProject: (rootPath) => createProjectInfo(rootPath),
    runProjectVerification: async (projectInfo) => {
      verificationRoots.push(projectInfo.rootPath);
      const appText = fs.readFileSync(path.join(projectInfo.rootPath, 'app.txt'), 'utf8');
      assert.ok(fs.existsSync(path.join(projectInfo.rootPath, 'node_modules', 'fake-package', 'dist', 'index.js')));
      const ready = appText.includes('good');
      return {
        ok: ready,
        ready,
        results: [
          {
            id: 'node_build',
            label: 'Build da aplicacao',
            status: ready ? 'passed' : 'failed',
            required: true,
            commandText: 'npm run build',
            detail: ready ? 'Comando finalizado com sucesso.' : 'build failed',
          },
          {
            id: 'node_test',
            label: 'Testes automatizados',
            status: ready ? 'passed' : 'blocked',
            required: true,
            commandText: 'npm test',
            detail: ready ? 'Comando finalizado com sucesso.' : 'test blocked',
          },
        ],
        summary: {},
        warnings: [],
        message: ready ? 'ok' : 'failed',
      };
    },
    runProjectVisualValidation: async () => ({
      required: true,
      status: 'passed',
      summary: 'Screenshot capturado.',
    }),
  });

  try {
    const suspendedPolicyInputs = [
      PROCESS_EXECUTION_POLICIES.SUSPENDED,
      null,
      false,
      'enabled',
      { mode: 'enabled' },
    ];
    for (const [index, processExecutionPolicy] of suspendedPolicyInputs.entries()) {
      const suspendedProjectRoot = path.join(tempRoot, `suspended-project-${index}`);
      writeFile(path.join(suspendedProjectRoot, 'app.txt'), 'original');
      let verificationCalls = 0;
      let visualValidationCalls = 0;
      const executionRoots = [];
      const suspendedService = createProjectVerifiedExecutionService({
        crypto,
        executeAction: (action = {}) => {
          executionRoots.push(action.rootPath);
          const executionResult = createFakeExecutor()(action);
          return index === 0
            ? {
                ...executionResult,
                verified: true,
                verifiedExecution: { visualStatus: 'passed' },
                validationPending: false,
                validationPendingReason: 'hostile_override',
                processExecutionPolicy: 'enabled',
              }
            : executionResult;
        },
        fs,
        os,
        path,
        scanProject: (rootPath) => createProjectInfo(rootPath),
        runProjectVerification: async () => {
          verificationCalls += 1;
          return { ok: true, ready: true, results: [] };
        },
        runProjectVisualValidation: async () => {
          visualValidationCalls += 1;
          return { required: true, status: 'passed' };
        },
      });

      const suspendedResult = await suspendedService.executeVerified({
        type: 'operation_batch',
        rootPath: suspendedProjectRoot,
        operations: [
          { op: 'write_file', path: 'app.txt', content: `pending validation ${index}` },
        ],
      }, createProjectInfo(suspendedProjectRoot), {
        processExecutionPolicy,
        verificationOptions: {
          processExecutionPolicy: 'enabled',
          requiredNodeScripts: ['build', 'test'],
        },
        visualOptions: {
          enabled: true,
          force: true,
          previewOptions: { autoInstall: true },
        },
      });

      assert.strictEqual(verificationCalls, 0);
      assert.strictEqual(visualValidationCalls, 0);
      assert.strictEqual(executionRoots.length, 2);
      assert.notStrictEqual(executionRoots[0], suspendedProjectRoot);
      assert.strictEqual(executionRoots[1], suspendedProjectRoot);
      assert.strictEqual(suspendedResult.ok, true);
      assert.strictEqual(suspendedResult.promoted, true);
      assert.strictEqual(suspendedResult.verified, false);
      assert.strictEqual(suspendedResult.validationPending, true);
      assert.strictEqual(
        suspendedResult.validationPendingReason,
        PROCESS_EXECUTION_VALIDATION_PENDING_REASON
      );
      assert.deepStrictEqual(suspendedResult.validationPendingChecks, PROCESS_EXECUTION_PENDING_CHECKS);
      assert.strictEqual(suspendedResult.processExecutionPolicy, PROCESS_EXECUTION_POLICIES.SUSPENDED);
      assert.strictEqual(suspendedResult.processExecutionPerformed, false);
      assert.strictEqual(suspendedResult.executionScope, 'file_mutation_only');
      assert.strictEqual(suspendedResult.fileMutationStaged, true);
      assert.strictEqual(suspendedResult.fileMutationApplied, true);
      assert.strictEqual(suspendedResult.stagedValidation.ok, false);
      assert.strictEqual(suspendedResult.stagedValidation.ready, false);
      assert.strictEqual(suspendedResult.stagedValidation.validationPending, true);
      assert.deepStrictEqual(suspendedResult.commandResults, []);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(suspendedResult, 'verifiedExecution'), false);
      assertNoTruthyVerifiedClaims(suspendedResult);
      assert.match(suspendedResult.message, /mutacao de arquivos/i);
      assert.match(suspendedResult.message, /lint, testes, build e preview/i);
      assert.match(suspendedResult.message, /validacao pendente/i);
      assert.strictEqual(
        fs.readFileSync(path.join(suspendedProjectRoot, 'app.txt'), 'utf8'),
        `pending validation ${index}`
      );
    }

    let blockedActionExecutions = 0;
    let blockedActionVerificationCalls = 0;
    let blockedActionVisualCalls = 0;
    const blockedActionService = createProjectVerifiedExecutionService({
      crypto,
      executeAction: () => {
        blockedActionExecutions += 1;
        return { ok: true, verified: true };
      },
      fs,
      os,
      path,
      runProjectVerification: async () => {
        blockedActionVerificationCalls += 1;
        return { ok: true, ready: true };
      },
      runProjectVisualValidation: async () => {
        blockedActionVisualCalls += 1;
        return { required: true, status: 'passed' };
      },
    });
    const blockedProcessActionResult = await blockedActionService.executeVerified({
      type: 'run_command',
      rootPath: projectRoot,
      command: 'npm test',
    }, createProjectInfo(projectRoot), {
      processExecutionPolicy: PROCESS_EXECUTION_POLICIES.SUSPENDED,
    });
    assert.strictEqual(blockedActionExecutions, 0);
    assert.strictEqual(blockedActionVerificationCalls, 0);
    assert.strictEqual(blockedActionVisualCalls, 0);
    assert.strictEqual(blockedProcessActionResult.ok, false);
    assert.strictEqual(blockedProcessActionResult.verified, false);
    assert.strictEqual(blockedProcessActionResult.validationPending, true);
    assert.strictEqual(
      blockedProcessActionResult.validationPendingReason,
      PROCESS_EXECUTION_VALIDATION_PENDING_REASON
    );
    assert.deepStrictEqual(blockedProcessActionResult.validationPendingChecks, PROCESS_EXECUTION_PENDING_CHECKS);
    assert.strictEqual(blockedProcessActionResult.processExecutionPerformed, false);
    assert.strictEqual(blockedProcessActionResult.executionScope, 'file_mutation_only');
    assert.strictEqual(blockedProcessActionResult.fileMutationStaged, false);
    assert.strictEqual(blockedProcessActionResult.fileMutationApplied, false);
    assertNoTruthyVerifiedClaims(blockedProcessActionResult);

    const failingResult = await service.executeVerified({
      type: 'operation_batch',
      rootPath: projectRoot,
      operations: [
        { op: 'write_file', path: 'app.txt', content: 'bad patch' },
      ],
    }, createProjectInfo(projectRoot), {
      visualOptions: { enabled: true, force: true },
    });

    assert.strictEqual(failingResult.ok, false);
    assert.strictEqual(failingResult.promoted, false);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'app.txt'), 'utf8'), 'original');
    assert.ok(failingResult.message.includes('validacao real no clone temporario'));
    const diagnostics = buildDiagnosticsHintFromVerifiedExecution(failingResult);
    assert.strictEqual(diagnostics.summary.errors, 2);
    assert.ok(diagnostics.issues.some((issue) => issue.file === 'npm run build' && /build failed/.test(issue.detail)));
    assert.ok(diagnostics.issues.some((issue) => issue.file === 'npm test' && /test blocked/.test(issue.detail)));

    const visualBlockingService = createProjectVerifiedExecutionService({
      crypto,
      executeAction: createFakeExecutor(),
      fs,
      os,
      path,
      scanProject: (rootPath) => createProjectInfo(rootPath),
      runProjectVerification: async () => ({
        ok: true,
        ready: true,
        results: [
          {
            id: 'node_build',
            label: 'Build da aplicacao',
            status: 'passed',
            required: true,
            commandText: 'npm run build',
            detail: 'Comando finalizado com sucesso.',
          },
          {
            id: 'node_test',
            label: 'Testes automatizados',
            status: 'passed',
            required: true,
            commandText: 'npm test',
            detail: 'Comando finalizado com sucesso.',
          },
        ],
        summary: {},
        warnings: [],
        message: 'ok',
      }),
      runProjectVisualValidation: async () => ({
        required: true,
        status: 'failed',
        summary: 'Smoke visual encontrou tela em branco.',
        capture: {
          artifactPath: '/tmp/faber-visual-smoke.png',
        },
        issues: [
          {
            id: 'blank_screen',
            severity: 'critical',
            detail: 'A screenshot ficou em branco.',
            hint: 'Investigue erro de runtime antes de promover.',
          },
        ],
      }),
    });

    const visualFailResult = await visualBlockingService.executeVerified({
      type: 'operation_batch',
      rootPath: projectRoot,
      operations: [
        { op: 'write_file', path: 'app.txt', content: 'good patch' },
      ],
    }, createProjectInfo(projectRoot), {
      visualOptions: { enabled: true, force: true },
    });

    assert.strictEqual(visualFailResult.ok, false);
    assert.strictEqual(visualFailResult.promoted, false);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'app.txt'), 'utf8'), 'original');
    assert.ok(visualFailResult.message.includes('Validacao visual'));
    const visualDiagnostics = buildDiagnosticsHintFromVerifiedExecution(visualFailResult);
    assert.ok(visualDiagnostics.issues.some((issue) => issue.source === 'verified_execution:visual:blank_screen'));
    assert.ok(visualDiagnostics.issues.some((issue) => issue.file === '/tmp/faber-visual-smoke.png'));

    const visualTimeoutService = createProjectVerifiedExecutionService({
      crypto,
      executeAction: createFakeExecutor(),
      fs,
      os,
      path,
      scanProject: (rootPath) => createProjectInfo(rootPath),
      runProjectVerification: async () => ({
        ok: true,
        ready: true,
        results: [],
        summary: {},
        warnings: [],
        message: 'ok',
      }),
      runProjectVisualValidation: async () => new Promise(() => {}),
    });

    const visualTimeoutResult = await visualTimeoutService.executeVerified({
      type: 'operation_batch',
      rootPath: projectRoot,
      operations: [
        { op: 'write_file', path: 'app.txt', content: 'good patch' },
      ],
    }, createProjectInfo(projectRoot), {
      visualOptions: { enabled: true, force: true, timeoutMs: 5 },
    });

    assert.strictEqual(visualTimeoutResult.ok, false);
    assert.strictEqual(visualTimeoutResult.promoted, false);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'app.txt'), 'utf8'), 'original');
    assert.ok(visualTimeoutResult.message.includes('Validacao visual'));
    const timeoutDiagnostics = buildDiagnosticsHintFromVerifiedExecution(visualTimeoutResult);
    assert.ok(timeoutDiagnostics.issues.some((issue) => issue.source === 'verified_execution:visual:visual_validation_timeout'));

    let sawVerificationAbort = false;
    const verificationTimeoutService = createProjectVerifiedExecutionService({
      crypto,
      executeAction: createFakeExecutor(),
      fs,
      os,
      path,
      scanProject: (rootPath) => createProjectInfo(rootPath),
      runProjectVerification: async (projectInfo, options = {}) => new Promise((resolve) => {
        if (options.signal && options.signal.aborted) {
          sawVerificationAbort = true;
          resolve({
            ok: false,
            ready: false,
            results: [],
            summary: {},
            warnings: [],
            message: 'aborted',
          });
          return;
        }
        options.signal.addEventListener('abort', () => {
          sawVerificationAbort = true;
          resolve({
            ok: false,
            ready: false,
            results: [],
            summary: {},
            warnings: [],
            message: 'aborted',
          });
        }, { once: true });
      }),
      runProjectVisualValidation: async () => ({
        required: false,
        status: 'skipped',
      }),
    });

    const verificationTimeoutResult = await verificationTimeoutService.executeVerified({
      type: 'operation_batch',
      rootPath: projectRoot,
      operations: [
        { op: 'write_file', path: 'app.txt', content: 'good patch' },
      ],
    }, createProjectInfo(projectRoot), {
      verificationOptions: { timeoutMs: 5 },
      visualOptions: { enabled: false },
    });

    assert.strictEqual(verificationTimeoutResult.ok, false);
    assert.strictEqual(verificationTimeoutResult.promoted, false);
    assert.strictEqual(sawVerificationAbort, true);
    assert.ok(verificationTimeoutResult.commandResults.some((result) => result.id === 'verified_execution_timeout'));

    let sawExternalAbort = false;
    let visualRanAfterExternalAbort = false;
    const externalAbortController = new AbortController();
    const externalAbortService = createProjectVerifiedExecutionService({
      crypto,
      executeAction: createFakeExecutor(),
      fs,
      os,
      path,
      scanProject: (rootPath) => createProjectInfo(rootPath),
      runProjectVerification: async (projectInfo, options = {}) => new Promise((resolve) => {
        const finish = () => {
          sawExternalAbort = true;
          resolve({
            ok: false,
            ready: false,
            results: [
              {
                id: 'verification_aborted',
                label: 'Verificação abortada',
                status: 'failed',
                required: true,
                commandText: 'npm run build',
                detail: 'Verificação operacional abortada por cancelamento.',
              },
            ],
            summary: {},
            warnings: [],
            message: 'aborted',
          });
        };
        if (options.signal && options.signal.aborted) {
          finish();
          return;
        }
        options.signal.addEventListener('abort', finish, { once: true });
      }),
      runProjectVisualValidation: async () => {
        visualRanAfterExternalAbort = true;
        return {
          required: true,
          status: 'passed',
          summary: 'visual should not run after abort',
        };
      },
    });

    const externalAbortPromise = externalAbortService.executeVerified({
      type: 'operation_batch',
      rootPath: projectRoot,
      operations: [
        { op: 'write_file', path: 'app.txt', content: 'good patch' },
      ],
    }, createProjectInfo(projectRoot), {
      verificationOptions: { signal: externalAbortController.signal },
      visualOptions: { enabled: true, force: true },
    });
    setTimeout(() => externalAbortController.abort(), 5);
    const externalAbortResult = await externalAbortPromise;

    assert.strictEqual(externalAbortResult.ok, false);
    assert.strictEqual(externalAbortResult.promoted, false);
    assert.strictEqual(sawExternalAbort, true);
    assert.strictEqual(visualRanAfterExternalAbort, false);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'app.txt'), 'utf8'), 'original');

    const passingResult = await service.executeVerified({
      type: 'operation_batch',
      rootPath: projectRoot,
      operations: [
        { op: 'write_file', path: 'app.txt', content: 'good patch' },
      ],
    }, createProjectInfo(projectRoot), {
      visualOptions: { enabled: true, force: true },
    });

    assert.strictEqual(passingResult.ok, true);
    assert.strictEqual(passingResult.promoted, true);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'app.txt'), 'utf8'), 'good patch');
    assert.ok(Array.isArray(passingResult.commandResults));
    assert.ok(passingResult.copySummary.materialized.includes('node_modules'));
    assert.ok(verificationRoots.every((rootPath) => rootPath !== projectRoot));
    assert.ok(verificationRoots.every((rootPath) => !fs.existsSync(rootPath)));

    console.log('project-verified-execution-service.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
