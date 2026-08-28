const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  createApplicationCreationCorpusEvaluator,
} = require('../main/services/application_creation_corpus_service');
const {
  createProjectVerificationService,
} = require('../main/services/project_verification_service');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function listProjectFiles(rootPath) {
  const files = [];
  const pending = [rootPath];
  while (pending.length) {
    const current = pending.pop();
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      if (dirent.name === 'node_modules' || dirent.name === '.git') continue;
      const absPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) pending.push(absPath);
      else files.push(path.relative(rootPath, absPath).replace(/\\/g, '/'));
    }
  }
  return files.sort();
}

function createProjectInfo(rootPath, stacks) {
  const files = listProjectFiles(rootPath);
  return {
    rootPath,
    totalFiles: files.length,
    scannedFiles: files.length,
    truncated: false,
    files,
    stacks,
    counters: {},
  };
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function snapshotDirtyWorktree(rootPath) {
  return {
    status: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: rootPath,
      encoding: 'utf8',
    }),
    sourceHash: sha256(path.join(rootPath, 'src/existing.js')),
    notesHash: sha256(path.join(rootPath, 'user-notes.md')),
  };
}

function createNextBackend(rootPath) {
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: { build: 'next build', test: 'vitest run' },
    dependencies: { next: '^16.0.0', react: '^19.0.0' },
    devDependencies: { vitest: '^3.2.0' },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  writeFile(path.join(rootPath, 'app/api/items/route.ts'), 'export async function GET() { return Response.json([]); }');
}

function createSupabase(rootPath) {
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: { build: 'tsc --noEmit', test: 'vitest run', 'db:check': 'node scripts/db-check.js' },
    dependencies: { '@supabase/supabase-js': '^2.55.0' },
    devDependencies: { typescript: '^5.9.0', vitest: '^3.2.0' },
  });
  writeFile(path.join(rootPath, 'supabase/config.toml'), 'project_id = "corpus"\n');
  writeFile(path.join(rootPath, 'supabase/migrations/202608260001_init.sql'), 'CREATE TABLE item (id uuid PRIMARY KEY);');
  writeFile(path.join(rootPath, 'src/lib/supabase.ts'), 'export const supabase = createClient(url, key);');
  writeFile(path.join(rootPath, 'scripts/db-check.js'), 'console.log("db ok");');
}

function createFirebase(rootPath) {
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: { build: 'tsc --noEmit', test: 'vitest run', 'db:check': 'node scripts/db-check.js' },
    dependencies: { firebase: '^12.2.0' },
    devDependencies: { typescript: '^5.9.0', vitest: '^3.2.0' },
  });
  writeJson(path.join(rootPath, 'firebase.json'), { firestore: { rules: 'firestore.rules' } });
  writeFile(path.join(rootPath, 'firestore.rules'), 'rules_version = "2";');
  writeFile(path.join(rootPath, 'src/lib/firebase.ts'), 'export const firebaseApp = initializeApp(config);');
  writeFile(path.join(rootPath, 'scripts/db-check.js'), 'console.log("db ok");');
}

function createPrismaPostgres(rootPath) {
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'next build',
      test: 'vitest run',
      'db:up': 'docker compose up -d postgres',
      'db:generate': 'prisma generate',
      'db:migrate': 'prisma migrate deploy',
      'db:seed': 'node scripts/seed.mjs',
      'db:check': 'node scripts/db-check.mjs',
    },
    dependencies: { '@prisma/client': '^5.22.0', next: '^16.0.0', react: '^19.0.0' },
    devDependencies: { prisma: '^5.22.0', vitest: '^3.2.0' },
    prisma: { seed: 'node scripts/seed.mjs' },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), 'export default function Page() { return <main />; }');
  writeFile(path.join(rootPath, 'app/api/items/route.ts'), 'export async function GET() { return Response.json([]); }');
  writeFile(path.join(rootPath, 'docker-compose.yml'), 'services:\n  postgres:\n    image: postgres:16-alpine\n');
  writeFile(path.join(rootPath, 'prisma/schema.prisma'), 'datasource db { provider = "postgresql" url = env("DATABASE_URL") }');
  writeFile(path.join(rootPath, 'prisma/migrations/202608260001_init/migration.sql'), 'CREATE TABLE "Item" ("id" TEXT PRIMARY KEY);');
  writeFile(path.join(rootPath, 'scripts/seed.mjs'), 'console.log("seed");');
  writeFile(path.join(rootPath, 'scripts/db-check.mjs'), 'console.log("db ok");');
  writeFile(path.join(rootPath, 'src/server/prisma.ts'), 'export const prisma = new PrismaClient();');
  writeFile(path.join(rootPath, 'src/server/item_repository.ts'), 'export const itemRepository = {};');
}

function createDrizzleSqlite(rootPath) {
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      build: 'tsc --noEmit',
      test: 'vitest run',
      'db:migrate': 'drizzle-kit migrate',
      'db:check': 'node scripts/db-check.js',
    },
    dependencies: { 'better-sqlite3': '^12.0.0', 'drizzle-orm': '^0.44.0' },
    devDependencies: { 'drizzle-kit': '^0.31.0', typescript: '^5.9.0', vitest: '^3.2.0' },
  });
  writeFile(path.join(rootPath, 'drizzle.config.ts'), 'export default { dialect: "sqlite", schema: "./src/db/schema.ts" };');
  writeFile(path.join(rootPath, 'src/db/schema.ts'), 'export const schema = {};');
  writeFile(path.join(rootPath, 'src/db/item_repository.ts'), 'export const itemRepository = {};');
  writeFile(path.join(rootPath, 'drizzle/0000_init.sql'), 'CREATE TABLE item (id TEXT PRIMARY KEY);');
  writeFile(path.join(rootPath, 'scripts/db-check.js'), 'console.log("db ok");');
}

function createFastApi(rootPath) {
  writeFile(path.join(rootPath, 'requirements.txt'), 'fastapi==0.116.1\nuvicorn==0.35.0\npytest==8.4.1\n');
  writeFile(path.join(rootPath, 'backend/app/main.py'), [
    'from fastapi import FastAPI',
    'app = FastAPI()',
    '@app.get("/health")',
    'def health(): return {"ok": True}',
    '',
  ].join('\n'));
  writeFile(path.join(rootPath, 'backend/tests/test_health.py'), 'def test_health():\n    assert True\n');
}

function createStaticWeb(rootPath) {
  writeFile(path.join(rootPath, 'index.html'), '<!doctype html><main id="app"></main><script src="app.js"></script>');
  writeFile(path.join(rootPath, 'app.js'), 'document.querySelector("#app").textContent = "ready";');
  writeFile(path.join(rootPath, 'style.css'), 'body { margin: 0; }');
}

function createMonorepo(rootPath) {
  writeJson(path.join(rootPath, 'package.json'), {
    private: true,
    workspaces: ['apps/*', 'packages/*'],
    scripts: { build: 'turbo run build', test: 'turbo run test' },
    devDependencies: { turbo: '^2.5.0' },
  });
  writeJson(path.join(rootPath, 'apps/web/package.json'), {
    name: '@corpus/web',
    dependencies: { next: '^16.0.0', react: '^19.0.0' },
  });
  writeJson(path.join(rootPath, 'packages/shared/package.json'), { name: '@corpus/shared' });
  writeFile(path.join(rootPath, 'apps/web/app/page.tsx'), 'export default function Page() { return <main />; }');
}

function createDirtyExistingApplication(rootPath) {
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: { build: 'tsc --noEmit', test: 'vitest run' },
    devDependencies: { typescript: '^5.9.0', vitest: '^3.2.0' },
  });
  writeFile(path.join(rootPath, 'src/existing.js'), 'export const value = "user-dirty-change";');
  writeFile(path.join(rootPath, 'user-notes.md'), 'Não sobrescrever esta anotação do usuário.\n');
  execFileSync('git', ['init', '-q'], { cwd: rootPath });
}

function createRequestedCapabilitiesApplication(rootPath) {
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: { build: 'next build', test: 'vitest run' },
    dependencies: { next: '^16.0.0', react: '^19.0.0' },
    devDependencies: { vitest: '^3.2.0' },
  });
  writeFile(path.join(rootPath, 'app/page.tsx'), [
    'export default function Page() {',
    '  const formData = new FormData();',
    '  return <input type="file" onChange={() => formData.append("file", "selected")} />;',
    '}',
  ].join('\n'));
  writeFile(path.join(rootPath, 'app/login/page.tsx'), 'export default function Login() { return <form />; }');
  writeFile(path.join(rootPath, 'app/dashboard/page.tsx'), 'export default function Dashboard() { return <main />; }');
  writeFile(path.join(rootPath, 'src/server/auth_service.ts'), 'export function authenticate(email, password) { return verifyPassword(email, password); }');
  writeFile(path.join(rootPath, 'src/server/item_repository.ts'), [
    'export const items = {',
    '  create: async (item) => item,',
    '  findMany: async () => [],',
    '  update: async (id, item) => item,',
    '  delete: async (id) => id,',
    '};',
  ].join('\n'));
  writeFile(path.join(rootPath, 'app/api/upload/route.ts'), [
    'export async function POST(request) {',
    '  const formData = await request.formData();',
    '  return storage.upload(formData.get("file"));',
    '}',
  ].join('\n'));
}

function createCorpusDefinitions(tempRoot) {
  return [
    {
      id: 'next-react-backend',
      stack: 'Next/React backend',
      stacks: ['Next.js'],
      allowedRuleScopes: ['next'],
      options: { requiredNodeScripts: ['build', 'test'] },
      create: createNextBackend,
    },
    {
      id: 'supabase',
      stack: 'Supabase',
      stacks: ['Node/Express'],
      allowedRuleScopes: ['supabase'],
      options: { requirePersistence: true, userMessage: 'Crie backend persistente com Supabase.' },
      create: createSupabase,
    },
    {
      id: 'firebase',
      stack: 'Firebase',
      stacks: ['Node/Express'],
      allowedRuleScopes: ['firebase'],
      options: { requirePersistence: true, userMessage: 'Crie backend persistente com Firebase Firestore.' },
      create: createFirebase,
    },
    {
      id: 'prisma-postgres',
      stack: 'Prisma/Postgres',
      stacks: ['Next.js'],
      allowedRuleScopes: ['next', 'prisma_postgres'],
      options: {
        requiredNodeScripts: ['build', 'test'],
        requirePersistence: true,
        userMessage: 'Crie app Next com Prisma, Postgres, migration e seed.',
      },
      create: createPrismaPostgres,
    },
    {
      id: 'drizzle-sqlite',
      stack: 'SQLite/Drizzle',
      stacks: ['Node/Express'],
      allowedRuleScopes: ['drizzle_sqlite'],
      options: { requirePersistence: true, userMessage: 'Crie persistência SQLite com Drizzle.' },
      create: createDrizzleSqlite,
    },
    {
      id: 'python-fastapi',
      stack: 'Python/FastAPI',
      stacks: ['Python/FastAPI'],
      allowedRuleScopes: ['fastapi'],
      options: { requirePythonTests: true },
      create: createFastApi,
    },
    {
      id: 'static-web',
      stack: 'Static Web',
      stacks: ['Static Web'],
      allowedRuleScopes: ['static_web'],
      options: {},
      create: createStaticWeb,
    },
    {
      id: 'monorepo',
      stack: 'Monorepo',
      stacks: ['Monorepo'],
      allowedRuleScopes: ['monorepo'],
      options: {},
      create: createMonorepo,
    },
    {
      id: 'dirty-existing-application',
      stack: 'Existing Node application',
      stacks: ['Node/Express'],
      allowedRuleScopes: [],
      options: { requiredNodeScripts: ['build', 'test'] },
      dirtyWorktree: true,
      create: createDirtyExistingApplication,
    },
    {
      id: 'requested-product-capabilities',
      stack: 'Next product capabilities',
      stacks: ['Next.js'],
      allowedRuleScopes: ['next'],
      options: {
        requiredNodeScripts: ['build', 'test'],
        userMessage: 'Crie um app com autenticação, CRUD completo, upload de arquivos e múltiplas rotas.',
      },
      create: createRequestedCapabilitiesApplication,
    },
  ].map((definition) => ({
    ...definition,
    rootPath: path.join(tempRoot, definition.id),
  }));
}

async function testControlledApplicationCorpus(tempRoot) {
  const observations = [];
  const definitions = createCorpusDefinitions(tempRoot);

  for (const definition of definitions) {
    definition.create(definition.rootPath);
    const beforeDirty = definition.dirtyWorktree
      ? snapshotDirtyWorktree(definition.rootPath)
      : null;
    const service = createProjectVerificationService({
      fs,
      path,
      runCommand: async () => ({ ok: true, stdout: '', stderr: '' }),
    });
    const verification = await service.runProjectVerification(
      createProjectInfo(definition.rootPath, definition.stacks),
      definition.options
    );
    const afterDirty = definition.dirtyWorktree
      ? snapshotDirtyWorktree(definition.rootPath)
      : null;

    assert.strictEqual(verification.ready, true, `${definition.id}: ${verification.message}`);
    observations.push({
      id: definition.id,
      stack: definition.stack,
      allowedRuleScopes: definition.allowedRuleScopes,
      verification,
      execution: {
        mode: 'controlled',
        started: true,
        criteriaMet: true,
      },
      dirtyWorktree: {
        required: Boolean(definition.dirtyWorktree),
        preserved: definition.dirtyWorktree ? assert.deepStrictEqual(afterDirty, beforeDirty) === undefined : true,
      },
      promoted: true,
    });
  }

  const report = createApplicationCreationCorpusEvaluator().evaluate(observations);
  assert.strictEqual(report.totalScenarios, 10);
  assert.strictEqual(report.passedScenarios, 10);
  assert.strictEqual(report.passRate, 1);
  assert.strictEqual(report.preflightPassed, true);
  assert.strictEqual(report.crossStackViolations.length, 0);
  assert.strictEqual(report.dirtyWorktreeViolations.length, 0);
  assert.strictEqual(report.unsafePromotionScenarios.length, 0);
  assert.strictEqual(report.liveExecutionCoverage, 0);
  assert.strictEqual(report.gatePassed, false);
  assert.strictEqual(report.status, 'pending_live_execution');
  assert.deepStrictEqual(report.pendingLiveScenarios, definitions.map((entry) => entry.id));
}

async function testRequiredBuildFailureBlocksPromotion(tempRoot) {
  const rootPath = path.join(tempRoot, 'required-build-failure');
  createNextBackend(rootPath);
  const service = createProjectVerificationService({
    fs,
    path,
    runCommand: async (_bin, args) => {
      if (args.join(' ') === 'run build') {
        return { ok: false, stdout: '', stderr: 'controlled build failure' };
      }
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  const verification = await service.runProjectVerification(
    createProjectInfo(rootPath, ['Next.js']),
    { requiredNodeScripts: ['build', 'test'] }
  );

  assert.strictEqual(verification.ready, false);
  assert.ok(verification.results.some(
    (result) => result.id === 'node_build' && result.required === true && result.status === 'failed'
  ));

  const report = createApplicationCreationCorpusEvaluator().evaluate([{
    id: 'required-build-failure',
    stack: 'Next/React backend',
    allowedRuleScopes: ['next'],
    verification,
    execution: { mode: 'controlled', started: false, criteriaMet: false },
    dirtyWorktree: { required: false, preserved: true },
    promoted: false,
  }]);
  assert.deepStrictEqual(report.requiredFailureScenarios, ['required-build-failure']);
  assert.deepStrictEqual(report.unsafePromotionScenarios, []);
  assert.strictEqual(report.gatePassed, false);
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-application-corpus-'));
  try {
    await testControlledApplicationCorpus(tempRoot);
    await testRequiredBuildFailureBlocksPromotion(tempRoot);
    console.log('application-creation-corpus.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
