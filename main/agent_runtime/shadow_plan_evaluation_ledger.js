'use strict';

const crypto = require('crypto');
const util = require('util');

const { HARNESS_OPERATIONS } = require('./harness_contracts');
const {
  SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION,
  SHADOW_PLAN_SEMANTIC_VERDICTS,
} = require('./shadow_plan_semantic_comparator');
const {
  SHADOW_PLAN_RUBRIC,
  SHADOW_PLAN_RUBRIC_VERSION,
} = require('./shadow_plan_evidence_evaluator');

const SHADOW_PLAN_EVALUATION_LEDGER_VERSION =
  'shadow-plan-evaluation-ledger.v1';
const SHADOW_PLAN_EVALUATION_LEDGER_SNAPSHOT_SCHEMA_VERSION =
  'shadow-plan-evaluation-ledger-snapshot.v1';
const SHADOW_PLAN_EVALUATION_REPORT_SINK_VERSION =
  'shadow-plan-evaluation-report-sink.v1';
const DEFAULT_MINIMUM_ELIGIBLE_CASES = 10;
const DEFAULT_REQUIRED_PARITY_RATE_BASIS_POINTS = 9000;
const DEFAULT_MAXIMUM_FUNCTIONAL_REGRESSION_BASIS_POINTS = 300;
const TOTAL_BASIS_POINTS = 10_000;
const MAX_ELIGIBLE_CASES = 1_000_000;

const SHADOW_PLAN_EVALUATION_GATE_STATUSES = Object.freeze({
  FAIL: 'fail',
  INSUFFICIENT_DATA: 'insufficient_data',
  PASS: 'pass',
});

const SHADOW_PLAN_EVALUATION_GATE_REASONS = Object.freeze({
  FUNCTIONAL_REGRESSION: 'functional_regression',
  INSUFFICIENT_SAMPLE: 'insufficient_sample',
  PARITY_BELOW_THRESHOLD: 'parity_below_threshold',
  SAFETY_VIOLATION: 'safety_violation',
});

const SHADOW_PLAN_EVALUATION_LEDGER_REASONS = Object.freeze({
  DUPLICATE_REPORT: 'SHADOW_PLAN_EVALUATION_DUPLICATE_REPORT',
  INVALID_REPORT: 'SHADOW_PLAN_EVALUATION_INVALID_REPORT',
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const VALID_VERDICTS = new Set(Object.values(SHADOW_PLAN_SEMANTIC_VERDICTS));

class ShadowPlanEvaluationLedgerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ShadowPlanEvaluationLedgerError';
    this.code = code;
  }
}

function ledgerError(code) {
  return new ShadowPlanEvaluationLedgerError(code);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, fieldName, {
  allowedKeys = null,
  requiredKeys = null,
  frozen = false,
} = {}) {
  if (!isPlainRecord(value) || (frozen && !Object.isFrozen(value))) {
    throw new TypeError(fieldName + ' must be a plain data record');
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(fieldName + ' must be inspectable');
  }
  if (keys.some((key) => typeof key !== 'string'
    || FORBIDDEN_KEYS.has(key)
    || (allowedKeys && !allowedKeys.includes(key)))) {
    throw new TypeError(fieldName + ' has invalid fields');
  }
  if (requiredKeys) {
    const missing = requiredKeys.find((key) => !keys.includes(key));
    if (missing) throw new TypeError(fieldName + ' is missing ' + missing);
  }
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) {
      throw new TypeError(fieldName + ' must contain enumerable data values');
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function denseFrozenArray(value, fieldName, expectedLength) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || !Object.isFrozen(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length !== expectedLength) {
    throw new TypeError(fieldName + ' must be a fixed frozen array');
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(fieldName + ' must be dense');
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(fieldName + ' must contain data values');
    }
    return descriptor.value;
  });
}

function boundedInteger(value, fallback, minimum, maximum, fieldName) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate)
    || candidate < minimum || candidate > maximum) {
    throw new TypeError(fieldName + ' is outside its supported bounds');
  }
  return candidate;
}

function basisPointScore(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0 || value > TOTAL_BASIS_POINTS) {
    throw new TypeError(fieldName + ' is invalid');
  }
  return value;
}

function nonNegativeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(fieldName + ' is invalid');
  }
  return value;
}

function parseCriteria(value) {
  return Object.freeze(denseFrozenArray(
    value,
    'comparison report criteria',
    SHADOW_PLAN_RUBRIC.length
  ).map((criterion, index) => {
    const rubricCriterion = SHADOW_PLAN_RUBRIC[index];
    const fields = dataFields(criterion, 'comparison criterion ' + index, {
      allowedKeys: [
        'id',
        'weightBasisPoints',
        'authoritativeScoreBasisPoints',
        'shadowScoreBasisPoints',
        'deltaBasisPoints',
      ],
      requiredKeys: [
        'id',
        'weightBasisPoints',
        'authoritativeScoreBasisPoints',
        'shadowScoreBasisPoints',
        'deltaBasisPoints',
      ],
      frozen: true,
    });
    const authoritativeScoreBasisPoints = basisPointScore(
      fields.get('authoritativeScoreBasisPoints'),
      'authoritative criterion score'
    );
    const shadowScoreBasisPoints = basisPointScore(
      fields.get('shadowScoreBasisPoints'),
      'shadow criterion score'
    );
    const deltaBasisPoints = fields.get('deltaBasisPoints');
    if (fields.get('id') !== rubricCriterion.id
      || fields.get('weightBasisPoints') !== rubricCriterion.weightBasisPoints
      || !Number.isSafeInteger(deltaBasisPoints)
      || deltaBasisPoints !== shadowScoreBasisPoints
        - authoritativeScoreBasisPoints
      || (rubricCriterion.id === 'functional_success'
        && ![0, TOTAL_BASIS_POINTS].includes(authoritativeScoreBasisPoints))
      || (rubricCriterion.id === 'functional_success'
        && ![0, TOTAL_BASIS_POINTS].includes(shadowScoreBasisPoints))) {
      throw new TypeError('comparison criterion is invalid');
    }
    return Object.freeze({
      id: rubricCriterion.id,
      weightBasisPoints: rubricCriterion.weightBasisPoints,
      authoritativeScoreBasisPoints,
      shadowScoreBasisPoints,
      deltaBasisPoints,
    });
  }));
}

function weightedScore(criteria, scoreField) {
  const numerator = criteria.reduce(
    (sum, criterion) => sum
      + criterion.weightBasisPoints * criterion[scoreField],
    0
  );
  return Math.round(numerator / TOTAL_BASIS_POINTS);
}

function scalarToken(name, value) {
  const text = String(value);
  return name.length + ':' + name + ':' + text.length + ':' + text;
}

function canonicalReportSummary(report) {
  const values = [
    ['schemaVersion', report.schemaVersion],
    ['requestId', report.requestId],
    ['operation', report.operation],
    ['rubricVersion', report.rubricVersion],
    ['eligible', report.eligible],
    ['verdict', report.verdict],
    ['parity', report.parity],
    ['toleranceBasisPoints', report.toleranceBasisPoints],
    ['authoritativeKernel', report.kernels.authoritative],
    ['shadowKernel', report.kernels.shadow],
    ['authoritativeScore', report.scores.authoritativeBasisPoints],
    ['shadowScore', report.scores.shadowBasisPoints],
    ['scoreDelta', report.scores.deltaBasisPoints],
    ['authoritativeWorkspaceWrites', report.safety.authoritativeWorkspaceWrites],
    [
      'authoritativeUnrelatedFilesChanged',
      report.safety.authoritativeUnrelatedFilesChanged,
    ],
    ['shadowWorkspaceWrites', report.safety.shadowWorkspaceWrites],
    ['shadowUnrelatedFilesChanged', report.safety.shadowUnrelatedFilesChanged],
    ['safetyPassed', report.safety.passed],
  ];
  report.criteria.forEach((criterion, index) => {
    values.push(
      ['criterion.' + index + '.id', criterion.id],
      ['criterion.' + index + '.weight', criterion.weightBasisPoints],
      [
        'criterion.' + index + '.authoritative',
        criterion.authoritativeScoreBasisPoints,
      ],
      ['criterion.' + index + '.shadow', criterion.shadowScoreBasisPoints],
      ['criterion.' + index + '.delta', criterion.deltaBasisPoints]
    );
  });
  return values.map(([name, value]) => scalarToken(name, value)).join('\n');
}

function parseReport(value) {
  try {
    const fields = dataFields(value, 'comparison report', {
      allowedKeys: [
        'schemaVersion',
        'requestId',
        'operation',
        'rubricVersion',
        'eligible',
        'verdict',
        'parity',
        'toleranceBasisPoints',
        'kernels',
        'scores',
        'safety',
        'criteria',
      ],
      requiredKeys: [
        'schemaVersion',
        'requestId',
        'operation',
        'rubricVersion',
        'eligible',
        'verdict',
        'parity',
        'toleranceBasisPoints',
        'kernels',
        'scores',
        'safety',
        'criteria',
      ],
      frozen: true,
    });
    const requestId = fields.get('requestId');
    const verdict = fields.get('verdict');
    const parity = fields.get('parity');
    const toleranceBasisPoints = basisPointScore(
      fields.get('toleranceBasisPoints'),
      'comparison tolerance'
    );
    if (fields.get('schemaVersion')
      !== SHADOW_PLAN_SEMANTIC_COMPARISON_SCHEMA_VERSION
      || typeof requestId !== 'string'
      || !SAFE_IDENTIFIER.test(requestId)
      || fields.get('operation') !== HARNESS_OPERATIONS.PLAN
      || fields.get('rubricVersion') !== SHADOW_PLAN_RUBRIC_VERSION
      || fields.get('eligible') !== true
      || !VALID_VERDICTS.has(verdict)
      || typeof parity !== 'boolean') {
      throw new TypeError('comparison report identity is invalid');
    }

    const kernelFields = dataFields(fields.get('kernels'), 'comparison kernels', {
      allowedKeys: ['authoritative', 'shadow'],
      requiredKeys: ['authoritative', 'shadow'],
      frozen: true,
    });
    const authoritativeKernel = kernelFields.get('authoritative');
    const shadowKernel = kernelFields.get('shadow');
    if (typeof authoritativeKernel !== 'string'
      || !SAFE_IDENTIFIER.test(authoritativeKernel)
      || typeof shadowKernel !== 'string'
      || !SAFE_IDENTIFIER.test(shadowKernel)
      || authoritativeKernel === shadowKernel) {
      throw new TypeError('comparison kernels are invalid');
    }

    const criteria = parseCriteria(fields.get('criteria'));
    const scoreFields = dataFields(fields.get('scores'), 'comparison scores', {
      allowedKeys: [
        'authoritativeBasisPoints',
        'shadowBasisPoints',
        'deltaBasisPoints',
      ],
      requiredKeys: [
        'authoritativeBasisPoints',
        'shadowBasisPoints',
        'deltaBasisPoints',
      ],
      frozen: true,
    });
    const authoritativeScore = basisPointScore(
      scoreFields.get('authoritativeBasisPoints'),
      'authoritative comparison score'
    );
    const shadowScore = basisPointScore(
      scoreFields.get('shadowBasisPoints'),
      'shadow comparison score'
    );
    const scoreDelta = scoreFields.get('deltaBasisPoints');
    if (!Number.isSafeInteger(scoreDelta)
      || scoreDelta !== shadowScore - authoritativeScore
      || authoritativeScore !== weightedScore(
        criteria,
        'authoritativeScoreBasisPoints'
      )
      || shadowScore !== weightedScore(criteria, 'shadowScoreBasisPoints')) {
      throw new TypeError('comparison scores are inconsistent');
    }

    const safetyFields = dataFields(fields.get('safety'), 'comparison safety', {
      allowedKeys: [
        'authoritativeWorkspaceWrites',
        'authoritativeUnrelatedFilesChanged',
        'shadowWorkspaceWrites',
        'shadowUnrelatedFilesChanged',
        'passed',
      ],
      requiredKeys: [
        'authoritativeWorkspaceWrites',
        'authoritativeUnrelatedFilesChanged',
        'shadowWorkspaceWrites',
        'shadowUnrelatedFilesChanged',
        'passed',
      ],
      frozen: true,
    });
    const authoritativeWorkspaceWrites = nonNegativeInteger(
      safetyFields.get('authoritativeWorkspaceWrites'),
      'authoritative workspace writes'
    );
    const authoritativeUnrelatedFilesChanged = nonNegativeInteger(
      safetyFields.get('authoritativeUnrelatedFilesChanged'),
      'authoritative unrelated files changed'
    );
    const shadowWorkspaceWrites = nonNegativeInteger(
      safetyFields.get('shadowWorkspaceWrites'),
      'shadow workspace writes'
    );
    const shadowUnrelatedFilesChanged = nonNegativeInteger(
      safetyFields.get('shadowUnrelatedFilesChanged'),
      'shadow unrelated files changed'
    );
    const safetyPassed = shadowWorkspaceWrites === 0
      && shadowUnrelatedFilesChanged === 0;
    if (safetyFields.get('passed') !== safetyPassed) {
      throw new TypeError('comparison safety verdict is inconsistent');
    }

    let expectedVerdict;
    if (!safetyPassed) {
      expectedVerdict = SHADOW_PLAN_SEMANTIC_VERDICTS.SAFETY_VIOLATION;
    } else if (scoreDelta > toleranceBasisPoints) {
      expectedVerdict = SHADOW_PLAN_SEMANTIC_VERDICTS.SHADOW_BETTER;
    } else if (scoreDelta < -toleranceBasisPoints) {
      expectedVerdict = SHADOW_PLAN_SEMANTIC_VERDICTS.AUTHORITATIVE_BETTER;
    } else {
      expectedVerdict = SHADOW_PLAN_SEMANTIC_VERDICTS.EQUIVALENT;
    }
    const expectedParity = safetyPassed && scoreDelta >= -toleranceBasisPoints;
    if (verdict !== expectedVerdict || parity !== expectedParity) {
      throw new TypeError('comparison outcome is inconsistent');
    }

    const report = Object.freeze({
      schemaVersion: fields.get('schemaVersion'),
      requestId,
      operation: fields.get('operation'),
      rubricVersion: fields.get('rubricVersion'),
      eligible: true,
      verdict,
      parity,
      toleranceBasisPoints,
      kernels: Object.freeze({
        authoritative: authoritativeKernel,
        shadow: shadowKernel,
      }),
      scores: Object.freeze({
        authoritativeBasisPoints: authoritativeScore,
        shadowBasisPoints: shadowScore,
        deltaBasisPoints: scoreDelta,
      }),
      safety: Object.freeze({
        authoritativeWorkspaceWrites,
        authoritativeUnrelatedFilesChanged,
        shadowWorkspaceWrites,
        shadowUnrelatedFilesChanged,
        passed: safetyPassed,
      }),
      criteria,
    });
    const functional = criteria[0];
    return Object.freeze({
      report,
      requestId,
      parity,
      authoritativeFunctionalSuccess:
        functional.authoritativeScoreBasisPoints === TOTAL_BASIS_POINTS ? 1 : 0,
      shadowFunctionalSuccess:
        functional.shadowScoreBasisPoints === TOTAL_BASIS_POINTS ? 1 : 0,
      safetyViolation: safetyPassed ? 0 : 1,
    });
  } catch (error) {
    if (error instanceof ShadowPlanEvaluationLedgerError) throw error;
    throw ledgerError(SHADOW_PLAN_EVALUATION_LEDGER_REASONS.INVALID_REPORT);
  }
}

function rateBasisPoints(numerator, denominator) {
  if (denominator === 0) return 0;
  return Math.round((numerator * TOTAL_BASIS_POINTS) / denominator);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function createShadowPlanEvaluationLedger(options = {}) {
  const fields = dataFields(options, 'shadow plan evaluation ledger options', {
    allowedKeys: [
      'minimumEligibleCases',
      'requiredParityRateBasisPoints',
      'maximumFunctionalRegressionBasisPoints',
    ],
  });
  const minimumEligibleCases = boundedInteger(
    fields.get('minimumEligibleCases'),
    DEFAULT_MINIMUM_ELIGIBLE_CASES,
    1,
    MAX_ELIGIBLE_CASES,
    'minimumEligibleCases'
  );
  const requiredParityRateBasisPoints = boundedInteger(
    fields.get('requiredParityRateBasisPoints'),
    DEFAULT_REQUIRED_PARITY_RATE_BASIS_POINTS,
    0,
    TOTAL_BASIS_POINTS,
    'requiredParityRateBasisPoints'
  );
  const maximumFunctionalRegressionBasisPoints = boundedInteger(
    fields.get('maximumFunctionalRegressionBasisPoints'),
    DEFAULT_MAXIMUM_FUNCTIONAL_REGRESSION_BASIS_POINTS,
    0,
    TOTAL_BASIS_POINTS,
    'maximumFunctionalRegressionBasisPoints'
  );
  const requestIds = new Set();
  const records = [];
  let headDigest = null;
  let parityPasses = 0;
  let authoritativeFunctionalSuccesses = 0;
  let shadowFunctionalSuccesses = 0;
  let safetyViolations = 0;
  let rejections = 0;
  let duplicateReports = 0;
  let lastFailureCode = null;

  function record(reportValue) {
    try {
      const parsed = parseReport(reportValue);
      if (requestIds.has(parsed.requestId)) {
        throw ledgerError(
          SHADOW_PLAN_EVALUATION_LEDGER_REASONS.DUPLICATE_REPORT
        );
      }
      const nextDigest = 'sha256:' + crypto
        .createHash('sha256')
        .update(headDigest || '')
        .update('\n')
        .update(canonicalReportSummary(parsed.report))
        .digest('hex');
      const receipt = Object.freeze({
        requestId: parsed.requestId,
        previousDigest: headDigest,
        recordDigest: nextDigest,
      });
      requestIds.add(parsed.requestId);
      records.push(receipt);
      headDigest = nextDigest;
      parityPasses += parsed.parity ? 1 : 0;
      authoritativeFunctionalSuccesses += parsed.authoritativeFunctionalSuccess;
      shadowFunctionalSuccesses += parsed.shadowFunctionalSuccess;
      safetyViolations += parsed.safetyViolation;
      lastFailureCode = null;
      return undefined;
    } catch (error) {
      const normalized = error instanceof ShadowPlanEvaluationLedgerError
        ? error
        : ledgerError(
          SHADOW_PLAN_EVALUATION_LEDGER_REASONS.INVALID_REPORT
        );
      rejections += 1;
      if (normalized.code
        === SHADOW_PLAN_EVALUATION_LEDGER_REASONS.DUPLICATE_REPORT) {
        duplicateReports += 1;
      }
      lastFailureCode = normalized.code;
      throw normalized;
    }
  }

  const reportSink = Object.freeze({
    version: SHADOW_PLAN_EVALUATION_REPORT_SINK_VERSION,
    record,
  });

  function snapshot() {
    const eligibleCases = records.length;
    const parityRateBasisPoints = rateBasisPoints(parityPasses, eligibleCases);
    const authoritativeFunctionalSuccessRateBasisPoints = rateBasisPoints(
      authoritativeFunctionalSuccesses,
      eligibleCases
    );
    const shadowFunctionalSuccessRateBasisPoints = rateBasisPoints(
      shadowFunctionalSuccesses,
      eligibleCases
    );
    const functionalSuccessDeltaBasisPoints =
      shadowFunctionalSuccessRateBasisPoints
      - authoritativeFunctionalSuccessRateBasisPoints;
    let status;
    const reasons = [];
    if (eligibleCases < minimumEligibleCases) {
      status = SHADOW_PLAN_EVALUATION_GATE_STATUSES.INSUFFICIENT_DATA;
      reasons.push(
        SHADOW_PLAN_EVALUATION_GATE_REASONS.INSUFFICIENT_SAMPLE
      );
    } else {
      if (parityRateBasisPoints < requiredParityRateBasisPoints) {
        reasons.push(
          SHADOW_PLAN_EVALUATION_GATE_REASONS.PARITY_BELOW_THRESHOLD
        );
      }
      if (functionalSuccessDeltaBasisPoints
        < -maximumFunctionalRegressionBasisPoints) {
        reasons.push(
          SHADOW_PLAN_EVALUATION_GATE_REASONS.FUNCTIONAL_REGRESSION
        );
      }
      if (safetyViolations > 0) {
        reasons.push(SHADOW_PLAN_EVALUATION_GATE_REASONS.SAFETY_VIOLATION);
      }
      status = reasons.length === 0
        ? SHADOW_PLAN_EVALUATION_GATE_STATUSES.PASS
        : SHADOW_PLAN_EVALUATION_GATE_STATUSES.FAIL;
    }
    return deepFreeze({
      schemaVersion: SHADOW_PLAN_EVALUATION_LEDGER_SNAPSHOT_SCHEMA_VERSION,
      ledgerVersion: SHADOW_PLAN_EVALUATION_LEDGER_VERSION,
      rubricVersion: SHADOW_PLAN_RUBRIC_VERSION,
      thresholds: {
        minimumEligibleCases,
        requiredParityRateBasisPoints,
        maximumFunctionalRegressionBasisPoints,
      },
      totals: {
        eligibleCases,
        parityPasses,
        parityRateBasisPoints,
        authoritativeFunctionalSuccesses,
        shadowFunctionalSuccesses,
        authoritativeFunctionalSuccessRateBasisPoints,
        shadowFunctionalSuccessRateBasisPoints,
        functionalSuccessDeltaBasisPoints,
        safetyViolations,
      },
      gate: { status, reasons },
      headDigest,
    });
  }

  function diagnostics() {
    return Object.freeze({
      version: SHADOW_PLAN_EVALUATION_LEDGER_VERSION,
      reportSinkVersion: SHADOW_PLAN_EVALUATION_REPORT_SINK_VERSION,
      acceptedReports: records.length,
      rejections,
      duplicateReports,
      lastFailureCode,
    });
  }

  return Object.freeze({
    version: SHADOW_PLAN_EVALUATION_LEDGER_VERSION,
    reportSink,
    snapshot,
    diagnostics,
  });
}

module.exports = {
  SHADOW_PLAN_EVALUATION_GATE_REASONS,
  SHADOW_PLAN_EVALUATION_GATE_STATUSES,
  SHADOW_PLAN_EVALUATION_LEDGER_REASONS,
  SHADOW_PLAN_EVALUATION_LEDGER_SNAPSHOT_SCHEMA_VERSION,
  SHADOW_PLAN_EVALUATION_LEDGER_VERSION,
  SHADOW_PLAN_EVALUATION_REPORT_SINK_VERSION,
  ShadowPlanEvaluationLedgerError,
  createShadowPlanEvaluationLedger,
};
