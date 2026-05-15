function stripAccents(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function compactWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildCombinedPrompt(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => String((message && message.content) || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function extractPromptField(prompt, label) {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(prompt || '').match(new RegExp(`${escaped}:\\s*([^\\n]+)`, 'i'));
  return match ? compactWhitespace(match[1]) : '';
}

function extractUserMessage(prompt) {
  return (
    extractPromptField(prompt, 'Mensagem do usuário') ||
    extractPromptField(prompt, 'Pedido do usuário') ||
    ''
  );
}

function isRouteDecisionPrompt(prompt) {
  return /"decision"\s*:\s*"chat\|clarify\|execute"/i.test(String(prompt || '')) ||
    /Você decide entre três modos/i.test(String(prompt || ''));
}

function isOperationBatchPrompt(prompt) {
  return /"operations"\s*:\s*\[/i.test(String(prompt || '')) ||
    /Executor técnico da Persona/i.test(String(prompt || ''));
}

function hasMockFlag(prompt, flag) {
  return String(prompt || '').toLowerCase().includes(`[mock:${String(flag || '').toLowerCase()}]`);
}

function classifyRoute(userMessage, prompt = '') {
  const normalized = stripAccents(userMessage);
  const hasProjectContext = /Projeto aberto:\s*(?!nenhum)/i.test(String(prompt || ''));
  const hasPreviousTechnicalJob = /Último job conhecido:\s*(?!nenhum)/i.test(String(prompt || ''));
  const casualOnly = /^(oi|ola|olá|bom dia|boa tarde|boa noite|ok|certo|beleza|valeu|obrigado|obrigada|teste)$/i.test(
    String(userMessage || '').trim()
  );

  if (!normalized || casualOnly) {
    return {
      decision: 'chat',
      response: 'Olá. Estou pronto para ajudar quando você quiser mexer no projeto.',
      executionMessage: '',
      confidence: 0.95,
    };
  }

  if (/(mock:clarify|qual caminho|me pergunte)/i.test(userMessage)) {
    return {
      decision: 'clarify',
      response: 'Antes de executar, preciso confirmar o objetivo principal e o tipo de entrega esperada.',
      executionMessage: '',
      confidence: 0.86,
    };
  }

  if (/(tente novamente|retente|continue|pode seguir|pode executar|siga)/.test(normalized) && hasPreviousTechnicalJob) {
    return {
      decision: 'execute',
      response: 'Vou retomar a partir do último job técnico registrado.',
      executionMessage: userMessage,
      confidence: 0.88,
    };
  }

  const technicalIntent = /(crie|criar|gere|gerar|implemente|implementar|corrija|corrigir|ajuste|ajustar|edite|editar|adicione|adicionar|remova|remover|refatore|refatorar|site|landing|calculadora|html|css|javascript|arquivo|bug|erro|layout|visual)/.test(
    normalized
  );

  if (technicalIntent && hasProjectContext) {
    return {
      decision: 'execute',
      response: 'Entendi o pedido técnico. Vou preparar um plano local e validável antes de aplicar alterações.',
      executionMessage: userMessage,
      confidence: 0.91,
    };
  }

  if (technicalIntent) {
    return {
      decision: 'clarify',
      response: 'Selecione um projeto antes de iniciar execução técnica.',
      executionMessage: '',
      confidence: 0.82,
    };
  }

  return {
    decision: 'chat',
    response: 'Entendi. Não iniciei execução porque a mensagem não trouxe um pedido técnico claro.',
    executionMessage: '',
    confidence: 0.78,
  };
}

function buildCalculatorFiles() {
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Calculadora Faber</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <main class="calculator">
    <h1>Calculadora</h1>
    <output id="display">0</output>
    <section class="keys" aria-label="Teclas da calculadora">
      <button data-key="7">7</button><button data-key="8">8</button><button data-key="9">9</button><button data-key="/">÷</button>
      <button data-key="4">4</button><button data-key="5">5</button><button data-key="6">6</button><button data-key="*">×</button>
      <button data-key="1">1</button><button data-key="2">2</button><button data-key="3">3</button><button data-key="-">−</button>
      <button data-key="0">0</button><button data-key=".">.</button><button data-key="=">=</button><button data-key="+">+</button>
      <button data-key="clear" class="wide">Limpar</button>
    </section>
  </main>
  <script src="./script.js"></script>
</body>
</html>
`;

  const css = `:root {
  color-scheme: dark;
  --bg: #121417;
  --panel: #20252b;
  --accent: #7dd3fc;
  --text: #f4f7fb;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.calculator {
  width: min(360px, calc(100vw - 32px));
  padding: 24px;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 18px;
  background: var(--panel);
}
h1 { margin: 0 0 16px; font-size: 24px; }
output {
  display: block;
  min-height: 58px;
  padding: 14px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: #0b0d10;
  text-align: right;
  font-size: 32px;
}
.keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
button {
  min-height: 48px;
  border: 0;
  border-radius: 10px;
  background: #303741;
  color: var(--text);
  font-size: 18px;
  cursor: pointer;
}
button:hover { background: #3c4652; }
button[data-key="="], button[data-key="+"] { background: var(--accent); color: #061018; }
.wide { grid-column: span 4; }
`;

  const js = `const display = document.querySelector('#display');
let expression = '';

function render(value) {
  display.textContent = value || '0';
}

document.querySelector('.keys').addEventListener('click', (event) => {
  const key = event.target && event.target.dataset ? event.target.dataset.key : '';
  if (!key) return;
  if (key === 'clear') {
    expression = '';
    render(expression);
    return;
  }
  if (key === '=') {
    try {
      expression = String(Function('"use strict"; return (' + expression + ')')());
    } catch {
      expression = '';
      render('Erro');
      return;
    }
    render(expression);
    return;
  }
  expression += key;
  render(expression);
});
`;

  return [
    { op: 'write_file', path: 'index.html', content: html },
    { op: 'write_file', path: 'style.css', content: css },
    { op: 'write_file', path: 'script.js', content: js },
  ];
}

function buildGenericPatch(userMessage) {
  const note = `# Faber Code Mock Execution

Pedido recebido:
${userMessage || 'Sem pedido informado.'}

Este arquivo foi gerado pelo provider mock para validar o pipeline local sem consumir API.
`;
  return [{ op: 'write_file', path: 'FABER_MOCK_RESULT.md', content: note }];
}

function buildOperationBatch(userMessage) {
  const normalized = stripAccents(userMessage);
  const operations = /calculadora/.test(normalized) ? buildCalculatorFiles() : buildGenericPatch(userMessage);
  return {
    summary: /calculadora/.test(normalized)
      ? 'Cria uma calculadora web estática mínima para validar o fluxo de execução.'
      : 'Cria um artefato local de validação do provider mock.',
    operations,
  };
}

async function callMockPersonaProviderChat(messages, _timeoutMs, _requestOptions = {}) {
  const prompt = buildCombinedPrompt(messages);

  if (hasMockFlag(prompt, 'provider-error')) {
    throw new Error('Mock provider error solicitado pelo teste.');
  }
  if (hasMockFlag(prompt, 'rate-limit')) {
    throw new Error('Mock HTTP 429: limite simulado para teste.');
  }
  if (hasMockFlag(prompt, 'invalid-json')) {
    return 'resposta mock propositalmente fora de JSON';
  }

  const userMessage = extractUserMessage(prompt);
  if (isRouteDecisionPrompt(prompt)) {
    return JSON.stringify(classifyRoute(userMessage, prompt));
  }

  if (isOperationBatchPrompt(prompt)) {
    return JSON.stringify(buildOperationBatch(userMessage));
  }

  return 'Provider mock ativo. Nenhuma execução foi iniciada sem contrato explícito.';
}

module.exports = {
  callMockPersonaProviderChat,
  classifyRoute,
  buildOperationBatch,
};
