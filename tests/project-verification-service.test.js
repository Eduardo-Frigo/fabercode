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
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });

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

async function testNextProjectBlocksChecksUntilDependenciesExist(tempRoot) {
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
  assert.strictEqual(dependencyStep.kind, 'manual');
  assert.strictEqual(dependencyStep.commandText, 'npm install');

  const report = await service.runProjectVerification(projectInfo);
  assert.strictEqual(report.ready, false);
  assert.strictEqual(calls.length, 0);
  assert.ok(report.results.some((result) => result.status === 'blocked' && result.id === 'node_build'));
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
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });

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
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });

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
    await testNextProjectBlocksChecksUntilDependenciesExist(tempRoot);
    await testPlaceholderTestScriptIsSkipped(tempRoot);
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
