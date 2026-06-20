# FABER CODE - Ajustes de Arquivos, Git e Rollback - 2026-06-19

Este documento registra a rodada focada em dois blocos do painel direito do Faber Code:

- estabilizacao do painel `Arquivos`, para manter os botoes inferiores fixos enquanto a arvore rola;
- evolucao do painel `Git`, incluindo historico completo de commits e rollback seguro por commit.

## Objetivo da rodada

Os testes visuais mostraram dois problemas de UX:

- no painel `Arquivos`, quando a arvore crescia demais, o usuario precisava rolar o painel para reencontrar os botoes inferiores;
- no painel `Git`, a secao `Committed` mostrava apenas o ultimo commit e nao permitia retorno controlado para commits anteriores.

O objetivo foi alinhar o comportamento do painel `Arquivos` ao mesmo padrao visual de `Milestones` e transformar `Committed` em uma area realmente operacional.

## 1. Painel Arquivos - rodape fixo e scroll interno

Arquivos principais:

- `renderer/styles/workspace-layout.css`
- `renderer/styles/workspace-tools.css`
- `renderer/project_file_tree.js`
- `renderer/project_tools.js`
- `renderer/project_terminal.js`
- `renderer/app_actions.js`
- `renderer/app_events.js`

### Problema observado

- a coluna direita ainda deixava a regiao de `Arquivos` crescer pela altura do conteudo;
- a arvore de arquivos empurrava o rodape de acoes para fora da area visivel;
- o usuario precisava rolar para reencontrar os botoes de `Arquivos`, `Git`, `Terminal`, `Milestones` e `Executar`.

### Solucao aplicada

- o shell da coluna direita passou a tratar `Arquivos` como a area flexivel principal;
- a arvore recebeu scroll interno proprio, em vez de fazer a coluna inteira rolar;
- o render da arvore foi encapsulado em `project-files-shell` e `project-files-scroll`;
- o rodape da coluna direita permaneceu fora da area scrollavel, mantendo os botoes sempre acessiveis;
- os modos `Arquivos`, `Git` e `Terminal` passaram a coordenar melhor a visibilidade do `workspace-files-region`, evitando residuos visuais entre ferramentas.

### Resultado esperado

- o usuario continua vendo os botoes da base mesmo com muitas pastas e arquivos abertos;
- so a arvore de arquivos rola;
- o painel `Arquivos` passa a se comportar de forma consistente com a referencia visual de `Milestones`.

## 2. Painel Git - historico completo em Committed

Arquivos principais:

- `main/services/git_service.js`
- `main/ipc/project_handlers.js`
- `preload.js`
- `main.js`
- `renderer/project_tools_git.js`

### Problema observado

- a secao `Committed` mostrava apenas o ultimo commit local;
- o app nao expunha uma leitura estruturada do historico completo do repositorio para o renderer;
- a inicializacao do Electron falhava quando o IPC exigia a dependencia `getProjectGitCommits` sem ela estar devidamente conectada em todas as camadas.

### Solucao aplicada

- foi criada a funcao `getProjectGitCommits(rootPath, limit)` no servico Git;
- o historico passou a ser exposto por IPC com `project:git:commits`;
- `preload.js` passou a publicar `getProjectGitCommits` para o renderer;
- `main.js` passou a injetar essa dependencia no registro dos handlers;
- `renderer/project_tools_git.js` passou a renderizar uma lista de commits em `Committed`, em vez de um unico resumo do ultimo commit.

### Resultado esperado

- a secao `Committed` mostra uma lista real de commits locais;
- cada card exibe assunto, hash curto, tempo relativo e autor;
- o crash de inicializacao causado pela dependencia ausente deixa de acontecer.

## 3. Rollback por commit com protecao

Arquivos principais:

- `main/services/git_service.js`
- `main/ipc/project_handlers.js`
- `preload.js`
- `main.js`
- `renderer/project_tools_git.js`
- `renderer/styles/workspace-tools.css`

### Requisito funcional

O painel `Git` precisava ganhar uma mecanica de rollback diretamente na secao `Committed`, aproveitando o historico que o usuario ja estava vendo.

### Solucao aplicada

- foi criada a acao `rollbackProjectGitToCommit(rootPath, commitHash)`;
- antes do rollback, a rotina verifica se a arvore esta limpa;
- quando ha alteracoes locais, o rollback por commit eh bloqueado para evitar perda acidental;
- antes do `git reset --hard`, a rotina cria automaticamente uma branch de backup com prefixo `rollback-backup/`;
- depois disso, o repositorio volta para o commit escolhido;
- o resultado volta para o renderer com informacoes como `backupBranch`, `previousHead` e `rolledBackToCommit`.

### Comportamento de interface

- o commit atual aparece marcado como `Atual`;
- commits anteriores exibem um botao compacto `Rollback`;
- o clique pede confirmacao explicita;
- em caso de sucesso, o painel avisa que o rollback foi concluido e informa a branch de backup criada.

### Motivacao de seguranca

Essa abordagem foi escolhida para evitar que o rollback do painel vire uma acao destrutiva silenciosa. O backup automatico cria um caminho claro de recuperacao se o usuario quiser voltar ao estado anterior.

## 4. Ajustes finos de UX no painel Git

Arquivos principais:

- `renderer/project_tools_git.js`
- `renderer/styles/workspace-tools.css`

### Refinamentos aplicados

- remocao do rotulo redundante `Git` ao lado do icone no resumo superior;
- compactacao do botao de rollback nos cards de commit;
- troca do texto de `Rollback aqui` para `Rollback`;
- destaque visual do commit atual com badge `Atual`.

## 5. Validacoes executadas

Validacoes tecnicas executadas durante a rodada:

- `node --check main/services/git_service.js`
- `node --check main/ipc/project_handlers.js`
- `node --check preload.js`
- `node --check main.js`
- `node --check renderer/project_file_tree.js`
- `node --check renderer/project_tools_git.js`
- `git diff --check`

## 6. Impacto funcional consolidado

Ao final desta rodada:

- o painel `Arquivos` deixa de empurrar os botoes inferiores para fora da tela;
- o usuario passa a navegar a arvore longa sem perder o rodape de ferramentas;
- o painel `Git` mostra o historico de commits local;
- rollback por commit passa a existir no proprio app, com confirmacao e branch de backup;
- o fluxo de inicializacao do Electron deixa de quebrar por falta da dependencia `getProjectGitCommits`.
