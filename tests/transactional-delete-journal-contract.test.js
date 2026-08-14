'use strict';

const assert = require('assert');

const {
  TRANSACTIONAL_DELETE_JOURNAL_RECORD_SCHEMA_VERSION,
  createTransactionalDeleteJournalRecord,
  verifyTransactionalDeleteJournalChain,
} = require('../main/capabilities/transactional_delete_journal_contract');
const {
  TRANSACTIONAL_DELETE_STATES,
  createTransactionalDeleteStateRecord,
} = require('../main/capabilities/transactional_delete_contracts');

const digest = (character) => `sha256:${character.repeat(64)}`;
const bindingA = Object.freeze({
  transactionId: 'transaction-a',
  planDigest: digest('a'),
  checkpointDigest: digest('b'),
});

function state(previousState, nextState, at, reasonCode = '') {
  return createTransactionalDeleteStateRecord({
    previousState,
    state: nextState,
    at,
    reasonCode,
  });
}

function append(binding, journal, stateRecord) {
  const previous = journal.length ? journal[journal.length - 1] : null;
  return createTransactionalDeleteJournalRecord({
    ...binding,
    sequence: journal.length,
    previousRecordDigest: previous ? previous.recordDigest : null,
    stateRecord,
  });
}

const journalA = [];
journalA.push(append(
  bindingA,
  journalA,
  state(null, TRANSACTIONAL_DELETE_STATES.PREPARING, 1)
));
journalA.push(append(
  bindingA,
  journalA,
  state(TRANSACTIONAL_DELETE_STATES.PREPARING, TRANSACTIONAL_DELETE_STATES.PREPARED, 2)
));
journalA.push(append(
  bindingA,
  journalA,
  state(TRANSACTIONAL_DELETE_STATES.PREPARED, TRANSACTIONAL_DELETE_STATES.APPLYING, 3)
));

assert.strictEqual(
  journalA[0].schemaVersion,
  TRANSACTIONAL_DELETE_JOURNAL_RECORD_SCHEMA_VERSION
);
assert(Object.isFrozen(journalA[0]));
assert(Object.isFrozen(journalA[0].stateRecord));
assert.match(journalA[0].recordDigest, /^sha256:[a-f0-9]{64}$/);

const verified = verifyTransactionalDeleteJournalChain(journalA, bindingA);
assert(Object.isFrozen(verified));
assert(Object.isFrozen(verified.records));
assert.strictEqual(verified.records.length, 3);
assert.strictEqual(verified.latest.stateRecord.state, TRANSACTIONAL_DELETE_STATES.APPLYING);

const bindingB = Object.freeze({
  transactionId: 'transaction-b',
  planDigest: digest('c'),
  checkpointDigest: digest('d'),
});
const journalB = [];
journalB.push(append(
  bindingB,
  journalB,
  state(null, TRANSACTIONAL_DELETE_STATES.PREPARING, 1)
));
journalB.push(append(
  bindingB,
  journalB,
  state(TRANSACTIONAL_DELETE_STATES.PREPARING, TRANSACTIONAL_DELETE_STATES.PREPARED, 2)
));

assert.throws(
  () => verifyTransactionalDeleteJournalChain(
    [journalA[0], journalB[1]],
    bindingA
  ),
  /another transaction|chain/
);
assert.throws(
  () => verifyTransactionalDeleteJournalChain(
    [journalA[0], journalA[2]],
    bindingA
  ),
  /chain order|transition/
);
assert.throws(
  () => verifyTransactionalDeleteJournalChain(
    [{ ...journalA[0], recordDigest: digest('f') }],
    bindingA
  ),
  /digest/
);
assert.throws(() => createTransactionalDeleteJournalRecord({
  ...bindingA,
  sequence: 1,
  previousRecordDigest: null,
  stateRecord: journalA[1].stateRecord,
}), /genesis/);

let hostileGetterRead = false;
const hostile = {
  ...bindingA,
  sequence: 0,
  previousRecordDigest: null,
  stateRecord: journalA[0].stateRecord,
};
Object.defineProperty(hostile, 'transactionId', {
  configurable: true,
  enumerable: true,
  get() {
    hostileGetterRead = true;
    return 'transaction-a';
  },
});
assert.throws(() => createTransactionalDeleteJournalRecord(hostile), /data properties/);
assert.strictEqual(hostileGetterRead, false);

const hostileArray = [journalA[0]];
let hostileMapCalled = false;
Object.setPrototypeOf(hostileArray, {
  map() {
    hostileMapCalled = true;
    return [];
  },
});
assert.throws(
  () => verifyTransactionalDeleteJournalChain(hostileArray, bindingA),
  /standard dense array/
);
assert.strictEqual(hostileMapCalled, false);

console.log('transactional delete journal contract tests passed');
