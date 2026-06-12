const BRIEFING_CONTRACT_SCORE_SCHEMA_VERSION = 'briefing-contract-score-v1';

const MIN_ACCEPTED_SCORE = 14;
const SAME_SOURCE_CONFLICT_MARGIN = 16;

const WEAK_GENERIC_TERMS = new Set([
  'artesanal',
  'premium',
  'sensorial',
  'sofisticado',
  'elegante',
  'portfolio',
  'evento',
]);

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeContractScoreText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function stripStaleContextMentions(normalized = '') {
  return String(normalized || '')
    .replace(/\b(?:a\s+)?conversa antiga\b[^.,;!?]*(?:[.,;!?]|$)/g, ' ')
    .replace(/\b(?:o\s+)?contexto antigo\b[^.,;!?]*(?:[.,;!?]|$)/g, ' ')
    .replace(/\b(?:o\s+)?pedido antigo\b[^.,;!?]*(?:[.,;!?]|$)/g, ' ')
    .replace(/\b(?:o\s+)?brief antigo\b[^.,;!?]*(?:[.,;!?]|$)/g, ' ')
    .replace(/\bantes eu pedi\b[^.,;!?]*(?:[.,;!?]|$)/g, ' ')
    .replace(/\bem outro momento\b[^.,;!?]*(?:[.,;!?]|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function termWeight(term = '') {
  const normalized = normalizeContractScoreText(term);
  if (!normalized) return 0;
  if (WEAK_GENERIC_TERMS.has(normalized)) return 1;
  if (normalized.includes(' ')) return 4;
  if (normalized.length >= 8) return 3;
  return 2;
}

function findTermHits(normalized = '', terms = []) {
  return unique(
    terms
      .map((term) => normalizeContractScoreText(term))
      .filter((term) => {
        if (!term) return false;
        const escaped = escapeRegExp(term).replace(/\s+/g, '\\s+');
        const leftBoundary = /^[a-z0-9]/.test(term) ? '\\b' : '';
        const rightBoundary = /[a-z0-9]$/.test(term) ? '\\b' : '';
        return hasNonNegatedMatch(normalized, new RegExp(`${leftBoundary}${escaped}${rightBoundary}`, 'g'));
      })
  );
}

function findPatternHits(normalized = '', patterns = []) {
  return unique(
    patterns
      .filter((pattern) => pattern && hasNonNegatedMatch(normalized, pattern))
      .map((pattern) => pattern.source)
  );
}

function hasNonNegatedMatch(normalized = '', pattern = null) {
  if (!pattern) return false;
  const flags = pattern.flags && pattern.flags.includes('g') ? pattern.flags : `${pattern.flags || ''}g`;
  const matcher = new RegExp(pattern.source, flags);
  let match = matcher.exec(normalized);
  while (match) {
    const before = normalized.slice(Math.max(0, match.index - 150), match.index);
    const after = normalized.slice(match.index + String(match[0] || '').length, match.index + String(match[0] || '').length + 72);
    const negatedBefore = /\b(nao|nunca|sem|evitar|evite|excluir|bloquear|bloqueie|suprimir|suprima|ignorar|ignore)\b[\s\w,;:-]{0,140}$/.test(before) ||
      /\bnao\s+(?:e|eh|deve ser|se trata de|usar|utilizar)\b[\s\w,;:-]{0,140}$/.test(before);
    const negatedAfter = /^[\s\w,;:-]{0,56}\b(nao|nunca|proibid[ao]s?|bloquead[ao]s?|fora da paleta|fora do escopo)\b/.test(after);
    if (!negatedBefore && !negatedAfter) return true;
    match = matcher.exec(normalized);
  }
  return false;
}

function buildCandidateStatus({
  strongPositiveHits = [],
  positiveScore = 0,
  negativeHits = [],
  score = 0,
} = {}) {
  if (!strongPositiveHits.length && positiveScore <= 0) return 'no_evidence';
  if (!strongPositiveHits.length) return 'weak_evidence';
  if (negativeHits.length > 0) return 'conflict';
  if (score < MIN_ACCEPTED_SCORE) return 'low_confidence';
  return 'accepted';
}

function scoreBriefingDomainCandidates({
  text = '',
  domainProfiles = {},
  domainDetectors = [],
  stripStaleContext = false,
} = {}) {
  const normalizedSource = normalizeContractScoreText(text);
  const normalized = stripStaleContext ? stripStaleContextMentions(normalizedSource) : normalizedSource;
  if (!normalized) return [];

  return domainDetectors
    .map((entry) => {
      const profile = domainProfiles[entry.id] || {};
      const strongPositiveHits = findPatternHits(normalized, entry.patterns || []);
      const positiveHits = findTermHits(normalized, profile.positiveTerms || []);
      const negativeHits = findTermHits(normalized, profile.negativeTerms || []);
      const strongPositiveScore = strongPositiveHits.length * 12;
      const positiveScore = positiveHits.reduce((sum, term) => sum + termWeight(term), 0);
      const negativeScore = negativeHits.reduce((sum, term) => sum + termWeight(term) * 5, 0);
      const score = strongPositiveScore + positiveScore - negativeScore;
      const evidenceScore = strongPositiveScore + positiveScore;
      const status = buildCandidateStatus({
        strongPositiveHits,
        positiveScore,
        negativeHits,
        score,
      });

      return {
        schemaVersion: BRIEFING_CONTRACT_SCORE_SCHEMA_VERSION,
        id: entry.id,
        score,
        confidence: Math.max(0.1, Math.min(0.98, (evidenceScore - negativeScore + 30) / 100)),
        status,
        signals: {
          strongPositive: strongPositiveHits,
          positive: positiveHits,
          negative: negativeHits,
        },
        strongPositiveHits,
        positiveHits,
        negativeHits,
        signalScores: {
          strongPositive: strongPositiveScore,
          positive: positiveScore,
          negative: negativeScore,
          evidence: evidenceScore,
        },
        hasStrongPositiveSignals: strongPositiveHits.length > 0,
        hasNegativeSignals: negativeHits.length > 0,
      };
    })
    .filter((entry) => entry.signalScores.evidence > 0 || entry.signalScores.negative > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.signalScores.strongPositive !== a.signalScores.strongPositive) {
        return b.signalScores.strongPositive - a.signalScores.strongPositive;
      }
      return domainDetectors.findIndex((entry) => entry.id === a.id) -
        domainDetectors.findIndex((entry) => entry.id === b.id);
    });
}

function findSameSourceConflict(candidates = []) {
  const strongCandidates = candidates.filter((candidate) => candidate.hasStrongPositiveSignals);
  const top = strongCandidates[0] || null;
  if (!top) return { hasConflict: false };

  if (top.hasNegativeSignals || top.status === 'conflict') {
    return {
      hasConflict: true,
      type: 'negative_signals',
      candidates: strongCandidates.slice(0, 3).map((candidate) => candidate.id),
      blocking: true,
      reason: 'negative_signals_for_top_candidate',
    };
  }

  const runnerUp = strongCandidates.find((candidate) => candidate.id !== top.id) || null;
  if (
    runnerUp &&
    (runnerUp.hasNegativeSignals ||
      runnerUp.status === 'conflict' ||
      Math.abs(Number(top.score || 0) - Number(runnerUp.score || 0)) <= SAME_SOURCE_CONFLICT_MARGIN)
  ) {
    return {
      hasConflict: true,
      type: 'competing_domain_candidates',
      candidates: [top.id, runnerUp.id],
      blocking: true,
      reason: 'strong_candidates_too_close_or_conflicting',
    };
  }

  return { hasConflict: false };
}

function resolveBriefingDomainFromScores(candidates = []) {
  const ordered = Array.isArray(candidates) ? candidates : [];
  const topCandidate = ordered[0] || null;
  const conflict = findSameSourceConflict(ordered);

  if (conflict.hasConflict && conflict.blocking) {
    return {
      domain: '',
      status: 'conflict',
      confidence: topCandidate ? topCandidate.confidence : 0.35,
      fallbackReason: 'domain_conflict',
      topCandidate,
      conflict,
    };
  }

  const accepted = ordered.find((candidate) => candidate.status === 'accepted') || null;
  if (accepted) {
    return {
      domain: accepted.id,
      status: 'accepted',
      confidence: accepted.confidence,
      fallbackReason: '',
      topCandidate: accepted,
      conflict,
    };
  }

  return {
    domain: '',
    status: topCandidate ? topCandidate.status : 'no_evidence',
    confidence: topCandidate ? topCandidate.confidence : 0.1,
    fallbackReason: topCandidate ? `domain_${topCandidate.status}` : 'no_domain_evidence',
    topCandidate,
    conflict,
  };
}

module.exports = {
  BRIEFING_CONTRACT_SCORE_SCHEMA_VERSION,
  findContractTermHits: findTermHits,
  normalizeContractScoreText,
  resolveBriefingDomainFromScores,
  scoreBriefingDomainCandidates,
  stripStaleContextMentions,
};
