(function () {
  const state = {
    deckId: null,
    deck: null,
    allCards: [],
    queue: [],
    currentIndex: 0,
    totalOriginal: 0,
    completedOriginalIds: new Set(),
    allowReview: false,
    timerEnabled: false,
    timerId: null,
    timerStartedAt: null,
    elapsedMs: 0,
    timerPaused: false,
    revealed: false,
    sessionActive: false,
    quickEditing: false,
    quickEditWasPaused: true
  };

  const $ = (selector) => document.querySelector(selector);

  const studyMarkup = `
    <section id="studyConfigView" class="view">
      <div class="breadcrumb"><button id="studyConfigBackButton" class="link-button" type="button">← Meus baralhos</button></div>
      <div class="study-config-wrap">
        <div class="study-config-heading">
          <p class="eyebrow">Preparar estudo</p>
          <h1 id="studyConfigDeckTitle">Baralho</h1>
          <p id="studyConfigDeckMeta" class="subtitle">0 flashcards neste baralho</p>
        </div>
        <form id="studyConfigForm" class="study-config-card">
          <div class="study-setting quantity-setting">
            <div>
              <label class="study-setting-title" for="studyCountInput">Quantos flashcards você fará agora?</label>
              <p class="study-setting-help">Escolha uma quantidade ou faça o baralho inteiro.</p>
            </div>
            <div class="study-quantity-controls">
              <input id="studyCountInput" class="text-input study-count-input" type="number" min="1" inputmode="numeric" />
              <label class="check-option"><input id="studyAllCheckbox" type="checkbox" /><span>Fazer todos</span></label>
            </div>
          </div>
          <label class="study-setting check-setting">
            <div><span class="study-setting-title">Embaralhar os flashcards?</span><span class="study-setting-help">Se desativado, será seguida a ordem de criação do baralho.</span></div>
            <input id="studyShuffleCheckbox" class="switch-input" type="checkbox" />
          </label>
          <label class="study-setting check-setting">
            <div><span class="study-setting-title">Permitir revisões no estudo atual?</span><span class="study-setting-help">Ativa a opção de recolocar um flashcard mais à frente nesta sessão.</span></div>
            <input id="studyReviewCheckbox" class="switch-input" type="checkbox" />
          </label>
          <label class="study-setting check-setting">
            <div><span class="study-setting-title">Deseja ativar o temporizador?</span><span class="study-setting-help">Mostra o tempo decorrido. Durante o estudo, clique no tempo para pausar ou retomar.</span></div>
            <input id="studyTimerCheckbox" class="switch-input" type="checkbox" />
          </label>
          <div id="studyConfigEmptyNotice" class="notice hidden"><strong>Este baralho ainda não possui flashcards.</strong><p>Adicione ao menos um flashcard antes de iniciar um estudo.</p></div>
          <div class="study-config-actions">
            <button id="startStudyButton" class="button primary" type="submit">Começar estudo</button>
            <button id="cancelStudyConfigButton" class="button ghost" type="button">Cancelar</button>
          </div>
        </form>
      </div>
    </section>

    <section id="studyView" class="view study-view">
      <div class="study-session-top">
        <button id="exitStudyButton" class="link-button" type="button">← Encerrar estudo</button>
        <div class="study-session-status">
          <button id="studyTimer" class="study-timer hidden" type="button" title="Clique para pausar o temporizador">00:00</button>
          <span id="studyProgress" class="study-progress">0/0</span>
        </div>
      </div>

      <div id="studyWorkspace" class="study-workspace">
        <button id="studyPrevButton" class="study-nav-button" type="button" aria-label="Flashcard anterior" title="Flashcard anterior (←)">←</button>
        <div class="study-card-column">
          <article id="studyCard" class="study-card" tabindex="0" aria-label="Flashcard. Clique ou pressione espaço para revelar a resposta.">
            <div class="study-face-label">Frente</div>
            <div id="studyFront" class="study-card-content"></div>
            <div id="studyRevealHint" class="study-reveal-hint">Clique no card ou pressione espaço para revelar o verso</div>
            <div id="studyBackSection" class="study-back-section hidden">
              <div class="study-divider"></div>
              <div class="study-face-label">Verso</div>
              <div id="studyBack" class="study-card-content"></div>
            </div>
          </article>
          <div id="studyEditArea" class="study-edit-area hidden"><button id="studyEditCardButton" class="study-edit-button" type="button">✎ Editar flashcard</button></div>
          <div id="studyRatingArea" class="study-rating-area hidden">
            <button id="ratingRepeat" class="rating-button rating-repeat hidden" type="button" data-rating="repeat"><span class="rating-key">0</span>Embaralhe novamente</button>
            <button class="rating-button rating-hard" type="button" data-rating="hard"><span class="rating-key">1</span>Difícil</button>
            <button class="rating-button rating-medium" type="button" data-rating="medium"><span class="rating-key">2</span>Médio</button>
            <button class="rating-button rating-good" type="button" data-rating="good"><span class="rating-key">3</span>Bom</button>
            <button class="rating-button rating-easy" type="button" data-rating="easy"><span class="rating-key">4</span>Fácil</button>
          </div>
        </div>
        <button id="studyNextButton" class="study-nav-button" type="button" aria-label="Próximo flashcard" title="Próximo flashcard (→)">→</button>
      </div>

      <div id="studyComplete" class="study-complete hidden">
        <div class="empty-icon">✓</div>
        <p class="eyebrow">Sessão concluída</p>
        <h1>Estudo finalizado</h1>
        <p id="studyCompleteText" class="subtitle"></p>
        <div class="study-complete-actions">
          <button id="studyAgainButton" class="button primary" type="button">Novo estudo</button>
          <button id="studyHomeButton" class="button secondary" type="button">Voltar aos baralhos</button>
        </div>
      </div>
    </section>`;

  function ensureStyles() {
    if (document.querySelector('link[data-oitucards-study-css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/study.css";
    link.dataset.oitucardsStudyCss = "true";
    document.head.appendChild(link);
  }

  function injectUI() {
    ensureStyles();
    if (!$("#studyConfigView")) {
      const main = document.querySelector("main.shell");
      if (!main) return false;
      main.insertAdjacentHTML("beforeend", studyMarkup);
    }
    return true;
  }

  function showView(name) {
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    $(`#${name}View`)?.classList.add("active");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function goHome() {
    stopTimer();
    state.sessionActive = false;
    $("#homeButton")?.click();
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function currentElapsedMs() {
    if (!state.timerEnabled) return 0;
    if (state.timerPaused || !state.timerStartedAt) return state.elapsedMs;
    return state.elapsedMs + (Date.now() - state.timerStartedAt);
  }

  function updateTimerDisplay() {
    const timer = $("#studyTimer");
    if (!timer) return;
    timer.textContent = formatElapsed(currentElapsedMs());
    timer.classList.toggle("paused", state.timerPaused);
    timer.title = state.timerPaused ? "Temporizador pausado. Clique para retomar." : "Clique para pausar o temporizador";
  }

  function stopTimerInterval() {
    if (!state.timerId) return;
    clearInterval(state.timerId);
    state.timerId = null;
  }

  function stopTimer() {
    if (state.timerEnabled && !state.timerPaused && state.timerStartedAt) {
      state.elapsedMs += Date.now() - state.timerStartedAt;
    }
    state.timerStartedAt = null;
    stopTimerInterval();
  }

  function startTimer() {
    stopTimerInterval();
    state.elapsedMs = 0;
    state.timerPaused = false;
    state.timerStartedAt = null;
    const timer = $("#studyTimer");

    if (!state.timerEnabled) {
      timer?.classList.add("hidden");
      return;
    }

    timer?.classList.remove("hidden");
    state.timerStartedAt = Date.now();
    updateTimerDisplay();
    state.timerId = setInterval(updateTimerDisplay, 500);
  }

  function pauseTimer() {
    if (!state.timerEnabled || state.timerPaused) return;
    if (state.timerStartedAt) state.elapsedMs += Date.now() - state.timerStartedAt;
    state.timerStartedAt = null;
    state.timerPaused = true;
    stopTimerInterval();
    updateTimerDisplay();
  }

  function resumeTimer() {
    if (!state.timerEnabled || !state.timerPaused) return;
    state.timerPaused = false;
    state.timerStartedAt = Date.now();
    updateTimerDisplay();
    stopTimerInterval();
    state.timerId = setInterval(updateTimerDisplay, 500);
  }

  function toggleTimer() {
    if (!state.timerEnabled || state.quickEditing) return;
    if (state.timerPaused) resumeTimer();
    else pauseTimer();
  }

  function updateProgress() {
    $("#studyProgress").textContent = `${state.completedOriginalIds.size}/${state.totalOriginal}`;
  }

  function setBackVisible(visible) {
    state.revealed = visible;
    $("#studyBackSection").classList.toggle("hidden", !visible);
    $("#studyRatingArea").classList.toggle("hidden", !visible);
    $("#studyEditArea").classList.toggle("hidden", !visible);
    $("#studyRevealHint").classList.toggle("hidden", visible);
  }

  function currentEntry() {
    return state.queue[state.currentIndex] || null;
  }

  function renderCurrent() {
    const entry = currentEntry();
    if (!entry) {
      finishStudy();
      return;
    }
    $("#studyFront").innerHTML = entry.card.frontHtml || "";
    $("#studyBack").innerHTML = entry.card.backHtml || "";
    $("#ratingRepeat").classList.toggle("hidden", !state.allowReview);
    setBackVisible(false);
    updateProgress();
    $("#studyPrevButton").disabled = state.currentIndex <= 0;
    $("#studyNextButton").disabled = state.currentIndex >= state.queue.length - 1;
    $("#studyCard").focus({ preventScroll: true });
  }

  function revealCurrent() {
    if (state.sessionActive && currentEntry() && !state.revealed && !state.quickEditing) setBackVisible(true);
  }

  function navigate(delta) {
    if (!state.sessionActive || state.quickEditing) return;
    const target = state.currentIndex + delta;
    if (target < 0 || target >= state.queue.length) return;
    state.currentIndex = target;
    renderCurrent();
  }

  function scheduleRepeat(entry) {
    const gap = 3 + Math.floor(Math.random() * 4);
    const insertAt = Math.min(state.queue.length, state.currentIndex + gap + 1);
    state.queue.splice(insertAt, 0, { card: entry.card, isRepeat: true, done: false, nonce: crypto.randomUUID() });
  }

  async function persistRating(card, rating) {
    const now = new Date().toISOString();
    const previous = Array.isArray(card.ratingHistory) ? card.ratingHistory : [];
    const patch = {
      reviewStatus: rating,
      lastRating: rating,
      lastReviewedAt: now,
      ratingHistory: [...previous, { rating, at: now }].slice(-100)
    };
    await OituDB.updateCard(card.id, patch);
    Object.assign(card, patch);
  }

  function findNextPendingIndex(after) {
    for (let i = after + 1; i < state.queue.length; i += 1) if (!state.queue[i].done) return i;
    for (let i = 0; i <= after; i += 1) if (!state.queue[i].done) return i;
    return -1;
  }

  async function rateCurrent(rating) {
    const entry = currentEntry();
    if (!state.sessionActive || !state.revealed || !entry || state.quickEditing) return;
    if (rating === "repeat" && !state.allowReview) return;

    if (!state.completedOriginalIds.has(entry.card.id)) state.completedOriginalIds.add(entry.card.id);
    entry.done = true;
    if (rating === "repeat") scheduleRepeat(entry);

    try {
      await persistRating(entry.card, rating);
    } catch (error) {
      console.error(error);
    }

    updateProgress();
    const nextIndex = findNextPendingIndex(state.currentIndex);
    if (nextIndex === -1) {
      finishStudy();
      return;
    }
    state.currentIndex = nextIndex;
    renderCurrent();
  }

  function finishStudy() {
    const elapsed = currentElapsedMs();
    state.sessionActive = false;
    stopTimer();
    $("#studyWorkspace").classList.add("hidden");
    $("#studyComplete").classList.remove("hidden");
    updateProgress();
    const suffix = state.timerEnabled ? ` em ${formatElapsed(elapsed)}` : "";
    $("#studyCompleteText").textContent = `Você concluiu ${state.totalOriginal} ${state.totalOriginal === 1 ? "flashcard" : "flashcards"}${suffix}.`;
  }

  function resetStudyUI() {
    $("#studyWorkspace").classList.remove("hidden");
    $("#studyComplete").classList.add("hidden");
    $("#studyTimer").classList.toggle("hidden", !state.timerEnabled);
  }

  async function openConfig(deckId) {
    stopTimer();
    state.sessionActive = false;
    state.quickEditing = false;
    state.deckId = deckId;
    state.deck = await OituDB.getDeck(deckId);
    state.allCards = await OituDB.getCardsByDeck(deckId);

    if (!state.deck) {
      alert("Baralho não encontrado.");
      goHome();
      return;
    }

    $("#studyConfigDeckTitle").textContent = state.deck.name;
    $("#studyConfigDeckMeta").textContent = `${state.allCards.length} ${state.allCards.length === 1 ? "flashcard" : "flashcards"} neste baralho`;
    const hasCards = state.allCards.length > 0;
    $("#studyConfigEmptyNotice").classList.toggle("hidden", hasCards);
    $("#startStudyButton").disabled = !hasCards;
    $("#studyAllCheckbox").checked = true;
    $("#studyCountInput").value = hasCards ? state.allCards.length : "";
    $("#studyCountInput").max = hasCards ? String(state.allCards.length) : "1";
    $("#studyCountInput").disabled = true;
    $("#studyShuffleCheckbox").checked = false;
    $("#studyReviewCheckbox").checked = false;
    $("#studyTimerCheckbox").checked = false;
    showView("studyConfig");
  }

  async function startStudyFromConfig(event) {
    event.preventDefault();
    state.allCards = await OituDB.getCardsByDeck(state.deckId);
    if (!state.allCards.length) {
      alert("Este baralho ainda não possui flashcards.");
      return;
    }

    const all = $("#studyAllCheckbox").checked;
    const requested = all ? state.allCards.length : Number.parseInt($("#studyCountInput").value, 10);
    if (!Number.isInteger(requested) || requested < 1 || requested > state.allCards.length) {
      alert(`Digite uma quantidade entre 1 e ${state.allCards.length}.`);
      $("#studyCountInput").focus();
      return;
    }

    const source = $("#studyShuffleCheckbox").checked ? shuffle(state.allCards) : [...state.allCards];
    state.queue = source.slice(0, requested).map((card) => ({ card, isRepeat: false, done: false, nonce: crypto.randomUUID() }));
    state.currentIndex = 0;
    state.totalOriginal = requested;
    state.completedOriginalIds = new Set();
    state.allowReview = $("#studyReviewCheckbox").checked;
    state.timerEnabled = $("#studyTimerCheckbox").checked;
    state.revealed = false;
    state.sessionActive = true;
    state.quickEditing = false;
    resetStudyUI();
    showView("study");
    startTimer();
    updateProgress();
    renderCurrent();
  }

  function confirmExitStudy() {
    if (!state.sessionActive) {
      openConfig(state.deckId);
      return;
    }
    if (!window.confirm("Encerrar este estudo agora? O progresso desta sessão será interrompido.")) return;
    stopTimer();
    state.sessionActive = false;
    openConfig(state.deckId);
  }

  function closeCardModal() {
    $("#cardModal")?.classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
    OituEditor.resetEditors();
  }

  function refreshEditedCard(cardId, patch) {
    state.allCards.forEach((card) => {
      if (card.id === cardId) Object.assign(card, patch);
    });
    state.queue.forEach((entry) => {
      if (entry.card.id === cardId) Object.assign(entry.card, patch);
    });
    const entry = currentEntry();
    if (entry?.card.id === cardId) {
      $("#studyFront").innerHTML = entry.card.frontHtml || "";
      $("#studyBack").innerHTML = entry.card.backHtml || "";
      setBackVisible(true);
    }
  }

  async function openQuickEdit() {
    const entry = currentEntry();
    if (!state.sessionActive || !state.revealed || !entry || state.quickEditing) return;

    const freshCard = await OituDB.getCard(entry.card.id);
    if (!freshCard) return;

    state.quickEditing = true;
    state.quickEditWasPaused = state.timerPaused || !state.timerEnabled;
    if (state.timerEnabled && !state.timerPaused) pauseTimer();

    OituEditor.setEditors(freshCard.frontHtml, freshCard.backHtml);
    $("#cardModalTitle").textContent = "Editar flashcard";
    $("#createCardActions").classList.add("hidden");
    $("#editCardActions").classList.remove("hidden");
    $("#cardModal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    setTimeout(() => OituEditor.editorFor("front")?.focus(), 50);
  }

  async function finishQuickEdit(save) {
    if (!state.quickEditing) return;
    const entry = currentEntry();

    if (save && entry) {
      const front = OituEditor.editorFor("front");
      const back = OituEditor.editorFor("back");
      if (!OituEditor.hasContent(front) || !OituEditor.hasContent(back)) {
        alert('O campo "Frente" ou "Verso" está vazio!');
        return;
      }

      const patch = {
        frontHtml: OituEditor.sanitizeHtml(front.innerHTML),
        backHtml: OituEditor.sanitizeHtml(back.innerHTML)
      };
      await OituDB.updateCard(entry.card.id, patch);
      refreshEditedCard(entry.card.id, patch);
    }

    closeCardModal();
    state.quickEditing = false;
    if (state.timerEnabled && !state.quickEditWasPaused) resumeTimer();
    $("#studyCard")?.focus({ preventScroll: true });
  }

  function bindEvents() {
    $("#studyConfigForm").addEventListener("submit", startStudyFromConfig);
    $("#studyConfigBackButton").addEventListener("click", goHome);
    $("#cancelStudyConfigButton").addEventListener("click", goHome);

    $("#studyAllCheckbox").addEventListener("change", (event) => {
      const checked = event.target.checked;
      $("#studyCountInput").disabled = checked;
      if (checked) $("#studyCountInput").value = state.allCards.length || "";
      else {
        $("#studyCountInput").focus();
        $("#studyCountInput").select();
      }
    });

    $("#studyCountInput").addEventListener("input", () => {
      const value = Number.parseInt($("#studyCountInput").value, 10);
      if (Number.isInteger(value) && value > state.allCards.length) $("#studyCountInput").value = state.allCards.length;
    });

    $("#studyCard").addEventListener("click", revealCurrent);
    $("#studyPrevButton").addEventListener("click", () => navigate(-1));
    $("#studyNextButton").addEventListener("click", () => navigate(1));
    $("#studyTimer").addEventListener("click", toggleTimer);
    $("#studyEditCardButton").addEventListener("click", openQuickEdit);
    $("#exitStudyButton").addEventListener("click", confirmExitStudy);
    $("#studyRatingArea").addEventListener("click", (event) => {
      const button = event.target.closest("[data-rating]");
      if (button) rateCurrent(button.dataset.rating);
    });
    $("#studyAgainButton").addEventListener("click", () => openConfig(state.deckId));
    $("#studyHomeButton").addEventListener("click", goHome);

    document.addEventListener("keydown", (event) => {
      if (state.quickEditing) return;
      if (!state.sessionActive || !$("#studyView").classList.contains("active")) return;
      const tag = document.activeElement?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;

      if (event.code === "Space") {
        event.preventDefault();
        revealCurrent();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigate(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        navigate(1);
        return;
      }
      if (!state.revealed) return;

      const ratingMap = { "0": "repeat", "1": "hard", "2": "medium", "3": "good", "4": "easy" };
      const rating = ratingMap[event.key];
      if (!rating || (rating === "repeat" && !state.allowReview)) return;
      event.preventDefault();
      rateCurrent(rating);
    });

    document.addEventListener("click", (event) => {
      const deckName = event.target.closest(".deck-name-button");
      if (deckName && !state.quickEditing) {
        const row = deckName.closest("[data-deck-id]");
        if (row) {
          event.preventDefault();
          event.stopPropagation();
          openConfig(row.dataset.deckId);
          return;
        }
      }

      if (!state.quickEditing) return;
      const actionButton = event.target.closest("[data-card-action]");
      const closeButton = event.target.closest('[data-close-modal="cardModal"]');
      if (!actionButton && !closeButton) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (closeButton || actionButton?.dataset.cardAction === "cancel") finishQuickEdit(false);
      else if (actionButton?.dataset.cardAction === "save-edit") finishQuickEdit(true);
    }, true);

    document.addEventListener("mousedown", (event) => {
      if (!state.quickEditing || event.target?.id !== "cardModal") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishQuickEdit(false);
    }, true);
  }

  function init() {
    if (!injectUI()) return;
    bindEvents();
  }

  window.OituStudy = { openConfig };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
