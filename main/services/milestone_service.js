const defaultCrypto = require('crypto');
const defaultFs = require('fs');
const defaultPath = require('path');
const util = require('util');

const {
  canonicalizeMapChatProposalPatch,
  computeMapChatProposalPatchDigest,
} = require('./map_chat_proposal_store');

const EMPTY_MILESTONES = [];
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_COMMIT_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EDITABLE_MILESTONE_STATUSES = new Set(['planned', 'ready', 'active', 'blocked']);
const APPROVED_PROPOSAL_INPUT_KEYS = Object.freeze([
  'expectedDigest',
  'patch',
  'patchDigest',
]);
const APPROVED_PROPOSAL_PATCH_KEYS = Object.freeze([
  'milestones',
  'operation',
  'schemaVersion',
]);
const COMPLETION_RECEIPT_KEYS = Object.freeze([
  'jobId',
  'status',
  'validatedAt',
  'validationDigest',
]);
const VERIFIED_COMMIT_KEYS = Object.freeze([
  'createdAt',
  'hash',
  'message',
]);
const MILESTONE_LIFECYCLE_REASONS = Object.freeze({
  ACTIVE_CONFLICT: 'MILESTONE_ACTIVE_CONFLICT',
  INVALID_COMMIT: 'MILESTONE_INVALID_COMMIT',
  INVALID_COMPLETION_RECEIPT: 'MILESTONE_INVALID_COMPLETION_RECEIPT',
  INVALID_STATUS: 'MILESTONE_INVALID_STATUS',
  NOT_ACTIVE: 'MILESTONE_NOT_ACTIVE',
  TERMINAL: 'MILESTONE_TERMINAL',
  VALIDATION_REQUIRED: 'MILESTONE_VALIDATION_REQUIRED',
});
const MILESTONE_PROPOSAL_REASONS = Object.freeze({
  INVALID_INPUT: 'MILESTONE_PROPOSAL_INVALID_INPUT',
  PATCH_DIGEST_MISMATCH: 'MILESTONE_PROPOSAL_PATCH_DIGEST_MISMATCH',
  STALE_BASE: 'MILESTONE_PROPOSAL_STALE_BASE',
  WRITE_FAILED: 'MILESTONE_PROPOSAL_WRITE_FAILED',
});

function exactDataFields(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
    || expectedKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function validApprovedMilestones(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1 || value.length > 100) return false;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    return false;
  }
  let activeCount = 0;
  for (const milestone of value) {
    if (!milestone || typeof milestone !== 'object' || Array.isArray(milestone)) return false;
    const id = milestone.id;
    const title = milestone.title;
    const number = milestone.number;
    const tasks = milestone.tasks;
    const commits = Object.hasOwn(milestone, 'commits') ? milestone.commits : [];
    if (typeof id !== 'string' || !SAFE_IDENTIFIER.test(id)
      || typeof title !== 'string' || !title.trim() || title.length > 1_024
      || !Number.isSafeInteger(number) || number < 1
      || !Array.isArray(tasks) || tasks.length > 500
      || !Array.isArray(commits) || commits.length !== 0
      || !EDITABLE_MILESTONE_STATUSES.has(milestone.status)
      || Object.hasOwn(milestone, 'startedAt')
      || Object.hasOwn(milestone, 'completedAt')
      || Object.hasOwn(milestone, 'completionEvidence')) return false;
    if (milestone.status === 'active') activeCount += 1;
  }
  return activeCount <= 1;
}

function validIsoTimestamp(value) {
  return typeof value === 'string' && value.length <= 64
    && !Number.isNaN(Date.parse(value));
}

function createMilestoneService(dependencies = {}) {
  const crypto = dependencies.crypto || defaultCrypto;
  const fs = dependencies.fs || defaultFs;
  const path = dependencies.path || defaultPath;

  function ensureFaberDir(rootPath) {
    const faberDir = path.join(rootPath, '.faber');
    if (!fs.existsSync(faberDir)) {
      fs.mkdirSync(faberDir, { recursive: true });
    }
    return faberDir;
  }

  function getMilestonesPath(rootPath, { ensure = true } = {}) {
    const faberDir = ensure ? ensureFaberDir(rootPath) : path.join(rootPath, '.faber');
    return path.join(faberDir, 'milestones.json');
  }

  function readMilestonesFile(rootPath) {
    const filePath = getMilestonesPath(rootPath, { ensure: false });
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error('Failed to parse milestones JSON', e);
      return null;
    }
  }

  function readMilestonesSnapshot(rootPath) {
    const filePath = getMilestonesPath(rootPath, { ensure: false });
    if (!fs.existsSync(filePath)) {
      return {
        ok: true,
        found: false,
        format: null,
        renderedAt: null,
        source: null,
        milestones: [],
        contentDigest: null,
      };
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      const contentDigest = `sha256:${crypto.createHash('sha256').update(content, 'utf8').digest('hex')}`;
      if (Array.isArray(parsed)) {
        return {
          ok: true,
          found: true,
          format: 'draft',
          renderedAt: null,
          source: null,
          milestones: parsed,
          contentDigest,
        };
      }
      if (parsed && typeof parsed === 'object'
        && parsed.renderedAt && Array.isArray(parsed.milestones)) {
        return {
          ok: true,
          found: true,
          format: 'rendered',
          renderedAt: parsed.renderedAt,
          source: parsed.source || null,
          milestones: parsed.milestones,
          contentDigest,
        };
      }
      return {
        ok: false,
        found: true,
        format: 'invalid',
        renderedAt: null,
        source: null,
        milestones: [],
        contentDigest,
        reason: 'invalid_milestones_envelope',
      };
    } catch {
      return {
        ok: false,
        found: true,
        format: 'invalid',
        renderedAt: null,
        source: null,
        milestones: [],
        contentDigest: null,
        reason: 'invalid_milestones_json',
      };
    }
  }

  function listMilestones(rootPath) {
    const snapshot = readMilestonesSnapshot(rootPath);
    return snapshot.ok && snapshot.found && snapshot.format === 'rendered'
      ? snapshot.milestones
      : EMPTY_MILESTONES;
  }

  function saveMilestones(rootPath, milestones) {
    const filePath = getMilestonesPath(rootPath);
    const currentMilestones = readMilestonesFile(rootPath);
    if (currentMilestones && !Array.isArray(currentMilestones) && currentMilestones.renderedAt && Array.isArray(currentMilestones.milestones)) {
      const payload = {
        ...currentMilestones,
        updatedAt: new Date().toISOString(),
        milestones,
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    } else {
      fs.writeFileSync(filePath, JSON.stringify(milestones, null, 2), 'utf8');
    }
    return { ok: true, milestones };
  }

  function persistRenderedMilestones(rootPath, milestones) {
    const filePath = getMilestonesPath(rootPath);
    const payload = {
      renderedAt: new Date().toISOString(),
      source: 'application-map-render',
      milestones,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, milestones };
  }

  function applyApprovedProposal(rootPath, rawInput) {
    let fields;
    let patch;
    try {
      fields = exactDataFields(rawInput, APPROVED_PROPOSAL_INPUT_KEYS);
      if (!fields) throw new TypeError('approved proposal input is invalid');
      const expectedDigest = fields.get('expectedDigest');
      const suppliedPatchDigest = fields.get('patchDigest');
      if (expectedDigest !== null
        && (typeof expectedDigest !== 'string' || !SAFE_DIGEST.test(expectedDigest))) {
        throw new TypeError('expectedDigest is invalid');
      }
      if (typeof suppliedPatchDigest !== 'string' || !SAFE_DIGEST.test(suppliedPatchDigest)) {
        throw new TypeError('patchDigest is invalid');
      }
      patch = canonicalizeMapChatProposalPatch(fields.get('patch'));
      const patchFields = exactDataFields(patch, APPROVED_PROPOSAL_PATCH_KEYS);
      if (!patchFields
        || patchFields.get('schemaVersion') !== 'milestone-replacement-patch.v1'
        || patchFields.get('operation') !== 'replace'
        || !validApprovedMilestones(patchFields.get('milestones'))) {
        throw new TypeError('approved milestone patch is invalid');
      }
    } catch {
      return { ok: false, code: MILESTONE_PROPOSAL_REASONS.INVALID_INPUT };
    }

    if (computeMapChatProposalPatchDigest(patch) !== fields.get('patchDigest')) {
      return {
        ok: false,
        code: MILESTONE_PROPOSAL_REASONS.PATCH_DIGEST_MISMATCH,
      };
    }

    const current = readMilestonesSnapshot(rootPath);
    if (!current || current.ok !== true) {
      return { ok: false, code: MILESTONE_PROPOSAL_REASONS.WRITE_FAILED };
    }
    if (current.contentDigest !== fields.get('expectedDigest')) {
      return { ok: false, code: MILESTONE_PROPOSAL_REASONS.STALE_BASE };
    }

    const filePath = getMilestonesPath(rootPath, { ensure: false });
    const hadPreviousFile = fs.existsSync(filePath);
    let previousBytes = null;
    try {
      if (hadPreviousFile) previousBytes = fs.readFileSync(filePath);
      const replacement = JSON.parse(JSON.stringify(patch.milestones));
      const saved = saveMilestones(rootPath, replacement);
      if (!saved || saved.ok !== true) throw new Error('milestone save failed');
      const rendered = renderMilestones(rootPath);
      if (!rendered || rendered.ok !== true) throw new Error('milestone render failed');
      const applied = readMilestonesSnapshot(rootPath);
      if (!applied || applied.ok !== true || !applied.found || !applied.contentDigest) {
        throw new Error('milestone verification failed');
      }
      return {
        ok: true,
        contentDigest: applied.contentDigest,
      };
    } catch {
      try {
        if (hadPreviousFile) {
          fs.writeFileSync(filePath, previousBytes);
        } else if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {}
      return { ok: false, code: MILESTONE_PROPOSAL_REASONS.WRITE_FAILED };
    }
  }

  function updateMilestoneStatus(rootPath, milestoneId, status) {
    const milestones = listMilestones(rootPath);
    const m = milestones.find((x) => x.id === milestoneId);
    if (!m) return { ok: false, message: 'Milestone not found' };

    if (status === 'done' || status === 'committed') {
      return {
        ok: false,
        code: MILESTONE_LIFECYCLE_REASONS.VALIDATION_REQUIRED,
      };
    }
    if (!EDITABLE_MILESTONE_STATUSES.has(status)) {
      return { ok: false, code: MILESTONE_LIFECYCLE_REASONS.INVALID_STATUS };
    }
    if (m.status === 'done') {
      return { ok: false, code: MILESTONE_LIFECYCLE_REASONS.TERMINAL };
    }
    if (status === 'active' && milestones.some(
      (entry) => entry.id !== milestoneId && entry.status === 'active',
    )) {
      return { ok: false, code: MILESTONE_LIFECYCLE_REASONS.ACTIVE_CONFLICT };
    }
    if (m.status === status) return { ok: true, milestone: m, idempotent: true };

    m.status = status;
    m.updatedAt = new Date().toISOString();
    if (status === 'active' && !m.startedAt) {
      m.startedAt = new Date().toISOString();
    }
    saveMilestones(rootPath, milestones);
    return { ok: true, milestone: m };
  }

  function completeMilestoneAfterValidation(rootPath, milestoneId, receipt) {
    const fields = exactDataFields(receipt, COMPLETION_RECEIPT_KEYS);
    if (!fields
      || !SAFE_IDENTIFIER.test(String(fields.get('jobId') || ''))
      || fields.get('status') !== 'passed'
      || !validIsoTimestamp(fields.get('validatedAt'))
      || typeof fields.get('validationDigest') !== 'string'
      || !SAFE_DIGEST.test(fields.get('validationDigest'))) {
      return {
        ok: false,
        code: MILESTONE_LIFECYCLE_REASONS.INVALID_COMPLETION_RECEIPT,
      };
    }

    const milestones = listMilestones(rootPath);
    const m = milestones.find((entry) => entry.id === milestoneId);
    if (!m) return { ok: false, message: 'Milestone not found' };
    if (m.status === 'done') {
      const previous = m.completionEvidence;
      if (previous && COMPLETION_RECEIPT_KEYS.every(
        (key) => previous[key] === receipt[key],
      )) {
        return { ok: true, milestone: m, idempotent: true };
      }
      return { ok: false, code: MILESTONE_LIFECYCLE_REASONS.TERMINAL };
    }
    if (m.status !== 'active') {
      return { ok: false, code: MILESTONE_LIFECYCLE_REASONS.NOT_ACTIVE };
    }
    if (!validIsoTimestamp(m.startedAt)
      || Date.parse(fields.get('validatedAt')) < Date.parse(m.startedAt)) {
      return {
        ok: false,
        code: MILESTONE_LIFECYCLE_REASONS.INVALID_COMPLETION_RECEIPT,
      };
    }

    const completionEvidence = Object.fromEntries(
      COMPLETION_RECEIPT_KEYS.map((key) => [key, fields.get(key)]),
    );
    m.status = 'done';
    m.completedAt = fields.get('validatedAt');
    m.completionEvidence = completionEvidence;
    m.updatedAt = new Date().toISOString();
    saveMilestones(rootPath, milestones);
    return { ok: true, milestone: m };
  }

  function updateMilestoneTask(rootPath, milestoneId, taskId, taskUpdate) {
    const milestones = listMilestones(rootPath);
    const m = milestones.find((x) => x.id === milestoneId);
    if (!m) return { ok: false, message: 'Milestone not found' };
    
    const t = m.tasks.find((x) => x.id === taskId);
    if (!t) return { ok: false, message: 'Task not found' };
    
    Object.assign(t, taskUpdate);
    m.updatedAt = new Date().toISOString();
    saveMilestones(rootPath, milestones);
    return { ok: true, task: t };
  }

  function linkVerifiedCommit(rootPath, milestoneId, commit) {
    const fields = exactDataFields(commit, VERIFIED_COMMIT_KEYS);
    if (!fields
      || typeof fields.get('hash') !== 'string'
      || !SAFE_COMMIT_HASH.test(fields.get('hash'))
      || typeof fields.get('message') !== 'string'
      || !fields.get('message').trim()
      || fields.get('message').length > 4_096
      || !validIsoTimestamp(fields.get('createdAt'))) {
      return { ok: false, code: MILESTONE_LIFECYCLE_REASONS.INVALID_COMMIT };
    }
    const milestones = listMilestones(rootPath);
    const m = milestones.find((x) => x.id === milestoneId);
    if (!m) return { ok: false, message: 'Milestone not found' };

    if (!m.commits) m.commits = [];
    const canonicalCommit = Object.fromEntries(
      VERIFIED_COMMIT_KEYS.map((key) => [key, fields.get(key)]),
    );
    const existing = m.commits.find((entry) => entry && entry.hash === canonicalCommit.hash);
    if (existing) {
      if (VERIFIED_COMMIT_KEYS.every((key) => existing[key] === canonicalCommit[key])) {
        return { ok: true, milestone: m, idempotent: true };
      }
      return { ok: false, code: MILESTONE_LIFECYCLE_REASONS.INVALID_COMMIT };
    }
    m.commits.push(canonicalCommit);
    m.updatedAt = new Date().toISOString();
    saveMilestones(rootPath, milestones);
    return { ok: true, milestone: m };
  }

  function renderMilestones(rootPath) {
    try {
      const rawMilestones = readMilestonesFile(rootPath);
      const milestones = Array.isArray(rawMilestones)
        ? rawMilestones
        : rawMilestones && Array.isArray(rawMilestones.milestones)
          ? rawMilestones.milestones
          : EMPTY_MILESTONES;
      if (!milestones.length) {
        return { ok: false, message: 'No milestones generated yet.' };
      }
      const docsDir = path.join(rootPath, 'docs', 'milestones');
      if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
      }

      // Generate README.md
      let readme = '# Plano de Desenvolvimento - Milestones\n\nTimeline do projeto organizada em etapas estruturadas:\n\n';
      milestones.forEach((m) => {
        const fileBasename = `milestone-${String(m.number).padStart(2, '0')}-${m.title.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.md`;
        let statusEmoji = '⚪';
        if (m.status === 'active') statusEmoji = '🔵';
        if (m.status === 'done') statusEmoji = '🟢';
        if (m.status === 'blocked') statusEmoji = '🔴';
        readme += `### ${statusEmoji} Milestone ${m.number}: [${m.title}](./${fileBasename})\n`;
        readme += `Status: \`${m.status}\`\n\n${m.summary}\n\n`;
      });
      fs.writeFileSync(path.join(docsDir, 'README.md'), readme, 'utf8');

      // Generate separate files
      milestones.forEach((m) => {
        const fileBasename = `milestone-${String(m.number).padStart(2, '0')}-${m.title.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.md`;
        let content = `# Milestone ${m.number} - ${m.title}\n\n`;
        content += `Status: **${m.status}**\n\n`;
        content += `## Objetivo\n\n${m.summary || ''}\n\n`;

        if (Array.isArray(m.references) && m.references.length) {
          content += `## Markdowns de Referência do Mapa\n\n`;
          m.references.forEach((reference) => {
            const referencePath = reference && reference.path ? reference.path : String(reference || '');
            if (referencePath) {
              content += `- \`${referencePath}\`\n`;
            }
          });
          content += `\n`;
        }
        
        content += `## Tarefas\n\n`;
        if (m.tasks && m.tasks.length) {
          m.tasks.forEach((t) => {
            const checked = t.status === 'done' ? '[x]' : '[ ]';
            content += `- ${checked} **${t.title}**\n`;
            if (t.description) content += `  _${t.description}_\n`;
          });
        } else {
          content += `- Não há tarefas cadastradas.\n`;
        }
        content += `\n`;

        content += `## Critérios de Aceite\n\n${m.acceptanceCriteria || ''}\n\n`;
        
        if (m.validationCommands) {
          content += `## Validação\n\n\`\`\`bash\n${m.validationCommands}\n\`\`\`\n\n`;
        }

        content += `## Commits Relacionados\n\n`;
        if (m.commits && m.commits.length) {
          m.commits.forEach((c) => {
            content += `- \`${c.hash.substring(0, 7)}\` - ${c.message} (${c.createdAt})\n`;
          });
        } else {
          content += `Nenhum commit associado a esta milestone ainda.\n`;
        }

        fs.writeFileSync(path.join(docsDir, fileBasename), content, 'utf8');
      });

      // Save raw JSON copy
      fs.writeFileSync(path.join(docsDir, 'milestones.json'), JSON.stringify(milestones, null, 2), 'utf8');
      persistRenderedMilestones(rootPath, milestones);

      return { ok: true, docsPath: docsDir };
    } catch (e) {
      console.error('Failed to render milestones', e);
      return { ok: false, message: e.message || String(e) };
    }
  }

  return {
    applyApprovedProposal,
    completeMilestoneAfterValidation,
    linkVerifiedCommit,
    listMilestones,
    readMilestonesSnapshot,
    saveMilestones,
    updateMilestoneStatus,
    updateMilestoneTask,
    renderMilestones,
  };
}

module.exports = {
  MILESTONE_LIFECYCLE_REASONS,
  MILESTONE_PROPOSAL_REASONS,
  createMilestoneService,
};
