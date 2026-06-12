const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_SMOKE_SCENARIOS,
  runSmokeScenarios,
} = require('./support/smoke_scenario_runner');

function parseScenarioFilter(value = '') {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function assertScenarioCoverage() {
  const scenarioIds = new Set(DEFAULT_SMOKE_SCENARIOS.map((scenario) => scenario.id));
  [
    'greenhouse_create_preview',
    'gardening_overrides_stale_greenhouse',
    'long_briefing_create_not_search',
    'teste_30_import_services_landing',
    'teste_31_helena_architecture_site',
    'teste_32_aurea_ip_patentes',
    'teste_33_linea_bosco_revestimentos',
    'teste_34_vitrapure_garrafas_vidro',
    'teste_35_alumivance_esquadrias_fachadas',
    'teste_36_aurora_di_vento_vinhos',
    'teste_37_materiais_construcao',
    'teste_38_nexaflow_desk_saas',
    'teste_39_voxlumen_revista_editorial',
    'teste_40_cacau_nobre_chocolate',
    'teste_41_atlasport_import_services',
    'teste_42_lumen_lab_photo_lab',
    'wood_sculpture_video_hero',
    'empty_project_briefing_continuation',
    'deterministic_patch_existing_project',
    'deterministic_structural_patch_existing_project',
    'mcp_structured_edit_persistence',
    'mcp_external_tool_bridge',
    'mcp_external_stdio_visual_bridge',
    'mcp_blueprint_contract_guardian',
    'mcp_blueprint_contract_briefing_matrix',
    'visual_review_no_file_changes',
    'active_memory_continuation',
    'context_frame_audit_sources',
    'active_memory_scope_expiration_guard',
    'active_memory_ambiguity_confirmation',
    'active_memory_provenance_ledger',
    'provider_failure_controlled',
    'preview_capture_unavailable',
    'current_briefing_contract_escalation',
    'temporary_blueprint_contract_synthesis',
    'route_contract_conflict',
  ].forEach((id) => {
    assert.ok(scenarioIds.has(id), `smoke scenario missing: ${id}`);
  });
}

function listRuntimeFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) return listRuntimeFiles(fullPath);
    return entry.isFile() ? [fullPath] : [];
  });
}

function assertSmokeFixturesStayOutOfRuntime() {
  const projectRoot = path.resolve(__dirname, '..');
  const runtimeFiles = ['cortex', 'main', 'renderer']
    .flatMap((dirName) => listRuntimeFiles(path.join(projectRoot, dirName)))
    .filter((filePath) => /\.(js|jsx|ts|tsx|css|json|md)$/.test(filePath));
  const forbiddenFixtures = ['VitraPure', 'Alumivance', 'Aurora di Vento', 'Constrular Prime', 'NexaFlow Desk', 'VoxLumen Revista', 'Cacau Nobre Atelier', 'AtlasPort Importações', 'Lumen Lab Fotográfico'];
  for (const filePath of runtimeFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const fixture of forbiddenFixtures) {
      assert.strictEqual(
        content.includes(fixture),
        false,
        `smoke fixture "${fixture}" leaked into runtime file ${path.relative(projectRoot, filePath)}`
      );
    }
  }
}

async function main() {
  assertScenarioCoverage();
  assertSmokeFixturesStayOutOfRuntime();
  const scenarioIds = parseScenarioFilter(process.env.SMOKE_SCENARIOS || '');
  const report = await runSmokeScenarios({
    continueOnFailure: true,
    keepArtifacts: process.env.SMOKE_KEEP_ARTIFACTS === '1',
    scenarioIds: scenarioIds.length ? scenarioIds : null,
  });

  for (const result of report.results) {
    const status = result.ok ? 'ok' : 'failed';
    const details = result.details && Object.keys(result.details).length
      ? ` ${JSON.stringify(result.details)}`
      : '';
    console.log(`[smoke:${status}] ${result.id} ${result.durationMs}ms${details}`);
    if (!result.ok && result.error) {
      console.error(result.error);
    }
  }

  assert.strictEqual(
    report.ok,
    true,
    `smoke scenarios failed: ${report.results.filter((result) => !result.ok).map((result) => result.id).join(', ')}`
  );
  assert.ok(report.scenarioCount > 0, 'smoke scenario suite should select at least one scenario');
  assert.ok(
    DEFAULT_SMOKE_SCENARIOS.length >= 25,
    'smoke scenario suite should cover creation, briefing continuation, domain override, video hero, patch, visual review, memory, provider, preview failure, contract escalation, route conflict and safety'
  );

  console.log(`smoke-scenarios.test.js: ok (${report.scenarioCount} scenarios, ${report.durationMs}ms)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
