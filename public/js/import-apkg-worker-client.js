(function () {
  if (window.__oitucardsApkgWorkerClient) return;
  window.__oitucardsApkgWorkerClient = true;

  const WORKER_URL = "js/import-apkg-worker.js?v=20260901-1905";
  const STATS_KEY = "OituCardsDeckStatsV3";
  const DECK_CONCURRENCY = 6;

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
    const element = ensureMediaIndicator();
    element.textContent = text;
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
    worker.addEventListener("error", (event) => {
      failJob(event?.message || "Falha no motor de importação em segundo plano.");
    });
    worker.postMessage({ type: "warmup" });
    return worker;
  }

  function normalizeName(value) {
    return String(value || "").trim().toLocaleLowerCase("pt-BR");
  }

  async function createFolderPath(parts, folders, cache) {
    let parentId = null;
    for (const raw of parts) {
      const name = String(raw || "").trim().slice(0, 120);
      if (!name) continue;
      const key = `${parentId || "root"}\u0000${normalizeName(name)}`;
      let folder = cache.get(key);
      if (!folder) {
        folder = folders.find((item) => (item.parentId || null) === parentId && normalizeName(item.name) === normalizeName(name));
      }
      if (!folder) {
        folder = await OituDB.addFolder(name, parentId);
        folders.push(folder);
      }
      cache.set(key, folder);
      parentId = folder.id;
    }
    return parentId;
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

  async function runLimited(items, limit, task) {
    let cursor = 0;
    async function runner() {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        await task(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => runner()));
  }

  async function setupDecks(structure) {
    const [existingDecks, folders] = await Promise.all([OituDB.getDecks(), OituDB.getFolders()]);
    const used = new Set(existingDecks.map((deck) => normalizeName(deck.name)));
    const folderCache = new Map();
    const plans = [];

    // Primeiro cria apenas os caminhos de pasta únicos.
    for (const source of structure.decks || []) {
      const parts = String(source.name || "Baralho importado").split("::").map((part) => part.trim()).filter(Boolean);
      const leafBase = parts.pop() || "Baralho importado";
      const folderId = parts.length ? await createFolderPath(parts, folders, folderCache) : null;
      plans.push({ did: String(source.did), folderId, name: uniqueDeckName(leafBase, used) });
    }

    const map = new Map();
    let created = 0;
    await runLimited(plans, DECK_CONCURRENCY, async (plan) => {
      let deck = await OituDB.addDeck(plan.name);
      if (plan.folderId) deck = await OituDB.updateDeck(deck.id, { folderId: plan.folderId });
      map.set(plan.did, deck);
      created += 1;
      setProgress(10 + (created / Math.max(1, plans.length)) * 10, `Criando estrutura: ${created}/${plans.length}`);
    });
    return map;
  }

  async function persistCardBatch(cards) {
    const job = activeJob;
    if (!job) return;
    const deckMap = await job.deckSetupPromise;
    const valid = [];
    for (const card of cards || []) {
      const deck = deckMap.get(String(card.did));
      if (!deck) continue;
      valid.push({ deckId: deck.id, frontHtml: card.frontHtml, backHtml: card.backHtml });
    }
    if (!valid.length) return;

    const db = await OituDB.openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readwrite");
      const store = tx.objectStore("cards");
      const base = Date.now() + job.sequence;
      const updatedAt = new Date().toISOString();
      valid.forEach((card, local) => {
        const createdAt = new Date(base + local).toISOString();
        store.add({
          id: crypto.randomUUID(),
          deckId: card.deckId,
          frontHtml: card.frontHtml,
          backHtml: card.backHtml,
          reviewStatus: null,
          createdAt,
          updatedAt
        });
        job.countByDeck.set(card.deckId, (job.countByDeck.get(card.deckId) || 0) + 1);
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao gravar cards."));
    });
    job.sequence += valid.length;
  }

  function persistFreshStats(countByDeck) {
    try {
      const parsed = JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
      const out = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      const now = Date.now();
      for (const [deckId, total] of countByDeck) {
        out[deckId] = { total, studied: 0, due: 0, nextFutureAt: null, updatedAt: now };
      }
      localStorage.setItem(STATS_KEY, JSON.stringify(out));
    } catch (_) {}
  }

  function hydrateVisibleMedia() {
    const hydrate = window.OituScaleStorage?.hydrateElement;
    if (typeof hydrate !== "function") return;
    ["studyFront","studyBack","multiFront","multiBack","frontEditor","backEditor"].forEach((id) => {
      const root = document.getElementById(id);
      if (root) Promise.resolve(hydrate(root)).catch(() => {});
    });
  }

  async function finalizeCardsReady(message) {
    const job = activeJob;
    if (!job || job.cardsUiReleased) return;
    await job.persistChain;
    const deckMap = await job.deckSetupPromise;
    job.cardsUiReleased = true;
    persistFreshStats(job.countByDeck);

    const importedAt = new Date().toISOString();
    Promise.all([...deckMap.values()].map((deck) => OituDB.updateDeck(deck.id, {
      importedAt,
      importSource: extensionOf(job.file.name) || "apkg"
    }))).catch(() => {});

    setProgress(92, `Cards prontos. ${message.mediaCount || 0} imagens serão finalizadas sem bloquear o estudo.`, "success");
    setImportUiBusy(false);
    closeImportModal();
    refreshHome();

    if (Number(message.mediaCount) > 0) {
      updateMediaIndicator(`Cards prontos para estudar. Finalizando ${message.mediaCount} imagens em segundo plano…`);
    } else {
      finishMediaIndicator("Importação concluída. Cards prontos para estudar.");
      activeJob = null;
    }
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
      activeJob.totalCards = Number(message.cardCount) || 0;
      activeJob.deckSetupPromise = setupDecks(message).catch((error) => {
        failJob(error?.message || "Não foi possível criar a estrutura de baralhos.");
        throw error;
      });
      return;
    }

    if (message.type === "cardBatch") {
      const cards = message.cards || [];
      activeJob.persistChain = activeJob.persistChain.then(() => persistCardBatch(cards));
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
      finalizeCardsReady(message).catch((error) => failJob(error?.message || "Falha ao finalizar os cards."));
      return;
    }

    if (message.type === "mediaPhase") {
      if (Number(message.total) > 0) updateMediaIndicator(`Cards já disponíveis. Finalizando ${message.total} imagens…`);
      return;
    }

    if (message.type === "mediaBatch") {
      const records = message.records || [];
      activeJob.mediaWriteChain = activeJob.mediaWriteChain
        .then(() => writeMediaBatch(records, message.imported, message.total))
        .catch(() => {});
      return;
    }

    if (message.type === "mediaProgress") {
      updateMediaIndicator(`Cards já disponíveis. Finalizando imagens: ${message.imported || 0}/${message.total || 0}`);
      return;
    }

    if (message.type === "mediaDone") {
      const job = activeJob;
      job.mediaWriteChain.then(() => {
        hydrateVisibleMedia();
        if (message.warnings) {
          finishMediaIndicator(`Importação concluída. ${message.imported || 0} imagens prontas; ${message.warnings} não puderam ser importadas.`);
        } else {
          finishMediaIndicator(`Importação concluída. ${message.imported || 0} imagens prontas.`);
        }
        activeJob = null;
      });
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
      countByDeck: new Map(),
      deckSetupPromise: Promise.resolve(new Map()),
      persistChain: Promise.resolve(),
      mediaWriteChain: Promise.resolve(),
      cardsUiReleased: false
    };
    ensureWorker().postMessage({ type: "start", file, jobId: activeJob.id });
  }

  window.addEventListener("change", (event) => {
    const input = event.target?.closest?.("#deckImportFileInput");
    const file = input?.files?.[0];
    if (!isApkg(file)) return;
    ensureWorker();
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
