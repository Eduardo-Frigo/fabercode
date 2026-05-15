const defaultOs = require('os');

const { RUNTIME_BUDGET_VERSION } = require('./render_runtime_state');

function parseMacSwapUsageMb(output = '') {
  const match = String(output || '').match(/used\s*=\s*([0-9.]+)([KMG])?/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = String(match[2] || 'M').toUpperCase();
  if (unit === 'G') return Math.round(value * 1024);
  if (unit === 'K') return Math.round(value / 1024);
  return Math.round(value);
}

function createCortexRuntimeBudgetService(dependencies = {}) {
  const {
    CORTEX_MEMORY_PAUSE_FREE_MB = 384,
    CORTEX_MEMORY_PAUSE_SWAP_MB = 4096,
    getRuntimeProfileSettings,
    getSelectedAiProvider = () => 'rwkv',
    normalizeAiProviderName = (provider) => String(provider || '').trim().toLowerCase() || 'mock',
    os = defaultOs,
    platform = process.platform,
    runCommand,
  } = dependencies;

  function buildBasicMemoryState() {
    const totalMb = Math.round(os.totalmem() / 1024 / 1024);
    const freeMb = Math.round(os.freemem() / 1024 / 1024);
    const freeRatio = totalMb > 0 ? freeMb / totalMb : 0;
    return {
      totalMb,
      freeMb,
      freeRatio,
      swapUsedMb: null,
      pressure: freeMb <= CORTEX_MEMORY_PAUSE_FREE_MB ? 'critical' : freeRatio < 0.12 ? 'high' : 'normal',
    };
  }

  async function readMacSwapUsageMb() {
    if (platform !== 'darwin') return null;
    if (typeof runCommand !== 'function') return null;
    try {
      const result = await runCommand('/usr/sbin/sysctl', ['vm.swapusage'], { timeoutMs: 1500 });
      return parseMacSwapUsageMb(`${result.stdout || ''} ${result.stderr || ''}`);
    } catch {
      return null;
    }
  }

  async function getRuntimeMemoryState() {
    const state = buildBasicMemoryState();
    const swapUsedMb = await readMacSwapUsageMb();
    if (Number.isFinite(swapUsedMb)) {
      state.swapUsedMb = swapUsedMb;
    }

    if (
      state.freeMb <= CORTEX_MEMORY_PAUSE_FREE_MB ||
      (Number.isFinite(state.swapUsedMb) && state.swapUsedMb >= CORTEX_MEMORY_PAUSE_SWAP_MB)
    ) {
      state.pressure = 'critical';
    } else if (state.freeRatio < 0.12 || (Number.isFinite(state.swapUsedMb) && state.swapUsedMb >= 2048)) {
      state.pressure = 'high';
    }
    return state;
  }

  function buildRuntimeBudget(runtimeSettings, memoryState = buildBasicMemoryState(), provider = 'rwkv') {
    const selectedProvider = normalizeAiProviderName(provider);
    const memoryGuardEnabled = selectedProvider === 'rwkv';
    const shouldPause = memoryGuardEnabled && memoryState.pressure === 'critical';
    return {
      kind: RUNTIME_BUDGET_VERSION,
      profile: runtimeSettings.profile,
      memoryState,
      maxActiveModels: 1,
      maxPromptCharsPerPass: runtimeSettings.maxPromptCharsPerPass,
      maxOperationsPerPass: runtimeSettings.maxOperationsPerPass,
      maxRepairPasses: runtimeSettings.maxRepairPasses,
      generationOptions: runtimeSettings.generationOptions,
      keepAlive: runtimeSettings.keepAlive,
      pausePolicy: {
        enabled: memoryGuardEnabled,
        provider: selectedProvider,
        shouldPause,
        reason: shouldPause ? 'memory_pressure_critical' : null,
        freeMbThreshold: CORTEX_MEMORY_PAUSE_FREE_MB,
        swapUsedMbThreshold: CORTEX_MEMORY_PAUSE_SWAP_MB,
      },
      resumePolicy: {
        retryAfterMs: runtimeSettings.profile === 'rapido' ? 45000 : 20000,
        requiresUserRetry: true,
      },
    };
  }

  async function getCortexRuntimeBudget() {
    if (typeof getRuntimeProfileSettings !== 'function') {
      throw new Error('Runtime budget dependency missing: getRuntimeProfileSettings');
    }
    const runtimeSettings = getRuntimeProfileSettings();
    const memoryState = await getRuntimeMemoryState();
    const provider = getSelectedAiProvider();
    return buildRuntimeBudget(runtimeSettings, memoryState, provider);
  }

  return {
    buildBasicMemoryState,
    buildRuntimeBudget,
    getCortexRuntimeBudget,
    getRuntimeMemoryState,
    readMacSwapUsageMb,
  };
}

module.exports = {
  createCortexRuntimeBudgetService,
  parseMacSwapUsageMb,
};
