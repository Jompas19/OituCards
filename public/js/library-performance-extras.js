(function () {
  const DEFAULT_EMOJI = "📁";
  const EMOJI_CHOICES = ["📁", "📚", "🧠", "🩺", "🫀", "🧬", "💊", "🦴", "👁️", "🧪", "📖", "⭐", "🎯", "💡", "📝", "🎓"];
  const state = { pendingParentId: null, pendingFolderCreate: null, addFolderPatched: false };
  const $ = (selector) => document.querySelector(selector);

  function ensureStyles() {
    if (document.querySelector('link[data-oitucards-library-performance-css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/library-performance.css?v=20260823-1140";
    link.dataset.oitucardsLibraryPerformanceCss = "true";
    document.head.appendChild(link);
  }

  function patchFolderCreationOnly() {
    if (state.addFolderPatched || !window.OituDB?.addFolder) return;
    state.addFolderPatched = true;
    const originalAddFolder = OituDB.addFolder.bind(OituDB);
    OituDB.addFolder = async (...args) => {
      const [name, parentId = null] = args;
      const folder = await originalAddFolder(...args);
      const pending = state.pendingFolderCreate;
      const matches = pending && pending.expiresAt > Date.now() &&
        pending.name.toLocaleLowerCase() === String(name || "").trim().toLocaleLowerCase() &&
        (pending.parentId || null) === (parentId || null);
      if (!matches) return folder;
      state.pendingFolderCreate = null;
      return OituDB.updateFolder(folder.id, { emoji: pending.emoji });
    };
  }

  function emojiResult(value) {
    const text = String(value || "").trim();
    if (!text) return { valid: true, emoji: DEFAULT_EMOJI };
    let segments;
    try {
      segments = Intl?.Segmenter
        ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((item) => item.segment)
        : Array.from(text);
    } catch (_) { segments = Array.from(text); }
    if (segments.length !== 1) return { valid: false, emoji: null };
    const grapheme = segments[0];
    const valid = /\p{Extended_Pictographic}/u.test(grapheme) || /^(?:\p{Regional_Indicator}){2}$/u.test(grapheme) || /^[#*0-9]\uFE0F?\u20E3$/u.test(grapheme);
    return valid ? { valid: true, emoji: grapheme } : { valid: false, emoji: null };
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
      <div class="folder-emoji-presets" aria-label="Sugestões de emoji">${EMOJI_CHOICES.map((emoji) => `<button class="folder-emoji-choice" type="button" data-emoji-target="${targetId}" data-emoji-value="${emoji}" title="Usar ${emoji}">${emoji}</button>`).join("")}</div>
      <div class="folder-emoji-entry"><input id="${targetId}" class="text-input folder-emoji-only-input" maxlength="16" autocomplete="off" placeholder="Cole ou digite um emoji" aria-describedby="${targetId}Hint" /><span class="folder-create-emoji-preview" data-emoji-preview-for="${targetId}">${DEFAULT_EMOJI}</span></div>
      <p id="${targetId}Hint" class="field-hint">Escolha acima ou cole/digite um único emoji. Texto não é aceito.</p>
    </div>`;
  }

  function installCreateEmojiUI() {
    const form = $("#folderForm");
    if (!form || $("#folderCreateEmoji")) return;
    const actions = form.querySelector(".modal-actions");
    actions?.insertAdjacentHTML("beforebegin", emojiPickerMarkup("folderCreateEmoji"));
  }

  function installEditEmojiPresets() {
    const input = $("#folderEditEmoji");
    if (!input || document.querySelector('[data-edit-emoji-presets="true"]')) return;
    const row = input.closest(".folder-emoji-row");
    if (!row) return;
    const presets = document.createElement("div");
    presets.className = "folder-emoji-presets folder-edit-emoji-presets";
    presets.dataset.editEmojiPresets = "true";
    presets.innerHTML = EMOJI_CHOICES.map((emoji) => `<button class="folder-emoji-choice" type="button" data-emoji-target="folderEditEmoji" data-emoji-value="${emoji}" title="Usar ${emoji}">${emoji}</button>`).join("");
    row.before(presets);
  }

  function scheduleUi() { [0, 40, 120, 320, 800].forEach((delay) => setTimeout(() => { installCreateEmojiUI(); installEditEmojiPresets(); }, delay)); }
  function resetCreateEmoji() {
    const input = $("#folderCreateEmoji");
    if (!input) return;
    input.value = "";
    input.setCustomValidity("");
    const preview = document.querySelector('[data-emoji-preview-for="folderCreateEmoji"]');
    if (preview) preview.textContent = DEFAULT_EMOJI;
  }

  function init() {
    ensureStyles();
    patchFolderCreationOnly();
    scheduleUi();

    document.addEventListener("click", (event) => {
      const root = event.target.closest("#createFolderButton");
      const sub = event.target.closest("[data-create-subfolder]");
      if (root || sub) {
        installCreateEmojiUI();
        state.pendingParentId = sub?.dataset.createSubfolder || null;
        resetCreateEmoji();
      }
      if (event.target.closest("[data-edit-folder]")) setTimeout(installEditEmojiPresets, 0);
      const choice = event.target.closest("[data-emoji-target][data-emoji-value]");
      if (choice) {
        const input = document.getElementById(choice.dataset.emojiTarget);
        if (!input) return;
        input.value = choice.dataset.emojiValue;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, true);

    document.addEventListener("input", (event) => {
      const input = event.target.closest("#folderCreateEmoji,#folderEditEmoji");
      if (!input) return;
      const preview = input.id === "folderCreateEmoji" ? document.querySelector('[data-emoji-preview-for="folderCreateEmoji"]') : $("#folderEmojiPreview");
      setEmojiValidity(input, preview);
    });

    document.addEventListener("submit", (event) => {
      if (event.target?.id === "folderForm") {
        installCreateEmojiUI();
        const input = $("#folderCreateEmoji");
        if (!setEmojiValidity(input, document.querySelector('[data-emoji-preview-for="folderCreateEmoji"]'))) {
          event.preventDefault(); event.stopImmediatePropagation(); input?.reportValidity(); return;
        }
        const result = emojiResult(input?.value);
        state.pendingFolderCreate = {
          name: $("#folderNameInput")?.value.trim() || "",
          parentId: state.pendingParentId || null,
          emoji: result.emoji || DEFAULT_EMOJI,
          expiresAt: Date.now() + 5000
        };
      }
      if (event.target?.id === "folderEditForm") {
        const input = $("#folderEditEmoji");
        if (!setEmojiValidity(input, $("#folderEmojiPreview"))) {
          event.preventDefault(); event.stopImmediatePropagation(); input?.reportValidity();
        }
      }
    }, true);
  }

  patchFolderCreationOnly();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();