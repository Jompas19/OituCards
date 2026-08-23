(function () {
  const DEFAULT_REVIEW_SETTINGS = Object.freeze({
    hard: 1,
    medium: 2,
    good: 4,
    easy: 7,
    maxIntervalDays: 180
  });

  const REVIEW_MULTIPLIERS = Object.freeze({
    hard: 1.2,
    medium: 1.8,
    good: 2.5,
    easy: 4
  });

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
    quickEditWasPaused: true,
    editorDeckId: null,
    reviewSettingsDeckId: null
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
          <div class="study-setting study-filter-setting">
            <div>
              <span class="study-setting-title">O que você quer estudar agora?</span>
              <span id="studyAvailabilityHelp" class="study-setting-help">Sem filtro, entram cards novos e revisões disponíveis hoje.</span>
            </div>
            <div class="study-filter-options">
              <label class="study-filter-option">
                <input id="studyOnlyNewCheckbox" type="checkbox" />
                <span><strong>Somente cards novos</strong><small id="studyNewCount">0 disponíveis</small></span>
              </label>
              <label class="study-filter-option">
                <input id="studyOnlyReviewCheckbox" type="checkbox" />
                <span><strong>Somente revisões</strong><small id="studyDueCount">0 para hoje</small></span>
              </label>
            </div>
          </div>

          <div class="study-setting quantity-setting">
            <div>
              <label class="study-setting-title" for="studyCountInput">Quantos flashcards você fará agora?</label>
              <p id="studyPoolMeta" class="study-setting-help">Escolha uma quantidade ou faça todos os cards disponíveis.</p>
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

          <div id="studyConfigEmptyNotice" class="notice hidden">
            <strong id="studyConfigNoticeTitle">Nenhum flashcard disponível.</strong>
            <p id="studyConfigNoticeText"></p>
          </div>

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
            <button id="ratingRepeat" class="rating-button rating-repeat hidden" type="button" data-rating="repeat">
              <span class="rating-title"><span class="rating-key">0</span>Embaralhe novamente</span>
              <span id="ratingRepeatInterval" class="rating-interval">(ainda nesta sessão)</span>
            </button>
            <button class="rating-button rating-hard" type="button" data-rating="hard">
              <span class="rating-title"><span class="rating-key">1</span>Difícil</span>
              <span id="ratingHardInterval" class="rating-interval"></span>
            </button>
            <button class="rating-button rating-medium" type="button" data-rating="medium">
              <span class="rating-title"><span class="rating-key">2</span>Médio</span>
              <span id="ratingMediumInterval" class="rating-interval"></span>
            </button>
            <button class="rating-button rating-good" type="button" data-rating="good">
              <span class="rating-title"><span class="rating-key">3</span>Bom</span>
              <span id="ratingGoodInterval" class="rating-interval"></span>
            </button>
            <button class="rating-button rating-easy" type="button" data-rating="easy">
              <span class="rating-title"><span class="rating-key">4</span>Fácil</span>
              <span id="ratingEasyInterval" class="rating-interval"></span>
            </button>
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
    </section>

    <section id="reviewSettingsView" class="view">
      <div class="breadcrumb"><button id="reviewSettingsBackButton" class="link-button" type="button">← Voltar ao baralho</button></div>
      <div class="study-config-wrap">
        <div class="review-settings-heading">
          <div>
            <p class="eyebrow">Revisão espaçada</p>
            <h1>Ajuste da revisão</h1>
            <p id="reviewSettingsDeckName" class="subtitle">Baralho</p>
          </div>
          <button id="restoreReviewDefaultsButton" class="button ghost" type="button">Restaurar padrão</button>
        </div>

        <form id="reviewSettingsForm" class="study-config-card review-settings-card">
          <div class="review-settings-intro">
            <strong>Primeira revisão de um card novo</strong>
            <p>Defina em quantos dias o card deve reaparecer após a primeira avaliação.</p>
          </div>

          <div class="review-interval-grid">
            <label class="review-interval-field"><span>Difícil</span><div><input id="reviewHardDays" class="text-input" type="number" min="1" max="180" step="1" required /><small>dias</small></div></label>
            <label class="review-interval-field"><span>Médio</span><div><input id="reviewMediumDays" class="text-input" type="number" min="1" max="180" step="1" required /><small>dias</small></div></label>
            <label class="review-interval-field"><span>Bom</span><div><input id="reviewGoodDays" class="text-input" type="number" min="1" max="180" step="1" required /><small>dias</small></div></label>
            <label class="review-interval-field"><span>Fácil</span><div><input id="reviewEasyDays" class="text-input" type="number" min="1" max="180" step="1" required /><small>dias</small></div></label>
          </div>

          <div class="review-rule-summary">
            <strong>Revisões seguintes</strong>
            <p>Difícil × 1,2 · Médio × 1,8 · Bom × 2,5 · Fácil × 4</p>
            <p>O intervalo calculado é arredondado para o dia inteiro mais próximo e nunca passa de <strong>180 dias</strong>.</p>
          </div>

          <p id="reviewSettingsStatus" class="review-settings-status" aria-live="polite"></p>
          <div class="study-config-actions">
            <button class="button primary" type="submit">Salvar ajustes</button>
            <button id="cancelReviewSettingsButton" class="button ghost" type="button">Cancelar</button>
          </div>
        </form>
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

  function ensureReviewSettingsButton() {
    if ($("#reviewSettingsButton")) return;
    const actions = document.querySelector("#deckView .heading-actions");
    if (!actions) return;
    const button = document.createElement("button");
    button.id = "reviewSettingsButton";
    button.className = "button secondary";
    button.type = "button";
    button.textContent = "Ajuste da revisão";
    actions.prepend(button);
  }

  function injectUI() {
    ensureStyles();
    if (!$("#studyConfigView")) {
      const main = document.querySelector("main.shell");
      if (!main) return false;
      main.insertAdjacentHTML("beforeend", studyMarkup);
    }
    ensureReviewSettingsButton();
    return true;
  }

  function showView(name) {
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    $(`#${name}View`)?.classList.add("active");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function safePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(DEFAULT_REVIEW_SETTINGS.maxIntervalDays, parsed);
  }

  function getReviewSettings(deck = state.deck) {
    const stored = deck?.reviewSettings?.newIntervals || deck?.reviewSettings || {};
    return {
      hard: safePositiveInteger(stored.hard, DEFAULT_REVIEW_SETTINGS.hard),
      medium: safePositiveInteger(stored.medium, DEFAULT_REVIEW_SETTINGS.medium),
      good: safePositiveInteger(stored.good, DEFAULT_REVIEW_SETTINGS.good),
      easy: safePositiveInteger(stored.easy, DEFAULT_REVIEW_SETTINGS.easy),
      maxIntervalDays: DEFAULT_REVIEW_SETTINGS.maxIntervalDays
    };
  }

  function lastActualRating(card) {
    if (["hard", "medium", "good", "easy"].includes(card?.lastRating)) return card.lastRating;
    const history = Array.isArray(card?.ratingHistory) ? [...card.ratingHistory].reverse() : [];
    return history.find((item) => ["hard", "medium", "good", "easy"].includes(item?.rating))?.rating || null;
  }

  function getReviewCount(card) {
    if (Number.isInteger(card?.reviewCount) && card.reviewCount >= 0) return card.reviewCount;
    if (card?.lastReviewedAt || card?.nextReviewAt || lastActualRating(card)) return 1;
    return 0;
  }

  function isNewCard(card) {
    return getReviewCount(card) === 0 && !card?.lastReviewedAt && !card?.nextReviewAt && !lastActualRating(card);
  }

  function endOfToday() {
    const date = new Date();
    date.setHours(23, 59, 59, 999);
    return date;
  }

  function isDueReview(card) {
    if (isNewCard(card)) return false;
    if (!card?.nextReviewAt) return true;
    const due = new Date(card.nextReviewAt);
    if (Number.isNaN(due.getTime())) return true;
    return due <= endOfToday();
  }

  function getCurrentIntervalDays(card) {
    const explicit = Number(card?.currentIntervalDays);
    if (Number.isFinite(explicit) && explicit >= 1) return explicit;
    const settings = getReviewSettings();
    const lastRating = lastActualRating(card);
    return lastRating ? settings[lastRating] : 1;
  }

  function nextIntervalDays(card, rating) {
    const settings = getReviewSettings();
    if (getReviewCount(card) === 0) return settings[rating];
    const current = getCurrentIntervalDays(card);
    return Math.max(1, Math.min(settings.maxIntervalDays, Math.round(current * REVIEW_MULTIPLIERS[rating])));
  }

  function reviewDateAfterDays(days) {
    const target = new Date();
    target.setHours(0, 0, 0, 0);
    target.setDate(target.getDate() + Math.max(1, Math.round(days)));
    return target;
  }

  function formatDays(days) {
    return `${days} ${days === 1 ? "dia" : "dias"}`;
  }

  function getStudyMode() {
    if ($("#studyOnlyNewCheckbox")?.checked) return "new";
    if ($("#studyOnlyReviewCheckbox")?.checked) return "review";
    return "available";
  }

  function eligibleCards(cards = state.allCards) {
    const mode = getStudyMode();
    if (mode === "new") return cards.filter(isNewCard);
    if (mode === "review") return cards.filter(isDueReview);
    return cards.filter((card) => isNewCard(card) || isDueReview(card));
  }

  function availabilityCounts(cards = state.allCards) {
    return {
      newCards: cards.filter(isNewCard).length,
      dueReviews: cards.filter(isDueReview).length,
      futureReviews: cards.filter((card) => !isNewCard(card) && !isDueReview(card)).length
    };
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
    if (state.timerEnabled && !state.timerPaused && state.timerStartedAt) state.elapsedMs += Date.now() - state.timerStartedAt;
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

  function updateRatingHints() {
    const card = currentEntry()?.card;
    if (!card) return;
    const ids = { hard: "ratingHardInterval", medium: "ratingMediumInterval", good: "ratingGoodInterval", easy: "ratingEasyInterval" };
    Object.entries(ids).forEach(([rating, id]) => {
      const days = nextIntervalDays(card, rating);
      const target = $(`#${id}`);
      if (target) target.textContent = `(revisão em ${formatDays(days)})`;
    });
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
    updateRatingHints();
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

    if (rating === "repeat") {
      const patch = {
        ratingHistory: [...previous, { rating, at: now, sessionOnly: true }].slice(-150)
      };
      await OituDB.updateCard(card.id, patch);
      Object.assign(card, patch);
      return;
    }

    const intervalDays = nextIntervalDays(card, rating);
    const nextReviewAt = reviewDateAfterDays(intervalDays).toISOString();
    const patch = {
      reviewStatus: rating,
      lastRating: rating,
      lastReviewedAt: now,
      reviewCount: getReviewCount(card) + 1,
      currentIntervalDays: intervalDays,
      nextReviewAt,
      ratingHistory: [...previous, { rating, at: now, intervalDays, nextReviewAt }].slice(-150)
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
    scheduleHomeReviewDecoration();
  }

  function resetStudyUI() {
    $("#studyWorkspace").classList.remove("hidden");
    $("#studyComplete").classList.add("hidden");
    $("#studyTimer").classList.toggle("hidden", !state.timerEnabled);
  }

  function updateConfigAvailability() {
    const counts = availabilityCounts();
    const pool = eligibleCards();
    const mode = getStudyMode();

    $("#studyNewCount").textContent = `${counts.newCards} ${counts.newCards === 1 ? "disponível" : "disponíveis"}`;
    $("#studyDueCount").textContent = `${counts.dueReviews} para hoje`;

    const modeLabel = mode === "new" ? "card novo" : mode === "review" ? "revisão" : "card disponível hoje";
    $("#studyPoolMeta").textContent = `${pool.length} ${pool.length === 1 ? modeLabel : `${modeLabel}s`} para esta sessão.`;

    const all = $("#studyAllCheckbox").checked;
    $("#studyCountInput").max = String(Math.max(1, pool.length));
    if (all) $("#studyCountInput").value = pool.length ? String(pool.length) : "";
    else {
      const current = Number.parseInt($("#studyCountInput").value, 10);
      if (!Number.isInteger(current) || current < 1 || current > pool.length) $("#studyCountInput").value = pool.length ? String(Math.min(pool.length, 10)) : "";
    }

    const hasPool = pool.length > 0;
    $("#studyConfigEmptyNotice").classList.toggle("hidden", hasPool);
    $("#startStudyButton").disabled = !hasPool;

    if (!hasPool) {
      if (!state.allCards.length) {
        $("#studyConfigNoticeTitle").textContent = "Este baralho ainda não possui flashcards.";
        $("#studyConfigNoticeText").textContent = "Adicione ao menos um flashcard antes de iniciar um estudo.";
      } else if (mode === "new") {
        $("#studyConfigNoticeTitle").textContent = "Não há cards novos neste baralho.";
        $("#studyConfigNoticeText").textContent = "Todos os flashcards já apareceram pelo menos uma vez.";
      } else if (mode === "review") {
        $("#studyConfigNoticeTitle").textContent = "Nenhuma revisão para hoje.";
        $("#studyConfigNoticeText").textContent = "As próximas revisões deste baralho estão programadas para datas futuras.";
      } else {
        $("#studyConfigNoticeTitle").textContent = "Tudo em dia neste baralho.";
        $("#studyConfigNoticeText").textContent = "Não há cards novos nem revisões vencidas ou programadas para hoje.";
      }
    }
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

    const counts = availabilityCounts();
    $("#studyConfigDeckTitle").textContent = state.deck.name;
    $("#studyConfigDeckMeta").textContent = `${state.allCards.length} ${state.allCards.length === 1 ? "flashcard" : "flashcards"} · ${counts.newCards} novos · ${counts.dueReviews} revisões hoje`;
    $("#studyOnlyNewCheckbox").checked = false;
    $("#studyOnlyReviewCheckbox").checked = false;
    $("#studyAllCheckbox").checked = true;
    $("#studyCountInput").disabled = true;
    $("#studyShuffleCheckbox").checked = false;
    $("#studyReviewCheckbox").checked = false;
    $("#studyTimerCheckbox").checked = false;
    updateConfigAvailability();
    showView("studyConfig");
  }

  async function startStudyFromConfig(event) {
    event.preventDefault();
    state.deck = await OituDB.getDeck(state.deckId);
    state.allCards = await OituDB.getCardsByDeck(state.deckId);
    const pool = eligibleCards();

    if (!pool.length) {
      updateConfigAvailability();
      return;
    }

    const all = $("#studyAllCheckbox").checked;
    const requested = all ? pool.length : Number.parseInt($("#studyCountInput").value, 10);
    if (!Number.isInteger(requested) || requested < 1 || requested > pool.length) {
      alert(`Digite uma quantidade entre 1 e ${pool.length}.`);
      $("#studyCountInput").focus();
      return;
    }

    const source = $("#studyShuffleCheckbox").checked ? shuffle(pool) : [...pool];
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

  function fillReviewSettingsForm(settings) {
    $("#reviewHardDays").value = settings.hard;
    $("#reviewMediumDays").value = settings.medium;
    $("#reviewGoodDays").value = settings.good;
    $("#reviewEasyDays").value = settings.easy;
  }

  async function openReviewSettings(deckId = state.editorDeckId) {
    if (!deckId) return;
    const deck = await OituDB.getDeck(deckId);
    if (!deck) return;
    state.reviewSettingsDeckId = deckId;
    $("#reviewSettingsDeckName").textContent = deck.name;
    $("#reviewSettingsStatus").textContent = "";
    fillReviewSettingsForm(getReviewSettings(deck));
    showView("reviewSettings");
  }

  function readReviewSettingsForm() {
    const values = {
      hard: Number.parseInt($("#reviewHardDays").value, 10),
      medium: Number.parseInt($("#reviewMediumDays").value, 10),
      good: Number.parseInt($("#reviewGoodDays").value, 10),
      easy: Number.parseInt($("#reviewEasyDays").value, 10)
    };
    if (Object.values(values).some((value) => !Number.isInteger(value) || value < 1 || value > DEFAULT_REVIEW_SETTINGS.maxIntervalDays)) return null;
    return values;
  }

  async function saveReviewSettings(event) {
    event.preventDefault();
    const values = readReviewSettingsForm();
    if (!values) {
      $("#reviewSettingsStatus").textContent = "Use valores inteiros entre 1 e 180 dias.";
      return;
    }
    await OituDB.updateDeck(state.reviewSettingsDeckId, {
      reviewSettings: {
        newIntervals: values,
        maxIntervalDays: DEFAULT_REVIEW_SETTINGS.maxIntervalDays
      }
    });
    $("#reviewSettingsStatus").textContent = "Ajustes salvos.";
    showView("deck");
  }

  async function restoreReviewDefaults() {
    if (!state.reviewSettingsDeckId) return;
    const defaults = {
      hard: DEFAULT_REVIEW_SETTINGS.hard,
      medium: DEFAULT_REVIEW_SETTINGS.medium,
      good: DEFAULT_REVIEW_SETTINGS.good,
      easy: DEFAULT_REVIEW_SETTINGS.easy
    };
    fillReviewSettingsForm(defaults);
    await OituDB.updateDeck(state.reviewSettingsDeckId, {
      reviewSettings: {
        newIntervals: defaults,
        maxIntervalDays: DEFAULT_REVIEW_SETTINGS.maxIntervalDays
      }
    });
    $("#reviewSettingsStatus").textContent = "Padrão restaurado: 1, 2, 4 e 7 dias.";
  }

  function closeReviewSettings() {
    $("#reviewSettingsStatus").textContent = "";
    showView("deck");
  }

  let decoratingHome = false;
  let decorateQueued = false;

  async function decorateHomeReviewCounts() {
    if (decoratingHome) return;
    decoratingHome = true;
    try {
      const rows = [...document.querySelectorAll("#deckList [data-deck-id]")];
      await Promise.all(rows.map(async (row) => {
        const deckId = row.dataset.deckId;
        const info = row.querySelector(".deck-info");
        if (!deckId || !info) return;
        const cards = await OituDB.getCardsByDeck(deckId);
        const dueCount = cards.filter(isDueReview).length;
        let badge = info.querySelector(".review-due-badge");
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "review-due-badge";
          info.appendChild(badge);
        }
        const text = dueCount === 1 ? "↻ 1 revisão hoje" : `↻ ${dueCount} revisões hoje`;
        if (badge.textContent !== text) badge.textContent = text;
        badge.classList.toggle("has-due", dueCount > 0);
      }));
    } finally {
      decoratingHome = false;
    }
  }

  function scheduleHomeReviewDecoration() {
    if (decorateQueued) return;
    decorateQueued = true;
    setTimeout(async () => {
      decorateQueued = false;
      await decorateHomeReviewCounts();
    }, 0);
  }

  function observeHomeDeckList() {
    const list = $("#deckList");
    if (!list) return;
    const observer = new MutationObserver(() => scheduleHomeReviewDecoration());
    observer.observe(list, { childList: true, subtree: true });
    scheduleHomeReviewDecoration();
  }

  function bindEvents() {
    $("#studyConfigForm").addEventListener("submit", startStudyFromConfig);
    $("#studyConfigBackButton").addEventListener("click", goHome);
    $("#cancelStudyConfigButton").addEventListener("click", goHome);

    $("#studyOnlyNewCheckbox").addEventListener("change", (event) => {
      if (event.target.checked) $("#studyOnlyReviewCheckbox").checked = false;
      updateConfigAvailability();
    });
    $("#studyOnlyReviewCheckbox").addEventListener("change", (event) => {
      if (event.target.checked) $("#studyOnlyNewCheckbox").checked = false;
      updateConfigAvailability();
    });

    $("#studyAllCheckbox").addEventListener("change", (event) => {
      const checked = event.target.checked;
      $("#studyCountInput").disabled = checked;
      updateConfigAvailability();
      if (!checked) {
        $("#studyCountInput").focus();
        $("#studyCountInput").select();
      }
    });

    $("#studyCountInput").addEventListener("input", () => {
      const poolLength = eligibleCards().length;
      const value = Number.parseInt($("#studyCountInput").value, 10);
      if (Number.isInteger(value) && value > poolLength) $("#studyCountInput").value = poolLength;
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

    $("#reviewSettingsButton").addEventListener("click", () => openReviewSettings());
    $("#reviewSettingsForm").addEventListener("submit", saveReviewSettings);
    $("#restoreReviewDefaultsButton").addEventListener("click", restoreReviewDefaults);
    $("#reviewSettingsBackButton").addEventListener("click", closeReviewSettings);
    $("#cancelReviewSettingsButton").addEventListener("click", closeReviewSettings);

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

      const editDeckButton = event.target.closest('[data-action="edit-deck"]');
      if (editDeckButton && !editDeckButton.classList.contains("deck-name-button")) {
        const row = editDeckButton.closest("[data-deck-id]");
        if (row) state.editorDeckId = row.dataset.deckId;
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

    $("#homeButton")?.addEventListener("click", scheduleHomeReviewDecoration);
    $("#backHomeButton")?.addEventListener("click", scheduleHomeReviewDecoration);
  }

  function init() {
    if (!injectUI()) return;
    bindEvents();
    observeHomeDeckList();
  }

  window.OituStudy = { openConfig, openReviewSettings };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
