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

  // Única compatibilidade do rollback: durante os testes o navegador pôde
  // elevar OituCardsDB para v2. O código restaurado pede v1 explicitamente.
  // Interceptamos somente esse caso e abrimos a versão existente, sem mudar
  // esquema, dados ou qualquer comportamento da aplicação.
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

  async function deleteDeck(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["decks", "cards"], "readwrite");
      const decks = tx.objectStore("decks");
      const cards = tx.objectStore("cards");
      decks.delete(id);
      const cursorReq = cards.index("deckId").openCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível excluir o baralho."));
    });
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
    await run("decks", "readwrite", (store) => store.delete(id));
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
        if (req.result && req.result.kind !== "folder") decks.put({ ...req.result, kind: "deck", updatedAt: now });
      };
      tx.oncomplete = () => resolve(card);
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
          if (deckReq.result && deckReq.result.kind !== "folder") decks.put({ ...deckReq.result, kind: "deck", updatedAt: now });
        };
        resolve(updated);
      };
      req.onerror = () => reject(req.error);
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
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readonly");
      const req = tx.objectStore("cards").index("deckId").getAll(IDBKeyRange.only(deckId));
      req.onsuccess = () => {
        const cards = req.result || [];
        cards.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        resolve(cards);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteCard(id) {
    const card = await getCard(id);
    if (!card) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["cards", "decks"], "readwrite");
      tx.objectStore("cards").delete(id);
      const decks = tx.objectStore("decks");
      const req = decks.get(card.deckId);
      req.onsuccess = () => {
        if (req.result && req.result.kind !== "folder") decks.put({ ...req.result, kind: "deck", updatedAt: new Date().toISOString() });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  window.OituDB = {
    openDB,
    addDeck, updateDeck, getDeck, getDecks, deleteDeck,
    addFolder, updateFolder, getFolder, getFolders, deleteFolder,
    addCard, updateCard, getCard, getCardsByDeck, deleteCard
  };
})();
