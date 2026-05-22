const assert = require('assert');

const { createAssistantFlow } = require('../cortex/orchestration/assistant_flow');

function createHarness(overrides = {}) {
  const calls = {
    audit: [],
    checkpoints: [],
    jobEvents: [],
    phases: [],
    suggestions: [],
  };

  const flow = createAssistantFlow({
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
      meta: {
        planner: 'product_orchestrator',
        reason: 'faber_blueprint_create',
        provider: 'deterministic',
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
