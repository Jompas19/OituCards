(function () {
  const state = {
    currentDeckId: null,
    editingCardId: null,
    deckModalMode: "create",
    createDeckOrigin: "home",
    confirmHandler: null
  };

  const $ = (selector) => document.querySelector(selector);

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2400);
  }

  function showView(name) {
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    $(`#${name}View`).classList.add("active");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function openModal(id) {
    $(`#${id}`).classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    $(`#${id}`).classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) {
      document.body.style.overflow = "";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function askConfirmation(title, message, onConfirm) {
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    state.confirmHandler = onConfirm;
    openModal("confirmModal");
  }

  async function getDeckSummary(deck) {
    const cards = await OituDB.getCardsByDeck(deck.id);
    const studied = cards.filter((card) => card.reviewStatus).length;
    const progress = cards.length ? Math.round((studied / cards.length) * 100) : 0;
    return { deck, cards, studied, progress };
  }

  async function renderHome() {
    state.currentDeckId = null;
    showView("home");

    // A biblioteca com pastas é a interface final. Quando ela já está instalada,
    // evita desenhar a lista legada por um frame para substituí-la logo depois.
    if (window.OituLibrary?.render && $("#createFolderButton")) {
      await window.OituLibrary.render();
      return;
    }

    const decks = await OituDB.getDecks();
    const list = $("#deckList");
    const empty = $("#emptyState");

    if (!decks.length) {
      list.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }

    empty.classList.add("hidden");
    const summaries = await Promise.all(decks.map(getDeckSummary));

    list.innerHTML = summaries.map(({ deck, cards, progress }) => `
      <article class="deck-row" data-deck-id="${deck.id}">
        <div class="deck-main">
          <button class="deck-name-button" type="button" data-action="edit-deck">${escapeHtml(deck.name)}</button>
          <div class="deck-info">
            <span>${cards.length} ${cards.length === 1 ? "card" : "cards"}</span>
            <span>Progresso: ${progress}%</span>
          </div>
          <div class="progress-track" aria-label="Progresso de ${progress}%">
            <div class="progress-bar" style="width:${progress}%"></div>
          </div>
        </div>
        <div class="deck-actions">
          <button class="action-button icon-only" type="button" data-action="edit-deck" title="Editar baralho" aria-label="Editar baralho">✎</button>
          <button class="action-button icon-only delete" type="button" data-action="delete-deck" title="Apagar baralho" aria-label="Apagar baralho">🗑</button>
        </div>
      </article>
    `).join("");
  }

  async function openDeck(deckId) {
    const deck = await OituDB.getDeck(deckId);
    if (!deck) {
      showToast("Baralho não encontrado.");
      return renderHome();
    }

    state.currentDeckId = deckId;
    $("#deckTitle").textContent = deck.name;
    $("#cardSearchInput").value = "";
    showView("deck");
    await renderDeckCards();
  }

  async function renderDeckCards() {
    if (!state.currentDeckId) return;

    const deck = await OituDB.getDeck(state.currentDeckId);
    const cards = await OituDB.getCardsByDeck(state.currentDeckId);
    const query = $("#cardSearchInput").value.trim().toLowerCase();

    $("#deckTitle").textContent = deck?.name || "Baralho";
    $("#deckMeta").textContent = `${cards.length} ${cards.length === 1 ? "flashcard" : "flashcards"}`;

    const filtered = cards.filter((card) =>
      OituEditor.plainTextFromHtml(card.frontHtml).toLowerCase().includes(query)
    );

    const list = $("#cardList");
    const empty = $("#deckEmptyState");

    if (!cards.length) {
      list.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }

    empty.classList.add("hidden");

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state compact"><p>Nenhum flashcard corresponde à pesquisa.</p></div>`;
      return;
    }

    list.innerHTML = filtered.map((card, index) => `
      <article class="compact-card-row" data-card-id="${card.id}">
        <div class="card-number">${index + 1}</div>
        <div class="card-front-preview" title="${escapeHtml(OituEditor.plainTextFromHtml(card.frontHtml))}">
          ${escapeHtml(OituEditor.plainTextFromHtml(card.frontHtml))}
        </div>
        <div class="card-row-actions">
          <button class="action-button icon-only" type="button" data-action="edit-card" title="Editar flashcard" aria-label="Editar flashcard">✎</button>
          <button class="action-button icon-only delete" type="button" data-action="delete-card" title="Apagar flashcard" aria-label="Apagar flashcard">🗑</button>
        </div>
      </article>
    `).join("");
  }

  function removeDeletedCardFromView(row) {
    const list = $("#cardList");
    const empty = $("#deckEmptyState");
    const meta = $("#deckMeta");
    const countMatch = String(meta?.textContent || "").match(/^(\d+)/);
    if (!list || !empty || !row || !countMatch) return false;

    const total = Math.max(0, Number.parseInt(countMatch[1], 10) - 1);
    meta.textContent = `${total} ${total === 1 ? "flashcard" : "flashcards"}`;
    row.remove();

    if (total === 0) {
      list.innerHTML = "";
      empty.classList.remove("hidden");
      return true;
    }

    empty.classList.add("hidden");
    const visibleRows = [...list.querySelectorAll(".compact-card-row")];

    if (!visibleRows.length) {
      list.innerHTML = `<div class="empty-state compact"><p>Nenhum flashcard corresponde à pesquisa.</p></div>`;
      return true;
    }

    const renumber = () => {
      visibleRows.forEach((item, index) => {
        if (!item.isConnected) return;
        const number = item.querySelector(".card-number");
        if (number) number.textContent = String(index + 1);
      });
    };
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(renumber, { timeout: 500 });
    else setTimeout(renumber, 0);
    return true;
  }

  function removeDeletedDeckFromHome(row) {
    if (!row) return false;
    row.remove();
    const list = $("#deckList");
    const hasRows = Boolean(list?.querySelector("[data-deck-id],[data-folder-id]"));
    $("#emptyState")?.classList.toggle("hidden", hasRows);
    return true;
  }

  function scheduleLibraryRefresh() {
    setTimeout(() => {
      Promise.resolve(window.OituLibrary?.render?.()).catch((error) => console.warn("OituCards: atualização da biblioteca falhou.", error));
    }, 0);
  }

  function openCreateDeckModal(origin = "home") {
    state.deckModalMode = "create";
    state.createDeckOrigin = origin;
    $("#deckModalTitle").textContent = "Novo baralho";
    $("#deckSubmitButton").textContent = "Criar baralho";
    $("#deckNameInput").value = "";
    openModal("deckModal");
    setTimeout(() => $("#deckNameInput").focus(), 50);
  }

  async function openRenameDeckModal() {
    const deck = await OituDB.getDeck(state.currentDeckId);
    if (!deck) return;

    state.deckModalMode = "rename";
    $("#deckModalTitle").textContent = "Renomear baralho";
    $("#deckSubmitButton").textContent = "Salvar nome";
    $("#deckNameInput").value = deck.name;
    openModal("deckModal");
    setTimeout(() => {
      $("#deckNameInput").focus();
      $("#deckNameInput").select();
    }, 50);
  }

  function openCreateCardModal() {
    state.editingCardId = null;
    OituEditor.resetEditors();
    $("#cardModalTitle").textContent = "Novo flashcard";
    $("#createCardActions").classList.remove("hidden");
    $("#editCardActions").classList.add("hidden");
    openModal("cardModal");
    setTimeout(() => OituEditor.editorFor("front").focus(), 50);
  }

  async function openEditCardModal(cardId) {
    const card = await OituDB.getCard(cardId);
    if (!card) {
      showToast("Flashcard não encontrado.");
      return;
    }

    state.editingCardId = cardId;
    OituEditor.setEditors(card.frontHtml, card.backHtml);
    $("#cardModalTitle").textContent = "Editar flashcard";
    $("#createCardActions").classList.add("hidden");
    $("#editCardActions").classList.remove("hidden");
    openModal("cardModal");
    setTimeout(() => OituEditor.editorFor("front").focus(), 50);
  }

  function getEditorPayload() {
    const front = OituEditor.editorFor("front");
    const back = OituEditor.editorFor("back");

    if (!OituEditor.hasContent(front) || !OituEditor.hasContent(back)) {
      alert('O campo "Frente" ou "Verso" está vazio!');
      return null;
    }

    return {
      frontHtml: OituEditor.sanitizeHtml(front.innerHTML),
      backHtml: OituEditor.sanitizeHtml(back.innerHTML)
    };
  }

  async function addCardAndMaybeClose(shouldClose) {
    const payload = getEditorPayload();
    if (!payload) return;

    await OituDB.addCard(state.currentDeckId, payload.frontHtml, payload.backHtml);
    showToast("Flashcard adicionado.");
    await renderDeckCards();

    if (shouldClose) {
      closeModal("cardModal");
      OituEditor.resetEditors();
    } else {
      OituEditor.resetEditors();
      OituEditor.editorFor("front").focus();
    }
  }

  async function saveCardEdit() {
    const payload = getEditorPayload();
    if (!payload || !state.editingCardId) return;

    await OituDB.updateCard(state.editingCardId, payload);
    closeModal("cardModal");
    state.editingCardId = null;
    OituEditor.resetEditors();
    await renderDeckCards();
    showToast("Alteração salva.");
  }

  function loadStudyModule() {
    if (document.querySelector('script[data-oitucards-study]')) return;

    const script = document.createElement("script");
    script.src = "js/study.js";
    script.dataset.oitucardsStudy = "true";
    script.onerror = () => console.error("Não foi possível carregar o módulo de estudo.");
    document.body.appendChild(script);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("oitucards-theme", theme);
  }

  function initTheme() {
    const saved = localStorage.getItem("oitucards-theme");
    if (saved) {
      applyTheme(saved);
      return;
    }

    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }

  function bindEvents() {
    $("#addDeckButton").addEventListener("click", () => openCreateDeckModal("home"));
    $("#emptyAddDeckButton").addEventListener("click", () => openCreateDeckModal("home"));
    $("#importDeckButton").addEventListener("click", () => openModal("importModal"));
    $("#homeButton").addEventListener("click", renderHome);
    $("#backHomeButton").addEventListener("click", renderHome);
    $("#addCardButton").addEventListener("click", openCreateCardModal);
    $("#deckEmptyAddCardButton").addEventListener("click", openCreateCardModal);
    $("#renameDeckButton").addEventListener("click", openRenameDeckModal);

    $("#themeToggle").addEventListener("click", () => {
      const current = document.documentElement.dataset.theme;
      applyTheme(current === "dark" ? "light" : "dark");
    });

    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => closeModal(button.dataset.closeModal));
    });

    $("#deckForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = $("#deckNameInput").value.trim();
      if (!name) return;

      if (state.deckModalMode === "rename") {
        await OituDB.updateDeck(state.currentDeckId, { name });
        closeModal("deckModal");
        await openDeck(state.currentDeckId);
        showToast("Baralho renomeado.");
        return;
      }

      const deck = await OituDB.addDeck(name);
      closeModal("deckModal");

      if (state.createDeckOrigin === "deck" && state.currentDeckId) {
        await openDeck(state.currentDeckId);
      } else {
        await renderHome();
      }

      showToast("Baralho criado.");
    });

    $("#deckList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      const row = event.target.closest("[data-deck-id]");
      if (!button || !row) return;

      const deckId = row.dataset.deckId;

      if (button.dataset.action === "edit-deck") {
        openDeck(deckId);
      }

      if (button.dataset.action === "delete-deck") {
        const deckName = row.querySelector(".deck-name-button")?.textContent || "este baralho";
        askConfirmation(
          "Excluir baralho?",
          `Todos os flashcards de "${deckName}" serão apagados deste navegador. Esta ação não poderá ser desfeita.`,
          async () => {
            closeModal("confirmModal");
            removeDeletedDeckFromHome(row);
            try {
              if (typeof OituDB.deleteLibraryItems === "function") await OituDB.deleteLibraryItems([deckId], []);
              else await OituDB.deleteDeck(deckId);
              showToast("Baralho excluído.");
              scheduleLibraryRefresh();
            } catch (error) {
              console.error("OituCards: falha ao excluir baralho.", error);
              await renderHome();
              alert("Não foi possível excluir o baralho. Tente novamente.");
            }
          }
        );
      }
    });

    $("#cardList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      const row = event.target.closest("[data-card-id]");
      if (!button || !row) return;

      const cardId = row.dataset.cardId;

      if (button.dataset.action === "edit-card") {
        openEditCardModal(cardId);
      }

      if (button.dataset.action === "delete-card") {
        askConfirmation(
          "Excluir flashcard?",
          "Este flashcard será apagado deste navegador. Esta ação não poderá ser desfeita.",
          async () => {
            closeModal("confirmModal");
            const removed = removeDeletedCardFromView(row);
            try {
              await OituDB.deleteCard(cardId);
              if (!removed) await renderDeckCards();
              showToast("Flashcard excluído.");
            } catch (error) {
              console.error("OituCards: falha ao excluir flashcard.", error);
              await renderDeckCards();
              alert("Não foi possível excluir o flashcard. Tente novamente.");
            }
          }
        );
      }
    });

    $("#cardSearchInput").addEventListener("input", renderDeckCards);

    document.querySelectorAll("[data-card-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.cardAction;

        if (action === "cancel") {
          closeModal("cardModal");
          state.editingCardId = null;
          OituEditor.resetEditors();
        }

        if (action === "add") await addCardAndMaybeClose(false);
        if (action === "add-close") await addCardAndMaybeClose(true);
        if (action === "save-edit") await saveCardEdit();
      });
    });

    $("#confirmCancel").addEventListener("click", () => {
      closeModal("confirmModal");
      state.confirmHandler = null;
    });

    $("#confirmAccept").addEventListener("click", async () => {
      if (state.confirmHandler) {
        const handler = state.confirmHandler;
        state.confirmHandler = null;
        await handler();
      }
    });

    document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("mousedown", (event) => {
        if (event.target !== backdrop) return;

        if (backdrop.id === "confirmModal") {
          closeModal("confirmModal");
          state.confirmHandler = null;
          return;
        }

        if (backdrop.id === "cardModal") {
          closeModal("cardModal");
          state.editingCardId = null;
          OituEditor.resetEditors();
          return;
        }

        closeModal(backdrop.id);
      });
    });
  }

  async function init() {
    initTheme();
    OituEditor.init();
    bindEvents();
    loadStudyModule();

    try {
      await OituDB.openDB();
      await renderHome();
    } catch (error) {
      console.error(error);
      alert("Não foi possível iniciar o banco de dados local do OituCards neste navegador.");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
