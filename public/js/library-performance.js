(function () {
  const CACHE_TTL_MS = 30000;
  const DEFAULT_EMOJI = "📁";
  const EMOJI_CHOICES = ["📁", "📚", "🧠", "🩺", "🫀", "🧬", "💊", "🦴", "👁️", "🧪", "📖", "⭐", "🎯", "💡", "📝", "🎓"];
  const state = {
    pendingParentId: null,
    pendingFolderCreate: null,
    cardCache: null,
    cardCachePromise: null,
    cardIdToDeck: new Map(),
    cacheTimer: null
  };

  const $ = (selector) => document.querySelector(selector);

  function ensureStyles() {
    if (document.querySelector('link[data-oitucards-library-performance-css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/library-performance.css?v=20260823-1140";
    link.dataset.oitucardsLibraryPerformanceCss = "true";
    document.head.appendChild(link);
  }

  function cloneCard(card) {
    return card ? { ...card } : card;
  }

  function scheduleCacheExpiry() {
    clearTimeout(state.cacheTimer);
    state.cacheTimer = setTimeout(() => {
      state.cardCache = null;
      state.cardCachePromise = null;
      state.cardIdToDeck.clear();
    }, CACHE_TTL_MS);
  }

  async function readAllCardsOnce() {
    const db = await OituDB.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readonly");
      const req = tx.objectStore("cards").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function ensureCardCache() {
    if (state.cardCache) {
      scheduleCacheExpiry();
      return state.cardCache;
    }
    if (!state.cardCachePromise) {
      state.cardCachePromise = readAllCardsOnce().then((cards) => {
        const grouped = new Map();
        state.cardIdToDeck.clear();
        for (const card of cards) {
          const deckId = card.deckId;
          if (!grouped.has(deckId)) grouped.set(deckId, []);
          grouped.get(deckId).push(card);
          state.cardIdToDeck.set(card.id, deckId);
        }
        grouped.forEach((items) => items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
        state.cardCache = grouped;
        state.cardCachePromise = null;
        scheduleCacheExpiry();
        return grouped;
      }).catch((error) => {
        state.cardCachePromise = null;
        throw error;
      });
    }
    return state.cardCachePromise;
  }

  function patchDatabaseReads() {
    if (!window.OituDB || OituDB.__libraryPerformancePatched) return;
    OituDB.__libraryPerformancePatched = true;

    const originalGetCardsByDeck = OituDB.getCardsByDeck.bind(OituDB);
    const originalAddCard = OituDB.addCard.bind(OituDB);
    const originalUpdateCard = OituDB.updateCard.bind(OituDB);
    const originalDeleteCard = OituDB.deleteCard.bind(OituDB);
    const originalDeleteDeck = OituDB.deleteDeck.bind(OituDB);
    const originalAddFolder = OituDB.addFolder.bind(OituDB);

    OituDB.getCardsByDeck = async (deckId) => {
      try {
        const cache = await ensureCardCache();
        return (cache.get(deckId) || []).map(cloneCard);
      } catch (error) {
        console.warn("OituCards: cache da biblioteca indisponível; usando leitura normal.", error);
        return originalGetCardsByDeck(deckId);
      }
    };

    OituDB.addCard = async (...args) => {
      const card = await originalAddCard(...args);
      if (state.cardCache) {
        if (!state.cardCache.has(card.deckId)) state.cardCache.set(card.deckId, []);
        state.cardCache.get(card.deckId).push(card);
        state.cardIdToDeck.set(card.id, card.deckId);
        scheduleCacheExpiry();
      }
      return card;
    };

    OituDB.updateCard = async (id, patch) => {
      const updated = await originalUpdateCard(id, patch);
      if (state.cardCache) {
        const oldDeckId = state.cardIdToDeck.get(id);
        if (oldDeckId && oldDeckId !== updated.deckId) {
          const oldList = state.cardCache.get(oldDeckId) || [];
          state.cardCache.set(oldDeckId, oldList.filter((card) => card.id !== id));
        }
        const deckId = updated.deckId;
        const list = state.cardCache.get(deckId) || [];
        const index = list.findIndex((card) => card.id === id);
        if (index >= 0) list[index] = updated;
        else list.push(updated);
        state.cardCache.set(deckId, list);
        state.cardIdToDeck.set(id, deckId);
        scheduleCacheExpiry();
      }
      return updated;
    };

    OituDB.deleteCard = async (id) => {
      const deckId = state.cardIdToDeck.get(id);
      const result = await originalDeleteCard(id);
      if (state.cardCache && deckId) {
        const list = state.cardCache.get(deckId) || [];
        state.cardCache.set(deckId, list.filter((card) => card.id !== id));
        state.cardIdToDeck.delete(id);
        scheduleCacheExpiry();
      }
      return result;
    };

    OituDB.deleteDeck = async (deckId) => {
      const result = await originalDeleteDeck(deckId);
      if (state.cardCache) {
        for (const card of state.cardCache.get(deckId) || []) state.cardIdToDeck.delete(card.id);
        state.cardCache.delete(deckId);
        scheduleCacheExpiry();
      }
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

    ensureCardCache().catch(() => {});
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
