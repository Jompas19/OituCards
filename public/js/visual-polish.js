(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const folderProgressCache = new Map();
  let syncQueued = false;
  let homeWasActive = false;
  let homeRevealTimer = null;

  function ensureStyles() {
    if (document.querySelector('link[data-oitucards-visual-polish-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/visual-polish.css?v=20260823-1435';
    link.dataset.oitucardsVisualPolishCss = 'true';
    document.head.appendChild(link);
  }

  function decorateFilter(filterSelector, helperText) {
    const row = $(filterSelector);
    if (!row) return;
    const title = $('.study-setting-title', row);
    if (title) {
      title.classList.add('visual-filter-title');
      title.dataset.visualTitle = 'Quer estudar só um tipo?';
    }

    const copy = title?.parentElement || row.firstElementChild;
    if (!copy) return;
    let helper = $('.visual-filter-default-hint', copy);
    if (!helper) {
      helper = document.createElement('span');
      helper.className = 'visual-filter-default-hint';
      copy.appendChild(helper);
    }
    if (helper.textContent !== helperText) helper.textContent = helperText;
  }

  function bindRedoTiles(optionsSelector) {
    const options = $(optionsSelector);
    if (!options) return;

    $$('.redo-option', options).forEach((tile) => {
      const radio = $('input[type="radio"]', tile);
      if (!radio || tile.dataset.visualFullTileBound === 'true') return;
      tile.dataset.visualFullTileBound = 'true';

      tile.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        tile.dataset.visualWasChecked = String(radio.checked);
      });

      tile.addEventListener('click', (event) => {
        if (event.target === radio) return;
        event.preventDefault();
        radio.dataset.wasChecked = tile.dataset.visualWasChecked || String(radio.checked);
        radio.click();
        radio.focus({ preventScroll: true });
      });

      tile.addEventListener('keydown', (event) => {
        if (event.target !== tile || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        radio.dataset.wasChecked = String(radio.checked);
        radio.click();
        radio.focus({ preventScroll: true });
      });
    });
  }

  function syncRatingLayout(areaSelector, repeatSelector, hardSelector) {
    const area = $(areaSelector);
    const repeat = $(repeatSelector);
    const hard = $(hardSelector);
    if (!area || !repeat || !hard) return;

    const normalRatingsVisible = !hard.classList.contains('hidden');
    const repeatVisible = !repeat.classList.contains('hidden');
    area.classList.toggle('visual-no-repeat', normalRatingsVisible && !repeatVisible);
  }

  function captureFolderProgress(root) {
    if (!(root instanceof Element)) return;
    const rows = root.matches('[data-folder-id]')
      ? [root]
      : $$('[data-folder-id]', root);

    rows.forEach((row) => {
      const progressLine = $('.folder-aggregate-progress', row);
      if (!progressLine) return;
      folderProgressCache.set(row.dataset.folderId, {
        progress: progressLine.dataset.progress || '',
        html: progressLine.innerHTML
      });
    });
  }

  function restoreFolderProgress() {
    $$('#deckList [data-folder-id]').forEach((row) => {
      const main = $('.folder-main', row);
      if (!main || $('.folder-aggregate-progress', main)) return;
      const cached = folderProgressCache.get(row.dataset.folderId);
      if (!cached) return;

      const line = document.createElement('div');
      line.className = 'folder-aggregate-progress';
      line.dataset.progress = cached.progress;
      line.innerHTML = cached.html;
      main.appendChild(line);
    });
  }

  function revealStableHome() {
    const home = $('#homeView');
    if (!home?.classList.contains('visual-home-entering')) return;
    clearTimeout(homeRevealTimer);
    requestAnimationFrame(() => home.classList.remove('visual-home-entering'));
  }

  function installLibraryStability() {
    const home = $('#homeView');
    const list = $('#deckList');
    if (!home || !list || list.dataset.visualStabilityBound === 'true') return;
    list.dataset.visualStabilityBound = 'true';

    captureFolderProgress(list);
    homeWasActive = home.classList.contains('active');

    const homeObserver = new MutationObserver(() => {
      const active = home.classList.contains('active');
      if (active && !homeWasActive) {
        homeWasActive = true;
        home.classList.add('visual-home-entering');
        clearTimeout(homeRevealTimer);
        homeRevealTimer = setTimeout(() => home.classList.remove('visual-home-entering'), 350);
        return;
      }
      if (!active) {
        homeWasActive = false;
        clearTimeout(homeRevealTimer);
        home.classList.remove('visual-home-entering');
      }
    });
    homeObserver.observe(home, { attributes: true, attributeFilter: ['class'] });

    const listObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => captureFolderProgress(node));
      });
      restoreFolderProgress();
      captureFolderProgress(list);
      revealStableHome();
    });
    listObserver.observe(list, { childList: true, subtree: true });
  }

  function syncUI() {
    decorateFilter('#studyNormalFilterSetting', 'Sem marcar nada: cards novos + revisões de hoje.');
    decorateFilter('#multiNormalFilters', 'Sem marcar nada: cards novos + revisões de hoje.');
    bindRedoTiles('#studyRedoOptions');
    bindRedoTiles('#multiRedoOptions');
    syncRatingLayout('#studyRatingArea', '#ratingRepeat', '#ratingHard');
    syncRatingLayout('#multiRatings', '#multiRateRepeat', '#multiRateHard');
    restoreFolderProgress();
  }

  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      syncUI();
    });
  }

  function observeApp() {
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === 'childList' || mutation.attributeName === 'class')) {
        scheduleSync();
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }

  function init() {
    ensureStyles();
    syncUI();
    installLibraryStability();
    observeApp();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
