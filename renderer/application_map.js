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

    const inspector = container.querySelector('#application-map-inspector');
    const inspectorTitle = container.querySelector('#inspector-node-title');
    const inspectorDesc = container.querySelector('#inspector-node-desc');
    const inspectorContent = container.querySelector('#inspector-node-content');
    const inspectorAssetField = container.querySelector('#inspector-asset-upload-field');
    const inspectorAssetInput = container.querySelector('#map-asset-file-input');
    const inspectorTags = container.querySelector('#inspector-node-tags');
    const inspectorClose = container.querySelector('#btn-map-inspector-close');
    const inspectorDelete = container.querySelector('#btn-map-delete-node');

    let canvasController = null;
    let autosaveTimeout = null;

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

      let mapChatMessages = [];

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

      async function sendMapChatMessage(userText) {
        if (!userText.trim()) return;

        appendMapChatMessage('user', userText);
        mapChatMessages.push({ role: 'user', content: userText });

        const thinking = showMapChatThinking();

        // Build context hint from current map data
        const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };
        
        // Build a structured Markdown representation of the Application Map
        let mapMarkdown = "# MAPA DA APLICAÇÃO ATUAL (BOARD)\n\n";
        
        const rootNodes = mapData.nodes.filter(n => !n.parentId);
        const childNodes = mapData.nodes.filter(n => n.parentId);
        
        // Render groups and their children
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
        
        // Render standalone nodes
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
        
        // Render connections (edges)
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
          `4. Responda em linguagem natural, amigável, clara e objetiva.`;

        try {
          const response = await api.sendAssistantMessage({
            projectInfo: getSelectedProjectInfo(),
            userMessage: userText,
            contextHint: systemGuidance,
            conversationMessages: mapChatMessages.map(m => ({ role: m.role, text: m.content }))
          });

          hideMapChatThinking();

          if (response && response.ok && response.response) {
            appendMapChatMessage('assistant', response.response);
            mapChatMessages.push({ role: 'assistant', content: response.response });
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

      const btnAi = container.querySelector('#btn-map-ai');
      if (btnAi) {
        btnAi.addEventListener('click', () => {
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

            if (mapChatLog && mapChatLog.children.length === 0) {
              appendMapChatMessage('assistant', 'Olá! Sou seu assistente de modelagem do Mapa da Aplicação. Posso ajudar você a detalhar os requisitos, documentar as telas, fluxos e referências que desenhou no board. Do que precisa agora?');
            }
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
          content: inspectorContent.value,
          tags: inspectorTags.value.split(',').map((t) => t.trim()).filter(Boolean)
        });
      };

      [inspectorTitle, inspectorDesc, inspectorContent, inspectorTags].forEach((field) => {
        if (field) {
          field.addEventListener('input', updateSelectedNodeData);
        }
      });

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
              }
            } else {
              alert('Falha ao importar imagem: ' + (result.message || 'Erro desconhecido.'));
            }
          };
          reader.readAsDataURL(file);
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
        const btnAi = container.querySelector('#btn-map-ai');
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

        // Draw connections after tab is shown and dimensions are computed
        setTimeout(() => {
          if (canvasController) canvasController.drawEdges();
        }, 100);
      }
    }

    function openInspector(node) {
      if (!inspector) return;
      inspectorTitle.value = node.title || '';
      inspectorDesc.value = node.description || '';
      inspectorContent.value = node.content || '';
      inspectorTags.value = Array.isArray(node.tags) ? node.tags.join(', ') : '';

      // Only show upload button for image or group node types
      if (inspectorAssetField) {
        inspectorAssetField.style.display = (node.type === 'image' || node.type === 'group') ? 'block' : 'none';
      }

      inspector.classList.add('open');
    }

    function closeInspector() {
      if (!inspector) return;
      inspector.classList.remove('open');
    }

    async function loadProjectMap(projectId) {
      const rootPath = getSelectedProjectInfo()?.rootPath;
      if (!rootPath) return;

      const result = await api.getApplicationMap({ rootPath });
      if (result && result.ok && result.map) {
        canvasController.loadMapData(result.map);
      }
      
      // Auto-toggle tab: Show Map for new projects with 0 files
      const hasFiles = Number(getSelectedProjectInfo()?.totalFiles || 0) > 0;
      if (centerTabs) centerTabs.classList.remove('hidden');
      switchTab(hasFiles ? 'chat' : 'map');
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
      resetForNoProject
    };
  }

  window.FaberApplicationMap = {
    createApplicationMapController
  };
})();
