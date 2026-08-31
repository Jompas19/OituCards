(function () {
  if (window.__oitucardsReviewTimePromotion) return;
  window.__oitucardsReviewTimePromotion = true;

  const MINUTE = "minutes";
  const HOUR = "hours";
  const DAY = "days";
  const RATINGS = ["hard", "medium", "good", "easy"];
  let dbPatched = false;
  let observersInstalled = false;

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

  function patchDatabase() {
    if (dbPatched || !window.OituDB?.updateCard) return false;
    dbPatched = true;
    const previousUpdateCard = OituDB.updateCard.bind(OituDB);
    const getCard = OituDB.getCard.bind(OituDB);
    const getDeck = OituDB.getDeck.bind(OituDB);

    OituDB.updateCard = async function (id, patch) {
      let desired = null;
      let original = null;
      if (patch && RATINGS.includes(patch.lastRating)) {
        try {
          original = await getCard(id);
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
      return result;
    };
    return true;
  }

  function cardIdFromFront(selector) {
    const html = String($(selector)?.innerHTML || "");
    return html.match(/<!--oc-card:([^>]+)-->/)?.[1] || null;
  }

  async function decorate(prefix, frontSelector) {
    const cardId = cardIdFromFront(frontSelector);
    if (!cardId || !window.OituDB) return;
    try {
      const card = await OituDB.getCard(cardId);
      const deck = card?.deckId ? await OituDB.getDeck(card.deckId) : null;
      if (!card || !deck) return;
      for (const rating of RATINGS) {
        const duration = calculate(card, rating, deck);
        const target = $(`#${prefix}${rating.charAt(0).toUpperCase()}${rating.slice(1)}`);
        if (!target || !duration) continue;
        target.dataset.promotedReviewLabel = `(revisão em ${format(duration)})`;
      }
    } catch (_) {}
  }

  function clearLabels(prefix) {
    for (const rating of RATINGS) {
      const target = $(`#${prefix}${rating.charAt(0).toUpperCase()}${rating.slice(1)}`);
      if (target) delete target.dataset.promotedReviewLabel;
    }
  }

  function ensureStyle() {
    if ($("#reviewTimePromotionStyle")) return;
    const style = document.createElement("style");
    style.id = "reviewTimePromotionStyle";
    style.textContent = `
      .rating-interval[data-promoted-review-label]{font-size:0}
      .rating-interval[data-promoted-review-label]::after{content:attr(data-promoted-review-label);font-size:.78rem}
    `;
    document.head.appendChild(style);
  }

  function installObservers() {
    if (observersInstalled) return;
    observersInstalled = true;
    const install = () => {
      const studyFront = $("#studyFront");
      if (studyFront && studyFront.dataset.reviewPromotionObserved !== "true") {
        studyFront.dataset.reviewPromotionObserved = "true";
        new MutationObserver(() => {
          clearLabels("rating");
          setTimeout(() => decorate("rating", "#studyFront"), 0);
        }).observe(studyFront, { childList: true, subtree: true });
      }
      const multiFront = $("#multiFront");
      if (multiFront && multiFront.dataset.reviewPromotionObserved !== "true") {
        multiFront.dataset.reviewPromotionObserved = "true";
        new MutationObserver(() => {
          clearLabels("multiHint");
          setTimeout(() => decorate("multiHint", "#multiFront"), 0);
        }).observe(multiFront, { childList: true, subtree: true });
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
        setTimeout(() => decorate("rating", "#studyFront"), 0);
        return result;
      };
      wrapped.__reviewPromotionWrapped = true;
      OituStudy.openConfig = wrapped;
    }
    if (window.OituMultiStudy?.openConfig && !OituMultiStudy.openConfig.__reviewPromotionWrapped) {
      const previous = OituMultiStudy.openConfig;
      const wrapped = async function (...args) {
        const result = await previous.apply(this, args);
        setTimeout(() => decorate("multiHint", "#multiFront"), 0);
        return result;
      };
      wrapped.__reviewPromotionWrapped = true;
      OituMultiStudy.openConfig = wrapped;
    }
  }

  function init() {
    ensureStyle();
    patchDatabase();
    installObservers();
    wrapStudy();
    setTimeout(() => {
      patchDatabase();
      installObservers();
      wrapStudy();
    }, 0);
    setTimeout(wrapStudy, 250);
  }

  window.OituReviewTimePromotion = { calculate, format, promoteRounded };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();