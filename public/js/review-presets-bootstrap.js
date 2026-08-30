(function () {
  if (window.__oitucardsReviewModelsBootstrap) return;
  window.__oitucardsReviewModelsBootstrap = true;

  function loadUiRefinement() {
    if (document.querySelector('script[data-oitucards-review-model-ui-refinement]')) return;
    const refinement = document.createElement("script");
    refinement.async = false;
    refinement.src = "js/review-model-ui-refinement.js?v=20260830-1530";
    refinement.dataset.oitucardsReviewModelUiRefinement = "true";
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
