(function () {
  const DB_NAME = "OituCardsDB";
  const DB_VERSION = 1;

  let dbPromise = null;

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

      try {
        result = executor(store);
      } catch (error) {
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transação cancelada."));
    });
  }

  async function addDeck(name) {
    const now = new Date().toISOString();
    const deck = {
      id: crypto.randomUUID(),
      name: name.trim(),
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
        if (!current) {
          reject(new Error("Baralho não encontrado."));
          tx.abort();
          return;
        }
        const updated = {
          ...current,
          ...patch,
          id,
          updatedAt: new Date().toISOString()
        };
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
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getDecks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readonly");
      const req = tx.objectStore("decks").getAll();
      req.onsuccess = () => {
        const list = req.result || [];
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
      const index = cards.index("deckId");

      decks.delete(id);

      const cursorReq = index.openCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível excluir o baralho."));
    });
  }

  async function addCard(deckId, frontHtml, backHtml) {
    const now = new Date().toISOString();
    const card = {
      id: crypto.randomUUID(),
      deckId,
      frontHtml,
      backHtml,
      reviewStatus: null,
      createdAt: now,
      updatedAt: now
    };

    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(["cards", "decks"], "readwrite");
      tx.objectStore("cards").add(card);

      const decks = tx.objectStore("decks");
      const getDeckReq = decks.get(deckId);
      getDeckReq.onsuccess = () => {
        if (getDeckReq.result) {
          decks.put({
            ...getDeckReq.result,
            updatedAt: now
          });
        }
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
        if (!current) {
          reject(new Error("Flashcard não encontrado."));
          tx.abort();
          return;
        }

        const now = new Date().toISOString();
        const updated = { ...current, ...patch, id, updatedAt: now };
        cards.put(updated);

        const decks = tx.objectStore("decks");
        const deckReq = decks.get(current.deckId);
        deckReq.onsuccess = () => {
          if (deckReq.result) {
            decks.put({ ...deckReq.result, updatedAt: now });
          }
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
      const index = tx.objectStore("cards").index("deckId");
      const req = index.getAll(IDBKeyRange.only(deckId));

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
        if (req.result) {
          decks.put({
            ...req.result,
            updatedAt: new Date().toISOString()
          });
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  window.OituDB = {
    openDB,
    addDeck,
    updateDeck,
    getDeck,
    getDecks,
    deleteDeck,
    addCard,
    updateCard,
    getCard,
    getCardsByDeck,
    deleteCard
  };
})();
