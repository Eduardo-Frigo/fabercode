# Faber Code - Atualizacoes do Projeto em 2026-05-25

Este documento consolida as atualizacoes recentes feitas no Faber Code depois do ciclo documentado em `docs/FABER_CODE_AVANCOS_PROJETO_2026-05-24.md`.

Fonte principal: estado local do repositorio, documentacao existente, historico de commits e modulos alterados no projeto `<repo-root>`.

## Documentacao derivada deste ciclo

- `docs/FABER_CODE_AVANCOS_COMPLETOS_2026-05-25.md`: consolidado completo do ciclo atual, incluindo smoke tests 34 a 42, MCP-compatible capability layer, correcao Lumen Lab, percentuais e riscos.
- `docs/FABER_CODE_AVANCOS_CONSOLIDADOS_2026-05-25.md`: consolidado pos-commit dos avancos.
- `docs/FABER_CODE_MAPA_MODULAR_POS_SMOKE_2026-05-25.md`: mapa modular por camada e arquivo.
- `docs/FABER_CODE_PROXIMO_SMOKE_E_RISCOS_2026-05-25.md`: riscos e criterios para o proximo smoke.
- `docs/FABER_CODE_DOCS_INDEX_2026-05-25.md`: indice modular da documentacao nova.
- `docs/FABER_CODE_BRIEFING_BLUEPRINTS_2026-05-25.md`: briefing, contratos, dominios e blueprints.
- `docs/FABER_CODE_PREVIEW_VISUAL_AUTH_2026-05-25.md`: preview, captura visual real, validacao por viewport e auth.
- `docs/FABER_CODE_WORKSPACE_IDE_UX_2026-05-25.md`: workspace configuravel, UX de IDE, paineis e terminal.
- `docs/FABER_CODE_SMOKE_TESTS_2026-05-25.md`: checklist automatizado e manual para o proximo smoke test.

## Referencias de estado

- Commit de referencia anterior documentado: `b734aef Fortalece gate visual com captura por viewport`.
- Commit posterior confirmado no historico: `f6a5c7e Evolui cobertura visual por viewport`.
- Commit consolidado deste ciclo: `30e163c Fortalece contratos e workspace apos smoke tests`.
- Estado atual depois do commit `30e163c`: existem novas mudancas locais sem commit, incluindo smoke tests 34 a 42, MCP-compatible capability layer, recipes/gramaticas adicionais e correcao pos-briefing Lumen Lab.
- Diretriz ativa: manter arquitetura modular, evitar concentrar solucoes em arquivos grandes, nao fazer deploy sem pedido explicito e fazer commit apenas quando o usuario pedir.

## Resumo executivo

O projeto evoluiu em tres frentes principais:

1. Aderencia de produto ao briefing: foram adicionados contratos, specs e recipes para reduzir fallback generico, priorizar o pedido atual e bloquear entregas com placeholder quando o usuario pediu conteudo final.
2. Preview, validacao visual e runtime: o sistema foi ajustado para reaproveitar servidor manual ja aberto, exigir captura real antes de declarar sucesso visual e avaliar cobertura visual por viewport.
3. UX/UI da plataforma como IDE: foram introduzidos modulos para layout de workspace, preferencias, recolhimento de paineis, primeira experiencia de uso e base para automacoes/terminal mais profissional.

Nota importante apos smoke manual 32/33: os mecanismos acima nao devem ser lidos como problema encerrado. Os testes manuais evidenciaram queda em blueprint generico, contaminacao por memoria antiga (`Studio Habitat` / `Helena Duarte Arquitetura`) e falhas de captura/preview. A rodada atual reforca contratos, regressions tests e mensagens honestas, mas ainda exige novo smoke manual para validar comportamento real.

## Principio modular mantido

As atualizacoes foram organizadas por responsabilidades separadas:

- Contratos e briefing ficam em `cortex/orchestration`.
- Preview, auth callback e validacao visual runtime ficam em `main/services`.
- Preferencias, montagem de workspace e interacao da UI ficam em `renderer`.
- Estilos foram separados em arquivos especificos dentro de `renderer/styles`.
- Regras de integridade e carregamento de modulos foram reforcadas por testes.

O objetivo foi evitar corrigir comportamento complexo direto em arquivos grandes como `renderer/app.js` ou em um unico blueprint monolitico.

## 1. Briefing, contexto atual e contratos

Problema tratado:

- O Faber Code estava usando padroes antigos ou genericos mesmo quando o usuario trazia um briefing completo com marca, secoes, textos, cores, tipografia e requisitos.
- Quando o dominio nao estava bem coberto, a ferramenta deveria propor contrato novo ou bloquear, em vez de gerar um site errado.

Atualizacoes feitas:

- Criacao de `cortex/orchestration/briefing_spec_service.js` para extrair uma especificacao mais objetiva do briefing atual.
- Reforco de `cortex/orchestration/briefing_contract_service.js`.
- Reforco de `cortex/orchestration/working_brief_service.js`.
- Ajustes em `cortex/orchestration/briefing_service.js`.
- Maior prioridade para o briefing atual sobre memoria antiga ou historico de conversa.
- Contratos passaram a exigir dominio, objetivo, publico, secoes prometidas, CTA, tom, assets, rotas e sinais de completude.
- Quando faltar contrato para um dominio relevante, o fluxo deve cair em escalacao de contrato, nao em fallback generico silencioso.

Resultado esperado:

- Briefings longos devem virar especificacoes utilizaveis.
- O sistema deve distinguir melhor entre "composicao modular provisoria" e "produto final com conteudo do briefing".
- Memoria ativa deve ajudar continuidade, mas nao sobrescrever uma solicitacao nova e explicita.

## 2. Blueprints, recipes e dominios

Problema tratado:

- Os smoke tests mostraram repeticao de blueprint antiga, mesmo para pedidos diferentes.
- Dominios como importacao e arquitetura precisavam de recipes proprias.
- "Site completo" precisava gerar rotas reais, nao apenas uma pagina unica com anchors genericas.

Atualizacoes feitas:

- Criacao de `cortex/orchestration/project_blueprint_manifest_service.js`.
- Atualizacoes em:
  - `cortex/orchestration/project_blueprint_service.js`
  - `cortex/orchestration/project_blueprint_request.js`
  - `cortex/orchestration/project_blueprint_copy.js`
  - `cortex/orchestration/project_blueprint_layout.js`
  - `cortex/orchestration/project_blueprint_next_templates.js`
  - `cortex/orchestration/project_blueprint_coverage_contract.js`
  - `cortex/orchestration/blueprint_icon_registry.js`

Dominios e recipes trabalhados:

- `import-services`
  - Landing page de importacao com hero, dores, solucao, servicos, processo, tipos de importacao, diferenciais, prova social, formulario qualificado, FAQ, WhatsApp e footer.
- `architecture`
  - Site de escritorio de arquitetura com marca, hero, video/asset visual, sobre, manifesto, servicos, cases, processo, diferenciais, depoimentos, insights/blog, contato e rotas.

Rotas esperadas para site completo:

- `app/sobre`
- `app/servicos`
- `app/projetos`
- `app/processo`
- `app/insights`
- `app/contato`

Resultado esperado:

- Landing continua sendo pagina unica quando o pedido for landing.
- Site completo deve gerar multiplas paginas quando o briefing pedir arquitetura institucional, portfolio, blog, contato e cases.
- Recipes devem carregar copy, estrutura e contratos especificos do dominio.

## 3. Gate contra placeholder e baixa aderencia

Problema tratado:

- Entregas com `Faber Projeto`, `placeholder`, `conteudo provisorio`, FAQ generico e formulario raso estavam passando como se fossem aceitaveis.
- Reparo grande por baixa aderencia tentava virar patch incremental e podia bater em `safe_patch_rewrite_ratio_too_large`.

Atualizacoes feitas:

- Reforco de `cortex/orchestration/artifact_quality_service.js`.
- Reforco de `cortex/orchestration/product_contract_service.js`.
- Reforco de `cortex/orchestration/product_orchestrator_service.js`.
- Reforco de `cortex/orchestration/product_policy_gate_service.js`.
- Ajustes em `cortex/orchestration/render_pass_service.js`.
- Bloqueios para termos e padroes genericos quando o usuario pediu conteudo final.
- Reparo de baixa aderencia deve preferir regeneracao a partir do briefing/checkpoint, nao um patch incremental deterministico enorme.

Padroes que devem ser bloqueados em pedido final:

- `placeholder`
- `conteudo provisorio`
- `pronta para evoluir`
- `Faber Projeto`
- FAQ generico de placeholder
- formulario raso quando o briefing pediu campos qualificados
- marca divergente do briefing
- dominio divergente do briefing

Resultado esperado:

- O sistema deve falhar cedo se o plano nao trouxer aderencia minima ao briefing.
- A validacao deve distinguir "tecnicamente compilou" de "entregou o produto pedido".

## 4. Preview, captura real e validacao visual

Problema tratado:

- A validacao visual anterior podia parecer aprovada mesmo sem captura real.
- O preview em Next podia estar rodando manualmente em `127.0.0.1:3000`, mas o runtime ainda nao reaproveitava isso bem.
- A captura visual precisava avaliar produto por viewport e nao apenas existencia de arquivos.

Atualizacoes feitas:

- Reforco de `main/services/project_preview_service.js`.
- Reforco de `main/services/project_preview_runtime_service.js`.
- Reforco de `main/services/project_visual_validation_runtime_service.js`.
- Reforco de `cortex/orchestration/visual_validation_service.js`.
- Criacao/reforco de `cortex/orchestration/visual_product_coverage_service.js`.
- O preview manual ativo pode ser adotado como fonte de captura.
- Resultado sem captura real nao deve aparecer como "visual passou".
- Falha de captura deve bloquear conclusao visual.
- Relatorios foram ajustados para mostrar quando existe analise estatica, quando existe captura real e quando a captura ficou pendente.

Cobertura visual esperada:

- Hero acima da dobra.
- CTA visivel.
- Loja/produtos quando prometidos.
- Blog/insights quando prometidos.
- Galeria/portfolio/cases quando prometidos.
- Depoimentos quando prometidos.
- Contato/formulario quando prometido.
- Footer quando prometido.
- Avaliacao por desktop, tablet e mobile.

Resultado esperado:

- A ferramenta deve produzir evidencia visual real antes de liberar conclusao.
- Falhas por timeout, preview indisponivel ou dominio divergente devem ficar claras no diagnostico.

## 5. Auth e tela pos-login

Problema tratado:

- O fluxo de login via Google voltava para uma pagina branca ou pouco polida no navegador.
- A mensagem de sucesso precisava ser mais simples e alinhada a marca Faber Code.

Atualizacoes feitas:

- Criacao de `main/services/platform_auth_callback_page_service.js`.
- Ajuste em `main/services/platform_backend_service.js` para servir a pagina de callback.
- Ajustes em `renderer/account_gate.js`.
- Ajustes em `renderer/styles/account-gate.css`.

Comportamento esperado:

- A tela de callback mostra marca Faber Code.
- A mensagem principal e direta: login feito com sucesso e a pagina pode ser fechada.
- O botao verde foi removido conforme ajuste de UX.
- Quando o navegador nao fecha automaticamente por limitacao do browser, a pagina informa o usuario com clareza.

## 6. Workspace, paineis e experiencia de IDE

Problema tratado:

- A plataforma precisava evoluir de chat com paineis fixos para uma IDE configuravel.
- O usuario deve poder escolher um modo inicial e depois ajustar paineis, ferramentas e fluxo de trabalho.
- O terminal precisa ficar mais proximo de uma ferramenta profissional.

Atualizacoes feitas:

- Criacao de `renderer/workspace_layout_preferences.js`.
- Criacao de `renderer/workspace_layout_builder.js`.
- Criacao de `renderer/workspace_layout_runtime.js`.
- Criacao de `renderer/styles/workspace-layout.css`.
- Ajustes em:
  - `renderer/index.html`
  - `renderer/app.js`
  - `renderer/app_state.js`
  - `renderer/project_terminal.js`
  - `renderer/ai_settings_controller.js`
  - `renderer/ai_settings_elements.js`
  - `renderer/styles.css`
  - `renderer/styles/settings.css`
  - `renderer/styles/system-shell.css`
  - `renderer/styles/workspace-tools.css`
  - `renderer/styles/README.md`

Funcionalidades trabalhadas:

- Preferencia de modo de uso:
  - Chat central.
  - Modo IDE/programador.
- Primeira experiencia com escolha de layout como progressive disclosure.
- Preferencia salva localmente no dispositivo.
- Configuracoes com montagem visual de areas do workspace.
- Areas previstas:
  - Projetos.
  - Chat.
  - Arquivos.
  - Terminal.
  - Automacoes.
  - Cortex.
- Base para automacoes rapidas, como git status, pre-smoke e commit guiado.
- Recolhimento de paineis laterais com controles flutuantes.
- Painel central deve permanecer vivo mesmo quando as laterais forem recolhidas.

Pontos ainda em refinamento:

- Persistencia visual do layout precisa ser endurecida.
- Recolher ambos os paineis ainda exige verificacao manual de UX.
- O terminal ainda precisa evoluir para abas, historico, comandos reutilizaveis, automacoes configuraveis e melhor legibilidade.
- A configuracao visual precisa ficar mais intuitiva e realmente refletir imediatamente o layout salvo.

## 7. Testes e smoke scenarios

Scripts de teste relevantes confirmados no `package.json`:

- `npm run test:briefing-spec`
- `npm run test:project-blueprint`
- `npm run test:project-preview`
- `npm run test:project-preview-runtime`
- `npm run test:project-visual-validation-runtime`
- `npm run test:platform-backend`
- `npm run test:smoke-scenarios`
- `npm run test:renderer-workspace-layout`
- `npm run test:renderer-module-contract`
- `npm run test:renderer-ai-settings`
- `npm run test:renderer-terminal`
- `npm run test:window-chrome-css`
- `npm run test:renderer-panel-layout`

Smoke scenarios reforcados:

- `teste_30_import_services_landing`
- `teste_31_helena_architecture_site`
- `preview_capture_unavailable`
- `current_briefing_contract_escalation`
- `route_contract_conflict`
- `visual_review_no_file_changes`
- `deterministic_patch_existing_project`
- `provider_failure_controlled`

Testes novos ou atualizados:

- `tests/briefing-spec-service.test.js`
- `tests/visual-product-coverage-service.test.js`
- `tests/project-blueprint-service.test.js`
- `tests/project-preview-service.test.js`
- `tests/project-preview-runtime-service.test.js`
- `tests/project-visual-validation-runtime-service.test.js`
- `tests/platform-backend-service.test.js`
- `tests/smoke-scenarios.test.js`
- `tests/renderer-workspace-layout-builder.test.js`
- `tests/renderer-workspace-layout-preferences.test.js`
- `tests/renderer-workspace-layout-runtime.test.js`
- `tests/renderer-module-contract.test.js`
- `tests/window-chrome-css.test.js`

Resultado ja observado em pre-smoke:

- A bateria principal de testes de briefing, blueprint, preview, runtime visual, backend e smoke scenarios passou em uma rodada local.
- Ainda existem falhas de produto em smoke manual, especialmente quando o provider retorna plano inutilizavel, quando ha divergencia de dominio ou quando a captura real falha por timeout.

## 8. Mapa de arquivos por frente

### Cortex e orquestracao

- `cortex/orchestration/artifact_quality_service.js`
- `cortex/orchestration/blueprint_icon_registry.js`
- `cortex/orchestration/briefing_contract_service.js`
- `cortex/orchestration/briefing_service.js`
- `cortex/orchestration/briefing_spec_service.js`
- `cortex/orchestration/build_mode_router_service.js`
- `cortex/orchestration/product_contract_service.js`
- `cortex/orchestration/product_orchestrator_service.js`
- `cortex/orchestration/product_policy_gate_service.js`
- `cortex/orchestration/project_blueprint_copy.js`
- `cortex/orchestration/project_blueprint_coverage_contract.js`
- `cortex/orchestration/project_blueprint_layout.js`
- `cortex/orchestration/project_blueprint_manifest_service.js`
- `cortex/orchestration/project_blueprint_next_templates.js`
- `cortex/orchestration/project_blueprint_request.js`
- `cortex/orchestration/project_blueprint_service.js`
- `cortex/orchestration/render_pass_service.js`
- `cortex/orchestration/visual_product_coverage_service.js`
- `cortex/orchestration/visual_validation_service.js`
- `cortex/orchestration/working_brief_service.js`

### Main services

- `main/services/platform_auth_callback_page_service.js`
- `main/services/platform_backend_service.js`
- `main/services/project_preview_runtime_service.js`
- `main/services/project_preview_service.js`
- `main/services/project_visual_validation_runtime_service.js`

### Renderer e UX/UI

- `renderer/account_gate.js`
- `renderer/ai_settings_controller.js`
- `renderer/ai_settings_elements.js`
- `renderer/app.js`
- `renderer/app_state.js`
- `renderer/index.html`
- `renderer/project_terminal.js`
- `renderer/workspace_layout_builder.js`
- `renderer/workspace_layout_preferences.js`
- `renderer/workspace_layout_runtime.js`
- `renderer/styles.css`
- `renderer/styles/account-gate.css`
- `renderer/styles/settings.css`
- `renderer/styles/system-shell.css`
- `renderer/styles/workspace-layout.css`
- `renderer/styles/workspace-tools.css`
- `renderer/styles/README.md`

## 9. Estimativa atualizada do produto

Estimativa tecnica apos as atualizacoes, antes de novo smoke test completo:

- UX/UI desktop: 86-88%
- Arquitetura modular: 84-86%
- Produto/orquestracao: 76-78%
- Patch seguro deterministico: 64-66%
- Contratos: 80-82%
- Validacao visual: 76-78%
- Memoria ativa/RAG/MemPalace: 43-45%
- Produto total pronto: 73-75%

Leitura:

- A arquitetura modular avancou.
- Os contratos ficaram mais fortes.
- O maior risco agora esta na experiencia real de produto: aderencia do gerador, estabilidade do layout configuravel e confiabilidade da captura visual.

## 10. Riscos e divergencias ainda abertas

- O sistema ainda pode gerar uma composicao generica quando o provider retorna plano ruim ou incompleto.
- A captura real pode falhar por timeout ou por preview nao estabilizado.
- O gate visual ja bloqueia melhor, mas precisa diferenciar com mais clareza erro de preview, erro de produto e erro de dominio.
- A interface configuravel de workspace ainda precisa de polimento de UX e persistencia visual confiavel.
- O terminal ainda e uma base; ainda nao e uma experiencia IDE completa.
- O fluxo de automacoes ainda esta em fundacao e precisa virar uma area operacional editavel pelo usuario.
- Ainda ha risco de conflito entre memoria antiga e briefing atual; o novo contrato reduz isso, mas o comportamento precisa ser validado em smoke real.

## 11. Proxima etapa recomendada

Antes de commit e antes de novo smoke test longo:

1. Estabilizar o workspace configuravel:
   - painel central nunca deve sumir;
   - paineis recolhidos devem voltar por icones discretos;
   - configuracao salva deve refletir no layout imediatamente;
   - terminal deve ter area mais clara e previsivel.
2. Rodar a bateria tecnica:
   - `npm run test:briefing-spec`
   - `npm run test:project-blueprint`
   - `npm run test:project-preview`
   - `npm run test:project-preview-runtime`
   - `npm run test:project-visual-validation-runtime`
   - `npm run test:platform-backend`
   - `npm run test:smoke-scenarios`
   - `npm run test:renderer-workspace-layout`
   - `npm run test:renderer-module-contract`
3. Rodar um smoke manual com dois casos novos:
   - landing page de dominio ainda nao testado;
   - site completo com marca, paginas, secoes, formulario e midia.
4. So depois disso avaliar commit.

## 12. Criterios para o proximo smoke test

O proximo smoke deve ser considerado satisfatorio apenas se:

- O briefing atual for usado como fonte principal.
- A marca pedida aparecer corretamente.
- O dominio nao divergir.
- As secoes prometidas aparecerem no preview.
- Placeholder for bloqueado em pedido final.
- Site completo gerar rotas reais.
- Landing gerar pagina unica completa.
- Preview manual em `127.0.0.1:3000` for reaproveitado quando estiver ativo.
- Nenhum relatorio disser que visual passou sem captura real.
- O layout da plataforma continuar usavel com paineis recolhidos ou reposicionados.

## 13. Correcao pos-briefing Lumen Lab

Apos o briefing real de laboratorio fotografico, foram corrigidos pontos que ainda permitiam fallback generico no fluxo do app:

- dominio generico `photo-lab` para laboratorio fotografico, revelacao, digitalizacao, impressao fine art, restauracao, ampliacoes e negativos;
- extracao correta de marca em blocos como `Nome ficticio do negocio`;
- recipe `photographic-lab-site` com hero full-bleed, servicos, processo, galeria, depoimentos, FAQ, formulario e footer;
- copy contextual para laboratorio fotografico, sem `Faber Projeto`, `Atendimento placeholder premium` ou texto placeholder;
- roteamento de briefings autocontidos que comecam por `Briefing completo - Site...`, mesmo quando o verbo de criacao nao aparece no inicio;
- priorizacao de `faber_blueprint` quando o build mode ja reconhece `initial_blueprint` e ha dominio/superficie suficiente;
- `browser_preview.capture` pode acionar instalacao de dependencias antes de declarar bloqueio manual de preview.

Regressoes executadas:

- `node tests/briefing-contract-service.test.js`
- `node tests/working-brief-service.test.js`
- `node tests/product-orchestrator-service.test.js`
- `node tests/project-blueprint-service.test.js`
- `node tests/pexels-asset-service.test.js`
- `node tests/faber-capability-adapter-service.test.js`
- `node tests/project-visual-validation-runtime-service.test.js`
- `node tests/project-preview-runtime-service.test.js`
- `node tests/tool-registry.test.js`
- `node tests/preload-api-contract.test.js`
- `node tests/build-mode-router-service.test.js`
- `npm run test:smoke-scenarios`
