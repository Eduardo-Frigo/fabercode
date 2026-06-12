const defaultFs = require('fs');
const defaultPath = require('path');
const {
  findCssImportOrderViolation,
} = require('../../cortex/orchestration/css_operation_safety');

function createPostExecutionQualityService(dependencies = {}) {
  const {
    AIDER_LINT_TIMEOUT_MS = 15000,
    AIDER_MAIN_ROOT = '',
    EXECUTION_ENFORCE_EFFECT_GATE = true,
    EXECUTION_ENFORCE_NONZERO_DIFF_ON_EDIT = true,
    POST_EXEC_QUALITY_ENABLED = true,
    POST_EXEC_QUALITY_ENFORCE_ERRORS = true,
    POST_EXEC_QUALITY_ENFORCE_WARNINGS = false,
    POST_EXEC_QUALITY_MAX_FILES = 20,
    POST_EXEC_QUALITY_MAX_ISSUES = 40,
    POST_EXEC_QUALITY_TIMEOUT_MS = 30000,
    clipTextPreserveLines = (value, max) => String(value || '').slice(0, max),
    evaluateOperationBatchArtifactQuality = null,
    fs = defaultFs,
    path = defaultPath,
    runCommand = async () => ({ ok: false, stdout: '', stderr: 'runCommand unavailable' }),
  } = dependencies;

  function buildDiagnosticsPromptContext(latestDiagnostics, { maxIssues = 6, maxChars = 1800 } = {}) {
    if (!latestDiagnostics || typeof latestDiagnostics !== 'object') return '';
    const issues = Array.isArray(latestDiagnostics.issues) ? latestDiagnostics.issues : [];
    if (!issues.length) return '';

    const selected = issues.slice(0, Math.max(1, maxIssues));
    const lines = selected.map((issue, index) => {
      const file = issue && issue.file ? issue.file : 'arquivo_desconhecido';
      const severity = issue && issue.severity ? String(issue.severity).toUpperCase() : 'WARN';
      const detail = issue && issue.detail ? String(issue.detail) : '';
      const hint = issue && issue.hint ? ` | correção sugerida: ${issue.hint}` : '';
      return `${index + 1}. [${severity}] ${file}: ${detail}${hint}`;
    });

    const summary = latestDiagnostics.summary || {};
    const header = `Diagnóstico anterior: ${Number(summary.total || issues.length)} issue(s), ${Number(summary.errors || 0)} erro(s), ${Number(summary.warnings || 0)} aviso(s).`;
    return clipTextPreserveLines([header, ...lines].join('\n'), maxChars);
  }

  function buildDiagnosticsHintFromQualityReport(report) {
    if (!report || typeof report !== 'object') return null;
    const issues = Array.isArray(report.issues) ? report.issues : [];
    if (!issues.length) return null;
    return {
      summary: report.summary || null,
      issues: issues.slice(0, 8).map((issue) => ({
        file: issue && issue.file ? String(issue.file) : 'arquivo_desconhecido',
        severity: issue && issue.severity ? String(issue.severity) : 'warning',
        detail: issue && issue.detail ? String(issue.detail) : '',
        hint: issue && issue.hint ? String(issue.hint) : '',
        source: issue && issue.source ? String(issue.source) : '',
      })),
    };
  }

  function isQualityCandidateExtension(ext = '') {
    return new Set(['.html', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.php', '.json', '.md']).has(String(ext || '').toLowerCase());
  }

  function collectQualityCandidateFiles(projectInfo, modifiedFiles = [], maxFiles = POST_EXEC_QUALITY_MAX_FILES) {
    const fromModified = Array.isArray(modifiedFiles)
      ? modifiedFiles.map((entry) => String(entry || '').replace(/\\/g, '/')).filter(Boolean)
      : [];

    const fromProject = projectInfo && Array.isArray(projectInfo.files)
      ? projectInfo.files.map((entry) => String(entry || '').replace(/\\/g, '/')).filter(Boolean)
      : [];

    const merged = [];
    const seen = new Set();
    for (const relPath of [...fromModified, ...fromProject]) {
      if (!relPath || seen.has(relPath)) continue;
      seen.add(relPath);
      if (!isQualityCandidateExtension(path.extname(relPath))) continue;
      merged.push(relPath);
      if (merged.length >= Math.max(4, maxFiles)) break;
    }
    return merged;
  }

  function pushQualityIssue(issues, issue, maxIssues = POST_EXEC_QUALITY_MAX_ISSUES) {
    if (!issue || !issue.file || !issue.detail) return;
    if (!Array.isArray(issues) || issues.length >= maxIssues) return;
    const key = `${issue.file}::${issue.detail}`;
    if (issues.some((entry) => `${entry.file}::${entry.detail}` === key)) return;
    issues.push(issue);
  }

  function detectCssQualityIssues(relPath, content = '') {
    const issues = [];
    const text = String(content || '');
    const open = (text.match(/\{/g) || []).length;
    const close = (text.match(/\}/g) || []).length;
    if (open !== close) {
      issues.push({
        file: relPath,
        severity: 'error',
        detail: `Chaves CSS desbalanceadas ({:${open} vs }:${close}).`,
        hint: 'Fechar todos os blocos CSS corretamente.',
        source: 'css_balance',
      });
    }

    if (/[\u2012-\u2015]/.test(text) || /[\u2018\u2019\u201C\u201D]/.test(text)) {
      issues.push({
        file: relPath,
        severity: 'warning',
        detail: 'Caracteres tipográficos detectados em CSS (aspas/travessões unicode).',
        hint: 'Substituir por aspas e hífen ASCII para evitar quebra de parser.',
        source: 'css_unicode',
      });
    }

    if (/var\(\s*—/.test(text) || /var\(\s*–/.test(text)) {
      issues.push({
        file: relPath,
        severity: 'error',
        detail: 'Variável CSS com travessão unicode inválido em var(...).',
        hint: 'Usar --nome-da-variavel com hífen ASCII.',
        source: 'css_var_invalid_dash',
      });
    }

    const importOrderViolation = findCssImportOrderViolation(text);
    if (importOrderViolation) {
      issues.push({
        file: relPath,
        severity: 'error',
        detail: `@import CSS encontrado depois de regras na linha ${importOrderViolation.line}.`,
        hint: 'Mover todos os @import para o topo do CSS antes de seletores, :root e media queries.',
        source: 'css_import_order',
      });
    }

    return issues;
  }

  function detectHtmlAssetQualityIssues(rootPath, relPath, content = '') {
    const issues = [];
    const text = String(content || '');
    const regex = /(?:href|src)=["']([^"']+)["']/gi;
    let match = null;
    while ((match = regex.exec(text))) {
      const ref = String(match[1] || '').trim();
      if (!ref || ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('data:') || ref.startsWith('mailto:') || ref.startsWith('#')) {
        continue;
      }
      const cleanRef = ref.split('?')[0].split('#')[0];
      if (!cleanRef) continue;
      const abs = path.resolve(path.dirname(path.join(rootPath, relPath)), cleanRef);
      if (!abs.startsWith(path.resolve(rootPath))) continue;
      if (!fs.existsSync(abs)) {
        issues.push({
          file: relPath,
          severity: 'warning',
          detail: `Referência local não encontrada: ${ref}`,
          hint: 'Verificar caminho relativo entre páginas e assets.',
          source: 'html_asset_missing',
        });
      }
    }
    return issues;
  }

  function detectPhpIncludeQualityIssues(rootPath, relPath, content = '') {
    const issues = [];
    const text = String(content || '');
    const includeRegex = /\b(?:include|require)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]\s*\)?/gi;
    let match;
    while ((match = includeRegex.exec(text)) !== null) {
      const ref = String(match[1] || '').trim();
      if (!ref || ref.startsWith('http://') || ref.startsWith('https://')) continue;
      const cleanRef = ref.split('?')[0].split('#')[0];
      if (!cleanRef) continue;
      const abs = path.resolve(path.dirname(path.join(rootPath, relPath)), cleanRef);
      if (!abs.startsWith(path.resolve(rootPath))) continue;
      if (!fs.existsSync(abs)) {
        issues.push({
          file: relPath,
          severity: 'error',
          detail: `Include/require PHP não encontrado: ${ref}`,
          hint: 'Verifique caminho relativo ou ajuste estrutura de pastas.',
          source: 'php_include_missing',
        });
      }
    }
    return issues;
  }

  function buildShortStdErr(commandResult) {
    const stderr = String((commandResult && commandResult.stderr) || '').trim();
    const stdout = String((commandResult && commandResult.stdout) || '').trim();
    const merged = stderr || stdout;
    if (!merged) return 'Falha de validação sem saída detalhada.';
    const line = merged.split('\n').map((entry) => entry.trim()).filter(Boolean)[0] || merged;
    return clipTextPreserveLines(line, 320);
  }

  function isCommandUnavailableResult(commandResult, binName) {
    if (!commandResult || commandResult.ok) return false;
    const bin = String(binName || '').toLowerCase();
    const stderr = String(commandResult.stderr || '').toLowerCase();
    const stdout = String(commandResult.stdout || '').toLowerCase();
    const merged = `${stderr}\n${stdout}`;
    const code = commandResult.code !== undefined && commandResult.code !== null
      ? Number(commandResult.code)
      : Number(commandResult.exitCode);

    return (
      code === 127 ||
      merged.includes('enoent') ||
      merged.includes('command not found') ||
      merged.includes('no such file or directory') ||
      (bin && merged.includes(`spawn ${bin}`) && merged.includes('not found'))
    );
  }

  async function runAiderLintDiagnostics(rootPath, files = []) {
    const aiderRoot = path.resolve(AIDER_MAIN_ROOT || '');
    if (!aiderRoot || !fs.existsSync(aiderRoot)) {
      return { ok: false, reason: 'aider_root_missing', issues: [] };
    }

    const candidates = (Array.isArray(files) ? files : [])
      .map((entry) => String(entry || '').replace(/\\/g, '/'))
      .filter(Boolean)
      .slice(0, 20);
    if (!candidates.length) {
      return { ok: true, issues: [] };
    }

    const script = [
      'import json, os, sys',
      'root = sys.argv[1]',
      'files = json.loads(sys.argv[2])',
      'aider_root = sys.argv[3]',
      'sys.path.insert(0, aider_root)',
      'issues = []',
      'try:',
      '    from aider.linter import Linter',
      'except Exception as e:',
      '    print(json.dumps({"ok": False, "reason": f"import_failed:{e}", "issues": []}))',
      '    raise SystemExit(0)',
      'lin = Linter(root=root)',
      'for rel in files[:20]:',
      '    abs_path = os.path.join(root, rel)',
      '    if not os.path.isfile(abs_path):',
      '        continue',
      '    try:',
      '        out = lin.lint(abs_path)',
      '    except Exception as e:',
      '        issues.append({"file": rel, "severity": "warning", "detail": f"Aider lint exception: {e}", "source": "aider_lint_exception"})',
      '        continue',
      '    if out:',
      '        first = str(out).splitlines()[0] if str(out).splitlines() else "lint_error"',
      '        issues.append({"file": rel, "severity": "warning", "detail": first[:280], "source": "aider_lint"})',
      'print(json.dumps({"ok": True, "issues": issues}))',
    ].join('\n');

    const command = await runCommand('python3', ['-c', script, rootPath, JSON.stringify(candidates), aiderRoot], {
      cwd: rootPath,
      timeoutMs: AIDER_LINT_TIMEOUT_MS,
    });

    if (!command.ok && !command.stdout) {
      return { ok: false, reason: command.stderr || 'aider_lint_failed', issues: [] };
    }

    try {
      const parsed = JSON.parse(String(command.stdout || '{}'));
      return {
        ok: Boolean(parsed && parsed.ok),
        reason: parsed && parsed.reason ? String(parsed.reason) : null,
        issues: Array.isArray(parsed && parsed.issues) ? parsed.issues : [],
      };
    } catch {
      return { ok: false, reason: 'aider_lint_output_invalid', issues: [] };
    }
  }

  async function runPostExecutionQualityReport(projectInfo, {
    modifiedFiles = [],
    userMessage = '',
    attachments = [],
    executionIntent = '',
    artifactContext = '',
  } = {}) {
    if (!POST_EXEC_QUALITY_ENABLED) {
      return {
        enabled: false,
        summary: { total: 0, errors: 0, warnings: 0 },
        issues: [],
        message: 'Diagnóstico pós-execução desativado.',
      };
    }

    if (!projectInfo || !projectInfo.rootPath) {
      return {
        enabled: true,
        summary: { total: 1, errors: 1, warnings: 0 },
        issues: [{ file: 'projeto', severity: 'error', detail: 'Projeto indisponível para diagnóstico.', source: 'quality_context' }],
        message: 'Não foi possível analisar porque o projeto não está disponível.',
      };
    }

    const startedAt = Date.now();
    const rootPath = projectInfo.rootPath;
    const candidates = collectQualityCandidateFiles(projectInfo, modifiedFiles, POST_EXEC_QUALITY_MAX_FILES);
    const issues = [];
    const verifiedArtifactOperations = [];

    for (const relPath of candidates) {
      if (Date.now() - startedAt > POST_EXEC_QUALITY_TIMEOUT_MS) break;
      const absPath = path.join(rootPath, relPath);
      if (!fs.existsSync(absPath)) continue;

      const ext = path.extname(relPath).toLowerCase();
      let content = '';
      try {
        content = fs.readFileSync(absPath, 'utf8');
      } catch {
        pushQualityIssue(issues, {
          file: relPath,
          severity: 'warning',
          detail: 'Arquivo não pôde ser lido em UTF-8 para diagnóstico.',
          source: 'read_error',
        });
        continue;
      }
      verifiedArtifactOperations.push({
        op: 'write_file',
        path: relPath,
        content,
      });

      if (ext === '.css' || ext === '.scss') {
        for (const issue of detectCssQualityIssues(relPath, content)) {
          pushQualityIssue(issues, issue);
        }
      }

      if (ext === '.html' || ext === '.php') {
        for (const issue of detectHtmlAssetQualityIssues(rootPath, relPath, content)) {
          pushQualityIssue(issues, issue);
        }
      }

      if (ext === '.php') {
        for (const issue of detectPhpIncludeQualityIssues(rootPath, relPath, content)) {
          pushQualityIssue(issues, issue);
        }
      }

      if (['.js', '.mjs', '.cjs'].includes(ext)) {
        const check = await runCommand('node', ['--check', relPath], { cwd: rootPath, timeoutMs: 8000 });
        if (!check.ok) {
          pushQualityIssue(issues, {
            file: relPath,
            severity: 'error',
            detail: `Erro de sintaxe JS: ${buildShortStdErr(check)}`,
            hint: 'Corrigir sintaxe JavaScript antes de publicar.',
            source: 'node_check',
          });
        }
      }

      if (ext === '.php') {
        const phpCheck = await runCommand('php', ['-l', relPath], { cwd: rootPath, timeoutMs: 8000 });
        if (!phpCheck.ok) {
          if (isCommandUnavailableResult(phpCheck, 'php')) {
            pushQualityIssue(issues, {
              file: relPath,
              severity: 'warning',
              detail: `Lint PHP indisponível neste ambiente: ${buildShortStdErr(phpCheck)}`,
              hint: 'Instalar PHP localmente para validar sintaxe PHP automaticamente.',
              source: 'php_lint_unavailable',
            });
            continue;
          }
          pushQualityIssue(issues, {
            file: relPath,
            severity: 'error',
            detail: `Erro de sintaxe PHP: ${buildShortStdErr(phpCheck)}`,
            hint: 'Corrigir sintaxe PHP para execução no servidor.',
            source: 'php_lint',
          });
        }
      }
    }

    const aiderReport = await runAiderLintDiagnostics(rootPath, candidates);
    if (aiderReport.ok && Array.isArray(aiderReport.issues)) {
      for (const issue of aiderReport.issues) {
        pushQualityIssue(issues, {
          file: issue.file || 'arquivo_desconhecido',
          severity: issue.severity || 'warning',
          detail: issue.detail || 'Aider apontou alerta de lint.',
          source: issue.source || 'aider_lint',
        });
      }
    } else if (aiderReport.reason && !String(aiderReport.reason).startsWith('import_failed') && aiderReport.reason !== 'aider_root_missing') {
      pushQualityIssue(issues, {
        file: 'aider',
        severity: 'warning',
        detail: `Aider indisponível nesta rodada: ${aiderReport.reason}`,
        source: 'aider_unavailable',
      });
    }

    let artifactQuality = null;
    if (typeof evaluateOperationBatchArtifactQuality === 'function') {
      artifactQuality = evaluateOperationBatchArtifactQuality({
        operations: verifiedArtifactOperations,
        projectRootPath: rootPath,
        userMessage,
        executionIntent,
        contextText: artifactContext,
      });
      if (artifactQuality && artifactQuality.enabled && !artifactQuality.passesMinimum) {
        for (const issue of (artifactQuality.issues || []).slice(0, 6)) {
          const artifactSeverity = String(issue.severity || '').toLowerCase() === 'critical' ? 'error' : 'warning';
          pushQualityIssue(issues, {
            file: 'artefato',
            severity: artifactSeverity,
            detail: issue.detail || 'Qualidade de artefato abaixo do mínimo esperado.',
            hint: issue.hint || '',
            source: `artifact_quality:${issue.id || 'quality'}`,
          });
        }
      }
    }

    const errors = issues.filter((entry) => String(entry.severity || '').toLowerCase() === 'error').length;
    const warnings = issues.filter((entry) => String(entry.severity || '').toLowerCase() !== 'error').length;

    const summary = {
      total: issues.length,
      errors,
      warnings,
      checkedFiles: candidates.length,
      modifiedFiles: Array.isArray(modifiedFiles) ? modifiedFiles.length : 0,
      artifactQuality: artifactQuality && artifactQuality.enabled
        ? {
            score: artifactQuality.score,
            minScore: artifactQuality.minScore,
            passesMinimum: artifactQuality.passesMinimum,
          }
        : null,
      elapsedMs: Date.now() - startedAt,
    };

    const message = !issues.length
      ? `Diagnóstico pós-execução concluído sem problemas críticos (${summary.checkedFiles} arquivo(s) verificado(s)).`
      : `Diagnóstico pós-execução: ${summary.errors} erro(s) e ${summary.warnings} aviso(s) em ${summary.checkedFiles} arquivo(s).`;

    return {
      enabled: true,
      summary,
      issues: issues.slice(0, POST_EXEC_QUALITY_MAX_ISSUES),
      message,
      userMessage: String(userMessage || ''),
      attachmentsCount: Array.isArray(attachments) ? attachments.length : 0,
      generatedAt: new Date().toISOString(),
    };
  }

  function buildDiffStatsSummary(diffStats = {}, maxItems = 12) {
    const entries = Object.entries(diffStats || {})
      .map(([file, stat]) => {
        const add = Math.max(0, Number(stat && stat.add) || 0);
        const del = Math.max(0, Number(stat && stat.del) || 0);
        return { file, add, del };
      })
      .filter((entry) => entry.add > 0 || entry.del > 0)
      .sort((a, b) => {
        const scoreA = a.add + a.del;
        const scoreB = b.add + b.del;
        return scoreB - scoreA;
      });

    const trimmed = entries.slice(0, Math.max(1, maxItems));
    const totalAdd = entries.reduce((acc, entry) => acc + entry.add, 0);
    const totalDel = entries.reduce((acc, entry) => acc + entry.del, 0);
    return {
      totalAdd,
      totalDel,
      items: trimmed,
      hiddenCount: Math.max(0, entries.length - trimmed.length),
    };
  }

  function buildExecutionOutcomeReport(result = {}, qualityReport = null) {
    const summary = buildDiffStatsSummary(result && result.diffStats ? result.diffStats : {}, 12);
    const modifiedFiles = Array.isArray(result && result.modifiedFiles) ? result.modifiedFiles : [];
    const lines = [];

    lines.push('Alterações aplicadas no projeto:');
    if (modifiedFiles.length) {
      lines.push(`- Arquivos alterados: ${modifiedFiles.length}`);
    }
    lines.push(`- Linhas adicionadas: +${summary.totalAdd}`);
    lines.push(`- Linhas removidas: -${summary.totalDel}`);

    if (summary.items.length) {
      lines.push('- Diff por arquivo:');
      for (const item of summary.items) {
        lines.push(`  - ${item.file}: +${item.add} / -${item.del}`);
      }
      if (summary.hiddenCount > 0) {
        lines.push(`  - ... e mais ${summary.hiddenCount} arquivo(s).`);
      }
    }

    const qualitySummary = qualityReport && qualityReport.summary ? qualityReport.summary : null;
    if (qualitySummary) {
      const errors = Number(qualitySummary.errors || 0);
      const warnings = Number(qualitySummary.warnings || 0);
      lines.push(`- Validação pós-execução: ${errors} erro(s), ${warnings} aviso(s).`);
    }

    return {
      text: lines.join('\n'),
      totals: {
        add: summary.totalAdd,
        del: summary.totalDel,
        files: modifiedFiles.length,
      },
      byFile: summary.items,
    };
  }

  function evaluatePostExecutionGate(qualityReport = null) {
    const summary = qualityReport && qualityReport.summary ? qualityReport.summary : null;
    const errors = summary ? Math.max(0, Number(summary.errors || 0)) : 0;
    const warnings = summary ? Math.max(0, Number(summary.warnings || 0)) : 0;
    const shouldBlockByErrors = POST_EXEC_QUALITY_ENFORCE_ERRORS && errors > 0;
    const shouldBlockByWarnings = POST_EXEC_QUALITY_ENFORCE_WARNINGS && warnings > 0;
    const shouldBlock = Boolean(shouldBlockByErrors || shouldBlockByWarnings);
    const topIssues = Array.isArray(qualityReport && qualityReport.issues)
      ? qualityReport.issues.slice(0, 3).map((entry) => {
          const file = String(entry && entry.file ? entry.file : 'arquivo');
          const detail = String(entry && entry.detail ? entry.detail : 'falha técnica detectada');
          const severity = String(entry && entry.severity ? entry.severity : 'warning');
          return `${severity.toUpperCase()} em ${file}: ${detail}`;
        })
      : [];
    const reasonParts = [
      `errors=${errors}`,
      `warnings=${warnings}`,
      POST_EXEC_QUALITY_ENFORCE_ERRORS ? 'enforce_errors=1' : 'enforce_errors=0',
      POST_EXEC_QUALITY_ENFORCE_WARNINGS ? 'enforce_warnings=1' : 'enforce_warnings=0',
    ];
    return {
      shouldBlock,
      errors,
      warnings,
      reason: `post_exec_quality_failed:${reasonParts.join(';')}`,
      topIssues,
    };
  }

  function resolveActionTaskType(action) {
    if (!action || typeof action !== 'object') return '';
    if (action.executionCommand && action.executionCommand.task_type) {
      return String(action.executionCommand.task_type || '').trim().toLowerCase();
    }
    return String(action.type || '').trim().toLowerCase();
  }

  function shouldSkipEffectGate(taskType) {
    return taskType === 'search_text_in_files';
  }

  function allowsIdempotentZeroDiff(action) {
    if (!action || typeof action !== 'object') return false;
    if (action.allowZeroDiffCompletion !== true) return false;
    const microContract = action.microContract && typeof action.microContract === 'object'
      ? action.microContract
      : null;
    if (microContract && microContract.idempotentWhenAlreadyApplied === true) return true;
    return action.generatedBy === 'visual_hero_overlay_fallback_patch';
  }

  function evaluateExecutionEffectGate(action, result = {}, executionReport = null) {
    if (!EXECUTION_ENFORCE_EFFECT_GATE) {
      return {
        shouldBlock: false,
        reason: 'execution_effect_gate_disabled',
        taskType: resolveActionTaskType(action),
        modifiedFilesCount: Array.isArray(result && result.modifiedFiles) ? result.modifiedFiles.length : 0,
        totalDelta: 0,
        message: '',
      };
    }

    const taskType = resolveActionTaskType(action);
    if (shouldSkipEffectGate(taskType)) {
      return {
        shouldBlock: false,
        reason: 'execution_effect_gate_skipped',
        taskType,
        modifiedFilesCount: Array.isArray(result && result.modifiedFiles) ? result.modifiedFiles.length : 0,
        totalDelta: 0,
        message: '',
      };
    }

    const modifiedFilesCount = Array.isArray(result && result.modifiedFiles) ? result.modifiedFiles.length : 0;
    const totals = executionReport && executionReport.totals ? executionReport.totals : {};
    const add = Math.max(0, Number(totals.add || 0));
    const del = Math.max(0, Number(totals.del || 0));
    const totalDelta = add + del;
    const intent = String((action && action.intent) || '').toLowerCase();

    if (modifiedFilesCount <= 0) {
      return {
        shouldBlock: true,
        reason: `execution_no_effect:task=${taskType || 'unknown'};files=0;delta=${totalDelta}`,
        taskType,
        modifiedFilesCount,
        totalDelta,
        message:
          'A execução não alterou nenhum arquivo do projeto. Não vou marcar como concluído para evitar falso positivo.',
      };
    }

    if (EXECUTION_ENFORCE_NONZERO_DIFF_ON_EDIT && intent === 'edit_project' && totalDelta <= 0) {
      if (allowsIdempotentZeroDiff(action)) {
        return {
          shouldBlock: false,
          reason: `execution_idempotent_effect_ok:task=${taskType || 'unknown'};files=${modifiedFilesCount};delta=0`,
          taskType,
          modifiedFilesCount,
          totalDelta,
          message: '',
        };
      }
      return {
        shouldBlock: true,
        reason: `execution_zero_diff_on_edit:task=${taskType || 'unknown'};files=${modifiedFilesCount};delta=0`,
        taskType,
        modifiedFilesCount,
        totalDelta,
        message:
          'A execução tocou arquivo(s), mas sem mudança efetiva de conteúdo para este ajuste. Vou tratar como não concluído e tentar reparo.',
      };
    }

    return {
      shouldBlock: false,
      reason: `execution_effect_ok:task=${taskType || 'unknown'};files=${modifiedFilesCount};delta=${totalDelta}`,
      taskType,
      modifiedFilesCount,
      totalDelta,
      message: '',
    };
  }

  function buildExecutionEffectGateMessage(gate) {
    if (!gate || !gate.shouldBlock) return '';
    return String(gate.message || 'A execução não produziu efeito útil no projeto.');
  }

  function buildPostExecutionGateMessage(gate) {
    if (!gate || !gate.shouldBlock) return '';
    const lines = [
      `A validação técnica pós-execução encontrou ${gate.errors} erro(s) e ${gate.warnings} aviso(s), então não vou marcar como concluído ainda.`,
    ];
    if (Array.isArray(gate.topIssues) && gate.topIssues.length) {
      lines.push('Principais pontos detectados:');
      gate.topIssues.forEach((item) => lines.push(`- ${item}`));
    }
    lines.push('Vou preservar o checkpoint para a próxima correção incremental orientada por diagnóstico.');
    return lines.join('\n');
  }

  return {
    buildDiagnosticsHintFromQualityReport,
    buildDiagnosticsPromptContext,
    buildExecutionEffectGateMessage,
    buildExecutionOutcomeReport,
    buildPostExecutionGateMessage,
    collectQualityCandidateFiles,
    evaluateExecutionEffectGate,
    evaluatePostExecutionGate,
    isCommandUnavailableResult,
    runPostExecutionQualityReport,
  };
}

module.exports = {
  createPostExecutionQualityService,
};
