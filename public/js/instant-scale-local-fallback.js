(function () {
  if (window.__oitucardsInstantScaleLocalFallback) return;
  window.__oitucardsInstantScaleLocalFallback = true;

  const STATS_KEY = "OituCardsDeckStatsV3";
  const api = window.OituInstantScale;
  if (!api?.statFor || !api?.reconcileDeck) return;

  const empty = () => ({ total: 0, studied: 0, due: 0, nextFutureAt: null, updatedAt: Date.now() });
  let rawCache = null;
  let cache = new Map();
  const queued = new Set();
  const queue = [];
  let active = 0;
  let renderTimer = null;
  const MAX_CONCURRENCY = 4;

  function refreshCache() {
    let raw = "{}";
    try { raw = localStorage.getItem(STATS_KEY) || "{}"; } catch (_) {}
    if (raw === rawCache) return;
    rawCache = raw;
    try {
      const parsed = JSON.parse(raw);
      cache = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? new Map(Object.entries(parsed))
        : new Map();
    } catch (_) {
      cache = new Map();
    }
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const render = window.OituInstantScale?.getOriginalLibraryRender?.() || window.OituLibrary?.render;
      if (typeof render === "function" && document.querySelector("#homeView.active")) {
        Promise.resolve(render()).catch(() => {});
      }
    }, 80);
  }

  function pump() {
    while (active < MAX_CONCURRENCY && queue.length) {
      const deckId = queue.shift();
      active += 1;
      Promise.resolve(api.reconcileDeck(deckId))
        .then(() => {
          rawCache = null;
          refreshCache();
          scheduleRender();
        })
        .catch(() => {})
        .finally(() => {
          active = Math.max(0, active - 1);
          queued.delete(deckId);
          pump();
        });
    }
  }

  function reconcileLater(deckId) {
    if (!deckId || queued.has(deckId)) return;
    queued.add(deckId);
    queue.push(deckId);
    if (typeof requestIdleCallback === "function") requestIdleCallback(pump, { timeout: 250 });
    else setTimeout(pump, 0);
  }

  api.statFor = async function (deckId) {
    if (!deckId) return empty();
    refreshCache();
    const value = cache.get(deckId);
    if (!value) {
      reconcileLater(deckId);
      return empty();
    }
    const nextAt = Number(value.nextFutureAt);
    if (Number.isFinite(nextAt) && nextAt <= Date.now()) reconcileLater(deckId);
    return { ...value };
  };
})();
