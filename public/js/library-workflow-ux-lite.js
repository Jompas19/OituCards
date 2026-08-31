(function () {
  if (window.__oitucardsLibraryWorkflowUxLite) return;
  window.__oitucardsLibraryWorkflowUxLite = true;

  const state = {
    pendingFolderId: null,
    openingFromFolder: false,
    creationToken: null,
    deckListObserver: null,
    importObserver: null,
    importRefreshQueued: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function ensureStyles() {
    if ($("#libraryWorkflowUxLiteStyle")) return;
    const style = document.createElement("style");
    style.id = "libraryWorkflowUxLiteStyle";
    style.textContent = `
      #deckList .folder-row{
        border-left:4px solid color-mix(in srgb,var(--primary) 55%,var(--line));
        background:color-mix(in srgb,var(--surface) 86%,var(--primary-soft));
        box-shadow:none;
      }
      #deckList .folder-row.is-expanded{
        border-left-color:var(--primary);
        background:color-mix(in srgb,var(--surface) 78%,var(--primary-soft));
      }
      #deckList .folder-row .folder-icon{
        display:inline-grid;
        place-items:center;
        width:30px;
        height:30px;
        border-radius:9px;
        background:color-mix(in srgb,var(--primary-soft) 76%,var(--surface));
        border:1px solid color-mix(in srgb,var(--primary) 15%,var(--line));
        font-size:1rem;
      }
      #deckList .folder-row .folder-name-text{font-weight:850}
      #deckList .library-deck-row{
        background:var(--surface);
        box-shadow:0 4px 13px rgba(17,24,39,.045);
      }
      .folder-row-actions [data-create-deck-folder]{font-size:1.14rem;font-weight:850}
      .folder-row-actions [data-add-existing-folder]{font-size:1.02rem}
    `;
    document.head.appendChild(style);
  }

  function decorateFolderActions() {
    const list = $("#deckList");
    if (!list) return;

    $$("[data-folder-id]", list).forEach((row) => {
      const folderId = row.dataset.folderId;
      const actions = $(".folder-row-actions,.deck-actions", row);
      if (!folderId || !actions) return;

      const addExisting = $("[data-add-existing-folder]", actions);
      if (addExisting) {
        if (addExisting.textContent !== "↪") addExisting.textContent = "↪";
        addExisting.title = "Adicionar itens existentes à pasta";
        addExisting.setAttribute("aria-label", "Adicionar itens existentes à pasta");
      }

      if (!$("[data-create-deck-folder]", actions)) {
        const button = document.createElement("button");
        button.className = "action-button icon-only";
        button.type = "button";
        button.dataset.createDeckFolder = folderId;
        button.title = "Criar baralho nesta pasta";
        button.setAttribute("aria-label", "Criar baralho nesta pasta");
        button.textContent = "＋";
        if (addExisting) actions.insertBefore(button, addExisting);
        else actions.prepend(button);
      }
    });
  }

  function installDeckListObserver() {
    const list = $("#deckList");
    if (!list || state.deckListObserver) return;

    // Observa apenas a troca dos itens de primeiro nível da biblioteca.
    // As decorações são feitas dentro dos itens e, por isso, não disparam este observer novamente.
    state.deckListObserver = new MutationObserver(() => decorateFolderActions());
    state.deckListObserver.observe(list, { childList: true, subtree: false });
    decorateFolderActions();
  }

  async function refreshLibraryAfterImport() {
    if (state.importRefreshQueued) return;
    state.importRefreshQueued = true;
    try {
      // O status de sucesso só é exibido depois que todos os cards já foram persistidos.
      await window.OituLibrary?.render?.();
    } catch (error) {
      console.error("OituCards: não foi possível atualizar a biblioteca após a importação.", error);
    } finally {
      setTimeout(() => { state.importRefreshQueued = false; }, 250);
    }
  }

  function inspectImportStatus() {
    const status = $("#importStatus");
    if (!status) return;
    const text = String(status.textContent || "").toLocaleLowerCase("pt-BR");
    if (/\bcard(s)? importado(s)?\b/.test(text)) refreshLibraryAfterImport();
  }

  function installImportObserver() {
    const status = $("#importStatus");
    if (!status || state.importObserver) return;
    state.importObserver = new MutationObserver(inspectImportStatus);
    state.importObserver.observe(status, { childList: true, characterData: true, subtree: true });
    inspectImportStatus();
  }

  function clearPendingCreation() {
    state.pendingFolderId = null;
    state.creationToken = null;
  }

  async function findCreatedDeck(token) {
    const decks = await OituDB.getDecks();
    const candidates = decks.filter((deck) => {
      if (String(deck.name || "") !== token.name) return false;
      const created = Date.parse(deck.createdAt || "");
      return !Number.isFinite(created) || created >= token.startedAt - 1500;
    });
    candidates.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    return candidates[0] || null;
  }

  async function ensureCreatedDeckVisible(deck, folderId) {
    if (folderId && (deck.folderId || null) !== folderId) {
      await OituDB.updateDeck(deck.id, { folderId });
    }

    // Aguarda o render normal executado pelo app e faz uma única renderização autoritativa.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await window.OituLibrary?.render?.();

    if (folderId) {
      let folderRow = document.querySelector(`[data-folder-id="${CSS.escape(folderId)}"]`);
      const toggle = folderRow?.querySelector(`[data-toggle-folder="${CSS.escape(folderId)}"]`);
      if (toggle && toggle.getAttribute("aria-expanded") !== "true") {
        window.OituLibrary?.toggleFolder?.(folderId);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
  }

  async function openCreatedDeckAndFirstCard(deckId, attempt = 0) {
    const row = document.querySelector(`[data-deck-id="${CSS.escape(deckId)}"]`);
    const edit = row?.querySelector('[data-action="edit-deck"]:not(.deck-name-button)');
    if (!edit) {
      if (attempt < 14) setTimeout(() => openCreatedDeckAndFirstCard(deckId, attempt + 1), 60);
      return;
    }

    edit.click();

    let cardAttempt = 0;
    const openCard = () => {
      const deckView = $("#deckView");
      const addCard = $("#deckEmptyAddCardButton") || $("#addCardButton");
      if (deckView?.classList.contains("active") && addCard) {
        addCard.click();
        return;
      }
      cardAttempt += 1;
      if (cardAttempt < 14) setTimeout(openCard, 55);
    };
    setTimeout(openCard, 35);
  }

  async function resolveCreation(token, attempt = 0) {
    if (!state.creationToken || state.creationToken.id !== token.id) return;

    try {
      const deck = await findCreatedDeck(token);
      if (!deck) {
        if (attempt < 25) setTimeout(() => resolveCreation(token, attempt + 1), 70);
        return;
      }

      state.creationToken = null;
      const folderId = token.folderId || null;
      state.pendingFolderId = null;
      await ensureCreatedDeckVisible(deck, folderId);
      await openCreatedDeckAndFirstCard(deck.id);
    } catch (error) {
      console.error("OituCards: não foi possível abrir o novo baralho automaticamente.", error);
      clearPendingCreation();
    }
  }

  function startCreationFromForm() {
    const title = String($("#deckModalTitle")?.textContent || "").toLocaleLowerCase("pt-BR");
    if (!title.includes("novo baralho")) return;
    const name = String($("#deckNameInput")?.value || "").trim();
    if (!name) return;

    const token = {
      id: crypto.randomUUID(),
      name,
      folderId: state.pendingFolderId || null,
      startedAt: Date.now()
    };
    state.creationToken = token;
    setTimeout(() => resolveCreation(token), 45);
  }

  function handleEarlyClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const createInside = target.closest("[data-create-deck-folder]");
    if (createInside) {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.pendingFolderId = createInside.dataset.createDeckFolder || null;
      state.openingFromFolder = true;
      $("#addDeckButton")?.click();
      state.openingFromFolder = false;
      return;
    }

    if (target.closest("#addDeckButton,#emptyAddDeckButton") && !state.openingFromFolder) {
      state.pendingFolderId = null;
      state.creationToken = null;
      return;
    }

    if (target.closest('[data-close-modal="deckModal"]')) clearPendingCreation();
    if (target.closest("#importDeckButton")) setTimeout(installImportObserver, 30);
  }

  function handleEarlyMouseDown(event) {
    if (event.target?.id === "deckModal") clearPendingCreation();
  }

  function init() {
    ensureStyles();
    installDeckListObserver();
    installImportObserver();
    setTimeout(() => {
      installDeckListObserver();
      installImportObserver();
      decorateFolderActions();
    }, 120);
  }

  window.addEventListener("click", handleEarlyClick, true);
  window.addEventListener("mousedown", handleEarlyMouseDown, true);
  window.addEventListener("submit", (event) => {
    if (event.target?.id === "deckForm") startCreationFromForm();
  }, true);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
