function normalizeBlueprintText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildBlueprintContextText({
  userMessage = '',
  contextText = '',
  workGraph = null,
} = {}) {
  const parts = [userMessage, contextText];
  if (workGraph && typeof workGraph === 'object') {
    parts.push(workGraph.brief || '');
    if (workGraph.briefSpec) {
      try {
        parts.push(JSON.stringify(workGraph.briefSpec));
      } catch {
        parts.push(String(workGraph.briefSpec || ''));
      }
    }
    if (Array.isArray(workGraph.acceptanceCriteria)) {
      parts.push(workGraph.acceptanceCriteria.join(' '));
    }
  }
  return parts.filter(Boolean).join('\n');
}

function compactBlueprintJson(value) {
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function hasProfileBlueprintOperations(profile) {
  return Boolean(
    profile &&
    profile.blueprint &&
    Array.isArray(profile.blueprint.operations) &&
    profile.blueprint.operations.length > 0
  );
}

module.exports = {
  buildBlueprintContextText,
  compactBlueprintJson,
  hasProfileBlueprintOperations,
  normalizeBlueprintText,
};
