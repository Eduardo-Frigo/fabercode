(function () {
  function getFileTreeIconSvg(kind) {
    if (kind === 'dir') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.3c.5 0 1 .2 1.3.6l1 1.1c.3.3.7.5 1.1.5H18.5A2.5 2.5 0 0 1 21 9.7v6.8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (kind === 'image') return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><path d="m6 17 4.2-4.2a1 1 0 0 1 1.4 0L14 15l1.8-1.8a1 1 0 0 1 1.4 0L19 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (kind === 'code') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 8-4 4 4 4M15 8l4 4-4 4M13 6l-2 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3Zm8 0v4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function createProjectFileTreeController(options = {}) {
    const rootEl = options.rootEl || document.getElementById('project-files-tree');
    const contextMenuEl = options.contextMenuEl || document.getElementById('project-file-context-menu');
    const api = options.api || {};
    let rows = [];
    let diffStats = {};
    let currentContextPath = null;
    const collapsedPaths = new Set();
    let currentProjectId = null;

    function getProjectInfo() {
      return typeof options.getProjectInfo === 'function' ? options.getProjectInfo() : null;
    }

    function beforeRender() {
      if (typeof options.beforeRender === 'function') options.beforeRender();
    }

    function notify(message) {
      if (typeof options.notify === 'function') options.notify(message);
    }

    function getBaseName(filePath) {
      const normalized = String(filePath || '').split('\\').join('/');
      const parts = normalized.split('/').filter(Boolean);
      return parts[parts.length - 1] || normalized || 'arquivo';
    }

    async function requestFileRename(relativePath) {
      const currentName = getBaseName(relativePath);
      if (typeof options.requestFileRename === 'function') {
        return options.requestFileRename({ relativePath, currentName });
      }
      return window.prompt('Novo nome do arquivo:', currentName);
    }

    function showContextMenu(relativePath, x, y) {
      if (!contextMenuEl) return;
      currentContextPath = relativePath;
      contextMenuEl.classList.remove('hidden');
      contextMenuEl.style.left = String(x) + 'px';
      contextMenuEl.style.top = String(y) + 'px';
    }

    function hideContextMenu() {
      if (!contextMenuEl) return;
      contextMenuEl.classList.add('hidden');
      contextMenuEl.style.left = '-9999px';
      contextMenuEl.style.top = '-9999px';
    }

    function renderEmpty(message, details = []) {
      if (!rootEl) return;
      const empty = document.createElement('div');
      empty.className = 'project-files-empty';

      const title = document.createElement('strong');
      title.textContent = message;
      empty.appendChild(title);

      const lines = Array.isArray(details) ? details : [];
      lines.filter(Boolean).forEach((line) => {
        const detail = document.createElement('span');
        detail.textContent = String(line);
        empty.appendChild(detail);
      });

      rootEl.appendChild(empty);
    }

    function render() {
      if (!rootEl) return;
      beforeRender();
      rootEl.innerHTML = '';

      const projectInfo = getProjectInfo();
      if (!projectInfo || !projectInfo.rootPath) {
        renderEmpty('Nenhum projeto selecionado.', [
          'Escolha um projeto na lateral esquerda para listar arquivos, abrir o editor e liberar Git, execução local e terminal.',
          'Para começar do zero, use Novo projeto.',
        ]);
        return;
      }

      const isCollapsedDescendant = (path) => {
        const normalizedPath = String(path || '').split('\\').join('/');
        for (const collapsed of collapsedPaths) {
          if (normalizedPath === collapsed) continue;
          if (normalizedPath.startsWith(collapsed + '/')) {
            return true;
          }
        }
        return false;
      };

      const visibleRows = (Array.isArray(rows) ? rows : []).filter(row => {
        return !isCollapsedDescendant(row.path);
      });
      const visibleDiffStats = diffStats && typeof diffStats === 'object' ? diffStats : {};

      if (!visibleRows.length) {
        renderEmpty('Arquivos ainda não carregados.', [
          'Reabra ou selecione o projeto novamente para atualizar a árvore.',
          'Se a pasta estiver vazia, crie arquivos pelo fluxo de conversa ou pelo seu editor externo.',
        ]);
        return;
      }

      const shell = document.createElement('div');
      shell.className = 'project-files-shell';

      const scroll = document.createElement('div');
      scroll.className = 'project-files-scroll';

      const diffEntries = Object.entries(visibleDiffStats)
        .map(([file, stat]) => ({
          file,
          add: Math.max(0, Number((stat && (stat.add || stat.added)) || 0) || 0),
          del: Math.max(0, Number((stat && (stat.del || stat.removed)) || 0) || 0),
        }))
        .filter((entry) => entry.add > 0 || entry.del > 0);
      if (diffEntries.length) {
        const summary = document.createElement('div');
        summary.className = 'project-files-change-summary';
        const count = document.createElement('span');
        count.textContent = `${diffEntries.length} ${diffEntries.length === 1 ? (window.t ? window.t('filesChangedSingle', 'arquivo alterado') : 'arquivo alterado') : (window.t ? window.t('filesChangedPlural', 'arquivos alterados') : 'arquivos alterados')}`;
        const add = diffEntries.reduce((sum, entry) => sum + entry.add, 0);
        const del = diffEntries.reduce((sum, entry) => sum + entry.del, 0);
        summary.appendChild(count);
        if (add > 0) {
          const addEl = document.createElement('strong');
          addEl.className = 'project-tree-diff-add';
          addEl.textContent = `+${add}`;
          summary.appendChild(addEl);
        }
        if (del > 0) {
          const delEl = document.createElement('strong');
          delEl.className = 'project-tree-diff-del';
          delEl.textContent = `-${del}`;
          summary.appendChild(delEl);
        }
        scroll.appendChild(summary);
      }

      visibleRows.slice(0, 800).forEach((row) => {
        const isDir = row.type === 'dir' || row.kind === 'dir' || row.isDir === true;
        const name = row.name || row.path || '(arquivo)';
        const lower = String(name).toLowerCase();
        const isImage = !isDir && /\.(png|jpe?g|gif|webp|svg)$/.test(lower);
        const isCode = !isDir && /\.(js|jsx|ts|tsx|css|scss|html|htm|json|md|txt)$/.test(lower);
        const kind = isDir ? 'dir' : isImage ? 'image' : isCode ? 'code' : 'file';

        const relPath = String(row.path || '').split('\\').join('/');
        const stat = !isDir ? visibleDiffStats[relPath] : null;
        const statAdd = Number(stat && (stat.add || stat.added)) || 0;
        const statDel = Number(stat && (stat.del || stat.removed)) || 0;
        const hasDiff = Boolean(stat && (statAdd > 0 || statDel > 0));
        const firstLine = Math.max(1, Number(stat && stat.firstLine) || 1);

        const line = document.createElement('div');
        line.className = 'project-tree-row' + (isDir ? ' dir' : ' file') + (hasDiff ? ' has-diff' : '');
        line.style.paddingLeft = String(8 + (Number(row.depth || 0) * 14)) + 'px';
        line.dataset.path = row.path || '';
        line.dataset.dir = isDir ? '1' : '0';
        if (hasDiff) line.dataset.firstLine = String(firstLine);
        if (!isDir) {
          line.tabIndex = 0;
          line.setAttribute('role', 'button');
          line.setAttribute('aria-label', `Abrir ${relPath}`);
        }

        let chevron;
        if (isDir) {
          chevron = document.createElement('span');
          chevron.className = 'project-tree-chevron';
          if (collapsedPaths.has(row.path)) {
            chevron.classList.add('collapsed');
          }
          chevron.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
        } else {
          chevron = document.createElement('span');
          chevron.className = 'project-tree-chevron-spacer';
        }

        const icon = document.createElement('span');
        icon.className = 'project-tree-icon';
        icon.innerHTML = getFileTreeIconSvg(kind);

        const label = document.createElement('span');
        label.className = 'project-tree-label';
        label.textContent = name;

        line.append(chevron, icon, label);

        if (!isDir) {
          if (hasDiff) {
            const diff = document.createElement('span');
            diff.className = 'project-tree-diff';

            if (statAdd > 0) {
              const add = document.createElement('span');
              add.className = 'project-tree-diff-add';
              add.textContent = `+${statAdd}`;
              diff.appendChild(add);
            }

            if (statDel > 0) {
              const del = document.createElement('span');
              del.className = 'project-tree-diff-del';
              del.textContent = `-${statDel}`;
              diff.appendChild(del);
            }

            const jump = document.createElement('button');
            jump.type = 'button';
            jump.className = 'project-tree-diff-jump';
            jump.dataset.line = String(firstLine);
            jump.title = `Abrir alteração na linha ${firstLine}`;
            jump.setAttribute('aria-label', `Abrir ${relPath} na linha ${firstLine}`);
            jump.textContent = `L${firstLine}`;
            diff.appendChild(jump);

            line.appendChild(diff);
          }
        }

        scroll.appendChild(line);
      });

      shell.appendChild(scroll);
      rootEl.appendChild(shell);
    }

    async function ensureProjectReady() {
      if (typeof options.ensureProjectReady === 'function') {
        return options.ensureProjectReady();
      }
      const projectInfo = getProjectInfo();
      return Boolean(projectInfo && projectInfo.rootPath);
    }

    async function refresh() {
      if (!rootEl) return;

      const ready = await ensureProjectReady();
      const projectInfo = getProjectInfo();
      if (!ready || !projectInfo || !projectInfo.rootPath) {
        rows = [];
        diffStats = {};
        render();
        return;
      }

      const projectId = projectInfo.id || projectInfo.rootPath;
      if (currentProjectId !== projectId) {
        currentProjectId = projectId;
        collapsedPaths.clear();
      }

      if (!api || typeof api.getProjectFilesTree !== 'function') {
        rows = [];
        diffStats = {};
        render();
        return;
      }

      try {
        const result = await api.getProjectFilesTree({ rootPath: projectInfo.rootPath });
        rows = result && result.ok && Array.isArray(result.rows) ? result.rows : [];
        diffStats = result && result.ok && result.diffStats && typeof result.diffStats === 'object'
          ? result.diffStats
          : {};
      } catch {
        rows = [];
        diffStats = {};
      }

      render();
    }

    function clear() {
      rows = [];
      diffStats = {};
      render();
    }

    function hasRows() {
      return Array.isArray(rows) && rows.length > 0;
    }

    function bindEvents() {
      if (!rootEl) return;

      rootEl.addEventListener('click', async (event) => {
        const row = event.target && event.target.closest ? event.target.closest('.project-tree-row') : null;
        if (!row) return;
        if (row.dataset.dir === '1') {
          const path = row.dataset.path;
          if (collapsedPaths.has(path)) {
            collapsedPaths.delete(path);
          } else {
            collapsedPaths.add(path);
          }
          render();
          return;
        }
        if (typeof options.onOpenFile === 'function') {
          const jump = event.target && event.target.closest ? event.target.closest('.project-tree-diff-jump') : null;
          const line = jump ? Number(jump.dataset.line || row.dataset.firstLine || 1) : Number(row.dataset.firstLine || 1);
          await options.onOpenFile(row.dataset.path || '', { line: Math.max(1, line || 1) });
        }
      });

      rootEl.addEventListener('keydown', async (event) => {
        const row = event.target && event.target.closest ? event.target.closest('.project-tree-row') : null;
        if (!row || row.dataset.dir === '1') return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (typeof options.onOpenFile === 'function') {
          await options.onOpenFile(row.dataset.path || '', {
            line: Math.max(1, Number(row.dataset.firstLine || 1) || 1),
          });
        }
      });

      rootEl.addEventListener('contextmenu', (event) => {
        const row = event.target && event.target.closest ? event.target.closest('.project-tree-row') : null;
        if (!row) return;
        event.preventDefault();
        if (row.dataset.dir === '1') return; // Context menu only for files for now
        if (typeof options.onContextMenu === 'function') {
          options.onContextMenu(row.dataset.path || '', event.clientX, event.clientY);
          return;
        }
        showContextMenu(row.dataset.path || '', event.clientX, event.clientY);
      });

      if (contextMenuEl) {
        contextMenuEl.addEventListener('click', async (event) => {
          const btn = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
          if (!btn || !currentContextPath) return;
          const action = btn.dataset.action;
          const relativePath = currentContextPath;
          hideContextMenu();

          if (action === 'open') {
            if (typeof options.onOpenFile === 'function') await options.onOpenFile(relativePath);
            return;
          }

          if (action === 'reveal') {
            if (!api || typeof api.revealFileInFolder !== 'function') return;
            await api.revealFileInFolder({
              projectInfo: getProjectInfo(),
              relativePath,
            });
            return;
          }

          if (action === 'rename') {
            const currentName = getBaseName(relativePath);
            const nextName = await requestFileRename(relativePath);
            if (!nextName || !nextName.trim() || nextName.trim() === currentName) return;
            if (!api || typeof api.renameProjectFile !== 'function') {
              notify('Renomear arquivo ainda não está disponível nesta build.');
              return;
            }
            const result = await api.renameProjectFile({
              projectInfo: getProjectInfo(),
              relativePath,
              nextName: nextName.trim(),
            });
            if (!result || !result.ok) {
              notify((result && result.message) || 'Falha ao renomear arquivo.');
              return;
            }
            await refresh();
          }
        });
      }

      document.addEventListener('click', (event) => {
        if (!contextMenuEl || contextMenuEl.classList.contains('hidden')) return;
        const inside = event.target && event.target.closest && event.target.closest('#project-file-context-menu');
        if (!inside) hideContextMenu();
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          hideContextMenu();
        }
      });
    }

    return {
      bindEvents,
      clear,
      hasRows,
      refresh,
      render,
    };
  }

  window.FaberProjectFileTree = {
    createProjectFileTreeController,
  };
})();
