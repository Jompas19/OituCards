(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function ensureStyles() {
    if (!document.querySelector('link[data-oitucards-visual-polish-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'css/visual-polish.css?v=20260823-1600';
      link.dataset.oitucardsVisualPolishCss = 'true';
      document.head.appendChild(link);
    }

    if (!document.querySelector('link[data-oitucards-study-tooltip-refinement-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'css/study-tooltip-refinement.css?v=20260823-1607';
      link.dataset.oitucardsStudyTooltipRefinementCss = 'true';
      document.head.appendChild(link);
    }
  }

  function removeTooltip(row, removeNested = false) {
    if (!row) return;
    row.classList.remove('visual-help-row');
    delete row.dataset.visualHelp;
    row.classList.add('visual-fixed-helper-row');

    if (removeNested) {
      $$('.visual-option-help', row).forEach((option) => {
        option.classList.remove('visual-option-help');
        delete option.dataset.visualHelp;
      });
    }
  }

  function ensureFixedHint(row, helperText, className) {
    if (!row) return;
    const title = $('.study-setting-title', row);
    const copy = title?.parentElement || row.firstElementChild;
    if (!copy) return;

    let helper = $(`.${className}`, copy);
    if (!helper) {
      helper = document.createElement('span');
      helper.className = `visual-filter-default-hint ${className}`;
      copy.appendChild(helper);
    }
    helper.textContent = helperText;
  }

  function decorateFilter(filterSelector, helperText) {
    const row = $(filterSelector);
    if (!row) return;

    const title = $('.study-setting-title', row);
    if (title) {
      title.classList.add('visual-filter-title');
      title.dataset.visualTitle = 'Quer estudar só um tipo?';
    }

    ensureFixedHint(row, helperText, 'visual-filter-fixed-hint');
    removeTooltip(row, true);
  }

  function decorateQuantity(inputSelector, helperText) {
    const input = $(inputSelector);
    const row = input?.closest('.study-setting');
    if (!row) return;

    ensureFixedHint(row, helperText, 'visual-quantity-fixed-hint');
    removeTooltip(row, false);
  }

  function decorateRedoHelp(optionsSelector) {
    const options = $(optionsSelector);
    if (!options) return;

    $$('.redo-option', options).forEach((tile) => {
      const label = $('strong', tile)?.textContent?.trim().toLowerCase() || '';
      if (label.includes('reiniciar')) {
        tile.dataset.visualHelp = 'Zera o progresso e reinicia a agenda dos cards.';
        tile.classList.add('visual-option-help');
      } else if (label.includes('manter')) {
        tile.dataset.visualHelp = 'Refaz agora sem alterar o progresso nem a agenda.';
        tile.classList.add('visual-option-help');
      }
    });
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

    decorateQuantity('#studyCountInput', 'Digite uma quantidade ou marque Fazer todos.');
    decorateQuantity('#multiCount', 'Digite uma quantidade ou marque Fazer todos.');

    decorateRedoHelp('#studyRedoOptions');
    decorateRedoHelp('#multiRedoOptions');

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
