(function () {
  const MAX_TREE_ROWS = 32;
  const OPEN_MS = 125;
  const CLOSE_MS = 90;
  const VIEW_MS = 135;
  const REVEAL_MS = 145;

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
      return el.animate(frames, { fill: 'both', ...options });
    } catch (_) {
      return null;
    }
  }

  function depthOf(row, variable) {
    const raw = row?.style?.getPropertyValue(variable) || '0';
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : 0;
  }

  function rowsBelowFolder(folderId) {
    const list = $('#deckList');
    if (!list) return [];
    const rows = $$('.library-tree-row', list);
    const index = rows.findIndex((row) => row.dataset.folderId === folderId);
    if (index < 0) return [];
    const baseDepth = depthOf(rows[index], '--tree-depth');
    const descendants = [];
    for (let i = index + 1; i < rows.length; i += 1) {
      const depth = depthOf(rows[i], '--tree-depth');
      if (depth <= baseDepth) break;
      descendants.push(rows[i]);
    }
    return descendants;
  }

  function pickerRowsBelow(button) {
    const container = button.closest('.library-tree-picker, .library-modal-list');
    if (!container) return [];
    const rows = [...container.children];
    const index = rows.indexOf(button);
    if (index < 0) return [];
    const baseDepth = depthOf(button, '--picker-depth');
    const descendants = [];
    for (let i = index + 1; i < rows.length; i += 1) {
      const row = rows[i];
      const depth = depthOf(row, '--picker-depth');
      if (row.matches('.library-picker-root') || depth <= baseDepth) break;
      descendants.push(row);
    }
    return descendants;
  }

  function animateRowsDown(rows) {
    if (!canAnimate() || !rows.length) return;
    rows.slice(0, MAX_TREE_ROWS).forEach((row, index) => {
      animate(row,
        [{ opacity: 0, transform: 'translateY(-7px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: OPEN_MS, delay: Math.min(index * 2, 34), easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
    });
  }

  function animateRowsUp(rows) {
    if (!canAnimate() || !rows.length || rows.length > MAX_TREE_ROWS) return false;
    rows.forEach((row, index) => {
      animate(row,
        [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-6px)' }],
        { duration: CLOSE_MS, delay: Math.min(index, 18), easing: 'cubic-bezier(.4,0,.8,.2)' }
      );
    });
    return true;
  }

  function findFolderToggle(folderId) {
    return $$('[data-toggle-folder]').find((button) => button.dataset.toggleFolder === folderId) || null;
  }

  function scheduleFolderOpenAnimation(folderId, attempt = 0) {
    if (!canAnimate() || attempt > 8) return;
    requestAnimationFrame(() => {
      const button = findFolderToggle(folderId);
      if (button?.getAttribute('aria-expanded') === 'true') {
        animateRowsDown(rowsBelowFolder(folderId));
        return;
      }
      setTimeout(() => scheduleFolderOpenAnimation(folderId, attempt + 1), 16);
    });
  }

  function schedulePickerOpenAnimation(folderId, attempt = 0) {
    if (!canAnimate() || attempt > 5) return;
    requestAnimationFrame(() => {
      const button = $$('[data-add-picker-folder]').find((item) => item.dataset.addPickerFolder === folderId);
      if (button?.getAttribute('aria-expanded') === 'true') {
        animateRowsDown(pickerRowsBelow(button));
        return;
      }
      setTimeout(() => schedulePickerOpenAnimation(folderId, attempt + 1), 16);
    });
  }

  function replayClick(target) {
    target.dataset.ocMotionPass = 'true';
    target.click();
  }

  function handleCollapsibleClick(event) {
    const folderToggle = event.target.closest('[data-toggle-folder]');
    if (folderToggle) {
      if (folderToggle.dataset.ocMotionPass === 'true') {
        delete folderToggle.dataset.ocMotionPass;
        return;
      }
      const folderId = folderToggle.dataset.toggleFolder;
      const isOpen = folderToggle.getAttribute('aria-expanded') === 'true';
      if (!isOpen) {
        scheduleFolderOpenAnimation(folderId);
        return;
      }
      const rows = rowsBelowFolder(folderId);
      if (!animateRowsUp(rows)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setTimeout(() => replayClick(folderToggle), CLOSE_MS - 8);
      return;
    }

    const picker = event.target.closest('[data-add-picker-folder]');
    if (picker) {
      if (picker.dataset.ocMotionPass === 'true') {
        delete picker.dataset.ocMotionPass;
        return;
      }
      const folderId = picker.dataset.addPickerFolder;
      const isOpen = picker.getAttribute('aria-expanded') === 'true';
      if (!isOpen) {
        schedulePickerOpenAnimation(folderId);
        return;
      }
      const rows = pickerRowsBelow(picker);
      if (!animateRowsUp(rows)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setTimeout(() => replayClick(picker), CLOSE_MS - 8);
      return;
    }

    const redoTrigger = event.target.closest('.visual-redo-trigger');
    if (!redoTrigger) return;
    if (redoTrigger.dataset.ocMotionPass === 'true') {
      delete redoTrigger.dataset.ocMotionPass;
      return;
    }

    const options = redoTrigger.parentElement?.querySelector('.redo-options') || redoTrigger.nextElementSibling;
    const isOpen = redoTrigger.classList.contains('is-open');
    if (!isOpen) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!options || options.classList.contains('visual-collapsed') || options.classList.contains('hidden')) return;
        animate(options,
          [{ opacity: 0, transform: 'translateY(-7px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: OPEN_MS, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
      }));
      return;
    }

    if (!options || options.classList.contains('hidden')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    animate(options,
      [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-6px)' }],
      { duration: CLOSE_MS, easing: 'cubic-bezier(.4,0,.8,.2)' }
    );
    setTimeout(() => replayClick(redoTrigger), CLOSE_MS - 8);
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
    const animation = animate(view,
      [
        { opacity: 0, transform: `translate3d(${backward ? '-7px' : '7px'}, ${backward ? '-2px' : '2px'}, 0)` },
        { opacity: 1, transform: 'translate3d(0,0,0)' }
      ],
      { duration: VIEW_MS, easing: 'cubic-bezier(.2,.8,.2,1)' }
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
    if (performance.now() - startedAt < 220) setTimeout(() => watchViewChange(beforeId, backward, startedAt), 18);
  }

  function visibleModalIds() {
    return new Set($$('.modal-backdrop:not(.hidden)').map((modal) => modal.id));
  }

  function animateNewModals(before) {
    if (!canAnimate()) return;
    $$('.modal-backdrop:not(.hidden)').forEach((backdrop) => {
      if (before.has(backdrop.id)) return;
      animate(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 100, easing: 'ease-out' });
      const modal = $('.modal', backdrop);
      animate(modal,
        [{ opacity: .7, transform: 'translateY(6px) scale(.992)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
        { duration: 120, easing: 'cubic-bezier(.2,.8,.2,1)' }
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

    animate(back,
      [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: REVEAL_MS, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );
    animate(ratings,
      [{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: REVEAL_MS + 20, delay: 18, easing: 'cubic-bezier(.2,.8,.2,1)' }
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