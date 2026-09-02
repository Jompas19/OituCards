(function () {
  const DB_NAME = "OituCardsDB";
  const DB_VERSION = 3;
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
    const unit = String(card.currentIntervalUnit || "").toLocaleLowerCase("pt-BR");
    if (["minutes", "minute", "minutos", "minuto", "min", "hours", "hour", "horas", "hora", "h"].includes(unit)) {
      return due <= new Date();
    }
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return due <= end;
  }

  function cloneCards(cards) {
    return (cards || []).map((card) => ({ ...card }));
  }

  function cardMetaFromCard(card) {
    if (!card?.id || !card?.deckId) return null;
    const {
      frontHtml: _frontHtml,
      backHtml: _backHtml,
      annotationHtml: _annotationHtml,
      ratingHistory,
      ...meta
    } = card;
    if (!meta.lastRating && Array.isArray(ratingHistory)) {
      const last = [...ratingHistory].reverse().find((entry) => REVIEW_RATINGS.includes(entry?.rating));
      if (last) meta.lastRating = last.rating;
    }
    return meta;
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
    const source = settings || {};
    const normalized = normalizeReviewSettings(settings);
    const cloned = {
      newIntervals: { ...normalized.newIntervals },
      multipliers: { ...normalized.multipliers },
      maxIntervalDays: normalized.maxIntervalDays
    };
    if (source.intervalUnits && typeof source.intervalUnits === "object") cloned.intervalUnits = { ...source.intervalUnits };
    if (source.intervalUnit) cloned.intervalUnit = source.intervalUnit;
    if (source.maxIntervalUnit) cloned.maxIntervalUnit = source.maxIntervalUnit;
    return cloned;
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

  function ensureSchema(event) {
    const db = event.target.result;
    const upgradeTx = event.target.transaction;
    const deckStore = db.objectStoreNames.contains("decks")
      ? upgradeTx.objectStore("decks")
      : db.createObjectStore("decks", { keyPath: "id" });
    if (!deckStore.indexNames.contains("createdAt")) deckStore.createIndex("createdAt", "createdAt", { unique: false });

    const cardStore = db.objectStoreNames.contains("cards")
      ? upgradeTx.objectStore("cards")
      : db.createObjectStore("cards", { keyPath: "id" });
    if (!cardStore.indexNames.contains("deckId")) cardStore.createIndex("deckId", "deckId", { unique: false });
    if (!cardStore.indexNames.contains("createdAt")) cardStore.createIndex("createdAt", "createdAt", { unique: false });

    const metaStore = db.objectStoreNames.contains("cardMeta")
      ? upgradeTx.objectStore("cardMeta")
      : db.createObjectStore("cardMeta", { keyPath: "id" });
    if (!metaStore.indexNames.contains("deckId")) metaStore.createIndex("deckId", "deckId", { unique: false });
    if (!metaStore.indexNames.contains("createdAt")) metaStore.createIndex("createdAt", "createdAt", { unique: false });

    const mediaStore = db.objectStoreNames.contains("media")
      ? upgradeTx.objectStore("media")
      : db.createObjectStore("media", { keyPath: "id" });
    if (!mediaStore.indexNames.contains("deckIds")) mediaStore.createIndex("deckIds", "deckIds", { unique: false, multiEntry: true });
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    const opening = new Promise((resolve, reject) => {
      const finish = (db) => {
        let complete = ["decks", "cards", "cardMeta", "media"].every((name) => db.objectStoreNames.contains(name));
        if (complete) {
          try {
            const tx = db.transaction(["cards", "cardMeta", "media"], "readonly");
            complete = tx.objectStore("cards").indexNames.contains("deckId") &&
              tx.objectStore("cardMeta").indexNames.contains("deckId") &&
              tx.objectStore("media").indexNames.contains("deckIds");
          } catch (_) {
            complete = false;
          }
        }
        if (complete && db.version >= DB_VERSION) {
          db.onversionchange = () => db.close();
          resolve(db);
          return;
        }
        const nextVersion = Math.max(DB_VERSION, db.version + 1);
        db.close();
        const upgrade = indexedDB.open(DB_NAME, nextVersion);
        upgrade.onupgradeneeded = ensureSchema;
        upgrade.onsuccess = () => {
          upgrade.result.onversionchange = () => upgrade.result.close();
          resolve(upgrade.result);
        };
        upgrade.onerror = () => reject(upgrade.error);
        upgrade.onblocked = () => reject(new Error("Feche outras abas do OituCards e tente novamente."));
      };

      const request = indexedDB.open(DB_NAME);
      request.onupgradeneeded = ensureSchema;
      request.onsuccess = () => finish(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Feche outras abas do OituCards e tente novamente."));
    });
    dbPromise = opening.catch((error) => {
      dbPromise = null;
      throw error;
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

  async function addLibraryBatch(folderDefinitions = [], deckDefinitions = []) {
    const now = new Date().toISOString();
    const folders = (folderDefinitions || []).map((definition) => ({
      ...globalReviewDefaults(),
      ...definition,
      id: definition.id || crypto.randomUUID(),
      kind: "folder",
      name: String(definition.name || "").trim(),
      parentId: definition.parentId || null,
      createdAt: definition.createdAt || now,
      updatedAt: definition.updatedAt || now
    }));
    const decks = (deckDefinitions || []).map((definition) => ({
      ...globalReviewDefaults(),
      ...definition,
      id: definition.id || crypto.randomUUID(),
      kind: "deck",
      name: String(definition.name || "").trim(),
      folderId: definition.folderId || null,
      cardCount: Math.max(0, Number(definition.cardCount) || 0),
      studiedCount: Math.max(0, Number(definition.studiedCount) || 0),
      dueCount: Math.max(0, Number(definition.dueCount) || 0),
      summaryDate: definition.summaryDate || todayKey(),
      createdAt: definition.createdAt || now,
      updatedAt: definition.updatedAt || now
    }));
    if (!folders.length && !decks.length) return { folders, decks };

    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readwrite");
      const store = tx.objectStore("decks");
      folders.forEach((folder) => store.add(folder));
      decks.forEach((deck) => store.add(deck));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível criar a estrutura importada."));
    });
    return { folders, decks };
  }

  async function addCardsBatch(cards) {
    const list = (cards || []).filter((card) => card?.id && card?.deckId);
    if (!list.length) return 0;
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["cards", "cardMeta"], "readwrite");
      const cardStore = tx.objectStore("cards");
      const metaStore = tx.objectStore("cardMeta");
      list.forEach((card) => {
        cardStore.add(card);
        metaStore.put(cardMetaFromCard(card));
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível gravar os flashcards importados."));
    });
    return list.length;
  }

  async function putMediaBatch(records) {
    const list = (records || []).filter((record) => record?.id && record?.blob instanceof Blob);
    if (!list.length) return 0;
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("media", "readwrite");
      const store = tx.objectStore("media");
      list.forEach((record) => store.put(record));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível gravar as imagens importadas."));
    });
    return list.length;
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
      const tx = db.transaction(["decks", "cards", "cardMeta", "media"], "readwrite");
      const decks = tx.objectStore("decks");
      const cards = tx.objectStore("cards");
      const cardMeta = tx.objectStore("cardMeta");
      const media = tx.objectStore("media");
      const deckIndex = cards.index("deckId");
      const metaDeckIndex = cardMeta.index("deckId");
      const DELETE_BATCH_SIZE = 400;

      const deleteByDeckInBatches = (store, index, deckId) => {
        const range = IDBKeyRange.only(deckId);

        if (typeof index.getAllKeys === "function") {
          const deleteNextBatch = () => {
            const keysReq = index.getAllKeys(range, DELETE_BATCH_SIZE);
            keysReq.onsuccess = () => {
              const keys = keysReq.result || [];
              keys.forEach((key) => store.delete(key));
              if (keys.length === DELETE_BATCH_SIZE) deleteNextBatch();
            };
          };
          deleteNextBatch();
          return;
        }

        const cursorReq = index.openCursor(range);
        cursorReq.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      };

      uniqueFolderIds.forEach((id) => decks.delete(id));

      uniqueDeckIds.forEach((id) => {
        decks.delete(id);
        deleteByDeckInBatches(cards, deckIndex, id);
        deleteByDeckInBatches(cardMeta, metaDeckIndex, id);
      });

      if (uniqueDeckIds.length) {
        const deletedIds = new Set(uniqueDeckIds);
        const mediaIndex = media.index("deckIds");
        const touchedKeys = new Set();
        let pendingDeckLookups = uniqueDeckIds.length;
        const updateTouchedMedia = () => {
          touchedKeys.forEach((key) => {
            const request = media.get(key);
            request.onsuccess = () => {
              const record = request.result;
              if (!record) return;
              const nextDeckIds = (record.deckIds || []).filter((id) => !deletedIds.has(id));
              if (!nextDeckIds.length) media.delete(key);
              else if (nextDeckIds.length !== (record.deckIds || []).length) media.put({ ...record, deckIds: nextDeckIds });
            };
          });
        };
        uniqueDeckIds.forEach((deckId) => {
          const request = mediaIndex.getAllKeys(IDBKeyRange.only(deckId));
          request.onsuccess = () => {
            (request.result || []).forEach((key) => touchedKeys.add(key));
            pendingDeckLookups -= 1;
            if (!pendingDeckLookups) updateTouchedMedia();
          };
        });
      }

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
      const tx = db.transaction(["cards", "cardMeta", "decks"], "readwrite");
      tx.objectStore("cards").add(card);
      tx.objectStore("cardMeta").put(cardMetaFromCard(card));
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
      const tx = db.transaction(["cards", "cardMeta", "decks"], "readwrite");
      const cards = tx.objectStore("cards");
      const req = cards.get(id);
      req.onsuccess = () => {
        const current = req.result;
        if (!current) { reject(new Error("Flashcard não encontrado.")); tx.abort(); return; }
        const now = new Date().toISOString();
        const updated = { ...current, ...patch, id, updatedAt: now };
        cards.put(updated);
        tx.objectStore("cardMeta").put(cardMetaFromCard(updated));
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

  async function backfillCardSummaries(deckIds) {
    const uniqueIds = [...new Set((deckIds || []).filter(Boolean))];
    const result = new Map(uniqueIds.map((deckId) => [deckId, []]));
    if (!uniqueIds.length) return result;
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["cards", "cardMeta"], "readwrite");
      const index = tx.objectStore("cards").index("deckId");
      const metaStore = tx.objectStore("cardMeta");
      uniqueIds.forEach((deckId) => {
        const request = index.openCursor(IDBKeyRange.only(deckId));
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) return;
          const meta = cardMetaFromCard(cursor.value);
          if (meta) {
            result.get(deckId).push(meta);
            metaStore.put(meta);
          }
          cursor.continue();
        };
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível preparar os metadados dos flashcards antigos."));
    });
    result.forEach((cards) => cards.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
    return result;
  }

  async function getCardSummariesByDeck(deckId) {
    const db = await openDB();
    const [summaries, deck] = await Promise.all([
      new Promise((resolve, reject) => {
        const tx = db.transaction("cardMeta", "readonly");
        const req = tx.objectStore("cardMeta").index("deckId").getAll(IDBKeyRange.only(deckId));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      }),
      getDeck(deckId)
    ]);
    if (Number.isInteger(deck?.cardCount) && summaries.length === deck.cardCount) {
      summaries.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      return summaries;
    }

    return (await backfillCardSummaries([deckId])).get(deckId) || [];
  }

  async function getCardSummariesForDecks(deckIds) {
    const uniqueIds = [...new Set((deckIds || []).filter(Boolean))];
    if (!uniqueIds.length) return [];
    const db = await openDB();
    const grouped = await new Promise((resolve, reject) => {
      const tx = db.transaction("cardMeta", "readonly");
      const index = tx.objectStore("cardMeta").index("deckId");
      const result = new Map();
      uniqueIds.forEach((deckId) => {
        const req = index.getAll(IDBKeyRange.only(deckId));
        req.onsuccess = () => result.set(deckId, req.result || []);
      });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível carregar os resumos dos flashcards."));
    });

    const deckCounts = new Map((await getDecks()).map((deck) => [deck.id, deck.cardCount]));
    const missing = uniqueIds.filter((deckId) => {
      const expected = deckCounts.get(deckId);
      return !Number.isInteger(expected) || (grouped.get(deckId) || []).length !== expected;
    });
    if (missing.length) {
      const legacy = await backfillCardSummaries(missing);
      missing.forEach((deckId) => grouped.set(deckId, legacy.get(deckId) || []));
    }
    grouped.forEach((cards) => {
      cards.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    });
    return uniqueIds.flatMap((deckId) => grouped.get(deckId) || []);
  }

  async function resetDeckProgressBatch(cards) {
    const list = (cards || []).filter((card) => card?.id && card?.deckId);
    if (!list.length) return 0;
    const patch = {
      reviewStatus: null,
      lastRating: null,
      lastReviewedAt: null,
      reviewCount: 0,
      currentIntervalDays: null,
      currentIntervalValue: null,
      currentIntervalUnit: null,
      currentIntervalMinutes: null,
      currentIntervalHours: null,
      nextReviewAt: null,
      ratingHistory: []
    };
    const db = await openDB();
    const chunkSize = 500;
    const updatedAt = new Date().toISOString();

    for (let offset = 0; offset < list.length; offset += chunkSize) {
      const chunk = list.slice(offset, offset + chunkSize);
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["cards", "cardMeta"], "readwrite");
        const cardStore = tx.objectStore("cards");
        const metaStore = tx.objectStore("cardMeta");
        chunk.forEach(({ id }) => {
          const request = cardStore.get(id);
          request.onsuccess = () => {
            const current = request.result;
            if (!current) return;
            const updated = { ...current, ...patch, updatedAt };
            cardStore.put(updated);
            metaStore.put(cardMetaFromCard(updated));
          };
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Não foi possível reiniciar o progresso dos flashcards."));
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const deckIds = [...new Set(list.map((card) => card.deckId))];
    await new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readwrite");
      const store = tx.objectStore("decks");
      deckIds.forEach((deckId) => {
        const request = store.get(deckId);
        request.onsuccess = () => {
          const deck = request.result;
          if (!deck || deck.kind === "folder") return;
          store.put({
            ...deck,
            studiedCount: 0,
            dueCount: 0,
            summaryDate: todayKey(),
            updatedAt
          });
        };
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível atualizar os resumos dos baralhos."));
    });

    deckIds.forEach((deckId) => {
      const cached = cachedCardsByDeck(deckId);
      if (cached) cached.forEach((card) => Object.assign(card, patch));
    });
    return list.length;
  }

  async function getMediaBatch(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (!uniqueIds.length) return new Map();
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("media", "readonly");
      const store = tx.objectStore("media");
      const result = new Map();
      uniqueIds.forEach((id) => {
        const req = store.get(id);
        req.onsuccess = () => { if (req.result) result.set(id, req.result); };
      });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível carregar a mídia."));
    });
  }

  async function deleteCard(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["cards", "cardMeta", "decks"], "readwrite");
      const cards = tx.objectStore("cards");
      const getReq = cards.get(id);
      let deletedDeckId = null;

      getReq.onsuccess = () => {
        const card = getReq.result;
        if (!card) return;
        deletedDeckId = card.deckId;

        cards.delete(id);
        tx.objectStore("cardMeta").delete(id);
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

  async function hydrateMedia(root) {
    if (!(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)) return;
    const images = [
      ...(root instanceof HTMLImageElement && root.dataset.oituMediaId ? [root] : []),
      ...root.querySelectorAll("img[data-oitu-media-id]")
    ].filter((image) => !image.dataset.oituMediaPending && !image.dataset.oituMediaLoaded);
    if (!images.length) return;

    images.forEach((image) => { image.dataset.oituMediaPending = "true"; });
    let records;
    try {
      records = await getMediaBatch(images.map((image) => image.dataset.oituMediaId));
    } catch (error) {
      images.forEach((image) => { delete image.dataset.oituMediaPending; });
      throw error;
    }

    images.forEach((image) => {
      delete image.dataset.oituMediaPending;
      if (!image.isConnected) return;
      const record = records.get(image.dataset.oituMediaId);
      if (!record?.blob) {
        image.dataset.oituMediaMissing = "true";
        return;
      }
      const url = URL.createObjectURL(record.blob);
      const release = () => URL.revokeObjectURL(url);
      image.addEventListener("load", release, { once: true });
      image.addEventListener("error", release, { once: true });
      image.src = url;
      image.loading = "lazy";
      image.dataset.oituMediaLoaded = "true";
    });
  }

  function setMediaHtml(element, html, options = {}) {
    if (!element) return Promise.resolve();
    element.innerHTML = html || "";
    if (options.hydrate === false) return Promise.resolve();
    return hydrateMedia(element).catch((error) => {
      console.warn("OituCards: não foi possível exibir uma mídia do flashcard.", error);
    });
  }

  window.OituDB = {
    openDB,
    addDeck, addLibraryBatch, updateDeck, updateDeckSummary, getDeck, getDecks, deleteDeck, deleteLibraryItems,
    addFolder, updateFolder, getFolder, getFolders, deleteFolder,
    addCard, addCardsBatch, updateCard, getCard, getCardsByDeck, getCardSummariesByDeck, getCardSummariesForDecks, resetDeckProgressBatch, deleteCard, seedCardsByDeck,
    putMediaBatch, getMediaBatch
  };
  window.OituMedia = { hydrate: hydrateMedia, setHtml: setMediaHtml, getRecords: getMediaBatch };
})();
