(function () {
  const DEFAULT_REVIEW_SETTINGS = Object.freeze({
    newIntervals: Object.freeze({ hard: 1, medium: 2, good: 4, easy: 7 }),
    multipliers: Object.freeze({ hard: 1.2, medium: 1.8, good: 2.5, easy: 4 }),
    maxIntervalDays: 180
  });
  const state = {
    selected: new Set(),
    editingDeckId: null,
    editingFolderId: null,
    folderReviewId: null,
    moveEntities: null,
    moveExpanded: new Set(),
    addTargetFolderId: null,
    addExpanded: new Set(),
    decorating: false
  };
  const $ = (selector) => document.querySelector(selector);

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cloneSettings(settings) {
    return {
      newIntervals: { ...settings.newIntervals },
      multipliers: { ...settings.multipliers },
      maxIntervalDays: settings.maxIntervalDays
    };
  }

  function normalizedSettings(raw) {
    const source = raw || {};
    const intervals = source.newIntervals || source;
    const multipliers = source.multipliers || {};
    const max = Number.isFinite(Number(source.maxIntervalDays)) ? Math.max(1, Math.round(Number(source.maxIntervalDays))) : DEFAULT_REVIEW_SETTINGS.maxIntervalDays;
    const readInt = (key) => {
      const value = Number(intervals?.[key]);
      return Number.isFinite(value) && value >= 1 ? Math.min(max, Math.round(value)) : DEFAULT_REVIEW_SETTINGS.newIntervals[key];
    };
    const readMultiplier = (key) => {
      const value = Number(multipliers?.[key]);
      return Number.isFinite(value) && value >= 1 ? Math.min(10, Math.round(value * 100) / 100) : DEFAULT_REVIEW_SETTINGS.multipliers[key];
    };
    return {
      newIntervals: { hard: readInt("hard"), medium: readInt("medium"), good: readInt("good"), easy: readInt("easy") },
      multipliers: { hard: readMultiplier("hard"), medium: readMultiplier("medium"), good: readMultiplier("good"), easy: readMultiplier("easy") },
      maxIntervalDays: max
    };
  }

  function sameSettings(a, b) {
    const left = normalizedSettings(a);
    const right = normalizedSettings(b);
    return left.maxIntervalDays === right.maxIntervalDays &&
      ["hard", "medium", "good", "easy"].every((key) => left.newIntervals[key] === right.newIntervals[key] && left.multipliers[key] === right.multipliers[key]);
  }

  function deckHasCustomSettings(deck) {
    return !sameSettings(deck?.reviewSettings, DEFAULT_REVIEW_SETTINGS);
  }

  function folderEmoji(folder) {
    const value = String(folder?.emoji || "").trim();
    return value || "📁";
  }

  function firstGrapheme(value) {
    const text = String(value || "").trim();
    if (!text) return "📁";
    try {
      if (Intl?.Segmenter) {
        const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
        return segmenter.segment(text)[Symbol.iterator]().next().value?.segment || "📁";
      }
    } catch (_) {}
    return Array.from(text)[0] || "📁";
  }

  function folderChildrenMap(folders) {
    const map = new Map();
    folders.forEach((folder) => {
      const key = folder.parentId || null;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(folder);
    });
    map.forEach((items) => items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    return map;
  }

  function decksByFolderMap(decks) {
    const map = new Map();
    decks.forEach((deck) => {
      const key = deck.folderId || null;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(deck);
    });
    map.forEach((items) => items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    return map;
  }

  function descendantFolderIds(folderId, folders) {
    const children = folderChildrenMap(folders);
    const out = [];
    const visit = (id) => {
      for (const child of children.get(id) || []) {
        out.push(child.id);
        visit(child.id);
      }
    };
    visit(folderId);
    return out;
  }

  function ancestorFolderIds(folderId, folders) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const out = [];
    const seen = new Set();
    let current = byId.get(folderId);
    while (current?.parentId && !seen.has(current.parentId)) {
      seen.add(current.parentId);
      out.push(current.parentId);
      current = byId.get(current.parentId);
    }
    return out;
  }

  function nearestFolderSettings(folderId, folders) {
    if (!folderId) return null;
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const seen = new Set();
    let current = byId.get(folderId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.reviewSettings) return normalizedSettings(current.reviewSettings);
      current = current.parentId ? byId.get(current.parentId) : null;
    }
    return null;
  }

  function openModal(id) {
    $(`#${id}`)?.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    $(`#${id}`)?.classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2600);
  }

  function ensureModals() {
    if (!$("#folderEditModal")) document.body.insertAdjacentHTML("beforeend", `
      <div id="folderEditModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
        <div class="modal small-modal">
          <div class="modal-header"><div><p class="eyebrow">Pasta</p><h2>Editar pasta</h2></div><button class="icon-button modal-close" data-enh-close="folderEditModal" type="button">×</button></div>
          <form id="folderEditForm">
            <label class="field-label" for="folderEditName">Nome da pasta</label>
            <input id="folderEditName" class="text-input" maxlength="120" required autocomplete="off" />
            <label class="field-label folder-emoji-label" for="folderEditEmoji">Emoji</label>
            <div class="folder-emoji-row"><input id="folderEditEmoji" class="text-input folder-emoji-input" maxlength="16" autocomplete="off" placeholder="📁" /><span id="folderEmojiPreview" class="folder-emoji-preview">📁</span></div>
            <p class="field-hint">Digite um emoji para identificar visualmente esta pasta.</p>
            <div class="folder-edit-secondary"><button id="folderReviewSettingsButton" class="button secondary" type="button">Ajustar revisão</button><span class="field-hint">As regras da pasta podem ser aplicadas a todos os baralhos e subpastas dentro dela.</span></div>
            <div class="modal-actions"><button class="button ghost" data-enh-close="folderEditModal" type="button">Cancelar</button><button class="button primary" type="submit">Salvar alterações</button></div>
          </form>
        </div>
      </div>`);

    if (!$("#folderReviewModal")) document.body.insertAdjacentHTML("beforeend", `
      <div id="folderReviewModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
        <div class="modal folder-review-modal">
          <div class="modal-header"><div><p class="eyebrow">Revisão espaçada</p><h2 id="folderReviewTitle">Ajuste da revisão da pasta</h2><p id="folderReviewSubtitle" class="subtitle"></p></div><button class="icon-button modal-close" data-enh-close="folderReviewModal" type="button">×</button></div>
          <form id="folderReviewForm">
            <div class="folder-review-section"><strong>Primeira revisão</strong><p>Em quantos dias um card novo deve reaparecer.</p></div>
            <div class="folder-review-grid">
              <label><span>Difícil</span><div><input id="folderRevHardDays" class="text-input" type="number" min="1" max="3650" required /><small>dias</small></div></label>
              <label><span>Médio</span><div><input id="folderRevMediumDays" class="text-input" type="number" min="1" max="3650" required /><small>dias</small></div></label>
              <label><span>Bom</span><div><input id="folderRevGoodDays" class="text-input" type="number" min="1" max="3650" required /><small>dias</small></div></label>
              <label><span>Fácil</span><div><input id="folderRevEasyDays" class="text-input" type="number" min="1" max="3650" required /><small>dias</small></div></label>
            </div>
            <div class="folder-review-section"><strong>Multiplicadores futuros</strong><p>Quanto o intervalo atual será multiplicado em cada resposta.</p></div>
            <div class="folder-review-grid">
              <label><span>Difícil</span><div><input id="folderRevHardMult" class="text-input" type="number" min="1" max="10" step="0.1" required /><small>×</small></div></label>
              <label><span>Médio</span><div><input id="folderRevMediumMult" class="text-input" type="number" min="1" max="10" step="0.1" required /><small>×</small></div></label>
              <label><span>Bom</span><div><input id="folderRevGoodMult" class="text-input" type="number" min="1" max="10" step="0.1" required /><small>×</small></div></label>
              <label><span>Fácil</span><div><input id="folderRevEasyMult" class="text-input" type="number" min="1" max="10" step="0.1" required /><small>×</small></div></label>
            </div>
            <div class="folder-review-section"><strong>Intervalo máximo</strong></div>
            <label class="folder-review-max"><div><input id="folderRevMax" class="text-input" type="number" min="1" max="3650" required /><small>dias</small></div></label>
            <div class="notice folder-review-warning"><strong>Atenção</strong><p>Ao salvar, estas regras substituirão os ajustes de revisão atuais dos baralhos desta pasta e de todas as subpastas.</p></div>
            <div class="modal-actions"><button id="folderReviewRestore" class="button ghost" type="button">Restaurar padrão</button><button class="button ghost" data-enh-close="folderReviewModal" type="button">Cancelar</button><button class="button primary" type="submit">Aplicar à pasta</button></div>
          </form>
        </div>
      </div>`);

    if (!$("#libraryTreeMoveModal")) document.body.insertAdjacentHTML("beforeend", `
      <div id="libraryTreeMoveModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
        <div class="modal small-modal">
          <div class="modal-header"><div><p class="eyebrow">Organização</p><h2 id="treeMoveTitle">Mover para pasta</h2></div><button class="icon-button modal-close" data-enh-close="libraryTreeMoveModal" type="button">×</button></div>
          <p class="subtitle">Abra as pastas e escolha o destino.</p>
          <div id="treeMoveChoices" class="library-modal-list library-tree-picker"></div>
          <div class="modal-actions"><button class="button ghost" data-enh-close="libraryTreeMoveModal" type="button">Cancelar</button><button id="treeMoveConfirm" class="button primary" type="button">Mover</button></div>
        </div>
      </div>`);

    if (!$("#libraryTreeAddModal")) document.body.insertAdjacentHTML("beforeend", `
      <div id="libraryTreeAddModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
        <div class="modal small-modal">
          <div class="modal-header"><div><p class="eyebrow">Pasta</p><h2 id="treeAddTitle">Adicionar itens existentes</h2></div><button class="icon-button modal-close" data-enh-close="libraryTreeAddModal" type="button">×</button></div>
          <p class="subtitle">Selecione baralhos, pastas ou subpastas para mover para esta pasta.</p>
          <div id="treeAddChoices" class="library-modal-list library-tree-picker"></div>
          <div class="modal-actions"><button class="button ghost" data-enh-close="libraryTreeAddModal" type="button">Cancelar</button><button id="treeAddConfirm" class="button primary" type="button">Adicionar à pasta</button></div>
        </div>
      </div>`);
  }

  async function decorateFolders() {
    if (state.decorating) return;
    state.decorating = true;
    try {
      const folders = await OituDB.getFolders();
      const byId = new Map(folders.map((folder) => [folder.id, folder]));
      document.querySelectorAll("#deckList [data-folder-id]").forEach((row) => {
        const folder = byId.get(row.dataset.folderId);
        if (!folder) return;
        row.querySelectorAll(".folder-icon").forEach((icon) => { icon.textContent = folderEmoji(folder); });
        const actions = row.querySelector(".folder-row-actions, .deck-actions");
        if (actions && !actions.querySelector("[data-edit-folder]")) {
          const button = document.createElement("button");
          button.className = "action-button icon-only";
          button.type = "button";
          button.dataset.editFolder = folder.id;
          button.title = "Editar pasta";
          button.setAttribute("aria-label", "Editar pasta");
          button.textContent = "✎";
          actions.prepend(button);
        }
      });
      document.querySelectorAll("#deckList [data-select-deck]:checked").forEach((input) => state.selected.add(`deck:${input.dataset.selectDeck}`));
      document.querySelectorAll("#deckList [data-select-folder]:checked").forEach((input) => state.selected.add(`folder:${input.dataset.selectFolder}`));
    } finally {
      state.decorating = false;
    }
  }

  async function openFolderEdit(folderId) {
    const folder = await OituDB.getFolder(folderId);
    if (!folder) return;
    state.editingFolderId = folderId;
    $("#folderEditName").value = folder.name;
    $("#folderEditEmoji").value = folder.emoji || "";
    $("#folderEmojiPreview").textContent = folderEmoji(folder);
    openModal("folderEditModal");
    setTimeout(() => $("#folderEditName")?.focus(), 30);
  }

  async function saveFolderBasics(event, options = {}) {
    event?.preventDefault?.();
    const folderId = state.editingFolderId;
    if (!folderId) return false;
    const current = await OituDB.getFolder(folderId);
    if (!current) return false;
    const name = $("#folderEditName").value.trim();
    if (!name) return false;
    const folders = await OituDB.getFolders();
    const duplicate = folders.some((folder) => folder.id !== folderId && (folder.parentId || null) === (current.parentId || null) && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate) {
      alert("Já existe uma pasta com esse nome neste local.");
      return false;
    }
    const emoji = firstGrapheme($("#folderEditEmoji").value);
    await OituDB.updateFolder(folderId, { name, emoji });
    if (!options.keepOpen) closeModal("folderEditModal");
    if (!options.silent) showToast("Pasta atualizada.");
    await window.OituLibrary?.render?.();
    setTimeout(decorateFolders, 50);
    return true;
  }

  function fillFolderReviewForm(settings) {
    const value = normalizedSettings(settings);
    $("#folderRevHardDays").value = value.newIntervals.hard;
    $("#folderRevMediumDays").value = value.newIntervals.medium;
    $("#folderRevGoodDays").value = value.newIntervals.good;
    $("#folderRevEasyDays").value = value.newIntervals.easy;
    $("#folderRevHardMult").value = value.multipliers.hard;
    $("#folderRevMediumMult").value = value.multipliers.medium;
    $("#folderRevGoodMult").value = value.multipliers.good;
    $("#folderRevEasyMult").value = value.multipliers.easy;
    $("#folderRevMax").value = value.maxIntervalDays;
  }

  function readFolderReviewForm() {
    const max = Number.parseInt($("#folderRevMax").value, 10);
    const newIntervals = {
      hard: Number.parseInt($("#folderRevHardDays").value, 10),
      medium: Number.parseInt($("#folderRevMediumDays").value, 10),
      good: Number.parseInt($("#folderRevGoodDays").value, 10),
      easy: Number.parseInt($("#folderRevEasyDays").value, 10)
    };
    const multipliers = {
      hard: Number.parseFloat($("#folderRevHardMult").value),
      medium: Number.parseFloat($("#folderRevMediumMult").value),
      good: Number.parseFloat($("#folderRevGoodMult").value),
      easy: Number.parseFloat($("#folderRevEasyMult").value)
    };
    if (!Number.isInteger(max) || max < 1 || max > 3650) {
      alert("O intervalo máximo deve ficar entre 1 e 3650 dias.");
      return null;
    }
    if (Object.values(newIntervals).some((value) => !Number.isInteger(value) || value < 1 || value > max)) {
      alert("Os intervalos iniciais devem ficar entre 1 dia e o intervalo máximo definido.");
      return null;
    }
    if (Object.values(multipliers).some((value) => !Number.isFinite(value) || value < 1 || value > 10)) {
      alert("Os multiplicadores devem ficar entre 1,0 e 10.");
      return null;
    }
    return { newIntervals, multipliers, maxIntervalDays: max };
  }

  async function openFolderReview(folderId) {
    const [folder, folders] = await Promise.all([OituDB.getFolder(folderId), OituDB.getFolders()]);
    if (!folder) return;
    state.folderReviewId = folderId;
    const inherited = nearestFolderSettings(folderId, folders) || DEFAULT_REVIEW_SETTINGS;
    fillFolderReviewForm(folder.reviewSettings || inherited);
    $("#folderReviewTitle").textContent = "Ajuste da revisão da pasta";
    $("#folderReviewSubtitle").textContent = `${folderEmoji(folder)} ${folder.name}`;
    openModal("folderReviewModal");
  }

  async function applyFolderReview(event) {
    event.preventDefault();
    const folderId = state.folderReviewId;
    if (!folderId) return;
    const settings = readFolderReviewForm();
    if (!settings) return;
    const [folder, folders, decks] = await Promise.all([OituDB.getFolder(folderId), OituDB.getFolders(), OituDB.getDecks()]);
    if (!folder) return;
    const folderIds = new Set([folderId, ...descendantFolderIds(folderId, folders)]);
    const affectedDecks = decks.filter((deck) => folderIds.has(deck.folderId || null));
    const subfolderCount = folderIds.size - 1;
    const message = `Aplicar estas regras à pasta “${folder.name}”${subfolderCount ? `, a ${subfolderCount} ${subfolderCount === 1 ? "subpasta" : "subpastas"}` : ""} e a ${affectedDecks.length} ${affectedDecks.length === 1 ? "baralho" : "baralhos"}?\n\nOs ajustes de revisão atuais desses baralhos serão substituídos.`;
    if (!window.confirm(message)) return;
    for (const id of folderIds) await OituDB.updateFolder(id, { reviewSettings: cloneSettings(settings) });
    for (const deck of affectedDecks) await OituDB.updateDeck(deck.id, { reviewSettings: cloneSettings(settings) });
    closeModal("folderReviewModal");
    showToast("Ajustes de revisão aplicados à pasta.");
  }

  async function selectedEntities() {
    const [folders, decks] = await Promise.all([OituDB.getFolders(), OituDB.getDecks()]);
    const validFolders = new Set(folders.map((folder) => folder.id));
    const validDecks = new Set(decks.map((deck) => deck.id));
    const selectedFolderIds = new Set();
    const selectedDeckIds = new Set();
    for (const key of [...state.selected]) {
      const [type, id] = key.split(":");
      if (type === "folder" && validFolders.has(id)) selectedFolderIds.add(id);
      else if (type === "deck" && validDecks.has(id)) selectedDeckIds.add(id);
      else state.selected.delete(key);
    }
    return { folders, decks, selectedFolderIds, selectedDeckIds };
  }

  function normalizedEntitySelection(entities) {
    const { folders, decks } = entities;
    const folderIds = new Set(entities.selectedFolderIds || []);
    const topFolderIds = new Set([...folderIds].filter((folderId) => !ancestorFolderIds(folderId, folders).some((ancestor) => folderIds.has(ancestor))));
    const deckIds = new Set([...(entities.selectedDeckIds || [])].filter((deckId) => {
      const deck = decks.find((item) => item.id === deckId);
      if (!deck?.folderId) return true;
      return !ancestorFolderIds(deck.folderId, folders).concat(deck.folderId).some((folderId) => topFolderIds.has(folderId));
    }));
    return { folders, decks, selectedFolderIds: topFolderIds, selectedDeckIds: deckIds };
  }

  async function moveDeckWithInheritance(deckId, targetFolderId, folders) {
    const deck = await OituDB.getDeck(deckId);
    if (!deck) return;
    const patch = { folderId: targetFolderId || null };
    if (targetFolderId && !deckHasCustomSettings(deck)) {
      const inherited = nearestFolderSettings(targetFolderId, folders);
      if (inherited) patch.reviewSettings = cloneSettings(inherited);
    }
    await OituDB.updateDeck(deckId, patch);
  }

  function renderMoveTree(folders) {
    const invalid = new Set();
    for (const folderId of state.moveEntities?.selectedFolderIds || []) {
      invalid.add(folderId);
      descendantFolderIds(folderId, folders).forEach((id) => invalid.add(id));
    }
    const children = folderChildrenMap(folders);
    const rows = [`<label class="tree-destination-root"><input type="radio" name="enhMoveTarget" value="" checked><span class="folder-icon">📚</span><span>Sem pasta (raiz)</span></label>`];
    const renderFolder = (folder, depth) => {
      const kids = children.get(folder.id) || [];
      const expanded = state.moveExpanded.has(folder.id);
      const disabled = invalid.has(folder.id);
      rows.push(`<div class="tree-destination-row ${disabled ? "is-disabled" : ""}" style="--picker-depth:${depth}"><button type="button" class="tree-picker-toggle" data-enh-move-toggle="${folder.id}" ${kids.length ? "" : "disabled"}>${kids.length ? (expanded ? "▾" : "▸") : "·"}</button><label><input type="radio" name="enhMoveTarget" value="${folder.id}" ${disabled ? "disabled" : ""}><span class="folder-icon">${escapeHtml(folderEmoji(folder))}</span><span>${escapeHtml(folder.name)}</span></label></div>`);
      if (expanded) kids.forEach((child) => renderFolder(child, depth + 1));
    };
    (children.get(null) || []).forEach((folder) => renderFolder(folder, 0));
    return rows.join("");
  }

  async function openMoveTree(entities, title = "Mover para pasta") {
    const normalized = normalizedEntitySelection(entities);
    if (!normalized.selectedFolderIds.size && !normalized.selectedDeckIds.size) {
      alert("Selecione ao menos um baralho ou pasta.");
      return;
    }
    state.moveEntities = normalized;
    state.moveExpanded = new Set();
    $("#treeMoveTitle").textContent = title;
    $("#treeMoveChoices").innerHTML = renderMoveTree(normalized.folders);
    openModal("libraryTreeMoveModal");
  }

  async function confirmMoveTree() {
    if (!state.moveEntities) return;
    const target = document.querySelector('input[name="enhMoveTarget"]:checked')?.value || null;
    const folders = await OituDB.getFolders();
    for (const folderId of state.moveEntities.selectedFolderIds) await OituDB.updateFolder(folderId, { parentId: target || null });
    for (const deckId of state.moveEntities.selectedDeckIds) await moveDeckWithInheritance(deckId, target, folders);
    closeModal("libraryTreeMoveModal");
    state.moveEntities = null;
    state.selected.clear();
    $("#clearSelectionButton")?.click();
    await window.OituLibrary?.render?.();
    setTimeout(decorateFolders, 50);
    showToast("Itens movidos.");
  }

  function renderAddTree(folders, decks) {
    const target = state.addTargetFolderId;
    const children = folderChildrenMap(folders);
    const deckMap = decksByFolderMap(decks);
    const invalidFolders = new Set([target, ...ancestorFolderIds(target, folders)]);
    const rows = [];
    const renderDeck = (deck, depth) => {
      const already = (deck.folderId || null) === target;
      rows.push(`<label class="library-choice enhanced-tree-choice ${already ? "is-disabled" : ""}" style="--picker-depth:${depth}"><span class="picker-indent"></span><input type="checkbox" data-enh-add-deck="${deck.id}" ${already ? "disabled" : ""}><span><strong>${escapeHtml(deck.name)}</strong><small>${already ? "Já está nesta pasta" : "Baralho"}</small></span></label>`);
    };
    const renderFolder = (folder, depth) => {
      const expanded = state.addExpanded.has(folder.id);
      const kids = children.get(folder.id) || [];
      const folderDecks = deckMap.get(folder.id) || [];
      const disabled = invalidFolders.has(folder.id) || (folder.parentId || null) === target;
      rows.push(`<div class="enhanced-add-folder ${disabled ? "is-disabled" : ""}" style="--picker-depth:${depth}"><button type="button" class="tree-picker-toggle" data-enh-add-toggle="${folder.id}" ${(kids.length || folderDecks.length) ? "" : "disabled"}>${(kids.length || folderDecks.length) ? (expanded ? "▾" : "▸") : "·"}</button><label><input type="checkbox" data-enh-add-folder="${folder.id}" ${disabled ? "disabled" : ""}><span class="folder-icon">${escapeHtml(folderEmoji(folder))}</span><span><strong>${escapeHtml(folder.name)}</strong><small>${disabled ? (folder.id === target ? "Pasta de destino" : "Não pode ser movida para este local") : "Pasta"}</small></span></label></div>`);
      if (expanded) {
        kids.forEach((child) => renderFolder(child, depth + 1));
        folderDecks.forEach((deck) => renderDeck(deck, depth + 1));
      }
    };
    rows.push(`<div class="library-picker-folder library-picker-root"><span class="folder-chevron">▾</span><span class="folder-icon">📚</span><span>Sem pasta</span></div>`);
    (deckMap.get(null) || []).forEach((deck) => renderDeck(deck, 1));
    (children.get(null) || []).forEach((folder) => renderFolder(folder, 0));
    return rows.join("") || `<div class="library-empty">Nenhum item disponível.</div>`;
  }

  async function refreshAddTree() {
    const [folders, decks] = await Promise.all([OituDB.getFolders(), OituDB.getDecks()]);
    $("#treeAddChoices").innerHTML = renderAddTree(folders, decks);
  }

  async function openAddTree(folderId) {
    const [folder, folders] = await Promise.all([OituDB.getFolder(folderId), OituDB.getFolders()]);
    if (!folder) return;
    state.addTargetFolderId = folderId;
    state.addExpanded = new Set(ancestorFolderIds(folderId, folders));
    state.addExpanded.add(folderId);
    $("#treeAddTitle").textContent = `Adicionar itens a ${folderEmoji(folder)} ${folder.name}`;
    await refreshAddTree();
    openModal("libraryTreeAddModal");
  }

  async function confirmAddTree() {
    const target = state.addTargetFolderId;
    if (!target) return;
    const [folders, decks] = await Promise.all([OituDB.getFolders(), OituDB.getDecks()]);
    const selectedFolderIds = new Set([...document.querySelectorAll("#treeAddChoices [data-enh-add-folder]:checked")].map((input) => input.dataset.enhAddFolder));
    const selectedDeckIds = new Set([...document.querySelectorAll("#treeAddChoices [data-enh-add-deck]:checked")].map((input) => input.dataset.enhAddDeck));
    const normalized = normalizedEntitySelection({ folders, decks, selectedFolderIds, selectedDeckIds });
    if (!normalized.selectedFolderIds.size && !normalized.selectedDeckIds.size) {
      closeModal("libraryTreeAddModal");
      return;
    }
    for (const folderId of normalized.selectedFolderIds) await OituDB.updateFolder(folderId, { parentId: target });
    for (const deckId of normalized.selectedDeckIds) await moveDeckWithInheritance(deckId, target, folders);
    closeModal("libraryTreeAddModal");
    await window.OituLibrary?.render?.();
    setTimeout(decorateFolders, 50);
    showToast("Itens adicionados à pasta.");
  }

  function bindEvents() {
    document.addEventListener("change", (event) => {
      const deck = event.target.closest("[data-select-deck]");
      const folder = event.target.closest("[data-select-folder]");
      if (deck) {
        const key = `deck:${deck.dataset.selectDeck}`;
        if (deck.checked) state.selected.add(key); else state.selected.delete(key);
      }
      if (folder) {
        const key = `folder:${folder.dataset.selectFolder}`;
        if (folder.checked) state.selected.add(key); else state.selected.delete(key);
      }
    }, true);

    document.addEventListener("click", async (event) => {
      const editFolder = event.target.closest("[data-edit-folder]");
      const addExisting = event.target.closest("[data-add-existing-folder]");
      const moveSelected = event.target.closest("#moveSelectedButton");
      const moveDeck = event.target.closest("#moveDeckButton");
      const editDeck = event.target.closest('[data-action="edit-deck"]');
      if (editDeck && !editDeck.classList.contains("deck-name-button")) {
        const row = editDeck.closest("[data-deck-id]");
        if (row) state.editingDeckId = row.dataset.deckId;
      }
      if (editFolder) {
        event.preventDefault(); event.stopImmediatePropagation();
        openFolderEdit(editFolder.dataset.editFolder);
        return;
      }
      if (addExisting) {
        event.preventDefault(); event.stopImmediatePropagation();
        openAddTree(addExisting.dataset.addExistingFolder);
        return;
      }
      if (moveSelected) {
        event.preventDefault(); event.stopImmediatePropagation();
        const entities = await selectedEntities();
        openMoveTree(entities, "Mover selecionados");
        return;
      }
      if (moveDeck) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!state.editingDeckId) { alert("Abra um baralho pela opção de edição antes de movê-lo."); return; }
        const [folders, decks] = await Promise.all([OituDB.getFolders(), OituDB.getDecks()]);
        const deck = decks.find((item) => item.id === state.editingDeckId);
        if (!deck) return;
        openMoveTree({ folders, decks, selectedFolderIds: new Set(), selectedDeckIds: new Set([deck.id]) }, "Mover baralho para pasta");
        return;
      }
      if (event.target.closest("#clearSelectionButton") || event.target.closest("#homeButton")) state.selected.clear();
      if (event.target.closest("#deleteSelectedButton")) setTimeout(async () => { await selectedEntities(); }, 300);
    }, true);

    $("#folderEditForm").addEventListener("submit", saveFolderBasics);
    $("#folderEditEmoji").addEventListener("input", () => { $("#folderEmojiPreview").textContent = firstGrapheme($("#folderEditEmoji").value); });
    $("#folderReviewSettingsButton").addEventListener("click", async () => {
      const saved = await saveFolderBasics(null, { silent: true });
      if (!saved) return;
      closeModal("folderEditModal");
      await openFolderReview(state.editingFolderId);
    });
    $("#folderReviewForm").addEventListener("submit", applyFolderReview);
    $("#folderReviewRestore").addEventListener("click", () => fillFolderReviewForm(DEFAULT_REVIEW_SETTINGS));
    $("#treeMoveConfirm").addEventListener("click", confirmMoveTree);
    $("#treeAddConfirm").addEventListener("click", confirmAddTree);

    document.addEventListener("click", (event) => {
      const moveToggle = event.target.closest("[data-enh-move-toggle]");
      const addToggle = event.target.closest("[data-enh-add-toggle]");
      const close = event.target.closest("[data-enh-close]");
      if (moveToggle) {
        const id = moveToggle.dataset.enhMoveToggle;
        if (state.moveExpanded.has(id)) state.moveExpanded.delete(id); else state.moveExpanded.add(id);
        $("#treeMoveChoices").innerHTML = renderMoveTree(state.moveEntities?.folders || []);
      }
      if (addToggle) {
        const id = addToggle.dataset.enhAddToggle;
        if (state.addExpanded.has(id)) state.addExpanded.delete(id); else state.addExpanded.add(id);
        refreshAddTree();
      }
      if (close) closeModal(close.dataset.enhClose);
    });

    document.querySelectorAll("#folderEditModal,#folderReviewModal,#libraryTreeMoveModal,#libraryTreeAddModal").forEach((backdrop) => {
      backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop) closeModal(backdrop.id); });
    });
  }

  function initObserver() {
    const list = $("#deckList");
    if (!list) return;
    const observer = new MutationObserver(() => setTimeout(decorateFolders, 0));
    observer.observe(list, { childList: true });
    setTimeout(decorateFolders, 50);
  }

  function init() {
    ensureModals();
    bindEvents();
    initObserver();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
