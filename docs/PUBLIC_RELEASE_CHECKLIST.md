# Public Release Checklist

Use este checklist antes de publicar ou atualizar o repositorio publico do Faber Code no GitHub.

## Posicionamento publico

- [ ] O README explica que Faber Code e um IDE local-first com IA.
- [ ] O README deixa claro que a ferramenta permite codar manualmente, nao apenas pedir geracao por IA.
- [ ] O README descreve as ferramentas principais: editor, terminal, executar/preview, Git, GitHub, memoria e validacao.
- [ ] O README descreve o fluxo Git/GitHub na ordem correta: revisar novos/modificados, selecionar, staged, commit, envio ao GitHub e deploy/publicacao.
- [ ] O README explica que o projeto e gratuito e licenciado sob Apache-2.0.
- [ ] O README explica que provedores de IA podem ser configurados por API nativa, API compativel ou conector customizado.
- [ ] O README explica que a IA local RWKV ainda nao esta configurada no Faber Code.
- [ ] O README explica que o RWKV sera um projeto separado, aberto e desenhado para conectar perfeitamente ao Faber Code.
- [ ] O README informa que provedores externos de IA sao opcionais e podem ter custos proprios.
- [ ] A documentacao evita prometer instalador final ou release assinada enquanto isso nao existir.

## Seguranca de publicacao

- [ ] `.env` e variantes locais nao estao trackeados.
- [ ] `.env.example` contem apenas placeholders e nao seleciona RWKV como provedor padrao.
- [ ] `private_context/` nao esta trackeado.
- [ ] `.faber/`, memorias locais, bancos, ledgers, caches, screenshots e artifacts gerados nao estao trackeados.
- [ ] Modelos locais, pesos de IA, arquivos `.gguf`, `.safetensors`, `.onnx`, `.pt`, `.pth`, `.bin` e similares nao estao trackeados.
- [ ] Projetos de usuarios, workspaces gerados e codigo de clientes nao estao trackeados.
- [ ] A documentacao nao contem caminhos absolutos locais, contas pessoais, tokens ou nomes de clientes.
- [ ] `cortex_bootstrap/knowledge_sources/` contem apenas placeholders ou documentacao segura.

## Licenca, marca e terceiros

- [ ] `LICENSE` usa Apache-2.0.
- [ ] `NOTICE` inclui copyright, atribuicao e orientacao de marca.
- [ ] O README explica que a licenca nao concede direitos de marca.
- [ ] Integracoes externas sao descritas como opcionais, salvo codigo realmente vendorizado.
- [ ] Nomes de terceiros, licencas e links nao implicam patrocinio, endosso ou afiliacao.

## Auditoria e testes

Rodar antes de publicar:

```bash
npm run audit:release
npm run test:architecture
npm audit --omit=dev --audit-level=moderate
git diff --check
```

Rodar conforme a area alterada:

```bash
npm run test:ai-trust-boundary
npm run test:project-blueprint
npm run test:memory-rag-mempalace
npm run test:mcp-capabilities
npm run test:smoke-scenarios
npm run smoke:full-tool-loop
npm run smoke:briefing-loop-matrix
```

Rodar quando a alteracao tocar IA, contexto externo, memoria, RAG, anexos, MCP ou capability privilegiada:

```bash
npm run test:ai-trust-boundary
npm run test:render-pass-service
npm run test:real-openai-prompt-injection
```

Observacao: `test:real-openai-prompt-injection` e opt-in, usa Electron para ler a chave protegida em `safeStorage`, depende de rede e pode consumir creditos de API. Ele nao deve entrar na suite padrao de arquitetura.

## Pentest e hardening

- [ ] Conteudo externo enviado para IA passa por `wrapUntrustedPromptSection` ou barreira equivalente.
- [ ] Capabilities privilegiadas recebem `aiTrustBoundary` quando usam fonte nao confiavel.
- [ ] Escritas de IA em `.env`, `.ssh`, `.git`, `private_context`, chaves privadas e arquivos de credenciais seguem bloqueadas.
- [ ] URL externa usa allowlist, `https` e bloqueia credenciais embutidas.
- [ ] Preview abre apenas `file:` local ou `localhost`/`127.0.0.1`/`::1`.
- [ ] Processos locais sao chamados com `shell: false` quando usam argumentos estruturados.
- [ ] MCP externo protege secrets persistidos e bloqueia escape fisico por symlink.
- [ ] Fluxos Git/GitHub validam paths, branch, remote, owner e destino de clone.

## GitHub

- [ ] Revisar `git status --short --ignored`.
- [ ] Revisar `git diff --check`.
- [ ] Criar commit apenas depois de auditoria e testes.
- [ ] Fazer push a partir do repositorio local.
- [ ] Evitar edicoes diretas no GitHub Web, exceto correcao emergencial de documentacao.

O repositorio publico deve conter codigo de produto, exemplos seguros e documentacao generica. Ele nao deve conter contexto de cliente, escopos privados de deploy, historico privado de usuario, caminhos absolutos da maquina local, artifacts gerados, testes temporarios focados, testes pulados ou marcadores de trabalho obsoleto.
