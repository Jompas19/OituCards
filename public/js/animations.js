(function () {
  const MAX_LAYOUT_ITEMS = 32;
  const LAYOUT_MS = 210;
  const VIEW_MS = 235;
  const REVEAL_MS = 245;
  const MODAL_MS = 175;
  const EASE = 'cubic-bezier(.22,.61,.36,1)';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  let pendingViewBackward = false;

  function ensureStyles() {
    if (document.querySelector('link[data-oitucards-animations-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/animations.css?v=20260823-1525';
    link.dataset.oitucardsAnimationsCss = 'true';
    document.head.appendChild(link);
  }

  function canAnimate() {
    return !reducedMotion && typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  }

  function animate(el, frames, options) {
    if (!canAnimate() || !el || el.classList.contains('hidden')) return null;
    try {
      return el.animate(frames, { fill: 'none', ...options });
    } catch (_) {
      return null;
    }
  }

  function treeKey(row) {
    if (row.dataset.folderId) return `folder:${row.dataset.folderId}`;
    if (row.dataset.deckId) return `deck:${row.dataset.deckId}`;
    return null;
  }

  function pickerKey(row, index) {
    if (row.dataset.addPickerFolder) return `folder:${row.dataset.addPickerFolder}`;
    if (row.dataset.existingDeck) return `deck:${row.dataset.existingDeck}`;
    if (row.hasAttribute('data-add-picker-root')) return 'root';
    return `row:${index}`;
  }

  function captureKeyed(container, selector, keyFor) {
    const map = new Map();
    if (!container) return map;
    $$(selector, container).forEach((el, index) => {
      const key = keyFor(el, index);
      if (!key) return;
      const rect = el.getBoundingClientRect();
      map.set(key, { el, top: rect.top });
    });
    return map;
  }

  function animateLayout(before, after) {
    if (!canAnimate()) return;
    let count = 0;

    for (const [key, current] of after) {
      if (count >= MAX_LAYOUT_ITEMS) break;
      const previous = before.get(key);

      if (previous) {
        const deltaY = previous.top - current.top;
        if (Math.abs(deltaY) < 0.75) continue;
        count += 1;
        animate(
          current.el,
          [
            { transform: `translate3d(0, ${deltaY}px, 0)` },
            { transform: 'translate3d(0,0,0)' }
          ],
          { duration: LAYOUT_MS, easing: EASE }
        );
        continue;
      }

      count += 1;
      animate(
        current.el,
        [
          { opacity: .35, transform: 'translate3d(0,-3px,0)' },
          { opacity: 1, transform: 'translate3d(0,0,0)' }
        ],
        { duration: LAYOUT_MS, easing: EASE }
      );
    }
  }

  function watchOneMutation(container, selector, keyFor) {
    if (!canAnimate() || !container) return;
    const before = captureKeyed(container, selector, keyFor);
    let finished = false;

    const observer = new MutationObserver(() => finish());
    const timeoutId = setTimeout(() => {
      if (!finished) observer.disconnect();
      finished = true;
    }, 280);

    function finish() {
      if (finished) return;
      finished = true;
      observer.disconnect();
      clearTimeout(timeoutId);
      const after = captureKeyed(container, selector, keyFor);
      animateLayout(before, after);
    }

    observer.observe(container, { childList: true });
  }

  function captureElementLayout(elements) {
    const map = new Map();
    elements.forEach((el) => {
      if (!(el instanceof Element) || el.classList.contains('hidden')) return;
      map.set(el, el.getBoundingClientRect().top);
    });
    return map;
  }

  function animatePersistentLayout(before, elements) {
    if (!canAnimate()) return;
    let count = 0;
    elements.forEach((el) => {
      if (count >= MAX_LAYOUT_ITEMS || !(el instanceof Element) || el.classList.contains('hidden')) return;
      const oldTop = before.get(el);
      if (oldTop == null) return;
      const newTop = el.getBoundingClientRect().top;
      const deltaY = oldTop - newTop;
      if (Math.abs(deltaY) < 0.75) return;
      count += 1;
      animate(
        el,
        [
          { transform: `translate3d(0, ${deltaY}px, 0)` },
          { transform: 'translate3d(0,0,0)' }
        ],
        { duration: LAYOUT_MS, easing: EASE }
      );
    });
  }

  function handleCollapsibleClick(event) {
    const folderToggle = event.target.closest('[data-toggle-folder]');
    if (folderToggle) {
      watchOneMutation($('#deckList'), '.library-tree-row', treeKey);
      return;
    }

    const picker = event.target.closest('[data-add-picker-folder]');
    if (picker) {
      const container = picker.closest('.library-tree-picker, .library-modal-list');
      watchOneMutation(container, ':scope > *', pickerKey);
      return;
    }

    const redoTrigger = event.target.closest('.visual-redo-trigger');
    if (!redoTrigger) return;

    const card = redoTrigger.closest('.study-config-card');
    if (!card) return;
    const elements = [...card.children];
    const before = captureElementLayout(elements);
    const options = redoTrigger.parentElement?.querySelector('.redo-options') || redoTrigger.nextElementSibling;
    const wasOpen = redoTrigger.classList.contains('is-open');

    queueMicrotask(() => {
      animatePersistentLayout(before, elements);
      if (!wasOpen && options && !options.classList.contains('hidden') && !options.classList.contains('visual-collapsed')) {
        animate(
          options,
          [
            { opacity: .72 },
            { opacity: 1 }
          ],
          { duration: 190, easing: EASE }
        );
      }
    });
  }

  const backwardSelectors = [
    '#homeButton', '#backHomeButton', '#studyConfigBackButton', '#cancelStudyConfigButton',
    '#studyHomeButton', '#studyAgainButton', '#reviewSettingsBackButton', '#cancelReviewSettingsButton',
    '#multiBackHome', '#multiCancel', '#multiHome', '#multiAgain', '#exitStudyButton', '#multiExit'
  ].join(',');

  const viewTriggerSelectors = [
    backwardSelectors,
    '.deck-name-button', '[data-action="edit-deck"]', '[data-study-folder]', '#studySelectedButton',
    '#startStudyButton', '#reviewSettingsButton', '#multiStart'
  ].join(',');

  function animateIncomingView(view, backward) {
    if (!view || view.dataset.ocMotionView === 'running') return;
    view.dataset.ocMotionView = 'running';
    const x = backward ? -2 : 2;
    const animation = animate(
      view,
      [
        { opacity: .82, transform: `translate3d(${x}px,1px,0)` },
        { opacity: 1, transform: 'translate3d(0,0,0)' }
      ],
      { duration: VIEW_MS, easing: EASE }
    );
    const done = () => delete view.dataset.ocMotionView;
    if (animation) animation.finished.then(done).catch(done);
    else done();
  }

  function installViewObservers() {
    $$('.view').forEach((view) => {
      if (view.dataset.ocMotionViewObserved === 'true') return;
      view.dataset.ocMotionViewObserved = 'true';
      const observer = new MutationObserver(() => {
        if (!view.classList.contains('active')) return;
        animateIncomingView(view, pendingViewBackward);
        pendingViewBackward = false;
      });
      observer.observe(view, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function visibleModalIds() {
    return new Set($$('.modal-backdrop:not(.hidden)').map((modal) => modal.id));
  }

  function animateNewModals(before) {
    if (!canAnimate()) return;
    $$('.modal-backdrop:not(.hidden)').forEach((backdrop) => {
      if (before.has(backdrop.id)) return;
      animate(backdrop, [{ opacity: .6 }, { opacity: 1 }], { duration: MODAL_MS, easing: 'ease-out' });
      const modal = $('.modal', backdrop);
      animate(
        modal,
        [
          { opacity: .72, transform: 'translate3d(0,3px,0) scale(.997)' },
          { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }
        ],
        { duration: MODAL_MS, easing: EASE }
      );
    });
  }

  function animateBackSection(back) {
    animate(
      back,
      [
        { opacity: .76, transform: 'translate3d(0,-2px,0)' },
        { opacity: 1, transform: 'translate3d(0,0,0)' }
      ],
      { duration: REVEAL_MS, easing: EASE }
    );
  }

  function animateRatingsArea(area) {
    animate(
      area,
      [
        { opacity: .78, transform: 'translate3d(0,2px,0)' },
        { opacity: 1, transform: 'translate3d(0,0,0)' }
      ],
      { duration: REVEAL_MS + 15, easing: EASE }
    );

    $$('.rating-button:not(.hidden)', area).forEach((button, index) => {
      animate(
        button,
        [
          { opacity: .72, transform: 'translate3d(0,2px,0)' },
          { opacity: 1, transform: 'translate3d(0,0,0)' }
        ],
        { duration: REVEAL_MS + 20, delay: Math.min(index * 12, 48), easing: EASE }
      );
    });
  }

  function installRevealObserver(id, onReveal) {
    const el = document.getElementById(id);
    if (!el || el.dataset.ocMotionRevealObserved === 'true') return;
    el.dataset.ocMotionRevealObserved = 'true';
    let wasHidden = el.classList.contains('hidden');
    const observer = new MutationObserver(() => {
      const hidden = el.classList.contains('hidden');
      if (wasHidden && !hidden) onReveal(el);
      wasHidden = hidden;
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  }

  function installRevealObservers() {
    installRevealObserver('studyBackSection', animateBackSection);
    installRevealObserver('studyRatingArea', animateRatingsArea);
    installRevealObserver('multiBackSection', animateBackSection);
    installRevealObserver('multiRatings', animateRatingsArea);
  }

  function handleGeneralClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    installViewObservers();
    installRevealObservers();

    const beforeModals = visibleModalIds();
    const viewTrigger = target.closest(viewTriggerSelectors);
    if (viewTrigger) {
      pendingViewBackward = Boolean(viewTrigger.matches(backwardSelectors) || viewTrigger.closest(backwardSelectors));
    }

    if (target.closest('button,.button,.action-button,.icon-button,.link-button,.deck-name-button')) {
      requestAnimationFrame(() => animateNewModals(beforeModals));
    }
  }

  function init() {
    ensureStyles();
    document.documentElement.classList.add('oc-motion-enabled');
    installViewObservers();
    installRevealObservers();
    document.addEventListener('click', handleCollapsibleClick, true);
    document.addEventListener('click', handleGeneralClick, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();