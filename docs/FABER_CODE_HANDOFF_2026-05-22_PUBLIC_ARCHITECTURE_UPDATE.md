# Faber Code - Handoff de Continuidade Publica e Arquitetural

Data: 2026-05-22  
Repositorio publico: `git@github.com:Eduardo-Frigo/fabercode.git`  
Branch: `main`  
Ultimo commit publico enviado: `cf8ba00 Prepare public architecture update`

## Objetivo deste documento

Este handoff registra o progresso feito na rodada de smoke tests, limpeza arquitetural e preparacao de commit publico seguro. Ele deve ser usado para retomar o trabalho em uma nova conversa sem perder o contexto do que foi corrigido, validado e publicado.

O estado local continua contendo material privado e dependencias locais ignoradas pelo Git. O estado publico no GitHub foi atualizado apenas com codigo, documentacao, testes e assets considerados seguros.

## Resumo executivo

O Faber Code avancou de uma arquitetura ainda muito centralizada para uma base mais modular, testavel e publicavel.

Resultados desta rodada:

- UX/UI: integridade arquitetural considerada 100% para este ciclo de smoke test.
- Produto/orquestracao: integridade arquitetural considerada 100% para este ciclo de smoke test.
- Commit publico criado e enviado para `origin/main`.
- Auditoria publica passou.
- Suite arquitetural completa passou.
- `.gitignore` foi reforcado para impedir commit acidental de segredos, memoria local, modelos, bancos, workspaces e artefatos de smoke test.

Importante: "100%" aqui significa que as fronteiras e contratos necessarios para a fase atual estao limpos e validados por testes. Nao significa que o produto final esta completo; significa que a arquitetura esta pronta para o proximo ciclo de evolucao.

## Contexto que levou a esta rodada

Um smoke test recente pediu uma landing page de venda de estufas agricolas, residenciais e comerciais. A resposta gerada inicialmente saiu fora do dominio esperado e apresentou uma pagina com conteudo de clinica odontologica, placeholders genericos e estrutura pouco aderente ao briefing.

A conclusao foi que o problema nao era apenas visual. Havia uma rigidez excessiva no fluxo de blueprint e uma mistura de responsabilidades que dificultava:

- detectar corretamente o dominio do pedido;
- escolher entre blueprint, geracao adaptativa e edicao incremental;
- preservar contexto de produto;
- gerar uma plataforma visualmente completa mesmo quando o pedido do usuario e simples;
- reaproveitar modulos aprovados como biblioteca pessoal do usuario;
- manter contratos temporarios sem poluir a arquitetura principal.

A direcao definida foi trabalhar de forma modular:

- headers diferentes;
- heroes normais, full width, com video e sem video;
- secoes de beneficios, modelos, testemunhos, FAQ, formularios, calculadoras e icones;
- footers diferentes;
- contratos temporarios quando o usuario solicita algo que ainda nao existe na biblioteca;
- possibilidade de transformar contratos aprovados em biblioteca pessoal por mecanismo de commit/aprovacao.

## Decisoes arquiteturais desta rodada

### 1. Produto nao deve depender de uma blueprint rigida

O Faber Code deve decidir o caminho de construcao com base em fatos do projeto, brief normalizado e intencao do usuario. O objetivo e evitar que toda geracao caia em uma composicao unica ou em um fallback generico.

Novos blocos importantes:

- `cortex/orchestration/working_brief_service.js`
- `cortex/orchestration/build_mode_router_service.js`
- `cortex/orchestration/product_policy_gate_service.js`
- `cortex/orchestration/product_orchestrator_service.js`
- `cortex/orchestration/product_contract_service.js`

Esses modulos formam a camada de decisao entre conversa humana, IA, blueprint, executor e validacao.

### 2. Blueprints foram quebradas em pecas

O antigo `project_blueprint_service.js` foi reduzido e passou a delegar para modulos de layout, templates, copy, request, utilitarios e variantes.

Modulos adicionados ou consolidados:

- `project_blueprint_copy.js`
- `project_blueprint_layout.js`
- `project_blueprint_next_templates.js`
- `project_blueprint_profile_templates.js`
- `project_blueprint_request.js`
- `project_blueprint_static_templates.js`
- `project_blueprint_template_utils.js`
- `project_blueprint_templates.js`
- `project_blueprint_utils.js`

Tambem foi reforcado suporte ao dominio de estufas/greenhouses, incluindo copy, perfil de briefing, icones e consultas de midia.

### 3. Renderer saiu do monolito

O antigo `renderer/app.js` foi reduzido e virou compositor de controllers, nao dono de toda a UI.

Modulos criados ou consolidados:

- `renderer/app_state.js`
- `renderer/app_formatters.js`
- `renderer/app_conversations.js`
- `renderer/app_projects.js`
- `renderer/app_jobs.js`
- `renderer/app_actions.js`
- `renderer/app_events.js`
- `renderer/app_preferences.js`
- `renderer/bootstrap_guard.js`
- `renderer/startup_preloader.js`
- `renderer/account_gate.js`
- `renderer/chat_composer.js`
- `renderer/cortex_controller.js`
- `renderer/job_progress.js`
- `renderer/project_sidebar.js`
- `renderer/project_tools.js`
- `renderer/project_terminal.js`
- `renderer/project_file_tree.js`
- `renderer/project_file_editor.js`
- `renderer/project_state_modal.js`
- `renderer/welcome_project_modal.js`

Estado atual:

- `renderer/app.js`: 990 linhas.
- `renderer/app_preferences.js`: 78 linhas.

Contrato importante:

- `tests/renderer-module-contract.test.js` garante que os modulos de renderer sejam carregados antes de `app.js`.
- `tests/architecture-boundary.test.js` garante que modulos renderer nao usem `require`, `ipcRenderer` ou `window.localcodeApi` fora do compositor permitido.

### 4. AI settings foi modularizado

O painel de APIs/configuracoes deixou de ser um bloco unico.

Modulos:

- `renderer/ai_settings.js`
- `renderer/ai_settings_support.js`
- `renderer/ai_settings_draft.js`
- `renderer/ai_settings_elements.js`
- `renderer/ai_settings_account_panel.js`
- `renderer/ai_settings_controller.js`

Observacao: `renderer/ai_settings_controller.js` ainda tem cerca de 947 linhas. Ele esta funcional e validado, mas e um dos proximos candidatos a nova limpeza.

### 5. CSS foi dividido em modulos

`renderer/styles.css` virou entrypoint import-only.

Modulos principais:

- `renderer/styles/core.css`
- `renderer/styles/project-shell.css`
- `renderer/styles/account-gate.css`
- `renderer/styles/workspace-tools.css`
- `renderer/styles/settings.css`
- `renderer/styles/ui-overrides.css`
- `renderer/styles/cortex.css`
- `renderer/styles/automata-contracts.css`
- `renderer/styles/system-shell.css`
- `renderer/styles/legacy-overrides.css`
- `renderer/styles/legacy/*.css`

Nota: os arquivos `legacy/*` ainda existem porque funcionam como camada ativa de compatibilidade visual. Eles nao foram removidos nesta rodada porque sao referenciados por contrato CSS e ainda protegem partes da UI.

Contrato:

- `tests/window-chrome-css.test.js` valida ordem de imports, entrypoint import-only e regras criticas de UI.

### 6. Main process foi saneado, mas ainda e compositor central

`main.js` ainda e grande porque compoe Electron, janela, providers, runtime, handlers e orquestracao. Mesmo assim, blocos pesados foram extraidos.

Estado atual:

- `main.js`: 4273 linhas.

Novos modulos de runtime:

- `main/runtime/runtime_config.js`
- `main/runtime/provider_rate_limiter.js`
- `main/runtime/runtime_profile.js`
- `main/runtime/file_text_utils.js`
- `main/runtime/project_store.js`
- `main/runtime/project_context.js`
- `main/runtime/attachment_context.js`
- `main/runtime/diff_preview.js`

Novo servico:

- `main/services/css_runtime_repair_service.js`

Contratos:

- `tests/runtime-module-contract.test.js`
- `tests/architecture-boundary.test.js`

### 7. Estado de orquestracao foi separado de jobs

Antes, `cortex/orchestration/state_store.js` acumulava estado de conversas, learning e jobs. A maquina de jobs saiu para modulo proprio.

Estado atual:

- `cortex/orchestration/state_store.js`: 513 linhas.
- `cortex/orchestration/state_store_jobs.js`: 567 linhas.

Teste:

- `tests/orchestration-state.test.js`

### 8. Deterministic edit foi quebrado em modulos

O servico deterministico foi reduzido e passou a delegar para helpers, core, transforms e styles.

Modulos:

- `main/services/deterministic_edit_service.js`
- `main/services/deterministic_edit_core.js`
- `main/services/deterministic_edit_helpers.js`
- `main/services/deterministic_edit_styles.js`
- `main/services/deterministic_edit_transforms.js`

Teste:

- `tests/deterministic-edit-service.test.js`

### 9. Automata contracts foram adicionados

Foi criado um caminho para registrar, exibir e versionar contratos temporarios/aprovados.

Modulos:

- `cortex/orchestration/automata_contract_registry_service.js`
- `cortex/orchestration/automata_contract_ledger_service.js`
- `main/ipc/automata_contract_handlers.js`
- `renderer/automata_contracts.js`
- `docs/AUTOMATA_CONTRACTS.md`

Testes:

- `tests/automata-contract-registry-service.test.js`
- `tests/automata-contract-ledger-service.test.js`
- `tests/automata-contract-handlers.test.js`

### 10. Plataforma/login/midia foram publicadas como base segura

Foram incluidos modulos publicos de conta, backend local, Postgres e midia, sem chaves reais.

Modulos:

- `main/services/platform_account_service.js`
- `main/services/platform_backend_service.js`
- `main/services/platform_media_service.js`
- `main/services/postgres_user_store.js`
- `main/services/pexels_asset_service.js`
- `main/ipc/account_handlers.js`

Testes:

- `tests/platform-account-service.test.js`
- `tests/platform-backend-service.test.js`
- `tests/platform-media-service.test.js`
- `tests/postgres-user-store.test.js`
- `tests/pexels-asset-service.test.js`

## Limpeza de apendices e arquivos sem uso

Foram removidos arquivos duplicados ou gerados que nao agregavam ao projeto publico:

- `assets/temp_logo_faber.png`
- `renderer/assets/temp_logo_faber.png`
- `renderer/assets/faber-logo-horizontal.png`
- `build/source-1024.png`
- `build/generate-icon.js`
- `build/generate_icon.swift`
- `build/make-iconset-from-png.js`
- `build/icon.iconset/`

Tambem foi removido o fallback para `temp_logo_faber` em `main.js`.

O app agora procura icone em:

- `assets/logo_faber.png`
- `build/icon.png`

## Protecao publica e .gitignore

O `.gitignore` foi reforcado para impedir commit acidental de:

- `.env`, `.envrc`, `.npmrc` e arquivos locais;
- `node_modules`;
- `private_context`;
- `models`;
- chaves, certificados, service accounts e credenciais JSON;
- bancos locais, dumps, logs e PIDs;
- MemPalace/RAG/vector stores locais;
- outputs de build, cache, release e coverage;
- reports, screenshots, uploads, downloads, artifacts e outputs de smoke test;
- workspaces/projetos gerados pelo usuario.

Estado local apos push:

```text
!! .env
!! models
!! node_modules/
!! private_context/
```

Esses itens estao corretamente ignorados e nao foram enviados ao GitHub.

## Validacoes executadas

Antes do commit publico:

```bash
npm run audit:public
npm run test:architecture
```

Resultado:

- `npm run audit:public`: passou.
- `npm run test:architecture`: passou completo.

Observacao tecnica: alguns testes precisam abrir `127.0.0.1`, entao a suite completa deve ser rodada fora do sandbox quando houver bloqueio `EPERM`.

Depois do commit:

```bash
npm run audit:public
```

Resultado:

- passou novamente, verificando 249 arquivos publicaveis.

## Commit publico enviado

Commit:

```text
cf8ba00 Prepare public architecture update
```

Push:

```text
origin/main atualizado de 34e2246 para cf8ba00
```

Comando executado:

```bash
git push origin main
```

## Estado arquitetural atual

Arquivos centrais e tamanhos aproximados apos limpeza:

```text
main.js                                      4273 linhas
renderer/app.js                              990 linhas
cortex/orchestration/state_store.js          513 linhas
cortex/orchestration/state_store_jobs.js     567 linhas
renderer/app_preferences.js                   78 linhas
main/runtime/attachment_context.js           135 linhas
main/runtime/diff_preview.js                  58 linhas
main/runtime/file_text_utils.js               64 linhas
main/runtime/project_context.js              247 linhas
main/runtime/project_store.js                 88 linhas
main/runtime/provider_rate_limiter.js         93 linhas
main/runtime/runtime_config.js               350 linhas
main/runtime/runtime_profile.js              109 linhas
main/services/css_runtime_repair_service.js  177 linhas
```

## O que esta pronto para a proxima conversa

O projeto esta pronto para uma nova rodada de evolucao sem precisar reabrir a limpeza arquitetural basica.

Pode-se seguir por um destes caminhos:

1. Rodar novo smoke test de landing page de estufas com screenshots.
2. Validar se o novo fluxo evita a regressao "Clinica Sorriso".
3. Evoluir a biblioteca modular de templates.
4. Criar um sistema de aprovacao/commit de contratos temporarios para biblioteca pessoal do usuario.
5. Transformar os modulos de header, hero, body sections, testimonials, calculators, forms e footer em pecas declarativas.
6. Reduzir ainda mais `main.js`, separando assistente/planner/route decisions de janela/IPC.
7. Separar `renderer/ai_settings_controller.js` em blocos menores.
8. Renomear gradualmente `renderer/styles/legacy/*` para uma camada de compatibilidade sem o termo legacy, se os contratos visuais continuarem passando.

## Candidatos a proxima limpeza

Estes pontos ainda nao sao bloqueadores, mas sao bons candidatos para a proxima fase:

- `main.js`: ainda e compositor grande. Proxima etapa pode extrair rota de assistente, planejamento e inicializacao Electron.
- `renderer/ai_settings_controller.js`: funcional, mas grande.
- `renderer/styles/legacy/*`: ativo e validado, mas o nome "legacy" pode confundir o status real.
- `docs/FABER_CODE_HANDOFF_2026-05-19.md`: documento antigo ainda util como historico, mas pode ficar obsoleto depois deste handoff.

## Regras para continuar com seguranca

Ao retomar em nova conversa:

- Nao usar `git reset --hard`.
- Nao reverter mudancas locais sem pedido explicito.
- Antes de novo commit publico, rodar `npm run audit:public`.
- Antes de push importante, rodar `npm run test:architecture`.
- Manter `.env`, `private_context`, `models`, `node_modules` e workspaces do usuario fora do Git.
- Evitar commitar resultados de smoke test, prints, projetos gerados ou arquivos de cliente.

## Prompt sugerido para nova conversa

Use algo neste estilo:

```text
Continue o Faber Code a partir de docs/FABER_CODE_HANDOFF_2026-05-22_PUBLIC_ARCHITECTURE_UPDATE.md.

Estamos no commit publico cf8ba00, com audit publico e test:architecture passando.
O objetivo agora e avancar a proxima fase sem reabrir a limpeza basica:
1. rodar novo smoke test para landing page de estufas;
2. validar se o fluxo modular evita a regressao de dominio;
3. evoluir a biblioteca de templates/modulos e contratos temporarios aprovaveis.

Antes de alterar codigo, confira o estado local, preserve itens ignorados e mantenha somente artefatos publicos no Git.
```

## Conclusao

Esta rodada deixou a base publica do Faber Code mais limpa, modular e segura para continuar. O produto ainda esta em fase de smoke tests, mas agora ha contratos suficientes para impedir regressao arquitetural basica enquanto a experiencia de geracao visual e modular evolui.
