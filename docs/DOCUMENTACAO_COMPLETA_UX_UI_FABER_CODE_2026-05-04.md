# DOCUMENTAÇÃO COMPLETA DE UX/UI — FABER CODE

Data: 2026-05-04  
Escopo: Interface desktop Electron (layout principal, interações, editor de arquivos, estados visuais e regras de consistência)

---

## 1) Objetivo de UX

O Faber Code foi desenhado para oferecer uma experiência de trabalho contínua entre três contextos simultâneos:

1. Gestão de projetos (lado esquerdo)
2. Conversa e execução assistida por IA (centro)
3. Arquivos e ações de projeto (lado direito)

A intenção central da UX é reduzir fricção operacional: o usuário escolhe projeto, conversa com IA, revisa arquivos e toma decisões sem trocar de tela.

---

## 2) Princípios de Design adotados

1. Hierarquia clara por zona funcional
2. Contraste alto para leitura prolongada
3. Estado ativo óbvio (projeto aberto/selecionado)
4. Feedback imediato em ações críticas (abrir, editar, salvar, confirmar saída)
5. Consistência visual entre componentes equivalentes
6. Estética dark profissional com laterais em glassmorphism controlado

---

## 3) Arquitetura visual da tela

### 3.1 Estrutura macro

A interface principal usa grid em 3 colunas:

- Painel esquerdo (`.panel-left`): controle de projetos
- Painel central (`.panel-center`): conversa + composer
- Painel direito (`.panel-right`): árvore de arquivos + ações de painel

Implementação base em: `renderer/index.html` e `renderer/styles.css`

### 3.2 Comportamento de topo (macOS)

A janela está configurada para convivência com controles nativos macOS:

- `titleBarStyle: 'hiddenInset'`
- `titleBarOverlay: true`
- `setWindowButtonVisibility(true)`

Foi aplicado espaçamento seguro para evitar conflito visual com os botões da janela:

- `padding-top` de `.app-shell` com `env(titlebar-area-height, 0px)`

---

## 4) Sistema visual atual (estado consolidado)

### 4.1 Paleta funcional

- Superfícies escuras principais: `#1d1e1f`
- Centro sólido: escuro opaco (sem blur)
- Laterais: glass escuro com blur/saturação controlados
- Bordas suaves: branco com baixa opacidade (`rgba(255,255,255,~0.12-0.16)`)

### 4.2 Distribuição de estilo

#### Centro (mais sólido)

Aplicado em:

- `.panel-center`
- `.composer`, `.composer-surface`, `.input-shell`, `#user-input`
- `.next-steps-box` (quando usada como superfície central)

Regra de UX: área de foco de trabalho deve ser estável, escura e sem distração óptica.

#### Laterais (glassmorphism escuro)

Aplicado em:

- `.panel-left`
- `.panel-right`

Regra de UX: laterais devem ser contextuais, com textura leve e sensação de profundidade, sem competir com o centro.

---

## 5) Componentes e comportamentos

### 5.1 Bloco de projetos (esquerda)

Componentes:

- Botões superiores (`Cortex`, `Novo projeto`)
- Campo de busca
- Lista de projetos (`#projects-list`)
- Ações inferiores (arquivados, lixeira, configurações)

Comportamentos atuais:

1. Expansão de projeto com clique único (feedback imediato)
2. Projeto ativo abre conversa e contexto correspondente
3. Estado visual dos cards:
- Fechado: mesmo padrão visual dos botões superiores
- Aberto/ativo: escurecido para destacar foco

### 5.2 Scroll interno do painel esquerdo

Problema resolvido: quando a quantidade de projetos cresce, a lista passa a rolar internamente sem deslocar rodapé.

Regras aplicadas:

- `.projects-list` com `overflow-y: auto`
- `flex: 1` e `min-height: 0`
- `.left-bottom-actions` com `flex-shrink: 0`

Resultado: painel escalável para muitos projetos.

### 5.3 Painel de arquivos (direita)

- Exibe árvore de arquivos do projeto selecionado
- Clique em arquivo abre lightbox/editor
- Design alinhado ao sistema dark com bordas suaves

### 5.4 Lightbox de arquivo + editor

Diretriz principal consolidada:

- Edição e texto na mesma camada funcional (evitar duplicação visual)
- Sintaxe colorida sem artefato de overlay duplicado
- Controle de saída com confirmação de alterações não salvas

Estados importantes:

1. Sem alterações
2. Alterações pendentes
3. Salvar
4. Fechar com confirmação

### 5.5 Modal de saída sem salvar

Mensagem orientada a decisão:

- "Você alterou o projeto, deseja sair sem salvar?"
- CTA padrão de segurança: destaque em "Não"

---

## 6) Performance e limites de visualização

### 6.1 Leitura de arquivos

Proteções do visualizador:

1. Bloqueio de binários
2. Limite por tamanho de arquivo (proteção de memória)
3. Limite por linhas no editor

Estado atual:

- Limite de linhas elevado para **100.000 linhas**
- Suporte a arquivos grandes com mensagem explícita quando exceder limite

Objetivo UX: permitir leitura realista de arquivos grandes sem travar a interface.

---

## 7) Consistência de interação

### 7.1 Regras de seleção e ativação

1. Clique no projeto: expande/retrai imediatamente
2. Seleção de projeto ativa contexto de conversa
3. Conversa selecionada atualiza chat central
4. Clique em arquivo abre editor/lightbox

### 7.2 Linguagem de feedback

- Mensagens curtas e objetivas
- Estados descritivos (ex.: "Sem alterações", "Alterações não salvas")
- Erros apresentados com causa legível

---

## 8) Acessibilidade e legibilidade

Medidas aplicadas:

1. Contraste alto em textos primários
2. Áreas clicáveis amplas para projeto e ações
3. Estados visuais com borda + fundo (não depender só de cor)
4. Tipografia consistente (`Manrope`) e escala de leitura estável

Pontos recomendados para evolução:

1. Navegação por teclado completa na árvore de projetos/arquivos
2. Foco visível (`:focus-visible`) em todos os botões
3. Rótulos ARIA adicionais em itens dinâmicos

---

## 9) Responsividade e comportamento em redimensionamento

- Layout principal baseado em grid fixo para desktop
- Scroll interno em áreas de conteúdo longas
- Painéis mantêm estrutura sem quebrar ações fixas de rodapé

Recomendação futura:

- Definir breakpoints oficiais para larguras menores (ex.: <=1366)
- Política de colapso do painel direito quando necessário

---

## 10) Mapa técnico (onde cada parte vive)

### Estrutura

- `renderer/index.html`: estrutura dos painéis e componentes
- `renderer/styles.css`: sistema visual completo e overrides finais
- `renderer/app.js`: interações de UI (projetos, conversas, editor, modais)
- `main.js`: janela Electron, IPC e leitura de arquivos

### Trechos críticos recentes

1. Configuração de janela/title bar no `createWindow()` em `main.js`
2. Handler `file:read` em `main.js` (limites de preview)
3. Renderização de projetos e clique de expansão em `renderer/app.js`
4. Blocos finais de padronização visual em `renderer/styles.css`

---

## 11) Dívida técnica de UI (importante)

Há múltiplos blocos históricos de CSS adicionados em etapas rápidas (hotfixes/overrides).  
Hoje o design está funcional, porém com risco de regressão por conflito de especificidade.

Recomendação de saneamento:

1. Consolidar tokens de tema em um único bloco `:root`
2. Remover overrides antigos já substituídos
3. Separar CSS por domínio:
- layout
- componentes
- estados
- utilitários
4. Criar checklist de regressão visual por painel

---

## 12) Padrão oficial UX/UI (baseline aprovado)

A partir deste documento, o baseline visual deve ser:

1. Centro escuro e sólido (foco)
2. Laterais esquerda e direita com glass escuro equivalente
3. Cards de projeto fechados no mesmo idioma visual dos botões de topo
4. Projeto aberto/ativo com escurecimento de destaque
5. Lista de projetos com scroll vertical interno quando exceder altura
6. Editor com seleção/edição estável, sem camadas conflitantes

---

## 13) Critérios de aceite para futuras mudanças de UI

Toda alteração visual nova deve passar por:

1. Consistência com os 3 painéis
2. Verificação de contraste
3. Verificação de estados (normal/hover/ativo/erro/desabilitado)
4. Teste com lista de projetos longa (scroll)
5. Teste com arquivo grande no visualizador
6. Teste de fechamento com alterações não salvas

---

## 14) Encerramento deste ciclo

Este documento consolida o ciclo de ajustes de UX/UI do painel principal do Faber Code até 2026-05-04, incluindo:

- padronização estética
- correções de interação
- melhorias de usabilidade
- limites operacionais do editor/visualizador

Próximo passo recomendado (quando iniciar novo contexto): saneamento definitivo do CSS para reduzir complexidade e risco de regressão.
