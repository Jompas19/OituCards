# Carregamento dos módulos

Os módulos de estudo, estudo combinado, importação e organização da biblioteca são carregados diretamente pelo `index.html` com identificadores de versão nos assets.

Isso evita regressões causadas por cache de um `study.js` antigo e reduz o acoplamento entre funcionalidades independentes.
