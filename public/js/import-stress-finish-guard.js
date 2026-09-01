(function () {
  if (window.__oitucardsImportStressFinishGuard) return;
  window.__oitucardsImportStressFinishGuard = true;

  let skipNextRebuild = false;
  let wrapped = false;

  function wrapStatsRebuild() {
    const api = window.OituInstantScale;
    if (wrapped || !api?.rebuildAllStats) return false;
    wrapped = true;
    const previous = api.rebuildAllStats.bind(api);
    api.rebuildAllStats = async function (...args) {
      if (skipNextRebuild) {
        skipNextRebuild = false;
        return true;
      }
      return previous(...args);
    };
    return true;
  }

  function inspectStatus() {
    const status = document.getElementById("importStatus");
    const text = String(status?.textContent || "");
    if (/cards importados em .*mídias processadas/i.test(text)) skipNextRebuild = true;
  }

  function init() {
    wrapStatsRebuild();
    const status = document.getElementById("importStatus");
    if (status) {
      new MutationObserver(inspectStatus).observe(status, { childList: true, characterData: true, subtree: true });
      inspectStatus();
    }
    [0, 100, 400].forEach((delay) => setTimeout(wrapStatsRebuild, delay));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();