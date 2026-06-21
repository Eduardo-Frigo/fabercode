(function () {
  function createApplicationMapController(options = {}) {
    const api = options.api || {};
    const getSelectedProjectId = typeof options.getSelectedProjectId === 'function' ? options.getSelectedProjectId : () => '';
    const getSelectedProjectInfo = typeof options.getSelectedProjectInfo === 'function' ? options.getSelectedProjectInfo : () => null;
    const appendMessage = typeof options.appendMessage === 'function' ? options.appendMessage : () => {};
    const getTerminalController = typeof options.getTerminalController === 'function' ? options.getTerminalController : () => null;

    const container = document.getElementById('workspace-map-region');
    const tabChat = document.getElementById('btn-tab-chat');
    const tabMap = document.getElementById('btn-tab-map');
    const centerTabs = document.getElementById('center-tabs');

    const inspector = document.getElementById('workspace-map-inspector-panel');
    const inspectorTitle = document.getElementById('inspector-node-title');
    const inspectorDesc = document.getElementById('inspector-node-desc');
    const inspectorContent = document.getElementById('inspector-node-content');
    const inspectorAssetField = document.getElementById('inspector-asset-upload-field');
    const inspectorAssetInput = document.getElementById('map-asset-file-input');
    const inspectorClose = document.getElementById('btn-map-inspector-close');
    const inspectorDelete = document.getElementById('btn-map-delete-node');

    let canvasController = null;
    let autosaveTimeout = null;
    let contentEditor = null;

    function insertMarkdown(format) {
      if (!contentEditor) return;
      const doc = contentEditor.getDoc();
      const cursor = doc.getCursor();
      const selection = doc.getSelection();

      let replacement = '';
      let cursorOffset = 0;

      switch (format) {
        case 'h1':
          replacement = `# ${selection || 'Título 1'}`;
          break;
        case 'h2':
          replacement = `## ${selection || 'Título 2'}`;
          break;
        case 'bold':
          replacement = `**${selection || 'texto'}**`;
          cursorOffset = selection ? 0 : -2;
          break;
        case 'italic':
          replacement = `*${selection || 'texto'}*`;
          cursorOffset = selection ? 0 : -1;
          break;
        case 'list':
          replacement = `- ${selection || 'item'}`;
          break;
        case 'code':
          replacement = `\`\`\`\n${selection || 'código'}\n\`\`\``;
          break;
        case 'link':
          replacement = `[${selection || 'link'}](url)`;
          cursorOffset = selection ? 0 : -5;
          break;
      }

      doc.replaceSelection(replacement);
      contentEditor.focus();
      
      if (cursorOffset !== 0) {
        const newCursor = doc.getCursor();
        doc.setCursor({ line: newCursor.line, ch: newCursor.ch + cursorOffset });
      }
    }

    function init() {
      // Set up tabs switching
      if (tabChat && tabMap) {
        tabChat.addEventListener('click', () => {
          switchTab('chat');
        });
        tabMap.addEventListener('click', () => {
          switchTab('map');
        });
      }

      if (inspectorContent && typeof window.CodeMirror !== 'undefined') {
        contentEditor = window.CodeMirror.fromTextArea(inspectorContent, {
          mode: 'markdown',
          theme: 'material-darker',
          lineWrapping: true,
          viewportMargin: Infinity
        });
        contentEditor.on('change', () => {
          inspectorContent.value = contentEditor.getValue();
          updateSelectedNodeData();
        });
      }

      // Initialize canvas
      canvasController = window.FaberApplicationMapCanvas.createApplicationMapCanvas(container, {
        api,
        getProjectId: getSelectedProjectId,
        getSelectedProjectInfo,
        onNodeSelected: (node, openEdit) => {
          if (node) {
            if (openEdit) {
              openInspector(node);
            }
          } else {
            closeInspector();
          }
        },
        onMapChanged: () => {
          triggerAutosave();
        },
        onToolChanged: (tool) => {
          persistTools.forEach((otherId) => {
            const b = container.querySelector(`#${otherId}`);
            if (b) {
              const expectedId = tool === 'select' ? 'btn-map-tool-select' : 'btn-map-tool-hand';
              b.classList.toggle('active', otherId === expectedId);
            }
          });
        }
      });

      // Bind toolbar actions
      const persistTools = ['btn-map-tool-select', 'btn-map-tool-hand'];
      const creationTools = [
        { id: 'btn-map-tool-add-group', type: 'group' },
        { id: 'btn-map-tool-add-card', type: 'text' },
        { id: 'btn-map-tool-add-image', type: 'image' },
        { id: 'btn-map-tool-add-decision', type: 'decision' }
      ];

      persistTools.forEach((id) => {
        const btn = container.querySelector(`#${id}`);
        if (btn) {
          btn.addEventListener('click', () => {
            persistTools.forEach((otherId) => {
              const b = container.querySelector(`#${otherId}`);
              if (b) b.classList.toggle('active', otherId === id);
            });
            const tool = id === 'btn-map-tool-select' ? 'select' : 'hand';
            canvasController.setTool(tool);
          });
        }
      });

      creationTools.forEach((toolDef) => {
        const btn = container.querySelector(`#${toolDef.id}`);
        if (btn) {
          btn.addEventListener('click', () => {
            // Immediate creation at center
            canvasController.addNodeAtCenter(toolDef.type);
            // Re-active select tool
            persistTools.forEach((otherId) => {
              const b = container.querySelector(`#${otherId}`);
              if (b) b.classList.toggle('active', otherId === 'btn-map-tool-select');
            });
            canvasController.setTool('select');
          });
        }
      });

      if (canvasController) {
        canvasController.setTool('select');
      }

      // Zoom Controls
      const btnReset = container.querySelector('#btn-map-zoom-reset');
      if (btnReset) {
        btnReset.addEventListener('click', () => {
          canvasController.resetZoom();
        });
      }

      // Clear
      const btnClear = container.querySelector('#btn-map-clear');
      if (btnClear) {
        btnClear.addEventListener('click', async () => {
          await canvasController.clearMap();
        });
      }

      // Render
      const btnRender = container.querySelector('#btn-map-render');
      if (btnRender) {
        btnRender.addEventListener('click', async () => {
          const confirmed = await window.faberConfirm("Você revisou o projeto antes de renderizar o mapa da aplicação?");
          if (!confirmed) return;

          const rootPath = getSelectedProjectInfo()?.rootPath;
          if (!rootPath) return;
          btnRender.disabled = true;
          const result = await api.renderApplicationMap({ rootPath });
          btnRender.disabled = false;
          if (result.ok) {
            appendMessage('assistant', `Mapa da aplicação renderizado com sucesso na pasta \`docs/application-map/\`.`, { persistToConversation: false });
          } else {
            alert('Falha ao renderizar mapa: ' + (result.message || 'Erro desconhecido.'));
          }
        });
      }

      // Ask IA
      const mapChatPanel = document.getElementById('workspace-map-chat-panel');
      const mapChatLog = document.getElementById('map-chat-log');
      const mapChatTextarea = document.getElementById('map-chat-textarea');
      const btnMapChatSend = document.getElementById('btn-map-chat-send');
      const rightPanelTitle = document.getElementById('right-panel-title');
      const btnMapChatNew = document.getElementById('btn-map-chat-new');

      const mapChatListView = document.getElementById('map-chat-list-view');
      const mapConversationsList = document.getElementById('map-conversations-list');
      const mapChatSessionView = document.getElementById('map-chat-session-view');
      const btnMapChatBack = document.getElementById('btn-map-chat-back');
      const mapChatSessionTitle = document.getElementById('map-chat-session-title');

      let mapChatMessages = [];
      let activeConversationId = null;

      function appendMapChatMessage(role, text) {
        if (!mapChatLog) return;
        const bubble = document.createElement('div');
        bubble.className = `msg ${role}`;
        bubble.textContent = text;
        mapChatLog.appendChild(bubble);
        mapChatLog.scrollTop = mapChatLog.scrollHeight;
      }

      function showMapChatThinking() {
        if (!mapChatLog) return null;
        const thinking = document.createElement('div');
        thinking.className = 'msg assistant thinking';
        thinking.id = 'map-chat-thinking';
        thinking.innerHTML = '<span>Pensando...</span>';
        mapChatLog.appendChild(thinking);
        mapChatLog.scrollTop = mapChatLog.scrollHeight;
        return thinking;
      }

      function hideMapChatThinking() {
        const thinking = document.getElementById('map-chat-thinking');
        if (thinking) thinking.remove();
      }

      async function loadMapConversations() {
        const projectId = getSelectedProjectId();
        if (!projectId) return;

        activeConversationId = null;
        mapChatMessages = [];
        if (mapChatLog) mapChatLog.innerHTML = '';
        if (mapConversationsList) mapConversationsList.innerHTML = '';

        // Show list, hide session view
        if (mapChatListView) mapChatListView.classList.remove('hidden');
        if (mapChatSessionView) mapChatSessionView.classList.add('hidden');

        try {
          const result = await api.listConversations();
          if (result && result.ok) {
            const conversations = result.conversationsByProject && result.conversationsByProject[projectId]
              ? result.conversationsByProject[projectId]
              : [];
            const mapConversations = conversations.filter(c => c && c.source === 'map_chat');
            
            if (mapConversations.length > 0) {
              mapConversations.forEach(c => {
                const row = document.createElement('div');
                row.className = 'map-conversation-row';
                row.dataset.id = c.id;
                
                const titleSpan = document.createElement('span');
                titleSpan.className = 'map-conversation-title';
                titleSpan.textContent = c.title || 'Análise';
                row.appendChild(titleSpan);

                // Rename button
                const renameBtn = document.createElement('button');
                renameBtn.className = 'map-conversation-rename-btn';
                renameBtn.title = 'Renomear conversa';
                renameBtn.innerHTML = `
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9"></path>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                  </svg>
                `;
                row.appendChild(renameBtn);

                renameBtn.addEventListener('click', async (event) => {
                  event.stopPropagation();
                  const dialogController = window.FaberInlineInputDialog
                    ? window.FaberInlineInputDialog.createInlineInputDialogController()
                    : null;
                  
                  if (dialogController) {
                    const newTitle = await dialogController.requestText({
                      title: 'Renomear Conversa',
                      initialValue: c.title || 'Análise',
                      placeholder: 'Novo nome da conversa'
                    });
                    
                    if (newTitle !== null && newTitle.trim() !== '') {
                      const renameResult = await api.renameConversation({
                        projectId,
                        conversationId: c.id,
                        title: newTitle.trim()
                      });
                      if (renameResult && renameResult.ok) {
                        await loadMapConversations();
                      } else {
                        alert('Falha ao renomear conversa: ' + (renameResult.message || 'Erro desconhecido.'));
                      }
                    }
                  } else {
                    const newTitle = prompt('Renomear Conversa:', c.title || 'Análise');
                    if (newTitle !== null && newTitle.trim() !== '') {
                      const renameResult = await api.renameConversation({
                        projectId,
                        conversationId: c.id,
                        title: newTitle.trim()
                      });
                      if (renameResult && renameResult.ok) {
                        await loadMapConversations();
                      }
                    }
                  }
                });

                // Delete button
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'map-conversation-delete-btn';
                deleteBtn.title = 'Excluir conversa';
                deleteBtn.innerHTML = `
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                `;
                row.appendChild(deleteBtn);

                deleteBtn.addEventListener('click', async (event) => {
                  event.stopPropagation();
                  const confirmed = await window.faberConfirm("Deseja realmente excluir esta conversa?");
                  if (confirmed) {
                    const deleteResult = await api.deleteConversation({
                      projectId,
                      conversationId: c.id
                    });
                    if (deleteResult && deleteResult.ok) {
                      await loadMapConversations();
                    } else {
                      alert('Falha ao excluir conversa: ' + (deleteResult.message || 'Erro desconhecido.'));
                    }
                  }
                });

                const arrow = document.createElement('span');
                arrow.className = 'map-conversation-arrow';
                arrow.innerHTML = '➔';
                arrow.style.opacity = '0.5';
                row.appendChild(arrow);

                row.addEventListener('click', async () => {
                  activeConversationId = c.id;
                  if (mapChatSessionTitle) mapChatSessionTitle.textContent = c.title || 'Análise';
                  
                  // Switch to session view
                  if (mapChatListView) mapChatListView.classList.add('hidden');
                  if (mapChatSessionView) mapChatSessionView.classList.remove('hidden');
                  
                  await loadMapConversationMessages(c.id);
                });
                
                mapConversationsList.appendChild(row);
              });
            } else {
              const emptyMsg = document.createElement('p');
              emptyMsg.className = 'right-tool-empty';
              emptyMsg.style.textAlign = 'center';
              emptyMsg.style.padding = '20px 10px';
              emptyMsg.textContent = 'Nenhuma análise anterior encontrada. Clique em "Nova" para iniciar.';
              mapConversationsList.appendChild(emptyMsg);
            }
          }
        } catch (err) {
          console.error('[loadMapConversations] Error:', err);
        }
      }

      async function loadMapConversationMessages(conversationId) {
        if (!conversationId) return;
        if (mapChatLog) mapChatLog.innerHTML = '';
        mapChatMessages = [];

        try {
          const result = await api.listConversationMessages({ conversationId, limit: 100 });
          if (result && result.ok && Array.isArray(result.messages)) {
            result.messages.forEach(m => {
              appendMapChatMessage(m.role, m.text);
              mapChatMessages.push({ role: m.role, content: m.text });
            });

            if (result.messages.length === 0) {
              await triggerMapAnalysis();
            }
          }
        } catch (err) {
          console.error('[loadMapConversationMessages] Error:', err);
        }
      }

      async function createNewMapConversation() {
        const projectId = getSelectedProjectId();
        if (!projectId) return;

        const now = new Date();
        const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const title = `Análise do Mapa (${dateStr} ${timeStr})`;

        try {
          const result = await api.addConversation({
            projectId,
            title,
            meta: { source: 'map_chat' }
          });
          if (result && result.ok && result.conversation) {
            const newConv = result.conversation;
            activeConversationId = newConv.id;

            if (mapChatSessionTitle) mapChatSessionTitle.textContent = newConv.title;

            // Switch to session view immediately
            if (mapChatListView) mapChatListView.classList.add('hidden');
            if (mapChatSessionView) mapChatSessionView.classList.remove('hidden');

            if (mapChatLog) mapChatLog.innerHTML = '';
            mapChatMessages = [];

            await triggerMapAnalysis();
          }
        } catch (err) {
          console.error('[createNewMapConversation] Error:', err);
        }
      }

      async function triggerMapAnalysis() {
        const projectId = getSelectedProjectId();
        const projectInfo = getSelectedProjectInfo();
        const rootPath = projectInfo?.rootPath || '';
        if (!projectId || !rootPath) return;

        // Append status ticker to chat log
        const ticker = document.createElement('div');
        ticker.className = 'map-chat-status-ticker';
        ticker.id = 'map-chat-status-ticker';
        ticker.innerHTML = `
          <div class="ticker-step" id="step-export-md"><span class="status-dot"></span> <span>Exportando markdowns...</span></div>
          <div class="ticker-step" id="step-send-images"><span class="status-dot"></span> <span>Enviando imagens...</span></div>
          <div class="ticker-step" id="step-analyze-info"><span class="status-dot"></span> <span>Analisando informações...</span></div>
          <div class="ticker-step" id="step-contextualized"><span class="status-dot"></span> <span>Chat contextualizado!</span></div>
        `;
        if (mapChatLog) {
          mapChatLog.appendChild(ticker);
          mapChatLog.scrollTop = mapChatLog.scrollHeight;
        }

        const stepExportMd = document.getElementById('step-export-md');
        const stepSendImages = document.getElementById('step-send-images');
        const stepAnalyzeInfo = document.getElementById('step-analyze-info');
        const stepContextualized = document.getElementById('step-contextualized');

        const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };
        const imageDescriptions = {}; // Map node.id -> description text

        // --- PASSO 1: Exportando markdowns ---
        if (stepExportMd) stepExportMd.classList.add('active');
        try {
          await api.renderApplicationMap({ rootPath });
          if (stepExportMd) {
            stepExportMd.classList.remove('active');
            stepExportMd.classList.add('completed');
          }
        } catch (err) {
          console.error('[triggerMapAnalysis] Export markdown error:', err);
          if (stepExportMd) stepExportMd.classList.remove('active');
        }

        // --- PASSO 2: Enviando imagens ---
        if (stepSendImages) stepSendImages.classList.add('active');
        const imageNodes = mapData.nodes.filter(n => n && (n.type === 'image' || n.assetId));
        if (imageNodes.length > 0) {
          const spanText = stepSendImages.querySelector('span:not(.status-dot)');
          for (let i = 0; i < imageNodes.length; i++) {
            const node = imageNodes[i];
            const assetId = node.assetId || node.content;
            if (!assetId) continue;

            if (spanText) {
              spanText.textContent = `Enviando imagens (${i + 1}/${imageNodes.length})...`;
            }

            const imgPath = window.electron ? window.electron.pathJoin(rootPath, assetId) : `${rootPath}/${assetId}`;
            const imgAttachments = [{
              path: imgPath,
              type: assetId.endsWith('.png') ? 'image/png' : assetId.endsWith('.jpg') ? 'image/jpeg' : 'image/jpeg',
              name: assetId
            }];

            try {
              const response = await api.sendAssistantMessage({
                projectInfo,
                userMessage: `Por favor, analise a seguinte imagem do mapa da aplicação (nome: ${assetId}) e forneça uma descrição detalhada de seu conteúdo técnico, elementos de UI/UX, fluxos ou informações de design apresentadas.`,
                contextHint: 'Você é um assistente técnico analista de UI/UX. Descreva com precisão tudo o que está visível na imagem e sua relação com o desenvolvimento de software.',
                conversationMessages: [],
                attachments: imgAttachments,
                isMapChat: true
              });
              if (response && response.ok && response.response) {
                imageDescriptions[node.id] = response.response;
              } else {
                imageDescriptions[node.id] = '(IA não conseguiu analisar a imagem)';
              }
            } catch (err) {
              console.error('[triggerMapAnalysis] Image analysis error for ' + assetId, err);
              imageDescriptions[node.id] = `(Erro de OCR/Visão: ${err.message || String(err)})`;
            }
          }
        }
        if (stepSendImages) {
          stepSendImages.classList.remove('active');
          stepSendImages.classList.add('completed');
          const spanText = stepSendImages.querySelector('span:not(.status-dot)');
          if (spanText) spanText.textContent = 'Imagens enviadas';
        }

        // --- PASSO 3: Analisando informações ---
        if (stepAnalyzeInfo) stepAnalyzeInfo.classList.add('active');

        // Compile group-centric prompt content
        let promptText = 'Por favor, analise as informações consolidadas do mapa da minha aplicação.\n\n';
        promptText += 'O mapa da aplicação foi exportado para a pasta `docs/application-map/` no meu workspace.\n';
        promptText += 'Aqui estão as informações detalhadas estruturadas por grupo:\n\n';

        const rootNodes = mapData.nodes.filter(n => !n.parentId);
        const childNodes = mapData.nodes.filter(n => n.parentId);
        const groups = rootNodes.filter(n => n.type === 'group' || n.type === 'folder');

        for (const g of groups) {
          const fileBasename = g.title.toLowerCase().replace(/[^a-z0-9_-]/g, '-') + '.md';
          const relativePath = 'docs/application-map/' + fileBasename;
          let markdownContent = '';

          try {
            const readResult = await api.readProjectFile({ projectInfo, relativePath });
            if (readResult && readResult.ok) {
              markdownContent = readResult.content;
            }
          } catch (err) {
            console.warn('[triggerMapAnalysis] Failed to read group markdown: ' + relativePath, err);
          }

          promptText += `### GRUPO: ${g.title}\n`;
          if (markdownContent) {
            promptText += `${markdownContent}\n\n`;
          } else {
            promptText += `*(Grupo sem documentação markdown)*\n\n`;
          }

          // Add descriptions of images belonging to this group
          const groupImages = childNodes.filter(c => c.parentId === g.id && (c.type === 'image' || c.assetId));
          if (groupImages.length > 0) {
            promptText += `#### Imagens deste Grupo:\n`;
            groupImages.forEach(img => {
              const desc = imageDescriptions[img.id] || '(Nenhuma descrição disponível)';
              promptText += `- **Imagem [${img.title}]:** ${desc}\n`;
            });
            promptText += '\n';
          }
          promptText += '---\n\n';
        }

        // Orphan/Standalone Nodes
        const standalones = rootNodes.filter(n => n.type !== 'group' && n.type !== 'folder');
        const orphanImages = standalones.filter(n => n.type === 'image' || n.assetId);
        const orphanTexts = standalones.filter(n => n.type !== 'image' && !n.assetId);

        if (orphanTexts.length > 0 || orphanImages.length > 0) {
          promptText += `### ITENS AVULSOS (SEM GRUPO)\n`;
          orphanTexts.forEach(n => {
            promptText += `- **[${n.type.toUpperCase()}]** ${n.title}`;
            if (n.description) promptText += ` — ${n.description}`;
            if (n.content) promptText += ` (Conteúdo: \`${n.content}\`)`;
            promptText += '\n';
          });
          if (orphanImages.length > 0) {
            promptText += `\n#### Imagens Avulsas:\n`;
            orphanImages.forEach(img => {
              const desc = imageDescriptions[img.id] || '(Nenhuma descrição disponível)';
              promptText += `- **Imagem [${img.title}]:** ${desc}\n`;
            });
          }
          promptText += '\n---\n\n';
        }

        // Read auxiliary files (README.md, decisions.md, open-questions.md)
        const auxFiles = [
          { name: 'README.md', path: 'docs/application-map/README.md' },
          { name: 'Decisões', path: 'docs/application-map/decisions.md' },
          { name: 'Dúvidas e Perguntas', path: 'docs/application-map/open-questions.md' }
        ];
        promptText += '### OUTROS ARQUIVOS DE CONTEXTO DO MAPA:\n\n';
        for (const file of auxFiles) {
          try {
            const readResult = await api.readProjectFile({ projectInfo, relativePath: file.path });
            if (readResult && readResult.ok) {
              promptText += `#### ${file.name} (${file.path}):\n${readResult.content}\n\n`;
            }
          } catch (err) {
            console.warn('[triggerMapAnalysis] Failed to read auxiliary file: ' + file.path, err);
          }
        }

        promptText += '\nCom base em todos os markdowns estruturados por grupo e nas descrições de imagens fornecidas acima:\n';
        promptText += '1. Faça um resumo curto provando que você compreendeu as informações do mapa (UI/UX, design system, Front End, Backend, etc.).\n';
        promptText += '2. Comente o que você vê que eu planejo criar.\n';
        promptText += '3. Diga quais pontos do planejamento você acha que estão faltando para eu finalizar a modelagem do meu projeto.\n';

        const systemGuidance = 
          `Você é o Assistente de Modelagem do Mapa da Aplicação no Faber Code.\n` +
          `O usuário está editando o mapa e solicitou ajuda.\n\n` +
          `DIRETRIZES IMPORTANTES PARA SUAS RESPOSTAS:\n` +
          `1. Você NÃO deve tentar criar a aplicação, sugerir geração de código ou planejar tarefas de desenvolvimento de backend/frontend.\n` +
          `2. Seu foco exclusivo é ajudar o usuário a compreender e planejar que tipo de aplicação quer criar, auxiliando a documentar e definir os markdowns (textos, notas e referências visuais) necessários para desenhar e fechar a modelagem do projeto no Mapa da Aplicação.\n` +
          `3. Você pode ler arquivos do projeto para contextualizar a sua resposta, porém não execute tarefas ou scripts de alteração de código fonte.\n` +
          `4. Responda em linguagem natural, amigável, clara e objetiva.\n` +
          `5. No início da sua resposta, prove ao usuário que compreendeu o planejamento iniciando com uma frase explicativa como "Entendido, então você deseja criar uma aplicação com o..." seguida por um resumo curto.\n` +
          `6. NUNCA diga frases como "Entendi. Vou trabalhar nisso agora e te volto com resultado real" e NUNCA aja como se fosse criar a aplicação.`;

        try {
          const response = await api.sendAssistantMessage({
            projectInfo,
            userMessage: promptText,
            contextHint: systemGuidance,
            conversationMessages: [],
            attachments: [], // Attachments are already processed and described in the prompt text
            isMapChat: true
          });

          if (stepAnalyzeInfo) {
            stepAnalyzeInfo.classList.remove('active');
            stepAnalyzeInfo.classList.add('completed');
          }

          if (stepContextualized) {
            stepContextualized.classList.add('active');
            stepContextualized.classList.add('completed');
          }

          // Delay slightly so the user sees the completed state
          await new Promise(r => setTimeout(r, 600));
          if (ticker) ticker.remove();

          if (response && response.ok && response.response) {
            appendMapChatMessage('assistant', response.response);
            mapChatMessages.push({ role: 'assistant', content: response.response });

            if (activeConversationId) {
              await api.addConversationMessage({
                projectId,
                conversationId: activeConversationId,
                role: 'assistant',
                text: response.response
              });
            }
          } else {
            appendMapChatMessage('assistant', 'Desculpe, não consegui obter uma resposta da IA neste momento.');
          }
        } catch (err) {
          if (ticker) ticker.remove();
          appendMapChatMessage('assistant', `Erro ao comunicar com a IA: ${err.message || String(err)}`);
        }
      }

      async function sendMapChatMessage(userText) {
        if (!userText.trim()) return;

        appendMapChatMessage('user', userText);
        mapChatMessages.push({ role: 'user', content: userText });

        const projectId = getSelectedProjectId();
        if (activeConversationId) {
          try {
            await api.addConversationMessage({
              projectId,
              conversationId: activeConversationId,
              role: 'user',
              text: userText
            });
          } catch (err) {
            console.error('[sendMapChatMessage] Save user error:', err);
          }
        }

        const thinking = showMapChatThinking();

        const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };
        
        let mapMarkdown = "# MAPA DA APLICAÇÃO ATUAL (BOARD)\n\n";
        
        const rootNodes = mapData.nodes.filter(n => !n.parentId);
        const childNodes = mapData.nodes.filter(n => n.parentId);
        
        const groups = rootNodes.filter(n => n.type === 'group');
        if (groups.length > 0) {
          mapMarkdown += "## GRUPOS / MÓDULOS\n";
          groups.forEach(g => {
            mapMarkdown += `### 📁 Grupo: ${g.title}\n`;
            if (g.description) mapMarkdown += `*Descrição:* ${g.description}\n`;
            
            const children = childNodes.filter(c => c.parentId === g.id);
            if (children.length > 0) {
              mapMarkdown += "\n*Itens pertencentes a este grupo:*\n";
              children.forEach(c => {
                mapMarkdown += `- **[${c.type.toUpperCase()}]** ${c.title}`;
                if (c.description) mapMarkdown += ` — ${c.description}`;
                if (c.content) mapMarkdown += ` (Conteúdo: \`${c.content}\`)`;
                mapMarkdown += "\n";
              });
            } else {
              mapMarkdown += "\n*(Este grupo está vazio)*\n";
            }
            mapMarkdown += "\n";
          });
        }
        
        const standalones = rootNodes.filter(n => n.type !== 'group');
        if (standalones.length > 0) {
          mapMarkdown += "## ITENS SOLTOS NO CANVAS\n";
          standalones.forEach(n => {
            mapMarkdown += `- **[${n.type.toUpperCase()}]** ${n.title}`;
            if (n.description) mapMarkdown += ` — ${n.description}`;
            if (n.content) mapMarkdown += ` (Conteúdo: \`${n.content}\`)`;
            mapMarkdown += "\n";
          });
          mapMarkdown += "\n";
        }
        
        if (mapData.edges.length > 0) {
          mapMarkdown += "## CONEXÕES E DEPENDÊNCIAS\n";
          mapData.edges.forEach(e => {
            const src = mapData.nodes.find(n => n.id === e.sourceNodeId);
            const tgt = mapData.nodes.find(n => n.id === e.targetNodeId);
            if (src && tgt) {
              mapMarkdown += `- **${src.title}** (${src.type}) ➔ **${tgt.title}** (${tgt.type})\n`;
            }
          });
          mapMarkdown += "\n";
        }

        const systemGuidance = 
          `Você é o Assistente de Modelagem do Mapa da Aplicação no Faber Code.\n` +
          `O usuário está editando o mapa e solicitou ajuda.\n\n` +
          `Aqui está o estado atual do board mapeado pelo usuário em formato Markdown:\n` +
          `\`\`\`markdown\n` +
          `${mapMarkdown}\n` +
          `\`\`\`\n\n` +
          `DIRETRIZES IMPORTANTES PARA SUAS RESPOSTAS:\n` +
          `1. Você NÃO deve tentar criar a aplicação, sugerir geração de código ou planejar tarefas de desenvolvimento de backend/frontend.\n` +
          `2. Seu foco exclusivo é ajudar o usuário a compreender e planejar que tipo de aplicação quer criar, auxiliando a documentar e definir os markdowns (textos, notas e referências visuais) necessários para desenhar e fechar a modelagem do projeto no Mapa da Aplicação.\n` +
          `3. Você pode ler arquivos do projeto para contextualizar a sua resposta, porém não execute tarefas ou scripts de alteração de código fonte.\n` +
          `4. Responda em linguagem natural, amigável, clara e objetiva.\n` +
          `5. No início da sua resposta, prove ao usuário que compreendeu o planejamento iniciando com uma frase explicativa como "Entendido, então você deseja criar uma aplicação com o..." seguida por um resumo curto.\n` +
          `6. NUNCA diga frases como "Entendi. Vou trabalhar nisso agora e te volto com resultado real" e NUNCA aja como se fosse criar a aplicação.`;

        const mapAttachments = [];
        const projectInfo = getSelectedProjectInfo();
        const rootPath = projectInfo?.rootPath || '';
        if (rootPath) {
          const uniqueAssetIds = [...new Set(mapData.nodes.filter(n => n.assetId).map(n => n.assetId))];
          uniqueAssetIds.forEach(assetId => {
            mapAttachments.push({
              path: window.electron ? window.electron.pathJoin(rootPath, assetId) : `${rootPath}/${assetId}`,
              type: assetId.endsWith('.png') ? 'image/png' : assetId.endsWith('.jpg') ? 'image/jpeg' : 'image/jpeg',
              name: assetId
            });
          });
        }

        try {
          const response = await api.sendAssistantMessage({
            projectInfo: projectInfo,
            userMessage: userText,
            contextHint: systemGuidance,
            conversationMessages: mapChatMessages.map(m => ({ role: m.role, text: m.content })),
            attachments: mapAttachments,
            isMapChat: true
          });

          hideMapChatThinking();

          if (response && response.ok && response.response) {
            appendMapChatMessage('assistant', response.response);
            mapChatMessages.push({ role: 'assistant', content: response.response });

            if (activeConversationId) {
              try {
                await api.addConversationMessage({
                  projectId,
                  conversationId: activeConversationId,
                  role: 'assistant',
                  text: response.response
                });
              } catch (err) {
                console.error('[sendMapChatMessage] Save assistant error:', err);
              }
            }
          } else {
            appendMapChatMessage('assistant', 'Desculpe, não consegui obter uma resposta da IA neste momento.');
          }
        } catch (err) {
          hideMapChatThinking();
          appendMapChatMessage('assistant', `Erro ao comunicar com a IA: ${err.message || String(err)}`);
        }
      }

      if (btnMapChatSend && mapChatTextarea) {
        btnMapChatSend.addEventListener('click', () => {
          const text = mapChatTextarea.value;
          mapChatTextarea.value = '';
          sendMapChatMessage(text);
        });

        mapChatTextarea.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            btnMapChatSend.click();
          }
        });
      }

      if (btnMapChatBack) {
        btnMapChatBack.addEventListener('click', async () => {
          activeConversationId = null;
          await loadMapConversations();
        });
      }

      if (btnMapChatNew) {
        btnMapChatNew.addEventListener('click', async () => {
          btnMapChatNew.disabled = true;
          await createNewMapConversation();
          btnMapChatNew.disabled = false;
        });
      }

      const btnAi = document.getElementById('btn-map-ai');
      if (btnAi) {
        btnAi.addEventListener('click', async () => {
          document.body.classList.remove('mode-milestones');
          document.body.classList.remove('mode-cortex');
          document.body.classList.remove('mode-git');
          document.body.classList.remove('mode-terminal');
          const cortexBtn = document.getElementById('btn-cortex-mode');
          if (cortexBtn) cortexBtn.classList.remove('active');
          const milestonesBtn = document.getElementById('btn-project-milestones');
          if (milestonesBtn) milestonesBtn.classList.remove('active');
          const gitBtn = document.getElementById('btn-project-git');
          if (gitBtn) gitBtn.classList.remove('active');
          const terminalBtn = document.getElementById('btn-project-terminal');
          if (terminalBtn) terminalBtn.classList.remove('active');

          const terminalController = getTerminalController();
          if (terminalController) {
            terminalController.closePanel();
          }

          const active = document.body.classList.toggle('mode-map-chat');
          btnAi.classList.toggle('active', active);
          if (rightPanelTitle) {
            rightPanelTitle.textContent = active ? 'Perguntar à IA' : 'Arquivos';
          }

          const filesBtn = document.getElementById('btn-project-files');
          if (filesBtn) {
            filesBtn.classList.toggle('active', !active);
          }

          if (active) {
            if (document.body.classList.contains('workspace-right-collapsed')) {
              const rightToggle = document.getElementById('workspace-collapse-right');
              if (rightToggle) rightToggle.click();
            }

            await loadMapConversations();
          }
        });
      }

      // Inspector events
      if (inspectorClose) inspectorClose.addEventListener('click', closeInspector);
      if (inspectorDelete) inspectorDelete.addEventListener('click', () => {
        canvasController.deleteSelectedNode();
      });

      const updateSelectedNodeData = () => {
        const node = canvasController.getSelectedNode();
        if (!node) return;

        canvasController.updateSelectedNode({
          title: inspectorTitle.value,
          description: inspectorDesc.value,
          content: inspectorContent.value
        });
      };

      [inspectorTitle, inspectorDesc].forEach((field) => {
        if (field) {
          field.addEventListener('input', updateSelectedNodeData);
        }
      });
      if (inspectorContent && !contentEditor) {
        inspectorContent.addEventListener('input', updateSelectedNodeData);
      }

      // Asset Upload handler
      if (inspectorAssetInput) {
        inspectorAssetInput.addEventListener('change', async () => {
          const file = inspectorAssetInput.files[0];
          const rootPath = getSelectedProjectInfo()?.rootPath;
          if (!file || !rootPath) return;

          const reader = new FileReader();
          reader.onload = async (e) => {
            const base64Data = e.target.result;
            const result = await api.importApplicationMapAsset({
              rootPath,
              base64Data,
              fileName: file.name,
              kind: 'references'
            });

            if (result.ok && result.asset) {
              canvasController.updateSelectedNode({
                assetId: result.asset.projectRelativePath,
                content: result.asset.projectRelativePath
              });
              // Reload inspector field content
              if (inspectorContent) {
                inspectorContent.value = result.asset.projectRelativePath;
                if (contentEditor) contentEditor.setValue(result.asset.projectRelativePath);
              }
            } else {
              alert('Falha ao importar imagem: ' + (result.message || 'Erro desconhecido.'));
            }
          };
          reader.readAsDataURL(file);
        });
      }

      // Close inspector if other sidebar tools are clicked
      const otherSidebarButtons = [
        'btn-project-files',
        'btn-map-ai',
        'btn-project-git',
        'btn-project-terminal',
        'btn-project-milestones',
        'btn-cortex-mode'
      ];
      otherSidebarButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.addEventListener('click', () => {
            if (inspector && inspector.classList.contains('open')) {
              inspector.classList.add('hidden');
              inspector.classList.remove('open');
              document.body.classList.remove('mode-map-inspector');
              previousPanelInfo = null;
              if (canvasController && typeof canvasController.selectNode === 'function') {
                if (canvasController.getSelectedNode()) {
                  canvasController.selectNode(null);
                }
              }
            }
          });
        }
      });

      // Markdown toolbar events
      const toolbar = document.querySelector('.markdown-editor-toolbar');
      if (toolbar) {
        toolbar.querySelectorAll('button').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const format = btn.dataset.format;
            insertMarkdown(format);
          });
        });
      }
    }

    function switchTab(mode) {
      const chatRegion = document.getElementById('workspace-chat-region');
      const mapRegion = document.getElementById('workspace-map-region');
      const welcomePanel = document.getElementById('welcome-panel');
      const rightPanelTitle = document.getElementById('right-panel-title');

      if (mode === 'chat') {
        document.body.classList.remove('mode-map-chat');
        const btnAi = document.getElementById('btn-map-ai');
        if (btnAi) btnAi.classList.remove('active');
        if (rightPanelTitle) {
          rightPanelTitle.textContent = 'Arquivos';
        }
        if (tabChat) tabChat.classList.add('active');
        if (tabMap) tabMap.classList.remove('active');
        if (chatRegion) chatRegion.classList.remove('hidden');
        if (mapRegion) mapRegion.classList.add('hidden');
        if (welcomePanel) {
          // Trigger normal welcome panel visibility rules
          welcomePanel.classList.toggle('hidden', chatRegion.querySelector('#chat-log').children.length > 0);
        }
      } else {
        if (tabChat) tabChat.classList.remove('active');
        if (tabMap) tabMap.classList.add('active');
        if (chatRegion) chatRegion.classList.add('hidden');
        if (mapRegion) mapRegion.classList.remove('hidden');
        if (welcomePanel) welcomePanel.classList.add('hidden');
        if (canvasController) {
          canvasController.setTool('select');
        }

        // Draw connections after tab is shown and dimensions are computed
        setTimeout(() => {
          if (canvasController) canvasController.drawEdges();
        }, 100);
      }
    }

    let previousPanelInfo = null;

    function getCurrentlyActiveRightSidebarPanel() {
      if (document.body.classList.contains('mode-cortex')) {
        return { panel: document.getElementById('cortex-learning-box'), title: 'Regras e contexto', buttonId: 'btn-cortex-mode' };
      }
      if (document.body.classList.contains('mode-git')) {
        return { panel: document.getElementById('workspace-git-panel'), title: 'Git', buttonId: 'btn-project-git' };
      }
      if (document.body.classList.contains('mode-terminal')) {
        return { panel: document.getElementById('project-terminal-panel'), title: 'Terminal', buttonId: 'btn-project-terminal' };
      }
      if (document.body.classList.contains('mode-milestones')) {
        return { panel: document.getElementById('workspace-milestones-panel'), title: 'Milestones', buttonId: 'btn-project-milestones' };
      }
      if (document.body.classList.contains('mode-map-chat')) {
        return { panel: document.getElementById('workspace-map-chat-panel'), title: 'Perguntar à IA', buttonId: 'btn-map-ai' };
      }
      // Default to files
      return { panel: document.getElementById('workspace-files-region'), title: 'Arquivos', buttonId: 'btn-project-files' };
    }

    function openInspector(node) {
      if (!inspector) return;

      // If inspector is not already open, remember current panel
      if (!inspector.classList.contains('open')) {
        previousPanelInfo = getCurrentlyActiveRightSidebarPanel();
      }

      inspectorTitle.value = node.title || '';
      inspectorDesc.value = node.description || '';
      inspectorContent.value = node.content || '';
      if (contentEditor) {
        contentEditor.setValue(node.content || '');
        setTimeout(() => contentEditor.refresh(), 10);
      }

      // Only show upload button for image or group node types
      if (inspectorAssetField) {
        inspectorAssetField.style.display = (node.type === 'image' || node.type === 'group') ? 'block' : 'none';
      }

      // Hide other panels in right zone
      const rightZone = document.getElementById('workspace-right-zone');
      if (rightZone) {
        rightZone.querySelectorAll('.workspace-tool-region').forEach(el => {
          if (el.id !== 'workspace-actions-region') {
            el.classList.add('hidden');
          }
        });
      }

      // Show inspector panel
      inspector.classList.remove('hidden');
      inspector.classList.add('open');

      // Clear other tool body classes to avoid display conflicts
      const modeClasses = ['mode-map-chat', 'mode-git', 'mode-terminal', 'mode-milestones', 'mode-cortex'];
      modeClasses.forEach(cls => {
        document.body.classList.remove(cls);
      });
      document.body.classList.add('mode-map-inspector');

      // Update header title of right panel
      const rightPanelTitle = document.getElementById('right-panel-title');
      if (rightPanelTitle) {
        rightPanelTitle.textContent = 'Detalhes do Item';
      }

      // Ensure right panel is expanded
      if (document.body.classList.contains('workspace-right-collapsed')) {
        const rightToggle = document.getElementById('workspace-collapse-right');
        if (rightToggle) rightToggle.click();
      }
    }

    function closeInspector() {
      if (!inspector) return;

      const wasOpen = inspector.classList.contains('open');
      if (!wasOpen) return;

      inspector.classList.remove('open');
      inspector.classList.add('hidden');
      document.body.classList.remove('mode-map-inspector');

      // Restore previously active panel body class
      if (previousPanelInfo && previousPanelInfo.buttonId) {
        if (previousPanelInfo.buttonId === 'btn-map-ai') {
          document.body.classList.add('mode-map-chat');
        } else if (previousPanelInfo.buttonId === 'btn-project-git') {
          document.body.classList.add('mode-git');
        } else if (previousPanelInfo.buttonId === 'btn-project-terminal') {
          document.body.classList.add('mode-terminal');
        } else if (previousPanelInfo.buttonId === 'btn-project-milestones') {
          document.body.classList.add('mode-milestones');
        } else if (previousPanelInfo.buttonId === 'btn-cortex-mode') {
          document.body.classList.add('mode-cortex');
        }
      }

      // Restore previously active panel
      if (previousPanelInfo) {
        const rightZone = document.getElementById('workspace-right-zone');
        if (rightZone) {
          rightZone.querySelectorAll('.workspace-tool-region').forEach(el => {
            if (el.id !== 'workspace-actions-region') {
              el.classList.add('hidden');
            }
          });
        }
        previousPanelInfo.panel.classList.remove('hidden');
        previousPanelInfo.panel.classList.remove('workspace-runtime-hidden');

        const rightPanelTitle = document.getElementById('right-panel-title');
        if (rightPanelTitle) {
          rightPanelTitle.textContent = previousPanelInfo.title;
        }
      } else {
        const filesRegion = document.getElementById('workspace-files-region');
        if (filesRegion) {
          filesRegion.classList.remove('hidden');
          filesRegion.classList.remove('workspace-runtime-hidden');
        }
        const rightPanelTitle = document.getElementById('right-panel-title');
        if (rightPanelTitle) {
          rightPanelTitle.textContent = 'Arquivos';
        }
      }

      previousPanelInfo = null;

      if (canvasController && typeof canvasController.selectNode === 'function') {
        if (canvasController.getSelectedNode()) {
          canvasController.selectNode(null);
        }
      }
    }

    async function loadProjectMap(projectId, options = {}) {
      const rootPath = getSelectedProjectInfo()?.rootPath;
      if (!rootPath) return;

      const result = await api.getApplicationMap({ rootPath });
      if (result && result.ok && result.map) {
        canvasController.loadMapData(result.map);
      }
      
      await loadMapConversations();

      // Auto-toggle tab: Show Map for new projects with 0 files
      const hasFiles = Number(getSelectedProjectInfo()?.totalFiles || 0) > 0;
      if (centerTabs) centerTabs.classList.remove('hidden');
      const targetTab = options.initialTab || (hasFiles ? 'chat' : 'map');
      switchTab(targetTab);
    }

    function triggerAutosave() {
      if (autosaveTimeout) clearTimeout(autosaveTimeout);
      autosaveTimeout = setTimeout(async () => {
        const projectId = getSelectedProjectId();
        const rootPath = getSelectedProjectInfo()?.rootPath;
        if (!projectId || !rootPath) return;
        
        const mapData = canvasController.getMapData();
        await api.saveApplicationMap({ rootPath, map: mapData });
      }, 1000);
    }

    function resetForNoProject() {
      if (centerTabs) centerTabs.classList.add('hidden');
      closeInspector();
      switchTab('chat');
    }

    return {
      init,
      loadProjectMap,
      resetForNoProject,
      switchTab
    };
  }

  window.FaberApplicationMap = {
    createApplicationMapController
  };
})();
