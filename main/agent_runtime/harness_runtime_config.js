'use strict';

const HARNESS_RUNTIME_CONFIG_VERSION = 'harness-runtime-config.v1';
const HARNESS_RUNTIME_MODES = Object.freeze(['legacy', 'shadow', 'canary', 'on']);

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['', '0', 'false', 'no', 'off']);

function hasOwn(target, key) {
  return Boolean(target) && Object.prototype.hasOwnProperty.call(target, key);
}

function readKillSwitch(rawValue, warnings) {
  if (typeof rawValue === 'boolean') return rawValue;
  if (rawValue === undefined || rawValue === null) return false;

  const normalized = String(rawValue).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;

  warnings.push('FABER_HARNESS_V2_KILL_SWITCH has an invalid value; fail-safe legacy mode is active.');
  return true;
}

function createHarnessRuntimeConfig({ env = process.env } = {}) {
  const sourceEnv = env && typeof env === 'object' ? env : {};
  const warnings = [];
  const modeWasProvided = hasOwn(sourceEnv, 'FABER_HARNESS_V2_MODE');
  const rawMode = modeWasProvided
    ? String(sourceEnv.FABER_HARNESS_V2_MODE || '').trim().toLowerCase()
    : '';
  const modeIsSupported = HARNESS_RUNTIME_MODES.includes(rawMode);
  const requestedMode = modeIsSupported ? rawMode : 'legacy';

  if (modeWasProvided && rawMode && !modeIsSupported) {
    warnings.push('FABER_HARNESS_V2_MODE has an unsupported value; legacy mode is active.');
  }

  const killSwitch = readKillSwitch(sourceEnv.FABER_HARNESS_V2_KILL_SWITCH, warnings);
  const configuredMode = killSwitch ? 'legacy' : requestedMode;
  const fallbackReason = killSwitch
    ? 'kill_switch'
    : modeWasProvided && rawMode && !HARNESS_RUNTIME_MODES.includes(rawMode)
      ? 'invalid_mode'
      : modeWasProvided
        ? null
        : 'default';
  const configuredPrimaryKernel = configuredMode === 'legacy' || configuredMode === 'shadow'
    ? 'legacy'
    : 'v2';
  const configuredShadowKernel = configuredMode === 'shadow' ? 'v2' : null;

  const diagnostics = Object.freeze({
    source: modeWasProvided ? 'env' : 'default',
    requestedValue: modeWasProvided && modeIsSupported ? rawMode : null,
    requestedMode,
    configuredMode,
    killSwitch,
    fallbackReason,
    warnings: Object.freeze([...warnings]),
  });

  return Object.freeze({
    schemaVersion: HARNESS_RUNTIME_CONFIG_VERSION,
    requestedMode,
    configuredMode,
    killSwitch,
    configuredPrimaryKernel,
    configuredShadowKernel,
    diagnostics,
  });
}

module.exports = {
  HARNESS_RUNTIME_CONFIG_VERSION,
  HARNESS_RUNTIME_MODES,
  createHarnessRuntimeConfig,
};
