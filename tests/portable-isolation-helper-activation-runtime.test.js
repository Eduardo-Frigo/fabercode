'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  immutableSnapshot,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  createPortableIsolationHelperDistributionAttestation,
  createPortableIsolationHelperDistributionManifest,
} = require('../main/capabilities/portable_isolation_helper_distribution_attestation_contract');
const {
  createPortableIsolationHelperPrivateFrame,
  assertPortableIsolationHelperPrivateFrame,
} = require('../main/capabilities/portable_isolation_helper_private_transport_contract');
const {
  createPortableIsolationHelperShutdownReceipt,
} = require('../main/capabilities/portable_isolation_helper_protocol');
const {
  EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
} = require('../main/runtime/execution_isolation_runtime_config');
const {
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION,
} = require('../main/services/portable_isolation_helper_host_launcher');
const {
  PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
} = require('../main/services/portable_isolation_helper_utility_channel');
const {
  createPortableIsolationHelperRuntimeSession,
} = require('../main/services/portable_isolation_helper_runtime_session');
const {
  PORTABLE_ISOLATION_HELPER_ACTIVATION_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_ACTIVATION_RUNTIME_VERSION,
  PortableIsolationHelperActivationRuntimeError,
  createPortableIsolationHelperActivationRuntime,
  createProductionPortableIsolationHelperActivationRuntime,
} = require('../main/services/portable_isolation_helper_activation_runtime');

const tempDirectories = [];
const digest = (character) => `sha256:${character.repeat(64)}`;
const sha256 = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'faber-portable-helper-activation-'
  ));
  tempDirectories.push(directory);
  return directory;
}

function runtimeConfig(mode, killSwitch) {
  return Object.freeze({
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode,
    killSwitch,
  });
}

function resourceFixture() {
  const resourcesPath = tempDirectory();
  const bundleDirectory = path.join(resourcesPath, 'portable-isolation-helper');
  const entryPath = path.join(bundleDirectory, 'utility_entry.js');
  const attestationPath = path.join(
    bundleDirectory,
    'distribution_attestation.json'
  );
  const entryBytes = Buffer.from("'use strict';\n// activation fixture\n", 'utf8');
  fs.mkdirSync(bundleDirectory, { recursive: true });
  fs.writeFileSync(entryPath, entryBytes);
  const manifest = createPortableIsolationHelperDistributionManifest({
    applicationId: 'com.faber.code',
    applicationVersion: '0.1.3',
    electronVersion: '42.1.0',
    bundleId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-runtime-1',
    platform: 'darwin',
    architecture: 'arm64',
    resourceName: 'utility_entry.js',
    resourceDigest: sha256(entryBytes),
    resourceBytes: entryBytes.length,
    keyId: 'activation-test-key-1',
  });
  const attestation = createPortableIsolationHelperDistributionAttestation({
    manifest,
    signatureBase64: Buffer.alloc(64).toString('base64'),
  });
  fs.writeFileSync(
    attestationPath,
    `${JSON.stringify(immutableSnapshot(attestation))}\n`,
    'utf8'
  );
  return Object.freeze({ resourcesPath, entryPath });
}

function signatureVerifier(state) {
  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION,
    verify(request) {
      state.verifications += 1;
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION,
        verified: true,
        distribution: 'application_bundle',
        platform: request.platform,
        architecture: request.architecture,
        resourceDigest: request.resourceDigest,
        signatureIdentityDigest: digest('d'),
      }));
    },
  });
}

class FakeUtilityProcess extends EventEmitter {
  constructor(state) {
    super();
    this.state = state;
    this.binding = null;
    this.runtime = null;
    this.killed = false;
    setImmediate(() => this.emit('spawn'));
  }

  postMessage(message) {
    this.state.messages.push(message.kind);
    if (message.kind === 'bind') {
      this.binding = message.channelBindingDigest;
      const runtimeBinding = message.runtimeBinding;
      this.runtime = createPortableIsolationHelperRuntimeSession({
        identity: Object.freeze({
          helperId: runtimeBinding.helperId,
          helperBuildId: runtimeBinding.helperBuildId,
          bundleIdentityDigest: runtimeBinding.bundleIdentityDigest,
          executionWorkspaceBackendId: 'activation-test-workspace',
          projectRootAuthorityBackendId: 'activation-test-root',
          processSupervisorBackendId: 'activation-test-process',
          platform: runtimeBinding.platform,
        }),
        dispatch() {
          throw new Error('no backend operation is expected during activation');
        },
        dispose: () => createPortableIsolationHelperShutdownReceipt({
          activeWorkspaces: 0,
          activeRootLeases: 0,
          activeProcesses: 0,
          orphaned: 0,
        }),
      });
      setImmediate(() => this.emit('message', Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
        kind: 'bound',
        channelBindingDigest: this.binding,
        helperRuntimeVersion: 'portable-isolation-helper-runtime.v1',
      })));
      return;
    }
    if (message.kind === 'exchange') {
      const requestFrame = message.frame;
      const request = assertPortableIsolationHelperPrivateFrame(requestFrame, {
        direction: 'request',
        sequence: requestFrame.sequence,
        channelBindingDigest: this.binding,
      });
      this.runtime.accept(request).then((response) => {
        const responseFrame = createPortableIsolationHelperPrivateFrame({
          direction: 'response',
          sequence: requestFrame.sequence,
          channelBindingDigest: this.binding,
          requestPayloadDigest: requestFrame.payloadDigest,
          payload: response,
        });
        this.emit('message', Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
          kind: 'response',
          channelBindingDigest: this.binding,
          frame: responseFrame,
        }));
      });
      return;
    }
    if (message.kind === 'abort') {
      setImmediate(() => this.emit('message', Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
        kind: 'abort_receipt',
        channelBindingDigest: this.binding,
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
          channelBindingDigest: this.binding,
          orphaned: 0,
        }));
        setImmediate(() => this.emit('exit', 0));
      });
    }
  }

  kill() {
    this.killed = true;
    this.state.kills += 1;
    setImmediate(() => this.emit('exit', 143));
    return true;
  }
}

function activationHarness(config = runtimeConfig('enabled', false)) {
  const fixture = resourceFixture();
  const state = {
    trustReads: 0,
    verifications: 0,
    forks: [],
    processes: [],
    messages: [],
    kills: 0,
  };
  const runtime = createPortableIsolationHelperActivationRuntime({
    config,
    resourcesPath: fixture.resourcesPath,
    packaged: true,
    platform: 'darwin',
    architecture: 'arm64',
    applicationVersion: '0.1.3',
    electronVersion: '42.1.0',
    createSignatureVerifier() {
      state.trustReads += 1;
      return signatureVerifier(state);
    },
    forkUtilityProcess(modulePath, args, options) {
      state.forks.push(Object.freeze({ modulePath, args, options }));
      const process = new FakeUtilityProcess(state);
      state.processes.push(process);
      return process;
    },
    channelTimeoutMs: 500,
  });
  return Object.freeze({ fixture, runtime, state });
}

async function assertInactive(config, expectedReason) {
  const harness = activationHarness(config);
  const selection = await harness.runtime.start();
  assert.strictEqual(selection.diagnostics.status, 'unsupported');
  assert.strictEqual(selection.diagnostics.reasonCode, expectedReason);
  assert.strictEqual(harness.state.trustReads, 0);
  assert.strictEqual(harness.state.verifications, 0);
  assert.strictEqual(harness.state.forks.length, 0);
  assert.deepStrictEqual(harness.runtime.diagnostics(), {
    version: PORTABLE_ISOLATION_HELPER_ACTIVATION_RUNTIME_VERSION,
    state: 'blocked',
    mode: config.mode,
    killSwitch: config.killSwitch,
    selectionStatus: 'unsupported',
    activationBlockReason: expectedReason,
    helperLaunched: false,
    cleanupConfirmed: true,
  });
  const disposed = await harness.runtime.dispose();
  assert.strictEqual(disposed.zeroOrphanShutdownConfirmed, true);
}

(async () => {
  try {
    assert.strictEqual(
      PORTABLE_ISOLATION_HELPER_ACTIVATION_RUNTIME_VERSION,
      'portable-isolation-helper-activation-runtime.v1'
    );
    assert.strictEqual(
      PORTABLE_ISOLATION_HELPER_ACTIVATION_DISPOSE_RECEIPT_VERSION,
      'portable-isolation-helper-activation-dispose-receipt.v1'
    );

    await assertInactive(runtimeConfig('disabled', false), 'RUNTIME_DISABLED');
    await assertInactive(
      runtimeConfig('enabled', true),
      'RUNTIME_KILL_SWITCH_ACTIVE'
    );

    const trustBlockedFixture = resourceFixture();
    let trustBlockedForks = 0;
    const trustBlocked = createProductionPortableIsolationHelperActivationRuntime({
      config: runtimeConfig('enabled', false),
      resourcesPath: trustBlockedFixture.resourcesPath,
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      applicationVersion: '0.1.3',
      electronVersion: '42.1.0',
      forkUtilityProcess() {
        trustBlockedForks += 1;
        throw new Error('must remain unreachable without release trust');
      },
      channelTimeoutMs: 500,
    });
    const trustBlockedSelection = await trustBlocked.start();
    assert.strictEqual(trustBlockedSelection.diagnostics.status, 'unsupported');
    assert.strictEqual(
      trustBlockedSelection.diagnostics.reasonCode,
      'PROVIDER_UNAVAILABLE'
    );
    assert.strictEqual(trustBlockedForks, 0);
    assert.strictEqual(
      trustBlocked.diagnostics().activationBlockReason,
      'RELEASE_TRUST_UNCONFIGURED'
    );
    assert.strictEqual(
      (await trustBlocked.dispose()).zeroOrphanShutdownConfirmed,
      true
    );

    const active = activationHarness();
    assert.ok(Object.isFrozen(active.runtime));
    assert.deepStrictEqual(Reflect.ownKeys(active.runtime), [
      'version', 'start', 'diagnostics', 'dispose',
    ]);
    const selection = await active.runtime.start();
    assert.strictEqual(await active.runtime.start(), selection);
    assert.strictEqual(selection.diagnostics.status, 'enforced');
    assert.strictEqual(selection.diagnostics.reasonCode, 'ENFORCED');
    assert.strictEqual(active.state.trustReads, 1);
    assert.strictEqual(active.state.verifications, 1);
    assert.strictEqual(active.state.forks.length, 1);
    assert.strictEqual(active.state.forks[0].modulePath, active.fixture.entryPath);
    assert.deepStrictEqual(active.state.forks[0].args, []);
    assert.deepStrictEqual(active.runtime.diagnostics(), {
      version: PORTABLE_ISOLATION_HELPER_ACTIVATION_RUNTIME_VERSION,
      state: 'active',
      mode: 'enabled',
      killSwitch: false,
      selectionStatus: 'enforced',
      activationBlockReason: null,
      helperLaunched: true,
      cleanupConfirmed: false,
    });

    const disposal = await active.runtime.dispose();
    assert.ok(Object.isFrozen(disposal));
    assert.deepStrictEqual(disposal, {
      version: PORTABLE_ISOLATION_HELPER_ACTIVATION_DISPOSE_RECEIPT_VERSION,
      disposed: true,
      zeroOrphanShutdownConfirmed: true,
    });
    assert.strictEqual(await active.runtime.dispose(), disposal);
    assert.strictEqual(active.state.kills, 0);
    assert.ok(active.state.messages.includes('bind'));
    assert.ok(active.state.messages.includes('exchange'));
    assert.ok(active.state.messages.includes('dispose'));
    assert.strictEqual(active.runtime.diagnostics().state, 'disposed');
    assert.strictEqual(active.runtime.diagnostics().cleanupConfirmed, true);

    const invalid = {
      config: runtimeConfig('disabled', true),
      resourcesPath: tempDirectory(),
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      applicationVersion: '0.1.3',
      electronVersion: '42.1.0',
      createSignatureVerifier() { return signatureVerifier({ verifications: 0 }); },
      forkUtilityProcess() { throw new Error('unreachable'); },
      channelTimeoutMs: 500,
      providerPath: '/tmp/forbidden-provider',
    };
    assert.throws(
      () => createPortableIsolationHelperActivationRuntime(invalid),
      (error) => error instanceof PortableIsolationHelperActivationRuntimeError
        && error.code === 'ACTIVATION_OPTIONS_INVALID'
    );

    const source = fs.readFileSync(path.join(
      __dirname,
      '../main/services/portable_isolation_helper_activation_runtime.js'
    ), 'utf8');
    assert.match(source, /createPortableIsolationHelperReleaseSignatureVerifier/);
    assert.match(source, /createExecutionIsolationProviderSelection/);
    assert.match(source, /createPortableIsolationHelperHostLauncher/);
    assert.match(source, /createPortableIsolationHelperPrivateTransport/);
    assert.match(source, /createPortableIsolationHelperClient/);
    assert.match(source, /createPortableIsolationHelperProviderAdapter/);
    assert.doesNotMatch(
      source,
      /process\.env|PRIVATE KEY|privateKey|providerPath|executablePath|binaryPath/
    );

    console.log('portable isolation helper activation runtime tests passed');
  } finally {
    for (const directory of tempDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
