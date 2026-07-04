# Faber Code: Ponto Atual do Worktree

Data: 2026-07-04

## Resumo

Este ponto consolida um worktree grande com tres frentes principais:

1. onboarding guiado do aplicativo, com tutorial vivo no painel, criacao de projeto, abertura do mapa e fluxo de configuracao de API;
2. diagnostico de requisitos da maquina host e novas IPCs de sistema;
3. endurecimento do fluxo de update, politicas de URL e isolamento de variaveis sensiveis no runtime de projeto.

## Blocos entregues no worktree

### 1. Tutorial vivo e onboarding do painel

Arquivos centrais:

- `renderer/progressive_disclosure.js`
- `renderer/styles/progressive-disclosure.css`
- `renderer/project_sidebar.js`
- `renderer/app_projects.js`
- `renderer/ai_settings_controller.js`
- `renderer/ai_settings_elements.js`
- `renderer/index.html`
- `renderer/app.js`

Avancos principais:

- introducao de um controlador de tutorial com spotlight, cursor guiado, card de instrucao e passos contextualizados;
- inclusao de projetos de tutorial na sidebar sem misturar com a lista real do usuario;
- correcao do fluxo de abrir o mapa direto do card/projeto com tentativas extras para garantir a aba do mapa visivel;
- ampliacao do painel de configuracoes para reexecutar tutorial;
- instrumentacao do modulo de APIs com `data-*` e metadados para guiar cliques e estados do tutorial;
- criacao do fluxo de tutorial para configuracao de API nova, sem editar a API real ja ativa;
- reforco visual do tutorial com camada propria (`z-index`) e spotlight acima do modal de configuracoes.

Estado funcional esperado:

- o tutorial deve conduzir o usuario por configuracoes, APIs, criacao de projeto e mapa;
- o passo de API deve abrir o formulario, preencher servico e chave fake de exemplo e, ao salvar, seguir para a proxima etapa;
- o mapa deve abrir com um clique a partir do botao contextual do projeto.

Risco atual:

- o subfluxo final de salvar a API no tutorial ainda depende de validacao manual em Electron real, principalmente na transicao entre `Salvar edicao` e `Salvar` do modal.

### 2. Diagnostico da maquina host

Arquivos centrais:

- `main/ipc/system_handlers.js`
- `main/services/host_requirements_service.js`
- `main.js`
- `preload.js`
- `renderer/app.js`
- `renderer/index.html`
- `tests/system-handlers.test.js`
- `tests/host-requirements-service.test.js`

Avancos principais:

- nova service para levantar requisitos da maquina host;
- novas IPCs de sistema para leitura desses requisitos e abertura controlada de URLs externas;
- exposicao dessas capacidades no preload;
- pontos de integracao no renderer para consumo da checagem de host.

Objetivo tecnico:

- permitir que o app explique ao usuario o que falta no ambiente local antes de seguir com fluxos dependentes de Git, Node, terminais ou runtime local.

### 3. Endurecimento do update e seguranca operacional

Arquivos centrais:

- `main/ipc/update_handlers.js`
- `tests/update-handlers.test.js`
- `main/security/url_policy.js`
- `main/services/project_node_runtime_service.js`
- `tests/security.test.js`
- `package.json`

Avancos principais:

- validacao mais robusta de releases do GitHub;
- tokenizacao temporaria do fluxo de instalacao de update;
- validacao de host, tamanho maximo do DMG e checksum sha512;
- script de instalacao mais defensivo para update empacotado;
- ampliacao da allowlist de URLs externas;
- remocao de variaveis sensiveis do ambiente herdado por comandos de runtime de projeto, salvo opt-in explicito.

Impacto:

- reduz risco de update malformado ou asset adulterado;
- reduz vazamento acidental de chaves e segredos para processos de projeto.

### 4. Ajustes de UX e shell

Arquivos centrais:

- `main/ipc/project_handlers.js`
- `renderer/project_state_modal.js`
- `renderer/application_map_canvas.js`
- `renderer/app_actions.js`
- `renderer/cortex_controller.js`
- `renderer/i18n.js`

Avancos principais:

- `projects:add` agora aceita criacao de pasta no seletor nativo;
- melhorias de UX em pontos do shell e do renderer para acompanhar os novos fluxos de tutorial, mapa e requisitos locais.

## Testes e validacao

Validado localmente neste ponto:

- `node --check renderer/progressive_disclosure.js`

Testes adicionados ou tocados no worktree:

- `tests/update-handlers.test.js`
- `tests/system-handlers.test.js`
- `tests/host-requirements-service.test.js`
- ajustes em `tests/security.test.js`, `tests/ipc-handlers.test.js` e `tests/project-terminal.test.js`

Observacao:

- ainda falta smoke manual do onboarding completo no app Electron, com foco especial no passo de API do tutorial e no fechamento do modal de configuracoes.

## Handoff rapido

Se for retomar depois deste commit, revisar primeiro:

1. `renderer/progressive_disclosure.js`
2. `renderer/styles/progressive-disclosure.css`
3. `renderer/ai_settings_controller.js`
4. `main/ipc/update_handlers.js`
5. `main/services/host_requirements_service.js`

Perguntas de validacao pendentes:

- o tutorial mantem os valores fake preenchidos ate o usuario concluir o save?
- o clique em `Salvar` no modal de APIs fecha o modal e avanca o tutorial em ambiente real?
- a nova checagem de host esta clara o suficiente na UX do renderer?
