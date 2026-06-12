# Faber Code - Intake robusto e canonizacao de rota - 2026-05-29

Este documento registra a rodada de correcao do roteador apos os primeiros testes reais com a API da OpenAI no app desktop.

O objetivo desta rodada foi substituir a leitura fragil de frases soltas por um intake canonico antes da escolha de caminho. O usuario deve poder escrever como escreveria em uma conversa normal, incluindo pedidos incompletos, typos, continuacoes, briefings longos, anexos e referencias ao briefing da conversa.

## Diagnostico que motivou a rodada

Os testes manuais mostraram que a maturidade anterior estava superestimada para o fluxo real do app:

- o pedido "gera um site..." podia nao ser reconhecido como criacao;
- "quero criar em next.js" podia ser tratado como edicao ou clarificacao inutil;
- projetos com apenas metadados `.faber` eram tratados como projeto existente para editar;
- briefings longos com palavras como "encontrar informacoes" podiam cair em busca;
- pedidos de revisao visual com screenshots podiam virar rota de design-to-code;
- "crie uma nova secao" dentro de projeto existente gerava disputa entre criar projeto e editar projeto;
- o preloader inicial tinha barra visualmente travada;
- no caso Tremn, o fluxo podia contaminar o resultado com nomes de tentativas antigas, como SaaS, dashboard, pipeline, demo e servicos genericos.

## Novo modulo central

Foi criado:

```text
cortex/orchestration/product_intake_service.js
```

Responsabilidades do modulo:

- normalizar texto de entrada do usuario;
- corrigir variacoes comuns de escrita antes de rotear;
- calcular sinais canonicos de criacao, edicao, busca, diagnostico, ferramenta e revisao visual;
- expor `canonical.action` e `canonical.executionIntent`;
- separar estado do projeto entre `missing_project`, `empty_project`, `metadata_only_project` e `existing_project`;
- impedir que uma unica regex local decida o caminho inteiro.

Exemplos cobertos:

```text
"gera um site" -> create_project / init_project
"quero criar em next.js" -> create_project / init_project
"site institucional d emultiplas paginas" -> create_project / init_project
"me ajuda a montar uma home" -> create_project / init_project
"troque a cor do botao" em projeto com app -> edit_project
"validar screenshots" -> visual_review
```

## Integracoes feitas

### Product contract

Arquivo:

```text
cortex/orchestration/product_contract_service.js
```

Avancos:

- `defaultHasScaffoldIntent`, `defaultHasEditIntent`, `defaultHasSearchIntent` e `defaultHasVisualReviewIntent` passaram a consumir o intake.
- `buildProductFacts` passou a produzir `currentIntake` e `sourceIntake`.
- `executionIntent` agora usa o intake antes do fallback antigo.
- `signals.intake` registra action, executionIntent e score de criacao/edicao para auditoria.
- Busca foi endurecida para nao confundir briefing de criacao com search quando o usuario diz que "o visitante deve encontrar informacoes".
- Revisao visual com screenshots/prints foi reconhecida como diagnostico sem alteracao de arquivo.

### Working brief

Arquivo:

```text
cortex/orchestration/working_brief_service.js
```

Avancos:

- `buildWorkingBrief` agora constroi `productIntake`.
- `intent.intake` fica preservado dentro do working brief.
- Projeto existente com "nova pagina", "nova secao" ou "nova area" passa a priorizar `new_project_area`.
- Briefing autocontido segue bloqueando contaminacao de memoria ativa, historico antigo e exemplos anteriores.

### Product route score

Arquivo:

```text
cortex/orchestration/product_route_scoring_service.js
```

Avancos:

- `new_project_area` em projeto existente agora aceita `edit_project` sem pedir confirmacao artificial.
- A ambiguidade continua sendo usada quando ha conflito real, como criar nova base dentro de app existente sem sinal claro.

### Main process

Arquivo:

```text
main.js
```

Avancos:

- o helper local de scaffold passou a usar `buildProductIntake`;
- a responsabilidade de interpretar frases saiu do `main.js` e foi para modulo de orquestracao.

## Regras de seguranca preservadas

- Mensagem atual continua sendo a fonte mais forte.
- Memoria ativa nao pode completar briefing autocontido.
- Contexto antigo nao pode vazar quando o briefing atual nega explicitamente o dominio anterior.
- Projeto existente nao deve ser recriado sem intencao explicita.
- Projeto vazio ou apenas com metadados pode receber criacao inicial.
- Revisao visual nao deve gerar patch automaticamente.

## Testes adicionados ou fortalecidos

Novo:

```text
tests/product-intake-service.test.js
```

Atualizados:

```text
tests/product-orchestrator-service.test.js
tests/product-trace-contract.test.js
tests/working-brief-service.test.js
tests/project-blueprint-service.test.js
tests/window-chrome-css.test.js
```

Novo script:

```text
npm run test:product-intake
```

Incluido na suite:

```text
npm run test:product-orchestration
```

## Validacoes executadas

Passaram:

```text
npm run test:product-orchestration
npm run test:assistant-flow
npm run test:working-brief
npm run test:project-blueprint
npm run test:briefing-contract
npm run test:visual-briefing-semantic
npm run test:visual-product-coverage
npm run test:window-chrome-css
npm run test:renderer-startup-preloader
git diff --check
git diff --cached --check
```

## Recalibracao de maturidade

Esta rodada invalida o uso dos percentuais globais anteriores como prova de produto pronto.

Os percentuais de 96-98% da rodada A-I eram validos apenas para a matriz automatizada daquela rodada. Eles nao representavam o comportamento real completo do app com API OpenAI, estado de projeto vazio/metadados, anexos, confirmacoes e UI desktop.

Novo criterio adotado:

- uma frente so deve ser chamada de 100% quando passar em teste unitario, teste de contrato, smoke de produto e validacao visual ou funcional correspondente;
- resultados de matriz automatizada nao substituem smoke manual real;
- screenshots precisam ser analisados, nao apenas gerados;
- falhas reais do usuario viram regressions tests antes de nova estimativa.

## Limites restantes

- Ainda falta rodar novo teste manual completo no app desktop usando OpenAI API apos este commit.
- O intake robusto reduz fragilidade, mas nao elimina a necessidade de auditoria de rotas geradas pela IA.
- O fluxo de screenshots via Electron foi validado fora do sandbox; no app real ainda depende de permissao/ambiente local.
- O produto total nao deve voltar a ser descrito como 96-98% ate passar por novos testes reais com briefings do usuario.
