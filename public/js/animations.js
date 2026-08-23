(function () {
  const MAX_LAYOUT_ITEMS = 32;
  const LAYOUT_MS = 210;
  const VIEW_MS = 190;
  const REVEAL_MS = 200;
  const MODAL_MS = 175;
  const EASE = 'cubic-bezier(.22,.61,.36,1)';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

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

    requestAnimationFrame(() => requestAnimationFrame(() => {
      animatePersistentLayout(before, elements);
      if (!wasOpen && options && !options.classList.contains('hidden') && !options.classList.contains('visual-collapsed')) {
        animate(
          options,
          [
            { opacity: .45, transform: 'translate3d(0,-3px,0)' },
            { opacity: 1, transform: 'translate3d(0,0,0)' }
          ],
          { duration: LAYOUT_MS, easing: EASE }
        );
      }
    }));
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
    const x = backward ? -3 : 3;
    const animation = animate(
      view,
      [
        { opacity: .55, transform: `translate3d(${x}px,1px,0)` },
        { opacity: 1, transform: 'translate3d(0,0,0)' }
      ],
      { duration: VIEW_MS, easing: EASE }
    );
    const done = () => delete view.dataset.ocMotionView;
    if (animation) animation.finished.then(done).catch(done);
    else done();
  }

  function watchViewChange(beforeId, backward, startedAt = performance.now()) {
    if (!canAnimate()) return;
    const active = $('.view.active');
    if (active && active.id !== beforeId) {
      animateIncomingView(active, backward);
      return;
    }
    if (performance.now() - startedAt < 260) setTimeout(() => watchViewChange(beforeId, backward, startedAt), 20);
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

  function resetRevealMarkers() {
    ['studyBackSection', 'studyRatingArea', 'multiBackSection', 'multiRatings'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) delete el.dataset.ocMotionReveal;
    });
  }

  function animateReveal(backId, ratingsId) {
    const back = document.getElementById(backId);
    const ratings = document.getElementById(ratingsId);
    if (!back || back.classList.contains('hidden') || back.dataset.ocMotionReveal === 'true') return;
    back.dataset.ocMotionReveal = 'true';
    if (ratings) ratings.dataset.ocMotionReveal = 'true';

    animate(
      back,
      [
        { opacity: .45, transform: 'translate3d(0,-3px,0)' },
        { opacity: 1, transform: 'translate3d(0,0,0)' }
      ],
      { duration: REVEAL_MS, easing: EASE }
    );
    animate(
      ratings,
      [
        { opacity: .4, transform: 'translate3d(0,4px,0)' },
        { opacity: 1, transform: 'translate3d(0,0,0)' }
      ],
      { duration: REVEAL_MS + 25, delay: 24, easing: EASE }
    );
  }

  function scheduleRevealAnimation(kind) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (kind === 'multi') animateReveal('multiBackSection', 'multiRatings');
      else animateReveal('studyBackSection', 'studyRatingArea');
    }));
  }

  function handleGeneralClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const beforeView = $('.view.active')?.id || '';
    const beforeModals = visibleModalIds();
    const viewTrigger = target.closest(viewTriggerSelectors);
    if (viewTrigger) {
      const backward = Boolean(viewTrigger.matches(backwardSelectors) || viewTrigger.closest(backwardSelectors));
      setTimeout(() => watchViewChange(beforeView, backward), 0);
    }

    if (target.closest('button,.button,.action-button,.icon-button,.link-button,.deck-name-button')) {
      requestAnimationFrame(() => animateNewModals(beforeModals));
    }

    if (target.closest('#studyCard')) scheduleRevealAnimation('single');
    if (target.closest('#multiCard')) scheduleRevealAnimation('multi');

    if (target.closest('[data-rating],#studyPrevButton,#studyNextButton,#startStudyButton,#studyAgainButton,[data-multi-rating],#multiPrev,#multiNextArrow,#multiStart,#multiAgain')) {
      resetRevealMarkers();
    }
  }

  function handleKeydown(event) {
    if (event.code === 'Space') {
      if ($('#studyView.active')) scheduleRevealAnimation('single');
      if ($('#multiStudyView.active')) scheduleRevealAnimation('multi');
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || /^[0-4]$/.test(event.key)) resetRevealMarkers();
  }

  function init() {
    ensureStyles();
    document.documentElement.classList.add('oc-motion-enabled');
    document.addEventListener('click', handleCollapsibleClick, true);
    document.addEventListener('click', handleGeneralClick, true);
    document.addEventListener('keydown', handleKeydown, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();