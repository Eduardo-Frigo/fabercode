'use strict';

const assert = require('assert');

const {
  MAP_CHAT_READ_ONLY_PROFILE_VERSION,
  MAP_CHAT_SESSION_REASONS,
  MAP_CHAT_SESSION_SERVICE_VERSION,
  createMapChatSessionService,
  getMapChatReadOnlySystemGuidance,
} = require('../main/services/map_chat_session_service');

const ROOT_PATH = '/workspace/project';

function createHarness(overrides = {}) {
  const events = [];
  const calls = {
    authorizations: [],
    maps: [],
    milestones: [],
    histories: [],
    persisted: [],
    runtime: [],
  };
  const assistantRuntime = {
    async message(payload) {
      calls.runtime.push(payload);
      events.push('runtime');
      return { ok: true, response: 'Mapa compreendido.', action: null };
    },
  };
  const applicationMapService = {
    readApplicationMapSnapshot(rootPath) {
      calls.maps.push(rootPath);
      events.push('map:read');
      return {
        ok: true,
        found: true,
        contentDigest: `sha256:${'a'.repeat(64)}`,
        map: {
          nodes: [
            { id: 'node-a', title: 'Login', assetId: 'Map assets/ui/login.png' },
            { id: 'node-b', title: 'API' },
          ],
          edges: [{ id: 'edge-a', sourceNodeId: 'node-a', targetNodeId: 'node-b' }],
          viewport: { x: 12, y: 8 },
          zoom: 1.25,
        },
      };
    },
  };
  const milestoneService = {
    readMilestonesSnapshot(rootPath) {
      calls.milestones.push(rootPath);
      events.push('milestones:read');
      return {
        ok: true,
        found: true,
        format: 'rendered',
        contentDigest: `sha256:${'b'.repeat(64)}`,
        milestones: [
          { id: 'milestone-done', status: 'done', title: 'Base pronta' },
          {
            id: 'milestone-active',
            number: 6,
            status: 'active',
            title: 'Mapa e milestones',
            acceptanceCriteria: 'O chat nunca produz ação mutadora.',
            validationCommands: 'npm run test:map-chat-session',
          },
        ],
      };
    },
  };
  const conversationStore = {
    readOrchestrationState() {
      events.push('conversation:verify');
      return {
        conversationsByProject: {
          'project-1': [{
            id: 'conversation-1',
            title: 'Análise antiga',
            source: 'map_chat',
          }, {
            id: 'render-conversation-1',
            title: 'Render antigo',
            source: 'map_render',
          }],
        },
      };
    },
    listConversationMessages(conversationId, limit) {
      calls.histories.push({ conversationId, limit });
      events.push('history:read');
      return {
        ok: true,
        conversationId,
        messages: [
          { id: 'old-user', role: 'user', text: 'Qual é o escopo?', mode: 'map_chat' },
          { id: 'old-assistant', role: 'assistant', text: 'O escopo é o mapa.', mode: 'map_chat' },
        ],
      };
    },
    addConversationMessage(projectId, conversationId, role, text, meta) {
      const call = { projectId, conversationId, role, text, meta };
      calls.persisted.push(call);
      events.push(`persist:${role}`);
      return {
        ok: true,
        message: {
          id: `persisted-${role}`,
          role,
          text,
          mode: meta.mode,
        },
      };
    },
  };
  const authorizeProjectBinding = (projectId, rootPath) => {
    calls.authorizations.push({ projectId, rootPath });
    events.push('authorize');
    return {
      ok: true,
      authorized: true,
      projectId,
      rootPath,
      canonicalRootPath: rootPath,
    };
  };

  const options = {
    assistantRuntime,
    applicationMapService,
    authorizeProjectBinding,
    conversationStore,
    milestoneService,
    ...overrides,
  };
  const service = createMapChatSessionService(options);
  return {
    assistantRuntime,
    applicationMapService,
    calls,
    conversationStore,
    events,
    milestoneService,
    service,
  };
}

function input(overrides = {}) {
  return {
    projectId: 'project-1',
    rootPath: ROOT_PATH,
    conversationId: 'conversation-1',
    userMessage: 'Quais lacunas ainda existem?',
    locale: 'pt-BR',
    ...overrides,
  };
}

async function run() {
  assert.strictEqual(
    getMapChatReadOnlySystemGuidance('pt-BR').includes('NUNCA execute'),
    true,
  );
  assert.strictEqual(
    getMapChatReadOnlySystemGuidance('unsupported-locale'),
    getMapChatReadOnlySystemGuidance('pt-BR'),
  );

  const happy = createHarness();
  assert.strictEqual(happy.service.version, MAP_CHAT_SESSION_SERVICE_VERSION);
  assert.strictEqual(Object.isFrozen(happy.service), true);

  const result = await happy.service.sendMessage(input());
  assert.deepStrictEqual(result, {
    ok: true,
    conversationId: 'conversation-1',
    response: 'Mapa compreendido.',
    profile: {
      schemaVersion: MAP_CHAT_READ_ONLY_PROFILE_VERSION,
      surface: 'map_chat',
      access: 'read_only',
      locale: 'pt-BR',
      mapDigest: `sha256:${'a'.repeat(64)}`,
      milestoneDigest: `sha256:${'b'.repeat(64)}`,
      activeMilestoneId: 'milestone-active',
    },
  });
  assert.strictEqual(Object.isFrozen(result), true);
  assert.strictEqual(Object.hasOwn(result, 'action'), false);
  assert.strictEqual(Object.hasOwn(result, 'jobId'), false);
  assert.deepStrictEqual(happy.calls.authorizations, [{ projectId: 'project-1', rootPath: ROOT_PATH }]);
  assert.deepStrictEqual(happy.calls.maps, [ROOT_PATH]);
  assert.deepStrictEqual(happy.calls.milestones, [ROOT_PATH]);
  assert.deepStrictEqual(happy.calls.histories, [{ conversationId: 'conversation-1', limit: 100 }]);
  assert.deepStrictEqual(happy.events, [
    'authorize',
    'conversation:verify',
    'map:read',
    'milestones:read',
    'history:read',
    'persist:user',
    'runtime',
    'persist:assistant',
  ]);

  const runtimePayload = happy.calls.runtime[0];
  assert.strictEqual(runtimePayload.isMapChat, true);
  assert.strictEqual(runtimePayload.projectInfo.id, 'project-1');
  assert.strictEqual(runtimePayload.projectInfo.projectId, 'project-1');
  assert.strictEqual(runtimePayload.projectInfo.rootPath, ROOT_PATH);
  assert.strictEqual(runtimePayload.userMessage, 'Quais lacunas ainda existem?');
  assert.strictEqual(runtimePayload.conversationId, 'conversation-1');
  assert.deepStrictEqual(runtimePayload.attachments, []);
  assert.deepStrictEqual(runtimePayload.conversationMessages, [
    { role: 'user', text: 'Qual é o escopo?' },
    { role: 'assistant', text: 'O escopo é o mapa.' },
  ]);
  assert.strictEqual(Object.hasOwn(runtimePayload, 'approvalMode'), false);
  assert.strictEqual(Object.isFrozen(runtimePayload), true);
  assert.strictEqual(Object.isFrozen(runtimePayload.contextHint), true);
  assert.strictEqual(runtimePayload.contextHint.schemaVersion, MAP_CHAT_READ_ONLY_PROFILE_VERSION);
  assert.strictEqual(runtimePayload.contextHint.surface, 'map_chat');
  assert.strictEqual(runtimePayload.contextHint.access, 'read_only');
  assert.strictEqual(runtimePayload.contextHint.systemGuidance.includes('NUNCA execute'), true);
  assert.strictEqual(runtimePayload.contextHint.systemGuidance.includes('código'), true);
  assert.deepStrictEqual(runtimePayload.contextHint.applicationMap, {
    found: true,
    contentDigest: `sha256:${'a'.repeat(64)}`,
    nodeCount: 2,
    edgeCount: 1,
    viewport: { x: 12, y: 8, zoom: 1.25 },
    assetReferences: ['Map assets/ui/login.png'],
  });

  const legacyViewport = createHarness({
    applicationMapService: {
      readApplicationMapSnapshot() {
        return {
          ok: true,
          found: true,
          contentDigest: `sha256:${'c'.repeat(64)}`,
          map: {
            nodes: [],
            edges: [],
            viewport: { x: -3, y: 4, zoom: 0.75 },
          },
        };
      },
    },
  });
  const legacyViewportResult = await legacyViewport.service.sendMessage(input());
  assert.strictEqual(legacyViewportResult.ok, true);
  assert.deepStrictEqual(
    legacyViewport.calls.runtime[0].contextHint.applicationMap.viewport,
    { x: -3, y: 4, zoom: 0.75 },
  );
  assert.deepStrictEqual(runtimePayload.contextHint.activeMilestone, {
    id: 'milestone-active',
    number: 6,
    title: 'Mapa e milestones',
    definitionOfDone: 'O chat nunca produz ação mutadora.',
    validationCommands: 'npm run test:map-chat-session',
  });
  assert.deepStrictEqual(happy.calls.persisted, [
    {
      projectId: 'project-1',
      conversationId: 'conversation-1',
      role: 'user',
      text: 'Quais lacunas ainda existem?',
      meta: { mode: 'map_chat' },
    },
    {
      projectId: 'project-1',
      conversationId: 'conversation-1',
      role: 'assistant',
      text: 'Mapa compreendido.',
      meta: { mode: 'map_chat' },
    },
  ]);

  const structuredProposal = createHarness({
    assistantRuntime: {
      message: async () => ({
        ok: true,
        action: null,
        response: [
          'Preparei uma alteração para sua revisão.',
          '```faber-map-proposal',
          JSON.stringify({
            schemaVersion: 'application-map-patch.v1',
            operations: [{
              kind: 'upsert_node',
              node: { id: 'node-checkout', type: 'text', title: 'Checkout' },
            }],
          }),
          '```',
        ].join('\n'),
      }),
    },
  });
  const structuredResult = await structuredProposal.service.sendMessage(input());
  assert.strictEqual(structuredResult.ok, true);
  assert.strictEqual(structuredResult.response, 'Preparei uma alteração para sua revisão.');
  assert.deepStrictEqual(structuredResult.proposalDraft, {
    schemaVersion: 'application-map-patch.v1',
    operations: [{
      kind: 'upsert_node',
      node: { id: 'node-checkout', type: 'text', title: 'Checkout' },
    }],
  });
  assert.strictEqual(Object.isFrozen(structuredResult.proposalDraft), true);
  assert.strictEqual(Object.isFrozen(structuredResult.proposalDraft.operations), true);
  assert.strictEqual(
    structuredProposal.calls.persisted.at(-1).text,
    'Preparei uma alteração para sua revisão.',
  );

  happy.calls.persisted.length = 0;
  happy.calls.runtime.length = 0;
  const analysis = await happy.service.analyze({
    projectId: 'project-1',
    rootPath: ROOT_PATH,
    conversationId: 'conversation-1',
    locale: 'pt-BR',
  });
  assert.strictEqual(analysis.ok, true);
  assert.strictEqual(analysis.response, 'Mapa compreendido.');
  assert.strictEqual(
    happy.calls.runtime[0].userMessage.includes('Analise o estado atual do Mapa da Aplicação'),
    true,
  );
  assert.strictEqual(happy.calls.runtime[0].contextHint.intent, 'initial_analysis');
  assert.deepStrictEqual(happy.calls.persisted.map((entry) => entry.role), ['assistant']);

  happy.calls.persisted.length = 0;
  happy.calls.runtime.length = 0;
  const renderAnalysis = await happy.service.analyzeRender({
    projectId: 'project-1',
    rootPath: ROOT_PATH,
    conversationId: 'render-conversation-1',
    userMessage: 'Gerar a análise inicial do plano.',
    locale: 'pt-BR',
  });
  assert.strictEqual(renderAnalysis.ok, true);
  assert.strictEqual(renderAnalysis.profile.surface, 'map_render');
  assert.strictEqual(happy.calls.runtime[0].contextHint.surface, 'map_render');
  assert.strictEqual(happy.calls.runtime[0].contextHint.intent, 'render_analysis');
  assert.deepStrictEqual(happy.calls.persisted.map((entry) => entry.role), ['assistant']);

  happy.calls.persisted.length = 0;
  happy.calls.runtime.length = 0;
  const renderMessage = await happy.service.sendRenderMessage({
    projectId: 'project-1',
    rootPath: ROOT_PATH,
    conversationId: 'render-conversation-1',
    userMessage: 'Inclua uma etapa de acessibilidade.',
    locale: 'pt-BR',
    attachments: [{
      path: '/workspace/project/docs/application-map/accessibility.md',
      type: 'text/markdown',
      name: 'accessibility.md',
    }],
  });
  assert.strictEqual(renderMessage.ok, true);
  assert.strictEqual(renderMessage.profile.surface, 'map_render');
  assert.strictEqual(happy.calls.runtime[0].contextHint.intent, 'render_refinement');
  assert.deepStrictEqual(happy.calls.runtime[0].attachments, [{
    path: '/workspace/project/docs/application-map/accessibility.md',
    type: 'text/markdown',
    name: 'accessibility.md',
  }]);
  assert.deepStrictEqual(happy.calls.persisted.map((entry) => entry.role), ['user', 'assistant']);
  assert.deepStrictEqual(happy.calls.persisted.map((entry) => entry.meta), [
    { mode: 'map_render' },
    { mode: 'map_render' },
  ]);

  // Dependencies are captured once. Replacing public methods after construction
  // cannot widen the session to a mutating or forged implementation.
  happy.assistantRuntime.message = async () => ({ ok: true, response: 'forged' });
  happy.applicationMapService.readApplicationMapSnapshot = () => ({
    ok: true,
    found: false,
    map: null,
    contentDigest: null,
  });
  happy.milestoneService.readMilestonesSnapshot = () => ({
    ok: true,
    found: false,
    milestones: [],
    contentDigest: null,
  });
  assert.strictEqual((await happy.service.sendMessage(input())).response, 'Mapa compreendido.');

  const unauthorized = createHarness({
    authorizeProjectBinding: () => ({ ok: false, authorized: false }),
  });
  assert.strictEqual(
    (await unauthorized.service.sendMessage(input())).code,
    MAP_CHAT_SESSION_REASONS.PROJECT_NOT_AUTHORIZED,
  );
  assert.strictEqual(unauthorized.calls.runtime.length, 0);
  assert.strictEqual(unauthorized.calls.persisted.length, 0);

  const missingConversation = createHarness({
    conversationStore: {
      readOrchestrationState: () => ({ conversationsByProject: { 'project-1': [] } }),
      listConversationMessages: () => { throw new Error('must not read history'); },
      addConversationMessage: () => { throw new Error('must not persist'); },
    },
  });
  assert.strictEqual(
    (await missingConversation.service.sendMessage(input())).code,
    MAP_CHAT_SESSION_REASONS.CONVERSATION_NOT_FOUND,
  );

  const wrongSurface = createHarness({
    conversationStore: {
      readOrchestrationState: () => ({
        conversationsByProject: {
          'project-1': [{ id: 'conversation-1', source: 'user' }],
        },
      }),
      listConversationMessages: () => { throw new Error('must not read history'); },
      addConversationMessage: () => { throw new Error('must not persist'); },
    },
  });
  assert.strictEqual(
    (await wrongSurface.service.sendMessage(input())).code,
    MAP_CHAT_SESSION_REASONS.CONVERSATION_FORBIDDEN,
  );

  const mutating = createHarness({
    assistantRuntime: {
      message: async () => ({
        ok: true,
        response: 'Vou alterar.',
        action: { type: 'write_files', files: [] },
      }),
    },
  });
  assert.strictEqual(
    (await mutating.service.sendMessage(input())).code,
    MAP_CHAT_SESSION_REASONS.MUTATING_RESPONSE_FORBIDDEN,
  );
  assert.deepStrictEqual(mutating.calls.persisted.map((entry) => entry.role), ['user']);

  const forgedJob = createHarness({
    assistantRuntime: {
      message: async () => ({ ok: true, response: 'forged', jobId: 'job-1' }),
    },
  });
  assert.strictEqual(
    (await forgedJob.service.sendMessage(input())).code,
    MAP_CHAT_SESSION_REASONS.MUTATING_RESPONSE_FORBIDDEN,
  );

  const forgedProposalObject = createHarness({
    assistantRuntime: {
      message: async () => ({
        ok: true,
        response: 'forged',
        action: null,
        proposalDraft: {
          schemaVersion: 'application-map-patch.v1',
          operations: [],
        },
      }),
    },
  });
  assert.strictEqual(
    (await forgedProposalObject.service.sendMessage(input())).code,
    MAP_CHAT_SESSION_REASONS.MUTATING_RESPONSE_FORBIDDEN,
  );

  const noContext = createHarness({
    applicationMapService: {
      readApplicationMapSnapshot: () => ({ ok: false, found: true }),
    },
  });
  assert.strictEqual(
    (await noContext.service.sendMessage(input())).code,
    MAP_CHAT_SESSION_REASONS.CONTEXT_UNAVAILABLE,
  );
  assert.strictEqual(noContext.calls.persisted.length, 0);

  const invalidInputs = [
    null,
    {},
    input({ locale: 'fr-FR' }),
    input({ projectId: '../project' }),
    input({ conversationId: 'conversation\0bad' }),
    input({ rootPath: '/' }),
    input({ userMessage: '   ' }),
    { ...input(), extraAuthority: true },
  ];
  for (const invalidInput of invalidInputs) {
    const invalid = createHarness();
    const denied = await invalid.service.sendMessage(invalidInput);
    assert.strictEqual(denied.code, MAP_CHAT_SESSION_REASONS.INVALID_INPUT);
    assert.strictEqual(invalid.calls.authorizations.length, 0);
    assert.strictEqual(invalid.calls.runtime.length, 0);
  }
  assert.strictEqual(
    (await createHarness().service.analyze({ ...input(), userMessage: undefined })).code,
    MAP_CHAT_SESSION_REASONS.INVALID_INPUT,
  );
  assert.strictEqual(
    (await createHarness().service.sendRenderMessage({
      projectId: 'project-1',
      rootPath: ROOT_PATH,
      conversationId: 'render-conversation-1',
      userMessage: 'forged attachment',
      locale: 'pt-BR',
      attachments: [{ path: '/', name: 'root', type: 'text/plain' }],
    })).code,
    MAP_CHAT_SESSION_REASONS.INVALID_INPUT,
  );

  assert.throws(
    () => createMapChatSessionService({}),
    /Invalid Map Chat session service options/,
  );

  console.log('map-chat-session-service tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
