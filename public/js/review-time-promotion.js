(function () {
  if (window.__oitucardsReviewTimePromotion) return;
  window.__oitucardsReviewTimePromotion = true;

  const MINUTE = "minutes";
  const HOUR = "hours";
  const DAY = "days";
  const RATINGS = ["hard", "medium", "good", "easy"];
  const INTERVAL_IDS = {
    study: {
      hard: "ratingHardInterval",
      medium: "ratingMediumInterval",
      good: "ratingGoodInterval",
      easy: "ratingEasyInterval"
    },
    multi: {
      hard: "multiHintHard",
      medium: "multiHintMedium",
      good: "multiHintGood",
      easy: "multiHintEasy"
    }
  };
  const FRONT_SELECTORS = { study: "#studyFront", multi: "#multiFront" };
  const RATING_AREAS = { study: "#studyRatingArea", multi: "#multiRatings" };

  let dbPatched = false;
  let observersInstalled = false;
  let reviewViewObserverInstalled = false;
  let unitDirty = false;
  let bypassUnitExit = false;
  let unitPendingExit = null;
  const renderPending = { study: false, multi: false };

  const $ = (selector, root = document) => root.querySelector(selector);

  function normalizeUnit(value) {
    const raw = String(value || "").toLocaleLowerCase("pt-BR");
    if ([MINUTE, "minute", "minuto", "minutos", "min"].includes(raw)) return MINUTE;
    if ([HOUR, "hour", "hora", "horas", "h"].includes(raw)) return HOUR;
    return DAY;
  }

  function unitRank(unit) {
    const safe = normalizeUnit(unit);
    if (safe === MINUTE) return 0;
    if (safe === HOUR) return 1;
    return 2;
  }

  function coarserUnit(a, b) {
    return unitRank(a) >= unitRank(b) ? normalizeUnit(a) : normalizeUnit(b);
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

  function numericSettings(deck) {
    const settings = deck?.reviewSettings || {};
    const intervals = settings.newIntervals || settings || {};
    const multipliers = settings.multipliers || {};
    return {
      newIntervals: {
        hard: Math.max(1, Number(intervals.hard) || 1),
        medium: Math.max(1, Number(intervals.medium) || 2),
        good: Math.max(1, Number(intervals.good) || 4),
        easy: Math.max(1, Number(intervals.easy) || 7)
      },
      multipliers: {
        hard: Math.max(1, Number(multipliers.hard) || 1.2),
        medium: Math.max(1, Number(multipliers.medium) || 1.8),
        good: Math.max(1, Number(multipliers.good) || 2.5),
        easy: Math.max(1, Number(multipliers.easy) || 4)
      },
      maxValue: Math.max(1, Number(settings.maxIntervalDays) || 180)
    };
  }

  function reviewCount(card) {
    if (Number.isInteger(card?.reviewCount) && card.reviewCount >= 0) return card.reviewCount;
    if (card?.lastReviewedAt || card?.nextReviewAt || RATINGS.includes(card?.lastRating)) return 1;
    return 0;
  }

  function currentMinutes(card, settings, profile) {
    const explicit = Number(card?.currentIntervalMinutes);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const value = Number(card?.currentIntervalValue);
    if (Number.isFinite(value) && value > 0 && card?.currentIntervalUnit) {
      return toMinutes(value, card.currentIntervalUnit);
    }

    const hours = Number(card?.currentIntervalHours);
    if (Number.isFinite(hours) && hours > 0 && normalizeUnit(card?.currentIntervalUnit) === HOUR) {
      return hours * 60;
    }

    const legacy = Number(card?.currentIntervalDays);
    if (Number.isFinite(legacy) && legacy > 0) {
      if (card?.currentIntervalUnit) return toMinutes(legacy, card.currentIntervalUnit);
      return legacy * 1440;
    }

    const rating = RATINGS.includes(card?.lastRating) ? card.lastRating : null;
    if (rating) return toMinutes(settings.newIntervals[rating], profile[rating]);
    return 1440;
  }

  function promoteRounded(rawMinutes, requestedUnit) {
    const minutes = Math.max(0, Number(rawMinutes) || 0);
    let unit = normalizeUnit(requestedUnit);

    if (unit === MINUTE) {
      const minuteValue = Math.max(5, Math.round(minutes / 5) * 5);
      if (minuteValue < 60) return { value: minuteValue, unit: MINUTE, minutes: minuteValue };
      unit = HOUR;
    }

    if (unit === HOUR) {
      const hourValue = Math.max(1, Math.round(minutes / 60));
      if (hourValue < 24) return { value: hourValue, unit: HOUR, minutes: hourValue * 60 };
      unit = DAY;
    }

    const dayValue = Math.max(1, Math.round(minutes / 1440));
    return { value: dayValue, unit: DAY, minutes: dayValue * 1440 };
  }

  function normalizeCurrentDuration(card, settings, profile) {
    const minutes = currentMinutes(card, settings, profile);
    const sourceUnit = card?.currentIntervalUnit || (RATINGS.includes(card?.lastRating) ? profile[card.lastRating] : DAY);
    return promoteRounded(minutes, sourceUnit);
  }

  function calculate(card, rating, deck) {
    if (!card || !deck || !RATINGS.includes(rating)) return null;
    const profile = profileForSettings(deck.reviewSettings);
    const settings = numericSettings(deck);
    let duration;

    if (reviewCount(card) === 0) {
      duration = promoteRounded(toMinutes(settings.newIntervals[rating], profile[rating]), profile[rating]);
    } else {
      const current = normalizeCurrentDuration(card, settings, profile);
      const effectiveUnit = coarserUnit(current.unit, profile[rating]);
      const multiplied = current.minutes * settings.multipliers[rating];
      duration = promoteRounded(multiplied, effectiveUnit);
    }

    const maxDuration = promoteRounded(toMinutes(settings.maxValue, profile.max), profile.max);
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
    return new Date(start.getTime() + duration.minutes * 60 * 1000).toISOString();
  }

  function format(duration) {
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

  function replaceBaseMarker(card) {
    if (!card?.frontHtml) return card;
    const front = String(card.frontHtml);
    const match = front.match(/^<!--oc-card:([^>]+)-->/);
    if (!match) return card;
    return {
      ...card,
      frontHtml: `<!--oc-promote-card:${match[1]}-->${front.slice(match[0].length)}`
    };
  }

  function patchDatabase() {
    if (dbPatched || !window.OituDB?.updateCard) return false;
    dbPatched = true;

    const previousUpdateCard = OituDB.updateCard.bind(OituDB);
    const previousGetCardsByDeck = OituDB.getCardsByDeck?.bind(OituDB);
    const getCard = OituDB.getCard.bind(OituDB);
    const getDeck = OituDB.getDeck.bind(OituDB);

    if (previousGetCardsByDeck) {
      OituDB.getCardsByDeck = async function (...args) {
        const cards = await previousGetCardsByDeck(...args);
        return Array.isArray(cards) ? cards.map(replaceBaseMarker) : cards;
      };
    }

    OituDB.updateCard = async function (id, patch) {
      let desired = null;
      if (patch && RATINGS.includes(patch.lastRating)) {
        try {
          const original = await getCard(id);
          const deck = original?.deckId ? await getDeck(original.deckId) : null;
          desired = calculate(original, patch.lastRating, deck);
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

      const alreadyCorrect = result &&
        Number(result.currentIntervalValue) === desired.value &&
        normalizeUnit(result.currentIntervalUnit) === desired.unit &&
        Number(result.currentIntervalMinutes) === desired.minutes &&
        result.nextReviewAt === nextReviewAt;

      if (!alreadyCorrect) result = await previousUpdateCard(id, correction);

      // O fluxo de estudo reaproveita o próprio patch no card em memória.
      Object.assign(patch, correction);
      return result;
    };
    return true;
  }

  function cardIdFromFront(selector) {
    const html = String($(selector)?.innerHTML || "");
    return html.match(/<!--oc-promote-card:([^>]+)-->/)?.[1] ||
      html.match(/<!--oc-card:([^>]+)-->/)?.[1] || null;
  }

  async function decorate(mode) {
    const frontSelector = FRONT_SELECTORS[mode];
    const ids = INTERVAL_IDS[mode];
    if (!frontSelector || !ids || !window.OituDB) return;

    const cardId = cardIdFromFront(frontSelector);
    if (!cardId) return;

    try {
      const card = await OituDB.getCard(cardId);
      const deck = card?.deckId ? await OituDB.getDeck(card.deckId) : null;
      if (!card || !deck) return;

      for (const rating of RATINGS) {
        const duration = calculate(card, rating, deck);
        const target = $(`#${ids[rating]}`);
        if (!target || !duration) continue;
        const desired = `(revisão em ${format(duration)})`;
        if (target.textContent !== desired) target.textContent = desired;
      }
    } catch (_) {}
  }

  function scheduleDecorate(mode) {
    if (renderPending[mode]) return;
    renderPending[mode] = true;
    setTimeout(async () => {
      renderPending[mode] = false;
      await decorate(mode);
    }, 0);
  }

  function installObservers() {
    if (observersInstalled) return;
    observersInstalled = true;

    const install = () => {
      for (const mode of ["study", "multi"]) {
        const front = $(FRONT_SELECTORS[mode]);
        if (front && front.dataset.reviewPromotionFrontObserved !== "true") {
          front.dataset.reviewPromotionFrontObserved = "true";
          new MutationObserver(() => scheduleDecorate(mode))
            .observe(front, { childList: true, subtree: true });
        }

        const ratings = $(RATING_AREAS[mode]);
        if (ratings && ratings.dataset.reviewPromotionRatingsObserved !== "true") {
          ratings.dataset.reviewPromotionRatingsObserved = "true";
          new MutationObserver(() => scheduleDecorate(mode))
            .observe(ratings, { childList: true, subtree: true, characterData: true });
        }
      }
    };

    install();
    setTimeout(install, 0);
    setTimeout(install, 150);
  }

  function wrapStudy() {
    if (window.OituStudy?.openConfig && !OituStudy.openConfig.__reviewPromotionWrapped) {
      const previous = OituStudy.openConfig;
      const wrapped = async function (...args) {
        const result = await previous.apply(this, args);
        scheduleDecorate("study");
        return result;
      };
      wrapped.__reviewPromotionWrapped = true;
      OituStudy.openConfig = wrapped;
    }

    if (window.OituMultiStudy?.openConfig && !OituMultiStudy.openConfig.__reviewPromotionWrapped) {
      const previous = OituMultiStudy.openConfig;
      const wrapped = async function (...args) {
        const result = await previous.apply(this, args);
        scheduleDecorate("multi");
        return result;
      };
      wrapped.__reviewPromotionWrapped = true;
      OituMultiStudy.openConfig = wrapped;
    }
  }

  function reviewViewActive() {
    return $("#reviewSettingsView")?.classList.contains("active") === true;
  }

  function closeUnsavedModal() {
    const modal = $("#reviewUnsavedModal");
    modal?.classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
  }

  function openUnitUnsaved(exitButton) {
    const modal = $("#reviewUnsavedModal");
    if (!modal) {
      const discard = window.confirm("Há alterações de revisão que não foram salvas. Sair sem salvar?");
      if (discard) {
        unitDirty = false;
        bypassUnitExit = true;
        exitButton?.click();
      }
      return;
    }
    unitPendingExit = exitButton || null;
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => $("#reviewUnsavedSave")?.focus());
  }

  function handleUnitChange(event) {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!event.isTrusted || !reviewViewActive()) return;
    if (select?.dataset.reviewTimeScope !== "review") return;
    unitDirty = true;
  }

  function handleReviewExit(event) {
    const target = event.target instanceof Element ? event.target : null;
    const exit = target?.closest("#reviewSettingsBackButton,#cancelReviewSettingsButton");
    if (!exit) return;

    if (bypassUnitExit) {
      bypassUnitExit = false;
      return;
    }
    if (!unitDirty || !reviewViewActive()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openUnitUnsaved(exit);
  }

  function handleUnsavedAction(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("#reviewUnsavedDiscard")) {
      if (!unitDirty) return;
      const exit = unitPendingExit;
      unitPendingExit = null;
      unitDirty = false;

      // Se o modal foi aberto pelo controle antigo (número/modelo + unidade),
      // deixamos esse controle concluir a saída normalmente.
      if (!exit) return;

      // Se apenas a unidade mudou, fomos nós que abrimos o modal.
      event.preventDefault();
      event.stopImmediatePropagation();
      closeUnsavedModal();
      bypassUnitExit = true;
      exit.click();
      return;
    }

    if (target.closest("#reviewUnsavedContinue")) {
      unitPendingExit = null;
      return;
    }

    if (target.closest("#reviewUnsavedSave")) {
      unitPendingExit = null;
    }
  }

  function clearDirtyAfterSave() {
    const check = () => {
      const status = String($("#reviewSettingsStatus")?.textContent || "");
      if (/ajustes salvos/i.test(status)) unitDirty = false;
    };
    setTimeout(check, 80);
    setTimeout(check, 300);
    setTimeout(check, 800);
  }

  function installReviewViewObserver() {
    if (reviewViewObserverInstalled) return;
    const view = $("#reviewSettingsView");
    if (!view) return;
    reviewViewObserverInstalled = true;
    let wasActive = view.classList.contains("active");
    new MutationObserver(() => {
      const active = view.classList.contains("active");
      if (active && !wasActive) {
        unitDirty = false;
        unitPendingExit = null;
      }
      if (!active) unitPendingExit = null;
      wasActive = active;
    }).observe(view, { attributes: true, attributeFilter: ["class"] });
  }

  function handleReviewSubmit(event) {
    if (event.target?.id === "reviewSettingsForm") clearDirtyAfterSave();
  }

  function init() {
    patchDatabase();
    installObservers();
    wrapStudy();
    installReviewViewObserver();

    setTimeout(() => {
      patchDatabase();
      installObservers();
      wrapStudy();
      installReviewViewObserver();
    }, 0);
    setTimeout(wrapStudy, 250);
  }

  document.addEventListener("change", handleUnitChange, true);
  document.addEventListener("click", handleReviewExit, true);
  document.addEventListener("click", handleUnsavedAction, true);
  document.addEventListener("submit", handleReviewSubmit, false);

  window.OituReviewTimePromotion = { calculate, format, promoteRounded };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
