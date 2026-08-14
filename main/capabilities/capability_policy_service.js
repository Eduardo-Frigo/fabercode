'use strict';

const {
  PROJECT_CAPABILITY_EFFECTS,
} = require('./project_capability_contracts');
const {
  SANDBOX_A1_REQUIRED_FEATURES,
} = require('./sandbox_backend_contract');

const CAPABILITY_POLICY_VERSION = 'capability-policy.v2';

const CAPABILITY_POLICY_DECISIONS = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
  REQUIRE_APPROVAL: 'require_approval',
});

const CAPABILITY_POLICY_REASON_CODES = Object.freeze({
  APPROVAL_AUTHORIZED: 'APPROVAL_AUTHORIZED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  AUTOMATIC_PROJECT_AUTONOMY: 'AUTOMATIC_PROJECT_AUTONOMY',
  CAPABILITY_DISABLED: 'CAPABILITY_DISABLED',
  CAPABILITY_EFFECT_UNKNOWN: 'CAPABILITY_EFFECT_UNKNOWN',
  CAPABILITY_EFFECTS_MISSING: 'CAPABILITY_EFFECTS_MISSING',
  CAPABILITY_NOT_ALLOWED: 'CAPABILITY_NOT_ALLOWED',
  EXTERNAL_MUTATION_DISABLED: 'EXTERNAL_MUTATION_DISABLED',
  SECRET_ACCESS_DISABLED: 'SECRET_ACCESS_DISABLED',
  GRANT_AUTHORIZED: 'GRANT_AUTHORIZED',
  SANDBOX_DEGRADED: 'SANDBOX_DEGRADED',
  SANDBOX_GUARANTEES_INSUFFICIENT: 'SANDBOX_GUARANTEES_INSUFFICIENT',
  SANDBOX_UNAVAILABLE: 'SANDBOX_UNAVAILABLE',
});

const KNOWN_CAPABILITY_EFFECTS = new Set(Object.values(PROJECT_CAPABILITY_EFFECTS));

function freezeDecision(decision, reasonCode) {
  return Object.freeze({ decision, reasonCode });
}

function hasAllFeatures(probe, requiredFeatures) {
  const available = new Set(Array.isArray(probe && probe.features) ? probe.features : []);
  return requiredFeatures.every((feature) => available.has(feature));
}

function requiresFreshApproval(classification) {
  const effects = Array.isArray(classification && classification.effects)
    ? classification.effects
    : [];
  return effects.includes('filesystem_delete') || effects.includes('destructive');
}

function derivesApprovalRequirement(classification) {
  const effects = classification.effects;
  return requiresFreshApproval(classification)
    || effects.includes('network_access')
    || effects.includes('external_read')
    || effects.includes('durable_memory_write');
}

function validateClassificationEffects(classification) {
  if (!Array.isArray(classification && classification.effects)
    || classification.effects.length === 0) {
    return CAPABILITY_POLICY_REASON_CODES.CAPABILITY_EFFECTS_MISSING;
  }
  const seen = new Set();
  for (const effect of classification.effects) {
    if (typeof effect !== 'string'
      || !KNOWN_CAPABILITY_EFFECTS.has(effect)
      || seen.has(effect)) {
      return CAPABILITY_POLICY_REASON_CODES.CAPABILITY_EFFECT_UNKNOWN;
    }
    seen.add(effect);
  }
  return null;
}

/** Hard denials always take precedence over grants and automatic policy. */
function evaluateCapabilityPolicy({
  classification,
  grantAuthorization = null,
  approvalAuthorization = null,
  sandboxProbe = null,
} = {}) {
  if (!classification || typeof classification !== 'object') {
    throw new TypeError('Capability classification is required');
  }

  if (classification.hardDeny) {
    const dynamicReason = typeof classification.hardDenyReason === 'string'
      && /^[A-Z][A-Z0-9_]+$/.test(classification.hardDenyReason)
      ? classification.hardDenyReason
      : CAPABILITY_POLICY_REASON_CODES.CAPABILITY_NOT_ALLOWED;
    return freezeDecision(
      CAPABILITY_POLICY_DECISIONS.DENY,
      dynamicReason
    );
  }

  const invalidEffectsReason = validateClassificationEffects(classification);
  if (invalidEffectsReason) {
    return freezeDecision(
      CAPABILITY_POLICY_DECISIONS.DENY,
      invalidEffectsReason
    );
  }

  if (Array.isArray(classification.effects)
    && classification.effects.includes('external_mutation')) {
    return freezeDecision(
      CAPABILITY_POLICY_DECISIONS.DENY,
      CAPABILITY_POLICY_REASON_CODES.EXTERNAL_MUTATION_DISABLED
    );
  }

  if (classification.effects.includes('secret_access')) {
    return freezeDecision(
      CAPABILITY_POLICY_DECISIONS.DENY,
      CAPABILITY_POLICY_REASON_CODES.SECRET_ACCESS_DISABLED
    );
  }

  const processExecution = classification.effects.includes('process_execute');
  const requiresSandbox = classification.requiresSandbox === true || processExecution;
  const requiredSandboxFeatures = requiresSandbox
    ? [...new Set([
      ...SANDBOX_A1_REQUIRED_FEATURES,
      ...(Array.isArray(classification.requiredSandboxFeatures)
        ? classification.requiredSandboxFeatures
        : []),
    ])]
    : (Array.isArray(classification.requiredSandboxFeatures)
      ? classification.requiredSandboxFeatures
      : []);

  if (requiresSandbox) {
    if (!sandboxProbe || sandboxProbe.state === 'unavailable') {
      return freezeDecision(
        CAPABILITY_POLICY_DECISIONS.DENY,
        CAPABILITY_POLICY_REASON_CODES.SANDBOX_UNAVAILABLE
      );
    }
    if (sandboxProbe.state !== 'enforced') {
      return freezeDecision(
        CAPABILITY_POLICY_DECISIONS.DENY,
        CAPABILITY_POLICY_REASON_CODES.SANDBOX_DEGRADED
      );
    }
    if (!hasAllFeatures(sandboxProbe, requiredSandboxFeatures)) {
      return freezeDecision(
        CAPABILITY_POLICY_DECISIONS.DENY,
        CAPABILITY_POLICY_REASON_CODES.SANDBOX_GUARANTEES_INSUFFICIENT
      );
    }
  }

  // Deletion/destructive authority is deliberately one-shot and digest-bound.
  // A generic capability grant can never substitute for that fresh approval.
  if (requiresFreshApproval(classification)) {
    if (approvalAuthorization && approvalAuthorization.authorized === true) {
      return freezeDecision(
        CAPABILITY_POLICY_DECISIONS.ALLOW,
        CAPABILITY_POLICY_REASON_CODES.APPROVAL_AUTHORIZED
      );
    }
    return freezeDecision(
      CAPABILITY_POLICY_DECISIONS.REQUIRE_APPROVAL,
      CAPABILITY_POLICY_REASON_CODES.APPROVAL_REQUIRED
    );
  }

  if (grantAuthorization && grantAuthorization.authorized === true) {
    return freezeDecision(
      CAPABILITY_POLICY_DECISIONS.ALLOW,
      CAPABILITY_POLICY_REASON_CODES.GRANT_AUTHORIZED
    );
  }

  if (approvalAuthorization && approvalAuthorization.authorized === true) {
    return freezeDecision(
      CAPABILITY_POLICY_DECISIONS.ALLOW,
      CAPABILITY_POLICY_REASON_CODES.APPROVAL_AUTHORIZED
    );
  }

  if (classification.requiresApproval || derivesApprovalRequirement(classification)) {
    return freezeDecision(
      CAPABILITY_POLICY_DECISIONS.REQUIRE_APPROVAL,
      CAPABILITY_POLICY_REASON_CODES.APPROVAL_REQUIRED
    );
  }

  return freezeDecision(
    CAPABILITY_POLICY_DECISIONS.ALLOW,
    CAPABILITY_POLICY_REASON_CODES.AUTOMATIC_PROJECT_AUTONOMY
  );
}

class CapabilityPolicyService {
  constructor() {
    Object.defineProperty(this, 'version', {
      configurable: false,
      enumerable: true,
      value: CAPABILITY_POLICY_VERSION,
      writable: false,
    });
  }

  evaluate(input) {
    return evaluateCapabilityPolicy(input);
  }
}

module.exports = {
  CAPABILITY_POLICY_DECISIONS,
  CAPABILITY_POLICY_REASON_CODES,
  CAPABILITY_POLICY_VERSION,
  CapabilityPolicyService,
  evaluateCapabilityPolicy,
  derivesApprovalRequirement,
  requiresFreshApproval,
  validateClassificationEffects,
};
