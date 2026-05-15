const { spawn: defaultSpawn } = require('child_process');

function createCommandRunner(dependencies = {}) {
  const {
    processEnv = process.env,
    spawn = defaultSpawn,
  } = dependencies;

  function runCommand(bin, args = [], options = {}) {
    const { cwd, env = {}, timeoutMs = 10000 } = options;

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(bin, args, {
        cwd,
        env: { ...processEnv, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const killTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(killTimer);
        resolve({
          ok: false,
          code: null,
          stdout,
          stderr: `${stderr}\n${error.message}`.trim(),
          timedOut,
        });
      });

      child.on('close', (code, signal) => {
        clearTimeout(killTimer);
        resolve({
          ok: code === 0 && !timedOut,
          code,
          exitCode: code,
          signal: signal || null,
          stdout,
          stderr,
          timedOut,
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
