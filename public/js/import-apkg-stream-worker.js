/* OituCards - importação APKG de alto volume com mídia indexada */
const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
const SQLJS_URL = "https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/sql-wasm.min.js";
const SQLJS_WASM_BASE = "https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/";
const FZSTD_URL = "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js";
const CARD_BATCH = 900;
const REF_BATCH = 1500;
const HOT_MEDIA_LIMIT = 160;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const ALLOWED_TAGS = new Set(["div","p","br","b","strong","i","em","u","ul","ol","li","span"]);

let runtimePromise = null;
let SQLPromise = null;
let currentJobId = null;
const ackWaiters = new Map();

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function waitAck(token, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ackWaiters.delete(token);
      reject(new Error("Tempo excedido ao persistir um lote da importação."));
    }, timeout);
    ackWaiters.set(token, {
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: (error) => { clearTimeout(timer); reject(error); }
    });
  });
}

async function ensureRuntime() {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    post("phase", { progress: 1, message: "Preparando motor de importação..." });
    importScripts(JSZIP_URL, SQLJS_URL, FZSTD_URL);
    if (!SQLPromise) SQLPromise = self.initSqlJs({ locateFile: (file) => `${SQLJS_WASM_BASE}${file}` });
    await SQLPromise;
    post("ready");
  })();
  return runtimePromise;
}

function extensionOf(name) {
  return String(name || "").toLowerCase().match(/\.([^.]+)$/)?.[1] || "";
}

function normalizeMediaName(value) {
  let name = String(value || "").trim();
  try { name = decodeURIComponent(name); } catch (_) {}
  return name.replace(/^\.\//, "").replace(/^media\//i, "").normalize("NFC");
}

function isImageName(name) {
  return ["jpg","jpeg","png","gif","webp","bmp","avif","svg"].includes(extensionOf(name));
}

function mimeFromName(name) {
  return ({
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", avif: "image/avif", svg: "image/svg+xml"
  })[extensionOf(name)] || "application/octet-stream";
}

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function attrValue(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(tag).match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function safeStyle(tag) {
  const raw = attrValue(tag, "style");
  if (!raw) return "";
  const allowed = [];
  for (const declaration of raw.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 1) continue;
    const key = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!value || /url\s*\(|expression\s*\(|javascript:/i.test(value)) continue;
    if ((key === "color" || key === "background-color") && /^[-#(),.%\sa-z0-9]+$/i.test(value)) allowed.push(`${key}:${value}`);
    else if (key === "font-weight" && /^(normal|bold|bolder|lighter|[1-9]00)$/i.test(value)) allowed.push(`${key}:${value}`);
    else if (key === "font-style" && /^(normal|italic|oblique)$/i.test(value)) allowed.push(`${key}:${value}`);
    else if (key === "text-decoration" && /^(none|underline|line-through|overline)(\s+(underline|line-through|overline))*$/i.test(value)) allowed.push(`${key}:${value}`);
  }
  return allowed.join(";");
}

function sanitizeCardHtml(rawHtml, mediaIds, usedMedia, cardMedia) {
  let source = String(rawHtml || "").replace(/\[sound:([^\]]+)\]/gi, (_m, name) => `🔊 ${String(name || "")}`);
  if (!source.includes("<")) return source;

  let out = "";
  let cursor = 0;
  const tagRe = /<!--[\s\S]*?-->|<![^>]*>|<[^>]*>/g;
  let match;
  while ((match = tagRe.exec(source))) {
    out += source.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const tag = match[0];
    if (/^<!--|^<!/i.test(tag)) continue;

    const closing = tag.match(/^<\s*\/\s*([a-z0-9]+)/i);
    if (closing) {
      const name = closing[1].toLowerCase();
      if (ALLOWED_TAGS.has(name) && name !== "br") out += `</${name}>`;
      continue;
    }

    const opening = tag.match(/^<\s*([a-z0-9]+)/i);
    if (!opening) continue;
    const name = opening[1].toLowerCase();

    if (name === "img") {
      const rawSrc = attrValue(tag, "src");
      if (/^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,/i.test(rawSrc)) {
        out += `<img src="${escapeAttr(rawSrc)}" loading="lazy" alt="Imagem do flashcard">`;
        continue;
      }
      const normalized = normalizeMediaName(rawSrc);
      if (!normalized || !isImageName(normalized)) {
        if (normalized) out += `[imagem: ${escapeAttr(normalized)}]`;
        continue;
      }
      let id = mediaIds.get(normalized);
      if (!id) {
        id = `media:${crypto.randomUUID()}`;
        mediaIds.set(normalized, id);
      }
      usedMedia.add(normalized);
      cardMedia?.add(normalized);
      out += `<img data-oitucards-media="${escapeAttr(id)}" src="" loading="lazy" alt="${escapeAttr(normalized)}">`;
      continue;
    }

    if (!ALLOWED_TAGS.has(name)) continue;
    if (name === "br") {
      out += "<br>";
      continue;
    }
    const style = safeStyle(tag);
    out += style ? `<${name} style="${escapeAttr(style)}">` : `<${name}>`;
  }
  out += source.slice(cursor);
  return out.trim();
}

function meaningful(html) {
  const source = String(html || "");
  if (/<img\b/i.test(source)) return true;
  return Boolean(source.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").trim());
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
  let front;
  let back;
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

function execRows(db, sql) {
  const result = db.exec(sql);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
}

function tableExists(db, name) {
  const safe = String(name).replaceAll("'", "''");
  return execRows(db, `select name from sqlite_master where type='table' and name='${safe}'`).length > 0;
}

function readDeckNames(db) {
  const names = new Map();
  if (tableExists(db, "decks")) {
    try {
      execRows(db, "select id, name from decks").forEach((row) => names.set(String(row.id), String(row.name || "Baralho").replaceAll("\u001f", "::")));
    } catch (_) {}
  }
  if (!names.size && tableExists(db, "col")) {
    try {
      const json = execRows(db, "select decks from col limit 1")[0]?.decks;
      if (json) Object.entries(JSON.parse(json)).forEach(([id, deck]) => names.set(String(id), String(deck?.name || "Baralho")));
    } catch (_) {}
  }
  return names;
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
  const map = new Map();
  const mediaFile = zip.file("media");
  if (!mediaFile) return map;
  if (modern) {
    let bytes = await mediaFile.async("uint8array");
    bytes = self.fzstd.decompress(bytes);
    parseModernMediaMap(bytes).forEach((entry, index) => {
      if (entry.name) map.set(normalizeMediaName(entry.name), { zipName: String(index), size: Number(entry.size) || 0 });
    });
  } else {
    try {
      const parsed = JSON.parse(await mediaFile.async("string"));
      for (const [zipName, name] of Object.entries(parsed)) {
        const entry = zip.file(String(zipName));
        map.set(normalizeMediaName(name), { zipName: String(zipName), size: Number(entry?._data?.uncompressedSize) || 0 });
      }
    } catch (_) {}
  }
  return map;
}

async function sendAcked(type, payload, token) {
  post(type, { ...payload, token });
  await waitAck(token);
}

async function runJob(file, jobId) {
  await ensureRuntime();
  currentJobId = jobId;
  post("phase", { progress: 3, message: "Abrindo pacote do Anki..." });
  const zip = await self.JSZip.loadAsync(file);
  if (currentJobId !== jobId) return;

  const modernEntry = zip.file("collection.21b") || zip.file("collection.anki21b");
  const legacy21 = zip.file("collection.anki21");
  const legacy2 = zip.file("collection.anki2");
  const collection = modernEntry || legacy21 || legacy2;
  if (!collection) throw new Error("O pacote não contém uma coleção Anki reconhecível.");
  const modern = Boolean(modernEntry);

  post("phase", { progress: 6, message: modern ? "Descompactando coleção moderna..." : "Lendo coleção..." });
  let bytes = await collection.async("uint8array");
  if (modern) bytes = self.fzstd.decompress(bytes);
  const SQL = await SQLPromise;
  const db = new SQL.Database(bytes);
  let stmt;

  try {
    if (!tableExists(db, "cards") || !tableExists(db, "notes")) throw new Error("A coleção do Anki não possui cards/notes válidos.");
    const deckNames = readDeckNames(db);
    const usedDeckRows = execRows(db, "select distinct did from cards order by did");
    const cardCount = Number(execRows(db, "select count(*) as n from cards")[0]?.n) || 0;
    const decks = usedDeckRows.map((row) => ({ did: String(row.did), name: deckNames.get(String(row.did)) || "Baralho importado" }));

    await sendAcked("structure", { decks, cardCount, modern }, `structure:${jobId}`);
    if (currentJobId !== jobId) return;

    stmt = db.prepare("select c.did as did, c.ord as ord, n.flds as flds from cards c join notes n on n.id=c.nid order by c.did, c.id");
    const mediaIds = new Map();
    const usedMedia = new Set();
    const hotMedia = new Set();
    const hotCardsByDeck = new Map();
    let batch = [];
    let scanned = 0;
    let validCount = 0;
    let batchIndex = 0;

    while (stmt.step()) {
      const row = stmt.getAsObject();
      const did = String(row.did);
      const raw = createCard(String(row.flds || "").split("\u001f"), row.ord);
      const cardMedia = new Set();
      const frontHtml = sanitizeCardHtml(raw.frontHtml, mediaIds, usedMedia, cardMedia);
      const backHtml = sanitizeCardHtml(raw.backHtml, mediaIds, usedMedia, cardMedia);
      scanned += 1;

      if (meaningful(frontHtml) && meaningful(backHtml)) {
        batch.push({ did, frontHtml, backHtml });
        validCount += 1;
        if (cardMedia.size && (hotCardsByDeck.get(did) || 0) < 2 && hotMedia.size < HOT_MEDIA_LIMIT) {
          for (const name of cardMedia) {
            if (hotMedia.size >= HOT_MEDIA_LIMIT) break;
            hotMedia.add(name);
          }
          hotCardsByDeck.set(did, (hotCardsByDeck.get(did) || 0) + 1);
        }
      }

      if (batch.length >= CARD_BATCH) {
        const token = `cards:${jobId}:${batchIndex++}`;
        await sendAcked("cardBatch", { cards: batch, done: scanned, total: cardCount, validCount }, token);
        batch = [];
      } else if (scanned % 1500 === 0) {
        post("cardProgress", { done: scanned, total: cardCount, validCount });
      }
    }

    if (batch.length) {
      const token = `cards:${jobId}:${batchIndex++}`;
      await sendAcked("cardBatch", { cards: batch, done: scanned, total: cardCount, validCount }, token);
    }

    post("phase", { progress: 88, message: "Indexando imagens do pacote..." });
    const mediaMap = await readMediaMap(zip, modern);
    const refs = [];
    let missingMedia = 0;
    for (const name of usedMedia) {
      const info = mediaMap.get(name);
      const id = mediaIds.get(name);
      if (!info || !id || Number(info.size || 0) > MAX_MEDIA_BYTES) {
        missingMedia += 1;
        continue;
      }
      refs.push({
        id,
        zipName: String(info.zipName),
        name,
        mime: mimeFromName(name),
        size: Number(info.size) || 0,
        modern
      });
    }

    for (let offset = 0, index = 0; offset < refs.length; offset += REF_BATCH, index += 1) {
      const chunk = refs.slice(offset, offset + REF_BATCH);
      const token = `refs:${jobId}:${index}`;
      await sendAcked("mediaRefs", { refs: chunk, done: Math.min(refs.length, offset + chunk.length), total: refs.length }, token);
    }

    const validRefIds = new Set(refs.map((ref) => ref.id));
    const hotIds = [...hotMedia].map((name) => mediaIds.get(name)).filter((id) => validRefIds.has(id));
    post("done", {
      scanned,
      total: cardCount,
      validCount,
      mediaCount: refs.length,
      hotIds,
      missingMedia,
      modern
    });
  } finally {
    try { stmt?.free(); } catch (_) {}
    db.close();
  }
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "warmup") {
    ensureRuntime().catch((error) => post("error", { message: error?.message || "Falha ao preparar importador." }));
    return;
  }
  if (message.type === "ack" && message.token) {
    const waiter = ackWaiters.get(message.token);
    if (waiter) {
      ackWaiters.delete(message.token);
      waiter.resolve();
    }
    return;
  }
  if (message.type === "cancel") {
    currentJobId = null;
    for (const [token, waiter] of ackWaiters) {
      ackWaiters.delete(token);
      waiter.reject(new Error("Importação cancelada."));
    }
    return;
  }
  if (message.type === "start" && message.file) {
    const jobId = message.jobId || crypto.randomUUID();
    runJob(message.file, jobId).catch((error) => post("error", { message: error?.message || "Não foi possível importar este pacote." }));
  }
};
