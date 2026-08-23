'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  createProjectRootPhysicalIdentityDigest,
} = require('../main/capabilities/project_root_authority_contract');
const {
  SANDBOX_COMMAND_KINDS,
  SANDBOX_NETWORK_MODES,
  createSandboxExecutionRequest,
} = require('../main/capabilities/sandbox_backend_contract');
const {
  PROCESS_EXECUTION_STATUSES,
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  PROCESS_SUPERVISOR_STATES,
  assertProcessSupervisorBackend,
  assertProcessSupervisorDisposeReceipt,
  assertProcessSupervisorExecReceipt,
  assertProcessSupervisorProbeResult,
  assertProcessSupervisorReadResult,
  assertProcessSupervisorStopReceipt,
  assertProcessSupervisorWaitResult,
  createProcessSupervisorExecRequest,
  createProcessSupervisorReadRequest,
  createProcessSupervisorStopRequest,
  createProcessSupervisorWaitRequest,
} = require('../main/capabilities/process_supervisor_contract');
const {
  PORTABLE_PROCESS_SUPERVISOR_BACKEND_VERSION,
  PortableProcessSupervisorBackendError,
  createPortableProcessSupervisorBackend,
} = require('../main/services/portable_isolation_helper_process_supervisor_backend');

const TERMINAL_STATUSES = new Set([
  PROCESS_EXECUTION_STATUSES.SUCCEEDED,
  PROCESS_EXECUTION_STATUSES.FAILED,
  PROCESS_EXECUTION_STATUSES.STOPPED,
  PROCESS_EXECUTION_STATUSES.TIMED_OUT,
]);

assert.strictEqual(
  PORTABLE_PROCESS_SUPERVISOR_BACKEND_VERSION,
  'portable-process-supervisor-backend.v1'
);
assert.strictEqual(typeof PortableProcessSupervisorBackendError, 'function');
assert.strictEqual(typeof createPortableProcessSupervisorBackend, 'function');

const digest = (character) => 'sha256:' + character.repeat(64);

function entryType(stat) {
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isDirectory()) return 'directory';
  return 'other';
}

function physicalRootDigest(rootPath) {
  const entryBefore = fs.lstatSync(rootPath);
  const targetBefore = fs.statSync(rootPath);
  const realRootPath = fs.realpathSync(rootPath);
  const entryAfter = fs.lstatSync(rootPath);
  const targetAfter = fs.statSync(rootPath);
  assert.strictEqual(String(entryBefore.dev), String(entryAfter.dev));
  assert.strictEqual(String(entryBefore.ino), String(entryAfter.ino));
  assert.strictEqual(String(targetBefore.dev), String(targetAfter.dev));
  assert.strictEqual(String(targetBefore.ino), String(targetAfter.ino));
  return Object.freeze({
    realRootPath,
    digest: createProjectRootPhysicalIdentityDigest({
      device: String(targetAfter.dev),
      inode: String(targetAfter.ino),
      entryDevice: String(entryAfter.dev),
      entryInode: String(entryAfter.ino),
      entryType: entryType(entryAfter),
    }),
  });
}

function requestFor(fixture, suffix, overrides = {}) {
  const physical = physicalRootDigest(fixture.workspaceRoot);
  const workspaceRequest = createExecutionWorkspaceAcquireRequest({
    leaseId: 'workspace-lease-' + suffix,
    binding: {
      projectId: 'project-' + suffix,
      canonicalRootPath: fixture.sourceRoot,
      realRootPath: fixture.sourceRoot,
      sessionId: 'session-' + suffix,
      jobId: 'job-' + suffix,
      kernelId: 'portable-helper',
      submissionDigest: digest('a'),
    },
    sourceRootIdentityDigest: digest('b'),
  });
  const workspaceLease = createExecutionWorkspaceLease({
    request: workspaceRequest,
    workspaceRootPath: fixture.workspaceRoot,
    workspaceRealRootPath: physical.realRootPath,
    workspaceRootIdentityDigest:
      overrides.workspaceRootIdentityDigest || physical.digest,
  });
  const cwd = overrides.cwd || fixture.workspaceRoot;
  const cwdRealPath = overrides.cwdRealPath || fs.realpathSync(cwd);
  const sandboxRequest = createSandboxExecutionRequest({
    executionId: 'execution-' + suffix,
    requestId: 'request-' + suffix,
    grantId: 'grant-' + suffix,
    rootPath: workspaceLease.workspaceRootPath,
    realRootPath: workspaceLease.workspaceRealRootPath,
    cwd,
    cwdRealPath,
    command: overrides.command || {
      kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("ok")'],
    },
    env: overrides.env || { SAFE_FLAG: '1' },
    networkMode: overrides.networkMode || SANDBOX_NETWORK_MODES.DISABLED,
    timeoutMs: overrides.timeoutMs || 10_000,
  });
  return createProcessSupervisorExecRequest({ workspaceLease, sandboxRequest });
}

function assertBackendError(code) {
  return (error) => {
    assert.ok(error instanceof PortableProcessSupervisorBackendError);
    assert.strictEqual(error.code, code);
    assert.strictEqual(error.message, code);
    return true;
  };
}

async function assertRejectCode(promise, code) {
  await assert.rejects(promise, assertBackendError(code));
}

function removeTree(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* test cleanup */ }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForTerminal(backend, request, initial) {
  let snapshot = initial;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (TERMINAL_STATUSES.has(snapshot.status)) return snapshot;
    const waitRequest = createProcessSupervisorWaitRequest({
      request,
      afterRevision: snapshot.revision,
      timeoutMs: 1_000,
    });
    snapshot = assertProcessSupervisorWaitResult(
      await backend.wait(waitRequest),
      waitRequest
    );
  }
  throw new Error('process did not reach a terminal state');
}

async function collectOutput(backend, request) {
  let cursor = 0;
  const chunks = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const readRequest = createProcessSupervisorReadRequest({
      request,
      cursor,
      maxBytes: 1024 * 1024,
    });
    const result = assertProcessSupervisorReadResult(
      await backend.read(readRequest),
      readRequest
    );
    chunks.push(...result.chunks);
    if (result.eof) return Object.freeze({ chunks, result });
    if (result.nextCursor === cursor) throw new Error('process output cursor stalled');
    cursor = result.nextCursor;
  }
  throw new Error('process output did not reach eof');
}

async function waitForStdout(backend, request, initial) {
  let snapshot = initial;
  let cursor = 0;
  let stdout = '';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const readRequest = createProcessSupervisorReadRequest({
      request,
      cursor,
      maxBytes: 64 * 1024,
    });
    const result = await backend.read(readRequest);
    stdout += result.chunks
      .filter((chunk) => chunk.stream === 'stdout')
      .map((chunk) => chunk.text)
      .join('');
    cursor = result.nextCursor;
    snapshot = result;
    if (/^[0-9]+\n/.test(stdout)) {
      return Object.freeze({ pid: Number(stdout.trim().split('\n')[0]), snapshot });
    }
    if (TERMINAL_STATUSES.has(result.status)) {
      throw new Error('process exited before reporting its child pid');
    }
    const waitRequest = createProcessSupervisorWaitRequest({
      request,
      afterRevision: snapshot.revision,
      timeoutMs: 1_000,
    });
    snapshot = await backend.wait(waitRequest);
  }
  throw new Error('process did not report its child pid');
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'EPERM');
  }
}

async function assertPidGone(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!pidExists(pid)) return;
    await sleep(20);
  }
  assert.fail('descendant process remained alive: ' + String(pid));
}

function assertStaticBoundary() {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '../main/services/portable_isolation_helper_process_supervisor_backend.js'
    ),
    'utf8'
  );
  const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const utilityEntry = fs.readFileSync(
    path.join(__dirname, '../main/portable_isolation_helper/utility_entry.js'),
    'utf8'
  );
  assert.match(source, /\/usr\/bin\/sandbox-exec/);
  assert.match(source, /\(deny default\)/);
  assert.match(source, /SANDBOX_NETWORK_MODES\.DISABLED/);
  assert.match(source, /detached:\s*true/);
  assert.match(source, /process\.kill\(-record\.processGroupId/);
  assert.match(source, /createProjectRootPhysicalIdentityDigest/);
  assert.match(source, /MAX_RETAINED_OUTPUT_BYTES/);
  assert.doesNotMatch(
    source,
    /\(allow network-|shell:\s*true|childProcess\.(?:execFile|exec)\s*\(|process\.env|\bimport\s*\(/
  );
  assert.doesNotMatch(
    mainSource,
    /portable_isolation_helper_process_supervisor_backend|createPortableProcessSupervisorBackend/
  );
  assert.doesNotMatch(
    utilityEntry,
    /portable_isolation_helper_process_supervisor_backend|createPortableProcessSupervisorBackend/
  );
}

async function run() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-process-backend-test-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const workspaceRoot = path.join(fixtureRoot, 'workspace');
  const outsideRoot = path.join(fixtureRoot, 'outside');
  const fixture = { sourceRoot, workspaceRoot };
  const trackedPrivateRoots = [];
  const backends = [];
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  const outsideSecret = path.join(outsideRoot, 'secret.txt');
  const outsideWrite = path.join(outsideRoot, 'must-not-write.txt');
  fs.writeFileSync(outsideSecret, 'OUTSIDE_SECRET_SENTINEL\n', 'utf8');

  const originalMkdtempSync = fs.mkdtempSync;
  fs.mkdtempSync = function observedMkdtempSync(prefix, ...args) {
    const created = Reflect.apply(originalMkdtempSync, fs, [prefix, ...args]);
    if (typeof prefix === 'string'
      && (prefix.includes('faber-portable-processes-')
        || prefix.includes('process-execution-'))) {
      trackedPrivateRoots.push(created);
    }
    return created;
  };

  try {
    let optionTrapCount = 0;
    const hostileOptions = new Proxy({}, {
      getPrototypeOf() {
        optionTrapCount += 1;
        throw new Error('must not run');
      },
      ownKeys() {
        optionTrapCount += 1;
        throw new Error('must not run');
      },
    });
    assert.throws(
      () => createPortableProcessSupervisorBackend(hostileOptions),
      assertBackendError('PROCESS_SUPERVISOR_BACKEND_OPTIONS_INVALID')
    );
    assert.strictEqual(optionTrapCount, 0);
    assert.throws(
      () => createPortableProcessSupervisorBackend({ extra: true }),
      assertBackendError('PROCESS_SUPERVISOR_BACKEND_OPTIONS_INVALID')
    );

    const backend = createPortableProcessSupervisorBackend();
    backends.push(backend);
    assert.deepStrictEqual(Reflect.ownKeys(backend), [
      'version',
      'id',
      'probe',
      'exec',
      'read',
      'wait',
      'stop',
      'dispose',
    ]);
    assert.strictEqual(backend.version, PROCESS_SUPERVISOR_BACKEND_VERSION);
    assert.strictEqual(backend.id, 'portable-physical-process-supervisor');
    assert.strictEqual(Object.isFrozen(backend), true);
    assert.strictEqual(assertProcessSupervisorBackend(backend), backend);

    let probeTrapCount = 0;
    const probe = assertProcessSupervisorProbeResult(await backend.probe(new Proxy({}, {
      get() {
        probeTrapCount += 1;
        throw new Error('must not run');
      },
      ownKeys() {
        probeTrapCount += 1;
        throw new Error('must not run');
      },
    })));
    assert.strictEqual(probeTrapCount, 0);
    assertStaticBoundary();

    const baselineRequest = requestFor(fixture, 'baseline');
    if (probe.state === PROCESS_SUPERVISOR_STATES.UNAVAILABLE) {
      assert.deepStrictEqual(probe.guarantees, []);
      assert.match(probe.reasonCode, /^PROCESS_SUPERVISOR_[A-Z0-9_]+$/);
      await assertRejectCode(
        backend.exec(baselineRequest),
        'PROCESS_SUPERVISOR_BACKEND_UNAVAILABLE'
      );
      assert.deepStrictEqual(
        assertProcessSupervisorDisposeReceipt(await backend.dispose()),
        { ok: true, disposed: true, orphaned: 0 }
      );
      assert.deepStrictEqual(await backend.dispose(), {
        ok: true,
        disposed: true,
        orphaned: 0,
      });
      for (const privateRoot of trackedPrivateRoots) {
        assert.strictEqual(fs.existsSync(privateRoot), false);
      }
      console.log('portable process supervisor backend unavailable-path tests passed');
      return;
    }

    assert.strictEqual(probe.state, PROCESS_SUPERVISOR_STATES.ENFORCED);
    assert.deepStrictEqual(probe.guarantees, PROCESS_SUPERVISOR_REQUIRED_GUARANTEES);

    await assertRejectCode(
      backend.exec(requestFor(fixture, 'identity-mismatch', {
        workspaceRootIdentityDigest: digest('f'),
      })),
      'PROCESS_WORKSPACE_IDENTITY_MISMATCH'
    );

    const cwdA = path.join(workspaceRoot, 'cwd-a');
    const cwdB = path.join(workspaceRoot, 'cwd-b');
    fs.mkdirSync(cwdA);
    fs.mkdirSync(cwdB);
    await assertRejectCode(
      backend.exec(requestFor(fixture, 'cwd-mismatch', {
        cwd: cwdA,
        cwdRealPath: fs.realpathSync(cwdB),
      })),
      'PROCESS_CWD_IDENTITY_MISMATCH'
    );
    await assertRejectCode(
      backend.exec(requestFor(fixture, 'network-approved', {
        networkMode: SANDBOX_NETWORK_MODES.APPROVED,
      })),
      'PROCESS_NETWORK_AUTHORITY_UNAVAILABLE'
    );

    const insideFile = path.join(workspaceRoot, 'inside-write.txt');
    const isolationScript = [
      'const fs=require("fs"),net=require("net");',
      'const inside=process.argv[1],outside=process.argv[2],outsideWrite=process.argv[3];',
      'fs.writeFileSync(inside,"inside-ok\\n");',
      'let readCode="ALLOWED";try{fs.readFileSync(outside)}catch(e){readCode=e.code}',
      'let writeCode="ALLOWED";try{fs.writeFileSync(outsideWrite,"escape")}catch(e){writeCode=e.code}',
      'const finish=(networkCode,exitCode)=>{process.stdout.write(JSON.stringify({readCode,writeCode,networkCode,safe:process.env.SAFE_FLAG,home:process.env.HOME})+"\\n",()=>process.exit(exitCode))};',
      'const server=net.createServer();',
      'server.once("error",e=>finish(e.code,0));',
      'server.listen(0,"127.0.0.1",()=>server.close(()=>finish("ALLOWED",73)));',
      'setTimeout(()=>finish("STALLED",74),2000);',
    ].join('');
    const isolationRequest = requestFor(fixture, 'isolation', {
      command: {
        kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
        executable: process.execPath,
        args: ['-e', isolationScript, insideFile, outsideSecret, outsideWrite],
      },
    });
    const isolationStarted = assertProcessSupervisorExecReceipt(
      await backend.exec(isolationRequest),
      isolationRequest
    );
    const isolationTerminal = await waitForTerminal(
      backend,
      isolationRequest,
      isolationStarted
    );
    const isolationOutput = await collectOutput(backend, isolationRequest);
    assert.strictEqual(
      isolationTerminal.status,
      PROCESS_EXECUTION_STATUSES.SUCCEEDED,
      JSON.stringify(isolationOutput.chunks)
    );
    const isolationStdout = isolationOutput.chunks
      .filter((chunk) => chunk.stream === 'stdout')
      .map((chunk) => chunk.text)
      .join('');
    const isolationEvidence = JSON.parse(isolationStdout.trim());
    assert.ok(['EACCES', 'EPERM'].includes(isolationEvidence.readCode));
    assert.ok(['EACCES', 'EPERM'].includes(isolationEvidence.writeCode));
    assert.ok(['EACCES', 'EPERM'].includes(isolationEvidence.networkCode));
    assert.strictEqual(isolationEvidence.safe, '1');
    assert.notStrictEqual(isolationEvidence.home, os.homedir());
    assert.match(isolationEvidence.home, /process-execution-/);
    assert.strictEqual(fs.existsSync(isolationEvidence.home), false);
    assert.strictEqual(fs.readFileSync(insideFile, 'utf8'), 'inside-ok\n');
    assert.strictEqual(fs.readFileSync(outsideSecret, 'utf8'), 'OUTSIDE_SECRET_SENTINEL\n');
    assert.strictEqual(fs.existsSync(outsideWrite), false);

    const unicodeRequest = requestFor(fixture, 'unicode-output', {
      command: {
        kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("AéB")'],
      },
    });
    const unicodeStarted = await backend.exec(unicodeRequest);
    await waitForTerminal(backend, unicodeRequest, unicodeStarted);
    const firstReadRequest = createProcessSupervisorReadRequest({
      request: unicodeRequest,
      cursor: 0,
      maxBytes: 1,
    });
    const firstRead = await backend.read(firstReadRequest);
    assert.strictEqual(firstRead.chunks.map((chunk) => chunk.text).join(''), 'A');
    const secondReadRequest = createProcessSupervisorReadRequest({
      request: unicodeRequest,
      cursor: firstRead.nextCursor,
      maxBytes: 2,
    });
    const secondRead = await backend.read(secondReadRequest);
    assert.strictEqual(secondRead.chunks.map((chunk) => chunk.text).join(''), 'é');
    const thirdReadRequest = createProcessSupervisorReadRequest({
      request: unicodeRequest,
      cursor: secondRead.nextCursor,
      maxBytes: 1,
    });
    const thirdRead = await backend.read(thirdReadRequest);
    assert.strictEqual(thirdRead.chunks.map((chunk) => chunk.text).join(''), 'B');
    assert.strictEqual(thirdRead.eof, true);
    await assertRejectCode(
      backend.read(createProcessSupervisorReadRequest({
        request: unicodeRequest,
        cursor: 2,
        maxBytes: 16,
      })),
      'PROCESS_OUTPUT_CURSOR_INVALID'
    );

    const boundedRequest = requestFor(fixture, 'bounded-output', {
      command: {
        kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(3*1024*1024))'],
      },
    });
    const boundedStarted = await backend.exec(boundedRequest);
    await waitForTerminal(backend, boundedRequest, boundedStarted);
    const boundedReadRequest = createProcessSupervisorReadRequest({
      request: boundedRequest,
      cursor: 0,
      maxBytes: 1024 * 1024,
    });
    const boundedRead = await backend.read(boundedReadRequest);
    assert.strictEqual(boundedRead.truncated, true);
    assert.ok(boundedRead.availableFromCursor > 0);
    assert.ok(boundedRead.outputCursor >= 3 * 1024 * 1024);
    assert.ok(
      boundedRead.chunks.reduce(
        (total, chunk) => total + Buffer.byteLength(chunk.text, 'utf8'),
        0
      ) <= boundedReadRequest.maxBytes
    );

    const shellRequest = requestFor(fixture, 'shell', {
      command: {
        kind: SANDBOX_COMMAND_KINDS.SHELL,
        text: 'printf shell-one && printf -- "-shell-two"',
        shellPath: '/bin/sh',
      },
    });
    const shellStarted = await backend.exec(shellRequest);
    const shellTerminal = await waitForTerminal(backend, shellRequest, shellStarted);
    assert.strictEqual(shellTerminal.status, PROCESS_EXECUTION_STATUSES.SUCCEEDED);
    const shellOutput = await collectOutput(backend, shellRequest);
    assert.strictEqual(
      shellOutput.chunks
        .filter((chunk) => chunk.stream === 'stdout')
        .map((chunk) => chunk.text)
        .join(''),
      'shell-one-shell-two'
    );

    const childScript = [
      'const {spawn}=require("child_process");',
      'const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});',
      'process.stdout.write(String(child.pid)+"\\n");',
      'setInterval(()=>{},1000);',
    ].join('');
    const stopRequestSource = requestFor(fixture, 'tree-stop', {
      command: {
        kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
        executable: process.execPath,
        args: ['-e', childScript],
      },
      timeoutMs: 20_000,
    });
    const stopStarted = await backend.exec(stopRequestSource);
    const stopEvidence = await waitForStdout(backend, stopRequestSource, stopStarted);
    assert.strictEqual(pidExists(stopEvidence.pid), true);
    const stopRequest = createProcessSupervisorStopRequest({
      request: stopRequestSource,
      expectedRevision: stopEvidence.snapshot.revision,
      reasonCode: 'USER_CANCELLED',
    });
    const stopped = assertProcessSupervisorStopReceipt(
      await backend.stop(stopRequest),
      stopRequest
    );
    assert.strictEqual(stopped.status, PROCESS_EXECUTION_STATUSES.STOPPED);
    assert.strictEqual(stopped.treeTerminated, true);
    await assertPidGone(stopEvidence.pid);
    const idempotentStopRequest = createProcessSupervisorStopRequest({
      request: stopRequestSource,
      expectedRevision: stopped.revision,
      reasonCode: 'USER_CANCELLED',
    });
    const idempotentStop = await backend.stop(idempotentStopRequest);
    assert.strictEqual(idempotentStop.idempotent, true);
    assert.strictEqual(idempotentStop.revision, stopped.revision);

    const timeoutRequest = requestFor(fixture, 'tree-timeout', {
      command: {
        kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
        executable: process.execPath,
        args: ['-e', childScript],
      },
      timeoutMs: 300,
    });
    const timeoutStarted = await backend.exec(timeoutRequest);
    const timeoutEvidence = await waitForStdout(backend, timeoutRequest, timeoutStarted);
    const timeoutTerminal = await waitForTerminal(
      backend,
      timeoutRequest,
      timeoutEvidence.snapshot
    );
    assert.strictEqual(timeoutTerminal.status, PROCESS_EXECUTION_STATUSES.TIMED_OUT);
    assert.strictEqual(timeoutTerminal.timedOut, true);
    await assertPidGone(timeoutEvidence.pid);

    const disposeRequest = requestFor(fixture, 'tree-dispose', {
      command: {
        kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
        executable: process.execPath,
        args: ['-e', childScript],
      },
      timeoutMs: 20_000,
    });
    const disposeStarted = await backend.exec(disposeRequest);
    const disposeEvidence = await waitForStdout(backend, disposeRequest, disposeStarted);
    const disposed = assertProcessSupervisorDisposeReceipt(await backend.dispose());
    assert.deepStrictEqual(disposed, { ok: true, disposed: true, orphaned: 0 });
    await assertPidGone(disposeEvidence.pid);
    assert.deepStrictEqual(await backend.dispose(), disposed);
    const disposedProbe = await backend.probe();
    assert.strictEqual(disposedProbe.state, PROCESS_SUPERVISOR_STATES.UNAVAILABLE);
    assert.strictEqual(disposedProbe.reasonCode, 'PROCESS_SUPERVISOR_BACKEND_DISPOSED');
    await assertRejectCode(
      backend.exec(requestFor(fixture, 'after-dispose')),
      'PROCESS_SUPERVISOR_BACKEND_UNAVAILABLE'
    );

    for (const privateRoot of trackedPrivateRoots) {
      assert.strictEqual(fs.existsSync(privateRoot), false);
    }
  } finally {
    fs.mkdtempSync = originalMkdtempSync;
    for (const backend of backends) {
      try { await backend.dispose(); } catch { /* test cleanup continues */ }
    }
    for (const privateRoot of trackedPrivateRoots.reverse()) removeTree(privateRoot);
    removeTree(fixtureRoot);
  }
}

run().then(() => {
  console.log('portable process supervisor backend tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
