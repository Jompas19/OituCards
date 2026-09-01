(function () {
  function installImmediateExactDueRead() {
    if (!window.OituDB?.getCardsByDeck || OituDB.getCardsByDeck.__oitucardsImmediateExactDue) return;
    const previous = OituDB.getCardsByDeck.bind(OituDB);
    const wrapped = async function (...args) {
      const cards = await previous(...args);
      if (!Array.isArray(cards)) return cards;
      const now = Date.now();
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const endTime = end.getTime();
      return cards.map((card) => {
        if (!card?.nextReviewAt) return card;
        const reviewCount = Number.isInteger(card.reviewCount)
          ? card.reviewCount
          : (card.lastReviewedAt || card.nextReviewAt || card.lastRating ? 1 : 0);
        if (reviewCount === 0 && !card.lastReviewedAt && !card.lastRating) return card;
        const due = new Date(card.nextReviewAt).getTime();
        if (!Number.isFinite(due) || due <= now || due > endTime) return card;
        return { ...card, nextReviewAt: new Date(endTime + 1000).toISOString() };
      });
    };
    wrapped.__oitucardsImmediateExactDue = true;
    OituDB.getCardsByDeck = wrapped;
  }

  function loadScript(selector, src, datasetKey, errorMessage, onload) {
    const existing = document.querySelector(selector);
    if (existing) {
      if (onload) {
        if (existing.dataset.loaded === "true") onload();
        else existing.addEventListener("load", onload, { once: true });
      }
      return existing;
    }
    const script = document.createElement("script");
    script.async = false;
    script.src = src;
    if (datasetKey) script.dataset[datasetKey] = "true";
    if (onload) script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      onload();
    }, { once: true });
    script.onerror = () => console.error(errorMessage);
    document.body.appendChild(script);
    return script;
  }

  function loadStudyConfigModalUx() {
    loadScript(
      'script[data-oitucards-study-config-modal-ux]',
      "js/study-config-modal-ux.js?v=20260901-1525",
      "oitucardsStudyConfigModalUx",
      "Não foi possível carregar o refinamento da preparação de estudo."
    );
  }

  function loadLibraryPerformance() {
    loadScript('script[data-oitucards-library-performance]', "js/library-performance.js?v=20260823-1140", "oitucardsLibraryPerformance", "Não foi possível carregar as otimizações da biblioteca.");
  }

  function loadLibraryStability() {
    loadScript('script[data-oitucards-library-stability]', "js/library-stability.js?v=20260823-1518", "oitucardsLibraryStability", "Não foi possível carregar a estabilização visual da biblioteca.");
  }

  function loadStudyExitFlow() {
    loadScript('script[data-oitucards-study-exit-flow]', "js/study-exit-flow.js?v=20260823-1156", "oitucardsStudyExitFlow", "Não foi possível carregar o fluxo de saída do estudo.");
  }

  function loadExport() {
    loadScript('script[data-oitucards-export]', "js/export.js?v=20260823-1202", "oitucardsExport", "Não foi possível carregar o exportador APKG.");
  }

  function loadVisualPolish() {
    loadScript('script[data-oitucards-visual-polish]', "js/visual-polish-lite.js?v=20260823-1636", "oitucardsVisualPolish", "Não foi possível carregar os ajustes finos de interface.");
  }

  function releaseMobileVisualPatch() {
    window.OituMobileCompat?.releaseVisualObserverPatch?.();
  }

  function loadVisualRefinement() {
    loadScript(
      'script[data-oitucards-visual-refinement]',
      "js/visual-refinement.js?v=20260823-1403",
      "oitucardsVisualRefinement",
      "Não foi possível carregar o refinamento visual.",
      () => { releaseMobileVisualPatch(); loadVisualPolish(); }
    );
  }

  function isMobileTouchRuntime() {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches || false;
    const narrowScreen = window.matchMedia?.('(max-width: 900px)')?.matches || window.innerWidth <= 900;
    const hasTouch = Number(navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    return coarsePointer || (hasTouch && narrowScreen);
  }

  function loadMobileCompat(next) {
    if (!isMobileTouchRuntime()) { next(); return; }
    loadScript(
      'script[data-oitucards-mobile-compat]',
      "js/mobile-compat.js?v=20260823-1714",
      "oitucardsMobileCompat",
      "Não foi possível carregar a compatibilidade mobile.",
      next
    );
  }

  function loadAnimations() {
    loadScript('script[data-oitucards-animations]', "js/animations.js?v=20260823-1550", "oitucardsAnimations", "Não foi possível carregar as microanimações.");
  }

  function loadStudyAnnotations() {
    loadScript('script[data-oitucards-study-annotations]', "js/study-annotations.js?v=20260823-1648", "oitucardsStudyAnnotations", "Não foi possível carregar as anotações dos flashcards.");
  }

  function loadStudyFlipToggle() {
    loadScript('script[data-oitucards-study-flip-toggle]', "js/study-flip-toggle.js?v=20260825-1606", "oitucardsStudyFlipToggle", "Não foi possível carregar a alternância do flashcard.");
  }

  function loadReviewModels() {
    loadScript('script[data-oitucards-review-models]', "js/review-presets-bootstrap.js?v=20260831-2205", "oitucardsReviewModels", "Não foi possível carregar os modelos de revisão.");
  }

  function loadReviewFinalAuthority(attempt = 0) {
    if (document.querySelector('script[data-oitucards-review-final-authority]')) return;
    const ready = window.__oitucardsReviewSystemStabilizer &&
      window.__oitucardsReviewCreationDefaultFix &&
      window.__oitucardsLibraryDueSync;
    if (!ready && attempt < 160) {
      setTimeout(() => loadReviewFinalAuthority(attempt + 1), 50);
      return;
    }
    loadScript(
      'script[data-oitucards-review-final-authority]',
      "js/review-final-authority.js?v=20260901-0125",
      "oitucardsReviewFinalAuthority",
      "Não foi possível carregar a autoridade final do sistema de revisão."
    );
  }

  installImmediateExactDueRead();
  document.documentElement.classList.add("review-due-ready");

  loadStudyConfigModalUx();
  loadLibraryPerformance();
  loadLibraryStability();
  loadStudyExitFlow();
  loadExport();
  loadMobileCompat(loadVisualRefinement);
  loadAnimations();
  loadStudyAnnotations();
  loadStudyFlipToggle();
  loadReviewModels();
  loadReviewFinalAuthority();

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
