function delayMs(ms) {
  const wait = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
  if (wait <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, wait));
}

function normalizeProviderKey(provider) {
  const raw = String(provider || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes('openai') || raw === 'oai') return 'openai';
  if (raw.includes('sambanova')) return 'sambanova';
  if (raw.includes('gemini') || raw.includes('google')) return 'gemini';
  return null;
}

function createProviderRateLimiter({
  computeRetryBackoffMs = () => 1000,
  isTransientTooManyRequestsReason = () => false,
  maxRequestsPerMinute = {},
  providerRequestWindowMs = 60000,
} = {}) {
  const providerRequestTimestampsMs = { openai: [], gemini: [], sambanova: [] };
  const providerCooldownUntilMs = { openai: 0, gemini: 0, sambanova: 0 };

  function getProviderRequestsPerMinuteLimit(provider) {
    const normalized = normalizeProviderKey(provider) || String(provider || '').toLowerCase();
    const value = Number(maxRequestsPerMinute[normalized] || 0);
    return Number.isFinite(value) && value > 0 ? Math.max(1, value) : 0;
  }

  async function enforceProviderRequestsPerMinute(provider) {
    const key = normalizeProviderKey(provider);
    if (!key) return;
    const maxPerMinute = getProviderRequestsPerMinuteLimit(provider);
    if (!Number.isFinite(maxPerMinute) || maxPerMinute <= 0) return;

    while (true) {
      const now = Date.now();
      const history = Array.isArray(providerRequestTimestampsMs[key]) ? providerRequestTimestampsMs[key] : [];
      const alive = history.filter((ts) => Number.isFinite(ts) && now - ts < providerRequestWindowMs);
      providerRequestTimestampsMs[key] = alive;

      if (alive.length < maxPerMinute) {
        alive.push(now);
        providerRequestTimestampsMs[key] = alive;
        return;
      }

      const oldest = alive[0];
      const waitMs = Math.max(250, providerRequestWindowMs - (now - oldest) + 25);
      await delayMs(waitMs);
    }
  }

  async function enforceProviderCooldown(provider) {
    const key = normalizeProviderKey(provider);
    if (!key) return;
    const until = Number(providerCooldownUntilMs[key] || 0);
    const waitMs = until - Date.now();
    if (waitMs > 0) await delayMs(waitMs);
  }

  function applyProviderCooldownFromReason(provider, reason, attemptFactor = 1) {
    const key = normalizeProviderKey(provider);
    if (!key) return;
    if (!isTransientTooManyRequestsReason(reason)) return;
    const backoffMs = computeRetryBackoffMs(reason, Math.max(1, Number(attemptFactor) || 1));
    const nextUntil = Date.now() + Math.max(1000, backoffMs);
    providerCooldownUntilMs[key] = Math.max(Number(providerCooldownUntilMs[key] || 0), nextUntil);
  }

  function clearProviderCooldown(provider) {
    const key = normalizeProviderKey(provider);
    if (!key) return;
    providerCooldownUntilMs[key] = 0;
  }

  return {
    applyProviderCooldownFromReason,
    clearProviderCooldown,
    delayMs,
    enforceProviderCooldown,
    enforceProviderRequestsPerMinute,
    getProviderRequestsPerMinuteLimit,
    normalizeProviderKey,
  };
}

module.exports = {
  createProviderRateLimiter,
  delayMs,
  normalizeProviderKey,
};
