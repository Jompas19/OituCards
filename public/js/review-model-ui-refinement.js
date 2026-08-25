(function () {
  if (window.__oitucardsReviewModelUiRefinement) return;
  window.__oitucardsReviewModelUiRefinement = true;

  const CREATE_VALUE = "__create_review_model__";
  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
  let decorating = false;
  let globalSelectObserver = null;

  const $ = (selector, root = document) => root.querySelector(selector);

  function currentGlobalValue() {
    const stored = String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system");
    return stored === CREATE_VALUE ? "system" : stored;
  }

  function ensureStyle() {
    if ($("#reviewModelUiRefinementStyle")) return;
    const style = document.createElement("style");
    style.id = "reviewModelUiRefinementStyle";
    style.textContent = `
      #studyReviewModelSetting{display:none!important}
      #globalReviewModelHelp,#createReviewModelFromSettings{display:none!important}
    `;
    document.head.appendChild(style);
  }

  function normalizeSystemOption(select) {
    const system = [...(select?.options || [])].find((option) => option.value === "system");
    if (system && system.textContent !== "Padrão OituCards") system.textContent = "Padrão OituCards";
  }

  function ensureCreateOption(select) {
    const matches = [...select.options].filter((option) => option.value === CREATE_VALUE);
    matches.slice(1).forEach((option) => option.remove());
    let option = matches[0] || null;
    if (!option) {
      option = new Option("＋ Criar novo modelo…", CREATE_VALUE);
      select.add(option);
      return;
    }
    if (option.textContent !== "＋ Criar novo modelo…") option.textContent = "＋ Criar novo modelo…";
    if (select.options[select.options.length - 1] !== option) select.appendChild(option);
  }

  function decorateGlobalSelect() {
    if (decorating) return;
    const select = $("#globalReviewModelSelect");
    if (!select) return;
    decorating = true;
    try {
      normalizeSystemOption(select);
      ensureCreateOption(select);
      const current = currentGlobalValue();
      if (select.value === CREATE_VALUE && [...select.options].some((option) => option.value === current)) {
        select.value = current;
      }
    } finally {
      decorating = false;
    }
  }

  function decorateReviewSettingsSelect() {
    normalizeSystemOption($("#reviewSettingsModelSelect"));
  }

  function decorateAll() {
    ensureStyle();
    decorateGlobalSelect();
    decorateReviewSettingsSelect();
  }

  function watchGlobalSelect() {
    const select = $("#globalReviewModelSelect");
    if (!select || select.dataset.refinementObserved === "true") return;
    select.dataset.refinementObserved = "true";
    globalSelectObserver?.disconnect();
    globalSelectObserver = new MutationObserver(() => decorateGlobalSelect());
    globalSelectObserver.observe(select, { childList: true });
  }

  document.addEventListener("change", (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.id !== "globalReviewModelSelect") return;
    if (select.value !== CREATE_VALUE) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const previous = currentGlobalValue();
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    else select.value = "system";

    $("#createReviewModelFromSettings")?.click();
    setTimeout(decorateAll, 0);
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("#themeToggle,#reviewSettingsButton,#saveReviewModelButton,#loadReviewModelButton")) {
      setTimeout(() => {
        decorateAll();
        watchGlobalSelect();
      }, 0);
    }
  });

  function init() {
    decorateAll();
    watchGlobalSelect();
    setTimeout(() => {
      decorateAll();
      watchGlobalSelect();
    }, 0);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
