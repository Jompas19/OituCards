(function () {
  if (window.__oitucardsReviewModelsBootstrap) return;
  window.__oitucardsReviewModelsBootstrap = true;

  const script = document.createElement("script");
  script.async = false;
  script.src = "js/review-presets.js?v=20260825-1548";
  script.dataset.oitucardsReviewModelsCore = "true";
  script.onerror = () => console.error("Não foi possível carregar os modelos de revisão.");
  document.body.appendChild(script);
})();
