# Faber Code — Sistema de Mapa da Aplicação Completo e Plano para MVP
## Sessão: 2026-06-18 → 2026-06-21

---

## Visão Geral
Esta sessão de desenvolvimento marcou a **conclusão bem-sucedida e polimento completo do Sistema de Mapa da Aplicação** no Faber Code, garantindo um ambiente robusto de planejamento, edição e isolamento contextual. Com o fim desta etapa, o projeto está pronto para a próxima fase técnica em direção ao MVP.

---

## 1. Avanços e Funcionalidades do Sistema de Mapa da Aplicação (Finalizado)

### 1.1 Isolamento Contextual do Chat do Mapa (Map Chat)
* **Objetivo:** Evitar que a IA do chat de planejamento do mapa misturasse escopos com o criador/executor automático de sites e aplicações complexas.
* **Resolução:**
  * O chat do mapa agora funciona de forma estritamente documental e reflexiva sobre o canvas do projeto.
  * O tráfego do chat do mapa envia a flag `isMapChat` e é roteado no `PersonaOrchestrator` de forma a ignorar comandos do construtor de código, guiando o assistente de forma puramente consultiva.
  * Ao ser ativado, a IA responde com uma mensagem curta e clara provando que compreendeu o mapa atual do usuário (ex: *"Entendido, então você deseja criar uma aplicação com..."*), mantendo o foco exclusivo no planejamento estrutural.

### 1.2 Gerenciamento Completo de Conversas (Renomear e Excluir)
* **Exclusão de Conversas:** Adicionado o ícone de lixeira (trash bin) ao lado de cada conversa na barra lateral de projetos. Clicar no botão aciona o novo handler IPC `orchestration:conversation:delete` e a exclusão persistente de dados no `state_store`.
* **Renomeação de Conversas:** Implementação de suporte para edição inline ao clicar no ícone de lápis ou dar duplo clique. O usuário pode renomear a conversa diretamente pela interface, facilitando o gerenciamento do seu histórico de projeto.

### 1.3 Inspetor de Nós Integrado ao Painel Lateral (Workspace Right Zone)
* **Integração Visual Limpa:** O painel de edição e inspeção de cards (`#application-map-inspector`) foi retirado de cima do canvas do mapa da aplicação (onde causava problemas de visualização e sobreposição) e integrado à aba lateral direita (`#workspace-right-zone`), como o novo painel `#workspace-map-inspector-panel`.
* **Limpeza de UI:**
  * Removido o campo redundante e não-utilizado de "Tags".
  * Removido o botão gigante de exclusão que ocupava espaço desnecessário no rodapé do inspetor.
  * Quando o painel do inspetor é fechado, as bordas de seleção do nó correspondente no canvas são limpas automaticamente.
* **Barra de Formatação Markdown:** Acima do editor CodeMirror no inspetor, adicionamos uma barra de ferramentas com atalhos de formatação rápidos (H1, Negrito, Itálico, Lista, Código, Limpar), permitindo que o usuário crie e edite seus markdowns de planejamento de forma ágil diretamente de dentro do Faber Code.

### 1.4 Correções e Ajustes de Layout e UX
* **Persistência dos Ícones do Painel Direito:** Corrigido o bug em que os ícones do rodapé lateral do painel direito (Arquivos, Git, Terminal, Milestones) sumiam ao abrir o editor de markdown ou clicar fora dele.
* **Realce e Seleção de Texto Premium:** Ajustado o estilo do seletor de texto em campos de input, textareas e linhas do CodeMirror para usar um fundo verde esmeralda translúcido do Faber Code (`#50c985`) com texto em branco (`#ffffff`), melhorando consideravelmente a legibilidade durante a edição.
* **Overlay dos Painéis de Workspace:** Corrigido o conflito onde a interface do editor e o chat de mapa ficavam desalinhados ou sobrepostos devido a conflito de classes do `body` de estado.

---

## 2. Próxima Etapa do Projeto: Renderização, Milestones e Caminho ao MVP

Com o **Sistema de Mapa da Aplicação** totalmente concluído e testado, o projeto entra na reta final para a primeira versão pública funcional (MVP). O cronograma é composto de:

1. **Desenvolvimento do Sistema de Renderização:**
   * Implementação e refinamento dos motores de renderização visual dos layouts e blueprints sintetizados a partir do planejamento.
2. **Desenvolvimento e Integração de Milestones:**
   * Conectar o plano de execução gerado pela IA ao painel de milestones para acompanhamento de tarefas em tempo real.
3. **Smoke Test Geral e Verificação de Qualidade:**
   * Execução de testes de fumaça exaustivos cobrindo todo o ciclo: Intake -> Planejamento no Mapa da Aplicação -> Geração -> Renderização -> Validação Visual.
4. **Lançamento da Versão MVP:**
   * Publicação da primeira versão utilizável do ecossistema integrado.

---

## 3. Avanços Incrementais Registrados Nesta Rodada

Nesta rodada o trabalho deixou de ser apenas visual e passou a corrigir o comportamento estrutural do fluxo de renderização e do painel de milestones.

### 3.1 Render como refinador incremental do plano

O chat de render passou a tratar o plano como um artefato incremental, e não como um recomeço silencioso a cada solicitação do usuário.

O que foi ajustado:
- a reconstrução do `renderDraft` agora preserva as milestones anteriores antes de mesclar a nova resposta da IA;
- pedidos do tipo `adicione um ponto 8`, `inclua uma etapa de release` ou `coloque uma nova milestone` passam a gerar uma etapa adicional real, em vez de parecer rollback;
- as sugestões refinadas recebem indicadores numéricos de mudança para deixar claro onde o refinador atuou;
- as referências aos markdowns do mapa continuam sendo reaproveitadas para contextualizar cada etapa do plano.

Arquivos centrais:
- `renderer/application_map.js`
- `renderer/styles/application-map.css`

### 3.2 Separação mais limpa entre Render, Git e Terminal

Havia vazamento visual do painel de render quando o usuário alternava rapidamente entre Git e Terminal. Isso foi endurecido em três camadas:

- os controladores de Git e Terminal passaram a remover explicitamente `mode-map-render` ao abrir suas telas;
- o CSS do painel de render ganhou trava adicional para esconder o painel em `mode-git` e `mode-terminal`;
- o seletor global de modos passou a reconhecer render como estado próprio, reduzindo estados residuais durante a navegação lateral.

Arquivos centrais:
- `renderer/project_tools.js`
- `renderer/project_terminal.js`
- `renderer/app_events.js`
- `renderer/app.js`
- `renderer/styles/application-map.css`

### 3.3 Milestones com espaçamento e alinhamento visual mais estáveis

O painel de milestones recebeu ajustes de layout para corrigir o desalinhamento entre números e cards, além de dar mais respiro entre as etapas.

O que mudou:
- a timeline recebeu mais padding lateral e superior;
- a linha vertical foi reposicionada para acompanhar melhor os números;
- os cards ganharam altura mínima e header com alinhamento mais consistente;
- o espaçamento entre milestones foi aumentado para reduzir a sensação de aperto visual.

Arquivo central:
- `renderer/styles/milestones.css`

### 3.4 Validações executadas

A rodada foi validada com checks locais de sintaxe e testes de regressão do fluxo:

- `node --check renderer/application_map.js`
- `node --check renderer/project_tools.js`
- `node --check renderer/project_terminal.js`
- `node --check renderer/app.js`
- `node --check renderer/app_events.js`
- `node tests/renderer-map-tool-switching.test.js`
- `node tests/milestone-service.test.js`

Resultado: todos passaram.
