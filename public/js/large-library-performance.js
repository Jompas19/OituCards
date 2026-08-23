(function () {
  const DEFAULT_EMOJI = "📁";
  const EMOJI_CHOICES = ["📁", "📚", "🧠", "🩺", "🫀", "🧬", "💊", "🦴", "👁️", "🧪", "📖", "⭐", "🎯", "💡", "📝", "🎓"];
  const LARGE_DECK_THRESHOLD = 1500;
  const EDITOR_PAGE_SIZE = 200;
  const EDITOR_PAGING_THRESHOLD = 1000;
  const FULL_READ_TIMEOUT_MS = 10 * 60 * 1000;

  const state = {
    pendingParentId: null,
    pendingFolderCreate: null,
    countCache: new Map(),
    summaryCache: new Map(),
    summaryPromises: new Map(),
    placeholderCache: new Map(),
    editorLimits: new Map(),
    editorInfo: null,
    fullReadDepth: 0,
    forceFullReads: false,
    forceFullTimer: null,
    refreshTimer: null
  };

  const $ = (selector) => document.querySelector(selector);

  function ensureStyles() {
    if (document.querySelector('link[data-oitucards-library-performance-css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/large-library-performance.css?v=20260823-1738";
    link.dataset.oitucardsLibraryPerformanceCss = "true";
    document.head.appendChild(link);
  }

  async function directDb() {
    return OituDB.openDB();
  }

  async function countCards(deckId) {
    if (state.countCache.has(deckId)) return state.countCache.get(deckId);
    const db = await directDb();
    const count = await new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readonly");
      const req = tx.objectStore("cards").index("deckId").count(IDBKeyRange.only(deckId));
      req.onsuccess = () => resolve(Number(req.result || 0));
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
    state.countCache.set(deckId, count);
    return count;
  }

  function lightCard(card) {
    return {
      id: card.id,
      deckId: card.deckId,
      reviewStatus: card.reviewStatus || null,
      reviewCount: Number.isInteger(card.reviewCount) ? card.reviewCount : undefined,
      lastReviewedAt: card.lastReviewedAt || null,
      nextReviewAt: card.nextReviewAt || null,
      lastRating: card.lastRating || null,
      createdAt: card.createdAt || null
    };
  }

  async function readLightCards(deckId) {
    const db = await directDb();
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = db.transaction("cards", "readonly");
      const req = tx.objectStore("cards").index("deckId").openCursor(IDBKeyRange.only(deckId));
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          out.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
          resolve(out);
          return;
        }
        out.push(lightCard(cursor.value));
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  function placeholderCards(deckId, count) {
    const cached = state.placeholderCache.get(deckId);
    if (cached?.length === count) return cached;
    const newCard = Object.freeze({
      deckId,
      reviewStatus: null,
      reviewCount: 0,
      lastReviewedAt: null,
      nextReviewAt: null,
      lastRating: null
    });
    const cards = new Array(count).fill(newCard);
    state.placeholderCache.set(deckId, cards);
    return cards;
  }

  function queueLibraryRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (!$("#homeView")?.classList.contains("active")) return;
      Promise.resolve(window.OituLibrary?.render?.()).catch((error) => console.error(error));
    }, 80);
  }

  function queueSummaryScan(deckId) {
    if (state.summaryCache.has(deckId) || state.summaryPromises.has(deckId)) return;

    const run = () => {
      const promise = readLightCards(deckId)
        .then((cards) => {
          state.summaryCache.set(deckId, cards);
          state.countCache.set(deckId, cards.length);
          state.placeholderCache.delete(deckId);
          queueLibraryRefresh();
          return cards;
        })
        .catch((error) => {
          console.warn("OituCards: não foi possível calcular o resumo leve do baralho.", error);
          return null;
        })
        .finally(() => state.summaryPromises.delete(deckId));
      state.summaryPromises.set(deckId, promise);
    };

    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1200 });
    else setTimeout(run, 120);
  }

  async function summaryCards(deckId) {
    const cached = state.summaryCache.get(deckId);
    if (cached) return cached.slice();

    const count = await countCards(deckId);
    if (count <= LARGE_DECK_THRESHOLD) {
      const cards = await readLightCards(deckId);
      state.summaryCache.set(deckId, cards);
      return cards.slice();
    }

    queueSummaryScan(deckId);
    return placeholderCards(deckId, count).slice();
  }

  async function readEditorPage(deckId, limit) {
    const db = await directDb();
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = db.transaction("cards", "readonly");
      const index = tx.objectStore("cards").index("createdAt");
      const req = index.openCursor();
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor || out.length >= limit) {
          resolve(out);
          return;
        }
        if (cursor.value?.deckId === deckId) out.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  function shouldUseSummaryRead() {
    return state.fullReadDepth === 0 && !state.forceFullReads && $("#homeView")?.classList.contains("active");
  }

  function shouldUseEditorPage() {
    return state.fullReadDepth === 0 && !state.forceFullReads && $("#deckView")?.classList.contains("active");
  }

  function decorateLargeDeckEditor() {
    const info = state.editorInfo;
    const view = $("#deckView");
    if (!info || !view?.classList.contains("active")) {
      $("#largeDeckPager")?.remove();
      return;
    }

    const meta = $("#deckMeta");
    if (meta) {
      meta.textContent = `${info.total.toLocaleString("pt-BR")} flashcards · ${info.shown.toLocaleString("pt-BR")} carregados`;
    }

    let pager = $("#largeDeckPager");
    if (!pager) {
      pager = document.createElement("div");
      pager.id = "largeDeckPager";
      pager.className = "large-deck-pager";
      $("#cardList")?.insertAdjacentElement("afterend", pager);
    }

    const query = $("#cardSearchInput")?.value.trim();
    const remaining = Math.max(0, info.total - info.shown);
    pager.innerHTML = `
      <div>
        <strong>Baralho grande</strong>
        <span>${query ? `A pesquisa considera os ${info.shown.toLocaleString("pt-BR")} cards já carregados.` : `Exibindo ${info.shown.toLocaleString("pt-BR")} de ${info.total.toLocaleString("pt-BR")} cards para manter o editor rápido.`}</span>
      </div>
      ${remaining ? `<button id="loadMoreLargeDeckCards" class="button secondary" type="button">Carregar +${Math.min(EDITOR_PAGE_SIZE, remaining).toLocaleString("pt-BR")}</button>` : ""}`;
  }

  function scheduleEditorDecoration() {
    requestAnimationFrame(() => requestAnimationFrame(decorateLargeDeckEditor));
  }

  function invalidateDeck(deckId, countChanged = false) {
    if (!deckId) return;
    state.summaryCache.delete(deckId);
    state.placeholderCache.delete(deckId);
    if (countChanged) state.countCache.delete(deckId);
  }

  function wrapFullReadApi(api) {
    if (!api || typeof api.openConfig !== "function" || api.openConfig.__oitucardsLargeDeckWrapped) return;
    const original = api.openConfig;
    const wrapped = async function (...args) {
      state.fullReadDepth += 1;
      try {
        return await original.apply(this, args);
      } finally {
        state.fullReadDepth = Math.max(0, state.fullReadDepth - 1);
      }
    };
    Object.defineProperty(wrapped, "__oitucardsLargeDeckWrapped", { value: true });
    api.openConfig = wrapped;
  }

  function beginTemporaryFullReads(button) {
    state.forceFullReads = true;
    clearTimeout(state.forceFullTimer);
    state.forceFullTimer = setTimeout(() => { state.forceFullReads = false; }, FULL_READ_TIMEOUT_MS);
    if (!button) return;
    let sawDisabled = button.disabled;
    const observer = new MutationObserver(() => {
      if (button.disabled) {
        sawDisabled = true;
        return;
      }
      if (!sawDisabled) return;
      observer.disconnect();
      state.forceFullReads = false;
      clearTimeout(state.forceFullTimer);
    });
    observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
  }

  function patchDatabaseReads() {
    if (!window.OituDB || OituDB.__libraryPerformancePatched) return;
    OituDB.__libraryPerformancePatched = true;

    const originalGetCardsByDeck = OituDB.getCardsByDeck.bind(OituDB);
    const originalGetCard = OituDB.getCard.bind(OituDB);
    const originalAddCard = OituDB.addCard.bind(OituDB);
    const originalUpdateCard = OituDB.updateCard.bind(OituDB);
    const originalDeleteCard = OituDB.deleteCard.bind(OituDB);
    const originalDeleteDeck = OituDB.deleteDeck.bind(OituDB);
    const originalAddFolder = OituDB.addFolder.bind(OituDB);

    OituDB.getCardsByDeck = async (deckId) => {
      if (shouldUseSummaryRead()) return summaryCards(deckId);

      if (shouldUseEditorPage()) {
        const total = await countCards(deckId);
        if (total > EDITOR_PAGING_THRESHOLD) {
          const limit = Math.min(total, state.editorLimits.get(deckId) || EDITOR_PAGE_SIZE);
          const cards = await readEditorPage(deckId, limit);
          state.editorInfo = { deckId, total, shown: cards.length };
          scheduleEditorDecoration();
          return cards;
        }
        state.editorInfo = null;
        $("#largeDeckPager")?.remove();
      }

      return originalGetCardsByDeck(deckId);
    };

    OituDB.addCard = async (...args) => {
      const card = await originalAddCard(...args);
      invalidateDeck(card.deckId, true);
      return card;
    };

    OituDB.updateCard = async (id, patch) => {
      const updated = await originalUpdateCard(id, patch);
      invalidateDeck(updated.deckId, false);
      return updated;
    };

    OituDB.deleteCard = async (id) => {
      const current = await originalGetCard(id);
      const result = await originalDeleteCard(id);
      if (current?.deckId) invalidateDeck(current.deckId, true);
      return result;
    };

    OituDB.deleteDeck = async (deckId) => {
      const result = await originalDeleteDeck(deckId);
      state.countCache.delete(deckId);
      state.summaryCache.delete(deckId);
      state.placeholderCache.delete(deckId);
      state.editorLimits.delete(deckId);
      return result;
    };

    OituDB.addFolder = async (...args) => {
      const [name, parentId = null] = args;
      const folder = await originalAddFolder(...args);
      const pending = state.pendingFolderCreate;
      const matches = pending &&
        pending.expiresAt > Date.now() &&
        pending.name.toLocaleLowerCase() === String(name || "").trim().toLocaleLowerCase() &&
        (pending.parentId || null) === (parentId || null);
      if (!matches) return folder;
      state.pendingFolderCreate = null;
      return OituDB.updateFolder(folder.id, { emoji: pending.emoji });
    };

    OituDB.getCardCountByDeck = countCards;
    OituDB.__largeDeckPerformance = {
      threshold: LARGE_DECK_THRESHOLD,
      editorPageSize: EDITOR_PAGE_SIZE,
      invalidateDeck,
      beginTemporaryFullReads
    };

    wrapFullReadApi(window.OituStudy);
    wrapFullReadApi(window.OituMultiStudy);
  }

  function emojiResult(value) {
    const text = String(value || "").trim();
    if (!text) return { valid: true, emoji: DEFAULT_EMOJI };
    let segments;
    try {
      if (Intl?.Segmenter) {
        segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((item) => item.segment);
      } else {
        segments = Array.from(text);
      }
    } catch (_) {
      segments = Array.from(text);
    }
    if (segments.length !== 1) return { valid: false, emoji: null };
    const grapheme = segments[0];
    const pictographic = /\p{Extended_Pictographic}/u.test(grapheme);
    const flag = /^(?:\p{Regional_Indicator}){2}$/u.test(grapheme);
    const keycap = /^[#*0-9]\uFE0F?\u20E3$/u.test(grapheme);
    if (!pictographic && !flag && !keycap) return { valid: false, emoji: null };
    return { valid: true, emoji: grapheme };
  }

  function setEmojiValidity(input, preview) {
    if (!input) return true;
    const result = emojiResult(input.value);
    input.setCustomValidity(result.valid ? "" : "Use apenas um emoji. Letras, palavras e frases não são aceitas.");
    if (preview) preview.textContent = result.valid ? result.emoji : "⚠️";
    return result.valid;
  }

  function emojiPickerMarkup(targetId) {
    return `<div class="folder-create-emoji-block" data-emoji-picker-for="${targetId}">
      <label class="field-label" for="${targetId}">Emoji da pasta</label>
      <div class="folder-emoji-presets" aria-label="Sugestões de emoji">
        ${EMOJI_CHOICES.map((emoji) => `<button class="folder-emoji-choice" type="button" data-emoji-target="${targetId}" data-emoji-value="${emoji}" title="Usar ${emoji}">${emoji}</button>`).join("")}
      </div>
      <div class="folder-emoji-entry">
        <input id="${targetId}" class="text-input folder-emoji-only-input" maxlength="16" autocomplete="off" placeholder="Cole ou digite um emoji" aria-describedby="${targetId}Hint" />
        <span class="folder-create-emoji-preview" data-emoji-preview-for="${targetId}">${DEFAULT_EMOJI}</span>
      </div>
      <p id="${targetId}Hint" class="field-hint">Escolha acima ou cole/digite um único emoji. Texto não é aceito.</p>
    </div>`;
  }

  function installCreateEmojiUI() {
    const form = $("#folderForm");
    if (!form || $("#folderCreateEmoji")) return false;
    const actions = form.querySelector(".modal-actions");
    if (!actions) return false;
    actions.insertAdjacentHTML("beforebegin", emojiPickerMarkup("folderCreateEmoji"));
    return true;
  }

  function installEditEmojiPresets() {
    const input = $("#folderEditEmoji");
    if (!input || document.querySelector('[data-edit-emoji-presets="true"]')) return false;
    const row = input.closest(".folder-emoji-row");
    if (!row) return false;
    const presets = document.createElement("div");
    presets.className = "folder-emoji-presets folder-edit-emoji-presets";
    presets.dataset.editEmojiPresets = "true";
    presets.innerHTML = EMOJI_CHOICES.map((emoji) => `<button class="folder-emoji-choice" type="button" data-emoji-target="folderEditEmoji" data-emoji-value="${emoji}" title="Usar ${emoji}">${emoji}</button>`).join("");
    row.before(presets);
    const hint = row.parentElement?.querySelector(".field-hint");
    if (hint) hint.textContent = "Escolha acima ou cole/digite um único emoji. Texto não é aceito.";
    return true;
  }

  function resetCreateEmoji() {
    const input = $("#folderCreateEmoji");
    if (!input) return;
    input.value = "";
    input.setCustomValidity("");
    const preview = document.querySelector('[data-emoji-preview-for="folderCreateEmoji"]');
    if (preview) preview.textContent = DEFAULT_EMOJI;
  }

  function prepareFolderCreate(parentId) {
    state.pendingParentId = parentId || null;
    installCreateEmojiUI();
    resetCreateEmoji();
  }

  function installEmojiBehavior() {
    document.addEventListener("click", (event) => {
      const rootCreate = event.target.closest("#createFolderButton");
      const subCreate = event.target.closest("[data-create-subfolder]");
      if (rootCreate) prepareFolderCreate(null);
      if (subCreate) prepareFolderCreate(subCreate.dataset.createSubfolder);

      const choice = event.target.closest("[data-emoji-target][data-emoji-value]");
      if (choice) {
        const input = document.getElementById(choice.dataset.emojiTarget);
        if (!input) return;
        input.value = choice.dataset.emojiValue;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }

      const exportButton = event.target.closest("#exportSelectedButton,#deckExportButton");
      if (exportButton) beginTemporaryFullReads(exportButton);

      const more = event.target.closest("#loadMoreLargeDeckCards");
      if (more && state.editorInfo) {
        const { deckId, total } = state.editorInfo;
        const current = state.editorLimits.get(deckId) || EDITOR_PAGE_SIZE;
        state.editorLimits.set(deckId, Math.min(total, current + EDITOR_PAGE_SIZE));
        $("#cardSearchInput")?.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, true);

    document.addEventListener("input", (event) => {
      const input = event.target.closest("#folderCreateEmoji,#folderEditEmoji");
      if (!input) return;
      const preview = input.id === "folderCreateEmoji"
        ? document.querySelector('[data-emoji-preview-for="folderCreateEmoji"]')
        : $("#folderEmojiPreview");
      setEmojiValidity(input, preview);
    });

    document.addEventListener("submit", (event) => {
      if (event.target?.id === "folderForm") {
        installCreateEmojiUI();
        const input = $("#folderCreateEmoji");
        const preview = document.querySelector('[data-emoji-preview-for="folderCreateEmoji"]');
        if (!setEmojiValidity(input, preview)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          input?.reportValidity();
          return;
        }
        const name = $("#folderNameInput")?.value.trim() || "";
        const result = emojiResult(input?.value);
        state.pendingFolderCreate = {
          name,
          parentId: state.pendingParentId || null,
          emoji: result.emoji || DEFAULT_EMOJI,
          expiresAt: Date.now() + 5000
        };
      }

      if (event.target?.id === "folderEditForm") {
        const input = $("#folderEditEmoji");
        if (!setEmojiValidity(input, $("#folderEmojiPreview"))) {
          event.preventDefault();
          event.stopImmediatePropagation();
          input?.reportValidity();
        }
      }
    }, true);
  }

  function showHomeWithoutFlatRender(event) {
    const deckView = $("#deckView");
    if (!deckView?.classList.contains("active")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.editorInfo = null;
    $("#largeDeckPager")?.remove();
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    $("#homeView")?.classList.add("active");
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => {
      Promise.resolve(window.OituLibrary?.render?.()).catch((error) => console.error(error));
    });
  }

  function installFastReturnToLibrary() {
    $("#backHomeButton")?.addEventListener("click", showHomeWithoutFlatRender, true);
    $("#homeButton")?.addEventListener("click", showHomeWithoutFlatRender, true);
  }

  function observeDynamicFolderUI() {
    const observer = new MutationObserver(() => {
      installCreateEmojiUI();
      installEditEmojiPresets();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    installCreateEmojiUI();
    installEditEmojiPresets();
  }

  function initDom() {
    ensureStyles();
    installEmojiBehavior();
    installFastReturnToLibrary();
    observeDynamicFolderUI();
  }

  patchDatabaseReads();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initDom, { once: true });
  else initDom();
})();
