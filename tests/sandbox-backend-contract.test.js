'use strict';

const assert = require('assert');

const {
  SANDBOX_BACKEND_SCHEMA_VERSION,
  SANDBOX_BACKEND_SECURITY_MODEL,
  SANDBOX_BACKEND_STATES,
  SANDBOX_A1_REQUIRED_FEATURES,
  SANDBOX_COMMAND_KINDS,
  SANDBOX_EXECUTION_REQUEST_SCHEMA_VERSION,
  SANDBOX_FEATURES,
  SANDBOX_NETWORK_MODES,
  SandboxUnavailableError,
  areEquivalentPortablePaths,
  assertSandboxBackend,
  createSandboxExecutionRequest,
  createSandboxProbeResult,
  createUnsupportedSandboxBackend,
  isPathInsideProjectRoot,
  isPortableAbsolutePath,
  isSandboxCommand,
  isSandboxExecutionRequest,
  isSandboxProbeResult,
} = require('../main/capabilities/sandbox_backend_contract');

assert.strictEqual(SANDBOX_BACKEND_SCHEMA_VERSION, 'sandbox-backend.v1');
assert.strictEqual(SANDBOX_BACKEND_SECURITY_MODEL, 'physical-root-revalidation.v1');

const enforced = createSandboxProbeResult({
  state: SANDBOX_BACKEND_STATES.ENFORCED,
  features: [SANDBOX_FEATURES.PROCESS_EXECUTE, SANDBOX_FEATURES.FILESYSTEM_SCOPE],
});
assert.strictEqual(enforced.state, 'enforced');
assert.strictEqual(Object.isFrozen(enforced.features), true);
assert.throws(() => createSandboxProbeResult({
  state: SANDBOX_BACKEND_STATES.UNAVAILABLE,
}), /probe result/);
assert.throws(() => createSandboxProbeResult({
  state: SANDBOX_BACKEND_STATES.ENFORCED,
  features: ['unknown'],
}), /feature/);

assert.strictEqual(isPathInsideProjectRoot('/project', '/project/packages/app'), true);
assert.strictEqual(isPathInsideProjectRoot('/project', '/project-escape'), false);
assert.strictEqual(isPortableAbsolutePath('/project'), true);
assert.strictEqual(isPathInsideProjectRoot('C:\\project', 'C:\\project\\packages\\app'), true);
assert.strictEqual(isPathInsideProjectRoot('C:\\Project', 'c:\\project\\APP'), true);
assert.strictEqual(isPathInsideProjectRoot('C:\\project', 'D:\\project'), false);
assert.strictEqual(isPathInsideProjectRoot('C:\\project', 'C:\\project-escape'), false);
assert.strictEqual(isPortableAbsolutePath('C:\\project'), true);
assert.strictEqual(isPortableAbsolutePath('C:/project'), true);
assert.strictEqual(isPortableAbsolutePath('C:project'), false);
assert.strictEqual(isPortableAbsolutePath('\\project'), false);
assert.strictEqual(isPortableAbsolutePath('\\\\.\\pipe\\faber'), false);
assert.strictEqual(isPortableAbsolutePath('\\\\?\\C:\\project'), false);
assert.strictEqual(isPortableAbsolutePath('\\\\??\\C:\\project'), false);
assert.strictEqual(isPortableAbsolutePath('\\\\server\\sha?re'), false);
assert.strictEqual(isPortableAbsolutePath('C:\\pro?ject'), false);
assert.strictEqual(isPortableAbsolutePath('//?/C:/project'), false);
assert.strictEqual(isPortableAbsolutePath('//server/share'), false);
assert.strictEqual(isPortableAbsolutePath('\\\\server\\share'), true);
assert.strictEqual(
  isPathInsideProjectRoot('\\\\Server\\Share', '\\\\server\\share\\project\\app'),
  true
);
assert.strictEqual(
  isPathInsideProjectRoot('\\\\server\\share', '\\\\server\\other\\project'),
  false
);
assert.strictEqual(areEquivalentPortablePaths('C:\\Project\\app', 'c:\\project\\APP'), true);
assert.strictEqual(areEquivalentPortablePaths('/Project/app', '/project/app'), false);

const executableRequest = createSandboxExecutionRequest({
  executionId: 'execution-1',
  requestId: 'request-1',
  grantId: 'grant-project-1',
  rootPath: '/workspace/project',
  realRootPath: '/private/workspace/project',
  cwd: '/workspace/project/packages/app',
  cwdRealPath: '/private/workspace/project/packages/app',
  command: {
    kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
    executable: 'npm',
    args: ['test'],
  },
  env: { NODE_ENV: 'test' },
  networkMode: SANDBOX_NETWORK_MODES.DISABLED,
  tempRoots: ['/private/tmp/faber-execution-1'],
  cacheRoots: ['/private/tmp/faber-cache-1'],
});
assert.strictEqual(executableRequest.schemaVersion, SANDBOX_EXECUTION_REQUEST_SCHEMA_VERSION);
assert.strictEqual(executableRequest.requestId, 'request-1');
assert.strictEqual(executableRequest.grantId, 'grant-project-1');
assert.strictEqual(executableRequest.realRootPath, '/private/workspace/project');
assert.strictEqual(executableRequest.cwdRealPath, '/private/workspace/project/packages/app');
assert.strictEqual(executableRequest.command.kind, 'executable');
assert.strictEqual(executableRequest.requiredFeatures.includes('network_isolation'), true);
assert.strictEqual(Object.isFrozen(executableRequest), true);
assert.strictEqual(Object.isFrozen(executableRequest.command), true);
assert.strictEqual(isSandboxExecutionRequest(executableRequest), true);
assert.deepStrictEqual(
  createSandboxExecutionRequest({
    ...executableRequest,
    executionId: 'execution-baseline-union',
    requiredFeatures: [],
  }).requiredFeatures,
  SANDBOX_A1_REQUIRED_FEATURES
);
assert.strictEqual(isSandboxExecutionRequest({ ...executableRequest, requiredFeatures: [] }), false);

const symlinkedProjectRequest = createSandboxExecutionRequest({
  executionId: 'execution-symlinked-project',
  requestId: 'request-symlinked-project',
  grantId: 'grant-symlinked-project',
  rootPath: '/workspace/project-link',
  realRootPath: '/srv/projects/project',
  cwd: '/workspace/project-link/packages/app',
  cwdRealPath: '/srv/projects/project/packages/app',
  command: { kind: SANDBOX_COMMAND_KINDS.EXECUTABLE, executable: 'npm', args: ['test'] },
});
assert.strictEqual(isSandboxExecutionRequest(symlinkedProjectRequest), true);

const shellRequest = createSandboxExecutionRequest({
  executionId: 'execution-2',
  requestId: 'request-2',
  grantId: 'grant-project-1',
  rootPath: 'C:\\workspace\\project',
  realRootPath: 'C:\\workspace\\project',
  cwd: 'C:\\workspace\\project\\app',
  command: {
    kind: SANDBOX_COMMAND_KINDS.SHELL,
    text: 'npm test && npm run build',
    shellPath: 'powershell.exe',
  },
});
assert.strictEqual(isSandboxExecutionRequest(shellRequest), true);

const sparseArgs = new Array(1);
const sparseRoots = new Array(1);
const sparseFeatures = new Array(1);
assert.strictEqual(isSandboxCommand({
  kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
  executable: 'npm',
  args: sparseArgs,
}), false);
assert.strictEqual(isSandboxExecutionRequest({ ...executableRequest, tempRoots: sparseRoots }), false);
assert.strictEqual(isSandboxExecutionRequest({ ...executableRequest, requiredFeatures: sparseFeatures }), false);
assert.strictEqual(isSandboxProbeResult({ ...enforced, features: sparseFeatures }), false);

for (const invalid of [
  { requestId: '' },
  { grantId: '' },
  { realRootPath: '' },
  { cwd: '/outside' },
  { cwdRealPath: '/outside/project' },
  { rootPath: '\\project' },
  { rootPath: 'C:project' },
  { rootPath: '\\\\?\\C:\\project' },
  { command: { kind: 'raw', text: 'npm test' } },
  { command: { kind: 'executable', executable: 'node', args: [], rawShell: true } },
  { tempRoots: ['relative-temp'] },
]) {
  assert.throws(() => createSandboxExecutionRequest({
    executionId: 'invalid-execution',
    requestId: 'request-invalid',
    grantId: 'grant-invalid',
    rootPath: '/workspace/project',
    realRootPath: '/workspace/project',
    cwd: '/workspace/project',
    command: { kind: SANDBOX_COMMAND_KINDS.EXECUTABLE, executable: 'node', args: [] },
    ...invalid,
  }), /execution request/);
}

async function run() {
  const backend = createUnsupportedSandboxBackend({ reason: 'Backend not installed.' });
  assert.strictEqual(assertSandboxBackend(backend), backend);
  assert.strictEqual(backend.securityModel, SANDBOX_BACKEND_SECURITY_MODEL);
  assert.strictEqual((await backend.probe()).state, SANDBOX_BACKEND_STATES.UNAVAILABLE);
  await assert.rejects(
    backend.execute(executableRequest),
    (error) => error instanceof SandboxUnavailableError && error.code === 'SANDBOX_UNAVAILABLE'
  );
  assert.deepStrictEqual(await backend.terminate('execution-1'), {
    ok: false,
    code: 'SANDBOX_UNAVAILABLE',
    message: 'Backend not installed.',
  });
  assert.throws(() => assertSandboxBackend({
    schemaVersion: SANDBOX_BACKEND_SCHEMA_VERSION,
    securityModel: SANDBOX_BACKEND_SECURITY_MODEL,
    id: 'missing-methods',
  }), /backend/);

  console.log('sandbox backend contract tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
