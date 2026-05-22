(function () {
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

  function getCortexLearningParts(learning) {
    const source = learning && typeof learning === 'object' ? learning : {};
    return {
      persona: Array.isArray(source.persona) ? source.persona : Array.isArray(source.ia2) ? source.ia2 : [],
      executor: Array.isArray(source.executor) ? source.executor : Array.isArray(source.ia1) ? source.ia1 : [],
      events: Array.isArray(source.events) ? source.events : [],
      topics: Array.isArray(source.topics) ? source.topics : [],
    };
  }

  function createCortexController(options = {}) {
    const api = options.api || {};
    const t = typeof options.t === 'function' ? options.t : (key, fallback = '') => fallback || key;
    const getProjectId = typeof options.getProjectId === 'function' ? options.getProjectId : () => null;
    const getProjectInfo = typeof options.getProjectInfo === 'function' ? options.getProjectInfo : () => null;
    const getInterfaceLanguage = typeof options.getInterfaceLanguage === 'function'
      ? options.getInterfaceLanguage
      : () => 'pt-BR';
    const ensureProjectReady = typeof options.ensureProjectReady === 'function'
      ? options.ensureProjectReady
      : async () => Boolean(getProjectInfo() && getProjectInfo().rootPath);
    const setUiMode = typeof options.setUiMode === 'function' ? options.setUiMode : () => {};
    const updateStatus = typeof options.updateStatus === 'function' ? options.updateStatus : () => {};
    const requestTextInput = typeof options.requestTextInput === 'function'
      ? options.requestTextInput
      : async ({ title = 'Editar', initialValue = '' } = {}) => window.prompt(title, initialValue);
    const getLearning = typeof options.getLearning === 'function' ? options.getLearning : () => null;
    const setLearning = typeof options.setLearning === 'function' ? options.setLearning : () => {};
    const getRuntimeStatus = typeof options.getRuntimeStatus === 'function' ? options.getRuntimeStatus : () => null;
    const setRuntimeStatus = typeof options.setRuntimeStatus === 'function' ? options.setRuntimeStatus : () => {};
    const getAttachments = typeof options.getAttachments === 'function' ? options.getAttachments : () => [];
    const setAttachments = typeof options.setAttachments === 'function' ? options.setAttachments : () => {};
    const getSelectedTopic = typeof options.getSelectedTopic === 'function' ? options.getSelectedTopic : () => 'geral';
    const setSelectedTopic = typeof options.setSelectedTopic === 'function' ? options.setSelectedTopic : () => {};

    const elements = {
      modeButton: document.getElementById('btn-cortex-mode'),
      learningContent: document.getElementById('cortex-learning-content'),
      modal: document.getElementById('cortex-modal'),
      backdrop: document.getElementById('cortex-modal-backdrop'),
      close: document.getElementById('cortex-modal-close'),
      topicSelect: document.getElementById('cortex-topic-select'),
      chatLog: document.getElementById('cortex-chat-log'),
      input: document.getElementById('cortex-input'),
      attach: document.getElementById('cortex-attach'),
      fileInput: document.getElementById('cortex-file-input'),
      attachmentList: document.getElementById('cortex-attachment-list'),
      send: document.getElementById('cortex-send'),
      libraryList: document.getElementById('cortex-library-list'),
      rulesList: document.getElementById('cortex-rules-list'),
      topicList: document.getElementById('cortex-topic-list'),
      runtimeStatus: document.getElementById('cortex-runtime-status'),
      topicAdd: document.getElementById('cortex-topic-add'),
      topicRename: document.getElementById('cortex-topic-rename'),
      libraryAttach: document.getElementById('cortex-library-attach'),
    };

    function getActiveLearning() {
      return getLearning(getProjectId());
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
      const found = getCortexTopics(learning || getActiveLearning() || null)
        .find((item) => item.id === normalized);
      return found ? found.label : humanizeCortexTopicId(normalized);
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

    function renderChatMessage(role, text) {
      if (!elements.chatLog) return;
      const bubble = document.createElement('div');
      bubble.className = `cortex-chat-bubble ${role === 'user' ? 'user' : 'assistant'}`;
      bubble.textContent = text;
      elements.chatLog.appendChild(bubble);
      elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
    }

    function resetChatIntro() {
      if (!elements.chatLog || elements.chatLog.children.length) return;
      renderChatMessage('assistant', t('cortexIntro'));
    }

    function renderAttachments() {
      if (!elements.attachmentList) return;
      elements.attachmentList.innerHTML = '';
      const attachments = Array.isArray(getAttachments()) ? getAttachments() : [];
      if (!attachments.length) {
        elements.attachmentList.classList.add('is-empty');
        elements.attachmentList.textContent = t('noAttachmentUpdate');
        return;
      }

      elements.attachmentList.classList.remove('is-empty');
      attachments.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'cortex-attachment-item';

        const label = document.createElement('span');
        label.textContent = `${file.name || 'documento'} · ${formatCortexFileSize(file.size)}`;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.setAttribute('aria-label', t('removeCortexDoc'));
        remove.textContent = '×';
        remove.addEventListener('click', () => {
          const next = (Array.isArray(getAttachments()) ? getAttachments() : []).slice();
          next.splice(index, 1);
          setAttachments(next);
          renderAttachments();
        });

        item.append(label, remove);
        elements.attachmentList.appendChild(item);
      });
    }

    function syncTopicSelect(learning) {
      if (!elements.topicSelect) return;
      const topics = getCortexTopics(learning);
      const selected = normalizeCortexTopic(getSelectedTopic());
      elements.topicSelect.innerHTML = '';
      topics.forEach((topic) => {
        const option = document.createElement('option');
        option.value = topic.id;
        option.textContent = topic.label;
        elements.topicSelect.appendChild(option);
      });
      const nextSelected = topics.some((topic) => topic.id === selected) ? selected : 'geral';
      setSelectedTopic(nextSelected);
      elements.topicSelect.value = nextSelected;
    }

    function renderTopics(events, learning) {
      if (!elements.topicList) return;
      elements.topicList.innerHTML = '';
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
        item.className = `cortex-topic-chip${normalizeCortexTopic(getSelectedTopic()) === topic.id ? ' active' : ''}`;
        const label = document.createElement('span');
        label.textContent = topic.label;
        const count = document.createElement('strong');
        count.textContent = String(counts[topic.id] || 0);
        item.append(label, count);
        elements.topicList.appendChild(item);
      });
    }

    function renderLibrary(events) {
      if (!elements.libraryList) return;
      elements.libraryList.innerHTML = '';
      const attachments = (events || [])
        .filter((event) => event && event.type === 'cortex.attachment_learned')
        .slice()
        .reverse();

      if (!attachments.length) {
        const empty = document.createElement('div');
        empty.className = 'cortex-empty-state';
        empty.textContent = t('noLibraryDocs');
        elements.libraryList.appendChild(empty);
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
        elements.libraryList.appendChild(item);
      });
    }

    function renderRules(learning) {
      if (!elements.rulesList) return;
      elements.rulesList.innerHTML = '';
      const parts = getCortexLearningParts(learning);
      const rules = [
        ...parts.persona.slice(-5).map((text) => ({ scope: 'Persona', text })),
        ...parts.executor.slice(-5).map((text) => ({ scope: 'Executor', text })),
      ].reverse();

      if (!rules.length) {
        const empty = document.createElement('div');
        empty.className = 'cortex-empty-state';
        empty.textContent = t('noActiveRules');
        elements.rulesList.appendChild(empty);
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
        elements.rulesList.appendChild(item);
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

    function renderRuntimeStatus(status) {
      if (!elements.runtimeStatus) return;
      elements.runtimeStatus.innerHTML = '';
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
        elements.runtimeStatus.appendChild(item);
      });
    }

    function renderLightbox(learning) {
      if (!elements.modal) return;
      const parts = getCortexLearningParts(learning);
      syncTopicSelect(learning);
      renderTopics(parts.events, learning);
      renderLibrary(parts.events);
      renderRules(learning);
      renderRuntimeStatus(getRuntimeStatus(getProjectId()) || null);
      renderAttachments();
      resetChatIntro();
    }

    function renderLearning(learning) {
      if (!elements.learningContent) return;
      if (!learning) {
        elements.learningContent.textContent = t('noMemory');
        renderLightbox(null);
        return;
      }

      const lastIa2 = (Array.isArray(learning.persona) ? learning.persona : learning.ia2 || []).slice(-3);
      const lastIa1 = (Array.isArray(learning.executor) ? learning.executor : learning.ia1 || []).slice(-3);
      const updatedAt = learning.updatedAt
        ? new Date(learning.updatedAt).toLocaleString(getInterfaceLanguage() || 'pt-BR')
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

      elements.learningContent.textContent = lines.join('\n');
      renderLightbox(learning);
    }

    async function refreshKnowledgeRuntimeStatus() {
      const projectId = getProjectId();
      const projectInfo = getProjectInfo();
      if (!projectId || !projectInfo || !api.getKnowledgeRuntimeStatus) {
        renderRuntimeStatus(null);
        return null;
      }
      try {
        const result = await api.getKnowledgeRuntimeStatus({
          projectId,
          projectInfo,
        });
        if (result && result.ok) {
          setRuntimeStatus(projectId, result);
          renderRuntimeStatus(result);
          return result;
        }
      } catch {
        // Status is supportive; the Cortex local memory can still work without it.
      }
      renderRuntimeStatus(getRuntimeStatus(projectId) || null);
      return null;
    }

    async function refreshLearningPanel() {
      const projectId = getProjectId();
      if (!projectId) {
        renderLearning(null);
        return;
      }

      try {
        const result = await api.getCortexLearning({ projectId });
        if (result && result.ok) {
          setLearning(projectId, result.learning);
          renderLearning(result.learning);
          return;
        }
      } catch {
        // fallback to cached learning below
      }

      renderLearning(getLearning(projectId) || null);
    }

    async function openModal() {
      if (!elements.modal) return;
      setUiMode('default');
      setSelectedTopic(normalizeCortexTopic(elements.topicSelect ? elements.topicSelect.value : getSelectedTopic()));
      elements.modal.classList.remove('hidden');
      elements.modal.setAttribute('aria-hidden', 'false');
      if (elements.modeButton) elements.modeButton.classList.add('active');
      await refreshLearningPanel();
      await refreshKnowledgeRuntimeStatus();
      renderLightbox(getActiveLearning() || null);
      setTimeout(() => {
        if (elements.input) elements.input.focus();
      }, 0);
    }

    function closeModal() {
      if (!elements.modal) return;
      elements.modal.classList.add('hidden');
      elements.modal.setAttribute('aria-hidden', 'true');
      if (elements.modeButton) elements.modeButton.classList.remove('active');
    }

    function isOpen() {
      return Boolean(elements.modal && !elements.modal.classList.contains('hidden'));
    }

    function onFileInputChange() {
      if (!elements.fileInput) return;
      const files = Array.from(elements.fileInput.files || []);
      const allowed = files.filter((file) => /\.(md|markdown|txt|pdf)$/i.test(file.name || ''));
      setAttachments([...(Array.isArray(getAttachments()) ? getAttachments() : []), ...allowed].slice(-12));
      elements.fileInput.value = '';
      renderAttachments();
    }

    async function onSend() {
      if (!elements.input) return;
      const userMessage = String(elements.input.value || '').trim();
      const attachments = Array.isArray(getAttachments()) ? getAttachments() : [];
      if (!userMessage && !attachments.length) return;

      const projectId = getProjectId();
      if (!projectId) {
        renderChatMessage('assistant', t('selectProjectForCortex'));
        return;
      }

      const selectedProjectReady = await ensureProjectReady({ forceRefresh: true });
      const projectInfo = getProjectInfo();
      if (!selectedProjectReady || !projectInfo) {
        renderChatMessage('assistant', t('projectContextError'));
        return;
      }

      const topic = normalizeCortexTopic(elements.topicSelect ? elements.topicSelect.value : getSelectedTopic());
      setSelectedTopic(topic);
      const visibleMessage = userMessage || t('attachedDocs');
      renderChatMessage('user', `${getCortexTopicLabel(topic)}: ${visibleMessage}`);

      const attachmentsPayload = attachments.map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        path: file.path || '',
      }));

      const learningResult = await api.learnWithCortex({
        projectId,
        projectInfo,
        userMessage,
        attachments: attachmentsPayload,
        topic,
      });

      if (learningResult && learningResult.ok) {
        setLearning(projectId, learningResult.learning);
        setAttachments([]);
        elements.input.value = '';
        if (learningResult.knowledgeStatus) {
          setRuntimeStatus(projectId, learningResult.knowledgeStatus);
        }
        renderChatMessage('assistant', learningResult.message || t('cortexSaved'));
        renderLearning(learningResult.learning);
        renderRuntimeStatus(getRuntimeStatus(projectId) || null);
        updateStatus(t('memoryUpdated'));
        return;
      }

      renderChatMessage('assistant', (learningResult && learningResult.message) || t('cortexSaveFailed'));
    }

    async function persistTopic(action, payload) {
      const projectId = getProjectId();
      if (!projectId) {
        renderChatMessage('assistant', t('topicNeedsProject'));
        return null;
      }
      const apiMethod = action === 'rename' ? api.renameCortexTopic : api.upsertCortexTopic;
      if (typeof apiMethod !== 'function') {
        renderChatMessage('assistant', t('topicSaveFailed'));
        return null;
      }

      try {
        const result = await apiMethod({
          projectId,
          ...payload,
        });
        if (result && result.ok) {
          setLearning(projectId, result.learning);
          renderLearning(result.learning);
          return result;
        }
      } catch {
        // Fall through to a clear UI message.
      }

      renderChatMessage('assistant', t('topicSaveFailed'));
      return null;
    }

    async function onTopicAdd() {
      const label = String(await requestTextInput({
        title: t('topicNewPrompt'),
        initialValue: '',
        placeholder: t('subject'),
      }) || '').trim();
      if (!label) return;
      const id = createCortexTopicId(label);
      setSelectedTopic(id);
      const result = await persistTopic('upsert', {
        topic: { id, label },
      });
      if (result && elements.topicSelect) {
        elements.topicSelect.value = id;
        renderChatMessage('assistant', t('topicSaved'));
      }
    }

    async function onTopicRename() {
      const learning = getActiveLearning() || null;
      const topicId = normalizeCortexTopic(elements.topicSelect ? elements.topicSelect.value : getSelectedTopic());
      const currentLabel = getCortexTopicLabel(topicId, learning);
      const nextLabel = String(await requestTextInput({
        title: t('topicRenamePrompt'),
        initialValue: currentLabel,
        placeholder: t('subject'),
      }) || '').trim();
      if (!nextLabel || nextLabel === currentLabel) return;
      setSelectedTopic(topicId);
      const result = await persistTopic('rename', {
        topicId,
        label: nextLabel,
      });
      if (result) {
        renderChatMessage('assistant', t('topicRenamed'));
      }
    }

    async function learnFromComposer(payload = {}) {
      const projectId = getProjectId();
      const projectInfo = getProjectInfo();
      const learningResult = await api.learnWithCortex({
        projectId,
        projectInfo,
        userMessage: payload.userMessage || '',
        attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
        contextHint: payload.contextHint,
        conversationMessages: Array.isArray(payload.conversationMessages) ? payload.conversationMessages : [],
      });

      if (learningResult && learningResult.ok) {
        setLearning(projectId, learningResult.learning);
        if (learningResult.knowledgeStatus) {
          setRuntimeStatus(projectId, learningResult.knowledgeStatus);
        }
        renderLearning(learningResult.learning);
        renderRuntimeStatus(getRuntimeStatus(projectId) || null);
      }

      return learningResult;
    }

    function bindEvents() {
      if (elements.modeButton) {
        elements.modeButton.addEventListener('click', async () => {
          await openModal();
        });
      }
      if (elements.close) {
        elements.close.addEventListener('click', closeModal);
      }
      if (elements.backdrop) {
        elements.backdrop.addEventListener('click', closeModal);
      }
      if (elements.topicSelect) {
        elements.topicSelect.addEventListener('change', () => {
          setSelectedTopic(normalizeCortexTopic(elements.topicSelect.value));
          renderLightbox(getActiveLearning() || null);
        });
      }
      if (elements.topicAdd) {
        elements.topicAdd.addEventListener('click', onTopicAdd);
      }
      if (elements.topicRename) {
        elements.topicRename.addEventListener('click', onTopicRename);
      }
      if (elements.attach && elements.fileInput) {
        elements.attach.addEventListener('click', () => {
          elements.fileInput.click();
        });
      }
      if (elements.libraryAttach && elements.fileInput) {
        elements.libraryAttach.addEventListener('click', () => {
          elements.fileInput.click();
        });
      }
      if (elements.fileInput) {
        elements.fileInput.addEventListener('change', onFileInputChange);
      }
      if (elements.send) {
        elements.send.addEventListener('click', onSend);
      }
      if (elements.input) {
        elements.input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSend();
          }
        });
      }
    }

    return {
      bindEvents,
      closeModal,
      isOpen,
      learnFromComposer,
      normalizeTopic: normalizeCortexTopic,
      openModal,
      refreshKnowledgeRuntimeStatus,
      refreshLearningPanel,
      renderLearning,
      renderRuntimeStatus,
    };
  }

  window.FaberCortex = {
    createCortexController,
    getCortexLearningParts,
    normalizeCortexTopic,
  };
})();
