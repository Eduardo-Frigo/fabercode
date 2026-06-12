function resolveCustomProviderKind(rawName = '') {
  const value = String(rawName || '').trim().toLowerCase();
  if (!value) return 'custom';
  if (value.includes('openai') || value === 'oai') return 'openai';
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('gemini') || value.includes('google')) return 'gemini';
  if (value.includes('samba')) return 'sambanova';
  return 'custom';
}

function resolveCustomApiEndpoint(profile = {}) {
  const kind = resolveCustomProviderKind(profile.providerName || '');
  if (kind === 'openai') return 'https://api.openai.com/v1/chat/completions';
  if (kind === 'deepseek') return 'https://api.deepseek.com/v1/chat/completions';

  const website = String(profile.website || '').trim();
  if (!website) return '';
  try {
    const parsed = new URL(website.startsWith('http') ? website : `https://${website}`);
    const full = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    if (full.endsWith('/chat/completions')) return full;
    if (full.endsWith('/v1')) return `${full}/chat/completions`;
    return `${parsed.origin}/v1/chat/completions`;
  } catch {
    return '';
  }
}

function maskApiKeyTail(value, visibleTail = 4) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= visibleTail) return '*'.repeat(text.length);
  return '*'.repeat(Math.max(0, text.length - visibleTail)) + text.slice(-visibleTail);
}

function createCustomProviderProfileService(dependencies = {}) {
  const {
    getSelectedAiProvider = () => '',
    listCustomApiProfiles = () => [],
  } = dependencies;

  function getSelectedCustomApiProfile(selectedProvider = null) {
    const selected = String(selectedProvider || getSelectedAiProvider() || '').trim().toLowerCase();
    if (!selected.startsWith('custom:')) return null;
    const id = selected.slice('custom:'.length);
    if (!id) return null;
    const list = listCustomApiProfiles();
    const hit = list.find((entry) => String(entry.id || '').trim().toLowerCase() === id);
    return hit || null;
  }

  return {
    getSelectedCustomApiProfile,
    maskApiKeyTail,
    resolveCustomApiEndpoint,
    resolveCustomProviderKind,
  };
}

module.exports = {
  createCustomProviderProfileService,
  maskApiKeyTail,
  resolveCustomApiEndpoint,
  resolveCustomProviderKind,
};
