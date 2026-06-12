const DEFAULT_TIMEOUT_MS = 8000;

function clipText(value = '', maxChars = 8000) {
  const text = String(value || '');
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeStringList(value = []) {
  return Array.isArray(value) ? value.map((entry) => normalizeText(entry)).filter(Boolean) : [];
}

function normalizeEnv(value = {}) {
  if (!value || typeof value !== 'object') return {};
  return Object.keys(value).reduce((acc, key) => {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) return acc;
    acc[normalizedKey] = String(value[key] || '');
    return acc;
  }, {});
}

function createExternalMcpStdioTransport(dependencies = {}) {
  const {
    command,
    args = [],
    cwd = '',
    env = {},
    childProcess = require('child_process'),
    requestTimeoutMs = DEFAULT_TIMEOUT_MS,
  } = dependencies;

  const safeCommand = normalizeText(command);
  const safeArgs = normalizeStringList(args);
  const safeCwd = normalizeText(cwd);
  const safeEnv = normalizeEnv(env);
  const timeoutMs = Math.max(500, Math.min(120000, Number(requestTimeoutMs) || DEFAULT_TIMEOUT_MS));

  let processRef = null;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let nextId = 1;
  const pending = new Map();

  function rejectPending(error) {
    for (const [, entry] of pending.entries()) {
      clearTimeout(entry.timer);
      entry.resolve({
        error: {
          code: -32000,
          message: error && error.message ? error.message : 'Transporte stdio MCP encerrado.',
        },
      });
    }
    pending.clear();
  }

  function handleResponseLine(line = '') {
    const text = normalizeText(line);
    if (!text) return;
    let message = null;
    try {
      message = JSON.parse(text);
    } catch {
      stderrBuffer = clipText(`${stderrBuffer}\nstdout_non_json:${text}`);
      return;
    }
    const id = message && message.id !== undefined ? String(message.id) : '';
    if (!id || !pending.has(id)) return;
    const entry = pending.get(id);
    pending.delete(id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.resolve({ error: message.error });
      return;
    }
    entry.resolve(message.result !== undefined ? message.result : message);
  }

  function handleStdout(chunk) {
    stdoutBuffer += String(chunk || '');
    let newlineIndex = stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      handleResponseLine(line);
      newlineIndex = stdoutBuffer.indexOf('\n');
    }
  }

  function ensureProcess() {
    if (!safeCommand) {
      return {
        ok: false,
        error: {
          code: -32602,
          message: 'Comando stdio MCP ausente.',
        },
      };
    }
    if (processRef && processRef.exitCode === null && !processRef.killed) {
      return { ok: true, process: processRef };
    }
    processRef = childProcess.spawn(safeCommand, safeArgs, {
      cwd: safeCwd || undefined,
      env: { ...process.env, ...safeEnv },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (processRef.stdout && typeof processRef.stdout.setEncoding === 'function') {
      processRef.stdout.setEncoding('utf8');
    }
    if (processRef.stderr && typeof processRef.stderr.setEncoding === 'function') {
      processRef.stderr.setEncoding('utf8');
    }
    processRef.stdout.on('data', handleStdout);
    processRef.stderr.on('data', (chunk) => {
      stderrBuffer = clipText(`${stderrBuffer}${String(chunk || '')}`);
    });
    processRef.on('error', (error) => {
      rejectPending(error);
    });
    processRef.on('exit', (code, signal) => {
      rejectPending(new Error(`Processo stdio MCP saiu com code=${code} signal=${signal || ''}`));
    });
    return { ok: true, process: processRef };
  }

  async function request(method, params = {}) {
    const started = ensureProcess();
    if (!started.ok) return { error: started.error };
    const id = String(nextId);
    nextId += 1;
    const message = {
      jsonrpc: '2.0',
      id,
      method: normalizeText(method),
      params: params && typeof params === 'object' ? params : {},
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({
          error: {
            code: -32001,
            message: `Timeout MCP stdio em ${message.method}.`,
            data: { stderr: clipText(stderrBuffer, 2000) },
          },
        });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      started.process.stdin.write(`${JSON.stringify(message)}\n`, 'utf8', (error) => {
        if (!error) return;
        pending.delete(id);
        clearTimeout(timer);
        resolve({
          error: {
            code: -32002,
            message: error.message || 'Falha ao escrever no stdin MCP.',
          },
        });
      });
    });
  }

  async function notify(method, params = {}) {
    const started = ensureProcess();
    if (!started.ok) return { error: started.error };
    const message = {
      jsonrpc: '2.0',
      method: normalizeText(method),
      params: params && typeof params === 'object' ? params : {},
    };
    return new Promise((resolve) => {
      started.process.stdin.write(`${JSON.stringify(message)}\n`, 'utf8', (error) => {
        if (error) {
          resolve({
            error: {
              code: -32002,
              message: error.message || 'Falha ao escrever notificacao no stdin MCP.',
            },
          });
          return;
        }
        resolve({ ok: true });
      });
    });
  }

  function close() {
    if (!processRef || processRef.killed) return { ok: true, closed: false };
    processRef.kill();
    processRef = null;
    return { ok: true, closed: true };
  }

  function status() {
    return {
      command: safeCommand,
      args: safeArgs,
      running: Boolean(processRef && processRef.exitCode === null && !processRef.killed),
      stderr: clipText(stderrBuffer, 2000),
      pending: pending.size,
    };
  }

  return {
    close,
    notify,
    request,
    status,
  };
}

module.exports = {
  createExternalMcpStdioTransport,
};
