# Faber Code: Status Tecnico do Tutorial e Onboarding

Data: 2026-07-04

## Escopo deste documento

Este markdown registra especificamente o estado do tutorial guiado da aplicacao, com foco em:

- sidebar e criacao de projeto;
- abertura do mapa da aplicacao;
- colapso de paineis laterais;
- hover nas ferramentas do mapa;
- configuracao guiada de API no modal de configuracoes.

## Fluxo tutorial implementado

### 1. Sidebar e projeto

Arquivos:

- `renderer/project_sidebar.js`
- `renderer/app_projects.js`

Comportamentos adicionados:

- suporte a projetos sinteticos de tutorial na lista lateral;
- ativacao do header do projeto por click e teclado;
- clique do botao de mapa sempre tenta selecionar projeto e abrir diretamente a aba de mapa;
- `ensureMapTabVisible()` reforca a abertura do mapa com multiplas tentativas e verificacao de aba/regiao.

Objetivo:

- eliminar o bug em que o usuario precisava clicar mais de uma vez para abrir o mapa do projeto no onboarding.

### 2. Tutorial vivo

Arquivos:

- `renderer/progressive_disclosure.js`
- `renderer/styles/progressive-disclosure.css`

Comportamentos adicionados:

- spotlight, cursor guiado e card de instrucao por etapa;
- reposicionamento dinamico do card de tutorial para evitar conflito visual com modal;
- prioridade visual acima de overlays do shell e do modal de configuracoes;
- etapas especificas para paineis, tools, cortex, APIs, projeto e mapa.

### 3. Configuracao guiada de API

Arquivos:

- `renderer/progressive_disclosure.js`
- `renderer/ai_settings_controller.js`
- `renderer/ai_settings_elements.js`
- `renderer/index.html`

Sequencia pretendida:

1. abrir configuracoes;
2. abrir a secao de APIs;
3. escolher um servico no seletor;
4. clicar em `Adicionar API`;
5. preencher automaticamente o campo `Servico` com o nome escolhido;
6. preencher automaticamente uma chave fake de exemplo;
7. clicar em `Salvar edicao`;
8. clicar em `Salvar` no modal principal;
9. fechar configuracoes e seguir para o proximo passo do tutorial.

Instrumentacao tecnica criada:

- `data-provider`, `data-kind` e `data-ai-settings-action` nos itens e botoes do painel de APIs;
- estado interno no tutorial para:
  - servico selecionado;
  - chave fake gerada;
  - editor salvo;
  - fechamento do modal;
- scroll automatico do corpo do modal para o campo de chave, `Salvar edicao` e `Salvar`;
- geracao de chave fake no formato `sk-faber-...` com letras e numeros;
- preservacao dos valores digitados no fluxo de API para nao apagar antes do save final.

## Estado atual

### O que ja esta enderecado no codigo

- tutorial nao edita a API real ativa do usuario;
- tutorial usa a escolha do servico feita no seletor para preencher o campo `Servico`;
- tutorial sobe visualmente acima do modal;
- tutorial tenta preencher a chave fake sozinho;
- tutorial observa o fechamento do modal de APIs para avancar a etapa.

### O que ainda precisa de validacao manual

- confirmar se a digitacao da chave fake aparece de forma consistente no Electron real;
- confirmar se o `Salvar` final do modal dispara o fechamento real e o avancar do tutorial sem travar;
- confirmar se o card do tutorial ficou legivel na frente do lightbox em todas as resolucoes usadas pelo time.

## Sinais de risco conhecidos

- o renderer do tutorial usa muitos re-renders contextuais; qualquer repaint inesperado durante o passo de API pode interromper a animacao;
- o save final depende do fechamento real do modal, entao qualquer erro de persistencia no painel de APIs pode segurar o avancar do tutorial;
- como o worktree ainda esta aberto, mudancas em `renderer/app.js`, `renderer/index.html` e `renderer/ai_settings_controller.js` podem influenciar esse fluxo.

## Proxima validacao recomendada

Rodar manualmente este roteiro:

1. iniciar o tutorial desde o passo de configuracoes;
2. abrir APIs;
3. selecionar `DeepSeek` ou outro provedor;
4. observar preenchimento automatico de `Servico` e `API Key`;
5. clicar em `Salvar edicao`;
6. clicar em `Salvar`;
7. confirmar que o modal fecha e o tutorial vai para o mapa da aplicacao.
