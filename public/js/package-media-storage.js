(function () {
  if (window.__oitucardsPackageMediaStorage) return;
  window.__oitucardsPackageMediaStorage = true;

  const DB_NAME = "OituCardsPackageMediaDB";
  const DB_VERSION = 1;
  const WORKER_URL = "js/package-media-resolver-worker.js?v=20260901-2155";
  const URL_CACHE_LIMIT = 96;
  const PREWARM_CONCURRENCY = 4;

  let dbPromise = null;
  let worker = null;
  let scalePatched = false;
  const packageLoads = new Map();
  const pending = new Map();
  const resolvePromises = new Map();
  const urls = new Map();

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("packages")) {
          const store = db.createObjectStore("packages", { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
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
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao salvar mídia do pacote."));
    });
  }

  async function get(storeName, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function savePackage(record) {
    if (!record?.id || !record?.blob) throw new Error("Pacote inválido.");
    try { navigator.storage?.persist?.().catch?.(() => {}); } catch (_) {}
    const current = await get("packages", record.id).catch(() => null);
    await put("packages", {
      ...(current || {}),
      id: record.id,
      blob: record.blob,
      name: record.name || current?.name || "Pacote Anki",
      size: Number(record.size) || record.blob.size || current?.size || 0,
      modern: record.modern ?? current?.modern ?? false,
      ready: record.ready ?? current?.ready ?? false,
      hotIds: Array.isArray(record.hotIds) ? record.hotIds : (current?.hotIds || []),
      createdAt: current?.createdAt || record.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return record.id;
  }

  async function updatePackage(id, patch) {
    const current = await get("packages", id);
    if (!current) return null;
    const next = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
    await put("packages", next);
    return next;
  }

  async function saveRefs(packageId, refs) {
    if (!packageId || !Array.isArray(refs) || !refs.length) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("refs", "readwrite");
      const store = tx.objectStore("refs");
      const now = new Date().toISOString();
      for (const ref of refs) {
        if (!ref?.id || ref?.zipName === undefined || ref?.zipName === null) continue;
        store.put({
          id: ref.id,
          packageId,
          zipName: String(ref.zipName),
          name: ref.name || null,
          mime: ref.mime || "application/octet-stream",
          size: Number(ref.size) || 0,
          modern: Boolean(ref.modern),
          createdAt: now
        });
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao salvar índice de mídia."));
    });
  }

  function resetWorker(error) {
    const reason = error instanceof Error ? error : new Error(String(error || "Falha no resolvedor de mídia."));
    for (const holder of pending.values()) holder.reject(reason);
    pending.clear();
    for (const holder of packageLoads.values()) holder.reject(reason);
    packageLoads.clear();
    try { worker?.terminate?.(); } catch (_) {}
    worker = null;
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(WORKER_URL);
    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "packageReady") {
        const holder = packageLoads.get(message.packageId);
        holder?.resolve?.(true);
        return;
      }
      if (message.type === "packageError") {
        const holder = packageLoads.get(message.packageId);
        holder?.reject?.(new Error(message.message || "Falha ao abrir pacote."));
        packageLoads.delete(message.packageId);
        return;
      }
      if (message.type === "resolved" || message.type === "resolveError") {
        const holder = pending.get(message.requestId);
        if (!holder) return;
        pending.delete(message.requestId);
        if (message.type === "resolved" && message.blob) holder.resolve(message);
        else holder.reject(new Error(message.message || "Falha ao carregar imagem."));
      }
    });
    worker.addEventListener("error", (event) => resetWorker(new Error(event?.message || "Falha no resolvedor de mídia.")));
    return worker;
  }

  async function ensurePackageLoaded(packageId) {
    const existing = packageLoads.get(packageId);
    if (existing) return existing.promise;
    const record = await get("packages", packageId);
    if (!record?.blob) throw new Error("Pacote original não encontrado.");

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    packageLoads.set(packageId, { promise, resolve: resolvePromise, reject: rejectPromise });
    ensureWorker().postMessage({
      type: "loadPackage",
      packageId,
      blob: record.blob,
      modern: Boolean(record.modern)
    });
    return promise;
  }

  function touchUrl(id, url) {
    if (urls.has(id)) urls.delete(id);
    urls.set(id, url);
    while (urls.size > URL_CACHE_LIMIT) {
      const oldest = urls.keys().next().value;
      const oldUrl = urls.get(oldest);
      urls.delete(oldest);
      try { URL.revokeObjectURL(oldUrl); } catch (_) {}
    }
  }

  async function extractRef(ref) {
    await ensurePackageLoaded(ref.packageId);
    const requestId = crypto.randomUUID();
    const promise = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    ensureWorker().postMessage({
      type: "resolve",
      requestId,
      mediaId: ref.id,
      packageId: ref.packageId,
      zipName: ref.zipName,
      modern: Boolean(ref.modern),
      mime: ref.mime,
      name: ref.name
    });
    return promise;
  }

  async function resolveBlob(id, persist = true) {
    if (!id) return null;
    if (resolvePromises.has(id)) return resolvePromises.get(id);
    const promise = (async () => {
      const ref = await get("refs", id);
      if (!ref) return null;
      const result = await extractRef(ref);
      const blob = result?.blob || null;
      if (blob && persist && window.OituScaleStorage?.putMediaBatch) {
        OituScaleStorage.putMediaBatch([{
          id,
          blob,
          mime: result.mime || ref.mime,
          size: blob.size,
          name: ref.name,
          createdAt: new Date().toISOString()
        }]).catch(() => {});
      }
      return blob;
    })().finally(() => resolvePromises.delete(id));
    resolvePromises.set(id, promise);
    return promise;
  }

  async function mediaUrl(id) {
    const cached = urls.get(id);
    if (cached) {
      touchUrl(id, cached);
      return cached;
    }
    const blob = await resolveBlob(id, true);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    touchUrl(id, url);
    return url;
  }

  async function hydrateElement(root) {
    if (!root?.querySelectorAll) return;
    const images = [...root.querySelectorAll("img[data-oitucards-media]")].filter((image) => {
      if (!image.isConnected) return false;
      if (String(image.src || "").startsWith("blob:")) return false;
      return image.dataset.oitucardsPackageHydrating !== "true";
    });
    await Promise.all(images.map(async (image) => {
      const id = image.dataset.oitucardsMedia;
      if (!id) return;
      image.dataset.oitucardsPackageHydrating = "true";
      try {
        const url = await mediaUrl(id);
        if (url && image.isConnected && !String(image.src || "").startsWith("blob:")) image.src = url;
      } catch (_) {
      } finally {
        delete image.dataset.oitucardsPackageHydrating;
      }
    }));
  }

  async function prewarm(ids, limit = 80) {
    const unique = [...new Set((ids || []).filter(Boolean))].slice(0, Math.max(0, limit));
    let cursor = 0;
    async function runner() {
      while (cursor < unique.length) {
        const id = unique[cursor++];
        try { await resolveBlob(id, true); } catch (_) {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(PREWARM_CONCURRENCY, unique.length || 1) }, () => runner()));
  }

  async function latestPackage() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("packages", "readonly");
      const request = tx.objectStore("packages").index("createdAt").openCursor(null, "prev");
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => reject(request.error);
    });
  }

  function patchScaleStorage() {
    if (scalePatched) return true;
    if (!window.OituScaleStorage?.hydrateElement) return false;
    scalePatched = true;
    const previousHydrate = OituScaleStorage.hydrateElement.bind(OituScaleStorage);
    OituScaleStorage.hydrateElement = async function (root) {
      try { await previousHydrate(root); } catch (_) {}
      return hydrateElement(root);
    };
    OituScaleStorage.packageMedia = window.OituPackageMedia;
    return true;
  }

  function warmLatestImmediately() {
    Promise.resolve().then(async () => {
      try {
        const recent = await latestPackage();
        if (recent?.ready) await ensurePackageLoaded(recent.id);
      } catch (_) {}
    });
  }

  function init() {
    openDb().catch(() => {});
    if (!patchScaleStorage()) {
      const timer = setInterval(() => {
        if (patchScaleStorage()) clearInterval(timer);
      }, 50);
      setTimeout(() => clearInterval(timer), 10000);
    }
    warmLatestImmediately();
  }

  window.OituPackageMedia = {
    savePackage,
    updatePackage,
    saveRefs,
    resolveBlob,
    mediaUrl,
    hydrateElement,
    prewarm,
    ensurePackageLoaded
  };

  init();
})();