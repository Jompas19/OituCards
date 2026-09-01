(function () {
  if (window.__oitucardsReviewFinalAuthority) return;
  window.__oitucardsReviewFinalAuthority = true;

  const MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  const MODEL_PROFILE_STORAGE_KEY = "OituCardsReviewPresetUnitsV2";
  const LEGACY_MODEL_UNIT_STORAGE_KEY = "OituCardsReviewPresetUnitsV1";
  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
  const AUTHORITY_STORAGE_KEY = "OituCardsReviewTimeAuthorityV1";
  const MINUTE = "minutes";
  const HOUR = "hours";
  const DAY = "days";
  const RATINGS = ["hard", "medium", "good", "easy"];

  const SYSTEM_SETTINGS = Object.freeze({
    newIntervals: Object.freeze({ hard: 1, medium: 2, good: 4, easy: 7 }),
    multipliers: Object.freeze({ hard: 1.2, medium: 1.8, good: 2.5, easy: 4 }),
    maxIntervalDays: 180,
    intervalUnits: Object.freeze({ hard: DAY, medium: DAY, good: DAY, easy: DAY }),
    maxIntervalUnit: DAY,
    intervalUnit: DAY
  });

  let patched = false;
  let syncingFollowers = false;
  let countSyncTimer = null;

  function normalizeUnit(value) {
    const raw = String(value || "").toLocaleLowerCase("pt-BR");
    if ([MINUTE, "minute", "minuto", "minutos", "min"].includes(raw)) return MINUTE;
    if ([HOUR, "hour", "hora", "horas", "h"].includes(raw)) return HOUR;
    return DAY;
  }

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "");
      return parsed ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readModels() {
    const parsed = readJson(MODEL_STORAGE_KEY, []);
    return Array.isArray(parsed) ? parsed.filter((model) => model?.id && model?.settings) : [];
  }

  function modelProfile(model) {
    const settings = model?.settings || {};
    const inline = settings.intervalUnits || {};
    const profiles = readJson(MODEL_PROFILE_STORAGE_KEY, {});
    const stored = profiles && typeof profiles === "object" && !Array.isArray(profiles) ? profiles[model?.id] : null;
    const legacyMap = readJson(LEGACY_MODEL_UNIT_STORAGE_KEY, {});
    const legacyStored = legacyMap && typeof legacyMap === "object" && !Array.isArray(legacyMap) ? legacyMap[model?.id] : null;
    const legacyInline = settings.intervalUnit ? normalizeUnit(settings.intervalUnit) : null;
    const fallback = legacyStored ? normalizeUnit(legacyStored) : DAY;
    return {
      hard: normalizeUnit(inline.hard || stored?.hard || legacyInline || fallback),
      medium: normalizeUnit(inline.medium || stored?.medium || legacyInline || fallback),
      good: normalizeUnit(inline.good || stored?.good || legacyInline || fallback),
      easy: normalizeUnit(inline.easy || stored?.easy || legacyInline || fallback),
      max: normalizeUnit(settings.maxIntervalUnit || stored?.max || legacyInline || fallback)
    };
  }

  function cloneSettings(raw, profile) {
    const source = raw || SYSTEM_SETTINGS;
    const intervals = source.newIntervals || source || {};
    const multipliers = source.multipliers || {};
    const safeProfile = profile || { hard: DAY, medium: DAY, good: DAY, easy: DAY, max: DAY };
    const parsedMax = Math.round(Number(source.maxIntervalDays));
    const maxIntervalDays = Number.isFinite(parsedMax) && parsedMax >= 1 ? parsedMax : 180;
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
      maxIntervalDays,
      intervalUnits: {
        hard: normalizeUnit(safeProfile.hard),
        medium: normalizeUnit(safeProfile.medium),
        good: normalizeUnit(safeProfile.good),
        easy: normalizeUnit(safeProfile.easy)
      },
      maxIntervalUnit: normalizeUnit(safeProfile.max)
    };
    const all = [...RATINGS.map((rating) => next.intervalUnits[rating]), next.maxIntervalUnit];
    if (all.every((unit) => unit === all[0])) next.intervalUnit = all[0];
    return next;
  }

  function currentGlobalValue() {
    const stored = String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system");
    if (stored === "system") return "system";
    if (!stored.startsWith("model:")) return "system";
    const id = stored.slice(6);
    return readModels().some((model) => model.id === id) ? stored : "system";
  }

  function globalSettings(value = currentGlobalValue()) {
    if (value === "system") {
      return cloneSettings(SYSTEM_SETTINGS, { hard: DAY, medium: DAY, good: DAY, easy: DAY, max: DAY });
    }
    const id = String(value).slice(6);
    const model = readModels().find((item) => item.id === id);
    if (!model) return cloneSettings(SYSTEM_SETTINGS, { hard: DAY, medium: DAY, good: DAY, easy: DAY, max: DAY });
    return cloneSettings(model.settings, modelProfile(model));
  }

  function rememberAuthority(id, settings, modelId) {
    if (!id) return;
    const current = readJson(AUTHORITY_STORAGE_KEY, {});
    const data = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    data[id] = {
      reviewSettings: cloneSettings(settings, {
        hard: settings.intervalUnits?.hard,
        medium: settings.intervalUnits?.medium,
        good: settings.intervalUnits?.good,
        easy: settings.intervalUnits?.easy,
        max: settings.maxIntervalUnit
      }),
      reviewModelMode: "global",
      reviewModelId: modelId,
      updatedAt: new Date().toISOString()
    };
    try { localStorage.setItem(AUTHORITY_STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  async function readRawDecks() {
    const db = await OituDB.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readonly");
      const request = tx.objectStore("decks").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function persistGlobalDirect(id, modelId = currentGlobalValue(), settings = globalSettings(modelId)) {
    if (!id || !window.OituDB?.openDB) return null;
    const safeSettings = cloneSettings(settings, {
      hard: settings.intervalUnits?.hard,
      medium: settings.intervalUnits?.medium,
      good: settings.intervalUnits?.good,
      easy: settings.intervalUnits?.easy,
      max: settings.maxIntervalUnit
    });
    const db = await OituDB.openDB();
    const updated = await new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readwrite");
      const store = tx.objectStore("decks");
      const request = store.get(id);
      let value = null;
      request.onsuccess = () => {
        const current = request.result;
        if (!current || current.kind === "folder") return;
        value = {
          ...current,
          reviewSettings: safeSettings,
          reviewModelMode: "global",
          reviewModelId: modelId,
          updatedAt: new Date().toISOString()
        };
        store.put(value);
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Falha ao aplicar o modelo geral ao baralho."));
    });
    if (updated) rememberAuthority(id, safeSettings, modelId);
    return updated;
  }

  async function applyGlobalToDeck(id) {
    const modelId = currentGlobalValue();
    const settings = globalSettings(modelId);
    const raw = await persistGlobalDirect(id, modelId, settings);
    if (!raw) return null;
    try { return await OituDB.getDeck(id); } catch (_) { return raw; }
  }

  function patchCreation() {
    if (patched || !window.OituDB?.addDeck || !window.OituDB?.openDB) return false;
    patched = true;
    const previousAddDeck = OituDB.addDeck.bind(OituDB);
    OituDB.addDeck = async function (...args) {
      let deck = await previousAddDeck(...args);
      if (!deck?.id) return deck;
      try {
        deck = await applyGlobalToDeck(deck.id) || deck;
      } catch (error) {
        console.warn("OituCards: não foi possível aplicar o modelo geral final ao novo baralho.", error);
      }
      return deck;
    };
    return true;
  }

  async function syncGlobalFollowers() {
    if (syncingFollowers || !window.OituDB?.openDB) return;
    syncingFollowers = true;
    try {
      const modelId = currentGlobalValue();
      const settings = globalSettings(modelId);
      const decks = await readRawDecks();
      const followers = decks.filter((item) => item?.kind !== "folder" && item?.reviewModelMode === "global");
      for (const deck of followers) {
        await persistGlobalDirect(deck.id, modelId, settings);
      }
    } catch (error) {
      console.warn("OituCards: não foi possível sincronizar todos os baralhos que seguem o modelo geral.", error);
    } finally {
      syncingFollowers = false;
    }
  }

  async function revealAccurateCounts() {
    const list = document.querySelector("#deckList");
    if (list) list.classList.add("review-due-sync-pending");
    try {
      if (window.OituLibraryDueSync?.sync) await window.OituLibraryDueSync.sync();
    } catch (_) {}
    document.documentElement.classList.add("review-due-ready");
    if (list) list.classList.remove("review-due-sync-pending");
  }

  function scheduleCountSync(delay = 0) {
    clearTimeout(countSyncTimer);
    const list = document.querySelector("#deckList");
    if (list) list.classList.add("review-due-sync-pending");
    countSyncTimer = setTimeout(() => revealAccurateCounts(), delay);
  }

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-toggle-folder],#homeButton,#backHomeButton,#studyHomeButton,#multiHome")) {
      scheduleCountSync(target.closest("[data-toggle-folder]") ? 80 : 180);
    }
  }

  function handleChange(event) {
    if (event.target?.id !== "globalReviewModelSelect") return;
    setTimeout(() => syncGlobalFollowers(), 250);
    setTimeout(() => syncGlobalFollowers(), 900);
  }

  function handleSubmit(event) {
    if (event.target?.id !== "reviewModelForm") return;
    setTimeout(() => syncGlobalFollowers(), 350);
    setTimeout(() => syncGlobalFollowers(), 1000);
  }

  function init() {
    if (!patchCreation()) {
      setTimeout(init, 50);
      return;
    }
    syncGlobalFollowers().finally(() => scheduleCountSync(0));
  }

  window.addEventListener("click", handleClick, true);
  window.addEventListener("change", handleChange, true);
  window.addEventListener("submit", handleSubmit, true);
  window.OituReviewFinalAuthority = { syncGlobalFollowers, applyGlobalToDeck, revealAccurateCounts };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
