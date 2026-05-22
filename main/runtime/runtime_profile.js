function createRuntimeProfileService({
  brainPlanMaxAttemptsEnv = 2,
  brainPlanMaxElapsedMsEnv = 480000,
  os,
  scaffoldMaxClarificationsEnv = 1,
  timeAsComputeProfile = 'auto',
} = {}) {
  if (!os || typeof os.totalmem !== 'function') {
    throw new Error('runtime profile dependency missing: os.totalmem');
  }

  function resolveTimeAsComputeProfile() {
    if (['rapido', 'balanceado', 'profundo'].includes(timeAsComputeProfile)) {
      return timeAsComputeProfile;
    }
  
    const ramGb = os.totalmem() / 1024 / 1024 / 1024;
    if (ramGb <= 10) return 'rapido';
    if (ramGb <= 24) return 'balanceado';
    return 'profundo';
  }
  
  function getRuntimeProfileSettings() {
    const profile = resolveTimeAsComputeProfile();
    if (profile === 'rapido') {
      return {
        profile,
        brainSampleFilesLimit: 14,
        engineSampleFilesLimit: 24,
        memoryContextChars: 1200,
        maxPromptCharsPerPass: 4200,
        maxOperationsPerPass: 6,
        maxRepairPasses: 1,
        keepAlive: '0s',
        generationOptions: {
          num_ctx: 2048,
          num_batch: 64,
          num_predict: 700,
          num_thread: 2,
          num_gpu: 0,
          temperature: 0.2,
        },
      };
    }
    if (profile === 'balanceado') {
      return {
        profile,
        brainSampleFilesLimit: 28,
        engineSampleFilesLimit: 40,
        memoryContextChars: 1800,
        maxPromptCharsPerPass: 7000,
        maxOperationsPerPass: 8,
        maxRepairPasses: 1,
        keepAlive: '30s',
        generationOptions: {
          num_ctx: 4096,
          num_batch: 128,
          num_predict: 1100,
          num_thread: 4,
          temperature: 0.2,
        },
      };
    }
    return {
      profile,
      brainSampleFilesLimit: 40,
      engineSampleFilesLimit: 60,
      memoryContextChars: 2400,
      maxPromptCharsPerPass: 11000,
      maxOperationsPerPass: 10,
      maxRepairPasses: 2,
      keepAlive: '2m',
      generationOptions: {
        num_ctx: 8192,
        num_batch: 256,
        num_predict: 1800,
        num_thread: 6,
        temperature: 0.2,
      },
    };
  }
  
  function sanitizePositiveInt(value, fallback) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }
  
  function getBrainBudgetSettings(runtimeSettings) {
    const defaultAttemptsByProfile = runtimeSettings.profile === 'rapido' ? 1 : 2;
    const maxAttempts = sanitizePositiveInt(brainPlanMaxAttemptsEnv, defaultAttemptsByProfile);
    const maxElapsedMs = sanitizePositiveInt(brainPlanMaxElapsedMsEnv, 480000);
    const maxClarifications = sanitizePositiveInt(scaffoldMaxClarificationsEnv, 1);
    return {
      maxAttempts,
      maxElapsedMs,
      maxClarifications,
    };
  }

  return {
    getBrainBudgetSettings,
    getRuntimeProfileSettings,
    resolveTimeAsComputeProfile,
    sanitizePositiveInt,
  };
}

module.exports = {
  createRuntimeProfileService,
};
