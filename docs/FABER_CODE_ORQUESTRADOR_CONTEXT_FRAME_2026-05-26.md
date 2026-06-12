# Faber Code - Orquestrador, Context Frame e Memoria Ativa 2026-05-26

Este documento registra os ajustes recentes feitos no Faber Code para reduzir contaminacao entre memoria ativa/RAG/MemPalace, historico de conversa e briefing atual do usuario.

## Objetivo da rodada

O foco desta etapa foi fortalecer o produto/orquestracao sem quebrar a arquitetura modular. A prioridade foi criar uma camada explicita de decisao de contexto antes do fluxo principal do orquestrador, para que o sistema consiga diferenciar:

- mensagem atual do usuario;
- briefing consolidado nesta conversa;
- memoria ativa do app;
- historico antigo que nao deve influenciar uma nova criacao;
- pedido explicito para usar memoria/RAG/MemPalace.

## Problema observado

Nos smoke tests anteriores, especialmente nos cenarios de criacao de site completo, o Faber Code ainda podia misturar sinais antigos com o pedido atual. Isso gerava tres classes de falha:

1. Um briefing novo podia ser contaminado por memoria de outro dominio.
2. A frase "seguindo o briefing completo que passei" podia depender de estado solto da conversa, sem fonte clara.
3. O sistema podia considerar uma memoria antiga como contexto valido mesmo quando o usuario tinha enviado um briefing autocontido e suficiente.

Na pratica, isso afetava diretamente produto/orquestracao: o sistema criava projetos, mas ainda sem garantia forte de que a decisao de rota estava partindo da fonte correta.

## Ajuste modular implementado

Foi criada uma camada dedicada em `cortex/orchestration/orchestration_context_frame_service.js`.

Essa camada gera um frame de contexto antes da decisao principal do produto. O frame descreve a fonte dominante do pedido e qual contexto pode ou nao influenciar a execucao.

### Responsabilidades do novo modulo

- Detectar briefing autocontido na mensagem atual.
- Detectar referencia a briefing desta conversa.
- Detectar pedido explicito por memoria ativa, Cortex, RAG ou MemPalace.
- Suprimir memoria ativa quando o briefing atual ja for suficiente.
- Suprimir memoria ativa quando o usuario pedir "briefing desta conversa".
- Permitir memoria ativa apenas quando ela for explicitamente solicitada.

## Integracao no orquestrador

O `product_orchestrator_service.js` passou a construir e aplicar esse frame antes de montar fatos, briefing de trabalho e decisao de rota.

Mudancas principais:

- `buildProductFacts` agora recebe memoria ativa ja filtrada pelo frame.
- `buildWorkingBrief` usa o texto de contexto selecionado pelo frame, nao uma combinacao implicita de memoria e historico.
- A rota de produto passa a ser calculada com maior separacao entre pedido atual, conversa e memoria.

## Observabilidade nos contratos e rotas

O `product_policy_gate_service.js` passou a anexar um resumo do context frame em `route.meta.contextFrame`.

Isso permite auditar, em smoke test ou diagnostico, qual fonte guiou a execucao:

- `current_message`
- `conversation_brief`
- `active_memory`
- `current_message_or_conversation`

Essa informacao e importante para diferenciar uma falha de composicao visual de uma falha de roteamento/contexto.

## Atualizacao: evidencia visivel e auditavel

A etapa seguinte transformou o resumo do `contextFrame` em evidencia de produto mais explicita:

- `orchestration_context_frame_evidence_service.js` centraliza a evidencia auditavel do frame.
- `route.meta.contextFrame` agora carrega `dominantSource`, `allowedSources`, `blockedSources` e `guard`.
- O job registra o frame em `checkpoints.route_context_frame`.
- O job tambem emite `job.context_frame` para a timeline tecnica.
- O painel de progresso do job exibe a fonte dominante e o status da memoria ativa.
- O policy gate bloqueia a rota quando detectar memoria ativa vazando para briefing autocontido ou briefing da conversa.

Fontes dominantes esperadas:

- `current_message`: briefing novo autocontido.
- `conversation_brief`: pedido para seguir o briefing desta conversa.
- `active_memory`: pedido explicito para usar memoria ativa/RAG/MemPalace.
- `current_message_or_conversation`: pedido ainda ambiguo ou sem fonte dominante unica.

O smoke `context_frame_audit_sources` cobre os tres fluxos principais: briefing autocontido sem memoria antiga, briefing desta conversa sem memoria antiga e uso explicito de memoria ativa.

## Matriz de comportamento esperada

| Entrada do usuario | Fonte dominante esperada | Memoria ativa pode influenciar? |
| --- | --- | --- |
| Briefing completo novo na mensagem atual | `current_message` | Nao |
| "Crie seguindo o briefing completo que passei nessa conversa" | `conversation_brief` | Nao |
| "Use a memoria ativa do projeto para continuar" | `active_memory` | Sim |
| Pedido vago sem dominio nem briefing | `current_message_or_conversation` | So se houver regra explicita posterior |

## Testes adicionados

Foi adicionado `tests/orchestration-context-frame-service.test.js` para cobrir os casos centrais:

- briefing autocontido suprime memoria antiga;
- referencia ao briefing da conversa usa historico da conversa e suprime memoria ativa;
- pedido explicito por memoria ativa permite memoria/RAG/MemPalace influenciar a execucao.

O `tests/product-orchestrator-service.test.js` tambem recebeu regressions para garantir que memoria antiga nao contamine pedidos novos de criacao de projeto.

## Scripts atualizados

O `package.json` recebeu:

```bash
npm run test:orchestration-context-frame
```

Esse teste tambem passou a integrar a bateria de arquitetura.

## O que melhorou

- O orquestrador agora tem uma fronteira mais clara entre memoria e briefing atual.
- Pedidos autocontidos ficaram mais protegidos contra contexto antigo.
- Pedidos do tipo "briefing desta conversa" ficaram mais previsiveis.
- O contrato de rota agora registra de onde veio a decisao de contexto.
- A arquitetura ganhou uma camada isolada e testavel, sem concentrar mais responsabilidade no orquestrador principal.

## O que ainda nao esta totalmente resolvido

1. A memoria ativa ainda precisa de escopo mais granular por usuario, projeto, conversa e job.
2. O RAG/MemPalace ainda precisa expor citacoes/fonte de memoria para explicar por que um contexto foi recuperado.
3. O painel do app ainda precisa exibir o diagnostico do context frame de forma clara para smoke manual.
4. A decisao de quando pedir confirmacao ao usuario ainda pode ser refinada para pedidos ambiguos.
5. A amplitude operacional do Automata/MCP ainda precisa evoluir para edicao real de arquivos e correcao autonoma com limites seguros.

## Percentuais apos esta rodada

Comparativo contra "Codex = 100%":

| Area | Antes desta rodada | Depois desta rodada | Motivo |
| --- | ---: | ---: | --- |
| UX/UI desktop | 84% | 84% | Sem mudanca direta de interface nesta etapa. |
| Arquitetura modular | 80% | 82% | Nova camada isolada para contexto do orquestrador. |
| Produto/orquestracao | 70% | 74% | Decisao de briefing/memoria ficou mais deterministica. |
| Patch seguro deterministico | 62% | 62% | Nao foi foco desta rodada. |
| Contratos | 74% | 76% | Rotas agora carregam meta de contexto auditavel. |
| Validacao visual | 75% | 75% | Gate visual real ja havia sido reforcado; sem nova mudanca aqui. |
| Memoria ativa/RAG/MemPalace | 42% | 49% | Separacao entre memoria, conversa e mensagem atual foi formalizada. |
| Produto total pronto | 69-71% | 72-74% | Avanco concentrado no nucleo de orquestracao. |

## Proxima etapa recomendada

A proxima etapa deve ser transformar esse context frame em evidencia visivel dentro do app e nos contratos de smoke test.

Checklist sugerido:

1. Exibir `contextFrame` no painel de diagnostico/contratos.
2. Registrar fonte dominante em cada job executado.
3. Criar smoke manual com tres pedidos seguidos: briefing novo, briefing desta conversa e uso explicito de memoria ativa.
4. Bloquear conclusao quando memoria ativa aparecer em rota de briefing autocontido.
5. Depois disso, retomar patch seguro deterministico com testes reais de edicao pequena.
