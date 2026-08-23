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

  function loadStudyExitFlow() {
    if (document.querySelector('script[data-oitucards-study-exit-flow]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/study-exit-flow.js?v=20260823-1156";
    script.dataset.oitucardsStudyExitFlow = "true";
    script.onerror = () => console.error("Não foi possível carregar o fluxo de saída do estudo.");
    document.body.appendChild(script);
  }

  loadLibraryPerformance();
  loadStudyExitFlow();

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
