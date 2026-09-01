(function () {
  const importState = {
    active: false,
    deckSnapshotPromise: null,
    sanitizeCache: new Map(),
    statusObserver: null,
    mediaRefByDataUrl: new Map(),
    mediaQueue: [],
    mediaFlushPromise: Promise.resolve(),
    mediaFlushScheduled: false,
    mediaBarrierPatched: false
  };

  const BIDI_CONTROL_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
  const naturalCollator = typeof Intl?.Collator === "function"
    ? new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" })
    : null;
  const MEDIA_BATCH_SIZE = 6;

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

  function dataUrlToMediaRecord(id, dataUrl) {
    const source = String(dataUrl || "");
    const comma = source.indexOf(",");
    if (comma < 0) return null;
    const header = source.slice(0, comma);
    const payload = source.slice(comma + 1);
    const mime = header.match(/^data:([^;,]+)/i)?.[1] || "application/octet-stream";
    try {
      const binary = /;base64/i.test(header) ? atob(payload) : decodeURIComponent(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
      const blob = new Blob([bytes], { type: mime });
      return { id, blob, mime, size: blob.size, createdAt: new Date().toISOString() };
    } catch (_) {
      return null;
    }
  }

  function scheduleMediaFlush() {
    if (importState.mediaFlushScheduled || !importState.mediaQueue.length) return;
    importState.mediaFlushScheduled = true;
    importState.mediaFlushPromise = importState.mediaFlushPromise.then(async () => {
      while (importState.mediaQueue.length) {
        const jobs = importState.mediaQueue.splice(0, MEDIA_BATCH_SIZE);
        const records = jobs.map((job) => dataUrlToMediaRecord(job.id, job.dataUrl)).filter(Boolean);
        if (records.length && window.OituScaleStorage?.putMediaBatch) {
          await OituScaleStorage.putMediaBatch(records);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }).finally(() => {
      importState.mediaFlushScheduled = false;
      if (importState.mediaQueue.length) scheduleMediaFlush();
    });
  }

  async function flushAllMedia() {
    while (importState.mediaQueue.length || importState.mediaFlushScheduled) {
      scheduleMediaFlush();
      await importState.mediaFlushPromise;
    }
  }

  function queueMediaDataUrl(dataUrl) {
    const source = String(dataUrl || "");
    const cached = importState.mediaRefByDataUrl.get(source);
    if (cached) return cached;
    const id = `media:${crypto.randomUUID()}`;
    importState.mediaRefByDataUrl.set(source, id);
    importState.mediaQueue.push({ id, dataUrl: source });
    scheduleMediaFlush();
    return id;
  }

  function externalizeImportedMedia(html) {
    const source = String(html || "");
    if (!importState.active || !window.OituScaleStorage?.putMediaBatch || !/data:image\//i.test(source)) return source;
    const template = document.createElement("template");
    template.innerHTML = source;
    let changed = false;
    template.content.querySelectorAll("img[src^='data:image/']").forEach((image) => {
      const dataUrl = image.getAttribute("src") || "";
      if (!dataUrl) return;
      const id = queueMediaDataUrl(dataUrl);
      image.setAttribute("data-oitucards-media", id);
      image.setAttribute("src", "");
      image.setAttribute("loading", "lazy");
      changed = true;
    });
    return changed ? template.innerHTML.trim() : source;
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

      const sanitized = externalizeImportedMedia(originalSanitizeHtml(source));
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

  function patchMediaBarrier() {
    if (importState.mediaBarrierPatched || !window.OituDB?.addDeck) return;
    importState.mediaBarrierPatched = true;
    const originalAddDeck = OituDB.addDeck.bind(OituDB);
    OituDB.addDeck = async function (...args) {
      if (importState.active && (importState.mediaQueue.length || importState.mediaFlushScheduled)) {
        await flushAllMedia();
      }
      return originalAddDeck(...args);
    };
  }

  function finishImportSession() {
    importState.active = false;
    importState.deckSnapshotPromise = null;
    importState.sanitizeCache.clear();
    importState.mediaRefByDataUrl.clear();
    importState.mediaQueue.length = 0;
  }

  function inspectImportStatus() {
    const status = document.querySelector("#importStatus");
    if (!status || !importState.active) return;
    const text = String(status.textContent || "").trim();
    const tone = String(status.dataset.tone || "");
    if (/\bcard(s)? importado(s)?\b/i.test(text) || tone === "error") finishImportSession();
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
    importState.mediaRefByDataUrl.clear();
    importState.mediaQueue.length = 0;
    patchImportDeckSnapshot();
    patchFastImportSanitizer();
    patchMediaBarrier();
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