(function () {
  function createInlineInputDialogController() {
    function closeDialog(dialog) {
      if (!dialog || !dialog.parentNode) return;
      dialog.parentNode.removeChild(dialog);
    }

    function requestText({ title = 'Editar', initialValue = '', placeholder = '' } = {}) {
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
          closeDialog(modal);
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

    return {
      requestText,
    };
  }

  window.FaberInlineInputDialog = {
    createInlineInputDialogController,
  };
})();
