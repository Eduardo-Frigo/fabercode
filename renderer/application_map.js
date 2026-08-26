(function () {
  function createApplicationMapController(options = {}) {
    const api = options.api || {};
    const getSelectedProjectId = typeof options.getSelectedProjectId === 'function' ? options.getSelectedProjectId : () => '';
    const getSelectedProjectInfo = typeof options.getSelectedProjectInfo === 'function' ? options.getSelectedProjectInfo : () => null;
    const appendMessage = typeof options.appendMessage === 'function' ? options.appendMessage : () => {};
    const getTerminalController = typeof options.getTerminalController === 'function' ? options.getTerminalController : () => null;
    const getLocale = typeof options.getLocale === 'function'
      ? options.getLocale
      : () => document.documentElement.lang || 'pt-BR';

    function tutorialText(path, variables = {}, fallback = '') {
      const copy = window.FaberTutorialCopy;
      if (!copy || typeof copy.translate !== 'function') return fallback;
      return copy.translate(getLocale(), path, variables, fallback);
    }

    function tutorialValue(path, fallback = null) {
      const copy = window.FaberTutorialCopy;
      if (!copy || typeof copy.value !== 'function') return fallback;
      return copy.value(getLocale(), path, fallback);
    }

    function uiText(key, fallback, variables = {}) {
      const template = window.t ? window.t(key, fallback) : fallback;
      return Object.entries(variables).reduce(
        (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
        String(template || ''),
      );
    }

    const RENDER_PLAN_COPY_KEYS = Object.freeze([
      'mapUntitledItem',
      'renderCheckDocsLabel',
      'renderCheckDocsHint',
      'renderCheckTradeoffsLabel',
      'renderCheckTradeoffsHint',
      'renderCheckSecurityLabel',
      'renderCheckSecurityHint',
      'renderCheckBrandingLabel',
      'renderCheckBrandingHint',
      'renderDefaultTask',
      'renderDocsGapTitle',
      'renderDocsGapSummary',
      'renderDocsGapFallback',
      'renderDocsGapNotes',
      'renderFoundationTitle',
      'renderFoundationSummary',
      'renderFoundationTaskOne',
      'renderFoundationTaskTwo',
      'renderFoundationTaskThree',
      'renderFoundationTaskFour',
      'renderFoundationNotes',
      'renderNodesConsidered',
      'renderDesignTitle',
      'renderDesignSummary',
      'renderDesignTaskOne',
      'renderDesignTaskTwo',
      'renderDesignTaskThree',
      'renderDesignTaskFour',
      'renderDesignNotes',
      'renderProductTitle',
      'renderProductSummary',
      'renderProductTaskOne',
      'renderProductTaskTwo',
      'renderProductTaskThree',
      'renderProductTaskFour',
      'renderProductNotes',
      'renderProductRealUserTask',
      'renderBackendTitle',
      'renderBackendSummary',
      'renderBackendTaskOne',
      'renderBackendTaskTwo',
      'renderBackendTaskThree',
      'renderBackendTaskFour',
      'renderBackendNotes',
      'renderPentestTitle',
      'renderPentestSummary',
      'renderPentestTaskOne',
      'renderPentestTaskTwo',
      'renderPentestTaskThree',
      'renderPentestTaskFour',
      'renderLoggingTaskOne',
      'renderLoggingTaskTwo',
      'renderLoggingTaskThree',
      'renderRealUsersTitle',
      'renderRealUsersSummary',
      'renderRealUsersTaskOne',
      'renderRealUsersTaskTwo',
      'renderRealUsersTaskThree',
      'renderRealUsersTaskFour',
      'renderDeliveryTitle',
      'renderDeliverySummary',
      'renderDeliveryTaskOne',
      'renderDeliveryTaskTwo',
      'renderDeliveryTaskThree',
      'renderDeliveryTaskFour',
      'renderDeliveryNotes',
      'renderDeliveryLoggingTaskOne',
      'renderDeliveryLoggingTaskTwo',
      'renderRefinementNotes',
      'renderReleaseTitle',
      'renderReleaseSummary',
      'renderReleaseTaskOne',
      'renderReleaseTaskTwo',
      'renderReleaseTaskThree',
    ]);

    function buildRenderPlanCopy() {
      return RENDER_PLAN_COPY_KEYS.reduce((copy, key) => {
        copy[key] = uiText(key, '');
        return copy;
      }, {});
    }

    function responseLanguageInstruction() {
      return uiText(
        'respondInInterfaceLanguage',
        'Responda integralmente em português do Brasil, inclusive títulos, rótulos e critérios.',
      );
    }

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
    let prepareTutorialMapConversationHandler = null;
    let simulateTutorialMapConversationHandler = null;
    let showTutorialMapCanvasHandler = null;
    let prepareTutorialMapHistoryHandler = null;
    let prepareTutorialMapAnalysisHandler = null;
    let generateTutorialRenderDraftHandler = null;
    let setMapSidePanelMode = () => {};

    function insertMarkdown(format) {
      if (!contentEditor) return;
      const doc = contentEditor.getDoc();
      const cursor = doc.getCursor();
      const selection = doc.getSelection();

      let replacement = '';
      let cursorOffset = 0;

      switch (format) {
        case 'h1':
          replacement = `# ${selection || uiText('markdownHeadingOnePlaceholder', 'Título 1')}`;
          break;
        case 'h2':
          replacement = `## ${selection || uiText('markdownHeadingTwoPlaceholder', 'Título 2')}`;
          break;
        case 'bold':
          replacement = `**${selection || uiText('markdownTextPlaceholder', 'texto')}**`;
          cursorOffset = selection ? 0 : -2;
          break;
        case 'italic':
          replacement = `*${selection || uiText('markdownTextPlaceholder', 'texto')}*`;
          cursorOffset = selection ? 0 : -1;
          break;
        case 'list':
          replacement = `- ${selection || uiText('markdownListItemPlaceholder', 'item')}`;
          break;
        case 'code':
          replacement = `\`\`\`\n${selection || uiText('markdownCodePlaceholder', 'código')}\n\`\`\``;
          break;
        case 'link':
          replacement = `[${selection || uiText('markdownLinkPlaceholder', 'link')}](url)`;
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


      // Ask IA
      const mapChatPanel = document.getElementById('workspace-map-chat-panel');
      const mapChatLog = document.getElementById('map-chat-log');
      const mapChatTextarea = document.getElementById('map-chat-textarea');
      const btnMapChatSend = document.getElementById('btn-map-chat-send');
      const rightPanelTitle = document.getElementById('right-panel-title');
      const btnMapChatNew = document.getElementById('btn-map-chat-new');
      const btnMapRenderLauncher = document.getElementById('btn-map-render-launcher');

      const mapChatListView = document.getElementById('map-chat-list-view');
      const mapConversationsList = document.getElementById('map-conversations-list');
      const mapChatSessionView = document.getElementById('map-chat-session-view');
      const btnMapChatBack = document.getElementById('btn-map-chat-back');
      const mapChatSessionTitle = document.getElementById('map-chat-session-title');
      const renderPanel = document.getElementById('workspace-map-render-panel');
      const renderListView = document.getElementById('map-render-list-view');
      const renderSessionView = document.getElementById('map-render-session-view');
      const renderListBack = document.getElementById('btn-map-render-list-back');
      const renderPanelOpen = document.getElementById('btn-map-render-open');
      const renderSessionBack = document.getElementById('btn-map-render-back');
      const renderPanelSave = document.getElementById('btn-map-render-save');
      const renderPanelStatus = document.getElementById('map-render-status');
      const renderPanelCopy = document.getElementById('map-render-copy');
      const renderConversationsList = document.getElementById('map-render-conversations-list');
      const renderSessionTitle = document.getElementById('map-render-session-title');
      const renderSessionStatus = document.getElementById('map-render-session-status');
      const renderSessionLog = document.getElementById('map-render-session-log');
      const renderSessionPlanCard = document.getElementById('map-render-plan-card');
      const renderSessionChecklist = document.getElementById('map-render-session-checklist');
      const renderSessionMilestones = document.getElementById('map-render-session-milestones');
      const renderAttachmentList = document.getElementById('map-render-attachment-list');
      const renderSessionTextarea = document.getElementById('map-render-textarea');
      const renderAttachButton = document.getElementById('btn-map-render-attach');
      const renderSessionSend = document.getElementById('btn-map-render-send');
      const renderFileInput = document.getElementById('map-render-file-input');

      let mapChatMessages = [];
      let activeConversationId = null;
      let renderDraft = null;
      let renderMessages = [];
      let renderConversations = [];
      let activeRenderConversationId = null;
      let renderAttachments = [];
      let renderWorkflowBusy = false;
      let renderPlanUpdating = false;
      let renderPanelView = 'list';
      let tutorialMapCorrectionRecorded = false;

      setRenderPanelView('list');
      renderRenderPanel();

      function appendMapChatMessage(role, text) {
        if (!mapChatLog) return null;
        const bubble = document.createElement('div');
        bubble.className = `msg ${role}`;
        bubble.textContent = text;
        mapChatLog.appendChild(bubble);
        mapChatLog.scrollTop = mapChatLog.scrollHeight;
        return bubble;
      }

      function describeMapProposalOperation(operation) {
        if (!operation || typeof operation !== 'object') {
          return uiText('mapProposalUnknownOperation', 'Operação estruturada');
        }
        if (operation.kind === 'upsert_node') {
          const node = operation.node || {};
          return uiText('mapProposalUpsertNode', 'Adicionar ou atualizar nó: {value}', {
            value: node.title || node.id || uiText('untitled', 'Sem título'),
          });
        }
        if (operation.kind === 'remove_node') {
          return uiText('mapProposalRemoveNode', 'Remover nó: {value}', {
            value: operation.nodeId || '',
          });
        }
        if (operation.kind === 'upsert_edge') {
          const edge = operation.edge || {};
          return uiText('mapProposalUpsertEdge', 'Adicionar ou atualizar conexão: {value}', {
            value: edge.id || '',
          });
        }
        if (operation.kind === 'remove_edge') {
          return uiText('mapProposalRemoveEdge', 'Remover conexão: {value}', {
            value: operation.edgeId || '',
          });
        }
        if (operation.kind === 'set_viewport') {
          return uiText('mapProposalSetViewport', 'Atualizar enquadramento do mapa');
        }
        return uiText('mapProposalUnknownOperation', 'Operação estruturada');
      }

      async function appendMapChatProposalPreview({
        projectId,
        rootPath,
        conversationId,
        proposalDraft,
      }) {
        if (!proposalDraft || proposalDraft.schemaVersion !== 'application-map-patch.v1'
          || !Array.isArray(proposalDraft.operations) || !proposalDraft.operations.length
          || !api || typeof api.previewMapChatApplicationMapPatch !== 'function') return null;

        let preview;
        try {
          preview = await api.previewMapChatApplicationMapPatch({
            projectId,
            rootPath,
            conversationId,
            operations: proposalDraft.operations,
          });
        } catch (error) {
          console.error('[appendMapChatProposalPreview] preview failed:', error);
          return null;
        }
        if (!preview || !preview.ok || !preview.proposal
          || preview.proposal.status !== 'pending') return null;

        let receipt = preview.proposal;
        const card = document.createElement('section');
        card.className = 'map-chat-proposal-card';

        const title = document.createElement('strong');
        title.className = 'map-chat-proposal-title';
        title.textContent = uiText('mapProposalReviewTitle', 'Prévia de alteração do mapa');
        card.appendChild(title);

        const list = document.createElement('ul');
        list.className = 'map-chat-proposal-list';
        proposalDraft.operations.forEach((operation) => {
          const item = document.createElement('li');
          item.textContent = describeMapProposalOperation(operation);
          list.appendChild(item);
        });
        card.appendChild(list);

        const status = document.createElement('span');
        status.className = 'map-chat-proposal-status';
        status.textContent = uiText('mapProposalPending', 'Aguardando sua aprovação');
        card.appendChild(status);

        const actions = document.createElement('div');
        actions.className = 'map-chat-proposal-actions';
        const rejectButton = document.createElement('button');
        rejectButton.type = 'button';
        rejectButton.className = 'map-chat-proposal-reject';
        rejectButton.textContent = uiText('reject', 'Rejeitar');
        const approveButton = document.createElement('button');
        approveButton.type = 'button';
        approveButton.className = 'map-chat-proposal-approve';
        approveButton.textContent = uiText('approve', 'Aprovar');
        actions.append(rejectButton, approveButton);
        card.appendChild(actions);

        const setBusy = (busy) => {
          rejectButton.disabled = busy;
          approveButton.disabled = busy;
        };
        const decisionPayload = () => ({
          projectId,
          rootPath,
          conversationId,
          proposalId: receipt.proposalId,
          expectedRevision: receipt.revision,
          patchDigest: receipt.patchDigest,
        });

        rejectButton.addEventListener('click', async () => {
          if (!receipt || receipt.status !== 'pending') return;
          setBusy(true);
          status.textContent = uiText('mapProposalRejecting', 'Rejeitando proposta...');
          try {
            const result = await api.rejectMapChatProposal(decisionPayload());
            if (!result || !result.ok || !result.proposal) {
              throw new Error(result && (result.code || result.message) || 'proposal_reject_failed');
            }
            receipt = result.proposal;
            card.classList.add('is-rejected');
            status.textContent = uiText('mapProposalRejected', 'Proposta rejeitada');
          } catch (error) {
            console.error('[appendMapChatProposalPreview] rejection failed:', error);
            status.textContent = uiText('mapProposalDecisionFailed', 'Não foi possível concluir a decisão.');
            setBusy(false);
          }
        });

        approveButton.addEventListener('click', async () => {
          if (!receipt || receipt.status !== 'pending') return;
          const confirmed = window.faberConfirm
            ? await window.faberConfirm(uiText(
                'mapProposalConfirm',
                'Aplicar esta alteração ao mapa? A base será revalidada antes da escrita.',
              ))
            : true;
          if (!confirmed) return;
          setBusy(true);
          status.textContent = uiText('mapProposalApplying', 'Revalidando e aplicando proposta...');
          try {
            const result = await api.approveMapChatProposal(decisionPayload());
            if (!result || !result.ok || !result.proposal) {
              throw new Error(result && (result.code || result.message) || 'proposal_apply_failed');
            }
            receipt = result.proposal;
            card.classList.add('is-applied');
            status.textContent = uiText('mapProposalApplied', 'Alteração aplicada ao mapa');
            const canonical = await api.getApplicationMap({ rootPath });
            if (canonical && canonical.ok && canonical.map && canvasController) {
              canvasController.loadMapData(canonical.map);
            }
            window.dispatchEvent(new CustomEvent('faber:application-map-updated', {
              detail: { rootPath },
            }));
          } catch (error) {
            console.error('[appendMapChatProposalPreview] approval failed:', error);
            status.textContent = uiText('mapProposalDecisionFailed', 'Não foi possível concluir a decisão.');
            setBusy(false);
          }
        });

        if (mapChatLog) {
          mapChatLog.appendChild(card);
          mapChatLog.scrollTop = mapChatLog.scrollHeight;
        }
        return card;
      }

      prepareTutorialMapConversationHandler = () => {
        if (inspector && inspector.classList.contains('open')) closeInspector();
        setMapSidePanelMode('mode-map-chat');

        const rightToggle = document.getElementById('workspace-collapse-right');
        if (document.body.classList.contains('workspace-right-collapsed') && rightToggle) {
          rightToggle.click();
        }

        activeConversationId = null;
        tutorialMapCorrectionRecorded = false;
        mapChatMessages = [];
        if (mapChatSessionTitle) mapChatSessionTitle.textContent = tutorialText('mapChat.conversationTitle', {}, 'Planejamento da página de boas-vindas');
        if (mapChatListView) mapChatListView.classList.add('hidden');
        if (mapChatSessionView) mapChatSessionView.classList.remove('hidden');
        if (mapChatLog) mapChatLog.innerHTML = '';
        if (mapChatTextarea) mapChatTextarea.value = '';
        return true;
      };

      simulateTutorialMapConversationHandler = async (userText, assistantText) => {
        if (!mapChatSessionView || mapChatSessionView.classList.contains('hidden')) {
          prepareTutorialMapConversationHandler();
        }

        const projectId = getSelectedProjectId();
        if (!activeConversationId && projectId && api && typeof api.addConversation === 'function') {
          try {
            const result = await api.addConversation({
              projectId,
              title: tutorialText('mapChat.conversationTitle', {}, 'Planejamento da página de boas-vindas'),
              meta: { source: 'map_chat', tutorial: true },
            });
            if (result && result.ok && result.conversation) {
              activeConversationId = result.conversation.id;
            }
          } catch (error) {
            console.error('[simulateTutorialMapConversation] failed to create conversation:', error);
          }
        }

        const persistTutorialMessage = async (role, text) => {
          if (!projectId || !activeConversationId || !api || typeof api.addConversationMessage !== 'function') return;
          try {
            await api.addConversationMessage({
              projectId,
              conversationId: activeConversationId,
              role,
              text,
              meta: { mode: 'map_chat', source: 'map_chat', tutorial: true },
            });
          } catch (error) {
            console.error('[simulateTutorialMapConversation] failed to persist message:', error);
          }
        };

        appendMapChatMessage('user', userText);
        mapChatMessages.push({ role: 'user', content: userText });
        await persistTutorialMessage('user', userText);
        const thinking = showMapChatThinking();
        await new Promise((resolve) => window.setTimeout(resolve, 850));
        if (thinking) thinking.remove();
        const assistantBubble = appendMapChatMessage('assistant', assistantText);
        mapChatMessages.push({ role: 'assistant', content: assistantText });
        await persistTutorialMessage('assistant', assistantText);
        if (assistantBubble) {
          assistantBubble.classList.add('tutorial-map-gap-message');
          const addGapButton = document.createElement('button');
          addGapButton.id = 'btn-map-chat-add-gap';
          addGapButton.type = 'button';
          addGapButton.className = 'map-chat-add-gap-btn';
          const addGapLabel = tutorialText('mapChat.addGap', {}, 'Adicionar documento de SEO ao mapa');
          addGapButton.textContent = addGapLabel;
          addGapButton.setAttribute('aria-label', addGapLabel);
          assistantBubble.appendChild(addGapButton);
          mapChatLog.scrollTop = mapChatLog.scrollHeight;
        }
        return true;
      };

      showTutorialMapCanvasHandler = () => {
        if (inspector && inspector.classList.contains('open')) closeInspector();
        setMapSidePanelMode(null);
        return true;
      };

      prepareTutorialMapHistoryHandler = async () => {
        if (inspector && inspector.classList.contains('open')) closeInspector();
        setMapSidePanelMode('mode-map-chat');
        const rightToggle = document.getElementById('workspace-collapse-right');
        if (document.body.classList.contains('workspace-right-collapsed') && rightToggle) {
          rightToggle.click();
        }

        if (!tutorialMapCorrectionRecorded && activeConversationId && api && typeof api.addConversationMessage === 'function') {
          const projectId = getSelectedProjectId();
          const correctionMessage = tutorialText('mapChat.correction', {}, 'A sugestão foi adicionada ao mapa.');
          try {
            await api.addConversationMessage({
              projectId,
              conversationId: activeConversationId,
              role: 'assistant',
              text: correctionMessage,
              meta: { mode: 'map_chat', source: 'map_chat', tutorial: true },
            });
            tutorialMapCorrectionRecorded = true;
          } catch (error) {
            console.error('[prepareTutorialMapHistory] failed to persist correction:', error);
          }
        }

        await loadMapConversations();
        return true;
      };

      prepareTutorialMapAnalysisHandler = () => {
        if (inspector && inspector.classList.contains('open')) closeInspector();
        setMapSidePanelMode('mode-map-render');
        const rightToggle = document.getElementById('workspace-collapse-right');
        if (document.body.classList.contains('workspace-right-collapsed') && rightToggle) {
          rightToggle.click();
        }
        setRenderPanelView('list');
        renderRenderPanel();
        return true;
      };

      function showMapChatThinking() {
        if (!mapChatLog) return null;
        const thinking = document.createElement('div');
        thinking.className = 'msg assistant thinking';
        thinking.id = 'map-chat-thinking';
        const label = document.createElement('span');
        label.textContent = tutorialText('mapChat.thinking', {}, 'Pensando...');
        thinking.appendChild(label);
        mapChatLog.appendChild(thinking);
        mapChatLog.scrollTop = mapChatLog.scrollHeight;
        return thinking;
      }

      function hideMapChatThinking() {
        const thinking = document.getElementById('map-chat-thinking');
        if (thinking) thinking.remove();
      }

      function escapeHtml(text) {
        return String(text || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }


      function getRenderMapMarkdown(mapData = {}) {
        let markdown = `# ${uiText('mapExportTitle', 'MAPA DA APLICAÇÃO PARA RENDERIZAÇÃO')}\n\n`;
        const rootNodes = Array.isArray(mapData.nodes) ? mapData.nodes.filter((node) => node && !node.parentId) : [];
        const childNodes = Array.isArray(mapData.nodes) ? mapData.nodes.filter((node) => node && node.parentId) : [];
        const groups = rootNodes.filter((node) => node.type === 'group' || node.type === 'folder');

        if (groups.length) {
          markdown += `## ${uiText('mapExportGroups', 'GRUPOS / MÓDULOS')}\n`;
          groups.forEach((group) => {
            markdown += `### ${group.title || uiText('mapUntitledGroup', 'Grupo sem título')}\n`;
            if (group.description) markdown += `${group.description}\n`;
            const children = childNodes.filter((child) => child.parentId === group.id);
            if (children.length) {
              markdown += '\n';
              children.forEach((child) => {
                markdown += `- [${child.type || 'node'}] ${child.title || uiText('mapUntitledItem', 'Sem título')}`;
                if (child.description) markdown += ` — ${child.description}`;
                if (child.content) markdown += ` (${uiText('mapExportContent', 'Conteúdo')}: ${child.content})`;
                markdown += '\n';
              });
            }
            markdown += '\n';
          });
        }

        const standalone = rootNodes.filter((node) => node.type !== 'group' && node.type !== 'folder');
        if (standalone.length) {
          markdown += `## ${uiText('mapExportStandaloneItems', 'ITENS AVULSOS')}\n`;
          standalone.forEach((node) => {
            markdown += `- [${node.type || 'node'}] ${node.title || uiText('mapUntitledItem', 'Sem título')}`;
            if (node.description) markdown += ` — ${node.description}`;
            if (node.content) markdown += ` (${uiText('mapExportContent', 'Conteúdo')}: ${node.content})`;
            markdown += '\n';
          });
        }

        if (Array.isArray(mapData.edges) && mapData.edges.length) {
          markdown += `\n## ${uiText('mapExportConnections', 'CONEXÕES')}\n`;
          mapData.edges.forEach((edge) => {
            const source = Array.isArray(mapData.nodes) ? mapData.nodes.find((node) => node.id === edge.sourceNodeId) : null;
            const target = Array.isArray(mapData.nodes) ? mapData.nodes.find((node) => node.id === edge.targetNodeId) : null;
            if (source && target) {
              markdown += `- ${source.title || source.id} -> ${target.title || target.id}`;
              if (edge.type) markdown += ` (${edge.type})`;
              markdown += '\n';
            }
          });
        }

        return markdown.trim();
      }

      async function collectRenderDocumentation(rootPath, mapData = {}) {
        const rootNodes = Array.isArray(mapData.nodes) ? mapData.nodes.filter((node) => node && !node.parentId) : [];
        const groups = rootNodes.filter((node) => node.type === 'group' || node.type === 'folder');
        const docPaths = [
          'docs/application-map/README.md',
          'docs/application-map/decisions.md',
          'docs/application-map/open-questions.md',
        ];

        groups.forEach((group) => {
          const fileBasename = String(group.title || 'grupo')
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '-') + '.md';
          docPaths.push(`docs/application-map/${fileBasename}`);
        });

        const uniquePaths = [...new Set(docPaths)];
        const documents = [];
        let combinedText = '';

        for (const relativePath of uniquePaths) {
          try {
            const result = await api.readProjectFile({ projectInfo: { rootPath }, relativePath });
            if (result && result.ok && result.content) {
              documents.push({ path: relativePath, content: result.content });
              combinedText += `\n\n### ${relativePath}\n${result.content}`;
            }
          } catch (error) {
            console.warn('[collectRenderDocumentation] Failed to read ' + relativePath, error);
          }
        }

        return { documents, combinedText: combinedText.trim() };
      }

      function buildTutorialRenderMilestones(mapData = {}) {
        const frontendDoc = { path: 'docs/application-map/frontend.md' };
        const rulesDoc = { path: 'docs/application-map/regras.md' };
        const readmeDoc = { path: 'docs/application-map/README.md' };
        const decisionsDoc = { path: 'docs/application-map/decisions.md' };
        const openQuestionsDoc = { path: 'docs/application-map/open-questions.md' };
        const definitions = tutorialValue('render.milestones', []);
        const referenceSets = [
          [frontendDoc, decisionsDoc, readmeDoc],
          [frontendDoc, readmeDoc, rulesDoc],
          [rulesDoc, openQuestionsDoc, readmeDoc],
        ];

        const milestone = (number, title, summary, tasks, references, extra = {}) => ({
          id: `tutorial-render-milestone-${number}`,
          number,
          title,
          summary,
          status: 'planned',
          tasks: tasks.map((taskTitle, taskIndex) => ({
            id: `tutorial-render-task-${number}-${taskIndex + 1}`,
            title: taskTitle,
            status: 'pending',
          })),
          acceptanceCriteria: extra.acceptanceCriteria || '',
          validationCommands: extra.validationCommands || '',
          commits: [],
          notes: extra.notes || '',
          references,
          changeMarker: null,
        });

        return definitions.map((definition, index) => milestone(
          index + 1,
          definition.title || '',
          definition.summary || '',
          Array.isArray(definition.tasks) ? definition.tasks : [],
          referenceSets[index] || [readmeDoc],
          {
            acceptanceCriteria: definition.acceptanceCriteria || '',
            validationCommands: definition.validationCommands || '',
            notes: definition.notes || '',
          }
        ));
      }

      function formatRenderConversationDate(value) {
        const date = value ? new Date(value) : new Date();
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString(getLocale(), {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      }

      function getRenderConversationById(conversationId) {
        return Array.isArray(renderConversations)
          ? renderConversations.find((conversation) => conversation && conversation.id === conversationId) || null
          : null;
      }

      function getActiveRenderConversation() {
        return activeRenderConversationId ? getRenderConversationById(activeRenderConversationId) : null;
      }

      function toRenderMessage(message = {}) {
        return {
          role: message.role === 'user' ? 'user' : 'assistant',
          content: message.content || message.text || '',
          attachments: Array.isArray(message.attachments)
            ? message.attachments.map((attachment) => ({ ...attachment }))
            : [],
        };
      }

      function normalizeRenderConversation(conversation = {}) {
        return {
          id: conversation.id,
          title: conversation.title || 'Render do Mapa',
          createdAt: conversation.createdAt || new Date().toISOString(),
          updatedAt: conversation.updatedAt || conversation.createdAt || new Date().toISOString(),
          source: 'map_render',
          messages: Array.isArray(conversation.messages)
            ? conversation.messages.map(toRenderMessage)
            : [],
          draft: conversation.draft ? { ...conversation.draft } : null,
          lastAttachments: Array.isArray(conversation.lastAttachments)
            ? conversation.lastAttachments.map((attachment) => ({ ...attachment }))
            : [],
        };
      }

      function syncRenderConversationState() {
        const activeConversation = getActiveRenderConversation();
        if (!activeConversation) return;

        activeConversation.messages = Array.isArray(renderMessages)
          ? renderMessages.map((message) => ({ ...message }))
          : [];
        activeConversation.draft = renderDraft ? { ...renderDraft } : null;
        activeConversation.updatedAt = new Date().toISOString();
        if (renderAttachments && renderAttachments.length) {
          activeConversation.lastAttachments = renderAttachments.map((attachment) => ({ ...attachment }));
        } else {
          activeConversation.lastAttachments = [];
        }
      }

      async function createRenderConversation(title = '') {
        const now = new Date();
        const defaultTitle = `Render do Mapa (${now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`;
        let conversation = {
          id: `render-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: String(title || defaultTitle).trim().slice(0, 80) || defaultTitle,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          source: 'map_render',
          messages: [],
          draft: null,
          lastAttachments: [],
        };

        const projectId = getSelectedProjectId();
        if (projectId && api && typeof api.addConversation === 'function') {
          try {
            const result = await api.addConversation({
              projectId,
              title: conversation.title,
              meta: { source: 'map_render' },
            });
            if (result && result.ok && result.conversation) {
              conversation = normalizeRenderConversation(result.conversation);
            }
          } catch (error) {
            console.error('[createRenderConversation] failed to persist render conversation:', error);
          }
        }

        renderConversations = [conversation, ...renderConversations.filter((item) => item && item.id !== conversation.id)];
        activeRenderConversationId = conversation.id;
        return conversation;
      }

      async function persistRenderConversationMessage(role, text) {
        const projectId = getSelectedProjectId();
        const conversationId = activeRenderConversationId;
        const normalizedText = String(text || '').trim();
        if (!projectId || !conversationId || !normalizedText || !api || typeof api.addConversationMessage !== 'function') {
          return null;
        }

        try {
          return await api.addConversationMessage({
            projectId,
            conversationId,
            role,
            text: normalizedText,
            meta: { mode: 'map_render', source: 'map_render' },
          });
        } catch (error) {
          console.error('[persistRenderConversationMessage] failed:', error);
          return null;
        }
      }

      async function loadRenderConversationMessages(conversationId) {
        if (!conversationId || !api || typeof api.listConversationMessages !== 'function') return [];

        try {
          const result = await api.listConversationMessages({ conversationId, limit: 120 });
          if (result && result.ok && Array.isArray(result.messages)) {
            return result.messages.map(toRenderMessage).filter((message) => message.content);
          }
        } catch (error) {
          console.error('[loadRenderConversationMessages] failed:', error);
        }
        return [];
      }

      async function loadRenderConversationsFromStore(projectId = getSelectedProjectId()) {
        if (!projectId || !api || typeof api.listConversations !== 'function') return;

        try {
          const result = await api.listConversations();
          if (!result || !result.ok) return;

          const conversations = result.conversationsByProject && result.conversationsByProject[projectId]
            ? result.conversationsByProject[projectId]
            : [];
          renderConversations = conversations
            .filter((conversation) => conversation && conversation.source === 'map_render')
            .map(normalizeRenderConversation);

          if (activeRenderConversationId && !getRenderConversationById(activeRenderConversationId)) {
            activeRenderConversationId = null;
          }
          renderRenderConversationsList();
        } catch (error) {
          console.error('[loadRenderConversationsFromStore] failed:', error);
        }
      }

      function setActiveRenderConversation(conversationId) {
        activeRenderConversationId = conversationId || null;
        const activeConversation = getActiveRenderConversation();
        if (activeConversation) {
          renderMessages = Array.isArray(activeConversation.messages) ? activeConversation.messages.map((message) => ({ ...message })) : [];
          renderDraft = activeConversation.draft ? { ...activeConversation.draft } : null;
          renderAttachments = [];
        } else {
          renderMessages = [];
          renderDraft = null;
          renderAttachments = [];
        }
      }

      function renderRenderConversationsList() {
        if (!renderConversationsList) return;
        renderConversationsList.innerHTML = '';

        const conversations = Array.isArray(renderConversations) ? renderConversations : [];
        if (!conversations.length) {
          return;
        }

        conversations.forEach((conversation) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = `map-render-conversation-row${conversation.id === activeRenderConversationId ? ' active' : ''}`;

          const main = document.createElement('div');
          main.className = 'map-render-conversation-row__main';

          const title = document.createElement('strong');
          title.className = 'map-render-conversation-row__title';
          title.textContent = conversation.title || uiText('renderMapTitle', 'Render do Mapa');

          const subtitle = document.createElement('span');
          subtitle.className = 'map-render-conversation-row__subtitle';
          const draft = conversation.draft || {};
          if (draft.ready) {
            subtitle.textContent = `${uiText('renderReadyForMilestones', 'Pronta para milestones')} • ${formatRenderConversationDate(conversation.updatedAt || conversation.createdAt)}`;
          } else if (Array.isArray(draft.missing) && draft.missing.length) {
            subtitle.textContent = `${uiText('renderMissingGaps', 'Faltam informações')} • ${formatRenderConversationDate(conversation.updatedAt || conversation.createdAt)}`;
          } else if (Array.isArray(conversation.messages) && conversation.messages.length) {
            subtitle.textContent = `${uiText('renderChatInProgress', 'Conversa em andamento')} • ${formatRenderConversationDate(conversation.updatedAt || conversation.createdAt)}`;
          } else if (conversation.source === 'map_render') {
            subtitle.textContent = `${window.t ? window.t('renderSaved', 'Renderização salva') : 'Renderização salva'} • ${formatRenderConversationDate(conversation.updatedAt || conversation.createdAt)}`;
          } else {
            subtitle.textContent = `${uiText('renderNewAnalysis', 'Nova renderização')} • ${formatRenderConversationDate(conversation.createdAt)}`;
          }

          main.append(title, subtitle);

          const arrow = document.createElement('span');
          arrow.className = 'map-render-conversation-row__arrow';
          arrow.textContent = '→';

          row.append(main, arrow);
          row.addEventListener('click', async () => {
            await openRenderConversation(conversation.id);
          });
          renderConversationsList.appendChild(row);
        });
      }

      function renderRenderAttachmentList() {
        if (!renderAttachmentList) return;
        renderAttachmentList.innerHTML = '';
        const attachments = Array.isArray(renderAttachments) ? renderAttachments : [];
        renderAttachmentList.classList.toggle('hidden', !attachments.length);
        if (!attachments.length) return;

        attachments.forEach((file, index) => {
          const chip = document.createElement('div');
          chip.className = 'attachment-chip attachment-chip--render';

          if (file && file.path && (String(file.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.path))) {
            const img = document.createElement('img');
            img.className = 'attachment-thumb';
            img.src = `file://${file.path}`;
            chip.appendChild(img);
          }

          const name = document.createElement('span');
          name.className = 'attachment-name';
          name.textContent = file.name || uiText('numberedAttachment', 'Anexo {number}', { number: index + 1 });

          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'attachment-remove';
          remove.title = uiText('removeAttachment', 'Remover anexo');
          remove.textContent = 'x';
          remove.addEventListener('click', () => {
            renderAttachments = renderAttachments.filter((_, attachmentIndex) => attachmentIndex !== index);
            renderRenderAttachmentList();
            syncRenderConversationState();
          });

          chip.append(name, remove);
          renderAttachmentList.appendChild(chip);
        });
      }

      async function openRenderConversation(conversationId) {
        const conversation = getRenderConversationById(conversationId);
        if (!conversation) return;

        activeRenderConversationId = conversation.id;
        if (!Array.isArray(conversation.messages) || !conversation.messages.length) {
          conversation.messages = await loadRenderConversationMessages(conversation.id);
        }
        renderMessages = Array.isArray(conversation.messages)
          ? conversation.messages.map((message) => ({ ...message }))
          : [];
        renderDraft = conversation.draft ? { ...conversation.draft } : null;
        renderAttachments = [];
        setRenderPanelView('session');

        const projectInfo = getSelectedProjectInfo();
        const rootPath = projectInfo?.rootPath || '';
        if (rootPath) {
          const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };
          const documentation = await collectRenderDocumentation(rootPath, mapData);
          const lastAssistant = [...renderMessages].reverse().find((message) => message && message.role === 'assistant');
          if (!renderDraft) {
            rebuildRenderDraft(mapData, documentation, lastAssistant ? lastAssistant.content : '');
          } else {
            const rebuilt = rebuildRenderDraft(mapData, documentation, lastAssistant ? lastAssistant.content : '');
            renderDraft = {
              ...renderDraft,
              ...rebuilt,
              milestones: Array.isArray(renderDraft.milestones) && renderDraft.milestones.length
                ? renderDraft.milestones
                : rebuilt.milestones,
            };
            syncRenderConversationState();
          }
        }

        renderRenderPanel();
      }

      function setRenderPanelView(nextView) {
        renderPanelView = nextView === 'session' ? 'session' : 'list';
        renderRenderPanel();
      }

      function renderRenderMessage(role, text, attachments = []) {
        if (!renderSessionLog) return;
        const bubble = document.createElement('div');
        bubble.className = `msg ${role}`;
        bubble.textContent = text;
        if (Array.isArray(attachments) && attachments.length) {
          const attachmentRow = document.createElement('div');
          attachmentRow.className = 'msg-attachments msg-attachments--render';
          attachments.forEach((attachment) => {
            if (attachment && attachment.path && (String(attachment.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(attachment.path))) {
              const img = document.createElement('img');
              img.src = `file://${attachment.path}`;
              attachmentRow.appendChild(img);
            } else {
              const pill = document.createElement('span');
              pill.className = 'attachment-chip attachment-chip--render';
              pill.textContent = attachment && attachment.name ? attachment.name : uiText('attachMapRender', 'Anexar');
              attachmentRow.appendChild(pill);
            }
          });
          bubble.appendChild(attachmentRow);
        }
        renderSessionLog.appendChild(bubble);
        renderSessionLog.scrollTop = renderSessionLog.scrollHeight;
      }

      function showRenderThinking() {
        if (!renderSessionLog) return null;
        const thinking = document.createElement('div');
        thinking.className = 'msg assistant thinking';
        thinking.id = 'render-thinking';
        thinking.innerHTML = `<span>${uiText('renderThinking', 'Analisando...')}</span>`;
        renderSessionLog.appendChild(thinking);
        renderSessionLog.scrollTop = renderSessionLog.scrollHeight;
        return thinking;
      }

      function hideRenderThinking() {
        const thinking = document.getElementById('render-thinking');
        if (thinking) thinking.remove();
      }

      function setRenderPlanUpdating(isUpdating) {
        renderPlanUpdating = Boolean(isUpdating);
        if (renderSessionPlanCard) {
          renderSessionPlanCard.classList.toggle('is-updating', renderPlanUpdating);
          renderSessionPlanCard.setAttribute('aria-busy', renderPlanUpdating ? 'true' : 'false');
        }
      }

      function showRenderStatusTicker() {
        if (!renderSessionLog) return null;
        const ticker = document.createElement('div');
        ticker.className = 'map-chat-status-ticker map-render-status-ticker';
        ticker.id = 'render-status-ticker';
        ticker.innerHTML = `
          <div class="ticker-step" id="render-step-export-md"><span class="status-dot"></span> <span>${uiText('renderExportingMarkdowns', 'Exportando os Markdowns do mapa...')}</span></div>
          <div class="ticker-step" id="render-step-send-images"><span class="status-dot"></span> <span>${uiText('renderSendingImages', 'Preparando imagens e referências...')}</span></div>
          <div class="ticker-step" id="render-step-analyze-info"><span class="status-dot"></span> <span>${uiText('renderAnalyzingInfo', 'Analisando as informações do projeto...')}</span></div>
          <div class="ticker-step" id="render-step-contextualized"><span class="status-dot"></span> <span>${uiText('renderContextReady', 'Contexto preparado. Iniciando o planejamento...')}</span></div>
        `;
        renderSessionLog.appendChild(ticker);
        renderSessionLog.scrollTop = renderSessionLog.scrollHeight;
        return {
          ticker,
          exportStep: document.getElementById('render-step-export-md'),
          sendStep: document.getElementById('render-step-send-images'),
          analyzeStep: document.getElementById('render-step-analyze-info'),
          contextualizedStep: document.getElementById('render-step-contextualized'),
        };
      }

      function renderPlanPreview() {
        if (renderSessionChecklist) {
          renderSessionChecklist.innerHTML = '';
          renderSessionChecklist.classList.add('hidden');
        }

        if (renderSessionMilestones) {
          renderSessionMilestones.innerHTML = '';
          const milestones = renderDraft && Array.isArray(renderDraft.milestones) ? renderDraft.milestones : [];
          if (!milestones.length) {
            const empty = document.createElement('div');
            empty.className = 'map-render-empty-plan';
            empty.textContent = uiText('renderEmptyPlan', 'O plano ainda não foi consolidado em milestones.');
            renderSessionMilestones.appendChild(empty);
            return;
          }

          milestones.forEach((milestone) => {
            const card = document.createElement('article');
            card.className = 'map-render-milestone-card';
            if (milestone.changeMarker) {
              card.classList.add('has-refinement');
            }

            const header = document.createElement('header');
            header.className = 'map-render-milestone-card__header';
            const title = document.createElement('strong');
            title.textContent = `${String(milestone.number || '')}. ${milestone.title || 'Milestone'}`;
            header.appendChild(title);

            if (milestone.changeMarker) {
              const marker = document.createElement('span');
              marker.className = `map-render-change-marker map-render-change-marker--${milestone.changeMarker.type || 'task'}`;
              marker.textContent = milestone.changeMarker.label || `+${milestone.changeMarker.count || 1}`;
              marker.title = milestone.changeMarker.type === 'milestone'
                ? uiText('renderNewStageTooltip', 'Nova etapa adicionada após a revisão')
                : uiText('renderNewTasksTooltip', 'Novas tarefas adicionadas após a revisão');
              header.appendChild(marker);
            }

            const summary = document.createElement('p');
            summary.textContent = milestone.summary || '';

            const tasks = document.createElement('ul');
            tasks.className = 'map-render-milestone-card__tasks';
            (Array.isArray(milestone.tasks) ? milestone.tasks : []).forEach((task) => {
              const item = document.createElement('li');
              if (task && task.isRefinement) {
                item.className = 'is-refinement';
              }
              item.textContent = task.title || uiText('untitledTask', 'Tarefa sem título');
              tasks.appendChild(item);
            });

            card.appendChild(header);
            card.appendChild(summary);
            card.appendChild(tasks);

            const references = Array.isArray(milestone.references) ? milestone.references : [];
            if (references.length) {
              const refs = document.createElement('div');
              refs.className = 'map-render-milestone-card__refs';
              const refTitle = document.createElement('span');
              refTitle.textContent = uiText('referenceMarkdowns', 'MARKDOWNS DE REFERÊNCIA');
              const refList = document.createElement('ul');
              references.forEach((reference) => {
                const refItem = document.createElement('li');
                refItem.textContent = reference && reference.path ? reference.path : String(reference || '');
                refList.appendChild(refItem);
              });
              refs.append(refTitle, refList);
              card.appendChild(refs);
            }
            renderSessionMilestones.appendChild(card);
          });
        }
      }

      function renderRenderPanel() {
        if (!renderPanel) return;

        const isSessionView = renderPanelView === 'session';
        if (renderListView) {
          renderListView.classList.toggle('hidden', isSessionView);
        }
        if (renderSessionView) {
          renderSessionView.classList.toggle('hidden', !isSessionView);
        }
        if (renderPanelCopy) {
          renderPanelCopy.classList.toggle('hidden', isSessionView);
        }
        if (renderPanelOpen) {
          renderPanelOpen.textContent = window.t ? window.t('renderMapBtn', 'Renderizar o Mapa') : 'Renderizar o Mapa';
          renderPanelOpen.disabled = renderWorkflowBusy;
        }
        if (renderListBack) {
          renderListBack.disabled = renderWorkflowBusy;
        }
        if (renderSessionBack) {
          renderSessionBack.disabled = renderWorkflowBusy;
        }
        if (renderAttachButton) {
          renderAttachButton.disabled = renderWorkflowBusy;
        }
        if (renderPanelSave) {
          renderPanelSave.classList.toggle(
            'hidden',
            !isSessionView || !renderDraft || !renderDraft.ready
              || !renderDraft.milestones || !renderDraft.milestones.length
              || !renderDraft.proposal || renderDraft.proposal.status !== 'pending'
          );
          renderPanelSave.disabled = renderWorkflowBusy;
        }

        if (!isSessionView) {
          if (renderPanelStatus) {
            const activeConversation = getActiveRenderConversation();
            if (activeConversation && activeConversation.draft) {
              renderPanelStatus.textContent = activeConversation.draft.ready
                ? uiText('renderLastReady', 'Última renderização pronta para salvar em milestones.')
                : uiText('renderLastGaps', 'A última renderização ainda tem lacunas importantes.');
            } else if (Array.isArray(renderConversations) && renderConversations.length) {
              renderPanelStatus.textContent = window.t ? window.t('renderSelectPrev', 'Selecione uma renderização anterior para revisar o diagnóstico ou crie uma nova análise.') : 'Selecione uma renderização anterior para revisar o diagnóstico ou crie uma nova análise.';
            } else {
              renderPanelStatus.textContent = uiText('renderStatusReady', 'Pronto para iniciar uma nova análise.');
            }
          }
          renderRenderConversationsList();
          return;
        }

        if (renderSessionTitle) {
          const activeConversation = getActiveRenderConversation();
          renderSessionTitle.textContent = activeConversation && activeConversation.title
            ? activeConversation.title
            : (renderDraft && renderDraft.ready
              ? uiText('renderSessionReadyTitle', 'Planejamento de desenvolvimento')
              : uiText('renderSessionPendingTitle', 'Renderização do Mapa'));
        }

        if (renderSessionStatus) {
          renderSessionStatus.textContent = renderDraft
            ? (renderDraft.ready
              ? uiText('renderStatusComplete', 'Análise concluída. Você já pode revisar, corrigir pelo chat e salvar em milestones.')
              : uiText('renderStatusMissing', 'Ainda existem lacunas importantes. Use o chat abaixo para completar o contexto.'))
            : uiText('renderSessionReady', 'Pronto para iniciar a análise.');
        }

        if (renderSessionPlanCard) {
          renderSessionPlanCard.classList.toggle('hidden', !renderDraft);
          renderSessionPlanCard.classList.toggle('is-updating', renderPlanUpdating);
          renderSessionPlanCard.setAttribute('aria-busy', renderPlanUpdating ? 'true' : 'false');
        }

        if (renderSessionLog) {
          const hasMessages = Array.isArray(renderMessages) && renderMessages.length > 0;
          renderSessionLog.innerHTML = '';

          if (!hasMessages && !renderDraft) {
            const placeholder = document.createElement('div');
            placeholder.className = 'map-render-session-placeholder';
            placeholder.innerHTML = `
              <strong>${uiText('renderPlaceholderTitle', 'Análise da renderização')}</strong>
              <p>${uiText('renderPlaceholderBody', 'A exportação, a revisão dos Markdowns, a validação do contexto e os ajustes do plano aparecerão aqui.')}</p>
            `;
            renderSessionLog.appendChild(placeholder);
          }

          if (!hasMessages && renderDraft && renderDraft.assistantSummary) {
            renderMessages = [{ role: 'assistant', content: renderDraft.assistantSummary }];
            syncRenderConversationState();
          }

          (renderMessages || []).forEach((message) => {
            renderRenderMessage(message.role, message.content, message.attachments || []);
          });
        }

        renderPlanPreview();
        renderRenderAttachmentList();
      }

      setMapSidePanelMode = (mode) => {
        const modeClasses = ['mode-map-chat', 'mode-map-render', 'mode-git', 'mode-terminal', 'mode-milestones', 'mode-cortex'];
        modeClasses.forEach((cls) => document.body.classList.remove(cls));
        if (mode) {
          document.body.classList.add(mode);
        }

        const rightPanelTitle = document.getElementById('right-panel-title');
        if (rightPanelTitle) {
          if (mode === 'mode-map-chat') {
            rightPanelTitle.textContent = window.t ? window.t('askAi', 'Perguntar à IA') : 'Perguntar à IA';
          } else if (mode === 'mode-map-render') {
            rightPanelTitle.textContent = window.t ? window.t('mapRendering', 'Renderização do Mapa') : 'Renderização do Mapa';
          } else if (mode === 'mode-git') {
            rightPanelTitle.textContent = window.t ? window.t('git', 'Git') : 'Git';
          } else if (mode === 'mode-terminal') {
            rightPanelTitle.textContent = window.t ? window.t('terminal', 'Terminal') : 'Terminal';
          } else if (mode === 'mode-milestones') {
            rightPanelTitle.textContent = window.t ? window.t('milestones', 'Milestones') : 'Milestones';
          } else if (mode === 'mode-cortex') {
            rightPanelTitle.textContent = window.t ? window.t('cortexPanelRules', 'Regras e contexto') : 'Regras e contexto';
          } else {
            rightPanelTitle.textContent = window.t ? window.t('files', 'Arquivos') : 'Arquivos';
          }
        }

        const btnAi = document.getElementById('btn-map-ai');
        if (btnAi) {
          btnAi.classList.toggle('active', mode === 'mode-map-chat');
        }

        const filesBtn = document.getElementById('btn-project-files');
        if (filesBtn) {
          filesBtn.classList.toggle('active', mode === null);
        }
      };

      function getPersistableRenderMilestones(milestones = []) {
        return (Array.isArray(milestones) ? milestones : []).map((milestone) => {
          const { changeMarker, ...cleanMilestone } = milestone || {};
          return {
            ...cleanMilestone,
            tasks: Array.isArray(cleanMilestone.tasks)
              ? cleanMilestone.tasks.map((task) => {
                  const { isRefinement, ...cleanTask } = task || {};
                  return cleanTask;
                })
              : [],
          };
        });
      }

      async function rebuildRenderDraft(mapData, documentation, assistantSummary, options = {}) {
        const projectId = getSelectedProjectId();
        const rootPath = options.rootPath || getSelectedProjectInfo()?.rootPath || '';
        if (!projectId || !rootPath || !activeRenderConversationId) {
          throw new Error(uiText('projectRootRequired', 'Selecione um projeto antes de gerar o plano.'));
        }
        if (!api || typeof api.buildApplicationMapRenderPlan !== 'function') {
          throw new Error('Application map render-plan service unavailable.');
        }

        const documents = Array.isArray(documentation.documents) ? documentation.documents : [];
        const combinedText = `${documentation.combinedText || ''}\n${assistantSummary || ''}`;
        const plan = await api.buildApplicationMapRenderPlan({
          rootPath,
          mapData,
          combinedText,
          documents,
          previousMilestones: Array.isArray(options.previousMilestones)
            ? options.previousMilestones
            : [],
          requestText: options.requestText || '',
          copy: buildRenderPlanCopy(),
        });
        if (!plan || !plan.ok) {
          throw new Error(plan && plan.message ? plan.message : 'Application map render-plan failed.');
        }

        const plannedMilestones = Array.isArray(plan.milestones) ? plan.milestones : [];
        let proposal = null;
        if (plan.ready === true && plannedMilestones.length) {
          if (!api || typeof api.previewMapRenderMilestones !== 'function') {
            throw new Error('Map render milestone preview service unavailable.');
          }
          const preview = await api.previewMapRenderMilestones({
            projectId,
            rootPath,
            conversationId: activeRenderConversationId,
            milestones: getPersistableRenderMilestones(plannedMilestones),
          });
          if (!preview || !preview.ok || !preview.proposal
            || preview.proposal.status !== 'pending') {
            throw new Error(
              preview && (preview.message || preview.code)
                ? preview.message || preview.code
                : 'Map render milestone preview failed.',
            );
          }
          proposal = preview.proposal;
        }

        renderDraft = {
          assistantSummary: assistantSummary || uiText('renderFallbackDiagnostic', 'A IA não retornou uma resposta; o diagnóstico foi preparado com a documentação disponível.'),
          checks: Array.isArray(plan.checks) ? plan.checks : [],
          missing: Array.isArray(plan.missing) ? plan.missing : [],
          ready: plan.ready === true,
          milestones: plannedMilestones,
          proposal,
          documents,
          renderMarkdown: getRenderMapMarkdown(mapData),
        };
        syncRenderConversationState();
        renderRenderConversationsList();
        return renderDraft;
      }

      async function generateRenderDraft(userRequest = '') {
        const projectInfo = getSelectedProjectInfo();
        const projectId = getSelectedProjectId();
        const rootPath = projectInfo?.rootPath || '';
        if (!projectId || !rootPath || renderWorkflowBusy) return;

        renderWorkflowBusy = true;
        await createRenderConversation();
        renderMessages = [];
        renderDraft = null;
        renderAttachments = [];
        setRenderPanelView('session');
        renderRenderPanel();

        const exportStatus = uiText('renderExportCollecting', 'Exportando o mapa e coletando documentação...');
        if (renderSessionStatus) renderSessionStatus.textContent = exportStatus;
        if (renderSessionLog) renderSessionLog.innerHTML = '';
        if (renderSessionChecklist) renderSessionChecklist.innerHTML = '';
        if (renderSessionMilestones) renderSessionMilestones.innerHTML = '';
        if (renderPanelStatus) {
          renderPanelStatus.textContent = exportStatus;
        }

        const renderTicker = showRenderStatusTicker();

        try {
          const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };

          try {
            await api.renderApplicationMap({ rootPath });
            if (renderTicker && renderTicker.exportStep) {
              renderTicker.exportStep.classList.remove('active');
              renderTicker.exportStep.classList.add('completed');
            }
            await new Promise((resolve) => setTimeout(resolve, 180));
          } catch (error) {
            console.error('[generateRenderDraft] renderApplicationMap failed:', error);
          }

          const readingStatus = uiText('renderReadingMarkdowns', 'Lendo os markdowns do mapa e solicitando a análise da IA...');
          if (renderSessionStatus) renderSessionStatus.textContent = readingStatus;
          if (renderPanelStatus) renderPanelStatus.textContent = readingStatus;
          if (renderTicker && renderTicker.sendStep) {
            renderTicker.sendStep.classList.add('active');
          }

          const documentation = await collectRenderDocumentation(rootPath, mapData);
          if (renderTicker && renderTicker.sendStep) {
            renderTicker.sendStep.classList.remove('active');
            renderTicker.sendStep.classList.add('completed');
          }
          await new Promise((resolve) => setTimeout(resolve, 180));
          if (renderTicker && renderTicker.analyzeStep) {
            renderTicker.analyzeStep.classList.add('active');
          }
          const resolvedUserRequest = userRequest || uiText(
            'renderInitialAnalysisRequest',
            'Executar a análise inicial do mapa.',
          );

          let assistantSummary = '';
          let assistantSummaryPersisted = false;
          try {
            const response = await api.analyzeMapRenderSession({
              projectId,
              rootPath,
              conversationId: activeRenderConversationId,
              userMessage: resolvedUserRequest,
              locale: getLocale(),
            });
            if (response && response.ok && response.response) {
              assistantSummary = response.response;
              assistantSummaryPersisted = true;
            }
          } catch (error) {
            console.error('[generateRenderDraft] analyzeMapRenderSession failed:', error);
          }
          if (renderTicker && renderTicker.analyzeStep) {
            renderTicker.analyzeStep.classList.remove('active');
            renderTicker.analyzeStep.classList.add('completed');
          }

          await rebuildRenderDraft(mapData, documentation, assistantSummary, { rootPath });
          await new Promise((resolve) => setTimeout(resolve, 220));
          if (renderTicker && renderTicker.contextualizedStep) {
            renderTicker.contextualizedStep.classList.add('active');
          }

          const missingLabels = Array.isArray(renderDraft.missing)
            ? renderDraft.missing.map((item) => item.label || item.hint).filter(Boolean)
            : [];
          const introMessage = renderDraft.ready
            ? [
                uiText('renderIntroReadyTitle', 'A análise inicial terminou e o plano já pode virar milestones.'),
                uiText('renderIntroReadyHelp', 'Revise o resumo, peça ajustes pela conversa e salve o plano quando estiver pronto.'),
              ].join(' ')
            : [
                uiText('renderIntroMissingTitle', 'Ainda há informações importantes a completar antes de fechar as milestones.'),
                missingLabels.length
                  ? uiText('pendingItems', 'Pendências: {value}', { value: missingLabels.join(', ') })
                  : uiText('renderReviewMarkdowns', 'Vale revisar os markdowns do projeto.'),
                uiText('renderOfferHelp', 'Posso ajudar nesta conversa a completar o que está faltando.'),
              ].join(' ');

          const generatedMessages = [
            { role: 'assistant', content: assistantSummary || uiText('renderFallbackDiagnostic', 'A IA não retornou uma resposta; o diagnóstico foi preparado com a documentação disponível.') },
            { role: 'assistant', content: introMessage },
          ];
          const nextMessages = Array.isArray(renderMessages) ? renderMessages.slice() : [];
          nextMessages.push(...generatedMessages);
          renderMessages = nextMessages;
          syncRenderConversationState();
          for (const message of generatedMessages.slice(assistantSummaryPersisted ? 1 : 0)) {
            await persistRenderConversationMessage(message.role, message.content);
          }

          if (renderSessionStatus) {
            renderSessionStatus.textContent = renderDraft.ready
              ? uiText('renderAnalysisReadyStatus', 'Análise pronta. O plano pode ser revisado e refinado pela conversa.')
              : uiText('renderAnalysisMissingStatus', 'Há informações pendentes. A conversa está aberta para completar o plano.');
          }
          if (renderPanelStatus) {
            renderPanelStatus.textContent = renderDraft.ready
              ? uiText('renderAnalysisReadyStatus', 'Análise pronta. O plano pode ser revisado e refinado pela conversa.')
              : uiText('renderAnalysisMissingStatus', 'Há informações pendentes. A conversa está aberta para completar o plano.');
          }
          if (renderTicker && renderTicker.contextualizedStep) {
            renderTicker.contextualizedStep.classList.remove('active');
            renderTicker.contextualizedStep.classList.add('completed');
          }

          setRenderPanelView('session');
          renderRenderPanel();
          if (renderSessionTextarea) {
            renderSessionTextarea.focus();
          }
        } catch (error) {
          console.error('[generateRenderDraft] failed:', error);
          renderDraft = {
            assistantSummary: uiText('renderAnalysisFailed', 'Não foi possível concluir a análise do mapa neste momento.'),
            checks: [],
            missing: [],
            ready: false,
            milestones: [],
            documents: [],
            renderMarkdown: '',
          };
          renderMessages = [
            { role: 'assistant', content: uiText('renderAnalysisFailed', 'Não foi possível concluir a análise do mapa neste momento.') },
          ];
          syncRenderConversationState();
          await persistRenderConversationMessage('assistant', uiText('renderAnalysisFailed', 'Não foi possível concluir a análise do mapa neste momento.'));
          if (renderSessionStatus) {
            renderSessionStatus.textContent = uiText('renderAnalysisFailedStatus', 'Falha ao analisar o mapa: {message}', { message: error.message || String(error) });
          }
          if (renderPanelStatus) {
            renderPanelStatus.textContent = uiText('renderAnalysisFailedStatus', 'Falha ao analisar o mapa: {message}', { message: error.message || String(error) });
          }
          setRenderPanelView('session');
          renderRenderPanel();
        } finally {
          renderWorkflowBusy = false;
          hideRenderThinking();
          renderRenderPanel();
        }
      }

      generateTutorialRenderDraftHandler = async () => {
        const projectInfo = getSelectedProjectInfo();
        const projectId = getSelectedProjectId();
        const rootPath = projectInfo?.rootPath || '';
        if (!projectId || !rootPath || renderWorkflowBusy) return false;

        renderWorkflowBusy = true;
        await createRenderConversation(tutorialText('render.conversationTitle'));
        renderMessages = [];
        renderDraft = null;
        renderAttachments = [];
        setMapSidePanelMode('mode-map-render');
        setRenderPanelView('session');
        renderRenderPanel();

        if (renderSessionLog) renderSessionLog.innerHTML = '';
        if (renderSessionChecklist) renderSessionChecklist.innerHTML = '';
        if (renderSessionMilestones) renderSessionMilestones.innerHTML = '';
        const exportStatus = tutorialText('render.exportStatus');
        if (renderSessionStatus) renderSessionStatus.textContent = exportStatus;
        if (renderPanelStatus) renderPanelStatus.textContent = exportStatus;
        const renderTicker = showRenderStatusTicker();

        try {
          const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };
          if (api && typeof api.renderApplicationMap === 'function') {
            await api.renderApplicationMap({ rootPath });
          }
          if (renderTicker && renderTicker.exportStep) {
            renderTicker.exportStep.classList.add('completed');
          }

          await new Promise((resolve) => window.setTimeout(resolve, 180));
          if (renderTicker && renderTicker.sendStep) renderTicker.sendStep.classList.add('active');
          const documentation = await collectRenderDocumentation(rootPath, mapData);
          if (renderTicker && renderTicker.sendStep) {
            renderTicker.sendStep.classList.remove('active');
            renderTicker.sendStep.classList.add('completed');
          }

          await new Promise((resolve) => window.setTimeout(resolve, 180));
          if (renderTicker && renderTicker.analyzeStep) renderTicker.analyzeStep.classList.add('active');
          const assistantSummary = tutorialText('render.assistantSummary');
          const checkLabels = tutorialValue('render.checks', []);
          const tutorialMilestones = buildTutorialRenderMilestones(mapData);
          const preview = await api.previewMapRenderMilestones({
            projectId,
            rootPath,
            conversationId: activeRenderConversationId,
            milestones: getPersistableRenderMilestones(tutorialMilestones),
          });
          if (!preview || !preview.ok || !preview.proposal
            || preview.proposal.status !== 'pending') {
            throw new Error(
              preview && (preview.message || preview.code)
                ? preview.message || preview.code
                : 'Map render milestone preview failed.',
            );
          }

          renderDraft = {
            assistantSummary,
            checks: ['briefing', 'architecture', 'branding', 'quality'].map((id, index) => ({
              id,
              label: checkLabels[index] || id,
              ok: true,
            })),
            missing: [],
            ready: true,
            milestones: tutorialMilestones,
            proposal: preview.proposal,
            documents: documentation.documents,
            renderMarkdown: getRenderMapMarkdown(mapData),
          };
          renderMessages = [
            { role: 'assistant', content: assistantSummary },
            {
              role: 'assistant',
              content: tutorialText('render.reviewPrompt'),
            },
          ];
          syncRenderConversationState();
          for (const message of renderMessages) {
            await persistRenderConversationMessage(message.role, message.content);
          }

          if (renderTicker && renderTicker.analyzeStep) {
            renderTicker.analyzeStep.classList.remove('active');
            renderTicker.analyzeStep.classList.add('completed');
          }
          if (renderTicker && renderTicker.contextualizedStep) {
            renderTicker.contextualizedStep.classList.add('completed');
          }
          const readyStatus = tutorialText('render.readyStatus');
          if (renderSessionStatus) renderSessionStatus.textContent = readyStatus;
          if (renderPanelStatus) renderPanelStatus.textContent = readyStatus;
          setRenderPanelView('session');
          renderRenderPanel();
          window.dispatchEvent(new CustomEvent('faber:tutorial-render-ready', {
            detail: { milestoneCount: renderDraft.milestones.length },
          }));
          return true;
        } catch (error) {
          console.error('[generateTutorialRenderDraft] failed:', error);
          const failureStatus = tutorialText('render.failure', { message: error.message || String(error) });
          if (renderSessionStatus) renderSessionStatus.textContent = failureStatus;
          if (renderPanelStatus) renderPanelStatus.textContent = failureStatus;
          renderRenderPanel();
          return false;
        } finally {
          renderWorkflowBusy = false;
          renderRenderPanel();
        }
      };

      async function sendRenderChatMessage(userText) {
        const messageText = String(userText || '').trim();
        if (!messageText || renderWorkflowBusy) return;

        const projectInfo = getSelectedProjectInfo();
        const projectId = getSelectedProjectId();
        const rootPath = projectInfo?.rootPath || '';
        if (!projectId || !rootPath) return;

        renderWorkflowBusy = true;

        if (!getActiveRenderConversation()) {
          await createRenderConversation();
        }

        const mapData = canvasController ? canvasController.getMapData() : { nodes: [], edges: [] };
        const outgoingAttachments = Array.isArray(renderAttachments)
          ? renderAttachments.map((attachment) => ({
              path: attachment.path,
              type: attachment.type,
              name: attachment.name,
            }))
          : [];
        renderMessages.push({ role: 'user', content: messageText, attachments: outgoingAttachments });
        renderRenderMessage('user', messageText, outgoingAttachments);
        const thinking = showRenderThinking();
        setRenderPlanUpdating(true);
        if (renderSessionStatus) renderSessionStatus.textContent = uiText('renderRefining', 'Refinando o plano com o contexto da conversa...');
        if (renderPanelStatus) renderPanelStatus.textContent = uiText('renderRefining', 'Refinando o plano com o contexto da conversa...');
        if (renderSessionSend) renderSessionSend.disabled = true;
        if (renderSessionTextarea) renderSessionTextarea.disabled = true;
        if (renderAttachButton) renderAttachButton.disabled = true;
        renderAttachments = [];
        renderRenderAttachmentList();
        syncRenderConversationState();

        const previousMilestones = renderDraft && Array.isArray(renderDraft.milestones)
          ? renderDraft.milestones.map((milestone) => ({
              ...milestone,
              tasks: Array.isArray(milestone.tasks) ? milestone.tasks.map((task) => ({ ...task })) : [],
              references: Array.isArray(milestone.references) ? milestone.references.map((reference) => ({ ...reference })) : [],
            }))
          : [];
        let documentation = null;
        try {
          documentation = await collectRenderDocumentation(rootPath, mapData);
          const response = await api.sendMapRenderSessionMessage({
            projectId,
            rootPath,
            conversationId: activeRenderConversationId,
            userMessage: messageText,
            locale: getLocale(),
            attachments: outgoingAttachments,
          });

          if (thinking) thinking.remove();

          const assistantText = response && response.ok && response.response
            ? response.response
            : uiText('renderRefineFailed', 'Não consegui refinar o plano neste momento.');
          renderMessages.push({ role: 'assistant', content: assistantText });
          renderRenderMessage('assistant', assistantText);

          const renderTranscript = renderMessages
            .map((message) => `${message.role}: ${message.content || ''}`)
            .join('\n\n');
          await rebuildRenderDraft(mapData, documentation, `${renderTranscript}\n\nPedido atual do usuário: ${messageText}`, {
            rootPath,
            previousMilestones,
            requestText: messageText,
          });
          syncRenderConversationState();

          if (renderSessionStatus) {
            renderSessionStatus.textContent = renderDraft.ready
              ? uiText('renderRefinedReady', 'Plano refinado. Revise e salve em milestones quando estiver pronto.')
              : uiText('renderRefinedMissing', 'O plano foi atualizado, mas ainda precisa de contexto adicional.');
          }
          if (renderPanelStatus) {
            renderPanelStatus.textContent = renderDraft.ready
              ? uiText('renderRefinedReady', 'Plano refinado. Revise e salve em milestones quando estiver pronto.')
              : uiText('renderRefinedMissing', 'O plano foi atualizado, mas ainda precisa de contexto adicional.');
          }
          renderRenderPanel();
        } catch (error) {
          if (thinking) thinking.remove();
          const fallbackText = documentation
            ? uiText('renderRefineLocalFallback', 'Não obtive uma resposta completa da IA, mas atualizei o rascunho local com base no seu pedido.')
            : uiText('aiCommunicationError', 'Erro ao comunicar com a IA: {message}', { message: error.message || String(error) });
          renderMessages.push({ role: 'assistant', content: fallbackText });
          renderRenderMessage('assistant', fallbackText);
          await persistRenderConversationMessage('assistant', fallbackText);
          if (documentation) {
            const renderTranscript = renderMessages
              .map((message) => `${message.role}: ${message.content || ''}`)
              .join('\n\n');
            await rebuildRenderDraft(mapData, documentation, `${renderTranscript}\n\nPedido atual do usuário: ${messageText}`, {
              rootPath,
              previousMilestones,
              requestText: messageText,
            });
            syncRenderConversationState();
          }
          if (renderSessionStatus) renderSessionStatus.textContent = fallbackText;
          if (renderPanelStatus) renderPanelStatus.textContent = fallbackText;
        } finally {
          hideRenderThinking();
          setRenderPlanUpdating(false);
          renderWorkflowBusy = false;
          if (renderSessionSend) renderSessionSend.disabled = false;
          if (renderSessionTextarea) renderSessionTextarea.disabled = false;
          if (renderAttachButton) renderAttachButton.disabled = false;
          renderRenderPanel();
        }
      }

      async function saveRenderMilestones() {
        const projectInfo = getSelectedProjectInfo();
        const projectId = getSelectedProjectId();
        const rootPath = projectInfo?.rootPath || '';
        const proposal = renderDraft && renderDraft.proposal;
        if (!projectId || !rootPath || !activeRenderConversationId
          || !renderDraft || !renderDraft.ready
          || !Array.isArray(renderDraft.milestones) || !renderDraft.milestones.length
          || !proposal || proposal.status !== 'pending') {
          alert(tutorialText('render.incomplete'));
          return;
        }

        const confirmed = window.faberConfirm
          ? await window.faberConfirm(tutorialText('render.confirmSave'))
          : true;
        if (!confirmed) return;

        const savingStatus = tutorialText('render.saving');
        if (renderSessionStatus) renderSessionStatus.textContent = savingStatus;
        if (renderPanelStatus) renderPanelStatus.textContent = savingStatus;

        try {
          const saveResult = await api.approveMapChatProposal({
            projectId,
            rootPath,
            conversationId: activeRenderConversationId,
            proposalId: proposal.proposalId,
            expectedRevision: proposal.revision,
            patchDigest: proposal.patchDigest,
          });
          if (!saveResult || !saveResult.ok) {
            throw new Error(
              saveResult && (saveResult.message || saveResult.code)
                ? saveResult.message || saveResult.code
                : tutorialText('development.unknownFailure'),
            );
          }
          renderDraft.proposal = saveResult.proposal;
          window.dispatchEvent(new CustomEvent('faber:milestones-updated', { detail: { rootPath } }));
          const savedStatus = tutorialText('render.saved');
          if (renderSessionStatus) renderSessionStatus.textContent = savedStatus;
          if (renderPanelStatus) renderPanelStatus.textContent = savedStatus;
          syncRenderConversationState();
          renderRenderPanel();
        } catch (error) {
          console.error('[saveRenderMilestones] failed:', error);
          const failureStatus = tutorialText('render.saveFailure', { message: error.message || String(error) });
          if (renderSessionStatus) renderSessionStatus.textContent = failureStatus;
          if (renderPanelStatus) renderPanelStatus.textContent = failureStatus;
          alert(failureStatus);
        }
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
                titleSpan.textContent = c.title || uiText('analysis', 'Análise');
                row.appendChild(titleSpan);

                // Rename button
                const renameBtn = document.createElement('button');
                renameBtn.className = 'map-conversation-rename-btn';
                renameBtn.title = uiText('renameConversation', 'Renomear conversa');
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
                      title: uiText('renameConversationTitle', 'Renomear conversa'),
                      initialValue: c.title || uiText('analysis', 'Análise'),
                      placeholder: uiText('conversationNamePlaceholder', 'Novo nome da conversa'),
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
                        alert(uiText('renameConversationFailedDetail', 'Falha ao renomear conversa: {message}', {
                          message: renameResult.message || uiText('unknownError', 'Erro desconhecido.'),
                        }));
                      }
                    }
                  } else {
                    const newTitle = prompt(uiText('renameConversationTitle', 'Renomear conversa'), c.title || uiText('analysis', 'Análise'));
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
                deleteBtn.title = uiText('deleteConversation', 'Excluir conversa');
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
                  const confirmed = await window.faberConfirm(uiText('deleteConversationConfirm', 'Deseja realmente excluir esta conversa?'));
                  if (confirmed) {
                    const deleteResult = await api.deleteConversation({
                      projectId,
                      conversationId: c.id
                    });
                    if (deleteResult && deleteResult.ok) {
                      await loadMapConversations();
                    } else {
                      alert(uiText('deleteConversationFailed', 'Falha ao excluir conversa: {message}', {
                        message: deleteResult.message || uiText('unknownError', 'Erro desconhecido.'),
                      }));
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
                  if (mapChatSessionTitle) mapChatSessionTitle.textContent = c.title || uiText('analysis', 'Análise');
                  
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
              emptyMsg.textContent = uiText('noPreviousAnalysis', 'Nenhuma análise anterior encontrada. Clique em “Nova” para iniciar.');
              mapConversationsList.appendChild(emptyMsg);
            }

          }
          await loadRenderConversationsFromStore(projectId);
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
        const dateStr = now.toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit' });
        const timeStr = now.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
        const title = uiText('mapAnalysisDated', 'Análise do Mapa ({date} {time})', { date: dateStr, time: timeStr });

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
        const rootPath = getSelectedProjectInfo()?.rootPath || '';
        if (!projectId || !rootPath || !activeConversationId) return;

        const ticker = document.createElement('div');
        ticker.className = 'map-chat-status-ticker';
        ticker.id = 'map-chat-status-ticker';
        ticker.innerHTML = [
          '<div class="ticker-step" id="step-export-md"><span class="status-dot"></span> <span>'
            + uiText('mapReadingCurrentState', 'Lendo o estado atual do mapa...') + '</span></div>',
          '<div class="ticker-step" id="step-send-images"><span class="status-dot"></span> <span>'
            + uiText('renderSendingImages', 'Preparando imagens e referências...') + '</span></div>',
          '<div class="ticker-step" id="step-analyze-info"><span class="status-dot"></span> <span>'
            + uiText('renderAnalyzingInfo', 'Analisando as informações do projeto...') + '</span></div>',
          '<div class="ticker-step" id="step-contextualized"><span class="status-dot"></span> <span>'
            + uiText('renderContextReady', 'Contexto preparado. Iniciando o planejamento...') + '</span></div>',
        ].join('');
        if (mapChatLog) {
          mapChatLog.appendChild(ticker);
          mapChatLog.scrollTop = mapChatLog.scrollHeight;
        }

        const stepExportMd = document.getElementById('step-export-md');
        const stepSendImages = document.getElementById('step-send-images');
        const stepAnalyzeInfo = document.getElementById('step-analyze-info');
        const stepContextualized = document.getElementById('step-contextualized');

        try {
          if (stepExportMd) stepExportMd.classList.add('active');
          if (stepExportMd) {
            stepExportMd.classList.remove('active');
            stepExportMd.classList.add('completed');
          }

          if (stepSendImages) {
            stepSendImages.classList.add('active');
            stepSendImages.classList.remove('active');
            stepSendImages.classList.add('completed');
            const label = stepSendImages.querySelector('span:not(.status-dot)');
            if (label) {
              label.textContent = uiText('renderReferencesPrepared', 'Referências preparadas');
            }
          }
          if (stepAnalyzeInfo) stepAnalyzeInfo.classList.add('active');

          const response = await api.analyzeMapChatSession({
            projectId,
            rootPath,
            conversationId: activeConversationId,
            locale: getLocale(),
          });

          if (stepAnalyzeInfo) {
            stepAnalyzeInfo.classList.remove('active');
            stepAnalyzeInfo.classList.add('completed');
          }
          if (stepContextualized) {
            stepContextualized.classList.add('active');
            stepContextualized.classList.add('completed');
          }

          await new Promise((resolve) => setTimeout(resolve, 600));
          ticker.remove();
          if (response && response.ok && response.response) {
            appendMapChatMessage('assistant', response.response);
            mapChatMessages.push({ role: 'assistant', content: response.response });
            if (response.proposalDraft) {
              await appendMapChatProposalPreview({
                projectId,
                rootPath,
                conversationId: activeConversationId,
                proposalDraft: response.proposalDraft,
              });
            }
          } else {
            appendMapChatMessage(
              'assistant',
              uiText('assistantUnavailable', 'Desculpe, não consegui obter uma resposta da IA neste momento.'),
            );
          }
        } catch (error) {
          ticker.remove();
          appendMapChatMessage('assistant', uiText(
            'aiCommunicationError',
            'Erro ao comunicar com a IA: {message}',
            { message: error.message || String(error) },
          ));
        }
      }
      async function sendMapChatMessage(userText) {
        const messageText = String(userText || '').trim();
        if (!messageText) return;
        const projectId = getSelectedProjectId();
        const rootPath = getSelectedProjectInfo()?.rootPath || '';
        if (!projectId || !rootPath || !activeConversationId) return;

        appendMapChatMessage('user', messageText);
        mapChatMessages.push({ role: 'user', content: messageText });

        const thinking = showMapChatThinking();

        try {
          const response = await api.sendMapChatSessionMessage({
            projectId,
            rootPath,
            conversationId: activeConversationId,
            userMessage: messageText,
            locale: getLocale(),
          });

          hideMapChatThinking();

          if (response && response.ok && response.response) {
            appendMapChatMessage('assistant', response.response);
            mapChatMessages.push({ role: 'assistant', content: response.response });
            if (response.proposalDraft) {
              await appendMapChatProposalPreview({
                projectId,
                rootPath,
                conversationId: activeConversationId,
                proposalDraft: response.proposalDraft,
              });
            }
          } else {
            appendMapChatMessage('assistant', uiText('assistantUnavailable', 'Desculpe, não consegui obter uma resposta da IA neste momento.'));
          }
        } catch (err) {
          hideMapChatThinking();
          appendMapChatMessage('assistant', uiText('aiCommunicationError', 'Erro ao comunicar com a IA: {message}', {
            message: err.message || String(err),
          }));
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

      if (btnMapRenderLauncher) {
        btnMapRenderLauncher.addEventListener('click', async () => {
          if (inspector && inspector.classList.contains('open')) {
            closeInspector();
          }
          setMapSidePanelMode('mode-map-render');
          await loadRenderConversationsFromStore();
          setRenderPanelView('list');
          renderRenderPanel();
        });
      }

      if (renderPanelOpen) {
        renderPanelOpen.addEventListener('click', async () => {
          if (renderWorkflowBusy) return;
          if (inspector && inspector.classList.contains('open')) {
            closeInspector();
          }
          setMapSidePanelMode('mode-map-render');
          await generateRenderDraft();
        });
      }

      if (renderListBack) {
        renderListBack.addEventListener('click', async () => {
          if (renderWorkflowBusy) return;
          setMapSidePanelMode('mode-map-chat');
          setRenderPanelView('list');
          renderRenderPanel();
          await loadMapConversations();
        });
      }

      if (renderSessionBack) {
        renderSessionBack.addEventListener('click', async () => {
          if (renderWorkflowBusy) return;
          await loadRenderConversationsFromStore();
          setRenderPanelView('list');
          renderRenderPanel();
        });
      }

      if (renderAttachButton && renderFileInput) {
        renderAttachButton.addEventListener('click', () => {
          renderFileInput.click();
        });
        renderFileInput.addEventListener('change', (event) => {
          const incoming = Array.from((event && event.target && event.target.files) || []);
          if (!incoming.length) return;
          const allowed = incoming.filter((file) => {
            const lowerName = String(file.name || '').toLowerCase();
            return (
              file.type.startsWith('image/') ||
              lowerName.endsWith('.pdf') ||
              lowerName.endsWith('.txt') ||
              lowerName.endsWith('.md') ||
              lowerName.endsWith('.markdown')
            );
          });
          if (!allowed.length) {
            event.target.value = '';
            return;
          }
          renderAttachments = [...renderAttachments, ...allowed.map((file) => ({
            path: file.path,
            type: file.type,
            name: file.name,
          }))];
          renderRenderAttachmentList();
          syncRenderConversationState();
          event.target.value = '';
        });
      }

      if (renderSessionSend && renderSessionTextarea) {
        renderSessionSend.addEventListener('click', () => {
          const text = renderSessionTextarea.value;
          renderSessionTextarea.value = '';
          sendRenderChatMessage(text);
        });

        renderSessionTextarea.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            renderSessionSend.click();
          }
        });
      }

      if (renderPanelSave) {
        renderPanelSave.addEventListener('click', async () => {
          await saveRenderMilestones();
        });
      }

      const btnAi = document.getElementById('btn-map-ai');
      if (btnAi) {
        btnAi.addEventListener('click', async () => {
          document.body.classList.remove('mode-map-render');
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

          const active = !document.body.classList.contains('mode-map-chat');
          setMapSidePanelMode(active ? 'mode-map-chat' : null);
          btnAi.classList.toggle('active', active);

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
              alert(uiText('uploadImageFailed', 'Falha ao importar imagem: {message}', {
                message: result.message || uiText('unknownError', 'Erro desconhecido.'),
              }));
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

      if (mode === 'chat') {
        setMapSidePanelMode(null);
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
      if (document.body.classList.contains('mode-map-render')) {
        return { panel: document.getElementById('workspace-map-render-panel'), title: window.t ? window.t('renderMap', 'Renderização do Mapa') : 'Renderização do Mapa', buttonId: 'btn-map-render-open' };
      }
      if (document.body.classList.contains('mode-cortex')) {
        return { panel: document.getElementById('cortex-learning-box'), title: window.t ? window.t('contextRules', 'Regras e contexto') : 'Regras e contexto', buttonId: 'btn-cortex-mode' };
      }
      if (document.body.classList.contains('mode-terminal')) {
        return { panel: document.getElementById('project-terminal-panel'), title: window.t ? window.t('terminal', 'Terminal') : 'Terminal', buttonId: 'btn-project-terminal' };
      }
      if (document.body.classList.contains('mode-git')) {
        return { panel: document.getElementById('workspace-git-panel'), title: window.t ? window.t('git', 'Git') : 'Git', buttonId: 'btn-project-git' };
      }
      if (document.body.classList.contains('mode-milestones')) {
        return { panel: document.getElementById('workspace-milestones-panel'), title: window.t ? window.t('milestones', 'Milestones') : 'Milestones', buttonId: 'btn-project-milestones' };
      }
      if (document.body.classList.contains('mode-map-chat')) {
        return { panel: document.getElementById('workspace-map-chat-panel'), title: window.t ? window.t('askAi', 'Perguntar à IA') : 'Perguntar à IA', buttonId: 'btn-map-ai' };
      }
      // Default to files
      return { panel: document.getElementById('workspace-files-region'), title: window.t ? window.t('files', 'Arquivos') : 'Arquivos', buttonId: 'btn-project-files' };
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
      const modeClasses = ['mode-map-chat', 'mode-map-render', 'mode-git', 'mode-terminal', 'mode-milestones', 'mode-cortex'];
      modeClasses.forEach(cls => {
        document.body.classList.remove(cls);
      });
      document.body.classList.add('mode-map-inspector');

      // Update header title of right panel
      const rightPanelTitle = document.getElementById('right-panel-title');
      if (rightPanelTitle) {
        rightPanelTitle.textContent = window.t ? window.t('itemDetails', 'Detalhes do Item') : 'Detalhes do Item';
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
        } else if (previousPanelInfo.buttonId === 'btn-map-render-open') {
          document.body.classList.add('mode-map-render');
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
        setMapSidePanelMode(null);
      }

      previousPanelInfo = null;

      if (canvasController && typeof canvasController.selectNode === 'function') {
        if (canvasController.getSelectedNode()) {
          canvasController.selectNode(null);
        }
      }
    }

    let lastLoadedMapProjectId = null;
    let loadProjectMapSequence = 0;

    async function loadProjectMap(projectId, options = {}) {
      const currentSequence = ++loadProjectMapSequence;

      // Cancel any pending autosave from the previous project
      if (autosaveTimeout) {
        clearTimeout(autosaveTimeout);
        autosaveTimeout = null;
      }

      // Immediately clear the canvas so the old project's map is never visible
      canvasController.loadMapData({ nodes: [], edges: [], viewport: { x: 0, y: 0 }, zoom: 1.0 });
      closeInspector();

      lastLoadedMapProjectId = projectId;

      let rootPath = getSelectedProjectInfo()?.rootPath;
      if (!rootPath && options.fallbackRootPath) {
        rootPath = options.fallbackRootPath;
      }

      if (!rootPath) return;

      try {
        const result = await api.getApplicationMap({ rootPath });

        // Guard: if user switched project during the async call, discard this result
        if (lastLoadedMapProjectId !== projectId) return;
        if (loadProjectMapSequence !== currentSequence) return;


        if (result && result.ok && result.map) {
          canvasController.loadMapData(result.map);
        }

        await loadMapConversations();
      } catch (error) {
        console.error('Falha ao carregar mapa da aplicação:', error);
      }

      // Auto-toggle tab: Show Map for new projects with 0 files
      const hasFiles = Number(getSelectedProjectInfo()?.totalFiles || 0) > 0;
      if (centerTabs) centerTabs.classList.remove('hidden');

      let targetTab = options.initialTab || (hasFiles ? 'chat' : 'map');
      if (!options.initialTab && window.FaberTutorialRuntime && typeof window.FaberTutorialRuntime.isTutorialActive === 'function' && window.FaberTutorialRuntime.isTutorialActive()) {
        targetTab = 'chat';
      }

      switchTab(targetTab);
    }

    function triggerAutosave() {
      if (autosaveTimeout) clearTimeout(autosaveTimeout);
      autosaveTimeout = setTimeout(async () => {
        const projectId = getSelectedProjectId();
        const rootPath = getSelectedProjectInfo()?.rootPath;
        if (!projectId || !rootPath) return;
        // Only save if the map still belongs to the currently selected project
        if (lastLoadedMapProjectId !== projectId) return;
        
        const mapData = canvasController.getMapData();
        await api.saveApplicationMap({ rootPath, map: mapData });
      }, 1000);
    }

    function resetForNoProject() {
      if (autosaveTimeout) {
        clearTimeout(autosaveTimeout);
        autosaveTimeout = null;
      }
      lastLoadedMapProjectId = null;
      canvasController.loadMapData({ nodes: [], edges: [], viewport: { x: 0, y: 0 }, zoom: 1.0 });
      if (centerTabs) centerTabs.classList.add('hidden');
      closeInspector();
      switchTab('chat');
    }

    return {
      init,
      loadProjectMap,
      resetForNoProject,
      switchTab,
      prepareTutorialMapConversation: () => (
        prepareTutorialMapConversationHandler
          ? prepareTutorialMapConversationHandler()
          : false
      ),
      simulateTutorialMapConversation: (userText, assistantText) => (
        simulateTutorialMapConversationHandler
          ? simulateTutorialMapConversationHandler(userText, assistantText)
          : Promise.resolve(false)
      ),
      showTutorialMapCanvas: () => (
        showTutorialMapCanvasHandler
          ? showTutorialMapCanvasHandler()
          : false
      ),
      prepareTutorialMapHistory: () => (
        prepareTutorialMapHistoryHandler
          ? prepareTutorialMapHistoryHandler()
          : Promise.resolve(false)
      ),
      prepareTutorialMapAnalysis: () => (
        prepareTutorialMapAnalysisHandler
          ? prepareTutorialMapAnalysisHandler()
          : false
      ),
      generateTutorialRenderDraft: () => (
        generateTutorialRenderDraftHandler
          ? generateTutorialRenderDraftHandler()
          : Promise.resolve(false)
      ),
      getCanvasController: () => canvasController,
      getPanOffset: () => canvasController ? canvasController.getPanOffset() : { x: 0, y: 0 },
      getZoomLevel: () => canvasController ? canvasController.getZoomLevel() : 1
    };
  }

  window.FaberApplicationMap = {
    createApplicationMapController
  };
})();
