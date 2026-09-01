(function () {
  if (window.__oitucardsLibrarySummaryPreinstall || !window.OituDB?.getCardsByDeck || !window.OituInstantScale?.statFor) return;
  window.__oitucardsLibrarySummaryPreinstall = true;

  const previous = OituDB.getCardsByDeck.bind(OituDB);

  function summaryProxy(stat) {
    const proxy = {
      __oitucardsSummaryProxy: true,
      length: Math.max(0, Number(stat?.total) || 0),
      filter(predicate) {
        const source = `${predicate?.name || ""} ${String(predicate || "")}`;
        if (/reviewStatus/.test(source)) return { length: Math.max(0, Number(stat?.studied) || 0) };
        if (/isDue|nextReviewAt|endToday/.test(source)) return { length: Math.max(0, Number(stat?.due) || 0) };
        return { length: 0 };
      },
      map() { return proxy; },
      forEach() {},
      slice() { return []; },
      [Symbol.iterator]: function* () {}
    };
    return proxy;
  }

  const wrapped = async function (deckId, ...args) {
    const stack = String(new Error().stack || "");
    if (/buildSummaries/.test(stack) && /library\.js/.test(stack)) {
      const stat = await OituInstantScale.statFor(deckId);
      return summaryProxy(stat);
    }
    return previous(deckId, ...args);
  };
  wrapped.__oitucardsInstantSummary = true;
  wrapped.__oitucardsPrevious = previous;
  OituDB.getCardsByDeck = wrapped;

  try {
    if (!localStorage.getItem("OituCardsDeckStatsV3")) {
      OituInstantScale.rebuildAllStats().catch(() => {});
    }
  } catch (_) {}
})();