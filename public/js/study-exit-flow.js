(function () {
  const state = {
    exitKind: null,
    returningToLibrary: false
  };

  const $ = (selector) => document.querySelector(selector);

  function ensureUI() {
    if ($("#studyExitChoiceModal")) return;

    document.body.insertAdjacentHTML("beforeend", `
      <div id="studyExitChoiceModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="studyExitChoiceTitle">
        <div class="modal tiny-modal study-exit-choice-modal">
          <div class="modal-header">
            <div>
              <p class="eyebrow">Estudo em andamento</p>
              <h2 id="studyExitChoiceTitle">Encerrar este estudo?</h2>
            </div>
            <button id="studyExitChoiceClose" class="icon-button modal-close" type="button" aria-label="Fechar">×</button>
          </div>
          <p class="confirm-message">As respostas que você já marcou continuam salvas. Escolha o que deseja fazer agora.</p>
          <div class="study-exit-choice-actions">
            <button id="studyExitChoiceCancel" class="button ghost" type="button">Cancelar</button>
            <button id="studyExitChoiceAgain" class="button primary" type="button">Novo estudo</button>
            <button id="studyExitChoiceHome" class="button secondary" type="button">Voltar aos baralhos</button>
          </div>
        </div>
      </div>
    `);

    if (!$("#studyExitChoiceStyle")) {
      const style = document.createElement("style");
      style.id = "studyExitChoiceStyle";
      style.textContent = `
        .study-exit-choice-modal{width:min(520px,100%)}
        .study-exit-choice-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:20px}
        @media(max-width:620px){.study-exit-choice-actions .button{flex:1 1 100%}}
      `;
      document.head.appendChild(style);
    }
  }

  function openExitChoice(kind) {
    ensureUI();
    state.exitKind = kind;
    $("#studyExitChoiceModal")?.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeExitChoice() {
    state.exitKind = null;
    $("#studyExitChoiceModal")?.classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
  }

  function showLibraryDirectly() {
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    $("#homeView")?.classList.add("active");
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => {
      Promise.resolve(window.OituLibrary?.render?.()).catch((error) => console.error(error));
    });
  }

  function markFastReturn() {
    state.returningToLibrary = true;
  }

  function handleHomeButtonCapture(event) {
    if (!state.returningToLibrary) return;
    state.returningToLibrary = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    showLibraryDirectly();
  }

  function exitToNewStudy() {
    const kind = state.exitKind;
    closeExitChoice();
    if (kind === "multi") $("#multiAgain")?.click();
    else $("#studyAgainButton")?.click();
  }

  function exitToLibrary() {
    const kind = state.exitKind;
    closeExitChoice();
    markFastReturn();
    if (kind === "multi") $("#multiHome")?.click();
    else $("#studyHomeButton")?.click();
  }

  function interceptEarlyExit(event) {
    const single = event.target.closest("#exitStudyButton");
    const multi = event.target.closest("#multiExit");
    if (!single && !multi) return;

    const isSingleActive = !!single && $("#studyView")?.classList.contains("active") && !$("#studyWorkspace")?.classList.contains("hidden") && $("#studyComplete")?.classList.contains("hidden");
    const isMultiActive = !!multi && $("#multiStudyView")?.classList.contains("active") && !$("#multiWorkspace")?.classList.contains("hidden") && $("#multiComplete")?.classList.contains("hidden");
    if (!isSingleActive && !isMultiActive) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openExitChoice(isMultiActive ? "multi" : "single");
  }

  function installFastStudyReturns() {
    [
      "#studyConfigBackButton",
      "#cancelStudyConfigButton",
      "#multiBackHome",
      "#multiCancel",
      "#studyHomeButton",
      "#multiHome"
    ].forEach((selector) => {
      $(selector)?.addEventListener("click", markFastReturn, true);
    });
    $("#homeButton")?.addEventListener("click", handleHomeButtonCapture, true);
  }

  function bindEvents() {
    document.addEventListener("click", interceptEarlyExit, true);
    $("#studyExitChoiceCancel")?.addEventListener("click", closeExitChoice);
    $("#studyExitChoiceClose")?.addEventListener("click", closeExitChoice);
    $("#studyExitChoiceAgain")?.addEventListener("click", exitToNewStudy);
    $("#studyExitChoiceHome")?.addEventListener("click", exitToLibrary);
    $("#studyExitChoiceModal")?.addEventListener("mousedown", (event) => {
      if (event.target === $("#studyExitChoiceModal")) closeExitChoice();
    });
    installFastStudyReturns();
  }

  function init() {
    ensureUI();
    bindEvents();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
