(function () {
  const DEFAULT_DELAY_MS = 2000;
  const TOOLTIP_SELECTOR = [
    'button[title]',
    'button[data-tooltip]',
    '.icon-btn[aria-label]',
    '.left-mini-action[aria-label]',
    '.project-panel-btn[title]',
    '.workspace-collapse-btn[aria-label]',
    '.workspace-floating-restore[aria-label]',
    '.project-terminal-icon-btn[aria-label]',
    '.right-tool-lightbox__close[aria-label]',
    '.welcome-project-modal__close[aria-label]',
    '.project-rail-lightbox__close[aria-label]',
  ].join(',');

  function createHoverTooltipController(options = {}) {
    const doc = options.document || document;
    const delayMs = Number.isFinite(Number(options.delayMs)) ? Number(options.delayMs) : DEFAULT_DELAY_MS;
    let tooltip = null;
    let activeTarget = null;
    let timer = null;

    function ensureTooltip() {
      if (tooltip) return tooltip;
      tooltip = doc.createElement('div');
      tooltip.className = 'faber-hover-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(tooltip);
      return tooltip;
    }

    function normalizeText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function getTooltipText(target) {
      if (!target) return '';
      const existing = normalizeText(target.getAttribute('data-faber-tooltip'));
      if (existing) return existing;
      const explicit = normalizeText(target.getAttribute('data-tooltip'));
      const title = normalizeText(target.getAttribute('title'));
      const label = normalizeText(target.getAttribute('aria-label'));
      const text = explicit || title || label;
      if (text) {
        target.setAttribute('data-faber-tooltip', text);
        if (target.hasAttribute('title')) target.removeAttribute('title');
      }
      return text;
    }

    function positionTooltip(target) {
      if (!tooltip || !target || typeof target.getBoundingClientRect !== 'function') return;
      const rect = target.getBoundingClientRect();
      const margin = 10;
      tooltip.style.left = '0px';
      tooltip.style.top = '0px';
      const tooltipRect = tooltip.getBoundingClientRect();
      const centeredLeft = rect.left + rect.width / 2 - tooltipRect.width / 2;
      const left = Math.max(margin, Math.min(window.innerWidth - tooltipRect.width - margin, centeredLeft));
      const above = rect.top - tooltipRect.height - margin;
      const top = above > margin ? above : rect.bottom + margin;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(margin, top)}px`;
    }

    function hideTooltip() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      activeTarget = null;
      if (!tooltip) return;
      tooltip.classList.remove('is-visible');
      tooltip.setAttribute('aria-hidden', 'true');
    }

    function showTooltip(target) {
      const text = getTooltipText(target);
      if (!text || activeTarget !== target) return;
      const node = ensureTooltip();
      node.textContent = text;
      node.setAttribute('aria-hidden', 'false');
      node.classList.add('is-visible');
      positionTooltip(target);
    }

    function scheduleTooltip(target) {
      const text = getTooltipText(target);
      if (!text || target.disabled) return;
      if (activeTarget === target) return;
      hideTooltip();
      activeTarget = target;
      timer = setTimeout(() => {
        timer = null;
        showTooltip(target);
      }, delayMs);
    }

    function handlePointerOver(event) {
      const target = event.target && event.target.closest ? event.target.closest(TOOLTIP_SELECTOR) : null;
      if (!target || !doc.body.contains(target)) return;
      scheduleTooltip(target);
    }

    function handlePointerOut(event) {
      if (!activeTarget) return;
      const related = event.relatedTarget;
      if (related && activeTarget.contains && activeTarget.contains(related)) return;
      hideTooltip();
    }

    function harvestTitles(root = doc) {
      if (!root || typeof root.querySelectorAll !== 'function') return;
      root.querySelectorAll(TOOLTIP_SELECTOR).forEach((node) => {
        getTooltipText(node);
      });
    }

    function bind() {
      harvestTitles(doc);
      doc.addEventListener('mouseover', handlePointerOver, true);
      doc.addEventListener('mouseout', handlePointerOut, true);
      doc.addEventListener('click', hideTooltip, true);
      doc.addEventListener('keydown', hideTooltip, true);
      window.addEventListener('scroll', hideTooltip, true);
      window.addEventListener('resize', hideTooltip);

      if (typeof MutationObserver === 'function') {
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node && node.nodeType === 1) harvestTitles(node);
            });
          });
        });
        observer.observe(doc.body, { childList: true, subtree: true });
      }
    }

    return {
      bind,
      getTooltipText,
      hideTooltip,
      normalizeText,
    };
  }

  function initHoverTooltips(options = {}) {
    const controller = createHoverTooltipController(options);
    controller.bind();
    return controller;
  }

  window.FaberHoverTooltips = {
    createHoverTooltipController,
    initHoverTooltips,
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => initHoverTooltips(), { once: true });
    } else {
      initHoverTooltips();
    }
  }
})();
