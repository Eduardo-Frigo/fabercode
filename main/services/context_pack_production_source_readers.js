'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  CONTEXT_PACK_CITATION_KINDS,
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
  createContextPackCitation,
  createContextPackSection,
} = require('../agent_runtime/context_pack_contracts');
const {
  createContextPackSourceReader,
} = require('../agent_runtime/context_pack_source_contracts');
const {
  assertProjectRootReadFileResult,
  assertProjectRootReader,
  createProjectRootReadFileRequest,
} = require('../capabilities/project_root_authority_contract');
const {
  isPortableAbsolutePath,
} = require('../capabilities/sandbox_backend_contract');

const CONTEXT_PACK_PRODUCTION_SOURCE_READERS_VERSION =
  'context-pack-production-source-readers.v1';
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SUPPORTED_SURFACES = new Set(Object.values(CONTEXT_PACK_SURFACES));
const SOURCE_CONTEXT_KEYS = Object.freeze([
  'authorityDigest',
  'requestId',
  'projectId',
  'surface',
  'sourceScope',
]);
const SOURCE_SCOPE_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'jobId',
  'conversationId',
  'userId',
  'relativeCwd',
  'relevantFiles',
]);
const SECTION_CITATION_KINDS = Object.freeze({
  [CONTEXT_PACK_SECTION_IDS.MILESTONE]: CONTEXT_PACK_CITATION_KINDS.MILESTONE,
  [CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS]:
    CONTEXT_PACK_CITATION_KINDS.PROJECT_INSTRUCTION,
  [CONTEXT_PACK_SECTION_IDS.MEMORY]: CONTEXT_PACK_CITATION_KINDS.CORTEX_MEMORY,
  [CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP]:
    CONTEXT_PACK_CITATION_KINDS.APPLICATION_MAP,
  [CONTEXT_PACK_SECTION_IDS.GIT]: CONTEXT_PACK_CITATION_KINDS.GIT,
  [CONTEXT_PACK_SECTION_IDS.FILES]: CONTEXT_PACK_CITATION_KINDS.PROJECT_FILE,
  [CONTEXT_PACK_SECTION_IDS.CONVERSATION]: CONTEXT_PACK_CITATION_KINDS.CONVERSATION,
});
const FORBIDDEN_DATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_PATH_SEGMENTS = new Set([
  '.faber',
  '.git',
  '.ssh',
  '.aws',
  '.gnupg',
  'private_context',
  'credentials',
]);
const SENSITIVE_BASENAMES = new Set([
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.yarnrc',
  '.yarnrc.yml',
  '_netrc',
]);
const MAX_RELEVANT_FILES = 32;
const MAX_SUMMARY_CHARS = 12_000;

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      return null;
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function denseDataValues(value, fieldName, maximum) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    throw new TypeError(`${fieldName} must be a bounded plain array`);
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${fieldName} must be dense`);
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain data values`);
    }
    return descriptor.value;
  });
}

function canonicalData(
  value,
  state = { seen: new Set(), nodes: 0, stringBytes: 0 },
  depth = 0
) {
  if (depth > 32) throw new TypeError('Context source exceeds its depth bound');
  state.nodes += 1;
  if (state.nodes > 50_000) throw new TypeError('Context source exceeds its node bound');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new TypeError('Context source contains NUL');
    state.stringBytes += Buffer.byteLength(value, 'utf8');
    if (state.stringBytes > 2 * 1024 * 1024) {
      throw new TypeError('Context source exceeds its string bound');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('Context source contains an invalid number');
    }
    return value;
  }
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) {
    throw new TypeError('Context source contains an unsupported value');
  }
  if (state.seen.has(value)) throw new TypeError('Context source contains a cycle');
  state.seen.add(value);
  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if ((isArray && prototype !== Array.prototype)
      || (!isArray && prototype !== Object.prototype && prototype !== null)) {
      throw new TypeError('Context source must contain plain data');
    }
    const entries = Reflect.ownKeys(value)
      .filter((key) => !(isArray && key === 'length'))
      .map((key) => {
        if (typeof key !== 'string' || FORBIDDEN_DATA_KEYS.has(key)) {
          throw new TypeError('Context source contains a forbidden key');
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('Context source must contain data properties');
        }
        return [key, descriptor.value];
      });
    if (isArray && (entries.length !== value.length
      || entries.some(([key], index) => key !== String(index)))) {
      throw new TypeError('Context source arrays must be dense');
    }
    if (isArray) {
      return Object.freeze(entries.map(([, entry]) => canonicalData(
        entry,
        state,
        depth + 1
      )));
    }
    const output = Object.create(null);
    for (const [key, entry] of entries.sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    ))) {
      output[key] = canonicalData(entry, state, depth + 1);
    }
    return Object.freeze(output);
  } finally {
    state.seen.delete(value);
  }
}

function canonicalDigest(value) {
  return `sha256:${crypto.createHash('sha256')
    .update(JSON.stringify(canonicalData(value)), 'utf8')
    .digest('hex')}`;
}

function captureObjectMethod(target, methodName, fieldName) {
  if (!target || typeof target !== 'object' || util.types.isProxy(target)) {
    throw new TypeError(`${fieldName} must be a trusted object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, methodName);
  if (!descriptor || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) {
    throw new TypeError(`${fieldName}.${methodName} must be an own data method`);
  }
  return Object.freeze({ receiver: target, method: descriptor.value });
}

function captureCallback(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)) {
    throw new TypeError(`${fieldName} must be a trusted function`);
  }
  return Object.freeze({ receiver: undefined, method: value });
}

function observePortResult(value, fieldName) {
  if (!util.types.isPromise(value)) {
    return Promise.resolve(Object.freeze({ value }));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, value, [
        (result) => resolve(Object.freeze({ value: result })),
        () => reject(new TypeError(`${fieldName} failed`)),
      ]);
    } catch {
      reject(new TypeError(`${fieldName} failed`));
    }
  });
}

async function invokePort(captured, args, fieldName) {
  let raw;
  try {
    raw = Reflect.apply(captured.method, captured.receiver, args);
  } catch {
    throw new TypeError(`${fieldName} failed`);
  }
  return observePortResult(raw, fieldName);
}

function assertReaderContext(value) {
  const fields = exactDataFields(value, SOURCE_CONTEXT_KEYS);
  const sourceScope = fields && fields.get('sourceScope');
  const scopeFields = exactDataFields(sourceScope, SOURCE_SCOPE_KEYS);
  const relevantFiles = scopeFields && scopeFields.get('relevantFiles');
  if (!fields || !Object.isFrozen(value) || !scopeFields
    || !Object.isFrozen(sourceScope)
    || !Array.isArray(relevantFiles) || util.types.isProxy(relevantFiles)
    || !Object.isFrozen(relevantFiles) || relevantFiles.length > MAX_RELEVANT_FILES
    || typeof fields.get('authorityDigest') !== 'string'
    || !SHA256_DIGEST.test(fields.get('authorityDigest'))
    || fields.get('projectId') !== scopeFields.get('projectId')
    || !SUPPORTED_SURFACES.has(fields.get('surface'))
    || typeof scopeFields.get('rootPath') !== 'string'
    || !isPortableAbsolutePath(scopeFields.get('rootPath'))) {
    throw new TypeError('Invalid production ContextPack reader context');
  }
  denseDataValues(relevantFiles, 'sourceScope.relevantFiles', MAX_RELEVANT_FILES);
  return value;
}

function compactInline(value, maximum = 1_000) {
  const text = typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
  return text.slice(0, maximum);
}

function compactBlock(value, maximum = MAX_SUMMARY_CHARS) {
  const text = typeof value === 'string'
    ? value.replace(/\r/g, '').trim()
    : '';
  return text.slice(0, maximum);
}

function requiredContentDigest(value, fieldName) {
  if (typeof value !== 'string' || !SHA256_DIGEST.test(value)) {
    throw new TypeError(`${fieldName} must be a canonical digest`);
  }
  return value;
}

function emptySection(sectionId) {
  return createContextPackSection({
    id: sectionId,
    state: CONTEXT_PACK_SECTION_STATES.EMPTY,
    revision: null,
    summary: '',
    citations: Object.freeze([]),
    truncated: false,
  });
}

function unavailableSection(sectionId) {
  return createContextPackSection({
    id: sectionId,
    state: CONTEXT_PACK_SECTION_STATES.UNAVAILABLE,
    revision: null,
    summary: '',
    citations: Object.freeze([]),
    truncated: false,
  });
}

function availableSection(sectionId, summary, citationInputs) {
  const preparedSummary = compactBlock(summary);
  if (!preparedSummary) return emptySection(sectionId);
  const citations = Object.freeze(citationInputs.map((input) => createContextPackCitation({
    kind: SECTION_CITATION_KINDS[sectionId],
    locator: input.locator,
    revision: input.revision,
    digest: input.digest,
  })));
  const revision = canonicalDigest(citations.map((citation) => ({
    locator: citation.locator,
    revision: citation.revision,
    digest: citation.digest,
  })));
  return createContextPackSection({
    id: sectionId,
    state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
    revision,
    summary: preparedSummary,
    citations,
    truncated: false,
  });
}

function locatorPathToken(relativePath) {
  return Buffer.from(relativePath, 'utf8').toString('base64url');
}

function isSensitivePath(relativePath) {
  const normalized = String(relativePath || '').toLowerCase();
  const segments = normalized.split('/');
  const basename = segments[segments.length - 1] || '';
  return segments.some((segment) => SENSITIVE_PATH_SEGMENTS.has(segment))
    || SENSITIVE_BASENAMES.has(basename)
    || basename === '.env'
    || basename.startsWith('.env.')
    || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/.test(basename)
    || /\.(?:key|pem|p12|pfx|jks|keystore)$/.test(basename)
    || /(?:^|[-_.])(?:api[-_]?key|token)(?:[-_.]|$)/.test(basename)
    || /(?:secret|credential|private[-_]?key)/.test(basename);
}

function instructionPaths(relativeCwd) {
  const paths = ['AGENTS.md'];
  if (!relativeCwd) return paths;
  const segments = relativeCwd.split('/');
  for (let index = 1; index <= segments.length; index += 1) {
    paths.push(`${segments.slice(0, index).join('/')}/AGENTS.md`);
  }
  return paths;
}

function decodeTextResult(result) {
  const bytes = Buffer.from(result.contentBase64, 'base64');
  if (bytes.includes(0)) return '';
  return bytes.toString('utf8');
}

function createContextPackProductionSourceReaders(options = {}) {
  const fields = exactDataFields(options, [
    'applicationMapService',
    'milestoneService',
    'gitService',
    'getActiveMemory',
    'getConversation',
    'getProjectRootReader',
  ]);
  if (!fields) throw new TypeError('Invalid production ContextPack reader options');
  const readApplicationMapSnapshot = captureObjectMethod(
    fields.get('applicationMapService'),
    'readApplicationMapSnapshot',
    'applicationMapService'
  );
  const readMilestonesSnapshot = captureObjectMethod(
    fields.get('milestoneService'),
    'readMilestonesSnapshot',
    'milestoneService'
  );
  const getProjectGitWorktree = captureObjectMethod(
    fields.get('gitService'),
    'getProjectGitWorktree',
    'gitService'
  );
  const getActiveMemory = captureCallback(fields.get('getActiveMemory'), 'getActiveMemory');
  const getConversation = captureCallback(fields.get('getConversation'), 'getConversation');
  const getProjectRootReader = captureCallback(
    fields.get('getProjectRootReader'),
    'getProjectRootReader'
  );

  let reads = 0;
  let failures = 0;

  async function resolveProjectRootReader(context) {
    const observed = await invokePort(
      getProjectRootReader,
      [context],
      'getProjectRootReader'
    );
    return assertProjectRootReader(observed.value);
  }

  async function readAuthorizedFile(reader, relativePath, maxBytes) {
    const request = createProjectRootReadFileRequest({ relativePath, maxBytes });
    const readFile = captureObjectMethod(reader, 'readFile', 'projectRootReader');
    const observed = await invokePort(readFile, [request], 'projectRootReader.readFile');
    return assertProjectRootReadFileResult(observed.value, request);
  }

  async function readApplicationMap(contextValue) {
    const context = assertReaderContext(contextValue);
    const observed = await invokePort(
      readApplicationMapSnapshot,
      [context.sourceScope.rootPath],
      'applicationMapService.readApplicationMapSnapshot'
    );
    const snapshot = canonicalData(observed.value);
    if (snapshot.ok !== true) return unavailableSection(CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP);
    if (snapshot.found !== true) return emptySection(CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP);
    const map = snapshot.map;
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      throw new TypeError('Application map snapshot is invalid');
    }
    const nodes = Array.isArray(map.nodes) ? map.nodes : [];
    const edges = Array.isArray(map.edges) ? map.edges : [];
    const highlights = nodes.slice(0, 8)
      .map((node) => compactInline(node && (node.title || node.label || node.id), 100))
      .filter(Boolean);
    const summary = [
      `Mapa da aplicação: ${nodes.length} nós e ${edges.length} conexões.`,
      highlights.length ? `Destaques: ${highlights.join(', ')}.` : '',
    ].filter(Boolean).join(' ');
    const contentDigest = requiredContentDigest(
      snapshot.contentDigest,
      'application map contentDigest'
    );
    return availableSection(CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP, summary, [{
      locator: 'project-map://application-map',
      revision: contentDigest,
      digest: contentDigest,
    }]);
  }

  async function readMilestone(contextValue) {
    const context = assertReaderContext(contextValue);
    const observed = await invokePort(
      readMilestonesSnapshot,
      [context.sourceScope.rootPath],
      'milestoneService.readMilestonesSnapshot'
    );
    const snapshot = canonicalData(observed.value);
    if (snapshot.ok !== true) return unavailableSection(CONTEXT_PACK_SECTION_IDS.MILESTONE);
    if (snapshot.found !== true || snapshot.format !== 'rendered') {
      return emptySection(CONTEXT_PACK_SECTION_IDS.MILESTONE);
    }
    const milestones = Array.isArray(snapshot.milestones) ? snapshot.milestones : [];
    const active = milestones.find((milestone) => milestone && milestone.status === 'active');
    if (!active) return emptySection(CONTEXT_PACK_SECTION_IDS.MILESTONE);
    const pendingTasks = (Array.isArray(active.tasks) ? active.tasks : [])
      .filter((task) => task && task.status !== 'done')
      .slice(0, 8)
      .map((task) => compactInline(task.title || task.description || task.id, 160))
      .filter(Boolean);
    const summary = [
      `Milestone ativa ${compactInline(
        active.number === undefined ? '' : String(active.number),
        32
      )}: ${compactInline(active.title || active.id, 180)}.`,
      compactInline(active.summary, 1_000),
      active.acceptanceCriteria
        ? `Critérios de aceite: ${compactInline(active.acceptanceCriteria, 1_500)}`
        : '',
      pendingTasks.length ? `Pendências: ${pendingTasks.join('; ')}.` : 'Sem tarefas pendentes.',
    ].filter(Boolean).join(' ');
    const contentDigest = requiredContentDigest(
      snapshot.contentDigest,
      'milestone contentDigest'
    );
    return availableSection(CONTEXT_PACK_SECTION_IDS.MILESTONE, summary, [{
      locator: `milestone://active/${locatorPathToken(String(active.id || 'active'))}`,
      revision: contentDigest,
      digest: contentDigest,
    }]);
  }

  async function readGit(contextValue) {
    const context = assertReaderContext(contextValue);
    const observed = await invokePort(
      getProjectGitWorktree,
      [context.sourceScope.rootPath],
      'gitService.getProjectGitWorktree'
    );
    const worktree = canonicalData(observed.value);
    if (worktree.ok !== true) return unavailableSection(CONTEXT_PACK_SECTION_IDS.GIT);
    if (worktree.isGitRepo !== true) return emptySection(CONTEXT_PACK_SECTION_IDS.GIT);
    const entries = Array.isArray(worktree.entries) ? worktree.entries : [];
    const latest = worktree.latest && typeof worktree.latest === 'object'
      ? worktree.latest
      : {};
    const entrySummaries = entries.slice(0, 16).map((entry) => {
      const path = compactInline(entry && entry.path, 240);
      const status = compactInline(entry && entry.status, 40);
      const stats = Number.isSafeInteger(entry && entry.add)
        || Number.isSafeInteger(entry && entry.del)
        ? ` +${Number(entry && entry.add) || 0}/-${Number(entry && entry.del) || 0}`
        : '';
      const detail = compactInline(entry && entry.summary, 220);
      return path ? `${path} (${status || 'modified'}${stats})${detail ? `: ${detail}` : ''}` : '';
    }).filter(Boolean);
    const summary = [
      `Git ${compactInline(worktree.branch, 120) || '(detached)'}; HEAD ${compactInline(latest.hash, 80) || 'sem commit'}.`,
      entries.length ? `Dirty: ${entries.length} arquivo(s).` : 'Worktree limpa.',
      entrySummaries.length ? `Diff: ${entrySummaries.join('; ')}.` : '',
    ].filter(Boolean).join(' ');
    const contentDigest = canonicalDigest({
      branch: worktree.branch || '',
      latest,
      entries,
    });
    return availableSection(CONTEXT_PACK_SECTION_IDS.GIT, summary, [{
      locator: 'git://HEAD',
      revision: contentDigest,
      digest: contentDigest,
    }]);
  }

  async function readMemory(contextValue) {
    const context = assertReaderContext(contextValue);
    const observed = await invokePort(getActiveMemory, [context], 'getActiveMemory');
    if (observed.value === null) return emptySection(CONTEXT_PACK_SECTION_IDS.MEMORY);
    const memory = canonicalData(observed.value);
    if (memory.ok !== true || !memory.validity || memory.validity.expired !== false) {
      return unavailableSection(CONTEXT_PACK_SECTION_IDS.MEMORY);
    }
    const provenance = memory.provenance;
    const citations = Array.isArray(memory.citations) ? memory.citations : [];
    if (!provenance || typeof provenance !== 'object'
      || !compactInline(provenance.schemaVersion, 128) || citations.length < 1) {
      return unavailableSection(CONTEXT_PACK_SECTION_IDS.MEMORY);
    }
    const decision = memory.decision && typeof memory.decision === 'object'
      ? memory.decision
      : {};
    const summary = compactBlock(
      decision.briefingContextText
      || decision.editContextText
      || decision.routeContextText
      || (memory.project && memory.project.contextText)
      || (memory.user && memory.user.contextText)
      || '',
      8_000
    );
    if (!summary) return emptySection(CONTEXT_PACK_SECTION_IDS.MEMORY);
    const contentDigest = canonicalDigest({
      validity: memory.validity,
      citations,
      provenance,
      summary,
    });
    return availableSection(CONTEXT_PACK_SECTION_IDS.MEMORY, summary, [{
      locator: `cortex://active-memory/${context.projectId}`,
      revision: contentDigest,
      digest: contentDigest,
    }]);
  }

  async function readConversation(contextValue) {
    const context = assertReaderContext(contextValue);
    if (context.sourceScope.conversationId === null) {
      return emptySection(CONTEXT_PACK_SECTION_IDS.CONVERSATION);
    }
    const observed = await invokePort(getConversation, [context], 'getConversation');
    if (observed.value === null) return emptySection(CONTEXT_PACK_SECTION_IDS.CONVERSATION);
    const conversation = canonicalData(observed.value);
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    const lines = messages.slice(-8).map((message) => {
      if (!message || typeof message !== 'object') return '';
      const role = message.role === 'assistant' ? 'assistant' : 'user';
      const text = compactInline(message.text || message.content || message.message, 500);
      return text ? `${role}: ${text}` : '';
    }).filter(Boolean);
    if (!lines.length) return emptySection(CONTEXT_PACK_SECTION_IDS.CONVERSATION);
    const contentDigest = canonicalDigest({ messages, revision: conversation.revision || null });
    return availableSection(
      CONTEXT_PACK_SECTION_IDS.CONVERSATION,
      lines.join('\n'),
      [{
        locator: `conversation://${context.sourceScope.conversationId}/summary`,
        revision: contentDigest,
        digest: contentDigest,
      }]
    );
  }

  async function readInstructions(contextValue) {
    const context = assertReaderContext(contextValue);
    const reader = await resolveProjectRootReader(context);
    const paths = instructionPaths(context.sourceScope.relativeCwd);
    const results = await Promise.all(paths.map(async (relativePath) => ({
      relativePath,
      result: await readAuthorizedFile(reader, relativePath, 32_768),
    })));
    const found = results.filter((entry) => entry.result.found === true);
    if (!found.length) return emptySection(CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS);
    const summaryParts = [];
    const citations = [];
    for (const entry of found) {
      const text = compactBlock(decodeTextResult(entry.result), 6_000);
      if (!text) continue;
      summaryParts.push(`[${entry.relativePath}]\n${text}`);
      citations.push({
        locator: `project-instruction://path/${locatorPathToken(entry.relativePath)}`,
        revision: entry.result.contentDigest,
        digest: entry.result.contentDigest,
      });
    }
    return citations.length
      ? availableSection(
        CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS,
        summaryParts.join('\n\n'),
        citations
      )
      : emptySection(CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS);
  }

  async function readFiles(contextValue) {
    const context = assertReaderContext(contextValue);
    const relevantFiles = denseDataValues(
      context.sourceScope.relevantFiles,
      'sourceScope.relevantFiles',
      MAX_RELEVANT_FILES
    ).filter((relativePath) => !isSensitivePath(relativePath));
    if (!relevantFiles.length) return emptySection(CONTEXT_PACK_SECTION_IDS.FILES);
    const reader = await resolveProjectRootReader(context);
    const results = await Promise.all(relevantFiles.map(async (relativePath) => ({
      relativePath,
      result: await readAuthorizedFile(reader, relativePath, 8_192),
    })));
    const found = results.filter((entry) => entry.result.found === true);
    if (!found.length) return emptySection(CONTEXT_PACK_SECTION_IDS.FILES);
    const summaryParts = [];
    const citations = [];
    for (const entry of found) {
      const excerpt = compactBlock(decodeTextResult(entry.result), 700);
      summaryParts.push(
        excerpt
          ? `${entry.relativePath} (${entry.result.contentDigest}):\n${excerpt}`
          : `${entry.relativePath} (${entry.result.contentDigest}; conteúdo binário omitido)`
      );
      citations.push({
        locator: `project-file://path/${locatorPathToken(entry.relativePath)}`,
        revision: entry.result.contentDigest,
        digest: entry.result.contentDigest,
      });
    }
    return availableSection(
      CONTEXT_PACK_SECTION_IDS.FILES,
      summaryParts.join('\n\n'),
      citations
    );
  }

  function trackedReader(sectionId, implementation) {
    return createContextPackSourceReader({
      sectionId,
      read(context) {
        reads += 1;
        let pending;
        try {
          pending = implementation(context);
        } catch {
          failures += 1;
          return Promise.reject(new TypeError(`ContextPack ${sectionId} reader failed`));
        }
        if (!util.types.isPromise(pending)) {
          failures += 1;
          return Promise.reject(new TypeError(`ContextPack ${sectionId} reader must be async`));
        }
        return new Promise((resolve, reject) => {
          try {
            Reflect.apply(Promise.prototype.then, pending, [
              resolve,
              () => {
                failures += 1;
                reject(new TypeError(`ContextPack ${sectionId} reader failed`));
              },
            ]);
          } catch {
            failures += 1;
            reject(new TypeError(`ContextPack ${sectionId} reader failed`));
          }
        });
      },
    });
  }

  const readers = Object.freeze([
    trackedReader(CONTEXT_PACK_SECTION_IDS.MILESTONE, readMilestone),
    trackedReader(CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS, readInstructions),
    trackedReader(CONTEXT_PACK_SECTION_IDS.MEMORY, readMemory),
    trackedReader(CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP, readApplicationMap),
    trackedReader(CONTEXT_PACK_SECTION_IDS.GIT, readGit),
    trackedReader(CONTEXT_PACK_SECTION_IDS.FILES, readFiles),
    trackedReader(CONTEXT_PACK_SECTION_IDS.CONVERSATION, readConversation),
  ]);

  function diagnostics() {
    return Object.freeze({
      version: CONTEXT_PACK_PRODUCTION_SOURCE_READERS_VERSION,
      reads,
      failures,
    });
  }

  return Object.freeze({
    version: CONTEXT_PACK_PRODUCTION_SOURCE_READERS_VERSION,
    readers,
    diagnostics,
  });
}

module.exports = {
  CONTEXT_PACK_PRODUCTION_SOURCE_READERS_VERSION,
  createContextPackProductionSourceReaders,
};
