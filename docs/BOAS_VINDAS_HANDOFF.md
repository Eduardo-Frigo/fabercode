# Handoff: Landing Page Boas-Vindas

## Estado atual

- A landing page `Boas-Vindas/` foi criada em Next.js com foco em apresentação estática e interativa.
- O nome do usuário já está limitado à primeira palavra em `/Users/eduardofrigo/Desktop/Faber code/localcode-studio-architecture-base/Boas-Vindas/app/page.js`.
- Os links finais de GitHub e LinkedIn do Eduardo já estão configurados.
- A experiência principal está dividida entre:
  - `/Users/eduardofrigo/Desktop/Faber code/localcode-studio-architecture-base/Boas-Vindas/components/WelcomeHero.js`
  - `/Users/eduardofrigo/Desktop/Faber code/localcode-studio-architecture-base/Boas-Vindas/components/BuildBlueprint.js`
  - `/Users/eduardofrigo/Desktop/Faber code/localcode-studio-architecture-base/Boas-Vindas/components/BuildPath.js`
  - `/Users/eduardofrigo/Desktop/Faber code/localcode-studio-architecture-base/Boas-Vindas/components/WelcomeExperience.js`
  - `/Users/eduardofrigo/Desktop/Faber code/localcode-studio-architecture-base/Boas-Vindas/app/globals.css`

## Pendências visuais confirmadas

### 1. Conexão entre sessão 1 e sessão 2

- A linha guia que sai da primeira sessão ainda não se conecta de forma suave com a segunda.
- Em algumas larguras a curva mostra uma quebra visível em vez de uma parábola contínua.
- O trecho destacado nas imagens `01 As linhas da primeira sessão e da segunda não estão conectando de maneira satisfatória.png` ainda precisa ser suavizado.

### 2. Tooltips/cards orbitais cortando

- Quando o ponto orbital está muito alto na animação, o card de texto:
  - pode não aparecer;
  - pode aparecer cortado;
  - pode encostar no topo da área útil.
- Isso foi visto nas imagens:
  - `02 o texto não aparece quando o ponto está muito pra cima na animação.png`
  - `03 também corta a caixa do texto quando o ponto está muito pra cima na animação.png`
  - `04 também corta a caixa do texto quando o ponto está muito pra cima na animação.png`
- A referência correta de comportamento é `02 ok.png`.

### 3. Distribuição das esferas orbitais

- As esferas menores ainda ficam muito próximas do centro em alguns estados.
- Isso atrapalha leitura, separação visual e o entendimento da hierarquia.
- O principal ajuste restante está na composição da sessão orbital da `BuildPath`.

### 4. Conclusão da etapa drag-and-drop

- A base da interação já existe.
- Próximo refinamento esperado:
  - o núcleo da esquerda deve reagir de forma diferente a cada conexão concluída;
  - após a terceira conexão, um texto final curto deve aparecer;
  - a transição para a próxima sessão precisa acontecer de forma mais suave e mais “celebratória”.

## Onde continuar

### Ajustar geometria da linha principal

- Arquivo principal:
  - `/Users/eduardofrigo/Desktop/Faber code/localcode-studio-architecture-base/Boas-Vindas/components/WelcomeExperience.js`
- Objetivo:
  - recalcular melhor o SVG `journey-thread`;
  - evitar quebra entre o terminal da primeira área e o início visual da segunda.

### Ajustar órbitas, cards e limites de hover

- Arquivo principal:
  - `/Users/eduardofrigo/Desktop/Faber code/localcode-studio-architecture-base/Boas-Vindas/components/BuildPath.js`
- Arquivo de suporte visual:
  - `/Users/eduardofrigo/Desktop/Faber code/localcode-studio-architecture-base/Boas-Vindas/app/globals.css`
- Objetivo:
  - afastar melhor os planetas menores do centro;
  - reposicionar os cards dinamicamente quando o ponto estiver próximo do topo;
  - impedir clipping dos cards nas bordas da seção;
  - manter o comportamento consistente em desktop, tablet e mobile.

## Critérios para considerar finalizado

- A linha entre sessão 1 e sessão 2 parece contínua em qualquer viewport.
- Nenhum card orbital some ou corta quando o ponto está no topo da órbita.
- As esferas não ficam visualmente sobrepostas ao núcleo central.
- O fim da interação de conexões entrega uma sensação clara de progressão e conclusão.

## Como retomar rápido em outra janela

1. Abrir a pasta:
   - `/Users/eduardofrigo/Desktop/Faber code/localcode-studio-architecture-base/Boas-Vindas`
2. Rodar:
   - `npm install`
   - `npm run dev`
3. Priorizar:
   - `WelcomeExperience.js`
   - `BuildPath.js`
   - `app/globals.css`
