const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  NPM_REGISTRY_ORIGIN,
  createApplicationCreationLiveCorpusPolicy,
} = require('../main/services/application_creation_live_corpus_policy');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.strictEqual(error && error.code, code);
    return true;
  });
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-live-policy-'));
  const workspaceRoot = path.join(tempRoot, 'scenario');
  fs.mkdirSync(workspaceRoot, { recursive: true });

  try {
    const policy = createApplicationCreationLiveCorpusPolicy({ fs, os, path });

    assert.strictEqual(NPM_REGISTRY_ORIGIN, 'https://registry.npmjs.org');
    assert.strictEqual(policy.assertTemporaryWorkspace(workspaceRoot), fs.realpathSync(workspaceRoot));
    expectCode(
      () => policy.assertTemporaryWorkspace(path.resolve(__dirname, '..')),
      'LIVE_CORPUS_WORKSPACE_NOT_TEMPORARY'
    );

    const symlinkPath = path.join(tempRoot, 'outside-link');
    fs.symlinkSync(path.resolve(__dirname, '..'), symlinkPath, 'dir');
    expectCode(
      () => policy.assertTemporaryWorkspace(symlinkPath),
      'LIVE_CORPUS_WORKSPACE_NOT_TEMPORARY'
    );

    assert.deepStrictEqual(
      policy.resolveOfficialProviderDestination({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      }),
      {
        providerId: 'openai',
        providerOrigin: 'https://api.openai.com',
        baseUrl: 'https://api.openai.com/v1',
      }
    );
    assert.deepStrictEqual(
      policy.resolveOfficialProviderDestination({
        providerId: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
      }),
      {
        providerId: 'gemini',
        providerOrigin: 'https://generativelanguage.googleapis.com',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      }
    );
    for (const baseUrl of [
      'http://api.openai.com/v1',
      'https://api.openai.com.evil.example/v1',
      'https://user:secret@api.openai.com/v1',
      'https://api.openai.com/v1?redirect=https://evil.example',
    ]) {
      expectCode(
        () => policy.resolveOfficialProviderDestination({ providerId: 'openai', baseUrl }),
        'LIVE_CORPUS_PROVIDER_DESTINATION_DENIED'
      );
    }

    writeJson(path.join(workspaceRoot, 'package.json'), {
      name: 'safe-live-scenario',
      version: '1.0.0',
      scripts: {
        preinstall: 'node should-never-run.js',
        build: 'node build.js',
      },
      dependencies: {
        react: '^19.0.0',
        '@scope/example': 'npm:react@^19.0.0',
      },
      devDependencies: {
        typescript: '^5.9.0',
      },
    });

    const install = policy.buildNpmInstallInvocation({
      rootPath: workspaceRoot,
      npmExecutable: '/usr/local/bin/npm',
    });
    assert.strictEqual(install.command, '/usr/local/bin/npm');
    assert.deepStrictEqual(install.args, [
      'install',
      '--ignore-scripts',
      '--registry=https://registry.npmjs.org/',
      '--no-audit',
      '--no-fund',
      '--package-lock=true',
      '--foreground-scripts=false',
    ]);
    assert.deepStrictEqual(install.suppressedLifecycleScripts, ['package.json:preinstall']);
    assert.strictEqual(install.registryOrigin, NPM_REGISTRY_ORIGIN);
    assert.strictEqual(install.lifecycleScriptsEnabled, false);
    assert.strictEqual(install.cwd, fs.realpathSync(workspaceRoot));

    const childHomePath = path.join(tempRoot, 'npm-home');
    fs.mkdirSync(childHomePath, { recursive: true });
    const childEnvironment = policy.buildNpmChildEnvironment({
      PATH: '/usr/local/bin:/usr/bin',
      LANG: 'pt_BR.UTF-8',
      HOME: path.join(tempRoot, 'host-home'),
      OPENAI_API_KEY: 'must-not-leak',
      GEMINI_API_KEY: 'must-not-leak',
      HTTPS_PROXY: 'https://proxy.example',
      npm_config_registry: 'https://evil.example',
    }, {
      homePath: childHomePath,
      cachePath: path.join(tempRoot, 'npm-cache'),
      userConfigPath: path.join(tempRoot, 'npmrc'),
      globalConfigPath: path.join(tempRoot, 'npmrc-global'),
      networkGuardPath: path.join(tempRoot, 'registry-guard.cjs'),
    });
    assert.strictEqual(childEnvironment.PATH, '/usr/local/bin:/usr/bin');
    assert.strictEqual(childEnvironment.LANG, 'pt_BR.UTF-8');
    assert.strictEqual(childEnvironment.HOME, fs.realpathSync(childHomePath));
    assert.strictEqual(childEnvironment.USERPROFILE, fs.realpathSync(childHomePath));
    assert.strictEqual(childEnvironment.OPENAI_API_KEY, undefined);
    assert.strictEqual(childEnvironment.GEMINI_API_KEY, undefined);
    assert.strictEqual(childEnvironment.HTTPS_PROXY, undefined);
    assert.strictEqual(childEnvironment.npm_config_registry, 'https://registry.npmjs.org/');
    assert.strictEqual(childEnvironment.npm_config_ignore_scripts, 'true');
    assert.strictEqual(childEnvironment.npm_config_audit, 'false');
    assert.strictEqual(childEnvironment.npm_config_fund, 'false');
    assert.match(childEnvironment.NODE_OPTIONS, /--require=/);

    writeJson(path.join(workspaceRoot, 'package-lock.json'), {
      name: 'safe-live-scenario',
      lockfileVersion: 3,
      packages: {
        '': { name: 'safe-live-scenario', version: '1.0.0' },
        'node_modules/react': {
          version: '19.0.0',
          resolved: 'https://registry.npmjs.org/react/-/react-19.0.0.tgz',
          integrity: 'sha512-safe',
        },
      },
    });
    const lockAudit = policy.auditNpmLockfileEgress(workspaceRoot);
    assert.strictEqual(lockAudit.ok, true);
    assert.strictEqual(lockAudit.resolvedArtifacts, 1);

    writeJson(path.join(workspaceRoot, 'package.json'), {
      name: 'safe-live-monorepo',
      version: '1.0.0',
      private: true,
      workspaces: ['packages/*'],
    });
    writeJson(path.join(workspaceRoot, 'packages/shared/package.json'), {
      name: '@faber/shared',
      version: '1.0.0',
    });
    writeJson(path.join(workspaceRoot, 'package-lock.json'), {
      name: 'safe-live-monorepo',
      lockfileVersion: 3,
      packages: {
        '': { name: 'safe-live-monorepo', version: '1.0.0' },
        'packages/shared': { name: '@faber/shared', version: '1.0.0' },
        'node_modules/@faber/shared': {
          resolved: 'packages/shared',
          link: true,
        },
      },
    });
    const workspaceLockAudit = policy.auditNpmLockfileEgress(workspaceRoot);
    assert.strictEqual(workspaceLockAudit.ok, true);
    assert.strictEqual(workspaceLockAudit.resolvedArtifacts, 0);
    assert.strictEqual(workspaceLockAudit.workspaceLinks, 1);

    writeJson(path.join(tempRoot, 'outside-package/package.json'), {
      name: 'outside-package',
      version: '1.0.0',
    });
    writeJson(path.join(workspaceRoot, 'package-lock.json'), {
      lockfileVersion: 3,
      packages: {
        'node_modules/outside-package': {
          resolved: '../outside-package',
          link: true,
        },
      },
    });
    expectCode(
      () => policy.auditNpmLockfileEgress(workspaceRoot),
      'LIVE_CORPUS_LOCKFILE_EGRESS_DENIED'
    );

    writeJson(path.join(workspaceRoot, 'package-lock.json'), {
      lockfileVersion: 3,
      packages: {
        'node_modules/not-a-workspace-link': {
          resolved: 'packages/shared',
        },
      },
    });
    expectCode(
      () => policy.auditNpmLockfileEgress(workspaceRoot),
      'LIVE_CORPUS_LOCKFILE_EGRESS_DENIED'
    );

    writeJson(path.join(workspaceRoot, 'package-lock.json'), {
      lockfileVersion: 3,
      packages: {
        'node_modules/evil': {
          version: '1.0.0',
          resolved: 'https://cdn.evil.example/evil.tgz',
        },
      },
    });
    expectCode(
      () => policy.auditNpmLockfileEgress(workspaceRoot),
      'LIVE_CORPUS_LOCKFILE_EGRESS_DENIED'
    );

    writeJson(path.join(workspaceRoot, 'package.json'), {
      dependencies: { unsafe: 'git+https://github.com/example/unsafe.git' },
    });
    expectCode(
      () => policy.buildNpmInstallInvocation({ rootPath: workspaceRoot }),
      'LIVE_CORPUS_DEPENDENCY_SOURCE_DENIED'
    );

    const guardPath = path.resolve(__dirname, '../scripts/npm_registry_egress_guard.cjs');
    const guardCheck = spawnSync(process.execPath, ['-e', [
      `const guard = require(${JSON.stringify(guardPath)});`,
      "guard.assertRegistryUrl('https://registry.npmjs.org/react');",
      "let code = '';",
      "try { guard.assertRegistryUrl('https://not-authorized.invalid/package'); } catch (error) { code = error.code; }",
      "if (code !== 'NPM_EGRESS_BLOCKED') process.exit(1);",
    ].join(' ')], { encoding: 'utf8' });
    assert.strictEqual(guardCheck.status, 0, guardCheck.stderr);

    console.log('application-creation-live-corpus-policy.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
