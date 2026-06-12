# Faber Code - Blueprints Diversidade Visual e Validacao 2026-05-27

Este documento registra a rodada em que as blueprints do Faber Code ganharam mais diversidade de composicao, elementos compartilhados e validacao ampliada por briefing, contratos e smoke visual real.

Nao registra deploy publico. A publicacao externa continua dependendo de pedido explicito.

## Estado confirmado

- Branch local: `main`
- Commit tecnico registrado: `d4a2d91 Amplia diversidade e validacao das blueprints`
- Commit documental anterior: `45ec6bb Documenta status MCP e blueprints`
- Data do ciclo: 2026-05-27
- Foco: qualidade geral das blueprints, versatilidade visual, headers, icones, testimonials, footers, contratos temporarios MCP e smoke visual desktop/tablet/mobile.

## Objetivo da rodada

O objetivo foi atacar a sensacao de que as blueprints estavam gerando composicoes muito parecidas, especialmente no topo das paginas, e transformar essa preocupacao em contrato, teste e evidencia visual.

Pontos pedidos:

- testar hero full width e composicoes diferentes;
- validar desktop, tablet e mobile;
- melhorar areas de icones, testimonials, headers e footers;
- testar briefings de finalidades diferentes;
- fazer loop de ajuste, teste, smoke visual, correcao e novo teste;
- garantir que as blueprints conversem com contratos e contratos temporarios do MCP.

## Mudancas principais

### Primitivas visuais compartilhadas

Foram fortalecidas primitivas reutilizaveis em:

```text
cortex/orchestration/project_blueprint_template_utils.js
```

Primitivas adicionadas/fortalecidas:

- `BlueprintResponsiveHeader`;
- `BlueprintIconBadge`;
- `BlueprintTestimonialProof`;
- `BlueprintFooterUtility`.

Garantias atuais:

- header responsivo usa hamburger ate tablet e nav desktop somente em `lg`;
- menu mobile/tablet tem altura limitada e `overflow-y-auto`;
- marca reserva espaco para hamburger em mobile;
- icones tem dimensoes estaveis;
- testimonials usam layout com card destacado em tablet/desktop;
- footer usa grid responsivo para mobile, tablet e desktop;
- footer aceita `backgroundColor` para patch deterministico sem duplicar rodape.

### Renderers atualizados

As blueprints passaram a usar as primitivas nos renderers Next principais:

- `project_blueprint_next_templates.js`;
- `project_blueprint_next_page_renderers.js`;
- `project_blueprint_visual_next_renderers.js`.

Familias cobertas:

- default modular/editorial;
- produto sustentavel;
- servico tecnico B2B;
- importacao/logistica;
- SaaS operacional;
- vinho premium;
- chocolate sensorial;
- materiais de construcao;
- hub editorial;
- laboratorio fotografico;
- atelier/couro;
- portfolio/revestimentos;
- jardinagem/agri-commerce;
- odontologia e veterinaria via copy contextual.

### Inferencia de marca e copy contextual

Foi corrigido o caso em que briefings diretos como "para NexaFlow Desk" ou "para VitraPure" preservavam a marca no shell, mas algumas copies internas ainda usavam fallback generico.

Arquivos:

- `briefing_spec_service.js`;
- `project_blueprint_next_templates.js`;
- `project_blueprint_copy.js`;
- `tests/briefing-spec-service.test.js`.

Tambem foram criadas copies mais especificas para:

- `dental`;
- `veterinary`.

Isso reduziu placeholder generico em clinicas e melhorou adaptabilidade a briefings de saude/servicos.

### Patch deterministico de footer componentizado

O patch deterministico de rodape agora reconhece `BlueprintFooterUtility` existente e edita a invocacao da primitiva em vez de tentar inserir outro `<footer>`.

Arquivo:

```text
main/services/deterministic_edit_transforms.js
```

Resultado:

- pedido como "Insira um rodape com cor contrastante" continua funcionando;
- nao duplica footer;
- preserva arquitetura modular da blueprint;
- `product-toolchain-contract` voltou a passar.

## Testes automatizados adicionados

### `blueprint-composition-diversity.test.js`

Valida diversidade de composicoes, incluindo hero full width, gramaticas visuais e marcadores estruturais por receita.

Resultado confirmado:

```text
13 compositions
12 visual grammars
```

### `blueprint-element-system.test.js`

Valida que familias diferentes usam o sistema compartilhado de:

- header responsivo;
- icones;
- testimonials;
- footer.

Resultado confirmado:

```text
6 element systems
```

### `blueprint-briefing-adaptability.test.js`

Valida muitos briefings diferentes, com dominio, recipe, gramatica, marca, cobertura, source terms e ausencia de termos antigos/proibidos.

Resultado confirmado:

```text
18 briefings
14 recipes
12 visual grammars
```

Briefings cobertos:

- consultoria institucional;
- arquitetura/portfolio;
- propriedade intelectual;
- revestimentos de madeira;
- produto sustentavel;
- servico tecnico B2B;
- vinho premium;
- materiais de construcao;
- SaaS operacional;
- portal editorial;
- chocolate sensorial;
- importacao/logistica;
- laboratorio fotografico;
- jardinagem/agri-commerce;
- couro/atelier;
- escultura em madeira;
- clinica veterinaria;
- clinica odontologica.

## MCP e contratos temporarios

O smoke `mcp_blueprint_contract_briefing_matrix` foi ampliado de 4 para 9 casos.

Casos atuais:

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

```text
9 cases
9 gates allow
```

Dominios validados:

- `legal`;
- `temporary-escola-de-musica-experimental`;
- `chocolate`;
- `import-services`;
- `saas-tool`;
- `photo-lab`;
- `construction-materials-site`;
- `premium-wine-landing`;
- `dental`.

O MCP validou:

- contrato de blueprint;
- `moduleContract`;
- `coverageContract`;
- source policy;
- DOM metrics;
- artefatos visuais;
- ausencia de contaminacao por memoria antiga.

## Smoke visual real da rodada

Foi executado smoke visual real com build Next de producao em 6 briefings diferentes:

| Caso | Dominio | Recipe | Gramatica |
| --- | --- | --- | --- |
| `vitrapure-product` | `sustainable-product-landing` | `consumer-product-catalog-landing` | `consumer-product-mosaic` |
| `atlasport-trade` | `import-services` | `import-service-landing` | `trade-logistics-command` |
| `lumen-photo-lab` | `photo-lab` | `photographic-lab-site` | `sensory-immersive-story` |
| `constrular-store` | `construction-materials-site` | `construction-materials-store-site` | `construction-retail-yard` |
| `aurora-wine` | `premium-wine-landing` | `wine-sensory-landing` | `wine-sensory-cellar` |
| `clinica-sorriso-dental` | `dental` | `modular-starter` | `modular-editorial-default` |

Viewports:

- desktop `1365x768`;
- tablet `820x1180`;
- mobile `390x844`;
- menu mobile aberto.

Resultado:

- 6 apps temporarios gerados;
- 6 builds Next de producao;
- 24 screenshots reais;
- screenshots nao vazios;
- zero overflow horizontal;
- header responsivo correto;
- hamburger em tablet/mobile;
- nav desktop em desktop;
- icones presentes;
- testimonial proof presente;
- footer utility presente;
- cobertura de contrato `100` em todos os 6 casos.

Os artefatos visuais ficaram em diretorio temporario local e nao foram versionados.

## Comandos validados

Passaram nesta rodada:

```bash
npm run test:project-blueprint
npm run test:product-orchestration
npm run test:mcp-capabilities
SMOKE_SCENARIOS=teste_30_import_services_landing,teste_31_helena_architecture_site,teste_32_aurea_ip_patentes,teste_33_linea_bosco_revestimentos,teste_34_vitrapure_garrafas_vidro,teste_35_alumivance_esquadrias_fachadas,teste_36_aurora_di_vento_vinhos,teste_37_materiais_construcao,teste_38_nexaflow_desk_saas,teste_39_voxlumen_revista_editorial,teste_40_cacau_nobre_chocolate,teste_41_atlasport_import_services,teste_42_lumen_lab_photo_lab,wood_sculpture_video_hero,mcp_blueprint_contract_guardian,mcp_blueprint_contract_briefing_matrix,temporary_blueprint_contract_synthesis node tests/smoke-scenarios.test.js
npm run audit:release
git diff --check
```

Tambem passaram `node --check` nos arquivos principais alterados.

## Limite honesto

Esta rodada cobre as blueprints principais e familias visuais atuais por testes automatizados e uma amostra visual real forte.

Ainda nao significa que absolutamente toda combinacao possivel de dominio, media, route pages, hero, tom, copy e contrato tenha screenshot real individual.

Para chegar nisso, o proximo passo deve ser transformar o smoke visual real em suite permanente com artifact store controlado.

## Percentuais atualizados contra "Codex = 100%"

Estimativa operacional apos `d4a2d91`:

| Frente | Estado estimado |
| --- | ---: |
| UX/UI desktop | 88-90% |
| Arquitetura modular | 89-91% |
| Produto/orquestracao | 85-88% |
| Patch seguro deterministico | 88-91% |
| Contratos | 90-93% |
| Validacao visual | 87-90% |
| Memoria ativa/RAG/MemPalace | 72-78% |
| MCP/capability layer | 91-94% local / 40-46% externo |
| Produto total pronto | 82-85% |

## Proximas frentes recomendadas

1. Criar artifact store controlado para screenshots de blueprint por job.
2. Transformar a matriz visual real em suite permanente com retencao e diff de evidencias.
3. Expandir `blueprint_contract.repair` para rotas ausentes, imagens quebradas, source policy incompleta e coverage baixo.
4. Continuar revisao por familia visual com briefings reais e variacoes de media.
5. Criar visao no app para evidencias `.faber/capabilities`.
6. Trabalhar MCP externo real separado da capability layer local.

## Resumo executivo

A rodada `d4a2d91` elevou as blueprints de um conjunto funcional, mas visualmente repetitivo em alguns cenarios, para um sistema mais diverso, componentizado e coberto por testes.

O ganho central foi transformar versatilidade visual em contrato: hoje as blueprints precisam preservar marca, dominio, recipe, gramatica, header responsivo, icones, testimonials, footer, cobertura, source policy e evidencia visual representativa.
