'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');

const {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_ROOT_NAMESPACE_VERSION,
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
const {
  createAnchoredMutationIdentityReceipt,
} = require('../main/capabilities/anchored_mutation_identity_receipt_contract');

const digest = (character) => `sha256:${character.repeat(64)}`;
const bytesDigest = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

function identity(seed) {
  const core = {
    volumeIdentityDigest: bytesDigest(Buffer.from(`${seed}:volume`)),
    objectIdentityDigest: bytesDigest(Buffer.from(`${seed}:object`)),
    generationIdentityDigest: bytesDigest(Buffer.from(`${seed}:generation`)),
  };
  return { ...core, identityDigest: canonicalSha256Digest(core) };
}

const ROOT_IDENTITY = identity('root');
const NAMESPACE_IDENTITY = identity('namespace');

function receiptForInput(input) {
  const identityByPath = new Map(input.checkpointEntries.map((entry) => [
    entry.relativePath,
    identity(`entry:${entry.relativePath}`),
  ]));
  const entries = input.checkpointEntries.map((entry) => ({
    relativePath: entry.relativePath,
    kind: entry.kind,
    identity: identityByPath.get(entry.relativePath),
    closureDigest: entry.kind === 'directory' ? bytesDigest(Buffer.from(`closure:${entry.relativePath}`)) : null,
    linkIdentityDigest: entry.kind === 'symlink'
      ? bytesDigest(Buffer.from(`link:${entry.relativePath}`)) : null,
  }));
  const entryByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
  return createAnchoredMutationIdentityReceipt({
    helperBuildId: 'test-native-helper-build-v1',
    platform: {
      os: 'linux',
      architecture: 'x64',
      filesystemType: 'ext4',
      capabilityDigest: bytesDigest(Buffer.from('test-helper-capability')),
    },
    bindingDigest: input.bindingDigest,
    checkpointDigest: input.checkpointDigest,
    rootIdentity: ROOT_IDENTITY,
    namespaceIdentity: NAMESPACE_IDENTITY,
    targets: input.targets.map((target) => ({
      ...target,
      kind: entryByPath.get(target.relativePath).kind,
      identity: entryByPath.get(target.relativePath).identity,
      closureDigest: entryByPath.get(target.relativePath).closureDigest,
      linkIdentityDigest: entryByPath.get(target.relativePath).linkIdentityDigest,
    })),
    entries,
  });
}

function recreateReceipt(receipt, overrides = {}) {
  return createAnchoredMutationIdentityReceipt({
    helperBuildId: receipt.helperBuildId,
    platform: receipt.platform,
    bindingDigest: receipt.bindingDigest,
    checkpointDigest: receipt.checkpointDigest,
    rootIdentity: receipt.rootIdentity,
    namespaceIdentity: receipt.namespaceIdentity,
    targets: receipt.targets,
    entries: receipt.entries,
    ...overrides,
  });
}

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
      rootNamespaceBootstrap: true,
      rootNamespaceReadOnly: true,
      authenticatedOrphanCleanup: true,
      movementProgressInspection: true,
      identityContinuity: true,
      physicalIdentityReceipts: true,
      durablePhysicalProgress: true,
      sourceIdentityCompareAndSwap: true,
      subtreeMutationExcluded: true,
      atomicReplace: true,
      durableNamespaceSync: true,
      boundedListingOverflow: 'fail_closed',
      outOfBandAbort: true,
      orphanedSessionAutoClose: 'bounded_native_lease',
      maxOrphanLeaseMs: 5_000,
    },
    ...overrides,
  };
}

function openPayload(request, serial = 1, moved = []) {
  const identityReceipt = receiptForInput(request.payload);
  const progressCore = { checkpointDigest: request.payload.checkpointDigest, moved: [] };
  progressCore.moved = [...moved];
  return {
    opened: true,
    sessionId: `native-session-${serial}`,
    namespaceCapabilityId: `namespace-capability-${serial}`,
    rootIdentityDigest: identityReceipt.rootIdentity.identityDigest,
    namespaceIdentityDigest: identityReceipt.namespaceIdentity.identityDigest,
    targetSetIdentityDigest: identityReceipt.targetSetIdentityDigest,
    identityReceipt,
    namespaceReadyBeforeWrites: true,
    movementProgress: {
      ...progressCore,
      progressDigest: canonicalSha256Digest(progressCore),
    },
  };
}

function rootOpenPayload(serial = 1) {
  return {
    opened: true,
    sessionId: `native-root-session-${serial}`,
    namespaceCapabilityId: `root-namespace-capability-${serial}`,
    rootIdentityDigest: ROOT_IDENTITY.identityDigest,
    namespaceIdentityDigest: NAMESPACE_IDENTITY.identityDigest,
  };
}

function promotedPayload(request, serial = 1, moved = []) {
  const identityReceipt = request.payload.expectedIdentityReceipt;
  const progressCore = { checkpointDigest: request.payload.checkpointDigest, moved: [...moved] };
  return {
    opened: true,
    sessionId: request.sessionId,
    namespaceCapabilityId: `promoted-namespace-capability-${serial}`,
    rootIdentityDigest: identityReceipt.rootIdentity.identityDigest,
    namespaceIdentityDigest: identityReceipt.namespaceIdentity.identityDigest,
    targetSetIdentityDigest: identityReceipt.targetSetIdentityDigest,
    identityReceipt,
    rootNamespaceClosed: true,
    movementProgress: {
      ...progressCore,
      progressDigest: canonicalSha256Digest(progressCore),
    },
  };
}

function replaceResponsePayload(response, payload) {
  const core = {
    schemaVersion: response.schemaVersion,
    kind: response.kind,
    requestId: response.requestId,
    operation: response.operation,
    sequence: response.sequence,
    sessionId: response.sessionId,
    requestDigest: response.requestDigest,
    previousResponseDigest: response.previousResponseDigest,
    payload,
    payloadDigest: canonicalSha256Digest(payload),
  };
  return { ...core, responseDigest: canonicalSha256Digest(core) };
}

function createResponder({
  mutate,
  operations = [],
  requestHook,
  aborts = [],
  initialFiles = [],
} = {}) {
  const storedFiles = new Map(initialFiles);
  let openSerial = 0;
  let rootSerial = 0;
  let targetNames = [];
  let movedNames = [];
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
        case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN:
          rootSerial += 1;
          payload = rootOpenPayload(rootSerial);
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_READ_FILE: {
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
        case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_LIST:
          payload = { entries: [...storedFiles.keys()] };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_CLEANUP_AUTHENTICATED_ORPHAN:
          payload = { cleaned: true };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN_EXISTING_SESSION:
          openSerial += 1;
          targetNames = request.payload.targets.map((target) => target.payloadName);
          movedNames = [];
          payload = promotedPayload(request, openSerial);
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_CLOSE:
          payload = { closed: true };
          break;
        case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_OPEN:
          assert.strictEqual(request.payload.namespacePolicy.io, 'session_mediated');
          assert.strictEqual(request.payload.namespacePolicy.pathnameHintsAreAuthority, false);
          openSerial += 1;
          targetNames = request.payload.targets.map((target) => target.payloadName);
          movedNames = [];
          payload = openPayload(request, openSerial);
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
        case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_INSPECT_PROGRESS: {
          const progressCore = { checkpointDigest: digest('b'), moved: [...movedNames] };
          payload = { ...progressCore, progressDigest: canonicalSha256Digest(progressCore) };
          break;
        }
        case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_MOVE_TO_QUARANTINE:
          movedNames = [...targetNames];
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
          movedNames = [];
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
  assert.strictEqual(
    session.identityReceipt.rootIdentity.identityDigest,
    session.rootIdentityDigest
  );
  assert.strictEqual(
    session.identityReceipt.namespaceIdentity.identityDigest,
    session.namespaceIdentityDigest
  );
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

// A structurally valid physical receipt for another binding is rejected after
// open and the abort targets the exact returned native session/capability.
{
  const aborts = [];
  let returnedOpen;
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      aborts,
      mutate(request, response) {
        if (request.operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_OPEN) {
          return response;
        }
        const identityReceipt = recreateReceipt(response.payload.identityReceipt, {
          bindingDigest: digest('9'),
        });
        returnedOpen = createAnchoredMutationHelperResponse(request, {
          ...response.payload,
          identityReceipt,
        });
        return returnedOpen;
      },
    }),
    requestIdFactory: idFactory('wrong-receipt-binding'),
  });
  assert.throws(
    () => client.openSession(sessionInput()),
    (error) => error && error.code === 'PROTOCOL_IDENTITY_MISMATCH'
  );
  assert.strictEqual(aborts.length, 1);
  assert.strictEqual(aborts[0].sessionId, returnedOpen.payload.sessionId);
  assert.strictEqual(
    aborts[0].namespaceCapabilityId,
    returnedOpen.payload.namespaceCapabilityId
  );
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

{
  const transport = createResponder({
    mutate(request, response) {
      if (request.operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.HANDSHAKE) return response;
      return replaceResponsePayload(response, {
        ...response.payload,
        features: { ...response.payload.features, atomicReplace: false },
      });
    },
  });
  const client = createAnchoredMutationHelperProtocolClient({
    transport,
    requestIdFactory: idFactory('atomic-downgrade'),
  });
  assert.throws(
    () => client.handshake(),
    (error) => error && error.code === 'PROTOCOL_DOWNGRADE_DETECTED'
  );
}

// Recovery discovers metadata through a read-only pinned root and atomically
// promotes that exact identity into a mutable transaction session.
{
  const operations = [];
  const metadata = Buffer.from('{"state":"COMMITTED"}', 'utf8').toString('base64');
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      operations,
      initialFiles: [['transactions/transaction-1/journal.json', metadata]],
    }),
    requestIdFactory: idFactory('root-bootstrap'),
  });
  const root = client.openRootNamespace({ rootPath: '/project' });
  assert.strictEqual(root.schemaVersion, ANCHORED_FILESYSTEM_MUTATION_ROOT_NAMESPACE_VERSION);
  assert.strictEqual(
    root.privateNamespace.capabilityVersion,
    ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION
  );
  assert.deepStrictEqual(root.privateNamespace.readFile({
    relativePath: 'transactions/transaction-1/journal.json',
    maxBytes: 1024,
  }), {
    found: true,
    contentBase64: metadata,
    contentDigest: bytesDigest(Buffer.from(metadata, 'base64')),
  });
  assert.deepStrictEqual(root.privateNamespace.list({
    relativePath: 'transactions',
    maxEntries: 10,
  }).entries, ['transactions/transaction-1/journal.json']);
  assert.strictEqual(root.cleanupAuthenticatedOrphan({
    transactionId: 'orphan-1',
    bindingDigest: digest('1'),
    manifestDigest: digest('2'),
    journalDigest: digest('3'),
    headContentDigest: digest('4'),
    anchorChainDigest: digest('5'),
  }).cleaned, true);
  const existing = sessionInput();
  delete existing.rootPath;
  existing.manifestDigest = digest('6');
  existing.journalDigest = digest('7');
  existing.identityReceipt = receiptForInput(existing);
  const session = root.openExistingSession(existing);
  assert.strictEqual(session.identityReceipt.receiptDigest, existing.identityReceipt.receiptDigest);
  assert.strictEqual(session.schemaVersion, ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION);
  assert.deepStrictEqual(session.inspectProgress().moved, []);
  session.moveToQuarantine({ checkpointDigest: digest('b') });
  assert.deepStrictEqual(session.inspectProgress().moved, ['target-0001']);
  assert.throws(
    () => root.close(),
    (error) => error && error.code === 'PROTOCOL_ROOT_NAMESPACE_PROMOTED'
  );
  assert.strictEqual(session.purgeQuarantine({ checkpointDigest: digest('b') }).purged, true);
  assert.strictEqual(session.close().closed, true);
  assert.deepStrictEqual(operations, [
    'handshake',
    'root_namespace.open',
    'root_namespace.read_file',
    'root_namespace.list',
    'root_namespace.cleanup_authenticated_orphan',
    'root_namespace.open_existing_session',
    'session.inspect_progress',
    'session.move_to_quarantine',
    'session.inspect_progress',
    'session.purge_quarantine',
    'session.close',
  ]);
}

// Promotion must continue the exact authenticated receipt, not merely reuse
// its root/namespace/target digests with a different helper-build claim.
{
  const aborts = [];
  let returnedPromotion;
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      aborts,
      mutate(request, response) {
        if (request.operation
          !== ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN_EXISTING_SESSION) {
          return response;
        }
        const identityReceipt = recreateReceipt(response.payload.identityReceipt, {
          helperBuildId: 'different-helper-build-v1',
        });
        returnedPromotion = createAnchoredMutationHelperResponse(request, {
          ...response.payload,
          identityReceipt,
        });
        return returnedPromotion;
      },
    }),
    requestIdFactory: idFactory('receipt-continuity'),
  });
  const root = client.openRootNamespace({ rootPath: '/project' });
  const existing = sessionInput();
  delete existing.rootPath;
  existing.manifestDigest = digest('6');
  existing.journalDigest = digest('7');
  existing.identityReceipt = receiptForInput(existing);
  assert.throws(
    () => root.openExistingSession(existing),
    (error) => error && error.code === 'PROTOCOL_IDENTITY_MISMATCH'
  );
  assert.strictEqual(aborts.length, 1);
  assert.strictEqual(aborts[0].sessionId, returnedPromotion.payload.sessionId);
  assert.strictEqual(
    aborts[0].namespaceCapabilityId,
    returnedPromotion.payload.namespaceCapabilityId
  );
}

// Promotion cannot switch the pinned physical root or private namespace. The
// mismatch poisons the client and emits one best-effort abort for the promoted
// native capability.
{
  const aborts = [];
  let returnedMismatch;
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      aborts,
      mutate(request, response) {
        if (request.operation
          !== ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN_EXISTING_SESSION) {
          return response;
        }
        returnedMismatch = replaceResponsePayload(response, {
          ...response.payload,
          rootIdentityDigest: digest('0'),
        });
        return returnedMismatch;
      },
    }),
    requestIdFactory: idFactory('identity-switch'),
  });
  const root = client.openRootNamespace({ rootPath: '/project' });
  const existing = sessionInput();
  delete existing.rootPath;
  existing.manifestDigest = digest('6');
  existing.journalDigest = digest('7');
  existing.identityReceipt = receiptForInput(existing);
  assert.throws(
    () => root.openExistingSession(existing),
    (error) => error && error.code === 'PROTOCOL_IDENTITY_MISMATCH'
  );
  assert.strictEqual(aborts.length, 1);
  assert.strictEqual(aborts[0].reasonCode, 'PROTOCOL_IDENTITY_MISMATCH');
  assert.throws(
    () => assertAnchoredMutationHelperResponse(returnedMismatch),
    (error) => error && error.code === 'PROTOCOL_IDENTITY_MISMATCH'
  );
}

// A discovery-only root handle closes without creating or promoting a delete
// session and then rejects every subsequent namespace effect locally.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory: idFactory('root-close'),
  });
  const root = client.openRootNamespace({ rootPath: '/project' });
  assert.strictEqual(root.close().closed, true);
  const before = operations.length;
  assert.throws(() => root.privateNamespace.list({
    relativePath: '',
    maxEntries: 1,
  }), /closed/);
  assert.strictEqual(operations.length, before);
}

// Every continuity fact is fail-closed. If promotion returns another session
// or namespace identity, the abort targets exactly the returned capability,
// including the next sequence after all preceding bootstrap reads.
for (const continuityCase of [
  {
    name: 'session-id',
    override: { sessionId: 'switched-native-session' },
    code: 'PROTOCOL_IDENTITY_MISMATCH',
  },
  {
    name: 'namespace-identity',
    override: { namespaceIdentityDigest: digest('9') },
    code: 'PROTOCOL_IDENTITY_MISMATCH',
  },
]) {
  const aborts = [];
  let returnedPromotion;
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      aborts,
      mutate(request, response) {
        if (request.operation
          !== ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN_EXISTING_SESSION) {
          return response;
        }
        returnedPromotion = replaceResponsePayload(response, {
          ...response.payload,
          ...continuityCase.override,
        });
        return returnedPromotion;
      },
    }),
    requestIdFactory: idFactory(`continuity-${continuityCase.name}`),
  });
  const root = client.openRootNamespace({ rootPath: '/project' });
  root.privateNamespace.list({ relativePath: '', maxEntries: 1 });
  const existing = sessionInput();
  delete existing.rootPath;
  existing.manifestDigest = digest('6');
  existing.journalDigest = digest('7');
  existing.identityReceipt = receiptForInput(existing);
  assert.throws(
    () => root.openExistingSession(existing),
    (error) => error && error.code === continuityCase.code
  );
  assert.strictEqual(aborts.length, 1);
  assert.strictEqual(aborts[0].sessionId, returnedPromotion.payload.sessionId);
  assert.strictEqual(
    aborts[0].namespaceCapabilityId,
    returnedPromotion.payload.namespaceCapabilityId
  );
  assert.strictEqual(aborts[0].sequence, 3);
  assert.strictEqual(aborts[0].lastResponseDigest, returnedPromotion.responseDigest);
}

// A helper that did not atomically consume the root is rejected and the still
// authoritative root capability—not the uncommitted promoted claim—is aborted.
{
  const aborts = [];
  let rootSessionId;
  let rootCapabilityId;
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      aborts,
      mutate(request, response) {
        if (request.operation === ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN) {
          rootSessionId = response.payload.sessionId;
          rootCapabilityId = response.payload.namespaceCapabilityId;
        }
        if (request.operation
          !== ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN_EXISTING_SESSION) {
          return response;
        }
        return replaceResponsePayload(response, {
          ...response.payload,
          rootNamespaceClosed: false,
        });
      },
    }),
    requestIdFactory: idFactory('root-not-closed'),
  });
  const root = client.openRootNamespace({ rootPath: '/project' });
  const existing = sessionInput();
  delete existing.rootPath;
  existing.manifestDigest = digest('6');
  existing.journalDigest = digest('7');
  existing.identityReceipt = receiptForInput(existing);
  assert.throws(
    () => root.openExistingSession(existing),
    (error) => error && error.code === 'PROTOCOL_DOWNGRADE_DETECTED'
  );
  assert.strictEqual(aborts.length, 1);
  assert.strictEqual(aborts[0].sessionId, rootSessionId);
  assert.strictEqual(aborts[0].namespaceCapabilityId, rootCapabilityId);
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

// Promise-valued public inputs are absorbed and rejected before the first
// native effect. This includes nested fields, not only a top-level Promise.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory: idFactory('async-public-open'),
  });
  assert.throws(
    () => client.openSession(Promise.reject(new Error('async session input'))),
    (error) => error && error.code === 'PROTOCOL_ASYNC_INPUT'
  );
  assert.throws(
    () => client.openRootNamespace({
      rootPath: Promise.reject(new Error('async root path')),
    }),
    (error) => error && error.code === 'PROTOCOL_ASYNC_INPUT'
  );
  assert.deepStrictEqual(operations, []);
}

// Promise preflight must observe the entire rejected input graph before shape
// validation fails. Unknown fields and Promise-valued siblings must not leave
// a later unhandled rejection under Node's strict policy.
{
  const protocolPath = require.resolve(
    '../main/capabilities/anchored_mutation_helper_protocol'
  );
  const script = `
    const {
      createAnchoredMutationHelperProtocolClient,
    } = require(${JSON.stringify(protocolPath)});
    const transport = Object.freeze({
      exchange() { throw new Error('transport must not be reached'); },
      abort() { throw new Error('abort must not be reached'); },
    });
    const client = createAnchoredMutationHelperProtocolClient({ transport });
    try {
      client.openRootNamespace({
        rootPath: '/project',
        unknown: Promise.reject(new Error('unknown rejected Promise')),
      });
    } catch (error) {
      if (!error || error.code !== 'PROTOCOL_ASYNC_INPUT') process.exit(11);
    }
    try {
      client.openSession({
        rootPath: Promise.reject(new Error('first rejected Promise')),
        transactionPath: Promise.reject(new Error('second rejected Promise')),
      });
    } catch (error) {
      if (!error || error.code !== 'PROTOCOL_ASYNC_INPUT') process.exit(12);
    }
    setImmediate(() => process.stdout.write('strict protocol preflight survived'));
  `;
  const child = childProcess.spawnSync(process.execPath, [
    '--unhandled-rejections=strict',
    '-e',
    script,
  ], { encoding: 'utf8' });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  assert.match(child.stdout, /strict protocol preflight survived/);
}

// Every effect-bearing session and namespace entry point rejects a Promise
// locally, without consuming a sequence number or contacting the helper.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory: idFactory('async-session-effects'),
  });
  const session = client.openSession(sessionInput());
  const before = operations.length;
  const effects = [
    () => session.verify(Promise.reject(new Error('async verify'))),
    () => session.moveToQuarantine(Promise.reject(new Error('async move'))),
    () => session.restoreFromQuarantine(Promise.reject(new Error('async restore'))),
    () => session.purgeQuarantine(Promise.reject(new Error('async purge'))),
    () => session.privateNamespace.writeFile(Promise.reject(new Error('async write'))),
    () => session.privateNamespace.readFile(Promise.reject(new Error('async read'))),
    () => session.privateNamespace.list(Promise.reject(new Error('async list'))),
    () => session.privateNamespace.remove(Promise.reject(new Error('async remove'))),
  ];
  for (const effect of effects) {
    assert.throws(effect, (error) => error && error.code === 'PROTOCOL_ASYNC_INPUT');
  }
  assert.strictEqual(operations.length, before);
  session.close();
}

// Root bootstrap methods apply the same no-async-input rule after the root is
// pinned and before any read, listing, cleanup or promotion message is sent.
{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory: idFactory('async-root-effects'),
  });
  const root = client.openRootNamespace({ rootPath: '/project' });
  const before = operations.length;
  const effects = [
    () => root.privateNamespace.readFile(Promise.reject(new Error('async root read'))),
    () => root.privateNamespace.list(Promise.reject(new Error('async root list'))),
    () => root.cleanupAuthenticatedOrphan(Promise.reject(new Error('async orphan cleanup'))),
    () => root.openExistingSession(Promise.reject(new Error('async promotion'))),
  ];
  for (const effect of effects) {
    assert.throws(effect, (error) => error && error.code === 'PROTOCOL_ASYNC_INPUT');
  }
  assert.strictEqual(operations.length, before);
  root.close();
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

// Rejected Promises thrown as exception values are also observed. Native
// boundaries do not get to evade absorption by throwing instead of returning.
{
  const client = createAnchoredMutationHelperProtocolClient({
    transport: Object.freeze({
      exchange() { throw Promise.reject(new Error('thrown rejected exchange')); },
      abort(message) { return { aborted: true, abortDigest: message.abortDigest }; },
    }),
    requestIdFactory: idFactory('thrown-rejected-exchange'),
  });
  assert.throws(
    () => client.handshake(),
    (error) => error && error.code === 'HELPER_TRANSPORT_FAILED'
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
      abort() { throw Promise.reject(new Error('thrown rejected abort')); },
    }),
    requestIdFactory: idFactory('thrown-rejected-abort'),
  });
  const session = client.openSession(sessionInput());
  assert.throws(
    () => session.verify({ checkpointDigest: digest('b') }),
    (error) => error && error.code === 'PROTOCOL_DIGEST_MISMATCH'
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

// The full 2 MiB metadata frontier fits inside the 3 MiB message envelope.
{
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder(),
    requestIdFactory: idFactory('metadata-boundary'),
  });
  const session = client.openSession(sessionInput());
  const bytes = Buffer.alloc(ANCHORED_MUTATION_HELPER_LIMITS.maxPrivateFileBytes, 0x61);
  assert.strictEqual(session.privateNamespace.writeFile({
    relativePath: 'transactions/transaction-1/maximum-metadata.json',
    contentBase64: bytes.toString('base64'),
    contentDigest: bytesDigest(bytes),
    mode: 'replace_atomic',
  }).written, true);
  session.close();
}

// A helper may respect the global bound while violating the tighter bound of
// one request; the client detects that overflow and poisons before another I/O.
{
  const aborts = [];
  const bytes = Buffer.from('ab', 'utf8');
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      aborts,
      initialFiles: [['transactions/tiny.json', bytes.toString('base64')]],
    }),
    requestIdFactory: idFactory('requested-bound'),
  });
  const root = client.openRootNamespace({ rootPath: '/project' });
  assert.throws(
    () => root.privateNamespace.readFile({
      relativePath: 'transactions/tiny.json',
      maxBytes: 1,
    }),
    (error) => error && error.code === 'PROTOCOL_LIMIT_EXCEEDED'
  );
  assert.strictEqual(aborts.length, 1);
  assert.throws(
    () => root.close(),
    (error) => error && error.code === 'PROTOCOL_SESSION_POISONED'
  );
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

// Inspection cannot silently move a forward-only quarantine prefix backward.
// Only the authenticated restore operation may establish the restored phase.
{
  const aborts = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({
      aborts,
      mutate(request, response) {
        if (request.operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_INSPECT_PROGRESS) {
          return response;
        }
        const progressCore = { checkpointDigest: digest('b'), moved: [] };
        return createAnchoredMutationHelperResponse(request, {
          ...progressCore,
          progressDigest: canonicalSha256Digest(progressCore),
        });
      },
    }),
    requestIdFactory: idFactory('inspect-regression'),
  });
  const session = client.openSession(sessionInput());
  session.moveToQuarantine({ checkpointDigest: digest('b') });
  assert.throws(
    () => session.inspectProgress(),
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

// Production-scale capacities are explicit protocol invariants. Exhausting the
// 65k lifetime budget in a unit test would obscure the semantic checks above.
{
  assert.strictEqual(ANCHORED_MUTATION_HELPER_LIMITS.maxPrivateFileBytes, 2 * 1024 * 1024);
  assert.strictEqual(ANCHORED_MUTATION_HELPER_LIMITS.maxMessageBytes, 3 * 1024 * 1024);
  assert.strictEqual(ANCHORED_MUTATION_HELPER_LIMITS.maxNamespaceEntries, 512);
  assert.strictEqual(ANCHORED_MUTATION_HELPER_LIMITS.maxActiveSessions, 256);
  assert.strictEqual(ANCHORED_MUTATION_HELPER_LIMITS.maxTotalSessions, 65_536);
  assert.strictEqual(ANCHORED_MUTATION_HELPER_LIMITS.maxRequestsPerClient, 262_144);
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

{
  const operations = [];
  const client = createAnchoredMutationHelperProtocolClient({
    transport: createResponder({ operations }),
    requestIdFactory() { throw Promise.reject(new Error('thrown async request id')); },
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
          : createAnchoredMutationHelperResponse(request, openPayload(request, 1));
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
