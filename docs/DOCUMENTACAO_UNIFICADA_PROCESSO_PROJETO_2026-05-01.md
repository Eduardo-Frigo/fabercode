# Faber Code - Documentação Unificada do Processo do Projeto

Data de consolidação: 2026-05-01  
Projeto: `localcode-studio` (Faber Code)  
Status atual: Em evolução operacional (protótipo avançado com execução real + estabilização em andamento)

## 1) Objetivo deste documento

Este arquivo consolida, em uma única visão, toda a documentação de processo do projeto:
- histórico de decisões;
- evolução técnica por etapas;
- arquitetura definida;
- problemas encontrados e correções aplicadas;
- estado atual real;
- próximos passos priorizados.

## 2) Resumo executivo

O Faber Code evoluiu de um app de interface local com confirmação de edição para uma plataforma local-first com:
- orquestração Dual IA (`IA2 Brain` + `IA1 Engine`),
- persistência de jobs e checkpoints,
- integração inicial de memória (`Cortex` + `MemPalace`),
- mecanismos de fallback e anti-loop,
- melhorias de UX para transparência operacional.

Já existe geração/aplicação de arquivos reais e sinais de robustez funcional.  
Ainda há limitações de estabilidade no planejamento IA2 e de qualidade de scaffold para casos mais complexos (ex.: site institucional LAMP/Next.js).

## 3) Linha do tempo consolidada

## 2026-04-28 - Fundação do app (Etapa 1)

Entregas principais:
- App Electron com 3 painéis (projetos, conversa/contexto, próximos passos).
- Fluxo seguro com confirmação obrigatória antes de edição.
- Gestão de projetos (adicionar/listar/remover) e varredura de stack local.
- Estrutura base local-first para evolução posterior.

Documentos de referência:
- `ETAPA_1_PROGRESSO.md`
- `DOCUMENTACAO_COMPLETA_ETAPA_1.md`

## 2026-04-28 - Direção local-first + MemPalace

Decisões principais:
- Prioridade para IA local com Ollama (custo recorrente zero e privacidade local).
- Início da integração MemPalace com fallback seguro.
- Definição da necessidade de arquitetura em dois agentes (papéis separados).

Documentos de referência:
- `ETAPA_2_PROGRESSO_E_CUSTOS_IA.md`
- `PLANO_INTEGRACAO_MEMPALACE_IA1_IA2.md`
- `ENCERRAMENTO_CONTEXTO_MEMPALACE_2026-04-28.md`

## 2026-04-29 a 2026-04-30 - Dual IA, Cortex e hardening

Evoluções implementadas:
- Separação explícita de papéis:
  - `IA2 Brain`: conversa/plano.
  - `IA1 Engine`: execução técnica.
- Protocolo interno de execução e validações de segurança.
- Persistência de orquestração e histórico.
- Melhoria de carregamento `.env` e ajustes de fallback de modelos.
- Criação de `jobs.json` com Job State Machine.
- Primeiros mecanismos de humanização IA2 e quebra de repetição.

Documentos de referência:
- `ENCERRAMENTO_CONTEXTO_DUAL_IA_CORTEX_2026-04-30.md`
- `ENCERRAMENTO_CONTEXTO_DEBUG_DUAL_IA_2026-04-30.md`
- `PROTOCOLO_HUMANIZACAO_IA2.md`

## 2026-04-30 (fim do ciclo) - Robustez operacional

Evoluções adicionais:
- Indicador de progresso de job na UI.
- Indicador visual "IA2 pensando" no chat.
- Tipografia da interface migrada para Manrope.
- Bloco anti-loop com orçamento cognitivo e rota obrigatória.
- Rota `brain_unavailable_engine_route` confirmada em logs.
- Geração de artefatos práticos (calculadora funcional, scaffold LAMP básico).

Documentos de referência:
- `ENCERRAMENTO_CONTEXTO_FINAL_2026-04-30.md`
- `ENCERRAMENTO_CONTEXTO_OPERACIONAL_2026-04-30.md`

## 4) Arquitetura consolidada

Arquitetura atual: **local-first, orientada a orquestração e máquina de estados**.

Componentes:
1. App Shell (Electron): UI, UX, IPC.
2. Orquestrador backend: coordena IA2 -> IA1, regras de segurança e fallback.
3. IA2 (Brain): entendimento, clarificação, planejamento.
4. IA1 (Engine): execução técnica e geração de operações de arquivo.
5. Job State Machine persistente: fases/eventos/checkpoints em disco.
6. Camada de conhecimento: Cortex + MemPalace.
7. Runtime local de inferência: Ollama (desacoplado do processo de UI).

Princípios arquiteturais:
- Segurança antes da alteração (confirmação explícita).
- Fallback controlado em falhas de inferência.
- Rastreabilidade por job/evento/checkpoint.
- Evolução incremental com compatibilidade para hardware limitado.

## 5) Estado funcional por pilar

1. UX base do app: **funcional**.
2. Scanner e contexto de projeto: **funcional**.
3. IA1 execução de arquivos: **funcional (com variação de qualidade)**.
4. IA2 planejamento conversacional: **parcial (instabilidade em cenários específicos)**.
5. Job State Machine: **funcional**.
6. Cortex/MemPalace: **v0 operacional, ainda inicial para ganho semântico profundo**.
7. Time-as-Compute: **v1 implementada, ainda sem scheduler completo de produção**.

## 6) Problemas observados e diagnóstico

## 6.1 Loop de planejamento IA2

Sintoma:
- múltiplos jobs em `brain_plan` com `retry_pending` e erros (`HTTP 500`, aborts).

Diagnóstico:
- instabilidade do runtime/planner IA2 + ausência histórica de saída terminal obrigatória.

Ações aplicadas:
- orçamento cognitivo e rota anti-loop com handoff para IA1/template.

## 6.2 Qualidade de scaffold insuficiente em alguns pedidos

Exemplo real:
- pedido de site institucional LAMP resultou em página muito simples (conteúdo mínimo).

Diagnóstico:
- pipeline executa, mas biblioteca de templates/conhecimento ainda pobre para casos de marketing/institucional.

Ação necessária:
- curadoria de templates e playbooks por tipo de aplicação.

## 6.3 Performance em hardware de entrada

Sintoma:
- latência alta e sensação de travamento.

Ações já aplicadas:
- indicadores de progresso e "IA2 pensando".

Ação pendente:
- scheduler real (fila, limites por fase, backoff, serialização de jobs em máquinas de baixa RAM).

## 7) Decisões técnicas e de produto (congeladas neste ciclo)

1. Manter estratégia local-first.
2. Manter runtime com Ollama no curto prazo.
3. Priorizar robustez de orquestração antes de migrar para runtime proprietário embutido.
4. Separação de papéis IA2/IA1 é permanente.
5. Cortex como hub de conhecimento do ateliê (visão de produto).
6. Time-as-Compute como mecanismo de estabilidade e não apenas performance.

## 8) Progresso comprovado (evidências)

- Jobs com `completed` e arquivos modificados registrados.
- Rota anti-loop (`brain_unavailable_engine_route`) registrada em logs.
- Calculadora web gerada e funcional (operações básicas).
- Scaffold LAMP aplicado com sucesso técnico (ainda simples visualmente).

## 9) Próximos passos priorizados

## P0 - Estabilidade e controle

1. Finalizar política de orçamento por fase:
- teto de tentativas,
- teto de tempo,
- saída terminal obrigatória.
2. Evitar jobs eternos em `retry_pending`.
3. Serializar execução em hardware de baixa capacidade (fila de 1 job ativo).

## P1 - Qualidade de entrega

1. Criar biblioteca de scaffolds curados:
- `institutional_lamp_basic`
- `institutional_next_basic`
- `calculator_web_standard`
- `calculator_lamp_standard`
2. Melhorar geração de conteúdo inicial (hero, seções, CTA, rodapé) para institucional.

## P2 - Conhecimento e ensino contínuo

1. Alimentar Cortex com playbooks de LAMP e Next.js.
2. Curadoria por tipo de projeto e contexto de negócio.
3. Reforçar handoff semântico IA2 -> IA1 com contratos mais rígidos.

## P3 - UX operacional

1. Exibir no chat trilha de decisão: tentativa, fallback, rota, execução.
2. Mostrar orçamento consumido da IA2 por job.
3. Melhorar percepção de progresso sem sobrecarga visual.

## 10) Critério de sucesso para o próximo ciclo

O próximo ciclo será considerado bem-sucedido quando:
- pedidos de scaffold institucional resultarem em páginas úteis (não vazias);
- loops de IA2 forem bloqueados de forma consistente;
- cada job finalizar em estado terminal útil (`done` ou `failed` com próximo passo);
- comportamento em máquina de 8GB ficar previsível e sem travas prolongadas.

## 11) Arquivos de origem usados nesta consolidação

- `DIRETRIZ_LINGUAGEM_MANUS.md`
- `DOCUMENTACAO_COMPLETA_ETAPA_1.md`
- `ETAPA_1_PROGRESSO.md`
- `ETAPA_2_PROGRESSO_E_CUSTOS_IA.md`
- `PLANO_INTEGRACAO_MEMPALACE_IA1_IA2.md`
- `PROTOCOLO_HUMANIZACAO_IA2.md`
- `ENCERRAMENTO_CONTEXTO_MEMPALACE_2026-04-28.md`
- `ENCERRAMENTO_CONTEXTO_DUAL_IA_CORTEX_2026-04-30.md`
- `ENCERRAMENTO_CONTEXTO_DEBUG_DUAL_IA_2026-04-30.md`
- `ENCERRAMENTO_CONTEXTO_FINAL_2026-04-30.md`
- `ENCERRAMENTO_CONTEXTO_OPERACIONAL_2026-04-30.md`
- `documentacao_faber_code_01.md`

---

Documento unificado gerado para servir como referência oficial de contexto e retomada.
