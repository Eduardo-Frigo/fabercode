(function () {
  function createProjectFileEditorController(options = {}) {
    const api = options.api || {};
    const elements = {
      modal: document.getElementById('project-file-modal'),
      title: document.getElementById('project-file-modal-title'),
      content: document.getElementById('project-file-modal-content'),
      closeButton: document.getElementById('project-file-modal-close'),
      editor: document.getElementById('project-file-editor'),
      lines: document.getElementById('project-file-lines'),
      saveButton: document.getElementById('project-file-save'),
      status: document.getElementById('project-file-status'),
      unsavedModal: document.getElementById('unsaved-exit-modal'),
      unsavedBackdrop: document.getElementById('unsaved-exit-backdrop'),
      unsavedNo: document.getElementById('unsaved-exit-no'),
      unsavedYes: document.getElementById('unsaved-exit-yes'),
    };

    let currentPath = null;
    let originalContent = '';
    let isDirty = false;
    let codeEditor = null;
    let codeEditorBound = false;

    function getProjectInfo() {
      return typeof options.getProjectInfo === 'function' ? options.getProjectInfo() : null;
    }

    function notify(message) {
      if (typeof options.notify === 'function') options.notify(message);
    }

    async function notifySaved() {
      if (typeof options.onSaved === 'function') await options.onSaved();
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

    function ensureCodeEditor() {
      if (codeEditor || !elements.editor || typeof window.CodeMirror !== 'function') return codeEditor;

      codeEditor = window.CodeMirror.fromTextArea(elements.editor, {
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

      const wrapper = codeEditor.getWrapperElement();
      if (wrapper) {
        wrapper.id = 'project-file-editor-cm';
        wrapper.classList.add('project-file-editor-cm');
      }
      document.body.classList.add('cm-ready');

      return codeEditor;
    }

    function getEditorValue() {
      if (codeEditor) return String(codeEditor.getValue() || '');
      if (!elements.editor) return '';
      return String(elements.editor.value || '');
    }

    function setEditorValue(value, options = {}) {
      const text = String(value || '');
      const targetLine = Math.max(0, Number(options.line || 1) - 1);
      if (codeEditor) {
        codeEditor.setValue(text);
        codeEditor.clearHistory();
        scrollEditorToLine(targetLine + 1);
        return;
      }
      if (elements.editor) {
        elements.editor.value = text;
        elements.editor.scrollTop = 0;
        elements.editor.scrollLeft = 0;
      }
    }

    function focusEditor() {
      if (codeEditor) {
        codeEditor.focus();
        return;
      }
      if (elements.editor) elements.editor.focus();
    }

    function setEditorMode(path) {
      const mode = getEditorModeFromPath(path);
      if (codeEditor) codeEditor.setOption('mode', mode);
    }

    function refreshEditorLayout() {
      if (codeEditor) codeEditor.refresh();
    }

    function scrollEditorToLine(lineNumber) {
      const safeLine = Math.max(1, Number(lineNumber || 1) || 1);
      const targetLine = safeLine - 1;
      if (codeEditor) {
        codeEditor.setCursor({ line: targetLine, ch: 0 });
        codeEditor.scrollIntoView({ line: targetLine, ch: 0 }, 120);
        const lineHeight = typeof codeEditor.defaultTextHeight === 'function'
          ? codeEditor.defaultTextHeight()
          : 19;
        if (typeof codeEditor.scrollTo === 'function') {
          codeEditor.scrollTo(null, Math.max(0, targetLine - 3) * lineHeight);
        }
        return;
      }
      if (elements.editor) {
        const lineHeight = 19;
        elements.editor.scrollTop = Math.max(0, safeLine - 3) * lineHeight;
        elements.editor.scrollLeft = 0;
      }
    }

    function setDirty(flag) {
      isDirty = Boolean(flag);
      if (elements.saveButton) elements.saveButton.disabled = !isDirty;
      if (elements.status) {
        elements.status.textContent = isDirty ? 'Alterações não salvas' : 'Sem alterações';
      }
    }

    function isImageFilePath(path) {
      return /\.(png|jpe?g|gif|webp|svg)$/i.test(String(path || ''));
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function encodeFileUrlPath(absPath) {
      return String(absPath || '')
        .split('/')
        .map((part, index) => (index === 0 && part === '' ? '' : encodeURIComponent(part)))
        .join('/');
    }

    function buildImageFileUrl(rootPath, relativePath) {
      const root = String(rootPath || '').replace(/\/+$/, '');
      const rel = String(relativePath || '').replace(/^\/+/, '');
      return 'file://' + encodeFileUrlPath(root + '/' + rel);
    }

    function renderImagePreview(rootPath, relativePath) {
      if (!elements.content) return;
      elements.content.innerHTML = '';
      const image = document.createElement('img');
      image.src = buildImageFileUrl(rootPath, relativePath);
      image.alt = String(relativePath || '');
      image.loading = 'lazy';
      image.style.maxWidth = '100%';
      image.style.height = 'auto';
      image.style.display = 'block';
      image.style.margin = '0 auto';
      elements.content.appendChild(image);
    }

    function syntaxHighlightText(content, filePath) {
      const ext = String(filePath || '').toLowerCase().split('.').pop() || '';
      const supported = ['js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'html', 'htm', 'json', 'md', 'txt'];
      if (supported.indexOf(ext) < 0) return escapeHtml(content);

      let html = escapeHtml(content);
      const tokenMap = [];

      function reserveToken(className, value) {
        const key = '\uE000' + '¤'.repeat(tokenMap.length + 1) + '\uE001';
        tokenMap.push([key, '<span class="' + className + '">' + value + '</span>']);
        return key;
      }

      function tokenize(regex, className) {
        html = html.replace(regex, (match) => reserveToken(className, match));
      }

      tokenize(/(&lt;!--[\s\S]*?--&gt;|\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g, 'tok-comment');
      tokenize(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, 'tok-string');

      if (ext === 'html' || ext === 'htm') {
        tokenize(/&lt;\/?[a-zA-Z][\w:-]*/g, 'tok-tag');
        tokenize(/\b[a-zA-Z_:][-a-zA-Z0-9_:.]*(?==)/g, 'tok-attr');
      }

      if (ext === 'css' || ext === 'scss') {
        html = html.replace(/(^|[\{;\s])([a-zA-Z-]+)(\s*:)/gm, (match, prefix, prop, suffix) => {
          return prefix + reserveToken('tok-prop', prop) + suffix;
        });
      }

      tokenize(/\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|class|new|import|export|from|default|async|await|true|false|null|undefined)\b/g, 'tok-key');
      tokenize(/\b(\d+(?:\.\d+)?)(px|rem|em|vh|vw|%|ms|s)?\b/g, 'tok-number');
      tokenize(/\b([a-zA-Z_$][\w$]*)(?=\s*\()/g, 'tok-fn');
      tokenize(/([{}()\[\];,.])/g, 'tok-punct');
      tokenize(/([=:+\-*\/<>])/g, 'tok-op');

      for (const [key, value] of tokenMap) {
        html = html.split(key).join(value);
      }

      return html;
    }

    function updateDecorations() {
      if (codeEditor) return;
      if (!elements.editor || !elements.content) return;
      const text = String(elements.editor.value || '');
      const lineCount = Math.max(1, text.split('\n').length);

      if (elements.lines) {
        elements.lines.textContent = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join('\n');
      }

      elements.content.innerHTML = syntaxHighlightText(text, currentPath);
    }

    function syncOverlayScroll() {
      if (codeEditor) return;
      if (!elements.editor) return;
      if (elements.content) {
        elements.content.scrollTop = elements.editor.scrollTop;
        elements.content.scrollLeft = elements.editor.scrollLeft;
      }
      if (elements.lines) {
        elements.lines.scrollTop = elements.editor.scrollTop;
      }
    }

    function stripInjectedHighlightArtifacts(text) {
      const raw = String(text || '');
      const openPath = String(currentPath || '').toLowerCase();
      const isHtmlFile = /\.html?$/.test(openPath);
      const hasTokArtifacts =
        /tok-(comment|string|number|key|prop|fn|tag|attr|op|punct)/.test(raw) ||
        /__LC_TOK_X+__/.test(raw);

      if (!hasTokArtifacts) return raw;

      let clean = raw;

      clean = clean.replace(/<span[^>]*tok-[^>]*>([\s\S]*?)<\/span>/gi, '$1');
      clean = clean.replace(/class=["'][^"']*tok-[^"']*["']/gi, '');

      if (!isHtmlFile) {
        clean = clean.replace(/<\/?span\b[^>]*>/gi, '');
      }

      clean = clean
        .replace(/&lt;span[^&]*tok-[^&]*&gt;/gi, '')
        .replace(/&lt;\/span&gt;/gi, '')
        .replace(/__LC_TOK_X+__(?=\s*\()/g, 'catch')
        .replace(/__LC_TOK_X+__/g, '');

      return clean;
    }

    async function promptUnsavedExitWithoutSaving() {
      const { unsavedModal, unsavedNo, unsavedYes, unsavedBackdrop } = elements;
      if (!unsavedModal || !unsavedNo || !unsavedYes || !unsavedBackdrop) {
        return window.confirm('Você alterou o projeto, deseja sair sem salvar?');
      }

      return new Promise((resolve) => {
        const finish = (discard) => {
          unsavedModal.classList.add('hidden');
          unsavedModal.setAttribute('aria-hidden', 'true');
          document.removeEventListener('keydown', onKeydown);
          unsavedNo.removeEventListener('click', onNo);
          unsavedYes.removeEventListener('click', onYes);
          unsavedBackdrop.removeEventListener('click', onNo);
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
            if (document.activeElement === unsavedYes) {
              finish(true);
            } else {
              finish(false);
            }
          }
        };

        unsavedModal.classList.remove('hidden');
        unsavedModal.setAttribute('aria-hidden', 'false');

        unsavedNo.addEventListener('click', onNo);
        unsavedYes.addEventListener('click', onYes);
        unsavedBackdrop.addEventListener('click', onNo);
        document.addEventListener('keydown', onKeydown);

        setTimeout(() => {
          try {
            unsavedNo.focus({ preventScroll: true });
          } catch (_) {
            unsavedNo.focus();
          }
        }, 0);
      });
    }

    function isOpen() {
      return Boolean(elements.modal && !elements.modal.classList.contains('hidden'));
    }

    async function close(optionsForClose = {}) {
      const { skipDirtyCheck = false } = optionsForClose;
      if (!elements.modal) return true;

      if (!skipDirtyCheck && isDirty) {
        const discard = await promptUnsavedExitWithoutSaving();
        if (!discard) return false;
      }

      elements.modal.classList.add('hidden');
      elements.modal.setAttribute('aria-hidden', 'true');

      if (elements.content) {
        elements.content.innerHTML = '';
        elements.content.style.display = '';
        elements.content.style.whiteSpace = '';
      }
      if (codeEditor) {
        codeEditor.setValue('');
        const wrap = codeEditor.getWrapperElement();
        if (wrap) wrap.style.display = 'none';
      }
      if (elements.editor) {
        elements.editor.value = '';
        elements.editor.style.display = codeEditor ? 'none' : 'block';
        elements.editor.scrollTop = 0;
        elements.editor.scrollLeft = 0;
      }
      if (elements.lines) {
        elements.lines.textContent = '1';
        elements.lines.style.display = '';
        elements.lines.scrollTop = 0;
      }

      currentPath = null;
      originalContent = '';
      setDirty(false);
      return true;
    }

    async function save() {
      const projectInfo = getProjectInfo();
      if (!elements.editor || !currentPath || !projectInfo) return false;

      const cleanContent = stripInjectedHighlightArtifacts(getEditorValue());
      const result = await api.writeProjectFile({
        projectInfo,
        relativePath: currentPath,
        content: cleanContent,
      });

      if (!result || !result.ok) {
        notify((result && result.message) || 'Falha ao salvar arquivo.');
        return false;
      }

      originalContent = cleanContent;
      setDirty(false);
      await notifySaved();
      return true;
    }

    async function open(relativePath, options = {}) {
      const projectInfo = getProjectInfo();
      if (!relativePath || !projectInfo) return;
      const targetLine = Math.max(1, Number(options.line || 1) || 1);

      if (isDirty && isOpen() && currentPath && currentPath !== relativePath) {
        const closed = await close();
        if (!closed) return;
      }

      currentPath = relativePath;
      if (elements.title) elements.title.textContent = relativePath;
      if (elements.status) elements.status.textContent = 'Sem alterações';

      if (isImageFilePath(relativePath)) {
        if (codeEditor) {
          const wrap = codeEditor.getWrapperElement();
          if (wrap) wrap.style.display = 'none';
        }
        if (elements.editor) elements.editor.style.display = 'none';
        if (elements.saveButton) elements.saveButton.style.display = 'none';
        if (elements.lines) elements.lines.style.display = 'none';
        if (elements.content) {
          elements.content.style.display = 'block';
          elements.content.style.whiteSpace = 'normal';
          renderImagePreview(projectInfo.rootPath, relativePath);
        }
        if (elements.modal) {
          elements.modal.classList.remove('hidden');
          elements.modal.setAttribute('aria-hidden', 'false');
        }
        setDirty(false);
        return;
      }

      const result = await api.readProjectFile({
        projectInfo,
        relativePath,
      });
      if (!result || !result.ok) {
        notify((result && result.message) || 'Falha ao abrir arquivo.');
        return;
      }

      const rawContent = String(result.content || '');
      const normalizedContent = stripInjectedHighlightArtifacts(rawContent);
      const wasSanitized = normalizedContent !== rawContent;
      originalContent = normalizedContent;

      const cm = ensureCodeEditor();
      if (cm) {
        if (elements.content) {
          elements.content.style.display = 'none';
          elements.content.innerHTML = '';
        }
        if (elements.lines) elements.lines.style.display = 'none';
        setEditorMode(relativePath);
        setEditorValue(normalizedContent, { line: targetLine });
        const wrap = cm.getWrapperElement();
        if (wrap) wrap.style.display = 'block';
        if (elements.editor) elements.editor.style.display = 'none';
      } else {
        if (elements.content) {
          elements.content.style.display = 'block';
          elements.content.style.whiteSpace = 'pre';
          elements.content.innerHTML = '';
        }
        if (elements.lines) elements.lines.style.display = 'block';
      }

      if (!cm && elements.editor) {
        document.body.classList.remove('cm-ready');
        elements.editor.style.display = 'block';
        elements.editor.value = normalizedContent;
        scrollEditorToLine(targetLine);
      }
      focusEditor();
      setTimeout(() => {
        focusEditor();
        refreshEditorLayout();
        scrollEditorToLine(targetLine);
      }, 0);
      setTimeout(() => {
        refreshEditorLayout();
        scrollEditorToLine(targetLine);
      }, 80);
      if (elements.saveButton) {
        elements.saveButton.style.display = '';
        elements.saveButton.disabled = true;
      }

      setDirty(wasSanitized);
      if (wasSanitized && elements.status) {
        elements.status.textContent = 'Conteúdo recuperado, salve para aplicar';
      }
      updateDecorations();
      syncOverlayScroll();
      refreshEditorLayout();

      if (elements.modal) {
        elements.modal.classList.remove('hidden');
        elements.modal.setAttribute('aria-hidden', 'false');
      }
      scrollEditorToLine(targetLine);
    }

    function bindCodeEditorEvents() {
      if (!codeEditor || codeEditorBound) return;
      codeEditorBound = true;

      codeEditor.on('change', () => {
        const text = getEditorValue();
        setDirty(text !== originalContent);
      });

      codeEditor.on('keydown', async (_cm, event) => {
        if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 's') {
          event.preventDefault();
          await save();
        }
      });
    }

    function bindEvents() {
      if (elements.editor) {
        ensureCodeEditor();
        bindCodeEditorEvents();

        if (!codeEditor) {
          elements.editor.addEventListener('input', () => {
            const text = elements.editor.value || '';
            setDirty(text !== originalContent);
          });
          elements.editor.addEventListener('keydown', async (event) => {
            if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 's') {
              event.preventDefault();
              await save();
            }
          });
          elements.editor.addEventListener('input', updateDecorations);
          elements.editor.addEventListener('scroll', syncOverlayScroll);
        }
      }

      if (elements.saveButton) {
        elements.saveButton.addEventListener('click', async () => {
          await save();
        });
      }

      if (elements.closeButton) {
        elements.closeButton.addEventListener('click', async () => {
          await close();
        });
      }

      if (elements.modal) {
        elements.modal.addEventListener('click', async (event) => {
          if (event.target && event.target.dataset && event.target.dataset.close === '1') {
            await close();
          }
        });
      }

      document.addEventListener('keydown', async (event) => {
        if (event.key === 'Escape' && isOpen()) {
          await close();
        }
      });
    }

    function reset() {
      void close({ skipDirtyCheck: true });
    }

    return {
      bindEvents,
      close,
      isOpen,
      open,
      reset,
      save,
    };
  }

  window.FaberProjectFileEditor = {
    createProjectFileEditorController,
  };
})();
