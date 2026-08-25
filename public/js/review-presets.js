(function () {
  if (window.__oitucardsReviewModels) return;
  window.__oitucardsReviewModels = true;

  const MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  const GLOBAL_MODEL_KEY = "OituCardsGlobalReviewModelV1";
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
  let modelModalSource = "global";
  let nativeAddDeck = null;
  let nativeUpdateDeck = null;

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
    const maxIntervalDays = Number.isInteger(parsedMax) && parsedMax >= 1 && parsedMax <= MAX_DAYS
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

  function writeModels(models) {
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(models));
      return true;
    } catch (error) {
      console.error("OituCards: não foi possível salvar os modelos de revisão.", error);
      return false;
    }
  }

  function normalizeModelValue(value) {
    if (value === "system" || value === "global" || value === "custom") return value;
    if (value?.startsWith("preset:")) return `model:${value.slice(7)}`;
    if (value?.startsWith("model:")) return value;
    return "system";
  }

  function modelByValue(value) {
    const normalized = normalizeModelValue(value);
    if (!normalized.startsWith("model:")) return null;
    const id = normalized.slice(6);
    return readModels().find((model) => model.id === id) || null;
  }

  function globalSelection() {
    const raw = normalizeModelValue(localStorage.getItem(GLOBAL_MODEL_KEY) || "system");
    if (raw.startsWith("model:") && !modelByValue(raw)) return "system";
    return raw === "global" || raw === "custom" ? "system" : raw;
  }

  function settingsForValue(value, fallback = SYSTEM_SETTINGS) {
    const normalized = normalizeModelValue(value);
    if (normalized === "global") return settingsForValue(globalSelection(), fallback);
    if (normalized === "system") return cloneSettings(SYSTEM_SETTINGS);
    const model = modelByValue(normalized);
    if (model) return cloneSettings(model.settings);
    return cloneSettings(fallback);
  }

  function modelLabel(value) {
    const normalized = normalizeModelValue(value);
    if (normalized === "global") return `Configuração geral — ${modelLabel(globalSelection())}`;
    if (normalized === "system") return "Padrão OituCards";
    if (normalized === "custom") return "Ajuste manual deste baralho";
    return modelByValue(normalized)?.name || "Modelo de revisão";
  }

  function modelValueForSettings(settings) {
    if (settingsEqual(settings, SYSTEM_SETTINGS)) return "system";
    const match = readModels().find((model) => settingsEqual(settings, model.settings));
    return match ? `model:${match.id}` : null;
  }

  function formatSettings(settings) {
    const s = normalizeSettings(settings);
    return `Novos: ${s.newIntervals.hard}/${s.newIntervals.medium}/${s.newIntervals.good}/${s.newIntervals.easy} dias · ` +
      `Multiplicadores: ${s.multipliers.hard}/${s.multipliers.medium}/${s.multipliers.good}/${s.multipliers.easy}× · ` +
      `Máx.: ${s.maxIntervalDays} dias`;
  }

  function followsGlobal(deck) {
    if (!deck) return false;
    if (deck.reviewModelMode === "global") return true;
    if (deck.reviewModelMode === "manual") return false;
    if (!deck.reviewSettings) return true;
    return settingsEqual(deck.reviewSettings, SYSTEM_SETTINGS);
  }

  function selectionForDeck(deck) {
    if (!deck) return "global";
    if (deck.reviewModelMode === "global") return "global";
    if (deck.reviewModelMode === "manual") {
      const stored = normalizeModelValue(deck.reviewModelId || "custom");
      if (stored === "system") return "system";
      if (stored.startsWith("model:") && modelByValue(stored)) return stored;
      return modelValueForSettings(deck.reviewSettings) || "custom";
    }
    if (followsGlobal(deck)) return "global";
    return modelValueForSettings(deck.reviewSettings) || "custom";
  }

  function patchDatabase() {
    if (!window.OituDB || OituDB.__reviewModelsPatched) return;
    OituDB.__reviewModelsPatched = true;
    nativeAddDeck = OituDB.addDeck.bind(OituDB);
    nativeUpdateDeck = OituDB.updateDeck.bind(OituDB);

    OituDB.addDeck = async function (...args) {
      const deck = await nativeAddDeck(...args);
      try {
        const value = globalSelection();
        return await nativeUpdateDeck(deck.id, {
          reviewSettings: settingsForValue(value),
          reviewModelMode: "global",
          reviewModelId: value
        });
      } catch (error) {
        console.warn("OituCards: o baralho foi criado, mas a configuração global de revisão não pôde ser aplicada.", error);
        return deck;
      }
    };

    OituDB.updateDeck = async function (id, patch) {
      let nextPatch = patch;
      if (patch?.reviewSettings && !Object.prototype.hasOwnProperty.call(patch, "reviewModelMode")) {
        nextPatch = {
          ...patch,
          reviewModelMode: "manual",
          reviewModelId: modelValueForSettings(patch.reviewSettings)
        };
      }
      return nativeUpdateDeck(id, nextPatch);
    };
  }

  async function applyGlobalSelection(value) {
    const normalized = normalizeModelValue(value);
    const safeValue = normalized.startsWith("model:") && modelByValue(normalized) ? normalized : "system";
    localStorage.setItem(GLOBAL_MODEL_KEY, safeValue);
    const settings = settingsForValue(safeValue);
    const decks = await OituDB.getDecks();
    const followers = decks.filter(followsGlobal);

    await Promise.all(followers.map((deck) => nativeUpdateDeck(deck.id, {
      reviewSettings: cloneSettings(settings),
      reviewModelMode: "global",
      reviewModelId: safeValue
    })));

    refreshAllModelSelectors();
    return followers.length;
  }

  async function applySelectionToDeck(deckId, value, mode = "manual") {
    if (!deckId) return null;
    const normalized = normalizeModelValue(value);
    if (normalized === "custom") return OituDB.getDeck(deckId);
    const effectiveValue = normalized === "global" ? globalSelection() : normalized;
    const settings = settingsForValue(effectiveValue);
    return nativeUpdateDeck(deckId, {
      reviewSettings: cloneSettings(settings),
      reviewModelMode: mode === "global" || normalized === "global" ? "global" : "manual",
      reviewModelId: effectiveValue
    });
  }

  function ensureStyles() {
    if ($('link[data-oitucards-review-presets-css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/review-presets.css?v=20260825-1548";
    link.dataset.oitucardsReviewPresetsCss = "true";
    document.head.appendChild(link);
  }

  function settingsPanelMarkup() {
    return `
      <div id="siteSettingsPanel" class="site-settings-panel" aria-hidden="true">
        <div class="site-settings-header">
          <strong>Configurações</strong>
          <span>Preferências deste navegador</span>
        </div>

        <div class="site-settings-section">
          <span class="site-settings-label">Tema</span>
          <div class="site-theme-options" role="group" aria-label="Tema do site">
            <button type="button" data-site-theme="light">Claro</button>
            <button type="button" data-site-theme="dark">Escuro</button>
          </div>
        </div>

        <div class="site-settings-section site-review-global-section">
          <label class="site-settings-label" for="globalReviewModelSelect">Modelo de revisão geral</label>
          <select id="globalReviewModelSelect" class="text-input"></select>
          <p id="globalReviewModelHelp" class="site-settings-help"></p>
          <button id="createReviewModelFromSettings" class="button secondary compact-settings-button" type="button">+ Criar modelo de revisão</button>
          <p id="globalReviewModelStatus" class="site-settings-status" aria-live="polite"></p>
        </div>
      </div>`;
  }

  function studyModelMarkup() {
    return `
      <div id="studyReviewModelSetting" class="study-setting review-preset-setting">
        <div>
          <label class="study-setting-title" for="studyReviewModelSelect">Modelo de revisão</label>
          <span class="study-setting-help">Escolha a regra de revisão deste baralho. Você também pode mantê-lo acompanhando a configuração geral.</span>
        </div>
        <div class="review-preset-control">
          <select id="studyReviewModelSelect" class="text-input review-preset-select"></select>
          <p id="studyReviewModelPreview" class="review-preset-preview"></p>
          <p class="review-preset-transition-note">A troca não altera revisões que já estão agendadas. A nova regra passa a valer no próximo cálculo de intervalo de cada card.</p>
        </div>
      </div>`;
  }

  function reviewReuseMarkup() {
    return `
      <div id="reviewModelReuseBlock" class="review-model-reuse-block">
        <div>
          <strong>Usar um modelo de revisão</strong>
          <p>Carregue um modelo salvo para aproveitar as mesmas regras neste baralho.</p>
        </div>
        <div class="review-model-reuse-controls">
          <select id="reviewSettingsModelSelect" class="text-input"></select>
          <button id="loadReviewModelButton" class="button secondary" type="button">Carregar modelo</button>
        </div>
      </div>`;
  }

  function saveModelActionMarkup() {
    return `
      <div id="saveReviewModelAction" class="save-review-model-action">
        <button id="saveReviewModelButton" class="button secondary" type="button">Salvar como modelo de revisão</button>
        <span>Salva uma cópia destas regras para usar em outros baralhos.</span>
      </div>`;
  }

  function modelEditorMarkup() {
    return `
      <div id="reviewModelModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="reviewModelModalTitle">
        <div class="modal review-model-modal">
          <div class="modal-header">
            <div>
              <p class="eyebrow">Revisão espaçada</p>
              <h2 id="reviewModelModalTitle">Criar modelo de revisão</h2>
            </div>
            <button id="reviewModelModalClose" class="icon-button modal-close" type="button" aria-label="Fechar">×</button>
          </div>

          <form id="reviewModelForm">
            <label class="field-label" for="reviewModelName">Nome do modelo</label>
            <input id="reviewModelName" class="text-input" type="text" maxlength="80" autocomplete="off" placeholder="Ex.: Revisão intensiva" required />

            <div class="review-model-modal-section">
              <strong>Primeira revisão de um card novo</strong>
              <div class="review-model-fields-grid">
                <label><span>Difícil</span><div><input id="modelHardDays" class="text-input" type="number" min="1" max="3650" step="1" required><small>dias</small></div></label>
                <label><span>Médio</span><div><input id="modelMediumDays" class="text-input" type="number" min="1" max="3650" step="1" required><small>dias</small></div></label>
                <label><span>Bom</span><div><input id="modelGoodDays" class="text-input" type="number" min="1" max="3650" step="1" required><small>dias</small></div></label>
                <label><span>Fácil</span><div><input id="modelEasyDays" class="text-input" type="number" min="1" max="3650" step="1" required><small>dias</small></div></label>
              </div>
            </div>

            <div class="review-model-modal-section">
              <strong>Multiplicadores das revisões seguintes</strong>
              <div class="review-model-fields-grid">
                <label><span>Difícil</span><div><input id="modelHardMultiplier" class="text-input" type="number" min="1" max="10" step="0.1" required><small>×</small></div></label>
                <label><span>Médio</span><div><input id="modelMediumMultiplier" class="text-input" type="number" min="1" max="10" step="0.1" required><small>×</small></div></label>
                <label><span>Bom</span><div><input id="modelGoodMultiplier" class="text-input" type="number" min="1" max="10" step="0.1" required><small>×</small></div></label>
                <label><span>Fácil</span><div><input id="modelEasyMultiplier" class="text-input" type="number" min="1" max="10" step="0.1" required><small>×</small></div></label>
              </div>
            </div>

            <div class="review-model-modal-section review-model-max-row">
              <label><span>Intervalo máximo</span><div><input id="modelMaxDays" class="text-input" type="number" min="1" max="3650" step="1" required><small>dias</small></div></label>
            </div>

            <p id="reviewModelModalStatus" class="review-settings-status" aria-live="polite"></p>
            <div class="modal-actions">
              <button id="reviewModelModalCancel" class="button ghost" type="button">Cancelar</button>
              <button class="button primary" type="submit">Salvar modelo</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  function ensureSettingsPanel() {
    const button = $("#themeToggle");
    if (!button) return;
    button.textContent = "⚙";
    button.title = "Configurações";
    button.setAttribute("aria-label", "Abrir configurações");
    button.setAttribute("aria-expanded", "false");
    button.classList.add("site-settings-trigger");

    if (!button.parentElement?.classList.contains("site-settings-anchor")) {
      const anchor = document.createElement("div");
      anchor.className = "site-settings-anchor";
      button.parentNode.insertBefore(anchor, button);
      anchor.appendChild(button);
      anchor.insertAdjacentHTML("beforeend", settingsPanelMarkup());
    }
    syncThemeControls();
    refreshGlobalModelSelect();
  }

  function ensureStudyUI() {
    const normalFilters = $("#studyNormalFilterSetting");
    if (normalFilters && !$("#studyReviewModelSetting")) normalFilters.insertAdjacentHTML("afterend", studyModelMarkup());
  }

  function ensureReviewSettingsUI() {
    const form = $("#reviewSettingsForm");
    if (!form) return;
    if (!$("#reviewModelReuseBlock")) form.insertAdjacentHTML("afterbegin", reviewReuseMarkup());
    const summary = $("#reviewRuleSummary");
    if (summary && !$("#saveReviewModelAction")) summary.insertAdjacentHTML("afterend", saveModelActionMarkup());
  }

  function ensureModelModal() {
    if (!$("#reviewModelModal")) document.body.insertAdjacentHTML("beforeend", modelEditorMarkup());
  }

  function ensureUI() {
    ensureStyles();
    ensureSettingsPanel();
    ensureStudyUI();
    ensureReviewSettingsUI();
    ensureModelModal();
    refreshAllModelSelectors();
  }

  function addModelOptions(select, { includeGlobal = false, includeCustom = false } = {}) {
    if (!select) return;
    select.innerHTML = "";
    if (includeGlobal) select.add(new Option(`Configuração geral — ${modelLabel(globalSelection())}`, "global"));
    select.add(new Option("Padrão OituCards — 1 / 2 / 4 / 7 dias", "system"));
    if (includeCustom) select.add(new Option("Ajuste manual deste baralho", "custom"));
    const models = readModels();
    if (models.length) {
      const group = document.createElement("optgroup");
      group.label = "Meus modelos";
      models.forEach((model) => group.appendChild(new Option(model.name, `model:${model.id}`)));
      select.appendChild(group);
    }
  }

  function refreshGlobalModelSelect() {
    const select = $("#globalReviewModelSelect");
    if (!select) return;
    addModelOptions(select);
    select.value = globalSelection();
    const help = $("#globalReviewModelHelp");
    if (help) help.textContent = `${modelLabel(globalSelection())}. Novos baralhos e os baralhos que seguem a configuração geral usarão este modelo.`;
  }

  function refreshReviewSettingsModelSelect() {
    const select = $("#reviewSettingsModelSelect");
    if (!select) return;
    addModelOptions(select, { includeGlobal: true });
    select.value = "global";
  }

  async function refreshStudyModelSelection(deckId = currentDeckId) {
    ensureStudyUI();
    const select = $("#studyReviewModelSelect");
    if (!select || !deckId) return;
    const deck = await OituDB.getDeck(deckId);
    if (!deck) return;
    const selection = selectionForDeck(deck);
    addModelOptions(select, { includeGlobal: true, includeCustom: selection === "custom" });
    select.value = [...select.options].some((option) => option.value === selection) ? selection : "custom";
    updateStudyModelPreview(deck);
  }

  function refreshAllModelSelectors() {
    refreshGlobalModelSelect();
    refreshReviewSettingsModelSelect();
    if (currentDeckId && $("#studyConfigView")?.classList.contains("active")) refreshStudyModelSelection(currentDeckId);
  }

  async function updateStudyModelPreview(deck = null) {
    const select = $("#studyReviewModelSelect");
    const preview = $("#studyReviewModelPreview");
    if (!select || !preview) return;
    const currentDeck = deck || (currentDeckId ? await OituDB.getDeck(currentDeckId) : null);
    const value = normalizeModelValue(select.value);
    const settings = value === "custom"
      ? normalizeSettings(currentDeck?.reviewSettings)
      : settingsForValue(value, currentDeck?.reviewSettings || SYSTEM_SETTINGS);
    preview.innerHTML = `<strong>${modelLabel(value)}:</strong> ${formatSettings(settings)}.`;
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("oitucards-theme", theme);
    syncThemeControls();
  }

  function syncThemeControls() {
    const current = document.documentElement.dataset.theme || localStorage.getItem("oitucards-theme") || "light";
    document.querySelectorAll("[data-site-theme]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.siteTheme === current);
      button.setAttribute("aria-pressed", String(button.dataset.siteTheme === current));
    });
  }

  function setSettingsPanel(open) {
    const panel = $("#siteSettingsPanel");
    const trigger = $("#themeToggle");
    if (!panel || !trigger) return;
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    trigger.setAttribute("aria-expanded", String(open));
  }

  function readMainReviewForm() {
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
    return validateSettings({ newIntervals, multipliers, maxIntervalDays });
  }

  function validateSettings(settings) {
    const maxIntervalDays = Number.parseInt(settings?.maxIntervalDays, 10);
    const newIntervals = settings?.newIntervals || {};
    const multipliers = settings?.multipliers || {};
    if (!Number.isInteger(maxIntervalDays) || maxIntervalDays < 1 || maxIntervalDays > MAX_DAYS) {
      return { error: `O intervalo máximo deve ficar entre 1 e ${MAX_DAYS} dias.` };
    }
    if (RATINGS.some((rating) => !Number.isInteger(Number(newIntervals[rating])) || Number(newIntervals[rating]) < 1 || Number(newIntervals[rating]) > maxIntervalDays)) {
      return { error: "Os intervalos iniciais devem ficar entre 1 dia e o limite máximo definido." };
    }
    if (RATINGS.some((rating) => !Number.isFinite(Number(multipliers[rating])) || Number(multipliers[rating]) < 1 || Number(multipliers[rating]) > MAX_MULTIPLIER)) {
      return { error: `Os multiplicadores devem ficar entre 1,0 e ${MAX_MULTIPLIER}.` };
    }
    return { settings: normalizeSettings(settings) };
  }

  function fillMainReviewForm(settings) {
    const s = normalizeSettings(settings);
    const values = {
      reviewHardDays: s.newIntervals.hard,
      reviewMediumDays: s.newIntervals.medium,
      reviewGoodDays: s.newIntervals.good,
      reviewEasyDays: s.newIntervals.easy,
      reviewHardMultiplier: s.multipliers.hard,
      reviewMediumMultiplier: s.multipliers.medium,
      reviewGoodMultiplier: s.multipliers.good,
      reviewEasyMultiplier: s.multipliers.easy,
      reviewMaxDays: s.maxIntervalDays
    };
    Object.entries(values).forEach(([id, value]) => {
      const input = $(`#${id}`);
      if (!input) return;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function fillModelModal(settings) {
    const s = normalizeSettings(settings);
    const values = {
      modelHardDays: s.newIntervals.hard,
      modelMediumDays: s.newIntervals.medium,
      modelGoodDays: s.newIntervals.good,
      modelEasyDays: s.newIntervals.easy,
      modelHardMultiplier: s.multipliers.hard,
      modelMediumMultiplier: s.multipliers.medium,
      modelGoodMultiplier: s.multipliers.good,
      modelEasyMultiplier: s.multipliers.easy,
      modelMaxDays: s.maxIntervalDays
    };
    Object.entries(values).forEach(([id, value]) => { if ($(`#${id}`)) $(`#${id}`).value = value; });
  }

  function readModelModal() {
    return validateSettings({
      newIntervals: {
        hard: Number.parseInt($("#modelHardDays")?.value, 10),
        medium: Number.parseInt($("#modelMediumDays")?.value, 10),
        good: Number.parseInt($("#modelGoodDays")?.value, 10),
        easy: Number.parseInt($("#modelEasyDays")?.value, 10)
      },
      multipliers: {
        hard: Number.parseFloat($("#modelHardMultiplier")?.value),
        medium: Number.parseFloat($("#modelMediumMultiplier")?.value),
        good: Number.parseFloat($("#modelGoodMultiplier")?.value),
        easy: Number.parseFloat($("#modelEasyMultiplier")?.value)
      },
      maxIntervalDays: Number.parseInt($("#modelMaxDays")?.value, 10)
    });
  }

  function openModelModal(settings, source = "global") {
    ensureModelModal();
    modelModalSource = source;
    $("#reviewModelName").value = "";
    $("#reviewModelModalStatus").textContent = "";
    fillModelModal(settings || SYSTEM_SETTINGS);
    $("#reviewModelModal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => $("#reviewModelName")?.focus());
  }

  function closeModelModal() {
    $("#reviewModelModal")?.classList.add("hidden");
    $("#reviewModelModalStatus").textContent = "";
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
  }

  async function saveModelFromModal(event) {
    event.preventDefault();
    const name = String($("#reviewModelName")?.value || "").trim();
    const status = $("#reviewModelModalStatus");
    if (!name) {
      if (status) status.textContent = "Digite um nome para o modelo.";
      $("#reviewModelName")?.focus();
      return;
    }
    const result = readModelModal();
    if (result.error) {
      if (status) status.textContent = result.error;
      return;
    }

    const models = readModels();
    const existing = models.find((model) => model.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"));
    const now = new Date().toISOString();
    let savedId;

    if (existing) {
      if (!window.confirm(`Já existe um modelo chamado “${existing.name}”. Deseja substituí-lo?`)) return;
      existing.name = name;
      existing.settings = cloneSettings(result.settings);
      existing.updatedAt = now;
      savedId = existing.id;
    } else {
      savedId = crypto.randomUUID();
      models.push({ id: savedId, name, settings: cloneSettings(result.settings), createdAt: now, updatedAt: now });
    }

    if (!writeModels(models)) {
      if (status) status.textContent = "Não foi possível salvar o modelo neste navegador.";
      return;
    }

    const savedValue = `model:${savedId}`;
    const wasGlobal = globalSelection() === savedValue;
    closeModelModal();
    refreshAllModelSelectors();

    if (wasGlobal) await applyGlobalSelection(savedValue);

    if (modelModalSource === "review") {
      const pageStatus = $("#reviewSettingsStatus");
      if (pageStatus) pageStatus.textContent = `Modelo “${name}” salvo. Ele já está disponível para outros baralhos.`;
    } else {
      const globalStatus = $("#globalReviewModelStatus");
      if (globalStatus) globalStatus.textContent = `Modelo “${name}” salvo.`;
    }
  }

  async function loadModelIntoReviewForm() {
    const select = $("#reviewSettingsModelSelect");
    const status = $("#reviewSettingsStatus");
    if (!select) return;
    const settings = settingsForValue(select.value);
    fillMainReviewForm(settings);
    if (status) status.textContent = `${modelLabel(select.value)} carregado. Clique em “Salvar ajustes” para aplicar ao baralho.`;
  }

  async function applyStudySelectionBeforeSubmit(event) {
    if (reSubmittingStudy || event.target?.id !== "studyConfigForm") return;
    const select = $("#studyReviewModelSelect");
    if (!select || !currentDeckId) return;
    const value = normalizeModelValue(select.value);
    if (value === "custom") return;

    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await applySelectionToDeck(currentDeckId, value, value === "global" ? "global" : "manual");
      reSubmittingStudy = true;
      event.target.requestSubmit();
    } catch (error) {
      console.error(error);
      alert("Não foi possível aplicar o modelo de revisão.");
    } finally {
      reSubmittingStudy = false;
    }
  }

  function captureDeckContext(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const deckName = target.closest(".deck-name-button");
    const row = deckName?.closest("[data-deck-id]");
    if (row?.dataset.deckId) {
      currentDeckId = row.dataset.deckId;
      setTimeout(() => refreshStudyModelSelection(currentDeckId), 30);
    }

    const edit = target.closest('[data-action="edit-deck"]');
    if (edit && !edit.classList.contains("deck-name-button")) {
      const id = edit.closest("[data-deck-id]")?.dataset.deckId;
      if (id) editorDeckId = id;
    }

    if (target.closest("#reviewSettingsButton") && editorDeckId) currentDeckId = editorDeckId;
    if (target.closest("#studyAgainButton") && currentDeckId) setTimeout(() => refreshStudyModelSelection(currentDeckId), 40);
  }

  function bindEvents() {
    if (document.documentElement.dataset.oitucardsReviewModelsBound === "true") return;
    document.documentElement.dataset.oitucardsReviewModelsBound = "true";

    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      if (target.closest("#themeToggle")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const panel = $("#siteSettingsPanel");
        setSettingsPanel(!panel?.classList.contains("is-open"));
        return;
      }
    }, true);

    document.addEventListener("click", captureDeckContext, true);
    document.addEventListener("submit", applyStudySelectionBeforeSubmit, true);

    document.addEventListener("click", async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const theme = target.closest("[data-site-theme]");
      if (theme) {
        event.preventDefault();
        applyTheme(theme.dataset.siteTheme);
        return;
      }

      if (target.closest("#createReviewModelFromSettings")) {
        event.preventDefault();
        openModelModal(settingsForValue(globalSelection()), "global");
        return;
      }

      if (target.closest("#saveReviewModelButton")) {
        event.preventDefault();
        const result = readMainReviewForm();
        if (result.error) {
          if ($("#reviewSettingsStatus")) $("#reviewSettingsStatus").textContent = result.error;
          return;
        }
        openModelModal(result.settings, "review");
        return;
      }

      if (target.closest("#loadReviewModelButton")) {
        event.preventDefault();
        await loadModelIntoReviewForm();
        return;
      }

      if (target.closest("#reviewModelModalClose,#reviewModelModalCancel") || target.id === "reviewModelModal") {
        event.preventDefault();
        closeModelModal();
        return;
      }

      const anchor = target.closest(".site-settings-anchor");
      if (!anchor && $("#siteSettingsPanel")?.classList.contains("is-open")) setSettingsPanel(false);
    });

    document.addEventListener("change", async (event) => {
      if (event.target?.id === "studyReviewModelSelect") {
        updateStudyModelPreview();
        return;
      }
      if (event.target?.id === "globalReviewModelSelect") {
        const select = event.target;
        const status = $("#globalReviewModelStatus");
        select.disabled = true;
        if (status) status.textContent = "Aplicando configuração…";
        try {
          const changed = await applyGlobalSelection(select.value);
          if (status) status.textContent = changed
            ? `${changed} ${changed === 1 ? "baralho atualizado" : "baralhos atualizados"}. Os personalizados foram mantidos.`
            : "Configuração geral atualizada.";
        } catch (error) {
          console.error(error);
          if (status) status.textContent = "Não foi possível aplicar a configuração geral.";
        } finally {
          select.disabled = false;
          refreshGlobalModelSelect();
        }
      }
    });

    document.addEventListener("submit", (event) => {
      if (event.target?.id === "reviewModelForm") saveModelFromModal(event);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!$("#reviewModelModal")?.classList.contains("hidden")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeModelModal();
        return;
      }
      if ($("#siteSettingsPanel")?.classList.contains("is-open")) {
        event.preventDefault();
        setSettingsPanel(false);
      }
    }, true);
  }

  function wrapStudyApi() {
    const api = window.OituStudy;
    if (!api || typeof api.openConfig !== "function" || api.openConfig.__oitucardsReviewModelsWrapped) return;
    const original = api.openConfig;
    const wrapped = async function (deckId, ...args) {
      currentDeckId = deckId || currentDeckId;
      const result = await original.call(this, deckId, ...args);
      if (currentDeckId) await refreshStudyModelSelection(currentDeckId);
      return result;
    };
    Object.defineProperty(wrapped, "__oitucardsReviewModelsWrapped", { value: true });
    api.openConfig = wrapped;
  }

  function init() {
    patchDatabase();
    ensureUI();
    bindEvents();
    wrapStudyApi();
    setTimeout(() => {
      ensureUI();
      syncThemeControls();
    }, 0);
  }

  patchDatabase();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
