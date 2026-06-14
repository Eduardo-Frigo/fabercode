(function () {
  const BASE_TEXTAREA_HEIGHT = 84;
  const MAX_TEXTAREA_HEIGHT = Math.round(BASE_TEXTAREA_HEIGHT * 1.5);

  function createChatComposerController(options = {}) {
    const api = options.api || {};
    const getProjectInfo = typeof options.getProjectInfo === 'function' ? options.getProjectInfo : () => null;
    const getAttachments = typeof options.getAttachments === 'function' ? options.getAttachments : () => [];
    const setAttachments = typeof options.setAttachments === 'function' ? options.setAttachments : () => {};
    const onVisibilityChange = typeof options.onVisibilityChange === 'function' ? options.onVisibilityChange : () => {};

    const elements = {
      chatLog: document.getElementById('chat-log'),
      input: document.getElementById('user-input'),
      imageInput: document.getElementById('image-input'),
      attachmentList: document.getElementById('attachment-list'),
      attachButton: document.getElementById('btn-attach'),
      changeSummary: document.getElementById('change-summary-strip'),
      modificationAlert: document.getElementById('modification-alert'),
    };

    let thinkingBubbleEl = null;

    function resetTextareaHeight() {
      if (!elements.input) return;
      elements.input.style.height = `${BASE_TEXTAREA_HEIGHT}px`;
      elements.input.style.overflowY = 'hidden';
    }

    function autoResizeTextarea() {
      if (!elements.input) return;
      elements.input.style.height = `${BASE_TEXTAREA_HEIGHT}px`;
      const targetHeight = Math.max(BASE_TEXTAREA_HEIGHT, Math.min(elements.input.scrollHeight, MAX_TEXTAREA_HEIGHT));
      elements.input.style.height = `${targetHeight}px`;
      elements.input.style.overflowY = elements.input.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
    }

    function scrollToBottom() {
      if (!elements.chatLog) return;
      const view = elements.chatLog.ownerDocument && elements.chatLog.ownerDocument.defaultView
        ? elements.chatLog.ownerDocument.defaultView
        : window;
      const applyScroll = () => {
        elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
      };
      applyScroll();
      if (typeof view.requestAnimationFrame === 'function') {
        view.requestAnimationFrame(() => {
          applyScroll();
          view.setTimeout(applyScroll, 0);
        });
      } else {
        view.setTimeout(applyScroll, 0);
      }
    }

    function hasMessages() {
      return Boolean(elements.chatLog && elements.chatLog.children.length > 0);
    }

    function clearMessages() {
      if (elements.chatLog) elements.chatLog.innerHTML = '';
      thinkingBubbleEl = null;
      clearChangeSummary();
      onVisibilityChange();
    }

    function renderAttachments() {
      if (!elements.attachmentList) return;
      elements.attachmentList.innerHTML = '';

      const attachments = Array.isArray(getAttachments()) ? getAttachments() : [];
      if (!attachments.length) {
        elements.attachmentList.classList.add('hidden');
        return;
      }

      elements.attachmentList.classList.remove('hidden');

      attachments.forEach((file, index) => {
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
          const next = (Array.isArray(getAttachments()) ? getAttachments() : []).slice();
          next.splice(index, 1);
          setAttachments(next);
          renderAttachments();
        };

        if (file.path && (file.type.startsWith('image/') || file.path.match(/\.(png|jpe?g|gif|webp)$/i))) {
          const img = document.createElement('img');
          img.className = 'attachment-thumb';
          img.src = `file://${file.path}`;
          chip.append(img);
        }

        chip.append(name, remove);
        elements.attachmentList.appendChild(chip);
      });
    }

    function addImageFiles(fileList) {
      const incoming = Array.from(fileList || []);
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
      if (!allowed.length) return;
      setAttachments([...(Array.isArray(getAttachments()) ? getAttachments() : []), ...allowed]);
      renderAttachments();
    }

    function renderMessageBubble(role, text, attachments = []) {
      if (!elements.chatLog) return null;
      const div = document.createElement('div');
      div.className = `msg ${role}`;
      div.textContent = text;
      
      if (attachments && attachments.length > 0) {
        const attachContainer = document.createElement('div');
        attachContainer.className = 'msg-attachments';
        attachContainer.style.display = 'flex';
        attachContainer.style.gap = '8px';
        attachContainer.style.marginTop = '8px';
        attachContainer.style.flexWrap = 'wrap';

        attachments.forEach(att => {
          if (att.path && (att.type.startsWith('image/') || att.path.match(/\.(png|jpe?g|gif|webp)$/i))) {
            const img = document.createElement('img');
            img.src = `file://${att.path}`;
            img.style.maxHeight = '120px';
            img.style.maxWidth = '100%';
            img.style.borderRadius = '4px';
            attachContainer.appendChild(img);
          } else {
            const pill = document.createElement('div');
            pill.className = 'attachment-chip';
            pill.textContent = att.name || 'Anexo';
            attachContainer.appendChild(pill);
          }
        });
        div.appendChild(attachContainer);
      }
      
      elements.chatLog.appendChild(div);
      return div;
    }

    function renderSystemNotice(text) {
      if (!elements.chatLog) return null;
      const div = document.createElement('div');
      div.className = 'chat-system-notice';
      div.textContent = text;
      elements.chatLog.appendChild(div);
      return div;
    }

    function clearSystemNotices() {
      if (!elements.chatLog) return;
      elements.chatLog.querySelectorAll('.chat-system-notice').forEach((node) => node.remove());
      onVisibilityChange();
    }

    function hasRecentAssistantMessage(text, limit = 8) {
      if (!elements.chatLog) return false;
      const nextText = String(text || '').trim();
      if (!nextText) return false;
      const children = Array.from(elements.chatLog.children || []);
      let scanned = 0;
      for (let idx = children.length - 1; idx >= 0 && scanned < limit; idx -= 1) {
        const node = children[idx];
        if (!node || !node.classList || !node.classList.contains('msg')) continue;
        if (!node.classList.contains('assistant')) continue;
        scanned += 1;
        const lastText = String(node.textContent || '').trim();
        if (lastText && lastText === nextText) return true;
      }
      return false;
    }

    function showThinkingIndicator() {
      if (thinkingBubbleEl) return thinkingBubbleEl;
      if (!elements.chatLog) return null;

      const bubble = document.createElement('div');
      bubble.className = 'msg assistant thinking';
      bubble.setAttribute('aria-live', 'polite');
      bubble.innerHTML =
        '<span class="thinking-label">Pensando</span><span class="thinking-dots"><span></span><span></span><span></span></span>';

      elements.chatLog.appendChild(bubble);
      scrollToBottom();
      thinkingBubbleEl = bubble;
      onVisibilityChange();
      return bubble;
    }

    function hideThinkingIndicator() {
      if (thinkingBubbleEl && thinkingBubbleEl.parentNode) {
        thinkingBubbleEl.parentNode.removeChild(thinkingBubbleEl);
      }
      thinkingBubbleEl = null;
      onVisibilityChange();
    }

    function normalizeDiffStat(stat = {}) {
      return {
        add: Math.max(0, Number(stat.add || stat.added || 0) || 0),
        del: Math.max(0, Number(stat.del || stat.removed || 0) || 0),
      };
    }

    function summarizeResultDiff(result = {}) {
      const diffStats = result && result.diffStats && typeof result.diffStats === 'object'
        ? result.diffStats
        : {};
      const files = Array.isArray(result && result.modifiedFiles)
        ? result.modifiedFiles.map((file) => String(file || '').trim()).filter(Boolean)
        : [];
      const statFiles = Object.keys(diffStats).filter(Boolean);
      const mergedFiles = [...new Set([...files, ...statFiles])];
      let add = 0;
      let del = 0;
      Object.values(diffStats).forEach((stat) => {
        const normalized = normalizeDiffStat(stat);
        add += normalized.add;
        del += normalized.del;
      });
      return {
        files: mergedFiles,
        fileCount: mergedFiles.length,
        add,
        del,
      };
    }

    function appendChangeCard(action, result) {
      const summary = summarizeResultDiff(result || {});
      const targetFile = action && action.targetFile
        ? action.targetFile
        : summary.files[0] || '';
      if (!elements.chatLog || !targetFile) return null;

      const card = document.createElement('div');
      card.className = 'change-card';

      const header = document.createElement('div');
      header.className = 'change-card-header';

      const fileBtn = document.createElement('button');
      fileBtn.type = 'button';
      fileBtn.className = 'change-card-file';
      fileBtn.textContent = summary.fileCount > 1
        ? `${summary.fileCount} arquivos alterados`
        : targetFile;
      fileBtn.title = 'Abrir no Finder';
      fileBtn.onclick = async () => {
        if (!api.revealFileInFolder) return;
        await api.revealFileInFolder({
          projectInfo: getProjectInfo(),
          relativePath: targetFile,
        });
      };

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'change-card-toggle';
      toggle.textContent = 'Expandir código';

      const body = document.createElement('div');
      body.className = 'change-card-body hidden';
      const pre = document.createElement('pre');
      pre.textContent = (action && action.diffPreview) || (result && result.message) || 'Sem diff disponível.';
      body.appendChild(pre);

      toggle.onclick = () => {
        const hidden = body.classList.contains('hidden');
        body.classList.toggle('hidden', !hidden);
        toggle.textContent = hidden ? 'Recolher código' : 'Expandir código';
      };

      header.append(fileBtn, toggle);
      card.append(header, body);
      elements.chatLog.appendChild(card);
      scrollToBottom();
      showChangeSummary(action, result);
      onVisibilityChange();
      return card;
    }

    function clearChangeSummary() {
      if (!elements.changeSummary) return;
      elements.changeSummary.innerHTML = '';
      elements.changeSummary.classList.add('hidden');
    }

    function showChangeSummary(action, result) {
      if (!elements.changeSummary) return;
      const summary = summarizeResultDiff(result || {});
      if (!summary.fileCount) {
        clearChangeSummary();
        return;
      }

      elements.changeSummary.innerHTML = '';
      const label = document.createElement('div');
      label.className = 'change-summary-strip__label';
      const count = document.createElement('span');
      count.textContent = `${summary.fileCount} ${summary.fileCount === 1 ? 'arquivo alterado' : 'arquivos alterados'}`;
      label.appendChild(count);

      if (summary.add > 0) {
        const add = document.createElement('span');
        add.className = 'change-summary-strip__add';
        add.textContent = `+${summary.add}`;
        label.appendChild(add);
      }
      if (summary.del > 0) {
        const del = document.createElement('span');
        del.className = 'change-summary-strip__del';
        del.textContent = `-${summary.del}`;
        label.appendChild(del);
      }

      const fileList = document.createElement('span');
      fileList.className = 'change-summary-strip__files';
      fileList.textContent = summary.files.slice(0, 3).join(', ') + (summary.files.length > 3 ? ', ...' : '');
      label.appendChild(fileList);

      const review = document.createElement('button');
      review.type = 'button';
      review.className = 'change-summary-strip__review';
      review.textContent = 'Revisar';
      review.onclick = () => {
        const existing = elements.chatLog
          ? Array.from(elements.chatLog.querySelectorAll('.change-card')).pop()
          : null;
        const card = existing || appendChangeCard(action, result);
        if (card && typeof card.scrollIntoView === 'function') {
          card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      };

      elements.changeSummary.append(label, review);
      elements.changeSummary.classList.remove('hidden');
      onVisibilityChange();
    }

    function showModificationAlert(message) {
      if (!elements.modificationAlert) return;
      elements.modificationAlert.textContent = message;
      elements.modificationAlert.classList.remove('hidden');
      setTimeout(() => {
        elements.modificationAlert.classList.add('hidden');
      }, 9000);
    }

    function bindEvents() {
      if (elements.attachButton && elements.imageInput) {
        elements.attachButton.addEventListener('click', () => {
          elements.imageInput.click();
        });
      }
      if (elements.imageInput) {
        elements.imageInput.addEventListener('change', (event) => {
          addImageFiles(event.target.files);
          event.target.value = '';
        });
      }
      if (elements.input) {
        elements.input.addEventListener('input', autoResizeTextarea);
      }
      
      // Drag and Drop
      if (elements.chatLog) {
        const dropZone = elements.chatLog.parentElement; // chat container
        dropZone.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.style.opacity = '0.7';
        });
        dropZone.addEventListener('dragleave', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.style.opacity = '1';
        });
        dropZone.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.style.opacity = '1';
          if (e.dataTransfer && e.dataTransfer.files) {
            addImageFiles(e.dataTransfer.files);
          }
        });
      }
    }

    return {
      appendChangeCard,
      autoResizeTextarea,
      bindEvents,
      clearChangeSummary,
      clearMessages,
      clearSystemNotices,
      hasMessages,
      hasRecentAssistantMessage,
      hideThinkingIndicator,
      renderAttachments,
      renderMessageBubble,
      renderSystemNotice,
      resetTextareaHeight,
      scrollToBottom,
      showChangeSummary,
      showModificationAlert,
      showThinkingIndicator,
    };
  }

  window.FaberChatComposer = {
    createChatComposerController,
  };
})();
