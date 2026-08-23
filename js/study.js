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
    startedAt: null,
    revealed: false,
    sessionActive: false
  };

  const $ = (selector) => document.querySelector(selector);

  const studyMarkup = `
    <section id="studyConfigView" class="view">
      <div class="breadcrumb">
        <button id="studyConfigBackButton" class="link-button" type="button">← Meus baralhos</button>
      </div>
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
            <div><span class="study-setting-title">Deseja ativar o temporizador?</span><span class="study-setting-help">Mostra o tempo decorrido durante a sessão.</span></div>
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
        <div class="study-session-status"><span id="studyTimer" class="study-timer hidden">00:00</span><span id="studyProgress" class="study-progress">0/0</span></div>
      </div>
      <div id="studyWorkspace" class="study-workspace">
        <button id="studyPrevButton" class="study-nav-button" type="button" aria-label="Flashcard anterior" title="Flashcard anterior">←</button>
        <div class="study-card-column">
          <article id="studyCard" class="study-card" tabindex="0" aria-label="Flashcard. Clique ou pressione espaço para revelar a resposta.">
            <div class="study-face-label">Frente</div>
            <div id="studyFront" class="study-card-content"></div>
            <div id="studyRevealHint" class="study-reveal-hint">Clique no card ou pressione espaço para revelar o verso</div>
            <div id="studyBackSection" class="study-back-section hidden"><div class="study-divider"></div><div class="study-face-label">Verso</div><div id="studyBack" class="study-card-content"></div></div>
          </article>
          <div id="studyRatingArea" class="study-rating-area hidden">
            <button id="ratingRepeat" class="rating-button rating-repeat hidden" type="button" data-rating="repeat"><span class="rating-key">0</span>Embaralhe novamente</button>
            <button class="rating-button rating-hard" type="button" data-rating="hard"><span class="rating-key">1</span>Difícil</button>
            <button class="rating-button rating-medium" type="button" data-rating="medium"><span class="rating-key">2</span>Médio</button>
            <button class="rating-button rating-good" type="button" data-rating="good"><span class="rating-key">3</span>Bom</button>
            <button class="rating-button rating-easy" type="button" data-rating="easy"><span class="rating-key">4</span>Fácil</button>
          </div>
        </div>
        <button id="studyNextButton" class="study-nav-button" type="button" aria-label="Próximo flashcard" title="Próximo flashcard">→</button>
      </div>
      <div id="studyComplete" class="study-complete hidden">
        <div class="empty-icon">✓</div><p class="eyebrow">Sessão concluída</p><h1>Estudo finalizado</h1><p id="studyCompleteText" class="subtitle"></p>
        <div class="study-complete-actions"><button id="studyAgainButton" class="button primary" type="button">Novo estudo</button><button id="studyHomeButton" class="button secondary" type="button">Voltar aos baralhos</button></div>
      </div>
    </section>`;

  const studyStyles = `.study-config-wrap{width:min(760px,100%);margin:0 auto}.study-config-heading{margin-bottom:22px}.study-config-heading h1{margin:4px 0 7px;font-size:clamp(2rem,5vw,3rem);letter-spacing:-.045em}.study-config-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm);overflow:hidden}.study-setting{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:21px 22px;border-bottom:1px solid var(--line)}.study-setting-title{display:block;font-weight:800;color:var(--text)}.study-setting-help{display:block;margin:5px 0 0;color:var(--muted);font-size:.88rem;line-height:1.45}.study-quantity-controls{display:flex;align-items:center;gap:12px;flex-shrink:0}.study-count-input{width:104px}.check-option{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;color:var(--text);font-weight:700}.switch-input{appearance:none;width:46px;height:26px;border-radius:999px;background:var(--surface-2);border:1px solid var(--line);position:relative;cursor:pointer;flex:0 0 auto}.switch-input::after{content:"";position:absolute;width:20px;height:20px;left:2px;top:2px;border-radius:999px;background:var(--surface);box-shadow:0 1px 4px rgba(0,0,0,.2);transition:transform .16s ease}.switch-input:checked{background:var(--primary);border-color:var(--primary)}.switch-input:checked::after{transform:translateX(20px)}.study-config-card .notice{margin:18px 22px 0}.study-config-actions{display:flex;gap:9px;padding:22px}.study-session-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.study-session-status{display:flex;align-items:center;gap:10px;font-variant-numeric:tabular-nums}.study-timer,.study-progress{display:inline-flex;min-height:34px;align-items:center;justify-content:center;padding:0 11px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:.84rem;font-weight:800}.study-workspace{display:grid;grid-template-columns:52px minmax(0,760px) 52px;justify-content:center;align-items:center;gap:15px}.study-card-column{min-width:0}.study-nav-button{width:48px;height:48px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--text);font-size:1.25rem;cursor:pointer;box-shadow:var(--shadow-sm)}.study-nav-button:disabled{opacity:.3;cursor:default;box-shadow:none}.study-card{min-height:390px;display:flex;flex-direction:column;justify-content:center;padding:clamp(24px,5vw,48px);border:1px solid var(--line);border-radius:24px;background:var(--surface);box-shadow:var(--shadow);cursor:pointer;outline:0;user-select:text}.study-face-label{margin-bottom:11px;color:var(--muted);font-size:.72rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.study-card-content{color:var(--text);font-size:clamp(1.08rem,2.4vw,1.42rem);line-height:1.62;overflow-wrap:anywhere}.study-card-content img{display:block;max-width:100%;max-height:430px;object-fit:contain;margin:16px auto;border-radius:12px}.study-divider{height:1px;background:var(--line);margin:28px 0}.study-reveal-hint{margin-top:28px;color:var(--muted);font-size:.78rem;text-align:center}.study-rating-area{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:15px}.rating-button{min-height:52px;border:0;border-radius:12px;padding:8px 9px;color:#fff;font-weight:800;cursor:pointer}.rating-repeat{background:#374151}.rating-hard{background:#b91c1c}.rating-medium{background:#d6a91b;color:#171717}.rating-good{background:#39a76b}.rating-easy{background:#75a9ed}.rating-key{display:inline-grid;place-items:center;min-width:22px;height:22px;margin-right:6px;border-radius:7px;background:rgba(255,255,255,.18);font-size:.72rem}.study-complete{width:min(620px,100%);margin:70px auto 0;padding:52px 28px;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm)}.study-complete-actions{display:flex;justify-content:center;gap:9px;margin-top:22px;flex-wrap:wrap}@media(max-width:760px){.study-setting{align-items:flex-start;flex-direction:column}.check-setting{flex-direction:row;align-items:center}.study-quantity-controls{width:100%;justify-content:space-between}.study-workspace{grid-template-columns:1fr}.study-nav-button{position:fixed;bottom:18px;z-index:25;width:44px;height:44px}#studyPrevButton{left:16px}#studyNextButton{right:16px}.study-card{min-height:360px;padding:25px 20px}.study-rating-area{grid-template-columns:repeat(2,minmax(0,1fr));padding-bottom:58px}.rating-repeat{grid-column:1/-1}}`;

  function injectUI(){if(!$("#studyConfigView")){const main=document.querySelector("main.shell");if(!main)return false;main.insertAdjacentHTML("beforeend",studyMarkup)}if(!$("#oitucardsStudyStyles")){const style=document.createElement("style");style.id="oitucardsStudyStyles";style.textContent=studyStyles;document.head.appendChild(style)}return true}
  function showView(name){document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));$(`#${name}View`)?.classList.add("active");window.scrollTo({top:0,behavior:"instant"})}
  function goHome(){stopTimer();state.sessionActive=false;$("#homeButton")?.click()}
  function shuffle(a){const c=[...a];for(let i=c.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[c[i],c[j]]=[c[j],c[i]]}return c}
  function formatElapsed(ms){const t=Math.max(0,Math.floor(ms/1000)),m=Math.floor(t/60),s=t%60;return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`}
  function stopTimer(){if(state.timerId){clearInterval(state.timerId);state.timerId=null}}
  function startTimer(){stopTimer();const timer=$("#studyTimer");if(!state.timerEnabled){timer.classList.add("hidden");return}state.startedAt=Date.now();timer.textContent="00:00";timer.classList.remove("hidden");state.timerId=setInterval(()=>timer.textContent=formatElapsed(Date.now()-state.startedAt),1000)}
  function updateProgress(){$("#studyProgress").textContent=`${state.completedOriginalIds.size}/${state.totalOriginal}`}
  function setBackVisible(v){state.revealed=v;$("#studyBackSection").classList.toggle("hidden",!v);$("#studyRatingArea").classList.toggle("hidden",!v);$("#studyRevealHint").classList.toggle("hidden",v)}
  function currentEntry(){return state.queue[state.currentIndex]||null}
  function renderCurrent(){const e=currentEntry();if(!e){finishStudy();return}$("#studyFront").innerHTML=e.card.frontHtml||"";$("#studyBack").innerHTML=e.card.backHtml||"";$("#ratingRepeat").classList.toggle("hidden",!state.allowReview);setBackVisible(false);updateProgress();$("#studyPrevButton").disabled=state.currentIndex<=0;$("#studyNextButton").disabled=state.currentIndex>=state.queue.length-1;$("#studyCard").focus({preventScroll:true})}
  function revealCurrent(){if(state.sessionActive&&currentEntry()&&!state.revealed)setBackVisible(true)}
  function navigate(delta){if(!state.sessionActive)return;const t=state.currentIndex+delta;if(t<0||t>=state.queue.length)return;state.currentIndex=t;renderCurrent()}
  function scheduleRepeat(entry){const gap=3+Math.floor(Math.random()*4),i=Math.min(state.queue.length,state.currentIndex+gap+1);state.queue.splice(i,0,{card:entry.card,isRepeat:true,done:false,nonce:crypto.randomUUID()})}
  async function persistRating(card,rating){const now=new Date().toISOString(),prev=Array.isArray(card.ratingHistory)?card.ratingHistory:[],patch={reviewStatus:rating,lastRating:rating,lastReviewedAt:now,ratingHistory:[...prev,{rating,at:now}].slice(-100)};await OituDB.updateCard(card.id,patch);Object.assign(card,patch)}
  function findNextPendingIndex(after){for(let i=after+1;i<state.queue.length;i++)if(!state.queue[i].done)return i;for(let i=0;i<=after;i++)if(!state.queue[i].done)return i;return-1}
  async function rateCurrent(rating){const e=currentEntry();if(!state.sessionActive||!state.revealed||!e)return;if(rating==="repeat"&&!state.allowReview)return;if(!state.completedOriginalIds.has(e.card.id))state.completedOriginalIds.add(e.card.id);e.done=true;if(rating==="repeat")scheduleRepeat(e);try{await persistRating(e.card,rating)}catch(err){console.error(err)}updateProgress();const n=findNextPendingIndex(state.currentIndex);if(n===-1){finishStudy();return}state.currentIndex=n;renderCurrent()}
  function finishStudy(){state.sessionActive=false;stopTimer();$("#studyWorkspace").classList.add("hidden");$("#studyComplete").classList.remove("hidden");updateProgress();const elapsed=state.startedAt?formatElapsed(Date.now()-state.startedAt):null,suffix=state.timerEnabled&&elapsed?` em ${elapsed}`:"";$("#studyCompleteText").textContent=`Você concluiu ${state.totalOriginal} ${state.totalOriginal===1?"flashcard":"flashcards"}${suffix}.`}
  function resetStudyUI(){$("#studyWorkspace").classList.remove("hidden");$("#studyComplete").classList.add("hidden");$("#studyTimer").classList.toggle("hidden",!state.timerEnabled)}
  async function openConfig(deckId){stopTimer();state.sessionActive=false;state.deckId=deckId;state.deck=await OituDB.getDeck(deckId);state.allCards=await OituDB.getCardsByDeck(deckId);if(!state.deck){alert("Baralho não encontrado.");goHome();return}$("#studyConfigDeckTitle").textContent=state.deck.name;$("#studyConfigDeckMeta").textContent=`${state.allCards.length} ${state.allCards.length===1?"flashcard":"flashcards"} neste baralho`;const has=state.allCards.length>0;$("#studyConfigEmptyNotice").classList.toggle("hidden",has);$("#startStudyButton").disabled=!has;$("#studyAllCheckbox").checked=true;$("#studyCountInput").value=has?state.allCards.length:"";$("#studyCountInput").max=has?String(state.allCards.length):"1";$("#studyCountInput").disabled=true;$("#studyShuffleCheckbox").checked=false;$("#studyReviewCheckbox").checked=false;$("#studyTimerCheckbox").checked=false;showView("studyConfig")}
  async function startStudyFromConfig(event){event.preventDefault();state.allCards=await OituDB.getCardsByDeck(state.deckId);if(!state.allCards.length){alert("Este baralho ainda não possui flashcards.");return}const all=$("#studyAllCheckbox").checked,requested=all?state.allCards.length:Number.parseInt($("#studyCountInput").value,10);if(!Number.isInteger(requested)||requested<1||requested>state.allCards.length){alert(`Digite uma quantidade entre 1 e ${state.allCards.length}.`);$("#studyCountInput").focus();return}const source=$("#studyShuffleCheckbox").checked?shuffle(state.allCards):[...state.allCards];state.queue=source.slice(0,requested).map(card=>({card,isRepeat:false,done:false,nonce:crypto.randomUUID()}));state.currentIndex=0;state.totalOriginal=requested;state.completedOriginalIds=new Set();state.allowReview=$("#studyReviewCheckbox").checked;state.timerEnabled=$("#studyTimerCheckbox").checked;state.revealed=false;state.sessionActive=true;state.startedAt=null;resetStudyUI();showView("study");startTimer();updateProgress();renderCurrent()}
  function confirmExitStudy(){if(!state.sessionActive){openConfig(state.deckId);return}if(!window.confirm("Encerrar este estudo agora? O progresso desta sessão será interrompido."))return;stopTimer();state.sessionActive=false;openConfig(state.deckId)}
  function bindEvents(){$("#studyConfigForm").addEventListener("submit",startStudyFromConfig);$("#studyConfigBackButton").addEventListener("click",goHome);$("#cancelStudyConfigButton").addEventListener("click",goHome);$("#studyAllCheckbox").addEventListener("change",e=>{const c=e.target.checked;$("#studyCountInput").disabled=c;if(c)$("#studyCountInput").value=state.allCards.length||"";else{$("#studyCountInput").focus();$("#studyCountInput").select()}});$("#studyCountInput").addEventListener("input",()=>{const v=Number.parseInt($("#studyCountInput").value,10);if(Number.isInteger(v)&&v>state.allCards.length)$("#studyCountInput").value=state.allCards.length});$("#studyCard").addEventListener("click",revealCurrent);$("#studyPrevButton").addEventListener("click",()=>navigate(-1));$("#studyNextButton").addEventListener("click",()=>navigate(1));$("#exitStudyButton").addEventListener("click",confirmExitStudy);$("#studyRatingArea").addEventListener("click",e=>{const b=e.target.closest("[data-rating]");if(b)rateCurrent(b.dataset.rating)});$("#studyAgainButton").addEventListener("click",()=>openConfig(state.deckId));$("#studyHomeButton").addEventListener("click",goHome);document.addEventListener("keydown",e=>{if(!state.sessionActive||!$("#studyView").classList.contains("active"))return;const tag=document.activeElement?.tagName;if(["INPUT","TEXTAREA","SELECT"].includes(tag))return;if(e.code==="Space"){e.preventDefault();revealCurrent();return}if(e.key==="ArrowLeft"){e.preventDefault();navigate(-1);return}if(e.key==="ArrowRight"){e.preventDefault();navigate(1);return}if(!state.revealed)return;const map={"0":"repeat","1":"hard","2":"medium","3":"good","4":"easy"},r=map[e.key];if(!r||(r==="repeat"&&!state.allowReview))return;e.preventDefault();rateCurrent(r)});document.addEventListener("click",e=>{const name=e.target.closest(".deck-name-button");if(!name)return;const row=name.closest("[data-deck-id]");if(!row)return;e.preventDefault();e.stopPropagation();openConfig(row.dataset.deckId)},true)}
  function init(){if(!injectUI())return;bindEvents()}
  window.OituStudy={openConfig};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
