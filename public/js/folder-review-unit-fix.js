(function () {
  if (window.__oitucardsReviewTimeAuthorityV1) return;
  window.__oitucardsReviewTimeAuthorityV1 = true;

  const STORAGE_KEY = "OituCardsReviewTimeAuthorityV1";
  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
  const MINUTE = "minutes";
  const HOUR = "hours";
  const DAY = "days";
  const RATINGS = ["hard", "medium", "good", "easy"];
  const FIELDS = [...RATINGS, "max"];

  let activeFolderId = null;
  let applyingFolder = false;
  let dbPatched = false;
  let observersInstalled = false;
  const renderPending = { study: false, multi: false };

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

  function cloneSettings(settings) {
    const source = settings || {};
    const profile = profileForSettings(source);
    const intervals = source.newIntervals || source;
    const multipliers = source.multipliers || {};
    const next = {
      newIntervals: {
        hard: Math.max(1, Math.round(Number(intervals?.hard) || 1)),
        medium: Math.max(1, Math.round(Number(intervals?.medium) || 2)),
        good: Math.max(1, Math.round(Number(intervals?.good) || 4)),
        easy: Math.max(1, Math.round(Number(intervals?.easy) || 7))
      },
      multipliers: {
        hard: Math.max(1, Number(multipliers?.hard) || 1.2),
        medium: Math.max(1, Number(multipliers?.medium) || 1.8),
        good: Math.max(1, Number(multipliers?.good) || 2.5),
        easy: Math.max(1, Number(multipliers?.easy) || 4)
      },
      maxIntervalDays: Math.max(1, Math.round(Number(source.maxIntervalDays) || 180)),
      intervalUnits: {
        hard: profile.hard,
        medium: profile.medium,
        good: profile.good,
        easy: profile.easy
      },
      maxIntervalUnit: profile.max
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data || {}));
    } catch (_) {}
  }

  function authoritative(id) {
    if (!id) return null;
    const entry = readAuthority()[id];
    return entry?.reviewSettings ? entry : null;
  }

  function rememberAuthority(id, settings, metadata = {}) {
    if (!id || !settings) return;
    const data = readAuthority();
    data[id] = {
      reviewSettings: cloneSettings(settings),
      ...(metadata.reviewModelMode ? { reviewModelMode: metadata.reviewModelMode } : {}),
      ...(metadata.reviewModelId ? { reviewModelId: metadata.reviewModelId } : {}),
      updatedAt: new Date().toISOString()
    };
    writeAuthority(data);
  }

  function forgetAuthority(id) {
    if (!id) return;
    const data = readAuthority();
    if (!data[id]) return;
    delete data[id];
    writeAuthority(data);
  }

  function overlayEntity(entity) {
    if (!entity?.id) return entity;
    const entry = authoritative(entity.id);
    if (!entry) return entity;
    return {
      ...entity,
      reviewSettings: cloneSettings(entry.reviewSettings),
      ...(entry.reviewModelMode ? { reviewModelMode: entry.reviewModelMode } : {}),
      ...(entry.reviewModelId ? { reviewModelId: entry.reviewModelId } : {})
    };
  }

  function hasExplicitUnits(settings) {
    return Boolean(settings?.intervalUnits || settings?.maxIntervalUnit || settings?.intervalUnit);
  }

  function roundedInput(input, unit) {
    const raw = Number(input?.value);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const safe = normalizeUnit(unit);
    const value = safe === MINUTE
      ? Math.max(5, Math.round(raw / 5) * 5)
      : Math.max(1, Math.round(raw));
    if (input && String(input.value) !== String(value)) input.value = String(value);
    return value;
  }

  function folderUnit(field) {
    return normalizeUnit($(`select[data-review-time-scope="folder"][data-review-time-field="${field}"]`)?.value);
  }

  function readFolderSettings() {
    const profile = {
      hard: folderUnit("hard"),
      medium: folderUnit("medium"),
      good: folderUnit("good"),
      easy: folderUnit("easy"),
      max: folderUnit("max")
    };
    const ids = {
      hard: "folderRevHardDays",
      medium: "folderRevMediumDays",
      good: "folderRevGoodDays",
      easy: "folderRevEasyDays",
      max: "folderRevMax"
    };
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
      hard: Number.parseFloat($("#folderRevHardMult")?.value),
      medium: Number.parseFloat($("#folderRevMediumMult")?.value),
      good: Number.parseFloat($("#folderRevGoodMult")?.value),
      easy: Number.parseFloat($("#folderRevEasyMult")?.value)
    };
    if (RATINGS.some((rating) => !Number.isFinite(multipliers[rating]) || multipliers[rating] < 1 || multipliers[rating] > 10)) {
      return { error: "Os multiplicadores devem ficar entre 1,0 e 10." };
    }

    return {
      settings: cloneSettings({
        newIntervals: {
          hard: values.hard,
          medium: values.medium,
          good: values.good,
          easy: values.easy
        },
        multipliers,
        maxIntervalDays: values.max,
        intervalUnits: {
          hard: profile.hard,
          medium: profile.medium,
          good: profile.good,
          easy: profile.easy
        },
        maxIntervalUnit: profile.max
      })
    };
  }

  function folderBinding() {
    let selection = String($("#folderReviewModelSelect")?.value || "custom");
    if (selection === "__create_review_model__") selection = "custom";
    if (selection === "global") {
      return {
        reviewModelMode: "global",
        reviewModelId: String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system")
      };
    }
    return {
      reviewModelMode: "manual",
      reviewModelId: selection === "custom" ? "custom" : selection
    };
  }

  function descendantsOf(folderId, folders) {
    const children = new Map();
    for (const folder of folders) {
      const parent = folder.parentId || null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(folder.id);
    }
    const result = [];
    const visit = (id) => {
      for (const childId of children.get(id) || []) {
        result.push(childId);
        visit(childId);
      }
    };
    visit(folderId);
    return result;
  }

  function closeFolderReviewModal() {
    $("#folderReviewModal")?.classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2600);
  }

  async function applyFolderSettings(folderId, settings) {
    const [folder, folders, decks] = await Promise.all([
      OituDB.getFolder(folderId),
      OituDB.getFolders(),
      OituDB.getDecks()
    ]);
    if (!folder) throw new Error("Pasta não encontrada.");

    const folderIds = new Set([folderId, ...descendantsOf(folderId, folders)]);
    const affectedDecks = decks.filter((deck) => folderIds.has(deck.folderId || null));
    const subfolderCount = folderIds.size - 1;
    const message = `Aplicar estas regras à pasta “${folder.name}”${subfolderCount ? `, a ${subfolderCount} ${subfolderCount === 1 ? "subpasta" : "subpastas"}` : ""} e a ${affectedDecks.length} ${affectedDecks.length === 1 ? "baralho" : "baralhos"}?\n\nOs ajustes de revisão atuais desses baralhos serão substituídos.`;
    if (!window.confirm(message)) return false;

    const binding = folderBinding();
    for (const id of folderIds) {
      rememberAuthority(id, settings, binding);
      await OituDB.updateFolder(id, { reviewSettings: cloneSettings(settings), ...binding });
    }
    for (const deck of affectedDecks) {
      rememberAuthority(deck.id, settings, binding);
      await OituDB.updateDeck(deck.id, { reviewSettings: cloneSettings(settings), ...binding });
    }
    return true;
  }

  async function restoreFolderForm(folderId) {
    if (!folderId || !window.OituDB) return;
    const modal = $("#folderReviewModal");
    if (!modal || modal.classList.contains("hidden")) return;
    try {
      const folder = await OituDB.getFolder(folderId);
      const settings = folder?.reviewSettings;
      if (!settings) return;
      const profile = profileForSettings(settings);
      const intervals = settings.newIntervals || settings;
      const values = {
        folderRevHardDays: intervals?.hard,
        folderRevMediumDays: intervals?.medium,
        folderRevGoodDays: intervals?.good,
        folderRevEasyDays: intervals?.easy,
        folderRevHardMult: settings.multipliers?.hard,
        folderRevMediumMult: settings.multipliers?.medium,
        folderRevGoodMult: settings.multipliers?.good,
        folderRevEasyMult: settings.multipliers?.easy,
        folderRevMax: settings.maxIntervalDays
      };
      for (const [id, value] of Object.entries(values)) {
        const input = $(`#${id}`);
        if (input && Number.isFinite(Number(value))) input.value = String(value);
      }
      for (const field of FIELDS) {
        const select = $(`select[data-review-time-scope="folder"][data-review-time-field="${field}"]`);
        if (select) select.value = profile[field];
      }
    } catch (error) {
      console.warn("OituCards: não foi possível restaurar a configuração temporal da pasta.", error);
    }
  }

  function reviewCount(card) {
    if (Number.isInteger(card?.reviewCount) && card.reviewCount >= 0) return card.reviewCount;
    if (card?.lastReviewedAt || card?.nextReviewAt || RATINGS.includes(card?.lastRating)) return 1;
    return 0;
  }

  function unitRank(unit) {
    const safe = normalizeUnit(unit);
    return safe === MINUTE ? 0 : safe === HOUR ? 1 : 2;
  }

  function coarserUnit(a, b) {
    return unitRank(a) >= unitRank(b) ? normalizeUnit(a) : normalizeUnit(b);
  }

  function promoteRounded(rawMinutes, requestedUnit) {
    const minutes = Math.max(0, Number(rawMinutes) || 0);
    let unit = normalizeUnit(requestedUnit);

    if (unit === MINUTE) {
      const value = Math.max(5, Math.round(minutes / 5) * 5);
      if (value < 60) return { value, unit: MINUTE, minutes: value };
      unit = HOUR;
    }

    if (unit === HOUR) {
      const value = Math.max(1, Math.round(minutes / 60));
      if (value < 24) return { value, unit: HOUR, minutes: value * 60 };
      unit = DAY;
    }

    const value = Math.max(1, Math.round(minutes / 1440));
    return { value, unit: DAY, minutes: value * 1440 };
  }

  function currentDuration(card, settings, profile) {
    const explicit = Number(card?.currentIntervalMinutes);
    if (Number.isFinite(explicit) && explicit > 0) {
      const sourceUnit = card?.currentIntervalUnit || (RATINGS.includes(card?.lastRating) ? profile[card.lastRating] : DAY);
      return promoteRounded(explicit, sourceUnit);
    }

    const value = Number(card?.currentIntervalValue);
    if (Number.isFinite(value) && value > 0 && card?.currentIntervalUnit) {
      return promoteRounded(toMinutes(value, card.currentIntervalUnit), card.currentIntervalUnit);
    }

    const legacy = Number(card?.currentIntervalDays);
    if (Number.isFinite(legacy) && legacy > 0) {
      const sourceUnit = card?.currentIntervalUnit || DAY;
      return promoteRounded(toMinutes(legacy, sourceUnit), sourceUnit);
    }

    const rating = RATINGS.includes(card?.lastRating) ? card.lastRating : "good";
    return promoteRounded(toMinutes(settings.newIntervals[rating], profile[rating]), profile[rating]);
  }

  function calculate(card, rating, deck) {
    if (!card || !deck || !RATINGS.includes(rating)) return null;
    const settings = cloneSettings(deck.reviewSettings);
    const profile = profileForSettings(settings);
    let duration;

    if (reviewCount(card) === 0) {
      duration = promoteRounded(toMinutes(settings.newIntervals[rating], profile[rating]), profile[rating]);
    } else {
      const current = currentDuration(card, settings, profile);
      const effectiveUnit = coarserUnit(current.unit, profile[rating]);
      const multiplied = current.minutes * Math.max(1, Number(settings.multipliers[rating]) || 1);
      duration = promoteRounded(multiplied, effectiveUnit);
    }

    const maxDuration = promoteRounded(toMinutes(settings.maxIntervalDays, profile.max), profile.max);
    return duration.minutes > maxDuration.minutes ? maxDuration : duration;
  }

  function scheduleAfter(duration, reviewedAt) {
    const base = reviewedAt ? new Date(reviewedAt) : new Date();
    const start = Number.isNaN(base.getTime()) ? new Date() : base;
    if (duration.unit === DAY) {
      const target = new Date(start);
      target.setHours(0, 0, 0, 0);
      target.setDate(target.getDate() + duration.value);
      return target.toISOString();
    }
    return new Date(start.getTime() + duration.minutes * 60000).toISOString();
  }

  function formatDuration(duration) {
    if (!duration) return "";
    if (duration.unit === MINUTE) return `${duration.value} ${duration.value === 1 ? "minuto" : "minutos"}`;
    if (duration.unit === HOUR) return `${duration.value} ${duration.value === 1 ? "hora" : "horas"}`;
    return `${duration.value} ${duration.value === 1 ? "dia" : "dias"}`;
  }

  function correctedHistory(history, duration, nextReviewAt) {
    if (!Array.isArray(history) || !history.length) return history;
    const last = history[history.length - 1];
    if (!last || !RATINGS.includes(last.rating)) return history;
    return [
      ...history.slice(0, -1),
      {
        ...last,
        intervalDays: duration.value,
        intervalValue: duration.value,
        intervalUnit: duration.unit,
        intervalMinutes: duration.minutes,
        nextReviewAt
      }
    ];
  }

  function addAuthorityMarker(card) {
    if (!card?.id) return card;
    const marker = `<!--oc-auth-card:${card.id}-->`;
    const front = String(card.frontHtml || "");
    if (front.startsWith(marker)) return card;
    return { ...card, frontHtml: `${marker}${front}` };
  }

  function cardIdFromFront(selector) {
    const html = String($(selector)?.innerHTML || "");
    return html.match(/<!--oc-auth-card:([^>]+)-->/)?.[1] ||
      html.match(/<!--oc-promote-card:([^>]+)-->/)?.[1] ||
      html.match(/<!--oc-card:([^>]+)-->/)?.[1] || null;
  }

  async function renderRatingHints(mode) {
    const frontSelector = mode === "multi" ? "#multiFront" : "#studyFront";
    const ids = mode === "multi"
      ? { hard: "multiHintHard", medium: "multiHintMedium", good: "multiHintGood", easy: "multiHintEasy" }
      : { hard: "ratingHardInterval", medium: "ratingMediumInterval", good: "ratingGoodInterval", easy: "ratingEasyInterval" };
    const cardId = cardIdFromFront(frontSelector);
    if (!cardId || !window.OituDB) return;

    try {
      const card = await OituDB.getCard(cardId);
      const deck = card?.deckId ? await OituDB.getDeck(card.deckId) : null;
      if (!card || !deck) return;
      for (const rating of RATINGS) {
        const duration = calculate(card, rating, deck);
        const target = $(`#${ids[rating]}`);
        if (!target || !duration) continue;
        const text = `(revisão em ${formatDuration(duration)})`;
        if (target.textContent !== text) target.textContent = text;
      }
    } catch (_) {}
  }

  function scheduleRender(mode) {
    if (renderPending[mode]) return;
    renderPending[mode] = true;
    setTimeout(async () => {
      renderPending[mode] = false;
      await renderRatingHints(mode);
    }, 0);
  }

  function patchDatabase() {
    if (dbPatched || !window.OituDB) return false;
    dbPatched = true;

    const previousGetDeck = OituDB.getDeck.bind(OituDB);
    const previousGetDecks = OituDB.getDecks.bind(OituDB);
    const previousGetFolder = OituDB.getFolder.bind(OituDB);
    const previousGetFolders = OituDB.getFolders.bind(OituDB);
    const previousUpdateDeck = OituDB.updateDeck.bind(OituDB);
    const previousUpdateFolder = OituDB.updateFolder.bind(OituDB);
    const previousGetCardsByDeck = OituDB.getCardsByDeck.bind(OituDB);
    const previousGetCard = OituDB.getCard.bind(OituDB);
    const previousUpdateCard = OituDB.updateCard.bind(OituDB);

    OituDB.getDeck = async function (id) {
      return overlayEntity(await previousGetDeck(id));
    };

    OituDB.getDecks = async function (...args) {
      const decks = await previousGetDecks(...args);
      return decks.map(overlayEntity);
    };

    OituDB.getFolder = async function (id) {
      return overlayEntity(await previousGetFolder(id));
    };

    OituDB.getFolders = async function (...args) {
      const folders = await previousGetFolders(...args);
      return folders.map(overlayEntity);
    };

    OituDB.updateDeck = async function (id, patch) {
      if (patch?.reviewModelMode === "global" && patch?.reviewSettings && !hasExplicitUnits(patch.reviewSettings)) {
        forgetAuthority(id);
      } else if (patch?.reviewSettings && hasExplicitUnits(patch.reviewSettings)) {
        rememberAuthority(id, patch.reviewSettings, patch);
      } else if (patch?.folderId && patch?.reviewSettings) {
        const inherited = authoritative(patch.folderId);
        if (inherited?.reviewSettings) {
          patch = {
            ...patch,
            reviewSettings: cloneSettings(inherited.reviewSettings),
            reviewModelMode: inherited.reviewModelMode || patch.reviewModelMode,
            reviewModelId: inherited.reviewModelId || patch.reviewModelId
          };
          rememberAuthority(id, patch.reviewSettings, patch);
        }
      }
      return overlayEntity(await previousUpdateDeck(id, patch));
    };

    OituDB.updateFolder = async function (id, patch) {
      if (patch?.reviewModelMode === "global" && patch?.reviewSettings && !hasExplicitUnits(patch.reviewSettings)) {
        forgetAuthority(id);
      } else if (patch?.reviewSettings && hasExplicitUnits(patch.reviewSettings)) {
        rememberAuthority(id, patch.reviewSettings, patch);
      }
      return overlayEntity(await previousUpdateFolder(id, patch));
    };

    OituDB.getCardsByDeck = async function (deckId) {
      const cards = await previousGetCardsByDeck(deckId);
      return Array.isArray(cards) ? cards.map(addAuthorityMarker) : cards;
    };

    OituDB.updateCard = async function (id, patch) {
      let original = null;
      let deck = null;
      let desired = null;

      if (patch && RATINGS.includes(patch.lastRating)) {
        try {
          original = await previousGetCard(id);
          deck = original?.deckId ? await OituDB.getDeck(original.deckId) : null;
          if (deck) desired = calculate(original, patch.lastRating, deck);
        } catch (_) {}
      }

      let result = await previousUpdateCard(id, patch);
      if (!desired) return result;

      const reviewedAt = patch.lastReviewedAt || result?.lastReviewedAt || new Date().toISOString();
      const nextReviewAt = scheduleAfter(desired, reviewedAt);
      const history = correctedHistory(result?.ratingHistory || patch.ratingHistory, desired, nextReviewAt);
      const correction = {
        currentIntervalDays: desired.value,
        currentIntervalValue: desired.value,
        currentIntervalUnit: desired.unit,
        currentIntervalMinutes: desired.minutes,
        currentIntervalHours: desired.minutes / 60,
        nextReviewAt,
        ...(history ? { ratingHistory: history } : {})
      };

      result = await previousUpdateCard(id, correction);
      Object.assign(patch, correction);
      return result;
    };

    return true;
  }

  async function handleFolderSubmit(event) {
    if (event.target?.id !== "folderReviewForm") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (applyingFolder) return;

    const modal = $("#folderReviewModal");
    const folderId = modal?.dataset.folderId || activeFolderId;
    if (!folderId || !window.OituDB) {
      alert("Não foi possível identificar a pasta deste ajuste.");
      return;
    }

    const result = readFolderSettings();
    if (result.error) {
      alert(result.error);
      return;
    }

    applyingFolder = true;
    const submit = event.target.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const applied = await applyFolderSettings(folderId, result.settings);
      if (!applied) return;
      closeFolderReviewModal();
      showToast("Ajustes de revisão aplicados à pasta.");
    } catch (error) {
      console.error("OituCards: não foi possível aplicar os ajustes de revisão da pasta.", error);
      alert("Não foi possível aplicar os ajustes de revisão da pasta.");
    } finally {
      applyingFolder = false;
      if (submit) submit.disabled = false;
    }
  }

  function captureFolderContext(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const edit = target.closest("[data-edit-folder]");
    if (edit) {
      activeFolderId = edit.dataset.editFolder || edit.closest("[data-folder-id]")?.dataset.folderId || activeFolderId;
      const modal = $("#folderReviewModal");
      if (modal && activeFolderId) modal.dataset.folderId = activeFolderId;
      return;
    }
    if (target.closest("#folderReviewSettingsButton")) {
      const modal = $("#folderReviewModal");
      if (modal && activeFolderId) modal.dataset.folderId = activeFolderId;
      const folderId = modal?.dataset.folderId || activeFolderId;
      [60, 180, 420, 800].forEach((delay) => setTimeout(() => restoreFolderForm(folderId), delay));
    }
  }

  function installScopedObservers() {
    if (observersInstalled) return;
    observersInstalled = true;

    const install = () => {
      const modal = $("#folderReviewModal");
      if (modal && modal.dataset.reviewTimeAuthorityObserved !== "true") {
        modal.dataset.reviewTimeAuthorityObserved = "true";
        new MutationObserver(() => {
          if (modal.classList.contains("hidden")) return;
          const folderId = modal.dataset.folderId || activeFolderId;
          [80, 220, 500].forEach((delay) => setTimeout(() => restoreFolderForm(folderId), delay));
        }).observe(modal, { attributes: true, attributeFilter: ["class"] });
      }

      const studyFront = $("#studyFront");
      if (studyFront && studyFront.dataset.reviewTimeAuthorityObserved !== "true") {
        studyFront.dataset.reviewTimeAuthorityObserved = "true";
        new MutationObserver(() => scheduleRender("study")).observe(studyFront, { childList: true, subtree: true });
      }

      const studyRatings = $("#studyRatingArea");
      if (studyRatings && studyRatings.dataset.reviewTimeAuthorityObserved !== "true") {
        studyRatings.dataset.reviewTimeAuthorityObserved = "true";
        new MutationObserver(() => scheduleRender("study")).observe(studyRatings, { childList: true, subtree: true, characterData: true });
      }

      const multiFront = $("#multiFront");
      if (multiFront && multiFront.dataset.reviewTimeAuthorityObserved !== "true") {
        multiFront.dataset.reviewTimeAuthorityObserved = "true";
        new MutationObserver(() => scheduleRender("multi")).observe(multiFront, { childList: true, subtree: true });
      }

      const multiRatings = $("#multiRatings");
      if (multiRatings && multiRatings.dataset.reviewTimeAuthorityObserved !== "true") {
        multiRatings.dataset.reviewTimeAuthorityObserved = "true";
        new MutationObserver(() => scheduleRender("multi")).observe(multiRatings, { childList: true, subtree: true, characterData: true });
      }
    };

    install();
    setTimeout(install, 0);
    setTimeout(install, 200);
  }

  function init() {
    patchDatabase();
    installScopedObservers();
    setTimeout(() => {
      patchDatabase();
      installScopedObservers();
    }, 0);
  }

  window.addEventListener("submit", handleFolderSubmit, true);
  window.addEventListener("click", captureFolderContext, true);

  window.OituReviewTimeAuthority = { calculate, formatDuration };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();