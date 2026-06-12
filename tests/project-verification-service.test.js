const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createProjectVerificationService } = require('../main/services/project_verification_service');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeInstalledPackage(rootPath, packageName, version) {
  writeJson(path.join(rootPath, 'node_modules', ...packageName.split('/'), 'package.json'), {
    name: packageName,
    version,
  });
}

function createProjectInfo(rootPath, files, stacks) {
  return {
    rootPath,
    totalFiles: files.length,
    files,
    stacks,
    counters: {},
  };
}

async function testNextProjectRunsAvailableChecks(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-ready');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'next build',
      typecheck: 'tsc --noEmit',
      lint: 'next lint',
      test: 'node test.js',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
      tailwindcss: '^4.0.0',
    },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  writeFile(path.join(rootPath, 'app/globals.css'), '@import "tailwindcss";');
  writeInstalledPackage(rootPath, 'next', '16.0.0');
  writeInstalledPackage(rootPath, 'react', '19.0.0');
  writeInstalledPackage(rootPath, 'tailwindcss', '4.0.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args, options) => {
      calls.push({ bin, args, options });
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  const report = await service.runProjectVerification(createProjectInfo(rootPath, [
    'package.json',
    'app/page.tsx',
    'app/globals.css',
  ], ['Next.js', 'Tailwind CSS']));

  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls.map((call) => [call.bin, call.args.join(' ')]), [
    ['npm', 'run build'],
    ['npm', 'run typecheck'],
    ['npm', 'run lint'],
    ['npm', 'test'],
  ]);
  assert.ok(calls.every((call) => call.options.cwd === rootPath));
}

async function testNextProjectInstallsDependenciesBeforeChecks(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-missing-deps');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'next build',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push({ bin, args });
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  const projectInfo = createProjectInfo(rootPath, ['package.json', 'app/page.tsx'], ['Next.js']);
  const plan = service.buildProjectVerificationPlan(projectInfo);
  const dependencyStep = plan.steps.find((step) => step.id === 'node_dependencies');
  assert.ok(dependencyStep);
  assert.strictEqual(dependencyStep.kind, 'command');
  assert.strictEqual(dependencyStep.commandText, 'npm install');

  const report = await service.runProjectVerification(projectInfo);
  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls.map((call) => [call.bin, call.args.join(' ')]), [
    ['npm', 'install'],
    ['npm', 'run build'],
  ]);
}

async function testNextProjectUpdatesStaleDependenciesBeforeBuild(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-stale-deps');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'next build',
    },
    dependencies: {
      next: '15.5.19',
      react: '19.2.7',
    },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  writeInstalledPackage(rootPath, 'next', '16.2.7');
  writeInstalledPackage(rootPath, 'react', '19.2.7');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push({ bin, args });
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  const report = await service.runProjectVerification(createProjectInfo(rootPath, [
    'package.json',
    'app/page.tsx',
  ], ['Next.js']));

  assert.strictEqual(report.ready, true);
  assert.ok(report.results.some((result) => result.id === 'node_dependencies' && result.status === 'passed'));
  assert.deepStrictEqual(calls.map((call) => [call.bin, call.args.join(' ')]), [
    ['npm', 'install'],
    ['npm', 'run build'],
  ]);
}

async function testPlaceholderTestScriptIsSkipped(tempRoot) {
  const rootPath = path.join(tempRoot, 'placeholder-test');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'next build',
      test: 'echo "Error: no test specified" && exit 1',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  writeInstalledPackage(rootPath, 'next', '16.0.0');
  writeInstalledPackage(rootPath, 'react', '19.0.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  const report = await service.runProjectVerification(createProjectInfo(rootPath, [
    'package.json',
    'app/page.tsx',
  ], ['Next.js']));

  assert.deepStrictEqual(calls, [['npm', 'run build']]);
  assert.ok(report.warnings.some((warning) => warning.includes('placeholder')));
}

async function testStrictNodeVerificationRequiresRealTestAndPlaywright(tempRoot) {
  const rootPath = path.join(tempRoot, 'strict-missing-tests');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'next build',
      test: 'echo "Error: no test specified" && exit 1',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  writeInstalledPackage(rootPath, 'next', '16.0.0');
  writeInstalledPackage(rootPath, 'react', '19.0.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  const report = await service.runProjectVerification(
    createProjectInfo(rootPath, ['package.json', 'app/page.tsx'], ['Next.js']),
    {
      requiredNodeScripts: ['build', 'test'],
      requirePlaywright: true,
    }
  );

  assert.strictEqual(report.ready, false);
  assert.deepStrictEqual(calls, [['npm', 'run build']]);
  assert.ok(report.results.some((result) => result.id === 'node_test_script' && result.status === 'failed'));
  assert.ok(report.results.some((result) => result.id === 'node_playwright_required' && result.status === 'failed'));
}

async function testStrictNodeVerificationRunsPlaywrightScript(tempRoot) {
  const rootPath = path.join(tempRoot, 'strict-playwright-ready');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'next build',
      test: 'node unit.test.js',
      'test:e2e': 'playwright test',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
    devDependencies: {
      '@playwright/test': '^1.0.0',
    },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  writeInstalledPackage(rootPath, 'next', '16.0.0');
  writeInstalledPackage(rootPath, 'react', '19.0.0');
  writeInstalledPackage(rootPath, '@playwright/test', '1.0.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  const report = await service.runProjectVerification(
    createProjectInfo(rootPath, ['package.json', 'app/page.tsx'], ['Next.js']),
    {
      requiredNodeScripts: ['build', 'test'],
      requirePlaywright: 'if_available',
    }
  );

  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls, [
    ['npm', 'run build'],
    ['npm', 'test'],
    ['npm', 'run test:e2e'],
  ]);
  assert.ok(report.results.some((result) => result.id === 'node_playwright' && result.status === 'passed'));
}

async function testPlaywrightIfAvailableDoesNotBlockMissingPlaywright(tempRoot) {
  const rootPath = path.join(tempRoot, 'strict-playwright-missing-but-optional');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'next build',
      test: 'node unit.test.js',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  writeInstalledPackage(rootPath, 'next', '16.0.0');
  writeInstalledPackage(rootPath, 'react', '19.0.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  const report = await service.runProjectVerification(
    createProjectInfo(rootPath, ['package.json', 'app/page.tsx'], ['Next.js']),
    {
      requiredNodeScripts: ['build', 'test'],
      requirePlaywright: 'if_available',
    }
  );

  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls, [
    ['npm', 'run build'],
    ['npm', 'test'],
  ]);
  assert.ok(!report.results.some((result) => result.id === 'node_playwright_required'));
}

async function testPostgresPersistenceRequiresOperationalEvidence(tempRoot) {
  const rootPath = path.join(tempRoot, 'postgres-prisma-declared-only');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'next build',
      test: 'node unit.test.js',
      prisma: 'prisma validate',
    },
    dependencies: {
      '@prisma/client': '^5.22.0',
      next: '15.5.19',
      react: '19.2.7',
    },
    devDependencies: {
      prisma: '^5.22.0',
    },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  writeFile(path.join(rootPath, 'prisma/schema.prisma'), 'datasource db { provider = "postgresql" url = env("DATABASE_URL") }');
  writeInstalledPackage(rootPath, '@prisma/client', '5.22.0');
  writeInstalledPackage(rootPath, 'next', '15.5.19');
  writeInstalledPackage(rootPath, 'react', '19.2.7');
  writeInstalledPackage(rootPath, 'prisma', '5.22.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  const report = await service.runProjectVerification(
    createProjectInfo(rootPath, ['package.json', 'app/page.tsx', 'prisma/schema.prisma'], ['Next.js']),
    {
      requiredNodeScripts: ['build', 'test'],
      requirePersistence: true,
      userMessage: 'implementar backend local com Postgres, Prisma, migration, seed e persistencia real',
    }
  );

  assert.strictEqual(report.ready, false);
  assert.ok(report.results.some((result) => result.id === 'persistence_docker_compose' && result.status === 'failed'));
  assert.ok(report.results.some((result) => result.id === 'persistence_migration' && result.status === 'failed'));
  assert.ok(report.results.some((result) => result.id === 'persistence_seed' && result.status === 'failed'));
  assert.ok(report.results.some((result) => result.id === 'persistence_prisma_client' && result.status === 'failed'));
  assert.ok(report.results.some((result) => result.id === 'persistence_api_route' && result.status === 'failed'));
  assert.ok(report.results.some((result) => result.id === 'persistence_db_check_script' && result.status === 'failed'));
  assert.ok(report.results.some((result) => result.id === 'node_build' && result.status === 'blocked'));
  assert.ok(report.results.some((result) => result.id === 'node_test' && result.status === 'blocked'));
  assert.deepStrictEqual(calls, []);
}

async function testPostgresFailureBlocksLaterBuildAndE2e(tempRoot) {
  const rootPath = path.join(tempRoot, 'postgres-operational-gate');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'next build',
      test: 'vitest run',
      'test:e2e': 'playwright test',
      'db:up': 'docker compose up -d postgres',
      'db:generate': 'prisma generate',
      'db:migrate': 'prisma migrate deploy',
      'db:seed': 'node scripts/seed.mjs',
      'db:check': 'node scripts/db-check.mjs',
    },
    dependencies: {
      '@prisma/client': '^5.22.0',
      next: '15.5.19',
      react: '19.2.7',
    },
    devDependencies: {
      '@playwright/test': '^1.51.1',
      prisma: '^5.22.0',
      vitest: '^3.0.0',
    },
    prisma: {
      seed: 'node scripts/seed.mjs',
    },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  writeFile(path.join(rootPath, 'app/api/forge/snapshot/route.ts'), 'export async function GET() { return Response.json({ ok: true }); }');
  writeFile(path.join(rootPath, 'app/globals.css'), '@import "tailwindcss";');
  writeFile(path.join(rootPath, 'docker-compose.yml'), 'services:\n  postgres:\n    image: postgres:16-alpine\n');
  writeFile(path.join(rootPath, 'prisma/schema.prisma'), 'datasource db { provider = "postgresql" url = env("DATABASE_URL") }');
  writeFile(path.join(rootPath, 'prisma/migrations/202606110001_init/migration.sql'), 'CREATE TABLE "Item" ("id" TEXT PRIMARY KEY);');
  writeFile(path.join(rootPath, 'scripts/seed.mjs'), 'console.log("seed");');
  writeFile(path.join(rootPath, 'scripts/db-check.mjs'), 'console.log("db ok");');
  writeFile(path.join(rootPath, 'src/server/prisma.ts'), 'export const prisma = {};');
  writeFile(path.join(rootPath, 'src/server/forge_repository.ts'), 'export const forgeRepository = {};');
  writeFile(path.join(rootPath, 'playwright.config.ts'), 'export default {};');
  writeInstalledPackage(rootPath, '@prisma/client', '5.22.0');
  writeInstalledPackage(rootPath, '@playwright/test', '1.51.1');
  writeInstalledPackage(rootPath, 'next', '15.5.19');
  writeInstalledPackage(rootPath, 'react', '19.2.7');
  writeInstalledPackage(rootPath, 'prisma', '5.22.0');
  writeInstalledPackage(rootPath, 'vitest', '3.0.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      if (args.join(' ') === 'run db:up') return { ok: false, stdout: '', stderr: 'Docker daemon unavailable' };
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  const report = await service.runProjectVerification(
    createProjectInfo(rootPath, [
      'package.json',
      'app/page.tsx',
      'app/api/forge/snapshot/route.ts',
      'app/globals.css',
      'docker-compose.yml',
      'prisma/schema.prisma',
      'prisma/migrations/202606110001_init/migration.sql',
      'scripts/seed.mjs',
      'scripts/db-check.mjs',
      'src/server/prisma.ts',
      'src/server/forge_repository.ts',
      'playwright.config.ts',
    ], ['Next.js']),
    {
      requiredNodeScripts: ['build', 'test'],
      requirePersistence: true,
      requirePlaywright: 'if_available',
      userMessage: 'precisa de Postgres local com Prisma e Playwright',
    }
  );

  const stepIds = report.plan.steps.map((step) => step.id);
  assert.ok(stepIds.indexOf('persistence_db_up') < stepIds.indexOf('node_build'));
  assert.ok(stepIds.indexOf('node_build') < stepIds.indexOf('node_playwright'));
  assert.strictEqual(report.ready, false);
  assert.ok(report.results.some((result) => result.id === 'persistence_db_up' && result.status === 'failed'));
  assert.ok(report.results.some((result) => result.id === 'persistence_db_generate' && result.status === 'blocked'));
  assert.ok(report.results.some((result) => result.id === 'node_build' && result.status === 'blocked'));
  assert.ok(report.results.some((result) => result.id === 'node_playwright' && result.status === 'blocked'));
  assert.deepStrictEqual(calls, [
    ['npm', 'run db:up'],
  ]);
}

async function testLampProjectRunsPhpLint(tempRoot) {
  const rootPath = path.join(tempRoot, 'lamp-ready');
  writeFile(path.join(rootPath, 'index.php'), '<?php echo "ok";');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args, options) => {
      calls.push({ bin, args, options });
      return { ok: true, stdout: 'No syntax errors detected', stderr: '' };
    },
  });

  const report = await service.runProjectVerification(createProjectInfo(rootPath, ['index.php'], ['PHP/LAMP']));
  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls.map((call) => [call.bin, call.args.join(' ')]), [['php', '-l index.php']]);
}

async function testElectronProjectChecksPackageAndEntryWithoutForcingBuild(tempRoot) {
  const rootPath = path.join(tempRoot, 'electron-ready');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'electron .',
    },
    dependencies: {
      react: '^19.0.0',
    },
    devDependencies: {
      electron: '^38.0.0',
    },
  });
  writeFile(path.join(rootPath, 'main.js'), 'require("electron");');
  writeInstalledPackage(rootPath, 'react', '19.0.0');
  writeInstalledPackage(rootPath, 'electron', '38.0.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });

  const report = await service.runProjectVerification(createProjectInfo(rootPath, [
    'package.json',
    'main.js',
  ], ['Electron', 'React']));

  assert.strictEqual(report.ready, true);
  assert.ok(report.results.some((result) => result.id === 'electron_package' && result.status === 'passed'));
  assert.ok(report.results.some((result) => result.id === 'electron_entry' && result.status === 'passed'));
  assert.deepStrictEqual(calls, []);
}

async function testMissingPhpBinaryIsWarning(tempRoot) {
  const rootPath = path.join(tempRoot, 'lamp-no-php');
  writeFile(path.join(rootPath, 'index.php'), '<?php echo "ok";');

  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async () => ({ ok: false, code: 127, stdout: '', stderr: 'php: command not found' }),
  });

  const report = await service.runProjectVerification(createProjectInfo(rootPath, ['index.php'], ['PHP/LAMP']));
  assert.strictEqual(report.ready, true);
  assert.ok(report.results.some((result) => result.status === 'warning' && result.commandText === 'php -l index.php'));
}

function testMissingRootPathIsRejected() {
  const service = createProjectVerificationService({ fs, path });
  const plan = service.buildProjectVerificationPlan({});
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.rootPath, '');
  assert.ok(plan.message.includes('rootPath'));
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-verification-test-'));
  try {
    testMissingRootPathIsRejected();
    await testNextProjectRunsAvailableChecks(tempRoot);
    await testNextProjectInstallsDependenciesBeforeChecks(tempRoot);
    await testNextProjectUpdatesStaleDependenciesBeforeBuild(tempRoot);
    await testPlaceholderTestScriptIsSkipped(tempRoot);
    await testStrictNodeVerificationRequiresRealTestAndPlaywright(tempRoot);
    await testStrictNodeVerificationRunsPlaywrightScript(tempRoot);
    await testPlaywrightIfAvailableDoesNotBlockMissingPlaywright(tempRoot);
    await testPostgresPersistenceRequiresOperationalEvidence(tempRoot);
    await testPostgresFailureBlocksLaterBuildAndE2e(tempRoot);
    await testLampProjectRunsPhpLint(tempRoot);
    await testElectronProjectChecksPackageAndEntryWithoutForcingBuild(tempRoot);
    await testMissingPhpBinaryIsWarning(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('project-verification-service.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
