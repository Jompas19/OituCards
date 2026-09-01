(function () {
  if (window.__oitucardsLibraryDueSync) return;
  window.__oitucardsLibraryDueSync = true;

  let syncPromise = null;
  let rerun = false;
  const $ = (selector, root = document) => root.querySelector(selector);

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

  async function syncBadges() {
    if (!window.OituInstantScale?.statFor || !window.OituDB || !$("#deckList")) return;
    if (syncPromise) {
      rerun = true;
      return syncPromise;
    }

    syncPromise = (async () => {
      const [decks, folders] = await Promise.all([OituDB.getDecks(), OituDB.getFolders()]);
      const deckDue = new Map();
      await Promise.all(decks.map(async (deck) => {
        const stat = await OituInstantScale.statFor(deck.id);
        deckDue.set(deck.id, Math.max(0, Number(stat?.due) || 0));
      }));

      const directFolderDue = new Map(folders.map((folder) => [folder.id, 0]));
      for (const deck of decks) {
        if (!deck.folderId) continue;
        directFolderDue.set(deck.folderId, (directFolderDue.get(deck.folderId) || 0) + (deckDue.get(deck.id) || 0));
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

      document.querySelectorAll("#deckList [data-deck-id]").forEach((row) => {
        updateDeckBadge(row, deckDue.get(row.dataset.deckId) || 0);
      });
      document.querySelectorAll("#deckList [data-folder-id]").forEach((row) => {
        updateFolderBadge(row, folderDue.get(row.dataset.folderId) || 0);
      });
    })().finally(() => {
      syncPromise = null;
      if (rerun) {
        rerun = false;
        setTimeout(() => syncBadges().catch(() => {}), 0);
      }
    });

    return syncPromise;
  }

  function invalidate(deckId) {
    if (deckId && window.OituInstantScale?.reconcileDeck) {
      OituInstantScale.reconcileDeck(deckId).then(() => syncBadges()).catch(() => {});
      return;
    }
    setTimeout(() => syncBadges().catch(() => {}), 0);
  }

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-toggle-folder],#homeButton,#backHomeButton,#studyHomeButton,#multiHome")) {
      setTimeout(() => syncBadges().catch(() => {}), 0);
    }
  }

  function init() {
    setTimeout(() => syncBadges().catch(() => {}), 0);
  }

  window.addEventListener("click", handleClick, true);
  window.OituLibraryDueSync = { sync: syncBadges, invalidate };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();