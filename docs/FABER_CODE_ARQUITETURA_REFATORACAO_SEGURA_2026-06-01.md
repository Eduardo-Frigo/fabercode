# Faber Code - Refatoracao protegida por testes e fronteiras de arquitetura

Data: 2026-06-01
Base da rodada: `588e41f docs: document public release advances`
Status: implementado localmente, validado, preparado para commit e publicacao em `origin/main`

## Objetivo

Esta rodada continuou a refatoracao protegida por testes do Faber Code, com foco em reduzir concentracao de responsabilidades, reforcar fronteiras de seguranca e manter a suite de arquitetura como contrato antes de publicar.

O criterio usado foi:

```text
Teste -> Correcao -> smoke como usuario -> validacao visual -> teste
```

O alvo principal foi a area de ferramentas do projeto, especialmente Git, GitHub e deploy, porque ela combina UI, selecao de arquivos, comandos locais e operacoes remotas.

## Resultado executivo

A arquitetura saiu mais modular sem trocar o comportamento publico do produto:

- `renderer/project_tools.js` deixou de concentrar toda a renderizacao Git/GitHub/deploy.
- A UI de ferramentas foi separada em suporte puro, Git steps e GitHub/Deploy.
- O contrato de carregamento dos modulos renderer foi testado.
- Fluxos sensiveis de Git, GitHub, preview, URL externa, terminal e MCP receberam hardening.
- A suite `npm run test:architecture` passou completa depois dos cortes.
- O smoke visual validou login, abertura de projeto e painel Git com etapas e selecao explicita.

## Cortes de arquitetura

### 1. Ferramentas do projeto

Antes, `renderer/project_tools.js` concentrava responsabilidades demais:

- lightbox e superficie comum;
- preview/execucao;
- terminal;
- Git local;
- GitHub;
- deploy;
- helpers de texto, status e comandos.

Depois, a fronteira ficou assim:

- `renderer/project_tools_support.js`: helpers puros e view models compartilhados.
- `renderer/project_tools_github_deploy.js`: GitHub, clone/importacao, plano de publicacao e deploy.
- `renderer/project_tools_git.js`: acordeon Git, selecao, stage, commit e composicao com deploy.
- `renderer/project_tools.js`: shell/controlador principal das ferramentas.

O `index.html` agora carrega os modulos nessa ordem:

```text
project_tools_support.js
project_tools_github_deploy.js
project_tools_git.js
project_tools.js
```

`tests/renderer-module-contract.test.js` garante que essa ordem nao quebre.

### 2. Git local

O Git foi endurecido em duas camadas:

- UI: usuario continua precisando selecionar explicitamente arquivos em `Untracked`, `Modified` e `Staged`.
- Service: caminhos enviados para stage/commit sao normalizados e rejeitam path absoluto, traversal e entradas invalidas.

Tambem foi mantido suporte a nomes que parecem flags, como arquivos iniciados por `--`, usando separador `git add -- arquivo`.

Cobertura principal:

- `tests/git-service.test.js`
- `tests/renderer-project-tools.test.js`
- `tests/ipc-handlers.test.js`

### 3. GitHub e deploy

O modulo de GitHub/Deploy ficou separado do Git local. A UI continua apresentando:

1. `Untracked`
2. `Modified`
3. `Staged`
4. `Committed`
5. `Deploy`

O `Deploy` so aparece utilmente depois de commit e mantem revisao antes de qualquer publicacao.

Hardenings aplicados:

- nome de owner normalizado sem prefixo `-`;
- branch normalizada contra caracteres invalidos e formas perigosas;
- remote name normalizado;
- plano de publicacao rejeita projeto inexistente, inacessivel ou que nao seja pasta;
- clone GitHub rejeita destino na raiz do filesystem;
- clone/importacao continua dependente de GitHub CLI autenticado.

Cobertura principal:

- `tests/github-integration-service.test.js`

### 4. URL externa e preview

Foi separada a politica de URL externa da politica de preview:

- `normalizeExternalUrl`: somente `https`, hosts permitidos e sem credenciais embutidas.
- `normalizePreviewOpenUrl`: permite `file:` local e `http/https` apenas em hosts locais (`127.0.0.1`, `localhost`, `::1`), sem credenciais.

Isso evita abrir URLs externas arbitrarias via fluxos de auth/preview.

Cobertura principal:

- `tests/security.test.js`
- `tests/account-handlers.test.js`

### 5. Execucao de comandos e preview runtime

Processos locais agora sao disparados com `shell: false`:

- `main/services/command_runner.js`
- `main/services/project_preview_runtime_service.js`

Isso reduz superficie de command injection quando argumentos sao compostos por services.

Cobertura principal:

- `tests/command-runner.test.js`
- `tests/project-preview-runtime-service.test.js`

### 6. MCP externo

Foram reforcadas duas fronteiras:

- secrets de `env`/`headers` no registry externo passam por `protectSecret` antes de persistir;
- politica de escopo valida caminho fisico via `realpath`, bloqueando escape por symlink para fora da raiz do projeto.

Cobertura principal:

- `tests/external-mcp-server-registry-service.test.js`
- `tests/external-mcp-tool-policy-service.test.js`

### 7. Editor de arquivos

Preview de imagens no editor passou a montar URL `file://` com encode por segmento, em vez de interpolar caminho bruto no HTML.

Cobertura principal:

- `tests/renderer-file-editor.test.js`

## Smoke visual

Smoke manual executado no Electron:

- criar conta local de teste descartavel;
- passar pelo login gate;
- abrir workspace;
- abrir projeto existente;
- abrir painel Git;
- expandir `Modified`;
- validar selecao explicita sem executar stage, commit, push ou deploy.

Evidencias locais nao versionadas:

- `faber-openai-pi-smoke-02-signup-form.png`
- `faber-openai-pi-smoke-03-post-login.png`
- `faber-openai-pi-smoke-04-project-open.png`
- `faber-openai-pi-smoke-05-git-panel.png`
- `faber-openai-pi-smoke-06-git-modified-expanded.png`

Achado menor: o formulario de criacao de conta estava com idioma `English` selecionado por padrao, entao parte da UI abriu em ingles. Isso nao bloqueou o smoke, mas deve ser ajustado para `pt-BR` em rodada futura.

## Validacoes executadas

Validacoes de corte:

```bash
npm run test:ai-trust-boundary
npm run test:render-pass-service
node --check tests/real-openai-prompt-injection-e2e.electron.js
```

Validacoes finais:

```bash
npm run test:architecture
npm run audit:release
npm audit --omit=dev --audit-level=moderate
git diff --check
```

Resultado:

- arquitetura passou completa;
- auditoria publica passou;
- higiene de testes passou;
- `npm audit` retornou 0 vulnerabilidades de producao;
- `git diff --check` passou;
- nenhum processo Electron/dev server ficou rodando ao final.

Observacao: uma primeira execucao de `test:architecture` dentro do sandbox falhou em `platform-backend` por `EPERM` ao abrir `127.0.0.1`. A suite foi repetida com permissao para servidor local e passou completa. Isso foi tratado como limitacao do ambiente de teste, nao como regressao do produto.

## Limites restantes

Esta rodada melhora a arquitetura e reduz risco, mas nao elimina toda possibilidade de falha.

Pontos que continuam exigindo disciplina:

- manter `renderer/` quebrado por responsabilidades pequenas;
- nao misturar OAuth de conta com permissao local do GitHub CLI;
- nao permitir publicacao remota sem revisao e clique explicito;
- manter testes de arquitetura obrigatorios antes de push;
- repetir smoke visual sempre que o fluxo Git/GitHub/deploy mudar;
- ajustar o default de idioma no signup para evitar UI em ingles por acidente.
