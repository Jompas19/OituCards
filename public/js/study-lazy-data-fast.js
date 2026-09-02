(function () {
  if (window.__oitucardsStudyLazyData) return;
  window.__oitucardsStudyLazyData = true;

  const cache = new Map();
  const inflight = new Map();
  let wrappedFunction = null;
  let ratingReplay = false;
  let keyReplay = false;

  function requestKind() {
    const stack = String(new Error().stack || "");
    if (/multi-study\.js/i.test(stack) || document.querySelector("#multiStudyConfigView.active,#multiStudyView.active")) return "multi";
    if (/study-next\.js/i.test(stack) || document.querySelector("#studyConfigView.active,#studyView.active")) return "single";
    return null;
  }

  function reviewCount(card) {
    if (Number.isInteger(card?.reviewCount) && card.reviewCount >= 0) return card.reviewCount;
    return card?.lastReviewedAt || card?.nextReviewAt || card?.lastRating ? 1 : 0;
  }

  function exactDueMeta(card) {
    if (!card?.nextReviewAt) return card;
    const unit = String(card.currentIntervalUnit || "").toLowerCase();
    if (!unit.includes("minute") && !unit.includes("hour") && unit !== "minutos" && unit !== "horas") return card;
    if (reviewCount(card) === 0 && !card.lastReviewedAt && !card.lastRating) return card;
    const due = new Date(card.nextReviewAt).getTime();
    if (!Number.isFinite(due)) return card;
    const now = Date.now();
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const endTime = end.getTime();
    if (due <= now || due > endTime) return card;
    return { ...card, nextReviewAt: new Date(endTime + 1000).toISOString() };
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function cleanFront(value, id) {
    return String(value || "")
      .replace(new RegExp(`^<!--oc-promote-card:${escapeRegExp(id)}-->`), "")
      .replace(new RegExp(`^<!--oc-card:${escapeRegExp(id)}-->`), "")
      .replace(new RegExp(`^<!--oc-lazy-front:${escapeRegExp(id)}-->`), "");
  }

  function markerFront(id, html) { return `<!--oc-promote-card:${id}-->${html}`; }
  function placeholderFront(id) { return `<!--oc-promote-card:${id}--><!--oc-lazy-front:${id}-->`; }
  function placeholderBack(id) { return `<!--oc-lazy-back:${id}-->`; }
  function fullContent(id) { return cache.get(id) || null; }

  function currentCardId() {
    const root = document.querySelector("#studyView.active #studyFront,#multiStudyView.active #multiFront");
    const html = String(root?.innerHTML || "");
    return html.match(/<!--oc-promote-card:([^>]+)-->/)?.[1] ||
      html.match(/<!--oc-card:([^>]+)-->/)?.[1] || null;
  }

  function updateMounted(id, full) {
    if (!full) return;
    const fronts = [document.getElementById("studyFront"), document.getElementById("multiFront")];
    const backs = [document.getElementById("studyBack"), document.getElementById("multiBack")];
    const frontNeedle = `<!--oc-lazy-front:${id}-->`;
    const backNeedle = `<!--oc-lazy-back:${id}-->`;

    fronts.forEach((root) => {
      if (!root || !String(root.innerHTML || "").includes(frontNeedle)) return;
      root.innerHTML = markerFront(id, cleanFront(full.frontHtml, id));
      window.OituScaleStorage?.hydrateElement?.(root);
    });
    backs.forEach((root) => {
      if (!root || !String(root.innerHTML || "").includes(backNeedle)) return;
      root.innerHTML = String(full.backHtml || "");
      window.OituScaleStorage?.hydrateElement?.(root);
    });
  }

  async function loadFullCard(id) {
    if (!id) return null;
    if (cache.has(id)) return cache.get(id);
    if (inflight.has(id)) return inflight.get(id);
    const promise = Promise.resolve(OituDB.getCard(id)).then((card) => {
      if (card) {
        cache.set(id, card);
        updateMounted(id, card);
      }
      return card || null;
    }).finally(() => inflight.delete(id));
    inflight.set(id, promise);
    return promise;
  }

  function makeLazyCard(meta) {
    const id = meta.id;
    let frontOverride = null;
    let backOverride = null;
    let historyOverride = null;
    const card = { ...exactDueMeta(meta), __oitucardsLazyCard: true };

    Object.defineProperties(card, {
      frontHtml: {
        enumerable: true,
        configurable: true,
        get() {
          if (frontOverride !== null) return markerFront(id, cleanFront(frontOverride, id));
          const full = fullContent(id);
          if (full) return markerFront(id, cleanFront(full.frontHtml, id));
          loadFullCard(id).catch(() => {});
          return placeholderFront(id);
        },
        set(value) {
          frontOverride = cleanFront(value, id);
          const full = fullContent(id);
          if (full) full.frontHtml = frontOverride;
        }
      },
      backHtml: {
        enumerable: true,
        configurable: true,
        get() {
          if (backOverride !== null) return backOverride;
          const full = fullContent(id);
          if (full) return String(full.backHtml || "");
          loadFullCard(id).catch(() => {});
          return placeholderBack(id);
        },
        set(value) {
          backOverride = String(value || "");
          const full = fullContent(id);
          if (full) full.backHtml = backOverride;
        }
      },
      ratingHistory: {
        enumerable: true,
        configurable: true,
        get() {
          if (historyOverride !== null) return historyOverride;
          const full = fullContent(id);
          return full && Array.isArray(full.ratingHistory) ? full.ratingHistory : [];
        },
        set(value) {
          historyOverride = Array.isArray(value) ? value : [];
          const full = fullContent(id);
          if (full) full.ratingHistory = historyOverride;
        }
      }
    });
    return card;
  }

  function prefetch(cards, kind) {
    if (kind !== "single" || !cards.length) return;
    setTimeout(() => {
      cards.slice(0, 3).forEach((card) => loadFullCard(card.id).catch(() => {}));
    }, 0);
  }

  async function studyCardsByDeck(deckId, baseReader, kind) {
    let metas = [];
    try { metas = await OituDB.getCardMetasByDeck?.(deckId) || []; }
    catch (_) { metas = []; }
    if (!metas.length) {
      const full = await baseReader(deckId);
      return Array.isArray(full) ? full : [];
    }
    const cards = metas.map(makeLazyCard);
    prefetch(cards, kind);
    return cards;
  }

  function installWrapper() {
    if (!window.OituDB?.getCardsByDeck || !window.OituDB?.getCardMetasByDeck) return false;
    const current = OituDB.getCardsByDeck;
    if (current === wrappedFunction) return true;
    const baseReader = current.bind(OituDB);
    const wrapped = async function (deckId, ...args) {
      const kind = requestKind();
      if (!kind) return baseReader(deckId, ...args);
      return studyCardsByDeck(deckId, baseReader, kind);
    };
    wrapped.__oitucardsStudyLazyData = true;
    wrappedFunction = wrapped;
    OituDB.getCardsByDeck = wrapped;
    return true;
  }

  function keepWrapperOutermost() {
    [0, 80, 220, 550, 1200, 2600].forEach((delay) => setTimeout(installWrapper, delay));
  }

  function clearOldCache() {
    if (cache.size <= 160) return;
    const ids = [...cache.keys()];
    ids.slice(0, cache.size - 120).forEach((id) => cache.delete(id));
  }

  async function ensureCurrentLoaded() {
    const id = currentCardId();
    if (!id || cache.has(id)) return true;
    await loadFullCard(id);
    return cache.has(id);
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("#homeButton,#studyHomeButton,#multiHome,#exitStudyButton,#multiExit")) setTimeout(clearOldCache, 0);
  }, true);

  document.addEventListener("click", (event) => {
    if (ratingReplay) return;
    const button = event.target.closest("[data-rating],[data-multi-rating]");
    if (!button || (!document.querySelector("#studyView.active") && !document.querySelector("#multiStudyView.active"))) return;
    const id = currentCardId();
    if (!id || cache.has(id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ensureCurrentLoaded().then((loaded) => {
      if (!loaded || !button.isConnected) return;
      ratingReplay = true;
      try { button.click(); }
      finally { ratingReplay = false; }
    }).catch(() => {});
  }, true);

  document.addEventListener("keydown", (event) => {
    if (keyReplay || !["0", "1", "2", "3", "4"].includes(event.key)) return;
    if (!document.querySelector("#studyView.active,#multiStudyView.active")) return;
    const id = currentCardId();
    if (!id || cache.has(id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ensureCurrentLoaded().then((loaded) => {
      if (!loaded) return;
      keyReplay = true;
      try {
        document.dispatchEvent(new KeyboardEvent("keydown", {
          key: event.key,
          code: event.code,
          bubbles: true,
          cancelable: true
        }));
      } finally { keyReplay = false; }
    }).catch(() => {});
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      installWrapper();
      keepWrapperOutermost();
    }, { once: true });
  } else {
    installWrapper();
    keepWrapperOutermost();
  }
})();
