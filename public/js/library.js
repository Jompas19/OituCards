(function () {
  const state = {
    currentFolderId: null,
    selected: new Set(),
    editingDeckId: null,
    editingOriginFolderId: null,
    rendering: false,
    renderSeq: 0
  };
  const $ = (s) => document.querySelector(s);
  let observer = null;
  let renderTimer = null;

  function ensureStyles() {
    if (document.querySelector('link[data-oitucards-library-css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/library.css";
    link.dataset.oitucardsLibraryCss = "true";
    document.head.appendChild(link);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2600);
  }

  function isNewCard(card) {
    const count = Number.isInteger(card?.reviewCount) ? card.reviewCount : (card?.lastReviewedAt || card?.nextReviewAt || card?.lastRating ? 1 : 0);
    return count === 0 && !card?.lastReviewedAt && !card?.nextReviewAt && !card?.lastRating;
  }

  function isDue(card) {
    if (isNewCard(card)) return false;
    if (!card?.nextReviewAt) return true;
    const due = new Date(card.nextReviewAt);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return Number.isNaN(due.getTime()) || due <= end;
  }

  function selectedKey(type, id) { return `${type}:${id}`; }
  function isSelected(type, id) { return state.selected.has(selectedKey(type, id)); }

  function ensureUI() {
    ensureStyles();
    const home = $("#homeView");
    const heading = home?.querySelector(".page-heading");
    const actions = heading?.querySelector(".heading-actions");
    if (!home || !heading || !actions) return false;

    if (!$("#libraryBreadcrumb")) {
      const bc = document.createElement("div");
      bc.id = "libraryBreadcrumb";
      bc.className = "library-breadcrumb hidden";
      heading.before(bc);
    }
    if (!$("#librarySelectionBar")) {
      const bar = document.createElement("div");
      bar.id = "librarySelectionBar";
      bar.className = "library-selection-bar hidden";
      bar.innerHTML = `<span id="librarySelectionCount" class="library-selection-count">0 selecionados</span>
        <button id="studySelectedButton" class="button primary" type="button">Estudar selecionados</button>
        <button id="moveSelectedButton" class="button secondary" type="button">Mover</button>
        <button id="deleteSelectedButton" class="button danger" type="button">Excluir selecionados</button>
        <button id="clearSelectionButton" class="button ghost" type="button">Limpar seleção</button>`;
      $("#deckList")?.before(bar);
    }
    if (!$("#createFolderButton")) {
      const button = document.createElement("button");
      button.id = "createFolderButton";
      button.className = "button secondary";
      button.type = "button";
      button.textContent = "+ Criar pasta";
      actions.prepend(button);
    }
    if (!$("#addExistingDecksButton")) {
      const button = document.createElement("button");
      button.id = "addExistingDecksButton";
      button.className = "button secondary hidden";
      button.type = "button";
      button.textContent = "Adicionar baralhos existentes";
      actions.prepend(button);
    }
    if (!$("#studyFolderButton")) {
      const button = document.createElement("button");
      button.id = "studyFolderButton";
      button.className = "button primary hidden";
      button.type = "button";
      button.textContent = "Estudar pasta";
      actions.prepend(button);
    }
    if (!$("#moveDeckButton")) {
      const deckActions = $("#deckView .heading-actions");
      if (deckActions) {
        const button = document.createElement("button");
        button.id = "moveDeckButton";
        button.className = "button ghost move-deck-button";
        button.type = "button";
        button.textContent = "Mover para pasta";
        deckActions.prepend(button);
      }
    }
    ensureModals();
    return true;
  }

  function ensureModals() {
    if (!$("#folderModal")) document.body.insertAdjacentHTML("beforeend", `
      <div id="folderModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
        <div class="modal small-modal"><div class="modal-header"><div><p class="eyebrow">Organização</p><h2 id="folderModalTitle">Nova pasta</h2></div><button class="icon-button modal-close" data-library-close="folderModal" type="button">×</button></div>
        <form id="folderForm"><label class="field-label" for="folderNameInput">Nome da pasta</label><input id="folderNameInput" class="text-input" maxlength="120" required autocomplete="off"><div class="modal-actions"><button class="button ghost" data-library-close="folderModal" type="button">Cancelar</button><button class="button primary" type="submit">Criar pasta</button></div></form></div>
      </div>`);
    if (!$("#moveLibraryModal")) document.body.insertAdjacentHTML("beforeend", `
      <div id="moveLibraryModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
        <div class="modal small-modal"><div class="modal-header"><div><p class="eyebrow">Organização</p><h2>Mover para</h2></div><button class="icon-button modal-close" data-library-close="moveLibraryModal" type="button">×</button></div>
        <p class="subtitle">Escolha a pasta de destino.</p><div id="moveFolderChoices" class="library-modal-list"></div><div class="modal-actions"><button class="button ghost" data-library-close="moveLibraryModal" type="button">Cancelar</button><button id="confirmMoveButton" class="button primary" type="button">Mover</button></div></div>
      </div>`);
    if (!$("#addExistingModal")) document.body.insertAdjacentHTML("beforeend", `
      <div id="addExistingModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
        <div class="modal small-modal"><div class="modal-header"><div><p class="eyebrow">Pasta</p><h2>Adicionar baralhos existentes</h2></div><button class="icon-button modal-close" data-library-close="addExistingModal" type="button">×</button></div>
        <p class="subtitle">Selecione os baralhos que deseja mover para esta pasta.</p><div id="existingDeckChoices" class="library-modal-list"></div><div class="modal-actions"><button class="button ghost" data-library-close="addExistingModal" type="button">Cancelar</button><button id="confirmAddExistingButton" class="button primary" type="button">Adicionar à pasta</button></div></div>
      </div>`);
  }

  function openModal(id) { $(`#${id}`)?.classList.remove("hidden"); document.body.style.overflow = "hidden"; }
  function closeModal(id) { $(`#${id}`)?.classList.add("hidden"); if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = ""; }

  function folderChildrenMap(folders) {
    const map = new Map();
    folders.forEach(folder => {
      const key = folder.parentId || null;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(folder);
    });
    return map;
  }

  function descendantFolderIds(folderId, folders) {
    const children = folderChildrenMap(folders);
    const out = [];
    const visit = id => {
      for (const child of children.get(id) || []) {
        out.push(child.id);
        visit(child.id);
      }
    };
    visit(folderId);
    return out;
  }

  function deckIdsForFolder(folderId, folders, decks) {
    const ids = new Set([folderId, ...descendantFolderIds(folderId, folders)]);
    return decks.filter(deck => ids.has(deck.folderId || null)).map(deck => deck.id);
  }

  function folderPath(folderId, folders) {
    if (!folderId) return [];
    const byId = new Map(folders.map(f => [f.id, f]));
    const path = [];
    const seen = new Set();
    let cur = byId.get(folderId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return path;
  }

  async function normalizeAnkiPaths() {
    const decks = await OituDB.getDecks();
    const targets = decks.filter(deck => String(deck.name).includes("::"));
    if (!targets.length) return false;
    let folders = await OituDB.getFolders();
    for (const deck of targets) {
      const parts = String(deck.name).split("::").map(x => x.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const leaf = parts.pop();
      let parentId = deck.folderId || null;
      for (const part of parts) {
        let folder = folders.find(f => (f.parentId || null) === parentId && f.name.toLocaleLowerCase() === part.toLocaleLowerCase());
        if (!folder) {
          folder = await OituDB.addFolder(part, parentId);
          folders.push(folder);
        }
        parentId = folder.id;
      }
      await OituDB.updateDeck(deck.id, { name: leaf, folderId: parentId });
    }
    return true;
  }

  async function deckSummary(deck) {
    const cards = await OituDB.getCardsByDeck(deck.id);
    const studied = cards.filter(card => card.reviewStatus).length;
    const progress = cards.length ? Math.round(studied / cards.length * 100) : 0;
    const due = cards.filter(isDue).length;
    return { deck, cards, progress, due };
  }

  async function folderSummary(folder, folders, decks) {
    const ids = deckIdsForFolder(folder.id, folders, decks);
    const cardsByDeck = await Promise.all(ids.map(id => OituDB.getCardsByDeck(id)));
    const cards = cardsByDeck.flat();
    return { deckCount: ids.length, cardCount: cards.length, due: cards.filter(isDue).length };
  }

  function updateSelectionBar() {
    const count = state.selected.size;
    $("#librarySelectionBar")?.classList.toggle("hidden", count === 0);
    if ($("#librarySelectionCount")) $("#librarySelectionCount").textContent = `${count} ${count === 1 ? "item selecionado" : "itens selecionados"}`;
  }

  function setObserver(active) {
    const list = $("#deckList");
    if (!list || !observer) return;
    observer.disconnect();
    if (active) observer.observe(list, { childList: true });
  }

  async function renderLibrary() {
    if (state.rendering || !$("#homeView")?.classList.contains("active")) return;
    const seq = ++state.renderSeq;
    state.rendering = true;
    try {
      await normalizeAnkiPaths();
      const [folders, decks] = await Promise.all([OituDB.getFolders(), OituDB.getDecks()]);
      if (seq !== state.renderSeq) return;
      if (state.currentFolderId && !folders.some(f => f.id === state.currentFolderId)) state.currentFolderId = null;
      const currentFolder = state.currentFolderId ? folders.find(f => f.id === state.currentFolderId) : null;
      const directFolders = folders.filter(f => (f.parentId || null) === (state.currentFolderId || null));
      const directDecks = decks.filter(d => (d.folderId || null) === (state.currentFolderId || null));
      const folderSummaries = new Map();
      for (const folder of directFolders) folderSummaries.set(folder.id, await folderSummary(folder, folders, decks));
      const deckSummaries = await Promise.all(directDecks.map(deckSummary));
      if (seq !== state.renderSeq) return;

      const home = $("#homeView");
      const heading = home.querySelector(".page-heading");
      heading.querySelector(".eyebrow").textContent = currentFolder ? "Pasta" : "Biblioteca";
      heading.querySelector("h1").textContent = currentFolder ? currentFolder.name : "Meus baralhos";
      heading.querySelector(".subtitle").textContent = currentFolder ? "Organize, selecione ou estude os baralhos desta pasta." : "Organize seus baralhos em pastas e estude do seu jeito.";
      $("#createFolderButton").textContent = currentFolder ? "+ Criar subpasta" : "+ Criar pasta";
      $("#studyFolderButton").classList.toggle("hidden", !currentFolder);
      $("#addExistingDecksButton").classList.toggle("hidden", !currentFolder);
      $("#addDeckButton").classList.toggle("hidden", !!currentFolder);
      $("#importDeckButton").classList.remove("hidden");

      const bc = $("#libraryBreadcrumb");
      const path = currentFolder ? folderPath(currentFolder.id, folders) : [];
      bc.classList.toggle("hidden", !currentFolder);
      if (currentFolder) {
        bc.innerHTML = `<button type="button" data-library-root>Meus baralhos</button>${path.map((f, i) => `<span>›</span><button type="button" data-library-folder="${f.id}" ${i === path.length - 1 ? "disabled" : ""}>${escapeHtml(f.name)}</button>`).join("")}`;
      }

      const rows = [];
      for (const folder of directFolders) {
        const s = folderSummaries.get(folder.id);
        const selected = isSelected("folder", folder.id);
        rows.push(`<article class="deck-row folder-row ${selected ? "is-selected" : ""}" data-folder-id="${folder.id}">
          <div class="library-select"><input type="checkbox" data-select-folder="${folder.id}" ${selected ? "checked" : ""} aria-label="Selecionar pasta ${escapeHtml(folder.name)}"></div>
          <div class="deck-main"><button class="deck-name-button folder-name-button" type="button" data-open-folder="${folder.id}"><span class="folder-icon">📁</span>${escapeHtml(folder.name)}</button><div class="folder-info"><span>${s.deckCount} ${s.deckCount === 1 ? "baralho" : "baralhos"}</span><span>${s.cardCount} ${s.cardCount === 1 ? "card" : "cards"}</span>${s.due ? `<span class="folder-review-due">↻ ${s.due} ${s.due === 1 ? "revisão" : "revisões"} hoje</span>` : ""}</div></div>
          <div class="deck-actions"><button class="action-button icon-only folder-study-button" type="button" data-study-folder="${folder.id}" title="Estudar pasta" aria-label="Estudar pasta">▶</button></div>
        </article>`);
      }
      for (const { deck, cards, progress, due } of deckSummaries) {
        const selected = isSelected("deck", deck.id);
        rows.push(`<article class="deck-row ${selected ? "is-selected" : ""}" data-deck-id="${deck.id}">
          <div class="library-select"><input type="checkbox" data-select-deck="${deck.id}" ${selected ? "checked" : ""} aria-label="Selecionar baralho ${escapeHtml(deck.name)}"></div>
          <div class="deck-main"><button class="deck-name-button" type="button" data-action="edit-deck">${escapeHtml(deck.name)}</button><div class="deck-info"><span>${cards.length} ${cards.length === 1 ? "card" : "cards"}</span><span>Progresso: ${progress}%</span><span class="review-due-badge ${due ? "has-due" : ""}">↻ ${due} ${due === 1 ? "revisão" : "revisões"} hoje</span></div><div class="progress-track" aria-label="Progresso de ${progress}%"><div class="progress-bar" style="width:${progress}%"></div></div></div>
          <div class="deck-actions"><button class="action-button icon-only" type="button" data-action="edit-deck" title="Editar baralho" aria-label="Editar baralho">✎</button><button class="action-button icon-only delete" type="button" data-action="delete-deck" title="Apagar baralho" aria-label="Apagar baralho">🗑</button></div>
        </article>`);
      }

      setObserver(false);
      $("#deckList").innerHTML = rows.join("") || `<div class="library-empty">${currentFolder ? "Esta pasta está vazia." : "Você ainda não possui pastas ou baralhos."}</div>`;
      setObserver(true);
      $("#emptyState").classList.add("hidden");
      updateSelectionBar();
    } finally {
      state.rendering = false;
    }
  }

  function scheduleRender(delay = 0) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderLibrary(), delay);
  }

  async function openFolder(folderId) {
    state.currentFolderId = folderId;
    state.selected.clear();
    updateSelectionBar();
    await renderLibrary();
  }

  function openCreateFolder() {
    $("#folderModalTitle").textContent = state.currentFolderId ? "Nova subpasta" : "Nova pasta";
    $("#folderNameInput").value = "";
    openModal("folderModal");
    setTimeout(() => $("#folderNameInput")?.focus(), 40);
  }

  async function createFolder(event) {
    event.preventDefault();
    const name = $("#folderNameInput").value.trim();
    if (!name) return;
    const folders = await OituDB.getFolders();
    const duplicate = folders.some(f => (f.parentId || null) === (state.currentFolderId || null) && f.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate) { alert("Já existe uma pasta com esse nome neste local."); return; }
    await OituDB.addFolder(name, state.currentFolderId);
    closeModal("folderModal");
    showToast("Pasta criada.");
    scheduleRender();
  }

  async function selectedEntities() {
    const [folders, decks] = await Promise.all([OituDB.getFolders(), OituDB.getDecks()]);
    const selectedDeckIds = new Set();
    const selectedFolderIds = new Set();
    for (const key of state.selected) {
      const [type, id] = key.split(":");
      if (type === "deck") selectedDeckIds.add(id);
      if (type === "folder") selectedFolderIds.add(id);
    }
    return { folders, decks, selectedDeckIds, selectedFolderIds };
  }

  async function resolveSelectedDeckIds() {
    const { folders, decks, selectedDeckIds, selectedFolderIds } = await selectedEntities();
    for (const folderId of selectedFolderIds) deckIdsForFolder(folderId, folders, decks).forEach(id => selectedDeckIds.add(id));
    return [...selectedDeckIds];
  }

  async function studyDeckIds(deckIds, label) {
    if (!deckIds.length) { alert("Nenhum baralho com flashcards foi encontrado nesta seleção."); return; }
    if (!window.OituMultiStudy?.openConfig) { alert("O módulo de estudo combinado ainda não terminou de carregar. Tente novamente."); return; }
    await window.OituMultiStudy.openConfig(deckIds, label);
  }

  async function studySelected() {
    const ids = await resolveSelectedDeckIds();
    await studyDeckIds(ids, "Estudar selecionados");
  }

  async function studyFolder(folderId) {
    const [folders, decks] = await Promise.all([OituDB.getFolders(), OituDB.getDecks()]);
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;
    await studyDeckIds(deckIdsForFolder(folderId, folders, decks), folder.name);
  }

  async function deleteSelected() {
    const { folders, decks, selectedDeckIds, selectedFolderIds } = await selectedEntities();
    const folderDeleteIds = new Set();
    for (const id of selectedFolderIds) {
      folderDeleteIds.add(id);
      descendantFolderIds(id, folders).forEach(child => folderDeleteIds.add(child));
      deckIdsForFolder(id, folders, decks).forEach(deckId => selectedDeckIds.add(deckId));
    }
    const message = `Excluir ${selectedDeckIds.size} ${selectedDeckIds.size === 1 ? "baralho" : "baralhos"}${folderDeleteIds.size ? ` e ${folderDeleteIds.size} ${folderDeleteIds.size === 1 ? "pasta" : "pastas"}` : ""}? Todos os flashcards contidos serão apagados deste navegador.`;
    if (!window.confirm(message)) return;
    for (const deckId of selectedDeckIds) await OituDB.deleteDeck(deckId);
    const depth = id => folderPath(id, folders).length;
    for (const folderId of [...folderDeleteIds].sort((a, b) => depth(b) - depth(a))) await OituDB.deleteFolder(folderId);
    state.selected.clear();
    if (state.currentFolderId && folderDeleteIds.has(state.currentFolderId)) state.currentFolderId = null;
    showToast("Itens excluídos.");
    scheduleRender();
  }

  let pendingMove = null;
  async function openMoveModal(entities = null) {
    const [folders] = await Promise.all([OituDB.getFolders()]);
    pendingMove = entities || await selectedEntities();
    const folderIds = pendingMove.selectedFolderIds || new Set();
    const invalid = new Set();
    for (const id of folderIds) { invalid.add(id); descendantFolderIds(id, folders).forEach(x => invalid.add(x)); }
    const choices = [{ id: "", name: "Sem pasta (raiz)", path: "Biblioteca" }, ...folders.filter(f => !invalid.has(f.id)).map(f => ({ id: f.id, name: f.name, path: folderPath(f.id, folders).map(x => x.name).join(" › ") }))];
    $("#moveFolderChoices").innerHTML = choices.map((choice, i) => `<label class="library-choice"><input type="radio" name="moveTargetFolder" value="${choice.id}" ${i === 0 ? "checked" : ""}><span><strong>${escapeHtml(choice.name)}</strong><small>${escapeHtml(choice.path)}</small></span></label>`).join("");
    openModal("moveLibraryModal");
  }

  async function confirmMove() {
    if (!pendingMove) return;
    const target = document.querySelector('input[name="moveTargetFolder"]:checked')?.value || null;
    for (const deckId of pendingMove.selectedDeckIds || []) await OituDB.updateDeck(deckId, { folderId: target || null });
    for (const folderId of pendingMove.selectedFolderIds || []) await OituDB.updateFolder(folderId, { parentId: target || null });
    closeModal("moveLibraryModal");
    pendingMove = null;
    state.selected.clear();
    showToast("Itens movidos.");
    scheduleRender();
  }

  async function openMoveCurrentDeck() {
    if (!state.editingDeckId) { alert("Abra um baralho pela opção de edição antes de movê-lo."); return; }
    const deck = await OituDB.getDeck(state.editingDeckId);
    if (!deck) return;
    await openMoveModal({ selectedDeckIds: new Set([deck.id]), selectedFolderIds: new Set() });
  }

  async function openAddExisting() {
    if (!state.currentFolderId) return;
    const [decks, folders] = await Promise.all([OituDB.getDecks(), OituDB.getFolders()]);
    const available = decks.filter(d => (d.folderId || null) !== state.currentFolderId);
    if (!available.length) $("#existingDeckChoices").innerHTML = `<div class="library-empty">Todos os baralhos já estão nesta pasta.</div>`;
    else $("#existingDeckChoices").innerHTML = available.map(deck => {
      const path = deck.folderId ? folderPath(deck.folderId, folders).map(f => f.name).join(" › ") : "Sem pasta";
      return `<label class="library-choice"><input type="checkbox" data-existing-deck="${deck.id}"><span><strong>${escapeHtml(deck.name)}</strong><small>${escapeHtml(path)}</small></span></label>`;
    }).join("");
    openModal("addExistingModal");
  }

  async function confirmAddExisting() {
    if (!state.currentFolderId) return;
    const ids = [...document.querySelectorAll("[data-existing-deck]:checked")].map(el => el.dataset.existingDeck);
    if (!ids.length) { closeModal("addExistingModal"); return; }
    for (const id of ids) await OituDB.updateDeck(id, { folderId: state.currentFolderId });
    closeModal("addExistingModal");
    showToast(`${ids.length} ${ids.length === 1 ? "baralho adicionado" : "baralhos adicionados"} à pasta.`);
    scheduleRender();
  }

  function toggleSelection(type, id, checked) {
    const key = selectedKey(type, id);
    if (checked) state.selected.add(key); else state.selected.delete(key);
    updateSelectionBar();
    const row = type === "deck" ? document.querySelector(`[data-deck-id="${CSS.escape(id)}"]`) : document.querySelector(`[data-folder-id="${CSS.escape(id)}"]`);
    row?.classList.toggle("is-selected", checked);
  }

  function bindEvents() {
    $("#createFolderButton").addEventListener("click", openCreateFolder);
    $("#folderForm").addEventListener("submit", createFolder);
    $("#studySelectedButton").addEventListener("click", studySelected);
    $("#deleteSelectedButton").addEventListener("click", deleteSelected);
    $("#moveSelectedButton").addEventListener("click", () => openMoveModal());
    $("#clearSelectionButton").addEventListener("click", () => { state.selected.clear(); scheduleRender(); });
    $("#studyFolderButton").addEventListener("click", () => state.currentFolderId && studyFolder(state.currentFolderId));
    $("#addExistingDecksButton").addEventListener("click", openAddExisting);
    $("#confirmAddExistingButton").addEventListener("click", confirmAddExisting);
    $("#confirmMoveButton").addEventListener("click", confirmMove);
    $("#moveDeckButton").addEventListener("click", openMoveCurrentDeck);

    document.addEventListener("change", event => {
      const deck = event.target.closest("[data-select-deck]");
      const folder = event.target.closest("[data-select-folder]");
      if (deck) toggleSelection("deck", deck.dataset.selectDeck, deck.checked);
      if (folder) toggleSelection("folder", folder.dataset.selectFolder, folder.checked);
    });

    document.addEventListener("click", event => {
      const open = event.target.closest("[data-open-folder]");
      const study = event.target.closest("[data-study-folder]");
      const bcFolder = event.target.closest("[data-library-folder]");
      const root = event.target.closest("[data-library-root]");
      if (open) { event.preventDefault(); event.stopPropagation(); openFolder(open.dataset.openFolder); return; }
      if (study) { event.preventDefault(); event.stopPropagation(); studyFolder(study.dataset.studyFolder); return; }
      if (bcFolder && !bcFolder.disabled) { openFolder(bcFolder.dataset.libraryFolder); return; }
      if (root) { state.currentFolderId = null; state.selected.clear(); scheduleRender(); return; }
      const close = event.target.closest("[data-library-close]");
      if (close) { closeModal(close.dataset.libraryClose); return; }
    });

    document.addEventListener("click", event => {
      const edit = event.target.closest('[data-action="edit-deck"]');
      const row = edit?.closest("[data-deck-id]");
      if (edit && row && !edit.classList.contains("deck-name-button")) {
        state.editingDeckId = row.dataset.deckId;
        state.editingOriginFolderId = state.currentFolderId;
      }
    }, true);

    $("#homeButton")?.addEventListener("click", () => { state.currentFolderId = null; state.selected.clear(); scheduleRender(30); }, true);
    $("#backHomeButton")?.addEventListener("click", () => { state.currentFolderId = state.editingOriginFolderId || null; state.selected.clear(); scheduleRender(30); }, true);
    $("#importDeckButton")?.addEventListener("click", () => scheduleRender(1200));

    document.querySelectorAll("#folderModal,#moveLibraryModal,#addExistingModal").forEach(backdrop => backdrop.addEventListener("mousedown", event => { if (event.target === backdrop) closeModal(backdrop.id); }));
  }

  function initObserver() {
    observer = new MutationObserver(() => {
      if (!state.rendering && $("#homeView")?.classList.contains("active")) scheduleRender(15);
    });
    setObserver(true);
  }

  function init() {
    if (!ensureUI()) return;
    bindEvents();
    initObserver();
    scheduleRender(30);
  }

  window.OituLibrary = { render: renderLibrary, openFolder, studyFolder, normalizeAnkiPaths };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
