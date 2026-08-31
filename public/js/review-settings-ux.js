(function () {
  if (window.__oitucardsReviewSettingsUx) return;
  window.__oitucardsReviewSettingsUx = true;

  const MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  let reviewDirty = false;
  let bypassNextReviewExit = false;
  let pendingExitButton = null;
  let modelCreationSource = null;
  let reviewViewWasActive = false;

  const $ = (selector, root = document) => root.querySelector(selector);

  function reviewViewActive() {
    return $("#reviewSettingsView")?.classList.contains("active") === true;
  }

  function ensureStyles() {
    if ($("#reviewSettingsUxStyle")) return;
    const style = document.createElement("style");
    style.id = "reviewSettingsUxStyle";
    style.textContent = `
      #loadReviewModelButton{display:none!important}
      #reviewModelReuseBlock .review-model-reuse-controls{display:block}
      #reviewModelReuseBlock .review-model-reuse-controls select{width:100%}
      #folderReviewModelBlock{transition:opacity .12s ease}
      #folderReviewModelBlock.ux-syncing{opacity:0}
      .review-unsaved-modal{width:min(430px,calc(100vw - 28px))}
      .review-unsaved-copy{margin:0;color:var(--muted);line-height:1.5}
      .review-unsaved-actions{display:flex;gap:9px;justify-content:flex-end;flex-wrap:wrap}
      @media(max-width:560px){.review-unsaved-actions{display:grid}.review-unsaved-actions .button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensureUnsavedModal() {
    if ($("#reviewUnsavedModal")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <div id="reviewUnsavedModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="reviewUnsavedTitle">
        <div class="modal review-unsaved-modal">
          <div class="modal-header">
            <div>
              <p class="eyebrow">Ajustes de revisão</p>
              <h2 id="reviewUnsavedTitle">Há alterações que não foram salvas</h2>
            </div>
            <button id="reviewUnsavedContinue" class="icon-button modal-close" type="button" aria-label="Continuar editando">×</button>
          </div>
          <p class="review-unsaved-copy">Você pode salvar as alterações antes de voltar ou sair sem salvar.</p>
          <div class="modal-actions review-unsaved-actions">
            <button id="reviewUnsavedDiscard" class="button ghost" type="button">Sair sem salvar</button>
            <button id="reviewUnsavedSave" class="button primary" type="button">Salvar ajustes</button>
          </div>
        </div>
      </div>`);
  }

  function decorateReviewReuse() {
    const block = $("#reviewModelReuseBlock");
    if (!block) return;
    const copy = block.querySelector("p");
    if (copy) copy.textContent = "Selecione um modelo e as regras serão carregadas automaticamente.";
    const button = $("#loadReviewModelButton");
    if (button) {
      button.tabIndex = -1;
      button.setAttribute("aria-hidden", "true");
    }
  }

  function openUnsavedModal(exitButton) {
    ensureUnsavedModal();
    pendingExitButton = exitButton || null;
    $("#reviewUnsavedModal")?.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => $("#reviewUnsavedSave")?.focus());
  }

  function closeUnsavedModal() {
    $("#reviewUnsavedModal")?.classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
  }

  function readModels() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.name) : [];
    } catch (_) {
      return [];
    }
  }

  function setSettingsPanelOpen(open) {
    const panel = $("#siteSettingsPanel");
    const trigger = $("#themeToggle");
    if (!panel || !trigger) return;
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    trigger.setAttribute("aria-expanded", String(open));
  }

  function keepSettingsPanelOpen() {
    setSettingsPanelOpen(true);
    setTimeout(() => setSettingsPanelOpen(true), 80);
    setTimeout(() => setSettingsPanelOpen(true), 220);
  }

  function selectNewGlobalModel(name, attempt = 0) {
    if (modelCreationSource !== "global") return;
    const modal = $("#reviewModelModal");
    if (modal && !modal.classList.contains("hidden")) {
      if (attempt < 8) setTimeout(() => selectNewGlobalModel(name, attempt + 1), 60);
      return;
    }

    const normalizedName = String(name || "").trim().toLocaleLowerCase("pt-BR");
    const model = readModels().find((item) => String(item.name || "").trim().toLocaleLowerCase("pt-BR") === normalizedName);
    if (!model) {
      modelCreationSource = null;
      keepSettingsPanelOpen();
      return;
    }

    const value = `model:${model.id}`;
    const select = $("#globalReviewModelSelect");
    if (!select) {
      if (attempt < 8) setTimeout(() => selectNewGlobalModel(name, attempt + 1), 60);
      return;
    }

    if (![...select.options].some((option) => option.value === value)) {
      select.add(new Option(model.name, value));
    }
    select.value = value;
    keepSettingsPanelOpen();
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(() => {
      keepSettingsPanelOpen();
      const refreshed = $("#globalReviewModelSelect");
      if (refreshed && [...refreshed.options].some((option) => option.value === value)) refreshed.value = value;
      const status = $("#globalReviewModelStatus");
      if (status) status.textContent = `Modelo “${model.name}” criado e definido como modelo geral.`;
      refreshed?.focus({ preventScroll: true });
    }, 180);
    modelCreationSource = null;
  }

  function maskFolderModelSync() {
    const block = $("#folderReviewModelBlock");
    if (!block) return;
    block.classList.add("ux-syncing");
    setTimeout(() => block.classList.remove("ux-syncing"), 180);
  }

  function handleEarlyClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("#createReviewModelFromSettings")) modelCreationSource = "global";
    else if (target.closest("#saveReviewModelButton")) modelCreationSource = "review";

    if (target.closest("#folderReviewSettingsButton")) maskFolderModelSync();

    const exit = target.closest("#reviewSettingsBackButton,#cancelReviewSettingsButton");
    if (!exit) return;
    if (bypassNextReviewExit) {
      bypassNextReviewExit = false;
      return;
    }
    if (!reviewDirty || !reviewViewActive()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openUnsavedModal(exit);
  }

  function bindUnsavedModal() {
    $("#reviewUnsavedContinue")?.addEventListener("click", () => {
      pendingExitButton = null;
      closeUnsavedModal();
    });

    $("#reviewUnsavedDiscard")?.addEventListener("click", () => {
      const exit = pendingExitButton;
      pendingExitButton = null;
      reviewDirty = false;
      closeUnsavedModal();
      if (exit) {
        bypassNextReviewExit = true;
        exit.click();
      }
    });

    $("#reviewUnsavedSave")?.addEventListener("click", () => {
      pendingExitButton = null;
      closeUnsavedModal();
      $("#reviewSettingsForm")?.requestSubmit();
    });

    $("#reviewUnsavedModal")?.addEventListener("mousedown", (event) => {
      if (event.target === $("#reviewUnsavedModal")) closeUnsavedModal();
    });
  }

  function handleReviewModelChange(event) {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.id !== "reviewSettingsModelSelect") return;
    if (!reviewViewActive() || !event.isTrusted) return;
    reviewDirty = true;
    setTimeout(() => $("#loadReviewModelButton")?.click(), 0);
  }

  function handleReviewInput(event) {
    if (!reviewViewActive() || !event.isTrusted) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.closest("#reviewSettingsForm")) return;
    reviewDirty = true;
  }

  function handleSubmit(event) {
    if (event.target?.id === "reviewSettingsForm") {
      const wasDirty = reviewDirty;
      reviewDirty = false;
      setTimeout(() => {
        if (wasDirty && reviewViewActive()) reviewDirty = true;
      }, 250);
      return;
    }

    if (event.target?.id === "reviewModelForm" && modelCreationSource === "global") {
      const name = String($("#reviewModelName")?.value || "").trim();
      if (name) setTimeout(() => selectNewGlobalModel(name), 30);
    }
  }

  function watchReviewView() {
    const view = $("#reviewSettingsView");
    if (!view || view.dataset.reviewUxObserved === "true") return;
    view.dataset.reviewUxObserved = "true";
    reviewViewWasActive = view.classList.contains("active");
    const observer = new MutationObserver(() => {
      const active = view.classList.contains("active");
      if (active && !reviewViewWasActive) {
        reviewDirty = false;
        pendingExitButton = null;
        closeUnsavedModal();
        setTimeout(decorateReviewReuse, 0);
      }
      reviewViewWasActive = active;
    });
    observer.observe(view, { attributes: true, attributeFilter: ["class"] });
  }

  function observeDynamicUi() {
    const observer = new MutationObserver(() => {
      decorateReviewReuse();
      watchReviewView();
      if (!$("#reviewUnsavedModal")) {
        ensureUnsavedModal();
        bindUnsavedModal();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    ensureStyles();
    ensureUnsavedModal();
    decorateReviewReuse();
    watchReviewView();
    bindUnsavedModal();
    observeDynamicUi();
  }

  window.addEventListener("click", handleEarlyClick, true);
  document.addEventListener("change", handleReviewModelChange, true);
  document.addEventListener("input", handleReviewInput, true);
  document.addEventListener("submit", handleSubmit, true);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
