(function () {
  "use strict";

  const SYNC_DB_NAME = "OituCardsSyncDB";
  const SYNC_DB_VERSION = 1;
  const POLL_INTERVAL_MS = 5000;
  const MUTATION_BATCH_LIMIT = 250;
  const MUTATION_BATCH_BYTES = 3_800_000;
  const MEDIA_PACKET_BYTES = 7 * 1024 * 1024;
  const MEDIA_PACKET_PARTS = 12;
  const MEDIA_CHUNK_BYTES = 1024 * 1024;
  const MEDIA_GROUP_BYTES = 14 * 1024 * 1024;
  const USERNAME_PATTERN = /^[\p{L}\p{N}._-]{3,32}$/u;

  let dbPromise = null;
  let session = null;
  let syncing = false;
  let applyingRemote = false;
  let mediaRunning = false;
  let flushTimer = 0;
  let pollTimer = 0;
  let backgroundMediaTimer = 0;
  let lastError = "";
  let pullPromise = null;
  let profileChanging = false;
  let sessionLoaded = false;
  const pendingCaptures = [];
  const mediaRequests = new Map();
  const mediaRetryAt = new Map();

  const $ = (selector) => document.querySelector(selector);

  function openSyncDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(SYNC_DB_NAME, SYNC_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("state")) db.createObjectStore("state", { keyPath: "key" });
        if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "key" });
        if (!db.objectStoreNames.contains("mediaQueue")) db.createObjectStore("mediaQueue", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function readRecord(storeName, key) {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function writeRecord(storeName, value) {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível salvar o estado da sincronização."));
    });
  }

  async function clearStores(storeNames) {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, "readwrite");
      storeNames.forEach((name) => tx.objectStore(name).clear());
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível limpar a fila de sincronização."));
    });
  }

  async function saveSession() {
    if (!session) return;
    await writeRecord("state", { key: "session", ...session });
  }

  async function getDeviceId() {
    const saved = await readRecord("state", "device");
    if (saved?.id) return saved.id;
    const id = crypto.randomUUID();
    await writeRecord("state", { key: "device", id });
    return id;
  }

  function normalizedUsername(value) {
    const username = String(value || "").normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
    return USERNAME_PATTERN.test(username) ? username : null;
  }

  function modifiedAt(value) {
    return Date.parse(value?.updatedAt || value?.createdAt || "") || Date.now();
  }

  function newNonce() {
    return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
  }

  function mutationKey(kind, id) {
    const order = kind === "folder" ? "1" : kind === "deck" ? "2" : "3";
    return `${order}:${kind}:${id}`;
  }

  async function enqueueMutations(mutations) {
    if (!session || !mutations.length) return;
    const db = await openSyncDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("queue", "readwrite");
      const store = tx.objectStore("queue");
      mutations.forEach((mutation) => {
        if (!mutation?.kind || !mutation?.id) return;
        store.put({
          key: mutationKey(mutation.kind, mutation.id),
          nonce: newNonce(),
          mutation
        });
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível preparar as alterações para sincronização."));
    });
  }

  async function enqueueMedia(records) {
    if (!session || !records.length) return;
    const db = await openSyncDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("mediaQueue", "readwrite");
      const store = tx.objectStore("mediaQueue");
      records.forEach((record) => {
        if (!record?.id) return;
        store.put({
          id: record.id,
          nonce: newNonce(),
          name: record.name || "imagem",
          mime: record.mime || record.blob?.type || "application/octet-stream",
          size: Number(record.size) || Number(record.blob?.size) || 0,
          deckIds: Array.isArray(record.deckIds) ? record.deckIds : [],
          modifiedAt: modifiedAt(record)
        });
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível preparar as imagens para sincronização."));
    });
  }

  async function captureLocalChange(type, payload) {
    if (!sessionLoaded) {
      pendingCaptures.push([type, payload]);
      return;
    }
    if (!session || applyingRemote) return;
    if (type === "entities") {
      const mutations = (payload || []).filter((entry) => entry?.value?.id).map((entry) => ({
        op: "upsert",
        kind: entry.kind,
        id: entry.value.id,
        modifiedAt: modifiedAt(entry.value),
        payload: entry.value
      }));
      await enqueueMutations(mutations);
    } else if (type === "delete") {
      const timestamp = Number(payload?.modifiedAt) || Date.now();
      await enqueueMutations([
        ...(payload?.decks || []).map((id) => ({ op: "delete", kind: "deck", id, modifiedAt: timestamp })),
        ...(payload?.folders || []).map((id) => ({ op: "delete", kind: "folder", id, modifiedAt: timestamp }))
      ]);
    } else if (type === "delete-card" && payload?.id) {
      await enqueueMutations([{ op: "delete", kind: "card", id: payload.id, modifiedAt: Number(payload.modifiedAt) || Date.now() }]);
    } else if (type === "media") {
      await enqueueMedia(payload || []);
    }
    scheduleSync(300);
  }

  async function queueSnapshot(snapshot) {
    const mutations = (snapshot.entities || []).filter((entry) => entry?.value?.id).map((entry) => ({
      op: "upsert",
      kind: entry.kind,
      id: entry.value.id,
      modifiedAt: modifiedAt(entry.value),
      payload: entry.value
    }));
    await enqueueMutations(mutations);
    await enqueueMedia(snapshot.media || []);
  }

  async function getMutationBatch() {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("queue", "readonly");
      const request = tx.objectStore("queue").openCursor();
      const records = [];
      let bytes = 0;
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor || records.length >= MUTATION_BATCH_LIMIT) return;
        const size = new TextEncoder().encode(JSON.stringify(cursor.value.mutation)).byteLength + 80;
        if (records.length && bytes + size > MUTATION_BATCH_BYTES) return;
        records.push(cursor.value);
        bytes += size;
        cursor.continue();
      };
      tx.oncomplete = () => resolve(records);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível ler a fila de sincronização."));
    });
  }

  async function getMediaQueueBatch() {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("mediaQueue", "readonly");
      const request = tx.objectStore("mediaQueue").openCursor();
      const records = [];
      let bytes = 0;
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor || records.length >= 24) return;
        const size = Math.max(1, Number(cursor.value.size) || 1);
        if (records.length && bytes + size > MEDIA_GROUP_BYTES) return;
        records.push(cursor.value);
        bytes += size;
        cursor.continue();
      };
      tx.oncomplete = () => resolve(records);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível ler a fila de imagens."));
    });
  }

  async function deleteMatching(storeName, records, keyField) {
    if (!records.length) return;
    const db = await openSyncDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      records.forEach((record) => {
        const key = record[keyField];
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result?.nonce === record.nonce) store.delete(key);
        };
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível concluir a fila de sincronização."));
    });
  }

  async function authenticatedFetch(path, options = {}) {
    if (!session?.token) throw new Error("Conecte um perfil para sincronizar.");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${session.token}`);
    headers.set("X-Oitu-User", encodeURIComponent(session.username));
    headers.set("X-Oitu-Device", session.deviceId);
    const response = await fetch(path, { ...options, headers, cache: "no-store" });
    if (response.status === 401) {
      await expireSession();
      throw new Error("A sessão expirou. Conecte o perfil novamente.");
    }
    return response;
  }

  async function apiJSON(path, options = {}) {
    const { auth, ...fetchOptions } = options;
    const response = auth === false
      ? await fetch(path, { ...fetchOptions, cache: "no-store" })
      : await authenticatedFetch(path, fetchOptions);
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data?.error || "Não foi possível sincronizar agora.");
    return data;
  }

  async function expireSession() {
    session = null;
    lastError = "Sessão expirada. Conecte novamente.";
    await clearStores(["queue", "mediaQueue"]);
    const db = await openSyncDB();
    await new Promise((resolve) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").delete("session");
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
    if ($("#syncFormFeedback")) $("#syncFormFeedback").textContent = lastError;
    renderStatus();
  }

  async function flushMutations() {
    while (session && navigator.onLine !== false) {
      const records = await getMutationBatch();
      if (!records.length) return;
      await apiJSON("/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutations: records.map((record) => record.mutation) })
      });
      await deleteMatching("queue", records, "key");
    }
  }

  async function removeRemoteWinsFromMediaQueue(changes) {
    const remote = (changes || []).filter((change) => change.kind === "media");
    if (!remote.length) return;
    const db = await openSyncDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("mediaQueue", "readwrite");
      const store = tx.objectStore("mediaQueue");
      remote.forEach((change) => {
        const request = store.get(change.id);
        request.onsuccess = () => {
          if (request.result && Number(request.result.modifiedAt) <= Number(change.modifiedAt)) store.delete(change.id);
        };
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível conciliar as imagens."));
    });
  }

  async function performPullChanges() {
    const username = session?.username;
    let cursor = Math.max(0, Number(session?.lastVersion) || 0);
    let applied = 0;
    let rounds = 0;
    while (session && rounds < 100) {
      rounds += 1;
      const result = await apiJSON(`/api/sync/pull?since=${cursor}&limit=500`);
      if (!session || session.username !== username) return applied;
      const changes = Array.isArray(result.changes) ? result.changes : [];
      if (changes.length) {
        await removeRemoteWinsFromMediaQueue(changes);
        applyingRemote = true;
        try { applied += await OituDB.applySyncChanges(changes); }
        finally { applyingRemote = false; }
      }
      cursor = Math.max(cursor, Number(result.nextVersion) || cursor);
      session.lastVersion = cursor;
      await saveSession();
      if (!result.hasMore || !changes.length) break;
    }
    if (applied && $("#homeView")?.classList.contains("active")) {
      $("#homeButton")?.click();
    }
    return applied;
  }

  function pullChanges() {
    if (pullPromise) return pullPromise;
    pullPromise = performPullChanges().finally(() => { pullPromise = null; });
    return pullPromise;
  }

  async function syncNow(options = {}) {
    const execute = () => syncNowUnlocked(options);
    if (navigator.locks?.request) {
      return navigator.locks.request("oitucards-sync-items", { ifAvailable: true }, (lock) => lock ? execute() : undefined);
    }
    return execute();
  }

  async function syncNowUnlocked(options = {}) {
    if (!session || syncing || navigator.onLine === false) return;
    syncing = true;
    lastError = "";
    renderStatus(options.message || "Sincronizando alterações...");
    try {
      await flushMutations();
      await pullChanges();
      session.lastSyncedAt = Date.now();
      await saveSession();
    } catch (error) {
      lastError = error?.message || "Não foi possível sincronizar agora.";
      console.warn("OituCards: sincronização pendente.", error);
    } finally {
      syncing = false;
      renderStatus();
      if (session) {
        runMediaUploads();
        scheduleBackgroundMedia(250);
      }
    }
  }

  function buildMediaPackets(records, blobs) {
    const packets = [];
    let packet = null;
    const beginPacket = () => ({ entries: new Map(), parts: [], bytes: 0 });
    const closePacket = () => {
      if (packet?.parts.length) packets.push(packet);
      packet = null;
    };

    records.forEach((record) => {
      const stored = blobs.get(record.id);
      const blob = stored?.blob;
      if (!(blob instanceof Blob) || !blob.size) return;
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.ceil(blob.size / MEDIA_CHUNK_BYTES);
      for (let index = 0; index < totalChunks; index += 1) {
        const chunk = blob.slice(index * MEDIA_CHUNK_BYTES, Math.min(blob.size, (index + 1) * MEDIA_CHUNK_BYTES), record.mime);
        if (!packet) packet = beginPacket();
        if (packet.parts.length >= MEDIA_PACKET_PARTS || (packet.parts.length && packet.bytes + chunk.size > MEDIA_PACKET_BYTES)) {
          closePacket();
          packet = beginPacket();
        }
        let entry = packet.entries.get(record.id);
        if (!entry) {
          entry = {
            id: record.id,
            uploadId,
            name: record.name,
            mime: record.mime,
            size: blob.size,
            deckIds: record.deckIds,
            modifiedAt: record.modifiedAt,
            totalChunks,
            parts: []
          };
          packet.entries.set(record.id, entry);
        }
        const key = `p${packet.parts.length}`;
        entry.parts.push({ key, index });
        packet.parts.push({ key, chunk, name: `${record.id}-${index}` });
        packet.bytes += chunk.size;
      }
    });
    closePacket();
    return packets;
  }

  async function uploadMediaGroup(records) {
    const blobs = await OituDB.getMediaBatch(records.map((record) => record.id));
    const available = records.filter((record) => blobs.get(record.id)?.blob instanceof Blob);
    if (!available.length) {
      await deleteMatching("mediaQueue", records, "id");
      return;
    }
    const packets = buildMediaPackets(available, blobs);
    for (const packet of packets) {
      const form = new FormData();
      form.set("manifest", JSON.stringify({ media: [...packet.entries.values()] }));
      packet.parts.forEach((part) => form.append(part.key, part.chunk, part.name));
      const response = await authenticatedFetch("/api/sync/media/push", { method: "POST", body: form });
      let result = null;
      try { result = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(result?.error || "Não foi possível enviar uma imagem.");
    }
    await deleteMatching("mediaQueue", available, "id");
  }

  async function runMediaUploads() {
    if (navigator.locks?.request) {
      return navigator.locks.request("oitucards-sync-media", { ifAvailable: true }, (lock) => lock ? runMediaUploadsUnlocked() : undefined);
    }
    return runMediaUploadsUnlocked();
  }

  async function runMediaUploadsUnlocked() {
    if (!session || mediaRunning || navigator.onLine === false) return;
    mediaRunning = true;
    renderStatus("Enviando imagens em segundo plano...");
    try {
      while (session && navigator.onLine !== false) {
        const records = await getMediaQueueBatch();
        if (!records.length) break;
        await uploadMediaGroup(records);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (session) await pullChanges();
    } catch (error) {
      lastError = error?.message || "Algumas imagens aguardam sincronização.";
      console.warn("OituCards: imagens aguardando sincronização.", error);
    } finally {
      mediaRunning = false;
      renderStatus();
    }
  }

  async function ensureMedia(id) {
    if (!id) return null;
    const local = await OituDB.getMediaRecord(id);
    if (local?.blob) return local;
    if (!session || navigator.onLine === false) return local;
    if (mediaRequests.has(id)) return mediaRequests.get(id);
    const promise = (async () => {
      const response = await authenticatedFetch(`/api/sync/media/${encodeURIComponent(id)}`);
      if (!response.ok) {
        let detail = null;
        try { detail = await response.json(); } catch (_) {}
        throw new Error(detail?.error || "Imagem ainda não disponível.");
      }
      const blob = await response.blob();
      const current = await OituDB.getMediaRecord(id);
      const record = {
        ...(current || {}),
        id,
        name: current?.name || decodeURIComponent(response.headers.get("X-Oitu-Name") || "imagem"),
        mime: current?.mime || blob.type || "application/octet-stream",
        size: blob.size,
        deckIds: current?.deckIds || [],
        createdAt: current?.createdAt || current?.updatedAt || new Date().toISOString(),
        updatedAt: current?.updatedAt || new Date().toISOString(),
        blob
      };
      await OituDB.putMediaBatch([record], { silent: true });
      mediaRetryAt.delete(id);
      return record;
    })().catch((error) => {
      mediaRetryAt.set(id, Date.now() + 15000);
      throw error;
    }).finally(() => mediaRequests.delete(id));
    mediaRequests.set(id, promise);
    return promise;
  }

  function scheduleBackgroundMedia(delay = 1200) {
    clearTimeout(backgroundMediaTimer);
    if (!session) return;
    backgroundMediaTimer = setTimeout(downloadMissingMedia, delay);
  }

  async function downloadMissingMedia() {
    if (!session || navigator.onLine === false) return;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "")) return;
    try {
      const ids = (await OituDB.getMissingMediaIds(12)).filter((id) => (mediaRetryAt.get(id) || 0) <= Date.now()).slice(0, 4);
      if (!ids.length) return;
      await Promise.allSettled(ids.map((id) => ensureMedia(id)));
      scheduleBackgroundMedia(200);
    } catch (error) {
      console.warn("OituCards: download de imagens aguardando nova tentativa.", error);
      scheduleBackgroundMedia(5000);
    }
  }

  function scheduleSync(delay = 500) {
    clearTimeout(flushTimer);
    if (!session) return;
    flushTimer = setTimeout(() => syncNow(), delay);
  }

  function closeModal() {
    $("#syncModal")?.classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
    $("#syncButton")?.setAttribute("aria-expanded", "false");
  }

  function openModal() {
    renderStatus();
    $("#syncModal")?.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    $("#syncButton")?.setAttribute("aria-expanded", "true");
    setTimeout(() => (session ? $("#syncNowButton") : $("#syncUsername"))?.focus(), 0);
  }

  function statusText(override) {
    if (override) return override;
    if (syncing) return "Sincronizando alterações...";
    if (mediaRunning) return "Enviando imagens em segundo plano...";
    if (lastError) return lastError;
    if (!session) return "A sincronização é opcional.";
    if (!navigator.onLine) return "Sem internet. As alterações ficam salvas neste aparelho.";
    if (session.lastSyncedAt) return `Sincronizado às ${new Date(session.lastSyncedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`;
    return "Perfil conectado. Preparando a primeira sincronização.";
  }

  function renderStatus(override) {
    const connected = Boolean(session);
    const active = syncing || mediaRunning;
    const button = $("#syncButton");
    if (button) {
      button.dataset.state = active ? "syncing" : connected ? (lastError ? "error" : "connected") : "disconnected";
      button.title = connected ? `Sincronização: ${session.username}` : "Sincronizar entre dispositivos";
      button.setAttribute("aria-label", button.title);
    }
    $("#syncDisconnected")?.classList.toggle("hidden", connected);
    $("#syncConnected")?.classList.toggle("hidden", !connected);
    if (!connected && !$("#syncPassword")?.value) $("#syncPasswordNotice")?.classList.remove("hidden");
    if ($("#syncCurrentUser")) $("#syncCurrentUser").textContent = connected ? session.username : "";
    if ($("#syncProtection")) $("#syncProtection").textContent = session?.protected ? "Protegido por senha" : "Sem senha";
    if ($("#syncStatusText")) $("#syncStatusText").textContent = statusText(override);
    if ($("#syncNowButton")) $("#syncNowButton").disabled = !connected || active || navigator.onLine === false;
    if ($("#syncConnectButton")) $("#syncConnectButton").disabled = active || profileChanging;
    if ($("#syncDisconnectButton")) $("#syncDisconnectButton").disabled = profileChanging;
  }

  async function connect(event) {
    event.preventDefault();
    if (profileChanging) return;
    const username = normalizedUsername($("#syncUsername")?.value);
    const password = String($("#syncPassword")?.value || "");
    const feedback = $("#syncFormFeedback");
    if (!username) {
      feedback.textContent = "Use de 3 a 32 letras, números, ponto, hífen ou sublinhado.";
      $("#syncUsername")?.focus();
      return;
    }
    syncing = true;
    profileChanging = true;
    lastError = "";
    feedback.textContent = "Conectando e preparando seus cards...";
    renderStatus("Conectando ao perfil...");
    try {
      const deviceId = await getDeviceId();
      const result = await apiJSON("/api/sync/session", {
        auth: false,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, deviceId })
      });
      await clearStores(["queue", "mediaQueue"]);
      session = {
        username: result.username,
        token: result.token,
        deviceId,
        protected: Boolean(result.protected),
        expiresAt: Number(result.expiresAt) || 0,
        lastVersion: 0,
        lastSyncedAt: 0
      };
      await saveSession();
      renderStatus("Preparando a biblioteca deste aparelho...");
      const snapshot = await OituDB.getSyncSnapshot();
      await queueSnapshot(snapshot);
      await flushMutations();
      await pullChanges();
      session.lastSyncedAt = Date.now();
      await saveSession();
      feedback.textContent = "";
      if ($("#syncPassword")) $("#syncPassword").value = "";
    } catch (error) {
      if (session) await expireSession();
      feedback.textContent = error?.message || "Não foi possível conectar agora.";
    } finally {
      syncing = false;
      profileChanging = false;
      renderStatus();
      if (session) {
        runMediaUploads();
        scheduleBackgroundMedia(200);
      }
    }
  }

  async function disconnect() {
    if (profileChanging) return;
    profileChanging = true;
    const previous = session;
    session = null;
    clearTimeout(flushTimer);
    clearTimeout(backgroundMediaTimer);
    renderStatus();
    if (previous?.token && navigator.onLine !== false) {
      session = previous;
      try { await authenticatedFetch("/api/sync/session", { method: "DELETE" }); } catch (_) {}
      session = null;
    }
    try {
      await clearStores(["queue", "mediaQueue"]);
      const db = await openSyncDB();
      await new Promise((resolve) => {
        const tx = db.transaction("state", "readwrite");
        tx.objectStore("state").delete("session");
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
      lastError = "";
    } finally {
      profileChanging = false;
      renderStatus();
    }
  }

  function bindUI() {
    $("#syncButton")?.addEventListener("click", openModal);
    $("#syncClose")?.addEventListener("click", closeModal);
    $("#syncCancel")?.addEventListener("click", closeModal);
    $("#syncModal")?.addEventListener("click", (event) => {
      if (event.target === $("#syncModal")) closeModal();
    });
    $("#syncForm")?.addEventListener("submit", connect);
    $("#syncNowButton")?.addEventListener("click", () => syncNow({ message: "Buscando alterações agora..." }));
    $("#syncDisconnectButton")?.addEventListener("click", disconnect);
    $("#syncPassword")?.addEventListener("input", (event) => {
      $("#syncPasswordNotice")?.classList.toggle("hidden", Boolean(event.target.value));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("#syncModal")?.classList.contains("hidden")) closeModal();
    });
  }

  async function init() {
    bindUI();
    OituDB.setSyncSink(captureLocalChange);
    const saved = await readRecord("state", "session");
    if (saved?.token && saved?.username && (!saved.expiresAt || saved.expiresAt > Date.now())) {
      const { key: _key, ...rest } = saved;
      session = rest;
    }
    sessionLoaded = true;
    if (session) {
      for (const [type, payload] of pendingCaptures.splice(0)) await captureLocalChange(type, payload);
    } else {
      pendingCaptures.length = 0;
    }
    renderStatus();
    if (session) {
      scheduleSync(100);
      scheduleBackgroundMedia(1200);
    }
    clearInterval(pollTimer);
    pollTimer = setInterval(() => syncNow(), POLL_INTERVAL_MS);
    window.addEventListener("online", () => {
      renderStatus();
      scheduleSync(100);
      scheduleBackgroundMedia(400);
    });
    window.addEventListener("offline", () => renderStatus());
    window.addEventListener("focus", () => syncNow());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") syncNow();
    });
  }

  window.OituSync = {
    ensureMedia,
    syncNow,
    isConnected: () => Boolean(session)
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
