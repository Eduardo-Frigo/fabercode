# Faber Code - Handoff de Continuidade

Data: 2026-05-19  
Projeto: `localcode-studio` / Faber Code  
Licenca publica atual: Apache 2.0  
Node definido no repositório: `24.15.0`

## Objetivo deste documento

Registrar o estado atual do desenvolvimento para continuar o trabalho em uma nova conversa sem perder o contexto arquitetural, as decisões tomadas e os pontos que ainda precisam ser fechados.

O objetivo principal do Faber Code e ser uma ferramenta Electron de desenvolvimento assistido por IA, capaz de criar, editar, diagnosticar, executar e validar projetos de software de maneira segura, contextual e integrada ao projeto selecionado.

## Estado atual resumido

Arquitetura geral: 91% integra  
Arquitetura de UI: 100% encaminhada  
Arquitetura de produto/orquestracao: 88% encaminhada  
Backend/login/midia: 82% encaminhado  
Executor/Automata/validacao: 86% encaminhado  
Produto validado em uso real: cerca de 70-75%

A UI foi considerada arquiteturalmente fechada para este ciclo. O foco atual saiu de refinamentos visuais e passou para a arquitetura do produto: como o Faber Code entende pedidos humanos, decide o modo de construcao, usa IA, usa blueprints, edita projetos existentes, aplica imagens/icones e valida o resultado.

## Arquitetura atual da aplicacao

O projeto segue uma arquitetura Electron com fronteiras principais:

- `main.js`: processo principal Electron, orquestracao de janela, handlers principais e runtime de execucao.
- `preload.js`: ponte segura entre renderer e main.
- `renderer/`: UI modularizada da aplicacao.
- `main/ipc/`: handlers IPC por dominio.
- `main/services/`: servicos do produto e da plataforma.
- `cortex/`: camada de IA, orquestracao, contratos, memoria, providers e automata.
- `tests/`: testes de contrato, arquitetura, renderer, orquestracao e servicos.
- `docs/`: documentacao de continuidade e release.

## Estado da UI

A UI foi reorganizada para reduzir o antigo monolito visual. Os modulos principais incluem:

- `renderer/app_state.js`
- `renderer/account_gate.js`
- `renderer/chat_composer.js`
- `renderer/project_sidebar.js`
- `renderer/project_tools.js`
- `renderer/project_terminal.js`
- `renderer/project_file_tree.js`
- `renderer/project_file_editor.js`
- `renderer/panel_layout.js`
- `renderer/ui_appearance.js`
- `renderer/i18n.js`
- `renderer/job_progress.js`
- `renderer/cortex_controller.js`

Decisoes de UI ja assumidas:

- O usuario deve ser forçado a logar antes de usar a plataforma.
- A tela de login deve ser simples: login por email ou Google.
- Ao selecionar email, os botoes iniciais somem e aparece apenas o formulario de email/senha ou criacao de conta.
- Login por Google usa identidade visual neutra, com logo do Google, sem botao verde dominante.
- Tema claro/escuro e tamanho de fonte do painel fazem parte das configuracoes.
- Logos e icones precisam se adaptar ao tema claro/escuro.
- Terminal integrado fica ligado ao projeto selecionado, com abas e controles sem comprometer a area de arquivos.

## Backend, login e plataforma

Foi iniciada a camada de plataforma para usuario e midia:

- Supabase Postgres foi escolhido como banco remoto.
- Google OAuth foi iniciado.
- O app usa armazenamento seguro local via Keychain para dados sensiveis.
- A arquitetura inclui `platform_account`, `platform_backend`, `platform_media` e `postgres_user_store`.
- Pexels foi escolhido como provedor visual para imagens/videos em blueprints.

Arquivos importantes:

- `main/services/platform_backend_service.js`
- `main/services/platform_account_service.js`
- `main/services/postgres_user_store.js`
- `main/services/platform_media_service.js`
- `main/services/pexels_asset_service.js`
- `main/ipc/account_handlers.js`

Cuidados importantes:

- Nao versionar chaves reais no `.env`.
- O Supabase deve manter RLS ativo com policies adequadas.
- O usuario final nao deve precisar criar propria chave Pexels.
- A chave Pexels da plataforma fica no backend/local runtime controlado, nao exposta na UI.

## Decisao estrutural mais importante

As novas estruturas de produto passam a ser a prioridade. Se limitadores antigos atrapalharem o funcionamento, eles devem ser substituidos. Nomes antigos como `codex`, `automata` ou outros podem continuar existindo, mas como fragmentos internos do Faber Code, nao como limitadores conceituais.

O objetivo e o produto funcionar como ferramenta real de desenvolvimento, nao como uma demo rigida baseada apenas em blueprints fixas.

## Nova arquitetura de produto

Foi implementado o nucleo:

1. Working Brief
2. Build Mode Router
3. Product Policy Gate
4. Trace Tests

Esses blocos formam a nova camada de decisao entre conversa humana, IA, blueprint, executor e validacao.

### Working Brief

Arquivo:

- `cortex/orchestration/working_brief_service.js`

Responsabilidade:

- Traduzir a conversa humana em um contrato tecnico normalizado.
- Extrair intencao, dominio, stack, tipo de projeto, autonomia, estilo, midia, icones e seguranca.
- Lidar com ambiguidade sem travar o usuario.

Exemplos de comportamento esperado:

- Se o usuario disser "faz qualquer coisa", o sistema deve entender alta autonomia e gerar algo mesmo assim.
- Se nao houver dominio nenhum, a regra de fallback e criar sobre baleias jubarte.
- Se o usuario pedir azul e branco, o brief deve transformar isso em paleta tecnica.
- Se o usuario pedir placeholders, o brief deve permitir texto, imagens e icones coerentes escolhidos pela IA/sistema.
- Se o usuario pedir Next.js, o sistema deve considerar Node e criar `.nvmrc`.

### Build Mode Router

Arquivo:

- `cortex/orchestration/build_mode_router_service.js`

Responsabilidade:

- Decidir o modo de construcao correto com base no Working Brief e nos fatos do projeto.

Modos principais:

- `conversation_only`
- `requires_project_selection`
- `initial_blueprint`
- `adaptive_blueprint`
- `guided_app_architecture`
- `existing_project_edit`
- `new_project_area`
- `design_to_code`
- `diagnostic_repair`
- `tool_action`
- `blocked_harmful`

Decisoes importantes:

- Pedido generico de "design system" nao deve ser tratado como design-to-code.
- Design-to-code deve depender de sinais reais como Figma, screenshot, mockup, layout anexado ou referencia visual concreta.
- Midia e icones padrao nao podem, sozinhos, forcar blueprint adaptativa.
- Blueprint adaptativa deve aparecer quando ha autonomia alta, placeholders, dominio defaultado ou sinais explicitos de estilo/midia/icones.

### Product Policy Gate

Arquivo:

- `cortex/orchestration/product_policy_gate_service.js`

Responsabilidade:

- Reconciliar o que a IA sugeriu com os fatos determinicos do produto.
- Priorizar os modos novos sobre heuristicas antigas.
- Preservar uma decisao valida da IA quando ela ja escolheu corretamente.
- Bloquear pedidos nocivos, permitindo revisao apenas quando houver contra-argumento valido.

Comportamentos corrigidos:

- Pedido para adicionar uma nova secao em projeto existente deve virar edicao, mesmo sem regex antiga.
- Blueprint adaptativa tem prioridade sobre fallback legado.
- Uma edicao valida escolhida pela IA nao deve ser sobrescrita por uma heuristica inferior.
- Pedido nocivo deve ser bloqueado de forma rastreavel.

### Product Orchestrator

Arquivo:

- `cortex/orchestration/product_orchestrator_service.js`

Responsabilidade:

- Montar fatos do projeto.
- Construir Working Brief.
- Resolver Build Mode Route.
- Passar o resultado para a IA e para o Policy Gate.

### Assistant Flow

Arquivo:

- `cortex/orchestration/assistant_flow.js`

Responsabilidade:

- Fazer o fluxo da conversa usar a rota de produto antes da Persona quando necessario.
- Manter a decisao de produto no contexto ate chegar ao executor.
- Evitar que o modo `adaptive_blueprint` se perca no caminho.

## Blueprints

Arquivo central:

- `cortex/orchestration/project_blueprint_service.js`

Status:

- Blueprint Next.js/Tailwind existe e gera estrutura base.
- `.nvmrc` e criado.
- O problema de `@import` no CSS foi tratado com normalizacao de ordem.
- Conteudos de advocacia e baleias jubarte existem como perfis.
- Ainda precisa evoluir para ser menos repetitiva e mais aderente ao pedido do usuario.

Direcao correta:

- Blueprints nao devem ser rigidas.
- Para projetos simples, usar blueprint adaptativa.
- Para apps complexos, stacks especificos, Figma/design-to-code ou funcionalidades tecnicas, usar arquitetura guiada pela IA antes de gerar arquivos.
- A IA deve definir detalhes de placeholder: textos, cores, queries Pexels, orientacao de imagem, cor dominante e icones.
- O Faber Code deve fornecer a estrutura tecnica segura e validar o resultado.

## Midia e icones

Pexels:

- Usado para imagens/videos coerentes com o projeto.
- Deve receber query, orientacao e cor quando possivel.
- Exemplo: site azul e branco pode pedir imagem com cor azul e orientacao `landscape`.

Arquivo:

- `main/services/pexels_asset_service.js`

Icones:

- A direcao atual e usar icones livres/localmente disponiveis, preferencialmente via biblioteca ja integrada.
- Para blueprints web, usar icones coerentes com o dominio.

Arquivo:

- `cortex/orchestration/blueprint_icon_registry.js`

## Segurança e manifesto permitido

Foi definida a intencao de criar um manifesto permissivo, mas com bloqueio claro para usos nocivos ou criminosos.

Direcao:

- Nao bloquear areas cinzas automaticamente.
- Bloquear quando houver indicio de desenvolvimento nocivo.
- Permitir revisao/force apenas se a contra-argumentacao do usuario for valida no contexto.
- Registrar a decisao no trace para auditoria.

## Testes criados/atualizados

Testes diretamente relacionados a nova arquitetura:

- `tests/working-brief-service.test.js`
- `tests/build-mode-router-service.test.js`
- `tests/product-trace-contract.test.js`
- `tests/product-orchestrator-service.test.js`
- `tests/product-toolchain-contract.test.js`
- `tests/project-blueprint-service.test.js`
- `tests/pexels-asset-service.test.js`
- `tests/blueprint-icon-registry.test.js`
- `tests/assistant-flow.test.js`

Comando validado:

```bash
npm run test:architecture
```

Resultado:

- A suite arquitetural completa passou.
- O primeiro run falhou apenas no sandbox porque o teste de backend tentou abrir `127.0.0.1` e recebeu `EPERM`.
- Rodando fora do sandbox, `test:platform-backend` passou.
- Rodando fora do sandbox, `npm run test:architecture` passou completo.

## Bugs e dores identificadas nos smoke tests anteriores

Pontos que motivaram a nova arquitetura:

- A IA conversava, mas nem sempre gerava resultado.
- A blueprint inicial repetia o mesmo site e ignorava cores/fontes.
- O executor nao estava sempre automatizando `npm install`.
- Preview podia abrir antes do servidor estar pronto.
- CSS quebrou com `@import` depois de regras, causando erro no Next/Turbopack.
- A IA nao diferenciava bem criar novo projeto, editar projeto existente, adicionar area nova ou fazer alteracao pequena.
- O sistema tratava pedidos ambiguos de forma rigida demais.
- Havia conflito entre heuristicas antigas e a intencao real do usuario.

## Principios definidos para seguir

1. IA conversa primeiro quando a linguagem humana estiver ambigua.
2. O usuario impaciente nao deve ser forçado a responder perguntas demais.
3. Se o usuario for indiferente, o Faber Code deve criar algo coerente.
4. Se nada for especificado, o fallback criativo e baleias jubarte.
5. Projetos com arquivos existentes devem ser tratados como projetos existentes, nao como projetos novos.
6. A IA deve agir como dev ao editar projeto existente: entender arquivos, contexto e impacto.
7. Blueprints devem fornecer estrutura tecnica segura, mas permitir injecoes de IA.
8. Pexels e icones fazem parte do contrato do produto, nao sao enfeites opcionais.
9. O executor deve instalar, rodar, validar, diagnosticar e reparar quando possivel.
10. O resultado final deve passar por validacao tecnica e visual antes de ser considerado bom.

## Proximo passo recomendado

Antes de novos smoke tests visuais, fechar a arquitetura de produto em cima dos seguintes pontos:

1. Amarrar o Working Brief diretamente no gerador adaptativo de blueprint.
2. Garantir que cores, fontes, midia Pexels e icones sejam aplicados de fato nos arquivos.
3. Automatizar o plano de runtime para projetos Node:
   - detectar `package.json`;
   - rodar `npm install` quando necessario;
   - iniciar preview;
   - aguardar porta ativa;
   - abrir preview apenas quando estiver pronto.
4. Criar testes de trace para:
   - site azul/branco com Pexels azul;
   - site com fonte Google sem quebrar CSS;
   - edicao incremental em projeto existente;
   - novo bloco/secao em app existente;
   - pedido vago gerando baleias jubarte;
   - pedido nocivo bloqueado.
5. So depois voltar para smoke tests reais no app.

## Como iniciar em uma nova conversa

Prompt sugerido para continuar:

```text
Vamos continuar o Faber Code a partir do handoff em docs/FABER_CODE_HANDOFF_2026-05-19.md.

Prioridade: fechar a arquitetura de produto. A UI esta considerada 100% neste ciclo.

As novas estruturas Working Brief, Build Mode Router, Product Policy Gate e Trace Tests sao a fonte de verdade. Se heuristicas antigas, codex, automata ou blueprints legadas atrapalharem, substitua ou adapte mantendo compatibilidade apenas quando ajudar.

Objetivo imediato: fazer a blueprint adaptativa realmente aplicar contrato de cores, fontes, imagens Pexels, icones e runtime Node com validacao.

Antes de alterar, leia o handoff, rode os testes relevantes e mantenha a arquitetura organizada.
```

