const DETERMINISTIC_EDIT_PATCH_EVIDENCE_SCHEMA_VERSION = 'deterministic-edit-patch-evidence-v1';

function summarizeChangedFiles(validation = {}) {
  const details = validation && validation.details && typeof validation.details === 'object'
    ? validation.details
    : {};
  return Array.isArray(details.changedFiles)
    ? details.changedFiles.map((entry) => ({
        path: entry.path || '',
        delta: Number.isFinite(Number(entry.delta)) ? Number(entry.delta) : 0,
        changedSpanRatio: Number.isFinite(Number(entry.changedSpanRatio))
          ? Number(entry.changedSpanRatio)
          : 0,
      })).filter((entry) => entry.path)
    : [];
}

function buildDeterministicEditPatchEvidence({
  action = null,
  classification = null,
  validation = null,
  status = '',
} = {}) {
  const safeAction = action && typeof action === 'object' ? action : {};
  const safeClassification = classification && typeof classification === 'object' ? classification : {};
  const safeValidation = validation && typeof validation === 'object' ? validation : {};
  const microContract = safeAction.microContract && typeof safeAction.microContract === 'object'
    ? safeAction.microContract
    : null;
  const details = safeValidation.details && typeof safeValidation.details === 'object'
    ? safeValidation.details
    : {};

  return {
    schemaVersion: DETERMINISTIC_EDIT_PATCH_EVIDENCE_SCHEMA_VERSION,
    status: status || (safeValidation.ok ? 'approved' : 'blocked'),
    generator: safeAction.generatedBy || details.generator || '',
    targetFile: safeAction.targetFile || '',
    operationsCount: Array.isArray(safeAction.operations)
      ? safeAction.operations.length
      : Number.isFinite(Number(details.operationsCount))
        ? Number(details.operationsCount)
        : 0,
    classification: {
      supported: Boolean(safeClassification.supported),
      kind: safeClassification.kind || '',
      reason: safeClassification.reason || '',
    },
    validation: {
      ok: Boolean(safeValidation.ok),
      score: Number.isFinite(Number(safeValidation.score)) ? Number(safeValidation.score) : 0,
      minScore: Number.isFinite(Number(safeValidation.minScore)) ? Number(safeValidation.minScore) : 0,
      summary: safeValidation.summary || '',
      errors: Array.isArray(safeValidation.errors)
        ? safeValidation.errors.map((entry) => entry.reason || '').filter(Boolean)
        : [],
      warnings: Array.isArray(safeValidation.warnings)
        ? safeValidation.warnings.map((entry) => entry.reason || '').filter(Boolean)
        : [],
    },
    microContract: microContract
      ? {
          schemaVersion: microContract.schemaVersion || '',
          type: microContract.type || safeClassification.kind || '',
        }
      : null,
    changedFiles: summarizeChangedFiles(safeValidation),
  };
}

function normalizeDeterministicEditPatchEvidence(value = null) {
  if (!value || typeof value !== 'object') return null;
  return {
    schemaVersion: value.schemaVersion || DETERMINISTIC_EDIT_PATCH_EVIDENCE_SCHEMA_VERSION,
    status: value.status || '',
    generator: value.generator || '',
    targetFile: value.targetFile || '',
    operationsCount: Number.isFinite(Number(value.operationsCount)) ? Number(value.operationsCount) : 0,
    classification: value.classification && typeof value.classification === 'object'
      ? {
          supported: Boolean(value.classification.supported),
          kind: value.classification.kind || '',
          reason: value.classification.reason || '',
        }
      : { supported: false, kind: '', reason: '' },
    validation: value.validation && typeof value.validation === 'object'
      ? {
          ok: Boolean(value.validation.ok),
          score: Number.isFinite(Number(value.validation.score)) ? Number(value.validation.score) : 0,
          minScore: Number.isFinite(Number(value.validation.minScore)) ? Number(value.validation.minScore) : 0,
          summary: value.validation.summary || '',
          errors: Array.isArray(value.validation.errors) ? value.validation.errors.map(String).filter(Boolean) : [],
          warnings: Array.isArray(value.validation.warnings) ? value.validation.warnings.map(String).filter(Boolean) : [],
        }
      : { ok: false, score: 0, minScore: 0, summary: '', errors: [], warnings: [] },
    microContract: value.microContract && typeof value.microContract === 'object'
      ? {
          schemaVersion: value.microContract.schemaVersion || '',
          type: value.microContract.type || '',
        }
      : null,
    changedFiles: Array.isArray(value.changedFiles)
      ? value.changedFiles.map((entry) => ({
          path: entry && entry.path ? String(entry.path) : '',
          delta: Number.isFinite(Number(entry && entry.delta)) ? Number(entry.delta) : 0,
          changedSpanRatio: Number.isFinite(Number(entry && entry.changedSpanRatio))
            ? Number(entry.changedSpanRatio)
            : 0,
        })).filter((entry) => entry.path)
      : [],
  };
}

function buildDeterministicEditPatchCheckpoint(action = null) {
  if (!action || typeof action !== 'object') return null;
  const evidence = normalizeDeterministicEditPatchEvidence(action.safePatchEvidence);
  if (!evidence) return null;
  return {
    ...evidence,
    files: Array.isArray(action.operations)
      ? action.operations.map((operation) => operation && operation.path ? operation.path : '').filter(Boolean).slice(0, 24)
      : [],
  };
}

function buildDeterministicEditPatchEventPayload(evidence = null) {
  const normalized = normalizeDeterministicEditPatchEvidence(evidence);
  if (!normalized) return null;
  return {
    status: normalized.status,
    generator: normalized.generator,
    kind: normalized.classification.kind,
    validationOk: normalized.validation.ok,
    score: normalized.validation.score,
    minScore: normalized.validation.minScore,
    operationsCount: normalized.operationsCount,
    changedFilesCount: normalized.changedFiles.length,
    microContractType: normalized.microContract ? normalized.microContract.type : '',
  };
}

module.exports = {
  DETERMINISTIC_EDIT_PATCH_EVIDENCE_SCHEMA_VERSION,
  buildDeterministicEditPatchEvidence,
  buildDeterministicEditPatchCheckpoint,
  buildDeterministicEditPatchEventPayload,
  normalizeDeterministicEditPatchEvidence,
};
