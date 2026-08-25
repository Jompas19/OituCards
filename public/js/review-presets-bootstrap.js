(function () {
  if (window.__oitucardsReviewPresetsBootstrap) return;
  window.__oitucardsReviewPresetsBootstrap = true;

  const STORAGE_KEY = "OituCardsReviewPresetsV1";
  const SYSTEM_SETTINGS = {
    newIntervals: { hard: 1, medium: 2, good: 4, easy: 7 },
    multipliers: { hard: 1.2, medium: 1.8, good: 2.5, easy: 4 },
    maxIntervalDays: 180
  };

  let currentDeckId = null;
  let reentry = false;

  function clone(settings) {
    return {
      newIntervals: { ...settings.newIntervals },
      multipliers: { ...settings.multipliers },
      maxIntervalDays: settings.maxIntervalDays
    };
  }

  function readPreset(value) {
    if (value === "system") return clone(SYSTEM_SETTINGS);
    if (!value?.startsWith("preset:")) return null;
    try {
      const id = value.slice(7);
      const presets = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const preset = Array.isArray(presets) ? presets.find((item) => item?.id === id) : null;
      return preset?.settings ? clone(preset.settings) : null;
    } catch (_) {
      return null;
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const deckName = target.closest(".deck-name-button");
    const row = deckName?.closest("[data-deck-id]");
    if (row?.dataset.deckId) currentDeckId = row.dataset.deckId;
  }, true);

  document.addEventListener("submit", async (event) => {
    if (reentry || event.target?.id !== "studyConfigForm") return;
    const select = document.querySelector("#studyReviewPresetSelect");
    if (!select || select.value === "deck" || !currentDeckId) return;
    const settings = readPreset(select.value);
    if (!settings) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const originalValue = select.value;
    try {
      await OituDB.updateDeck(currentDeckId, { reviewSettings: settings });
      reentry = true;
      select.value = "deck";
      event.target.requestSubmit();
    } catch (error) {
      console.error(error);
      alert("Não foi possível aplicar o padrão de revisão.");
    } finally {
      select.value = originalValue;
      reentry = false;
    }
  }, true);

  const script = document.createElement("script");
  script.async = false;
  script.src = "js/review-presets.js?v=20260825-1528";
  script.dataset.oitucardsReviewPresetsCore = "true";
  script.onerror = () => console.error("Não foi possível carregar os padrões de revisão.");
  document.body.appendChild(script);
})();
