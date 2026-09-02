(function () {
  if (window.__oitucardsStartupInstantGuard) return;
  window.__oitucardsStartupInstantGuard = true;

  const nativeIdle = typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback.bind(window)
    : null;
  const nativeTimeout = window.setTimeout.bind(window);

  function isGlobalCoverageRepair(callback) {
    if (typeof callback !== "function") return false;
    const source = String(callback);
    return /ensureCoverage\(\)/.test(source) && /rerenderAfterCoverage|indexação leve/.test(source);
  }

  if (nativeIdle) {
    window.requestIdleCallback = function (callback, options) {
      if (isGlobalCoverageRepair(callback)) return 0;
      return nativeIdle(callback, options);
    };
  }

  window.setTimeout = function (callback, delay, ...args) {
    if (isGlobalCoverageRepair(callback)) return 0;
    return nativeTimeout(callback, delay, ...args);
  };

  document.addEventListener("DOMContentLoaded", () => {
    queueMicrotask(() => {
      if (nativeIdle) window.requestIdleCallback = nativeIdle;
      window.setTimeout = nativeTimeout;
    });
  }, { once: true });
})();
