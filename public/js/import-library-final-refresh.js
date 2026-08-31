(function () {
  if (window.__oitucardsImportLibraryFinalRefresh) return;
  window.__oitucardsImportLibraryFinalRefresh = true;

  const CACHE_BYPASS_MS = 35000;
  const state = {
    statusObserver: null,
    successHandled: false,
    bypassUntil: 0,
    originalGetCardsByDeck: null,
    readPatched: false,
    freshCardsByDeck: null,
    freshCardsPromise: null,
    clearFreshTimer: null
  };

  const $ = (selector) => document.querySelector(selector);

  function loadDirectDeleteActions() {
    if (document.querySelector('script[data-oitucards-direct-delete-actions]')) return;
    const script = document.createElement("script");
    script.async = false;
    script.src = "js/direct-delete-actions.js?v=20260830-2255";
    script.dataset.oitucardsDirectDeleteActions = "true";
    script.onerror = () => console.error("Não foi possível carregar as ações diretas de exclusão.");
    document.body.appendChild(script);
  }

  function isImportSuccess(text) {
    return /\bcard(s)? importado(s)?\b/i.test(String(text || ""));
  }

  function cloneCard(card) {
    return card ? { ...card } : card;
  }

  async function readAllCardsDirectly() {
    const db = await OituDB.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readonly");
      const req = tx.objectStore("cards").getAll();
      req.onsuccess = () => {
        const grouped = new Map();
        for (const card of req.result || []) {
          if (!grouped.has(card.deckId)) grouped.set(card.deckId, []);
          grouped.get(card.deckId).push(card);
        }
        grouped.forEach((cards) => cards.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
        resolve(grouped);
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  function primeFreshCardMap() {
    state.freshCardsByDeck = null;
    state.freshCardsPromise = readAllCardsDirectly().then((grouped) => {
      state.freshCardsByDeck = grouped;
      state.freshCardsPromise = null;
      return grouped;
    }).catch((error) => {
      state.freshCardsPromise = null;
      throw error;
    });
    return state.freshCardsPromise;
  }

  async function freshCardsForDeck(deckId) {
    let grouped = state.freshCardsByDeck;
    if (!grouped && state.freshCardsPromise) grouped = await state.freshCardsPromise;
    if (!grouped) grouped = await primeFreshCardMap();
    return (grouped.get(deckId) || []).map(cloneCard);
  }

  function patchCardReads() {
    if (state.readPatched || !window.OituDB?.getCardsByDeck || !window.OituDB?.openDB) return;
    state.readPatched = true;
    state.originalGetCardsByDeck = OituDB.getCardsByDeck.bind(OituDB);

    OituDB.getCardsByDeck = async (deckId) => {
      if (Date.now() < state.bypassUntil) {
        try {
          return await freshCardsForDeck(deckId);
        } catch (error) {
          console.warn("OituCards: leitura agrupada pós-importação falhou; usando cache normal.", error);
        }
      }
      return state.originalGetCardsByDeck(deckId);
    };
  }

  function renderFreshLibrary() {
    [0, 250].forEach((delay) => {
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
    clearTimeout(state.clearFreshTimer);

    primeFreshCardMap().then(() => {
      renderFreshLibrary();
    }).catch((error) => {
      console.warn("OituCards: não foi possível preparar o cache fresco pós-importação.", error);
      renderFreshLibrary();
    });

    state.clearFreshTimer = setTimeout(() => {
      state.freshCardsByDeck = null;
      state.freshCardsPromise = null;
    }, CACHE_BYPASS_MS + 1500);
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
      state.freshCardsByDeck = null;
      state.freshCardsPromise = null;
      setTimeout(() => {
        patchCardReads();
        attachStatusObserver();
      }, 0);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
