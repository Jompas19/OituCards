(function () {
  if (window.__oitucardsImportStressFastPath) return;
  window.__oitucardsImportStressFastPath = true;

  const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
  const SQLJS_URL = "https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/sql-wasm.min.js";
  const SQLJS_WASM_BASE = "https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/";
  const FZSTD_URL = "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js";
  const CARD_BATCH = 1200;
  const MEDIA_WRITE_BATCH = 18;
  const MEDIA_WORKERS = 4;
  const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
  const ALLOWED = new Set(["DIV","P","BR","B","STRONG","I","EM","U","UL","OL","LI","SPAN","IMG"]);

  let active = false;
  let sqlPromise = null;
  const dependencyPromises = new Map();

  const $ = (selector) => document.querySelector(selector);

  function extensionOf(name) {
    return String(name || "").toLowerCase().match(/\.([^.]+)$/)?.[1] || "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeMediaName(value) {
    let name = String(value || "").trim();
    try { name = decodeURIComponent(name); } catch (_) {}
    return name.replace(/^\.\//, "").replace(/^media\//i, "").normalize("NFC");
  }

  function mimeFromName(name) {
    const ext = extensionOf(name);
    return ({
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
      webp: "image/webp", bmp: "image/bmp", avif: "image/avif", svg: "image/svg+xml"
    })[ext] || "application/octet-stream";
  }

  function isImageName(name) {
    return ["jpg","jpeg","png","gif","webp","bmp","avif","svg"].includes(extensionOf(name));
  }

  function setProgress(value, message, tone = "working") {
    const bar = $("#importProgressBar");
    const wrap = $("#importProgressWrap");
    const status = $("#importStatus");
    const safe = Math.max(0, Math.min(100, Number(value) || 0));
    if (wrap) wrap.classList.remove("hidden");
    if (bar) {
      bar.style.width = `${safe}%`;
      bar.setAttribute("aria-valuenow", String(Math.round(safe)));
    }
    if (status && message) {
      status.textContent = message;
      status.dataset.tone = tone;
    }
  }

  function setUiBusy(busy) {
    active = busy;
    const button = $("#confirmImportButton");
    const input = $("#deckImportFileInput");
    const drop = $("#importDropzone");
    if (button) {
      button.disabled = busy || !input?.files?.[0];
      button.textContent = busy ? "Importando..." : "Importar";
    }
    if (input) input.disabled = busy;
    if (drop) drop.classList.toggle("is-busy", busy);
  }

  function loadScript(url, test) {
    if (test()) return Promise.resolve();
    if (dependencyPromises.has(url)) return dependencyPromises.get(url);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Falha ao carregar ${url}`));
      document.head.appendChild(script);
    });
    dependencyPromises.set(url, promise);
    return promise;
  }

  async function ensureDependencies(modern) {
    await Promise.all([
      loadScript(JSZIP_URL, () => typeof window.JSZip !== "undefined"),
      loadScript(SQLJS_URL, () => typeof window.initSqlJs === "function")
    ]);
    if (modern) await loadScript(FZSTD_URL, () => typeof window.fzstd?.decompress === "function");
    if (!sqlPromise) sqlPromise = window.initSqlJs({ locateFile: (file) => `${SQLJS_WASM_BASE}${file}` });
    return sqlPromise;
  }

  function queryRows(db, sql) {
    const result = db.exec(sql);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
  }

  function tableExists(db, name) {
    const escaped = String(name).replaceAll("'", "''");
    return queryRows(db, `select name from sqlite_master where type='table' and name='${escaped}'`).length > 0;
  }

  function readDeckNames(db) {
    const names = new Map();
    if (tableExists(db, "decks")) {
      try {
        queryRows(db, "select id, name from decks").forEach((row) =>
          names.set(String(row.id), String(row.name || "Baralho").replaceAll("\u001f", "::"))
        );
      } catch (_) {}
    }
    if (!names.size && tableExists(db, "col")) {
      try {
        const json = queryRows(db, "select decks from col limit 1")[0]?.decks;
        if (json) Object.entries(JSON.parse(json)).forEach(([id, deck]) => names.set(String(id), String(deck?.name || "Baralho")));
      } catch (_) {}
    }
    return names;
  }

  function readVarint(bytes, start) {
    let value = 0, shift = 0, position = start;
    while (position < bytes.length) {
      const byte = bytes[position++];
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return { value, position };
      shift += 7;
      if (shift > 53) throw new Error("Varint protobuf grande demais.");
    }
    throw new Error("Protobuf incompleto.");
  }

  function skipProtoField(bytes, wire, position) {
    if (wire === 0) return readVarint(bytes, position).position;
    if (wire === 1) return position + 8;
    if (wire === 2) {
      const len = readVarint(bytes, position);
      return len.position + len.value;
    }
    if (wire === 5) return position + 4;
    throw new Error(`Tipo protobuf ${wire} não suportado.`);
  }

  function parseMediaEntry(bytes) {
    let position = 0;
    const entry = { name: "", size: 0 };
    while (position < bytes.length) {
      const key = readVarint(bytes, position);
      position = key.position;
      const field = Math.floor(key.value / 8);
      const wire = key.value % 8;
      if (field === 1 && wire === 2) {
        const len = readVarint(bytes, position);
        position = len.position;
        entry.name = new TextDecoder().decode(bytes.slice(position, position + len.value));
        position += len.value;
      } else if (field === 2 && wire === 0) {
        const val = readVarint(bytes, position);
        entry.size = val.value;
        position = val.position;
      } else position = skipProtoField(bytes, wire, position);
    }
    return entry;
  }

  function parseModernMediaMap(bytes) {
    const entries = [];
    let position = 0;
    while (position < bytes.length) {
      const key = readVarint(bytes, position);
      position = key.position;
      const field = Math.floor(key.value / 8);
      const wire = key.value % 8;
      if (field === 1 && wire === 2) {
        const len = readVarint(bytes, position);
        position = len.position;
        const end = position + len.value;
        entries.push(parseMediaEntry(bytes.slice(position, end)));
        position = end;
      } else position = skipProtoField(bytes, wire, position);
    }
    return entries;
  }

  async function readMediaMap(zip, modern) {
    const byName = new Map();
    const mediaFile = zip.file("media");
    if (!mediaFile) return byName;
    if (modern) {
      let bytes = await mediaFile.async("uint8array");
      bytes = window.fzstd.decompress(bytes);
      parseModernMediaMap(bytes).forEach((entry, index) => {
        if (!entry.name) return;
        byName.set(normalizeMediaName(entry.name), { zipName: String(index), size: entry.size || 0 });
      });
    } else {
      try {
        const parsed = JSON.parse(await mediaFile.async("string"));
        for (const [zipName, name] of Object.entries(parsed)) {
          const file = zip.file(String(zipName));
          byName.set(normalizeMediaName(name), { zipName: String(zipName), size: file?._data?.uncompressedSize || 0 });
        }
      } catch (_) {}
    }
    return byName;
  }

  function renderCloze(text, ordinal, answerSide) {
    const target = Number(ordinal) + 1;
    return String(text || "").replace(/\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/gi, (_full, number, content, hint) => {
      if (Number(number) === target) return answerSide ? `<strong>${content}</strong>` : (hint ? `[${hint}]` : "[…]");
      return content;
    });
  }

  function createCard(fields, ordinal) {
    const clean = fields.map((field) => String(field || ""));
    const first = clean[0] || "";
    let front, back;
    if (/\{\{c\d+::/i.test(first)) {
      front = renderCloze(first, ordinal, false);
      back = renderCloze(first, ordinal, true);
      if (clean.length > 1 && clean[1].trim()) back += `<br><br>${clean.slice(1).join("<br><br>")}`;
    } else if (clean.length >= 2 && Number(ordinal) === 1) {
      front = clean[1];
      back = clean[0] + (clean.length > 2 ? `<br><br>${clean.slice(2).join("<br><br>")}` : "");
    } else {
      front = clean[0];
      back = clean.slice(1).join("<br><br>");
    }
    if (!String(back || "").trim() && clean.length === 1) back = clean[0];
    return { frontHtml: front, backHtml: back };
  }

  function sanitizeStyle(node) {
    const allowed = [];
    const style = node.style;
    if (style.color) allowed.push(`color: ${style.color}`);
    if (style.backgroundColor) allowed.push(`background-color: ${style.backgroundColor}`);
    if (style.fontWeight) allowed.push(`font-weight: ${style.fontWeight}`);
    if (style.fontStyle) allowed.push(`font-style: ${style.fontStyle}`);
    if (style.textDecoration) allowed.push(`text-decoration: ${style.textDecoration}`);
    return allowed.join("; ");
  }

  function sanitizeCardHtml(rawHtml, mediaMap, mediaIds, usedMedia) {
    let html = String(rawHtml || "").replace(/\[sound:([^\]]+)\]/gi, (_m, name) => `<span>🔊 ${escapeHtml(name)}</span>`);
    const template = document.createElement("template");
    template.innerHTML = html;
    const nodes = [...template.content.querySelectorAll("*")];
    for (const node of nodes) {
      if (!ALLOWED.has(node.tagName)) {
        node.replaceWith(...node.childNodes);
        continue;
      }
      if (node.tagName === "IMG") {
        const rawSrc = node.getAttribute("src") || "";
        const normalized = normalizeMediaName(rawSrc);
        const info = mediaMap.get(normalized);
        const isEmbeddedData = /^data:image\//i.test(rawSrc);
        [...node.attributes].forEach((attr) => node.removeAttribute(attr.name));
        if (info && isImageName(normalized) && Number(info.size || 0) <= MAX_MEDIA_BYTES) {
          let id = mediaIds.get(normalized);
          if (!id) {
            id = `media:${crypto.randomUUID()}`;
            mediaIds.set(normalized, id);
          }
          usedMedia.add(normalized);
          node.setAttribute("data-oitucards-media", id);
          node.setAttribute("src", "");
          node.setAttribute("loading", "lazy");
          node.setAttribute("alt", normalized);
        } else if (isEmbeddedData) {
          node.setAttribute("src", rawSrc);
          node.setAttribute("loading", "lazy");
          node.setAttribute("alt", "Imagem do flashcard");
        } else {
          node.replaceWith(document.createTextNode(`[imagem: ${normalized || "não encontrada"}]`));
        }
        continue;
      }
      [...node.attributes].forEach((attr) => {
        if (attr.name.toLowerCase() === "style") {
          const style = sanitizeStyle(node);
          if (style) node.setAttribute("style", style); else node.removeAttribute("style");
        } else node.removeAttribute(attr.name);
      });
    }
    return template.innerHTML.trim();
  }

  function meaningful(html) {
    const text = String(html || "").replace(/<img\b[^>]*>/gi, " [img] ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").trim();
    return Boolean(text || /<img\b/i.test(html));
  }

  function sanitizeSvg(bytes) {
    try {
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "image/svg+xml");
      doc.querySelectorAll("script,foreignObject").forEach((node) => node.remove());
      doc.querySelectorAll("*").forEach((node) => [...node.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith("on") || ((name === "href" || name.endsWith(":href")) && !value.startsWith("#"))) node.removeAttribute(attr.name);
      }));
      return new TextEncoder().encode(new XMLSerializer().serializeToString(doc.documentElement));
    } catch (_) { return null; }
  }

  async function extractUsedMedia(zip, modern, mediaMap, mediaIds, usedMedia, progress) {
    const names = [...usedMedia];
    if (!names.length || !window.OituScaleStorage?.putMediaBatch) return { imported: 0, warnings: 0 };
    let cursor = 0, done = 0, warnings = 0;
    const pendingRecords = [];
    let writeChain = Promise.resolve();

    async function flush() {
      if (!pendingRecords.length) return;
      const records = pendingRecords.splice(0, pendingRecords.length);
      writeChain = writeChain.then(() => OituScaleStorage.putMediaBatch(records));
      await writeChain;
    }

    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= names.length) return;
        const name = names[index];
        const info = mediaMap.get(name);
        const id = mediaIds.get(name);
        if (!info || !id || Number(info.size || 0) > MAX_MEDIA_BYTES) { warnings += 1; continue; }
        try {
          const entry = zip.file(String(info.zipName));
          if (!entry) { warnings += 1; continue; }
          let bytes = await entry.async("uint8array");
          if (modern) bytes = window.fzstd.decompress(bytes);
          let mime = mimeFromName(name);
          if (mime === "image/svg+xml") {
            const clean = sanitizeSvg(bytes);
            if (!clean) { warnings += 1; continue; }
            bytes = clean;
          }
          const blob = new Blob([bytes], { type: mime });
          pendingRecords.push({ id, blob, mime, size: blob.size, name, createdAt: new Date().toISOString() });
          done += 1;
          if (pendingRecords.length >= MEDIA_WRITE_BATCH) await flush();
          if (done % 25 === 0 || done === names.length) progress(done, names.length);
        } catch (_) { warnings += 1; }
        if (index % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    await Promise.all(Array.from({ length: Math.min(MEDIA_WORKERS, names.length) }, () => worker()));
    await flush();
    return { imported: done, warnings };
  }

  async function createFolderPath(parts, folders, folderCache) {
    let parentId = null;
    for (const rawPart of parts) {
      const part = String(rawPart || "").trim().slice(0, 120);
      if (!part) continue;
      const key = `${parentId || "root"}\u0000${part.toLocaleLowerCase("pt-BR")}`;
      let folder = folderCache.get(key);
      if (!folder) {
        folder = folders.find((item) => (item.parentId || null) === parentId && String(item.name).trim().toLocaleLowerCase("pt-BR") === part.toLocaleLowerCase("pt-BR"));
      }
      if (!folder) {
        folder = await OituDB.addFolder(part, parentId);
        folders.push(folder);
      }
      folderCache.set(key, folder);
      parentId = folder.id;
    }
    return parentId;
  }

  function uniqueLeafName(base, used) {
    const clean = String(base || "Baralho importado").trim().slice(0, 120) || "Baralho importado";
    let value = clean, i = 2;
    while (used.has(value.toLocaleLowerCase("pt-BR"))) value = `${clean.slice(0, Math.max(1, 116 - String(i).length))} (${i++})`;
    used.add(value.toLocaleLowerCase("pt-BR"));
    return value;
  }

  async function persistDecks(groups) {
    const [existingDecks, folders] = await Promise.all([OituDB.getDecks(), OituDB.getFolders()]);
    const usedDeckNames = new Set(existingDecks.map((deck) => String(deck.name || "").trim().toLocaleLowerCase("pt-BR")));
    const folderCache = new Map();
    const created = [];

    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      const path = String(group.name || "Baralho importado").split("::").map((part) => part.trim()).filter(Boolean);
      const leaf = uniqueLeafName(path.pop() || "Baralho importado", usedDeckNames);
      const folderId = path.length ? await createFolderPath(path, folders, folderCache) : null;
      let deck = await OituDB.addDeck(leaf);
      if (folderId) deck = await OituDB.updateDeck(deck.id, { folderId });
      created.push({ deck, cards: group.cards });
      if ((i + 1) % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const db = await OituDB.openDB();
    let total = 0;
    const flat = [];
    created.forEach(({ deck, cards }) => cards.forEach((card) => flat.push({ deckId: deck.id, card })));

    for (let offset = 0; offset < flat.length; offset += CARD_BATCH) {
      const chunk = flat.slice(offset, offset + CARD_BATCH);
      await new Promise((resolve, reject) => {
        const tx = db.transaction("cards", "readwrite");
        const store = tx.objectStore("cards");
        const base = Date.now() + offset;
        const updatedAt = new Date().toISOString();
        chunk.forEach(({ deckId, card }, local) => store.add({
          id: crypto.randomUUID(), deckId,
          frontHtml: card.frontHtml, backHtml: card.backHtml,
          reviewStatus: null,
          createdAt: new Date(base + local).toISOString(), updatedAt
        }));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Falha ao gravar cards no navegador."));
      });
      total += chunk.length;
      setProgress(62 + (total / flat.length) * 30, `Gravando cards: ${total}/${flat.length}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const importedAt = new Date().toISOString();
    await Promise.all(created.map(({ deck }) => OituDB.updateDeck(deck.id, { importedAt, importSource: "apkg" })));
    return { deckCount: created.length, cardCount: flat.length };
  }

  async function runFastApkg(file) {
    setUiBusy(true);
    try {
      setProgress(2, "Abrindo pacote do Anki...");
      await ensureDependencies(false);
      const zip = await JSZip.loadAsync(file);
      const modernEntry = zip.file("collection.21b") || zip.file("collection.anki21b");
      const legacy21 = zip.file("collection.anki21");
      const legacy2 = zip.file("collection.anki2");
      const collection = modernEntry || legacy21 || legacy2;
      if (!collection) throw new Error("O pacote não contém uma coleção Anki reconhecível.");
      const modern = Boolean(modernEntry);
      if (modern) await ensureDependencies(true);

      setProgress(5, modern ? "Lendo coleção moderna..." : "Lendo coleção...");
      let bytes = await collection.async("uint8array");
      if (modern) bytes = fzstd.decompress(bytes);
      const mediaMap = await readMediaMap(zip, modern);
      const SQL = await ensureDependencies(modern);
      const db = new SQL.Database(bytes);
      let rows, deckNames;
      try {
        if (!tableExists(db, "cards") || !tableExists(db, "notes")) throw new Error("A coleção do Anki é inválida.");
        deckNames = readDeckNames(db);
        rows = queryRows(db, "select c.id as cid, c.did as did, c.ord as ord, n.flds as flds from cards c join notes n on n.id=c.nid order by c.did, c.id");
      } finally { db.close(); }
      if (!rows.length) throw new Error("Nenhum card foi encontrado no pacote.");

      const mediaIds = new Map();
      const usedMedia = new Set();
      const groups = new Map();
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const did = String(row.did);
        if (!groups.has(did)) groups.set(did, { name: deckNames.get(did) || "Baralho importado", cards: [] });
        const raw = createCard(String(row.flds || "").split("\u001f"), row.ord);
        const frontHtml = sanitizeCardHtml(raw.frontHtml, mediaMap, mediaIds, usedMedia);
        const backHtml = sanitizeCardHtml(raw.backHtml, mediaMap, mediaIds, usedMedia);
        if (meaningful(frontHtml) && meaningful(backHtml)) groups.get(did).cards.push({ frontHtml, backHtml });
        if ((i + 1) % 500 === 0 || i + 1 === rows.length) {
          setProgress(8 + ((i + 1) / rows.length) * 34, `Preparando cards: ${i + 1}/${rows.length}`);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      const validGroups = [...groups.values()].filter((group) => group.cards.length);
      if (!validGroups.length) throw new Error("Nenhum flashcard válido foi encontrado.");

      setProgress(43, `Estrutura pronta: ${rows.length} cards. Gravando cards e mídias em paralelo...`);
      const mediaPromise = extractUsedMedia(zip, modern, mediaMap, mediaIds, usedMedia, (done, total) => {
        if (total) setProgress(Math.max(43, 43 + (done / total) * 17), `Processando mídias: ${done}/${total}`);
      });
      const deckPromise = persistDecks(validGroups);
      const [mediaResult, deckResult] = await Promise.all([mediaPromise, deckPromise]);

      setProgress(100, "Importação concluída.");
      const status = $("#importStatus");
      if (status) {
        status.textContent = `${deckResult.cardCount} cards importados em ${deckResult.deckCount} baralhos. ${mediaResult.imported} mídias processadas${mediaResult.warnings ? `; ${mediaResult.warnings} mídia(s) ignorada(s)` : ""}.`;
        status.dataset.tone = mediaResult.warnings ? "warning" : "success";
      }
      setUiBusy(false);
      setTimeout(() => {
        $("#importModal")?.classList.add("hidden");
        if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
        window.OituInstantScale?.rebuildAllStats?.().catch?.(() => {});
        $("#homeButton")?.click();
      }, 250);
    } catch (error) {
      console.error("Falha na importação APKG otimizada", error);
      setProgress(0, error?.message || "Não foi possível importar este pacote.", "error");
      setUiBusy(false);
    }
  }

  window.addEventListener("click", (event) => {
    const confirm = event.target?.closest?.("#confirmImportButton");
    if (!confirm) return;
    const file = $("#deckImportFileInput")?.files?.[0];
    if (!file || !["apkg","colpkg"].includes(extensionOf(file.name))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    runFastApkg(file);
  }, true);

  window.addEventListener("click", (event) => {
    if (!active) return;
    if (!event.target?.closest?.("#cancelImportButton,#closeImportButton")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();