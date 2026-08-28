'use strict';

const AGENTIC_CREATE_PROFILE_SCHEMA_VERSION = 'agentic-create-profile-v1';
const AGENTIC_CREATE_SCAFFOLD_STRATEGIES = Object.freeze({
  NONE: 'none',
  FABER_BLUEPRINT: 'faber_blueprint',
});

function normalizeIntentText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function safeRouteText(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.:-]{0,127}$/.test(normalized) ? normalized : '';
}

function readProductRoute(routeDecision = null) {
  if (!routeDecision || typeof routeDecision !== 'object' || Array.isArray(routeDecision)) return null;
  const productRoute = routeDecision.productRoute;
  if (!productRoute || typeof productRoute !== 'object' || Array.isArray(productRoute)) return null;
  return productRoute;
}

function isAgenticCreateRoute(routeDecision = null) {
  const productRoute = readProductRoute(routeDecision);
  if (!productRoute) return false;
  return safeRouteText(productRoute.capability) === 'create_project'
    || safeRouteText(productRoute.executionIntent) === 'init_project';
}

function hasExplicitBlueprintOptOut(userMessage = '') {
  const text = normalizeIntentText(userMessage);
  if (!text) return false;
  return (
    /\b(nao|sem|evite|evitar|dispense|dispensar|ignore|ignorar)\b.{0,64}\b(blueprint|scaffold)\b/.test(text)
    || /\b(blueprint|scaffold)\b.{0,48}\b(nao|dispensado|desnecessario|proibido)\b/.test(text)
  );
}

function hasExplicitBlueprintOptIn(userMessage = '') {
  const text = normalizeIntentText(userMessage);
  if (!text || hasExplicitBlueprintOptOut(text)) return false;
  return (
    /\b(use|usar|utilize|utilizar|aplique|aplicar|quero|prefiro|comece|comecar|parta|partir)\b.{0,80}\b(blueprint|scaffold)\b/.test(text)
    || /\b(blueprint|scaffold)\b.{0,64}\b(do faber|faber|como base|como ponto de partida|inicial)\b/.test(text)
  );
}

function createAgenticCreateProfile({ routeDecision = null, userMessage = '' } = {}) {
  if (!isAgenticCreateRoute(routeDecision)) return null;
  const productRoute = readProductRoute(routeDecision);
  const optedOut = hasExplicitBlueprintOptOut(userMessage);
  const optedIn = !optedOut && hasExplicitBlueprintOptIn(userMessage);
  const scaffold = Object.freeze({
    optional: true,
    strategy: optedIn
      ? AGENTIC_CREATE_SCAFFOLD_STRATEGIES.FABER_BLUEPRINT
      : AGENTIC_CREATE_SCAFFOLD_STRATEGIES.NONE,
    explicitlyRequested: optedIn,
    authorizationSource: optedIn
      ? 'user_message'
      : optedOut
        ? 'explicit_opt_out'
        : 'none',
  });
  const route = Object.freeze({
    capability: safeRouteText(productRoute.capability),
    executionIntent: safeRouteText(productRoute.executionIntent),
    upstreamMode: safeRouteText(productRoute.mode),
    projectState: safeRouteText(productRoute.projectState),
  });
  return Object.freeze({
    schemaVersion: AGENTIC_CREATE_PROFILE_SCHEMA_VERSION,
    executionMode: 'unified_agentic_loop',
    scaffold,
    route,
  });
}

function buildAgenticCreatePromptGuidance(profile = null) {
  if (!profile || profile.schemaVersion !== AGENTIC_CREATE_PROFILE_SCHEMA_VERSION) return '';
  const explicitBlueprint = profile.scaffold
    && profile.scaffold.strategy === AGENTIC_CREATE_SCAFFOLD_STRATEGIES.FABER_BLUEPRINT
    && profile.scaffold.explicitlyRequested === true;
  const lines = [
    '## Criação de aplicação pelo loop unificado',
    'Trate create/init como desenvolvimento iterativo: inspecione o projeto, implemente arquivos reais, valide com as capacidades disponíveis e repare evidências de falha antes de concluir.',
    'O blueprint do Faber não é um caminho obrigatório e metadados antigos de roteamento nunca autorizam seu uso.',
  ];
  if (explicitBlueprint) {
    lines.push(
      'O usuário autorizou explicitamente o scaffold opcional do Faber. Você pode chamar `apply_faber_blueprint_scaffold` no máximo uma vez como ponto de partida e deve continuar livre para adaptar os arquivos ao briefing e à stack.',
    );
  } else {
    lines.push('Nenhum scaffold foi autorizado. Crie a aplicação diretamente com as ferramentas gerais do loop agentic.');
  }
  return lines.join('\n');
}

module.exports = {
  AGENTIC_CREATE_PROFILE_SCHEMA_VERSION,
  AGENTIC_CREATE_SCAFFOLD_STRATEGIES,
  buildAgenticCreatePromptGuidance,
  createAgenticCreateProfile,
  hasExplicitBlueprintOptIn,
  hasExplicitBlueprintOptOut,
  isAgenticCreateRoute,
};
