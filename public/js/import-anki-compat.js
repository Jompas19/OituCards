(function () {
  function limitDeckPathComponent(value) {
    const text = String(value || "").trim();
    const duplicateSuffix = text.match(/ \(\d+\)$/);
    if (!duplicateSuffix) return String.prototype.__oitucardsOriginalSlice.call(text, 0, 120);

    const suffix = duplicateSuffix[0];
    const base = String.prototype.__oitucardsOriginalSlice.call(text, 0, -suffix.length);
    const available = Math.max(1, 120 - suffix.length);
    return `${String.prototype.__oitucardsOriginalSlice.call(base, 0, available)}${suffix}`;
  }

  function patchHierarchicalDeckNameLimit() {
    if (String.prototype.__oitucardsOriginalSlice) return;

    const originalSlice = String.prototype.slice;
    Object.defineProperty(String.prototype, "__oitucardsOriginalSlice", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: originalSlice
    });

    String.prototype.slice = function (start, end) {
      const value = String(this);
      if (start === 0 && end === 120 && value.includes("::")) {
        const stack = String(new Error().stack || "");
        if (stack.includes("getUniqueDeckName") || /import(?:\.min)?\.js/i.test(stack)) {
          return value
            .split("::")
            .map((part) => limitDeckPathComponent(part))
            .join("::");
        }
      }
      return originalSlice.apply(this, arguments);
    };
  }

  function patchJsZip(JSZip) {
    if (!JSZip || JSZip.__oitucardsModernAnkiPatched) return JSZip;

    const originalLoadAsync = JSZip.loadAsync.bind(JSZip);
    JSZip.loadAsync = async function (...args) {
      const zip = await originalLoadAsync(...args);
      if (!zip || zip.__oitucardsModernAnkiPatched) return zip;

      const originalFile = zip.file.bind(zip);
      zip.file = function (path, ...rest) {
        if (rest.length === 0 && path === "collection.21b") {
          return originalFile("collection.anki21b") || originalFile("collection.21b");
        }
        return originalFile(path, ...rest);
      };
      zip.__oitucardsModernAnkiPatched = true;
      return zip;
    };

    JSZip.__oitucardsModernAnkiPatched = true;
    return JSZip;
  }

  patchHierarchicalDeckNameLimit();

  if (window.JSZip) {
    window.JSZip = patchJsZip(window.JSZip);
    return;
  }

  let jsZipValue;
  try {
    Object.defineProperty(window, "JSZip", {
      configurable: true,
      enumerable: true,
      get() {
        return jsZipValue;
      },
      set(value) {
        jsZipValue = patchJsZip(value);
      }
    });
  } catch (_) {
    const timer = setInterval(() => {
      if (!window.JSZip) return;
      clearInterval(timer);
      window.JSZip = patchJsZip(window.JSZip);
    }, 50);
    setTimeout(() => clearInterval(timer), 15000);
  }
})();
