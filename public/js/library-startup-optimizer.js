(function () {
  if (!window.OituDB || OituDB.__libraryStartupOptimizer) return;
  OituDB.__libraryStartupOptimizer = true;

  const state = {
    countMap: null,
    countPromise: null,
    summaryCache: new Map(),
    placeholderCache: new Map(),
    detailPromise: null,
    detailScheduled: false,
    fullReadDepth: 0,
    forceFullUntil: 0,
    refreshTimer: null
  };

  const $ = (selector) => document.querySelector(selector);
  const previousGetCardsByDeck = OituDB.getCardsByDeck.bind(OituDB);
  const previousAddCard = OituDB.addCard.bind(OituDB);
  const previousUpdateCard = OituDB.updateCard.bind(OituDB);
  const previousDeleteCard = OituDB.deleteCard.bind(OituDB);
  const previousDeleteDeck = OituDB.deleteDeck.bind(OituDB);
  const previousGetCard = OituDB.getCard.bind(OituDB);

  async function db() {
    return OituDB.openDB();
  }

  function homeActive() {
    return Boolean($('#homeView')?.classList.contains('active'));
  }

  function summaryCard(card) {
    return {
      reviewStatus: card.reviewStatus || null,
      reviewCount: Number.isInteger(card.reviewCount) ? card.reviewCount : undefined,
      lastReviewedAt: card.lastReviewedAt || null,
      nextReviewAt: card.nextReviewAt || null,
      lastRating: card.lastRating || null
    };
  }

  async function ensureCounts() {
    if (state.countMap) return state.countMap;
    if (state.countPromise) return state.countPromise;

    state.countPromise = (async () => {
      const database = await db();
      return new Promise((resolve, reject) => {
        const counts = new Map();
        const tx = database.transaction('cards', 'readonly');
        const req = tx.objectStore('cards').index('deckId').openKeyCursor();

        req.onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) {
            state.countMap = counts;
            resolve(counts);
            return;
          }
          const deckId = cursor.key;
          counts.set(deckId, (counts.get(deckId) || 0) + 1);
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
      });
    })().finally(() => {
      state.countPromise = null;
    });

    return state.countPromise;
  }

  function placeholders(deckId, count) {
    const cached = state.placeholderCache.get(deckId);
    if (cached?.length === count) return cached.slice();
    const sample = Object.freeze({
      reviewStatus: null,
      reviewCount: 0,
      lastReviewedAt: null,
      nextReviewAt: null,
      lastRating: null,
      __librarySummaryPending: true
    });
    const cards = new Array(count).fill(sample);
    state.placeholderCache.set(deckId, cards);
    return cards.slice();
  }

  function refreshLibraryOnce() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (!homeActive()) return;
      Promise.resolve(window.OituLibrary?.render?.()).catch((error) => console.error(error));
    }, 80);
  }

  async function scanAllSummaries() {
    if (state.detailPromise) return state.detailPromise;

    state.detailPromise = (async () => {
      const database = await db();
      return new Promise((resolve, reject) => {
        const grouped = new Map();
        let cancelledForNavigation = false;
        const tx = database.transaction('cards', 'readonly');
        const req = tx.objectStore('cards').openCursor();

        req.onsuccess = (event) => {
          if (!homeActive()) {
            cancelledForNavigation = true;
            try { tx.abort(); } catch (_) {}
            return;
          }

          const cursor = event.target.result;
          if (!cursor) {
            state.summaryCache = grouped;
            state.placeholderCache.clear();
            const counts = new Map();
            grouped.forEach((cards, deckId) => counts.set(deckId, cards.length));
            state.countMap = counts;
            resolve(grouped);
            return;
          }

          const card = cursor.value;
          const deckId = card?.deckId;
          if (deckId) {
            if (!grouped.has(deckId)) grouped.set(deckId, []);
            grouped.get(deckId).push(summaryCard(card));
          }
          cursor.continue();
        };

        req.onerror = () => reject(req.error);
        tx.onerror = () => {
          if (cancelledForNavigation) resolve(null);
          else reject(tx.error);
        };
        tx.onabort = () => {
          if (cancelledForNavigation) resolve(null);
          else reject(tx.error || new Error('Leitura de resumo cancelada.'));
        };
      });
    })()
      .then((result) => {
        if (result) refreshLibraryOnce();
        return result;
      })
      .catch((error) => {
        console.warn('OituCards: resumo global da biblioteca indisponível.', error);
        return null;
      })
      .finally(() => {
        state.detailPromise = null;
        state.detailScheduled = false;
      });

    return state.detailPromise;
  }

  function scheduleDetailScan() {
    if (state.summaryCache.size || state.detailPromise || state.detailScheduled) return;
    state.detailScheduled = true;
    const run = () => {
      if (!homeActive()) {
        state.detailScheduled = false;
        return;
      }
      scanAllSummaries();
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1500 });
    else setTimeout(run, 300);
  }

  async function homeSummary(deckId) {
    const cached = state.summaryCache.get(deckId);
    if (cached) return cached.slice();

    const counts = await ensureCounts();
    const count = Number(counts.get(deckId) || 0);
    scheduleDetailScan();
    return placeholders(deckId, count);
  }

  function invalidateAll() {
    state.countMap = null;
    state.countPromise = null;
    state.summaryCache.clear();
    state.placeholderCache.clear();
    state.detailScheduled = false;
  }

  function invalidateDeck(deckId, countChanged) {
    if (!deckId) return;
    state.summaryCache.delete(deckId);
    state.placeholderCache.delete(deckId);
    if (countChanged) state.countMap = null;
    state.detailScheduled = false;
  }

  function wrapOpenConfig(api, forceFull) {
    if (!api || typeof api.openConfig !== 'function' || api.openConfig.__oitucardsStartupOptimizer) return;
    const original = api.openConfig;
    const wrapped = async function (...args) {
      if (forceFull) state.fullReadDepth += 1;
      try {
        return await original.apply(this, args);
      } finally {
        if (forceFull) state.fullReadDepth = Math.max(0, state.fullReadDepth - 1);
      }
    };
    Object.defineProperty(wrapped, '__oitucardsStartupOptimizer', { value: true });
    api.openConfig = wrapped;
  }

  function forceFullForExport(button) {
    state.forceFullUntil = Date.now() + 10 * 60 * 1000;
    if (!button) return;
    let sawDisabled = button.disabled;
    const observer = new MutationObserver(() => {
      if (button.disabled) {
        sawDisabled = true;
        return;
      }
      if (!sawDisabled) return;
      observer.disconnect();
      state.forceFullUntil = 0;
    });
    observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  }

  OituDB.getCardsByDeck = async (deckId) => {
    if (state.fullReadDepth > 0 || Date.now() < state.forceFullUntil || !homeActive()) {
      return previousGetCardsByDeck(deckId);
    }
    return homeSummary(deckId);
  };

  OituDB.addCard = async (...args) => {
    const card = await previousAddCard(...args);
    invalidateDeck(card?.deckId, true);
    return card;
  };

  OituDB.updateCard = async (id, patch) => {
    const card = await previousUpdateCard(id, patch);
    invalidateDeck(card?.deckId, false);
    return card;
  };

  OituDB.deleteCard = async (id) => {
    const current = await previousGetCard(id);
    const result = await previousDeleteCard(id);
    invalidateDeck(current?.deckId, true);
    return result;
  };

  OituDB.deleteDeck = async (deckId) => {
    const result = await previousDeleteDeck(deckId);
    invalidateDeck(deckId, true);
    return result;
  };

  wrapOpenConfig(window.OituMultiStudy, true);

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const exportButton = target.closest('#exportSelectedButton,#deckExportButton');
    if (exportButton) forceFullForExport(exportButton);

    const importButton = target.closest('#confirmImportButton');
    if (importButton) {
      invalidateAll();
      let sawDisabled = importButton.disabled;
      const observer = new MutationObserver(() => {
        if (importButton.disabled) {
          sawDisabled = true;
          return;
        }
        if (!sawDisabled) return;
        observer.disconnect();
        invalidateAll();
      });
      observer.observe(importButton, { attributes: true, attributeFilter: ['disabled'] });
    }
  }, true);

  window.OituLibraryStartupOptimizer = {
    invalidateAll,
    rescan: () => {
      invalidateAll();
      if (homeActive()) scheduleDetailScan();
    }
  };
})();
