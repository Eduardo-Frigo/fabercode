'use strict';

const assert = require('assert');

const {
  PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
  createPortableIsolationHelperClient,
} = require('../main/services/portable_isolation_helper_client');
const {
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  createPortableIsolationHelperHandshakeRequest,
  createPortableIsolationHelperHandshakeResponse,
  createPortableIsolationHelperRequest,
  createPortableIsolationHelperResponse,
  createPortableIsolationHelperShutdownReceipt,
} = require('../main/capabilities/portable_isolation_helper_protocol');
const {
  createPortableIsolationHelperBundleDescriptor,
  createPortableIsolationHelperLaunchReceipt,
  createPortableIsolationHelperLaunchRequest,
} = require('../main/capabilities/portable_isolation_helper_launcher_contract');
const {
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_FRAME_VERSION,
  assertPortableIsolationHelperPrivateFrame,
  createPortableIsolationHelperPrivateFrame,
} = require('../main/capabilities/portable_isolation_helper_private_transport_contract');
const {
  createPortableIsolationHelperPrivateTransport,
} = require('../main/services/portable_isolation_helper_private_transport');

const digest = (character) => `sha256:${character.repeat(64)}`;
const nonce = (character) => character.repeat(64);

function expectCode(action, code) {
  assert.throws(action, (error) => error && error.code === code);
}

async function expectRejectCode(value, code) {
  await assert.rejects(value, (error) => error && error.code === code);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function launchAuthorityData() {
  const bundle = createPortableIsolationHelperBundleDescriptor({
    bundleId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-build-1',
    bundleIdentityDigest: digest('a'),
    platform: {
      os: 'darwin',
      architecture: 'arm64',
      signatureVerification: 'platform_verified',
      signatureIdentityDigest: digest('b'),
    },
  });
  const launchRequest = createPortableIsolationHelperLaunchRequest({
    requestId: 'portable-launch-1',
    bundle,
  });
  const launchReceipt = createPortableIsolationHelperLaunchReceipt({
    request: launchRequest,
    channelBindingDigest: digest('c'),
  });
  return { bundle, launchRequest, launchReceipt };
}

function handshakeRequest(overrides = {}) {
  return createPortableIsolationHelperHandshakeRequest({
    requestId: 'portable-handshake-1',
    clientId: 'faber-main-runtime',
    clientNonce: nonce('d'),
    expectedBundleIdentityDigest: digest('a'),
    providerVersion: 'portable-execution-isolation-provider.v2',
    attestationVersion: 'portable-execution-isolation-attestation.v2',
    ...overrides,
  });
}

function helperHandshakeResponse(request) {
  return createPortableIsolationHelperHandshakeResponse(request, {
    helperId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-build-1',
    helperNonce: nonce('e'),
    sessionId: 'portable-session-1',
    bundleIdentityDigest: digest('a'),
    executionWorkspaceBackendId: 'portable-private-workspace',
    projectRootAuthorityBackendId: 'portable-project-root-authority',
    processSupervisorBackendId: 'portable-process-supervisor',
    platform: {
      os: 'darwin',
      architecture: 'arm64',
      signatureVerification: 'platform_verified',
    },
  });
}

function responseFor(request) {
  if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
    return helperHandshakeResponse(request);
  }
  if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE) {
    return createPortableIsolationHelperResponse(
      request,
      createPortableIsolationHelperShutdownReceipt({
        activeWorkspaces: 0,
        activeRootLeases: 0,
        activeProcesses: 0,
        orphaned: 0,
      })
    );
  }
  return createPortableIsolationHelperResponse(request, {
    ok: true,
    operation: request.operation,
  });
}

function channelHarness(overrides = {}) {
  const authority = launchAuthorityData();
  const state = {
    frames: [],
    requests: [],
    aborts: [],
    disposeCalls: 0,
  };
  const channel = Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION,
    exchange(frame) {
      state.frames.push(frame);
      if (overrides.exchange) return overrides.exchange(frame, state, authority);
      const request = assertPortableIsolationHelperPrivateFrame(frame, {
        direction: 'request',
        sequence: state.frames.length,
        channelBindingDigest: authority.launchReceipt.channelBindingDigest,
      });
      state.requests.push(request);
      const response = responseFor(request);
      return Promise.resolve(createPortableIsolationHelperPrivateFrame({
        direction: 'response',
        sequence: frame.sequence,
        channelBindingDigest: frame.channelBindingDigest,
        requestPayloadDigest: frame.payloadDigest,
        payload: response,
      }));
    },
    abort(request) {
      state.aborts.push(request);
      if (overrides.abort) return overrides.abort(request, state, authority);
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_RECEIPT_VERSION,
        aborted: true,
        processTreeTerminated: true,
        orphaned: 0,
      }));
    },
    dispose() {
      state.disposeCalls += 1;
      if (overrides.dispose) return overrides.dispose(state, authority);
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION,
        closed: true,
        helperExited: true,
        orphaned: 0,
      }));
    },
  });
  const transport = createPortableIsolationHelperPrivateTransport({
    channel,
    launchRequest: authority.launchRequest,
    launchReceipt: authority.launchReceipt,
  });
  return { ...authority, channel, state, transport };
}

function clientFor(transport) {
  return createPortableIsolationHelperClient({
    transport,
    handshake: {
      clientId: 'faber-main-runtime',
      clientNonce: nonce('d'),
      expectedBundleIdentityDigest: digest('a'),
      providerVersion: 'portable-execution-isolation-provider.v2',
      attestationVersion: 'portable-execution-isolation-attestation.v2',
    },
  });
}

(async () => {
  const authority = launchAuthorityData();
  const rawPayload = Object.freeze({ hello: 'private transport' });
  const requestFrame = createPortableIsolationHelperPrivateFrame({
    direction: 'request',
    sequence: 1,
    channelBindingDigest: authority.launchReceipt.channelBindingDigest,
    payload: rawPayload,
  });
  assert.strictEqual(requestFrame.version, PORTABLE_ISOLATION_HELPER_PRIVATE_FRAME_VERSION);
  assert.strictEqual(requestFrame.direction, 'request');
  assert.strictEqual(requestFrame.requestPayloadDigest, requestFrame.payloadDigest);
  assert.strictEqual(requestFrame.payloadBytes, Buffer.byteLength(JSON.stringify(rawPayload)));
  assert.ok(Object.isFrozen(requestFrame));
  assert.deepStrictEqual(
    assertPortableIsolationHelperPrivateFrame(requestFrame, {
      direction: 'request',
      sequence: 1,
      channelBindingDigest: authority.launchReceipt.channelBindingDigest,
    }),
    rawPayload
  );

  const responseFrame = createPortableIsolationHelperPrivateFrame({
    direction: 'response',
    sequence: 1,
    channelBindingDigest: authority.launchReceipt.channelBindingDigest,
    requestPayloadDigest: requestFrame.payloadDigest,
    payload: { ok: true },
  });
  assert.deepStrictEqual(
    assertPortableIsolationHelperPrivateFrame(responseFrame, {
      direction: 'response',
      sequence: 1,
      channelBindingDigest: authority.launchReceipt.channelBindingDigest,
      requestPayloadDigest: requestFrame.payloadDigest,
    }),
    Object.freeze({ ok: true })
  );

  expectCode(
    () => assertPortableIsolationHelperPrivateFrame(Object.freeze({
      ...responseFrame,
      payloadDigest: digest('f'),
    }), {
      direction: 'response',
      sequence: 1,
      channelBindingDigest: authority.launchReceipt.channelBindingDigest,
      requestPayloadDigest: requestFrame.payloadDigest,
    }),
    'PRIVATE_FRAME_DIGEST_MISMATCH'
  );
  expectCode(
    () => assertPortableIsolationHelperPrivateFrame(Object.freeze({
      ...responseFrame,
      unexpected: true,
    }), {
      direction: 'response',
      sequence: 1,
      channelBindingDigest: authority.launchReceipt.channelBindingDigest,
      requestPayloadDigest: requestFrame.payloadDigest,
    }),
    'PRIVATE_FRAME_INVALID'
  );
  expectCode(
    () => assertPortableIsolationHelperPrivateFrame(responseFrame, {
      direction: 'response',
      sequence: 2,
      channelBindingDigest: authority.launchReceipt.channelBindingDigest,
      requestPayloadDigest: requestFrame.payloadDigest,
    }),
    'PRIVATE_FRAME_CORRELATION_MISMATCH'
  );
  expectCode(
    () => createPortableIsolationHelperPrivateFrame({
      direction: 'request',
      sequence: 1,
      channelBindingDigest: authority.launchReceipt.channelBindingDigest,
      payload: { content: 'x'.repeat(2 * 1024 * 1024) },
    }),
    'PRIVATE_FRAME_LIMIT_EXCEEDED'
  );
  const oversizedBase64 = 'A'.repeat(
    (4 * Math.ceil((2 * 1024 * 1024) / 3)) + 4
  );
  expectCode(
    () => assertPortableIsolationHelperPrivateFrame(Object.freeze({
      ...responseFrame,
      payloadBytes: 1,
      payloadBase64: oversizedBase64,
    }), {
      direction: 'response',
      sequence: 1,
      channelBindingDigest: authority.launchReceipt.channelBindingDigest,
      requestPayloadDigest: requestFrame.payloadDigest,
    }),
    'PRIVATE_FRAME_LIMIT_EXCEEDED'
  );

  const success = channelHarness();
  assert.strictEqual(success.transport.version, PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION);
  assert.deepStrictEqual(
    Object.keys(success.transport).sort(),
    ['abort', 'dispose', 'exchange', 'version']
  );
  assert.ok(Object.isFrozen(success.transport));
  const client = clientFor(success.transport);
  const connected = await client.connect();
  assert.strictEqual(connected.bundleIdentityDigest, digest('a'));
  const operationResult = await client.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    payload: { leaseId: 'root-lease-1', relativePath: '.' },
  });
  assert.deepStrictEqual(operationResult, {
    ok: true,
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
  });
  const clientDispose = await client.dispose();
  assert.strictEqual(clientDispose.helperShutdownConfirmed, true);
  assert.strictEqual(success.state.frames.length, 3);
  assert.deepStrictEqual(success.state.frames.map((frame) => frame.sequence), [1, 2, 3]);
  assert.strictEqual(success.state.aborts.length, 0);
  assert.strictEqual(success.state.disposeCalls, 1);

  const wrongBundle = channelHarness();
  await expectRejectCode(
    wrongBundle.transport.exchange(handshakeRequest({
      expectedBundleIdentityDigest: digest('f'),
    })),
    'PRIVATE_TRANSPORT_BUNDLE_MISMATCH'
  );
  assert.strictEqual(wrongBundle.state.frames.length, 0);
  assert.strictEqual(wrongBundle.state.aborts.length, 1);
  assert.strictEqual(wrongBundle.state.aborts[0].reasonCode, 'BUNDLE_MISMATCH');
  await expectRejectCode(
    wrongBundle.transport.exchange(handshakeRequest()),
    'PRIVATE_TRANSPORT_QUARANTINED'
  );

  const malformed = channelHarness({
    exchange() {
      return Promise.resolve(Object.freeze({ not: 'a-frame' }));
    },
  });
  await expectRejectCode(
    malformed.transport.exchange(handshakeRequest()),
    'PRIVATE_TRANSPORT_FRAME_REJECTED'
  );
  assert.strictEqual(malformed.state.aborts.length, 1);
  assert.strictEqual(malformed.state.aborts[0].reasonCode, 'FRAME_REJECTED');

  const pending = deferred();
  const concurrent = channelHarness({
    exchange(frame) {
      return pending.promise.then(() => {
        const request = assertPortableIsolationHelperPrivateFrame(frame, {
          direction: 'request',
          sequence: 1,
          channelBindingDigest: authority.launchReceipt.channelBindingDigest,
        });
        return createPortableIsolationHelperPrivateFrame({
          direction: 'response',
          sequence: frame.sequence,
          channelBindingDigest: frame.channelBindingDigest,
          requestPayloadDigest: frame.payloadDigest,
          payload: responseFor(request),
        });
      });
    },
  });
  const firstExchange = concurrent.transport.exchange(handshakeRequest());
  await expectRejectCode(
    concurrent.transport.exchange(handshakeRequest()),
    'PRIVATE_TRANSPORT_BUSY'
  );
  assert.strictEqual(concurrent.state.frames.length, 1);
  pending.resolve();
  const firstResponse = await firstExchange;
  assert.strictEqual(firstResponse.operation, PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE);

  const abortHarness = channelHarness();
  const abortReceipt = await abortHarness.transport.abort(Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_REQUEST_VERSION,
    reasonCode: 'TEST_ABORT',
  }));
  assert.deepStrictEqual(abortReceipt, Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION,
    aborted: true,
  }));
  assert.strictEqual(abortHarness.state.aborts.length, 1);
  assert.strictEqual(abortHarness.state.aborts[0].channelBindingDigest, digest('c'));

  const badAbort = channelHarness({
    abort() {
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_RECEIPT_VERSION,
        aborted: true,
        processTreeTerminated: false,
        orphaned: 1,
      }));
    },
  });
  await expectRejectCode(
    badAbort.transport.abort(Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_REQUEST_VERSION,
      reasonCode: 'TEST_ABORT',
    })),
    'PRIVATE_TRANSPORT_ABORT_FAILED'
  );

  const disposeHarness = channelHarness();
  const disposeReceipt = await disposeHarness.transport.dispose();
  assert.deepStrictEqual(disposeReceipt, Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
    closed: true,
  }));
  assert.strictEqual(await disposeHarness.transport.dispose(), disposeReceipt);
  assert.strictEqual(disposeHarness.state.disposeCalls, 1);

  const orphaned = channelHarness({
    dispose() {
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION,
        closed: true,
        helperExited: true,
        orphaned: 1,
      }));
    },
  });
  await expectRejectCode(
    orphaned.transport.dispose(),
    'PRIVATE_TRANSPORT_CLOSE_FAILED'
  );

  const neverSettles = deferred();
  const interrupted = channelHarness({
    exchange() {
      return neverSettles.promise;
    },
  });
  let interruptedOutcome = 'pending';
  let interruptedErrorCode = null;
  interrupted.transport.exchange(handshakeRequest()).then(
    () => {
      interruptedOutcome = 'fulfilled';
    },
    (error) => {
      interruptedOutcome = 'rejected';
      interruptedErrorCode = error && error.code;
    }
  );
  const interruptedDispose = await interrupted.transport.dispose();
  assert.deepStrictEqual(interruptedDispose, Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
    closed: true,
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(
    interruptedOutcome,
    'rejected',
    'disposing the channel must settle an exchange even when the channel never responds'
  );
  assert.strictEqual(interruptedErrorCode, 'PRIVATE_TRANSPORT_CLOSED');
  assert.strictEqual(interrupted.state.aborts.length, 1);
  assert.strictEqual(interrupted.state.disposeCalls, 1);

  const abortNeverSettles = deferred();
  const closeProvesTermination = channelHarness({
    abort() {
      return abortNeverSettles.promise;
    },
  });
  const closeOutcome = await Promise.race([
    closeProvesTermination.transport.dispose(),
    new Promise((resolve) => setImmediate(() => resolve('still-pending'))),
  ]);
  assert.notStrictEqual(
    closeOutcome,
    'still-pending',
    'a zero-orphan helper-exit receipt must close even when abort never settles'
  );
  assert.deepStrictEqual(closeOutcome, Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
    closed: true,
  }));
  assert.strictEqual(closeProvesTermination.state.aborts.length, 1);
  assert.strictEqual(closeProvesTermination.state.disposeCalls, 1);

  const invalidChannel = Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION,
    exchange() {},
    abort() {},
    dispose() {},
    executablePath: '/tmp/injected-helper',
  });
  expectCode(
    () => createPortableIsolationHelperPrivateTransport({
      channel: invalidChannel,
      launchRequest: authority.launchRequest,
      launchReceipt: authority.launchReceipt,
    }),
    'PRIVATE_TRANSPORT_CHANNEL_INVALID'
  );

  const mismatchedAuthority = channelHarness();
  const forgedReceipt = Object.freeze({
    ...mismatchedAuthority.launchReceipt,
    channelBindingDigest: digest('f'),
  });
  expectCode(
    () => createPortableIsolationHelperPrivateTransport({
      channel: mismatchedAuthority.channel,
      launchRequest: mismatchedAuthority.launchRequest,
      launchReceipt: forgedReceipt,
    }),
    'PRIVATE_TRANSPORT_LAUNCH_INVALID'
  );

  let getterTouched = false;
  const accessorOptions = {
    channel: success.channel,
    launchRequest: success.launchRequest,
    launchReceipt: success.launchReceipt,
  };
  Object.defineProperty(accessorOptions, 'channel', {
    enumerable: true,
    get() {
      getterTouched = true;
      return success.channel;
    },
  });
  expectCode(
    () => createPortableIsolationHelperPrivateTransport(accessorOptions),
    'PRIVATE_TRANSPORT_OPTIONS_INVALID'
  );
  assert.strictEqual(getterTouched, false);

  console.log('portable isolation helper private transport tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
