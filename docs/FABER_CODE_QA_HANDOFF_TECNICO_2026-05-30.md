# Faber Code - Handoff tecnico da rodada QA/Git/Preview/OAuth

Data: 2026-05-30

Base inicial: `e41568c feat: improve GitHub and Git UX flows`

## Para continuar daqui

Estado esperado depois desta rodada:

- painel Git sempre abre com etapas recolhidas;
- cada etapa Git so expande por clique;
- `Untracked` e `Modified` exigem selecao antes de stage;
- `Staged` exige selecao antes de commit;
- commit recebe lista de arquivos selecionados pelo IPC;
- arquivos binarios mostram aviso sem tentar diff textual;
- paths Unicode de Git nao devem ser escapados;
- preview local injeta `PORT`/`HOST` coerentes com a porta selecionada;
- OAuth local deve sobreviver a restart rapido com retry em `EADDRINUSE`;
- scanner de projeto grande diferencia `totalFiles`, `scannedFiles` e `truncated`.

## Arquivos alterados e responsabilidade

### `renderer/project_tools.js`

Responsabilidades alteradas:

- estado local `openGitStepKey`;
- renderizacao de etapas Git como acordeon;
- reset da etapa aberta ao abrir Git pelo rail;
- selecao explicita em listas Git;
- acao de stage com `getCheckedGitFiles`;
- acao de commit com arquivos selecionados;
- exibicao de resumo de arquivo binario.

Contratos de UX:

- nenhuma etapa abre automaticamente ao entrar no Git;
- clicar em uma etapa fecha as outras;
- botoes de acao primaria ficam desabilitados sem selecao;
- o usuario sempre ve o contador `selecionado(s)` antes de avancar;
- publicar/deploy nao deve acontecer sem revisao ou clique explicito.

### `renderer/styles/workspace-tools.css`

Responsabilidades alteradas:

- estilos do acordeon Git;
- controles de selecao;
- resumo compacto de binario;
- estado visual de botao primario desabilitado.

Contrato visual:

- controle desabilitado nao pode parecer CTA ativo;
- linhas Git devem permanecer compactas;
- resumo de binario deve ser discreto e legivel.

### `renderer/styles/system-shell.css`

Responsabilidades alteradas:

- overrides de modo claro para os novos elementos;
- estado desabilitado de primario no modo claro;
- contraste de resumo binario.

Contrato visual:

- modo claro nao pode herdar baixo contraste dos componentes escuros;
- botao primario desabilitado deve perder o verde tambem no tema claro.

### `main/services/git_service.js`

Responsabilidades alteradas:

- comandos de path usam `-c core.quotepath=false`;
- `collectGitDiffStats` registra arquivos binarios;
- worktree entries incluem `binary`;
- untracked binario e detectado por leitura segura de bytes;
- resumo prioriza binario antes de texto de arquivo novo.

Contrato tecnico:

- path Unicode deve sair legivel para UI;
- arquivo binario nao deve tentar gerar diff textual;
- untracked binario deve receber o mesmo aviso de diff indisponivel;
- leitura de binario deve ser limitada e local ao projeto.

### `main/ipc/project_handlers.js`

Responsabilidade alterada:

- `project:git:commit` passa `files` para `commitProjectGitFiles`.

Contrato:

- commit pelo app deve respeitar a selecao do usuario;
- `files` vazio ou ausente deve continuar seguro pelo service/testes.

### `main/services/project_scanner.js`

Responsabilidades alteradas:

- contador total desacoplado do sample armazenado;
- retorno de `scannedFiles`;
- retorno de `truncated`.

Contrato:

- `totalFiles` representa o universo real nao ignorado;
- `scannedFiles` representa o limite processado para detalhe;
- UI e diagnosticos podem informar projeto grande sem confundir total com amostra.

### `main/services/project_preview_runtime_service.js`

Responsabilidade alterada:

- ambiente do processo de preview usa porta/host selecionados.

Contrato:

- se a porta preferida estiver ocupada e a selecionada for outra, `process.env.PORT` deve refletir a porta escolhida;
- `FABER_PREVIEW_PORT` e `FABER_PREVIEW_HOST` existem para scripts especificos do Faber;
- `HOST` deve apontar para o host selecionado.

### `main/services/platform_backend_service.js`

Responsabilidades alteradas:

- retry de start em `EADDRINUSE`;
- auditoria `platform_backend.start_retry`;
- injecao de `http` em teste;
- parametros `startRetryAttempts` e `startRetryDelayMs`.

Contrato:

- restart rapido do Electron nao deve quebrar callback OAuth por porta temporariamente ocupada;
- se a porta continuar ocupada depois das tentativas, o erro deve seguir aparecendo como falha real.

### `cortex/orchestration/project_blueprint_coverage_contract.js`

Responsabilidade alterada:

- normalizacao de rota esperada em smoke de continuacao/briefing vazio.

Contrato:

- o smoke deve acompanhar o roteamento atual de blueprint local sem aceitar regressao de dominio.

## Testes adicionados ou reforcados

### `tests/git-service.test.js`

Coberturas:

- comandos Git com `core.quotepath=false`;
- path Unicode;
- binario tracked via diff stats;
- binario untracked por leitura de bytes;
- resumo `Arquivo binario: diff textual indisponivel.`

### `tests/renderer-project-tools.test.js`

Coberturas:

- resumo compacto de binario no Git;
- selecao por etapa;
- publish/Git reseta etapa aberta;
- botao de acao depende de selecao.

### `tests/ipc-handlers.test.js`

Cobertura:

- commit IPC encaminha `files` selecionados.

### `tests/project-scanner.test.js`

Coberturas:

- `totalFiles`;
- `scannedFiles`;
- `truncated`;
- limite de scan com amostra.

### `tests/project-preview-runtime-service.test.js`

Cobertura:

- `PORT`, `HOST`, `FABER_PREVIEW_PORT`, `FABER_PREVIEW_HOST` no ambiente do processo.

### `tests/platform-backend-service.test.js`

Cobertura:

- porta ocupada inicialmente;
- retry;
- porta liberada;
- servidor sobe;
- `/health` responde.

## Comandos de validacao final

Rodados e aprovados:

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
npm run test:architecture
npm run test:smoke-scenarios
npm run test:product-orchestration
npm run test:mcp-capabilities
npm run test:memory-rag-mempalace
git diff --check
```

## Evidencias visuais relevantes

```text
/private/tmp/faber-smoke-07-git-deploy-expanded-on-click.png
/private/tmp/faber-smoke-08-git-reopened-collapsed.png
/private/tmp/faber-smoke-09-after-css-git-collapsed.png
/private/tmp/faber-smoke-10-disabled-primary-looks-disabled.png
/private/tmp/faber-smoke-11-selected-primary-enabled.png
```

Leitura das evidencias:

- `07`: `Deploy` aparece expandido apenas apos clique.
- `08` e `09`: Git reabre com etapas recolhidas.
- `10`: botao primario desabilitado sem parecer CTA.
- `11`: ao selecionar arquivo, o CTA fica ativo.

## Cuidados ao mexer novamente no Git UX

1. Nao voltar a marcar arquivos por padrao.
2. Nao abrir `Deploy` automaticamente ao entrar no Git.
3. Nao permitir commit visual sem selecao clara.
4. Nao esconder do usuario que arquivo binario nao tem diff textual.
5. Nao misturar OAuth GitHub/Google com permissao local do `gh`.
6. Nao deixar publicacao remota acontecer sem revisao explicita.

## Comando para rodar o app

```bash
cd "<repo-root>"
npm run dev
```

Ao finalizar novo smoke manual, encerrar o Electron/dev server e confirmar com:

```bash
ps -ax -o pid= -o ppid= -o command= | rg "localcode-studio|Electron.app/Contents/MacOS/Electron|electron \\.|npm run dev|127.0.0.1 --port"
```

## Pendencias fisicas/longa duracao

Ainda exigem execucao real fora desta rodada:

- 24h de inatividade;
- reboot com app aberto;
- pendrive com trava de escrita;
- teste de memoria por 4h;
- contraste em luz solar direta;
- drag-and-drop real de arquivo de 1GB;
- conflito Git real com merge markers;
- stage -> commit -> push em repo descartavel verificando autor/email pelo terminal externo.
