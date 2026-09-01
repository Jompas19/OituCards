(function () {
  if (window.__oitucardsLibraryEntitySnapshot || !window.OituDB?.openDB) return;
  window.__oitucardsLibraryEntitySnapshot = true;

  const TTL = 120;
  let snapshot = null;
  let snapshotAt = 0;
  let snapshotPromise = null;

  function invalidate() {
    snapshot = null;
    snapshotAt = 0;
    snapshotPromise = null;
  }

  async function readEntities() {
    if (snapshot && Date.now() - snapshotAt <= TTL) return snapshot;
    if (snapshotPromise) return snapshotPromise;
    snapshotPromise = (async () => {
      const db = await OituDB.openDB();
      const items = await new Promise((resolve, reject) => {
        const tx = db.transaction("decks", "readonly");
        const req = tx.objectStore("decks").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      snapshot = items;
      snapshotAt = Date.now();
      snapshotPromise = null;
      return items;
    })().catch((error) => {
      snapshotPromise = null;
      throw error;
    });
    return snapshotPromise;
  }

  const originalGetDecks = OituDB.getDecks?.bind(OituDB);
  const originalGetFolders = OituDB.getFolders?.bind(OituDB);

  if (originalGetDecks) {
    OituDB.getDecks = async function () {
      try {
        const items = await readEntities();
        return items
          .filter((item) => item.kind !== "folder")
          .map((item) => ({ ...item }))
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      } catch (_) {
        return originalGetDecks();
      }
    };
  }

  if (originalGetFolders) {
    OituDB.getFolders = async function () {
      try {
        const items = await readEntities();
        return items
          .filter((item) => item.kind === "folder")
          .map((item) => ({ ...item }))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      } catch (_) {
        return originalGetFolders();
      }
    };
  }

  for (const name of ["addDeck", "updateDeck", "deleteDeck", "addFolder", "updateFolder", "deleteFolder"]) {
    const previous = OituDB[name];
    if (typeof previous !== "function") continue;
    OituDB[name] = async function (...args) {
      const result = await previous.apply(this, args);
      invalidate();
      return result;
    };
  }

  window.OituLibraryEntitySnapshot = { invalidate };
})();