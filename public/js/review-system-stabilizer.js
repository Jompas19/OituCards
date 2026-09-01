(function () {
  if (window.__oitucardsReviewSystemStabilizer) return;
  window.__oitucardsReviewSystemStabilizer = true;

  const STORAGE_KEY = "OituCardsReviewTimeAuthorityV1";
  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
  const MINUTE = "minutes";
  const HOUR = "hours";
  const DAY = "days";
  const RATINGS = ["hard", "medium", "good", "easy"];
  const FIELDS = [...RATINGS, "max"];
  let activeDeckId = null;
  let saving = false;
  let dbPatched = false;
  let reviewObserverInstalled = false;
  let libraryTimer = null;

  const $ = (selector, root = document) => root.querySelector(selector);

  function normalizeUnit(value) {
    const raw = String(value || "").toLocaleLowerCase("pt-BR");
    if ([MINUTE, "minute", "minuto", "minutos", "min"].includes(raw)) return MINUTE;
    if ([HOUR, "hour", "hora", "horas", "h"].includes(raw)) return HOUR;
    return DAY;
  }

  function toMinutes(value, unit) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    const safe = normalizeUnit(unit);
    if (safe === MINUTE) return number;
    if (safe === HOUR) return number * 60;
    return number * 1440;
  }

  function profileForSettings(settings) {
    const source = settings || {};
    const units = source.intervalUnits || {};
    const legacy = source.intervalUnit ? normalizeUnit(source.intervalUnit) : null;
    return {
      hard: normalizeUnit(units.hard || legacy || DAY),
      medium: normalizeUnit(units.medium || legacy || DAY),
      good: normalizeUnit(units.good || legacy || DAY),
      easy: normalizeUnit(units.easy || legacy || DAY),
      max: normalizeUnit(source.maxIntervalUnit || legacy || DAY)
    };
  }

  function cloneSettings(settings, forcedProfile = null) {
    const source = settings || {};
    const profile = forcedProfile || profileForSettings(source);
    const intervals = source.newIntervals || source || {};
    const multipliers = source.multipliers || {};
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
      maxIntervalDays: Math.max(1, Math.round(Number(source.maxIntervalDays) || 180)),
      intervalUnits: {
        hard: normalizeUnit(profile.hard),
        medium: normalizeUnit(profile.medium),
        good: normalizeUnit(profile.good),
        easy: normalizeUnit(profile.easy)
      },
      maxIntervalUnit: normalizeUnit(profile.max)
    };
    const all = [...RATINGS.map((rating) => next.intervalUnits[rating]), next.maxIntervalUnit];
    if (all.every((unit) => unit === all[0])) next.intervalUnit = all[0];
    return next;
  }

  function readAuthority() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeAuthority(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data || {})); } catch (_) {}
  }

  function rememberDeck(id, settings, binding) {
    if (!id || !settings) return;
    const data = readAuthority();
    data[id] = {
      reviewSettings: cloneSettings(settings),
      reviewModelMode: binding.reviewModelMode,
      reviewModelId: binding.reviewModelId,
      updatedAt: new Date().toISOString()
    };
    writeAuthority(data);
  }

  function roundedInput(input, unit) {
    const raw = Number(input?.value);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const safe = normalizeUnit(unit);
    const value = safe === MINUTE ? Math.max(5, Math.round(raw / 5) * 5) : Math.max(1, Math.round(raw));
    if (input) input.value = String(value);
    return value;
  }

  function readForm() {
    const profile = {};
    for (const field of FIELDS) {
      profile[field] = normalizeUnit($(`select[data-review-time-scope="review"][data-review-time-field="${field}"]`)?.value);
    }
    const ids = { hard: "reviewHardDays", medium: "reviewMediumDays", good: "reviewGoodDays", easy: "reviewEasyDays", max: "reviewMaxDays" };
    const values = {};
    for (const field of FIELDS) {
      values[field] = roundedInput($(`#${ids[field]}`), profile[field]);
      if (!Number.isFinite(values[field])) return { error: "Preencha todos os intervalos com valores válidos." };
    }
    const maxMinutes = toMinutes(values.max, profile.max);
    if (RATINGS.some((rating) => toMinutes(values[rating], profile[rating]) > maxMinutes)) {
      return { error: "O intervalo inicial de nenhuma resposta pode ultrapassar o intervalo máximo definido." };
    }
    const multipliers = {
      hard: Number.parseFloat($("#reviewHardMultiplier")?.value),
      medium: Number.parseFloat($("#reviewMediumMultiplier")?.value),
      good: Number.parseFloat($("#reviewGoodMultiplier")?.value),
      easy: Number.parseFloat($("#reviewEasyMultiplier")?.value)
    };
    if (RATINGS.some((rating) => !Number.isFinite(multipliers[rating]) || multipliers[rating] < 1 || multipliers[rating] > 10)) {
      return { error: "Os multiplicadores devem ficar entre 1,0 e 10." };
    }
    return {
      settings: cloneSettings({
        newIntervals: { hard: values.hard, medium: values.medium, good: values.good, easy: values.easy },
        multipliers,
        maxIntervalDays: values.max,
        intervalUnits: { hard: profile.hard, medium: profile.medium, good: profile.good, easy: profile.easy },
        maxIntervalUnit: profile.max
      })
    };
  }

  function binding() {
    let value = String($("#reviewSettingsModelSelect")?.value || "custom");
    if (value === "__create_review_model__") value = "custom";
    if (value === "global") {
      return { reviewModelMode: "global", reviewModelId: String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system") };
    }
    return { reviewModelMode: "manual", reviewModelId: value === "custom" ? "custom" : value };
  }

  async function restoreForm() {
    if (!activeDeckId || !window.OituDB || !$("#reviewSettingsView")?.classList.contains("active")) return;
    try {
      const deck = await OituDB.getDeck(activeDeckId);
      const settings = deck?.reviewSettings;
      if (!settings) return;
      const intervals = settings.newIntervals || settings;
      const profile = profileForSettings(settings);
      const ids = { hard: "reviewHardDays", medium: "reviewMediumDays", good: "reviewGoodDays", easy: "reviewEasyDays", max: "reviewMaxDays" };
      const multiplierIds = { hard: "reviewHardMultiplier", medium: "reviewMediumMultiplier", good: "reviewGoodMultiplier", easy: "reviewEasyMultiplier" };
      for (const rating of RATINGS) {
        const input = $(`#${ids[rating]}`);
        if (input) input.value = String(intervals[rating]);
        const mult = $(`#${multiplierIds[rating]}`);
        if (mult) mult.value = String(settings.multipliers?.[rating] ?? "");
      }
      const max = $(`#${ids.max}`);
      if (max) max.value = String(settings.maxIntervalDays);
      for (const field of FIELDS) {
        const select = $(`select[data-review-time-scope="review"][data-review-time-field="${field}"]`);
        if (select) select.value = profile[field];
      }
    } catch (error) {
      console.warn("OituCards: não foi possível restaurar os ajustes do baralho.", error);
    }
  }

  async function saveDeck(event) {
    if (event.target?.id !== "reviewSettingsForm") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (saving) return;
    if (!activeDeckId || !window.OituDB) {
      alert("Não foi possível identificar o baralho deste ajuste.");
      return;
    }
    const result = readForm();
    const status = $("#reviewSettingsStatus");
    if (result.error) {
      if (status) status.textContent = result.error;
      return;
    }
    const modelBinding = binding();
    saving = true;
    const button = event.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      rememberDeck(activeDeckId, result.settings, modelBinding);
      await OituDB.updateDeck(activeDeckId, { reviewSettings: cloneSettings(result.settings), ...modelBinding });
      if (status) status.textContent = "Ajustes salvos.";
      setTimeout(() => {
        document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
        $("#deckView")?.classList.add("active");
        window.scrollTo({ top: 0, behavior: "instant" });
      }, 0);
    } catch (error) {
      console.error(error);
      if (status) status.textContent = "Não foi possível salvar os ajustes.";
    } finally {
      saving = false;
      if (button) button.disabled = false;
    }
  }

  function postponeFutureToday(card) {
    if (!card?.nextReviewAt) return card;
    const due = new Date(card.nextReviewAt);
    if (Number.isNaN(due.getTime())) return card;
    const now = new Date();
    if (due <= now) return card;
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    if (due > end) return card;
    return { ...card, nextReviewAt: new Date(end.getTime() + 1000).toISOString() };
  }

  function patchDatabase() {
    if (dbPatched || !window.OituDB?.getCardsByDeck) return false;
    dbPatched = true;
    const previousGetCardsByDeck = OituDB.getCardsByDeck.bind(OituDB);
    OituDB.getCardsByDeck = async function (...args) {
      const cards = await previousGetCardsByDeck(...args);
      return Array.isArray(cards) ? cards.map(postponeFutureToday) : cards;
    };
    return true;
  }

  function scheduleLibraryRender(delay = 100) {
    clearTimeout(libraryTimer);
    libraryTimer = setTimeout(() => {
      if (!$("#homeView")?.classList.contains("active")) return;
      Promise.resolve(window.OituLibrary?.render?.()).catch(() => {});
    }, delay);
  }

  function captureContext(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const row = target.closest("[data-deck-id]");
    if (row?.dataset.deckId && target.closest(".deck-name-button,[data-action=\"edit-deck\"]")) activeDeckId = row.dataset.deckId;
    if (target.closest("#reviewSettingsButton")) {
      [60, 180, 420, 800].forEach((delay) => setTimeout(restoreForm, delay));
    }
    if (target.closest("#homeButton,#studyHomeButton,#multiHome,#backHomeButton")) {
      scheduleLibraryRender(120);
      setTimeout(() => scheduleLibraryRender(0), 450);
    }
  }

  function installReviewObserver() {
    if (reviewObserverInstalled) return;
    const view = $("#reviewSettingsView");
    if (!view) return;
    reviewObserverInstalled = true;
    new MutationObserver(() => {
      if (!view.classList.contains("active")) return;
      [80, 220, 500].forEach((delay) => setTimeout(restoreForm, delay));
    }).observe(view, { attributes: true, attributeFilter: ["class"] });
  }

  function wrapStudy() {
    const api = window.OituStudy;
    if (!api?.openConfig || api.openConfig.__reviewSystemStabilizerWrapped) return;
    const previous = api.openConfig;
    const wrapped = async function (deckId, ...args) {
      if (typeof deckId === "string") activeDeckId = deckId;
      return previous.call(this, deckId, ...args);
    };
    wrapped.__reviewSystemStabilizerWrapped = true;
    api.openConfig = wrapped;
  }

  function init() {
    patchDatabase();
    wrapStudy();
    installReviewObserver();
    setTimeout(() => { patchDatabase(); wrapStudy(); installReviewObserver(); }, 0);
    setTimeout(() => { wrapStudy(); installReviewObserver(); }, 300);
  }

  window.addEventListener("submit", saveDeck, true);
  window.addEventListener("click", captureContext, true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
