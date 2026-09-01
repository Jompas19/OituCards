(function () {
  if (window.__oitucardsApkgWorkerClient) return;
  window.__oitucardsApkgWorkerClient = true;

  const WORKER_URL = "js/import-apkg-worker.js?v=20260901-1905";
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

  function setImportUiBusy(busy) {
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

  function ensureMediaIndicator() {
    let element = $("#largeImportMediaProgress");
    if (element) return element;
    element = document.createElement("div");
    element.id = "largeImportMediaProgress";
    element.setAttribute("role", "status");
    element.style.cssText = [
      "position:fixed", "right:18px", "bottom:18px", "z-index:10000",
      "max-width:min(390px,calc(100vw - 36px))", "padding:12px 14px",
      "border-radius:14px", "background:var(--surface,#fff)",
      "color:var(--text,#111827)", "box-shadow:0 12px 34px rgba(0,0,0,.16)",
      "border:1px solid var(--border,#e5e7eb)", "font-size:13px", "line-height:1.35"
    ].join(";");
    document.body.appendChild(element);
    return element;
  }

  function updateMediaIndicator(text) {
    ensureMediaIndicator().textContent = text;
  }

  function finishMediaIndicator(text) {
    const element = ensureMediaIndicator();
    element.textContent = text;
    setTimeout(() => element.remove(), 3200);
  }

  function closeImportModal() {
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
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", (event) => failJob(event?.message || "Falha no motor de importação em segundo plano."));
    worker.postMessage({ type: "warmup" });
    return worker;
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "");
      return value ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function normalizeUnit(value) {
    const raw = String(value || "").toLocaleLowerCase("pt-BR");
    if (["minutes", "minute", "minuto", "minutos", "min"].includes(raw)) return "minutes";
    if (["hours", "hour", "hora", "horas", "h"].includes(raw)) return "hours";
    return DAY;
  }

  function cloneReviewSettings(raw, profile) {
    const source = raw || {};
    const intervals = source.newIntervals || source || {};
    const multipliers = source.multipliers || {};
    const safeProfile = profile || { hard: DAY, medium: DAY, good: DAY, easy: DAY, max: DAY };
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
        hard: normalizeUnit(safeProfile.hard),
        medium: normalizeUnit(safeProfile.medium),
        good: normalizeUnit(safeProfile.good),
        easy: normalizeUnit(safeProfile.easy)
      },
      maxIntervalUnit: normalizeUnit(safeProfile.max)
    };
    const units = [next.intervalUnits.hard, next.intervalUnits.medium, next.intervalUnits.good, next.intervalUnits.easy, next.maxIntervalUnit];
    if (units.every((unit) => unit === units[0])) next.intervalUnit = units[0];
    return next;
  }

  function globalReviewSnapshot() {
    const models = readJson(MODEL_STORAGE_KEY, []);
    const validModels = Array.isArray(models) ? models.filter((model) => model?.id && model?.settings) : [];
    let modelId = String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system");
    if (modelId !== "system") {
      const id = modelId.startsWith("model:") ? modelId.slice(6) : "";
      if (!id || !validModels.some((model) => model.id === id)) modelId = "system";
    }

    if (modelId === "system") {
      return {
        modelId,
        settings: cloneReviewSettings({
          newIntervals: { hard: 1, medium: 2, good: 4, easy: 7 },
          multipliers: { hard: 1.2, medium: 1.8, good: 2.5, easy: 4 },
          maxIntervalDays: 180
        }, { hard: DAY, medium: DAY, good: DAY, easy: DAY, max: DAY })
      };
    }

    const id = modelId.slice(6);
    const model = validModels.find((item) => item.id === id);
    const inline = model?.settings?.intervalUnits || {};
    const profiles = readJson(MODEL_PROFILE_STORAGE_KEY, {});
    const stored = profiles && typeof profiles === "object" && !Array.isArray(profiles) ? profiles[id] : null;
    const legacyMap = readJson(LEGACY_MODEL_UNIT_STORAGE_KEY, {});
    const legacyStored = legacyMap && typeof legacyMap === "object" && !Array.isArray(legacyMap) ? legacyMap[id] : null;
    const legacyInline = model?.settings?.intervalUnit ? normalizeUnit(model.settings.intervalUnit) : null;
    const fallback = legacyStored ? normalizeUnit(legacyStored) : DAY;
    const profile = {
      hard: normalizeUnit(inline.hard || stored?.hard || legacyInline || fallback),
      medium: normalizeUnit(inline.medium || stored?.medium || legacyInline || fallback),
      good: normalizeUnit(inline.good || stored?.good || legacyInline || fallback),
      easy: normalizeUnit(inline.easy || stored?.easy || legacyInline || fallback),
      max: normalizeUnit(model?.settings?.maxIntervalUnit || stored?.max || legacyInline || fallback)
    };
    return { modelId, settings: cloneReviewSettings(model?.settings, profile) };
  }

  function normalizeName(value) {
    return String(value || "").trim().toLocaleLowerCase("pt-BR");
  }

  function uniqueDeckName(base, used) {
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

  function rememberAuthorityBatch(records, snapshot) {
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

  async function setupDecksBulk(structure, job) {
    setProgress(10, `Preparando estrutura de ${structure.decks?.length || 0} baralhos...`);
    const existing = await OituDB.getDecks();
    const existingFolders = await OituDB.getFolders();
    const usedDeckNames = new Set(existing.map((deck) => normalizeName(deck.name)));
    const snapshot = globalReviewSnapshot();
    const createdAtBase = Date.now();
    const newFolders = [];
    const newDecks = [];
    const folderByPath = new Map();
    const existingByParentName = new Map();

    for (const folder of existingFolders) {
      existingByParentName.set(`${folder.parentId || "root"}\u0000${normalizeName(folder.name)}`, folder);
    }

    function ensureFolderPath(parts) {
      let parentId = null;
      let pathKey = "";
      for (const raw of parts) {
        const name = String(raw || "").trim().slice(0, 120);
        if (!name) continue;
        pathKey += `/${normalizeName(name)}`;
        let folder = folderByPath.get(pathKey);
        if (!folder) folder = existingByParentName.get(`${parentId || "root"}\u0000${normalizeName(name)}`);
        if (!folder) {
          const now = new Date(createdAtBase + newFolders.length).toISOString();
          folder = {
            id: crypto.randomUUID(),
            kind: "folder",
            name,
            parentId,
            reviewSettings: structuredClone(snapshot.settings),
            reviewModelMode: "global",
            reviewModelId: snapshot.modelId,
            createdAt: now,
            updatedAt: now
          };
          newFolders.push(folder);
          existingByParentName.set(`${parentId || "root"}\u0000${normalizeName(name)}`, folder);
        }
        folderByPath.set(pathKey, folder);
        parentId = folder.id;
      }
      return parentId;
    }

    const deckMap = new Map();
    for (const source of structure.decks || []) {
      const parts = String(source.name || "Baralho importado").split("::").map((part) => part.trim()).filter(Boolean);
      const leaf = uniqueDeckName(parts.pop() || "Baralho importado", usedDeckNames);
      const folderId = parts.length ? ensureFolderPath(parts) : null;
      const now = new Date(createdAtBase + newFolders.length + newDecks.length + 1).toISOString();
      const deck = {
        id: crypto.randomUUID(),
        kind: "deck",
        name: leaf,
        folderId,
        reviewSettings: structuredClone(snapshot.settings),
        reviewModelMode: "global",
        reviewModelId: snapshot.modelId,
        importedAt: now,
        importSource: extensionOf(job.file.name) || "apkg",
        createdAt: now,
        updatedAt: now
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
        for (const record of records) store.add(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Falha ao gravar a estrutura importada."));
      });
      rememberAuthorityBatch(records, snapshot);
      window.OituLibraryEntitySnapshot?.invalidate?.();
    }

    setProgress(20, `Estrutura pronta: ${newDecks.length} baralhos. Preparando cards...`);
    return deckMap;
  }

  async function persistCardBatch(job, cards) {
    if (!job) return 0;
    const deckMap = await job.deckSetupPromise;
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
    const sequenceStart = job.sequence;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readwrite");
      const store = tx.objectStore("cards");
      const base = Date.now() + sequenceStart;
      const updatedAt = new Date().toISOString();
      for (let local = 0; local < valid.length; local += 1) {
        const card = valid[local];
        store.add({
          id: crypto.randomUUID(),
          deckId: card.deckId,
          frontHtml: card.frontHtml,
          backHtml: card.backHtml,
          reviewStatus: null,
          createdAt: new Date(base + local).toISOString(),
          updatedAt
        });
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao gravar cards."));
    });

    job.sequence += valid.length;
    job.persistedCards += valid.length;
    for (const [deckId, amount] of increments) job.countByDeck.set(deckId, (job.countByDeck.get(deckId) || 0) + amount);
    return valid.length;
  }

  function persistFreshStats(countByDeck) {
    try {
      const parsed = JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
      const out = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      const now = Date.now();
      for (const [deckId, total] of countByDeck) out[deckId] = { total, studied: 0, due: 0, nextFutureAt: null, updatedAt: now };
      localStorage.setItem(STATS_KEY, JSON.stringify(out));
    } catch (_) {}
  }

  function hydrateVisibleMedia() {
    const hydrate = window.OituScaleStorage?.hydrateElement;
    if (typeof hydrate !== "function") return;
    ["studyFront", "studyBack", "multiFront", "multiBack", "frontEditor", "backEditor"].forEach((id) => {
      const root = document.getElementById(id);
      if (root) Promise.resolve(hydrate(root)).catch(() => {});
    });
  }

  async function finalizeCardsReady(job, message) {
    if (!job || job.cardsUiReleased) return;
    await job.persistChain;
    await job.deckSetupPromise;
    if (job.persistedCards !== job.receivedCards) {
      throw new Error(`Persistência incompleta: ${job.persistedCards}/${job.receivedCards} cards gravados.`);
    }
    job.cardsUiReleased = true;
    persistFreshStats(job.countByDeck);
    setProgress(92, `${job.persistedCards} cards prontos. ${message.mediaCount || 0} imagens serão finalizadas sem bloquear o estudo.`, "success");
    setImportUiBusy(false);
    closeImportModal();
    refreshHome();
    if (Number(message.mediaCount) > 0) updateMediaIndicator(`Cards prontos para estudar. Finalizando ${message.mediaCount} imagens em segundo plano…`);
  }

  async function writeMediaBatch(records, imported, total) {
    if (!records?.length || !window.OituScaleStorage?.putMediaBatch) return;
    await OituScaleStorage.putMediaBatch(records);
    hydrateVisibleMedia();
    updateMediaIndicator(`Cards já disponíveis. Finalizando imagens: ${Math.min(imported || 0, total || 0)}/${total || 0}`);
  }

  function failJob(message) {
    const job = activeJob;
    if (!job) return;
    console.error("Importação APKG em Worker falhou:", message);
    if (!job.cardsUiReleased) {
      setProgress(0, message || "Não foi possível importar este pacote.", "error");
      setImportUiBusy(false);
    } else {
      finishMediaIndicator("Os cards foram importados, mas algumas imagens não puderam ser finalizadas.");
    }
    activeJob = null;
  }

  function handleWorkerMessage(event) {
    const message = event.data || {};
    if (message.type === "ready") {
      workerReady = true;
      return;
    }
    if (message.type === "phase") {
      if (activeJob) setProgress(message.progress || 1, message.message || "Processando pacote...");
      return;
    }
    if (!activeJob) return;

    if (message.type === "structure") {
      const job = activeJob;
      job.totalCards = Number(message.cardCount) || 0;
      job.deckSetupPromise = setupDecksBulk(message, job).catch((error) => {
        failJob(error?.message || "Não foi possível criar a estrutura de baralhos.");
        throw error;
      });
      return;
    }

    if (message.type === "cardBatch") {
      const job = activeJob;
      const cards = message.cards || [];
      job.receivedCards += cards.length;
      job.persistChain = job.persistChain.then(() => persistCardBatch(job, cards));
      const ratio = message.total ? Number(message.done || 0) / Number(message.total) : 0;
      setProgress(20 + ratio * 68, `Preparando e gravando cards: ${message.done || 0}/${message.total || 0}`);
      return;
    }

    if (message.type === "cardProgress") {
      const ratio = message.total ? Number(message.done || 0) / Number(message.total) : 0;
      setProgress(20 + ratio * 68, `Preparando cards: ${message.done || 0}/${message.total || 0}`);
      return;
    }

    if (message.type === "cardsDone") {
      const job = activeJob;
      job.cardsReadyPromise = finalizeCardsReady(job, message).catch((error) => {
        failJob(error?.message || "Falha ao finalizar os cards.");
        throw error;
      });
      return;
    }

    if (message.type === "mediaPhase") {
      if (Number(message.total) > 0) updateMediaIndicator(`Cards já disponíveis. Finalizando ${message.total} imagens…`);
      return;
    }

    if (message.type === "mediaBatch") {
      const job = activeJob;
      job.mediaWriteChain = job.mediaWriteChain.then(() => writeMediaBatch(message.records || [], message.imported, message.total)).catch(() => {});
      return;
    }

    if (message.type === "mediaProgress") {
      updateMediaIndicator(`Cards já disponíveis. Finalizando imagens: ${message.imported || 0}/${message.total || 0}`);
      return;
    }

    if (message.type === "mediaDone") {
      const job = activeJob;
      Promise.all([job.cardsReadyPromise, job.persistChain, job.mediaWriteChain, job.deckSetupPromise]).then(() => {
        if (!job.cardsUiReleased) return;
        hydrateVisibleMedia();
        if (message.warnings) finishMediaIndicator(`Importação concluída. ${message.imported || 0} imagens prontas; ${message.warnings} não puderam ser importadas.`);
        else if (message.imported) finishMediaIndicator(`Importação concluída. ${message.imported || 0} imagens prontas.`);
        else finishMediaIndicator(`Importação concluída. ${job.persistedCards} cards prontos para estudar.`);
        if (activeJob === job) activeJob = null;
      }).catch(() => {});
      return;
    }

    if (message.type === "error") failJob(message.message);
  }

  function startImport(file) {
    if (activeJob) {
      alert("Já existe uma importação grande em andamento. Aguarde a finalização das imagens antes de iniciar outra.");
      return;
    }
    setImportUiBusy(true);
    setProgress(1, workerReady ? "Iniciando importação otimizada..." : "Preparando motor de importação...");
    activeJob = {
      id: crypto.randomUUID(),
      file,
      totalCards: 0,
      sequence: 0,
      receivedCards: 0,
      persistedCards: 0,
      countByDeck: new Map(),
      deckSetupPromise: Promise.resolve(new Map()),
      persistChain: Promise.resolve(),
      cardsReadyPromise: Promise.resolve(),
      mediaWriteChain: Promise.resolve(),
      cardsUiReleased: false
    };
    ensureWorker().postMessage({ type: "start", file, jobId: activeJob.id });
  }

  window.addEventListener("change", (event) => {
    const input = event.target?.closest?.("#deckImportFileInput");
    const file = input?.files?.[0];
    if (isApkg(file)) ensureWorker();
  }, true);

  window.addEventListener("click", (event) => {
    const confirm = event.target?.closest?.("#confirmImportButton");
    if (!confirm) return;
    const file = $("#deckImportFileInput")?.files?.[0];
    if (!isApkg(file)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startImport(file);
  }, true);

  window.addEventListener("click", (event) => {
    if (!activeJob || activeJob.cardsUiReleased) return;
    if (!event.target?.closest?.("#cancelImportButton,#closeImportButton")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();