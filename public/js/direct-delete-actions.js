(function () {
  if (window.__oitucardsDirectDeleteActions) return;
  window.__oitucardsDirectDeleteActions = true;

  const state = {
    editingDeckId: null,
    editingFolderId: null,
    pendingDelete: null,
    listObserver: null,
    openMenuFolderId: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function ensureStyles() {
    if ($("#directDeleteActionsStyle")) return;
    const style = document.createElement("style");
    style.id = "directDeleteActionsStyle";
    style.textContent = `
      #deleteCurrentDeckButton{white-space:nowrap}
      #folderEditDeleteButton{margin-right:auto}
      #directDeleteConfirmModal .direct-delete-summary{
        margin:0;
        color:var(--muted);
        line-height:1.55;
      }
      #directDeleteConfirmModal .direct-delete-warning{
        margin:14px 0 0;
        padding:12px 14px;
        border-radius:12px;
        background:color-mix(in srgb,var(--danger) 8%,var(--surface));
        border:1px solid color-mix(in srgb,var(--danger) 22%,var(--line));
        color:var(--text);
      }
      #deckList .folder-row .folder-row-actions,
      #deckList .folder-row .deck-actions{
        position:relative;
        overflow:visible;
      }
      #deckList .folder-row .folder-row-actions > [data-add-existing-folder],
      #deckList .folder-row .folder-row-actions > [data-create-subfolder],
      #deckList .folder-row .folder-row-actions > [data-edit-folder],
      #deckList .folder-row .folder-row-actions > [data-delete-folder-direct],
      #deckList .folder-row .deck-actions > [data-add-existing-folder],
      #deckList .folder-row .deck-actions > [data-create-subfolder],
      #deckList .folder-row .deck-actions > [data-edit-folder],
      #deckList .folder-row .deck-actions > [data-delete-folder-direct]{
        display:none!important;
      }
      .folder-more-wrap{
        position:relative;
        display:inline-flex;
      }
      .folder-more-button{
        font-size:1.2rem;
        font-weight:850;
        letter-spacing:.04em;
      }
      .folder-more-menu{
        position:absolute;
        top:calc(100% + 8px);
        right:0;
        z-index:90;
        width:max-content;
        min-width:225px;
        padding:7px;
        border:1px solid var(--line);
        border-radius:14px;
        background:var(--surface);
        box-shadow:var(--shadow);
      }
      .folder-more-menu.hidden{display:none!important}
      .folder-more-menu-item{
        width:100%;
        min-height:40px;
        display:flex;
        align-items:center;
        gap:10px;
        padding:8px 10px;
        border:0;
        border-radius:9px;
        background:transparent;
        color:var(--text);
        text-align:left;
        cursor:pointer;
        font-weight:700;
      }
      .folder-more-menu-item:hover,
      .folder-more-menu-item:focus-visible{
        background:var(--surface-2);
        outline:none;
      }
      .folder-more-menu-item .folder-menu-icon{
        width:22px;
        flex:0 0 22px;
        text-align:center;
        color:var(--muted);
      }
      .folder-more-menu-item.is-danger{
        margin-top:5px;
        padding-top:10px;
        border-top:1px solid var(--line);
        border-radius:0 0 9px 9px;
        color:var(--danger);
      }
      .folder-more-menu-item.is-danger .folder-menu-icon{color:var(--danger)}
      @media (max-width:700px){
        .folder-more-menu{min-width:210px}
      }
    `;
    document.head.appendChild(style);
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2600);
  }

  function openModal(id) {
    const modal = $(`#${id}`);
    if (!modal) return;
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const modal = $(`#${id}`);
    if (!modal) return;
    modal.classList.add("hidden");
    if (!$(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
  }

  function ensureConfirmModal() {
    if ($("#directDeleteConfirmModal")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <div id="directDeleteConfirmModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="directDeleteConfirmTitle">
        <div class="modal tiny-modal">
          <div class="modal-header">
            <div><p class="eyebrow">Exclusão</p><h2 id="directDeleteConfirmTitle">Confirmar exclusão</h2></div>
            <button id="directDeleteConfirmClose" class="icon-button modal-close" type="button" aria-label="Fechar">×</button>
          </div>
          <p id="directDeleteConfirmMessage" class="direct-delete-summary"></p>
          <p id="directDeleteConfirmWarning" class="direct-delete-warning">Esta ação não poderá ser desfeita.</p>
          <div class="modal-actions">
            <button id="directDeleteConfirmCancel" class="button ghost" type="button">Cancelar</button>
            <button id="directDeleteConfirmAccept" class="button danger" type="button">Excluir</button>
          </div>
        </div>
      </div>`);
  }

  function ensureDeckDeleteButton() {
    const actions = $("#deckView .heading-actions");
    if (!actions || $("#deleteCurrentDeckButton", actions)) return;
    const button = document.createElement("button");
    button.id = "deleteCurrentDeckButton";
    button.className = "button danger";
    button.type = "button";
    button.textContent = "🗑 Apagar baralho";
    button.title = "Apagar este baralho";
    actions.appendChild(button);
  }

  function ensureFolderEditDeleteButton() {
    const actions = $("#folderEditModal #folderEditForm .modal-actions");
    if (!actions || $("#folderEditDeleteButton", actions)) return;
    const button = document.createElement("button");
    button.id = "folderEditDeleteButton";
    button.className = "button danger";
    button.type = "button";
    button.textContent = "🗑 Apagar pasta";
    button.title = "Apagar esta pasta ou subpasta";
    actions.prepend(button);
  }

  function folderMoreMarkup(folderId) {
    return `
      <span class="folder-more-wrap">
        <button class="action-button icon-only folder-more-button" type="button" data-folder-more="${folderId}" title="Mais opções" aria-label="Mais opções da pasta" aria-expanded="false">⋯</button>
        <span class="folder-more-menu hidden" data-folder-more-menu="${folderId}" role="menu" aria-label="Mais opções da pasta">
          <button class="folder-more-menu-item" type="button" data-folder-menu-action="edit" data-folder-menu-id="${folderId}" role="menuitem"><span class="folder-menu-icon">✎</span><span>Editar pasta</span></button>
          <button class="folder-more-menu-item" type="button" data-folder-menu-action="existing" data-folder-menu-id="${folderId}" role="menuitem"><span class="folder-menu-icon">↪</span><span>Adicionar itens existentes</span></button>
          <button class="folder-more-menu-item" type="button" data-folder-menu-action="subfolder" data-folder-menu-id="${folderId}" role="menuitem"><span class="folder-menu-icon">＋</span><span>Criar subpasta</span></button>
          <button class="folder-more-menu-item is-danger" type="button" data-folder-menu-action="delete" data-folder-menu-id="${folderId}" role="menuitem"><span class="folder-menu-icon">🗑</span><span>Excluir pasta</span></button>
        </span>
      </span>`;
  }

  function closeFolderMenus(exceptId = null) {
    $$("[data-folder-more-menu]").forEach((menu) => {
      const id = menu.dataset.folderMoreMenu || null;
      if (exceptId && id === exceptId) return;
      menu.classList.add("hidden");
      const button = $(`[data-folder-more="${CSS.escape(id || "")}"]`);
      button?.setAttribute("aria-expanded", "false");
    });
    if (!exceptId) state.openMenuFolderId = null;
  }

  function toggleFolderMenu(folderId) {
    const menu = $(`[data-folder-more-menu="${CSS.escape(folderId)}"]`);
    const button = $(`[data-folder-more="${CSS.escape(folderId)}"]`);
    if (!menu || !button) return;
    const willOpen = menu.classList.contains("hidden");
    closeFolderMenus(willOpen ? folderId : null);
    menu.classList.toggle("hidden", !willOpen);
    button.setAttribute("aria-expanded", willOpen ? "true" : "false");
    state.openMenuFolderId = willOpen ? folderId : null;
  }

  function decorateFolderActions() {
    const list = $("#deckList");
    if (!list) return;
    $$("[data-folder-id]", list).forEach((row) => {
      const folderId = row.dataset.folderId;
      const actions = $(".folder-row-actions,.deck-actions", row);
      if (!folderId || !actions) return;

      if (!$("[data-delete-folder-direct]", actions)) {
        const deleteButton = document.createElement("button");
        deleteButton.className = "action-button icon-only delete";
        deleteButton.type = "button";
        deleteButton.dataset.deleteFolderDirect = folderId;
        deleteButton.title = "Apagar pasta";
        deleteButton.setAttribute("aria-label", "Apagar pasta");
        deleteButton.textContent = "🗑";
        actions.appendChild(deleteButton);
      }

      if (!$("[data-folder-more]", actions)) {
        actions.insertAdjacentHTML("beforeend", folderMoreMarkup(folderId));
      }
    });
  }

  function installListObserver() {
    const list = $("#deckList");
    if (!list || state.listObserver) return;
    state.listObserver = new MutationObserver(() => {
      closeFolderMenus();
      decorateFolderActions();
    });
    state.listObserver.observe(list, { childList: true, subtree: false });
    decorateFolderActions();
  }

  function descendantFolderIds(rootId, folders) {
    const children = new Map();
    folders.forEach((folder) => {
      const parent = folder.parentId || null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(folder.id);
    });
    const result = [];
    const visit = (id) => {
      for (const childId of children.get(id) || []) {
        result.push(childId);
        visit(childId);
      }
    };
    visit(rootId);
    return result;
  }

  function folderDepth(folderId, folders) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    let depth = 0;
    let current = byId.get(folderId);
    const seen = new Set();
    while (current?.parentId && !seen.has(current.parentId)) {
      seen.add(current.parentId);
      depth += 1;
      current = byId.get(current.parentId);
    }
    return depth;
  }

  async function folderDeleteInfo(folderId) {
    const [folder, folders, decks] = await Promise.all([
      OituDB.getFolder(folderId),
      OituDB.getFolders(),
      OituDB.getDecks()
    ]);
    if (!folder) return null;
    const ids = new Set([folderId, ...descendantFolderIds(folderId, folders)]);
    const affectedDecks = decks.filter((deck) => ids.has(deck.folderId || null));
    let cardCount = 0;
    for (const deck of affectedDecks) {
      const cards = await OituDB.getCardsByDeck(deck.id);
      cardCount += cards.length;
    }
    return {
      folder,
      folders,
      folderIds: ids,
      affectedDecks,
      subfolderCount: ids.size - 1,
      cardCount
    };
  }

  async function requestDeckDelete(deckId) {
    const deck = await OituDB.getDeck(deckId);
    if (!deck) return;
    const cards = await OituDB.getCardsByDeck(deckId);
    state.pendingDelete = { type: "deck", id: deckId, name: deck.name };
    $("#directDeleteConfirmTitle").textContent = "Excluir baralho?";
    $("#directDeleteConfirmMessage").textContent = `O baralho “${deck.name}” será apagado com ${cards.length} ${cards.length === 1 ? "flashcard" : "flashcards"}.`;
    $("#directDeleteConfirmWarning").textContent = "Todos os flashcards deste baralho serão apagados deste navegador. Esta ação não poderá ser desfeita.";
    openModal("directDeleteConfirmModal");
  }

  async function requestFolderDelete(folderId) {
    const info = await folderDeleteInfo(folderId);
    if (!info) return;
    state.pendingDelete = { type: "folder", id: folderId, info };
    $("#directDeleteConfirmTitle").textContent = info.subfolderCount ? "Excluir pasta e conteúdo?" : "Excluir pasta?";
    const parts = [];
    if (info.subfolderCount) parts.push(`${info.subfolderCount} ${info.subfolderCount === 1 ? "subpasta" : "subpastas"}`);
    if (info.affectedDecks.length) parts.push(`${info.affectedDecks.length} ${info.affectedDecks.length === 1 ? "baralho" : "baralhos"}`);
    if (info.cardCount) parts.push(`${info.cardCount} ${info.cardCount === 1 ? "flashcard" : "flashcards"}`);
    const contents = parts.length ? ` Ela contém ${parts.join(", ")}.` : " Ela está vazia.";
    $("#directDeleteConfirmMessage").textContent = `A pasta “${info.folder.name}” será apagada.${contents}`;
    $("#directDeleteConfirmWarning").textContent = info.affectedDecks.length || info.subfolderCount
      ? "Tudo que estiver dentro desta pasta e de suas subpastas também será apagado. Esta ação não poderá ser desfeita."
      : "Esta ação não poderá ser desfeita.";
    openModal("directDeleteConfirmModal");
  }

  async function deleteFolderTree(info) {
    for (const deck of info.affectedDecks) await OituDB.deleteDeck(deck.id);
    const ordered = [...info.folderIds].sort((a, b) => folderDepth(b, info.folders) - folderDepth(a, info.folders));
    for (const folderId of ordered) await OituDB.deleteFolder(folderId);
  }

  async function confirmPendingDelete() {
    const pending = state.pendingDelete;
    if (!pending) return;
    state.pendingDelete = null;
    const accept = $("#directDeleteConfirmAccept");
    if (accept) accept.disabled = true;
    try {
      if (pending.type === "deck") {
        await OituDB.deleteDeck(pending.id);
        closeModal("directDeleteConfirmModal");
        state.editingDeckId = null;
        $("#homeButton")?.click();
        setTimeout(() => window.OituLibrary?.render?.(), 30);
        showToast("Baralho excluído.");
        return;
      }

      if (pending.type === "folder") {
        await deleteFolderTree(pending.info);
        closeModal("directDeleteConfirmModal");
        closeModal("folderEditModal");
        if (state.editingFolderId === pending.id) state.editingFolderId = null;
        await window.OituLibrary?.render?.();
        showToast(pending.info.subfolderCount ? "Pasta e conteúdo excluídos." : "Pasta excluída.");
      }
    } catch (error) {
      console.error("OituCards: falha ao excluir item.", error);
      alert("Não foi possível concluir a exclusão. Tente novamente.");
    } finally {
      if (accept) accept.disabled = false;
    }
  }

  function cancelPendingDelete() {
    state.pendingDelete = null;
    closeModal("directDeleteConfirmModal");
  }

  function captureEditingTargets(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const folderEdit = target.closest("[data-edit-folder]");
    if (folderEdit) state.editingFolderId = folderEdit.dataset.editFolder || null;

    const deckEdit = target.closest('[data-action="edit-deck"]');
    const deckRow = deckEdit?.closest("[data-deck-id]");
    if (deckEdit && deckRow) state.editingDeckId = deckRow.dataset.deckId || null;
  }

  function triggerFolderMenuAction(folderId, action) {
    const row = $(`[data-folder-id="${CSS.escape(folderId)}"]`);
    if (!row) return;
    const selector = action === "edit"
      ? `[data-edit-folder="${CSS.escape(folderId)}"]`
      : action === "existing"
        ? `[data-add-existing-folder="${CSS.escape(folderId)}"]`
        : action === "subfolder"
          ? `[data-create-subfolder="${CSS.escape(folderId)}"]`
          : action === "delete"
            ? `[data-delete-folder-direct="${CSS.escape(folderId)}"]`
            : null;
    if (!selector) return;
    closeFolderMenus();
    row.querySelector(selector)?.click();
  }

  function bindEvents() {
    window.addEventListener("click", captureEditingTargets, true);

    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const more = target.closest("[data-folder-more]");
      if (more) {
        event.preventDefault();
        event.stopPropagation();
        toggleFolderMenu(more.dataset.folderMore);
        return;
      }

      const menuAction = target.closest("[data-folder-menu-action][data-folder-menu-id]");
      if (menuAction) {
        event.preventDefault();
        event.stopPropagation();
        triggerFolderMenuAction(menuAction.dataset.folderMenuId, menuAction.dataset.folderMenuAction);
        return;
      }

      const rowDelete = target.closest("[data-delete-folder-direct]");
      if (rowDelete) {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestFolderDelete(rowDelete.dataset.deleteFolderDirect);
        return;
      }

      if (target.closest("#deleteCurrentDeckButton")) {
        event.preventDefault();
        if (state.editingDeckId) requestDeckDelete(state.editingDeckId);
        return;
      }

      if (target.closest("#folderEditDeleteButton")) {
        event.preventDefault();
        if (state.editingFolderId) requestFolderDelete(state.editingFolderId);
        return;
      }

      if (target.closest("#directDeleteConfirmAccept")) {
        event.preventDefault();
        confirmPendingDelete();
        return;
      }

      if (target.closest("#directDeleteConfirmCancel,#directDeleteConfirmClose")) {
        event.preventDefault();
        cancelPendingDelete();
        return;
      }

      if (!target.closest(".folder-more-wrap")) closeFolderMenus();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.openMenuFolderId) closeFolderMenus();
    });

    $("#directDeleteConfirmModal")?.addEventListener("mousedown", (event) => {
      if (event.target === $("#directDeleteConfirmModal")) cancelPendingDelete();
    });
  }

  function installUi(attempt = 0) {
    ensureDeckDeleteButton();
    ensureFolderEditDeleteButton();
    installListObserver();
    decorateFolderActions();
    if ((!$("#folderEditModal") || !$("#deckList")) && attempt < 20) {
      setTimeout(() => installUi(attempt + 1), 80);
    }
  }

  function init() {
    ensureStyles();
    ensureConfirmModal();
    bindEvents();
    installUi();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
