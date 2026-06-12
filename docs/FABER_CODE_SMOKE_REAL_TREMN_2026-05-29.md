# Faber Code - Smoke real Tremn e validacao visual - 2026-05-29

Este documento registra o smoke real feito com o briefing Tremn - Escola de Gestao Consciente, usado como primeiro teste real de site institucional multipagina no Faber Code.

## Objetivo do smoke

Validar se o Faber Code consegue:

- interpretar um briefing longo e humano;
- suprimir memoria ativa e contexto antigo conflitante;
- nao reutilizar nomes de tentativas anteriores;
- criar um site institucional multipagina;
- respeitar paleta e tipografia especificadas;
- gerar arquivos reais;
- validar desktop, tablet, mobile e menu mobile com screenshot;
- corrigir o que falhar e repetir o smoke.

## Briefing validado

Dominio do briefing:

```text
Tremn - Escola de Gestao Consciente
```

Stack esperada:

```text
static-web
```

Paginas obrigatorias:

```text
/
/a-escola
/premissas
/jornada
/conteudos
/contato
```

Cores e tipografias:

```text
Pantone P 14-16 C
Pantone P 10-7 C
Pantone P 20-2 C
Pantone P 179-16 C
Pantone P 1-1 C
Assistant para titulos
Inter para textos
```

Termos proibidos por contaminacao de tentativas antigas:

```text
SaaS operacional
Dashboard executivo
Pipeline de trabalho
Automacao de rotinas
Agendar demo
Controle processos
Foto de cottonbro
Servicos
Depoimentos
```

## Artefatos gerados

Diretorio temporario do smoke:

```text
/private/tmp/faber-tremn-intake-smoke
```

Arquivos gerados:

```text
index.html
a-escola.html
premissas.html
jornada.html
conteudos.html
contato.html
style.css
script.js
smoke-report.json
```

Relatorio visual:

```text
/private/tmp/faber-tremn-intake-smoke-visual-report.json
```

Screenshots:

```text
/private/tmp/faber-tremn-intake-smoke-desktop.png
/private/tmp/faber-tremn-intake-smoke-tablet.png
/private/tmp/faber-tremn-intake-smoke-mobile.png
/private/tmp/faber-tremn-intake-smoke-mobile-menu.png
```

## Resultado da primeira captura

A primeira captura detectou falha real:

```text
mobile menu did not open
```

Causa:

- o JS adicionava `is-open` ao nav;
- o smoke visual checava estado global pelo `body.menu-open`;
- o template nao sincronizava esse estado no body;
- isso tambem enfraquecia a auditoria visual do menu.

Correcao feita:

```text
cortex/orchestration/project_blueprint_static_templates.js
```

Agora o menu:

- alterna `nav.is-open`;
- alterna `body.menu-open`;
- remove ambos ao clicar em links;
- preserva `aria-expanded`.

## Segunda captura

A segunda captura passou tecnicamente:

- desktop: screenshot nao branco;
- tablet: screenshot nao branco;
- mobile: screenshot nao branco;
- mobile menu: abriu;
- sem overflow horizontal;
- CTA principal acima da dobra;
- conteudo Tremn presente;
- contexto antigo nao vazou.

## Refinamento visual adicional

Mesmo depois de passar tecnicamente, a imagem do hero parecia um bloco dourado vazio. Foi feito refinamento visual no blueprint estatico:

```text
cortex/orchestration/project_blueprint_static_templates.js
```

Melhorias:

- textura com diagonais sutis;
- arcos e linhas sensorias;
- gradiente menos chapado;
- painel com aparencia intencional de textura, nao placeholder;
- composicao preservada em desktop, tablet e mobile.

## Terceira captura

A captura final passou:

```text
desktop: ok
tablet: ok
mobile: ok
mobile-menu: ok
```

Metricas principais registradas:

```text
desktop 1365x768: overflow horizontal false, CTA top 648, screenshot nao branco
tablet 820x1180: overflow horizontal false, CTA top 438, screenshot nao branco
mobile 390x900: overflow horizontal false, CTA top 449, screenshot nao branco
mobile-menu 390x900: menu aberto true, background rgb(45, 42, 41)
```

Busca por vazamento de termos antigos:

```text
rg "Dashboard executivo|Pipeline de trabalho|Automacao de rotinas|Agendar demo|Controle processos|SaaS operacional|Foto de cottonbro|Servicos|Depoimentos" /private/tmp/faber-tremn-intake-smoke
```

Resultado:

```text
sem ocorrencias
```

## Validacoes relacionadas

Passaram depois do refinamento:

```text
npm run test:project-blueprint
npm run test:product-orchestration
npm run test:window-chrome-css
git diff --check
git diff --cached --check
```

## Observacao de ambiente

As capturas com Electron headless foram executadas fora do sandbox porque dependem de runtime GUI/headless local.

## Conclusao do smoke

O caso Tremn deixou de reproduzir a falha ruim do teste manual original.

O resultado atual:

- cria arquivos reais;
- gera multipaginas;
- respeita o dominio institucional;
- nao cai em SaaS antigo;
- nao usa nomes de tentativas antigas como contrato ou conteudo;
- abre menu mobile em tela cheia;
- passa em desktop, tablet e mobile;
- ainda precisa ser revalidado pelo usuario dentro do app com OpenAI API para fechar a frente de fluxo real.
