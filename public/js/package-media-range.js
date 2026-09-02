(function () {
  if (window.__oitucardsPackageMediaRange) return;
  window.__oitucardsPackageMediaRange = true;

  const DB_NAME = "OituCardsPackageMediaDB";
  const DB_VERSION = 1;
  const STATE_KEY = "OituCardsPackageMediaStateV2";
  const WORKER_URL = "js/package-media-range-worker.js?v=20260901-2305";
  const URL_CACHE_LIMIT = 96;

  let dbPromise = null;
  let worker = null;
  let scalePatched = false;
  const packageBlobs = new Map();
  const refCache = new Map();
  const pending = new Map();
  const resolving = new Map();
  const urls = new Map();

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("packages")) db.createObjectStore("packages", { keyPath: "id" });
        if (!db.objectStoreNames.contains("refs")) {
          const store = db.createObjectStore("refs", { keyPath: "id" });
          store.createIndex("packageId", "packageId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function put(storeName, value) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao salvar pacote Anki."));
    });
  }

  async function get(storeName, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function readState() {
    try {
      const value = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  }

  function writeState(value) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(value)); } catch (_) {}
  }

  async function savePackage(record) {
    if (!record?.id || !record?.blob) throw new Error("Pacote inválido.");
    try { navigator.storage?.persist?.().catch?.(() => {}); } catch (_) {}
    const saved = {
      id: record.id,
      blob: record.blob,
      name: record.name || "Pacote Anki",
      size: Number(record.size) || record.blob.size || 0,
      createdAt: record.createdAt || new Date().toISOString()
    };
    await put("packages", saved);
    packageBlobs.set(record.id, saved.blob);
    const state = readState();
    state[record.id] = {
      name: saved.name,
      size: saved.size,
      ready: false,
      createdAt: saved.createdAt,
      updatedAt: saved.createdAt
    };
    writeState(state);
    return record.id;
  }

  async function updatePackage(id, patch) {
    if (!id) return null;
    const state = readState();
    const next = { ...(state[id] || {}), ...(patch || {}), id, updatedAt: new Date().toISOString() };
    state[id] = next;
    writeState(state);
    return next;
  }

  async function saveRefs(packageId, refs) {
    if (!packageId || !Array.isArray(refs) || !refs.length) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("refs", "readwrite");
      const store = tx.objectStore("refs");
      const createdAt = new Date().toISOString();
      for (const ref of refs) {
        if (!ref?.id || !Number.isFinite(Number(ref.localHeaderOffset)) || !Number.isFinite(Number(ref.compressedSize))) continue;
        const value = {
          id: ref.id,
          packageId,
          zipName: String(ref.zipName || ""),
          name: ref.name || null,
          mime: ref.mime || "application/octet-stream",
          size: Number(ref.size) || 0,
          modern: Boolean(ref.modern),
          localHeaderOffset: Number(ref.localHeaderOffset),
          compressedSize: Number(ref.compressedSize),
          compressionMethod: Number(ref.compressionMethod) || 0,
          flags: Number(ref.flags) || 0,
          createdAt
        };
        store.put(value);
        refCache.set(value.id, value);
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao salvar índice de mídia."));
    });
  }

  async function getRef(id) {
    if (refCache.has(id)) return refCache.get(id);
    const ref = await get("refs", id);
    if (ref) refCache.set(id, ref);
    return ref;
  }

  async function packageBlob(packageId) {
    if (packageBlobs.has(packageId)) return packageBlobs.get(packageId);
    const record = await get("packages", packageId);
    if (!record?.blob) return null;
    packageBlobs.set(packageId, record.blob);
    return record.blob;
  }

  async function dataOffset(blob, ref) {
    const start = Number(ref.localHeaderOffset);
    const header = new DataView(await blob.slice(start, start + 30).arrayBuffer());
    if (header.byteLength < 30 || header.getUint32(0, true) !== 0x04034b50) throw new Error("Cabeçalho ZIP de mídia inválido.");
    const nameLength = header.getUint16(26, true);
    const extraLength = header.getUint16(28, true);
    return start + 30 + nameLength + extraLength;
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(WORKER_URL);
    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      const holder = pending.get(message.requestId);
      if (!holder) return;
      pending.delete(message.requestId);
      if (message.type === "decoded" && message.blob) holder.resolve(message);
      else holder.reject(new Error(message.message || "Falha ao carregar imagem."));
    });
    worker.addEventListener("error", (event) => {
      for (const holder of pending.values()) holder.reject(new Error(event?.message || "Falha no decodificador de mídia."));
      pending.clear();
      worker = null;
    });
    return worker;
  }

  async function cachedBlob(id) {
    try { return (await window.OituScaleStorage?.getMediaRecord?.(id))?.blob || null; }
    catch (_) { return null; }
  }

  async function resolveBlob(id, persist = true) {
    if (!id) return null;
    const cached = await cachedBlob(id);
    if (cached) return cached;
    if (resolving.has(id)) return resolving.get(id);

    const promise = (async () => {
      const ref = await getRef(id);
      if (!ref) return null;
      if (Number(ref.flags) & 1) throw new Error("Mídia ZIP criptografada não é suportada.");
      const blob = await packageBlob(ref.packageId);
      if (!blob) return null;
      const offset = await dataOffset(blob, ref);
      const compressed = await blob.slice(offset, offset + Number(ref.compressedSize)).arrayBuffer();
      const requestId = crypto.randomUUID();
      const resultPromise = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
      ensureWorker().postMessage({
        type: "decode",
        requestId,
        mediaId: id,
        buffer: compressed,
        compressionMethod: Number(ref.compressionMethod) || 0,
        modern: Boolean(ref.modern),
        mime: ref.mime,
        name: ref.name
      }, [compressed]);
      const result = await resultPromise;
      const output = result?.blob || null;
      if (output && persist && window.OituScaleStorage?.putMediaBatch) {
        await OituScaleStorage.putMediaBatch([{
          id,
          blob: output,
          mime: result.mime || ref.mime,
          name: ref.name,
          size: output.size,
          createdAt: new Date().toISOString()
        }]).catch(() => {});
      }
      return output;
    })().finally(() => resolving.delete(id));

    resolving.set(id, promise);
    return promise;
  }

  function touchUrl(id, url) {
    if (urls.has(id)) urls.delete(id);
    urls.set(id, url);
    while (urls.size > URL_CACHE_LIMIT) {
      const oldest = urls.keys().next().value;
      const old = urls.get(oldest);
      urls.delete(oldest);
      try { URL.revokeObjectURL(old); } catch (_) {}
    }
  }

  async function mediaUrl(id) {
    const cached = urls.get(id);
    if (cached) { touchUrl(id, cached); return cached; }
    const blob = await resolveBlob(id, true);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    touchUrl(id, url);
    return url;
  }

  async function hydrateElement(root) {
    if (!root?.querySelectorAll) return;
    const images = [...root.querySelectorAll("img[data-oitucards-media]")];
    await Promise.all(images.map(async (image) => {
      if (!image.isConnected || String(image.src || "").startsWith("blob:")) return;
      const id = image.dataset.oitucardsMedia;
      if (!id || image.dataset.oitucardsRangeHydrating === "true") return;
      image.dataset.oitucardsRangeHydrating = "true";
      try {
        const url = await mediaUrl(id);
        if (url && image.isConnected && !String(image.src || "").startsWith("blob:")) image.src = url;
      } catch (_) {
      } finally {
        delete image.dataset.oitucardsRangeHydrating;
      }
    }));
  }

  function patchScaleStorage() {
    if (scalePatched || !window.OituScaleStorage?.hydrateElement) return false;
    scalePatched = true;
    const previous = OituScaleStorage.hydrateElement.bind(OituScaleStorage);
    OituScaleStorage.hydrateElement = async function (root) {
      try { await previous(root); } catch (_) {}
      return hydrateElement(root);
    };
    OituScaleStorage.packageMedia = window.OituPackageMedia;
    return true;
  }

  function init() {
    openDb().catch(() => {});
    if (!patchScaleStorage()) {
      const timer = setInterval(() => { if (patchScaleStorage()) clearInterval(timer); }, 50);
      setTimeout(() => clearInterval(timer), 10000);
    }
  }

  window.OituPackageMedia = {
    savePackage,
    updatePackage,
    saveRefs,
    resolveBlob,
    mediaUrl,
    hydrateElement,
    prewarm: async () => true,
    ensurePackageLoaded: async () => true
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
