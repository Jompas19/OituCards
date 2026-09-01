(function () {
  if (window.__oitucardsLibraryDueSync) return;
  window.__oitucardsLibraryDueSync = true;

  async function renderLibrary() {
    try {
      const render = window.OituInstantScale?.getOriginalLibraryRender?.() || window.OituLibrary?.render;
      if (typeof render === "function" && document.querySelector("#homeView.active")) await render();
    } catch (_) {}
  }

  async function syncBadges() {
    // Os números já são calculados pelo resumo persistido durante o próprio render.
    // Evita percorrer todos os baralhos novamente só para reescrever os mesmos badges.
    return true;
  }

  function invalidate(deckId) {
    if (!deckId || !window.OituInstantScale?.reconcileDeck) return;
    OituInstantScale.reconcileDeck(deckId)
      .then(renderLibrary)
      .catch(() => {});
  }

  window.OituLibraryDueSync = { sync: syncBadges, invalidate };
})();