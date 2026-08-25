(function () {
  if (window.__oitucardsReviewPresets) return;
  window.__oitucardsReviewPresets = true;

  const STORAGE_KEY = "OituCardsReviewPresetsV1";
  const SYSTEM_SETTINGS = Object.freeze({
    newIntervals: Object.freeze({ hard: 1, medium: 2, good: 4, easy: 7 }),
    multipliers: Object.freeze({ hard: 1.2, medium: 1.8, good: 2.5, easy: 4 }),
    maxIntervalDays: 180
  });
  const RATINGS = ["hard", "medium", "good", "easy"];
  const MAX_DAYS = 3650;
  const MAX_MULTIPLIER = 10;

  let currentDeckId = null;
  let editorDeckId = null;
  let reSubmittingStudy = false;
  let modalResolve = null;

  const $ = (selector, root = document) => root.querySelector(selector);

  function cloneSettings(settings) {
    return {
      newIntervals: { ...settings.newIntervals },
      multipliers: { ...settings.multipliers },
      maxIntervalDays: settings.maxIntervalDays
    };
  }

  function normalizeSettings(raw) {
    const source = raw || {};
    const intervals = source.newIntervals || source || {};
    const multipliers = source.multipliers || {};
    const max = Number.parseInt(source.maxIntervalDays, 10);
    const maxIntervalDays = Number.isInteger(max) && max >= 1 && max <= MAX_DAYS
      ? max
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
        ? Math.min(MAX_MULTIPLIER, Math.round(multiplier * 100) / 100)
        : SYSTEM_SETTINGS.multipliers[rating];
    });

    return { newIntervals, multipliers: normalizedMultipliers, maxIntervalDays };
  }

  function settingsEqual(a, b) {
    const left = normalizeSettings(a);
    const right = normalizeSettings(b);
    if (left.maxIntervalDays !== right.maxIntervalDays) return false;
    return RATINGS.every((rating) =>
      left.newIntervals[rating] === right.newIntervals[rating] &&
      left.multipliers[rating] === right.multipliers[rating]
    );
  }

  function readPresets() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
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

  function writePresets(presets) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
      return true;
    } catch (error) {
      console.error("OituCards: não foi possível salvar os padrões de revisão.", error);
      return false;
    }
  }

  function presetByValue(value) {
    if (!value?.startsWith("preset:")) return null;
    const id = value.slice(7);
    return readPresets().find((preset) => preset.id === id) || null;
  }

  function settingsForSelection(value, deckSettings) {
    if (value === "system") return cloneSettings(SYSTEM_SETTINGS);
    const preset = presetByValue(value);
    if (preset) return cloneSettings(preset.settings);
    return normalizeSettings(deckSettings);
  }

  function formatSettings(settings) {
    const s = normalizeSettings(settings);
    return `Novos: ${s.newIntervals.hard}/${s.newIntervals.medium}/${s.newIntervals.good}/${s.newIntervals.easy} dias · ` +
      `Multiplicadores: ${s.multipliers.hard}/${s.multipliers.medium}/${s.multipliers.good}/${s.multipliers.easy}× · ` +
      `Máx.: ${s.maxIntervalDays} dias`;
  }

  function ensureStyles() {
    if ($('link[data-oitucards-review-presets-css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/review-presets.css?v=20260825-1526";
    link.dataset.oitucardsReviewPresetsCss = "true";
    document.head.appendChild(link);
  }

  function studyPresetMarkup() {
    return `
      <div id="studyReviewPresetSetting" class="study-setting review-preset-setting">
        <div>
          <label class="study-setting-title" for="studyReviewPresetSelect">Padrão de revisão</label>
          <span class="study-setting-help">Escolha a regra que calculará os próximos intervalos deste baralho.</span>
        </div>
        <div class="review-preset-control">
          <select id="studyReviewPresetSelect" class="text-input review-preset-select"></select>
          <p id="studyReviewPresetPreview" class="review-preset-preview"></p>
          <p class="review-preset-transition-note">Trocar o padrão não altera datas já agendadas. A nova regra passa a valer quando cada card for respondido novamente.</p>
        </div>
      </div>`;
  }

  function modalMarkup() {
    return `
      <div id="reviewPresetModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="reviewPresetModalTitle">
        <div class="modal small-modal review-preset-modal">
          <div class="modal-header">
            <div>
              <p class="eyebrow">Revisão espaçada</p>
              <h2 id="reviewPresetModalTitle">Salvar padrão</h2>
            </div>
            <button id="reviewPresetModalClose" class="icon-button modal-close" type="button" aria-label="Fechar">×</button>
          </div>
          <form id="reviewPresetNameForm">
            <label class="field-label" for="reviewPresetNameInput">Nome do padrão</label>
            <input id="reviewPresetNameInput" class="text-input" type="text" maxlength="80" autocomplete="off" placeholder="Ex.: Revisão intensiva" required />
            <p class="field-hint">O padrão salvará uma cópia dos intervalos e multiplicadores que estão preenchidos agora.</p>
            <p id="reviewPresetModalStatus" class="review-settings-status" aria-live="polite"></p>
            <div class="modal-actions">
              <button id="reviewPresetModalCancel" class="button ghost" type="button">Cancelar</button>
              <button class="button primary" type="submit">Salvar padrão</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  function ensureUI() {
    ensureStyles();

    const normalFilters = $("#studyNormalFilterSetting");
    if (normalFilters && !$("#studyReviewPresetSetting")) {
      normalFilters.insertAdjacentHTML("afterend", studyPresetMarkup());
    }

    const heading = $("#reviewSettingsView .review-settings-heading");
    const restore = $("#restoreReviewDefaultsButton");
    if (heading && restore && !$("#saveReviewPresetButton")) {
      let actions = $(".review-preset-heading-actions", heading);
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "review-preset-heading-actions";
        restore.before(actions);
        actions.appendChild(restore);
      }
      const save = document.createElement("button");
      save.id = "saveReviewPresetButton";
      save.className = "button secondary";
      save.type = "button";
      save.textContent = "Salvar padrão";
      actions.prepend(save);
    }

    if (!$("#reviewPresetModal")) document.body.insertAdjacentHTML("beforeend", modalMarkup());
    refreshPresetOptions();
  }

  function refreshPresetOptions() {
    const select = $("#studyReviewPresetSelect");
    if (!select) return;
    const previous = select.value;
    const presets = readPresets();
    select.innerHTML = "";

    const current = new Option("Ajuste atual do baralho", "deck");
    const system = new Option("Padrão do sistema — 1 / 2 / 4 / 7 dias", "system");
    select.add(current);
    select.add(system);

    if (presets.length) {
      const group = document.createElement("optgroup");
      group.label = "Meus padrões";
      presets.forEach((preset) => group.appendChild(new Option(preset.name, `preset:${preset.id}`)));
      select.appendChild(group);
    }

    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  async function refreshStudyPresetSelection(deckId = currentDeckId) {
    ensureUI();
    const select = $("#studyReviewPresetSelect");
    if (!select || !deckId) return;
    const deck = await OituDB.getDeck(deckId);
    if (!deck) return;

    const settings = normalizeSettings(deck.reviewSettings);
    refreshPresetOptions();
    let value = "deck";
    if (settingsEqual(settings, SYSTEM_SETTINGS)) value = "system";
    else {
      const match = readPresets().find((preset) => settingsEqual(settings, preset.settings));
      if (match) value = `preset:${match.id}`;
    }
    select.value = value;
    updateStudyPresetPreview(deck);
  }

  async function updateStudyPresetPreview(deck = null) {
    const select = $("#studyReviewPresetSelect");
    const preview = $("#studyReviewPresetPreview");
    if (!select || !preview) return;
    const currentDeck = deck || (currentDeckId ? await OituDB.getDeck(currentDeckId) : null);
    const selected = select.value;
    const settings = settingsForSelection(selected, currentDeck?.reviewSettings);
    const label = selected === "deck"
      ? "Configuração atual"
      : selected === "system"
        ? "Padrão do sistema"
        : presetByValue(selected)?.name || "Padrão salvo";
    preview.innerHTML = `<strong>${label}:</strong> ${formatSettings(settings)}.`;
  }

  function readReviewSettingsForm() {
    const maxIntervalDays = Number.parseInt($("#reviewMaxDays")?.value, 10);
    const newIntervals = {
      hard: Number.parseInt($("#reviewHardDays")?.value, 10),
      medium: Number.parseInt($("#reviewMediumDays")?.value, 10),
      good: Number.parseInt($("#reviewGoodDays")?.value, 10),
      easy: Number.parseInt($("#reviewEasyDays")?.value, 10)
    };
    const multipliers = {
      hard: Number.parseFloat($("#reviewHardMultiplier")?.value),
      medium: Number.parseFloat($("#reviewMediumMultiplier")?.value),
      good: Number.parseFloat($("#reviewGoodMultiplier")?.value),
      easy: Number.parseFloat($("#reviewEasyMultiplier")?.value)
    };

    if (!Number.isInteger(maxIntervalDays) || maxIntervalDays < 1 || maxIntervalDays > MAX_DAYS) {
      return { error: `O intervalo máximo deve ficar entre 1 e ${MAX_DAYS} dias.` };
    }
    if (Object.values(newIntervals).some((value) => !Number.isInteger(value) || value < 1 || value > maxIntervalDays)) {
      return { error: "Os intervalos iniciais devem ficar entre 1 dia e o limite máximo definido." };
    }
    if (Object.values(multipliers).some((value) => !Number.isFinite(value) || value < 1 || value > MAX_MULTIPLIER)) {
      return { error: `Os multiplicadores devem ficar entre 1,0 e ${MAX_MULTIPLIER}.` };
    }
    return { settings: { newIntervals, multipliers, maxIntervalDays } };
  }

  function openNameModal() {
    const modal = $("#reviewPresetModal");
    const input = $("#reviewPresetNameInput");
    const status = $("#reviewPresetModalStatus");
    if (!modal || !input) return Promise.resolve(null);
    if (status) status.textContent = "";
    input.value = "";
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => input.focus());
    return new Promise((resolve) => { modalResolve = resolve; });
  }

  function closeNameModal(value = null) {
    $("#reviewPresetModal")?.classList.add("hidden");
    document.body.style.overflow = "";
    const resolve = modalResolve;
    modalResolve = null;
    if (resolve) resolve(value);
  }

  async function saveCurrentAsPreset() {
    const result = readReviewSettingsForm();
    const status = $("#reviewSettingsStatus");
    if (result.error) {
      if (status) status.textContent = result.error;
      return;
    }

    const name = await openNameModal();
    if (!name) return;
    const presets = readPresets();
    const existing = presets.find((preset) => preset.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"));
    const now = new Date().toISOString();

    if (existing) {
      if (!window.confirm(`Já existe um padrão chamado “${existing.name}”. Deseja substituí-lo?`)) return;
      existing.name = name;
      existing.settings = cloneSettings(result.settings);
      existing.updatedAt = now;
    } else {
      presets.push({
        id: crypto.randomUUID(),
        name,
        settings: cloneSettings(result.settings),
        createdAt: now,
        updatedAt: now
      });
    }

    if (!writePresets(presets)) {
      if (status) status.textContent = "Não foi possível salvar o padrão neste navegador.";
      return;
    }
    refreshPresetOptions();
    if (status) status.textContent = `Padrão “${name}” salvo. Ele já pode ser usado em outros baralhos.`;
  }

  async function applySelectedPresetBeforeStudy(event) {
    if (reSubmittingStudy || event.target?.id !== "studyConfigForm") return;
    const select = $("#studyReviewPresetSelect");
    if (!select || select.value === "deck" || !currentDeckId) return;

    const deck = await OituDB.getDeck(currentDeckId);
    if (!deck) return;
    const settings = settingsForSelection(select.value, deck.reviewSettings);

    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await OituDB.updateDeck(currentDeckId, { reviewSettings: cloneSettings(settings) });
      reSubmittingStudy = true;
      event.target.requestSubmit();
    } catch (error) {
      console.error(error);
      alert("Não foi possível aplicar o padrão de revisão.");
    } finally {
      reSubmittingStudy = false;
    }
  }

  function captureDeckContext(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const deckName = target.closest(".deck-name-button");
    if (deckName) {
      const id = deckName.closest("[data-deck-id]")?.dataset.deckId;
      if (id) {
        currentDeckId = id;
        setTimeout(() => refreshStudyPresetSelection(id), 30);
      }
    }

    const edit = target.closest('[data-action="edit-deck"]');
    if (edit && !edit.classList.contains("deck-name-button")) {
      const id = edit.closest("[data-deck-id]")?.dataset.deckId;
      if (id) editorDeckId = id;
    }

    if (target.closest("#studyAgainButton") && currentDeckId) {
      setTimeout(() => refreshStudyPresetSelection(currentDeckId), 40);
    }

    if (target.closest("#reviewSettingsButton") && editorDeckId) currentDeckId = editorDeckId;
  }

  function bindEvents() {
    if (document.documentElement.dataset.oitucardsReviewPresetsBound === "true") return;
    document.documentElement.dataset.oitucardsReviewPresetsBound = "true";

    document.addEventListener("click", captureDeckContext, true);
    document.addEventListener("submit", applySelectedPresetBeforeStudy, true);

    document.addEventListener("change", (event) => {
      if (event.target?.id === "studyReviewPresetSelect") updateStudyPresetPreview();
    });

    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest("#saveReviewPresetButton")) {
        event.preventDefault();
        saveCurrentAsPreset();
        return;
      }
      if (target.closest("#reviewPresetModalClose,#reviewPresetModalCancel") || target.id === "reviewPresetModal") {
        event.preventDefault();
        closeNameModal(null);
      }
    });

    document.addEventListener("submit", (event) => {
      if (event.target?.id !== "reviewPresetNameForm") return;
      event.preventDefault();
      const input = $("#reviewPresetNameInput");
      const status = $("#reviewPresetModalStatus");
      const name = String(input?.value || "").trim();
      if (!name) {
        if (status) status.textContent = "Digite um nome para o padrão.";
        input?.focus();
        return;
      }
      closeNameModal(name);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("#reviewPresetModal")?.classList.contains("hidden")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeNameModal(null);
      }
    }, true);
  }

  function wrapStudyApi() {
    const api = window.OituStudy;
    if (!api || typeof api.openConfig !== "function" || api.openConfig.__oitucardsReviewPresetWrapped) return;
    const original = api.openConfig;
    const wrapped = async function (deckId, ...args) {
      currentDeckId = deckId || currentDeckId;
      const result = await original.call(this, deckId, ...args);
      if (currentDeckId) await refreshStudyPresetSelection(currentDeckId);
      return result;
    };
    Object.defineProperty(wrapped, "__oitucardsReviewPresetWrapped", { value: true });
    api.openConfig = wrapped;
  }

  function init() {
    ensureUI();
    bindEvents();
    wrapStudyApi();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
