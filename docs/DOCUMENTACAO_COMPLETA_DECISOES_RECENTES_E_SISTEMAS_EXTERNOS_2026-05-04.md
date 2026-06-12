# Faber Code - Documentacao Completa de Decisoes Recentes e Sistemas Externos

> Nota de estado atual, 2026-05-31: este documento e historico. O RWKV ainda nao esta configurado como IA local pronta dentro do Faber Code publico. A direcao atual e criar um projeto RWKV separado, aberto, feito para conectar perfeitamente ao Faber Code quando estiver pronto.

Data de consolidacao: 2026-05-04  
Projeto: `localcode-studio` (Faber Code)  
Escopo: auditoria tecnica do codigo atual + inventario de sistemas externos (GitHub) agregados ao ecossistema do projeto.

## 1) Objetivo desta documentacao

Registrar em um unico artefato:
- quais decisoes arquiteturais recentes foram de fato aplicadas no codigo;
- onde a migracao Ollama -> RWKV esta concluida, parcial ou inconsistente;
- quais sistemas externos de GitHub foram agregados ao projeto;
- qual o status real de integracao de cada sistema (ativo, parcial, stub, referencia).

---

## 2) Metodologia de auditoria

Fontes principais auditadas:
- `main.js`
- `preload.js`
- `renderer/app.js`
- `cortex/rwkv/rwkv_provider.py`
- `cortex/automata/**`
- `.env` e `.env.example`
- backups tecnicos (`main.js.bak_*`, `renderer/app.js.bak_*`)
- pasta externa agregada: `../mempalace-develop`
- pasta externa agregada: `../Automata`

Critico de rastreabilidade:
- o diretorio `localcode-studio` atualmente **nao possui `.git`** local.
- por isso, a linha do tempo foi reconstruida por:
  - timestamps de arquivos;
  - estrutura de backups;
  - comparacao de implementacoes.

---

## 3) Linha do tempo tecnica recente (confirmada por codigo)

## 2026-05-01 - Ciclo Ollama dual + retries/contrato

Evidencias:
- `main.js.bak_progress_retry` (2026-05-01 17:39)
- `main.js.bak_contract_blueprint` (2026-05-01 18:53)
- `main.js.bak_retryflow_fix` (2026-05-01 22:46)

Estado observado nesse ciclo:
- `callOllamaChat(...)` chamava diretamente `fetch(${OLLAMA_BASE_URL}/api/chat)`.
- estrategia principal ainda era runtime Ollama.
- contrato de blueprint/retry estava em evolucao.

## 2026-05-02 - Introducao de variaveis RWKV e habilitacao de Automata

Evidencias:
- Exemplo de configuracao local observado em 2026-05-02 20:21:
  - `RWKV_ENABLED=true`
  - `RWKV_FALLBACK_TO_OLLAMA=false`
  - `AUTOMATA_ENABLED=true`
- modelos RWKV locais presentes em `models/rwkv/`.

## 2026-05-04 - Virada no caminho de inferencia do codigo principal

Evidencias em `main.js` (2026-05-04 08:38):
- `callOllamaChat(...)` agora roteia para `callRwkvProviderChat(...)`.
- se `RWKV_ENABLED=false`, a funcao aborta com erro:
  - "RWKV esta desativado e o fallback para Ollama foi removido."
- erros do provider sao auditados como `rwkv.provider_error`.

Conclusao:
- o backend principal migrou para provider RWKV.
- nomenclatura legada "Ollama" foi mantida em funcoes/variaveis por compatibilidade historica.

---

## 4) Estado arquitetural real (hoje)

## 4.1 Caminho de inferencia ativo

Fluxo atual:
1. Planejamento/extracao de acao chama `callOllamaChat(...)`.
2. `callOllamaChat(...)` delega para `callRwkvProviderChat(...)`.
3. `callRwkvProviderChat(...)` executa `cortex/rwkv/rwkv_provider.py` via Python.
4. Provider RWKV usa pacote Python `rwkv` e retorna JSON com `generated_text`.

Observacao:
- o nome da funcao `callOllamaChat` nao representa mais o backend real de inferencia.

## 4.2 Dependencia operacional de Python compartilhada com MemPalace

O provider RWKV usa `MEMPALACE_PYTHON_BIN` como interpretador Python.

Impacto:
- runtime de inferencia RWKV e runtime de memoria MemPalace compartilham a mesma base Python.
- isso simplifica setup local, mas acopla dois subsistemas criticos no mesmo ambiente.

## 4.3 Estado de runtime/status exibido pela aplicacao

`getAiRuntimeStatus()` ainda testa:
- `GET /api/version` em `OLLAMA_BASE_URL`
- `GET /api/tags` para disponibilidade de modelos Ollama

Impacto:
- o health-check visivel para o usuario continua Ollama-centric.
- existe desalinhamento entre:
  - mecanismo real de inferencia (RWKV provider),
  - telemetria/status exibido (Ollama).

## 4.4 Automata no codigo principal

Estado real:
- `AUTOMATA_ENABLED` pode ativar o caminho `runAutomataExecutionMap(...)`.
- `AutomataEngine` existe e retorna um lote deterministico de operacoes (stub funcional).
- adapters especificos (`KirimaseAdapter`, `HygenAdapter`, `PolyScaffoldAdapter`, `PhpGeneratorAdapter`, `NeuronAdapter`) estao **nao implementados** (throw).

Conclusao:
- Automata esta ligado no orquestrador, mas como v1 de stub.
- integracao com CLIs externos ainda nao foi conectada.

---

## 5) Inconsistencias e riscos encontrados no pente fino

## 5.1 Flag declarada e nao aplicada

`RWKV_FALLBACK_TO_OLLAMA` e declarada, mas nao participa do fluxo efetivo de fallback.

Risco:
- expectativa operacional divergente do comportamento real.

## 5.2 Codigo legado Ollama presente e nao utilizado no fluxo principal

`callOllamaChatLegacy(...)` existe, com retry/queue, mas nao e o caminho ativo de inferencia.

Risco:
- manutencao mais cara;
- confusao de leitura em incidentes.

## 5.3 Mensagens de UI ainda orientadas a Ollama

`renderer/app.js` comunica "Modo local-first com Ollama" mesmo com inferencia em RWKV.

Risco:
- diagnostico incorreto para usuario/operator.

## 5.4 Possivel misconfig de tokenizer RWKV em configuracao local

Exemplo de configuracao local observado:
- `RWKV_TOKENIZER_PATH=rwkv_vocab_v20230424`

No workspace:
- arquivo existente: `models/rwkv/tokenizer.json`
- caminho `rwkv_vocab_v20230424` nao existe como arquivo local.

Risco:
- falhas intermitentes/definitivas no provider dependendo da forma de resolucao do tokenizer.

## 5.5 Sem repositorio Git no diretorio principal

`localcode-studio` sem `.git` reduz rastreabilidade de mudancas recentes por commit.

Risco:
- auditoria de regressao e handoff tecnico mais fracos.

---

## 6) Inventario de sistemas externos (GitHub) agregados ao ecossistema

Legenda de status:
- `Ativo`: participa do fluxo runtime atual.
- `Parcial`: ligado no codigo, mas com lacunas.
- `Agregado`: copiado no workspace/ecossistema, sem acoplamento runtime completo.
- `Referencia`: citado/planejado, sem integracao operacional no app.

| Sistema | Repositorio GitHub | Localizacao no ecossistema | Como foi agregado | Status |
| --- | --- | --- | --- | --- |
| MemPalace | https://github.com/MemPalace/mempalace | `../mempalace-develop` + `.venv-mempalace` | Integracao direta no `main.js` (status/index/search/checkpoints) | Ativo |
| RWKV (Python package) | https://github.com/BlinkDL/ChatRWKV | `cortex/rwkv/rwkv_provider.py` + `models/rwkv/*` | Provider local de inferencia chamado pelo backend | Ativo |
| Ollama | https://github.com/ollama/ollama | URL runtime `http://127.0.0.1:11434` | Health-check e nomenclatura legada no backend/UI | Parcial (legado operacional) |
| Hygen | https://github.com/jondot/hygen | `../Automata/Next js/hygen-master` | Snapshot local + adapter interno nomeado | Agregado (adapter nao implementado) |
| Poly Scaffold | https://github.com/raphox/poly-scaffold | `../Automata/Next js/poly-scaffold-main` | Snapshot local + adapter interno nomeado | Agregado (adapter nao implementado) |
| Neuron AI | https://github.com/neuron-core/neuron-ai | `../Automata/LAMP/neuron-ai-3.x` | Snapshot local + adapter interno nomeado | Agregado (adapter nao implementado) |
| Nette PHP Generator | https://github.com/nette/php-generator | `../Automata/LAMP/php-generator-master` | Snapshot local + adapter interno nomeado | Agregado (adapter nao implementado) |
| Kirimase | https://github.com/nicoalbanese/kirimase | `../Automata/Next js/kirimase-master` | Snapshot local + adapter interno nomeado | Agregado (adapter nao implementado) |

Observacao sobre Kirimase:
- o `package.json` local nao traz explicitamente o campo `repository`.
- a origem GitHub acima foi confirmada por fonte externa de catalogacao do proprio projeto.

---

## 7) Decisoes recentes consolidadas (estado de produto)

1. O app backend passou a usar provider RWKV como caminho principal de inferencia.
2. O fallback para Ollama foi removido no fluxo principal de `callOllamaChat`.
3. O ecossistema MemPalace foi mantido como nucleo de memoria e checkpoint.
4. Automata foi acoplado ao orquestrador com engine stub, mas sem adapters executores.
5. A camada de status/UX ainda comunica Ollama como se fosse o provider principal.

---

## 8) Recomendacoes objetivas de fechamento tecnico

P0 (imediato):
1. Alinhar `RWKV_TOKENIZER_PATH` para um arquivo valido no workspace.
2. Corrigir `getAiRuntimeStatus()` e mensagens da UI para refletir provider RWKV.
3. Decidir e implementar (ou remover) `RWKV_FALLBACK_TO_OLLAMA`.

P1 (curto prazo):
1. Remover ou isolar `callOllamaChatLegacy` para reduzir ambiguidade.
2. Definir contrato minimo para 1 adapter Automata real (ex.: `HygenAdapter` ou `PolyScaffoldAdapter`).

P2 (governanca):
1. Restaurar rastreabilidade Git no diretorio `localcode-studio` (ou formalizar espelho versionado).
2. Manter este documento como fonte de verdade a cada nova virada arquitetural.

---

## 9) Fontes de validacao usadas nesta consolidacao

Codigo principal:
- `main.js`
- `preload.js`
- `renderer/app.js`
- `cortex/rwkv/rwkv_provider.py`
- `cortex/automata/**`

Configuracao e artefatos:
- `.env`
- `.env.example`
- `models/rwkv/*`

Historial tecnico local:
- `main.js.bak_progress_retry`
- `main.js.bak_contract_blueprint`
- `main.js.bak_retryflow_fix`
- `renderer/app.js.bak_retryflow_fix`

Sistemas externos agregados:
- `../mempalace-develop/**`
- `../Automata/**`
