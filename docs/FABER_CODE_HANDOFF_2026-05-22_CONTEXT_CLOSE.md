# Faber Code - Handoff de Encerramento de Contexto

Data: 2026-05-22  
Projeto local: `localcode-studio-architecture-base`  
Branch: `main`  
Repositorio publico: `git@github.com:Eduardo-Frigo/fabercode.git`  
Estado Git no encerramento: `main...origin/main [ahead 2]`  
Ultimo commit local: `234119e Route visual review without file edits`

## Objetivo deste documento

Este documento fecha o contexto de desenvolvimento atual para permitir a retomada em uma nova conversa sem perder a linha arquitetural, as decisoes tomadas, os smoke tests, os commits recentes, as pendencias e o proximo corte natural.

A referencia mental usada nesta fase foi: Codex como 100% de capacidade de interpretacao, execucao, memoria de contexto, seguranca operacional e feedback honesto. O Faber Code ainda nao esta nesse nivel, mas avancou em direcao a uma arquitetura modular que pode chegar la.

## Resumo executivo

O Faber Code esta evoluindo de uma ferramenta com bons blocos isolados para um produto com orquestracao mais explicita:

- conversa vs execucao;
- roteamento por fatos do projeto;
- contratos deterministicos;
- patch seguro;
- memoria/contexto de projeto;
- validacao tecnica;
- validacao visual;
- reporte honesto quando algo falha.

O ciclo atual confirmou que a direcao esta correta, mas tambem mostrou que ainda nao podemos liberar improviso livre para a ferramenta. A autonomia precisa vir depois de contratos, memoria ativa, validacao visual confiavel e fallback honesto.

## Percentuais estimados no encerramento

Referencia: Codex = 100%.

| Area | Estimativa | Leitura |
| --- | ---: | --- |
| UX/UI do app desktop | 76% | A shell esta utilizavel, modularizada e com terminal, arquivos, conversa, contratos e execucao. Ainda existem falhas de polimento, preloader/estado inicial e algumas respostas de status que confundem. |
| Arquitetura modular | 68% | A direcao esta boa: `cortex/orchestration`, `main/services`, `renderer/*` e testes cresceram. Ainda ha concentracao em `main.js` e cortes locais nao consolidados. |
| Produto/orquestracao | 55% | O roteamento melhorou muito, mas provider real, memoria ativa, executor e validacao visual ainda falham em casos reais. |
| Patch seguro deterministico | 58% | Micro-patches simples estao mais bem encaminhados. Pedidos visuais/estruturais ambiguos ja comecam a sair do caminho deterministico. |
| Contratos | 60% | Contratos deixaram de ser gatilho cego e caminham para score/conflito/fallback. Ainda precisam de consolidacao e mais criterios negativos. |
| Validacao visual | 50% | Existe gate, captura, analise estatica/semantica e bloqueio honesto. Ainda ha problema de infraestrutura de preview/captura em uso real. |
| Memoria ativa/RAG/MemPalace | 30% | A arquitetura existe, mas ainda nao esta integrada como memoria operacional do fluxo principal. |
| Produto total pronto | 55-58% | O produto ja aprende com smoke tests reais, mas ainda precisa confiabilidade para ser comparavel ao Codex. |

## Onde estamos

Estamos no ponto em que o Faber Code ja tem:

- UI desktop funcional em Electron;
- selecao de projeto;
- arvore de arquivos;
- terminal interno;
- fluxo de conversa;
- provider selecionavel;
- geracao de projetos Next/Tailwind;
- edicao incremental;
- contratos deterministas;
- ledger de Automata Contracts;
- validacao tecnica;
- inicio de validacao visual;
- Cortex/RAG/MemPalace como arquitetura prevista;
- testes de fronteira para varias camadas.

O principal gargalo agora nao e apenas criar mais componentes. O gargalo e a confiabilidade do ciclo:

1. entender o pedido certo;
2. separar conversa de execucao;
3. ler o contexto real do projeto;
4. escolher rota correta;
5. aplicar patch seguro;
6. validar tecnicamente;
7. validar visualmente;
8. reportar o que funcionou e o que falhou sem fingir sucesso.

## Onde devemos chegar

O objetivo permanece:

> Um Faber Code em que a Persona escolhida pelo usuario entende conversa vs execucao, le contexto real do projeto via Cortex/MemPalace/RAG, pede operacoes ao Automata, aplica patches seguros, valida tecnica e visualmente, mostra diff e relata honestamente o que funcionou ou falhou.

Para chegar nisso, a ferramenta precisa:

- usar memoria ativa de projeto e nao apenas historico de chat;
- evitar contratos cegos por uma palavra isolada;
- nao converter screenshot/print em pedido de edicao quando o usuario pediu validacao;
- tratar micro-patches simples de forma deterministica;
- enviar pedidos ambiguos para rota semantica com confirmacao;
- bloquear conclusao quando preview/captura falha;
- distinguir falha de patch de falha de infraestrutura;
- reduzir a orquestracao de `main.js`;
- manter testes como contratos de comportamento.

## Commits recentes importantes

### `cf8ba00 Prepare public architecture update`

Commit publico enviado anteriormente para `origin/main`.

Registrou a atualizacao arquitetural publica, limpeza para release seguro e base modular.

### `31fbd5b Document architecture handoff`

Adicionou documentacao de continuidade da arquitetura publica.

### `6149567 Add semantic visual validation gate`

Commit local ainda nao enviado ao GitHub no encerramento deste contexto.

Principais avancos:

- introducao de validacao visual semantica;
- gate visual com checks de captura, pixel-health e aderencia estatica;
- validacao passa a poder bloquear sucesso quando o resultado nao atende criterios visuais;
- testes dedicados para o runtime de validacao visual.

### `234119e Route visual review without file edits`

Commit local mais recente, tambem ainda nao enviado ao GitHub no encerramento.

Principais avancos:

- pedidos como "validar visualmente", "comparar screenshots com o briefing" ou "analisar prints" entram em `visual_review`;
- `visual_review` vira diagnostico/conversa, sem edicao de arquivos;
- anexos passam a ser evidencia para revisao, nao gatilho automatico de design-to-code;
- captura visual ganhou retry para falhas transitorias como `ERR_EMPTY_RESPONSE`;
- falhas de preview/captura passam a ser classificadas como infraestrutura visual;
- auto-reparo nao deve rodar quando a falha e da captura/preview e nao do patch;
- testes atualizados para router, handlers Cortex, product orchestrator, captura visual e validation runtime.

## Estado Git no encerramento

Comando observado:

```bash
git status -sb
```

Resultado relevante:

```text
## main...origin/main [ahead 2]
```

Ou seja:

- ha 2 commits locais ainda nao enviados ao remoto;
- nao houve push/deploy automatico;
- isso respeita a regra definida: deploys/pushes publicos somente quando o usuario solicitar explicitamente.

## Alteracoes locais ainda nao commitadas

Ainda existem mudancas unstaged de cortes anteriores. Elas nao entraram no commit `234119e`.

Arquivos modificados ainda pendentes:

```text
cortex/orchestration/artifact_quality_service.js
cortex/orchestration/blueprint_icon_registry.js
cortex/orchestration/briefing_contract_service.js
cortex/orchestration/product_contract_service.js
cortex/orchestration/product_orchestrator_service.js
cortex/orchestration/product_policy_gate_service.js
cortex/orchestration/project_blueprint_copy.js
cortex/orchestration/project_blueprint_layout.js
cortex/orchestration/project_blueprint_next_templates.js
cortex/orchestration/working_brief_service.js
main.js
main/services/deterministic_edit_service.js
main/services/deterministic_edit_styles.js
main/services/pexels_asset_service.js
renderer/index.html
tests/assistant-flow.test.js
tests/blueprint-icon-registry.test.js
tests/briefing-contract-service.test.js
tests/deterministic-edit-service.test.js
tests/pexels-asset-service.test.js
tests/product-orchestrator-service.test.js
tests/project-blueprint-service.test.js
tests/window-chrome-css.test.js
tests/working-brief-service.test.js
```

Arquivos novos ainda untracked:

```text
cortex/orchestration/briefing_contract_scoring_service.js
cortex/orchestration/persona_orchestrator.js
cortex/orchestration/product_route_scoring_service.js
renderer/styles/preloader-critical.css
```

Nota importante para a proxima conversa:

> Nao usar `git add .` sem revisar. Ha alteracoes de multiplos cortes misturadas. Stagear por tema, com hunks, para manter commits pequenos e rastreaveis.

## Avancos arquiteturais feitos neste ciclo

### 1. Roteamento modular de produto

Arquivos centrais:

- `cortex/orchestration/working_brief_service.js`
- `cortex/orchestration/build_mode_router_service.js`
- `cortex/orchestration/product_contract_service.js`
- `cortex/orchestration/product_policy_gate_service.js`
- `cortex/orchestration/product_orchestrator_service.js`
- `cortex/orchestration/cortex_build_mode_handlers_service.js`

O fluxo caminha para:

```text
mensagem do usuario
  -> Working Brief
  -> Build Mode Router
  -> Product Contract
  -> Policy Gate
  -> Persona/Automata/Executor
  -> Validacao
  -> Relato
```

O ganho principal foi tirar decisoes importantes de heuristicas soltas e leva-las para modulos com contratos testaveis.

### 2. Separacao conversa vs execucao

Problema observado:

- O Faber Code interpretava frases como "olha os prints e valida visualmente" como pedido de alterar arquivos.
- Isso fazia screenshots virarem referencia de design-to-code ou edicao incremental.

Avanco:

- `visual_review` foi introduzido como rota propria;
- a decisao correta agora e `chat`/diagnostico, sem file changes;
- anexos entram como evidencia;
- correcao so deve vir em pedido posterior e explicito.

### 3. Contratos menos cegos

Problema observado:

- Uma palavra isolada podia puxar contrato errado.
- No smoke de chocolate, contexto anterior de bolsas/couro contaminou o resultado.

Direcao implementada/encaminhada:

- contratos precisam de sinais positivos fortes;
- precisam de sinais negativos;
- precisam de pontuacao por conjunto;
- conflitos precisam ser explicitos;
- baixa confianca precisa gerar fallback honesto.

Arquivos relacionados:

- `cortex/orchestration/briefing_contract_service.js`
- `cortex/orchestration/briefing_contract_scoring_service.js`
- `cortex/orchestration/product_route_scoring_service.js`
- `tests/briefing-contract-service.test.js`
- `tests/product-orchestrator-service.test.js`

Status:

- parte ja esta implementada localmente;
- parte ainda esta unstaged/uncommitted;
- precisa ser consolidada em commit proprio.

### 4. Patch seguro

Problema observado:

- Pedido simples como "deixe o fundo vermelho" deve ser micro-patch deterministico.
- Pedido como "coloque imagem com overlay no fundo" nao e micro-patch simples.

Direcao:

- micro-patches simples seguem por contratos deterministicos;
- pedidos estruturais/visuais ambiguos sobem para rota semantica;
- a ferramenta nao deve fingir que imagem, video ou overlay e apenas troca de cor.

Arquivos relacionados:

- `main/services/deterministic_edit_service.js`
- `main/services/deterministic_edit_styles.js`
- `tests/deterministic-edit-service.test.js`

Status:

- avanços existem localmente;
- ainda ha partes unstaged a revisar e commitar separadamente.

### 5. Validacao visual

Problema observado:

- A ferramenta dizia "passou" mesmo quando visualmente nao havia garantia suficiente.
- Em smoke real, o terminal mostrava `GET / 200`, mas a captura falhava com `ERR_EMPTY_RESPONSE`.

Avanco:

- validacao visual virou criterio de aceite;
- quando a captura falha por infraestrutura, o sistema nao deve auto-reparar arquivos;
- a falha precisa ser reportada como preview/captura indisponivel;
- captura agora tenta novamente em falhas transitorias.

Arquivos relacionados:

- `main/services/project_visual_capture_service.js`
- `main/services/project_visual_validation_runtime_service.js`
- `tests/project-visual-capture-service.test.js`
- `tests/project-visual-validation-runtime-service.test.js`

Status:

- commit `6149567` adicionou o gate semantico;
- commit `234119e` adicionou rota de review visual sem edicao e retry de captura;
- ainda falta estabilizar o ciclo real de preview no app Electron.

### 6. Persona Orchestrator

Objetivo do corte:

- retirar o fluxo de orquestracao da Persona de `main.js`;
- mover `routeDecision -> plan -> action -> report` para `cortex/orchestration/persona_orchestrator.js`;
- deixar `assistant:message` como wrapper fino.

Status local:

- `cortex/orchestration/persona_orchestrator.js` existe como untracked;
- `main.js` tem mudancas locais relacionadas;
- `tests/assistant-flow.test.js` tambem tem mudancas;
- esse corte ainda nao foi consolidado em commit final.

Proximo cuidado:

- revisar o arquivo novo;
- rodar `npm run test:assistant-flow`;
- stagear apenas esse corte;
- commitar com mensagem separada.

### 7. Dominio chocolate e smoke test

Smoke test feito:

- briefing: chocolate artesanal, premium e sensorial;
- objetivo: landing page elegante com video, imagens, icones, CTAs e secoes completas;
- paleta: marrom chocolate, cacau escuro, creme, dourado suave, branco quente;
- tipografia: serifada elegante para titulos e sans limpa para textos.

Resultado antigo:

- saiu no dominio errado: couro/bolsas;
- puxou contexto de pedido anterior;
- gerou estrutura fora do briefing.

Resultado depois dos avancos:

- dominio chocolate foi reconhecido;
- brand `Maison Cacao`;
- copy saiu coerente;
- hero com imagem de chocolate apareceu em rodada posterior;
- processo, produtos, CTA e footer apareceram.

Falhas restantes:

- tipografia ainda nao seguiu bem a sugestao serifada;
- hero inicialmente nao tinha video real full width;
- produto ainda nao escolheu imagens/cards tao ricos quanto o briefing pedia;
- validacao visual falhou por preview/captura;
- tentativa de validar screenshots foi roteada como execucao antes do commit `234119e`.

## Smoke tests e validacoes rodadas

Na rodada que gerou o commit `234119e`, passaram:

```bash
node --check cortex/orchestration/working_brief_service.js
node --check cortex/orchestration/build_mode_router_service.js
node --check cortex/orchestration/product_contract_service.js
node --check cortex/orchestration/product_route_scoring_service.js
node --check cortex/orchestration/cortex_build_mode_handlers_service.js
node --check main/services/project_visual_capture_service.js
node --check main/services/project_visual_validation_runtime_service.js
node --check main.js
npm run test:build-mode-router
npm run test:cortex-build-mode-handlers
npm run test:product-orchestrator
npm run test:project-visual-capture
npm run test:project-visual-validation-runtime
npm run test:assistant-flow
npm run test:working-brief
npm run test:briefing-contract
npm run test:validation-service
npm run test:visual-briefing-semantic
git diff --check
```

Para uma validacao ampla antes de push publico:

```bash
npm run audit:public
npm run test:architecture
```

## Como rodar o app no proximo contexto

Comando simples:

```bash
cd "<repo-root>"
npm run dev
```

Se quiser apenas verificar porta/preview de projeto gerado, rodar dentro do projeto alvo:

```bash
cd "<example-project-root>/Teste 19"
npm run dev
```

Observacao:

- projetos Next podem alterar `tsconfig.json` automaticamente na primeira execucao;
- isso aconteceu no smoke e nao deve ser confundido com edicao da IA;
- se o Faber Code capturar preview, conferir se o URL interno bate com a porta ativa.

## Arquitetura atual em poucas camadas

### Renderer

Responsavel pela experiencia desktop:

- conversa;
- sidebar de projetos;
- arvore de arquivos;
- terminal;
- botoes de Git/Executar/Contratos;
- configuracoes;
- progresso dos jobs.

Arquivos relevantes:

- `renderer/app.js` tem cerca de 990 linhas;
- `renderer/index.html` carrega modulos explicitamente;
- `renderer/styles.css` e entrypoint de imports;
- `renderer/styles/preloader-critical.css` existe localmente como untracked para corrigir preloader.

### Main

Responsavel por:

- Electron;
- janela;
- IPC;
- providers;
- filesystem;
- preview;
- Git;
- execucao;
- validacao.

Estado:

- `main.js` tem cerca de 4374 linhas;
- ainda e grande;
- deve continuar sendo reduzido por cortes naturais.

### Cortex

Responsavel por:

- orquestracao;
- contratos;
- memoria;
- RAG/MemPalace;
- providers;
- decisao de produto.

Arquivos chave:

- `cortex/orchestration/working_brief_service.js`
- `cortex/orchestration/build_mode_router_service.js`
- `cortex/orchestration/product_contract_service.js`
- `cortex/orchestration/product_policy_gate_service.js`
- `cortex/orchestration/product_orchestrator_service.js`
- `cortex/orchestration/cortex_build_mode_handlers_service.js`
- `cortex/orchestration/persona_orchestrator.js` ainda untracked
- `cortex/orchestration/product_route_scoring_service.js` ainda untracked

### Automata

Responsavel por:

- contratos deterministicos;
- patch seguro;
- ledger de contratos locais;
- promocao controlada de contratos.

Documento base:

- `docs/AUTOMATA_CONTRACTS.md`

## Decisoes de processo definidas com o usuario

1. Todo novo pedido deve seguir a arquitetura modular sem precisar reafirmar.
2. Mudancas devem respeitar fronteiras existentes e evitar sanitizacoes grandes depois.
3. A cada nova solicitacao atendida com alteracao de arquivos, perguntar se o usuario quer commit.
4. Deploys/pushes/publicacao nao devem ser sugeridos automaticamente; o usuario pedira quando quiser.
5. Commits devem ser pequenos e por corte natural.
6. Nao usar contratos cegos baseados em uma palavra.
7. Nao liberar improviso amplo antes de memoria ativa, roteamento, contratos, patch seguro e validacao visual ficarem confiaveis.

## Problemas conhecidos

### Provider real

O provider OpenAI falhou em smoke real com:

```text
OpenAI nao retornou texto gerado.
```

Impacto:

- a ferramenta precisa tratar provider failure como estado controlado;
- nao deve dizer que concluiu;
- precisa preservar checkpoint e oferecer proximo passo honesto.

### Preview/captura

Falhas observadas:

```text
ERR_EMPTY_RESPONSE (-324) loading 'http://127.0.0.1:3001/'
ERR_EMPTY_RESPONSE (-324) loading 'http://127.0.0.1:3000/'
Interrompendo preview.
```

Impacto:

- validacao visual nao pode liberar sucesso;
- auto-reparo nao deve editar arquivos quando a falha e do preview;
- proximo corte precisa investigar ciclo de preview interno.

### Memoria ativa

RAG/MemPalace ainda nao participa o suficiente da decisao operacional.

Impacto:

- risco de contexto anterior contaminar pedido atual;
- risco de briefing longo perder prioridade para contexto velho;
- necessidade de separar memoria de usuario, memoria de projeto e mensagem atual.

### Main.js

`main.js` ainda concentra muito:

- inicializacao;
- providers;
- orquestracao;
- runtime;
- validacao;
- checkpoints;
- job flow.

Impacto:

- risco de erros de ordem de inicializacao;
- dificuldade de testar comportamento sem Electron completo;
- refactors precisam continuar em cortes pequenos.

## Proximo corte recomendado

O proximo corte natural deve ser um destes, nesta ordem recomendada:

### Opcao A - consolidar Persona Orchestrator

Objetivo:

- finalizar `cortex/orchestration/persona_orchestrator.js`;
- garantir que `main.js` so chame o orquestrador;
- testar conversa simples, execucao, JSON invalido e provider failure.

Por que agora:

- reduz o monolito;
- facilita memoria ativa depois;
- deixa provider/mock mais testavel.

Testes minimos:

```bash
npm run test:assistant-flow
npm run test:product-orchestrator
npm run test:working-brief
node --check cortex/orchestration/persona_orchestrator.js
node --check main.js
```

### Opcao B - consolidar scoring de contratos e rotas

Objetivo:

- revisar `briefing_contract_scoring_service.js`;
- revisar `product_route_scoring_service.js`;
- garantir sinais positivos/negativos/conflitos/fallback;
- impedir dominio antigo de contaminar briefing novo.

Por que agora:

- o smoke de chocolate provou que este e um ponto fragil real;
- melhora seguranca antes de dar mais autonomia.

Testes minimos:

```bash
npm run test:briefing-contract
npm run test:product-orchestrator
npm run test:working-brief
npm run test:build-mode-router
```

### Opcao C - estabilizar preview visual

Objetivo:

- diagnosticar por que a captura falha mesmo com terminal mostrando `GET / 200`;
- alinhar porta ativa, lifecycle do processo Node e captura Electron;
- transformar falha de preview em diagnostico preciso.

Por que agora:

- validacao visual e fundamental para aceitar resultados;
- sem captura confiavel, o produto continua honesto, mas nao consegue fechar o ciclo visual.

Testes minimos:

```bash
npm run test:project-preview
npm run test:project-preview-runtime
npm run test:project-visual-capture
npm run test:project-visual-validation-runtime
```

## Recomendacao para iniciar a proxima conversa

Comecar com:

```text
Leia docs/FABER_CODE_HANDOFF_2026-05-22_CONTEXT_CLOSE.md e continue do ponto atual.
Primeiro rode git status -sb e git log --oneline -5.
Nao use git add .; stageie por corte.
Vamos seguir pela Opcao A, B ou C do handoff.
```

Se o objetivo for seguir o plano mais seguro:

```text
Vamos seguir pela Opcao A: consolidar Persona Orchestrator, mantendo a arquitetura modular e perguntando sobre commit ao final.
```

Se o objetivo for atacar o problema mais visivel do smoke test:

```text
Vamos seguir pela Opcao B: scoring de contratos e rotas para impedir contaminação de contexto antigo e contratos cegos.
```

Se o objetivo for fechar validacao visual real:

```text
Vamos seguir pela Opcao C: estabilizar preview/captura visual para que o gate possa avaliar o resultado real.
```

## Nota final de continuidade

O projeto esta crescendo de forma horizontal e modular, mas ainda ha risco de misturar cortes se o Git for tratado como bloco unico. A proxima conversa deve preservar essa disciplina:

- uma mudanca arquitetural por vez;
- um conjunto de testes por corte;
- um commit por etapa aprovada;
- sem push/deploy ate pedido explicito;
- relato honesto de falhas tecnicas e visuais.

O Faber Code ja esta deixando de ser uma sequencia de heuristicas. O trabalho agora e transformar essa arquitetura em comportamento confiavel em smoke tests reais.
