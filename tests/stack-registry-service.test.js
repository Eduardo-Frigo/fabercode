const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createStackRegistryService } = require('../main/services/stack_registry_service');

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-stack-registry-'));
  try {
    const registry = createStackRegistryService({ fs, path });

    const emptyDetected = registry.detectProjectStacks({});
    assert.deepStrictEqual(emptyDetected.stacks, ['Projeto genérico']);

    const nextDetected = registry.detectProjectStacks({
      rootPath: tempRoot,
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      counters: { tsx: 1, css: 1 },
      packageJson: {
        dependencies: {
          next: '^16.0.0',
          react: '^19.0.0',
          tailwindcss: '^4.0.0',
        },
      },
    });
    assert.ok(nextDetected.stacks.includes('Next.js'));
    assert.ok(nextDetected.stacks.includes('Tailwind CSS'));
    assert.ok(!nextDetected.stacks.includes('React'));

    const lampDetected = registry.detectProjectStacks({
      rootPath: tempRoot,
      files: ['public/index.php'],
      counters: { php: 1 },
    });
    assert.ok(lampDetected.stacks.includes('PHP/LAMP'));

    const electronDetected = registry.detectProjectStacks({
      rootPath: tempRoot,
      files: ['package.json', 'main.js', 'preload.js'],
      counters: { js: 2 },
      packageJson: {
        devDependencies: {
          electron: '^38.0.0',
        },
      },
    });
    assert.ok(electronDetected.stacks.includes('Electron'));

    const textProfiles = registry.resolveStackProfilesFromText('Criar aplicação em Next.js com Tailwind e preview local');
    assert.ok(textProfiles.some((profile) => profile.id === 'next'));
    assert.ok(textProfiles.some((profile) => profile.id === 'tailwind'));

    const projectPluginRoot = path.join(tempRoot, 'project-plugin');
    writeJson(path.join(projectPluginRoot, '.faber', 'stacks', 'astro.json'), {
      id: 'astro',
      label: 'Astro',
      category: 'web',
      detect: {
        packageDependencies: ['astro'],
        fileExtensions: ['astro'],
      },
      preview: {
        mode: 'server',
        script: 'dev',
        defaultPort: 4321,
      },
    });

    const withPlugin = registry.detectProjectStacks({
      rootPath: projectPluginRoot,
      files: ['package.json', 'src/pages/index.astro'],
      packageJson: {
        dependencies: {
          astro: '^5.0.0',
        },
      },
      counters: {},
    });
    assert.ok(withPlugin.stacks.includes('Astro'));
    assert.ok(withPlugin.matches.some((match) => match.id === 'astro' && match.source === 'plugin'));

    writeJson(path.join(projectPluginRoot, '.faber', 'stacks', 'bad.json'), {
      id: '../bad',
      label: 'Bad',
      detect: {
        packageDependencies: ['bad'],
      },
    });
    const profiles = registry.getProfiles(projectPluginRoot);
    assert.ok(!profiles.some((profile) => profile.id === '../bad'));

    console.log('stack-registry-service.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
