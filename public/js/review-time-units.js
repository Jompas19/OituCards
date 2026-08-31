(function () {
  if (window.__oitucardsReviewTimeUnits) return;
  window.__oitucardsReviewTimeUnits = true;

  const MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  const MODEL_UNIT_STORAGE_KEY = "OituCardsReviewPresetUnitsV1";
  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
  const DAY = "days";
  const HOUR = "hours";
  const RATINGS = ["hard", "medium", "good", "easy"];

  const state = {
    activeDeckId: null,
    activeFolderId: null,
    pendingModelUnit: DAY,
    folderApplyContext: null,
    studyUnit: DAY,
    multiUnit: DAY,
    deckUnits: new Map(),
    deckNameUnits: new Map(),
    cardDeckIds: new Map(),
    observersInstalled: false,
    dbPatched: false
  };

  const scopeUnits = { review: DAY, folder: DAY, model: DAY };
  const $ = (selector, root = document) => root.querySelector(selector);

  function normalizeUnit(value) {
    return value === HOUR || value === "hour" || value === "horas" ? HOUR : DAY;
  }

  function unitLabel(unit, value = 2) {
    if (normalizeUnit(unit) === HOUR) return Number(value) === 1 ? "hora" : "horas";
    return Number(value) === 1 ? "dia" : "dias";
  }

  function readModels() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((model) => model?.id && model?.settings) : [];
    } catch (_) {
      return [];
    }
  }

  function readModelUnits() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MODEL_UNIT_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeModelUnits(units) {
    try {
      localStorage.setItem(MODEL_UNIT_STORAGE_KEY, JSON.stringify(units || {}));
    } catch (_) {}
  }

  function modelUnit(modelId) {
    const model = readModels().find((item) => item.id === modelId);
    if (model?.settings?.intervalUnit) return normalizeUnit(model.settings.intervalUnit);
    return normalizeUnit(readModelUnits()[modelId]);
  }

  function currentGlobalValue() {
    const value = String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system");
    if (value === "system") return value;
    if (value.startsWith("model:") && readModels().some((model) => `model:${model.id}` === value)) return value;
    return "system";
  }

  function unitForSelection(value) {
    const selection = String(value || "system");
    if (selection === "global") return unitForSelection(currentGlobalValue());
    if (selection === "system") return DAY;
    if (selection.startsWith("model:")) return modelUnit(selection.slice(6));
    return DAY;
  }

  function unitForSettings(settings, modelId = null) {
    if (settings?.intervalUnit) return normalizeUnit(settings.intervalUnit);
    if (modelId) return unitForSelection(modelId);
    return DAY;
  }

  function rememberDeck(deck) {
    if (!deck?.id) return deck;
    const unit = unitForSettings(deck.reviewSettings, deck.reviewModelId);
    state.deckUnits.set(deck.id, unit);
    const name = String(deck.name || "");
    if (name) {
      if (!state.deckNameUnits.has(name)) state.deckNameUnits.set(name, new Set());
      state.deckNameUnits.get(name).add(unit);
    }
    return deck;
  }

  async function resolveDeckUnit(deckId) {
    if (!deckId) return DAY;
    if (state.deckUnits.has(deckId)) return state.deckUnits.get(deckId);
    try {
      const deck = await OituDB.getDeck(deckId);
      rememberDeck(deck);
      return state.deckUnits.get(deckId) || DAY;
    } catch (_) {
      return DAY;
    }
  }

  function reviewSelectionContext(id) {
    if (id !== state.activeDeckId || !$("#reviewSettingsView")?.classList.contains("active")) return null;
    const selection = String($("#reviewSettingsModelSelect")?.value || "custom");
    const unit = scopeUnits.review;
    if (selection === "global") return { unit, mode: "global", modelId: currentGlobalValue() };
    if (selection === "system") return { unit: DAY, mode: "manual", modelId: "system" };
    if (selection.startsWith("model:")) return { unit, mode: "manual", modelId: selection };
    return { unit, mode: "manual", modelId: "custom" };
  }

  function folderSelectionContext() {
    const context = state.folderApplyContext;
    if (!context || context.expiresAt < Date.now()) return null;
    return context;
  }

  function desiredContext(type, id, patch) {
    if (type === "deck") {
      const review = reviewSelectionContext(id);
      if (review) return review;
    }
    const folder = folderSelectionContext();
    if (folder) return folder;
    if (patch?.reviewSettings?.intervalUnit) {
      return {
        unit: normalizeUnit(patch.reviewSettings.intervalUnit),
        mode: patch.reviewModelMode || null,
        modelId: patch.reviewModelId || null
      };
    }
    if (patch?.reviewModelId) {
      return {
        unit: unitForSelection(patch.reviewModelId),
        mode: patch.reviewModelMode || null,
        modelId: patch.reviewModelId
      };
    }
    return null;
  }

  function withUnit(settings, unit) {
    return { ...(settings || {}), intervalUnit: normalizeUnit(unit) };
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
      const context = desiredContext("deck", id, patch);
      let inheritedUnit = null;
      if (!context && patch?.reviewSettings && patch?.folderId && !patch.reviewSettings.intervalUnit) {
        try {
          const targetFolder = await previousGetFolder(patch.folderId);
          inheritedUnit = unitForSettings(targetFolder?.reviewSettings, targetFolder?.reviewModelId);
        } catch (_) {}
      }

      let nextPatch = patch;
      if (patch?.reviewSettings) {
        const unit = context?.unit || inheritedUnit || unitForSettings(patch.reviewSettings, patch.reviewModelId);
        nextPatch = { ...patch, reviewSettings: withUnit(patch.reviewSettings, unit) };
      }

      let result = await previousUpdateDeck(id, nextPatch);
      if (context && result) {
        const desiredMode = context.mode || result.reviewModelMode;
        const desiredModelId = context.modelId || result.reviewModelId;
        const needsMetadata = Boolean(desiredMode && (
          result.reviewModelMode !== desiredMode || String(result.reviewModelId || "") !== String(desiredModelId || "")
        ));
        const needsUnit = normalizeUnit(result.reviewSettings?.intervalUnit) !== normalizeUnit(context.unit);
        if (needsMetadata || needsUnit) {
          result = await previousUpdateDeck(id, {
            reviewSettings: withUnit(result.reviewSettings, context.unit),
            ...(desiredMode ? { reviewModelMode: desiredMode } : {}),
            ...(desiredModelId ? { reviewModelId: desiredModelId } : {})
          });
        }
      }
      return rememberDeck(result);
    };

    OituDB.updateFolder = async function (id, patch) {
      const context = desiredContext("folder", id, patch);
      let nextPatch = patch;
      if (patch?.reviewSettings) {
        const unit = context?.unit || unitForSettings(patch.reviewSettings, patch.reviewModelId);
        nextPatch = { ...patch, reviewSettings: withUnit(patch.reviewSettings, unit) };
      }
      let result = await previousUpdateFolder(id, nextPatch);
      if (context && result) {
        const desiredMode = context.mode || result.reviewModelMode;
        const desiredModelId = context.modelId || result.reviewModelId;
        const needsMetadata = Boolean(desiredMode && (
          result.reviewModelMode !== desiredMode || String(result.reviewModelId || "") !== String(desiredModelId || "")
        ));
        const needsUnit = normalizeUnit(result.reviewSettings?.intervalUnit) !== normalizeUnit(context.unit);
        if (needsMetadata || needsUnit) {
          result = await previousUpdateFolder(id, {
            reviewSettings: withUnit(result.reviewSettings, context.unit),
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
      const unit = unitForSelection(deck.reviewModelId || currentGlobalValue());
      if (normalizeUnit(deck.reviewSettings?.intervalUnit) !== unit) {
        deck = await OituDB.updateDeck(deck.id, {
          reviewSettings: withUnit(deck.reviewSettings, unit),
          reviewModelMode: deck.reviewModelMode || "global",
          reviewModelId: deck.reviewModelId || currentGlobalValue()
        });
      }
      return rememberDeck(deck);
    };

    OituDB.addFolder = async function (...args) {
      let folder = await previousAddFolder(...args);
      if (!folder?.id) return folder;
      const unit = unitForSelection(folder.reviewModelId || currentGlobalValue());
      if (normalizeUnit(folder.reviewSettings?.intervalUnit) !== unit) {
        folder = await OituDB.updateFolder(folder.id, {
          reviewSettings: withUnit(folder.reviewSettings, unit),
          reviewModelMode: folder.reviewModelMode || "global",
          reviewModelId: folder.reviewModelId || currentGlobalValue()
        });
      }
      return folder;
    };

    function adaptCard(card, deckUnit) {
      if (!card) return card;
      const copy = { ...card };
      const sourceUnit = normalizeUnit(card.currentIntervalUnit || DAY);
      const rawValue = Number.isFinite(Number(card.currentIntervalValue))
        ? Number(card.currentIntervalValue)
        : Number(card.currentIntervalDays);
      if (Number.isFinite(rawValue) && rawValue > 0) {
        let converted = rawValue;
        if (sourceUnit !== deckUnit) converted = sourceUnit === DAY ? rawValue * 24 : rawValue / 24;
        copy.currentIntervalDays = Math.max(1, converted);
      }

      if (sourceUnit === HOUR && card.nextReviewAt) {
        const due = new Date(card.nextReviewAt);
        const now = new Date();
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        if (!Number.isNaN(due.getTime()) && due > now && due <= end) {
          copy.nextReviewAt = new Date(end.getTime() + 1000).toISOString();
        }
      }
      return copy;
    }

    OituDB.getCardsByDeck = async function (deckId) {
      const cards = await previousGetCardsByDeck(deckId);
      const unit = await resolveDeckUnit(deckId);
      cards.forEach((card) => {
        if (card?.id) state.cardDeckIds.set(card.id, deckId);
      });
      return cards.map((card) => adaptCard(card, unit));
    };

    OituDB.updateCard = async function (id, patch) {
      let deckId = state.cardDeckIds.get(id) || null;
      if (!deckId) {
        try {
          const card = await previousGetCard(id);
          deckId = card?.deckId || null;
          if (deckId) state.cardDeckIds.set(id, deckId);
        } catch (_) {}
      }

      if (patch && Object.prototype.hasOwnProperty.call(patch, "currentIntervalDays") && patch.currentIntervalDays === null && Number(patch.reviewCount) === 0) {
        patch.currentIntervalValue = null;
        patch.currentIntervalUnit = null;
        patch.currentIntervalHours = null;
      } else if (patch && RATINGS.includes(patch.lastRating) && Number.isFinite(Number(patch.currentIntervalDays))) {
        const unit = await resolveDeckUnit(deckId);
        const value = Math.max(1, Math.round(Number(patch.currentIntervalDays)));
        patch.currentIntervalValue = value;
        patch.currentIntervalUnit = unit;
        patch.currentIntervalHours = unit === HOUR ? value : value * 24;

        if (unit === HOUR) {
          const base = patch.lastReviewedAt ? new Date(patch.lastReviewedAt) : new Date();
          const start = Number.isNaN(base.getTime()) ? new Date() : base;
          patch.nextReviewAt = new Date(start.getTime() + value * 60 * 60 * 1000).toISOString();
        }

        if (Array.isArray(patch.ratingHistory) && patch.ratingHistory.length) {
          const last = patch.ratingHistory[patch.ratingHistory.length - 1];
          if (last && RATINGS.includes(last.rating)) {
            patch.ratingHistory = [
              ...patch.ratingHistory.slice(0, -1),
              {
                ...last,
                intervalValue: value,
                intervalUnit: unit,
                nextReviewAt: patch.nextReviewAt
              }
            ];
          }
        }
      }

      return previousUpdateCard(id, patch);
    };

    return true;
  }

  function scopeInputIds(scope) {
    if (scope === "review") return ["reviewHardDays", "reviewMediumDays", "reviewGoodDays", "reviewEasyDays", "reviewMaxDays"];
    if (scope === "folder") return ["folderRevHardDays", "folderRevMediumDays", "folderRevGoodDays", "folderRevEasyDays", "folderRevMax"];
    return ["modelHardDays", "modelMediumDays", "modelGoodDays", "modelEasyDays", "modelMaxDays"];
  }

  function ensureStyle() {
    if ($("#reviewTimeUnitsStyle")) return;
    const style = document.createElement("style");
    style.id = "reviewTimeUnitsStyle";
    style.textContent = `
      .review-time-unit-select{width:auto;min-width:82px;height:34px;padding:0 26px 0 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text);font:inherit;font-size:.78rem;font-weight:700;cursor:pointer}
      .review-interval-field>div .review-time-unit-select,.folder-review-grid label>div .review-time-unit-select,.folder-review-max>div .review-time-unit-select,.review-model-fields-grid label>div .review-time-unit-select,.review-model-max-row label>div .review-time-unit-select{flex:0 0 auto}
      @media(max-width:560px){.review-time-unit-select{min-width:76px}}
    `;
    document.head.appendChild(style);
  }

  function makeUnitSelect(scope) {
    const select = document.createElement("select");
    select.className = "review-time-unit-select";
    select.dataset.reviewTimeUnit = scope;
    select.setAttribute("aria-label", "Unidade do intervalo de revisão");
    select.appendChild(new Option("dias", DAY));
    select.appendChild(new Option("horas", HOUR));
    select.value = scopeUnits[scope] || DAY;
    return select;
  }

  function ensureScopeControls(scope) {
    for (const id of scopeInputIds(scope)) {
      const input = $(`#${id}`);
      if (!input?.parentElement) continue;
      let select = input.parentElement.querySelector(`select[data-review-time-unit="${scope}"]`);
      if (!select) {
        const small = input.parentElement.querySelector("small");
        select = makeUnitSelect(scope);
        if (small) small.replaceWith(select);
        else input.insertAdjacentElement("afterend", select);
      }
      select.value = scopeUnits[scope] || DAY;
    }
    updateScopeCopy(scope);
  }

  function setScopeUnit(scope, unit) {
    const safe = normalizeUnit(unit);
    scopeUnits[scope] = safe;
    document.querySelectorAll(`select[data-review-time-unit="${scope}"]`).forEach((select) => {
      select.value = safe;
    });
    updateScopeCopy(scope);
  }

  function updateScopeCopy(scope) {
    const unit = scopeUnits[scope] || DAY;
    if (scope === "review") {
      const intro = $("#reviewSettingsForm .review-settings-intro p");
      if (intro) {
        const desiredIntro = unit === HOUR
          ? "Defina em quantas horas o card deve reaparecer após a primeira avaliação."
          : "Defina em quantos dias o card deve reaparecer após a primeira avaliação.";
        if (intro.textContent !== desiredIntro) intro.textContent = desiredIntro;
      }
      const summary = $("#reviewRuleSummary");
      if (summary) {
        const max = Number($("#reviewMaxDays")?.value || 0);
        const paragraphs = summary.querySelectorAll("p");
        const last = paragraphs[paragraphs.length - 1];
        if (last && /Intervalo máximo:/i.test(last.textContent || "")) {
          const desired = `Intervalo máximo: <strong>${max} ${unitLabel(unit, max)}</strong>.`;
          if (last.innerHTML !== desired) last.innerHTML = desired;
        }
      }
    }
    if (scope === "folder") {
      const first = $("#folderReviewForm .folder-review-section p");
      if (first) {
        const desired = unit === HOUR
          ? "Em quantas horas um card novo deve reaparecer."
          : "Em quantos dias um card novo deve reaparecer.";
        if (first.textContent !== desired) first.textContent = desired;
      }
    }
  }

  async function syncReviewUnit() {
    if (!state.activeDeckId) return;
    try {
      const deck = await OituDB.getDeck(state.activeDeckId);
      setScopeUnit("review", unitForSettings(deck?.reviewSettings, deck?.reviewModelId));
    } catch (_) {}
  }

  async function syncFolderUnit() {
    if (!state.activeFolderId) return;
    try {
      const folder = await OituDB.getFolder(state.activeFolderId);
      setScopeUnit("folder", unitForSettings(folder?.reviewSettings, folder?.reviewModelId));
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

  function persistModelUnit(name, unit) {
    const normalizedName = String(name || "").trim().toLocaleLowerCase("pt-BR");
    if (!normalizedName) return null;
    let models;
    try {
      models = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) || "[]");
    } catch (_) {
      return null;
    }
    if (!Array.isArray(models)) return null;
    const model = models.find((item) => String(item?.name || "").trim().toLocaleLowerCase("pt-BR") === normalizedName);
    if (!model?.id) return null;
    model.settings = withUnit(model.settings, unit);
    try { localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(models)); } catch (_) {}
    const units = readModelUnits();
    units[model.id] = normalizeUnit(unit);
    writeModelUnits(units);
    return model.id;
  }

  async function syncGlobalFollowerUnits() {
    if (!window.OituDB) return;
    const selection = currentGlobalValue();
    const unit = unitForSelection(selection);
    const [decks, folders] = await Promise.all([OituDB.getDecks(), OituDB.getFolders()]);
    await Promise.all([
      ...decks.filter((deck) => deck.reviewModelMode === "global").map((deck) => OituDB.updateDeck(deck.id, {
        reviewSettings: withUnit(deck.reviewSettings, unit),
        reviewModelMode: "global",
        reviewModelId: selection
      })),
      ...folders.filter((folder) => folder.reviewModelMode === "global").map((folder) => OituDB.updateFolder(folder.id, {
        reviewSettings: withUnit(folder.reviewSettings, unit),
        reviewModelMode: "global",
        reviewModelId: selection
      }))
    ]);
  }

  function decorateRatingHints(root, unit) {
    if (!root || normalizeUnit(unit) !== HOUR) return;
    root.querySelectorAll(".rating-interval").forEach((hint) => {
      const text = String(hint.textContent || "");
      if (!/revisão em/i.test(text) || !/\bdias?\b/i.test(text)) return;
      const desired = text.replace(/\b1 dia\b/i, "1 hora").replace(/\bdias\b/gi, "horas").replace(/\bdia\b/gi, "hora");
      if (hint.textContent !== desired) hint.textContent = desired;
    });
  }

  function currentMultiUnitFromChip() {
    const name = String($("#multiDeckChip")?.textContent || "");
    const units = state.deckNameUnits.get(name);
    if (units?.size === 1) return [...units][0];
    return state.multiUnit || DAY;
  }

  function installScopedObservers() {
    if (state.observersInstalled) return;
    state.observersInstalled = true;

    const install = () => {
      const studyRatings = $("#studyRatingArea");
      if (studyRatings && studyRatings.dataset.timeUnitObserved !== "true") {
        studyRatings.dataset.timeUnitObserved = "true";
        const observer = new MutationObserver(() => decorateRatingHints(studyRatings, state.studyUnit));
        observer.observe(studyRatings, { childList: true, subtree: true, characterData: true });
      }

      const multiRatings = $("#multiRatings");
      if (multiRatings && multiRatings.dataset.timeUnitObserved !== "true") {
        multiRatings.dataset.timeUnitObserved = "true";
        const observer = new MutationObserver(() => decorateRatingHints(multiRatings, currentMultiUnitFromChip()));
        observer.observe(multiRatings, { childList: true, subtree: true, characterData: true });
      }

      const chip = $("#multiDeckChip");
      if (chip && chip.dataset.timeUnitObserved !== "true") {
        chip.dataset.timeUnitObserved = "true";
        const observer = new MutationObserver(() => {
          state.multiUnit = currentMultiUnitFromChip();
          decorateRatingHints($("#multiRatings"), state.multiUnit);
        });
        observer.observe(chip, { childList: true, subtree: true, characterData: true });
      }

      const summary = $("#reviewRuleSummary");
      if (summary && summary.dataset.timeUnitObserved !== "true") {
        summary.dataset.timeUnitObserved = "true";
        const observer = new MutationObserver(() => updateScopeCopy("review"));
        observer.observe(summary, { childList: true, subtree: true, characterData: true });
      }

      const folderModal = $("#folderReviewModal");
      if (folderModal && folderModal.dataset.timeUnitContextObserved !== "true") {
        folderModal.dataset.timeUnitContextObserved = "true";
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
    if (window.OituStudy?.openConfig && !OituStudy.openConfig.__reviewTimeUnitsWrapped) {
      const previous = OituStudy.openConfig;
      const wrapped = async function (deckId, ...args) {
        state.studyUnit = await resolveDeckUnit(deckId);
        const result = await previous.call(this, deckId, ...args);
        setTimeout(() => decorateRatingHints($("#studyRatingArea"), state.studyUnit), 0);
        return result;
      };
      wrapped.__reviewTimeUnitsWrapped = true;
      OituStudy.openConfig = wrapped;
    }

    if (window.OituMultiStudy?.openConfig && !OituMultiStudy.openConfig.__reviewTimeUnitsWrapped) {
      const previous = OituMultiStudy.openConfig;
      const wrapped = async function (deckIds, ...args) {
        await Promise.all((deckIds || []).map((id) => resolveDeckUnit(id)));
        const result = await previous.call(this, deckIds, ...args);
        setTimeout(() => {
          state.multiUnit = currentMultiUnitFromChip();
          decorateRatingHints($("#multiRatings"), state.multiUnit);
        }, 0);
        return result;
      };
      wrapped.__reviewTimeUnitsWrapped = true;
      OituMultiStudy.openConfig = wrapped;
    }
  }

  function captureContext(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const deckRow = target.closest("[data-deck-id]");
    if (deckRow && target.closest(".deck-name-button,[data-action=\"edit-deck\"]")) state.activeDeckId = deckRow.dataset.deckId || state.activeDeckId;

    const folderEdit = target.closest("[data-edit-folder]");
    if (folderEdit) state.activeFolderId = folderEdit.dataset.editFolder || folderEdit.closest("[data-folder-id]")?.dataset.folderId || state.activeFolderId;

    if (target.closest("#reviewSettingsButton")) {
      setTimeout(() => {
        ensureAllControls();
        syncReviewUnit();
      }, 40);
    }

    if (target.closest("#folderReviewSettingsButton")) {
      setTimeout(() => {
        ensureAllControls();
        syncFolderUnit();
      }, 80);
    }

    if (target.closest("#restoreReviewDefaultsButton")) setTimeout(() => setScopeUnit("review", DAY), 0);
    if (target.closest("#folderReviewRestore")) setTimeout(() => setScopeUnit("folder", DAY), 0);

    if (target.closest("#saveReviewModelButton")) {
      state.pendingModelUnit = scopeUnits.review;
      setTimeout(() => {
        ensureAllControls();
        setScopeUnit("model", state.pendingModelUnit);
      }, 0);
    }

    if (target.closest("#createReviewModelFromSettings")) {
      const folderOpen = $("#folderReviewModal") && !$("#folderReviewModal").classList.contains("hidden");
      state.pendingModelUnit = folderOpen ? scopeUnits.folder : unitForSelection($("#globalReviewModelSelect")?.value || currentGlobalValue());
      setTimeout(() => {
        ensureAllControls();
        setScopeUnit("model", state.pendingModelUnit);
      }, 0);
    }
  }

  function handleUnitChange(event) {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    const scope = select?.dataset.reviewTimeUnit;
    if (!scope) return;
    setScopeUnit(scope, select.value);
    if (scope === "review" || scope === "folder") setManualSelection(scope);
    if (scope === "model") state.pendingModelUnit = scopeUnits.model;
  }

  function handleModelSelectionChange(event) {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!select) return;
    if (select.id === "reviewSettingsModelSelect") {
      const unit = select.value === "custom" ? scopeUnits.review : unitForSelection(select.value);
      setTimeout(() => setScopeUnit("review", unit), 0);
    }
    if (select.id === "folderReviewModelSelect") {
      const unit = select.value === "custom" ? scopeUnits.folder : unitForSelection(select.value);
      setTimeout(() => setScopeUnit("folder", unit), 0);
    }
    if (select.id === "globalReviewModelSelect" && select.value !== "__create_review_model__") {
      setTimeout(() => syncGlobalFollowerUnits().catch((error) => console.warn("OituCards: não foi possível sincronizar a unidade do modelo geral.", error)), 120);
    }
  }

  function handleSubmit(event) {
    if (event.target?.id === "folderReviewForm") {
      const selection = String($("#folderReviewModelSelect")?.value || "custom");
      const unit = scopeUnits.folder;
      state.folderApplyContext = {
        unit,
        mode: selection === "global" ? "global" : "manual",
        modelId: selection === "global" ? currentGlobalValue() : selection === "custom" ? "custom" : selection,
        expiresAt: Date.now() + 60000
      };
      setTimeout(() => {
        if (state.folderApplyContext?.expiresAt <= Date.now()) state.folderApplyContext = null;
      }, 60100);
      return;
    }

    if (event.target?.id === "reviewModelForm") {
      const name = String($("#reviewModelName")?.value || "").trim();
      const unit = scopeUnits.model;
      const existing = readModels().find((item) => String(item.name || "").trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"));
      if (existing?.id) {
        const units = readModelUnits();
        units[existing.id] = unit;
        writeModelUnits(units);
      }
      setTimeout(() => {
        const modelId = persistModelUnit(name, unit);
        if (modelId && currentGlobalValue() === `model:${modelId}`) {
          syncGlobalFollowerUnits().catch((error) => console.warn("OituCards: não foi possível atualizar a unidade do modelo geral salvo.", error));
        }
      }, 0);
    }
  }

  function handleInput(event) {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target) return;
    if (["reviewHardDays", "reviewMediumDays", "reviewGoodDays", "reviewEasyDays", "reviewMaxDays"].includes(target.id)) {
      setTimeout(() => updateScopeCopy("review"), 0);
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
  document.addEventListener("submit", handleSubmit, true);
  document.addEventListener("input", handleInput, true);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
