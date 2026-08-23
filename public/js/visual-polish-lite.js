(function () {
  const $ = (selector, root = document) => root.querySelector(selector);

  function ensureStyles() {
    if (document.querySelector('link[data-oitucards-visual-polish-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/visual-polish.css?v=20260823-1507';
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
    if (copy) {
      let helper = $('.visual-filter-default-hint', copy);
      if (!helper) {
        helper = document.createElement('span');
        helper.className = 'visual-filter-default-hint';
        copy.appendChild(helper);
      }
      helper.textContent = helperText;
    }

    // A explicação principal já está fixa abaixo do título; não exibir tooltip neste bloco.
    row.classList.remove('visual-help-row');
    delete row.dataset.visualHelp;
  }

  function redoConfigForTile(tile) {
    if (tile.closest('#studyRedoOptions')) {
      return {
        options: $('#studyRedoOptions'),
        checkbox: $('#studyRedoCheckbox'),
        groupName: 'redoMode'
      };
    }
    if (tile.closest('#multiRedoOptions')) {
      return {
        options: $('#multiRedoOptions'),
        checkbox: $('#multiRedo'),
        groupName: 'multiRedoMode'
      };
    }
    return null;
  }

  function handleRedoTileClick(event) {
    const tile = event.target.closest('.redo-option');
    if (!tile) return;

    const config = redoConfigForTile(tile);
    if (!config?.options || !config.checkbox) return;

    const radio = $('input[type="radio"]', tile);
    if (!radio) return;

    // Assume totalmente o clique para evitar o comportamento nativo irreversível de radio.
    event.preventDefault();
    event.stopImmediatePropagation();

    const wasSelected = radio.checked;
    config.options.querySelectorAll(`input[name="${config.groupName}"]`).forEach((item) => {
      item.checked = false;
    });

    if (!wasSelected) radio.checked = true;
    config.checkbox.checked = !wasSelected;

    // O listener original do checkbox atualiza filtros, quantidade e modo de revisão.
    config.checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    radio.focus({ preventScroll: true });
  }

  function syncRatingLayout(areaSelector, repeatSelector, hardSelector) {
    const area = $(areaSelector);
    const repeat = $(repeatSelector);
    const hard = $(hardSelector);
    if (!area || !repeat || !hard) return;
    area.classList.toggle('visual-no-repeat', !hard.classList.contains('hidden') && repeat.classList.contains('hidden'));
  }

  function sync() {
    decorateFilter('#studyNormalFilterSetting', 'Sem marcar nada: cards novos + revisões de hoje.');
    decorateFilter('#multiNormalFilters', 'Sem marcar nada: cards novos + revisões de hoje.');
    syncRatingLayout('#studyRatingArea', '#ratingRepeat', '#ratingHard');
    syncRatingLayout('#multiRatings', '#multiRateRepeat', '#multiRateHard');
  }

  function scheduleSync() {
    requestAnimationFrame(() => requestAnimationFrame(sync));
  }

  function bindEvents() {
    // Captura o clique antes dos listeners antigos dos radios/labels.
    document.addEventListener('click', handleRedoTileClick, true);

    document.addEventListener('change', (event) => {
      if (event.target.matches('#studyReviewCheckbox,#multiRepeat,#studyRedoCheckbox,#multiRedo,input[name="redoMode"],input[name="multiRedoMode"]')) {
        scheduleSync();
      }
    });

    document.addEventListener('click', (event) => {
      if (event.target.closest('#startStudyButton,#multiStart,#studyAgainButton,#multiAgain')) scheduleSync();
    });
  }

  function init() {
    ensureStyles();
    sync();
    bindEvents();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
