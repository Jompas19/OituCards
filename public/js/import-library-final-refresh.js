(function () {
  if (window.__oitucardsImportLibraryFinalRefresh) return;
  window.__oitucardsImportLibraryFinalRefresh = true;

  const CACHE_BYPASS_MS = 35000;
  const state = {
    statusObserver: null,
    successHandled: false,
    bypassUntil: 0,
    originalGetCardsByDeck: null,
    readPatched: false
  };

  const $ = (selector) => document.querySelector(selector);

  function loadDirectDeleteActions() {
    if (document.querySelector('script[data-oitucards-direct-delete-actions]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/direct-delete-actions.js?v=20260830-2248";
    script.dataset.oitucardsDirectDeleteActions = "true";
    script.onerror = () => console.error("Não foi possível carregar as ações diretas de exclusão.");
    document.body.appendChild(script);
  }

  function isImportSuccess(text) {
    return /\bcard(s)? importado(s)?\b/i.test(String(text || ""));
  }

  async function readCardsDirectly(deckId) {
    const db = await OituDB.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readonly");
      const req = tx.objectStore("cards").index("deckId").getAll(IDBKeyRange.only(deckId));
      req.onsuccess = () => {
        const cards = req.result || [];
        cards.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        resolve(cards);
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  function patchCardReads() {
    if (state.readPatched || !window.OituDB?.getCardsByDeck || !window.OituDB?.openDB) return;
    state.readPatched = true;
    state.originalGetCardsByDeck = OituDB.getCardsByDeck.bind(OituDB);

    OituDB.getCardsByDeck = async (deckId) => {
      if (Date.now() < state.bypassUntil) {
        try {
          return await readCardsDirectly(deckId);
        } catch (error) {
          console.warn("OituCards: leitura direta pós-importação falhou; usando cache normal.", error);
        }
      }
      return state.originalGetCardsByDeck(deckId);
    };
  }

  function renderFreshLibrary() {
    // As leituras feitas durante esta janela ignoram o cache antigo de 30 s.
    // Duas tentativas curtas cobrem eventual render que já estava em andamento,
    // mas não ficam observando/re-renderizando a página continuamente.
    [0, 350].forEach((delay) => {
      setTimeout(() => {
        Promise.resolve(window.OituLibrary?.render?.()).catch((error) => {
          console.warn("OituCards: atualização da biblioteca após importação falhou.", error);
        });
      }, delay);
    });
  }

  function activateFreshReadWindow() {
    patchCardReads();
    state.bypassUntil = Date.now() + CACHE_BYPASS_MS;
    renderFreshLibrary();
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
    activateFreshReadWindow();
  }

  function attachStatusObserver() {
    const status = $("#importStatus");
    if (!status || state.statusObserver) return;
    state.statusObserver = new MutationObserver(inspectStatus);
    state.statusObserver.observe(status, { childList: true, characterData: true, subtree: true });
    inspectStatus();
  }

  function init() {
    patchCardReads();
    attachStatusObserver();
    loadDirectDeleteActions();
    $("#importDeckButton")?.addEventListener("click", () => {
      state.successHandled = false;
      setTimeout(() => {
        patchCardReads();
        attachStatusObserver();
      }, 0);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
