# Faber Code - Handoff 2026-06-02, pausa por limite da API

Data: 2026-06-02
Motivo do handoff: smoke real interrompido por limite/output da OpenAI

## Estado resumido

O Faber Code recebeu correcoes importantes para o loop Forge MRP:

- contrato deixou de ser bloqueio padrao e virou aviso/advisory;
- painel de job agora mostra fases, eventos atuais, resumo e caminho expansivel;
- diagnostico read-only nao deve abrir aplicacao de artefatos;
- edicao visual estreita nao deve puxar validacao ampla de app inteiro;
- validacao tecnica bloqueia arquivos de codigo contendo apenas instrucoes textuais;
- rota `diagnostic_repair` foi adicionada ao retry compacto apos falha por output limit;
- blueprint/contrato estatico Forge MRP foi adicionado para pedidos estruturais.

## Estado do projeto Forge MRP externo

O projeto fora deste repositorio, em ambiente local do usuario, ficou quebrado por uma rodada anterior do Faber que escreveu instrucoes em vez de codigo.

Arquivos conhecidos como quebrados:

- `package.json`
- `app/layout.tsx`
- `app/page.tsx`
- `app/globals.css`
- `tests/forge-mrp.spec.ts`

Essa quebra nao deve ser escondida. O Faber ainda precisa reparar esse projeto em nova rodada ou o reparo deve ser feito manualmente.

## Ultimo teste real feito no app

Fluxo operado como usuario:

1. Electron reiniciado.
2. Login Google concluido.
3. Projeto THE FORGE aberto.
4. Conversa `Stresstest Iniciado` usada.
5. Prompt de reparo enviado.

Resultado observado:

- o Faber nao abriu contrato;
- o painel de job mostrou fases corretamente;
- a execucao entrou em `Render do Executor`;
- o provider falhou com:

```text
OpenAI não retornou texto gerado (status=incomplete; reason=max_output_tokens; output=reasoning; max_output_tokens=4096)
```

O reparo nao foi aplicado.

## Prompt de reparo usado

```text
Reparo obrigatório 1780445000: a tentativa anterior quebrou o THE FORGE escrevendo frases/instruções em arquivos de código. Substitua por código válido completo, não por instruções textuais. Corrija especificamente package.json, app/layout.tsx, app/page.tsx, app/globals.css e tests/forge-mrp.spec.ts. package.json deve voltar a ser JSON válido com scripts/dependências coerentes com Next/Vitest/Playwright já existentes. app/layout.tsx deve importar IBM Plex Sans e IBM Plex Mono via next/font/google, restaurar metadata.title como "Forge MRP" e renderizar RootLayout válido. app/page.tsx deve ser componente React/Next válido com H1 "Control Room", preservar a UI Forge MRP operacional existente e aplicar IBM Plex Mono somente a SKUs, códigos e números. app/globals.css deve ser CSS válido com Tailwind e variáveis de fonte IBM Plex. tests/forge-mrp.spec.ts deve ser teste Playwright válido ou permanecer coerente. Não altere domínio, serviços, Prisma, schemas, store ou cálculo MRP. Valide que package.json parseia e que build/test não quebram. Aplique no projeto atual.
```

## Testes que devem ser rodados antes de retomar o app

```bash
node --check cortex/orchestration/render_pass_service.js
node tests/render-pass-service.test.js
node tests/validation-service.test.js
npm run test:product-orchestration
```

Se tempo permitir:

```bash
node tests/artifact-quality-service.test.js
node tests/assistant-flow.test.js
node tests/renderer-ux-state-model.test.js
```

## Checklist para a retomada

1. Confirmar que `diagnostic_repair` faz retry compacto com `num_predict=12000`.
2. Reiniciar Electron para carregar o codigo novo.
3. Reabrir THE FORGE.
4. Reenviar o prompt de reparo.
5. Se aparecer card de confirmacao, inspecionar o plano antes de confirmar.
6. Nao confirmar operacoes que contenham frases como:
   - `Atualizar importacao`;
   - `Substituir referencias`;
   - `Nenhuma alteracao de dependencias`;
   - `Se necessario`.
7. Confirmar apenas operacoes com codigo real.
8. Validar no filesystem se `package.json` parseia.
9. Rodar build/test no Forge MRP.
10. Abrir preview real e capturar screenshot.

## Comandos uteis para verificar o Forge MRP

No projeto Forge MRP:

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package ok')"
rg -n "Atualizar|Substituir|Nenhuma alteração|Nenhuma alteracao|Se necessário|Se necessario" package.json app tests
npm test
npm run build
```

## Evidencias locais nao versionadas

Screenshots gerados durante a rodada:

- `/private/tmp/faber-action-description-live.png`
- `/private/tmp/faber-action-description-awaiting-confirmation.png`
- `/private/tmp/faber-action-description-final-collapsed.png`
- `/private/tmp/faber-action-description-final-expanded.png`
- `/private/tmp/faber-read-only-routing-fixed.png`
- `/private/tmp/faber-visual-direct-provider-failure.png`
- `/private/tmp/faber-visual-direct-1780444000-confirmation.png`
- `/private/tmp/faber-visual-direct-1780444000-post-exec-failed.png`

## Risco aberto

O Faber agora tem validacao para bloquear conteudo instrucional em arquivos criticos, mas isso ainda precisa ser comprovado no smoke real apos a API voltar.

