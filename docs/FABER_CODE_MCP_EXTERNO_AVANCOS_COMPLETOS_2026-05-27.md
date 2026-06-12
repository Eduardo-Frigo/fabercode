# Faber Code - Avancos completos do MCP externo em 2026-05-27

Este documento consolida a rodada de evolucao do MCP externo do Faber Code em 2026-05-27.

Nao registra deploy publico. Nao registra commit. O trabalho descrito aqui permanece local e pendente de decisao explicita de commit.

## Resumo executivo

O gargalo principal do projeto era o MCP externo.

No ultimo levantamento interno, usando o criterio "Codex = 100%", o estado estava assim:

| Frente | Estimativa anterior |
| --- | --- |
| UX/UI desktop | 88-90% |
| Arquitetura modular | 89-91% |
| Produto/orquestracao | 85-88% |
| Patch seguro deterministico | 88-91% |
| Contratos | 90-93% |
| Validacao visual | 87-90% |
| Memoria ativa/RAG/MemPalace | 72-78% |
| MCP/capability layer local | 91-94% |
| MCP externo | 40-46% |
| Produto total pronto | 82-85% |

Todas as frentes principais estavam acima de 70%, exceto o MCP externo.

Depois desta rodada, o MCP externo deixa de ser apenas fixture/controlado e passa a ter:

- bridge governada para servidores MCP externos;
- transportes reais `stdio`, HTTP e SSE;
- registry persistente de servidores;
- UI avancada de configuracao;
- `env`/`headers` com mascaramento de secrets;
- discovery real de tools;
- cache visual persistente de discovery;
- politicas por allow/block de tool;
- politica granular por risco;
- politica por escopo, diretorio e rede;
- execucao contra servidor MCP oficial de terceiro via `stdio`;
- execucao contra endpoint MCP publico HTTP/SSE sem credencial;
- smoke visual com screenshots reais;
- ledger de evidencias em `.faber/capabilities`.

Estimativa atualizada:

| Frente | Estimativa apos esta rodada |
| --- | --- |
| MCP/capability layer local | 91-94% |
| MCP externo | 86-89% |
| Produto total pronto | 86-89% |

## Decisao arquitetural central

MCP externo pertence ao Faber Code, nao ao modelo.

Isso significa:

- RWKV, OpenAI, Gemini ou outro modelo nao configuram MCP diretamente;
- o usuario/admin configura o servidor MCP uma vez no Faber;
- o Faber descobre tools, aplica politica, filtra risco e expoe uma capability segura;
- o modelo so enxerga contratos/capabilities ja governados;
- credentials, headers, env e aprovacoes continuam sob controle do app;
- `projectSession` nao contamina argumentos externos por padrao.

Fluxo correto:

```text
Modelo -> Orquestracao Faber -> Capability external_mcp -> Bridge governada -> Transporte MCP -> Servidor externo
```

O modelo pede uma capacidade. O Faber decide se pode executar.

## Por que existe o painel MCP externo

O painel mostrado em Configuracoes existe como superficie administrativa/avancada do bridge MCP externo.

Ele nao e uma tela que o RWKV precisa usar. Ele serve para:

- cadastrar servidores MCP externos;
- escolher transporte `stdio`, HTTP ou SSE;
- configurar comando, endpoint, `env` e `headers`;
- aprovar ou bloquear um servidor;
- definir tools permitidas e bloqueadas;
- definir nivel maximo de risco;
- definir permissoes permitidas;
- bloquear riscos especificos;
- exigir allowlist para alto risco;
- controlar injecao explicita de `projectSession`;
- configurar escopo de diretorios;
- configurar hosts de rede permitidos/bloqueados;
- executar discovery;
- visualizar cache de tools descobertas.

Conclusao de produto: essa UI ainda tem cara de bancada tecnica. Ela e util e necessaria para governanca, diagnostico e testes, mas o produto final deve evoluir para:

- presets guiados para servidores comuns;
- teste de conexao mais claro;
- modo simples para usuario comum;
- modo avancado para secrets, headers, politicas e auditoria.

## Modulos criados ou fortalecidos

### Bridge externo

```text
main/services/external_mcp_bridge_service.js
```

Responsabilidades:

- normalizar configuracao de servidores;
- listar servidores disponiveis;
- executar `initialize`;
- enviar `notifications/initialized`;
- executar `tools/list`;
- normalizar tools externas;
- aplicar politica de trust/allow/block/risco;
- aplicar politica de escopo/diretorio/rede antes de `tools/call`;
- chamar `tools/call`;
- resumir resultados e artefatos;
- fechar transportes.

### Transportes MCP

```text
main/services/external_mcp_stdio_transport_service.js
main/services/external_mcp_http_transport_service.js
main/services/external_mcp_transport_factory_service.js
```

`stdio`:

- usa `spawn` sem shell;
- conversa por JSON-RPC line-delimited;
- suporta timeout por request;
- captura `stderr`;
- fecha processo controladamente.

HTTP/SSE:

- usa `fetch`;
- envia JSON-RPC por `POST`;
- aceita `application/json`;
- aceita `text/event-stream`;
- parseia payload SSE por `data:`;
- valida endpoint `http` ou `https`;
- usa `AbortController` para timeout;
- retorna erros estruturados.

### Registry persistente

```text
main/services/external_mcp_server_registry_service.js
```

Arquivo persistido em userData:

```text
external-mcp-servers.json
```

Responsabilidades:

- salvar servidores;
- listar servidores;
- remover servidores;
- normalizar transporte;
- normalizar trust;
- normalizar allow/block;
- normalizar politica de risco;
- normalizar politica de escopo;
- mascarar `env` e `headers` na leitura publica;
- preservar secrets reais quando a UI reenviar valores mascarados.

### Cache persistente de discovery

```text
main/services/external_mcp_discovery_cache_service.js
```

Arquivo persistido em userData:

```text
external-mcp-discovery-cache.json
```

Responsabilidades:

- gravar discovery por servidor;
- recuperar discovery por servidor;
- anexar cache na listagem de servidores;
- limpar cache ao salvar/remover servidor;
- guardar tools normalizadas com permissao, risco, allow/block e motivo de bloqueio.

Esse cache permite que a UI mostre evidencias de discovery sem precisar bater no servidor externo a cada abertura.

### Politica de tools, risco, escopo e rede

```text
main/services/external_mcp_tool_policy_service.js
```

Politica por risco:

- `maxRiskLevel`;
- `blockedRiskLevels`;
- `allowedPermissions`;
- `requireExplicitAllowForHighRisk`.

Politica por escopo:

- `enforceProjectRoot`;
- `allowedDirectories`;
- `blockedDirectories`;
- `allowExternalNetwork`;
- `allowedNetworkHosts`;
- `blockedNetworkHosts`.

Antes de executar uma tool externa, o bridge inspeciona argumentos com nomes como:

- `path`;
- `filePath`;
- `artifactPath`;
- `directory`;
- `root`;
- `targetPath`;
- `url`;
- `endpoint`;
- `host`;
- `uri`.

Bloqueios aplicados:

- path absoluto fora de `projectSession.rootPath`;
- path relativo resolvido fora da raiz;
- diretorio bloqueado como `.git` ou `node_modules`;
- host explicitamente bloqueado;
- rede externa sem allowlist quando `allowExternalNetwork` esta falso.

### IPC e preload

```text
main/ipc/external_mcp_handlers.js
preload.js
```

Handlers:

```text
external-mcp:servers:list
external-mcp:servers:save
external-mcp:servers:remove
external-mcp:tools:discover
external-mcp:tools:call
```

APIs expostas:

```text
listExternalMcpServers
saveExternalMcpServer
removeExternalMcpServer
discoverExternalMcpTools
callExternalMcpTool
```

O IPC tambem:

- autoriza `projectInfo.rootPath`;
- cria `projectSession`;
- reseta runtime da capability ao salvar/remover servidor;
- audita save/remove/discovery/call;
- persiste cache de discovery quando discovery passa;
- limpa cache ao salvar/remover servidor.

### UI de configuracao

```text
renderer/ai_settings_mcp_panel.js
renderer/ai_settings_elements.js
renderer/ai_settings_controller.js
renderer/index.html
renderer/styles/settings.css
```

A UI agora permite:

- cadastrar servidor;
- editar servidor;
- remover servidor;
- executar discovery;
- ver transporte e status;
- ver endpoint/comando;
- ver allow/block de tools;
- ver risco maximo;
- ver permissoes;
- ver `env` e `headers` mascarados;
- configurar diretorios permitidos/bloqueados;
- configurar hosts permitidos/bloqueados;
- configurar rede externa;
- visualizar cache de tools descobertas.

Foi corrigido um problema responsivo encontrado no smoke visual: em viewport estreito, os botoes de acao do servidor podiam cortar. O CSS agora empilha as acoes e permite wrap dos controles.

## Correcoes descobertas no looping de testes

### 1. Sandbox bloqueando servidor local

Primeira tentativa:

```text
npm run smoke:mcp-http-sse
```

Falha:

```text
listen EPERM: operation not permitted 127.0.0.1
```

Causa: sandbox bloqueou abertura de servidor local.

Acao: repetir com permissao explicita.

Resultado: passou.

### 2. Sandbox bloqueando rede externa

Primeira tentativa:

```text
npm run smoke:mcp-public-deepwiki
```

Falha:

```text
fetch failed
```

Causa: rede externa bloqueada pela sandbox.

Acao: repetir com permissao explicita.

Resultado: o endpoint respondeu e revelou problemas reais de classificacao.

### 3. `openWorldHint` read-only classificado como critico

O DeepWiki retornou tools read-only. O classificador interpretava `openWorldHint` como critico mesmo para leitura.

Correcao:

- `destructiveHint` continua critico;
- `openWorldHint` + `read` vira medio;
- `openWorldHint` + `write/admin` vira alto.

### 4. Palavra `format` gerando falso risco critico

A descricao do DeepWiki continha texto como:

```text
owner/repo format
```

O classificador antigo tratava `format` como acao destrutiva.

Correcao:

- `format` so vira critico em contexto como `format disk`, `format drive`, `format volume`, `format filesystem`;
- textos de formato de string nao disparam risco critico.

### 5. UI mobile cortando acoes

O screenshot mobile da lista/cache mostrou botoes cortados no card de servidor.

Correcao:

- `.ai-settings-mcp-item` empilha em mobile;
- acoes justificam para inicio;
- botoes podem crescer/encolher;
- toggles fazem wrap;
- texto dos toggles pode quebrar linha.

## Smokes reais adicionados

### HTTP/SSE local real

Script:

```text
npm run smoke:mcp-http-sse
```

Arquivo:

```text
tests/external-mcp-http-sse-endpoint-smoke.test.js
```

Valida:

- endpoint HTTP local real em `127.0.0.1`;
- rota `/rpc` JSON;
- rota `/sse` event-stream;
- `initialize`;
- `notifications/initialized`;
- `tools/list`;
- `tools/call`;
- tool read permitida;
- tool critical bloqueada;
- `projectSession` nao injetado por padrao.

Resultado final: passou com permissao explicita.

### Servidor MCP oficial de terceiro via stdio

Script:

```text
npm run smoke:mcp-third-party
```

Arquivo:

```text
tests/external-mcp-third-party-smoke.test.js
```

Servidor:

```text
@modelcontextprotocol/server-filesystem
```

Valida:

- execucao via `npx`;
- processo externo real;
- discovery real;
- chamada segura de leitura/listagem;
- bloqueio de escrita direta;
- escopo preso a diretorio permitido.

Resultado final:

```text
external-mcp-third-party-smoke.test.js: ok (14 tools)
```

### Endpoint MCP publico HTTP/SSE sem credencial

Script:

```text
npm run smoke:mcp-public-deepwiki
```

Arquivo:

```text
tests/external-mcp-public-deepwiki-smoke.test.js
```

Endpoint:

```text
https://mcp.deepwiki.com/mcp
```

Repositorio publico usado:

```text
modelcontextprotocol/servers
```

Valida:

- `initialize` real;
- `tools/list` real;
- discovery de 3 tools;
- allow de tools read-only;
- chamada real de `read_wiki_structure`;
- bloqueio local de argumento `url: https://example.com/...` por politica de rede.

Resultado final:

```text
external-mcp-public-deepwiki-smoke.test.js: ok (3 tools)
```

## Smokes visuais e evidencias

### Smoke visual MCP externo no capability runner

Smokes:

```text
mcp_external_tool_bridge
mcp_external_stdio_visual_bridge
```

Validam:

- discovery de tools externas;
- chamada de tool visual permitida;
- bloqueio de escrita direta;
- geracao de PNG real;
- analise de pixels para rejeitar screenshot vazio;
- consumo da evidencia pelo `blueprint_contract`;
- ledger `external_mcp.jsonl`.

Resultados no `npm run test:mcp-capabilities`:

```text
[smoke:ok] mcp_external_tool_bridge
[smoke:ok] mcp_external_stdio_visual_bridge
```

### Smoke visual da UI com cache e politicas

Harness temporario:

```text
/private/tmp/faber-mcp-settings-cache-policy-smoke.html
```

Screenshots:

```text
/private/tmp/faber-mcp-settings-cache-policy-desktop.png
/private/tmp/faber-mcp-settings-cache-policy-list-desktop.png
/private/tmp/faber-mcp-settings-cache-policy-list-mobile-500.png
```

Metricas DOM confirmadas:

```text
hasHorizontalOverflow: false
cacheTitles: ["Cache visual: 3 tools", "Cache visual: 4 tools"]
badgeCount: 11
```

Analise de PNG:

```text
desktop top: sampledColors 110, blankLikely false
desktop list/cache: sampledColors 124, blankLikely false
mobile list/cache: sampledColors 100, blankLikely false
```

Observacao: o viewport `390x844` no Chrome headless reportou `innerWidth` efetivo de 500 em `dump-dom`, mas os PNGs foram gerados no tamanho solicitado e o teste visual estreito em 500px confirmou ausencia de corte depois do ajuste CSS.

## Testes adicionados ou ampliados

Novos:

```text
tests/external-mcp-bridge-service.test.js
tests/external-mcp-discovery-cache-service.test.js
tests/external-mcp-handlers.test.js
tests/external-mcp-http-sse-endpoint-smoke.test.js
tests/external-mcp-public-deepwiki-smoke.test.js
tests/external-mcp-server-registry-service.test.js
tests/external-mcp-third-party-smoke.test.js
tests/external-mcp-tool-policy-service.test.js
tests/external-mcp-transports.test.js
tests/fixtures/external_mcp_stdio_visual_server.js
```

Ampliados:

```text
tests/faber-capability-adapter-service.test.js
tests/preload-api-contract.test.js
tests/renderer-ai-settings.test.js
tests/smoke-scenarios.test.js
tests/support/smoke_scenario_runner.js
```

Scripts adicionados/atualizados:

```text
npm run test:mcp-policy
npm run test:mcp-transports
npm run test:mcp-server-registry
npm run test:mcp-discovery-cache
npm run test:mcp-ipc
npm run test:mcp-external
npm run smoke:mcp-http-sse
npm run smoke:mcp-third-party
npm run smoke:mcp-public-deepwiki
npm run test:mcp-capabilities
```

## Validacoes executadas

Validacoes finais confirmadas:

```text
node --check main/services/external_mcp_tool_policy_service.js
node --check main/services/external_mcp_discovery_cache_service.js
node --check main/services/external_mcp_bridge_service.js
node --check main/ipc/external_mcp_handlers.js
node --check renderer/ai_settings_mcp_panel.js
node --check tests/external-mcp-public-deepwiki-smoke.test.js
npm run test:mcp-policy
npm run test:mcp-discovery-cache
npm run test:mcp-server-registry
npm run test:mcp-ipc
npm run test:mcp-external
npm run test:mcp-transports
npm run test:mcp-capability-adapter
npm run test:preload-api-contract
npm run test:renderer-ai-settings
npm run test:window-chrome-css
npm run smoke:mcp-http-sse
npm run smoke:mcp-third-party
npm run smoke:mcp-public-deepwiki
npm run test:mcp-capabilities
npm run audit:release
git diff --check
```

Resultado do agregado:

```text
smoke-scenarios.test.js: ok (5 scenarios)
```

Smokes cobertos no agregado:

```text
mcp_structured_edit_persistence
mcp_external_tool_bridge
mcp_external_stdio_visual_bridge
mcp_blueprint_contract_guardian
mcp_blueprint_contract_briefing_matrix
```

Auditorias:

```text
Public safety audit passed.
Test hygiene audit passed.
```

## Estado dos arquivos

A rodada gerou alteracoes em:

```text
docs/
main.js
main/ipc/
main/services/
preload.js
renderer/
tests/
package.json
```

Arquivos principais novos:

```text
docs/FABER_CODE_MCP_EXTERNO_BRIDGE_2026-05-27.md
main/ipc/external_mcp_handlers.js
main/services/external_mcp_bridge_service.js
main/services/external_mcp_discovery_cache_service.js
main/services/external_mcp_http_transport_service.js
main/services/external_mcp_server_registry_service.js
main/services/external_mcp_stdio_transport_service.js
main/services/external_mcp_tool_policy_service.js
main/services/external_mcp_transport_factory_service.js
renderer/ai_settings_mcp_panel.js
tests/external-mcp-public-deepwiki-smoke.test.js
```

## O que melhorou na porcentagem

Antes:

```text
MCP/capability layer: 91-94% local / 40-46% externo
Produto total pronto: 82-85%
```

Depois:

```text
MCP/capability layer: 91-94% local / 86-89% externo
Produto total pronto: 86-89%
```

Justificativa:

- deixou de depender apenas de fixture controlado;
- validou servidor MCP oficial via `stdio`;
- validou endpoint publico HTTP/SSE real sem credencial;
- adicionou registry persistente;
- adicionou UI de configuracao;
- adicionou cache visual persistente;
- adicionou politica de risco;
- adicionou politica de escopo/diretorio/rede;
- adicionou smoke visual com screenshots;
- corrigiu bugs descobertos durante o looping real.

## Limites restantes

Ainda nao e 100%.

Pontos pendentes:

1. Presets/guias para servidores MCP comuns, evitando que usuario configure tudo manualmente.
2. Registry externo/marketplace de servidores MCP.
3. Rotacao, limpeza e validacao de secrets por provider.
4. UX mais simples para usuario comum, deixando o painel atual como avancado.
5. Testes contra endpoints privados/autenticados sem expor credenciais.
6. Observabilidade mais rica para conexoes SSE long-lived.
7. Politicas humanas mais finas por workspace/time para risco alto.
8. Artifact store permanente para screenshots/evidencias do MCP externo.

## Proxima frente recomendada

Proxima evolucao natural:

1. Criar presets de MCP externo no app.
2. Separar UI simples de conexao e UI avancada de politica.
3. Persistir historico de discovery/calls em uma visao de evidencias.
4. Criar artifact store controlado para screenshots e outputs MCP.
5. Implementar testes opt-in para endpoints autenticados usando secrets locais mascarados.

## Conclusao

Esta rodada transformou o MCP externo de uma frente fraca e majoritariamente teorica em uma camada real, governada, persistente, testada e visualmente validada.

O ponto mais importante e arquitetural: o modelo nao precisa saber falar MCP diretamente. O Faber fala MCP, governa MCP e entrega ao modelo apenas capabilities seguras e filtradas.

Isso preserva a arquitetura modular e evita que RWKV, OpenAI, Gemini ou qualquer outro provider precisem receber configuracoes manuais especificas de MCP.
