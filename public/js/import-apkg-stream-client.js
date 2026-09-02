(function () {
  if (window.__oitucardsApkgStreamClient) return;
  window.__oitucardsApkgStreamClient = true;

  const WORKER_URL = "js/import-apkg-stream-worker.js?v=20260901-2135";
  const STATS_KEY = "OituCardsDeckStatsV3";
  const AUTHORITY_KEY = "OituCardsReviewTimeAuthorityV1";
  const MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  const MODEL_PROFILE_STORAGE_KEY = "OituCardsReviewPresetUnitsV2";
  const LEGACY_MODEL_UNIT_STORAGE_KEY = "OituCardsReviewPresetUnitsV1";
  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
  const DAY = "days";

  let worker = null;
  let workerReady = false;
  let activeJob = null;
  const $ = (selector) => document.querySelector(selector);

  function extensionOf(name) {
    return String(name || "").toLowerCase().match(/\.([^.]+)$/)?.[1] || "";
  }

  function isApkg(file) {
    return file && ["apkg", "colpkg"].includes(extensionOf(file.name));
  }

  function setProgress(value, message, tone = "working") {
    const bar = $("#importProgressBar");
    const wrap = $("#importProgressWrap");
    const status = $("#importStatus");
    const safe = Math.max(0, Math.min(100, Number(value) || 0));
    if (wrap) wrap.classList.remove("hidden");
    if (bar) {
      bar.style.width = `${safe}%`;
      bar.setAttribute("aria-valuenow", String(Math.round(safe)));
    }
    if (status && message) {
      status.textContent = message;
      status.dataset.tone = tone;
    }
  }

  function setBusy(busy) {
    const button = $("#confirmImportButton");
    const input = $("#deckImportFileInput");
    const drop = $("#importDropzone");
    if (button) {
      button.disabled = busy || !input?.files?.[0];
      button.textContent = busy ? "Importando..." : "Importar";
    }
    if (input) input.disabled = busy;
    if (drop) drop.classList.toggle("is-busy", busy);
  }

  function closeModal() {
    $("#importModal")?.classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
  }

  function refreshHome() {
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    $("#homeView")?.classList.add("active");
    Promise.resolve(window.OituLibrary?.render?.()).catch(() => {});
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(WORKER_URL);
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", (event) => fail(event?.message || "Falha no motor de importação."));
    worker.postMessage({ type: "warmup" });
    return worker;
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "") ?? fallback; }
    catch (_) { return fallback; }
  }

  function normalizeUnit(value) {
    const raw = String(value || "").toLocaleLowerCase("pt-BR");
    if (["minutes","minute","minuto","minutos","min"].includes(raw)) return "minutes";
    if (["hours","hour","hora","horas","h"].includes(raw)) return "hours";
    return DAY;
  }

  function cloneSettings(raw, profile) {
    const source = raw || {};
    const intervals = source.newIntervals || source || {};
    const multipliers = source.multipliers || {};
    const p = profile || { hard: DAY, medium: DAY, good: DAY, easy: DAY, max: DAY };
    const max = Math.round(Number(source.maxIntervalDays));
    const next = {
      newIntervals: {
        hard: Math.max(1, Math.round(Number(intervals.hard) || 1)),
        medium: Math.max(1, Math.round(Number(intervals.medium) || 2)),
        good: Math.max(1, Math.round(Number(intervals.good) || 4)),
        easy: Math.max(1, Math.round(Number(intervals.easy) || 7))
      },
      multipliers: {
        hard: Math.max(1, Number(multipliers.hard) || 1.2),
        medium: Math.max(1, Number(multipliers.medium) || 1.8),
        good: Math.max(1, Number(multipliers.good) || 2.5),
        easy: Math.max(1, Number(multipliers.easy) || 4)
      },
      maxIntervalDays: Number.isFinite(max) && max >= 1 ? max : 180,
      intervalUnits: {
        hard: normalizeUnit(p.hard), medium: normalizeUnit(p.medium),
        good: normalizeUnit(p.good), easy: normalizeUnit(p.easy)
      },
      maxIntervalUnit: normalizeUnit(p.max)
    };
    const units = [...Object.values(next.intervalUnits), next.maxIntervalUnit];
    if (units.every((unit) => unit === units[0])) next.intervalUnit = units[0];
    return next;
  }

  function reviewSnapshot() {
    const models = readJson(MODEL_STORAGE_KEY, []);
    const valid = Array.isArray(models) ? models.filter((model) => model?.id && model?.settings) : [];
    let modelId = String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system");
    if (modelId !== "system") {
      const id = modelId.startsWith("model:") ? modelId.slice(6) : "";
      if (!valid.some((model) => model.id === id)) modelId = "system";
    }
    if (modelId === "system") {
      return {
        modelId,
        settings: cloneSettings({
          newIntervals: { hard: 1, medium: 2, good: 4, easy: 7 },
          multipliers: { hard: 1.2, medium: 1.8, good: 2.5, easy: 4 },
          maxIntervalDays: 180
        }, { hard: DAY, medium: DAY, good: DAY, easy: DAY, max: DAY })
      };
    }
    const id = modelId.slice(6);
    const model = valid.find((item) => item.id === id);
    const inline = model?.settings?.intervalUnits || {};
    const profiles = readJson(MODEL_PROFILE_STORAGE_KEY, {});
    const stored = profiles && typeof profiles === "object" ? profiles[id] : null;
    const legacy = readJson(LEGACY_MODEL_UNIT_STORAGE_KEY, {});
    const old = legacy && typeof legacy === "object" ? legacy[id] : null;
    const inlineLegacy = model?.settings?.intervalUnit ? normalizeUnit(model.settings.intervalUnit) : null;
    const fallback = old ? normalizeUnit(old) : DAY;
    return {
      modelId,
      settings: cloneSettings(model?.settings, {
        hard: inline.hard || stored?.hard || inlineLegacy || fallback,
        medium: inline.medium || stored?.medium || inlineLegacy || fallback,
        good: inline.good || stored?.good || inlineLegacy || fallback,
        easy: inline.easy || stored?.easy || inlineLegacy || fallback,
        max: model?.settings?.maxIntervalUnit || stored?.max || inlineLegacy || fallback
      })
    };
  }

  function normalizeName(value) {
    return String(value || "").trim().toLocaleLowerCase("pt-BR");
  }

  function uniqueName(base, used) {
    const clean = String(base || "Baralho importado").trim().slice(0, 120) || "Baralho importado";
    let value = clean;
    let index = 2;
    while (used.has(normalizeName(value))) {
      const suffix = ` (${index++})`;
      value = `${clean.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
    }
    used.add(normalizeName(value));
    return value;
  }

  function rememberAuthority(records, snapshot) {
    try {
      const parsed = readJson(AUTHORITY_KEY, {});
      const authority = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      const updatedAt = new Date().toISOString();
      for (const record of records) {
        authority[record.id] = {
          reviewSettings: snapshot.settings,
          reviewModelMode: "global",
          reviewModelId: snapshot.modelId,
          updatedAt
        };
      }
      localStorage.setItem(AUTHORITY_KEY, JSON.stringify(authority));
    } catch (_) {}
  }

  async function setupStructure(message, job) {
    setProgress(9, `Criando estrutura de ${message.decks?.length || 0} baralhos...`);
    const [decks, folders] = await Promise.all([OituDB.getDecks(), OituDB.getFolders()]);
    const used = new Set(decks.map((deck) => normalizeName(deck.name)));
    const snapshot = reviewSnapshot();
    const base = Date.now();
    const existingFolders = new Map();
    const pathCache = new Map();
    const newFolders = [];
    const newDecks = [];

    for (const folder of folders) existingFolders.set(`${folder.parentId || "root"}\u0000${normalizeName(folder.name)}`, folder);

    function folderPath(parts) {
      let parentId = null;
      let path = "";
      for (const raw of parts) {
        const name = String(raw || "").trim().slice(0, 120);
        if (!name) continue;
        path += `/${normalizeName(name)}`;
        let folder = pathCache.get(path) || existingFolders.get(`${parentId || "root"}\u0000${normalizeName(name)}`);
        if (!folder) {
          const now = new Date(base + newFolders.length).toISOString();
          folder = {
            id: crypto.randomUUID(), kind: "folder", name, parentId,
            reviewSettings: structuredClone(snapshot.settings),
            reviewModelMode: "global", reviewModelId: snapshot.modelId,
            createdAt: now, updatedAt: now
          };
          newFolders.push(folder);
          existingFolders.set(`${parentId || "root"}\u0000${normalizeName(name)}`, folder);
        }
        pathCache.set(path, folder);
        parentId = folder.id;
      }
      return parentId;
    }

    const deckMap = new Map();
    for (const source of message.decks || []) {
      const parts = String(source.name || "Baralho importado").split("::").map((part) => part.trim()).filter(Boolean);
      const leaf = uniqueName(parts.pop() || "Baralho importado", used);
      const folderId = parts.length ? folderPath(parts) : null;
      const now = new Date(base + newFolders.length + newDecks.length + 1).toISOString();
      const deck = {
        id: crypto.randomUUID(), kind: "deck", name: leaf, folderId,
        reviewSettings: structuredClone(snapshot.settings),
        reviewModelMode: "global", reviewModelId: snapshot.modelId,
        importedAt: now, importSource: extensionOf(job.file.name) || "apkg",
        importPackageId: job.packageId,
        createdAt: now, updatedAt: now
      };
      newDecks.push(deck);
      deckMap.set(String(source.did), deck);
    }

    const records = [...newFolders, ...newDecks];
    if (records.length) {
      const db = await OituDB.openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("decks", "readwrite");
        const store = tx.objectStore("decks");
        records.forEach((record) => store.add(record));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Falha ao gravar estrutura importada."));
      });
      rememberAuthority(records, snapshot);
      window.OituLibraryEntitySnapshot?.invalidate?.();
    }
    setProgress(18, `Estrutura pronta: ${newDecks.length} baralhos.`);
    return deckMap;
  }

  async function persistCards(job, cards) {
    const deckMap = await job.deckPromise;
    const valid = [];
    const increments = new Map();
    for (const card of cards || []) {
      const deck = deckMap.get(String(card.did));
      if (!deck) continue;
      valid.push({ deckId: deck.id, frontHtml: card.frontHtml, backHtml: card.backHtml });
      increments.set(deck.id, (increments.get(deck.id) || 0) + 1);
    }
    if (!valid.length) return 0;

    const db = await OituDB.openDB();
    const start = job.sequence;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readwrite");
      const store = tx.objectStore("cards");
      const updatedAt = new Date().toISOString();
      valid.forEach((card, index) => store.add({
        id: crypto.randomUUID(),
        deckId: card.deckId,
        frontHtml: card.frontHtml,
        backHtml: card.backHtml,
        reviewStatus: null,
        createdAt: new Date(Date.now() + start + index).toISOString(),
        updatedAt
      }));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao gravar cards."));
    });

    job.sequence += valid.length;
    job.persisted += valid.length;
    for (const [deckId, amount] of increments) job.counts.set(deckId, (job.counts.get(deckId) || 0) + amount);
    return valid.length;
  }

  function persistStats(counts) {
    try {
      const parsed = JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
      const stats = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      const now = Date.now();
      for (const [deckId, total] of counts) stats[deckId] = { total, studied: 0, due: 0, nextFutureAt: null, updatedAt: now };
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (_) {}
  }

  function ack(token) {
    if (token && worker) worker.postMessage({ type: "ack", token });
  }

  async function finish(job, message) {
    await Promise.all([job.packagePromise, job.deckPromise, job.cardChain, job.refChain]);
    if (job.persisted !== Number(message.validCount || 0)) {
      throw new Error(`Persistência incompleta: ${job.persisted}/${message.validCount || 0} cards.`);
    }
    if (job.received !== Number(message.validCount || 0)) {
      throw new Error(`Recebimento incompleto: ${job.received}/${message.validCount || 0} cards.`);
    }

    persistStats(job.counts);
    await OituPackageMedia.updatePackage(job.packageId, {
      modern: Boolean(message.modern),
      ready: true,
      hotIds: Array.isArray(message.hotIds) ? message.hotIds : []
    });

    setProgress(100, `${job.persisted} cards importados e prontos para estudar.`, message.missingMedia ? "warning" : "success");
    setBusy(false);
    closeModal();
    refreshHome();
    activeJob = null;

    const hotIds = Array.isArray(message.hotIds) ? message.hotIds : [];
    if (hotIds.length) {
      const warm = () => OituPackageMedia.prewarm(hotIds, 80).catch(() => {});
      if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 500 });
      else setTimeout(warm, 0);
    }
  }

  function fail(message) {
    const job = activeJob;
    if (!job) return;
    console.error("Importação APKG otimizada falhou:", message);
    setProgress(0, message || "Não foi possível importar este pacote.", "error");
    setBusy(false);
    try { worker?.postMessage({ type: "cancel" }); } catch (_) {}
    activeJob = null;
  }

  function handleMessage(event) {
    const message = event.data || {};
    if (message.type === "ready") {
      workerReady = true;
      return;
    }
    const job = activeJob;
    if (message.type === "phase") {
      if (job) setProgress(message.progress || 1, message.message || "Processando pacote...");
      return;
    }
    if (!job) return;

    if (message.type === "structure") {
      job.modern = Boolean(message.modern);
      job.deckPromise = setupStructure(message, job)
        .then((map) => {
          OituPackageMedia.updatePackage(job.packageId, { modern: job.modern }).catch(() => {});
          ack(message.token);
          return map;
        })
        .catch((error) => { fail(error?.message); throw error; });
      return;
    }

    if (message.type === "cardBatch") {
      const cards = message.cards || [];
      job.received += cards.length;
      job.cardChain = job.cardChain
        .then(() => persistCards(job, cards))
        .then(() => ack(message.token))
        .catch((error) => { fail(error?.message); throw error; });
      const ratio = message.total ? Number(message.done || 0) / Number(message.total) : 0;
      setProgress(18 + ratio * 68, `Gravando cards: ${message.done || 0}/${message.total || 0}`);
      return;
    }

    if (message.type === "cardProgress") {
      const ratio = message.total ? Number(message.done || 0) / Number(message.total) : 0;
      setProgress(18 + ratio * 68, `Preparando cards: ${message.done || 0}/${message.total || 0}`);
      return;
    }

    if (message.type === "mediaRefs") {
      const refs = message.refs || [];
      job.refChain = job.refChain
        .then(() => OituPackageMedia.saveRefs(job.packageId, refs))
        .then(() => ack(message.token))
        .catch((error) => { fail(error?.message); throw error; });
      const ratio = message.total ? Number(message.done || 0) / Number(message.total) : 1;
      setProgress(88 + ratio * 8, `Indexando imagens: ${message.done || 0}/${message.total || 0}`);
      return;
    }

    if (message.type === "done") {
      finish(job, message).catch((error) => fail(error?.message || "Falha ao finalizar importação."));
      return;
    }

    if (message.type === "error") fail(message.message);
  }

  function start(file) {
    if (activeJob) return;
    if (!window.OituPackageMedia) {
      setProgress(0, "Armazenamento de mídia ainda não está pronto. Recarregue a página.", "error");
      return;
    }

    setBusy(true);
    setProgress(1, workerReady ? "Iniciando importação..." : "Preparando motor de importação...");
    const packageId = `package:${crypto.randomUUID()}`;
    const job = {
      id: crypto.randomUUID(),
      packageId,
      file,
      modern: false,
      sequence: 0,
      received: 0,
      persisted: 0,
      counts: new Map(),
      deckPromise: Promise.resolve(new Map()),
      cardChain: Promise.resolve(),
      refChain: Promise.resolve(),
      packagePromise: OituPackageMedia.savePackage({
        id: packageId,
        blob: file,
        name: file.name,
        size: file.size,
        ready: false,
        createdAt: new Date().toISOString()
      })
    };
    job.packagePromise.catch((error) => fail(error?.message || "Não foi possível salvar o pacote Anki."));
    activeJob = job;
    ensureWorker().postMessage({ type: "start", file, jobId: job.id });
  }

  window.addEventListener("change", (event) => {
    const input = event.target?.closest?.("#deckImportFileInput");
    if (isApkg(input?.files?.[0])) ensureWorker();
  }, true);

  window.addEventListener("click", (event) => {
    const button = event.target?.closest?.("#confirmImportButton");
    if (!button) return;
    const file = $("#deckImportFileInput")?.files?.[0];
    if (!isApkg(file)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    start(file);
  }, true);

  window.addEventListener("click", (event) => {
    if (!activeJob) return;
    if (!event.target?.closest?.("#cancelImportButton,#closeImportButton")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
