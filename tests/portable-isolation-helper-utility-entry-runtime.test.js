'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const capabilityDelegation = require(
  '../main/capabilities/capability_delegation_contracts'
);
const helperProtocol = require(
  '../main/capabilities/portable_isolation_helper_protocol'
);
const privateTransport = require(
  '../main/capabilities/portable_isolation_helper_private_transport_contract'
);

const ENTRY_PATH = path.join(
  __dirname,
  '../main/portable_isolation_helper/utility_entry.js'
);
const ENTRY_SOURCE = fs.readFileSync(ENTRY_PATH, 'utf8');
const WIRE_VERSION = 'portable-isolation-helper-utility-wire.v1';
const digest = (character) => `sha256:${character.repeat(64)}`;

function structuredCloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function binding() {
  return {
    helperId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-runtime-1',
    bundleIdentityDigest: digest('b'),
    platform: {
      os: process.platform,
      architecture: process.arch,
      signatureVerification: 'platform_verified',
    },
  };
}

function zeroAuthorityReceipt() {
  return Object.freeze({
    ok: true,
    disposed: true,
    activeWorkspaces: 0,
    activeRootLeases: 0,
    activeProcesses: 0,
    orphaned: 0,
  });
}

function createHarness() {
  const state = {
    messages: [],
    exits: [],
    activations: 0,
    accepts: [],
    quarantines: [],
    disposals: [],
    runtimeBinding: null,
  };
  let messageListener = null;
  const parentPort = Object.freeze({
    on(eventName, listener) {
      assert.strictEqual(eventName, 'message');
      assert.strictEqual(typeof listener, 'function');
      messageListener = listener;
    },
    postMessage(message) {
      state.messages.push(message);
    },
  });
  const fakeProcess = {
    parentPort,
    exitCode: null,
    exit(code) {
      state.exits.push(code);
    },
  };
  const runtime = Object.freeze({
    activate() {
      state.activations += 1;
      return Promise.resolve(Object.freeze({ active: true }));
    },
    accept(payload) {
      state.accepts.push(payload);
      return Promise.resolve(Object.freeze({
        version: 'test-helper-response.v1',
        accepted: true,
      }));
    },
    quarantine(input) {
      state.quarantines.push(input);
      return Promise.resolve(zeroAuthorityReceipt());
    },
    dispose(input) {
      state.disposals.push(input);
      return Promise.resolve(zeroAuthorityReceipt());
    },
  });
  function localRequire(request) {
    if (request === '../capabilities/capability_delegation_contracts') {
      return Object.freeze({
        ...capabilityDelegation,
        immutableSnapshot(value) {
          return capabilityDelegation.immutableSnapshot(structuredCloneData(value));
        },
      });
    }
    if (request === '../capabilities/portable_isolation_helper_protocol') {
      return helperProtocol;
    }
    if (request
      === '../capabilities/portable_isolation_helper_private_transport_contract') {
      return Object.freeze({
        ...privateTransport,
        assertPortableIsolationHelperPrivateFrame(value, expected) {
          return privateTransport.assertPortableIsolationHelperPrivateFrame(
            value,
            structuredCloneData(expected)
          );
        },
        createPortableIsolationHelperPrivateFrame(value) {
          return privateTransport.createPortableIsolationHelperPrivateFrame(
            structuredCloneData(value)
          );
        },
      });
    }
    if (request === '../services/portable_isolation_helper_physical_runtime') {
      return Object.freeze({
        createPortableIsolationHelperPhysicalRuntime(options) {
          state.runtimeBinding = options.runtimeBinding;
          return runtime;
        },
      });
    }
    throw new Error(`unexpected utility entry import: ${request}`);
  }
  vm.runInNewContext(ENTRY_SOURCE, {
    Buffer,
    Error,
    Map,
    Object,
    Promise,
    Reflect,
    Set,
    module: { exports: {} },
    exports: {},
    process: fakeProcess,
    require: localRequire,
    setImmediate,
  }, { filename: ENTRY_PATH });
  assert.strictEqual(typeof messageListener, 'function');
  return Object.freeze({
    state,
    emit(message) {
      messageListener({ data: structuredCloneData(message) });
    },
  });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('utility runtime event did not settle');
}

function bindMessage() {
  return {
    version: WIRE_VERSION,
    kind: 'bind',
    channelBindingDigest: digest('a'),
    runtimeBinding: binding(),
  };
}

(async () => {
  const live = createHarness();
  live.emit(bindMessage());
  await waitFor(() => live.state.messages.length === 1);
  assert.strictEqual(live.state.messages[0].kind, 'bound');
  assert.strictEqual(live.state.activations, 1);
  assert.deepStrictEqual(structuredCloneData(live.state.messages[0]), {
    version: WIRE_VERSION,
    kind: 'bound',
    channelBindingDigest: digest('a'),
    helperRuntimeVersion: 'portable-isolation-helper-runtime.v1',
  });
  assert.deepStrictEqual(live.state.runtimeBinding, binding());
  assert.ok(Object.isFrozen(live.state.runtimeBinding));
  assert.ok(Object.isFrozen(live.state.runtimeBinding.platform));

  const requestFrame = privateTransport.createPortableIsolationHelperPrivateFrame({
    direction: 'request',
    sequence: 1,
    channelBindingDigest: digest('a'),
    payload: { version: 'test-helper-request.v1' },
  });
  live.emit({
    version: WIRE_VERSION,
    kind: 'exchange',
    channelBindingDigest: digest('a'),
    frame: requestFrame,
  });
  await waitFor(() => live.state.messages.length === 2);
  assert.strictEqual(live.state.messages[1].kind, 'response');
  const responsePayload = privateTransport.assertPortableIsolationHelperPrivateFrame(
    live.state.messages[1].frame,
    {
      direction: 'response',
      sequence: 1,
      channelBindingDigest: digest('a'),
      requestPayloadDigest: requestFrame.payloadDigest,
    }
  );
  assert.deepStrictEqual(responsePayload, {
    version: 'test-helper-response.v1',
    accepted: true,
  });
  assert.deepStrictEqual(live.state.accepts, [{ version: 'test-helper-request.v1' }]);

  live.emit({
    version: WIRE_VERSION,
    kind: 'abort',
    channelBindingDigest: digest('a'),
    reasonCode: 'TEST_ABORT',
  });
  await waitFor(() => live.state.messages.length === 3);
  assert.deepStrictEqual(
    structuredCloneData(live.state.quarantines),
    [{ reasonCode: 'TEST_ABORT' }]
  );
  assert.deepStrictEqual(structuredCloneData(live.state.messages[2]), {
    version: WIRE_VERSION,
    kind: 'abort_receipt',
    channelBindingDigest: digest('a'),
    processTreeTerminated: true,
    orphaned: 0,
  });

  live.emit({
    version: WIRE_VERSION,
    kind: 'dispose',
    channelBindingDigest: digest('a'),
  });
  await waitFor(() => live.state.exits.length === 1);
  assert.strictEqual(live.state.messages[3].kind, 'dispose_ready');
  assert.strictEqual(live.state.messages[3].orphaned, 0);
  assert.deepStrictEqual(live.state.disposals, []);
  assert.deepStrictEqual(live.state.exits, [0]);

  const malformed = createHarness();
  malformed.emit(bindMessage());
  await waitFor(() => malformed.state.messages.length === 1);
  malformed.emit({
    version: WIRE_VERSION,
    kind: 'exchange',
    channelBindingDigest: digest('a'),
    frame: { version: 'forged-frame' },
  });
  await waitFor(() => malformed.state.exits.length === 1);
  assert.deepStrictEqual(structuredCloneData(malformed.state.quarantines), [
    { reasonCode: 'WIRE_FRAME_REJECTED' },
  ]);
  assert.strictEqual(malformed.state.messages[1].kind, 'fault');
  assert.strictEqual(malformed.state.messages[1].reasonCode, 'WIRE_FRAME_REJECTED');
  assert.deepStrictEqual(malformed.state.exits, [1]);

  assert.match(ENTRY_SOURCE, /createPortableIsolationHelperPhysicalRuntime/);
  assert.match(ENTRY_SOURCE, /assertPortableIsolationHelperPrivateFrame/);
  assert.match(ENTRY_SOURCE, /createPortableIsolationHelperPrivateFrame/);
  assert.doesNotMatch(ENTRY_SOURCE, /HELPER_RUNTIME_UNAVAILABLE|bootstrap\.v1/);
  assert.doesNotMatch(
    ENTRY_SOURCE,
    /portable_isolation_helper_(?:execution_workspace|project_root_authority|process_supervisor)_backend|require\(['"](?:electron|child_process|fs|net|tls|http|https|worker_threads|module)['"]\)|process\.env|\bimport\s*\(/
  );
  console.log('portable isolation helper utility entry runtime tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
