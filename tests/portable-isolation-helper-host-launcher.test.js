'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PORTABLE_ISOLATION_HELPER_LAUNCH_RECEIPT_VERSION,
  createPortableIsolationHelperLaunchRequest,
} = require('../main/capabilities/portable_isolation_helper_launcher_contract');
const {
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION,
} = require('../main/capabilities/portable_isolation_helper_private_transport_contract');
const {
  PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
} = require('../main/services/portable_isolation_helper_utility_channel');
const {
  PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
} = require('../main/services/portable_isolation_helper_client');
const {
  createPortableIsolationHelperPrivateTransport,
} = require('../main/services/portable_isolation_helper_private_transport');
const {
  PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_VERSION,
  PORTABLE_ISOLATION_HELPER_HOST_LAUNCH_RESULT_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION,
  PortableIsolationHelperHostLauncherError,
  createPortableIsolationHelperHostLauncher,
} = require('../main/services/portable_isolation_helper_host_launcher');

const digest = (character) => `sha256:${character.repeat(64)}`;
const tempDirectories = [];

function tempDirectory() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-portable-helper-host-'));
  tempDirectories.push(value);
  return value;
}

function resourceFixture() {
  const resourcesPath = tempDirectory();
  const bundleDirectory = path.join(resourcesPath, 'portable-isolation-helper');
  const entryPath = path.join(bundleDirectory, 'utility_entry.js');
  fs.mkdirSync(bundleDirectory, { recursive: true });
  fs.writeFileSync(entryPath, "'use strict';\n// signed helper fixture\n", 'utf8');
  return { resourcesPath, bundleDirectory, entryPath };
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
    (error) => error instanceof PortableIsolationHelperHostLauncherError
      && error.code === code
      && !error.message.includes(os.tmpdir())
  );
}

class FakeUtilityProcess extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this.binding = null;
    this.killCalls = 0;
    setImmediate(() => this.emit('spawn'));
  }

  postMessage(message) {
    this.messages.push(message);
    if (message.kind === 'bind') {
      this.binding = message.channelBindingDigest;
      setImmediate(() => this.emit('message', Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
        kind: 'bound',
        channelBindingDigest: this.binding,
        helperRuntimeVersion: 'portable-isolation-helper-bootstrap.v1',
      })));
    } else if (message.kind === 'abort') {
      setImmediate(() => this.emit('message', Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
        kind: 'abort_receipt',
        channelBindingDigest: this.binding,
        processTreeTerminated: true,
        orphaned: 0,
      })));
    } else if (message.kind === 'dispose') {
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
    this.killCalls += 1;
    setImmediate(() => this.emit('exit', 143));
    return true;
  }
}

function signatureVerifier(overrides = {}) {
  const state = { requests: [] };
  const verifier = Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION,
    verify(request) {
      state.requests.push(request);
      if (overrides.verify) return overrides.verify(request, state);
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
  return { state, verifier };
}

function launcherHarness({ fixture = resourceFixture(), verifierOverrides = {}, options = {} } = {}) {
  const signature = signatureVerifier(verifierOverrides);
  const state = { forks: [], processes: [] };
  const forkUtilityProcess = (modulePath, args, forkOptions) => {
    state.forks.push({ modulePath, args, options: forkOptions });
    if (options.forkThrows) throw new Error(`secret fork failure: ${modulePath}`);
    const utilityProcess = new FakeUtilityProcess();
    state.processes.push(utilityProcess);
    return utilityProcess;
  };
  const launcher = createPortableIsolationHelperHostLauncher({
    resourcesPath: fixture.resourcesPath,
    packaged: options.packaged === undefined ? true : options.packaged,
    platform: options.platform || 'darwin',
    architecture: options.architecture || 'arm64',
    signatureVerifier: signature.verifier,
    forkUtilityProcess,
    channelTimeoutMs: 100,
  });
  return { fixture, launcher, signature, state };
}

(async () => {
  try {
    const success = launcherHarness();
    assert.strictEqual(success.launcher.version, PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_VERSION);
    assert.ok(Object.isFrozen(success.launcher));
    assert.deepStrictEqual(
      Object.keys(success.launcher).sort(),
      ['diagnostics', 'dispose', 'inspect', 'launch', 'version']
    );
    const descriptor = await success.launcher.inspect();
    assert.strictEqual(descriptor.bundleId, 'faber-portable-isolation-helper');
    assert.strictEqual(descriptor.helperBuildId, 'portable-helper-bootstrap-1');
    assert.match(descriptor.bundleIdentityDigest, /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(descriptor.platform.os, 'darwin');
    assert.strictEqual(descriptor.platform.architecture, 'arm64');
    assert.strictEqual(descriptor.platform.signatureVerification, 'platform_verified');
    assert.strictEqual(descriptor.platform.signatureIdentityDigest, digest('d'));
    assert.strictEqual(JSON.stringify(descriptor).includes(success.fixture.resourcesPath), false);
    assert.strictEqual(success.signature.state.requests.length, 1);
    const signatureRequest = success.signature.state.requests[0];
    assert.strictEqual(
      signatureRequest.version,
      PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION
    );
    assert.strictEqual(signatureRequest.resourcePath, success.fixture.entryPath);
    assert.strictEqual(signatureRequest.distribution, 'application_bundle');
    assert.ok(Object.isFrozen(signatureRequest));

    const request = createPortableIsolationHelperLaunchRequest({
      requestId: 'portable-host-launch-1',
      bundle: descriptor,
    });
    const result = await success.launcher.launch(request);
    assert.strictEqual(result.version, PORTABLE_ISOLATION_HELPER_HOST_LAUNCH_RESULT_VERSION);
    assert.strictEqual(result.launchReceipt.version, PORTABLE_ISOLATION_HELPER_LAUNCH_RECEIPT_VERSION);
    assert.strictEqual(result.launchReceipt.requestDigest, request.requestDigest);
    assert.strictEqual(result.channel.version, PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION);
    assert.ok(Object.isFrozen(result));
    assert.deepStrictEqual(Object.keys(result).sort(), ['channel', 'launchReceipt', 'version']);
    assert.strictEqual(success.state.forks.length, 1);
    assert.strictEqual(success.state.forks[0].modulePath, success.fixture.entryPath);
    assert.deepStrictEqual(success.state.forks[0].args, []);
    assert.deepStrictEqual(success.state.forks[0].options, {
      cwd: success.fixture.bundleDirectory,
      env: {},
      execArgv: [],
      stdio: 'ignore',
      serviceName: 'Faber Portable Isolation Helper',
      allowLoadingUnsignedLibraries: false,
      disclaim: false,
    });
    assert.strictEqual(
      JSON.stringify(success.state.forks[0].options).includes(process.env.PATH || 'never'),
      false
    );
    assert.match(result.launchReceipt.channelBindingDigest, /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(
      result.launchReceipt.channelBindingDigest,
      success.state.processes[0].binding
    );
    assert.deepStrictEqual(success.launcher.diagnostics(), Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_VERSION,
      state: 'active',
      inspected: true,
      signatureVerified: true,
      launched: true,
      activeChannel: true,
    }));
    await expectRejectCode(
      success.launcher.launch(request),
      'HOST_LAUNCH_ALREADY_USED'
    );
    const privateTransport = createPortableIsolationHelperPrivateTransport({
      launchRequest: request,
      launchReceipt: result.launchReceipt,
      channel: result.channel,
    });
    const transportDispose = await privateTransport.dispose();
    assert.deepStrictEqual(transportDispose, Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
      closed: true,
    }));
    assert.strictEqual(await privateTransport.dispose(), transportDispose);

    const launcherDispose = await success.launcher.dispose();
    assert.deepStrictEqual(launcherDispose, Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_DISPOSE_RECEIPT_VERSION,
      disposed: true,
      channelClosed: true,
    }));
    assert.strictEqual(await success.launcher.dispose(), launcherDispose);
    assert.deepStrictEqual(
      success.state.processes[0].messages.map((message) => message.kind),
      ['bind', 'abort', 'dispose']
    );

    const inspectedThenDisposed = launcherHarness();
    await inspectedThenDisposed.launcher.inspect();
    const inspectedDispose = await inspectedThenDisposed.launcher.dispose();
    assert.deepStrictEqual(inspectedDispose, Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_DISPOSE_RECEIPT_VERSION,
      disposed: true,
      channelClosed: false,
    }));
    await expectRejectCode(
      inspectedThenDisposed.launcher.inspect(),
      'HOST_DISPOSED'
    );
    assert.strictEqual(inspectedThenDisposed.state.forks.length, 0);

    const signaturePending = deferred();
    let pendingSignatureRequest = null;
    const inspectingDispose = launcherHarness({
      verifierOverrides: {
        verify(signatureRequestValue) {
          pendingSignatureRequest = signatureRequestValue;
          return signaturePending.promise;
        },
      },
    });
    const pendingInspection = inspectingDispose.launcher.inspect();
    const inspectionRejection = expectRejectCode(pendingInspection, 'HOST_DISPOSED');
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(pendingSignatureRequest);
    const inspectingDisposeReceipt = await inspectingDispose.launcher.dispose();
    signaturePending.resolve(Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION,
      verified: true,
      distribution: 'application_bundle',
      platform: pendingSignatureRequest.platform,
      architecture: pendingSignatureRequest.architecture,
      resourceDigest: pendingSignatureRequest.resourceDigest,
      signatureIdentityDigest: digest('d'),
    }));
    await inspectionRejection;
    assert.deepStrictEqual(inspectingDisposeReceipt, Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_DISPOSE_RECEIPT_VERSION,
      disposed: true,
      channelClosed: false,
    }));
    assert.strictEqual(inspectingDispose.launcher.diagnostics().state, 'disposed');
    assert.strictEqual(inspectingDispose.state.forks.length, 0);

    const launchingDispose = launcherHarness();
    const launchingDescriptor = await launchingDispose.launcher.inspect();
    const launchingRequest = createPortableIsolationHelperLaunchRequest({
      requestId: 'portable-host-launch-dispose-race',
      bundle: launchingDescriptor,
    });
    const pendingLaunch = launchingDispose.launcher.launch(launchingRequest);
    const launchRejection = expectRejectCode(pendingLaunch, 'HOST_DISPOSED');
    const pendingLauncherDispose = launchingDispose.launcher.dispose();
    await launchRejection;
    const launchingDisposeReceipt = await pendingLauncherDispose;
    assert.deepStrictEqual(launchingDisposeReceipt, Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_DISPOSE_RECEIPT_VERSION,
      disposed: true,
      channelClosed: false,
    }));
    assert.strictEqual(launchingDispose.state.forks.length, 0);
    assert.strictEqual(launchingDispose.state.processes.length, 0);
    assert.strictEqual(launchingDispose.launcher.diagnostics().state, 'disposed');
    assert.strictEqual(launchingDispose.launcher.diagnostics().activeChannel, false);

    const unpackaged = launcherHarness({ options: { packaged: false } });
    await expectRejectCode(unpackaged.launcher.inspect(), 'HOST_PACKAGED_APP_REQUIRED');
    assert.strictEqual(unpackaged.signature.state.requests.length, 0);
    assert.strictEqual(unpackaged.state.forks.length, 0);

    const unsigned = launcherHarness({
      verifierOverrides: {
        verify(request) {
          return Promise.resolve(Object.freeze({
            version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION,
            verified: false,
            distribution: 'application_bundle',
            platform: request.platform,
            architecture: request.architecture,
            resourceDigest: request.resourceDigest,
            signatureIdentityDigest: digest('e'),
          }));
        },
      },
    });
    await expectRejectCode(unsigned.launcher.inspect(), 'HOST_SIGNATURE_REJECTED');
    assert.strictEqual(unsigned.state.forks.length, 0);

    const changed = launcherHarness({
      verifierOverrides: {
        verify(request) {
          fs.appendFileSync(request.resourcePath, '// tampered after verification\n');
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
      },
    });
    await expectRejectCode(changed.launcher.inspect(), 'HOST_RESOURCE_CHANGED');
    assert.strictEqual(changed.state.forks.length, 0);

    const symlinkFixture = resourceFixture();
    const target = path.join(symlinkFixture.bundleDirectory, 'target.js');
    fs.renameSync(symlinkFixture.entryPath, target);
    fs.symlinkSync(target, symlinkFixture.entryPath);
    const symlinked = launcherHarness({ fixture: symlinkFixture });
    await expectRejectCode(symlinked.launcher.inspect(), 'HOST_RESOURCE_INVALID');
    assert.strictEqual(symlinked.signature.state.requests.length, 0);

    const mismatch = launcherHarness();
    const legitimate = await mismatch.launcher.inspect();
    const forgedBundle = Object.freeze({
      ...legitimate,
      bundleIdentityDigest: digest('f'),
    });
    await expectRejectCode(
      mismatch.launcher.launch(Object.freeze({
        ...createPortableIsolationHelperLaunchRequest({
          requestId: 'portable-host-launch-mismatch',
          bundle: legitimate,
        }),
        bundleIdentityDigest: forgedBundle.bundleIdentityDigest,
      })),
      'HOST_LAUNCH_REQUEST_REJECTED'
    );
    assert.strictEqual(mismatch.state.forks.length, 0);

    const failedFork = launcherHarness({ options: { forkThrows: true } });
    const failedDescriptor = await failedFork.launcher.inspect();
    await expectRejectCode(
      failedFork.launcher.launch(createPortableIsolationHelperLaunchRequest({
        requestId: 'portable-host-launch-failed-fork',
        bundle: failedDescriptor,
      })),
      'HOST_PROCESS_LAUNCH_FAILED'
    );

    for (const options of [
      { platform: 'freebsd' },
      { architecture: 'ia32' },
    ]) {
      assert.throws(
        () => launcherHarness({ options }),
        (error) => error instanceof PortableIsolationHelperHostLauncherError
          && error.code === 'HOST_OPTIONS_INVALID'
      );
    }

    let getterTouched = false;
    const accessorOptions = {
      resourcesPath: '/tmp/forbidden',
      packaged: true,
      platform: 'darwin',
      architecture: 'arm64',
      signatureVerifier: signatureVerifier().verifier,
      forkUtilityProcess() {},
      channelTimeoutMs: 100,
    };
    Object.defineProperty(accessorOptions, 'resourcesPath', {
      enumerable: true,
      get() {
        getterTouched = true;
        return '/tmp/forbidden';
      },
    });
    assert.throws(
      () => createPortableIsolationHelperHostLauncher(accessorOptions),
      (error) => error instanceof PortableIsolationHelperHostLauncherError
        && error.code === 'HOST_OPTIONS_INVALID'
    );
    assert.strictEqual(getterTouched, false);

    const packageJson = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'package.json'),
      'utf8'
    ));
    assert.ok(packageJson.build.files.includes('!main/portable_isolation_helper/**/*'));
    assert.deepStrictEqual(packageJson.build.extraResources, [{
      from: 'main/portable_isolation_helper',
      to: 'portable-isolation-helper',
      filter: ['utility_entry.js'],
    }]);
    const bootstrapSource = fs.readFileSync(
      path.join(__dirname, '..', 'main', 'portable_isolation_helper', 'utility_entry.js'),
      'utf8'
    );
    assert.match(bootstrapSource, /process\.parentPort/);
    assert.match(bootstrapSource, /dispose_ready/);
    assert.match(bootstrapSource, /processTreeTerminated/);
    assert.doesNotMatch(
      bootstrapSource,
      /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bprocess\.env\b|\bspawn\s*\(|\bexecFile\s*\(/
    );

    console.log('portable isolation helper host launcher tests passed');
  } finally {
    for (const directory of tempDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
