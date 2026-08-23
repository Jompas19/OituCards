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
        <div class="study-config-heading"><p class="eyebrow">Preparar estudo</p><h1 id="studyConfigDeckTitle">Baralho</h1><p id="studyConfigDeckMeta" class="subtitle">0 flashcards neste baralho</p></div>
        <form id="studyConfigForm" class="study-config-card">
          <div class="study-setting quantity-setting">
            <div><label class="study-setting-title" for="studyCountInput">Quantos flashcards você fará agora?</label><p class="study-setting-help">Escolha uma quantidade ou faça o baralho inteiro.</p></div>
            <div class="study-quantity-controls"><input id="studyCountInput" class="text-input study-count-input" type="number" min="1" inputmode="numeric" /><label class="check-option"><input id="studyAllCheckbox" type="checkbox" /><span>Fazer todos</span></label></div>
          </div>
          <label class="study-setting check-setting"><div><span class="study-setting-title">Embaralhar os flashcards?</span><span class="study-setting-help">Se desativado, será seguida a ordem de criação do baralho.</span></div><input id="studyShuffleCheckbox" class="switch-input" type="checkbox" /></label>
          <label class="study-setting check-setting"><div><span class="study-setting-title">Permitir revisões no estudo atual?</span><span class="study-setting-help">Ativa a opção de recolocar um flashcard mais à frente nesta sessão.</span></div><input id="studyReviewCheckbox" class="switch-input" type="checkbox" /></label>
          <label class="study-setting check-setting"><div><span class="study-setting-title">Deseja ativar o temporizador?</span><span class="study-setting-help">Mostra o tempo decorrido. Durante o estudo, clique no tempo para pausar ou retomar.</span></div><input id="studyTimerCheckbox" class="switch-input" type="checkbox" /></label>
          <div id="studyConfigEmptyNotice" class="notice hidden"><strong>Este baralho ainda não possui flashcards.</strong><p>Adicione ao menos um flashcard antes de iniciar um estudo.</p></div>
          <div class="study-config-actions"><button id="startStudyButton" class="button primary" type="submit">Começar estudo</button><button id="cancelStudyConfigButton" class="button ghost" type="button">Cancelar</button></div>
        </form>
      </div>
    </section>
    <section id="studyView" class="view study-view">
      <div class="study-session-top">
        <button id="exitStudyButton" class="link-button" type="button">← Encerrar estudo</button>
        <div class="study-session-status"><button id="studyTimer" class="study-timer hidden" type="button" title="Clique para pausar o temporizador">00:00</button><span id="studyProgress" class="study-progress">0/0</span></div>
      </div>
      <div id="studyWorkspace" class="study-workspace">
        <button id="studyPrevButton" class="study-nav-button" type="button" aria-label="Flashcard anterior" title="Flashcard anterior (←)">←</button>
        <div class="study-card-column">
          <article id="studyCard" class="study-card" tabindex="0" aria-label="Flashcard. Clique ou pressione espaço para revelar a resposta.">
            <div class="study-face-label">Frente</div><div id="studyFront" class="study-card-content"></div>
            <div id="studyRevealHint" class="study-reveal-hint">Clique no card ou pressione espaço para revelar o verso</div>
            <div id="studyBackSection" class="study-back-section hidden"><div class="study-divider"></div><div class="study-face-label">Verso</div><div id="studyBack" class="study-card-content"></div></div>
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
      <div id="studyComplete" class="study-complete hidden"><div class="empty-icon">✓</div><p class="eyebrow">Sessão concluída</p><h1>Estudo finalizado</h1><p id="studyCompleteText" class="subtitle"></p><div class="study-complete-actions"><button id="studyAgainButton" class="button primary" type="button">Novo estudo</button><button id="studyHomeButton" class="button secondary" type="button">Voltar aos baralhos</button></div></div>
    </section>`;

  const studyStyles = `.study-config-wrap{width:min(760px,100%);margin:0 auto}.study-config-heading{margin-bottom:22px}.study-config-heading h1{margin:4px 0 7px;font-size:clamp(2rem,5vw,3rem);letter-spacing:-.045em}.study-config-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm);overflow:hidden}.study-setting{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:21px 22px;border-bottom:1px solid var(--line)}.study-setting-title{display:block;font-weight:800;color:var(--text)}.study-setting-help{display:block;margin:5px 0 0;color:var(--muted);font-size:.88rem;line-height:1.45}.study-quantity-controls{display:flex;align-items:center;gap:12px;flex-shrink:0}.study-count-input{width:104px}.check-option{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;color:var(--text);font-weight:700}.switch-input{appearance:none;width:46px;height:26px;border-radius:999px;background:var(--surface-2);border:1px solid var(--line);position:relative;cursor:pointer;flex:0 0 auto}.switch-input::after{content:"";position:absolute;width:20px;height:20px;left:2px;top:2px;border-radius:999px;background:var(--surface);box-shadow:0 1px 4px rgba(0,0,0,.2);transition:transform .16s ease}.switch-input:checked{background:var(--primary);border-color:var(--primary)}.switch-input:checked::after{transform:translateX(20px)}.study-config-card .notice{margin:18px 22px 0}.study-config-actions{display:flex;gap:9px;padding:22px}.study-session-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.study-session-status{display:flex;align-items:center;gap:10px;font-variant-numeric:tabular-nums}.study-timer,.study-progress{display:inline-flex;min-height:34px;align-items:center;justify-content:center;padding:0 11px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--text);font-size:.84rem;font-weight:800}.study-timer{cursor:pointer}.study-timer.paused{opacity:.62;border-style:dashed}.study-workspace{display:grid;grid-template-columns:52px minmax(0,760px) 52px;justify-content:center;align-items:center;gap:15px}.study-card-column{min-width:0}.study-nav-button{width:48px;height:48px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--text);font-size:1.25rem;cursor:pointer;box-shadow:var(--shadow-sm)}.study-nav-button:disabled{opacity:.3;cursor:default;box-shadow:none}.study-card{min-height:390px;display:flex;flex-direction:column;justify-content:center;padding:clamp(24px,5vw,48px);border:1px solid var(--line);border-radius:24px;background:var(--surface);box-shadow:var(--shadow);cursor:pointer;outline:0;user-select:text}.study-face-label{margin-bottom:11px;color:var(--muted);font-size:.72rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.study-card-content{color:var(--text);font-size:clamp(1.08rem,2.4vw,1.42rem);line-height:1.62;overflow-wrap:anywhere}.study-card-content img{display:block;max-width:100%;max-height:430px;object-fit:contain;margin:16px auto;border-radius:12px}.study-divider{height:1px;background:var(--line);margin:28px 0}.study-reveal-hint{margin-top:28px;color:var(--muted);font-size:.78rem;text-align:center}.study-edit-area{display:flex;justify-content:flex-end;margin:9px 2px -6px}.study-edit-button{border:0;background:transparent;color:var(--muted);font-size:.78rem;font-weight:700;cursor:pointer;padding:6px 4px}.study-edit-button:hover{color:var(--text)}.study-rating-area{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:15px}.rating-button{min-height:52px;border:0;border-radius:12px;padding:8px 9px;color:#fff;font-weight:800;cursor:pointer}.rating-repeat{background:#374151}.rating-hard{background:#b91c1c}.rating-medium{background:#d6a91b;color:#171717}.rating-good{background:#39a76b}.rating-easy{background:#75a9ed}.rating-key{display:inline-grid;place-items:center;min-width:22px;height:22px;margin-right:6px;border-radius:7px;background:rgba(255,255,255,.18);font-size:.72rem}.study-complete{width:min(620px,100%);margin:70px auto 0;padding:52px 28px;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm)}.study-complete-actions{display:flex;justify-content:center;gap:9px;margin-top:22px;flex-wrap:wrap}@media(max-width:760px){.study-setting{align-items:flex-start;flex-direction:column}.check-setting{flex-direction:row;align-items:center}.study-quantity-controls{width:100%;justify-content:space-between}.study-workspace{grid-template-columns:1fr}.study-nav-button{position:fixed;bottom:18px;z-index:25;width:44px;height:44px}#studyPrevButton{left:16px}#studyNextButton{right:16px}.study-card{min-height:360px;padding:25px 20px}.study-rating-area{