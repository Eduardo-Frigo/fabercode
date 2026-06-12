# Faber Code - Avancos Completos do Projeto em 2026-05-25

Este documento consolida os avancos reais do Faber Code no ciclo pos-smoke, incluindo o estado posterior ao commit `30e163c Fortalece contratos e workspace apos smoke tests`, os smoke tests 34 a 42, a primeira camada MCP-compatible e a correcao feita apos o briefing real do Lumen Lab Fotografico.

Ele deve ser lido como documento de handoff tecnico. Nao registra deploy publico, publicacao externa ou commit novo. O estado atual continua com mudancas locais pendentes ate o proximo smoke manual e o pedido explicito de commit.

## Estado atual do repositorio

- Projeto local: `<repo-root>`
- Branch: `main`
- Ultimo commit confirmado: `30e163c Fortalece contratos e workspace apos smoke tests`
- Estado depois desse commit: existem mudancas locais pendentes, incluindo correcoes de blueprints, contratos, MCP-compatible capability layer, testes e documentacao.
- Deploy/publicacao externa: nao realizado.
- Commit novo: nao realizado.
- Runtime esperado: Node `24.15.0`, conforme `.nvmrc` e `package.json`.

Comando recomendado para abrir o app:

```bash
cd "<repo-root>"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm use 24.15.0
npm install
npm run dev
```

## Linha do tempo do ciclo

### Smoke 32 e 33

Os testes 32 e 33 expuseram problemas centrais:

- queda em blueprint generico;
- memoria antiga contaminando briefing novo;
- marca errada no artefato final;
- site completo com paginas rasas;
- validacao visual estatica parecendo sucesso mesmo sem captura real;
- preview/captura instavel;
- UX de workspace ainda fragil em paineis e terminal.

As primeiras correcoes geraram o commit `30e163c`.

### Smoke 34 e 35

Foram adicionadas capacidades genericas para dominios que apareceram nos testes:

- produto sustentavel com catalogo;
- servicos tecnicos B2B multipagina.

As fixtures `VitraPure` e `Alumivance` ficaram restritas aos testes. O runtime recebeu categorias genericas, recipes e gramaticas reutilizaveis, nao contratos permanentes com nomes ficticios.

### Smoke 36 e 37

Foram adicionadas capacidades genericas para:

- vinhos premium sensoriais;
- materiais de construcao multipagina.

As fixtures `Aurora di Vento` e `Constrular Prime` tambem ficaram apenas como regressions tests. As correcoes viraram recipes/gramaticas por categoria.

### Smoke 38 e 39

Foram criados novos testes para validar variedade real de espinhas dorsais visuais:

- SaaS/ferramenta operacional;
- conteudo editorial/hub de revista.

O objetivo foi reduzir a repeticao de estrutura com textos trocados e provar que dominios diferentes usam gramaticas visuais diferentes.

### Smoke 40 e 41

Foram criados novos testes para:

- food/sensorial, com base em chocolate artesanal;
- importacao/servicos, com base em logistica de comercio exterior.

Esses testes reforcaram receitas de produto sensorial, servico comercial e importacao, alem de validar que os nomes ficticios continuavam como fixtures.

### Briefing real Lumen Lab

O briefing real do laboratorio fotografico mostrou que ainda havia queda em composicao generica, placeholder e dominio errado quando o pedido vinha como texto longo comecando por `Briefing completo - Site...`.

Correcoes feitas:

- dominio generico `photo-lab`;
- recipe `photographic-lab-site`;
- gramatica visual `sensory-immersive-story`;
- copy contextual para laboratorio fotografico;
- extracao correta de marca em `Nome ficticio do negocio`;
- roteamento de briefing autocontido para `initial_blueprint`;
- priorizacao de `faber_blueprint` quando ha dominio e superficie suficientes;
- Pexels query especifica para darkroom, negativos, revelacao e fine art;
- `browser_preview.capture` pode preparar dependencias antes de declarar bloqueio manual de preview.

## Avancos por frente

## 1. UX/UI desktop e workspace

Avancos:

- base de workspace mais proxima de IDE;
- paineis laterais recolhiveis;
- area central preservada em cenarios de painel recolhido;
- terminal com superficie mais organizada;
- estado visual de execucao mais claro;
- configuracoes e preferencias de layout em modulos dedicados;
- separacao entre layout builder, preferencias e runtime.

Modulos principais:

- `renderer/workspace_layout_preferences.js`
- `renderer/workspace_layout_builder.js`
- `renderer/workspace_layout_runtime.js`
- `renderer/project_terminal.js`
- `renderer/app_actions.js`
- `renderer/app_projects.js`
- `renderer/styles/workspace-layout.css`
- `renderer/styles/workspace-tools.css`

Limites atuais:

- ainda precisa smoke manual em janelas estreitas;
- terminal ainda nao e IDE completa;
- automacoes visuais ainda estao em fundacao;
- mobile dos projetos gerados ainda precisa validacao real, especialmente menu hamburger.

## 2. Arquitetura modular

Avancos:

- responsabilidades separadas entre Cortex, main services, renderer, tests e docs;
- novas recipes e gramaticas visuais fora de monolitos;
- MCP-compatible layer criada sem substituir Automata;
- validacao visual integrada por contrato e capability;
- documentacao modular atualizada para handoff.

Modulos principais:

- `cortex/orchestration/briefing_contract_service.js`
- `cortex/orchestration/briefing_spec_service.js`
- `cortex/orchestration/working_brief_service.js`
- `cortex/orchestration/product_contract_service.js`
- `cortex/orchestration/product_policy_gate_service.js`
- `cortex/orchestration/project_blueprint_copy.js`
- `cortex/orchestration/project_blueprint_layout.js`
- `cortex/orchestration/project_blueprint_next_templates.js`
- `cortex/orchestration/project_blueprint_visual_grammar.js`
- `cortex/orchestration/project_blueprint_visual_next_renderers.js`
- `main/services/faber_capability_adapter_service.js`

## 3. Produto e orquestracao

Avancos:

- o briefing atual passa a ter prioridade maior que memoria antiga;
- briefings longos autocontidos sao reconhecidos como criacao inicial;
- `initial_blueprint` e `adaptive_blueprint` foram formalizados como modos de build, nao como sinonimos soltos de rota;
- `faber_blueprint` foi formalizado como modo de rota executavel quando o blueprint local do Faber assume uma primeira base coberta;
- rota `faber_blueprint` fica obrigatoria quando o build mode reconhece `initial_blueprint` para criacao inicial coberta;
- `adaptive_blueprint` permanece como rota executavel apenas quando o proprio build mode e adaptativo;
- queda em `cortex_scaffold` generico foi reduzida;
- contratos de produto passam a observar dominio, marca, secoes, superficie e completude.

Modulo de contrato:

- `cortex/orchestration/product_route_mode_contract_service.js`

Problemas atacados:

- `Faber Projeto`;
- `Atendimento placeholder premium`;
- `Uma presenca digital clara para transformar visitantes em contatos`;
- memoria antiga de smoke anterior;
- dominio divergente do briefing;
- marca divergente.

## 4. Blueprints, recipes e gramaticas visuais

Dominios e categorias reforcados:

- `intellectual-property`
- `wood-finishes`
- `import-services`
- `architecture`
- `gardening`
- `greenhouses`
- `sustainable-product-landing`
- `technical-b2b-services-site`
- `premium-wine-landing`
- `construction-materials-site`
- `chocolate`
- `saas-tool`
- `editorial-content`
- `photo-lab`

Recipes/gramaticas relevantes:

- `consumer-product-catalog-landing`
- `technical-b2b-lead-site`
- `wine-sensory-landing`
- `construction-materials-store-site`
- `architecture-studio-site`
- `import-service-landing`
- `sensory-chocolate-landing`
- `saas-tool-landing`
- `editorial-content-hub`
- `photographic-lab-site`
- `consumer-product-mosaic`
- `technical-b2b-systems`
- `wine-sensory-cellar`
- `construction-retail-yard`
- `trade-logistics-command`
- `saas-tool-workspace`
- `editorial-content-hub`
- `sensory-immersive-story`

Regra permanente:

- nomes ficticios de smoke test nao viram contrato permanente;
- cada lacuna encontrada deve virar capacidade generica reutilizavel;
- site completo deve gerar estrutura inicial completa e ajustavel, com rotas profundas quando fizer sentido.

## 5. Patch seguro deterministico

Avancos:

- edicoes pequenas continuam direcionadas para patch deterministico;
- mudancas estruturais grandes nao devem ser forcadas como patch incremental;
- baixa aderencia de produto deve voltar para regeneracao controlada a partir do briefing/checkpoint;
- smoke `deterministic_patch_existing_project` continua cobrindo caminho pequeno e seguro.

Limite atual:

- o patch seguro continua solido para alteracoes locais pequenas;
- reescritas grandes ainda devem ser tratadas como blueprint/regeneracao, nao patch.

## 6. Contratos e governanca

Avancos:

- `AUTOMATA_CONTRACTS.md` reforca que Automata governa intencao, permissao, risco, contrato, blueprint, memoria e validacao;
- MCP/capability layer nao substitui Automata;
- smoke fixtures nao sao contratos permanentes;
- contratos de briefing passaram a bloquear contexto antigo quando ha pedido novo autocontido;
- escalacao de contrato continua preferivel a fallback generico silencioso.

Contratos reforcados:

- contrato de dominio;
- contrato de marca;
- contrato de recipe;
- contrato de rotas para site completo;
- contrato de captura visual;
- contrato de evidencia por capability.

## 7. Validacao visual e preview

Avancos:

- validacao visual distingue tecnica, aderencia estatica e captura real;
- sem captura real, o resultado nao deve ser marcado como visualmente aprovado;
- `browser_preview.capture` pode ser usado como fonte de evidencia;
- falha de captura deve preservar checkpoint e nao acionar auto-reparo indevido;
- capability adapter pode preparar dependencias para captura antes de declarar bloqueio manual.

Modulos principais:

- `main/services/project_preview_runtime_service.js`
- `main/services/project_visual_validation_runtime_service.js`
- `main/services/faber_capability_adapter_service.js`
- `cortex/capabilities/capability_gateway.js`
- `cortex/capabilities/capability_result.js`

Limites atuais:

- captura real ainda pode falhar por timeout/runtime;
- qualidade estetica profunda ainda nao esta completamente automatizada;
- smoke manual com imagens continua necessario.

## 8. Memoria ativa, RAG e MemPalace

Avancos:

- memoria antiga tem menos autoridade quando o briefing atual e completo;
- regressions tests cobrem contaminacao por dominios anteriores;
- working brief foi reforcado para preservar marca/dominio atuais.
- memoria ativa agora carrega escopo por usuario/projeto/conversa/job quando disponivel;
- cada contexto ativo tem janela de validade/expiracao e pode ser ignorado quando expira;
- RAG/MemPalace/Cortex retornam citacoes, motivo de recuperacao e contagem auditavel;
- smoke dedicado bloqueia uso de memoria expirada ou de outro projeto antes de gerar briefing.

Limites atuais:

- servidor externo real de MemPalace/RAG ainda depende da configuracao local;
- persistencia historica de evidencias por job/projeto ainda precisa evoluir;
- memoria deve ajudar continuidade, nao substituir briefing novo.

## 9. MCP-compatible capability layer

Capacidades iniciais:

- `filesystem`
- `terminal`
- `browser_preview`
- `git`

Modulos adicionados:

- `cortex/capabilities/capability_result.js`
- `cortex/capabilities/project_session_contract.js`
- `cortex/capabilities/capability_gateway.js`
- `cortex/tools/capability_tools.js`
- `main/services/faber_capability_adapter_service.js`

Ganhos:

- resultado estruturado por capability;
- `projectSession` obrigatorio;
- browser preview e captura visual podem virar evidencia;
- caminho preparado para substituir adapters locais por MCP real no futuro.

Limites atuais:

- ainda nao ha servidor MCP externo real;
- evidencias ainda precisam persistir por job/projeto;
- capability layer nao decide produto, so executa operacoes padronizadas.

## 10. Pexels e placeholders de imagem

Avancos:

- `main/services/pexels_asset_service.js` reconhece dominios adicionais;
- `photo-lab` gera query especifica para darkroom, revelacao, laboratorio fotografico, fine art e negativos;
- o blueprint pode receber imagens/videos contextuais sem depender de placeholder visual generico.

Limites atuais:

- a qualidade final depende da API/configuracao disponivel;
- fallback sem asset real ainda precisa ser tratado com honestidade visual;
- atribuicoes e uso de midia devem continuar sendo validados no preview.

## 11. Testes automatizados e smoke scenarios

Smoke geral confirmado com Node `24.15.0`:

```bash
npm run test:smoke-scenarios
```

Resultado confirmado:

- 27 cenarios passaram;
- `teste_42_lumen_lab_photo_lab` passou;
- dominio `photo-lab`;
- recipe `photographic-lab-site`;
- gramatica `sensory-immersive-story`.

Regressoes criticas confirmadas:

```bash
node tests/briefing-contract-service.test.js
node tests/working-brief-service.test.js
node tests/product-orchestrator-service.test.js
node tests/project-blueprint-service.test.js
node tests/pexels-asset-service.test.js
node tests/faber-capability-adapter-service.test.js
node tests/project-visual-validation-runtime-service.test.js
node tests/project-preview-runtime-service.test.js
node tests/tool-registry.test.js
node tests/preload-api-contract.test.js
node tests/build-mode-router-service.test.js
node tests/artifact-quality-service.test.js
npm run test:smoke-scenarios
```

## Percentuais estimados contra Codex = 100%

Estimativa apos as correcoes atuais, antes do proximo smoke manual real:

| Area | Estimativa atual |
| --- | ---: |
| UX/UI desktop | 80-82% |
| Arquitetura modular | 89-90% |
| Produto/orquestracao | 78-80% |
| Patch seguro deterministico | 67-68% |
| Contratos | 82-84% |
| Validacao visual | 74-76% |
| Memoria ativa/RAG/MemPalace | 45-46% |
| MCP-compatible capability layer | 42-45% |
| Produto total pronto | 75-77% |

Leitura:

- arquitetura e contratos estao mais maduros que a experiencia final;
- produto/orquestracao melhorou com `photo-lab` e roteamento de briefing autocontido;
- validacao visual ainda depende de captura real estavel;
- memoria e MCP ainda sao fundacoes, nao camada final madura;
- o proximo smoke manual e necessario antes do commit.

## Riscos ainda abertos

- O provider pode retornar plano raso ou pouco aderente.
- Captura visual pode falhar por runtime, timeout ou dependencia.
- Mobile precisa validacao real de menu hamburger e navegacao.
- Memoria antiga ainda precisa governanca com provenance, validade e expiracao.
- Pexels/API externa pode falhar ou devolver asset pouco aderente.
- Qualidade estetica profunda ainda nao e medida como um designer humano faria.
- Workspace/terminal ainda precisam smoke manual em edge cases.

## Proximo passo tecnico recomendado

Rodar novo smoke manual real no app com:

- um briefing novo de laboratorio fotografico ou dominio visualmente exigente;
- um briefing novo de site completo multipagina;
- captura desktop, tablet e mobile;
- verificacao de menu hamburger;
- verificacao de ausencia de placeholder;
- verificacao de uso correto de Pexels/assets;
- comparacao dos arquivos gerados com o briefing;
- relatorio dentro de uma pasta de smoke;
- commit apenas depois da aprovacao do smoke.
