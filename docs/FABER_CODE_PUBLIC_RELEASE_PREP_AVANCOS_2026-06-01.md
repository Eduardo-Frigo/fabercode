# Faber Code - Avancos de documentacao publica, arquitetura e release prep

Data: 2026-06-01  
Repositorio local: `<repo-root>`  
Ultimo commit antes desta documentacao: `5442e1b docs: prepare public release positioning`

## Objetivo da rodada

Esta rodada consolidou a preparacao publica do Faber Code para GitHub, com foco em:

- explicar melhor o que o produto e e o que ele ainda nao e;
- documentar a amplitude real do projeto sem exagerar promessa tecnica;
- organizar a documentacao publica e tecnica;
- sanitizar referencias locais, privadas ou pessoais em arquivos versionados;
- ajustar defaults publicos de IA para nao sugerir que RWKV ja esta pronto;
- confirmar que a arquitetura continua modular o suficiente para commit e publicacao preparatoria;
- publicar no GitHub apenas a parte publica/versionada do repositorio.

## Contexto do produto documentado

O README publico foi reposicionado para apresentar o Faber Code como um IDE local-first com IA, terminal, execucao local, Git/GitHub, memoria, validacao e automacoes.

A tese documentada ficou:

> Faber Code e um ambiente local-first para criar, editar, executar, versionar e publicar projetos de software com ou sem IA. A IA ajuda, mas o usuario continua no controle dos arquivos, comandos, diffs, commits e decisoes finais.

Isso evita reduzir o produto a um gerador de sites. A documentacao agora deixa claro que o Faber Code cobre um fluxo maior:

1. briefing e criacao assistida;
2. edicao manual de arquivos;
3. edicao incremental por IA;
4. terminal integrado;
5. execucao local e preview;
6. revisao visual;
7. Git local;
8. GitHub;
9. publicacao/deploy assistido;
10. memoria, RAG, MCP e contexto governado.

## IA, provedores e RWKV

A documentacao foi ajustada para distinguir tres coisas diferentes:

1. Provedores que o usuario pode configurar por API.
2. Rotas locais/deterministicas usadas para testes e contratos.
3. A futura IA local RWKV, que ainda nao esta configurada neste repositorio.

O texto publico agora permite citar provedores como GPT/OpenAI, Gemini, Claude/Anthropic, SambaNova e outros, mas com formulacao cuidadosa:

- por integracao nativa quando existir;
- por API compativel quando o endpoint suportar;
- por conector customizado quando o usuario configurar;
- sem afirmar que todo provider citado ja possui implementacao nativa completa.

Tambem foi corrigida a expectativa sobre RWKV:

- RWKV nao vem configurado como IA local pronta neste repositorio;
- sera um projeto separado, aberto, desenhado para conectar perfeitamente ao Faber Code;
- `.env.example` nao seleciona RWKV como default;
- o runtime publico volta para `mock` como caminho seguro de desenvolvimento.

## Fluxo Git e GitHub documentado

O fluxo Git/GitHub foi reescrito para ficar na ordem mental correta:

1. revisar arquivos novos e modificados;
2. selecionar o que deve passar de etapa;
3. preparar `Staged`;
4. criar `Commit`;
5. enviar para o GitHub;
6. publicar ou abrir deploy assistido.

Essa ordem substitui textos antigos que misturavam stage, clone, commit, publicacao e deploy sem separar fluxo de entrada e fluxo de saida.

Tambem ficou documentado que:

- OAuth GitHub e login de conta dentro do app;
- GitHub CLI (`gh`) e permissao local para clonar, criar repositorios, dar push e publicar;
- o app deve evitar push, publicacao ou deploy sem revisao e clique explicito;
- cada etapa do painel Git deve permanecer recolhida ate o clique;
- `Untracked` e `Modified` exigem selecao explicita antes de enviar para `Staged`.

## Arquivos principais alterados na rodada anterior

### Documentacao publica

- `README.md`
- `docs/README.md`
- `docs/PUBLIC_RELEASE_CHECKLIST.md`
- `docs/FABER_CODE_GITHUB_DEPLOY_UX_QA_2026-05-30.md`
- `docs/FABER_CODE_DOCS_INDEX_2026-05-25.md`

### Documentacao tecnica sanitizada

- `docs/FABER_CODE_QA_EXAUSTIVO_CORRECOES_2026-05-30.md`
- `docs/FABER_CODE_QA_HANDOFF_TECNICO_2026-05-30.md`
- `docs/FABER_CODE_UX_CONFIG_TERMINAL_HOME_LIGHTMODE_2026-05-30.md`
- `docs/DOCUMENTACAO_COMPLETA_DECISOES_RECENTES_E_SISTEMAS_EXTERNOS_2026-05-04.md`

### Configuracao publica e seguranca

- `.env.example`
- `.gitignore`

### Runtime e testes

- `main/runtime/runtime_config.js`
- `cortex/providers/runtime_settings.js`
- `tests/runtime-settings.test.js`

## Sanitizacao aplicada

Foram reforcadas regras de publicacao para nao versionar:

- `.env` e variantes locais;
- `private_context/`;
- modelos locais;
- bancos, caches, memorias e ledgers locais;
- `.faber/`;
- outputs de Playwright/testes visuais;
- `node_modules/`;
- projetos de usuario;
- arquivos `.DS_Store`;
- caminhos absolutos da maquina local;
- contas pessoais em evidencias publicas.

No historico tecnico antigo, documentos que falavam de RWKV como caminho ativo receberam nota explicando que aquilo e historico e nao representa o estado publico atual.

## Organizacao da documentacao

Foi criado `docs/README.md` como hub curto para navegacao publica e tecnica.

Ele organiza:

- documentos publicos essenciais;
- GitHub, Git, terminal e ferramentas;
- QA, smoke e release;
- produto, blueprints e orquestracao;
- preview, workspace e UX;
- arquitetura modular;
- MCP, memoria, RAG e MemPalace;
- historico consolidado;
- handoffs antigos e documentacao de base.

Tambem foram registradas regras para novos documentos:

1. usar nome claro e data quando for historico de rodada;
2. evitar caminhos absolutos locais e dados pessoais;
3. incluir comandos de validacao quando houver mudanca tecnica;
4. atualizar `docs/README.md`;
5. atualizar o indice historico quando o documento registrar decisao ou marco importante.

## Arquitetura modular

A arquitetura foi revisada em nivel de fronteiras e validada pela suite automatizada.

Separacao principal:

- `main/`: processo principal, IPC, filesystem, Git, GitHub, preview, runtime e seguranca;
- `renderer/`: UI, workspace, editor, composer, ferramentas e paineis;
- `cortex/`: orquestracao, providers, contratos, memoria, validacao e planejamento;
- `plugins/`: superficie para stacks e extensoes;
- `tests/`: contratos de arquitetura, servicos, renderer, smoke e validacao.

A avaliacao foi que a arquitetura esta limpa o suficiente para commit e publicacao preparatoria.

Ressalvas registradas:

- `renderer/` continua sendo a area com maior tendencia de crescimento e precisa continuar sendo quebrada com disciplina;
- docs historicas ainda existem, mas agora estao contextualizadas;
- RWKV permanece como caminho futuro/compatibilidade, nao como default publico;
- Claude/Anthropic foi citado como possibilidade via API/conector, nao como provider nativo pronto.

## Validacoes executadas

Antes do commit `5442e1b`, foram executadas as validacoes:

```bash
npm run audit:release
npm run test:architecture
git diff --check
```

Tambem foram executadas checagens auxiliares:

- links Markdown principais;
- cobertura do indice `docs/README.md` para todos os arquivos `.md` em `docs/`;
- varredura de termos sensiveis comuns;
- status de arquivos ignorados;
- checagem final para garantir que nao ficou `localcode-studio` ou `npm run dev` rodando.

Resultado:

- auditoria publica passou;
- higiene de testes passou;
- suite de arquitetura passou completa;
- links e indice de docs passaram;
- status final ficou limpo antes do push;
- nenhum processo Electron/dev server do Faber Code ficou rodando.

Observacao: a primeira tentativa da suite de arquitetura dentro do sandbox falhou ao abrir `127.0.0.1` no teste de backend de plataforma. A suite foi rerodada fora do sandbox e passou completa. Isso foi tratado como bloqueio de ambiente, nao como falha do produto.

## Commit e push realizados

Commit criado:

```bash
5442e1b docs: prepare public release positioning
```

Push realizado:

```bash
origin/main -> main
```

O push levou o branch local `main` sincronizado com `origin/main`.

Nao houve:

- Vercel deploy;
- empacotamento desktop;
- release assinada;
- tag publica;
- publicacao de `.env`, modelos, memorias locais ou contexto privado.

## Estado atual apos a rodada

O repositorio publico agora tem:

- README mais claro e voltado a usuarios;
- checklist publico mais completo;
- hub de documentacao;
- `.gitignore` mais forte para artifacts locais;
- `.env.example` seguro para desenvolvimento;
- defaults publicos sem RWKV ativo por engano;
- documentacao Git/GitHub em ordem correta;
- historico antigo contextualizado;
- arquitetura validada por suite ampla.

## Proximos passos recomendados

1. Revisar visualmente o README diretamente no GitHub.
2. Decidir se o proximo passo e tag/release ou apenas manter `main` como canal publico vivo.
3. Criar uma pagina curta de contribuicao se o repositorio for receber colaboradores externos.
4. Implementar provider Anthropic/Claude nativo somente se a documentacao futura quiser prometer suporte direto.
5. Manter RWKV como projeto separado ate existir runtime local testado e integrado.
6. Fazer nova rodada de smoke visual somente quando houver mudanca de UI ou fluxo Electron, nao apenas documentacao.

