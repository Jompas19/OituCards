(function () {
  if (window.__oitucardsStudyConfigModalUx) return;
  window.__oitucardsStudyConfigModalUx = true;

  const CONFIGS = [
    {
      viewId: "studyConfigView",
      cancelSelector: "#cancelStudyConfigButton",
      headingSelector: ".study-config-heading"
    },
    {
      viewId: "multiStudyConfigView",
      cancelSelector: "#multiCancel",
      headingSelector: ".study-config-heading"
    }
  ];

  let lastSourceViewId = "homeView";
  let lastSourceScrollY = 0;
  let currentEditorDeckId = null;
  const installed = new Set();

  function activeSourceView() {
    return [...document.querySelectorAll(".view.active")].find((view) =>
      !CONFIGS.some((config) => config.viewId === view.id)
    ) || null;
  }

  function rememberSource() {
    const source = activeSourceView();
    if (source?.id) {
      lastSourceViewId = source.id;
      lastSourceScrollY = window.scrollY || 0;
    }
  }

  function ensureWorkflowStyles() {
    if (document.getElementById("studyWorkflowRefinementStyles")) return;
    const style = document.createElement("style");
    style.id = "studyWorkflowRefinementStyles";
    style.textContent = `
      #studyReviewSettingRow,
      #multiRepeatRow{display:none!important}
      #startDeckStudyButton{white-space:nowrap}
    `;
    document.head.appendChild(style);
  }

  function ensureDeckStudyButton() {
    const actions = document.querySelector("#deckView .heading-actions");
    if (!actions || document.getElementById("startDeckStudyButton")) return Boolean(actions);
    const button = document.createElement("button");
    button.id = "startDeckStudyButton";
    button.className = "button secondary";
    button.type = "button";
    button.textContent = "▶ Iniciar estudo";
    button.title = "Preparar estudo deste baralho";
    actions.prepend(button);
    return true;
  }

  function forceRepeatEnabled(formId) {
    if (formId === "studyConfigForm") {
      const checkbox = document.querySelector("#studyReviewCheckbox");
      if (checkbox) checkbox.checked = true;
      return;
    }
    if (formId === "multiConfigForm") {
      const checkbox = document.querySelector("#multiRepeat");
      if (checkbox) checkbox.checked = true;
    }
  }

  function returnToDeckEditor() {
    const configView = document.getElementById("studyConfigView");
    const sourceId = configView?.dataset.studyConfigSource || lastSourceViewId;
    if (sourceId !== "deckView") return false;

    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    document.getElementById("deckView")?.classList.add("active");
    window.scrollTo({ top: lastSourceScrollY, behavior: "instant" });
    return true;
  }

  function ensureCloseButton(config, view) {
    const heading = view.querySelector(config.headingSelector);
    if (!heading || heading.querySelector(".study-config-window-close")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button modal-close study-config-window-close";
    button.setAttribute("aria-label", "Fechar preparação de estudo");
    button.title = "Fechar";
    button.textContent = "×";
    button.addEventListener("click", () => document.querySelector(config.cancelSelector)?.click());
    heading.appendChild(button);
  }

  function setModalState(config, view, active) {
    if (active) {
      const source = document.getElementById(lastSourceViewId) || document.getElementById("homeView");
      if (source && source !== view) {
        source.classList.add("active", "study-config-underlay-view");
        view.dataset.studyConfigSource = source.id;
        window.scrollTo({ top: lastSourceScrollY, behavior: "instant" });
      }
      view.classList.add("study-config-modal-view");
      document.body.classList.add("study-config-modal-open");
      document.body.style.overflow = "hidden";
      ensureCloseButton(config, view);
      requestAnimationFrame(() => view.querySelector("#startStudyButton,#multiStart")?.focus({ preventScroll: true }));
      return;
    }

    view.classList.remove("study-config-modal-view");
    const sourceId = view.dataset.studyConfigSource;
    if (sourceId) document.getElementById(sourceId)?.classList.remove("study-config-underlay-view");
    delete view.dataset.studyConfigSource;

    const currentSource = activeSourceView();
    if (sourceId && currentSource?.id === sourceId) {
      requestAnimationFrame(() => window.scrollTo({ top: lastSourceScrollY, behavior: "instant" }));
    }

    if (!CONFIGS.some((item) => document.getElementById(item.viewId)?.classList.contains("active"))) {
      document.body.classList.remove("study-config-modal-open");
      if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
    }
  }

  function installConfig(config) {
    const view = document.getElementById(config.viewId);
    if (!view || installed.has(config.viewId)) return Boolean(view);
    installed.add(config.viewId);

    ensureCloseButton(config, view);
    let wasActive = view.classList.contains("active");
    if (wasActive) setModalState(config, view, true);

    const observer = new MutationObserver(() => {
      const active = view.classList.contains("active");
      if (active === wasActive) return;
      wasActive = active;
      setModalState(config, view, active);
    });
    observer.observe(view, { attributes: true, attributeFilter: ["class"] });

    view.addEventListener("mousedown", (event) => {
      if (event.target !== view || !view.classList.contains("active")) return;
      event.preventDefault();
      document.querySelector(config.cancelSelector)?.click();
    });

    return true;
  }

  function installAll(attempt = 0) {
    const ready = CONFIGS.every((config) => installConfig(config));
    ensureDeckStudyButton();
    if ((!ready || !document.getElementById("startDeckStudyButton")) && attempt < 120) {
      setTimeout(() => installAll(attempt + 1), 50);
    }
  }

  function prepareLogoTransition(attempt = 0) {
    const button = document.querySelector("#homeButton.brand-button");
    if (!button) {
      if (attempt < 120) setTimeout(() => prepareLogoTransition(attempt + 1), 50);
      return;
    }

    const markReady = () => {
      const logo = button.querySelector(".brand-official-logo");
      if (logo?.complete && logo.naturalWidth > 0) button.classList.add("brand-logo-ready");
    };

    const watchLogo = (logo) => {
      if (!logo) return;
      if (logo.complete && logo.naturalWidth > 0) {
        button.classList.add("brand-logo-ready");
        return;
      }
      logo.addEventListener("load", () => button.classList.add("brand-logo-ready"), { once: true });
    };

    watchLogo(button.querySelector(".brand-official-logo"));
    const observer = new MutationObserver(() => {
      const logo = button.querySelector(".brand-official-logo");
      if (!logo) return;
      watchLogo(logo);
      markReady();
      if (button.classList.contains("brand-logo-ready")) observer.disconnect();
    });
    observer.observe(button, { childList: true });
    setTimeout(markReady, 0);
  }

  function handleWorkflowClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const editDeckButton = target.closest('[data-action="edit-deck"]');
    const editDeckRow = editDeckButton?.closest("[data-deck-id]");
    if (editDeckButton && editDeckRow && !editDeckButton.classList.contains("deck-name-button")) {
      currentEditorDeckId = editDeckRow.dataset.deckId || null;
    }

    if (target.closest(".deck-name-button")) currentEditorDeckId = null;

    if (target.closest("#startDeckStudyButton")) {
      if (!currentEditorDeckId || !window.OituStudy?.openConfig) return;
      event.preventDefault();
      window.OituStudy.openConfig(currentEditorDeckId);
      return;
    }

    const singleConfigClose = target.closest("#studyConfigBackButton,#cancelStudyConfigButton,#studyConfigView .study-config-window-close");
    if (singleConfigClose && document.getElementById("studyConfigView")?.classList.contains("active")) {
      const sourceId = document.getElementById("studyConfigView")?.dataset.studyConfigSource || lastSourceViewId;
      if (sourceId === "deckView") {
        event.preventDefault();
        event.stopImmediatePropagation();
        returnToDeckEditor();
      }
    }
  }

  function handleConfigSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === "studyConfigForm" || form.id === "multiConfigForm") forceRepeatEnabled(form.id);
  }

  function handleKeydown(event) {
    if (event.key !== "Escape") return;
    const config = CONFIGS.find((item) => document.getElementById(item.viewId)?.classList.contains("active"));
    if (!config) return;
    event.preventDefault();
    document.querySelector(config.cancelSelector)?.click();
  }

  ensureWorkflowStyles();
  document.addEventListener("click", rememberSource, true);
  document.addEventListener("click", handleWorkflowClick, true);
  document.addEventListener("submit", handleConfigSubmit, true);
  document.addEventListener("keydown", handleKeydown, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      rememberSource();
      installAll();
      prepareLogoTransition();
    }, { once: true });
  } else {
    rememberSource();
    installAll();
    prepareLogoTransition();
  }
})();
