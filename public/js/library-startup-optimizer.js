(function () {
  if (!window.OituDB || OituDB.__libraryStartupOptimizer) return;
  OituDB.__libraryStartupOptimizer = true;

  const state = {
    countMap: null,
    countPromise: null,
    summaryCache: new Map(),
    placeholderCache: new Map(),
    detailQueue: [],
    detailQueued: new Set(),
    detailRunning: false,
    backgroundPaused: false,
    fullReadDepth: 0,
    forceFullUntil: 0,
    pendingDeckId: null,
    refreshTimer: null
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
      if (!homeActive() || state.backgroundPaused) return;
      Promise.resolve(window.OituLibrary?.render?.()).catch((error) => console.error(error));
    }, delay);
  }

  function ensureCounts() {
    if (state.countMap) return Promise.resolve(state.countMap);
    if (state.countPromise) return state.countPromise;

    state.countPromise = Promise.all([OituDB.getDecks(), db()])
      .then(([decks, database]) => new Promise((resolve, reject) => {
        const counts = new Map();
        if (!decks.length) {
          state.countMap = counts;
          resolve(counts);
          return;
        }

        const tx = database.transaction('cards', 'readonly');
        const index = tx.objectStore('cards').index('deckId');
        let pending = decks.length;
        let failed = false;

        decks.forEach((deck) => {
          const req = index.count(IDBKeyRange.only(deck.id));
          req.onsuccess = () => {
            counts.set(deck.id, Number(req.result || 0));
            pending -= 1;
            if (!pending && !failed) {
              state.countMap = counts;
              resolve(counts);
            }
          };
          req.onerror = () => {
            if (failed) return;
            failed = true;
            reject(req.error);
          };
        });
        tx.onerror = () => {
          if (!failed) reject(tx.error);
        };
      }))
      .then((counts) => {
        refreshLibrarySoon(0);
        if (homeActive() && !state.backgroundPaused) {
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
    if (state.detailRunning || state.backgroundPaused || !state.detailQueue.length || !homeActive()) return;
    state.detailRunning = true;

    const run = (deadline) => {
      state.detailRunning = false;
      if (state.backgroundPaused || !homeActive() || !state.detailQueue.length) return;
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
          if (state.detailQueue.length % 8 === 0 || !state.detailQueue.length) refreshLibrarySoon(240);
        })
        .catch((error) => console.warn('OituCards: resumo ocioso de um baralho falhou.', error))
        .finally(() => scheduleDetailWork());
    };

    if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
    else setTimeout(() => run(null), 220);
  }

  async function readDeckSummary(deckId) {
    if (!homeActive() || state.backgroundPaused) return null;
    const database = await db();
    return new Promise((resolve, reject) => {
      const cards = [];
      let cancelled = false;
      const tx = database.transaction('cards', 'readonly');
      const req = tx.objectStore('cards').index('deckId').openCursor(IDBKeyRange.only(deckId));

      req.onsuccess = (event) => {
        if (!homeActive() || state.backgroundPaused) {
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

  function pauseBackground() {
    state.backgroundPaused = true;
    state.detailRunning = false;
  }

  function resumeBackground() {
    state.backgroundPaused = false;
    if (homeActive()) {
      ensureCounts();
      scheduleDetailWork();
    }
  }

  function invalidateDeck(deckId, countChanged) {
    if (!deckId) return;
    state.summaryCache.delete(deckId);
    state.placeholderCache.delete(deckId);
    state.detailQueued.delete(deckId);
    state.detailQueue = state.detailQueue.filter((id) => id !== deckId);
    if (countChanged) state.countMap = null;
    if (homeActive() && !state.backgroundPaused) queueDetail(deckId);
  }

  function invalidateAll() {
    state.countMap = null;
    state.countPromise = null;
    state.summaryCache.clear();
    state.placeholderCache.clear();
    state.detailQueue = [];
    state.detailQueued.clear();
    state.detailRunning = false;
    if (homeActive() && !state.backgroundPaused) ensureCounts();
  }

  function wrapStudyApi(api) {
    if (!api || typeof api.openConfig !== 'function' || api.openConfig.__oitucardsStartupOptimizer) return;
    const original = api.openConfig;
    const wrapped = async function (...args) {
      pauseBackground();
      state.fullReadDepth += 1;
      try {
        return await original.apply(this, args);
      } finally {
        state.fullReadDepth = Math.max(0, state.fullReadDepth - 1);
        if (homeActive()) resumeBackground();
      }
    };
    Object.defineProperty(wrapped, '__oitucardsStartupOptimizer', { value: true });
    api.openConfig = wrapped;
  }

  OituDB.getCardsByDeck = async (deckId) => {
    if (state.fullReadDepth > 0 || Date.now() < state.forceFullUntil) return fullRead(deckId);
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
      pauseBackground();
      setTimeout(() => {
        if (homeActive()) resumeBackground();
      }, 1200);
    }

    const studyTrigger = target.closest('[data-study-folder],#studySelectedButton');
    if (studyTrigger) pauseBackground();

    const exportButton = target.closest('#exportSelectedButton,#deckExportButton');
    if (exportButton) {
      pauseBackground();
      state.forceFullUntil = Date.now() + 10 * 60 * 1000;
      let sawDisabled = exportButton.disabled;
      const observer = new MutationObserver(() => {
        if (exportButton.disabled) { sawDisabled = true; return; }
        if (!sawDisabled) return;
        observer.disconnect();
        state.forceFullUntil = 0;
        if (homeActive()) resumeBackground();
      });
      observer.observe(exportButton, { attributes: true, attributeFilter: ['disabled'] });
    }

    const importButton = target.closest('#confirmImportButton');
    if (importButton) {
      pauseBackground();
      invalidateAll();
      let sawDisabled = importButton.disabled;
      const observer = new MutationObserver(() => {
        if (importButton.disabled) { sawDisabled = true; return; }
        if (!sawDisabled) return;
        observer.disconnect();
        invalidateAll();
        if (homeActive()) resumeBackground();
      });
      observer.observe(importButton, { attributes: true, attributeFilter: ['disabled'] });
    }
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && homeActive()) resumeBackground();
  });

  window.OituLibraryStartupOptimizer = {
    invalidateAll,
    pauseBackground,
    resumeBackground
  };
})();
