(function () {
  if (window.__oitucardsStudyLazyData) return;
  window.__oitucardsStudyLazyData = true;

  const PREFETCH_SEQUENTIAL = 8;
  const PREFETCH_SAMPLED = 8;
  const cache = new Map();
  const inflight = new Map();
  let wrappedFunction = null;
  let previousFunction = null;

  function isStudyRequest() {
    if (document.querySelector("#studyConfigView.active,#studyView.active,#multiStudyConfigView.active,#multiStudyView.active")) return true;
    const stack = String(new Error().stack || "");
    return /(?:study-next|multi-study)\.js/i.test(stack);
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

  function cleanFront(value, id) {
    return String(value || "")
      .replace(new RegExp(`^<!--oc-promote-card:${escapeRegExp(id)}-->`), "")
      .replace(new RegExp(`^<!--oc-card:${escapeRegExp(id)}-->`), "")
      .replace(new RegExp(`^<!--oc-lazy-front:${escapeRegExp(id)}-->`), "");
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function markerFront(id, html) {
    return `<!--oc-promote-card:${id}-->${html}`;
  }

  function placeholderFront(id) {
    return `<!--oc-promote-card:${id}--><!--oc-lazy-front:${id}-->`;
  }

  function placeholderBack(id) {
    return `<!--oc-lazy-back:${id}-->`;
  }

  function fullContent(id) {
    return cache.get(id) || null;
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
          if (full) return Array.isArray(full.ratingHistory) ? full.ratingHistory : [];
          loadFullCard(id).catch(() => {});
          return [];
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

  function prefetch(cards) {
    const ids = [];
    cards.slice(0, PREFETCH_SEQUENTIAL).forEach((card) => ids.push(card.id));
    if (cards.length > PREFETCH_SEQUENTIAL) {
      const step = Math.max(1, Math.floor(cards.length / PREFETCH_SAMPLED));
      for (let i = step - 1; i < cards.length && ids.length < PREFETCH_SEQUENTIAL + PREFETCH_SAMPLED; i += step) {
        ids.push(cards[i].id);
      }
    }
    [...new Set(ids)].forEach((id) => loadFullCard(id).catch(() => {}));
  }

  async function studyCardsByDeck(deckId) {
    let metas = [];
    try {
      metas = await OituDB.getCardMetasByDeck?.(deckId) || [];
    } catch (_) {
      metas = [];
    }

    if (!metas.length) {
      // Compatibilidade para bases antigas enquanto o índice leve é reconstruído uma única vez.
      const full = await previousFunction(deckId);
      return Array.isArray(full) ? full : [];
    }

    const cards = metas.map(makeLazyCard);
    prefetch(cards);
    return cards;
  }

  function installWrapper() {
    if (!window.OituDB?.getCardsByDeck || !window.OituDB?.getCardMetasByDeck) return false;
    const current = OituDB.getCardsByDeck;
    if (current === wrappedFunction) return true;

    previousFunction = current.bind(OituDB);
    const wrapped = async function (deckId, ...args) {
      if (!isStudyRequest()) return previousFunction(deckId, ...args);
      return studyCardsByDeck(deckId);
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

  document.addEventListener("click", (event) => {
    if (event.target.closest("#homeButton,#studyHomeButton,#multiHome,#exitStudyButton,#multiExit")) {
      setTimeout(clearOldCache, 0);
    }
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