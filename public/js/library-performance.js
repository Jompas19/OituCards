(function () {
  if (window.__oitucardsLibraryPerformanceBootstrap) return;
  window.__oitucardsLibraryPerformanceBootstrap = true;

  const scripts = [
    ["js/instant-scale-fastpath.js?v=20260901-2140", "oitucardsInstantScaleFastpath"],
    ["js/library-summary-preinstall.js?v=20260901-2140", "oitucardsLibrarySummaryPreinstall"],
    ["js/library-entity-snapshot.js?v=20260901-2140", "oitucardsLibraryEntitySnapshot"],
    ["js/library-render-guard.js?v=20260901-2140", "oitucardsLibraryRenderGuard"],
    ["js/package-media-storage.js?v=20260901-2140", "oitucardsPackageMediaStorage"],
    ["js/import-apkg-stream-client.js?v=20260901-2140", "oitucardsApkgStreamClient"],
    ["js/library-performance-extras.js?v=20260901-2140", "oitucardsLibraryPerformanceExtras"]
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