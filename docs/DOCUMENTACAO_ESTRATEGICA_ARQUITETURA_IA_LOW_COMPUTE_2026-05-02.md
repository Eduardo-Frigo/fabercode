# Faber Code - Documentacao Estrategica de Arquitetura IA (Low Compute)

Data de consolidacao: 2026-05-02  
Projeto: `localcode-studio` (Faber Code)  
Objetivo deste documento: registrar de forma executiva e tecnica as escolhas de arquitetura feitas ate aqui, os motivos, os resultados observados, e a direcao para uma nova arquitetura com menor demanda computacional.

## 1) Resumo executivo

O projeto evoluiu de um app de edicao assistida para uma arquitetura de orquestracao com:
- IA2 (Brain) para entendimento e briefing;
- IA1 (Engine) para execucao tecnica;
- Cortex para runtime, checkpoints e validacao;
- MemPalace para memoria operacional.

O ganho estrutural foi real, mas o principal gargalo em hardware de entrada (8 GB RAM) permaneceu: pressao de memoria e instabilidade de inferencia em partes criticas do fluxo.

Por isso, a direcao tecnica mais recente passou a ser:
- reduzir dependencia de inferencia livre;
- aumentar execucao deterministica;
- usar IA para decisao curta;
- usar executores programaticos para producao de artefatos.

## 2) Linha do tempo de decisoes (consolidada)

## 2026-04-28 - Fundacao do produto
- App Electron com fluxo de confirmacao antes de editar.
- Foco inicial em seguranca e UX operacional.
- Etapa 1 concluida com base funcional.

## 2026-04-28 - Etapa 2 parcial e revisao de custo
- Tentativa de planner cloud + fallback local.
- Limitacao de quota/custo levou a decisao local-first.
- Direcao oficial: Ollama + privacidade + custo recorrente zero.

## 2026-04-28 a 2026-04-30 - Dual IA + Cortex
- Separacao de papeis:
  - IA2: conversa/planejamento.
  - IA1: execucao tecnica.
- Introducao de protocolo interno (A2), jobs, checkpoints e auditoria.
- Melhorias anti-loop e de rastreabilidade.

## 2026-05-02 - Cortex Render Runtime v1
- Mudanca de modelo mental: inferencia em passes sequenciais.
- WorkGraph e runtime budget como estrutura central.
- Validacao por contrato/blueprint antes de confirmar aplicacao.
- MemPalace reforcado como memoria operacional do runtime.

## 2026-05-02 - Bootstrap de estabilidade
- Ajustes de runtime para reduzir pressao de memoria.
- Ambiente MemPalace consolidado.
- Mantida prioridade em previsibilidade e saida terminal de job.

## 3) Arquitetura atual (estado real)

Fluxo atual principal:
1. Intake do pedido.
2. IA2 gera briefing compacto.
3. IA1 gera plano de operacoes.
4. Cortex valida cobertura do blueprint.
5. Se valido: aguarda confirmacao para aplicar.

Componentes ativos:
- Electron app shell (UI + IPC).
- Job State Machine persistente.
- Cortex runtime com checkpoints.
- MemPalace + contexto de projeto.
- Ollama para inferencias locais.

## 4) Problema estrutural identificado

Mesmo com arquitetura melhor:
- ainda existe dependencia relevante de inferencia para montagem de operacoes;
- em hardware limitado, ocorrem pausas por politica de memoria (`paused_memory_pressure`);
- variacao de saida em partes de scaffold aumenta retries e tempo total.

Conclusao tecnica:
- o gargalo deixou de ser "falta de arquitetura";
- passou a ser "quantidade de inferencia necessaria para executar".

## 5) Decisao estrategica nova: Automata

Foi definida a adicao do componente `Automata` como executor deterministico do Cortex.

Papel de cada camada:
- IA2 Brain: entende intencao e define briefing.
- IA1 Engine: seleciona estrategia de execucao (execution map).
- Automata: executa etapas pre-definidas com ferramentas e templates.
- Cortex: supervisiona budget, checkpoints, validacao e estado terminal.

Objetivo:
- reduzir custo computacional e instabilidade;
- manter qualidade por contrato e validadores;
- melhorar previsibilidade em maquinas de baixa RAM.

## 6) Escolhas tecnicas ja tomadas nesta execucao recente

## 6.1 Multiplataforma (nao assumir macOS)
- Base de projeto movida para um workspace local dedicado.
- Ajustes para evitar dependencias de path fixo anterior.
- Atualizacao de UX "Finder" para texto neutro de gerenciador de arquivos.
- Fallback de reveal de arquivo no backend para abrir pasta pai se necessario.
- Caminho de Python da venv MemPalace ajustado com logica cross-platform (`bin` vs `Scripts`).

## 6.2 Automata (bootstrap inicial)
- Estrutura modular criada em `cortex/automata/`:
  - `core/`, `adapters/`, `validators/`, `contracts/`.
- Integracao inicial com `main.js` por feature flag:
  - `AUTOMATA_ENABLED`.
- Fallback seguro:
  - se Automata falhar, fluxo atual IA1 continua.

## 6.3 Automata v1 funcional (stub deterministico)
- `AutomataEngine.runExecutionMap(...)` implementado em versao minima.
- Retorna lote de operacoes deterministicas no formato esperado pelo runtime.
- Smoke local validou retorno com `ok: true` e `operation_batch`.

## 7) Ferramentas candidatas para Automata (analise)

Conjunto analisado (pasta `Automata/`):
- Next.js:
  - `kirimase` (bootstrap e add de modulos),
  - `hygen` (templates deterministicas),
  - `poly-scaffold` (CRUD estruturado).
- LAMP:
  - `php-generator` (geracao programatica valida),
  - `neuron-ai` (orquestracao/agents em PHP, opcional v2).

Direcao recomendada:
- v1: kirimase/hygen/poly-scaffold/php-generator;
- v2: neuron-ai como camada adicional quando necessario.

## 8) Estado atual de configuracao de runtime

Observacoes recentes:
- tentativa de migrar para 3B foi barrada por indisponibilidade local do modelo;
- modelos presentes no host:
  - `qwen2.5-coder:7b`
  - `qwen2.5-coder:14b`
- ajuste de thresholds de memoria foi aplicado para reduzir pausas agressivas.

## 9) Principios para nova arquitetura IA low-compute

1. IA para decisao curta, nao para producao completa.
2. Execucao por templates/geradores deterministas.
3. Checkpoint por pass com retomada real.
4. Validacao objetiva por contrato antes de aplicar.
5. Fallback progressivo (nunca bloquear o job indefinidamente).
6. Plataforma neutra (macOS, Linux, Windows).

## 10) Riscos e mitigacoes

Risco 1: Automata ainda inicial (v1 stub).  
Mitigacao: evoluir adapters reais por ferramenta, um por vez.

Risco 2: Dependencias interativas de CLI.  
Mitigacao: padrao non-interactive obrigatorio + args completos.

Risco 3: drift entre blueprint e artefato.  
Mitigacao: validators de cobertura e artifact checks antes de confirmacao.

Risco 4: regressao cross-platform.  
Mitigacao: centralizar utilitarios de path/processo por OS.

## 11) Proposta de proximo ciclo (objetivo)

P0 - Estabilidade de execucao:
- conectar Automata em 1 caminho real de scaffold (nextjs calculator).
- manter fallback para IA1 apenas como contingencia.

P1 - Determinismo crescente:
- implementar adapters reais:
  - `HygenAdapter`
  - `PolyScaffoldAdapter`
- adicionar `PassRunner` com checkpoints por etapa.

P2 - LAMP deterministico:
- integrar `PhpGeneratorAdapter` para classes e modulos basicos.

P3 - Maturidade operacional:
- metrica por pass (tempo, memoria, retries, cobertura).
- criterio de sucesso por job (`done` ou `failed` com motivo acionavel).

## 12) Conclusao

As escolhas feitas ate aqui foram coerentes: primeiro estruturar, depois estabilizar.  
Agora o caminho para reduzir processamento esta claro:
- menos inferencia livre,
- mais execucao deterministica via Automata,
- mais previsibilidade por checkpoints e validacao.

Esse direcionamento e o melhor candidato para entregar qualidade em hardware limitado sem sacrificar controle de fluxo.
