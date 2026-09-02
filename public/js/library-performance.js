(function () {
  if (window.__oitucardsLibraryPerformanceBootstrap) return;
  window.__oitucardsLibraryPerformanceBootstrap = true;

  const scripts = [
    ["js/startup-instant-guard.js?v=20260901-2340", "oitucardsStartupInstantGuard"],
    ["js/instant-scale-fastpath.js?v=20260901-2340", "oitucardsInstantScaleFastpath"],
    ["js/instant-scale-local-fallback.js?v=20260901-2340", "oitucardsInstantScaleLocalFallback"],
    ["js/library-summary-preinstall.js?v=20260901-2340", "oitucardsLibrarySummaryPreinstall"],
    ["js/library-entity-snapshot.js?v=20260901-2340", "oitucardsLibraryEntitySnapshot"],
    ["js/library-render-guard.js?v=20260901-2340", "oitucardsLibraryRenderGuard"],
    ["js/study-lazy-data-fast.js?v=20260901-2340", "oitucardsStudyLazyDataFast"],
    ["js/package-media-range.js?v=20260901-2340", "oitucardsPackageMediaRange"],
    ["js/import-worker-version-guard.js?v=20260901-2340", "oitucardsImportWorkerVersionGuard"],
    ["js/import-apkg-stream-client.js?v=20260901-2340", "oitucardsApkgStreamClient"],
    ["js/library-performance-extras.js?v=20260901-2340", "oitucardsLibraryPerformanceExtras"]
  ];

  const attrName = (key) => `data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;

  if (document.readyState === "loading") {
    for (const [src, key] of scripts) {
      const attr = attrName(key);
      if (document.querySelector(`script[${attr}]`)) continue;
      document.write(`<script src="${src}" ${attr}="true"><\/script>`);
    }
    return;
  }

  for (const [src, key] of scripts) {
    const attr = attrName(key);
    if (document.querySelector(`script[${attr}]`)) continue;
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.setAttribute(attr, "true");
    document.head.appendChild(script);
  }
})();