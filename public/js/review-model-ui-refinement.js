(function () {
  if (window.__oitucardsReviewModelUiRefinement) return;
  window.__oitucardsReviewModelUiRefinement = true;

  const CREATE_VALUE = "__create_review_model__";
  const CUSTOM_VALUE = "custom";
  const MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
  const SYSTEM_SETTINGS = Object.freeze({
    newIntervals: Object.freeze({ hard: 1, medium: 2, good: 4, easy: 7 }),
    multipliers: Object.freeze({ hard: 1.2, medium: 1.8, good: 2.5, easy: 4 }),
    maxIntervalDays: 180
  });
  const RATINGS = ["hard", "medium", "good", "easy"];

  let decorating = false;
  let globalSelectObserver = null;
  let reviewSelectObserver = null;
  let folderModalObserver = null;
  let currentDeckId = null;
  let currentFolderId = null;
  let fillingFolderForm = false;
  let folderApplyContext = null;
  const pendingDeckSelection = new Map();

  const $ = (selector, root = document) => root.querySelector(selector);

  function cloneSettings(settings) {
    const normalized = normalizeSettings(settings);
    return {
      newIntervals: { ...normalized.newIntervals },
      multipliers: { ...normalized.multipliers },
      maxIntervalDays: normalized.maxIntervalDays
    };
  }

  function normalizeSettings(raw) {
    const source = raw || {};
    const intervals = source.newIntervals || source || {};
    const multipliers = source.multipliers || {};
    const parsedMax = Number.parseInt(source.maxIntervalDays, 10);
    const maxIntervalDays = Number.isInteger(parsedMax) && parsedMax >= 1 && parsedMax <= 3650
      ? parsedMax
      : SYSTEM_SETTINGS.maxIntervalDays;
    const newIntervals = {};
    const normalizedMultipliers = {};
    RATINGS.forEach((rating) => {
      const interval = Number.parseInt(intervals[rating], 10);
      newIntervals[rating] = Number.isInteger(interval) && interval >= 1
        ? Math.min(maxIntervalDays, interval)
        : SYSTEM_SETTINGS.newIntervals[rating];
      const multiplier = Number.parseFloat(multipliers[rating]);
      normalizedMultipliers[rating] = Number.isFinite(multiplier) && multiplier >= 1
        ? Math.min(10, Math.round(multiplier * 100) / 100)
        : SYSTEM_SETTINGS.multipliers[rating];
    });
    return { newIntervals, multipliers: normalizedMultipliers, maxIntervalDays };
  }

  function settingsEqual(a, b) {
    const left = normalizeSettings(a);
    const right = normalizeSettings(b);
    return left.maxIntervalDays === right.maxIntervalDays && RATINGS.every((rating) =>
      left.newIntervals[rating] === right.newIntervals[rating] &&
      left.multipliers[rating] === right.multipliers[rating]
    );
  }

  function readModels() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && item.settings)
        .map((item) => ({ ...item, name: item.name.trim(), settings: normalizeSettings(item.settings) }))
        .filter((item) => item.name)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    } catch (_) {
      return [];
    }
  }

  function currentGlobalValue() {
    const stored = String(localStorage.getItem(GLOBAL_MODEL_KEY) || "system");
    if (stored === CREATE_VALUE || stored === "global" || stored === CUSTOM_VALUE) return "system";
    if (stored.startsWith("model:") && !readModels().some((model) => `model:${model.id}` === stored)) return "system";
    return stored;
  }

  function modelByValue(value) {
    if (!String(value || "").startsWith("model:")) return null;
    const id = String(value).slice(6);
    return readModels().find((model) => model.id === id) || null;
  }

  function settingsForValue(value) {
    if (value === "global") return settingsForValue(currentGlobalValue());
    if (value === "system") return cloneSettings(SYSTEM_SETTINGS);
    const model = modelByValue(value);
    return model ? cloneSettings(model.settings) : cloneSettings(SYSTEM_SETTINGS);
  }

  function modelValueForSettings(settings) {
    if (settingsEqual(settings, SYSTEM_SETTINGS)) return "system";
    const match = readModels().find((model) => settingsEqual(settings, model.settings));
    return match ? `model:${match.id}` : CUSTOM_VALUE;
  }

  function metadataForSelection(selection, settings) {
    const actualValue = modelValueForSettings(settings);
    if (selection === "global" && settingsEqual(settings, settingsForValue("global"))) {
      return { reviewModelMode: "global", reviewModelId: currentGlobalValue() };
    }
    return { reviewModelMode: "manual", reviewModelId: actualValue };
  }

  function ensureStyle() {
    if ($("#reviewModelUiRefinementStyle")) return;
    const style = document.createElement("style");
    style.id = "reviewModelUiRefinementStyle";
    style.textContent = `
      #studyReviewModelSetting{display:none!important}
      #globalReviewModelHelp,#createReviewModelFromSettings{display:none!important}
      .folder-review-model-block{display:grid;gap:7px;padding:0 0 18px;margin-bottom:2px;border-bottom:1px solid var(--line)}
      .folder-review-model-block label{font-size:.82rem;font-weight:700;color:var(--text)}
      .folder-review-model-block select{width:100%}
    `;
    document.head.appendChild(style);
  }

  function normalizeSystemOption(select) {
    const system = [...(select?.options || [])].find((option) => option.value === "system");
    if (system && system.textContent !== "Padrão OituCards") system.textContent = "Padrão OituCards";
  }

  function normalizeFollowGlobalOption(select) {
    const global = [...(select?.options || [])].find((option) => option.value === "global");
    if (global && global.textContent !== "Modelo padrão definido") global.textContent = "Modelo padrão definido";
  }

  function ensureCreateOption(select) {
    if (!select) return;
    const matches = [...select.options].filter((option) => option.value === CREATE_VALUE);
    matches.slice(1).forEach((option) => option.remove());
    let option = matches[0] || null;
    if (!option) {
      option = new Option("＋ Criar novo modelo…", CREATE_VALUE);
      select.add(option);
      return;
    }
    if (option.textContent !== "＋ Criar novo modelo…") option.textContent = "＋ Criar novo modelo…";
    if (select.options[select.options.length - 1] !== option) select.appendChild(option);
  }

  function decorateGlobalSelect() {
    if (decorating) return;
    const select = $("#globalReviewModelSelect");
    if (!select) return;
    decorating = true;
    try {
      normalizeSystemOption(select);
      ensureCreateOption(select);
      const current = currentGlobalValue();
      if (select.value === CREATE_VALUE && [...select.options].some((option) => option.value === current)) select.value = current;
    } finally {
      decorating = false;
    }
  }

  function decorateReviewSettingsSelect() {
    const select = $("#reviewSettingsModelSelect");
    if (!select) return;
    normalizeSystemOption(select);
    normalizeFollowGlobalOption(select);
  }

  function folderModelMarkup() {
    return `<div id="folderReviewModelBlock" class="folder-review-model-block">
      <label for="folderReviewModelSelect">Modelo de revisão</label>
      <select id="folderReviewModelSelect" class="text-input"></select>
    </div>`;
  }

  function ensureFolderReviewUI() {
    const form = $("#folderReviewForm");
    if (!form) return;
    if (!$("#folderReviewModelBlock")) {
      const firstSection = form.querySelector(".folder-review-section");
      if (firstSection) firstSection.insertAdjacentHTML("beforebegin", folderModelMarkup());
      else form.insertAdjacentHTML("afterbegin", folderModelMarkup());
    }
  }

  function readFolderFormSettings() {
    const maxIntervalDays = Number.parseInt($("#folderRevMax")?.value, 10);
    const settings = {
      newIntervals: {
        hard: Number.parseInt($("#folderRevHardDays")?.value, 10),
        medium: Number.parseInt($("#folderRevMediumDays")?.value, 10),
        good: Number.parseInt($("#folderRevGoodDays")?.value, 10),
        easy: Number.parseInt($("#folderRevEasyDays")?.value, 10)
      },
      multipliers: {
        hard: Number.parseFloat($("#folderRevHardMult")?.value),
        medium: Number.parseFloat($("#folderRevMediumMult")?.value),
        good: Number.parseFloat($("#folderRevGoodMult")?.value),
        easy: Number.parseFloat($("#folderRevEasyMult")?.value)
      },
      maxIntervalDays
    };
    if (!Number.isInteger(maxIntervalDays) || maxIntervalDays < 1 || maxIntervalDays > 3650) return null;
    if (RATINGS.some((rating) => !Number.isInteger(settings.newIntervals[rating]) || settings.newIntervals[rating] < 1 || settings.newIntervals[rating] > maxIntervalDays)) return null;
    if (RATINGS.some((rating) => !Number.isFinite(settings.multipliers[rating]) || settings.multipliers[rating] < 1 || settings.multipliers[rating] > 10)) return null;
    return normalizeSettings(settings);
  }

  function fillFolderForm(settings) {
    const normalized = normalizeSettings(settings);
    const values = {
      folderRevHardDays: normalized.newIntervals.hard,
      folderRevMediumDays: normalized.newIntervals.medium,
      folderRevGoodDays: normalized.newIntervals.good,
      folderRevEasyDays: normalized.newIntervals.easy,
      folderRevHardMult: normalized.multipliers.hard,
      folderRevMediumMult: normalized.multipliers.medium,
      folderRevGoodMult: normalized.multipliers.good,
      folderRevEasyMult: normalized.multipliers.easy,
      folderRevMax: normalized.maxIntervalDays
    };
    fillingFolderForm = true;
    Object.entries(values).forEach(([id, value]) => {
      const input = $(`#${id}`);
      if (input) input.value = value;
    });
    fillingFolderForm = false;
  }

  function populateFolderModelSelect(selectedValue = null) {
    ensureFolderReviewUI();
    const select = $("#folderReviewModelSelect");
    if (!select) return;
    const previous = selectedValue || select.value;
    select.innerHTML = "";
    select.add(new Option("Modelo padrão definido", "global"));
    select.add(new Option("Padrão OituCards", "system"));
    readModels().forEach((model) => select.add(new Option(model.name, `model:${model.id}`)));
    const needsCustom = previous === CUSTOM_VALUE || (!previous && modelValueForSettings(readFolderFormSettings() || SYSTEM_SETTINGS) === CUSTOM_VALUE);
    if (needsCustom) select.add(new Option("Ajuste manual", CUSTOM_VALUE));
    select.add(new Option("＋ Criar novo modelo…", CREATE_VALUE));
    const fallback = modelValueForSettings(readFolderFormSettings() || SYSTEM_SETTINGS);
    const value = [...select.options].some((option) => option.value === previous) ? previous : fallback;
    if (value === CUSTOM_VALUE && ![...select.options].some((option) => option.value === CUSTOM_VALUE)) {
      select.insertBefore(new Option("Ajuste manual", CUSTOM_VALUE), select.options[select.options.length - 1]);
    }
    select.value = [...select.options].some((option) => option.value === value) ? value : "system";
    select.dataset.lastValue = select.value;
  }

  async function syncFolderModelSelect() {
    ensureFolderReviewUI();
    const select = $("#folderReviewModelSelect");
    if (!select || !currentFolderId) {
      populateFolderModelSelect();
      return;
    }
    const folder = await OituDB.getFolder(currentFolderId);
    if (!folder) {
      populateFolderModelSelect();
      return;
    }
    let selection;
    if (folder.reviewModelMode === "global") selection = "global";
    else if (folder.reviewModelMode === "manual") {
      const stored = String(folder.reviewModelId || "");
      if (stored === "system") selection = "system";
      else if (stored.startsWith("model:") && modelByValue(stored)) selection = stored;
      else selection = modelValueForSettings(folder.reviewSettings || readFolderFormSettings() || SYSTEM_SETTINGS);
    } else {
      selection = modelValueForSettings(folder.reviewSettings || readFolderFormSettings() || SYSTEM_SETTINGS);
    }
    populateFolderModelSelect(selection);
  }

  function fillReviewModelModalFromSettings(settings) {
    const normalized = normalizeSettings(settings);
    const values = {
      modelHardDays: normalized.newIntervals.hard,
      modelMediumDays: normalized.newIntervals.medium,
      modelGoodDays: normalized.newIntervals.good,
      modelEasyDays: normalized.newIntervals.easy,
      modelHardMultiplier: normalized.multipliers.hard,
      modelMediumMultiplier: normalized.multipliers.medium,
      modelGoodMultiplier: normalized.multipliers.good,
      modelEasyMultiplier: normalized.multipliers.easy,
      modelMaxDays: normalized.maxIntervalDays
    };
    Object.entries(values).forEach(([id, value]) => { if ($(`#${id}`)) $(`#${id}`).value = value; });
  }

  function createModelFromFolder() {
    const settings = readFolderFormSettings() || SYSTEM_SETTINGS;
    $("#createReviewModelFromSettings")?.click();
    setTimeout(() => fillReviewModelModalFromSettings(settings), 0);
  }

  function patchDatabaseSemantics() {
    if (!window.OituDB || OituDB.__reviewModelFollowGlobalFixed) return;
    OituDB.__reviewModelFollowGlobalFixed = true;
    const previousUpdateDeck = OituDB.updateDeck.bind(OituDB);
    const previousUpdateFolder = OituDB.updateFolder.bind(OituDB);

    OituDB.updateDeck = async function (id, patch) {
      let nextPatch = patch;
      if (patch?.reviewSettings && !Object.prototype.hasOwnProperty.call(patch, "reviewModelMode")) {
        let selection = pendingDeckSelection.get(id) || null;
        if (folderApplyContext && Date.now() < folderApplyContext.expiresAt && !$("#folderReviewModal")?.classList.contains("hidden") && settingsEqual(patch.reviewSettings, folderApplyContext.settings)) {
          selection = folderApplyContext.selection;
        }
        nextPatch = { ...patch, ...metadataForSelection(selection, patch.reviewSettings) };
      }
      try {
        return await previousUpdateDeck(id, nextPatch);
      } finally {
        if (patch?.reviewSettings && pendingDeckSelection.has(id)) pendingDeckSelection.delete(id);
      }
    };

    OituDB.updateFolder = async function (id, patch) {
      let nextPatch = patch;
      if (patch?.reviewSettings && !Object.prototype.hasOwnProperty.call(patch, "reviewModelMode")) {
        const selection = folderApplyContext && Date.now() < folderApplyContext.expiresAt && !$("#folderReviewModal")?.classList.contains("hidden") && settingsEqual(patch.reviewSettings, folderApplyContext.settings)
          ? folderApplyContext.selection
          : null;
        nextPatch = { ...patch, ...metadataForSelection(selection, patch.reviewSettings) };
      }
      return previousUpdateFolder(id, nextPatch);
    };
  }

  async function updateGlobalFollowerFolders() {
    const value = currentGlobalValue();
    const settings = settingsForValue(value);
    const folders = await OituDB.getFolders();
    const followers = folders.filter((folder) => folder.reviewModelMode === "global");
    await Promise.all(followers.map((folder) => OituDB.updateFolder(folder.id, {
      reviewSettings: cloneSettings(settings),
      reviewModelMode: "global",
      reviewModelId: value
    })));
  }

  function decorateAll() {
    ensureStyle();
    decorateGlobalSelect();
    decorateReviewSettingsSelect();
    ensureFolderReviewUI();
  }

  function watchSelectors() {
    const globalSelect = $("#globalReviewModelSelect");
    if (globalSelect && globalSelect.dataset.refinementObserved !== "true") {
      globalSelect.dataset.refinementObserved = "true";
      globalSelectObserver?.disconnect();
      globalSelectObserver = new MutationObserver(() => decorateGlobalSelect());
      globalSelectObserver.observe(globalSelect, { childList: true });
    }

    const reviewSelect = $("#reviewSettingsModelSelect");
    if (reviewSelect && reviewSelect.dataset.refinementObserved !== "true") {
      reviewSelect.dataset.refinementObserved = "true";
      reviewSelectObserver?.disconnect();
      reviewSelectObserver = new MutationObserver(() => decorateReviewSettingsSelect());
      reviewSelectObserver.observe(reviewSelect, { childList: true });
    }

    const folderModal = $("#folderReviewModal");
    if (folderModal && folderModal.dataset.reviewModelObserved !== "true") {
      folderModal.dataset.reviewModelObserved = "true";
      folderModalObserver?.disconnect();
      folderModalObserver = new MutationObserver(() => {
        if (!folderModal.classList.contains("hidden")) setTimeout(syncFolderModelSelect, 0);
        else folderApplyContext = null;
      });
      folderModalObserver.observe(folderModal, { attributes: true, attributeFilter: ["class"] });
    }
  }

  document.addEventListener("change", (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;

    if (select.id === "globalReviewModelSelect") {
      if (select.value === CREATE_VALUE) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const previous = currentGlobalValue();
        select.value = [...select.options].some((option) => option.value === previous) ? previous : "system";
        $("#createReviewModelFromSettings")?.click();
        setTimeout(decorateAll, 0);
        return;
      }
      setTimeout(() => updateGlobalFollowerFolders().catch((error) => console.error("OituCards: não foi possível atualizar as pastas que seguem o modelo padrão.", error)), 0);
      return;
    }

    if (select.id === "folderReviewModelSelect") {
      if (select.value === CREATE_VALUE) {
        const previous = select.dataset.lastValue || "system";
        select.value = [...select.options].some((option) => option.value === previous) ? previous : "system";
        createModelFromFolder();
        return;
      }
      select.dataset.lastValue = select.value;
      if (select.value !== CUSTOM_VALUE) fillFolderForm(settingsForValue(select.value));
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (fillingFolderForm) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.id.startsWith("folderRev")) return;
    const select = $("#folderReviewModelSelect");
    if (!select) return;
    if (![...select.options].some((option) => option.value === CUSTOM_VALUE)) {
      select.insertBefore(new Option("Ajuste manual", CUSTOM_VALUE), select.options[select.options.length - 1]);
    }
    select.value = CUSTOM_VALUE;
    select.dataset.lastValue = CUSTOM_VALUE;
  }, true);

  document.addEventListener("submit", (event) => {
    if (event.target?.id === "folderReviewForm") {
      const settings = readFolderFormSettings();
      if (!settings) return;
      const select = $("#folderReviewModelSelect");
      let selection = select?.value || CUSTOM_VALUE;
      if (selection === CREATE_VALUE) selection = CUSTOM_VALUE;
      if (selection !== CUSTOM_VALUE && !settingsEqual(settings, settingsForValue(selection))) selection = CUSTOM_VALUE;
      folderApplyContext = { selection, settings: cloneSettings(settings), expiresAt: Date.now() + 15000 };
      setTimeout(() => {
        if (folderApplyContext && Date.now() >= folderApplyContext.expiresAt) folderApplyContext = null;
      }, 15100);
      return;
    }
    if (event.target?.id === "reviewModelForm") {
      setTimeout(() => {
        decorateAll();
        if (!$("#folderReviewModal")?.classList.contains("hidden")) populateFolderModelSelect($("#folderReviewModelSelect")?.value || null);
      }, 80);
    }
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const deckRow = target.closest("[data-deck-id]");
    if (deckRow && target.closest(".deck-name-button,[data-action=\"edit-deck\"]")) currentDeckId = deckRow.dataset.deckId || currentDeckId;

    const folderEdit = target.closest("[data-edit-folder]");
    if (folderEdit) currentFolderId = folderEdit.dataset.editFolder || folderEdit.closest("[data-folder-id]")?.dataset.folderId || currentFolderId;

    if (target.closest("#reviewSettingsButton")) {
      if (currentDeckId) pendingDeckSelection.delete(currentDeckId);
      setTimeout(() => {
        decorateAll();
        watchSelectors();
      }, 0);
    }

    if (target.closest("#loadReviewModelButton")) {
      if (currentDeckId) pendingDeckSelection.set(currentDeckId, $("#reviewSettingsModelSelect")?.value || CUSTOM_VALUE);
    }

    if (target.closest("#restoreReviewDefaultsButton")) {
      if (currentDeckId) pendingDeckSelection.set(currentDeckId, "system");
    }

    if (target.closest("#cancelReviewSettingsButton,#reviewSettingsBackButton")) {
      if (currentDeckId) pendingDeckSelection.delete(currentDeckId);
    }

    if (target.closest("#folderReviewSettingsButton")) {
      setTimeout(() => {
        decorateAll();
        watchSelectors();
        syncFolderModelSelect();
      }, 80);
    }

    if (target.closest("#themeToggle,#saveReviewModelButton,#loadReviewModelButton")) {
      setTimeout(() => {
        decorateAll();
        watchSelectors();
      }, 0);
    }
  }, true);

  function init() {
    patchDatabaseSemantics();
    decorateAll();
    watchSelectors();
    setTimeout(() => {
      patchDatabaseSemantics();
      decorateAll();
      watchSelectors();
    }, 0);
  }

  patchDatabaseSemantics();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
