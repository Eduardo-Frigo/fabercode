const ALLOWED_EXTERNAL_URL_HOSTS = new Set([
  'github.com',
  'www.github.com',
]);

function normalizeExternalUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return { ok: false, message: 'URL externa ausente.' };

  let parsed = null;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, message: 'URL externa inválida.' };
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    return { ok: false, message: 'Protocolo externo não autorizado.' };
  }

  if (!ALLOWED_EXTERNAL_URL_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, message: 'Host externo não autorizado.' };
  }

  return { ok: true, url: parsed.toString() };
}

module.exports = {
  normalizeExternalUrl,
};
