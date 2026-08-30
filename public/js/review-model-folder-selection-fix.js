(function () {
  if (window.__oitucardsReviewModelFolderSelectionFix) return;
  window.__oitucardsReviewModelFolderSelectionFix = true;

  const MODEL_STORAGE_KEY = "OituCardsReviewPresetsV1";
  const CREATE_VALUE = "__create_review_model__";
  let activeFolderId = null;
  let modalObserver = null;

  const $ = (selector) => document.querySelector(selector);

  function readModels() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.settings) : [];
    } catch (_) {
      return [];
    }
  }

  function validManualSelection(folder) {
    const stored = String(folder?.reviewModelId || "");
    if (stored === "system") return "system";
    if (stored.startsWith("model:") && readModels().some((model) => `model:${model.id}` === stored)) return stored;
    return "custom";
  }

  function selectionForFolder(folder) {
    if (!folder) return "global";
    if (folder.reviewModelMode === "global") return "global";
    if (folder.reviewModelMode === "manual") return validManualSelection(folder);

    // Registros antigos sem modo explícito seguem o modelo geral por padrão.
    // A partir das versões atuais, qualquer alteração manual grava reviewModelMode="manual".
    return "global";
  }

  function ensureSelectionOption(select, value) {
    if (value !== "custom") return;
    if ([...select.options].some((option) => option.value === "custom")) return;
    const createOption = [...select.options].find((option) => option.value === CREATE_VALUE);
    const custom = new Option("Ajuste manual", "custom");
    if (createOption) select.insertBefore(custom, createOption);
    else select.add(custom);
  }

  function normalizeGlobalLabel(select) {
    const option = [...(select?.options || [])].find((item) => item.value === "global");
    if (option) option.textContent = "Modelo geral definido";
  }

  async function syncFolderSelection() {
    const modal = $("#folderReviewModal");
    const select = $("#folderReviewModelSelect");
    const folderId = modal?.dataset.folderId || activeFolderId;
    if (!modal || modal.classList.contains("hidden") || !select || !folderId || !window.OituDB) return false;

    const folder = await OituDB.getFolder(folderId);
    if (!folder) return false;

    const selection = selectionForFolder(folder);
    ensureSelectionOption(select, selection);
    normalizeGlobalLabel(select);

    if ([...select.options].some((option) => option.value === selection)) {
      select.value = selection;
      select.dataset.lastValue = selection;
    }
    return true;
  }

  function syncWhenModalOpens(attempt = 0) {
    const modal = $("#folderReviewModal");
    if (!modal || modal.classList.contains("hidden")) {
      if (attempt < 15) setTimeout(() => syncWhenModalOpens(attempt + 1), 30);
      return;
    }

    // O refinamento antigo também sincroniza o seletor ao abrir o modal.
    // Executar depois dele garante que reviewModelMode seja a fonte de verdade.
    setTimeout(() => syncFolderSelection().catch(console.error), 20);
    setTimeout(() => syncFolderSelection().catch(console.error), 100);
  }

  function captureFolderBeforeDocumentHandlers(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const edit = target.closest("[data-edit-folder]");
    if (edit) {
      const id = edit.dataset.editFolder || edit.closest("[data-folder-id]")?.dataset.folderId || null;
      if (id) {
        activeFolderId = id;
        const modal = $("#folderReviewModal");
        if (modal) modal.dataset.folderId = id;
      }
      return;
    }

    if (target.closest("#folderReviewSettingsButton")) {
      const modal = $("#folderReviewModal");
      if (modal && activeFolderId) modal.dataset.folderId = activeFolderId;
      syncWhenModalOpens();
    }
  }

  function watchModal() {
    const modal = $("#folderReviewModal");
    if (!modal || modal.dataset.folderSelectionFixObserved === "true") return false;
    modal.dataset.folderSelectionFixObserved = "true";
    modalObserver?.disconnect();
    modalObserver = new MutationObserver(() => {
      if (!modal.classList.contains("hidden")) syncWhenModalOpens();
    });
    modalObserver.observe(modal, { attributes: true, attributeFilter: ["class"] });
    return true;
  }

  function init() {
    watchModal();
    setTimeout(watchModal, 50);
    setTimeout(watchModal, 250);
  }

  // O listener no window roda na fase de captura antes do listener do document
  // que usa stopImmediatePropagation() ao abrir a edição da pasta.
  window.addEventListener("click", captureFolderBeforeDocumentHandlers, true);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
