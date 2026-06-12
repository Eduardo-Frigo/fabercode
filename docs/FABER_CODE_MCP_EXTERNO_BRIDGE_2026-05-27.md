# Faber Code - MCP Externo Bridge 2026-05-27

Este documento registra a rodada inicial para elevar o MCP externo real, que era o menor percentual do projeto no levantamento contra o criterio interno "Codex = 100%".

Nao registra deploy publico. Publicacao externa continua dependendo de pedido explicito.

## Estado anterior

A capability layer local estava forte e auditavel, mas o MCP externo permanecia baixo porque ainda nao havia uma ponte governada para:

- registrar servidores MCP externos aprovados;
- listar tools externas por servidor;
- bloquear tools nao aprovadas;
- executar `tools/call` com `projectSession` explicito;
- manter configuracao persistente de servidores;
- expor UI de configuracao no app;
- persistir evidencia da execucao externa em `.faber/capabilities`;
- consumir artefatos visuais externos dentro de contratos Faber.

## O que foi implementado

Foi criado o servico:

```text
main/services/external_mcp_bridge_service.js
```

Transportes adicionados:

```text
main/services/external_mcp_stdio_transport_service.js
main/services/external_mcp_http_transport_service.js
main/services/external_mcp_transport_factory_service.js
main/services/external_mcp_server_registry_service.js
main/services/external_mcp_discovery_cache_service.js
main/services/external_mcp_tool_policy_service.js
main/ipc/external_mcp_handlers.js
```

Schema:

```text
faber-external-mcp-bridge-v1
```

A capability nova exposta pelo adapter e:

```text
external_mcp
```

Acoes:

- `servers`: lista servidores MCP externos configurados;
- `discover_tools`: executa discovery de tools via `initialize` e `tools/list`;
- `call_tool`: executa `tools/call` somente para servidor aprovado e tool permitida.

Tambem foi adicionada a UI em:

```text
renderer/ai_settings_mcp_panel.js
renderer/index.html
renderer/styles/settings.css
```

A tela fica dentro de Configuracoes e permite cadastrar/listar servidores MCP externos, escolher transporte `stdio`/HTTP/SSE, marcar servidor como aprovado, definir allow/block de tools e executar discovery.

Nesta sequencia, a UI tambem passou a expor cache visual persistente de discovery, politicas por diretorio/escopo/rede e estado de tools cacheadas por servidor.

## Governanca

A bridge exige:

- servidor registrado;
- transporte disponivel;
- `trust: approved`;
- allowlist quando declarada;
- bloqueio por `blockedTools`;
- `projectSession.rootPath` para chamadas de tool;
- persistencia no ledger `.faber/capabilities/external_mcp.jsonl`.
- `projectSession` separado dos argumentos externos por padrao.
- bloqueio de argumentos de arquivo fora da raiz autorizada;
- bloqueio de diretorios proibidos como `.git` e `node_modules`;
- bloqueio de destinos de rede fora dos hosts permitidos quando `allowExternalNetwork` nao estiver habilitado.

O servidor externo so recebe `projectSession` dentro dos argumentos quando `injectProjectSessionArgument: true` estiver configurado explicitamente. Isso evita contaminar schemas de servidores MCP de terceiros com contexto interno do Faber. As decisoes de contrato, memoria, dominio, recipe e aceitacao continuam no Cortex/Automata.

## Registry persistente e IPC

O registry local persiste em `external-mcp-servers.json` dentro do `app.getPath('userData')` do Electron.

O cache de discovery persiste em:

```text
external-mcp-discovery-cache.json
```

Ele guarda, por servidor, tools normalizadas, permissao, risco, motivo de bloqueio, horario de cache e contagem de tools. A listagem de servidores anexa esse cache para que a UI mostre evidencias antigas sem redescobrir a cada abertura.

Contratos expostos no preload:

```text
listExternalMcpServers
saveExternalMcpServer
removeExternalMcpServer
discoverExternalMcpTools
callExternalMcpTool
```

Handlers IPC:

```text
external-mcp:servers:list
external-mcp:servers:save
external-mcp:servers:remove
external-mcp:tools:discover
external-mcp:tools:call
```

O registry mascara `env`/`headers` na leitura publica, preserva secrets na leitura interna, mantem valores reais quando a UI reenviar um segredo mascarado, reseta o runtime da capability ao salvar/remover servidor e audita eventos de save/remove/discovery/call.

Ao salvar ou remover servidor, o cache daquele servidor e invalidado para evitar exibir tools de uma configuracao antiga.

## Politica granular por risco

Foi criado o servico:

```text
main/services/external_mcp_tool_policy_service.js
```

Cada tool descoberta passa a receber:

- `permission`;
- `riskLevel`;
- `riskPolicy`;
- `blockedReason`.

A politica por servidor cobre:

- `maxRiskLevel`;
- `blockedRiskLevels`;
- `allowedPermissions`;
- `requireExplicitAllowForHighRisk`.

O classificador usa `annotations.riskLevel`, `annotations.permission`, hints destrutivos e heuristicas de nome/descricao. Bloqueios explicitos em `blockedTools` continuam tendo prioridade semantica sobre allowlist ou risco inferido.

Correcoes adicionadas nesta rodada:

- `openWorldHint` em tool read-only e tratado como risco medio, nao critico;
- a palavra "format" em descricoes como `owner/repo format` nao dispara risco critico;
- `destructiveHint` continua critico.

## Politica por escopo, diretorio e rede

A politica por servidor agora cobre:

- `scopePolicy.enforceProjectRoot`;
- `scopePolicy.allowedDirectories`;
- `scopePolicy.blockedDirectories`;
- `scopePolicy.allowExternalNetwork`;
- `scopePolicy.allowedNetworkHosts`;
- `scopePolicy.blockedNetworkHosts`.

Antes de `tools/call`, a bridge inspeciona argumentos externos com nomes como `path`, `artifactPath`, `directory`, `root`, `url`, `endpoint` e `host`.

Resultado:

- paths absolutos fora de `projectSession.rootPath` sao bloqueados;
- paths relativos sao resolvidos contra a raiz autorizada;
- diretorios bloqueados impedem a chamada mesmo quando a tool esta aprovada;
- URLs/hosts externos sao bloqueados quando nao estiverem na allowlist de rede;
- o servidor externo continua sem receber `projectSession` nos argumentos, exceto por opt-in explicito.

## Transportes reais

### `stdio`

O transporte `stdio` inicia um processo externo com `spawn`, sem shell, e conversa por JSON-RPC line-delimited:

- `initialize`;
- `notifications/initialized`;
- `tools/list`;
- `tools/call`;
- timeout por request;
- coleta de `stderr`;
- fechamento controlado do processo;
- bloqueio quando comando esta ausente.

### `http` / `sse`

O transporte HTTP usa `fetch` com JSON-RPC `POST` e aceita respostas:

- `application/json`;
- `text/event-stream`.

Tambem valida que o endpoint usa `http` ou `https`, aplica timeout por `AbortController` e retorna erro estruturado quando o servidor falha.

## HTTP/SSE contra endpoint real local

Foi criado o smoke opt-in:

```text
npm run smoke:mcp-http-sse
```

Ele sobe um endpoint HTTP local real em `127.0.0.1`, expõe duas rotas:

- `/rpc`: JSON-RPC HTTP;
- `/sse`: resposta `text/event-stream`.

O smoke valida:

- `initialize`;
- `notifications/initialized`;
- `tools/list`;
- `tools/call`;
- chamada HTTP JSON real;
- chamada SSE real;
- `projectSession` nao injetado nos argumentos externos por padrao;
- bloqueio de tool `critical` por politica de risco.

Dentro do sandbox, a tentativa falha com `listen EPERM`. Repetido fora do sandbox com permissao explicita, passou.

## HTTP/SSE contra endpoint publico sem credencial

Foi criado o smoke opt-in:

```text
npm run smoke:mcp-public-deepwiki
```

Ele usa o endpoint publico:

```text
https://mcp.deepwiki.com/mcp
```

O smoke valida:

- `initialize` HTTP/SSE real contra terceiro publico;
- `tools/list` real;
- discovery de `read_wiki_structure`, `read_wiki_contents` e `ask_question`;
- chamada real de `read_wiki_structure` para o repositorio publico `modelcontextprotocol/servers`;
- bloqueio local de argumento `url: https://example.com/...` por politica de rede antes de chamar o servidor.

Resultado confirmado em 2026-05-27:

- discovery retornou 3 tools;
- chamada read-only passou;
- destino de rede externo nao permitido foi bloqueado;
- nenhuma credencial sensivel foi usada.

## Execucao contra MCP oficial externo

Foi criado o smoke opt-in:

```text
npm run smoke:mcp-third-party
```

Ele executa via `npx` o servidor oficial:

```text
@modelcontextprotocol/server-filesystem
```

O smoke configura o servidor como `stdio`, roda discovery real, chama uma tool segura de leitura/listagem e verifica que uma tool de escrita descoberta fica bloqueada por `blockedTools`.

Resultado local confirmado em 2026-05-27:

- servidor oficial iniciou via `npx`;
- discovery real retornou 14 tools;
- chamada segura passou;
- escrita direta permaneceu bloqueada;
- primeira tentativa dentro do sandbox falhou por restricao de rede/cache;
- repeticao com permissao explicita para o smoke passou.

## Smoke visual externo

Foi criado o smoke:

```text
mcp_external_tool_bridge
```

O smoke usa um servidor externo simulado chamado `visual-auditor`, descobre duas tools e executa apenas a permitida:

- `visual.capture`: permitida;
- `filesystem.write`: bloqueada por politica.

O smoke gera um PNG real como artefato visual, analisa pixels para rejeitar captura vazia, registra ledger e usa os `domMetrics` retornados pela tool externa como evidencia em `blueprint_contract.validate`.

Tambem foi criado o smoke:

```text
mcp_external_stdio_visual_bridge
```

Esse smoke executa um servidor MCP externo fixture como subprocesso real via `stdio`, roda `initialize`, `tools/list` e `tools/call`, gera screenshot PNG real, valida pixels nao vazios, bloqueia escrita direta e passa a evidencia visual para `blueprint_contract.validate`.

Resultado confirmado:

- servidor MCP externo listado;
- 2 tools descobertas;
- escrita direta externa bloqueada;
- screenshot PNG nao vazio;
- `blueprint_contract` consumiu evidencia externa e passou com gate `allow`;
- ledger `external_mcp.jsonl` criado com discovery e chamada.
- transporte `stdio` real validado com processo externo;
- transporte HTTP/SSE validado com respostas JSON e event-stream em teste focado.

Smoke visual da UI de configuracao:

- harness local em `localhost`;
- screenshot desktop `1365x768`: `/private/tmp/faber-mcp-settings-ui-desktop.png`;
- screenshot mobile `390x844`: `/private/tmp/faber-mcp-settings-ui-mobile.png`;
- discovery visual de tools exibindo permitidas e bloqueada;
- mobile sem overflow horizontal (`scrollWidth: 390`, `innerWidth: 390`).

Smoke visual da UI avancada:

- screenshot desktop `1365x768`: `/private/tmp/faber-mcp-settings-advanced-desktop.png`;
- screenshot mobile `390x844`: `/private/tmp/faber-mcp-settings-advanced-mobile.png`;
- campos visiveis para timeout, risco maximo, permissoes, riscos bloqueados, `env`, `headers`, exigencia de allowlist para alto risco e injecao explicita de `projectSession`;
- chips de discovery exibem tool, risco, permissao e motivo de bloqueio;
- mobile sem overflow horizontal (`scrollWidth: 390`, `innerWidth: 390`).

Smoke visual da UI com cache/politicas:

- harness local em `/private/tmp/faber-mcp-settings-cache-policy-smoke.html`;
- screenshot topo desktop `1365x768`: `/private/tmp/faber-mcp-settings-cache-policy-desktop.png`;
- screenshot lista/cache desktop `1365x768`: `/private/tmp/faber-mcp-settings-cache-policy-list-desktop.png`;
- screenshot lista/cache viewport estreito `500x844`: `/private/tmp/faber-mcp-settings-cache-policy-list-mobile-500.png`;
- cache visual exibiu DeepWiki Public MCP com 3 tools e Official Filesystem MCP com 4 tools;
- metricas DOM confirmaram `hasHorizontalOverflow: false`, `scrollWidth === innerWidth` e 2 titulos de cache;
- analise de PNG confirmou screenshots nao vazios (`sampledColors` entre 100 e 124).

A validacao visual encontrou um corte responsivo nos botoes do card de servidor em viewport estreito. O CSS foi ajustado para empilhar acoes de MCP em mobile e permitir wrap dos controles.

## Testes adicionados

Novos testes:

```text
tests/external-mcp-transports.test.js
tests/external-mcp-bridge-service.test.js
tests/external-mcp-tool-policy-service.test.js
tests/external-mcp-server-registry-service.test.js
tests/external-mcp-discovery-cache-service.test.js
tests/external-mcp-handlers.test.js
tests/external-mcp-http-sse-endpoint-smoke.test.js
tests/external-mcp-third-party-smoke.test.js
tests/external-mcp-public-deepwiki-smoke.test.js
```

Atualizacoes:

- `tests/faber-capability-adapter-service.test.js`;
- `tests/preload-api-contract.test.js`;
- `tests/renderer-ai-settings.test.js`;
- `tests/support/smoke_scenario_runner.js`;
- `tests/smoke-scenarios.test.js`;
- `package.json`.

`npm run test:mcp-capabilities` agora inclui:

- `npm run test:mcp-transports`;
- `npm run test:mcp-policy`;
- `npm run test:mcp-server-registry`;
- `npm run test:mcp-discovery-cache`;
- `npm run test:mcp-ipc`;
- `npm run test:mcp-external`;
- smoke `mcp_external_tool_bridge`.
- smoke `mcp_external_stdio_visual_bridge`.

## Validacoes executadas

Passaram nesta rodada:

```bash
node --check main/services/external_mcp_bridge_service.js
node --check main/services/external_mcp_stdio_transport_service.js
node --check main/services/external_mcp_http_transport_service.js
node --check main/services/external_mcp_transport_factory_service.js
node --check main/services/external_mcp_tool_policy_service.js
node --check main/services/external_mcp_server_registry_service.js
node --check main/services/external_mcp_discovery_cache_service.js
node --check main/ipc/external_mcp_handlers.js
node --check main/services/faber_capability_adapter_service.js
node --check main.js
node --check preload.js
node --check renderer/ai_settings_mcp_panel.js
node --check renderer/ai_settings_controller.js
node --check tests/support/smoke_scenario_runner.js
node --check tests/fixtures/external_mcp_stdio_visual_server.js
node --check tests/external-mcp-transports.test.js
node --check tests/external-mcp-bridge-service.test.js
node --check tests/external-mcp-tool-policy-service.test.js
node --check tests/external-mcp-server-registry-service.test.js
node --check tests/external-mcp-discovery-cache-service.test.js
node --check tests/external-mcp-handlers.test.js
node --check tests/external-mcp-http-sse-endpoint-smoke.test.js
node --check tests/external-mcp-third-party-smoke.test.js
node --check tests/external-mcp-public-deepwiki-smoke.test.js
npm run test:preload-api-contract
npm run test:renderer-ai-settings
npm run test:mcp-policy
npm run test:mcp-transports
npm run test:mcp-server-registry
npm run test:mcp-discovery-cache
npm run test:mcp-ipc
npm run test:mcp-external
npm run test:mcp-capability-adapter
npm run smoke:mcp-http-sse
npm run smoke:mcp-third-party
npm run smoke:mcp-public-deepwiki
SMOKE_SCENARIOS=mcp_external_tool_bridge node tests/smoke-scenarios.test.js
SMOKE_KEEP_ARTIFACTS=1 SMOKE_SCENARIOS=mcp_external_tool_bridge node tests/smoke-scenarios.test.js
SMOKE_SCENARIOS=mcp_external_stdio_visual_bridge node tests/smoke-scenarios.test.js
SMOKE_KEEP_ARTIFACTS=1 SMOKE_SCENARIOS=mcp_external_stdio_visual_bridge node tests/smoke-scenarios.test.js
npm run test:mcp-capabilities
```

## Limite honesto

Esta rodada avanca o MCP externo de forma real dentro da arquitetura do Faber Code, mas ainda nao fecha a frente completa.

Ainda faltam:

1. Presets guiados/registry externo de servidores para reduzir a necessidade de configuracao manual.
2. Rotacao/limpeza de secrets e validacao de headers/env por provider.
3. Politicas humanas mais finas para risco alto por workspace/time.
4. Testes contra endpoints privados/autenticados sem expor segredo.
5. Observabilidade de conexoes long-lived SSE quando o servidor exigir sessao persistente.

Estimativa operacional apos esta rodada:

- MCP/capability layer local: continua em `91-94%`;
- MCP externo: sobe de `40-46%` para aproximadamente `86-89%`.

O principal salto foi sair do fixture controlado e cobrir as bordas de governanca: agora existe bridge governada, transportes reais, registry persistente, cache visual de discovery, UI avancada de configuracao, subprocesso MCP via `stdio`, endpoint HTTP/SSE real local, endpoint HTTP/SSE publico sem credencial, ledger, smoke visual, politica granular por risco/escopo/diretorio/rede e execucao contra servidor MCP oficial de terceiro. O proximo salto deve focar presets, registry externo de servidores, endpoints autenticados e UX de configuracao menos tecnica.
