# FABER CODE — Documentação de Alterações
## Sessão: 2026-06-15 → 2026-06-17

---

## Visão Geral

Esta sessão implementou um conjunto amplo de melhorias de UX, correções de layout e novos recursos ao **Faber Code Studio**, incluindo o chat contextual do mapa da aplicação, painel de Git com rollback, terminal inline convencional, correção de múltiplos bugs de layout, e otimização da árvore de arquivos.

---

## 1. Chat Contextual do Mapa da Aplicação

### Objetivo
Permitir que o usuário converse com a IA sobre o conteúdo do **mapa da aplicação** (cards, grupos, markdowns), sem executar comandos — apenas lendo e auxiliando a documentar o projeto.

### Alterações
**`renderer/application_map.js`**
- Implementação do painel de chat lateral do mapa (`#workspace-map-chat-panel`).
- O chat lê os markdowns presentes no canvas (cards de texto, grupos, notas) e os envia como contexto para a IA.
- Comportamento: sem mensagens automáticas ao iniciar; linguagem natural; foco em documentação e reflexão sobre o projeto.
- Botão de ativação: `#btn-map-ai` no toolbar do mapa.

**`renderer/styles/application-map.css`**
- Estilos do painel `#workspace-map-chat-panel` integrado ao painel lateral direito.
- Visibilidade controlada pela classe `body.mode-map-chat`.
- Textarea de composer e botão de envio estilizados no sistema de design Faber.

**`renderer/index.html`**
- Adicionado `#workspace-map-chat-panel` com composer e área de mensagens.

---

## 2. Layout da Workspace — Correções de Painéis

### 2.1 Botões do Rodapé como Controladores de Modo
Os botões do rodapé (`Arquivos`, `Git`, `Terminal`, `Milestones`) passaram a ser os **controladores exclusivos de qual ferramenta está ativa** no painel da direita — refletindo visualmente com a classe `.active` e alterando o título do painel.

**`renderer/app_events.js`**
- Clique em `#btn-project-files`: ativa modo arquivos, desativa outros modos, expande o painel se contraído.
- Integração com `workspaceLayoutController`: usa `updatePreferences({ rightCollapsed: false })` de forma estruturada.

**`renderer/app.js`**
- `workspaceLayoutController` agora é passado para `createAppEventsController` via `controllers`.

### 2.2 Spacer Vazio no Topo do Mapa (Bug Fix)
**`renderer/styles/workspace-layout.css`**
- Seletor `:has()` atualizado para excluir também elementos `.workspace-runtime-hidden`.
- Regras adicionais por modo (`mode-git`, `mode-terminal`, etc.) forçam `display: none` na `.workspace-center-tools-zone` quando a única ferramenta visível seria a região de arquivos — que nesses modos está oculta.

### 2.3 Cabeçalho do Painel Direito — Sem Sobreposição
**`renderer/styles/workspace-layout.css`**
- `.panel-header-main` recebe `flex: 1`.
- `#right-panel-title` recebe `overflow: hidden`, `text-overflow: ellipsis`, `flex: 1`.
- `.incremental-mode-badge` recebe `flex-shrink: 0`.

### 2.4 Painel de Milestones — Compatibilidade com Sidebar Contraída
**`renderer/milestones_panel.js`**
- Quando aberto com o painel lateral direito contraído, o painel de milestones agora some corretamente.

---

## 3. Painel Git — Rollback, UX e Badges de Status

### 3.1 Função de Rollback
**`main/services/git_service.js`**
- Nova função `rollbackProjectGitFiles(rootPath, files)`:
  - Para arquivos rastreados: `git restore --staged` + `git restore`.
  - Para não rastreados: remove com `fs.unlinkSync`.

**`main/ipc/project_handlers.js`**
- Registra o handler IPC `project:git:rollback`.

**`main.js`** + **`preload.js`**
- Exporta e expõe `rollbackProjectGitFiles` no `localcodeApi`.

**`renderer/project_tools_git.js`**
- Botão "Descartar selecionados" (danger/vermelho) nas etapas Untracked, Modified e Staged.
- Nova função `createGitStatusBadge(status)` com emblemas coloridos:
  - **U** (verde) → Novo arquivo / Untracked
  - **A** (azul) → Preparado / Staged
  - **M** (âmbar) → Modificado / Mixed
- Caminho dividido em nome do arquivo (destaque) + pasta (muted).
- Pills de diff (+/-) à direita do chip.

**`renderer/styles/workspace-tools.css`**
- `.right-tool-git-status-badge` e variantes `--untracked/staged/modified/mixed`.
- Layout dos chips de arquivo de `grid` para `flex`.
- `.right-tool-action--danger` para o botão de rollback.

### 3.2 Git Integrado no Painel Lateral (sem lightbox)
**`renderer/project_tools.js`**
- Abertura do painel Git ativa `body.mode-git`, exibindo `#workspace-git-panel` no painel lateral.
- Expande o painel se estiver contraído.

---

## 4. Terminal — Modo Inline Convencional

**`renderer/styles/workspace-tools.css`**
- `.project-terminal-body` é a área de scroll (`overflow-y: auto`).
- `.project-terminal-output` sem scroll próprio (`overflow: visible`, `height: auto`).
- Botões de minimizar, fechar e alterar posição ocultados.
- Botão de submit oculto — execução só via `Enter`.

**`renderer/project_terminal.js`**
- Scroll rola `elements.body` ao receber novo output.
- Click no corpo do terminal foca o input.
- Terminal abre no painel lateral direito, não em lightbox.
- Ativa `body.mode-terminal` via CSS para exibição/ocultação.

---

## 5. Árvore de Arquivos — DFS Pré-Ordem

**`main/services/project_scanner.js`**

A função `collectProjectFilesTree` foi reescrita com travessia **DFS pré-ordem**:
- Cada item é emitido para `rows` **imediatamente** ao ser desempilhado.
- Ao processar um diretório, seus filhos são ordenados e empilhados em ordem reversa.
- Resultado: hierarquia correta, expansão/recolhimento funcionando perfeitamente.

---

## 6. Canvas do Mapa — Melhorias de Interação

**`renderer/application_map_canvas.js`**
- **Drag Ghost Bug**: `img.draggable = false` em tags `<img>` de cards — elimina clone translúcido residual.
- **Zoom via Touchpad**: Sensibilidade reduzida; limites 0.3×–2.5×.
- **Hand Tool**: Ativado com `Espaço` (hold) ou ícone ✋ no toolbar.
- **Seleção Múltipla com Lasso**: Arrastar sem hand tool ativo seleciona múltiplos artefatos por retângulo.
- **Botão de Edição**: Visível e posicionado corretamente em cada card.
- **Preview de Imagem**: Clicar em arquivo de imagem abre lightbox, não editor.

---

## 7. Editor e Preview de Arquivos

**`renderer/project_file_editor.js`** + **`renderer/project_file_tree.js`**
- Arquivos de imagem (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`) abrem preview em lightbox.
- Arquivos de texto/markdown abrem o editor normalmente.

---

## 8. Testes

**`tests/ipc-handlers.test.js`**
- Mock stub de `rollbackProjectGitFiles` adicionado.
- Contagem de handlers `project:*` atualizada de 30 → 31.

### Suite executada com sucesso:
- ✅ `project-scanner.test.js`
- ✅ `ipc-handlers.test.js`
- ✅ `renderer-workspace-layout-runtime.test.js`

---

## Arquivos Modificados (28 arquivos, +1172 / -235 linhas)

| Caminho | Alteração Principal |
|---|---|
| `main.js` | Exportação de rollback |
| `main/ipc/project_handlers.js` | Handler IPC project:git:rollback |
| `main/services/git_service.js` | rollbackProjectGitFiles |
| `main/services/project_scanner.js` | DFS pré-ordem correta |
| `preload.js` | Bridge IPC rollback |
| `renderer/app.js` | Injeção workspaceLayoutController |
| `renderer/app_events.js` | Expansão estruturada do painel |
| `renderer/app_actions.js` | Ativação de ferramentas por modo |
| `renderer/application_map.js` | Chat contextual do mapa |
| `renderer/application_map_canvas.js` | Zoom, hand tool, lasso, drag fix |
| `renderer/ai_settings_controller.js` | Ajustes de layout draft |
| `renderer/cortex_controller.js` | Correção menor |
| `renderer/index.html` | Chat do mapa, painéis |
| `renderer/milestones_panel.js` | Compatibilidade sidebar contraída |
| `renderer/project_file_editor.js` | Preview de imagem |
| `renderer/project_file_tree.js` | Suporte preview imagem |
| `renderer/project_state_modal.js` | Ajuste menor |
| `renderer/project_terminal.js` | Terminal inline, integração lateral |
| `renderer/project_tools.js` | Git no painel, sem lightbox |
| `renderer/project_tools_git.js` | Rollback UI, badges, layout responsivo |
| `renderer/project_tools_github_deploy.js` | Ajuste menor |
| `renderer/styles/application-map.css` | Chat do mapa, visibilidades por modo |
| `renderer/styles/legacy/05-modals-terminal.css` | Ajuste z-index |
| `renderer/styles/ui-overrides.css` | Tipografia e identidade |
| `renderer/styles/workspace-layout.css` | Spacer bug, cabeçalho, scroll |
| `renderer/styles/workspace-tools.css` | Terminal inline, Git badges, chips |
| `renderer/workspace_layout_runtime.js` | Suporte ferramenta git no runtime |
| `tests/ipc-handlers.test.js` | Mock rollback, contagem handlers |
