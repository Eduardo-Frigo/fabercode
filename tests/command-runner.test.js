const assert = require('assert');

const { createCommandRunner } = require('../main/services/command_runner');

async function run() {
  const { runCommand } = createCommandRunner();

  const success = await runCommand(process.execPath, ['-e', 'process.stdout.write("ok")'], { timeoutMs: 1000 });
  assert.strictEqual(success.ok, true);
  assert.strictEqual(success.stdout, 'ok');
  assert.strictEqual(success.exitCode, 0);
  assert.strictEqual(success.timedOut, false);

  const failure = await runCommand(process.execPath, ['-e', 'process.stderr.write("fail"); process.exit(7)'], {
    timeoutMs: 1000,
  });
  assert.strictEqual(failure.ok, false);
  assert.strictEqual(failure.exitCode, 7);
  assert.strictEqual(failure.stderr, 'fail');

  const timeout = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 50 });
  assert.strictEqual(timeout.ok, false);
  assert.strictEqual(timeout.timedOut, true);

  console.log('command-runner.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
