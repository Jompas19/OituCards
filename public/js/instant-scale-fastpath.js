(function () {
  if (window.__oitucardsInstantScaleFastPath) return;
  window.__oitucardsInstantScaleFastPath = true;

  const DB_NAME = "OituCardsDB";
  const META_STORE = "cardMeta";
  const STATS_KEY = "OituCardsDeckStatsV3";
  const PERSIST_DELAY = 120;

  let originalLibraryRender = null;
  let libraryApi = window.OituLibrary;
  let persistTimer = null;
  let rebuildPromise = null;
  let bulkContext = null;
  let nextDueTimer = null;
  const deckReconcileTimers = new Map();

  function readStats() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
      return new Map(Object.entries(parsed));
    } catch (_) {
      return new Map();
    }
  }

  const stats = readStats();

  function writeStatsSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try { localStorage.setItem(STATS_KEY, JSON.stringify(Object.fromEntries(stats))); }
      catch (_) {}
    }, PERSIST_DELAY);
  }

  function isNew(card) {
    const count = Number.isInteger(card?.reviewCount)
      ? card.reviewCount
      : (card?.lastReviewedAt || card?.nextReviewAt || card?.lastRating ? 1 : 0);
    return count === 0 && !card?.lastReviewedAt && !card?.nextReviewAt && !card?.lastRating;
  }

  function classify(card, now = Date.now()) {
    const studied = Boolean(card?.reviewStatus);
    if (isNew(card)) return { studied, due: false, future: null };
    if (!card?.nextReviewAt) return { studied, due: true, future: null };
    const time = new Date(card.nextReviewAt).getTime();
    if (!Number.isFinite(time)) return { studied, due: true, future: null };
    return time <= now
      ? { studied, due: true, future: null }
      : { studied, due: false, future: time };
  }

  function emptyStat() {
    return { total: 0, studied: 0, due: 0, nextFutureAt: null, updatedAt: Date.now() };
  }

  function aggregate(items) {
    const out = emptyStat();
    const now = Date.now();
    for (const card of items || []) {
      out.total += 1;
      const info = classify(card, now);
      if (info.studied) out.studied += 1;
      if (info.due) out.due += 1;
      if (info.future !== null && (out.nextFutureAt === null || info.future < out.nextFutureAt)) {
        out.nextFutureAt = info.future;
      }
    }
    out.updatedAt = now;
    return out;
  }

  async function openDb() {
    if (window.OituDB?.openDB) return OituDB.openDB();
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function allMetas() {
    if (window.OituDB?.getAllCardMetas) return OituDB.getAllCardMetas();
    const db = await openDb();
    if (!db.objectStoreNames.contains(META_STORE)) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function metasForDeck(deckId) {
    if (window.OituDB?.getCardMetasByDeck) return OituDB.getCardMetasByDeck(deckId);
    const db = await openDb();
    if (!db.objectStoreNames.contains(META_STORE)) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).index("deckId").getAll(IDBKeyRange.only(deckId));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function rebuildAllStats() {
    if (rebuildPromise) return rebuildPromise;
    rebuildPromise = (async () => {
      const items = await allMetas();
      const grouped = new Map();
      for (const meta of items) {
        if (!grouped.has(meta.deckId)) grouped.set(meta.deckId, []);
        grouped.get(meta.deckId).push(meta);
      }
      for (const [deckId, cards] of grouped) stats.set(deckId, aggregate(cards));
      writeStatsSoon();
      scheduleNextDue();
      return true;
    })().finally(() => { rebuildPromise = null; });
    return rebuildPromise;
  }

  async function reconcileDeck(deckId) {
    if (!deckId) return emptyStat();
    const cards = await metasForDeck(deckId);
    const next = aggregate(cards);
    stats.set(deckId, next);
    writeStatsSoon();
    scheduleNextDue();
    return next;
  }

  function scheduleDeckReconcile(deckId, delay = 35) {
    if (!deckId) return;
    clearTimeout(deckReconcileTimers.get(deckId));
    deckReconcileTimers.set(deckId, setTimeout(() => {
      deckReconcileTimers.delete(deckId);
      reconcileDeck(deckId).then(() => {
        if (document.querySelector("#homeView.active") && originalLibraryRender) originalLibraryRender().catch?.(() => {});
      }).catch(() => {});
    }, delay));
  }

  async function statFor(deckId) {
    let value = stats.get(deckId) || null;
    if (!value) {
      await rebuildAllStats().catch(() => {});
      value = stats.get(deckId) || emptyStat();
    }
    if (value.nextFutureAt && value.nextFutureAt <= Date.now()) {
      value = await reconcileDeck(deckId).catch(() => value);
    }
    return value;
  }

  function summaryProxy(stat) {
    const proxy = {
      __oitucardsSummaryProxy: true,
      length: Math.max(0, Number(stat.total) || 0),
      filter(predicate) {
        const source = `${predicate?.name || ""} ${String(predicate || "")}`;
        if (/reviewStatus/.test(source)) return { length: Math.max(0, Number(stat.studied) || 0) };
        if (/isDue|nextReviewAt|endToday/.test(source)) return { length: Math.max(0, Number(stat.due) || 0) };
        return { length: 0 };
      },
      map() { return proxy; },
      forEach() {},
      slice() { return []; },
      [Symbol.iterator]: function* () {}
    };
    return proxy;
  }

  function isLibrarySummaryCall() {
    const stack = String(new Error().stack || "");
    return /buildSummaries/.test(stack) && /library\.js/.test(stack);
  }

  function captureLibraryApi() {
    try {
      Object.defineProperty(window, "OituLibrary", {
        configurable: true,
        enumerable: true,
        get() { return libraryApi; },
        set(value) {
          libraryApi = value;
          if (!originalLibraryRender && typeof value?.render === "function") originalLibraryRender = value.render.bind(value);
        }
      });
    } catch (_) {}
  }

  function installDbFastPath() {
    if (!window.OituDB || OituDB.getCardsByDeck?.__oitucardsInstantSummary) return;
    const previousGetCards = OituDB.getCardsByDeck.bind(OituDB);
    const wrappedGetCards = async function (deckId, ...args) {
      if (isLibrarySummaryCall()) return summaryProxy(await statFor(deckId));
      return previousGetCards(deckId, ...args);
    };
    wrappedGetCards.__oitucardsInstantSummary = true;
    wrappedGetCards.__oitucardsPrevious = previousGetCards;
    OituDB.getCardsByDeck = wrappedGetCards;

    const previousGetDeck = OituDB.getDeck?.bind(OituDB);
    if (previousGetDeck && !OituDB.getDeck.__oitucardsBulkStudy) {
      const getDeckWrapped = async function (id, ...args) {
        if (bulkContext?.deckMap?.has(id)) return { ...bulkContext.deckMap.get(id) };
        return previousGetDeck(id, ...args);
      };
      getDeckWrapped.__oitucardsBulkStudy = true;
      OituDB.getDeck = getDeckWrapped;
    }
  }

  function installMetaBulkFastPath() {
    if (!window.OituDB?.getCardMetasByDeck || OituDB.getCardMetasByDeck.__oitucardsBulkStudy) return;
    const previous = OituDB.getCardMetasByDeck.bind(OituDB);
    const wrapped = async function (deckId, ...args) {
      if (bulkContext?.metaMap?.has(deckId)) return bulkContext.metaMap.get(deckId).map((item) => ({ ...item }));
      return previous(deckId, ...args);
    };
    wrapped.__oitucardsBulkStudy = true;
    OituDB.getCardMetasByDeck = wrapped;
  }

  async function metasByDeckIds(deckIds) {
    const ids = [...new Set((deckIds || []).filter(Boolean))];
    const result = new Map(ids.map((id) => [id, []]));
    if (!ids.length) return result;
    const db = await openDb();
    if (!db.objectStoreNames.contains(META_STORE)) return result;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const index = tx.objectStore(META_STORE).index("deckId");
      for (const id of ids) {
        const req = index.getAll(IDBKeyRange.only(id));
        req.onsuccess = () => result.set(id, req.result || []);
        req.onerror = () => reject(req.error);
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao preparar estudo combinado."));
    });
  }

  function installMultiStudyFastPath() {
    const api = window.OituMultiStudy;
    if (!api?.openConfig || api.openConfig.__oitucardsInstantBulkStudy) return;
    const previous = api.openConfig;
    const wrapped = async function (deckIds, ...args) {
      const ids = [...new Set((deckIds || []).filter(Boolean))];
      const [decks, metaMap] = await Promise.all([
        OituDB.getDecks(),
        metasByDeckIds(ids)
      ]);
      const wanted = new Set(ids);
      bulkContext = {
        deckMap: new Map(decks.filter((deck) => wanted.has(deck.id)).map((deck) => [deck.id, deck])),
        metaMap
      };
      try {
        return await previous.call(this, ids, ...args);
      } finally {
        bulkContext = null;
      }
    };
    wrapped.__oitucardsInstantBulkStudy = true;
    api.openConfig = wrapped;
  }

  function patchLowLevelAdds() {
    const proto = window.IDBObjectStore?.prototype;
    if (!proto?.add || proto.add.__oitucardsInstantStats) return;
    const previousAdd = proto.add;
    proto.add = function (value, key) {
      const req = arguments.length > 1 ? previousAdd.call(this, value, key) : previousAdd.call(this, value);
      if (this.name === "cards" && value?.deckId) {
        req.addEventListener("success", () => {
          const current = stats.get(value.deckId) || emptyStat();
          const info = classify(value);
          current.total += 1;
          if (info.studied) current.studied += 1;
          if (info.due) current.due += 1;
          if (info.future !== null && (current.nextFutureAt === null || info.future < current.nextFutureAt)) current.nextFutureAt = info.future;
          current.updatedAt = Date.now();
          stats.set(value.deckId, current);
          writeStatsSoon();
        }, { once: true });
      }
      return req;
    };
    proto.add.__oitucardsInstantStats = true;
  }

  function patchLowLevelChanges() {
    const proto = window.IDBObjectStore?.prototype;
    if (!proto) return;

    if (proto.put && !proto.put.__oitucardsInstantStats) {
      const previousPut = proto.put;
      proto.put = function (value, key) {
        const tx = this.transaction;
        const deckId = this.name === "cards" ? value?.deckId : null;
        const req = arguments.length > 1 ? previousPut.call(this, value, key) : previousPut.call(this, value);
        if (deckId) tx?.addEventListener?.("complete", () => scheduleDeckReconcile(deckId), { once: true });
        return req;
      };
      proto.put.__oitucardsInstantStats = true;
    }

    if (proto.delete && !proto.delete.__oitucardsInstantStats) {
      const previousDelete = proto.delete;
      proto.delete = function (key) {
        const tx = this.transaction;
        let deckId = null;
        if (this.name === "cards") {
          try {
            const metaReq = tx.objectStore(META_STORE).get(key);
            metaReq.onsuccess = () => { deckId = metaReq.result?.deckId || null; };
          } catch (_) {}
        }
        const req = previousDelete.call(this, key);
        if (this.name === "cards") tx?.addEventListener?.("complete", () => { if (deckId) scheduleDeckReconcile(deckId); }, { once: true });
        return req;
      };
      proto.delete.__oitucardsInstantStats = true;
    }
  }

  function restoreOriginalLibraryRender() {
    if (!libraryApi || !originalLibraryRender) return;
    const current = libraryApi.render;
    if (current === originalLibraryRender) return;
    if (current?.__libraryDueSyncWrapped || !current?.__oitucardsInstantRenderRestored) {
      const restored = async function (...args) { return originalLibraryRender(...args); };
      restored.__oitucardsInstantRenderRestored = true;
      libraryApi.render = restored;
    }
  }

  function updateDueBadgesFromStats() {
    document.querySelectorAll("#deckList [data-deck-id]").forEach((row) => {
      const stat = stats.get(row.dataset.deckId);
      if (!stat) return;
      const badge = row.querySelector(".review-due-badge");
      if (!badge) return;
      const due = Math.max(0, Number(stat.due) || 0);
      badge.textContent = `↻ ${due} ${due === 1 ? "revisão" : "revisões"} hoje`;
      badge.classList.toggle("has-due", due > 0);
    });
  }

  function scheduleNextDue() {
    clearTimeout(nextDueTimer);
    nextDueTimer = null;
    let next = null;
    const now = Date.now();
    for (const value of stats.values()) {
      const at = Number(value?.nextFutureAt);
      if (Number.isFinite(at) && at > now && (next === null || at < next)) next = at;
    }
    if (next === null) return;
    const delay = Math.min(2147483000, Math.max(100, next - now + 60));
    nextDueTimer = setTimeout(async () => {
      const stale = [...stats.entries()].filter(([, value]) => Number(value?.nextFutureAt) <= Date.now()).map(([id]) => id);
      await Promise.all(stale.map((id) => reconcileDeck(id).catch(() => {})));
      if (document.querySelector("#homeView.active") && originalLibraryRender) await originalLibraryRender().catch?.(() => {});
      updateDueBadgesFromStats();
      scheduleNextDue();
    }, delay);
  }

  function init() {
    installDbFastPath();
    installMetaBulkFastPath();
    installMultiStudyFastPath();
    restoreOriginalLibraryRender();
    scheduleNextDue();

    setTimeout(() => {
      installDbFastPath();
      installMetaBulkFastPath();
      installMultiStudyFastPath();
      restoreOriginalLibraryRender();
    }, 0);
    setTimeout(() => {
      installDbFastPath();
      installMetaBulkFastPath();
      installMultiStudyFastPath();
      restoreOriginalLibraryRender();
    }, 350);
  }

  captureLibraryApi();
  patchLowLevelAdds();
  patchLowLevelChanges();

  window.OituInstantScale = {
    rebuildAllStats,
    reconcileDeck,
    statFor,
    getOriginalLibraryRender: () => originalLibraryRender
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();