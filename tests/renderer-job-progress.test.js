const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rendererSource = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'job_progress.js'),
  'utf8'
);
const htmlSource = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'index.html'),
  'utf8'
);
const uiOverridesSource = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'styles', 'ui-overrides.css'),
  'utf8'
);
const workspaceLayoutSource = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'styles', 'workspace-layout.css'),
  'utf8'
);

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (name) => values.add(name),
    remove: (name) => values.delete(name),
    contains: (name) => values.has(name),
    toggle: (name, force) => {
      const next = force === undefined ? !values.has(name) : Boolean(force);
      if (next) values.add(name);
      else values.delete(name);
      return next;
    },
  };
}

function createButton() {
  const listeners = new Map();
  return {
    classList: createClassList(['hidden']),
    disabled: false,
    style: {},
    textContent: '',
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    click() {
      const listener = listeners.get('click');
      return listener ? listener({ target: this }) : undefined;
    },
  };
}

function canaryJob(jobId, overrides = {}) {
  return {
    id: jobId,
    projectId: 'project-1',
    status: 'completed',
    phase: 'done',
    events: [{
      type: 'job.completed',
      payload: {
        canary: true,
        canaryPromotionId: `canary-promotion-${jobId}`,
      },
    }],
    ...overrides,
  };
}

async function run() {
  assert.match(
    uiOverridesSource,
    /\.job-progress-head strong,\s*#job-progress-status\s*\{[^}]*font-size:\s*0\.76rem\s*!important;/s,
    'the job error title and its status indicator must use the exact same font size'
  );
  assert.match(
    workspaceLayoutSource,
    /\.job-status-info\s*\{[^}]*flex-direction:\s*row;[^}]*align-items:\s*center;/s,
    'the progress percentage must share the top header row with the job title'
  );
  assert.match(
    workspaceLayoutSource,
    /#job-progress-status\s*\{[^}]*margin-left:\s*auto;[^}]*flex-shrink:\s*0;/s,
    'the progress percentage must stay aligned at the top-right before the actions'
  );
  assert.match(
    htmlSource,
    /id="btn-job-rollback-canary"[^>]*class="[^"]*hidden[^"]*"/,
    'the rollback control must be present and hidden by default'
  );
  assert.doesNotMatch(
    rendererSource,
    /resultRecorded[^\n]*Resultado registrado/,
    'the expanded terminal card must not inject a redundant generic result row'
  );

  const rollbackButton = createButton();
  const cancelButton = createButton();
  const title = { textContent: '' };
  const status = { textContent: '' };
  const elements = {
    'btn-job-rollback-canary': rollbackButton,
    'btn-job-cancel': cancelButton,
    'job-progress-title': title,
    'job-progress-status': status,
  };
  const documentRef = {
    documentElement: { lang: 'pt-BR' },
    getElementById: (id) => elements[id] || null,
  };
  const calls = [];
  const statuses = [];
  let confirmation = false;
  let nextResponse = Promise.resolve({ ok: false, message: 'indisponível' });
  const windowRef = {
    api: {
      rollbackCanaryJob: (payload) => {
        calls.push(payload);
        return nextResponse;
      },
    },
    t: (_key, fallback) => fallback,
  };
  const sandbox = {
    document: documentRef,
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout,
    window: windowRef,
  };
  windowRef.window = windowRef;
  windowRef.document = documentRef;

  vm.runInNewContext(rendererSource, sandbox, { filename: 'renderer/job_progress.js' });
  const controller = windowRef.FaberJobProgress.createJobProgressController({
    api: windowRef.api,
    confirmRollback: () => confirmation,
    updateStatus: (value) => statuses.push(value),
  });

  controller.render({
    id: 'job-legacy-1',
    status: 'completed',
    phase: 'done',
    progress: { pct: 100 },
    events: [{ type: 'job.completed', payload: { canary: false } }],
  });
  assert.strictEqual(rollbackButton.classList.contains('hidden'), true);
  assert.strictEqual(status.textContent, '100%');

  cancelButton.style.display = 'block';
  controller.render({
    id: 'job-blocked-1',
    status: 'blocked',
    phase: 'execute_blocked',
    progress: { pct: 100 },
    events: [{ type: 'job.blocked', payload: { reason: 'process_unavailable' } }],
  });
  assert.strictEqual(cancelButton.style.display, 'none');
  assert.strictEqual(title.textContent, 'Execução bloqueada');

  const eligible = canaryJob('job-canary-1');
  controller.render(eligible);
  assert.strictEqual(rollbackButton.classList.contains('hidden'), false);
  assert.strictEqual(rollbackButton.disabled, false);
  assert.strictEqual(rollbackButton.textContent, 'Desfazer alteração canary');

  await rollbackButton.click();
  assert.strictEqual(calls.length, 0, 'confirmation refusal must not reach IPC');

  confirmation = true;
  const pending = deferred();
  nextResponse = pending.promise;
  const firstClick = rollbackButton.click();
  await rollbackButton.click();
  assert.strictEqual(calls.length, 1, 'a pending rollback must suppress duplicate clicks');
  assert.strictEqual(JSON.stringify(calls[0]), JSON.stringify({ jobId: 'job-canary-1' }));
  assert.strictEqual(Object.isFrozen(calls[0]), true);
  assert.strictEqual(rollbackButton.disabled, true);
  assert.strictEqual(rollbackButton.textContent, 'Desfazendo...');

  pending.resolve({
    ok: true,
    idempotent: false,
    rollback: {
      promotionId: 'canary-promotion-job-canary-1',
      reconciliationId: 'canary-reconciliation-1',
      sourceRestored: true,
    },
    job: canaryJob('job-canary-1', {
      canaryRollback: {
        status: 'completed',
        promotionId: 'canary-promotion-job-canary-1',
        reconciliationId: 'canary-reconciliation-1',
        sourceRestored: true,
      },
    }),
  });
  await firstClick;
  assert.strictEqual(rollbackButton.classList.contains('hidden'), true);
  assert.strictEqual(
    statuses.includes('Alteração canary desfeita; arquivos anteriores restaurados.'),
    true
  );

  controller.render(canaryJob('job-canary-2'));
  nextResponse = Promise.resolve({ ok: false, message: 'Rollback indisponível.' });
  await rollbackButton.click();
  assert.strictEqual(rollbackButton.classList.contains('hidden'), false);
  assert.strictEqual(rollbackButton.disabled, false);
  assert.strictEqual(rollbackButton.textContent, 'Desfazer alteração canary');
  assert.strictEqual(statuses.at(-1), 'Rollback indisponível.');

  controller.render(canaryJob('job-canary-3', {
    canaryRollback: {
      status: 'completed',
      promotionId: 'canary-promotion-job-canary-3',
      reconciliationId: 'canary-reconciliation-3',
      sourceRestored: true,
    },
  }));
  assert.strictEqual(rollbackButton.classList.contains('hidden'), true);

  console.log('renderer-job-progress.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
