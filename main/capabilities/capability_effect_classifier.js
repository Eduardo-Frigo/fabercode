'use strict';

const {
  PROJECT_CAPABILITY_EFFECTS: CAPABILITY_EFFECTS,
  assertProjectCapabilityDescriptor,
} = require('./project_capability_contracts');
const {
  SANDBOX_A1_REQUIRED_FEATURES: A1_REQUIRED_SANDBOX_FEATURES,
} = require('./sandbox_backend_contract');

const CAPABILITY_RISK_LEVELS = Object.freeze({
  CRITICAL: 'critical',
  HIGH: 'high',
  LOW: 'low',
  MEDIUM: 'medium',
});

const KNOWN_EFFECTS = new Set(Object.values(CAPABILITY_EFFECTS));
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ownEnumerableDataKeys(value) {
  const arrayValue = Array.isArray(value);
  const keys = Object.keys(value);
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (arrayValue && key === 'length') continue;
    if (typeof key !== 'string') {
      throw new TypeError('Capability payload must not contain symbol keys');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Capability payload properties must be enumerable data properties');
    }
  }
  if (ownKeys.length !== keys.length + (arrayValue ? 1 : 0)) {
    throw new TypeError('Capability payload contains unsupported own properties');
  }
  return keys;
}

function snapshotJsonSafe(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Object.is(value, -0)) throw new TypeError('Capability payload must not contain negative zero');
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Capability payload must not contain cycles');
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError('Capability payload arrays must use the standard array prototype');
    }
    const keys = ownEnumerableDataKeys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      throw new TypeError('Capability payload arrays must be dense and contain only indexed values');
    }
    seen.add(value);
    const snapshot = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      snapshot.push(snapshotJsonSafe(descriptor.value, seen));
    }
    seen.delete(value);
    return Object.freeze(snapshot);
  }
  if (!isRecord(value)) throw new TypeError('Capability payload must be JSON-safe');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Capability payload must contain plain objects');
  }
  if (seen.has(value)) throw new TypeError('Capability payload must not contain cycles');
  seen.add(value);
  const snapshot = {};
  for (const key of ownEnumerableDataKeys(value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new TypeError(`Capability payload contains forbidden key: ${key}`);
    }
    if (value[key] === undefined) throw new TypeError('Capability payload must not contain undefined');
    snapshot[key] = snapshotJsonSafe(value[key], seen);
  }
  seen.delete(value);
  return Object.freeze(snapshot);
}

function normalizeEffect(effect) {
  const value = String(effect || '').trim().toLowerCase();
  const aliases = {
    execute: CAPABILITY_EFFECTS.PROCESS_EXECUTE,
    process: CAPABILITY_EFFECTS.PROCESS_EXECUTE,
    network: CAPABILITY_EFFECTS.NETWORK_ACCESS,
    project_read: CAPABILITY_EFFECTS.FILESYSTEM_READ,
    project_write: CAPABILITY_EFFECTS.FILESYSTEM_WRITE,
    read: CAPABILITY_EFFECTS.FILESYSTEM_READ,
    write: CAPABILITY_EFFECTS.FILESYSTEM_WRITE,
  };
  return aliases[value] || value;
}

function uniqueEffects(effects) {
  const result = [];
  for (const effect of effects) {
    const normalized = normalizeEffect(effect);
    if (normalized && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

function inferRisk(effects) {
  if (effects.includes(CAPABILITY_EFFECTS.DESTRUCTIVE)) return CAPABILITY_RISK_LEVELS.CRITICAL;
  if (effects.includes(CAPABILITY_EFFECTS.SECRET_ACCESS)
    || effects.includes(CAPABILITY_EFFECTS.EXTERNAL_MUTATION)
    || effects.includes(CAPABILITY_EFFECTS.EXTERNAL_READ)
    || effects.includes(CAPABILITY_EFFECTS.FILESYSTEM_DELETE)) {
    return CAPABILITY_RISK_LEVELS.HIGH;
  }
  if (effects.includes(CAPABILITY_EFFECTS.NETWORK_ACCESS)) return CAPABILITY_RISK_LEVELS.HIGH;
  if (effects.includes(CAPABILITY_EFFECTS.PROCESS_EXECUTE)) return CAPABILITY_RISK_LEVELS.MEDIUM;
  if (effects.includes(CAPABILITY_EFFECTS.DURABLE_MEMORY_WRITE)) return CAPABILITY_RISK_LEVELS.MEDIUM;
  return CAPABILITY_RISK_LEVELS.LOW;
}

function maxRisk(inferredRisk, declaredRisk) {
  const orderedRisks = [
    CAPABILITY_RISK_LEVELS.LOW,
    CAPABILITY_RISK_LEVELS.MEDIUM,
    CAPABILITY_RISK_LEVELS.HIGH,
    CAPABILITY_RISK_LEVELS.CRITICAL,
  ];
  return orderedRisks[Math.max(
    orderedRisks.indexOf(inferredRisk),
    orderedRisks.indexOf(declaredRisk)
  )];
}

function defaultSelector(request, descriptor, effects) {
  return Object.freeze({
    capability: descriptor.capability,
    action: descriptor.action || request.action,
    effects: Object.freeze([...effects]),
  });
}

/**
 * Classifies a canonical payload through trusted descriptor code. The payload
 * influences effects (for example a read versus a delete), but cannot supply its
 * own effects or risk labels. The resulting payload is always an immutable,
 * JSON-safe snapshot so approval and execution observe identical bytes.
 */
function classifyCapabilityEffect({ request, descriptor } = {}) {
  if (!isRecord(request) || !isRecord(descriptor)) {
    throw new TypeError('A capability request and trusted descriptor are required');
  }
  assertProjectCapabilityDescriptor(descriptor);
  const capabilityId = descriptor.capability;

  const canonicalizedPayload = typeof descriptor.canonicalizePayload === 'function'
    ? descriptor.canonicalizePayload(request.payload, request)
    : request.payload;

  if (!isRecord(canonicalizedPayload)) {
    throw new TypeError('Canonical capability payload must be an object');
  }
  const canonicalPayload = snapshotJsonSafe(canonicalizedPayload);

  const preflight = typeof descriptor.classifyEffects === 'function'
    ? descriptor.classifyEffects(canonicalPayload, request)
    : null;
  if (preflight !== null && !Array.isArray(preflight) && !isRecord(preflight)) {
    throw new TypeError('Trusted effect classifier must return an array or object');
  }
  const sourceEffects = Array.isArray(preflight)
    ? preflight
    : (Array.isArray(preflight && preflight.effects)
      ? preflight.effects
      : (Array.isArray(descriptor.effects) ? descriptor.effects : [descriptor.effect]));
  const effects = uniqueEffects(sourceEffects);
  const unknownEffects = effects.filter((effect) => !KNOWN_EFFECTS.has(effect));

  const rawSelector = typeof descriptor.createSelector === 'function'
    ? descriptor.createSelector(canonicalPayload, request)
    : defaultSelector(request, descriptor, effects);
  if (typeof rawSelector !== 'string' && !isRecord(rawSelector)) {
    throw new TypeError('Capability selector must be a string or object');
  }
  const selector = typeof rawSelector === 'string'
    ? rawSelector
    : snapshotJsonSafe(rawSelector);

  const preflightHardDeny = Boolean(preflight && !Array.isArray(preflight) && preflight.hardDeny);
  const disabled = descriptor.enabled === false;
  const externalMutationDisabled = effects.includes(CAPABILITY_EFFECTS.EXTERNAL_MUTATION);
  const secretAccessDisabled = effects.includes(CAPABILITY_EFFECTS.SECRET_ACCESS);
  const hardDeny = preflightHardDeny
    || disabled
    || externalMutationDisabled
    || secretAccessDisabled
    || effects.length === 0
    || unknownEffects.length > 0;
  let hardDenyReason = null;
  if (preflightHardDeny) {
    hardDenyReason = String(preflight.hardDenyReason || 'CAPABILITY_NOT_ALLOWED').trim();
    if (!/^[A-Z][A-Z0-9_]+$/.test(hardDenyReason)) {
      throw new TypeError('Dynamic hard-deny reason must be a stable uppercase code');
    }
  } else if (disabled) hardDenyReason = 'CAPABILITY_DISABLED';
  else if (externalMutationDisabled) hardDenyReason = 'EXTERNAL_MUTATION_DISABLED';
  else if (secretAccessDisabled) hardDenyReason = 'SECRET_ACCESS_DISABLED';
  else if (effects.length === 0) hardDenyReason = 'CAPABILITY_EFFECTS_MISSING';
  else if (unknownEffects.length > 0) hardDenyReason = 'CAPABILITY_EFFECT_UNKNOWN';

  const requiresSandbox = descriptor.requiresSandbox === true
    || effects.includes(CAPABILITY_EFFECTS.PROCESS_EXECUTE);
  const descriptorSandboxFeatures = Array.isArray(descriptor.requiredSandboxFeatures)
    ? descriptor.requiredSandboxFeatures.map((feature) => String(feature || '').trim()).filter(Boolean)
    : [];
  const requiredSandboxFeatures = [...new Set([
    ...(requiresSandbox ? A1_REQUIRED_SANDBOX_FEATURES : []),
    ...descriptorSandboxFeatures,
  ])];

  const declaredRisk = (preflight && !Array.isArray(preflight) && preflight.risk)
    || descriptor.risk
    || inferRisk(effects);
  if (!Object.values(CAPABILITY_RISK_LEVELS).includes(declaredRisk)) {
    throw new TypeError(`Unsupported capability risk: ${String(declaredRisk)}`);
  }
  // Trusted descriptors may raise risk, but can never downgrade the minimum
  // implied by their classified effects.
  const effectiveRisk = maxRisk(inferRisk(effects), declaredRisk);

  return Object.freeze({
    capabilityId: capabilityId.trim(),
    descriptorVersion: descriptor.version.trim(),
    action: String(descriptor.action || request.action || '').trim(),
    canonicalPayload,
    effects: Object.freeze(effects),
    hardDeny,
    hardDenyReason,
    network: effects.includes(CAPABILITY_EFFECTS.NETWORK_ACCESS),
    destructive: effects.includes(CAPABILITY_EFFECTS.DESTRUCTIVE),
    requiresApproval: descriptor.requiresApproval === true
      || Boolean(preflight && !Array.isArray(preflight) && preflight.requiresApproval)
      || effects.includes(CAPABILITY_EFFECTS.NETWORK_ACCESS)
      || effects.includes(CAPABILITY_EFFECTS.EXTERNAL_MUTATION)
      || effects.includes(CAPABILITY_EFFECTS.EXTERNAL_READ)
      || effects.includes(CAPABILITY_EFFECTS.DURABLE_MEMORY_WRITE)
      || effects.includes(CAPABILITY_EFFECTS.SECRET_ACCESS)
      || effects.includes(CAPABILITY_EFFECTS.FILESYSTEM_DELETE)
      || effects.includes(CAPABILITY_EFFECTS.DESTRUCTIVE),
    requiresSandbox,
    requiredSandboxFeatures: Object.freeze(requiredSandboxFeatures),
    risk: effectiveRisk,
    selector,
  });
}

class CapabilityEffectClassifier {
  classify(input) {
    return classifyCapabilityEffect(input);
  }
}

module.exports = {
  A1_REQUIRED_SANDBOX_FEATURES,
  CAPABILITY_EFFECTS,
  CAPABILITY_RISK_LEVELS,
  CapabilityEffectClassifier,
  classifyCapabilityEffect,
  snapshotJsonSafe,
};
