const { spawn: defaultSpawn } = require('child_process');

function createCommandRunner(dependencies = {}) {
  const {
    processEnv = process.env,
    spawn = defaultSpawn,
  } = dependencies;

  function runCommand(bin, args = [], options = {}) {
    const { cwd, env = {}, signal = null, timeoutMs = 10000 } = options;

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let child = null;
      let killTimer = null;
      let forceKillTimer = null;
      let settled = false;
      let timedOut = false;
      let aborted = false;

      function killChildTree(killSignal = 'SIGTERM') {
        if (!child || !child.pid) return;
        try {
          if (process.platform !== 'win32') {
            process.kill(-child.pid, killSignal);
            return;
          }
        } catch {
          // fall back to killing the direct child below
        }
        try {
          child.kill(killSignal);
        } catch {
          // best effort cleanup
        }
      }

      function cleanup() {
        clearTimeout(killTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort);
        }
      }

      function settle(result) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      }

      function onAbort() {
        aborted = true;
        killChildTree('SIGTERM');
        forceKillTimer = setTimeout(() => killChildTree('SIGKILL'), 1500);
      }

      if (signal && signal.aborted) {
        settle({
          ok: false,
          code: null,
          exitCode: null,
          signal: null,
          stdout,
          stderr: 'Comando abortado antes de iniciar.',
          timedOut,
          aborted: true,
        });
        return;
      }

      child = spawn(bin, args, {
        cwd,
        env: { ...processEnv, ...env },
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      killTimer = setTimeout(() => {
        timedOut = true;
        killChildTree('SIGTERM');
        forceKillTimer = setTimeout(() => killChildTree('SIGKILL'), 1500);
      }, timeoutMs);

      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        settle({
          ok: false,
          code: null,
          exitCode: null,
          signal: null,
          stdout,
          stderr: `${stderr}\n${error.message}`.trim(),
          timedOut,
          aborted,
        });
      });

      child.on('close', (code, closeSignal) => {
        const abortDetail = aborted ? '\nComando abortado pela validacao operacional.' : '';
        settle({
          ok: code === 0 && !timedOut && !aborted,
          code,
          exitCode: code,
          signal: closeSignal || null,
          stdout,
          stderr: `${stderr}${abortDetail}`.trim(),
          timedOut,
          aborted,
        });
      });
    });
  }

  return {
    runCommand,
  };
}

module.exports = {
  createCommandRunner,
};
