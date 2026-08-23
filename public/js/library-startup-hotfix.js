(function () {
  if (!window.OituDB || OituDB.__libraryStartupHotfix) return;
  OituDB.__libraryStartupHotfix = true;

  const state = {
    countMap: null,
    countPromise: null,
    summaryCache: new Map(),
    placeholderCache: new Map(),
    detailQueue: [],
    detailQueued: new Set(),
    detailRunning: false,
    refreshTimer: null,
    forceRealDepth: 0,
    forceFullUntil: 0,
    pendingDeckId: null
  };

  const $ = (selector) => document.querySelector(selector);
  const previousGetCardsByDeck = OituDB.getCardsByDeck.bind(OituDB);
  const previousAddCard = OituDB.addCard.bind(OituDB);
  const previousUpdateCard = OituDB.updateCard.bind(OituDB);
  const previousDeleteCard = OituDB.deleteCard.bind(OituDB);
  const previousDeleteDeck = OituDB.deleteDeck.bind(OituDB);
  const previousGetCard = OituDB.getCard.bind(OituDB);

  function homeActive() {
    return Boolean($('#homeView')?.classList.contains('active'));
  }

  async function db() {
    return OituDB.openDB();
  }

  async function fullRead(deckId) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('cards', 'readonly');
      const req = tx.objectStore('cards').index('deckId').getAll(IDBKeyRange.only(deckId));
      req.onsuccess = () => {
        const cards = req.result || [];
        cards.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        resolve(cards);
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
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

  function placeholders(deckId, count) {
    const cached = state.placeholderCache.get(deckId);
    if (cached?.length === count) return cached.slice();
    const sample = Object.freeze({
      deckId,
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

  function refreshLibrarySoon(delay = 120) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (!homeActive()) return;
      Promise.resolve(window.OituLibrary?.render?.()).catch((error) => console.error(error));
    }, delay);
  }

  function ensureCounts() {
    if (state.countMap) return Promise.resolve(state.countMap);
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
          counts.set(cursor.key, (counts.get(cursor.key) || 0) + 1);
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
      });
    })()
      .then((counts) => {
        refreshLibrarySoon(0);
        if (homeActive()) {
          for (const deckId of counts.keys()) queueDetail(deckId);
        }
        return counts;
      })
      .catch((error) => {
        console.warn('OituCards: contagem rápida da biblioteca indisponível.', error);
        return null;
      })
      .finally(() => {
        state.countPromise = null;
      });

    return state.countPromise;
  }

  function queueDetail(deckId) {
    if (!deckId || state.summaryCache.has(deckId) || state.detailQueued.has(deckId)) return;
    state.detailQueued.add(deckId);
    state.detailQueue.push(deckId);
    scheduleDetailWork();
  }

  function scheduleDetailWork() {
    if (state.detailRunning || !state.detailQueue.length || !homeActive()) return;
    state.detailRunning = true;

    const run = (deadline) => {
      state.detailRunning = false;
      if (!homeActive() || !state.detailQueue.length) return;
      if (deadline && !deadline.didTimeout && deadline.timeRemaining() < 6) {
        scheduleDetailWork();
        return;
      }

      const deckId = state.detailQueue.shift();
      state.detailQueued.delete(deckId);
      readDeckSummary(deckId)
        .then((cards) => {
          if (!cards) return;
          state.summaryCache.set(deckId, cards);
          state.placeholderCache.delete(deckId);
          if (state.countMap) state.countMap.set(deckId, cards.length);
          if (state.detailQueue.length % 6 === 0 || !state.detailQueue.length) refreshLibrarySoon(220);
        })
        .catch((error) => console.warn('OituCards: resumo ocioso de um baralho falhou.', error))
        .finally(() => scheduleDetailWork());
    };

    if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
    else setTimeout(() => run(null), 180);
  }

  async function readDeckSummary(deckId) {
    if (!homeActive()) return null;
    const database = await db();
    return new Promise((resolve, reject) => {
      const cards = [];
      let cancelled = false;
      const tx = database.transaction('cards', 'readonly');
      const req = tx.objectStore('cards').index('deckId').openCursor(IDBKeyRange.only(deckId));
      req.onsuccess = (event) => {
        if (!homeActive()) {
          cancelled = true;
          try { tx.abort(); } catch (_) {}
          return;
        }
        const cursor = event.target.result;
        if (!cursor) {
          resolve(cards);
          return;
        }
        cards.push(summaryCard(cursor.value));
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => cancelled ? resolve(null) : reject(tx.error);
      tx.onabort = () => cancelled ? resolve(null) : reject(tx.error || new Error('Leitura cancelada.'));
    });
  }

  async function homeSummary(deckId) {
    const cached = state.summaryCache.get(deckId);
    if (cached) return cached.slice();

    if (state.countMap) {
      const count = Number(state.countMap.get(deckId) || 0);
      queueDetail(deckId);
      return placeholders(deckId, count);
    }

    ensureCounts();
    return [];
  }

  function invalidateDeck(deckId, countChanged) {
    if (!deckId) return;
    state.summaryCache.delete(deckId);
    state.placeholderCache.delete(deckId);
    state.detailQueued.delete(deckId);
    state.detailQueue = state.detailQueue.filter((id) => id !== deckId);
    if (countChanged) state.countMap = null;
    if (homeActive()) queueDetail(deckId);
  }

  function invalidateAll() {
    state.countMap = null;
    state.countPromise = null;
    state.summaryCache.clear();
    state.placeholderCache.clear();
    state.detailQueue = [];
    state.detailQueued.clear();
    state.detailRunning = false;
    if (homeActive()) ensureCounts();
  }

  function wrapStudyApi(api) {
    if (!api || typeof api.openConfig !== 'function' || api.openConfig.__oitucardsInstantLibraryWrapped) return;
    const original = api.openConfig;
    const wrapped = async function (...args) {
      state.forceRealDepth += 1;
      try {
        return await original.apply(this, args);
      } finally {
        state.forceRealDepth = Math.max(0, state.forceRealDepth - 1);
      }
    };
    Object.defineProperty(wrapped, '__oitucardsInstantLibraryWrapped', { value: true });
    api.openConfig = wrapped;
  }

  OituDB.getCardsByDeck = async (deckId) => {
    if (state.forceRealDepth > 0 || Date.now() < state.forceFullUntil) return fullRead(deckId);
    if (state.pendingDeckId && state.pendingDeckId === deckId) {
      state.pendingDeckId = null;
      return fullRead(deckId);
    }
    if (homeActive()) return homeSummary(deckId);
    return previousGetCardsByDeck(deckId);
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

  wrapStudyApi(window.OituStudy);
  wrapStudyApi(window.OituMultiStudy);

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const deckOpen = target.closest('[data-deck-id] .deck-name-button,[data-deck-id] [data-action="edit-deck"]');
    if (deckOpen) {
      state.pendingDeckId = deckOpen.closest('[data-deck-id]')?.dataset.deckId || null;
    }

    const exportButton = target.closest('#exportSelectedButton,#deckExportButton');
    if (exportButton) {
      state.forceFullUntil = Date.now() + 10 * 60 * 1000;
      let sawDisabled = exportButton.disabled;
      const observer = new MutationObserver(() => {
        if (exportButton.disabled) { sawDisabled = true; return; }
        if (!sawDisabled) return;
        observer.disconnect();
        state.forceFullUntil = 0;
      });
      observer.observe(exportButton, { attributes: true, attributeFilter: ['disabled'] });
    }

    const importButton = target.closest('#confirmImportButton');
    if (importButton) {
      invalidateAll();
      let sawDisabled = importButton.disabled;
      const observer = new MutationObserver(() => {
        if (importButton.disabled) { sawDisabled = true; return; }
        if (!sawDisabled) return;
        observer.disconnect();
        invalidateAll();
      });
      observer.observe(importButton, { attributes: true, attributeFilter: ['disabled'] });
    }
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && homeActive()) {
      ensureCounts();
      scheduleDetailWork();
    }
  });

  window.OituLibraryStartupHotfix = {
    invalidateAll,
    pauseBackground: () => { state.detailRunning = false; },
    resumeBackground: () => { if (homeActive()) scheduleDetailWork(); }
  };
})();
