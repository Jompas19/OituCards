(function () {
  if (window.__oitucardsLibraryDueSync) return;
  window.__oitucardsLibraryDueSync = true;

  const state = {
    rawCards: null,
    rawPromise: null,
    dirty: true,
    syncPromise: null,
    dueTimer: null,
    dbPatched: false,
    libraryWrapped: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function isNewCard(card) {
    const count = Number.isInteger(card?.reviewCount)
      ? card.reviewCount
      : (card?.lastReviewedAt || card?.nextReviewAt || card?.lastRating ? 1 : 0);
    return count === 0 && !card?.lastReviewedAt && !card?.nextReviewAt && !card?.lastRating;
  }

  function dueTime(card) {
    if (isNewCard(card)) return null;
    if (!card?.nextReviewAt) return -Infinity;
    const time = new Date(card.nextReviewAt).getTime();
    return Number.isNaN(time) ? -Infinity : time;
  }

  function markDirty() {
    state.dirty = true;
    state.rawCards = null;
    state.rawPromise = null;
    clearTimeout(state.dueTimer);
    state.dueTimer = null;
  }

  async function readRawCards() {
    if (!state.dirty && state.rawCards) return state.rawCards;
    if (state.rawPromise) return state.rawPromise;

    state.rawPromise = (async () => {
      const db = await OituDB.openDB();
      const cards = await new Promise((resolve, reject) => {
        const tx = db.transaction("cards", "readonly");
        const request = tx.objectStore("cards").getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
        tx.onerror = () => reject(tx.error);
      });
      state.rawCards = cards;
      state.dirty = false;
      state.rawPromise = null;
      return cards;
    })().catch((error) => {
      state.rawPromise = null;
      throw error;
    });

    return state.rawPromise;
  }

  function buildCounts(cards, decks, folders) {
    const now = Date.now();
    const deckDue = new Map(decks.map((deck) => [deck.id, 0]));
    let nextFuture = null;

    for (const card of cards) {
      const time = dueTime(card);
      if (time === null) continue;
      if (time <= now) {
        deckDue.set(card.deckId, (deckDue.get(card.deckId) || 0) + 1);
      } else if (nextFuture === null || time < nextFuture) {
        nextFuture = time;
      }
    }

    const directFolderDue = new Map(folders.map((folder) => [folder.id, 0]));
    for (const deck of decks) {
      if (!deck.folderId) continue;
      directFolderDue.set(
        deck.folderId,
        (directFolderDue.get(deck.folderId) || 0) + (deckDue.get(deck.id) || 0)
      );
    }

    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const folderDue = new Map(folders.map((folder) => [folder.id, directFolderDue.get(folder.id) || 0]));

    for (const folder of folders) {
      const amount = directFolderDue.get(folder.id) || 0;
      if (!amount) continue;
      const seen = new Set([folder.id]);
      let parentId = folder.parentId || null;
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        folderDue.set(parentId, (folderDue.get(parentId) || 0) + amount);
        parentId = byId.get(parentId)?.parentId || null;
      }
    }

    return { deckDue, folderDue, nextFuture };
  }

  function updateDeckBadge(row, due) {
    const badge = $(".review-due-badge", row);
    if (!badge) return;
    badge.textContent = `↻ ${due} ${due === 1 ? "revisão" : "revisões"} hoje`;
    badge.classList.toggle("has-due", due > 0);
  }

  function updateFolderBadge(row, due) {
    const info = $(".folder-info", row);
    if (!info) return;
    let badge = $(".folder-review-due", info);

    if (due <= 0) {
      badge?.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.className = "folder-review-due";
      const emptyHint = $(".folder-empty-hint", info);
      if (emptyHint) info.insertBefore(badge, emptyHint);
      else info.appendChild(badge);
    }
    badge.textContent = `↻ ${due} ${due === 1 ? "revisão" : "revisões"} hoje`;
  }

  function scheduleNextDue(nextFuture) {
    clearTimeout(state.dueTimer);
    state.dueTimer = null;
    if (!Number.isFinite(nextFuture)) return;

    const delay = Math.max(100, nextFuture - Date.now() + 80);
    const safeDelay = Math.min(delay, 2147483000);
    state.dueTimer = setTimeout(() => {
      state.dueTimer = null;
      syncBadges().catch(() => {});
    }, safeDelay);
  }

  async function syncBadges() {
    if (!window.OituDB?.openDB || !$("#deckList")) return;
    if (state.syncPromise) return state.syncPromise;

    state.syncPromise = (async () => {
      const [cards, decks, folders] = await Promise.all([
        readRawCards(),
        OituDB.getDecks(),
        OituDB.getFolders()
      ]);
      const counts = buildCounts(cards, decks, folders);

      document.querySelectorAll("#deckList [data-deck-id]").forEach((row) => {
        updateDeckBadge(row, counts.deckDue.get(row.dataset.deckId) || 0);
      });
      document.querySelectorAll("#deckList [data-folder-id]").forEach((row) => {
        updateFolderBadge(row, counts.folderDue.get(row.dataset.folderId) || 0);
      });

      scheduleNextDue(counts.nextFuture);
    })().finally(() => {
      state.syncPromise = null;
    });

    return state.syncPromise;
  }

  function scheduleSync(...delays) {
    for (const delay of delays) setTimeout(() => syncBadges().catch(() => {}), delay);
  }

  function patchDatabaseInvalidation() {
    if (state.dbPatched || !window.OituDB) return false;
    state.dbPatched = true;

    for (const name of ["addCard", "updateCard", "deleteCard", "deleteDeck"]) {
      const previous = OituDB[name];
      if (typeof previous !== "function" || previous.__libraryDueSyncWrapped) continue;
      const wrapped = async function (...args) {
        const result = await previous.apply(this, args);
        markDirty();
        if ($("#homeView")?.classList.contains("active")) scheduleSync(0, 100);
        return result;
      };
      wrapped.__libraryDueSyncWrapped = true;
      OituDB[name] = wrapped;
    }
    return true;
  }

  function wrapLibrary() {
    if (state.libraryWrapped || !window.OituLibrary?.render) return false;
    state.libraryWrapped = true;

    const previousRender = OituLibrary.render;
    if (!previousRender.__libraryDueSyncWrapped) {
      const wrappedRender = async function (...args) {
        const result = await previousRender.apply(this, args);
        await syncBadges().catch(() => {});
        return result;
      };
      wrappedRender.__libraryDueSyncWrapped = true;
      OituLibrary.render = wrappedRender;
    }

    return true;
  }

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("[data-toggle-folder]")) scheduleSync(0, 70, 180);
    if (target.closest("#homeButton,#backHomeButton,#studyHomeButton,#multiHome")) scheduleSync(80, 220, 520);
  }

  function init() {
    patchDatabaseInvalidation();
    wrapLibrary();
    scheduleSync(50, 180, 500);
    setTimeout(() => {
      patchDatabaseInvalidation();
      wrapLibrary();
    }, 250);
  }

  window.addEventListener("click", handleClick, true);
  window.OituLibraryDueSync = { sync: syncBadges, invalidate: markDirty };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
