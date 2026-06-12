const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createProjectPreviewService } = require('../main/services/project_preview_service');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeLocalBin(rootPath, name) {
  writeFile(path.join(rootPath, 'node_modules', '.bin', name), '#!/usr/bin/env node\n');
}

function writeInstalledPackage(rootPath, name) {
  writeJson(path.join(rootPath, 'node_modules', name, 'package.json'), { name });
}

function createProjectInfo(rootPath, files, stacks) {
  return {
    rootPath,
    files,
    stacks,
    totalFiles: files.length,
    counters: {},
  };
}

function testMissingRootPathIsRejected() {
  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan({});
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.ready, false);
  assert.strictEqual(plan.status, 'blocked');
}

function testStaticPreviewUsesFileUrl(tempRoot) {
  const rootPath = path.join(tempRoot, 'static');
  writeFile(path.join(rootPath, 'index.html'), '<h1>ok</h1>');

  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan(createProjectInfo(rootPath, ['index.html'], ['Projeto generico']));

  assert.strictEqual(plan.ready, true);
  assert.strictEqual(plan.mode, 'file');
  assert.strictEqual(plan.stack, 'web_estatico');
  assert.ok(plan.url.startsWith('file://'));
  assert.ok(plan.url.includes('index.html'));
  assert.strictEqual(plan.steps[0].kind, 'open');
}

function testLampPreviewUsesPhpServer(tempRoot) {
  const rootPath = path.join(tempRoot, 'lamp');
  writeFile(path.join(rootPath, 'public/index.php'), '<?php echo "ok";');

  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan(createProjectInfo(rootPath, ['public/index.php'], ['PHP/LAMP']), {
    port: 8090,
  });

  assert.strictEqual(plan.ready, true);
  assert.strictEqual(plan.mode, 'server');
  assert.strictEqual(plan.url, 'http://127.0.0.1:8090/');
  assert.strictEqual(plan.commandText, 'php -S 127.0.0.1:8090 -t public');
  assert.strictEqual(plan.cwd, rootPath);
}

function testNextPreviewUsesDevScriptWhenReady(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-ready');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });
  writeLocalBin(rootPath, 'next');

  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan(createProjectInfo(rootPath, ['package.json'], ['Next.js']), {
    port: 3010,
  });

  assert.strictEqual(plan.ready, true);
  assert.strictEqual(plan.stack, 'Next.js');
  assert.strictEqual(plan.url, 'http://127.0.0.1:3010/');
  assert.strictEqual(plan.commandText, 'npm run dev -- --hostname 127.0.0.1 --port 3010');
}

function testNextPreviewBlocksWhenNodeModulesIsPartial(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-partial-install');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });

  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan(createProjectInfo(rootPath, ['package.json'], ['Next.js']));

  assert.strictEqual(plan.ready, false);
  assert.strictEqual(plan.status, 'blocked');
  assert.ok(plan.warnings.some((warning) => warning.includes('node_modules/.bin/next')));
  assert.ok(plan.steps.some((step) => step.id === 'preview_dependencies' && step.commandText === 'npm install'));
}

function testNextPreviewBlocksWhenDeclaredImportIsNotInstalled(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-missing-declared-import');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      clsx: '^2.1.1',
    },
  });
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });
  writeLocalBin(rootPath, 'next');
  writeInstalledPackage(rootPath, 'next');
  writeInstalledPackage(rootPath, 'react');
  writeInstalledPackage(rootPath, 'react-dom');
  writeFile(path.join(rootPath, 'app/page.tsx'), 'import { clsx } from "clsx";\nexport default function Page() { return <main className={clsx("ok")} />; }\n');

  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan(createProjectInfo(rootPath, ['package.json', 'app/page.tsx'], ['Next.js']));

  assert.strictEqual(plan.ready, false);
  assert.strictEqual(plan.status, 'blocked');
  assert.ok(plan.warnings.some((warning) => warning.includes('clsx')));
  assert.ok(plan.steps.some((step) => step.id === 'preview_dependencies' && step.commandText === 'npm install'));
}

function testNextPreviewBlocksWhenTransitivePackageIsBroken(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-broken-transitive-install');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
      tailwindcss: '^3.4.0',
    },
  });
  writeJson(path.join(rootPath, 'package-lock.json'), { lockfileVersion: 3, packages: {} });
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });
  writeLocalBin(rootPath, 'next');
  writeJson(path.join(rootPath, 'node_modules', 'ts-interface-checker', 'package.json'), {
    name: 'ts-interface-checker',
  });
  writeFile(path.join(rootPath, 'node_modules', 'ts-interface-checker', 'dist', 'index.js'), 'require("./types");');

  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan(createProjectInfo(rootPath, ['package.json'], ['Next.js']));

  assert.strictEqual(plan.ready, false);
  assert.strictEqual(plan.status, 'blocked');
  assert.ok(plan.warnings.some((warning) => warning.includes('node_modules/ts-interface-checker')));
  assert.ok(plan.steps.some((step) => step.id === 'preview_dependencies' && step.commandText === 'npm ci'));
}

function testNextPreviewBlocksWithoutDependencies(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-blocked');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });

  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan(createProjectInfo(rootPath, ['package.json'], ['Next.js']));

  assert.strictEqual(plan.ready, false);
  assert.strictEqual(plan.status, 'blocked');
  assert.ok(plan.steps.some((step) => step.id === 'preview_dependencies' && step.commandText === 'npm install'));
  assert.ok(plan.steps.some((step) => step.id === 'preview_server' && step.status === 'blocked'));
}

function testReactPreviewUsesViteStyleHostFlag(tempRoot) {
  const rootPath = path.join(tempRoot, 'react-ready');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'vite',
    },
    dependencies: {
      react: '^19.0.0',
      vite: '^7.0.0',
    },
  });
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });
  writeLocalBin(rootPath, 'vite');

  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan(createProjectInfo(rootPath, ['package.json'], ['React']));

  assert.strictEqual(plan.ready, true);
  assert.strictEqual(plan.stack, 'React');
  assert.strictEqual(plan.port, 5173);
  assert.strictEqual(plan.commandText, 'npm run dev -- --host 127.0.0.1 --port 5173');
}

function testElectronPreviewUsesAppModeWithoutBrowserUrl(tempRoot) {
  const rootPath = path.join(tempRoot, 'electron-ready');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'electron .',
    },
    devDependencies: {
      electron: '^38.0.0',
    },
  });
  writeFile(path.join(rootPath, 'main.js'), 'require("electron");');
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });
  writeLocalBin(rootPath, 'electron');
  writeInstalledPackage(rootPath, 'electron');

  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan(createProjectInfo(rootPath, ['package.json', 'main.js'], ['Electron']));

  assert.strictEqual(plan.ready, true);
  assert.strictEqual(plan.mode, 'app');
  assert.strictEqual(plan.stack, 'Electron');
  assert.strictEqual(plan.url, null);
  assert.strictEqual(plan.commandText, 'npm run dev');
  assert.ok(plan.steps.some((step) => step.id === 'preview_app' && step.status === 'ready'));
}

function testPnpmLockChangesPreviewCommand(tempRoot) {
  const rootPath = path.join(tempRoot, 'pnpm-next');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });
  writeFile(path.join(rootPath, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });
  writeLocalBin(rootPath, 'next');

  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan(createProjectInfo(rootPath, ['package.json', 'pnpm-lock.yaml'], ['Next.js']));

  assert.strictEqual(plan.packageManager, 'pnpm');
  assert.strictEqual(plan.commandText, 'pnpm run dev -- --hostname 127.0.0.1 --port 3000');
}

function testManualActivePreviewUrlCanBeAdopted(tempRoot) {
  const rootPath = path.join(tempRoot, 'manual-preview');
  writeJson(path.join(rootPath, 'package.json'), {
    scripts: {
      dev: 'next dev',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
    },
  });

  const service = createProjectPreviewService({ fs, path });
  const plan = service.buildProjectPreviewPlan(createProjectInfo(rootPath, ['package.json'], ['Next.js']), {
    activePreviewUrl: 'http://127.0.0.1:3000/',
  });

  assert.strictEqual(plan.ready, true);
  assert.strictEqual(plan.status, 'ready');
  assert.strictEqual(plan.source, 'manual_active_preview');
  assert.strictEqual(plan.mode, 'server');
  assert.strictEqual(plan.url, 'http://127.0.0.1:3000/');
  assert.strictEqual(plan.port, 3000);
  assert.strictEqual(plan.commandText, '');
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-preview-test-'));
  try {
    testMissingRootPathIsRejected();
    testStaticPreviewUsesFileUrl(tempRoot);
    testLampPreviewUsesPhpServer(tempRoot);
    testNextPreviewUsesDevScriptWhenReady(tempRoot);
    testNextPreviewBlocksWhenNodeModulesIsPartial(tempRoot);
    testNextPreviewBlocksWhenDeclaredImportIsNotInstalled(tempRoot);
    testNextPreviewBlocksWhenTransitivePackageIsBroken(tempRoot);
    testNextPreviewBlocksWithoutDependencies(tempRoot);
    testReactPreviewUsesViteStyleHostFlag(tempRoot);
    testElectronPreviewUsesAppModeWithoutBrowserUrl(tempRoot);
    testPnpmLockChangesPreviewCommand(tempRoot);
    testManualActivePreviewUrlCanBeAdopted(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('project-preview-service.test.js: ok');
}

main();
