(function () {
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
