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
  const installed = new Set();

  function activeSourceView() {
    return [...document.querySelectorAll(".view.active")].find((view) =>
      !CONFIGS.some((config) => config.viewId === view.id)
    ) || null;
  }

  function rememberSource() {
    const source = activeSourceView();
    if (source?.id) lastSourceViewId = source.id;
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
    if (!ready && attempt < 120) setTimeout(() => installAll(attempt + 1), 50);
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

  function handleKeydown(event) {
    if (event.key !== "Escape") return;
    const config = CONFIGS.find((item) => document.getElementById(item.viewId)?.classList.contains("active"));
    if (!config) return;
    event.preventDefault();
    document.querySelector(config.cancelSelector)?.click();
  }

  document.addEventListener("click", rememberSource, true);
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
