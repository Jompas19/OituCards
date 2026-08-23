(function () {
  const script = document.createElement("script");
  script.src = "js/study-next.js";
  script.dataset.oitucardsStudyNext = "true";
  script.onerror = () => console.error("Não foi possível carregar o módulo de estudo atualizado.");
  document.body.appendChild(script);
})();
