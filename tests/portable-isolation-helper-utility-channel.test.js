'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');

const {
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION,
  createPortableIsolationHelperPrivateFrame,
} = require('../main/capabilities/portable_isolation_helper_private_transport_contract');
const {
  PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
  PortableIsolationHelperUtilityChannelError,
  openPortableIsolationHelperUtilityChannel,
} = require('../main/services/portable_isolation_helper_utility_channel');

const digest = (character) => `sha256:${character.repeat(64)}`;

function runtimeBinding() {
  return Object.freeze({
    helperId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-runtime-1',
    bundleIdentityDigest: digest('b'),
    platform: Object.freeze({
      os: 'darwin',
      architecture: 'arm64',
      signatureVerification: 'platform_verified',
    }),
  });
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

async function expectRejectCode(value, code) {
  await assert.rejects(
    value,
    (error) => error instanceof PortableIsolationHelperUtilityChannelError
      && error.code === code
      && !error.message.includes('/tmp')
  );
}

class FakeUtilityProcess extends EventEmitter {
  constructor(overrides = {}) {
    super();
    this.overrides = overrides;
    this.state = {
      killed: 0,
      messages: [],
      binding: null,
    };
    if (!overrides.neverSpawns) {
      setImmediate(() => this.emit('spawn'));
    }
  }

  postMessage(message) {
    this.state.messages.push(message);
    if (this.overrides.postMessage) {
      this.overrides.postMessage(message, this);
      return;
    }
    if (message.kind === 'bind') {
      this.state.binding = message.channelBindingDigest;
      setImmediate(() => this.emit('message', Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
        kind: 'bound',
        channelBindingDigest: this.state.binding,
        helperRuntimeVersion: 'portable-isolation-helper-runtime.v1',
      })));
      return;
    }
    if (message.kind === 'exchange') {
      setImmediate(() => this.emit('message', Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
        kind: 'response',
        channelBindingDigest: this.state.binding,
        frame: createPortableIsolationHelperPrivateFrame({
          direction: 'response',
          sequence: message.frame.sequence,
          channelBindingDigest: this.state.binding,
          requestPayloadDigest: message.frame.payloadDigest,
          payload: { ok: true },
        }),
      })));
      return;
    }
    if (message.kind === 'abort') {
      setImmediate(() => this.emit('message', Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
        kind: 'abort_receipt',
        channelBindingDigest: this.state.binding,
        processTreeTerminated: true,
        orphaned: 0,
      })));
      return;
    }
    if (message.kind === 'dispose') {
      setImmediate(() => {
        this.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'dispose_ready',
          channelBindingDigest: this.state.binding,
          orphaned: 0,
        }));
        setImmediate(() => this.emit('exit', 0));
      });
    }
  }

  kill() {
    this.state.killed += 1;
    setImmediate(() => this.emit('exit', 143));
    return true;
  }
}

class SynchronousSpawnUtilityProcess extends FakeUtilityProcess {
  constructor() {
    super({ neverSpawns: true });
  }

  on(eventName, listener) {
    super.on(eventName, listener);
    if (eventName === 'spawn') listener();
    return this;
  }

  postMessage(message) {
    this.state.messages.push(message);
    if (message.kind === 'bind') {
      this.state.binding = message.channelBindingDigest;
      this.emit('message', Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
        kind: 'bound',
        channelBindingDigest: this.state.binding,
        helperRuntimeVersion: 'portable-isolation-helper-runtime.v1',
      }));
    } else if (message.kind === 'dispose') {
      this.emit('message', Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
        kind: 'dispose_ready',
        channelBindingDigest: this.state.binding,
        orphaned: 0,
      }));
      this.emit('exit', 0);
    }
  }
}

function requestFrame(sequence = 1) {
  return createPortableIsolationHelperPrivateFrame({
    direction: 'request',
    sequence,
    channelBindingDigest: digest('a'),
    payload: { operation: 'handshake', sequence },
  });
}

async function openHarness(overrides = {}, timeoutMs = 100) {
  const utilityProcess = new FakeUtilityProcess(overrides);
  const channel = await openPortableIsolationHelperUtilityChannel({
    utilityProcess,
    channelBindingDigest: digest('a'),
    runtimeBinding: runtimeBinding(),
    timeoutMs,
  });
  return { channel, utilityProcess };
}

(async () => {
  const opened = await openHarness();
  assert.strictEqual(opened.channel.version, PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION);
  assert.ok(Object.isFrozen(opened.channel));
  assert.deepStrictEqual(
    Object.keys(opened.channel).sort(),
    ['abort', 'dispose', 'exchange', 'version']
  );
  assert.strictEqual(opened.utilityProcess.state.messages.length, 1);
  assert.deepStrictEqual(opened.utilityProcess.state.messages[0], Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
    kind: 'bind',
    channelBindingDigest: digest('a'),
    runtimeBinding: runtimeBinding(),
  }));
  assert.ok(Object.isFrozen(opened.utilityProcess.state.messages[0]));

  const frame = requestFrame();
  const responseFrame = await opened.channel.exchange(frame);
  assert.strictEqual(responseFrame.direction, 'response');
  assert.strictEqual(responseFrame.sequence, 1);
  assert.strictEqual(responseFrame.requestPayloadDigest, frame.payloadDigest);
  assert.strictEqual(opened.utilityProcess.state.messages[1].kind, 'exchange');
  assert.strictEqual(opened.utilityProcess.state.messages[1].frame, frame);

  const pendingResponse = deferred();
  const busy = await openHarness({
    postMessage(message, utilityProcess) {
      if (message.kind === 'bind') {
        utilityProcess.state.binding = message.channelBindingDigest;
        setImmediate(() => utilityProcess.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'bound',
          channelBindingDigest: utilityProcess.state.binding,
          helperRuntimeVersion: 'portable-isolation-helper-runtime.v1',
        })));
      } else if (message.kind === 'exchange') {
        pendingResponse.promise.then(() => utilityProcess.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'response',
          channelBindingDigest: utilityProcess.state.binding,
          frame: createPortableIsolationHelperPrivateFrame({
            direction: 'response',
            sequence: message.frame.sequence,
            channelBindingDigest: utilityProcess.state.binding,
            requestPayloadDigest: message.frame.payloadDigest,
            payload: { ok: true },
          }),
        })));
      }
    },
  });
  const first = busy.channel.exchange(requestFrame());
  await expectRejectCode(
    busy.channel.exchange(requestFrame(2)),
    'UTILITY_CHANNEL_BUSY'
  );
  pendingResponse.resolve();
  await first;

  const wrongBinding = await openHarness({
    postMessage(message, utilityProcess) {
      if (message.kind === 'bind') {
        utilityProcess.state.binding = message.channelBindingDigest;
        setImmediate(() => utilityProcess.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'bound',
          channelBindingDigest: utilityProcess.state.binding,
          helperRuntimeVersion: 'portable-isolation-helper-runtime.v1',
        })));
      } else if (message.kind === 'exchange') {
        setImmediate(() => utilityProcess.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'response',
          channelBindingDigest: digest('b'),
          frame: message.frame,
        })));
      }
    },
  });
  await expectRejectCode(
    wrongBinding.channel.exchange(requestFrame()),
    'UTILITY_CHANNEL_MESSAGE_REJECTED'
  );
  assert.strictEqual(wrongBinding.utilityProcess.state.killed, 1);

  let getterTouched = false;
  const accessorMessage = {};
  Object.defineProperty(accessorMessage, 'kind', {
    enumerable: true,
    get() {
      getterTouched = true;
      return 'response';
    },
  });
  const hostile = await openHarness({
    postMessage(message, utilityProcess) {
      if (message.kind === 'bind') {
        utilityProcess.state.binding = message.channelBindingDigest;
        setImmediate(() => utilityProcess.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'bound',
          channelBindingDigest: utilityProcess.state.binding,
          helperRuntimeVersion: 'portable-isolation-helper-runtime.v1',
        })));
      } else if (message.kind === 'exchange') {
        setImmediate(() => utilityProcess.emit('message', accessorMessage));
      }
    },
  });
  await expectRejectCode(
    hostile.channel.exchange(requestFrame()),
    'UTILITY_CHANNEL_MESSAGE_REJECTED'
  );
  assert.strictEqual(getterTouched, false);
  assert.strictEqual(hostile.utilityProcess.state.killed, 1);

  const interrupted = await openHarness({
    postMessage(message, utilityProcess) {
      if (message.kind === 'bind') {
        utilityProcess.state.binding = message.channelBindingDigest;
        setImmediate(() => utilityProcess.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'bound',
          channelBindingDigest: utilityProcess.state.binding,
          helperRuntimeVersion: 'portable-isolation-helper-runtime.v1',
        })));
      } else if (message.kind === 'abort') {
        setImmediate(() => utilityProcess.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'abort_receipt',
          channelBindingDigest: utilityProcess.state.binding,
          processTreeTerminated: true,
          orphaned: 0,
        })));
      }
    },
  });
  const pendingExchange = interrupted.channel.exchange(requestFrame());
  const pendingExchangeRejection = expectRejectCode(
    pendingExchange,
    'UTILITY_CHANNEL_ABORTED'
  );
  const abortReceipt = await interrupted.channel.abort(Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_REQUEST_VERSION,
    reasonCode: 'TEST_ABORT',
    channelBindingDigest: digest('a'),
  }));
  assert.deepStrictEqual(abortReceipt, Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_RECEIPT_VERSION,
    aborted: true,
    processTreeTerminated: true,
    orphaned: 0,
  }));
  await pendingExchangeRejection;

  const disposed = await openHarness();
  const disposeReceipt = await disposed.channel.dispose();
  assert.deepStrictEqual(disposeReceipt, Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION,
    closed: true,
    helperExited: true,
    orphaned: 0,
  }));
  assert.strictEqual(await disposed.channel.dispose(), disposeReceipt);
  assert.strictEqual(disposed.utilityProcess.state.killed, 0);

  const orphaned = await openHarness({
    postMessage(message, utilityProcess) {
      if (message.kind === 'bind') {
        utilityProcess.state.binding = message.channelBindingDigest;
        setImmediate(() => utilityProcess.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'bound',
          channelBindingDigest: utilityProcess.state.binding,
          helperRuntimeVersion: 'portable-isolation-helper-runtime.v1',
        })));
      } else if (message.kind === 'dispose') {
        setImmediate(() => utilityProcess.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'dispose_ready',
          channelBindingDigest: utilityProcess.state.binding,
          orphaned: 1,
        })));
      }
    },
  });
  await expectRejectCode(orphaned.channel.dispose(), 'UTILITY_CHANNEL_CLOSE_FAILED');
  assert.strictEqual(orphaned.utilityProcess.state.killed, 1);

  const exited = await openHarness({
    postMessage(message, utilityProcess) {
      if (message.kind === 'bind') {
        utilityProcess.state.binding = message.channelBindingDigest;
        setImmediate(() => utilityProcess.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'bound',
          channelBindingDigest: utilityProcess.state.binding,
          helperRuntimeVersion: 'portable-isolation-helper-runtime.v1',
        })));
      } else if (message.kind === 'exchange') {
        setImmediate(() => utilityProcess.emit('exit', 9));
      }
    },
  });
  await expectRejectCode(exited.channel.exchange(requestFrame()), 'UTILITY_CHANNEL_EXITED');

  const synchronousProcess = new SynchronousSpawnUtilityProcess();
  const synchronousChannel = await openPortableIsolationHelperUtilityChannel({
    utilityProcess: synchronousProcess,
    channelBindingDigest: digest('a'),
    runtimeBinding: runtimeBinding(),
    timeoutMs: 20,
  });
  assert.strictEqual(synchronousChannel.version, PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION);
  const synchronousDispose = await synchronousChannel.dispose();
  assert.deepStrictEqual(synchronousDispose, Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION,
    closed: true,
    helperExited: true,
    orphaned: 0,
  }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.strictEqual(synchronousProcess.state.killed, 0);

  class PartiallyAttachedUtilityProcess extends FakeUtilityProcess {
    constructor() {
      super({ neverSpawns: true });
    }

    on(eventName, listener) {
      if (eventName === 'error') throw new Error('hostile listener registration');
      return super.on(eventName, listener);
    }
  }
  const partiallyAttached = new PartiallyAttachedUtilityProcess();
  await expectRejectCode(
    openPortableIsolationHelperUtilityChannel({
      utilityProcess: partiallyAttached,
      channelBindingDigest: digest('a'),
      runtimeBinding: runtimeBinding(),
      timeoutMs: 20,
    }),
    'UTILITY_CHANNEL_PROCESS_INVALID'
  );
  for (const eventName of ['spawn', 'message', 'exit', 'error']) {
    assert.strictEqual(partiallyAttached.listenerCount(eventName), 0);
  }
  assert.strictEqual(partiallyAttached.state.killed, 1);

  const neverSpawns = new FakeUtilityProcess({ neverSpawns: true });
  await expectRejectCode(
    openPortableIsolationHelperUtilityChannel({
      utilityProcess: neverSpawns,
      channelBindingDigest: digest('a'),
      runtimeBinding: runtimeBinding(),
      timeoutMs: 20,
    }),
    'UTILITY_CHANNEL_OPEN_TIMEOUT'
  );
  assert.strictEqual(neverSpawns.state.killed, 1);

  let digestCoercionTouched = false;
  const invalidBindingProcess = new FakeUtilityProcess({ neverSpawns: true });
  await expectRejectCode(
    openPortableIsolationHelperUtilityChannel({
      utilityProcess: invalidBindingProcess,
      channelBindingDigest: digest('a'),
      runtimeBinding: {
        ...runtimeBinding(),
        bundleIdentityDigest: {
          toString() {
            digestCoercionTouched = true;
            return digest('b');
          },
        },
      },
      timeoutMs: 20,
    }),
    'UTILITY_CHANNEL_OPTIONS_INVALID'
  );
  assert.strictEqual(digestCoercionTouched, false);
  assert.strictEqual(invalidBindingProcess.listenerCount('spawn'), 0);
  assert.strictEqual(invalidBindingProcess.state.killed, 0);

  const invalidProcess = Object.freeze({
    on() {},
    removeListener() {},
    postMessage() {},
    kill() {},
    executablePath: '/tmp/forbidden-helper',
  });
  await expectRejectCode(
    openPortableIsolationHelperUtilityChannel({
      utilityProcess: invalidProcess,
      channelBindingDigest: digest('a'),
      runtimeBinding: runtimeBinding(),
      timeoutMs: 20,
    }),
    'UTILITY_CHANNEL_PROCESS_INVALID'
  );

  console.log('portable isolation helper utility channel tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
