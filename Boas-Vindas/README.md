# Boas-Vindas

Landing page estática do tutorial Faber Code, construída com Next.js, JavaScript e Tailwind CSS.

## Estado

A experiência está concluída e validada em desktop, tablet e mobile. Ela inclui:

- conexão responsiva entre hero e sistema orbital;
- cards orbitais sem clipping nas bordas do viewport;
- feedback de conexões e conclusão da jornada;
- contenção de overflow horizontal;
- suporte à personalização e aos idiomas do tutorial.

Este diretório é o protótipo visual. Novas LPs do tutorial são geradas por `../renderer/tutorial_welcome_project.js` com copy de `../renderer/tutorial_copy.js`.

## Configuração

1. Duplique `.env.example` como `.env.local`.
2. Ajuste `NEXT_PUBLIC_WELCOME_NAME` com o nome capturado no tutorial.
3. Configure `NEXT_PUBLIC_SITE_URL` com o endereço final de publicação.
4. Substitua os placeholders de GitHub e LinkedIn pelos links reais.

## Execução

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Exportação estática

```bash
npm run build
npm run start
```

O build exportável é salvo em `out/`.
