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

  const abortController = new AbortController();
  let abortKillCount = 0;
  const abortRunner = createCommandRunner({
    spawn: () => {
      const { EventEmitter } = require('events');
      const child = new EventEmitter();
      child.pid = 999999;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {
        abortKillCount += 1;
        setImmediate(() => child.emit('close', null, 'SIGTERM'));
        return true;
      };
      return child;
    },
  });
  const abortPromise = abortRunner.runCommand('sleep', ['10'], {
    signal: abortController.signal,
    timeoutMs: 1000,
  });
  abortController.abort();
  const abortResult = await abortPromise;
  assert.strictEqual(abortResult.ok, false);
  assert.strictEqual(abortResult.aborted, true);
  assert.ok(abortKillCount >= 1);

  const spawnCalls = [];
  const fakeRunner = createCommandRunner({
    spawn: (bin, args, options) => {
      spawnCalls.push({ bin, args, options });
      const { EventEmitter } = require('events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      setImmediate(() => child.emit('close', 0, null));
      return child;
    },
  });
  const fakeResult = await fakeRunner.runCommand('echo', ['hello'], { timeoutMs: 1000 });
  assert.strictEqual(fakeResult.ok, true);
  assert.strictEqual(spawnCalls[0].options.shell, false);

  console.log('command-runner.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
