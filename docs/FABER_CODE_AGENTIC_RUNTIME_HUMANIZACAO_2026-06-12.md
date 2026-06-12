# Faber Code - Runtime agentic e humanizacao do chat em 2026-06-12

Data: 2026-06-12

## Contexto

Esta rodada nasceu de um feedback direto sobre a experiencia atual do Faber Code:

- o chat estava burocratico demais;
- respostas intermediarias soavam como texto pronto, sem presenca real;
- o fluxo `plano -> confirmacao -> execucao` estava aparecendo com frequencia mesmo quando o pedido ja era claramente executavel;
- o comportamento desejado ficou mais proximo do projeto `opencode-dev`, mantido apenas como referencia arquitetural por ter licenca MIT.

O objetivo desta mudanca nao foi copiar a interface do OpenCode. O objetivo foi aproximar o runtime do Faber Code de um comportamento mais agentic, mantendo a UX/UI propria do Faber.

## Objetivo tecnico da rodada

Trocar o caminho principal de execucao de:

- `pedido -> plano pendente -> confirmacao manual -> execucao`

para algo mais proximo de:

- `pedido -> loop com tools -> resultado real`

sempre que o provider/modelo suporte tool calling de forma compativel.

## Implementacao aplicada

### 1. Novo servico de loop agentic

Arquivo novo:

- `main/services/agentic_tool_loop_service.js`

Responsabilidades:

- definir um conjunto enxuto de tools operacionais do Faber;
- expor essas tools para o modelo em formato compativel com OpenAI Responses;
- continuar o loop ate nao haver mais `function_call`;
- acumular arquivos modificados, evidencias de tool run e checkpoints de job.

Tools expostas nesta rodada:

- `project_tree`
- `read_file`
- `search_text`
- `write_file`
- `write_files_batch`
- `run_command`
- `terminal_status`
- `preview_capture`
- `git_status`
- `structured_edit_plan`
- `structured_edit_apply`

### 2. Integracao do OpenAI Responses tool loop

Arquivo alterado:

- `main.js`

Foi adicionado um cliente dedicado para um turno agentic baseado em OpenAI Responses:

- converte conversa em `input_text` e `output_text`;
- converte resultados de tools em `function_call_output`;
- parseia `function_call` do provider;
- preserva `previous_response_id` entre passos.

Esse caminho so e habilitado quando:

- o provider selecionado e `openai`;
- o modelo atual entra na lista compativel com Responses e tool calling.

### 3. Preferencia pelo plano agentic no roteamento de execucao

Arquivo alterado:

- `cortex/orchestration/persona_orchestrator.js`

Quando a rota do pedido e `execute`, o orchestrator agora tenta primeiro construir um plano agentic.

Se esse plano estiver disponivel:

- o planner passa a ser `agentic_tool_loop`;
- o job marca `autoExecute: true`;
- a fase deixa de ficar presa em `awaiting_user_confirmation`.

Se o modo agentic nao estiver disponivel, o runtime ainda faz fallback para o caminho anterior.

### 4. Autoexecucao no renderer

Arquivo alterado:

- `renderer/app_actions.js`

Quando o plano chega com `meta.autoExecute = true`:

- o renderer nao abre card de confirmacao;
- reaproveita o mesmo mecanismo central de execucao;
- dispara a execucao imediatamente no projeto selecionado.

Na pratica, isso corta uma das partes mais artificiais do fluxo atual.

### 5. Chat final menos artificial

Arquivo alterado:

- `renderer/app_formatters.js`

O renderer deixou de transformar todo sucesso em frases padrao como:

- `Concluido: apliquei a alteracao e validei o projeto.`

No caminho agentic:

- a mensagem final prioriza o texto real retornado pelo loop;
- a mensagem intermedia do plano tambem volta a aparecer quando faz sentido, porque ela ja nao e mais so um preambulo vazio para a confirmacao.

## Validacoes executadas nesta rodada

Comandos rodados no repositorio do Faber Code:

```bash
node --check main.js
node --check cortex/orchestration/persona_orchestrator.js
node --check renderer/app_actions.js
node tests/agentic-tool-loop-service.test.js
node tests/assistant-flow.test.js
node tests/renderer-app-formatters.test.js
git diff --check
```

Resultado:

- todos passaram nesta rodada.

## Cobertura adicionada

Arquivo novo:

- `tests/agentic-tool-loop-service.test.js`

Ajustes em testes existentes:

- `tests/assistant-flow.test.js`
- `tests/renderer-app-formatters.test.js`

Esses testes agora cobrem:

- construcao do plano `agentic_tool_loop`;
- transicao para `execute_pending` sem confirmacao manual;
- continuidade do loop com tool results;
- preservacao de uma mensagem final mais natural no renderer.

## O que esta melhor agora

Melhorias concretas desta rodada:

- o chat do Faber fica menos preso a frases prontas de produto;
- pedidos tecnicos executaveis podem seguir direto para acao;
- o runtime ganha um loop real de `modelo -> tool -> tool result -> modelo`;
- a interface visual do Faber permanece a mesma.

## Limites que continuam abertos

Esta rodada melhora bastante o comportamento, mas nao fecha o problema inteiro.

Pontos ainda pendentes:

- o novo caminho agentic ainda nao foi provado em smoke real via Electron no `THE FORGE`;
- o caminho agentic atual ainda nao foi acoplado ao mesmo nivel de staging temporario e promocao verificada usado no fluxo `project_verified_execution_service`;
- ainda falta fechar o ciclo completo com rollback, build/test obrigatorios e evidencia visual obrigatoria dentro do proprio caminho agentic;
- ainda falta provar que o modelo usa grafo de contexto, contratos reais de store, services e domain, e nao inventa APIs cross-file quando entra em modo de reparo;
- ainda falta validar esse comportamento no alvo certo, que continua sendo apenas `THE FORGE`.

## Decisao operacional

A partir desta rodada, a direcao preferencial do Faber Code passa a ser:

- reduzir camadas de conversa artificial;
- priorizar loop agentic real;
- manter a UX/UI do Faber;
- usar `THE FORGE` como evidencia do comportamento do runtime;
- evitar declarar o problema resolvido antes de conectar esse novo loop agentic aos gates de staging, rollback e validacao real.
