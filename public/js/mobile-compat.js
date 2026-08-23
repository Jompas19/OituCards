(function () {
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches || false;
  const narrowScreen = window.matchMedia?.('(max-width: 900px)')?.matches || window.innerWidth <= 900;
  const hasTouch = Number(navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  const isMobileTouch = coarsePointer || (hasTouch && narrowScreen);

  if (!isMobileTouch) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const INTERACTIVE_SELECTOR = [
    'button:not(:disabled)',
    'input[type="checkbox"]:not(:disabled)',
    'input[type="radio"]:not(:disabled)',
    '.study-card',
    '.study-filter-option',
    '.check-option',
    '.redo-option',
    '.library-choice',
    '.tree-destination-root',
    '.tree-destination-row label',
    '.enhanced-add-folder > label',
    '.enhanced-tree-choice',
    '.folder-toggle-button',
    '.deck-name-button',
    '[role="button"]'
  ].join(',');

  let pendingTap = null;
  let recentSynthetic = null;
  let synthesizingClick = false;
  let nativeMutationObserver = null;
  let mobileMutationObserver = null;

  function ensureStyles() {
    if ($('link[data-oitucards-mobile-compat-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/mobile-compat.css?v=20260823-1714';
    link.dataset.oitucardsMobileCompatCss = 'true';
    document.head.appendChild(link);
  }

  function installMobileMutationObserverGuard() {
    if (typeof window.MutationObserver !== 'function') return;
    if (window.MutationObserver.__oitucardsMobileCompat) return;

    nativeMutationObserver = window.MutationObserver;

    mobileMutationObserver = class MobileMutationObserver {
      constructor(callback) {
        this._observer = new nativeMutationObserver(callback);
      }

      observe(target, options) {
        let safeOptions = options;
        const isWholeAppObserver = target === document.body
          && options?.subtree === true
          && options?.childList === true
          && options?.attributes === true;

        if (isWholeAppObserver) {
          // No celular, mudanças de classe acontecem o tempo todo ao abrir telas,
          // revelar cards e animar elementos. O refinamento visual só precisa
          // observar alterações reais de conteúdo; mudanças de formulário já
          // possuem listeners próprios de change/input.
          safeOptions = { ...options, attributes: false };
          delete safeOptions.attributeFilter;
        }

        this._observer.observe(target, safeOptions);
      }

      disconnect() {
        return this._observer.disconnect();
      }

      takeRecords() {
        return this._observer.takeRecords();
      }
    };

    Object.defineProperty(mobileMutationObserver, '__oitucardsMobileCompat', { value: true });
    window.MutationObserver = mobileMutationObserver;
  }

  function releaseMobileMutationObserverGuard() {
    if (!nativeMutationObserver || window.MutationObserver !== mobileMutationObserver) return;

    const restore = () => {
      if (window.MutationObserver === mobileMutationObserver) {
        window.MutationObserver = nativeMutationObserver;
      }
    };

    // Se o refinamento visual foi carregado antes do DOMContentLoaded, ele ainda
    // vai inicializar seu observer nesse evento. Restauramos apenas no próximo task.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(restore, 0), { once: true });
    } else {
      setTimeout(restore, 0);
    }
  }

  function interactiveFrom(target) {
    if (!(target instanceof Element)) return null;
    if (target.closest('.toolbar,#annotationToolbar,[contenteditable="true"]')) return null;
    return target.closest(INTERACTIVE_SELECTOR);
  }

  function sameInteractive(first, second) {
    if (!first || !second) return false;
    if (first === second || first.contains(second) || second.contains(first)) return true;
    if (first instanceof HTMLLabelElement && first.control === second) return true;
    if (second instanceof HTMLLabelElement && second.control === first) return true;
    return false;
  }

  function clearPendingTap() {
    if (pendingTap?.timer) clearTimeout(pendingTap.timer);
    pendingTap = null;
  }

  function installTapFallback() {
    document.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) {
        clearPendingTap();
        return;
      }
      const target = interactiveFrom(event.target);
      if (!target) {
        clearPendingTap();
        return;
      }
      const touch = event.touches[0];
      pendingTap = {
        target,
        startX: touch.clientX,
        startY: touch.clientY,
        moved: false,
        nativeClick: false,
        timer: null
      };
    }, { capture: true, passive: true });

    document.addEventListener('touchmove', (event) => {
      if (!pendingTap || !event.touches.length) return;
      const touch = event.touches[0];
      if (Math.abs(touch.clientX - pendingTap.startX) > 12 || Math.abs(touch.clientY - pendingTap.startY) > 12) {
        pendingTap.moved = true;
      }
    }, { capture: true, passive: true });

    document.addEventListener('touchcancel', clearPendingTap, { capture: true, passive: true });

    document.addEventListener('touchend', () => {
      const tap = pendingTap;
      if (!tap || tap.moved) {
        clearPendingTap();
        return;
      }

      tap.timer = setTimeout(() => {
        if (pendingTap !== tap || tap.nativeClick || !document.documentElement.contains(tap.target)) return;
        pendingTap = null;
        recentSynthetic = { target: tap.target, at: performance.now() };
        synthesizingClick = true;
        try {
          tap.target.click();
        } finally {
          synthesizingClick = false;
        }
      }, 80);
    }, { capture: true, passive: true });

    document.addEventListener('click', (event) => {
      if (synthesizingClick) return;
      const target = interactiveFrom(event.target);

      if (recentSynthetic && event.isTrusted && sameInteractive(recentSynthetic.target, target)) {
        if (performance.now() - recentSynthetic.at < 650) {
          event.preventDefault();
          event.stopImmediatePropagation();
          recentSynthetic = null;
          return;
        }
        recentSynthetic = null;
      }

      if (pendingTap && sameInteractive(pendingTap.target, target)) {
        pendingTap.nativeClick = true;
        clearPendingTap();
      }
    }, true);
  }

  function installToolbarTouchBridge() {
    const toolbarSelector = [
      '.toolbar [data-cmd]',
      '.toolbar .color-toggle',
      '.toolbar .color-dot',
      '.toolbar [data-image-for]',
      '#annotationToolbar [data-annotation-cmd]',
      '#annotationToolbar .annotation-color-toggle',
      '#annotationToolbar .annotation-color-dot',
      '#annotationToolbar .annotation-image-button'
    ].join(',');

    document.addEventListener('touchstart', (event) => {
      const target = event.target instanceof Element ? event.target.closest(toolbarSelector) : null;
      if (!target || event.touches.length !== 1) return;

      // As barras de edição preservam a seleção usando mousedown no desktop.
      // Em touch, traduzimos somente esse gesto para o evento esperado pelo editor.
      event.preventDefault();
      target.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    }, { capture: true, passive: false });
  }

  function simplifyStudyIntervals() {
    [
      '#ratingHardInterval', '#ratingMediumInterval', '#ratingGoodInterval', '#ratingEasyInterval',
      '#multiHintHard', '#multiHintMedium', '#multiHintGood', '#multiHintEasy'
    ].forEach((selector) => {
      const element = $(selector);
      if (!element) return;
      const raw = element.textContent || '';
      if (!/revis[aã]o em/i.test(raw)) return;
      const simplified = raw.replace(/[()]/g, '').replace(/revis[aã]o em\s*/i, '').trim();
      if (simplified) element.textContent = simplified;
    });
  }

  function installLightRefreshHooks() {
    let frame = 0;
    const refresh = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        simplifyStudyIntervals();
      });
    };
    document.addEventListener('click', refresh, { passive: true });
    document.addEventListener('change', refresh, { passive: true });
  }

  document.documentElement.classList.add('oc-mobile-runtime');
  ensureStyles();
  installMobileMutationObserverGuard();
  installTapFallback();
  installToolbarTouchBridge();
  installLightRefreshHooks();

  window.OituMobileCompat = {
    active: true,
    releaseVisualObserverPatch: releaseMobileMutationObserverGuard
  };
})();
