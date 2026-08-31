(function () {
  if (window.__oitucardsReviewTimeUnits) return;
  window.__oitucardsReviewTimeUnits = true;

  const MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  const LEGACY_MODEL_UNIT_STORAGE_KEY = "OituCardsReviewPresetUnitsV1";
  const MODEL_PROFILE_STORAGE_KEY = "OituCardsReviewPresetUnitsV2";
  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";

  const MINUTE = "minutes";
  const HOUR = "hours";
  const DAY = "days";
  const RATINGS = ["hard", "medium", "good", "easy"];
  const FIELDS = [...RATINGS, "max"];

  const DEFAULT_PROFILE = Object.freeze({
    hard: DAY,
    medium: DAY,
    good: DAY,
    easy: DAY,
    max: DAY
  });

  const state = {
    activeDeckId: null,
    activeFolderId: null,
    pendingReviewContext: null,
    pendingModelProfile: { ...DEFAULT_PROFILE },
    pendingModelSave: null,
    folderApplyContext: null,
    studyDeckIds: new Set(),
    cardsById: new Map(),
    deckProfiles: new Map(),
    deckSettings: new Map(),
    cardDeckIds: new Map(),
    observersInstalled: false,
    dbPatched: false
  };

  const scopeProfiles = {
    review: { ...DEFAULT_PROFILE },
    folder: { ...DEFAULT_PROFILE },
    model: { ...DEFAULT_PROFILE }
  };

  const FIELD_IDS = {
    review: {
      hard: "reviewHardDays",
      medium: "reviewMediumDays",
      good: "reviewGoodDays",
      easy: "reviewEasyDays",
      max: "reviewMaxDays"
    },
    folder: {
      hard: "folderRevHardDays",
      medium: "folderRevMediumDays",
      good: "folderRevGoodDays",
      easy: "folderRevEasyDays",
      max: "folderRevMax"
    },
    model: {
      hard: "modelHardDays",
      medium: "modelMediumDays",
      good: "modelGoodDays",
      easy: "modelEasyDays",
      max: "modelMaxDays"
    }
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function normalizeUnit(value) {
    const raw = String(value || "").toLocaleLowerCase("pt-BR");
    if (raw === MINUTE || raw === "minute" || raw === "minuto" || raw === "minutos" || raw === "min") return MINUTE;
    if (raw === HOUR || raw === "hour" || raw === "hora" || raw === "horas" || raw === "h") return HOUR;
    return DAY;
  }

  function cloneProfile(profile) {
    const source = profile || DEFAULT_PROFILE;
    return {
      hard: normalizeUnit(source.hard),
      medium: normalizeUnit(source.medium),
      good: normalizeUnit(source.good),
      easy: normalizeUnit(source.easy),
      max: normalizeUnit(source.max)
    };
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

  function withProfile(settings, profile, maxValue = null) {
    const source = settings || {};
    const safe = cloneProfile(profile);
    const next = { ...source };
    delete next.intervalUnit;
    next.intervalUnits = {
      hard: safe.hard,
      medium: safe.medium,
      good: safe.good,
      easy: safe.easy
    };
    next.maxIntervalUnit = safe.max;
    if (Number.isFinite(Number(maxValue))) next.maxIntervalDays = Math.max(1, Math.round(Number(maxValue)));

    const all = [safe.hard, safe.medium, safe.good, safe.easy, safe.max];
    if (all.every((unit) => unit === all[0])) next.intervalUnit = all[0];
    return next;
  }

  function toMinutes(value, unit) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    const safeUnit = normalizeUnit(unit);
    if (safeUnit === MINUTE) return number;
    if (safeUnit === HOUR) return number * 60;
    return number * 1440;
  }

  function roundedManualValue(value, unit) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return normalizeUnit(unit) === MINUTE ? 5 : 1;
    if (normalizeUnit(unit) === MINUTE) return Math.max(5, Math.round(number / 5) * 5);
    return Math.max(1, Math.round(number));
  }

  function roundDuration(rawMinutes, unit) {
    const safe = normalizeUnit(unit);
    const minutes = Math.max(0, Number(rawMinutes) || 0);
    if (safe === MINUTE) {
      const value = Math.max(5, Math.round(minutes / 5) * 5);
      return { value, unit: MINUTE, minutes: value };
    }
    if (safe === HOUR) {
      const value = Math.max(1, Math.round(minutes / 60));
      return { value, unit: HOUR, minutes: value * 60 };
    }
    const value = Math.max(1, Math.round(minutes / 1440));
    return { value, unit: DAY, minutes: value * 1440 };
  }

  function formatDuration(duration) {
    if (!duration) return "";
    const unit = normalizeUnit(duration.unit);
    const value = Number(duration.value);
    const minutes = Math.max(0, Math.round(Number(duration.minutes) || toMinutes(value, unit)));

    if (unit === MINUTE) {
      if (minutes < 60) return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      if (!rest) return `${hours} ${hours === 1 ? "hora" : "horas"}`;
      return `${hours} h ${rest} min`;
    }

    if (unit === HOUR) return `${value} ${value === 1 ? "hora" : "horas"}`;
    return `${value} ${value === 1 ? "dia" : "dias"}`;
  }

  function readModels() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((model) => model?.id && model?.settings) : [];
    } catch (_) {
      return [];
    }
  }

  function readModelProfiles() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MODEL_PROFILE_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeModelProfiles(profiles) {
    try {
      localStorage.setItem(MODEL_PROFILE_STORAGE_KEY, JSON.stringify(profiles || {}));
    } catch (_) {}
  }

  function legacyModelUnit(modelId) {
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_MODEL_UNIT_STORAGE_KEY) || "{}");
      const value = parsed && typeof parsed === "object" ? parsed[modelId] : null;
      return value ? normalizeUnit(value) : null;
    } catch (_) {
      return null;
    }
  }

  function modelProfile(modelId) {
    const model = readModels().find((item) => item.id === modelId);
    if (model?.settings?.intervalUnits || model?.settings?.intervalUnit || model?.settings?.maxIntervalUnit) {
      return profileForSettings(model.settings);
    }

    const stored = readModelProfiles()[modelId];
    if (stored && typeof stored === "object") return cloneProfile(stored);

    const legacy = legacyModelUnit(modelId);
    if (legacy) return { hard: legacy, medium: legacy, good: legacy, easy: legacy, max: legacy };
    return { ...DEFAULT_PROFILE };
  }

  function currentGlobalValue() {
    const value = String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system");
    if (value === "system") return value;
    if (value.startsWith("model:") && readModels().some((model) => `model:${model.id}` === value)) return value;
    return "system";
  }

  function profileForSelection(value) {
    const selection = String(value || "system");
    if (selection === "global") return profileForSelection(currentGlobalValue());
    if (selection === "system") return { ...DEFAULT_PROFILE };
    if (selection.startsWith("model:")) return modelProfile(selection.slice(6));
    return { ...DEFAULT_PROFILE };
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
      maxIntervalDays: Math.max(1, Number(settings.maxIntervalDays) || 180)
    };
  }

  function rememberDeck(deck) {
    if (!deck?.id) return deck;
    state.deckProfiles.set(deck.id, profileForSettings(deck.reviewSettings));
    state.deckSettings.set(deck.id, numericSettings(deck));
    return deck;
  }

  function getReviewCount(card) {
    if (Number.isInteger(card?.reviewCount) && card.reviewCount >= 0) return card.reviewCount;
    if (card?.lastReviewedAt || card?.nextReviewAt || RATINGS.includes(card?.lastRating)) return 1;
    return 0;
  }

  function currentIntervalMinutes(card, deckSettings, deckProfile) {
    const explicit = Number(card?.currentIntervalMinutes);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const value = Number(card?.currentIntervalValue);
    if (Number.isFinite(value) && value > 0 && card?.currentIntervalUnit) {
      return toMinutes(value, card.currentIntervalUnit);
    }

    const legacyHours = Number(card?.currentIntervalHours);
    if (Number.isFinite(legacyHours) && legacyHours > 0 && normalizeUnit(card?.currentIntervalUnit) === HOUR) {
      return legacyHours * 60;
    }

    const legacyDays = Number(card?.currentIntervalDays);
    if (Number.isFinite(legacyDays) && legacyDays > 0) {
      if (card?.currentIntervalUnit) return toMinutes(legacyDays, card.currentIntervalUnit);
      return legacyDays * 1440;
    }

    const rating = RATINGS.includes(card?.lastRating) ? card.lastRating : null;
    if (rating) return toMinutes(deckSettings.newIntervals[rating], deckProfile[rating]);
    return 1440;
  }

  function calculateNextDuration(card, rating, deckSettings, deckProfile) {
    const profile = cloneProfile(deckProfile);
    const settings = deckSettings || numericSettings(null);
    let rounded;

    if (getReviewCount(card) === 0) {
      const initialValue = roundedManualValue(settings.newIntervals[rating], profile[rating]);
      rounded = {
        value: initialValue,
        unit: profile[rating],
        minutes: toMinutes(initialValue, profile[rating])
      };
    } else {
      const current = currentIntervalMinutes(card, settings, profile);
      const multiplied = current * Math.max(1, Number(settings.multipliers[rating]) || 1);
      rounded = roundDuration(multiplied, profile[rating]);
    }

    const maxValue = roundedManualValue(settings.maxIntervalDays, profile.max);
    const maxMinutes = toMinutes(maxValue, profile.max);
    if (maxMinutes > 0 && rounded.minutes > maxMinutes) {
      return { value: maxValue, unit: profile.max, minutes: maxMinutes };
    }
    return rounded;
  }

  function scheduleAfter(duration, reviewedAt) {
    const base = reviewedAt ? new Date(reviewedAt) : new Date();
    const start = Number.isNaN(base.getTime()) ? new Date() : base;
    const unit = normalizeUnit(duration.unit);

    if (unit === DAY) {
      const target = new Date(start);
      target.setHours(0, 0, 0, 0);
      target.setDate(target.getDate() + Math.max(1, Math.round(duration.value)));
      return target.toISOString();
    }

    return new Date(start.getTime() + duration.minutes * 60 * 1000).toISOString();
  }

  function exactDueClone(card) {
    if (!card) return card;
    const unit = normalizeUnit(card.currentIntervalUnit);
    if (unit !== MINUTE && unit !== HOUR) return card;
    if (!card.nextReviewAt) return card;

    const due = new Date(card.nextReviewAt);
    const now = new Date();
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    if (Number.isNaN(due.getTime()) || due <= now || due > end) return card;

    return {
      ...card,
      nextReviewAt: new Date(end.getTime() + 1000).toISOString()
    };
  }

  function addCardMarker(card) {
    if (!card?.id) return card;
    const marker = `<!--oc-card:${card.id}-->`;
    const front = String(card.frontHtml || "");
    if (front.startsWith(marker)) return card;
    return { ...card, frontHtml: `${marker}${front}` };
  }

  function cardIdFromFront(selector) {
    const html = String($(selector)?.innerHTML || "");
    const match = html.match(/<!--oc-card:([^>]+)-->/);
    return match?.[1] || null;
  }

  function reviewContextForDeck(id) {
    if (state.pendingReviewContext?.deckId === id && state.pendingReviewContext.expiresAt > Date.now()) {
      return state.pendingReviewContext;
    }
    if (id !== state.activeDeckId || !$("#reviewSettingsView")?.classList.contains("active")) return null;

    const selection = String($("#reviewSettingsModelSelect")?.value || "custom");
    return {
      deckId: id,
      profile: cloneProfile(scopeProfiles.review),
      rawMax: Number($("#reviewMaxDays")?.value),
      mode: selection === "global" ? "global" : "manual",
      modelId: selection === "global" ? currentGlobalValue() : selection === "custom" ? "custom" : selection,
      expiresAt: Date.now() + 10000
    };
  }

  function folderContext() {
    if (!state.folderApplyContext || state.folderApplyContext.expiresAt <= Date.now()) return null;
    return state.folderApplyContext;
  }

  function patchDatabase() {
    if (state.dbPatched || !window.OituDB) return false;
    state.dbPatched = true;

    const previousGetDeck = OituDB.getDeck.bind(OituDB);
    const previousGetDecks = OituDB.getDecks.bind(OituDB);
    const previousGetFolder = OituDB.getFolder.bind(OituDB);
    const previousAddDeck = OituDB.addDeck.bind(OituDB);
    const previousAddFolder = OituDB.addFolder.bind(OituDB);
    const previousUpdateDeck = OituDB.updateDeck.bind(OituDB);
    const previousUpdateFolder = OituDB.updateFolder.bind(OituDB);
    const previousGetCardsByDeck = OituDB.getCardsByDeck.bind(OituDB);
    const previousGetCard = OituDB.getCard.bind(OituDB);
    const previousUpdateCard = OituDB.updateCard.bind(OituDB);

    OituDB.getDeck = async function (id) {
      return rememberDeck(await previousGetDeck(id));
    };

    OituDB.getDecks = async function (...args) {
      const decks = await previousGetDecks(...args);
      decks.forEach(rememberDeck);
      return decks;
    };

    OituDB.updateDeck = async function (id, patch) {
      let context = reviewContextForDeck(id) || folderContext();
      let current = null;

      if (!context && patch?.reviewSettings?.intervalUnits) {
        context = {
          profile: profileForSettings(patch.reviewSettings),
          rawMax: patch.reviewSettings.maxIntervalDays,
          mode: patch.reviewModelMode || null,
          modelId: patch.reviewModelId || null
        };
      }

      if (!context && patch?.reviewModelId) {
        context = {
          profile: profileForSelection(patch.reviewModelId),
          rawMax: patch.reviewSettings?.maxIntervalDays,
          mode: patch.reviewModelMode || null,
          modelId: patch.reviewModelId
        };
      }

      if (!context && patch?.reviewSettings && patch?.folderId) {
        try {
          const folder = await previousGetFolder(patch.folderId);
          if (folder) {
            context = {
              profile: profileForSettings(folder.reviewSettings),
              rawMax: patch.reviewSettings.maxIntervalDays,
              mode: patch.reviewModelMode || null,
              modelId: patch.reviewModelId || null
            };
          }
        } catch (_) {}
      }

      if (!context && patch?.reviewSettings) {
        try {
          current = await previousGetDeck(id);
          if (current) {
            context = {
              profile: profileForSettings(current.reviewSettings),
              rawMax: patch.reviewSettings.maxIntervalDays,
              mode: patch.reviewModelMode || null,
              modelId: patch.reviewModelId || null
            };
          }
        } catch (_) {}
      }

      let nextPatch = patch;
      if (patch?.reviewSettings && context?.profile) {
        nextPatch = {
          ...patch,
          reviewSettings: withProfile(
            patch.reviewSettings,
            context.profile,
            Number.isFinite(Number(context.rawMax)) ? context.rawMax : patch.reviewSettings.maxIntervalDays
          )
        };
      }

      let result = await previousUpdateDeck(id, nextPatch);

      if (result && context?.profile) {
        const desiredMode = context.mode || result.reviewModelMode;
        const desiredModelId = context.modelId || result.reviewModelId;
        const actualProfile = profileForSettings(result.reviewSettings);
        const profileMismatch = FIELDS.some((field) => actualProfile[field] !== normalizeUnit(context.profile[field]));
        const maxMismatch = Number.isFinite(Number(context.rawMax)) &&
          Number(result.reviewSettings?.maxIntervalDays) !== Math.round(Number(context.rawMax));
        const metadataMismatch = Boolean(desiredMode && (
          result.reviewModelMode !== desiredMode ||
          (desiredModelId && String(result.reviewModelId || "") !== String(desiredModelId))
        ));

        if (profileMismatch || maxMismatch || metadataMismatch) {
          result = await previousUpdateDeck(id, {
            reviewSettings: withProfile(
              result.reviewSettings,
              context.profile,
              Number.isFinite(Number(context.rawMax)) ? context.rawMax : result.reviewSettings?.maxIntervalDays
            ),
            ...(desiredMode ? { reviewModelMode: desiredMode } : {}),
            ...(desiredModelId ? { reviewModelId: desiredModelId } : {})
          });
        }
      }

      return rememberDeck(result);
    };

    OituDB.updateFolder = async function (id, patch) {
      let context = folderContext();

      if (!context && patch?.reviewSettings?.intervalUnits) {
        context = {
          profile: profileForSettings(patch.reviewSettings),
          rawMax: patch.reviewSettings.maxIntervalDays,
          mode: patch.reviewModelMode || null,
          modelId: patch.reviewModelId || null
        };
      }

      if (!context && patch?.reviewModelId) {
        context = {
          profile: profileForSelection(patch.reviewModelId),
          rawMax: patch.reviewSettings?.maxIntervalDays,
          mode: patch.reviewModelMode || null,
          modelId: patch.reviewModelId
        };
      }

      if (!context && patch?.reviewSettings) {
        try {
          const current = await previousGetFolder(id);
          if (current) {
            context = {
              profile: profileForSettings(current.reviewSettings),
              rawMax: patch.reviewSettings.maxIntervalDays,
              mode: patch.reviewModelMode || null,
              modelId: patch.reviewModelId || null
            };
          }
        } catch (_) {}
      }

      let nextPatch = patch;
      if (patch?.reviewSettings && context?.profile) {
        nextPatch = {
          ...patch,
          reviewSettings: withProfile(
            patch.reviewSettings,
            context.profile,
            Number.isFinite(Number(context.rawMax)) ? context.rawMax : patch.reviewSettings.maxIntervalDays
          )
        };
      }

      let result = await previousUpdateFolder(id, nextPatch);
      if (result && context?.profile) {
        const desiredMode = context.mode || result.reviewModelMode;
        const desiredModelId = context.modelId || result.reviewModelId;
        const actualProfile = profileForSettings(result.reviewSettings);
        const profileMismatch = FIELDS.some((field) => actualProfile[field] !== normalizeUnit(context.profile[field]));
        const maxMismatch = Number.isFinite(Number(context.rawMax)) &&
          Number(result.reviewSettings?.maxIntervalDays) !== Math.round(Number(context.rawMax));
        const metadataMismatch = Boolean(desiredMode && (
          result.reviewModelMode !== desiredMode ||
          (desiredModelId && String(result.reviewModelId || "") !== String(desiredModelId))
        ));

        if (profileMismatch || maxMismatch || metadataMismatch) {
          result = await previousUpdateFolder(id, {
            reviewSettings: withProfile(
              result.reviewSettings,
              context.profile,
              Number.isFinite(Number(context.rawMax)) ? context.rawMax : result.reviewSettings?.maxIntervalDays
            ),
            ...(desiredMode ? { reviewModelMode: desiredMode } : {}),
            ...(desiredModelId ? { reviewModelId: desiredModelId } : {})
          });
        }
      }
      return result;
    };

    OituDB.addDeck = async function (...args) {
      let deck = await previousAddDeck(...args);
      if (!deck?.id) return deck;
      const profile = deck.reviewModelId ? profileForSelection(deck.reviewModelId) : profileForSelection(currentGlobalValue());
      deck = await OituDB.updateDeck(deck.id, {
        reviewSettings: withProfile(deck.reviewSettings, profile),
        reviewModelMode: deck.reviewModelMode || "global",
        reviewModelId: deck.reviewModelId || currentGlobalValue()
      });
      return rememberDeck(deck);
    };

    OituDB.addFolder = async function (...args) {
      let folder = await previousAddFolder(...args);
      if (!folder?.id) return folder;
      const profile = folder.reviewModelId ? profileForSelection(folder.reviewModelId) : profileForSelection(currentGlobalValue());
      folder = await OituDB.updateFolder(folder.id, {
        reviewSettings: withProfile(folder.reviewSettings, profile),
        reviewModelMode: folder.reviewModelMode || "global",
        reviewModelId: folder.reviewModelId || currentGlobalValue()
      });
      return folder;
    };

    OituDB.getCardsByDeck = async function (deckId) {
      const cards = await previousGetCardsByDeck(deckId);
      try {
        const deck = await previousGetDeck(deckId);
        rememberDeck(deck);
      } catch (_) {}

      const inStudy = state.studyDeckIds.has(deckId);
      return cards.map((original) => {
        if (original?.id) {
          const raw = { ...original };
          state.cardsById.set(original.id, raw);
          state.cardDeckIds.set(original.id, deckId);
        }
        let card = exactDueClone(original);
        if (inStudy) card = addCardMarker(card);
        return card;
      });
    };

    OituDB.updateCard = async function (id, patch) {
      let rawCard = null;
      try {
        rawCard = await previousGetCard(id);
      } catch (_) {}

      const deckId = rawCard?.deckId || state.cardDeckIds.get(id) || null;
      if (deckId) state.cardDeckIds.set(id, deckId);

      if (patch && Object.prototype.hasOwnProperty.call(patch, "currentIntervalDays") &&
          patch.currentIntervalDays === null && Number(patch.reviewCount) === 0) {
        patch.currentIntervalValue = null;
        patch.currentIntervalUnit = null;
        patch.currentIntervalMinutes = null;
        patch.currentIntervalHours = null;
      } else if (patch && RATINGS.includes(patch.lastRating) && rawCard) {
        let deck = null;
        try {
          deck = await previousGetDeck(deckId);
        } catch (_) {}

        if (deck) {
          rememberDeck(deck);
          const profile = profileForSettings(deck.reviewSettings);
          const settings = numericSettings(deck);
          const duration = calculateNextDuration(rawCard, patch.lastRating, settings, profile);
          const reviewedAt = patch.lastReviewedAt || new Date().toISOString();
          const nextReviewAt = scheduleAfter(duration, reviewedAt);

          patch.currentIntervalDays = duration.value;
          patch.currentIntervalValue = duration.value;
          patch.currentIntervalUnit = duration.unit;
          patch.currentIntervalMinutes = duration.minutes;
          patch.currentIntervalHours = duration.minutes / 60;
          patch.nextReviewAt = nextReviewAt;

          if (Array.isArray(patch.ratingHistory) && patch.ratingHistory.length) {
            const last = patch.ratingHistory[patch.ratingHistory.length - 1];
            if (last && RATINGS.includes(last.rating)) {
              patch.ratingHistory = [
                ...patch.ratingHistory.slice(0, -1),
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
          }
        }
      }

      const result = await previousUpdateCard(id, patch);
      if (result?.id) state.cardsById.set(id, { ...result });
      else if (rawCard) state.cardsById.set(id, { ...rawCard, ...patch });
      return result;
    };

    return true;
  }

  function ensureStyle() {
    if ($("#reviewTimeUnitsStyle")) return;
    const style = document.createElement("style");
    style.id = "reviewTimeUnitsStyle";
    style.textContent = `
      .review-time-unit-select{width:auto;min-width:92px;height:34px;padding:0 27px 0 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text);font:inherit;font-size:.78rem;font-weight:700;cursor:pointer}
      .review-interval-field>div .review-time-unit-select,.folder-review-grid label>div .review-time-unit-select,.folder-review-max>div .review-time-unit-select,.review-model-fields-grid label>div .review-time-unit-select,.review-model-max-row label>div .review-time-unit-select{flex:0 0 auto}
      @media(max-width:560px){.review-time-unit-select{min-width:86px}}
    `;
    document.head.appendChild(style);
  }

  function fieldForInput(scope, id) {
    return Object.entries(FIELD_IDS[scope] || {}).find(([, inputId]) => inputId === id)?.[0] || null;
  }

  function makeUnitSelect(scope, field) {
    const select = document.createElement("select");
    select.className = "review-time-unit-select";
    select.dataset.reviewTimeScope = scope;
    select.dataset.reviewTimeField = field;
    select.setAttribute("aria-label", `Unidade do intervalo ${field === "max" ? "máximo" : field}`);
    select.appendChild(new Option("minutos", MINUTE));
    select.appendChild(new Option("horas", HOUR));
    select.appendChild(new Option("dias", DAY));
    select.value = scopeProfiles[scope]?.[field] || DAY;
    return select;
  }

  function applyInputRules(input, unit) {
    if (!input) return;
    const safe = normalizeUnit(unit);
    input.min = safe === MINUTE ? "5" : "1";
    input.step = safe === MINUTE ? "5" : "1";
    input.max = "3650";
  }

  function ensureScopeControls(scope) {
    const ids = FIELD_IDS[scope];
    if (!ids) return;

    for (const [field, id] of Object.entries(ids)) {
      const input = $(`#${id}`);
      if (!input?.parentElement) continue;

      let select = input.parentElement.querySelector(
        `select[data-review-time-scope="${scope}"][data-review-time-field="${field}"]`
      );
      if (!select) {
        const old = input.parentElement.querySelector("select[data-review-time-unit]");
        if (old) old.remove();
        const small = input.parentElement.querySelector("small");
        select = makeUnitSelect(scope, field);
        if (small) small.replaceWith(select);
        else input.insertAdjacentElement("afterend", select);
      }

      select.value = scopeProfiles[scope]?.[field] || DAY;
      applyInputRules(input, select.value);
    }

    updateScopeCopy(scope);
  }

  function setScopeProfile(scope, profile) {
    scopeProfiles[scope] = cloneProfile(profile);
    ensureScopeControls(scope);

    for (const [field, id] of Object.entries(FIELD_IDS[scope] || {})) {
      const select = document.querySelector(
        `select[data-review-time-scope="${scope}"][data-review-time-field="${field}"]`
      );
      if (select) select.value = scopeProfiles[scope][field];
      applyInputRules($(`#${id}`), scopeProfiles[scope][field]);
    }
    updateScopeCopy(scope);
  }

  function updateScopeCopy(scope) {
    if (scope === "review") {
      const intro = $("#reviewSettingsForm .review-settings-intro p");
      if (intro) {
        const text = "Defina quando o card deve reaparecer após a primeira avaliação. Cada resposta pode usar minutos, horas ou dias.";
        if (intro.textContent !== text) intro.textContent = text;
      }

      const summary = $("#reviewRuleSummary");
      if (summary) {
        const max = roundedManualValue($("#reviewMaxDays")?.value, scopeProfiles.review.max);
        const duration = {
          value: max,
          unit: scopeProfiles.review.max,
          minutes: toMinutes(max, scopeProfiles.review.max)
        };
        const paragraphs = summary.querySelectorAll("p");
        const last = paragraphs[paragraphs.length - 1];
        if (last && /Intervalo máximo:/i.test(last.textContent || "")) {
          const desired = `Intervalo máximo: <strong>${formatDuration(duration)}</strong>.`;
          if (last.innerHTML !== desired) last.innerHTML = desired;
        }
      }
    }

    if (scope === "folder") {
      const intro = $("#folderReviewForm .folder-review-section p");
      if (intro) {
        const text = "Defina quando um card novo deve reaparecer. Cada resposta pode usar minutos, horas ou dias.";
        if (intro.textContent !== text) intro.textContent = text;
      }
    }
  }

  async function syncReviewProfile() {
    if (!state.activeDeckId) return;
    try {
      const deck = await OituDB.getDeck(state.activeDeckId);
      if (deck) setScopeProfile("review", profileForSettings(deck.reviewSettings));
    } catch (_) {}
  }

  async function syncFolderProfile() {
    if (!state.activeFolderId) return;
    try {
      const folder = await OituDB.getFolder(state.activeFolderId);
      if (folder) setScopeProfile("folder", profileForSettings(folder.reviewSettings));
    } catch (_) {}
  }

  function ensureAllControls() {
    ensureStyle();
    ensureScopeControls("review");
    ensureScopeControls("folder");
    ensureScopeControls("model");
  }

  function setManualSelection(scope) {
    const select = scope === "review" ? $("#reviewSettingsModelSelect") : $("#folderReviewModelSelect");
    if (!select) return;

    if (![...select.options].some((option) => option.value === "custom")) {
      const create = [...select.options].find((option) => option.value === "__create_review_model__");
      const custom = new Option("Ajuste manual", "custom");
      if (create) select.insertBefore(custom, create);
      else select.add(custom);
    }

    select.value = "custom";
    select.dataset.lastValue = "custom";
  }

  function snapMinuteInput(scope, field) {
    const id = FIELD_IDS[scope]?.[field];
    const input = id ? $(`#${id}`) : null;
    if (!input || normalizeUnit(scopeProfiles[scope]?.[field]) !== MINUTE) return;
    const snapped = roundedManualValue(input.value, MINUTE);
    if (String(input.value) !== String(snapped)) input.value = String(snapped);
  }

  function readScopeValues(scope) {
    const values = {};
    for (const [field, id] of Object.entries(FIELD_IDS[scope] || {})) {
      const input = $(`#${id}`);
      const unit = scopeProfiles[scope]?.[field] || DAY;
      if (unit === MINUTE) snapMinuteInput(scope, field);
      values[field] = Number.parseInt(input?.value, 10);
    }
    return values;
  }

  function validateScope(scope) {
    const values = readScopeValues(scope);
    if (FIELDS.some((field) => !Number.isInteger(values[field]) || values[field] < (scopeProfiles[scope][field] === MINUTE ? 5 : 1) || values[field] > 3650)) {
      return { error: "Use valores inteiros válidos. Em minutos, os intervalos devem ser múltiplos de 5." };
    }

    const maxMinutes = toMinutes(values.max, scopeProfiles[scope].max);
    const tooLarge = RATINGS.find((rating) =>
      toMinutes(values[rating], scopeProfiles[scope][rating]) > maxMinutes
    );
    if (tooLarge) {
      return { error: "O intervalo inicial de nenhuma resposta pode ultrapassar o intervalo máximo definido." };
    }
    return { values };
  }

  function showScopeError(scope, message) {
    if (scope === "review") {
      const status = $("#reviewSettingsStatus");
      if (status) status.textContent = message;
      return;
    }
    if (scope === "model") {
      const status = $("#reviewModelModalStatus");
      if (status) status.textContent = message;
      return;
    }
    alert(message);
  }

  function temporarilyRaiseRawMax(scope, values) {
    const id = FIELD_IDS[scope]?.max;
    const input = id ? $(`#${id}`) : null;
    if (!input) return () => {};

    const original = input.value;
    const required = Math.min(3650, Math.max(values.max, ...RATINGS.map((rating) => values[rating])));
    input.value = String(required);

    return () => {
      input.value = original;
      updateScopeCopy(scope);
    };
  }

  function persistModelProfile(name, profile, rawMax, previousUpdatedAt) {
    const normalizedName = String(name || "").trim().toLocaleLowerCase("pt-BR");
    if (!normalizedName) return null;

    let models;
    try {
      models = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) || "[]");
    } catch (_) {
      return null;
    }
    if (!Array.isArray(models)) return null;

    const model = models.find((item) =>
      String(item?.name || "").trim().toLocaleLowerCase("pt-BR") === normalizedName
    );
    if (!model?.id) return null;
    if (previousUpdatedAt && model.updatedAt === previousUpdatedAt) return null;

    model.settings = withProfile(model.settings, profile, rawMax);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(models));
    } catch (_) {}

    const profiles = readModelProfiles();
    profiles[model.id] = cloneProfile(profile);
    writeModelProfiles(profiles);
    return model.id;
  }

  async function syncGlobalFollowerProfiles() {
    if (!window.OituDB) return;
    const selection = currentGlobalValue();
    const profile = profileForSelection(selection);
    const [decks, folders] = await Promise.all([OituDB.getDecks(), OituDB.getFolders()]);

    await Promise.all([
      ...decks.filter((deck) => deck.reviewModelMode === "global").map((deck) =>
        OituDB.updateDeck(deck.id, {
          reviewSettings: withProfile(deck.reviewSettings, profile),
          reviewModelMode: "global",
          reviewModelId: selection
        })
      ),
      ...folders.filter((folder) => folder.reviewModelMode === "global").map((folder) =>
        OituDB.updateFolder(folder.id, {
          reviewSettings: withProfile(folder.reviewSettings, profile),
          reviewModelMode: "global",
          reviewModelId: selection
        })
      )
    ]);
  }

  function prepareSubmit(event) {
    const formId = event.target?.id;
    let scope = null;
    if (formId === "reviewSettingsForm") scope = "review";
    if (formId === "folderReviewForm") scope = "folder";
    if (formId === "reviewModelForm") scope = "model";
    if (!scope) return;

    const result = validateScope(scope);
    if (result.error) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showScopeError(scope, result.error);
      return;
    }

    const restoreMax = temporarilyRaiseRawMax(scope, result.values);

    if (scope === "review") {
      const selection = String($("#reviewSettingsModelSelect")?.value || "custom");
      state.pendingReviewContext = {
        deckId: state.activeDeckId,
        profile: cloneProfile(scopeProfiles.review),
        rawMax: result.values.max,
        mode: selection === "global" ? "global" : "manual",
        modelId: selection === "global" ? currentGlobalValue() : selection === "custom" ? "custom" : selection,
        expiresAt: Date.now() + 10000
      };
      setTimeout(() => {
        restoreMax();
        if (state.pendingReviewContext?.expiresAt <= Date.now()) state.pendingReviewContext = null;
      }, 0);
      return;
    }

    if (scope === "folder") {
      const selection = String($("#folderReviewModelSelect")?.value || "custom");
      state.folderApplyContext = {
        profile: cloneProfile(scopeProfiles.folder),
        rawMax: result.values.max,
        mode: selection === "global" ? "global" : "manual",
        modelId: selection === "global" ? currentGlobalValue() : selection === "custom" ? "custom" : selection,
        expiresAt: Date.now() + 60000
      };
      setTimeout(restoreMax, 0);
      return;
    }

    const name = String($("#reviewModelName")?.value || "").trim();
    const existing = readModels().find((item) =>
      String(item?.name || "").trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")
    );
    state.pendingModelSave = {
      name,
      profile: cloneProfile(scopeProfiles.model),
      rawMax: result.values.max,
      previousUpdatedAt: existing?.updatedAt || null
    };

    setTimeout(() => {
      restoreMax();
      const pending = state.pendingModelSave;
      if (!pending) return;
      const modelId = persistModelProfile(
        pending.name,
        pending.profile,
        pending.rawMax,
        pending.previousUpdatedAt
      );
      state.pendingModelSave = null;
      if (modelId && currentGlobalValue() === `model:${modelId}`) {
        syncGlobalFollowerProfiles().catch((error) =>
          console.warn("OituCards: não foi possível atualizar as unidades do modelo geral salvo.", error)
        );
      }
    }, 0);
  }

  function renderHints(rootSelector, frontSelector, prefix) {
    const root = $(rootSelector);
    if (!root) return;

    const cardId = cardIdFromFront(frontSelector);
    const card = cardId ? state.cardsById.get(cardId) : null;
    const deckId = card?.deckId || state.cardDeckIds.get(cardId);
    const profile = deckId ? state.deckProfiles.get(deckId) : null;
    const settings = deckId ? state.deckSettings.get(deckId) : null;
    if (!card || !profile || !settings) return;

    RATINGS.forEach((rating) => {
      const duration = calculateNextDuration(card, rating, settings, profile);
      const id = `${prefix}${rating.charAt(0).toUpperCase()}${rating.slice(1)}`;
      const target = $(`#${id}`);
      if (!target) return;
      const desired = `(revisão em ${formatDuration(duration)})`;
      if (target.textContent !== desired) target.textContent = desired;
    });
  }

  function renderStudyHints() {
    renderHints("#studyRatingArea", "#studyFront", "rating");
  }

  function renderMultiHints() {
    renderHints("#multiRatings", "#multiFront", "multiHint");
  }

  function installScopedObservers() {
    if (state.observersInstalled) return;
    state.observersInstalled = true;

    const install = () => {
      const studyRatings = $("#studyRatingArea");
      if (studyRatings && studyRatings.dataset.timeProfileObserved !== "true") {
        studyRatings.dataset.timeProfileObserved = "true";
        const observer = new MutationObserver(renderStudyHints);
        observer.observe(studyRatings, { childList: true, subtree: true, characterData: true });
      }

      const studyFront = $("#studyFront");
      if (studyFront && studyFront.dataset.timeProfileObserved !== "true") {
        studyFront.dataset.timeProfileObserved = "true";
        const observer = new MutationObserver(renderStudyHints);
        observer.observe(studyFront, { childList: true, subtree: true });
      }

      const multiRatings = $("#multiRatings");
      if (multiRatings && multiRatings.dataset.timeProfileObserved !== "true") {
        multiRatings.dataset.timeProfileObserved = "true";
        const observer = new MutationObserver(renderMultiHints);
        observer.observe(multiRatings, { childList: true, subtree: true, characterData: true });
      }

      const multiFront = $("#multiFront");
      if (multiFront && multiFront.dataset.timeProfileObserved !== "true") {
        multiFront.dataset.timeProfileObserved = "true";
        const observer = new MutationObserver(renderMultiHints);
        observer.observe(multiFront, { childList: true, subtree: true });
      }

      const summary = $("#reviewRuleSummary");
      if (summary && summary.dataset.timeProfileObserved !== "true") {
        summary.dataset.timeProfileObserved = "true";
        const observer = new MutationObserver(() => updateScopeCopy("review"));
        observer.observe(summary, { childList: true, subtree: true, characterData: true });
      }

      const folderModal = $("#folderReviewModal");
      if (folderModal && folderModal.dataset.timeProfileContextObserved !== "true") {
        folderModal.dataset.timeProfileContextObserved = "true";
        const observer = new MutationObserver(() => {
          if (folderModal.classList.contains("hidden")) state.folderApplyContext = null;
        });
        observer.observe(folderModal, { attributes: true, attributeFilter: ["class"] });
      }
    };

    install();
    setTimeout(install, 0);
    setTimeout(install, 150);
  }

  function wrapStudyApis() {
    if (window.OituStudy?.openConfig && !OituStudy.openConfig.__reviewTimeProfilesWrapped) {
      const previous = OituStudy.openConfig;
      const wrapped = async function (deckId, ...args) {
        state.studyDeckIds = new Set(deckId ? [deckId] : []);
        const result = await previous.call(this, deckId, ...args);
        setTimeout(renderStudyHints, 0);
        return result;
      };
      wrapped.__reviewTimeProfilesWrapped = true;
      OituStudy.openConfig = wrapped;
    }

    if (window.OituMultiStudy?.openConfig && !OituMultiStudy.openConfig.__reviewTimeProfilesWrapped) {
      const previous = OituMultiStudy.openConfig;
      const wrapped = async function (deckIds, ...args) {
        state.studyDeckIds = new Set((deckIds || []).filter(Boolean));
        const result = await previous.call(this, deckIds, ...args);
        setTimeout(renderMultiHints, 0);
        return result;
      };
      wrapped.__reviewTimeProfilesWrapped = true;
      OituMultiStudy.openConfig = wrapped;
    }
  }

  function captureContext(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const deckRow = target.closest("[data-deck-id]");
    if (deckRow && target.closest('.deck-name-button,[data-action="edit-deck"]')) {
      state.activeDeckId = deckRow.dataset.deckId || state.activeDeckId;
    }

    const folderEdit = target.closest("[data-edit-folder]");
    if (folderEdit) {
      state.activeFolderId =
        folderEdit.dataset.editFolder ||
        folderEdit.closest("[data-folder-id]")?.dataset.folderId ||
        state.activeFolderId;
    }

    if (target.closest("#homeButton,#studyHomeButton,#multiHome")) {
      state.studyDeckIds.clear();
    }

    if (target.closest("#reviewSettingsButton")) {
      setTimeout(() => {
        ensureAllControls();
        syncReviewProfile();
      }, 40);
    }

    if (target.closest("#folderReviewSettingsButton")) {
      setTimeout(() => {
        ensureAllControls();
        syncFolderProfile();
      }, 80);
    }

    if (target.closest("#restoreReviewDefaultsButton")) {
      setTimeout(() => setScopeProfile("review", DEFAULT_PROFILE), 0);
    }

    if (target.closest("#folderReviewRestore")) {
      setTimeout(() => setScopeProfile("folder", DEFAULT_PROFILE), 0);
    }

    if (target.closest("#saveReviewModelButton")) {
      state.pendingModelProfile = cloneProfile(scopeProfiles.review);
      setTimeout(() => {
        ensureAllControls();
        setScopeProfile("model", state.pendingModelProfile);
      }, 0);
    }

    if (target.closest("#createReviewModelFromSettings")) {
      const folderOpen = $("#folderReviewModal") && !$("#folderReviewModal").classList.contains("hidden");
      state.pendingModelProfile = folderOpen
        ? cloneProfile(scopeProfiles.folder)
        : profileForSelection($("#globalReviewModelSelect")?.value || currentGlobalValue());

      setTimeout(() => {
        ensureAllControls();
        setScopeProfile("model", state.pendingModelProfile);
      }, 0);
    }
  }

  function handleUnitChange(event) {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    const scope = select?.dataset.reviewTimeScope;
    const field = select?.dataset.reviewTimeField;
    if (!scope || !field || !scopeProfiles[scope]) return;

    scopeProfiles[scope][field] = normalizeUnit(select.value);
    applyInputRules($(`#${FIELD_IDS[scope][field]}`), scopeProfiles[scope][field]);

    if (scopeProfiles[scope][field] === MINUTE) {
      snapMinuteInput(scope, field);
    }

    if (scope === "review" || scope === "folder") setManualSelection(scope);
    if (scope === "model") state.pendingModelProfile = cloneProfile(scopeProfiles.model);
    updateScopeCopy(scope);
  }

  function handleModelSelectionChange(event) {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!select) return;

    if (select.id === "reviewSettingsModelSelect" && select.value !== "custom") {
      setTimeout(() => setScopeProfile("review", profileForSelection(select.value)), 0);
    }

    if (select.id === "folderReviewModelSelect" && select.value !== "custom" && select.value !== "__create_review_model__") {
      setTimeout(() => setScopeProfile("folder", profileForSelection(select.value)), 0);
    }

    if (select.id === "globalReviewModelSelect" && select.value !== "__create_review_model__") {
      const sync = () => syncGlobalFollowerProfiles().catch((error) =>
        console.warn("OituCards: não foi possível sincronizar as unidades do modelo geral.", error)
      );
      setTimeout(sync, 180);
      setTimeout(sync, 900);
    }
  }

  function handleNumericChange(event) {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input) return;

    for (const scope of ["review", "folder", "model"]) {
      const field = fieldForInput(scope, input.id);
      if (!field) continue;

      if (event.type === "change" && normalizeUnit(scopeProfiles[scope][field]) === MINUTE) {
        snapMinuteInput(scope, field);
      }
      updateScopeCopy(scope);

      if (event.isTrusted && (scope === "review" || scope === "folder")) {
        setManualSelection(scope);
      }
      break;
    }
  }

  function init() {
    ensureAllControls();
    patchDatabase();
    wrapStudyApis();
    installScopedObservers();

    setTimeout(() => {
      ensureAllControls();
      patchDatabase();
      wrapStudyApis();
      installScopedObservers();
    }, 0);

    setTimeout(() => {
      ensureAllControls();
      wrapStudyApis();
    }, 250);
  }

  document.addEventListener("click", captureContext, true);
  document.addEventListener("change", handleUnitChange, true);
  document.addEventListener("change", handleModelSelectionChange, true);
  document.addEventListener("change", handleNumericChange, true);
  document.addEventListener("input", handleNumericChange, true);
  document.addEventListener("submit", prepareSubmit, true);

  window.OituReviewTimeUnits = {
    formatDuration,
    calculateNextDuration
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();