(function () {
  if (window.__oitucardsImportWorkerVersionGuard || typeof window.Worker !== "function") return;
  window.__oitucardsImportWorkerVersionGuard = true;
  const NativeWorker = window.Worker;
  window.Worker = new Proxy(NativeWorker, {
    construct(target, args, newTarget) {
      const next = [...args];
      const raw = String(next[0] || "");
      if (raw.includes("import-apkg-stream-worker.js")) {
        const separator = raw.includes("?") ? "&" : "?";
        next[0] = `${raw}${separator}ocv=20260901-2340`;
      }
      return Reflect.construct(target, next, newTarget === window.Worker ? target : newTarget);
    }
  });
})();
