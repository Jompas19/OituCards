(function () {
  if (window.__oitucardsImportLibraryFinalRefresh) return;
  window.__oitucardsImportLibraryFinalRefresh = true;

  let observer = null;
  let lastSuccessText = "";
  let refreshRun = 0;

  const $ = (selector) => document.querySelector(selector);

  function isImportSuccess(text) {
    return /\bcard(s)? importado(s)?\b/i.test(String(text || ""));
  }

  function runFinalRefreshes() {
    const run = ++refreshRun;
    const delays = [60, 950, 2200];

    delays.forEach((delay) => {
      setTimeout(async () => {
        if (run !== refreshRun) return;
        try {
          await window.OituLibrary?.render?.();
        } catch (error) {
          console.warn("OituCards: atualização final da biblioteca após importação falhou.", error);
        }
      }, delay);
    });
  }

  function inspectStatus() {
    const status = $("#importStatus");
    if (!status) return;
    const text = String(status.textContent || "").trim();
    if (!isImportSuccess(text) || text === lastSuccessText) return;
    lastSuccessText = text;
    runFinalRefreshes();
  }

  function attach() {
    const status = $("#importStatus");
    if (!status || observer) return;
    observer = new MutationObserver(inspectStatus);
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    inspectStatus();
  }

  function init() {
    attach();
    $("#importDeckButton")?.addEventListener("click", () => setTimeout(attach, 0));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
