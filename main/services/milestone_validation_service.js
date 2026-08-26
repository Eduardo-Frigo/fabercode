const defaultCrypto = require('crypto');

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const MILESTONE_VALIDATION_REASONS = Object.freeze({
  ACTIVE_MILESTONE_INVALID: 'MILESTONE_VALIDATION_ACTIVE_MILESTONE_INVALID',
  INVALID_INPUT: 'MILESTONE_VALIDATION_INVALID_INPUT',
  JOB_UNAVAILABLE: 'MILESTONE_VALIDATION_JOB_UNAVAILABLE',
  ROOT_MISMATCH: 'MILESTONE_VALIDATION_ROOT_MISMATCH',
  STALE_JOB: 'MILESTONE_VALIDATION_STALE_JOB',
  VALIDATION_PENDING: 'MILESTONE_VALIDATION_PENDING',
});

function ownDataValue(value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && descriptor.enumerable === true
    && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function validIsoTimestamp(value) {
  return typeof value === 'string' && value.length <= 64
    && !Number.isNaN(Date.parse(value));
}

function validatedExecutionFields(value) {
  return ownDataValue(value, 'processExecutionPerformed') === true
    && ownDataValue(value, 'validationPending') === false
    && ownDataValue(value, 'validationVerified') === true;
}

function createMilestoneValidationService(dependencies = {}) {
  const crypto = dependencies.crypto || defaultCrypto;
  const getAuthorizedJobById = dependencies.getAuthorizedJobById;
  const milestoneService = dependencies.milestoneService;
  if (typeof getAuthorizedJobById !== 'function') {
    throw new TypeError('getAuthorizedJobById dependency missing');
  }
  if (!milestoneService
    || typeof milestoneService.listMilestones !== 'function'
    || typeof milestoneService.completeMilestoneAfterValidation !== 'function') {
    throw new TypeError('milestoneService dependency missing');
  }

  function completeMilestoneFromJob(rootPath, milestoneId, jobId) {
    if (typeof rootPath !== 'string' || !rootPath
      || typeof milestoneId !== 'string' || !SAFE_IDENTIFIER.test(milestoneId)
      || typeof jobId !== 'string' || !SAFE_IDENTIFIER.test(jobId)) {
      return { ok: false, code: MILESTONE_VALIDATION_REASONS.INVALID_INPUT };
    }

    const milestones = milestoneService.listMilestones(rootPath);
    const milestone = Array.isArray(milestones)
      ? milestones.find((entry) => ownDataValue(entry, 'id') === milestoneId)
      : null;
    if (!milestone || ownDataValue(milestone, 'status') !== 'active') {
      return {
        ok: false,
        code: MILESTONE_VALIDATION_REASONS.ACTIVE_MILESTONE_INVALID,
      };
    }

    const found = getAuthorizedJobById(jobId);
    const job = found && found.ok === true ? found.job : null;
    if (!job || ownDataValue(job, 'id') !== jobId
      || ownDataValue(job, 'status') !== 'completed'
      || ownDataValue(job, 'phase') !== 'done') {
      return { ok: false, code: MILESTONE_VALIDATION_REASONS.JOB_UNAVAILABLE };
    }
    if (ownDataValue(job, 'rootPath') !== rootPath) {
      return { ok: false, code: MILESTONE_VALIDATION_REASONS.ROOT_MISMATCH };
    }

    const checkpoints = ownDataValue(job, 'checkpoints');
    const executeResult = ownDataValue(checkpoints, 'execute_result');
    const executeData = ownDataValue(executeResult, 'data');
    const events = ownDataValue(job, 'events');
    const completedEvent = Array.isArray(events)
      ? events.find((event) => ownDataValue(event, 'type') === 'job.completed')
      : null;
    const completionPayload = ownDataValue(completedEvent, 'payload');
    if (ownDataValue(executeData, 'ok') !== true
      || !validatedExecutionFields(executeData)
      || !validatedExecutionFields(completionPayload)) {
      return { ok: false, code: MILESTONE_VALIDATION_REASONS.VALIDATION_PENDING };
    }

    const startedAt = ownDataValue(milestone, 'startedAt');
    const jobCreatedAt = ownDataValue(job, 'createdAt');
    const validatedAt = ownDataValue(completedEvent, 'createdAt');
    const checkpointSavedAt = ownDataValue(executeResult, 'savedAt');
    if (!validIsoTimestamp(startedAt)
      || !validIsoTimestamp(jobCreatedAt)
      || !validIsoTimestamp(validatedAt)
      || !validIsoTimestamp(checkpointSavedAt)
      || Date.parse(jobCreatedAt) < Date.parse(startedAt)
      || Date.parse(validatedAt) < Date.parse(startedAt)) {
      return { ok: false, code: MILESTONE_VALIDATION_REASONS.STALE_JOB };
    }

    const evidence = {
      checkpointSavedAt,
      completedEventId: ownDataValue(completedEvent, 'id') || '',
      jobCreatedAt,
      jobId,
      jobUpdatedAt: ownDataValue(job, 'updatedAt') || '',
      milestoneId,
      rootPath,
      validatedAt,
    };
    const validationDigest = `sha256:${crypto
      .createHash('sha256')
      .update(JSON.stringify(evidence), 'utf8')
      .digest('hex')}`;
    return milestoneService.completeMilestoneAfterValidation(rootPath, milestoneId, {
      jobId,
      status: 'passed',
      validatedAt,
      validationDigest,
    });
  }

  function completeActiveMilestoneFromJob(rootPath, jobId) {
    const milestones = milestoneService.listMilestones(rootPath);
    const active = Array.isArray(milestones)
      ? milestones.filter((entry) => ownDataValue(entry, 'status') === 'active')
      : [];
    if (active.length !== 1 || !SAFE_IDENTIFIER.test(String(active[0].id || ''))) {
      return {
        ok: false,
        code: MILESTONE_VALIDATION_REASONS.ACTIVE_MILESTONE_INVALID,
      };
    }
    return completeMilestoneFromJob(rootPath, active[0].id, jobId);
  }

  return Object.freeze({
    completeActiveMilestoneFromJob,
    completeMilestoneFromJob,
  });
}

module.exports = {
  MILESTONE_VALIDATION_REASONS,
  createMilestoneValidationService,
};
