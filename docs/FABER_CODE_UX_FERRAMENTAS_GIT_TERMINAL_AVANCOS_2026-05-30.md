# Faber Code - Avancos de UX, ferramentas, Git e Terminal - 2026-05-30

Este documento registra a rodada de evolucao local feita depois do marco V1 de 2026-05-29.

Importante: esta rodada ainda nao representa deploy publico, release empacotado ou publicacao externa. O foco foi melhorar o uso real do app desktop apos testes manuais com o projeto Tremn e com o workspace do Faber Code.

## Contexto da rodada

Depois do Faber Code criar seu primeiro site real multipagina e aplicar uma primeira alteracao incremental real, os testes no app revelaram problemas de UX e operacao:

- o usuario nao conseguia perceber bem quais arquivos tinham sido alterados;
- a lista de arquivos precisava mostrar deltas, contadores e linhas alteradas;
- a barra esquerda recolhida repetia icones de projeto e abria o projeto antes da conversa;
- a barra direita recolhida ainda nao seguia o mesmo padrao visual da esquerda;
- o Cortex estava poluido com informacoes tecnicas demais para uma acao simples de adicionar markdowns;
- conversas antigas abriam no topo, nao nas mensagens recentes;
- a tela de Git estava grande demais no fluxo de ativar repositorio;
- o clique em GitHub sem repositorio local ativo deixava o usuario preso em lightbox;
- o Terminal precisava ser mais confortavel para uso real;
- o fluxo Executar precisava continuar claro para projetos estaticos e ser validado tambem contra um projeto Next.js.

A correcao seguiu o loop solicitado:

```text
Teste -> Correcao -> smoke visual como usuario -> screenshot -> novo teste -> nova correcao -> novo smoke
```

## Estado inicial observado

- Ultimo commit confirmado antes desta rodada: `3cf75a1 Marca V1 com site real e edicao visual`.
- O worktree ja continha alteracoes locais acumuladas de rodadas anteriores.
- Nao houve deploy publico.
- O projeto usado no smoke principal continuou sendo o site Tremn em `/private/tmp/faber-tremn-ui-smoke`.

## Avancos implementados

### 1. Barra esquerda recolhida

Arquivos principais:

- `renderer/index.html`
- `renderer/project_sidebar.js`
- `renderer/styles/workspace-layout.css`
- `tests/renderer-project-sidebar.test.js`
- `tests/window-chrome-css.test.js`

Mudancas:

- a barra recolhida passou a mostrar um unico botao de projetos, com icone de caixa;
- o clique nesse botao abre um mini menu lightbox com a lista vertical de projetos;
- no lightbox recolhido, clicar no cabecalho do projeto apenas expande ou recolhe as conversas;
- o projeto so abre quando o usuario seleciona uma conversa;
- os icones de pasta ficam reservados para o modo expandido, evitando repeticao visual no modo recolhido;
- o menu fecha ao selecionar uma conversa ou clicar fora.

Smoke visual confirmado:

- o cabecalho de `FABER-TREMN-UI-SMOKE` expandiu conversas sem abrir o projeto;
- a conversa selecionada abriu o projeto e fechou o lightbox.

Evidencias:

```text
/private/tmp/faber-left-rail-expand-no-select-smoke.png
/private/tmp/faber-left-rail-conversation-select-smoke-2.png
```

### 2. Barra direita e ferramentas inferiores

Arquivos principais:

- `renderer/index.html`
- `renderer/project_tools.js`
- `renderer/styles/workspace-layout.css`
- `renderer/styles/workspace-tools.css`
- `tests/window-chrome-css.test.js`

Mudancas:

- a barra direita recolhida passou a seguir a mesma logica visual da esquerda;
- os botoes inferiores foram reorganizados como ferramentas de trabalho:
  - Git;
  - Terminal;
  - Contratos;
  - Executar;
- ferramentas abrem em superficie dedicada/lightbox quando necessario;
- os botoes recolhidos ficam mais proximos da linguagem visual da barra esquerda.

### 3. Git como ferramenta operacional

Arquivos principais:

- `main/services/git_service.js`
- `main/ipc/project_handlers.js`
- `main.js`
- `preload.js`
- `renderer/project_tools.js`
- `renderer/project_file_editor.js`
- `tests/git-service.test.js`
- `tests/ipc-handlers.test.js`
- `tests/preload-api-contract.test.js`
- `tests/renderer-project-tools.test.js`

Mudancas:

- o Git deixou de ser apenas entrada para GitHub;
- a ferramenta agora le o worktree local e organiza:
  - status;
  - arquivos alterados;
  - stage;
  - commit;
  - GitHub normal/avancado;
- foi adicionada acao de ativar repositorio local com `git init`;
- quando o repositorio ainda nao esta ativo, a tela de ativacao ficou compacta e minimalista;
- se o usuario clica em GitHub antes do Git local estar ativo, o lightbox fecha e o app orienta a ativar Git local antes;
- status mostra resumo de diff por arquivo;
- cada item pode exibir linha, total de adicoes/remocoes, resumo textual e trechos `+`/`-`;
- o clique no arquivo abre o editor na linha alterada ou proxima dela;
- arquivos novos recebem resumo explicito de "Arquivo novo no projeto".

Smoke visual confirmado:

- Git exibiu diff descritivo com linha 64 em `.faber/memory/project.jsonl`;
- o clique no arquivo abriu o editor ja na regiao da linha 64;
- a lista mostrou trechos adicionados e resumo em vez de apenas nome do arquivo.

Evidencias:

```text
/private/tmp/faber-git-diff-preview-smoke.png
/private/tmp/faber-git-open-line-64-smoke.png
```

Limite observado:

- tentei reproduzir visualmente o caso "sem repositorio Git local" usando os projetos existentes, mas ambos os projetos de smoke ja estavam com Git ativo. A regra de fechamento do lightbox e aviso ao usuario foi coberta no codigo e em testes focados.

### 4. Lista de arquivos com deltas mais claros

Arquivos principais:

- `renderer/project_file_tree.js`
- `main/ipc/project_handlers.js`
- `main/services/git_service.js`
- `renderer/styles/workspace-tools.css`

Mudancas:

- a lista de arquivos passou a combinar estatisticas de runtime e Git;
- cada arquivo pode exibir adicoes em verde, remocoes em vermelho e linha inicial de alteracao;
- o botao do arquivo usa a linha alterada como destino no editor;
- o resumo superior mostra quantidade total de arquivos alterados e delta acumulado.

### 5. Registro pratico acima da barra do chat

Arquivos principais:

- `renderer/index.html`
- `renderer/chat_composer.js`
- `renderer/job_progress.js`
- `renderer/styles/state-surfaces.css`
- `renderer/styles/legacy/04-composer-projects.css`

Mudancas:

- foi adicionada uma faixa de resumo de alteracoes acima do composer;
- o app passou a ter uma apresentacao mais pratica de arquivos alterados depois das execucoes;
- o progresso de trabalho ganhou narrativa mais legivel para o usuario acompanhar o que o sistema esta fazendo.

### 6. Conversas abrem nas mensagens recentes

Arquivo principal:

- `renderer/app_conversations.js`

Mudanca:

- ao renderizar uma conversa ativa ou nova mensagem, o scroll para o fim agora acontece depois da renderizacao do painel de boas-vindas, evitando que a conversa fique presa no topo.

### 7. Cortex simplificado para markdowns e referencias

Arquivos principais:

- `renderer/index.html`
- `renderer/styles/cortex.css`
- `renderer/cortex_controller.js`
- `tests/renderer-cortex-controller.test.js`
- `tests/window-chrome-css.test.js`

Mudancas:

- o modal do Cortex passou a priorizar "Adicionar ao Cortex" e "Biblioteca";
- o texto agora orienta salvar markdowns, decisoes e referencias;
- a biblioteca ficou focada em buscar markdowns e notas;
- `Context Frame` e `Regras ativas` continuam disponiveis para o codigo, mas ficam escondidos da UX primaria;
- o chat log do Cortex fica oculto ate existir uma acao real para reportar.

### 8. Terminal mais confortavel

Arquivos principais:

- `renderer/project_terminal.js`
- `renderer/styles/workspace-tools.css`

Mudancas:

- o terminal ganhou area maior e visual menos comprimido;
- controles de abas, limpar, interromper, minimizar e fechar foram mantidos;
- `createTab` passou a ser exposto pelo controller;
- o comando pode ser executado diretamente pelo painel.

Smoke visual confirmado:

- o Terminal foi aberto pela ferramenta inferior;
- o comando `pwd` foi executado no painel;
- o output apareceu dentro do terminal.

Evidencia:

```text
/private/tmp/faber-terminal-ux-smoke.png
```

### 9. Executar com progresso e cobertura Next.js

Arquivos principais:

- `renderer/project_tools.js`
- `renderer/styles/workspace-tools.css`
- `tests/project-preview-service.test.js`
- `tests/project-preview-runtime-service.test.js`

Mudancas:

- a ferramenta Executar mostra estado de preparacao com progresso;
- o runtime de preview foi validado para fluxo de servidor;
- os testes criam fixtures temporarias para cobrir comportamento Next.js-like, incluindo plano de comando e readiness.

### 10. Preloader e tela inicial

Arquivos principais:

- `renderer/startup_preloader.js`
- `renderer/styles/preloader-critical.css`
- `renderer/styles/core.css`
- `tests/renderer-startup-preloader.test.js`
- `tests/window-chrome-css.test.js`

Mudancas:

- o preloader passou a iniciar animacao do logo em runtime;
- o app aguarda a animacao do logo pelo menos uma vez antes de esconder o preloader;
- a tela inicial reposiciona o logo no centro visual;
- as acoes iniciais ficam abaixo do logo, sem puxar a marca para o topo.

## Validações executadas nesta rodada

Comandos focados que passaram:

```bash
node tests/renderer-project-sidebar.test.js
node tests/git-service.test.js
node tests/renderer-project-tools.test.js
node tests/project-preview-service.test.js
node tests/project-preview-runtime-service.test.js
node tests/window-chrome-css.test.js
node tests/renderer-module-contract.test.js
node -c renderer/project_sidebar.js
node -c renderer/project_tools.js
node -c renderer/project_file_editor.js
node -c main/services/git_service.js
git diff --check
```

Validacoes visuais feitas como usuario no app desktop:

- login no app;
- abertura do menu de projetos recolhido;
- expansao de projeto sem abrir conversa;
- selecao de conversa para abrir projeto;
- abertura da ferramenta Git;
- leitura de diff com linha e resumo;
- clique em arquivo alterado abrindo editor perto da linha modificada;
- abertura do Terminal;
- execucao de comando simples no terminal.

## Evidencias visuais da rodada

```text
/private/tmp/faber-left-rail-expand-no-select-smoke.png
/private/tmp/faber-left-rail-conversation-select-smoke-2.png
/private/tmp/faber-git-diff-preview-smoke.png
/private/tmp/faber-git-open-line-64-smoke.png
/private/tmp/faber-terminal-ux-smoke.png
```

## Limites restantes

- O fluxo GitHub normal/avancado ainda precisa de smoke completo com um repositorio real escolhido pelo usuario.
- O caso visual de "projeto sem Git local" nao foi reproduzido nos projetos existentes porque ambos estavam com Git ativo.
- A ferramenta Executar foi validada com testes de fixture Next.js-like; ainda vale fazer um smoke real criando um projeto Next.js pelo app quando o usuario quiser essa bateria.
- Ainda nao houve deploy publico.
- O worktree estava sujo antes desta rodada; este documento descreve a consolidacao local antes do commit solicitado pelo usuario.

## Proximo passo natural

Depois do commit desta rodada, o proximo passo recomendado e continuar o loop real no app com:

- um ajuste incremental visual novo no site Tremn;
- um projeto Next.js real criado pelo app;
- uso completo de Git: status, stage, commit e fluxo GitHub;
- smoke mobile/tablet quando houver mudanca em blueprint ou UI visual.
