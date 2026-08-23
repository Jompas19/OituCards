(function () {
  function loadModule(src, dataAttribute, errorMessage) {
    if (document.querySelector(`script[${dataAttribute}]`)) return;

    const script = document.createElement("script");
    script.async = false;
    script.src = src;
    script.setAttribute(dataAttribute, "true");
    script.onerror = () => console.error(errorMessage);
    document.body.appendChild(script);
  }

  loadModule(
    "js/study-next.js",
    "data-oitucards-study-next",
    "Não foi possível carregar o módulo de estudo atualizado."
  );

  loadModule(
    "js/import-anki-compat.js",
    "data-oitucards-import-anki-compat",
    "Não foi possível carregar a camada de compatibilidade com o Anki."
  );

  loadModule(
    "js/import.js",
    "data-oitucards-import",
    "Não foi possível carregar o importador de baralhos."
  );
})();
