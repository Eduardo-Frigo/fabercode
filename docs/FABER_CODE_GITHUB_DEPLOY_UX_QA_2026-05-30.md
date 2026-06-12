# Faber Code - Registro da rodada Git, GitHub, onboarding e UX

Data inicial: 2026-05-30  
Atualizado em: 2026-05-31

## Objetivo

Melhorar a experiencia do Faber Code antes de voltar a mexer no motor da ferramenta, com foco em:

- clareza do login GitHub;
- fluxo Git/GitHub menos poluido;
- caminho simples para revisar arquivos novos/modificados, selecionar o que avanca, preparar stage, criar commit, enviar para GitHub e preparar deploy;
- tela inicial mais elegante e com frases multilíngues;
- correcoes de contraste no modo claro;
- documentacao e testes de regressao para manter o comportamento verificavel.

## Mudancas de conta e OAuth GitHub

- Adicionado login GitHub na tela de conta da plataforma.
- Incluido botao `Logar com GitHub` ao lado de e-mail e Google.
- Criado fluxo OAuth GitHub no backend local:
  - `account:github:start`;
  - `account:github:complete`;
  - callback HTTP `/auth/github/callback`.
- O runtime agora le:
  - `GITHUB_CLIENT_ID`;
  - `GITHUB_CLIENT_SECRET`;
  - `GITHUB_REDIRECT_URI`;
  - `GITHUB_SCOPES`.
- `.env.example` foi atualizado com as variaveis GitHub.
- Quando o OAuth GitHub nao esta configurado, a interface agora mostra uma mensagem acionavel:
  - quais variaveis faltam;
  - onde criar o OAuth App no GitHub;
  - qual callback usar;
  - que o Faber Code precisa ser reiniciado depois do `.env`.

Callback padrao:

```env
GITHUB_REDIRECT_URI=http://127.0.0.1:37418/auth/github/callback
```

## Diferenca entre OAuth e GitHub CLI

Foi explicitada uma separacao importante:

- OAuth GitHub: login de conta dentro do Faber Code.
- GitHub CLI (`gh`): permissao local para clonar, criar repositorios, dar push e publicar.

Isso evita a confusao em que o usuario esta logado no navegador, mas o app ainda nao consegue publicar pelo terminal local.

Comando padronizado para a conexao local:

```bash
gh auth login --hostname github.com --web
```

## GitHub CLI e operacoes de repositorio

Foram adicionadas integracoes para:

- detectar status de autenticacao do GitHub CLI;
- listar repositorios da conta conectada;
- clonar repositorios por `owner/repo`;
- importar automaticamente a pasta clonada como projeto do Faber Code;
- selecionar o projeto clonado quando a importacao termina;
- criar plano de publicacao com revisao antes de executar;
- publicar projeto no GitHub apenas depois da confirmacao do usuario.

O clone e a importacao usam protecoes de caminho para evitar que uma pasta arbitraria seja adicionada fora do contexto esperado.

## Painel Git/GitHub

O painel Git antigo estava pesado e dificil de entender. Ele foi reorganizado para um fluxo mais limpo, seguindo a ordem de trabalho real: revisar mudancas, selecionar arquivos, preparar stage, commitar, enviar ao GitHub e so entao publicar/deployar.

1. `Untracked`
2. `Modified`
3. `Staged`
4. `Committed`
5. `Deploy`

Principais ajustes:

- O painel abre como lightbox com subtitulo explicando o fluxo.
- A lista principal de arquivos agora usa linhas compactas.
- Previews grandes de diff foram removidos do fluxo principal.
- `Untracked` e `Modified` permitem selecionar arquivos e enviar para `Staged`.
- `Staged` concentra a criacao do commit e o campo de mensagem.
- `Committed` mostra o ultimo commit e, quando ha remoto GitHub, permite abrir o commit.
- `Deploy` aparece depois que existe commit e concentra GitHub, publicacao, repositorios e comandos.
- O logo miniatura do GitHub foi alinhado na base visual do painel.
- O icone do rail direito foi trocado para um icone correto de Git.
- O botao de publicar fica bloqueado quando a autenticacao local GitHub nao esta pronta.
- A listagem de repositorios fica bloqueada sem GitHub CLI autenticado.
- A area de comandos manuais fica recolhida para nao poluir a interface.

## Publicacao guiada

O fluxo `Publicar no GitHub` agora mostra uma revisao antes de qualquer operacao remota:

- estado da conta local;
- comando copiavel quando houver bloqueio;
- nome do repositorio editavel;
- controle `Privado`/`Publico`;
- botao `Revisar plano`;
- lista de acoes previstas;
- bloqueios claros antes de habilitar publicacao.

Nenhum repositorio e criado e nenhum push e disparado durante a revisao.

## Tela inicial e frases

Foram aplicadas melhorias no onboarding visual:

- removidos os botoes grandes abaixo do logo;
- logo central mantido como foco da primeira tela;
- frase abaixo do logo em italico com autor;
- frases carregadas de uma lista trilingue;
- selecao por idioma do app;
- a frase muda em novas aberturas evitando repetir o mesmo autor imediatamente;
- a frase proibida de Socrates foi removida em todos os idiomas;
- animacao de entrada do logo e escrita da frase;
- frases longas agora quebram em duas linhas equilibradas para nao estourar o painel.

## Modo claro e contraste

Foram revisados pontos que ainda herdavam baixo contraste no modo claro:

- lightbox de ferramentas;
- painel Git/GitHub;
- status do GitHub;
- campos de entrada;
- botoes primarios e secundarios;
- chips de contagem;
- linhas compactas de arquivos;
- painel de comandos;
- subtitulos de lightbox;
- tela de login de conta.

## Importacao de projetos

O backend de projetos ganhou uma funcao reaproveitavel para registrar pastas ja existentes:

- `projects:import-path`;
- validacao de existencia da pasta;
- restauracao de projeto arquivado/reutilizado quando o caminho ja existe;
- suporte ao clone GitHub selecionar o projeto importado.

## Arquivos principais alterados

- `.env.example`
- `main.js`
- `main/runtime/runtime_config.js`
- `main/services/platform_account_service.js`
- `main/services/platform_backend_service.js`
- `main/services/github_integration_service.js`
- `main/ipc/account_handlers.js`
- `main/ipc/github_handlers.js`
- `main/ipc/project_handlers.js`
- `preload.js`
- `renderer/index.html`
- `renderer/app.js`
- `renderer/account_gate.js`
- `renderer/project_tools.js`
- `renderer/welcome_quotes.js`
- `renderer/styles/account-gate.css`
- `renderer/styles/core.css`
- `renderer/styles/system-shell.css`
- `renderer/styles/workspace-tools.css`

## Testes e contratos atualizados

- `tests/account-handlers.test.js`
- `tests/github-integration-service.test.js`
- `tests/ipc-handlers.test.js`
- `tests/platform-account-service.test.js`
- `tests/platform-backend-service.test.js`
- `tests/preload-api-contract.test.js`
- `tests/renderer-account-gate.test.js`
- `tests/renderer-project-tools.test.js`
- `tests/renderer-welcome-quotes.test.js`

Coberturas adicionadas ou reforcadas:

- OAuth GitHub inicia e conclui sessao.
- Callback `/auth/github/callback` funciona.
- Preload expõe os novos metodos.
- CLI GitHub usa comando completo `gh auth login --hostname github.com --web`.
- Listagem e clone de repositorios funcionam via service.
- Importacao de projeto clonado passa pelo IPC.
- Painel Git preserva a ordem `Untracked -> Modified -> Staged -> Committed -> Deploy`.
- Tela de conta mostra instrucao de configuracao OAuth quando faltam secrets.
- Frases longas quebram em duas linhas.
- Frase bloqueada nao aparece na pool.
- CSS do modo claro cobre os novos elementos.

## Validacao executada

Checks automatizados:

```bash
node --check renderer/project_tools.js
node --check renderer/welcome_quotes.js
node --check renderer/account_gate.js
node --check main/services/platform_account_service.js
node tests/renderer-project-tools.test.js
node tests/renderer-welcome-quotes.test.js
node tests/renderer-account-gate.test.js
node tests/window-chrome-css.test.js
node tests/platform-account-service.test.js
node tests/account-handlers.test.js
node tests/github-integration-service.test.js
node tests/ipc-handlers.test.js
node tests/preload-api-contract.test.js
node tests/git-service.test.js
node tests/platform-backend-service.test.js
git diff --check
```

Todos passaram.

Smoke visual no Electron:

- app aberto via `npm run dev`;
- validada a tela inicial com logo central e frase quebrada em duas linhas;
- validado o painel Git em projeto real;
- confirmada a ordem `Untracked`, `Modified`, `Staged`, `Committed`, `Deploy`;
- confirmada lista compacta de arquivos;
- confirmado estado GitHub conectado com uma conta de teste do mantenedor;
- confirmada remocao do painel antigo com preview grande no fluxo principal.

## Guia rapido para configurar OAuth GitHub

1. No GitHub, abrir `Settings -> Developer settings -> OAuth Apps -> New OAuth App`.
2. Usar:
   - `Homepage URL`: `http://127.0.0.1:37418`
   - `Authorization callback URL`: `http://127.0.0.1:37418/auth/github/callback`
3. Copiar `Client ID` e gerar `Client Secret`.
4. Preencher no `.env`:

```env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_REDIRECT_URI=http://127.0.0.1:37418/auth/github/callback
GITHUB_SCOPES=read:user user:email repo
```

5. Reiniciar o Faber Code.
6. Clicar em `Logar com GitHub`.

Para publicar/clonar pelo painel Git, tambem conectar o GitHub CLI:

```bash
gh auth login --hostname github.com --web
```

## Resultado

A rodada deixou o fluxo Git/GitHub mais compreensivel para iniciantes sem bloquear usuarios tecnicos. O usuario agora entende:

- o que e arquivo novo ou modificado;
- o que foi escolhido para passar de etapa;
- o que ja esta pronto para commit;
- quando ha commit pronto;
- quando pode enviar para o GitHub;
- quando pode publicar;
- por que OAuth do app e GitHub CLI local sao autorizacoes diferentes.

O onboarding visual tambem ficou mais limpo, com logo, frase animada e quebra de linha controlada.

## Proximos passos recomendados

- Fazer uma rodada autenticada real de ponta a ponta: criar repositorio de teste, publicar e abrir deploy.
- Melhorar o texto do painel `Deploy` quando nao ha remoto configurado.
- Criar screenshots de referencia para regressao visual do modo claro e escuro.
- Avaliar se OAuth GitHub deve migrar futuramente para GitHub App com permissoes mais granulares.
