const assert = require('assert');

const {
  MILESTONE_VALIDATION_REASONS,
  createMilestoneValidationService,
} = require('../main/services/milestone_validation_service');

function createCompletedJob(overrides = {}) {
  const completionFields = {
    processExecutionPerformed: true,
    validationPending: false,
    validationVerified: true,
  };
  return {
    id: 'job-validated-1',
    rootPath: '/authorized/project',
    status: 'completed',
    phase: 'done',
    createdAt: '2026-08-25T14:01:00.000Z',
    updatedAt: '2026-08-25T14:05:00.000Z',
    checkpoints: {
      execute_result: {
        savedAt: '2026-08-25T14:04:59.000Z',
        data: {
          ok: true,
          ...completionFields,
        },
      },
    },
    events: [{
      id: 'event-completed-1',
      type: 'job.completed',
      createdAt: '2026-08-25T14:05:00.000Z',
      payload: completionFields,
    }],
    ...overrides,
  };
}

function run() {
  const completions = [];
  let activeMilestones = [{
    id: 'milestone-6',
    status: 'active',
    startedAt: '2026-08-25T14:00:00.000Z',
  }];
  let job = createCompletedJob();
  const service = createMilestoneValidationService({
    getAuthorizedJobById: (jobId) => (
      jobId === job.id ? { ok: true, job } : { ok: false, code: 'job_not_found' }
    ),
    milestoneService: {
      listMilestones: () => activeMilestones,
      completeMilestoneAfterValidation: (rootPath, milestoneId, receipt) => {
        completions.push({ rootPath, milestoneId, receipt });
        return { ok: true, milestoneId, receipt };
      },
    },
  });

  const completed = service.completeActiveMilestoneFromJob(
    '/authorized/project',
    'job-validated-1',
  );
  assert.strictEqual(completed.ok, true);
  assert.strictEqual(completions.length, 1);
  assert.strictEqual(completions[0].milestoneId, 'milestone-6');
  assert.deepStrictEqual(Object.keys(completions[0].receipt).sort(), [
    'jobId',
    'status',
    'validatedAt',
    'validationDigest',
  ]);
  assert.strictEqual(completions[0].receipt.jobId, 'job-validated-1');
  assert.strictEqual(completions[0].receipt.status, 'passed');
  assert.match(completions[0].receipt.validationDigest, /^sha256:[a-f0-9]{64}$/);

  job = createCompletedJob({
    checkpoints: {
      execute_result: {
        savedAt: '2026-08-25T14:04:59.000Z',
        data: {
          ok: true,
          processExecutionPerformed: false,
          validationPending: true,
          validationVerified: false,
        },
      },
    },
  });
  const pending = service.completeActiveMilestoneFromJob(
    '/authorized/project',
    'job-validated-1',
  );
  assert.deepStrictEqual(pending, {
    ok: false,
    code: MILESTONE_VALIDATION_REASONS.VALIDATION_PENDING,
  });
  assert.strictEqual(completions.length, 1);

  job = createCompletedJob({
    status: 'failed',
    phase: 'execute_failed',
    checkpoints: {
      execute_result: {
        savedAt: '2026-08-25T14:04:59.000Z',
        data: {
          ok: false,
          processExecutionPerformed: true,
          validationPending: false,
          validationVerified: false,
        },
      },
    },
    events: [{
      id: 'event-failed-1',
      type: 'job.failed',
      createdAt: '2026-08-25T14:05:00.000Z',
      payload: {
        processExecutionPerformed: true,
        validationPending: false,
        validationVerified: false,
      },
    }],
  });
  const groundedFailure = service.completeActiveMilestoneFromJob(
    '/authorized/project',
    'job-validated-1',
  );
  assert.deepStrictEqual(groundedFailure, {
    ok: false,
    code: MILESTONE_VALIDATION_REASONS.JOB_UNAVAILABLE,
  });
  assert.strictEqual(completions.length, 1);

  job = createCompletedJob({ rootPath: '/other/project' });
  assert.deepStrictEqual(
    service.completeActiveMilestoneFromJob('/authorized/project', 'job-validated-1'),
    { ok: false, code: MILESTONE_VALIDATION_REASONS.ROOT_MISMATCH },
  );

  job = createCompletedJob({ createdAt: '2026-08-25T13:59:59.000Z' });
  assert.deepStrictEqual(
    service.completeActiveMilestoneFromJob('/authorized/project', 'job-validated-1'),
    { ok: false, code: MILESTONE_VALIDATION_REASONS.STALE_JOB },
  );

  job = createCompletedJob();
  activeMilestones = [
    activeMilestones[0],
    { id: 'milestone-other', status: 'active', startedAt: '2026-08-25T14:00:00.000Z' },
  ];
  assert.deepStrictEqual(
    service.completeActiveMilestoneFromJob('/authorized/project', 'job-validated-1'),
    { ok: false, code: MILESTONE_VALIDATION_REASONS.ACTIVE_MILESTONE_INVALID },
  );

  console.log('milestone-validation-service.test.js: ok');
}

run();
