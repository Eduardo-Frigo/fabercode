'use strict';

const CAPABILITY_POLICY_VERSION = 'capability-policy.v1';

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

function freezeDecision(decision, reasonCode) {
  return Object.freeze({ decision, reasonCode });
}

function hasAllFeatures(probe, requiredFeatures) {
  const available = new Set(Array.isArray(probe && probe.features) ? probe.features : []);
  return requiredFeatures.every((feature) => available.has(feature));
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

  if (Array.isArray(classification.effects)
    && classification.effects.includes('external_mutation')) {
    return freezeDecision(
      CAPABILITY_POLICY_DECISIONS.DENY,
      CAPABILITY_POLICY_REASON_CODES.EXTERNAL_MUTATION_DISABLED
    );
  }

  if (classification.requiresSandbox) {
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
    if (!hasAllFeatures(sandboxProbe, classification.requiredSandboxFeatures || [])) {
      return freezeDecision(
        CAPABILITY_POLICY_DECISIONS.DENY,
        CAPABILITY_POLICY_REASON_CODES.SANDBOX_GUARANTEES_INSUFFICIENT
      );
    }
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

  if (classification.requiresApproval) {
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
};
