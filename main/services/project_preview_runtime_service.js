const { spawn: defaultSpawn } = require('child_process');
const defaultNet = require('net');
const { createProjectNodeRuntimeService } = require('./project_node_runtime_service');
const { createProjectPreviewReadinessService } = require('./project_preview_readiness_service');

function createProjectPreviewRuntimeService(dependencies = {}) {
  const {
    buildProjectPreviewPlan,
    fs = null,
    net = defaultNet,
    path = null,
    nodeRuntimeService = createProjectNodeRuntimeService({ fs, path, processEnv: dependencies.processEnv || process.env }),
    processEnv = process.env,
    previewReadinessService = createProjectPreviewReadinessService({
      http: dependencies.http,
      https: dependencies.https,
      net,
    }),
    spawn = defaultSpawn,
  } = dependencies;

  if (typeof buildProjectPreviewPlan !== 'function') {
    throw new Error('Project preview runtime dependency missing: buildProjectPreviewPlan');
  }

  const sessionsById = new Map();
  const sessionsByRoot = new Map();

  function normalizeRootPath(projectInfo = {}) {
    return String(projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '').trim();
  }

  function createSessionId() {
    return `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function clipRuntimeOutput(value = '', maxChars = 5000) {
    const text = String(value || '');
    return text.length > maxChars ? text.slice(text.length - maxChars) : text;
  }

  function normalizeRuntimeOutput(value = '', maxChars = 1800) {
    return clipRuntimeOutput(value, maxChars)
      .replace(/\u001b\[[0-9;]*m/g, '')
      .replace(/\r/g, '')
      .trim();
  }

  function isAbortSignalAborted(signal = null) {
    return Boolean(signal && signal.aborted);
  }

  function killChildTree(child = null, killSignal = 'SIGTERM') {
    if (!child || !child.pid) return;
    try {
      if (process.platform !== 'win32') {
        process.kill(-child.pid, killSignal);
        return;
      }
    } catch {
      // Fall back to killing the direct child below.
    }
    try {
      child.kill(killSignal);
    } catch {
      // best effort cleanup
    }
  }

  function addAbortListener(signal = null, onAbort = null) {
    if (!signal || typeof onAbort !== 'function') return () => {};
    if (isAbortSignalAborted(signal)) {
      onAbort();
      return () => {};
    }
    if (typeof signal.addEventListener !== 'function') return () => {};
    signal.addEventListener('abort', onAbort, { once: true });
    return () => {
      if (typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    };
  }

  function buildPreviewFailureMessage(session = {}, readiness = null) {
    const baseMessage = String(readiness && readiness.message ? readiness.message : session.message || '').trim();
    const stderr = normalizeRuntimeOutput(session.stderr || '', 1800);
    const stdout = normalizeRuntimeOutput(session.stdout || '', 1200);
    const runtimeOutput = stderr || stdout;
    if (!runtimeOutput) return baseMessage || 'Preview não ficou pronto.';
    const outputLabel = stderr ? 'Saída de erro do servidor' : 'Saída do servidor';
    return [baseMessage || 'Preview não ficou pronto.', `${outputLabel}: ${runtimeOutput}`]
      .filter(Boolean)
      .join(' ');
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

  function buildPreviewProcessEnv(rootPath, plan = {}, extraEnv = {}) {
    const port = Number.parseInt(plan && plan.port ? plan.port : '0', 10);
    if (!port) return buildProjectProcessEnv(rootPath, extraEnv);

    return buildProjectProcessEnv(rootPath, {
      ...extraEnv,
      HOST: extraEnv.HOST || '127.0.0.1',
      PORT: String(port),
      FABER_PREVIEW_HOST: '127.0.0.1',
      FABER_PREVIEW_PORT: String(port),
    });
  }

  function summarizeSession(session) {
    if (!session) {
      return {
        ok: true,
        running: false,
        session: null,
        message: 'Nenhum preview ativo para este projeto.',
      };
    }

    return {
      ok: true,
      running: ['ready', 'starting', 'running'].includes(session.status),
      session: {
        id: session.id,
        rootPath: session.rootPath,
        mode: session.mode,
        stack: session.stack,
        status: session.status,
        url: session.url,
        port: session.port || null,
        pid: session.pid || null,
        commandText: session.commandText || '',
        startedAt: session.startedAt,
        stoppedAt: session.stoppedAt || null,
        exitCode: session.exitCode,
        signal: session.signal,
        stdout: session.stdout || '',
        stderr: session.stderr || '',
        message: session.message || '',
      },
    };
  }

  function findSession(payload = {}) {
    const sessionId = payload && payload.sessionId ? String(payload.sessionId) : '';
    if (sessionId && sessionsById.has(sessionId)) return sessionsById.get(sessionId);
    const rootPath = String(payload && payload.rootPath ? payload.rootPath : '').trim();
    if (rootPath && sessionsByRoot.has(rootPath)) return sessionsByRoot.get(rootPath);
    return null;
  }

  async function isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
  }

  async function findAvailablePort(preferredPort, maxAttempts = 20) {
    const basePort = Number.parseInt(preferredPort || '0', 10);
    if (!basePort || basePort < 1 || basePort > 65535) return null;

    for (let offset = 0; offset < maxAttempts; offset += 1) {
      const candidate = basePort + offset;
      if (candidate > 65535) break;
      if (await isPortAvailable(candidate)) return candidate;
    }
    return null;
  }

  async function waitForServerReady(session, options = {}) {
    if (!previewReadinessService || typeof previewReadinessService.waitForPreviewReady !== 'function') {
      return { ok: true, ready: false, message: 'Serviço de prontidão de preview indisponível.' };
    }
    return previewReadinessService.waitForPreviewReady({ session, options });
  }

  function isRunningPreviewStatus(status = '') {
    return ['ready', 'starting', 'running'].includes(String(status || ''));
  }

  async function reuseActivePreviewSession(projectInfo, options = {}) {
    if (options.reuseActiveSession !== true) return null;
    const rootPath = normalizeRootPath(projectInfo);
    const session = findSession({ rootPath });
    if (!session || !isRunningPreviewStatus(session.status)) return null;
    if (session.mode === 'server' && (session.url || session.port)) {
      const readiness = await waitForServerReady(session, {
        ...options,
        readyTimeoutMs: Math.max(10, Number(options.reuseSessionTimeoutMs || 2500)),
        readyPollIntervalMs: Math.max(10, Number(options.reuseSessionPollIntervalMs || 250)),
      });
      if (!readiness.ok) return null;
      session.status = 'ready';
      session.message = readiness.message || 'Preview local ativo reaproveitado.';
      return {
        ok: true,
        started: false,
        reused: true,
        plan: null,
        session: summarizeSession(session).session,
        message: session.message,
        readiness,
      };
    }
    if (session.mode === 'file' || session.mode === 'app') {
      return {
        ok: true,
        started: false,
        reused: true,
        plan: null,
        session: summarizeSession(session).session,
        message: 'Preview ativo reaproveitado.',
        readiness: null,
      };
    }
    return null;
  }

  async function probeExistingServerPreview(plan = {}, options = {}) {
    if (!plan || plan.mode !== 'server' || (!plan.url && !plan.port)) return null;
    const port = Number.parseInt(plan.port || '0', 10);
    const session = {
      status: 'starting',
      mode: 'server',
      url: plan.url || (port ? `http://127.0.0.1:${port}/` : ''),
      port,
    };
    return waitForServerReady(session, {
      ...options,
      readyTimeoutMs: Math.max(10, Number(options.existingServerTimeoutMs || 1500)),
      readyPollIntervalMs: Math.max(10, Number(options.existingServerPollIntervalMs || 250)),
    });
  }

  function findPreviewDependencyStep(plan = {}) {
    const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
    return steps.find((step) => {
      return step &&
        step.id === 'preview_dependencies' &&
        step.command &&
        step.command.bin &&
        Array.isArray(step.command.args);
    }) || null;
  }

  function shouldAutoInstallPreviewDependencies(plan = {}, options = {}) {
    if (options.autoInstallDependencies !== true) return false;
    const dependencyStep = findPreviewDependencyStep(plan);
    if (!dependencyStep) return false;

    const warnings = Array.isArray(plan && plan.warnings) ? plan.warnings.join(' ') : '';
    if (/script `dev` ausente/i.test(warnings)) return false;

    const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
    const blockedSteps = steps.filter((step) => step && step.status === 'blocked');
    if (!blockedSteps.length) return false;

    return blockedSteps.every((step) => {
      const blockers = Array.isArray(step.blockedBy) ? step.blockedBy : [];
      if (step.id === 'preview_open' && blockers.length === 0) return true;
      return blockers.length > 0 && blockers.every((blocker) => blocker === 'preview_dependencies');
    });
  }

  function runPreviewInstallCommand({ rootPath, command, options = {} }) {
    return new Promise((resolve) => {
      const timeoutMs = Math.max(10000, Number(options.installTimeoutMs || 600000));
      const startedAt = new Date().toISOString();
      let stdout = '';
      let stderr = '';
      let settled = false;
      let aborted = false;
      let child = null;
      let timer = null;
      let forceKillTimer = null;
      let removeAbortListener = () => {};

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        removeAbortListener();
        resolve({
          ...result,
          stdout: clipRuntimeOutput(stdout),
          stderr: clipRuntimeOutput(stderr),
          startedAt,
          finishedAt: new Date().toISOString(),
        });
      };

      const onAbort = () => {
        aborted = true;
        killChildTree(child, 'SIGTERM');
        forceKillTimer = setTimeout(() => killChildTree(child, 'SIGKILL'), 1500);
        finish({
          ok: false,
          code: null,
          signal: 'SIGTERM',
          aborted: true,
          message: 'Instalação de dependências cancelada.',
        });
      };
      removeAbortListener = addAbortListener(options.signal, onAbort);
      if (isAbortSignalAborted(options.signal)) return;

      child = spawn(command.bin, command.args, {
        cwd: rootPath,
        env: buildProjectProcessEnv(rootPath, options.env || {}),
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      timer = setTimeout(() => {
        killChildTree(child, 'SIGTERM');
        forceKillTimer = setTimeout(() => killChildTree(child, 'SIGKILL'), 1500);
        finish({
          ok: false,
          code: null,
          signal: 'SIGTERM',
          aborted,
          message: 'Instalação de dependências excedeu o tempo limite.',
        });
      }, timeoutMs);

      if (child.stdout && typeof child.stdout.on === 'function') {
        child.stdout.on('data', (chunk) => {
          stdout = clipRuntimeOutput(`${stdout}${chunk.toString()}`);
        });
      }
      if (child.stderr && typeof child.stderr.on === 'function') {
        child.stderr.on('data', (chunk) => {
          stderr = clipRuntimeOutput(`${stderr}${chunk.toString()}`);
        });
      }
      if (typeof child.once === 'function') {
        child.once('error', (error) => {
          finish({
            ok: false,
            code: null,
            signal: null,
            message: `Falha ao instalar dependências: ${error.message}`,
          });
        });
        child.once('close', (code, signal) => {
          finish({
            ok: code === 0 && !aborted,
            code,
            signal: signal || null,
            aborted,
            message: code === 0
              ? 'Dependências instaladas para execução local.'
              : `Instalação de dependências falhou com código ${code}.`,
          });
        });
      }
    });
  }

  async function maybeInstallPreviewDependencies(projectInfo, plan, options = {}) {
    if (!shouldAutoInstallPreviewDependencies(plan, options)) return null;
    const rootPath = normalizeRootPath(projectInfo);
    const dependencyStep = findPreviewDependencyStep(plan);
    const command = dependencyStep.command;
    const commandText = dependencyStep.commandText || [command.bin, ...command.args].join(' ');
    const result = await runPreviewInstallCommand({ rootPath, command, options });
    return {
      ...result,
      command,
      commandText,
      stepId: dependencyStep.id,
    };
  }

  async function stopProjectPreview(payload = {}) {
    const session = findSession(payload);
    if (!session) {
      return {
        ok: true,
        stopped: false,
        message: 'Nenhum preview ativo para interromper.',
      };
    }

    session.status = 'stopping';
    session.message = 'Interrompendo preview.';
    if (session.child && typeof session.child.kill === 'function') {
      try {
        killChildTree(session.child, 'SIGTERM');
        setTimeout(() => killChildTree(session.child, 'SIGKILL'), 1500);
      } catch (error) {
        session.status = 'failed';
        session.message = `Falha ao interromper preview: ${error.message}`;
        return { ok: false, stopped: false, session: summarizeSession(session).session, message: session.message };
      }
    }

    session.status = 'stopped';
    session.stoppedAt = new Date().toISOString();
    sessionsById.delete(session.id);
    sessionsByRoot.delete(session.rootPath);
    return {
      ok: true,
      stopped: true,
      session: summarizeSession(session).session,
      message: 'Preview interrompido.',
    };
  }

  async function startFilePreview(projectInfo, plan) {
    const rootPath = normalizeRootPath(projectInfo);
    await stopProjectPreview({ rootPath });

    const session = {
      id: createSessionId(),
      rootPath,
      mode: plan.mode,
      stack: plan.stack,
      status: 'ready',
      url: plan.url,
      port: null,
      pid: null,
      commandText: '',
      child: null,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      stdout: '',
      stderr: '',
      message: 'Preview estático pronto para abrir.',
    };
    sessionsById.set(session.id, session);
    sessionsByRoot.set(rootPath, session);
    return {
      ok: true,
      started: true,
      plan,
      session: summarizeSession(session).session,
      message: session.message,
    };
  }

  function attachChildEvents(session, child) {
    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (chunk) => {
        session.stdout = clipRuntimeOutput(`${session.stdout || ''}${chunk.toString()}`);
      });
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => {
        session.stderr = clipRuntimeOutput(`${session.stderr || ''}${chunk.toString()}`);
      });
    }
    if (typeof child.once === 'function') {
      child.once('error', (error) => {
        session.status = 'failed';
        session.message = `Falha ao iniciar preview: ${error.message}`;
        session.stoppedAt = new Date().toISOString();
        sessionsById.delete(session.id);
        sessionsByRoot.delete(session.rootPath);
      });
      child.once('close', (code, signal) => {
        if (session.status === 'stopped' || session.status === 'failed') return;
        session.status = code === 0 ? 'stopped' : 'failed';
        session.exitCode = code;
        session.signal = signal || null;
        session.stoppedAt = new Date().toISOString();
        session.message = code === 0 ? 'Preview finalizado.' : 'Preview finalizou com erro.';
        sessionsById.delete(session.id);
        sessionsByRoot.delete(session.rootPath);
      });
    }
  }

  async function startServerPreview(projectInfo, plan, options = {}) {
    const rootPath = normalizeRootPath(projectInfo);
    await stopProjectPreview({ rootPath });

    const command = plan.command || {};
    if (!command.bin || !Array.isArray(command.args)) {
      return {
        ok: false,
        started: false,
        plan,
        message: 'Plano de preview sem comando executável.',
      };
    }
    if (isAbortSignalAborted(options.signal)) {
      return {
        ok: false,
        started: false,
        cancelled: true,
        plan,
        message: 'Preview cancelado antes de iniciar.',
      };
    }

    const child = spawn(command.bin, command.args, {
      cwd: plan.cwd || plan.rootPath || rootPath,
      env: buildPreviewProcessEnv(rootPath, plan, options.env || {}),
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const session = {
      id: createSessionId(),
      rootPath,
      mode: plan.mode,
      stack: plan.stack,
      status: plan.mode === 'server' ? 'starting' : 'running',
      url: plan.url,
      port: plan.port || null,
      pid: child && child.pid ? child.pid : null,
      commandText: plan.commandText || '',
      child,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      stdout: '',
      stderr: '',
      message: plan.mode === 'server' ? 'Aguardando servidor de preview responder.' : 'Preview local iniciado.',
    };
    sessionsById.set(session.id, session);
    sessionsByRoot.set(rootPath, session);
    attachChildEvents(session, child);
    const removeAbortListener = addAbortListener(options.signal, () => {
      session.cancelled = true;
      stopProjectPreview({ sessionId: session.id });
    });

    let readiness = null;
    if (session.mode === 'server' && session.port) {
      readiness = await waitForServerReady(session, options);
      if (isAbortSignalAborted(options.signal) || session.cancelled) {
        await stopProjectPreview({ sessionId: session.id });
        removeAbortListener();
        return {
          ok: false,
          started: false,
          cancelled: true,
          plan,
          session: summarizeSession(session).session,
          message: 'Preview cancelado antes de ficar pronto.',
          readiness,
        };
      }
      if (!readiness.ok) {
        if (session.status !== 'failed' && session.status !== 'stopped') {
          session.status = 'failed';
          session.message = buildPreviewFailureMessage(session, readiness);
          session.stoppedAt = new Date().toISOString();
          killChildTree(child, 'SIGTERM');
          setTimeout(() => killChildTree(child, 'SIGKILL'), 1500);
          sessionsById.delete(session.id);
          sessionsByRoot.delete(rootPath);
        }
        removeAbortListener();
        return {
          ok: false,
          started: false,
          plan,
          session: summarizeSession(session).session,
          message: session.message || buildPreviewFailureMessage(session, readiness),
          readiness,
        };
      }
      session.status = 'ready';
      session.message = readiness.message || 'Preview local pronto.';
    }

    removeAbortListener();
    return {
      ok: true,
      started: true,
      plan,
      session: summarizeSession(session).session,
      message: session.message,
      readiness,
    };
  }

  async function attachServerPreview(projectInfo, plan, options = {}) {
    const rootPath = normalizeRootPath(projectInfo);
    await stopProjectPreview({ rootPath });

    const port = Number.parseInt(options.port || (plan && plan.port) || '0', 10);
    const url = plan && plan.url
      ? plan.url
      : port
        ? `http://127.0.0.1:${port}/`
        : '';
    if (!port || !url) {
      return {
        ok: false,
        started: false,
        attached: false,
        plan,
        message: 'Plano de preview sem porta para anexar ao terminal interno.',
      };
    }

    const session = {
      id: createSessionId(),
      rootPath,
      mode: 'server',
      stack: plan && plan.stack ? plan.stack : 'Node',
      status: 'starting',
      url,
      port,
      pid: null,
      commandText: plan && plan.commandText ? plan.commandText : '',
      child: null,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      stdout: '',
      stderr: '',
      message: 'Aguardando servidor iniciado no terminal interno.',
    };
    sessionsById.set(session.id, session);
    sessionsByRoot.set(rootPath, session);

    const readiness = await waitForServerReady(session, options);
    if (!readiness.ok) {
      session.status = 'failed';
      session.message = readiness.message;
      session.stoppedAt = new Date().toISOString();
      sessionsById.delete(session.id);
      sessionsByRoot.delete(rootPath);
      return {
        ok: false,
        started: false,
        attached: false,
        plan,
        session: summarizeSession(session).session,
        message: session.message,
        readiness,
      };
    }

    session.status = 'ready';
    session.message = readiness.message || 'Preview local pronto.';
    return {
      ok: true,
      started: true,
      attached: true,
      plan,
      session: summarizeSession(session).session,
      message: session.message,
      readiness,
    };
  }

  async function startProjectPreview(projectInfo = {}, options = {}) {
    const rootPath = normalizeRootPath(projectInfo);
    if (!rootPath) {
      return {
        ok: false,
        started: false,
        plan: null,
        message: 'Projeto sem rootPath válido para preview.',
      };
    }
    if (isAbortSignalAborted(options.signal)) {
      return {
        ok: false,
        started: false,
        cancelled: true,
        plan: null,
        message: 'Preview cancelado antes de iniciar.',
      };
    }

    const reusedSession = await reuseActivePreviewSession(projectInfo, options);
    if (reusedSession) return reusedSession;

    let initialPlan = buildProjectPreviewPlan(projectInfo, options);
    if (initialPlan && initialPlan.source === 'manual_active_preview') {
      return attachServerPreview(projectInfo, initialPlan, {
        ...options,
        attachToExistingServer: true,
        port: initialPlan.port,
      });
    }
    if (options.preferExistingServer === true && initialPlan && initialPlan.mode === 'server') {
      const existingProbe = await probeExistingServerPreview(initialPlan, options);
      if (existingProbe && existingProbe.ok) {
        return attachServerPreview(projectInfo, initialPlan, {
          ...options,
          attachToExistingServer: true,
          port: initialPlan.port,
          readyTimeoutMs: Math.max(10, Number(options.existingServerTimeoutMs || 1500)),
          readyPollIntervalMs: Math.max(10, Number(options.existingServerPollIntervalMs || 250)),
        });
      }
    }
    if (options.attachToExistingServer === true) {
      if (!initialPlan.ok || initialPlan.mode !== 'server') {
        return {
          ok: false,
          started: false,
          attached: false,
          plan: initialPlan,
          message: initialPlan.message || 'Preview HTTP indisponível para anexar ao terminal interno.',
        };
      }
      return attachServerPreview(projectInfo, initialPlan, options);
    }

    const installResult = initialPlan && initialPlan.ok && !initialPlan.ready
      ? await maybeInstallPreviewDependencies(projectInfo, initialPlan, options)
      : null;

    if (installResult && !installResult.ok) {
      return {
        ok: false,
        started: false,
        plan: initialPlan,
        install: installResult,
        message: installResult.message || 'Falha ao instalar dependências para execução local.',
      };
    }

    if (installResult && installResult.ok) {
      initialPlan = buildProjectPreviewPlan(projectInfo, options);
    }

    if (!initialPlan.ok || !initialPlan.ready) {
      return {
        ok: false,
        started: false,
        plan: initialPlan,
        install: installResult,
        message: initialPlan.message || 'Preview bloqueado.',
      };
    }

    if (initialPlan.mode === 'file') {
      const result = await startFilePreview(projectInfo, initialPlan);
      if (installResult) result.install = installResult;
      return result;
    }

    if (initialPlan.mode === 'app') {
      const result = await startServerPreview(projectInfo, initialPlan, options);
      if (installResult) result.install = installResult;
      return result;
    }

    if (initialPlan.mode !== 'server') {
      return {
        ok: false,
        started: false,
        plan: initialPlan,
        message: 'Modo de preview não suportado pelo runtime.',
      };
    }

    const availablePort = await findAvailablePort(options.port || initialPlan.port);
    if (!availablePort) {
      return {
        ok: false,
        started: false,
        plan: initialPlan,
        message: 'Nenhuma porta local disponível para preview.',
      };
    }

    const plan = buildProjectPreviewPlan(projectInfo, { ...options, port: availablePort });
    if (!plan.ok || !plan.ready) {
      return {
        ok: false,
        started: false,
        plan,
        message: plan.message || 'Preview bloqueado.',
      };
    }
    const result = await startServerPreview(projectInfo, plan, options);
    if (installResult) result.install = installResult;
    return result;
  }

  function getProjectPreviewRuntimeStatus(payload = {}) {
    const session = findSession(payload);
    return summarizeSession(session);
  }

  async function stopAllProjectPreviews() {
    const sessions = Array.from(sessionsById.values());
    const results = [];
    for (const session of sessions) {
      results.push(await stopProjectPreview({ sessionId: session.id }));
    }
    return { ok: true, stopped: results.filter((result) => result.stopped).length, results };
  }

  return {
    findAvailablePort,
    getProjectPreviewRuntimeStatus,
    startProjectPreview,
    stopAllProjectPreviews,
    stopProjectPreview,
  };
}

module.exports = {
  createProjectPreviewRuntimeService,
};
