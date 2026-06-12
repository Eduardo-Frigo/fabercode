# Faber Code - Documentacao Completa de Avancos ate 2026-05-27

Este documento consolida os avancos recentes do Faber Code no ciclo de fortalecimento rumo ao criterio interno "Codex = 100%".

Ele registra o estado real do projeto apos as frentes de MCP/capabilities, memoria ativa/RAG/MemPalace, produto/orquestracao, modularizacao, patches deterministicos estruturais, contratos de blueprint e auditoria de publicacao.

Nao registra deploy publico. Deploy/publicacao externa continuam dependendo de pedido explicito.

## Estado atual do repositorio

- Projeto local: `<repo-root>`
- Branch: `main`
- Ultimo commit tecnico confirmado nesta atualizacao: `d4a2d91 Amplia diversidade e validacao das blueprints`
- Worktree antes desta atualizacao documental: limpo
- Runtime esperado: Node `24.15.0`
- Engine em `package.json`: `>=24.15.0 <25`
- Publicacao externa: nao realizada

Commits recentes mais relevantes:

- `117675f Fortalece orquestrador e contexto ativo`
- `ffafe50 Expoe evidencia auditavel do context frame`
- `f370a16 Fortalece MCP memoria orquestracao e modularizacao`
- `c8933be Fortalece MCP e patches deterministicos estruturais`
- `bdcfb9b Adiciona auditoria de higiene para releases`
- `b68b10f Fortalece contratos de blueprint`
- `ed2fd77 Fortalece MCP como guardiao de contratos`
- `45ec6bb Documenta status MCP e blueprints`
- `d4a2d91 Amplia diversidade e validacao das blueprints`

## Principios permanentes preservados

1. Toda nova solicitacao deve seguir a arquitetura modular do projeto.
2. Responsabilidade nao deve ser concentrada em `main.js` nem no orquestrador quando houver modulo adequado.
3. Mensagem atual, briefing da conversa, memoria de projeto, memoria de usuario, RAG/MemPalace e contexto antigo devem permanecer separados.
4. Memoria ativa nao pode contaminar briefing autocontido.
5. Depois de alteracoes de arquivo, commit so acontece por pedido explicito.
6. Deploy publico nao deve ser sugerido nem executado sem pedido explicito.

## 1. Context frame, memoria ativa, RAG e MemPalace

### O que foi fortalecido

Foi criado e integrado o `contextFrame` como contrato de separacao de contexto no fluxo de orquestracao.

Fontes separadas:

- `current_message`: mensagem atual do usuario;
- `conversation_brief`: briefing autocontido derivado da conversa atual;
- `active_memory`: memoria ativa/RAG/MemPalace explicitamente permitida;
- contexto antigo: tratado como fonte separada, nao como briefing;
- memoria de usuario e memoria de projeto: preservadas como fontes distintas.

Arquivos principais:

- `cortex/orchestration/orchestration_context_frame_service.js`
- `cortex/orchestration/orchestration_context_frame_evidence_service.js`
- `cortex/orchestration/product_policy_gate_service.js`
- `cortex/orchestration/product_orchestrator_service.js`
- `cortex/memory/active_memory_governance_service.js`
- `cortex/memory/active_memory_service.js`
- `cortex/memory/context_adapter.js`

### Garantias adicionadas

- Briefing autocontido suprime memoria antiga.
- "Briefing desta conversa" usa historico da conversa, nao memoria solta.
- Pedido explicito por memoria ativa/RAG/MemPalace permite uso de memoria.
- `route.meta.contextFrame` carrega fonte dominante e evidencia auditavel.
- Contexto ativo agora considera escopo, validade/expiracao, motivo de recuperacao e citacoes/provenance.
- Memoria com escopo divergente ou expirada e suprimida antes de contaminar a geracao.

### Testes e smoke tests

- `tests/orchestration-context-frame-service.test.js`
- `tests/active-memory-service.test.js`
- `tests/memory-adapter.test.js`
- `tests/cortex-memory-sync-service.test.js`
- `tests/support/smoke_scenario_runner.js`

Smokes relevantes:

- `active_memory_continuation`
- `context_frame_audit_sources`
- `active_memory_scope_expiration_guard`

### Resultado pratico

O Faber Code ficou muito mais protegido contra o problema antigo de "criar um site novo usando solicitacoes antigas". A regra central agora e: briefing novo e autocontido manda; memoria so entra quando for coerente, valida, escopada ou explicitamente pedida.

## 2. Produto e orquestracao de rota

### Problema atacado

Havia drift entre `initial_blueprint`, `adaptive_blueprint` e `faber_blueprint`. O sintoma mais claro era contrato instavel em `tests/product-trace-contract.test.js`, especialmente no caso de estufas.

### Contrato consolidado

- `initial_blueprint`: modo de build para criacao inicial quando o projeto ainda precisa nascer a partir de um briefing coberto.
- `adaptive_blueprint`: modo de build para adaptacao real de uma base existente ou contexto adaptativo reconhecido.
- `faber_blueprint`: modo de rota executavel quando o Faber assume a criacao/edicao com blueprint local coberto e contrato suficiente.
- `contract_escalation`: usado quando o briefing exige revisao de contrato antes da execucao.
- `requires_route_confirmation`: usado quando ha conflito real de rota, por exemplo criar projeto novo e editar projeto existente no mesmo pedido.

Arquivos principais:

- `cortex/orchestration/product_route_mode_contract_service.js`
- `cortex/orchestration/product_route_scoring_service.js`
- `cortex/orchestration/build_mode_router_service.js`
- `cortex/orchestration/product_contract_service.js`
- `cortex/orchestration/product_orchestrator_service.js`

### Testes e smoke tests

- `tests/product-trace-contract.test.js`
- `tests/product-route-mode-contract-service.test.js`
- `tests/product-orchestrator-service.test.js`
- `tests/build-mode-router-service.test.js`
- `tests/cortex-build-mode-handlers.test.js`
- `tests/product-contract-schemas.test.js`

Smokes relevantes:

- `greenhouse_create_preview`
- `long_briefing_create_not_search`
- `current_briefing_contract_escalation`
- `route_contract_conflict`

### Resultado pratico

O contrato de rota deixou de depender de heuristica solta. Os testes agora representam melhor o comportamento real esperado: decidir quando criar, adaptar, escalar contrato ou pedir confirmacao.

## 3. Modularizacao de blueprints e renderizacao

### Problema atacado

Alguns arquivos estavam virando mega-registros. O principal exemplo era `project_blueprint_next_templates.js`, que carregava responsabilidade demais para evolucao fina.

### Divisao realizada

O conteudo de templates Next foi dividido por familias de pagina/renderizacao.

Arquivos principais:

- `cortex/orchestration/project_blueprint_next_templates.js`
- `cortex/orchestration/project_blueprint_next_page_renderers.js`
- `cortex/orchestration/project_blueprint_next_route_pages.js`
- `cortex/orchestration/project_blueprint_template_utils.js`
- `cortex/orchestration/project_blueprint_static_templates.js`
- `cortex/orchestration/project_blueprint_profile_templates.js`

### Resultado pratico

O arquivo central ficou mais leve e delega para modulos especializados. Isso melhora manutencao de rotas, paginas, componentes e recipes sem empurrar ainda mais responsabilidade para `main.js` ou para o orquestrador.

## 4. MCP/capability layer

### Estado anterior

A camada MCP/capability existia como fundacao local, mas conseguia alterar arquivos indiretamente via terminal. Isso nao era uma capability estrutural segura de edicao.

### O que foi implementado

Foi criada a capability `structured_edit`, com contrato proprio:

- `plan`: planeja uma edicao estruturada sem escrever no disco;
- `apply`: aplica edicao estruturada validada;
- diff preview;
- microcontrato deterministico;
- validacao de seguranca;
- persistencia de evidencia por projeto/job;
- eventos de auditoria;
- eventos e checkpoints de job.

Arquivos principais:

- `main/services/faber_capability_adapter_service.js`
- `main/services/capability_evidence_ledger_service.js`
- `cortex/capabilities/capability_gateway.js`
- `cortex/capabilities/capability_result.js`
- `cortex/capabilities/project_session_contract.js`

### Ledger de evidencia

As evidencias de capability agora sao persistidas em:

```text
.faber/capabilities/<capability>.jsonl
```

O scanner do projeto ignora `.faber`, evitando que evidencias internas contaminem leitura de projeto, blueprints ou RAG.

Arquivos relacionados:

- `main/services/project_scanner.js`
- `main.js`

### Capabilities atuais

- `filesystem`: leitura de arvore e arquivos, sem escrita direta;
- `terminal`: execucao auditavel em sessao de projeto;
- `browser_preview`: start/status/capture/stop de preview;
- `git`: leitura de estado Git;
- `structured_edit`: edicao segura por patch deterministico.
- `external_mcp`: bridge governada para servidores MCP externos aprovados.

### Limite explicito

O MCP/capability layer agora esta forte como camada local auditavel do Faber Code e a frente externa ganhou bridge, transportes `stdio`/HTTP/SSE, registry persistente, cache visual de discovery, UI avancada de configuracao, politica granular por risco/escopo/diretorio/rede, smoke HTTP/SSE contra endpoint local real, smoke HTTP/SSE contra endpoint publico DeepWiki sem credencial e smoke contra servidor MCP oficial de terceiro. Ainda faltam presets/registry externo guiado, UX menos tecnica para configuracao, rotacao de secrets e testes contra endpoints privados/autenticados sem expor segredo.

### Testes e smoke tests

- `tests/capability-gateway.test.js`
- `tests/faber-capability-adapter-service.test.js`
- `tests/external-mcp-transports.test.js`
- `tests/external-mcp-tool-policy-service.test.js`
- `tests/external-mcp-server-registry-service.test.js`
- `tests/external-mcp-discovery-cache-service.test.js`
- `tests/external-mcp-handlers.test.js`
- `tests/external-mcp-http-sse-endpoint-smoke.test.js`
- `tests/external-mcp-third-party-smoke.test.js`
- `tests/external-mcp-public-deepwiki-smoke.test.js`
- `tests/tool-registry.test.js`
- `tests/support/smoke_scenario_runner.js`

Smoke relevante:

- `mcp_structured_edit_persistence`
- `mcp_external_tool_bridge`
- `mcp_external_stdio_visual_bridge`

Validacao visual especifica realizada:

- pagina temporaria antes/depois;
- Chrome headless em viewport desktop;
- CTA secundario alterado visualmente;
- grid alterado de 2 para 3 colunas visualmente;
- ledger/audit/job/checkpoint confirmados.

## 5. Patch deterministico estrutural

### Estado anterior

O patch deterministico cobria bem micro-edits como titulo, cor, tipografia, footer e troca literal, mas ainda falhava em edicoes estruturais simples.

### Patches adicionados

Alta prioridade:

- `cta_text_patch`: troca texto/href de CTA primario ou secundario por label, href ou indice;
- `card_text_patch`: edita titulo/descricao de card por indice ou titulo atual;
- `section_reorder_patch`: move secoes por id ou heading;
- `grid_columns_patch`: ajusta classes Tailwind de grid;
- `faq_item_patch`: adiciona, edita ou remove perguntas;

Prioridade media:

- `nav_link_patch`: troca label/href de menu;
- `section_remove_patch`: remove secao identificada;
- `form_field_patch`: adiciona ou renomeia campo de formulario;
- `stat_text_patch`: altera numeros/labels de metricas;
- `hero_media_patch`: troca `src`, `alt` e `poster` de imagem/video quando explicito.

Arquivos principais:

- `main/services/deterministic_edit_structural.js`
- `main/services/deterministic_edit_service.js`
- `main/services/deterministic_edit_helpers.js`
- `main/services/deterministic_edit_safety_service.js`
- `main/services/deterministic_edit_patch_evidence_service.js`

### Smoke test estrutural

Smoke relevante:

- `deterministic_structural_patch_existing_project`

Esse smoke aplica uma matriz de patches estruturais em projeto existente e valida:

- CTA secundario;
- segundo card;
- grid em 3 colunas;
- FAQ antes de depoimentos;
- adicionar/editar/remover FAQ;
- menu;
- remocao de secao;
- formulario;
- metrica;
- poster de video hero.

### Resultado pratico

O Faber Code agora resolve uma classe maior de edicoes especificas sem cair em IA semantica livre. Isso melhora previsibilidade, contrato, diff e seguranca.

## 5.1. MCP como guardiao de contratos de blueprint

### Problema atacado

A camada MCP/capability local ja estava forte como executor seguro, especialmente com `structured_edit`, mas ainda faltava transformar o MCP em participante ativo do ciclo de contratos:

- validar blueprint contra contrato;
- bloquear contaminacao de memoria antiga;
- consumir evidencias visuais reais;
- registrar ledger de capability;
- sugerir/promover contrato temporario;
- reparar violacoes objetivas.

### O que foi implementado

Foi criada a capability:

```text
blueprint_contract
```

Servico principal:

```text
main/services/blueprint_contract_capability_service.js
```

Acoes:

- `validate`;
- `repair`;
- `suggest`;
- `stage`;
- `trial`;
- `promote`.

O MCP agora valida:

- `validateProjectBlueprintContract`;
- `moduleContract`;
- `coverageContract`;
- rotas geradas;
- `sourcePolicy` com termos obrigatorios e proibidos;
- DOM metrics de desktop/tablet/mobile;
- artefatos visuais.

O resultado e persistido em:

```text
.faber/capabilities/blueprint_contract.jsonl
```

### Reparo automatico inicial

O `repair` cobre violacao responsiva objetiva em breakpoints:

- `md:hidden` -> `lg:hidden`;
- `md:flex` -> `lg:flex`;
- `md:inline-flex` -> `lg:inline-flex`;
- `md:max-w-none` -> `lg:max-w-none`;
- `md:pr-0` -> `lg:pr-0`.

Isso evita que tablet receba menu desktop cedo demais quando a regra de contrato exige hamburger abaixo de `1024px`.

### Promocao de contrato

Quando a validacao passa, `suggest` cria proposta:

```text
kind: blueprint_contract_guardian
schemaVersion: faber-blueprint-contract-capability-v1
```

Fluxo validado:

```text
suggest_blueprint -> staged -> trial_running -> trial_passed -> local_active
```

### Smokes e validacao visual real

Foram adicionados:

```text
mcp_blueprint_contract_guardian
mcp_blueprint_contract_briefing_matrix
```

Matriz visual real executada:

- `legal`;
- `temporary_music_school`;
- `chocolate`;
- `import_services`.

Viewports por caso:

- desktop `1365x768`;
- tablet `820x1180`;
- mobile `390x844`.

Resultados:

- 4 builds reais de Next;
- 12 screenshots reais;
- 12 checks de pixel nao vazio;
- zero overflow horizontal;
- zero imagens quebradas;
- hamburger correto em tablet/mobile;
- nav desktop correta em desktop;
- source policy sem termos proibidos;
- todos os casos promovidos ate `local_active` em ambiente temporario de validacao.

### Falha real encontrada e corrigida

O loop visual revelou erro de build TSX:

```text
Type 'unknown' is not assignable to type 'ReactNode'
```

Correcoes aplicadas nos renderers:

- `project_blueprint_next_templates.js`;
- `project_blueprint_next_page_renderers.js`;
- `project_blueprint_visual_next_renderers.js`.

Campos opcionais de `copy` agora recebem tipagem adequada antes de renderizar JSX ou usar `.map`.

### Documento dedicado

Detalhes completos da rodada:

```text
docs/FABER_CODE_MCP_CONTRATOS_BLUEPRINTS_2026-05-27.md
```

## 5.2. Diversidade visual e adaptabilidade das blueprints

### Problema atacado

A rodada posterior a `ed2fd77` mostrou que, embora as blueprints ja estivessem mais fortes em contrato, alguns screenshots pareciam variações proximas demais de uma mesma composicao. O objetivo passou a ser transformar diversidade visual em criterio testavel, nao apenas em percepcao subjetiva.

### O que foi implementado

Foram fortalecidas primitivas compartilhadas:

- `BlueprintResponsiveHeader`;
- `BlueprintIconBadge`;
- `BlueprintTestimonialProof`;
- `BlueprintFooterUtility`.

Essas primitivas garantem:

- hamburger ativo em tablet/mobile;
- nav desktop apenas em `lg`;
- menu mobile com altura limitada e rolagem segura;
- icones com dimensoes estaveis;
- testimonials com destaque responsivo;
- footer em grid mobile/tablet/desktop;
- footer editavel por patch deterministico sem duplicar `<footer>`.

Arquivos principais:

- `cortex/orchestration/project_blueprint_template_utils.js`
- `cortex/orchestration/project_blueprint_next_templates.js`
- `cortex/orchestration/project_blueprint_next_page_renderers.js`
- `cortex/orchestration/project_blueprint_visual_next_renderers.js`
- `main/services/deterministic_edit_transforms.js`

Tambem foram corrigidas inferencia de marca e copy contextual para briefings diretos, especialmente quando o pedido dizia "para <marca>" sem campo estruturado explicito.

Arquivos:

- `cortex/orchestration/briefing_spec_service.js`
- `cortex/orchestration/project_blueprint_copy.js`
- `tests/briefing-spec-service.test.js`

### Testes adicionados

Novos testes:

```text
tests/blueprint-composition-diversity.test.js
tests/blueprint-element-system.test.js
tests/blueprint-briefing-adaptability.test.js
```

Resultados:

- `13` composicoes;
- `18` briefings;
- `14` recipes;
- `12` gramaticas visuais;
- `6` sistemas de elementos.

### Smoke MCP ampliado

O smoke `mcp_blueprint_contract_briefing_matrix` foi ampliado de 4 para 9 casos:

- `legal`;
- `temporary_music_school`;
- `chocolate`;
- `import_services`;
- `saas_workspace`;
- `photo_lab`;
- `construction_store`;
- `premium_wine`;
- `dental_clinic`.

Todos passaram com gate `allow`.

### Smoke visual real

Foi executado smoke visual real com build Next de producao para 6 finalidades:

- produto sustentavel;
- importacao/logistica;
- laboratorio fotografico;
- materiais de construcao;
- vinhos premium;
- clinica odontologica.

Viewports:

- desktop `1365x768`;
- tablet `820x1180`;
- mobile `390x844`;
- menu mobile aberto.

Resultado:

- 6 apps temporarios;
- 6 builds de producao;
- 24 screenshots reais;
- zero overflow horizontal;
- screenshots nao vazios;
- header responsivo validado;
- icones, testimonials e footer presentes;
- coverage score `100` nos 6 casos.

Documento dedicado:

```text
docs/FABER_CODE_BLUEPRINTS_DIVERSIDADE_VALIDACAO_2026-05-27.md
```

## 6. Validacao visual

### Avancos

A validacao visual deixou de ser apenas uma avaliacao estatica de qualidade e passou a se apoiar em preview/captura por viewport.

Arquivos e testes relevantes:

- `main/services/project_visual_validation_runtime_service.js`
- `main/services/project_visual_capture_service.js`
- `main/services/project_visual_viewport_service.js`
- `tests/project-visual-validation-runtime-service.test.js`
- `tests/project-visual-capture-service.test.js`
- `tests/project-visual-viewport-service.test.js`

### Garantias adicionadas

- Captura real por viewport;
- falha de captura bloqueia validacao quando captura e exigida;
- preview indisponivel nao vira falso positivo;
- capability `browser_preview.capture` participa da validacao visual;
- smoke de preview falho testa bloqueio controlado.

Smoke relevante:

- `preview_capture_unavailable`
- `visual_review_no_file_changes`

### Resultado pratico

A validacao visual ficou mais honesta. Quando nao ha screenshot real, o sistema nao deve declarar equivalencia visual como se tivesse visto a pagina.

## 7. Auditoria de publicacao e higiene de release

### Estado anterior

`.env`, `private_context`, `.DS_Store` e `node_modules` estavam ignorados corretamente, mas a auditoria publica falhava quando docs continham caminhos locais absolutos.

### O que foi ajustado

`audit:public` esta verde e verifica:

- caminhos locais absolutos;
- dominios/organizacoes privadas conhecidas;
- ids privados conhecidos;
- tokens de API;
- blocos de chave privada;
- arquivos ignorados sensiveis.

Novo script criado:

- `scripts/audit-test-hygiene.js`

Novos comandos:

```bash
npm run audit:public
npm run audit:test-hygiene
npm run audit:release
```

`audit:test-hygiene` bloqueia:

- testes focados acidentalmente;
- testes desabilitados por modificadores de suite/caso;
- marcadores abandonados de trabalho pendente.

`audit:release` foi integrado em:

- `prepack`;
- `prepublishOnly`;
- `pack:mac`.

Documentacao atualizada:

- `docs/PUBLIC_RELEASE_CHECKLIST.md`
- `docs/DOCUMENTACAO_COMPLETA_DECISOES_RECENTES_E_SISTEMAS_EXTERNOS_2026-05-04.md`

### Resultado pratico

Publicacao/seguranca deixou de depender apenas de revisao manual. Agora ha uma barreira automatica antes de pack/publish e uma checagem dedicada para higiene de testes.

## 8. UX/UI desktop e runtime de jobs

### Avancos recentes

A experiencia desktop ganhou melhorias incrementais no estado de jobs e runtime:

- progresso de job mais visivel;
- checkpoints mais ricos;
- eventos por capability;
- estado de UX em modulo dedicado;
- terminal e preview integrados a capability layer;
- paineis e workspace seguem modularizados no renderer.

Arquivos relevantes:

- `renderer/job_progress.js`
- `renderer/ux_state_model.js`
- `renderer/workspace_layout_preferences.js`
- `renderer/workspace_layout_builder.js`
- `renderer/workspace_layout_runtime.js`
- `main/services/cortex_runtime_job_service.js`

### Limites atuais

- `main.js` ainda concentra runtime relevante e segue grande;
- ainda falta smoke manual amplo de UX desktop em janelas estreitas;
- o terminal ainda nao equivale a uma IDE completa;
- ajustes finos de experiencia devem continuar em modulos renderer/main dedicados.

## 9. Suites e comandos validados

Comandos relevantes que passaram neste ciclo:

```bash
npm run test:mcp-capability-adapter
npm run test:mcp-capabilities
npm run test:product-orchestration
npm run test:project-blueprint
npm run test:deterministic-edit
npm run test:memory-rag-mempalace
npm run test:renderer-workspace-layout
npm run test:renderer-panel-layout
npm run test:renderer-ux-state
npm run test:window-chrome-css
npm run audit:public
npm run audit:test-hygiene
npm run audit:release
npm run test:architecture
```

Smokes relevantes que passaram:

```bash
SMOKE_SCENARIOS=deterministic_structural_patch_existing_project,mcp_structured_edit_persistence node tests/smoke-scenarios.test.js
SMOKE_SCENARIOS=deterministic_structural_patch_existing_project,mcp_blueprint_contract_guardian,mcp_blueprint_contract_briefing_matrix,active_memory_scope_expiration_guard node tests/smoke-scenarios.test.js
```

Smokes visuais reais da rodada de blueprints:

```text
vitrapure-product desktop/tablet/mobile/menu
atlasport-trade desktop/tablet/mobile/menu
lumen-photo-lab desktop/tablet/mobile/menu
constrular-store desktop/tablet/mobile/menu
aurora-wine desktop/tablet/mobile/menu
clinica-sorriso-dental desktop/tablet/mobile/menu
```

Observacao sobre ambiente:

- `npm run test:architecture` precisa de permissao para abrir servidor local em `127.0.0.1` em alguns testes.
- No sandbox restrito pode falhar com `listen EPERM`.
- Fora do sandbox, com Node `24.15.0`, a suite passou.

## 10. Leitura atual contra "Codex = 100%"

Percentuais abaixo sao estimativas operacionais, nao metricas matematicas. Eles refletem maturidade percebida apos os ultimos commits.

| Frente | Antes citado | Estado atual estimado | Comentario |
| --- | ---: | ---: | --- |
| UX/UI desktop | 84% | 88-90% | Blueprints ganharam smoke visual real em producao, diversidade de composicao e validacao desktop/tablet/mobile; ainda falta smoke manual fino do app shell. |
| Arquitetura modular | 82% | 89-91% | Primitivas de blueprint reduziram duplicacao em renderers; `main.js` ainda segura parte da nota. |
| Produto/orquestracao | 74% | 85-88% | Suite de produto, matriz MCP e briefings variados passaram; ainda falta artifact store permanente. |
| Patch seguro deterministico | 62% | 88-91% | Footer componentizado virou patchavel sem duplicacao, alem dos patches estruturais ja cobertos. |
| Contratos | 76% | 90-93% | `blueprint_contract`, matriz MCP de 9 casos e `test:project-blueprint` com 18 briefings passaram. |
| Validacao visual | 75% | 87-90% | 6 builds reais, 24 screenshots, zero overflow e componentes visuais verificados; falta suite permanente com retencao de artefatos. |
| Memoria ativa/RAG/MemPalace | 49% | 72-78% | Sem mudanca direta nesta rodada; garantias anteriores continuam validas. |
| MCP/capability layer | fundacao | 91-94% local / 86-89% externo | Capability local passou com matriz MCP ampliada; MCP externo ganhou bridge, registry, cache visual, UI avancada, transportes, endpoint HTTP/SSE local real, endpoint publico DeepWiki sem credencial, politica de risco/escopo/diretorio/rede e smoke contra servidor oficial de terceiro. |
| Produto total pronto | 72-74% | 86-89% | Blueprints ficaram mais versateis e MCP externo deixou de ser fixture-only; produto ainda depende de UX fina, artifact store, presets de MCP externo e endpoints autenticados. |

Revalidacao feita em 2026-05-27 com Node `24.15.0`:

- `npm run audit:release`;
- `npm run test:architecture` fora do sandbox apos `listen EPERM` em `127.0.0.1`;
- `npm run test:mcp-capabilities`;
- `npm run test:product-orchestration`;
- `npm run test:project-blueprint`;
- `npm run test:memory-rag-mempalace`;
- `npm run test:deterministic-edit`;
- testes renderer de UX/layout/painel/janela;
- smoke transversal com patch estrutural, `blueprint_contract` guardian, matriz de briefings MCP e guarda de memoria ativa.

## 11. Riscos e limites que continuam abertos

### MCP externo real

A camada local esta forte e agora tambem atua como guardia de contratos. A rodada MCP externo adicionou execucao real contra `@modelcontextprotocol/server-filesystem` via `npx`, registry persistente, cache visual de discovery, UI avancada de configuracao, HTTP/SSE contra endpoint local real, HTTP/SSE contra DeepWiki publico sem credencial e politica granular por risco/escopo/diretorio/rede. O risco restante esta mais concentrado em presets/marketplace de servidores, UX menos tecnica, rotacao de secrets e endpoints privados/autenticados.

### `main.js` ainda grande

Apesar de novas extracoes, `main.js` continua concentrando partes importantes de runtime, jobs, execucao, validacao e checkpoints. A direcao correta e seguir extraindo por dominio, nao reescrever tudo de uma vez.

### Validacao visual humana

A captura automatizada melhorou, mas ainda nao substitui totalmente julgamento humano sobre composicao, hierarquia visual, refinamento estetico e ergonomia.

### Blueprints e profundidade de site

O sistema esta melhor em dominios, recipes e diversidade visual. A rodada `d4a2d91` cobriu 18 briefings por teste e 6 briefings por smoke visual real, mas ainda falta transformar screenshots reais de todas as combinacoes importantes em suite permanente com artifact store.

### Patch deterministico alem do estrutural simples

Os patches adicionados cobrem edicoes estruturais pequenas e medias. Rearranjos muito amplos, mudancas de arquitetura de pagina ou componentes complexos ainda devem passar por outro contrato, nao por improviso semantico.

### Auditoria publica

`audit:release` esta verde, mas deve continuar sendo executado antes de qualquer publicacao. Docs historicos podem conter contexto antigo seguro, mas devem evitar caminhos locais, escopos privados e detalhes operacionais sensiveis.

## 12. Proxima ordem recomendada

1. Continuar reduzindo responsabilidade residual de `main.js` por servicos de job, execucao, validacao e checkpoints.
2. Criar uma visao no app para consultar evidencias de capability em `.faber/capabilities`.
3. Transformar a matriz visual MCP/contratos em suite automatizada com artifact store controlado.
4. Expandir smoke visual de patches estruturais para desktop/tablet/mobile.
5. Expandir a cobertura visual real para todas as familias de blueprint e variacoes criticas de media/hero.
6. Evoluir MCP externo real com presets guiados, registry externo de servidores, rotacao de secrets e testes contra endpoints autenticados sem expor credenciais.
7. Rodar nova bateria manual de UX desktop com janelas estreitas, paineis, terminal, historico e preview.
8. Revisar docs historicos e manter apenas o que e util como handoff tecnico.

## 13. Comandos de handoff recomendados

```bash
cd "<repo-root>"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 24.15.0

npm run audit:release
npm run test:mcp-capabilities
npm run test:product-orchestration
npm run test:project-blueprint
npm run test:automata-contract-ledger
npm run test:deterministic-edit
npm run test:memory-rag-mempalace
npm run test:architecture
```

## 14. Resumo executivo

O Faber Code avancou de uma base promissora, mas ainda instavel em memoria, rota, MCP e patch seguro, para uma arquitetura mais auditavel e testada.

As maiores mudancas praticas foram:

- separacao real entre mensagem atual, briefing da conversa e memoria ativa;
- contrato de rota mais estavel entre `initial_blueprint`, `adaptive_blueprint` e `faber_blueprint`;
- MCP/capability local com `structured_edit`, ledger, diff, validacao e persistencia por job/projeto;
- MCP/capability com `blueprint_contract`, source policy, DOM metrics, reparo e promocao no Automata Contract Ledger;
- MCP externo com registry persistente, cache visual de discovery, transportes `stdio`/HTTP/SSE, DeepWiki publico sem credencial e politicas por risco/escopo/diretorio/rede;
- blueprints com diversidade de composicao, primitivas compartilhadas, matriz de 18 briefings e smoke visual real em 6 finalidades;
- patches deterministicos estruturais para edicoes simples que antes ficavam sem suporte;
- validacao visual mais honesta com captura real;
- auditoria de release automatizada para seguranca publica e higiene de testes.

O projeto ainda nao esta em "Codex 100%" global, mas varias frentes criticas deixaram de ser fundacao fragil e passaram a ter contrato, testes, smoke e evidencia auditavel.
