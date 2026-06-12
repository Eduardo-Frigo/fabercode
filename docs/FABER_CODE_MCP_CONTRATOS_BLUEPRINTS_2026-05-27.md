# Faber Code - MCP como Guardiao de Contratos de Blueprint 2026-05-27

Este documento registra a rodada em que o MCP/capability layer deixou de ser apenas executor estruturado local e passou a atuar tambem como guardiao auditavel de contratos de blueprint.

Nao registra deploy publico. A publicacao externa continua dependendo de pedido explicito.

Atualizacao posterior no mesmo ciclo: o commit `d4a2d91 Amplia diversidade e validacao das blueprints` expandiu a matriz MCP de briefings e conectou o guardiao `blueprint_contract` a uma rodada maior de diversidade visual.

## Estado confirmado

- Branch local: `main`
- Commit registrado: `ed2fd77 Fortalece MCP como guardiao de contratos`
- Commit anterior de contratos: `b68b10f Fortalece contratos de blueprint`
- Worktree apos o commit: limpo
- Data do ciclo: 2026-05-27
- Foco: MCP externo/capability layer, contratos de blueprint, evidencias visuais, promocao de contrato e reparo automatico controlado.

## Objetivo da rodada

O objetivo foi fechar a lacuna entre:

- MCP como camada local de capacidades operacionais;
- contratos de blueprint ja existentes no Cortex;
- ledger de evidencias `.faber/capabilities`;
- Automata Contract Ledger;
- validacao visual real por viewport;
- reparo automatico quando uma blueprint viola contrato responsivo.

A pergunta central era: quando o dominio pede algo real sem contrato, ou quando uma blueprint tenta completar lacunas com memoria antiga, o MCP pode gerar, validar, evidenciar e promover um contrato temporario seguro?

A resposta implementada foi: sim, como capability governada, sem substituir Cortex/Automata. O MCP executa a validacao, registra evidencias, sugere/promove contratos e pode reparar violacoes conhecidas; a decisao de dominio, contrato, policy gate e memoria continua no Cortex/Automata.

## Nova capability `blueprint_contract`

Foi criado o servico:

```text
main/services/blueprint_contract_capability_service.js
```

Schema:

```text
faber-blueprint-contract-capability-v1
```

A capability exposta pelo adapter e:

```text
blueprint_contract
```

Acoes suportadas:

- `validate`: valida blueprint, contrato modular, cobertura, rotas, politica de fonte, metricas DOM/visuais e artefatos.
- `repair`: tenta reparar automaticamente violacoes responsivas conhecidas.
- `suggest`: sugere contrato de blueprint ao Automata Contract Ledger.
- `stage`: move contrato sugerido para staged.
- `trial`: marca execucao de trial e resultado.
- `promote`: promove contrato aprovado para `local_active`.

## Validacoes feitas pelo MCP

### Contrato estrutural

O MCP usa `validateProjectBlueprintContract` para validar:

- arquivos obrigatorios;
- stack;
- `moduleContract`;
- `coverageContract`;
- contrato de navegacao responsiva;
- contrato temporario quando existir.

### Rotas

O MCP extrai evidencias de rotas a partir de arquivos:

```text
app/page.tsx
app/<rota>/page.tsx
```

O relatorio registra:

- `routes.count`;
- lista de rotas;
- arquivos lidos para evidencia.

No smoke visual real, o caso `temporary_music_school` confirmou 10 rotas geradas e validadas.

### Politica de fonte

O payload aceita `sourcePolicy` com:

- `requiredTerms`;
- `forbiddenTerms`;
- `allowedSources`;
- `forbiddenSources`.

Isso bloqueia contaminacao de memoria antiga quando termos proibidos aparecem no output ou quando termos essenciais do briefing atual nao aparecem.

Casos exercitados:

- juridico atual sem `Clinica Sorriso`;
- escola de musica experimental sem `Jardim Vivo` ou `plantas internas`;
- chocolate sem `Atelier Couro Faber` ou `bolsas de couro`;
- importacao sem placeholder antigo proibido.

### Evidencia runtime/visual

O MCP consome `visualEvidence.domMetrics` e bloqueia:

- overflow horizontal;
- memoria antiga detectada no DOM;
- mobile/tablet sem hamburger;
- mobile/tablet com nav desktop visivel;
- desktop sem nav desktop;
- desktop com hamburger visivel.

Regra aplicada:

- viewports abaixo de `1024px`: hamburger visivel e nav desktop escondida;
- viewports `>= 1024px`: nav desktop visivel e hamburger escondido.

## Reparo automatico controlado

A primeira correcao automatica implementada cobre uma classe objetiva de violacao:

- `md:hidden` vira `lg:hidden`;
- `md:flex` vira `lg:flex`;
- `md:inline-flex` vira `lg:inline-flex`;
- `md:max-w-none` vira `lg:max-w-none`;
- `md:pr-0` vira `lg:pr-0`.

Isso resolve o caso em que tablet estava recebendo navegacao desktop cedo demais. O reparo e limitado, auditado e revalidado antes de ser aceito.

O `repair` pode apenas retornar as operacoes corrigidas ou escrever no disco quando `payload.apply === true` ou `payload.write === true`.

## Ledger de evidencias

O ledger de capabilities foi ampliado para registrar `data` estruturado:

```text
.faber/capabilities/blueprint_contract.jsonl
```

Cada entrada inclui:

- capability;
- action;
- status;
- projeto/job;
- artefatos;
- erros e warnings;
- resumo de contrato;
- rotas;
- source policy;
- runtime validation;
- resultado de reparo;
- transicao no Automata Contract Ledger.

Para evitar vazamento e gigantismo, os dados sao sumarizados por profundidade e tamanho.

## Integracao com Automata Contract Ledger

Quando a validacao passa, `suggest` cria uma proposta com:

```text
kind: blueprint_contract_guardian
schemaVersion: faber-blueprint-contract-capability-v1
```

Fluxo exercitado:

1. `suggest_blueprint`
2. `staged`
3. `trial_running`
4. `trial_passed`
5. `local_active`

Esse fluxo transforma o MCP em guardiao/promotor auditavel, mas nao em instalador invisivel de comportamento executavel.

## Correcoes em blueprints encontradas pelo loop real

Durante o smoke visual real, a build Next capturou uma falha que testes sinteticos nao pegavam:

```text
Type 'unknown' is not assignable to type 'ReactNode'
```

A causa era o uso de campos opcionais de `copy` sem tipagem adequada em templates TSX gerados.

Correcoes aplicadas:

- `project_blueprint_next_templates.js`: campos opcionais passaram por `optionalCopy` tipado.
- `project_blueprint_next_page_renderers.js`: `methodSteps`, `faq` e `testimonials` opcionais receberam casts especificos.
- `project_blueprint_visual_next_renderers.js`: colecoes opcionais receberam tipos locais (`ContentItem`, `FaqItem`, `FormField`) antes de `.map`.

Resultado:

- as builds reais passaram para dominios default, temporario, chocolate e importacao;
- a correcao ficou no gerador, nao em arquivos temporarios de smoke.

## Matriz visual real executada

Foram gerados quatro briefings distintos:

| Caso | Objetivo | Risco validado |
| --- | --- | --- |
| `legal` | site juridico em Next/Tailwind | nao herdar clinica antiga |
| `temporary_music_school` | contrato temporario para escola de musica experimental | gerar contrato temporario e multiplas rotas |
| `chocolate` | landing sensorial de chocolate | nao herdar memoria de couro |
| `import_services` | landing de importacao | nao cair em placeholder antigo |

Viewports capturados por caso:

- desktop: `1365x768`;
- tablet: `820x1180`;
- mobile: `390x844`.

Total:

- 4 briefings;
- 4 builds reais;
- 12 screenshots reais;
- 12 checks de pixels nao vazios;
- 4 validacoes MCP;
- 4 promocoes ate `local_active`;
- 20 entradas de ledger `.faber/capabilities/blueprint_contract.jsonl` nos projetos temporarios.

Resultado da matriz:

| Caso | Gate | Runtime | Source policy | Rotas | Promocao |
| --- | --- | --- | --- | ---: | --- |
| `legal` | `allow` | `passed` | `passed` | 1 | `local_active` |
| `temporary_music_school` | `allow` | `passed` | `passed` | 10 | `local_active` |
| `chocolate` | `allow` | `passed` | `passed` | 1 | `local_active` |
| `import_services` | `allow` | `passed` | `passed` | 1 | `local_active` |

Checks visuais confirmados:

- hamburger visivel em tablet/mobile;
- nav desktop escondida em tablet/mobile;
- nav desktop visivel em desktop;
- hamburger escondido em desktop;
- zero overflow horizontal;
- zero imagens quebradas;
- termos obrigatorios presentes;
- termos proibidos ausentes;
- screenshots nao vazios por analise de pixels.

Os artefatos visuais ficaram em diretorio temporario local e nao foram versionados.

## Testes automatizados adicionados

### Unit/integration

Arquivo principal:

```text
tests/faber-capability-adapter-service.test.js
```

Cobre:

- listagem da nova capability;
- `blueprint_contract.validate` com visual evidence;
- bloqueio por runtime mobile invalido;
- bloqueio por source policy contaminada;
- `repair` de breakpoint responsivo;
- ciclo `suggest -> stage -> trial -> promote`;
- ledger `.faber/capabilities/blueprint_contract.jsonl`.

### Smokes

Novos cenarios:

```text
mcp_blueprint_contract_guardian
mcp_blueprint_contract_briefing_matrix
```

O primeiro valida a capability guardia e reparo.

O segundo valida matriz de briefings:

- juridico;
- contrato temporario de escola de musica;
- chocolate;
- importacao.

Atualizacao `d4a2d91`: a matriz passou a cobrir 9 casos:

- juridico;
- contrato temporario de escola de musica;
- chocolate;
- importacao;
- SaaS operacional;
- laboratorio fotografico;
- materiais de construcao;
- vinho premium;
- clinica odontologica.

Todos passaram com gate `allow`, source policy `passed` e runtime validation `passed`.

`package.json` passou a incluir esses smokes em:

```bash
npm run test:mcp-capabilities
```

## Comandos validados

Passaram nesta rodada:

```bash
npm run test:mcp-capabilities
npm run test:product-orchestration
npm run test:project-blueprint
npm run test:automata-contract-ledger
npm run test:memory-rag-mempalace
npm run test:deterministic-edit
npm run test:architecture
npm run audit:release
git diff --check
```

Tambem passaram `node --check` nos servicos/templates alterados.

Smokes visuais reais executados fora da suite automatica:

```text
legal desktop/tablet/mobile
temporary_music_school desktop/tablet/mobile
chocolate desktop/tablet/mobile
import_services desktop/tablet/mobile
```

Atualizacao visual posterior:

```text
vitrapure-product desktop/tablet/mobile/menu
atlasport-trade desktop/tablet/mobile/menu
lumen-photo-lab desktop/tablet/mobile/menu
constrular-store desktop/tablet/mobile/menu
aurora-wine desktop/tablet/mobile/menu
clinica-sorriso-dental desktop/tablet/mobile/menu
```

Essa rodada adicional validou 6 builds Next de producao, 24 screenshots, zero overflow horizontal e coverage score `100` nos casos selecionados.

## Arquivos principais alterados

Core MCP/ledger:

- `main/services/blueprint_contract_capability_service.js`
- `main/services/faber_capability_adapter_service.js`
- `main/services/capability_evidence_ledger_service.js`
- `main.js`

Blueprint/renderers:

- `cortex/orchestration/project_blueprint_next_templates.js`
- `cortex/orchestration/project_blueprint_next_page_renderers.js`
- `cortex/orchestration/project_blueprint_visual_next_renderers.js`

Testes:

- `tests/faber-capability-adapter-service.test.js`
- `tests/smoke-scenarios.test.js`
- `tests/support/smoke_scenario_runner.js`

Scripts:

- `package.json`

## O que ficou mais proximo de "Codex = 100%"

### Contratos

Avanco real:

- contratos agora podem ser validados pelo MCP contra blueprint, rotas, fonte e runtime;
- contrato temporario pode ser sugerido, testado e promovido com ledger;
- violacoes responsivas conhecidas podem ser reparadas e revalidadas.

Estimativa operacional revalidada com testes e smoke apos a matriz ampliada: `90-93%`.

### MCP/capability layer local

Avanco real:

- `structured_edit` ja existia como executor seguro;
- `blueprint_contract` adicionou a funcao de guardiao/promotor;
- ledger de evidencia passou a guardar dados estruturados.

Estimativa operacional revalidada com testes e smoke:

- `91-94%` para a capability layer local;
- `40-46%` para MCP externo real.

Observacao: MCP externo remoto, discovery multi-servidor e providers MCP de terceiros ainda sao outra frente.

### Validacao visual

Avanco real:

- matriz real com screenshots e DOM metrics;
- regra hamburger/tablet/mobile validada;
- pixel check nao vazio;
- imagens quebradas e overflow incluidos na evidencia.

Estimativa operacional revalidada com testes e smoke: `87-90%`.

### Produto/orquestracao

Avanco indireto:

- contrato temporario para dominio novo ficou integrado ao fluxo de produto;
- source policy reduziu contaminacao por memoria antiga;
- build real passou a capturar falhas que o contrato estatico nao via.

Estimativa operacional revalidada com testes e smoke: `85-88%`.

## Limites restantes

1. MCP externo real ainda nao esta completo. A camada local esta forte, mas servidores MCP externos, discovery amplo e governanca multi-provider ainda precisam frente propria.
2. O reparo automatico ainda cobre violacoes responsivas conhecidas. Outros reparos de blueprint devem ser adicionados por contrato, nao por improviso generativo.
3. A matriz visual real foi ampliada no commit `d4a2d91`, mas ainda nao substitui uma suite permanente de screenshots versionada ou artifact store por job.
4. A UI ainda precisa expor `.faber/capabilities` de forma confortavel para o usuario.
5. `main.js` ainda deve continuar sendo reduzido por extracoes modulares.
6. Julgamento estetico final ainda precisa de validacao humana ou modelo visual mais sofisticado.

## Proximas frentes recomendadas

1. Criar visao no app para evidencias `.faber/capabilities`, com filtros por capability, action, projeto e job.
2. Levar a matriz visual para uma suite automatizada com artifact store controlado.
3. Expandir `blueprint_contract.repair` para outros tipos de violacao objetiva: rotas ausentes, imagens quebradas, source policy incompleta e coverage baixo.
4. Trabalhar MCP externo real separado da capability local.
5. Continuar revisao das blueprints por familia visual, agora com contrato, build real e matriz de briefings como criterio.
6. Reduzir responsabilidade residual de `main.js`.

## Resumo executivo

Esta rodada transformou o MCP/capability layer em uma camada ativa de contrato:

- valida;
- bloqueia;
- repara quando a violacao e objetiva;
- registra evidencias;
- sugere contrato;
- roda trial;
- promove contrato aprovado.

O ganho mais importante e que contratos de blueprint deixaram de ser apenas verificacao interna de gerador e passaram a ter uma trilha auditavel de execucao, evidencia visual e promocao local.
