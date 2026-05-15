const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');

const { createProjectPreviewRuntimeService } = require('../main/services/project_preview_runtime_service');
const { createProjectPreviewService } = require('../main/services/project_preview_service');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createProjectInfo(rootPath, files, stacks) {
  return {
    rootPath,
    files,
    stacks,
    totalFiles: files.length,
    counters: {},
  };
}

function createFakeSpawn(config = {}) {
  const calls = [];
  const children = [];
  const spawn = (bin, args, options) => {
    const child = new EventEmitter();
    child.pid = 4321 + children.length;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      child.killedSignal = signal;
      child.emit('close', 0, signal);
      return true;
    };
    calls.push({ bin, args, options, child });
    children.push(child);
    if (Array.isArray(args) && args[0] === 'install') {
      const exitCode = Number.isInteger(config.installExitCode) ? config.installExitCode : 0;
      if (exitCode === 0 && config.installCreatesNodeModules !== false) {
        fs.mkdirSync(path.join(options.cwd, 'node_modules'), { recursive: true });
      }
      setImmediate(() => child.emit('close', exitCode, null));
    }
    return child;
  };
  return { calls, children, spawn };
}

function createAlwaysAvailableNet() {
  return {
    createServer: () => {
      const server = new EventEmitter();
      server.listen = () => {
        setImmediate(() => server.emit('listening'));
        return server;
      };
      server.close = (callback) => {
        setImmediate(() => {
          if (callback) callback();
        });
      };
      return server;
    },
  };
}

function createRuntime(spawn) {
  const previewService = createProjectPreviewService({ fs, path });
  return createProjectPreviewRuntimeService({
    buildProjectPreviewPlan: previewService.buildProjectPreviewPlan,
    net: createAlwaysAvailableNet(),
    processEnv: {},
    spawn,
  });
}

async function testStaticPreviewCreatesReadySession(tempRoot) {
  const rootPath = path.join(tempRoot, 'static');
  writeFile(path.join(rootPath, 'index.html'), '<h1>ok</h1>');
  const { spawn, calls } = createFakeSpawn();
  const runtime = createRuntime(spawn);

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['index.html'], ['Projeto generico']));

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.session.mode, 'file');
  assert.strictEqual(result.session.status, 'ready');
  assert.ok(result.session.url.startsWith('file://'));
  assert.strictEqual(calls.length, 0);

  const status = runtime.getProjectPreviewRuntimeStatus({ rootPath });
  assert.strictEqual(status.running, true);
  assert.strictEqual(status.session.id, result.session.id);
}

async function testServerPreviewSpawnsCommandAndStops(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-ready');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });

  const { spawn, calls, children } = createFakeSpawn();
  const runtime = createRuntime(spawn);

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json'], ['Next.js']), {
    port: 41231,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.session.mode, 'server');
  assert.strictEqual(result.session.status, 'running');
  assert.strictEqual(result.session.url, 'http://127.0.0.1:41231/');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].bin, 'npm');
  assert.deepStrictEqual(calls[0].args, ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '41231']);
  assert.strictEqual(calls[0].options.cwd, rootPath);

  children[0].stdout.write('ready on 41231');
  const afterOutput = runtime.getProjectPreviewRuntimeStatus({ rootPath });
  assert.ok(afterOutput.session.stdout.includes('ready'));

  const stopped = await runtime.stopProjectPreview({ rootPath });
  assert.strictEqual(stopped.ok, true);
  assert.strictEqual(stopped.stopped, true);
  assert.strictEqual(children[0].killedSignal, 'SIGTERM');

  const afterStop = runtime.getProjectPreviewRuntimeStatus({ rootPath });
  assert.strictEqual(afterStop.running, false);
}

async function testNextPreviewInstallsDependenciesAndStarts(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-auto-install');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });

  const { spawn, calls } = createFakeSpawn();
  const runtime = createRuntime(spawn);

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json'], ['Next.js']), {
    port: 41232,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.started, true);
  assert.strictEqual(result.install.ok, true);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].bin, 'npm');
  assert.deepStrictEqual(calls[0].args, ['install']);
  assert.strictEqual(calls[1].bin, 'npm');
  assert.deepStrictEqual(calls[1].args, ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '41232']);
  assert.strictEqual(result.session.url, 'http://127.0.0.1:41232/');
}

async function testDependencyInstallFailureDoesNotStartServer(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-install-fails');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });

  const { spawn, calls } = createFakeSpawn({ installExitCode: 1, installCreatesNodeModules: false });
  const runtime = createRuntime(spawn);

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json'], ['Next.js']), {
    port: 41232,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.started, false);
  assert.strictEqual(result.install.ok, false);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].args, ['install']);
}

async function testElectronAppPreviewSpawnsWithoutPortProbe(tempRoot) {
  const rootPath = path.join(tempRoot, 'electron-ready');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'electron .',
    },
    devDependencies: {
      electron: '^38.0.0',
    },
  });
  writeFile(path.join(rootPath, 'main.js'), 'require("electron");');
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });

  const { spawn, calls } = createFakeSpawn();
  const runtime = createRuntime(spawn);

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json', 'main.js'], ['Electron']));

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.session.mode, 'app');
  assert.strictEqual(result.session.url, null);
  assert.strictEqual(result.session.port, null);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].bin, 'npm');
  assert.deepStrictEqual(calls[0].args, ['run', 'dev']);
}

async function testStartingNewPreviewStopsPrevious(tempRoot) {
  const rootPath = path.join(tempRoot, 'react-ready');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'vite',
    },
    dependencies: {
      react: '^19.0.0',
      vite: '^7.0.0',
    },
  });
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });

  const { spawn, calls, children } = createFakeSpawn();
  const runtime = createRuntime(spawn);
  const projectInfo = createProjectInfo(rootPath, ['package.json'], ['React']);

  await runtime.startProjectPreview(projectInfo, { port: 41233 });
  await runtime.startProjectPreview(projectInfo, { port: 41234 });

  assert.strictEqual(calls.length, 2);
  assert.strictEqual(children[0].killedSignal, 'SIGTERM');
  const status = runtime.getProjectPreviewRuntimeStatus({ rootPath });
  assert.strictEqual(status.running, true);
  assert.strictEqual(status.session.url, 'http://127.0.0.1:41234/');
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-runtime-test-'));
  try {
    await testStaticPreviewCreatesReadySession(tempRoot);
    await testServerPreviewSpawnsCommandAndStops(tempRoot);
    await testNextPreviewInstallsDependenciesAndStarts(tempRoot);
    await testDependencyInstallFailureDoesNotStartServer(tempRoot);
    await testElectronAppPreviewSpawnsWithoutPortProbe(tempRoot);
    await testStartingNewPreviewStopsPrevious(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('project-preview-runtime-service.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
