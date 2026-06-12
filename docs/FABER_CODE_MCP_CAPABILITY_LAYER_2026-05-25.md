# Faber Code - MCP Capability Layer 2026-05-25

Este documento registra a primeira integracao modular MCP-compatible do Faber Code.

## Decisao

O MCP nao substitui Automata, contratos, blueprints, recipes ou gramaticas visuais. Ele entra como camada de capacidades operacionais: maos, olhos e ambiente.

Fluxo correto:

1. Router interpreta o pedido.
2. Automata valida contrato, risco e permissao.
3. Blueprint/recipe define o que deve ser produzido.
4. Capability Layer executa operacoes padronizadas.
5. Validacao consome evidencias reais.

## Modulos adicionados

- `cortex/capabilities/capability_result.js`
- `cortex/capabilities/project_session_contract.js`
- `cortex/capabilities/capability_gateway.js`
- `cortex/tools/capability_tools.js`
- `main/services/faber_capability_adapter_service.js`

## Capacidades iniciais

### `filesystem`

Leitura auditavel de arvore e arquivos do projeto ativo. Nao escreve no disco.

`read_file` valida tanto o caminho logico quanto o caminho real (`realpath`) para bloquear symlinks que apontem para fora da raiz autorizada.

### `terminal`

Operacao do terminal por sessao, com cwd preso a raiz do projeto e retorno estruturado.

### `browser_preview`

Start/status/stop/capture de preview. A captura visual passa a poder gerar evidencias padronizadas por viewport.

Opcoes criticas do adapter local sao preservadas pela capability: `open` permanece falso, `capture` permite preparacao de dependencias, e a execucao prioriza reutilizar preview ativo/servidor existente.

### `git`

Leitura do estado Git do projeto ativo para diagnostico e auditoria.

## Regra de governo

Toda capacidade precisa receber `projectSession` com raiz de projeto. Se o cwd estiver fora da raiz, a capability deve bloquear.

As evidencias retornam no contrato:

- `schemaVersion`
- `capability`
- `action`
- `projectSession`
- `artifacts`
- `logs`
- `warnings`
- `errors`
- `data`

## Integracao com validacao visual

`project_visual_validation_runtime_service` agora aceita `executeBrowserPreviewCapability`.

Quando configurado, o runtime visual usa `browser_preview.capture` como fonte de preview/captura. Isso prepara o caminho para trocar o adapter local por servidor MCP real sem mexer na regra de negocio da validacao.

Quando a action for `capture`, o adapter local pode permitir preparacao/instalacao de dependencias do projeto antes de declarar bloqueio manual de preview. Essa permissao reduz falso negativo em projeto recem-gerado, mas nao altera o contrato: sem captura real disponivel, a validacao visual deve falhar ou ficar pendente de forma honesta.

## O que continua fora do MCP

MCP nao decide:

- dominio do briefing;
- recipe visual;
- contrato de produto;
- policy gate;
- aceitacao estetica;
- promocao de contrato permanente;
- uso de memoria antiga.

Essas decisoes continuam dentro do Cortex/Automata.

## Proximos passos

1. Criar adaptador MCP externo real para browser/Playwright quando a infraestrutura estiver pronta.
2. Levar a matriz visual real para uma suite automatizada com artifact store controlado.
3. Integrar memoria/RAG como capability com provenance e expiracao.
4. Expor diagnostico de capabilities na UI de contratos/execucao.
5. Expandir reparos automaticos de contrato apenas quando houver violacao objetiva e teste dedicado.

## Validacao atual

Testes confirmados para esta camada:

```bash
npm run test:mcp-capabilities
node tests/capability-gateway.test.js
node tests/faber-capability-adapter-service.test.js
node tests/tool-registry.test.js
node tests/project-terminal.test.js
node tests/project-visual-validation-runtime-service.test.js
node tests/project-preview-runtime-service.test.js
node tests/project-visual-capture-service.test.js
node tests/git-service.test.js
```

Estado atual:

- capability layer e MCP-compatible, com smoke dedicado no `package.json` e cobertura core dentro de `test:architecture`;
- filesystem bloqueia escape por path relativo e por symlink realpath;
- browser preview preserva opcoes criticas mesmo quando recebe payload com override;
- gateway bloqueia capability sem `projectSession` valido;
- capability layer ainda nao e servidor MCP externo real;
- Automata continua governando intencao, permissao, risco, contrato, memoria e aceitacao;
- capability layer executa operacoes e devolve evidencias estruturadas;
- persistencia de evidencias por job/projeto existe em `.faber/capabilities/<capability>.jsonl`.

## Atualizacao 2026-05-27: `blueprint_contract`

No commit `ed2fd77 Fortalece MCP como guardiao de contratos`, a capability layer recebeu a action family `blueprint_contract`.

A nova capability adiciona:

- validacao de contrato de blueprint;
- validacao de source policy contra contaminacao de memoria antiga;
- consumo de DOM metrics e artefatos visuais;
- validacao de rotas geradas;
- reparo automatico de violacao responsiva conhecida;
- persistencia de evidencia estruturada;
- sugestao, stage, trial e promocao no Automata Contract Ledger.

Acoes:

```text
validate
repair
suggest
stage
trial
promote
```

O MCP passa a atuar como guardiao/promotor auditavel de contratos, sem substituir Automata ou Cortex nas decisoes de dominio, memoria, recipe, risco e aceite.

Smokes adicionados:

```text
mcp_blueprint_contract_guardian
mcp_blueprint_contract_briefing_matrix
```

Matriz visual real validada fora da suite sintetica:

- `legal`;
- `temporary_music_school`;
- `chocolate`;
- `import_services`;
- desktop/tablet/mobile por caso;
- hamburger obrigatorio abaixo de `1024px`;
- nav desktop obrigatoria a partir de `1024px`;
- zero overflow horizontal;
- zero termos proibidos;
- screenshots nao vazios por pixel check.

Documento dedicado:

```text
docs/FABER_CODE_MCP_CONTRATOS_BLUEPRINTS_2026-05-27.md
```

## Atualizacao 2026-05-27: matriz ampliada de blueprints

No commit `d4a2d91 Amplia diversidade e validacao das blueprints`, a capability `blueprint_contract` foi revalidada com matriz maior de briefings.

O smoke `mcp_blueprint_contract_briefing_matrix` passou a cobrir 9 casos:

- `legal`;
- `temporary_music_school`;
- `chocolate`;
- `import_services`;
- `saas_workspace`;
- `photo_lab`;
- `construction_store`;
- `premium_wine`;
- `dental_clinic`.

Resultado:

- 9 gates `allow`;
- source policy `passed`;
- runtime validation `passed`;
- dominios variados incluindo SaaS, laboratorio fotografico, materiais de construcao, vinho e odontologia.

Essa atualizacao nao muda o limite principal: a capability layer local esta forte e auditavel, mas MCP externo real, discovery multi-servidor e integracoes remotas continuam sendo frente separada.

## Atualizacao 2026-05-27: bridge inicial de MCP externo

Foi criada a capability:

```text
external_mcp
```

Servico:

```text
main/services/external_mcp_bridge_service.js
```

Acoes:

```text
servers
discover_tools
call_tool
```

A bridge registra servidores MCP externos aprovados, executa discovery por `initialize` e `tools/list`, envia `notifications/initialized`, bloqueia tools fora da allowlist ou marcadas em `blockedTools`, mantem `projectSession` separado dos argumentos externos por padrao e persiste evidencia em:

```text
.faber/capabilities/external_mcp.jsonl
```

Smoke adicionado:

```text
mcp_external_tool_bridge
```

O smoke inicial usa um servidor externo simulado de auditoria visual, gera um PNG real como evidencia, valida que a captura nao esta vazia por analise de pixels, bloqueia escrita direta externa e usa os `domMetrics` retornados pela tool externa dentro de `blueprint_contract.validate`.

Na sequencia da mesma frente foram adicionados transportes:

```text
main/services/external_mcp_stdio_transport_service.js
main/services/external_mcp_http_transport_service.js
main/services/external_mcp_transport_factory_service.js
```

O smoke `mcp_external_stdio_visual_bridge` executa um servidor MCP fixture como subprocesso real via `stdio`, valida `initialize`, `tools/list`, `tools/call`, screenshot PNG nao vazio, bloqueio de escrita direta e consumo da evidencia em `blueprint_contract.validate`.

## Atualizacao 2026-05-27: registry, UI e terceiro real

A rodada seguinte adicionou:

```text
main/services/external_mcp_server_registry_service.js
main/ipc/external_mcp_handlers.js
renderer/ai_settings_mcp_panel.js
tests/external-mcp-server-registry-service.test.js
tests/external-mcp-handlers.test.js
tests/external-mcp-third-party-smoke.test.js
```

O app agora possui registry persistente em `userData/external-mcp-servers.json`, IPC/preload para listar/salvar/remover/descobrir/chamar tools e uma tela em Configuracoes para cadastrar servidores `stdio`/HTTP/SSE com allow/block de tools.

O smoke opt-in `npm run smoke:mcp-third-party` executou o servidor oficial `@modelcontextprotocol/server-filesystem` via `npx`, descobriu 14 tools reais, chamou uma tool segura e confirmou que escrita direta segue bloqueada por politica.

Tambem houve smoke visual da UI em desktop e mobile:

```text
/private/tmp/faber-mcp-settings-ui-desktop.png
/private/tmp/faber-mcp-settings-ui-mobile.png
```

No mobile `390x844`, a metrica confirmou ausencia de overflow horizontal.

## Atualizacao 2026-05-27: HTTP/SSE real local e politica granular

A rodada seguinte adicionou:

```text
main/services/external_mcp_tool_policy_service.js
tests/external-mcp-tool-policy-service.test.js
tests/external-mcp-http-sse-endpoint-smoke.test.js
```

A UI de Configuracoes agora permite editar timeout, risco maximo, permissoes permitidas, riscos bloqueados, `env`, `headers`, exigencia de allowlist para alto risco e injecao explicita de `projectSession`.

O registry preserva secrets quando a UI reenviar valores mascarados. A bridge classifica tools por `riskLevel`/`permission`, bloqueia risco `critical` por politica e mostra o motivo de bloqueio no discovery.

O smoke opt-in `npm run smoke:mcp-http-sse` subiu endpoint real local em `127.0.0.1`, validou JSON-RPC HTTP, SSE, `notifications/initialized`, chamada de tool, separacao de `projectSession` e bloqueio por risco.

Screenshots da UI avancada:

```text
/private/tmp/faber-mcp-settings-advanced-desktop.png
/private/tmp/faber-mcp-settings-advanced-mobile.png
```

## Atualizacao 2026-05-27: cache, escopo/rede e endpoint publico

A rodada seguinte fechou tres lacunas do MCP externo:

- cache visual persistente de discovery;
- politicas por escopo/diretorio/rede;
- HTTP/SSE contra endpoint MCP publico sem credencial sensivel.

Novos arquivos principais:

```text
main/services/external_mcp_discovery_cache_service.js
tests/external-mcp-discovery-cache-service.test.js
tests/external-mcp-public-deepwiki-smoke.test.js
```

O cache persiste em `userData/external-mcp-discovery-cache.json` e e anexado na listagem publica de servidores para a UI mostrar tools descobertas, risco, permissao e motivo de bloqueio mesmo antes de um novo discovery.

A politica `scopePolicy` adiciona:

- `enforceProjectRoot`;
- `allowedDirectories`;
- `blockedDirectories`;
- `allowExternalNetwork`;
- `allowedNetworkHosts`;
- `blockedNetworkHosts`.

Antes de `tools/call`, a bridge bloqueia paths fora de `projectSession.rootPath`, diretorios proibidos e destinos de rede nao permitidos. O `projectSession` continua fora dos argumentos externos por padrao.

O smoke opt-in:

```text
npm run smoke:mcp-public-deepwiki
```

validou o endpoint publico `https://mcp.deepwiki.com/mcp`, descobriu 3 tools reais, chamou `read_wiki_structure` contra `modelcontextprotocol/servers` e confirmou bloqueio local de URL externa nao permitida.

Limite restante: ainda faltam presets/guias para reduzir configuracao manual, registry externo/marketplace de servidores, rotacao de secrets e testes contra endpoints privados/autenticados sem expor credenciais.
