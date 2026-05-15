const assert = require('assert');

const {
  createCortexRuntimeBudgetService,
  parseMacSwapUsageMb,
} = require('../cortex/orchestration/runtime_budget');

function createFakeOs({ totalMb = 8192, freeMb = 4096 } = {}) {
  return {
    totalmem: () => totalMb * 1024 * 1024,
    freemem: () => freeMb * 1024 * 1024,
  };
}

function createRuntimeSettings(profile = 'balanceado') {
  return {
    profile,
    maxPromptCharsPerPass: 7000,
    maxOperationsPerPass: 8,
    maxRepairPasses: 1,
    generationOptions: { num_predict: 1100 },
    keepAlive: '30s',
  };
}

async function run() {
  assert.strictEqual(parseMacSwapUsageMb('vm.swapusage: total = 8192.00M  used = 1.50G  free = 6.50G'), 1536);
  assert.strictEqual(parseMacSwapUsageMb('used = 512K'), 1);
  assert.strictEqual(parseMacSwapUsageMb('used = 384M'), 384);
  assert.strictEqual(parseMacSwapUsageMb('swap unavailable'), null);

  const normalService = createCortexRuntimeBudgetService({
    CORTEX_MEMORY_PAUSE_FREE_MB: 384,
    CORTEX_MEMORY_PAUSE_SWAP_MB: 4096,
    getRuntimeProfileSettings: () => createRuntimeSettings('balanceado'),
    os: createFakeOs({ totalMb: 16000, freeMb: 6000 }),
    platform: 'linux',
  });
  const normalMemory = normalService.buildBasicMemoryState();
  assert.strictEqual(normalMemory.pressure, 'normal');
  assert.strictEqual(normalMemory.freeMb, 6000);

  const lowFreeService = createCortexRuntimeBudgetService({
    CORTEX_MEMORY_PAUSE_FREE_MB: 384,
    os: createFakeOs({ totalMb: 8000, freeMb: 300 }),
    platform: 'linux',
  });
  assert.strictEqual(lowFreeService.buildBasicMemoryState().pressure, 'critical');

  const highRatioService = createCortexRuntimeBudgetService({
    CORTEX_MEMORY_PAUSE_FREE_MB: 384,
    os: createFakeOs({ totalMb: 16000, freeMb: 1200 }),
    platform: 'linux',
  });
  assert.strictEqual(highRatioService.buildBasicMemoryState().pressure, 'high');

  const darwinService = createCortexRuntimeBudgetService({
    CORTEX_MEMORY_PAUSE_FREE_MB: 384,
    CORTEX_MEMORY_PAUSE_SWAP_MB: 4096,
    getRuntimeProfileSettings: () => createRuntimeSettings('profundo'),
    getSelectedAiProvider: () => 'rwkv',
    normalizeAiProviderName: (value) => String(value || '').toLowerCase(),
    os: createFakeOs({ totalMb: 32000, freeMb: 12000 }),
    platform: 'darwin',
    runCommand: async (bin, args, options) => {
      assert.strictEqual(bin, '/usr/sbin/sysctl');
      assert.deepStrictEqual(args, ['vm.swapusage']);
      assert.strictEqual(options.timeoutMs, 1500);
      return { ok: true, stdout: 'vm.swapusage: used = 4.50G', stderr: '' };
    },
  });
  const swapPressure = await darwinService.getRuntimeMemoryState();
  assert.strictEqual(swapPressure.swapUsedMb, 4608);
  assert.strictEqual(swapPressure.pressure, 'critical');

  const rwkvBudget = darwinService.buildRuntimeBudget(
    createRuntimeSettings('rapido'),
    { pressure: 'critical', freeMb: 120, swapUsedMb: 4608 },
    'rwkv'
  );
  assert.strictEqual(rwkvBudget.pausePolicy.enabled, true);
  assert.strictEqual(rwkvBudget.pausePolicy.shouldPause, true);
  assert.strictEqual(rwkvBudget.pausePolicy.reason, 'memory_pressure_critical');
  assert.strictEqual(rwkvBudget.resumePolicy.retryAfterMs, 45000);

  const remoteBudget = darwinService.buildRuntimeBudget(
    createRuntimeSettings('balanceado'),
    { pressure: 'critical', freeMb: 120, swapUsedMb: 4608 },
    'gemini'
  );
  assert.strictEqual(remoteBudget.pausePolicy.enabled, false);
  assert.strictEqual(remoteBudget.pausePolicy.shouldPause, false);
  assert.strictEqual(remoteBudget.resumePolicy.retryAfterMs, 20000);

  const fullBudget = await darwinService.getCortexRuntimeBudget();
  assert.strictEqual(fullBudget.profile, 'profundo');
  assert.strictEqual(fullBudget.pausePolicy.provider, 'rwkv');
  assert.strictEqual(fullBudget.memoryState.pressure, 'critical');

  console.log('runtime-budget.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
