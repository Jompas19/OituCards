(function () {
  if (window.__oitucardsReviewModelSelectionState) return;
  window.__oitucardsReviewModelSelectionState = true;

  const MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  const SYSTEM_SETTINGS = {
    newIntervals: { hard: 1, medium: 2, good: 4, easy: 7 },
    multipliers: { hard: 1.2, medium: 1.8, good: 2.5, easy: 4 },
    maxIntervalDays: 180
  };
  const RATINGS = ["hard", "medium", "good", "easy"];
  let currentDeckId = null;
  let observer = null;
  let syncing = false;

  const $ = (selector) => document.querySelector(selector);

  function normalizeSettings(raw) {
    const source = raw || {};
    const intervals = source.newIntervals || source || {};
    const multipliers = source.multipliers || {};
    const max = Number.parseInt(source.maxIntervalDays, 10);
    const maxIntervalDays = Number.isInteger(max) && max >= 1 ? Math.min(3650, max) : 180;
    const newIntervals = {};
    const normalizedMultipliers = {};
    RATINGS.forEach((rating) => {
      const interval = Number.parseInt(intervals[rating], 10);
      newIntervals[rating] = Number.isInteger(interval) && interval >= 1 ? Math.min(maxIntervalDays, interval) : SYSTEM_SETTINGS.newIntervals[rating];
      const multiplier = Number.parseFloat(multipliers[rating]);
      normalizedMultipliers[rating] = Number.isFinite(multiplier) && multiplier >= 1 ? Math.min(10, Math.round(multiplier * 100) / 100) : SYSTEM_SETTINGS.multipliers[rating];
    });
    return { newIntervals, multipliers: normalizedMultipliers, maxIntervalDays };
  }

  function settingsEqual(a, b) {
    const left = normalizeSettings(a);
    const right = normalizeSettings(b);
    return left.maxIntervalDays === right.maxIntervalDays && RATINGS.every((rating) =>
      left.newIntervals[rating] === right.newIntervals[rating] && left.multipliers[rating] === right.multipliers[rating]
    );
  }

  function readModels() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.settings) : [];
    } catch (_) {
      return [];
    }
  }

  function matchingValue(settings) {
    if (settingsEqual(settings, SYSTEM_SETTINGS)) return "system";
    const model = readModels().find((item) => settingsEqual(settings, item.settings));
    return model ? `model:${model.id}` : "custom";
  }

  function validStoredValue(value) {
    if (value === "system") return value;
    if (String(value || "").startsWith("model:") && readModels().some((model) => `model:${model.id}` === value)) return value;
    return null;
  }

  async function resolveDeckId() {
    if (currentDeckId) return currentDeckId;
    const name = String($("#deckTitle")?.textContent || "").trim();
    if (!name) return null;
    const decks = await OituDB.getDecks();
    const matches = decks.filter((deck) => deck.name === name);
    if (matches.length === 1) currentDeckId = matches[0].id;
    return currentDeckId;
  }

  function ensureCustomOption(select) {
    let option = [...select.options].find((item) => item.value === "custom");
    if (!option) {
      option = new Option("Ajuste manual", "custom");
      select.add(option);
    }
    return option;
  }

  async function syncSelection() {
    if (syncing) return;
    const select = $("#reviewSettingsModelSelect");
    if (!select) return;
    const deckId = await resolveDeckId();
    if (!deckId) return;
    syncing = true;
    try {
      const deck = await OituDB.getDeck(deckId);
      if (!deck) return;
      let value;
      if (deck.reviewModelMode === "global") {
        value = "global";
      } else if (deck.reviewModelMode === "manual") {
        value = validStoredValue(deck.reviewModelId) || matchingValue(deck.reviewSettings);
      } else if (!deck.reviewSettings || settingsEqual(deck.reviewSettings, SYSTEM_SETTINGS)) {
        value = "global";
      } else {
        value = matchingValue(deck.reviewSettings);
      }

      if (value === "custom") ensureCustomOption(select);
      if ([...select.options].some((option) => option.value === value)) select.value = value;
    } finally {
      syncing = false;
    }
  }

  function watchSelect() {
    const select = $("#reviewSettingsModelSelect");
    if (!select || select.dataset.selectionStateObserved === "true") return;
    select.dataset.selectionStateObserved = "true";
    observer?.disconnect();
    observer = new MutationObserver(() => setTimeout(syncSelection, 0));
    observer.observe(select, { childList: true });
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const row = target.closest("[data-deck-id]");
    if (row && target.closest(".deck-name-button,[data-action=\"edit-deck\"]")) currentDeckId = row.dataset.deckId || currentDeckId;
    if (target.closest("#reviewSettingsButton")) {
      setTimeout(() => {
        watchSelect();
        syncSelection();
      }, 40);
    }
  }, true);

  function init() {
    watchSelect();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
