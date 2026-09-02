(function () {
  if (window.__oitucardsLibraryDueSync) return;
  window.__oitucardsLibraryDueSync = true;

  const state = {
    syncPromise: null,
    rerunRequested: false,
    dueTimer: null,
    dbPatched: false,
    libraryWrapped: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function markDirty() {
    clearTimeout(state.dueTimer);
    state.dueTimer = null;
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
    if (state.syncPromise) {
      state.rerunRequested = true;
      return state.syncPromise;
    }

    state.syncPromise = (async () => {
      const [decks, folders] = await Promise.all([OituDB.getDecks(), OituDB.getFolders()]);
      const now = new Date();
      const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const deckDue = new Map(decks.map((deck) => [
        deck.id,
        deck.summaryDate === dateKey && Number.isInteger(Number(deck.dueCount)) ? Math.max(0, Number(deck.dueCount)) : 0
      ]));
      const counts = { deckDue, folderDue: new Map(), nextFuture: null };
      const directFolderDue = new Map(folders.map((folder) => [folder.id, 0]));
      decks.forEach((deck) => {
        if (deck.folderId) directFolderDue.set(deck.folderId, (directFolderDue.get(deck.folderId) || 0) + (deckDue.get(deck.id) || 0));
      });
      const byId = new Map(folders.map((folder) => [folder.id, folder]));
      counts.folderDue = new Map(folders.map((folder) => [folder.id, directFolderDue.get(folder.id) || 0]));
      folders.forEach((folder) => {
        const amount = directFolderDue.get(folder.id) || 0;
        const seen = new Set([folder.id]);
        let parentId = folder.parentId || null;
        while (amount && parentId && !seen.has(parentId)) {
          seen.add(parentId);
          counts.folderDue.set(parentId, (counts.folderDue.get(parentId) || 0) + amount);
          parentId = byId.get(parentId)?.parentId || null;
        }
      });

      document.querySelectorAll("#deckList [data-deck-id]").forEach((row) => {
        updateDeckBadge(row, counts.deckDue.get(row.dataset.deckId) || 0);
      });
      document.querySelectorAll("#deckList [data-folder-id]").forEach((row) => {
        updateFolderBadge(row, counts.folderDue.get(row.dataset.folderId) || 0);
      });

      scheduleNextDue(counts.nextFuture);
    })().finally(() => {
      state.syncPromise = null;
      if (state.rerunRequested) {
        state.rerunRequested = false;
        setTimeout(() => syncBadges().catch(() => {}), 0);
      }
    });

    return state.syncPromise;
  }

  function scheduleSync(...delays) {
    for (const delay of delays) setTimeout(() => syncBadges().catch(() => {}), delay);
  }

  function scheduleIdleSync(timeout = 1800) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => syncBadges().catch(() => {}), { timeout });
      return;
    }
    setTimeout(() => syncBadges().catch(() => {}), Math.min(timeout, 1200));
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
        scheduleIdleSync();
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

    if (target.closest("#homeButton,#backHomeButton,#studyHomeButton,#multiHome")) scheduleIdleSync(2500);
  }

  function init() {
    patchDatabaseInvalidation();
    wrapLibrary();
    scheduleIdleSync(2200);
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
