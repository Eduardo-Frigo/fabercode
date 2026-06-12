const assert = require('assert');

const {
  createProjectPreviewDiagnosticService,
} = require('../main/services/project_preview_diagnostic_service');

async function run() {
  const blockedService = createProjectPreviewDiagnosticService({
    buildProjectPreviewPlan: () => ({
      ok: true,
      ready: false,
      status: 'blocked',
      stack: 'Next.js',
      message: 'Plano de preview Node tem bloqueios manuais.',
      warnings: ['Dependências incompletas; node_modules/ts-interface-checker está presente, mas arquivos internos obrigatórios não foram encontrados.'],
      steps: [
        {
          id: 'preview_dependencies',
          label: 'Instalar dependências para preview',
          status: 'manual',
          commandText: 'npm ci',
          detail: 'Dependências incompletas; node_modules/ts-interface-checker está presente.',
        },
        {
          id: 'preview_server',
          label: 'Iniciar servidor de preview',
          status: 'blocked',
        },
      ],
    }),
  });
  const blocked = blockedService.buildPreviewDiagnosticResponse({
    projectInfo: { rootPath: '/tmp/the-forge' },
    latestDiagnostics: { message: 'Preview HTTP respondeu com status 500.' },
  });
  assert.strictEqual(blocked.ready, false);
  assert.strictEqual(blocked.reason, 'preview_diagnostic_blocked');
  assert.ok(blocked.response.includes('npm ci'));
  assert.ok(blocked.response.includes('ts-interface-checker'));
  assert.ok(blocked.response.includes('status 500'));

  const readyService = createProjectPreviewDiagnosticService({
    buildProjectPreviewPlan: () => ({
      ok: true,
      ready: true,
      status: 'ready',
      stack: 'Next.js',
      commandText: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
      url: 'http://127.0.0.1:3000/',
      warnings: [],
      steps: [],
    }),
  });
  const ready = readyService.buildPreviewDiagnosticResponse({
    projectInfo: { rootPath: '/tmp/the-forge' },
  });
  assert.strictEqual(ready.ready, true);
  assert.strictEqual(ready.reason, 'preview_diagnostic_ready');
  assert.ok(ready.response.includes('estrutura local está pronta'));
  assert.ok(ready.response.includes('http://127.0.0.1:3000/'));

  console.log('project-preview-diagnostic-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
