(function () {
  if (window.__oitucardsFolderReviewUnitFix) return;
  window.__oitucardsFolderReviewUnitFix = true;

  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
  const MINUTE = "minutes";
  const HOUR = "hours";
  const DAY = "days";
  const RATINGS = ["hard", "medium", "good", "easy"];
  let applyContext = null;
  let dbPatched = false;

  const $ = (selector, root = document) => root.querySelector(selector);

  function normalizeUnit(value) {
    const raw = String(value || "").toLocaleLowerCase("pt-BR");
    if ([MINUTE, "minute", "minuto", "minutos", "min"].includes(raw)) return MINUTE;
    if ([HOUR, "hour", "hora", "horas", "h"].includes(raw)) return HOUR;
    return DAY;
  }

  function unitFor(field) {
    return normalizeUnit($(`select[data-review-time-scope="folder"][data-review-time-field="${field}"]`)?.value);
  }

  function readProfile() {
    return {
      hard: unitFor("hard"),
      medium: unitFor("medium"),
      good: unitFor("good"),
      easy: unitFor("easy"),
      max: unitFor("max")
    };
  }

  function bindingForFolder() {
    const selection = String($("#folderReviewModelSelect")?.value || "custom");
    if (selection === "global") {
      return {
        mode: "global",
        modelId: String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system")
      };
    }
    if (selection === "custom" || selection === "__create_review_model__") {
      return { mode: "manual", modelId: "custom" };
    }
    return { mode: "manual", modelId: selection };
  }

  function applicationActive() {
    if (!applyContext || applyContext.expiresAt <= Date.now()) return false;
    const modal = $("#folderReviewModal");
    return Boolean(modal && !modal.classList.contains("hidden"));
  }

  function withUnits(settings, profile) {
    const source = settings || {};
    const safe = profile || readProfile();
    const next = {
      ...source,
      newIntervals: { ...(source.newIntervals || {}) },
      multipliers: { ...(source.multipliers || {}) },
      intervalUnits: {
        hard: normalizeUnit(safe.hard),
        medium: normalizeUnit(safe.medium),
        good: normalizeUnit(safe.good),
        easy: normalizeUnit(safe.easy)
      },
      maxIntervalUnit: normalizeUnit(safe.max)
    };

    const all = [...RATINGS.map((rating) => next.intervalUnits[rating]), next.maxIntervalUnit];
    if (all.every((unit) => unit === all[0])) next.intervalUnit = all[0];
    else delete next.intervalUnit;
    return next;
  }

  function enrichPatch(patch) {
    if (!applicationActive() || !patch?.reviewSettings) return patch;
    return {
      ...patch,
      reviewSettings: withUnits(patch.reviewSettings, applyContext.profile),
      reviewModelMode: applyContext.mode,
      reviewModelId: applyContext.modelId
    };
  }

  function patchDatabase() {
    if (dbPatched || !window.OituDB?.updateDeck || !window.OituDB?.updateFolder) return false;
    dbPatched = true;

    const previousUpdateDeck = OituDB.updateDeck.bind(OituDB);
    const previousUpdateFolder = OituDB.updateFolder.bind(OituDB);

    OituDB.updateDeck = function (id, patch) {
      return previousUpdateDeck(id, enrichPatch(patch));
    };

    OituDB.updateFolder = function (id, patch) {
      return previousUpdateFolder(id, enrichPatch(patch));
    };
    return true;
  }

  function prepareFolderApply(event) {
    if (event.target?.id !== "folderReviewForm") return;
    const binding = bindingForFolder();
    applyContext = {
      profile: readProfile(),
      mode: binding.mode,
      modelId: binding.modelId,
      expiresAt: Date.now() + 120000
    };
  }

  function clearWhenClosing(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-enh-close="folderReviewModal"]')) applyContext = null;
  }

  function init() {
    patchDatabase();
    setTimeout(patchDatabase, 0);
    setTimeout(patchDatabase, 250);
  }

  document.addEventListener("submit", prepareFolderApply, true);
  document.addEventListener("click", clearWhenClosing, true);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();