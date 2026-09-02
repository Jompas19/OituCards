/* OituCards - decodificador de uma única entrada de mídia por faixa do APKG */
const FFLATE_URL = "https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js";
const FZSTD_URL = "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js";
let runtimeReady = false;

function ensureRuntime() {
  if (runtimeReady) return;
  importScripts(FFLATE_URL, FZSTD_URL);
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

function decodeOuter(bytes, method) {
  if (method === 0) return bytes;
  if (method === 8) return self.fflate.inflateSync(bytes);
  throw new Error(`Compressão ZIP ${method} não suportada.`);
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "decode") return;
  try {
    ensureRuntime();
    let bytes = decodeOuter(new Uint8Array(message.buffer || new ArrayBuffer(0)), Number(message.compressionMethod) || 0);
    if (message.modern) bytes = self.fzstd.decompress(bytes);
    if (String(message.mime || "") === "image/svg+xml") {
      const safe = sanitizeSvg(bytes);
      if (!safe) throw new Error("SVG inseguro descartado.");
      bytes = safe;
    }
    const blob = new Blob([bytes], { type: message.mime || "application/octet-stream" });
    self.postMessage({
      type: "decoded",
      requestId: message.requestId,
      mediaId: message.mediaId,
      blob,
      mime: blob.type,
      size: blob.size,
      name: message.name || null
    });
  } catch (error) {
    self.postMessage({
      type: "decodeError",
      requestId: message.requestId,
      mediaId: message.mediaId,
      message: error?.message || "Falha ao decodificar mídia."
    });
  }
};
