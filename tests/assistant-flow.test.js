const assert = require('assert');

const { createAssistantFlow } = require('../cortex/orchestration/assistant_flow');
const { createPersonaOrchestrator } = require('../cortex/orchestration/persona_orchestrator');

function createHarness(overrides = {}) {
  const calls = {
    audit: [],
    checkpoints: [],
    jobEvents: [],
    phases: [],
    suggestions: [],
  };

  const flow = (overrides.flowFactory || createAssistantFlow)({
    appendAuditEvent: (type, payload) => calls.audit.push({ type, payload }),
    appendJobEvent: (jobId, type, payload) => calls.jobEvents.push({ jobId, type, payload }),
    buildAiProviderFailureMessage: (provider, message) => `${provider} failed: ${message}`,
    buildConversationOnlyPlan: (message) => ({ ok: true, response: `chat:${message}`, action: null }),
    buildPlanWithCortexRuntime: overrides.buildPlanWithCortexRuntime || (async () => ({
      ok: true,
      response: 'Plano técnico pronto.',
      action: { type: 'execute_operation_batch', operations: [] },
      meta: { planner: 'cortex_runtime', reason: 'operation_batch_ready' },
    })),
    clipText: (value, max) => String(value || '').slice(0, max),
    createAssistantJob: overrides.createAssistantJob || (() => ({
      ok: true,
      job: { id: 'job-1' },
    })),
    getSelectedAiProvider: () => 'openai',
    isAiRetryableReason: (reason) => /retry|timeout|429/i.test(String(reason || '')),
    markJobCompleted: (jobId, payload) => calls.phases.push({ jobId, phase: 'completed', payload }),
    markJobFailed: (jobId, reason, phase) => calls.phases.push({ jobId, phase: phase || 'failed', reason }),
    markJobPausedForMemory: (jobId, payload) => calls.phases.push({ jobId, phase: 'paused_memory_pressure', payload }),
    markJobPhase: (jobId, phase, payload) => calls.phases.push({ jobId, phase, payload }),
    markJobRetryPending: (jobId, reason, phase) => {
      calls.phases.push({ jobId, phase: phase || 'retry_pending', reason });
      return { ok: true, job: { retryState: { retryable: true } } };
    },
    requestPersonaRouteDecision: overrides.requestPersonaRouteDecision || (async () => ({
      ok: true,
      decision: 'execute',
      response: 'Vou preparar a execução.',
      executionMessage: 'criar site em Next.js',
      meta: { planner: 'persona_router', reason: 'persona_selected_execution' },
    })),
    resolveActiveMemoryContext: overrides.resolveActiveMemoryContext,
    resolveProductRoute: overrides.resolveProductRoute || (async () => ({
      ok: true,
      decision: 'chat',
      response: '',
      delegateToPersona: true,
      meta: {
        planner: 'product_orchestrator',
        reason: 'requires_persona_semantics',
        requiresPersona: true,
      },
    })),
    runtimeVersion: 'test-runtime',
    setJobCheckpoint: (jobId, key, data) => calls.checkpoints.push({ jobId, key, data }),
    summarizeActiveMemory: overrides.summarizeActiveMemory || ((activeMemory) => ({
      ok: Boolean(activeMemory),
      schemaVersion: activeMemory && activeMemory.schemaVersion,
    })),
    suggestAutomataContract: overrides.suggestAutomataContract || ((contract, options) => {
      calls.suggestions.push({ contract, options });
      return {
        ok: true,
        entry: {
          id: 'ledger-1',
          contractId: 'suggested.test',
          title: contract.title,
          status: 'suggest_blueprint',
          contract,
        },
      };
    }),
  });

  return { calls, flow };
}

async function run() {
  assert.strictEqual(typeof createPersonaOrchestrator, 'function');

  const orchestratorHarness = createHarness({ flowFactory: createPersonaOrchestrator });
  const orchestratorChatPlan = await orchestratorHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'oi',
  });
  assert.strictEqual(orchestratorChatPlan.meta.noJob, true);

  const executeHarness = createHarness();
  const executePlan = await executeHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'pode gerar o site',
    attachments: [],
  });

  assert.strictEqual(executePlan.ok, true);
  assert.strictEqual(executePlan.response, 'Plano técnico pronto.');
  assert.strictEqual(executePlan.jobId, 'job-1');
  assert.strictEqual(executePlan.action.jobId, 'job-1');
  assert.strictEqual(executePlan.routeDecision.decision, 'execute');
  assert.ok(executeHarness.calls.phases.some((entry) => entry.phase === 'persona_plan'));
  assert.ok(executeHarness.calls.phases.some((entry) => entry.phase === 'awaiting_user_confirmation'));

  const activeMemory = {
    schemaVersion: 'active-memory-v1',
    current: { continuationIntent: true },
    user: { available: true, selectedCount: 1 },
    project: { available: true, selectedCount: 1 },
    decision: { routeContextText: 'memoria ativa' },
  };
  let productRoutePayload = null;
  let personaRoutePayload = null;
  let runtimeContextHint = null;
  const activeMemoryHarness = createHarness({
    resolveActiveMemoryContext: async () => activeMemory,
    resolveProductRoute: async (payload) => {
      productRoutePayload = payload;
      return {
        ok: true,
        decision: 'chat',
        delegateToPersona: true,
        meta: {
          planner: 'product_orchestrator',
          reason: 'requires_persona_semantics',
          requiresPersona: true,
        },
      };
    },
    requestPersonaRouteDecision: async (payload) => {
      personaRoutePayload = payload;
      return {
        ok: true,
        decision: 'execute',
        response: 'Vou executar.',
        executionMessage: 'criar landing com memoria',
        meta: { planner: 'persona_router', reason: 'persona_selected_execution' },
      };
    },
    buildPlanWithCortexRuntime: async (_projectInfo, _message, _attachments, contextHint) => {
      runtimeContextHint = contextHint;
      return {
        ok: true,
        response: 'Plano com memória pronto.',
        action: { type: 'execute_operation_batch', operations: [] },
        meta: { planner: 'cortex_runtime', reason: 'operation_batch_ready' },
      };
    },
  });
  const activeMemoryPlan = await activeMemoryHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'segue com isso',
  });
  assert.strictEqual(activeMemoryPlan.ok, true);
  assert.strictEqual(productRoutePayload.activeMemory, activeMemory);
  assert.strictEqual(personaRoutePayload.activeMemory, activeMemory);
  assert.strictEqual(runtimeContextHint.activeMemory, activeMemory);
  assert.ok(activeMemoryHarness.calls.checkpoints.some((entry) => entry.key === 'active_memory'));

  let chatPersonaCalled = false;
  const chatHarness = createHarness({
    requestPersonaRouteDecision: async () => {
      chatPersonaCalled = true;
      return {
        ok: true,
        decision: 'chat',
        response: 'Olá! Como posso ajudar?',
        meta: { planner: 'persona_router', reason: 'persona_chat' },
      };
    },
  });
  const chatPlan = await chatHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'oi',
  });
  assert.strictEqual(chatPlan.ok, true);
  assert.strictEqual(chatPlan.action, null);
  assert.strictEqual(chatPlan.meta.noJob, true);
  assert.strictEqual(chatPlan.meta.reason, 'casual_greeting');
  assert.strictEqual(chatPlan.response, 'Oi, tudo bem?');
  assert.strictEqual(chatPersonaCalled, false);

  const wellBeingPlan = await chatHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'Tudo bem?',
  });
  assert.strictEqual(wellBeingPlan.ok, true);
  assert.strictEqual(wellBeingPlan.action, null);
  assert.strictEqual(wellBeingPlan.meta.noJob, true);
  assert.strictEqual(wellBeingPlan.response, 'Tudo bem, e voce?');

  const failureHarness = createHarness({
    buildPlanWithCortexRuntime: async () => {
      throw new Error('OpenAI não retornou texto gerado.');
    },
  });
  const failurePlan = await failureHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'criar projeto',
  });
  assert.strictEqual(failurePlan.ok, false);
  assert.strictEqual(failurePlan.action, null);
  assert.strictEqual(failurePlan.jobId, 'job-1');
  assert.strictEqual(failurePlan.meta.providerError, true);
  assert.strictEqual(failurePlan.meta.providerFailure.code, 'openai_empty_response');
  assert.strictEqual(failurePlan.meta.providerFailure.retryable, false);
  assert.ok(
    failureHarness.calls.checkpoints.some(
      (entry) => entry.key === 'provider_failure' && entry.data.providerFailure.code === 'openai_empty_response'
    )
  );
  assert.ok(failureHarness.calls.phases.some((entry) => entry.phase === 'provider_failure'));

  let forwardedRuntimePayload = null;
  const routingContextHarness = createHarness({
    requestPersonaRouteDecision: async () => ({
      ok: true,
      decision: 'execute',
      response: 'Combinado. Vou usar placeholders coerentes.',
      executionMessage: 'preparar uma primeira versão sem travar em novas perguntas',
      meta: { planner: 'persona_router', reason: 'persona_selected_execution' },
    }),
    buildPlanWithCortexRuntime: async (projectInfo, userMessage, attachments, contextHint) => {
      forwardedRuntimePayload = { projectInfo, userMessage, attachments, contextHint };
      return {
        ok: true,
        response: 'Plano técnico pronto.',
        action: { type: 'execute_operation_batch', operations: [] },
        meta: { planner: 'cortex_runtime', reason: 'operation_batch_ready' },
      };
    },
  });
  await routingContextHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'Quero criar um site em Next.js com placeholders para um advogado.',
    conversationMessages: [
      { role: 'user', text: 'Quero criar um site em Next.js com React e Tailwind.' },
      { role: 'assistant', text: 'Posso preparar com conteúdo placeholder.' },
    ],
  });
  assert.ok(forwardedRuntimePayload, 'runtime payload should be forwarded');
  assert.strictEqual(
    forwardedRuntimePayload.userMessage,
    'preparar uma primeira versão sem travar em novas perguntas'
  );
  assert.strictEqual(
    forwardedRuntimePayload.contextHint.originalUserMessage,
    'Quero criar um site em Next.js com placeholders para um advogado.'
  );
  assert.strictEqual(forwardedRuntimePayload.contextHint.conversationMessages.length, 2);

  let personaRouteCalled = false;
  let productRuntimePayload = null;
  const productRouteHarness = createHarness({
    resolveProductRoute: async () => ({
      ok: true,
      decision: 'execute',
      response: 'Vou usar o blueprint do Faber Code.',
      executionMessage: 'criar site em Next.js com placeholders',
      confidence: 0.98,
      productRoute: {
        capability: 'create_project',
        mode: 'faber_blueprint',
        executionIntent: 'init_project',
      },
      buildModeRoute: {
        mode: 'initial_blueprint',
        executionIntent: 'init_project',
      },
      workingBrief: {
        product: {
          domain: 'intellectual-property',
          stack: 'next-tailwind',
        },
      },
      meta: {
        planner: 'product_orchestrator',
        reason: 'faber_blueprint_create',
        provider: 'deterministic',
        contextFrame: {
          schemaVersion: 'orchestration-context-frame-evidence-v1',
          dominantSource: 'current_message',
          allowedSources: ['current_message'],
          blockedSources: [],
          guard: { ok: true, blocking: false, reason: '' },
          activeMemory: {
            available: false,
            allowedForRouting: false,
            allowedForBriefing: false,
            suppressed: false,
            suppressionReason: '',
          },
        },
      },
    }),
    requestPersonaRouteDecision: async () => {
      personaRouteCalled = true;
      return {
        ok: true,
        decision: 'chat',
        response: 'nao deveria chamar',
        meta: { planner: 'persona_router', reason: 'unexpected' },
      };
    },
    buildPlanWithCortexRuntime: async (projectInfo, userMessage, attachments, contextHint) => {
      productRuntimePayload = { projectInfo, userMessage, attachments, contextHint };
      return {
        ok: true,
        response: 'Blueprint pronto.',
        action: { type: 'execute_operation_batch', operations: [] },
        meta: { planner: 'cortex_runtime', reason: 'project_blueprint_ready' },
      };
    },
  });
  const productPlan = await productRouteHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'Quero criar um site em Next.js com placeholders',
  });
  assert.strictEqual(productPlan.ok, true);
  assert.strictEqual(personaRouteCalled, false);
  assert.strictEqual(productPlan.routeDecision.meta.planner, 'product_orchestrator');
  assert.strictEqual(productRuntimePayload.contextHint.productRouteDecision.meta.reason, 'faber_blueprint_create');
  assert.strictEqual(productRuntimePayload.contextHint.productRouteDecision.productRoute.mode, 'faber_blueprint');
  assert.strictEqual(productRuntimePayload.contextHint.productRouteDecision.buildModeRoute.mode, 'initial_blueprint');
  assert.strictEqual(productRuntimePayload.contextHint.productRouteDecision.workingBrief.product.domain, 'intellectual-property');
  assert.ok(
    productRouteHarness.calls.checkpoints.some(
      (entry) => entry.key === 'route_context_frame' && entry.data.dominantSource === 'current_message'
    )
  );
  assert.ok(
    productRouteHarness.calls.jobEvents.some(
      (entry) => entry.type === 'job.context_frame' && entry.payload.dominantSource === 'current_message'
    )
  );

  const suggestionHarness = createHarness({
    resolveProductRoute: async () => ({
      ok: true,
      decision: 'execute',
      response: 'Vou aplicar a rota determinística.',
      executionMessage: 'trocar os cards por uma tabela comparativa',
      productRoute: {
        capability: 'edit_project',
        mode: 'deterministic_patch',
        executionIntent: 'edit_project',
        projectState: 'existing_project',
      },
      meta: {
        planner: 'product_orchestrator',
        reason: 'deterministic_edit_intent',
        capability: 'edit_project',
        mode: 'deterministic_patch',
        executionIntent: 'edit_project',
        projectState: 'existing_project',
      },
    }),
    buildPlanWithCortexRuntime: async () => ({
      ok: false,
      response: 'Nao existe contrato ativo para esse micro pedido.',
      action: null,
      meta: {
        planner: 'cortex_runtime',
        reason: 'deterministic_patch_contract_unresolved',
      },
    }),
  });
  const suggestionPlan = await suggestionHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'crie uma regra local para trocar os cards por uma tabela comparativa',
  });
  assert.strictEqual(suggestionPlan.ok, false);
  assert.strictEqual(suggestionPlan.action, null);
  assert.ok(suggestionPlan.automataContractSuggestion);
  assert.strictEqual(suggestionPlan.meta.reason, 'automata_contract_suggestion_ready');
  assert.strictEqual(suggestionHarness.calls.suggestions.length, 1);
  assert.strictEqual(suggestionHarness.calls.suggestions[0].contract.capability, 'edit_project');
  assert.strictEqual(
    suggestionHarness.calls.suggestions[0].contract.proposedContract.source,
    'persona_orchestrator'
  );
  assert.ok(
    suggestionHarness.calls.phases.some(
      (entry) => entry.phase === 'awaiting_user_input' && entry.payload.reason === 'automata_contract_review'
    )
  );

  const unsolicitedSuggestionHarness = createHarness({
    resolveProductRoute: async () => ({
      ok: true,
      decision: 'execute',
      response: 'Vou aplicar a rota determinística.',
      executionMessage: 'trocar os cards por uma tabela comparativa',
      productRoute: {
        capability: 'edit_project',
        mode: 'deterministic_patch',
        executionIntent: 'edit_project',
        projectState: 'existing_project',
      },
      meta: {
        planner: 'product_orchestrator',
        reason: 'deterministic_edit_intent',
        capability: 'edit_project',
        mode: 'deterministic_patch',
        executionIntent: 'edit_project',
        projectState: 'existing_project',
      },
    }),
    buildPlanWithCortexRuntime: async () => ({
      ok: false,
      response: 'Nao existe contrato ativo para esse micro pedido.',
      action: null,
      meta: {
        planner: 'cortex_runtime',
        reason: 'deterministic_patch_contract_unresolved',
      },
    }),
  });
  const unsolicitedSuggestionPlan = await unsolicitedSuggestionHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'trocar os cards por uma tabela comparativa',
  });
  assert.strictEqual(unsolicitedSuggestionPlan.automataContractSuggestion, undefined);
  assert.strictEqual(unsolicitedSuggestionHarness.calls.suggestions.length, 0);
  assert.strictEqual(unsolicitedSuggestionPlan.meta.reason, 'deterministic_patch_contract_unresolved');

  const contaminatedInternalPromptHarness = createHarness({
    resolveProductRoute: async () => ({
      ok: true,
      decision: 'execute',
      response: 'Vou aplicar a rota incremental.',
      executionMessage:
        'trocar tipografia no app\n\nContrato do briefing atual:\n- Contrato temporario de blueprint ativo: Forge MRP.',
      productRoute: {
        capability: 'edit_project',
        mode: 'existing_project_edit',
        executionIntent: 'edit_project',
        projectState: 'existing_project',
      },
      meta: {
        planner: 'product_orchestrator',
        reason: 'build_mode_existing_project_edit',
        capability: 'edit_project',
        mode: 'existing_project_edit',
        executionIntent: 'edit_project',
        projectState: 'existing_project',
      },
    }),
    buildPlanWithCortexRuntime: async () => ({
      ok: false,
      response: 'Executor nao retornou acao.',
      action: null,
      meta: {
        planner: 'cortex_runtime',
        reason: 'cortex_runtime_empty_plan',
      },
    }),
  });
  const contaminatedInternalPromptPlan = await contaminatedInternalPromptHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'trocar a tipografia principal para IBM Plex Sans',
  });
  assert.strictEqual(contaminatedInternalPromptPlan.automataContractSuggestion, undefined);
  assert.strictEqual(contaminatedInternalPromptHarness.calls.suggestions.length, 0);
  assert.strictEqual(contaminatedInternalPromptPlan.meta.reason, 'cortex_runtime_empty_plan');

  const adaptiveValidationHarness = createHarness({
    resolveProductRoute: async () => ({
      ok: true,
      decision: 'execute',
      response: 'Vou gerar o blueprint adaptativo.',
      executionMessage: 'criar site Next.js para advocacia',
      productRoute: {
        capability: 'create_project',
        mode: 'adaptive_blueprint',
        executionIntent: 'init_project',
        projectState: 'empty_project',
      },
      meta: {
        planner: 'product_orchestrator',
        reason: 'adaptive_blueprint_create',
        capability: 'create_project',
        mode: 'adaptive_blueprint',
        executionIntent: 'init_project',
        projectState: 'empty_project',
      },
    }),
    buildPlanWithCortexRuntime: async () => ({
      ok: false,
      response: 'Blueprint falhou na validação.',
      action: null,
      meta: {
        planner: 'cortex_runtime',
        reason: 'cortex_validation_score:52',
      },
    }),
  });
  const adaptiveValidationPlan = await adaptiveValidationHarness.flow.handleAssistantMessage({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'criar site Next.js para advocacia',
  });
  assert.strictEqual(adaptiveValidationPlan.automataContractSuggestion, undefined);
  assert.strictEqual(adaptiveValidationHarness.calls.suggestions.length, 0);
  assert.strictEqual(adaptiveValidationPlan.meta.reason, 'cortex_validation_score:52');

  console.log('assistant-flow.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
