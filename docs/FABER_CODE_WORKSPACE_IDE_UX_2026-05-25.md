# Faber Code - Workspace, IDE UX e Paineis 2026-05-25

Este documento registra as atualizacoes feitas na experiencia visual da plataforma Faber Code como workspace configuravel e futura IDE completa.

## Problema diagnosticado

O fluxo anterior era util para chat central, mas ainda nao parecia uma IDE completa. O usuario precisava de mais controle sobre:

- paineis laterais;
- area central;
- terminal;
- arquivos;
- chat;
- automacoes;
- preferencias de primeira experiencia;
- organizacao visual do workspace.

Tambem foram identificados problemas de UX quando paineis eram recolhidos, quando o centro desaparecia ou quando a configuracao nao refletia no layout final.

## Objetivo da correcao

Criar uma base modular para workspace configuravel, com preferencias persistentes e separacao clara entre configuracao, montagem visual e runtime.

## Modulos criados

- `renderer/workspace_layout_preferences.js`
- `renderer/workspace_layout_builder.js`
- `renderer/workspace_layout_runtime.js`
- `renderer/styles/workspace-layout.css`

## Modulos ajustados

- `renderer/index.html`
- `renderer/app.js`
- `renderer/app_state.js`
- `renderer/project_terminal.js`
- `renderer/ai_settings_controller.js`
- `renderer/ai_settings_elements.js`
- `renderer/styles.css`
- `renderer/styles/settings.css`
- `renderer/styles/system-shell.css`
- `renderer/styles/workspace-tools.css`
- `renderer/styles/README.md`

## Decisoes de UX

### Primeira experiencia

A escolha entre modo `Chat central` e modo `IDE programador` deve ser progressive disclosure, ou seja, aparecer como decisao inicial quando fizer sentido para o primeiro uso, nao como atrito repetido em toda abertura do app.

A preferencia deve ficar salva localmente.

### Paineis recolhiveis

O recolhimento de painel deve liberar espaco sem quebrar a area central.

Estado desejado:

- se a lateral esquerda recolher, o centro continua visivel;
- se a lateral direita recolher, o centro continua visivel;
- se os dois lados recolherem, a area central continua sendo a experiencia principal;
- a restauracao deve ser feita por icone pequeno e claro, nao por abas verticais pesadas.

### Workspace configuravel

As configuracoes passaram a preparar uma area de montagem do painel, com ferramentas posicionaveis:

- Projetos;
- Chat;
- Arquivos;
- Terminal;
- Automacoes;
- Cortex.

A primeira versao estabelece a base visual e de estado para evoluir depois para drag and drop completo.

### Terminal

O terminal deve evoluir para uma experiencia mais proxima de IDE profissional, com:

- area legivel;
- controles previsiveis;
- possibilidade de ocupar regiao configuravel;
- relacao clara com projeto ativo;
- base para automacoes de comandos.

### Automacoes

Foi documentada e preparada a direcao para automacoes rapidas criadas manualmente ou via chat, como:

- Git status;
- Pre-smoke;
- Commit guiado;
- comandos de terminal agrupados.

A automacao completa ainda deve evoluir em etapa posterior.

## Contrato modular

A evolucao de UI deve respeitar:

- preferencias em modulo proprio;
- construcao de layout em modulo proprio;
- runtime de interacao em modulo proprio;
- estilos em arquivo dedicado;
- `app.js` apenas como orquestrador, nao como deposito de regras complexas.

## Criterios de aceite

- Preferencias devem persistir.
- Configuracoes devem refletir no layout.
- Paineis recolhidos nao podem apagar a area central.
- Area central deve manter fallback com marca/estado inicial.
- Terminal deve ser configuravel como parte do workspace.
- Novos ajustes de UI devem continuar separados por modulo.
