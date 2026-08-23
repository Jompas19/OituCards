(function () {
  const MARKER_RE = /<!--oitucards-card:([^:>]+):([01])-->/g;
  const COLOR_VALUES = ["#000000", "#ffffff", "#2563eb", "#16a34a", "#facc15", "#ec4899", "#dc2626"];
  const presenceOverrides = new Map();
  let openingDepth = 0;
  let savedRange = null;
  let editingCardId = null;
  let viewerCardId = null;
  let bodyOverflowBeforeEditor = "";
  let syncFrame = 0;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function hasAnnotationHtml(html) {
    if (!html) return false;
    const template = document.createElement("template");
    template.innerHTML = String(html);
    const text = (template.content.textContent || "").replace(/\u200B/g, "").trim();
    return Boolean(text || template.content.querySelector("img"));
  }

  function stripStudyMarker(html) {
    return String(html || "").replace(MARKER_RE, "");
  }

  function makeStudyMarker(cardId, hasNote) {
    return `<!--oitucards-card:${encodeURIComponent(String(cardId))}:${hasNote ? "1" : "0"}-->`;
  }

  function shouldTagStudyCards() {
    if (openingDepth > 0) return true;
    return Boolean(document.querySelector(
      "#studyConfigView.active,#studyView.active,#multiStudyConfigView.active,#multiStudyView.active"
    ));
  }

  function notePresenceForCard(card) {
    if (presenceOverrides.has(card.id)) return presenceOverrides.get(card.id);
    return hasAnnotationHtml(card.annotationHtml);
  }

  function activeContext() {
    if ($("#studyView")?.classList.contains("active")) {
      return {
        key: "study",
        view: $("#studyView"),
        card: $("#studyCard"),
        front: $("#studyFront"),
        back: $("#studyBackSection"),
        actions: $('[data-annotation-context="study"]')
      };
    }
    if ($("#multiStudyView")?.classList.contains("active")) {
      return {
        key: "multi",
        view: $("#multiStudyView"),
        card: $("#multiCard"),
        front: $("#multiFront"),
        back: $("#multiBackSection"),
        actions: $('[data-annotation-context="multi"]')
      };
    }
    return null;
  }

  function markerMeta(frontElement) {
    if (!frontElement) return null;
    const match = String(frontElement.innerHTML || "").match(/<!--oitucards-card:([^:>]+):([01])-->/);
    if (!match) return null;
    try {
      const id = decodeURIComponent(match[1]);
      return {
        id,
        hasNote: presenceOverrides.has(id) ? presenceOverrides.get(id) : match[2] === "1"
      };
    } catch (_) {
      return null;
    }
  }

  function currentCardId() {
    return markerMeta(activeContext()?.front)?.id || null;
  }

  function scheduleSync(delay = 0) {
    if (delay > 0) {
      window.setTimeout(() => scheduleSync(), delay);
      return;
    }
    if (syncFrame) cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => {
      syncFrame = 0;
      syncStudyActions();
    });
  }

  function patchDatabase() {
    if (!window.OituDB) return;

    const getCards = OituDB.getCardsByDeck;
    if (typeof getCards === "function" && !getCards.__oitucardsAnnotationsWrapped) {
      const wrappedGetCards = async function (...args) {
        const cards = await getCards.apply(this, args);
        if (!shouldTagStudyCards()) return cards;
        return (cards || []).map((card) => ({
          ...card,
          frontHtml: makeStudyMarker(card.id, notePresenceForCard(card)) + stripStudyMarker(card.frontHtml)
        }));
      };
      Object.defineProperty(wrappedGetCards, "__oitucardsAnnotationsWrapped", { value: true });
      OituDB.getCardsByDeck = wrappedGetCards;
    }

    const updateCard = OituDB.updateCard;
    if (typeof updateCard === "function" && !updateCard.__oitucardsAnnotationsWrapped) {
      const wrappedUpdateCard = async function (cardId, patch) {
        let dbPatch = patch;
        const visibleId = currentCardId();

        if (
          visibleId === cardId &&
          patch &&
          typeof patch === "object" &&
          typeof patch.frontHtml === "string" &&
          shouldTagStudyCards()
        ) {
          const cleanFront = stripStudyMarker(patch.frontHtml);
          const meta = markerMeta(activeContext()?.front);
          const hasNote = presenceOverrides.has(cardId)
            ? presenceOverrides.get(cardId)
            : Boolean(meta?.hasNote);

          dbPatch = { ...patch, frontHtml: cleanFront };
          // O núcleo do estudo reutiliza o mesmo objeto patch na memória. Mantemos o marcador
          // somente nessa cópia de sessão e salvamos o HTML limpo no IndexedDB.
          patch.frontHtml = makeStudyMarker(cardId, hasNote) + cleanFront;
        }

        const result = await updateCard.call(this, cardId, dbPatch);
        if ($("#studyView")?.classList.contains("active") || $("#multiStudyView")?.classList.contains("active")) {
          scheduleSync();
        }
        return result;
      };
      Object.defineProperty(wrappedUpdateCard, "__oitucardsAnnotationsWrapped", { value: true });
      OituDB.updateCard = wrappedUpdateCard;
    }
  }

  function wrapStudyApi(api, key) {
    if (!api || typeof api.openConfig !== "function" || api.openConfig.__oitucardsAnnotationsWrapped) return;
    const original = api.openConfig;
    const wrapped = async function (...args) {
      openingDepth += 1;
      patchDatabase();
      try {
        return await original.apply(this, args);
      } finally {
        openingDepth = Math.max(0, openingDepth - 1);
        scheduleSync();
      }
    };
    Object.defineProperty(wrapped, "__oitucardsAnnotationsWrapped", { value: true });
    Object.defineProperty(wrapped, "__oitucardsAnnotationsApi", { value: key });
    api.openConfig = wrapped;
  }

  function ensureStyles() {
    if ($('link[data-oitucards-study-annotations-css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/study-annotations.css?v=20260823-1648";
    link.dataset.oitucardsStudyAnnotationsCss = "true";
    document.head.appendChild(link);
  }

  function actionBarMarkup(context) {
    return `
      <div class="study-annotation-actions" data-annotation-context="${context}" aria-hidden="true">
        <button class="study-annotation-button annotation-edit-button" type="button">＋ Adicionar anotação</button>
        <button class="study-annotation-button annotation-view-button is-hidden" type="button">Ver anotação</button>
      </div>`;
  }

  function paletteMarkup(command, label) {
    return `
      <div class="annotation-color-control" data-annotation-color="${command}">
        <button class="annotation-tool-button annotation-color-toggle" type="button">${label}</button>
        <div class="annotation-color-palette hidden">
          ${COLOR_VALUES.map((color) => `<button class="annotation-color-dot" type="button" data-color="${color}" aria-label="${label} ${color}"></button>`).join("")}
        </div>
      </div>`;
  }

  function editorMarkup() {
    return `
      <div id="annotationEditorBackdrop" class="annotation-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="annotationEditorTitle">
        <section class="annotation-editor-panel">
          <header class="annotation-editor-header">
            <h2 id="annotationEditorTitle">Anotação do flashcard</h2>
            <button class="annotation-editor-close" type="button" aria-label="Fechar">×</button>
          </header>
          <div id="annotationToolbar" class="annotation-toolbar">
            <button class="annotation-tool-button" type="button" data-annotation-cmd="bold"><strong>B</strong></button>
            <button class="annotation-tool-button" type="button" data-annotation-cmd="italic"><em>I</em></button>
            <button class="annotation-tool-button" type="button" data-annotation-cmd="underline"><u>U</u></button>
            <button class="annotation-tool-button" type="button" data-annotation-cmd="insertUnorderedList">• Lista</button>
            <button class="annotation-tool-button" type="button" data-annotation-cmd="insertOrderedList">1. Lista</button>
            ${paletteMarkup("foreColor", "Texto")}
            ${paletteMarkup("hiliteColor", "Fundo")}
            <button class="annotation-tool-button annotation-image-button" type="button">🖼 Imagem</button>
            <input id="annotationImageInput" class="hidden" type="file" accept="image/*" />
          </div>
          <div class="annotation-editor-body">
            <div id="annotationRichEditor" class="annotation-rich-editor" contenteditable="true" spellcheck="true"></div>
          </div>
          <footer class="annotation-editor-actions">
            <span id="annotationEditorStatus" class="annotation-editor-status" aria-live="polite"></span>
            <button class="button ghost annotation-cancel-button" type="button">Cancelar</button>
            <button class="button primary annotation-save-button" type="button">Salvar anotação</button>
          </footer>
        </section>
      </div>`;
  }

  function viewerMarkup() {
    return `
      <aside id="annotationViewer" class="annotation-viewer hidden" aria-label="Anotação do flashcard">
        <header class="annotation-viewer-header">
          <strong>Anotação</strong>
          <div class="annotation-viewer-header-actions">
            <button class="annotation-viewer-edit" type="button">Editar</button>
            <button class="annotation-viewer-close" type="button" aria-label="Fechar anotação">×</button>
          </div>
        </header>
        <div id="annotationViewerContent" class="annotation-viewer-content"></div>
      </aside>`;
  }

  function ensureUI() {
    ensureStyles();

    const studyCard = $("#studyCard");
    if (studyCard && !$('[data-annotation-context="study"]')) {
      studyCard.insertAdjacentHTML("beforebegin", actionBarMarkup("study"));
    }

    const multiCard = $("#multiCard");
    if (multiCard && !$('[data-annotation-context="multi"]')) {
      multiCard.insertAdjacentHTML("beforebegin", actionBarMarkup("multi"));
    }

    if (!$("#annotationEditorBackdrop")) document.body.insertAdjacentHTML("beforeend", editorMarkup());
    if (!$("#annotationViewer")) document.body.insertAdjacentHTML("beforeend", viewerMarkup());
  }

  function hideActionBars() {
    $$(".study-annotation-actions").forEach((bar) => {
      bar.classList.remove("is-visible");
      bar.setAttribute("aria-hidden", "true");
    });
  }

  function closeViewer() {
    const viewer = $("#annotationViewer");
    viewer?.classList.add("hidden");
    viewerCardId = null;
  }

  function syncStudyActions() {
    ensureUI();
    const context = activeContext();
    if (!context?.actions || !context.back || context.back.classList.contains("hidden")) {
      hideActionBars();
      closeViewer();
      return;
    }

    const meta = markerMeta(context.front);
    if (!meta?.id) {
      hideActionBars();
      closeViewer();
      return;
    }

    $$(".study-annotation-actions").forEach((bar) => {
      const active = bar === context.actions;
      bar.classList.toggle("is-visible", active);
      bar.setAttribute("aria-hidden", String(!active));
    });

    const hasNote = presenceOverrides.has(meta.id) ? presenceOverrides.get(meta.id) : meta.hasNote;
    context.actions.dataset.cardId = meta.id;
    context.actions.dataset.hasNote = String(hasNote);

    const editButton = $(".annotation-edit-button", context.actions);
    const viewButton = $(".annotation-view-button", context.actions);
    if (editButton) editButton.textContent = hasNote ? "✎ Editar anotação" : "＋ Adicionar anotação";
    viewButton?.classList.toggle("is-hidden", !hasNote);

    if (viewerCardId && viewerCardId !== meta.id) closeViewer();
  }

  function saveSelection() {
    const editor = $("#annotationRichEditor");
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) savedRange = range.cloneRange();
  }

  function restoreSelection() {
    const editor = $("#annotationRichEditor");
    if (!editor) return;
    editor.focus();
    if (!savedRange) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedRange);
  }

  function applyCommand(command, value = null) {
    restoreSelection();
    document.execCommand("styleWithCSS", false, true);
    if (command === "hiliteColor") {
      const ok = document.execCommand("hiliteColor", false, value);
      if (!ok) document.execCommand("backColor", false, value);
    } else {
      document.execCommand(command, false, value);
    }
    saveSelection();
  }

  function insertImage(dataUrl, altText = "Imagem da anotação") {
    const editor = $("#annotationRichEditor");
    if (!editor) return;
    restoreSelection();
    const selection = window.getSelection();
    let range;
    if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    const image = document.createElement("img");
    image.src = dataUrl;
    image.alt = altText;
    image.loading = "lazy";
    range.deleteContents();
    range.insertNode(image);

    const after = document.createRange();
    after.setStartAfter(image);
    after.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(after);
    saveSelection();
  }

  function closePalettes(except = null) {
    $$(".annotation-color-palette").forEach((palette) => {
      if (palette !== except) palette.classList.add("hidden");
    });
  }

  async function openEditorForCard(cardId) {
    if (!cardId) return;
    const card = await OituDB.getCard(cardId);
    if (!card) return;

    editingCardId = cardId;
    savedRange = null;
    $("#annotationRichEditor").innerHTML = card.annotationHtml || "";
    $("#annotationEditorStatus").textContent = "";
    closePalettes();
    closeViewer();

    bodyOverflowBeforeEditor = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    $("#annotationEditorBackdrop").classList.remove("hidden");
    requestAnimationFrame(() => $("#annotationRichEditor")?.focus());
  }

  function closeEditor() {
    $("#annotationEditorBackdrop")?.classList.add("hidden");
    $("#annotationEditorStatus").textContent = "";
    $("#annotationRichEditor").innerHTML = "";
    savedRange = null;
    editingCardId = null;
    closePalettes();
    document.body.style.overflow = bodyOverflowBeforeEditor;
    scheduleSync();
  }

  async function saveAnnotation() {
    if (!editingCardId) return;
    const editor = $("#annotationRichEditor");
    const status = $("#annotationEditorStatus");
    if (!editor) return;

    if (!window.OituEditor?.hasContent(editor)) {
      if (status) status.textContent = "Escreva uma anotação antes de salvar.";
      editor.focus();
      return;
    }

    const html = window.OituEditor?.sanitizeHtml
      ? OituEditor.sanitizeHtml(editor.innerHTML)
      : editor.innerHTML.trim();

    if (status) status.textContent = "Salvando…";
    const cardId = editingCardId;
    await OituDB.updateCard(cardId, {
      annotationHtml: html,
      annotationUpdatedAt: new Date().toISOString()
    });
    presenceOverrides.set(cardId, true);
    closeEditor();
    scheduleSync();
  }

  async function openViewerForCard(cardId) {
    if (!cardId) return;
    if (viewerCardId === cardId && !$("#annotationViewer")?.classList.contains("hidden")) {
      closeViewer();
      return;
    }

    const card = await OituDB.getCard(cardId);
    const html = card?.annotationHtml || "";
    if (!hasAnnotationHtml(html)) {
      presenceOverrides.set(cardId, false);
      closeViewer();
      scheduleSync();
      return;
    }

    $("#annotationViewerContent").innerHTML = html;
    viewerCardId = cardId;
    $("#annotationViewer").classList.remove("hidden");
  }

  function readFileAsImage(file) {
    if (!file?.type?.startsWith("image/")) {
      alert("Selecione um arquivo de imagem.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => insertImage(reader.result, file.name || "Imagem");
    reader.readAsDataURL(file);
  }

  function bindEditorEvents() {
    const editor = $("#annotationRichEditor");
    const toolbar = $("#annotationToolbar");
    if (!editor || !toolbar || toolbar.dataset.annotationBound === "true") return;
    toolbar.dataset.annotationBound = "true";

    ["keyup", "mouseup", "focus"].forEach((name) => editor.addEventListener(name, saveSelection));

    editor.addEventListener("paste", (event) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (imageItem) {
        event.preventDefault();
        readFileAsImage(imageItem.getAsFile());
        return;
      }
      event.preventDefault();
      document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || "");
    });

    toolbar.addEventListener("mousedown", (event) => {
      const commandButton = event.target.closest("[data-annotation-cmd]");
      if (commandButton) {
        event.preventDefault();
        saveSelection();
        applyCommand(commandButton.dataset.annotationCmd);
        return;
      }

      const colorToggle = event.target.closest(".annotation-color-toggle");
      if (colorToggle) {
        event.preventDefault();
        saveSelection();
        const palette = colorToggle.parentElement?.querySelector(".annotation-color-palette");
        if (!palette) return;
        const willOpen = palette.classList.contains("hidden");
        closePalettes();
        if (willOpen) palette.classList.remove("hidden");
        return;
      }

      const colorDot = event.target.closest(".annotation-color-dot");
      if (colorDot) {
        event.preventDefault();
        const control = colorDot.closest("[data-annotation-color]");
        applyCommand(control?.dataset.annotationColor, colorDot.dataset.color);
        closePalettes();
        return;
      }

      if (event.target.closest(".annotation-image-button")) {
        event.preventDefault();
        saveSelection();
        $("#annotationImageInput")?.click();
      }
    });

    $("#annotationImageInput")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) readFileAsImage(file);
      event.target.value = "";
    });
  }

  function bindUIEvents() {
    if (document.documentElement.dataset.oitucardsAnnotationsBound === "true") return;
    document.documentElement.dataset.oitucardsAnnotationsBound = "true";

    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const editButton = target.closest(".annotation-edit-button");
      if (editButton) {
        event.preventDefault();
        event.stopPropagation();
        openEditorForCard(editButton.closest(".study-annotation-actions")?.dataset.cardId);
        return;
      }

      const viewButton = target.closest(".annotation-view-button");
      if (viewButton) {
        event.preventDefault();
        event.stopPropagation();
        openViewerForCard(viewButton.closest(".study-annotation-actions")?.dataset.cardId);
        return;
      }

      if (target.closest(".annotation-save-button")) {
        event.preventDefault();
        saveAnnotation();
        return;
      }
      if (target.closest(".annotation-cancel-button,.annotation-editor-close")) {
        event.preventDefault();
        closeEditor();
        return;
      }
      if (target.id === "annotationEditorBackdrop") {
        closeEditor();
        return;
      }
      if (target.closest(".annotation-viewer-close")) {
        closeViewer();
        return;
      }
      if (target.closest(".annotation-viewer-edit")) {
        if (viewerCardId) openEditorForCard(viewerCardId);
        return;
      }

      if (!target.closest(".annotation-color-control")) closePalettes();

      if (target.closest("#studyRatingArea,#multiRatings")) {
        hideActionBars();
        closeViewer();
        scheduleSync(40);
        scheduleSync(180);
        return;
      }

      if (target.closest("#studyCard,#multiCard,#studyPrevButton,#studyNextButton,#multiPrev,#multiNextArrow,#startStudyButton,#multiStart,#studyAgainButton,#multiAgain,#studyHomeButton,#multiHome,#exitStudyButton,#multiExit")) {
        scheduleSync();
        if (target.closest("#startStudyButton,#multiStart,#studyAgainButton,#multiAgain")) {
          scheduleSync(90);
          scheduleSync(240);
        }
      }
    });

    document.addEventListener("keydown", (event) => {
      const backdropOpen = !$("#annotationEditorBackdrop")?.classList.contains("hidden");
      if (backdropOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeEditor();
          return;
        }
        event.stopImmediatePropagation();
        return;
      }

      if (event.key === "Escape" && viewerCardId) {
        closeViewer();
        return;
      }

      if ($("#studyView")?.classList.contains("active") || $("#multiStudyView")?.classList.contains("active")) {
        if ([" ", "Spacebar", "ArrowLeft", "ArrowRight", "0", "1", "2", "3", "4"].includes(event.key) || event.code === "Space") {
          if (["0", "1", "2", "3", "4"].includes(event.key)) {
            hideActionBars();
            closeViewer();
            scheduleSync(40);
            scheduleSync(180);
          } else {
            scheduleSync();
          }
        }
      }
    }, true);
  }

  function init() {
    ensureUI();
    patchDatabase();
    wrapStudyApi(window.OituStudy, "study");
    wrapStudyApi(window.OituMultiStudy, "multi");
    bindEditorEvents();
    bindUIEvents();
    scheduleSync();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
