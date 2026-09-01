(function () {
  if (window.__oitucardsLibraryPerformanceBootstrap) return;
  window.__oitucardsLibraryPerformanceBootstrap = true;

  const scripts = [
    ["js/instant-scale-fastpath.js?v=20260901-1925", "oitucardsInstantScaleFastpath"],
    ["js/library-summary-preinstall.js?v=20260901-1925", "oitucardsLibrarySummaryPreinstall"],
    ["js/library-entity-snapshot.js?v=20260901-1925", "oitucardsLibraryEntitySnapshot"],
    ["js/library-render-guard.js?v=20260901-1925", "oitucardsLibraryRenderGuard"],
    ["js/import-apkg-worker-client.js?v=20260901-1925", "oitucardsApkgWorkerClient"],
    ["js/library-performance-extras.js?v=20260901-1925", "oitucardsLibraryPerformanceExtras"]
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