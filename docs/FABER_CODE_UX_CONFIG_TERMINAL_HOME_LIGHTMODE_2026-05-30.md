# Faber Code - UX de configuracoes, terminal, home e modo claro - 2026-05-30

Este documento registra a rodada local de UX feita apos as observacoes numeradas de 1 a 13 sobre configuracoes, Terminal, tela inicial, Executar, fluxo de iniciar conversa e modo claro.

Nao houve deploy publico, empacotamento ou publicacao externa nesta rodada.

## Objetivo

Melhorar a experiencia percebida antes de voltar ao funcionamento interno da ferramenta:

- tornar o menu de configuracao mais legivel e intuitivo;
- transformar o Terminal em uma superficie simples de CLI, abrindo em lightbox tambem no layout recolhido;
- evitar que `Iniciar conversa` no painel central abra o seletor quando ja existe projeto selecionado;
- trocar o icone de Executar para play e simplificar o loader;
- adicionar tooltips globais depois de 2 segundos sobre icones;
- remover os dois cards grandes da home, mantendo o logo central e uma frase filosofica rotativa por idioma;
- remover a configuracao livre de layout da area de trabalho;
- exibir o titulo da conversa ativa no topo da sessao central;
- permitir editar o titulo da conversa clicando diretamente no titulo central;
- remover definitivamente a frase bloqueada "A vida nao examinada..." em todos os idiomas;
- garantir que a frase da home mude a cada abertura sem repetir o autor anterior;
- revisar contrastes e superficies do modo claro em paineis, ferramentas e lightboxes.

## Arquivos principais

- `renderer/index.html`
- `renderer/app.js`
- `renderer/i18n.js`
- `renderer/hover_tooltips.js`
- `renderer/welcome_quotes.js`
- `renderer/welcome_project_modal.js`
- `renderer/project_terminal.js`
- `renderer/project_tools.js`
- `renderer/app_projects.js`
- `cortex/providers/runtime_settings.js`
- `main/ipc/ai_handlers.js`
- `renderer/styles/core.css`
- `renderer/styles/settings.css`
- `renderer/styles/system-shell.css`
- `renderer/styles/workspace-tools.css`
- `tests/renderer-welcome-quotes.test.js`
- `tests/renderer-app-projects.test.js`
- `tests/renderer-welcome-project-modal.test.js`
- `tests/renderer-module-contract.test.js`
- `tests/runtime-settings.test.js`
- `tests/ai-handlers.test.js`
- `tests/window-chrome-css.test.js`

## Mudancas implementadas

### Configuracoes

O painel inicial de configuracoes deixou de ser uma lista pesada de blocos semelhantes e passou a usar cards menores em grid, com icone, categoria curta e descricao. A estrutura ficou mais escaneavel e manteve as traducoes em portugues, ingles e espanhol.

### Terminal

O Terminal agora abre em um lightbox proprio com foco de CLI. A sessao continua existindo ao fechar o painel visual, e o mesmo fluxo funciona no layout expandido ou recolhido. A intencao e permitir que programadores usem o Terminal sem disputar espaco com informacoes de IA, Git ou arquivos.

### Inicio de conversa

O botao central `Iniciar conversa` agora tenta iniciar diretamente no projeto ja selecionado. O seletor de projeto continua como fallback quando nao existe projeto selecionado, preservando o fluxo antigo apenas quando ele realmente e necessario.

### Executar

O icone da ferramenta Executar foi trocado para play. O loader ficou minimalista: a barra usa branco durante o carregamento e so fica verde quando a etapa chega a 100%.

### Tooltips

Foi adicionado um controlador global de tooltips para botoes iconicos. Ele reaproveita `title`, `data-tooltip` e `aria-label`, remove o tooltip nativo duplicado e mostra a legenda apos 2 segundos de hover.

### Home

Os dois cards grandes que ficavam na frente do logo foram removidos da composicao principal. O logo permanece centralizado, com animacao `fade in up`, e abaixo dele aparece uma frase filosofica em italico com autor. A frase respeita o idioma configurado (`pt-BR`, `en-US`, `es-ES`) e troca por abertura.

O texto da frase ganhou animacao de escrita apos a entrada do logo, com cursor temporario e autor aparecendo ao final. O tamanho do texto foi aumentado em 25% em relacao a versao compacta anterior.

A frase bloqueada "A vida nao examinada nao vale a pena ser vivida." foi removida do pool em portugues, ingles e espanhol. A busca final no repositorio nao encontrou as variantes bloqueadas.

O seletor de frases usa RNG, mas evita repetir o autor da abertura anterior. Para isso, o ultimo autor exibido agora e persistido em `ai-runtime-settings.json` via `welcomeQuoteLastAuthor`, alem do fallback em `localStorage`. Um bug descoberto no smoke foi corrigido: `Number(null)` transformava storage vazio em indice `0`, o que podia fixar a primeira frase no boot.

O documento enviado pelo usuario continua sendo a referencia editorial pretendida para ampliar o pool de frases:

```text
Arquivo local de frases trilingues fornecido pelo usuario durante o smoke.
```

### Modo claro

Foram revisados contrastes e superficies de:

- home;
- configuracoes;
- barra direita de ferramentas;
- lightbox do Terminal;
- lightbox de projetos recolhido;
- cards de Git/Executar;
- tooltips;
- itens de conversa e projeto.

### Rodada complementar

Depois da revisao visual, a configuracao livre de layout foi removida das configuracoes e do onboarding. Preferencias antigas de modo/slots/dock sao neutralizadas no boot, preservando apenas o estado de paineis recolhidos.

A home passou a ficar somente com logo e frase, sem botoes de iniciar conversa ou novo projeto. O topo da sessao central agora mostra o titulo da conversa ativa quando houver uma conversa selecionada.

Na rodada final, o titulo central tambem passou a ser editavel no proprio topo: ao clicar no titulo, ele vira um campo inline com selecao do texto atual. `Enter` salva, blur salva quando o valor mudou, e `Escape` cancela sem alterar. A persistencia reutiliza a rota de renomear conversa ja existente no controller de projetos.

O modo claro recebeu overrides finais para o fundo da aplicacao e para o icone `+` do botao de novo projeto, evitando que CSS legado com `!important` mantenha areas escuras.

## Testes executados

```text
node -c renderer/hover_tooltips.js
node -c renderer/welcome_quotes.js
node -c renderer/project_terminal.js
node -c renderer/project_tools.js
node -c renderer/app.js
node -c renderer/app_projects.js
node -c cortex/providers/runtime_settings.js
node -c main/ipc/ai_handlers.js
node tests/renderer-module-contract.test.js
node tests/window-chrome-css.test.js
node tests/renderer-project-tools.test.js
node tests/renderer-ai-settings.test.js
node tests/renderer-welcome-project-modal.test.js
npm run test:renderer-welcome-quotes
npm run test:renderer-app-projects
npm run test:renderer-welcome-project-modal
node tests/runtime-settings.test.js
node tests/ai-handlers.test.js
node tests/renderer-workspace-layout-preferences.test.js
node tests/renderer-workspace-layout-runtime.test.js
node tests/renderer-app-conversations.test.js
rg -n "A vida nao examinada|The unexamined life|La vida no examinada|unexamined|not worth living|vale a pena ser vivida|vale la pena ser vivida" .
git diff --check
```

Resultado: todos passaram.

## Smoke visual

Capturas validadas antes e depois do reinicio do Electron:

```text
/private/tmp/faber-ux-welcome-quote-light.png
/private/tmp/faber-ux-settings-light-smoke.png
/private/tmp/faber-ux-after-login-home-light.png
/private/tmp/faber-ux-project-lightbox-light.png
/private/tmp/faber-ux-terminal-lightbox-light.png
/private/tmp/faber-ux-executar-loader-light.png
/private/tmp/faber-ux-settings-after-login-light.png
/private/tmp/faber-ux-conversation-title-light.png
/private/tmp/faber-ux-settings-no-layout-light.png
/private/tmp/faber-welcome-quote-kierkegaard-smoke.png
```

O smoke visual confirmou:

- home clara com logo central, frase em italico e acoes menores;
- configuracoes em modo claro com grid mais legivel;
- painel de aparencia acessivel a partir das configuracoes.
- lightbox de projetos em modo claro com nomes e acoes legiveis;
- clique no cabecalho do projeto recolhido expandindo conversas sem abrir o projeto;
- clique em conversa abrindo o projeto e fechando o lightbox;
- Terminal abrindo como lightbox claro e executando comando pelo proprio botao de CLI;
- Executar abrindo pelo icone de play, preparando preview local e marcando 100% em verde;
- status de execucao local exibido no chat apos o preview;
- tela de configuracoes e painel Aparencia legiveis no modo claro.
- configuracoes sem card/painel de layout livre;
- titulo da conversa ativa visivel no topo da sessao central em modo claro;
- fundo claro da aplicacao e icone `+` legivel no botao de novo projeto.
- titulo central clicavel abrindo campo inline de edicao e `Escape` cancelando sem alterar;
- frase da home com texto maior e sem os botoes antigos;
- frase bloqueada ausente do pool e do repositorio;
- reinicio do Electron exibindo autor diferente da abertura anterior: Seneca seguido por Soren Kierkegaard no smoke final.

Depois da ultima correcao de contraste no lightbox de projetos, o Electron foi reiniciado para carregar o CSS real. O app inicialmente caiu no gate de login Google, mas o usuario autorizou o uso da conta Google para os testes. O login foi concluido no Chrome com sucesso e o smoke manual final foi retomado no app autenticado.

Depois da correcao final no seletor de frases, o Electron foi reiniciado em loop mais duas vezes. A primeira abertura exibiu Seneca, persistiu o autor nas settings do runtime e a segunda abertura exibiu Soren Kierkegaard. Esse smoke confirmou a regra de nao repetir o autor anterior entre aberturas.

## Limites restantes

- Validar tooltips por hover real prolongado quando houver uma ferramenta de automacao com suporte confiavel a hover; o contrato esta coberto por teste e estilos.
- O loader branco durante progresso intermediario e o verde final foram cobertos por CSS/teste; no smoke manual visual a captura ficou no estado final 100% porque o fluxo concluiu rapido.
- Ampliar o pool completo de frases diretamente a partir do Markdown enviado quando o arquivo estiver disponivel no caminho local com nome legivel pelo shell.
