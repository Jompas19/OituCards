(function () {
  if (window.__oitucardsFolderReviewUnitFixV3) return;
  window.__oitucardsFolderReviewUnitFixV3 = true;

  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
  const MINUTE = "minutes";
  const HOUR = "hours";
  const DAY = "days";
  const RATINGS = ["hard", "medium", "good", "easy"];
  let activeFolderId = null;
  let applying = false;

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

  function unitFor(field) {
    return normalizeUnit($(`select[data-review-time-scope="folder"][data-review-time-field="${field}"]`)?.value);
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

  function readSettings() {
    const profile = {
      hard: unitFor("hard"),
      medium: unitFor("medium"),
      good: unitFor("good"),
      easy: unitFor("easy"),
      max: unitFor("max")
    };

    const ids = {
      hard: "folderRevHardDays",
      medium: "folderRevMediumDays",
      good: "folderRevGoodDays",
      easy: "folderRevEasyDays",
      max: "folderRevMax"
    };

    const values = {};
    for (const field of [...RATINGS, "max"]) {
      values[field] = roundedInput($(`#${ids[field]}`), profile[field]);
      if (!Number.isFinite(values[field])) return { error: "Preencha todos os intervalos com valores válidos." };
    }

    const maxMinutes = toMinutes(values.max, profile.max);
    const exceedsMax = RATINGS.find((rating) => toMinutes(values[rating], profile[rating]) > maxMinutes);
    if (exceedsMax) {
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

    const settings = {
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
    };

    const allUnits = [...RATINGS.map((rating) => profile[rating]), profile.max];
    if (allUnits.every((unit) => unit === allUnits[0])) settings.intervalUnit = allUnits[0];

    return { settings, profile };
  }

  async function restoreFolderForm(folderId) {
    if (!folderId || !window.OituDB) return;
    const modal = $("#folderReviewModal");
    if (!modal || modal.classList.contains("hidden")) return;
    try {
      const folder = await OituDB.getFolder(folderId);
      const settings = folder?.reviewSettings;
      if (!settings) return;

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

      const profile = profileForSettings(settings);
      for (const field of [...RATINGS, "max"]) {
        const select = $(`select[data-review-time-scope="folder"][data-review-time-field="${field}"]`);
        if (select) select.value = profile[field];
      }
    } catch (error) {
      console.warn("OituCards: não foi possível restaurar os valores exatos da revisão da pasta.", error);
    }
  }

  function bindingForFolder() {
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

  function cloneSettings(settings) {
    return {
      ...settings,
      newIntervals: { ...settings.newIntervals },
      multipliers: { ...settings.multipliers },
      intervalUnits: { ...settings.intervalUnits }
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
    const modal = $("#folderReviewModal");
    modal?.classList.add("hidden");
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

    const binding = bindingForFolder();
    const patchFor = () => ({
      reviewSettings: cloneSettings(settings),
      ...binding
    });

    for (const id of folderIds) await OituDB.updateFolder(id, patchFor());
    for (const deck of affectedDecks) await OituDB.updateDeck(deck.id, patchFor());

    return true;
  }

  async function handleFolderSubmit(event) {
    if (event.target?.id !== "folderReviewForm") return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (applying) return;

    const modal = $("#folderReviewModal");
    const folderId = modal?.dataset.folderId || activeFolderId;
    if (!folderId || !window.OituDB) {
      alert("Não foi possível identificar a pasta deste ajuste.");
      return;
    }

    const result = readSettings();
    if (result.error) {
      alert(result.error);
      return;
    }

    applying = true;
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
      applying = false;
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
      setTimeout(() => restoreFolderForm(folderId), 140);
      setTimeout(() => restoreFolderForm(folderId), 320);
    }
  }

  window.addEventListener("submit", handleFolderSubmit, true);
  window.addEventListener("click", captureFolderContext, true);
})();