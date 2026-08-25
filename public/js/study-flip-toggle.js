(function () {
  if (window.__oitucardsStudyFlipToggle) return;
  window.__oitucardsStudyFlipToggle = true;

  const contexts = [
    { view: "#studyView", card: "#studyCard", back: "#studyBackSection", ratings: "#studyRatingArea", edit: "#studyEditArea", hint: "#studyRevealHint" },
    { view: "#multiStudyView", card: "#multiCard", back: "#multiBackSection", ratings: "#multiRatings", edit: "#multiEditArea", hint: "#multiHint" }
  ];

  function activeContext() {
    return contexts.find((context) => document.querySelector(`${context.view}.active`)) || null;
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

    const card = document.querySelector(context.card);
    if (card) {
      card.setAttribute("aria-label", "Flashcard. Clique ou pressione espaço para revelar a resposta.");
      card.focus({ preventScroll: true });
    }
  }

  document.addEventListener("click", (event) => {
    const context = activeContext();
    if (!context || !isBackVisible(context)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(context.card)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    showFront(context);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space") return;
    const context = activeContext();
    if (!context || !isBackVisible(context)) return;

    const active = document.activeElement;
    const tag = active?.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || active?.isContentEditable) return;
    if (!document.querySelector(context.card)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    showFront(context);
  }, true);
})();
