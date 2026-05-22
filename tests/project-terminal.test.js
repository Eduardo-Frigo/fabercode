const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { registerTerminalHandlers } = require('../main/ipc/terminal_handlers');
const { createProjectTerminalService } = require('../main/services/project_terminal_service');

function createFakeSpawn(calls) {
  return (bin, args, options) => {
    calls.push({ bin, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killedWith = null;
    child.kill = (signal) => {
      child.killedWith = signal;
      child.emit('close', null, signal);
      return true;
    };
    setImmediate(() => {
      child.stdout.emit('data', 'ok\n');
      child.emit('close', 0, null);
    });
    return child;
  };
}

function createHandlerMap() {
  const handlers = {};
  return {
    handlers,
    registerIpcHandler: (channel, handler) => {
      handlers[channel] = handler;
    },
  };
}

async function waitFor(predicate, timeoutMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-terminal-'));
  const projectRoot = path.join(tempRoot, 'project');
  const srcRoot = path.join(projectRoot, 'src');
  const homeRoot = path.join(tempRoot, 'home');
  const nodeBin = path.join(homeRoot, '.nvm', 'versions', 'node', 'v24.15.0', 'bin');
  fs.mkdirSync(srcRoot, { recursive: true });
  fs.mkdirSync(nodeBin, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.nvmrc'), '24.15.0\n', 'utf8');

  const calls = [];
  const events = [];
  const service = createProjectTerminalService({
    fs,
    path,
    spawn: createFakeSpawn(calls),
    processEnv: { SHELL: '/bin/zsh', HOME: homeRoot, PATH: '/legacy/bin', npm_config_metrics_registry: 'legacy' },
    now: () => '2026-05-16T00:00:00.000Z',
    idFactory: () => 'abc123',
  });

  const created = service.createSession({
    rootPath: projectRoot,
    realRootPath: fs.realpathSync(projectRoot),
    name: 'Dev',
  });
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.session.cwd, '.');
  assert.ok(created.session.output.includes('Sessão iniciada'));

  const cdResult = service.runCommand({
    rootPath: projectRoot,
    sessionId: created.session.id,
    command: 'cd src',
    sendEvent: (event) => events.push(event),
  });
  assert.strictEqual(cdResult.ok, true);
  assert.strictEqual(cdResult.session.cwd, 'src');

  const blockedCd = service.runCommand({
    rootPath: projectRoot,
    sessionId: created.session.id,
    command: 'cd ../..',
    sendEvent: (event) => events.push(event),
  });
  assert.strictEqual(blockedCd.ok, false);
  assert.match(blockedCd.message, /raiz do projeto/);

  const runResult = service.runCommand({
    rootPath: projectRoot,
    sessionId: created.session.id,
    command: 'npm test',
    sendEvent: (event) => events.push(event),
  });
  assert.strictEqual(runResult.ok, true);
  assert.strictEqual(runResult.started, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].options.cwd, srcRoot);
  assert.strictEqual(calls[0].args[0], '-lc');
  assert.ok(calls[0].args[1].includes(`export PATH='${nodeBin}':$PATH`));
  assert.ok(calls[0].args[1].endsWith('; npm test'));
  assert.strictEqual(calls[0].options.env.npm_config_metrics_registry, undefined);
  assert.ok(calls[0].options.env.PATH.startsWith(`${nodeBin}:`));

  await waitFor(() => events.some((event) => event.type === 'finished'));
  const refreshed = service.getSession(created.session.id);
  assert.strictEqual(refreshed.ok, true);
  assert.ok(refreshed.session.output.includes('ok'));
  assert.ok(refreshed.session.output.includes('[exit 0]'));

  const dangerous = service.runCommand({
    rootPath: projectRoot,
    sessionId: created.session.id,
    command: 'sudo npm install',
  });
  assert.strictEqual(dangerous.ok, false);
  assert.match(dangerous.message, /sudo/);

  const { handlers, registerIpcHandler } = createHandlerMap();
  const audit = [];
  const ipcEvents = [];
  const ipcService = createProjectTerminalService({
    fs,
    path,
    spawn: createFakeSpawn([]),
    now: () => '2026-05-16T00:00:00.000Z',
    idFactory: () => 'ipc001',
  });
  registerTerminalHandlers({
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    authorizeProjectRoot: (rootPath) =>
      path.resolve(String(rootPath || '')) === projectRoot
        ? { ok: true, rootPath: projectRoot, realRootPath: fs.realpathSync(projectRoot) }
        : { ok: false, message: 'não autorizado' },
    registerIpcHandler,
    terminalService: ipcService,
  });

  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'project:terminal:clear',
    'project:terminal:close',
    'project:terminal:create',
    'project:terminal:list',
    'project:terminal:run',
    'project:terminal:stop',
  ]);

  const ipcEvent = {
    sender: {
      send: (channel, payload) => ipcEvents.push({ channel, payload }),
      isDestroyed: () => false,
    },
  };
  const ipcCreated = handlers['project:terminal:create'](ipcEvent, { rootPath: projectRoot });
  assert.strictEqual(ipcCreated.ok, true);
  const ipcRun = handlers['project:terminal:run'](ipcEvent, {
    rootPath: projectRoot,
    sessionId: ipcCreated.session.id,
    command: 'echo ok',
  });
  assert.strictEqual(ipcRun.ok, true);
  await waitFor(() => ipcEvents.some((entry) => entry.payload.type === 'finished'));
  assert.ok(ipcEvents.every((entry) => entry.channel === 'project:terminal:event'));
  assert.ok(audit.some((entry) => entry.type === 'project.terminal_command'));

  const unauthorized = handlers['project:terminal:list'](ipcEvent, { rootPath: path.join(tempRoot, 'other') });
  assert.strictEqual(unauthorized.ok, false);

  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log('project-terminal.test.js: ok');
})();
