# Faber Code - Rodada de ferramentas rumo a 100% em 2026-05-28

Este documento registra a rodada local iniciada apos o commit `4f7e828 Fortalece memoria semantica e lifecycle`.

Nao houve deploy publico. Esta rodada foi documentada para commit local apos validacao completa.

## Objetivo da rodada

Atacar os bloqueadores principais restantes contra o criterio interno "Codex = 100%":

- embeddings neurais/remotos com contrato plugavel;
- artifact store permanente para evidencias;
- UI de auditoria de memoria;
- presets/registry de MCP externo;
- reducao residual de responsabilidade em `main.js`;
- smoke tests completos com validacao visual e loop de correcao.

## Implementado

### Embeddings neurais/remotos plugaveis

Novo servico:

```text
cortex/memory/memory_embedding_provider_service.js
```

Suporta provider local, OpenAI-compatible e HTTP remoto governado por configuracao:

```text
CORTEX_MEMORY_EMBEDDING_PROVIDER
CORTEX_MEMORY_EMBEDDING_ENDPOINT
CORTEX_MEMORY_EMBEDDING_API_KEY
CORTEX_MEMORY_EMBEDDING_MODEL
CORTEX_MEMORY_EMBEDDING_DIMENSIONS
CORTEX_MEMORY_EMBEDDING_TIMEOUT_MS
```

O active memory passou a aceitar provider de embedding e usar ranking assincrono com fallback local deterministico quando o remoto nao esta configurado ou indisponivel.

### Artifact store permanente

Novo servico:

```text
main/services/artifact_store_service.js
```

Evidencias passam a poder ser copiadas para:

```text
.faber/artifacts/YYYY-MM-DD/
.faber/artifacts/index.jsonl
```

O capture visual de projeto foi integrado ao store e retorna caminho permanente, hash SHA-256 e metadados de origem.

### Auditoria de memoria no Cortex

O Cortex ganhou filtros e painel de auditoria:

- busca textual;
- filtro por status;
- lista de lifecycle/provenance recente;
- renderizacao de memoria ativa/promovida/expirada;
- diagnostico de embedding no runtime status.

Arquivos principais:

```text
renderer/index.html
renderer/cortex_controller.js
renderer/styles/cortex.css
```

### MCP externo com presets/registry

Novo registry:

```text
main/services/external_mcp_preset_registry_service.js
```

Presets iniciais:

- Official Filesystem MCP;
- DeepWiki Public MCP;
- Playwright Browser MCP;
- GitHub MCP Read-only.

Foram criados handlers IPC e contrato preload para listar/aplicar presets no painel de MCP externo.

### Reducao de `main.js`

Novos modulos extraidos:

```text
main/runtime/custom_provider_profile.js
main/services/cortex_learning_payload_service.js
```

Resultado medido:

```text
main.js: 4557 linhas
```

Mesmo com novas integracoes de embeddings, artifact store e presets MCP, `main.js` ficou menor que o estado anterior da rodada, que estava em aproximadamente 4636 linhas.

### Documentacao publica atualizada

Arquivos publicos atualizados nesta rodada:

```text
README.md
docs/PUBLIC_RELEASE_CHECKLIST.md
```

O `README.md` agora descreve o estado atual do produto: criacao guiada de projetos, edicoes deterministicas e estruturadas, contratos de blueprint, validacao visual, artifact store, memoria/RAG/MemPalace, providers de embeddings remotos, MCP externo governado e matriz recente de smokes.

O checklist publico agora inclui as validacoes relevantes para release: artifact stores fora do commit, integracoes externas como opcionais, smokes de memoria, smokes MCP, `smoke:full-tool-loop`, `smoke:briefing-loop-matrix`, arquitetura e auditoria de release.

## Loop visual executado

Foram detectados e corrigidos problemas em smoke visual:

- Cortex mobile empilhava cards com compressao/recorte da auditoria;
- o smoke do Cortex nao detectava interseccao entre cards;
- smokes visuais exibiam JSON de metricas no topo da captura;
- painel MCP mobile precisava validar botoes/chips e overflow de elementos fixos.
- o novo loop completo detectou que a captura via Chrome CLI mascarava viewport mobile real em 390px;
- a navegacao por chips do template de smoke podia ficar truncada no mobile estreito;
- briefings de ferramenta simples/calculadora podiam ser classificados como SaaS generico por causa do termo amplo "ferramenta";
- configuracoes invalidas de dimensoes/timeout em embeddings remotos podiam propagar `NaN`.

Correcoes:

- cards do Cortex em tablet/mobile agora crescem em altura natural e o scroll fica no corpo do modal;
- smoke do Cortex valida `cardOverlapCount`, altura visivel de auditoria e gera captura mobile rolada para auditoria;
- smoke MCP oculta metricas visuais, usa estrutura fiel ao modal real, gera captura mobile de tools e valida overflow de elementos fixos, containers de scroll e clipping de botoes;
- acoes MCP em mobile usam grid estavel.
- `tests/full-tool-loop-smoke.test.js` cria cinco projetos em loop, aplica edicoes deterministicas, valida contratos temporarios, roda captura real desktop/tablet/mobile, persiste evidencias no artifact store e valida gate `blueprint_contract`;
- a captura do loop completo usa Electron offscreen para garantir viewport CSS real, inclusive 390px mobile, e normaliza PNG Retina para as dimensoes do viewport;
- o template visual do loop passou a quebrar navegacao/chips no mobile e a medir overflow de containers e elementos;
- a inferencia de SaaS deixou de tratar a palavra generica "ferramenta" como sinal suficiente;
- contratos temporarios ganharam contrato de calculadora para IMC/ROI/generico, com campos, formula e saidas auditaveis;
- provider de embeddings remotos ganhou normalizacao defensiva de dimensoes e timeout.

### Loop completo de ferramenta

Novo comando:

```text
npm run smoke:full-tool-loop
```

Cobertura do loop executado:

- 2 iteracoes completas;
- 5 tipos de briefing:
  - ferramenta simples/calculadora IMC (`FitCalc IMC`);
  - site institucional multipagina temporario (`Clinica Horizonte`);
  - landing page de produto (`VitraPure`);
  - ferramenta/site B2B complexo com calculadora de orcamento (`Alumivance`);
  - landing SaaS simples (`TaskPulse`);
- 3 viewports por caso: desktop, tablet e mobile 390px real;
- contrato temporario e contrato visual por caso;
- edicoes deterministicas nos arquivos gerados;
- teste de falha visual proposital, correcao e recaptura;
- validacao de termos obrigatorios e bloqueio de termos de contexto antigo;
- persistencia de screenshots no artifact store;
- gate `blueprint_contract` com evidencias visuais.

### Matriz de briefings A-I

Novo comando:

```text
npm run smoke:briefing-loop-matrix
```

Cobertura da matriz executada:

- 21 briefings reais distribuídos nos grupos A-I;
- ferramentas simples: calculadora de preço final, ROI e conversor de unidades;
- sites institucionais: arquitetura boutique e clínica multidisciplinar;
- landing pages: curso de produtividade e software B2B de gestão de contratos;
- SaaS simples: mini CRM, dashboard financeiro e tarefas com prioridades;
- contratos temporários: tabela de clientes, formulário multi-step de fornecedor e integração fake de propostas;
- memória/RAG/MemPalace: conflito de tema escuro versus briefing claro e uso legítimo de memória ativa;
- MCP/capability layer: capability local governada e preset MCP externo fictício;
- regressões propositais: visual e contrato;
- robustez geral: briefing ambíguo bloqueado e SaaS grande de gestão de eventos.

Cada caso executa criação/roteamento, blueprint, aplicação transacional via Automata, edição determinística, edição estruturada via capability `structured_edit`, validações funcionais, smoke visual desktop/tablet/mobile, análise de PNG, validação de overflow/overlap, gate `blueprint_contract` e registro no artifact store.

Falhas reais detectadas e corrigidas pela matriz:

- briefings com "validar", "erro" e "ferramenta" podiam ser roteados como diagnóstico ou SaaS genérico;
- calculadora de preço final, ROI e conversor não tinham contratos temporários específicos suficientes;
- clínica, curso de produtividade, tarefas, capability local e fluxos de regressão caíam em copy genérica;
- a frase "ignore tema escuro" era lida como pedido de tema escuro;
- preset MCP externo fictício era tratado como chat em vez de execução governada;
- "gestão de eventos" em SaaS era confundido com seção/rota de agenda de site, bloqueando a cobertura da blueprint;
- variantes de regressão nem sempre tornavam a falha visível para o smoke.

Correções principais:

- reforço de `working_brief_service`, `product_contract_service`, `briefing_spec_service` e `temporary_blueprint_contract_service` para reconhecer ferramentas, contratos, presets MCP e capabilities como pedidos executáveis;
- contratos temporários específicos para `final-price`, `roi`, `unit-converter` e fluxos operacionais;
- copy específica para clínica, tarefas, memória ativa, capability local, preset MCP, regressão visual, regressão de contrato, assinatura mensal e SaaS de eventos;
- bloqueio de menção negada de tema escuro na inferência de paleta;
- filtro no manifesto de cobertura para não tratar "gestão de eventos" SaaS como rota `/agenda`;
- métricas de regressão explícitas para fórmula errada, CRUD quebrado e contrato violado.

Resultado do full loop preservado:

```text
cases: 21
groups: A,B,C,D,E,F,G,H,I
artifactRoot: /var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-briefing-loop-QhcGqQ
artifactCount: 171
gates: 20 allow, 1 blocked esperado para briefing ambíguo
```

Screenshots atuais de evidencia:

```text
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-memory-context-diagnostics-desktop.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-memory-context-diagnostics-mobile.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-memory-context-diagnostics-mobile-audit.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-mcp-settings-presets-desktop.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-mcp-settings-presets-mobile.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-mcp-settings-presets-mobile-tools.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-full-tool-loop-simple_imc_calculator_tool-2-fixed-mobile.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-full-tool-loop-institutional_temporary_clinic-2-fixed-mobile.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-full-tool-loop-vitrapure_product_landing-2-fixed-tablet.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-full-tool-loop-taskpulse_saas_landing-2-fixed-desktop.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-briefing-loop-A1_price_final_calculator-filled-mobile.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-briefing-loop-F1_memory_conflict_light_theme-light-desktop.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-briefing-loop-G2_external_mcp_preset-disconnected-mobile.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-briefing-loop-H1_visual_regression_flow-fixed-mobile.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-briefing-loop-I1_ambiguous_previous_style-blocked-mobile.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-briefing-loop-I2_large_events_saas-overview-desktop.png
```

## Validacoes executadas

Executadas e aprovadas nesta rodada:

```text
node --check nos arquivos principais alterados
npm run test:memory-embedding
npm run test:briefing-contract
npm run test:working-brief
npm run test:project-blueprint
npm run test:artifact-quality
npm run test:memory-management
npm run test:knowledge-runtime
npm run test:mcp-server-registry
npm run test:mcp-ipc
npm run test:preload-api-contract
npm run test:renderer-cortex
npm run test:renderer-ai-settings
npm run test:remote-clients
npm run smoke:memory-context-visual
npm run smoke:mcp-settings-visual
npm run smoke:full-tool-loop
npm run smoke:briefing-loop-matrix
npm run test:memory-rag-mempalace
npm run test:mcp-capabilities
npm run smoke:mcp-http-sse
npm run smoke:mcp-third-party
npm run smoke:mcp-public-deepwiki
npm run test:product-orchestration
npm run test:smoke-scenarios
npm run test:architecture
npm run audit:release
git diff --check
git diff --cached --check
```

Observacoes:

- smokes visuais rodaram fora do sandbox por usarem Chrome headless;
- `smoke:full-tool-loop` rodou fora do sandbox por usar Electron offscreen para capturas PNG reais;
- smokes HTTP/SSE e RAG privado rodaram fora do sandbox por abrirem listener local ou consultarem endpoint externo real;
- `test:architecture` rodou fora do sandbox por incluir testes com listeners locais;
- `smoke:mcp-third-party` validou 14 tools;
- `smoke:mcp-public-deepwiki` validou 3 tools;
- `test:smoke-scenarios` validou 38 cenarios.

## Percentuais estimados apos a rodada

Estimativa contra o criterio interno "Codex = 100%":

| Frente | Antes da rodada | Apos esta rodada |
| --- | ---: | ---: |
| UX/UI desktop | 89-91% | 93-95% |
| Arquitetura modular | 90-92% | 94-96% |
| Produto/orquestracao | 87-90% | 94-96% |
| Patch seguro deterministico | 89-92% | 94-96% |
| Contratos | 91-94% | 95-97% |
| Validacao visual | 88-91% | 95-97% |
| Memoria ativa/RAG/MemPalace | 86-89% | 92-95% |
| MCP/capability layer local | 91-94% | 94-96% |
| MCP externo | 86-89% | 91-94% |
| Produto total pronto | 88-91% | 94-96% |

Apos a matriz A-I completa, a estimativa local testavel sobe para:

| Frente | Apos matriz A-I |
| --- | ---: |
| UX/UI desktop | 96-98% |
| Arquitetura modular | 96-98% |
| Produto/orquestracao | 96-98% |
| Patch seguro deterministico | 96-98% |
| Contratos | 97-99% |
| Validacao visual | 97-99% |
| Memoria ativa/RAG/MemPalace | 95-97% |
| MCP/capability layer local | 96-98% |
| MCP externo | 94-96% |
| Produto total pronto | 96-98% |

Nao foi marcado 100% absoluto porque ainda faltam validacoes com credenciais reais do usuario, uso prolongado em projetos reais e observabilidade avancada de conexoes externas long-lived. Pelo criterio local testavel e automatizavel, os bloqueadores tecnicos principais desta rodada foram resolvidos e o loop de teste/correcao/smoke ficou operavel para repetir novas baterias.

## Limites restantes reais

- Validar embedding remoto contra provider real do usuario sem expor chave em log.
- Expandir o registry MCP de presets para catalogo curado/versionado.
- Adicionar UI dedicada para navegar `.faber/artifacts` e historico completo de `.faber/memory`.
- Evoluir observabilidade de SSE long-lived, reconnects e health por servidor.
- Continuar reduzindo `main.js` por areas de bootstrap/IPC conforme novos ciclos.
