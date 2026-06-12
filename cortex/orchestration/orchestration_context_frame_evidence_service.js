const ORCHESTRATION_CONTEXT_FRAME_EVIDENCE_SCHEMA_VERSION = 'orchestration-context-frame-evidence-v1';

function hasActiveMemoryText(activeMemory = {}) {
  return Boolean(
    String(activeMemory.routeContextText || '').trim() ||
      String(activeMemory.briefingContextText || '').trim()
  );
}

function resolveDominantContextSource(contextFrame = null) {
  if (!contextFrame || typeof contextFrame !== 'object') return 'unknown';
  const current = contextFrame.current || {};
  const conversation = contextFrame.conversation || {};
  const activeMemory = contextFrame.activeMemory || {};

  if (
    (activeMemory.allowedForBriefing || activeMemory.allowedForRouting) &&
    hasActiveMemoryText(activeMemory)
  ) {
    return 'active_memory';
  }
  if (conversation.allowedForBriefing) return 'conversation_brief';
  if (current.selfContainedCreateBrief) return 'current_message';
  return 'current_message_or_conversation';
}

function buildAllowedContextSources(contextFrame = null) {
  if (!contextFrame || typeof contextFrame !== 'object') return [];
  const current = contextFrame.current || {};
  const conversation = contextFrame.conversation || {};
  const activeMemory = contextFrame.activeMemory || {};
  const sources = [];

  if (current.message || current.normalized || current.selfContainedCreateBrief) sources.push('current_message');
  if (conversation.allowedForBriefing) sources.push('conversation_brief');
  if (activeMemory.allowedForBriefing || activeMemory.allowedForRouting) sources.push('active_memory');

  return sources;
}

function buildBlockedContextSources(contextFrame = null) {
  if (!contextFrame || typeof contextFrame !== 'object') return [];
  const activeMemory = contextFrame.activeMemory || {};
  return activeMemory.suppressed ? ['active_memory'] : [];
}

function buildContextFrameGuard(contextFrame = null) {
  if (!contextFrame || typeof contextFrame !== 'object') {
    return {
      ok: true,
      blocking: false,
      reason: '',
    };
  }

  const current = contextFrame.current || {};
  const conversation = contextFrame.conversation || {};
  const activeMemory = contextFrame.activeMemory || {};
  const confirmation = contextFrame.confirmation || {};
  const activeMemoryAllowed = Boolean(activeMemory.allowedForBriefing || activeMemory.allowedForRouting);
  const activeMemoryTextPresent = hasActiveMemoryText(activeMemory);

  if (confirmation.required) {
    return {
      ok: false,
      blocking: true,
      reason: 'context_source_ambiguity_requires_confirmation',
      detail: confirmation.reason || '',
    };
  }

  if (current.selfContainedCreateBrief && (activeMemoryAllowed || activeMemoryTextPresent)) {
    return {
      ok: false,
      blocking: true,
      reason: 'active_memory_leaked_into_self_contained_brief',
    };
  }

  if (
    conversation.allowedForBriefing &&
    current.referencesConversationBrief &&
    !current.referencesActiveMemoryStore &&
    (activeMemoryAllowed || activeMemoryTextPresent)
  ) {
    return {
      ok: false,
      blocking: true,
      reason: 'active_memory_leaked_into_conversation_brief',
    };
  }

  if (activeMemory.suppressed && activeMemoryTextPresent) {
    return {
      ok: false,
      blocking: true,
      reason: 'suppressed_active_memory_text_present',
    };
  }

  return {
    ok: true,
    blocking: false,
    reason: '',
  };
}

function buildContextFrameEvidence(contextFrame = null) {
  if (!contextFrame || typeof contextFrame !== 'object') return null;
  const current = contextFrame.current || {};
  const conversation = contextFrame.conversation || {};
  const activeMemory = contextFrame.activeMemory || {};
  const source = contextFrame.source || {};
  const confirmation = contextFrame.confirmation || {};
  const guard = buildContextFrameGuard(contextFrame);

  return {
    schemaVersion: ORCHESTRATION_CONTEXT_FRAME_EVIDENCE_SCHEMA_VERSION,
    frameSchemaVersion: contextFrame.schemaVersion || '',
    dominantSource: resolveDominantContextSource(contextFrame),
    allowedSources: buildAllowedContextSources(contextFrame),
    blockedSources: buildBlockedContextSources(contextFrame),
    guard,
    current: {
      selfContainedCreateBrief: Boolean(current.selfContainedCreateBrief),
      referencesConversationBrief: Boolean(current.referencesConversationBrief),
      referencesActiveMemoryStore: Boolean(current.referencesActiveMemoryStore),
      shortContinuation: Boolean(current.shortContinuation),
    },
    conversation: {
      available: Boolean(conversation.available),
      allowedForBriefing: Boolean(conversation.allowedForBriefing),
    },
    activeMemory: {
      available: Boolean(activeMemory.available),
      allowedForRouting: Boolean(activeMemory.allowedForRouting),
      allowedForBriefing: Boolean(activeMemory.allowedForBriefing),
      suppressed: Boolean(activeMemory.suppressed),
      suppressionReason: activeMemory.suppressionReason || '',
      eligibility: activeMemory.eligibility || null,
      retrievalReason: activeMemory.retrievalReason || '',
      citationsCount: Number(activeMemory.citationsCount || 0),
      citations: Array.isArray(activeMemory.citations) ? activeMemory.citations.slice(0, 8) : [],
      provenance: activeMemory.provenance || null,
      scope: activeMemory.scope || null,
      validity: activeMemory.validity || null,
    },
    confirmation: {
      required: Boolean(confirmation.required),
      reason: confirmation.reason || '',
      choices: Array.isArray(confirmation.choices) ? confirmation.choices.slice(0, 6) : [],
    },
    source: {
      precedence: Array.isArray(source.precedence) ? source.precedence.slice() : [],
    },
  };
}

module.exports = {
  ORCHESTRATION_CONTEXT_FRAME_EVIDENCE_SCHEMA_VERSION,
  buildContextFrameEvidence,
  buildContextFrameGuard,
  resolveDominantContextSource,
};
