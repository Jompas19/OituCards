(function () {
  if (window.__oitucardsLibraryRenderGuard) return;
  window.__oitucardsLibraryRenderGuard = true;

  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "OituLibrary");
  let fallbackValue = previousDescriptor?.value;

  function guardApi(api) {
    if (!api || typeof api !== "object" || api.__oitucardsRenderGuarded) return api;
    const original = typeof api.render === "function" ? api.render.bind(api) : null;
    if (!original) return api;

    let current = original;
    try {
      Object.defineProperty(api, "render", {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(next) {
          const source = String(next || "");
          if (/getAllCardMetas|librarySnapshot|syncBadges/.test(source)) {
            current = original;
            return;
          }
          current = typeof next === "function" ? next : original;
        }
      });
      Object.defineProperty(api, "__oitucardsRenderGuarded", { configurable: true, value: true });
    } catch (_) {}
    return api;
  }

  try {
    Object.defineProperty(window, "OituLibrary", {
      configurable: true,
      enumerable: true,
      get() {
        if (previousDescriptor?.get) return guardApi(previousDescriptor.get.call(window));
        return guardApi(fallbackValue);
      },
      set(value) {
        if (previousDescriptor?.set) previousDescriptor.set.call(window, value);
        else fallbackValue = value;
        guardApi(value);
      }
    });
  } catch (_) {}
})();