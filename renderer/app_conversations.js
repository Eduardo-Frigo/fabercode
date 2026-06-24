(function () {
  function createAppConversationController({
    api = {},
    chatController = null,
    hidePersonaThinkingIndicator = () => {},
    renderMessageBubble = () => {},
    renderProjects = () => {},
    renderWelcomePanel = () => {},
    state,
  } = {}) {
    if (!state) throw new Error('Renderer incompleto: estado de conversas ausente.');

    function getActiveConversationId(projectId) {
      if (!projectId) return null;
      return state.activeConversationByProject[projectId] || null;
    }
    
    function setActiveConversation(projectId, conversationId) {
      if (!projectId) return;
      state.activeConversationByProject[projectId] = conversationId || null;
    }
    
    function ensureConversationMessagesBucket(conversationId) {
      if (!conversationId) return;
      if (!state.conversationMessagesById[conversationId]) {
        state.conversationMessagesById[conversationId] = [];
      }
    }
    
    async function loadConversationMessages(conversationId) {
      if (!conversationId) return [];
      if (state.conversationMessagesById[conversationId]) {
        return state.conversationMessagesById[conversationId];
      }
    
      try {
        const result = await api.listConversationMessages({
          conversationId,
          limit: 200,
        });
        if (result && result.ok) {
          state.conversationMessagesById[conversationId] = Array.isArray(result.messages) ? result.messages : [];
          return state.conversationMessagesById[conversationId];
        }
      } catch {
        // fallback silencioso
      }
    
      state.conversationMessagesById[conversationId] = [];
      return state.conversationMessagesById[conversationId];
    }
    
    async function persistConversationMessage(role, text, attachments = []) {
      const projectId = state.selectedProjectId;
      const conversationId = getActiveConversationId(projectId);
      if (!projectId || !conversationId) return;
    
      try {
        await api.addConversationMessage({
          projectId,
          conversationId,
          role,
          text,
          attachments,
          meta: { mode: state.uiMode },
        });
      } catch {
        // não bloqueia chat por falha de persistência
      }
    }
    
    function appendMessage(role, text, attachments = [], options = {}) {
      const { persistToConversation = true } = options;
    
      // Evita spam visual quando o mesmo erro/resposta é reenviado em loop de retentativa.
      if (role === 'assistant' && chatController && chatController.hasRecentAssistantMessage(text)) {
        return;
      }
      const projectId = state.selectedProjectId;
      const conversationId = getActiveConversationId(projectId);
    
      if (persistToConversation && conversationId) {
        ensureConversationMessagesBucket(conversationId);
        state.conversationMessagesById[conversationId].push({ role, text, attachments, createdAt: new Date().toISOString() });
        persistConversationMessage(role, text, attachments);
      }
    
      renderMessageBubble(role, text, attachments);
      renderWelcomePanel();
      if (chatController) chatController.scrollToBottom();
    }
    
    function renderChatForActiveConversation() {
      hidePersonaThinkingIndicator();
      if (chatController) chatController.clearMessages();
      const projectId = state.selectedProjectId;
      const conversationId = getActiveConversationId(projectId);
    
      if (!conversationId) {
        renderWelcomePanel();
        return;
      }
    
      const messages = state.conversationMessagesById[conversationId] || [];
      if (!messages.length) {
        renderWelcomePanel();
        return;
      }
    
      messages.forEach((message) => {
        renderMessageBubble(message.role, message.text, message.attachments || []);
      });
      renderWelcomePanel();
      if (chatController) chatController.scrollToBottom();
    }
    
    function ensureProjectConversationBucket(projectId) {
      if (!projectId) return;
      if (!state.projectConversations[projectId]) {
        state.projectConversations[projectId] = [];
      }
    }

    function isVisibleProjectConversation(conversation) {
      return Boolean(
        conversation &&
        conversation.source !== 'map_chat' &&
        conversation.source !== 'map_render'
      );
    }

    function ensureConversationStateForProject(projectId) {
      ensureProjectConversationBucket(projectId);
      const activeConversationId = state.activeConversationByProject[projectId] || null;
      const activeConversation = Array.isArray(state.projectConversations[projectId])
        ? state.projectConversations[projectId].find((conversation) => conversation && conversation.id === activeConversationId)
        : null;

      if (activeConversation && isVisibleProjectConversation(activeConversation)) {
        return;
      }

      const firstConversation = state.projectConversations[projectId].find(isVisibleProjectConversation);
      state.activeConversationByProject[projectId] = firstConversation ? firstConversation.id : null;
    }
    
    async function addConversationForProject(projectId, text) {
      if (!projectId || !text) return null;
    
      const title = text.trim().replace(/\s+/g, ' ').slice(0, 52) || 'Conversa sem título';
    
      try {
        const result = await api.addConversation({
          projectId,
          title,
          meta: { source: 'user_prompt' },
        });
        if (!result || !result.ok) return null;

        state.projectConversations[projectId] = Array.isArray(result.conversations)
          ? result.conversations.filter(isVisibleProjectConversation)
          : [];
        return result.conversation || null;
      } catch {
        // Em caso de falha de persistência, mantemos o fluxo principal de chat sem bloquear o usuário.
        return null;
      }
    }
    
    async function ensureActiveConversationForSend(initialUserMessage) {
      const projectId = state.selectedProjectId;
      if (!projectId) return null;
    
      ensureConversationStateForProject(projectId);
      const shouldCreateNew =
        state.wantsNewConversationOnNextMessage || !getActiveConversationId(projectId);
    
      if (!shouldCreateNew) {
        const existingId = getActiveConversationId(projectId);
        await loadConversationMessages(existingId);
        return existingId;
      }
    
      const conversation = await addConversationForProject(projectId, initialUserMessage);
      if (conversation && conversation.id) {
        setActiveConversation(projectId, conversation.id);
        ensureConversationMessagesBucket(conversation.id);
        await loadConversationMessages(conversation.id);
        state.wantsNewConversationOnNextMessage = false;
        renderProjects();
        return conversation.id;
      }
    
      return null;
    }

    return {
      addConversationForProject,
      appendMessage,
      ensureActiveConversationForSend,
      ensureConversationMessagesBucket,
      ensureConversationStateForProject,
      ensureProjectConversationBucket,
      getActiveConversationId,
      loadConversationMessages,
      persistConversationMessage,
      renderChatForActiveConversation,
      setActiveConversation,
    };
  }

  window.FaberAppConversations = {
    createAppConversationController,
  };
})();
