# Faber Code: Progresso de UI/UX, Ícones Premium e Layout de Painéis (15/Jun/2026)

Este documento registra as melhorias visuais e funcionais implementadas no **Faber Code** para aprimorar a experiência de desenvolvimento guiado no **Mapa da Aplicação**, na **Barra Lateral de Projetos** e no **Painel de Ações** (rodapé lateral).

---

## 1. Melhorias de UI/UX e Estética Visual

### 1.1 Ícones Premium Vetoriais (SVG)
- **Substituição de Unicode Faint/Broken**: Substituímos os caracteres Unicode `⋯` (Opções de Projeto) e `✎` (Editar Conversa) no painel lateral de projetos por **vetores SVG customizados, com bordas limpas e de alto contraste**.
- **Consistência de Rendering**: Isso elimina o risco de ícones vazios ou em formato de caixas (`□`) dependendo da fonte instalada no sistema operacional (macOS, Windows ou Linux).
- **Adequação de Testes**: Atualizamos a suite de testes unitários da sidebar para refletir o novo DOM hierárquico com o subheader "CONVERSAS".

### 1.2 Barra de Ações Sempre na Base (Bottom)
- **Correção de Salto**: Corrigimos o comportamento onde a barra de ações (`#workspace-actions-region`) subia para o topo do painel direito quando as Milestones ou o Chat do Mapa eram exibidos.
- **Rearranjo do Runtime**: Reordenamos o item `'automations'` para o final de `TOOL_ORDER` e de todas as configurações de `ZONE_ORDER` no arquivo `renderer/workspace_layout_runtime.js`.
- **Resultado**: A barra de rodapé com as ferramentas de atalho (Arquivos, Git, Terminal, Milestones, Executar) agora permanece **estritamente na base** do painel direito, independentemente do painel ativo.

### 1.3 Sinalização Visual de Ferramenta Ativa
- **Estilo de Destaque**: Criamos a estilização da classe `.project-panel-btn.active` em `renderer/styles/workspace-tools.css` usando a cor verde esmeralda do Faber Code (`#50c985`), fundo translúcido e bordas refinadas.
- **Sincronização de Estado**:
  - O botão de **Arquivos** (`#btn-project-files`) agora sinaliza corretamente quando os arquivos do projeto estão em exibição padrão.
  - O botão de **Terminal** (`#btn-project-terminal`) liga/desliga sua classe `.active` dinamicamente conforme o terminal em lightbox é aberto ou fechado em `renderer/project_terminal.js`.
  - O botão de **Milestones** (`#btn-project-milestones`) destaca-se em verde quando a aba de Milestones está ativa.

---

## 2. Recursos e Funcionalidades do Mapa da Aplicação

### 2.1 Drag & Drop de Imagens no Canvas
- Listener adicionado aos eventos `dragover` e `drop` no canvas principal do Mapa da Aplicação.
- O usuário pode arrastar qualquer imagem de referência de seu computador e soltá-la em um ponto livre do canvas: a imagem é importada para a pasta `references/` do projeto ativo e um card de imagem correspondente é gerado na coordenada exata da soltura.

### 2.2 Cards de Imagem Limpos
- Escondemos o título, descrição e badges textuais do card de imagem quando há uma imagem carregada nele (adicionando a classe `.has-image`). A imagem de referência passa a ocupar 100% da área útil do card de maneira limpa.

### 2.3 Inspector e Edição sob Demanda
- Adicionamos o botão de lápis de edição em cada card renderizado.
- A barra lateral de detalhes (inspector) agora abre **somente sob clique no lápis de edição**, evitando aberturas indesejadas por cliques normais de arrasto ou movimentação de cards.

### 2.4 Lógica Click-to-Connect
- Implementamos o modo `connect` na barra inferior: o primeiro clique em um card o marca como origem (destacando-o em tracejado verde), e o clique em outro card estabelece a linha de conexão, retornando ao modo seleção de forma intuitiva.

---

## 3. Suite de Validações e Testes Unitários

Todos os testes unitários integrados foram validados localmente com sucesso absoluto:

- **Preferences, Builder & Runtime de Workspace**:
  ```bash
  npm run test:renderer-workspace-layout
  ```
  ➔ **PASSED** (Testes de layout de tela, atalhos de janelas e ordem de carregamento).

- **Sidebar de Projetos**:
  ```bash
  node tests/renderer-project-sidebar.test.js
  ```
  ➔ **PASSED** (Testes de seleção, criação de conversas e não-colapso sob áreas vazias).

- **Serviço do Mapa da Aplicação**:
  ```bash
  node tests/application-map-service.test.js
  ```
  ➔ **PASSED**
