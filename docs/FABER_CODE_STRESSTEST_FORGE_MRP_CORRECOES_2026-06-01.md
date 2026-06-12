# Faber Code - Stresstest Forge MRP, contratos flexiveis e validacao ponta a ponta

Data: 2026-06-01
Base da rodada: `2c2ad95 security: harden AI trust boundary and Git flows`
Status: implementado localmente, validado e preparado para commit

## Objetivo

Esta rodada partiu de um stresstest real no Faber Code com o projeto Forge MRP. O pedido do usuario era complexo: criar uma aplicacao Next.js completa para planejamento de requerimentos de materiais, com regras de negocio, estado finito, estoque, BOM, ordens de producao, MRP, auditoria, testes e interface tecnica.

O resultado inicial mostrou falhas importantes:

- o intake podia antecipar criacao antes do briefing completo;
- pedidos complexos podiam cair em scaffold visual rigido demais;
- o preview podia falhar por dependencia nao instalada ou erro runtime;
- a validacao visual podia bloquear indevidamente uma correcao tecnica de runtime/teste;
- a ferramenta gerada nao conseguia executar testes por `structuredClone`;
- o preview Next podia quebrar por uso de browser globals ou hidratacao instavel;
- apps operacionais eram avaliados com criterios de landing page, como CTA ou formulario de contato.

O criterio da rodada foi manter o loop:

```text
Teste -> Correcao -> smoke como usuario -> validacao visual/screenshot -> Teste
```

## Decisao de produto

A principal decisao foi separar melhor dois modos:

1. **Blueprint/scaffold minimo** para projetos simples, sites e composicoes previsiveis.
2. **Contrato flexivel e arquitetura guiada** para solicitacoes complexas, nas quais a IA/MCP precisa modelar dominio, arquivos, testes, runtime e reparos incrementais sem repetir sempre a mesma receita visual.

Isso nao significa liberdade sem controle. A liberdade nova continua governada por:

- intake canonico;
- contratos de produto;
- policy gate;
- build mode router;
- validacao tecnica;
- validacao visual adequada ao tipo de produto;
- confirmacao do usuario antes de aplicar alteracoes;
- barreiras de seguranca para conteudo externo e capacidades privilegiadas.

## Correcoes no Faber Code

### Intake e contratos para pedidos complexos

O intake e os contratos passaram a reconhecer melhor quando um pedido pede ferramenta/aplicacao operacional, e nao landing page ou scaffold generico.

Arquivos principais:

- `cortex/orchestration/product_intake_service.js`
- `cortex/orchestration/product_contract_service.js`
- `cortex/orchestration/product_policy_gate_service.js`
- `cortex/orchestration/product_route_scoring_service.js`
- `cortex/orchestration/build_mode_router_service.js`
- `main/services/cortex_product_runtime_contract_service.js`
- `main.js`

Efeito esperado:

- briefing complexo nao deve ser comprimido em visual generico;
- reparo tecnico explicito deve acionar rota de patch/reparo, nao diagnostico vazio;
- memoria/contexto antigo nao deve dominar uma solicitacao atual;
- pedidos de arquitetura de software/MCP nao devem ser confundidos com site de arquitetura;
- sites legitimos de arquitetura continuam reconhecidos como dominio `architecture`.

### Preview e diagnostico runtime

O preview passou a lidar melhor com projetos gerados por IA:

- detecta imports usados mas nao declarados;
- prepara etapa de instalacao de dependencias do preview;
- diagnostica falhas runtime/build como reparaveis;
- adiciona servico dedicado de diagnostico de preview;
- evita falso positivo quando o preview ainda nao carregou por dependencia ou runtime.

Arquivos principais:

- `main/services/project_preview_service.js`
- `main/services/project_preview_runtime_service.js`
- `main/services/project_preview_diagnostic_service.js`
- `main/services/project_visual_validation_runtime_service.js`

### Qualidade de artefato Next/App Router

Foram adicionadas regras para detectar codigo incompativel com SSR/hidratacao, especialmente browser globals em escopo de modulo.

Arquivos principais:

- `cortex/orchestration/artifact_quality_service.js`
- `cortex/orchestration/render_pass_service.js`

Efeito esperado:

- `document`, `window` e efeitos de browser nao devem aparecer no escopo de modulo de paginas Next;
- o render pass orienta a IA a mover CSS/DOM side effects para locais seguros;
- falhas de preview por runtime devem gerar reparo, nao conclusao falsa.

### Patches deterministicos de runtime/teste

Foi criada rota deterministica para corrigir falhas tecnicas especificas sem gastar uma nova composicao generica.

Novos contratos:

- `deterministic_next_browser_global_module_patch`
- `deterministic_structured_clone_compat_patch`

Arquivos principais:

- `main/services/deterministic_edit_service.js`
- `main/services/deterministic_edit_safety_service.js`
- `cortex/orchestration/product_contract_service.js`

Efeito esperado:

- erro `structuredClone is not defined` em Jest/Node vira patch local e validavel;
- browser globals em modulo Next viram patch tecnico;
- a validacao visual nao deve bloquear patch que e estritamente de runtime/teste e nao altera superficie visual.

### Validacao visual para ferramenta operacional

Apps como MRP, ERP, CRM, dashboards e ferramentas tecnicas passaram a ser avaliados por superficie operacional, nao por criterios de landing page.

Arquivos principais:

- `cortex/orchestration/visual_product_coverage_service.js`
- `cortex/orchestration/visual_briefing_semantic_service.js`

Efeito esperado:

- nao exigir CTA, formulario de contato ou narrativa de marketing em ferramenta operacional;
- exigir sinais de tabelas, formularios, comandos, estados e dados do dominio quando o briefing pede aplicacao.

### Providers e falhas remotas

Foram reforcados contratos para lidar com falhas de provider, incluindo limite de output, sem transformar falha remota em conclusao enganosa.

Arquivos principais:

- `cortex/providers/provider_failure_service.js`
- `cortex/providers/remote_clients.js`

## Correcoes no Forge MRP gerado

O projeto gerado fora do repositorio recebeu correcoes para validar se a entrega solicitada de fato funcionava:

- fallback para clone serializavel quando `structuredClone` nao existe;
- seed deterministico de IDs e datas;
- formatacao de datas com timezone fixo;
- remocao de side effects de browser no escopo de modulo;
- eliminacao de erro de hidratacao Next;
- validacao manual do fluxo de ordens, MRP e auditoria.

Essas alteracoes no projeto de usuario nao fazem parte do commit do Faber Code, mas foram usadas como evidencia de que o fluxo gerado podia ser executado e validado.

## Smoke manual e evidencias visuais

Foi executado smoke manual no Chrome, sem atalhos internos:

1. abrir o preview do Forge MRP;
2. confirmar que nao havia overlay vermelho de erro Next;
3. localizar estoque, BOM, ordens, calculo MRP e audit log;
4. clicar em `Liberar` na ordem `ASM-900`;
5. confirmar mudanca de `PLANNED` para `RELEASED`;
6. clicar em `Executar MRP`;
7. confirmar tabela de necessidades;
8. confirmar audit log com `ORDER_RELEASED` e `MRP_RUN`.

Screenshots locais nao versionados:

- `forge-mrp-smoke-manual.png`
- `forge-mrp-audit-log.png`

## Resultados de validacao

### Forge MRP

```bash
npm test
npm run build
```

Resultado:

- 1 suite Jest passou;
- 3 testes passaram;
- build Next.js passou;
- rota `/` foi pre-renderizada com sucesso;
- smoke manual confirmou ordem liberada, MRP executado e auditoria registrada.

### Faber Code - testes focados

Foram executados testes focados em:

- intake;
- product orchestrator;
- product toolchain;
- preview service;
- preview runtime;
- preview diagnostic;
- visual validation runtime;
- artifact quality;
- render pass;
- briefing contract;
- runtime contract;
- provider failure;
- remote clients;
- visual product coverage;
- visual briefing semantic;
- build mode router.

Todos passaram depois das correcoes.

### Faber Code - validacoes amplas

```bash
npm run test:ai-trust-boundary
npm run test:render-pass-service
npm run audit:release
npm run test:architecture
npm audit --omit=dev --audit-level=moderate
git diff --check
```

Resultado:

- trust boundary passou;
- render pass passou;
- auditoria publica passou;
- higiene de testes passou;
- `test:architecture` passou completo;
- `npm audit` retornou 0 vulnerabilidades;
- `git diff --check` passou.

Observacoes:

- uma primeira execucao de `npm audit` falhou por DNS bloqueado no sandbox; foi repetida com rede e passou;
- uma primeira execucao de `test:architecture` falhou no sandbox por `listen EPERM` em `127.0.0.1`; foi repetida com permissao local;
- durante a repeticao, a suite encontrou uma regressao real no dominio `architecture`; a heuristica foi corrigida e `test:architecture` passou completo.

## Limites e cuidados restantes

Esta rodada nao significa que todo projeto complexo sera perfeito na primeira tentativa. O novo contrato aumenta a liberdade da IA/MCP, mas continua exigindo:

- briefing canonico antes de criar;
- confirmacao antes de aplicar alteracoes;
- preview real quando houver UI;
- testes do projeto gerado;
- smoke manual quando o produto tiver fluxo operacional;
- validacao visual por screenshots;
- reparos incrementais orientados por diagnostico.

Tambem permanece importante:

- nao tratar RWKV como IA local pronta dentro do Faber Code;
- nao prometer Claude nativo sem provider Anthropic implementado;
- nao publicar projetos de usuario, screenshots locais, `.env`, memorias, caches ou artifacts;
- manter apps operacionais fora de contratos de landing page;
- nao marcar sucesso quando o executor nao alterou arquivos ou quando o preview falhou.

## Proximo foco recomendado

1. Repetir um smoke completo de criacao complexa do zero com app atualizado.
2. Registrar screenshots do Faber Code aplicando patch tecnico sem falso bloqueio visual.
3. Expandir matriz de briefings complexos com MRP, CRM, dashboard, editor visual, ferramenta financeira e app de dados.
4. Continuar hardening de MCP/terminal/publicacao com testes adversarios.
5. Melhorar UX do intake para deixar claro quando o Faber esta aguardando briefing completo antes de executar.
