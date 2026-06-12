# Faber Code - Avancos Consolidados em 2026-05-25

Este documento consolida os avancos feitos no Faber Code no ciclo que culminou no commit `30e163c Fortalece contratos e workspace apos smoke tests`.

Ele deve ser lido como registro de engenharia do estado real do projeto, nao como promessa de produto final pronto. Os smoke tests manuais 32 e 33 mostraram falhas importantes de aderencia, memoria antiga e captura visual. As mudancas deste ciclo foram feitas para reduzir essas falhas e criar regressions tests claros antes do proximo smoke manual.

## Estado do repositorio

- Projeto: `<repo-root>`
- Branch: `main`
- Commit consolidado: `30e163c Fortalece contratos e workspace apos smoke tests`
- Alteracoes do commit: 73 arquivos, 7782 insercoes, 295 remocoes
- Deploy/publicacao externa: nao realizada

## Resumo executivo

O Faber Code avancou em quatro frentes principais:

1. Produto/orquestracao: reforco da leitura do briefing atual, contratos de dominio, bloqueio de memoria antiga e fallback generico.
2. Blueprints/site completo: mais dominios cobertos, rotas reais para site completo e receitas especificas para pedidos longos.
3. Preview/validacao visual: separacao entre analise estatica e captura real, com falha honesta quando a plataforma nao consegue ver o preview.
4. Workspace/IDE UX: base modular para layout configuravel, preferencias, paineis recolhiveis e terminal mais profissional.

## Smoke tests 32/33 como origem do ciclo

### Teste 32 - Aurea IP & Patentes

O briefing pedia uma landing page institucional sofisticada para escritorio de propriedade intelectual. O sistema primeiro falhou sem criar nada e depois caiu em blueprint generico sem identidade propria.

Correcao trabalhada:

- dominio `intellectual-property`;
- extracao de marca `Aurea IP & Patentes`;
- copy e secoes especificas para patentes, marcas, busca de anterioridade, redacao de pedido, deposito e protecao internacional;
- bloqueio contra `Escritorio Faber Advocacia`, `Studio Habitat`, `Helena Duarte Arquitetura` e placeholders genericos.

### Teste 33 - Linea Bosco Revestimentos

O briefing pedia site completo para revestimentos de madeira. O sistema reutilizou memoria antiga (`Studio Habitat` / `Helena Duarte Arquitetura`), travou em preview/captura e criou paginas rasas ou fora do dominio.

Correcao trabalhada:

- dominio `wood-finishes`;
- extracao de marca `Linea Bosco Revestimentos`;
- rotas reais para `produtos`, `pisos`, `paineis`, `decks`, `projetos`, `inspiracoes` e `contato`;
- copy especifica para pisos de madeira, paineis ripados, decks, texturas, madeiras e orcamento;
- regressions tests contra memoria antiga.

## Avancos em briefing e contratos

Foi criado `cortex/orchestration/briefing_spec_service.js` para transformar briefings longos em uma especificacao mais objetiva.

Avancos principais:

- extracao de marca a partir de padroes como `Empresa:` e `Escritorio de Patentes:`;
- identificacao de pedido autocontido;
- reducao da influencia de memoria antiga quando o briefing atual e completo;
- inferencia de rotas/paginas esperadas;
- separacao entre continuacao real e contaminacao por historico antigo.

Modulos envolvidos:

- `cortex/orchestration/briefing_spec_service.js`
- `cortex/orchestration/briefing_contract_service.js`
- `cortex/orchestration/working_brief_service.js`
- `cortex/orchestration/briefing_service.js`
- `cortex/orchestration/product_contract_service.js`

## Avancos em blueprints e receitas

Foi criado `cortex/orchestration/project_blueprint_manifest_service.js` e foram reforcadas as receitas em:

- `cortex/orchestration/project_blueprint_copy.js`
- `cortex/orchestration/project_blueprint_layout.js`
- `cortex/orchestration/project_blueprint_next_templates.js`
- `cortex/orchestration/project_blueprint_coverage_contract.js`
- `cortex/orchestration/project_blueprint_request.js`
- `cortex/orchestration/project_blueprint_service.js`

Dominios trabalhados neste ciclo:

- `intellectual-property`
- `wood-finishes`
- `import-services`
- `architecture`

Ganhos concretos:

- site completo pode gerar paginas reais quando o briefing pede multiplas paginas;
- landing page continua sendo pagina unica quando o pedido for landing;
- dominios especificos reduzem queda em layout generico;
- aliases de rotas evitam confundir dominios antigos, como arquitetura, jardinagem e escultura em madeira;
- brand fallback so deve entrar quando o usuario nao especifica marca suficiente.

## Avancos contra fallback generico

Os gates passaram a reconhecer padroes de baixa aderencia, incluindo:

- `Faber Projeto`;
- `Atendimento placeholder premium`;
- `conteudo provisorio`;
- `pronta para evoluir`;
- `Uma presenca digital clara para transformar visitantes em contatos`;
- `Studio Habitat`;
- `Helena Duarte Arquitetura`;
- dominio divergente do briefing;
- marca divergente do briefing.

Modulos envolvidos:

- `cortex/orchestration/artifact_quality_service.js`
- `cortex/orchestration/visual_product_coverage_service.js`
- `cortex/orchestration/product_policy_gate_service.js`
- `cortex/orchestration/render_pass_service.js`

## Avancos em preview e validacao visual

A validacao visual foi ajustada para nao tratar aderencia estatica como sucesso visual real.

Avancos principais:

- captura real passa a ser requisito para liberar conclusao visual;
- falha de captura por timeout ou preview bloqueado deve ser reportada honestamente;
- preview manual em `127.0.0.1:3000` pode ser reaproveitado quando disponivel;
- relatorios distinguem validacao tecnica, aderencia estatica e captura real;
- cobertura visual passa a observar secoes prometidas por viewport.

Modulos envolvidos:

- `main/services/project_preview_service.js`
- `main/services/project_preview_runtime_service.js`
- `main/services/project_visual_validation_runtime_service.js`
- `cortex/orchestration/visual_validation_service.js`
- `cortex/orchestration/visual_product_coverage_service.js`

Limite atual:

- a validacao visual ainda nao e uma avaliacao estetica completa;
- captura real pode falhar por runtime, timeout ou preview instavel;
- um novo smoke manual continua obrigatorio para confirmar comportamento fora dos testes automatizados.

## Avancos em auth e tela pos-login

Foi criado `main/services/platform_auth_callback_page_service.js`.

Ganhos:

- tela externa de callback com marca FaberCode;
- mensagem simples: `Login feito com sucesso!` e `Pode fechar essa pagina.`;
- remocao de botao verde que confundia a experiencia;
- separacao da pagina de callback em servico dedicado.

Modulos envolvidos:

- `main/services/platform_auth_callback_page_service.js`
- `main/services/platform_backend_service.js`
- `renderer/account_gate.js`
- `renderer/styles/account-gate.css`

## Avancos no workspace e UX de IDE

Foram criados modulos dedicados para layout configuravel:

- `renderer/workspace_layout_preferences.js`
- `renderer/workspace_layout_builder.js`
- `renderer/workspace_layout_runtime.js`
- `renderer/styles/workspace-layout.css`

Ganhos:

- preferencias de workspace com base modular;
- escolha entre modo de uso mais proxima de progressive disclosure;
- paineis laterais com recolhimento mais confiavel;
- area central preservada quando paineis laterais recolhem;
- grid do workspace com colunas explicitamente posicionadas;
- terminal com status, superficie visual mais profissional e base para evoluir.

Correcoes especificas de layout:

- painel esquerdo recolhido nao deve recolher o centro junto;
- painel direito recolhido nao deve apagar a area principal;
- largura armazenada de painel recolhido nao deve virar zero;
- fallback central com marca/estado inicial deve permanecer visivel.

## Avancos em testes

Foram adicionados ou reforcados testes para:

- briefing spec;
- contratos de briefing;
- blueprints por dominio;
- smoke scenarios 32 e 33;
- cobertura visual;
- qualidade de artefato;
- preview runtime;
- validacao visual runtime;
- workspace layout;
- panel layout;
- contrato modular do renderer;
- terminal;
- auth callback.

Validacoes executadas antes do commit:

```bash
node tests/smoke-scenarios.test.js
npm run test:renderer-module-contract
npm run test:product-contract-schemas
npm run test:architecture
```

Resultado: todos passaram.

## Percentuais revisados contra Codex = 100%

Estimativa pos-ciclo, ainda dependente do proximo smoke manual:

| Area | Estimativa |
| --- | ---: |
| UX/UI desktop | 74-77% |
| Arquitetura modular | 84-86% |
| Produto/orquestracao | 66-69% |
| Patch seguro deterministico | 64-66% |
| Contratos | 72-75% |
| Validacao visual | 65-68% |
| Memoria ativa/RAG/MemPalace | 40-43% |
| Produto total pronto | 67-70% |

Leitura: a base arquitetural ficou mais saudavel, mas o produto ainda nao pode ser considerado confiavel em geracao real longa sem novo smoke manual.

## Riscos ainda abertos

- Provider real ainda pode retornar plano invalido ou raso.
- Memoria antiga ainda precisa ser testada em fluxos longos reais.
- Captura visual ainda pode falhar por timeout.
- Validacao visual ainda mede presenca/cobertura melhor do que qualidade estetica.
- Site completo ainda precisa provar que gera paginas profundas, nao apenas rotas.
- Terminal ainda precisa evoluir para abas, historico, comandos salvos e automacoes reais.
- Memoria ativa/RAG/MemPalace continuam abaixo do restante da arquitetura.

## Proximo marco recomendado

O proximo marco tecnico deve ser um smoke manual controlado com:

- briefing Aurea IP;
- briefing Linea Bosco;
- captura real desktop/tablet/mobile;
- verificacao de ausencia de memoria antiga;
- verificacao de rotas reais;
- verificacao de fallback honesto quando preview falhar.

## Atualizacao pos-commit: smoke 34 a 42 e Lumen Lab

Depois do commit `30e163c`, novas mudancas locais continuaram sem commit para ampliar a cobertura modular do produto. O consolidado completo deste estado esta em `docs/FABER_CODE_AVANCOS_COMPLETOS_2026-05-25.md`.

Avancos adicionados apos o commit:

- novos dominios/recipes/gramaticas para produto sustentavel, servicos tecnicos B2B, vinhos premium, materiais de construcao, arquitetura, agro/jardinagem, importacao, food/sensorial, SaaS/ferramenta, conteudo editorial e laboratorio fotografico;
- primeira camada MCP-compatible para `filesystem`, `terminal`, `browser_preview` e `git`;
- integracao de `browser_preview.capture` como fonte de evidencia para validacao visual;
- adapter local permitindo preparar dependencias durante captura antes de declarar bloqueio manual de preview;
- reforco de Pexels para queries contextuais, incluindo `photo-lab`;
- regressions tests 34 a 42;
- correcao especifica da lacuna do Lumen Lab como dominio generico `photo-lab`, nao como contrato permanente da marca ficticia/real do smoke.

Estado de validacao confirmado nesta atualizacao:

```bash
node tests/briefing-contract-service.test.js
node tests/working-brief-service.test.js
node tests/product-orchestrator-service.test.js
node tests/project-blueprint-service.test.js
node tests/pexels-asset-service.test.js
node tests/faber-capability-adapter-service.test.js
node tests/project-visual-validation-runtime-service.test.js
node tests/project-preview-runtime-service.test.js
node tests/tool-registry.test.js
node tests/preload-api-contract.test.js
node tests/build-mode-router-service.test.js
node tests/artifact-quality-service.test.js
npm run test:smoke-scenarios
```

Resultado atual do smoke automatizado:

- `npm run test:smoke-scenarios` passou com 27 cenarios;
- `teste_42_lumen_lab_photo_lab` passou com dominio `photo-lab`, recipe `photographic-lab-site` e gramatica `sensory-immersive-story`;
- o runtime esperado para abrir o app e Node `24.15.0`.

Percentuais estimados apos esta atualizacao, antes do proximo smoke manual:

| Area | Estimativa atual |
| --- | ---: |
| UX/UI desktop | 80-82% |
| Arquitetura modular | 89-90% |
| Produto/orquestracao | 78-80% |
| Patch seguro deterministico | 67-68% |
| Contratos | 82-84% |
| Validacao visual | 74-76% |
| Memoria ativa/RAG/MemPalace | 45-46% |
| Produto total pronto | 75-77% |

O proximo commit deve acontecer apenas depois de smoke manual real e pedido explicito do usuario.
