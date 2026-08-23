(function () {
  if (!window.OituDB || OituDB.__largeReadOptimizer) return;
  OituDB.__largeReadOptimizer = true;

  const LARGE_THRESHOLD = 1500;
  const state = {
    lightConfigDepth: 0,
    forceFullDepth: 0,
    forceFullUntil: 0,
    countCache: new Map(),
    summaryCache: new Map(),
    summaryPending: new Map(),
    placeholderCache: new Map(),
    refreshTimer: null
  };

  const $ = (selector) => document.querySelector(selector);
  const baseGetCardsByDeck = OituDB.getCardsByDeck.bind(OituDB);
  const baseAddCard = OituDB.addCard.bind(OituDB);
  const baseUpdateCard = OituDB.updateCard.bind(OituDB);
  const baseDeleteCard = OituDB.deleteCard.bind(OituDB);
  const baseDeleteDeck = OituDB.deleteDeck.bind(OituDB);
  const baseGetCard = OituDB.getCard.bind(OituDB);

  async function db() { return OituDB.openDB(); }

  async function countCards(deckId) {
    if (state.countCache.has(deckId)) return state.countCache.get(deckId);
    const database = await db();
    const count = await new Promise((resolve, reject) => {
      const tx = database.transaction('cards', 'readonly');
      const req = tx.objectStore('cards').index('deckId').count(IDBKeyRange.only(deckId));
      req.onsuccess = () => resolve(Number(req.result || 0));
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
    state.countCache.set(deckId, count);
    return count;
  }

  function lightCard(card) {
    return {
      id: card.id,
      deckId: card.deckId,
      reviewStatus: card.reviewStatus || null,
      reviewCount: Number.isInteger(card.reviewCount) ? card.reviewCount : undefined,
      lastReviewedAt: card.lastReviewedAt || null,
      nextReviewAt: card.nextReviewAt || null,
      lastRating: card.lastRating || null,
      createdAt: card.createdAt || null
    };
  }

  async function readLightCards(deckId) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const cards = [];
      const tx = database.transaction('cards', 'readonly');
      const req = tx.objectStore('cards').index('deckId').openCursor(IDBKeyRange.only(deckId));
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          cards.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
          resolve(cards);
          return;
        }
        cards.push(lightCard(cursor.value));
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  function placeholders(deckId, count) {
    const cached = state.placeholderCache.get(deckId);
    if (cached?.length === count) return cached.slice();
    const sample = Object.freeze({ deckId, reviewStatus: null, reviewCount: 0, lastReviewedAt: null, nextReviewAt: null, lastRating: null });
    const cards = new Array(count).fill(sample);
    state.placeholderCache.set(deckId, cards);
    return cards.slice();
  }

  function refreshLibrarySoon() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (!$('#homeView')?.classList.contains('active')) return;
      Promise.resolve(window.OituLibrary?.render?.()).catch((error) => console.error(error));
    }, 100);
  }

  function backgroundSummary(deckId) {
    if (state.summaryCache.has(deckId) || state.summaryPending.has(deckId)) return;
    const start = () => readLightCards(deckId)
      .then((cards) => {
        state.summaryCache.set(deckId, cards);
        state.countCache.set(deckId, cards.length);
        state.placeholderCache.delete(deckId);
        refreshLibrarySoon();
        return cards;
      })
      .catch((error) => {
        console.warn('OituCards: resumo em segundo plano indisponível.', error);
        return null;
      })
      .finally(() => state.summaryPending.delete(deckId));

    const promise = new Promise((resolve) => {
      const run = () => resolve(start());
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1200 });
      else setTimeout(run, 120);
    });
    state.summaryPending.set(deckId, promise);
  }

  async function homeSummary(deckId) {
    const cached = state.summaryCache.get(deckId);
    if (cached) return cached.slice();
    const count = await countCards(deckId);
    if (count <= LARGE_THRESHOLD) {
      const cards = await readLightCards(deckId);
      state.summaryCache.set(deckId, cards);
      return cards.slice();
    }
    backgroundSummary(deckId);
    return placeholders(deckId, count);
  }

  function reviewCount(card) {
    if (Number.isInteger(card?.reviewCount) && card.reviewCount >= 0) return card.reviewCount;
    return card?.lastReviewedAt || card?.nextReviewAt || card?.lastRating ? 1 : 0;
  }

  function isNew(card) {
    return reviewCount(card) === 0 && !card?.lastReviewedAt && !card?.nextReviewAt && !card?.lastRating;
  }

  function isDue(card) {
    if (isNew(card)) return false;
    if (!card?.nextReviewAt) return true;
    const due = new Date(card.nextReviewAt);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return Number.isNaN(due.getTime()) || due <= end;
  }

  async function selectStudyCards(deckId) {
    const redoOn = $('#studyRedoCheckbox')?.checked;
    const redoMode = redoOn ? (document.querySelector('input[name="redoMode"]:checked')?.value || 'reset') : 'none';
    if (redoMode === 'reset') return null;

    const all = $('#studyAllCheckbox')?.checked;
    const requested = all ? Infinity : Number.parseInt($('#studyCountInput')?.value || '', 10);
    if (!all && (!Number.isInteger(requested) || requested < 1)) return null;

    const onlyNew = $('#studyOnlyNewCheckbox')?.checked && redoMode === 'none';
    const onlyDue = $('#studyOnlyReviewCheckbox')?.checked && redoMode === 'none';
    const shuffle = $('#studyShuffleCheckbox')?.checked;
    const matches = (card) => {
      if (redoMode === 'keep') return true;
      if (onlyNew) return isNew(card);
      if (onlyDue) return isDue(card);
      return isNew(card) || isDue(card);
    };

    const database = await db();
    return new Promise((resolve, reject) => {
      const selected = [];
      let seen = 0;
      const tx = database.transaction('cards', 'readonly');
      const req = tx.objectStore('cards').index('createdAt').openCursor();
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) { resolve(selected); return; }
        const card = cursor.value;
        if (card?.deckId !== deckId || !matches(card)) { cursor.continue(); return; }
        seen += 1;

        if (requested === Infinity) {
          selected.push(card);
          cursor.continue();
          return;
        }

        if (!shuffle) {
          selected.push(card);
          if (selected.length >= requested) { resolve(selected); return; }
          cursor.continue();
          return;
        }

        if (selected.length < requested) selected.push(card);
        else {
          const index = Math.floor(Math.random() * seen);
          if (index < requested) selected[index] = card;
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  function invalidate(deckId, countChanged) {
    if (!deckId) return;
    state.summaryCache.delete(deckId);
    state.placeholderCache.delete(deckId);
    if (countChanged) state.countCache.delete(deckId);
  }

  function wrapApi(api, kind) {
    if (!api || typeof api.openConfig !== 'function' || api.openConfig.__oitucardsLargeReadOptimizer) return;
    const original = api.openConfig;
    const wrapped = async function (...args) {
      if (kind === 'single') state.lightConfigDepth += 1;
      else state.forceFullDepth += 1;
      try {
        return await original.apply(this, args);
      } finally {
        if (kind === 'single') state.lightConfigDepth = Math.max(0, state.lightConfigDepth - 1);
        else state.forceFullDepth = Math.max(0, state.forceFullDepth - 1);
      }
    };
    Object.defineProperty(wrapped, '__oitucardsLargeReadOptimizer', { value: true });
    api.openConfig = wrapped;
  }

  function forceFullForExport(button) {
    state.forceFullUntil = Date.now() + 10 * 60 * 1000;
    if (!button) return;
    let sawDisabled = button.disabled;
    const observer = new MutationObserver(() => {
      if (button.disabled) { sawDisabled = true; return; }
      if (!sawDisabled) return;
      observer.disconnect();
      state.forceFullUntil = 0;
    });
    observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  }

  OituDB.getCardsByDeck = async (deckId) => {
    if (state.forceFullDepth > 0 || Date.now() < state.forceFullUntil) return baseGetCardsByDeck(deckId);

    if (state.lightConfigDepth > 0) {
      const count = await countCards(deckId);
      if (count > LARGE_THRESHOLD) {
        const cards = await readLightCards(deckId);
        state.summaryCache.set(deckId, cards);
        state.countCache.set(deckId, cards.length);
        return cards.slice();
      }
      return baseGetCardsByDeck(deckId);
    }

    if ($('#studyConfigView')?.classList.contains('active')) {
      const count = await countCards(deckId);
      if (count > LARGE_THRESHOLD) {
        const selected = await selectStudyCards(deckId);
        if (selected) return selected;
      }
    }

    if ($('#homeView')?.classList.contains('active')) return homeSummary(deckId);
    return baseGetCardsByDeck(deckId);
  };

  OituDB.addCard = async (...args) => {
    const card = await baseAddCard(...args);
    invalidate(card.deckId, true);
    return card;
  };

  OituDB.updateCard = async (id, patch) => {
    const card = await baseUpdateCard(id, patch);
    invalidate(card.deckId, false);
    return card;
  };

  OituDB.deleteCard = async (id) => {
    const card = await baseGetCard(id);
    const result = await baseDeleteCard(id);
    invalidate(card?.deckId, true);
    return result;
  };

  OituDB.deleteDeck = async (deckId) => {
    const result = await baseDeleteDeck(deckId);
    state.countCache.delete(deckId);
    state.summaryCache.delete(deckId);
    state.placeholderCache.delete(deckId);
    return result;
  };

  wrapApi(window.OituStudy, 'single');
  wrapApi(window.OituMultiStudy, 'multi');

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('#exportSelectedButton,#deckExportButton') : null;
    if (button) forceFullForExport(button);
  }, true);
})();
