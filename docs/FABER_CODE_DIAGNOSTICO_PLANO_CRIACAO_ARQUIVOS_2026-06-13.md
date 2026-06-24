# Faber Code - Diagnostico e plano para corrigir criacao de arquivos

Data: 2026-06-13

Atualizacao de status em 2026-06-21: este documento passou a ser historico. A correcao do bloqueio para execucoes agentic sem alteracao material ja foi consolidada no codigo atual, entao o texto abaixo serve como registro do problema original e da estrategia adotada para resolve-lo.

## Resumo executivo

O problema original nao parecia ser permissao real de escrita no disco. A tool `write_files_batch` do caminho agentic chama `automata.execute_operation_batch`, e o executor Automata consegue criar diretorios e arquivos novos dentro da raiz do projeto.

O problema principal era de orquestracao e contrato de sucesso:

1. O `agentic_tool_loop` passou a ser preferido para qualquer rota `execute`.
2. Isso inclui continuacoes de `create_project` / `init_project`, que antes deveriam cair no pipeline de blueprint ou Cortex runtime.
3. No caminho `agentic_tool_loop`, o job e marcado como concluido quando o modelo para de chamar tools e retorna `ok: true`, mesmo que `modifiedFiles` esteja vazio.
4. O Faber entao exibe "Execucao concluida" e "100%" apesar de nenhum arquivo ter sido criado.
5. A UI mostra eventos tecnicos crus como `job.agentic_tool_called` / `job.agentic_tool_result`, mas nao mostra claramente quais tools rodaram, quais falharam, nem que o resultado nao alterou arquivos.

O dialogo anexado confirma o cenario: depois de um briefing de criacao complexo, o Faber respondeu com plano, o usuario disse "perfeito pode seguir", o job rodou o caminho agentic, marcou concluido e nenhum arquivo apareceu.

Status atual: esse fluxo foi corrigido no runtime e coberto por teste de regressao. O trecho a seguir fica registrado para auditoria e para explicar por que a validacao por `modifiedFiles` passou a ser obrigatoria.

## Evidencias no codigo do Faber

### 1. Preferencia indevida por agentic loop antes do pipeline de blueprint

Arquivo: cortex/orchestration/persona_orchestrator.js

Trecho relevante:

- linhas 556-565: se `routeDecision.decision === 'execute'`, o orchestrator tenta `buildAgenticExecutionPlan` primeiro.
- linhas 567-574: so cai em `buildPlanWithCortexRuntime` se o plano agentic nao existir.

Impacto na epoca:

- Um pedido de criacao de projeto (`create_project` / `init_project`) tambem entra no agentic loop.
- O pipeline antigo de blueprint, que preparava operacoes `write_file` verificaveis, fica bypassado.

### 2. Agentic loop aceita "sucesso" sem arquivos modificados

Arquivo: main/services/agentic_tool_loop_service.js

Trecho relevante:

- linhas 474-483: quando nao ha mais tool calls, retorna:
  - `ok: true`
  - `message: finalMessage || 'Concluido.'`
  - `modifiedFiles: [...modifiedFiles]`

Nao existia validacao de obrigatoriedade de artefatos. Para um pedido de criacao, `modifiedFiles: []` deveria ser falha ou estado "aguardando execucao", nunca sucesso.

### 3. `assistant:execute` marca agentic como concluido sem checar diffs

Arquivo: main.js

Trecho relevante:

- linhas 5006-5016: executa `agentic_tool_loop`.
- linhas 5024-5035: se `agenticResult.ok`, chama `markJobCompleted`.
- nao ha condicao do tipo:
  - `modifiedFiles.length > 0`
  - `toolRuns.some(write ok)`
  - `scanProject` antes/depois mudou
  - comandos reais passaram

Impacto direto nos prints anexados na epoca:

- o job pode ter tres tentativas de tool;
- pode terminar `ok`;
- pode exibir "Execucao concluida";
- mesmo sem alteracao material no projeto.

### 4. Tool de escrita existe, mas nao e usada como contrato obrigatorio

Arquivo: main/services/agentic_tool_loop_service.js

Trecho relevante:

- linhas 129-150: `write_file` chama `automata.execute_operation_batch`.
- linhas 153-185: `write_files_batch` tambem chama `automata.execute_operation_batch`.

Arquivo: cortex/automata/core/executor.js

Trecho relevante:

- linhas 419-432: `write_file` cria diretorios se necessario e grava o arquivo.

Conclusao historica:

- A capacidade de escrita existe.
- O bug nao era "o Faber nao pode escrever".
- O bug era "o Faber aceitava uma execucao sem escrita como se tivesse escrito".

### 5. O pipeline de blueprint para criacao ainda existe, mas ficou atras do agentic loop

Arquivo: main.js

Trecho relevante:

- linhas 3038-3172: `buildInitialBlueprintRuntimePlan` so roda para `executionIntent === 'init_project'`.
- linhas 3092-3103: constroi `buildProjectBlueprintOperationBatch`.
- linhas 3150-3161: calcula quantidade de arquivos e pergunta se deve aplicar.

Esse caminho e mais seguro para criacao inicial porque gera operacoes concretas e validaveis antes da conclusao.

## Evidencias no dialogo anexado

Arquivo anexado: .codex/attachments/cbd3327d-d50d-4eac-b4ac-11734526e4c2/pasted-text.txt

Pontos importantes:

- Linha 46: o usuario pediu para nao criar arquivos antes de apresentar arquitetura.
- Linha 467: o pedido reforca "aguarde a proxima instrucao para comecar a criar os arquivos".
- Linha 627: o proprio Faber diz que usara `write_files_batch` para criar/alterar cerca de 20 arquivos.
- Linha 645: "Com o plano aprovado, posso prosseguir criando os arquivos."
- Linha 649: apos aprovacao, responde apenas "Concluido."

Isto mostra que a etapa de planejamento funcionou, mas a etapa de execucao material nao foi obrigada a produzir artefatos.

## Referencias uteis do OpenCode

O objetivo nao e copiar UX/UI. As ideias uteis sao de runtime.

### 1. Tool calls como partes persistidas da sessao

Arquivo: opencode-dev/packages/opencode/src/session/processor.ts

- linhas 326-335: cada tool call vira uma parte `type: "tool"` com `state: pending`.
- linhas 350-368: resultado da tool e normalizado como output/metadata.

Aplicacao no Faber:

- manter eventos tecnicos, mas tambem registrar `toolName`, `input`, `ok`, `modifiedFiles`, `errors` e `diffStats` de forma apresentavel.

### 2. Escrita com diff, permissao e evidencia

Arquivo: opencode-dev/packages/opencode/src/tool/write.ts

- linhas 53-62: calcula diff e pede permissao `edit`.
- linhas 64-72: escreve arquivo e publica evento de arquivo editado.

Arquivo: opencode-dev/packages/opencode/src/tool/edit.ts

- linhas 175-186: calcula `additions`, `deletions` e `filediff`.
- linhas 188-194: injeta diff em metadata da tool.

Aplicacao no Faber:

- cada `write_file` / `write_files_batch` deve devolver `modifiedFiles`, `diffStats` e opcionalmente `diffPreview`.
- conclusao deve depender desses dados quando o pedido exige criacao/edicao.

### 3. Snapshot/diff de sessao como fonte de verdade

Arquivo: opencode-dev/packages/opencode/src/session/processor.ts

- linhas 676-690: captura snapshot no inicio do step.
- linhas 693-742: captura snapshot no fim e adiciona parte `patch` se houve arquivos alterados.

Arquivo: opencode-dev/packages/opencode/src/session/summary.ts

- linhas 82-99: computa diff entre snapshot inicial/final.
- linhas 124-126: salva diffs no summary da mensagem.

Aplicacao no Faber:

- para jobs de criacao/edicao, comparar scan antes/depois ou usar diff stats do executor.
- se nao houver delta, o job nao pode ser "Execucao concluida".

## Diagnostico raiz

### Causa primaria

`agentic_tool_loop` nao distingue tres tipos de finalizacao:

1. conversa/plano sem execucao;
2. execucao com tools sem alteracao;
3. execucao com alteracao material validada.

Hoje esses casos podem virar `ok: true`.

### Causa secundaria

O orchestrator usa `agentic_tool_loop` antes do pipeline `cortex_runtime` para qualquer rota `execute`, inclusive criacao inicial. Isso quebra a garantia anterior de que `init_project` passaria por plano com operacoes de arquivo.

### Causa terciaria

A UI/progresso nao transforma eventos agentic em diagnostico humano suficiente. Ela mostra "Concluido" e uma timeline tecnica, mas nao mostra "nenhum arquivo foi alterado" como bloqueio.

## Plano de correcao para Antigravity

### Fase 1 - Reproduzir em teste unitario, sem UI

Criar teste em `tests/agentic-tool-loop-service.test.js`:

1. Simular pedido de criacao: "pode seguir criando os arquivos".
2. Mockar `requestModelTurn` para retornar texto final sem tool calls.
3. Esperar que `executeAction` retorne `ok: false` ou `status: blocked` quando `requiresFileChanges` for verdadeiro.

Criar teste em `tests/assistant-flow.test.js`:

1. Simular rota `execute` com `productRoute.capability = create_project` e `executionIntent = init_project`.
2. Verificar que o plano nao escolhe `agentic_tool_loop` diretamente.
3. Verificar que cai em `buildPlanWithCortexRuntime` ou blueprint quando for criacao inicial.

### Fase 2 - Adicionar contrato de execucao material

No `agentic_tool_loop_service.js`, adicionar derivacao:

```js
function actionRequiresFileChanges(action = {}) {
  const route = action.routeDecision || {};
  const productRoute = route.productRoute || {};
  const text = `${action.userMessage || ''} ${route.executionMessage || ''}`.toLowerCase();
  return (
    productRoute.capability === 'create_project' ||
    productRoute.executionIntent === 'init_project' ||
    /\b(criar|crie|gerar|gere|implementar|implemente|arquivos|projeto|app|site)\b/.test(text)
  );
}
```

Antes de retornar sucesso sem tool calls:

- se `requiresFileChanges` e `modifiedFiles.length === 0`, retornar:
  - `ok: false`
  - `status: 'blocked'`
  - `message: 'A execucao nao criou nem alterou arquivos.'`
  - `errors: ['agentic_no_file_changes']`

Opcional:

- se houve tool de escrita mas todas falharam, retornar falha com o erro real da tool.
- se o modelo disse que nao tem permissao, mas nenhuma tool de escrita foi chamada, retornar `agentic_model_claimed_permission_without_tool`.

### Fase 3 - Impedir agentic loop direto para criacao inicial

No `persona_orchestrator.js`, antes de chamar `buildAgenticExecutionPlan`, adicionar guarda:

```js
function shouldPreferCortexRuntimeForRoute(routeDecision) {
  const productRoute = routeDecision && routeDecision.productRoute ? routeDecision.productRoute : {};
  return (
    productRoute.capability === 'create_project' ||
    productRoute.executionIntent === 'init_project'
  );
}
```

Aplicar:

```js
if (
  routeDecision &&
  routeDecision.decision === 'execute' &&
  typeof buildAgenticExecutionPlan === 'function' &&
  !shouldPreferCortexRuntimeForRoute(routeDecision)
) {
  plan = await buildAgenticExecutionPlan(...);
}
```

Resultado esperado:

- pedidos de criacao inicial voltam para `buildPlanWithCortexRuntime`;
- blueprint/local composer volta a preparar operacoes de arquivo;
- agentic loop fica para edicoes/reparos em projeto existente ate ganhar staging/gates equivalentes.

### Fase 4 - Ajustar `assistant:execute` para nao concluir sem delta

No bloco agentic de `main.js`, apos `agenticResult`:

1. Calcular:
   - `modifiedFiles.length`
   - `toolRuns` com tools de escrita bem sucedidas
   - se a rota exige alteracao material.
2. Se exigir alteracao e nao houver delta:
   - `markJobFailed(jobId, 'agentic_no_file_changes', 'execute_validation')`
   - retornar `ok: false`
   - nao chamar `markJobCompleted`

Pseudo:

```js
const requiresMaterialChange = actionRequiresMaterialChange(initialAction);
const changedFiles = Array.isArray(agenticResult.modifiedFiles) ? agenticResult.modifiedFiles : [];
if (agenticResult.ok && requiresMaterialChange && changedFiles.length === 0) {
  const blocked = {
    ...finalResult,
    ok: false,
    status: 'blocked',
    message: 'A execucao terminou sem criar ou alterar arquivos.',
    errors: ['agentic_no_file_changes'],
  };
  markJobFailed(jobId, 'agentic_no_file_changes', 'execute_validation');
  return blocked;
}
```

### Fase 5 - Melhorar retorno das tools agentic

Em `write_file` e `write_files_batch`:

1. Garantir que o retorno da tool sempre inclua:
   - `modifiedFiles`
   - `diffStats`
   - `operationCount`
   - `writeCount`
   - `errors`
2. Se `automata.execute_operation_batch` retorna `ok: true` mas `modifiedFiles` vazio:
   - retornar `status: 'no_effect'`
   - `ok: false` quando o conteudo era novo/esperado.

Essa mudanca evita que "lote sem efeito" seja contado como sucesso.

### Fase 6 - Registrar diagnostico humano no painel de progresso

Em `renderer/ux_state_model.js` e `renderer/job_progress.js`:

1. Mapear eventos:
   - `job.agentic_execution_started`
   - `job.agentic_tool_called`
   - `job.agentic_tool_result`
   - `agentic_no_file_changes`
2. Mostrar frases humanas:
   - "Chamei a ferramenta de escrita, mas nenhum arquivo mudou."
   - "O modelo encerrou a execucao sem criar arquivos."
   - "Bloqueei a conclusao porque o pedido exigia criacao de projeto."
3. Se `status = failed` e reason `agentic_no_file_changes`, exibir "Nao concluido" em vez de "Concluido".

### Fase 7 - Reativar blueprint como caminho confiavel de criacao

Validar que o caso do briefing anexado cai em:

- `productRoute.capability = create_project`
- `executionIntent = init_project`
- `buildInitialBlueprintRuntimePlan`
- operacoes reais `write_file`

Se `guidedAppArchitecture` estiver bloqueando blueprint para apps complexos, entao criar um caminho "scaffold minimal operacional":

- package root;
- `apps/web`;
- `apps/server`;
- `prisma/schema.prisma`;
- `docker-compose.yml`;
- README;
- scripts basicos.

Depois o agentic loop pode evoluir o projeto por etapas.

### Fase 8 - Testes obrigatorios de regressao

Adicionar testes:

1. `agentic loop blocks create project with no file changes`.
2. `agentic loop blocks write tool no_effect`.
3. `create_project init_project prefers cortex runtime over direct agentic`.
4. `assistant execute does not mark completed when agentic modifiedFiles is empty`.
5. `renderer shows Sem execucao/Nao concluido for agentic_no_file_changes`.
6. `operation batch write creates new nested file and reports modifiedFiles`.

### Fase 9 - Validacao manual minima, sem operar navegador

Depois dos ajustes, rodar apenas comandos locais:

```bash
node --check main.js
node --check main/services/agentic_tool_loop_service.js
node --check cortex/orchestration/persona_orchestrator.js
node tests/agentic-tool-loop-service.test.js
node tests/assistant-flow.test.js
node tests/renderer-ux-state-model.test.js
node tests/runtime-module-contract.test.js
git diff --check
```

Nao precisa abrir navegador para validar essa correcao estrutural.

## Ordem recomendada de implementacao

1. Criar os testes que reproduzem a falha.
2. Bloquear sucesso agentic sem arquivos quando o pedido exige criacao/edicao.
3. Desviar `create_project/init_project` para Cortex runtime/blueprint.
4. Ajustar `assistant:execute` para nao marcar completo sem delta.
5. Melhorar mensagens do painel.
6. Rodar os testes.
7. So depois fazer smoke real pela UI, se necessario.

## Resultado esperado

Depois desse plano:

- O Faber nao dira "Concluido" quando nenhum arquivo foi criado.
- Pedidos de criacao inicial voltarao a produzir operacoes de arquivo concretas.
- Se o modelo alucinar permissao, isso virara falha diagnosticavel, nao sucesso.
- O painel mostrara causa clara.
- O UX/UI visual do Faber Code permanece o mesmo; a mudanca e no contrato de runtime, validacao e comunicacao.
