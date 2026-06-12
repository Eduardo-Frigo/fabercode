const defaultCrypto = require('crypto');
const defaultFs = require('fs');
const defaultOs = require('os');
const defaultPath = require('path');

const DEFAULT_COPY_EXCLUDED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '.faber',
  'build',
  'dist',
  'coverage',
]);

const NODE_MODULES_DIR = 'node_modules';
const DEFAULT_VERIFICATION_TIMEOUT_MS = 180000;
const DEFAULT_VISUAL_TIMEOUT_MS = 90000;

function normalizeVerifiedExecutionPath(value = '') {
  return String(value || '').replace(/\\/g, '/');
}

function resolveActionTaskType(action = {}) {
  if (action && action.executionCommand && action.executionCommand.task_type) {
    return String(action.executionCommand.task_type || '').trim().toLowerCase();
  }
  return String(action && action.type ? action.type : '').trim().toLowerCase();
}

function shouldVerifyAction(action = {}) {
  const taskType = resolveActionTaskType(action);
  return taskType === 'apply_file_patch' || taskType === 'execute_operation_batch' || taskType === 'operation_batch';
}

function cloneActionForRoot(action = {}, rootPath = '') {
  const cloned = {
    ...(action || {}),
    rootPath,
  };
  if (action && action.executionCommand && typeof action.executionCommand === 'object') {
    cloned.executionCommand = {
      ...action.executionCommand,
      root_path: rootPath,
    };
  }
  return cloned;
}

function summarizeCommandResults(verification = null) {
  const results = Array.isArray(verification && verification.results) ? verification.results : [];
  return results
    .filter((result) => result && result.commandText)
    .map((result) => ({
      id: result.id || '',
      commandText: result.commandText,
      status: result.status || '',
      required: Boolean(result.required),
      detail: result.detail || '',
    }));
}

function buildVerificationFailureMessage(verification = null, visualValidation = null) {
  const lines = ['A execucao foi bloqueada antes de promover o patch: a validacao real no clone temporario falhou.'];
  if (verification && verification.message) lines.push(verification.message);
  const failed = Array.isArray(verification && verification.results)
    ? verification.results.filter((result) => result && ['failed', 'blocked', 'manual'].includes(result.status))
    : [];
  for (const result of failed.slice(0, 5)) {
    const label = result.commandText ? `${result.label} (${result.commandText})` : result.label;
    lines.push(`- ${label}: ${result.detail || result.status}`);
  }
  if (visualValidation && visualValidation.required && visualValidation.status !== 'passed') {
    lines.push(`- Validacao visual: ${visualValidation.summary || visualValidation.status}`);
  }
  return lines.join('\n');
}

function normalizeTimeoutMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1000, Math.min(parsed, 10 * 60 * 1000));
}

function isAbortSignalAborted(signal = null) {
  return Boolean(signal && signal.aborted);
}

function withTimeout(promise, timeoutMs, label = 'operacao', onTimeout = null) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label} excedeu ${timeoutMs}ms.`);
        error.code = 'verified_execution_timeout';
        if (typeof onTimeout === 'function') {
          try {
            onTimeout(error);
          } catch {
            // best effort abort hook
          }
        }
        reject(error);
      }, timeoutMs);
    }),
  ]);
}

function buildVerificationTimeoutResult(timeoutMs, error = null) {
  const detail = error && error.message ? error.message : `Verificacao operacional excedeu ${timeoutMs}ms.`;
  return {
    ok: false,
    ready: false,
    results: [
      {
        id: 'verified_execution_timeout',
        label: 'Timeout da validacao operacional',
        status: 'failed',
        required: true,
        commandText: 'verified execution',
        detail,
      },
    ],
    warnings: [],
    summary: { passed: 0, failed: 1, warnings: 0, blocked: 0, manual: 0 },
    message: detail,
  };
}

function buildVisualTimeoutResult(timeoutMs, error = null) {
  const detail = error && error.message ? error.message : `Validacao visual excedeu ${timeoutMs}ms.`;
  return {
    required: true,
    status: 'failed',
    summary: detail,
    issues: [
      {
        id: 'visual_validation_timeout',
        severity: 'error',
        detail,
        hint: 'Interrompa o preview preso, corrija a causa e rode nova captura antes de promover.',
      },
    ],
  };
}

function buildDiagnosticsHintFromVerifiedExecution(result = null) {
  if (!result || typeof result !== 'object') return null;
  const stagedValidation = result.stagedValidation && typeof result.stagedValidation === 'object'
    ? result.stagedValidation
    : null;
  const verification = (stagedValidation && stagedValidation.verification) || result.verification || null;
  const visualValidation = (stagedValidation && stagedValidation.visualValidation) || result.visualValidation || null;
  const issues = [];

  const verificationResults = Array.isArray(verification && verification.results) ? verification.results : [];
  for (const entry of verificationResults) {
    if (!entry) continue;
    const status = String(entry.status || '').toLowerCase();
    if (!['failed', 'blocked', 'manual'].includes(status)) continue;
    const label = entry.label || entry.id || 'Validacao operacional';
    const command = entry.commandText ? ` (${entry.commandText})` : '';
    issues.push({
      file: entry.commandText || entry.id || 'project',
      severity: status === 'manual' ? 'warning' : 'error',
      detail: `${label}${command}: ${entry.detail || status}`,
      hint: entry.commandText
        ? `Investigue os arquivos relacionados ate \`${entry.commandText}\` passar no clone temporario.`
        : 'Corrija a causa antes de promover o patch para o projeto real.',
      source: `verified_execution:${entry.id || status}`,
    });
  }

  if (visualValidation && visualValidation.required && visualValidation.status !== 'passed') {
    const visualIssues = Array.isArray(visualValidation.issues) ? visualValidation.issues : [];
    if (visualIssues.length) {
      for (const issue of visualIssues.slice(0, 8)) {
        issues.push({
          file:
            visualValidation.capture && visualValidation.capture.artifactPath
              ? visualValidation.capture.artifactPath
              : 'preview',
          severity: issue && issue.severity ? String(issue.severity) : 'error',
          detail: issue && issue.detail ? String(issue.detail) : visualValidation.summary || 'Falha visual detectada.',
          hint: issue && issue.hint ? String(issue.hint) : 'Use a captura visual para orientar a reparacao.',
          source: `verified_execution:visual:${issue && issue.id ? issue.id : 'issue'}`,
        });
      }
    } else {
      issues.push({
        file:
          visualValidation.capture && visualValidation.capture.artifactPath
            ? visualValidation.capture.artifactPath
            : 'preview',
        severity: 'error',
        detail: visualValidation.summary || `Validacao visual ${visualValidation.status || 'falhou'}.`,
        hint: 'Reproduza o preview e capture nova screenshot antes de concluir.',
        source: 'verified_execution:visual',
      });
    }
  }

  if (!issues.length && result.message) {
    issues.push({
      file: result.stageRoot || 'staging',
      severity: 'error',
      detail: String(result.message),
      hint: 'Ajuste o patch proposto e rode novamente no clone temporario antes da promocao.',
      source: 'verified_execution:staging',
    });
  }

  if (!issues.length) return null;
  const errors = issues.filter((issue) => {
    const severity = String(issue.severity || '').toLowerCase();
    return severity === 'error' || severity === 'critical';
  }).length;

  return {
    summary: {
      total: issues.length,
      errors,
      warnings: issues.length - errors,
    },
    issues: issues.slice(0, 40),
  };
}

function createProjectVerifiedExecutionService(dependencies = {}) {
  const {
    copyExcludedDirs = DEFAULT_COPY_EXCLUDED_DIRS,
    crypto = defaultCrypto,
    executeAction = () => ({ ok: false, message: 'Executor indisponivel.' }),
    fs = defaultFs,
    nodeModulesCopyMode = 'copy',
    os = defaultOs,
    path = defaultPath,
    runProjectVerification = async () => ({ ok: false, ready: false, message: 'Verificacao indisponivel.' }),
    runProjectVisualValidation = async () => null,
    scanProject = (rootPath) => ({ rootPath, files: [], stacks: [], totalFiles: 0, counters: {} }),
  } = dependencies;

  const excludedDirSet = copyExcludedDirs instanceof Set ? copyExcludedDirs : new Set(copyExcludedDirs || []);

  function safeHash(value = '') {
    try {
      return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
    } catch {
      return String(Date.now());
    }
  }

  function createStagingRoot(sourceRoot = '') {
    const stem = `faber-verified-${safeHash(sourceRoot)}-`;
    return fs.mkdtempSync(path.join(os.tmpdir(), stem));
  }

  function shouldSkipCopyEntry(entryName = '') {
    if (!entryName) return true;
    return excludedDirSet.has(entryName);
  }

  function copyProjectToStage(sourceRoot, stageRoot) {
    const copied = [];
    const linked = [];
    const materialized = [];
    const skipped = [];
    const shouldSymlinkNodeModules = String(nodeModulesCopyMode || '').toLowerCase() === 'symlink';

    function copyRecursive(sourcePath, targetPath, relPath = '', insideNodeModules = false) {
      const stat = fs.lstatSync(sourcePath);
      const name = path.basename(sourcePath);
      const posixRel = normalizeVerifiedExecutionPath(relPath);

      if (stat.isDirectory()) {
        const nextInsideNodeModules = insideNodeModules || name === NODE_MODULES_DIR;
        if (name === NODE_MODULES_DIR && !insideNodeModules && shouldSymlinkNodeModules) {
          try {
            fs.symlinkSync(sourcePath, targetPath, 'dir');
            linked.push(posixRel || name);
          } catch {
            skipped.push(posixRel || name);
          }
          return;
        }

        if (name === NODE_MODULES_DIR && !insideNodeModules) {
          materialized.push(posixRel || name);
        }

        fs.mkdirSync(targetPath, { recursive: true });
        const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
        for (const entry of entries) {
          if (!nextInsideNodeModules && shouldSkipCopyEntry(entry.name)) {
            skipped.push(normalizeVerifiedExecutionPath(path.join(posixRel, entry.name)));
            continue;
          }
          copyRecursive(
            path.join(sourcePath, entry.name),
            path.join(targetPath, entry.name),
            path.join(posixRel, entry.name),
            nextInsideNodeModules
          );
        }
        return;
      }

      if (stat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(sourcePath);
        fs.symlinkSync(linkTarget, targetPath);
        linked.push(posixRel);
        return;
      }

      if (!stat.isFile()) {
        skipped.push(posixRel);
        return;
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      copied.push(posixRel);
    }

    copyRecursive(sourceRoot, stageRoot, '');
    return {
      copiedCount: copied.length,
      linked,
      materialized,
      skipped: skipped.slice(0, 80),
    };
  }

  function removeStagingRoot(stageRoot = '') {
    if (!stageRoot) return;
    try {
      fs.rmSync(stageRoot, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }

  async function runStagedVerification(stageProjectInfo, {
    action = null,
    userMessage = '',
    executionIntent = '',
    artifactContext = '',
    verificationOptions = {},
    visualOptions = {},
  } = {}) {
    const verificationTimeoutMs = normalizeTimeoutMs(
      verificationOptions.overallTimeoutMs || verificationOptions.timeoutMs,
      DEFAULT_VERIFICATION_TIMEOUT_MS
    );
    let verification = null;
    const externalSignal = verificationOptions.signal || null;
    const verificationAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let abortListener = null;
    if (externalSignal && verificationAbortController && typeof externalSignal.addEventListener === 'function') {
      abortListener = () => verificationAbortController.abort();
      if (externalSignal.aborted) {
        verificationAbortController.abort();
      } else {
        externalSignal.addEventListener('abort', abortListener, { once: true });
      }
    }
    try {
      verification = await withTimeout(
        runProjectVerification(stageProjectInfo, {
          ...verificationOptions,
          signal: verificationAbortController ? verificationAbortController.signal : verificationOptions.signal,
        }),
        verificationTimeoutMs,
        'Verificacao operacional',
        () => {
          if (verificationAbortController) verificationAbortController.abort();
        }
      );
    } catch (error) {
      verification = buildVerificationTimeoutResult(verificationTimeoutMs, error);
    } finally {
      if (externalSignal && abortListener && typeof externalSignal.removeEventListener === 'function') {
        externalSignal.removeEventListener('abort', abortListener);
      }
    }
    const verificationAborted =
      isAbortSignalAborted(externalSignal) ||
      isAbortSignalAborted(verificationAbortController ? verificationAbortController.signal : null);
    let visualValidation = null;
    if (visualOptions && visualOptions.enabled === true && !verificationAborted) {
      const visualTimeoutMs = normalizeTimeoutMs(visualOptions.timeoutMs, DEFAULT_VISUAL_TIMEOUT_MS);
      try {
        visualValidation = await withTimeout(
          runProjectVisualValidation(stageProjectInfo, {
            action,
            userMessage,
            executionIntent,
            artifactContext,
            signal: verificationAbortController ? verificationAbortController.signal : externalSignal,
            force: visualOptions.force === true,
            previewOptions: visualOptions.previewOptions || {},
            captureOptions: visualOptions.captureOptions || {},
          }),
          visualTimeoutMs,
          'Validacao visual'
        );
      } catch (error) {
        visualValidation = buildVisualTimeoutResult(visualTimeoutMs, error);
      }
    }

    const visualReady =
      !visualValidation ||
      !visualValidation.required ||
      visualValidation.status === 'passed';
    const ready = Boolean(verification && verification.ready && visualReady);

    return {
      ok: ready,
      ready,
      verification,
      visualValidation,
      commandResults: summarizeCommandResults(verification),
      message: ready
        ? 'Validacao temporaria concluida; patch liberado para promocao.'
        : buildVerificationFailureMessage(verification, visualValidation),
    };
  }

  async function executeVerified(action = {}, projectInfo = {}, options = {}) {
    const sourceRoot = String(projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '').trim();
    if (!sourceRoot || !fs.existsSync(sourceRoot)) {
      return { ok: false, message: 'Projeto indisponivel para execucao verificada.' };
    }

    if (!shouldVerifyAction(action)) {
      return executeAction(action);
    }

    const stageRoot = createStagingRoot(sourceRoot);
    const startedAt = new Date().toISOString();
    let copySummary = null;
    let stagedExecution = null;
    let stagedValidation = null;

    try {
      copySummary = copyProjectToStage(sourceRoot, stageRoot);
      const stagedAction = cloneActionForRoot(action, stageRoot);
      stagedExecution = executeAction(stagedAction);
      if (!stagedExecution || !stagedExecution.ok) {
        return {
          ...(stagedExecution || { ok: false }),
          ok: false,
          staged: true,
          promoted: false,
          stageRoot,
          stageCleaned: options.keepStage !== true,
          message:
            (stagedExecution && stagedExecution.message) ||
            'A execucao no clone temporario falhou; nada foi promovido ao projeto real.',
        };
      }

      const stageProjectInfo = scanProject(stageRoot);
      stagedValidation = await runStagedVerification(stageProjectInfo, {
        action: stagedAction,
        userMessage: options.userMessage || action.userMessage || '',
        executionIntent: options.executionIntent || action.intent || '',
        artifactContext: options.artifactContext || action.artifactContext || '',
        verificationOptions: options.verificationOptions || {},
        visualOptions: options.visualOptions || {},
      });

      if (!stagedValidation.ok) {
        return {
          ok: false,
          staged: true,
          promoted: false,
          stageRoot,
          stageCleaned: options.keepStage !== true,
          copySummary,
          stagedExecution,
          stagedValidation,
          verification: stagedValidation.verification,
          visualValidation: stagedValidation.visualValidation,
          commandResults: stagedValidation.commandResults,
          message: stagedValidation.message,
        };
      }

      const promotedResult = executeAction(action);
      return {
        ...promotedResult,
        staged: true,
        promoted: Boolean(promotedResult && promotedResult.ok),
        stageRoot,
        stageCleaned: options.keepStage !== true,
        copySummary,
        stagedExecution,
        stagedValidation,
        verification: stagedValidation.verification,
        visualValidation: stagedValidation.visualValidation,
        commandResults: stagedValidation.commandResults,
        verifiedExecution: {
          startedAt,
          finishedAt: new Date().toISOString(),
          stageRoot,
          copySummary,
          commandResults: stagedValidation.commandResults,
          visualStatus:
            stagedValidation.visualValidation && stagedValidation.visualValidation.status
              ? stagedValidation.visualValidation.status
              : 'not_run',
        },
      };
    } finally {
      if (options.keepStage !== true) {
        removeStagingRoot(stageRoot);
      }
    }
  }

  return {
    buildDiagnosticsHintFromVerifiedExecution,
    cloneActionForRoot,
    copyProjectToStage,
    executeVerified,
    runStagedVerification,
    shouldVerifyAction,
  };
}

module.exports = {
  buildDiagnosticsHintFromVerifiedExecution,
  createProjectVerifiedExecutionService,
  cloneActionForRoot,
  shouldVerifyAction,
};
