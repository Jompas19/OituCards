(function () {
  if (window.__oitucardsReviewModelsBootstrap) return;
  window.__oitucardsReviewModelsBootstrap = true;

  function loadFolderReviewUnitFix() {
    if (document.querySelector('script[data-oitucards-folder-review-unit-fix]')) return;
    const fix = document.createElement("script");
    fix.async = false;
    fix.src = "js/folder-review-unit-fix.js?v=20260831-2145";
    fix.dataset.oitucardsFolderReviewUnitFix = "true";
    fix.onerror = () => console.error("Não foi possível carregar a correção das unidades herdadas da pasta.");
    document.body.appendChild(fix);
  }

  function loadReviewTimePromotion() {
    const existing = document.querySelector('script[data-oitucards-review-time-promotion]');
    if (existing) {
      if (existing.dataset.loaded === "true") loadFolderReviewUnitFix();
      else existing.addEventListener("load", loadFolderReviewUnitFix, { once: true });
      return;
    }
    const promotion = document.createElement("script");
    promotion.async = false;
    promotion.src = "js/review-time-promotion.js?v=20260831-2050";
    promotion.dataset.oitucardsReviewTimePromotion = "true";
    promotion.addEventListener("load", () => {
      promotion.dataset.loaded = "true";
      loadFolderReviewUnitFix();
    }, { once: true });
    promotion.onerror = () => {
      console.error("Não foi possível carregar a promoção automática das unidades de revisão.");
      loadFolderReviewUnitFix();
    };
    document.body.appendChild(promotion);
  }

  function loadReviewTimeUnits() {
    const existing = document.querySelector('script[data-oitucards-review-time-units]');
    if (existing) {
      if (existing.dataset.loaded === "true") loadReviewTimePromotion();
      else existing.addEventListener("load", loadReviewTimePromotion, { once: true });
      return;
    }
    const units = document.createElement("script");
    units.async = false;
    units.src = "js/review-time-units.js?v=20260831-1815";
    units.dataset.oitucardsReviewTimeUnits = "true";
    units.addEventListener("load", () => {
      units.dataset.loaded = "true";
      loadReviewTimePromotion();
    }, { once: true });
    units.onerror = () => console.error("Não foi possível carregar o suporte a revisões em minutos, horas e dias.");
    document.body.appendChild(units);
  }

  function loadImportLibraryFinalRefresh() {
    const existing = document.querySelector('script[data-oitucards-import-library-final-refresh]');
    if (existing) {
      if (existing.dataset.loaded === "true") loadReviewTimeUnits();
      else existing.addEventListener("load", loadReviewTimeUnits, { once: true });
      return;
    }
    const refresh = document.createElement("script");
    refresh.async = false;
    refresh.src = "js/import-library-final-refresh.js?v=20260831-0015";
    refresh.dataset.oitucardsImportLibraryFinalRefresh = "true";
    refresh.addEventListener("load", () => {
      refresh.dataset.loaded = "true";
      loadReviewTimeUnits();
    }, { once: true });
    refresh.onerror = () => {
      console.error("Não foi possível carregar a atualização final da biblioteca após importação.");
      loadReviewTimeUnits();
    };
    document.body.appendChild(refresh);
  }

  function loadLibraryWorkflowUxLite() {
    if (document.querySelector('script[data-oitucards-library-workflow-ux-lite]')) {
      loadImportLibraryFinalRefresh();
      return;
    }
    const workflow = document.createElement("script");
    workflow.async = false;
    workflow.src = "js/library-workflow-ux-lite.js?v=20260830-2245";
    workflow.dataset.oitucardsLibraryWorkflowUxLite = "true";
    workflow.addEventListener("load", loadImportLibraryFinalRefresh, { once: true });
    workflow.onerror = () => console.error("Não foi possível carregar as melhorias leves da biblioteca.");
    document.body.appendChild(workflow);
  }

  function loadCreateDefaults() {
    if (document.querySelector('script[data-oitucards-review-model-create-defaults]')) {
      loadLibraryWorkflowUxLite();
      return;
    }
    const defaults = document.createElement("script");
    defaults.async = false;
    defaults.src = "js/review-model-create-defaults.js?v=20260830-2145";
    defaults.dataset.oitucardsReviewModelCreateDefaults = "true";
    defaults.addEventListener("load", loadLibraryWorkflowUxLite, { once: true });
    defaults.onerror = () => console.error("Não foi possível carregar o padrão inicial dos novos modelos de revisão.");
    document.body.appendChild(defaults);
  }

  function loadReviewSettingsUx() {
    if (document.querySelector('script[data-oitucards-review-settings-ux]')) {
      loadCreateDefaults();
      return;
    }
    const ux = document.createElement("script");
    ux.async = false;
    ux.src = "js/review-settings-ux.js?v=20260830-2135";
    ux.dataset.oitucardsReviewSettingsUx = "true";
    ux.addEventListener("load", loadCreateDefaults, { once: true });
    ux.onerror = () => console.error("Não foi possível carregar os refinamentos dos ajustes de revisão.");
    document.body.appendChild(ux);
  }

  function loadFolderSelectionFix() {
    if (document.querySelector('script[data-oitucards-review-model-folder-selection-fix]')) {
      loadReviewSettingsUx();
      return;
    }
    const fix = document.createElement("script");
    fix.async = false;
    fix.src = "js/review-model-folder-selection-fix.js?v=20260830-2105";
    fix.dataset.oitucardsReviewModelFolderSelectionFix = "true";
    fix.addEventListener("load", loadReviewSettingsUx, { once: true });
    fix.onerror = () => console.error("Não foi possível carregar a correção da seleção de modelo das pastas.");
    document.body.appendChild(fix);
  }

  function loadDefaultFollow() {
    if (document.querySelector('script[data-oitucards-review-model-default-follow]')) {
      loadFolderSelectionFix();
      return;
    }
    const defaults = document.createElement("script");
    defaults.async = false;
    defaults.src = "js/review-model-default-follow.js?v=20260830-2045";
    defaults.dataset.oitucardsReviewModelDefaultFollow = "true";
    defaults.addEventListener("load", loadFolderSelectionFix, { once: true });
    defaults.onerror = () => console.error("Não foi possível carregar a regra padrão dos modelos de revisão.");
    document.body.appendChild(defaults);
  }

  function loadSelectionState() {
    if (document.querySelector('script[data-oitucards-review-model-selection-state]')) {
      loadDefaultFollow();
      return;
    }
    const selection = document.createElement("script");
    selection.async = false;
    selection.src = "js/review-model-selection-state.js?v=20260830-1535";
    selection.dataset.oitucardsReviewModelSelectionState = "true";
    selection.addEventListener("load", loadDefaultFollow, { once: true });
    selection.onerror = () => console.error("Não foi possível carregar o estado dos modelos de revisão.");
    document.body.appendChild(selection);
  }

  function loadUiRefinement() {
    if (document.querySelector('script[data-oitucards-review-model-ui-refinement]')) {
      loadSelectionState();
      return;
    }
    const refinement = document.createElement("script");
    refinement.async = false;
    refinement.src = "js/review-model-ui-refinement.js?v=20260830-1530";
    refinement.dataset.oitucardsReviewModelUiRefinement = "true";
    refinement.addEventListener("load", loadSelectionState, { once: true });
    refinement.onerror = () => console.error("Não foi possível carregar o refinamento dos modelos de revisão.");
    document.body.appendChild(refinement);
  }

  const script = document.createElement("script");
  script.async = false;
  script.src = "js/review-presets.js?v=20260825-1548";
  script.dataset.oitucardsReviewModelsCore = "true";
  script.addEventListener("load", loadUiRefinement, { once: true });
  script.onerror = () => console.error("Não foi possível carregar os modelos de revisão.");
  document.body.appendChild(script);
})();