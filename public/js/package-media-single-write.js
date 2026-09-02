(function () {
  if (window.__oitucardsPackageMediaSingleWrite) return;
  window.__oitucardsPackageMediaSingleWrite = true;

  const STATE_KEY = "OituCardsPackageMediaStateV1";
  const api = window.OituPackageMedia;
  if (!api?.savePackage || !api?.updatePackage || !api?.ensurePackageLoaded) return;

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeState(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
    catch (_) {}
  }

  const originalSave = api.savePackage.bind(api);
  api.savePackage = async function (record) {
    const result = await originalSave({ ...record, ready: false, hotIds: [] });
    const state = readState();
    state[record.id] = {
      ...(state[record.id] || {}),
      ready: false,
      name: record.name || "Pacote Anki",
      size: Number(record.size) || record.blob?.size || 0,
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeState(state);
    return result;
  };

  // Metadados pequenos não devem reescrever o Blob inteiro do APKG no IndexedDB.
  api.updatePackage = async function (id, patch) {
    if (!id) return null;
    const state = readState();
    const next = {
      ...(state[id] || {}),
      ...(patch || {}),
      id,
      updatedAt: new Date().toISOString()
    };
    state[id] = next;
    writeState(state);
    return next;
  };

  function warmLatestReady() {
    const state = readState();
    const ready = Object.entries(state)
      .filter(([, value]) => value?.ready)
      .sort((a, b) => String(b[1]?.updatedAt || b[1]?.createdAt || "").localeCompare(String(a[1]?.updatedAt || a[1]?.createdAt || "")));
    const id = ready[0]?.[0];
    if (id) api.ensurePackageLoaded(id).catch(() => {});
  }

  Promise.resolve().then(warmLatestReady);
  window.OituPackageMediaState = { read: readState, warmLatestReady };
})();