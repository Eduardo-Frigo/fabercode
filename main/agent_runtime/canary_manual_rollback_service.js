'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  CANARY_PROMOTION_CONTROLLER_VERSION,
  CANARY_PROMOTION_TRANSACTION_VERSION,
} = require('./canary_promotion_controller');
const {
  CANARY_MANUAL_ROLLBACK_JOURNAL_REMOVE_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION,
} = require('./canary_manual_rollback_journal_contract');
const {
  CANARY_PROMOTION_REQUEST_VERSION,
  CANARY_PROMOTION_REVERT_RECEIPT_VERSION,
  assertCanaryPromotionReceipt,
  assertCanaryPromotionRevertReceipt,
} = require('./canary_promotion_contract');
const {
  CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SCHEMA_VERSION,
  CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SINK_VERSION,
} = require('./canary_rollout_evidence_ledger');
const {
  CANARY_ROLLOUT_STAGES,
} = require('./canary_rollout_selector');

const CANARY_MANUAL_ROLLBACK_SERVICE_VERSION =
  'canary-manual-rollback-service.v1';
const CANARY_MANUAL_ROLLBACK_PROMOTION_SINK_VERSION =
  'canary-manual-rollback-promotion-sink.v1';
const CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION =
  'canary-manual-rollback-promotion-registration.v1';
const CANARY_MANUAL_ROLLBACK_RECEIPT_SCHEMA_VERSION =
  'canary-manual-rollback-receipt.v1';

const CANARY_MANUAL_ROLLBACK_SERVICE_REASONS = Object.freeze({
  INVALID_INPUT: 'CANARY_MANUAL_ROLLBACK_INVALID_INPUT',
  REGISTRATION_JOURNAL_FAILED:
    'CANARY_MANUAL_ROLLBACK_REGISTRATION_JOURNAL_FAILED',
  PROMOTION_NOT_FOUND: 'CANARY_MANUAL_ROLLBACK_PROMOTION_NOT_FOUND',
  PROMOTION_REGISTRATION_CONFLICT:
    'CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_CONFLICT',
  RECONCILIATION_FAILED: 'CANARY_MANUAL_ROLLBACK_RECONCILIATION_FAILED',
  ROLLBACK_FAILED: 'CANARY_MANUAL_ROLLBACK_FAILED',
});

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_REASON = /^[a-z][a-z0-9_:-]{0,79}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OPTION_KEYS = Object.freeze([
  'promotionController',
  'reconciliationSink',
  'registrationJournal',
]);
const CONTROLLER_KEYS = Object.freeze([
  'version',
  'promote',
  'revert',
  'diagnostics',
]);
const CONTROLLER_DIAGNOSTIC_KEYS = Object.freeze([
  'version',
  'backendVersion',
  'promotionContract',
  'revertContract',
]);
const RECONCILIATION_SINK_KEYS = Object.freeze(['version', 'record']);
const REGISTRATION_JOURNAL_KEYS = Object.freeze([
  'version',
  'load',
  'append',
  'remove',
  'diagnostics',
]);
const REGISTRATION_JOURNAL_DIAGNOSTIC_KEYS = Object.freeze([
  'version',
  'durability',
  'stateModel',
]);
const REGISTRATION_JOURNAL_SNAPSHOT_KEYS = Object.freeze([
  'schemaVersion',
  'registrations',
]);
const REGISTRATION_KEYS = Object.freeze([
  'schemaVersion',
  'rolloutStage',
  'transaction',
]);
const TRANSACTION_KEYS = Object.freeze(['version', 'request', 'receipt']);
const CANCEL_KEYS = Object.freeze(['promotionId', 'reason']);
const ROLLBACK_INPUT_KEYS = Object.freeze([
  'jobId',
  'projectId',
  'promotionId',
  'reason',
]);
const VALID_STAGES = new Set(Object.values(CANARY_ROLLOUT_STAGES));

class CanaryManualRollbackServiceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryManualRollbackServiceError';
    this.code = code;
  }
}

function serviceError(code) {
  return new CanaryManualRollbackServiceError(code);
}

function fail(code) {
  throw serviceError(code);
}

function exactDataFields(value, expectedKeys, { frozen = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)
    || frozen && !Object.isFrozen(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key)
      || !expectedKeys.includes(key))
    || expectedKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function inspectableFunction(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)) {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  try {
    Function.prototype.toString.call(value);
  } catch {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  return value;
}

function synchronousDiagnostics(receiver, method, expectedKeys, fieldName) {
  let value;
  try {
    value = Reflect.apply(method, receiver, []);
  } catch {
    throw new TypeError(fieldName + '.diagnostics failed');
  }
  if (util.types.isPromise(value)) {
    value.catch(() => {});
    throw new TypeError(fieldName + '.diagnostics must be synchronous');
  }
  const fields = exactDataFields(value, expectedKeys, { frozen: true });
  if (!fields) throw new TypeError(fieldName + '.diagnostics is invalid');
  return fields;
}

function capturePromotionController(value) {
  const fields = exactDataFields(value, CONTROLLER_KEYS, { frozen: true });
  if (!fields
    || fields.get('version') !== CANARY_PROMOTION_CONTROLLER_VERSION) {
    throw new TypeError('promotionController must be the guarded controller');
  }
  const controller = Object.freeze({
    receiver: value,
    version: fields.get('version'),
    revert: inspectableFunction(
      fields.get('revert'),
      'promotionController.revert'
    ),
  });
  const diagnostics = synchronousDiagnostics(
    value,
    inspectableFunction(
      fields.get('diagnostics'),
      'promotionController.diagnostics'
    ),
    CONTROLLER_DIAGNOSTIC_KEYS,
    'promotionController'
  );
  if (diagnostics.get('version') !== CANARY_PROMOTION_CONTROLLER_VERSION
    || diagnostics.get('promotionContract') !== CANARY_PROMOTION_REQUEST_VERSION
    || diagnostics.get('revertContract')
      !== CANARY_PROMOTION_REVERT_RECEIPT_VERSION) {
    throw new TypeError('promotionController diagnostics are invalid');
  }
  return controller;
}

function captureReconciliationSink(value) {
  const fields = exactDataFields(
    value,
    RECONCILIATION_SINK_KEYS,
    { frozen: true }
  );
  if (!fields
    || fields.get('version')
      !== CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SINK_VERSION) {
    throw new TypeError('reconciliationSink must be the rollout sink');
  }
  return Object.freeze({
    receiver: value,
    version: fields.get('version'),
    record: inspectableFunction(
      fields.get('record'),
      'reconciliationSink.record'
    ),
  });
}

function captureRegistrationJournal(value) {
  const fields = exactDataFields(
    value,
    REGISTRATION_JOURNAL_KEYS,
    { frozen: true }
  );
  if (!fields
    || fields.get('version') !== CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION) {
    throw new TypeError('registrationJournal must be the durable journal');
  }
  const journal = Object.freeze({
    receiver: value,
    version: fields.get('version'),
    load: inspectableFunction(fields.get('load'), 'registrationJournal.load'),
    append: inspectableFunction(
      fields.get('append'),
      'registrationJournal.append'
    ),
    remove: inspectableFunction(
      fields.get('remove'),
      'registrationJournal.remove'
    ),
  });
  const diagnostics = synchronousDiagnostics(
    value,
    inspectableFunction(
      fields.get('diagnostics'),
      'registrationJournal.diagnostics'
    ),
    REGISTRATION_JOURNAL_DIAGNOSTIC_KEYS,
    'registrationJournal'
  );
  if (diagnostics.get('version') !== CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION
    || diagnostics.get('durability') !== 'private_user_data'
    || diagnostics.get('stateModel') !== 'registered_removed') {
    throw new TypeError('registrationJournal diagnostics are invalid');
  }
  return journal;
}

function captureDependencies(options) {
  const fields = exactDataFields(options, OPTION_KEYS);
  if (!fields) throw new TypeError('Invalid canary manual rollback options');
  return Object.freeze({
    promotionController: capturePromotionController(
      fields.get('promotionController')
    ),
    reconciliationSink: captureReconciliationSink(
      fields.get('reconciliationSink')
    ),
    registrationJournal: captureRegistrationJournal(
      fields.get('registrationJournal')
    ),
  });
}

function frozenArrayValues(value) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || !Object.isFrozen(value)) return null;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) return null;
  const output = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) return null;
    output.push(descriptor.value);
  }
  return output;
}

function callRegistrationJournal(journal, method, value) {
  let result;
  try {
    result = value === undefined
      ? Reflect.apply(journal[method], journal.receiver, [])
      : Reflect.apply(journal[method], journal.receiver, [value]);
  } catch {
    fail(
      CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.REGISTRATION_JOURNAL_FAILED
    );
  }
  if (util.types.isPromise(result)) {
    result.catch(() => {});
    fail(
      CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.REGISTRATION_JOURNAL_FAILED
    );
  }
  return result;
}

function loadRegistrationJournal(journal) {
  const snapshot = callRegistrationJournal(journal, 'load');
  const fields = exactDataFields(
    snapshot,
    REGISTRATION_JOURNAL_SNAPSHOT_KEYS,
    { frozen: true }
  );
  const registrations = fields
    ? frozenArrayValues(fields.get('registrations'))
    : null;
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_MANUAL_ROLLBACK_JOURNAL_SNAPSHOT_SCHEMA_VERSION
    || !registrations) {
    throw new TypeError('registrationJournal snapshot is invalid');
  }
  return registrations;
}

function removeRegistration(journal, promotionId) {
  const result = callRegistrationJournal(
    journal,
    'remove',
    Object.freeze({
      schemaVersion: CANARY_MANUAL_ROLLBACK_JOURNAL_REMOVE_SCHEMA_VERSION,
      promotionId,
    })
  );
  if (result !== undefined) {
    fail(
      CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.REGISTRATION_JOURNAL_FAILED
    );
  }
}

function normalizeRegistration(value) {
  const fields = exactDataFields(value, REGISTRATION_KEYS, { frozen: true });
  const rolloutStage = fields && fields.get('rolloutStage');
  const transaction = fields && fields.get('transaction');
  const transactionFields = transaction
    ? exactDataFields(transaction, TRANSACTION_KEYS, { frozen: true })
    : null;
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION
    || !VALID_STAGES.has(rolloutStage)
    || !transactionFields
    || transactionFields.get('version') !== CANARY_PROMOTION_TRANSACTION_VERSION) {
    return null;
  }
  let receipt;
  try {
    receipt = assertCanaryPromotionReceipt(
      transactionFields.get('receipt'),
      transactionFields.get('request')
    );
  } catch {
    return null;
  }
  const request = transactionFields.get('request');
  if (!SAFE_IDENTIFIER.test(request.promotionId)
    || !SAFE_IDENTIFIER.test(request.jobId)
    || !SAFE_IDENTIFIER.test(request.projectId)) return null;
  return Object.freeze({
    schemaVersion:
      CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION,
    rolloutStage,
    transaction,
    request,
    receipt,
  });
}

function normalizeCancel(value) {
  const fields = exactDataFields(value, CANCEL_KEYS, { frozen: true });
  if (!fields
    || typeof fields.get('promotionId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('promotionId'))
    || typeof fields.get('reason') !== 'string'
    || !SAFE_REASON.test(fields.get('reason'))) return null;
  return Object.freeze({
    promotionId: fields.get('promotionId'),
    reason: fields.get('reason'),
  });
}

function normalizeRollbackInput(value) {
  const fields = exactDataFields(value, ROLLBACK_INPUT_KEYS, { frozen: true });
  if (!fields
    || !['jobId', 'projectId', 'promotionId'].every((key) => (
      typeof fields.get(key) === 'string'
        && SAFE_IDENTIFIER.test(fields.get(key))
    ))
    || typeof fields.get('reason') !== 'string'
    || !SAFE_REASON.test(fields.get('reason'))) return null;
  return Object.freeze(Object.fromEntries(
    ROLLBACK_INPUT_KEYS.map((key) => [key, fields.get(key)])
  ));
}

function fingerprint(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function reconciliationId(record) {
  return 'rollback-' + crypto.createHash('sha256')
    .update(record.request.promotionId, 'utf8')
    .update('\n')
    .update(record.promotionReceipt.inversePatchDigest, 'utf8')
    .digest('hex');
}

function storedPromotion(registration, registrationValue) {
  return {
    registration,
    registrationFingerprint: fingerprint(registrationValue),
    transaction: registration.transaction,
    request: registration.request,
    promotionReceipt: registration.receipt,
    rolloutStage: registration.rolloutStage,
    state: 'available',
    rollbackPromise: null,
    revertReceipt: null,
    reconciliationPersisted: false,
    receipt: null,
  };
}

function callControllerRevert(controller, transaction, reason) {
  let pending;
  try {
    pending = Reflect.apply(
      controller.revert,
      controller.receiver,
      [Object.freeze({ transaction, reason })]
    );
  } catch {
    return Promise.reject(serviceError(
      CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.ROLLBACK_FAILED
    ));
  }
  if (!util.types.isPromise(pending)) {
    return Promise.reject(serviceError(
      CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.ROLLBACK_FAILED
    ));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, pending, [
        resolve,
        () => reject(serviceError(
          CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.ROLLBACK_FAILED
        )),
      ]);
    } catch {
      reject(serviceError(
        CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.ROLLBACK_FAILED
      ));
    }
  });
}

function persistReconciliation(sink, value) {
  let result;
  try {
    result = Reflect.apply(sink.record, sink.receiver, [value]);
  } catch {
    fail(CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.RECONCILIATION_FAILED);
  }
  if (util.types.isPromise(result)) {
    result.catch(() => {});
    fail(CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.RECONCILIATION_FAILED);
  }
  if (result !== undefined) {
    fail(CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.RECONCILIATION_FAILED);
  }
}

function createCanaryManualRollbackService(options = {}) {
  const dependencies = captureDependencies(options);
  const promotions = new Map();
  const cancelledPromotionIds = new Set();
  let registrations = 0;
  let cancellations = 0;
  let completedRollbacks = 0;
  let rollbackFailures = 0;
  let reconciliationFailures = 0;
  let rejections = 0;
  let lastFailureCode = null;

  const recoveredRegistrations = loadRegistrationJournal(
    dependencies.registrationJournal
  );
  for (const registrationValue of recoveredRegistrations) {
    const registration = normalizeRegistration(registrationValue);
    const promotionId = registration && registration.request.promotionId;
    if (!registration || promotions.has(promotionId)) {
      throw new TypeError('registrationJournal contains invalid registrations');
    }
    promotions.set(
      promotionId,
      storedPromotion(registration, registrationValue)
    );
    registrations += 1;
  }

  function reject(code) {
    rejections += 1;
    lastFailureCode = code;
    fail(code);
  }

  function record(value) {
    const registration = normalizeRegistration(value);
    if (!registration) {
      reject(CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.INVALID_INPUT);
    }
    const promotionId = registration.request.promotionId;
    const registrationFingerprint = fingerprint(value);
    const existing = promotions.get(promotionId);
    if (existing) {
      if (existing.registrationFingerprint === registrationFingerprint) {
        lastFailureCode = null;
        return undefined;
      }
      reject(
        CANARY_MANUAL_ROLLBACK_SERVICE_REASONS
          .PROMOTION_REGISTRATION_CONFLICT
      );
    }
    if (cancelledPromotionIds.has(promotionId)) {
      reject(
        CANARY_MANUAL_ROLLBACK_SERVICE_REASONS
          .PROMOTION_REGISTRATION_CONFLICT
      );
    }
    try {
      const result = callRegistrationJournal(
        dependencies.registrationJournal,
        'append',
        value
      );
      if (result !== undefined) {
        fail(
          CANARY_MANUAL_ROLLBACK_SERVICE_REASONS
            .REGISTRATION_JOURNAL_FAILED
        );
      }
    } catch {
      reject(
        CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.REGISTRATION_JOURNAL_FAILED
      );
    }
    promotions.set(promotionId, storedPromotion(registration, value));
    registrations += 1;
    lastFailureCode = null;
    return undefined;
  }

  function cancel(value) {
    const input = normalizeCancel(value);
    if (!input) {
      reject(CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.INVALID_INPUT);
    }
    if (cancelledPromotionIds.has(input.promotionId)) {
      lastFailureCode = null;
      return undefined;
    }
    const recordValue = promotions.get(input.promotionId);
    if (!recordValue) {
      reject(CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.PROMOTION_NOT_FOUND);
    }
    if (recordValue.rollbackPromise || recordValue.revertReceipt) {
      reject(
        CANARY_MANUAL_ROLLBACK_SERVICE_REASONS
          .PROMOTION_REGISTRATION_CONFLICT
      );
    }
    try {
      removeRegistration(
        dependencies.registrationJournal,
        input.promotionId
      );
    } catch {
      reject(
        CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.REGISTRATION_JOURNAL_FAILED
      );
    }
    promotions.delete(input.promotionId);
    cancelledPromotionIds.add(input.promotionId);
    cancellations += 1;
    lastFailureCode = null;
    return undefined;
  }

  function reconciliationFor(recordValue) {
    return Object.freeze({
      schemaVersion: CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SCHEMA_VERSION,
      reconciliationId: reconciliationId(recordValue),
      jobId: recordValue.request.jobId,
      projectId: recordValue.request.projectId,
      rolloutStage: recordValue.rolloutStage,
      manualRollback: true,
      corrupted: false,
      dataLossIncident: false,
      securityIncident: false,
      duplicateExternalEffect: false,
    });
  }

  async function performRollback(recordValue, input) {
    if (!recordValue.revertReceipt) {
      try {
        const value = await callControllerRevert(
          dependencies.promotionController,
          recordValue.transaction,
          input.reason
        );
        recordValue.revertReceipt = assertCanaryPromotionRevertReceipt(value, {
          request: recordValue.request,
          promotionReceipt: recordValue.promotionReceipt,
        });
        recordValue.state = 'reverted_unreconciled';
      } catch {
        rollbackFailures += 1;
        lastFailureCode =
          CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.ROLLBACK_FAILED;
        throw serviceError(
          CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.ROLLBACK_FAILED
        );
      }
    }
    const reconciliation = reconciliationFor(recordValue);
    if (!recordValue.reconciliationPersisted) {
      try {
        persistReconciliation(dependencies.reconciliationSink, reconciliation);
        recordValue.reconciliationPersisted = true;
        recordValue.state = 'reconciled_unfinalized';
      } catch {
        reconciliationFailures += 1;
        lastFailureCode =
          CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.RECONCILIATION_FAILED;
        throw serviceError(
          CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.RECONCILIATION_FAILED
        );
      }
    }
    try {
      removeRegistration(
        dependencies.registrationJournal,
        recordValue.request.promotionId
      );
    } catch {
      lastFailureCode = CANARY_MANUAL_ROLLBACK_SERVICE_REASONS
        .REGISTRATION_JOURNAL_FAILED;
      throw serviceError(
        CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.REGISTRATION_JOURNAL_FAILED
      );
    }
    recordValue.receipt = Object.freeze({
      schemaVersion: CANARY_MANUAL_ROLLBACK_RECEIPT_SCHEMA_VERSION,
      jobId: recordValue.request.jobId,
      projectId: recordValue.request.projectId,
      promotionId: recordValue.request.promotionId,
      rolloutStage: recordValue.rolloutStage,
      reconciliationId: reconciliation.reconciliationId,
      revertReceipt: recordValue.revertReceipt,
    });
    recordValue.state = 'completed';
    completedRollbacks += 1;
    lastFailureCode = null;
    return recordValue.receipt;
  }

  function rollback(value) {
    const input = normalizeRollbackInput(value);
    if (!input) {
      rejections += 1;
      lastFailureCode =
        CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.INVALID_INPUT;
      return Promise.reject(serviceError(
        CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.INVALID_INPUT
      ));
    }
    const recordValue = promotions.get(input.promotionId);
    if (!recordValue
      || recordValue.request.jobId !== input.jobId
      || recordValue.request.projectId !== input.projectId) {
      rejections += 1;
      lastFailureCode =
        CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.PROMOTION_NOT_FOUND;
      return Promise.reject(serviceError(
        CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.PROMOTION_NOT_FOUND
      ));
    }
    if (recordValue.receipt) {
      lastFailureCode = null;
      return Promise.resolve(recordValue.receipt);
    }
    if (recordValue.rollbackPromise) return recordValue.rollbackPromise;
    const pending = performRollback(recordValue, input);
    recordValue.rollbackPromise = pending;
    Reflect.apply(Promise.prototype.then, pending, [
      () => {
        if (recordValue.rollbackPromise === pending) {
          recordValue.rollbackPromise = null;
        }
      },
      () => {
        if (recordValue.rollbackPromise === pending) {
          recordValue.rollbackPromise = null;
        }
      },
    ]);
    return pending;
  }

  function diagnostics() {
    let availablePromotions = 0;
    let unreconciledRollbacks = 0;
    let inFlightRollbacks = 0;
    for (const recordValue of promotions.values()) {
      if (recordValue.state === 'available') availablePromotions += 1;
      if (recordValue.state === 'reverted_unreconciled') {
        unreconciledRollbacks += 1;
      }
      if (recordValue.rollbackPromise) inFlightRollbacks += 1;
    }
    return Object.freeze({
      version: CANARY_MANUAL_ROLLBACK_SERVICE_VERSION,
      promotionSinkVersion: CANARY_MANUAL_ROLLBACK_PROMOTION_SINK_VERSION,
      registrations,
      cancellations,
      availablePromotions,
      completedRollbacks,
      unreconciledRollbacks,
      inFlightRollbacks,
      rollbackFailures,
      reconciliationFailures,
      rejections,
      lastFailureCode,
    });
  }

  const promotionSink = Object.freeze({
    version: CANARY_MANUAL_ROLLBACK_PROMOTION_SINK_VERSION,
    record,
    cancel,
  });

  return Object.freeze({
    version: CANARY_MANUAL_ROLLBACK_SERVICE_VERSION,
    promotionSink,
    rollback,
    diagnostics,
  });
}

module.exports = {
  CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_PROMOTION_SINK_VERSION,
  CANARY_MANUAL_ROLLBACK_RECEIPT_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_SERVICE_REASONS,
  CANARY_MANUAL_ROLLBACK_SERVICE_VERSION,
  CanaryManualRollbackServiceError,
  createCanaryManualRollbackService,
};
