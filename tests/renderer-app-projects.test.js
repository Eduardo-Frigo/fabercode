const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app_projects.js'), 'utf8');
const sandbox = {
  console,
  window: {
    clearTimeout,
    FaberProjectSidebar: {
      normalizeProjectItems: (items) => items,
    },
    setTimeout,
  },
};
sandbox.window.window = sandbox.window;
vm.runInNewContext(source, sandbox, { filename: 'app_projects.js' });

const factory = sandbox.window.FaberAppProjects.createAppProjectController;
assert.strictEqual(typeof factory, 'function');

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

(async () => {
  const calls = [];
  const state = {
    projectConversations: {
      'project-1': [{ id: 'conversation-1', title: 'Antigo' }],
    },
  };
  const controller = factory({
    api: {
      renameConversation: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          conversations: [{ id: payload.conversationId, title: payload.title }],
        };
      },
    },
    controllers: {
      projectSidebarController: { render: () => calls.push({ render: true }) },
    },
    state,
  });

  await controller.renameConversation(
    'project-1',
    state.projectConversations['project-1'][0],
    'Novo título'
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0])), {
    projectId: 'project-1',
    conversationId: 'conversation-1',
    title: 'Novo título',
  });
  assert.deepStrictEqual(state.projectConversations['project-1'], [
    { id: 'conversation-1', title: 'Novo título' },
  ]);
  assert.deepStrictEqual(calls[1], { render: true });

  {
    const localState = {
      projectConversations: {
        'project-1': [{ id: 'conversation-1', title: 'Antigo' }],
      },
    };
    const localController = factory({ api: {}, state: localState });
    await localController.renameConversation(
      'project-1',
      localState.projectConversations['project-1'][0],
      '  Local  '
    );
    assert.strictEqual(localState.projectConversations['project-1'][0].title, 'Local');
  }

  {
    const switchCalls = [];
    const switchState = {
      activeConversationByProject: {},
      activeJobId: 'job-active',
      automataContractLedger: [],
      automataContractSummary: null,
      expandedProjects: {},
      nextSteps: [],
      pendingAction: { targetFile: 'src/pending.js' },
      pendingActionJobId: 'job-pending',
      projectConversations: {},
      projects: [
        { id: 'project-1', name: 'One', rootPath: '/workspace/one' },
        { id: 'project-2', name: 'Two', rootPath: '/workspace/two' },
      ],
      selectedProjectId: 'project-1',
      selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
      uiMode: 'default',
    };
    const switchController = factory({
      api: {
        cancelJob: async (payload) => {
          switchCalls.push(['cancel', payload]);
          return { ok: true, job: { id: payload.jobId, status: 'cancelled' } };
        },
        getMempalaceStatus: async () => null,
        scanProject: async (rootPath) => ({
          ok: true,
          info: { id: 'project-2', rootPath, totalFiles: 1 },
          nextSteps: [],
        }),
      },
      callbacks: {
        clearPending: () => {
          switchState.pendingAction = null;
          switchState.pendingActionJobId = null;
        },
        invalidateSubmission: (reason) => switchCalls.push(['invalidate', reason]),
        resetApprovalMode: (reason) => switchCalls.push(['reset', reason]),
      },
      state: switchState,
    });
    await switchController.selectProject('project-2');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(switchCalls.slice(0, 4))), [
      ['invalidate', 'project_switch'],
      ['cancel', { jobId: 'job-pending' }],
      ['cancel', { jobId: 'job-active' }],
      ['reset', 'project_switch'],
    ]);
    assert.strictEqual(switchState.selectedProjectId, 'project-2');
    assert.strictEqual(switchState.pendingAction, null);
    assert.strictEqual(switchState.pendingActionJobId, null);

    for (const activeJob of [
      { id: 'job-resume-running', status: 'running', phase: 'execute_pending' },
      { id: 'job-resume-retry', status: 'retry_pending', phase: 'execute_validation' },
      { id: 'job-resume-cancelling', status: 'running', phase: 'cancelling' },
    ]) {
      const resumeCalls = [];
      const resumeState = {
        activeConversationByProject: {},
        activeJobId: null,
        automataContractLedger: [],
        automataContractSummary: null,
        expandedProjects: {},
        nextSteps: [],
        pendingAction: null,
        pendingActionJobId: null,
        projectConversations: {},
        projects: [{ id: 'project-resume', name: 'Resume', rootPath: '/workspace/resume' }],
        selectedProjectId: null,
        selectedProjectInfo: null,
        uiMode: 'default',
      };
      const resumeController = factory({
        api: {
          getMempalaceStatus: async () => null,
          listJobs: async (payload) => {
            resumeCalls.push(['list-jobs', payload]);
            return {
              ok: true,
              jobs: [
                { id: 'job-terminal-old', status: 'completed', phase: 'done' },
                {
                  ...activeJob,
                  projectId: 'project-resume',
                  rootPath: '/workspace/resume',
                },
              ],
            };
          },
          scanProject: async (rootPath) => ({
            ok: true,
            info: { id: 'project-resume', rootPath, totalFiles: 1 },
            nextSteps: [],
          }),
        },
        callbacks: {
          startJobPolling: (jobId, snapshot) => resumeCalls.push([
            'start-polling',
            jobId,
            snapshot && snapshot.phase,
          ]),
        },
        state: resumeState,
      });
      assert.strictEqual(await resumeController.selectProject('project-resume'), true);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(resumeCalls)), [
        ['list-jobs', { projectId: 'project-resume', limit: 12 }],
        ['start-polling', activeJob.id, activeJob.phase],
      ]);
    }

    {
      const rankedCalls = [];
      const rankedState = {
        activeConversationByProject: {},
        activeJobId: null,
        automataContractLedger: [],
        automataContractSummary: null,
        expandedProjects: {},
        nextSteps: [],
        pendingAction: null,
        pendingActionJobId: null,
        projectConversations: {},
        projects: [{ id: 'project-ranked', name: 'Ranked', rootPath: '/workspace/ranked' }],
        selectedProjectId: null,
        selectedProjectInfo: null,
        uiMode: 'default',
      };
      const jobs = [
        { id: 'job-retry-newer', status: 'retry_pending', phase: 'execute_validation', updatedAt: '2026-08-31T12:00:05.000Z' },
        { id: 'job-cancelling-old', status: 'running', phase: 'cancelling', updatedAt: '2026-08-31T12:00:02.000Z' },
        { id: 'job-running-newest', status: 'running', phase: 'execute_pending', updatedAt: '2026-08-31T12:00:06.000Z' },
        { id: 'job-cancelling-new', status: 'running', phase: 'cancelling', updatedAt: '2026-08-31T12:00:04.000Z' },
      ].map((job) => ({
        ...job,
        projectId: 'project-ranked',
        rootPath: '/workspace/ranked',
      }));
      const rankedController = factory({
        api: {
          getMempalaceStatus: async () => null,
          listJobs: async () => ({ ok: true, jobs }),
          scanProject: async (rootPath) => ({
            ok: true,
            info: { id: 'project-ranked', rootPath },
            nextSteps: [],
          }),
        },
        callbacks: {
          startJobPolling: (jobId, snapshot) => rankedCalls.push([jobId, snapshot && snapshot.id]),
        },
        state: rankedState,
      });
      assert.strictEqual(await rankedController.selectProject('project-ranked'), true);
      assert.deepStrictEqual(rankedCalls, [['job-cancelling-new', 'job-cancelling-new']]);

      jobs.splice(0, jobs.length,
        {
          id: 'job-retry-latest',
          projectId: 'project-ranked',
          rootPath: '/workspace/ranked',
          status: 'retry_pending',
          phase: 'execute_validation',
          updatedAt: '2026-08-31T12:00:09.000Z',
        },
        {
          id: 'job-running-old',
          projectId: 'project-ranked',
          rootPath: '/workspace/ranked',
          status: 'running',
          phase: 'execute_pending',
          updatedAt: '2026-08-31T12:00:07.000Z',
        },
        {
          id: 'job-running-new',
          projectId: 'project-ranked',
          rootPath: '/workspace/ranked',
          status: 'running',
          phase: 'execute_validation',
          updatedAt: '2026-08-31T12:00:08.000Z',
        },
      );
      rankedCalls.length = 0;
      assert.strictEqual(await rankedController.selectProject('project-ranked'), true);
      assert.deepStrictEqual(rankedCalls, [['job-running-new', 'job-running-new']]);
    }

    {
      const lateListJobs = deferred();
      const firstListStarted = deferred();
      const staleStarts = [];
      const staleSelectionState = {
        activeConversationByProject: {},
        activeJobId: null,
        automataContractLedger: [],
        automataContractSummary: null,
        expandedProjects: {},
        nextSteps: [],
        pendingAction: null,
        pendingActionJobId: null,
        projectConversations: {},
        projects: [
          { id: 'project-a', name: 'A', rootPath: '/workspace/a' },
          { id: 'project-b', name: 'B', rootPath: '/workspace/b' },
        ],
        selectedProjectId: null,
        selectedProjectInfo: null,
        uiMode: 'default',
      };
      const staleSelectionController = factory({
        api: {
          getMempalaceStatus: async () => null,
          listJobs: async ({ projectId }) => {
            if (projectId === 'project-a') {
              firstListStarted.resolve();
              return lateListJobs.promise;
            }
            return { ok: true, jobs: [] };
          },
          scanProject: async (rootPath) => ({
            ok: true,
            info: {
              id: rootPath.endsWith('/a') ? 'project-a' : 'project-b',
              rootPath,
            },
            nextSteps: [],
          }),
        },
        callbacks: {
          startJobPolling: (jobId) => staleStarts.push(jobId),
        },
        state: staleSelectionState,
      });
      const firstSelection = staleSelectionController.selectProject('project-a');
      await firstListStarted.promise;
      assert.strictEqual(await staleSelectionController.selectProject('project-b'), true);
      lateListJobs.resolve({
        ok: true,
        jobs: [{
          id: 'job-project-a',
          projectId: 'project-a',
          rootPath: '/workspace/a',
          status: 'running',
          phase: 'execute_pending',
          updatedAt: '2026-08-31T12:00:00.000Z',
        }],
      });
      assert.strictEqual(await firstSelection, false);
      assert.deepStrictEqual(staleStarts, []);
      assert.strictEqual(staleSelectionState.selectedProjectId, 'project-b');
    }

    {
      const settlingCalls = [];
      const settlingState = {
        ...switchState,
        activeJobId: 'job-settling-cancel',
        pendingAction: null,
        pendingActionJobId: null,
        selectedProjectId: 'project-1',
        selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
      };
      let cleanupPoll = 0;
      const settlingController = factory({
        api: {
          cancelJob: async ({ jobId }) => ({
            ok: true,
            job: { id: jobId, status: 'running', phase: 'cancelling' },
          }),
          getJob: async ({ jobId }) => {
            cleanupPoll += 1;
            settlingCalls.push(['get-job', jobId]);
            return {
              ok: true,
              job: cleanupPoll < 2
                ? { id: jobId, status: 'running', phase: 'cancelling' }
                : { id: jobId, status: 'cancelled', phase: 'cancelled' },
            };
          },
          getMempalaceStatus: async () => null,
          listJobs: async () => ({ ok: true, jobs: [] }),
          scanProject: async (rootPath) => ({
            ok: true,
            info: { id: 'project-2', rootPath },
            nextSteps: [],
          }),
        },
        callbacks: {
          waitForCancellationPoll: async () => {},
        },
        state: settlingState,
      });
      assert.strictEqual(await settlingController.selectProject('project-2'), true);
      assert.deepStrictEqual(settlingCalls, [
        ['get-job', 'job-settling-cancel'],
        ['get-job', 'job-settling-cancel'],
      ]);
      assert.strictEqual(settlingState.activeJobId, null);
      assert.strictEqual(settlingState.selectedProjectId, 'project-2');
    }

    {
      const timeoutState = {
        ...switchState,
        activeJobId: 'job-cancel-timeout',
        pendingAction: null,
        pendingActionJobId: null,
        selectedProjectId: 'project-1',
        selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
      };
      let scanAttempted = false;
      let timeoutPolls = 0;
      const timeoutMessages = [];
      const cancellationResultDeadlines = [];
      const timeoutController = factory({
        api: {
          cancelJob: async ({ jobId }) => ({
            ok: true,
            job: { id: jobId, status: 'running', phase: 'cancelling' },
          }),
          getJob: async ({ jobId }) => {
            timeoutPolls += 1;
            return {
              ok: true,
              job: { id: jobId, status: 'running', phase: 'cancelling' },
            };
          },
          scanProject: async () => {
            scanAttempted = true;
            return { ok: true };
          },
        },
        callbacks: {
          appendMessage: (...args) => timeoutMessages.push(args),
          waitForCancellationPoll: async () => {},
          waitForCancellationResult: async (pendingResult, timeoutMs) => {
            cancellationResultDeadlines.push(timeoutMs);
            return pendingResult;
          },
        },
        state: timeoutState,
      });
      assert.strictEqual(await timeoutController.selectProject('project-2'), false);
      assert.strictEqual(await timeoutController.selectProject('project-2'), false);
      assert.strictEqual(scanAttempted, false);
      assert.strictEqual(timeoutPolls, 40);
      assert.strictEqual(timeoutMessages.length, 1);
      assert.strictEqual(cancellationResultDeadlines.length, 40);
      assert.strictEqual(cancellationResultDeadlines.every((value) => value > 0 && value <= 5000), true);
      assert.strictEqual(timeoutState.activeJobId, 'job-cancel-timeout');
      assert.strictEqual(timeoutState.selectedProjectId, 'project-1');
    }

    const deniedState = {
      ...switchState,
      activeJobId: null,
      pendingAction: { targetFile: 'src/preserved.js' },
      pendingActionJobId: 'job-cancel-denied',
      selectedProjectId: 'project-1',
      selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
    };
    const deniedLifecycle = [];
    const deniedController = factory({
      api: {
        cancelJob: async () => ({ ok: false, message: 'Cancel denied.' }),
        scanProject: async () => {
          throw new Error('project scan must not run after cancellation failure');
        },
      },
      callbacks: {
        invalidateSubmission: (reason) => deniedLifecycle.push(['invalidate', reason]),
        resetApprovalMode: (reason) => deniedLifecycle.push(['reset', reason]),
      },
      state: deniedState,
    });
    const denied = await deniedController.selectProject('project-2');
    assert.strictEqual(denied, false);
    assert.strictEqual(deniedState.selectedProjectId, 'project-1');
    assert.strictEqual(deniedState.pendingActionJobId, 'job-cancel-denied');
    assert.deepStrictEqual(deniedLifecycle, [['invalidate', 'project_switch']]);

    const scanFailureLifecycle = [];
    const scanFailureMessages = [];
    const scanFailureStatuses = [];
    const scanFailureState = {
      ...deniedState,
      pendingAction: null,
      pendingActionJobId: null,
      projects: switchState.projects,
    };
    const scanFailureController = factory({
      api: {
        scanProject: async () => ({ ok: false, message: 'Scan failed.' }),
      },
      callbacks: {
        appendMessage: (...args) => scanFailureMessages.push(args),
        hideJobProgress: () => scanFailureLifecycle.push(['hide-progress']),
        invalidateSubmission: (reason) => scanFailureLifecycle.push(['invalidate', reason]),
        resetApprovalMode: (reason) => scanFailureLifecycle.push(['reset', reason]),
        stopJobPolling: () => scanFailureLifecycle.push(['stop-polling']),
        updateStatus: (message) => scanFailureStatuses.push(message),
      },
      state: scanFailureState,
    });
    const scanFailed = await scanFailureController.selectProject('project-2');
    assert.strictEqual(scanFailed, false);
    assert.strictEqual(scanFailureState.selectedProjectId, 'project-1');
    assert.deepStrictEqual(scanFailureLifecycle, [
      ['invalidate', 'project_switch'],
      ['reset', 'project_switch'],
      ['stop-polling'],
      ['hide-progress'],
    ]);
    assert.deepStrictEqual(scanFailureMessages, []);
    assert.deepStrictEqual(scanFailureStatuses, ['Analisando projeto...', 'Erro na análise']);
    assert.strictEqual(scanFailureState.selectedProjectId, 'project-1');

    const clearLifecycle = [];
    const clearState = {
      activeJobId: 'job-clear',
      automataContractLedger: [],
      automataContractSummary: null,
      nextSteps: [],
      pendingAction: null,
      pendingActionJobId: null,
      selectedProjectId: 'project-1',
      selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
    };
    const clearController = factory({
      api: {
        cancelJob: async (payload) => {
          clearLifecycle.push(['cancel', payload]);
          return { ok: true, job: { id: payload.jobId, status: 'cancelled', phase: 'cancelled' } };
        },
      },
      callbacks: {
        invalidateSubmission: (reason) => clearLifecycle.push(['invalidate', reason]),
        resetApprovalMode: (reason) => clearLifecycle.push(['reset', reason]),
      },
      state: clearState,
    });
    await clearController.clearSelectionState();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(clearLifecycle)), [
      ['invalidate', 'selection_cleared'],
      ['cancel', { jobId: 'job-clear' }],
      ['reset', 'selection_cleared'],
    ]);
    assert.strictEqual(clearState.activeJobId, null);

    const malformedPendingCalls = [];
    const malformedPendingState = {
      ...clearState,
      activeJobId: 'job-active-fallback',
      pendingAction: { targetFile: 'src/legacy.js' },
      pendingActionJobId: null,
      selectedProjectId: 'project-1',
      selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
    };
    const malformedPendingController = factory({
      api: {
        cancelJob: async (payload) => {
          malformedPendingCalls.push(payload);
          return { ok: true, job: { id: payload.jobId, status: 'cancelled', phase: 'cancelled' } };
        },
      },
      state: malformedPendingState,
    });
    assert.strictEqual(await malformedPendingController.clearSelectionState(), true);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(malformedPendingCalls)),
      [{ jobId: 'job-active-fallback' }],
    );
    assert.strictEqual(malformedPendingState.activeJobId, null);
    assert.strictEqual(malformedPendingState.selectedProjectId, null);

    const malformedSwitchState = {
      ...switchState,
      activeJobId: null,
      pendingAction: { rootPath: '/workspace/one', targetFile: 'src/legacy.js' },
      pendingActionJobId: null,
      selectedProjectId: 'project-1',
      selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
    };
    const malformedSwitchController = factory({
      api: {
        getMempalaceStatus: async () => null,
        scanProject: async (rootPath) => ({
          ok: true,
          info: { id: 'project-2', rootPath },
          nextSteps: [],
        }),
      },
      callbacks: {
        clearPending: () => {
          malformedSwitchState.pendingAction = null;
          malformedSwitchState.pendingActionJobId = null;
        },
      },
      state: malformedSwitchState,
    });
    assert.strictEqual(await malformedSwitchController.selectProject('project-2'), true);
    assert.strictEqual(malformedSwitchState.pendingAction, null);
    assert.strictEqual(malformedSwitchState.pendingActionJobId, null);
    assert.strictEqual(malformedSwitchState.selectedProjectId, 'project-2');

    const clearDeniedLifecycle = [];
    const clearDeniedState = {
      ...clearState,
      activeJobId: 'job-clear-denied',
      selectedProjectId: 'project-1',
      selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
    };
    const clearDeniedController = factory({
      api: {
        cancelJob: async () => ({ ok: false, message: 'Cancel denied.' }),
      },
      callbacks: {
        hideJobProgress: () => clearDeniedLifecycle.push('hide'),
        invalidateSubmission: (reason) => clearDeniedLifecycle.push(reason),
        resetApprovalMode: () => clearDeniedLifecycle.push('reset'),
        stopJobPolling: () => clearDeniedLifecycle.push('stop'),
      },
      state: clearDeniedState,
    });
    assert.strictEqual(await clearDeniedController.clearSelectionState(), false);
    assert.strictEqual(clearDeniedState.selectedProjectId, 'project-1');
    assert.strictEqual(clearDeniedState.activeJobId, 'job-clear-denied');
    assert.deepStrictEqual(clearDeniedLifecycle, ['selection_cleared']);

    let releaseScan;
    const scanGate = new Promise((resolve) => { releaseScan = resolve; });
    const raceCalls = [];
    const raceState = {
      activeConversationByProject: {},
      activeJobId: null,
      automataContractLedger: [],
      automataContractSummary: null,
      expandedProjects: {},
      nextSteps: [],
      pendingAction: null,
      pendingActionJobId: null,
      projectConversations: {},
      projects: switchState.projects,
      selectedProjectId: 'project-1',
      selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
      uiMode: 'default',
    };
    const raceController = factory({
      api: {
        cancelJob: async (payload) => {
          raceCalls.push(['cancel', payload]);
          return { ok: true, job: { id: payload.jobId, status: 'cancelled', phase: 'cancelled' } };
        },
        getMempalaceStatus: async () => null,
        scanProject: async (rootPath) => {
          await scanGate;
          return { ok: true, info: { id: 'project-2', rootPath }, nextSteps: [] };
        },
      },
      callbacks: {
        clearPending: () => {
          raceState.pendingAction = null;
          raceState.pendingActionJobId = null;
        },
      },
      state: raceState,
    });
    const racingSwitch = raceController.selectProject('project-2');
    await Promise.resolve();
    raceState.pendingAction = { targetFile: 'src/late.js' };
    raceState.pendingActionJobId = 'job-during-scan';
    releaseScan();
    assert.strictEqual(await racingSwitch, true);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(raceCalls)),
      [['cancel', { jobId: 'job-during-scan' }]],
    );
    assert.strictEqual(raceState.pendingAction, null);
    assert.strictEqual(raceState.selectedProjectId, 'project-2');

    const trashCalls = [];
    const trashState = {
      activeJobId: 'job-before-trash',
      automataContractLedger: [],
      automataContractSummary: null,
      nextSteps: [],
      pendingAction: null,
      pendingActionJobId: null,
      projects: [{ id: 'project-1', name: 'One', rootPath: '/workspace/one' }],
      selectedProjectId: 'project-1',
      selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
    };
    const trashController = factory({
      api: {
        cancelJob: async (payload) => {
          trashCalls.push(['cancel', payload]);
          return { ok: true, job: { id: payload.jobId, status: 'cancelled', phase: 'cancelled' } };
        },
        trashProject: async (payload) => {
          trashCalls.push(['trash', payload]);
          return { ok: true, projects: [] };
        },
      },
      callbacks: {
        invalidateSubmission: (reason) => trashCalls.push(['invalidate', reason]),
        resetApprovalMode: (reason) => trashCalls.push(['reset', reason]),
      },
      state: trashState,
    });
    await trashController.runProjectContextAction('trash', 'project-1');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(trashCalls.slice(0, 4))), [
      ['invalidate', 'project_trash'],
      ['cancel', { jobId: 'job-before-trash' }],
      ['reset', 'project_trash'],
      ['trash', { id: 'project-1' }],
    ]);
    assert.strictEqual(trashState.selectedProjectId, null);

    let archiveCalled = false;
    const archiveDeniedState = {
      ...trashState,
      activeJobId: 'job-before-archive',
      projects: [{ id: 'project-1', name: 'One', rootPath: '/workspace/one' }],
      selectedProjectId: 'project-1',
      selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
    };
    const archiveDeniedController = factory({
      api: {
        archiveProject: async () => {
          archiveCalled = true;
          return { ok: true, projects: [] };
        },
        cancelJob: async () => ({ ok: false }),
      },
      state: archiveDeniedState,
    });
    await archiveDeniedController.runProjectContextAction('archive', 'project-1');
    assert.strictEqual(archiveCalled, false);
    assert.strictEqual(archiveDeniedState.selectedProjectId, 'project-1');
    assert.strictEqual(archiveDeniedState.activeJobId, 'job-before-archive');
  }

  console.log('renderer-app-projects.test.js: ok');
})();
