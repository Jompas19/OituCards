(function () {
  if (window.__oitucardsInstantScaleLocalFallback) return;
  window.__oitucardsInstantScaleLocalFallback = true;

  const STATS_KEY = "OituCardsDeckStatsV3";
  const api = window.OituInstantScale;
  if (!api?.statFor || !api?.reconcileDeck) return;

  const previousStatFor = api.statFor.bind(api);
  const empty = () => ({ total: 0, studied: 0, due: 0, nextFutureAt: null, updatedAt: Date.now() });

  function hasPersistedStat(deckId) {
    try {
      const parsed = JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
      return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed[deckId]);
    } catch (_) {
      return false;
    }
  }

  api.statFor = async function (deckId) {
    if (!deckId) return empty();
    if (hasPersistedStat(deckId)) return previousStatFor(deckId);
    return api.reconcileDeck(deckId).catch(() => empty());
  };
})();