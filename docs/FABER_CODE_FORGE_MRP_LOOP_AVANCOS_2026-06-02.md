# Faber Code - Forge MRP, liberdade de execucao e loop visual

Data: 2026-06-02
Status: implementado localmente; validacao automatizada parcial; smoke real interrompido por limite da API OpenAI

## Contexto

Esta rodada continuou o stresstest do Forge MRP iniciado em 2026-06-01. A meta nao era apenas corrigir uma tela: era verificar se o Faber Code consegue receber pedidos como um usuario real, agir no projeto, alterar arquivos de fato, mostrar o caminho da execucao e permitir validacao visual por screenshot.

O teste real revelou quatro problemas principais:

- a regra de contrato antes de agir ainda aparecia como gargalo em rotas que deveriam executar;
- o intake e o render pass ainda podiam preferir patches/blueprints locais em vez de dar liberdade suficiente para a IA trabalhar no app;
- uma tentativa visual gerou conteudo textual/instrucional dentro de arquivos de codigo, quebrando o projeto Forge MRP;
- a tentativa de reparo posterior parou por limite do provider (`max_output_tokens=4096`) antes de gerar JSON de operacoes.

## Decisoes de produto

### Contrato deixa de ser padrao

Contrato Automata/blueprint continua existindo, mas mudou de papel:

- contrato agora e reservado para pedido explicito, governanca, staged/promotion ou risco realmente bloqueante;
- conflito de dominio ou falta de recipe virou `advisory`, nao `blocking`;
- a IA deve registrar a premissa adotada e seguir com a execucao quando o usuario pediu para criar/corrigir;
- o fluxo normal deve ser plano curto, fases visiveis, alteracao, validacao e resumo.

Arquivos principais:

- `cortex/orchestration/briefing_spec_service.js`
- `cortex/orchestration/build_mode_router_service.js`
- `cortex/orchestration/working_brief_service.js`
- `cortex/orchestration/project_blueprint_request.js`
- `cortex/orchestration/render_pass_service.js`
- `tests/briefing-spec-service.test.js`
- `tests/product-orchestrator-service.test.js`
- `tests/support/smoke_scenario_runner.js`

### Fases visiveis durante execucao

Foi criado um modo de descricao de acao no painel de job:

- chips de fases;
- lista de eventos atuais;
- resumo final curto;
- `details` expansivel com o caminho tecnico;
- jobs terminais permanecem visiveis para inspecao, em vez de sumirem rapidamente.

Arquivos principais:

- `renderer/ux_state_model.js`
- `renderer/job_progress.js`
- `renderer/styles/state-surfaces.css`
- `renderer/app_jobs.js`
- `renderer/app_actions.js`
- `renderer/app.js`
- `cortex/orchestration/state_store_jobs.js`
- `tests/renderer-ux-state-model.test.js`

Evidencias locais nao versionadas:

- `/private/tmp/faber-action-description-live.png`
- `/private/tmp/faber-action-description-awaiting-confirmation.png`
- `/private/tmp/faber-action-description-final-collapsed.png`
- `/private/tmp/faber-action-description-final-expanded.png`

### Read-only deve continuar read-only

Pedidos como "diagnostique sem alterar arquivos" agora tendem para conversa/diagnostico textual, sem abrir card de aplicar artefatos.

Arquivos principais:

- `cortex/orchestration/product_route_scoring_service.js`
- `cortex/orchestration/product_intake_service.js`
- `cortex/orchestration/product_contract_service.js`
- `tests/product-orchestrator-service.test.js`

Evidencia local nao versionada:

- `/private/tmp/faber-read-only-routing-fixed.png`

### Edicoes visuais estreitas nao devem puxar contrato amplo

Pedidos pontuais de tipografia/titulo em projeto existente agora sao tratados como edicao incremental estreita quando o usuario limita escopo. Isso evita que uma troca de fonte acione a validacao ampla de todo o briefing Forge MRP.

Arquivos principais:

- `cortex/orchestration/artifact_quality_service.js`
- `tests/artifact-quality-service.test.js`
- `tests/product-orchestrator-service.test.js`
- `tests/render-pass-service.test.js`

## Validacao contra conteudo instrucional em arquivos de codigo

Durante o teste real, o Faber gerou operacoes que escreveram instrucoes em arquivos criticos:

- `package.json`
- `app/layout.tsx`
- `app/page.tsx`
- `app/globals.css`
- `tests/forge-mrp.spec.ts`

Exemplo do problema: `package.json` recebeu uma frase em portugues em vez de JSON. Isso quebrou o preview/build do Forge MRP.

Foi adicionada uma barreira de validacao para bloquear esse tipo de lote antes de aplicar:

- JSON critico precisa parsear como objeto;
- arquivos TS/TSX/JS/JSX precisam ter formato de codigo/JSX plausivel;
- CSS precisa ter formato de CSS;
- texto instrucional em arquivo de codigo falha `operationContentValidity`;
- a validacao tecnica so passa se esse check passar.

Arquivos principais:

- `cortex/orchestration/validation_service.js`
- `main.js`
- `tests/validation-service.test.js`

## Forge MRP blueprint e contrato estatico

Foi adicionada uma rota local especifica para Forge MRP quando o pedido e estrutural, cobrindo:

- Next/Tailwind;
- Prisma/Postgres;
- Zod;
- Vitest;
- Playwright;
- React Hook Form;
- TanStack Table;
- Zustand;
- `date-fns`;
- dominio/servicos/store/schemas;
- BOM multinivel;
- estoque auditavel;
- ordens de producao;
- audit log;
- UI escura operacional com tipografia Assistant.

Arquivo novo:

- `cortex/orchestration/forge_mrp_blueprint_service.js`

Validador reforcado:

- `cortex/orchestration/artifact_quality_service.js`

O objetivo desse blueprint nao e substituir a IA em todos os casos, mas evitar a regressao que gerou uma "casca funcional" sem arquitetura, sem persistencia, sem BOM multinivel real e sem testes criticos.

## Falhas reais observadas no smoke como usuario

### Tentativa visual inicial

Pedido: trocar tipografia/titulos do THE FORGE.

Resultado:

- nao criou contrato;
- entrou em job com fases;
- falhou por output limit em uma tentativa de render/reparo.

Evidencia:

- `/private/tmp/faber-visual-direct-provider-failure.png`

### Segunda tentativa visual

Pedido: trocar tipografia/titulos de forma pontual.

Resultado:

- nao criou contrato;
- preparou 5 operacoes;
- apos confirmar, escreveu texto instrucional dentro de arquivos de codigo;
- o Forge MRP ficou quebrado.

Evidencias:

- `/private/tmp/faber-visual-direct-1780444000-confirmation.png`
- `/private/tmp/faber-visual-direct-1780444000-post-exec-failed.png`

### Tentativa de reparo apos as correcoes

Pedido: reparar os arquivos quebrados com codigo valido completo.

Resultado:

- nao criou contrato;
- mostrou fases no painel;
- entrou em execucao direta;
- falhou por limite da OpenAI antes de retornar JSON (`status=incomplete; reason=max_output_tokens; max_output_tokens=4096`);
- nao alterou os arquivos quebrados nessa rodada.

Estado importante: o Forge MRP fora deste repositorio continua quebrado ate nova rodada de reparo ou correcao manual.

## Correcao preparada para o limite de API

O retry compacto para falhas de provider foi ampliado para cobrir `diagnostic_repair`, alem de `edit_project`/incremental.

Comportamento esperado:

- primeira chamada pode falhar por `max_output_tokens=4096`;
- rota `diagnostic_repair` deve tentar novamente com prompt compacto e `num_predict=12000`;
- a segunda tentativa deve pedir apenas JSON valido com operacoes essenciais.

Arquivos:

- `cortex/orchestration/render_pass_service.js`
- `tests/render-pass-service.test.js`

Observacao: essa correcao foi implementada antes da pausa por limite de API, mas ainda precisa ser validada em smoke real quando a API voltar.

## Testes executados nesta rodada

Passaram:

```bash
node --check cortex/orchestration/briefing_spec_service.js
node --check cortex/orchestration/working_brief_service.js
node --check cortex/orchestration/build_mode_router_service.js
node --check cortex/orchestration/render_pass_service.js
node tests/briefing-spec-service.test.js
node tests/working-brief-service.test.js
node tests/build-mode-router-service.test.js
node tests/render-pass-service.test.js
node tests/product-orchestrator-service.test.js
node tests/assistant-flow.test.js
node tests/artifact-quality-service.test.js
node tests/validation-service.test.js
npm run test:product-orchestration
```

Ainda pendente apos as ultimas linhas alteradas:

- reexecutar `node tests/render-pass-service.test.js`;
- reexecutar `npm run test:product-orchestration`;
- reiniciar Electron;
- repetir o reparo no Forge MRP quando a OpenAI/API estiver disponivel.

## Proximo loop recomendado

1. Rodar testes focados no Faber.
2. Reiniciar Electron.
3. Abrir THE FORGE.
4. Enviar pedido de reparo especifico para `package.json`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `tests/forge-mrp.spec.ts`.
5. Confirmar que a tentativa compacta acontece se houver output limit.
6. Antes de confirmar aplicacao, verificar se as operacoes contem codigo real, nao instrucoes.
7. Aplicar.
8. Rodar validacao no projeto Forge MRP:

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package ok')"
npm test
npm run build
```

9. Abrir preview e capturar screenshot desktop.

