const assert = require('assert');

const { createHostRequirementsService } = require('../main/services/host_requirements_service');

async function run() {
  const calls = [];
  const service = createHostRequirementsService({
    platform: 'darwin',
    runCommand: async (command, args) => {
      calls.push([command, args]);
      if (command === 'node') return { ok: true, stdout: 'v22.4.1\n', stderr: '' };
      if (command === 'git') return { ok: false, stdout: '', stderr: 'command not found' };
      throw new Error('unexpected command');
    },
  });

  const result = await service.getHostRequirements();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.ready, false);
  assert.deepStrictEqual(calls, [
    ['node', ['--version']],
    ['git', ['--version']],
  ]);

  const nodeRequirement = result.requirements.find((entry) => entry.id === 'node');
  const gitRequirement = result.requirements.find((entry) => entry.id === 'git');

  assert.ok(nodeRequirement);
  assert.ok(gitRequirement);
  assert.strictEqual(nodeRequirement.installed, true);
  assert.strictEqual(nodeRequirement.version, 'v22.4.1');
  assert.strictEqual(nodeRequirement.installUrl, 'https://nodejs.org/en/download');
  assert.strictEqual(gitRequirement.installed, false);
  assert.strictEqual(gitRequirement.installUrl, 'https://git-scm.com/download/mac');
  assert.match(gitRequirement.guidance.pt, /Git/);

  console.log('host-requirements-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
