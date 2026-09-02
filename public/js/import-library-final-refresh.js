(function () {
  if (window.__oitucardsImportLibraryFinalRefresh) return;
  window.__oitucardsImportLibraryFinalRefresh = true;

  const state = { statusObserver: null, successHandled: false };

  const $ = (selector) => document.querySelector(selector);

  function loadDirectDeleteActions() {
    if (document.querySelector('script[data-oitucards-direct-delete-actions]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/direct-delete-actions.js?v=20260902-1400";
    script.dataset.oitucardsDirectDeleteActions = "true";
    script.onerror = () => console.error("Não foi possível carregar as ações diretas de exclusão.");
    document.body.appendChild(script);
  }

  function isImportSuccess(text) {
    return /\bcard(s)? importado(s)?\b/i.test(String(text || ""));
  }

  function renderFreshLibrary() {
    requestAnimationFrame(() => {
      Promise.resolve(window.OituLibrary?.render?.()).catch((error) => {
        console.warn("OituCards: atualização da biblioteca após importação falhou.", error);
      });
    });
  }

  function inspectStatus() {
    const status = $("#importStatus");
    if (!status) return;
    const text = String(status.textContent || "").trim();

    if (!isImportSuccess(text)) {
      state.successHandled = false;
      return;
    }

    if (state.successHandled) return;
    state.successHandled = true;
    renderFreshLibrary();
  }

  function attachStatusObserver() {
    const status = $("#importStatus");
    if (!status || state.statusObserver) return;
    state.statusObserver = new MutationObserver(inspectStatus);
    state.statusObserver.observe(status, { childList: true, characterData: true, subtree: true });
    inspectStatus();
  }

  function init() {
    attachStatusObserver();
    loadDirectDeleteActions();
    $("#importDeckButton")?.addEventListener("click", () => {
      state.successHandled = false;
      setTimeout(attachStatusObserver, 0);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
