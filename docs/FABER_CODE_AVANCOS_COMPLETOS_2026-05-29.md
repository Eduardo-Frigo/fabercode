# Faber Code - Avancos completos ate 2026-05-29

Este documento consolida a rodada posterior ao commit `e055998 Fortalece ferramentas e smoke matrix`.

Nao houve deploy publico. O foco foi corrigir uma divergencia importante entre os smokes automatizados anteriores e o primeiro teste real feito no app com API OpenAI.

## Contexto

O usuario testou um briefing real para a Tremn - Escola de Gestao Consciente e o resultado foi ruim:

- conteudo de SaaS apareceu em site institucional;
- nomes de tentativas antigas vazaram;
- a rota ficou presa em validacoes;
- projetos sem arquivos de aplicacao nao evoluiam;
- o app pedia clarificacoes desnecessarias;
- o preloader inicial parecia travado;
- os percentuais anteriores pareciam incompativeis com a experiencia real.

Esta rodada tratou esses pontos como regressao real, nao como excecao.

## Avancos principais

### Intake canonico antes da rota

Novo modulo:

```text
cortex/orchestration/product_intake_service.js
```

Ele centraliza:

- normalizacao de linguagem natural;
- deteccao de typos e variacoes comuns;
- classificacao canonica de criacao, edicao, busca, diagnostico, ferramenta e revisao visual;
- separacao entre projeto vazio, projeto com metadados e projeto com app;
- scores de criacao/edicao para auditoria.

Esse intake passou a alimentar:

```text
cortex/orchestration/product_contract_service.js
cortex/orchestration/working_brief_service.js
cortex/orchestration/product_route_scoring_service.js
main.js
```

### Roteamento menos fragil

Casos corrigidos:

- `gera um site` agora e intencao de criacao;
- `quero criar em next.js` agora e intencao de criacao inicial;
- `site institucional d emultiplas paginas` e normalizado;
- longos briefings com "encontrar informacoes" nao viram busca local;
- screenshots/prints com pedido de avaliacao viram revisao visual;
- `nova secao` em projeto existente vira `new_project_area`;
- projeto apenas com `.faber`/metadados pode receber criacao inicial.

### Protecao contra contaminacao de tentativas antigas

Foram reforcados:

- scoring de contrato de briefing;
- especificacao de briefing;
- working brief;
- contrato temporario de blueprint;
- validacao de cobertura;
- testes contra uso indevido de nomes de tentativas antigas.

O caso Tremn agora valida que termos antigos como estes nao vazam:

```text
Dashboard executivo
Pipeline de trabalho
Automacao de rotinas
Agendar demo
SaaS operacional
Controle processos
Foto de cottonbro
```

### Site Tremn como regressao real

O blueprint estatico passou a gerar:

```text
index.html
a-escola.html
premissas.html
jornada.html
conteudos.html
contato.html
style.css
script.js
```

Com:

- hero Tremn;
- paginas internas;
- header e footer;
- menu mobile em tela cheia;
- formulario de contato;
- paleta e tipografias do briefing;
- textura sensorial no hero;
- bloqueio de overflow horizontal.

### Preloader inicial

Arquivo:

```text
renderer/styles/preloader-critical.css
```

Avanco:

- a barra do preloader inicial recebeu animacao CSS real;
- `tests/window-chrome-css.test.js` valida `animation` e `@keyframes`.

## Arquivos principais alterados

Novos:

```text
cortex/orchestration/product_intake_service.js
tests/product-intake-service.test.js
docs/FABER_CODE_INTAKE_ROBUSTO_AVANCOS_2026-05-29.md
docs/FABER_CODE_SMOKE_REAL_TREMN_2026-05-29.md
docs/FABER_CODE_AVANCOS_COMPLETOS_2026-05-29.md
```

Fortalecidos:

```text
cortex/orchestration/briefing_contract_scoring_service.js
cortex/orchestration/briefing_contract_service.js
cortex/orchestration/briefing_spec_service.js
cortex/orchestration/product_contract_service.js
cortex/orchestration/product_route_scoring_service.js
cortex/orchestration/project_blueprint_contract_validation_service.js
cortex/orchestration/project_blueprint_layout.js
cortex/orchestration/project_blueprint_next_templates.js
cortex/orchestration/project_blueprint_static_templates.js
cortex/orchestration/temporary_blueprint_contract_service.js
cortex/orchestration/working_brief_service.js
main.js
package.json
renderer/styles/preloader-critical.css
tests/briefing-contract-service.test.js
tests/product-orchestrator-service.test.js
tests/project-blueprint-service.test.js
tests/window-chrome-css.test.js
tests/working-brief-service.test.js
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

Smokes visuais com screenshot:

```text
/private/tmp/faber-tremn-intake-smoke-desktop.png
/private/tmp/faber-tremn-intake-smoke-tablet.png
/private/tmp/faber-tremn-intake-smoke-mobile.png
/private/tmp/faber-tremn-intake-smoke-mobile-menu.png
```

Relatorios:

```text
/private/tmp/faber-tremn-intake-smoke/smoke-report.json
/private/tmp/faber-tremn-intake-smoke-visual-report.json
```

## Resultado da validacao visual Tremn

Passou apos loop completo:

1. Geracao de arquivos reais.
2. Validacao tecnica do blueprint.
3. Smoke visual inicial.
4. Falha detectada no menu mobile.
5. Correcao do menu.
6. Smoke visual novamente.
7. Refinamento visual do painel/textura do hero.
8. Smoke visual final desktop/tablet/mobile/menu.
9. Busca por vazamento de nomes antigos.

Estado final:

```text
desktop: ok
tablet: ok
mobile: ok
mobile-menu: ok
overflow horizontal: false
menu mobile aberto: true
termos antigos: sem ocorrencias
```

## Recalibracao honesta dos percentuais

Os percentuais anteriores nao devem ser repetidos como estado global do produto.

Leitura correta:

- a matriz A-I validou muito bem o caminho automatizado;
- o primeiro teste real via app/API mostrou lacunas de intake, rota, estado de projeto e validacao visual;
- esta rodada corrige esses pontos e adiciona regressions tests;
- o produto total ainda precisa de nova rodada manual real antes de qualquer novo percentual alto.

Estimativa honesta apos esta rodada:

| Frente | Estado apos esta rodada |
| --- | --- |
| Intake/roteamento de criacao inicial | Forte nos casos testados |
| Projeto vazio/metadados | Corrigido e coberto por teste |
| Briefing longo institucional | Corrigido no caso Tremn |
| Protecao contra contexto antigo | Reforcada e coberta |
| Preloader | Corrigido |
| Validacao visual Tremn | Passou com screenshots |
| Produto total | Nao recalculado ate novo teste real no app |

## Proximos limites reais

1. Repetir o teste Tremn dentro do app desktop usando OpenAI API.
2. Testar pedidos simples e mal escritos no app real, nao apenas em unit/smoke.
3. Confirmar se o painel de arquivos atualiza corretamente apos criacao.
4. Validar se a confirmacao/aplicacao de patches nao bloqueia indevidamente projeto novo.
5. Preservar screenshots e relatorios em `.faber/artifacts` quando o fluxo real do app executar o smoke.
6. Evitar qualquer novo percentual global sem evidencia manual real.

## Decisao arquitetural desta rodada

O roteador nao deve tentar "extrair um caminho claro" do usuario diretamente.

O fluxo correto passa a ser:

```text
mensagem humana -> intake canonico -> working brief -> route score -> policy gate -> executor
```

Isso mantem o Faber Code mais proximo de um intake robusto e menos dependente de regex fragil espalhado pelo produto.
