const defaultFs = require('fs');
const defaultPath = require('path');

const AUTOMATA_CONTRACT_REGISTRY_SCHEMA_VERSION = 'automata-contract-registry-v1';
const AUTOMATA_CONTRACT_SUGGESTION_SCHEMA_VERSION = 'automata-contract-suggestion-v1';
const AUTOMATA_CONTRACT_SUGGESTIONS_FILE = 'automata_contract_suggestions.json';

const CORE_GROUP = 'core_contract';
const SUGGEST_BLUEPRINT_GROUP = 'suggest_blueprint';

const FORBIDDEN_SUGGESTION_FIELDS = [
  'code',
  'commands',
  'exec',
  'implementation',
  'resolver',
  'resolverPath',
  'script',
  'shell',
  'writeFiles',
];

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function uniqueList(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildCoreAutomataContracts() {
  const approvedAt = '2026-05-20';
  const base = [
    ['literal_color_replacement', 'Literal Color Replacement Contract', 'active', 'edit_project'],
    ['semantic_color_edit', 'Semantic Color Edit Contract', 'planned', 'edit_project'],
    ['theme_token', 'Theme Token Contract', 'planned', 'edit_project'],
    ['button_cta', 'Button/CTA Contract', 'planned', 'edit_project'],
    ['text_replace', 'Text Replace Contract', 'planned', 'edit_project'],
    ['hero_copy', 'Hero Copy Contract', 'planned', 'edit_project'],
    ['navigation_sync', 'Navigation Sync Contract', 'planned', 'edit_project'],
    ['section_insert', 'Section Insert Contract', 'planned', 'edit_project'],
    ['section_remove', 'Section Remove Contract', 'planned', 'edit_project'],
    ['footer', 'Footer Contract', 'planned', 'edit_project'],
    ['media_intent', 'Media Intent Contract', 'planned', 'create_or_edit_project'],
    ['icon_intent', 'Icon Intent Contract', 'planned', 'create_or_edit_project'],
    ['typography', 'Typography Contract', 'planned', 'edit_project'],
    ['external_link', 'External Link Contract', 'planned', 'edit_project'],
    ['contact_action', 'Contact Action Contract', 'planned', 'edit_project'],
    ['placeholder_content', 'Placeholder Content Contract', 'planned', 'create_project'],
    ['existing_project_safety', 'Existing Project Safety Contract', 'planned', 'edit_project'],
    ['exploratory_conversation', 'Exploratory Conversation Contract', 'active', 'conversation'],
    ['install_runtime', 'Install/Runtime Contract', 'planned', 'tool_action'],
    ['dependency', 'Dependency Contract', 'planned', 'create_or_edit_project'],
    ['preview_recovery', 'Preview Recovery Contract', 'planned', 'diagnose_project'],
    ['build_error_repair', 'Build Error Repair Contract', 'planned', 'diagnose_project'],
    ['file_tree_refresh', 'File Tree Refresh Contract', 'planned', 'tool_action'],
    ['confirmation', 'Confirmation Contract', 'planned', 'conversation'],
    ['validation_explanation', 'Validation Explanation Contract', 'planned', 'diagnose_project'],
  ];

  return base.map(([slug, name, status, capability], index) => ({
    schemaVersion: AUTOMATA_CONTRACT_REGISTRY_SCHEMA_VERSION,
    id: `automata.${slug}`,
    number: index + 1,
    name,
    group: CORE_GROUP,
    status,
    approval: 'approved',
    approvedAt,
    capability,
    userScoped: false,
    runtime: {
      executable: status === 'active',
      promotionRequired: status !== 'active',
      resolverKind: status === 'active' ? 'local_deterministic' : 'planned_contract',
    },
    safety: {
      dataOnly: false,
      requiresTests: true,
      requiresUserConfirmation: capability !== 'conversation',
      canBeCreatedByAi: false,
    },
  }));
}

function sanitizeSuggestedContract(input = {}, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const title = String(source.title || source.name || source.intent || 'Contrato sugerido').trim();
  const reason = String(source.reason || source.description || '').trim();
  const triggerExamples = Array.isArray(source.triggerExamples)
    ? source.triggerExamples.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const observedMessage = String(source.observedMessage || source.userMessage || options.observedMessage || '').trim();
  const rawId = String(source.id || '').trim();
  const slugSource = rawId.startsWith('suggested.')
    ? normalizeText(rawId.replace(/^suggested\./, ''))
    : normalizeText(rawId || title || observedMessage || 'suggested_contract');
  const id = `suggested.${slugSource || 'contract'}`;
  const blockedFields = FORBIDDEN_SUGGESTION_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(source, field));
  const capability = String(source.capability || options.capability || 'unknown').trim() || 'unknown';

  return {
    schemaVersion: AUTOMATA_CONTRACT_SUGGESTION_SCHEMA_VERSION,
    id,
    title,
    group: SUGGEST_BLUEPRINT_GROUP,
    status: 'suggested_blueprint',
    approval: 'pending_review',
    capability,
    userScoped: true,
    reason,
    observedMessage,
    triggerExamples,
    proposedContract: source.proposedContract && typeof source.proposedContract === 'object'
      ? JSON.parse(JSON.stringify(source.proposedContract))
      : {},
    blockedFields,
    safety: {
      dataOnly: true,
      executable: false,
      requiresPromotion: true,
      requiresTests: true,
      canWriteFiles: false,
      canRunCommands: false,
    },
    source: {
      provider: String(options.provider || source.provider || 'local').trim(),
      createdAt: typeof options.now === 'function' ? options.now() : new Date().toISOString(),
    },
  };
}

function mergeContracts(coreContracts = [], suggestedContracts = []) {
  const byId = new Map();
  for (const contract of [...coreContracts, ...suggestedContracts]) {
    if (!contract || !contract.id) continue;
    byId.set(contract.id, contract);
  }
  return Array.from(byId.values());
}

function createAutomataContractRegistryService(dependencies = {}) {
  const {
    fs = defaultFs,
    path = defaultPath,
    storageRoot = '',
    now = () => new Date().toISOString(),
  } = dependencies;

  function getSuggestionsPath() {
    if (!storageRoot) return '';
    return path.join(storageRoot, AUTOMATA_CONTRACT_SUGGESTIONS_FILE);
  }

  function getCoreContracts() {
    return buildCoreAutomataContracts();
  }

  function loadSuggestedContracts() {
    const suggestionsPath = getSuggestionsPath();
    if (!suggestionsPath || !fs.existsSync(suggestionsPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(suggestionsPath, 'utf8'));
      const entries = Array.isArray(parsed && parsed.contracts) ? parsed.contracts : [];
      return entries
        .filter((entry) => entry && entry.group === SUGGEST_BLUEPRINT_GROUP)
        .map((entry) => ({
          ...entry,
          safety: {
            ...(entry.safety || {}),
            dataOnly: true,
            executable: false,
            requiresPromotion: true,
            canWriteFiles: false,
            canRunCommands: false,
          },
        }));
    } catch {
      return [];
    }
  }

  function saveSuggestedContracts(contracts = []) {
    const suggestionsPath = getSuggestionsPath();
    if (!suggestionsPath) return { ok: false, reason: 'missing_storage_root' };
    fs.mkdirSync(path.dirname(suggestionsPath), { recursive: true });
    const sanitized = contracts
      .filter((entry) => entry && entry.group === SUGGEST_BLUEPRINT_GROUP)
      .map((entry) => sanitizeSuggestedContract(entry, { now }));
    const unique = mergeContracts([], sanitized);
    fs.writeFileSync(
      suggestionsPath,
      JSON.stringify(
        {
          schemaVersion: AUTOMATA_CONTRACT_REGISTRY_SCHEMA_VERSION,
          group: SUGGEST_BLUEPRINT_GROUP,
          contracts: unique,
        },
        null,
        2
      ),
      'utf8'
    );
    return { ok: true, path: suggestionsPath, count: unique.length };
  }

  function listContracts(options = {}) {
    const core = getCoreContracts();
    const suggested = options.includeSuggested === false ? [] : loadSuggestedContracts();
    return mergeContracts(core, suggested);
  }

  function getContractById(id, options = {}) {
    const target = String(id || '').trim();
    if (!target) return null;
    return listContracts(options).find((contract) => contract.id === target) || null;
  }

  function suggestContract(input = {}, options = {}) {
    const suggestion = sanitizeSuggestedContract(input, { ...options, now });
    const current = loadSuggestedContracts();
    const withoutDuplicate = current.filter((entry) => entry.id !== suggestion.id);
    const saveResult = saveSuggestedContracts([...withoutDuplicate, suggestion]);
    return {
      ok: saveResult.ok,
      contract: suggestion,
      saveResult,
    };
  }

  function summarizeRegistry(options = {}) {
    const contracts = listContracts(options);
    const core = contracts.filter((contract) => contract.group === CORE_GROUP);
    const suggested = contracts.filter((contract) => contract.group === SUGGEST_BLUEPRINT_GROUP);
    return {
      schemaVersion: AUTOMATA_CONTRACT_REGISTRY_SCHEMA_VERSION,
      name: 'Automata Contracts',
      total: contracts.length,
      core: core.length,
      active: core.filter((contract) => contract.status === 'active').length,
      planned: core.filter((contract) => contract.status === 'planned').length,
      suggested: suggested.length,
      capabilities: uniqueList(contracts.map((contract) => contract.capability)),
    };
  }

  return {
    getContractById,
    getCoreContracts,
    listContracts,
    loadSuggestedContracts,
    saveSuggestedContracts,
    suggestContract,
    summarizeRegistry,
  };
}

module.exports = {
  AUTOMATA_CONTRACT_REGISTRY_SCHEMA_VERSION,
  AUTOMATA_CONTRACT_SUGGESTIONS_FILE,
  AUTOMATA_CONTRACT_SUGGESTION_SCHEMA_VERSION,
  CORE_GROUP,
  SUGGEST_BLUEPRINT_GROUP,
  buildCoreAutomataContracts,
  createAutomataContractRegistryService,
  sanitizeSuggestedContract,
};
