(function () {
  if (window.__oitucardsImportLibraryFinalRefresh) return;
  window.__oitucardsImportLibraryFinalRefresh = true;

  const state = {
    statusObserver: null,
    listObserver: null,
    lastSuccessText: "",
    pendingAfterRender: false,
    fallbackTimer: null,
    refreshGeneration: 0
  };

  const $ = (selector) => document.querySelector(selector);

  function isImportSuccess(text) {
    return /\bcard(s)? importado(s)?\b/i.test(String(text || ""));
  }

  async function renderLibraryOnce() {
    try {
      await window.OituLibrary?.render?.();
    } catch (error) {
      console.warn("OituCards: atualização final da biblioteca após importação falhou.", error);
    }
  }

  function finishPendingRefresh(generation) {
    if (generation !== state.refreshGeneration || !state.pendingAfterRender) return;
    state.pendingAfterRender = false;
    clearTimeout(state.fallbackTimer);
    state.fallbackTimer = null;

    // A MutationObserver roda depois da tarefa que redesenhou a lista. Nesse ponto,
    // o render antigo da biblioteca já terminou e uma nova renderização não será descartada.
    setTimeout(() => renderLibraryOnce(), 0);
  }

  function requestAuthoritativeRefresh() {
    const generation = ++state.refreshGeneration;
    state.pendingAfterRender = true;

    // Primeira tentativa: funciona imediatamente quando não há render concorrente.
    renderLibraryOnce();

    // Se havia um render antigo em andamento, a próxima troca da lista será o sinal
    // de que ele terminou. O observer abaixo dispara então a renderização definitiva.
    clearTimeout(state.fallbackTimer);
    state.fallbackTimer = setTimeout(() => {
      if (generation !== state.refreshGeneration || !state.pendingAfterRender) return;
      state.pendingAfterRender = false;
      renderLibraryOnce();
    }, 1200);
  }

  function inspectStatus() {
    const status = $("#importStatus");
    if (!status) return;
    const text = String(status.textContent || "").trim();
    if (!isImportSuccess(text) || text === state.lastSuccessText) return;
    state.lastSuccessText = text;
    requestAuthoritativeRefresh();
  }

  function attachStatusObserver() {
    const status = $("#importStatus");
    if (!status || state.statusObserver) return;
    state.statusObserver = new MutationObserver(inspectStatus);
    state.statusObserver.observe(status, { childList: true, characterData: true, subtree: true });
    inspectStatus();
  }

  function attachListObserver() {
    const list = $("#deckList");
    if (!list || state.listObserver) return;
    state.listObserver = new MutationObserver(() => {
      if (!state.pendingAfterRender) return;
      finishPendingRefresh(state.refreshGeneration);
    });
    state.listObserver.observe(list, { childList: true, subtree: false });
  }

  function init() {
    attachStatusObserver();
    attachListObserver();
    $("#importDeckButton")?.addEventListener("click", () => {
      setTimeout(() => {
        attachStatusObserver();
        attachListObserver();
      }, 0);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
