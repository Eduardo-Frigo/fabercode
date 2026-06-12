# Faber Code V1 - Primeiro site e primeira alteracao real - 2026-05-29

Este documento registra o marco operacional V1 do Faber Code.

Importante: V1 aqui nao significa release publico, pacote distribuido ou deploy. Significa que o produto local completou, em fluxo real do app desktop com API OpenAI, dois marcos que antes ainda estavam parcialmente aspiracionais:

1. criou seu primeiro site real multipagina a partir de um briefing humano;
2. realizou sua primeira alteracao incremental real sobre esse site, com provider de midia externo, confirmacao no app, execucao local e validacao visual.

Nao houve deploy publico.

## Contexto do marco

O usuario testou a criacao de um site institucional multipagina para:

```text
Tremn - Escola de Gestao Consciente
```

O briefing exigia:

- site institucional multipagina;
- HTML, CSS e JavaScript simples;
- paginas reais: Inicio, A Escola, Premissas, Jornada, Conteudos e Contato;
- paleta quente/off-white da marca;
- tipografias Assistant e Inter;
- menu mobile em tela cheia;
- footer, formulario e conteudo institucional;
- bloqueio de contaminacao por projetos antigos.

Depois da geracao, o usuario testou alteracoes reais no hero:

```text
video de abelhas voando no hero do topo do body
full width
preto e branco
overlay branco leve
sem alterar CTA nem conteudo
```

Esse pedido revelou a cadeia que precisava virar robusta: intake, render, media provider, validacao visual e patch incremental.

## Problemas reais encontrados

### 1. Rota incremental ainda podia cair no caminho errado

O pedido visual do hero foi interpretado algumas vezes como patch deterministico generico, gerando bloqueios como:

```text
deterministic_patch_safety_rejected
```

Isso mostrava que o Faber Code ainda nao distinguia bem:

- pedido visual de hero;
- pedido de media/video;
- alteracao incremental segura;
- patch deterministico textual pequeno.

### 2. O app podia pedir arquivo/URL mesmo quando o usuario pediu "video de X"

O sistema perguntava pelo arquivo ou URL do video de abelhas, em vez de entender que "video de abelhas" deve acionar o media provider configurado.

Isso quebrava a experiencia real, porque o usuario esperava que o Faber Code resolvesse o asset.

### 3. `<video>` vazio podia passar como entrega visual

A validacao antiga podia reconhecer intencao de video por texto, classe CSS ou tag presente, mesmo sem `src` renderizavel.

O resultado possivel era um hero com:

```html
<video></video>
```

ou um fallback visual bonito, mas sem video real.

### 4. Overlay branco forte podia esconder a midia

O pedido original citava blend/camada branca. Na pratica, depender de blend branco forte podia apagar a imagem e dar a impressao de que a API Pexels falhou.

A solucao correta para este caso foi:

- video real como fundo;
- `filter: grayscale(1)` na midia;
- overlay branco leve em `mix-blend-mode: normal`;
- fallback visual apenas se nao houver video real.

### 5. O resumo final podia ficar inconsistente

Em uma tentativa anterior, o app aplicou video real, mas o resumo ainda dizia:

```text
Anexe ou referencie o arquivo de video para substituir o fallback.
```

Isso era ruim porque a UI contradizia o resultado do projeto.

### 6. Mobile ainda exigia olho real

As capturas desktop/tablet/mobile mostraram o hero funcionando, mas uma captura mobile tambem revelou risco de titulo abaixo da dobra encostar no limite direito em viewport estreito.

Isso reforcou que o loop visual nao pode terminar apenas quando o codigo "passa"; ele precisa olhar screenshot.

## Solucoes implementadas

### Novo servico visual modular

Novo modulo:

```text
main/services/visual_hero_patch_service.js
```

Responsabilidades:

- detectar pedidos visuais de hero/topo/capa/banner;
- detectar pedido explicito de video;
- extrair URL direta `.mp4` quando o usuario fornece uma;
- aceitar anexos `.mp4`;
- acionar provider de midia quando o usuario pede "video de X";
- gerar bloco de hero com `<video>` e `<source src="...">`;
- aplicar `data-source-status="ready"` quando houver video real;
- bloquear quando o pedido exige video e nenhum `src` real existe;
- aplicar CSS de video full width, grayscale e overlays leves;
- preservar idempotencia em edicoes repetidas;
- reaproveitar video ja existente no projeto se o provider falhar depois.

### Pexels/media provider reforcado

Arquivo:

```text
main/services/pexels_asset_service.js
```

Avancos:

- inferencia de dominio `bees`/`abelhas`;
- query padrao para o caso Tremn:

```text
honey bees flying flowers pollination macro
```

- uso de endpoint de video (`/videos/search`);
- normalizacao de arquivo `video/mp4`;
- `requireVideo`;
- `allowPhotoFallback: false` quando o usuario pede video.

Isso evita que foto substitua video quando a intencao e explicitamente audiovisual.

### Validacao semantica agora rejeita video vazio

Arquivo:

```text
cortex/orchestration/visual_briefing_semantic_service.js
```

Avancos:

- `mediaCounts.videos` agora conta apenas videos com `src` renderizavel;
- `mediaCounts.videoElements` registra quantas tags existem, mas nao as trata como sucesso;
- `checks.video` exige fonte real (`src`, `currentSrc`, `.mp4`, `.webm`, Pexels, iframe etc.);
- tag vazia nao passa mais como video valido.

### Render pass virou async onde precisava

Arquivo:

```text
cortex/orchestration/render_pass_service.js
```

Avanco:

- a rota de fallback visual estrutural passou a suportar resolucao async de media provider.

Sem isso, o patch de hero nao conseguiria buscar video antes de montar o contrato de execucao.

### Main process respeita a rota visual antes do patch deterministico generico

Arquivo:

```text
main.js
```

Avancos:

- `buildVisualStructuralFallbackRuntimePlan` passou a ser async;
- `buildVisualStructuralFallbackOperationBatch` passou a ser aguardado;
- a rota visual estrutural roda antes do micro-patch deterministico generico;
- falha de provider em video explicito vira bloqueio claro, nao fallback enganoso;
- `resolveBlueprintMediaAssets` foi conectado ao novo servico visual.

### Blueprint static-web com melhor seguranca mobile

Arquivo:

```text
cortex/orchestration/project_blueprint_static_templates.js
```

Avancos:

- headings usam `overflow-wrap: anywhere`;
- titulos de secoes em mobile receberam escala menor;
- cards/categorias continuam com protecao contra overflow;
- esse ajuste reduz risco de cortes em sites institucionais gerados a partir de briefings longos.

## Primeiro site real criado

Projeto de teste:

```text
/private/tmp/faber-tremn-ui-smoke
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
```

Resultado:

- site institucional multipagina;
- navegacao entre as seis paginas;
- header com CTA;
- hero claro com linguagem Tremn;
- cards institucionais;
- pagina de premissas;
- jornada;
- conteudos;
- contato;
- footer;
- menu mobile.

Esse foi o primeiro caso em que o Faber Code saiu do campo de matriz/blueprint automatizado e criou um site real a partir de um briefing humano longo dentro do app.

## Primeira alteracao real concluida

Pedido aplicado:

```text
Quero que o hero tenha um video real de abelhas voando no fundo, full width,
com imagem em preto e branco e overlay branco leve; nao altere CTA nem conteudo.
```

Resultado no HTML:

```html
<section class="hero has-hero-video">
  <div class="hero-media-stack" data-source-status="ready" data-attribution="Video de Kmeel.com Videos no Pexels">
    <video class="hero-video" autoplay muted loop playsinline preload="metadata">
      <source src="https://videos.pexels.com/video-files/16590272/16590272-hd_1280_720_30fps.mp4" type="video/mp4">
    </video>
  </div>
</section>
```

Resultado no CSS:

```css
.hero-video {
  filter: grayscale(1) contrast(1.04) brightness(1.04);
  opacity: 0.82;
}

.hero-overlay-color {
  background: rgba(255, 255, 255, 0.18);
  mix-blend-mode: normal;
}

.hero-overlay-soft {
  background: rgba(255, 255, 255, 0.15);
  mix-blend-mode: normal;
}
```

Esse foi o primeiro patch incremental real validado de ponta a ponta no produto:

```text
mensagem humana -> intake -> rota visual -> media provider -> contrato -> confirmacao no app -> execucao -> preview real
```

## Loop de teste e correcao realizado

### Ciclo 1 - diagnostico

Sintoma:

- app pedia arquivo/URL de video;
- fallback podia passar sem src;
- rota visual era engolida pelo patch deterministico;
- resumo final podia mencionar fallback mesmo quando o video existia.

Correcao:

- novo servico `visual_hero_patch_service`;
- provider Pexels com `requireVideo`;
- validacao de video renderizavel;
- rota visual antes da deterministica.

### Ciclo 2 - smoke real pelo app

Fluxo manual:

1. abrir Faber Code via `npm run dev`;
2. logar com Google;
3. selecionar `FABER-TREMN-UI-SMOKE`;
4. enviar pedido de video real de abelhas;
5. confirmar pelo botao `Confirmar e Executar`;
6. abrir preview pelo botao `Executar`;
7. verificar visualmente o hero.

Resultado:

- a rota nao caiu mais em `deterministic_patch_safety_rejected`;
- o app gerou uma confirmacao de edicao visual incremental;
- a execucao concluiu;
- o resumo final reconheceu video real;
- o preview abriu com hero full width em preto e branco.

### Ciclo 3 - evidencia visual e ajuste mobile

Capturas:

```text
/private/tmp/faber-real-ui-video-patch-idempotent-confirmation.png
/private/tmp/faber-real-ui-video-patch-idempotent-applied.png
/private/tmp/faber-real-ui-video-preview-top-desktop.png
/private/tmp/faber-real-ui-video-preview-tablet.png
/private/tmp/faber-real-ui-video-preview-mobile.png
```

Achado:

- hero ok em desktop/tablet/mobile;
- risco de titulo de secao abaixo do hero cortar em mobile estreito.

Correcao:

- blueprint static-web recebeu `overflow-wrap: anywhere` e escala mobile menor em headings.

## Validacoes executadas

Passaram:

```text
node tests/visual-hero-patch-service.test.js
node tests/pexels-asset-service.test.js
node tests/visual-briefing-semantic-service.test.js
npm run test:project-blueprint
node tests/render-pass-service.test.js
node tests/post-execution-quality-service.test.js
node tests/project-visual-validation-runtime-service.test.js
npm run test:assistant-flow
npm run test:product-orchestration
npm run test:visual-product-coverage
node -c main.js
node -c main/services/visual_hero_patch_service.js
git diff --check
git diff --cached --check
```

Tambem houve smoke manual real com app desktop, login Google, confirmacao no fluxo e preview no Chrome.

## Estado apos esta V1

O Faber Code agora demonstrou, com evidencia real:

- capacidade de criar um site institucional multipagina a partir de briefing humano longo;
- capacidade de aplicar uma alteracao incremental real no mesmo projeto;
- uso de provider externo de midia para resolver asset pedido em linguagem natural;
- bloqueio de conclusao quando video explicito nao tem `src`;
- validacao semantica mais honesta para media;
- loop visual com screenshot para corrigir comportamento, nao apenas codigo.

## Limites restantes

Esta V1 nao deve ser lida como maturidade global de 100%.

Ainda precisam de novas rodadas reais:

1. repetir o fluxo em outros temas alem de Tremn;
2. testar alteracoes incrementais com imagens, secoes, formularios e conteudo;
3. persistir automaticamente evidencias visuais em `.faber/artifacts` quando o app rodar smoke real;
4. reduzir ainda mais acoplamento de `main.js`;
5. confirmar comportamento com Pexels indisponivel, sem chave ou rate-limit;
6. validar mais casos de mobile real e tablet real;
7. revisar todos os resumos finais para nao ficarem contraditorios.

## Leitura correta do marco

Antes desta rodada, o Faber Code tinha bons smokes automatizados e uma arquitetura promissora, mas o primeiro teste real mostrou atrito.

Depois desta rodada, o produto deu um passo qualitativo:

```text
Faber Code V1 local: cria um site real e altera esse site com uma mudanca visual real, validada no app.
```

Esse e o marco desta documentacao.
