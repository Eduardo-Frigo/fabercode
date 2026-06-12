(function () {
  function createInitialRendererState() {
    return {
      uiMode: 'default',
      aiRuntimeStatus: null,
      selectedAiProvider: 'rwkv',
      mempalaceStatus: null,
      lastAssistantMeta: null,
      projects: [],
      selectedProjectId: null,
      selectedProjectInfo: null,
      nextSteps: [],
      pendingAction: null,
      attachments: [],
      projectSearchQuery: '',
      expandedProjects: {},
      projectConversations: {},
      activeConversationByProject: {},
      conversationMessagesById: {},
      cortexLearningByProject: {},
      knowledgeRuntimeStatusByProject: {},
      wantsNewConversationOnNextMessage: false,
      activeJobId: null,
      jobPollingTimer: null,
      autoRetryInFlightByJob: {},
      autoRetryLastRunByJob: {},
      jobTerminalNoticeById: {},
      lastInterimPlanSignatureByJob: {},
      lastQualityReport: null,
      lastJobContext: null,
      automataContractLedger: [],
      automataContractSummary: null,
      cortexAttachments: [],
      cortexSelectedTopic: 'geral',
      interfaceLanguage: 'pt-BR',
      interfaceTheme: 'dark',
      panelFontScale: 100,
      workspaceLayoutPreferences: {
        mode: 'chat',
        leftCollapsed: false,
        rightCollapsed: false,
        leftSlot: 'projects',
        rightSlot: 'files',
        terminalDock: 'right',
        automationDock: 'right',
      },
    };
  }

  window.FaberAppState = {
    createInitialRendererState,
  };
})();
