# Faber Code - QA exaustivo, correcoes e evidencias visuais

Data: 2026-05-30

Base inicial da rodada: `e41568c feat: improve GitHub and Git UX flows`

Contexto: bateria adversaria baseada no anexo `Plano de Testes de QA: Faber Code (Exaustivo)`.

## Objetivo da rodada

Executar uma bateria ampla de QA no Faber Code, corrigindo problemas encontrados no ciclo:

```text
Teste -> Correcao -> Smoke test como usuario -> validacao visual/screenshot -> Teste -> Correcao
```

O foco principal foi detectar problemas que usuarios reais poderiam encontrar em:

- Git/GitHub e publicacao;
- selecao entre etapas do fluxo Git;
- login Google/OAuth local;
- preview local;
- projetos grandes;
- nomes Unicode e arquivos binarios;
- seguranca de filesystem;
- smoke visual real no app Electron;
- regressao automatizada ampla.

## Resultado executivo

A rodada encontrou e corrigiu problemas reais em cinco areas principais:

1. O painel Git podia reabrir com uma etapa antiga expandida, incluindo `Deploy`, contrariando a expectativa de etapas recolhidas ate o clique.
2. O fluxo Git ainda permitia passagem implicita demais entre etapas; agora o usuario seleciona explicitamente o que passa para `Staged` e o que entra no commit.
3. Arquivos binarios untracked podiam aparecer como arquivo textual novo, sem aviso claro de que diff textual nao existe.
4. O preview local escolhia uma porta alternativa quando a porta preferida estava ocupada, mas alguns scripts ainda podiam usar `process.env.PORT` antigo.
5. O backend OAuth local podia falhar em restart rapido por `EADDRINUSE`, deixando o callback do Google inacessivel.

Tambem foram reforcados:

- contagem correta de projetos grandes com dezenas de milhares de arquivos;
- tratamento de caminhos Unicode no Git;
- estado visual de botoes primarios desabilitados;
- contrato de smoke para briefing vazio/continuacao;
- testes focados e suites amplas de regressao.

## Correcoes aplicadas

### 1. Git/GitHub recolhido ate clique

Antes:

- o painel Git podia preservar `openGitStepKey` entre aberturas;
- depois de interagir com `Deploy`, fechar e reabrir o Git podia mostrar `Deploy` expandido;
- isso deixava o final do projeto confuso, especialmente para usuario iniciante.

Depois:

- `renderGitTool({ resetOpenStep: true })` limpa a etapa aberta ao abrir o Git pelo rail;
- `publishToGithub()` tambem reinicia o estado aberto;
- cada etapa abre apenas quando o usuario clica;
- abrir uma etapa fecha as outras;
- a UI segue a ordem `Untracked -> Modified -> Staged -> Committed -> Deploy`.

Arquivos:

- `renderer/project_tools.js`
- `tests/renderer-project-tools.test.js`

### 2. Selecao explicita entre etapas Git

Antes:

- arquivos em `Untracked`/`Modified` eram inicialmente marcados;
- a acao visual podia induzir o usuario a enviar tudo para `Staged`;
- `Staged` nao dava controle fino sobre quais arquivos entrariam no commit.

Depois:

- arquivos comecam desmarcados;
- cada etapa mostra `0/N arquivo(s) selecionado(s)`;
- existem acoes `Selecionar tudo` e `Limpar selecao`;
- o botao de stage fica desabilitado ate haver selecao;
- em `Staged`, o commit tambem exige selecao explicita;
- o IPC de commit agora recebe a lista de arquivos selecionados.

Arquivos:

- `renderer/project_tools.js`
- `main/ipc/project_handlers.js`
- `tests/renderer-project-tools.test.js`
- `tests/ipc-handlers.test.js`

### 3. Botao primario desabilitado com aparencia correta

Durante o smoke visual, o botao `Enviar selecionados para Staged` estava tecnicamente desabilitado quando `0/1` arquivos estavam selecionados, mas ainda parecia verde e acionavel.

Depois:

- `.right-tool-action--primary:disabled` ganhou estado visual proprio;
- no modo escuro, o botao desabilitado fica apagado e sem destaque primario;
- no modo claro, o override tambem deixa o controle legivel e inativo.

Arquivos:

- `renderer/styles/workspace-tools.css`
- `renderer/styles/system-shell.css`

### 4. Git com Unicode e arquivos binarios

Antes:

- comandos de Git que retornavam paths podiam escapar nomes Unicode;
- arquivos binarios tracked eram detectados via `--numstat`, mas untracked binarios ainda podiam aparecer como "Arquivo novo";
- a UI nao tinha resumo compacto para explicar que diff textual nao estava disponivel.

Depois:

- comandos de path usam `-c core.quotepath=false`;
- `git_service` detecta binarios por `--numstat` e por leitura segura de bytes para untracked;
- arquivos binarios recebem resumo:

```text
Arquivo binario: diff textual indisponivel.
```

- a linha compacta do Git mostra o resumo de arquivo binario.

Arquivos:

- `main/services/git_service.js`
- `renderer/project_tools.js`
- `renderer/styles/workspace-tools.css`
- `renderer/styles/system-shell.css`
- `tests/git-service.test.js`
- `tests/renderer-project-tools.test.js`

### 5. Scanner de projeto grande

Antes:

- com limite de scan, o total de arquivos podia refletir apenas o subconjunto armazenado;
- um projeto com 50.001 arquivos podia parecer menor do que realmente era;
- isso atrapalhava UX, performance reporting e diagnostico de RAG/projeto grande.

Depois:

- `totalFiles` conta todos os arquivos nao ignorados;
- `scannedFiles` registra quantos entraram no sample;
- `truncated` indica quando houve corte pelo limite;
- os contadores continuam considerando o universo real do projeto.

Arquivos:

- `main/services/project_scanner.js`
- `tests/project-scanner.test.js`

### 6. Preview local com porta ocupada

Antes:

- o runtime escolhia uma porta alternativa quando a preferida estava ocupada;
- porem scripts genericos que leem `process.env.PORT` ainda podiam iniciar na porta antiga;
- resultado possivel: preview branco ou conflito silencioso.

Depois:

- o processo de preview recebe `PORT`, `HOST`, `FABER_PREVIEW_PORT` e `FABER_PREVIEW_HOST`;
- `PORT` e sobrescrito para a porta realmente selecionada;
- o smoke com porta 3000 ocupada passou usando 3001 e resposta HTTP 200.

Arquivos:

- `main/services/project_preview_runtime_service.js`
- `tests/project-preview-runtime-service.test.js`

### 7. OAuth Google com restart rapido

Durante o smoke manual, o login Google falhou uma vez porque o backend local tentou subir enquanto uma instancia anterior ainda prendia a porta `127.0.0.1:37418`. O Chrome chegava no callback, mas o servidor ja havia falhado, gerando `ERR_CONNECTION_REFUSED`.

Depois:

- `platform_backend_service` tenta novamente em `EADDRINUSE`;
- registra auditoria `platform_backend.start_retry`;
- aguarda a porta liberar antes de desistir;
- o smoke manual seguinte completou Google OAuth e destravou o app.

Arquivos:

- `main/services/platform_backend_service.js`
- `tests/platform-backend-service.test.js`

### 8. Contrato de smoke para briefing vazio/continuacao

Um smoke de produto esperava rota textual especifica antiga para o caso de continuacao de briefing. O contrato foi normalizado para a rota atual usada pela blueprint local.

Arquivo:

- `cortex/orchestration/project_blueprint_coverage_contract.js`

## Bateria adversaria executada

Foi executado um script local de QA criando cenarios controlados para:

- Git com Unicode e arquivo binario;
- projeto com 50.001 arquivos;
- preview estatico com `iframe`;
- preview com porta preferida ocupada;
- autorizacao de filesystem com caminho permitido e caminho bloqueado.

Resultado final:

```json
{
  "cases": [
    {
      "id": "QA-GIT-UNICODE-BINARY",
      "ok": true,
      "evidence": [
        {
          "path": "acao-unicode.txt",
          "binary": false,
          "summary": "Arquivo novo no projeto"
        },
        {
          "path": "image.bin",
          "binary": true,
          "summary": "Arquivo binario: diff textual indisponivel."
        }
      ]
    },
    {
      "id": "QA-PERF-50000-FILES",
      "ok": true,
      "evidence": {
        "totalFiles": 50001,
        "scannedFiles": 800,
        "scannedLimit": 800,
        "truncated": true,
        "scanMs": 299,
        "stacks": ["React"]
      }
    },
    {
      "id": "QA-PREVIEW-IFRAME-FILE",
      "ok": true,
      "evidence": {
        "mode": "file",
        "url": "file:///.../iframe-preview/index.html"
      }
    },
    {
      "id": "QA-PREVIEW-PORT-OCCUPIED",
      "ok": true,
      "evidence": {
        "requested": 3000,
        "selected": 3001,
        "status": "ready",
        "message": "Preview HTTP respondeu com status 200.",
        "url": "http://127.0.0.1:3001/"
      }
    },
    {
      "id": "QA-SECURITY-FILESYSTEM-SCOPE",
      "ok": true,
      "evidence": {
        "allowed": true,
        "blocked": false,
        "blockedMessage": "Caminho invalido."
      }
    }
  ],
  "failed": []
}
```

## Smoke visual manual como usuario

O smoke visual foi feito no app Electron real, via UI, sem usar atalhos para pular o fluxo.

Fluxo validado:

1. Abrir o app.
2. Ver tela de login.
3. Clicar em `Logar com o Google`.
4. Selecionar conta Google no Chrome.
5. Confirmar callback `Login feito com sucesso!`.
6. Voltar ao Electron desbloqueado.
7. Abrir projeto `faber-tremn-ui-smoke`.
8. Abrir Git no rail direito.
9. Confirmar todas as etapas recolhidas.
10. Clicar em `Modified`.
11. Confirmar `0/1 arquivo selecionados`.
12. Confirmar botao de stage desabilitado visualmente.
13. Selecionar arquivo.
14. Confirmar `1/1 arquivo selecionado`.
15. Confirmar botao primario habilitado.
16. Clicar em `Deploy`.
17. Confirmar que `Deploy` expande apenas depois do clique.
18. Fechar e reabrir Git.
19. Confirmar que tudo volta recolhido.

Evidencias salvas:

```text
/private/tmp/faber-smoke-01-login-gate.png
/private/tmp/faber-smoke-02-google-login-success.png
/private/tmp/faber-smoke-03-project-open-after-login.png
/private/tmp/faber-smoke-04-git-all-steps-collapsed.png
/private/tmp/faber-smoke-05-git-modified-selection-required.png
/private/tmp/faber-smoke-06-git-modified-selected-action-enabled.png
/private/tmp/faber-smoke-07-git-deploy-expanded-on-click.png
/private/tmp/faber-smoke-08-git-reopened-collapsed.png
/private/tmp/faber-smoke-09-after-css-git-collapsed.png
/private/tmp/faber-smoke-10-disabled-primary-looks-disabled.png
/private/tmp/faber-smoke-11-selected-primary-enabled.png
```

## Testes focados executados

```bash
node --check main/services/git_service.js
node --check main/services/platform_backend_service.js
node --check main/services/project_scanner.js
node --check main/services/project_preview_runtime_service.js
node --check renderer/project_tools.js
node tests/git-service.test.js
node tests/ipc-handlers.test.js
node tests/platform-backend-service.test.js
node tests/project-preview-runtime-service.test.js
node tests/project-preview-service.test.js
node tests/project-scanner.test.js
node tests/renderer-project-tools.test.js
node tests/window-chrome-css.test.js
node tests/security.test.js
node tests/renderer-account-gate.test.js
```

Resultado: todos passaram.

## Suites amplas executadas

```bash
npm run test:architecture
npm run test:smoke-scenarios
npm run test:product-orchestration
npm run test:mcp-capabilities
npm run test:memory-rag-mempalace
git diff --check
```

Resultados:

- `npm run test:architecture`: passou.
- `npm run test:smoke-scenarios`: passou com 38 cenarios.
- `npm run test:product-orchestration`: passou.
- `npm run test:mcp-capabilities`: passou.
- `npm run test:memory-rag-mempalace`: passou.
- `git diff --check`: passou.

## Cobertura contra o plano de QA anexado

Coberto diretamente nesta rodada:

- login Google em navegador externo e retorno para o app;
- Git/GitHub com selecao por etapa;
- diff visual para arquivos binarios;
- arquivos Unicode;
- preview com `iframe`;
- preview com porta ocupada;
- projeto grande com 50.001 arquivos;
- bloqueio de filesystem fora do escopo autorizado;
- smoke real no app Electron;
- evidencias por screenshot;
- regressao ampla de arquitetura, produto, MCP e memoria.

Coberto por testes automatizados existentes ou reforcados:

- erros controlados de provedor;
- rotas de produto e contratos de briefing;
- MCP externo e transportes;
- memoria/RAG/MemPalace;
- seguranca basica de filesystem;
- IPC/preload/renderer contracts;
- CSS e modo claro para superficies tocadas.

Nao executado fisicamente nesta rodada:

- 24h de inatividade real;
- reboot fisico do computador com app aberto;
- pendrive com trava de escrita;
- teste de leak por 4h continuas;
- contraste em luz solar direta;
- drag-and-drop real de arquivo de 1GB.

Esses casos permanecem como pendencias de QA fisico/longa duracao. Onde possivel, foram cobertos equivalentes simulados e regressao automatizada, mas eles nao devem ser marcados como plenamente concluidos sem execucao real.

## Processos ao final

Foi verificado que nao ficou processo Electron/dev server do Faber Code rodando. Um servidor Next antigo de smoke visual na porta 3051 tambem foi encerrado.

Comando de uso para abrir o app em desenvolvimento:

```bash
cd "<repo-root>"
npm run dev
```

## Proxima rodada recomendada

1. Teste fisico de longa duracao: app aberto por 4h com projeto grande.
2. Teste de persistencia de sessao apos 24h.
3. Teste com duas instancias do app se o produto decidir permitir esse modo.
4. Fluxo real de stage -> commit -> push em repositorio descartavel, verificando autor/email pelo terminal externo.
5. Teste de conflito Git real, incluindo arquivo com merge markers.
