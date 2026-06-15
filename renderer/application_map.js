(function () {
  function createApplicationMapController(options = {}) {
    const api = options.api || {};
    const getSelectedProjectId = typeof options.getSelectedProjectId === 'function' ? options.getSelectedProjectId : () => '';
    const getSelectedProjectInfo = typeof options.getSelectedProjectInfo === 'function' ? options.getSelectedProjectInfo : () => null;
    const appendMessage = typeof options.appendMessage === 'function' ? options.appendMessage : () => {};

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
        onNodeSelected: (node) => {
          if (node) {
            openInspector(node);
          } else {
            closeInspector();
          }
        },
        onMapChanged: () => {
          triggerAutosave();
        }
      });

      // Bind toolbar actions
      const tools = [
        { id: 'btn-map-tool-select', tool: 'select' },
        { id: 'btn-map-tool-add-group', tool: 'add-group' },
        { id: 'btn-map-tool-add-card', tool: 'add-card' },
        { id: 'btn-map-tool-add-image', tool: 'add-image' },
        { id: 'btn-map-tool-add-decision', tool: 'add-decision' },
        { id: 'btn-map-tool-connect', tool: 'connect' }
      ];

      tools.forEach((t) => {
        const btn = container.querySelector(`#${t.id}`);
        if (btn) {
          btn.addEventListener('click', () => {
            tools.forEach((x) => {
              const b = container.querySelector(`#${x.id}`);
              if (b) b.classList.toggle('active', x.id === t.id);
            });
            canvasController.setTool(t.tool);
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
        btnClear.addEventListener('click', () => {
          canvasController.clearMap();
        });
      }

      // Render
      const btnRender = container.querySelector('#btn-map-render');
      if (btnRender) {
        btnRender.addEventListener('click', async () => {
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
      const btnAi = container.querySelector('#btn-map-ai');
      if (btnAi) {
        btnAi.addEventListener('click', () => {
          const chatInput = document.getElementById('user-input');
          if (chatInput) {
            chatInput.value = 'Por favor, analise a estrutura atual do meu Mapa da Aplicação. Aponte possíveis lacunas na modelagem de Frontend, Backend ou APIs e sugira novas seções ou conexões importantes.';
            switchTab('chat');
            chatInput.focus();
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

          const result = await api.importApplicationMapAsset({
            rootPath,
            sourcePath: file.path,
            kind: 'references'
          });

          if (result.ok && result.asset) {
            canvasController.updateSelectedNode({
              assetId: result.asset.projectRelativePath,
              content: result.asset.projectRelativePath
            });
            // Reload inspector field content
            inspectorContent.value = result.asset.projectRelativePath;
          } else {
            alert('Falha ao importar imagem: ' + (result.message || 'Erro desconhecido.'));
          }
        });
      }
    }

    function switchTab(mode) {
      const chatRegion = document.getElementById('workspace-chat-region');
      const mapRegion = document.getElementById('workspace-map-region');
      const welcomePanel = document.getElementById('welcome-panel');

      if (mode === 'chat') {
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
