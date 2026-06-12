const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');

const { createProjectPreviewRuntimeService } = require('../main/services/project_preview_runtime_service');
const { createProjectPreviewReadinessService } = require('../main/services/project_preview_readiness_service');
const { createProjectPreviewService } = require('../main/services/project_preview_service');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeLocalBin(rootPath, name) {
  writeFile(path.join(rootPath, 'node_modules', '.bin', name), '#!/usr/bin/env node\n');
}

function writeInstalledPackage(rootPath, name) {
  writeJson(path.join(rootPath, 'node_modules', name, 'package.json'), { name });
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
    if (Array.isArray(args) && (args[0] === 'install' || args[0] === 'ci')) {
      const exitCode = Number.isInteger(config.installExitCode) ? config.installExitCode : 0;
      if (exitCode === 0 && config.installCreatesNodeModules !== false) {
        fs.mkdirSync(path.join(options.cwd, 'node_modules'), { recursive: true });
        writeLocalBin(options.cwd, 'next');
        writeLocalBin(options.cwd, 'vite');
        writeLocalBin(options.cwd, 'electron');
        try {
          const packageJson = JSON.parse(fs.readFileSync(path.join(options.cwd, 'package.json'), 'utf8'));
          const declared = {
            ...(packageJson.dependencies || {}),
            ...(packageJson.devDependencies || {}),
          };
          Object.keys(declared).forEach((dependencyName) => writeInstalledPackage(options.cwd, dependencyName));
        } catch {
          // Test fake only mirrors declared packages when package.json is readable.
        }
        writeJson(path.join(options.cwd, 'node_modules', 'ts-interface-checker', 'package.json'), {
          name: 'ts-interface-checker',
        });
        writeFile(path.join(options.cwd, 'node_modules', 'ts-interface-checker', 'dist', 'index.js'), 'require("./types");');
        writeFile(path.join(options.cwd, 'node_modules', 'ts-interface-checker', 'dist', 'types.js'), 'module.exports = {};');
      }
      setImmediate(() => child.emit('close', exitCode, null));
    }
    return child;
  };
  return { calls, children, spawn };
}

function createAlwaysAvailableNet() {
  return {
    createConnection: () => {
      const socket = new EventEmitter();
      socket.setTimeout = () => socket;
      socket.destroy = () => {};
      socket.end = () => {};
      setImmediate(() => socket.emit('connect'));
      return socket;
    },
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

function createNeverAvailableNet() {
  return {
    createConnection: () => {
      const socket = new EventEmitter();
      socket.setTimeout = () => socket;
      socket.destroy = () => {};
      socket.end = () => {};
      setImmediate(() => socket.emit('error', new Error('connection refused')));
      return socket;
    },
    createServer: createAlwaysAvailableNet().createServer,
  };
}

function createNetBackedReadinessService(net) {
  return {
    waitForPreviewReady: ({ session }) => new Promise((resolve) => {
      const socket = net.createConnection({ port: session.port, host: '127.0.0.1' });
      socket.setTimeout = socket.setTimeout || (() => socket);
      socket.destroy = socket.destroy || (() => {});
      socket.once('connect', () => resolve({
        ok: true,
        ready: true,
        message: `Preview respondendo em ${session.url}.`,
        probe: { type: 'tcp-test', url: session.url, port: session.port },
      }));
      socket.once('error', () => resolve({
        ok: false,
        ready: false,
        message: `Preview não respondeu em ${session.url}.`,
        probe: { type: 'tcp-test', url: session.url, port: session.port },
      }));
    }),
  };
}

function createFakeHttpSequence(statusCodes = []) {
  const calls = [];
  const http = {
    request: (url, options, callback) => {
      const request = new EventEmitter();
      request.end = () => {
        calls.push({ url, options });
        const response = new EventEmitter();
        response.statusCode = statusCodes[Math.min(calls.length - 1, statusCodes.length - 1)] || 200;
        response.setEncoding = () => response;
        setImmediate(() => {
          callback(response);
          setImmediate(() => {
            response.emit('data', '<html><body>ok</body></html>');
            response.emit('end');
          });
        });
      };
      request.destroy = (error) => {
        if (error) setImmediate(() => request.emit('error', error));
      };
      return request;
    },
  };
  return { calls, http };
}

function createRuntime(spawn, net = createAlwaysAvailableNet(), processEnv = {}, previewReadinessService = null) {
  const previewService = createProjectPreviewService({ fs, path });
  return createProjectPreviewRuntimeService({
    buildProjectPreviewPlan: previewService.buildProjectPreviewPlan,
    fs,
    net,
    path,
    previewReadinessService: previewReadinessService || createNetBackedReadinessService(net),
    processEnv,
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
  writeLocalBin(rootPath, 'next');

  const { spawn, calls, children } = createFakeSpawn();
  const runtime = createRuntime(spawn);

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json'], ['Next.js']), {
    port: 41231,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.session.mode, 'server');
  assert.strictEqual(result.session.status, 'ready');
  assert.strictEqual(result.session.url, 'http://127.0.0.1:41231/');
  assert.strictEqual(result.readiness.probe.type, 'tcp-test');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].bin, 'npm');
  assert.deepStrictEqual(calls[0].args, ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '41231']);
  assert.strictEqual(calls[0].options.cwd, rootPath);
  assert.strictEqual(calls[0].options.env.PORT, '41231');
  assert.strictEqual(calls[0].options.env.HOST, '127.0.0.1');
  assert.strictEqual(calls[0].options.env.FABER_PREVIEW_PORT, '41231');
  assert.strictEqual(calls[0].options.env.FABER_PREVIEW_HOST, '127.0.0.1');
  assert.strictEqual(calls[0].options.shell, false);

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

async function testHttpReadinessRetriesUntilHttpReady() {
  const fake = createFakeHttpSequence([503, 200]);
  const readiness = createProjectPreviewReadinessService({
    http: fake.http,
    https: fake.http,
    net: createNeverAvailableNet(),
  });

  const result = await readiness.waitForPreviewReady({
    session: {
      status: 'starting',
      url: 'http://127.0.0.1:41238/',
      port: 41238,
    },
    options: {
      readyTimeoutMs: 120,
      readyPollIntervalMs: 1,
      readyProbeTimeoutMs: 5,
    },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.ready, true);
  assert.strictEqual(result.probe.type, 'http');
  assert.strictEqual(result.probe.statusCode, 200);
  assert.strictEqual(fake.calls.length, 2);
}

async function testServerPreviewFailsWhenPortNeverResponds(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-not-ready');
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
  writeLocalBin(rootPath, 'next');

  const { spawn, calls, children } = createFakeSpawn();
  const runtime = createRuntime(spawn, createNeverAvailableNet());

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json'], ['Next.js']), {
    port: 41235,
    readyTimeoutMs: 20,
    readyPollIntervalMs: 1,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.started, false);
  assert.strictEqual(result.session.status, 'failed');
  assert.match(result.message, /não respondeu/i);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(children[0].killedSignal, 'SIGTERM');

  const status = runtime.getProjectPreviewRuntimeStatus({ rootPath });
  assert.strictEqual(status.running, false);
}

async function testServerPreviewFailureIncludesRuntimeOutput(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-http-500-runtime-output');
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
  writeLocalBin(rootPath, 'next');

  const { spawn, calls, children } = createFakeSpawn();
  const runtime = createRuntime(spawn, createAlwaysAvailableNet(), {}, {
    waitForPreviewReady: () => {
      children[0].stderr.write("Error: Cannot find module './types'\n");
      return Promise.resolve({
        ok: false,
        ready: false,
        message: 'Preview HTTP respondeu com status 500.',
        probe: { type: 'http', statusCode: 500 },
      });
    },
  });

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json'], ['Next.js']), {
    port: 41242,
    readyTimeoutMs: 20,
    readyPollIntervalMs: 1,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(calls.length, 1);
  assert.match(result.message, /status 500/);
  assert.match(result.message, /Cannot find module '\.\/types'/);
  assert.match(result.session.stderr, /Cannot find module '\.\/types'/);
}

async function testNextPreviewBlocksDependencyInstallWithoutExplicitOptIn(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-install-blocked');
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

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.started, false);
  assert.strictEqual(result.install, null);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(fs.existsSync(path.join(rootPath, 'node_modules')), false);
}

async function testNextPreviewInstallsDependenciesAndStartsWhenExplicitlyEnabled(tempRoot) {
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
    autoInstallDependencies: true,
    port: 41232,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.started, true);
  assert.strictEqual(result.install.ok, true);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].bin, 'npm');
  assert.deepStrictEqual(calls[0].args, ['install']);
  assert.strictEqual(calls[0].options.shell, false);
  assert.strictEqual(calls[1].bin, 'npm');
  assert.deepStrictEqual(calls[1].args, ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '41232']);
  assert.strictEqual(calls[1].options.shell, false);
  assert.strictEqual(result.session.url, 'http://127.0.0.1:41232/');
}

async function testNextPreviewRepairsPartialNodeModulesBeforeStarting(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-partial-auto-install');
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

  const { spawn, calls } = createFakeSpawn();
  const runtime = createRuntime(spawn);

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json'], ['Next.js']), {
    autoInstallDependencies: true,
    port: 41236,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.started, true);
  assert.strictEqual(result.install.ok, true);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[0].args, ['install']);
  assert.deepStrictEqual(calls[1].args, ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '41236']);
}

async function testNextPreviewInstallsMissingDeclaredImportBeforeStarting(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-missing-declared-import-auto-install');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      clsx: '^2.1.1',
    },
  });
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });
  writeLocalBin(rootPath, 'next');
  writeInstalledPackage(rootPath, 'next');
  writeInstalledPackage(rootPath, 'react');
  writeInstalledPackage(rootPath, 'react-dom');
  writeFile(path.join(rootPath, 'app/page.tsx'), 'import { clsx } from "clsx";\nexport default function Page() { return <main className={clsx("ok")} />; }\n');

  const { spawn, calls } = createFakeSpawn();
  const runtime = createRuntime(spawn);

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json', 'app/page.tsx'], ['Next.js']), {
    autoInstallDependencies: true,
    port: 41244,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.started, true);
  assert.strictEqual(result.install.ok, true);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[0].args, ['install']);
  assert.deepStrictEqual(calls[1].args, ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '41244']);
}

async function testNextPreviewForceInstallsBrokenPackageBeforeStarting(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-broken-package-auto-install');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
      tailwindcss: '^3.4.0',
    },
  });
  writeJson(path.join(rootPath, 'package-lock.json'), { lockfileVersion: 3, packages: {} });
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });
  writeLocalBin(rootPath, 'next');
  writeJson(path.join(rootPath, 'node_modules', 'ts-interface-checker', 'package.json'), {
    name: 'ts-interface-checker',
  });
  writeFile(path.join(rootPath, 'node_modules', 'ts-interface-checker', 'dist', 'index.js'), 'require("./types");');

  const { spawn, calls } = createFakeSpawn();
  const runtime = createRuntime(spawn);

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json'], ['Next.js']), {
    autoInstallDependencies: true,
    port: 41243,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.started, true);
  assert.strictEqual(result.install.ok, true);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[0].args, ['ci']);
  assert.deepStrictEqual(calls[1].args, ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', '41243']);
}

async function testNextPreviewUsesProjectNvmrcRuntime(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-nvmrc-runtime');
  const homeRoot = path.join(tempRoot, 'home');
  const nodeBin = path.join(homeRoot, '.nvm', 'versions', 'node', 'v24.15.0', 'bin');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });
  writeFile(path.join(rootPath, '.nvmrc'), '24.15.0\n');
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });
  fs.mkdirSync(nodeBin, { recursive: true });
  writeLocalBin(rootPath, 'next');

  const { spawn, calls } = createFakeSpawn();
  const runtime = createRuntime(spawn, createAlwaysAvailableNet(), {
    HOME: homeRoot,
    PATH: '/legacy/bin',
  });

  const result = await runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json', '.nvmrc'], ['Next.js']), {
    port: 41237,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].bin, 'npm');
  assert.ok(calls[0].options.env.PATH.startsWith(`${nodeBin}:`));
  assert.strictEqual(calls[0].options.env.NVM_BIN, nodeBin);
  assert.strictEqual(calls[0].options.env.FABER_NODE_VERSION, 'v24.15.0');
  assert.strictEqual(calls[0].options.env.PORT, '41237');
  assert.strictEqual(calls[0].options.env.FABER_PREVIEW_PORT, '41237');
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
    autoInstallDependencies: true,
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
  writeLocalBin(rootPath, 'electron');
  writeInstalledPackage(rootPath, 'electron');

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

async function testServerPreviewAttachesToTerminalStartedServer(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-terminal-attach');
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
    attachToExistingServer: true,
    port: 41236,
    readyTimeoutMs: 20,
    readyPollIntervalMs: 1,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.attached, true);
  assert.strictEqual(result.session.mode, 'server');
  assert.strictEqual(result.session.status, 'ready');
  assert.strictEqual(result.session.url, 'http://127.0.0.1:41236/');
  assert.strictEqual(calls.length, 0);

  const status = runtime.getProjectPreviewRuntimeStatus({ rootPath });
  assert.strictEqual(status.running, true);
  assert.strictEqual(status.session.id, result.session.id);
}

async function testServerPreviewReusesActiveSessionForCapture(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-session-reuse');
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
  writeLocalBin(rootPath, 'next');

  const { spawn, calls } = createFakeSpawn();
  const runtime = createRuntime(spawn);
  const projectInfo = createProjectInfo(rootPath, ['package.json'], ['Next.js']);

  const first = await runtime.startProjectPreview(projectInfo, { port: 41239 });
  const reused = await runtime.startProjectPreview(projectInfo, {
    port: 41240,
    reuseActiveSession: true,
    reuseSessionTimeoutMs: 20,
    reuseSessionPollIntervalMs: 1,
  });

  assert.strictEqual(first.ok, true);
  assert.strictEqual(reused.ok, true);
  assert.strictEqual(reused.reused, true);
  assert.strictEqual(reused.started, false);
  assert.strictEqual(reused.session.id, first.session.id);
  assert.strictEqual(reused.session.url, 'http://127.0.0.1:41239/');
  assert.strictEqual(calls.length, 1);
}

async function testPreferExistingServerAttachesBeforeInstallOrSpawn(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-existing-server');
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
    preferExistingServer: true,
    existingServerTimeoutMs: 20,
    existingServerPollIntervalMs: 1,
    port: 41241,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.attached, true);
  assert.strictEqual(result.session.status, 'ready');
  assert.strictEqual(result.session.url, 'http://127.0.0.1:41241/');
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(fs.existsSync(path.join(rootPath, 'node_modules')), false);
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
  writeLocalBin(rootPath, 'vite');

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

async function testServerPreviewAbortStopsProcess(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-abort');
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
  writeLocalBin(rootPath, 'next');

  const { spawn, calls, children } = createFakeSpawn();
  const controller = new AbortController();
  const runtime = createRuntime(spawn, createAlwaysAvailableNet(), {}, {
    waitForPreviewReady: ({ options }) => new Promise((resolve) => {
      options.signal.addEventListener('abort', () => {
        resolve({
          ok: false,
          ready: false,
          message: 'Preview cancelado durante readiness.',
        });
      }, { once: true });
    }),
  });

  const previewPromise = runtime.startProjectPreview(createProjectInfo(rootPath, ['package.json'], ['Next.js']), {
    port: 41243,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 5);
  const result = await previewPromise;

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.cancelled, true);
  assert.strictEqual(children[0].killedSignal, 'SIGTERM');
  assert.strictEqual(calls[0].options.detached, process.platform !== 'win32');
  assert.strictEqual(runtime.getProjectPreviewRuntimeStatus({ rootPath }).running, false);
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-runtime-test-'));
  try {
    await testStaticPreviewCreatesReadySession(tempRoot);
    await testHttpReadinessRetriesUntilHttpReady();
    await testServerPreviewSpawnsCommandAndStops(tempRoot);
    await testNextPreviewBlocksDependencyInstallWithoutExplicitOptIn(tempRoot);
    await testNextPreviewInstallsDependenciesAndStartsWhenExplicitlyEnabled(tempRoot);
    await testNextPreviewRepairsPartialNodeModulesBeforeStarting(tempRoot);
    await testNextPreviewInstallsMissingDeclaredImportBeforeStarting(tempRoot);
    await testNextPreviewForceInstallsBrokenPackageBeforeStarting(tempRoot);
    await testNextPreviewUsesProjectNvmrcRuntime(tempRoot);
    await testDependencyInstallFailureDoesNotStartServer(tempRoot);
    await testElectronAppPreviewSpawnsWithoutPortProbe(tempRoot);
    await testServerPreviewAttachesToTerminalStartedServer(tempRoot);
    await testServerPreviewReusesActiveSessionForCapture(tempRoot);
    await testPreferExistingServerAttachesBeforeInstallOrSpawn(tempRoot);
    await testStartingNewPreviewStopsPrevious(tempRoot);
    await testServerPreviewAbortStopsProcess(tempRoot);
    await testServerPreviewFailureIncludesRuntimeOutput(tempRoot);
    await testServerPreviewFailsWhenPortNeverResponds(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('project-preview-runtime-service.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
