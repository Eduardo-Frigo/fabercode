# Faber Code - Avancos de Memoria, RAG e MemPalace em 2026-05-28

Este documento registra a rodada de evolucao da area Memoria ativa/RAG/MemPalace do Faber Code em 2026-05-28.

Nao houve deploy publico. A rodada foi implementada localmente, validada com testes/smokes e preparada para commit por pedido explicito do usuario.

## Resumo executivo

A frente Memoria ativa/RAG/MemPalace deixou de ser apenas uma camada segura de contexto e passou a ser uma camada mais confiavel, explicavel e operavel pelo usuario.

Depois da rodada, a area ganhou:

- ranking semantico vetorial local;
- confidence score com sinais semanticos, lexicais, frase, recencia, fonte e promocao;
- provenance enriquecida com similaridade vetorial e conceitos casados;
- ledger de memoria por job em `.faber/memory`;
- painel de Context Frame no Cortex;
- UX de biblioteca de memoria com editar, promover, expirar, apagar, atualizar e reindexar;
- lifecycle backend para listar, editar, promover, expirar, apagar, esquecer e reindexar;
- smoke HTTP real com endpoint RAG privado/autenticado por Bearer token;
- smoke visual desktop/mobile com screenshots reais.

Estimativa atualizada contra o criterio interno "Codex = 100%":

| Frente | Antes desta frente | Depois desta rodada |
| --- | ---: | ---: |
| Memoria ativa/RAG/MemPalace | 72-78% | 86-89% |
| Produto total pronto | 87-90% | 88-91% |

O valor ainda nao foi marcado como 90%+ porque o embedding atual e deterministico/local. A arquitetura esta pronta para plugar embeddings neurais/remotos, mas isso ainda nao foi conectado como provider de producao.

## Decisoes arquiteturais

### Memoria continua pertencendo ao Faber Code

A memoria nao pertence ao modelo. RWKV, OpenAI, Gemini ou outro provider continuam consumindo apenas contratos governados pelo Faber.

Fluxo correto:

```text
Usuario -> Faber Code -> Context Frame -> Memoria governada -> Capabilities/Runtime -> Modelo
```

O modelo nao decide sozinho que memoria usar. O Faber seleciona, ranqueia, aplica escopo/validade, registra provenance e expoe contexto permitido.

### Ranking vetorial local antes de provider externo

Foi criado um embedding local deterministico:

```text
cortex/memory/memory_embedding_service.js
```

Ele usa normalizacao de texto, tokens, aliases semanticos, stems leves, char n-grams, hashing vetorial e cosine similarity.

Objetivo: melhorar o ranking sem depender de rede, credencial ou modelo externo.

Limite assumido: isso nao substitui embeddings neurais reais. Ele aumenta robustez e testabilidade, mas ainda e uma base local.

## Provenance com ranking semantico

Arquivo principal:

```text
cortex/memory/memory_provenance_service.js
```

Cada memoria/citacao pode carregar:

- `sourceId`;
- `sourceType`;
- documento/caminho;
- trecho;
- motivo de recuperacao;
- score;
- `confidenceScore`;
- `semanticSimilarity`;
- `matchedConcepts`;
- `matchedTerms`;
- `matchedPhrases`;
- `vectorModel`;
- `vectorDimensions`;
- `rankingSignals`;
- timestamp;
- escopo;
- validade;
- expiracao;
- motivo de bloqueio.

Os sinais de ranking agora incluem:

```text
semantic
lexical
phrase
recencyBoost
sourceBoost
promotionBoost
```

## Lifecycle de memoria

Foi criada uma camada especifica para gestao de memorias do Cortex:

```text
main/services/cortex_memory_management_service.js
```

Acoes suportadas:

- `list`;
- `edit`;
- `promote`;
- `expire`;
- `delete`;

O runtime de conhecimento passou a orquestrar tambem:

- `status`;
- `validate`;
- `sync`;
- `reindex`;
- `forget`;
- `list`;
- `edit`;
- `promote`;
- `expire`;
- `delete`.

Arquivo principal:

```text
cortex/memory/knowledge_runtime_service.js
```

Regras de lifecycle:

- `edit`: altera memoria local e solicita sincronizacao com MemPalace/RAG.
- `promote`: marca memoria como promovida, aumenta prioridade e solicita sincronizacao.
- `expire`: suprime memoria local e solicita remocao/tombstone nos backends.
- `delete`: remove memoria local e solicita remocao/tombstone nos backends.
- `reindex`: solicita reindexacao para backends disponiveis.
- `forget`: chama mecanismos de esquecimento externos quando configurados.

Memorias expiradas ou apagadas deixam de entrar na memoria ativa e no contexto Cortex selecionado.

## RAG privado/autenticado

O adapter RAG recebeu suporte para endpoints de lifecycle:

```text
R2R_CORTEX_INGEST_ENDPOINT
R2R_CORTEX_REINDEX_ENDPOINT
R2R_CORTEX_DELETE_ENDPOINT
```

Arquivo principal:

```text
cortex/memory/context_adapter.js
```

Foi criado smoke real com servidor HTTP local exigindo:

```text
Authorization: Bearer private-rag-token
```

Teste:

```text
tests/memory-private-rag-endpoint-smoke.test.js
```

O smoke cobre health/search, ingestao de memoria Cortex, reindexacao, delete/forget, propagacao do Bearer token em todas as chamadas e normalizacao de referencias recuperadas.

Dentro do sandbox, esse smoke falha por `listen EPERM` ao abrir `127.0.0.1`. Fora do sandbox, passou.

## MemPalace

O MemPalace recebeu suporte adicional para lifecycle de esquecimento/tombstone:

```text
forgetMempalaceMemory
```

Em vez de tentar apagar diretamente estruturas internas do MemPalace sem contrato estavel, o Faber registra um tombstone governado:

```text
CORTEX_MEMORY_FORGET:<memoryId>
```

Isso preserva auditabilidade e evita operacoes destrutivas opacas. O proximo passo pode ser integrar um endpoint/API nativa de delete quando o MemPalace oferecer contrato mais explicito.

## UX do Cortex

O modal Cortex agora mostra uma biblioteca operavel de memoria:

- status de memoria ativa/promovida/expirada;
- botao de atualizar;
- botao de reindexar;
- acao de editar;
- acao de promover;
- acao de expirar;
- acao de apagar.

Arquivos principais:

```text
renderer/index.html
renderer/cortex_controller.js
renderer/styles/cortex.css
```

O painel de Context Frame tambem mostra runtime, fonte dominante, fontes permitidas, fontes bloqueadas, memoria usada/suprimida, provenance, confianca media e media vetorial.

## Ledger de memoria

O ledger de memoria persiste evidencias por job/projeto:

```text
.faber/memory/<jobId>.jsonl
```

Servico:

```text
main/services/memory_evidence_ledger_service.js
```

Registra query, context frame, candidatos, fontes usadas, fontes bloqueadas, score/confidence, lifecycle, decisao final e mensagem de auditoria.

## Politica de ambiguidade

O Context Frame agora bloqueia execucao quando briefing atual, briefing da conversa e memoria ativa apontam para fontes conflitantes.

Resultado esperado:

```text
context_frame_source_ambiguity_requires_confirmation
```

Mensagem de produto:

```text
Preciso confirmar qual fonte devo usar: o briefing atual, o briefing desta conversa ou a memoria ativa. Nao vou misturar essas fontes automaticamente.
```

Arquivos principais:

```text
cortex/orchestration/orchestration_context_frame_service.js
cortex/orchestration/orchestration_context_frame_evidence_service.js
cortex/orchestration/product_policy_gate_service.js
```

## Testes e smokes

Novos testes:

```text
tests/memory-embedding-service.test.js
tests/memory-provenance-service.test.js
tests/memory-evidence-ledger-service.test.js
tests/cortex-memory-management-service.test.js
tests/memory-private-rag-endpoint-smoke.test.js
tests/memory-context-diagnostics-visual-smoke.test.js
tests/renderer-cortex-controller.test.js
```

Testes atualizados:

```text
tests/active-memory-service.test.js
tests/knowledge-runtime-service.test.js
tests/knowledge-runtime-handlers.test.js
tests/memory-adapter.test.js
tests/orchestration-context-frame-service.test.js
tests/preload-api-contract.test.js
tests/smoke-scenarios.test.js
tests/support/smoke_scenario_runner.js
```

Scripts adicionados/fortalecidos:

```text
npm run test:memory-embedding
npm run test:memory-provenance
npm run test:memory-ledger
npm run test:memory-management
npm run smoke:memory-private-rag
npm run smoke:memory-context-visual
npm run test:memory-rag-mempalace
npm run test:memory-embedding
```

## Atualizacao complementar apos `4f7e828`

A rodada seguinte criou o provider plugavel de embeddings neurais/remotos:

```text
cortex/memory/memory_embedding_provider_service.js
```

O active memory agora pode usar embeddings locais, OpenAI-compatible ou HTTP remoto configuravel, mantendo fallback local deterministico quando o provider externo nao estiver disponivel.

Tambem foram adicionados filtros e auditoria visual no Cortex, alem de uma captura mobile rolada para validar a area de auditoria sem sobreposicao.

Documento complementar:

```text
docs/FABER_CODE_FERRAMENTAS_100_AVANCOS_2026-05-28.md
```

## Validacoes executadas

Validacoes sintaticas:

```text
node --check cortex/memory/memory_embedding_service.js
node --check cortex/memory/memory_provenance_service.js
node --check main/services/cortex_memory_management_service.js
node --check cortex/memory/context_adapter.js
node --check cortex/memory/knowledge_runtime_service.js
node --check renderer/cortex_controller.js
node --check main/runtime/project_context.js
node --check cortex/orchestration/state_store.js
node --check cortex/memory/cortex_memory_sync_service.js
node --check main/runtime/runtime_config.js
node --check main.js
```

Validacoes principais:

```text
npm run test:memory-rag-mempalace
npm run smoke:memory-private-rag
npm run smoke:memory-context-visual
npm run smoke:mcp-settings-visual
npm run test:smoke-scenarios
npm run test:architecture
npm run audit:release
git diff --check
git diff --cached --check
```

Resultados:

- `test:memory-rag-mempalace`: passou.
- `smoke:memory-private-rag`: passou fora do sandbox.
- `smoke:memory-context-visual`: passou fora do sandbox.
- `smoke:mcp-settings-visual`: passou fora do sandbox.
- `test:smoke-scenarios`: passou com 38 cenarios.
- `test:architecture`: passou fora do sandbox.
- `audit:release`: passou, 385 arquivos checados.
- `git diff --check`: passou.
- `git diff --cached --check`: passou.

## Screenshots de validacao visual

Gerados pelo smoke visual:

```text
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-memory-context-diagnostics-desktop.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-memory-context-diagnostics-mobile.png
/var/folders/_x/c8d7kwjn5xq2kpw_hsj1q8mc0000gn/T/faber-memory-context-diagnostics-mobile-audit.png
```

Validacoes do smoke:

- screenshot desktop nao vazio;
- screenshot mobile nao vazio;
- sem overflow horizontal;
- sem sobreposicao entre cards;
- `contextCards = 3`;
- `memoryActions = 4`;
- `runtimeItems = 4`;
- `auditItems = 1`;
- `memoryFilters = 2`;
- botoes de memoria visiveis no mobile apos ajuste para viewport `500x1000`;
- auditoria validada tambem em captura mobile rolada.

## Limites restantes

Ainda faltam para elevar a memoria ao fechamento total em uso real:

1. Validar provider real de embeddings neurais/remotos com credencial do usuario em ambiente seguro.
2. UI ainda mais rica para buscar, filtrar e auditar historico completo de memorias por job/projeto.
3. Confirmacao visual mais refinada para apagamento/expiracao em lote.
4. Integracao nativa de delete no MemPalace, quando houver contrato estavel.
5. Testes com endpoints privados reais do usuario, sem expor credenciais.
6. Politicas por workspace/time para quem pode promover ou apagar memoria.
7. UI dedicada para navegar artifacts permanentes e historico `.faber/memory`.

## Estado final da frente

A area Memoria ativa/RAG/MemPalace saiu de uma camada principalmente defensiva para uma camada com ranking semantico, provenance forte, ledger, UX operacional, lifecycle, smokes privados/autenticados e validacao visual.

Ela esta significativamente mais perto do padrao "Codex = 100%"; o contrato de embedding remoto e a auditoria visual foram implementados, mas a validacao com credenciais reais e uso prolongado ainda separa a frente de um 100% absoluto.
