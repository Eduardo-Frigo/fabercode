const assert = require('assert');

const { createPlatformGuidanceService } = require('../main/services/platform_guidance_service');

function run() {
  const service = createPlatformGuidanceService();

  const nextProject = {
    stacks: ['Next.js', 'Tailwind CSS'],
    files: ['package.json', 'app/page.tsx', 'app/globals.css'],
  };
  const nextSteps = service.buildProjectNextSteps(nextProject);
  assert.ok(nextSteps.some((step) => step.includes('npm install')));
  assert.ok(nextSteps.some((step) => step.includes('Vercel')));

  const runbooks = service.buildPlatformRunbooks({
    projectInfo: nextProject,
    userMessage: 'vamos usar Supabase Auth e Postgres',
  });
  assert.ok(runbooks.some((runbook) => runbook.id === 'github-basic'));
  assert.ok(runbooks.some((runbook) => runbook.id === 'vercel-next'));
  assert.ok(runbooks.some((runbook) => runbook.id === 'supabase-basic'));
  const supabase = runbooks.find((runbook) => runbook.id === 'supabase-basic');
  assert.ok(supabase.envVars.includes('NEXT_PUBLIC_SUPABASE_URL'));
  assert.ok(supabase.verification.some((item) => item.includes('service role')));

  const lampProject = {
    stacks: ['PHP/LAMP'],
    files: ['index.php', 'style.css'],
  };
  const lampRunbooks = service.buildPlatformRunbooks({ projectInfo: lampProject });
  assert.ok(lampRunbooks.some((runbook) => runbook.id === 'lamp-hosting-basic'));
  assert.ok(service.buildProjectNextSteps(lampProject).some((step) => step.includes('LAMP')));

  console.log('platform-guidance-service.test.js: ok');
}

run();
