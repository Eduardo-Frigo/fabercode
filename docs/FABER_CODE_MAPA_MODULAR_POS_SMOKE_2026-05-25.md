# Faber Code - Mapa Modular Pos-Smoke 2026-05-25

Este documento mapeia os modulos impactados pelo ciclo pos-smoke 32/33 e descreve a responsabilidade esperada de cada camada.

## Principio de arquitetura

O Faber Code deve continuar separando responsabilidades:

- `cortex/orchestration`: compreensao do pedido, contratos, blueprints, gates e decisao de produto.
- `main/services`: runtime local, preview, backend interno, auth callback e validacao operacional.
- `renderer`: experiencia visual, estado de UI, paineis, configuracoes, terminal e formatacao.
- `tests`: contratos regressivos para impedir retorno de fallback generico.
- `docs`: registro de decisoes, riscos, smoke tests e handoff.

## Cortex / Orquestracao

| Modulo | Responsabilidade |
| --- | --- |
| `cortex/orchestration/briefing_spec_service.js` | Extrair especificacao objetiva do briefing atual, marca, dominio, rotas e sinais de pedido autocontido. |
| `cortex/orchestration/briefing_contract_service.js` | Classificar dominio, objetivo, publico, contexto e contrato de produto. |
| `cortex/orchestration/working_brief_service.js` | Consolidar briefing atual com memoria sem permitir contaminacao indevida. |
| `cortex/orchestration/briefing_service.js` | Integrar briefing ao fluxo existente. |
| `cortex/orchestration/product_contract_service.js` | Materializar contrato de produto e reduzir dependencia de memoria antiga em briefings completos. |
| `cortex/orchestration/product_orchestrator_service.js` | Coordenar rota de produto, execucao e criterios de aceite. |
| `cortex/orchestration/product_policy_gate_service.js` | Bloquear caminhos inadequados antes de gerar ou aplicar artefatos. |
| `cortex/orchestration/build_mode_router_service.js` | Diferenciar criacao, edicao, busca, revisao visual e conflitos de rota. |

## Blueprints e receitas

| Modulo | Responsabilidade |
| --- | --- |
| `cortex/orchestration/project_blueprint_manifest_service.js` | Centralizar metadados/manifesto de blueprint para reduzir improviso disperso. |
| `cortex/orchestration/project_blueprint_copy.js` | Gerar copy especifica por dominio e preservar marca do briefing. |
| `cortex/orchestration/project_blueprint_layout.js` | Definir estrutura visual e secoes esperadas por dominio. |
| `cortex/orchestration/project_blueprint_next_templates.js` | Materializar arquivos Next/Tailwind, incluindo rotas reais quando aplicavel. |
| `cortex/orchestration/project_blueprint_coverage_contract.js` | Avaliar cobertura de paginas/secoes prometidas. |
| `cortex/orchestration/project_blueprint_request.js` | Montar pedido normalizado para blueprint. |
| `cortex/orchestration/project_blueprint_service.js` | Orquestrar geracao final de blueprint. |
| `cortex/orchestration/blueprint_icon_registry.js` | Registrar icones e referencias visuais por dominio. |
| `cortex/orchestration/project_blueprint_visual_grammar.js` | Resolver gramatica visual por dominio/recipe para evitar repeticao de espinha dorsal entre projetos distintos. |
| `cortex/orchestration/project_blueprint_visual_next_renderers.js` | Materializar variacoes visuais em Next/Tailwind respeitando a gramatica escolhida. |

## Gates de qualidade e fallback

| Modulo | Responsabilidade |
| --- | --- |
| `cortex/orchestration/artifact_quality_service.js` | Detectar placeholder, conteudo generico, marca errada e baixa aderencia. |
| `cortex/orchestration/visual_product_coverage_service.js` | Detectar cobertura visual/semantica por secoes esperadas. |
| `cortex/orchestration/visual_validation_service.js` | Separar aprovacao estatica de captura visual real. |
| `cortex/orchestration/render_pass_service.js` | Validar passagens de render e detectar artefatos genericos antes de liberar. |

## Runtime / Main services

| Modulo | Responsabilidade |
| --- | --- |
| `main/services/project_preview_service.js` | Resolver plano de preview e servidor disponivel. |
| `main/services/project_preview_runtime_service.js` | Executar/adotar preview local e lidar com servidor manual. |
| `main/services/project_visual_validation_runtime_service.js` | Coordenar captura real, fallback honesto e resultado visual. |
| `main/services/faber_capability_adapter_service.js` | Adapter local MCP-compatible para filesystem, terminal, browser preview/capture e git. |
| `main/services/pexels_asset_service.js` | Resolver busca de imagem/video por dominio e briefing, incluindo queries contextuais para `photo-lab`. |
| `main/services/platform_backend_service.js` | Servir endpoints internos e callback de auth. |
| `main/services/platform_auth_callback_page_service.js` | Renderizar pagina externa de callback pos-login. |

## Capability Layer MCP-compatible

| Modulo | Responsabilidade |
| --- | --- |
| `cortex/capabilities/capability_result.js` | Padronizar retorno de capability com dados, artefatos, logs, warnings e erros. |
| `cortex/capabilities/project_session_contract.js` | Validar raiz do projeto e sessao autorizada antes de executar capacidade operacional. |
| `cortex/capabilities/capability_gateway.js` | Roteador interno das capabilities, mantendo contrato unico de execucao. |
| `cortex/tools/capability_tools.js` | Expor ferramentas MCP-compatible sem misturar com decisao de produto. |

## Renderer / Workspace

| Modulo | Responsabilidade |
| --- | --- |
| `renderer/workspace_layout_preferences.js` | Persistir preferencias de layout e modo de workspace. |
| `renderer/workspace_layout_builder.js` | Construir configuracao visual do workspace. |
| `renderer/workspace_layout_runtime.js` | Aplicar layout no runtime da interface. |
| `renderer/panel_layout.js` | Controlar larguras, recolhimento e restauracao dos paineis. |
| `renderer/project_terminal.js` | Gerenciar terminal de projeto, status e superficie de comando. |
| `renderer/app_state.js` | Guardar estado global de UI relacionado ao workspace. |
| `renderer/app.js` | Orquestrar inicializacao e conectar modulos, sem concentrar regra complexa. |
| `renderer/app_formatters.js` | Ajustar mensagens e rotulos exibidos para o usuario. |
| `renderer/account_gate.js` | Integrar login/account gate ao fluxo visual. |
| `renderer/ai_settings_controller.js` | Controlar preferencias de IA e workspace no painel de configuracao. |
| `renderer/ai_settings_elements.js` | Expor elementos de configuracao de forma isolada. |

## Styles

| Arquivo | Responsabilidade |
| --- | --- |
| `renderer/styles/workspace-layout.css` | Grid, colunas, paineis, layout configuravel e estado recolhido. |
| `renderer/styles/workspace-tools.css` | Terminal, ferramentas, botoes e superficie de comandos. |
| `renderer/styles/account-gate.css` | Login e tela inicial de autenticacao. |
| `renderer/styles/settings.css` | Configuracoes e preferencias. |
| `renderer/styles/system-shell.css` | Shell geral da aplicacao. |
| `renderer/styles.css` | Entrada agregadora de estilos. |

## Testes adicionados ou reforcados

| Teste | Cobre |
| --- | --- |
| `tests/briefing-spec-service.test.js` | Extracao de briefing, marca, rotas e protecao contra memoria antiga. |
| `tests/briefing-contract-service.test.js` | Dominios, contratos e conflitos. |
| `tests/project-blueprint-service.test.js` | Blueprints por dominio e rotas reais. |
| `tests/smoke-scenarios.test.js` | Cenarios regressivos, incluindo Aurea IP, Linea Bosco, smokes 34 a 42 e Lumen Lab. |
| `tests/support/smoke_scenario_runner.js` | Runner compartilhado dos smoke scenarios. |
| `tests/artifact-quality-service.test.js` | Placeholder, marca errada e padroes genericos. |
| `tests/visual-product-coverage-service.test.js` | Cobertura visual/semantica e deteccao de dominio divergente. |
| `tests/project-preview-service.test.js` | Plano de preview. |
| `tests/project-preview-runtime-service.test.js` | Runtime e adocao de preview manual. |
| `tests/project-visual-validation-runtime-service.test.js` | Gate de captura real. |
| `tests/renderer-workspace-layout-preferences.test.js` | Preferencias de layout. |
| `tests/renderer-workspace-layout-builder.test.js` | Builder de workspace. |
| `tests/renderer-workspace-layout-runtime.test.js` | Aplicacao do layout no runtime. |
| `tests/renderer-panel-layout.test.js` | Recolhimento de paineis e preservacao de largura. |
| `tests/window-chrome-css.test.js` | Grid visual e posicionamento do centro. |
| `tests/renderer-module-contract.test.js` | Integridade modular do renderer. |
| `tests/pexels-asset-service.test.js` | Queries de asset por dominio, incluindo laboratorio fotografico. |
| `tests/faber-capability-adapter-service.test.js` | Adapter MCP-compatible e browser preview capture com preparo de dependencias. |
| `tests/capability-gateway.test.js` | Contrato de gateway e bloqueios por sessao de projeto. |

## Limites de responsabilidade

- `cortex` nao deve depender de Electron ou DOM.
- `main/services` nao deve virar deposito de regra de produto que pertence ao Cortex.
- `renderer/app.js` deve continuar fino, chamando modulos dedicados.
- CSS de workspace deve continuar em `renderer/styles/workspace-layout.css`, nao espalhado em blocos inline.
- Smoke tests devem continuar registrando falhas reais, nao apenas caminho feliz.

## Sinais de saude atual

- `npm run test:architecture` passou completo no ciclo do commit.
- `node tests/smoke-scenarios.test.js` passou com 18 cenarios no ciclo do commit.
- `npm run test:smoke-scenarios` passou com 27 cenarios apos smoke 34 a 42 e correcao Lumen Lab.
- `git diff --check` e `git diff --cached --check` passaram antes do commit.
- O worktree foi sanitizado antes do commit `30e163c`.
- Depois do commit `30e163c`, novas mudancas locais continuam sem commit ate o proximo smoke manual.

## Pontos que nao devem ser misturados

- Melhorar memoria ativa/RAG/MemPalace e diferente de adicionar mais fallback no blueprint.
- Melhorar validacao visual real e diferente de ampliar heuristica estatica.
- Melhorar UX de terminal e diferente de embutir automacoes em botoes fixos sem contrato.
- Corrigir geracao de site completo e diferente de criar mais uma composicao generica com anchors.
