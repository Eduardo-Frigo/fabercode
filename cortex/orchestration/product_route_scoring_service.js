const { normalizeIntentText } = require('./execution_intent');

const PRODUCT_ROUTE_SCORE_SCHEMA_VERSION = 'product-route-score-v1';
const ROUTE_ACCEPTED_SCORE = 70;
const ROUTE_AMBIGUITY_MIN_SCORE = 50;
const ROUTE_TIE_MARGIN = 12;
const EXECUTION_CAPABILITIES = new Set([
  'create_project',
  'edit_project',
  'search_project',
  'diagnose_project',
  'project_tools',
]);

function hasPattern(text = '', pattern) {
  return pattern.test(String(text || ''));
}

function scorePatternGroup(text = '', patterns = []) {
  return patterns.reduce((score, pattern) => score + (hasPattern(text, pattern) ? 1 : 0), 0);
}

function normalizeScore(value = 0) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function buildScoreEntry(score = 0, reasons = []) {
  return {
    score: normalizeScore(score),
    reasons: Array.from(new Set(reasons.filter(Boolean))),
  };
}

function orderRoutes(scores = {}) {
  const entries = Object.entries(scores);
  const order = ['search_project', 'diagnose_project', 'project_tools', 'edit_project', 'create_project', 'conversation'];
  return entries
    .sort((a, b) => {
      const scoreDiff = Number(b[1].score || 0) - Number(a[1].score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    })
    .map(([capability, entry]) => ({
      capability,
      score: Number(entry.score || 0),
      reasons: entry.reasons || [],
    }));
}

function topRoute(scores = {}) {
  return orderRoutes(scores)[0] || { capability: 'conversation', score: 0, reasons: [] };
}

function buildRouteResolution({
  scores = {},
  orderedRoutes = [],
  top = null,
  noExecutionPreferred = false,
  signals = {},
  projectState = '',
  buildMode = '',
} = {}) {
  const activeTop = top || orderedRoutes[0] || { capability: 'conversation', score: 0, reasons: [] };
  const runnerUp = orderedRoutes.find((entry) => entry.capability !== activeTop.capability) || null;
  const createScore = Number(scores.create_project && scores.create_project.score ? scores.create_project.score : 0);
  const editScore = Number(scores.edit_project && scores.edit_project.score ? scores.edit_project.score : 0);

  if (noExecutionPreferred) {
    return {
      status: 'no_execution_preferred',
      reason: 'conversation_score_overrides_execution',
      requiresClarification: false,
      candidates: [activeTop.capability],
      top: activeTop,
      runnerUp,
    };
  }

  const createAgainstExistingProject = Boolean(
    projectState === 'existing_project' &&
      signals.scaffoldIntent &&
      !signals.currentEditOverridesContextScaffold &&
      !(signals.hasNegatedRoutingClauses && activeTop.capability === 'edit_project') &&
      !signals.explicitRebuild &&
      buildMode !== 'new_project_area' &&
      createScore >= ROUTE_AMBIGUITY_MIN_SCORE &&
      (signals.editIntent || buildMode === 'existing_project_edit' || editScore >= ROUTE_AMBIGUITY_MIN_SCORE)
  );
  if (createAgainstExistingProject) {
    return {
      status: 'conflict',
      reason: 'create_request_on_existing_project',
      requiresClarification: true,
      candidates: ['create_project', 'edit_project'],
      top: activeTop,
      runnerUp,
    };
  }

  if (
    projectState === 'existing_project' &&
    buildMode === 'new_project_area' &&
    activeTop.capability === 'edit_project'
  ) {
    return {
      status: 'accepted',
      reason: 'existing_project_new_area_route_accepted',
      requiresClarification: false,
      candidates: ['edit_project'],
      top: activeTop,
      runnerUp,
    };
  }

  const competingExecutionRoute = orderedRoutes.find((entry) => {
    if (!EXECUTION_CAPABILITIES.has(entry.capability)) return false;
    if (entry.capability === activeTop.capability) return false;
    if (Number(entry.score || 0) < ROUTE_AMBIGUITY_MIN_SCORE) return false;
    return Math.abs(Number(activeTop.score || 0) - Number(entry.score || 0)) <= ROUTE_TIE_MARGIN;
  }) || null;

  if (
    EXECUTION_CAPABILITIES.has(activeTop.capability) &&
    Number(activeTop.score || 0) < ROUTE_ACCEPTED_SCORE &&
    competingExecutionRoute
  ) {
    return {
      status: 'ambiguous',
      reason: 'execution_routes_too_close',
      requiresClarification: true,
      candidates: [activeTop.capability, competingExecutionRoute.capability],
      top: activeTop,
      runnerUp: competingExecutionRoute,
    };
  }

  return {
    status: 'accepted',
    reason: 'top_route_score_accepted',
    requiresClarification: false,
    candidates: [activeTop.capability],
    top: activeTop,
    runnerUp,
  };
}

function scoreProductRoute({ facts = {}, workingBrief = null, buildModeRoute = null } = {}) {
  const current = normalizeIntentText(facts.currentMessage || '');
  const source = normalizeIntentText(facts.sourceMessage || facts.currentMessage || '');
  const signals = facts.signals || {};
  const projectState = facts.projectState || '';
  const briefAction = workingBrief && workingBrief.intent ? String(workingBrief.intent.action || '') : '';
  const buildMode = buildModeRoute && buildModeRoute.mode ? String(buildModeRoute.mode) : '';
	  const hasAppFiles = Boolean(signals.hasApplicationFiles);
	  const activeMemoryForRouting = Boolean(signals.activeMemoryForRouting || signals.activeMemoryContinuation);
	  const explicitRebuild = Boolean(signals.explicitRebuild);
	  const currentEditOverridesContextScaffold = Boolean(signals.currentEditOverridesContextScaffold);
  const negatedRoutingClauses = Boolean(signals.hasNegatedRoutingClauses);

  const rawNoFileChangeIntent = scorePatternGroup(current, [
    /\bsem alterar\b/,
    /\bsem mexer\b/,
    /\bnao altere\b/,
    /\bnao mexa\b/,
    /\bnao modifique\b/,
    /\bnao execute\b/,
    /\bnao aplique\b/,
    /\bapenas explique\b/,
    /\bso explique\b/,
    /\bso entender\b/,
    /\bapenas entender\b/,
    /\bquero entender\b/,
  ]) > 0;
  const scopedRestrictionInsideEdit = Boolean(
    negatedRoutingClauses &&
      (signals.editIntent || currentEditOverridesContextScaffold) &&
      /\b(aplique|corrija|corrigir|troque|trocar|restaure|restaurar|edite|editar|ajuste|ajustar|atualize|atualizar)\b/.test(
        current
      ) &&
      /\bnao\s+(?:altere|alterar|mexa|mexer|mude|mudar|modifique|modificar|reorganize|reorganizar)\b.{0,120}\b(arquitetura|prisma|regras?|negocio|dominio|domínio|env|\.env|arquivos?)\b/.test(
        current
      )
  );
  const noFileChangeIntent = Boolean(rawNoFileChangeIntent && !scopedRestrictionInsideEdit);
  const discussionIntent = scorePatternGroup(current, [
    /\bme explique\b/,
    /\bexplique\b/,
    /\bo que voce acha\b/,
    /\bqual sua opiniao\b/,
    /\bqual sua leitura\b/,
    /\bcomo esta organizado\b/,
    /\bcomo funciona\b/,
    /\bpor que\b/,
    /\bo que significa\b/,
  ]) > 0 || (/^(\?|como|qual|quais|por que|o que)\b/.test(current) && current.includes('?'));

  const createSignalSource = currentEditOverridesContextScaffold ? current : source;
  const createSignals = scorePatternGroup(createSignalSource, [
    /\bcriar\b/,
    /\bcrie\b/,
    /\bgerar\b/,
    /\bgere\b/,
    /\bmontar\b/,
    /\bmonte\b/,
    /\bnovo projeto\b/,
    /\bnova pagina\b/,
    /\blanding\b/,
    /\bsite\b/,
    /\bapp\b/,
  ]);
  const editSignals = scorePatternGroup(current, [
    /\baltere\b/,
    /\balterar\b/,
    /\bedite\b/,
    /\beditar\b/,
    /\bajuste\b/,
    /\bajustar\b/,
    /\bmude\b/,
    /\bmudar\b/,
    /\btroque\b/,
    /\btrocar\b/,
    /\bmelhore\b/,
    /\bmelhorar\b/,
    /\bcorrija\b/,
    /\bcorrigir\b/,
    /\binsira\b/,
    /\badicione\b/,
    /\bremova\b/,
  ]);
  const searchSignals = scorePatternGroup(current, [
    /\bprocure\b/,
    /\bprocurar\b/,
    /\bbusque\b/,
    /\bbuscar\b/,
    /\bencontre\b/,
    /\blocalize\b/,
  ]);
  const diagnoseSignals = scorePatternGroup(current, [
    /\bdiagnostique\b/,
    /\bdiagnosticar\b/,
    /\berro\b/,
    /\bfalha\b/,
    /\bbuild\b/,
    /\bdebug\b/,
    /\bpreview\b/,
    /\bvisualizacao\b/,
    /\bo que\b.{0,80}\b(corrigir|necessario|necessaria|resolver|ajustar|consertar)\b.{0,120}\b(preview|visualizacao|funcionar|build|executar|rodar)\b/,
    /\b(preview|visualizacao|build)\b.{0,120}\b(500|erro|falha|nao funciona|nao abre|corrigir|resolver)\b/,
    /\bvalidacao visual\b/,
    /\bvalidar visualmente\b/,
    /\brevisar visual\b/,
    /\banalisar visualmente\b/,
    /\bcomparar com o briefing\b/,
  ]);
  const toolSignals = scorePatternGroup(current, [
    /\bterminal\b/,
    /\bnpm run\b/,
    /\bgit\b/,
    /\bcommit\b/,
    /\bdeploy\b/,
    /\brode\b/,
    /\bexecutar comando\b/,
  ]);
  const readOnlyDiagnosticPenalty = noFileChangeIntent && !toolSignals ? 55 : 0;

  const conversationReasons = [];
  let conversationScore = 12;
  if (signals.smallTalk) {
    conversationScore += 90;
    conversationReasons.push('small_talk');
  }
  if (signals.exploratoryConversation) {
    conversationScore += 62;
    conversationReasons.push('exploratory_conversation');
  }
  if (noFileChangeIntent) {
    conversationScore += 76;
    conversationReasons.push('explicit_no_file_changes');
  }
  if (discussionIntent) {
    conversationScore += hasAppFiles ? 72 : 48;
    conversationReasons.push('project_discussion_or_question');
  }
  if (editSignals > 0 || createSignals > 0 || searchSignals > 0 || diagnoseSignals > 0 || toolSignals > 0) {
    conversationScore -= noFileChangeIntent || discussionIntent ? 12 : 28;
  }

  const scores = {
    conversation: buildScoreEntry(conversationScore, conversationReasons),
	    create_project: buildScoreEntry(
	      (signals.scaffoldIntent && !currentEditOverridesContextScaffold ? 42 : 0) +
	        createSignals * 12 +
	        (explicitRebuild && !currentEditOverridesContextScaffold ? 28 : 0) +
	        (signals.enoughForInitialCreate && !currentEditOverridesContextScaffold ? 24 : 0) +
	        (projectState === 'empty_project' || projectState === 'metadata_only_project' ? 12 : 0) +
	        (briefAction === 'create_project' ? 14 : 0) +
	        (activeMemoryForRouting && briefAction === 'create_project' ? 18 : 0) +
	        (buildMode === 'adaptive_blueprint' || buildMode === 'initial_blueprint' ? 16 : 0) -
	        (projectState === 'existing_project' && buildMode !== 'new_project_area' && !explicitRebuild ? 8 : 0) -
	        (currentEditOverridesContextScaffold ? 52 : 0),
	      [
	        signals.scaffoldIntent && !currentEditOverridesContextScaffold ? 'scaffold_intent' : '',
	        explicitRebuild && !currentEditOverridesContextScaffold ? 'explicit_rebuild' : '',
	        signals.enoughForInitialCreate && !currentEditOverridesContextScaffold ? 'enough_for_initial_create' : '',
	        briefAction === 'create_project' ? 'working_brief_create_project' : '',
	        activeMemoryForRouting && briefAction === 'create_project' ? 'active_memory_create_context' : '',
	        buildMode === 'adaptive_blueprint' || buildMode === 'initial_blueprint' ? `build_mode:${buildMode}` : '',
	        projectState === 'existing_project' && buildMode !== 'new_project_area' && !explicitRebuild ? 'existing_project_create_penalty' : '',
	        currentEditOverridesContextScaffold ? 'current_edit_overrides_context_scaffold' : '',
	      ]
	    ),
	    edit_project: buildScoreEntry(
	      (signals.editIntent ? 42 : 0) +
	        editSignals * 13 +
	        (signals.deterministicEdit ? 46 : 0) +
	        (currentEditOverridesContextScaffold ? 36 : 0) +
	        (hasAppFiles ? 16 : 0) +
        (briefAction === 'edit_project' || briefAction === 'new_project_area' ? 14 : 0) +
        (activeMemoryForRouting && (briefAction === 'edit_project' || briefAction === 'new_project_area') ? 18 : 0) +
        (buildMode === 'existing_project_edit' ? 14 : 0) +
        (buildMode === 'new_project_area' ? 32 : 0) -
        (explicitRebuild ? 36 : 0) -
        (noFileChangeIntent || discussionIntent ? 50 : 0),
      [
	        signals.editIntent ? 'edit_intent' : '',
	        signals.deterministicEdit ? 'deterministic_edit' : '',
	        currentEditOverridesContextScaffold ? 'current_edit_overrides_context_scaffold' : '',
        hasAppFiles ? 'application_files_present' : '',
        briefAction === 'edit_project' || briefAction === 'new_project_area' ? `working_brief:${briefAction}` : '',
        activeMemoryForRouting && (briefAction === 'edit_project' || briefAction === 'new_project_area') ? 'active_memory_edit_context' : '',
        buildMode === 'existing_project_edit' || buildMode === 'new_project_area' ? `build_mode:${buildMode}` : '',
        explicitRebuild ? 'explicit_rebuild_edit_penalty' : '',
        noFileChangeIntent || discussionIntent ? 'conversation_guard_penalty' : '',
      ]
    ),
    search_project: buildScoreEntry(
      (signals.searchIntent ? 70 : 0) + searchSignals * 14,
      [signals.searchIntent ? 'search_intent' : '']
    ),
    diagnose_project: buildScoreEntry(
      (signals.diagnosticIntent ? 70 : 0) +
        diagnoseSignals * 18 +
        (signals.visualReviewIntent ? 64 : 0) +
        (buildMode === 'diagnostic_repair' || buildMode === 'visual_review' ? 52 : 0) -
        readOnlyDiagnosticPenalty,
      [
        signals.diagnosticIntent ? 'diagnostic_intent' : '',
        signals.visualReviewIntent ? 'visual_review_intent' : '',
        buildMode === 'diagnostic_repair' || buildMode === 'visual_review' ? `build_mode:${buildMode}` : '',
        readOnlyDiagnosticPenalty ? 'read_only_diagnostic_no_file_changes' : '',
      ]
    ),
    project_tools: buildScoreEntry(
      toolSignals * 18 + (buildMode === 'tool_action' ? 52 : 0),
      [buildMode === 'tool_action' ? 'build_mode:tool_action' : '']
    ),
  };

  const orderedRoutes = orderRoutes(scores);
  const top = topRoute(scores);
  const hasStrongExecutionIntent = ['create_project', 'edit_project', 'search_project', 'diagnose_project', 'project_tools'].some(
    (capability) => Number(scores[capability].score || 0) >= ROUTE_ACCEPTED_SCORE
  );
  const noExecutionPreferred = Boolean(
    top.capability === 'conversation' &&
      top.score >= 66 &&
      !signals.searchIntent &&
      !(signals.diagnosticIntent && !noFileChangeIntent) &&
      !signals.deterministicEdit &&
      !(signals.scaffoldIntent && !discussionIntent && !noFileChangeIntent) &&
      !(signals.editIntent && !discussionIntent && !noFileChangeIntent)
  );
  const resolution = buildRouteResolution({
    scores,
    orderedRoutes,
    top,
    noExecutionPreferred,
    signals,
    projectState,
    buildMode,
  });

  return {
    schemaVersion: PRODUCT_ROUTE_SCORE_SCHEMA_VERSION,
    scores,
    orderedRoutes,
    top,
    runnerUp: resolution.runnerUp,
    resolution,
    confidence: Math.max(0.4, Math.min(0.99, Number(top.score || 0) / 100)),
    noFileChangeIntent,
    discussionIntent,
    hasStrongExecutionIntent,
    noExecutionPreferred,
    hasRouteConflict: resolution.status === 'conflict',
    requiresClarification: Boolean(resolution.requiresClarification),
  };
}

module.exports = {
  PRODUCT_ROUTE_SCORE_SCHEMA_VERSION,
  scoreProductRoute,
};
