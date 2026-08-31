(function () {
  if (window.__oitucardsReviewModelCreateDefaults) return;
  window.__oitucardsReviewModelCreateDefaults = true;

  const SYSTEM_VALUES = Object.freeze({
    modelHardDays: 1,
    modelMediumDays: 2,
    modelGoodDays: 4,
    modelEasyDays: 7,
    modelHardMultiplier: 1.2,
    modelMediumMultiplier: 1.8,
    modelGoodMultiplier: 2.5,
    modelEasyMultiplier: 4,
    modelMaxDays: 180
  });

  let resetPending = false;
  let modalObserver = null;

  const $ = (selector) => document.querySelector(selector);

  function fillSystemDefaults() {
    if (!resetPending) return;
    const modal = $("#reviewModelModal");
    if (!modal || modal.classList.contains("hidden")) return;

    Object.entries(SYSTEM_VALUES).forEach(([id, value]) => {
      const input = $(`#${id}`);
      if (input) input.value = value;
    });
  }

  function finishReset() {
    if (!resetPending) return;
    fillSystemDefaults();
    resetPending = false;
  }

  function resetAfterOpen() {
    if (!resetPending) return;
    // Alguns fluxos antigos ainda preenchem o modal logo após abri-lo.
    // Estes dois passos garantem que o ponto de partida final seja sempre
    // o Padrão OituCards, sem alterar o fluxo "Salvar como modelo".
    setTimeout(fillSystemDefaults, 0);
    setTimeout(finishReset, 30);
  }

  function captureCreationIntent(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("#createReviewModelFromSettings")) {
      resetPending = true;
      resetAfterOpen();
      return;
    }

    if (target.closest("#saveReviewModelButton")) {
      resetPending = false;
      return;
    }

    if (target.closest("#reviewModelModalClose,#reviewModelModalCancel") || target.id === "reviewModelModal") {
      resetPending = false;
    }
  }

  function watchModal() {
    const modal = $("#reviewModelModal");
    if (!modal || modal.dataset.createDefaultsObserved === "true") return false;
    modal.dataset.createDefaultsObserved = "true";
    modalObserver?.disconnect();
    modalObserver = new MutationObserver(() => {
      if (!modal.classList.contains("hidden") && resetPending) resetAfterOpen();
    });
    modalObserver.observe(modal, { attributes: true, attributeFilter: ["class"] });
    return true;
  }

  function init() {
    watchModal();
    setTimeout(watchModal, 50);
    setTimeout(watchModal, 250);
  }

  window.addEventListener("click", captureCreationIntent, true);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
