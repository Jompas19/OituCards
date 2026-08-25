(function () {
  if (window.__oitucardsStudyFlipToggle) return;
  window.__oitucardsStudyFlipToggle = true;

  const contexts = [
    { view: "#studyView", card: "#studyCard", back: "#studyBackSection", ratings: "#studyRatingArea", edit: "#studyEditArea", hint: "#studyRevealHint" },
    { view: "#multiStudyView", card: "#multiCard", back: "#multiBackSection", ratings: "#multiRatings", edit: "#multiEditArea", hint: "#multiHint" }
  ];

  let collapsedContextKey = null;

  function activeContext() {
    return contexts.find((context) => document.querySelector(`${context.view}.active`)) || null;
  }

  function contextKey(context) {
    return context?.card || null;
  }

  function isBackVisible(context) {
    const back = context ? document.querySelector(context.back) : null;
    return Boolean(back && !back.classList.contains("hidden"));
  }

  function hideAnnotations() {
    document.querySelectorAll(".study-annotation-actions").forEach((bar) => {
      bar.classList.remove("is-visible");
      bar.setAttribute("aria-hidden", "true");
    });
    document.querySelector("#annotationViewer")?.classList.add("hidden");
  }

  function showFront(context) {
    if (!context) return;
    document.querySelector(context.back)?.classList.add("hidden");
    document.querySelector(context.ratings)?.classList.add("hidden");
    document.querySelector(context.edit)?.classList.add("hidden");
    document.querySelector(context.hint)?.classList.remove("hidden");
    hideAnnotations();
    collapsedContextKey = contextKey(context);

    const card = document.querySelector(context.card);
    if (card) {
      card.setAttribute("aria-label", "Flashcard. Clique ou pressione espaço para revelar a resposta.");
      card.focus({ preventScroll: true });
    }
  }

  function showBackAgain(context) {
    if (!context) return;
    document.querySelector(context.back)?.classList.remove("hidden");
    document.querySelector(context.ratings)?.classList.remove("hidden");
    document.querySelector(context.edit)?.classList.remove("hidden");
    document.querySelector(context.hint)?.classList.add("hidden");
    collapsedContextKey = null;

    const card = document.querySelector(context.card);
    if (card) {
      card.setAttribute("aria-label", "Flashcard com resposta revelada. Clique ou pressione espaço para voltar à frente.");
      card.focus({ preventScroll: true });
    }
  }

  function resetCollapsedState(target) {
    if (!target) return;
    if (target.closest("#studyPrevButton,#studyNextButton,#multiPrev,#multiNextArrow,#studyRatingArea,#multiRatings,#startStudyButton,#multiStart,#studyAgainButton,#multiAgain")) {
      collapsedContextKey = null;
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    resetCollapsedState(target);

    const context = activeContext();
    if (!context || !target?.closest(context.card)) return;

    if (isBackVisible(context)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showFront(context);
      return;
    }

    if (collapsedContextKey === contextKey(context)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showBackAgain(context);
      return;
    }

    // Primeira abertura: deixamos o núcleo do estudo revelar o verso e atualizar seu estado interno.
    setTimeout(() => {
      if (isBackVisible(context)) collapsedContextKey = null;
    }, 0);
  }, true);

  document.addEventListener("keydown", (event) => {
    const context = activeContext();
    if (!context) return;

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      collapsedContextKey = null;
      return;
    }

    if (event.code !== "Space") return;
    const active = document.activeElement;
    const tag = active?.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || active?.isContentEditable) return;

    if (isBackVisible(context)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showFront(context);
      return;
    }

    if (collapsedContextKey === contextKey(context)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showBackAgain(context);
      return;
    }

    // Na primeira abertura, o listener original do estudo cuida da mudança de estado.
    setTimeout(() => {
      if (isBackVisible(context)) collapsedContextKey = null;
    }, 0);
  }, true);
})();
