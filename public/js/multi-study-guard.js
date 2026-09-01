(function () {
  function installReviewDueFirstPaintGuard() {
    if (document.querySelector("#reviewDueFirstPaintGuard")) return;
    const style = document.createElement("style");
    style.id = "reviewDueFirstPaintGuard";
    style.textContent = `
      html:not(.review-due-ready) #deckList .review-due-badge,
      html:not(.review-due-ready) #deckList .folder-review-due,
      #deckList.review-due-sync-pending .review-due-badge,
      #deckList.review-due-sync-pending .folder-review-due {
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);
    setTimeout(() => document.documentElement.classList.add("review-due-ready"), 8000);
  }

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
    script.src = "js/visual-polish-lite.js?v=20260823-1636";
    script.dataset.oitucardsVisualPolish = "true";
    script.onerror = () => console.error("Não foi possível carregar os ajustes finos de interface.");
    document.body.appendChild(script);
  }

  function releaseMobileVisualPatch() {
    window.OituMobileCompat?.releaseVisualObserverPatch?.();
  }

  function loadVisualRefinement() {
    const existing = document.querySelector('script[data-oitucards-visual-refinement]');
    if (existing) {
      if (existing.dataset.loaded === "true") {
        releaseMobileVisualPatch();
        loadVisualPolish();
      } else {
        existing.addEventListener("load", () => {
          releaseMobileVisualPatch();
          loadVisualPolish();
        }, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.async = false;
    script.src = "js/visual-refinement.js?v=20260823-1403";
    script.dataset.oitucardsVisualRefinement = "true";
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      releaseMobileVisualPatch();
      loadVisualPolish();
    }, { once: true });
    script.onerror = () => {
      releaseMobileVisualPatch();
      console.error("Não foi possível carregar o refinamento visual.");
      loadVisualPolish();
    };
    document.body.appendChild(script);
  }

  function isMobileTouchRuntime() {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches || false;
    const narrowScreen = window.matchMedia?.('(max-width: 900px)')?.matches || window.innerWidth <= 900;
    const hasTouch = Number(navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    return coarsePointer || (hasTouch && narrowScreen);
  }

  function loadMobileCompat(next) {
    if (!isMobileTouchRuntime()) {
      next();
      return;
    }

    const existing = document.querySelector('script[data-oitucards-mobile-compat]');
    if (existing) {
      if (existing.dataset.loaded === "true") next();
      else existing.addEventListener("load", next, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = false;
    script.src = "js/mobile-compat.js?v=20260823-1714";
    script.dataset.oitucardsMobileCompat = "true";
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      next();
    }, { once: true });
    script.onerror = () => {
      console.error("Não foi possível carregar a compatibilidade mobile.");
      next();
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

  function loadStudyAnnotations() {
    if (document.querySelector('script[data-oitucards-study-annotations]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/study-annotations.js?v=20260823-1648";
    script.dataset.oitucardsStudyAnnotations = "true";
    script.onerror = () => console.error("Não foi possível carregar as anotações dos flashcards.");
    document.body.appendChild(script);
  }

  function loadStudyFlipToggle() {
    if (document.querySelector('script[data-oitucards-study-flip-toggle]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/study-flip-toggle.js?v=20260825-1606";
    script.dataset.oitucardsStudyFlipToggle = "true";
    script.onerror = () => console.error("Não foi possível carregar a alternância do flashcard.");
    document.body.appendChild(script);
  }

  function loadReviewModels() {
    if (document.querySelector('script[data-oitucards-review-models]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/review-presets-bootstrap.js?v=20260831-2205";
    script.dataset.oitucardsReviewModels = "true";
    script.onerror = () => console.error("Não foi possível carregar os modelos de revisão.");
    document.body.appendChild(script);
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
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/review-final-authority.js?v=20260831-2215";
    script.dataset.oitucardsReviewFinalAuthority = "true";
    script.onerror = () => {
      document.documentElement.classList.add("review-due-ready");
      console.error("Não foi possível carregar a autoridade final do sistema de revisão.");
    };
    document.body.appendChild(script);
  }

  installReviewDueFirstPaintGuard();
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