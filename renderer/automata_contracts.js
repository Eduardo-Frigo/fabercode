(function () {
  const ACTIONABLE_STATUSES = new Set(['suggest_blueprint', 'staged', 'trial_passed']);

  function safeJson(value) {
    try {
      return JSON.stringify(value || {}, null, 2);
    } catch {
      return '{}';
    }
  }

  function statusLabel(status = '') {
    const value = String(status || '');
    if (value === 'suggest_blueprint') return 'Sugerido';
    if (value === 'staged') return 'Staged';
    if (value === 'trial_running') return 'Em teste';
    if (value === 'trial_passed') return 'Funcionou';
    if (value === 'trial_failed') return 'Falhou';
    if (value === 'local_active') return 'Ativo local';
    if (value === 'local_disabled') return 'Desativado';
    if (value === 'rejected') return 'Recusado';
    return value || 'Pendente';
  }

  function createAutomataContractsController(options = {}) {
    const api = options.api || {};
    const appendMessage = typeof options.appendMessage === 'function' ? options.appendMessage : () => {};
    const getProjectInfo = typeof options.getProjectInfo === 'function' ? options.getProjectInfo : () => null;
    const getProjectId = typeof options.getProjectId === 'function' ? options.getProjectId : () => null;
    const updateStatus = typeof options.updateStatus === 'function' ? options.updateStatus : () => {};
    const onVisibilityChange = typeof options.onVisibilityChange === 'function' ? options.onVisibilityChange : () => {};

    const elements = {
      chatLog: document.getElementById('chat-log'),
      button: document.getElementById('btn-automata-contracts'),
      badge: document.getElementById('automata-contracts-count'),
      panel: document.getElementById('automata-contract-ledger-panel'),
      backdrop: document.getElementById('automata-contract-ledger-backdrop'),
      close: document.getElementById('automata-contract-ledger-close'),
      list: document.getElementById('automata-contract-ledger-list'),
      pushSelected: document.getElementById('automata-contract-ledger-push-selected'),
      empty: document.getElementById('automata-contract-ledger-empty'),
    };

    const selectedForPush = new Set();

    function projectPayload() {
      return {
        projectId: getProjectId(),
        projectInfo: getProjectInfo(),
      };
    }

    function setBadge(count = 0) {
      if (!elements.button || !elements.badge) return;
      const safeCount = Math.max(0, Number(count || 0));
      elements.badge.textContent = String(safeCount);
      elements.badge.classList.toggle('hidden', safeCount <= 0);
      elements.button.classList.toggle('has-staged-contracts', safeCount > 0);
      elements.button.setAttribute(
        'aria-label',
        safeCount > 0
          ? `${safeCount} contrato(s) Automata aguardando revisao`
          : 'Contratos Automata'
      );
    }

    async function refreshSummary() {
      if (!api.getAutomataContractSummary) return null;
      const payload = projectPayload();
      if (!payload.projectId && !(payload.projectInfo && payload.projectInfo.rootPath)) {
        setBadge(0);
        return null;
      }
      try {
        const summary = await api.getAutomataContractSummary(payload);
        const actionable = summary && summary.ok ? Number(summary.actionable || 0) : 0;
        setBadge(actionable);
        return summary;
      } catch {
        setBadge(0);
        return null;
      }
    }

    function setPreviewState(container, status, text) {
      const statusEl = container ? container.querySelector('[data-contract-status]') : null;
      if (statusEl) statusEl.textContent = statusLabel(status);
      const noteEl = container ? container.querySelector('[data-contract-note]') : null;
      if (noteEl) noteEl.textContent = text || '';
    }

    function appendContractPreview(entry) {
      if (!entry || !entry.id || !elements.chatLog) return null;
      const contract = entry.contract || {};
      const wrap = document.createElement('div');
      wrap.className = 'automata-contract-preview';
      wrap.dataset.ledgerId = entry.id;

      const head = document.createElement('div');
      head.className = 'automata-contract-preview__head';

      const titleWrap = document.createElement('div');
      const eyebrow = document.createElement('span');
      eyebrow.className = 'automata-contract-preview__eyebrow';
      eyebrow.textContent = 'Automata Contract';
      const title = document.createElement('strong');
      title.textContent = entry.title || contract.title || 'Contrato temporario';
      titleWrap.append(eyebrow, title);

      const status = document.createElement('span');
      status.className = 'automata-contract-preview__status';
      status.dataset.contractStatus = '1';
      status.textContent = statusLabel(entry.status);
      head.append(titleWrap, status);

      const copy = document.createElement('p');
      copy.className = 'automata-contract-preview__copy';
      copy.textContent =
        'A proposta fica local e nao altera arquivos agora. Aprove para staged se quiser testar este comportamento no projeto.';

      const details = document.createElement('details');
      details.className = 'automata-contract-preview__details';
      const summary = document.createElement('summary');
      summary.textContent = 'Ver contrato temporario';
      const pre = document.createElement('pre');
      pre.textContent = safeJson(contract.proposedContract || contract);
      details.append(summary, pre);

      const actions = document.createElement('div');
      actions.className = 'automata-contract-preview__actions';
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'automata-contract-preview__primary';
      approve.textContent = 'Aprovar para staged';
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'automata-contract-preview__ghost';
      reject.textContent = 'Recusar';
      const note = document.createElement('span');
      note.className = 'automata-contract-preview__note';
      note.dataset.contractNote = '1';
      actions.append(approve, reject, note);

      approve.addEventListener('click', async () => {
        if (!api.stageAutomataContract) return;
        approve.disabled = true;
        reject.disabled = true;
        const result = await api.stageAutomataContract({
          id: entry.id,
          note: 'Aprovado no chat para teste staged.',
        });
        if (result && result.ok) {
          setPreviewState(wrap, result.entry.status, 'Agora esta em staged. Teste no projeto e depois promova pelo painel.');
          updateStatus('Contrato Automata em staged.');
          await refreshSummary();
        } else {
          approve.disabled = false;
          reject.disabled = false;
          setPreviewState(wrap, entry.status, (result && result.reason) || 'Nao consegui mover para staged.');
        }
      });

      reject.addEventListener('click', async () => {
        if (!api.rejectAutomataContract) return;
        approve.disabled = true;
        reject.disabled = true;
        const result = await api.rejectAutomataContract({
          id: entry.id,
          note: 'Recusado no chat.',
        });
        if (result && result.ok) {
          setPreviewState(wrap, result.entry.status, 'Contrato recusado. Nada foi alterado.');
          await refreshSummary();
        } else {
          approve.disabled = false;
          reject.disabled = false;
          setPreviewState(wrap, entry.status, (result && result.reason) || 'Nao consegui recusar este contrato.');
        }
      });

      wrap.append(head, copy, details, actions);
      elements.chatLog.appendChild(wrap);
      elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
      onVisibilityChange();
      refreshSummary();
      return wrap;
    }

    function openPanel() {
      if (!elements.panel) return;
      elements.panel.classList.remove('hidden');
      elements.panel.setAttribute('aria-hidden', 'false');
      refreshPanel();
    }

    function closePanel() {
      if (!elements.panel) return;
      elements.panel.classList.add('hidden');
      elements.panel.setAttribute('aria-hidden', 'true');
    }

    function createEntryRow(entry) {
      const row = document.createElement('div');
      row.className = 'automata-ledger-row';

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'automata-ledger-row__check';
      check.disabled = entry.status !== 'trial_passed';
      check.checked = selectedForPush.has(entry.id);
      check.addEventListener('change', () => {
        if (check.checked) selectedForPush.add(entry.id);
        else selectedForPush.delete(entry.id);
      });

      const body = document.createElement('div');
      body.className = 'automata-ledger-row__body';
      const title = document.createElement('strong');
      title.textContent = entry.title || (entry.contract && entry.contract.title) || 'Contrato temporario';
      const meta = document.createElement('span');
      meta.textContent = `${statusLabel(entry.status)} · ${entry.contractId || 'sem id'}`;
      const details = document.createElement('details');
      details.className = 'automata-ledger-row__details';
      const summary = document.createElement('summary');
      summary.textContent = 'Contrato';
      const pre = document.createElement('pre');
      pre.textContent = safeJson((entry.contract && entry.contract.proposedContract) || entry.contract || {});
      details.append(summary, pre);
      body.append(title, meta, details);

      const actions = document.createElement('div');
      actions.className = 'automata-ledger-row__actions';
      const worked = document.createElement('button');
      worked.type = 'button';
      worked.textContent = 'Funcionou';
      worked.disabled = entry.status !== 'staged' && entry.status !== 'trial_running';
      worked.addEventListener('click', async () => {
        if (!api.markAutomataContractTrial) return;
        await api.markAutomataContractTrial({ id: entry.id, passed: true, note: 'Marcado como aprovado pelo usuario.' });
        await refreshPanel();
        await refreshSummary();
      });

      const failed = document.createElement('button');
      failed.type = 'button';
      failed.textContent = 'Falhou';
      failed.disabled = entry.status !== 'staged' && entry.status !== 'trial_running';
      failed.addEventListener('click', async () => {
        if (!api.markAutomataContractTrial) return;
        await api.markAutomataContractTrial({ id: entry.id, passed: false, note: 'Marcado como falhou pelo usuario.' });
        await refreshPanel();
        await refreshSummary();
      });

      const push = document.createElement('button');
      push.type = 'button';
      push.textContent = 'Push local';
      push.disabled = entry.status !== 'trial_passed';
      push.addEventListener('click', async () => {
        if (!api.promoteAutomataContract) return;
        await api.promoteAutomataContract({ id: entry.id, note: 'Promovido pelo painel do usuario.' });
        selectedForPush.delete(entry.id);
        appendMessage('assistant', 'Contrato Automata promovido para local_active.', { persistToConversation: false });
        await refreshPanel();
        await refreshSummary();
      });

      const reject = document.createElement('button');
      reject.type = 'button';
      reject.textContent = 'Recusar';
      reject.addEventListener('click', async () => {
        if (!api.rejectAutomataContract) return;
        await api.rejectAutomataContract({ id: entry.id, note: 'Recusado pelo painel do usuario.' });
        selectedForPush.delete(entry.id);
        await refreshPanel();
        await refreshSummary();
      });

      actions.append(worked, failed, push, reject);
      row.append(check, body, actions);
      return row;
    }

    async function refreshPanel() {
      if (!elements.list || !api.listAutomataContracts) return;
      elements.list.innerHTML = '';
      const payload = projectPayload();
      if (!payload.projectId && !(payload.projectInfo && payload.projectInfo.rootPath)) {
        elements.empty.classList.remove('hidden');
        return;
      }
      const result = await api.listAutomataContracts({
        ...payload,
        includeRejected: false,
      });
      const entries = result && result.ok && Array.isArray(result.entries) ? result.entries : [];
      const visibleEntries = entries.filter((entry) =>
        ['suggest_blueprint', 'staged', 'trial_running', 'trial_passed', 'trial_failed', 'local_active'].includes(entry.status)
      );
      elements.empty.classList.toggle('hidden', visibleEntries.length > 0);
      visibleEntries.forEach((entry) => {
        elements.list.appendChild(createEntryRow(entry));
      });
    }

    async function pushSelected() {
      if (!api.promoteAutomataContract || !selectedForPush.size) return;
      const ids = Array.from(selectedForPush);
      for (const id of ids) {
        await api.promoteAutomataContract({ id, note: 'Promovido em lote pelo painel do usuario.' });
        selectedForPush.delete(id);
      }
      appendMessage('assistant', 'Contratos Automata selecionados promovidos para local_active.', { persistToConversation: false });
      await refreshPanel();
      await refreshSummary();
    }

    function bindEvents() {
      if (elements.button) elements.button.addEventListener('click', openPanel);
      if (elements.close) elements.close.addEventListener('click', closePanel);
      if (elements.backdrop) elements.backdrop.addEventListener('click', closePanel);
      if (elements.pushSelected) elements.pushSelected.addEventListener('click', pushSelected);
    }

    function reset() {
      selectedForPush.clear();
      setBadge(0);
      closePanel();
    }

    return {
      appendContractPreview,
      bindEvents,
      closePanel,
      openPanel,
      refreshPanel,
      refreshSummary,
      reset,
      statusLabel,
    };
  }

  window.FaberAutomataContracts = {
    createAutomataContractsController,
    statusLabel,
  };
})();
