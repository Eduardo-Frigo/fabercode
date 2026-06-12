const ALLOWED_EXTERNAL_URL_HOSTS = new Set([
  'accounts.google.com',
  'aistudio.google.com',
  'cloud.sambanova.ai',
  'github.com',
  'platform.deepseek.com',
  'platform.openai.com',
  'www.github.com',
]);

const LOCAL_PREVIEW_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
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

  if (parsed.protocol !== 'https:') {
    return { ok: false, message: 'Protocolo externo não autorizado.' };
  }

  if (!ALLOWED_EXTERNAL_URL_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, message: 'Host externo não autorizado.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, message: 'Credenciais em URL externa não são autorizadas.' };
  }

  return { ok: true, url: parsed.toString() };
}

function normalizePreviewOpenUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return { ok: false, message: 'URL de preview ausente.' };

  let parsed = null;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, message: 'URL de preview inválida.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, message: 'Credenciais em URL de preview não são autorizadas.' };
  }

  if (parsed.protocol === 'file:') {
    return { ok: true, url: parsed.toString() };
  }

  const hostname = String(parsed.hostname || '').toLowerCase();
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && LOCAL_PREVIEW_HOSTS.has(hostname)) {
    return { ok: true, url: parsed.toString() };
  }

  return { ok: false, message: 'Preview só pode abrir arquivo local ou servidor local.' };
}

module.exports = {
  normalizeExternalUrl,
  normalizePreviewOpenUrl,
};
