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

function normalizeAbortSignal(value) {
  return typeof AbortSignal === 'function' && value instanceof AbortSignal
    ? value
    : null;
}

function cancelledTransportResult() {
  return {
    error: {
      code: -32004,
      message: 'Requisição stdio MCP cancelada.',
    },
  };
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

  function settlePending(id, result) {
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
    entry.resolve(result);
    return true;
  }

  function rejectPending(error, code = -32000) {
    for (const id of [...pending.keys()]) {
      settlePending(id, {
        error: {
          code,
          message: error && error.message ? error.message : 'Transporte stdio MCP encerrado.',
        },
      });
    }
  }

  function terminateForCancellation() {
    const child = processRef;
    processRef = null;
    rejectPending(new Error('Requisição stdio MCP cancelada.'), -32004);
    if (child && !child.killed && typeof child.kill === 'function') child.kill();
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
    if (message.error) {
      settlePending(id, { error: message.error });
      return;
    }
    settlePending(id, message.result !== undefined ? message.result : message);
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
    const spawned = childProcess.spawn(safeCommand, safeArgs, {
      cwd: safeCwd || undefined,
      env: { ...process.env, ...safeEnv },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    processRef = spawned;
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
    spawned.on('error', (error) => {
      if (processRef !== spawned) return;
      processRef = null;
      rejectPending(error);
    });
    spawned.on('exit', (code, signal) => {
      if (processRef !== spawned) return;
      processRef = null;
      rejectPending(new Error(`Processo stdio MCP saiu com code=${code} signal=${signal || ''}`));
    });
    return { ok: true, process: processRef };
  }

  async function request(method, params = {}, context = {}) {
    const signal = normalizeAbortSignal(context && context.signal);
    if (signal && signal.aborted) return cancelledTransportResult();
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
      const entry = {
        resolve,
        timer: null,
        signal,
        onAbort: null,
      };
      entry.timer = setTimeout(() => {
        settlePending(id, {
          error: {
            code: -32001,
            message: `Timeout MCP stdio em ${message.method}.`,
            data: { stderr: clipText(stderrBuffer, 2000) },
          },
        });
      }, timeoutMs);
      entry.onAbort = signal ? () => terminateForCancellation() : null;
      pending.set(id, entry);
      if (signal && entry.onAbort) {
        signal.addEventListener('abort', entry.onAbort, { once: true });
        if (signal.aborted) {
          entry.onAbort();
          return;
        }
      }
      started.process.stdin.write(`${JSON.stringify(message)}\n`, 'utf8', (error) => {
        if (!error) return;
        settlePending(id, {
          error: {
            code: -32002,
            message: error.message || 'Falha ao escrever no stdin MCP.',
          },
        });
      });
    });
  }

  async function notify(method, params = {}, context = {}) {
    const signal = normalizeAbortSignal(context && context.signal);
    if (signal && signal.aborted) return cancelledTransportResult();
    const started = ensureProcess();
    if (!started.ok) return { error: started.error };
    const message = {
      jsonrpc: '2.0',
      method: normalizeText(method),
      params: params && typeof params === 'object' ? params : {},
    };
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = () => {
        terminateForCancellation();
        finish(cancelledTransportResult());
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) {
          onAbort();
          return;
        }
      }
      started.process.stdin.write(`${JSON.stringify(message)}\n`, 'utf8', (error) => {
        if (error) {
          finish({
            error: {
              code: -32002,
              message: error.message || 'Falha ao escrever notificacao no stdin MCP.',
            },
          });
          return;
        }
        finish({ ok: true });
      });
    });
  }

  function close() {
    if (!processRef || processRef.killed) return { ok: true, closed: false };
    const child = processRef;
    processRef = null;
    rejectPending(new Error('Transporte stdio MCP encerrado.'));
    child.kill();
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
