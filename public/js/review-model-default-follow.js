(function () {
  if (window.__oitucardsReviewModelDefaultFollow) return;
  window.__oitucardsReviewModelDefaultFollow = true;

  const MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
  const SYSTEM_SETTINGS = Object.freeze({
    newIntervals: Object.freeze({ hard: 1, medium: 2, good: 4, easy: 7 }),
    multipliers: Object.freeze({ hard: 1.2, medium: 1.8, good: 2.5, easy: 4 }),
    maxIntervalDays: 180
  });
  const RATINGS = ["hard", "medium", "good", "easy"];

  function normalizeSettings(raw) {
    const source = raw || {};
    const intervals = source.newIntervals || source || {};
    const multipliers = source.multipliers || {};
    const parsedMax = Number.parseInt(source.maxIntervalDays, 10);
    const maxIntervalDays = Number.isInteger(parsedMax) && parsedMax >= 1 && parsedMax <= 3650
      ? parsedMax
      : SYSTEM_SETTINGS.maxIntervalDays;
    const newIntervals = {};
    const normalizedMultipliers = {};

    RATINGS.forEach((rating) => {
      const interval = Number.parseInt(intervals[rating], 10);
      newIntervals[rating] = Number.isInteger(interval) && interval >= 1
        ? Math.min(maxIntervalDays, interval)
        : SYSTEM_SETTINGS.newIntervals[rating];

      const multiplier = Number.parseFloat(multipliers[rating]);
      normalizedMultipliers[rating] = Number.isFinite(multiplier) && multiplier >= 1
        ? Math.min(10, Math.round(multiplier * 100) / 100)
        : SYSTEM_SETTINGS.multipliers[rating];
    });

    return { newIntervals, multipliers: normalizedMultipliers, maxIntervalDays };
  }

  function cloneSettings(settings) {
    const normalized = normalizeSettings(settings);
    return {
      newIntervals: { ...normalized.newIntervals },
      multipliers: { ...normalized.multipliers },
      maxIntervalDays: normalized.maxIntervalDays
    };
  }

  function settingsEqual(a, b) {
    const left = normalizeSettings(a);
    const right = normalizeSettings(b);
    return left.maxIntervalDays === right.maxIntervalDays && RATINGS.every((rating) =>
      left.newIntervals[rating] === right.newIntervals[rating] &&
      left.multipliers[rating] === right.multipliers[rating]
    );
  }

  function readModels() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) || "[]");
      return Array.isArray(parsed)
        ? parsed.filter((item) => item?.id && item?.settings)
        : [];
    } catch (_) {
      return [];
    }
  }

  function currentGlobalValue() {
    const stored = String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system");
    if (stored === "system") return "system";
    if (stored.startsWith("model:") && readModels().some((model) => `model:${model.id}` === stored)) return stored;
    return "system";
  }

  function settingsForValue(value) {
    if (value === "system") return cloneSettings(SYSTEM_SETTINGS);
    if (String(value || "").startsWith("model:")) {
      const id = String(value).slice(6);
      const model = readModels().find((item) => item.id === id);
      if (model) return cloneSettings(model.settings);
    }
    return cloneSettings(SYSTEM_SETTINGS);
  }

  function globalPatch() {
    const value = currentGlobalValue();
    return {
      reviewSettings: settingsForValue(value),
      reviewModelMode: "global",
      reviewModelId: value
    };
  }

  function isImplicitGlobal(entity) {
    if (!entity || entity.reviewModelMode === "manual") return false;
    if (entity.reviewModelMode === "global") return true;
    return !entity.reviewSettings || settingsEqual(entity.reviewSettings, SYSTEM_SETTINGS);
  }

  function patchCreationDefaults() {
    if (!window.OituDB || OituDB.__reviewModelDefaultFollowPatched) return Boolean(window.OituDB);
    OituDB.__reviewModelDefaultFollowPatched = true;

    const previousAddDeck = OituDB.addDeck.bind(OituDB);
    const previousAddFolder = OituDB.addFolder.bind(OituDB);

    OituDB.addDeck = async function (...args) {
      const deck = await previousAddDeck(...args);
      if (!deck?.id || deck.reviewModelMode === "global") return deck;
      try {
        return await OituDB.updateDeck(deck.id, globalPatch());
      } catch (error) {
        console.warn("OituCards: o novo baralho foi criado, mas não pôde ser vinculado ao modelo padrão definido.", error);
        return deck;
      }
    };

    OituDB.addFolder = async function (...args) {
      const folder = await previousAddFolder(...args);
      if (!folder?.id || folder.reviewModelMode === "global") return folder;
      try {
        return await OituDB.updateFolder(folder.id, globalPatch());
      } catch (error) {
        console.warn("OituCards: a nova pasta foi criada, mas não pôde ser vinculada ao modelo padrão definido.", error);
        return folder;
      }
    };

    return true;
  }

  async function migrateImplicitFollowers() {
    if (!window.OituDB) return;
    const [decks, folders] = await Promise.all([OituDB.getDecks(), OituDB.getFolders()]);
    const patch = globalPatch();
    const implicitDecks = decks.filter((deck) => !deck.reviewModelMode && isImplicitGlobal(deck));
    const implicitFolders = folders.filter((folder) => !folder.reviewModelMode && isImplicitGlobal(folder));

    await Promise.all([
      ...implicitDecks.map((deck) => OituDB.updateDeck(deck.id, {
        ...patch,
        reviewSettings: cloneSettings(patch.reviewSettings)
      })),
      ...implicitFolders.map((folder) => OituDB.updateFolder(folder.id, {
        ...patch,
        reviewSettings: cloneSettings(patch.reviewSettings)
      }))
    ]);
  }

  function init() {
    if (!patchCreationDefaults()) {
      setTimeout(init, 50);
      return;
    }
    migrateImplicitFollowers().catch((error) => {
      console.warn("OituCards: não foi possível normalizar todos os itens que seguem o modelo padrão definido.", error);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
