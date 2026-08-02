# Handoff final: Landing Page Boas-Vindas

**Status:** concluída e validada
**Última atualização:** 2 de agosto de 2026

## Resultado consolidado

A landing page de boas-vindas do tutorial está implementada em Next.js, com identidade visual Faber Code, conteúdo personalizado pelo nome informado no tutorial e comportamento consistente entre o protótipo, as LPs já geradas e o gerador usado por novos usuários.

O nome continua limitado à primeira palavra na saudação. GitHub e LinkedIn usam os links configurados para a demonstração, e todo o conteúdo textual suportado pelo tutorial permanece disponível em português, inglês e espanhol.

## Correções finais

### Conexão entre a primeira e a segunda sessão

- A trajetória entra pela borda direita e chega ao núcleo orbital em uma única curva Bézier.
- Os pontos inicial e final são calculados a partir do viewport e do núcleo real, sem emendas independentes.
- A curvatura foi suavizada para manter leitura orgânica sem formar um “S” artificial.
- A antiga linha inferior acionada pelo clique (`signal-tail`) foi removida do JSX, do CSS e do gerador.

### Cards orbitais

- Os cards de hover são renderizados em `document.body` por portal.
- O posicionamento usa coordenadas fixas de viewport, inverte acima/abaixo quando necessário e aplica margem de segurança nas quatro bordas.
- O card não depende mais do `overflow` da seção orbital; título, texto e contorno permanecem completos quando o planeta está no topo ou na base da órbita.
- A órbita correspondente continua pausando durante o hover.

### Geometria e progressão

- As órbitas e os planetas foram redistribuídos para melhorar separação visual e legibilidade.
- O sistema de conexões reforça o feedback incremental no ponto de origem.
- A conclusão das conexões apresenta mensagem final e transição suave para o próximo bloco.
- O scroll horizontal permanece contido, sem vazamento lateral da composição.

### Responsividade

- Desktop validado em `1600x900`.
- Tablet validado em `768x900`.
- Mobile validado em `390x844`.
- Nos três tamanhos, a linha começa fora da borda, o card permanece dentro do viewport e não existe overflow horizontal.

## Fontes de verdade

- Protótipo: `Boas-Vindas/`
- Gerador: `renderer/tutorial_welcome_project.js`
- Copy localizada: `renderer/tutorial_copy.js`
- Regressões do gerador: `tests/renderer-tutorial-welcome-project.test.js`
- Fluxo do tutorial: `renderer/progressive_disclosure.js`

As LPs locais `Apollo` e `Salem` receberam as mesmas correções para validar o comportamento real de projetos já gerados. Novos projetos recebem a versão corrigida diretamente pelo gerador.

## Validação executada

- `npm run lint` nas LPs `Apollo` e `Salem`.
- `npm run build` na LP ativa `Apollo`.
- `npm run test:renderer-tutorial-project` no repositório principal.
- Inspeção visual da curva, do clique no sinal, dos cards orbitais e do overflow em desktop, tablet e mobile.

## Critério de encerramento

A LP é considerada finalizada porque a conexão visual é contínua, a linha residual não existe mais, os cards orbitais não sofrem clipping, a interação mantém feedback claro e o resultado é reproduzido pelo gerador para os idiomas suportados.
