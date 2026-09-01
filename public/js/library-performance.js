(function () {
  if (window.__oitucardsLibraryPerformanceBootstrap) return;
  window.__oitucardsLibraryPerformanceBootstrap = true;

  const scripts = [
    ["js/instant-scale-fastpath.js?v=20260901-1635", "oitucardsInstantScaleFastpath"],
    ["js/library-render-guard.js?v=20260901-1635", "oitucardsLibraryRenderGuard"],
    ["js/library-performance-extras.js?v=20260901-1635", "oitucardsLibraryPerformanceExtras"]
  ];

  if (document.readyState === "loading") {
    for (const [src, key] of scripts) {
      if (document.querySelector(`script[data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}]`)) continue;
      document.write(`<script src="${src}" data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="true"><\/script>`);
    }
    return;
  }

  for (const [src, key] of scripts) {
    const attr = `data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
    if (document.querySelector(`script[${attr}]`)) continue;
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.setAttribute(attr, "true");
    document.head.appendChild(script);
  }
})();