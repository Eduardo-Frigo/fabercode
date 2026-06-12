# Faber Code - Avancos completos ate 2026-05-28

Este documento consolida o estado do Faber Code apos a rodada de Memoria ativa/RAG/MemPalace de 2026-05-28 e a rodada complementar local de ferramentas rumo a 100%.

Nao houve deploy publico. A rodada de memoria foi commitada em `4f7e828`; a rodada complementar registrada neste documento foi preparada para commit local apos validacao completa.

## Estado do repositorio da rodada complementar

- Branch: `main`
- Ultimo commit confirmado antes desta rodada complementar: `4f7e828 Fortalece memoria semantica e lifecycle`
- Estado de trabalho: alteracoes da frente de embeddings remotos, artifact store, auditoria de memoria, MCP presets, reducao de `main.js`, testes, smokes visuais e documentacao consolidadas para commit local
- Publicacao externa: nao realizada

Commits recentes antes desta rodada complementar:

- `4f7e828 Fortalece memoria semantica e lifecycle`
- `22964e7 Fortalece MCP externo real`
- `f5a5665 Documenta diversidade e validacao das blueprints`
- `d4a2d91 Amplia diversidade e validacao das blueprints`
- `45ec6bb Documenta status MCP e blueprints`

## Resumo do ciclo 2026-05-27 a 2026-05-28

### MCP externo

Rodada anterior concluida no commit `22964e7`:

- capability `external_mcp`;
- bridge governada;
- transportes `stdio`, HTTP e SSE;
- registry persistente;
- cache visual persistente de discovery;
- UI avancada de configuracao;
- politicas por risco, tool, escopo, diretorio e rede;
- secrets mascarados;
- `projectSession` separado dos argumentos externos por padrao;
- smokes reais com HTTP/SSE local, DeepWiki publico e servidor oficial `@modelcontextprotocol/server-filesystem`.

### Memoria ativa/RAG/MemPalace

Rodada atual:

- ranking semantico vetorial local;
- provenance completa com sinais de ranking;
- ledger `.faber/memory`;
- lifecycle de memoria;
- UX de biblioteca de memoria;
- Context Frame com diagnostico humano;
- politica de confirmacao para ambiguidade;
- endpoints RAG privados/autenticados em smoke real;
- reindex/delete RAG configuraveis;
- tombstone de esquecimento no MemPalace;
- testes e smokes ampliados.

Documento dedicado:

```text
docs/FABER_CODE_MEMORIA_RAG_MEMPALACE_AVANCOS_2026-05-28.md
```

### Rodada complementar local apos `4f7e828`

Depois do commit `4f7e828 Fortalece memoria semantica e lifecycle`, foi executada uma nova rodada local, sem deploy publico, para atacar os principais bloqueadores restantes:

- provider plugavel de embeddings neurais/remotos;
- artifact store permanente em `.faber/artifacts`;
- auditoria visual de memoria no Cortex;
- presets/registry MCP externo com IPC e preload;
- reducao adicional de responsabilidade em `main.js`;
- smokes visuais com loop de correcao em Cortex e MCP settings.
- loop completo automatizado de teste/correcao/smoke para briefings de ferramentas, sites, landing pages, SaaS e calculadoras com contratos temporarios, edicoes deterministicas e capturas desktop/tablet/mobile.

Documento dedicado:

```text
docs/FABER_CODE_FERRAMENTAS_100_AVANCOS_2026-05-28.md
```

## Arquivos principais da rodada atual

Novos:

```text
cortex/memory/memory_embedding_service.js
cortex/memory/memory_provenance_service.js
main/services/cortex_memory_management_service.js
main/services/memory_evidence_ledger_service.js
tests/cortex-memory-management-service.test.js
tests/memory-context-diagnostics-visual-smoke.test.js
tests/memory-embedding-service.test.js
tests/memory-evidence-ledger-service.test.js
tests/memory-private-rag-endpoint-smoke.test.js
tests/memory-provenance-service.test.js
tests/renderer-cortex-controller.test.js
```

Fortalecidos:

```text
cortex/memory/active_memory_service.js
cortex/memory/context_adapter.js
cortex/memory/cortex_memory_sync_service.js
cortex/memory/knowledge_runtime_service.js
cortex/orchestration/orchestration_context_frame_service.js
cortex/orchestration/orchestration_context_frame_evidence_service.js
cortex/orchestration/persona_orchestrator.js
cortex/orchestration/product_policy_gate_service.js
cortex/orchestration/state_store.js
main.js
main/ipc/knowledge_runtime_handlers.js
main/runtime/project_context.js
main/runtime/runtime_config.js
preload.js
renderer/cortex_controller.js
renderer/index.html
renderer/styles/cortex.css
package.json
```

## Percentuais atualizados

Estimativa atual contra o criterio interno "Codex = 100%":

| Frente | Estimativa |
| --- | ---: |
| UX/UI desktop | 93-95% |
| Arquitetura modular | 94-96% |
| Produto/orquestracao | 94-96% |
| Patch seguro deterministico | 94-96% |
| Contratos | 95-97% |
| Validacao visual | 95-97% |
| Memoria ativa/RAG/MemPalace | 92-95% |
| MCP/capability layer local | 94-96% |
| MCP externo | 91-94% |
| Produto total pronto | 94-96% |

Apos a matriz automatizada A-I com 21 briefings, edicoes deterministicas, edicao estruturada MCP, regressao proposital, screenshots desktop/tablet/mobile e artifact store preservado, a estimativa local testavel fica:

| Frente | Estimativa pos-matriz A-I |
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

## Validacoes finais da rodada

Executadas e aprovadas:

```text
node --check nos arquivos principais alterados
npm run test:briefing-contract
npm run test:working-brief
npm run test:project-blueprint
npm run test:memory-embedding
npm run test:memory-rag-mempalace
npm run smoke:memory-private-rag
npm run smoke:memory-context-visual
npm run smoke:full-tool-loop
npm run smoke:briefing-loop-matrix
npm run test:smoke-scenarios
npm run test:architecture
npm run audit:release
git diff --check
npm run smoke:mcp-settings-visual
npm run smoke:mcp-http-sse
npm run smoke:mcp-third-party
npm run smoke:mcp-public-deepwiki
git diff --cached --check
```

Observacoes:

- `smoke:memory-private-rag` precisou rodar fora do sandbox porque sobe servidor HTTP local em `127.0.0.1`.
- `smoke:memory-context-visual` precisou rodar fora do sandbox porque executa Chrome headless.
- `smoke:full-tool-loop` precisou rodar fora do sandbox porque executa Electron offscreen para capturas PNG reais.
- `test:architecture` tambem foi executado fora do sandbox porque inclui testes com listeners locais.

## Screenshots de evidencia

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

Artifact store preservado da matriz A-I:

```text
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-briefing-loop-QhcGqQ
171 evidencias
```

## O que ainda trava o 100%

### Memoria/RAG/MemPalace

- Embeddings neurais/remotos agora tem provider plugavel, mas ainda falta validar contra credencial real do usuario em ambiente seguro.
- UI de auditoria historica de memoria existe no Cortex, mas ainda pode evoluir para navegacao completa por periodo/job/projeto.
- `.faber/memory` ainda nao tem explorador dedicado como arquivo historico completo dentro do app.
- Testes contra endpoints privados reais do usuario ainda dependem de credenciais fornecidas em ambiente seguro.

### MCP externo

- Presets/guias iniciais foram criados, mas ainda falta marketplace/registry externo curado e versionado.
- Rotacao e validacao de secrets por provider ainda podem evoluir.
- Observabilidade de SSE long-lived pode ficar mais rica.

### Produto total

- A camada de artifact store permanente foi criada, mas ainda falta UI dedicada para navegar `.faber/artifacts`.
- `main.js` segue sendo reduzido gradualmente, mas ainda concentra integracao de muitos servicos.
- A experiencia simples para usuarios nao tecnicos ainda precisa esconder parte da complexidade admin.

## Regras permanentes preservadas

1. Arquitetura modular acima de atalhos em `main.js`.
2. Mensagem atual, briefing da conversa, memoria ativa, memoria de usuario, memoria de projeto, RAG e MemPalace separados.
3. Memoria nao contamina briefing autocontido.
4. MCP externo pertence ao Faber Code, nao ao modelo.
5. Deploy publico so ocorre por pedido explicito.
6. Commit so ocorre por pedido explicito do usuario.

## Leitura recomendada

1. `docs/FABER_CODE_FERRAMENTAS_100_AVANCOS_2026-05-28.md`
2. `docs/FABER_CODE_MEMORIA_RAG_MEMPALACE_AVANCOS_2026-05-28.md`
3. `docs/FABER_CODE_MCP_EXTERNO_AVANCOS_COMPLETOS_2026-05-27.md`
4. `docs/FABER_CODE_MCP_EXTERNO_BRIDGE_2026-05-27.md`
5. `docs/FABER_CODE_BLUEPRINTS_DIVERSIDADE_VALIDACAO_2026-05-27.md`
6. `docs/FABER_CODE_MCP_CONTRATOS_BLUEPRINTS_2026-05-27.md`
7. `docs/FABER_CODE_AVANCOS_COMPLETOS_2026-05-27.md`
