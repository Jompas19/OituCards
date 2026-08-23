(function () {
  function loadLibraryPerformance() {
    if (document.querySelector('script[data-oitucards-library-performance]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/library-performance.js?v=20260823-1140";
    script.dataset.oitucardsLibraryPerformance = "true";
    script.onerror = () => console.error("Não foi possível carregar as otimizações da biblioteca.");
    document.body.appendChild(script);
  }

  function loadLibraryStability() {
    if (document.querySelector('script[data-oitucards-library-stability]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/library-stability.js?v=20260823-1518";
    script.dataset.oitucardsLibraryStability = "true";
    script.onerror = () => console.error("Não foi possível carregar a estabilização visual da biblioteca.");
    document.body.appendChild(script);
  }

  function loadStudyExitFlow() {
    if (document.querySelector('script[data-oitucards-study-exit-flow]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/study-exit-flow.js?v=20260823-1156";
    script.dataset.oitucardsStudyExitFlow = "true";
    script.onerror = () => console.error("Não foi possível carregar o fluxo de saída do estudo.");
    document.body.appendChild(script);
  }

  function loadExport() {
    if (document.querySelector('script[data-oitucards-export]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/export.js?v=20260823-1202";
    script.dataset.oitucardsExport = "true";
    script.onerror = () => console.error("Não foi possível carregar o exportador APKG.");
    document.body.appendChild(script);
  }

  function loadVisualPolish() {
    if (document.querySelector('script[data-oitucards-visual-polish]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/visual-polish-lite.js?v=20260823-1626";
    script.dataset.oitucardsVisualPolish = "true";
    script.onerror = () => console.error("Não foi possível carregar os ajustes finos de interface.");
    document.body.appendChild(script);
  }

  function loadVisualRefinement() {
    const existing = document.querySelector('script[data-oitucards-visual-refinement]');
    if (existing) {
      if (existing.dataset.loaded === "true") loadVisualPolish();
      else existing.addEventListener("load", loadVisualPolish, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = false;
    script.src = "js/visual-refinement.js?v=20260823-1403";
    script.dataset.oitucardsVisualRefinement = "true";
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      loadVisualPolish();
    }, { once: true });
    script.onerror = () => {
      console.error("Não foi possível carregar o refinamento visual.");
      loadVisualPolish();
    };
    document.body.appendChild(script);
  }

  function loadAnimations() {
    if (document.querySelector('script[data-oitucards-animations]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/animations.js?v=20260823-1550";
    script.dataset.oitucardsAnimations = "true";
    script.onerror = () => console.error("Não foi possível carregar as microanimações.");
    document.body.appendChild(script);
  }

  loadLibraryPerformance();
  loadLibraryStability();
  loadStudyExitFlow();
  loadExport();
  loadVisualRefinement();
  loadAnimations();

  document.addEventListener("mousedown", (event) => {
    if (event.target?.id !== "cardModal") return;
    if (!document.querySelector("#multiStudyView.active")) return;
    const cancel = document.querySelector('#cardModal [data-card-action="cancel"]');
    if (!cancel) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel.click();
  }, true);
})();
