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
      if (elements.chatLog) elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
    }

    function hasMessages() {
      return Boolean(elements.chatLog && elements.chatLog.children.length > 0);
    }

    function clearMessages() {
      if (elements.chatLog) elements.chatLog.innerHTML = '';
      thinkingBubbleEl = null;
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

    function renderMessageBubble(role, text) {
      if (!elements.chatLog) return null;
      const div = document.createElement('div');
      div.className = `msg ${role}`;
      div.textContent = text;
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

    function appendChangeCard(action, result) {
      if (!elements.chatLog || !action || !action.targetFile) return;

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
        if (!api.revealFileInFolder) return;
        await api.revealFileInFolder({
          projectInfo: getProjectInfo(),
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
      pre.textContent = action.diffPreview || (result && result.message) || 'Sem diff disponível.';
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
    }

    return {
      appendChangeCard,
      autoResizeTextarea,
      bindEvents,
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
      showModificationAlert,
      showThinkingIndicator,
    };
  }

  window.FaberChatComposer = {
    createChatComposerController,
  };
})();
