(function () {
  if (window.__oitucardsReviewCreationDefaultFix) return;
  window.__oitucardsReviewCreationDefaultFix = true;

  const MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  const MODEL_PROFILE_STORAGE_KEY = "OituCardsReviewPresetUnitsV2";
  const LEGACY_MODEL_UNIT_STORAGE_KEY = "OituCardsReviewPresetUnitsV1";
  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
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

  function normalizeUnit(value) {
    const raw = String(value || "").toLocaleLowerCase("pt-BR");
    if ([MINUTE, "minute", "minuto", "minutos", "min"].includes(raw)) return MINUTE;
    if ([HOUR, "hour", "hora", "horas", "h"].includes(raw)) return HOUR;
    return DAY;
  }

  function readModels() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((model) => model?.id && model?.settings) : [];
    } catch (_) {
      return [];
    }
  }

  function readProfiles() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MODEL_PROFILE_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function readLegacyUnits() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_MODEL_UNIT_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function profileForModel(model) {
    const settings = model?.settings || {};
    const units = settings.intervalUnits || {};
    const legacyInline = settings.intervalUnit ? normalizeUnit(settings.intervalUnit) : null;
    const stored = readProfiles()[model?.id];
    const legacyStored = readLegacyUnits()[model?.id];
    const fallback = legacyStored ? normalizeUnit(legacyStored) : DAY;

    return {
      hard: normalizeUnit(units.hard || stored?.hard || legacyInline || fallback),
      medium: normalizeUnit(units.medium || stored?.medium || legacyInline || fallback),
      good: normalizeUnit(units.good || stored?.good || legacyInline || fallback),
      easy: normalizeUnit(units.easy || stored?.easy || legacyInline || fallback),
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

    const result = {
      newIntervals: {
        hard: Math.max(1, Math.round(Number(intervals.hard) || SYSTEM_SETTINGS.newIntervals.hard)),
        medium: Math.max(1, Math.round(Number(intervals.medium) || SYSTEM_SETTINGS.newIntervals.medium)),
        good: Math.max(1, Math.round(Number(intervals.good) || SYSTEM_SETTINGS.newIntervals.good)),
        easy: Math.max(1, Math.round(Number(intervals.easy) || SYSTEM_SETTINGS.newIntervals.easy))
      },
      multipliers: {
        hard: Math.max(1, Number(multipliers.hard) || SYSTEM_SETTINGS.multipliers.hard),
        medium: Math.max(1, Number(multipliers.medium) || SYSTEM_SETTINGS.multipliers.medium),
        good: Math.max(1, Number(multipliers.good) || SYSTEM_SETTINGS.multipliers.good),
        easy: Math.max(1, Number(multipliers.easy) || SYSTEM_SETTINGS.multipliers.easy)
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

    const allUnits = [...RATINGS.map((rating) => result.intervalUnits[rating]), result.maxIntervalUnit];
    if (allUnits.every((unit) => unit === allUnits[0])) result.intervalUnit = allUnits[0];
    return result;
  }

  function currentGlobalValue() {
    const value = String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system");
    if (value === "system") return "system";
    if (!value.startsWith("model:")) return "system";
    const id = value.slice(6);
    return readModels().some((model) => model.id === id) ? value : "system";
  }

  function effectiveGlobalSettings(value) {
    if (value === "system") {
      return cloneSettings(SYSTEM_SETTINGS, { hard: DAY, medium: DAY, good: DAY, easy: DAY, max: DAY });
    }

    const id = String(value).slice(6);
    const model = readModels().find((item) => item.id === id);
    if (!model) {
      return cloneSettings(SYSTEM_SETTINGS, { hard: DAY, medium: DAY, good: DAY, easy: DAY, max: DAY });
    }
    return cloneSettings(model.settings, profileForModel(model));
  }

  function patchCreation() {
    if (!window.OituDB?.addDeck || OituDB.__reviewCreationDefaultFixPatched) return false;
    OituDB.__reviewCreationDefaultFixPatched = true;

    const previousAddDeck = OituDB.addDeck.bind(OituDB);

    OituDB.addDeck = async function (...args) {
      let deck = await previousAddDeck(...args);
      if (!deck?.id) return deck;

      const reviewModelId = currentGlobalValue();
      const reviewSettings = effectiveGlobalSettings(reviewModelId);
      try {
        deck = await OituDB.updateDeck(deck.id, {
          reviewSettings,
          reviewModelMode: "global",
          reviewModelId
        });
      } catch (error) {
        console.warn("OituCards: o baralho foi criado, mas o modelo geral não pôde ser reaplicado ao final da criação.", error);
      }
      return deck;
    };

    return true;
  }

  function init() {
    if (!patchCreation()) setTimeout(init, 50);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
