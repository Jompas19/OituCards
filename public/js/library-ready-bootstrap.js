(function () {
  if (window.__oitucardsLibraryBootstrapInstalled) return;
  window.__oitucardsLibraryBootstrapInstalled = true;

  let started = false;
  let observer = null;
  let fallbackTimer = null;

  function loadScript(src, marker, next) {
    const existing = document.querySelector(`script[${marker}]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') next?.();
      else existing.addEventListener('load', () => next?.(), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.async = false;
    script.src = src;
    script.setAttribute(marker, 'true');
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      next?.();
    }, { once: true });
    script.onerror = () => {
      console.error(`Não foi possível carregar ${src}.`);
      next?.();
    };
    document.body.appendChild(script);
  }

  function loadLibraryEnhancements() {
    loadScript('js/library-enhancements.js?v=20260823-1124', 'data-oitucards-library-enhancements');
  }

  function loadLibraryCore() {
    loadScript('js/library.js?v=20260823-1819', 'data-oitucards-library', loadLibraryEnhancements);
  }

  function loadHotfix() {
    loadScript('js/library-startup-hotfix.js?v=20260823-1819', 'data-oitucards-library-startup-hotfix', loadLibraryCore);
  }

  function start() {
    if (started) return;
    started = true;
    if (observer) observer.disconnect();
    clearTimeout(fallbackTimer);
    loadHotfix();
  }

  function watchPerformanceChain() {
    const startup = document.querySelector('script[data-oitucards-library-startup-optimizer]');
    if (startup) {
      if (startup.dataset.loaded === 'true') {
        start();
        return;
      }
      startup.addEventListener('load', start, { once: true });
      startup.addEventListener('error', start, { once: true });
      return;
    }

    observer = new MutationObserver(() => {
      const script = document.querySelector('script[data-oitucards-library-startup-optimizer]');
      if (!script) return;
      observer.disconnect();
      observer = null;
      if (script.dataset.loaded === 'true') start();
      else {
        script.addEventListener('load', start, { once: true });
        script.addEventListener('error', start, { once: true });
      }
    });
    observer.observe(document.body, { childList: true, subtree: false });

    fallbackTimer = setTimeout(start, 3500);
  }

  watchPerformanceChain();
})();
