# Relato do Problema: Ícone do Mapa Não Abre o Mapa da Aplicação do Projeto

Data: 2026-07-04

## Contexto

Durante o uso do painel de projetos do Faber Code, o usuário clica no ícone de mapa exibido no card de um projeto na lateral esquerda. A expectativa é que a área central abra imediatamente o Mapa da Aplicação daquele projeto específico.

O comportamento esperado é importante porque cada projeto possui seu próprio mapa, persistido separadamente em `.faber/application-map.json` dentro do `rootPath` do projeto.

## Problema Observado

Ao clicar no ícone do mapa do projeto, a aplicação não abre o Mapa da Aplicação na área central. A tela permanece na home/welcome com a marca FaberCode, dando a impressão de que o botão não executou nenhuma ação.

Na captura enviada pelo usuário, o projeto está listado e selecionado visualmente na lateral esquerda, mas a região central continua exibindo a tela inicial, e não o canvas do mapa.

## Evidências Técnicas

O botão do mapa no card do projeto chama `onSelectProject(id, { initialTab: 'map' })`, o que indica que a intenção correta chega ao fluxo de seleção do projeto.

Arquivo relacionado:

`renderer/project_sidebar.js`

O fluxo de seleção do projeto executa `api.scanProject(project.rootPath)` antes de carregar o mapa. Se esse scan falhar, a função retorna antes de abrir a aba do mapa.

Arquivo relacionado:

`renderer/app_projects.js`

O carregamento do mapa em `application_map.js` depende de `getSelectedProjectInfo()?.rootPath`. Se o `rootPath` ainda não estiver disponível em `selectedProjectInfo`, a função retorna antes de chamar `switchTab('map')`.

Arquivo relacionado:

`renderer/application_map.js`

A persistência por projeto está correta no backend: o mapa é salvo e lido a partir de `.faber/application-map.json` dentro do `rootPath` autorizado do projeto.

Arquivos relacionados:

`main/ipc/application_map_handlers.js`

`main/services/application_map_service.js`

## Causa Provável

A causa provável não é ausência de mapa por projeto. O modelo de dados já trabalha com mapa por `rootPath`.

O problema está no acoplamento entre abrir visualmente a aba do mapa e carregar os dados do mapa. Hoje, a UI só troca para o mapa depois que a seleção do projeto, o scan e a leitura assíncrona do mapa terminam corretamente.

Se qualquer uma dessas etapas falha, demora ou não encontra `selectedProjectInfo.rootPath` no momento esperado, o `switchTab('map')` não é executado. Para o usuário, isso aparece como um clique sem efeito.

## Impacto

O usuário não consegue acessar rapidamente o Mapa da Aplicação pelo ícone do projeto.

O problema bloqueia o tutorial e também prejudica o uso normal da aplicação, porque o mapa é uma ferramenta central para planejamento, referências e estruturação do projeto.

Além disso, como cada projeto possui seu próprio mapa, o fluxo precisa garantir que o mapa aberto corresponda ao projeto clicado, sem reutilizar estado visual ou dados de outro projeto.

## Plano de Correção Proposto

1. Abrir a aba do mapa imediatamente quando `selectProject` receber `initialTab: 'map'`, antes do término do scan e da leitura do mapa.

2. Separar a troca visual de aba do carregamento dos dados do mapa. Primeiro exibir o canvas vazio do projeto, depois carregar `.faber/application-map.json` daquele `rootPath`.

3. Usar o `project.rootPath` da lista de projetos como fallback seguro quando `selectedProjectInfo.rootPath` ainda não estiver pronto.

4. Proteger `loadProjectMap()` com `try/catch`, mantendo a aba do mapa aberta mesmo se a leitura do mapa falhar.

5. Preservar o isolamento por projeto usando sempre `rootPath` nas chamadas `getApplicationMap` e `saveApplicationMap`.

6. Garantir que `lastLoadedMapProjectId` continue descartando respostas assíncronas antigas quando o usuário trocar rapidamente de projeto.

7. Adicionar testes automatizados para validar que o clique no ícone do mapa abre a aba do mapa, que cada projeto carrega seu próprio mapa e que falhas no carregamento não deixam o usuário preso na home.

## Critérios de Aceite

- Clicar no ícone do mapa de qualquer projeto abre imediatamente o canvas do Mapa da Aplicação.

- O mapa carregado pertence ao projeto clicado.

- Alternar entre dois projetos não mistura nós, conexões, viewport ou assets de mapas diferentes.

- Se o arquivo `.faber/application-map.json` não existir, o canvas abre vazio sem erro visual.

- Se a leitura do mapa falhar, a UI permanece no mapa e exibe apenas um estado vazio ou mensagem não bloqueante.

- O tutorial consegue clicar no ícone do mapa e prosseguir sem exigir múltiplos cliques.

## Título Sugerido

Relato do Problema: Ícone do Mapa Não Abre o Mapa da Aplicação do Projeto
