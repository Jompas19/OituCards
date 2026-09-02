/* OituCards - resolvedor de mídia armazenada dentro do APKG */
const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
const FZSTD_URL = "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js";

let runtimeReady = false;
const packages = new Map();

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function ensureRuntime() {
  if (runtimeReady) return;
  importScripts(JSZIP_URL, FZSTD_URL);
  runtimeReady = true;
}

function sanitizeSvg(bytes) {
  try {
    const text = new TextDecoder().decode(bytes);
    if (/<script\b|<foreignObject\b|\bon\w+\s*=|javascript:/i.test(text)) return null;
    return bytes;
  } catch (_) {
    return null;
  }
}

async function loadPackage(packageId, blob, modern) {
  ensureRuntime();
  if (!packageId || !blob) throw new Error("Pacote de mídia inválido.");
  const existing = packages.get(packageId);
  if (existing?.ready) return existing;
  if (existing?.promise) return existing.promise;

  const holder = { ready: false, zip: null, modern: Boolean(modern), promise: null };
  holder.promise = self.JSZip.loadAsync(blob).then((zip) => {
    holder.zip = zip;
    holder.ready = true;
    holder.promise = null;
    return holder;
  });
  packages.set(packageId, holder);
  return holder.promise;
}

async function resolveMedia(message) {
  const holder = packages.get(message.packageId);
  if (!holder?.ready || !holder.zip) throw new Error("Pacote ainda não carregado.");
  const entry = holder.zip.file(String(message.zipName || ""));
  if (!entry) throw new Error("Mídia não encontrada no pacote.");

  let bytes = await entry.async("uint8array");
  if (holder.modern || message.modern) bytes = self.fzstd.decompress(bytes);
  if (String(message.mime || "") === "image/svg+xml") {
    const safe = sanitizeSvg(bytes);
    if (!safe) throw new Error("SVG inseguro descartado.");
    bytes = safe;
  }
  const blob = new Blob([bytes], { type: message.mime || "application/octet-stream" });
  post("resolved", {
    requestId: message.requestId,
    mediaId: message.mediaId,
    blob,
    mime: blob.type,
    size: blob.size,
    name: message.name || null
  });
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "loadPackage") {
    loadPackage(message.packageId, message.blob, message.modern)
      .then(() => post("packageReady", { packageId: message.packageId }))
      .catch((error) => post("packageError", { packageId: message.packageId, message: error?.message || "Falha ao abrir pacote." }));
    return;
  }
  if (message.type === "resolve") {
    resolveMedia(message).catch((error) => post("resolveError", {
      requestId: message.requestId,
      mediaId: message.mediaId,
      message: error?.message || "Falha ao resolver mídia."
    }));
    return;
  }
  if (message.type === "unload" && message.packageId) packages.delete(message.packageId);
};
