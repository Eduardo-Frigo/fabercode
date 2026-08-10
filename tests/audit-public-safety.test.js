const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const auditScript = path.join(root, 'scripts', 'audit-public-safety.js');
const temporaryFixture = path.join(__dirname, '.audit-public-safety-token-fixture.txt');
const safeTutorialToken = ['sk', 'faber', 'tutorial', 'placeholder', 'not', 'real'].join('-');

function runAudit() {
  return execFileSync(process.execPath, [auditScript], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function run() {
  try {
    fs.writeFileSync(temporaryFixture, `tutorial=${safeTutorialToken}\n`, 'utf8');
    assert.match(runAudit(), /Public safety audit passed/);

    const extendedCredential = `${safeTutorialToken}credential-suffix-1234567890`;
    fs.writeFileSync(temporaryFixture, `token=${extendedCredential}\n`, 'utf8');

    let rejected = null;
    try {
      runAudit();
    } catch (error) {
      rejected = error;
    }

    assert.ok(rejected, 'an extended credential must not be hidden by the tutorial allowlist');
    assert.strictEqual(rejected.status, 1);
    assert.match(String(rejected.stderr || ''), /\.audit-public-safety-token-fixture\.txt/);
  } finally {
    fs.rmSync(temporaryFixture, { force: true });
  }

  console.log('audit-public-safety.test.js: ok');
}

run();
