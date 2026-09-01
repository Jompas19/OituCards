(function () {
  if (window.__oitucardsScalePerformance) return;
  window.__oitucardsScalePerformance = true;

  const DB_NAME = "OituCardsDB";
  const TARGET_DB_VERSION = 2;
  const META_STORE = "cardMeta";
  const MEDIA_STORE = "media";
  const META_BATCH_SIZE = 600;

  const state = {
    libraryReadDepth: 0,
    librarySnapshot: null,
    libraryWrapped: false,
    dbHelpersInstalled: false,
    coveragePromise: null,
    rerenderAfterCoverage: false
  };

  function normalizedRating(card) {
    if (["hard", "medium", "good", "easy"].includes(card?.lastRating)) return card.lastRating;
    const history = Array.isArray(card?.ratingHistory) ? card.ratingHistory : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (["hard", "medium", "good", "easy"].includes(history[i]?.rating)) return history[i].rating;
    }
    return null;
  }

  function reviewCount(card) {
    if (Number.isInteger(card?.reviewCount) && card.reviewCount >= 0) return card.reviewCount;
    return card?.lastReviewedAt || card?.nextReviewAt || normalizedRating(card) ? 1 : 0;
  }

  function toCardMeta(card) {
    if (!card?.id || !card?.deckId) return null;
    return {
      id: card.id,
      deckId: card.deckId,
      reviewStatus: card.reviewStatus ?? null,
      lastRating: normalizedRating(card),
      lastReviewedAt: card.lastReviewedAt ?? null,
      reviewCount: reviewCount(card),
      currentIntervalDays: card.currentIntervalDays ?? null,
      currentIntervalValue: card.currentIntervalValue ?? null,
      currentIntervalUnit: card.currentIntervalUnit ?? null,
      currentIntervalMinutes: card.currentIntervalMinutes ?? null,
      currentIntervalHours: card.currentIntervalHours ?? null,
      nextReviewAt: card.nextReviewAt ?? null,
      createdAt: card.createdAt ?? null,
      updatedAt: card.updatedAt ?? card.createdAt ?? null
    };
  }

  function patchIndexedDbOpen() {
    const proto = window.IDBFactory?.prototype;
    if (!proto?.open || proto.open.__oitucardsScalePatched) return;
    const originalOpen = proto.open;

    function patchedOpen(name, version) {
      const isOitu = String(name) === DB_NAME;
      const requested = isOitu && (!Number.isInteger(version) || version < TARGET_DB_VERSION)
        ? TARGET_DB_VERSION
        : version;
      const request = Number.isInteger(requested)
        ? originalOpen.call(this, name, requested)
        : originalOpen.call(this, name);

      if (isOitu) {
        request.addEventListener("upgradeneeded", (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(META_STORE)) {
            const meta = db.createObjectStore(META_STORE, { keyPath: "id" });
            meta.createIndex("deckId", "deckId", { unique: false });
            meta.createIndex("createdAt", "createdAt", { unique: false });
            meta.createIndex("deckCreated", ["deckId", "createdAt"], { unique: false });
            meta.createIndex("nextReviewAt", "nextReviewAt", { unique: false });
          }
          if (!db.objectStoreNames.contains(MEDIA_STORE)) {
            const media = db.createObjectStore(MEDIA_STORE, { keyPath: "id" });
            media.createIndex("createdAt", "createdAt", { unique: false });
          }
        });
      }
      return request;
    }

    patchedOpen.__oitucardsScalePatched = true;
    patchedOpen.__oitucardsOriginal = originalOpen;
    proto.open = patchedOpen;
  }

  function patchTransactions() {
    const proto = window.IDBDatabase?.prototype;
    if (!proto?.transaction || proto.transaction.__oitucardsScalePatched) return;
    const originalTransaction = proto.transaction;

    function patchedTransaction(storeNames, mode, options) {
      let names = typeof storeNames === "string" ? [storeNames] : Array.from(storeNames || []);
      if (
        this.name === DB_NAME &&
        mode === "readwrite" &&
        names.includes("cards") &&
        this.objectStoreNames.contains(META_STORE) &&
        !names.includes(META_STORE)
      ) {
        names = [...names, META_STORE];
      }
      const normalized = typeof storeNames === "string" && names.length === 1 ? names[0] : names;
      return options === undefined
        ? originalTransaction.call(this, normalized, mode)
        : originalTransaction.call(this, normalized, mode, options);
    }

    patchedTransaction.__oitucardsScalePatched = true;
    patchedTransaction.__oitucardsOriginal = originalTransaction;
    proto.transaction = patchedTransaction;
  }

  function txHasStore(tx, name) {
    try { return Array.from(tx.objectStoreNames || []).includes(name); }
    catch (_) { return false; }
  }

  function patchCardWrites() {
    const proto = window.IDBObjectStore?.prototype;
    if (!proto || proto.__oitucardsScaleWritesPatched) return;

    const originalAdd = proto.add;
    const originalPut = proto.put;
    const originalDelete = proto.delete;

    proto.add = function (value, key) {
      if (this.name === "cards" && txHasStore(this.transaction, META_STORE)) {
        const meta = toCardMeta(value);
        if (meta) this.transaction.objectStore(META_STORE).put(meta);
      }
      return arguments.length > 1 ? originalAdd.call(this, value, key) : originalAdd.call(this, value);
    };

    proto.put = function (value, key) {
      if (this.name === "cards" && txHasStore(this.transaction, META_STORE)) {
        const meta = toCardMeta(value);
        if (meta) this.transaction.objectStore(META_STORE).put(meta);
      }
      return arguments.length > 1 ? originalPut.call(this, value, key) : originalPut.call(this, value);
    };

    proto.delete = function (key) {
      if (this.name === "cards" && txHasStore(this.transaction, META_STORE)) {
        this.transaction.objectStore(META_STORE).delete(key);
      }
      return originalDelete.call(this, key);
    };

    Object.defineProperty(proto, "__oitucardsScaleWritesPatched", {
      configurable: true,
      value: true
    });
  }

  async function openDb() {
    if (window.OituDB?.openDB) return OituDB.openDB();
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, TARGET_DB_VERSION);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function countStore(storeName) {
    const db = await openDb();
    if (!db.objectStoreNames.contains(storeName)) return 0;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(Number(req.result) || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllCardMetas() {
    const db = await openDb();
    if (!db.objectStoreNames.contains(META_STORE)) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getCardMetasByDeck(deckId) {
    if (state.libraryReadDepth > 0 && state.librarySnapshot) {
      return (state.librarySnapshot.get(deckId) || []).map((item) => ({ ...item }));
    }
    const db = await openDb();
    if (!db.objectStoreNames.contains(META_STORE)) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).index("deckId").getAll(IDBKeyRange.only(deckId));
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function putMetaBatch(items) {
    if (!items.length) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);
      items.forEach((item) => store.put(item));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao atualizar o índice leve dos cards."));
    });
  }

  async function scanLegacyMetas() {
    const db = await openDb();
    const metas = [];
    await new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readonly");
      const req = tx.objectStore("cards").openCursor();
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve();
          return;
        }
        const meta = toCardMeta(cursor.value);
        if (meta) metas.push(meta);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
    for (let offset = 0; offset < metas.length; offset += META_BATCH_SIZE) {
      await putMetaBatch(metas.slice(offset, offset + META_BATCH_SIZE));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return metas.length;
  }

  async function ensureCoverage() {
    if (state.coveragePromise) return state.coveragePromise;
    state.coveragePromise = (async () => {
      const [cards, metas] = await Promise.all([countStore("cards"), countStore(META_STORE)]);
      if (cards === metas) return true;
      await scanLegacyMetas();
      return true;
    })().finally(() => {
      state.coveragePromise = null;
    });
    return state.coveragePromise;
  }

  function scheduleCoverageRepair() {
    const run = () => {
      ensureCoverage().then(() => {
        if (state.rerenderAfterCoverage && window.OituLibrary?.render) {
          state.rerenderAfterCoverage = false;
          window.OituLibrary.render().catch((error) => console.warn("OituCards: rerender após indexação falhou.", error));
        }
      }).catch((error) => console.warn("OituCards: indexação leve dos cards falhou.", error));
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1200 });
    else setTimeout(run, 80);
  }

  async function cleanupDeckMeta(deckId) {
    const db = await openDb();
    if (!db.objectStoreNames.contains(META_STORE)) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      const req = tx.objectStore(META_STORE).index("deckId").openCursor(IDBKeyRange.only(deckId));
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function installDbHelpers() {
    if (state.dbHelpersInstalled || !window.OituDB) return;
    state.dbHelpersInstalled = true;

    const originalGetCardsByDeck = OituDB.getCardsByDeck?.bind(OituDB);
    if (originalGetCardsByDeck) {
      OituDB.getCardsByDeck = async function (deckId) {
        if (state.libraryReadDepth > 0 && state.librarySnapshot) {
          return getCardMetasByDeck(deckId);
        }
        return originalGetCardsByDeck(deckId);
      };
    }

    const originalDeleteDeck = OituDB.deleteDeck?.bind(OituDB);
    if (originalDeleteDeck) {
      OituDB.deleteDeck = async function (deckId) {
        const result = await originalDeleteDeck(deckId);
        cleanupDeckMeta(deckId).catch(() => {});
        return result;
      };
    }

    OituDB.getAllCardMetas = getAllCardMetas;
    OituDB.getCardMetasByDeck = getCardMetasByDeck;
    OituDB.ensureCardMetaCoverage = ensureCoverage;
  }

  function groupByDeck(metas) {
    const grouped = new Map();
    for (const meta of metas || []) {
      if (!grouped.has(meta.deckId)) grouped.set(meta.deckId, []);
      grouped.get(meta.deckId).push(meta);
    }
    grouped.forEach((list) => list.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))));
    return grouped;
  }

  function wrapLibraryRender() {
    if (state.libraryWrapped || !window.OituLibrary?.render) return;
    state.libraryWrapped = true;
    const originalRender = OituLibrary.render.bind(OituLibrary);

    OituLibrary.render = async function (...args) {
      let snapshot = [];
      try {
        snapshot = await getAllCardMetas();
        const [cardCount, metaCount] = await Promise.all([countStore("cards"), Promise.resolve(snapshot.length)]);
        if (cardCount !== metaCount) {
          state.rerenderAfterCoverage = true;
          scheduleCoverageRepair();
        }
      } catch (error) {
        console.warn("OituCards: não foi possível usar o índice leve da biblioteca.", error);
        return originalRender(...args);
      }

      state.librarySnapshot = groupByDeck(snapshot);
      state.libraryReadDepth += 1;
      try {
        return await originalRender(...args);
      } finally {
        state.libraryReadDepth = Math.max(0, state.libraryReadDepth - 1);
        if (state.libraryReadDepth === 0) state.librarySnapshot = null;
      }
    };
  }

  function init() {
    installDbHelpers();
    wrapLibraryRender();
    scheduleCoverageRepair();
  }

  patchIndexedDbOpen();
  patchTransactions();
  patchCardWrites();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();