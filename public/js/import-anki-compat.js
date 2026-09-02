(function () {
  const importState = {
    active: false,
    deckSnapshotPromise: null,
    sanitizeCache: new Map(),
    statusObserver: null
  };

  const BIDI_CONTROL_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
  const naturalCollator = typeof Intl?.Collator === "function"
    ? new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" })
    : null;

  function limitDeckPathComponent(value) {
    const text = String(value || "").trim();
    const duplicateSuffix = text.match(/ \(\d+\)$/);
    if (!duplicateSuffix) return String.prototype.__oitucardsOriginalSlice.call(text, 0, 120);

    const suffix = duplicateSuffix[0];
    const base = String.prototype.__oitucardsOriginalSlice.call(text, 0, -suffix.length);
    const available = Math.max(1, 120 - suffix.length);
    return `${String.prototype.__oitucardsOriginalSlice.call(base, 0, available)}${suffix}`;
  }

  function patchHierarchicalDeckNameLimit() {
    if (String.prototype.__oitucardsOriginalSlice) return;

    const originalSlice = String.prototype.slice;
    Object.defineProperty(String.prototype, "__oitucardsOriginalSlice", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: originalSlice
    });

    String.prototype.slice = function (start, end) {
      const value = String(this);
      if (start === 0 && end === 120 && value.includes("::")) {
        const stack = String(new Error().stack || "");
        if (stack.includes("getUniqueDeckName") || /import(?:\.min)?\.js/i.test(stack)) {
          return value
            .split("::")
            .map((part) => limitDeckPathComponent(part))
            .join("::");
        }
      }
      return originalSlice.apply(this, arguments);
    };
  }

  function patchNaturalLibraryOrdering() {
    if (!naturalCollator || String.prototype.__oitucardsOriginalLocaleCompare) return;

    const originalLocaleCompare = String.prototype.localeCompare;
    Object.defineProperty(String.prototype, "__oitucardsOriginalLocaleCompare", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: originalLocaleCompare
    });

    String.prototype.localeCompare = function (compareString, locales, options) {
      const left = String(this);
      const right = String(compareString ?? "");
      const isPtBr = locales === "pt-BR" || (Array.isArray(locales) && locales.includes("pt-BR"));
      const needsNaturalOrder = /\d/.test(left) || /\d/.test(right) || BIDI_CONTROL_RE.test(left) || BIDI_CONTROL_RE.test(right);
      BIDI_CONTROL_RE.lastIndex = 0;

      if (isPtBr && needsNaturalOrder) {
        return naturalCollator.compare(
          left.replace(BIDI_CONTROL_RE, ""),
          right.replace(BIDI_CONTROL_RE, "")
        );
      }
      return originalLocaleCompare.apply(this, arguments);
    };
  }

  function trimSanitizeCache() {
    while (importState.sanitizeCache.size > 800) {
      const first = importState.sanitizeCache.keys().next().value;
      importState.sanitizeCache.delete(first);
    }
  }

  function patchFastImportSanitizer() {
    if (!window.OituEditor?.sanitizeHtml || OituEditor.sanitizeHtml.__oitucardsImportFastPath) return;

    const originalSanitizeHtml = OituEditor.sanitizeHtml.bind(OituEditor);
    const patched = function (html) {
      if (!importState.active) return originalSanitizeHtml(html);

      const source = String(html ?? "").trim();
      if (!source) return "";

      // Texto sem tags nem entidades HTML é seguro para reutilização direta e
      // evita milhares de passagens desnecessárias pelo parser DOM em APKGs grandes.
      if (!/[<>&]/.test(source)) return source;

      if (source.length <= 50000 && importState.sanitizeCache.has(source)) {
        return importState.sanitizeCache.get(source);
      }

      const sanitized = originalSanitizeHtml(source);
      if (source.length <= 50000) {
        importState.sanitizeCache.set(source, sanitized);
        trimSanitizeCache();
      }
      return sanitized;
    };
    patched.__oitucardsImportFastPath = true;
    OituEditor.sanitizeHtml = patched;
  }

  function patchImportDeckSnapshot() {
    if (!window.OituDB?.getDecks || OituDB.getDecks.__oitucardsImportSnapshot) return;

    const originalGetDecks = OituDB.getDecks.bind(OituDB);
    const patched = async function (...args) {
      if (!importState.active) return originalGetDecks(...args);

      if (!importState.deckSnapshotPromise) {
        importState.deckSnapshotPromise = Promise.resolve(originalGetDecks(...args)).then((decks) =>
          (decks || []).map((deck) => ({ ...deck }))
        );
      }
      const decks = await importState.deckSnapshotPromise;
      return decks.map((deck) => ({ ...deck }));
    };
    patched.__oitucardsImportSnapshot = true;
    OituDB.getDecks = patched;
  }

  function isAnkiPackageSelected() {
    const file = document.querySelector("#deckImportFileInput")?.files?.[0];
    if (/\.(?:apkg|colpkg|anki2|anki21)$/i.test(String(file?.name || ""))) return true;
    const selectedMeta = String(document.querySelector("#importSelectedMeta")?.textContent || "").trim();
    return /^(?:APKG|COLPKG|ANKI2|ANKI21)\b/i.test(selectedMeta);
  }

  function patchImportHierarchy() {
    if (!window.OituDB?.addDeck || OituDB.addDeck.__oitucardsImportHierarchy) return;

    const originalAddDeck = OituDB.addDeck.bind(OituDB);
    const patched = async function (name, options = {}) {
      const rawName = String(name || "").trim();
      if (!importState.active || !isAnkiPackageSelected() || !rawName.includes("::")) {
        return originalAddDeck(name, options);
      }

      const parts = rawName.split("::").map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) return originalAddDeck(name, options);

      const leaf = parts.pop();
      let parentId = options?.folderId || null;
      const folders = await OituDB.getFolders();

      for (const part of parts) {
        let folder = folders.find((item) =>
          (item.parentId || null) === (parentId || null) &&
          String(item.name || "").localeCompare(part, "pt-BR", { sensitivity: "base" }) === 0
        );

        if (!folder) {
          folder = await OituDB.addFolder(part, parentId);
          folders.push(folder);
        }
        parentId = folder.id;
      }

      return originalAddDeck(leaf, { ...options, folderId: parentId });
    };
    patched.__oitucardsImportHierarchy = true;
    OituDB.addDeck = patched;
  }

  function finishImportSession() {
    importState.active = false;
    importState.deckSnapshotPromise = null;
    importState.sanitizeCache.clear();
  }

  function finishImportUi() {
    const confirmButton = document.querySelector("#confirmImportButton");
    if (confirmButton) confirmButton.disabled = true;

    const importButton = document.querySelector("#importDeckButton");
    if (importButton) importButton.disabled = true;

    const modal = document.querySelector("#importModal");
    if (modal) modal.classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";

    document.querySelector("#homeButton")?.click();

    setTimeout(() => {
      const reopenButton = document.querySelector("#importDeckButton");
      if (reopenButton) reopenButton.disabled = false;
    }, 1000);
  }

  function inspectImportStatus() {
    const status = document.querySelector("#importStatus");
    if (!status || !importState.active) return;
    const text = String(status.textContent || "").trim();
    const tone = String(status.dataset.tone || "");
    const imported = /\bcard(s)? importado(s)?\b/i.test(text);

    if (imported) {
      finishImportSession();
      finishImportUi();
      return;
    }

    if (tone === "error") finishImportSession();
  }

  function attachImportStatusObserver() {
    const status = document.querySelector("#importStatus");
    if (!status || importState.statusObserver) return;
    importState.statusObserver = new MutationObserver(inspectImportStatus);
    importState.statusObserver.observe(status, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["data-tone"] });
  }

  function beginImportSession() {
    importState.active = true;
    importState.deckSnapshotPromise = null;
    importState.sanitizeCache.clear();
    patchImportHierarchy();
    patchImportDeckSnapshot();
    patchFastImportSanitizer();
    attachImportStatusObserver();
  }

  function installImportSessionHooks() {
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#confirmImportButton")) return;
      beginImportSession();
    }, true);
  }

  function patchJsZip(JSZip) {
    if (!JSZip || JSZip.__oitucardsModernAnkiPatched) return JSZip;

    const originalLoadAsync = JSZip.loadAsync.bind(JSZip);
    JSZip.loadAsync = async function (...args) {
      const zip = await originalLoadAsync(...args);
      if (!zip || zip.__oitucardsModernAnkiPatched) return zip;

      const originalFile = zip.file.bind(zip);
      zip.file = function (path, ...rest) {
        if (rest.length === 0 && path === "collection.21b") {
          return originalFile("collection.anki21b") || originalFile("collection.21b");
        }
        return originalFile(path, ...rest);
      };
      zip.__oitucardsModernAnkiPatched = true;
      return zip;
    };

    JSZip.__oitucardsModernAnkiPatched = true;
    return JSZip;
  }

  patchHierarchicalDeckNameLimit();
  patchNaturalLibraryOrdering();
  patchFastImportSanitizer();
  patchImportDeckSnapshot();
  installImportSessionHooks();

  if (window.JSZip) {
    window.JSZip = patchJsZip(window.JSZip);
    return;
  }

  let jsZipValue;
  try {
    Object.defineProperty(window, "JSZip", {
      configurable: true,
      enumerable: true,
      get() {
        return jsZipValue;
      },
      set(value) {
        jsZipValue = patchJsZip(value);
      }
    });
  } catch (_) {
    const timer = setInterval(() => {
      if (!window.JSZip) return;
      clearInterval(timer);
      window.JSZip = patchJsZip(window.JSZip);
    }, 50);
    setTimeout(() => clearInterval(timer), 15000);
  }
})();
