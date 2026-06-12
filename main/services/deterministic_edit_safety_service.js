const defaultFs = require('fs');
const defaultPath = require('path');

const {
  defaultNormalizeRequestedRelativePath,
} = require('./deterministic_edit_helpers');

const DETERMINISTIC_SAFE_PATCH_VALIDATION_SCHEMA_VERSION = 'deterministic-safe-patch-validation-v1';

const DEFAULT_ALLOWED_EXTENSIONS = new Set([
  '.css',
  '.scss',
  '.sass',
  '.html',
  '.php',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
]);

const DEFAULT_ALLOWED_GENERATORS = new Set([
  'deterministic_button_color_patch',
  'deterministic_card_text_patch',
  'deterministic_cta_text_patch',
  'deterministic_faq_item_patch',
  'deterministic_footer_insert_patch',
  'deterministic_form_field_patch',
  'deterministic_global_style_patch',
  'deterministic_grid_columns_patch',
  'deterministic_hero_media_patch',
  'deterministic_heading_color_patch',
  'deterministic_next_browser_global_module_patch',
  'deterministic_structured_clone_compat_patch',
  'deterministic_nav_link_patch',
  'deterministic_next_hydration_patch',
  'deterministic_section_background_width_patch',
  'deterministic_secondary_cta_patch',
  'deterministic_section_remove_patch',
  'deterministic_section_reorder_patch',
  'deterministic_stat_text_patch',
  'deterministic_theme_color_patch',
  'deterministic_title_edit_patch',
  'micro_color_literal_replace_patch',
  'micro_semantic_color_edit_patch',
]);

function normalizeSafePatchText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function resolveChangedSpanRatio(previous = '', next = '') {
  const a = String(previous || '');
  const b = String(next || '');
  if (!a && !b) return 0;
  let prefix = 0;
  const minLength = Math.min(a.length, b.length);
  while (prefix < minLength && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < minLength - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const changed = Math.max(a.length, b.length) - prefix - suffix;
  return Math.max(0, Math.min(1, changed / Math.max(1, Math.max(a.length, b.length))));
}

function resolveGeneratorChangedSpanLimit(generator = '', defaultLimit = 0.72) {
  const normalized = String(generator || '');
  if (normalized === 'deterministic_section_reorder_patch' || normalized === 'deterministic_section_remove_patch') return 0.98;
  if (
    [
      'deterministic_card_text_patch',
      'deterministic_cta_text_patch',
      'deterministic_faq_item_patch',
      'deterministic_form_field_patch',
      'deterministic_grid_columns_patch',
      'deterministic_hero_media_patch',
      'deterministic_nav_link_patch',
      'deterministic_secondary_cta_patch',
      'deterministic_stat_text_patch',
      'deterministic_title_edit_patch',
    ].includes(normalized)
  ) {
    return 0.88;
  }
  return defaultLimit;
}

function hasNewSuspiciousPattern(previous = '', next = '') {
  const before = String(previous || '');
  const after = String(next || '');
  const patterns = [
    /<script\b[^>]*\bsrc=["']https?:\/\//i,
    /\beval\s*\(/i,
    /\bnew\s+Function\s*\(/i,
    /\bchild_process\b/i,
    /\bexecSync\s*\(/i,
    /\bspawn\s*\(/i,
  ];
  return patterns.find((pattern) => pattern.test(after) && !pattern.test(before)) || null;
}

function buildValidationResult(errors = [], warnings = [], details = {}) {
  const score = Math.max(0, Math.min(100, 100 - errors.length * 24 - warnings.length * 4));
  return {
    schemaVersion: DETERMINISTIC_SAFE_PATCH_VALIDATION_SCHEMA_VERSION,
    ok: errors.length === 0,
    score,
    minScore: 92,
    errors,
    warnings,
    summary: errors.length
      ? `Patch determinístico bloqueado: ${errors[0].reason}.`
      : `Patch determinístico liberado com ${details.operationsCount || 0} operação(ões).`,
    details,
  };
}

function createDeterministicEditSafetyService(dependencies = {}) {
  const {
    fs = defaultFs,
    path = defaultPath,
    normalizeRequestedRelativePath = defaultNormalizeRequestedRelativePath,
    allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS,
    allowedGenerators = DEFAULT_ALLOWED_GENERATORS,
    maxFileBytes = 700000,
    maxOperations = 8,
    maxPerFileDelta = 16000,
    maxTotalDelta = 42000,
    maxChangedSpanRatio = 0.72,
  } = dependencies;

  function addError(errors, reason, extra = {}) {
    errors.push({ reason, ...extra });
  }

  function addWarning(warnings, reason, extra = {}) {
    warnings.push({ reason, ...extra });
  }

  function resolveOperationPath(projectRoot = '', rawPath = '') {
    const relPath = normalizeRequestedRelativePath(rawPath);
    if (!relPath) return { relPath: '', absPath: '' };
    const absPath = path.resolve(projectRoot, relPath);
    const root = path.resolve(projectRoot);
    if (absPath !== root && !absPath.startsWith(`${root}${path.sep}`)) {
      return { relPath: '', absPath: '' };
    }
    return { relPath, absPath };
  }

  function validateSafePatch({ projectInfo = null, action = null, userMessage = '' } = {}) {
    const errors = [];
    const warnings = [];
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    const operations = action && Array.isArray(action.operations) ? action.operations : [];
    const generator = action && action.generatedBy ? String(action.generatedBy) : '';
    const filesListed = new Set(
      Array.isArray(projectInfo && projectInfo.files)
        ? projectInfo.files.map((entry) => String(entry || '').replace(/\\/g, '/')).filter(Boolean)
        : []
    );

    if (!projectRoot) addError(errors, 'missing_project_root');
    if (!action || typeof action !== 'object') addError(errors, 'missing_action');
    if (action && action.type !== 'operation_batch') addError(errors, 'unsupported_action_type', { type: action.type || null });
    if (action && action.intent !== 'edit_project') addError(errors, 'unsupported_action_intent', { intent: action.intent || null });
    if (generator && !allowedGenerators.has(generator)) addError(errors, 'unknown_deterministic_generator', { generator });
    if (!operations.length) addError(errors, 'empty_operations');
    if (operations.length > maxOperations) addError(errors, 'too_many_operations', { count: operations.length, maxOperations });

    const seenPaths = new Set();
    const details = {
      userMessagePreview: normalizeSafePatchText(userMessage).slice(0, 220),
      generator,
      operationsCount: operations.length,
      changedFiles: [],
      totalDelta: 0,
      maxChangedSpanRatio,
      generatorChangedSpanRatio: resolveGeneratorChangedSpanLimit(generator, maxChangedSpanRatio),
    };

    if (!projectRoot || errors.some((entry) => entry.reason === 'missing_action')) {
      return buildValidationResult(errors, warnings, details);
    }

    for (const [index, operation] of operations.entries()) {
      if (!operation || typeof operation !== 'object') {
        addError(errors, 'invalid_operation', { index });
        continue;
      }
      if (operation.op !== 'write_file') {
        addError(errors, 'unsupported_operation_for_safe_patch', { index, op: operation.op || null });
        continue;
      }
      if (typeof operation.content !== 'string') {
        addError(errors, 'operation_content_must_be_string', { index, path: operation.path || '' });
        continue;
      }
      if (operation.content.includes('\u0000')) {
        addError(errors, 'operation_content_contains_null_byte', { index, path: operation.path || '' });
        continue;
      }

      const { relPath, absPath } = resolveOperationPath(projectRoot, operation.path || '');
      if (!relPath || !absPath) {
        addError(errors, 'unsafe_or_invalid_path', { index, path: operation.path || '' });
        continue;
      }
      if (seenPaths.has(relPath)) {
        addError(errors, 'duplicate_operation_path', { index, path: relPath });
        continue;
      }
      seenPaths.add(relPath);

      if (/(^|\/)(node_modules|dist|build|coverage|\.git|\.next|\.faber|out)\//i.test(relPath)) {
        addError(errors, 'generated_or_vendor_path_not_allowed', { index, path: relPath });
        continue;
      }

      const extension = path.extname(relPath).toLowerCase();
      if (!allowedExtensions.has(extension)) {
        addError(errors, 'unsupported_file_extension_for_safe_patch', { index, path: relPath, extension });
        continue;
      }

      let current = '';
      let stat = null;
      try {
        if (!fs.existsSync(absPath)) {
          addError(errors, 'safe_patch_requires_existing_file', { index, path: relPath });
          continue;
        }
        stat = fs.statSync(absPath);
        if (!stat.isFile()) {
          addError(errors, 'safe_patch_target_not_file', { index, path: relPath });
          continue;
        }
        if (stat.size > maxFileBytes) {
          addError(errors, 'safe_patch_target_too_large', { index, path: relPath, size: stat.size, maxFileBytes });
          continue;
        }
        current = fs.readFileSync(absPath, 'utf8');
      } catch (error) {
        addError(errors, 'safe_patch_read_failed', {
          index,
          path: relPath,
          message: error && error.message ? error.message : String(error || ''),
        });
        continue;
      }

      if (current === operation.content) {
        addError(errors, 'operation_does_not_change_file', { index, path: relPath });
        continue;
      }

      const delta = Math.abs(operation.content.length - current.length);
      const changedSpanRatio = resolveChangedSpanRatio(current, operation.content);
      details.totalDelta += delta;
      details.changedFiles.push({
        path: relPath,
        previousBytes: current.length,
        nextBytes: operation.content.length,
        delta,
        changedSpanRatio,
      });

      if (delta > maxPerFileDelta) {
        addError(errors, 'safe_patch_delta_too_large', { index, path: relPath, delta, maxPerFileDelta });
      }
      const generatorChangedSpanRatio = resolveGeneratorChangedSpanLimit(generator, maxChangedSpanRatio);
      const smallStructuredDelta =
        delta <= 512 &&
        [
          'deterministic_card_text_patch',
          'deterministic_cta_text_patch',
          'deterministic_faq_item_patch',
          'deterministic_form_field_patch',
          'deterministic_grid_columns_patch',
          'deterministic_hero_media_patch',
          'deterministic_nav_link_patch',
          'deterministic_secondary_cta_patch',
          'deterministic_stat_text_patch',
          'deterministic_title_edit_patch',
        ].includes(generator);
      if (current.length > 500 && changedSpanRatio > generatorChangedSpanRatio && !smallStructuredDelta) {
        addError(errors, 'safe_patch_rewrite_ratio_too_large', {
          index,
          path: relPath,
          changedSpanRatio,
          maxChangedSpanRatio: generatorChangedSpanRatio,
        });
      }

      const suspiciousPattern = hasNewSuspiciousPattern(current, operation.content);
      if (suspiciousPattern) {
        addError(errors, 'safe_patch_introduces_suspicious_code', {
          index,
          path: relPath,
          pattern: suspiciousPattern.source,
        });
      }

      if (filesListed.size && !filesListed.has(relPath)) {
        addWarning(warnings, 'target_file_not_in_project_scan', { index, path: relPath });
      }
    }

    if (details.totalDelta > maxTotalDelta) {
      addError(errors, 'safe_patch_total_delta_too_large', {
        totalDelta: details.totalDelta,
        maxTotalDelta,
      });
    }

    return buildValidationResult(errors, warnings, details);
  }

  return {
    validateSafePatch,
  };
}

module.exports = {
  DEFAULT_ALLOWED_EXTENSIONS,
  DEFAULT_ALLOWED_GENERATORS,
  DETERMINISTIC_SAFE_PATCH_VALIDATION_SCHEMA_VERSION,
  createDeterministicEditSafetyService,
  resolveChangedSpanRatio,
  resolveGeneratorChangedSpanLimit,
};
