(function () {
  const LOGO_CHUNKS = [
    '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',
    'rkJggg=='
  ];
  const LOGO_SRC = `data:image/png;base64,${LOGO_CHUNKS.join("")}`;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let folderProgressRun = 0;
  let decorateQueued = false;

  function ensureStyles() {
    if (document.querySelector('link[data-oitucards-visual-refinement-css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/visual-refinement.css?v=20260823-1403";
    link.dataset.oitucardsVisualRefinementCss = "true";
    document.head.appendChild(link);
  }

  function installLogo() {
    const button = $("#homeButton.brand-button");
    if (!button) return;
    let logo = $(".brand-official-logo", button);
    if (!logo) {
      logo = document.createElement("img");
      logo.className = "brand-official-logo";
      logo.alt = "OituCards";
      logo.decoding = "async";
      logo.draggable = false;
      button.prepend(logo);
    }
    if (logo.src !== LOGO_SRC) logo.src = LOGO_SRC;
    button.title = "Voltar aos meus baralhos";
  }

  function helpText(row) {
    const help = row?.querySelector(".study-setting-help");
    return help?.textContent?.trim() || "";
  }

  function setTooltip(row, fallback) {
    if (!row) return;
    const text = helpText(row) || fallback || "";
    if (!text) return;
    row.dataset.visualHelp = text;
    row.classList.add("visual-help-row");
    if (!row.hasAttribute("tabindex")) row.tabIndex = 0;
  }

  function setTitle(row, text) {
    const title = row?.querySelector(".study-setting-title");
    if (title && title.textContent !== text) title.textContent = text;
  }

  function reorderForm(form, items) {
    if (!form || form.dataset.visualReordered === "true") return;
    items.filter(Boolean).forEach((item) => form.appendChild(item));
    form.dataset.visualReordered = "true";
  }

  function decorateOptionTooltips(root) {
    if (!root) return;
    $$(".study-filter-option,.redo-option", root).forEach((option) => {
      const small = option.querySelector("small");
      const text = small?.textContent?.trim();
      if (!text) return;
      option.dataset.visualHelp = text;
      option.classList.add("visual-option-help");
      option.tabIndex = 0;
    });
  }

  function setupQuantity({ inputId, allId, totalId }) {
    const input = $(`#${inputId}`);
    const all = $(`#${allId}`);
    if (!input || !all) return;
    const controls = input.closest(".study-quantity-controls");
    if (!controls) return;

    let visual = input.closest(".study-quantity-visual");
    if (!visual) {
      visual = document.createElement("div");
      visual.className = "study-quantity-visual";
      input.before(visual);
      visual.appendChild(input);
      visual.insertAdjacentHTML("beforeend", `<span class="study-quantity-slash" aria-hidden="true">/</span><span id="${totalId}" class="study-quantity-total">0</span>`);
    }

    const allLabel = all.closest("label");
    all.classList.add("study-all-radio");
    allLabel?.classList.add("study-all-choice");

    const sync = () => {
      input.disabled = false;
      const max = Number.parseInt(input.max, 10);
      const total = $(`#${totalId}`);
      if (total) total.textContent = Number.isInteger(max) && max >= 0 ? String(max) : "0";
    };

    if (!input.dataset.visualQuantityBound) {
      input.dataset.visualQuantityBound = "true";
      input.addEventListener("input", (event) => {
        if (event.isTrusted && all.checked) {
          all.checked = false;
          all.dispatchEvent(new Event("change", { bubbles: true }));
        }
        queueMicrotask(sync);
      });
      all.addEventListener("change", () => queueMicrotask(sync));
      ["change", "click"].forEach((name) => {
        controls.closest("form")?.addEventListener(name, () => setTimeout(sync, 0));
      });
    }
    sync();
  }

  function setupRedo({ checkboxId, optionsId, groupName }) {
    const checkbox = $(`#${checkboxId}`);
    const options = $(`#${optionsId}`);
    const row = checkbox?.closest(".redo-setting");
    if (!checkbox || !options || !row) return;

    checkbox.classList.add("visual-redo-checkbox-hidden");
    row.classList.add("visual-redo-trigger");
    row.setAttribute("role", "button");
    row.tabIndex = 0;

    if (!$(".visual-redo-chevron", row)) {
      const chevron = document.createElement("span");
      chevron.className = "visual-redo-chevron";
      chevron.textContent = "▾";
      chevron.setAttribute("aria-hidden", "true");
      row.appendChild(chevron);
    }

    const radios = $$(`input[name="${groupName}"]`, options);
    radios.forEach((radio) => radio.classList.add("visual-round-choice"));

    const setOpen = (open) => {
      row.classList.toggle("is-open", open);
      options.classList.toggle("visual-force-open", open);
      options.classList.toggle("visual-collapsed", !open);
      row.setAttribute("aria-expanded", String(open));
    };

    if (!row.dataset.visualRedoBound) {
      row.dataset.visualRedoBound = "true";
      const toggle = () => {
        const open = !row.classList.contains("is-open");
        if (open && !checkbox.checked) radios.forEach((radio) => { radio.checked = false; });
        setOpen(open);
      };
      row.addEventListener("click", (event) => {
        if (event.target === checkbox) return;
        toggle();
      });
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggle();
      });

      radios.forEach((radio) => {
        radio.addEventListener("pointerdown", () => { radio.dataset.wasChecked = String(radio.checked); });
        radio.addEventListener("click", () => {
          if (radio.dataset.wasChecked === "true") {
            radio.checked = false;
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
            setOpen(true);
            return;
          }
          if (!checkbox.checked) {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
          }
          setOpen(true);
        });
        radio.addEventListener("change", () => {
          if (radio.checked && !checkbox.checked) {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
          }
          setOpen(true);
        });
      });
    }

    const view = row.closest(".view");
    const isActive = Boolean(view?.classList.contains("active"));
    const wasActive = row.dataset.visualWasActive === "true";
    if (isActive && !wasActive && !checkbox.checked) {
      radios.forEach((radio) => { radio.checked = false; });
      setOpen(false);
    } else if (!checkbox.checked && row.classList.contains("is-open")) {
      radios.forEach((radio) => { radio.checked = false; });
    }
    row.dataset.visualWasActive = String(isActive);
  }

  function decorateSingleConfig() {
    const form = $("#studyConfigForm");
    if (!form) return;

    const filter = $("#studyNormalFilterSetting");
    const quantity = $("#studyCountInput")?.closest(".study-setting");
    const review = $("#studyReviewSettingRow");
    const shuffle = $("#studyShuffleCheckbox")?.closest(".study-setting");
    const timer = $("#studyTimerCheckbox")?.closest(".study-setting");
    const redo = $("#studyRedoCheckbox")?.closest(".redo-setting");
    const redoOptions = $("#studyRedoOptions");
    const notice = $("#studyConfigEmptyNotice");
    const actions = $(".study-config-actions", form);

    setTitle(filter, "O que você quer estudar agora?");
    setTitle(quantity, "Quantos flashcards você fará agora?");
    setTitle(review, "Permitir revisões no estudo atual");
    setTitle(shuffle, "Embaralhar os flashcards");
    setTitle(timer, "Ativar o temporizador");
    setTitle(redo, "Refazer baralho");

    setTooltip(filter, "Sem filtro, entram cards novos e revisões disponíveis hoje.");
    setTooltip(quantity, "Digite quantos cards deseja fazer ou marque Fazer todos.");
    setTooltip(review, "Permite recolocar um flashcard mais à frente nesta mesma sessão.");
    setTooltip(shuffle, "Quando desligado, segue a ordem de criação dos cards.");
    setTooltip(timer, "Mostra o tempo da sessão e permite pausar ou retomar pelo próprio contador.");
    setTooltip(redo, "Permite refazer todos os cards, reiniciando o progresso ou preservando a agenda atual.");

    setupQuantity({ inputId: "studyCountInput", allId: "studyAllCheckbox", totalId: "studyQuantityTotal" });
    setupRedo({ checkboxId: "studyRedoCheckbox", optionsId: "studyRedoOptions", groupName: "redoMode" });
    decorateOptionTooltips(form);

    $$("#studyOnlyNewCheckbox,#studyOnlyReviewCheckbox").forEach((input) => input.classList.add("visual-round-choice"));
    reorderForm(form, [filter, quantity, review, shuffle, timer, redo, redoOptions, notice, actions]);
  }

  function decorateMultiConfig() {
    const form = $("#multiConfigForm");
    if (!form) return;

    const filter = $("#multiNormalFilters");
    const quantity = $("#multiCount")?.closest(".study-setting");
    const review = $("#multiRepeatRow");
    const shuffle = $("#multiShuffle")?.closest(".study-setting");
    const timer = $("#multiTimerEnabled")?.closest(".study-setting");
    const redo = $("#multiRedo")?.closest(".redo-setting");
    const redoOptions = $("#multiRedoOptions");
    const notice = $("#multiEmpty");
    const actions = $(".study-config-actions", form);

    setTitle(filter, "O que você quer estudar agora?");
    setTitle(quantity, "Quantos flashcards você fará agora?");
    setTitle(review, "Permitir revisões no estudo atual");
    setTitle(shuffle, "Embaralhar os flashcards");
    setTitle(timer, "Ativar o temporizador");
    setTitle(redo, "Refazer baralho");

    setTooltip(filter, "Sem filtro, entram cards novos e revisões disponíveis hoje dos baralhos escolhidos.");
    setTooltip(quantity, "Digite quantos cards deseja fazer ou marque Fazer todos.");
    setTooltip(review, "Permite recolocar um flashcard mais à frente nesta mesma sessão.");
    setTooltip(shuffle, "Mistura cards de todos os baralhos selecionados.");
    setTooltip(timer, "Mostra o tempo da sessão e permite pausar ou retomar pelo próprio contador.");
    setTooltip(redo, "Permite refazer todos os cards escolhidos, reiniciando ou preservando o progresso.");

    setupQuantity({ inputId: "multiCount", allId: "multiAll", totalId: "multiQuantityTotal" });
    setupRedo({ checkboxId: "multiRedo", optionsId: "multiRedoOptions", groupName: "multiRedoMode" });
    decorateOptionTooltips(form);

    $$("#multiOnlyNew,#multiOnlyDue").forEach((input) => input.classList.add("visual-round-choice"));
    reorderForm(form, [filter, quantity, review, shuffle, timer, redo, redoOptions, notice, actions]);
  }

  function simplifyIntervalElement(element) {
    if (!element) return;
    const raw = element.textContent || "";
    if (!/revis[aã]o em/i.test(raw)) return;
    const simplified = raw
      .replace(/[()]/g, "")
      .replace(/revis[aã]o em\s*/i, "")
      .trim();
    if (simplified && simplified !== raw) element.textContent = simplified;
  }

  function simplifyIntervals() {
    [
      "#ratingHardInterval", "#ratingMediumInterval", "#ratingGoodInterval", "#ratingEasyInterval",
      "#multiHintHard", "#multiHintMedium", "#multiHintGood", "#multiHintEasy"
    ].forEach((selector) => simplifyIntervalElement($(selector)));
  }

  async function decorateFolderProgress() {
    if (!$("#homeView")?.classList.contains("active")) return;
    const run = ++folderProgressRun;
    try {
      const [folders, decks] = await Promise.all([OituDB.getFolders(), OituDB.getDecks()]);
      if (run !== folderProgressRun) return;
      const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
      const totalsByFolder = new Map(folders.map((folder) => [folder.id, { cards: 0, studied: 0 }]));
      decks.forEach((deck) => {
        const cards = Math.max(0, Number(deck.cardCount) || 0);
        const studied = Math.min(cards, Math.max(0, Number(deck.studiedCount) || 0));
        let folderId = deck.folderId || null;
        const seen = new Set();
        while (folderId && !seen.has(folderId)) {
          seen.add(folderId);
          const total = totalsByFolder.get(folderId);
          if (!total) break;
          total.cards += cards;
          total.studied += studied;
          folderId = foldersById.get(folderId)?.parentId || null;
        }
      });

      folders.forEach((folder) => {
        const row = document.querySelector(`[data-folder-id="${CSS.escape(folder.id)}"]`);
        if (!row) return;
        const total = totalsByFolder.get(folder.id) || { cards: 0, studied: 0 };
        const progress = total.cards ? Math.round((total.studied / total.cards) * 100) : 0;
        const main = $(".folder-main", row);
        if (!main) return;
        let progressLine = $(".folder-aggregate-progress", main);
        if (!progressLine) {
          progressLine = document.createElement("div");
          progressLine.className = "folder-aggregate-progress";
          main.appendChild(progressLine);
        }
        if (progressLine.dataset.progress !== String(progress)) {
          progressLine.dataset.progress = String(progress);
          progressLine.innerHTML = `<span>Progresso: ${progress}%</span><div class="progress-track" aria-label="Progresso agregado de ${progress}%"><div class="progress-bar" style="width:${progress}%"></div></div>`;
        }
      });
    } catch (error) {
      console.warn("OituCards: não foi possível calcular o progresso agregado das pastas.", error);
    }
  }

  function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => {
      decorateQueued = false;
      installLogo();
      decorateSingleConfig();
      decorateMultiConfig();
      simplifyIntervals();
      decorateFolderProgress();
    });
  }

  function observeApp() {
    const observer = new MutationObserver((mutations) => {
      let shouldDecorate = false;
      for (const mutation of mutations) {
        if (mutation.type === "childList" || (mutation.type === "attributes" && mutation.attributeName === "class")) {
          shouldDecorate = true;
          break;
        }
      }
      if (shouldDecorate) scheduleDecorate();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  function bindGlobalEvents() {
    document.addEventListener("change", (event) => {
      if (event.target.matches("#studyOnlyNewCheckbox,#studyOnlyReviewCheckbox,#studyAllCheckbox,#multiOnlyNew,#multiOnlyDue,#multiAll")) {
        setTimeout(scheduleDecorate, 0);
      }
    });
    document.addEventListener("input", (event) => {
      if (event.target.matches("#studyCountInput,#multiCount")) setTimeout(scheduleDecorate, 0);
    });
  }

  function init() {
    ensureStyles();
    installLogo();
    decorateSingleConfig();
    decorateMultiConfig();
    simplifyIntervals();
    decorateFolderProgress();
    bindGlobalEvents();
    observeApp();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
