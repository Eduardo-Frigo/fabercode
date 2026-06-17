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
      contextDiagnostics: document.getElementById('cortex-context-diagnostics'),
      topicList: document.getElementById('cortex-topic-list'),
      runtimeStatus: document.getElementById('cortex-runtime-status'),
      topicAdd: document.getElementById('cortex-topic-add'),
      topicRename: document.getElementById('cortex-topic-rename'),
      memoryRefresh: document.getElementById('cortex-memory-refresh'),
      memoryReindex: document.getElementById('cortex-memory-reindex'),
      memorySearch: document.getElementById('cortex-memory-search'),
      memoryStatusFilter: document.getElementById('cortex-memory-status-filter'),
      memoryAuditList: document.getElementById('cortex-memory-audit-list'),
      libraryAttach: document.getElementById('cortex-library-attach'),
    };
    let managedMemoryRecords = [];
    let memoryAuditEntries = [];

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
      elements.chatLog.textContent = '';
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

    function formatMemoryStatusLabel(status = '') {
      const normalized = String(status || '').trim().toLowerCase();
      if (normalized === 'promoted') return 'promovida';
      if (normalized === 'expired') return 'expirada';
      if (normalized === 'deleted') return 'apagada';
      return 'ativa';
    }

    function getFallbackMemoryRecords(events = []) {
      return (Array.isArray(events) ? events : [])
        .filter((event) => event && (event.text || event.summary || event.fileName))
        .slice()
        .reverse()
        .map((event, index) => ({
          id: event.memoryId || event.id || `fallback-${index}`,
          memoryId: event.memoryId || event.id || `fallback-${index}`,
          type: event.type || 'cortex.memory',
          title: event.title || event.fileName || (event.type === 'cortex.user_input' ? 'Entrada do usuário' : t('document')),
          topic: normalizeCortexTopic(event.topic),
          text: event.text || event.summary || event.fileName || '',
          status: event.status || 'active',
          promoted: Boolean(event.promoted || event.status === 'promoted'),
          expiresAt: event.expiresAt || null,
        }));
    }

    function createMemoryActionButton(memory, action, symbol, label) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cortex-memory-action';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.textContent = symbol;
      button.addEventListener('click', async () => {
        await runMemoryItemAction(memory, action);
      });
      return button;
    }

    function renderLibrary(events) {
      if (!elements.libraryList) return;
      elements.libraryList.innerHTML = '';
      const rawRecords = managedMemoryRecords.length ? managedMemoryRecords : getFallbackMemoryRecords(events);
      const search = elements.memorySearch ? String(elements.memorySearch.value || '').trim().toLowerCase() : '';
      const statusFilter = elements.memoryStatusFilter ? String(elements.memoryStatusFilter.value || 'all') : 'all';
      const records = rawRecords.filter((memory) => {
        const status = String(memory.status || 'active').toLowerCase();
        const effectiveStatus = memory.promoted || status === 'promoted' ? 'promoted' : status === 'expired' ? 'expired' : 'active';
        if (statusFilter !== 'all' && effectiveStatus !== statusFilter) return false;
        if (!search) return true;
        const corpus = [
          memory.title,
          memory.topic,
          memory.status,
          memory.text,
          memory.summary,
          memory.source,
        ].join(' ').toLowerCase();
        return corpus.includes(search);
      });

      if (!records.length) {
        const empty = document.createElement('div');
        empty.className = 'cortex-empty-state';
        empty.textContent = rawRecords.length ? 'Nenhuma memória combina com os filtros.' : t('noLibraryDocs');
        elements.libraryList.appendChild(empty);
        return;
      }

      records.slice(0, 24).forEach((memory) => {
        const item = document.createElement('article');
        item.className = `cortex-library-item${memory.status === 'expired' ? ' expired' : ''}${memory.promoted ? ' promoted' : ''}`;

        const head = document.createElement('div');
        head.className = 'cortex-library-item__head';

        const title = document.createElement('strong');
        title.textContent = memory.title || t('document');

        const topic = document.createElement('span');
        topic.textContent = getCortexTopicLabel(memory.topic);

        const status = document.createElement('span');
        status.className = `cortex-memory-status ${memory.status || 'active'}`;
        status.textContent = formatMemoryStatusLabel(memory.status);

        const summary = document.createElement('p');
        summary.textContent = memory.text || memory.summary || t('docRegistered');

        const actions = document.createElement('div');
        actions.className = 'cortex-memory-actions';
        actions.append(
          createMemoryActionButton(memory, 'edit', '✎', 'Editar memória'),
          createMemoryActionButton(memory, 'promote', '↑', 'Promover memória'),
          createMemoryActionButton(memory, 'expire', '⏱', 'Expirar memória'),
          createMemoryActionButton(memory, 'delete', '×', 'Apagar memória')
        );

        head.append(title, topic, status);
        item.append(head, summary, actions);
        elements.libraryList.appendChild(item);
      });
    }

    function renderMemoryAudit(entries = []) {
      if (!elements.memoryAuditList) return;
      elements.memoryAuditList.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'cortex-memory-audit-title';
      title.innerHTML = '<strong>Auditoria</strong><span>Histórico recente de memória, lifecycle e provenance</span>';
      elements.memoryAuditList.appendChild(title);
      const source = Array.isArray(entries) ? entries.slice(0, 10) : [];
      if (!source.length) {
        const empty = document.createElement('div');
        empty.className = 'cortex-empty-state';
        empty.textContent = 'Nenhum evento auditável de memória registrado ainda.';
        elements.memoryAuditList.appendChild(empty);
        return;
      }
      source.forEach((entry) => {
        const item = document.createElement('article');
        item.className = `cortex-memory-audit-item ${entry.ok === false ? 'failed' : 'ok'}`;
        const head = document.createElement('div');
        head.className = 'cortex-memory-audit-item__head';
        const action = document.createElement('strong');
        action.textContent = String(entry.action || 'memory_event').replace(/_/g, ' ');
        const status = document.createElement('span');
        status.textContent = entry.status || (entry.ok === false ? 'failed' : 'succeeded');
        head.append(action, status);
        const detail = document.createElement('p');
        const provenance = entry.provenance || {};
        const used = Array.isArray(provenance.used) ? provenance.used.length : 0;
        const blocked = Array.isArray(provenance.blocked) ? provenance.blocked.length : 0;
        const lifecycleAction = entry.lifecycle && entry.lifecycle.action ? ` · lifecycle ${entry.lifecycle.action}` : '';
        detail.textContent = `${entry.message || 'Evento registrado.'}${used || blocked ? ` · ${used} usadas / ${blocked} bloqueadas` : ''}${lifecycleAction}`;
        const foot = document.createElement('small');
        foot.textContent = entry.createdAt ? new Date(entry.createdAt).toLocaleString(getInterfaceLanguage() || 'pt-BR') : '';
        item.append(head, detail, foot);
        elements.memoryAuditList.appendChild(item);
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
          label: 'Embedding',
          ok: Boolean(source && source.embedding && source.embedding.ready),
          text: source && source.embedding
            ? `${source.embedding.provider || 'local'} · ${source.embedding.model || source.embedding.reason || 'ranking semântico'}`
            : 'local · ranking semântico',
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

    function formatContextSourceLabel(value) {
      const source = String(value || '').trim();
      if (source === 'current_message') return 'mensagem atual';
      if (source === 'conversation_brief') return 'briefing da conversa';
      if (source === 'active_memory') return 'memória ativa';
      if (source === 'project_files') return 'arquivos do projeto';
      if (source === 'current_message_or_conversation') return 'mensagem/conversa';
      return source || 'indefinido';
    }

    function createContextPills(values = [], className = '') {
      const wrap = document.createElement('div');
      wrap.className = 'cortex-context-pills';
      (Array.isArray(values) && values.length ? values : ['nenhuma']).forEach((value) => {
        const pill = document.createElement('span');
        pill.className = `cortex-context-pill${className ? ` ${className}` : ''}`;
        pill.textContent = formatContextSourceLabel(value);
        wrap.appendChild(pill);
      });
      return wrap;
    }

    function renderMemoryDiagnostics(entriesResult = null, status = null) {
      if (!elements.contextDiagnostics) return;
      elements.contextDiagnostics.innerHTML = '';
      const entries = entriesResult && Array.isArray(entriesResult.entries) ? entriesResult.entries : [];
      memoryAuditEntries = entries;
      const latestContext = entries.find((entry) => entry && entry.contextFrame) || null;
      const latestProvenance = entries.find((entry) => entry && entry.provenance) || null;
      const statusItem = document.createElement('article');
      statusItem.className = 'cortex-context-item';
      const statusTitle = document.createElement('strong');
      statusTitle.textContent = 'Runtime';
      const statusText = document.createElement('p');
      const mode = status && status.mode ? status.mode : 'local_only';
      const warnings = status && Array.isArray(status.warnings) ? status.warnings.length : 0;
      statusText.textContent = `${mode}${warnings ? ` · ${warnings} pendência(s)` : ''}`;
      statusItem.append(statusTitle, statusText);
      elements.contextDiagnostics.appendChild(statusItem);

      if (latestContext && latestContext.contextFrame) {
        const frame = latestContext.contextFrame;
        const item = document.createElement('article');
        item.className = `cortex-context-item${frame.confirmation && frame.confirmation.required ? ' warning' : ''}`;
        const title = document.createElement('strong');
        title.textContent = `Fonte dominante: ${formatContextSourceLabel(frame.dominantSource)}`;
        const summary = document.createElement('p');
        const active = frame.activeMemory || {};
        summary.textContent = active.suppressed
          ? `Memória suprimida: ${active.suppressionReason || 'sem motivo informado'}`
          : active.allowedForBriefing || active.allowedForRouting
            ? `Memória usada com ${Number(active.citationsCount || 0)} citação(ões)`
            : 'Memória não usada nesta decisão';
        item.append(title, summary);
        item.appendChild(createContextPills(frame.allowedSources || [], 'ready'));
        if (Array.isArray(frame.blockedSources) && frame.blockedSources.length) {
          item.appendChild(createContextPills(frame.blockedSources, 'blocked'));
        }
        elements.contextDiagnostics.appendChild(item);
      }

      if (latestProvenance && latestProvenance.provenance) {
        const provenance = latestProvenance.provenance;
        const used = Array.isArray(provenance.used) ? provenance.used : [];
        const blocked = Array.isArray(provenance.blocked) ? provenance.blocked : [];
        const item = document.createElement('article');
        item.className = 'cortex-context-item';
        const title = document.createElement('strong');
        const confidence = provenance.confidence && Number.isFinite(Number(provenance.confidence.average))
          ? Math.round(Number(provenance.confidence.average) * 100)
          : 0;
        const semantic = provenance.confidence && Number.isFinite(Number(provenance.confidence.semanticAverage))
          ? Math.round(Number(provenance.confidence.semanticAverage) * 100)
          : 0;
        title.textContent = `Provenance: ${used.length} usada(s), ${blocked.length} bloqueada(s)`;
        const summary = document.createElement('p');
        summary.textContent = `Confiança média ${confidence}%; vetor ${semantic}%. ${latestProvenance.message || ''}`.trim();
        item.append(title, summary);
        item.appendChild(createContextPills(used.slice(0, 5).map((entry) => entry.title || entry.sourceType), 'ready'));
        elements.contextDiagnostics.appendChild(item);
      }

      if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'cortex-empty-state';
        empty.textContent = 'Nenhuma evidência de memória registrada para este projeto ainda.';
        elements.contextDiagnostics.appendChild(empty);
      }
      renderMemoryAudit(entries);
    }

    async function refreshMemoryDiagnostics(status = null) {
      const projectInfo = getProjectInfo();
      if (!projectInfo || !api.listMemoryEvidence) {
        renderMemoryDiagnostics(null, status || getRuntimeStatus(getProjectId()) || null);
        return null;
      }
      try {
        const result = await api.listMemoryEvidence({
          projectInfo,
          limit: 12,
        });
        renderMemoryDiagnostics(result, status || getRuntimeStatus(getProjectId()) || null);
        return result;
      } catch {
        renderMemoryDiagnostics(null, status || getRuntimeStatus(getProjectId()) || null);
        return null;
      }
    }

    async function refreshManagedMemories() {
      const projectId = getProjectId();
      const projectInfo = getProjectInfo();
      if (!projectId || !projectInfo || typeof api.runKnowledgeMemoryLifecycle !== 'function') {
        managedMemoryRecords = [];
        renderLibrary(getCortexLearningParts(getActiveLearning() || null).events);
        return null;
      }
      try {
        const result = await api.runKnowledgeMemoryLifecycle({
          action: 'list',
          projectId,
          projectInfo,
          includeExpired: true,
          limit: 80,
        });
        managedMemoryRecords = result && Array.isArray(result.memories) ? result.memories : [];
        renderLibrary(getCortexLearningParts(getActiveLearning() || null).events);
        return result;
      } catch {
        managedMemoryRecords = [];
        renderLibrary(getCortexLearningParts(getActiveLearning() || null).events);
        return null;
      }
    }

    async function runMemoryLifecycle(payload = {}) {
      const projectId = getProjectId();
      const projectInfo = getProjectInfo();
      if (!projectId || !projectInfo || typeof api.runKnowledgeMemoryLifecycle !== 'function') {
        renderChatMessage('assistant', 'Lifecycle de memória indisponível para este projeto.');
        return null;
      }
      try {
        const result = await api.runKnowledgeMemoryLifecycle({
          projectId,
          projectInfo,
          ...payload,
        });
        if (result && result.learning) {
          setLearning(projectId, result.learning);
        }
        await refreshLearningPanel();
        await refreshKnowledgeRuntimeStatus();
        await refreshManagedMemories();
        renderChatMessage('assistant', (result && result.message) || 'Operação de memória executada.');
        updateStatus((result && result.message) || 'Memória atualizada.');
        return result;
      } catch {
        renderChatMessage('assistant', 'Não foi possível executar a operação de memória.');
        return null;
      }
    }

    async function runMemoryItemAction(memory, action) {
      const memoryId = memory && (memory.memoryId || memory.id);
      if (!memoryId) return;
      if (action === 'edit') {
        const nextText = String(await requestTextInput({
          title: 'Editar memória',
          initialValue: memory.text || memory.summary || '',
          placeholder: 'Conteúdo da memória',
        }) || '').trim();
        if (!nextText || nextText === String(memory.text || memory.summary || '').trim()) return;
        await runMemoryLifecycle({
          action: 'edit',
          memoryId,
          text: nextText,
          topic: memory.topic || getSelectedTopic(),
        });
        return;
      }
      if (action === 'delete') {
        const confirmed = !window.faberConfirm || await window.faberConfirm('Apagar esta memória do Cortex?');
        if (!confirmed) return;
      }
      await runMemoryLifecycle({
        action,
        memoryId,
        topic: memory.topic || getSelectedTopic(),
        expiresAt: action === 'expire' ? new Date().toISOString() : memory.expiresAt || null,
      });
    }

    async function reindexMemoryBackends() {
      await runMemoryLifecycle({
        action: 'reindex',
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
      renderMemoryDiagnostics(null, getRuntimeStatus(getProjectId()) || null);
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
          await refreshMemoryDiagnostics(result);
          await refreshManagedMemories();
          return result;
        }
      } catch {
        // Status is supportive; the Cortex local memory can still work without it.
      }
      renderRuntimeStatus(getRuntimeStatus(projectId) || null);
      await refreshMemoryDiagnostics(getRuntimeStatus(projectId) || null);
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
          await refreshManagedMemories();
          return;
        }
      } catch {
        // fallback to cached learning below
      }

      renderLearning(getLearning(projectId) || null);
      await refreshManagedMemories();
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
        await refreshManagedMemories();
        await refreshMemoryDiagnostics(getRuntimeStatus(projectId) || null);
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
        await refreshManagedMemories();
        await refreshMemoryDiagnostics(getRuntimeStatus(projectId) || null);
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
      if (elements.memoryRefresh) {
        elements.memoryRefresh.addEventListener('click', refreshManagedMemories);
      }
      if (elements.memoryReindex) {
        elements.memoryReindex.addEventListener('click', reindexMemoryBackends);
      }
      if (elements.memorySearch) {
        elements.memorySearch.addEventListener('input', () => {
          renderLibrary(getCortexLearningParts(getActiveLearning() || null).events);
        });
      }
      if (elements.memoryStatusFilter) {
        elements.memoryStatusFilter.addEventListener('change', () => {
          renderLibrary(getCortexLearningParts(getActiveLearning() || null).events);
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
      renderMemoryDiagnostics,
      renderMemoryAudit,
      renderRuntimeStatus,
    };
  }

  window.FaberCortex = {
    createCortexController,
    getCortexLearningParts,
    normalizeCortexTopic,
  };
})();
