(function () {
  const state = {
    folderMeta: new Map(),
    folderProgress: new Map(),
    stableTreeHtml: "",
    refreshPromise: null,
    refreshQueued: false,
    restoringSnapshot: false,
    observer: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function isStudied(card) {
    return Boolean(card?.reviewStatus);
  }

  function folderEmoji(folder) {
    const emoji = String(folder?.emoji || "").trim();
    return emoji || "📁";
  }

  async function refreshCache() {
    if (state.refreshPromise) return state.refreshPromise;

    state.refreshPromise = (async () => {
      const [folders, decks] = await Promise.all([OituDB.getFolders(), OituDB.getDecks()]);
      const folderMeta = new Map(folders.map((folder) => [folder.id, folder]));
      const folderTotals = new Map(folders.map((folder) => [folder.id, { total: 0, studied: 0 }]));

      const deckStats = await Promise.all(decks.map(async (deck) => {
        const cards = await OituDB.getCardsByDeck(deck.id);
        let studied = 0;
        for (const card of cards) if (isStudied(card)) studied += 1;
        return { deck, total: cards.length, studied };
      }));

      for (const { deck, total, studied } of deckStats) {
        let folderId = deck.folderId || null;
        const seen = new Set();
        while (folderId && folderMeta.has(folderId) && !seen.has(folderId)) {
          seen.add(folderId);
          const aggregate = folderTotals.get(folderId);
          aggregate.total += total;
          aggregate.studied += studied;
          folderId = folderMeta.get(folderId)?.parentId || null;
        }
      }

      const folderProgress = new Map();
      folderTotals.forEach((aggregate, folderId) => {
        const progress = aggregate.total ? Math.round((aggregate.studied / aggregate.total) * 100) : 0;
        folderProgress.set(folderId, progress);
      });

      state.folderMeta = folderMeta;
      state.folderProgress = folderProgress;
      return { folderMeta, folderProgress };
    })().catch((error) => {
      console.warn("OituCards: não foi possível preparar a renderização estável da biblioteca.", error);
    }).finally(() => {
      state.refreshPromise = null;
    });

    return state.refreshPromise;
  }

  function ensureFolderEditButton(row, folderId) {
    const actions = $(".folder-row-actions, .deck-actions", row);
    if (!actions || $("[data-edit-folder]", actions)) return;

    const button = document.createElement("button");
    button.className = "action-button icon-only";
    button.type = "button";
    button.dataset.editFolder = folderId;
    button.title = "Editar pasta";
    button.setAttribute("aria-label", "Editar pasta");
    button.textContent = "✎";
    actions.prepend(button);
  }

  function ensureFolderProgress(row, folderId) {
    if (!state.folderProgress.has(folderId)) return;
    const main = $(".folder-main", row);
    if (!main) return;

    const progress = state.folderProgress.get(folderId);
    let line = $(".folder-aggregate-progress", main);
    if (!line) {
      line = document.createElement("div");
      line.className = "folder-aggregate-progress";
      main.appendChild(line);
    }

    if (line.dataset.progress === String(progress)) return;
    line.dataset.progress = String(progress);
    line.innerHTML = `<span>Progresso: ${progress}%</span><div class="progress-track" aria-label="Progresso agregado de ${progress}%"><div class="progress-bar" style="width:${progress}%"></div></div>`;
  }

  function decorateTreeSync(list = $("#deckList")) {
    if (!list || !state.folderMeta.size) return;

    $$('[data-folder-id]', list).forEach((row) => {
      const folderId = row.dataset.folderId;
      const folder = state.folderMeta.get(folderId);
      if (!folder) return;

      $$(".folder-icon", row).forEach((icon) => {
        const emoji = folderEmoji(folder);
        if (icon.textContent !== emoji) icon.textContent = emoji;
      });

      ensureFolderEditButton(row, folderId);
      ensureFolderProgress(row, folderId);
    });
  }

  function isLibraryTree(list) {
    return Boolean(list?.querySelector(".library-tree-row,[data-folder-id],.library-empty"));
  }

  function looksLikeFlatLegacyList(list) {
    if (!list || !list.children.length) return false;
    if (isLibraryTree(list)) return false;
    return Boolean(list.querySelector(".deck-row[data-deck-id]"));
  }

  function captureStableTree(list = $("#deckList")) {
    if (!list || !isLibraryTree(list)) return;
    state.stableTreeHtml = list.innerHTML;
  }

  function queueAuthoritativeRender(refreshFirst = false) {
    if (state.refreshQueued) return;
    state.refreshQueued = true;

    Promise.resolve(refreshFirst ? refreshCache() : null)
      .then(() => {
        if (typeof window.OituLibrary?.render !== "function") return;
        return window.OituLibrary.render();
      })
      .catch((error) => console.error(error))
      .finally(() => {
        state.refreshQueued = false;
      });
  }

  function handleListMutation() {
    const list = $("#deckList");
    if (!list || state.restoringSnapshot) return;

    if (looksLikeFlatLegacyList(list) && state.stableTreeHtml) {
      state.restoringSnapshot = true;
      list.innerHTML = state.stableTreeHtml;
      state.restoringSnapshot = false;
      decorateTreeSync(list);
      queueAuthoritativeRender(true);
      return;
    }

    decorateTreeSync(list);
    captureStableTree(list);
  }

  function installListObserver() {
    const list = $("#deckList");
    if (!list || state.observer) return;

    state.observer = new MutationObserver(handleListMutation);
    state.observer.observe(list, { childList: true, subtree: false });
  }

  function refreshAfterReturnToLibrary(event) {
    const target = event.target.closest(
      "#studyHomeButton,#multiHome,#studyConfigBackButton,#cancelStudyConfigButton,#multiBackHome,#multiCancel,#backHomeButton,#homeButton"
    );
    if (!target) return;
    if ($("#homeView")?.classList.contains("active") && target.id === "homeButton") return;

    refreshCache().then(() => {
      decorateTreeSync();
      queueAuthoritativeRender(false);
    });
  }

  function init() {
    const list = $("#deckList");
    if (!list) return;

    installListObserver();
    document.addEventListener("click", refreshAfterReturnToLibrary, true);

    refreshCache().then(() => {
      decorateTreeSync(list);
      captureStableTree(list);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
