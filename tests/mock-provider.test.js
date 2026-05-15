const assert = require('assert');
const { callMockPersonaProviderChat } = require('../cortex/providers/mock_provider');
const { validateOperationBatchPlan, validateRouteDecision } = require('../cortex/contracts/schemas');

async function mockRoute(userMessage, extraPrompt = '') {
  const raw = await callMockPersonaProviderChat([
    {
      role: 'system',
      content: 'Você decide entre três modos. Responda somente JSON válido.',
    },
    {
      role: 'user',
      content: [
        `Mensagem do usuário: ${userMessage}`,
        'Projeto aberto: {"rootPath":"/tmp/projeto","stacks":["Static"],"totalFiles":3,"sampleFiles":["index.html"]}',
        'Último job conhecido: nenhum.',
        extraPrompt,
        'Formato obrigatório:',
        '{',
        '  "decision": "chat|clarify|execute",',
        '  "response": "resposta curta para o usuário",',
        '  "executionMessage": "pedido técnico consolidado quando decision=execute",',
        '  "confidence": 0.0',
        '}',
      ].join('\n'),
    },
  ]);
  return JSON.parse(raw);
}

async function mockPlan(userMessage) {
  const raw = await callMockPersonaProviderChat([
    {
      role: 'system',
      content: 'Você é o Executor técnico da Persona. Responda SOMENTE JSON válido.',
    },
    {
      role: 'user',
      content: [
        `Pedido do usuário: ${userMessage}`,
        'Projeto atual: {"stacks":["Static"],"totalFiles":0,"sampleFiles":[]}',
        '- Formato JSON obrigatório:',
        '{',
        '  "summary": "texto curto",',
        '  "operations": [',
        '    { "op": "write_file", "path": "arquivo.ext", "content": "conteudo" }',
        '  ]',
        '}',
      ].join('\n'),
    },
  ]);
  return JSON.parse(raw);
}

async function run() {
  const casual = await mockRoute('oi');
  const casualValidation = validateRouteDecision(casual);
  assert.equal(casualValidation.ok, true);
  assert.equal(casualValidation.value.decision, 'chat');

  const execute = await mockRoute('crie uma calculadora simples em html css e javascript');
  const executeValidation = validateRouteDecision(execute);
  assert.equal(executeValidation.ok, true);
  assert.equal(executeValidation.value.decision, 'execute');
  assert.ok(executeValidation.value.executionMessage.includes('calculadora'));

  const plan = await mockPlan('crie uma calculadora simples em html css e javascript');
  const planValidation = validateOperationBatchPlan(plan);
  assert.equal(planValidation.ok, true, planValidation.errors.join(', '));
  assert.deepEqual(
    planValidation.value.operations.map((operation) => operation.path),
    ['index.html', 'style.css', 'script.js']
  );

  const invalidRaw = await callMockPersonaProviderChat([
    {
      role: 'user',
      content: [
        'Mensagem do usuário: [mock:invalid-json] crie uma calculadora',
        'Projeto aberto: {"rootPath":"/tmp/projeto"}',
        '"decision": "chat|clarify|execute"',
      ].join('\n'),
    },
  ]);
  assert.throws(() => JSON.parse(invalidRaw));

  console.log('mock-provider.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
