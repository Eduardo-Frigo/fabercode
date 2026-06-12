const defaultHttp = require('http');
const defaultHttps = require('https');
const defaultNet = require('net');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function clipProbeText(value = '', maxChars = 1200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function normalizeProbeError(error = null) {
  return String(error && error.message ? error.message : error || '').trim();
}

function createProjectPreviewReadinessService(dependencies = {}) {
  const {
    http = defaultHttp,
    https = defaultHttps,
    net = defaultNet,
  } = dependencies;

  function canConnectToPort(port, host = '127.0.0.1', timeoutMs = 800) {
    const connect = typeof net.createConnection === 'function'
      ? net.createConnection.bind(net)
      : typeof net.connect === 'function'
        ? net.connect.bind(net)
        : null;

    if (!connect) return Promise.resolve({
      ok: true,
      ready: true,
      type: 'tcp',
      message: 'Probe TCP indisponível; assumindo porta pronta.',
    });

    return new Promise((resolve) => {
      let settled = false;
      let socket = null;
      const finish = (ok, error = null) => {
        if (settled) return;
        settled = true;
        if (socket) {
          try {
            if (typeof socket.destroy === 'function') socket.destroy();
            else if (typeof socket.end === 'function') socket.end();
          } catch {
            // Best effort socket cleanup.
          }
        }
        resolve({
          ok: Boolean(ok),
          ready: Boolean(ok),
          type: 'tcp',
          port,
          host,
          message: ok
            ? `Porta TCP ${host}:${port} aceitou conexão.`
            : `Porta TCP ${host}:${port} ainda não aceitou conexão.`,
          errorMessage: normalizeProbeError(error),
        });
      };

      try {
        socket = connect({ port, host });
      } catch (error) {
        finish(false, error);
        return;
      }

      if (socket && typeof socket.setTimeout === 'function') socket.setTimeout(timeoutMs);
      if (socket && typeof socket.once === 'function') {
        socket.once('connect', () => finish(true));
        socket.once('ready', () => finish(true));
        socket.once('timeout', () => finish(false, new Error('TCP probe timeout')));
        socket.once('error', (error) => finish(false, error));
      } else {
        finish(true);
      }
    });
  }

  function probeHttpUrl(targetUrl = '', options = {}) {
    const url = String(targetUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      return Promise.resolve({
        ok: true,
        ready: true,
        type: 'non_http',
        url,
        message: 'URL não HTTP pronta para abertura direta.',
      });
    }

    const timeoutMs = Math.max(100, Number(options.readyProbeTimeoutMs || options.probeTimeoutMs || 1200));
    return new Promise((resolve) => {
      let settled = false;
      let body = '';
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      let parsed = null;
      try {
        parsed = new URL(url);
      } catch (error) {
        finish({
          ok: false,
          ready: false,
          type: 'http',
          url,
          message: `URL de preview inválida: ${error.message}`,
          errorMessage: error.message,
        });
        return;
      }

      const transport = parsed.protocol === 'https:' ? https : http;
      let request = null;
      try {
        request = transport.request(url, {
          method: 'GET',
          timeout: timeoutMs,
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5',
            'Cache-Control': 'no-cache',
          },
        }, (response) => {
          const statusCode = Number(response && response.statusCode ? response.statusCode : 0);
          if (response && typeof response.setEncoding === 'function') response.setEncoding('utf8');
          if (response && typeof response.on === 'function') {
            response.on('data', (chunk) => {
              if (body.length < 4096) body += String(chunk || '');
            });
            response.on('end', () => {
              const ready = statusCode > 0 && statusCode < 500;
              finish({
                ok: ready,
                ready,
                type: 'http',
                url,
                statusCode,
                bodyPreview: clipProbeText(body),
                message: ready
                  ? `Preview HTTP respondeu com status ${statusCode}.`
                  : `Preview HTTP respondeu com status ${statusCode || 'desconhecido'}.`,
              });
            });
          } else {
            const ready = statusCode > 0 && statusCode < 500;
            finish({
              ok: ready,
              ready,
              type: 'http',
              url,
              statusCode,
              bodyPreview: '',
              message: ready
                ? `Preview HTTP respondeu com status ${statusCode}.`
                : `Preview HTTP respondeu com status ${statusCode || 'desconhecido'}.`,
            });
          }
        });
      } catch (error) {
        finish({
          ok: false,
          ready: false,
          type: 'http',
          url,
          message: `Falha no probe HTTP do preview: ${error.message}`,
          errorMessage: error.message,
        });
        return;
      }

      if (!request || typeof request.on !== 'function' || typeof request.end !== 'function') {
        finish({
          ok: false,
          ready: false,
          type: 'http',
          url,
          message: 'Probe HTTP indisponível para o preview.',
        });
        return;
      }

      request.on('timeout', () => {
        if (typeof request.destroy === 'function') request.destroy(new Error('HTTP probe timeout'));
        finish({
          ok: false,
          ready: false,
          type: 'http',
          url,
          message: `Preview HTTP não respondeu em ${timeoutMs}ms.`,
          errorMessage: 'HTTP probe timeout',
        });
      });
      request.on('error', (error) => {
        finish({
          ok: false,
          ready: false,
          type: 'http',
          url,
          message: `Preview HTTP ainda indisponível: ${error.message}`,
          errorMessage: error.message,
        });
      });
      request.end();
    });
  }

  async function probePreviewTarget({ url = '', port = 0, host = '127.0.0.1', options = {} } = {}) {
    if (url && /^https?:\/\//i.test(url)) return probeHttpUrl(url, options);
    if (url && /^file:\/\//i.test(url)) {
      return {
        ok: true,
        ready: true,
        type: 'file',
        url,
        message: 'Preview estático pronto.',
      };
    }
    if (port) return canConnectToPort(port, host, options.readyProbeTimeoutMs || options.probeTimeoutMs || 800);
    return {
      ok: false,
      ready: false,
      type: 'none',
      message: 'Preview sem URL ou porta para verificar prontidão.',
    };
  }

  async function waitForPreviewReady({ session = null, options = {} } = {}) {
    const port = Number(session && session.port ? session.port : 0);
    const url = String(session && session.url ? session.url : '');
    if (!port && !url) return { ok: true, ready: false, message: 'Preview sem porta ou URL para aguardar.' };

    const timeoutMs = Math.max(10, Number(options.readyTimeoutMs || 45000));
    const intervalMs = Math.max(10, Number(options.readyPollIntervalMs || 250));
    const host = String(options.host || '127.0.0.1');
    const startedAt = Date.now();
    let lastProbe = null;

    while (Date.now() - startedAt < timeoutMs) {
      if (session && (session.status === 'failed' || session.status === 'stopped')) {
        return {
          ok: false,
          ready: false,
          message: session.message || 'Servidor de preview finalizou antes de ficar pronto.',
          probe: lastProbe,
        };
      }

      lastProbe = await probePreviewTarget({ url, port, host, options });
      if (lastProbe && lastProbe.ready) {
        return {
          ok: true,
          ready: true,
          message: lastProbe.message || `Preview respondendo em ${url || `${host}:${port}`}.`,
          probe: lastProbe,
        };
      }

      await wait(intervalMs);
    }

    return {
      ok: false,
      ready: false,
      message: lastProbe && lastProbe.message
        ? `Preview não ficou pronto dentro do tempo limite. Último probe: ${lastProbe.message}`
        : 'Preview não ficou pronto dentro do tempo limite.',
      probe: lastProbe,
    };
  }

  return {
    canConnectToPort,
    probeHttpUrl,
    probePreviewTarget,
    waitForPreviewReady,
  };
}

module.exports = {
  createProjectPreviewReadinessService,
};
