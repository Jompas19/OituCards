(function () {
  const IMPORT_CSS_HREF = "css/import.css";
  const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
  const SQLJS_URL = "https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/sql-wasm.min.js";
  const SQLJS_WASM_BASE = "https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/";
  const FZSTD_URL = "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js";
  const CARD_CHUNK_SIZE = 800;
  const MEDIA_BATCH_SIZE = 12;
  const MEDIA_BATCH_BYTES = 48 * 1024 * 1024;
  const LARGE_FILE_WARNING_BYTES = 250 * 1024 * 1024;
  const MAX_IMPORT_MEDIA_BYTES = 25 * 1024 * 1024;

  const state = {
    file: null,
    busy: false,
    dependencies: new Map(),
    sqlPromise: null,
    warnings: [],
    pendingMediaContext: null,
    activeImportDeckIds: [],
    activeImportFolderIds: []
  };

  const $ = (selector) => document.querySelector(selector);

  function ensureStyles() {
    if (document.querySelector('link[data-oitucards-import-css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = IMPORT_CSS_HREF;
    link.dataset.oitucardsImportCss = "true";
    document.head.appendChild(link);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function plainTextToHtml(value) {
    return escapeHtml(value).replace(/\r?\n/g, "<br>");
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
  }

  function filenameWithoutExtension(name) {
    return String(name || "Baralho importado").replace(/\.[^.]+$/, "").trim() || "Baralho importado";
  }

  function extensionOf(name) {
    const match = String(name || "").toLowerCase().match(/\.([^.]+)$/);
    return match ? match[1] : "";
  }

  function setStatus(message, tone = "neutral") {
    const target = $("#importStatus");
    if (!target) return;
    target.textContent = message || "";
    target.dataset.tone = tone;
  }

  function setProgress(value, message) {
    const bar = $("#importProgressBar");
    const wrap = $("#importProgressWrap");
    if (!bar || !wrap) return;
    const safe = Math.max(0, Math.min(100, Number(value) || 0));
    wrap.classList.toggle("hidden", safe <= 0 && !state.busy);
    bar.style.width = `${safe}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(safe)));
    if (message) setStatus(message, "working");
  }

  function setBusy(busy) {
    state.busy = busy;
    const button = $("#confirmImportButton");
    const input = $("#deckImportFileInput");
    const drop = $("#importDropzone");
    if (button) {
      button.disabled = busy || !state.file;
      button.textContent = busy ? "Importando..." : "Importar";
    }
    if (input) input.disabled = busy;
    if (drop) drop.classList.toggle("is-busy", busy);
  }

  function closeImportModal() {
    if (state.busy) return;
    const modal = $("#importModal");
    if (!modal) return;
    modal.classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) document.body.style.overflow = "";
  }

  function resetImporter() {
    if (state.busy) return;
    state.file = null;
    state.warnings = [];
    state.pendingMediaContext = null;
    state.activeImportDeckIds = [];
    state.activeImportFolderIds = [];
    const input = $("#deckImportFileInput");
    if (input) input.value = "";
    const name = $("#importSelectedName");
    const meta = $("#importSelectedMeta");
    const selected = $("#importSelectedFile");
    if (name) name.textContent = "Nenhum arquivo selecionado";
    if (meta) meta.textContent = "APKG, COLPKG, ANKI2, CSV, TSV, TXT ou JSON";
    if (selected) selected.classList.remove("has-file");
    const deckName = $("#importDeckNameInput");
    if (deckName) deckName.value = "";
    const deckNameRow = $("#importDeckNameRow");
    if (deckNameRow) deckNameRow.classList.add("hidden");
    const hint = $("#importFormatHint");
    if (hint) hint.textContent = "Selecione um arquivo para começar.";
    setStatus("");
    setProgress(0);
    setBusy(false);
  }

  function injectUI() {
    ensureStyles();
    const modal = $("#importModal");
    if (!modal) return false;
    const panel = modal.querySelector(".modal");
    if (!panel) return false;

    panel.classList.remove("small-modal");
    panel.classList.add("import-modal-panel");
    panel.innerHTML = `
      <div class="modal-header">
        <div>
          <p class="eyebrow">Importação</p>
          <h2 id="importModalTitle">Importar baralho</h2>
          <p class="import-lead">Traga seus flashcards para o OituCards. O conteúdo é importado como novo, sem aproveitar o histórico de revisão do arquivo de origem.</p>
        </div>
        <button id="closeImportButton" class="icon-button modal-close" type="button" aria-label="Fechar">×</button>
      </div>

      <div class="import-format-chips" aria-label="Formatos compatíveis">
        <span class="import-format-chip primary">.APKG</span>
        <span class="import-format-chip">.COLPKG</span>
        <span class="import-format-chip">.ANKI2</span>
        <span class="import-format-chip">.CSV</span>
        <span class="import-format-chip">.TSV / .TXT</span>
        <span class="import-format-chip">.JSON</span>
      </div>

      <label id="importDropzone" class="import-dropzone" for="deckImportFileInput">
        <input id="deckImportFileInput" class="hidden" type="file" accept=".apkg,.colpkg,.anki2,.anki21,.csv,.tsv,.txt,.json,application/json,text/csv,text/plain" />
        <span class="import-drop-icon">⇧</span>
        <strong>Escolher arquivo</strong>
        <span>ou arraste e solte aqui</span>
      </label>

      <div id="importSelectedFile" class="import-selected-file">
        <div>
          <strong id="importSelectedName">Nenhum arquivo selecionado</strong>
          <span id="importSelectedMeta">APKG, COLPKG, ANKI2, CSV, TSV, TXT ou JSON</span>
        </div>
        <button id="clearImportFileButton" class="link-button hidden" type="button">Remover</button>
      </div>

      <div id="importDeckNameRow" class="import-deck-name-row hidden">
        <label class="field-label" for="importDeckNameInput">Nome do baralho</label>
        <input id="importDeckNameInput" class="text-input" type="text" maxlength="120" autocomplete="off" />
        <span class="field-hint">Para arquivos de texto/JSON. Em pacotes do Anki, os nomes dos baralhos são preservados automaticamente.</span>
      </div>

      <div class="import-info-box">
        <strong>Como a importação funciona</strong>
        <ul>
          <li><b>APKG/COLPKG:</b> importa cards, subbaralhos e imagens incorporadas. Pacotes antigos e modernos do Anki são reconhecidos.</li>
          <li><b>CSV/TSV/TXT:</b> usa as duas primeiras colunas como Frente e Verso; cabeçalhos comuns e cabeçalhos de exportação do Anki são detectados.</li>
          <li><b>JSON:</b> aceita cards com campos como <code>front/back</code>, <code>question/answer</code> ou <code>frontHtml/backHtml</code>.</li>
        </ul>
        <p id="importFormatHint" class="import-format-hint">Selecione um arquivo para começar.</p>
      </div>

      <div id="importProgressWrap" class="import-progress-wrap hidden">
        <div class="import-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div id="importProgressBar" class="import-progress-bar"></div>
        </div>
      </div>
      <p id="importStatus" class="import-status" aria-live="polite"></p>

      <div class="modal-actions">
        <button id="cancelImportButton" class="button ghost" type="button">Cancelar</button>
        <button id="confirmImportButton" class="button primary" type="button" disabled>Importar</button>
      </div>`;
    return true;
  }

  function loadScript(url, test) {
    if (test()) return Promise.resolve();
    if (state.dependencies.has(url)) return state.dependencies.get(url);
    const promise = new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((script) => script.src === url);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error(`Falha ao carregar ${url}`)), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Falha ao carregar ${url}`));
      document.head.appendChild(script);
    });
    state.dependencies.set(url, promise);
    return promise;
  }

  async function ensureArchiveDependencies(needsZstd = false) {
    await Promise.all([
      loadScript(JSZIP_URL, () => typeof window.JSZip !== "undefined"),
      loadScript(SQLJS_URL, () => typeof window.initSqlJs === "function")
    ]);
    if (needsZstd) await loadScript(FZSTD_URL, () => typeof window.fzstd?.decompress === "function");
    if (!state.sqlPromise) {
      state.sqlPromise = window.initSqlJs({ locateFile: (file) => `${SQLJS_WASM_BASE}${file}` });
    }
    return state.sqlPromise;
  }

  function selectFile(file) {
    if (!file || state.busy) return;
    const ext = extensionOf(file.name);
    const supported = ["apkg", "colpkg", "anki2", "anki21", "csv", "tsv", "txt", "json"];
    if (!supported.includes(ext)) {
      state.file = null;
      setStatus("Formato não reconhecido. Use APKG, COLPKG, ANKI2, CSV, TSV, TXT ou JSON.", "error");
      setBusy(false);
      return;
    }

    state.file = file;
    const selected = $("#importSelectedFile");
    const name = $("#importSelectedName");
    const meta = $("#importSelectedMeta");
    const clear = $("#clearImportFileButton");
    if (selected) selected.classList.add("has-file");
    if (name) name.textContent = file.name;
    if (meta) meta.textContent = `${ext.toUpperCase()} · ${formatBytes(file.size)}`;
    if (clear) clear.classList.remove("hidden");

    const singleDeck = ["csv", "tsv", "txt", "json"].includes(ext);
    const row = $("#importDeckNameRow");
    if (row) row.classList.toggle("hidden", !singleDeck);
    const deckName = $("#importDeckNameInput");
    if (deckName && singleDeck) deckName.value = filenameWithoutExtension(file.name);

    const hint = $("#importFormatHint");
    if (hint) {
      if (["apkg", "colpkg"].includes(ext)) {
        hint.textContent = "Pacotes do Anki serão convertidos para o formato do OituCards. O agendamento do Anki não será trazido; os cards entram como novos.";
      } else if (["anki2", "anki21"].includes(ext)) {
        hint.textContent = "A coleção SQLite será lida diretamente. Mídias externas não acompanham arquivos ANKI2 isolados.";
      } else {
        hint.textContent = "Confira o nome acima e clique em Importar. Linhas sem Frente ou Verso serão ignoradas.";
      }
    }

    if (file.size > LARGE_FILE_WARNING_BYTES) {
      setStatus(`Arquivo grande (${formatBytes(file.size)}). A importação pode consumir bastante memória neste navegador.`, "warning");
    } else {
      setStatus("Arquivo pronto para importar.", "success");
    }
    setBusy(false);
  }

  function sanitizeHtml(html, options) {
    const source = String(html ?? "").trim();
    if (!source) return "";
    try {
      return OituEditor.sanitizeHtml(source, options);
    } catch (_) {
      return plainTextToHtml(source);
    }
  }

  function hasMeaningfulContent(html) {
    const source = String(html || "");
    if (!source) return false;
    if (/<img\b/i.test(source)) return true;
    const text = source
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&(nbsp|#160|#xa0);/gi, " ")
      .replace(/[\s\u200B-\u200D\uFEFF]+/g, "");
    return Boolean(text);
  }

  async function readTextFile(file) {
    const buffer = await file.arrayBuffer();
    let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text;
  }

  function parseSeparator(value) {
    const key = String(value || "").trim().toLowerCase();
    const named = {
      comma: ",",
      semicolon: ";",
      tab: "\t",
      space: " ",
      pipe: "|",
      colon: ":"
    };
    return named[key] || String(value || "").trim().replace(/^['"]|['"]$/g, "") || null;
  }

  function splitAnkiHeaders(text) {
    const lines = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const headers = {};
    let index = 0;
    while (index < lines.length && lines[index].startsWith("#")) {
      const line = lines[index].slice(1);
      const colon = line.indexOf(":");
      if (colon > 0) {
        const key = line.slice(0, colon).trim().toLowerCase();
        headers[key] = line.slice(colon + 1).trim();
      }
      index += 1;
    }
    return { headers, body: lines.slice(index).join("\n") };
  }

  function countDelimiter(line, delimiter) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') i += 1;
        else quoted = !quoted;
      } else if (!quoted && line.startsWith(delimiter, i)) {
        count += 1;
        i += delimiter.length - 1;
      }
    }
    return count;
  }

  function detectDelimiter(text, preferred) {
    if (preferred) return preferred;
    const sample = String(text).split(/\r?\n/).find((line) => line.trim()) || "";
    const candidates = ["\t", ";", ",", "|"];
    let best = "\t";
    let bestCount = -1;
    candidates.forEach((candidate) => {
      const count = countDelimiter(sample, candidate);
      if (count > bestCount) {
        best = candidate;
        bestCount = count;
      }
    });
    return bestCount > 0 ? best : "\t";
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const value = String(text);

    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      if (quoted) {
        if (char === '"') {
          if (value[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"' && field.length === 0) {
        quoted = true;
      } else if (value.startsWith(delimiter, i)) {
        row.push(field);
        field = "";
        i += delimiter.length - 1;
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
    row.push(field.replace(/\r$/, ""));
    if (row.some((cell) => cell.length > 0)) rows.push(row);
    return rows;
  }

  function normalizeHeader(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  function findHeaderIndex(headers, candidates) {
    const normalized = headers.map(normalizeHeader);
    for (const candidate of candidates) {
      const index = normalized.indexOf(normalizeHeader(candidate));
      if (index >= 0) return index;
    }
    return -1;
  }

  function looksLikeHtml(value) {
    return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
  }

  function fieldToHtml(value, allowHtml) {
    const raw = String(value ?? "");
    if (allowHtml || looksLikeHtml(raw)) return sanitizeHtml(raw);
    return plainTextToHtml(raw);
  }

  async function parseTextDeck(file) {
    const text = await readTextFile(file);
    const { headers: ankiHeaders, body } = splitAnkiHeaders(text);
    const delimiter = detectDelimiter(body, parseSeparator(ankiHeaders.separator));
    const rows = parseDelimited(body, delimiter).filter((row) => row.some((cell) => String(cell).trim()));
    if (!rows.length) throw new Error("O arquivo não contém linhas de flashcards.");

    let headerRow = null;
    let dataRows = rows;
    if (ankiHeaders.columns) {
      headerRow = parseDelimited(ankiHeaders.columns, delimiter)[0] || null;
    } else {
      const first = rows[0];
      const frontCandidate = findHeaderIndex(first, ["front", "frente", "question", "pergunta", "term", "termo", "prompt"]);
      const backCandidate = findHeaderIndex(first, ["back", "verso", "answer", "resposta", "definition", "definicao"]);
      if (frontCandidate >= 0 && backCandidate >= 0) {
        headerRow = first;
        dataRows = rows.slice(1);
      }
    }

    let frontIndex = 0;
    let backIndex = 1;
    if (headerRow) {
      const detectedFront = findHeaderIndex(headerRow, ["front", "frente", "question", "pergunta", "term", "termo", "prompt"]);
      const detectedBack = findHeaderIndex(headerRow, ["back", "verso", "answer", "resposta", "definition", "definicao"]);
      if (detectedFront >= 0) frontIndex = detectedFront;
      if (detectedBack >= 0) backIndex = detectedBack;
    }

    const htmlEnabled = String(ankiHeaders.html || "").toLowerCase() === "true";
    const cards = [];
    for (const row of dataRows) {
      if (row.length < 2) continue;
      const front = fieldToHtml(row[frontIndex] ?? row[0], htmlEnabled);
      let backRaw = row[backIndex] ?? row[1];
      if (!headerRow && row.length > 2 && backIndex === 1) {
        backRaw = row.slice(1).join(htmlEnabled ? "<br><br>" : "\n\n");
      }
      const back = fieldToHtml(backRaw, htmlEnabled);
      if (!hasMeaningfulContent(front) || !hasMeaningfulContent(back)) continue;
      cards.push({ frontHtml: front, backHtml: back });
    }

    if (!cards.length) throw new Error("Não encontrei linhas válidas com Frente e Verso.");
    const requestedName = $("#importDeckNameInput")?.value.trim();
    const deckName = requestedName || ankiHeaders.deck || filenameWithoutExtension(file.name);
    return [{ name: deckName, cards }];
  }

  function genericCardPayload(item) {
    if (!item || typeof item !== "object") return null;
    const front = item.frontHtml ?? item.front ?? item.question ?? item.pergunta ?? item.term ?? item.termo ?? item.prompt;
    const back = item.backHtml ?? item.back ?? item.answer ?? item.resposta ?? item.definition ?? item.definicao;
    if (front == null || back == null) return null;
    const frontHtml = typeof front === "string" && looksLikeHtml(front) ? sanitizeHtml(front) : plainTextToHtml(front);
    const backHtml = typeof back === "string" && looksLikeHtml(back) ? sanitizeHtml(back) : plainTextToHtml(back);
    if (!hasMeaningfulContent(frontHtml) || !hasMeaningfulContent(backHtml)) return null;
    return { frontHtml, backHtml };
  }

  async function parseJsonDeck(file) {
    const text = await readTextFile(file);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      throw new Error("O JSON não é válido.");
    }

    const preferredName = $("#importDeckNameInput")?.value.trim() || filenameWithoutExtension(file.name);

    if (parsed?.format === "oitucards-backup" && Array.isArray(parsed.decks) && Array.isArray(parsed.cards)) {
      const byDeck = new Map(parsed.decks.map((deck) => [deck.id, { name: deck.name || "Baralho importado", cards: [] }]));
      parsed.cards.forEach((card) => {
        const target = byDeck.get(card.deckId);
        const payload = genericCardPayload(card);
        if (target && payload) target.cards.push(payload);
      });
      const decks = [...byDeck.values()].filter((deck) => deck.cards.length);
      if (!decks.length) throw new Error("O backup JSON não contém cards válidos.");
      return decks;
    }

    if (Array.isArray(parsed?.decks)) {
      const decks = parsed.decks.map((deck, index) => {
        const rawCards = Array.isArray(deck.cards) ? deck.cards : [];
        return {
          name: deck.name || deck.deckName || `Baralho ${index + 1}`,
          cards: rawCards.map(genericCardPayload).filter(Boolean)
        };
      }).filter((deck) => deck.cards.length);
      if (decks.length) return decks;
    }

    const rawCards = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cards) ? parsed.cards : null;
    if (!rawCards) throw new Error("Não reconheci a estrutura deste JSON.");
    const cards = rawCards.map(genericCardPayload).filter(Boolean);
    if (!cards.length) throw new Error("O JSON não contém cards com Frente e Verso reconhecíveis.");
    return [{ name: parsed?.name || parsed?.deckName || preferredName, cards }];
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
        queryRows(db, "select id, name from decks").forEach((row) => {
          names.set(String(row.id), String(row.name || "Baralho").replaceAll("\u001f", "::"));
        });
      } catch (_) {}
    }
    if (!names.size && tableExists(db, "col")) {
      try {
        const rows = queryRows(db, "select decks from col limit 1");
        const json = rows[0]?.decks;
        if (json) {
          const parsed = JSON.parse(json);
          Object.entries(parsed).forEach(([id, deck]) => names.set(String(id), String(deck?.name || "Baralho")));
        }
      } catch (_) {}
    }
    return names;
  }

  function renderCloze(text, ordinal, answerSide) {
    const target = Number(ordinal) + 1;
    return String(text || "").replace(/\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/gi, (full, number, content, hint) => {
      const n = Number(number);
      if (n === target) {
        if (answerSide) return `<strong>${content}</strong>`;
        return hint ? `[${hint}]` : "[…]";
      }
      return content;
    });
  }

  function createCardFromAnkiFields(fields, ordinal) {
    const cleanFields = fields.map((field) => String(field || ""));
    const first = cleanFields[0] || "";
    const isCloze = /\{\{c\d+::/i.test(first);
    let front;
    let back;

    if (isCloze) {
      front = renderCloze(first, ordinal, false);
      back = renderCloze(first, ordinal, true);
      if (cleanFields.length > 1 && cleanFields[1].trim()) back += `<br><br>${cleanFields.slice(1).join("<br><br>")}`;
    } else if (cleanFields.length >= 2 && Number(ordinal) === 1) {
      front = cleanFields[1];
      back = cleanFields[0];
      if (cleanFields.length > 2) back += `<br><br>${cleanFields.slice(2).join("<br><br>")}`;
    } else {
      front = cleanFields[0];
      back = cleanFields.slice(1).join("<br><br>");
    }

    if (!String(back || "").trim() && cleanFields.length === 1) back = cleanFields[0];
    return { frontHtml: front, backHtml: back };
  }

  function readVarint(bytes, start) {
    let value = 0;
    let shift = 0;
    let position = start;
    while (position < bytes.length) {
      const byte = bytes[position++];
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return { value, position };
      shift += 7;
      if (shift > 53) throw new Error("Varint protobuf grande demais.");
    }
    throw new Error("Protobuf incompleto.");
  }

  function skipProtoField(bytes, wireType, position) {
    if (wireType === 0) return readVarint(bytes, position).position;
    if (wireType === 1) return position + 8;
    if (wireType === 2) {
      const len = readVarint(bytes, position);
      return len.position + len.value;
    }
    if (wireType === 5) return position + 4;
    throw new Error(`Tipo protobuf ${wireType} não suportado.`);
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
        const value = readVarint(bytes, position);
        entry.size = value.value;
        position = value.position;
      } else {
        position = skipProtoField(bytes, wire, position);
      }
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
      } else {
        position = skipProtoField(bytes, wire, position);
      }
    }
    return entries;
  }

  function normalizeMediaName(value) {
    let name = String(value || "").trim();
    try { name = decodeURIComponent(name); } catch (_) {}
    name = name.replace(/^\.\//, "").replace(/^media\//i, "");
    return name.normalize("NFC");
  }

  function mimeFromName(name) {
    const ext = extensionOf(name);
    const map = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
      webp: "image/webp", bmp: "image/bmp", avif: "image/avif", svg: "image/svg+xml"
    };
    return map[ext] || "application/octet-stream";
  }

  function isImageName(name) {
    return ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "svg"].includes(extensionOf(name));
  }

  function sanitizeSvgBytes(bytes) {
    try {
      const text = new TextDecoder().decode(bytes);
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      doc.querySelectorAll("script,foreignObject").forEach((node) => node.remove());
      doc.querySelectorAll("*").forEach((node) => {
        [...node.attributes].forEach((attr) => {
          const name = attr.name.toLowerCase();
          const value = attr.value.trim().toLowerCase();
          if (name.startsWith("on") || ((name === "href" || name.endsWith(":href")) && !value.startsWith("#"))) node.removeAttribute(attr.name);
        });
      });
      return new TextEncoder().encode(new XMLSerializer().serializeToString(doc.documentElement));
    } catch (_) {
      return null;
    }
  }

  function resolveMediaInHtml(html, mediaContext, usedMediaIds) {
    let source = String(html || "");
    source = source.replace(/\[sound:([^\]]+)\]/gi, (_full, name) => `<span class="imported-audio-placeholder">🔊 ${escapeHtml(name)}</span>`);
    if (!mediaContext?.byName?.size || !/<img\b/i.test(source)) return sanitizeHtml(source);
    return sanitizeHtml(source, { transformImage(image) {
      const rawSrc = image.getAttribute("src") || "";
      if (/^(data:|https?:|blob:)/i.test(rawSrc)) return;
      const normalized = normalizeMediaName(rawSrc);
      const info = mediaContext.byName.get(normalized);
      if (!info || !isImageName(normalized) || Number(info.size) > MAX_IMPORT_MEDIA_BYTES) {
        if (info && Number(info.size) > MAX_IMPORT_MEDIA_BYTES && !info.rejected) {
          info.rejected = true;
          state.warnings.push(`Mídia muito grande ignorada: ${normalized}`);
        }
        image.replaceWith(document.createTextNode(`[imagem: ${normalized}]`));
        return;
      }
      if (!info.id) {
        info.id = crypto.randomUUID();
        info.name = normalized;
        info.deckIds = new Set();
        mediaContext.byId.set(info.id, info);
      }
      usedMediaIds?.add(info.id);
      image.removeAttribute("src");
      image.dataset.oituMediaId = info.id;
      image.setAttribute("loading", "lazy");
      if (!image.getAttribute("alt")) image.setAttribute("alt", normalized);
    }});
  }

  async function readMediaContext(zip, modern) {
    const mediaFile = zip.file("media");
    if (!mediaFile) return { zip, modern, byName: new Map(), byId: new Map() };
    const byName = new Map();
    if (modern) {
      let bytes = await mediaFile.async("uint8array");
      bytes = window.fzstd.decompress(bytes);
      const entries = parseModernMediaMap(bytes);
      entries.forEach((entry, index) => {
        if (!entry.name) return;
        byName.set(normalizeMediaName(entry.name), { zipName: String(index), size: entry.size || 0 });
      });
    } else {
      try {
        const text = await mediaFile.async("string");
        const parsed = JSON.parse(text);
        Object.entries(parsed).forEach(([zipName, name]) => {
          const file = zip.file(String(zipName));
          const size = file?._data?.uncompressedSize || 0;
          byName.set(normalizeMediaName(name), { zipName: String(zipName), size });
        });
      } catch (_) {
        state.warnings.push("O mapa de mídia do pacote não pôde ser lido.");
      }
    }
    return { zip, modern, byName, byId: new Map() };
  }

  async function parseAnkiDatabase(bytes, mediaContext, fallbackName) {
    const SQL = await ensureArchiveDependencies(false);
    let db;
    try {
      db = new SQL.Database(bytes);
    } catch (_) {
      throw new Error("Não foi possível abrir a coleção SQLite do Anki.");
    }

    try {
      if (!tableExists(db, "cards") || !tableExists(db, "notes")) throw new Error("A coleção não contém as tabelas cards/notes esperadas.");
      const deckNames = readDeckNames(db);
      const rows = queryRows(db, "select c.id as cid, c.nid as nid, c.did as did, c.ord as ord, n.flds as flds from cards c join notes n on n.id=c.nid order by c.did, c.id");
      if (!rows.length) throw new Error("Nenhum card foi encontrado no arquivo do Anki.");
      const groups = new Map();
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const did = String(row.did);
        const deckName = deckNames.get(did) || fallbackName || "Baralho importado";
        if (!groups.has(did)) groups.set(did, { name: deckName, cards: [], mediaIds: new Set() });
        const group = groups.get(did);
        const fields = String(row.flds || "").split("\u001f");
        const raw = createCardFromAnkiFields(fields, row.ord);
        const frontHtml = resolveMediaInHtml(raw.frontHtml, mediaContext, group.mediaIds);
        const backHtml = resolveMediaInHtml(raw.backHtml, mediaContext, group.mediaIds);
        if (hasMeaningfulContent(frontHtml) && hasMeaningfulContent(backHtml)) group.cards.push({ frontHtml, backHtml });
        if ((index + 1) % 100 === 0 || index + 1 === rows.length) {
          const pct = 10 + ((index + 1) / rows.length) * 38;
          setProgress(pct, `Preparando cards do Anki: ${index + 1}/${rows.length}`);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      return [...groups.values()].filter((deck) => deck.cards.length);
    } finally {
      db.close();
    }
  }

  async function parseApkg(file) {
    setProgress(3, "Abrindo pacote do Anki...");
    await ensureArchiveDependencies(false);
    let zip;
    try {
      zip = await window.JSZip.loadAsync(file);
    } catch (_) {
      throw new Error("O arquivo não pôde ser aberto como pacote APKG/COLPKG.");
    }

    const modernEntry = zip.file("collection.21b");
    const legacy21 = zip.file("collection.anki21");
    const legacy2 = zip.file("collection.anki2");
    if (!modernEntry && !legacy21 && !legacy2) throw new Error("O pacote não contém uma coleção Anki reconhecível.");

    const modern = Boolean(modernEntry);
    if (modern) await ensureArchiveDependencies(true);
    setProgress(7, modern ? "Descompactando coleção moderna do Anki..." : "Lendo coleção do Anki...");
    let collectionBytes = await (modernEntry || legacy21 || legacy2).async("uint8array");
    if (modern) {
      try { collectionBytes = window.fzstd.decompress(collectionBytes); }
      catch (_) { throw new Error("Não foi possível descompactar a coleção moderna do Anki."); }
    }

    let mediaContext = { zip, modern, byName: new Map(), byId: new Map() };
    try {
      mediaContext = await readMediaContext(zip, modern);
    } catch (_) {
      state.warnings.push("As mídias do pacote não puderam ser processadas; os cards de texto ainda serão importados.");
    }
    state.pendingMediaContext = mediaContext;
    return parseAnkiDatabase(collectionBytes, mediaContext, filenameWithoutExtension(file.name));
  }

  async function parseAnki2(file) {
    setProgress(5, "Abrindo coleção ANKI2...");
    await ensureArchiveDependencies(false);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return parseAnkiDatabase(bytes, null, filenameWithoutExtension(file.name));
  }

  function uniqueDeckName(baseName, used) {
    const clean = String(baseName || "Baralho importado").trim().slice(0, 120) || "Baralho importado";
    if (!used.has(clean.toLocaleLowerCase())) {
      used.add(clean.toLocaleLowerCase());
      return clean;
    }
    let index = 2;
    while (used.has(`${clean} (${index})`.toLocaleLowerCase())) index += 1;
    const name = `${clean} (${index})`.slice(0, 120);
    used.add(name.toLocaleLowerCase());
    return name;
  }

  function folderLookupKey(parentId, name) {
    return `${parentId || "root"}\u0000${String(name || "").trim().toLocaleLowerCase()}`;
  }

  function inheritedReviewFields(folder) {
    if (!folder?.reviewSettings) return {};
    let reviewSettings;
    try { reviewSettings = structuredClone(folder.reviewSettings); }
    catch (_) { reviewSettings = JSON.parse(JSON.stringify(folder.reviewSettings)); }
    return {
      reviewSettings,
      ...(folder.reviewModelMode ? { reviewModelMode: folder.reviewModelMode } : {}),
      ...(folder.reviewModelId ? { reviewModelId: folder.reviewModelId } : {})
    };
  }

  async function prepareImportedLibrary(validDecks) {
    const [existingDecks, existingFolders] = await Promise.all([OituDB.getDecks(), OituDB.getFolders()]);
    const usedDeckNames = new Map();
    existingDecks.forEach((deck) => {
      const parent = deck.folderId || null;
      if (!usedDeckNames.has(parent)) usedDeckNames.set(parent, new Set());
      usedDeckNames.get(parent).add(String(deck.name || "").trim().toLocaleLowerCase());
    });
    const folderLookup = new Map(existingFolders.map((folder) => [folderLookupKey(folder.parentId, folder.name), folder]));
    const foldersById = new Map(existingFolders.map((folder) => [folder.id, folder]));
    const folderDefinitions = [];
    const deckDefinitions = [];
    const pairs = [];
    const now = new Date();
    const importedAt = now.toISOString();
    const summaryDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    validDecks.forEach((sourceDeck) => {
      const parts = String(sourceDeck.name || "Baralho importado").split("::").map((part) => part.trim()).filter(Boolean);
      const leaf = parts.pop() || "Baralho importado";
      let parentId = null;
      for (const part of parts) {
        const key = folderLookupKey(parentId, part);
        let folder = folderLookup.get(key);
        if (!folder) {
          folder = { id: crypto.randomUUID(), name: part, parentId, ...inheritedReviewFields(foldersById.get(parentId)) };
          folderDefinitions.push(folder);
          folderLookup.set(key, folder);
          foldersById.set(folder.id, folder);
        }
        parentId = folder.id;
      }
      if (!usedDeckNames.has(parentId)) usedDeckNames.set(parentId, new Set());
      const deck = {
        id: crypto.randomUUID(),
        name: uniqueDeckName(leaf, usedDeckNames.get(parentId)),
        folderId: parentId,
        importedAt,
        importSource: extensionOf(state.file?.name) || "arquivo",
        cardCount: sourceDeck.cards.length,
        studiedCount: 0,
        dueCount: 0,
        summaryDate,
        ...inheritedReviewFields(foldersById.get(parentId))
      };
      deckDefinitions.push(deck);
      pairs.push({ sourceDeck, deck });
      sourceDeck.mediaIds?.forEach((mediaId) => state.pendingMediaContext?.byId?.get(mediaId)?.deckIds?.add(deck.id));
    });

    await OituDB.addLibraryBatch(folderDefinitions, deckDefinitions);
    state.activeImportDeckIds = deckDefinitions.map((deck) => deck.id);
    state.activeImportFolderIds = folderDefinitions.map((folder) => folder.id);
    return { pairs, folderDefinitions, deckDefinitions };
  }

  async function persistCards(pairs) {
    const total = pairs.reduce((sum, pair) => sum + pair.sourceDeck.cards.length, 0);
    const baseTime = Date.now();
    let sequence = 0;
    let stored = 0;
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const current = batch;
      batch = [];
      await OituDB.addCardsBatch(current);
      stored += current.length;
      setProgress(50 + (stored / Math.max(1, total)) * 20, `Gravando flashcards: ${stored}/${total}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    for (const { sourceDeck, deck } of pairs) {
      for (const card of sourceDeck.cards) {
        const createdAt = new Date(baseTime + sequence).toISOString();
        sequence += 1;
        batch.push({
          id: crypto.randomUUID(),
          deckId: deck.id,
          frontHtml: card.frontHtml,
          backHtml: card.backHtml,
          reviewStatus: null,
          createdAt,
          updatedAt: createdAt
        });
        if (batch.length >= CARD_CHUNK_SIZE) await flush();
      }
    }
    await flush();
    return stored;
  }

  async function extractMediaRecord(info, mediaContext) {
    try {
      const zipFile = mediaContext.zip.file(String(info.zipName));
      if (!zipFile) throw new Error("arquivo ausente");
      let bytes = await zipFile.async("uint8array");
      if (mediaContext.modern) bytes = window.fzstd.decompress(bytes);
      const mime = mimeFromName(info.name);
      if (mime === "image/svg+xml") {
        const sanitized = sanitizeSvgBytes(bytes);
        if (!sanitized) throw new Error("SVG inválido");
        bytes = sanitized;
      }
      return {
        id: info.id,
        name: info.name,
        mime,
        size: bytes.byteLength,
        deckIds: [...info.deckIds],
        blob: new Blob([bytes], { type: mime })
      };
    } catch (_) {
      state.warnings.push(`Não foi possível importar a mídia ${info.name}.`);
      return null;
    }
  }

  async function persistImportedMedia(mediaContext) {
    const media = [...(mediaContext?.byId?.values?.() || [])].filter((info) => info.deckIds?.size);
    if (!media.length) {
      setProgress(99, "Finalizando importação...");
      return 0;
    }
    let stored = 0;
    let processed = 0;
    while (processed < media.length) {
      const group = [];
      let estimatedBytes = 0;
      while (processed + group.length < media.length && group.length < MEDIA_BATCH_SIZE) {
        const candidate = media[processed + group.length];
        const candidateBytes = Math.max(1, Number(candidate.size) || 1024 * 1024);
        if (group.length && estimatedBytes + candidateBytes > MEDIA_BATCH_BYTES) break;
        group.push(candidate);
        estimatedBytes += candidateBytes;
      }
      const records = (await Promise.all(group.map((info) => extractMediaRecord(info, mediaContext)))).filter(Boolean);
      await OituDB.putMediaBatch(records);
      stored += records.length;
      processed += group.length;
      setProgress(70 + (processed / media.length) * 29, `Gravando imagens: ${processed}/${media.length}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return stored;
  }

  async function persistDecks(decks) {
    const validDecks = decks.filter((deck) => deck?.cards?.length);
    if (!validDecks.length) throw new Error("Nenhum flashcard válido foi encontrado.");
    setProgress(49, "Criando pastas e baralhos...");
    const prepared = await prepareImportedLibrary(validDecks);
    const importedCards = await persistCards(prepared.pairs);
    await persistImportedMedia(state.pendingMediaContext);
    state.activeImportDeckIds = [];
    state.activeImportFolderIds = [];
    return {
      decks: prepared.deckDefinitions.length,
      cards: importedCards,
      names: prepared.deckDefinitions.map((deck) => deck.name)
    };
  }

  async function parseSelectedFile() {
    const file = state.file;
    if (!file) throw new Error("Selecione um arquivo primeiro.");
    const ext = extensionOf(file.name);
    if (["apkg", "colpkg"].includes(ext)) return parseApkg(file);
    if (["anki2", "anki21"].includes(ext)) return parseAnki2(file);
    if (ext === "json") return parseJsonDeck(file);
    if (["csv", "tsv", "txt"].includes(ext)) return parseTextDeck(file);
    throw new Error("Formato não suportado.");
  }

  async function runImport() {
    if (!state.file || state.busy) return;
    const startedAt = performance.now();
    setBusy(true);
    state.warnings = [];
    state.pendingMediaContext = null;
    try {
      setProgress(2, "Preparando importação...");
      const decks = await parseSelectedFile();
      setProgress(48, `Arquivo lido: ${decks.reduce((sum, deck) => sum + deck.cards.length, 0)} cards encontrados.`);
      const result = await persistDecks(decks);
      setProgress(100, "Importação concluída.");
      const warningSuffix = state.warnings.length ? ` ${state.warnings.length} aviso(s) de mídia.` : "";
      const elapsed = ((performance.now() - startedAt) / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      setStatus(`${result.cards} ${result.cards === 1 ? "card importado" : "cards importados"} em ${result.decks} ${result.decks === 1 ? "baralho" : "baralhos"}, concluídos em ${elapsed} s.${warningSuffix}`, state.warnings.length ? "warning" : "success");
      setTimeout(() => {
        if (state.busy) return;
        closeImportModal();
        $("#homeButton")?.click();
      }, 850);
    } catch (error) {
      console.error("Falha na importação", error);
      if (state.activeImportDeckIds.length || state.activeImportFolderIds.length) {
        try {
          await OituDB.deleteLibraryItems(state.activeImportDeckIds, state.activeImportFolderIds);
        } catch (cleanupError) {
          console.warn("OituCards: não foi possível remover integralmente a importação incompleta.", cleanupError);
        }
      }
      state.activeImportDeckIds = [];
      state.activeImportFolderIds = [];
      setProgress(0);
      setStatus(error?.message || "Não foi possível importar este arquivo.", "error");
    } finally {
      state.pendingMediaContext = null;
      setBusy(false);
    }
  }

  function bindEvents() {
    $("#deckImportFileInput")?.addEventListener("change", (event) => selectFile(event.target.files?.[0]));
    $("#clearImportFileButton")?.addEventListener("click", resetImporter);
    $("#confirmImportButton")?.addEventListener("click", runImport);
    $("#cancelImportButton")?.addEventListener("click", closeImportModal);
    $("#closeImportButton")?.addEventListener("click", closeImportModal);

    const dropzone = $("#importDropzone");
    ["dragenter", "dragover"].forEach((type) => dropzone?.addEventListener(type, (event) => {
      event.preventDefault();
      if (!state.busy) dropzone.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((type) => dropzone?.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragging");
    }));
    dropzone?.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) selectFile(file);
    });

    $("#importDeckButton")?.addEventListener("click", () => {
      if (!state.busy) resetImporter();
    });
  }

  function init() {
    if (!injectUI()) return;
    bindEvents();
    resetImporter();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
