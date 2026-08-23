(function () {
  const state = {
    folderMeta: new Map(),
    progressCache: new Map(),
    stableTreeHtml: "",
    metaPromise: null,
    renderQueued: false,
    restoringSnapshot: false,
    observer: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function ensureStyles() {
    if ($("#libraryStabilityStyle")) return;
    const style = document.createElement("style");
    style.id = "libraryStabilityStyle";
    style.textContent = `.folder-aggregate-progress[data-progress="pending"]{visibility:hidden}`;
    document.head.appendChild(style);
  }

  function folderEmoji(folder) {
    const emoji = String(folder?.emoji || "").trim();
    return emoji || "📁";
  }

  async function refreshFolderMeta() {
    if (state.metaPromise) return state.metaPromise;
    state.metaPromise = OituDB.getFolders()
      .then((folders) => {
        state.folderMeta = new Map(folders.map((folder) => [folder.id, folder]));
        return state.folderMeta;
      })
      .catch((error) => {
        console.warn("OituCards: não foi possível atualizar os dados visuais das pastas.", error);
      })
      .finally(() => {
        state.metaPromise = null;
      });
    return state.metaPromise;
  }

  function cacheProgressRow(row) {
    if (!(row instanceof Element)) return;
    const folderId = row.dataset.folderId;
    if (!folderId) return;
    const line = $(".folder-aggregate-progress", row);
    if (!line || !line.dataset.progress || line.dataset.progress === "pending") return;
    state.progressCache.set(folderId, {
      progress: line.dataset.progress,
      html: line.innerHTML
    });
  }

  function captureProgressFromNode(node) {
    if (!(node instanceof Element)) return;
    if (node.matches("[data-folder-id]")) cacheProgressRow(node);
    $$('[data-folder-id]', node).forEach(cacheProgressRow);
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
    const main = $(".folder-main", row);
    if (!main) return;
    let line = $(".folder-aggregate-progress", main);
    const cached = state.progressCache.get(folderId);

    if (!line) {
      line = document.createElement("div");
      line.className = "folder-aggregate-progress";
      main.appendChild(line);
    }

    if (cached) {
      if (line.dataset.progress !== cached.progress) {
        line.dataset.progress = cached.progress;
        line.innerHTML = cached.html;
      }
      return;
    }

    if (!line.dataset.progress) {
      line.dataset.progress = "pending";
      line.innerHTML = `<span>Progresso</span><div class="progress-track"><div class="progress-bar" style="width:0"></div></div>`;
    }
  }

  function decorateTreeSync(list = $("#deckList")) {
    if (!list) return;
    let missingMeta = false;

    $$('[data-folder-id]', list).forEach((row) => {
      const folderId = row.dataset.folderId;
      const folder = state.folderMeta.get(folderId);
      if (folder) {
        $$(".folder-icon", row).forEach((icon) => {
          const emoji = folderEmoji(folder);
          if (icon.textContent !== emoji) icon.textContent = emoji;
        });
      } else {
        missingMeta = true;
      }

      ensureFolderEditButton(row, folderId);
      ensureFolderProgress(row, folderId);
    });

    if (missingMeta) refreshFolderMeta().then(() => decorateTreeSync(list));
  }

  function isLibraryTree(list) {
    return Boolean(list?.querySelector(".library-tree-row,[data-folder-id],.library-empty"));
  }

  function looksLikeFlatLegacyList(list) {
    if (!list || !list.children.length || isLibraryTree(list)) return false;
    return Boolean(list.querySelector(".deck-row[data-deck-id]"));
  }

  function captureStableTree(list = $("#deckList")) {
    if (!list || !isLibraryTree(list)) return;
    state.stableTreeHtml = list.innerHTML;
  }

  function queueAuthoritativeRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    Promise.resolve()
      .then(() => window.OituLibrary?.render?.())
      .catch((error) => console.error(error))
      .finally(() => {
        state.renderQueued = false;
      });
  }

  function handleListMutations(mutations) {
    const list = $("#deckList");
    if (!list || state.restoringSnapshot) return;

    mutations.forEach((mutation) => {
      mutation.removedNodes.forEach(captureProgressFromNode);
    });

    if (looksLikeFlatLegacyList(list) && state.stableTreeHtml) {
      state.restoringSnapshot = true;
      list.innerHTML = state.stableTreeHtml;
      state.restoringSnapshot = false;
      decorateTreeSync(list);
      queueAuthoritativeRender();
      return;
    }

    decorateTreeSync(list);
    captureStableTree(list);
  }

  function installListObserver() {
    const list = $("#deckList");
    if (!list || state.observer) return;
    state.observer = new MutationObserver(handleListMutations);
    state.observer.observe(list, { childList: true, subtree: false });
  }

  function refreshMetaAfterFolderChange(event) {
    if (!event.target.matches("#folderForm,#folderEditForm")) return;
    setTimeout(() => refreshFolderMeta().then(() => decorateTreeSync()), 80);
  }

  function init() {
    const list = $("#deckList");
    if (!list) return;
    ensureStyles();
    installListObserver();
    document.addEventListener("submit", refreshMetaAfterFolderChange);
    refreshFolderMeta().then(() => {
      decorateTreeSync(list);
      captureStableTree(list);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
