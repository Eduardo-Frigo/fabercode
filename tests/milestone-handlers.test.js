const assert = require('assert');

const { registerMilestoneHandlers } = require('../main/ipc/milestone_handlers');

function createHandlerMap() {
  const handlers = {};
  return {
    handlers,
    registerIpcHandler: (channel, handler) => {
      handlers[channel] = handler;
    },
  };
}

function createFixture() {
  const calls = [];
  const audits = [];
  const renderResults = [];
  const milestones = [
    { id: 'milestone-1', title: 'Foundation' },
    { id: 'milestone-2', title: 'Release' },
  ];
  const { handlers, registerIpcHandler } = createHandlerMap();

  const milestoneService = {
    listMilestones: (rootPath) => {
      calls.push(['listMilestones', rootPath]);
      return milestones;
    },
    updateMilestoneStatus: (rootPath, milestoneId, status) => {
      calls.push(['updateMilestoneStatus', rootPath, milestoneId, status]);
      return { ok: true, milestoneId, status };
    },
    updateMilestoneTask: (rootPath, milestoneId, taskId, task) => {
      calls.push(['updateMilestoneTask', rootPath, milestoneId, taskId, task]);
      return { ok: true, milestoneId, taskId, task };
    },
    renderMilestones: (rootPath) => {
      calls.push(['renderMilestones', rootPath]);
      return renderResults.shift() || { ok: true };
    },
  };

  const milestoneGitStatusService = {
    getMilestoneGitStatus: (rootPath, milestoneId) => {
      calls.push(['getMilestoneGitStatus', rootPath, milestoneId]);
      return { ok: true, milestoneId, status: 'clean' };
    },
    linkExistingMilestoneCommit: async (rootPath, milestoneId, commitHash) => {
      calls.push(['linkExistingMilestoneCommit', rootPath, milestoneId, commitHash]);
      return { ok: true, milestoneId, commitHash };
    },
  };

  const milestoneValidationService = {
    completeMilestoneFromJob: (rootPath, milestoneId, jobId) => {
      calls.push(['completeMilestoneFromJob', rootPath, milestoneId, jobId]);
      return { ok: true, milestoneId, jobId };
    },
  };

  registerMilestoneHandlers({
    authorizeProjectRoot: (rootPath) => {
      calls.push(['authorizeProjectRoot', rootPath]);
      if (rootPath !== '/allowed') {
        return { ok: false, message: 'Projeto não autorizado.' };
      }
      return { ok: true, rootPath: '/authorized/project' };
    },
    milestoneService,
    milestoneGitStatusService,
    milestoneValidationService,
    registerIpcHandler,
    appendAuditEvent: (type, payload) => audits.push({ type, payload }),
  });

  return { audits, calls, handlers, milestones, renderResults };
}

function lastServiceCall(calls) {
  return calls.filter(([name]) => name !== 'authorizeProjectRoot').at(-1);
}

async function run() {
  const fixture = createFixture();
  const { audits, calls, handlers, milestones, renderResults } = fixture;

  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'milestones:complete-after-validation',
    'milestones:get',
    'milestones:git-status',
    'milestones:link-commit',
    'milestones:list',
    'milestones:render',
    'milestones:update-status',
    'milestones:update-task',
  ]);

  const listed = handlers['milestones:list'](null, { rootPath: '/allowed' });
  assert.deepStrictEqual(listed, { ok: true, milestones });
  assert.deepStrictEqual(lastServiceCall(calls), ['listMilestones', '/authorized/project']);

  const found = handlers['milestones:get'](null, {
    rootPath: '/allowed',
    milestoneId: 'milestone-2',
  });
  assert.deepStrictEqual(found, { ok: true, milestone: milestones[1] });
  assert.deepStrictEqual(lastServiceCall(calls), ['listMilestones', '/authorized/project']);

  const missing = handlers['milestones:get'](null, {
    rootPath: '/allowed',
    milestoneId: 'missing',
  });
  assert.deepStrictEqual(missing, { ok: false, message: 'Milestone not found' });

  handlers['milestones:update-status'](null, {
    rootPath: '/allowed',
    milestoneId: 'milestone-1',
    status: 'active',
  });
  assert.deepStrictEqual(lastServiceCall(calls), [
    'updateMilestoneStatus',
    '/authorized/project',
    'milestone-1',
    'active',
  ]);

  const task = { title: 'Add tests', completed: true };
  handlers['milestones:update-task'](null, {
    rootPath: '/allowed',
    milestoneId: 'milestone-1',
    taskId: 'task-1',
    task,
  });
  assert.deepStrictEqual(lastServiceCall(calls), [
    'updateMilestoneTask',
    '/authorized/project',
    'milestone-1',
    'task-1',
    task,
  ]);

  const commit = {
    hash: 'a'.repeat(40),
    message: 'spoofed renderer metadata',
    createdAt: '1900-01-01T00:00:00.000Z',
  };
  await handlers['milestones:link-commit'](null, {
    rootPath: '/allowed',
    milestoneId: 'milestone-1',
    commit,
  });
  assert.deepStrictEqual(lastServiceCall(calls), [
    'linkExistingMilestoneCommit',
    '/authorized/project',
    'milestone-1',
    commit.hash,
  ]);

  const completion = handlers['milestones:complete-after-validation'](null, {
    rootPath: '/allowed',
    milestoneId: 'milestone-1',
    jobId: 'job-validated-1',
  });
  assert.strictEqual(completion.ok, true);
  assert.deepStrictEqual(lastServiceCall(calls), [
    'completeMilestoneFromJob',
    '/authorized/project',
    'milestone-1',
    'job-validated-1',
  ]);

  const gitStatus = handlers['milestones:git-status'](null, {
    rootPath: '/allowed',
    milestoneId: 'milestone-1',
  });
  assert.strictEqual(gitStatus.ok, true);
  assert.deepStrictEqual(lastServiceCall(calls), [
    'getMilestoneGitStatus',
    '/authorized/project',
    'milestone-1',
  ]);

  renderResults.push({ ok: true, outputDir: '/authorized/project/docs/milestones' });
  const successfulRender = handlers['milestones:render'](null, { rootPath: '/allowed' });
  assert.strictEqual(successfulRender.ok, true);
  assert.deepStrictEqual(lastServiceCall(calls), ['renderMilestones', '/authorized/project']);
  assert.deepStrictEqual(audits, [{
    type: 'milestones.rendered',
    payload: { rootPath: '/authorized/project' },
  }]);

  renderResults.push({ ok: false, message: 'render failed' });
  const failedRender = handlers['milestones:render'](null, { rootPath: '/allowed' });
  assert.deepStrictEqual(failedRender, { ok: false, message: 'render failed' });
  assert.strictEqual(audits.length, 1);

  const deniedCases = [
    ['milestones:list', {}],
    ['milestones:get', { milestoneId: 'milestone-1' }],
    ['milestones:update-status', { milestoneId: 'milestone-1', status: 'done' }],
    ['milestones:update-task', { milestoneId: 'milestone-1', taskId: 'task-1', task }],
    ['milestones:link-commit', { milestoneId: 'milestone-1', commit }],
    ['milestones:complete-after-validation', {
      milestoneId: 'milestone-1',
      jobId: 'job-validated-1',
    }],
    ['milestones:git-status', { milestoneId: 'milestone-1' }],
    ['milestones:render', {}],
  ];

  for (const [channel, payload] of deniedCases) {
    const serviceCallsBefore = calls.filter(([name]) => name !== 'authorizeProjectRoot').length;
    const result = await handlers[channel](null, { ...payload, rootPath: '/denied' });
    assert.deepStrictEqual(result, { ok: false, message: 'Projeto não autorizado.' });
    assert.strictEqual(
      calls.filter(([name]) => name !== 'authorizeProjectRoot').length,
      serviceCallsBefore,
      `${channel} must not call a service after authorization fails`
    );
  }

  const missingRoot = handlers['milestones:list'](null);
  assert.deepStrictEqual(missingRoot, { ok: false, message: 'Projeto não autorizado.' });
  assert.deepStrictEqual(calls.at(-1), ['authorizeProjectRoot', '']);

  console.log('milestone-handlers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
