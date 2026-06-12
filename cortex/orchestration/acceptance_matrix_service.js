function normalizeAcceptanceText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAnyPattern(text = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function needsPersistenceEvidence(text = '') {
  return hasAnyPattern(text, [
    /\bbanco\b/,
    /\bdatabase\b/,
    /\bpostgres\b/,
    /\bpostgresql\b/,
    /\bprisma\b/,
    /\bmigration\b/,
    /\bmigracao\b/,
    /\bmigração\b/,
    /\bseed\b/,
    /\bpersist/,
    /\breload\b/,
  ]);
}

function needsVisualEvidence(text = '') {
  return hasAnyPattern(text, [
    /\bvisual\b/,
    /\blayout\b/,
    /\bmobile\b/,
    /\bdesktop\b/,
    /\bresponsiv/,
    /\bscreenshot\b/,
    /\bsmoke visual\b/,
    /\btela\b/,
    /\bpreview\b/,
  ]);
}

function needsPlaywrightEvidence(text = '') {
  return hasAnyPattern(text, [
    /\bplaywright\b/,
    /\be2e\b/,
    /\bsmoke\b/,
    /\bbrowser\b/,
    /\bnavegador\b/,
    /\bfluxo\b/,
    /\busuario\b/,
    /\busu[aá]rio\b/,
  ]);
}

function buildEvidenceForCriterion(criterion = '', contextText = '') {
  const combined = normalizeAcceptanceText(`${criterion}\n${contextText}`);
  const evidence = ['diff'];

  if (needsPersistenceEvidence(combined)) {
    evidence.push('docker_postgres');
    evidence.push('prisma_migration');
    evidence.push('prisma_seed');
    evidence.push('db_connection_test');
  }

  if (needsPlaywrightEvidence(combined)) {
    evidence.push('command:playwright');
  }

  if (needsVisualEvidence(combined)) {
    evidence.push('screenshot:desktop');
    evidence.push('screenshot:mobile');
  }

  evidence.push('command:npm run build');
  evidence.push('command:npm test');

  return Array.from(new Set(evidence));
}

function appendUniqueCriterion(items, criterion, evidence, source = 'briefing') {
  const normalized = normalizeAcceptanceText(criterion);
  if (!normalized) return;
  if (items.some((item) => normalizeAcceptanceText(item.criterion) === normalized)) return;
  items.push({
    id: `A${String(items.length + 1).padStart(2, '0')}`,
    criterion: String(criterion || '').trim(),
    evidence: Array.from(new Set((Array.isArray(evidence) ? evidence : []).filter(Boolean))),
    status: 'pending',
    source,
  });
}

function buildAcceptanceMatrixFromBriefing({
  acceptanceCriteria = [],
  userMessage = '',
  executionIntent = '',
  workingBrief = null,
} = {}) {
  const items = [];
  const criteria = Array.isArray(acceptanceCriteria)
    ? acceptanceCriteria.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const workingBriefText = workingBrief && typeof workingBrief === 'object'
    ? JSON.stringify(workingBrief)
    : '';
  const contextText = `${userMessage}\n${executionIntent}\n${workingBriefText}`;

  for (const criterion of criteria.slice(0, 12)) {
    appendUniqueCriterion(items, criterion, buildEvidenceForCriterion(criterion, contextText), 'briefing');
  }

  appendUniqueCriterion(
    items,
    'A aplicacao deve passar build real antes de ser marcada como concluida.',
    ['command:npm run build'],
    'runtime_required'
  );
  appendUniqueCriterion(
    items,
    'Os testes automatizados devem passar antes de promover alteracoes.',
    ['command:npm test'],
    'runtime_required'
  );
  appendUniqueCriterion(
    items,
    'Smoke E2E deve rodar com Playwright quando o projeto tiver script, dependencia ou config.',
    ['command:playwright'],
    'runtime_required'
  );
  appendUniqueCriterion(
    items,
    'Smoke visual deve capturar screenshots comparaveis antes da conclusao.',
    ['screenshot:desktop', 'screenshot:mobile'],
    'runtime_required'
  );

  if (needsPersistenceEvidence(normalizeAcceptanceText(contextText))) {
    appendUniqueCriterion(
      items,
      'Persistencia solicitada deve usar banco real com Postgres local, Prisma, migration, seed e teste de conexao.',
      ['docker_postgres', 'prisma_migration', 'prisma_seed', 'db_connection_test'],
      'runtime_required'
    );
  }

  return {
    version: 1,
    status: 'pending',
    items: items.slice(0, 20),
    summary: {
      total: Math.min(items.length, 20),
      pending: Math.min(items.length, 20),
      passed: 0,
      failed: 0,
    },
  };
}

module.exports = {
  buildAcceptanceMatrixFromBriefing,
  buildEvidenceForCriterion,
  needsPersistenceEvidence,
};
