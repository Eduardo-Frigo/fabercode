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

async function testUnresolvedLocalModuleImportBlocksBuild(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-missing-local-module');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: { build: 'next build' },
    dependencies: { next: '16.0.0', react: '19.0.0' },
  });
  writeJson(path.join(rootPath, 'tsconfig.json'), {
    compilerOptions: {
      baseUrl: '.',
      paths: { '@/*': ['./*'] },
    },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), [
    "import { listItems } from '@/lib/items';",
    'export default function Page() { return <main>{listItems().length}</main>; }',
  ].join('\n'));
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
  const missingInfo = createProjectInfo(rootPath, [
    'package.json',
    'tsconfig.json',
    'app/page.tsx',
  ], ['Next.js']);
  const missingPlan = service.buildProjectVerificationPlan(missingInfo);
  const missingStep = missingPlan.steps.find((step) => step.id === 'local_module_resolution');
  assert.ok(missingStep);
  assert.strictEqual(missingStep.expectedStatus, 'failed');
  assert.match(missingStep.detail, /app\/page\.tsx.*@\/lib\/items/);

  const missingReport = await service.runProjectVerification(missingInfo);
  assert.strictEqual(missingReport.ready, false);
  assert.ok(missingReport.results.some((result) => (
    result.id === 'node_build'
      && result.status === 'blocked'
      && result.blockedBy.includes('local_module_resolution')
  )));
  assert.deepStrictEqual(calls, []);

  writeFile(path.join(rootPath, 'lib/items.ts'), 'export const listItems = () => [];\n');
  const readyInfo = createProjectInfo(rootPath, [
    'package.json',
    'tsconfig.json',
    'app/page.tsx',
    'lib/items.ts',
  ], ['Next.js']);
  const readyPlan = service.buildProjectVerificationPlan(readyInfo);
  const readyStep = readyPlan.steps.find((step) => step.id === 'local_module_resolution');
  assert.ok(readyStep);
  assert.strictEqual(readyStep.expectedStatus, 'passed');

  const readyReport = await service.runProjectVerification(readyInfo);
  assert.strictEqual(readyReport.ready, true);
  assert.deepStrictEqual(calls, [['npm', 'run build']]);

  writeFile(path.join(rootPath, 'tsconfig.json'), [
    '{',
    '  // JSONC comments are valid.',
    '  "compilerOptions": {',
    '    "baseUrl": ".",',
    '    "paths": { "@/*": ["./*"] },',
    '  },',
    '}',
  ].join('\n'));
  const validJsoncPlan = service.buildProjectVerificationPlan(readyInfo);
  assert.strictEqual(
    validJsoncPlan.steps.find((step) => step.id === 'project_json_syntax').expectedStatus,
    'passed'
  );

  writeFile(path.join(rootPath, 'tsconfig.json'), [
    '{',
    '  // JSONC comments and trailing commas remain valid.',
    '  "compilerOptions": {',
    '    "baseUrl": ".",',
    '    "paths": { "@/*": ["./*"] },',
    '    "moduleResolution": "bundler" "jsx": "preserve"',
    '  },',
    '}',
  ].join('\n'));
  const malformedPlan = service.buildProjectVerificationPlan(readyInfo);
  const malformedStep = malformedPlan.steps.find((step) => step.id === 'project_json_syntax');
  assert.ok(malformedStep);
  assert.strictEqual(malformedStep.expectedStatus, 'failed');
  assert.match(malformedStep.detail, /tsconfig\.json/);

  const malformedReport = await service.runProjectVerification(readyInfo);
  assert.strictEqual(malformedReport.ready, false);
  assert.ok(malformedReport.results.some((result) => (
    result.id === 'node_build'
      && result.status === 'blocked'
      && result.blockedBy.includes('project_json_syntax')
  )));
  assert.deepStrictEqual(calls, [['npm', 'run build']]);
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

async function testPostgresCorpusOfflineModeUsesDbCheckWithoutStartingDocker(tempRoot) {
  const rootPath = path.join(tempRoot, 'postgres-corpus-offline');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'next build',
      test: 'node --test',
      'db:generate': 'prisma generate',
      'db:check': 'node scripts/db-check.mjs',
    },
    dependencies: {
      '@prisma/client': '^5.22.0',
      next: '15.5.19',
      react: '19.2.7',
    },
    devDependencies: {
      prisma: '^5.22.0',
    },
    prisma: {
      seed: 'node scripts/seed.mjs',
    },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  writeFile(path.join(rootPath, 'app/api/items/route.ts'), 'export async function GET() { return Response.json([]); }');
  writeFile(path.join(rootPath, 'docker-compose.yml'), 'services:\n  postgres:\n    image: postgres:16-alpine\n');
  writeFile(path.join(rootPath, 'prisma/schema.prisma'), 'datasource db { provider = "postgresql" url = env("DATABASE_URL") }');
  writeFile(path.join(rootPath, 'prisma/migrations/202608270001_init/migration.sql'), 'CREATE TABLE "Item" ("id" TEXT PRIMARY KEY);');
  writeFile(path.join(rootPath, 'scripts/seed.mjs'), 'console.log("seed");');
  writeFile(path.join(rootPath, 'scripts/db-check.mjs'), 'console.log("offline schema ok");');
  writeFile(path.join(rootPath, 'src/server/prisma.ts'), 'export const prisma = {};');
  writeFile(path.join(rootPath, 'src/server/item_repository.ts'), 'export const itemRepository = {};');
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
  const projectInfo = createProjectInfo(rootPath, [
    'package.json',
    'app/page.tsx',
    'app/api/items/route.ts',
    'docker-compose.yml',
    'prisma/schema.prisma',
    'prisma/migrations/202608270001_init/migration.sql',
    'scripts/seed.mjs',
    'scripts/db-check.mjs',
    'src/server/prisma.ts',
    'src/server/item_repository.ts',
  ], ['Next.js']);
  const options = {
    requiredNodeScripts: ['build', 'test'],
    requirePersistence: true,
    persistenceValidationMode: 'offline',
    userMessage: 'Crie app Next com Prisma, Postgres, migration e seed.',
  };
  const plan = service.buildProjectVerificationPlan(projectInfo, options);
  const stepIds = plan.steps.map((step) => step.id);
  assert.strictEqual(stepIds.includes('persistence_db_up'), false);
  assert.strictEqual(stepIds.includes('persistence_db_generate'), false);
  assert.strictEqual(stepIds.includes('persistence_db_migrate'), false);
  assert.strictEqual(stepIds.includes('persistence_db_seed'), false);
  assert.ok(stepIds.includes('persistence_db_check'));

  const report = await service.runProjectVerification(projectInfo, options);
  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls, [
    ['npm', 'run db:check'],
    ['npm', 'run build'],
    ['npm', 'test'],
  ]);
}

async function testSqliteDrizzleUsesItsOwnPersistenceGate(tempRoot) {
  const rootPath = path.join(tempRoot, 'sqlite-drizzle-ready');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'tsc --noEmit',
      test: 'node tests/repository.test.js',
      'db:migrate': 'drizzle-kit migrate',
      'db:check': 'node scripts/db-check.js',
    },
    dependencies: {
      'better-sqlite3': '^12.0.0',
      'drizzle-orm': '^0.44.0',
    },
    devDependencies: {
      'drizzle-kit': '^0.31.0',
      typescript: '^5.9.0',
    },
  });
  writeFile(path.join(rootPath, 'drizzle.config.ts'), 'export default { dialect: "sqlite", schema: "./src/db/schema.ts" };');
  writeFile(path.join(rootPath, 'src/db/schema.ts'), 'export const schema = {};');
  writeFile(path.join(rootPath, 'src/db/item_repository.ts'), 'export const itemRepository = {};');
  writeFile(path.join(rootPath, 'drizzle/0000_init.sql'), 'CREATE TABLE item (id TEXT PRIMARY KEY);');
  writeFile(path.join(rootPath, 'scripts/db-check.js'), 'console.log("db ok");');
  writeFile(path.join(rootPath, 'tests/repository.test.js'), 'console.log("ok");');
  writeInstalledPackage(rootPath, 'better-sqlite3', '12.0.0');
  writeInstalledPackage(rootPath, 'drizzle-orm', '0.44.0');
  writeInstalledPackage(rootPath, 'drizzle-kit', '0.31.0');
  writeInstalledPackage(rootPath, 'typescript', '5.9.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  const projectInfo = createProjectInfo(rootPath, [
    'package.json',
    'drizzle.config.ts',
    'src/db/schema.ts',
    'src/db/item_repository.ts',
    'drizzle/0000_init.sql',
    'scripts/db-check.js',
    'tests/repository.test.js',
  ], ['Node/Express']);
  const options = {
    requirePersistence: true,
    userMessage: 'Crie persistência real usando banco SQLite e Drizzle.',
  };
  const plan = service.buildProjectVerificationPlan(projectInfo, options);
  const stepIds = plan.steps.map((step) => step.id);
  assert.ok(stepIds.includes('persistence_drizzle_config'));
  assert.ok(stepIds.includes('persistence_drizzle_schema'));
  assert.ok(stepIds.includes('persistence_drizzle_migration'));
  assert.ok(stepIds.includes('persistence_sqlite_driver'));
  assert.ok(stepIds.includes('persistence_db_migrate'));
  assert.ok(stepIds.includes('persistence_db_check'));
  assert.strictEqual(stepIds.includes('persistence_prisma_schema'), false);
  assert.strictEqual(stepIds.includes('persistence_docker_compose'), false);
  assert.strictEqual(stepIds.includes('persistence_db_up'), false);

  const report = await service.runProjectVerification(projectInfo, options);
  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls, [
    ['npm', 'run db:migrate'],
    ['npm', 'run db:check'],
    ['npm', 'run build'],
    ['npm', 'test'],
  ]);
}

async function testSupabaseUsesItsOwnManagedPersistenceGate(tempRoot) {
  const rootPath = path.join(tempRoot, 'supabase-managed');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'tsc --noEmit',
      test: 'node tests/repository.test.js',
      'db:check': 'node scripts/db-check.js',
    },
    dependencies: {
      '@supabase/supabase-js': '^2.55.0',
    },
    devDependencies: {
      typescript: '^5.9.0',
    },
  });
  writeFile(path.join(rootPath, 'supabase/config.toml'), 'project_id = "localcode"\n');
  writeFile(path.join(rootPath, 'supabase/migrations/202608260001_init.sql'), 'CREATE TABLE item (id uuid PRIMARY KEY);');
  writeFile(path.join(rootPath, 'src/lib/supabase.ts'), 'export const supabase = {};');
  writeFile(path.join(rootPath, 'scripts/db-check.js'), 'console.log("db ok");');
  writeFile(path.join(rootPath, 'tests/repository.test.js'), 'console.log("ok");');
  writeInstalledPackage(rootPath, '@supabase/supabase-js', '2.55.0');
  writeInstalledPackage(rootPath, 'typescript', '5.9.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  const projectInfo = createProjectInfo(rootPath, [
    'package.json',
    'supabase/config.toml',
    'supabase/migrations/202608260001_init.sql',
    'src/lib/supabase.ts',
    'scripts/db-check.js',
    'tests/repository.test.js',
  ], ['Node/Express']);
  const options = {
    requirePersistence: true,
    userMessage: 'Crie backend persistente com Supabase e migration SQL.',
  };
  const plan = service.buildProjectVerificationPlan(projectInfo, options);
  const stepIds = plan.steps.map((step) => step.id);
  assert.ok(stepIds.includes('persistence_supabase_dependency'));
  assert.ok(stepIds.includes('persistence_supabase_config'));
  assert.ok(stepIds.includes('persistence_supabase_migration'));
  assert.ok(stepIds.includes('persistence_supabase_client'));
  assert.ok(stepIds.includes('persistence_db_check'));
  assert.strictEqual(stepIds.includes('persistence_prisma_schema'), false);
  assert.strictEqual(stepIds.includes('persistence_docker_compose'), false);
  assert.strictEqual(stepIds.includes('persistence_drizzle_config'), false);
  assert.strictEqual(stepIds.includes('persistence_firebase_config'), false);

  const report = await service.runProjectVerification(projectInfo, options);
  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls, [
    ['npm', 'run db:check'],
    ['npm', 'run build'],
    ['npm', 'test'],
  ]);
}

async function testFirebaseUsesItsOwnManagedPersistenceGate(tempRoot) {
  const rootPath = path.join(tempRoot, 'firebase-managed');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'tsc --noEmit',
      test: 'node tests/firestore-rules.test.js',
      'db:check': 'node scripts/db-check.js',
    },
    dependencies: {
      firebase: '^12.2.0',
    },
    devDependencies: {
      typescript: '^5.9.0',
    },
  });
  writeJson(path.join(rootPath, 'firebase.json'), {
    firestore: { rules: 'firestore.rules' },
    emulators: { firestore: { port: 8080 } },
  });
  writeFile(path.join(rootPath, 'firestore.rules'), 'rules_version = "2";');
  writeFile(path.join(rootPath, 'src/lib/firebase.ts'), 'export const firebaseApp = {};');
  writeFile(path.join(rootPath, 'scripts/db-check.js'), 'console.log("db ok");');
  writeFile(path.join(rootPath, 'tests/firestore-rules.test.js'), 'console.log("ok");');
  writeInstalledPackage(rootPath, 'firebase', '12.2.0');
  writeInstalledPackage(rootPath, 'typescript', '5.9.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  const projectInfo = createProjectInfo(rootPath, [
    'package.json',
    'firebase.json',
    'firestore.rules',
    'src/lib/firebase.ts',
    'scripts/db-check.js',
    'tests/firestore-rules.test.js',
  ], ['Node/Express']);
  const options = {
    requirePersistence: true,
    userMessage: 'Crie persistência gerenciada usando Firebase Firestore.',
  };
  const plan = service.buildProjectVerificationPlan(projectInfo, options);
  const stepIds = plan.steps.map((step) => step.id);
  assert.ok(stepIds.includes('persistence_firebase_dependency'));
  assert.ok(stepIds.includes('persistence_firebase_config'));
  assert.ok(stepIds.includes('persistence_firebase_rules'));
  assert.ok(stepIds.includes('persistence_firebase_client'));
  assert.ok(stepIds.includes('persistence_db_check'));
  assert.strictEqual(stepIds.includes('persistence_prisma_schema'), false);
  assert.strictEqual(stepIds.includes('persistence_docker_compose'), false);
  assert.strictEqual(stepIds.includes('persistence_drizzle_config'), false);
  assert.strictEqual(stepIds.includes('persistence_supabase_config'), false);

  const report = await service.runProjectVerification(projectInfo, options);
  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls, [
    ['npm', 'run db:check'],
    ['npm', 'run build'],
    ['npm', 'test'],
  ]);
}

async function testFastApiUsesPythonVerificationWithoutNodeRules(tempRoot) {
  const rootPath = path.join(tempRoot, 'fastapi-ready');
  writeFile(path.join(rootPath, 'requirements.txt'), [
    'fastapi==0.116.1',
    'uvicorn==0.35.0',
    'pytest==8.4.1',
    '',
  ].join('\n'));
  writeFile(path.join(rootPath, 'backend/app/main.py'), 'from fastapi import FastAPI\napp = FastAPI()\n');
  writeFile(path.join(rootPath, 'backend/tests/test_health.py'), 'def test_health():\n    assert True\n');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  const projectInfo = createProjectInfo(rootPath, [
    'requirements.txt',
    'backend/app/main.py',
    'backend/tests/test_health.py',
  ], ['Python/FastAPI']);
  const plan = service.buildProjectVerificationPlan(projectInfo);
  const stepIds = plan.steps.map((step) => step.id);
  assert.ok(stepIds.includes('fastapi_dependency'));
  assert.ok(stepIds.includes('fastapi_entry'));
  assert.ok(stepIds.includes('python_compile'));
  assert.ok(stepIds.includes('python_pytest'));
  assert.strictEqual(stepIds.some((id) => id.startsWith('node_')), false);
  assert.strictEqual(stepIds.includes('persistence_prisma_schema'), false);

  const report = await service.runProjectVerification(projectInfo);
  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls, [
    ['python3', '-m py_compile backend/app/main.py'],
    ['python3', '-m pytest'],
  ]);
}

async function testFastApiUsesOfflineUnittestAndRecognizesDecoratorCrud(tempRoot) {
  const rootPath = path.join(tempRoot, 'fastapi-unittest-offline');
  writeFile(path.join(rootPath, 'requirements.txt'), [
    'fastapi==0.116.1',
    'uvicorn==0.35.0',
    '',
  ].join('\n'));
  writeFile(path.join(rootPath, 'backend/app/main.py'), [
    'from fastapi import FastAPI',
    'app = FastAPI()',
    'items = {}',
    '@app.post("/items")',
    'def create_item(item: dict): items[item["id"]] = item; return item',
    '@app.get("/items")',
    'def list_items(): return list(items.values())',
    '@app.put("/items/{item_id}")',
    'def update_item(item_id: str, item: dict): items[item_id] = item; return item',
    '@app.delete("/items/{item_id}")',
    'def delete_item(item_id: str): return items.pop(item_id)',
    '',
  ].join('\n'));
  writeFile(path.join(rootPath, 'backend/tests/test_items.py'), [
    'import unittest',
    'class ItemsTest(unittest.TestCase):',
    '    def test_crud_contract(self):',
    '        self.assertTrue(True)',
    '',
  ].join('\n'));

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  const projectInfo = createProjectInfo(rootPath, [
    'requirements.txt',
    'backend/app/main.py',
    'backend/tests/test_items.py',
  ], ['Python/FastAPI']);
  const options = {
    requirePythonTests: true,
    userMessage: 'Crie uma API FastAPI com CRUD completo em memória.',
  };
  const plan = service.buildProjectVerificationPlan(projectInfo, options);
  const crudStep = plan.steps.find((step) => step.id === 'acceptance_crud');
  assert.ok(crudStep);
  assert.strictEqual(crudStep.expectedStatus, 'passed');
  assert.ok(plan.steps.some((step) => step.id === 'python_unittest'));
  assert.strictEqual(plan.steps.some((step) => step.id === 'python_pytest'), false);

  const report = await service.runProjectVerification(projectInfo, options);
  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls, [
    ['python3', '-m py_compile backend/app/main.py'],
    ['python3', '-m unittest discover -s backend/tests -p test_*.py'],
  ]);
}

async function testFastApiCompileFailureBlocksPytest(tempRoot) {
  const rootPath = path.join(tempRoot, 'fastapi-compile-failure');
  writeFile(path.join(rootPath, 'pyproject.toml'), [
    '[project]',
    'dependencies = ["fastapi>=0.116", "uvicorn>=0.35"]',
    '[tool.pytest.ini_options]',
    'testpaths = ["tests"]',
    '',
  ].join('\n'));
  writeFile(path.join(rootPath, 'app/main.py'), 'from fastapi import FastAPI\napp = FastAPI(\n');
  writeFile(path.join(rootPath, 'tests/test_health.py'), 'def test_health():\n    assert True\n');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      if (args.join(' ') === '-m py_compile app/main.py') {
        return { ok: false, stdout: '', stderr: 'SyntaxError: invalid syntax' };
      }
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  const report = await service.runProjectVerification(createProjectInfo(rootPath, [
    'pyproject.toml',
    'app/main.py',
    'tests/test_health.py',
  ], ['FastAPI']));

  assert.strictEqual(report.ready, false);
  assert.deepStrictEqual(calls, [['python3', '-m py_compile app/main.py']]);
  assert.ok(report.results.some((result) => result.id === 'python_compile' && result.status === 'failed'));
  assert.ok(report.results.some((result) => result.id === 'python_pytest' && result.status === 'blocked'));
}

async function testMonorepoUsesWorkspaceRootGateWithoutChildStackAssumptions(tempRoot) {
  const rootPath = path.join(tempRoot, 'monorepo-ready');
  writeJson(path.join(rootPath, 'package.json'), {
    private: true,
    workspaces: ['apps/*', 'packages/*'],
    scripts: {
      build: 'turbo run build',
      test: 'turbo run test',
    },
    devDependencies: {
      turbo: '^2.5.0',
    },
  });
  writeJson(path.join(rootPath, 'apps/web/package.json'), {
    name: '@localcode/web',
    dependencies: { next: '^16.0.0', react: '^19.0.0' },
  });
  writeJson(path.join(rootPath, 'packages/shared/package.json'), {
    name: '@localcode/shared',
  });
  writeFile(path.join(rootPath, 'apps/web/app/page.tsx'), 'export default function Page() { return <main />; }');
  writeInstalledPackage(rootPath, 'turbo', '2.5.0');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  const projectInfo = createProjectInfo(rootPath, [
    'package.json',
    'apps/web/package.json',
    'apps/web/app/page.tsx',
    'packages/shared/package.json',
  ], ['Monorepo']);
  const plan = service.buildProjectVerificationPlan(projectInfo);
  const stepIds = plan.steps.map((step) => step.id);
  assert.ok(stepIds.includes('monorepo_root_manifest'));
  assert.ok(stepIds.includes('monorepo_workspace_config'));
  assert.ok(stepIds.includes('monorepo_package_manifest'));
  assert.ok(stepIds.includes('node_build'));
  assert.ok(stepIds.includes('node_test'));
  assert.strictEqual(plan.steps.find((step) => step.id === 'node_build').required, true);
  assert.strictEqual(plan.steps.find((step) => step.id === 'node_test').required, true);
  assert.strictEqual(stepIds.includes('next_entry'), false);
  assert.strictEqual(stepIds.includes('persistence_prisma_schema'), false);

  const report = await service.runProjectVerification(projectInfo);
  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(calls, [
    ['npm', 'run build'],
    ['npm', 'test'],
  ]);
}

async function testStaticWebUsesOnlyItsOwnEntryGate(tempRoot) {
  const rootPath = path.join(tempRoot, 'static-web-ready');
  writeFile(path.join(rootPath, 'index.html'), '<!doctype html><main id="app"></main>');
  writeFile(path.join(rootPath, 'style.css'), 'body { margin: 0; }');
  writeFile(path.join(rootPath, 'app.js'), 'document.querySelector("#app").textContent = "ok";');

  const calls = [];
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args) => {
      calls.push([bin, args.join(' ')]);
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  const projectInfo = createProjectInfo(rootPath, [
    'index.html',
    'style.css',
    'app.js',
  ], ['Static Web']);
  const report = await service.runProjectVerification(projectInfo);
  const stepIds = report.plan.steps.map((step) => step.id);

  assert.strictEqual(report.ready, true);
  assert.deepStrictEqual(stepIds, ['static_web_entry']);
  assert.deepStrictEqual(calls, []);
}

function testRequestedProductCapabilitiesRequireStructuralEvidence(tempRoot) {
  const readyRoot = path.join(tempRoot, 'requested-capabilities-ready');
  writeJson(path.join(readyRoot, 'package.json'), {
    scripts: { build: 'next build', test: 'vitest run' },
    dependencies: { next: '^16.0.0', react: '^19.0.0' },
  });
  writeFile(path.join(readyRoot, 'app/page.tsx'), [
    'export default function Page() {',
    '  const data = new FormData();',
    '  return <input type="file" onChange={() => data.append("file", "selected")} />;',
    '}',
  ].join('\n'));
  writeFile(path.join(readyRoot, 'app/login/page.tsx'), 'export default function Login() { return <form />; }');
  writeFile(path.join(readyRoot, 'app/dashboard/page.tsx'), 'export default function Dashboard() { return <main />; }');
  writeFile(path.join(readyRoot, 'src/server/auth_service.ts'), [
    'export async function authenticate(email, password) {',
    '  return verifyPassword(email, password);',
    '}',
  ].join('\n'));
  writeFile(path.join(readyRoot, 'src/server/item_repository.ts'), [
    'export const itemRepository = {',
    '  create: async (item) => item,',
    '  findMany: async () => [],',
    '  update: async (id, item) => item,',
    '  delete: async (id) => id,',
    '};',
  ].join('\n'));
  writeFile(path.join(readyRoot, 'app/api/upload/route.ts'), [
    'export async function POST(request) {',
    '  const formData = await request.formData();',
    '  const file = formData.get("file");',
    '  return storage.upload(file);',
    '}',
  ].join('\n'));
  const service = createProjectVerificationService({ fs, path });
  const userMessage = 'Crie um app com autenticação, CRUD completo, upload de arquivos e múltiplas rotas.';
  const readyPlan = service.buildProjectVerificationPlan(createProjectInfo(readyRoot, [
    'package.json',
    'app/page.tsx',
    'app/login/page.tsx',
    'app/dashboard/page.tsx',
    'src/server/auth_service.ts',
    'src/server/item_repository.ts',
    'app/api/upload/route.ts',
  ], ['Next.js']), { userMessage });
  for (const id of [
    'acceptance_auth',
    'acceptance_crud',
    'acceptance_upload',
    'acceptance_multiple_routes',
  ]) {
    const step = readyPlan.steps.find((entry) => entry.id === id);
    assert.ok(step, `missing requested capability check ${id}`);
    assert.strictEqual(step.expectedStatus, 'passed');
    assert.strictEqual(step.required, true);
  }
  assert.strictEqual(
    readyPlan.steps.some((step) => step.id === 'persistence_prisma_schema'),
    false,
  );

  const missingRoot = path.join(tempRoot, 'requested-capabilities-missing');
  writeJson(path.join(missingRoot, 'package.json'), {
    scripts: { build: 'next build', test: 'vitest run' },
    dependencies: { next: '^16.0.0', react: '^19.0.0' },
  });
  writeFile(path.join(missingRoot, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  const missingPlan = service.buildProjectVerificationPlan(createProjectInfo(missingRoot, [
    'package.json',
    'app/page.tsx',
  ], ['Next.js']), { userMessage });
  for (const id of [
    'acceptance_auth',
    'acceptance_crud',
    'acceptance_upload',
    'acceptance_multiple_routes',
  ]) {
    const step = missingPlan.steps.find((entry) => entry.id === id);
    assert.ok(step, `missing failing requested capability check ${id}`);
    assert.strictEqual(step.expectedStatus, 'failed');
    assert.strictEqual(step.required, true);
  }
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
    await testUnresolvedLocalModuleImportBlocksBuild(tempRoot);
    await testPlaceholderTestScriptIsSkipped(tempRoot);
    await testStrictNodeVerificationRequiresRealTestAndPlaywright(tempRoot);
    await testStrictNodeVerificationRunsPlaywrightScript(tempRoot);
    await testPlaywrightIfAvailableDoesNotBlockMissingPlaywright(tempRoot);
    await testPostgresPersistenceRequiresOperationalEvidence(tempRoot);
    await testPostgresFailureBlocksLaterBuildAndE2e(tempRoot);
    await testPostgresCorpusOfflineModeUsesDbCheckWithoutStartingDocker(tempRoot);
    await testSqliteDrizzleUsesItsOwnPersistenceGate(tempRoot);
    await testSupabaseUsesItsOwnManagedPersistenceGate(tempRoot);
    await testFirebaseUsesItsOwnManagedPersistenceGate(tempRoot);
    await testFastApiUsesPythonVerificationWithoutNodeRules(tempRoot);
    await testFastApiUsesOfflineUnittestAndRecognizesDecoratorCrud(tempRoot);
    await testFastApiCompileFailureBlocksPytest(tempRoot);
    await testMonorepoUsesWorkspaceRootGateWithoutChildStackAssumptions(tempRoot);
    await testStaticWebUsesOnlyItsOwnEntryGate(tempRoot);
    testRequestedProductCapabilitiesRequireStructuralEvidence(tempRoot);
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
