const { EventEmitter } = require('events');
const { createProjectNodeRuntimeService } = require('./project_node_runtime_service');

const MAX_COMMAND_CHARS = 2200;
const MAX_OUTPUT_CHARS = 120000;

function createProjectTerminalService(dependencies = {}) {
  const {
    fs,
    path,
    spawn,
    processEnv = process.env,
    nodeRuntimeService = createProjectNodeRuntimeService({ fs, path, processEnv }),
    platform = process.platform,
    now = () => new Date().toISOString(),
    idFactory = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Project terminal dependency missing: ${name}`);
  }

  requireDependency('fs', fs);
  requireDependency('path', path);
  requireDependency('spawn', spawn);

  const sessions = new Map();

  function resolvePath(value) {
    return path.resolve(String(value || ''));
  }

  function isInsideRoot(rootPath, candidatePath) {
    const root = resolvePath(rootPath);
    const candidate = resolvePath(candidatePath);
    return candidate === root || candidate.startsWith(root + path.sep);
  }

  function getRealPathIfExists(candidatePath) {
    try {
      return fs.realpathSync(candidatePath);
    } catch {
      return '';
    }
  }

  function normalizeRoot(rawRootPath, rawRealRootPath) {
    const rootPath = resolvePath(rawRootPath);
    const realRootPath = rawRealRootPath ? resolvePath(rawRealRootPath) : getRealPathIfExists(rootPath);
    if (!rootPath || !realRootPath || !fs.existsSync(rootPath)) {
      return { ok: false, message: 'Projeto não está acessível no disco.' };
    }
    return { ok: true, rootPath, realRootPath };
  }

  function formatCwd(session) {
    const relative = path.relative(session.rootPath, session.cwd);
    if (!relative) return '.';
    return relative.split(path.sep).join('/');
  }

  function trimOutput(session) {
    if (session.output.length > MAX_OUTPUT_CHARS) {
      session.output = session.output.slice(session.output.length - MAX_OUTPUT_CHARS);
    }
  }

  function buildProjectProcessEnv(rootPath, extraEnv = {}) {
    if (nodeRuntimeService && typeof nodeRuntimeService.buildEnv === 'function') {
      return nodeRuntimeService.buildEnv(rootPath, extraEnv).env;
    }
    const env = { ...processEnv, ...extraEnv };
    delete env.npm_config_metrics_registry;
    delete env.NPM_CONFIG_METRICS_REGISTRY;
    return env;
  }

  function serializeSession(session) {
    return {
      id: session.id,
      name: session.name,
      rootPath: session.rootPath,
      cwd: formatCwd(session),
      absoluteCwd: session.cwd,
      status: session.child ? 'running' : 'idle',
      output: session.output,
      lastCommand: session.lastCommand,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  function emit(sendEvent, type, session, payload = {}) {
    if (typeof sendEvent !== 'function') return;
    sendEvent({
      type,
      sessionId: session.id,
      session: serializeSession(session),
      ...payload,
    });
  }

  function appendOutput(session, text, stream, sendEvent) {
    const chunk = String(text || '');
    if (!chunk) return;
    session.output += chunk;
    session.updatedAt = now();
    trimOutput(session);
    emit(sendEvent, 'output', session, { chunk, stream: stream || 'stdout' });
  }

  function appendSystemLine(session, text, sendEvent) {
    appendOutput(session, `${text}\n`, 'system', sendEvent);
  }

  function createSession(input = {}) {
    const normalized = normalizeRoot(input.rootPath, input.realRootPath);
    if (!normalized.ok) return { ...normalized, session: null };

    const id = `term-${idFactory()}`;
    const timestamp = now();
    const session = {
      id,
      name: String(input.name || '').trim() || `Terminal ${sessions.size + 1}`,
      rootPath: normalized.rootPath,
      realRootPath: normalized.realRootPath,
      cwd: normalized.rootPath,
      previousCwd: normalized.rootPath,
      output: '',
      lastCommand: '',
      createdAt: timestamp,
      updatedAt: timestamp,
      child: null,
    };
    appendSystemLine(session, `Sessão iniciada em ${formatCwd(session)}`);
    sessions.set(id, session);
    return { ok: true, session: serializeSession(session) };
  }

  function listSessions(input = {}) {
    const normalized = normalizeRoot(input.rootPath, input.realRootPath);
    if (!normalized.ok) return { ...normalized, sessions: [] };
    return {
      ok: true,
      sessions: [...sessions.values()]
        .filter((session) => session.rootPath === normalized.rootPath)
        .map(serializeSession),
    };
  }

  function getSession(sessionId) {
    const session = sessions.get(String(sessionId || ''));
    if (!session) return { ok: false, message: 'Terminal não encontrado.' };
    return { ok: true, session };
  }

  function getSerializedSession(sessionId) {
    const found = getSession(sessionId);
    if (!found.ok) return { ...found, session: null };
    return { ok: true, session: serializeSession(found.session) };
  }

  function getSessionForRoot(sessionId, rootPath) {
    const found = getSession(sessionId);
    if (!found.ok) return found;
    const root = resolvePath(rootPath);
    if (found.session.rootPath !== root) {
      return { ok: false, message: 'Terminal não pertence ao projeto selecionado.' };
    }
    return found;
  }

  function normalizeCommand(command) {
    const value = String(command || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (value.includes('\0')) return { ok: false, message: 'Comando inválido.' };
    const trimmed = value.trim();
    if (!trimmed) return { ok: false, message: 'Comando vazio.' };
    if (trimmed.length > MAX_COMMAND_CHARS) return { ok: false, message: 'Comando muito longo.' };
    return { ok: true, command: trimmed };
  }

  function stripSimpleQuotes(value) {
    const trimmed = String(value || '').trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  function resolveProjectCwd(session, rawTarget) {
    const target = stripSimpleQuotes(rawTarget || '');
    const nextPath = !target || target === '~'
      ? session.rootPath
      : target === '-'
        ? session.previousCwd
        : path.resolve(path.isAbsolute(target) ? target : path.join(session.cwd, target));

    if (!isInsideRoot(session.rootPath, nextPath)) {
      return { ok: false, message: 'O terminal permanece preso à raiz do projeto.' };
    }
    if (!fs.existsSync(nextPath) || !fs.statSync(nextPath).isDirectory()) {
      return { ok: false, message: 'Diretório não encontrado.' };
    }
    const realPath = getRealPathIfExists(nextPath);
    if (!realPath || !isInsideRoot(session.realRootPath, realPath)) {
      return { ok: false, message: 'Diretório físico fora da raiz do projeto.' };
    }
    return { ok: true, cwd: path.resolve(nextPath) };
  }

  function handleBuiltin(session, command, sendEvent) {
    if (command === 'clear') {
      session.output = '';
      session.updatedAt = now();
      emit(sendEvent, 'cleared', session);
      return { handled: true, result: { ok: true, session: serializeSession(session) } };
    }
    if (command === 'pwd') {
      appendSystemLine(session, formatCwd(session), sendEvent);
      return { handled: true, result: { ok: true, session: serializeSession(session) } };
    }
    if (/^cd(?:\s+(.+))?$/.test(command)) {
      const target = command.match(/^cd(?:\s+(.+))?$/)[1] || '';
      const resolved = resolveProjectCwd(session, target);
      if (!resolved.ok) {
        appendSystemLine(session, resolved.message, sendEvent);
        return { handled: true, result: { ...resolved, session: serializeSession(session) } };
      }
      session.previousCwd = session.cwd;
      session.cwd = resolved.cwd;
      session.updatedAt = now();
      appendSystemLine(session, formatCwd(session), sendEvent);
      emit(sendEvent, 'cwd-changed', session);
      return { handled: true, result: { ok: true, session: serializeSession(session) } };
    }
    return { handled: false };
  }

  function assessCommandRisk(command) {
    const normalized = String(command || '').trim();
    if (/^sudo\b/.test(normalized)) {
      return { ok: false, message: 'Comandos com sudo não são executados dentro do Faber Code.' };
    }
    if (/\brm\s+-(?:[^\s-]*r[^\s-]*f|[^\s-]*f[^\s-]*r|rf|fr)\s+(?:\/|~|\$HOME)(?:\s|$)/.test(normalized)) {
      return { ok: false, message: 'Comando destrutivo fora do projeto bloqueado.' };
    }
    return { ok: true };
  }

  function getShellCommand(command, session) {
    const resolved = platform !== 'win32' && nodeRuntimeService && typeof nodeRuntimeService.buildShellCommand === 'function'
      ? nodeRuntimeService.buildShellCommand(session.rootPath, command)
      : { command };
    const shellCommand = resolved.command || command;
    if (platform === 'win32') {
      return {
        bin: processEnv.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', shellCommand],
      };
    }
    return {
      bin: processEnv.SHELL || '/bin/zsh',
      args: ['-lc', shellCommand],
    };
  }

  function runCommand(input = {}) {
    const found = getSessionForRoot(input.sessionId, input.rootPath);
    if (!found.ok) return { ...found, session: null };
    const { session } = found;
    if (session.child) {
      return { ok: false, message: 'Já existe um comando em execução neste terminal.', session: serializeSession(session) };
    }

    const normalized = normalizeCommand(input.command);
    if (!normalized.ok) return { ...normalized, session: serializeSession(session) };

    const sendEvent = input.sendEvent;
    const command = normalized.command;
    appendOutput(session, `$ ${command}\n`, 'prompt', sendEvent);

    const builtin = handleBuiltin(session, command, sendEvent);
    if (builtin.handled) return builtin.result;

    const risk = assessCommandRisk(command);
    if (!risk.ok) {
      appendSystemLine(session, risk.message, sendEvent);
      return { ...risk, session: serializeSession(session) };
    }

    const shellCommand = getShellCommand(command, session);
    let child;
    try {
      child = spawn(shellCommand.bin, shellCommand.args, {
        cwd: session.cwd,
        env: buildProjectProcessEnv(session.rootPath, { FORCE_COLOR: processEnv.FORCE_COLOR || '1' }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      appendSystemLine(session, `Falha ao iniciar comando: ${error.message}`, sendEvent);
      return { ok: false, message: error.message, session: serializeSession(session) };
    }

    if (!child.stdout) child.stdout = new EventEmitter();
    if (!child.stderr) child.stderr = new EventEmitter();
    session.child = child;
    session.lastCommand = command;
    session.updatedAt = now();
    emit(sendEvent, 'started', session, { command });

    child.stdout.on('data', (chunk) => {
      appendOutput(session, chunk.toString(), 'stdout', sendEvent);
    });

    child.stderr.on('data', (chunk) => {
      appendOutput(session, chunk.toString(), 'stderr', sendEvent);
    });

    child.on('error', (error) => {
      appendSystemLine(session, `Falha no comando: ${error.message}`, sendEvent);
    });

    child.on('close', (code, signal) => {
      if (session.child === child) session.child = null;
      const suffix = signal ? `signal ${signal}` : `exit ${Number.isInteger(code) ? code : 'n/a'}`;
      appendSystemLine(session, `[${suffix}]`, sendEvent);
      emit(sendEvent, 'finished', session, { code, signal: signal || null });
    });

    return { ok: true, started: true, session: serializeSession(session) };
  }

  function stopCommand(input = {}) {
    const found = getSessionForRoot(input.sessionId, input.rootPath);
    if (!found.ok) return { ...found, session: null };
    const { session } = found;
    if (!session.child) return { ok: true, stopped: false, session: serializeSession(session) };
    const child = session.child;
    try {
      child.kill('SIGTERM');
    } catch {}
    appendSystemLine(session, '[interrompido]', input.sendEvent);
    return { ok: true, stopped: true, session: serializeSession(session) };
  }

  function clearSession(input = {}) {
    const found = getSessionForRoot(input.sessionId, input.rootPath);
    if (!found.ok) return { ...found, session: null };
    found.session.output = '';
    found.session.updatedAt = now();
    emit(input.sendEvent, 'cleared', found.session);
    return { ok: true, session: serializeSession(found.session) };
  }

  function closeSession(input = {}) {
    const found = getSessionForRoot(input.sessionId, input.rootPath);
    if (!found.ok) return found;
    if (found.session.child) {
      try {
        found.session.child.kill('SIGTERM');
      } catch {}
    }
    sessions.delete(found.session.id);
    return { ok: true, closed: true, sessionId: found.session.id };
  }

  function stopAllSessions() {
    for (const session of sessions.values()) {
      if (!session.child) continue;
      try {
        session.child.kill('SIGTERM');
      } catch {}
      session.child = null;
    }
    return { ok: true, stopped: true };
  }

  return {
    clearSession,
    closeSession,
    createSession,
    getSession: getSerializedSession,
    listSessions,
    runCommand,
    stopAllSessions,
    stopCommand,
  };
}

module.exports = {
  createProjectTerminalService,
};
