const defaultFs = require('fs');
const defaultPath = require('path');

const {
  sanitizeSuggestedContract,
} = require('./automata_contract_registry_service');

const AUTOMATA_CONTRACT_LEDGER_SCHEMA_VERSION = 'automata-contract-ledger-v1';
const AUTOMATA_CONTRACT_LEDGER_FILE = 'automata_contract_ledger.json';

const LEDGER_STATUSES = Object.freeze({
  SUGGEST_BLUEPRINT: 'suggest_blueprint',
  STAGED: 'staged',
  TRIAL_RUNNING: 'trial_running',
  TRIAL_PASSED: 'trial_passed',
  TRIAL_FAILED: 'trial_failed',
  LOCAL_ACTIVE: 'local_active',
  LOCAL_DISABLED: 'local_disabled',
  REJECTED: 'rejected',
});

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  [LEDGER_STATUSES.SUGGEST_BLUEPRINT]: [
    LEDGER_STATUSES.STAGED,
    LEDGER_STATUSES.REJECTED,
  ],
  [LEDGER_STATUSES.STAGED]: [
    LEDGER_STATUSES.TRIAL_RUNNING,
    LEDGER_STATUSES.TRIAL_PASSED,
    LEDGER_STATUSES.TRIAL_FAILED,
    LEDGER_STATUSES.REJECTED,
  ],
  [LEDGER_STATUSES.TRIAL_RUNNING]: [
    LEDGER_STATUSES.TRIAL_PASSED,
    LEDGER_STATUSES.TRIAL_FAILED,
    LEDGER_STATUSES.REJECTED,
  ],
  [LEDGER_STATUSES.TRIAL_PASSED]: [
    LEDGER_STATUSES.LOCAL_ACTIVE,
    LEDGER_STATUSES.REJECTED,
  ],
  [LEDGER_STATUSES.TRIAL_FAILED]: [
    LEDGER_STATUSES.STAGED,
    LEDGER_STATUSES.REJECTED,
  ],
  [LEDGER_STATUSES.LOCAL_ACTIVE]: [
    LEDGER_STATUSES.LOCAL_DISABLED,
  ],
  [LEDGER_STATUSES.LOCAL_DISABLED]: [
    LEDGER_STATUSES.LOCAL_ACTIVE,
    LEDGER_STATUSES.REJECTED,
  ],
  [LEDGER_STATUSES.REJECTED]: [],
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeProjectIdentity(project = {}) {
  const source = project && typeof project === 'object' ? project : {};
  return {
    projectId: normalizeText(source.projectId || source.id || ''),
    rootPath: normalizeText(source.rootPath || ''),
  };
}

const OPEN_SUGGESTION_STATUSES = new Set([
  LEDGER_STATUSES.SUGGEST_BLUEPRINT,
  LEDGER_STATUSES.STAGED,
  LEDGER_STATUSES.TRIAL_RUNNING,
  LEDGER_STATUSES.TRIAL_PASSED,
  LEDGER_STATUSES.LOCAL_ACTIVE,
]);

function entriesShareProjectIdentity(left = {}, right = {}) {
  const a = normalizeProjectIdentity(left);
  const b = normalizeProjectIdentity(right);
  if (a.projectId && b.projectId && a.projectId === b.projectId) return true;
  if (a.rootPath && b.rootPath && a.rootPath === b.rootPath) return true;
  return !a.projectId && !a.rootPath && !b.projectId && !b.rootPath;
}

function findEquivalentOpenEntryIndex(entries = [], candidate = {}) {
  const contractId = normalizeText(candidate.contractId || '');
  if (!contractId) return -1;
  return entries.findIndex((entry) => {
    if (!entry || entry.contractId !== contractId) return false;
    if (!OPEN_SUGGESTION_STATUSES.has(entry.status)) return false;
    return entriesShareProjectIdentity(entry, candidate);
  });
}

function openEntryDedupKey(entry = {}) {
  if (!entry || !OPEN_SUGGESTION_STATUSES.has(entry.status)) return '';
  const projectIdentity = entry.projectId || entry.rootPath || 'global';
  return `${entry.contractId || ''}::${projectIdentity}`;
}

function collapseEquivalentOpenEntries(entries = []) {
  const seen = new Set();
  const collapsed = [];
  for (const entry of entries) {
    const key = openEntryDedupKey(entry);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    collapsed.push(entry);
  }
  return collapsed;
}

function createLedgerId(nowValue = '') {
  const time = normalizeText(nowValue) || new Date().toISOString();
  const stamp = time.replace(/[^0-9a-zA-Z]+/g, '').slice(0, 18);
  const random = Math.random().toString(36).slice(2, 9);
  return `ledger.${stamp}.${random}`;
}

function createEvent(type, payload = {}, now = () => new Date().toISOString()) {
  return {
    type: normalizeText(type),
    at: now(),
    payload: cloneJson(payload) || {},
  };
}

function createAutomataContractLedgerService(dependencies = {}) {
  const {
    fs = defaultFs,
    path = defaultPath,
    storageRoot = '',
    getUserDataPath = null,
    now = () => new Date().toISOString(),
  } = dependencies;

  function getStorageRoot() {
    if (storageRoot) return storageRoot;
    if (typeof getUserDataPath === 'function') {
      return path.join(getUserDataPath(), 'automata-contracts');
    }
    return '';
  }

  function getLedgerPath() {
    const root = getStorageRoot();
    return root ? path.join(root, AUTOMATA_CONTRACT_LEDGER_FILE) : '';
  }

  function readLedger() {
    const ledgerPath = getLedgerPath();
    if (!ledgerPath || !fs.existsSync(ledgerPath)) {
      return {
        schemaVersion: AUTOMATA_CONTRACT_LEDGER_SCHEMA_VERSION,
        entries: [],
      };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      return {
        schemaVersion: AUTOMATA_CONTRACT_LEDGER_SCHEMA_VERSION,
        entries: Array.isArray(parsed && parsed.entries) ? parsed.entries.filter(Boolean) : [],
      };
    } catch {
      return {
        schemaVersion: AUTOMATA_CONTRACT_LEDGER_SCHEMA_VERSION,
        entries: [],
      };
    }
  }

  function writeLedger(ledger) {
    const ledgerPath = getLedgerPath();
    if (!ledgerPath) return { ok: false, reason: 'missing_storage_root' };
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    const nextLedger = {
      schemaVersion: AUTOMATA_CONTRACT_LEDGER_SCHEMA_VERSION,
      entries: Array.isArray(ledger && ledger.entries) ? ledger.entries : [],
    };
    fs.writeFileSync(ledgerPath, JSON.stringify(nextLedger, null, 2), 'utf8');
    return { ok: true, path: ledgerPath, count: nextLedger.entries.length };
  }

  function normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const status = Object.values(LEDGER_STATUSES).includes(entry.status)
      ? entry.status
      : LEDGER_STATUSES.SUGGEST_BLUEPRINT;
    return {
      schemaVersion: AUTOMATA_CONTRACT_LEDGER_SCHEMA_VERSION,
      id: normalizeText(entry.id) || createLedgerId(now()),
      contractId: normalizeText(entry.contractId || (entry.contract && entry.contract.id) || ''),
      title: normalizeText(entry.title || (entry.contract && (entry.contract.title || entry.contract.name)) || 'Contrato temporario'),
      description: normalizeText(entry.description || ''),
      status,
      projectId: normalizeText(entry.projectId || ''),
      rootPath: normalizeText(entry.rootPath || ''),
      createdAt: normalizeText(entry.createdAt || now()),
      updatedAt: normalizeText(entry.updatedAt || now()),
      contract: entry.contract && typeof entry.contract === 'object' ? cloneJson(entry.contract) : {},
      trial: entry.trial && typeof entry.trial === 'object' ? cloneJson(entry.trial) : {},
      events: Array.isArray(entry.events) ? entry.events.filter(Boolean) : [],
    };
  }

  function listEntries(options = {}) {
    const ledger = readLedger();
    const statuses = Array.isArray(options.status)
      ? options.status.map(String)
      : options.status
        ? [String(options.status)]
        : [];
    const projectId = normalizeText(options.projectId || '');
    const rootPath = normalizeText(options.rootPath || '');
    const includeRejected = options.includeRejected !== false;
    const matchesProject = (entry) => {
      if (!projectId && !rootPath) return true;
      const idMatches = Boolean(projectId && entry.projectId === projectId);
      const rootMatches = Boolean(rootPath && entry.rootPath === rootPath);
      if (projectId && rootPath) return idMatches || rootMatches;
      if (projectId) return idMatches;
      return rootMatches;
    };

    const entries = collapseEquivalentOpenEntries(ledger.entries
      .map(normalizeEntry)
      .filter(Boolean)
      .filter((entry) => includeRejected || entry.status !== LEDGER_STATUSES.REJECTED)
      .filter((entry) => !statuses.length || statuses.includes(entry.status))
      .filter(matchesProject)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));

    return { ok: true, entries };
  }

  function getEntry(id) {
    const target = normalizeText(id);
    if (!target) return { ok: false, reason: 'missing_entry_id' };
    const entry = readLedger().entries.map(normalizeEntry).find((candidate) => candidate && candidate.id === target);
    if (!entry) return { ok: false, reason: 'entry_not_found' };
    return { ok: true, entry };
  }

  function suggestContract(input = {}, options = {}) {
    const createdAt = now();
    const project = normalizeProjectIdentity(options.project || input.project || input.projectInfo || {});
    const contract = sanitizeSuggestedContract(input.contract || input, {
      capability: input.capability,
      observedMessage: input.observedMessage,
      provider: options.provider || input.provider || 'assistant',
      now,
    });
    const entry = normalizeEntry({
      id: createLedgerId(createdAt),
      contractId: contract.id,
      title: contract.title,
      description: contract.reason,
      status: LEDGER_STATUSES.SUGGEST_BLUEPRINT,
      projectId: project.projectId,
      rootPath: project.rootPath,
      createdAt,
      updatedAt: createdAt,
      contract,
      trial: {},
      events: [
        createEvent('contract.suggested', {
          contractId: contract.id,
          title: contract.title,
          capability: contract.capability,
        }, now),
      ],
    });

    const ledger = readLedger();
    const normalizedEntries = ledger.entries.map(normalizeEntry).filter(Boolean);
    const duplicateIndex = findEquivalentOpenEntryIndex(normalizedEntries, entry);
    if (duplicateIndex >= 0) {
      const duplicate = {
        ...normalizedEntries[duplicateIndex],
        updatedAt: createdAt,
        events: [
          createEvent('contract.suggestion_deduped', {
            contractId: entry.contractId,
            title: entry.title,
            reusedEntryId: normalizedEntries[duplicateIndex].id,
          }, now),
          ...(Array.isArray(normalizedEntries[duplicateIndex].events)
            ? normalizedEntries[duplicateIndex].events
            : []),
        ],
      };
      ledger.entries = [
        duplicate,
        ...normalizedEntries.filter((_candidate, index) => index !== duplicateIndex),
      ];
      const saveResult = writeLedger(ledger);
      return {
        ok: saveResult.ok,
        entry: duplicate,
        saveResult,
        deduped: true,
      };
    }

    ledger.entries = [entry, ...normalizedEntries.filter((candidate) => candidate && candidate.id !== entry.id)];
    const saveResult = writeLedger(ledger);
    return {
      ok: saveResult.ok,
      entry,
      saveResult,
    };
  }

  function transitionEntry(id, nextStatus, payload = {}) {
    const target = normalizeText(id);
    const status = normalizeText(nextStatus);
    if (!target) return { ok: false, reason: 'missing_entry_id' };
    if (!Object.values(LEDGER_STATUSES).includes(status)) {
      return { ok: false, reason: 'invalid_status' };
    }

    const ledger = readLedger();
    const index = ledger.entries.findIndex((entry) => entry && entry.id === target);
    if (index < 0) return { ok: false, reason: 'entry_not_found' };

    const current = normalizeEntry(ledger.entries[index]);
    const allowed = ALLOWED_STATUS_TRANSITIONS[current.status] || [];
    if (!allowed.includes(status)) {
      return {
        ok: false,
        reason: 'invalid_status_transition',
        from: current.status,
        to: status,
      };
    }

    const updatedAt = now();
    const eventType = payload.eventType || `contract.${status}`;
    const entry = {
      ...current,
      status,
      updatedAt,
      trial: payload.trial && typeof payload.trial === 'object'
        ? { ...(current.trial || {}), ...cloneJson(payload.trial) }
        : current.trial || {},
      events: [
        createEvent(eventType, {
          from: current.status,
          to: status,
          note: normalizeText(payload.note || ''),
        }, now),
        ...(Array.isArray(current.events) ? current.events : []),
      ],
    };

    ledger.entries[index] = entry;
    const saveResult = writeLedger(ledger);
    return {
      ok: saveResult.ok,
      entry,
      saveResult,
    };
  }

  function stageContract(id, payload = {}) {
    return transitionEntry(id, LEDGER_STATUSES.STAGED, {
      ...payload,
      eventType: 'contract.committed_to_stage',
    });
  }

  function markTrialRunning(id, payload = {}) {
    return transitionEntry(id, LEDGER_STATUSES.TRIAL_RUNNING, {
      ...payload,
      eventType: 'contract.trial_started',
      trial: {
        ...(payload.trial || {}),
        startedAt: now(),
      },
    });
  }

  function markTrialResult(id, payload = {}) {
    const passed = Boolean(payload.passed);
    return transitionEntry(id, passed ? LEDGER_STATUSES.TRIAL_PASSED : LEDGER_STATUSES.TRIAL_FAILED, {
      ...payload,
      eventType: passed ? 'contract.trial_passed' : 'contract.trial_failed',
      trial: {
        ...(payload.trial || {}),
        passed,
        finishedAt: now(),
      },
    });
  }

  function promoteContract(id, payload = {}) {
    return transitionEntry(id, LEDGER_STATUSES.LOCAL_ACTIVE, {
      ...payload,
      eventType: 'contract.promoted_local_active',
    });
  }

  function rejectContract(id, payload = {}) {
    return transitionEntry(id, LEDGER_STATUSES.REJECTED, {
      ...payload,
      eventType: 'contract.rejected',
    });
  }

  function summarizeLedger(options = {}) {
    const entries = listEntries({ ...options, includeRejected: true }).entries;
    const counts = Object.values(LEDGER_STATUSES).reduce((acc, status) => {
      acc[status] = entries.filter((entry) => entry.status === status).length;
      return acc;
    }, {});

    return {
      ok: true,
      schemaVersion: AUTOMATA_CONTRACT_LEDGER_SCHEMA_VERSION,
      name: 'Automata Contract Ledger',
      total: entries.length,
      actionable:
        counts[LEDGER_STATUSES.SUGGEST_BLUEPRINT] +
        counts[LEDGER_STATUSES.STAGED] +
        counts[LEDGER_STATUSES.TRIAL_PASSED],
      counts,
    };
  }

  return {
    getEntry,
    listEntries,
    markTrialResult,
    markTrialRunning,
    promoteContract,
    readLedger,
    rejectContract,
    stageContract,
    suggestContract,
    summarizeLedger,
    transitionEntry,
    writeLedger,
  };
}

module.exports = {
  ALLOWED_STATUS_TRANSITIONS,
  AUTOMATA_CONTRACT_LEDGER_FILE,
  AUTOMATA_CONTRACT_LEDGER_SCHEMA_VERSION,
  LEDGER_STATUSES,
  createAutomataContractLedgerService,
};
