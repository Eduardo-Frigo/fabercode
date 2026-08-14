'use strict';

const {
  immutableSnapshot,
  normalizeDigest,
} = require('./capability_delegation_contracts');
const {
  TRANSACTIONAL_DELETE_CONTRACT_VERSION,
  TRANSACTIONAL_DELETE_STATES,
  canonicalSha256Digest,
  createTransactionalDeleteStateRecord,
} = require('./transactional_delete_contracts');

const TRANSACTIONAL_DELETE_JOURNAL_RECORD_SCHEMA_VERSION =
  'transactional-delete.journal-record.v1';
const SAFE_TRANSACTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const JOURNAL_INPUT_KEYS = Object.freeze([
  'transactionId',
  'planDigest',
  'checkpointDigest',
  'sequence',
  'previousRecordDigest',
  'stateRecord',
]);
const JOURNAL_RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'contractVersion',
  ...JOURNAL_INPUT_KEYS,
  'recordDigest',
]);
const STATE_RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'contractVersion',
  'previousState',
  'state',
  'at',
  'reasonCode',
]);
const CHAIN_BINDING_KEYS = Object.freeze([
  'transactionId',
  'planDigest',
  'checkpointDigest',
]);

function readPlainDataRecord(value, allowedKeys, requiredKeys = allowedKeys, fieldName = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be a plain data record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${fieldName} must be a plain data record`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) {
    throw new TypeError(`${fieldName} contains unsupported keys`);
  }
  for (const key of requiredKeys) {
    if (!ownKeys.includes(key)) throw new TypeError(`${fieldName}.${key} is required`);
  }
  const result = new Map();
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain enumerable data properties only`);
    }
    if (descriptor.value === undefined) throw new TypeError(`${fieldName}.${key} is undefined`);
    result.set(key, descriptor.value);
  }
  return result;
}

function normalizeTransactionId(value) {
  if (typeof value !== 'string' || !SAFE_TRANSACTION_ID_PATTERN.test(value)) {
    throw new TypeError('transactionId must be a bounded safe identifier');
  }
  return value;
}

function normalizeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError('sequence must be a non-negative safe integer');
  }
  return value;
}

function snapshotStateRecord(value) {
  const fields = readPlainDataRecord(
    value,
    STATE_RECORD_KEYS,
    STATE_RECORD_KEYS,
    'stateRecord'
  );
  const recreated = createTransactionalDeleteStateRecord({
    previousState: fields.get('previousState'),
    state: fields.get('state'),
    at: fields.get('at'),
    reasonCode: fields.get('reasonCode'),
  });
  if (fields.get('schemaVersion') !== recreated.schemaVersion
    || fields.get('contractVersion') !== recreated.contractVersion) {
    throw new TypeError('stateRecord version is invalid');
  }
  return recreated;
}

function createTransactionalDeleteJournalRecord(input = {}) {
  const fields = readPlainDataRecord(
    input,
    JOURNAL_INPUT_KEYS,
    JOURNAL_INPUT_KEYS,
    'journal record input'
  );
  const sequence = normalizeSequence(fields.get('sequence'));
  const previousRecordDigest = fields.get('previousRecordDigest') === null
    ? null
    : normalizeDigest(fields.get('previousRecordDigest'), 'previousRecordDigest');
  if ((sequence === 0) !== (previousRecordDigest === null)) {
    throw new TypeError('Only the genesis journal record may omit previousRecordDigest');
  }
  const stateRecord = snapshotStateRecord(fields.get('stateRecord'));
  if (sequence === 0
    && (stateRecord.previousState !== null
      || stateRecord.state !== TRANSACTIONAL_DELETE_STATES.PREPARING)) {
    throw new TypeError('The genesis journal record must start at PREPARING');
  }
  const core = {
    schemaVersion: TRANSACTIONAL_DELETE_JOURNAL_RECORD_SCHEMA_VERSION,
    contractVersion: TRANSACTIONAL_DELETE_CONTRACT_VERSION,
    transactionId: normalizeTransactionId(fields.get('transactionId')),
    planDigest: normalizeDigest(fields.get('planDigest'), 'planDigest'),
    checkpointDigest: normalizeDigest(fields.get('checkpointDigest'), 'checkpointDigest'),
    sequence,
    previousRecordDigest,
    stateRecord,
  };
  return immutableSnapshot({
    ...core,
    recordDigest: canonicalSha256Digest(core),
  });
}

function snapshotJournalRecord(value) {
  const fields = readPlainDataRecord(
    value,
    JOURNAL_RECORD_KEYS,
    JOURNAL_RECORD_KEYS,
    'journal record'
  );
  if (fields.get('schemaVersion') !== TRANSACTIONAL_DELETE_JOURNAL_RECORD_SCHEMA_VERSION
    || fields.get('contractVersion') !== TRANSACTIONAL_DELETE_CONTRACT_VERSION) {
    throw new TypeError('journal record version is invalid');
  }
  const recreated = createTransactionalDeleteJournalRecord({
    transactionId: fields.get('transactionId'),
    planDigest: fields.get('planDigest'),
    checkpointDigest: fields.get('checkpointDigest'),
    sequence: fields.get('sequence'),
    previousRecordDigest: fields.get('previousRecordDigest'),
    stateRecord: fields.get('stateRecord'),
  });
  if (fields.get('recordDigest') !== recreated.recordDigest) {
    throw new TypeError('journal record digest is invalid');
  }
  return recreated;
}

function readDenseJournal(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('journal must be a standard dense array');
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (!value.length
    || keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) {
    throw new TypeError('journal must be a non-empty dense array');
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('journal entries must be enumerable data properties');
    }
    return descriptor.value;
  });
}

function verifyTransactionalDeleteJournalChain(journal, expectedBinding = {}) {
  const binding = readPlainDataRecord(
    expectedBinding,
    CHAIN_BINDING_KEYS,
    CHAIN_BINDING_KEYS,
    'journal binding'
  );
  const transactionId = normalizeTransactionId(binding.get('transactionId'));
  const planDigest = normalizeDigest(binding.get('planDigest'), 'planDigest');
  const checkpointDigest = normalizeDigest(binding.get('checkpointDigest'), 'checkpointDigest');
  const entries = readDenseJournal(journal);
  const records = [];
  let prior = null;
  for (let index = 0; index < entries.length; index += 1) {
    const record = snapshotJournalRecord(entries[index]);
    if (record.transactionId !== transactionId
      || record.planDigest !== planDigest
      || record.checkpointDigest !== checkpointDigest) {
      throw new TypeError('journal record is bound to another transaction or checkpoint');
    }
    if (record.sequence !== index
      || record.previousRecordDigest !== (prior ? prior.recordDigest : null)) {
      throw new TypeError('journal chain order or previous digest is invalid');
    }
    if (prior && record.stateRecord.previousState !== prior.stateRecord.state) {
      throw new TypeError('journal state transition does not follow the previous record');
    }
    records.push(record);
    prior = record;
  }
  return immutableSnapshot({ records, latest: prior });
}

module.exports = {
  TRANSACTIONAL_DELETE_JOURNAL_RECORD_SCHEMA_VERSION,
  createTransactionalDeleteJournalRecord,
  verifyTransactionalDeleteJournalChain,
};
