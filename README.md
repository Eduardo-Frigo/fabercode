# Faber Code

Faber Code e um IDE local-first com IA para criar, editar, executar, versionar e publicar projetos de software no seu computador.

Ele combina editor, assistente de codigo, terminal, Git, GitHub, preview local, validacao visual e memoria de projeto. A ideia central e simples: a IA ajuda, mas o usuario continua no controle dos arquivos, do repositorio, dos comandos e das decisoes finais.

O projeto e gratuito. O codigo-fonte e distribuido sob Apache-2.0. A futura IA local baseada em RWKV sera um projeto separado, com distribuicao aberta, criado para conectar perfeitamente ao Faber Code quando estiver pronto. Provedores externos de IA, quando usados, continuam opcionais e podem ter custos proprios definidos por esses provedores.

## O que e o Faber Code

Faber Code esta sendo construido para ser uma ferramenta de desenvolvimento desktop para pessoas que querem:

- gerar uma primeira versao de um projeto com ajuda de IA;
- continuar codando manualmente, arquivo por arquivo;
- pedir edicoes incrementais sem perder o controle do diff;
- rodar o projeto localmente;
- revisar visualmente o resultado;
- usar Git sem sair do app;
- publicar ou preparar deploy com revisao antes de qualquer acao remota;
- manter memoria local do projeto, regras e decisoes importantes.

Ele nao e apenas um gerador de sites. O objetivo e ser um ambiente local de construcao de software assistido por IA, capaz de acompanhar o fluxo inteiro: briefing, arquivos, edicao, terminal, execucao, Git, validacao e entrega.

## Principios do produto

- Local-first: projetos, memoria, chaves e artefatos ficam na maquina do usuario por padrao.
- Controle humano: a IA sugere, edita e valida, mas mudancas importantes passam por confirmacao, diff ou contrato.
- Manual e IA juntos: o usuario pode codar manualmente a qualquer momento.
- Transparencia: o app deve mostrar quais arquivos mudaram, o que sera enviado para Git e o que sera publicado.
- Ferramenta gratuita: o app e gratuito; integracoes externas pagas sao opcionais.
- IA configuravel: o app pode trabalhar com provedores por API, conectores customizados e rotas locais de teste.
- IA local aberta no roadmap: o RWKV ainda nao esta configurado no Faber Code; ele sera desenvolvido como projeto separado e aberto para se conectar ao app.

## Ferramentas principais

### IDE e editor

Faber Code possui uma superficie de workspace com arquivos, editor, conversas de projeto, ferramentas laterais e estado visual do que esta acontecendo. O usuario pode abrir arquivos, editar manualmente e usar a IA apenas quando fizer sentido.

### IA de codigo

A IA pode ajudar a criar projetos, planejar alteracoes, aplicar edicoes incrementais, validar contratos e explicar proximos passos. Hoje o app aceita provedores configurados pelo usuario e possui rotas locais/deterministicas para testes e validacao. Isso pode incluir GPT/OpenAI, Gemini, Claude/Anthropic e outros modelos por integracoes nativas, APIs compativeis ou conectores customizados conforme configurados. A proxima etapa importante e criar uma IA local separada, baseada em RWKV, com conexao nativa ao Faber Code.

### Executar e preview

A ferramenta `Executar` prepara o projeto para rodar localmente, escolhe portas disponiveis, abre preview quando possivel e registra falhas de forma clara. Projetos estaticos podem abrir por arquivo; projetos com servidor usam runtime local.

### Terminal

O terminal integrado permite rodar comandos no contexto do projeto, acompanhando outputs longos e fluxos de desenvolvimento sem sair do app.

### Git e GitHub

O painel Git organiza o fluxo em etapas:

1. `Untracked`
2. `Modified`
3. `Staged`
4. `Committed`
5. `Deploy`

O fluxo correto e: revisar arquivos novos e modificados, escolher quais avancam, preparar `Staged`, criar `Commit`, enviar para o GitHub e so entao publicar ou abrir deploy assistido. O usuario escolhe explicitamente quais arquivos passam para a proxima etapa. O app tambem diferencia login de conta, Git local e GitHub CLI, evitando publicar ou enviar commits sem revisao.

### Memoria, RAG e contexto

O Cortex guarda contexto, regras e memoria de projeto com politica de escopo. Memoria ativa, RAG e MemPalace sao tratados como camadas opcionais e governadas, sem sobrescrever a mensagem atual do usuario quando houver conflito.

### MCP e integracoes

O app possui uma camada de capacidades para filesystem, terminal, preview, Git e MCP externo. Servidores externos devem ser configurados pelo usuario e passam por politicas de permissao, escopo e risco.

## Estado atual

Este repositorio e uma versao de desenvolvimento public-safe. Ainda nao e um instalador desktop assinado para usuarios finais.

Marcos recentes:

- primeiro site real multipagina criado pelo app;
- primeira edicao visual incremental real aplicada no app;
- Git local com revisao de arquivos novos/modificados, selecao explicita, stage, commit, envio para GitHub e deploy guiado;
- login Google e GitHub separados de permissao local do `gh`;
- preview local com tratamento de porta ocupada;
- scanner de projetos grandes;
- smoke visual real com screenshots;
- suites amplas de arquitetura, produto, MCP e memoria passando localmente.

## Instalar e rodar localmente

Requisitos:

- Node.js compativel com `package.json`;
- npm;
- Git;
- ambiente desktop compativel com Electron.

```bash
npm install
cp .env.example .env
npm run dev
```

Somente `.env.example` deve ir para o Git. Nunca publique `.env`, chaves, tokens, bancos locais, memorias privadas ou projetos de clientes.

## Configuracao de IA

Faber Code pode usar provedores configurados pelo usuario:

- rotas locais e deterministicas para testes e contratos;
- OpenAI/GPT, Gemini, Claude/Anthropic, SambaNova e outros provedores por API nativa, API compativel ou conector customizado;
- embeddings remotos opcionais;
- RAG opcional;
- MemPalace opcional;
- futura conexao com um projeto local RWKV separado.

O roadmap proximo prioriza essa experiencia com IA local RWKV como projeto separado, aberto e desenhado para integrar com o Faber Code. Ela ainda nao esta configurada neste repositorio.

## Integracoes opcionais e atribuicao

Faber Code pode se conectar a projetos externos quando o usuario instala e configura esses servicos localmente. Essas integracoes sao opcionais e nao estao vendorizadas neste repositorio.

- [MemPalace](https://github.com/MemPalace/mempalace): runtime opcional de memoria local-first.
- [R2R](https://github.com/SciPhi-AI/R2R): servico opcional de Retrieval-Augmented Generation usado via API.

Nao ha afiliacao, patrocinio ou endosso implicito por esses projetos.

## GitHub e publicacao

Antes de publicar este repositorio ou enviar uma rodada grande:

```bash
npm run audit:release
npm run test:architecture
npm audit --omit=dev --audit-level=moderate
git diff --check
```

Checklist publico:

- [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md)

Mapa da documentacao:

- [docs/README.md](docs/README.md)

## Estrutura do repositorio

- `main/`: servicos do processo principal, IPC, filesystem, Git, GitHub, preview e seguranca.
- `renderer/`: interface, workspace, composer, editor, ferramentas e paineis.
- `cortex/`: orquestracao, providers, contratos, memoria, validacao e planejamento.
- `plugins/`: superficie para stacks e extensoes.
- `tests/`: testes de arquitetura, servicos, renderer, smoke e contratos.
- `docs/`: documentacao publica, historico tecnico, QA e handoffs.

## Documentacao recomendada

Para entender o projeto como pagina publica:

1. [docs/README.md](docs/README.md)
2. [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md)
3. [SECURITY.md](SECURITY.md)

Para entender o estado tecnico recente:

1. [docs/FABER_CODE_PENTEST_PROMPT_INJECTION_SEGURANCA_2026-06-01.md](docs/FABER_CODE_PENTEST_PROMPT_INJECTION_SEGURANCA_2026-06-01.md)
2. [docs/FABER_CODE_ARQUITETURA_REFATORACAO_SEGURA_2026-06-01.md](docs/FABER_CODE_ARQUITETURA_REFATORACAO_SEGURA_2026-06-01.md)
3. [docs/FABER_CODE_QA_EXAUSTIVO_CORRECOES_2026-05-30.md](docs/FABER_CODE_QA_EXAUSTIVO_CORRECOES_2026-05-30.md)
4. [docs/FABER_CODE_QA_HANDOFF_TECNICO_2026-05-30.md](docs/FABER_CODE_QA_HANDOFF_TECNICO_2026-05-30.md)
5. [docs/FABER_CODE_GITHUB_DEPLOY_UX_QA_2026-05-30.md](docs/FABER_CODE_GITHUB_DEPLOY_UX_QA_2026-05-30.md)

## Seguranca e privacidade

O Faber Code foi desenhado para evitar que informacoes privadas sejam publicadas por acidente:

- `.env` e variantes locais sao ignoradas;
- modelos locais, bancos, caches, memorias, artefatos e projetos gerados nao devem ser versionados;
- a auditoria publica procura caminhos locais, tokens e chaves comuns;
- integracoes externas sao opcionais e configuradas pelo usuario.

Leia [SECURITY.md](SECURITY.md) antes de publicar um fork ou release.

## Licenca e marca

O codigo-fonte e licenciado sob Apache License 2.0. Veja [LICENSE](LICENSE) e [NOTICE](NOTICE).

O nome Faber Code, logos, icones e assets de marca identificam o projeto oficial. A licenca Apache-2.0 nao concede direitos de marca ou uso que implique endosso, distribuicao oficial ou afiliacao sem permissao.
