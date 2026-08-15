'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
} = require('../main/capabilities/anchored_filesystem_mutation_backend_contract');
const {
  ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
  ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
  ANCHORED_MUTATION_HELPER_LIMITS,
  ANCHORED_MUTATION_HELPER_OPERATIONS,
  ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
  assertAnchoredMutationHelperAbort,
  assertAnchoredMutationHelperRequest,
  assertAnchoredMutationHelperResponse,
  createAnchoredMutationHelperProtocolClient,
  createAnchoredMutationHelperRequest,
  createAnchoredMutationHelperResponse,
} = require('../main/capabilities/anchored_mutation_helper_protocol');
const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');

const digest = (character) => `sha256:${character.repeat(64)}`;
const bytesDigest = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

function idFactory(prefix = 'request') {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

function sessionInput() {
  return {
    rootPath: '/project',
    transactionPath: '/project/.faber/transactions/transaction-1',
    payloadPath: '/project/.faber/transactions/transaction-1/payload',
    headPath: '/project/.faber/transaction-heads/job-1.json',
    anchorPath: '/project/.faber/transaction-journal/transaction-1',
    bindingDigest: digest('a'),
    checkpointDigest: digest('b'),
    targets: [{ relativePath: 'docs/file.txt', payloadName: 'target-0001' }],
    checkpointEntries: [{
      relativePath: 'docs/file.txt',
      kind: 'file',
      bytes: 3,
      mode: 0o644,
      mtimeMs: 100,
      contentDigest: digest('c'),
      linkTarget: null,
    }],
  };
}

function twoTargetSessionInput() {
  const input = sessionInput();
  return {
    ...input,
    targets: [
      ...input.targets,
      { relativePath: 'docs/second.txt', payloadName: 'target-0002' },
    ],
    checkpointEntries: [
      ...input.checkpointEntries,
      {
        relativePath: 'docs/second.txt',
        kind: 'file',
        bytes: 4,
        mode: 0o644,
        mtimeMs: 101,
        contentDigest: digest('d'),
        linkTarget: null,
      },
    ],
  };
}

function handshakePayload(overrides = {}) {
  return {
    accepted: true,
    handshakeVersion: ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
    protocolVersion: ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
    backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    sessionContractVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    helperId: 'test-native-helper',
    guarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
    features: {
      synchronousEffects: true,
      dataOnlyMessages: true,
      digestBound: true,
      sequenceBound: true,
      privateNamespaceIo: 'session_mediated',
      namespaceOpenedBeforeWrites: true,
      anchoredNamespaceCleanup: true,
      outOfBandAbort: true,
      orphanedSessionAutoClose: 'bounded_native_lease',
      maxOrphanLeaseMs: 5_000,
    },
    ...overrides,
  };
}

function openPayload(serial = 1, moved = []) {
  const progressCore = { checkpointDigest: digest('b'), moved: [] };
  progressCore.moved = [...moved];
  return {
    opened: true,
    sessionId: `native-session-${serial}`,
    namespaceCapabilityId: `namespace-capability-${serial}`,
    rootIdentityDigest: digest('d'),
    namespaceIdentityDigest: digest('e'),
    targetSetIdentityDigest: digest('f'),
    namespaceReadyBeforeWrites: true,
    movementProgress: {
      ...progressCore,
      progressDigest: canonicalSha256Digest(progressCore),
    },
  };
}

function createResponder({ mutate, operations = [], requestHook, aborts = [] } = {}) {
  const storedFiles = new Map();
  let openSerial = 0;
  let targetNames = [];
  return Object.freeze({
    exchange(request) {
      operations.push(request.operation);
      assert(Object.isFrozen(request));
      assert(Object.isFrozen(request.payload));
      assertAnchoredMutationHelperRequest(request);
      if (requestHook) requestHook(request);
      let payload;
      switch (request.operation) {
        case ANCHORED_MUTATION_HELPER_OPERATIONS.HANDSHAKE:
          payload = handshakePayload();
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_OPEN:
          assert.strictEqual(request.payload.namespacePolicy.io, 'session_mediated');
          assert.strictEqual(request.payload.namespacePolicy.pathnameHintsAreAuthority, false);
          openSerial += 1;
          targetNames = request.payload.targets.map((target) => target.payloadName);
          payload = openPayload(openSerial);
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_WRITE_FILE:
          storedFiles.set(request.payload.relativePath, request.payload.contentBase64);
          payload = { written: true, contentDigest: request.payload.contentDigest };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_READ_FILE: {
          const contentBase64 = storedFiles.get(request.payload.relativePath);
          payload = contentBase64 === undefined
            ? { found: false, contentBase64: null, contentDigest: null }
            : {
              found: true,
              contentBase64,
              contentDigest: bytesDigest(Buffer.from(contentBase64, 'base64')),
            };
          break;
        }
        case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_LIST:
          payload = { entries: [...storedFiles.keys()] };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_REMOVE:
          storedFiles.delete(request.payload.relativePath);
          payload = { removed: true };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_SYNC:
          payload = { synced: true };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_CLEANUP:
          storedFiles.clear();
          payload = { cleaned: true };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_VERIFY:
          payload = { verified: true };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_MOVE_TO_QUARANTINE:
          payload = {
            moved: [...targetNames],
            checkpointDigest: digest('b'),
            progressDigest: canonicalSha256Digest({
              checkpointDigest: digest('b'),
              moved: [...targetNames],
            }),
          };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_RESTORE_FROM_QUARANTINE:
          payload = {
            restored: [...targetNames].reverse(),
            remainingMoved: [],
            checkpointDigest: digest('b'),
            progressDigest: canonicalSha256Digest({
              checkpointDigest: digest('b'),
              moved: [],
            }),
          };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_PURGE_QUARANTINE:
          payload = { purged: true, namespaceCleaned: true };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_CLOSE:
          payload = { closed: true };
          break;
        default:
          throw new Error(`Unexpected operation ${request.operation}`);
      }
      const response = createAnchoredMutationHelperResponse(request, payload);
      return mutate ? mutate(request, response) : response;
    },
    abort(message) {
      aborts.push(message);
      assert(Object.isFrozen(message));
      assert.deepStrictEqual(assertAnchoredMutationHelperAbort(message), message);
      return { aborted: true, abortDigest: message.abortDigest };
    },
  });
}

// Happy path: a private namespace is opened by the native session before its
// first write; every message is immutable, sequenced and response-digest-bound.
{
  const operations = [];
  const requests = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations, requestHook: (request) => requests.push(request) }),
    requestIdFactory: idFactory('happy'),
  });
  const handshake = client.handshake();
  assert(Object.isFrozen(handshake));
  assert(Object.isFrozen(handshake.guarantees));
  assert(handshake.guarantees.includes('private_namespace_anchored'));
  const session = client.openSession(sessionInput());
  assert.strictEqual(session.schemaVersion, ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION);
  assert(Object.isFrozen(session));
  assert(Object.isFrozen(session.privateNamespace));

  const content = Buffer.from('journal data', 'utf8');
  const contentBase64 = content.toString('base64');
  const contentDigest = bytesDigest(content);
  assert.strictEqual(session.privateNamespace.writeFile({
    relativePath: 'transactions/transaction-1/journal.json',
    contentBase64,
    contentDigest,
    mode: 'replace_atomic',
  }).written, true);
  assert.strictEqual(session.privateNamespace.sync().synced, true);
  assert.deepStrictEqual(session.privateNamespace.readFile({
    relativePath: 'transactions/transaction-1/journal.json',
    maxBytes: 1024,
  }), { found: true, contentBase64, contentDigest });
  assert.deepStrictEqual(session.privateNamespace.list({
    relativePath: 'transactions/transaction-1',
    maxEntries: 10,
  }).entries, ['transactions/transaction-1/journal.json']);
  assert.strictEqual(session.verify({ checkpointDigest: digest('b') }).verified, true);
  assert.deepStrictEqual(
    session.moveToQuarantine({ checkpointDigest: digest('b') }).moved,
    ['target-0001']
  );
  assert.deepStrictEqual(
    session.restoreFromQuarantine({ checkpointDigest: digest('b') }).restored,
    ['target-0001']
  );
  assert.strictEqual(session.privateNamespace.cleanup().cleaned, true);
  assert.strictEqual(session.close().closed, true);

  assert.deepStrictEqual(operations, [
    'handshake',
    'session.open',
    'namespace.write_file',
    'namespace.sync',
    'namespace.read_file',
    'namespace.list',
    'session.verify',
    'session.move_to_quarantine',
    'session.restore_from_quarantine',
    'namespace.cleanup',
    'session.close',
  ]);
  assert.strictEqual(requests[0].sequence, 0);
  assert.strictEqual(requests[1].sequence, 0);
  assert.strictEqual(requests[1].previousResponseDigest, createAnchoredMutationHelperResponse(
    requests[0],
    handshakePayload()
  ).responseDigest);
  for (let index = 2; index < requests.length; index += 1) {
    assert.strictEqual(requests[index].sequence, index - 1);
  }
  const beforeClosedEffect = operations.length;
  assert.throws(
    () => session.verify({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_SESSION_CLOSED'
  );
  assert.strictEqual(operations.length, beforeClosedEffect);
}

// A helper cannot downgrade any required guarantee or namespace-I/O feature.
{
  let calls = 0;
  const transport = Object.freeze({
    exchange(request) {
      calls += 1;
      return createAnchoredMutationHelperResponse(request, handshakePayload({
        guarantees: ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES.filter(
          (guarantee) => guarantee !== 'private_namespace_anchored'
        ),
      }));
    },
    abort(message) { return { aborted: true, abortDigest: message.abortDigest }; },
  });
  const client = createAnchoredMutationHelperProtocolClient({
    transport,
    requestIdFactory: idFactory('downgrade'),
  });
  assert.throws(
    () => client.handshake(),
    (error) => error && error.code === 'PROTOCOL_DOWNGRADE_DETECTED'
  );
  assert.throws(
    () => client.openSession(sessionInput()),
    (error) => error && error.code === 'PROTOCOL_CLIENT_POISONED'
  );
  assert.strictEqual(calls, 1);
}

// A payload spoof with stale digests poisons the session before another effect.
{
  const operations = [];
  const aborts = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      operations,
      aborts,
      mutate(request, response) {
        if (request.operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_VERIFY) {
          return response;
        }
        return { ...response, payload: { verified: false } };
      },
    }),
    requestIdFactory: idFactory('spoof'),
  });
  const session = client.openSession(sessionInput());
  assert.throws(
    () => session.verify({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_DIGEST_MISMATCH'
  );
  const calls = operations.length;
  assert.throws(
    () => session.moveToQuarantine({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_SESSION_POISONED'
  );
  assert.strictEqual(operations.length, calls);
  assert.strictEqual(aborts.length, 1);
  assert.strictEqual(aborts[0].reasonCode, 'PROTOCOL_SESSION_RESPONSE_INVALID');
}

// A structurally valid response for the wrong sequence is still rejected.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      operations,
      mutate(request, response) {
        if (request.operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_VERIFY) {
          return response;
        }
        const wrongRequest = createAnchoredMutationHelperRequest({
          requestId: request.requestId,
          operation: request.operation,
          sequence: request.sequence + 1,
          sessionId: request.sessionId,
          previousResponseDigest: request.previousResponseDigest,
          payload: request.payload,
        });
        return createAnchoredMutationHelperResponse(wrongRequest, { verified: true });
      },
    }),
    requestIdFactory: idFactory('order'),
  });
  const session = client.openSession(sessionInput());
  assert.throws(
    () => session.verify({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_REPLAY_DETECTED'
  );
}

// Replaying the preceding response for a new operation cannot advance state.
{
  let replay;
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      operations,
      mutate(request, response) {
        if (request.operation === ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_VERIFY) {
          replay = response;
        }
        if (request.operation === ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_MOVE_TO_QUARANTINE) {
          return replay;
        }
        return response;
      },
    }),
    requestIdFactory: idFactory('replay'),
  });
  const session = client.openSession(sessionInput());
  session.verify({ checkpointDigest: digest('b') });
  assert.throws(
    () => session.moveToQuarantine({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_REPLAY_DETECTED'
  );
}

// Async transports are never accepted at the native effect boundary.
{
  let calls = 0;
  const client = createAnchoredMutationHelperProtocolClient({
    transport: Object.freeze({
      async exchange() {
        calls += 1;
        return null;
      },
      abort(message) { return { aborted: true, abortDigest: message.abortDigest }; },
    }),
    requestIdFactory: idFactory('async'),
  });
  assert.throws(
    () => client.handshake(),
    (error) => error && error.code === 'HELPER_TRANSPORT_ASYNC'
  );
  assert.strictEqual(calls, 1);
}

// Rejected native Promises are denied and immediately observed, so strict
// unhandled-rejection mode cannot crash after the synchronous denial.
{
  const client = createAnchoredMutationHelperProtocolClient({
    transport: Object.freeze({
      exchange() { return Promise.reject(new Error('denied async exchange')); },
      abort(message) { return { aborted: true, abortDigest: message.abortDigest }; },
    }),
    requestIdFactory: idFactory('rejected-exchange'),
  });
  assert.throws(
    () => client.handshake(),
    (error) => error && error.code === 'HELPER_TRANSPORT_ASYNC'
  );
}

// Promise detection uses the native intrinsic and never reads an arbitrary
// thenable's attacker-controlled `then` property.
{
  let thenGetterCalls = 0;
  const thenable = {};
  Object.defineProperty(thenable, 'then', {
    enumerable: true,
    get() { thenGetterCalls += 1; return () => {}; },
  });
  const client = createAnchoredMutationHelperProtocolClient({
    transport: Object.freeze({
      exchange() { return thenable; },
      abort(message) { return { aborted: true, abortDigest: message.abortDigest }; },
    }),
    requestIdFactory: idFactory('thenable'),
  });
  assert.throws(() => client.handshake(), /unsupported fields|data property/);
  assert.strictEqual(thenGetterCalls, 0);
}

// Rejected Promise aborts are likewise absorbed; the native bounded lease is
// still the final fallback if that best-effort out-of-band path is async.
{
  const base = createResponder({
    mutate(request, response) {
      if (request.operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_VERIFY) return response;
      return { ...response, payloadDigest: digest('0') };
    },
  });
  const client = createAnchoredMutationHelperProtocolClient({
    transport: Object.freeze({
      exchange: base.exchange,
      abort() { return Promise.reject(new Error('denied async abort')); },
    }),
    requestIdFactory: idFactory('rejected-abort'),
  });
  const session = client.openSession(sessionInput());
  assert.throws(
    () => session.verify({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_DIGEST_MISMATCH'
  );
  assert.throws(
    () => session.close(),
    (error) => error && error.code === 'PROTOCOL_SESSION_POISONED'
  );
}

// Hostile prototypes, accessors, symbols and sparse arrays are rejected without
// invoking attacker-controlled accessors.
{
  const request = createAnchoredMutationHelperRequest({
    requestId: 'hostile-1',
    operation: ANCHORED_MUTATION_HELPER_OPERATIONS.HANDSHAKE,
    sequence: 0,
    sessionId: null,
    previousResponseDigest: null,
    payload: {
      handshakeVersion: ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
      backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
      sessionContractVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
      integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
      requiredGuarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
      requirements: handshakePayload().features,
    },
  });
  const response = createAnchoredMutationHelperResponse(request, handshakePayload());
  assert.throws(() => assertAnchoredMutationHelperRequest(
    Object.assign(Object.create({ polluted: true }), request)
  ), /plain prototype/);
  assert.throws(() => assertAnchoredMutationHelperResponse(
    Object.assign(Object.create({ polluted: true }), response)
  ), /plain prototype/);
  let getterCalls = 0;
  const accessorResponse = { ...response };
  Object.defineProperty(accessorResponse, 'payload', {
    enumerable: true,
    get() { getterCalls += 1; return response.payload; },
  });
  assert.throws(() => assertAnchoredMutationHelperResponse(accessorResponse), /data property/);
  assert.strictEqual(getterCalls, 0);
  const symbolResponse = { ...response, [Symbol('secret')]: true };
  assert.throws(() => assertAnchoredMutationHelperResponse(symbolResponse), /unsupported fields/);

  const sparseGuarantees = [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES];
  delete sparseGuarantees[0];
  assert.throws(() => createAnchoredMutationHelperResponse(request, handshakePayload({
    guarantees: sparseGuarantees,
  })), /dense array/);
}

// Size bounds are enforced before transport invocation.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory: idFactory('limit'),
  });
  const session = client.openSession(sessionInput());
  const before = operations.length;
  const bytes = Buffer.alloc(ANCHORED_MUTATION_HELPER_LIMITS.maxPrivateFileBytes + 1);
  assert.throws(() => session.privateNamespace.writeFile({
    relativePath: 'too-large.bin',
    contentBase64: bytes.toString('base64'),
    contentDigest: bytesDigest(bytes),
    mode: 'create_exclusive',
  }), /bounded canonical base64/);
  assert.strictEqual(operations.length, before);
}

// Cleanup closes only the namespace capability; no later namespace effect is
// emitted, while the anchored session can still close its native handles.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory: idFactory('cleanup'),
  });
  const session = client.openSession(sessionInput());
  session.moveToQuarantine({ checkpointDigest: digest('b') });
  session.restoreFromQuarantine({ checkpointDigest: digest('b') });
  assert.strictEqual(session.privateNamespace.cleanup().cleaned, true);
  const before = operations.length;
  assert.throws(
    () => session.privateNamespace.sync(),
    (error) => error && error.code === 'PROTOCOL_NAMESPACE_CLOSED'
  );
  assert.strictEqual(operations.length, before);
  assert.throws(
    () => session.verify({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_SESSION_DISPOSED'
  );
  assert.throws(
    () => session.privateNamespace.cleanup(),
    (error) => error && error.code === 'PROTOCOL_STATE_INVALID'
  );
  assert.strictEqual(operations.length, before);
  assert.strictEqual(session.close().closed, true);
}

// Purge is valid only from the fully quarantined phase and disposes every
// capability except the final native-handle close.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory: idFactory('purged'),
  });
  const session = client.openSession(sessionInput());
  assert.throws(
    () => session.purgeQuarantine({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_STATE_INVALID'
  );
  session.moveToQuarantine({ checkpointDigest: digest('b') });
  assert.strictEqual(session.purgeQuarantine({ checkpointDigest: digest('b') }).purged, true);
  const before = operations.length;
  for (const effect of [
    () => session.verify({ checkpointDigest: digest('b') }),
    () => session.moveToQuarantine({ checkpointDigest: digest('b') }),
    () => session.restoreFromQuarantine({ checkpointDigest: digest('b') }),
    () => session.purgeQuarantine({ checkpointDigest: digest('b') }),
    () => session.privateNamespace.sync(),
  ]) assert.throws(
    effect,
    /disposed|current session phase|private namespace capability is closed|fully quarantined/
  );
  assert.strictEqual(operations.length, before);
  assert.strictEqual(session.close().closed, true);
}

// A helper cannot claim namespace cleanup without the matching terminal purge.
{
  const operations = [];
  const aborts = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      operations,
      aborts,
      mutate(request, response) {
        if (request.operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_PURGE_QUARANTINE) {
          return response;
        }
        return createAnchoredMutationHelperResponse(request, {
          purged: false,
          namespaceCleaned: true,
        });
      },
    }),
    requestIdFactory: idFactory('split-purge'),
  });
  const session = client.openSession(sessionInput());
  session.moveToQuarantine({ checkpointDigest: digest('b') });
  assert.throws(
    () => session.purgeQuarantine({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_DOWNGRADE_DETECTED'
  );
  assert.strictEqual(aborts.length, 1);
  const before = operations.length;
  assert.throws(
    () => session.verify({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_SESSION_POISONED'
  );
  assert.strictEqual(operations.length, before);
}

// Duplicate request identifiers are stopped before a session-opening effect.
{
  let calls = 0;
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ requestHook: () => { calls += 1; } }),
    requestIdFactory: () => 'duplicate-request',
  });
  client.handshake();
  assert.throws(
    () => client.openSession(sessionInput()),
    (error) => error && error.code === 'PROTOCOL_REPLAY_DETECTED'
  );
  assert.strictEqual(calls, 1);
}

// Cleanup is a terminal-disposition operation, not a general pathname delete.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory: idFactory('early-cleanup'),
  });
  const session = client.openSession(sessionInput());
  const before = operations.length;
  assert.throws(
    () => session.privateNamespace.cleanup(),
    (error) => error && error.code === 'PROTOCOL_STATE_INVALID'
  );
  assert.strictEqual(operations.length, before);
  session.close();
}

// Restoration must be the exact reverse of the authenticated moved prefix.
{
  const aborts = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      aborts,
      mutate(request, response) {
        if (request.operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_RESTORE_FROM_QUARANTINE) {
          return response;
        }
        return createAnchoredMutationHelperResponse(request, {
          restored: ['target-0001', 'target-0002'],
          remainingMoved: [],
          checkpointDigest: digest('b'),
          progressDigest: canonicalSha256Digest({ checkpointDigest: digest('b'), moved: [] }),
        });
      },
    }),
    requestIdFactory: idFactory('reverse'),
  });
  const session = client.openSession(twoTargetSessionInput());
  session.moveToQuarantine({ checkpointDigest: digest('b') });
  assert.throws(
    () => session.restoreFromQuarantine({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_PROGRESS_INVALID'
  );
  assert.strictEqual(aborts.length, 1);
}

// A malformed session.open poisons the whole client. With no trustworthy
// session identifier there is no abort message; the handshake's bounded native
// orphan lease is the cleanup guarantee.
{
  const operations = [];
  const aborts = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      operations,
      aborts,
      mutate(request, response) {
        if (request.operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_OPEN) return response;
        return { ...response, payloadDigest: digest('0') };
      },
    }),
    requestIdFactory: idFactory('bad-open'),
  });
  assert.throws(
    () => client.openSession(sessionInput()),
    (error) => error && error.code === 'PROTOCOL_DIGEST_MISMATCH'
  );
  const before = operations.length;
  assert.throws(
    () => client.openSession(sessionInput()),
    (error) => error && error.code === 'PROTOCOL_CLIENT_POISONED'
  );
  assert.strictEqual(operations.length, before);
  assert.strictEqual(aborts.length, 0);
}

// Reentrant calls from transport code poison the client and trigger exactly one
// out-of-band abort for every validated active session.
{
  const aborts = [];
  let session;
  let reenter = false;
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      aborts,
      requestHook(request) {
        if (reenter && request.operation === ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_VERIFY) {
          session.close();
        }
      },
    }),
    requestIdFactory: idFactory('reentrant'),
  });
  session = client.openSession(sessionInput());
  reenter = true;
  assert.throws(
    () => session.verify({ checkpointDigest: digest('b') }),
    (error) => error && ['PROTOCOL_REENTRANCY', 'PROTOCOL_CLIENT_POISONED'].includes(error.code)
  );
  assert.strictEqual(aborts.length, 1);
  assert.throws(
    () => session.close(),
    (error) => error && error.code === 'PROTOCOL_SESSION_POISONED'
  );
}

// Reentrancy triggered while a Proxy response is being normalized cannot slip
// past the pre-validation poison check or advance the response chain.
{
  const aborts = [];
  let session;
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      aborts,
      mutate(request, response) {
        if (request.operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_VERIFY) {
          return response;
        }
        return new Proxy(response, {
          getPrototypeOf(target) {
            try { session.close(); } catch {}
            return Object.getPrototypeOf(target);
          },
        });
      },
    }),
    requestIdFactory: idFactory('proxy-reentrant'),
  });
  session = client.openSession(sessionInput());
  assert.throws(
    () => session.verify({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_CLIENT_POISONED'
  );
  assert.strictEqual(aborts.length, 1);
  assert.strictEqual(aborts[0].sequence, 1);
  assert.throws(
    () => session.moveToQuarantine({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_SESSION_POISONED'
  );
}

// Active sessions are bounded before another session.open effect is emitted.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory: idFactory('capacity'),
  });
  const sessions = [];
  for (let index = 0; index < ANCHORED_MUTATION_HELPER_LIMITS.maxActiveSessions; index += 1) {
    sessions.push(client.openSession(sessionInput()));
  }
  const before = operations.length;
  assert.throws(
    () => client.openSession(sessionInput()),
    (error) => error && error.code === 'PROTOCOL_CAPACITY_EXCEEDED'
  );
  assert.strictEqual(operations.length, before);
  for (const session of sessions) session.close();
}

// Total session allocation is also bounded even when handles are closed.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory: idFactory('total-capacity'),
  });
  for (let index = 0; index < ANCHORED_MUTATION_HELPER_LIMITS.maxTotalSessions; index += 1) {
    client.openSession(sessionInput()).close();
  }
  const before = operations.length;
  assert.throws(
    () => client.openSession(sessionInput()),
    (error) => error && error.code === 'PROTOCOL_CAPACITY_EXCEEDED'
  );
  assert.strictEqual(operations.length, before);
}

// A main-owned ID factory cannot reenter the client before transport exchange.
{
  const operations = [];
  let client;
  let first = true;
  client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory() {
      if (first) {
        first = false;
        client.handshake();
      }
      return 'unreachable-request';
    },
  });
  assert.throws(
    () => client.handshake(),
    (error) => error && error.code === 'PROTOCOL_REENTRANCY'
  );
  assert.deepStrictEqual(operations, []);
  assert.throws(
    () => client.handshake(),
    (error) => error && error.code === 'PROTOCOL_CLIENT_POISONED'
  );
}

// An accidentally async main-owned ID factory is observed and denied without
// leaving a rejected Promise for strict unhandled-rejection mode.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory() { return Promise.reject(new Error('async request id')); },
  });
  assert.throws(
    () => client.handshake(),
    (error) => error && error.code === 'PROTOCOL_REQUEST_ID_INVALID'
  );
  assert.deepStrictEqual(operations, []);
}

// Helper session/capability identifiers are unique for the client lifetime.
{
  const aborts = [];
  let opens = 0;
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      aborts,
      mutate(request, response) {
        if (request.operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_OPEN) return response;
        opens += 1;
        return opens === 1
          ? response
          : createAnchoredMutationHelperResponse(request, openPayload(1));
      },
    }),
    requestIdFactory: idFactory('session-replay'),
  });
  client.openSession(sessionInput());
  assert.throws(
    () => client.openSession(sessionInput()),
    (error) => error && error.code === 'PROTOCOL_REPLAY_DETECTED'
  );
  assert.strictEqual(aborts.length, 2);
}

console.log('anchored mutation helper protocol tests passed');
