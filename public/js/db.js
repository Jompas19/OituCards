(function () {
  const DB_NAME = "OituCardsDB";
  const DB_VERSION = 1;
  const REVIEW_MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  const GLOBAL_REVIEW_MODEL_KEY = "OituCardsGlobalReviewModelV1";
  const SYSTEM_REVIEW_SETTINGS = Object.freeze({
    newIntervals: Object.freeze({ hard: 1, medium: 2, good: 4, easy: 7 }),
    multipliers: Object.freeze({ hard: 1.2, medium: 1.8, good: 2.5, easy: 4 }),
    maxIntervalDays: 180
  });
  const REVIEW_RATINGS = ["hard", "medium", "good", "easy"];
  let dbPromise = null;
  const cardCacheByDeck = new Map();
  const cardCacheExpiry = new Map();
  const cardCacheTimers = new Map();
  const CARD_CACHE_TTL_MS = 90000;

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function cardReviewCount(card) {
    if (Number.isInteger(card?.reviewCount) && card.reviewCount >= 0) return card.reviewCount;
    return card?.lastReviewedAt || card?.nextReviewAt || card?.lastRating || card?.reviewStatus ? 1 : 0;
  }

  function cardIsStudied(card) {
    return cardReviewCount(card) > 0 || Boolean(card?.reviewStatus);
  }

  function cardIsDueToday(card) {
    if (!cardIsStudied(card)) return false;
    if (!card?.nextReviewAt) return true;
    const due = new Date(card.nextReviewAt);
    if (Number.isNaN(due.getTime())) return true;
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return due <= end;
  }

  function cloneCards(cards) {
    return (cards || []).map((card) => ({ ...card }));
  }

  function clearExpiredCardCache(deckId) {
    if ((cardCacheExpiry.get(deckId) || 0) > Date.now()) return false;
    cardCacheByDeck.delete(deckId);
    cardCacheExpiry.delete(deckId);
    clearTimeout(cardCacheTimers.get(deckId));
    cardCacheTimers.delete(deckId);
    return true;
  }

  function scheduleCardCacheExpiry(deckId, ttlMs) {
    clearTimeout(cardCacheTimers.get(deckId));
    const timer = setTimeout(() => clearExpiredCardCache(deckId), ttlMs + 50);
    cardCacheTimers.set(deckId, timer);
  }

  function seedCardsByDeck(deckId, cards, ttlMs = CARD_CACHE_TTL_MS) {
    if (!deckId || !Array.isArray(cards)) return;
    const ttl = Math.max(1000, Number(ttlMs) || CARD_CACHE_TTL_MS);
    cardCacheByDeck.set(deckId, cards);
    cardCacheExpiry.set(deckId, Date.now() + ttl);
    scheduleCardCacheExpiry(deckId, ttl);
  }

  function cachedCardsByDeck(deckId) {
    if (!cardCacheByDeck.has(deckId) || clearExpiredCardCache(deckId)) return null;
    cardCacheExpiry.set(deckId, Date.now() + CARD_CACHE_TTL_MS);
    scheduleCardCacheExpiry(deckId, CARD_CACHE_TTL_MS);
    return cardCacheByDeck.get(deckId);
  }

  // Compatibilidade do rollback: alguns navegadores ficaram com OituCardsDB
  // na versão 2 após os testes antigos. O código estável usa a versão 1.
  // Interceptamos somente esse caso para abrir a versão existente sem alterar
  // o esquema nem apagar dados do usuário.
  try {
    const factoryProto = Object.getPrototypeOf(indexedDB);
    const nativeOpen = factoryProto?.open;
    if (typeof nativeOpen === "function" && !nativeOpen.__oitucardsLegacyVersionCompat) {
      const compatOpen = function (name, version) {
        if (String(name) === DB_NAME && Number(version) === DB_VERSION) {
          return nativeOpen.call(this, name);
        }
        return arguments.length >= 2
          ? nativeOpen.call(this, name, version)
          : nativeOpen.call(this, name);
      };
      compatOpen.__oitucardsLegacyVersionCompat = true;
      factoryProto.open = compatOpen;
    }
  } catch (_) {}

  function normalizeReviewSettings(raw) {
    const source = raw || {};
    const intervals = source.newIntervals || source || {};
    const multipliers = source.multipliers || {};
    const parsedMax = Number.parseInt(source.maxIntervalDays, 10);
    const maxIntervalDays = Number.isInteger(parsedMax) && parsedMax >= 1 && parsedMax <= 3650
      ? parsedMax
      : SYSTEM_REVIEW_SETTINGS.maxIntervalDays;
    const newIntervals = {};
    const normalizedMultipliers = {};

    REVIEW_RATINGS.forEach((rating) => {
      const interval = Number.parseInt(intervals[rating], 10);
      newIntervals[rating] = Number.isInteger(interval) && interval >= 1
        ? Math.min(maxIntervalDays, interval)
        : SYSTEM_REVIEW_SETTINGS.newIntervals[rating];

      const multiplier = Number.parseFloat(multipliers[rating]);
      normalizedMultipliers[rating] = Number.isFinite(multiplier) && multiplier >= 1
        ? Math.min(10, Math.round(multiplier * 100) / 100)
        : SYSTEM_REVIEW_SETTINGS.multipliers[rating];
    });

    return { newIntervals, multipliers: normalizedMultipliers, maxIntervalDays };
  }

  function cloneReviewSettings(settings) {
    const normalized = normalizeReviewSettings(settings);
    return {
      newIntervals: { ...normalized.newIntervals },
      multipliers: { ...normalized.multipliers },
      maxIntervalDays: normalized.maxIntervalDays
    };
  }

  function readReviewModels() {
    try {
      const parsed = JSON.parse(localStorage.getItem(REVIEW_MODEL_STORAGE_KEY) || "[]");
      return Array.isArray(parsed)
        ? parsed.filter((item) => item?.id && item?.settings)
        : [];
    } catch (_) {
      return [];
    }
  }

  function globalReviewDefaults() {
    let value = "system";
    try {
      const stored = String(localStorage.getItem(GLOBAL_REVIEW_MODEL_KEY) || "system");
      if (stored === "system") {
        value = "system";
      } else if (stored.startsWith("model:") && readReviewModels().some((model) => `model:${model.id}` === stored)) {
        value = stored;
      }
    } catch (_) {
      value = "system";
    }

    let settings = cloneReviewSettings(SYSTEM_REVIEW_SETTINGS);
    if (value.startsWith("model:")) {
      const id = value.slice(6);
      const model = readReviewModels().find((item) => item.id === id);
      if (model) settings = cloneReviewSettings(model.settings);
    }

    return {
      reviewSettings: settings,
      reviewModelMode: "global",
      reviewModelId: value
    };
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("decks")) {
          const deckStore = db.createObjectStore("decks", { keyPath: "id" });
          deckStore.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("cards")) {
          const cardStore = db.createObjectStore("cards", { keyPath: "id" });
          cardStore.createIndex("deckId", "deckId", { unique: false });
          cardStore.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function run(storeName, mode, executor) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = executor(store); }
      catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transação cancelada."));
    });
  }

  async function addDeck(name, options = {}) {
    const now = new Date().toISOString();
    const deck = {
      id: crypto.randomUUID(),
      kind: "deck",
      name: name.trim(),
      folderId: options.folderId || null,
      cardCount: 0,
      studiedCount: 0,
      dueCount: 0,
      summaryDate: todayKey(),
      ...globalReviewDefaults(),
      createdAt: now,
      updatedAt: now
    };
    await run("decks", "readwrite", (store) => store.add(deck));
    return deck;
  }

  async function updateDeck(id, patch) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readwrite");
      const store = tx.objectStore("decks");
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const current = getReq.result;
        if (!current || current.kind === "folder") {
          reject(new Error("Baralho não encontrado."));
          tx.abort();
          return;
        }
        const updated = { ...current, ...patch, kind: "deck", id, updatedAt: new Date().toISOString() };
        store.put(updated);
        resolve(updated);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async function updateDeckSummary(id, summary) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readwrite");
      const store = tx.objectStore("decks");
      const req = store.get(id);
      req.onsuccess = () => {
        const current = req.result;
        if (!current || current.kind === "folder") return;
        store.put({ ...current, ...summary, id, kind: "deck" });
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível atualizar o resumo do baralho."));
    });
  }

  async function getDeck(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readonly");
      const req = tx.objectStore("decks").get(id);
      req.onsuccess = () => {
        const value = req.result || null;
        resolve(value && value.kind !== "folder" ? value : null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getDecks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readonly");
      const req = tx.objectStore("decks").getAll();
      req.onsuccess = () => {
        const list = (req.result || []).filter((item) => item.kind !== "folder");
        list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteLibraryItems(deckIds = [], folderIds = []) {
    const uniqueDeckIds = [...new Set((deckIds || []).filter(Boolean))];
    const uniqueFolderIds = [...new Set((folderIds || []).filter(Boolean))];
    if (!uniqueDeckIds.length && !uniqueFolderIds.length) return;

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["decks", "cards"], "readwrite");
      const decks = tx.objectStore("decks");
      const cards = tx.objectStore("cards");
      const deckIndex = cards.index("deckId");

      uniqueFolderIds.forEach((id) => decks.delete(id));

      uniqueDeckIds.forEach((id) => {
        decks.delete(id);
        const range = IDBKeyRange.only(id);

        if (typeof deckIndex.getAllKeys === "function") {
          const keysReq = deckIndex.getAllKeys(range);
          keysReq.onsuccess = () => {
            for (const key of keysReq.result || []) cards.delete(key);
          };
        } else {
          const cursorReq = deckIndex.openCursor(range);
          cursorReq.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };
        }
      });

      tx.oncomplete = () => {
        uniqueDeckIds.forEach((id) => {
          cardCacheByDeck.delete(id);
          cardCacheExpiry.delete(id);
          clearTimeout(cardCacheTimers.get(id));
          cardCacheTimers.delete(id);
        });
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível concluir a exclusão."));
    });
  }

  async function deleteDeck(id) {
    return deleteLibraryItems([id], []);
  }

  async function addFolder(name, parentId = null) {
    const now = new Date().toISOString();
    const folder = {
      id: crypto.randomUUID(),
      kind: "folder",
      name: name.trim(),
      parentId: parentId || null,
      ...globalReviewDefaults(),
      createdAt: now,
      updatedAt: now
    };
    await run("decks", "readwrite", (store) => store.add(folder));
    return folder;
  }

  async function updateFolder(id, patch) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readwrite");
      const store = tx.objectStore("decks");
      const req = store.get(id);
      req.onsuccess = () => {
        const current = req.result;
        if (!current || current.kind !== "folder") {
          reject(new Error("Pasta não encontrada."));
          tx.abort();
          return;
        }
        const updated = { ...current, ...patch, kind: "folder", id, updatedAt: new Date().toISOString() };
        store.put(updated);
        resolve(updated);
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível atualizar a pasta."));
    });
  }

  async function getFolder(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readonly");
      const req = tx.objectStore("decks").get(id);
      req.onsuccess = () => {
        const value = req.result || null;
        resolve(value?.kind === "folder" ? value : null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getFolders() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readonly");
      const req = tx.objectStore("decks").getAll();
      req.onsuccess = () => {
        const list = (req.result || []).filter((item) => item.kind === "folder");
        list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteFolder(id) {
    return deleteLibraryItems([], [id]);
  }

  async function addCard(deckId, frontHtml, backHtml) {
    const now = new Date().toISOString();
    const card = {
      id: crypto.randomUUID(), deckId, frontHtml, backHtml,
      reviewStatus: null, createdAt: now, updatedAt: now
    };
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["cards", "decks"], "readwrite");
      tx.objectStore("cards").add(card);
      const decks = tx.objectStore("decks");
      const req = decks.get(deckId);
      req.onsuccess = () => {
        if (req.result && req.result.kind !== "folder") {
          const current = req.result;
          const patch = { ...current, kind: "deck", updatedAt: now };
          if (Number.isInteger(current.cardCount)) patch.cardCount = current.cardCount + 1;
          if (current.summaryDate === todayKey()) patch.dueCount = Number(current.dueCount) || 0;
          decks.put(patch);
        }
      };
      tx.oncomplete = () => {
        const cached = cachedCardsByDeck(deckId);
        if (cached) cached.push(card);
        resolve(card);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function updateCard(id, patch) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["cards", "decks"], "readwrite");
      const cards = tx.objectStore("cards");
      const req = cards.get(id);
      req.onsuccess = () => {
        const current = req.result;
        if (!current) { reject(new Error("Flashcard não encontrado.")); tx.abort(); return; }
        const now = new Date().toISOString();
        const updated = { ...current, ...patch, id, updatedAt: now };
        cards.put(updated);
        const decks = tx.objectStore("decks");
        const deckReq = decks.get(current.deckId);
        deckReq.onsuccess = () => {
          if (deckReq.result && deckReq.result.kind !== "folder") {
            const deck = deckReq.result;
            const deckPatch = { ...deck, kind: "deck", updatedAt: now };
            if (Number.isInteger(deck.studiedCount)) {
              deckPatch.studiedCount = Math.max(0, deck.studiedCount + Number(cardIsStudied(updated)) - Number(cardIsStudied(current)));
            }
            if (deck.summaryDate === todayKey() && Number.isInteger(deck.dueCount)) {
              deckPatch.dueCount = Math.max(0, deck.dueCount + Number(cardIsDueToday(updated)) - Number(cardIsDueToday(current)));
            } else {
              delete deckPatch.summaryDate;
            }
            decks.put(deckPatch);
          }
        };
        tx.oncomplete = () => {
          const cached = cachedCardsByDeck(current.deckId);
          if (cached) {
            const index = cached.findIndex((card) => card.id === id);
            if (index >= 0) cached[index] = updated;
          }
          resolve(updated);
        };
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível atualizar o flashcard."));
    });
  }

  async function getCard(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readonly");
      const req = tx.objectStore("cards").get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getCardsByDeck(deckId) {
    const cached = cachedCardsByDeck(deckId);
    if (cached) return cloneCards(cached);
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readonly");
      const req = tx.objectStore("cards").index("deckId").getAll(IDBKeyRange.only(deckId));
      req.onsuccess = () => {
        const cards = req.result || [];
        cards.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        seedCardsByDeck(deckId, cards);
        resolve(cloneCards(cards));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteCard(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["cards", "decks"], "readwrite");
      const cards = tx.objectStore("cards");
      const getReq = cards.get(id);
      let deletedDeckId = null;

      getReq.onsuccess = () => {
        const card = getReq.result;
        if (!card) return;
        deletedDeckId = card.deckId;

        cards.delete(id);
        const decks = tx.objectStore("decks");
        const deckReq = decks.get(card.deckId);
        deckReq.onsuccess = () => {
          if (deckReq.result && deckReq.result.kind !== "folder") {
            const deck = deckReq.result;
            const patch = { ...deck, kind: "deck", updatedAt: new Date().toISOString() };
            if (Number.isInteger(deck.cardCount)) patch.cardCount = Math.max(0, deck.cardCount - 1);
            if (Number.isInteger(deck.studiedCount) && cardIsStudied(card)) patch.studiedCount = Math.max(0, deck.studiedCount - 1);
            if (deck.summaryDate === todayKey() && Number.isInteger(deck.dueCount) && cardIsDueToday(card)) {
              patch.dueCount = Math.max(0, deck.dueCount - 1);
            }
            decks.put(patch);
          }
        };
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => {
        const cached = deletedDeckId ? cachedCardsByDeck(deletedDeckId) : null;
        if (cached) {
          const index = cached.findIndex((card) => card.id === id);
          if (index >= 0) cached.splice(index, 1);
        }
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível excluir o flashcard."));
    });
  }

  window.OituDB = {
    openDB,
    addDeck, updateDeck, updateDeckSummary, getDeck, getDecks, deleteDeck, deleteLibraryItems,
    addFolder, updateFolder, getFolder, getFolders, deleteFolder,
    addCard, updateCard, getCard, getCardsByDeck, deleteCard, seedCardsByDeck
  };
})();
