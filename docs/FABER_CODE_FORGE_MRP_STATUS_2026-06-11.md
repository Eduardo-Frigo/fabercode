# Faber Code - Status Forge MRP em 2026-06-11

## Contexto

Este registro consolida o estado atual do stress test do projeto `THE FORGE`, usado para avaliar se o Faber Code consegue criar e evoluir um sistema MRP funcional, com dominio, UI, testes, persistencia e ciclo de reparo.

O teste foi feito apenas no projeto `THE FORGE`. Os projetos `MAURICIO TREMN` e `FABER-TREMN-UI-SMOKE` nao foram usados neste ciclo.

## Resultado do smoke funcional

O app local inicialmente tinha partes funcionais:

- Renderizacao inicial do dashboard MRP.
- Explosao MRP seedada multinivel.
- Fluxo de ordem de producao: validar, iniciar producao e finalizar.
- Recalculo de necessidades ao executar MRP com quantidade 8.
- Normalizacao de quantidade 0 para 1 no fluxo de MRP.
- Layout mobile sem overflow horizontal no ultimo smoke.

Mas tambem tinha partes ainda ilusorias ou incompletas:

- Links `Itens` e `Estoque` nao tinham secoes reais.
- `Adicionar componente BOM` exibia JSON, mas nao alimentava a BOM usada no MRP.
- `Editar revisao ativa` e `Remover componente` apenas trocavam mensagens de texto.
- `quantityPer = 0` gerava erro Zod/runtime em vez de feedback inline amigavel.
- Audit log era regenerado com a quantidade atual, nao preservava historico real de execucoes.
- Reload zerava estado operacional; nao havia persistencia real.

## Prisma/Postgres

O projeto continha sinais de intencao de Postgres/Prisma:

- `@prisma/client` e `prisma` no `package.json`.
- `prisma/schema.prisma` com `provider = "postgresql"`.
- `.env` com `DATABASE_URL="postgresql://forge:forge@localhost:5432/forge_mrp?schema=public"`.

Porem nao havia banco local operacional:

- Sem `docker-compose.yml`.
- Sem migrations.
- Sem seed de banco.
- Sem `PrismaClient`.
- Sem API routes ou server actions usando Prisma.
- Sem repository/service de persistencia.
- Sem teste de conexao real com Postgres.

Conclusao: Postgres foi declarado, mas nao integrado ao runtime do produto.

## Tentativa de correcao pelo Faber Code

Foi solicitado ao Faber Code que corrigisse o modulo BOM para deixar de ser textual e passar a afetar o calculo MRP.

O Faber Code:

- Selecionou corretamente o projeto `THE FORGE`.
- Preparou uma alteracao incremental.
- Aplicou mudancas em `app/page.tsx`.
- Alterou de fato o arquivo.

Mas a alteracao quebrou a aplicacao:

- `npm run build` passou pela compilacao, mas falhou no typecheck.
- Erro principal: `Property 'snapshot' does not exist on type 'ForgeMrpState'`.
- Preview local quebrou com `Cannot read properties of undefined (reading 'items')`.
- O patch inventou APIs inexistentes no store e nos services, como `store.snapshot`, `store.applyBomDraft`, `store.commitOrder`, `store.setRequirements` e `store.appendAudit`.

Tambem foi solicitado reparo com o erro exato. Ate este registro, o reparo nao tinha sido concluido e o build continuava quebrado.

## Diagnostico do Faber Code

O Faber Code ainda nao se comporta como um agente de desenvolvimento completo porque:

- Nao monta um grafo confiavel entre UI, store, services, dominio e testes antes de editar.
- Aceita validacoes estaticas ou heuristicas como se fossem validacoes reais.
- Consegue gerar patches, mas nao garante consistencia cross-file.
- Ainda confunde scaffold visual com sistema operacional funcional.
- Nao aplica atomicidade suficiente: uma execucao marcada como falha deixou arquivo alterado e app quebrado.
- O loop de reparo nao conseguiu usar o erro real de build/runtime para recuperar o projeto.

## Avancos aplicados no Faber Code

Durante este ciclo, o repositorio do Faber Code recebeu ajustes para melhorar a orquestracao agentica e reduzir falsos positivos de conclusao:

- Fallback deterministico para o caso Forge MRP quando arquivos criticos ficam apenas com instrucoes textuais.
- Validacao para detectar arquivos criticos instrucionais antes de aceitar a entrega.
- Compact retry permitido para falhas por `output_limit`.
- Fila FIFO por provider para reduzir excesso de requisicoes simultaneas.
- Normalizacao de falhas de provider no loop de validacao/reparo.
- Bypass de contrato minimo para edicao, reparo e diagnostico de projeto existente.
- Classificacao melhor de pedidos de edicao pontual, Tailwind, CSS e TSX como `edit_project`.
- Reconhecimento de intencao de reparo runtime com verbos como corrigir, alterar, ajustar e editar.
- Aceite de `module.exports`/CommonJS como JavaScript valido na validacao.
- Testes atualizados cobrindo intake, runtime contract, render pass, validation, repair validation, provider queue e runtime budget.

Esses avancos ajudam o Faber Code a entender melhor quando deve editar um projeto existente e quando deve validar/reparar antes de declarar sucesso. Eles ainda nao resolvem a lacuna maior: transformar uma edicao gerada pela IA em uma mudanca atomica, testada e promovida apenas quando a aplicacao continua funcional.

## Direcao recomendada

Para se aproximar de uma ferramenta como o Codex, o Faber Code precisa:

- Rodar comandos reais obrigatorios antes de liberar alteracoes: `npm run build`, testes unitarios, Playwright e smoke visual.
- Aplicar patches em area temporaria e promover apenas se build/test/smoke passarem.
- Dar ao Executor acesso a grafo de imports, exports, tipos e chamadas.
- Exigir integracao real quando o briefing pedir persistencia: Postgres local, migrations, seed, PrismaClient, repositorios e testes de conexao.
- Diferenciar scaffold de funcionalidade operacional.
- Registrar evidencias de preview e logs como criterios de aceite, nao como pos-processamento opcional.
- Permitir um modo agentic com ciclo: observar, editar, testar, reparar, screenshot e resumo.

## Avanco aplicado nesta retomada

Nesta retomada, o trabalho continuou apenas no repositorio do Faber Code. O projeto `THE FORGE` nao foi corrigido manualmente, para preservar a evidencia do comportamento real da ferramenta.

Primeiro corte implementado:

- Novo servico `main/services/project_verified_execution_service.js`.
- O Executor passa a aplicar a acao em um clone temporario antes de promover para o projeto real.
- O clone temporario roda verificacao operacional real antes da promocao.
- Se a verificacao do clone falha, o projeto real permanece intocado.
- Se a verificacao passa, a mesma acao e promovida para o projeto real.
- O job agora registra fases/eventos `execute_staging`, `job.verified_execution_started` e `job.verified_execution_finished`.
- A verificacao de projeto ganhou modo estrito para exigir scripts reais de `build`, `test` e Playwright.
- O modo estrito bloqueia placeholder de teste como `no test specified`.
- Smoke visual com screenshot passa a ser forcado no gate de execucao verificada.

Evidencias de teste deste corte:

- `npm run test:project-verification`
- `npm run test:project-verified-execution`
- `npm run test:automata`
- `npm run test:product-toolchain-contract`
- `npm run test:project-visual-validation-runtime`
- `npm run test:ipc`
- `npm run test:architecture-boundary`
- `npm run test:runtime-module-contract`
- `npm run audit:test-hygiene`
- `npm run audit:public`
- `node --check main/services/project_verified_execution_service.js`
- `node --check main/services/project_verification_service.js`
- `node --check main.js`
- `node --check tests/project-verified-execution-service.test.js`
- `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json: ok')"`

O novo teste `project-verified-execution-service` comprova dois comportamentos centrais:

- Patch ruim falha no clone temporario e nao altera o projeto real.
- Patch valido passa pela verificacao temporaria e so entao e promovido.

Limites ainda pendentes:

- O grafo profundo de imports, exports, tipos e chamadas ainda precisa ser acoplado ao Executor.
- A matriz de aceite gerada a partir do briefing ainda precisa virar contrato explicito antes da implementacao.
- A exigencia de persistencia real com Docker/Postgres/Prisma ainda precisa virar gate operacional.
- O ciclo agentic completo ainda precisa fechar loop de observar, editar, testar, reparar, screenshot e resumo usando evidencias reais.
- O proximo smoke deve continuar no `THE FORGE` pela interface do Faber Code, deixando a ferramenta tentar reparar o erro real de build/runtime.

## Baseline operacional do THE FORGE nesta retomada

Em 2026-06-11 13:46 -03, o `THE FORGE` foi usado apenas como evidencia, sem correcao manual de codigo.

Evidencias coletadas:

- `npm run build` falhou de forma real no typecheck com `app/page.tsx:45:26` e `Property 'snapshot' does not exist on type 'ForgeMrpState'`.
- `npm test` passou com `tests/mrp.test.ts`: 6 testes, 1 arquivo.
- `npm run prisma` passou apenas na validacao de schema: `The schema at prisma/schema.prisma is valid`. Isso nao comprova conexao real com banco.
- `npm run test:e2e` falhou aguardando o `webServer` do Playwright porque o runtime quebrou em `Cannot read properties of undefined (reading 'items')` em `app/page.tsx:55:30`.
- Preview local abriu em `http://localhost:3000`, mas a captura headless ficou em branco por causa da quebra de runtime.
- Screenshot salva: `/private/tmp/forge-broken-before-faber-runtime-2026-06-11.png`.

Conclusao do baseline:

- O erro do Forge continua sendo evidencia valida para o teste de reparo agentic.
- O projeto nao foi alterado manualmente.
- A falha comprova que o patch anterior inventou contrato de store inexistente e que a validacao precisa usar build/test/runtime reais antes de promover alteracoes.

## Avanco adicional aplicado nesta retomada

Segundo corte implementado no Faber Code:

- Falhas da execucao verificada no clone temporario agora viram diagnosticos estruturados para o auto-reparo.
- O `assistant:execute` deixou de encerrar imediatamente quando o staging falha, desde que ainda exista passe de auto-reparo disponivel.
- O job registra bloqueio por `verified_execution` e replaneja com `latestDiagnostics` contendo comando, status e detalhe real da falha.
- O projeto real continua sem promocao quando `npm run build`, testes, Playwright ou smoke visual falham no clone.
- Playwright passou a ser `if_available`: obrigatorio quando o projeto declara script/config/dependencia Playwright, sem bloquear projetos que nao possuem E2E.

Evidencias de teste deste corte:

- `node tests/project-verified-execution-service.test.js`
- `node tests/project-verification-service.test.js`
- `npm run test:project-verified-execution`
- `npm run test:project-verification`
- `npm run test:post-execution-quality`
- `npm run test:project-visual-validation-runtime`
- `npm run test:ipc`
- `npm run test:assistant-flow`
- `npm run test:runtime-module-contract`
- `npm run test:architecture-boundary`
- `npm run audit:test-hygiene`
- `npm run audit:public`
- `node --check main/services/project_verified_execution_service.js`
- `node --check main/services/project_verification_service.js`
- `node --check main.js`
- `git diff --check`

O novo comportamento fecha uma lacuna importante do primeiro corte: a area temporaria nao serve apenas para rejeitar patches ruins; ela tambem passa a alimentar o loop de reparo com erro real antes que qualquer arquivo do projeto real seja alterado.

## Estado atual importante

O reposititorio Faber Code contem melhorias no roteamento, fallback, validacao, fila de providers e testes relacionados. O projeto `THE FORGE`, que fica fora deste repositorio e nao e um repo Git, permaneceu quebrado apos a tentativa de correcao do Faber Code.

## Stress test pela interface do Faber Code

Em 2026-06-11 14:15 -03, o Faber Code foi operado pela interface grafica, usando somente o projeto `THE FORGE`.

Fluxo executado:

- O app Faber Code foi aberto via Electron com debugging local.
- A tela inicial exigiu login.
- O login Google foi concluido usando a sessao do navegador do usuario, sem solicitar, ler ou registrar senha.
- O projeto `THE FORGE` foi selecionado na interface.
- Um prompt novo pediu reparo incremental do erro real, sem blueprint e sem recriar projeto, citando:
  - `Property 'snapshot' does not exist on type 'ForgeMrpState'`.
  - `Cannot read properties of undefined (reading 'items')`.
  - Arquivos que deveriam ser investigados: `app/page.tsx`, `src/store/mrp_store.ts`, `src/services/use-cases/mrp_service.ts`, `src/domain/mrp.ts` e testes.
  - Validacao real obrigatoria: build, testes, Playwright e smoke visual.

Resultado observado:

- O Faber Code exibiu fases visiveis como `Intake Cortex`, `Briefing da Persona`, `Render do Executor` e `Validacao`.
- O job `job-1781197190600-s05uk6` ficou preso em `cortex_validation`, com retries.
- A validacao chegou a relatar `cortex_validation_score:94`, mas continuou bloqueada por `artifactMinimum`.
- O job nao chegou a `execute_staging`.
- O job nao executou build/test/smoke real no projeto.
- O job nao alterou os arquivos fonte do `THE FORGE`; apenas logs/memoria `.faber` foram atualizados.
- O job foi cancelado manualmente para nao permanecer rodando.

Evidencias visuais coletadas:

- `/private/tmp/faber-code-ui-initial-2026-06-11.png`
- `/private/tmp/faber-code-after-google-login-2026-06-11.png`
- `/private/tmp/faber-code-the-forge-selected-2026-06-11.png`
- `/private/tmp/faber-code-repair-prompt-sent-2026-06-11.png`
- `/private/tmp/faber-code-repair-progress-01-2026-06-11.png`
- `/private/tmp/faber-code-repair-progress-02-2026-06-11.png`
- `/private/tmp/faber-code-repair-progress-03-2026-06-11.png`
- `/private/tmp/faber-code-repair-progress-04-2026-06-11.png`
- `/private/tmp/faber-code-repair-progress-05-2026-06-11.png`
- `/private/tmp/faber-code-repair-progress-06-2026-06-11.png`
- `/private/tmp/faber-code-repair-progress-07-2026-06-11.png`
- `/private/tmp/faber-code-repair-job-cancelled-2026-06-11.png`
- `/private/tmp/forge-broken-after-faber-ui-repair-2026-06-11.png`

Validacao real depois da tentativa pela UI:

- `npm run build` ainda falha com `app/page.tsx:45:26` e `Property 'snapshot' does not exist on type 'ForgeMrpState'`.
- `npm test` passa com `tests/mrp.test.ts`: 6 testes, 1 arquivo.
- `npm run prisma` passa apenas na validacao de schema; isso nao comprova banco real ou persistencia operacional.
- `npm run test:e2e` falha com timeout de 120000ms esperando o `webServer`, enquanto o runtime repete `Cannot read properties of undefined (reading 'items')` em `app/page.tsx:55:30`.
- O preview local em `http://localhost:3000` renderiza o overlay de erro do Next, capturado em `/private/tmp/forge-broken-after-faber-ui-repair-2026-06-11.png`.

Conclusao desta rodada:

- O Faber Code ainda nao consegue corrigir o erro real do `THE FORGE` quando operado como usuario pela interface.
- A ferramenta mostra fases do processo, mas ainda falha antes de aplicar patch temporario, executar validacao real e promover/reverter.
- O smoke funcional completo do Forge esta bloqueado porque a aplicacao nao builda e nao renderiza.
- Nao e possivel afirmar que cadastro/edicao de item, estoque, BOM, ordem de producao, MRP multinivel, audit log, reload/persistencia, validacao de formulario, erros amigaveis ou layout desktop/mobile funcionam no estado atual.
- O proximo trabalho deve atacar especificamente a transicao UI job -> staging execution -> validated repair, garantindo que falhas de validacao alimentem edicao real ou rollback, nao apenas retries de blueprint/artefato.

## Retomada e novo corte de runtime em 2026-06-11 15:12 -03

Nesta etapa, o foco continuou no runtime/orquestracao do Faber Code. Nao houve correcao manual do codigo-fonte do `THE FORGE`.

Mudancas aplicadas no Faber Code:

- Validacao de edicao/reparo deixou de ser bloqueada pelo minimo de artefato estatico antes de chegar a execucao real.
- Pedidos de reparo com erro de build/runtime passaram a ser roteados como `diagnostic_repair`, nao como conversa generica nem como acao de ferramenta isolada.
- Foi criado o servico `cortex/orchestration/acceptance_matrix_service.js`, gerando matriz de aceite a partir do briefing, com criterios obrigatorios de build, testes, Playwright, screenshots e persistencia quando o briefing pedir banco.
- A execucao verificada em staging passou a ter timeouts para verificacao operacional e validacao visual, para evitar jobs presos indefinidamente.
- O capture de browser/preview passou a aceitar `stopAfterCapture`, encerrando preview local apos screenshot quando solicitado.
- A store de jobs passou a recuperar jobs interrompidos no startup: jobs em `running`, `retry_pending` ou `paused_memory_pressure` viram `failed` com fase `runtime_interrupted`, em vez de ficarem eternamente em execucao.

Stress test pela UI apos esses cortes:

- Um novo prompt de reparo do `THE FORGE` foi aceito como execucao real.
- O job `job-1781200469359-abm4g3` chegou a `awaiting_user_confirmation` e gerou `acceptanceMatrix` com 12 itens pendentes.
- A UI mostrou a confirmacao e depois entrou em `execute_staging`.
- A execucao criou clone temporario fora do projeto real e aplicou a primeira alteracao em `.staging/acceptance_matrix.md`.
- O projeto real `THE FORGE` nao recebeu promocao de patch durante essa etapa.
- O staging iniciou Playwright/Next contra o clone, mas a execucao anterior ficou presa em `execute_staging` enquanto o preview local continuava vivo. Esse comportamento motivou os timeouts e `stopAfterCapture`.
- Apos reinicio com as correcoes, a UI ficou novamente bloqueada na tela `Conclua o login no navegador para continuar`; o reteste completo pela interface depende de concluir login Google manualmente no navegador.

Falha ainda aberta observada na UI:

- A validacao visual ainda pode aplicar criterio de pedido multipagina estatico em um reparo diagnostico, exibindo `Pedido multipagina estatico gerou 0 arquivo(s) HTML...`.
- Isso e falso positivo de contrato visual para reparo de projeto existente e precisa de correcao antes de considerar o fluxo agentic maduro.

Evidencias visuais novas:

- `/private/tmp/faber-code-after-runtime-fix-start-2026-06-11.png`
- `/private/tmp/faber-code-runtime-fix-default-mode-prompt-sent-2026-06-11.png`
- `/private/tmp/faber-code-runtime-fix-awaiting-confirmation-2026-06-11.png`
- `/private/tmp/faber-code-runtime-fix-confirmed-2026-06-11.png`
- `/private/tmp/forge-broken-after-faber-ui-repair-2026-06-11.png`

Validacao real executada no `THE FORGE` em 2026-06-11 15:09 -03:

- `npm run build`: falhou no typecheck com `app/page.tsx:45:26` e `Property 'snapshot' does not exist on type 'ForgeMrpState'`.
- `npm test`: passou com `tests/mrp.test.ts`, 6 testes em 1 arquivo.
- `npm run prisma`: passou apenas `prisma validate`; isso ainda nao prova Docker/Postgres, migration, seed, `PrismaClient`, repository/service ou conexao real.
- `npm run test:e2e`: falhou apos timeout de 120000ms esperando o `webServer`; durante a espera o runtime repetiu `Cannot read properties of undefined (reading 'items')` em `app/page.tsx:55:30`.
- Apos o e2e, nao ficou processo `next dev` vivo.
- Os comandos tocaram artefatos como `.next`, `next-env.d.ts` e `test-results`, mas nao houve edicao manual de fonte do `THE FORGE`.

Validacao real executada no repositorio Faber Code:

- `npm run build`: falhou porque o repositorio nao possui script `build`; isso tambem foi registrado como comando real falho.
- `npm test`: falhou porque o repositorio nao possui script `test`; isso foi registrado como comando real falho, nao como sucesso declarado.
- `npm run test:acceptance-matrix`: passou.
- `npm run test:validation-service`: passou.
- `npm run test:project-verification`: passou.
- `npm run test:project-verified-execution`: passou.
- `npm run test:project-visual-validation-runtime`: passou.
- `npm run test:post-execution-quality`: passou.
- `npm run test:orchestration-state`: passou.
- `npm run test:runtime-module-contract`: passou.
- `npm run test:architecture-boundary`: passou.
- `npm run audit:test-hygiene`: passou, 430 arquivos checados.
- Checks diretos com `node --check` passaram para `main.js`, `cortex/orchestration/state_store.js`, `cortex/orchestration/state_store_jobs.js`, `main/services/project_verified_execution_service.js` e `main/services/faber_capability_adapter_service.js`.

Estado dos requisitos principais:

- Validacao real obrigatoria: parcialmente implementada e coberta por testes; falta comprovar o ciclo completo pela UI apos login.
- Patch temporario antes de promover: implementado em servico e comprovado por teste; observado pela UI entrando em `execute_staging`.
- Grafo de Executor: ainda pendente; os ajustes de rota ajudam, mas nao entregam grafo profundo de imports, exports, tipos, chamadas e arquivos relacionados.
- Modo agentic: parcialmente implementado por fases, staging, reparo e evidencias; ainda falta fechar o loop completo pela UI com screenshot e resumo final.
- Shell/browser/logs/diff/rollback: parcialmente integrado; shell, preview, screenshot e rollback/staging tem cobertura, mas Prisma/Postgres local e logs expansivos ainda precisam de gate operacional completo.
- Matriz de aceite: servico criado e job real gerou matriz com 12 itens; falta a UI tratar cada item como checklist com evidencia anexada.
- Persistencia real quando briefing pede banco: ainda pendente como gate. `prisma validate` nao basta.

Ponto exato de parada desta etapa:

- O `THE FORGE` segue quebrado e ainda e a evidencia principal.
- O Faber Code ja consegue chegar mais perto da execucao verificada, mas o reteste UI completo esta bloqueado por login Google pendente.
- Nenhum commit deve ser criado sem autorizacao explicita.
- Proximo passo recomendado: concluir login manualmente, reenviar o reparo no `THE FORGE`, confirmar execucao, verificar se o job entra em staging, falha com diagnostico real ou repara, e repetir build/test/e2e/screenshot ate promover apenas se tudo passar.

Ponto exato de parada:

- Nao continuar testando nos projetos `MAURICIO TREMN` ou `FABER-TREMN-UI-SMOKE`; o foco deve permanecer apenas em `THE FORGE`.
- Nao corrigir manualmente o `THE FORGE` sem uma decisao explicita, para nao contaminar a avaliacao da capacidade real do Faber Code.
- O proximo teste deve verificar se o Faber Code consegue reparar o build quebrado usando o erro real de TypeScript/runtime, sem inventar APIs inexistentes.
- Depois do reparo, repetir o ciclo completo: build, testes, smoke manual como usuario, screenshots e validacao funcional de cada modulo.
- Evidencias locais disponiveis: `/private/tmp/forge-functional-smoke-results.json`, `/private/tmp/forge-func-00-inicial.png`, `/private/tmp/forge-func-03-bom-nao-afeta-mrp.png`, `/private/tmp/forge-func-06-mrp-qtd-8.png` e `/private/tmp/forge-after-faber-bom-broken.png`.

## Comunicacao de jobs estilo Codex em 2026-06-11 16:35 -03

Motivo desta etapa:

- A UI do Faber Code estava escondendo o diagnostico real do job e exibindo `Motivo tecnico: 81` para uma falha `cortex_validation_score:81`.
- Isso deixava o usuario sem saber o que a ferramenta tentou, quais fases rodaram, quais checks bloquearam, quais arquivos estavam envolvidos e qual deveria ser a proxima acao.

Mudancas aplicadas no Faber Code:

- `renderer/ux_state_model.js` agora transforma motivos como `cortex_validation_score:81`, `cortex_validation_unmet`, `cortex_patchfirst_guardrail` e `cortex_briefing_error` em frases humanas.
- A apresentacao de job agora le `checkpoints.cortex_runtime.workGraph.validationResults` para mostrar:
  - score tecnico e minimo;
  - checks bloqueados;
  - arquivos com conteudo invalido;
  - qualidade/aderencia do artefato;
  - preview do diagnostico do Executor;
  - proxima acao sugerida.
- Fases finais como `cortex_validation_retry_exhausted`, `cortex_briefing_retry_exhausted`, `persona_retry_exhausted` e `runtime_interrupted` ganharam labels legiveis.
- O painel continua deixando a timeline tecnica em expansor, com checkpoints, tentativas e retentativas consultaveis.
- `renderer/job_progress.js` recebeu fallback para nao voltar a renderizar erro cru se `FaberUxStateModel` nao estiver disponivel.
- `tests/renderer-ux-state-model.test.js` recebeu regressao especifica garantindo que `cortex_validation_score:81` nao vire `Motivo tecnico: 81`.

Validacao real executada nesta etapa:

- `node --check renderer/ux_state_model.js`: passou.
- `node --check renderer/job_progress.js`: passou.
- `node tests/renderer-ux-state-model.test.js`: passou.
- `npm run test:renderer-ux-state`: passou.
- `npm run test:renderer-job-progress`: passou.
- `npm run test:renderer-module-contract`: passou.

Validacao pela UI do Faber Code usando `THE FORGE`:

- A janela do Faber Code foi recarregada por DevTools local.
- O projeto `THE FORGE` foi selecionado pela funcao real `selectProject(projectId)` do renderer.
- O job real mais recente continuava sendo `job-1781205438453-r28du7`, `failed`, fase `cortex_validation_retry_exhausted`, `lastError = cortex_validation_score:81`.
- O painel renderizou:
  - `Falha | Validacao esgotada | 100%`;
  - fases com 3 tentativas;
  - `Parei esta rodada: Validacao Cortex bloqueou a execucao: score 81%`;
  - `Validacao tecnica: 81% / minimo 55%`;
  - bloqueios: conteudo invalido, CSS visual insuficiente, qualidade/aderencia abaixo do minimo;
  - arquivos invalidos: `app/page.tsx`, `src/services/use-cases/mrp_service.ts`, `src/store/mrp_store.ts`, `tests/forge-mrp.spec.ts` e mais 4;
  - qualidade/aderencia do artefato `58% / minimo 70%`;
  - proxima acao: corrigir a causa e repetir o ciclo de teste antes de marcar concluido.
- O expansor `Ver caminho da execucao` abriu corretamente e mostrou a timeline tecnica com `Job iniciado`, fases, checkpoints, retentativas e motivos compactados em linguagem humana.

Screenshots novas:

- Painel com diagnostico humano sem selecionar projeto: `/private/tmp/faber-code-job-communication-after-final-2026-06-11.png`
- Expansor tecnico aberto: `/private/tmp/faber-code-job-communication-expanded-2026-06-11.png`
- Evidencia limpa com `THE FORGE` selecionado e painel de arquivos visivel: `/private/tmp/faber-code-job-communication-selected-forge-2026-06-11.png`

Estado apos esta etapa:

- A comunicacao de falhas do job melhorou e deixou de exigir que o usuario adivinhe o significado de codigos como `81`.
- Isso ainda nao repara o `THE FORGE`; apenas torna o runtime mais transparente para o proximo ciclo de reparo real.
- O proximo passo continua sendo fazer o Faber Code corrigir o erro funcional do `THE FORGE` em staging, rodar build/test/e2e/smoke visual e promover somente se passar.
- Nenhum commit foi criado; aguardar autorizacao explicita.

## Loop backend/staging e comunicacao limpa em 2026-06-11 21:15 -03

Objetivo desta etapa:

- Fazer o Faber Code tentar reparar `THE FORGE` pela UI como usuario, exigindo frontend + backend local com Postgres/Prisma.
- Confirmar se o patch vai primeiro para staging e so e promovido se build, testes, Playwright, smoke visual e persistencia real passarem.
- Remover do chat a mensagem tecnica pre-execucao do tipo `Cortex renderizou... A Persona preparou... Validacao marcou...`, porque ela confundia o usuario antes de qualquer execucao real.

Stress test pela UI usando apenas `THE FORGE`:

- O Faber Code foi reiniciado com debug local em `127.0.0.1:9333`.
- O gate de login foi destravado com conta local descartavel; nao foi usada senha Google.
- O projeto `THE FORGE` foi selecionado.
- Foi enviado prompt pedindo reparo dos erros reais:
  - `Property snapshot does not exist on type ForgeMrpState`;
  - `Cannot read properties of undefined reading items`;
  - backend local com `docker-compose.yml`, Postgres, Prisma schema, migration, seed, PrismaClient, repository/service, API routes e `db:check`;
  - promocao apenas apos `db:up`, `db:generate`, `db:migrate`, `db:seed`, `db:check`, build, testes, Playwright e screenshot.
- O job `job-1781223236053-nl1d6m` chegou a confirmacao com 28 operacoes.
- Apos confirmar, o Faber criou clone temporario em `/private/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-verified-8379f3f3cc12-xRaZ6Y`.
- O clone continha os artefatos de backend que faltavam no ciclo anterior:
  - `docker-compose.yml`;
  - `prisma/migrations/202606110001_init/migration.sql`;
  - `scripts/seed.mjs`;
  - `scripts/db-check.mjs`;
  - `src/server/prisma.ts`;
  - `src/server/forge_repository.ts`;
  - `app/api/forge/**/route.ts`.
- O projeto real `THE FORGE` nao recebeu esses arquivos, confirmando que a promocao nao ocorreu antes do gate.

Falhas observadas no runtime:

- A verificacao operacional falhou por timeout global: `Verificacao operacional excedeu 180000ms`.
- O job registrou `promoted:false`, o que preservou o projeto real.
- Porem o timeout era apenas logico: subprocessos do clone continuaram vivos depois do timeout/cancelamento.
- O auto-retry criou varios clones e comandos concorrentes (`next build`, `next dev`, Playwright, Vitest, `db:seed`) mesmo apos cancelamento.
- A ordem dos gates ainda permitia gastar tempo com build/e2e antes de bloquear cedo em persistencia operacional.

Correcoes aplicadas no Faber Code:

- `main/services/command_runner.js` passou a:
  - iniciar comandos em grupo de processo quando possivel;
  - aceitar `AbortSignal`;
  - matar a arvore de processos com `SIGTERM` e fallback `SIGKILL`;
  - reportar `aborted` e `timedOut`.
- `main/services/project_verified_execution_service.js` passou a:
  - criar `AbortController` para a verificacao em staging;
  - abortar a verificacao quando o timeout global dispara.
- `main/services/project_verification_service.js` passou a:
  - rodar gates de persistencia antes de build/test/Playwright quando banco e requisito;
  - encadear `db:up -> db:generate -> db:migrate -> db:seed -> db:check`;
  - bloquear build/test/e2e se um gate obrigatorio de persistencia falhar.
- `renderer/app_formatters.js`, `renderer/app_actions.js` e `renderer/app_jobs.js` passaram a:
  - suprimir mensagens intermediarias quando o plano ja tem acao;
  - nao publicar a frase tecnica pre-execucao no chat;
  - mostrar confirmacao curta: `Pronto para executar em uma area temporaria. So aplico no projeto se passar na validacao real.`;
  - trocar o resumo final longo por uma frase curta em linguagem simples;
  - manter detalhes no painel/expansor de progresso.
- Novo teste `tests/renderer-app-formatters.test.js` trava a regressao: plano com acao nao vira chat e a mensagem final nao contem `Resumo da execucao`, `Criterios de aceite`, `Diff util` ou lista tecnica.

Validacao real executada:

- `node --check main/services/command_runner.js`: passou.
- `node --check main/services/project_verified_execution_service.js`: passou.
- `node --check main/services/project_verification_service.js`: passou.
- `node --check renderer/app_formatters.js`: passou.
- `node --check renderer/app_actions.js`: passou.
- `node --check renderer/app_jobs.js`: passou.
- `node tests/command-runner.test.js`: passou.
- `node tests/project-verification-service.test.js`: passou.
- `node tests/project-verified-execution-service.test.js`: passou.
- `node tests/renderer-app-formatters.test.js`: passou.
- `node tests/renderer-module-contract.test.js`: passou.
- `node tests/renderer-ux-state-model.test.js`: passou.
- `npm run test:renderer-job-progress`: passou.
- `npm run test:renderer-ux-state`: passou.
- Tentativa invalida registrada: `node tests/renderer-job-progress.test.js` falhou porque esse arquivo nao existe; o check correto e `npm run test:renderer-job-progress`.

Evidencias visuais novas:

- Estado inicial apos login local: `/private/tmp/faber-communication-clean-after-login-2026-06-11.png`.
- Job real de smoke ainda em validacao: `/private/tmp/faber-communication-clean-pending-2026-06-11.png`.
- Job real cancelado sem executar patch: `/private/tmp/faber-communication-clean-smoke-cancelled-2026-06-11.png`.
- Estado controlado de confirmacao limpa, sem frase tecnica pre-execucao: `/private/tmp/faber-communication-clean-controlled-pending-2026-06-11.png`.
- Estado controlado final com frase curta e `Ver caminho da execucao`: `/private/tmp/faber-communication-clean-controlled-final-2026-06-11.png`.

Ponto exato de parada:

- `THE FORGE` continua sem promocao manual ou direta nesta rodada; a ausencia de `docker-compose.yml`, migrations, `scripts/*.mjs`, `src/server/*` e `app/api/*` no projeto real foi confirmada apos os testes.
- O Faber Code agora gera artefatos de backend no clone temporario e bloqueia promocao quando a validacao nao fecha.
- Ainda falta retestar o fluxo completo com a nova abortabilidade/cancelamento para confirmar que nao sobram subprocessos nem clones concorrentes.
- Ainda falta o Executor ter grafo profundo real de imports, exports, tipos, chamadas e contratos UI/store/services/dominio antes de editar.
- Nenhum commit foi criado; aguardar autorizacao explicita.

## Loop timeout/cancelamento em staging em 2026-06-11 22:45 -03

Objetivo desta etapa:

- Fechar o ponto pendente do loop anterior: confirmar que timeout/cancelamento nao deixa subprocessos orfaos nem retries concorrentes.
- Fazer o teste pela UI real do Faber Code, operando apenas o projeto `THE FORGE`.
- Confirmar que cancelamento durante `execute_staging` aborta a execucao ativa e preserva o projeto real.

Correcoes aplicadas nesta etapa:

- `main.js` passou a manter um `AbortController` ativo por `jobId` durante `assistant:execute`.
- `orchestration:jobs:cancel` passou a chamar `abortActiveJobExecution(jobId)` antes de marcar o job como cancelado.
- O loop de execucao agora verifica cancelamento antes/depois de staging, relatorios de qualidade, validacao visual e auto-reparo.
- Cancelamento deixou de cair no caminho generico de falha: agora retorna `cancelled:true` e registra `assistant.execute_cancelled`.
- `project_verified_execution_service` passou a propagar sinal externo para a verificacao em staging e nao iniciar smoke visual quando a verificacao ja foi abortada.
- `project_preview_runtime_service` passou a aceitar abort no install/preview, iniciar processos em grupo quando possivel e matar arvore de processo com `SIGTERM` e fallback `SIGKILL`.
- `project_visual_validation_runtime_service` passou a respeitar abort antes de abrir preview e entre capturas.

Testes automatizados executados:

- `node --check main.js`: passou.
- `node --check main/ipc/orchestration_handlers.js`: passou.
- `node --check main/services/project_verified_execution_service.js`: passou.
- `node --check main/services/project_preview_runtime_service.js`: passou.
- `node --check main/services/project_visual_validation_runtime_service.js`: passou.
- `npm run test:command-runner`: passou.
- `npm run test:orchestration-ipc`: passou.
- `npm run test:project-verified-execution`: passou.
- `npm run test:project-preview-runtime`: passou.
- `npm run test:project-verification`: passou.
- `git diff --check`: passou.

Smoke real pela UI do Faber Code:

- O Faber Code foi iniciado com `npm run dev -- --remote-debugging-port=9333`.
- O projeto `THE FORGE` foi selecionado pela interface.
- Foi enviado prompt real de reparo controlado para os erros:
  - `Property snapshot does not exist on type ForgeMrpState`;
  - `Cannot read properties of undefined reading items`.
- Primeiro smoke: cancelamento em `awaiting_user_confirmation`.
  - Resultado esperado: status `cancelled`, sem subprocessos, `executionAbort.aborted:false` porque nao havia execucao ativa.
- Segundo smoke: confirmacao da execucao e cancelamento durante `execute_staging`.
  - Job: `job-1781228648223-aerrit`.
  - Antes do cancelamento: `status: running`, `phase: execute_staging`, `progressPct: 76`.
  - Evento ativo: `job.verified_execution_started`.
  - Cancelamento retornou `executionAbort.aborted:true`.
  - Estado final: `status: cancelled`, `phase: cancelled`, `retryable:false`, `progressPct: 100`.

Evidencias visuais desta etapa:

- Tela inicial do Faber Code: `/private/tmp/faber-cancel-loop-initial.png`.
- `THE FORGE` selecionado: `/private/tmp/faber-cancel-loop-forge-inspected.png`.
- Prompt de cancelamento enviado: `/private/tmp/faber-cancel-loop-prompt-sent.png`.
- Cancelamento antes de execucao ativa: `/private/tmp/faber-cancel-loop-cancelled.png`.
- Segundo prompt preparado: `/private/tmp/faber-cancel-loop-second-prompt.png`.
- Job em confirmacao: `/private/tmp/faber-cancel-loop-second-jobs-2.png`.
- Cancelamento durante staging: `/private/tmp/faber-cancel-loop-staging-cancelled.png`.
- Estado final dos jobs: `/private/tmp/faber-cancel-loop-final-jobs.png`.

Validacao contra orfaos e promocao indevida:

- `pgrep -fl 'faber-verified|next build|next dev|playwright test|docker compose|prisma|vitest|npm run build|npm test'`: sem resultados apos o cancelamento.
- `pgrep -fl 'Electron .*localcode|remote-debugging-port=9333|Faber|faber-verified|next build|next dev|playwright test|docker compose|prisma|vitest|npm run build|npm test'`: sem resultados apos encerrar o app.
- Busca por arquivos modificados nos ultimos minutos em `THE FORGE` encontrou apenas:
  - `<THE_FORGE>/.faber/memory/job-1781228648223-aerrit.jsonl`;
  - `<THE_FORGE>/.faber/memory/project.jsonl`;
  - `<THE_FORGE>/.faber/memory/job-1781228522349-sz47r6.jsonl`.
- Isso indica registro de memoria/evidencia do Faber, sem promocao do patch preparado para os arquivos reais da aplicacao.

Ponto exato de parada atualizado:

- O loop de timeout/cancelamento que estava pendente foi validado com teste automatizado e smoke real pela UI.
- O Faber Code agora aborta a execucao ativa durante staging e nao deixa subprocessos de build/preview/teste rodando apos cancelamento.
- `THE FORGE` continua sendo evidencia do comportamento do Faber Code; nao foi corrigido manualmente nesta etapa.
- O proximo loop deve voltar para capacidade de reparo funcional do `THE FORGE`: grafo profundo do Executor, correcao dos erros `snapshot/items`, persistencia real Postgres/Prisma e validacao completa antes de promover.
- Nenhum commit foi criado; aguardar autorizacao explicita.

## Consolidado do contexto antes do commit em 2026-06-12

Objetivo central deste contexto:

- Aproximar o Faber Code de um agente de desenvolvimento real, operando em ciclo de observar, planejar, editar, testar, reparar, validar visualmente e resumir.
- Reduzir o comportamento de gerador de blueprints/patches que declara validacao sem executar evidencias reais.
- Usar somente `THE FORGE` como stress test, preservando seu estado quebrado como evidencia do comportamento real do Faber Code.
- Nao corrigir manualmente `THE FORGE`; as mudancas devem tornar o Faber Code capaz de detectar, isolar, reparar, validar ou reverter falhas.

Avancos implementados no runtime/orquestracao:

- Matriz de aceite:
  - Novo servico `cortex/orchestration/acceptance_matrix_service.js`.
  - O briefing agora gera uma matriz de aceite estruturada antes da implementacao.
  - A matriz separa itens funcionais, visuais, persistencia, validacao tecnica e evidencias esperadas.
  - O `workGraph.acceptanceMatrix` passa a acompanhar o job para orientar render, validacao e comunicacao.

- Visao de grafo para o Executor:
  - `main/runtime/project_context.js` passou a produzir contexto de imports, exports, tipos, chamadas, scripts, arquivos relacionados e sinais de persistencia.
  - Render, intake, policy gate, blueprint e validacao agora recebem mais contexto sobre UI, store, services, dominio e testes.
  - A melhoria ainda e inicial; o proximo loop precisa aprofundar a prova operacional de contratos entre UI, store, services, dominio e API.

- Execucao verificada em staging:
  - `main/services/project_verified_execution_service.js` passou a executar patches em clone temporario antes de promover para o projeto real.
  - A promocao fica bloqueada se build, testes, gates de persistencia ou validacao visual falharem.
  - No stress test real, o Faber criou backend local e artefatos Prisma/Postgres dentro do clone temporario, mas nao promoveu para `THE FORGE` porque a validacao nao fechou.

- Comandos reais obrigatorios:
  - `main/services/project_verification_service.js` passou a decidir e executar comandos reais em vez de aceitar validacao declarada.
  - Quando persistencia e requisito, os gates rodam antes de build/e2e: `db:up`, `db:generate`, `db:migrate`, `db:seed`, `db:check`.
  - Build, testes unitarios, Playwright e smoke visual entram como gates tecnicos conforme scripts/capacidades do projeto.

- Persistencia real:
  - O briefing que pede banco agora ativa requisitos de Docker/Postgres, Prisma, migrations, seed, PrismaClient, repository/service e teste real de conexao.
  - A validacao bloqueia o fluxo se o backend local nao existir ou se os comandos de banco falharem.
  - O stress test confirmou geracao dos artefatos de backend em staging, mas ainda falta um loop completo em que Postgres/Prisma subam e validem ate o fim.

- Timeout, cancelamento e rollback operacional:
  - `main/services/command_runner.js` agora aceita abort, inicia subprocessos em grupo quando possivel e tenta matar a arvore com `SIGTERM` e fallback `SIGKILL`.
  - `main.js` mantem `AbortController` ativo por job durante execucao.
  - `orchestration:jobs:cancel` aborta a execucao ativa antes de marcar o job como cancelado.
  - Preview runtime, visual validation runtime e verified execution respeitam `AbortSignal`.
  - O smoke real confirmou cancelamento durante `execute_staging` com `executionAbort.aborted:true`, sem promocao indevida e sem processos orfaos.

- Comunicacao de acao no estilo Codex:
  - O chat deixou de publicar a frase tecnica pre-execucao do tipo `Cortex renderizou...`.
  - Antes de executar, a UI agora mostra uma confirmacao curta e humana.
  - Durante o trabalho, o painel exibe fases, progresso, etapa atual e linha de execucao.
  - Detalhes longos ficam no expansor/log consultavel.
  - No final, a resposta do chat fica curta e leiga, enquanto diagnostico, checkpoints, retries, arquivos invalidos e scores ficam no painel.

- Recuperacao de jobs:
  - `cortex/orchestration/state_store_jobs.js` passou a registrar retry, cancelamento e recuperacao de jobs interrompidos.
  - `main.js` chama recuperacao de jobs interrompidos na inicializacao.
  - Jobs cancelados nao voltam como retry concorrente.

Evidencias de stress test com `THE FORGE`:

- A UI do Faber Code foi operada com `THE FORGE` selecionado.
- O erro real usado como alvo foi:
  - `Property 'snapshot' does not exist on type 'ForgeMrpState'`;
  - `Cannot read properties of undefined (reading 'items')`.
- O Faber tentou reparar em staging e gerou artefatos de backend local no clone temporario:
  - `docker-compose.yml`;
  - `prisma/migrations/202606110001_init/migration.sql`;
  - `scripts/seed.mjs`;
  - `scripts/db-check.mjs`;
  - `src/server/prisma.ts`;
  - `src/server/forge_repository.ts`;
  - `app/api/forge/**/route.ts`.
- A promocao para o projeto real nao ocorreu quando a validacao falhou ou foi cancelada.
- Apos o cancelamento em staging, a busca por processos de build, preview, Playwright, Docker, Prisma, Vitest e npm nao retornou processos vivos.
- A busca por arquivos recentes em `THE FORGE` encontrou apenas memoria `.faber`, sem alteracao dos arquivos reais da aplicacao.

Screenshots/evidencias visuais principais deste contexto:

- `/private/tmp/faber-code-job-communication-after-final-2026-06-11.png`
- `/private/tmp/faber-code-job-communication-expanded-2026-06-11.png`
- `/private/tmp/faber-code-job-communication-selected-forge-2026-06-11.png`
- `/private/tmp/faber-communication-clean-after-login-2026-06-11.png`
- `/private/tmp/faber-communication-clean-pending-2026-06-11.png`
- `/private/tmp/faber-communication-clean-smoke-cancelled-2026-06-11.png`
- `/private/tmp/faber-communication-clean-controlled-pending-2026-06-11.png`
- `/private/tmp/faber-communication-clean-controlled-final-2026-06-11.png`
- `/private/tmp/faber-cancel-loop-initial.png`
- `/private/tmp/faber-cancel-loop-forge-inspected.png`
- `/private/tmp/faber-cancel-loop-prompt-sent.png`
- `/private/tmp/faber-cancel-loop-cancelled.png`
- `/private/tmp/faber-cancel-loop-second-prompt.png`
- `/private/tmp/faber-cancel-loop-second-jobs-2.png`
- `/private/tmp/faber-cancel-loop-staging-cancelled.png`
- `/private/tmp/faber-cancel-loop-final-jobs.png`

Validacoes automatizadas executadas neste contexto:

- `node --check main.js`
- `node --check main/ipc/orchestration_handlers.js`
- `node --check main/services/project_verified_execution_service.js`
- `node --check main/services/project_preview_runtime_service.js`
- `node --check main/services/project_visual_validation_runtime_service.js`
- `node --check main/services/command_runner.js`
- `node --check main/services/project_verification_service.js`
- `node --check renderer/app_formatters.js`
- `node --check renderer/app_actions.js`
- `node --check renderer/app_jobs.js`
- `node --check renderer/ux_state_model.js`
- `node --check renderer/job_progress.js`
- `node tests/command-runner.test.js`
- `node tests/project-verification-service.test.js`
- `node tests/project-verified-execution-service.test.js`
- `node tests/project-preview-runtime-service.test.js`
- `node tests/orchestration-handlers.test.js`
- `node tests/renderer-app-formatters.test.js`
- `node tests/renderer-module-contract.test.js`
- `node tests/renderer-ux-state-model.test.js`
- `npm run test:command-runner`
- `npm run test:orchestration-ipc`
- `npm run test:project-verified-execution`
- `npm run test:project-preview-runtime`
- `npm run test:project-verification`
- `npm run test:renderer-job-progress`
- `npm run test:renderer-ux-state`
- `git diff --check`

Limites conhecidos que continuam para os proximos loops:

- O reparo funcional completo de `THE FORGE` ainda nao foi concluido nem promovido; isso permanece propositalmente como proximo stress test do Faber Code.
- O app `THE FORGE` ainda precisa passar por build, testes, Playwright, smoke visual desktop/mobile e teste funcional completo depois que o Faber Code fizer o reparo real.
- A visao de grafo do Executor ja existe como contexto inicial, mas ainda precisa ser provada num reparo real que consulte contratos entre UI, store, services, dominio, API e testes antes de editar.
- A persistencia real com Docker/Postgres/Prisma ja virou gate obrigatorio quando solicitada, mas ainda precisa passar em um fluxo end-to-end completo com container, migration, seed, PrismaClient, repository/service, API e UI consumindo dados persistidos.
- O proximo loop deve pedir ao Faber Code para reparar `THE FORGE` novamente, agora com cancelamento, staging, gates de persistencia, matriz de aceite e comunicacao limpa ativos.

Decisao de encerramento deste contexto:

- A autorizacao explicita para commitar foi recebida em 2026-06-12.
- Este documento registra o ponto exato antes do commit: runtime/orquestracao melhorados, smoke real de cancelamento aprovado, `THE FORGE` preservado como evidencia e reparo funcional completo ainda pendente para o proximo loop.

## Reescrita de historico publico em 2026-06-12

Objetivo desta etapa:

- Auditar o historico publicado no GitHub para decidir se bastava corrigir o estado atual ou se era melhor remover o historico antigo.
- Garantir que a area publica do repositorio ficasse reduzida ao snapshot seguro atual, sem commits antigos com caminhos locais absolutos ou `package-lock` historico vulneravel.

Auditoria executada antes da decisao:

- `git fetch origin main` para auditar exatamente o que estava publicado.
- Scan do historico inteiro de `origin/main` por:
  - chaves OpenAI, Google, GitHub, AWS, Slack, Vercel;
  - blocos de chave privada;
  - `.env` versionado;
  - caminhos absolutos locais e outros sinais de public safety.
- Auditoria de snapshots historicos de `package-lock.json` com `npm audit --package-lock-only --json`.

Conclusao da auditoria:

- Nao foram encontrados segredos reais no historico publicado:
  - nenhum `.env` real rastreado;
  - nenhuma API key ou token real nos pads conhecidos;
  - nenhuma chave privada versionada.
- Foram encontrados dois tipos de risco historico:
  - caminhos absolutos locais em documentacao e um fixture de teste;
  - snapshots antigos de `package-lock.json` com vulnerabilidades conhecidas, primeiro em cadeias antigas de `electron/electron-builder/tar/tmp` e depois em `tmp < 0.2.6`.
- O estado atual ja estava seguro:
  - `npm audit`: `0 vulnerabilities`;
  - `npm run audit:public`: passou.

Decisao tomada:

- Mesmo sem vazamento de segredo real, foi aprovada a reescrita de historico para reduzir a superficie publica do repositorio.
- Em vez de reescrever commits um a um, foi criada uma nova raiz publica contendo apenas o snapshot seguro atual.

Procedimento executado:

- Backup local preservado em `backup/pre-public-history-rewrite-2026-06-12`.
- Branch orfa criada para gerar a nova raiz publica.
- Snapshot seguro restaurado a partir do backup local.
- Novo commit raiz criado:
  - `e9d3f3f5b07878825aa8c044af6b906ed55be270`
  - `Create sanitized public history baseline`
- `main` local foi reposicionada para essa nova raiz.
- `git push --force-with-lease origin main` substituiu o historico antigo no GitHub.

Estado apos a reescrita:

- `origin/main` agora aponta para `e9d3f3f5b07878825aa8c044af6b906ed55be270`.
- A branch publica passou a ter um unico commit de baseline seguro.
- O historico antigo permanece somente no backup local, fora da linha publica principal.

Impacto operacional:

- Quem tiver clone antigo do repositorio precisara reclonar ou sincronizar com reset forte/manual, porque a `main` publicada foi substituida.
- Links para commits antigos da `main` deixam de representar a linha publica principal do projeto.
- O proximo trabalho deve continuar a partir desta nova baseline publica segura.
