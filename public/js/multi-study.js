(function () {
  const DEFAULTS = {
    newIntervals: { hard: 1, medium: 2, good: 4, easy: 7 },
    multipliers: { hard: 1.2, medium: 1.8, good: 2.5, easy: 4 },
    maxIntervalDays: 180
  };
  const RATINGS = ["hard", "medium", "good", "easy"];
  const state = {
    deckIds: [], decks: new Map(), cards: [], queue: [], index: 0,
    completed: new Set(), total: 0, label: "Estudar selecionados",
    allowRepeat: false, redoMode: "none", active: false, revealed: false,
    timerEnabled: false, timerPaused: false, timerStartedAt: null, elapsedMs: 0, timerId: null,
    quickEditing: false, quickEditWasPaused: true, deckLoads: new Map(), renderToken: 0
  };
  const $ = (s) => document.querySelector(s);

  const markup = `
  <section id="multiStudyConfigView" class="view">
    <div class="breadcrumb"><button id="multiBackHome" class="link-button" type="button">← Meus baralhos</button></div>
    <div class="study-config-wrap">
      <div class="study-config-heading"><p class="eyebrow">Estudo combinado</p><h1 id="multiConfigTitle">Estudar selecionados</h1><p id="multiConfigMeta" class="subtitle"></p></div>
      <form id="multiConfigForm" class="study-config-card">
        <div id="multiNormalFilters" class="study-setting study-filter-setting">
          <div><span class="study-setting-title">O que você quer estudar agora?</span><span class="study-setting-help">Sem filtro, entram cards novos e revisões disponíveis hoje de todos os baralhos escolhidos.</span></div>
          <div class="study-filter-options">
            <label class="study-filter-option"><input id="multiOnlyNew" type="checkbox"><span><strong>Somente cards novos</strong><small id="multiNewCount"></small></span></label>
            <label class="study-filter-option"><input id="multiOnlyDue" type="checkbox"><span><strong>Somente revisões</strong><small id="multiDueCount"></small></span></label>
          </div>
        </div>
        <div class="study-setting redo-setting"><div><span class="study-setting-title">Refazer os cards selecionados</span><span class="study-setting-help">Disponibiliza todos os cards desses baralhos, independentemente da agenda atual.</span></div><input id="multiRedo" class="switch-input" type="checkbox"></div>
        <div id="multiRedoOptions" class="redo-options hidden">
          <label class="redo-option"><input type="radio" name="multiRedoMode" value="reset"><span><strong>Reiniciar progresso</strong><small>Zera oficialmente o histórico dos cards desses baralhos antes de começar.</small></span></label>
          <label class="redo-option"><input type="radio" name="multiRedoMode" value="keep"><span><strong>Manter progresso</strong><small>Refaz os cards sem alterar datas, intervalos ou histórico de revisão.</small></span></label>
        </div>
        <div class="study-setting quantity-setting"><div><label class="study-setting-title" for="multiCount">Quantos flashcards você fará agora?</label><p id="multiPoolMeta" class="study-setting-help"></p></div><div class="study-quantity-controls"><input id="multiCount" class="text-input study-count-input" type="number" min="1"><label class="check-option"><input id="multiAll" type="checkbox"><span>Fazer todos</span></label></div></div>
        <label class="study-setting check-setting"><div><span class="study-setting-title">Embaralhar os flashcards?</span><span class="study-setting-help">Mistura cards de todos os baralhos selecionados.</span></div><input id="multiShuffle" class="switch-input" type="checkbox"></label>
        <label id="multiRepeatRow" class="study-setting check-setting"><div><span class="study-setting-title">Permitir revisões no estudo atual?</span><span class="study-setting-help">Permite recolocar um card mais à frente nesta sessão.</span></div><input id="multiRepeat" class="switch-input" type="checkbox"></label>
        <label class="study-setting check-setting"><div><span class="study-setting-title">Deseja ativar o temporizador?</span><span class="study-setting-help">Clique no tempo durante o estudo para pausar ou retomar.</span></div><input id="multiTimerEnabled" class="switch-input" type="checkbox"></label>
        <div id="multiEmpty" class="notice hidden"><strong>Nenhum flashcard disponível.</strong><p id="multiEmptyText"></p></div>
        <div class="study-config-actions"><button id="multiStart" class="button primary" type="submit">Começar estudo</button><button id="multiCancel" class="button ghost" type="button">Cancelar</button></div>
      </form>
    </div>
  </section>
  <section id="multiStudyView" class="view study-view">
    <div class="study-session-top"><button id="multiExit" class="link-button" type="button">← Encerrar estudo</button><div class="study-session-status"><button id="multiTimer" class="study-timer hidden" type="button">00:00</button><span id="multiProgress" class="study-progress">0/0</span></div></div>
    <div id="multiWorkspace" class="study-workspace">
      <button id="multiPrev" class="study-nav-button" type="button">←</button>
      <div class="study-card-column">
        <div id="multiDeckChip" class="multi-deck-chip"></div>
        <article id="multiCard" class="study-card" tabindex="0"><div class="study-face-label">Frente</div><div id="multiFront" class="study-card-content"></div><div id="multiHint" class="study-reveal-hint">Clique no card ou pressione espaço para revelar o verso</div><div id="multiBackSection" class="study-back-section hidden"><div class="study-divider"></div><div class="study-face-label">Verso</div><div id="multiBack" class="study-card-content"></div></div></article>
        <div id="multiEditArea" class="study-edit-area hidden"><button id="multiEdit" class="study-edit-button" type="button">✎ Editar flashcard</button></div>
        <div id="multiRatings" class="study-rating-area hidden">
          <button id="multiRateRepeat" class="rating-button rating-repeat hidden" type="button" data-multi-rating="repeat"><span class="rating-title"><span class="rating-key">0</span>Embaralhe novamente</span><span class="rating-interval">(ainda nesta sessão)</span></button>
          <button id="multiRateNext" class="rating-button rating-next hidden" type="button" data-multi-rating="next"><span class="rating-title">Próximo</span><span class="rating-interval">(não altera a revisão)</span></button>
          <button id="multiRateHard" class="rating-button rating-hard" type="button" data-multi-rating="hard"><span class="rating-title"><span class="rating-key">1</span>Difícil</span><span id="multiHintHard" class="rating-interval"></span></button>
          <button id="multiRateMedium" class="rating-button rating-medium" type="button" data-multi-rating="medium"><span class="rating-title"><span class="rating-key">2</span>Médio</span><span id="multiHintMedium" class="rating-interval"></span></button>
          <button id="multiRateGood" class="rating-button rating-good" type="button" data-multi-rating="good"><span class="rating-title"><span class="rating-key">3</span>Bom</span><span id="multiHintGood" class="rating-interval"></span></button>
          <button id="multiRateEasy" class="rating-button rating-easy" type="button" data-multi-rating="easy"><span class="rating-title"><span class="rating-key">4</span>Fácil</span><span id="multiHintEasy" class="rating-interval"></span></button>
        </div>
      </div>
      <button id="multiNextArrow" class="study-nav-button" type="button">→</button>
    </div>
    <div id="multiComplete" class="study-complete hidden"><div class="empty-icon">✓</div><p class="eyebrow">Sessão concluída</p><h1>Estudo finalizado</h1><p id="multiCompleteText" class="subtitle"></p><div class="study-complete-actions"><button id="multiAgain" class="button primary" type="button">Novo estudo</button><button id="multiHome" class="button secondary" type="button">Voltar aos baralhos</button></div></div>
  </section>`;

  function ensureUI() {
    if (!$("#multiStudyConfigView")) document.querySelector("main.shell")?.insertAdjacentHTML("beforeend", markup);
    if (!$("#multiStudyExtraStyle")) {
      const style = document.createElement("style");
      style.id = "multiStudyExtraStyle";
      style.textContent = `.multi-deck-chip{font-size:.78rem;color:var(--muted);margin:0 0 8px 4px}.rating-next{background:#64748b}.study-rating-area.multi-keep{grid-template-columns:repeat(2,minmax(0,1fr))}`;
      document.head.appendChild(style);
    }
  }
  function showView(name) { document.querySelectorAll(".view").forEach(v => v.classList.remove("active")); $(`#${name}View`)?.classList.add("active"); window.scrollTo({top:0,behavior:"instant"}); }
  function home() { stopTimer(); state.active = false; $("#homeButton")?.click(); }
  function ratingOf(card) { if (RATINGS.includes(card?.lastRating)) return card.lastRating; const h = Array.isArray(card?.ratingHistory) ? [...card.ratingHistory].reverse() : []; return h.find(x => RATINGS.includes(x?.rating))?.rating || null; }
  function reviewCount(card) { if (Number.isInteger(card?.reviewCount) && card.reviewCount >= 0) return card.reviewCount; return card?.lastReviewedAt || card?.nextReviewAt || ratingOf(card) ? 1 : 0; }
  function isNew(card) { return reviewCount(card) === 0 && !card?.lastReviewedAt && !card?.nextReviewAt && !ratingOf(card); }
  function endToday() { const d = new Date(); d.setHours(23,59,59,999); return d; }
  function isDue(card) { if (isNew(card)) return false; if (!card?.nextReviewAt)return true;const d=new Date(card.nextReviewAt),unit=String(card.currentIntervalUnit||"").toLocaleLowerCase("pt-BR"),exact=["minutes","minute","minutos","minuto","min","hours","hour","horas","hora","h"].includes(unit);return Number.isNaN(d.getTime())||d<=(exact?new Date():endToday()); }
  function settingsFor(card) {
    const deck = state.decks.get(card.deckId) || {};
    const r = deck.reviewSettings || {};
    const ni = r.newIntervals || r || {};
    const m = r.multipliers || {};
    const max = Number.isFinite(Number(r.maxIntervalDays)) ? Math.max(1, Math.round(Number(r.maxIntervalDays))) : DEFAULTS.maxIntervalDays;
    return { newIntervals: { hard:+ni.hard||1, medium:+ni.medium||2, good:+ni.good||4, easy:+ni.easy||7 }, multipliers: { hard:+m.hard||1.2, medium:+m.medium||1.8, good:+m.good||2.5, easy:+m.easy||4 }, maxIntervalDays:max };
  }
  function nextDays(card, rating) { const s=settingsFor(card); if (reviewCount(card)===0) return Math.min(s.maxIntervalDays,Math.max(1,Math.round(s.newIntervals[rating]))); const cur=Number(card.currentIntervalDays)||s.newIntervals[rating]||1; return Math.max(1,Math.min(s.maxIntervalDays,Math.round(cur*s.multipliers[rating]))); }
  function redoFromUI() { if (!$("#multiRedo")?.checked) return "none"; return document.querySelector('input[name="multiRedoMode"]:checked')?.value || "reset"; }
  function mode() { if (redoFromUI()!=="none") return "redo"; if ($("#multiOnlyNew")?.checked) return "new"; if ($("#multiOnlyDue")?.checked) return "due"; return "available"; }
  function pool() { const m=mode(); if(m==="redo") return [...state.cards]; if(m==="new") return state.cards.filter(isNew); if(m==="due") return state.cards.filter(isDue); return state.cards.filter(c=>isNew(c)||isDue(c)); }
  function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
  function updateConfig(){const p=pool();const newN=state.cards.filter(isNew).length,dueN=state.cards.filter(isDue).length;$("#multiNewCount").textContent=`${newN} disponíveis`;$("#multiDueCount").textContent=`${dueN} para hoje`;$("#multiPoolMeta").textContent=`${p.length} ${p.length===1?"card disponível":"cards disponíveis"} para esta sessão.`;const all=$("#multiAll").checked;$("#multiCount").max=String(Math.max(1,p.length));if(all)$("#multiCount").value=p.length?String(p.length):"";else{const n=parseInt($("#multiCount").value,10);if(!Number.isInteger(n)||n<1||n>p.length)$("#multiCount").value=p.length?String(Math.min(20,p.length)):"";}$("#multiStart").disabled=!p.length;$("#multiEmpty").classList.toggle("hidden",!!p.length);if(!p.length)$("#multiEmptyText").textContent=state.cards.length?"Não há cards que atendam ao filtro atual.":"Os baralhos selecionados não possuem flashcards.";}
  function updateRedoUI(){const on=$("#multiRedo").checked;$("#multiRedoOptions").classList.toggle("hidden",!on);$("#multiNormalFilters").classList.toggle("is-disabled",on);$("#multiOnlyNew").disabled=on;$("#multiOnlyDue").disabled=on;if(on){$("#multiOnlyNew").checked=false;$("#multiOnlyDue").checked=false;if(!document.querySelector('input[name="multiRedoMode"]:checked'))document.querySelector('input[name="multiRedoMode"][value="reset"]').checked=true;}const keep=on&&redoFromUI()==="keep";$("#multiRepeatRow").classList.toggle("hidden",keep);if(keep)$("#multiRepeat").checked=false;updateConfig();}
  function fmt(ms){const s=Math.floor(Math.max(0,ms)/1000),m=Math.floor(s/60);return `${String(m).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;}
  function elapsed(){return state.timerEnabled&&!state.timerPaused&&state.timerStartedAt?state.elapsedMs+Date.now()-state.timerStartedAt:state.elapsedMs;}
  function timerDisplay(){const el=$("#multiTimer");if(!el)return;el.textContent=fmt(elapsed());el.classList.toggle("paused",state.timerPaused);}
  function stopTimer(){if(state.timerEnabled&&!state.timerPaused&&state.timerStartedAt)state.elapsedMs+=Date.now()-state.timerStartedAt;state.timerStartedAt=null;if(state.timerId)clearInterval(state.timerId);state.timerId=null;}
  function startTimer(){stopTimer();state.elapsedMs=0;state.timerPaused=false;$("#multiTimer").classList.toggle("hidden",!state.timerEnabled);if(state.timerEnabled){state.timerStartedAt=Date.now();timerDisplay();state.timerId=setInterval(timerDisplay,500);}}
  function toggleTimer(){if(!state.timerEnabled||state.quickEditing)return;if(state.timerPaused){state.timerPaused=false;state.timerStartedAt=Date.now();state.timerId=setInterval(timerDisplay,500);}else{state.elapsedMs+=Date.now()-state.timerStartedAt;state.timerStartedAt=null;state.timerPaused=true;if(state.timerId)clearInterval(state.timerId);state.timerId=null;}timerDisplay();}
  function current(){return state.queue[state.index]||null;}
  function showBack(show){state.revealed=show;$("#multiBackSection").classList.toggle("hidden",!show);$("#multiRatings").classList.toggle("hidden",!show);$("#multiEditArea").classList.toggle("hidden",!show);$("#multiHint").classList.toggle("hidden",show);if(show)window.OituMedia?.hydrate?.($("#multiBack"));}
  function updateProgress(){$("#multiProgress").textContent=`${state.completed.size}/${state.total}`;}
  function updateControls(){const keep=state.redoMode==="keep";$("#multiRatings").classList.toggle("multi-keep",keep);$("#multiRateNext").classList.toggle("hidden",!keep);RATINGS.forEach(r=>$("#multiRate"+r[0].toUpperCase()+r.slice(1)).classList.toggle("hidden",keep));$("#multiRateRepeat").classList.toggle("hidden",keep?false:!state.allowRepeat);if(!keep){const card=current()?.card;if(card)RATINGS.forEach(r=>$("#multiHint"+r[0].toUpperCase()+r.slice(1)).textContent=`(revisão em ${nextDays(card,r)} ${nextDays(card,r)===1?"dia":"dias"})`);}}
  async function ensureCardLoaded(card){if(!card||typeof card.frontHtml==="string")return card;let load=state.deckLoads.get(card.deckId);if(!load){load=OituDB.getCardsByDeck(card.deckId);state.deckLoads.set(card.deckId,load);}const cards=await load,full=cards.find(item=>item.id===card.id);if(full)Object.assign(card,full);return card;}
  function preloadNext(){const next=state.queue[state.index+1]?.card;if(!next||typeof next.frontHtml==="string"||state.deckLoads.has(next.deckId))return;const run=()=>ensureCardLoaded(next).catch(()=>{});if(typeof requestIdleCallback==="function")requestIdleCallback(run,{timeout:900});else setTimeout(run,80);}
  async function render(){const e=current();if(!e){finish();return;}const token=++state.renderToken;try{await ensureCardLoaded(e.card);}catch(error){console.error("OituCards: não foi possível carregar o flashcard.",error);return;}if(token!==state.renderToken||e!==current())return;if(window.OituMedia?.setHtml){window.OituMedia.setHtml($("#multiFront"),e.card.frontHtml||"");window.OituMedia.setHtml($("#multiBack"),e.card.backHtml||"",{hydrate:false});}else{$("#multiFront").innerHTML=e.card.frontHtml||"";$("#multiBack").innerHTML=e.card.backHtml||"";}$("#multiDeckChip").textContent=state.decks.get(e.card.deckId)?.name||"Baralho";updateControls();showBack(false);updateProgress();$("#multiPrev").disabled=state.index<=0;$("#multiNextArrow").disabled=state.index>=state.queue.length-1;$("#multiCard").focus({preventScroll:true});preloadNext();}
  function navigate(d){if(!state.active||state.quickEditing)return;const i=state.index+d;if(i<0||i>=state.queue.length)return;state.index=i;render();}
  function scheduleRepeat(e){const gap=3+Math.floor(Math.random()*4);state.queue.splice(Math.min(state.queue.length,state.index+gap+1),0,{card:e.card,done:false,repeat:true,id:crypto.randomUUID()});}
  async function persist(card,rating){if(state.redoMode==="keep")return;const now=new Date().toISOString();const prev=Array.isArray(card.ratingHistory)?card.ratingHistory:[];if(rating==="repeat"){const patch={ratingHistory:[...prev,{rating,at:now,sessionOnly:true}].slice(-150)};await OituDB.updateCard(card.id,patch);Object.assign(card,patch);return;}const days=nextDays(card,rating),next=new Date();next.setHours(0,0,0,0);next.setDate(next.getDate()+days);const patch={reviewStatus:rating,lastRating:rating,lastReviewedAt:now,reviewCount:reviewCount(card)+1,currentIntervalDays:days,nextReviewAt:next.toISOString(),ratingHistory:[...prev,{rating,at:now,intervalDays:days,nextReviewAt:next.toISOString()}].slice(-150)};await OituDB.updateCard(card.id,patch);Object.assign(card,patch);}
  function nextPending(after){for(let i=after+1;i<state.queue.length;i++)if(!state.queue[i].done)return i;for(let i=0;i<=after;i++)if(!state.queue[i].done)return i;return-1;}
  async function complete(action){const e=current();if(!state.active||!state.revealed||!e||state.quickEditing)return;const keep=state.redoMode==="keep";if(keep&&!['repeat','next'].includes(action))return;if(!keep&&!RATINGS.includes(action)&&action!=="repeat")return;if(action==="repeat"&&!keep&&!state.allowRepeat)return;if(!state.completed.has(e.card.id))state.completed.add(e.card.id);e.done=true;if(action==="repeat")scheduleRepeat(e);if(!keep)await persist(e.card,action);updateProgress();const n=nextPending(state.index);if(n<0){finish();return;}state.index=n;render();}
  function finish(){const ms=elapsed();state.active=false;stopTimer();$("#multiWorkspace").classList.add("hidden");$("#multiComplete").classList.remove("hidden");const suffix=state.timerEnabled?` em ${fmt(ms)}`:"";$("#multiCompleteText").textContent=`Você concluiu ${state.total} ${state.total===1?"flashcard":"flashcards"}${suffix}.`;$("#homeButton")?.dispatchEvent(new Event("oitucards-refresh"));}
  async function resetProgress(cards){const patch={reviewStatus:null,lastRating:null,lastReviewedAt:null,reviewCount:0,currentIntervalDays:null,currentIntervalValue:null,currentIntervalUnit:null,currentIntervalMinutes:null,currentIntervalHours:null,nextReviewAt:null,ratingHistory:[]};if(OituDB.resetDeckProgressBatch)await OituDB.resetDeckProgressBatch(cards);else await Promise.all(cards.map(card=>OituDB.updateCard(card.id,patch)));cards.forEach(card=>Object.assign(card,patch));}
  async function start(event){event.preventDefault();let p=pool();if(!p.length)return;const all=$("#multiAll").checked,n=all?p.length:parseInt($("#multiCount").value,10);if(!Number.isInteger(n)||n<1||n>p.length){alert(`Digite uma quantidade entre 1 e ${p.length}.`);return;}const redo=redoFromUI();if(redo==="reset"){await resetProgress(state.cards);p=[...state.cards];}state.redoMode=redo;const source=$("#multiShuffle").checked?shuffle(p):[...p];state.queue=source.slice(0,n).map(card=>({card,done:false,repeat:false,id:crypto.randomUUID()}));state.index=0;state.completed=new Set();state.total=n;state.allowRepeat=redo==="keep"?true:$("#multiRepeat").checked;state.timerEnabled=$("#multiTimerEnabled").checked;state.active=true;state.revealed=false;$("#multiWorkspace").classList.remove("hidden");$("#multiComplete").classList.add("hidden");showView("multiStudy");startTimer();render();}
  async function openConfig(deckIds,label="Estudar selecionados"){
    ensureUI();stopTimer();state.active=false;state.deckIds=[...new Set(deckIds)].filter(Boolean);state.label=label;state.decks=new Map();state.cards=[];state.deckLoads=new Map();state.renderToken+=1;
    $("#multiConfigTitle").textContent=label;$("#multiConfigMeta").textContent="Preparando flashcards…";$("#multiStart").disabled=true;showView("multiStudyConfig");
    const [allDecks,cards]=await Promise.all([OituDB.getDecks(),OituDB.getCardSummariesForDecks?OituDB.getCardSummariesForDecks(state.deckIds):Promise.all(state.deckIds.map(id=>OituDB.getCardsByDeck(id))).then(groups=>groups.flat())]);
    const selected=new Set(state.deckIds);allDecks.filter(deck=>selected.has(deck.id)).forEach(deck=>state.decks.set(deck.id,deck));state.cards.push(...cards.filter(card=>state.decks.has(card.deckId)));
    if(!state.decks.size){alert("Nenhum baralho válido foi selecionado.");return;}
    $("#multiConfigTitle").textContent=label;$("#multiConfigMeta").textContent=`${state.decks.size} ${state.decks.size===1?"baralho":"baralhos"} · ${state.cards.length} ${state.cards.length===1?"flashcard":"flashcards"}`;
    $("#multiOnlyNew").checked=false;$("#multiOnlyDue").checked=false;$("#multiRedo").checked=false;document.querySelectorAll('input[name="multiRedoMode"]').forEach(r=>r.checked=r.value==="reset");$("#multiRedoOptions").classList.add("hidden");$("#multiNormalFilters").classList.remove("is-disabled");$("#multiOnlyNew").disabled=false;$("#multiOnlyDue").disabled=false;$("#multiRepeatRow").classList.remove("hidden");$("#multiAll").checked=true;$("#multiCount").disabled=true;$("#multiShuffle").checked=true;$("#multiRepeat").checked=false;$("#multiTimerEnabled").checked=false;state.redoMode="none";updateConfig();showView("multiStudyConfig");
  }
  async function quickEdit(){const e=current();if(!state.active||!state.revealed||!e||state.quickEditing)return;const card=await OituDB.getCard(e.card.id);if(!card)return;state.quickEditing=true;state.quickEditWasPaused=state.timerPaused||!state.timerEnabled;if(state.timerEnabled&&!state.timerPaused)toggleTimer();OituEditor.setEditors(card.frontHtml,card.backHtml);$("#cardModalTitle").textContent="Editar flashcard";$("#createCardActions").classList.add("hidden");$("#editCardActions").classList.remove("hidden");$("#cardModal").classList.remove("hidden");document.body.style.overflow="hidden";}
  async function closeQuick(save){if(!state.quickEditing)return;const e=current();if(save&&e){const f=OituEditor.editorFor("front"),b=OituEditor.editorFor("back");if(!OituEditor.hasContent(f)||!OituEditor.hasContent(b)){alert('O campo "Frente" ou "Verso" está vazio!');return;}const patch={frontHtml:OituEditor.sanitizeHtml(f.innerHTML),backHtml:OituEditor.sanitizeHtml(b.innerHTML)};await OituDB.updateCard(e.card.id,patch);state.cards.forEach(c=>{if(c.id===e.card.id)Object.assign(c,patch)});state.queue.forEach(q=>{if(q.card.id===e.card.id)Object.assign(q.card,patch)});if(window.OituMedia?.setHtml){window.OituMedia.setHtml($("#multiFront"),e.card.frontHtml);window.OituMedia.setHtml($("#multiBack"),e.card.backHtml);}else{$("#multiFront").innerHTML=e.card.frontHtml;$("#multiBack").innerHTML=e.card.backHtml;}showBack(true);}$("#cardModal").classList.add("hidden");OituEditor.resetEditors();state.quickEditing=false;if(state.timerEnabled&&!state.quickEditWasPaused)toggleTimer();}
  function bind(){
    $("#multiConfigForm").addEventListener("submit",start);$("#multiBackHome").addEventListener("click",home);$("#multiCancel").addEventListener("click",home);$("#multiOnlyNew").addEventListener("change",e=>{if(e.target.checked)$("#multiOnlyDue").checked=false;updateConfig();});$("#multiOnlyDue").addEventListener("change",e=>{if(e.target.checked)$("#multiOnlyNew").checked=false;updateConfig();});$("#multiRedo").addEventListener("change",updateRedoUI);document.querySelectorAll('input[name="multiRedoMode"]').forEach(r=>r.addEventListener("change",updateRedoUI));$("#multiAll").addEventListener("change",e=>{$("#multiCount").disabled=e.target.checked;updateConfig();});$("#multiCard").addEventListener("click",()=>{if(state.active&&!state.revealed&&!state.quickEditing)showBack(true)});$("#multiPrev").addEventListener("click",()=>navigate(-1));$("#multiNextArrow").addEventListener("click",()=>navigate(1));$("#multiTimer").addEventListener("click",toggleTimer);$("#multiRatings").addEventListener("click",e=>{const b=e.target.closest("[data-multi-rating]");if(b)complete(b.dataset.multiRating)});$("#multiEdit").addEventListener("click",quickEdit);$("#multiExit").addEventListener("click",()=>{if(!window.confirm("Encerrar este estudo agora?"))return;openConfig(state.deckIds,state.label)});$("#multiAgain").addEventListener("click",()=>openConfig(state.deckIds,state.label));$("#multiHome").addEventListener("click",home);
    document.addEventListener("keydown",e=>{if(!state.active||state.quickEditing||!$("#multiStudyView").classList.contains("active"))return;if(e.code==="Space"){e.preventDefault();if(!state.revealed)showBack(true);return;}if(e.key==="ArrowLeft"){e.preventDefault();navigate(-1);return;}if(e.key==="ArrowRight"){e.preventDefault();navigate(1);return;}if(!state.revealed)return;if(state.redoMode==="keep"){if(e.key==="0"){e.preventDefault();complete("repeat");}return;}const map={"0":"repeat","1":"hard","2":"medium","3":"good","4":"easy"};if(map[e.key]){e.preventDefault();complete(map[e.key]);}});
    document.addEventListener("click",e=>{if(!state.quickEditing)return;const a=e.target.closest("[data-card-action]");const x=e.target.closest('[data-close-modal="cardModal"]');if(!a&&!x)return;e.preventDefault();e.stopImmediatePropagation();if(x||a?.dataset.cardAction==="cancel")closeQuick(false);else if(a?.dataset.cardAction==="save-edit")closeQuick(true);},true);
  }
  function init(){ensureUI();bind();}
  window.OituMultiStudy={openConfig};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
