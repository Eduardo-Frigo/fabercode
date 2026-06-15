# Faber Code - Plano completo para Mapa da Aplicacao, Milestones e novo fluxo de desenvolvimento assistido por IA

Data: 2026-06-14

## 1. Objetivo do documento

Este documento organiza a proxima evolucao do Faber Code em duas frentes:

1. Resolver o ultimo problema tecnico em aberto do executor agentic: o loop ainda pode encerrar sem entregar alteracao material no projeto, ou atingir limite de passos quando ja fez grande parte do trabalho mas nao chama `finish_task`.
2. Redesenhar a dinamica de desenvolvimento da ferramenta para que o Faber Code deixe de ser apenas um IDE com chat e passe a ser um ambiente de construcao de aplicacoes assistidas por IA, guiado por:
   - Mapa da Aplicacao;
   - Renderizacao deterministica do mapa em documentacao local;
   - Milestones visuais;
   - desenvolvimento incremental, testavel e versionado.

O objetivo do produto e claro: transformar o Faber Code em um facilitador de desenvolvimento original, onde o usuario nao conversa com a IA em cima de um vazio. Ele constroi um mapa, renderiza esse mapa em contexto local auditavel, conversa com a IA sobre tradeoffs e entao executa milestones uma por vez.

## 2. Estado atual confirmado no codigo

### 2.1 O que ja existe e deve ser preservado

O Faber Code ja tem pilares importantes que devem virar parte do novo fluxo:

- Botao `Executar`, que roda localmente a aplicacao do projeto selecionado conforme a stack detectada.
- Painel visual de Git, com status, selecao de diffs por checkbox, stage, commit, rollback e integracao com GitHub/deploy.
- Chat central com anexos, historico e execucao agentic.
- Painel direito com arquivos, terminal, Git, contratos Automata e executar projeto.
- Cortex/memoria para registrar contexto, decisoes, referencias e documentacao do projeto.
- Runtime local com IPC via `preload.js`.
- Servicos de projeto, Git, preview, terminal, IA, Cortex e Automata ja separados em modulos.

### 2.2 O problema tecnico que ainda precisa ser fechado

O diagnostico anterior dizia que o Faber podia marcar uma execucao como concluida mesmo sem criar ou alterar arquivos. O codigo atual mostra que parte da correcao ja foi iniciada:

- `persona_orchestrator.js` ja tem `shouldPreferCortexRuntimeForRoute(routeDecision)` para impedir que `create_project/init_project` entre direto no `agentic_tool_loop`.
- `main.js` ja valida `agentic_no_file_changes` depois da execucao agentic, bloqueando sucesso se a acao exigia alteracao material e `modifiedFiles` veio vazio.
- `tests/agentic-tool-loop-service.test.js` ja contem teste esperando que o proprio servico agentic retorne `ok: false`, `status: blocked` e `errors: ['agentic_no_file_changes']`.

Mas o teste ainda falha hoje. Resultado observado:

```txt
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

true !== false
```

Isso acontece porque `agentic_tool_loop_service.js` ainda retorna `ok: true` quando o modelo para de chamar tools depois do lembrete, mesmo que a acao exija arquivos modificados.

Conclusao: a correcao esta parcialmente aplicada em `main.js`, mas precisa ser consolidada no proprio servico agentic. O contrato deve nascer no runtime, nao apenas no chamador.

## 3. Correcao imediata do problema em aberto

### 3.1 Principio

Uma tarefa de desenvolvimento so pode ser marcada como concluida quando sua evidencia bate com a intencao:

- se era conversa, briefing ou analise, uma resposta textual pode concluir;
- se era criacao/edicao, precisa haver alteracao material validada;
- se era validacao, precisa haver comando, teste, build, verificacao visual ou outro artefato de evidencia;
- se o agente nao conseguiu entregar, deve encerrar como `blocked`, `failed` ou `needs_user_input`, nunca como `success`.

### 3.2 Ajuste no `agentic_tool_loop_service.js`

Adicionar no inicio de `executeAction`:

```js
const requiresFileChanges = actionRequiresFileChanges(action);
```

Criar helper local:

```js
function buildNoFileChangesBlocker(message = 'A execucao nao criou nem alterou arquivos.') {
  return {
    ok: false,
    agentic: true,
    status: 'blocked',
    message,
    errors: ['agentic_no_file_changes'],
    modifiedFiles: [...modifiedFiles],
    toolRuns,
  };
}
```

Aplicar antes de todo retorno `ok: true`:

```js
if (requiresFileChanges && modifiedFiles.size === 0) {
  return buildNoFileChangesBlocker();
}
```

Pontos exatos onde o bloqueio deve entrar:

- retorno sem tool calls apos o lembrete;
- retorno apos `finish_task`;
- qualquer retorno de sucesso por limite logico futuro;
- opcionalmente, retorno em que so houve `read_file`, `project_tree`, `terminal_status` ou comandos sem alteracao.

### 3.3 Ajuste no contrato de `finish_task`

Hoje o agente pode chamar `finish_task` com `status: success` sem ter alterado arquivos. O servico deve aceitar a tool, mas reinterpretar o resultado:

- `finish_task(status: success)` + `requiresFileChanges` + `modifiedFiles.size === 0` = `blocked`.
- `finish_task(status: failure)` = `ok: false`, `status: failed` ou `blocked`, com mensagem do agente.
- `finish_task(status: success)` + alteracoes reais = sucesso.

### 3.4 Ajuste no limite de passos

O limite atual protege contra loop infinito, mas perde uma oportunidade importante: se houve arquivos modificados e o agente nao finalizou, o resultado nao deve ser tratado como sucesso silencioso nem como falha generica.

Novo comportamento:

- sem alteracoes e limite atingido: `failed`, `agentic_step_limit`;
- com alteracoes e sem validacao: `blocked`, `agentic_needs_validation`;
- com alteracoes e validacao minima executada: `partial_success`, pedindo revisao do usuario;
- com alteracoes, validacao e ausencia de `finish_task`: `blocked`, mas exibindo diffs e resultados para o usuario decidir concluir manualmente.

### 3.5 Evidencias que devem alimentar o job

Cada execucao agentic deve salvar no job:

- tools chamadas;
- ferramentas de escrita usadas;
- arquivos modificados;
- comandos rodados;
- resultado de build/test/lint;
- motivo de bloqueio;
- resumo humano;
- proximo passo recomendado.

Eventos tecnicos crus como `job.agentic_tool_called` e `job.agentic_tool_result` continuam existindo, mas a UI deve mostrar uma camada humana:

- "Leu 3 arquivos";
- "Alterou 2 arquivos";
- "Build passou";
- "Parou porque nenhuma alteracao foi criada";
- "Parou porque precisa validar em duas abas";
- "Aguardando revisao manual".

### 3.6 Testes obrigatorios

Testes imediatos:

- `tests/agentic-tool-loop-service.test.js`: deve passar com `agentic_no_file_changes` vindo do servico.
- `tests/assistant-flow.test.js`: garantir que `create_project/init_project` usa Cortex Runtime/blueprint antes do agentic loop.
- Novo teste: `finish_task success sem modifiedFiles` deve virar `blocked`.
- Novo teste: `finish_task failure` deve virar `ok: false`.
- Novo teste: step limit com arquivos modificados deve preservar `modifiedFiles` e retornar estado revisavel.

## 4. Nova visao de produto

### 4.1 De chat linear para ambiente de desenvolvimento guiado

O chat atual deve deixar de ser a unica fonte de verdade. Ele continua sendo o lugar de conversa, decisao e execucao, mas passa a operar sobre artefatos visuais e markdowns estruturados.

Nova dinamica:

1. Usuario cria ou importa um projeto.
2. Usuario abre o Mapa da Aplicacao.
3. Usuario organiza grupos, cards, textos, arquivos, imagens e referencias.
4. IA conversa sobre o mapa, identifica lacunas e sugere proximos blocos.
5. Usuario renderiza o mapa.
6. Faber gera markdowns e salva assets localmente.
7. Usuario conversa com a IA sobre stack, arquitetura e tradeoffs com base no mapa renderizado.
8. IA e usuario organizam milestones.
9. Faber cria documentacao de milestones.
10. Usuario executa uma milestone por vez.
11. Cada milestone registra alteracoes, validacoes e commits.
12. Painel visual mostra o estado real do desenvolvimento.

### 4.2 A ideia central

O Faber Code deixa de perguntar "o que voce quer fazer agora?" de forma aberta e passa a ajudar o usuario a transformar intuicao em projeto executavel.

O mapa e a fase de pensamento.
Os markdowns sao a memoria auditavel.
As milestones sao o plano operacional.
O Git e o historico de responsabilidade.
O botao Executar e a prova local de funcionamento.
O chat e o parceiro que interpreta, questiona e implementa.

## 5. Sistema de Mapa da Aplicacao

### 5.1 Funcao do mapa

O Mapa da Aplicacao e um canvas visual onde o usuario monta a estrutura conceitual do projeto antes da implementacao.

Ele deve suportar:

- grupos;
- subgrupos;
- cards de texto;
- cards de arquivo;
- cards de imagem;
- cards de video;
- links entre cards;
- tags;
- status de completude;
- comentarios;
- anexos;
- zoom;
- pan;
- foco em itens;
- expandir/recolher grupos;
- busca no mapa;
- filtros por tipo ou status.

### 5.2 Referencias visuais

As referencias indicam uma linguagem visual propria:

- canvas escuro com grid sutil;
- cards distribuidos livremente;
- conexoes curvas entre informacoes;
- toolbar lateral com ferramentas;
- topbar compacta com zoom, reset, foco e acoes;
- cards com midia grande quando a referencia visual importa;
- notas pequenas conectadas a imagens;
- grupos que podem expandir e recolher;
- sensacao de mapa vivo, nao formulario.

Arquivos de referencia:

- `/Users/eduardofrigo/Desktop/1 Referencia visual do que eu quero para o mapa da aplicação.png`
- `/Users/eduardofrigo/Desktop/2 Referencia visual do que eu quero para o mapa da aplicação.jpeg`
- `/Users/eduardofrigo/Desktop/3 Referência visual para o painel de milestones.jpeg`

### 5.3 Tipos de entidades

#### ApplicationMap

Representa o mapa inteiro do projeto.

Campos:

- `id`;
- `projectId`;
- `title`;
- `version`;
- `createdAt`;
- `updatedAt`;
- `viewport`;
- `nodes`;
- `edges`;
- `renderState`;
- `lastRenderedAt`;
- `sourceRootPath`.

#### MapNode

Representa qualquer item do canvas.

Tipos:

- `group`;
- `folder`;
- `text`;
- `markdown`;
- `image`;
- `video`;
- `asset`;
- `api`;
- `architecture`;
- `security`;
- `decision`;
- `milestone_seed`;
- `external_link`.

Campos:

- `id`;
- `type`;
- `title`;
- `description`;
- `content`;
- `assetId`;
- `parentId`;
- `position`;
- `size`;
- `collapsed`;
- `tags`;
- `status`;
- `metadata`;
- `createdAt`;
- `updatedAt`.

#### MapEdge

Representa conexoes entre cards.

Campos:

- `id`;
- `sourceNodeId`;
- `targetNodeId`;
- `label`;
- `type`;
- `direction`;
- `createdAt`;
- `updatedAt`.

Tipos de conexao:

- `depends_on`;
- `uses`;
- `explains`;
- `references`;
- `blocks`;
- `derived_from`;
- `belongs_to`;
- `should_be_built_before`.

#### MapAsset

Representa arquivos importados para o mapa.

Campos:

- `id`;
- `projectId`;
- `originalName`;
- `storedName`;
- `mimeType`;
- `kind`;
- `sourcePath`;
- `projectRelativePath`;
- `title`;
- `description`;
- `usedByNodeIds`;
- `createdAt`;

Tipos:

- `logo`;
- `visual_reference`;
- `background`;
- `product_image`;
- `ui_capture`;
- `video_reference`;
- `document`;
- `other`.

### 5.4 Estrutura visual sugerida do mapa

O mapa deve abrir como uma ferramenta central, substituindo temporariamente o chat quando o usuario estiver no modo de planejamento.

Layout:

- centro: canvas infinito;
- topo: barra de contexto do mapa;
- esquerda: toolbar vertical;
- direita: inspetor do item selecionado;
- rodape opcional: mini status de renderizacao.

Acoes principais:

- selecionar;
- arrastar;
- pan;
- adicionar grupo;
- adicionar texto;
- adicionar midia;
- conectar;
- importar arquivo;
- renderizar mapa;
- conversar com IA sobre o mapa;
- gerar milestones.

### 5.5 Grupos iniciais sugeridos

Ao criar um mapa novo, o Faber pode oferecer um template inicial:

- Frontend;
- Backend;
- API;
- Arquitetura;
- Seguranca;
- Dados;
- Integracoes;
- Design System;
- Assets;
- Regras de negocio;
- Deploy;
- Milestones.

O usuario pode apagar, renomear ou criar novos grupos livremente.

### 5.6 Exemplo de mapa renderizavel

Estrutura no canvas:

```txt
Frontend
  Design System
  Referencias visuais
  Imagens de referencia
  Texto explicando funcionamento do frontend
  Logos
  Backgrounds

Backend
  Responsabilidades
  Regras de negocio
  Autenticacao
  Persistencia

API
  Endpoints desejados
  APIs externas sugeridas
  Contratos de entrada e saida

Arquitetura
  Stack possivel
  Organizacao de pastas
  Tradeoffs

Seguranca
  Medidas obrigatorias
  Dados sensiveis
  Permissoes
```

## 6. Renderizacao do Mapa da Aplicacao

### 6.1 Principio

Renderizar o mapa nao e pedir para IA inventar documentacao. Renderizar e transformar deterministamente o que o usuario organizou no canvas em arquivos locais.

IA pode ajudar antes e depois:

- antes, analisando lacunas;
- depois, debatendo stack, tradeoffs e milestones.

Mas o ato de renderizar deve ser codigo previsivel.

### 6.2 Saida esperada no projeto

Ao renderizar, o Faber cria ou atualiza:

```txt
project-root/
  docs/
    application-map/
      README.md
      frontend.md
      backend.md
      api.md
      architecture.md
      security.md
      assets.md
      decisions.md
      open-questions.md
      application-map.json
  Map assets/
    logos/
    references/
    backgrounds/
    videos/
    documents/
```

Observacao: o nome pedido pelo usuario e `Map assets`. O sistema deve aceitar esse nome exatamente, mesmo com espaco, e usar paths relativos nos markdowns.

### 6.3 Regras de renderizacao

Regras deterministicas:

- cada grupo de primeiro nivel vira um markdown;
- cada subgrupo vira secao dentro do markdown do grupo pai;
- cards de texto viram paragrafos ou bullets;
- cards de markdown preservam markdown original;
- imagens sao copiadas para `Map assets/`;
- videos sao copiados para `Map assets/videos/`;
- documentos anexados sao copiados para `Map assets/documents/`;
- o markdown referencia cada asset por caminho relativo;
- cada card recebe uma ancora interna;
- conexoes viram secao `Relacoes`;
- perguntas incompletas viram `open-questions.md`;
- decisoes marcadas como aprovadas viram `decisions.md`;
- o estado bruto do mapa vira `application-map.json`.

### 6.4 Exemplo de markdown gerado para imagem

```md
## Logotipo cor 1

Tipo: logo
Origem no mapa: Frontend > Design System > Logos

![Logotipo cor 1](../../Map%20assets/logos/logotipo-cor-1.png)

Descricao:
Logotipo principal da aplicacao, usado em fundos claros.
```

### 6.5 Exemplo de markdown gerado para grupo

```md
# Frontend

Gerado pelo Faber Code a partir do Mapa da Aplicacao.

## Objetivo

Texto escrito pelo usuario explicando o funcionamento esperado do frontend.

## Design System

### Referencias visuais

- Referencia: painel escuro com canvas, cards conectados e toolbar lateral.
- Asset: `../../Map assets/references/referencia-mapa-01.png`

## Relacoes

- Este grupo depende de `Backend > API`.
- Este grupo usa assets de `Assets > Logos`.

## Perguntas abertas

- Qual biblioteca de canvas sera usada?
- O usuario precisa colaborar em tempo real no mapa?
```

### 6.6 Quando renderizar

Estados do mapa:

- `draft`: usuario ainda esta montando;
- `reviewing`: IA esta ajudando a revisar lacunas;
- `ready_to_render`: usuario marcou como suficiente;
- `rendered`: markdowns/assets foram gerados;
- `outdated`: mapa mudou depois da ultima renderizacao;
- `milestones_generated`: milestones foram criadas a partir da renderizacao.

O botao `Renderizar` deve estar sempre disponivel, mas com aviso quando existirem lacunas importantes.

## 7. Conversa com IA sobre o mapa

### 7.1 Chat contextual

O chat deve ganhar um modo contextual:

- `Chat do projeto`;
- `Chat do mapa`;
- `Chat da milestone atual`.

No `Chat do mapa`, a IA recebe:

- resumo do mapa;
- markdowns renderizados;
- perguntas abertas;
- assets com descricao, nao necessariamente bytes completos;
- decisoes registradas;
- status de completude por grupo.

### 7.2 O que a IA deve fazer antes da renderizacao

Comandos naturais esperados:

- "O que esta faltando nesse mapa?"
- "Esse backend esta bem descrito?"
- "O que preciso decidir antes de comecar?"
- "Quais riscos tecnicos voce enxerga?"
- "Que stack combina mais com isso?"
- "Organize esse mapa melhor."

Respostas esperadas:

- apontar lacunas;
- sugerir cards;
- sugerir grupos;
- sugerir perguntas;
- sugerir conexoes;
- nunca alterar automaticamente sem confirmacao;
- oferecer botao `Aplicar sugestoes ao mapa`.

### 7.3 O que a IA deve fazer apos a renderizacao

Depois do mapa renderizado, a IA deve ajudar a fechar:

- escopo da aplicacao;
- stack;
- arquitetura;
- tradeoffs;
- ordem de desenvolvimento;
- milestones;
- criterios de validacao;
- estrategia de commits.

## 8. Sistema de Milestones

### 8.1 Funcao das milestones

Milestones sao a ponte entre o planejamento e a execucao.

Elas devem organizar o desenvolvimento em etapas pequenas, verificaveis, versionaveis e discutiveis com a IA.

Cada milestone deve conter:

- objetivo;
- contexto de origem no mapa;
- arquivos/documentos relevantes;
- tarefas;
- criterio de aceite;
- comandos de validacao;
- status Git;
- commits relacionados;
- anotacoes do usuario;
- decisoes tomadas;
- bloqueios;
- data de inicio;
- data de conclusao.

### 8.2 Referencia visual

O painel de milestones deve se inspirar na imagem de linha vertical:

- timeline vertical;
- numeracao forte;
- etapa atual destacada;
- chips pequenos para topicos;
- status visual por cor;
- aparencia escura, limpa e tecnica;
- leitura rapida sem parecer board generico.

### 8.3 Estados de milestone

Estados sugeridos:

- `planned`: planejada;
- `ready`: pronta para iniciar;
- `active`: em execucao;
- `needs_review`: precisa revisao do usuario;
- `blocked`: bloqueada;
- `validated`: validada localmente;
- `committed`: commit feito;
- `done`: concluida;
- `skipped`: pulada;
- `reopened`: reaberta.

### 8.4 Dados da milestone

#### Milestone

Campos:

- `id`;
- `projectId`;
- `number`;
- `title`;
- `summary`;
- `status`;
- `sourceMapNodeIds`;
- `sourceMarkdownPaths`;
- `tasks`;
- `acceptanceCriteria`;
- `validationCommands`;
- `relatedFiles`;
- `commits`;
- `gitSnapshot`;
- `notes`;
- `startedAt`;
- `completedAt`;
- `updatedAt`.

#### MilestoneTask

Campos:

- `id`;
- `title`;
- `description`;
- `status`;
- `assignedTo`;
- `relatedFiles`;
- `acceptanceCriteria`;

#### MilestoneCommit

Campos:

- `hash`;
- `message`;
- `createdAt`;
- `filesChanged`;
- `additions`;
- `deletions`;

### 8.5 Arquivos gerados

Ao gerar milestones, o Faber cria:

```txt
project-root/
  docs/
    milestones/
      README.md
      milestone-01-foundation.md
      milestone-02-frontend-shell.md
      milestone-03-backend-core.md
      milestone-04-api-integration.md
      milestone-05-validation-and-deploy.md
      milestones.json
```

### 8.6 Exemplo de milestone em markdown

````md
# Milestone 01 - Foundation

Status: planned
Origem: Application Map > Arquitetura, Backend, Frontend

## Objetivo

Criar a base do projeto com stack definida, estrutura de pastas, dependencias principais e primeira tela funcional.

## Tarefas

- Criar ou validar estrutura inicial do projeto.
- Configurar stack escolhida.
- Adicionar design tokens iniciais.
- Criar shell visual minimo.
- Garantir que o projeto roda localmente.

## Criterios de aceite

- O projeto inicia pelo botao Executar do Faber.
- `npm run build` ou comando equivalente passa.
- A tela inicial renderiza sem erro.
- O Git mostra diff compreensivel para commit da milestone.

## Validacao

```txt
npm run build
npm test
```

## Commits relacionados

Nenhum commit ainda.
````

### 8.7 Criacao das milestones com IA

A criacao das milestones deve ser uma etapa assistida:

1. Renderizacao gera markdowns deterministas.
2. Usuario pede para IA propor milestones.
3. IA le markdowns do mapa e sugere plano.
4. Usuario ajusta nomes, ordem e escopo.
5. Usuario aprova.
6. Faber grava `docs/milestones/*.md` e `milestones.json`.

A IA pode reorganizar informacoes do mapa, mas a gravacao final deve passar por confirmacao do usuario.

### 8.8 Execucao de uma milestone

Fluxo esperado:

1. Usuario seleciona milestone.
2. Painel mostra contexto, tarefas, criterios e status Git.
3. Usuario conversa com a IA no contexto da milestone.
4. IA cria plano curto.
5. Usuario aprova execucao.
6. Agentic runtime executa apenas o escopo da milestone.
7. Faber valida alteracoes.
8. Usuario testa pelo botao Executar.
9. Usuario marca criterio de aceite.
10. Usuario commita pelo painel Git.
11. Milestone muda para `committed` ou `done`.

## 9. Integracao Mapa + Milestones + Git + Executar

### 9.1 Integracao com Git

O painel de milestones deve ler o estado Git atual:

- sem repo Git: sugerir iniciar Git;
- repo limpo: mostrar "sem alteracoes pendentes";
- repo com diff: mostrar arquivos modificados ligados ou nao a milestone ativa;
- staged: mostrar arquivos prontos para commit;
- commit recente: vincular commit a milestone ativa;
- rollback: alertar se rollback afeta milestone ativa.

O commit pode sugerir mensagem:

```txt
milestone 02: implement frontend shell
```

Ou:

```txt
feat(milestone-02): implement frontend shell
```

### 9.2 Integracao com Executar

O botao `Executar` deve conversar com milestones:

- se milestone ativa tem validacao pendente, mostrar sugestao de rodar;
- se preview sobe, registrar evidencia;
- se falha, associar log ao painel da milestone;
- se usuario testa manualmente e aprova, permitir marcar criterio como validado.

### 9.3 Integracao com Chat

O chat deve sempre saber o contexto ativo:

- projeto;
- mapa;
- milestone;
- arquivos modificados;
- status Git;
- ultima validacao;
- ultima renderizacao.

Exemplo de prompt interno:

```txt
Contexto ativo:
- Projeto: X
- Modo: milestone
- Milestone: 03 Backend Core
- Status: active
- Markdown: docs/milestones/milestone-03-backend-core.md
- Application Map: docs/application-map/README.md
- Git: 4 modified, 0 staged
- Ultima validacao: npm run build falhou
```

## 10. Arquitetura tecnica proposta

### 10.1 Novos servicos no main process

Criar:

```txt
main/services/application_map_service.js
main/services/application_map_render_service.js
main/services/application_map_asset_service.js
main/services/milestone_service.js
main/services/milestone_render_service.js
main/services/milestone_git_status_service.js
```

Responsabilidades:

- `application_map_service`: CRUD do mapa, nodes, edges e viewport.
- `application_map_asset_service`: importar, copiar, normalizar e listar assets.
- `application_map_render_service`: gerar markdowns e `application-map.json`.
- `milestone_service`: CRUD e status das milestones.
- `milestone_render_service`: gerar markdowns e `milestones.json`.
- `milestone_git_status_service`: cruzar milestone com Git, commits e diffs.

### 10.2 Novos handlers IPC

Adicionar handlers:

```txt
application-map:get
application-map:save
application-map:node:upsert
application-map:node:remove
application-map:edge:upsert
application-map:edge:remove
application-map:asset:import
application-map:render
application-map:summary

milestones:list
milestones:get
milestones:generate
milestones:save
milestones:update-status
milestones:update-task
milestones:link-commit
milestones:git-status
milestones:render
```

### 10.3 Novas APIs no `preload.js`

Expor:

```js
getApplicationMap: (payload) => ipcRenderer.invoke('application-map:get', payload),
saveApplicationMap: (payload) => ipcRenderer.invoke('application-map:save', payload),
upsertApplicationMapNode: (payload) => ipcRenderer.invoke('application-map:node:upsert', payload),
removeApplicationMapNode: (payload) => ipcRenderer.invoke('application-map:node:remove', payload),
upsertApplicationMapEdge: (payload) => ipcRenderer.invoke('application-map:edge:upsert', payload),
removeApplicationMapEdge: (payload) => ipcRenderer.invoke('application-map:edge:remove', payload),
importApplicationMapAsset: (payload) => ipcRenderer.invoke('application-map:asset:import', payload),
renderApplicationMap: (payload) => ipcRenderer.invoke('application-map:render', payload),
getApplicationMapSummary: (payload) => ipcRenderer.invoke('application-map:summary', payload),

listMilestones: (payload) => ipcRenderer.invoke('milestones:list', payload),
getMilestone: (payload) => ipcRenderer.invoke('milestones:get', payload),
generateMilestones: (payload) => ipcRenderer.invoke('milestones:generate', payload),
saveMilestones: (payload) => ipcRenderer.invoke('milestones:save', payload),
updateMilestoneStatus: (payload) => ipcRenderer.invoke('milestones:update-status', payload),
updateMilestoneTask: (payload) => ipcRenderer.invoke('milestones:update-task', payload),
linkMilestoneCommit: (payload) => ipcRenderer.invoke('milestones:link-commit', payload),
getMilestoneGitStatus: (payload) => ipcRenderer.invoke('milestones:git-status', payload),
renderMilestones: (payload) => ipcRenderer.invoke('milestones:render', payload),
```

### 10.4 Novos modulos no renderer

Criar:

```txt
renderer/application_map.js
renderer/application_map_canvas.js
renderer/application_map_toolbar.js
renderer/application_map_inspector.js
renderer/application_map_renderer.js
renderer/milestones_panel.js
renderer/milestones_timeline.js
renderer/milestones_status.js
renderer/styles/application-map.css
renderer/styles/milestones.css
```

### 10.5 Biblioteca de canvas

Para um canvas com pan, zoom, nodes e edges, existem duas opcoes:

1. Usar biblioteca especializada, como React Flow, se o renderer migrar ou ja aceitar React nessa area.
2. Implementar canvas DOM/SVG proprio se quiser manter o renderer vanilla atual.

Como o renderer atual parece ser vanilla JS, o MVP deve evitar uma migracao grande. A proposta conservadora:

- renderizar cards como elementos HTML posicionados em um stage;
- renderizar conexoes em SVG absoluto por baixo dos cards;
- controlar pan/zoom via transform CSS no stage;
- persistir posicoes em JSON;
- deixar uma eventual migracao para React Flow como fase futura.

### 10.6 Persistencia local

Persistencia por projeto:

```txt
project-root/
  .faber/
    application-map.json
    milestones.json
    map-assets-index.json
```

Renderizacao publica/auditavel:

```txt
project-root/
  docs/
    application-map/
    milestones/
  Map assets/
```

Motivo:

- `.faber` guarda estado de UI, posicoes e IDs internos.
- `docs` guarda documentacao legivel e versionavel.
- `Map assets` guarda arquivos referenciaveis pelo projeto.

## 11. UX proposta

### 11.1 Navegacao principal

Adicionar um novo modo no centro:

- Chat;
- Mapa;
- Milestone atual.

O usuario pode alternar sem perder contexto.

### 11.2 Painel direito

Substituir o botao `Contratos` por `Milestones`, como solicitado.

O painel direito deve ter:

- Arquivos;
- Terminal;
- Git;
- Milestones;
- Executar.

Automata Contracts pode continuar existindo como recurso interno ou avancado, mas nao deve ocupar o espaco principal do usuario comum.

### 11.3 Painel de milestones

Comportamento:

- abre na direita;
- mostra timeline vertical;
- destaca milestone ativa;
- mostra chips de escopo;
- mostra status Git;
- mostra validacoes;
- mostra botoes: `Iniciar`, `Pausar`, `Validar`, `Marcar revisao`, `Concluir`, `Commitar`.

Estados visuais:

- `planned`: contorno neutro;
- `ready`: acento claro;
- `active`: acento forte;
- `needs_review`: amarelo;
- `blocked`: vermelho;
- `validated`: azul/verde;
- `committed`: verde;
- `done`: verde solido.

### 11.4 Canvas do mapa

Controles:

- toolbar lateral com selecionar, pan, texto, grupo, imagem, conectar, comentario, importar;
- topbar com zoom, reset, foco, buscar, renderizar, conversar com IA;
- inspetor lateral com titulo, tipo, descricao, tags, status, conteudo, assets e relacoes.

Interacoes:

- duplo clique cria card;
- arrastar cria conexao;
- clique em grupo expande/recolhe;
- arrastar arquivo para canvas cria asset card;
- selecionar varios itens permite agrupar;
- botao `Renderizar` cria markdowns.

## 12. Como a IA deve usar o mapa e as milestones

### 12.1 Contexto para o modelo

O Faber deve alimentar a IA com uma versao compacta do mapa:

```json
{
  "groups": [
    {
      "title": "Frontend",
      "summary": "...",
      "nodes": ["Design System", "Referencias visuais"],
      "openQuestions": []
    }
  ],
  "assets": [
    {
      "title": "Logotipo cor 1",
      "kind": "logo",
      "path": "Map assets/logos/logotipo-cor-1.png"
    }
  ],
  "renderedDocs": [
    "docs/application-map/frontend.md"
  ],
  "milestones": [
    {
      "title": "Foundation",
      "status": "active"
    }
  ]
}
```

### 12.2 Ferramentas novas para o agentic loop

Adicionar tools ao agentic runtime:

- `read_application_map`;
- `read_rendered_application_docs`;
- `read_milestones`;
- `read_active_milestone`;
- `update_milestone_task`;
- `append_milestone_note`;
- `mark_milestone_status`;

Essas tools devem ser seguras e auditar tudo no job.

### 12.3 Restricao de escopo por milestone

Quando uma milestone esta ativa, a IA deve receber uma regra:

```txt
Voce esta executando apenas a milestone ativa. Nao implemente escopos futuros, a menos que seja necessario para passar os criterios de aceite desta milestone.
```

Isso reduz trabalhos enormes, diminui loops de 40 passos e melhora a capacidade de finalizar.

## 13. Plano de implementacao por fases

### Fase 0 - Fechar runtime agentic

Objetivo: impedir conclusoes falsas e transformar loop pesado em resultado auditavel.

Tarefas:

- mover a validacao `agentic_no_file_changes` para `agentic_tool_loop_service.js`;
- reinterpretar `finish_task` conforme evidencias;
- melhorar retorno de step limit;
- salvar resumo humano de tools no job;
- passar `tests/agentic-tool-loop-service.test.js`;
- adicionar testes de `finish_task`;
- manter validacao redundante em `main.js` como segunda linha de defesa.

Aceite:

- tarefa que exige arquivos nunca retorna sucesso com `modifiedFiles: []`;
- teste atual deixa de falhar;
- UI recebe motivo claro de bloqueio.

### Fase 1 - Base persistente do Mapa da Aplicacao

Objetivo: criar armazenamento local e IPC sem mexer ainda na UI complexa.

Tarefas:

- criar `application_map_service.js`;
- criar schema JSON;
- salvar em `.faber/application-map.json`;
- adicionar handlers IPC;
- expor APIs no `preload.js`;
- criar testes unitarios de CRUD;
- criar migracao simples para mapa ausente.

Aceite:

- criar mapa vazio por projeto;
- adicionar node;
- adicionar edge;
- atualizar viewport;
- persistir e recarregar.

### Fase 2 - MVP visual do mapa

Objetivo: entregar canvas funcional em vanilla JS.

Tarefas:

- criar botao/modo `Mapa`;
- criar stage com pan e zoom;
- renderizar nodes como cards HTML;
- renderizar edges em SVG;
- criar toolbar lateral;
- criar inspetor;
- suportar grupos colapsaveis;
- suportar importar imagem/documento;
- salvar posicoes.

Aceite:

- usuario consegue montar Frontend/Backend/API/Arquitetura/Seguranca;
- usuario consegue conectar cards;
- usuario consegue anexar imagem;
- mapa persiste ao fechar/reabrir.

### Fase 3 - Renderizacao deterministica

Objetivo: transformar mapa em markdowns e assets locais.

Tarefas:

- criar `application_map_render_service.js`;
- criar `application_map_asset_service.js`;
- copiar assets para `Map assets`;
- gerar `docs/application-map/*.md`;
- gerar `docs/application-map/application-map.json`;
- marcar mapa como `rendered`;
- detectar `outdated` quando mapa mudar.

Aceite:

- renderizacao gera markdowns legiveis;
- imagens sao copiadas;
- paths relativos funcionam;
- renderizacao nao depende de IA.

### Fase 4 - Chat do mapa

Objetivo: permitir conversa com IA sobre o mapa.

Tarefas:

- criar resumo compacto do mapa;
- adicionar modo de contexto `application_map`;
- permitir "analisar lacunas";
- permitir "sugerir cards";
- permitir "sugerir conexoes";
- criar preview de sugestoes antes de aplicar;
- registrar decisoes no mapa.

Aceite:

- IA aponta lacunas do mapa;
- usuario aprova sugestoes;
- sugestoes viram nodes/edges sem alterar codigo do projeto.

### Fase 5 - Sistema de milestones persistente

Objetivo: criar a camada de organizacao do desenvolvimento.

Tarefas:

- criar `milestone_service.js`;
- criar `.faber/milestones.json`;
- criar `docs/milestones`;
- criar schema de milestones;
- criar handlers IPC;
- expor APIs no `preload.js`;
- criar testes de CRUD/status.

Aceite:

- listar milestones;
- criar milestone;
- atualizar status;
- atualizar task;
- renderizar markdown.

### Fase 6 - Geracao assistida de milestones

Objetivo: IA transforma mapa renderizado em plano de desenvolvimento.

Tarefas:

- ler markdowns renderizados;
- gerar proposta de milestones;
- mostrar preview editavel;
- usuario aprova;
- gravar `docs/milestones/*.md`;
- gravar `.faber/milestones.json`.

Aceite:

- IA sugere milestones coerentes;
- usuario consegue editar antes de salvar;
- milestones ficam ligadas aos grupos do mapa.

### Fase 7 - Painel visual de milestones

Objetivo: substituir o lugar visual de contratos por milestones.

Tarefas:

- trocar botao `Contratos` por `Milestones`;
- criar `renderer/milestones_panel.js`;
- criar timeline vertical;
- integrar status Git;
- integrar validacoes;
- exibir commits relacionados;
- permitir mudanca manual de status;
- permitir marcar tarefa concluida.

Aceite:

- painel mostra linha de desenvolvimento;
- milestone ativa fica clara;
- usuario consegue sinalizar avancos manualmente;
- Git status aparece no contexto certo.

### Fase 8 - Execucao por milestone

Objetivo: agentic runtime passa a trabalhar por etapas pequenas.

Tarefas:

- adicionar contexto de milestone ao chat;
- adicionar tools de milestone ao agentic loop;
- restringir escopo da IA a milestone ativa;
- registrar alteracoes na milestone;
- anexar validacoes;
- sugerir commit;
- ligar commit a milestone.

Aceite:

- usuario seleciona milestone e pede execucao;
- IA implementa somente aquela etapa;
- milestone registra arquivos alterados, validacao e commit.

### Fase 9 - Polimento e robustez

Objetivo: transformar MVP em experiencia de produto.

Tarefas:

- autosave do mapa;
- undo/redo no canvas;
- busca global no mapa;
- foco em item;
- minimap opcional;
- import/export do mapa;
- duplicar grupo;
- templates de mapa;
- smoke visual;
- acessibilidade basica;
- performance com muitos cards.

Aceite:

- mapa grande continua usavel;
- milestones continuam legiveis;
- usuario nao perde trabalho;
- nova experiencia parece nativa do Faber.

## 14. Testes e validacao

### 14.1 Testes unitarios

Criar:

- `tests/application-map-service.test.js`;
- `tests/application-map-render-service.test.js`;
- `tests/application-map-asset-service.test.js`;
- `tests/milestone-service.test.js`;
- `tests/milestone-render-service.test.js`;
- `tests/milestone-git-status-service.test.js`;

### 14.2 Testes de renderer

Criar:

- `tests/renderer-application-map.test.js`;
- `tests/renderer-milestones-panel.test.js`;

Validar:

- botao Mapa existe;
- botao Milestones existe;
- canvas renderiza node;
- inspector atualiza;
- renderizacao mostra status;
- painel de milestones mostra timeline.

### 14.3 Smokes manuais

Cenario 1:

- criar novo projeto;
- abrir mapa;
- criar grupos;
- anexar imagem;
- renderizar;
- verificar `docs/application-map`;
- verificar `Map assets`.

Cenario 2:

- pedir IA para analisar mapa;
- aplicar sugestao;
- renderizar de novo;
- verificar `outdated/rendered`.

Cenario 3:

- gerar milestones;
- iniciar milestone 01;
- pedir implementacao;
- rodar Executar;
- commitar;
- milestone deve mostrar commit.

### 14.4 Validacao visual

Comparar com referencias:

- canvas escuro com grid sutil;
- cards conectados por linhas curvas;
- toolbar lateral compacta;
- topbar com zoom/foco/renderizacao;
- timeline vertical de milestones;
- chips pequenos por subetapa.

## 15. Riscos e decisoes importantes

### 15.1 Risco: escopo visual grande demais

Mitigacao:

- MVP com DOM/SVG vanilla;
- sem colaboracao realtime no inicio;
- sem engine complexa de layout automatico;
- persistencia simples em JSON.

### 15.2 Risco: IA alterar mapa sem controle

Mitigacao:

- IA sempre sugere;
- usuario aprova;
- toda mudanca vira diff de nodes/edges;
- renderizacao e deterministica.

### 15.3 Risco: milestones virarem checklist cosmetico

Mitigacao:

- ligar milestone a Git;
- ligar milestone a comandos de validacao;
- ligar milestone a arquivos modificados;
- exigir criterio de aceite;
- registrar commits.

### 15.4 Risco: assets ficarem fora do projeto

Mitigacao:

- importar copia para `Map assets`;
- registrar indice em `.faber/map-assets-index.json`;
- markdown sempre referencia path relativo;
- avisar se asset original sumiu, mas manter copia local.

### 15.5 Risco: path com espaco em `Map assets`

Mitigacao:

- usar APIs de path do Node;
- gerar markdown com URL encoding quando necessario;
- testar em macOS, Windows e Linux.

## 16. Ordem recomendada de commits

1. `fix(agentic): block successful runs without required file changes`
2. `test(agentic): cover finish_task and material-change contracts`
3. `feat(map): add application map persistence service`
4. `feat(map): expose application map ipc bridge`
5. `feat(map): add visual canvas mvp`
6. `feat(map): render application map docs and assets`
7. `feat(milestones): add milestone persistence and markdown renderer`
8. `feat(milestones): add visual milestone timeline panel`
9. `feat(ai): add application map and milestone context modes`
10. `feat(agentic): execute active milestone with scoped context`

## 17. Definicao de pronto da nova plataforma

A transformacao pode ser considerada pronta quando:

- o problema `agentic_no_file_changes` estiver resolvido na origem;
- um usuario conseguir criar um mapa visual completo;
- o mapa conseguir renderizar markdowns e assets locais sem IA;
- a IA conseguir analisar o mapa e sugerir lacunas;
- o usuario conseguir gerar milestones a partir do mapa renderizado;
- o painel de milestones substituir o espaco de contratos na UI principal;
- cada milestone conseguir ser executada isoladamente;
- validacoes e commits ficarem ligados a milestones;
- o botao Executar continuar funcionando como prova local;
- o painel Git continuar sendo o lugar de stage/commit/rollback/deploy;
- o chat passar a operar com contexto ativo de mapa ou milestone.

## 18. Norte de produto

O Faber Code deve se diferenciar por uma ideia simples e forte:

> Antes de pedir para a IA construir, o usuario desenha o raciocinio da aplicacao. O Faber transforma esse raciocinio em documentacao local, organiza em milestones e guia a implementacao com evidencias reais.

Essa mudanca resolve uma fragilidade comum em IDEs com IA: elas sao boas em responder prompts, mas ruins em manter uma representacao visual e operacional do produto que esta nascendo.

O Mapa da Aplicacao vira o lugar onde o usuario pensa.
As Milestones viram o lugar onde o projeto anda.
O Git vira a memoria verificavel.
O Executar vira a prova.
O chat vira o colaborador que entende tudo isso.
