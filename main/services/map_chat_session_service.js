'use strict';

const util = require('util');

const {
  APPLICATION_MAP_PATCH_SCHEMA_VERSION,
  normalizeApplicationMapProposalOperations,
} = require('./map_chat_proposal_service');

const MAP_CHAT_SESSION_SERVICE_VERSION = 'map-chat-session-service.v1';
const MAP_CHAT_READ_ONLY_PROFILE_VERSION = 'map-chat-read-only-profile.v1';
const MAX_HISTORY_MESSAGES = 100;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_CONTEXT_TEXT_CHARS = 16_384;
const MAX_ASSET_REFERENCES = 64;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SUPPORTED_LOCALES = new Set(['pt-BR', 'en-US', 'es-ES']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const MAP_CHAT_SESSION_REASONS = Object.freeze({
  CONTEXT_UNAVAILABLE: 'MAP_CHAT_CONTEXT_UNAVAILABLE',
  CONVERSATION_FORBIDDEN: 'MAP_CHAT_CONVERSATION_FORBIDDEN',
  CONVERSATION_NOT_FOUND: 'MAP_CHAT_CONVERSATION_NOT_FOUND',
  HISTORY_UNAVAILABLE: 'MAP_CHAT_HISTORY_UNAVAILABLE',
  INVALID_INPUT: 'MAP_CHAT_INVALID_INPUT',
  MUTATING_RESPONSE_FORBIDDEN: 'MAP_CHAT_MUTATING_RESPONSE_FORBIDDEN',
  PERSISTENCE_FAILED: 'MAP_CHAT_PERSISTENCE_FAILED',
  PROJECT_NOT_AUTHORIZED: 'MAP_CHAT_PROJECT_NOT_AUTHORIZED',
  RUNTIME_FAILED: 'MAP_CHAT_RUNTIME_FAILED',
});

const OPTION_KEYS = Object.freeze([
  'applicationMapService',
  'assistantRuntime',
  'authorizeProjectBinding',
  'conversationStore',
  'milestoneService',
]);

const INPUT_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'conversationId',
  'userMessage',
  'locale',
]);
const RENDER_MESSAGE_INPUT_KEYS = Object.freeze([
  ...INPUT_KEYS,
  'attachments',
]);
const ANALYZE_INPUT_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'conversationId',
  'locale',
]);

const ANALYSIS_REQUEST_BY_LOCALE = Object.freeze({
  'pt-BR': [
    'Analise o estado atual do Mapa da Aplicação e sua documentação disponível.',
    'Resuma o produto planejado, prove que compreendeu os principais grupos, fluxos e referências visuais,',
    'e indique objetivamente quais informações ainda faltam para concluir a modelagem.',
  ].join(' '),
  'en-US': [
    'Analyze the current Application Map and its available documentation.',
    'Summarize the planned product, demonstrate understanding of its main groups, flows, and visual references,',
    'and state objectively which information is still missing to complete the model.',
  ].join(' '),
  'es-ES': [
    'Analiza el estado actual del Mapa de la Aplicación y su documentación disponible.',
    'Resume el producto planificado, demuestra que comprendiste sus grupos, flujos y referencias visuales,',
    'e indica objetivamente qué información falta para completar el modelado.',
  ].join(' '),
});

const SYSTEM_GUIDANCE_BY_LOCALE = Object.freeze({
  'pt-BR': [
    'Você é o Assistente de Modelagem do Mapa da Aplicação no Faber Code.',
    'Este perfil é obrigatoriamente read-only.',
    'NUNCA execute comandos, scripts ou ferramentas mutadoras.',
    'NUNCA crie, edite ou exclua arquivos, código, nós, edges, assets, milestones ou estado Git.',
    'Ajude a compreender, documentar e completar a modelagem do produto.',
    'Quando sugerir uma mudança, descreva somente uma proposta estruturada para preview e aprovação explícita.',
    'Para uma mudança concreta, acrescente ao final exatamente um bloco ```faber-map-proposal com JSON no schema application-map-patch.v1 e operações da whitelist.',
    'Nunca afirme que a proposta foi aplicada; fora desse bloco, explique apenas a prévia para a pessoa aprovar ou rejeitar.',
    'Use a milestone ativa e seus critérios de aceite como definição de pronto, sem atualizar status.',
    'Responda integralmente em português do Brasil.',
  ].join(' '),
  'en-US': [
    'You are the Application Map Modeling Assistant in Faber Code.',
    'This profile is strictly read-only.',
    'NEVER run commands, scripts, or mutating tools.',
    'NEVER create, edit, or delete files, code, nodes, edges, assets, milestones, or Git state.',
    'Help the user understand, document, and complete the product model.',
    'When suggesting a change, provide only a structured proposal for preview and explicit approval.',
    'For a concrete change, append exactly one ```faber-map-proposal block containing JSON with schema application-map-patch.v1 and whitelisted operations.',
    'Never claim the proposal was applied; outside that block, only explain the preview for the person to approve or reject.',
    'Use the active milestone and its acceptance criteria as the definition of done without changing status.',
    'Respond entirely in English.',
  ].join(' '),
  'es-ES': [
    'Eres el Asistente de Modelado del Mapa de la Aplicación en Faber Code.',
    'Este perfil es obligatoriamente de solo lectura.',
    'NUNCA ejecutes comandos, scripts ni herramientas mutadoras.',
    'NUNCA crees, edites ni elimines archivos, código, nodos, edges, assets, milestones o estado Git.',
    'Ayuda a comprender, documentar y completar el modelado del producto.',
    'Cuando sugieras un cambio, entrega solo una propuesta estructurada para preview y aprobación explícita.',
    'Para un cambio concreto, añade al final exactamente un bloque ```faber-map-proposal con JSON del schema application-map-patch.v1 y operaciones permitidas.',
    'Nunca afirmes que la propuesta fue aplicada; fuera del bloque, explica solo la vista previa para aprobar o rechazar.',
    'Usa la milestone activa y sus criterios de aceptación como definición de terminado sin cambiar su estado.',
    'Responde íntegramente en español.',
  ].join(' '),
});
const RENDER_SYSTEM_GUIDANCE_BY_LOCALE = Object.freeze({
  'pt-BR': [
    'Você é o Assistente de Renderização do Mapa da Aplicação no Faber Code.',
    'Este perfil é obrigatoriamente read-only.',
    'Analise o mapa, os markdowns e a milestone ativa para propor um plano de desenvolvimento estruturado.',
    'Você pode propor milestones, tarefas, critérios de aceite e patches para preview.',
    'NUNCA persista propostas, altere status, associe commits, execute comandos ou modifique arquivos, código, mapa, milestones ou Git.',
    'Toda proposta depende de preview e aprovação explícita no serviço de domínio correspondente.',
    'Responda integralmente em português do Brasil.',
  ].join(' '),
  'en-US': [
    'You are the Application Map Rendering Assistant in Faber Code.',
    'This profile is strictly read-only.',
    'Analyze the map, markdown documents, and active milestone to propose a structured development plan.',
    'You may propose milestones, tasks, acceptance criteria, and patches for preview.',
    'NEVER persist proposals, change status, link commits, run commands, or modify files, code, map, milestones, or Git.',
    'Every proposal requires preview and explicit approval through its domain service.',
    'Respond entirely in English.',
  ].join(' '),
  'es-ES': [
    'Eres el Asistente de Renderización del Mapa de la Aplicación en Faber Code.',
    'Este perfil es obligatoriamente de solo lectura.',
    'Analiza el mapa, los documentos markdown y la milestone activa para proponer un plan de desarrollo estructurado.',
    'Puedes proponer milestones, tareas, criterios de aceptación y patches para preview.',
    'NUNCA persistas propuestas, cambies estados, asocies commits, ejecutes comandos ni modifiques archivos, código, mapa, milestones o Git.',
    'Toda propuesta requiere preview y aprobación explícita mediante su servicio de dominio.',
    'Responde íntegramente en español.',
  ].join(' '),
});

function getMapChatReadOnlySystemGuidance(locale) {
  return SYSTEM_GUIDANCE_BY_LOCALE[locale] || SYSTEM_GUIDANCE_BY_LOCALE['pt-BR'];
}

function getMapRenderReadOnlySystemGuidance(locale) {
  return RENDER_SYSTEM_GUIDANCE_BY_LOCALE[locale]
    || RENDER_SYSTEM_GUIDANCE_BY_LOCALE['pt-BR'];
}

function deny(code) {
  return Object.freeze({ ok: false, code });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || util.types.isProxy(value)) {
    return false;
  }
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, fieldName) {
  if (!isPlainRecord(value)) throw new TypeError(`${fieldName} must be a plain data record`);
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  const fields = new Map();
  for (const key of keys) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) {
      throw new TypeError(`${fieldName} contains a forbidden key`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      throw new TypeError(`${fieldName} must contain enumerable data properties only`);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function exactDataFields(value, keys, fieldName) {
  const fields = dataFields(value, fieldName);
  if (fields.size !== keys.length || keys.some((key) => !fields.has(key))) {
    throw new TypeError(`${fieldName} contains unsupported or missing fields`);
  }
  return fields;
}

function denseArray(value, fieldName, maximum) {
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
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain data properties only`);
    }
    return descriptor.value;
  });
}

function freezeJsonSnapshot(
  value,
  state = { depth: 0, nodes: 0, stringChars: 0, seen: new Set() },
) {
  state.nodes += 1;
  if (state.nodes > 20_000 || state.depth > 24) {
    throw new TypeError('Map Chat data exceeds its structural bound');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new TypeError('Map Chat data contains NUL');
    state.stringChars += value.length;
    if (state.stringChars > 1_000_000) throw new TypeError('Map Chat data exceeds its text bound');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('Map Chat data contains an invalid number');
    }
    return value;
  }
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) {
    throw new TypeError('Map Chat data must be JSON-safe');
  }
  if (state.seen.has(value)) throw new TypeError('Map Chat data must not contain cycles');
  state.seen.add(value);
  state.depth += 1;
  try {
    if (Array.isArray(value)) {
      return Object.freeze(denseArray(value, 'Map Chat array', 10_000)
        .map((entry) => freezeJsonSnapshot(entry, state)));
    }
    const output = {};
    for (const [key, entry] of dataFields(value, 'Map Chat object')) {
      output[key] = freezeJsonSnapshot(entry, state);
    }
    return Object.freeze(output);
  } finally {
    state.depth -= 1;
    state.seen.delete(value);
  }
}

function captureCallback(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value) || util.types.isAsyncFunction(value)) {
    throw new TypeError(`${fieldName} must be a synchronous inspectable function`);
  }
  return value;
}

function captureOwnMethod(receiver, methodName, fieldName, { synchronous = false } = {}) {
  if (!receiver || typeof receiver !== 'object' || util.types.isProxy(receiver)) {
    throw new TypeError(`${fieldName} must be a trusted object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(receiver, methodName);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function' || util.types.isProxy(descriptor.value)
    || util.types.isGeneratorFunction(descriptor.value)
    || (synchronous && util.types.isAsyncFunction(descriptor.value))) {
    throw new TypeError(`${fieldName}.${methodName} must be an own data method`);
  }
  return Object.freeze({ receiver, method: descriptor.value });
}

function callSynchronous(callback, receiver, args, fieldName) {
  let output;
  try {
    output = Reflect.apply(callback, receiver, args);
  } catch {
    throw new TypeError(`${fieldName} failed`);
  }
  if (output && typeof output.then === 'function') {
    if (util.types.isPromise(output)) {
      try { Reflect.apply(Promise.prototype.then, output, [() => {}, () => {}]); } catch {}
    }
    throw new TypeError(`${fieldName} must remain synchronous`);
  }
  return output;
}

function safeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${fieldName} must be a safe identifier`);
  }
  return value;
}

function projectAbsolutePath(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.includes('\0')
    || value.length > 32_768 || value === '/' || /^[A-Za-z]:[\\/]?$/.test(value)) {
    throw new TypeError('rootPath must be a project absolute path');
  }
  const portable = value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
  if (!portable) throw new TypeError('rootPath must be a project absolute path');
  return value;
}

function boundedText(value, fieldName, maximum = MAX_CONTEXT_TEXT_CHARS, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > maximum) {
    throw new TypeError(`${fieldName} must be bounded text`);
  }
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new TypeError(`${fieldName} must not be empty`);
  return normalized;
}

function normalizeInput(value) {
  try {
    const fields = exactDataFields(value, INPUT_KEYS, 'Map Chat send input');
    const locale = fields.get('locale');
    if (!SUPPORTED_LOCALES.has(locale)) throw new TypeError('locale is unsupported');
    return Object.freeze({
      projectId: safeIdentifier(fields.get('projectId'), 'projectId'),
      rootPath: projectAbsolutePath(fields.get('rootPath')),
      conversationId: safeIdentifier(fields.get('conversationId'), 'conversationId'),
      userMessage: boundedText(fields.get('userMessage'), 'userMessage', MAX_MESSAGE_CHARS),
      locale,
    });
  } catch {
    return null;
  }
}

function normalizeAnalyzeInput(value) {
  try {
    const fields = exactDataFields(value, ANALYZE_INPUT_KEYS, 'Map Chat analyze input');
    const locale = fields.get('locale');
    if (!SUPPORTED_LOCALES.has(locale)) throw new TypeError('locale is unsupported');
    return Object.freeze({
      projectId: safeIdentifier(fields.get('projectId'), 'projectId'),
      rootPath: projectAbsolutePath(fields.get('rootPath')),
      conversationId: safeIdentifier(fields.get('conversationId'), 'conversationId'),
      userMessage: ANALYSIS_REQUEST_BY_LOCALE[locale],
      locale,
    });
  } catch {
    return null;
  }
}

function normalizeAttachments(value) {
  return Object.freeze(denseArray(value, 'Map Render attachments', 8).map((entry) => {
    const fields = exactDataFields(entry, ['path', 'type', 'name'], 'Map Render attachment');
    return Object.freeze({
      path: projectAbsolutePath(fields.get('path')),
      type: boundedText(fields.get('type'), 'Map Render attachment type', 512, { allowEmpty: true }),
      name: boundedText(fields.get('name'), 'Map Render attachment name', 1_024),
    });
  }));
}

function normalizeRenderMessageInput(value) {
  try {
    const fields = exactDataFields(value, RENDER_MESSAGE_INPUT_KEYS, 'Map Render message input');
    const locale = fields.get('locale');
    if (!SUPPORTED_LOCALES.has(locale)) throw new TypeError('locale is unsupported');
    return Object.freeze({
      projectId: safeIdentifier(fields.get('projectId'), 'projectId'),
      rootPath: projectAbsolutePath(fields.get('rootPath')),
      conversationId: safeIdentifier(fields.get('conversationId'), 'conversationId'),
      userMessage: boundedText(fields.get('userMessage'), 'userMessage', MAX_MESSAGE_CHARS),
      locale,
      attachments: normalizeAttachments(fields.get('attachments')),
    });
  } catch {
    return null;
  }
}

function authorizeInput(input, authorizeProjectBinding) {
  try {
    const raw = callSynchronous(
      authorizeProjectBinding,
      undefined,
      [input.projectId, input.rootPath],
      'authorizeProjectBinding',
    );
    const fields = dataFields(raw, 'project authorization');
    if (fields.get('ok') !== true || fields.get('authorized') !== true
      || fields.get('projectId') !== input.projectId
      || fields.get('canonicalRootPath') !== input.rootPath
      || fields.get('rootPath') !== input.rootPath) return null;
    return Object.freeze({
      projectId: input.projectId,
      rootPath: input.rootPath,
    });
  } catch {
    return null;
  }
}

function findConversation(rawState, projectId, conversationId, expectedSource) {
  try {
    const stateFields = dataFields(rawState, 'orchestration state');
    const byProjectFields = dataFields(
      stateFields.get('conversationsByProject'),
      'conversationsByProject',
    );
    const bucket = byProjectFields.has(projectId) ? byProjectFields.get(projectId) : [];
    const matches = denseArray(bucket, 'project conversations', 120).filter((entry) => {
      const fields = dataFields(entry, 'conversation');
      return fields.get('id') === conversationId;
    });
    if (matches.length !== 1) return Object.freeze({ state: 'not_found' });
    const fields = dataFields(matches[0], 'conversation');
    return fields.get('source') === expectedSource
      ? Object.freeze({ state: 'allowed' })
      : Object.freeze({ state: 'forbidden' });
  } catch {
    return Object.freeze({ state: 'forbidden' });
  }
}

function normalizeViewport(value, topLevelZoom) {
  const fields = dataFields(value, 'application map viewport');
  const allowedKeys = new Set(['x', 'y', 'zoom']);
  if (!fields.has('x') || !fields.has('y')
    || fields.size < 2 || fields.size > 3
    || [...fields.keys()].some((key) => !allowedKeys.has(key))) {
    throw new TypeError('application map viewport is invalid');
  }
  const nestedZoom = fields.has('zoom') ? fields.get('zoom') : undefined;
  if (nestedZoom !== undefined && topLevelZoom !== undefined
    && nestedZoom !== topLevelZoom) {
    throw new TypeError('application map viewport zoom is inconsistent');
  }
  const viewport = {
    x: fields.get('x'),
    y: fields.get('y'),
    zoom: nestedZoom !== undefined ? nestedZoom : topLevelZoom,
  };
  if (Object.values(viewport).some((entry) => !Number.isFinite(entry) || Object.is(entry, -0))
    || Math.abs(viewport.x) > 1_000_000_000
    || Math.abs(viewport.y) > 1_000_000_000
    || viewport.zoom < 0.05
    || viewport.zoom > 16) {
    throw new TypeError('application map viewport is invalid');
  }
  return Object.freeze(viewport);
}

function normalizeMapContext(raw) {
  const snapshot = freezeJsonSnapshot(raw);
  const fields = dataFields(snapshot, 'application map snapshot');
  if (fields.get('ok') !== true || typeof fields.get('found') !== 'boolean') return null;
  const found = fields.get('found');
  if (!found) {
    return Object.freeze({
      found: false,
      contentDigest: null,
      nodeCount: 0,
      edgeCount: 0,
      viewport: Object.freeze({ x: 0, y: 0, zoom: 1 }),
      assetReferences: Object.freeze([]),
    });
  }
  const mapFields = dataFields(fields.get('map'), 'application map');
  const nodes = denseArray(mapFields.get('nodes'), 'application map nodes', 10_000);
  const edges = denseArray(mapFields.get('edges'), 'application map edges', 20_000);
  const assetReferences = [];
  const seenAssets = new Set();
  for (const node of nodes) {
    const nodeFields = dataFields(node, 'application map node');
    if (!nodeFields.has('assetId')) continue;
    const assetId = boundedText(
      nodeFields.get('assetId'),
      'application map assetId',
      4_096,
    );
    if (!seenAssets.has(assetId) && assetReferences.length < MAX_ASSET_REFERENCES) {
      seenAssets.add(assetId);
      assetReferences.push(assetId);
    }
  }
  const contentDigest = fields.has('contentDigest') ? fields.get('contentDigest') : null;
  if (contentDigest !== null && typeof contentDigest !== 'string') return null;
  return Object.freeze({
    found: true,
    contentDigest,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    viewport: normalizeViewport(
      mapFields.get('viewport'),
      mapFields.has('zoom') ? mapFields.get('zoom') : undefined,
    ),
    assetReferences: Object.freeze(assetReferences),
  });
}

function optionalMilestoneText(fields, key, maximum = MAX_CONTEXT_TEXT_CHARS) {
  if (!fields.has(key) || fields.get(key) === null || fields.get(key) === '') return '';
  return boundedText(fields.get(key), `active milestone ${key}`, maximum, { allowEmpty: true });
}

function normalizeMilestoneContext(raw) {
  const snapshot = freezeJsonSnapshot(raw);
  const fields = dataFields(snapshot, 'milestones snapshot');
  if (fields.get('ok') !== true || typeof fields.get('found') !== 'boolean') return null;
  const milestones = denseArray(fields.get('milestones'), 'milestones', 1_000);
  const active = milestones.filter((entry) => {
    const milestoneFields = dataFields(entry, 'milestone');
    return milestoneFields.get('status') === 'active';
  });
  if (active.length > 1) return null;
  let activeMilestone = null;
  if (active.length === 1) {
    const activeFields = dataFields(active[0], 'active milestone');
    const number = activeFields.has('number') ? activeFields.get('number') : null;
    if (number !== null && (!Number.isSafeInteger(number) || number < 0)) return null;
    activeMilestone = Object.freeze({
      id: safeIdentifier(activeFields.get('id'), 'active milestone id'),
      number,
      title: optionalMilestoneText(activeFields, 'title', 512),
      definitionOfDone: optionalMilestoneText(activeFields, 'acceptanceCriteria'),
      validationCommands: optionalMilestoneText(activeFields, 'validationCommands'),
    });
  }
  const contentDigest = fields.has('contentDigest') ? fields.get('contentDigest') : null;
  if (contentDigest !== null && typeof contentDigest !== 'string') return null;
  return Object.freeze({
    contentDigest,
    activeMilestone,
  });
}

function normalizeHistory(raw, conversationId) {
  try {
    const snapshot = freezeJsonSnapshot(raw);
    const fields = dataFields(snapshot, 'conversation history result');
    if (fields.get('ok') !== true || fields.get('conversationId') !== conversationId) return null;
    return Object.freeze(denseArray(fields.get('messages'), 'conversation messages', MAX_HISTORY_MESSAGES)
      .map((message) => {
        const messageFields = dataFields(message, 'conversation message');
        const role = messageFields.get('role');
        if (!['user', 'assistant'].includes(role)) throw new TypeError('conversation role is invalid');
        return Object.freeze({
          role,
          text: boundedText(messageFields.get('text'), 'conversation message text', MAX_MESSAGE_CHARS),
        });
      }));
  } catch {
    return null;
  }
}

function createContextHint(locale, mapContext, milestoneContext, intent, surface) {
  return Object.freeze({
    schemaVersion: MAP_CHAT_READ_ONLY_PROFILE_VERSION,
    surface,
    access: 'read_only',
    locale,
    intent,
    systemGuidance: surface === 'map_render'
      ? getMapRenderReadOnlySystemGuidance(locale)
      : getMapChatReadOnlySystemGuidance(locale),
    applicationMap: mapContext,
    activeMilestone: milestoneContext.activeMilestone,
  });
}

function publicProfile(locale, mapContext, milestoneContext, surface) {
  return Object.freeze({
    schemaVersion: MAP_CHAT_READ_ONLY_PROFILE_VERSION,
    surface,
    access: 'read_only',
    locale,
    mapDigest: mapContext.contentDigest,
    milestoneDigest: milestoneContext.contentDigest,
    activeMilestoneId: milestoneContext.activeMilestone
      ? milestoneContext.activeMilestone.id
      : null,
  });
}

function persistMessage(port, input, role, text, surface) {
  try {
    const result = callSynchronous(
      port.method,
      port.receiver,
      [input.projectId, input.conversationId, role, text, { mode: surface }],
      'conversationStore.addConversationMessage',
    );
    const fields = dataFields(result, 'conversation persistence result');
    return fields.get('ok') === true;
  } catch {
    return false;
  }
}

function extractApplicationMapProposalDraft(response) {
  const marker = '```faber-map-proposal';
  const markerCount = response.split(marker).length - 1;
  if (markerCount !== 1) {
    return Object.freeze({ response, proposalDraft: null });
  }
  const pattern = /(^|\n)```faber-map-proposal[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?=\r?\n|$)/g;
  const matches = [...response.matchAll(pattern)];
  if (matches.length !== 1) {
    return Object.freeze({ response, proposalDraft: null });
  }
  try {
    const parsed = JSON.parse(matches[0][2]);
    const fields = exactDataFields(
      parsed,
      ['schemaVersion', 'operations'],
      'application map proposal draft',
    );
    if (fields.get('schemaVersion') !== APPLICATION_MAP_PATCH_SCHEMA_VERSION) {
      throw new TypeError('application map proposal schema is unsupported');
    }
    const operations = normalizeApplicationMapProposalOperations(fields.get('operations'));
    const visibleResponse = boundedText(
      (response.slice(0, matches[0].index) + response.slice(matches[0].index + matches[0][0].length)).trim(),
      'Map Chat visible response',
      MAX_MESSAGE_CHARS,
    );
    return Object.freeze({
      response: visibleResponse,
      proposalDraft: Object.freeze({
        schemaVersion: APPLICATION_MAP_PATCH_SCHEMA_VERSION,
        operations,
      }),
    });
  } catch {
    return Object.freeze({ response, proposalDraft: null });
  }
}

async function invokeRuntime(port, payload, surface) {
  let result;
  try {
    result = Reflect.apply(port.method, port.receiver, [payload]);
    result = await result;
  } catch {
    return Object.freeze({ state: 'failed' });
  }
  try {
    const snapshot = freezeJsonSnapshot(result);
    const fields = dataFields(snapshot, 'Map Chat runtime result');
    if ((fields.has('action') && fields.get('action') !== null)
      || fields.has('jobId') || fields.has('proposalDraft')) {
      return Object.freeze({ state: 'mutating' });
    }
    if (fields.get('ok') !== true) return Object.freeze({ state: 'failed' });
    const response = boundedText(fields.get('response'), 'Map Chat response', MAX_MESSAGE_CHARS);
    const extracted = surface === 'map_chat'
      ? extractApplicationMapProposalDraft(response)
      : Object.freeze({ response, proposalDraft: null });
    return Object.freeze({ state: 'ok', ...extracted });
  } catch {
    return Object.freeze({ state: 'failed' });
  }
}

function createMapChatSessionService(options = {}) {
  let fields;
  try {
    fields = exactDataFields(options, OPTION_KEYS, 'Map Chat session service options');
  } catch {
    throw new TypeError('Invalid Map Chat session service options');
  }

  let authorizeProjectBinding;
  let assistantMessage;
  let readApplicationMapSnapshot;
  let readMilestonesSnapshot;
  let readOrchestrationState;
  let listConversationMessages;
  let addConversationMessage;
  try {
    authorizeProjectBinding = captureCallback(
      fields.get('authorizeProjectBinding'),
      'authorizeProjectBinding',
    );
    assistantMessage = captureOwnMethod(fields.get('assistantRuntime'), 'message', 'assistantRuntime');
    readApplicationMapSnapshot = captureOwnMethod(
      fields.get('applicationMapService'),
      'readApplicationMapSnapshot',
      'applicationMapService',
      { synchronous: true },
    );
    readMilestonesSnapshot = captureOwnMethod(
      fields.get('milestoneService'),
      'readMilestonesSnapshot',
      'milestoneService',
      { synchronous: true },
    );
    const conversationStore = fields.get('conversationStore');
    readOrchestrationState = captureOwnMethod(
      conversationStore,
      'readOrchestrationState',
      'conversationStore',
      { synchronous: true },
    );
    listConversationMessages = captureOwnMethod(
      conversationStore,
      'listConversationMessages',
      'conversationStore',
      { synchronous: true },
    );
    addConversationMessage = captureOwnMethod(
      conversationStore,
      'addConversationMessage',
      'conversationStore',
      { synchronous: true },
    );
  } catch {
    throw new TypeError('Invalid Map Chat session service options');
  }

  async function runTurn(input, { intent, persistUser, surface }) {
    const authorized = authorizeInput(input, authorizeProjectBinding);
    if (!authorized) return deny(MAP_CHAT_SESSION_REASONS.PROJECT_NOT_AUTHORIZED);

    let conversation;
    try {
      const state = callSynchronous(
        readOrchestrationState.method,
        readOrchestrationState.receiver,
        [],
        'conversationStore.readOrchestrationState',
      );
      conversation = findConversation(
        state,
        authorized.projectId,
        input.conversationId,
        surface,
      );
    } catch {
      conversation = Object.freeze({ state: 'forbidden' });
    }
    if (conversation.state === 'not_found') {
      return deny(MAP_CHAT_SESSION_REASONS.CONVERSATION_NOT_FOUND);
    }
    if (conversation.state !== 'allowed') {
      return deny(MAP_CHAT_SESSION_REASONS.CONVERSATION_FORBIDDEN);
    }

    let mapContext;
    let milestoneContext;
    try {
      mapContext = normalizeMapContext(callSynchronous(
        readApplicationMapSnapshot.method,
        readApplicationMapSnapshot.receiver,
        [authorized.rootPath],
        'applicationMapService.readApplicationMapSnapshot',
      ));
      milestoneContext = normalizeMilestoneContext(callSynchronous(
        readMilestonesSnapshot.method,
        readMilestonesSnapshot.receiver,
        [authorized.rootPath],
        'milestoneService.readMilestonesSnapshot',
      ));
    } catch {
      mapContext = null;
      milestoneContext = null;
    }
    if (!mapContext || !milestoneContext) {
      return deny(MAP_CHAT_SESSION_REASONS.CONTEXT_UNAVAILABLE);
    }

    let history;
    try {
      history = normalizeHistory(callSynchronous(
        listConversationMessages.method,
        listConversationMessages.receiver,
        [input.conversationId, MAX_HISTORY_MESSAGES],
        'conversationStore.listConversationMessages',
      ), input.conversationId);
    } catch {
      history = null;
    }
    if (!history) return deny(MAP_CHAT_SESSION_REASONS.HISTORY_UNAVAILABLE);

    if (persistUser && !persistMessage(
      addConversationMessage,
      input,
      'user',
      input.userMessage,
      surface,
    )) {
      return deny(MAP_CHAT_SESSION_REASONS.PERSISTENCE_FAILED);
    }

    const contextHint = createContextHint(
      input.locale,
      mapContext,
      milestoneContext,
      intent,
      surface,
    );
    const payload = Object.freeze({
      projectInfo: Object.freeze({
        id: authorized.projectId,
        projectId: authorized.projectId,
        rootPath: authorized.rootPath,
      }),
      userMessage: input.userMessage,
      contextHint,
      conversationMessages: history,
      attachments: input.attachments || Object.freeze([]),
      isMapChat: true,
      conversationId: input.conversationId,
    });
    const runtime = await invokeRuntime(assistantMessage, payload, surface);
    if (runtime.state === 'mutating') {
      return deny(MAP_CHAT_SESSION_REASONS.MUTATING_RESPONSE_FORBIDDEN);
    }
    if (runtime.state !== 'ok') return deny(MAP_CHAT_SESSION_REASONS.RUNTIME_FAILED);
    if (!persistMessage(
      addConversationMessage,
      input,
      'assistant',
      runtime.response,
      surface,
    )) {
      return deny(MAP_CHAT_SESSION_REASONS.PERSISTENCE_FAILED);
    }

    const result = {
      ok: true,
      conversationId: input.conversationId,
      response: runtime.response,
      profile: publicProfile(input.locale, mapContext, milestoneContext, surface),
    };
    if (runtime.proposalDraft) result.proposalDraft = runtime.proposalDraft;
    return Object.freeze(result);
  }

  async function sendMessage(rawInput) {
    const input = normalizeInput(rawInput);
    if (!input) return deny(MAP_CHAT_SESSION_REASONS.INVALID_INPUT);
    return runTurn(input, {
      intent: 'conversation',
      persistUser: true,
      surface: 'map_chat',
    });
  }

  async function analyze(rawInput) {
    const input = normalizeAnalyzeInput(rawInput);
    if (!input) return deny(MAP_CHAT_SESSION_REASONS.INVALID_INPUT);
    return runTurn(input, {
      intent: 'initial_analysis',
      persistUser: false,
      surface: 'map_chat',
    });
  }

  async function analyzeRender(rawInput) {
    const input = normalizeInput(rawInput);
    if (!input) return deny(MAP_CHAT_SESSION_REASONS.INVALID_INPUT);
    return runTurn(input, {
      intent: 'render_analysis',
      persistUser: false,
      surface: 'map_render',
    });
  }

  async function sendRenderMessage(rawInput) {
    const input = normalizeRenderMessageInput(rawInput);
    if (!input) return deny(MAP_CHAT_SESSION_REASONS.INVALID_INPUT);
    return runTurn(input, {
      intent: 'render_refinement',
      persistUser: true,
      surface: 'map_render',
    });
  }

  return Object.freeze({
    version: MAP_CHAT_SESSION_SERVICE_VERSION,
    analyze,
    analyzeRender,
    sendMessage,
    sendRenderMessage,
  });
}

module.exports = {
  MAP_CHAT_READ_ONLY_PROFILE_VERSION,
  MAP_CHAT_SESSION_REASONS,
  MAP_CHAT_SESSION_SERVICE_VERSION,
  createMapChatSessionService,
  getMapChatReadOnlySystemGuidance,
  getMapRenderReadOnlySystemGuidance,
};
