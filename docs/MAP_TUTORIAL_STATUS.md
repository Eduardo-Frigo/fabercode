# Status do Tutorial de Mapa (Step 8: map-build)

**Status Atual:** PENDENTE / COM ERROS
**Última Atualização:** 08 de Julho de 2026

## Descrição do Problema
O desenvolvimento do passo 8 do tutorial progressivo ("Aula de Criação de Projeto", focado no Mapa da Aplicação) está temporariamente paralisado e seu fluxo encontra-se **quebrado**.

### Sintomas Observados
- O cursor do tutorial (`progressive-tutorial-cursor`) falha ao tentar rastrear o botão de criar Markdown (`#btn-map-tool-add-card`) na barra de ferramentas.
- O cursor frequentemente é posicionado nas coordenadas `x: 0, y: 0` (canto superior esquerdo) ou preso no centro da tela.
- Os rótulos de instrução (ex: "Clique na ferramenta Markdown") não são renderizados corretamente no tempo esperado, sendo substituídos prematuramente pelo rótulo do próximo alvo ("Clique no Título").
- O fluxo não reconhece corretamente a criação de novos itens no mapa e desengata o rastreamento do nó do Canvas prematuramente.

### Causas Técnicas (Post-mortem)
1. **Verificações de Visibilidade do DOM:** As checagens originais utilizavam `resolveElement`, que retorna verdadeiro assim que o elemento existe no DOM, mesmo que esteja invisível (ex: painel do inspetor fechado). Isso causava um avanço prematuro do tutorial (Race Condition). A tentativa de contornar isso usando `resolveVisibleElement` esbarrou na arquitetura assíncrona do carregamento do mapa.
2. **Ciclo de Atualização do Canvas (`canvasController`):** O rastreamento do nó recém-criado através da função `animateCursorToCanvasNode` dependia de dados sincronizados da matriz de câmera do mapa. Conflitos na transição do estado do aplicativo (`notifyStateChanged`) causavam a desativação da flag `tracking` prematuramente, abortando o movimento do cursor.
3. **Bloqueios de Cache do Electron:** Durante o processo de depuração, o Chromium interno do Electron executou cache agressivo (`disk cache`) do script `progressive_disclosure.js`, dificultando a validação em tempo real das correções.

## Próximos Passos
Foi acordado que a finalização desta etapa específica do tutorial será postergada. 
O desenvolvimento do passo 8 está oficialmente **PENDENTE**. Quaisquer melhorias futuras neste módulo exigirão:
- Uma reestruturação da lógica de `async/await` do rastreador de canvas.
- Adoção de um observador de mutação (MutationObserver) rígido para os painéis em vez de loops de polling de visibilidade.
