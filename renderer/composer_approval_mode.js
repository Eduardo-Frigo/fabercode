(function () {
  const ASK_EACH = 'ask_each';
  const DELEGATE_TASK = 'delegate_task';
  const DEFAULT_UI_MODE = 'default';

  function normalizeApprovalMode(value) {
    return value === DELEGATE_TASK ? DELEGATE_TASK : ASK_EACH;
  }

  function normalizeUiMode(value) {
    return value === DEFAULT_UI_MODE ? DEFAULT_UI_MODE : 'cortex';
  }

  function createComposerApprovalModeController(options = {}) {
    const ownerDocument = options.document || (typeof document !== 'undefined' ? document : null);
    const state = options.state && typeof options.state === 'object' ? options.state : null;
    const suppliedElements = options.elements || {};
    const elements = {
      container: suppliedElements.container
        || (ownerDocument && ownerDocument.getElementById('composer-approval-mode')),
      select: suppliedElements.select
        || (ownerDocument && ownerDocument.getElementById('composer-approval-mode-select')),
    };

    let approvalMode = ASK_EACH;
    let uiMode = DEFAULT_UI_MODE;
    let activeToken = null;
    let submissionPending = false;
    let eventsBound = false;

    function render() {
      const isCortex = uiMode !== DEFAULT_UI_MODE;
      if (isCortex) approvalMode = ASK_EACH;
      if (state) state.composerApprovalMode = approvalMode;

      if (elements.container) {
        elements.container.hidden = isCortex;
        elements.container.setAttribute('aria-hidden', isCortex ? 'true' : 'false');
        elements.container.setAttribute('data-approval-mode', approvalMode);
        elements.container.setAttribute('data-submission-pending', submissionPending ? 'true' : 'false');
      }

      if (elements.select) {
        elements.select.value = approvalMode;
        elements.select.disabled = isCortex || submissionPending;
        elements.select.setAttribute('aria-disabled', elements.select.disabled ? 'true' : 'false');
      }

      return approvalMode;
    }

    function handleModeChange() {
      if (!elements.select || submissionPending || uiMode !== DEFAULT_UI_MODE) {
        render();
        return;
      }
      approvalMode = normalizeApprovalMode(elements.select.value);
      render();
    }

    function bindEvents() {
      if (!eventsBound && elements.select && typeof elements.select.addEventListener === 'function') {
        elements.select.addEventListener('change', handleModeChange);
        eventsBound = true;
      }
      render();
      return controller;
    }

    function setContext(nextUiMode) {
      const normalizedUiMode = normalizeUiMode(nextUiMode);
      if (normalizedUiMode !== uiMode) {
        activeToken = null;
        submissionPending = false;
      }
      uiMode = normalizedUiMode;
      if (uiMode !== DEFAULT_UI_MODE) approvalMode = ASK_EACH;
      render();
      return approvalMode;
    }

    function captureSubmission(context = {}) {
      let inputUiMode;
      try {
        inputUiMode = context && context.uiMode;
      } catch (_error) {
        inputUiMode = undefined;
      }
      setContext(inputUiMode);

      const token = Object.freeze({});
      activeToken = token;
      submissionPending = true;
      const snapshot = Object.freeze({
        token,
        approvalMode: uiMode === DEFAULT_UI_MODE ? approvalMode : ASK_EACH,
      });
      render();
      return snapshot;
    }

    function finishSubmission(tokenOrSnapshot, outcome = {}) {
      let token = tokenOrSnapshot;
      try {
        if (tokenOrSnapshot && tokenOrSnapshot.token) token = tokenOrSnapshot.token;
      } catch (_error) {
        return false;
      }
      if (!activeToken || token !== activeToken) return false;

      let accepted = false;
      try {
        accepted = Boolean(outcome && outcome.accepted === true);
      } catch (_error) {
        accepted = false;
      }
      activeToken = null;
      submissionPending = false;
      if (accepted) approvalMode = ASK_EACH;
      render();
      return true;
    }

    function reset() {
      activeToken = null;
      submissionPending = false;
      approvalMode = ASK_EACH;
      render();
      return approvalMode;
    }

    const controller = {
      bindEvents,
      render,
      setContext,
      captureSubmission,
      finishSubmission,
      reset,
    };

    return controller;
  }

  window.FaberComposerApprovalMode = {
    normalizeApprovalMode,
    createComposerApprovalModeController,
  };
})();
