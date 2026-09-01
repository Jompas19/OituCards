(function () {
  if (window.__oitucardsScalePerformance) return;
  window.__oitucardsScalePerformance = true;

  const DB_NAME = "OituCardsDB";
  const TARGET_DB_VERSION = 2;
  const META_STORE = "cardMeta";
  const MEDIA_STORE = "media";
  const META_BATCH_SIZE = 600;
  const MEDIA_URL_CACHE_LIMIT = 96;
  const MEDIA_PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

  const state = {
    libraryReadDepth: 0,
    librarySnapshot: null,
    libraryWrapped: false,
    dbHelpersInstalled: false,
    coveragePromise: null,
    rerenderAfterCoverage: false,
    mediaUrls: new Map(),
    editorMediaPatched: false,
    mediaObserversInstalled: false
  };

  function normalizedRating(card) {
    if (["hard", "medium", "good", "easy"].includes(card?.lastRating)) return card.lastRating;
    const history = Array.isArray(card?.ratingHistory) ? card.ratingHistory : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (["hard", "medium", "good", "easy"].includes(history[i]?.rating)) return history[i].rating;
    }
    return null;
  }

  function reviewCount(card) {
    if (Number.isInteger(card?.reviewCount) && card.reviewCount >= 0) return card.reviewCount;
    return card?.lastReviewedAt || card?.nextReviewAt || normalizedRating(card) ? 1 : 0;
  }

  function toCardMeta(card) {
    if (!card?.id || !card?.deckId) return null;
    return {
      id: card.id,
      deckId: card.deckId,
      reviewStatus: card.reviewStatus ?? null,
      lastRating: normalizedRating(card),
      lastReviewedAt: card.lastReviewedAt ?? null,
      reviewCount: reviewCount(card),
      currentIntervalDays: card.currentIntervalDays ?? null,
      currentIntervalValue: card.currentIntervalValue ?? null,
      currentIntervalUnit: card.currentIntervalUnit ?? null,
      currentIntervalMinutes: card.currentIntervalMinutes ?? null,
      currentIntervalHours: card.currentIntervalHours ?? null,
      nextReviewAt: card.nextReviewAt ?? null,
      createdAt: card.createdAt ?? null,
      updatedAt: card.updatedAt ?? card.createdAt ?? null
    };
  }

  function patchIndexedDbOpen() {
    const proto = window.IDBFactory?.prototype;
    if (!proto?.open || proto.open.__oitucardsScalePatched) return;
    const originalOpen = proto.open;

    function patchedOpen(name, version) {
      const isOitu = String(name) === DB_NAME;
      const requested = isOitu && (!Number.isInteger(version) || version < TARGET_DB_VERSION)
        ? TARGET_DB_VERSION
        : version;
      const request = Number.isInteger(requested)
        ? originalOpen.call(this, name, requested)
        : originalOpen.call(this, name);

      if (isOitu) {
        request.addEventListener("upgradeneeded", (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(META_STORE)) {
            const meta = db.createObjectStore(META_STORE, { keyPath: "id" });
            meta.createIndex("deckId", "deckId", { unique: false });
            meta.createIndex("createdAt", "createdAt", { unique: false });
            meta.createIndex("deckCreated", ["deckId", "createdAt"], { unique: false });
            meta.createIndex("nextReviewAt", "nextReviewAt", { unique: false });
          }
          if (!db.objectStoreNames.contains(MEDIA_STORE)) {
            const media = db.createObjectStore(MEDIA_STORE, { keyPath: "id" });
            media.createIndex("createdAt", "createdAt", { unique: false });
          }
        });
      }
      return request;
    }

    patchedOpen.__oitucardsScalePatched = true;
    patchedOpen.__oitucardsOriginal = originalOpen;
    proto.open = patchedOpen;
  }

  function patchTransactions() {
    const proto = window.IDBDatabase?.prototype;
    if (!proto?.transaction || proto.transaction.__oitucardsScalePatched) return;
    const originalTransaction = proto.transaction;

    function patchedTransaction(storeNames, mode, options) {
      let names = typeof storeNames === "string" ? [storeNames] : Array.from(storeNames || []);
      if (
        this.name === DB_NAME &&
        mode === "readwrite" &&
        names.includes("cards") &&
        this.objectStoreNames.contains(META_STORE) &&
        !names.includes(META_STORE)
      ) {
        names = [...names, META_STORE];
      }
      const normalized = typeof storeNames === "string" && names.length === 1 ? names[0] : names;
      return options === undefined
        ? originalTransaction.call(this, normalized, mode)
        : originalTransaction.call(this, normalized, mode, options);
    }

    patchedTransaction.__oitucardsScalePatched = true;
    patchedTransaction.__oitucardsOriginal = originalTransaction;
    proto.transaction = patchedTransaction;
  }

  function txHasStore(tx, name) {
    try { return Array.from(tx.objectStoreNames || []).includes(name); }
    catch (_) { return false; }
  }

  function patchCardWrites() {
    const proto = window.IDBObjectStore?.prototype;
    if (!proto || proto.__oitucardsScaleWritesPatched) return;

    const originalAdd = proto.add;
    const originalPut = proto.put;
    const originalDelete = proto.delete;

    proto.add = function (value, key) {
      if (this.name === "cards" && txHasStore(this.transaction, META_STORE)) {
        const meta = toCardMeta(value);
        if (meta) this.transaction.objectStore(META_STORE).put(meta);
      }
      return arguments.length > 1 ? originalAdd.call(this, value, key) : originalAdd.call(this, value);
    };

    proto.put = function (value, key) {
      if (this.name === "cards" && txHasStore(this.transaction, META_STORE)) {
        const meta = toCardMeta(value);
        if (meta) this.transaction.objectStore(META_STORE).put(meta);
      }
      return arguments.length > 1 ? originalPut.call(this, value, key) : originalPut.call(this, value);
    };

    proto.delete = function (key) {
      if (this.name === "cards" && txHasStore(this.transaction, META_STORE)) {
        this.transaction.objectStore(META_STORE).delete(key);
      }
      return originalDelete.call(this, key);
    };

    Object.defineProperty(proto, "__oitucardsScaleWritesPatched", {
      configurable: true,
      value: true
    });
  }

  async function openDb() {
    if (window.OituDB?.openDB) return OituDB.openDB();
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, TARGET_DB_VERSION);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function countStore(storeName) {
    const db = await openDb();
    if (!db.objectStoreNames.contains(storeName)) return 0;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(Number(req.result) || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllCardMetas() {
    const db = await openDb();
    if (!db.objectStoreNames.contains(META_STORE)) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getCardMetasByDeck(deckId) {
    if (state.libraryReadDepth > 0 && state.librarySnapshot) {
      return (state.librarySnapshot.get(deckId) || []).map((item) => ({ ...item }));
    }
    const db = await openDb();
    if (!db.objectStoreNames.contains(META_STORE)) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).index("deckId").getAll(IDBKeyRange.only(deckId));
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function putMetaBatch(items) {
    if (!items.length) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);
      items.forEach((item) => store.put(item));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao atualizar o índice leve dos cards."));
    });
  }

  async function scanLegacyMetas() {
    const db = await openDb();
    const metas = [];
    await new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readonly");
      const req = tx.objectStore("cards").openCursor();
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve();
          return;
        }
        const meta = toCardMeta(cursor.value);
        if (meta) metas.push(meta);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
    for (let offset = 0; offset < metas.length; offset += META_BATCH_SIZE) {
      await putMetaBatch(metas.slice(offset, offset + META_BATCH_SIZE));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return metas.length;
  }

  async function ensureCoverage() {
    if (state.coveragePromise) return state.coveragePromise;
    state.coveragePromise = (async () => {
      const [cards, metas] = await Promise.all([countStore("cards"), countStore(META_STORE)]);
      if (cards === metas) return true;
      await scanLegacyMetas();
      return true;
    })().finally(() => {
      state.coveragePromise = null;
    });
    return state.coveragePromise;
  }

  function scheduleCoverageRepair() {
    const run = () => {
      ensureCoverage().then(() => {
        if (state.rerenderAfterCoverage && window.OituLibrary?.render) {
          state.rerenderAfterCoverage = false;
          window.OituLibrary.render().catch((error) => console.warn("OituCards: rerender após indexação falhou.", error));
        }
      }).catch((error) => console.warn("OituCards: indexação leve dos cards falhou.", error));
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1200 });
    else setTimeout(run, 80);
  }

  async function putMediaBatch(items) {
    if (!Array.isArray(items) || !items.length) return;
    const db = await openDb();
    if (!db.objectStoreNames.contains(MEDIA_STORE)) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, "readwrite");
      const store = tx.objectStore(MEDIA_STORE);
      items.forEach((item) => {
        if (!item?.id || !item?.blob) return;
        store.put({
          id: item.id,
          blob: item.blob,
          mime: item.mime || item.blob.type || "application/octet-stream",
          name: item.name || null,
          size: Number(item.size) || item.blob.size || 0,
          createdAt: item.createdAt || new Date().toISOString()
        });
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao gravar mídia no navegador."));
    });
  }

  async function getMediaRecord(id) {
    const db = await openDb();
    if (!db.objectStoreNames.contains(MEDIA_STORE)) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, "readonly");
      const req = tx.objectStore(MEDIA_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function touchMediaUrl(id, url) {
    if (state.mediaUrls.has(id)) state.mediaUrls.delete(id);
    state.mediaUrls.set(id, url);
    while (state.mediaUrls.size > MEDIA_URL_CACHE_LIMIT) {
      const oldest = state.mediaUrls.keys().next().value;
      const oldUrl = state.mediaUrls.get(oldest);
      state.mediaUrls.delete(oldest);
      try { URL.revokeObjectURL(oldUrl); } catch (_) {}
    }
  }

  async function mediaUrl(id) {
    if (!id) return null;
    const cached = state.mediaUrls.get(id);
    if (cached) {
      touchMediaUrl(id, cached);
      return cached;
    }
    const record = await getMediaRecord(id);
    if (!record?.blob) return null;
    const url = URL.createObjectURL(record.blob);
    touchMediaUrl(id, url);
    return url;
  }

  async function hydrateElement(root) {
    if (!root?.querySelectorAll) return;
    const images = [...root.querySelectorAll("img[data-oitucards-media]")];
    await Promise.all(images.map(async (image) => {
      const id = image.dataset.oitucardsMedia;
      if (!id || image.dataset.oitucardsMediaHydrating === "true") return;
      if (String(image.src || "").startsWith("blob:")) return;
      image.dataset.oitucardsMediaHydrating = "true";
      try {
        const url = await mediaUrl(id);
        if (url && image.isConnected) image.src = url;
      } catch (_) {
      } finally {
        delete image.dataset.oitucardsMediaHydrating;
      }
    }));
  }

  function protectMediaRefs(html) {
    if (!/data-oitucards-media=/i.test(String(html || ""))) return { html, refs: [] };
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    const refs = [];
    template.content.querySelectorAll("img[data-oitucards-media]").forEach((img, index) => {
      const id = img.dataset.oitucardsMedia;
      if (!id) return;
      const token = `__OCMEDIA_${index}_${crypto.randomUUID()}__`;
      refs.push({ token, id, alt: img.getAttribute("alt") || "" });
      img.setAttribute("src", MEDIA_PLACEHOLDER);
      img.setAttribute("alt", token);
      img.removeAttribute("data-oitucards-media");
      img.removeAttribute("data-oitucards-media-hydrating");
    });
    return { html: template.innerHTML, refs };
  }

  function restoreMediaRefs(html, refs) {
    if (!refs?.length) return html;
    const byToken = new Map(refs.map((item) => [item.token, item]));
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    template.content.querySelectorAll("img[alt]").forEach((img) => {
      const ref = byToken.get(img.getAttribute("alt"));
      if (!ref) return;
      img.setAttribute("data-oitucards-media", ref.id);
      img.setAttribute("src", "");
      if (ref.alt) img.setAttribute("alt", ref.alt);
      else img.removeAttribute("alt");
      img.setAttribute("loading", "lazy");
    });
    return template.innerHTML.trim();
  }

  function patchEditorMedia() {
    if (state.editorMediaPatched || !window.OituEditor?.sanitizeHtml) return;
    state.editorMediaPatched = true;

    const originalSanitize = OituEditor.sanitizeHtml.bind(OituEditor);
    OituEditor.sanitizeHtml = function (html) {
      const protectedRefs = protectMediaRefs(html);
      const sanitized = originalSanitize(protectedRefs.html);
      return restoreMediaRefs(sanitized, protectedRefs.refs);
    };

    const originalSetEditors = OituEditor.setEditors?.bind(OituEditor);
    if (originalSetEditors) {
      OituEditor.setEditors = function (frontHtml, backHtml) {
        originalSetEditors(frontHtml, backHtml);
        queueMicrotask(() => {
          hydrateElement(document.getElementById("frontEditor"));
          hydrateElement(document.getElementById("backEditor"));
        });
      };
    }
  }

  function installMediaObservers() {
    if (state.mediaObserversInstalled) return;
    state.mediaObserversInstalled = true;
    ["studyFront", "studyBack", "multiFront", "multiBack", "frontEditor", "backEditor"].forEach((id) => {
      const root = document.getElementById(id);
      if (!root) return;
      const observer = new MutationObserver(() => hydrateElement(root));
      observer.observe(root, { childList: true, subtree: true });
      hydrateElement(root);
    });
  }

  async function cleanupDeckMeta(deckId) {
    const db = await openDb();
    if (!db.objectStoreNames.contains(META_STORE)) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      const req = tx.objectStore(META_STORE).index("deckId").openCursor(IDBKeyRange.only(deckId));
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function installDbHelpers() {
    if (state.dbHelpersInstalled || !window.OituDB) return;
    state.dbHelpersInstalled = true;

    const originalGetCardsByDeck = OituDB.getCardsByDeck?.bind(OituDB);
    if (originalGetCardsByDeck) {
      OituDB.getCardsByDeck = async function (deckId) {
        if (state.libraryReadDepth > 0 && state.librarySnapshot) {
          return getCardMetasByDeck(deckId);
        }
        return originalGetCardsByDeck(deckId);
      };
    }

    const originalDeleteDeck = OituDB.deleteDeck?.bind(OituDB);
    if (originalDeleteDeck) {
      OituDB.deleteDeck = async function (deckId) {
        const result = await originalDeleteDeck(deckId);
        cleanupDeckMeta(deckId).catch(() => {});
        return result;
      };
    }

    OituDB.getAllCardMetas = getAllCardMetas;
    OituDB.getCardMetasByDeck = getCardMetasByDeck;
    OituDB.ensureCardMetaCoverage = ensureCoverage;

    window.OituScaleStorage = {
      putMediaBatch,
      getMediaRecord,
      mediaUrl,
      hydrateElement,
      toCardMeta
    };
  }

  function groupByDeck(metas) {
    const grouped = new Map();
    for (const meta of metas || []) {
      if (!grouped.has(meta.deckId)) grouped.set(meta.deckId, []);
      grouped.get(meta.deckId).push(meta);
    }
    grouped.forEach((list) => list.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))));
    return grouped;
  }

  function wrapLibraryRender() {
    if (state.libraryWrapped || !window.OituLibrary?.render) return;
    state.libraryWrapped = true;
    const originalRender = OituLibrary.render.bind(OituLibrary);

    OituLibrary.render = async function (...args) {
      let snapshot = [];
      try {
        snapshot = await getAllCardMetas();
        const [cardCount, metaCount] = await Promise.all([countStore("cards"), Promise.resolve(snapshot.length)]);
        if (cardCount !== metaCount) {
          state.rerenderAfterCoverage = true;
          scheduleCoverageRepair();
        }
      } catch (error) {
        console.warn("OituCards: não foi possível usar o índice leve da biblioteca.", error);
        return originalRender(...args);
      }

      state.librarySnapshot = groupByDeck(snapshot);
      state.libraryReadDepth += 1;
      try {
        return await originalRender(...args);
      } finally {
        state.libraryReadDepth = Math.max(0, state.libraryReadDepth - 1);
        if (state.libraryReadDepth === 0) state.librarySnapshot = null;
      }
    };
  }

  function init() {
    installDbHelpers();
    patchEditorMedia();
    installMediaObservers();
    wrapLibraryRender();
    scheduleCoverageRepair();
  }

  patchIndexedDbOpen();
  patchTransactions();
  patchCardWrites();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();