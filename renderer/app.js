const state = {
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
  thinkingBubbleEl: null,
  autoRetryInFlightByJob: {},
  autoRetryLastRunByJob: {},
  jobTerminalNoticeById: {},
  lastInterimPlanSignatureByJob: {},
  lastQualityReport: null,
  lastJobContext: null,
  projectFileRows: [],
  projectFileDiffStats: {},
  aiSettingsDraft: null,
  cortexAttachments: [],
  cortexSelectedTopic: 'geral',
  interfaceLanguage: 'pt-BR',
  projectContextMenuProjectId: null,
  projectStateModalMode: null,
};

const BASE_TEXTAREA_HEIGHT = 84;
const MAX_TEXTAREA_HEIGHT = Math.round(BASE_TEXTAREA_HEIGHT * 1.5);

const appDragRegionEl = document.getElementById('app-drag-region');
const appShellEl = document.querySelector('.app-shell');
const panelCenterEl = document.querySelector('.panel-center');
const splitterLeftEl = document.getElementById('splitter-left');
const splitterRightEl = document.getElementById('splitter-right');
const projectsListEl = document.getElementById('projects-list');
const chatLogEl = document.getElementById('chat-log');
const welcomePanelEl = document.getElementById('welcome-panel');
const welcomeStartConversationBtnEl = document.getElementById('welcome-start-conversation');
const welcomeNewProjectBtnEl = document.getElementById('welcome-new-project');
const welcomeProjectModalEl = document.getElementById('welcome-project-modal');
const welcomeProjectBackdropEl = document.getElementById('welcome-project-backdrop');
const welcomeProjectCloseEl = document.getElementById('welcome-project-close');
const welcomeProjectListEl = document.getElementById('welcome-project-list');
const welcomeProjectCreateBtnEl = document.getElementById('welcome-project-create');
const pendingActionEl = document.getElementById('pending-action');
const pendingTextEl = document.getElementById('pending-text');
const inputEl = document.getElementById('user-input');
const statusPillEl = document.getElementById('status-pill');
const nextStepsListEl = document.getElementById('next-steps-list');
const modificationAlertEl = document.getElementById('modification-alert');
const imageInputEl = document.getElementById('image-input');
const attachmentListEl = document.getElementById('attachment-list');
const attachBtnEl = document.getElementById('btn-attach');
const composerProviderEl = document.getElementById('composer-provider');
const projectsSearchEl = document.getElementById('projects-search');
const newConversationBtnEl = document.getElementById('btn-new-conversation');
const cortexModeBtnEl = document.getElementById('btn-cortex-mode');
const centerTitleEl = document.getElementById('center-title');
const rightPanelTitleEl = document.getElementById('right-panel-title');
const incrementalModeBadgeEl = document.getElementById('incremental-mode-badge');
const cortexLearningBoxEl = document.getElementById('cortex-learning-box');
const cortexLearningContentEl = document.getElementById('cortex-learning-content');
const cortexModalEl = document.getElementById('cortex-modal');
const cortexModalBackdropEl = document.getElementById('cortex-modal-backdrop');
const cortexModalCloseEl = document.getElementById('cortex-modal-close');
const cortexTopicSelectEl = document.getElementById('cortex-topic-select');
const cortexChatLogEl = document.getElementById('cortex-chat-log');
const cortexInputEl = document.getElementById('cortex-input');
const cortexAttachBtnEl = document.getElementById('cortex-attach');
const cortexFileInputEl = document.getElementById('cortex-file-input');
const cortexAttachmentListEl = document.getElementById('cortex-attachment-list');
const cortexSendBtnEl = document.getElementById('cortex-send');
const cortexLibraryListEl = document.getElementById('cortex-library-list');
const cortexRulesListEl = document.getElementById('cortex-rules-list');
const cortexTopicListEl = document.getElementById('cortex-topic-list');
const cortexRuntimeStatusEl = document.getElementById('cortex-runtime-status');
const cortexTopicAddBtnEl = document.getElementById('cortex-topic-add');
const cortexTopicRenameBtnEl = document.getElementById('cortex-topic-rename');
const cortexLibraryAttachBtnEl = document.getElementById('cortex-library-attach');
const jobProgressEl = document.getElementById('job-progress');
const jobProgressTitleEl = document.getElementById('job-progress-title');
const jobProgressStatusEl = document.getElementById('job-progress-status');
const jobProgressDetailEl = document.getElementById('job-progress-detail');
const projectFilesTreeEl = document.getElementById('project-files-tree');
const projectFileContextMenuEl = document.getElementById('project-file-context-menu');
const projectFileModalEl = document.getElementById('project-file-modal');
const projectFileModalTitleEl = document.getElementById('project-file-modal-title');
const projectFileModalContentEl = document.getElementById('project-file-modal-content');
const projectFileModalCloseEl = document.getElementById('project-file-modal-close');
const projectFileEditorEl = document.getElementById('project-file-editor');
const projectFileLinesEl = document.getElementById('project-file-lines');
const projectFileSaveEl = document.getElementById('project-file-save');
const projectFileStatusEl = document.getElementById('project-file-status');
const unsavedExitModalEl = document.getElementById('unsaved-exit-modal');
const unsavedExitBackdropEl = document.getElementById('unsaved-exit-backdrop');
const unsavedExitNoEl = document.getElementById('unsaved-exit-no');
const unsavedExitYesEl = document.getElementById('unsaved-exit-yes');
const archivedProjectsBtnEl = document.getElementById('btn-archived-projects');
const trashProjectsBtnEl = document.getElementById('btn-trash-projects');
const projectSettingsBtnEl = document.getElementById('btn-project-settings');
const projectGitBtnEl = document.getElementById('btn-project-git');
const projectPreviewBtnEl = document.getElementById('btn-project-deploy');
const projectContextMenuEl = document.getElementById('project-context-menu');
const projectStateModalEl = document.getElementById('project-state-modal');
const projectStateModalCloseEl = document.getElementById('project-state-modal-close');
const projectStateModalTitleEl = document.getElementById('project-state-modal-title');
const projectStateModalListEl = document.getElementById('project-state-modal-list');
const projectStateModalFooterEl = document.getElementById('project-state-modal-footer');
const aiSettingsModalEl = document.getElementById('ai-settings-modal');
const aiSettingsBackdropEl = document.getElementById('ai-settings-backdrop');
const aiSettingsCloseEl = document.getElementById('ai-settings-close');
const aiSettingsCancelEl = document.getElementById('ai-settings-cancel');
const aiSettingsSaveEl = document.getElementById('ai-settings-save');
const aiSettingsProviderEl = document.getElementById('ai-settings-provider');
const aiSettingsRwkvGroupEl = document.getElementById('ai-settings-rwkv-group');
const aiSettingsGeminiGroupEl = document.getElementById('ai-settings-gemini-group');
const aiSettingsSambaNovaGroupEl = document.getElementById('ai-settings-sambanova-group');
const aiSettingsGeminiKeyEl = document.getElementById('ai-settings-gemini-key');
const aiSettingsGeminiModelEl = document.getElementById('ai-settings-gemini-model');
const aiSettingsGeminiLabelEl = document.getElementById('ai-settings-gemini-label');
const aiSettingsSambaNovaKeyEl = document.getElementById('ai-settings-sambanova-key');
const aiSettingsSambaNovaModelEl = document.getElementById('ai-settings-sambanova-model');
const aiSettingsSambaNovaLabelEl = document.getElementById('ai-settings-sambanova-label');
const aiSettingsProviderHelpEl = document.getElementById('ai-settings-provider-help');
const aiSettingsProviderHelpLinkEl = document.getElementById('ai-settings-provider-help-link');
const aiSettingsCurrentEl = document.getElementById('ai-settings-current');
const aiSettingsHomePanelEl = document.getElementById('ai-settings-home-panel');
const aiSettingsLanguagePanelEl = document.getElementById('ai-settings-language-panel');
const aiSettingsApisPanelEl = document.getElementById('ai-settings-apis-panel');
const aiSettingsOpenLanguageEl = document.getElementById('ai-settings-open-language');
const aiSettingsOpenApisEl = document.getElementById('ai-settings-open-apis');
const aiSettingsLanguageEl = document.getElementById('ai-settings-language');
const aiSettingsBackHomeEl = document.getElementById('ai-settings-back-home');
const aiSettingsBackHomeApisEl = document.getElementById('ai-settings-back-home-apis');
const aiSettingsApiListEl = document.getElementById('ai-settings-api-list');
const aiSettingsAddProviderEl = document.getElementById('ai-settings-add-provider');
const aiSettingsAddApiEl = document.getElementById('ai-settings-add-api');
const aiSettingsApiEditorEl = document.getElementById('ai-settings-api-editor');
const aiSettingsEditorIdEl = document.getElementById('ai-settings-editor-id');
const aiSettingsEditorKindEl = document.getElementById('ai-settings-editor-kind');
const aiSettingsEditorProviderEl = document.getElementById('ai-settings-editor-provider');
const aiSettingsEditorLabelEl = document.getElementById('ai-settings-editor-label');
const aiSettingsEditorModelEl = document.getElementById('ai-settings-editor-model');
const aiSettingsEditorKeyEl = document.getElementById('ai-settings-editor-key');
const aiSettingsEditorWebsiteEl = document.getElementById('ai-settings-editor-website');
const aiSettingsEditorCancelEl = document.getElementById('ai-settings-editor-cancel');
const aiSettingsEditorSaveEl = document.getElementById('ai-settings-editor-save');
const startupPreloaderEl = document.getElementById('startup-preloader');
const BOOT_MIN_PRELOADER_MS = 3000;
const bootStartedAt = Date.now();
let preloaderHideRequested = false;
let currentFileContextPath = null;
let currentFileOpenPath = null;
let currentFileOriginalContent = '';
let currentFileDirty = false;

let projectCodeEditor = null;
let projectCodeEditorBound = false;

const UI_TRANSLATIONS = {
  'pt-BR': {
    addProject: 'Novo projeto',
    search: 'Pesquisa',
    projects: 'Projetos',
    rulesMemory: 'Regras e memória',
    archivedProjects: 'Projetos arquivados',
    trash: 'Lixeira',
    settings: 'Configurações',
    waitingProject: 'Aguardando projeto',
    confirmExecute: 'Confirmar e Executar',
    cancel: 'Cancelar',
    processing: 'Processando',
    waiting: 'Aguardando',
    composerPlaceholder: 'Descreva o que você precisa. Enter envia; Shift+Enter quebra linha. A IA sempre vai confirmar antes de editar qualquer arquivo.',
    cortexComposerPlaceholder: 'Adicione regras, referências ou contexto para orientar a IA neste projeto.',
    attachImage: 'Anexar imagem',
    selectProjectAi: 'Selecionar IA do projeto',
    sendPrompt: 'Enviar prompt',
    files: 'Arquivos',
    contextConversation: 'Contexto e Conversa',
    rename: 'Renomear',
    archive: 'Arquivar',
    delete: 'Excluir',
    open: 'Abrir',
    revealInFolder: 'Mostrar na pasta',
    projectModalTitle: 'Projetos',
    cortexTitle: 'Cortex',
    cortexSubtitle: 'Regras, memória e referências',
    closeCortex: 'Fechar Cortex',
    cortexChatTitle: 'Conversar com o Cortex',
    cortexChatSubtitle: 'Contexto que orienta Persona e Executor',
    subject: 'Assunto',
    createSubject: 'Criar assunto',
    renameSubject: 'Renomear assunto',
    cortexInputPlaceholder: 'Explique uma regra, decisão, referência ou aprendizado para o Faber Code considerar.',
    attachMarkdown: 'Anexar Markdown',
    attachMarkdownShort: '.md',
    saveCortex: 'Salvar no Cortex',
    library: 'Biblioteca',
    librarySubtitle: 'Markdowns, PDFs e textos organizados por assunto',
    activeRules: 'Regras ativas',
    activeRulesSubtitle: 'O que entra no contexto dos próximos pedidos',
    cortexPanelRules: 'Regras e contexto',
    cortexPanelCopy: 'Registre preferências, decisões, referências e restrições que a Persona e o Executor devem considerar neste projeto.',
    memoryScopes: 'Escopos de memória',
    projectScope: 'Projeto',
    projectScopeCopy: 'Stack, objetivo, identidade visual e decisões atuais.',
    executionScope: 'Execução',
    executionScopeCopy: 'Cuidados técnicos, padrões de edição e aprendizados de falhas.',
    registeredMemory: 'Memória registrada',
    file: 'Arquivo',
    save: 'Salvar',
    noChanges: 'Sem alterações',
    fileViewer: 'Visualizador de arquivo',
    language: 'Idioma',
    languageDesc: 'Português, inglês ou espanhol para a experiência da ferramenta',
    configureApis: 'Configurar APIs',
    configureApisDesc: 'Veja chaves salvas, edite somente ao clicar em editar e adicione novos serviços',
    back: 'Voltar',
    interfaceLanguage: 'Idioma da interface',
    languageHelp: 'A preferência é aplicada à interface e fica salva nas configurações da ferramenta.',
    aiApis: 'APIs de IA',
    noKeyDetected: 'Nenhuma chave detectada ainda.',
    addApi: 'Adicionar API',
    service: 'Serviço',
    servicePlaceholder: 'Ex: OpenAI',
    apiName: 'Nome/Identificação',
    apiNamePlaceholder: 'Ex: Produção, Homologação, Pessoal',
    model: 'Modelo',
    modelPlaceholder: 'Ex: gpt-4.1-mini / gemini-2.0-flash',
    apiKey: 'API Key',
    apiKeyPlaceholder: 'Cole a chave (deixe vazio para manter a atual)',
    officialSite: 'Site oficial (opcional)',
    cancelEdit: 'Cancelar edição',
    saveEdit: 'Salvar edição',
    providerHelp: 'Abra a página oficial para criar ou revisar sua chave.',
    openProviderSite: 'Abrir site do provedor',
    languagePt: 'Português (Brasil) - padrão',
    languageEn: 'English',
    languageEs: 'Español',
    noMemory: 'Ainda não há regras ou memórias registradas nesta sessão.',
    selectProjectNextSteps: 'Selecione um projeto para exibir recomendações de deploy e validação.',
    updatedAt: 'Atualizado em:',
    noUpdate: 'sem atualização',
    personaRules: 'Regras para Persona:',
    executorRules: 'Regras para Executor:',
    noRulesYet: '- Sem regras registradas ainda.',
    unknownSize: 'tamanho desconhecido',
    cortexIntro: 'Use este espaço para guardar regras, decisões e documentos que o Faber Code deve considerar nos próximos trabalhos.',
    noAttachmentUpdate: 'Nenhum documento anexado nesta atualização.',
    removeCortexDoc: 'Remover documento do Cortex',
    noLibraryDocs: 'Nenhum Markdown, PDF ou TXT registrado ainda.',
    document: 'Documento',
    docRegistered: 'Documento registrado para consulta do Cortex.',
    noActiveRules: 'Sem regras ativas registradas ainda.',
    localMemoryReady: 'memória local pronta',
    persistenceActive: 'persistência ativa',
    semanticSearchActive: 'busca semântica ativa',
    runtimeNotFound: 'runtime não localizado',
    ingestionPending: 'ingestão pendente',
    searchReadyIngestionPending: 'busca pronta, ingestão pendente',
    disconnected: 'sem conexão',
    noResponse: 'sem resposta',
    cortexCounts: '{rules} regras, {documents} documentos',
    selectProjectForCortex: 'Selecione um projeto antes de salvar regras ou documentos no Cortex.',
    projectContextError: 'Não consegui atualizar o contexto do projeto antes de salvar no Cortex.',
    attachedDocs: '[Documentos anexados]',
    cortexSaved: 'Memória registrada no Cortex.',
    cortexSaveFailed: 'Não consegui salvar essa memória no Cortex.',
    memoryUpdated: 'Memória atualizada',
    topicNewPrompt: 'Nome do novo assunto:',
    topicRenamePrompt: 'Novo nome para este assunto:',
    topicSaved: 'Assunto salvo no Cortex.',
    topicRenamed: 'Assunto renomeado no Cortex.',
    topicSaveFailed: 'Não consegui salvar este assunto no Cortex.',
    topicNeedsProject: 'Selecione um projeto antes de organizar os assuntos do Cortex.',
    defaultTopicGeral: 'Geral',
    defaultTopicProduto: 'Produto',
    defaultTopicDesign: 'UI/UX e identidade visual',
    defaultTopicCodigo: 'Código e arquitetura',
    defaultTopicDeploy: 'Deploy e infraestrutura',
    defaultTopicIntegracoes: 'Integrações',
    keyNotConfigured: 'chave não configurada',
    keySaved: 'chave salva',
    keySavedEnding: 'chave salva final {tail}',
    notConfigured: 'Não configurada',
    ready: 'Pronta',
    needsConfig: 'Precisa configurar',
    local: 'Local',
    native: 'Nativa',
    custom: 'Custom',
    nativeLocalProviders: 'Provedores nativos e locais',
    customApis: 'APIs customizadas',
    noCustomApi: 'Nenhuma API customizada adicionada.',
    active: 'Ativa',
    use: 'Usar',
    edit: 'Editar',
    configure: 'Configurar',
    remove: 'Remover',
    noActiveAi: 'Nenhuma IA ativa selecionada',
    chooseReadyApi: 'Escolha uma opção pronta ou configure uma API customizada.',
    noLabel: 'Sem identificação',
    customProfile: 'Perfil customizado',
    defaultLocalModel: 'modelo: padrão/local',
    modelPrefix: 'modelo: {model}',
    activeAiProject: 'IA ativa no projeto: {name}',
    readyStart: 'Pronto para começar. Selecione um projeto e me diga o que você precisa.',
    welcomeAria: 'Começar no Faber Code',
    welcomeActions: 'Ações iniciais',
    welcomeStart: 'Iniciar conversa',
    welcomeStartHint: 'Escolha um projeto e descreva a próxima tarefa.',
    welcomeNewProject: 'Novo projeto',
    welcomeNewProjectHint: 'Crie ou selecione uma pasta para começar.',
    chooseProject: 'Escolha um projeto',
    chooseProjectHint: 'A conversa será criada no projeto selecionado.',
    startInProject: 'Iniciar',
    noProjectsForWelcome: 'Nenhum projeto disponível ainda.',
    createProject: 'Criar novo projeto',
    close: 'Fechar',
  },
  'en-US': {
    addProject: 'New project',
    search: 'Search',
    projects: 'Projects',
    rulesMemory: 'Rules and memory',
    archivedProjects: 'Archived projects',
    trash: 'Trash',
    settings: 'Settings',
    waitingProject: 'Waiting for project',
    confirmExecute: 'Confirm and Run',
    cancel: 'Cancel',
    processing: 'Processing',
    waiting: 'Waiting',
    composerPlaceholder: 'Describe what you need. Enter sends; Shift+Enter adds a line break. AI always confirms before editing files.',
    cortexComposerPlaceholder: 'Add rules, references, or context to guide the AI in this project.',
    attachImage: 'Attach image',
    selectProjectAi: 'Select project AI',
    sendPrompt: 'Send prompt',
    files: 'Files',
    contextConversation: 'Context and Conversation',
    rename: 'Rename',
    archive: 'Archive',
    delete: 'Delete',
    open: 'Open',
    revealInFolder: 'Show in folder',
    projectModalTitle: 'Projects',
    cortexTitle: 'Cortex',
    cortexSubtitle: 'Rules, memory, and references',
    closeCortex: 'Close Cortex',
    cortexChatTitle: 'Talk to Cortex',
    cortexChatSubtitle: 'Context that guides Persona and Executor',
    subject: 'Topic',
    createSubject: 'Create topic',
    renameSubject: 'Rename topic',
    cortexInputPlaceholder: 'Explain a rule, decision, reference, or lesson for Faber Code to consider.',
    attachMarkdown: 'Attach Markdown',
    attachMarkdownShort: '.md',
    saveCortex: 'Save to Cortex',
    library: 'Library',
    librarySubtitle: 'Markdowns, PDFs, and notes organized by topic',
    activeRules: 'Active rules',
    activeRulesSubtitle: 'What enters the context for upcoming requests',
    cortexPanelRules: 'Rules and context',
    cortexPanelCopy: 'Register preferences, decisions, references, and constraints that Persona and Executor should consider in this project.',
    memoryScopes: 'Memory scopes',
    projectScope: 'Project',
    projectScopeCopy: 'Stack, goal, visual identity, and current decisions.',
    executionScope: 'Execution',
    executionScopeCopy: 'Technical care, editing standards, and lessons from failures.',
    registeredMemory: 'Registered memory',
    file: 'File',
    save: 'Save',
    noChanges: 'No changes',
    fileViewer: 'File viewer',
    language: 'Language',
    languageDesc: 'Portuguese, English, or Spanish for the tool experience',
    configureApis: 'Configure APIs',
    configureApisDesc: 'Review saved keys, edit only after clicking edit, and add new services',
    back: 'Back',
    interfaceLanguage: 'Interface language',
    languageHelp: 'The preference is applied to the interface and saved in the tool settings.',
    aiApis: 'AI APIs',
    noKeyDetected: 'No key detected yet.',
    addApi: 'Add API',
    service: 'Service',
    servicePlaceholder: 'Ex: OpenAI',
    apiName: 'Name/Identifier',
    apiNamePlaceholder: 'Ex: Production, Staging, Personal',
    model: 'Model',
    modelPlaceholder: 'Ex: gpt-4.1-mini / gemini-2.0-flash',
    apiKey: 'API Key',
    apiKeyPlaceholder: 'Paste the key (leave empty to keep the current one)',
    officialSite: 'Official site (optional)',
    cancelEdit: 'Cancel edit',
    saveEdit: 'Save edit',
    providerHelp: 'Open the official page to create or review your key.',
    openProviderSite: 'Open provider site',
    languagePt: 'Português (Brasil) - default',
    languageEn: 'English',
    languageEs: 'Español',
    noMemory: 'There are no rules or memories registered in this session yet.',
    selectProjectNextSteps: 'Select a project to show deployment and validation recommendations.',
    updatedAt: 'Updated at:',
    noUpdate: 'no update',
    personaRules: 'Rules for Persona:',
    executorRules: 'Rules for Executor:',
    noRulesYet: '- No rules registered yet.',
    unknownSize: 'unknown size',
    cortexIntro: 'Use this space to store rules, decisions, and documents Faber Code should consider in future work.',
    noAttachmentUpdate: 'No document attached in this update.',
    removeCortexDoc: 'Remove document from Cortex',
    noLibraryDocs: 'No Markdown, PDF, or TXT registered yet.',
    document: 'Document',
    docRegistered: 'Document registered for Cortex lookup.',
    noActiveRules: 'No active rules registered yet.',
    localMemoryReady: 'local memory ready',
    persistenceActive: 'persistence active',
    semanticSearchActive: 'semantic search active',
    runtimeNotFound: 'runtime not found',
    ingestionPending: 'ingestion pending',
    searchReadyIngestionPending: 'search ready, ingestion pending',
    disconnected: 'disconnected',
    noResponse: 'no response',
    cortexCounts: '{rules} rules, {documents} documents',
    selectProjectForCortex: 'Select a project before saving rules or documents in Cortex.',
    projectContextError: 'I could not refresh the project context before saving to Cortex.',
    attachedDocs: '[Attached documents]',
    cortexSaved: 'Memory saved to Cortex.',
    cortexSaveFailed: 'I could not save this memory to Cortex.',
    memoryUpdated: 'Memory updated',
    topicNewPrompt: 'New topic name:',
    topicRenamePrompt: 'New name for this topic:',
    topicSaved: 'Topic saved in Cortex.',
    topicRenamed: 'Topic renamed in Cortex.',
    topicSaveFailed: 'I could not save this topic in Cortex.',
    topicNeedsProject: 'Select a project before organizing Cortex topics.',
    defaultTopicGeral: 'General',
    defaultTopicProduto: 'Product',
    defaultTopicDesign: 'UI/UX and visual identity',
    defaultTopicCodigo: 'Code and architecture',
    defaultTopicDeploy: 'Deploy and infrastructure',
    defaultTopicIntegracoes: 'Integrations',
    keyNotConfigured: 'key not configured',
    keySaved: 'saved key',
    keySavedEnding: 'saved key ending in {tail}',
    notConfigured: 'Not configured',
    ready: 'Ready',
    needsConfig: 'Needs setup',
    local: 'Local',
    native: 'Native',
    custom: 'Custom',
    nativeLocalProviders: 'Native and local providers',
    customApis: 'Custom APIs',
    noCustomApi: 'No custom API added.',
    active: 'Active',
    use: 'Use',
    edit: 'Edit',
    configure: 'Configure',
    remove: 'Remove',
    noActiveAi: 'No active AI selected',
    chooseReadyApi: 'Choose a ready option or configure a custom API.',
    noLabel: 'No identifier',
    customProfile: 'Custom profile',
    defaultLocalModel: 'model: default/local',
    modelPrefix: 'model: {model}',
    activeAiProject: 'Active AI in project: {name}',
    readyStart: 'Ready to start. Select a project and tell me what you need.',
    welcomeAria: 'Start in Faber Code',
    welcomeActions: 'Initial actions',
    welcomeStart: 'Start conversation',
    welcomeStartHint: 'Choose a project and describe the next task.',
    welcomeNewProject: 'New project',
    welcomeNewProjectHint: 'Create or select a folder to begin.',
    chooseProject: 'Choose a project',
    chooseProjectHint: 'The conversation will be created in the selected project.',
    startInProject: 'Start',
    noProjectsForWelcome: 'No project available yet.',
    createProject: 'Create new project',
    close: 'Close',
  },
  'es-ES': {
    addProject: 'Nuevo proyecto',
    search: 'Buscar',
    projects: 'Proyectos',
    rulesMemory: 'Reglas y memoria',
    archivedProjects: 'Proyectos archivados',
    trash: 'Papelera',
    settings: 'Configuración',
    waitingProject: 'Esperando proyecto',
    confirmExecute: 'Confirmar y ejecutar',
    cancel: 'Cancelar',
    processing: 'Procesando',
    waiting: 'Esperando',
    composerPlaceholder: 'Describe lo que necesitas. Enter envía; Shift+Enter crea una nueva línea. La IA siempre confirma antes de editar archivos.',
    cortexComposerPlaceholder: 'Agrega reglas, referencias o contexto para orientar la IA en este proyecto.',
    attachImage: 'Adjuntar imagen',
    selectProjectAi: 'Seleccionar IA del proyecto',
    sendPrompt: 'Enviar prompt',
    files: 'Archivos',
    contextConversation: 'Contexto y conversación',
    rename: 'Renombrar',
    archive: 'Archivar',
    delete: 'Eliminar',
    open: 'Abrir',
    revealInFolder: 'Mostrar en carpeta',
    projectModalTitle: 'Proyectos',
    cortexTitle: 'Cortex',
    cortexSubtitle: 'Reglas, memoria y referencias',
    closeCortex: 'Cerrar Cortex',
    cortexChatTitle: 'Hablar con Cortex',
    cortexChatSubtitle: 'Contexto que orienta Persona y Executor',
    subject: 'Tema',
    createSubject: 'Crear tema',
    renameSubject: 'Renombrar tema',
    cortexInputPlaceholder: 'Explica una regla, decisión, referencia o aprendizaje para que Faber Code lo considere.',
    attachMarkdown: 'Adjuntar Markdown',
    attachMarkdownShort: '.md',
    saveCortex: 'Guardar en Cortex',
    library: 'Biblioteca',
    librarySubtitle: 'Markdowns, PDFs y textos organizados por tema',
    activeRules: 'Reglas activas',
    activeRulesSubtitle: 'Lo que entra en el contexto de las próximas solicitudes',
    cortexPanelRules: 'Reglas y contexto',
    cortexPanelCopy: 'Registra preferencias, decisiones, referencias y restricciones que Persona y Executor deben considerar en este proyecto.',
    memoryScopes: 'Ámbitos de memoria',
    projectScope: 'Proyecto',
    projectScopeCopy: 'Stack, objetivo, identidad visual y decisiones actuales.',
    executionScope: 'Ejecución',
    executionScopeCopy: 'Cuidados técnicos, patrones de edición y aprendizajes de fallas.',
    registeredMemory: 'Memoria registrada',
    file: 'Archivo',
    save: 'Guardar',
    noChanges: 'Sin cambios',
    fileViewer: 'Visor de archivo',
    language: 'Idioma',
    languageDesc: 'Portugués, inglés o español para la experiencia de la herramienta',
    configureApis: 'Configurar APIs',
    configureApisDesc: 'Revisa claves guardadas, edita solo al hacer clic en editar y agrega nuevos servicios',
    back: 'Volver',
    interfaceLanguage: 'Idioma de la interfaz',
    languageHelp: 'La preferencia se aplica a la interfaz y queda guardada en la configuración de la herramienta.',
    aiApis: 'APIs de IA',
    noKeyDetected: 'Todavía no se detectó ninguna clave.',
    addApi: 'Agregar API',
    service: 'Servicio',
    servicePlaceholder: 'Ej: OpenAI',
    apiName: 'Nombre/Identificación',
    apiNamePlaceholder: 'Ej: Producción, Homologación, Personal',
    model: 'Modelo',
    modelPlaceholder: 'Ej: gpt-4.1-mini / gemini-2.0-flash',
    apiKey: 'API Key',
    apiKeyPlaceholder: 'Pega la clave (déjala vacía para mantener la actual)',
    officialSite: 'Sitio oficial (opcional)',
    cancelEdit: 'Cancelar edición',
    saveEdit: 'Guardar edición',
    providerHelp: 'Abre la página oficial para crear o revisar tu clave.',
    openProviderSite: 'Abrir sitio del proveedor',
    languagePt: 'Português (Brasil) - predeterminado',
    languageEn: 'English',
    languageEs: 'Español',
    noMemory: 'Todavía no hay reglas o memorias registradas en esta sesión.',
    selectProjectNextSteps: 'Selecciona un proyecto para ver recomendaciones de deploy y validación.',
    updatedAt: 'Actualizado el:',
    noUpdate: 'sin actualización',
    personaRules: 'Reglas para Persona:',
    executorRules: 'Reglas para Executor:',
    noRulesYet: '- Todavía no hay reglas registradas.',
    unknownSize: 'tamaño desconocido',
    cortexIntro: 'Usa este espacio para guardar reglas, decisiones y documentos que Faber Code debe considerar en próximos trabajos.',
    noAttachmentUpdate: 'Ningún documento adjunto en esta actualización.',
    removeCortexDoc: 'Quitar documento de Cortex',
    noLibraryDocs: 'Todavía no hay Markdown, PDF o TXT registrado.',
    document: 'Documento',
    docRegistered: 'Documento registrado para consulta de Cortex.',
    noActiveRules: 'Todavía no hay reglas activas registradas.',
    localMemoryReady: 'memoria local lista',
    persistenceActive: 'persistencia activa',
    semanticSearchActive: 'búsqueda semántica activa',
    runtimeNotFound: 'runtime no localizado',
    ingestionPending: 'ingesta pendiente',
    searchReadyIngestionPending: 'búsqueda lista, ingesta pendiente',
    disconnected: 'sin conexión',
    noResponse: 'sin respuesta',
    cortexCounts: '{rules} reglas, {documents} documentos',
    selectProjectForCortex: 'Selecciona un proyecto antes de guardar reglas o documentos en Cortex.',
    projectContextError: 'No pude actualizar el contexto del proyecto antes de guardar en Cortex.',
    attachedDocs: '[Documentos adjuntos]',
    cortexSaved: 'Memoria guardada en Cortex.',
    cortexSaveFailed: 'No pude guardar esta memoria en Cortex.',
    memoryUpdated: 'Memoria actualizada',
    topicNewPrompt: 'Nombre del nuevo tema:',
    topicRenamePrompt: 'Nuevo nombre para este tema:',
    topicSaved: 'Tema guardado en Cortex.',
    topicRenamed: 'Tema renombrado en Cortex.',
    topicSaveFailed: 'No pude guardar este tema en Cortex.',
    topicNeedsProject: 'Selecciona un proyecto antes de organizar los temas de Cortex.',
    defaultTopicGeral: 'General',
    defaultTopicProduto: 'Producto',
    defaultTopicDesign: 'UI/UX e identidad visual',
    defaultTopicCodigo: 'Código y arquitectura',
    defaultTopicDeploy: 'Deploy e infraestructura',
    defaultTopicIntegracoes: 'Integraciones',
    keyNotConfigured: 'clave no configurada',
    keySaved: 'clave guardada',
    keySavedEnding: 'clave guardada termina en {tail}',
    notConfigured: 'No configurada',
    ready: 'Lista',
    needsConfig: 'Necesita configuración',
    local: 'Local',
    native: 'Nativa',
    custom: 'Custom',
    nativeLocalProviders: 'Proveedores nativos y locales',
    customApis: 'APIs customizadas',
    noCustomApi: 'No se agregó ninguna API customizada.',
    active: 'Activa',
    use: 'Usar',
    edit: 'Editar',
    configure: 'Configurar',
    remove: 'Eliminar',
    noActiveAi: 'Ninguna IA activa seleccionada',
    chooseReadyApi: 'Elige una opción lista o configura una API customizada.',
    noLabel: 'Sin identificación',
    customProfile: 'Perfil customizado',
    defaultLocalModel: 'modelo: predeterminado/local',
    modelPrefix: 'modelo: {model}',
    activeAiProject: 'IA activa en el proyecto: {name}',
    readyStart: 'Listo para empezar. Selecciona un proyecto y dime qué necesitas.',
    welcomeAria: 'Empezar en Faber Code',
    welcomeActions: 'Acciones iniciales',
    welcomeStart: 'Iniciar conversación',
    welcomeStartHint: 'Elige un proyecto y describe la próxima tarea.',
    welcomeNewProject: 'Nuevo proyecto',
    welcomeNewProjectHint: 'Crea o selecciona una carpeta para empezar.',
    chooseProject: 'Elige un proyecto',
    chooseProjectHint: 'La conversación se creará en el proyecto seleccionado.',
    startInProject: 'Iniciar',
    noProjectsForWelcome: 'Todavía no hay proyectos disponibles.',
    createProject: 'Crear nuevo proyecto',
    close: 'Cerrar',
  },
};

function t(key, fallback = '') {
  const locale = state.interfaceLanguage || 'pt-BR';
  const table = UI_TRANSLATIONS[locale] || UI_TRANSLATIONS['pt-BR'];
  const pt = UI_TRANSLATIONS['pt-BR'];
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : pt[key] || fallback || key;
}

function setNodeText(selector, key, fallback) {
  const node = document.querySelector(selector);
  if (node) node.textContent = t(key, fallback);
}

function setNodeAttribute(selector, attribute, key, fallback) {
  const node = document.querySelector(selector);
  if (node) node.setAttribute(attribute, t(key, fallback));
}

function applyStaticTranslations() {
  setNodeText('#btn-add-project span:last-child', 'addProject');
  setNodeAttribute('#projects-search', 'placeholder', 'search');
  setNodeText('.left-section-title', 'projects');
  setNodeAttribute('#btn-cortex-mode', 'title', 'rulesMemory');
  setNodeAttribute('#btn-cortex-mode', 'aria-label', 'rulesMemory');
  setNodeAttribute('#btn-archived-projects', 'title', 'archivedProjects');
  setNodeAttribute('#btn-archived-projects', 'aria-label', 'archivedProjects');
  setNodeAttribute('#btn-trash-projects', 'title', 'trash');
  setNodeAttribute('#btn-trash-projects', 'aria-label', 'trash');
  setNodeAttribute('#btn-project-settings', 'title', 'settings');
  setNodeAttribute('#btn-project-settings', 'aria-label', 'settings');
  setNodeText('#btn-confirm', 'confirmExecute');
  setNodeText('#btn-cancel', 'cancel');
  setNodeText('#job-progress-title', 'processing');
  setNodeText('#job-progress-status', 'waiting');
  setNodeAttribute('#welcome-panel', 'aria-label', 'welcomeAria');
  setNodeAttribute('.welcome-panel__actions', 'aria-label', 'welcomeActions');
  setNodeText('#welcome-start-conversation span', 'welcomeStart');
  setNodeText('#welcome-start-conversation small', 'welcomeStartHint');
  setNodeText('#welcome-new-project span', 'welcomeNewProject');
  setNodeText('#welcome-new-project small', 'welcomeNewProjectHint');
  setNodeAttribute('#welcome-project-modal .welcome-project-modal__dialog', 'aria-label', 'chooseProject');
  setNodeText('#welcome-project-title', 'chooseProject');
  setNodeText('#welcome-project-subtitle', 'chooseProjectHint');
  setNodeText('#welcome-project-create', 'createProject');
  setNodeAttribute('#welcome-project-close', 'aria-label', 'close');
  setNodeAttribute('#btn-attach', 'title', 'attachImage');
  setNodeAttribute('#btn-attach', 'aria-label', 'attachImage');
  setNodeAttribute('#composer-provider', 'title', 'selectProjectAi');
  setNodeAttribute('#composer-provider', 'aria-label', 'selectProjectAi');
  setNodeAttribute('#btn-send', 'title', 'sendPrompt');
  setNodeAttribute('#btn-send', 'aria-label', 'sendPrompt');
  setNodeText('#project-context-menu button[data-action="rename"]', 'rename');
  setNodeText('#project-context-menu button[data-action="archive"]', 'archive');
  setNodeText('#project-context-menu button[data-action="trash"]', 'delete');
  setNodeText('#project-file-context-menu button[data-action="open"]', 'open');
  setNodeText('#project-file-context-menu button[data-action="reveal"]', 'revealInFolder');
  setNodeText('#project-state-modal-title', 'projectModalTitle');
  setNodeText('#cortex-modal .cortex-modal__title strong', 'cortexTitle');
  setNodeText('#cortex-modal .cortex-modal__title span:last-child', 'cortexSubtitle');
  setNodeAttribute('#cortex-modal-close', 'aria-label', 'closeCortex');
  setNodeText('.cortex-chat-card .cortex-card__head strong', 'cortexChatTitle');
  setNodeText('.cortex-chat-card .cortex-card__head span', 'cortexChatSubtitle');
  setNodeText('.cortex-topic-row label', 'subject');
  setNodeAttribute('#cortex-topic-add', 'title', 'createSubject');
  setNodeAttribute('#cortex-topic-add', 'aria-label', 'createSubject');
  setNodeAttribute('#cortex-topic-rename', 'title', 'renameSubject');
  setNodeAttribute('#cortex-topic-rename', 'aria-label', 'renameSubject');
  setNodeAttribute('#cortex-input', 'placeholder', 'cortexInputPlaceholder');
  setNodeText('#cortex-attach', 'attachMarkdown');
  setNodeText('#cortex-send', 'saveCortex');
  setNodeText('.cortex-memory-card .cortex-card__head strong', 'library');
  setNodeText('.cortex-memory-card .cortex-card__head span', 'librarySubtitle');
  setNodeAttribute('#cortex-library-attach', 'title', 'attachMarkdown');
  setNodeAttribute('#cortex-library-attach', 'aria-label', 'attachMarkdown');
  setNodeText('#cortex-library-attach span', 'attachMarkdownShort');
  setNodeText('.cortex-rules-card .cortex-card__head strong', 'activeRules');
  setNodeText('.cortex-rules-card .cortex-card__head span', 'activeRulesSubtitle');
  setNodeText('#cortex-learning-box h3:first-child', 'cortexPanelRules');
  setNodeText('.cortex-memory-copy', 'cortexPanelCopy');
  setNodeAttribute('.cortex-memory-scope', 'aria-label', 'memoryScopes');
  setNodeText('.cortex-memory-scope > div:first-child strong', 'projectScope');
  setNodeText('.cortex-memory-scope > div:first-child span', 'projectScopeCopy');
  setNodeText('.cortex-memory-scope > div:last-child strong', 'executionScope');
  setNodeText('.cortex-memory-scope > div:last-child span', 'executionScopeCopy');
  setNodeText('#cortex-learning-box h3:nth-of-type(2)', 'registeredMemory');
  setNodeAttribute('#project-file-modal .project-file-modal__dialog', 'aria-label', 'fileViewer');
  setNodeText('#project-file-modal-title', 'file');
  setNodeText('#project-file-save', 'save');
  setNodeText('#project-file-status', 'noChanges');
  setNodeText('#ai-settings-modal .ai-settings-modal__head strong', 'settings');
  setNodeText('#ai-settings-open-language strong', 'language');
  setNodeText('#ai-settings-open-language span', 'languageDesc');
  setNodeText('#ai-settings-open-apis strong', 'configureApis');
  setNodeText('#ai-settings-open-apis span', 'configureApisDesc');
  setNodeText('#ai-settings-back-home', 'back');
  setNodeText('#ai-settings-language-panel .ai-settings-panel-head span', 'language');
  setNodeText('#ai-settings-language-panel .ai-settings-field span', 'interfaceLanguage');
  setNodeText('#ai-settings-language option[value="pt-BR"]', 'languagePt');
  setNodeText('#ai-settings-language option[value="en-US"]', 'languageEn');
  setNodeText('#ai-settings-language option[value="es-ES"]', 'languageEs');
  setNodeText('#ai-settings-language-panel .ai-settings-help', 'languageHelp');
  setNodeText('#ai-settings-back-home-apis', 'back');
  setNodeText('#ai-settings-apis-panel .ai-settings-panel-head span', 'aiApis');
  setNodeText('#ai-settings-current', 'noKeyDetected');
  setNodeText('#ai-settings-add-api', 'addApi');
  setNodeText('label[for="ai-settings-editor-provider"] span', 'service');
  setNodeText('label[for="ai-settings-editor-label"] span', 'apiName');
  setNodeText('label[for="ai-settings-editor-model"] span', 'model');
  setNodeText('label[for="ai-settings-editor-key"] span', 'apiKey');
  setNodeText('label[for="ai-settings-editor-website"] span', 'officialSite');
  setNodeAttribute('#ai-settings-editor-provider', 'placeholder', 'servicePlaceholder');
  setNodeAttribute('#ai-settings-editor-label', 'placeholder', 'apiNamePlaceholder');
  setNodeAttribute('#ai-settings-editor-model', 'placeholder', 'modelPlaceholder');
  setNodeAttribute('#ai-settings-editor-key', 'placeholder', 'apiKeyPlaceholder');
  setNodeText('#ai-settings-editor-cancel', 'cancelEdit');
  setNodeText('#ai-settings-editor-save', 'saveEdit');
  setNodeText('#ai-settings-provider-help-text', 'providerHelp');
  setNodeText('#ai-settings-provider-help-link', 'openProviderSite');
  setNodeText('#ai-settings-cancel', 'cancel');
  setNodeText('#ai-settings-save', 'save');
  const editorFieldKeys = ['service', 'apiName', 'model', 'apiKey', 'officialSite'];
  document.querySelectorAll('#ai-settings-api-editor .ai-settings-field > span').forEach((node, index) => {
    node.textContent = t(editorFieldKeys[index] || 'service');
  });
}

function applyInterfaceLanguage(locale, options = {}) {
  const normalized = normalizeInterfaceLanguage(locale);
  state.interfaceLanguage = normalized;
  if (document.documentElement) {
    document.documentElement.lang = normalized;
  }
  applyStaticTranslations();
  if (inputEl) {
    inputEl.placeholder = state.uiMode === 'cortex' ? t('cortexComposerPlaceholder') : t('composerPlaceholder');
  }
  if (options.rerender !== false) {
    setUiMode(state.uiMode);
    renderNextSteps();
    renderCortexLearning(state.cortexLearningByProject[state.selectedProjectId] || null);
    renderAiSettingsApiList();
    refreshAiSettingsCurrentLine();
    renderWelcomePanel();
  }
}

const PANEL_LAYOUT_STORAGE_KEY = 'faber.panelLayout.v1';
const PANEL_LAYOUT_LIMITS = {
  leftMin: 260,
  leftMax: 520,
  rightMin: 280,
  rightMax: 560,
  centerMin: 500,
  defaultLeft: 320,
  defaultRight: 360,
};

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(numeric, min), max);
}

function readStoredPanelLayout() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY) || '{}');
    return {
      left: Number(parsed.left) || PANEL_LAYOUT_LIMITS.defaultLeft,
      right: Number(parsed.right) || PANEL_LAYOUT_LIMITS.defaultRight,
    };
  } catch {
    return {
      left: PANEL_LAYOUT_LIMITS.defaultLeft,
      right: PANEL_LAYOUT_LIMITS.defaultRight,
    };
  }
}

function getCurrentPanelLayout() {
  const leftPanel = document.querySelector('.panel-left');
  const rightPanel = document.querySelector('.panel-right');
  return {
    left: leftPanel ? leftPanel.getBoundingClientRect().width : PANEL_LAYOUT_LIMITS.defaultLeft,
    right: rightPanel ? rightPanel.getBoundingClientRect().width : PANEL_LAYOUT_LIMITS.defaultRight,
  };
}

function normalizePanelLayout(layout = {}) {
  const shellWidth = appShellEl ? appShellEl.getBoundingClientRect().width : window.innerWidth;
  const availableForSidebars = Math.max(
    PANEL_LAYOUT_LIMITS.leftMin + PANEL_LAYOUT_LIMITS.rightMin,
    shellWidth - PANEL_LAYOUT_LIMITS.centerMin - 72
  );
  let left = clampNumber(layout.left, PANEL_LAYOUT_LIMITS.leftMin, PANEL_LAYOUT_LIMITS.leftMax);
  let right = clampNumber(layout.right, PANEL_LAYOUT_LIMITS.rightMin, PANEL_LAYOUT_LIMITS.rightMax);

  const overflow = left + right - availableForSidebars;
  if (overflow > 0) {
    const rightReduction = Math.min(overflow, Math.max(0, right - PANEL_LAYOUT_LIMITS.rightMin));
    right -= rightReduction;
    const remaining = overflow - rightReduction;
    if (remaining > 0) {
      left -= Math.min(remaining, Math.max(0, left - PANEL_LAYOUT_LIMITS.leftMin));
    }
  }

  return {
    left: Math.round(clampNumber(left, PANEL_LAYOUT_LIMITS.leftMin, PANEL_LAYOUT_LIMITS.leftMax)),
    right: Math.round(clampNumber(right, PANEL_LAYOUT_LIMITS.rightMin, PANEL_LAYOUT_LIMITS.rightMax)),
  };
}

function applyPanelLayout(layout = {}, options = {}) {
  if (!appShellEl) return;
  const next = normalizePanelLayout(layout);
  appShellEl.style.setProperty('--faber-left-panel-width', `${next.left}px`);
  appShellEl.style.setProperty('--faber-right-panel-width', `${next.right}px`);
  if (options.persist) {
    try {
      window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }
}

function bindPanelSplitter(handle, side) {
  if (!handle || !appShellEl) return;

  function startResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startLayout = getCurrentPanelLayout();
    document.body.classList.add('is-panel-resizing');
    handle.classList.add('is-dragging');

    function onPointerMove(moveEvent) {
      const deltaX = moveEvent.clientX - startX;
      const nextLayout = {
        left: side === 'left' ? startLayout.left + deltaX : startLayout.left,
        right: side === 'right' ? startLayout.right - deltaX : startLayout.right,
      };
      applyPanelLayout(nextLayout);
    }

    function onPointerUp() {
      document.body.classList.remove('is-panel-resizing');
      handle.classList.remove('is-dragging');
      applyPanelLayout(getCurrentPanelLayout(), { persist: true });
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  handle.addEventListener('pointerdown', startResize);
  handle.addEventListener('dblclick', (event) => {
    event.preventDefault();
    applyPanelLayout({
      left: PANEL_LAYOUT_LIMITS.defaultLeft,
      right: PANEL_LAYOUT_LIMITS.defaultRight,
    }, { persist: true });
  });
}

function initializePanelLayout() {
  applyPanelLayout(readStoredPanelLayout());
  bindPanelSplitter(splitterLeftEl, 'left');
  bindPanelSplitter(splitterRightEl, 'right');
  window.addEventListener('resize', () => {
    applyPanelLayout(getCurrentPanelLayout(), { persist: true });
  });
}

function getEditorModeFromPath(path) {
  const p = String(path || '').toLowerCase();
  if (/\.(js|jsx|mjs|cjs)$/.test(p)) return 'javascript';
  if (/\.(ts|tsx)$/.test(p)) return 'text/typescript';
  if (/\.(css|scss)$/.test(p)) return 'css';
  if (/\.(html|htm)$/.test(p)) return 'htmlmixed';
  if (/\.json$/.test(p)) return { name: 'javascript', json: true };
  if (/\.md$/.test(p)) return 'markdown';
  return 'text/plain';
}

function ensureProjectCodeEditor() {
  if (projectCodeEditor || !projectFileEditorEl || typeof window.CodeMirror !== 'function') return projectCodeEditor;

  projectCodeEditor = window.CodeMirror.fromTextArea(projectFileEditorEl, {
    mode: 'text/plain',
    theme: 'material-darker',
    lineNumbers: true,
    lineWrapping: false,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    smartIndent: true,
    autofocus: false,
  });

  const wrapper = projectCodeEditor.getWrapperElement();
  if (wrapper) {
    wrapper.id = 'project-file-editor-cm';
    wrapper.classList.add('project-file-editor-cm');
  }
  document.body.classList.add('cm-ready');

  return projectCodeEditor;
}

function getProjectEditorValue() {
  if (projectCodeEditor) return String(projectCodeEditor.getValue() || '');
  if (!projectFileEditorEl) return '';
  return String(projectFileEditorEl.value || '');
}

function setProjectEditorValue(value) {
  const text = String(value || '');
  if (projectCodeEditor) {
    projectCodeEditor.setValue(text);
    projectCodeEditor.clearHistory();
    projectCodeEditor.setCursor({ line: 0, ch: 0 });
    return;
  }
  if (projectFileEditorEl) {
    projectFileEditorEl.value = text;
    projectFileEditorEl.scrollTop = 0;
    projectFileEditorEl.scrollLeft = 0;
  }
}

function focusProjectEditor() {
  if (projectCodeEditor) {
    projectCodeEditor.focus();
    return;
  }
  if (projectFileEditorEl) {
    projectFileEditorEl.focus();
  }
}

function setProjectEditorMode(path) {
  const mode = getEditorModeFromPath(path);
  if (projectCodeEditor) {
    projectCodeEditor.setOption('mode', mode);
  }
}

function bindProjectCodeEditorEvents() {
  if (!projectCodeEditor || projectCodeEditorBound) return;
  projectCodeEditorBound = true;

  projectCodeEditor.on('change', () => {
    const text = getProjectEditorValue();
    setFileDirty(text !== currentFileOriginalContent);
  });

  projectCodeEditor.on('keydown', async (_cm, event) => {
    if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 's') {
      event.preventDefault();
      await saveCurrentOpenFile();
    }
  });
}

function refreshProjectEditorLayout() {
  if (projectCodeEditor) {
    projectCodeEditor.refresh();
  }
}

function hideStartupPreloader() {
  if (preloaderHideRequested) return;
  preloaderHideRequested = true;

  const finish = () => {
    if (startupPreloaderEl && startupPreloaderEl.parentNode) {
      startupPreloaderEl.parentNode.removeChild(startupPreloaderEl);
    }
    document.body.classList.add('ui-ready');
  };

  if (!startupPreloaderEl) {
    finish();
    return;
  }

  const elapsed = Date.now() - bootStartedAt;
  const waitMs = Math.max(0, BOOT_MIN_PRELOADER_MS - elapsed);

  setTimeout(() => {
    startupPreloaderEl.classList.add('is-hidden');
    setTimeout(finish, 460);
  }, waitMs);
}


function isCodeFilePath(p) {
  return /\.(js|jsx|ts|tsx|css|scss|html|htm|json|md|txt)$/i.test(String(p || ''));
}
function isImageFilePath(p) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(String(p || ''));
}
function getBaseName(p) {
  const s = String(p || '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}
function setFileDirty(flag) {
  currentFileDirty = Boolean(flag);
  if (projectFileSaveEl) projectFileSaveEl.disabled = !currentFileDirty;
  if (projectFileStatusEl) projectFileStatusEl.textContent = currentFileDirty ? 'Alterações não salvas' : 'Sem alterações';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function syntaxHighlightText(content, filePath) {
  const ext = String(filePath || "").toLowerCase().split(".").pop() || "";
  const supported = ["js", "jsx", "ts", "tsx", "css", "scss", "html", "htm", "json", "md", "txt"];
  if (supported.indexOf(ext) < 0) return escapeHtml(content);

  let html = escapeHtml(content);
  const tokenMap = [];

  function reserveToken(className, value) {
    const key = "\uE000" + "¤".repeat(tokenMap.length + 1) + "\uE001";
    tokenMap.push([key, '<span class="' + className + '">' + value + '</span>']);
    return key;
  }

  function tokenize(regex, className) {
    html = html.replace(regex, (m) => reserveToken(className, m));
  }

  tokenize(/(&lt;!--[\s\S]*?--&gt;|\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g, "tok-comment");
  tokenize(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, "tok-string");

  if (ext === "html" || ext === "htm") {
    tokenize(/&lt;\/?[a-zA-Z][\w:-]*/g, "tok-tag");
    tokenize(/\b[a-zA-Z_:][-a-zA-Z0-9_:.]*(?==)/g, "tok-attr");
  }

  if (ext === "css" || ext === "scss") {
    html = html.replace(/(^|[\{;\s])([a-zA-Z-]+)(\s*:)/gm, (m, p1, p2, p3) => {
      return p1 + reserveToken("tok-prop", p2) + p3;
    });
  }

  tokenize(/\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|class|new|import|export|from|default|async|await|true|false|null|undefined)\b/g, "tok-key");
  tokenize(/\b(\d+(?:\.\d+)?)(px|rem|em|vh|vw|%|ms|s)?\b/g, "tok-number");
  tokenize(/\b([a-zA-Z_$][\w$]*)(?=\s*\()/g, "tok-fn");
  tokenize(/([{}()\[\];,.])/g, "tok-punct");
  tokenize(/([=:+\-*\/<>])/g, "tok-op");

  for (const [key, value] of tokenMap) {
    html = html.split(key).join(value);
  }

  return html;
}

function updateEditorDecorations() {
  if (projectCodeEditor) return;
  if (!projectFileEditorEl || !projectFileModalContentEl) return;
  const text = String(projectFileEditorEl.value || '');
  const lineCount = Math.max(1, text.split('\n').length);

  if (projectFileLinesEl) {
    projectFileLinesEl.textContent = Array.from({ length: lineCount }, (_, i) => String(i + 1)).join('\n');
  }

  projectFileModalContentEl.innerHTML = syntaxHighlightText(text, currentFileOpenPath);
}

function syncEditorOverlayScroll() {
  if (projectCodeEditor) return;
  if (!projectFileEditorEl) return;
  if (projectFileModalContentEl) {
    projectFileModalContentEl.scrollTop = projectFileEditorEl.scrollTop;
    projectFileModalContentEl.scrollLeft = projectFileEditorEl.scrollLeft;
  }
  if (projectFileLinesEl) {
    projectFileLinesEl.scrollTop = projectFileEditorEl.scrollTop;
  }
}

function stripInjectedHighlightArtifacts(text) {
  const raw = String(text || "");
  const openPath = String(currentFileOpenPath || "").toLowerCase();
  const isHtmlFile = /\.html?$/.test(openPath);
  const hasTokArtifacts = /tok-(comment|string|number|key|prop|fn|tag|attr|op|punct)/.test(raw) || /__LC_TOK_X+__/.test(raw);

  if (!hasTokArtifacts) return raw;

  let clean = raw;

  clean = clean.replace(/<span[^>]*tok-[^>]*>([\s\S]*?)<\/span>/gi, "$1");
  clean = clean.replace(/class=["'][^"']*tok-[^"']*["']/gi, "");

  if (!isHtmlFile) {
    clean = clean.replace(/<\/?span\b[^>]*>/gi, "");
  }

  clean = clean
    .replace(/&lt;span[^&]*tok-[^&]*&gt;/gi, "")
    .replace(/&lt;\/span&gt;/gi, "")
    .replace(/__LC_TOK_X+__(?=\s*\()/g, "catch")
    .replace(/__LC_TOK_X+__/g, "");

  return clean;
}



async function promptUnsavedExitWithoutSaving() {
  if (!unsavedExitModalEl || !unsavedExitNoEl || !unsavedExitYesEl || !unsavedExitBackdropEl) {
    return confirm('Você alterou o projeto, deseja sair sem salvar?');
  }

  return new Promise((resolve) => {
    const finish = (discard) => {
      unsavedExitModalEl.classList.add('hidden');
      unsavedExitModalEl.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onKeydown);
      unsavedExitNoEl.removeEventListener('click', onNo);
      unsavedExitYesEl.removeEventListener('click', onYes);
      unsavedExitBackdropEl.removeEventListener('click', onNo);
      resolve(discard);
    };

    const onNo = () => finish(false);
    const onYes = () => finish(true);
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (document.activeElement === unsavedExitYesEl) {
          finish(true);
        } else {
          finish(false);
        }
      }
    };

    unsavedExitModalEl.classList.remove('hidden');
    unsavedExitModalEl.setAttribute('aria-hidden', 'false');

    unsavedExitNoEl.addEventListener('click', onNo);
    unsavedExitYesEl.addEventListener('click', onYes);
    unsavedExitBackdropEl.addEventListener('click', onNo);
    document.addEventListener('keydown', onKeydown);

    setTimeout(() => {
      try {
        unsavedExitNoEl.focus({ preventScroll: true });
      } catch (_) {
        unsavedExitNoEl.focus();
      }
    }, 0);
  });
}

async function closeProjectFileLightbox(options = {}) {
  const { skipDirtyCheck = false } = options;
  if (!projectFileModalEl) return true;

  if (!skipDirtyCheck && currentFileDirty) {
    const discard = await promptUnsavedExitWithoutSaving();
    if (!discard) return false;
  }

  projectFileModalEl.classList.add('hidden');
  projectFileModalEl.setAttribute('aria-hidden', 'true');

  if (projectFileModalContentEl) {
    projectFileModalContentEl.innerHTML = '';
    projectFileModalContentEl.style.display = '';
    projectFileModalContentEl.style.whiteSpace = '';
  }
  if (projectCodeEditor) {
    projectCodeEditor.setValue('');
    const wrap = projectCodeEditor.getWrapperElement();
    if (wrap) wrap.style.display = 'none';
  }
  if (projectFileEditorEl) {
    projectFileEditorEl.value = '';
    projectFileEditorEl.style.display = projectCodeEditor ? 'none' : 'block';
    projectFileEditorEl.scrollTop = 0;
    projectFileEditorEl.scrollLeft = 0;
  }
  if (projectFileLinesEl) {
    projectFileLinesEl.textContent = '1';
    projectFileLinesEl.style.display = '';
    projectFileLinesEl.scrollTop = 0;
  }

  currentFileOpenPath = null;
  currentFileOriginalContent = '';
  setFileDirty(false);
  return true;
}
async function saveCurrentOpenFile() {
  if (!projectFileEditorEl || !currentFileOpenPath || !state.selectedProjectInfo) return false;

  const cleanContent = stripInjectedHighlightArtifacts(getProjectEditorValue());
  const result = await window.localcodeApi.writeProjectFile({
    projectInfo: state.selectedProjectInfo,
    relativePath: currentFileOpenPath,
    content: cleanContent,
  });

  if (!result || !result.ok) {
    appendMessage("assistant", (result && result.message) || "Falha ao salvar arquivo.", { persistToConversation: false });
    return false;
  }

  currentFileOriginalContent = cleanContent;
  setFileDirty(false);
  await refreshProjectFilesTree();
  return true;
}

async function openProjectFileLightbox(relativePath) {
  if (!relativePath || !state.selectedProjectInfo) return;

  if (
    currentFileDirty &&
    projectFileModalEl &&
    !projectFileModalEl.classList.contains('hidden') &&
    currentFileOpenPath &&
    currentFileOpenPath !== relativePath
  ) {
    const closed = await closeProjectFileLightbox();
    if (!closed) return;
  }

  currentFileOpenPath = relativePath;
  if (projectFileModalTitleEl) projectFileModalTitleEl.textContent = relativePath;
  if (projectFileStatusEl) projectFileStatusEl.textContent = 'Sem alterações';

  if (isImageFilePath(relativePath)) {
    const abs = String(state.selectedProjectInfo.rootPath || '') + '/' + String(relativePath || '');
    if (projectCodeEditor) {
      const wrap = projectCodeEditor.getWrapperElement();
      if (wrap) wrap.style.display = 'none';
    }
    if (projectFileEditorEl) projectFileEditorEl.style.display = 'none';
    if (projectFileSaveEl) projectFileSaveEl.style.display = 'none';
    if (projectFileLinesEl) projectFileLinesEl.style.display = 'none';
    if (projectFileModalContentEl) {
      projectFileModalContentEl.style.display = 'block';
      projectFileModalContentEl.style.whiteSpace = 'normal';
      projectFileModalContentEl.innerHTML = '<img src="' + ('file://' + abs).replace(/ /g, '%20') + '" style="max-width:100%;height:auto;display:block;margin:0 auto;" />';
    }
    if (projectFileModalEl) {
      projectFileModalEl.classList.remove('hidden');
      projectFileModalEl.setAttribute('aria-hidden', 'false');
    }
    setFileDirty(false);
    return;
  }

  const result = await window.localcodeApi.readProjectFile({
    projectInfo: state.selectedProjectInfo,
    relativePath,
  });
  if (!result || !result.ok) {
    appendMessage('assistant', (result && result.message) || 'Falha ao abrir arquivo.', { persistToConversation: false });
    return;
  }

  const rawContent = String(result.content || '');
  const normalizedContent = stripInjectedHighlightArtifacts(rawContent);
  const wasSanitized = normalizedContent !== rawContent;
  currentFileOriginalContent = normalizedContent;

  const cm = ensureProjectCodeEditor();
  if (cm) {
    if (projectFileModalContentEl) {
      projectFileModalContentEl.style.display = 'none';
      projectFileModalContentEl.innerHTML = '';
    }
    if (projectFileLinesEl) {
      projectFileLinesEl.style.display = 'none';
    }
    setProjectEditorMode(relativePath);
    setProjectEditorValue(normalizedContent);
    const wrap = cm.getWrapperElement();
    if (wrap) wrap.style.display = 'block';
    if (projectFileEditorEl) projectFileEditorEl.style.display = 'none';
  } else {
    if (projectFileModalContentEl) {
      projectFileModalContentEl.style.display = 'block';
      projectFileModalContentEl.style.whiteSpace = 'pre';
      projectFileModalContentEl.innerHTML = '';
    }
    if (projectFileLinesEl) {
      projectFileLinesEl.style.display = 'block';
    }
  }

  if (!cm && projectFileEditorEl) {
    document.body.classList.remove('cm-ready');
    projectFileEditorEl.style.display = 'block';
    projectFileEditorEl.value = normalizedContent;
    projectFileEditorEl.scrollTop = 0;
    projectFileEditorEl.scrollLeft = 0;
  }
  focusProjectEditor();
  setTimeout(() => {
    focusProjectEditor();
    refreshProjectEditorLayout();
  }, 0);
  if (projectFileSaveEl) {
    projectFileSaveEl.style.display = '';
    projectFileSaveEl.disabled = true;
  }

  setFileDirty(wasSanitized);
  if (wasSanitized && projectFileStatusEl) {
    projectFileStatusEl.textContent = "Conteúdo recuperado, salve para aplicar";
  }
  updateEditorDecorations();
  syncEditorOverlayScroll();
  refreshProjectEditorLayout();

  if (projectFileModalEl) {
    projectFileModalEl.classList.remove('hidden');
    projectFileModalEl.setAttribute('aria-hidden', 'false');
  }
}
function showProjectFileContextMenu(relativePath, x, y) {
  if (!projectFileContextMenuEl) return;
  currentFileContextPath = relativePath;
  projectFileContextMenuEl.classList.remove('hidden');
  projectFileContextMenuEl.style.left = String(x) + 'px';
  projectFileContextMenuEl.style.top = String(y) + 'px';
}
function hideProjectFileContextMenu() {
  if (!projectFileContextMenuEl) return;
  projectFileContextMenuEl.classList.add('hidden');
  projectFileContextMenuEl.style.left = '-9999px';
  projectFileContextMenuEl.style.top = '-9999px';
}
function resetTextareaHeight() {
  inputEl.style.height = `${BASE_TEXTAREA_HEIGHT}px`;
  inputEl.style.overflowY = 'hidden';
}

function autoResizeTextarea() {
  inputEl.style.height = `${BASE_TEXTAREA_HEIGHT}px`;
  const targetHeight = Math.max(BASE_TEXTAREA_HEIGHT, Math.min(inputEl.scrollHeight, MAX_TEXTAREA_HEIGHT));
  inputEl.style.height = `${targetHeight}px`;
  inputEl.style.overflowY = inputEl.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
}

function renderAttachments() {
  attachmentListEl.innerHTML = '';

  if (!state.attachments.length) {
    attachmentListEl.classList.add('hidden');
    return;
  }

  attachmentListEl.classList.remove('hidden');

  state.attachments.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    const name = document.createElement('span');
    name.className = 'attachment-name';
    name.textContent = file.name;

    const remove = document.createElement('button');
    remove.className = 'attachment-remove';
    remove.type = 'button';
    remove.title = 'Remover anexo';
    remove.textContent = 'x';
    remove.onclick = () => {
      state.attachments.splice(index, 1);
      renderAttachments();
    };

    chip.append(name, remove);
    attachmentListEl.appendChild(chip);
  });
  console.info('[renderProjects] children=', projectsListEl ? projectsListEl.children.length : 'null', 'htmlSize=', projectsListEl ? projectsListEl.innerHTML.length : 0);
}

function renderMessageBubble(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  chatLogEl.appendChild(div);
  return div;
}

function shouldShowWelcomePanel() {
  if (!welcomePanelEl || !chatLogEl) return false;
  if (state.uiMode === 'cortex') return false;
  const hasChatContent = chatLogEl.children.length > 0;
  const hasPendingAction = pendingActionEl && !pendingActionEl.classList.contains('hidden');
  const hasJobProgress = jobProgressEl && !jobProgressEl.classList.contains('hidden');
  return !hasChatContent && !hasPendingAction && !hasJobProgress;
}

function renderWelcomePanel() {
  if (!welcomePanelEl || !chatLogEl) return;
  const visible = shouldShowWelcomePanel();
  welcomePanelEl.classList.toggle('hidden', !visible);
  chatLogEl.classList.toggle('chat-log--welcome-hidden', visible);
  if (panelCenterEl) {
    panelCenterEl.classList.toggle('panel-center--welcome', visible);
  }
}

function closeWelcomeProjectModal() {
  if (!welcomeProjectModalEl) return;
  welcomeProjectModalEl.classList.add('hidden');
  welcomeProjectModalEl.setAttribute('aria-hidden', 'true');
}

function getWelcomeProjectRows() {
  return (Array.isArray(state.projects) ? state.projects : [])
    .filter((project) => project && project.id && !project.deletedAt && !project.archivedAt);
}

async function startWelcomeConversationForProject(projectId) {
  if (!projectId) return;
  closeWelcomeProjectModal();
  await prepareNewConversationForProject(projectId);
  renderWelcomePanel();
  setTimeout(() => {
    if (inputEl) inputEl.focus();
  }, 0);
}

function renderWelcomeProjectList() {
  if (!welcomeProjectListEl) return;
  const rows = getWelcomeProjectRows();
  welcomeProjectListEl.innerHTML = '';

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'welcome-project-empty';
    empty.textContent = t('noProjectsForWelcome');
    welcomeProjectListEl.appendChild(empty);
    return;
  }

  rows.forEach((project) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'welcome-project-row';
    if (project.id === state.selectedProjectId) item.classList.add('active');

    const info = document.createElement('span');
    info.className = 'welcome-project-row__info';
    const name = document.createElement('strong');
    name.textContent = String(project.name || 'Projeto');
    const path = document.createElement('small');
    path.textContent = String(project.rootPath || '');
    info.append(name, path);

    const action = document.createElement('span');
    action.className = 'welcome-project-row__action';
    action.textContent = t('startInProject');

    item.append(info, action);
    item.addEventListener('click', async () => {
      await startWelcomeConversationForProject(project.id);
    });
    welcomeProjectListEl.appendChild(item);
  });
}

function openWelcomeProjectModal() {
  if (!welcomeProjectModalEl) return;
  renderWelcomeProjectList();
  welcomeProjectModalEl.classList.remove('hidden');
  welcomeProjectModalEl.setAttribute('aria-hidden', 'false');
}

async function onWelcomeCreateProject() {
  closeWelcomeProjectModal();
  await onAddProject();
  renderWelcomePanel();
}

function buildDiagnosticsContextHint(report) {
  if (!report || typeof report !== 'object') return null;
  const issues = Array.isArray(report.issues) ? report.issues : [];
  if (!issues.length) return null;
  return {
    summary: report.summary || null,
    issues: issues.slice(0, 8).map((issue) => ({
      file: issue.file || 'arquivo_desconhecido',
      severity: issue.severity || 'warning',
      detail: issue.detail || '',
      hint: issue.hint || '',
      source: issue.source || '',
    })),
  };
}

function showPersonaThinkingIndicator() {
  if (state.thinkingBubbleEl) return state.thinkingBubbleEl;

  const bubble = document.createElement('div');
  bubble.className = 'msg assistant thinking';
  bubble.setAttribute('aria-live', 'polite');
  bubble.innerHTML =
    '<span class="thinking-label">Pensando</span><span class="thinking-dots"><span></span><span></span><span></span></span>';

  chatLogEl.appendChild(bubble);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
  state.thinkingBubbleEl = bubble;
  renderWelcomePanel();
  return bubble;
}

function hidePersonaThinkingIndicator() {
  if (state.thinkingBubbleEl && state.thinkingBubbleEl.parentNode) {
    state.thinkingBubbleEl.parentNode.removeChild(state.thinkingBubbleEl);
  }
  state.thinkingBubbleEl = null;
  renderWelcomePanel();
}

function getRecentConversationMessagesForPersona(limit = 10) {
  const conversationId = getActiveConversationId(state.selectedProjectId);
  if (!conversationId) return [];
  const messages = state.conversationMessagesById[conversationId] || [];
  return messages
    .slice(Math.max(0, messages.length - limit))
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      text: String(message.text || '').slice(0, 1200),
      createdAt: message.createdAt || null,
    }))
    .filter((message) => message.text.trim());
}

function buildJobContextForPersona(job) {
  if (!job) return null;
  const request = job.request && typeof job.request === 'object' ? job.request : {};
  return {
    status: job.status || null,
    phase: job.phase || null,
    lastError: job.lastError || null,
    lastUserMessage: request.userMessage || null,
    retryable: job.retryState ? job.retryState.retryable !== false : null,
    failedAt: job.updatedAt || job.completedAt || null,
  };
}


function isManualRetryMessage(text = '') {
  const normalized = String(text || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /^(tente novamente|tenta novamente|tentar novamente|retente|retentar|continue|continua|de novo|tente de novo|repita|pode tentar novamente)$/.test(normalized);
}

function buildPersonaRequestContextHint(extra = {}) {
  return {
    awaitingTechnicalPdfConfirmation: Boolean(
      state.lastAssistantMeta && state.lastAssistantMeta.awaitingTechnicalPdfConfirmation
    ),
    awaitingScaffoldClarification: Boolean(
      state.lastAssistantMeta && state.lastAssistantMeta.awaitingScaffoldClarification
    ),
    scaffoldClarificationAttempts:
      state.lastAssistantMeta && Number.isFinite(state.lastAssistantMeta.scaffoldClarificationAttempts)
        ? Number(state.lastAssistantMeta.scaffoldClarificationAttempts)
        : 0,
    personaPlanAttempts:
      state.lastAssistantMeta && Number.isFinite(state.lastAssistantMeta.personaPlanAttempts)
        ? Number(state.lastAssistantMeta.personaPlanAttempts)
        : 0,
    personaPlanStartedAt:
      state.lastAssistantMeta && typeof state.lastAssistantMeta.personaPlanStartedAt === 'string'
        ? state.lastAssistantMeta.personaPlanStartedAt
        : null,
    lastPlanner: state.lastAssistantMeta && state.lastAssistantMeta.planner ? state.lastAssistantMeta.planner : null,
    lastIntent: state.lastAssistantMeta && state.lastAssistantMeta.intent ? state.lastAssistantMeta.intent : null,
    lastReason: state.lastAssistantMeta && state.lastAssistantMeta.reason ? state.lastAssistantMeta.reason : null,
    lastHadAction: Boolean(state.lastAssistantMeta && state.lastAssistantMeta.lastHadAction),
    lastScaffoldPrompt:
      state.lastAssistantMeta && typeof state.lastAssistantMeta.lastScaffoldPrompt === 'string'
        ? state.lastAssistantMeta.lastScaffoldPrompt
        : null,
    latestDiagnostics: buildDiagnosticsContextHint(state.lastQualityReport),
    lastJobContext: state.lastJobContext,
    ...extra,
  };
}

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
    const result = await window.localcodeApi.listConversationMessages({
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

async function persistConversationMessage(role, text) {
  const projectId = state.selectedProjectId;
  const conversationId = getActiveConversationId(projectId);
  if (!projectId || !conversationId) return;

  try {
    await window.localcodeApi.addConversationMessage({
      projectId,
      conversationId,
      role,
      text,
      meta: { mode: state.uiMode },
    });
  } catch {
    // não bloqueia chat por falha de persistência
  }
}

function appendMessage(role, text, options = {}) {
  const { persistToConversation = true } = options;

  // Evita spam visual quando o mesmo erro/resposta é reenviado em loop de retentativa.
  if (role === 'assistant' && chatLogEl) {
    const nextText = String(text || '').trim();
    if (nextText) {
      const children = Array.from(chatLogEl.children || []);
      let scanned = 0;
      for (let idx = children.length - 1; idx >= 0 && scanned < 8; idx -= 1) {
        const node = children[idx];
        if (!node || !node.classList || !node.classList.contains('msg')) continue;
        if (!node.classList.contains('assistant')) continue;
        scanned += 1;
        const lastText = String(node.textContent || '').trim();
        if (lastText && lastText === nextText) {
          return;
        }
      }
    }
  }
  const projectId = state.selectedProjectId;
  const conversationId = getActiveConversationId(projectId);

  if (persistToConversation && conversationId) {
    ensureConversationMessagesBucket(conversationId);
    state.conversationMessagesById[conversationId].push({ role, text, createdAt: new Date().toISOString() });
    persistConversationMessage(role, text);
  }

  renderMessageBubble(role, text);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
  renderWelcomePanel();
}

function renderChatForActiveConversation() {
  hidePersonaThinkingIndicator();
  chatLogEl.innerHTML = '';
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
    renderMessageBubble(message.role, message.text);
  });
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
  renderWelcomePanel();
}

function appendChangeCard(action, result) {
  if (!action || !action.targetFile) return;

  const card = document.createElement('div');
  card.className = 'change-card';

  const header = document.createElement('div');
  header.className = 'change-card-header';

  const fileBtn = document.createElement('button');
  fileBtn.type = 'button';
  fileBtn.className = 'change-card-file';
  fileBtn.textContent = action.targetFile;
  fileBtn.title = 'Abrir no Finder';
  fileBtn.onclick = async () => {
    await window.localcodeApi.revealFileInFolder({
      projectInfo: state.selectedProjectInfo,
      relativePath: action.targetFile,
    });
  };

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'change-card-toggle';
  toggle.textContent = 'Expandir código';

  const body = document.createElement('div');
  body.className = 'change-card-body hidden';
  const pre = document.createElement('pre');
  pre.textContent = action.diffPreview || result.message || 'Sem diff disponível.';
  body.appendChild(pre);

  toggle.onclick = () => {
    const hidden = body.classList.contains('hidden');
    body.classList.toggle('hidden', !hidden);
    toggle.textContent = hidden ? 'Recolher código' : 'Expandir código';
  };

  header.append(fileBtn, toggle);
  card.append(header, body);
  chatLogEl.appendChild(card);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
  renderWelcomePanel();
}

function updateStatus(text) {
  statusPillEl.textContent = text;
}

function buildTransientStatusFromJob(job) {
  if (!job || !job.status) return '';
  if (job.status === 'completed') return 'Processamento concluído com sucesso.';
  if (job.status === 'failed') return 'Não consegui concluir esta rodada.';
  if (job.status === 'cancelled') return 'Ação cancelada. Nenhum arquivo foi alterado.';
  if (job.status === 'retry_pending') {
    const reason = String(job.lastError || '').toLowerCase();
    if (/429|rate.?limit|quota/.test(reason)) return 'Aguardando janela de API para nova tentativa...';
    return 'Aguardando janela de retentativa...';
  }

  const phase = String(job.phase || '').toLowerCase();
  if (phase === 'created') return 'A Persona autorizou iniciar a análise técnica.';
  if (phase === 'persona_plan' || phase === 'cortex_briefing' || phase === 'cortex_intake') {
    return 'Analisando contexto e código do projeto.';
  }
  if (phase === 'awaiting_user_confirmation') return 'Encontrei a raiz do problema e preparei a correção.';
  if (phase === 'execute_pending' || phase === 'cortex_render_pass') return 'Aplicando alterações no projeto.';
  if (phase === 'cortex_validation' || phase === 'execute_validation') return 'Validando resultado da correção.';
  if (phase === 'paused_memory_pressure') return 'Pausado por pressão de memória, aguardando retomada.';
  return 'Trabalhando no projeto.';
}

function buildExecutionOutcomeAssistantMessage(result, action, qualityReport) {
  const isOk = Boolean(result && result.ok);
  const blockedByValidation = Boolean(result && result.blockedByPostExecutionValidation);
  const blockedByEffect = Boolean(result && result.blockedByExecutionEffect);
  const modifiedFiles = Array.isArray(result && result.modifiedFiles) ? result.modifiedFiles : [];
  const modifiedPreview = modifiedFiles.slice(0, 8);
  const summary = qualityReport && qualityReport.summary ? qualityReport.summary : {};
  const errors = Math.max(0, Number(summary.errors || 0));
  const warnings = Math.max(0, Number(summary.warnings || 0));
  const filesChecked = Math.max(0, Number(summary.checkedFiles || summary.filesChecked || 0));
  const artifactQuality = summary.artifactQuality || null;
  const totals = result && result.executionReport && result.executionReport.totals ? result.executionReport.totals : {};
  const add = Math.max(0, Number(totals.add || 0));
  const del = Math.max(0, Number(totals.del || 0));
  const totalDelta = add + del;
  const autoRepairAttempt = Number.isFinite(Number(result && result.autoRepairAttempt))
    ? Number(result.autoRepairAttempt)
    : 0;

  const lines = [];
  lines.push(isOk ? 'Concluído. A alteração foi aplicada com sucesso.' : 'A rodada não foi concluída ainda.');
  lines.push('');
  lines.push('Resumo da execução:');
  if (action && action.humanSummary) {
    lines.push(`- Objetivo aplicado: ${String(action.humanSummary).trim()}`);
  }
  lines.push(`- Arquivos alterados: ${modifiedFiles.length}`);
  if (modifiedPreview.length) {
    lines.push(`- Lista: ${modifiedPreview.join(', ')}${modifiedFiles.length > modifiedPreview.length ? ', ...' : ''}`);
  }
  lines.push(`- Diff útil: +${add} / -${del} (delta total ${totalDelta})`);
  lines.push(`- Auto-reparo nesta rodada: ${autoRepairAttempt}`);
  lines.push('');

  lines.push('Critérios de aceite:');
  const effectOk = !blockedByEffect && (modifiedFiles.length > 0 || totalDelta > 0 || !blockedByValidation);
  lines.push(`- Mudança efetiva no projeto: ${effectOk ? 'PASSOU' : 'FALHOU'}`);
  lines.push(`- Validação técnica pós-execução: ${errors === 0 ? 'PASSOU' : 'FALHOU'} (${errors} erro(s), ${warnings} aviso(s), ${filesChecked} arquivo(s) verificado(s))`);
  if (artifactQuality && Number.isFinite(Number(artifactQuality.score))) {
    lines.push(`- Qualidade visual/aderência: ${Number(artifactQuality.score)}% (mínimo ${Number(artifactQuality.minScore || 0)}%)`);
  }
  lines.push(`- Resultado final da rodada: ${isOk ? 'PASSOU' : 'FALHOU'}`);

  if (!isOk) {
    lines.push('');
    lines.push(`Motivo do bloqueio: ${String((result && result.message) || 'Execução bloqueada por critérios de qualidade.').trim()}`);
    lines.push('Próximo passo: posso continuar no mesmo projeto com uma correção incremental orientada por esse diagnóstico.');
  } else {
    lines.push('');
    lines.push('Se quiser, sigo no mesmo projeto com o próximo ajuste incremental sem recriar o projeto inteiro.');
  }

  return lines.join('\n');
}

function shouldSuppressInterimAssistantPlanMessage(plan) {
  const reason = String((plan && plan.meta && plan.meta.reason) || '').toLowerCase();
  if (!reason) return false;
  if (reason.startsWith('cortex_briefing_error')) return true;
  if (reason.startsWith('cortex_validation_score:')) return true;
  if (reason === 'cortex_validation_unmet' || reason.startsWith('cortex_validation_unmet')) return true;
  if (reason === 'paused_memory_pressure') return true;
  if (reason.includes('retry')) return true;
  return false;
}

function parseProviderHttpStatusFromReason(reason) {
  const text = String(reason || '');
  const match = text.match(/http\s*(\d{3})/i);
  return match ? Number(match[1]) : null;
}

function buildTerminalJobMessage(job) {
  if (!job) return null;
  if (job.status === 'completed') {
    const completedEvent = Array.isArray(job.events)
      ? job.events.find((event) => event && event.type === 'job.completed')
      : null;
    if (completedEvent && completedEvent.payload && completedEvent.payload.noFileChanges) {
      return null;
    }
    return 'Processamento concluído com sucesso.';
  }

  if (job.status === 'cancelled') {
    return null;
  }

  if (job.status === 'failed') {
    const reason = String(job.lastError || '');
    const httpStatus = parseProviderHttpStatusFromReason(reason);

    if (httpStatus === 429 || /quota|billing|insufficient_quota|rate limit/i.test(reason)) {
      if (/sambanova/i.test(reason)) {
        return 'Falha final: limite/rate limit da API SambaNova atingido. Aguarde, reduza cadência ou troque de provedor.';
      }
      if (/gemini/i.test(reason)) {
        return 'Falha final: limite da API Gemini atingido (quota/rate limit). Ajuste a cota/chave ou troque de provedor.';
      }
      return 'Falha final: limite de API atingido (quota/rate limit). Ajuste a cota/chave ou troque de provedor.';
    }

    if (/executor.*(json|plano)|plano JSON válido|json válido/i.test(reason)) {
      return 'Não consegui transformar a resposta da IA em uma alteração segura de arquivos. Mantive o projeto intacto; você pode tentar novamente e eu vou usar o contexto desta falha.';
    }

    if (reason.startsWith('cortex_briefing_error')) {
      return 'Falha final no briefing da Persona. O job foi encerrado sem repetição automática.';
    }

    return 'Não consegui concluir esta execução. Mantive o projeto protegido para uma nova correção orientada pelo diagnóstico.';
  }

  return null;
}

function compactJobReason(reason) {
  const text = String(reason || '').trim();
  if (!text) return '';
  const normalized = text
    .replace(/^cortex_[a-z0-9_]+:?/i, '')
    .replace(/^persona_[a-z0-9_]+:?/i, '')
    .replace(/^execute_[a-z0-9_]+:?/i, '');
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function formatJobTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR');
  } catch {
    return '';
  }
}

function buildTechnicalTimelineFromJob(job) {
  const events = Array.isArray(job && job.events) ? job.events.slice(0, 8) : [];
  if (!events.length) return [];

  return events.map((event) => {
    const type = String((event && event.type) || 'job.event');
    const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
    const ts = formatJobTime(event && event.createdAt);

    if (type === 'job.phase_changed') {
      const phase = mapJobPhaseLabel(String(payload.phase || ''));
      const attempt = Number.isFinite(Number(payload.attempt)) ? `tentativa ${Number(payload.attempt)}` : null;
      const progressPct = Number.isFinite(Number(payload.progressPct)) ? `${Number(payload.progressPct)}%` : null;
      const autoRepairAttempt = Number.isFinite(Number(payload.autoRepairAttempt))
        ? `reparo ${Number(payload.autoRepairAttempt)}`
        : null;
      const detail = [attempt, progressPct, autoRepairAttempt].filter(Boolean).join(' · ');
      return `${ts} ${phase}${detail ? ` — ${detail}` : ''}`.trim();
    }

    if (type === 'job.retry_pending') {
      const phase = mapJobPhaseLabel(String(payload.phase || ''));
      const retryable = payload.retryable === false ? 'sem nova retentativa' : 'retentativa ativa';
      const reason = compactJobReason(payload.reason);
      return `${ts} Retentativa (${phase}) — ${retryable}${reason ? ` · ${reason}` : ''}`.trim();
    }

    if (type === 'job.auto_repair_planning') {
      const attempt = Number.isFinite(Number(payload.autoRepairAttempt))
        ? Number(payload.autoRepairAttempt)
        : null;
      const maxPass = Number.isFinite(Number(payload.maxAutoRepairPasses))
        ? Number(payload.maxAutoRepairPasses)
        : null;
      return `${ts} Planejando auto-reparo${attempt ? ` ${attempt}/${maxPass || '?'}` : ''}`.trim();
    }

    if (type === 'job.auto_repair_plan_ready') {
      const file = payload.targetFile ? `arquivo ${payload.targetFile}` : null;
      return `${ts} Plano de auto-reparo pronto${file ? ` — ${file}` : ''}`.trim();
    }

    if (type === 'job.auto_repair_plan_failed') {
      const reason = compactJobReason(payload.reason);
      return `${ts} Falha ao montar plano de auto-reparo${reason ? ` — ${reason}` : ''}`.trim();
    }

    if (type === 'job.execute_pass_started') {
      const pass = Number.isFinite(Number(payload.executionPass)) ? Number(payload.executionPass) : null;
      const total = Number.isFinite(Number(payload.totalPlannedPasses)) ? Number(payload.totalPlannedPasses) : null;
      const file = payload.targetFile ? `arquivo ${payload.targetFile}` : null;
      return `${ts} Execução de patch${pass ? ` ${pass}/${total || '?'}` : ''}${file ? ` — ${file}` : ''}`.trim();
    }

    if (type === 'job.execute_pass_finished') {
      const files = Number.isFinite(Number(payload.modifiedFilesCount))
        ? `${Number(payload.modifiedFilesCount)} arquivo(s)`
        : null;
      return `${ts} Patch aplicado${files ? ` — ${files}` : ''}`.trim();
    }

    if (type === 'job.execute_validation_blocked') {
      const errors = Number.isFinite(Number(payload.errors)) ? Number(payload.errors) : null;
      const warnings = Number.isFinite(Number(payload.warnings)) ? Number(payload.warnings) : null;
      const reason = compactJobReason(payload.reason);
      const counts = errors === null && warnings === null ? null : `erros ${errors || 0} · avisos ${warnings || 0}`;
      return `${ts} Validação bloqueou conclusão${counts ? ` — ${counts}` : ''}${reason ? ` · ${reason}` : ''}`.trim();
    }

    if (type === 'job.execute_effect_blocked') {
      const taskType = payload.taskType ? `tarefa ${payload.taskType}` : null;
      const modifiedFilesCount = Number.isFinite(Number(payload.modifiedFilesCount))
        ? `${Number(payload.modifiedFilesCount)} arquivo(s)`
        : null;
      const totalDelta = Number.isFinite(Number(payload.totalDelta)) ? `delta ${Number(payload.totalDelta)}` : null;
      const reason = compactJobReason(payload.reason);
      const detail = [taskType, modifiedFilesCount, totalDelta].filter(Boolean).join(' · ');
      return `${ts} Execução sem efeito útil${detail ? ` — ${detail}` : ''}${reason ? ` · ${reason}` : ''}`.trim();
    }

    if (type === 'job.completed') return `${ts} Processamento concluído`.trim();
    if (type === 'job.failed') {
      const reason = compactJobReason(payload.reason);
      return `${ts} Falha final${reason ? ` — ${reason}` : ''}`.trim();
    }
    if (type === 'job.checkpoint_saved') {
      const key = payload.key ? `checkpoint ${payload.key}` : 'checkpoint salvo';
      return `${ts} ${key}`.trim();
    }
    if (type === 'job.created') return `${ts} Job iniciado`.trim();

    return `${ts} ${type}`.trim();
  });
}

function mapJobPhaseLabel(phase) {
  const labels = {
    created: 'Fila criada',
    cortex_intake: 'Intake Cortex',
    cortex_briefing: 'Briefing da Persona',
    cortex_render_pass: 'Render do Executor',
    cortex_validation: 'Validação',
    execute_validation: 'Validação técnica',
    persona_plan: 'Planejamento da Persona',
    awaiting_user_confirmation: 'Aguardando confirmação',
    execute_pending: 'Execução do Executor',
    paused_memory_pressure: 'Pausado por memória',
    persona_done: 'Planejamento concluído',
    cancelled: 'Cancelado',
    done: 'Concluído',
    failed: 'Falhou',
  };
  return labels[phase] || phase || 'Processando';
}

function stopJobPolling() {
  if (state.jobPollingTimer) {
    clearInterval(state.jobPollingTimer);
    state.jobPollingTimer = null;
  }
}

function hideJobProgress() {
  jobProgressEl.classList.add('hidden');
  jobProgressDetailEl.textContent = '';
  renderWelcomePanel();
}

function renderJobProgress(job) {
  if (!job) {
    hideJobProgress();
    return;
  }

  const transientStatus = buildTransientStatusFromJob(job);
  if (transientStatus) updateStatus(transientStatus);

  jobProgressEl.classList.remove('hidden');
  renderWelcomePanel();
  const titleByStatus =
    job.status === 'failed'
      ? 'Não consegui concluir essa execução'
      : job.status === 'completed'
        ? 'Execução concluída'
        : job.status === 'retry_pending'
          ? 'Vou tentar novamente em instantes'
          : 'Trabalhando no projeto';
  jobProgressTitleEl.textContent = titleByStatus;

  const phaseLabel = mapJobPhaseLabel(job.phase);
  const statusLabel =
    job.status === 'completed'
      ? 'Concluído'
      : job.status === 'failed'
        ? 'Falha'
        : job.status === 'cancelled'
          ? 'Cancelado'
          : job.status === 'retry_pending'
            ? 'Aguardando retentativa'
            : 'Em andamento';

  const progressPct =
    job && job.progress && Number.isFinite(Number(job.progress.pct))
      ? Math.max(0, Math.min(100, Math.round(Number(job.progress.pct))))
      : null;

  let statusText = progressPct === null ? `${statusLabel} | ${phaseLabel}` : `${statusLabel} | ${phaseLabel} | ${progressPct}%`;
  if (job.status === 'retry_pending' && job.retryState && job.retryState.nextRetryAt) {
    const nextMs = new Date(job.retryState.nextRetryAt).getTime();
    if (Number.isFinite(nextMs)) {
      const remainingMs = Math.max(0, nextMs - Date.now());
      const seconds = Math.ceil(remainingMs / 1000);
      if (seconds > 0) {
        statusText += ` | próxima tentativa em ${seconds}s`;
      } else {
        statusText += ' | retomando agora';
      }
    }
  }
  jobProgressStatusEl.textContent = statusText;

  const lines = [];
  if (job.attemptsByPhase && typeof job.attemptsByPhase === 'object') {
    const phaseAttempts = Object.entries(job.attemptsByPhase)
      .slice(0, 4)
      .map(([phase, n]) => `${mapJobPhaseLabel(phase)}: ${n} tentativa(s)`);
    if (phaseAttempts.length) lines.push(phaseAttempts.join(' · '));
  }

  lines.push(...buildTechnicalTimelineFromJob(job));

  if (job.lastError) {
    lines.push(`Motivo técnico: ${job.lastError}`);
    if (/rate.?limit|429|quota|retry-after/i.test(String(job.lastError || ''))) {
      lines.push('Observação: limite temporário de API detectado, aguardando janela de retentativa.');
    }
  }

  jobProgressDetailEl.textContent = lines.filter(Boolean).join('\n') || 'Processando...';
}


async function maybeAutoRetryPendingJob(job) {
  if (!job || job.status !== 'retry_pending') return;
  const retryState = job.retryState || {};
  if (retryState.retryable === false) return;

  const nextRetryAtMs = retryState.nextRetryAt ? new Date(retryState.nextRetryAt).getTime() : 0;
  if (Number.isFinite(nextRetryAtMs) && nextRetryAtMs > Date.now()) return;

  if (!state.selectedProjectInfo || state.selectedProjectInfo.rootPath !== job.rootPath) return;

  const lastRun = Number(state.autoRetryLastRunByJob[job.id] || 0);
  if (Date.now() - lastRun < 2500) return;

  if (state.autoRetryInFlightByJob[job.id]) return;

  const request = job.request || {};
  const userMessage = String(request.userMessage || '').trim();
  const attachments = Array.isArray(request.attachments) ? request.attachments : [];
  if (!userMessage) return;

  state.autoRetryInFlightByJob[job.id] = true;
  state.autoRetryLastRunByJob[job.id] = Date.now();
  updateStatus('Retentativa automática da Persona...');
  showPersonaThinkingIndicator();

  try {
    const plan = await window.localcodeApi.buildPlan({
      projectInfo: state.selectedProjectInfo,
      userMessage,
      attachments,
      jobId: job.id,
      contextHint: buildPersonaRequestContextHint({
        personaApprovedExecution: true,
        personaRouteDecision: {
          ok: true,
          decision: 'execute',
          response: '',
          executionMessage: userMessage,
          meta: { planner: 'persona_router', reason: 'retry_existing_job' },
        },
        lastJobContext: buildJobContextForPersona(job),
      }),
      conversationMessages: getRecentConversationMessagesForPersona(),
    });

    if (plan && plan.meta) {
      state.lastAssistantMeta = { ...plan.meta, lastHadAction: Boolean(plan.action) };
    }

    const planReason = String((plan && plan.meta && plan.meta.reason) || '');
    const shouldPublishInterim =
      Boolean(plan && plan.response && plan.action) &&
      !shouldSuppressInterimAssistantPlanMessage(plan) &&
      !/(ai_error|rwkv_error|gemini_error|sambanova_error)/i.test(planReason);

    if (shouldPublishInterim) {
      const signature = `${planReason}|${String(plan.response).trim()}`;
      if (state.lastInterimPlanSignatureByJob[job.id] !== signature) {
        state.lastInterimPlanSignatureByJob[job.id] = signature;
        appendMessage('assistant', plan.response, { persistToConversation: false });
      }
    }

    if (plan && plan.jobId) {
      startJobPolling(plan.jobId);
    }

    if (plan && plan.ok && plan.action) {
      showPending('Posso aplicar essa alteração agora? Nada será alterado sem sua confirmação.', plan.action);
    }
  } catch {
    // silêncio para não poluir chat; o watchdog seguirá tentando.
  } finally {
    hidePersonaThinkingIndicator();
    state.autoRetryInFlightByJob[job.id] = false;
  }
}


async function pollJob(jobId) {
  if (!jobId) return null;
  try {
    const response = await window.localcodeApi.getJob({ jobId });
    if (!response || !response.ok || !response.job) return null;
    renderJobProgress(response.job);
    state.lastJobContext = buildJobContextForPersona(response.job);
    await maybeAutoRetryPendingJob(response.job);

    if (['completed', 'failed', 'cancelled'].includes(response.job.status)) {
      const alreadyNotified = Boolean(state.jobTerminalNoticeById[jobId]);
      if (!alreadyNotified) {
        const terminalMessage = buildTerminalJobMessage(response.job);
        if (terminalMessage) {
          appendMessage('assistant', terminalMessage, { persistToConversation: false });
        }
        state.jobTerminalNoticeById[jobId] = true;
      }

      stopJobPolling();
      const hideDelay = response.job.status === 'failed' ? 8500 : 3500;
      setTimeout(() => {
        if (state.activeJobId === jobId) hideJobProgress();
      }, hideDelay);
    }
    return response.job;
  } catch {
    return null;
  }
}

function startJobPolling(jobId) {
  if (!jobId) return;
  state.activeJobId = jobId;
  stopJobPolling();
  renderJobProgress({
    id: jobId,
    status: 'running',
    phase: 'created',
    events: [],
    attemptsByPhase: {},
  });
  pollJob(jobId);
  state.jobPollingTimer = setInterval(() => {
    pollJob(jobId);
  }, 1200);
}

function renderNextSteps() {
  nextStepsListEl.innerHTML = '';
  const steps = state.nextSteps.length
    ? state.nextSteps
    : [t('selectProjectNextSteps')];

  for (const step of steps) {
    const li = document.createElement('li');
    li.textContent = step;
    nextStepsListEl.appendChild(li);
  }
}

function setUiMode(mode) {
  state.uiMode = mode === 'cortex' ? 'cortex' : 'default';
  const cortexActive = state.uiMode === 'cortex';
  if (cortexModeBtnEl) {
    cortexModeBtnEl.classList.toggle('active', cortexActive);
  }
  if (centerTitleEl) {
    centerTitleEl.textContent = cortexActive ? t('rulesMemory') : t('contextConversation');
  }
  if (rightPanelTitleEl) {
    rightPanelTitleEl.textContent = cortexActive ? t('rulesMemory') : t('files');
  }
  if (cortexLearningBoxEl) {
    cortexLearningBoxEl.classList.toggle('hidden', !cortexActive);
  }
  if (document.body) {
    document.body.classList.toggle('mode-cortex', cortexActive);
  }

  if (inputEl) {
    inputEl.placeholder = cortexActive
      ? t('cortexComposerPlaceholder')
      : t('composerPlaceholder');
  }

  renderIncrementalModeBadge();
  renderWelcomePanel();
}

function renderCortexLearning(learning) {
  if (!cortexLearningContentEl) return;
  if (!learning) {
    cortexLearningContentEl.textContent = t('noMemory');
    renderCortexLightbox(null);
    return;
  }

  const lastIa2 = (Array.isArray(learning.persona) ? learning.persona : learning.ia2 || []).slice(-3);
  const lastIa1 = (Array.isArray(learning.executor) ? learning.executor : learning.ia1 || []).slice(-3);
  const updatedAt = learning.updatedAt
    ? new Date(learning.updatedAt).toLocaleString(state.interfaceLanguage || 'pt-BR')
    : t('noUpdate');

  const lines = [
    `${t('updatedAt')} ${updatedAt}`,
    '',
    t('personaRules'),
    ...(lastIa2.length ? lastIa2.map((x) => `- ${x}`) : [t('noRulesYet')]),
    '',
    t('executorRules'),
    ...(lastIa1.length ? lastIa1.map((x) => `- ${x}`) : [t('noRulesYet')]),
  ];

  cortexLearningContentEl.textContent = lines.join('\n');
  renderCortexLightbox(learning);
}

const DEFAULT_CORTEX_TOPICS = [
  { id: 'geral', labelKey: 'defaultTopicGeral' },
  { id: 'produto', labelKey: 'defaultTopicProduto' },
  { id: 'design', labelKey: 'defaultTopicDesign' },
  { id: 'codigo', labelKey: 'defaultTopicCodigo' },
  { id: 'deploy', labelKey: 'defaultTopicDeploy' },
  { id: 'integracoes', labelKey: 'defaultTopicIntegracoes' },
];

function normalizeCortexTopic(topic) {
  const raw = String(topic || '').trim().toLowerCase();
  if (!raw) return 'geral';
  const safe = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  return safe || 'geral';
}

function createCortexTopicId(label) {
  const base = normalizeCortexTopic(label);
  if (DEFAULT_CORTEX_TOPICS.some((item) => item.id === base)) return `${base}-custom`;
  return base.startsWith('custom-') ? base : `custom-${base}`;
}

function humanizeCortexTopicId(topic) {
  const raw = String(topic || '').replace(/^custom-/, '').replace(/[-_]+/g, ' ').trim();
  return raw ? raw.replace(/\b\w/g, (letter) => letter.toUpperCase()) : t('defaultTopicGeral');
}

function getCortexTopics(learning) {
  const parts = getCortexLearningParts(learning);
  const map = new Map();
  DEFAULT_CORTEX_TOPICS.forEach((item) => {
    map.set(item.id, { id: item.id, label: t(item.labelKey) });
  });

  parts.topics.forEach((topic) => {
    const id = normalizeCortexTopic(topic.id || topic.label);
    const label = String(topic.label || '').trim();
    if (id && label) map.set(id, { id, label });
  });

  parts.events.forEach((event) => {
    const id = normalizeCortexTopic(event && event.topic);
    if (!map.has(id)) map.set(id, { id, label: humanizeCortexTopicId(id) });
  });

  return Array.from(map.values());
}

function getCortexTopicLabel(topic, learning = null) {
  const normalized = normalizeCortexTopic(topic);
  const found = getCortexTopics(learning || state.cortexLearningByProject[state.selectedProjectId] || null)
    .find((item) => item.id === normalized);
  return found ? found.label : humanizeCortexTopicId(normalized);
}

function getCortexLearningParts(learning) {
  const source = learning && typeof learning === 'object' ? learning : {};
  return {
    persona: Array.isArray(source.persona) ? source.persona : Array.isArray(source.ia2) ? source.ia2 : [],
    executor: Array.isArray(source.executor) ? source.executor : Array.isArray(source.ia1) ? source.ia1 : [],
    events: Array.isArray(source.events) ? source.events : [],
    topics: Array.isArray(source.topics) ? source.topics : [],
  };
}

function formatCortexFileSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return t('unknownSize');
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function renderCortexChatMessage(role, text) {
  if (!cortexChatLogEl) return;
  const bubble = document.createElement('div');
  bubble.className = `cortex-chat-bubble ${role === 'user' ? 'user' : 'assistant'}`;
  bubble.textContent = text;
  cortexChatLogEl.appendChild(bubble);
  cortexChatLogEl.scrollTop = cortexChatLogEl.scrollHeight;
}

function resetCortexChatIntro() {
  if (!cortexChatLogEl || cortexChatLogEl.children.length) return;
  renderCortexChatMessage(
    'assistant',
    t('cortexIntro')
  );
}

function renderCortexAttachments() {
  if (!cortexAttachmentListEl) return;
  cortexAttachmentListEl.innerHTML = '';
  if (!state.cortexAttachments.length) {
    cortexAttachmentListEl.classList.add('is-empty');
    cortexAttachmentListEl.textContent = t('noAttachmentUpdate');
    return;
  }

  cortexAttachmentListEl.classList.remove('is-empty');
  state.cortexAttachments.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'cortex-attachment-item';

    const label = document.createElement('span');
    label.textContent = `${file.name || 'documento'} · ${formatCortexFileSize(file.size)}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', t('removeCortexDoc'));
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.cortexAttachments.splice(index, 1);
      renderCortexAttachments();
    });

    item.append(label, remove);
    cortexAttachmentListEl.appendChild(item);
  });
}

function syncCortexTopicSelect(learning) {
  if (!cortexTopicSelectEl) return;
  const topics = getCortexTopics(learning);
  const selected = normalizeCortexTopic(state.cortexSelectedTopic);
  cortexTopicSelectEl.innerHTML = '';
  topics.forEach((topic) => {
    const option = document.createElement('option');
    option.value = topic.id;
    option.textContent = topic.label;
    cortexTopicSelectEl.appendChild(option);
  });
  const nextSelected = topics.some((topic) => topic.id === selected) ? selected : 'geral';
  state.cortexSelectedTopic = nextSelected;
  cortexTopicSelectEl.value = nextSelected;
}

function renderCortexTopics(events, learning) {
  if (!cortexTopicListEl) return;
  cortexTopicListEl.innerHTML = '';
  const topics = getCortexTopics(learning);
  const counts = topics.reduce((acc, item) => {
    acc[item.id] = 0;
    return acc;
  }, {});

  (events || []).forEach((event) => {
    const topic = normalizeCortexTopic(event.topic);
    counts[topic] = (counts[topic] || 0) + 1;
  });

  topics.forEach((topic) => {
    const item = document.createElement('div');
    item.className = `cortex-topic-chip${state.cortexSelectedTopic === topic.id ? ' active' : ''}`;
    const label = document.createElement('span');
    label.textContent = topic.label;
    const count = document.createElement('strong');
    count.textContent = String(counts[topic.id] || 0);
    item.append(label, count);
    cortexTopicListEl.appendChild(item);
  });
}

function renderCortexLibrary(events) {
  if (!cortexLibraryListEl) return;
  cortexLibraryListEl.innerHTML = '';
  const attachments = (events || [])
    .filter((event) => event && event.type === 'cortex.attachment_learned')
    .slice()
    .reverse();

  if (!attachments.length) {
    const empty = document.createElement('div');
    empty.className = 'cortex-empty-state';
    empty.textContent = t('noLibraryDocs');
    cortexLibraryListEl.appendChild(empty);
    return;
  }

  attachments.slice(0, 18).forEach((event) => {
    const item = document.createElement('article');
    item.className = 'cortex-library-item';

    const head = document.createElement('div');
    head.className = 'cortex-library-item__head';

    const title = document.createElement('strong');
    title.textContent = event.fileName || t('document');

    const topic = document.createElement('span');
    topic.textContent = getCortexTopicLabel(event.topic);

    const summary = document.createElement('p');
    summary.textContent = event.summary || t('docRegistered');

    head.append(title, topic);
    item.append(head, summary);
    cortexLibraryListEl.appendChild(item);
  });
}

function renderCortexRules(learning) {
  if (!cortexRulesListEl) return;
  cortexRulesListEl.innerHTML = '';
  const parts = getCortexLearningParts(learning);
  const rules = [
    ...parts.persona.slice(-5).map((text) => ({ scope: 'Persona', text })),
    ...parts.executor.slice(-5).map((text) => ({ scope: 'Executor', text })),
  ].reverse();

  if (!rules.length) {
    const empty = document.createElement('div');
    empty.className = 'cortex-empty-state';
    empty.textContent = t('noActiveRules');
    cortexRulesListEl.appendChild(empty);
    return;
  }

  rules.slice(0, 10).forEach((rule) => {
    const item = document.createElement('article');
    item.className = 'cortex-rule-item';
    const scope = document.createElement('strong');
    scope.textContent = rule.scope;
    const text = document.createElement('p');
    text.textContent = typeof rule.text === 'string' ? rule.text : JSON.stringify(rule.text);
    item.append(scope, text);
    cortexRulesListEl.appendChild(item);
  });
}

function formatKnowledgeChannelStatus(channel, readyText) {
  const source = channel && typeof channel === 'object' ? channel : {};
  if (source.ready) return readyText;
  const reason = source.reason || 'unavailable';
  if (reason === 'repo_not_found') return t('runtimeNotFound');
  if (reason === 'r2r_ingest_endpoint_missing') return t('ingestionPending');
  if (reason === 'search_ready_ingest_missing') return t('searchReadyIngestionPending');
  if (reason === 'r2r_request_error') return t('disconnected');
  if (reason === 'r2r_timeout') return t('noResponse');
  return reason.replace(/_/g, ' ');
}

function renderCortexRuntimeStatus(status) {
  if (!cortexRuntimeStatusEl) return;
  cortexRuntimeStatusEl.innerHTML = '';
  const source = status && typeof status === 'object' ? status : null;
  const rows = [
    {
      label: 'Cortex',
      ok: true,
      text: source && source.cortex
        ? t('cortexCounts')
          .replace('{rules}', String(source.cortex.rulesCount || 0))
          .replace('{documents}', String(source.cortex.documentsCount || 0))
        : t('localMemoryReady'),
    },
    {
      label: 'MemPalace',
      ok: Boolean(source && source.mempalace && source.mempalace.ready),
      text: formatKnowledgeChannelStatus(source && source.mempalace, t('persistenceActive')),
    },
    {
      label: 'RAG',
      ok: Boolean(source && source.rag && source.rag.ready),
      text: formatKnowledgeChannelStatus(source && source.rag, t('semanticSearchActive')),
    },
  ];

  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = `cortex-runtime-status__item${row.ok ? ' ready' : ' pending'}`;
    const label = document.createElement('strong');
    label.textContent = row.label;
    const text = document.createElement('span');
    text.textContent = row.text;
    item.append(label, text);
    cortexRuntimeStatusEl.appendChild(item);
  });
}

function renderCortexLightbox(learning) {
  if (!cortexModalEl) return;
  const parts = getCortexLearningParts(learning);
  syncCortexTopicSelect(learning);
  renderCortexTopics(parts.events, learning);
  renderCortexLibrary(parts.events);
  renderCortexRules(learning);
  renderCortexRuntimeStatus(state.knowledgeRuntimeStatusByProject[state.selectedProjectId] || null);
  renderCortexAttachments();
  resetCortexChatIntro();
}

async function refreshKnowledgeRuntimeStatus() {
  if (!state.selectedProjectId || !state.selectedProjectInfo || !window.localcodeApi?.getKnowledgeRuntimeStatus) {
    renderCortexRuntimeStatus(null);
    return null;
  }
  try {
    const result = await window.localcodeApi.getKnowledgeRuntimeStatus({
      projectId: state.selectedProjectId,
      projectInfo: state.selectedProjectInfo,
    });
    if (result && result.ok) {
      state.knowledgeRuntimeStatusByProject[state.selectedProjectId] = result;
      renderCortexRuntimeStatus(result);
      return result;
    }
  } catch {
    // Status is supportive; the Cortex local memory can still work without it.
  }
  renderCortexRuntimeStatus(state.knowledgeRuntimeStatusByProject[state.selectedProjectId] || null);
  return null;
}

async function openCortexModal() {
  if (!cortexModalEl) return;
  setUiMode('default');
  state.cortexSelectedTopic = normalizeCortexTopic(cortexTopicSelectEl ? cortexTopicSelectEl.value : state.cortexSelectedTopic);
  cortexModalEl.classList.remove('hidden');
  cortexModalEl.setAttribute('aria-hidden', 'false');
  if (cortexModeBtnEl) cortexModeBtnEl.classList.add('active');
  await refreshCortexLearningPanel();
  await refreshKnowledgeRuntimeStatus();
  renderCortexLightbox(state.cortexLearningByProject[state.selectedProjectId] || null);
  setTimeout(() => {
    if (cortexInputEl) cortexInputEl.focus();
  }, 0);
}

function closeCortexModal() {
  if (!cortexModalEl) return;
  cortexModalEl.classList.add('hidden');
  cortexModalEl.setAttribute('aria-hidden', 'true');
  if (cortexModeBtnEl) cortexModeBtnEl.classList.remove('active');
}

function onCortexFileInputChange() {
  if (!cortexFileInputEl) return;
  const files = Array.from(cortexFileInputEl.files || []);
  const allowed = files.filter((file) => /\.(md|markdown|txt|pdf)$/i.test(file.name || ''));
  state.cortexAttachments = [...state.cortexAttachments, ...allowed].slice(-12);
  cortexFileInputEl.value = '';
  renderCortexAttachments();
}

async function onCortexSend() {
  if (!cortexInputEl) return;
  const userMessage = String(cortexInputEl.value || '').trim();
  if (!userMessage && !state.cortexAttachments.length) return;

  if (!state.selectedProjectId) {
    renderCortexChatMessage('assistant', t('selectProjectForCortex'));
    return;
  }

  const selectedProjectReady = await ensureSelectedProjectInfoReady({ forceRefresh: true });
  if (!selectedProjectReady || !state.selectedProjectInfo) {
    renderCortexChatMessage('assistant', t('projectContextError'));
    return;
  }

  const topic = normalizeCortexTopic(cortexTopicSelectEl ? cortexTopicSelectEl.value : state.cortexSelectedTopic);
  state.cortexSelectedTopic = topic;
  const visibleMessage = userMessage || t('attachedDocs');
  renderCortexChatMessage('user', `${getCortexTopicLabel(topic)}: ${visibleMessage}`);

  const attachmentsPayload = state.cortexAttachments.map((file) => ({
    name: file.name,
    type: file.type,
    size: file.size,
    path: file.path || '',
  }));

  const learningResult = await window.localcodeApi.learnWithCortex({
    projectId: state.selectedProjectId,
    projectInfo: state.selectedProjectInfo,
    userMessage,
    attachments: attachmentsPayload,
    topic,
  });

  if (learningResult && learningResult.ok) {
    state.cortexLearningByProject[state.selectedProjectId] = learningResult.learning;
    state.cortexAttachments = [];
    cortexInputEl.value = '';
    if (learningResult.knowledgeStatus) {
      state.knowledgeRuntimeStatusByProject[state.selectedProjectId] = learningResult.knowledgeStatus;
    }
    renderCortexChatMessage('assistant', learningResult.message || t('cortexSaved'));
    renderCortexLearning(learningResult.learning);
    renderCortexRuntimeStatus(state.knowledgeRuntimeStatusByProject[state.selectedProjectId] || null);
    updateStatus(t('memoryUpdated'));
    return;
  }

  renderCortexChatMessage('assistant', (learningResult && learningResult.message) || t('cortexSaveFailed'));
}

async function persistCortexTopic(action, payload) {
  if (!state.selectedProjectId) {
    renderCortexChatMessage('assistant', t('topicNeedsProject'));
    return null;
  }
  const apiMethod = action === 'rename' ? window.localcodeApi?.renameCortexTopic : window.localcodeApi?.upsertCortexTopic;
  if (typeof apiMethod !== 'function') {
    renderCortexChatMessage('assistant', t('topicSaveFailed'));
    return null;
  }

  try {
    const result = await apiMethod({
      projectId: state.selectedProjectId,
      ...payload,
    });
    if (result && result.ok) {
      state.cortexLearningByProject[state.selectedProjectId] = result.learning;
      renderCortexLearning(result.learning);
      return result;
    }
  } catch {
    // Fall through to a clear UI message.
  }

  renderCortexChatMessage('assistant', t('topicSaveFailed'));
  return null;
}

async function onCortexTopicAdd() {
  const label = String(window.prompt(t('topicNewPrompt')) || '').trim();
  if (!label) return;
  const id = createCortexTopicId(label);
  state.cortexSelectedTopic = id;
  const result = await persistCortexTopic('upsert', {
    topic: { id, label },
  });
  if (result && cortexTopicSelectEl) {
    cortexTopicSelectEl.value = id;
    renderCortexChatMessage('assistant', t('topicSaved'));
  }
}

async function onCortexTopicRename() {
  const learning = state.cortexLearningByProject[state.selectedProjectId] || null;
  const topicId = normalizeCortexTopic(cortexTopicSelectEl ? cortexTopicSelectEl.value : state.cortexSelectedTopic);
  const currentLabel = getCortexTopicLabel(topicId, learning);
  const nextLabel = String(window.prompt(t('topicRenamePrompt'), currentLabel) || '').trim();
  if (!nextLabel || nextLabel === currentLabel) return;
  state.cortexSelectedTopic = topicId;
  const result = await persistCortexTopic('rename', {
    topicId,
    label: nextLabel,
  });
  if (result) {
    renderCortexChatMessage('assistant', t('topicRenamed'));
  }
}

async function refreshCortexLearningPanel() {
  const projectId = state.selectedProjectId;
  if (!projectId) {
    renderCortexLearning(null);
    return;
  }

  try {
    const result = await window.localcodeApi.getCortexLearning({ projectId });
    if (result && result.ok) {
      state.cortexLearningByProject[projectId] = result.learning;
      renderCortexLearning(result.learning);
      return;
    }
  } catch {
    // fallback
  }

  renderCortexLearning(state.cortexLearningByProject[projectId] || null);
}

function summarizeProject(info) {
  if (!info) return 'Nenhum projeto selecionado.';

  const c = info.counters;
  return [
    `Pasta: ${info.rootPath}`,
    `Stacks detectadas: ${info.stacks.join(', ')}`,
    `Arquivos lidos: ${info.totalFiles} (limite de análise: ${info.scannedLimit})`,
    `Tipos: TS=${c.ts}, TSX=${c.tsx}, JS=${c.js}, JSX=${c.jsx}, PHP=${c.php}, CSS/SCSS=${c.css}, MD=${c.md}, Outros=${c.other}`,
    '',
    'A IA já recebe esse inventário para decidir melhor o arquivo-alvo.',
  ].join('\n');
}


function normalizeProjectItems(rawProjects) {
  const arr = Array.isArray(rawProjects)
    ? rawProjects
    : rawProjects && Array.isArray(rawProjects.projects)
      ? rawProjects.projects
      : [];

  return arr.map((project, index) => {
    const safe = project && typeof project === 'object' ? project : {};
    const safeName = (safe.name && String(safe.name).trim()) || 'Projeto';
    const safeRoot = safe.rootPath ? String(safe.rootPath) : '';
    const safeId = safe.id || `legacy-${index}-${safeRoot || safeName}`;
    return {
      ...safe,
      id: safeId,
      name: safeName,
      rootPath: safeRoot,
    };
  });
}

function clearSelectionState() {
  stopJobPolling();
  hideJobProgress();
  state.selectedProjectId = null;
  state.selectedProjectInfo = null;
  state.nextSteps = [];
  state.lastAssistantMeta = null;
  state.pendingAction = null;
  state.projectFileRows = [];
  state.projectFileDiffStats = {};
  renderNextSteps();
  renderProjectFilesTree();
  clearPending();
  chatLogEl.innerHTML = '';
  updateStatus('Aguardando projeto');
  renderWelcomePanel();
}

function reconcileSelectionAfterProjectListUpdate() {
  if (!state.selectedProjectId) return;
  const exists = state.projects.some((project) => project.id === state.selectedProjectId);
  if (!exists) {
    clearSelectionState();
  }
}

function hideProjectContextMenu() {
  if (!projectContextMenuEl) return;
  projectContextMenuEl.classList.add('hidden');
  projectContextMenuEl.setAttribute('aria-hidden', 'true');
  projectContextMenuEl.style.left = '-9999px';
  projectContextMenuEl.style.top = '-9999px';
  state.projectContextMenuProjectId = null;
}

function showProjectContextMenu(projectId, x, y) {
  if (!projectContextMenuEl || !projectId) return;
  state.projectContextMenuProjectId = projectId;
  projectContextMenuEl.classList.remove('hidden');
  projectContextMenuEl.setAttribute('aria-hidden', 'false');
  const menuWidth = Math.max(150, projectContextMenuEl.offsetWidth || 150);
  const menuHeight = Math.max(120, projectContextMenuEl.offsetHeight || 120);
  const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
  const maxTop = Math.max(8, window.innerHeight - menuHeight - 8);
  const safeLeft = Math.min(maxLeft, Math.max(8, Number(x) || 8));
  const safeTop = Math.min(maxTop, Math.max(8, Number(y) || 8));
  projectContextMenuEl.style.left = `${safeLeft}px`;
  projectContextMenuEl.style.top = `${safeTop}px`;
}

function closeInlineInputDialog(dialog) {
  if (!dialog || !dialog.parentNode) return;
  dialog.parentNode.removeChild(dialog);
}

function requestTextInputDialog({ title = 'Editar', initialValue = '', placeholder = '' } = {}) {
  if (typeof document === 'undefined' || !document.body) {
    const fallback = window.prompt(title, initialValue);
    if (fallback !== null) return Promise.resolve(fallback);
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'inline-input-dialog';
    modal.setAttribute('role', 'presentation');

    const backdrop = document.createElement('div');
    backdrop.className = 'inline-input-dialog__backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'inline-input-dialog__panel';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);

    const titleEl = document.createElement('strong');
    titleEl.className = 'inline-input-dialog__title';
    titleEl.textContent = title;

    const input = document.createElement('input');
    input.className = 'inline-input-dialog__input';
    input.type = 'text';
    input.value = String(initialValue || '');
    input.placeholder = placeholder;
    input.autocomplete = 'off';

    const actions = document.createElement('div');
    actions.className = 'inline-input-dialog__actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-muted';
    cancelBtn.textContent = 'Cancelar';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-success';
    saveBtn.textContent = 'Salvar';

    actions.append(cancelBtn, saveBtn);
    dialog.append(titleEl, input, actions);
    modal.append(backdrop, dialog);
    document.body.appendChild(modal);

    const cleanup = (value) => {
      document.removeEventListener('keydown', onDocumentKeyDown);
      closeInlineInputDialog(modal);
      resolve(value);
    };

    const save = () => cleanup(input.value);

    function onDocumentKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(null);
      }
    }

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      }
    });
    backdrop.addEventListener('click', () => cleanup(null));
    cancelBtn.addEventListener('click', () => cleanup(null));
    saveBtn.addEventListener('click', save);
    document.addEventListener('keydown', onDocumentKeyDown);

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

async function requestProjectRename(projectId, currentName = 'Projeto') {
  const nextNameRaw = await requestTextInputDialog({
    title: 'Novo nome do projeto:',
    initialValue: currentName,
    placeholder: 'Nome do projeto',
  });
  if (!nextNameRaw || !nextNameRaw.trim()) return null;
  return nextNameRaw.trim();
}

async function requestConversationRename(projectId, conversation) {
  if (!projectId || !conversation) return;
  const currentTitle = String(conversation.title || 'Conversa').trim();
  const nextTitle = await requestTextInputDialog({
    title: 'Renomear conversa:',
    initialValue: currentTitle,
    placeholder: 'Título da conversa',
  });
  if (!nextTitle || !nextTitle.trim()) return;

  const normalized = nextTitle.trim();
  if (normalized === currentTitle) return;

  if (!window.localcodeApi.renameConversation) {
    conversation.title = normalized;
    renderProjects();
    return;
  }

  const result = await window.localcodeApi.renameConversation({
    projectId,
    conversationId: conversation.id,
    title: normalized,
  });

  if (!result || !result.ok) {
    appendMessage('assistant', (result && result.message) || 'Falha ao renomear conversa.', { persistToConversation: false });
    return;
  }

  state.projectConversations[projectId] = Array.isArray(result.conversations)
    ? result.conversations
    : state.projectConversations[projectId] || [];
  renderProjects();
}

async function prepareNewConversationForProject(projectId) {
  if (!projectId) return;

  if (state.selectedProjectId !== projectId) {
    await selectProject(projectId);
  }

  state.wantsNewConversationOnNextMessage = true;
  state.lastAssistantMeta = null;
  clearPending();
  hideJobProgress();
  chatLogEl.innerHTML = '';
  renderMessageBubble(
    'assistant',
    'Nova conversa preparada. Envie sua próxima mensagem para criar um chat separado neste projeto.'
  );
  renderWelcomePanel();
}

function formatProjectStateDate(project) {
  const raw = project && (project.archivedAt || project.deletedAt || project.createdAt);
  if (!raw) return 'sem data';
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return 'sem data';
  return dt.toLocaleString('pt-BR');
}

function closeProjectStateModal() {
  if (!projectStateModalEl) return;
  projectStateModalEl.classList.add('hidden');
  projectStateModalEl.setAttribute('aria-hidden', 'true');
  state.projectStateModalMode = null;
  if (projectStateModalListEl) projectStateModalListEl.innerHTML = '';
  if (projectStateModalFooterEl) projectStateModalFooterEl.innerHTML = '';
}

async function renderProjectStateModal(mode, items) {
  if (!projectStateModalListEl || !projectStateModalFooterEl) return;
  const rows = Array.isArray(items) ? items : [];
  projectStateModalListEl.innerHTML = '';
  projectStateModalFooterEl.innerHTML = '';

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'project-state-empty';
    empty.textContent = mode === 'archived'
      ? 'Nenhum projeto arquivado.'
      : 'A lixeira está vazia.';
    projectStateModalListEl.appendChild(empty);
  } else {
    rows.forEach((project) => {
      const row = document.createElement('div');
      row.className = 'project-state-row';

      const info = document.createElement('div');
      info.className = 'project-state-info';
      const title = document.createElement('strong');
      title.textContent = String(project.name || 'Projeto');
      const meta = document.createElement('span');
      const stateLabel = mode === 'archived' ? 'Arquivado em' : 'Excluído em';
      meta.textContent = `${stateLabel}: ${formatProjectStateDate(project)} • ${String(project.rootPath || '')}`;
      info.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'project-state-actions';

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'project-state-restore';
      restoreBtn.textContent = 'Restaurar';
      restoreBtn.addEventListener('click', async () => {
        const result = await window.localcodeApi.restoreProject({ id: project.id });
        if (!result || !result.ok) {
          appendMessage('assistant', (result && result.message) || 'Falha ao restaurar projeto.', { persistToConversation: false });
          return;
        }
        await loadProjects();
        const refreshed = await window.localcodeApi.listProjectsByState(mode);
        await renderProjectStateModal(mode, refreshed && refreshed.ok ? refreshed.projects : []);
      });
      actions.appendChild(restoreBtn);

      if (mode === 'archived') {
        const trashBtn = document.createElement('button');
        trashBtn.type = 'button';
        trashBtn.className = 'project-state-clear';
        trashBtn.textContent = 'Mover para lixeira';
        trashBtn.addEventListener('click', async () => {
          const result = await window.localcodeApi.trashProject({ id: project.id });
          if (!result || !result.ok) {
            appendMessage('assistant', (result && result.message) || 'Falha ao mover projeto para a lixeira.', { persistToConversation: false });
            return;
          }
          await loadProjects();
          const refreshed = await window.localcodeApi.listProjectsByState(mode);
          await renderProjectStateModal(mode, refreshed && refreshed.ok ? refreshed.projects : []);
        });
        actions.appendChild(trashBtn);
      }

      if (mode === 'deleted') {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'project-state-clear';
        deleteBtn.textContent = 'Excluir definitivo';
        deleteBtn.addEventListener('click', async () => {
          if (!confirm('Excluir definitivamente este projeto da lista?')) return;
          const result = await window.localcodeApi.removeProject(project.id);
          if (!result || !result.ok) {
            appendMessage('assistant', (result && result.message) || 'Falha ao excluir projeto.', { persistToConversation: false });
            return;
          }
          await loadProjects();
          const refreshed = await window.localcodeApi.listProjectsByState(mode);
          await renderProjectStateModal(mode, refreshed && refreshed.ok ? refreshed.projects : []);
        });
        actions.appendChild(deleteBtn);
      }

      row.append(info, actions);
      projectStateModalListEl.appendChild(row);
    });
  }

  if (mode === 'deleted') {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'project-state-clear';
    clearBtn.textContent = 'Esvaziar lixeira';
    clearBtn.disabled = rows.length === 0;
    clearBtn.addEventListener('click', async () => {
      if (!rows.length) return;
      if (!confirm('Esvaziar toda a lixeira? Essa ação não pode ser desfeita.')) return;
      const result = await window.localcodeApi.clearTrashProjects();
      if (!result || !result.ok) {
        appendMessage('assistant', (result && result.message) || 'Falha ao esvaziar lixeira.', { persistToConversation: false });
        return;
      }
      await loadProjects();
      await renderProjectStateModal(mode, []);
    });
    projectStateModalFooterEl.appendChild(clearBtn);
  }
}

async function openProjectStateModal(mode) {
  if (!projectStateModalEl) return;
  const normalizedMode = mode === 'deleted' ? 'deleted' : 'archived';
  state.projectStateModalMode = normalizedMode;
  if (projectStateModalTitleEl) {
    projectStateModalTitleEl.textContent = normalizedMode === 'archived' ? 'Projetos arquivados' : 'Lixeira de projetos';
  }

  const result = await window.localcodeApi.listProjectsByState(normalizedMode);
  const rows = result && result.ok ? result.projects : [];
  await renderProjectStateModal(normalizedMode, rows);

  projectStateModalEl.classList.remove('hidden');
  projectStateModalEl.setAttribute('aria-hidden', 'false');
}

async function runProjectContextAction(action, projectId) {
  if (!action || !projectId) return;

  if (action === 'rename') {
    const target = state.projects.find((project) => project.id === projectId);
    const currentName = target ? String(target.name || 'Projeto') : 'Projeto';
    const nextName = await requestProjectRename(projectId, currentName);
    if (!nextName) return;
    const result = await window.localcodeApi.renameProject({ id: projectId, name: nextName });
    if (!result || !result.ok) {
      appendMessage('assistant', (result && result.message) || 'Falha ao renomear projeto.', { persistToConversation: false });
      return;
    }
    state.projects = normalizeProjectItems(result.projects);
    renderProjects();
    if (state.selectedProjectId === projectId && state.selectedProjectInfo) {
      updateStatus(`Projeto ativo: ${nextName}`);
    }
    return;
  }

  if (action === 'archive') {
    const result = await window.localcodeApi.archiveProject({ id: projectId });
    if (!result || !result.ok) {
      appendMessage('assistant', (result && result.message) || 'Falha ao arquivar projeto.', { persistToConversation: false });
      return;
    }
    state.projects = normalizeProjectItems(result.projects);
    reconcileSelectionAfterProjectListUpdate();
    renderProjects();
    appendMessage('assistant', 'Projeto arquivado com sucesso.', { persistToConversation: false });
    return;
  }

  if (action === 'trash') {
    const result = await window.localcodeApi.trashProject({ id: projectId });
    if (!result || !result.ok) {
      appendMessage('assistant', (result && result.message) || 'Falha ao mover projeto para a lixeira.', { persistToConversation: false });
      return;
    }
    state.projects = normalizeProjectItems(result.projects);
    reconcileSelectionAfterProjectListUpdate();
    renderProjects();
    appendMessage('assistant', 'Projeto movido para a lixeira.', { persistToConversation: false });
  }
}

function ensureProjectConversationBucket(projectId) {
  if (!projectId) return;
  if (!state.projectConversations[projectId]) {
    state.projectConversations[projectId] = [];
  }
}

function ensureConversationStateForProject(projectId) {
  ensureProjectConversationBucket(projectId);
  if (!(projectId in state.activeConversationByProject)) {
    const firstConversation = state.projectConversations[projectId][0];
    state.activeConversationByProject[projectId] = firstConversation ? firstConversation.id : null;
  }
}

async function addConversationForProject(projectId, text) {
  if (!projectId || !text) return null;

  const title = text.trim().replace(/\s+/g, ' ').slice(0, 52) || 'Conversa sem título';

  try {
    const result = await window.localcodeApi.addConversation({
      projectId,
      title,
      meta: { source: 'user_prompt' },
    });
    if (!result || !result.ok) return null;

    state.projectConversations[projectId] = Array.isArray(result.conversations) ? result.conversations : [];
    return result.conversation || null;
  } catch {
    // Em caso de falha de persistência, mantemos o fluxo principal de chat sem bloquear o usuário.
    return null;
  }
}

function toggleProjectExpanded(projectId) {
  state.expandedProjects[projectId] = !state.expandedProjects[projectId];
  renderProjects();
}

function hasExpandedProject() {
  return Object.values(state.expandedProjects || {}).some(Boolean);
}

function collapseExpandedProjects() {
  if (!hasExpandedProject()) return false;
  Object.keys(state.expandedProjects || {}).forEach((projectId) => {
    state.expandedProjects[projectId] = false;
  });
  renderProjects();
  return true;
}

function handleOutsideProjectClick(event) {
  if (!hasExpandedProject()) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('.project-item')) return;
  if (projectContextMenuEl && projectContextMenuEl.contains(target)) return;
  collapseExpandedProjects();
}

function renderProjects() {
  if (!projectsListEl) return;
  projectsListEl.innerHTML = '';

  const query = String(state.projectSearchQuery || '').trim().toLowerCase();
  const source = Array.isArray(state.projects) ? state.projects : [];
  const visibleProjects = query
    ? source.filter((project) => String((project && project.name) || '').toLowerCase().includes(query))
    : source;

  if (!visibleProjects.length) {
    const empty = document.createElement('p');
    empty.className = 'subtext';
    empty.textContent = source.length
      ? 'Nenhum projeto encontrado para essa pesquisa.'
      : 'Nenhum projeto ainda.';
    projectsListEl.appendChild(empty);
    return;
  }

  visibleProjects.forEach((project, index) => {
    const safe = project && typeof project === 'object' ? project : {};
    const id = safe.id || ('fallback-' + index);
    const name = (safe.name && String(safe.name).trim()) || 'Projeto';

    const wrapper = document.createElement('div');
    wrapper.className = 'project-item tree-item' + (state.selectedProjectId === id ? ' active' : '');
    wrapper.dataset.projectId = id;

    wrapper.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      showProjectContextMenu(id, event.clientX, event.clientY);
    });

    const headerBtn = document.createElement('button');
    headerBtn.className = 'project-tree-header';
    headerBtn.type = 'button';
    headerBtn.addEventListener('click', async () => {
      state.expandedProjects[id] = !state.expandedProjects[id];
      renderProjects();

      const shouldResyncProject =
        state.selectedProjectId !== id ||
        !state.selectedProjectInfo ||
        !state.selectedProjectInfo.rootPath ||
        !Array.isArray(state.projectFileRows) ||
        state.projectFileRows.length === 0;

      if (shouldResyncProject) {
        await selectProject(id);
        return;
      }

      await refreshProjectFilesTree();
    });

    const folder = document.createElement('span');
    folder.className = 'folder-icon';
    folder.setAttribute('aria-hidden', 'true');
    const isExpanded = Boolean(state.expandedProjects[id]);
    folder.innerHTML = isExpanded
      ? '<svg viewBox="0 0 24 24" class="folder-icon-svg folder-open" focusable="false" aria-hidden="true"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h3.2c.5 0 1 .2 1.4.5l1 1c.4.3.8.5 1.3.5H20a1.8 1.8 0 0 1 1.7 2.4l-1.8 5.7A2.5 2.5 0 0 1 17.5 18h-12A2.5 2.5 0 0 1 3 15.5v-7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 24 24" class="folder-icon-svg folder-closed" focusable="false" aria-hidden="true"><path d="M3.75 7.5a2.25 2.25 0 0 1 2.25-2.25h3.2c.42 0 .82.17 1.12.47l1.14 1.14c.3.3.7.47 1.12.47H18a2.25 2.25 0 0 1 2.25 2.25v7.17A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const nameEl = document.createElement('span');
    nameEl.className = 'project-name';
    nameEl.textContent = name;
    nameEl.addEventListener('dblclick', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nextName = await requestProjectRename(id, name);
      if (!nextName) return;
      const result = await window.localcodeApi.renameProject({ id, name: nextName });
      if (!result || !result.ok) {
        appendMessage('assistant', (result && result.message) || 'Falha ao renomear projeto.', { persistToConversation: false });
        return;
      }
      state.projects = normalizeProjectItems(result.projects);
      renderProjects();
      if (state.selectedProjectId === id && state.selectedProjectInfo) {
        updateStatus(`Projeto ativo: ${nextName}`);
      }
    });

    const actions = document.createElement('span');
    actions.className = 'project-tree-actions';

    const newConvBtn = document.createElement('button');
    newConvBtn.type = 'button';
    newConvBtn.className = 'project-mini-btn project-mini-btn-new-conv';
    newConvBtn.title = 'Nova conversa neste projeto';
    newConvBtn.setAttribute('aria-label', 'Nova conversa neste projeto');
    newConvBtn.textContent = '+';
    newConvBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await prepareNewConversationForProject(id);
      renderProjects();
    });

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'project-mini-btn project-mini-btn-menu';
    menuBtn.title = 'Opções do projeto';
    menuBtn.setAttribute('aria-label', 'Opções do projeto');
    menuBtn.textContent = '⋯';
    menuBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showProjectContextMenu(id, event.clientX, event.clientY);
    });

    actions.append(newConvBtn, menuBtn);
    headerBtn.append(folder, nameEl, actions);
    wrapper.appendChild(headerBtn);

    if (state.expandedProjects[id]) {
      ensureConversationStateForProject(id);
      const convList = document.createElement('div');
      convList.className = 'conversation-tree';

      const conversations = Array.isArray(state.projectConversations[id]) ? state.projectConversations[id] : [];
      if (!conversations.length) {
        const emptyConv = document.createElement('div');
        emptyConv.className = 'conversation-item conversation-empty';
        emptyConv.textContent = 'Sem conversas ainda';
        convList.appendChild(emptyConv);
      } else {
        conversations.slice(0, 12).forEach((conv) => {
          const convRow = document.createElement('div');
          convRow.className = 'conversation-row';

          const convItem = document.createElement('button');
          convItem.type = 'button';
          const isActiveConversation = getActiveConversationId(id) === conv.id;
          convItem.className = 'conversation-item' + (isActiveConversation ? ' active' : '');
          convItem.textContent = conv.title || 'Conversa';

          convItem.addEventListener('dblclick', async (event) => {
            event.stopPropagation();
            await requestConversationRename(id, conv);
          });

          convItem.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (state.selectedProjectId !== id) await selectProject(id);
            setActiveConversation(id, conv.id);
            await loadConversationMessages(conv.id);
            state.lastAssistantMeta = null;
            clearPending();
            renderProjects();
            renderChatForActiveConversation();
          });

          const renameBtn = document.createElement('button');
          renameBtn.type = 'button';
          renameBtn.className = 'conversation-rename-btn';
          renameBtn.title = 'Renomear conversa';
          renameBtn.setAttribute('aria-label', 'Renomear conversa');
          renameBtn.textContent = '✎';
          renameBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await requestConversationRename(id, conv);
          });

          convRow.append(convItem, renameBtn);
          convList.appendChild(convRow);
        });
      }

      wrapper.appendChild(convList);
    }

    projectsListEl.appendChild(wrapper);
  });
}

async function loadProjects() {
  try {
    const rawProjects = await window.localcodeApi.listProjects();
    console.info('[loadProjects] rawProjects =', rawProjects);
    state.projects = normalizeProjectItems(rawProjects);
  } catch (error) {
    console.error('Falha ao carregar projetos:', error);
    state.projects = [];
  }

  try {
    const persistedConversations = await window.localcodeApi.listConversations();
    if (persistedConversations && persistedConversations.ok) {
      state.projectConversations =
        persistedConversations.conversationsByProject &&
        typeof persistedConversations.conversationsByProject === 'object'
          ? persistedConversations.conversationsByProject
          : {};
    } else {
      state.projectConversations = {};
    }
  } catch (error) {
    console.error('Falha ao carregar conversas:', error);
    state.projectConversations = {};
  }

  console.info('[loadProjects] state.projects =', state.projects);
  state.projects.forEach((project) => ensureConversationStateForProject(project.id));
  reconcileSelectionAfterProjectListUpdate();
  renderProjects();
  renderWelcomePanel();
}

function getFileTreeIconSvg(kind) {
  if (kind === 'dir') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.3c.5 0 1 .2 1.3.6l1 1.1c.3.3.7.5 1.1.5H18.5A2.5 2.5 0 0 1 21 9.7v6.8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (kind === 'image') return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><path d="m6 17 4.2-4.2a1 1 0 0 1 1.4 0L14 15l1.8-1.8a1 1 0 0 1 1.4 0L19 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (kind === 'code') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 8-4 4 4 4M15 8l4 4-4 4M13 6l-2 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3Zm8 0v4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function renderIncrementalModeBadge() {
  if (!incrementalModeBadgeEl) return;
  const cortexActive = state.uiMode === 'cortex';
  if (cortexActive || !state.selectedProjectInfo || !state.selectedProjectInfo.rootPath) {
    incrementalModeBadgeEl.classList.add('hidden');
    incrementalModeBadgeEl.classList.remove('is-edit', 'is-init');
    incrementalModeBadgeEl.textContent = '';
    return;
  }

  const hasFiles = Number(state.selectedProjectInfo.totalFiles || 0) > 0;
  incrementalModeBadgeEl.classList.remove('hidden', 'is-edit', 'is-init');
  incrementalModeBadgeEl.classList.add(hasFiles ? 'is-edit' : 'is-init');
  incrementalModeBadgeEl.textContent = hasFiles ? 'Edição incremental ativa' : 'Modo criação inicial';
}

function renderProjectFilesTree() {
  if (!projectFilesTreeEl) return;
  renderIncrementalModeBadge();
  projectFilesTreeEl.innerHTML = '';

  if (!state.selectedProjectInfo || !state.selectedProjectInfo.rootPath) {
    const empty = document.createElement('div');
    empty.className = 'project-files-empty';
    empty.textContent = 'Selecione um projeto para ver os arquivos.';
    projectFilesTreeEl.appendChild(empty);
    return;
  }

  const rows = Array.isArray(state.projectFileRows) ? state.projectFileRows : [];
  const diffStats = state.projectFileDiffStats && typeof state.projectFileDiffStats === 'object'
    ? state.projectFileDiffStats
    : {};

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'project-files-empty';
    empty.textContent = 'Nenhum arquivo carregado.';
    projectFilesTreeEl.appendChild(empty);
    return;
  }

  rows.slice(0, 800).forEach((row) => {
    const isDir = row.type === 'dir' || row.kind === 'dir' || row.isDir === true;
    const name = row.name || row.path || '(arquivo)';
    const lower = String(name).toLowerCase();
    const isImage = !isDir && /\.(png|jpe?g|gif|webp|svg)$/.test(lower);
    const isCode = !isDir && /\.(js|jsx|ts|tsx|css|scss|html|htm|json|md|txt)$/.test(lower);
    const kind = isDir ? 'dir' : isImage ? 'image' : isCode ? 'code' : 'file';

    const line = document.createElement('div');
    line.className = 'project-tree-row' + (isDir ? ' dir' : ' file');
    line.style.paddingLeft = String(8 + (Number(row.depth || 0) * 14)) + 'px';
    line.dataset.path = row.path || '';
    line.dataset.dir = isDir ? '1' : '0';

    const icon = document.createElement('span');
    icon.className = 'project-tree-icon';
    icon.innerHTML = getFileTreeIconSvg(kind);

    const label = document.createElement('span');
    label.className = 'project-tree-label';
    label.textContent = name;

    line.append(icon, label);

    if (!isDir) {
      const relPath = String(row.path || '').split('\\').join('/');
      const stat = diffStats[relPath];
      if (stat && (Number(stat.add || 0) > 0 || Number(stat.del || 0) > 0)) {
        const diff = document.createElement('span');
        diff.className = 'project-tree-diff';

        if (Number(stat.add || 0) > 0) {
          const add = document.createElement('span');
          add.className = 'project-tree-diff-add';
          add.textContent = `+${Number(stat.add)}`;
          diff.appendChild(add);
        }

        if (Number(stat.del || 0) > 0) {
          const del = document.createElement('span');
          del.className = 'project-tree-diff-del';
          del.textContent = `-${Number(stat.del)}`;
          diff.appendChild(del);
        }

        line.appendChild(diff);
      }
    }

    projectFilesTreeEl.appendChild(line);
  });
}


async function ensureSelectedProjectInfoReady(options = {}) {
  const forceRefresh = Boolean(options && options.forceRefresh);
  if (state.selectedProjectInfo && state.selectedProjectInfo.rootPath && !forceRefresh) return true;
  if (!state.selectedProjectId) return false;

  const project = Array.isArray(state.projects)
    ? state.projects.find((item) => item && item.id === state.selectedProjectId)
    : null;
  const rootPath = state.selectedProjectInfo && state.selectedProjectInfo.rootPath
    ? state.selectedProjectInfo.rootPath
    : (project && project.rootPath ? project.rootPath : '');
  if (!rootPath) return false;

  try {
    const scan = await window.localcodeApi.scanProject(rootPath);
    if (!scan || !scan.ok || !scan.info) return false;
    state.selectedProjectInfo = scan.info;
    state.nextSteps = scan.nextSteps || state.nextSteps;
    renderNextSteps();
    renderIncrementalModeBadge();
    return true;
  } catch {
    return Boolean(state.selectedProjectInfo && state.selectedProjectInfo.rootPath && !forceRefresh);
  }
}

async function refreshProjectFilesTree() {
  if (!projectFilesTreeEl) return;

  const ready = await ensureSelectedProjectInfoReady();
  if (!ready || !state.selectedProjectInfo || !state.selectedProjectInfo.rootPath) {
    state.projectFileRows = [];
    state.projectFileDiffStats = {};
    renderProjectFilesTree();
    return;
  }

  if (!window.localcodeApi || typeof window.localcodeApi.getProjectFilesTree !== 'function') {
    state.projectFileRows = [];
    state.projectFileDiffStats = {};
    renderProjectFilesTree();
    return;
  }

  try {
    const result = await window.localcodeApi.getProjectFilesTree({ rootPath: state.selectedProjectInfo.rootPath });
    state.projectFileRows = result && result.ok && Array.isArray(result.rows) ? result.rows : [];
    state.projectFileDiffStats = result && result.ok && result.diffStats && typeof result.diffStats === 'object'
      ? result.diffStats
      : {};
  } catch {
    state.projectFileRows = [];
    state.projectFileDiffStats = {};
  }

  renderProjectFilesTree();
}

async function selectProject(projectId) {
  stopJobPolling();
  hideJobProgress();
  state.selectedProjectId = projectId;
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return;

  updateStatus('Analisando projeto...');

  const scan = await window.localcodeApi.scanProject(project.rootPath);
  if (!scan.ok) {
    appendMessage('assistant', scan.message || 'Não consegui analisar essa pasta.');
    updateStatus('Erro na análise');
    return;
  }

  state.selectedProjectInfo = scan.info;
  state.nextSteps = scan.nextSteps || [];
  state.expandedProjects[project.id] = true;
  ensureConversationStateForProject(project.id);
  renderProjects();
  renderNextSteps();
  await refreshProjectFilesTree();

  try {
    state.mempalaceStatus = await window.localcodeApi.getMempalaceStatus(state.selectedProjectInfo);
  } catch {
    state.mempalaceStatus = null;
  }

  updateStatus(`Projeto ativo: ${project.name}`);
  const activeConversationId = getActiveConversationId(project.id);
  if (activeConversationId) {
    await loadConversationMessages(activeConversationId);
  }
  await refreshCortexLearningPanel();
  renderChatForActiveConversation();
}

function clearPending() {
  state.pendingAction = null;
  pendingActionEl.classList.add('hidden');
  pendingTextEl.textContent = '';
  renderWelcomePanel();
}

function showPending(text, action) {
  state.pendingAction = action;
  pendingTextEl.textContent = text;
  pendingActionEl.classList.remove('hidden');
  renderWelcomePanel();
}

function formatDiffPreviewForChat(action) {
  if (!action || !action.diffPreview) return '';
  const lines = action.diffPreview.split('\n');
  const maxLines = 40;
  const visible = lines.slice(0, maxLines);
  const hasTruncation = lines.length > maxLines;
  return [
    'Pré-visualização do patch proposto:',
    visible.join('\n'),
    hasTruncation ? '... (prévia truncada)' : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function showModificationAlert(message) {
  modificationAlertEl.textContent = message;
  modificationAlertEl.classList.remove('hidden');
  setTimeout(() => {
    modificationAlertEl.classList.add('hidden');
  }, 9000);
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

async function applyComposerProviderBeforeSend() {
  if (!composerProviderEl || !window.localcodeApi || !window.localcodeApi.setAiProvider) return;
  const chosen = normalizeKnownProvider(composerProviderEl.value || state.selectedAiProvider || 'rwkv');
  if (!chosen || chosen === state.selectedAiProvider) return;
  try {
    const saved = await window.localcodeApi.setAiProvider(chosen);
    if (saved && saved.ok) {
      state.selectedAiProvider = String(saved.provider || chosen);
      updateStatus('Provedor selecionado: ' + providerStatusLabel(state.selectedAiProvider));
    }
  } catch {
    // segue com provedor atual
  }
}

async function onSend() {
  await applyComposerProviderBeforeSend();
  const userMessage = inputEl.value.trim();
  if (!userMessage && !state.attachments.length) return;

  const attachmentSummary = state.attachments.map((file) => file.name);
  const visibleUserMessage = userMessage || '[Somente anexos]';
  const composedUserMessage = attachmentSummary.length
    ? `${visibleUserMessage}\n\nAnexos: ${attachmentSummary.join(', ')}`
    : visibleUserMessage;
  const attachmentsPayload = state.attachments.map((file) => ({
    name: file.name,
    type: file.type,
    size: file.size,
    path: file.path || '',
  }));

  const retryTechnicalMessage =
    isManualRetryMessage(visibleUserMessage) &&
    state.lastJobContext &&
    state.lastJobContext.lastError &&
    state.lastJobContext.lastUserMessage
      ? String(state.lastJobContext.lastUserMessage).trim()
      : '';
  const effectivePersonaMessage = retryTechnicalMessage || visibleUserMessage;
  const personaContextExtra = retryTechnicalMessage
    ? {
        manualRetryRequest: visibleUserMessage,
        retryingLastFailedJob: true,
        retryTechnicalUserMessage: retryTechnicalMessage,
      }
    : {};

  if (!state.selectedProjectId) {
    openWelcomeProjectModal();
    return;
  }
  const selectedProjectReady = await ensureSelectedProjectInfoReady({ forceRefresh: true });
  if (!selectedProjectReady || !state.selectedProjectInfo) {
    appendMessage('assistant', 'Não consegui atualizar o contexto desse projeto no disco antes de enviar.', { persistToConversation: false });
    return;
  }

  await ensureActiveConversationForSend(visibleUserMessage);
  appendMessage('user', composedUserMessage);
  inputEl.value = '';
  resetTextareaHeight();

  if (state.uiMode === 'cortex') {
    const learningResult = await window.localcodeApi.learnWithCortex({
      projectId: state.selectedProjectId,
      projectInfo: state.selectedProjectInfo,
      userMessage: effectivePersonaMessage,
      attachments: attachmentsPayload,
      contextHint: buildPersonaRequestContextHint(personaContextExtra),
      conversationMessages: getRecentConversationMessagesForPersona(),
    });

    state.attachments = [];
    renderAttachments();

    if (learningResult && learningResult.ok) {
      state.cortexLearningByProject[state.selectedProjectId] = learningResult.learning;
      if (learningResult.knowledgeStatus) {
        state.knowledgeRuntimeStatusByProject[state.selectedProjectId] = learningResult.knowledgeStatus;
      }
      appendMessage('assistant', learningResult.message);
      renderCortexLearning(learningResult.learning);
      renderCortexRuntimeStatus(state.knowledgeRuntimeStatusByProject[state.selectedProjectId] || null);
      updateStatus('Memória atualizada');
    } else {
      appendMessage('assistant', learningResult?.message || 'Não consegui registrar essa memória do projeto.');
      updateStatus('Falha ao salvar memória');
    }
    return;
  }

  updateStatus('Conversando com a Persona para entender o pedido.');
  showPersonaThinkingIndicator();

  if (!window.localcodeApi || !window.localcodeApi.sendAssistantMessage) {
    hidePersonaThinkingIndicator();
    state.attachments = [];
    renderAttachments();
    appendMessage(
      'assistant',
      'Não iniciei execução. O fluxo atômico da Persona não está disponível nesta versão, então não posso decidir e planejar com segurança.',
      { persistToConversation: true }
    );
    updateStatus('Persona indisponível.');
    return;
  }

  let plan = null;
  try {
    plan = await window.localcodeApi.sendAssistantMessage({
      projectInfo: state.selectedProjectInfo,
      userMessage: effectivePersonaMessage,
      attachments: attachmentsPayload,
      contextHint: buildPersonaRequestContextHint(personaContextExtra),
      conversationMessages: getRecentConversationMessagesForPersona(),
    });
  } catch (error) {
    hidePersonaThinkingIndicator();
    state.attachments = [];
    renderAttachments();
    appendMessage(
      'assistant',
      `A Persona não conseguiu decidir o próximo passo pelo provedor selecionado. Detalhe: ${
        error && error.message ? error.message : String(error || '')
      }`,
      { persistToConversation: true }
    );
    updateStatus('IA desconectada ou indisponível.');
    return;
  }

  hidePersonaThinkingIndicator();
  if (plan && plan.routeDecision && plan.routeDecision.decision === 'execute' && plan.routeDecision.response) {
    appendMessage('assistant', plan.routeDecision.response);
  }

  state.attachments = [];
  renderAttachments();

  const suppressInterim = shouldSuppressInterimAssistantPlanMessage(plan);
  if (!suppressInterim && plan && plan.response) {
    appendMessage('assistant', plan.response);
  }
  if (plan && plan.ok && plan.action) {
    if (plan.action.targetFile) {
      updateStatus(`Encontrei a raiz do problema em ${plan.action.targetFile}.`);
    } else {
      updateStatus('Planejamento concluído. Pronto para corrigir.');
    }
  } else if (plan && !plan.action) {
    const reason = String((plan && plan.meta && plan.meta.reason) || '');
    if (reason === 'cortex_briefing_clarification_needed') {
      updateStatus('Aguardando suas respostas para fechar o briefing.');
    } else if (reason === 'persona_clarification_needed') {
      updateStatus('Aguardando alinhamento com a Persona.');
    } else if (plan && plan.meta && plan.meta.providerError) {
      updateStatus('IA desconectada ou indisponível.');
    } else if (reason === 'conversation_only') {
      updateStatus('Resposta enviada.');
    } else if (reason === 'edit_needs_target') {
      updateStatus('Preciso de um alvo mais claro antes de editar.');
    } else {
      updateStatus('Nenhuma alteração foi preparada nesta rodada.');
    }
  }
  state.lastAssistantMeta = plan && plan.meta ? { ...plan.meta, lastHadAction: Boolean(plan.action) } : null;
  if (plan && plan.jobId) {
    startJobPolling(plan.jobId);
  }

  if (plan && plan.ok && plan.action) {
    showPending(
      `Posso aplicar essa alteração agora? Nada será alterado sem sua confirmação.`,
      plan.action
    );
  } else {
    clearPending();
  }
}

async function onConfirm() {
  if (!state.pendingAction || !state.selectedProjectInfo) return;

  updateStatus('Estou corrigindo o erro.');
  const selectedProjectReady = await ensureSelectedProjectInfoReady({ forceRefresh: true });
  if (!selectedProjectReady || !state.selectedProjectInfo) {
    appendMessage('assistant', 'Não consegui atualizar o contexto desse projeto no disco antes de executar.');
    updateStatus('Projeto indisponível para execução');
    return;
  }

  const result = await window.localcodeApi.executePlan(state.pendingAction, state.selectedProjectInfo);
  if (state.activeJobId) {
    pollJob(state.activeJobId);
  }
  if (!result.ok) {
    if (result && result.projectInfo && result.projectInfo.rootPath) {
      state.selectedProjectInfo = result.projectInfo;
    }
    state.lastQualityReport = result && result.qualityReport ? result.qualityReport : state.lastQualityReport;
    await refreshProjectFilesTree();
    const finalMessage = buildExecutionOutcomeAssistantMessage(result, state.pendingAction, state.lastQualityReport);
    appendMessage('assistant', finalMessage || result.message || 'Falha ao executar ação.');
    if (result && result.blockedByPostExecutionValidation) {
      updateStatus('Validação técnica bloqueou conclusão; correção incremental necessária');
    } else {
      updateStatus('Falha na execução');
    }
    clearPending();
    return;
  }

  if (result && result.projectInfo && result.projectInfo.rootPath) {
    state.selectedProjectInfo = result.projectInfo;
  }
  state.nextSteps = result.nextSteps || state.nextSteps;
  state.lastQualityReport = result && result.qualityReport ? result.qualityReport : null;
  renderNextSteps();
  await refreshProjectFilesTree();

  const finalMessage = buildExecutionOutcomeAssistantMessage(result, state.pendingAction, state.lastQualityReport);

  if (Array.isArray(result.modifiedFiles) && result.modifiedFiles.length) {
    appendMessage('assistant', finalMessage || result.message || 'Concluído.');
    appendChangeCard(state.pendingAction, result);
    showModificationAlert(`Arquivo modificado: ${result.modifiedFiles.join(', ')}`);
    updateStatus('Alteração aplicada com sucesso');
  } else {
    appendMessage('assistant', finalMessage || result.message || 'Concluído.');
    updateStatus('Ação concluída');
  }
  clearPending();
}

async function onCancel() {
  const jobId =
    (state.pendingAction && state.pendingAction.jobId ? state.pendingAction.jobId : null) ||
    state.activeJobId ||
    null;

  if (jobId && window.localcodeApi.cancelJob) {
    try {
      await window.localcodeApi.cancelJob({ jobId });
    } catch {
      // O cancelamento local ainda deve limpar a tela mesmo se o registro do job falhar.
    }
  }

  appendMessage('assistant', 'Ação cancelada. Nenhum arquivo foi alterado.');
  window.localcodeApi
    .appendAuditEvent('assistant.execute_cancelled', {
      rootPath: state.selectedProjectInfo ? state.selectedProjectInfo.rootPath : null,
      targetFile: state.pendingAction ? state.pendingAction.targetFile : null,
      jobId,
    })
    .catch(() => {});
  stopJobPolling();
  state.activeJobId = null;
  clearPending();
  hideJobProgress();
}

async function onNewConversation() {
  if (!state.selectedProjectId) {
    openWelcomeProjectModal();
    return;
  }

  await prepareNewConversationForProject(state.selectedProjectId);
  renderProjects();
}

async function onAddProject() {
  const result = await window.localcodeApi.addProject();
  if (!result.ok) return;

  state.projects = normalizeProjectItems(result.projects);
  renderProjects();

  if (state.projects.length) {
    const latest = state.projects[state.projects.length - 1];
    await selectProject(latest.id);
  }
}

function inferGithubRepoNameFromProject() {
  const selected = state.projects.find((project) => project.id === state.selectedProjectId);
  const fromName = selected && selected.name ? String(selected.name).trim() : '';
  if (fromName) return fromName.replace(/\s+/g, '-');

  const rootPath = state.selectedProjectInfo && state.selectedProjectInfo.rootPath
    ? String(state.selectedProjectInfo.rootPath)
    : '';
  const parts = rootPath.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || 'faber-code-project';
}

function formatGithubPublishPlan(plan) {
  if (!plan) return 'Não consegui montar o plano GitHub.';
  const blockers = Array.isArray(plan.blockers) ? plan.blockers : [];
  const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const lines = [
    `Plano GitHub para ${plan.repoFullName || plan.repoName || 'repositório'} (${plan.visibility || 'private'}).`,
    `Branch: ${plan.branch || 'main'}.`,
  ];

  if (plan.auth && plan.auth.ghInstalled === false) {
    lines.push('GitHub CLI não encontrado. Instale `gh` e rode `gh auth login` antes de publicar.');
  } else if (plan.auth && plan.auth.authenticated === false) {
    lines.push('GitHub CLI encontrado, mas ainda não autenticado. Rode `gh auth login`.');
  }

  if (warnings.length) {
    lines.push(`Avisos: ${warnings.join(' ')}`);
  }
  if (blockers.length) {
    lines.push(`Bloqueios: ${blockers.join(' ')}`);
  }
  if (actions.length) {
    lines.push(`Ações previstas: ${actions.map((entry) => entry.label || entry.id).join(' > ')}.`);
  }
  return lines.join('\n');
}

async function onProjectGitClick() {
  if (!state.selectedProjectInfo || !state.selectedProjectInfo.rootPath) {
    appendMessage('assistant', 'Selecione um projeto antes de configurar GitHub.', { persistToConversation: false });
    return;
  }
  if (!window.localcodeApi || !window.localcodeApi.getGithubPublishPlan || !window.localcodeApi.publishProjectToGithub) {
    appendMessage('assistant', 'A integração GitHub ainda não está disponível neste build.', { persistToConversation: false });
    return;
  }

  const defaultRepoName = inferGithubRepoNameFromProject();
  const repoNameInput = window.prompt('Nome do repositório GitHub:', defaultRepoName);
  if (repoNameInput === null) return;

  const visibilityInput = window.prompt('Visibilidade do repositório (`private` ou `public`):', 'private');
  if (visibilityInput === null) return;

  const options = {
    repoName: repoNameInput || defaultRepoName,
    visibility: /^public$/i.test(String(visibilityInput || '').trim()) ? 'public' : 'private',
  };

  updateStatus('Preparando plano GitHub...');
  const planResult = await window.localcodeApi.getGithubPublishPlan({
    rootPath: state.selectedProjectInfo.rootPath,
    options,
  });

  if (!planResult || !planResult.ok || !planResult.plan) {
    appendMessage('assistant', (planResult && planResult.message) || 'Falha ao planejar publicação GitHub.', {
      persistToConversation: false,
    });
    updateStatus('GitHub: plano indisponível');
    return;
  }

  appendMessage('assistant', formatGithubPublishPlan(planResult.plan), { persistToConversation: false });
  if (!planResult.plan.ready) {
    updateStatus('GitHub: pendências encontradas');
    return;
  }

  const confirmed = window.confirm(
    `Publicar este projeto no GitHub como ${planResult.plan.repoFullName || options.repoName}?`
  );
  if (!confirmed) {
    updateStatus('Publicação GitHub cancelada');
    return;
  }

  updateStatus('Publicando no GitHub...');
  const publishResult = await window.localcodeApi.publishProjectToGithub({
    rootPath: state.selectedProjectInfo.rootPath,
    options,
  });

  if (!publishResult || !publishResult.ok) {
    appendMessage('assistant', (publishResult && publishResult.message) || 'Falha ao publicar no GitHub.', {
      persistToConversation: false,
    });
    updateStatus('GitHub: falha na publicação');
    return;
  }

  const repoUrl = publishResult.report && publishResult.report.repoUrl ? publishResult.report.repoUrl : '';
  appendMessage('assistant', repoUrl ? `Projeto publicado no GitHub: ${repoUrl}` : 'Projeto publicado no GitHub.', {
    persistToConversation: false,
  });
  updateStatus('GitHub publicado');
}

function formatPreviewStartFailure(result) {
  const plan = result && result.plan ? result.plan : null;
  const warnings = plan && Array.isArray(plan.warnings) ? plan.warnings : [];
  const blockers = plan && Array.isArray(plan.blockers) ? plan.blockers : [];
  const steps = plan && Array.isArray(plan.steps) ? plan.steps : [];
  const blockedSteps = steps.filter((step) => step && step.status === 'blocked');
  const manualSteps = steps.filter((step) => step && step.status === 'manual');
  const lines = [(result && result.message) || 'Execução local bloqueada.'];
  if (warnings.length) lines.push(`Avisos: ${warnings.join(' ')}`);
  if (blockers.length) lines.push(`Bloqueios: ${blockers.join(' ')}`);
  if (manualSteps.length) {
    lines.push(`Etapas manuais: ${manualSteps.map((step) => step.commandText || step.label).join(', ')}`);
  }
  if (blockedSteps.length) {
    lines.push(`Etapas bloqueadas: ${blockedSteps.map((step) => step.label || step.id).join(', ')}`);
  }
  return lines.join('\n');
}

async function onProjectPreviewClick() {
  if (!state.selectedProjectInfo || !state.selectedProjectInfo.rootPath) {
    appendMessage('assistant', 'Selecione um projeto antes de executar localmente.', { persistToConversation: false });
    return;
  }
  if (!window.localcodeApi || !window.localcodeApi.startProjectPreview) {
    appendMessage('assistant', 'Execução local ainda não está disponível neste build.', { persistToConversation: false });
    return;
  }

  updateStatus('Executando projeto local...');
  const result = await window.localcodeApi.startProjectPreview({
    rootPath: state.selectedProjectInfo.rootPath,
    open: true,
  });

  if (!result || !result.ok || !result.session) {
    appendMessage('assistant', formatPreviewStartFailure(result || null), { persistToConversation: false });
    updateStatus('Execução bloqueada');
    return;
  }

  const installNote = result.install && result.install.ok ? ' Dependências instaladas automaticamente antes da execução.' : '';
  const target = result.session.url || result.session.commandText || 'processo local iniciado';
  appendMessage('assistant', `Execução local ativa: ${target}.${installNote}`, { persistToConversation: false });
  updateStatus('Execução local ativa');
}

function onProjectsSearch() {
  state.projectSearchQuery = projectsSearchEl.value || '';
  renderProjects();
}

function onAttachClick() {
  imageInputEl.click();
}

function onImageInputChange(event) {
  const incoming = Array.from(event.target.files || []);
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
  state.attachments = [...state.attachments, ...allowed];
  imageInputEl.value = '';
  renderAttachments();
}

function maskTail(value, visibleTail = 4) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= visibleTail) return '*'.repeat(text.length);
  return '*'.repeat(Math.max(0, text.length - visibleTail)) + text.slice(-visibleTail);
}

function normalizeKnownProvider(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (normalized.startsWith('custom:')) return normalized;
  if (normalized === 'mock') return 'mock';
  if (normalized === 'gemini') return 'gemini';
  if (normalized === 'sambanova') return 'sambanova';
  if (normalized === 'rwkv') return 'rwkv';
  return 'rwkv';
}

function providerStatusLabel(providerValue) {
  const normalized = normalizeKnownProvider(providerValue);
  if (normalized === 'mock') return 'Mock local';
  if (normalized === 'gemini') return 'Gemini API';
  if (normalized === 'sambanova') return 'SambaNova API';
  if (normalized.startsWith('custom:')) return 'API custom';
  return 'RWKV local';
}

function normalizeInterfaceLanguage(rawValue) {
  const normalized = String(rawValue || '').trim();
  const allowed = new Set(['pt-BR', 'en-US', 'es-ES']);
  return allowed.has(normalized) ? normalized : 'pt-BR';
}

function humanizeProviderName(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (normalized === 'mock') return 'Mock Local';
  if (normalized === 'rwkv') return 'RWKV Local';
  if (normalized.includes('gemini') || normalized.includes('google')) return 'Gemini API';
  if (normalized.includes('sambanova') || normalized.includes('samba')) return 'SambaNova API';
  if (normalized.includes('openai')) return 'OpenAI API';
  if (normalized.includes('deepseek')) return 'DeepSeek API';
  return String(rawValue || 'Serviço customizado').trim() || 'Serviço customizado';
}

function providerDocsUrl(providerName) {
  const key = String(providerName || '').trim().toLowerCase();
  if (key.includes('gemini') || key.includes('google')) return 'https://aistudio.google.com/app/apikey';
  if (key.includes('sambanova') || key.includes('samba')) return 'https://cloud.sambanova.ai/';
  if (key.includes('openai')) return 'https://platform.openai.com/api-keys';
  if (key.includes('deepseek')) return 'https://platform.deepseek.com/api_keys';
  return '';
}

function compactKeyLabel(hasKey, keyMasked) {
  if (!hasKey) return t('keyNotConfigured');
  const tail = String(keyMasked || '').replace(/^\*+/, '').trim();
  return tail ? t('keySavedEnding').replace('{tail}', tail) : t('keySaved');
}

function apiRowReadinessLabel(row) {
  if (!row) return t('notConfigured');
  if (row.selectable) return t('ready');
  if (row.kind === 'builtin' && (row.provider === 'mock' || row.provider === 'rwkv')) return t('ready');
  return t('needsConfig');
}

function apiRowKindLabel(row) {
  if (!row) return 'API';
  if (row.provider === 'mock' || row.provider === 'rwkv') return t('local');
  return row.kind === 'custom' ? t('custom') : t('native');
}

function normalizeDisabledBuiltInProviders(rawList) {
  const allowed = new Set(['gemini', 'sambanova']);
  const list = Array.isArray(rawList) ? rawList : [];
  return Array.from(new Set(list.map((item) => normalizeKnownProvider(item)).filter((item) => allowed.has(item))));
}

function isBuiltInProviderDisabled(provider) {
  if (!state.aiSettingsDraft) return false;
  const normalized = normalizeKnownProvider(provider);
  return normalizeDisabledBuiltInProviders(state.aiSettingsDraft.disabledBuiltInProviders).includes(normalized);
}

function setBuiltInProviderDisabled(provider, disabled) {
  if (!state.aiSettingsDraft) return;
  const normalized = normalizeKnownProvider(provider);
  const current = new Set(normalizeDisabledBuiltInProviders(state.aiSettingsDraft.disabledBuiltInProviders));
  if (disabled) current.add(normalized);
  else current.delete(normalized);
  state.aiSettingsDraft.disabledBuiltInProviders = Array.from(current);
}

function normalizeCustomProviderName(rawValue) {
  const value = String(rawValue || '').trim();
  const low = value.toLowerCase();
  if (!value) return '';
  if (low.includes('openai')) return 'openai';
  if (low.includes('deepseek')) return 'deepseek';
  if (low.includes('gemini') || low.includes('google')) return 'gemini';
  if (low.includes('sambanova')) return 'sambanova';
  return value;
}


function showAiSettingsPanel(panel) {
  if (aiSettingsHomePanelEl) aiSettingsHomePanelEl.classList.toggle('hidden', panel !== 'home');
  if (aiSettingsLanguagePanelEl) aiSettingsLanguagePanelEl.classList.toggle('hidden', panel !== 'language');
  if (aiSettingsApisPanelEl) aiSettingsApisPanelEl.classList.toggle('hidden', panel !== 'apis');
}

function closeAiSettingsModal() {
  if (!aiSettingsModalEl) return;
  aiSettingsModalEl.classList.add('hidden');
  aiSettingsModalEl.setAttribute('aria-hidden', 'true');
  state.aiSettingsDraft = null;
}

function createAiSettingsDraft(settings) {
  const customApis = Array.isArray(settings && settings.customApis) ? settings.customApis : [];
  return {
    selectedProvider: normalizeKnownProvider(settings && settings.provider ? settings.provider : 'rwkv'),
    interfaceLanguage: normalizeInterfaceLanguage(settings && settings.interfaceLanguage),
    disabledBuiltInProviders: normalizeDisabledBuiltInProviders(settings && settings.disabledBuiltInProviders),
    gemini: {
      model: String((settings && settings.gemini && settings.gemini.model) || ''),
      apiLabel: String((settings && settings.gemini && settings.gemini.apiLabel) || ''),
      keyPending: '',
      keyCleared: false,
      hasKey: Boolean(settings && settings.gemini && settings.gemini.hasKey),
      keyMasked: String((settings && settings.gemini && settings.gemini.keyMasked) || ''),
      keySource: String((settings && settings.gemini && settings.gemini.keySource) || 'none'),
    },
    sambanova: {
      model: String((settings && settings.sambanova && settings.sambanova.model) || ''),
      apiLabel: String((settings && settings.sambanova && settings.sambanova.apiLabel) || ''),
      keyPending: '',
      keyCleared: false,
      hasKey: Boolean(settings && settings.sambanova && settings.sambanova.hasKey),
      keyMasked: String((settings && settings.sambanova && settings.sambanova.keyMasked) || ''),
      keySource: String((settings && settings.sambanova && settings.sambanova.keySource) || 'none'),
    },
    customApis: customApis.map((item, index) => ({
      id: String(item && item.id ? item.id : `custom-${Date.now()}-${index}`),
      providerName: String((item && item.providerName) || '').trim(),
      model: String((item && item.model) || '').trim(),
      apiLabel: String((item && item.apiLabel) || '').trim(),
      website: String((item && item.website) || '').trim(),
      keyPending: '',
      hasKey: Boolean(item && item.hasKey),
      keyMasked: String((item && item.keyMasked) || ''),
    })),
  };
}

function getDraftApiRows() {
  const draft = state.aiSettingsDraft;
  if (!draft) return [];
  const rows = [
    {
      id: 'builtin:mock',
      kind: 'builtin',
      provider: 'mock',
      providerName: 'mock',
      title: 'Mock Local',
      subtitle: 'Sem API | respostas determinísticas para testes',
      selectable: true,
      editable: false,
      hasKey: true,
      keyMasked: '',
      model: 'mock-persona',
      apiLabel: '',
      website: '',
    },
    {
      id: 'builtin:rwkv',
      kind: 'builtin',
      provider: 'rwkv',
      providerName: 'rwkv',
      title: 'RWKV Local',
      subtitle: 'Sem API key | execução local',
      selectable: true,
      editable: false,
      hasKey: true,
      keyMasked: '',
      model: '',
      apiLabel: '',
      website: '',
    },
  ];

  if (!isBuiltInProviderDisabled('gemini')) {
    rows.push({
      id: 'builtin:gemini',
      kind: 'builtin',
      provider: 'gemini',
      providerName: 'gemini',
      title: 'Gemini API',
      subtitle: draft.gemini.apiLabel || 'Google AI Studio',
      selectable: Boolean(draft.gemini.hasKey && String(draft.gemini.model || '').trim()),
      editable: true,
      hasKey: draft.gemini.hasKey,
      keyMasked: draft.gemini.keyMasked,
      model: draft.gemini.model,
      apiLabel: draft.gemini.apiLabel,
      website: providerDocsUrl('gemini'),
    });
  }

  if (!isBuiltInProviderDisabled('sambanova')) {
    rows.push({
      id: 'builtin:sambanova',
      kind: 'builtin',
      provider: 'sambanova',
      providerName: 'sambanova',
      title: 'SambaNova API',
      subtitle: draft.sambanova.apiLabel || 'SambaNova Cloud',
      selectable: Boolean(draft.sambanova.hasKey && String(draft.sambanova.model || '').trim()),
      editable: true,
      hasKey: draft.sambanova.hasKey,
      keyMasked: draft.sambanova.keyMasked,
      model: draft.sambanova.model,
      apiLabel: draft.sambanova.apiLabel,
      website: providerDocsUrl('sambanova'),
    });
  }

  draft.customApis.forEach((item) => {
    const providerName = String(item.providerName || '').trim();
    const normalizedProvider = providerName.toLowerCase();
    const hasRunnableKind = /(openai|deepseek|gemini|google|samba)/i.test(providerName);
    const selectable = Boolean(item.hasKey && String(item.model || '').trim() && (hasRunnableKind || String(item.website || '').trim()));

    rows.push({
      id: `custom:${item.id}`,
      kind: 'custom',
      provider: `custom:${item.id}`,
      customId: item.id,
      providerHint: normalizedProvider,
      providerName,
      title: humanizeProviderName(providerName || 'Serviço customizado'),
      subtitle: item.apiLabel || t('customProfile'),
      selectable,
      editable: true,
      hasKey: item.hasKey,
      keyMasked: item.keyMasked,
      model: item.model,
      apiLabel: item.apiLabel,
      website: item.website || providerDocsUrl(providerName),
    });
  });

  return rows;
}

function buildComposerProviderOptionsFromSettings(settings) {
  const disabledBuiltIns = new Set(normalizeDisabledBuiltInProviders(settings && settings.disabledBuiltInProviders));
  const options = [
    { value: 'mock', label: 'Mock Local' },
    { value: 'rwkv', label: 'RWKV Local' },
  ];
  if (!disabledBuiltIns.has('gemini')) options.push({ value: 'gemini', label: 'Gemini API' });
  if (!disabledBuiltIns.has('sambanova')) options.push({ value: 'sambanova', label: 'SambaNova API' });

  const customApis = Array.isArray(settings && settings.customApis) ? settings.customApis : [];
  customApis.forEach((item) => {
    const id = String(item && item.id ? item.id : '').trim();
    if (!id) return;
    const providerName = String((item && item.providerName) || '').trim();
    const model = String((item && item.model) || '').trim();
    const hasKey = Boolean(item && item.hasKey);
    const website = String((item && item.website) || '').trim();
    const supportedKind = /(openai|deepseek|gemini|google|samba)/i.test(providerName);
    const selectable = hasKey && model && (supportedKind || website);
    if (!selectable) return;

    const labelBase = humanizeProviderName(providerName || 'API custom');
    const labelSuffix = String((item && item.apiLabel) || '').trim();
    const label = labelSuffix ? `${labelBase} - ${labelSuffix}` : labelBase;
    options.push({ value: `custom:${id}`, label });
  });

  return options;
}

function renderComposerProviderOptions(settings) {
  if (!composerProviderEl) return;
  const options = buildComposerProviderOptionsFromSettings(settings);
  const current = normalizeKnownProvider(state.selectedAiProvider || composerProviderEl.value || 'rwkv');

  composerProviderEl.innerHTML = '';
  options.forEach((entry) => {
    const opt = document.createElement('option');
    opt.value = entry.value;
    opt.textContent = entry.label;
    composerProviderEl.appendChild(opt);
  });

  const exists = options.some((entry) => entry.value === current);
  const selected = exists ? current : 'rwkv';
  composerProviderEl.value = selected;
  state.selectedAiProvider = selected;
}

function refreshAiSettingsCurrentLine() {
  if (!aiSettingsCurrentEl || !state.aiSettingsDraft) return;
  const rows = getDraftApiRows();
  const active = rows.find((x) => x.provider === state.aiSettingsDraft.selectedProvider);
  aiSettingsCurrentEl.innerHTML = '';
  if (!active) {
    const title = document.createElement('strong');
    title.textContent = t('noActiveAi');
    const detail = document.createElement('span');
    detail.textContent = t('chooseReadyApi');
    aiSettingsCurrentEl.append(title, detail);
    return;
  }
  const title = document.createElement('strong');
  title.textContent = t('activeAiProject').replace('{name}', active.title);
  const detail = document.createElement('span');
  const modelInfo = active.model ? t('modelPrefix').replace('{model}', active.model) : t('defaultLocalModel');
  detail.textContent = `${apiRowKindLabel(active)} | ${modelInfo} | ${compactKeyLabel(active.hasKey, active.keyMasked)}`;
  aiSettingsCurrentEl.append(title, detail);
}

function closeAiSettingsEditor() {
  if (aiSettingsApiEditorEl) aiSettingsApiEditorEl.classList.add('hidden');
  if (aiSettingsEditorIdEl) aiSettingsEditorIdEl.value = '';
  if (aiSettingsEditorKindEl) aiSettingsEditorKindEl.value = '';
  if (aiSettingsEditorProviderEl) aiSettingsEditorProviderEl.value = '';
  if (aiSettingsEditorLabelEl) aiSettingsEditorLabelEl.value = '';
  if (aiSettingsEditorModelEl) aiSettingsEditorModelEl.value = '';
  if (aiSettingsEditorKeyEl) aiSettingsEditorKeyEl.value = '';
  if (aiSettingsEditorWebsiteEl) aiSettingsEditorWebsiteEl.value = '';
}

function setAiSettingsHelpLink(provider) {
  if (!aiSettingsProviderHelpEl || !aiSettingsProviderHelpLinkEl) return;
  const href = providerDocsUrl(provider);
  if (href) {
    aiSettingsProviderHelpEl.classList.remove('hidden');
    aiSettingsProviderHelpLinkEl.href = href;
  } else {
    aiSettingsProviderHelpEl.classList.add('hidden');
    aiSettingsProviderHelpLinkEl.href = '#';
  }
}

function openAiSettingsEditorForRow(row) {
  if (!row) return;
  if (aiSettingsApiEditorEl) aiSettingsApiEditorEl.classList.remove('hidden');
  if (aiSettingsEditorIdEl) aiSettingsEditorIdEl.value = row.id;
  if (aiSettingsEditorKindEl) aiSettingsEditorKindEl.value = row.kind;
  if (aiSettingsEditorProviderEl) aiSettingsEditorProviderEl.value = row.kind === 'custom' ? (row.providerName || row.title) : row.title;
  if (aiSettingsEditorLabelEl) aiSettingsEditorLabelEl.value = row.apiLabel || '';
  if (aiSettingsEditorModelEl) aiSettingsEditorModelEl.value = row.model || '';
  if (aiSettingsEditorKeyEl) aiSettingsEditorKeyEl.value = '';
  if (aiSettingsEditorWebsiteEl) aiSettingsEditorWebsiteEl.value = row.website || '';
  if (aiSettingsEditorProviderEl) aiSettingsEditorProviderEl.disabled = row.kind === 'builtin';
  setAiSettingsHelpLink(row.providerHint || row.provider);
}

function removeCustomApiDraft(customId) {
  if (!state.aiSettingsDraft || !customId) return;
  const entry = state.aiSettingsDraft.customApis.find((item) => item.id === customId);
  if (!entry) return;
  const label = entry.apiLabel || humanizeProviderName(entry.providerName || t('customApis'));
  const confirmed = window.confirm(`Remover "${label}" das APIs salvas? A remoção só será gravada ao clicar em Salvar.`);
  if (!confirmed) return;

  state.aiSettingsDraft.customApis = state.aiSettingsDraft.customApis.filter((item) => item.id !== customId);
  if (normalizeKnownProvider(state.aiSettingsDraft.selectedProvider) === `custom:${customId}`) {
    state.aiSettingsDraft.selectedProvider = 'rwkv';
  }
  if (aiSettingsEditorIdEl && aiSettingsEditorIdEl.value === `custom:${customId}`) {
    closeAiSettingsEditor();
  }
  renderAiSettingsApiList();
  refreshAiSettingsCurrentLine();
  setAiSettingsHelpLink(state.aiSettingsDraft.selectedProvider);
}

function clearBuiltinRemoteProviderDraft(provider) {
  if (!state.aiSettingsDraft) return;
  const normalized = normalizeKnownProvider(provider);
  const config = normalized === 'gemini'
    ? state.aiSettingsDraft.gemini
    : normalized === 'sambanova'
      ? state.aiSettingsDraft.sambanova
      : null;
  if (!config) return;

  const label = normalized === 'gemini' ? 'Gemini API' : 'SambaNova API';
  const confirmed = window.confirm(`Remover "${label}" da lista de APIs do projeto? O provedor continuará disponível para adicionar novamente.`);
  if (!confirmed) return;

  setBuiltInProviderDisabled(normalized, true);
  config.apiLabel = '';
  config.model = '';
  config.keyPending = '';
  config.keyCleared = true;
  config.hasKey = false;
  config.keyMasked = '';
  config.keySource = 'none';

  if (normalizeKnownProvider(state.aiSettingsDraft.selectedProvider) === normalized) {
    state.aiSettingsDraft.selectedProvider = 'rwkv';
  }

  if (aiSettingsEditorIdEl && aiSettingsEditorIdEl.value === `builtin:${normalized}`) {
    closeAiSettingsEditor();
  }
  renderAiSettingsApiList();
  refreshAiSettingsCurrentLine();
  setAiSettingsHelpLink(state.aiSettingsDraft.selectedProvider);
}

function createApiActionButton(label, className, onClick, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.disabled = disabled;
  if (typeof onClick === 'function') button.addEventListener('click', onClick);
  return button;
}

function renderAiSettingsApiSection(title, rows) {
  const section = document.createElement('div');
  section.className = 'ai-settings-api-section';

  const heading = document.createElement('p');
  heading.className = 'ai-settings-api-section-title';
  heading.textContent = title;
  section.appendChild(heading);

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'ai-settings-api-empty';
    empty.textContent = t('noCustomApi');
    section.appendChild(empty);
    return section;
  }

  rows.forEach((row) => {
    const isActive = row.provider === state.aiSettingsDraft.selectedProvider;
    const isReady = Boolean(row.selectable);
    const item = document.createElement('div');
    item.className = 'ai-settings-api-item';
    if (isActive) item.classList.add('is-active');
    if (!isReady) item.classList.add('is-incomplete');

    const meta = document.createElement('div');
    meta.className = 'ai-settings-api-meta';

    const titleRow = document.createElement('div');
    titleRow.className = 'ai-settings-api-title-row';

    const titleEl = document.createElement('strong');
    titleEl.textContent = row.title;
    titleRow.appendChild(titleEl);

    const kindBadge = document.createElement('span');
    kindBadge.className = 'ai-settings-api-badge';
    kindBadge.textContent = apiRowKindLabel(row);
    titleRow.appendChild(kindBadge);

    const readinessBadge = document.createElement('span');
    readinessBadge.className = `ai-settings-api-badge${isReady ? '' : ' is-warning'}`;
    readinessBadge.textContent = apiRowReadinessLabel(row);
    titleRow.appendChild(readinessBadge);

    if (isActive) {
      const activeBadge = document.createElement('span');
      activeBadge.className = 'ai-settings-api-badge is-active';
      activeBadge.textContent = t('active');
      titleRow.appendChild(activeBadge);
    }

    const detail = document.createElement('div');
    detail.className = 'ai-settings-api-detail';
    detail.textContent = row.subtitle || t('noLabel');

    const facts = document.createElement('div');
    facts.className = 'ai-settings-api-facts';
    const modelInfo = row.model ? t('modelPrefix').replace('{model}', row.model) : t('defaultLocalModel');
    facts.textContent = `${modelInfo} | ${compactKeyLabel(row.hasKey, row.keyMasked)}`;

    meta.append(titleRow, detail, facts);

    const actions = document.createElement('div');
    actions.className = 'ai-settings-api-actions';

    if (isActive) {
      actions.appendChild(createApiActionButton(t('active'), 'btn btn-muted', null, true));
    } else if (row.selectable) {
      actions.appendChild(createApiActionButton(t('use'), 'btn btn-success', () => {
        state.aiSettingsDraft.selectedProvider = normalizeKnownProvider(row.provider);
        refreshAiSettingsCurrentLine();
        renderAiSettingsApiList();
        setAiSettingsHelpLink(row.providerHint || row.provider);
      }));
    } else if (row.editable) {
      actions.appendChild(createApiActionButton(t('configure'), 'btn btn-muted', () => {
        openAiSettingsEditorForRow(row);
      }));
    }

    if (row.editable && (row.selectable || isActive)) {
      actions.appendChild(createApiActionButton(t('edit'), 'btn btn-muted', () => {
        openAiSettingsEditorForRow(row);
      }));
    }

    if (row.kind === 'custom' && row.customId) {
      actions.appendChild(createApiActionButton(t('remove'), 'btn btn-danger', () => {
        removeCustomApiDraft(row.customId);
      }));
    } else if (row.kind === 'builtin' && (row.provider === 'gemini' || row.provider === 'sambanova')) {
      actions.appendChild(createApiActionButton(t('remove'), 'btn btn-danger', () => {
        clearBuiltinRemoteProviderDraft(row.provider);
      }));
    }

    item.append(meta, actions);
    section.appendChild(item);
  });

  return section;
}

function renderAiSettingsApiList() {
  if (!aiSettingsApiListEl) return;
  aiSettingsApiListEl.innerHTML = '';
  const rows = getDraftApiRows();
  const builtinRows = rows.filter((row) => row.kind === 'builtin');
  const customRows = rows.filter((row) => row.kind === 'custom');
  aiSettingsApiListEl.appendChild(renderAiSettingsApiSection(t('nativeLocalProviders'), builtinRows));
  aiSettingsApiListEl.appendChild(renderAiSettingsApiSection(t('customApis'), customRows));
}

function addCustomApiDraft(providerValue) {
  if (!state.aiSettingsDraft) return;
  const normalized = String(providerValue || '').trim().toLowerCase();
  const builtInProvider = normalizeKnownProvider(normalized);
  if (builtInProvider === 'gemini' || builtInProvider === 'sambanova') {
    setBuiltInProviderDisabled(builtInProvider, false);
    renderAiSettingsApiList();
    refreshAiSettingsCurrentLine();
    const row = getDraftApiRows().find((item) => item.provider === builtInProvider);
    if (row) openAiSettingsEditorForRow(row);
    return;
  }

  const providerName = normalized === 'custom' ? '' : normalized;
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  state.aiSettingsDraft.customApis.push({
    id,
    providerName,
    model: '',
    apiLabel: '',
    website: providerDocsUrl(providerName),
    keyPending: '',
    hasKey: false,
    keyMasked: '',
  });
  renderAiSettingsApiList();
  if (aiSettingsApiEditorEl) aiSettingsApiEditorEl.classList.remove('hidden');
  if (aiSettingsEditorIdEl) aiSettingsEditorIdEl.value = `custom:${id}`;
  if (aiSettingsEditorKindEl) aiSettingsEditorKindEl.value = 'custom';
  if (aiSettingsEditorProviderEl) aiSettingsEditorProviderEl.disabled = false;
  if (aiSettingsEditorProviderEl) aiSettingsEditorProviderEl.value = humanizeProviderName(providerName || '');
  if (aiSettingsEditorLabelEl) aiSettingsEditorLabelEl.value = '';
  if (aiSettingsEditorModelEl) aiSettingsEditorModelEl.value = '';
  if (aiSettingsEditorKeyEl) aiSettingsEditorKeyEl.value = '';
  if (aiSettingsEditorWebsiteEl) aiSettingsEditorWebsiteEl.value = providerDocsUrl(providerName);
  setAiSettingsHelpLink(providerName);
}

function applyAiSettingsEditorChanges() {
  if (!state.aiSettingsDraft || !aiSettingsEditorIdEl) return;
  const rowId = String(aiSettingsEditorIdEl.value || '');
  const keyTyped = aiSettingsEditorKeyEl ? String(aiSettingsEditorKeyEl.value || '').trim() : '';
  const label = aiSettingsEditorLabelEl ? String(aiSettingsEditorLabelEl.value || '').trim() : '';
  const model = aiSettingsEditorModelEl ? String(aiSettingsEditorModelEl.value || '').trim() : '';
  const website = aiSettingsEditorWebsiteEl ? String(aiSettingsEditorWebsiteEl.value || '').trim() : '';
  const providerText = aiSettingsEditorProviderEl ? String(aiSettingsEditorProviderEl.value || '').trim() : '';

  if (rowId === 'builtin:gemini') {
    state.aiSettingsDraft.gemini.apiLabel = label;
    state.aiSettingsDraft.gemini.model = model;
    if (keyTyped) {
      state.aiSettingsDraft.gemini.keyPending = keyTyped;
      state.aiSettingsDraft.gemini.keyCleared = false;
      state.aiSettingsDraft.gemini.hasKey = true;
      state.aiSettingsDraft.gemini.keyMasked = maskTail(keyTyped);
    }
  } else if (rowId === 'builtin:sambanova') {
    state.aiSettingsDraft.sambanova.apiLabel = label;
    state.aiSettingsDraft.sambanova.model = model;
    if (keyTyped) {
      state.aiSettingsDraft.sambanova.keyPending = keyTyped;
      state.aiSettingsDraft.sambanova.keyCleared = false;
      state.aiSettingsDraft.sambanova.hasKey = true;
      state.aiSettingsDraft.sambanova.keyMasked = maskTail(keyTyped);
    }
  } else if (rowId.startsWith('custom:')) {
    const customId = rowId.slice('custom:'.length);
    const entry = state.aiSettingsDraft.customApis.find((x) => x.id === customId);
    if (entry) {
      const providerName = normalizeCustomProviderName(providerText) || entry.providerName;
      if (!providerName) {
        window.alert('Informe o serviço da API antes de salvar este perfil.');
        return;
      }
      entry.providerName = providerName;
      entry.apiLabel = label;
      entry.model = model;
      entry.website = website;
      if (keyTyped) {
        entry.keyPending = keyTyped;
        entry.hasKey = true;
        entry.keyMasked = maskTail(keyTyped);
      }
    }
  }

  closeAiSettingsEditor();
  renderAiSettingsApiList();
  refreshAiSettingsCurrentLine();
}

async function openAiSettingsModal() {
  if (!aiSettingsModalEl || !window.localcodeApi.getAiSettings) {
    appendMessage('assistant', 'Configurações de IA indisponíveis nesta build.', { persistToConversation: false });
    return;
  }

  let settings = null;
  try {
    settings = await window.localcodeApi.getAiSettings();
  } catch {
    appendMessage('assistant', 'Não consegui carregar as configurações de IA agora.', { persistToConversation: false });
    return;
  }

  if (!settings || !settings.ok) {
    appendMessage('assistant', 'Não consegui carregar as configurações de IA agora.', { persistToConversation: false });
    return;
  }

  state.aiSettingsDraft = createAiSettingsDraft(settings);
  applyInterfaceLanguage(state.aiSettingsDraft.interfaceLanguage || state.interfaceLanguage, { rerender: false });
  state.selectedAiProvider = state.aiSettingsDraft.selectedProvider;
  closeAiSettingsEditor();
  showAiSettingsPanel('home');
  if (aiSettingsLanguageEl) {
    aiSettingsLanguageEl.value = state.aiSettingsDraft.interfaceLanguage || 'pt-BR';
  }
  renderAiSettingsApiList();
  refreshAiSettingsCurrentLine();
  setAiSettingsHelpLink(state.selectedAiProvider);

  aiSettingsModalEl.classList.remove('hidden');
  aiSettingsModalEl.setAttribute('aria-hidden', 'false');
}

async function saveAiSettingsFromModal() {
  if (!window.localcodeApi.saveAiSettings || !state.aiSettingsDraft) {
    appendMessage('assistant', 'Salvar configurações de IA ainda não está disponível nesta build.', { persistToConversation: false });
    return;
  }

  const draft = state.aiSettingsDraft;
  const selectedProvider = normalizeKnownProvider(draft.selectedProvider);
  const selectedCustomId = selectedProvider.startsWith('custom:') ? selectedProvider.slice('custom:'.length) : '';
  const selectedBuiltInDisabled = normalizeDisabledBuiltInProviders(draft.disabledBuiltInProviders).includes(selectedProvider);
  const selectedProviderExists =
    !selectedBuiltInDisabled &&
    (!selectedCustomId || (draft.customApis || []).some((item) => item.id === selectedCustomId));
  const payload = {
    provider: selectedProviderExists ? selectedProvider : 'rwkv',
    interfaceLanguage: normalizeInterfaceLanguage(draft.interfaceLanguage),
    geminiModel: String(draft.gemini.model || '').trim(),
    geminiApiLabel: String(draft.gemini.apiLabel || '').trim(),
    sambanovaModel: String(draft.sambanova.model || '').trim(),
    sambanovaApiLabel: String(draft.sambanova.apiLabel || '').trim(),
    disabledBuiltInProviders: normalizeDisabledBuiltInProviders(draft.disabledBuiltInProviders),
    customApis: (draft.customApis || []).map((item) => ({
      id: item.id,
      providerName: String(item.providerName || '').trim(),
      model: String(item.model || '').trim(),
      apiLabel: String(item.apiLabel || '').trim(),
      website: String(item.website || '').trim(),
      apiKey: String(item.keyPending || '').trim(),
    })),
  };

  if (String(draft.gemini.keyPending || '').trim()) payload.geminiApiKey = String(draft.gemini.keyPending || '').trim();
  else if (draft.gemini.keyCleared) payload.geminiApiKey = '';
  if (String(draft.sambanova.keyPending || '').trim()) payload.sambanovaApiKey = String(draft.sambanova.keyPending || '').trim();
  else if (draft.sambanova.keyCleared) payload.sambanovaApiKey = '';

  const saved = await window.localcodeApi.saveAiSettings(payload);
  if (!saved || !saved.ok) {
    appendMessage('assistant', 'Não consegui salvar as configurações de IA nesta tentativa.', { persistToConversation: false });
    return;
  }

  state.selectedAiProvider = String(saved.provider || payload.provider || 'rwkv');
  applyInterfaceLanguage(saved.interfaceLanguage || payload.interfaceLanguage || state.interfaceLanguage);
  try {
    const refreshedSettings = await window.localcodeApi.getAiSettings();
    if (refreshedSettings && refreshedSettings.ok) {
      renderComposerProviderOptions(refreshedSettings);
    } else if (composerProviderEl) {
      composerProviderEl.value = state.selectedAiProvider;
    }
  } catch {
    if (composerProviderEl) composerProviderEl.value = state.selectedAiProvider;
  }
  try {
    state.aiRuntimeStatus = await window.localcodeApi.getAiStatus();
  } catch {
    state.aiRuntimeStatus = null;
  }

  updateStatus('Provedor selecionado: ' + providerStatusLabel(state.selectedAiProvider));

  closeAiSettingsModal();
}

function bindEvents() {
  async function toggleWindowFromChrome(event) {
    event.preventDefault();
    try {
      await window.localcodeApi.toggleWindowMaximize();
    } catch {}
  }

  if (appDragRegionEl) {
    appDragRegionEl.addEventListener('dblclick', toggleWindowFromChrome);
  }

  if (appShellEl) {
    appShellEl.addEventListener('dblclick', async (event) => {
      if (event.target !== appShellEl) return;
      await toggleWindowFromChrome(event);
    });
  }

  if (cortexModeBtnEl) {
    cortexModeBtnEl.addEventListener('click', async () => {
      await openCortexModal();
    });
  }
  document.getElementById('btn-add-project').addEventListener('click', onAddProject);
  if (welcomeStartConversationBtnEl) {
    welcomeStartConversationBtnEl.addEventListener('click', openWelcomeProjectModal);
  }
  if (welcomeNewProjectBtnEl) {
    welcomeNewProjectBtnEl.addEventListener('click', onWelcomeCreateProject);
  }
  if (welcomeProjectCreateBtnEl) {
    welcomeProjectCreateBtnEl.addEventListener('click', onWelcomeCreateProject);
  }
  if (welcomeProjectCloseEl) {
    welcomeProjectCloseEl.addEventListener('click', closeWelcomeProjectModal);
  }
  if (welcomeProjectBackdropEl) {
    welcomeProjectBackdropEl.addEventListener('click', closeWelcomeProjectModal);
  }
  if (newConversationBtnEl) newConversationBtnEl.addEventListener('click', onNewConversation);
  document.getElementById('btn-send').addEventListener('click', onSend);
  document.getElementById('btn-confirm').addEventListener('click', onConfirm);
  document.getElementById('btn-cancel').addEventListener('click', onCancel);
  attachBtnEl.addEventListener('click', onAttachClick);
  imageInputEl.addEventListener('change', onImageInputChange);
  inputEl.addEventListener('input', autoResizeTextarea);
  projectsSearchEl.addEventListener('input', onProjectsSearch);
  document.addEventListener('pointerdown', handleOutsideProjectClick);

  if (archivedProjectsBtnEl) {
    archivedProjectsBtnEl.addEventListener('click', async () => {
      await openProjectStateModal('archived');
    });
  }
  if (trashProjectsBtnEl) {
    trashProjectsBtnEl.addEventListener('click', async () => {
      await openProjectStateModal('deleted');
    });
  }
  if (projectSettingsBtnEl) {
    projectSettingsBtnEl.addEventListener('click', async () => {
      await openAiSettingsModal();
    });
  }
  if (projectGitBtnEl) {
    projectGitBtnEl.addEventListener('click', onProjectGitClick);
  }
  if (projectPreviewBtnEl) {
    projectPreviewBtnEl.addEventListener('click', onProjectPreviewClick);
  }

  if (projectStateModalCloseEl) {
    projectStateModalCloseEl.addEventListener('click', () => {
      closeProjectStateModal();
    });
  }

  if (projectStateModalEl) {
    projectStateModalEl.addEventListener('click', (event) => {
      const shouldClose = event.target && event.target.dataset && event.target.dataset.close === '1';
      if (shouldClose) closeProjectStateModal();
    });
  }

  if (cortexModalCloseEl) {
    cortexModalCloseEl.addEventListener('click', closeCortexModal);
  }
  if (cortexModalBackdropEl) {
    cortexModalBackdropEl.addEventListener('click', closeCortexModal);
  }
  if (cortexTopicSelectEl) {
    cortexTopicSelectEl.addEventListener('change', () => {
      state.cortexSelectedTopic = normalizeCortexTopic(cortexTopicSelectEl.value);
      renderCortexLightbox(state.cortexLearningByProject[state.selectedProjectId] || null);
    });
  }
  if (cortexTopicAddBtnEl) {
    cortexTopicAddBtnEl.addEventListener('click', onCortexTopicAdd);
  }
  if (cortexTopicRenameBtnEl) {
    cortexTopicRenameBtnEl.addEventListener('click', onCortexTopicRename);
  }
  if (cortexAttachBtnEl && cortexFileInputEl) {
    cortexAttachBtnEl.addEventListener('click', () => {
      cortexFileInputEl.click();
    });
  }
  if (cortexLibraryAttachBtnEl && cortexFileInputEl) {
    cortexLibraryAttachBtnEl.addEventListener('click', () => {
      cortexFileInputEl.click();
    });
  }
  if (cortexFileInputEl) {
    cortexFileInputEl.addEventListener('change', onCortexFileInputChange);
  }
  if (cortexSendBtnEl) {
    cortexSendBtnEl.addEventListener('click', onCortexSend);
  }
  if (cortexInputEl) {
    cortexInputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onCortexSend();
      }
    });
  }

  if (projectContextMenuEl) {
    projectContextMenuEl.addEventListener('click', async (event) => {
      const btn = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
      if (!btn || !state.projectContextMenuProjectId) return;
      const action = btn.dataset.action;
      const targetProjectId = state.projectContextMenuProjectId;
      hideProjectContextMenu();
      await runProjectContextAction(action, targetProjectId);
    });
  }

  if (composerProviderEl && window.localcodeApi && window.localcodeApi.setAiProvider) {
    composerProviderEl.addEventListener('change', async () => {
      const chosen = normalizeKnownProvider(composerProviderEl.value || state.selectedAiProvider || 'rwkv');
      const saved = await window.localcodeApi.setAiProvider(chosen);
      if (saved && saved.ok) {
        state.selectedAiProvider = String(saved.provider || chosen);
        updateStatus('Provedor selecionado: ' + providerStatusLabel(state.selectedAiProvider));
      }
    });
  }


  if (aiSettingsOpenLanguageEl) {
    aiSettingsOpenLanguageEl.addEventListener('click', () => {
      showAiSettingsPanel('language');
      if (aiSettingsLanguageEl && state.aiSettingsDraft) {
        aiSettingsLanguageEl.value = state.aiSettingsDraft.interfaceLanguage || 'pt-BR';
      }
    });
  }

  if (aiSettingsLanguageEl) {
    aiSettingsLanguageEl.addEventListener('change', () => {
      if (!state.aiSettingsDraft) return;
      state.aiSettingsDraft.interfaceLanguage = normalizeInterfaceLanguage(aiSettingsLanguageEl.value);
      aiSettingsLanguageEl.value = state.aiSettingsDraft.interfaceLanguage;
      applyInterfaceLanguage(state.aiSettingsDraft.interfaceLanguage);
    });
  }

  if (aiSettingsOpenApisEl) {
    aiSettingsOpenApisEl.addEventListener('click', () => {
      showAiSettingsPanel('apis');
      renderAiSettingsApiList();
      refreshAiSettingsCurrentLine();
    });
  }

  if (aiSettingsBackHomeEl) {
    aiSettingsBackHomeEl.addEventListener('click', () => {
      showAiSettingsPanel('home');
      closeAiSettingsEditor();
    });
  }

  if (aiSettingsBackHomeApisEl) {
    aiSettingsBackHomeApisEl.addEventListener('click', () => {
      showAiSettingsPanel('home');
      closeAiSettingsEditor();
    });
  }

  if (aiSettingsAddApiEl) {
    aiSettingsAddApiEl.addEventListener('click', () => {
      addCustomApiDraft(aiSettingsAddProviderEl ? aiSettingsAddProviderEl.value : 'custom');
    });
  }

  if (aiSettingsEditorCancelEl) {
    aiSettingsEditorCancelEl.addEventListener('click', () => {
      closeAiSettingsEditor();
    });
  }

  if (aiSettingsEditorSaveEl) {
    aiSettingsEditorSaveEl.addEventListener('click', () => {
      applyAiSettingsEditorChanges();
    });
  }

  if (aiSettingsSaveEl) {
    aiSettingsSaveEl.addEventListener('click', async () => {
      await saveAiSettingsFromModal();
    });
  }

  if (aiSettingsCancelEl) {
    aiSettingsCancelEl.addEventListener('click', () => {
      closeAiSettingsModal();
    });
  }

  if (aiSettingsCloseEl) {
    aiSettingsCloseEl.addEventListener('click', () => {
      closeAiSettingsModal();
    });
  }

  if (aiSettingsBackdropEl) {
    aiSettingsBackdropEl.addEventListener('click', () => {
      closeAiSettingsModal();
    });
  }

  if (projectFilesTreeEl) {
    projectFilesTreeEl.addEventListener('click', async (event) => {
      const row = event.target && event.target.closest ? event.target.closest('.project-tree-row') : null;
      if (!row) return;
      const relativePath = row.dataset.path || '';
      const isDir = row.dataset.dir === '1';
      if (isDir) return;
      await openProjectFileLightbox(relativePath);
    });

    projectFilesTreeEl.addEventListener('contextmenu', (event) => {
      const row = event.target && event.target.closest ? event.target.closest('.project-tree-row') : null;
      if (!row) return;
      const isDir = row.dataset.dir === '1';
      if (isDir) return;
      event.preventDefault();
      showProjectFileContextMenu(row.dataset.path || '', event.clientX, event.clientY);
    });
  }

  if (projectFileEditorEl) {
    ensureProjectCodeEditor();
    bindProjectCodeEditorEvents();

    if (!projectCodeEditor) {
      projectFileEditorEl.addEventListener('input', () => {
        const text = projectFileEditorEl.value || '';
        setFileDirty(text !== currentFileOriginalContent);
      });
      projectFileEditorEl.addEventListener('keydown', async (event) => {
        if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 's') {
          event.preventDefault();
          await saveCurrentOpenFile();
        }
      });
    }
  }

  if (projectFileSaveEl) {
    projectFileSaveEl.addEventListener('click', async () => {
      await saveCurrentOpenFile();
    });
  }

  if (projectFileModalCloseEl) {
    projectFileModalCloseEl.addEventListener('click', async () => {
      await closeProjectFileLightbox();
    });
  }

  if (projectFileModalEl) {
    projectFileModalEl.addEventListener('click', async (event) => {
      if (event.target && event.target.dataset && event.target.dataset.close === '1') {
        await closeProjectFileLightbox();
      }
    });
  }

  if (projectFileContextMenuEl) {
    projectFileContextMenuEl.addEventListener('click', async (event) => {
      const btn = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
      if (!btn || !currentFileContextPath) return;
      const action = btn.dataset.action;
      const relativePath = currentFileContextPath;
      hideProjectFileContextMenu();

      if (action === 'open') {
        await openProjectFileLightbox(relativePath);
        return;
      }

      if (action === 'reveal') {
        await window.localcodeApi.revealFileInFolder({
          projectInfo: state.selectedProjectInfo,
          relativePath,
        });
        return;
      }

      if (action === 'rename') {
        const currentName = getBaseName(relativePath);
        const nextName = prompt('Novo nome do arquivo:', currentName);
        if (!nextName || !nextName.trim() || nextName.trim() === currentName) return;
        if (!window.localcodeApi.renameProjectFile) {
          appendMessage('assistant', 'Renomear arquivo ainda não está disponível nesta build.', { persistToConversation: false });
          return;
        }
        const result = await window.localcodeApi.renameProjectFile({
          projectInfo: state.selectedProjectInfo,
          relativePath,
          nextName: nextName.trim(),
        });
        if (!result || !result.ok) {
          appendMessage('assistant', (result && result.message) || 'Falha ao renomear arquivo.', { persistToConversation: false });
          return;
        }
        await refreshProjectFilesTree();
      }
    });
  }

  document.addEventListener('click', (event) => {
    if (projectFileContextMenuEl && !projectFileContextMenuEl.classList.contains('hidden')) {
      const inside = event.target && event.target.closest && event.target.closest('#project-file-context-menu');
      if (!inside) hideProjectFileContextMenu();
    }
    if (projectContextMenuEl && !projectContextMenuEl.classList.contains('hidden')) {
      const insideProject = event.target && event.target.closest && event.target.closest('#project-context-menu');
      if (!insideProject) hideProjectContextMenu();
    }
  });

  document.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape' && projectFileModalEl && !projectFileModalEl.classList.contains('hidden')) {
      await closeProjectFileLightbox();
      return;
    }
    if (event.key === 'Escape' && projectContextMenuEl && !projectContextMenuEl.classList.contains('hidden')) {
      hideProjectContextMenu();
      return;
    }
    if (event.key === 'Escape' && welcomeProjectModalEl && !welcomeProjectModalEl.classList.contains('hidden')) {
      closeWelcomeProjectModal();
      return;
    }
    if (event.key === 'Escape' && projectStateModalEl && !projectStateModalEl.classList.contains('hidden')) {
      closeProjectStateModal();
      return;
    }
    if (event.key === 'Escape' && cortexModalEl && !cortexModalEl.classList.contains('hidden')) {
      closeCortexModal();
      return;
    }
    if (event.key === 'Escape' && aiSettingsModalEl && !aiSettingsModalEl.classList.contains('hidden')) {
      closeAiSettingsModal();
    }
  });

  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onSend();
    }
  });
}

function formatAiRuntimeMessage(status) {
  if (!status || !status.ok) {
    return 'IA: não foi possível validar o runtime nesta tentativa.';
  }

  const provider = String(status.provider || 'rwkv');
  if (provider === 'mock') {
    return 'Modo Mock Local selecionado. O fluxo roda com respostas determinísticas e não consome API.';
  }

  if (provider === 'gemini') {
    if (status.ready) {
      return 'Modo Gemini API selecionado para briefing (chave configurada, conexão ainda será validada no uso).';
    }
    return 'Modo Gemini API selecionado, mas a chave GEMINI_API_KEY ainda não está configurada.';
  }

  if (provider === 'sambanova') {
    if (status.ready) {
      return 'Modo SambaNova API selecionado para briefing (chave configurada, conexão ainda será validada no uso).';
    }
    return 'Modo SambaNova API selecionado, mas a chave SAMBANOVA_API_KEY ainda não está configurada.';
  }

  if (provider.startsWith('custom:')) {
    const name =
      status && status.customProvider && status.customProvider.providerName
        ? String(status.customProvider.providerName)
        : 'API custom';
    if (status.ready) {
      return `Modo ${name} selecionado para briefing (perfil custom configurado, conexão ainda será validada no uso).`;
    }
    if (status.reason === 'custom_api_key_missing') return `Modo ${name} selecionado, mas falta API key no perfil.`;
    if (status.reason === 'custom_api_model_missing') return `Modo ${name} selecionado, mas falta modelo no perfil.`;
    if (status.reason === 'custom_api_endpoint_missing') return `Modo ${name} selecionado, mas falta endpoint/website válido no perfil.`;
    return `Modo ${name} selecionado, mas o perfil custom ainda não está pronto.`;
  }

  if (status.ready) {
    return 'Modo RWKV local selecionado e com arquivos mínimos encontrados.';
  }

  if (status.reason === 'rwkv_model_missing') {
    return 'Modo RWKV local selecionado, mas o arquivo do modelo não foi encontrado.';
  }
  if (status.reason === 'rwkv_tokenizer_missing') {
    return 'Modo RWKV local selecionado, mas o tokenizer não foi encontrado.';
  }

  return 'Modo RWKV local selecionado, porém ainda não pronto nesta tentativa.';
}


function formatMempalaceRuntimeMessage(status) {
  if (!status || !status.ok) {
    return 'MemPalace: não foi possível validar o runtime nesta tentativa.';
  }

  if (!status.available) {
    if (status.reason === 'repo_not_found') {
      return 'MemPalace: repositório não encontrado no workspace. A memória avançada ficará em modo inativo até configurar o caminho.';
    }
    if (status.reason === 'dependency_missing') {
      return `MemPalace detectado, porém falta dependência Python (${status.dependency}).`;
    }
    return 'MemPalace detectado, mas indisponível no momento.';
  }

  return `MemPalace ativo (${status.version || 'versão local'}). Wing atual: ${
    status.wing || 'global'
  }.`;
}

async function bootstrap() {
  initializePanelLayout();
  bindEvents();
  applyInterfaceLanguage(state.interfaceLanguage, { rerender: false });
  setUiMode('default');
  hideJobProgress();
  resetTextareaHeight();
  await loadProjects();
  renderNextSteps();
  renderAttachments();

  try {
    state.aiRuntimeStatus = await window.localcodeApi.getAiStatus();
    state.selectedAiProvider =
      state.aiRuntimeStatus && state.aiRuntimeStatus.provider
        ? String(state.aiRuntimeStatus.provider)
        : state.selectedAiProvider;
  } catch {
    state.aiRuntimeStatus = null;
  }

  try {
    const aiSettings = await window.localcodeApi.getAiSettings();
    if (aiSettings && aiSettings.ok) {
      applyInterfaceLanguage(aiSettings.interfaceLanguage || state.interfaceLanguage, { rerender: false });
      renderComposerProviderOptions(aiSettings);
      if (!String(state.selectedAiProvider || '').startsWith('custom:')) {
        state.selectedAiProvider = normalizeKnownProvider(
          aiSettings.provider || state.selectedAiProvider || 'rwkv'
        );
      }
      if (composerProviderEl && state.selectedAiProvider) {
        const desired = normalizeKnownProvider(state.selectedAiProvider);
        if ([...composerProviderEl.options].some((opt) => opt.value === desired)) {
          composerProviderEl.value = desired;
        }
      }
    }
  } catch {
    if (composerProviderEl) composerProviderEl.value = normalizeKnownProvider(state.selectedAiProvider);
  }

  try {
    state.mempalaceStatus = await window.localcodeApi.getMempalaceStatus(null);
  } catch {
    state.mempalaceStatus = null;
  }

  renderWelcomePanel();
}

let __bootFinished = false;
const __preloaderWatchdog = setTimeout(() => {
  if (__bootFinished === false) {
    console.warn('[bootstrap] watchdog: ocultando preloader por timeout');
    hideStartupPreloader();
  }
}, 3000);

bootstrap()
  .catch((error) => {
    console.error('[bootstrap] erro:', error);
  })
  .finally(() => {
    __bootFinished = true;
    clearTimeout(__preloaderWatchdog);
    hideStartupPreloader();
  });
